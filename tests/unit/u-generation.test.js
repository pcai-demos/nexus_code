/**
 * U-GEN — the generator's output budget and outcome (ticket T36, design §2.1
 * and §4; finding F-134).
 *
 * Measured before the ticket (t36-design.md §0b, the served T32 image): FQ12
 * against the kept arm B and arm C classes was cut at exactly 8,192
 * completion tokens in all four runs — 528 / 0 / 295 / 493 visible words —
 * and the EMPTY one was a normal turn on the wire (`success: true`, HTTP
 * 200, `citations: []`, "Processed successfully." on the page). The provider
 * said `finish_reason: "length"` and put the hidden reasoning in
 * `message.reasoning` on every one of those replies; nothing read either.
 *
 * These are pure-function tests over reply fixtures in the two shapes this
 * Ollama serves (design §0a): the OpenAI-compatible door (the one the
 * orchestrator uses) and the native door (understood so a hosting control
 * can be added later — D5). No live service.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  GENERATION_FLOORS,
  GENERATION_REQUEST_DEFAULT,
  GENERATION_PROVIDERS,
  THINKING_CONTROL_DEFAULT,
  planGenerationBudget,
  readGenerationOutcome,
  describeGeneration,
} = require("../../src/lib/rag/generation");
const { RETRIEVAL_ERROR_CODES } = require("../../src/lib/rag/config");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Ollama 0.33.3's OpenAI-compatible reply for qwen3.8:27b (design §0a: keys role, content, reasoning). */
function openaiReply(opts = {}) {
  const { content = "", reasoning = "", usage = { prompt_tokens: 10025, completion_tokens: 8192, total_tokens: 18217 } } = opts;
  // `finish` absent → "stop"; passed as undefined → the key is OMITTED (a provider that reports nothing).
  const finish = "finish" in opts ? opts.finish : "stop";
  const message = { role: "assistant", content, ...(reasoning !== null ? { reasoning } : {}) };
  const choice = { index: 0, message, ...(finish !== undefined ? { finish_reason: finish } : {}) };
  return { id: "chatcmpl-1", object: "chat.completion", created: 1, model: "qwen3.8:27b", choices: [choice], ...(usage ? { usage } : {}) };
}

/** Ollama's native /api/chat reply (design §0a: message.thinking, done_reason, eval_count). */
function nativeReply(opts = {}) {
  const { content = "", thinking = "", evalCount = 475, promptCount = 38 } = opts;
  const done = "done" in opts ? opts.done : "stop";
  const message = { role: "assistant", content, ...(thinking !== null ? { thinking } : {}) };
  return { model: "qwen3.8:27b", created_at: "2026-09-15T06:36:00Z", message, done: true, ...(done !== undefined ? { done_reason: done } : {}), prompt_eval_count: promptCount, eval_count: evalCount };
}

describe("U-GEN: the floors and the plan (design D3 as amended, D4)", () => {
  test("the floors are the owner's amended constants: lookups 8,192, enumerations 16,384 — and, since T63 (D5 (a)), any whole-document prompt 16,384; no other rule", () => {
    assert.deepStrictEqual(GENERATION_FLOORS, { default: 8192, enumerate: 16384, wholeDocument: 16384 });
    assert.ok(Object.isFrozen(GENERATION_FLOORS), "the floors are constants, not a knob (D4)");
    assert.strictEqual(GENERATION_REQUEST_DEFAULT, 4096, "a request naming no budget asks for the page's default");
  });

  test("T63 (t63-design D5 (a)): a whole-document prompt takes the whole-document floor whatever the intent; an enumeration keeps its own rule; a lookup not read whole is unchanged", () => {
    assert.deepStrictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 1024, wholeDocument: true }), { requested: 1024, applied: 16384, floor: 16384, rule: "wholeDocument" });
    assert.deepStrictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 20000, wholeDocument: true }), { requested: 20000, applied: 20000, floor: 16384, rule: "wholeDocument" });
    assert.deepStrictEqual(planGenerationBudget({ intent: "enumerate", requestedMaxTokens: 1024, wholeDocument: true }), { requested: 1024, applied: 16384, floor: 16384, rule: "enumerate" });
    assert.deepStrictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 1024, wholeDocument: false }), { requested: 1024, applied: 8192, floor: 8192, rule: "default" });
    assert.deepStrictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 1024 }), { requested: 1024, applied: 8192, floor: 8192, rule: "default" }, "absent is not a whole document");
    assert.strictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 1024, wholeDocument: "yes" }).rule, "default", "only true is true");
  });

  test("applied = max(requested, floor): below, at and above each floor", () => {
    // A lookup: the harness sends 1,024, the page 4,096 — both floored to 8,192 and disclosed as such.
    assert.deepStrictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 1024 }), { requested: 1024, applied: 8192, floor: 8192, rule: "default" });
    assert.deepStrictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 4096 }), { requested: 4096, applied: 8192, floor: 8192, rule: "default" });
    assert.deepStrictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 8192 }), { requested: 8192, applied: 8192, floor: 8192, rule: "default" });
    // The page's Tokens control still raises the budget above the floor (D4: a user who sets 20,000 gets 20,000).
    assert.deepStrictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 20000 }), { requested: 20000, applied: 20000, floor: 8192, rule: "default" });
    // An enumeration: 16,384, and the same knob semantics.
    assert.deepStrictEqual(planGenerationBudget({ intent: "enumerate", requestedMaxTokens: 1024 }), { requested: 1024, applied: 16384, floor: 16384, rule: "enumerate" });
    assert.deepStrictEqual(planGenerationBudget({ intent: "enumerate", requestedMaxTokens: 16384 }), { requested: 16384, applied: 16384, floor: 16384, rule: "enumerate" });
    assert.deepStrictEqual(planGenerationBudget({ intent: "enumerate", requestedMaxTokens: 32768 }), { requested: 32768, applied: 32768, floor: 16384, rule: "enumerate" });
  });

  test("the rule follows the router's intent: only `enumerate` gets the enumeration floor (count, lookup, absent, anything else → default)", () => {
    for (const intent of ["lookup", "count", undefined, null, "", "ENUMERATE", "enumeration"]) {
      const p = planGenerationBudget({ intent, requestedMaxTokens: 4096 });
      assert.strictEqual(p.rule, "default", `intent ${JSON.stringify(intent)} must take the default rule`);
      assert.strictEqual(p.applied, 8192);
    }
    assert.strictEqual(planGenerationBudget({ intent: "enumerate" }).rule, "enumerate");
  });

  test("a request naming no budget, or nonsense, asks for 4,096 — today's `?? 4096`, made explicit", () => {
    for (const v of [undefined, null, "", "abc", NaN, -5, 0, {}]) {
      const p = planGenerationBudget({ intent: "lookup", requestedMaxTokens: v });
      assert.strictEqual(p.requested, 4096, `requested ${JSON.stringify(v)} → 4096`);
      assert.strictEqual(p.applied, 8192);
    }
    // A numeric string is a number (the drawer's input can send one); a fraction is floored.
    assert.strictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: "20000" }).applied, 20000);
    assert.strictEqual(planGenerationBudget({ intent: "lookup", requestedMaxTokens: 9000.7 }).requested, 9000);
  });
});

describe("U-GEN: reading the outcome — the OpenAI-compatible reply (design §0a, D1)", () => {
  test("a complete answer: finish `stop` verbatim, not cut, not empty, the reasoning separate, the usage provider-reported", () => {
    const o = readGenerationOutcome({ provider: "openai-compatible", json: openaiReply({ content: "Six designs.", reasoning: "thinking…", finish: "stop", usage: { prompt_tokens: 10025, completion_tokens: 9857 } }) });
    assert.strictEqual(o.provider, "openai-compatible");
    assert.strictEqual(o.finishReason, "stop");
    assert.strictEqual(o.cut, false);
    assert.strictEqual(o.empty, false);
    assert.strictEqual(o.content, "Six designs.");
    assert.strictEqual(o.reasoning, "thinking…");
    assert.deepStrictEqual(o.usage, { promptTokens: 10025, completionTokens: 9857, providerReported: true });
    assert.deepStrictEqual(o.chars, { answer: 12, reasoning: 9 });
    assert.ok(Math.abs(o.reasoningShare - 9 / 21) < 1e-9, "the share is by characters");
  });

  test("a cut WITH an answer (§0b, B run 1): finish `length`, cut, not empty", () => {
    const o = readGenerationOutcome({ provider: "openai-compatible", json: openaiReply({ content: "| Room | Dimensions (ft in) |", reasoning: "x".repeat(13002), finish: "length" }) });
    assert.strictEqual(o.finishReason, "length");
    assert.strictEqual(o.cut, true);
    assert.strictEqual(o.empty, false);
    assert.strictEqual(o.chars.reasoning, 13002);
    assert.strictEqual(o.usage.completionTokens, 8192);
  });

  test("a cut with NO answer (§0b, B run 2): cut AND empty — whitespace-only content is empty too", () => {
    const o = readGenerationOutcome({ provider: "openai-compatible", json: openaiReply({ content: "", reasoning: "all of it", finish: "length" }) });
    assert.strictEqual(o.cut, true);
    assert.strictEqual(o.empty, true);
    assert.strictEqual(o.reasoningShare, 1, "everything generated was hidden reasoning");
    const ws = readGenerationOutcome({ provider: "openai-compatible", json: openaiReply({ content: " \n\t", reasoning: "r", finish: "length" }) });
    assert.strictEqual(ws.empty, true);
    assert.strictEqual(ws.content, " \n\t", "the content itself is kept verbatim; only the verdict says empty");
  });

  test("no finish_reason at all: null (\"not reported\"), never a guess — cut is false, the span says so, not the model", () => {
    const o = readGenerationOutcome({ provider: "openai-compatible", json: openaiReply({ content: "answer", reasoning: "", finish: undefined }) });
    assert.strictEqual(o.finishReason, null);
    assert.strictEqual(o.cut, false);
    assert.strictEqual(o.empty, false);
    // A non-string finish reason is "not reported" too — the field is the provider's word or nothing.
    const odd = readGenerationOutcome({ provider: "openai-compatible", json: openaiReply({ content: "a", finish: 3 }) });
    assert.strictEqual(odd.finishReason, null);
  });

  test("any other finish reason is carried verbatim and is not a cut (`tool_calls`, `content_filter`, a future word)", () => {
    for (const word of ["tool_calls", "content_filter", "eos", "something_new"]) {
      const o = readGenerationOutcome({ provider: "openai-compatible", json: openaiReply({ content: "a", finish: word }) });
      assert.strictEqual(o.finishReason, word);
      assert.strictEqual(o.cut, false);
    }
  });

  test("`reasoning_content` (vLLM / MLIS's spelling) is read as the reasoning too; absent reasoning is an empty string", () => {
    const vllm = { choices: [{ message: { role: "assistant", content: "a", reasoning_content: "thought" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 } };
    assert.strictEqual(readGenerationOutcome({ provider: "openai-compatible", json: vllm }).reasoning, "thought");
    const none = readGenerationOutcome({ provider: "openai-compatible", json: openaiReply({ content: "a", reasoning: null }) });
    assert.strictEqual(none.reasoning, "");
    assert.strictEqual(none.chars.reasoning, 0);
    assert.strictEqual(none.reasoningShare, 0);
  });

  test("the legacy top-level `content` read survives (the orchestrator's old `|| llmData.content`), and no usage means not provider-reported", () => {
    const o = readGenerationOutcome({ provider: "openai-compatible", json: { content: "legacy" } });
    assert.strictEqual(o.content, "legacy");
    assert.strictEqual(o.finishReason, null);
    assert.deepStrictEqual(o.usage, { promptTokens: null, completionTokens: null, providerReported: false });
    // Garbage in: nothing throws, the outcome is "empty, not reported".
    for (const junk of [null, undefined, "", 42, [], { choices: "x" }, { choices: [null] }]) {
      const g = readGenerationOutcome({ provider: "openai-compatible", json: junk });
      assert.strictEqual(g.empty, true);
      assert.strictEqual(g.cut, false);
      assert.strictEqual(g.finishReason, null);
      assert.strictEqual(g.reasoningShare, null, "nothing generated → no share, not 0 and not NaN");
    }
  });

  test("the provider defaults to openai-compatible (D5: the request shape every engine serves)", () => {
    assert.strictEqual(readGenerationOutcome({ json: openaiReply({ content: "a" }) }).provider, GENERATION_PROVIDERS.OPENAI_COMPATIBLE);
  });
});

describe("U-GEN: reading the outcome — Ollama's native reply (design §0a, D5: understood, not sent)", () => {
  test("a complete native answer: done_reason `stop`, message.thinking is the reasoning, eval_count the completion tokens", () => {
    const o = readGenerationOutcome({ provider: "ollama-native", json: nativeReply({ content: "95 chars of answer", thinking: "517 chars", done: "stop", evalCount: 475, promptCount: 38 }) });
    assert.strictEqual(o.provider, "ollama-native");
    assert.strictEqual(o.finishReason, "stop");
    assert.strictEqual(o.cut, false);
    assert.strictEqual(o.content, "95 chars of answer");
    assert.strictEqual(o.reasoning, "517 chars");
    assert.deepStrictEqual(o.usage, { promptTokens: 38, completionTokens: 475, providerReported: true });
  });

  test("a native cut: done_reason `length` → cut; with `think: false` there is no thinking field and the reasoning is empty", () => {
    const cut = readGenerationOutcome({ provider: "ollama-native", json: nativeReply({ content: "", thinking: "152 chars", done: "length", evalCount: 64 }) });
    assert.strictEqual(cut.cut, true);
    assert.strictEqual(cut.empty, true);
    const noThink = readGenerationOutcome({ provider: "ollama-native", json: nativeReply({ content: "2, 3, 5, 7", thinking: null, done: "length", evalCount: 64 }) });
    assert.strictEqual(noThink.cut, true);
    assert.strictEqual(noThink.empty, false);
    assert.strictEqual(noThink.reasoning, "");
    assert.strictEqual(noThink.reasoningShare, 0);
  });

  test("no done_reason → null; a /api/generate-style `response` is read when message.content is absent", () => {
    const o = readGenerationOutcome({ provider: "ollama-native", json: nativeReply({ content: "a", done: undefined }) });
    assert.strictEqual(o.finishReason, null);
    const gen = readGenerationOutcome({ provider: "ollama-native", json: { response: "generated", done: true, done_reason: "stop", eval_count: 9 } });
    assert.strictEqual(gen.content, "generated");
    assert.strictEqual(gen.usage.completionTokens, 9);
  });
});

describe("U-GEN: the disclosure (design §2.2, §2.3; D1, D2)", () => {
  const plan = planGenerationBudget({ intent: "enumerate", requestedMaxTokens: 1024 });

  test("a complete answer: the badge is the model in teal, no code, the field carries the budget, the split and the usage", () => {
    const outcome = readGenerationOutcome({ json: openaiReply({ content: "answer text", reasoning: "reasoning text!", finish: "stop", usage: { prompt_tokens: 10025, completion_tokens: 9857 } }) });
    const d = describeGeneration({ plan, outcome, model: "qwen3.8:27b" });
    assert.strictEqual(d.badge, "qwen3.8:27b");
    assert.strictEqual(d.badgeType, "teal");
    assert.strictEqual(d.userMessage, null);
    assert.deepStrictEqual(d.generation, {
      provider: "openai-compatible",
      model: "qwen3.8:27b",
      finishReason: "stop",
      cut: false,
      code: null,
      message: 'The answer ran to its end (finish reason "stop") inside the 16,384-token budget.',
      budget: { requested: 1024, applied: 16384, floor: 16384, rule: "enumerate" },
      thinking: { control: "provider-default", reasoningChars: 15, answerChars: 11, reasoningShare: 0.577, shareBasis: "characters" },
      usage: { promptTokens: 10025, completionTokens: 9857, providerReported: true },
      attempts: 1,
    });
    assert.deepStrictEqual(d.telemetry, { finish_reason: "stop", max_tokens: 16384, answer_chars: 11, reasoning_chars: 15 });
    assert.strictEqual(d.spanDetails.budget.applied, 16384);
    assert.strictEqual(d.spanDetails.thinking.shareBasis, "characters");
    assert.strictEqual(THINKING_CONTROL_DEFAULT, "provider-default");
  });

  test("a cut with an answer: GENERATION_CUT, the amber `CUT AT <applied> TOKENS` badge, the message's numbers from the outcome (the share by characters)", () => {
    const outcome = readGenerationOutcome({ json: openaiReply({ content: "x".repeat(734), reasoning: "r".repeat(13002), finish: "length" }) });
    const d = describeGeneration({ plan, outcome, model: "qwen3.8:27b" });
    assert.strictEqual(d.generation.code, RETRIEVAL_ERROR_CODES.GENERATION_CUT);
    assert.strictEqual(d.generation.cut, true);
    assert.strictEqual(d.badge, "CUT AT 16384 TOKENS");
    assert.strictEqual(d.badgeType, "amber");
    assert.strictEqual(d.userMessage, null, "a cut WITH an answer is a degradation on a 200, not a failure");
    assert.strictEqual(d.generation.message, "The model reached its 16,384-token output limit; about 95 % of what it generated was hidden reasoning, so the answer may stop before the end (GENERATION_CUT).");
    assert.strictEqual(d.generation.thinking.reasoningShare, 0.947);
    assert.strictEqual(d.telemetry.finish_reason, "length");
    assert.strictEqual(d.spanDetails.generationCode, "GENERATION_CUT");
  });

  test("an EMPTY cut: GENERATION_EMPTY, the red badge, and the failure text names the limit and the code (T12's contract: success means an answer exists)", () => {
    const outcome = readGenerationOutcome({ json: openaiReply({ content: "", reasoning: "r".repeat(20000), finish: "length" }) });
    const d = describeGeneration({ plan, outcome, model: "qwen3.8:27b" });
    assert.strictEqual(d.generation.code, RETRIEVAL_ERROR_CODES.GENERATION_EMPTY);
    assert.strictEqual(d.badge, "NO ANSWER — BUDGET SPENT REASONING");
    assert.strictEqual(d.badgeType, "red");
    assert.strictEqual(d.userMessage, "The model reached its 16,384-token output limit while reasoning and produced no visible answer (GENERATION_EMPTY). Retry, or ask for fewer items at a time.");
    assert.strictEqual(d.generation.message, d.userMessage);
    // The lookup floor's wording follows the plan, not a constant.
    const lookup = describeGeneration({ plan: planGenerationBudget({ intent: "lookup", requestedMaxTokens: 4096 }), outcome, model: "m" });
    assert.match(lookup.userMessage, /8,192-token output limit/);
    assert.strictEqual(lookup.badge, "NO ANSWER — BUDGET SPENT REASONING");
  });

  test("no finish reason: the blue `FINISH REASON NOT REPORTED` badge, no code, cut false — never a false alarm, never a false all-clear", () => {
    const outcome = readGenerationOutcome({ json: openaiReply({ content: "answer", finish: undefined, usage: null }) });
    const d = describeGeneration({ plan, outcome, model: "m" });
    assert.strictEqual(d.badge, "FINISH REASON NOT REPORTED");
    assert.strictEqual(d.badgeType, "blue");
    assert.strictEqual(d.generation.code, null);
    assert.strictEqual(d.generation.finishReason, null);
    assert.strictEqual(d.generation.usage.providerReported, false);
    assert.match(d.generation.message, /reported no finish reason/);
    assert.strictEqual(d.telemetry.finish_reason, null);
  });

  test("the self-correction pass is disclosed as attempts: 2 on the call whose answer is returned", () => {
    const outcome = readGenerationOutcome({ json: openaiReply({ content: "fixed code", finish: "stop" }) });
    assert.strictEqual(describeGeneration({ plan, outcome, model: "m", attempts: 2 }).generation.attempts, 2);
    assert.strictEqual(describeGeneration({ plan, outcome, model: "m", attempts: 2 }).spanDetails.attempts, 2);
  });

  test("no token estimate of the split anywhere: the field carries chars and the provider's total only", () => {
    const outcome = readGenerationOutcome({ json: openaiReply({ content: "a".repeat(700), reasoning: "b".repeat(13002), finish: "length" }) });
    const d = describeGeneration({ plan, outcome, model: "m" });
    const flat = JSON.stringify(d);
    assert.ok(!/reasoningTokens|answerTokens|TokensEst|tokensEstimated/i.test(flat), `a token estimate of the split leaked: ${flat.slice(0, 200)}`);
    assert.strictEqual(d.generation.thinking.reasoningChars, 13002);
    assert.strictEqual(d.generation.usage.completionTokens, 8192);
  });

  test("the two codes are their own strings in the shared taxonomy (U-CFG's rule), and the module uses the taxonomy's", () => {
    assert.strictEqual(RETRIEVAL_ERROR_CODES.GENERATION_CUT, "GENERATION_CUT");
    assert.strictEqual(RETRIEVAL_ERROR_CODES.GENERATION_EMPTY, "GENERATION_EMPTY");
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "rag", "generation.js"), "utf-8");
    assert.match(src, /RETRIEVAL_ERROR_CODES\.GENERATION_CUT/);
    assert.match(src, /RETRIEVAL_ERROR_CODES\.GENERATION_EMPTY/);
  });
});

describe("U-GEN: the module is pure and transportable (memory rag-modularity-is-the-goal)", () => {
  test("no I/O, no app state: the only require is the taxonomy", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "rag", "generation.js"), "utf-8");
    const requires = [...src.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
    assert.deepStrictEqual(requires, ["./config"]);
    assert.ok(!/\bfetch\(|\bfs\.|process\.env/.test(src), "the module neither fetches nor reads files nor the env");
  });
});
