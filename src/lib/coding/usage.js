/**
 * src/lib/coding/usage.js — the tokens the model answers consumed, per step, per demo and per session, read from the
 * run log (polish Phase 2; the owner's PL-D7 to PL-D9 and PL-D13 of 2026-10-14; inputs/demo-design/polish-design.md).
 *
 * Pure (no I/O). Three kinds of run-log line carry an answer's tokens as the model server reported them (`tokens
 * { prompt, completion, providerReported }`): a coding `turn` (with its step, repair flag, the sizes of the prompt's
 * parts and the answer's size), S4's `doc-turn` and a free-form document chat's `chat-turn`. Embeddings, reranking and
 * ingest captioning report no tokens here and are not counted.
 *   sessionEvents  everything since the last environment reset (`reset-all`, the typed RESET): PL-D7 (a). Clear the
 *                  chat writes no line, so it leaves the figures alone; a reload and a pod roll do too.
 *   demoUsage      a demo's current run (steps.js windowOf: since its last Select or reset): a row per step that
 *                  answered, repairs inside their step, a free-form row for answers given in the demo with no step,
 *                  the totals, and the split.
 *   usageSummary   the session's totals, its demos, its free-form answers, the split, and the active demo's usage.
 *   splitOf        PL-D13 (a): the server reports one prompt count and one completion count per answer, never which
 *                  part each token came from. A coding turn's line keeps the size in characters of each part the app
 *                  composed, so the prompt tokens are apportioned by character share into: your message; the rules and
 *                  documents found; the code and files (the attached files, a review's diff, a layout, a unit list, a
 *                  test run, the findings to fix); the replayed chat; the instructions (the system prompt, the
 *                  request's instruction, the disclosure facts). The completion tokens split into thinking and answer
 *                  the same way. Always labelled "character share": an apportionment, not a count.
 * Every sum keeps how many answers were counted, how many the app estimated (`providerReported` false) and how many
 * carried no figure, so a figure is never silently exact; and the tokens by model (`byModel`, "unknown" when a line
 * names none), so pricing.js can cost each model at its own price (Phase 3).
 */

const { windowOf } = require("./steps");

const ANSWER_KINDS = Object.freeze(["turn", "doc-turn", "chat-turn"]);
const INPUT_GROUPS = Object.freeze([
  { id: "message", label: "your message", parts: ["request"] },
  { id: "rules", label: "rules and documents", parts: ["evidence"] },
  { id: "code", label: "code and files", parts: ["review", "layout", "files", "units", "tests", "fix"] },
  { id: "history", label: "chat history", parts: ["history"] },
  { id: "instructions", label: "instructions", parts: ["system", "instruction", "disclosure"] },
]);
const OUTPUT_GROUPS = Object.freeze([
  { id: "thinking", label: "thinking" },
  { id: "answer", label: "answer" },
]);
const SPLIT_BASIS = "character share";

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** The run-log lines since the last environment reset, and when that reset was (null when there was none). */
function sessionEvents(events) {
  const list = Array.isArray(events) ? events : [];
  let start = 0;
  list.forEach((e, i) => {
    if (e && typeof e === "object" && e.kind === "reset-all") start = i + 1;
  });
  return { events: list.slice(start).filter((e) => e && typeof e === "object"), since: start > 0 && list[start - 1].at ? list[start - 1].at : null };
}

/** A run-log line read as an answer, or null when it is not one. */
function answerOf(e) {
  if (!e || typeof e !== "object" || !ANSWER_KINDS.includes(e.kind)) return null;
  const t = e.tokens && typeof e.tokens === "object" ? e.tokens : null;
  const prompt = t ? num(t.prompt) : null;
  const completion = t ? num(t.completion) : null;
  return {
    at: typeof e.at === "string" ? e.at : null,
    kind: e.kind,
    scenario: typeof e.scenario === "string" && e.scenario ? e.scenario : null,
    step: typeof e.step === "string" && e.step ? e.step : null,
    model: typeof e.model === "string" && e.model ? e.model : null,
    repair: e.repair === true,
    tokens: prompt !== null || completion !== null ? { prompt: prompt || 0, completion: completion || 0, reported: t.providerReported === true } : null,
    composition: e.composition && typeof e.composition === "object" ? e.composition : null,
    reasoningChars: e.thinking && typeof e.thinking === "object" && num(e.thinking.reasoningChars) !== null ? e.thinking.reasoningChars : 0,
    answerChars: num(e.answerChars),
  };
}

/** The sum over answers: how many, how many counted, the tokens, how many estimated, how many without a figure. */
function sumTokens(answers) {
  const out = { answers: 0, counted: 0, prompt: 0, completion: 0, total: 0, estimated: 0, uncounted: 0, byModel: {} };
  for (const a of Array.isArray(answers) ? answers : []) {
    out.answers += 1;
    if (!a.tokens) {
      out.uncounted += 1;
      continue;
    }
    out.counted += 1;
    out.prompt += a.tokens.prompt;
    out.completion += a.tokens.completion;
    if (!a.tokens.reported) out.estimated += 1;
    const m = a.model || "unknown";
    const b = out.byModel[m] || (out.byModel[m] = { answers: 0, prompt: 0, completion: 0 });
    b.answers += 1;
    b.prompt += a.tokens.prompt;
    b.completion += a.tokens.completion;
  }
  out.total = out.prompt + out.completion;
  return out;
}

const shareOf = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** PL-D13 (a): the coding turns' tokens apportioned by the character share of each part (see the header). */
function splitOf(answers) {
  const list = (Array.isArray(answers) ? answers : []).filter((a) => a.kind === "turn" && a.tokens && a.composition);
  const input = Object.fromEntries(INPUT_GROUPS.map((g) => [g.id, 0]));
  const output = { thinking: 0, answer: 0 };
  for (const a of list) {
    const sizes = INPUT_GROUPS.map((g) => g.parts.reduce((n, p) => n + (num(a.composition[p]) || 0), 0));
    const inSum = sizes.reduce((n, x) => n + x, 0);
    if (inSum > 0) INPUT_GROUPS.forEach((g, i) => (input[g.id] += (a.tokens.prompt * sizes[i]) / inSum));
    const think = a.reasoningChars || 0;
    const ans = a.answerChars === null ? 0 : a.answerChars;
    const outSum = think + ans;
    if (outSum > 0) {
      output.thinking += (a.tokens.completion * think) / outSum;
      output.answer += (a.tokens.completion * ans) / outSum;
    }
  }
  const inRounded = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, Math.round(v)]));
  const outRounded = { thinking: Math.round(output.thinking), answer: Math.round(output.answer) };
  const inTotal = Object.values(inRounded).reduce((n, v) => n + v, 0);
  const outTotal = outRounded.thinking + outRounded.answer;
  return {
    basis: SPLIT_BASIS,
    answers: list.length,
    input: INPUT_GROUPS.map((g) => ({ id: g.id, label: g.label, tokens: inRounded[g.id], share: shareOf(inRounded[g.id], inTotal) })),
    output: OUTPUT_GROUPS.map((g) => ({ id: g.id, label: g.label, tokens: outRounded[g.id], share: shareOf(outRounded[g.id], outTotal) })),
  };
}

/** A demo's current run: per step, the free-form answers, the totals and the split (`scenario` is the definition). */
function demoUsage(events, scenario) {
  const id = scenario && typeof scenario.id === "string" ? scenario.id : null;
  if (!id) return null;
  const answers = windowOf(events, id)
    .filter((e) => e.scenario === id)
    .map(answerOf)
    .filter(Boolean);
  const defs = Array.isArray(scenario.steps) ? scenario.steps : [];
  const ids = [...new Set([...defs.map((s) => s.id), ...answers.map((a) => a.step).filter(Boolean)])];
  const steps = ids
    .map((sid) => {
      const mine = answers.filter((a) => a.step === sid);
      const def = defs.find((s) => s.id === sid);
      return { id: sid, title: def && def.title ? def.title : sid, ...sumTokens(mine), repairs: mine.filter((a) => a.repair).length };
    })
    .filter((s) => s.answers > 0);
  return { id, title: scenario.title || id, steps, freeForm: sumTokens(answers.filter((a) => !a.step)), totals: sumTokens(answers), split: splitOf(answers) };
}

/** The session since the last environment reset (its totals, demos, free-form answers and split) and the active demo's usage. */
function usageSummary(events, { scenarioId = null, scenarios = [] } = {}) {
  const { events: ses, since } = sessionEvents(events);
  const answers = ses.map(answerOf).filter(Boolean);
  const defs = Array.isArray(scenarios) ? scenarios : [];
  const demos = [...new Set(answers.map((a) => a.scenario).filter(Boolean))].map((id) => {
    const def = defs.find((s) => s.id === id);
    return { id, title: def && def.title ? def.title : id, ...sumTokens(answers.filter((a) => a.scenario === id)) };
  });
  const active = scenarioId ? defs.find((s) => s.id === scenarioId) || { id: scenarioId, title: scenarioId, steps: [] } : null;
  return {
    since,
    session: { ...sumTokens(answers), demos, freeForm: sumTokens(answers.filter((a) => !a.scenario)), split: splitOf(answers) },
    demo: active ? demoUsage(events, active) : null,
    basis: SPLIT_BASIS,
  };
}

module.exports = { ANSWER_KINDS, INPUT_GROUPS, OUTPUT_GROUPS, SPLIT_BASIS, sessionEvents, answerOf, sumTokens, splitOf, demoUsage, usageSummary };
