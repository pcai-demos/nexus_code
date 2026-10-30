/**
 * I-OCR — OCR for pages without a text layer, live (ticket T35; design §3, §4 (2), D2–D10).
 * Runs in-pod against Ollama and Weaviate.
 *
 *  1. THE BROCHURE (`Barratt_Homes-SaxonFields.pdf` — F-1: two pages, no text
 *     layer) into a fresh `RAGEval_*V2` class (schemaVersion 2 stated, the
 *     harness shape, `ocrNoTextPages` left at its default `auto`): the job
 *     completes; the ledger's file_parsed says both pages had no text layer
 *     and both were read by OCR (`ocrNoText 2`, `ocrPages 2`, `ocrEmpty 0`,
 *     `ocrFailed 0`, the pages named, the engine named with its models, the
 *     wall time under 10 s a page — the thread pin, F-148); the store holds
 *     the page's OCR text as TEXT chunks — `metadata.textSource: "ocr"`, page
 *     1 one chunk, page 2 three (the splitter at 600 / 80 / 150 on the probe's
 *     398 / 1,389 characters — t35-design §0b) — carrying the brochure's words
 *     (LINCOLN, 4 bedroom, the ten dimension rows, the KEY, the disclaimer);
 *     the two caption chunks are there, page 1's still naming Barratt (the
 *     with-text prompt, D7 — the brand-word risk of §7); page 2 keeps exactly
 *     one keyed-index detail chunk and no transcribe chunk (D8); a chat turn
 *     for the kitchen/family room's dimensions cites the page with `Text: OCR`
 *     in its context header (D6).
 *  2. A SECOND fresh class from the same bytes: the OCR text byte-identical
 *     (deterministic — no memo needed, D9), every caption recalled
 *     (`vlmCalls 0`), the chunks identical in text and page.
 *  3. THE SAME FILE under `ocrNoTextPages: "off"`: no text chunk, the pass
 *     reported as off with the two pages named (`ocrNoText 2`, `ocrPages 0`),
 *     the docVersion a different one (D3, D9), the captions under the no-text
 *     prompt as before T35.
 *  Teardown: the classes deleted through the schema API. The crop folder is
 *  production's (F-95): OCR writes nothing there, and the suite asserts the
 *  folder's files are exactly what they were.
 * Skipped unless RAG_EVAL_WEAVIATE_URL and RAG_EVAL_EMBED_URL are set. About
 * two minutes (two captions asked once under the with-text key, then recalled).
 */
const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { envConfig, skipReason, makeRunCollection, postJson, waitForIngestion, assertEvalCollection } = require("./_harness");
const cap = require("../../src/lib/ingestion/vlm_captioner.js");
const ledger = require("../../src/lib/rag/ledger");

const SKIP = skipReason();
const config = envConfig();
const APP_ROOT = process.cwd();
const CROPS = path.join(APP_ROOT, "public", "extracted_images");
const OLLAMA = process.env.RAG_EVAL_VLM_URL || "http://ollama.ollama.svc.cluster.local:11434";
const VLM_MODEL = process.env.RAG_EVAL_VLM_MODEL || cap.DEFAULT_CAPTION_MODEL;
const CHAT_URL = process.env.RAG_EVAL_CHAT_URL || "http://ollama.ollama.svc.cluster.local:11434/v1";
const CHAT_MODEL = process.env.RAG_EVAL_CHAT_MODEL || "qwen3.8:27b";
const RERANK_URL = process.env.RAG_EVAL_RERANK_URL || "https://rerank.project-demos.serving.demo.lon-pcai.twlon.com";
const RERANK_MODEL = process.env.RAG_EVAL_RERANK_MODEL || "Qwen/Qwen3-Reranker-8B";
const BROCHURE = "demos/demo_files/ext_reg_docs/Barratt_Homes-SaxonFields.pdf";

const classes = config ? { a: makeRunCollection("t35ocrA"), b: makeRunCollection("t35ocrB"), c: makeRunCollection("t35ocrOff") } : null;
// The page's chunk shape (config.js's defaults): the design's chunk-count prediction and the page-shape fingerprint hold under it.
const PAGE_SHAPE = { chunkSize: 600, chunkOverlap: 80, minChunkSize: 150 };
const PAGE_SHAPE_SUFFIX = "a5d02a609ad9"; // IDENTITY_VERSION 14 (T61; 94195d3aa6bb under 13 — T60, 0c708178f137 under 12 — T59, 0008a8c2d1f3 under 11 — T58, 852f45f6ef65 under 10 — T57, 864cbc8489ad under 9 — T46 + T47 + F-191, bfd9e449b930 under 8, 384ec4e0e1c3 under 7, be2a00d66f36 under 6, dd257f24f95c under 5), ocrNoTextPages auto (U-IDS pins it)
const OFF_SUFFIX = "efc665a1b7ec"; // the same shape with ocrNoTextPages off under IDENTITY_VERSION 14 (454ac3cd28ac under 13, 1469ecd67cac under 12, fd0dcb555a4e under 11, ce4db2f51515 under 10, a2aaa47d0641 under 9, 91466d268ae4 under 8, 1814223900ce under 7, e7388a0a8a8b under 6, 18314c43722c under 5)
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
const docHash = md5(fs.readFileSync(path.join(APP_ROOT, "public", BROCHURE)));
const folder = path.join(CROPS, docHash);
const folderFilesNow = () => (fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []);
let filesBefore = null;

function ingestBody(collection, filePaths, ragExtra = {}) {
  return {
    filePaths,
    weaviateUrl: config.weaviateUrl,
    token: config.token,
    weaviateToken: config.token,
    embedUrl: config.embedUrl,
    embedModel: config.embedModel,
    schemaVersion: 2,
    weaviateCollection: collection,
    vlmModelName: VLM_MODEL,
    vlmEndpointUrl: OLLAMA,
    vlmApiKey: "",
    ragSettings: { weaviateCollection: collection, allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"], maxFileSize: 50, duplicatePolicy: "skip", ...ragExtra },
  };
}

async function ingest(collection, filePaths, ragExtra) {
  const started = await postJson(`${config.appUrl}/api/ingest`, ingestBody(collection, filePaths, ragExtra));
  assert.equal(started.status, 202, `ingest into ${collection} refused: ${started.text}`);
  return waitForIngestion(config.appUrl, started.json.jobId, 1200000);
}

async function gql(query) {
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  const res = await fetch(`${config.weaviateUrl}/v1/graphql`, { method: "POST", headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(120000) });
  const j = await res.json();
  if (j.errors) assert.fail(`graphql: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.data;
}

/** Every object of a class, typed: text (with its source), caption, detail. */
async function objects(base) {
  const cls = `${base}V2`;
  const data = await gql(`{ Get { ${cls}(limit: 200) { text source page chunkIndex docVersion imagePath isVisualElement metadata } } }`);
  return (data.Get[cls] || []).map((o) => {
    let meta = {}; try { meta = JSON.parse(o.metadata || "{}"); } catch (e) {}
    const visual = o.isVisualElement === true || meta.isVisualElement === true;
    const kind = meta.detail === true ? "detail" : visual ? "caption" : "text";
    return { kind, meta, text: o.text || "", textMd5: md5(o.text || ""), page: o.page, chunkIndex: o.chunkIndex, docVersion: o.docVersion, key: `${o.page}|${kind}|${visual ? meta.figureId : o.chunkIndex}` };
  }).sort((a, b) => a.chunkIndex - b.chunkIndex);
}

async function deleteClass(base) {
  assertEvalCollection(base);
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  await fetch(`${config.weaviateUrl}/v1/schema/${base}V2`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) }).catch(() => {});
}

const parsedOf = (base) => ledger.readEvents(ledger.defaultLedgerPath()).events.filter((e) => e.collection === `${base}V2` && e.event === "file_parsed");

function adminConfig(base) {
  return {
    nimEndpoint: CHAT_URL, nimApiKey: process.env.NEXCODE_CHAT_TOKEN || "", nimModelName: CHAT_MODEL,
    systemPrompt: "You are a helpful assistant.", temperature: 0, maxTokens: 2048,
    weaviateUrl: config.weaviateUrl, weaviateCollection: base, mlisToken: config.token, embedApiKey: process.env.NEXCODE_CHAT_TOKEN || "", embedEndpoint: config.embedUrl, embedModelName: config.embedModel,
    rerankEndpointUrl: RERANK_URL, rerankModelName: RERANK_MODEL, rerankApiKey: process.env.RAG_EVAL_RERANK_TOKEN || "",
    ragSettings: { weaviateCollection: base, schemaVersion: 2 }, forcedCommand: "/doc",
  };
}

if (config) {
  after(async () => {
    for (const base of Object.values(classes)) await deleteClass(base);
    if (filesBefore !== null) assert.deepStrictEqual(folderFilesNow(), filesBefore, "the brochure's crop folder (production's — F-95) holds exactly what it held: OCR writes nothing there");
  });
}

const first = {};

describe("I-OCR 1: the brochure's two pages are read by OCR into the page's own text (design D2, D5–D8, D10)", () => {
  test("both pages OCR'd, named and timed on the ledger; four text chunks marked ocr with the brochure's words; the captions under the with-text prompt still name Barratt; page 2 keeps one keyed detail chunk and no transcribe chunk", { skip: SKIP }, async () => {
    filesBefore = folderFilesNow();
    // The PAGE's shape (600 / 80 / 150 — the loader's defaults), so the chunk count is the design's prediction for
    // production (§0b: p1 one chunk, p2 three; +4 on the store) and the docVersion suffix is the page-shape number.
    const a = await ingest(classes.a, [BROCHURE], PAGE_SHAPE);
    assert.strictEqual(a.status, "completed", JSON.stringify(a).slice(0, 400));
    const fr = a.fileResults.find((f) => /SaxonFields/.test(f.fileName));
    assert.ok(fr && fr.status === "indexed", JSON.stringify(fr).slice(0, 300));
    // The status frame carries the pass (D10).
    assert.deepStrictEqual({ noText: fr.counts.ocrNoText, pages: fr.counts.ocrPages, empty: fr.counts.ocrEmpty, failed: fr.counts.ocrFailed, mode: fr.ocrMode, list: fr.ocrPagesList }, { noText: 2, pages: 2, empty: 0, failed: 0, mode: "auto", list: "1, 2" }, JSON.stringify(fr).slice(0, 600));
    assert.ok(fr.counts.ocrChars > 1500 && fr.counts.ocrChars < 2200, `ocrChars ${fr.counts.ocrChars} (the probe read 398 + 1,389)`);
    assert.ok(Number.isFinite(fr.ocrDurationMs) && fr.ocrDurationMs < 20000, `OCR wall ${fr.ocrDurationMs} ms for two pages (the thread pin — F-148)`);
    assert.match(String(fr.ocrEngine), /^rapidocr [\d.]+ \/ onnxruntime [\d.]+ \/ models .*\.onnx [0-9a-f]{8}.* \/ threads \d+ \/ scale 2(\.0)? \/ text_score 0\.5$/, `the engine and its models are named: ${fr.ocrEngine}`);
    // The ledger's record (D10).
    const rec = parsedOf(classes.a).pop();
    assert.ok(rec, "file_parsed recorded");
    assert.deepStrictEqual({ noText: rec.counts.ocrNoText, pages: rec.counts.ocrPages, empty: rec.counts.ocrEmpty, failed: rec.counts.ocrFailed, mode: rec.ocrMode, list: rec.ocrPagesList, noTextList: rec.ocrNoTextPages }, { noText: 2, pages: 2, empty: 0, failed: 0, mode: "auto", list: "1, 2", noTextList: "1, 2" });
    assert.strictEqual(rec.ocrEngine, fr.ocrEngine);
    assert.ok(Number.isInteger(rec.ocrThreads) && rec.ocrThreads >= 1 && rec.ocrThreads <= 8, `the thread pin is recorded: ${rec.ocrThreads}`);
    assert.strictEqual(rec.captionPrompts && typeof rec.captionPrompts.withText, "string");
    // The store: text chunks marked ocr (D6), the captions, the detail chunk (D8).
    const objs = await objects(classes.a);
    const text = objs.filter((o) => o.kind === "text");
    const captions = objs.filter((o) => o.kind === "caption");
    const details = objs.filter((o) => o.kind === "detail");
    assert.deepStrictEqual(text.map((o) => [o.page, o.meta.textSource]), [[1, "ocr"], [2, "ocr"], [2, "ocr"], [2, "ocr"]], `four text chunks, every one marked ocr: ${JSON.stringify(text.map((o) => [o.page, o.meta.textSource, o.text.length]))}`);
    const p1 = text.filter((o) => o.page === 1).map((o) => o.text).join("\n");
    const p2 = text.filter((o) => o.page === 2).map((o) => o.text).join("\n");
    for (const w of [/LINCOLN/, /4 bedroom home/i, /free-flowing open-plan/i, /French doors/i]) assert.match(p1, w, `page 1's OCR text carries ${w}`);
    for (const w of [/Kitchen\/Family/, /4628/, /4605mm/, /Bedroom 4/, /2167/, /KEY/, /Dishwasher space/, /barratthomes\.co\.uk/, /Sales Adviser/, /June 16/]) assert.match(p2, w, `page 2's OCR text carries ${w}`);
    // The page's own prefix rule applies (§11a A10): a chunk that already carries the page heading's first characters
    // is not headed — the brochure's OCR chunks open with their page's first line, so most carry no `[Page N - …]`.
    assert.ok(text.every((o) => /^\[Page \d+/.test(o.text) || o.text.length > 0), "every OCR chunk is a text chunk under the page's rules");
    assert.ok(objs.every((o) => o.docVersion.endsWith(`.${PAGE_SHAPE_SUFFIX}`)), `every chunk carries the page-shape docVersion under IDENTITY_VERSION 5: ${objs[0].docVersion}`);
    assert.deepStrictEqual(captions.map((o) => o.page), [1, 2], "the two caption chunks are there (the caption stays — the charter)");
    assert.match(captions[0].text, /Barratt/i, "D7 / §7: page 1's caption under the with-text prompt still names Barratt (the brand words OCR fragments)");
    assert.match(captions[0].text, /Lincoln/i);
    assert.ok(!/TYPE: text\b/.test(captions[0].text), "page 1 is not a text-only page: it has a photo");
    assert.deepStrictEqual(details.map((o) => [o.page, o.meta.detailKind]), [[2, "keyed-index"]], "D8: page 2's keyed plan (the floor plan's key) runs; no transcribe plan on an OCR'd page");
    assert.deepStrictEqual({ pages: rec.counts.detailPages, notTaken: rec.counts.detailNotTaken }, { pages: 1, notTaken: 1 }, "page 1 did not qualify (a photo with bullets), page 2 fired");
    first.objs = objs; first.rec = rec; first.frame = fr;
  });

  test("a chat turn for the kitchen/family room's dimensions answers from the OCR chunk, cited by page, with `Text: OCR` in its context header (D6)", { skip: SKIP }, async () => {
    const res = await fetch(`${config.appUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "What are the dimensions of the kitchen/family room in the Lincoln?", history: [], adminConfig: adminConfig(classes.a) }), signal: AbortSignal.timeout(600000) });
    const d = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(d).slice(0, 300));
    assert.strictEqual(d.success, true);
    // The model may group digits ("4 628 mm", a thin space): a digit-tolerant match (§11a A10).
    // a thin space or a thousands comma between the digits ("4 628 mm", "4,628 mm" — T18's chain, t18-design.md §11a A11)
    const num = (n) => new RegExp(String(n).split("").join("[\\s\\u00a0\\u202f\\u2009,]?"));
    assert.match(String(d.response), num(4628), `the answer carries the metric dimension: ${String(d.response).slice(0, 300)}`);
    assert.match(String(d.response), num(4605), "and the second one");
    const cites = Array.isArray(d.citations) ? d.citations : [];
    assert.ok(cites.some((c) => /SaxonFields/.test(c.source) && c.page === 2), `page 2 cited: ${JSON.stringify(cites).slice(0, 300)}`);
    // The prompt's headers are not on the wire; the answer's citations are — a cited page-2 entry WITHOUT an imagePath
    // is a text chunk, and the only text chunks on page 2 are OCR's (a caption or detail chunk carries the render's
    // path). U-CITE pins the header's `Text: OCR` for such a chunk.
    const ocrCited = cites.filter((c) => /SaxonFields/.test(c.source) && c.page === 2 && !c.imagePath);
    assert.ok(ocrCited.length > 0, `an OCR text chunk of page 2 was cited: ${JSON.stringify(cites.map((c) => [c.marker, c.page, c.imagePath ? "visual" : "text"])).slice(0, 300)}`);
  });
});

describe("I-OCR 2: a second ingest reproduces the OCR text byte for byte and recalls every caption (design D7, D9)", () => {
  test("the chunks identical in text and page; vlmCalls 0; the same docVersion", { skip: SKIP }, async () => {
    assert.ok(first.objs, "I-OCR 1 ran");
    const b = await ingest(classes.b, [BROCHURE], PAGE_SHAPE);
    assert.strictEqual(b.status, "completed");
    const rec = parsedOf(classes.b).pop();
    assert.strictEqual(rec.counts.vlmCalls, 0, "every caption recalled under the with-text key the first ingest wrote");
    assert.strictEqual(rec.counts.ocrPages, 2);
    const objs = await objects(classes.b);
    assert.deepStrictEqual(objs.map((o) => [o.key, o.textMd5]), first.objs.map((o) => [o.key, o.textMd5]), "byte-identical: OCR is deterministic, the captions recalled");
    assert.strictEqual(objs[0].docVersion, first.objs[0].docVersion);
  });
});

describe("I-OCR 3: ocrNoTextPages off leaves the pages without text, says so, and is its own version (design D3, D9)", () => {
  test("no text chunk; the pass reported off with the pages named; a different docVersion; the captions under the no-text prompt", { skip: SKIP }, async () => {
    assert.ok(first.objs, "I-OCR 1 ran");
    const c = await ingest(classes.c, [BROCHURE], { ...PAGE_SHAPE, ocrNoTextPages: "off" });
    assert.strictEqual(c.status, "completed");
    const fr = c.fileResults.find((f) => /SaxonFields/.test(f.fileName));
    assert.deepStrictEqual({ noText: fr.counts.ocrNoText, pages: fr.counts.ocrPages, mode: fr.ocrMode, list: fr.ocrNoTextPages }, { noText: 2, pages: 0, mode: "off", list: "1, 2" });
    const objs = await objects(classes.c);
    assert.strictEqual(objs.filter((o) => o.kind === "text").length, 0, "no text chunk under off");
    assert.notStrictEqual(objs[0].docVersion, first.objs[0].docVersion, "off is a different version (fingerprinted when not the default)");
    assert.ok(objs.every((o) => o.docVersion.endsWith(`.${OFF_SUFFIX}`)), `off stamps its own number: ${objs[0].docVersion}`);
    assert.ok(objs.filter((o) => o.kind === "caption").length === 2);
    const rec = parsedOf(classes.c).pop();
    assert.strictEqual(rec.counts.vlmCalls, 0, "the no-text captions are the memo's (production's keys)");
  });
});
