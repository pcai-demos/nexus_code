/**
 * Citation contract — ticket T14 (FM-N7 / E32).
 *
 * Three jobs, all pure (no I/O, no app state, total on any input):
 *
 *  1. buildNumberedContext — format retrieved chunks as numbered [S#] blocks
 *     and, in the same iteration, build the marker→chunk mapping. Numbering
 *     and mapping cannot drift because they are the same loop.
 *  2. extractCitations / findPageClaims — parse an answer for [S#] markers and
 *     prose page mentions.
 *  3. auditAnswer — judge what the answer claims against what was retrieved:
 *     a marker outside the context and a page mention matching no retrieved
 *     chunk's page are fabrications and land in `uncitedClaims`; a page
 *     mention that matches a retrieved page is supported and is not an
 *     offence (ticket text: only mentions "not matching a retrieved chunk's
 *     page" are flagged).
 *
 * Pagination honesty (F-11 / F-30): page attribution rides on every citation
 * as `pageAttribution: "paginated" | "singlePage" | "unknown"`, taken from the
 * per-file `paginated` fact the parser reports (process-observed, T13). A
 * `singlePage` file's chunks are never presented under a page number — the
 * synthesized "page 1" of a .docx is not a location. When this process
 * observed no ingest for a file the attribution is "unknown" and the stored
 * page is shown as stored: claiming "synthetic" without evidence would be a
 * fabrication of its own. Persisting the fact per chunk is T05's (F-30).
 *
 * This module is used by the orchestrator (runtime contract) and by
 * tests/eval/run_citations.js (the metric instrument) — one extractor, so the
 * measurement can never disagree with the product about what a claim is.
 */

/** Longest answer we will scan; beyond this the tail is ignored, not thrown on. */
const MAX_SCAN_CHARS = 1_000_000;

/** Bracket groups no longer than this are candidate marker lists ("S1, S2"). */
const MAX_MARKER_GROUP_CHARS = 64;

const MARKER_GROUP_RE = /\[([^\]\n]{1,64})\]/g;
/**
 * A bracket group is a marker list when it contains at least one S-number and
 * nothing else but separators: commas, "and", "&", hyphen/en-dash ranges.
 * "[S1]", "[S1, S3]", "[S1 and S2]", "[S1, S2, and S3]", "[S1-S3]" all parse;
 * "[Source 1]" and prose brackets do not. A model faithfully QUOTING a
 * document that itself contains "[S9]"-shaped text is indistinguishable from
 * citing — accepted limitation, no such pattern exists in the corpus.
 */
const MARKER_TOKEN_RE = /s\s*(\d{1,4})/gi;
const MARKER_SEPARATORS_RE = /^[\s,&\-–]*(?:and[\s,&\-–]*)*$/i;

/**
 * Prose page mentions: the word page/pages (optionally dotted), or the dotted
 * abbreviations p. / pp. Never bare "pN" (product codes: "P1", "B4"), never
 * "pg"/"pgs" (Performance-Grade asphalt notation "PG 64-22" is standard in
 * this corpus's domain), never "p." straight after an initial ("J.P. 500"),
 * and never a "Total pages:" inventory figure (the doc-store summary above
 * the context states per-file totals; echoing one is not a location claim).
 * Ranges ("pages 3-5") yield the first number only; U-CITE pins each choice.
 */
const PAGE_CLAIM_RE = /(?:\b(?<!total\s)(?:pages?)\.?|(?<![\w.])pp?\.)\s*:?\s*(\d{1,4})\b/gi;

function asString(value) {
  return typeof value === "string" ? value : "";
}

function parseMetadata(chunk) {
  try {
    const parsed = JSON.parse(chunk.metadata || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function sectionPathFor(chunk, meta) {
  const number = asString(chunk.sectionNumber).trim();
  const title = asString(chunk.sectionTitle).trim();
  if (number && title && title !== number) return `${number} ${title}`;
  return number || title || asString(meta.section_title).trim() || asString(meta.section).trim() || null;
}

function attributionFor(source, paginationFacts) {
  const fact = paginationFacts ? paginationFacts[source] : undefined;
  if (fact === false) return "singlePage";
  if (fact === true) return "paginated";
  return "unknown";
}

/**
 * A page is a location only when it is a positive number. Ingestion stores
 * unparseable pages as 0 (weaviate.js `parseInt || 0`), and the old
 * formatter's `page || 1` rewrote that to a fabricated "Page: 1" — which the
 * audit would then flag as uncited because the reference set carries the raw
 * stored value. A non-positive page renders as unlocated, exactly like a
 * known-synthetic one.
 */
function locatedPage(chunk) {
  const p = Number(chunk.page);
  return Number.isInteger(p) && p > 0 ? p : null;
}

/** T34 (design D5): a `.pptx` docling paginates by slide — its page IS the slide, and the header and the chip say so. */
function isSlideDeck(chunk) {
  return /^pptx$/i.test(asString(chunk && chunk.fileType).trim());
}

/**
 * T34 (design D7): what locates a block — `page` (a paginated file's page), `slide` (a pptx's page), `section` (an
 * unpaginated file's heading path, or any block with no page but a section), `none` (nothing to point at).
 */
function locationKindFor(page, section, chunk) {
  if (page !== null) return isSlideDeck(chunk) ? "slide" : "page";
  return section ? "section" : "none";
}

function headerFor(marker, chunk, meta, attribution, companion) {
  const parts = [`Document: ${chunk.source || "Unknown Document"}`];
  // A singlePage file's "page 1" is a synthesized stamp, not a location —
  // the header carries the section anchor instead (F-11). A missing/zero
  // stored page is equally not a location. A slide deck's page is its slide (T34).
  const page = attribution === "singlePage" ? null : locatedPage(chunk);
  if (page !== null) parts.push(`${isSlideDeck(chunk) ? "Slide" : "Page"}: ${page}`);
  const section = sectionPathFor(chunk, meta);
  parts.push(`Section: ${section || "N/A"}`);
  if (meta.startLine && meta.endLine) parts.push(`Lines: ${meta.startLine}-${meta.endLine}`);
  // T35 (design D6): a chunk whose text OCR read says so — the model and a reader of the prompt know the words were
  // read from an image at ingest; the chip is unchanged (a page number is a page number).
  if (meta.textSource === "ocr") parts.push("Text: OCR");
  // T28: a companion block says why it is here and which block it belongs
  // with, so the model (and a reader of the prompt) can tell adjacency from
  // ranking.
  if (companion) {
    parts.push(`Companion: ${companion.reason}${companion.ofMarker ? ` — belongs with [${companion.ofMarker}]` : ""}`);
  }
  return `[${marker}] (${parts.join(", ")})`;
}

/**
 * T28: the companion annotation of a chunk, if the orchestrator attached one
 * (`{ anchor, kind, reason }` — `anchor` is the kept chunk object it follows;
 * its marker is looked up in the same numbering loop). Total on junk.
 */
function companionOf(chunk, markerByChunk) {
  const c = chunk && chunk.companion;
  if (!c || typeof c !== "object") return null;
  const kind = c.kind === "text" ? "text" : "caption";
  const reason = asString(c.reason).trim() || (kind === "caption" ? "figure caption on the same page" : "page text for the retrieved figure");
  const ofMarker = c.anchor && markerByChunk.has(c.anchor) ? markerByChunk.get(c.anchor) : null;
  return { kind, reason, ofMarker };
}

/**
 * Number the chunks the model will see and build the marker mapping.
 *
 * specChunks and legendChunks arrive already selected/ordered by the
 * orchestrator (its intent logic is unchanged); this function owns only
 * formatting and numbering. Legend chunks are numbered individually under
 * their heading — the pre-T14 merged join lost per-chunk attribution.
 *
 * T48 (t48-design §2.1): `textFor(chunk, marker)` may supply a block's text —
 * the computed context notes a chain block gains — in the same loop that
 * numbers it; without it (or when it throws or returns a non-string) the
 * block is the chunk's own text, byte for byte. The header, the numbering
 * and the mapping never depend on it.
 */
function buildNumberedContext({ specChunks, legendChunks, paginationFacts, textFor } = {}) {
  const spec = Array.isArray(specChunks) ? specChunks : [];
  const legend = Array.isArray(legendChunks) ? legendChunks : [];
  const contextMap = [];
  // T28: the marker of every chunk numbered so far, by object identity, so a
  // companion can name the block it belongs with.
  const markerByChunk = new Map();

  const renderBlock = (chunk) => {
    const meta = parseMetadata(chunk);
    const attribution = attributionFor(chunk.source, paginationFacts);
    const marker = `S${contextMap.length + 1}`;
    const companion = companionOf(chunk, markerByChunk);
    const page = attribution === "singlePage" ? null : locatedPage(chunk);
    const sectionPath = sectionPathFor(chunk, meta);
    contextMap.push({
      marker,
      source: chunk.source || null,
      page,
      sectionPath,
      imagePath: chunk.imagePath || meta.imagePath || null,
      // T49 (design D3 a; F-178): the stored title of a visual chunk (the
      // parser's own parse of the caption's TITLE line, T18 D6 —
      // `meta.humanTitle`) rides on the citation so the page can name the
      // figure on a whole-page render; null on a chunk without one. The
      // prompt's header (headerFor) does not carry it — no prompt byte moves.
      title: asString(meta.humanTitle).trim() || null,
      pageAttribution: attribution,
      // T34 (design D7): what the chip points at — page | slide | section | none.
      locationKind: locationKindFor(page, sectionPath, chunk),
      // T28: present only on a companion block — a ranked block carries
      // neither field, so the chips can tell them apart (design D6).
      ...(companion ? { companionOf: companion.ofMarker, companionKind: companion.kind } : {}),
    });
    if (chunk && typeof chunk === "object") markerByChunk.set(chunk, marker);
    return `${headerFor(marker, chunk, meta, attribution, companion)}\n${blockText(chunk, marker)}`;
  };
  const blockText = (chunk, marker) => {
    const own = chunk.text || "";
    if (typeof textFor !== "function") return own;
    try {
      const supplied = textFor(chunk, marker);
      return typeof supplied === "string" ? supplied : own;
    } catch (e) {
      return own;
    }
  };

  const specText = spec.map(renderBlock).join("\n\n---\n\n");

  let legendText = "";
  if (legend.length > 0) {
    legendText =
      `\n\n[Document Master Index / Site Plan Map Legend (Page 1 Overview)]\n` +
      legend.map(renderBlock).join("\n\n");
  }

  const contextText = `[Retrieved Specification Sheets & Passages — numbered context blocks]\n${specText}${legendText}\n\n`;
  return { contextText, contextMap };
}

/** Longest [S1-Sn] range a single group may expand to (sanity bound). */
const MAX_RANGE_SPAN = 50;

/** All [S#]-shaped marker references in the answer, in order of appearance. */
function findMarkerReferences(answer) {
  const text = asString(answer).slice(0, MAX_SCAN_CHARS);
  const refs = [];
  let group;
  MARKER_GROUP_RE.lastIndex = 0;
  while ((group = MARKER_GROUP_RE.exec(text)) !== null) {
    const inner = group[1];
    if (inner.length > MAX_MARKER_GROUP_CHARS) continue;

    // Expand "S1-S3" ranges first, then collect remaining single tokens; the
    // group counts as a marker list only if stripping every S-token leaves
    // pure separators (so "[Source 1]" and prose brackets never parse).
    const groupRefs = [];
    let rest = inner.replace(/s\s*(\d{1,4})\s*[-–]\s*s?\s*(\d{1,4})/gi, (m, a, b) => {
      const from = Number(a);
      const to = Number(b);
      if (to >= from && to - from <= MAX_RANGE_SPAN) {
        for (let n = from; n <= to; n++) groupRefs.push(n);
        return " ";
      }
      return m;
    });
    rest = rest.replace(MARKER_TOKEN_RE, (m, n) => {
      groupRefs.push(Number(n));
      return " ";
    });
    if (groupRefs.length === 0 || !MARKER_SEPARATORS_RE.test(rest)) continue;
    refs.push(...groupRefs);
  }
  return refs;
}

/** All prose page mentions: [{page, excerpt}]. */
function findPageClaims(answer) {
  const text = asString(answer).slice(0, MAX_SCAN_CHARS);
  const claims = [];
  let m;
  PAGE_CLAIM_RE.lastIndex = 0;
  while ((m = PAGE_CLAIM_RE.exec(text)) !== null) {
    claims.push({
      page: Number(m[1]),
      excerpt: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 10).replace(/\s+/g, " ").trim(),
    });
  }
  return claims;
}

/**
 * Map marker references onto the context. Returns resolved citations
 * (deduplicated, first-appearance order) and the invalid references.
 */
function extractCitations(answer, contextMap) {
  const map = Array.isArray(contextMap) ? contextMap : [];
  const citations = [];
  const seen = new Set();
  const invalidMarkers = [];
  const invalidSeen = new Set();

  for (const num of findMarkerReferences(answer)) {
    const entry = map[num - 1];
    if (entry && num >= 1) {
      if (!seen.has(entry.marker)) {
        seen.add(entry.marker);
        citations.push({ ...entry });
      }
    } else if (!invalidSeen.has(num)) {
      invalidSeen.add(num);
      invalidMarkers.push(num);
    }
  }
  return { citations, invalidMarkers };
}

/**
 * The reference set a page claim is judged against: pages of the retrieved
 * chunks, MINUS pages contributed only by sources this process KNOWS carry
 * synthesized pagination (paginationFacts[source] === false — the F-11 .docx
 * stamp). A synthesized "page 1" must not silently support a prose claim the
 * header deliberately never showed. Unknown attribution keeps its pages —
 * claiming "synthetic" without evidence would be a fabrication of its own
 * (F-30; per-chunk truth is T05's).
 */
function buildReferencePages(chunks, paginationFacts) {
  const real = new Set();
  const synthetic = new Set();
  for (const c of Array.isArray(chunks) ? chunks : []) {
    const page = Number(c && c.page);
    if (!Number.isFinite(page)) continue;
    const fact = paginationFacts ? paginationFacts[c.source] : undefined;
    (fact === false ? synthetic : real).add(page);
  }
  return [...real];
}

/**
 * Judge prose page claims against the pages actually retrieved. Deliberately
 * ticket-literal and lenient: a claim matches if its page number appears on
 * ANY retrieved chunk, regardless of source — stricter source+page pairing
 * would need prose-attribution heuristics and is a future tightening.
 */
function judgePageClaims(claims, referencePages) {
  const pages = new Set((Array.isArray(referencePages) ? referencePages : []).map(Number));
  const supported = [];
  const fabricated = [];
  for (const claim of Array.isArray(claims) ? claims : []) {
    (pages.has(claim.page) ? supported : fabricated).push(claim);
  }
  return { supported, fabricated };
}

/**
 * The full audit the orchestrator runs on a generated answer.
 *
 * `referencePages` are the pages of ALL retrieved chunks (ticket text), not
 * only the sliced context — a claim matching a retrieved-but-unshown page is
 * conservatively not flagged. Never throws.
 */
function auditAnswer({ answer, contextMap, referencePages } = {}) {
  const { citations, invalidMarkers } = extractCitations(answer, contextMap);
  const claims = findPageClaims(answer);
  const { fabricated } = judgePageClaims(claims, referencePages);

  const uncitedClaims = [];
  const blockCount = Array.isArray(contextMap) ? contextMap.length : 0;
  for (const num of invalidMarkers) {
    uncitedClaims.push(`cited context block [S${num}] does not exist (context has ${blockCount} block${blockCount === 1 ? "" : "s"})`);
  }
  const fabricatedByPage = new Map();
  for (const claim of fabricated) {
    if (!fabricatedByPage.has(claim.page)) fabricatedByPage.set(claim.page, { excerpt: claim.excerpt, count: 0 });
    fabricatedByPage.get(claim.page).count += 1;
  }
  for (const [page, info] of fabricatedByPage) {
    const times = info.count > 1 ? ` (×${info.count})` : "";
    uncitedClaims.push(`page ${page} is cited but matches no retrieved chunk${times}: "${info.excerpt}"`);
  }

  return { citations, uncitedClaims, pageClaimCount: claims.length };
}

module.exports = {
  locationKindFor,
  isSlideDeck,
  buildNumberedContext,
  buildReferencePages,
  extractCitations,
  findPageClaims,
  judgePageClaims,
  auditAnswer,
};
