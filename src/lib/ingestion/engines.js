/**
 * Parser-engine vocabulary and span models — ticket T13 (audit E03).
 *
 * E03: parser.js ignored the engine the bridge reported and hardcoded
 * "IBM Docling (Layout AI & Table Transformer)" for every bridge success,
 * while docling_bridge.py handles every PDF with pypdfium2 (raw text
 * extraction, no layout model) and only falls through to docling when
 * pypdfium2 throws. The orchestrator then rebuilt the same false label a
 * second time — and, when no ingest had run in this process, SYNTHESIZED
 * per-file "IBM Docling (Layout AI)" entries from nothing but the file
 * extension (measured live, 2026-08-13: four pypdfium2-parsed PDFs, all
 * labelled docling, in a pod that had ingested nothing).
 *
 * This module is the single place engine identity is interpreted:
 *  - `normalizeEngine` maps whatever human label a trace carries onto a
 *    stable id, so badges are a lookup, not a string-match lottery;
 *  - `buildParserSpanModel` / `buildVlmSpanModel` turn the docling traces
 *    this process actually holds into the orchestrator's span content.
 *    They are pure so every engine state is pinned by a unit test (U-TRACE)
 *    rather than only reachable by ingesting the right file shape.
 *
 * The honesty rules the models implement:
 *  - an engine is reported only when this process OBSERVED it; documents
 *    indexed by an earlier pod get `engineId: "unknown"`, never a guess
 *    (ingest state is in-process and dies with the pod — E15);
 *  - a duration is reported only when it was measured; otherwise the span
 *    omits `durationMs` and says `durationSource: "unavailable"` — the same
 *    convention as T12's `telemetry.estimated`, never a fabricated literal.
 */

const ENGINE_IDS = Object.freeze({
  PYPDFIUM2: "pypdfium2",
  DOCLING: "docling",
  OFFICEPARSER: "officeparser",
  PDF_PARSE: "pdf-parse",
  UNKNOWN: "unknown",
});

/** Map a human engine label (from the bridge or a trace) to a stable id. */
// T46 (design D9, D16): the chain pass's counts — one list (dimension_chain.js, pure) for every surface they travel.
const { CHAIN_COUNT_KEYS } = require("./dimension_chain");

function normalizeEngine(engineLabel) {
  const s = String(engineLabel || "").toLowerCase();
  if (!s) return ENGINE_IDS.UNKNOWN;
  if (s.includes("pypdfium")) return ENGINE_IDS.PYPDFIUM2;
  if (s.includes("docling")) return ENGINE_IDS.DOCLING;
  if (s.includes("officeparser")) return ENGINE_IDS.OFFICEPARSER;
  if (s.includes("pdf-parse")) return ENGINE_IDS.PDF_PARSE;
  return ENGINE_IDS.UNKNOWN;
}

/**
 * Badge vocabulary. `badgeType` values map onto TracingDrawer's
 * getBadgeStyle(); "neutral" is not a named case there, so it renders the
 * default grey — deliberately, for the states that assert nothing.
 */
const ENGINE_BADGES = Object.freeze({
  [ENGINE_IDS.PYPDFIUM2]: Object.freeze({
    badge: "PYPDFIUM2 TEXT",
    badgeType: "amber",
    // The ticket's required wording, verbatim.
    description: "PyPDFium2 text extraction (no layout model)",
  }),
  [ENGINE_IDS.DOCLING]: Object.freeze({
    badge: "DOCLING LAYOUT AI",
    badgeType: "purple",
    description: "Docling layout parsing (layout model & table structure)",
  }),
  [ENGINE_IDS.OFFICEPARSER]: Object.freeze({
    badge: "OFFICEPARSER",
    badgeType: "blue",
    description: "Native OfficeParser text extraction (no layout model; page attribution unavailable)",
  }),
  [ENGINE_IDS.PDF_PARSE]: Object.freeze({
    badge: "PDF-PARSE SPATIAL",
    badgeType: "amber",
    description: "Spatial pdf-parse fallback (python bridge unavailable or failed)",
  }),
  [ENGINE_IDS.UNKNOWN]: Object.freeze({
    badge: "ENGINE UNKNOWN",
    badgeType: "neutral",
    description: "Parser engine not observed by this process",
  }),
});

function engineBadge(engineId) {
  return ENGINE_BADGES[engineId] || ENGINE_BADGES[ENGINE_IDS.UNKNOWN];
}

/** Sum the finite entries; null when there are none to sum. */
function sumMeasured(values) {
  const finite = (values || []).filter((n) => Number.isFinite(n));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0);
}

/**
 * The document-parser span, from what this process actually observed.
 *
 * @param {Array} doclingLogs  ingestionState.doclingTraces — one entry per file
 *                             ingested by THIS process (empty after a pod roll).
 * @param {Array} summary      WeaviateClient.getDatabaseSummary() rows —
 *                             {source, totalPages, chunkCount} for every
 *                             indexed document, however it got there.
 * @returns {{title, badge, badgeType, description, durationMs?, details}}
 *          durationMs is ABSENT (not null, not 0) when nothing was measured.
 */
function buildParserSpanModel(doclingLogs, summary, recordedFacts = []) {
  const logs = Array.isArray(doclingLogs) ? doclingLogs : [];
  const rows = Array.isArray(summary) ? summary : [];
  const facts = Array.isArray(recordedFacts) ? recordedFacts : [];

  // Real, observed per-file entries — carried through as recorded, plus a
  // normalized engineId so consumers stop re-deriving identity from strings.
  const observedByFile = new Map();
  const observedEntries = logs.map((l) => {
    const engineId = l.engineId || normalizeEngine(l.engine);
    const entry = { ...l, engineId };
    if (l.fileName) observedByFile.set(l.fileName, entry);
    return entry;
  });

  // T07 (F-30, design D10): facts RECORDED at ingest time in the ledger, for
  // documents this process did not parse. Only documents the store still
  // lists count — the store is the truth about what is indexed; the ledger
  // supplies the engine that built it. Marked `observed: "ledger"`, never
  // presented as this process's measurement.
  const indexedNames = new Set(rows.map((s) => s.source).filter(Boolean));
  const recordedByFile = new Map();
  for (const f of facts) {
    if (!f || !f.fileName || observedByFile.has(f.fileName) || !indexedNames.has(f.fileName)) continue;
    const row = rows.find((s) => s.source === f.fileName);
    recordedByFile.set(f.fileName, {
      fileName: f.fileName,
      engine: f.engine ?? null,
      engineId: f.engineId ? normalizeEngine(f.engineId) === ENGINE_IDS.UNKNOWN && f.engineId !== "unknown" ? f.engineId : normalizeEngine(f.engineId) : ENGINE_IDS.UNKNOWN,
      usedDocling: f.engineId ? normalizeEngine(f.engineId) === ENGINE_IDS.DOCLING : null,
      paginated: typeof f.paginated === "boolean" ? f.paginated : null,
      pageCount: Number.isFinite(f.pageCount) ? f.pageCount : row?.totalPages ?? null,
      chunkCount: row?.chunkCount ?? (Number.isFinite(f.chunkCount) ? f.chunkCount : null),
      parseDurationMs: Number.isFinite(f.parseDurationMs) ? f.parseDurationMs : null,
      vlmDurationMs: Number.isFinite(f.vlmDurationMs) ? f.vlmDurationMs : null,
      picturesCaptured: Number.isFinite(f.picturesCaptured) ? f.picturesCaptured : null,
      vlmCaptionsGenerated: Number.isFinite(f.vlmCaptionsGenerated) ? f.vlmCaptionsGenerated : null,
      vlmFromMemo: Number.isFinite(f.vlmFromMemo) ? f.vlmFromMemo : null,
      vlmCalls: Number.isFinite(f.vlmCalls) ? f.vlmCalls : null,
      vlmModel: f.vlmModel ?? null,
      // T33: the detail passes recorded for the document (null on a pre-T33 record).
      detailPages: Number.isFinite(f.detailPages) ? f.detailPages : null,
      detailTiles: Number.isFinite(f.detailTiles) ? f.detailTiles : null,
      detailCalls: Number.isFinite(f.detailCalls) ? f.detailCalls : null,
      detailFromMemo: Number.isFinite(f.detailFromMemo) ? f.detailFromMemo : null,
      detailConflicts: Number.isFinite(f.detailConflicts) ? f.detailConflicts : null,
      // T45: the tile-edge rule's counts recorded for the document (null on a pre-T45 record).
      detailEdgeDropped: Number.isFinite(f.detailEdgeDropped) ? f.detailEdgeDropped : null,
      detailEdgeSettled: Number.isFinite(f.detailEdgeSettled) ? f.detailEdgeSettled : null,
      detailMultiValued: Number.isFinite(f.detailMultiValued) ? f.detailMultiValued : null,
      // T57: the colour check's counts recorded for the document (null on a pre-T57 record).
      detailColourChecked: Number.isFinite(f.detailColourChecked) ? f.detailColourChecked : null,
      detailColourFlagged: Number.isFinite(f.detailColourFlagged) ? f.detailColourFlagged : null,
      detailColourSettled: Number.isFinite(f.detailColourSettled) ? f.detailColourSettled : null,
      detailColourAssociated: Number.isFinite(f.detailColourAssociated) ? f.detailColourAssociated : null,
      detailColourFailed: Number.isFinite(f.detailColourFailed) ? f.detailColourFailed : null,
      // T47: the caption labels reconciled with the text layer (null on a pre-T47 record).
      captionSubstitutions: Number.isFinite(f.captionSubstitutions) ? f.captionSubstitutions : null,
      detailFailed: Number.isFinite(f.detailFailed) ? f.detailFailed : null,
      detailPagesList: typeof f.detailPagesList === "string" ? f.detailPagesList : null,
      // T46: the chain pass recorded for the document (null on a pre-T46 record).
      ...Object.fromEntries(CHAIN_COUNT_KEYS.map((k) => [k, Number.isFinite(f[k]) ? f[k] : null])),
      chainPagesList: typeof f.chainPagesList === "string" ? f.chainPagesList : null,
      // T35: the OCR pass recorded for the document (null on a pre-T35 record).
      ocrMode: typeof f.ocrMode === "string" ? f.ocrMode : null,
      ocrNoText: Number.isFinite(f.ocrNoText) ? f.ocrNoText : null,
      ocrPages: Number.isFinite(f.ocrPages) ? f.ocrPages : null,
      ocrEmpty: Number.isFinite(f.ocrEmpty) ? f.ocrEmpty : null,
      ocrFailed: Number.isFinite(f.ocrFailed) ? f.ocrFailed : null,
      ocrChars: Number.isFinite(f.ocrChars) ? f.ocrChars : null,
      ocrPagesList: typeof f.ocrPagesList === "string" ? f.ocrPagesList : null,
      ocrEngine: typeof f.ocrEngine === "string" ? f.ocrEngine : null,
      recordedAt: f.recordedAt ?? null,
      observed: "ledger",
    });
  }
  const recordedEntries = [...recordedByFile.values()];

  // Indexed-but-unobserved documents: real facts only (name, pages, chunks
  // from Weaviate); the engine is UNKNOWN, never inferred from the extension.
  const unobservedEntries = rows
    .filter((s) => s.source && !observedByFile.has(s.source) && !recordedByFile.has(s.source))
    .map((s) => ({
      fileName: s.source,
      engine: null,
      engineId: ENGINE_IDS.UNKNOWN,
      usedDocling: null,
      paginated: null,
      pageCount: s.totalPages,
      chunkCount: s.chunkCount,
      observed: false,
    }));

  const observedIds = [...new Set(observedEntries.map((e) => e.engineId))];
  const recordedIds = [...new Set(recordedEntries.map((e) => e.engineId))];
  const totalDocs = observedEntries.length + recordedEntries.length + unobservedEntries.length;

  let badge, badgeType, description;
  if (observedEntries.length === 0 && recordedEntries.length === 0) {
    ({ badge, badgeType } = engineBadge(ENGINE_IDS.UNKNOWN));
    description =
      totalDocs > 0
        ? `${totalDocs} document(s) are indexed; this process did not ingest them, ` +
          "so the parser engine that built them is unknown."
        : "No documents are indexed and no ingest has run in this process.";
  } else if (observedEntries.length === 0) {
    // Nothing parsed here; every engine below is a recorded fact.
    const unknownTail = unobservedEntries.length > 0 ? `; ${unobservedEntries.length} other indexed document(s) have no record and their engine is unknown.` : ".";
    if (recordedIds.length === 1) {
      const b = engineBadge(recordedIds[0]);
      badge = b.badge;
      badgeType = b.badgeType;
      description = `${b.description}: recorded at ingest for ${recordedEntries.length} document(s); this process did not parse them${unknownTail}`;
    } else {
      badge = "MIXED ENGINES";
      badgeType = "neutral";
      const counts = recordedIds
        .map((id) => `${recordedEntries.filter((e) => e.engineId === id).length}× ${engineBadge(id).badge}`)
        .join(", ");
      description = `Multiple parser engines recorded at ingest (${counts}); this process did not parse them${unknownTail}`;
    }
  } else if (observedIds.length === 1) {
    const b = engineBadge(observedIds[0]);
    badge = b.badge;
    badgeType = b.badgeType;
    description =
      `${b.description}: parsed ${observedEntries.length} file(s) in this process` +
      (recordedEntries.length > 0 ? `; ${recordedEntries.length} other indexed document(s) carry an engine recorded at ingest` : "") +
      (unobservedEntries.length > 0
        ? `; ${unobservedEntries.length} other indexed document(s) were ingested earlier and their engine is unknown.`
        : ".");
  } else {
    badge = "MIXED ENGINES";
    badgeType = "neutral";
    const counts = observedIds
      .map((id) => `${observedEntries.filter((e) => e.engineId === id).length}× ${engineBadge(id).badge}`)
      .join(", ");
    description =
      `Multiple parser engines ran in this process (${counts})` +
      (unobservedEntries.length > 0
        ? `; ${unobservedEntries.length} other indexed document(s) have an unknown engine.`
        : ".");
  }

  // A duration is "measured" only when THIS process measured it; when nothing
  // was parsed here but the ledger recorded durations, they are reported as
  // recorded ("ledger"), never as a measurement of this turn.
  const measuredMs = sumMeasured(observedEntries.map((e) => e.parseDurationMs));
  const recordedMs = observedEntries.length === 0 ? sumMeasured(recordedEntries.map((e) => e.parseDurationMs)) : null;
  const durationMs = measuredMs !== null ? measuredMs : recordedMs;
  const durationSource = measuredMs !== null ? "measured" : recordedMs !== null ? "ledger" : "unavailable";
  const primaryEntries = observedEntries.length > 0 ? observedEntries : recordedEntries;
  const primaryIds = observedEntries.length > 0 ? observedIds : recordedIds;

  return {
    title: "Document Parser Engine Inspection",
    badge,
    badgeType,
    description,
    ...(durationMs !== null ? { durationMs } : {}),
    details: {
      engineIds: [...new Set([...observedIds, ...recordedIds])],
      engineSource: observedEntries.length > 0 ? "observed" : recordedEntries.length > 0 ? "ledger" : "none",
      parserEngine:
        primaryEntries.length === 0
          ? null
          : primaryIds.length === 1
            ? primaryEntries[0].engine
            : "mixed",
      durationSource,
      durationMs,
      recordedCount: recordedEntries.length,
      ingestedFileTraces: [...observedEntries, ...recordedEntries, ...unobservedEntries],
    },
  };
}

/**
 * The VLM-captioning span. Same honesty rules: counts and models only from
 * traces this process holds; `picturesIsolated: null` (not 0) when nothing
 * was observed, because 0 is a measurement and null is the absence of one.
 */
function buildVlmSpanModel(doclingLogs, recordedFacts = []) {
  const logs = Array.isArray(doclingLogs) ? doclingLogs : [];
  const observed = logs.length > 0;
  const facts = (Array.isArray(recordedFacts) ? recordedFacts : []).filter((f) => f && Number.isFinite(f.picturesCaptured));

  // T07 (design D10): nothing captioned in this process, but the ledger
  // recorded what the ingest did — say that, marked as recorded.
  if (!observed && facts.length > 0) {
    const picturesIsolated = facts.reduce((acc, f) => acc + (f.picturesCaptured || 0), 0);
    const vlmCaptionsGenerated = facts.reduce((acc, f) => acc + (f.vlmCaptionsGenerated || 0), 0);
    const vlmModels = [...new Set(facts.map((f) => f.vlmModel).filter(Boolean))];
    const durationMs = sumMeasured(facts.map((f) => f.vlmDurationMs));
    const outcomes = captionOutcomeTotals(facts);
    return {
      title: "VLM Diagram & Figure Auto-Captioning Inspection",
      badge: vlmCaptionsGenerated > 0 ? `VLM RECORDED${vlmModels.length === 1 ? ` (${vlmModels[0].toUpperCase()})` : ""}` : "0 CAPTIONS RECORDED",
      badgeType: vlmCaptionsGenerated > 0 ? "purple" : "blue",
      description:
        `Recorded at ingest for ${facts.length} document(s): ${vlmCaptionsGenerated} of ${picturesIsolated} isolated figure crop(s) captioned into the vector store` +
        `${captionOutcomeWording(outcomes)}; ` +
        "this process did not run the captioner." +
        budgetShortfallWording(outcomes) +
        detailPassWording(outcomes) +
        chainPassWording(outcomes) +
        ocrPassWording(outcomes),
      ...(durationMs !== null ? { durationMs } : {}),
      details: {
        vlmModels,
        picturesIsolated,
        vlmCaptionsGenerated,
        ...outcomes,
        durationSource: durationMs !== null ? "ledger" : "unavailable",
        durationMs,
        recordedCount: facts.length,
      },
    };
  }

  const picturesIsolated = observed
    ? logs.reduce((acc, l) => acc + (l.picturesCaptured || 0), 0)
    : null;
  const vlmCaptionsGenerated = observed
    ? logs.reduce((acc, l) => acc + (l.vlmCaptionsGenerated || 0), 0)
    : null;
  const vlmModels = [...new Set(logs.map((l) => l.vlmModel).filter(Boolean))];
  const durationMs = sumMeasured(logs.map((l) => l.vlmDurationMs));
  const outcomes = observed ? captionOutcomeTotals(logs) : { vlmDecorative: null, vlmTextOnly: null, vlmTruncated: null, vlmTimedOut: null, vlmFailed: null, vlmFromMemo: null, vlmCalls: null, vlmNotAttempted: null, budgetShortfalls: [], captioning: null, detailPages: null, detailTiles: null, detailCalls: null, detailFromMemo: null, detailConflicts: null, detailEdgeDropped: null, detailEdgeSettled: null, detailMultiValued: null, detailFailed: null, detailPageLists: [] };

  let badge, badgeType, description;
  if (!observed) {
    badge = "NOT OBSERVED";
    badgeType = "neutral";
    description =
      "No ingest has run in this process, so VLM captioning activity is unknown.";
  } else if (vlmCaptionsGenerated > 0) {
    badge = `VLM ACTIVE${vlmModels.length === 1 ? ` (${vlmModels[0].toUpperCase()})` : ""}`;
    badgeType = "purple";
    description = `VLM captioning ran during ingest in this process: ${vlmCaptionsGenerated} of ${picturesIsolated} isolated figure crop(s) captioned into the vector store${captionOutcomeWording(outcomes)}.${budgetShortfallWording(outcomes)}${detailPassWording(outcomes)}${chainPassWording(outcomes)}${ocrPassWording(outcomes)}`;
  } else if (outcomes.captioning === "off") {
    badge = "CAPTIONING OFF";
    badgeType = "blue";
    description = `Ingest ran in this process with figure captioning switched off (captionFigures: false): no page rendered, no crop captioned, no visual chunk emitted.`;
  } else {
    badge = "0 CAPTIONS";
    badgeType = "blue";
    description = `Ingest ran in this process; ${picturesIsolated} picture(s) isolated, 0 VLM captions generated${captionOutcomeWording(outcomes)}.${budgetShortfallWording(outcomes)}${detailPassWording(outcomes)}${chainPassWording(outcomes)}${ocrPassWording(outcomes)}`;
  }

  return {
    title: "VLM Diagram & Figure Auto-Captioning Inspection",
    badge,
    badgeType,
    description,
    ...(durationMs !== null ? { durationMs } : {}),
    details: {
      vlmModels: observed ? vlmModels : null,
      picturesIsolated,
      vlmCaptionsGenerated,
      ...outcomes,
      durationSource: durationMs !== null ? "measured" : "unavailable",
      durationMs,
    },
  };
}

/**
 * T24 (design D9): the caption outcomes beside the caption count — a
 * shortfall with a cause. Sums are over the entries that carry a number;
 * an entry without them (a pre-T24 record) contributes nothing, and when no
 * entry carries them the totals are null (unknown), never 0.
 */
function captionOutcomeTotals(entries) {
  const sum = (key) => {
    let seen = false;
    let total = 0;
    for (const e of entries) {
      if (Number.isFinite(e?.[key])) {
        seen = true;
        total += e[key];
      }
    }
    return seen ? total : null;
  };
  const modes = new Set(entries.map((e) => e?.captioning).filter((c) => c === "on" || c === "off"));
  return {
    vlmDecorative: sum("vlmDecorative"),
    // T32 (design D9): the pages the captioner read and found to be text.
    vlmTextOnly: sum("vlmTextOnly"),
    vlmTruncated: sum("vlmTruncated"),
    vlmTimedOut: sum("vlmTimedOut"),
    vlmFailed: sum("vlmFailed"),
    // T29 (design D7): recalled from the caption memo / asked of the server.
    vlmFromMemo: sum("vlmFromMemo"),
    vlmCalls: sum("vlmCalls"),
    // T31 (design D7): the pages beyond the caption budget, in total and per
    // document with the budget and the page range — named, never silent.
    vlmNotAttempted: sum("vlmNotAttempted"),
    budgetShortfalls: entries
      .filter((e) => Number.isFinite(e?.vlmNotAttempted) && e.vlmNotAttempted > 0)
      .map((e) => ({
        fileName: e.fileName ?? null,
        notAttempted: e.vlmNotAttempted,
        captionBudget: Number.isInteger(e.captionBudget) ? e.captionBudget : null,
        notAttemptedPages: typeof e.notAttemptedPages === "string" ? e.notAttemptedPages : null,
      })),
    captioning: modes.size === 1 ? [...modes][0] : modes.size > 1 ? "mixed" : null,
    // T33 (design D7): the detail passes, summed over the records that carry them; the pages named per document.
    detailPages: sum("detailPages"),
    detailTiles: sum("detailTiles"),
    detailCalls: sum("detailCalls"),
    detailFromMemo: sum("detailFromMemo"),
    detailConflicts: sum("detailConflicts"),
    // T45 (design §2.3): the tile-edge rule's counts, summed over the records that carry them.
    detailEdgeDropped: sum("detailEdgeDropped"),
    detailEdgeSettled: sum("detailEdgeSettled"),
    detailMultiValued: sum("detailMultiValued"),
    // T57 (design §2.4): the colour check's counts, summed over the records that carry them.
    detailColourChecked: sum("detailColourChecked"),
    detailColourFlagged: sum("detailColourFlagged"),
    detailColourSettled: sum("detailColourSettled"),
    detailColourAssociated: sum("detailColourAssociated"),
    detailColourFailed: sum("detailColourFailed"),
    // T47 (design §2.3): the caption labels reconciled with the text layer, summed over the records that carry it.
    captionSubstitutions: sum("captionSubstitutions"),
    detailFailed: sum("detailFailed"),
    detailEmpty: sum("detailEmpty"),
    // T46 (design D9, D16): the chain pass, summed over the records that carry it; the admitted pages named per document.
    ...Object.fromEntries(CHAIN_COUNT_KEYS.map((k) => [k, sum(k)])),
    chainPageLists: entries
      .filter((e) => Number.isFinite(e?.chainPages) && e.chainPages > 0)
      .map((e) => ({ fileName: e.fileName ?? null, pages: e.chainPages, pagesList: typeof e.chainPagesList === "string" ? e.chainPagesList : null })),
    detailPageLists: entries
      .filter((e) => Number.isFinite(e?.detailPages) && e.detailPages > 0)
      .map((e) => ({ fileName: e.fileName ?? null, pages: e.detailPages, pagesList: typeof e.detailPagesList === "string" ? e.detailPagesList : null })),
    // T35 (design D10): the OCR pass, summed over the records that carry it; the pages named per document.
    ocrNoText: sum("ocrNoText"),
    ocrPages: sum("ocrPages"),
    ocrEmpty: sum("ocrEmpty"),
    ocrFailed: sum("ocrFailed"),
    ocrChars: sum("ocrChars"),
    ocrPageLists: entries
      .filter((e) => Number.isFinite(e?.ocrNoText) && e.ocrNoText > 0)
      .map((e) => ({ fileName: e.fileName ?? null, mode: typeof e.ocrMode === "string" ? e.ocrMode : null, noText: e.ocrNoText, pages: Number.isFinite(e.ocrPages) ? e.ocrPages : null, pagesList: typeof e.ocrPagesList === "string" ? e.ocrPagesList : null, noTextPages: typeof e.ocrNoTextPages === "string" ? e.ocrNoTextPages : null, engine: typeof e.ocrEngine === "string" ? e.ocrEngine : null })),
  };
}

/**
 * T35 (design D10): the sentence that names the OCR pass — how many pages had no text layer and where, how many
 * OCR read (with the characters), read empty, failed on, and the engine — appended to the span's description only
 * when a record carries the counts (a pre-T35 record shows nothing new); "" when every page had a text layer.
 */
function ocrPassWording(outcomes) {
  if (!outcomes || !Number.isFinite(outcomes.ocrNoText) || outcomes.ocrNoText === 0) return "";
  const lists = Array.isArray(outcomes.ocrPageLists) ? outcomes.ocrPageLists : [];
  const where = lists.map((d) => `${d.fileName || "a document"}${d.noTextPages ? ` p${d.noTextPages.replace(/, /g, ", p")}` : ` (${d.noText})`}${d.mode === "off" ? " (OCR off)" : ""}`);
  const engine = lists.map((d) => d.engine).find((e) => typeof e === "string");
  return ` OCR (pages without a text layer): ${outcomes.ocrNoText} page(s)${where.length ? ` — ${where.join("; ")}` : ""}; ${outcomes.ocrPages ?? 0} read (${outcomes.ocrChars ?? 0} characters), ${outcomes.ocrEmpty ?? 0} read empty, ${outcomes.ocrFailed ?? 0} failed${engine ? `; engine ${engine}` : ""}.`;
}

/**
 * T33 (design D7): the sentence that names the detail passes — how many
 * pages were tiled and where, the tiles, the requests made and recalled,
 * the conflicts disclosed, the pages whose pass failed — appended to the
 * span's description only when a record carries the counts (a pre-T33
 * record shows nothing new); "" when no page fired.
 */
function detailPassWording(outcomes) {
  if (!outcomes || !Number.isFinite(outcomes.detailPages) || outcomes.detailPages === 0) return "";
  const where = (Array.isArray(outcomes.detailPageLists) ? outcomes.detailPageLists : []).map((d) => `${d.fileName || "a document"}${d.pagesList ? ` p${d.pagesList.replace(/, /g, ", p")}` : ` (${d.pages})`}`);
  // T45 (design §2.3, D11): the conflicts found, settled by the tile edge and disclosed once the rule settled any; a
  // same-tile multi-value named apart; a pre-T45 record reads as before.
  // T57 (design §2.4): the colour check's disclosures ride in detailConflicts; the tile conflicts found are the ones left
  // plus those the tile edge or the page's colour settled; a record without the colour counts reads as before.
  const settled = Number.isFinite(outcomes.detailEdgeSettled) ? outcomes.detailEdgeSettled : 0;
  const colourSettled = Number.isFinite(outcomes.detailColourSettled) ? outcomes.detailColourSettled : 0;
  const colourFlagged = Number.isFinite(outcomes.detailColourFlagged) ? outcomes.detailColourFlagged : 0;
  // T61 (design §2): the readings the three-cue settle wrote, named apart (the found arithmetic unchanged).
  const colourAssociated = Number.isFinite(outcomes.detailColourAssociated) ? outcomes.detailColourAssociated : 0;
  const disclosed = outcomes.detailConflicts ?? 0;
  const colourParts = [colourSettled > 0 ? `${colourSettled} settled by the page's colour` : null, colourFlagged > 0 ? `${colourFlagged} reading(s) the page's colour contradicts` : null, colourAssociated > 0 ? `${colourAssociated} reading(s) settled by three cues on the page` : null].filter(Boolean);
  const conflictPart = settled > 0 || colourParts.length ? `${disclosed - colourFlagged + settled + colourSettled} conflict(s) found, ${[settled > 0 ? `${settled} settled by the tile edge` : null, ...colourParts].filter(Boolean).join(", ")}, ${disclosed} disclosed` : `${disclosed} conflict(s) disclosed`;
  const colourFailed = (outcomes.detailColourFailed ?? 0) > 0 ? `, the colour layer not read on ${outcomes.detailColourFailed} page(s)` : "";
  const multi = (outcomes.detailMultiValued ?? 0) > 0 ? `, ${outcomes.detailMultiValued} multi-valued (one tile, two categories)` : "";
  return ` Detail passes (tiled): ${outcomes.detailPages} page(s)${where.length ? ` — ${where.join("; ")}` : ""}; ${outcomes.detailTiles ?? 0} tile(s), ${outcomes.detailCalls ?? 0} asked of the server, ${outcomes.detailFromMemo ?? 0} recalled from the caption memo, ${conflictPart}${multi}${colourFailed}, ${outcomes.detailFailed ?? 0} failed${(outcomes.detailEmpty ?? 0) > 0 ? `, ${outcomes.detailEmpty} keyed page(s) with an empty index (no chunk)` : ""}.`;
}

/**
 * T46 (design D9, D16): the sentence that names the drawing chains — the pages admitted and where, the requests made
 * and recalled, the NO_DIMENSIONS verdicts, the lines the drawing's geometry settled, the captions whose DESCRIPTION
 * the block replaced, the failures — appended only when a record carries the counts (a pre-T46 record shows nothing
 * new); "" when no page was admitted.
 */
function chainPassWording(outcomes) {
  if (!outcomes || !Number.isFinite(outcomes.chainPages) || outcomes.chainPages === 0) return "";
  const where = (Array.isArray(outcomes.chainPageLists) ? outcomes.chainPageLists : []).map((d) => `${d.fileName || "a document"}${d.pagesList ? ` p${d.pagesList.replace(/, /g, ", p")}` : ` (${d.pages})`}`);
  return ` Drawing chains: ${outcomes.chainPages} page(s)${where.length ? ` — ${where.join("; ")}` : ""}; ${outcomes.chainCalls ?? 0} asked of the server, ${outcomes.chainFromMemo ?? 0} recalled from the caption memo, ${outcomes.chainNoDimensions ?? 0} with no dimension, ${outcomes.chainSettled ?? 0} line(s) settled by the drawing's geometry, ${outcomes.chainBlocks ?? 0} caption(s) carrying the chain, ${outcomes.chainFailed ?? 0} failed${(outcomes.chainGeometryFailed ?? 0) > 0 ? `, ${outcomes.chainGeometryFailed} geometry read(s) failed` : ""}.`;
}

function captionOutcomeWording(outcomes) {
  const parts = [];
  if (Number.isFinite(outcomes.vlmDecorative)) parts.push(`${outcomes.vlmDecorative} decorative`);
  // T32: text-only pages, named only when there are any (a pre-T32 record shows nothing new).
  if (Number.isFinite(outcomes.vlmTextOnly) && outcomes.vlmTextOnly > 0) parts.push(`${outcomes.vlmTextOnly} text-only`);
  if (Number.isFinite(outcomes.vlmTruncated) && outcomes.vlmTruncated > 0) parts.push(`${outcomes.vlmTruncated} truncated`);
  if (Number.isFinite(outcomes.vlmTimedOut)) parts.push(`${outcomes.vlmTimedOut} timed out`);
  if (Number.isFinite(outcomes.vlmFailed)) parts.push(`${outcomes.vlmFailed} failed`);
  // T31: pages beyond the caption budget, named only when there are any (a document within its budget shows nothing new).
  if (Number.isFinite(outcomes.vlmNotAttempted) && outcomes.vlmNotAttempted > 0) parts.push(`${outcomes.vlmNotAttempted} beyond the page budget`);
  // T29: the memo's share, named only when a record carries it (a pre-T29 record shows nothing new).
  if (Number.isFinite(outcomes.vlmFromMemo)) parts.push(`${outcomes.vlmFromMemo} recalled from the caption memo`);
  if (Number.isFinite(outcomes.vlmCalls)) parts.push(`${outcomes.vlmCalls} asked of the server`);
  // T47 (design §2.3): the labels reconciled with the text layer, named only when there are any (a pre-T47 record shows nothing new).
  if (Number.isFinite(outcomes.captionSubstitutions) && outcomes.captionSubstitutions > 0) parts.push(`${outcomes.captionSubstitutions} label(s) reconciled with the text layer`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/**
 * T31 (design D7): the sentence that names the pages a budget left
 * uncaptioned, per document — " Pages beyond the caption budget: a.pdf
 * 51–84 (budget 50)." — appended to the span's description; "" when every
 * document was considered whole.
 */
function budgetShortfallWording(outcomes) {
  const list = Array.isArray(outcomes?.budgetShortfalls) ? outcomes.budgetShortfalls : [];
  if (list.length === 0) return "";
  const items = list.map((s) => `${s.fileName || "a document"} ${s.notAttemptedPages || `${s.notAttempted} page(s)`}${Number.isInteger(s.captionBudget) ? ` (budget ${s.captionBudget})` : ""}`);
  return ` Pages beyond the caption budget: ${items.join("; ")}.`;
}

module.exports = {
  ENGINE_IDS,
  normalizeEngine,
  engineBadge,
  buildParserSpanModel,
  buildVlmSpanModel,
  // T35 (design D10): the OCR sentence, exported for U-OCR.
  ocrPassWording,
  chainPassWording,
};
