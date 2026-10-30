/**
 * T36 (t36-design.md §2.1, D1–D4; F-134) — the generator's output budget and
 * the outcome of one generation, as a pure module (no I/O, no app state —
 * transportable, memory `rag-modularity-is-the-goal`).
 *
 * Why it exists. On Ollama's OpenAI-compatible endpoint one `max_tokens`
 * covers the thinking model's hidden reasoning AND the visible answer. The
 * orchestrator used to send `Math.max(maxTokens ?? 4096, 8192)` on an
 * enumeration turn and read back `message.content` and nothing else: on
 * T32's captions FQ12 was cut at exactly 8,192 completion tokens in 8 of 9
 * pipeline runs, once with an EMPTY answer that the wire reported as a
 * success (design §0b). The provider said `finish_reason: "length"` and put
 * the reasoning in `message.reasoning` on every one of those replies.
 *
 * Three things, each pure:
 *   planGenerationBudget   — applied = max(requested, floor); the floors are
 *                            CONSTANTS (D4: no knob, no settings key) and the
 *                            plan is disclosed on every span (requested →
 *                            applied, the rule).
 *   readGenerationOutcome  — the provider's finish reason VERBATIM, the
 *                            visible answer, the hidden reasoning, the usage;
 *                            both Ollama reply shapes (D5: the OpenAI-
 *                            compatible one is the only one sent today; the
 *                            native shape is understood so a hosting control
 *                            such as thinking can be added later — memory
 *                            `inference-engine-direction`).
 *   describeGeneration     — the response field, the span's badge and details,
 *                            the telemetry additions, the user-facing text of
 *                            an empty cut. The reasoning / answer split is
 *                            reported in CHARACTERS and the total in tokens —
 *                            never a token estimate of the split (design §0c:
 *                            13,002 chars of arithmetic were ~8,000 tokens, a
 *                            chars ÷ 3.5 estimate is wrong for numbers).
 */

const { RETRIEVAL_ERROR_CODES } = require("./config");

/**
 * The floors (D3, as amended by the owner 2026-09-15): a lookup 8,192, an
 * enumeration 16,384 — the measured need on the flagship enumeration was
 * 9,857 tokens with thinking on (design §0c); a cap is not a target, so a
 * turn that fits pays nothing more. Thinking stays ON for every turn.
 * T63 (t63-design.md D5 (a)): a turn whose prompt is a WHOLE document gets the enumeration's floor whatever its
 * intent — the floor follows the prompt. A whole-document lookup's answers reached 7,732 completion tokens (94 % of
 * 8,192) reconciling F-245's phantom row; a cut answer is lost whole (T36's empty-answer case).
 */
const GENERATION_FLOORS = Object.freeze({ default: 8192, enumerate: 16384, wholeDocument: 16384 });

/** What a request that names no budget asks for (the page's Tokens default). */
const GENERATION_REQUEST_DEFAULT = 4096;

const GENERATION_PROVIDERS = Object.freeze({
  OPENAI_COMPATIBLE: "openai-compatible",
  OLLAMA_NATIVE: "ollama-native",
});

/** The thinking control this ticket sends: none (D3 / D5 — the provider's default). */
const THINKING_CONTROL_DEFAULT = "provider-default";

/**
 * The budget for one generation, named: `applied = max(requested, floor)`
 * with the floor chosen by the turn's intent (the router's word, D3 / D4).
 * `requested` is the number the request named, or 4,096 when it named none
 * or named nonsense — today's arithmetic, made explicit. T63 (D5 (a)): `wholeDocument` — the prompt holds a whole
 * document (an enumeration read whole, or a lookup whose selected document was read whole) — takes the whole-document
 * floor when the intent's is lower.
 */
function planGenerationBudget({ intent, requestedMaxTokens, wholeDocument = false } = {}) {
  const rule = intent === "enumerate" ? "enumerate" : wholeDocument === true ? "wholeDocument" : "default";
  const floor = GENERATION_FLOORS[rule];
  const n = Number(requestedMaxTokens);
  const requested =
    requestedMaxTokens === null || requestedMaxTokens === undefined || requestedMaxTokens === "" || !Number.isFinite(n) || n <= 0
      ? GENERATION_REQUEST_DEFAULT
      : Math.floor(n);
  return { requested, applied: Math.max(requested, floor), floor, rule };
}

const asText = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const asCount = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * What one generation produced, read from the provider's reply.
 *
 *   "openai-compatible": choices[0].finish_reason ("stop" | "length" |
 *     "tool_calls" | …, or null when absent — "not reported", never a guess),
 *     choices[0].message.content (or a top-level `content`, the legacy read),
 *     choices[0].message.reasoning ?? .reasoning_content (Ollama's OpenAI
 *     door puts the thinking there — design §0a), usage.prompt_tokens /
 *     usage.completion_tokens (the two parts COUNTED TOGETHER by the provider).
 *   "ollama-native": done_reason, message.content (or `response`),
 *     message.thinking, prompt_eval_count / eval_count.
 *
 * `cut` is the provider's word (`finishReason === "length"`), `empty` is the
 * visible answer's (whitespace only). `reasoningShare` is BY CHARACTERS.
 */
function readGenerationOutcome({ provider = GENERATION_PROVIDERS.OPENAI_COMPATIBLE, json } = {}) {
  const body = isObject(json) ? json : {};
  let finishReason = null;
  let content = "";
  let reasoning = "";
  let promptTokens = null;
  let completionTokens = null;
  let providerReported = false;
  if (provider === GENERATION_PROVIDERS.OLLAMA_NATIVE) {
    const m = isObject(body.message) ? body.message : {};
    finishReason = typeof body.done_reason === "string" ? body.done_reason : null;
    content = asText(m.content) || asText(body.response);
    reasoning = asText(m.thinking);
    promptTokens = asCount(body.prompt_eval_count);
    completionTokens = asCount(body.eval_count);
    providerReported = completionTokens !== null;
  } else {
    const choice = Array.isArray(body.choices) && isObject(body.choices[0]) ? body.choices[0] : {};
    const m = isObject(choice.message) ? choice.message : {};
    finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : null;
    content = asText(m.content) || asText(body.content);
    reasoning = asText(m.reasoning) || asText(m.reasoning_content);
    const u = isObject(body.usage) ? body.usage : null;
    promptTokens = u ? asCount(u.prompt_tokens) : null;
    completionTokens = u ? asCount(u.completion_tokens) : null;
    providerReported = u !== null;
  }
  const cut = finishReason === "length";
  const empty = content.trim() === "";
  const chars = { answer: content.length, reasoning: reasoning.length };
  const total = chars.answer + chars.reasoning;
  return {
    provider,
    content,
    reasoning,
    finishReason,
    cut,
    empty,
    usage: { promptTokens, completionTokens, providerReported },
    chars,
    reasoningShare: total > 0 ? chars.reasoning / total : null,
  };
}

const withCommas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * The disclosure of one generation: the typed `generation` field (named by
 * both routes, copied onto the message by the page), the LLM span's badge
 * and details, the telemetry additions, and the plain error text of an
 * empty cut (D2: a failure, like an outage). The numbers in every sentence
 * come from the outcome — the chip renders `generation.message`, it never
 * re-derives.
 */
function describeGeneration({ plan, outcome, model, attempts = 1, thinkingControl = THINKING_CONTROL_DEFAULT } = {}) {
  if (!plan || !outcome) throw new Error("describeGeneration needs the plan and the outcome");
  const code = outcome.cut ? (outcome.empty ? RETRIEVAL_ERROR_CODES.GENERATION_EMPTY : RETRIEVAL_ERROR_CODES.GENERATION_CUT) : null;
  const share = outcome.reasoningShare;
  const sharePct = share === null ? null : Math.round(share * 100);
  const limit = `${withCommas(plan.applied)}-token output limit`;
  let message;
  if (code === RETRIEVAL_ERROR_CODES.GENERATION_EMPTY) {
    message = `The model reached its ${limit} while reasoning and produced no visible answer (${code}). Retry, or ask for fewer items at a time.`;
  } else if (code === RETRIEVAL_ERROR_CODES.GENERATION_CUT) {
    message =
      `The model reached its ${limit}; ` +
      (sharePct === null ? "" : `about ${sharePct} % of what it generated was hidden reasoning, so `) +
      `the answer may stop before the end (${code}).`;
  } else if (outcome.finishReason === null) {
    message = `The provider reported no finish reason, so whether the answer ran to its end is not known (budget ${withCommas(plan.applied)} tokens).`;
  } else {
    message = `The answer ran to its end (finish reason "${outcome.finishReason}") inside the ${withCommas(plan.applied)}-token budget.`;
  }
  let badge;
  let badgeType;
  if (code === RETRIEVAL_ERROR_CODES.GENERATION_EMPTY) {
    badge = "NO ANSWER — BUDGET SPENT REASONING";
    badgeType = "red";
  } else if (code === RETRIEVAL_ERROR_CODES.GENERATION_CUT) {
    badge = `CUT AT ${plan.applied} TOKENS`;
    badgeType = "amber";
  } else if (outcome.finishReason === null) {
    badge = "FINISH REASON NOT REPORTED";
    badgeType = "blue";
  } else {
    badge = `${model}`;
    badgeType = "teal";
  }
  const thinking = {
    control: thinkingControl,
    reasoningChars: outcome.chars.reasoning,
    answerChars: outcome.chars.answer,
    // By characters, and labelled so — never a token estimate of the split.
    reasoningShare: share === null ? null : Math.round(share * 1000) / 1000,
    shareBasis: "characters",
  };
  const budget = { requested: plan.requested, applied: plan.applied, floor: plan.floor, rule: plan.rule };
  const usage = { promptTokens: outcome.usage.promptTokens, completionTokens: outcome.usage.completionTokens, providerReported: outcome.usage.providerReported };
  const generation = {
    provider: outcome.provider,
    model: model ?? null,
    finishReason: outcome.finishReason,
    cut: outcome.cut,
    code,
    message,
    budget,
    thinking,
    usage,
    attempts,
  };
  return {
    generation,
    badge,
    badgeType,
    spanDetails: { provider: outcome.provider, finishReason: outcome.finishReason, generationCode: code, budget, usage, thinking, attempts },
    telemetry: {
      finish_reason: outcome.finishReason,
      max_tokens: plan.applied,
      answer_chars: outcome.chars.answer,
      reasoning_chars: outcome.chars.reasoning,
    },
    userMessage: code === RETRIEVAL_ERROR_CODES.GENERATION_EMPTY ? message : null,
  };
}

module.exports = {
  GENERATION_FLOORS,
  GENERATION_REQUEST_DEFAULT,
  GENERATION_PROVIDERS,
  THINKING_CONTROL_DEFAULT,
  planGenerationBudget,
  readGenerationOutcome,
  describeGeneration,
};
