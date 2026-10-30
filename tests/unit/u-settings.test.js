/**
 * U-SETTINGS — the bidirectional key-liveness test (ticket T17; audit E39 /
 * E11, FM-N3; findings F-21, F-82, F-83, F-84).
 *
 * Measured in-pod before this ticket (t17-design.md §0, 2026-09-06): the
 * admin panel's blob carried 44 keys of which 26 were read by nothing;
 * page.js's own literal set `minRerankScore: 0.0`, which the resolver reads
 * as "an explicit zero disables the floor", so every demo chat turn ran
 * without T08's calibrated floor while every eval leg measured it; the blob
 * was written to localStorage and never loaded; a legacy trio of page states
 * copied three blob values and won precedence over them.
 *
 * The contract these cases pin: ONE table (`RAG_SETTINGS_DEFAULTS` in
 * src/lib/rag/config.js) is what the drawer renders and what the server
 * reads — every key has a control AND a reader, every key a server reads
 * off the blob is in the table or on the API-only list, and no key the
 * table does not have is rendered anywhere. Source walks over comment-
 * stripped code, the U-DESTRUCT way (a pin satisfied by prose about code is
 * no pin). The drawer's rendering is not verifiable here (F-37, no component
 * harness) — its wiring is pinned structurally, the recorded compromise.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  RAG_SETTINGS_DEFAULTS,
  RAG_SETTINGS_API_ONLY_KEYS,
  RETRIEVAL_DEFAULTS,
  DUPLICATE_POLICIES,
  SEARCH_MODES,
  RERANK_PROPERTIES,
  loadRagSettings,
  resolveContextConfig,
  resolveRetrievalConfig,
  resolveAggregationConfig,
  resolveSchemaVersion,
  collectionNameForVersion,
} = require("../../src/lib/rag/config");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(REPO_ROOT, "src");
const FILES = {
  config: path.join(SRC, "lib", "rag", "config.js"),
  orchestrator: path.join(SRC, "lib", "orchestrator.js"),
  ingest: path.join(SRC, "app", "api", "ingest", "route.js"),
  parser: path.join(SRC, "lib", "ingestion", "parser.js"),
  page: path.join(SRC, "app", "page.js"),
  drawer: path.join(SRC, "components", "AdminDrawer.jsx"),
};

/** Strip comments so a pin is satisfied by code, never by prose about code. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}
function read(file) {
  return codeOnly(fs.readFileSync(file, "utf-8"));
}
const DEFAULT_KEYS = Object.keys(RAG_SETTINGS_DEFAULTS);

/**
 * The reader sites, by the variable each reader uses for the blob:
 *   config.js       rs.<k>            (the resolvers)
 *   orchestrator.js ragSettings?.<k>  (the prompt-assembly and summary reads)
 *   ingest route    config.<k> / config?.<k> / ragSettings?.<k>
 *   parser.js       config.<k> / config?.<k>
 * Anything else that reads `config.` in those files (a resolved config, a
 * module named config) is not a blob read and is not matched: the variable
 * names are the contract, and a new reader must use one of them.
 */
const READER_SITES = {
  config: /\brs\??\.([A-Za-z_]+)/g,
  orchestrator: /\bragSettings\??\.([A-Za-z_]+)/g,
  ingest: /\b(?:config|ragSettings)\??\.([A-Za-z_]+)/g,
  parser: /\bconfig\??\.([A-Za-z_]+)/g,
};
function serverReads() {
  const reads = new Map(); // key -> Set of files
  for (const [key, rx] of Object.entries(READER_SITES)) {
    const src = read(FILES[key]);
    for (const m of src.matchAll(rx)) {
      if (!reads.has(m[1])) reads.set(m[1], new Set());
      reads.get(m[1]).add(key);
    }
  }
  return reads;
}

/** Every blob key the drawer renders or writes, by the three forms it uses. */
function drawerKeys() {
  const src = read(FILES.drawer);
  const keys = new Set();
  for (const m of src.matchAll(/\b(?:tempRagSettings|localRagSettings)\.([A-Za-z_]+)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/updateRagSetting\("([A-Za-z_]+)"/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\.\.\.localRagSettings,\s*([A-Za-z_]+):/g)) keys.add(m[1]);
  return keys;
}

describe("U-SETTINGS: one table, read by the server and rendered by the drawer", () => {
  test("the table exists, is frozen, and has the keys the design names (D1, D8)", () => {
    assert.ok(Object.isFrozen(RAG_SETTINGS_DEFAULTS));
    assert.deepStrictEqual(
      [...DEFAULT_KEYS].sort(),
      [
        "aggregationEvidenceLines", "aggregationScanLimit", "allowedFileTypes", "beyondTheDocuments", "candidatesToRerank", "captionFigures",
        "captionPageBudget", "chunkOverlap", "chunkSize", "countStemVariants", "detailPasses", "documentContextBudget", "duplicatePolicy",
        "embedBatchSize", "embedConcurrency", "enumerationScope", "hybridAlpha", "keepTopNAfterRerank",
        "lookupDocumentRead", "lookupScope", "maxContextChunks", "maxFileSize", "metadataExtraction", "minChunkSize", "minRerankScore",
        "ocrNoTextPages", "pageCompanions", "rerankProperty", "rerankQueryOverride", "rerankerEnabled", "searchMode",
        "similarityThreshold", "topKRetrieval",
      ]
    );
  });

  test("E39: none of the 26 dead knobs, nor the page's dead states, is in the table", () => {
    const DEAD = [
      "ocrEnabled", "languageDetection", "batchIngestSize", "boilerplateRemoval", "tableHandling",
      "imageCaptionExtraction", "piiRedaction", "titleSource", "chunkingStrategy", "maxChunkSize",
      "respectPageBoundaries", "splitOnHeadings", "mergeShortChunks", "storeParentChildLinks",
      "embedSourceProperties", "vectorizePropertyNames", "vectorizeClassName", "skipNoisyProperties",
      "poolingStrategy", "namedVectors", "fusionStrategy", "queryProperties", "metadataFilters",
      "groupByDocument", "returnFields", "contextAssemblyMode",
    ];
    assert.strictEqual(DEAD.length, 26);
    for (const k of DEAD) assert.ok(!(k in RAG_SETTINGS_DEFAULTS), `${k} is still a default`);
  });

  test("every key of the table is READ by server code (no dead default)", () => {
    const reads = serverReads();
    const dead = DEFAULT_KEYS.filter((k) => !reads.has(k));
    assert.deepStrictEqual(dead, [], `defaults nothing on the server reads: ${dead.join(", ")}`);
  });

  test("every key a server reads off the blob is in the table or on the API-only list (no hidden knob)", () => {
    const reads = serverReads();
    const known = new Set([...DEFAULT_KEYS, ...RAG_SETTINGS_API_ONLY_KEYS]);
    const hidden = [...reads.keys()].filter((k) => !known.has(k));
    assert.deepStrictEqual(hidden, [], `blob keys read on the server with no default and no API-only listing: ${hidden.map((k) => `${k} (${[...reads.get(k)].join(", ")})`).join(", ")}`);
  });

  test("the API-only list names the identity fields and overrides the design lists (D7, §8), and none of them is also a default", () => {
    assert.deepStrictEqual(
      [...RAG_SETTINGS_API_ONLY_KEYS].sort(),
      // T40 (design D3): searchProperties — the keyword half's property list, the harness's A/B and a caller's
      // hosting parameter; a correctness fix, not a preference, so API-only and never a drawer control.
      // T42 (design D7): rerankMaxChars / rerankMaxDocs / rerankBudgetMs — the rerank stage's per-request bounds and its
      // deadline (the enumeration profile's override, the harness's A/B); one right answer, so API-only and no drawer control.
      ["autoProfile", "embedModel", "embedUrl", "ollamaUrl", "rerankBudgetMs", "rerankMaxChars", "rerankMaxDocs", "rerankModel", "rerankUrl", "schemaVersion", "searchProperties", "vlmApiKey", "vlmEndpointUrl", "vlmModelName", "weaviateCollection", "weaviateUrl"]
    );
    for (const k of RAG_SETTINGS_API_ONLY_KEYS) assert.ok(!(k in RAG_SETTINGS_DEFAULTS), `${k} is both API-only and a default`);
  });

  test("the drawer renders every default key, and no key outside the table (no knob nobody reads, no default nobody can set)", () => {
    const rendered = drawerKeys();
    const unrendered = DEFAULT_KEYS.filter((k) => !rendered.has(k));
    const outside = [...rendered].filter((k) => !(k in RAG_SETTINGS_DEFAULTS));
    assert.deepStrictEqual(unrendered, [], `defaults with no control: ${unrendered.join(", ")}`);
    assert.deepStrictEqual(outside, [], `controls for keys the table does not have: ${outside.join(", ")}`);
    assert.ok(rendered.size >= 20, "the walk saw the drawer's controls");
  });

  test("the retrieval keys are REFERENCES into RETRIEVAL_DEFAULTS, so the blob cannot disagree with the resolver (F-83)", () => {
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.minRerankScore, RETRIEVAL_DEFAULTS.minRerankScore);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.similarityThreshold, RETRIEVAL_DEFAULTS.similarityThreshold);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.topKRetrieval, RETRIEVAL_DEFAULTS.limit);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.searchMode, RETRIEVAL_DEFAULTS.searchStrategy);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.rerankerEnabled, RETRIEVAL_DEFAULTS.rerankEnabled);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.hybridAlpha, RETRIEVAL_DEFAULTS.hybridAlpha);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.candidatesToRerank, RETRIEVAL_DEFAULTS.candidatesToRerank);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.keepTopNAfterRerank, RETRIEVAL_DEFAULTS.keepTopNAfterRerank);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.rerankProperty, RETRIEVAL_DEFAULTS.rerankProperty);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.rerankQueryOverride, RETRIEVAL_DEFAULTS.rerankQueryOverride);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.aggregationScanLimit, RETRIEVAL_DEFAULTS.aggregationScanLimit);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.countStemVariants, RETRIEVAL_DEFAULTS.countStemVariants);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.aggregationEvidenceLines, RETRIEVAL_DEFAULTS.aggregationEvidenceLines);
    // The four values the page and the server disagreed on, resolved (D1 §1).
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.minRerankScore, 0.05);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.similarityThreshold, 0.7);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.topKRetrieval, 100);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.maxContextChunks, RETRIEVAL_DEFAULTS.keepTopNAfterRerank);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.maxContextChunks, 8);
    // The ingestion values did not move (no docVersion moves for the demo).
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.chunkSize, 600);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.chunkOverlap, 80);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.minChunkSize, 150);
  });

  test("a request carrying the whole blob resolves to the resolver's own defaults — the floor is ON (F-83's case)", () => {
    const r = resolveRetrievalConfig({ embedUrl: "http://e/v1", embedModel: "m", ragSettings: RAG_SETTINGS_DEFAULTS });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.config.minRerankScore, RETRIEVAL_DEFAULTS.minRerankScore);
    assert.strictEqual(r.config.similarityThreshold, RETRIEVAL_DEFAULTS.similarityThreshold);
    assert.strictEqual(r.config.limit, RETRIEVAL_DEFAULTS.limit);
    assert.strictEqual(r.config.searchStrategy, RETRIEVAL_DEFAULTS.searchStrategy);
    assert.strictEqual(r.config.floorSource, "rerank");
    const agg = resolveAggregationConfig(RAG_SETTINGS_DEFAULTS);
    assert.deepStrictEqual(agg, { scanLimit: 500, countStemVariants: false, evidenceLines: 80 });
    assert.strictEqual(resolveContextConfig(RAG_SETTINGS_DEFAULTS).maxContextChunks, 8);
  });

  test("T28: the three assembly keys — defaults, the enumerated values, the loader's whitelist, the resolver's fall-through (t28-design D4, D19)", () => {
    const { PAGE_COMPANION_MODES, ENUMERATION_SCOPES, CONTEXT_ASSEMBLY_CONSTANTS } = require("../../src/lib/rag/config");
    assert.deepStrictEqual([...PAGE_COMPANION_MODES], ["off", "captions", "page"]);
    assert.deepStrictEqual([...ENUMERATION_SCOPES], ["off", "document"]);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.pageCompanions, "captions");
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.enumerationScope, "document");
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.documentContextBudget, 80000);
    assert.deepStrictEqual(CONTEXT_ASSEMBLY_CONSTANTS, { COMPANION_BUDGET_FACTOR: 1, COMPANION_TEXT_PER_PAGE: 4, CHARS_PER_TOKEN: 3.2, MEAN_CHARS_PER_CHUNK: 800, HEADER_CHARS_PER_BLOCK: 120, SCOPE_DOMINANCE_SHARE: 0.5 });
    const r = resolveContextConfig({ pageCompanions: "page", enumerationScope: "off", documentContextBudget: 40000 });
    assert.deepStrictEqual(r, { maxContextChunks: 8, pageCompanions: "page", enumerationScope: "off", documentContextBudget: 40000, lookupScope: "document", lookupDocumentRead: "whole" });
    const junk = resolveContextConfig({ pageCompanions: "sometimes", enumerationScope: 1, documentContextBudget: -5, lookupScope: "maybe" });
    assert.deepStrictEqual(junk, { maxContextChunks: 8, pageCompanions: "captions", enumerationScope: "document", documentContextBudget: 80000, lookupScope: "document", lookupDocumentRead: "whole" });
    assert.strictEqual(loadRagSettings({ pageCompanions: "off" }).pageCompanions, "off");
    assert.strictEqual(loadRagSettings({ pageCompanions: "nope" }).pageCompanions, "captions");
    assert.strictEqual(loadRagSettings({ enumerationScope: "off" }).enumerationScope, "off");
    assert.strictEqual(loadRagSettings({ enumerationScope: "all" }).enumerationScope, "document");
    assert.strictEqual(loadRagSettings({ documentContextBudget: 20000 }).documentContextBudget, 20000);
    assert.strictEqual(loadRagSettings({ documentContextBudget: "20000" }).documentContextBudget, 80000);
  });

  test("T15: the lookupScope key — default, the two values, the loader's whitelist, the resolver's fall-through, the drawer control (t15-design D4, D12)", () => {
    const { LOOKUP_SCOPES } = require("../../src/lib/rag/config");
    assert.deepStrictEqual([...LOOKUP_SCOPES], ["off", "document"]);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.lookupScope, "document");
    assert.strictEqual(DEFAULT_KEYS.length, 33, "26 keys at T28 + lookupScope (T15) + captionFigures (T24) + captionPageBudget (T31) + detailPasses (T33) + ocrNoTextPages (T35) + beyondTheDocuments (T48) + lookupDocumentRead (T63)");
    assert.strictEqual(resolveContextConfig({ lookupScope: "off" }).lookupScope, "off");
    assert.strictEqual(resolveContextConfig({ lookupScope: "all" }).lookupScope, "document");
    assert.strictEqual(loadRagSettings({ lookupScope: "off" }).lookupScope, "off");
    assert.strictEqual(loadRagSettings({ lookupScope: 2 }).lookupScope, "document");
    assert.match(read(FILES.drawer), /id="ks_lookupScope"/);
    assert.match(read(FILES.drawer), /localRagSettings\.lookupScope/);
  });

  test("T63: the lookupDocumentRead key — default whole, the two values, the loader's whitelist, the resolver's fall-through, the drawer control; the budget stays documentContextBudget, one number for both whole-document paths (t63-design D3 (a), D7 (a))", () => {
    const { LOOKUP_DOCUMENT_READS } = require("../../src/lib/rag/config");
    assert.deepStrictEqual([...LOOKUP_DOCUMENT_READS], ["whole", "ranked"]);
    assert.ok(Object.isFrozen(LOOKUP_DOCUMENT_READS));
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.lookupDocumentRead, "whole");
    assert.strictEqual(resolveContextConfig({}).lookupDocumentRead, "whole");
    assert.strictEqual(resolveContextConfig({ lookupDocumentRead: "ranked" }).lookupDocumentRead, "ranked");
    assert.strictEqual(resolveContextConfig({ lookupDocumentRead: "document" }).lookupDocumentRead, "whole", "an unlisted value falls through to the default");
    assert.strictEqual(loadRagSettings({ lookupDocumentRead: "ranked" }).lookupDocumentRead, "ranked");
    assert.strictEqual(loadRagSettings({ lookupDocumentRead: "all" }).lookupDocumentRead, "whole");
    assert.strictEqual(loadRagSettings({ lookupDocumentRead: 1 }).lookupDocumentRead, "whole");
    assert.ok(!Object.keys(RAG_SETTINGS_DEFAULTS).some((k) => /^lookup\w*Budget$/.test(k)), "no separate lookup budget (D3 (a) / D7 (a))");
    assert.match(read(FILES.drawer), /id="ks_lookupDocumentRead"/);
    assert.match(read(FILES.drawer), /localRagSettings\.lookupDocumentRead/);
    assert.match(read(FILES.drawer), /<option value="whole">[^<]+<\/option>\s*<option value="ranked">[^<]+<\/option>/);
    assert.match(read(FILES.orchestrator), /setting: assemblyConfig\.lookupDocumentRead,/, "the orchestrator's gate reads the resolved key");
  });

  test("T24: the captionFigures key — default on, boolean-typed by the loader, read by the parser, a Documents-card toggle in the drawer, the old dead name still dead (t24-design D6)", () => {
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.captionFigures, true);
    assert.strictEqual(loadRagSettings(JSON.stringify({ captionFigures: false })).captionFigures, false);
    assert.strictEqual(loadRagSettings(JSON.stringify({ captionFigures: "no" })).captionFigures, true, "a wrong type falls back to the default");
    assert.strictEqual(loadRagSettings(null).captionFigures, true);
    assert.ok(serverReads().get("captionFigures")?.has("parser"), "the parser reads the switch");
    assert.ok(drawerKeys().has("captionFigures"), "the drawer renders the toggle");
    const dr = read(FILES.drawer);
    assert.match(dr, /updateRagSetting\("captionFigures", e\.target\.checked\)/);
    assert.match(dr, /Caption Figures/);
    assert.ok(!("imageCaptionExtraction" in RAG_SETTINGS_DEFAULTS), "T17's dead name did not come back");
    assert.ok(!/imageCaptionExtraction/.test(dr), "the drawer never names the dead key");
  });

  test("T31: the captionPageBudget key — default 0 (every page), a non-negative integer by the loader, read by the parser, a Documents-card number input in the drawer (multimodal-workshop-design D5, D9)", () => {
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.captionPageBudget, 0);
    assert.strictEqual(loadRagSettings(JSON.stringify({ captionPageBudget: 10 })).captionPageBudget, 10);
    assert.strictEqual(loadRagSettings({ captionPageBudget: 0 }).captionPageBudget, 0);
    for (const junk of [-1, 2.5, "3", "all", null, true, NaN, Infinity]) {
      assert.strictEqual(loadRagSettings({ captionPageBudget: junk }).captionPageBudget, 0, `${JSON.stringify(junk)} is not a page budget: the default (no limit)`);
    }
    assert.strictEqual(loadRagSettings(null).captionPageBudget, 0);
    assert.ok(serverReads().get("captionPageBudget")?.has("parser"), "the parser reads the budget");
    assert.ok(drawerKeys().has("captionPageBudget"), "the drawer renders the control");
    const dr = read(FILES.drawer);
    assert.match(dr, /id="adv_captionPageBudget"/);
    assert.match(dr, /updateRagSetting\("captionPageBudget", Math\.max\(0, parseInt\(e\.target\.value, 10\) \|\| 0\)\)/, "a number input that cannot store a negative or a NaN");
    assert.match(dr, /Caption Page Budget/);
  });

  test("T48: the beyondTheDocuments key — default off, one of off | on by the loader (anything else the default), resolved by its own resolver (rs.beyondTheDocuments), a toggle beside Caption Figures that maps checked ↔ \"on\" (t48-design D4)", () => {
    const { BEYOND_THE_DOCUMENTS_MODES, resolveAnswerPolicyConfig } = require("../../src/lib/rag/config");
    const policy = require("../../src/lib/rag/answer_policy");
    assert.deepStrictEqual([...BEYOND_THE_DOCUMENTS_MODES], ["off", "on"]);
    assert.strictEqual(BEYOND_THE_DOCUMENTS_MODES, policy.BEYOND_THE_DOCUMENTS_MODES, "the table and the rules read ONE vocabulary — the pure module's");
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.beyondTheDocuments, "off", "P4: off by default");
    assert.strictEqual(loadRagSettings(JSON.stringify({ beyondTheDocuments: "on" })).beyondTheDocuments, "on");
    for (const junk of ["ON", "true", true, 1, null, "", ["on"], "all"]) assert.strictEqual(loadRagSettings({ beyondTheDocuments: junk }).beyondTheDocuments, "off", `${JSON.stringify(junk)} is not a listed value: the default`);
    assert.deepStrictEqual(resolveAnswerPolicyConfig({ beyondTheDocuments: "on" }), { beyondTheDocuments: "on" });
    for (const junk of [undefined, null, {}, { beyondTheDocuments: "maybe" }]) assert.deepStrictEqual(resolveAnswerPolicyConfig(junk), { beyondTheDocuments: "off" });
    assert.ok(serverReads().get("beyondTheDocuments")?.has("config"), "the resolver reads the key off the blob (rs.beyondTheDocuments)");
    assert.ok(drawerKeys().has("beyondTheDocuments"), "the drawer renders the toggle");
    assert.match(read(FILES.orchestrator), /const answerPolicyConfig = resolveAnswerPolicyConfig\(adminConfig\?\.ragSettings\);/, "the orchestrator resolves it per request");
  });

  test("T35: the ocrNoTextPages key — default auto, one of auto | off by the loader (anything else the default), read by the parser, a Documents-card select in the drawer that maps the module's list and names what a page without a text layer gets (t35-design D2, D3, D6–D8)", () => {
    const { OCR_MODES } = require("../../src/lib/rag/config");
    const ocr = require("../../src/lib/ingestion/ocr");
    assert.deepStrictEqual([...OCR_MODES], ["auto", "off"]);
    assert.strictEqual(OCR_MODES, ocr.OCR_MODES, "the table and the fingerprint read ONE vocabulary — the pure module's");
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.ocrNoTextPages, "auto");
    assert.strictEqual(loadRagSettings(JSON.stringify({ ocrNoTextPages: "off" })).ocrNoTextPages, "off");
    for (const junk of ["OFF", "sometimes", 1, true, null, "", ["off"], "all"]) assert.strictEqual(loadRagSettings({ ocrNoTextPages: junk }).ocrNoTextPages, "auto", `${JSON.stringify(junk)} is not a listed value: the default`);
    assert.strictEqual(loadRagSettings(null).ocrNoTextPages, "auto");
    assert.ok(serverReads().get("ocrNoTextPages")?.has("parser"), "the parser reads the mode");
    assert.ok(drawerKeys().has("ocrNoTextPages"), "the drawer renders the select");
    const dr = codeOnly(read(FILES.drawer));
    assert.match(dr, /id="adv_ocrNoTextPages"/);
    assert.match(dr, /OCR_MODES\.map\(\(mode\) => \(/, "the select maps the module's list, never a literal");
    assert.match(dr, /updateRagSetting\("ocrNoTextPages", e\.target\.value\)/);
    const tip = (fs.readFileSync(FILES.drawer, "utf-8").match(/id="adv_ocrNoTextPages" text="([^"]*)"/) || [])[1] || "";
    for (const phrase of ["no machine-readable text", "Only such pages are read", "never OCR'd", "page by page", "no model call", "Off leaves such a page with its caption only", "new version"]) assert.ok(tip.includes(phrase), `the tooltip says: ${phrase}`);
  });

  test("T33: the detailPasses key — default auto, one of auto | all | off by the loader (anything else the default), read by the parser, a Documents-card select in the drawer that maps the module's list and names how to widen (t33-design D1 option B + E, D6, §12b)", () => {
    const { DETAIL_PASS_MODES } = require("../../src/lib/rag/config");
    assert.deepStrictEqual([...DETAIL_PASS_MODES], ["auto", "all", "off"]);
    assert.strictEqual(RAG_SETTINGS_DEFAULTS.detailPasses, "auto");
    assert.strictEqual(loadRagSettings(JSON.stringify({ detailPasses: "all" })).detailPasses, "all");
    assert.strictEqual(loadRagSettings({ detailPasses: "off" }).detailPasses, "off");
    for (const junk of ["ALL", "sometimes", 1, true, null, "", ["all"]]) assert.strictEqual(loadRagSettings({ detailPasses: junk }).detailPasses, "auto", `${JSON.stringify(junk)} is not a listed value: the default`);
    assert.strictEqual(loadRagSettings(null).detailPasses, "auto");
    assert.ok(serverReads().get("detailPasses")?.has("parser"), "the parser reads the mode");
    assert.ok(drawerKeys().has("detailPasses"), "the drawer renders the select");
    const dr = read(FILES.drawer);
    assert.match(dr, /id="adv_detailPasses"/);
    assert.match(dr, /DETAIL_PASS_MODES\.map\(/, "the select maps the module's list");
    assert.match(dr, /updateRagSetting\("detailPasses", e\.target\.value\)/);
    assert.match(dr, /Detail Passes/);
    const tip = (fs.readFileSync(FILES.drawer, "utf-8").match(/id="adv_detailPasses" text="([^"]*)"/) || [])[1] || "";
    assert.match(tip, /switch to All and re-ingest/, "the tooltip says how to widen (§12b)");
    assert.match(tip, /never a per-document prompt|pre-set|at ingest/i);
    assert.ok(!/prompt(ed)? (the )?user|pause/i.test(tip), "no per-document prompt, no mid-job pause (§12b)");
    assert.match(dr, /import \{[^}]*\bDETAIL_PASS_MODES\b[^}]*\} from "@\/lib\/rag\/config"/);
  });

  test("resolveContextConfig: the blob's value, else the table's; junk falls through (D1)", () => {
    assert.strictEqual(resolveContextConfig({ maxContextChunks: 6 }).maxContextChunks, 6);
    assert.strictEqual(resolveContextConfig({ maxContextChunks: "not a number" }).maxContextChunks, 8);
    assert.strictEqual(resolveContextConfig({ maxContextChunks: 0 }).maxContextChunks, 8);
    assert.strictEqual(resolveContextConfig(undefined).maxContextChunks, 8);
    assert.strictEqual(resolveContextConfig(null).maxContextChunks, 8);
  });

  test("the orchestrator's context depth resolves through the module: no `|| 12` literal, no legacy top-level forwarding (D1, D3)", () => {
    const src = read(FILES.orchestrator);
    assert.match(src, /resolveContextConfig\(adminConfig\?\.ragSettings\)\.maxContextChunks/);
    assert.ok(!/maxContextChunks\s*\|\|\s*12\b/.test(src), "the orchestrator's fallback literal is gone");
    for (const legacy of ["weaviateLimit", "weaviateSimilarityThreshold", "weaviateSearchStrategy"]) {
      assert.ok(!new RegExp(`\\b${legacy}\\b`).test(src), `${legacy} is still forwarded by the orchestrator`);
    }
  });
});

describe("U-SETTINGS: the loader whitelists (D6, F-82) and the vocabulary is enumerated (D9)", () => {
  test("junk in, the defaults out — a parse failure, a non-object, null", () => {
    for (const raw of ["not json", "[1,2]", "42", null, undefined, 7, [], "null"]) {
      assert.deepStrictEqual(loadRagSettings(raw), loadRagSettings(RAG_SETTINGS_DEFAULTS), JSON.stringify(raw));
    }
    const fresh = loadRagSettings(null);
    assert.deepStrictEqual(Object.keys(fresh).sort(), [...DEFAULT_KEYS].sort());
    assert.ok(!Object.isFrozen(fresh), "the loader hands out a copy React can spread and the drawer can edit");
    assert.notStrictEqual(fresh.allowedFileTypes, RAG_SETTINGS_DEFAULTS.allowedFileTypes, "arrays are copied, not shared");
  });

  test("an OLD blob in (the 44-key shape with dead keys and a zero floor): whitelisted blob out", () => {
    const old = JSON.stringify({
      ocrEnabled: true, batchIngestSize: 50, embedSourceProperties: ["title", "content"], contextAssemblyMode: "score-desc",
      chunkSize: 900, chunkOverlap: 120, minChunkSize: 150, maxContextChunks: 6, topKRetrieval: 20,
      minRerankScore: 0.0, similarityThreshold: 0.0, rerankerEnabled: true, searchMode: "hybrid",
      allowedFileTypes: ["PDF", "MD"], duplicatePolicy: "skip",
    });
    const l = loadRagSettings(old);
    assert.deepStrictEqual(Object.keys(l).sort(), [...DEFAULT_KEYS].sort(), "unknown keys are dropped, every default key is present");
    assert.strictEqual(l.chunkSize, 900);
    assert.strictEqual(l.maxContextChunks, 6);
    assert.strictEqual(l.minRerankScore, 0, "a stored value of the right type is kept — the person's own zero is theirs");
    assert.deepStrictEqual(l.allowedFileTypes, ["PDF", "MD"]);
    assert.strictEqual(l.embedBatchSize, null, "absent → the default (auto)");
    assert.strictEqual(l.aggregationScanLimit, 500);
  });

  test("a wrong TYPE falls back to the default, key by key", () => {
    const l = loadRagSettings({ chunkSize: "600", rerankerEnabled: "true", allowedFileTypes: "PDF", hybridAlpha: NaN, maxFileSize: Infinity, minRerankScore: null });
    assert.strictEqual(l.chunkSize, 600);
    assert.strictEqual(l.rerankerEnabled, true);
    assert.deepStrictEqual(l.allowedFileTypes, [...RAG_SETTINGS_DEFAULTS.allowedFileTypes]);
    assert.strictEqual(l.hybridAlpha, 0.5);
    assert.strictEqual(l.maxFileSize, 25);
    assert.strictEqual(l.minRerankScore, 0.05);
    const arr = loadRagSettings({ allowedFileTypes: ["PDF", 3] });
    assert.deepStrictEqual(arr.allowedFileTypes, [...RAG_SETTINGS_DEFAULTS.allowedFileTypes], "a non-string element rejects the array");
  });

  test("the 'auto' knobs accept null or a positive integer, nothing else", () => {
    assert.strictEqual(loadRagSettings({ embedBatchSize: 32 }).embedBatchSize, 32);
    assert.strictEqual(loadRagSettings({ embedBatchSize: null }).embedBatchSize, null);
    assert.strictEqual(loadRagSettings({ embedBatchSize: 0 }).embedBatchSize, null);
    assert.strictEqual(loadRagSettings({ embedBatchSize: -4 }).embedBatchSize, null);
    assert.strictEqual(loadRagSettings({ embedBatchSize: 2.5 }).embedBatchSize, null);
    assert.strictEqual(loadRagSettings({ embedConcurrency: "5" }).embedConcurrency, null);
    assert.strictEqual(loadRagSettings({ embedConcurrency: 5 }).embedConcurrency, 5);
  });

  test("enumerated keys: an unlisted value falls back — and an unlisted duplicate policy is 'overwrite', the route's own rule (D9, F-50 case 2)", () => {
    assert.deepStrictEqual([...DUPLICATE_POLICIES], ["skip", "overwrite"]);
    assert.deepStrictEqual([...SEARCH_MODES], ["hybrid", "vector", "keyword"]);
    assert.deepStrictEqual([...RERANK_PROPERTIES], ["content", "title", "combined"]);
    for (const v of ["new_version", "force_reprocess", "anything"]) assert.strictEqual(loadRagSettings({ duplicatePolicy: v }).duplicatePolicy, "overwrite", v);
    assert.strictEqual(loadRagSettings({ duplicatePolicy: "skip" }).duplicatePolicy, "skip");
    assert.strictEqual(loadRagSettings({ searchMode: "bm25" }).searchMode, "hybrid", "the panel's old 'bm25' was read by nothing — the resolver's word is 'keyword'");
    assert.strictEqual(loadRagSettings({ searchMode: "keyword" }).searchMode, "keyword");
    assert.strictEqual(loadRagSettings({ rerankProperty: "nope" }).rerankProperty, "content");
  });

  test("the ingest route tests the policy the way the loader maps it (skip, else overwrite)", () => {
    const src = read(FILES.ingest);
    assert.match(src, /duplicatePolicy === "skip"/);
    assert.ok(!/new_version|force_reprocess/.test(src), "the route never named the retired policies");
  });

  test("the drawer offers exactly the module's policies and search modes (no 'bm25', no third policy)", () => {
    const src = read(FILES.drawer);
    assert.match(src, /DUPLICATE_POLICIES\.map\(/, "the select maps the module's list");
    assert.ok(!/value="new_version"|value="force_reprocess"|value="bm25"/.test(src));
    assert.match(src, /<option value="keyword">/);
    for (const p of RERANK_PROPERTIES) assert.match(src, new RegExp(`<option value="${p}">`));
  });
});

describe("U-SETTINGS: page.js — the literal is gone, the loader runs, the guard is v18 (T63; v17 was T48, v16 was T35, v15 T33, v14 T37, v13 T31, v12 T24, v11 T15, v10 T28, v9 T23), the dead states are gone (D1, D3, D4, D6, D10, D14)", () => {
  const page = () => read(FILES.page);

  test("no DEFAULT_RAG_SETTINGS literal; the module's loader initialises and loads the blob", () => {
    const src = page();
    assert.ok(!/DEFAULT_RAG_SETTINGS/.test(src), "the page's own defaults table is gone");
    assert.match(src, /import \{[^}]*\bloadRagSettings\b[^}]*\} from "@\/lib\/rag\/config"/);
    assert.match(src, /useState\(\(\) => loadRagSettings\(null\)\)/, "the initial state is the module's table through the loader");
    assert.match(src, /localStorage\.getItem\("nxs_ragSettings"\)/, "the blob is loaded (F-82)");
    assert.match(src, /setRagSettings\(loadRagSettings\(storedRagSettings\)\)/, "and whitelisted by the module's loader");
  });

  test("the migration guard is v18 (T63 D7: lookupDocumentRead; T48 D4: beyondTheDocuments; T35 D3: ocrNoTextPages; T33 D6: detailPasses; T37 D3: the captioner default, nxs_vlmModelName set once; T31 D9: captionPageBudget; T24 D6: captionFigures; T15 D8/D12: the chat default and lookupScope; T28: three assembly keys; T23 D5: the credential keys purged too) and its block drops the retired keys and the old blob once", () => {
    const src = page();
    assert.match(src, /nxs_migrated_demos_v19/);
    assert.ok(!/nxs_migrated_demos_v18/.test(src), "v18 is gone");
    assert.ok(!/nxs_migrated_demos_v17/.test(src), "v17 is gone");
    assert.ok(!/nxs_migrated_demos_v16/.test(src), "v16 is gone");
    assert.ok(!/nxs_migrated_demos_v15/.test(src), "v15 is gone");
    assert.ok(!/nxs_migrated_demos_v14/.test(src), "v14 is gone");
    assert.ok(!/nxs_migrated_demos_v13/.test(src), "v13 is gone");
    assert.ok(!/nxs_migrated_demos_v12/.test(src), "v12 is gone");
    assert.ok(!/nxs_migrated_demos_v11/.test(src), "v11 is gone");
    assert.ok(!/nxs_migrated_demos_v10/.test(src), "v10 is gone");
    // T15 (design D8, amended): the chat default is qwen3.8:27b. D31 (Nexus, 2026-10-30): it is the LiteLLM model of
    // that name (every role on LiteLLM; thinking off resolves the Ollama behind it), and the v19 block sets it once.
    assert.match(src, /const \[endpointType, setEndpointType\] = useState\("litellm"\)/);
    assert.match(src, /const \[liteLlmModelName, setLiteLlmModelName\] = useState\("qwen3\.8:27b"\)/);
    assert.match(src, /localStorage\.setItem\("nxs_endpointType", "litellm"\)/);
    assert.match(src, /localStorage\.setItem\("nxs_liteLlmModelName", "qwen3\.8:27b"\)/);
    assert.ok(!/nxs_migrated_demos_v8/.test(src) && !/nxs_migrated_demos_v7/.test(src), "v7 and v8 are gone");
    for (const key of ["nxs_ragSettings", "nxs_weaviateLimit", "nxs_weaviateSimilarityThreshold", "nxs_weaviateSearchStrategy", "nxs_weaviateTimeout", "nxs_embedEndpoint", "nxs_mlisToken", "nxs_codeMlisToken", "nxs_embedApiKey", "nxs_rerankApiKey", "nxs_liteLlmToken", "nxs_codeLiteLlmToken"]) {
      assert.match(src, new RegExp(`localStorage\\.removeItem\\("${key}"\\)`), `${key} is removed by the v9 block`);
      assert.ok(!new RegExp(`localStorage\\.setItem\\("${key}"`).test(src), `${key} is never written by page.js`);
    }
  });

  test("T37 (design D1–D3, D8): the captioner default is ONE string in four places — the page's literal (read with the page-shape runners' own regex), the drawer's fallback, the guard block's nxs_vlmModelName (v18 since T63) and vlm_captioner.js's DEFAULT_CAPTION_MODEL; the tooltip names it", () => {
    const { DEFAULT_CAPTION_MODEL } = require("../../src/lib/ingestion/vlm_captioner");
    assert.strictEqual(DEFAULT_CAPTION_MODEL, "qwen3.8:27b", "T32's arm C — the chat model (t37-design D1)");
    const pg = codeOnly(page());
    // The runners' regex (run_dry_run.js / witness_production.js / repin_production.js, `state("vlmModelName")`):
    // a literal they cannot read fails here, before it fails three runners in the pod. A shared import would fail it.
    const m = pg.match(/const \[vlmModelName, set\w+\] = useState\("([^"]*)"\)/);
    assert.ok(m, "page.js keeps a string literal for vlmModelName (the page-shape runners read it by regex)");
    assert.strictEqual(m[1], DEFAULT_CAPTION_MODEL, "the page's literal is the constant");
    const block = pg.slice(pg.indexOf('localStorage.getItem("nxs_migrated_demos_v19")'), pg.indexOf('localStorage.setItem("nxs_migrated_demos_v19", "true")'));
    assert.ok(block.length > 0, "the v19 block exists");
    const set = block.match(/localStorage\.setItem\("nxs_vlmModelName", "([^"]*)"\)/);
    assert.ok(set, "the guard block sets nxs_vlmModelName once (a browser that pressed Save under an older guard moves too)");
    assert.strictEqual(set[1], DEFAULT_CAPTION_MODEL, "the block's value is the constant");
    assert.strictEqual((pg.match(/localStorage\.setItem\("nxs_vlmModelName"/g) || []).length, 1, "page.js writes the key in the guard block only");
    assert.match(pg, /const storedVlmModelName = localStorage\.getItem\("nxs_vlmModelName"\);\s*if \(storedVlmModelName !== null\) setVlmModelName\(storedVlmModelName\);/, "the stored value is applied after the block");
    const dr = codeOnly(read(FILES.drawer));
    const fb = dr.match(/const \[localVlmModelName, setLocalVlmModelName\] = useState\(vlmModelName \|\| "([^"]*)"\)/);
    assert.ok(fb, "the drawer's control falls back to a literal when the prop is empty");
    assert.strictEqual(fb[1], DEFAULT_CAPTION_MODEL, "the drawer's fallback is the constant");
    assert.match(dr, /localStorage\.setItem\("nxs_vlmModelName", localVlmModelName\)/, "Save still persists the control's value");
    assert.ok(dr.includes(`The default is ${DEFAULT_CAPTION_MODEL} — the chat model`), "the Model Name tooltip names the default and that it is the chat model (D8); the card keeps its name");
    assert.match(dr, /Vision Language Model \(VLM\) Configurations/);
    assert.ok(!/"qwen3-vl:30b"/.test(pg), "no VLM literal remains in page.js");
    assert.ok(!/"qwen3-vl:30b"/.test(codeOnly(read(FILES.parser))), "nor in the parser's code");
  });

  test("the legacy trio, weaviateTimeout and the bare embedEndpoint state are gone from page.js and the drawer (F-84, F-21)", () => {
    const pg = page();
    const dr = read(FILES.drawer);
    for (const name of ["weaviateLimit", "weaviateSimilarityThreshold", "weaviateSearchStrategy", "weaviateTimeout"]) {
      assert.ok(!new RegExp(`\\b${name}\\b`).test(pg), `page.js still names ${name}`);
      assert.ok(!new RegExp(`\\b${name}\\b`).test(dr), `the drawer still names ${name}`);
      assert.ok(!new RegExp(`\\blocal${name[0].toUpperCase()}${name.slice(1)}\\b`).test(dr), `the drawer still holds a local ${name}`);
    }
    // The bare state (F-21): no useState, no prop, no local, no localStorage key.
    // The admin-config payload key `embedEndpoint: embedEndpointUrl` is the
    // orchestrator's contract and stays.
    assert.ok(!/const \[embedEndpoint,/.test(pg), "the bare embedEndpoint state is gone");
    assert.ok(!/\bsetEmbedEndpoint\b/.test(pg) && !/\bsetEmbedEndpoint\b/.test(dr));
    assert.ok(!/embedEndpoint=\{/.test(pg), "no bare embedEndpoint prop");
    assert.ok(!/\blocalEmbedEndpoint\b/.test(dr));
    assert.ok(!/"nxs_embedEndpoint"/.test(dr), "the drawer no longer writes the dead key");
    assert.match(pg, /embedEndpoint: embedEndpointUrl/, "the payload key the orchestrator reads is unchanged");
  });

  test("the profile rewrite is gone: lastProfile is never copied into the settings (D4, F-51)", () => {
    const src = page();
    assert.ok(!/lastProfile\.(chunkSize|chunkOverlap|searchStrategy|maxContextChunks)/.test(src));
    assert.ok(!/setRagSettings\(prev => \(\{ \.\.\.prev, chunk/.test(src));
  });

  test("F-27: the reconnect handler has no REST fallback that parses the SSE stream", () => {
    const src = page();
    const handler = src.slice(src.indexOf("eventSource.onerror"), src.indexOf("connectSSE();"));
    assert.ok(handler.length > 0, "the handler exists");
    assert.ok(!/\.json\(\)/.test(handler), "no .json() on the status URL inside the reconnect handler");
    assert.ok(!/fetch\(statusUrl\)/.test(handler));
    assert.match(handler, /setTimeout\(connectSSE, 2000\)/, "the blind retry stays");
  });

  test("the ingest request carries the VLM trio top-level (D11, F-85)", () => {
    const src = page();
    const body = src.slice(src.indexOf('fetch("/api/ingest"'), src.indexOf("const startBody"));
    for (const k of ["vlmModelName", "vlmEndpointUrl", "vlmApiKey"]) assert.match(body, new RegExp(`\\b${k}\\b`), `${k} is sent`);
    assert.match(body, /ragSettings/);
  });
});

describe("U-SETTINGS: the drawer — units, the schema line, the VLM consequence (D5, D7, D11)", () => {
  const drawer = () => fs.readFileSync(FILES.drawer, "utf-8");

  test("no label says 'tokens' beside a chunk knob; the six say characters (E11)", () => {
    const src = drawer();
    assert.ok(!/\{(?:localRagSettings|tempRagSettings)\.(chunkSize|chunkOverlap)\} tokens/.test(src));
    assert.ok(!/Chunk Size \(tokens\)/.test(src));
    const chars = src.match(/\{(?:localRagSettings|tempRagSettings)\.(?:chunkSize|chunkOverlap)\} characters/g) || [];
    assert.strictEqual(chars.length, 4, "the four size / overlap readouts say characters");
    assert.match(src, /Minimum Chunk Size \(characters\)/);
    assert.ok(!/Maximum Chunk Size/.test(src), "maxChunkSize (dead) has no control");
    assert.match(src, /4 characters per token/);
  });

  test("the schema line is computed through the two shared functions, with no version literal (D7)", () => {
    const src = codeOnly(drawer());
    assert.match(src, /import \{[^}]*\bresolveSchemaVersion\b[^}]*\bcollectionNameForVersion\b[^}]*\} from "@\/lib\/rag\/config"/);
    assert.match(src, /collectionNameForVersion\(RETRIEVAL_DEFAULTS\.weaviateCollection, resolveSchemaVersion\(\{ ragSettings: localRagSettings \}\)\)/);
    assert.ok(!/schemaVersion:\s*[12]\b/.test(src), "the drawer sends and shows no version literal");
    assert.ok(!/updateRagSetting\("schemaVersion"/.test(src), "there is no schemaVersion control (API-only)");
    assert.ok(!/RAGChunkV2/.test(src), "the class name is computed, never written");
    // The same two functions give the same answer for the demo's blob.
    const v = resolveSchemaVersion({ ragSettings: loadRagSettings(null) });
    assert.strictEqual(v, 2);
    assert.strictEqual(collectionNameForVersion(RETRIEVAL_DEFAULTS.weaviateCollection, v), "RAGChunkV2");
  });

  test("the VLM model field names the re-index consequence (D11)", () => {
    const src = drawer();
    assert.match(src, /id="vlm_modelName"/);
    assert.match(src, /version fingerprint/);
  });

  test("the retired controls and cards are gone (D2): no Preprocessing card, no Source Properties chips, no dead selects", () => {
    const src = codeOnly(drawer());
    assert.ok(!/Preprocessing Settings/.test(src));
    assert.ok(!/Source Properties/.test(src));
    for (const label of ["OCR for Scanned Docs", "Language Detection", "Batch Ingest Size", "Chunking Strategy", "Fusion Strategy", "Context Assembly Mode", "Pooling Strategy", "Named Vectors", "Metadata Filters", "Return Fields", "Group By Document"]) {
      assert.ok(!src.includes(label), `${label} is still rendered`);
    }
    // The cards that stay, and the ones D8 added to.
    for (const label of ["Documents Settings", "Chunking Settings", "Embeddings Settings", "Retrieval Settings", "Reranking Settings", "Embed Batch Size", "Embed Concurrency", "Aggregation Scan Limit", "Count Stem Variants", "Evidence Lines"]) {
      assert.ok(src.includes(label), `${label} is missing`);
    }
  });
});
