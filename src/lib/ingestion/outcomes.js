/**
 * Per-file outcomes and the job status they add up to — ticket T07 (audit
 * E16 / FM-L3; findings F-49, F-52, F-61, F-63; T04's salvaged per-file
 * isolation).
 *
 * Before T07 a job was `completed | error | cancelled` and a file was a
 * `filesCompleted` increment: a skipped file, a file rejected by the
 * extension allow-list (E16), a file whose insert stopped at batch two and
 * a file that parsed to nothing all looked the same — "Chunks: 0", no
 * reason. Every input now gets one of these statuses, and the job's status
 * is DERIVED from them by `jobStatusFrom`, never set by whoever noticed a
 * problem last (F-52's `cancelled` overwritten with `error`).
 *
 * Pure: no I/O, no framework import. The ingest route mutates the entries it
 * created here; the status route serialises them; the ledger records the
 * terminal ones.
 */

// T46 (design D9, D16): the chain pass's counts — one list (dimension_chain.js, pure) for every surface they travel.
const { CHAIN_COUNT_KEYS } = require("./dimension_chain");

const FILE_STATUSES = Object.freeze([
  "pending", // not reached yet
  "parsing", // chunk() running
  "parsed", // chunked, waiting for its turn to embed and insert
  "indexing", // embedding / inserting
  "indexed", // every chunk inserted (and, under v2, the previous versions superseded or supersedeError set)
  "partial", // some chunks inserted, then a failure or a cancel
  "failed", // nothing of this file is in the store because of an error
  "skipped", // deliberately not indexed, with a reason
  "empty", // parsed to no chunks; previous versions left in place
  "cancelled", // the job was cancelled before this file was indexed
]);

const TERMINAL_FILE_STATUSES = Object.freeze(["indexed", "partial", "failed", "skipped", "empty", "cancelled"]);

const JOB_STATUSES = Object.freeze(["processing", "completed", "partial", "error", "cancelled"]);

/** Reasons a file is `skipped`; the ledger's file_skipped carries the same words. */
const SKIP_REASONS = Object.freeze({
  NOT_ALLOWED_TYPE: "not_allowed_type",
  ALREADY_INDEXED: "already_indexed",
  CANCELLED: "cancelled",
  // An earlier file's embed or insert failed in this job: the embedder or the
  // store is down, so the files after it are not attempted (review §6a) —
  // under v1 attempting them would delete their old chunks first and insert
  // nothing; under either version a hung embedder would cost 180 s per file.
  NOT_ATTEMPTED: "not_attempted_after_failure",
});

/**
 * T24 (design D4): why an INDEXED file is nevertheless `partial`. Every
 * chunk landed, but a figure's caption did not — a timeout, an HTTP error, a
 * thrown request or a missing crop — so the file is re-attempted on the
 * next `skip` ingest like any partial record, and the job says so.
 */
const PARTIAL_REASONS = Object.freeze({
  CAPTIONS_INCOMPLETE: "captions_incomplete",
});

/** Why a v2 file under `skip` was re-indexed rather than skipped (design D4). */
const REINDEX_REASONS = Object.freeze({
  NO_COMPLETION_RECORD: "no_completion_record",
  PARTIAL_RECORD: "partial_record",
  RECORD_INVALIDATED: "record_invalidated",
  STORE_MISMATCH: "store_mismatch",
  STORE_UNAVAILABLE: "store_unavailable",
});

function newFileResult({ filePath, fileName }) {
  return {
    filePath: typeof filePath === "string" ? filePath : null,
    fileName: typeof fileName === "string" ? fileName : null,
    sourceId: null,
    docVersion: null,
    engine: null,
    pages: null,
    status: "pending",
    reason: null,
    error: null,
    // T24: the figure counts travel with the file (the status frame's
    // fileResults) — null until the parse said; 0 is a measurement.
    // T29: the caption memo's share and the server requests made, likewise.
    // T31: the pages considered under the caption budget and the pages
    // beyond it (a count in counts, the budget and the page range beside).
    // T32 (design D9): the decorative and text-only verdicts, so the views'
    // suffix can say what the uncaptioned figures were.
    // T33 (design D7): the detail passes — the pages planned, the tiles
    // rendered, the requests made / recalled, the conflicts disclosed, the
    // pages whose pass failed, and (under auto) the visual pages that did
    // not qualify — with the pages and reasons named beside.
    // T41 (design D2, D7): the pieces folded under the minimum and a deck's hidden slides (null until the parse said).
    counts: { chunksEmitted: null, chunksInserted: 0, chunksDroppedMinSize: null, chunksMergedMinSize: null, slidesHidden: null, figuresCaptured: null, figuresCaptioned: null, figuresTimedOut: null, figuresFailed: null, figuresFromMemo: null, vlmCalls: null, figuresConsidered: null, figuresNotAttempted: null, figuresDecorative: null, figuresTextOnly: null, detailPages: null, detailTiles: null, detailCalls: null, detailFromMemo: null, detailConflicts: null, detailEdgeDropped: null, detailEdgeSettled: null, detailMultiValued: null, detailColourChecked: null, detailColourFlagged: null, detailColourSettled: null, detailColourAssociated: null, detailColourFailed: null, detailFailed: null, detailNotTaken: null, detailEmpty: null, captionSubstitutions: null, ...Object.fromEntries(CHAIN_COUNT_KEYS.map((k) => [k, null])), ocrNoText: null, ocrPages: null, ocrEmpty: null, ocrFailed: null, ocrChars: null, pageArtifactLines: null, pageArtifactKeys: null, pageArtifactPages: null, pageArtifactKeptFirst: null, pageArtifactPagesWithoutText: null },
    captionBudget: null,
    notAttemptedPages: null,
    detailMode: null,
    detailPagesList: null,
    detailReasons: null,
    detailFailedPages: null,
    detailEmptyPages: null,
    // T57 (design §2.4): the pages whose colour layer could not be read, named.
    detailColourFailedPages: null,
    // T46 (design D9, D16): the chain pass's pages named (admitted, failed, carrying the block) and the settled lines.
    chainPagesList: null,
    chainFailedPages: null,
    chainBlockPages: null,
    chainSettledList: null,
    // T35 (design D10): the OCR pass — the mode, the pages named, the engine, the wall time (null until the parse said).
    ocrMode: null,
    ocrNoTextPages: null,
    ocrPagesList: null,
    // T41 (design D7): the hidden slides, named (null until the parse said).
    hiddenSlidesList: null,
    ocrEmptyPages: null,
    ocrFailedPages: null,
    ocrEngine: null,
    ocrDurationMs: null,
    superseded: null,
    supersedeError: null,
    reindexReason: null,
    evidence: null,
  };
}

function isTerminalFileStatus(status) {
  return TERMINAL_FILE_STATUSES.includes(status);
}

/**
 * The figure suffix both ingest views render after an indexed or partial
 * file's status — T24 (design D13): ` · 30/36 figures (2 timed out, 0
 * failed)`; T29: `7 from memo`; T31 (design D7): `34 beyond the budget
 * (pages 51–84)`; T32 (design D9): `17 decorative, 12 text-only` — named
 * when > 0, so "64/84 figures" says what the other twenty were. One
 * function, so the two views cannot drift and the wording is unit-pinned;
 * "" when the parse counted no figures.
 */
function figureSuffix(f) {
  if (!f || (f.status !== "indexed" && f.status !== "partial") || !f.counts) return "";
  // T35 (design D10): the OCR part rides the same line, with or without a figure count (captioning off still OCRs).
  const ocr = ocrSuffix(f);
  // T41 (design D2, D7): the pieces folded under the minimum and a deck's hidden slides ride the same line.
  const fold = foldSuffix(f);
  if (!Number.isFinite(f.counts.figuresCaptured)) return `${fold}${ocr}`;
  const c = f.counts;
  const parts = [];
  if ((c.figuresTimedOut || 0) + (c.figuresFailed || 0) > 0) parts.push(`${c.figuresTimedOut || 0} timed out, ${c.figuresFailed || 0} failed`);
  if ((c.figuresDecorative || 0) > 0) parts.push(`${c.figuresDecorative} decorative`);
  if ((c.figuresTextOnly || 0) > 0) parts.push(`${c.figuresTextOnly} text-only`);
  if ((c.figuresFromMemo || 0) > 0) parts.push(`${c.figuresFromMemo} from memo`);
  // T47 (design §2.3): the labels the text layer reconciled, named only when there are any (a pre-T47 record reads as before).
  if ((c.captionSubstitutions || 0) > 0) parts.push(`${c.captionSubstitutions} label${c.captionSubstitutions === 1 ? "" : "s"} reconciled with the text layer`);
  if ((c.figuresNotAttempted || 0) > 0) parts.push(`${c.figuresNotAttempted} beyond the budget${typeof f.notAttemptedPages === "string" && f.notAttemptedPages ? ` (pages ${f.notAttemptedPages})` : ""}`);
  return ` · ${c.figuresCaptioned ?? 0}/${c.figuresCaptured} figures${parts.length ? ` (${parts.join(", ")})` : ""}${detailSuffix(f)}${chainSuffix(f)}${fold}${ocr}`;
}

/**
 * T46 (design D9, D16): the chain pass's part of the same line — the admitted pages (named), what the pass cost
 * (asked, from memo), the NO_DIMENSIONS verdicts, the lines the drawing's geometry settled, the captions carrying the
 * chain (named), a failed ask or geometry read. "" for a record without the counts (pre-T46) or no admitted page.
 */
function chainSuffix(f) {
  const c = f && f.counts ? f.counts : null;
  if (!c || !Number.isFinite(c.chainPages) || c.chainPages === 0) return "";
  const pages = (list) => (typeof list === "string" && list ? ` (p${list.replace(/, /g, ", p")})` : "");
  const parts = [`${c.chainCalls ?? 0} asked`, `${c.chainFromMemo ?? 0} from memo`];
  if ((c.chainNoDimensions || 0) > 0) parts.push(`${c.chainNoDimensions} with no dimension`);
  if ((c.chainSettled || 0) > 0) parts.push(`${c.chainSettled} line${c.chainSettled === 1 ? "" : "s"} settled by the drawing's geometry`);
  if ((c.chainBlocks || 0) > 0) parts.push(`${c.chainBlocks} caption${c.chainBlocks === 1 ? "" : "s"} carrying the chain${pages(f.chainBlockPages)}`);
  if ((c.chainFailed || 0) > 0) parts.push(`${c.chainFailed} failed${pages(f.chainFailedPages)}`);
  if ((c.chainGeometryFailed || 0) > 0) parts.push(`${c.chainGeometryFailed} geometry read${c.chainGeometryFailed === 1 ? "" : "s"} failed`);
  return ` · drawing chains: ${c.chainPages} page${c.chainPages === 1 ? "" : "s"}${pages(f.chainPagesList)} — ${parts.join(", ")}`;
}

/**
 * T41 (design D2, D7): the minimum-size folds and the hidden slides of the same line — "" for a record without the
 * counts (a pre-T41 record) or a document with nothing to say.
 */
function foldSuffix(f) {
  const c = f && f.counts ? f.counts : null;
  if (!c) return "";
  const parts = [];
  if (Number.isFinite(c.chunksMergedMinSize) && c.chunksMergedMinSize > 0) parts.push(`${c.chunksMergedMinSize} short piece${c.chunksMergedMinSize === 1 ? "" : "s"} folded into a neighbour`);
  // T18 (design D2, §2.6): the running lines removed, in the same line.
  if (Number.isFinite(c.pageArtifactLines) && c.pageArtifactLines > 0) parts.push(`${c.pageArtifactLines} running line${c.pageArtifactLines === 1 ? "" : "s"} removed (${c.pageArtifactKeys ?? "?"} key${c.pageArtifactKeys === 1 ? "" : "s"}${Number.isFinite(c.pageArtifactKeptFirst) && c.pageArtifactKeptFirst > 0 ? `, ${c.pageArtifactKeptFirst} kept once` : ""}${Number.isFinite(c.pageArtifactPagesWithoutText) && c.pageArtifactPagesWithoutText > 0 ? `, ${c.pageArtifactPagesWithoutText} page${c.pageArtifactPagesWithoutText === 1 ? "" : "s"} left without text` : ""})`);
  if (Number.isFinite(c.slidesHidden) && c.slidesHidden > 0) parts.push(`${c.slidesHidden} hidden slide${c.slidesHidden === 1 ? "" : "s"} skipped${typeof f.hiddenSlidesList === "string" && f.hiddenSlidesList ? ` (${f.hiddenSlidesList})` : ""}`);
  return parts.length ? ` · ${parts.join(", ")}` : "";
}

/**
 * T35 (design D10): the OCR pass's part of the same line — "" unless the document has a page WITHOUT a text layer;
 * then the pages OCR read (named, with the characters and the seconds), the pages read empty (named), the pages
 * whose pass failed (named) — or, under off, the pages left without text (named), so a presenter knows what the
 * setting cost. One function, so the two views cannot drift and the wording is unit-pinned.
 */
function ocrSuffix(f) {
  const c = f && f.counts;
  if (!c || !Number.isFinite(c.ocrNoText) || c.ocrNoText === 0) return "";
  const pages = (list) => (typeof list === "string" && list ? ` (p${list.replace(/, /g, ", p")})` : "");
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  if (f.ocrMode === "off") return ` · OCR off: ${n(c.ocrNoText, "page", "pages")} without a text layer left without text${pages(f.ocrNoTextPages)}`;
  const parts = [];
  if ((c.ocrPages || 0) > 0) parts.push(`${n(c.ocrPages, "page", "pages")} read${pages(f.ocrPagesList)} — ${(c.ocrChars || 0).toLocaleString("en-GB")} characters${Number.isFinite(f.ocrDurationMs) ? ` in ${(f.ocrDurationMs / 1000).toFixed(1)} s` : ""}`);
  if ((c.ocrEmpty || 0) > 0) parts.push(`${c.ocrEmpty} read empty${pages(f.ocrEmptyPages)}`);
  if ((c.ocrFailed || 0) > 0) parts.push(`${c.ocrFailed} failed${pages(f.ocrFailedPages)}`);
  return ` · OCR: ${n(c.ocrNoText, "page", "pages")} without a text layer — ${parts.join(", ") || "none read"}`;
}

/**
 * T33 (design D7, §12b): the detail passes' part of the same line — the
 * pages that got the closer look with the reason each fired for, what the
 * passes cost (tiles, requests, recalls), the conflicts disclosed, a failed
 * page named, and under `auto` how many visual pages did not qualify with
 * how to widen ("switch detail passes to all and re-ingest"). "" for a
 * record without the counts (a pre-T33 record) or a document with nothing
 * to say (no page fired, nothing left untiled).
 */
function detailSuffix(f) {
  const c = f && f.counts ? f.counts : null;
  if (!c || !Number.isFinite(c.detailPages)) return "";
  const notTaken = Number.isFinite(c.detailNotTaken) ? c.detailNotTaken : 0;
  const widen = f.detailMode === "auto" && notTaken > 0 ? `${notTaken} visual page${notTaken === 1 ? "" : "s"} not tiled under auto (switch detail passes to all and re-ingest for the closer look on every visual page)` : "";
  if (c.detailPages === 0) return widen ? ` · detail passes: ${widen}` : "";
  const reasons = Array.isArray(f.detailReasons) && f.detailReasons.length ? f.detailReasons.join(", ") : typeof f.detailPagesList === "string" && f.detailPagesList ? `pages ${f.detailPagesList}` : `${c.detailPages} page${c.detailPages === 1 ? "" : "s"}`;
  // T45 (design §2.3, D11): with the tile edge having settled any, the conflicts found, settled and disclosed; a
  // same-tile multi-value (F-188) named apart. A pre-T45 record (no such counts) reads as before.
  // T57 (design §2.4): the colour check's disclosures ride in detailConflicts; the tile conflicts found are the ones left,
  // plus those the tile edge or the page's colour settled. A record without the colour counts reads exactly as before.
  // T61 (design §2): the readings the three-cue settle wrote are named apart; the arithmetic above is unchanged (the
  // parser counts a disclosure it resolved out of the flagged ones, a disagreement it resolved into the settled ones).
  const settled = Number.isFinite(c.detailEdgeSettled) ? c.detailEdgeSettled : 0;
  const colourSettled = Number.isFinite(c.detailColourSettled) ? c.detailColourSettled : 0;
  const colourFlagged = Number.isFinite(c.detailColourFlagged) ? c.detailColourFlagged : 0;
  const colourAssociated = Number.isFinite(c.detailColourAssociated) ? c.detailColourAssociated : 0;
  const disclosed = c.detailConflicts ?? 0;
  const found = disclosed - colourFlagged + settled + colourSettled;
  const colourParts = [colourSettled > 0 ? `${colourSettled} settled by the page's colour` : null, colourFlagged > 0 ? `${colourFlagged} reading${colourFlagged === 1 ? "" : "s"} the page's colour contradicts` : null, colourAssociated > 0 ? `${colourAssociated} reading${colourAssociated === 1 ? "" : "s"} settled by three cues on the page` : null].filter(Boolean);
  const conflictPart = settled > 0 || colourParts.length ? `${found} conflict${found === 1 ? "" : "s"} found, ${[settled > 0 ? `${settled} settled by the tile edge` : null, ...colourParts].filter(Boolean).join(", ")}, ${disclosed} disclosed` : `${disclosed} conflict${disclosed === 1 ? "" : "s"}`;
  const cost = [`${c.detailTiles ?? 0} tiles`, `${c.detailCalls ?? 0} asked`, `${c.detailFromMemo ?? 0} from memo`, conflictPart];
  if ((c.detailMultiValued || 0) > 0) cost.push(`${c.detailMultiValued} multi-valued (one tile, two categories)`);
  if ((c.detailFailed || 0) > 0) cost.push(`${c.detailFailed} failed${typeof f.detailFailedPages === "string" && f.detailFailedPages ? ` (p${f.detailFailedPages.replace(/, /g, ", p")})` : ""}`);
  if ((c.detailColourFailed || 0) > 0) cost.push(`the colour layer not read on ${c.detailColourFailed} page${c.detailColourFailed === 1 ? "" : "s"}${typeof f.detailColourFailedPages === "string" && f.detailColourFailedPages ? ` (p${f.detailColourFailedPages.replace(/, /g, ", p")})` : ""}`);
  // T34 (F-142): a keyed page whose tiles held only the key's rows — no chunk, named.
  if ((c.detailEmpty || 0) > 0) cost.push(`${c.detailEmpty} keyed with an empty index, no chunk${typeof f.detailEmptyPages === "string" && f.detailEmptyPages ? ` (p${f.detailEmptyPages.replace(/, /g, ", p")})` : ""}`);
  return ` · detail passes: ${reasons} — ${cost.join(", ")}${widen ? `; ${widen}` : ""}`;
}

/** Per-status file counts and chunk totals. */
function fileCountsFrom(fileResults) {
  const list = Array.isArray(fileResults) ? fileResults : [];
  const counts = { total: list.length, indexed: 0, partial: 0, failed: 0, skipped: 0, empty: 0, cancelled: 0, pending: 0 };
  const chunks = { emitted: 0, inserted: 0 };
  for (const f of list) {
    if (counts[f.status] !== undefined && f.status !== "pending") counts[f.status] += 1;
    else counts.pending += 1;
    chunks.emitted += Number.isFinite(f.counts?.chunksEmitted) ? f.counts.chunksEmitted : 0;
    chunks.inserted += Number.isFinite(f.counts?.chunksInserted) ? f.counts.chunksInserted : 0;
  }
  return { files: counts, chunks };
}

/**
 * The job's status, derived (design D6):
 *   cancelled — the worker observed the cancel (a job-level throw after a
 *               cancel is still `cancelled`, F-52);
 *   error     — a job-level throw, or nothing in the store from this job:
 *               no file indexed, skipped or partial, and at least one failed
 *               (I-VERSION's dead-port step: one file, zero chunks landed);
 *   completed — every file indexed or skipped, no supersede refused;
 *   partial   — anything else: a partial file (its chunks ARE serving — the
 *               ticket's `chunksInserted < chunksEmitted`), a failed, empty
 *               or cancelled file beside usable ones, a refused supersede,
 *               a file that never reached a terminal status.
 */
/**
 * A file whose content is in the store: indexed, or skipped BECAUSE it was
 * already there. A file skipped because an earlier file's insert failed is
 * not (review §6a): counting it as usable made a dead embedder on a
 * five-file batch read `partial` — "4 of 5 indexed or skipped" — for a job
 * that put nothing in the store.
 */
function isUsable(f) {
  return f.status === "indexed" || (f.status === "skipped" && f.reason !== SKIP_REASONS.NOT_ATTEMPTED);
}

function jobStatusFrom(fileResults, { cancelled = false, jobError = null } = {}) {
  if (cancelled) return "cancelled";
  if (jobError) return "error";
  const list = Array.isArray(fileResults) ? fileResults : [];
  const usable = list.filter(isUsable).length;
  const inStore = list.filter((f) => f.status === "partial").length;
  const supersedeRefused = list.some((f) => f.supersedeError);
  if (usable === list.length && !supersedeRefused) return "completed";
  if (usable === 0 && inStore === 0 && list.some((f) => f.status === "failed")) return "error";
  return "partial";
}

/** The code that goes with a derived status; null for completed / cancelled. */
function jobErrorCodeFor(status, codes) {
  if (status === "error") return codes.INGEST_FAILED;
  if (status === "partial") return codes.INGEST_PARTIAL;
  return null;
}

/**
 * The job's `error` text for a derived status: for `error`, the first
 * failing file's own message with the file named (so I-VERSION's dead-port
 * step still reads the embedder's words); for `partial`, a short account of
 * what did not index.
 */
function jobErrorFrom(fileResults, status) {
  const list = Array.isArray(fileResults) ? fileResults : [];
  if (status === "error") {
    const first = list.find((f) => f.error);
    return first ? `${first.fileName || first.filePath}: ${first.error}` : "Ingestion failed.";
  }
  if (status === "partial") {
    const { files } = fileCountsFrom(list);
    const problems = list
      .filter((f) => !(isUsable(f) && !f.supersedeError))
      .map((f) => {
        const n = f.counts || {};
        const captionLoss = (n.figuresTimedOut || 0) + (n.figuresFailed || 0);
        const detail =
          f.status === "partial" && f.reason === PARTIAL_REASONS.CAPTIONS_INCOMPLETE && Number.isFinite(n.figuresCaptured)
            ? ` (${n.chunksInserted}/${n.chunksEmitted} chunks; ${captionLoss} of ${n.figuresCaptured} figure(s) not captioned)`
            : f.status === "partial" && Number.isFinite(n.chunksEmitted)
              ? ` (${n.chunksInserted}/${n.chunksEmitted} chunks)`
              : f.supersedeError
                ? " (previous versions not removed)"
                : "";
        const why = f.supersedeError || f.reason || f.error || "";
        const also = !f.supersedeError && f.reason && f.error ? ` (${f.error})` : "";
        return `${f.fileName || f.filePath} ${f.status}${detail}${why ? `: ${why}` : ""}${also}`;
      });
    const usable = list.filter(isUsable).length;
    const head = `${usable} of ${files.total} file(s) indexed or skipped`;
    return problems.length ? `${head}; ${problems.join("; ")}`.slice(0, 2000) : head;
  }
  return null;
}

module.exports = {
  FILE_STATUSES,
  TERMINAL_FILE_STATUSES,
  JOB_STATUSES,
  SKIP_REASONS,
  PARTIAL_REASONS,
  REINDEX_REASONS,
  newFileResult,
  isTerminalFileStatus,
  figureSuffix,
  ocrSuffix,
  detailSuffix,
  chainSuffix,
  isUsable,
  fileCountsFrom,
  jobStatusFrom,
  jobErrorCodeFor,
  jobErrorFrom,
};
