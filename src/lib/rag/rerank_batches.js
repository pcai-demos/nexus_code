/**
 * T42 (t42-design.md §2.1, §2.3; D3, D4, D5; F-164) — the rerank stage plans
 * its requests instead of making one.
 *
 * Before T42 the retrieve route sent an enumeration turn's whole candidate
 * pool — T28's fifty — to the dedicated reranker in ONE request with ONE
 * budget. The pool is bounded in documents and never in bytes, and the
 * reranker's cost is the bytes': measured on the served image on 2026-09-22
 * (t42-artifacts/probes/records), 0.87 ± 0.06 ms per char across 8 KB → 121 KB
 * on a cache miss — which every production call is, since no two turns send
 * the same pool. Fifty long captions are 79–121 KB, i.e. 47–121 s against a
 * 60 s budget, and when the one request did not fit, NOTHING was scored: the
 * stage raised RERANK_DOWN and fell through to the generative fallback whose
 * 0.5 seed T10 documented. One oversized request also evicts the endpoint's
 * cache for every other turn (F-166).
 *
 * What this module decides, and only this:
 *   - `planRerankBatches`: the candidates, in their retrieval order, cut into
 *     requests of at most `maxDocs` documents and `maxChars` characters,
 *     whichever binds first. A single document longer than `maxChars` goes
 *     in a request of its own and is NEVER dropped — dropping a candidate
 *     silently is the one thing the stage must not do (T10).
 *   - `remainingBudgetMs`: what is left of the stage's deadline before a
 *     request is sent; a request is never started with no time left.
 *   - `summariseRerankStage`: the stage's outcome for the report and the log
 *     — sent / failed / unsent / scored, and whether the deadline stopped it.
 *
 * What batching does NOT do, measured: it does not make the stage faster
 * (the same bytes cost the same seconds, split or whole), and running the
 * requests in parallel buys nothing (the endpoint serialises). It makes each
 * request small enough never to run away or evict a neighbour, and it makes
 * an overrun PARTIAL — the first requests' scores are real and the tail is
 * honestly unscored (RERANK_PARTIAL, T10's contract) — instead of total. The
 * time itself is the deadline's, which the enumeration profile sets for its
 * own pool (router.js ENUMERATE_RETRIEVAL, D4).
 *
 * Pure: strings and numbers in, index lists and numbers out. No fetch, no
 * config, no clock (U-RERANK-BATCHES).
 */

/**
 * The stage's defaults (t42-design.md D3, D4): a request of at most 16
 * documents / 28,000 chars — ≈ 28 s at the worst measured miss rate, so no
 * single request can consume a whole budget, and a request that size does
 * not evict a neighbour's cache entry the way a 121 KB one does — under a
 * 60 s stage deadline for an ordinary turn (the route's budget since T08).
 * API-only overrides (`rerankMaxChars` / `rerankMaxDocs` / `rerankBudgetMs`,
 * D7): never a drawer control.
 */
const RERANK_BATCH_DEFAULTS = Object.freeze({ maxChars: 28000, maxDocs: 16, budgetMs: 60000 });

/**
 * Cut `documents` into batches.
 *
 * @param {string[]} documents the documents AS THEY WILL BE SENT (the route's
 *                             formatted copies), in retrieval order
 * @param {{maxChars?: number, maxDocs?: number}} [bounds]
 * @returns {{batches: number[][], plan: object}} `batches` are lists of
 *   indices into `documents`, every index exactly once, order kept; `plan`
 *   is what the report says about the cut.
 */
function planRerankBatches(documents, bounds = {}) {
  if (!Array.isArray(documents)) throw new TypeError("planRerankBatches: documents must be an array of strings");
  const maxChars = bounds && bounds.maxChars !== undefined ? bounds.maxChars : RERANK_BATCH_DEFAULTS.maxChars;
  const maxDocs = bounds && bounds.maxDocs !== undefined ? bounds.maxDocs : RERANK_BATCH_DEFAULTS.maxDocs;
  if (!(Number.isFinite(maxChars) && maxChars >= 1)) throw new TypeError(`planRerankBatches: maxChars must be a number ≥ 1 (received ${maxChars})`);
  if (!(Number.isInteger(maxDocs) && maxDocs >= 1)) throw new TypeError(`planRerankBatches: maxDocs must be an integer ≥ 1 (received ${maxDocs})`);
  const lengths = documents.map((d, i) => {
    if (typeof d !== "string") throw new TypeError(`planRerankBatches: document ${i} is not a string`);
    return d.length;
  });

  const batches = [];
  const oversized = [];
  let current = [];
  let currentChars = 0;
  const close = () => {
    if (current.length) batches.push(current);
    current = [];
    currentChars = 0;
  };
  for (let i = 0; i < lengths.length; i++) {
    const n = lengths[i];
    // Longer than a whole request may be: alone, and named — never dropped.
    if (n > maxChars) {
      close();
      batches.push([i]);
      oversized.push(i);
      continue;
    }
    if (current.length >= maxDocs || currentChars + n > maxChars) close();
    current.push(i);
    currentChars += n;
  }
  close();

  const plan = {
    batchCount: batches.length,
    maxChars,
    maxDocs,
    documents: lengths.length,
    chars: lengths.reduce((a, b) => a + b, 0),
    batchDocs: batches.map((b) => b.length),
    batchChars: batches.map((b) => b.reduce((a, i) => a + lengths[i], 0)),
    oversized,
  };
  return { batches, plan };
}

/**
 * What is left of the stage's deadline: `budgetMs - elapsedMs`, never below
 * 0. A caller sends a request only when this is > 0, and gives that request
 * exactly this much (each attempt inside it gets its own signal — F-163).
 */
function remainingBudgetMs(budgetMs, elapsedMs) {
  if (!(Number.isFinite(budgetMs) && budgetMs >= 0)) throw new TypeError(`remainingBudgetMs: budgetMs must be a number ≥ 0 (received ${budgetMs})`);
  if (!(Number.isFinite(elapsedMs) && elapsedMs >= 0)) throw new TypeError(`remainingBudgetMs: elapsedMs must be a number ≥ 0 (received ${elapsedMs})`);
  return Math.max(0, budgetMs - elapsedMs);
}

/**
 * The stage's outcome from its per-batch traces (D5, D8).
 *
 * @param {{batchCount: number, documents: number}} plan
 * @param {Array<{documents: number, scored: number}>} sentBatches one trace
 *        per request actually SENT, in order; `scored` = usable scores back
 * @returns {{planned:number, sent:number, failed:number, unsent:number,
 *            scored:number, unscored:number, stoppedEarly:boolean}}
 *   `failed` = sent with no usable score; `unsent` = planned but never sent
 *   (the deadline); `stoppedEarly` = the deadline left a batch unsent.
 */
function summariseRerankStage(plan, sentBatches) {
  const planned = plan && Number.isInteger(plan.batchCount) ? plan.batchCount : 0;
  const documents = plan && Number.isInteger(plan.documents) ? plan.documents : 0;
  const sent = Array.isArray(sentBatches) ? sentBatches : [];
  const scored = sent.reduce((a, b) => a + (Number.isInteger(b.scored) ? b.scored : 0), 0);
  const failed = sent.filter((b) => !(Number.isInteger(b.scored) && b.scored > 0)).length;
  const unsent = Math.max(0, planned - sent.length);
  return {
    planned,
    sent: sent.length,
    failed,
    unsent,
    scored,
    unscored: Math.max(0, documents - scored),
    stoppedEarly: unsent > 0,
  };
}

module.exports = {
  RERANK_BATCH_DEFAULTS,
  planRerankBatches,
  remainingBudgetMs,
  summariseRerankStage,
};
