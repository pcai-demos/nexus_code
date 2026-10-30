/**
 * Retrieval-quality metrics (evaluation-plan §5).
 *
 * Pure functions with no I/O so they can be unit tested directly: these numbers
 * gate every later ticket, so a silent metrics bug would corrupt the baseline
 * comparison that makes "this change improved retrieval" falsifiable.
 *
 * Relevance is judged at PAGE granularity — a result is relevant when its
 * (source, page) pair is in the query's expected set. Chunk boundaries move as
 * chunking configuration changes; page attribution does not.
 */

/** Stable key for a retrieved result or an expectation. */
function pageKey(source, page) {
  return `${source}#${page}`;
}

/**
 * T34 (design D8 a): an UNPAGINATED source (the manifest's `paginated: false` — a .docx, .md, .txt: every chunk is
 * stamped page 1, which is not a location) is scored at DOCUMENT level: its key is `(source, *)` on both sides, so a
 * hit means "the right file came back", never "the right page". `facts` = { [source]: boolean } (absent → paginated,
 * the pre-T34 reading); `granularityOf(query, facts)` says which was used so the record can state it.
 */
const DOCUMENT_LEVEL = "*";
function isUnpaginated(source, facts) {
  return !!facts && facts[source] === false;
}
/**
 * T38 (T34's D8 b): SECTION-level scoring for an unpaginated source. A query's `relevant` entry may name `sections`
 * — the heading(s) the manifest's independent engine (python-docx, the md reader) places the anchor under; a result
 * row carries `sectionPath` (T34: the heading path the parser stored, innermost last). Both are normalised the same
 * way before comparison — HTML entities unescaped (docling writes `&amp;` — F-146), whitespace collapsed, case folded,
 * trailing punctuation dropped — and the row's INNERMOST heading is what is compared (the manifest names one heading,
 * the path carries its ancestors too). A row with no section never matches a section key.
 */
const SECTION_LEVEL = "§";
function normaliseSection(text) {
  return String(text || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.:;,–—-]+$/g, "")
    .toLowerCase();
}
function innermostOf(sectionPath) {
  const parts = String(sectionPath || "").split(" › ").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}
function sectionKey(source, section) {
  return `${source}#${SECTION_LEVEL}${normaliseSection(section)}`;
}
function expectedKeySet(query, facts = null) {
  const keys = new Set();
  for (const rel of query.relevant || []) {
    if (isUnpaginated(rel.source, facts)) {
      const sections = Array.isArray(rel.sections) ? rel.sections.filter((s) => typeof s === "string" && s.trim()) : [];
      if (sections.length) { for (const s of sections) keys.add(sectionKey(rel.source, s)); continue; }
      keys.add(pageKey(rel.source, DOCUMENT_LEVEL));
      continue;
    }
    for (const page of rel.pages) keys.add(pageKey(rel.source, page));
  }
  return keys;
}
/** Every key a result row answers to: its page key, or — for an unpaginated source — its document key AND its section key (when it has a section). */
function resultKeys(result, facts = null) {
  if (!isUnpaginated(result.source, facts)) return [pageKey(result.source, result.page)];
  const keys = [pageKey(result.source, DOCUMENT_LEVEL)];
  // The retrieve route's raw row carries the store's `sectionTitle`; the snapshot's recorded row carries `sectionPath` — either.
  const inner = innermostOf(result.sectionPath ?? result.sectionTitle);
  if (inner) keys.push(sectionKey(result.source, inner));
  return keys;
}
function granularityOf(query, facts = null) {
  const rels = query.relevant || [];
  if (rels.length === 0) return null;
  const kinds = rels.map((rel) => (!isUnpaginated(rel.source, facts) ? "page" : Array.isArray(rel.sections) && rel.sections.some((s) => typeof s === "string" && s.trim()) ? "section" : "document"));
  return kinds.every((k) => k === kinds[0]) ? kinds[0] : "mixed";
}

function resultKey(result, facts = null) {
  return pageKey(result.source, isUnpaginated(result.source, facts) ? DOCUMENT_LEVEL : result.page);
}

/**
 * Fraction of a query's expected (source, page) pairs found in the top k.
 * Queries with no expected pages (absence-verification probes) are excluded by
 * the caller rather than scored here.
 */
function recallAtK(results, query, k, facts = null) {
  const expected = expectedKeySet(query, facts);
  if (expected.size === 0) return null;

  const seen = new Set(results.slice(0, k).flatMap((r) => resultKeys(r, facts)));
  let hits = 0;
  for (const key of expected) if (seen.has(key)) hits += 1;
  return hits / expected.size;
}

/** Reciprocal rank of the first relevant result within the top k, else 0. */
function reciprocalRankAtK(results, query, k, facts = null) {
  const expected = expectedKeySet(query, facts);
  if (expected.size === 0) return null;

  const top = results.slice(0, k);
  for (let i = 0; i < top.length; i += 1) {
    if (resultKeys(top[i], facts).some((key) => expected.has(key))) return 1 / (i + 1);
  }
  return 0;
}

function mean(values) {
  const usable = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

/**
 * Kendall's tau-b between two rankings of the same items, used as the
 * run-to-run rank-stability measure (target >= 0.95). Items missing from either
 * ranking are ignored, since an item that appears in only one run cannot have
 * its relative order compared.
 *
 * tau-b corrects for ties, which matter here: the current reranker assigns the
 * same default score to every failed call (audit E20), producing large tied
 * groups whose internal order is arbitrary.
 */
/** The tau-b arithmetic over the keys both rankings share, given each side's rank map (shared with the tolerant form). */
function tauFromRanks(shared, indexA, indexB) {
  const n = shared.length;
  if (n < 2) return null;

  let concordant = 0;
  let discordant = 0;
  let tiedA = 0;
  let tiedB = 0;

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = indexA.get(shared[i]) - indexA.get(shared[j]);
      const b = indexB.get(shared[i]) - indexB.get(shared[j]);
      const sa = Math.sign(a);
      const sb = Math.sign(b);

      if (sa === 0) tiedA += 1;
      if (sb === 0) tiedB += 1;
      if (sa === 0 || sb === 0) continue;

      if (sa === sb) concordant += 1;
      else discordant += 1;
    }
  }

  const total = (n * (n - 1)) / 2;
  const denominator = Math.sqrt((total - tiedA) * (total - tiedB));
  if (denominator === 0) return null;
  return (concordant - discordant) / denominator;
}

function kendallTau(rankingA, rankingB) {
  const indexA = new Map(rankingA.map((key, i) => [key, i]));
  const indexB = new Map(rankingB.map((key, i) => [key, i]));
  const shared = rankingA.filter((key) => indexB.has(key));
  return tauFromRanks(shared, indexA, indexB);
}

/**
 * T40 (t40-design.md D10; F-130): Kendall's τ with a tie tolerance. The reranker's score for a (query, chunk) pair
 * drifts in the fourth decimal between blocks of time (F-130 measured 0.0002 across a 0.0021 gap between two chaff
 * rows), and a τ that demands the whole list's ORDER be reproducible read a leg red on that noise while every page
 * an answer depends on sat where it was. Here two rows whose rerank scores lie within `epsilon` of each other are one
 * rank. Ranks are assigned by walking each list in its returned order: a row within epsilon of the PREVIOUS row shares
 * its rank (a chain — 0.074, 0.072, 0.071, 0.069 are one rank at ε 0.005 — which is exactly the chaff cluster F-130
 * is about); an unscored row (null) is its own rank after the scored ones; a key seen twice (two chunks of one page)
 * keeps its first, best rank. Then the tau-b arithmetic over the shared keys, ties counted as ties. ε is a constant of
 * the evaluation plan, applied to every query on every leg — never a per-query knob (memory
 * no-point-fixes-foundational-only). The raw τ (kendallTau above) is reported beside it and never gated.
 */
const TAU_TIE_EPSILON = 0.005;

function tolerantRanks(rows, { epsilon = TAU_TIE_EPSILON, facts = null } = {}) {
  const ranks = new Map();
  let rank = -1;
  let prev;
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = r && typeof r.rerankScore === "number" && Number.isFinite(r.rerankScore) ? r.rerankScore : null;
    const tied = s !== null && typeof prev === "number" && Math.abs(prev - s) <= epsilon;
    if (!tied) rank += 1;
    const k = resultKey(r, facts);
    if (!ranks.has(k)) ranks.set(k, rank);
    prev = s;
  }
  return ranks;
}

function kendallTauTolerant(rowsA, rowsB, opts = {}) {
  const ra = tolerantRanks(rowsA, opts);
  const rb = tolerantRanks(rowsB, opts);
  const shared = [...ra.keys()].filter((k) => rb.has(k));
  return tauFromRanks(shared, ra, rb);
}

/**
 * Fraction of final results whose rerank score is absent or sits exactly on the
 * provider-independent default. Audit E20 records that failed and unparseable
 * scoring calls both land on 0.5, so a high value here means ranking is being
 * driven by scoring failures rather than relevance. Target < 0.10.
 */
function scoreHygiene(results, defaultScore = 0.5) {
  if (results.length === 0) return null;
  const degraded = results.filter(
    (r) => r.rerankScore === null || r.rerankScore === undefined || r.rerankScore === defaultScore
  ).length;
  return degraded / results.length;
}

/**
 * Fraction of final results carrying NO relevance score at all — ticket T10.
 *
 * This is the metric `scoreHygiene` above CANNOT be, and the distinction is the
 * whole point of T10's contract. `scoreHygiene` counts a null and a fabricated
 * 0.5 identically (both are "degraded"), so with a dead reranker it reads 1.000
 * both before and after T10 and can never show that the fabrication stopped.
 * This one counts only the honest signal: a row the reranker never scored.
 *
 * Under T10 a HIGHER value with a failing reranker is the CORRECT outcome, not
 * a regression — the owner's 2026-09-03 ruling is that unscored candidates pass
 * the relevance floor and the uncertainty is disclosed instead of hidden. Read
 * it alongside the per-query `degraded` codes, never on its own.
 */
function neverScoredFraction(results) {
  if (results.length === 0) return null;
  const unscored = results.filter(
    (r) => !(typeof r.rerankScore === "number" && Number.isFinite(r.rerankScore))
  ).length;
  return unscored / results.length;
}

/**
 * Fraction of page numbers cited in an answer that correspond to a page actually
 * present in the retrieved context. Detects the doc_log_01.txt failure mode
 * (audit E32) where the model invents plausible page numbers.
 */
function citationValidity(answerText, results) {
  const cited = new Set();
  const pattern = /\b(?:page|p\.)\s*(\d{1,4})\b/gi;
  let match;
  while ((match = pattern.exec(answerText || "")) !== null) {
    cited.add(Number(match[1]));
  }
  if (cited.size === 0) return null;

  const available = new Set(results.map((r) => r.page));
  let valid = 0;
  for (const page of cited) if (available.has(page)) valid += 1;
  return valid / cited.size;
}

module.exports = {
  granularityOf,
  isUnpaginated,
  DOCUMENT_LEVEL,
  SECTION_LEVEL,
  normaliseSection,
  innermostOf,
  sectionKey,
  resultKeys,
  pageKey,
  expectedKeySet,
  resultKey,
  recallAtK,
  reciprocalRankAtK,
  mean,
  kendallTau,
  kendallTauTolerant,
  tolerantRanks,
  TAU_TIE_EPSILON,
  scoreHygiene,
  neverScoredFraction,
  citationValidity,
};
