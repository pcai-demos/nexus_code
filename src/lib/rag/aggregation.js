/**
 * Term-frequency aggregation — ticket T09 (audit E18/E33, FM-T2).
 *
 * A "how many times does X appear" question used to be answered by counting
 * inside whatever 20 chunks retrieval happened to return, over a stem-variant
 * regex nobody could switch off, while the trace claimed an uncapped scan.
 * This module is the pure half of the fix: it counts, it decides what the
 * scan actually covered, and it renders the prompt block and the trace facts.
 * It knows nothing about Weaviate, Next.js or the orchestrator — every input
 * is a value (chunks, a term, numbers the caller measured) so the same code
 * can be lifted into another pipeline unchanged and unit-tested without a
 * pod (evaluation-plan §2, U-COUNT).
 *
 * INPUT CONTRACT — an AggregationChunk is a plain object with:
 *   text            string   the chunk body (lines split on "\n")
 *   source          string   document name; the per-document key
 *   page            number   stored page; only a positive integer is a
 *                            location (0 / missing = unlocated, never "1")
 *   sectionNumber   string?  optional section anchor
 *   sectionTitle    string?  optional section title
 *   isVisualElement boolean? true for a VLM caption chunk (top-level, as
 *                            the vector store returns it)
 *   metadata        string|object?  JSON string or object; read for
 *                            isVisualElement, section_title, section,
 *                            startLine, endLine
 * `paginationFacts` (optional) is `{ [source]: boolean }` — `false` marks a
 * file whose stored page is a synthesised stamp, not a location (F-11), the
 * same contract citations.js uses.
 *
 * Rules that are decisions, not accidents (t09-design.md D2, D3, D5):
 *
 *  1. THE COUNT RULE IS THE MANIFEST'S RULE: case-insensitive, whole-word by
 *     non-alphanumeric boundaries — `(?<![A-Za-z0-9])term(?![A-Za-z0-9])`,
 *     the same pattern scripts/derive_golden_manifest.py uses to produce
 *     `termCounts`. Stem variants (the stem plus s, 's, s', ing, ed, es) are
 *     opt-in via `countStemVariants`, and only then is the query term itself
 *     stem-stripped ("testing" → "test").
 *  2. RETRIEVE WHAT YOU COUNT: the BM25 query is the bare term unless stem
 *     variants are counted, and then it is the variant set as real tokens.
 *     Never the apostrophe forms — Weaviate's tokenizer turns "term's" into a
 *     lone "s", which matched 31 of 102 chunks in the eval collection.
 *  3. CAPTION CHUNKS ARE SCANNED BUT NOT COUNTED. A VLM description of a
 *     diagram that says "Assembly Blueprint" is the captioner's wording, not
 *     the document's text; the manifest ground truth is the text layer. They
 *     are reported separately so the user knows they exist.
 *  4. OVERLAP COPIES ARE COLLAPSED BY MODELLING THE CHUNKER, NOTHING ELSE.
 *     recursiveSplit (parser.js) starts chunk i+1 with an exact copy of the
 *     tail of chunk i (up to chunkOverlap chars) — measured in the eval
 *     collection: six same-page pairs share a 186–199-char suffix→prefix
 *     copy against a 200-char setting. So for chunks of the same source and
 *     page, the longest suffix of one chunk that is a prefix of another IS
 *     the overlap, and matches inside that prefix are skipped. Nothing else
 *     is collapsed: a tools list that repeats "Aluminium handle" on two lines
 *     is two occurrences (the inherited per-line key counted it once and
 *     I-COUNT failed 13 !== 14), and 334 of the 421 same-page repeated lines
 *     measured are genuine repeats, not overlap.
 */

const STEM_SUFFIX_RE = /(?:ing|ed|es|s|'s)$/i;
/** Suffixes the stem-variant regex accepts — today's behaviour, now opt-in. */
const STEM_VARIANT_ALTERNATION = "(?:s|'s|s'|ing|ed|es)?";
/** Suffixes that are real BM25 tokens (no apostrophes — see rule 2). */
const EXPANSION_SUFFIXES = ["", "s", "es", "ing", "ed"];
/** Longest suffix→prefix copy considered an overlap (chunkOverlap is ≤ 200 in every profile). */
const MAX_OVERLAP_CHARS = 2000;

const RULE_EXACT = "case-insensitive whole-word";
const RULE_STEM = "case-insensitive whole-word on the stem, accepting the suffixes s, 's, s', ing, ed, es";

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&");
}

/** Strip surrounding quotes and whitespace; the term as the user meant it. */
function normaliseTerm(term) {
  return String(term ?? "")
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .trim();
}

function stemOf(term) {
  const stripped = term.replace(STEM_SUFFIX_RE, "");
  return stripped.length > 0 ? stripped : term;
}

/**
 * The counting regex. Global + case-insensitive; boundaries are
 * non-alphanumeric lookarounds rather than `\b` so that `_` and `-` behave
 * exactly as they do in the manifest derivation (JS `\b` treats `_` as a word
 * character; the manifest does not). Throws on an empty term — callers
 * normalise first and treat an empty result as "no count question".
 */
function buildTermRegex(term, { countStemVariants = false } = {}) {
  const clean = normaliseTerm(term);
  if (!clean) throw new Error("aggregation: cannot build a regex for an empty term");
  const core = countStemVariants
    ? `${escapeRegex(stemOf(clean))}${STEM_VARIANT_ALTERNATION}`
    : escapeRegex(clean);
  return new RegExp(`(?<![A-Za-z0-9])${core}(?![A-Za-z0-9])`, "gi");
}

/**
 * The BM25 query text for a count question (rule 2). With stem variants off
 * this is the bare term; on, it is the stem plus real-token suffixes.
 */
function expandAggregationQuery(term, { countStemVariants = false } = {}) {
  const clean = normaliseTerm(term);
  if (!countStemVariants) return clean;
  const stem = stemOf(clean);
  return [...new Set(EXPANSION_SUFFIXES.map((s) => `${stem}${s}`))].join(" ");
}

function parseMetadata(chunk) {
  if (chunk && typeof chunk.metadata === "object" && chunk.metadata) return chunk.metadata;
  try {
    const parsed = JSON.parse((chunk && chunk.metadata) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** A VLM caption chunk: text the captioner wrote, not the document's text. */
function isCaptionChunk(chunk) {
  if (!chunk) return false;
  if (chunk.isVisualElement === true) return true;
  return parseMetadata(chunk).isVisualElement === true;
}

/**
 * A page is a location only when it is a positive integer and the source is
 * not known to be a single-page stamp (citations.js's rule; F-11/F-30).
 */
function locatedPage(chunk, paginationFacts) {
  const source = chunk && chunk.source;
  if (paginationFacts && source && paginationFacts[source] === false) return null;
  const p = Number(chunk && chunk.page);
  return Number.isInteger(p) && p > 0 ? p : null;
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function sectionFor(chunk, meta) {
  const number = asString(chunk && chunk.sectionNumber).trim();
  const title = asString(chunk && chunk.sectionTitle).trim();
  if (number && title && title !== number) return `${number} ${title}`;
  return number || title || asString(meta.section_title).trim() || asString(meta.section).trim() || "N/A";
}

/** Length of the longest suffix of `a` that is a prefix of `b` (the chunker's overlap copy). */
function longestSuffixPrefix(a, b, cap = MAX_OVERLAP_CHARS) {
  const max = Math.min(a.length, b.length, cap);
  for (let k = max; k > 0; k--) {
    if (a.endsWith(b.slice(0, k))) return k;
  }
  return 0;
}

/**
 * For every text chunk, how many leading characters are an overlap copy of
 * another chunk on the same source and page. Groups are small (a page has a
 * handful of chunks), so the pairwise scan is cheap.
 */
function overlapHeads(rows, texts, groupKeys) {
  const heads = new Array(rows.length).fill(0);
  const groups = new Map();
  rows.forEach((_, i) => {
    if (texts[i] === null) return;
    if (!groups.has(groupKeys[i])) groups.set(groupKeys[i], []);
    groups.get(groupKeys[i]).push(i);
  });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const b of members) {
      for (const a of members) {
        if (a === b) continue;
        const k = longestSuffixPrefix(texts[a], texts[b]);
        if (k > heads[b]) heads[b] = k;
      }
    }
  }
  return heads;
}

/**
 * Count occurrences of `term` across `chunks`.
 *
 * Text chunks contribute to `occurrences`; caption chunks contribute to
 * `occurrencesInCaptions` only (rule 3). Overlap copies are collapsed across
 * chunks by (source, page, context window) — rule 4. Each counted line is
 * kept as evidence with its hit count, so a line holding three matches
 * renders once as "×3" rather than three times.
 */
function countTermOccurrences(chunks, term, { countStemVariants = false, paginationFacts = null } = {}) {
  const clean = normaliseTerm(term);
  const regex = buildTermRegex(clean, { countStemVariants });
  const rows = Array.isArray(chunks) ? chunks : [];

  const perDocument = new Map();
  const lines = [];
  let occurrences = 0;
  let occurrencesInCaptions = 0;
  let textChunksScanned = 0;
  let captionChunksScanned = 0;

  // Pass 1: classify, and find each text chunk's overlap head (rule 4).
  const texts = rows.map((chunk) =>
    isCaptionChunk(chunk) ? null : (chunk && typeof chunk.text === "string" ? chunk.text : "") || ""
  );
  const groupKeys = rows.map((chunk) => {
    const page = locatedPage(chunk, paginationFacts);
    return `${(chunk && chunk.source) || "Unknown Document"}::${page === null ? `${chunk && chunk.page}` : `p${page}`}`;
  });
  const heads = overlapHeads(rows, texts, groupKeys);

  rows.forEach((chunk, chunkIndex) => {
    const source = (chunk && chunk.source) || "Unknown Document";
    if (!perDocument.has(source)) {
      perDocument.set(source, {
        source,
        occurrences: 0,
        occurrencesInCaptions: 0,
        chunksScanned: 0,
        textChunksScanned: 0,
        captionChunksScanned: 0,
      });
    }
    const doc = perDocument.get(source);
    doc.chunksScanned += 1;
    const page = locatedPage(chunk, paginationFacts);

    if (texts[chunkIndex] === null) {
      captionChunksScanned += 1;
      doc.captionChunksScanned += 1;
      const hits = (((chunk && chunk.text) || "").match(regex) || []).length;
      occurrencesInCaptions += hits;
      doc.occurrencesInCaptions += hits;
      return;
    }

    const text = texts[chunkIndex];
    const skipBefore = heads[chunkIndex];
    textChunksScanned += 1;
    doc.textChunksScanned += 1;
    const meta = parseMetadata(chunk);
    const section = sectionFor(chunk, meta);

    // Walk the chunk line by line, match by match, so a match inside the
    // overlap head (an exact copy of another chunk's tail) can be skipped
    // even when the copy starts mid-line.
    let offset = 0;
    for (const rawLine of text.split("\n")) {
      const lineStart = offset;
      offset += rawLine.length + 1;
      const line = rawLine.trim();
      if (!line) continue;
      let hits = 0;
      regex.lastIndex = 0;
      let m;
      while ((m = regex.exec(rawLine)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex += 1;
          continue;
        }
        if (lineStart + m.index < skipBefore) continue; // overlap copy of another chunk's tail
        hits += 1;
      }
      if (hits === 0) continue;
      occurrences += hits;
      doc.occurrences += hits;
      lines.push({
        source,
        page,
        section,
        startLine: meta.startLine,
        endLine: meta.endLine,
        hits,
        text: line,
      });
    }
  });

  return {
    term: clean,
    rule: countStemVariants ? RULE_STEM : RULE_EXACT,
    countStemVariants,
    occurrences,
    occurrencesInCaptions,
    chunksScanned: rows.length,
    textChunksScanned,
    captionChunksScanned,
    perDocument: [...perDocument.values()],
    lines,
  };
}

/**
 * What the scan actually covered — three measured numbers, never inferred:
 *
 *   candidatesReturned  rows BM25 returned to the route (T13 report) — X
 *   poolSize            the `limit` the route handed the store — P
 *   collectionChunks    objects in the collection (countObjects) — M
 *   summaryRows         per-source {source, chunkCount} (getDatabaseSummary)
 *
 * and one the count itself measured: chunksScanned — N.
 *
 * `scanComplete` is true only when the evidence proves every matching chunk
 * was read: every returned row reached the counter (N ≥ X) AND either BM25
 * returned fewer rows than it was allowed to (X < P) or the whole collection
 * fits inside the pool (M ≤ P). It is false when the pool filled and the
 * collection is known to be larger, or when rows were returned that the
 * counter never saw (a slice between the store and the count — E18's
 * mechanism). It is null — never true — when the numbers needed to decide are
 * unavailable. A total is never fabricated.
 */
function buildScanDisclosure({
  count,
  candidatesReturned = null,
  poolSize = null,
  scanLimit = null,
  collectionChunks = null,
  summaryRows = [],
} = {}) {
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const X = isNum(candidatesReturned) ? candidatesReturned : null;
  const P = isNum(poolSize) ? poolSize : null;
  const M = isNum(collectionChunks) ? collectionChunks : null;
  const N = count && isNum(count.chunksScanned) ? count.chunksScanned : 0;

  let scanComplete = null;
  let capReason = null;
  if (X !== null && N < X) {
    scanComplete = false;
    capReason = "sliced";
  } else if (X !== null && P !== null && X < P) {
    scanComplete = true;
  } else if (X !== null && M !== null && P !== null && M <= P) {
    scanComplete = true;
  } else if (X !== null && P !== null && X >= P && M !== null && M > P) {
    scanComplete = false;
    capReason = "limit";
  }

  const totals = new Map();
  for (const row of Array.isArray(summaryRows) ? summaryRows : []) {
    if (row && typeof row.source === "string" && isNum(row.chunkCount) && row.chunkCount > 0) {
      totals.set(row.source, row.chunkCount);
    }
  }

  const perDocument = (count && Array.isArray(count.perDocument) ? count.perDocument : []).map((d) => ({
    source: d.source,
    occurrences: d.occurrences,
    occurrencesInCaptions: d.occurrencesInCaptions,
    chunksScanned: d.chunksScanned,
    chunksTotal: totals.has(d.source) ? totals.get(d.source) : null,
  }));

  const limit = isNum(scanLimit) ? scanLimit : P;
  let coverage;
  if (uncappedClaimAllowed({ scanComplete })) {
    coverage = X === 1 ? `complete scan: the 1 matching chunk was read` : `complete scan: all ${X} matching chunks were read`;
  } else if (scanComplete === false && capReason === "sliced") {
    coverage =
      `capped scan: the store matched ${X} chunks but only ${N} reached the counter, ` +
      `so the count is a lower bound`;
  } else if (scanComplete === false) {
    coverage =
      `capped scan: ${N} chunks were read, the scan limit of ${limit} was reached, ` +
      `and the collection holds ${M} chunks, so further matches may exist and the count is a lower bound`;
  } else {
    coverage =
      `scan coverage unknown: ${N} chunks were read, and it could not be determined whether ` +
      `further matches exist, so the count may be incomplete`;
  }

  return {
    scanComplete,
    capApplied: scanComplete === false,
    scanLimit: limit,
    poolSize: P,
    chunksScanned: N,
    chunksMatched: X,
    collectionChunks: M,
    perDocument,
    coverage,
  };
}

/** The words "uncapped" / "complete" / "all matching" are permitted only here. */
function uncappedClaimAllowed(disclosure) {
  return Boolean(disclosure) && disclosure.scanComplete === true;
}

/** One honest sentence per document, for the prompt. */
function perDocumentSentence(row, disclosure) {
  if (row.chunksTotal === null) {
    return `${row.source}: ${row.chunksScanned} matching chunks were read; its total chunk count could not be determined`;
  }
  if (uncappedClaimAllowed(disclosure)) {
    return `${row.source}: ${row.chunksScanned} of its ${row.chunksTotal} chunks matched the term and ${row.chunksScanned === 1 ? "it was" : `all ${row.chunksScanned} were`} read`;
  }
  return `${row.source}: ${row.chunksScanned} of its ${row.chunksTotal} chunks were read (scan not complete; more may match)`;
}

/**
 * The pre-retrieval trace span text: the PLAN, stated so that nothing in it
 * depends on what has not happened yet.
 */
function describeScanPlan({ term, scanLimit, countStemVariants, queryText }) {
  return {
    description:
      `Detected frequency count request for term "${term}". Keyword scan of up to ${scanLimit} matching ` +
      `chunks, reranker off, stem variants ${countStemVariants ? "on" : "off"}.`,
    details: {
      targetKeyword: term,
      strategy: `Keyword scan, capped at ${scanLimit} chunks`,
      scanLimit,
      countStemVariants,
      queryText,
      countRule: countStemVariants ? RULE_STEM : RULE_EXACT,
    },
  };
}

/** The measured facts for the post-count trace span (T09 D6). */
function buildScanResultFacts(count, disclosure) {
  return {
    targetKeyword: count.term,
    countRule: count.rule,
    countStemVariants: count.countStemVariants,
    occurrences: count.occurrences,
    occurrencesInCaptions: count.occurrencesInCaptions,
    chunksScanned: count.chunksScanned,
    textChunksScanned: count.textChunksScanned,
    captionChunksScanned: count.captionChunksScanned,
    chunksMatched: disclosure.chunksMatched,
    collectionChunks: disclosure.collectionChunks,
    scanLimit: disclosure.scanLimit,
    scanComplete: disclosure.scanComplete,
    capApplied: disclosure.capApplied,
    perDocument: disclosure.perDocument,
    coverage: disclosure.coverage,
  };
}

/**
 * The post-count trace span — the mirror of describeScanPlan. Badge
 * vocabulary lives here, not in the disclosure data.
 */
function describeScanResult(count, disclosure) {
  const facts = buildScanResultFacts(count, disclosure);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const badge = uncappedClaimAllowed(disclosure)
    ? "COMPLETE SCAN"
    : disclosure.scanComplete === false
      ? `CAPPED SCAN: ${count.chunksScanned} CHUNKS READ, MORE MAY MATCH`
      : "SCAN COVERAGE UNKNOWN";
  return {
    title: `Term Frequency Scan Result ("${count.term}")`,
    description:
      `Found ${plural(count.occurrences, "occurrence")} in document text (${count.rule}); ${disclosure.coverage}.` +
      (count.occurrencesInCaptions > 0
        ? ` Not counted: ${count.occurrencesInCaptions} in image-description chunks.`
        : ""),
    badge,
    badgeType: uncappedClaimAllowed(disclosure) ? "teal" : "amber",
    details: facts,
  };
}

/**
 * The prompt block. Totals first (the answer), coverage second (the honesty),
 * evidence last and bounded (the model quotes pages from it; it never counts
 * from it). Rendered for every count turn, including a count of zero — a
 * zero the server computed is an answer; raw chunks and no number is E18.
 */
function renderAggregationBlock(count, disclosure, { evidenceLines = 80 } = {}) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const docCount = count.perDocument.filter((d) => d.occurrences > 0).length;
  let out =
    `[Term Frequency Scan: "${count.term}" — ${plural(count.occurrences, "occurrence")} ` +
    `in the document text (${count.rule}) across ${plural(docCount, "document")}]\n`;
  out += `Scan coverage: ${disclosure.coverage}.\n`;
  if (disclosure.perDocument.length > 0) {
    out += `Per document: ${disclosure.perDocument.map((row) => perDocumentSentence(row, disclosure)).join(" | ")}.\n`;
  }
  if (count.occurrencesInCaptions > 0) {
    out +=
      `Not counted: ${plural(count.occurrencesInCaptions, "further occurrence")} in image-description chunks ` +
      `(AI-generated captions of figures, including their header lines), which are not the document's own text.\n`;
  }

  const limit = Number.isFinite(evidenceLines) && evidenceLines >= 0 ? evidenceLines : 80;
  const ordered = [...count.lines].sort(
    (a, b) => a.source.localeCompare(b.source) || (a.page || 0) - (b.page || 0)
  );
  const shown = ordered.slice(0, limit);
  const truncated = shown.length < count.lines.length;

  out +=
    `INSTRUCTIONS: the computed count above (${count.occurrences}) is authoritative — open your answer with it and report it verbatim. ` +
    (truncated
      ? `Do NOT re-count from the evidence lines below: they are a sample of ${shown.length} of ${count.lines.length}, not the full set. `
      : `Do NOT re-count from the evidence lines below, even though they are the complete set; the number above already accounts for every match. `) +
    (uncappedClaimAllowed(disclosure)
      ? `The scan was complete. `
      : disclosure.scanComplete === false
        ? `The scan was capped, so state that ${count.occurrences} is a lower bound. `
        : `Scan completeness could not be determined, so say the count may be incomplete. `) +
    (count.occurrencesInCaptions > 0
      ? `State separately that ${plural(count.occurrencesInCaptions, "further occurrence")} appear in image-description chunks and are NOT included in the count of ${count.occurrences}.`
      : "") +
    `\n\n`;

  const byDoc = new Map();
  for (const line of shown) {
    if (!byDoc.has(line.source)) byDoc.set(line.source, []);
    byDoc.get(line.source).push(line);
  }
  for (const doc of count.perDocument) {
    if (doc.occurrences === 0) continue;
    const coverageRow = disclosure.perDocument.find((d) => d.source === doc.source);
    out += `### Document: ${doc.source} — ${plural(doc.occurrences, "occurrence")}` +
      (coverageRow ? ` (${perDocumentSentence(coverageRow, disclosure).replace(`${doc.source}: `, "")})` : "") +
      `\n`;
    for (const line of byDoc.get(doc.source) || []) {
      const where = [];
      if (line.page !== null) where.push(`Page: ${line.page}`);
      where.push(`Section: ${line.section}`);
      if (line.startLine && line.endLine) where.push(`Lines: ${line.startLine}-${line.endLine}`);
      out += `- [${where.join(", ")}]${line.hits > 1 ? ` ×${line.hits}` : ""}: "${line.text}"\n`;
    }
    out += `\n`;
  }
  out += `(showing ${shown.length} of ${count.lines.length} occurrence lines)\n\n`;
  return out;
}

/**
 * The prompt block when the count itself could not be computed (a throw after
 * the commit point). Retrieval succeeded, so denying content would be a
 * fabrication; counting from raw chunks would be E18. Say neither.
 */
function renderAggregationFailureBlock(term, message) {
  return (
    `[Term Frequency Scan FAILED for "${term}"]\n` +
    `The passages were retrieved but the occurrence count could not be computed (${message}).\n` +
    `INSTRUCTIONS: tell the user the count could not be computed and suggest retrying. ` +
    `Do NOT estimate or count occurrences yourself, and do NOT claim the documents lack the term.\n\n`
  );
}

module.exports = {
  RULE_EXACT,
  RULE_STEM,
  normaliseTerm,
  buildTermRegex,
  expandAggregationQuery,
  isCaptionChunk,
  locatedPage,
  countTermOccurrences,
  buildScanDisclosure,
  uncappedClaimAllowed,
  describeScanPlan,
  describeScanResult,
  buildScanResultFacts,
  renderAggregationBlock,
  renderAggregationFailureBlock,
};
