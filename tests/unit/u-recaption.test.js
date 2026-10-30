/**
 * U-RECAPTION — the D4 re-caption runner sends EXACTLY the page's ingest request (session 36; t37-design.md §10;
 * session-state §9; the workshop charter's T32 D4).
 *
 * The runner (tests/eval/baselines/t37-artifacts/recaption_production.js) is the ONE production write the charter
 * allows, so its request is pinned here BEFORE it runs — the way U-SETTINGS pins the page's literal for the page-shape
 * runners:
 *   - the body's keys are the page's handleIngest keys, in the page's order, read from page.js's own source — no
 *     version field, no collection field (the server's defaults: 2, RAGChunk → RAGChunkV2);
 *   - every identity value is the page's literal through the runners' own regex (the captioner = the shipped
 *     DEFAULT_CAPTION_MODEL, the page's EXTERNAL Ollama URL, the embed pair, the store URL) and the two credential
 *     fields are the page's (empty since T23 — the route resolves the server's own);
 *   - ragSettings is the loader's table byte for byte (30 keys since T33; 600 / 80 / 150; captioning on; budget 0;
 *     detail passes auto; skip);
 *   - the fingerprint the parser will stamp for this shape is 42bb5ef65e46 (T34: IDENTITY_VERSION 4; U-IDS pins the
 *     number; this pins the runner's derivation of it) and differs from the recorded 65b740dc14dd (the D11
 *     re-caption's — the runner's constants moved with T33, design D6 / D11);
 *   - the corpus is the ext_reg_docs files in the ledger's path form, sorted, and nothing in the folder is left out
 *     (thirteen until 2026-10-02; the three regulatory documents until 2026-10-06 — the coding-assistant corpus; the
 *     nine regulator documents until 2026-10-08 — the demo's regulator pillar, E0 unlocked by the owner; ten since,
 *     with FCA SYSC 4 — decision C1 (a), the pins unlocked by the owner, D1 (a));
 *   - the route's translation of the page's Ollama URL is the in-cluster origin every memo record names;
 *   - requiring the module runs nothing: the POST is behind `require.main === module` and `--go`, and the pin
 *     condition is the opposite of the repair runner's;
 *   - the status poller reads a WHOLE SSE event before parsing it (F-140: a thirteen-file frame of ~26 KB can arrive
 *     in two chunks; the harness's one-read poller lost the --go run's after to "Unterminated string in JSON"), and
 *     --after resumes on the job the POST started.
 * Pure: no network, no store, no pod.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(REPO_ROOT, "tests", "eval", "baselines", "t37-artifacts", "recaption_production.js");
const runner = require(RUNNER);
const { RAG_SETTINGS_DEFAULTS } = require("../../src/lib/rag/config");
const ids = require("../../src/lib/rag/ids");
const { DEFAULT_CAPTION_MODEL, serverOriginOf } = require("../../src/lib/ingestion/vlm_captioner");

const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const page = () => read("src/app/page.js");

/** The keys of the page's own ingest body, from page.js's source: `fetch("/api/ingest", { … body: JSON.stringify({ … }) })`. */
function pageIngestBodyKeys() {
  const src = page();
  const at = src.indexOf('fetch("/api/ingest", {');
  assert.ok(at > 0, "page.js posts to /api/ingest");
  const start = src.indexOf("JSON.stringify({", at);
  assert.ok(start > at, "the page's ingest body is JSON.stringify({…})");
  const open = start + "JSON.stringify(".length;
  let depth = 0;
  let end = -1;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.ok(end > open, "the body's braces balance");
  return codeOnly(src.slice(open + 1, end)).split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(":")[0].trim());
}

describe("U-RECAPTION: the D4 runner's request is the page's, key for key and value for value", () => {
  const { body, ragSettings, expectedSuffix, vlmInternalUrl } = runner.buildRequest({ root: REPO_ROOT });

  test("the body's keys are the page's handleIngest keys, in the page's order — no version field, no collection field", () => {
    assert.deepStrictEqual(Object.keys(body), [...runner.PAGE_BODY_KEYS]);
    assert.deepStrictEqual(pageIngestBodyKeys(), [...runner.PAGE_BODY_KEYS], "read from page.js itself, so a page change fails here first");
    assert.ok(!("schemaVersion" in body) && !("weaviateCollection" in body), "the page names no version and no collection at the top level");
    assert.ok(!("schemaVersion" in body.ragSettings) && !("weaviateCollection" in body.ragSettings), "…nor inside ragSettings (the loader's table has neither)");
  });

  test("every identity value is the page's literal through the runners' regex; the captioner is the shipped default", () => {
    const pg = codeOnly(page());
    const lit = (name) => { const m = pg.match(new RegExp(`const \\[${name}, set\\w+\\] = useState\\("([^"]*)"\\)`)); assert.ok(m, `page.js keeps a string literal for ${name}`); return m[1]; };
    assert.strictEqual(body.vlmModelName, DEFAULT_CAPTION_MODEL, "T37 D1: the page's captioner is the constant");
    assert.strictEqual(body.vlmModelName, lit("vlmModelName"));
    assert.strictEqual(body.vlmEndpointUrl, lit("vlmEndpointUrl"));
    assert.match(body.vlmEndpointUrl, /^https:\/\/ollama\.demo\.lon-pcai\.twlon\.com\//, "the page's EXTERNAL Ollama URL — the route translates it, the runner does not");
    assert.strictEqual(body.embedUrl, lit("embedEndpointUrl"));
    assert.strictEqual(body.embedModel, lit("embedModelName"));
    assert.strictEqual(body.weaviateUrl, lit("weaviateUrl"));
    assert.strictEqual(body.token, lit("embedApiKey"));
    assert.strictEqual(body.weaviateToken, lit("mlisToken"));
    assert.strictEqual(body.vlmApiKey, lit("vlmApiKey"));
    assert.strictEqual(body.token, "", "empty since T23 — the route resolves the server's own credential");
    assert.strictEqual(body.weaviateToken, "", "empty since T23");
    assert.strictEqual(runner.pageState(pg, "vlmModelName"), DEFAULT_CAPTION_MODEL, "the exported regex is the runners' regex");
    assert.throws(() => runner.pageState(pg, "noSuchState"), /page\.js has no state noSuchState/);
  });

  test("ragSettings is the loader's table byte for byte: 33 keys, 600 / 80 / 150, captioning on, budget 0, detail passes auto, OCR auto, duplicatePolicy skip (T48's beyondTheDocuments and T63's lookupDocumentRead ride at their defaults; the ingest reads none of it)", () => {
    assert.deepStrictEqual(ragSettings, JSON.parse(JSON.stringify(RAG_SETTINGS_DEFAULTS)));
    assert.strictEqual(Object.keys(ragSettings).length, 33);
    assert.strictEqual(ragSettings.ocrNoTextPages, "auto", "T35: the default mode — the re-ingest under D12 reads the pages without a text layer");
    assert.strictEqual(ragSettings.detailPasses, "auto", "T33: the default level — the re-ingest under D11 tiles the pages whose caption admits the detail did not fit");
    assert.strictEqual(body.ragSettings, ragSettings, "the same object rides in the body");
    assert.strictEqual(ragSettings.chunkSize, 600);
    assert.strictEqual(ragSettings.chunkOverlap, 80);
    assert.strictEqual(ragSettings.minChunkSize, 150);
    assert.strictEqual(ragSettings.captionFigures, true);
    assert.strictEqual(ragSettings.captionPageBudget, 0);
    assert.strictEqual(ragSettings.duplicatePolicy, "skip");
    assert.notStrictEqual(ragSettings, RAG_SETTINGS_DEFAULTS, "a copy — the frozen table is never handed to a request");
  });

  test("the fingerprint the parser stamps for this shape is a5d02a609ad9 (T61: IDENTITY_VERSION 14), and it is not the recorded 94195d3aa6bb (the T60 v13 re-ingest's)", () => {
    assert.strictEqual(runner.EXPECTED_SUFFIX, "a5d02a609ad9");
    assert.strictEqual(runner.BEFORE_SUFFIX, "94195d3aa6bb");
    assert.strictEqual(expectedSuffix, runner.EXPECTED_SUFFIX, "the runner's derivation from the request it will send");
    assert.strictEqual(expectedSuffix, ids.fingerprintFor({ chunkSize: 600, chunkOverlap: 80, minChunkSize: 150, vlmModelName: DEFAULT_CAPTION_MODEL, captionFigures: true, captionPageBudget: 0, detailPasses: "auto", ocrNoTextPages: "auto" }), "the eight fingerprint keys by hand");
    assert.strictEqual(ids.fingerprintFor({ ...ragSettings, vlmModelName: "qwen3-vl:30b" }), "485eb0bb18da", "the VLM's page-shape number under IDENTITY_VERSION 14, for contrast (U-IDS)");
    assert.notStrictEqual(expectedSuffix, runner.BEFORE_SUFFIX, "every document's version moves — T07's skip re-parses all thirteen");
    const crypto = require("crypto");
    assert.strictEqual(crypto.createHash("sha256").update(JSON.stringify({ chunkOverlap: 80, chunkSize: 600, identityVersion: 13, minChunkSize: 150, vlmModelName: DEFAULT_CAPTION_MODEL }, ["chunkOverlap", "chunkSize", "identityVersion", "minChunkSize", "vlmModelName"])).digest("hex").slice(0, 12), runner.BEFORE_SUFFIX, "the recorded suffix is IDENTITY_VERSION 13's (the T60 v13 re-ingest), reproduced by hand");
  });

  test("the corpus is the ten regulator ext_reg_docs files in the ledger's path form, sorted, nothing left out", () => {
    assert.strictEqual(runner.CORPUS_SIZE, 10);
    assert.strictEqual(body.filePaths.length, runner.CORPUS_SIZE);
    assert.deepStrictEqual(body.filePaths, runner.corpusFilePaths(REPO_ROOT));
    assert.deepStrictEqual(body.filePaths, [...body.filePaths].sort(), "sorted by name");
    for (const p of body.filePaths) {
      assert.match(p, /^demos\/demo_files\/ext_reg_docs\/[^/]+$/, "the page's path form — the form the production ledger records");
      assert.ok(fs.existsSync(path.join(REPO_ROOT, "public", p)), `${p} exists under public/`);
      assert.strictEqual(ids.sourceIdFor(p), p, "the path IS its sourceId (no `public/` prefix, no `./`)");
    }
    assert.deepStrictEqual(body.filePaths.map((p) => path.basename(p)), [
      "BoE_AI-Letter-to-DSIT-HMT_April2024.pdf",
      "FCA_AI-Update_April2024.pdf",
      "FCA_PS21-3_OperationalResilience_March2021.pdf",
      "FCA_SYSC-4_October2026.pdf",
      "FCA_SYSC_June2026.pdf",
      "PCI-DSS-v4_0_1_June2024.pdf",
      "PRA_SS1-21_OperationalResilience_March2022.pdf",
      "PRA_SS1-23_ModelRisk_April2026.pdf",
      "PRA_SS2-21_Outsourcing_November2024.pdf",
      "PSRs_2017_April2026.pdf",
    ], "the demo's regulator pillar: the three regulatory documents, the six the owner ingested on 2026-10-06 and FCA SYSC 4 (2026-10-08)");
    const onDisk = fs.readdirSync(path.join(REPO_ROOT, "public", runner.CORPUS_REL)).filter((f) => !f.startsWith("."));
    assert.strictEqual(onDisk.length, body.filePaths.length, "every file in the corpus folder is an allowed type and is sent");
  });

  test("the page's Ollama URL translates to the in-cluster origin every memo record names — the route's own branch", () => {
    assert.strictEqual(vlmInternalUrl, "http://ollama.ollama.svc.cluster.local:11434/v1/");
    assert.strictEqual(serverOriginOf(vlmInternalUrl), "http://ollama.ollama.svc.cluster.local:11434", "the memo key's server half (T29 D1; every record names it)");
    assert.strictEqual(runner.internalVlmUrl(body.vlmEndpointUrl), vlmInternalUrl);
    assert.strictEqual(runner.internalVlmUrl("http://elsewhere:11434/v1"), "http://elsewhere:11434/v1", "any other URL passes through, as the route's does");
    const route = codeOnly(read("src/app/api/ingest/route.js"));
    assert.match(route, /url\.replace\("https:\/\/ollama\.demo\.lon-pcai\.twlon\.com", "http:\/\/ollama\.ollama\.svc\.cluster\.local:11434"\)/, "the runner's translation is the route's, string for string");
  });

  test("the request's description carries every identity value and no credential value", () => {
    const d = runner.describeRequest(body, ragSettings, vlmInternalUrl);
    assert.deepStrictEqual(d.keys, [...runner.PAGE_BODY_KEYS]);
    assert.strictEqual(d.files, 10);
    assert.strictEqual(d.shape, "600/80/150");
    assert.strictEqual(d.ragSettingsKeys, 33);
    assert.strictEqual(d.duplicatePolicy, "skip");
    assert.match(d.versionField, /^none/);
    assert.match(d.collectionField, /^none .*RAGChunkV2/);
    assert.match(d.token, /empty since T23/);
    assert.match(d.weaviateToken, /empty since T23/);
    assert.strictEqual(d.vlmApiKey, "(the page's literal, not printed)");
    assert.ok(!JSON.stringify(d).includes(body.vlmApiKey), "the page's key literal is never in the description");
  });

  test("requiring the runner runs nothing: the POST is behind require.main and --go; the class is the server's default only; the pin condition is the repair runner's opposite", () => {
    const src = codeOnly(fs.readFileSync(RUNNER, "utf8"));
    assert.match(src, /if \(require\.main === module\)/, "main() runs only as a script");
    assert.match(src, /args\.includes\("--go"\)/);
    assert.match(src, /args\.includes\("--preflight-only"\)/);
    assert.match(src, /\[GO, PREFLIGHT_ONLY, AFTER\]\.filter\(Boolean\)\.length !== 1/, "exactly one of the three modes");
    assert.strictEqual(runner.CLASS, "RAGChunkV2");
    assert.ok(!/weaviateCollection:\s*["'`\w]/.test(src), "the runner never names a collection in a request");
    assert.ok(!/schemaVersion:\s*[\d"'`\w]/.test(src), "the runner never names a version in a request");
    assert.match(src, /refuse\(`\$\{CLASS\} has no enforceable pin/, "a pinless class is refused — repin_production.js's repair is the other way round");
    assert.match(src, /waitForJob\(APP, jobId, 3600000/, "one SSE frame at a time, up to 1 h — the file's own retry loop");
    // T39 (design D3; F-140): the frame reader is the HARNESS's — one reader in the tree; the runner defines none of its own.
    assert.match(src, /const \{ parseFrame, readFrame \} = require\([^)]*_harness\.js"\)\)/, "parseFrame / readFrame come from tests/integration/_harness.js (T39 D3)");
    assert.ok(!/function parseFrame\(|function readFrame\(/.test(src), "the runner keeps no reader of its own");
    const harness = require(path.join(__dirname, "..", "integration", "_harness.js"));
    assert.strictEqual(runner.parseFrame, harness.parseFrame, "the runner re-exports the harness's parseFrame — the same function");
    assert.match(src, /args\.includes\("--after"\)/, "--after resumes on the job the POST started");
    assert.match(src, /--accept-memo-miss/, "a re-pulled model (no memo record under the live digest) is refused unless accepted");
    assert.match(src, /activeJob|runningJob/, "a running job is refused before the route's 409");
  });

  test("parseFrame reads a whole SSE event: a frame split across chunks is incomplete, not a parse error (F-140)", () => {
    const payload = { jobId: "j1", status: "processing", fileResults: Array.from({ length: 13 }, (_, i) => ({ fileName: `f${i}.pdf`, status: "indexing", evidence: { recorded: 100 + i, note: "x".repeat(1800) } })) };
    const frame = `event: status\ndata: ${JSON.stringify(payload)}\n\n`;
    assert.ok(frame.length > 20000, "a thirteen-file frame is well over one 16 KB chunk");
    const cut = frame.slice(0, 22371);
    assert.deepStrictEqual(runner.parseFrame(cut), { complete: false, payload: null }, "the first chunk alone is not an event");
    assert.throws(() => JSON.parse(cut.split("\n").find((l) => l.startsWith("data: ")).slice(6)), SyntaxError, "…which is exactly what the one-read poller parsed");
    const whole = runner.parseFrame(cut + frame.slice(22371));
    assert.strictEqual(whole.complete, true);
    assert.strictEqual(whole.payload.jobId, "j1");
    assert.strictEqual(whole.payload.fileResults.length, 13);
    const two = runner.parseFrame(`data: {"jobId":"a","status":"completed"}\n\ndata: {"jobId":"b","status":"processing"}\n\n`);
    assert.strictEqual(two.payload.jobId, "a", "the FIRST complete event is the frame");
    assert.deepStrictEqual(runner.parseFrame(": keep-alive\n"), { complete: false, payload: null }, "a comment line is not an event");
    assert.deepStrictEqual(runner.parseFrame(""), { complete: false, payload: null });
  });
});

// T45 (t45-design.md D13): the pre-flight predicts the adjudication calls a re-ingest makes — 0 under D1 a (the tile-edge
// rule asks no model; every tile recalls under its own key) — beside the caption count, so the owner reads both before --go.
describe("U-RECAPTION/T45 (t45-design D13): the pre-flight names the adjudication calls it predicts — 0 under the tile-edge rule", () => {
  test("the cost block carries adjudicationCalls: 0 with the reason, and the preflight-only line prints it", () => {
    const src = fs.readFileSync(RUNNER, "utf8");
    assert.match(src, /adjudicationCalls: 0,/, "the prediction is a constant of the design, not a measurement: D1 a makes no model call");
    assert.match(src, /adjudicationNote: "T45 \(D1 a\): the tile-edge rule asks no model/);
    assert.match(src, /say\(\{ step: "preflight-only",[^\n]*adjudicationCalls: 0/, "printed on the preflight-only verdict line");
    // T57 (design D9): the colour check's calls — a constant of the design as well: it reads the PDF, never a model.
    assert.match(src, /colourCheckCalls: 0, colourCheckNote: "T57 \(D9\): the colour check reads the PDF/);
    assert.match(src, /say\(\{ step: "preflight-only",[^\n]*colourCheckCalls: 0/, "printed on the preflight-only verdict line");
  });
});
