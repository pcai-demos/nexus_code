/**
 * Reranker score contract — ticket T10 (FM-N1; audit E20/E21/FM-T3; findings
 * F-9, F-26, F-23).
 *
 * The scoring helpers used to live inline in the retrieve route with no way to
 * test them, which is why the U-RERANK suite shipped as a skeleton. They are
 * pure — no I/O, no config, no fetch — so every captured failure shape is
 * pinned on `npm test` instead of only when infrastructure happens to break.
 *
 * The contract in one sentence: **a score is either something the reranker
 * actually said, or it is `null`.** There is no third category. Three concrete
 * fabrications are removed by that rule:
 *
 *   1. The **0.5 seed** (F-26). Every generative path seeded all candidates at
 *      0.5 and left the seed in place when a scoring call failed. Measured
 *      in-pod: with the endpoint at a dead port an absence probe returned a
 *      full keepTopN at exactly 0.5, `success:true`, no error — the 0.05
 *      relevance floor compared `0.5 >= 0.05` and passed everything, silently
 *      reverting T08's floor. It never threw, so a caught-exception fix would
 *      never have fired.
 *   2. The **1.0 default** (E21). A candidate the dedicated API did not score
 *      was handed the highest possible relevance, outranking every real score.
 *   3. **Digits harvested from reasoning** (E20). `"<think>…7/10…</think>"`
 *      yielded 0.7 as if the model had scored the passage.
 *
 * A `null` is not a failure to report — it is the report. Unscored candidates
 * PASS the relevance floor by the repository owner's ruling (2026-09-03):
 * suppressing them would turn a total rerank outage into "the documents do not
 * mention it" for every query (FM-L7 masking), which is worse than passing
 * them. The ruling is conditional on the uncertainty being disclosed, which is
 * why the route raises RERANK_DOWN / RERANK_PARTIAL and the UI renders a chip.
 *
 * NOT this module's business, and deliberately untouched (F-23 — the reranker
 * only works as a three-part arrangement and breaking one leg makes scores
 * silently useless): the vLLM scoring-task deployment, the Qwen3 instruction
 * template wrap, and the mention-style instruct. This module never sees a
 * prompt; it only parses what came back and decides an order.
 */

/**
 * Rerank input window (FM-T3). Tail-heavy chunks were scored on their first
 * third: the generative paths truncated to the leading 1500 characters, so a
 * passage whose relevant content sits at the end was judged on boilerplate.
 */
const RERANK_HEAD_CHARS = 1000;
const RERANK_TAIL_CHARS = 400;

/**
 * Verdict scores for the generative paths. Unchanged from the pre-T10 code on
 * purpose: T10 owns which responses are PARSEABLE, not what a parsed verdict
 * is worth. (Note for a later ticket: a parsed "no" at 0.1 still clears the
 * 0.05 floor, which was calibrated on the dedicated path's distribution.)
 */
const VERDICT_YES = 0.9;
const VERDICT_NO = 0.1;

/**
 * Anchored verdict. The optional `relevant:` label is admitted because the
 * generative prompt ends with the literal word "Relevant:", so echoing it back
 * is the model completing the template rather than failing to answer — and the
 * committed U-RERANK case `"Relevant: yes"` expects a positive verdict.
 * Anchoring is the point: an unanchored search is what let "I think the answer
 * is 42" become a score (E20).
 */
const VERDICT_RE = /^(?:relevant\s*:\s*)?(yes|no)\b/;

/**
 * A bare score, and nothing else. Deliberately whole-string: `"0.85"` is a
 * score, `"the answer is 0.85 maybe"` is not.
 */
const BARE_SCORE_RE = /^[01](?:\.\d+)?$/;

/** A usable score is a finite number. Everything else — null, undefined, NaN,
 *  Infinity, a string — means "not scored". */
function isScored(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** A candidate's score as a number, or null. The single definition of
 *  "scored", so the floor, the sort, the report and the eval cannot disagree. */
function scoreOf(candidate) {
  const value = candidate ? candidate.rerankScore : undefined;
  return isScored(value) ? value : null;
}

/** How many candidates carry a real score. Candidate COVERAGE — the input to
 *  the route's RERANK_DOWN vs RERANK_PARTIAL decision. */
function countScored(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  return list.filter((c) => scoreOf(c) !== null).length;
}

/**
 * Remove model reasoning before parsing anything. Order matters: strip first,
 * parse second. Scanning the raw text for digits is exactly how audit E20's
 * corruption happened.
 */
function stripThinkBlocks(text) {
  if (typeof text !== "string") return "";
  return text
    // Complete blocks.
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    // An UNTERMINATED opener: these calls run with max_tokens ~10, so a model
    // that starts thinking is cut off mid-thought. Everything from the opener
    // onward is reasoning, and the verdict never arrived.
    .replace(/<think>[\s\S]*$/i, " ")
    // A closer with no opener — the Qwen3 template pre-fills an empty think
    // block, so a completion can legitimately begin with `</think>`.
    .replace(/<\/think>/gi, " ")
    .trim();
}

/**
 * Parse one generative scoring response into a score, or null.
 *
 * Anything not recognised is `null`, including an empty body, prose, a refusal,
 * or a number outside [0,1]. The caller turns transport failures into `null`
 * the same way, so "the call failed" and "the answer was unusable" are one
 * outcome — which is the honest one: in both cases nobody judged this passage.
 */
function parseVerdict(raw) {
  if (typeof raw !== "string") return null;
  const text = stripThinkBlocks(raw).trim().toLowerCase();
  if (!text) return null;

  const verdict = VERDICT_RE.exec(text);
  if (verdict) return verdict[1] === "yes" ? VERDICT_YES : VERDICT_NO;

  if (BARE_SCORE_RE.test(text)) {
    const parsed = Number.parseFloat(text);
    // The pattern still admits "1.5" (a `1` followed by `.5`), so the range
    // check is not redundant.
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }

  return null;
}

/**
 * The text handed to a reranker for one chunk: head + tail, not head alone
 * (FM-T3). Applied to the GENERATIVE paths only — the dedicated score API is
 * sent whole chunks today and is measured healthy (F-9: hygiene 0.0000, tau
 * 1.0000, MRR@10 0.9375), so narrowing what it reads would change the scored
 * text for a third of the corpus with no measured benefit. Owner decision D2,
 * 2026-09-03.
 */
function windowForRerank(text, head = RERANK_HEAD_CHARS, tail = RERANK_TAIL_CHARS) {
  const s = typeof text === "string" ? text : "";
  if (s.length <= head + tail) return s;
  return `${s.slice(0, head)}\n[...]\n${s.slice(s.length - tail)}`;
}

/**
 * Attribute a dedicated score API's rows to candidates BY EXPLICIT INDEX.
 *
 * Audit E21: `results.find(r => r.index === idx) || results[idx]` silently
 * assigns scores to the wrong candidates whenever a provider returns rows
 * ordered by relevance without an index — the positional fallback looks like a
 * safety net and is actually a scrambler. It is gone. If ANY row cannot be
 * placed by an explicit, in-range, unique index then NO row can be trusted to
 * belong to the candidate at its position, so every candidate scores `null`
 * and the caller reports the degradation.
 *
 * @returns {{scored: Array, usableCount: number, reason: string|null}}
 */
function mapDedicatedScores(candidates, results) {
  const list = Array.isArray(candidates) ? candidates : [];
  const rows = Array.isArray(results) ? results : [];

  const indices = rows.map((r) => (r && Number.isInteger(r.index) ? r.index : null));
  const usableIndices =
    rows.length > 0 &&
    indices.every((i) => i !== null && i >= 0 && i < list.length) &&
    new Set(indices).size === indices.length;

  if (!usableIndices) {
    return {
      scored: list.map((c) => ({ ...c, rerankScore: null })),
      usableCount: 0,
      reason:
        rows.length === 0
          ? "the score API returned an empty result array"
          : "the score API returned results without a usable `index` field, so no score " +
            "could be attributed to the candidate it belongs to",
    };
  }

  const byIndex = new Map();
  rows.forEach((r) => byIndex.set(r.index, r));

  let usableCount = 0;
  const scored = list.map((candidate, idx) => {
    const row = byIndex.get(idx);
    const raw = row
      ? row.relevance_score !== undefined
        ? row.relevance_score
        : row.score
      : undefined;
    // No 1.0 default (E21): an unscored candidate is unscored, not perfect.
    const rerankScore = isScored(raw) ? raw : null;
    if (rerankScore !== null) usableCount += 1;
    return { ...candidate, rerankScore };
  });

  return { scored, usableCount, reason: null };
}

/**
 * The sort contract: scored candidates descending, then unscored candidates —
 * both groups keeping their original retrieval order among themselves.
 *
 * Two things this fixes. `b.rerankScore - a.rerankScore` yields NaN against a
 * null, and a NaN comparator produces an implementation-defined order, so
 * nulls landed anywhere. And the 0.5 seed used to outrank a confidently
 * rejected passage at 0.1 (FM-N1) — an unjudged passage beating a judged one.
 *
 * Nulls last is the ordering half of the owner's ruling: they are still
 * returned (never suppressed), but they cannot displace a passage the reranker
 * actually endorsed. `Array.prototype.sort` is stable (ES2019), which is what
 * preserves retrieval order within each group.
 */
function orderByScore(candidates) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  return list.sort((a, b) => {
    const as = scoreOf(a);
    const bs = scoreOf(b);
    if (as === null && bs === null) return 0;
    if (as === null) return 1;
    if (bs === null) return -1;
    return bs - as;
  });
}

/**
 * The relevance floor, applied to SCORED candidates only.
 *
 * An unscored candidate passes — the owner's 2026-09-03 ruling. The floor
 * exists to drop passages the reranker judged irrelevant; it cannot judge a
 * passage nobody scored, and dropping those would convert a rerank outage into
 * a false claim that the corpus lacks the content.
 */
function passesFloor(candidate, minRerankScore) {
  const score = scoreOf(candidate);
  if (score === null) return true;
  return score >= minRerankScore;
}

module.exports = {
  RERANK_HEAD_CHARS,
  RERANK_TAIL_CHARS,
  VERDICT_YES,
  VERDICT_NO,
  isScored,
  scoreOf,
  countScored,
  stripThinkBlocks,
  parseVerdict,
  windowForRerank,
  mapDedicatedScores,
  orderByScore,
  passesFloor,
};
