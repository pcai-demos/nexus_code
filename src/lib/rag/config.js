/**
 * Retrieval config contract — ticket T08.
 *
 * There is no server-side configuration authority in this application:
 * configuration arrives in the request body, per call, from browser
 * localStorage (audit F-12). This module is therefore a per-request
 * NORMALIZER, not a config store. It is the only place a retrieval default
 * may live — the route and the orchestrator both resolve through it, which is
 * what removes the pre-T08 drift between their duplicated literals.
 *
 * Field classes:
 *  - TUNING knobs (strategy, pools, floors, alpha …) resolve with per-key
 *    precedence: explicit top-level field > ragSettings.<key> > default.
 *  - IDENTITY fields (embedUrl, embedModel) are NEVER silently defaulted.
 *    They decide which vector space a query lands in; a wrong default here is
 *    how every fresh browser queried a 2560-dim space against 4096-dim
 *    collections (F-12/F-19). A vector-bearing strategy without them is a
 *    typed CONFIG_MISSING — the same contract ingest has always had.
 *  - CREDENTIALS pass through verbatim, are never defaulted beyond the empty
 *    string, and must never be logged.
 */

/**
 * The retrieval failure taxonomy (ticket T12).
 *
 * T08 introduced the shape `{success:false, code, error}` with CONFIG_MISSING
 * and EMBED_MODEL_MISMATCH. T12 extends that ONE convention rather than adding
 * a second: every error the retrieval pipeline can produce has a code here, and
 * every error response from /api/rag/retrieve carries one. An untyped error is
 * precisely what the orchestrator cannot map, and an unmappable error is how an
 * infrastructure failure became "the document doesn't mention it" (FM-L7).
 *
 * The distinction that matters most is between the LAST TWO GROUPS:
 *   - a FAILURE means retrieval did not happen; nothing is known about the
 *     corpus, and claiming the documents lack content is a fabrication;
 *   - a DEGRADATION means retrieval DID happen and the results are real, but
 *     some stage that shapes their quality did not run.
 * Neither is the same as a successful search returning zero rows, which has
 * been a legitimate outcome since T08 shipped the relevance floor.
 */
const { isExplicitClassName } = require("./names");
// T33 (design D6, option E): the detail passes' mode vocabulary lives in the pure module (no I/O — this file is bundled into the page).
const { DETAIL_PASS_MODES, DETAIL_PASS_DEFAULT } = require("../ingestion/detail_pass");
// T35 (t35-design D3): the OCR mode vocabulary — the pure module owns it (no I/O; this file is bundled into the page).
const { OCR_MODES, OCR_DEFAULT } = require("../ingestion/ocr");
// T48 (t48-design D4): the answer policy's setting vocabulary — the pure module owns it (no I/O; this file is bundled into the page).
const { BEYOND_THE_DOCUMENTS_MODES, BEYOND_THE_DOCUMENTS_DEFAULT } = require("./answer_policy");
// T42 (t42-design.md D3, D4, D7): the rerank stage's per-request bounds and its deadline.
const { RERANK_BATCH_DEFAULTS } = require("./rerank_batches");

const RETRIEVAL_ERROR_CODES = Object.freeze({
  // Caller contract (400) — T08.
  CONFIG_MISSING: "CONFIG_MISSING",
  EMBED_MODEL_MISMATCH: "EMBED_MODEL_MISMATCH",
  QUERY_MISSING: "QUERY_MISSING",
  // Caller contract (400) — T17 (design D13, finding F-40): a PRESENT
  // collection name that is not its own canonical form ("my collection",
  // " RAGChunk ", 42). Before T17 the plain client silently sanitised it —
  // or laundered it into the production class — and answered from whatever
  // that resolved to; a mistyped name is an error, not an answer from the
  // wrong corpus. An ABSENT name keeps the read-path default.
  COLLECTION_INVALID: "COLLECTION_INVALID",
  // Dependency failures (500) — retrieval did not happen.
  EMBED_DOWN: "EMBED_DOWN",
  WEAVIATE_DOWN: "WEAVIATE_DOWN",
  // Our own defect (500), never a dependency's fault.
  RETRIEVE_INTERNAL: "RETRIEVE_INTERNAL",
  // The route could not be reached at all — raised by the orchestrator, not by
  // the route (which by definition cannot answer when it is unreachable).
  RETRIEVE_UNREACHABLE: "RETRIEVE_UNREACHABLE",
  // Degradation (200) — results are real but were not relevance-ranked.
  RERANK_DOWN: "RERANK_DOWN",
  // Degradation (200) — the ranking is real, but SOME returned passages were
  // never scored and therefore passed the relevance floor unchecked (T10).
  // Distinct from RERANK_DOWN on purpose: telling a user "not relevance-ranked"
  // when 7 of 8 passages were properly ranked is its own small dishonesty, and
  // over-warning trains people to ignore the warning.
  RERANK_PARTIAL: "RERANK_PARTIAL",
  // Post-retrieval bookkeeping threw. Retrieval SUCCEEDED; this must never be
  // reported as a retrieval failure (F-25).
  BOOKKEEPING_FAILED: "BOOKKEEPING_FAILED",
  // T36 (design D1 / D2; F-134) — the GENERATOR's outcome, in the one taxonomy
  // ("one convention, extended not forked"). Degradation (200): the provider
  // stopped the answer at the output budget (`finish_reason: "length"`) and
  // some visible answer exists — disclosed like RERANK_PARTIAL; the answer
  // may stop before the end.
  GENERATION_CUT: "GENERATION_CUT",
  // Failure (`success: false`, like an LLM outage): the whole output budget
  // went to the model's hidden reasoning and the visible answer is empty.
  // Before T36 this was a 200 with `success: true` and "Processed
  // successfully." on the page (design §0b, B run 2).
  GENERATION_EMPTY: "GENERATION_EMPTY",
});

/** The one error body shape. Use this everywhere instead of hand-rolling it. */
function retrievalErrorBody(code, message) {
  return { success: false, code, error: message };
}

/**
 * A degradation rides on a SUCCESSFUL (200) response: the results are real.
 * Reporting it as an error would take the whole answer down over a transient
 * from a CPU-served reranker; hiding it lets an unranked, unfloored result set
 * pose as a relevance-filtered one (F-26).
 */
function retrievalDegradation(code, stage, message) {
  return { stage, code, message };
}

const RETRIEVAL_DEFAULTS = {
  searchStrategy: "hybrid",
  hybridAlpha: 0.5,
  limit: 100,
  candidatesToRerank: 20,
  keepTopNAfterRerank: 8,
  // The relevance floor. Non-zero so that retrieval CAN return an empty result
  // set (F-8: a zero floor filters nothing, so absence probes returned a full
  // keepTopN of confidently irrelevant chunks). An explicit 0 in a request
  // disables the floor.
  //
  // CALIBRATED 2026-08-13 against Qwen/Qwen3-Reranker-8B on the golden corpus
  // (tests/eval/baselines/t08-artifacts/t08-before-floor.json): nonsense-token
  // absence probes score <= 0.0068; the weakest score that page-level recall
  // depends on is 0.3708; every floor in [0.01, 0.15] keeps recall@keepTopN
  // at 1.000 and MRR unchanged while zeroing all absence probes. 0.05 is the
  // geometric midpoint of that window (sqrt(0.0068 * 0.3708) = 0.0502),
  // giving ~7x margin to both edges.
  minRerankScore: 0.05,
  // Vector-mode-only (see filterBySimilarity): hybrid/BM25 rows carry no
  // distance, so no similarity exists to threshold — pre-T08 they were
  // fabricated as 1.0, which made this knob inert (F-8).
  similarityThreshold: 0.7,
  rerankProperty: "content",
  rerankQueryOverride: "",
  // T40 (t40-design.md D2, D3, D4; audit E23): the properties the KEYWORD half
  // of a search scores — keyword mode, the keyword half of hybrid, and the
  // count path (T09 sends `keyword`). Before T40 the clause named none, so
  // Weaviate scored every searchable text property: the filename, the file
  // type, the docHash, the image path, the section fields and the whole
  // metadata JSON alongside the prose. Measured on the served image,
  // 2026-09-21: 250 of 270 rows returned for seven name / type tokens matched
  // outside the chunk's text, and five anchor-exact queries were absent from
  // the top 20 that `["text"]` puts first. The chunk's text is the only
  // property a question is about; the section path a chunk carries is already
  // inside `text` (T34 for docx / pptx, T32 for captions), so naming the
  // section columns again double-counts it — measured to drown two anchors.
  // A request may name another list (top-level `searchProperties`, or
  // `ragSettings.searchProperties` — API-only, never a drawer control) or the
  // literal "unrestricted", which reproduces the pre-T40 clause for an A/B on
  // one image. The report says which list was actually sent.
  searchProperties: Object.freeze(["text"]),
  // T40 (design D7; §11a A9): identical text is shown once — the retrieve
  // route collapses rows whose bodies are byte-identical after the floor and
  // before the keepTopN slice. A COUNT turn must not: "how many times does X
  // appear" counts every stored chunk, and identical text on two pages is two
  // occurrences (I-COUNT read 2 for a manifest count of 6 when the collapse
  // ran on the scan). The orchestrator's aggregation override sends `false`;
  // a request-level field, never read from the blob.
  collapseRepeats: true,
  // T42 (t42-design.md D3, D4, D7; F-164): the dedicated rerank stage sends
  // its candidates in requests of at most `rerankMaxDocs` documents /
  // `rerankMaxChars` chars and stops at `rerankBudgetMs` — the reranker's
  // cost is the bytes' (≈ 0.6–1.0 ms per char on a cache miss, measured on
  // the served image 2026-09-22), one oversized request evicts the endpoint's
  // cache for every other turn (F-166), and an overrun is PARTIAL (the tail
  // unscored, T10's contract) instead of total. The enumeration profile sends
  // its own deadline (router.js). API-only, never a drawer control.
  rerankMaxChars: RERANK_BATCH_DEFAULTS.maxChars,
  rerankMaxDocs: RERANK_BATCH_DEFAULTS.maxDocs,
  rerankBudgetMs: RERANK_BATCH_DEFAULTS.budgetMs,
  rerankEnabled: true,
  // Read-path default only. Destructive routes must NOT default the
  // collection — that is ticket T21's contract.
  weaviateCollection: "RAGChunk",
  weaviateUrl: "http://weaviate.hpe-weaviate.svc.cluster.local:80",
  // The rerank endpoint defaults are correct for this deployment and healthy
  // (F-9: 0.00 degraded scores, τ=0.994 on the dedicated MLIS path). They stay
  // until T17/T23 centralise endpoint config; the embed pair gets no such
  // grace because its old defaults named the wrong vector space entirely.
  rerankUrl: "https://rerank.project-demos.serving.demo.lon-pcai.twlon.com",
  rerankModel: "Qwen/Qwen3-Reranker-8B",
  // Aggregation ("how many times does X appear") — ticket T09 (E18/E33, FM-T2).
  // The scan limit is sent as BOTH `limit` and `keepTopNAfterRerank` by the
  // orchestrator's aggregation override, because keepTopNAfterRerank slices
  // on every path: pre-T09 the override raised limit to 100 and left the
  // slice at 20, so exactly 20 chunks were ever counted while the trace
  // claimed an uncapped scan. 500 is above any document in the demo corpus
  // (largest: 65 chunks) and bounded enough that a common term on a large
  // collection reports a CAPPED scan rather than running unbounded.
  aggregationScanLimit: 500,
  // Counting rule. false = the manifest's rule, case-insensitive whole-word
  // ("test" does not count "testing"); true = today's stem-variant regex
  // (s, 's, s', ing, ed, es), opt-in. Retrieval expansion follows this switch.
  countStemVariants: false,
  // How many occurrence lines the model is shown as evidence. The COUNT is
  // computed server-side over every scanned chunk; the evidence is a sample
  // for quoting pages, so prompt size is bounded by this knob, not by the
  // scan limit (500 raw chunks ≈ 135k tokens ≈ 90 s of prompt processing on
  // the demo model, measured 2026-09-04).
  aggregationEvidenceLines: 80,
  // Schema version — ticket T05, flipped by the cut-over (design D1). 1 =
  // the v1 class exactly as before; 2 = the `V2` class (deterministic ids,
  // chunkIndex / docVersion / sourceId, the ledger's completion-aware skip,
  // version supersede). Read and write are symmetric under this one flag,
  // and EVERY reader resolves it through resolveSchemaVersion below — the
  // resolver, both ingest sites, unload, clear, clear/preview, the
  // orchestrator's summary and the Standards Drawer (D2) — so the class a
  // request reads, writes, drops or summarises is decided in one place.
  // The one-release override is the same flag sent as 1 (top-level or
  // ragSettings.schemaVersion), read AND write (D4); rollback is this
  // constant. There is no admin-panel field (T17); the production
  // `RAGChunkV2` was created by the cut-over's migration (D7).
  schemaVersion: 2,
};

/**
 * The admin panel's `ragSettings` blob — ticket T17 (design D1, D8, D9), the
 * ONE table page.js renders and the server reads. Every key here has a
 * control in the drawer AND a reader on the server (U-SETTINGS pins both
 * directions); the retrieval keys are REFERENCES into RETRIEVAL_DEFAULTS
 * under their client-side names (the resolver's aliases: `searchMode` ←
 * `searchStrategy`, `topKRetrieval` ← `limit`, `rerankerEnabled` ←
 * `rerankEnabled`), so the panel's blob can never again disagree with the
 * resolver's default — which is how the demo ran with the calibrated floor
 * OFF from T08 until T17 (F-83: page.js's own literal said 0.0).
 *
 * The ingestion keys and the prompt-assembly key get their first server-side
 * home here. Values are the measured / owner-approved ones where the server
 * had one (the floor 0.05, similarity 0.7, depth 100) and, where it had none,
 * the number that makes the knobs agree (`maxContextChunks` = keepTopN: one
 * number of chunks reaches the model — before T17 the page said 6, the
 * orchestrator's fallback 12, and 2 of the 8 retrieved chunks were dropped
 * for no reason).
 *
 * `embedBatchSize` / `embedConcurrency` null = "auto": the ingest route's
 * endpoint rule (64 / 5 for the two Ollama hosts, 16 / 1 otherwise — F-68);
 * a positive integer overrides it.
 */
const RAG_SETTINGS_DEFAULTS = Object.freeze({
  // Documents (the ingest route)
  allowedFileTypes: Object.freeze(["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX"]),
  maxFileSize: 25,
  duplicatePolicy: "skip",
  metadataExtraction: true,
  // T24 (design D6, D8): caption figures and image-only pages with the VLM
  // at ingest. Off = text only: no page render, no crop folder, no visual
  // chunk — and a different docVersion (fingerprinted when off, ids.js).
  captionFigures: true,
  // T31 (multimodal-workshop-design D5, D6; F-123): pages per document sent
  // to the captioner, in page order. 0 = every page (the default). Pages
  // beyond the budget are not captioned — counted and named by page on the
  // ledger, the status frame, both ingest views and the VLM span, never
  // dropped silently. A non-default budget joins docVersion's fingerprint
  // (ids.js), since it changes the document's chunk set (T24 D8's rule).
  captionPageBudget: 0,
  // T33 (t33-design D1 option B + E, D6; §12b): the tiled detail passes for
  // dense pages. "auto" (the default) takes the closer look on the pages
  // whose caption ADMITS its detail did not fit into text — a legend /
  // colour-coding / hatching / symbol key named, `[illegible]` written, the
  // overflow marker — plus TYPE `map or plan`; "all" on every captioned
  // page (a technical manual whose owner wants the exhaustive index at a
  // known cost); "off" on none. Set BEFORE an ingest like captionFigures —
  // never a per-document prompt, never a mid-job pause. A non-default value
  // joins docVersion's fingerprint (ids.js): a different chunk set.
  detailPasses: DETAIL_PASS_DEFAULT,
  // T35 (t35-design D2, D3, D5–D8): OCR for a page whose PDF text layer is
  // EMPTY — "auto" (the default) reads such a page with RapidOCR at ingest
  // and makes the OCR lines the page's own text (chunked, searchable, marked
  // `Text: OCR` in the answer's sources; the caption then takes the with-text
  // prompt and the closer-look transcription is not taken); only such pages,
  // never a page with a text layer, never a corpus-wide decision. "off" leaves
  // such a page with its caption only. Set BEFORE an ingest like the two
  // above. A non-default value joins docVersion's fingerprint (ids.js).
  ocrNoTextPages: OCR_DEFAULT,
  // Chunking (the parser; the first three are in docVersion's fingerprint)
  chunkSize: 600,
  chunkOverlap: 80,
  minChunkSize: 150,
  // Embeddings — the batch shape (the ingest route; F-68)
  embedBatchSize: null,
  embedConcurrency: null,
  // Retrieval (the resolver)
  searchMode: RETRIEVAL_DEFAULTS.searchStrategy,
  hybridAlpha: RETRIEVAL_DEFAULTS.hybridAlpha,
  topKRetrieval: RETRIEVAL_DEFAULTS.limit,
  similarityThreshold: RETRIEVAL_DEFAULTS.similarityThreshold,
  // Prompt assembly (the orchestrator)
  maxContextChunks: RETRIEVAL_DEFAULTS.keepTopNAfterRerank,
  // T28 (design D3, D4): page-level context assembly — when a page's text
  // is retrieved, the descriptions of that page's figures travel with it
  // ("captions"); "page" additionally brings a retrieved figure's page text;
  // "off" shows the before on the same image. Companions are bounded by
  // COMPANION_BUDGET_FACTOR × maxContextChunks (a constant, §6).
  pageCompanions: "captions",
  // T28 (design D14–D16, D19): an enumeration question ("for each …") reads
  // the ONE document it is about in page order when the document fits the
  // budget (estimated tokens, chars ÷ CHARS_PER_TOKEN); "off" keeps the
  // ranked path. Every demo document fits under 80,000 (measured §13.0).
  enumerationScope: "document",
  documentContextBudget: 80000,
  // T15 (design D4, D12): on a LOOKUP turn, when a document is in scope —
  // the request's selection, a name in the question, or the score-mass vote
  // — retrieved passages from other documents are left out of the prompt
  // (and bring no companions); "off" keeps them, as before T15. An
  // enumeration turn is governed by enumerationScope above.
  lookupScope: "document",
  // T63 (t63-design.md D2 (a), D3 (a), D7 (a)): on a LOOKUP turn whose document the REQUEST selected (the composer's
  // selector — one document), "whole" reads that document whole in page order when its estimate fits
  // documentContextBudget (the enumeration path's budget, one number for both) and skips the reranker (F-242); a read
  // that does not complete falls back to the ranked path (D8). "ranked" keeps today's ranked passages exactly.
  lookupDocumentRead: "whole",
  // T48 (t48-design D1 a, D3 a, D4; the owner's D4): "on" lets the answer close with ONE labelled section of the
  // model's own judgement or general knowledge ("### Beyond the documents" — uncited, below the grounded answer,
  // outside the citation audit); "off" (the default, P4) never invites it. Request-level: it governs that rule
  // only — the computed context notes and the method / next-step rule are always on. No re-ingest.
  beyondTheDocuments: BEYOND_THE_DOCUMENTS_DEFAULT,
  // Counting (the aggregation resolver, T09 — F-46)
  aggregationScanLimit: RETRIEVAL_DEFAULTS.aggregationScanLimit,
  countStemVariants: RETRIEVAL_DEFAULTS.countStemVariants,
  aggregationEvidenceLines: RETRIEVAL_DEFAULTS.aggregationEvidenceLines,
  // Reranking (the resolver)
  rerankerEnabled: RETRIEVAL_DEFAULTS.rerankEnabled,
  rerankProperty: RETRIEVAL_DEFAULTS.rerankProperty,
  rerankQueryOverride: RETRIEVAL_DEFAULTS.rerankQueryOverride,
  candidatesToRerank: RETRIEVAL_DEFAULTS.candidatesToRerank,
  keepTopNAfterRerank: RETRIEVAL_DEFAULTS.keepTopNAfterRerank,
  minRerankScore: RETRIEVAL_DEFAULTS.minRerankScore,
});

/**
 * Keys a server reads off `ragSettings` (or the parser's config) that have
 * NO admin-panel control by design — identity fields the page sends
 * top-level (the embed pair, the VLM trio), API-only overrides
 * (`schemaVersion`: the cut-over's one-release flag, D4; `weaviateCollection`
 * / `weaviateUrl`: the harness's and the migration's), and the parser's own
 * `autoProfile` / `ollamaUrl`. U-SETTINGS requires every blob key a server
 * reads to be in RAG_SETTINGS_DEFAULTS ∪ this list — no hidden knob.
 */
const RAG_SETTINGS_API_ONLY_KEYS = Object.freeze([
  "embedUrl",
  "embedModel",
  "rerankUrl",
  "rerankModel",
  "weaviateUrl",
  "weaviateCollection",
  "schemaVersion",
  "autoProfile",
  "vlmModelName",
  "vlmEndpointUrl",
  "vlmApiKey",
  "ollamaUrl",
  // T40 (design D3): the keyword half's property list — the harness's A/B and
  // a caller's hosting parameter; a correctness fix, not a preference, so no
  // drawer control (the loader's whitelist keeps a browser from setting it).
  "searchProperties",
  // T42 (design D7): the rerank stage's per-request bounds and its deadline —
  // the enumeration profile's override and the harness's A/B; one right
  // answer, not a preference, so no drawer control.
  "rerankMaxChars",
  "rerankMaxDocs",
  "rerankBudgetMs",
]);

/**
 * The enumerated blob values. `duplicatePolicy` has TWO values (T17 design
 * D9; F-50 case 2 / F-56): the route tests `=== "skip"` and treats anything
 * else as overwrite, so the panel's former `new_version` /
 * `force_reprocess` were one policy wearing three names. Under v2, `skip`
 * means a changed document supersedes its predecessor and unchanged bytes
 * are a skip; `overwrite` re-embeds unchanged bytes (the cut-over banner's
 * rule).
 */
const DUPLICATE_POLICIES = Object.freeze(["skip", "overwrite"]);
const SEARCH_MODES = Object.freeze(["hybrid", "vector", "keyword"]);
/**
 * T40: the v1 class's BM25-searchable properties — the nine `text`-typed
 * columns every collection carries (weaviate.js's V1_PROPERTIES; U-SCHEMA pins
 * the two lists equal). A request's `searchProperties` is sanitised against
 * this list here; the store client then intersects it with the class's own.
 */
const SEARCHABLE_V1_PROPERTIES = Object.freeze(["text", "source", "fileType", "chapter", "sectionNumber", "sectionTitle", "docHash", "imagePath", "metadata"]);
/** T40: the request value that asks for the pre-T40 clause (no `properties` — every searchable property). */
const SEARCH_PROPERTIES_UNRESTRICTED = "unrestricted";

/**
 * T40 (design D3): the property list a request names for the keyword half.
 *   absent (undefined / null)  → the default, `["text"]`
 *   "unrestricted"             → null: no `properties` clause — the pre-T40 query, the A/B's before
 *   an array                   → the v1 searchable names it holds, in order, deduplicated; an unknown
 *                                name is dropped; a list with nothing left is the default
 *   anything else              → the default
 * Pure. What the store was actually asked for (after the class intersection)
 * is what the report carries, so a caller can always see what was searched.
 */
function normaliseSearchProperties(value, fallback = RETRIEVAL_DEFAULTS.searchProperties) {
  if (typeof value === "string" && value.trim().toLowerCase() === SEARCH_PROPERTIES_UNRESTRICTED) return null;
  if (!Array.isArray(value)) return [...fallback];
  const out = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (SEARCHABLE_V1_PROPERTIES.includes(name) && !out.includes(name)) out.push(name);
  }
  return out.length ? out : [...fallback];
}
const RERANK_PROPERTIES = Object.freeze(["content", "title", "combined"]);
/** T28: the page-companion modes and the enumeration scopes (design D4, D19). */
const PAGE_COMPANION_MODES = Object.freeze(["off", "captions", "page"]);
const ENUMERATION_SCOPES = Object.freeze(["off", "document"]);
/** T15: the lookup-turn scope (design D12) — the same two values. */
const LOOKUP_SCOPES = Object.freeze(["off", "document"]);
/** T63 (D7 (a)): how a lookup reads the one document the request selected. */
const LOOKUP_DOCUMENT_READS = Object.freeze(["whole", "ranked"]);

/**
 * T28's constants — reasons, not knobs (design D4, D16):
 *  - COMPANION_BUDGET_FACTOR: companions ≤ factor × maxContextChunks, so the
 *    context can at most double; a second slider would make "off" the only
 *    value anyone understands.
 *  - COMPANION_TEXT_PER_PAGE: under mode "page", how many text chunks a
 *    retrieved figure brings from its page — applyPageDiversity's
 *    dimensional per-page limit, the existing notion of "enough of one page".
 *  - CHARS_PER_TOKEN: measured on this corpus with the demo generator
 *    (Fervi: 164k chars with headers → 45,688 prompt tokens; 3.2–3.6).
 *  - MEAN_CHARS_PER_CHUNK: the pre-read size estimate per stored chunk
 *    (census: text p50 557, captions p50 1393; 800 is the safe mean).
 */
const CONTEXT_ASSEMBLY_CONSTANTS = Object.freeze({
  COMPANION_BUDGET_FACTOR: 1,
  COMPANION_TEXT_PER_PAGE: 4,
  CHARS_PER_TOKEN: 3.2,
  MEAN_CHARS_PER_CHUNK: 800,
  // The numbered block header the model reads with every chunk
  // ("[S12] (Document: …, Page: 25, Section: N/A)" ≈ 80–150 chars).
  HEADER_CHARS_PER_BLOCK: 120,
  SCOPE_DOMINANCE_SHARE: 0.5,
});

/**
 * Prompt-assembly config — the orchestrator's `maxContextChunks`, resolved
 * from the blob through this module like every other knob (T17 design D1:
 * the orchestrator's `|| 12` literal leaves). Same fall-through as the
 * tuning knobs: a finite number ≥ 1, else the default.
 */
function resolveContextConfig(ragSettings) {
  const rs = ragSettings && typeof ragSettings === "object" ? ragSettings : {};
  return {
    maxContextChunks: pickNumber(1, rs.maxContextChunks, RAG_SETTINGS_DEFAULTS.maxContextChunks),
    // T28: the enumerated knobs take a listed value, else the default; the
    // budget a finite number ≥ 1, else the default (the tuning-knob rule).
    pageCompanions: PAGE_COMPANION_MODES.includes(rs.pageCompanions) ? rs.pageCompanions : RAG_SETTINGS_DEFAULTS.pageCompanions,
    enumerationScope: ENUMERATION_SCOPES.includes(rs.enumerationScope) ? rs.enumerationScope : RAG_SETTINGS_DEFAULTS.enumerationScope,
    documentContextBudget: pickNumber(1, rs.documentContextBudget, RAG_SETTINGS_DEFAULTS.documentContextBudget),
    lookupScope: LOOKUP_SCOPES.includes(rs.lookupScope) ? rs.lookupScope : RAG_SETTINGS_DEFAULTS.lookupScope,
    lookupDocumentRead: LOOKUP_DOCUMENT_READS.includes(rs.lookupDocumentRead) ? rs.lookupDocumentRead : RAG_SETTINGS_DEFAULTS.lookupDocumentRead,
  };
}

/**
 * T48 (t48-design D4): the answer policy's setting, resolved from the blob like the prompt-assembly knobs — a listed
 * value, else the default ("off"). Its own resolver so T28's context config keeps its shape.
 */
function resolveAnswerPolicyConfig(ragSettings) {
  const rs = ragSettings && typeof ragSettings === "object" ? ragSettings : {};
  return {
    beyondTheDocuments: BEYOND_THE_DOCUMENTS_MODES.includes(rs.beyondTheDocuments) ? rs.beyondTheDocuments : RAG_SETTINGS_DEFAULTS.beyondTheDocuments,
  };
}

/**
 * The whitelisting loader for the persisted blob (T17 design D6; F-82: the
 * drawer's Save wrote `nxs_ragSettings` and nothing ever read it). Pure:
 * a JSON string or an object in, a complete blob out — per key of
 * RAG_SETTINGS_DEFAULTS the stored value when its type matches the default's
 * (and, for the enumerated keys, when it is a listed value), else the
 * default; unknown keys dropped; junk or a parse failure is the defaults.
 * `null` defaults (`embedBatchSize` / `embedConcurrency`, "auto") accept
 * null or a positive integer. This is what makes the next defaults change
 * safe: an old blob can only ever supply values the current table has keys
 * for, and the guard bump (§6 of session-state) drops it once anyway.
 */
function loadRagSettings(raw) {
  let stored = raw;
  if (typeof raw === "string") {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
  }
  const src = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const out = {};
  for (const [key, def] of Object.entries(RAG_SETTINGS_DEFAULTS)) {
    const v = src[key];
    let accept = false;
    if (v === undefined) accept = false;
    else if (def === null) accept = v === null || (Number.isInteger(v) && v > 0);
    else if (Array.isArray(def)) accept = Array.isArray(v) && v.every((x) => typeof x === "string");
    else if (typeof def === "number") accept = typeof v === "number" && Number.isFinite(v);
    else accept = typeof v === typeof def;
    if (accept && key === "duplicatePolicy" && !DUPLICATE_POLICIES.includes(v)) {
      // The route's own rule: anything that is not "skip" is overwrite.
      out[key] = "overwrite";
      continue;
    }
    if (accept && key === "searchMode" && !SEARCH_MODES.includes(v)) accept = false;
    if (accept && key === "rerankProperty" && !RERANK_PROPERTIES.includes(v)) accept = false;
    if (accept && key === "pageCompanions" && !PAGE_COMPANION_MODES.includes(v)) accept = false;
    if (accept && key === "enumerationScope" && !ENUMERATION_SCOPES.includes(v)) accept = false;
    if (accept && key === "lookupScope" && !LOOKUP_SCOPES.includes(v)) accept = false;
    if (accept && key === "lookupDocumentRead" && !LOOKUP_DOCUMENT_READS.includes(v)) accept = false;
    // T31: a page budget is a non-negative integer; anything else is the default (no limit).
    if (accept && key === "captionPageBudget" && !(Number.isInteger(v) && v >= 0)) accept = false;
    // T33: the detail passes' mode is one of the three listed values; anything else is the default (auto).
    if (accept && key === "detailPasses" && !DETAIL_PASS_MODES.includes(v)) accept = false;
    // T35: the OCR mode is one of the listed values; anything else is the default.
    if (accept && key === "ocrNoTextPages" && !OCR_MODES.includes(v)) accept = false;
    // T48: the answer policy's setting is one of the listed values; anything else is the default (off).
    if (accept && key === "beyondTheDocuments" && !BEYOND_THE_DOCUMENTS_MODES.includes(v)) accept = false;
    out[key] = accept ? (Array.isArray(v) ? [...v] : v) : Array.isArray(def) ? [...def] : def;
  }
  return out;
}

/**
 * The only two values the flag has: 2 (or "2") selects v2; anything else —
 * including undefined, 1, "1", "v2", null — is v1. Silent on garbage on
 * purpose: this is a write-path default the ingest route reads directly,
 * and a typed refusal here would change ingest behaviour for a value no UI
 * can currently send.
 */
function normaliseSchemaVersion(value) {
  return value === 2 || value === "2" ? 2 : 1;
}

/**
 * The class a (collection, schemaVersion) pair reads and writes. The suffix is
 * plain alphanumerics, so canonicalising before or after appending gives the
 * same class name (`RAGEval_x` → `RAGEval_xV2`, still inside the harness
 * guard; `RAGChunk` → `RAGChunkV2`).
 */
function collectionNameForVersion(name, schemaVersion) {
  return normaliseSchemaVersion(schemaVersion) === 2 ? `${name}V2` : name;
}

/**
 * The schema version a request runs under — the ONE place it is decided
 * (cut-over design D1): an explicit top-level `schemaVersion`, else
 * `ragSettings.schemaVersion`, else RETRIEVAL_DEFAULTS.schemaVersion — the
 * resolver's own per-key precedence, now shared by every reader (D2). Pure;
 * accepts a request body, an admin-config blob or nothing. Garbage is v1 by
 * normaliseSchemaVersion's rule (an explicit wrong value is not "unset").
 */
function resolveSchemaVersion({ schemaVersion, ragSettings } = {}) {
  const rs = ragSettings && typeof ragSettings === "object" ? ragSettings : {};
  return normaliseSchemaVersion(
    schemaVersion !== undefined && schemaVersion !== null
      ? schemaVersion
      : rs.schemaVersion !== undefined && rs.schemaVersion !== null
        ? rs.schemaVersion
        : RETRIEVAL_DEFAULTS.schemaVersion
  );
}

const STRATEGIES = new Set(["hybrid", "vector", "keyword"]);

/** First value in the chain that coerces to a finite number ≥ min. */
function pickNumber(min, ...values) {
  for (const v of values) {
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= min) return n;
  }
  return undefined;
}

/** First value in the chain that is a non-empty string. */
function pickString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function missing(field, strategy) {
  return {
    ok: false,
    error: {
      code: RETRIEVAL_ERROR_CODES.CONFIG_MISSING,
      field,
      message:
        `'${field}' is required for ${strategy} retrieval and is no longer silently ` +
        "defaulted (F-12: the old default named an embedding model in a different " +
        "vector space than the collections). Send the embedding configuration that " +
        "built the target collection — ingest has always required exactly this.",
    },
  };
}

/**
 * Normalize a retrieve request body into one resolved config.
 * Returns { ok: true, config } or { ok: false, error: { code, field, message } }.
 */
function resolveRetrievalConfig(body = {}) {
  const rs = body.ragSettings && typeof body.ragSettings === "object" ? body.ragSettings : {};
  const d = RETRIEVAL_DEFAULTS;

  const rawStrategy = pickString(body.searchStrategy, rs.searchMode, d.searchStrategy);
  const searchStrategy = STRATEGIES.has(rawStrategy) ? rawStrategy : d.searchStrategy;
  const needsVector = searchStrategy !== "keyword";

  // T17 (design D13, F-40): a PRESENT collection name must be exactly the
  // class it names. Absent (undefined / null / "") keeps the read default;
  // present and not canonical is a typed 400 — never a sanitised guess, never
  // an answer from the production class. The check runs BEFORE the identity
  // check so a caller with two mistakes hears about the corpus first.
  const rawCollection =
    body.weaviateCollection !== undefined && body.weaviateCollection !== null && body.weaviateCollection !== ""
      ? body.weaviateCollection
      : rs.weaviateCollection !== undefined && rs.weaviateCollection !== null && rs.weaviateCollection !== ""
        ? rs.weaviateCollection
        : undefined;
  if (rawCollection !== undefined && !isExplicitClassName(rawCollection)) {
    return {
      ok: false,
      error: {
        code: RETRIEVAL_ERROR_CODES.COLLECTION_INVALID,
        field: "weaviateCollection",
        message:
          `'weaviateCollection' must name the exact collection (received ${JSON.stringify(rawCollection).slice(0, 200)}): ` +
          "a non-empty name of letters, digits and underscores starting with an uppercase letter, " +
          "without the schema-version suffix. Retrieval never sanitises a name into another class (F-40).",
      },
    };
  }

  // Identity: never defaulted. Empty strings count as missing.
  const embedUrl = pickString(body.embedUrl, rs.embedUrl);
  const embedModel = pickString(body.embedModel, rs.embedModel);
  if (needsVector && !embedUrl) return missing("embedUrl", searchStrategy);
  if (needsVector && !embedModel) return missing("embedModel", searchStrategy);

  const limit = pickNumber(1, body.limit, rs.topKRetrieval, d.limit);
  const candidatesToRerank = pickNumber(1, body.candidatesToRerank, rs.candidatesToRerank, d.candidatesToRerank);
  const keepTopNAfterRerank = pickNumber(1, body.keepTopNAfterRerank, rs.keepTopNAfterRerank, d.keepTopNAfterRerank);
  const minRerankScore = pickNumber(0, body.minRerankScore, rs.minRerankScore, d.minRerankScore);
  const similarityThreshold = pickNumber(0, body.similarityThreshold, rs.similarityThreshold, d.similarityThreshold);
  const hybridAlpha = pickNumber(0, body.hybridAlpha, rs.hybridAlpha, d.hybridAlpha);
  // T42 (design D3, D4, D7): the rerank stage's per-request bounds and its
  // deadline — top-level (the enumeration profile's `rerankBudgetMs` rides
  // the router's overrides), else the blob's (API-only), else the module's
  // defaults. A document count is a whole number.
  const rerankMaxChars = pickNumber(1, body.rerankMaxChars, rs.rerankMaxChars, d.rerankMaxChars);
  const rerankMaxDocs = Math.floor(pickNumber(1, body.rerankMaxDocs, rs.rerankMaxDocs, d.rerankMaxDocs));
  const rerankBudgetMs = pickNumber(1, body.rerankBudgetMs, rs.rerankBudgetMs, d.rerankBudgetMs);
  // T40 (design D3): the keyword half's property list — top-level, else the
  // blob's (API-only), else the default. null means "unrestricted".
  const searchProperties = normaliseSearchProperties(
    body.searchProperties !== undefined && body.searchProperties !== null ? body.searchProperties : rs.searchProperties
  );

  const rerankEnabled =
    typeof body.rerankEnabled === "boolean"
      ? body.rerankEnabled
      : typeof rs.rerankerEnabled === "boolean"
        ? rs.rerankerEnabled
        : d.rerankEnabled;

  // A blanked endpoint or model means reranking cannot actually run. Pre-T08
  // that combination silently skipped the rerank stage AND the keepTopN slice,
  // returning the whole candidate pool; now it resolves to the rerank-off
  // contract explicitly. An explicitly PROVIDED value — including an empty
  // string — is authoritative and never falls through to the default: sending
  // rerankUrl:"" is how a caller says "I have no rerank endpoint".
  const explicitOrDefault = (bodyVal, rsVal, defVal) => {
    if (bodyVal !== undefined && bodyVal !== null) return String(bodyVal).trim();
    if (rsVal !== undefined && rsVal !== null) return String(rsVal).trim();
    return defVal;
  };
  const rerankUrl = explicitOrDefault(body.rerankUrl, rs.rerankUrl, d.rerankUrl);
  const rerankModel = explicitOrDefault(body.rerankModel, rs.rerankModel, d.rerankModel);
  const rerankEffective = Boolean(rerankEnabled && rerankUrl && rerankModel);

  // Pool arithmetic — each knob means exactly one thing (F-20):
  //  - candidatesToRerank: how many candidates the reranker scores.
  //  - limit: retrieval depth when no reranker reorders.
  //  - keepTopNAfterRerank: how many results leave the route, on EVERY path.
  // (Deliberately NOT the original ticket's max(limit, candidatesToRerank),
  // which would inflate rerank-on pools whenever limit > candidates —
  // owner-approved deviation, 2026-08-13.)
  const poolSize = rerankEffective ? candidatesToRerank : Math.max(limit, keepTopNAfterRerank);

  // T05: same per-key precedence as every tuning knob, through the one
  // shared function (cut-over D1). The suffix is applied HERE so the route,
  // the orchestrator's count client and the trace all see the class that
  // was actually read.
  const schemaVersion = resolveSchemaVersion(body);

  const floorSource = rerankEffective
    ? "rerank"
    : searchStrategy === "vector"
      ? "similarity"
      : "none";

  // T15 (design D4): an optional document filter — exact `sourceId`s (the
  // v2 identity, whole-value match) and / or `source` names (a TOKEN match
  // on the v1 property, F-109, which the route post-checks exactly). Absent
  // or empty means no filter: the legs never send one, so their query is
  // byte-identical. Never read from ragSettings — a request-level field,
  // like the scope it carries (T28 A3).
  const documentFilter = normaliseDocumentFilter(body.documentFilter);
  // T40 (D7, A9): the repeat collapse is on unless the request says otherwise (the count path does).
  const collapseRepeats = typeof body.collapseRepeats === "boolean" ? body.collapseRepeats : d.collapseRepeats;

  return {
    ok: true,
    config: {
      searchStrategy,
      needsVector,
      hybridAlpha,
      limit,
      candidatesToRerank,
      keepTopNAfterRerank,
      minRerankScore,
      similarityThreshold,
      rerankEnabled,
      rerankEffective,
      rerankUrl,
      rerankModel,
      rerankProperty: pickString(body.rerankProperty, rs.rerankProperty, d.rerankProperty),
      rerankQueryOverride:
        pickString(body.rerankQueryOverride, rs.rerankQueryOverride) || d.rerankQueryOverride,
      poolSize,
      floorSource,
      weaviateUrl: pickString(body.weaviateUrl, rs.weaviateUrl, d.weaviateUrl),
      schemaVersion,
      weaviateCollection: collectionNameForVersion(
        pickString(body.weaviateCollection, rs.weaviateCollection, d.weaviateCollection),
        schemaVersion
      ),
      embedUrl,
      embedModel,
      token: typeof body.token === "string" ? body.token : "",
      weaviateToken: typeof body.weaviateToken === "string" ? body.weaviateToken : "",
      rerankToken: typeof body.rerankToken === "string" ? body.rerankToken : "",
      documentFilter,
      searchProperties,
      collapseRepeats,
      rerankMaxChars,
      rerankMaxDocs,
      rerankBudgetMs,
    },
  };
}

/** `{ sourceIds: [...], sources: [...] }` with non-empty strings only, or null when neither list has an entry. */
function normaliseDocumentFilter(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const list = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))];
  const sourceIds = list(raw.sourceIds);
  const sources = list(raw.sources);
  if (sourceIds.length === 0 && sources.length === 0) return null;
  return { sourceIds, sources };
}

/**
 * Aggregation config (T09). Resolved from ragSettings alone: the aggregation
 * branch is an orchestrator intent override, so there is no top-level request
 * field for these (the orchestrator is the caller). Same fall-through rules as
 * the tuning knobs above; a boolean is taken only when it is a real boolean.
 */
function resolveAggregationConfig(ragSettings) {
  const rs = ragSettings && typeof ragSettings === "object" ? ragSettings : {};
  const d = RETRIEVAL_DEFAULTS;
  return {
    scanLimit: pickNumber(1, rs.aggregationScanLimit, d.aggregationScanLimit),
    countStemVariants:
      typeof rs.countStemVariants === "boolean" ? rs.countStemVariants : d.countStemVariants,
    evidenceLines: pickNumber(0, rs.aggregationEvidenceLines, d.aggregationEvidenceLines),
  };
}

/**
 * EMBED_MODEL_MISMATCH — the dimension-level guard (T08; the "enforceable
 * part" of T16, pulled forward). Cross-space queries previously died inside
 * Weaviate ("vector lengths don't match") and were swallowed into a silent
 * empty result set (F-19). Null on either side means "cannot judge" — an empty
 * collection has no pinnable dimensionality, a keyword query has no vector.
 */
function checkVectorDimMatch(queryDim, collectionDim, { embedModel, collection } = {}) {
  if (!queryDim || !collectionDim) return null;
  if (queryDim === collectionDim) return null;
  return {
    code: RETRIEVAL_ERROR_CODES.EMBED_MODEL_MISMATCH,
    message:
      `query was embedded to ${queryDim} dimensions by '${embedModel}', but collection ` +
      `'${collection}' holds ${collectionDim}-dimensional vectors — it was built by a ` +
      "different embedding model. Fix: set the embedding model to the one that built " +
      "the collection, or Tidy Up (clear) the collection and re-ingest every document " +
      `with '${embedModel}'.`,
  };
}

/**
 * T16 (design D2–D6): the ingest-time verdict against a collection's
 * embedding-space pin (the ledger's reducer, `getCollectionPin`). Pure: the
 * pin is data, `storeDim` is the class's LIVE dimension the route read.
 * Null means proceed. The truth table (D4):
 *   no pin / no name          → proceed (nothing to protect; the first landed record pins)
 *   provisional (not enforceable) → proceed (D5: a failed first ingest pins nothing)
 *   name matches              → proceed
 *   name differs, store dim == pin dim, or the class is empty / unreadable → 409
 *   name differs, store dim contradicts the pin → proceed (a stale pin never locks; the next landed record re-pins)
 * The message names BOTH fixes (D6): restore the pinned model, or Tidy Up and
 * re-ingest with the new one — never "re-ingest with the new model" alone,
 * which under v2 targets the same deterministic ids with vectors of another
 * dimension and is refused by Weaviate after the whole parse (measured,
 * t16-artifacts §0 step 3).
 */
function checkEmbedModelPinForIngest(pin, { embedModel, storeDim } = {}) {
  if (!pin || !pin.embedModel || !pin.enforceable) return null;
  const requested = typeof embedModel === "string" ? embedModel.trim() : "";
  if (requested === pin.embedModel) return null;
  const storeRead = Number.isFinite(storeDim) && storeDim > 0;
  if (storeRead && storeDim !== pin.embedDim) return null;
  return {
    code: RETRIEVAL_ERROR_CODES.EMBED_MODEL_MISMATCH,
    status: 409,
    message:
      `Collection '${pin.collection}' was built with embedding model '${pin.embedModel}' ` +
      `(${pin.embedDim} dimensions, recorded ${pin.pinnedAt ?? "at an unknown time"}); this request names '${requested}'. ` +
      `Nothing was ingested. Fix: set the embedding model back to '${pin.embedModel}', or Tidy Up (clear) ` +
      `the collection and re-ingest every document with '${requested}'.` +
      (storeRead ? "" : " (The class's live vector dimension could not be read to confirm this — the store may be empty or unreachable.)") +
      mixedRecordNote(pin),
    pin: { embedModel: pin.embedModel, embedDim: pin.embedDim, pinnedAt: pin.pinnedAt ?? null, modelsSeen: Array.isArray(pin.modelsSeen) ? [...pin.modelsSeen] : [] },
  };
}

/**
 * T16 (design D7 / D8): the retrieve-time verdict — the case T08's dimension
 * guard cannot see, the SAME dimension under another model name. A
 * degradation on the 200 (the results are real; what a wrong-space vector
 * arm costs is recall), never an error. Null when there is no enforceable
 * pin (a class with no record is `no_pin` — T08's guard is its whole
 * protection), when the name matches, or when the dimensions differ (that
 * is T08's guard's: if the query reached here the STORE agreed with it, so
 * the pin is behind and the next write re-pins).
 */
function checkEmbedModelPinForQuery(pin, { embedModel, queryDim } = {}) {
  if (!pin || !pin.embedModel || !pin.enforceable) return null;
  const requested = typeof embedModel === "string" ? embedModel.trim() : "";
  if (requested === pin.embedModel) return null;
  if (Number.isFinite(queryDim) && queryDim > 0 && queryDim !== pin.embedDim) return null;
  return retrievalDegradation(
    RETRIEVAL_ERROR_CODES.EMBED_MODEL_MISMATCH,
    "embed",
    `the query was embedded by '${requested}' but collection '${pin.collection}' was indexed by ` +
      `'${pin.embedModel}' (same ${pin.embedDim} dimensions, so the store cannot tell them apart); ` +
      "vector similarity between the two spaces is meaningless and relevant passages may be missing. " +
      `Fix: set the embedding model to '${pin.embedModel}'.` +
      mixedRecordNote(pin)
  );
}

function mixedRecordNote(pin) {
  return Array.isArray(pin.modelsSeen) && pin.modelsSeen.length > 1
    ? ` The record names more than one model (${pin.modelsSeen.join(", ")}), written before this check existed or by a pod running older code.`
    : "";
}

/**
 * T16: `report.embedSpace` — what the retrieve route compared, on every
 * vector-bearing response, so the trace drawer and the eval harness can see
 * it. `verdict`: match | name_mismatch | no_pin | stale_pin (the store agreed
 * with the query's dimension and the ledger's pin did not — the class was
 * rebuilt out of band). `pinSource` is the pin's own source unless the
 * caller says why there is none (`ledger_unavailable`).
 */
function buildEmbedSpaceReport(pin, { embedModel, queryDim, pinSource } = {}) {
  const queryModel = typeof embedModel === "string" ? embedModel.trim() : null;
  const dim = Number.isFinite(queryDim) && queryDim > 0 ? queryDim : null;
  const pinned = pin && pin.embedModel ? pin : null;
  let verdict = "no_pin";
  if (pinned && pinned.enforceable) {
    if (queryModel === pinned.embedModel) verdict = "match";
    else if (dim !== null && pinned.embedDim !== null && dim !== pinned.embedDim) verdict = "stale_pin";
    else verdict = "name_mismatch";
  }
  return {
    queryModel,
    queryDim: dim,
    pinnedModel: pinned ? pinned.embedModel : null,
    pinnedDim: pinned ? pinned.embedDim ?? null : null,
    pinSource: pinSource ?? (pinned ? pinned.source ?? null : null),
    verdict,
  };
}

/**
 * Similarity is derived, never fabricated: a row without a real distance has
 * NO similarity (null) — pre-T08 it was forced to 1.0, which let every
 * hybrid/BM25 row through any threshold (F-8).
 */
function similarityFromDistance(rawDistance) {
  if (rawDistance === null || rawDistance === undefined) return null;
  const d = parseFloat(rawDistance);
  return Number.isFinite(d) ? 1 - d : null;
}

/**
 * similarityThreshold has per-mode semantics: only vector search returns a
 * true distance, so only vector search is filtered by it. Hybrid and BM25
 * results rely on the rerank floor (minRerankScore) instead. Rows whose
 * similarity is null are kept — "cannot judge" must not silently drop rows.
 */
function filterBySimilarity(items, searchStrategy, similarityThreshold) {
  if (searchStrategy !== "vector") return items;
  if (!(similarityThreshold > 0)) return items;
  return items.filter(
    (item) =>
      item.similarity === null ||
      item.similarity === undefined ||
      Number.isNaN(item.similarity) ||
      item.similarity >= similarityThreshold
  );
}

/**
 * The retrieval report — ticket T13 (§9 of the target architecture).
 *
 * A caller of /api/rag/retrieve could not previously see what the search
 * actually did: which pool depth ran (E17/FM-T1 — turning the reranker off
 * silently changed it), whether the relevance floor executed, or whether the
 * scores it is looking at are real. The report answers those questions from
 * the two sources that cannot lie about them:
 *
 *   - RESOLVED config (`cfg` — the resolveRetrievalConfig output): what the
 *     route decided to do. NEVER the raw request body, which deliberately
 *     omits unset keys — reading it from a trace builder is exactly how F-25
 *     converted a successful retrieval into a silent zero-chunk answer.
 *   - MEASURED values: what then actually happened (candidate count, result
 *     count, whether the floor ran, the score distribution).
 *
 * It deliberately does NOT restate whether the scores were produced by the
 * configured reranker — that is `degraded[]`'s job (T12); one fact, one field.
 * `scoreStats.allEqual` is worth a reader's attention: a full result set at
 * one identical score is FM-N1's collapse signature (F-26 measured it as
 * 8 × exactly 0.5 from a dead reranker).
 *
 * `nullScoreCount` counts result rows carrying no numeric rerankScore. Until
 * T10's null-score contract lands nothing scores a candidate `null` on
 * failure, so today it is non-zero only when reranking did not run at all —
 * do not read 0 as "the reranker scored everything".
 *
 * @param {object} args
 * @param {object} args.cfg               a RESOLVED config — never a request body
 * @param {number} args.candidatesReturned  pool rows the search returned (post
 *                                          similarity filter — vector mode only,
 *                                          a no-op for hybrid/keyword)
 * @param {Array}  args.results           the rows the response will carry
 * @param {boolean} args.floorApplied     whether the floor named by
 *                                        cfg.floorSource actually executed
 * @param {number} [args.candidatesScored] how many candidates the reranker
 *                                        actually scored; omit (or pass a
 *                                        non-number) when reranking did not
 *                                        run, which reports `null` rather
 *                                        than a fabricated 0
 */
function buildRetrievalReport({ cfg, candidatesReturned, results, floorApplied, candidatesScored, credentialSources, documentFilter = null, searchMode, searchProperties, repeatsCollapsed = null }) {
  const rows = Array.isArray(results) ? results : [];
  const realScores = rows
    .map((r) => r?.rerankScore)
    .filter((s) => typeof s === "number" && Number.isFinite(s));
  const nullScoreCount = rows.length - realScores.length;

  let scoreStats = null;
  if (realScores.length > 0) {
    const distinct = new Set(realScores).size;
    scoreStats = {
      count: realScores.length,
      min: Math.min(...realScores),
      max: Math.max(...realScores),
      mean: realScores.reduce((a, b) => a + b, 0) / realScores.length,
      distinct,
      // Meaningful only across >1 score; a single score is trivially "equal".
      allEqual: realScores.length > 1 && distinct === 1,
    };
  }

  return {
    searchStrategy: cfg.searchStrategy,
    // T23 (design D4): which credential SOURCE served each hop — `request`
    // (the caller's own field), `env` (the Secret, bound to that origin),
    // `workload` (the pod's service-account token; the store only) or
    // `none`; null for a hop this call did not make. Names only, never a
    // value — F-22's failure is a silent 403, so the source has to be
    // visible where the scores are. Additive; absent when the caller
    // resolved nothing.
    ...(credentialSources ? { credentialSources } : {}),
    // Cut-over review (§11b M9, T13's rule): the class this retrieve READ and
    // the version it resolved — observed on the response, so a harness can
    // check the class it believes it measured against the one served.
    collection: cfg.weaviateCollection,
    schemaVersion: cfg.schemaVersion,
    // The exact `limit` handed to the vector store — the resolver's poolSize,
    // which is what makes the FM-T1 gate assertable (I-RETRIEVE).
    searchLimitUsed: cfg.poolSize,
    // T15 (design D4): the document filter this call applied — what was
    // requested, which property carried it (`sourceId` exact, or `source`
    // token-matched and post-checked), and how many candidates the exact
    // post-check dropped. null when the request carried no filter.
    documentFilter: documentFilter ?? null,
    // T40 (design D3, D6): what the KEYWORD half scored. `keywordHalf` is
    // whether a BM25 half ran at all (false for a pure vector search);
    // `properties` is the list the store was asked for after the intersection
    // with the class's own (null when unrestricted — the pre-T40 clause, every
    // searchable property); `unrestricted` says so in one word. Measured from
    // the search that ran when the route supplies it, else derived from the
    // resolved config.
    searchProperties: (() => {
      const mode = typeof searchMode === "string" ? searchMode : cfg.searchStrategy;
      const keywordHalf = mode !== "vector";
      const props = searchProperties !== undefined ? searchProperties : Array.isArray(cfg.searchProperties) ? [...cfg.searchProperties] : null;
      return { keywordHalf, properties: keywordHalf ? (Array.isArray(props) ? props : null) : null, unrestricted: keywordHalf && props === null };
    })(),
    // T40 (design D7; F-155): identical text is shown once — how many rows the
    // collapse dropped and which (survivor and dropped, by source / page /
    // chunkIndex), with `applied` false when the request switched the stage
    // off (a count turn, A9). null when a report is built without it.
    repeatsCollapsed: repeatsCollapsed ?? null,
    candidatesReturned: Number.isFinite(candidatesReturned) ? candidatesReturned : rows.length,
    resultsReturned: rows.length,
    keepTopNAfterRerank: cfg.keepTopNAfterRerank,
    rerankEffective: cfg.rerankEffective,
    thresholdApplied: {
      floorSource: cfg.floorSource,
      minRerankScore: cfg.minRerankScore,
      similarityThreshold: cfg.similarityThreshold,
      floorApplied: Boolean(floorApplied),
    },
    nullScoreCount,
    // T10: how many CANDIDATES the reranker actually scored, measured before
    // the floor and the slice. `nullScoreCount` describes the rows the caller
    // received; this describes the work that produced them, which is what
    // separates "nothing was ranked" (RERANK_DOWN) from "the ranking is real
    // but incomplete" (RERANK_PARTIAL). `null` — not 0 — when reranking did
    // not run, because 0 would assert a measurement of work never attempted
    // (E31, the same rule as `durationSource: "unavailable"`).
    candidatesScored: Number.isFinite(candidatesScored) ? candidatesScored : null,
    scoreStats,
  };
}

/**
 * Classify a /api/rag/retrieve response into ONE retrieval outcome (T12).
 *
 * This is the whole of F-8's remaining half. Pre-T12 the orchestrator inferred
 * the outcome from `retrievedChunks.length`, so four different things —
 * retrieval failed, retrieval was refused, retrieval succeeded and found
 * nothing, retrieval succeeded but was not ranked — produced one answer: "the
 * document doesn't mention it". Kept pure so every branch is pinned by a unit
 * test rather than only reachable with live infrastructure down.
 *
 * @param {{ok:boolean, status:number, body:object|null}} res
 */
function classifyRetrievalOutcome(res) {
  const { ok, status, body } = res || {};

  if (!ok || !body || body.success !== true) {
    return {
      state: "failed",
      code: body?.code || RETRIEVAL_ERROR_CODES.RETRIEVE_INTERNAL,
      message:
        body?.error || `the retrieval endpoint returned HTTP ${status} with no usable body`,
      chunkCount: 0,
    };
  }

  const results = Array.isArray(body.results) ? body.results : [];
  const degradations = Array.isArray(body.degraded) ? body.degraded : [];

  if (degradations.length > 0 && results.length > 0) {
    return {
      state: "degraded",
      code: degradations[0].code,
      message: degradations[0].message,
      chunkCount: results.length,
    };
  }

  if (results.length > 0) {
    return { state: "ok", code: null, message: null, chunkCount: results.length };
  }

  // Zero results is a LEGITIMATE outcome since T08 gave retrieval a real
  // relevance floor — the search ran and nothing cleared it. Treating this as
  // an error (or as proof the corpus lacks the content) is the bug T12 removes.
  return {
    state: "empty",
    code: null,
    message:
      "the search ran successfully and returned no passage above the relevance threshold" +
      (degradations.length ? `; additionally, ${degradations[0].message}` : ""),
    chunkCount: 0,
  };
}

/**
 * The prompt block for a retrieval outcome (T12).
 *
 * `empty` is the ONLY state in which telling the user the documents do not
 * cover something is honest. In `failed` nothing was searched, so any claim
 * about what the corpus contains — including a denial — is a fabrication.
 */
function buildRetrievalPromptBlock(retrieval, contextText = "") {
  switch (retrieval?.state) {
    case "failed":
      return (
        `[RETRIEVAL FAILED — NO CONTEXT AVAILABLE]\n` +
        `Retrieval failed (${retrieval.code}); do not claim the document lacks content.\n` +
        `Details: ${retrieval.message}\n\n` +
        `CRITICAL INSTRUCTIONS FOR THIS TURN:\n` +
        `- The document store could NOT be searched. You therefore know NOTHING about whether the ingested documents contain the answer.\n` +
        `- You MUST NOT say the documents do not mention the subject, do not contain it, or that no specification exists for it. That would be a fabrication: no search took place.\n` +
        `- You MUST NOT answer from general knowledge, or invent specifications, dimensions, page numbers or quotations.\n` +
        `- Tell the user plainly that document retrieval failed, state the error code ${retrieval.code}, and suggest retrying once the service is available.\n\n`
      );

    case "empty":
      return (
        `[NO RELEVANT PASSAGES FOUND]\n` +
        `The document store was searched successfully and ${retrieval.message}.\n\n` +
        `INSTRUCTIONS FOR THIS TURN:\n` +
        `- Retrieval WORKED; the corpus simply contains nothing matching this query closely enough to be relevant.\n` +
        `- It is correct and expected to tell the user the ingested documents do not appear to cover this.\n` +
        `- Do NOT invent an answer, and do NOT cite documents, pages or figures — none were retrieved.\n\n`
      );

    // T10: a PARTIAL failure is a different instruction from a total one. The
    // ordering of the scored passages is real and worth using; only the tail is
    // unchecked. Telling the model to disregard order entirely would throw away
    // ranking the reranker actually did.
    // T16 (design D11): a wrong-SPACE vector arm is a third instruction. The
    // reranker did rank what came back, so "treat the order as meaningless"
    // would throw away real ranking; what the wrong space costs is RECALL —
    // passages that should be here may be missing, and the model must not
    // turn their absence into a claim about the corpus.
    case "degraded":
      if (retrieval.code === RETRIEVAL_ERROR_CODES.EMBED_MODEL_MISMATCH) {
        return (
          `[WARNING — CONTEXT MAY BE INCOMPLETE (${retrieval.code})]\n` +
          `The passages below were retrieved, but ${retrieval.message}\n` +
          `The vector search used a different embedding model from the one that indexed the collection, so relevant ` +
          `passages may be MISSING here.\n` +
          `You MUST NOT say the documents do not mention or lack something merely because it is absent from these ` +
          `passages — retrieval may have missed it. If none addresses the question, say so plainly and tell the user ` +
          `to set the embedding model back to the one named above.\n\n` +
          contextText
        );
      }
      if (retrieval.code === RETRIEVAL_ERROR_CODES.RERANK_PARTIAL) {
        return (
          `[WARNING — SOME CONTEXT NOT RELEVANCE-CHECKED (${retrieval.code})]\n` +
          `The passages below were retrieved, but ${retrieval.message}\n` +
          `The unchecked passages are listed LAST. Their position carries no relevance information: ` +
          `do not assume such a passage is relevant just because it was retrieved. ` +
          `If none of the passages actually addresses the question, say so plainly rather than ` +
          `answering from the closest-looking one.\n\n` +
          contextText
        );
      }
      return (
        `[WARNING — CONTEXT NOT RELEVANCE-RANKED (${retrieval.code})]\n` +
        `The passages below were retrieved, but ${retrieval.message}\n` +
        `Treat their ORDER as meaningless and do not assume a passage is relevant just because it was retrieved. ` +
        `If none of them actually addresses the question, say so plainly rather than answering from the closest-looking passage.\n\n` +
        contextText
      );

    case "ok":
      return contextText;

    default:
      return "";
  }
}

module.exports = {
  RETRIEVAL_DEFAULTS,
  RAG_SETTINGS_DEFAULTS,
  RAG_SETTINGS_API_ONLY_KEYS,
  DUPLICATE_POLICIES,
  SEARCH_MODES,
  RERANK_PROPERTIES,
  PAGE_COMPANION_MODES,
  ENUMERATION_SCOPES,
  LOOKUP_SCOPES,
  LOOKUP_DOCUMENT_READS,
  DETAIL_PASS_MODES,
  OCR_MODES,
  normaliseDocumentFilter,
  SEARCHABLE_V1_PROPERTIES,
  SEARCH_PROPERTIES_UNRESTRICTED,
  normaliseSearchProperties,
  CONTEXT_ASSEMBLY_CONSTANTS,
  loadRagSettings,
  resolveContextConfig,
  resolveAnswerPolicyConfig,
  BEYOND_THE_DOCUMENTS_MODES,
  RETRIEVAL_ERROR_CODES,
  retrievalErrorBody,
  retrievalDegradation,
  classifyRetrievalOutcome,
  buildRetrievalPromptBlock,
  buildRetrievalReport,
  resolveRetrievalConfig,
  resolveAggregationConfig,
  normaliseSchemaVersion,
  collectionNameForVersion,
  resolveSchemaVersion,
  checkVectorDimMatch,
  checkEmbedModelPinForIngest,
  checkEmbedModelPinForQuery,
  buildEmbedSpaceReport,
  similarityFromDistance,
  filterBySimilarity,
};
