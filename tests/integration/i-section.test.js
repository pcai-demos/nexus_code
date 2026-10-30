/**
 * I-SECTION — T34's integration suite (design `inputs/rag-audit/t34-design.md` §4 (1)): the .docx fixture
 * `tests/fixtures/golden/section_headings.docx` (python-docx; three heading levels, "Executive Summary" under two
 * parents, a blank heading, an `&` heading, a table, a sentinel token per section) into a fresh RAGEval_* class through
 * the page's request shape, then:
 *   1. every chunk carries `sectionTitle` (the heading path) except the front matter; no chunk text contains `[Page`;
 *      the repeated heading resolves to two paths; the `&` is unescaped; the ledger says paginated: false;
 *   2. one chat turn in the page's shape whose citations carry page null, locationKind "section", a sectionPath, and
 *      0 uncited page claims; the header the model saw says `Section:` and never `Page:`;
 *   3. a second ingest reproduces every chunk byte for byte (the fixture has no pictures — no memo, no reset).
 * Read-only on production; the two classes are deleted at the end. Runs in the pod (the bridge, the store).
 */
const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { envConfig, skipReason, makeRunCollection, postJson, waitForIngestion, assertEvalCollection } = require("./_harness");
const ledger = require("../../src/lib/rag/ledger");
const sec = require("../../src/lib/ingestion/sections.js");

const SKIP = skipReason();
const config = envConfig();
const APP_ROOT = process.cwd();
// The ingest route resolves paths under public/ (T05's sourceIdFor refuses anything else): the fixture is STAGED into
// public/eval_fixtures/<class>/ for the run and removed after — the suite owns only what it added (F-95's rule).
const FIXTURE_SRC = path.join(APP_ROOT, "tests", "fixtures", "golden", "section_headings.docx");
const STAGE_BASE = config ? makeRunCollection("t34sectionA") : null;
const STAGE_DIR = STAGE_BASE ? path.join(APP_ROOT, "public", "eval_fixtures", STAGE_BASE) : null;
const FIXTURE = STAGE_BASE ? `eval_fixtures/${STAGE_BASE}/section_headings.docx` : "tests/fixtures/golden/section_headings.docx";
const TOKENS = { AMBERQUILL: "Report A › Executive Summary", COBALTREED: "Report B › Executive Summary", SAFFRONVANE: "Report A › Section 1: Methodology & Assumptions › 1.1 Scope" };

const classes = config ? { a: STAGE_BASE, b: makeRunCollection("t34sectionB") } : null;
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

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
    vlmModelName: process.env.RAG_EVAL_VLM_MODEL || "qwen3.8:27b",
    vlmEndpointUrl: process.env.RAG_EVAL_VLM_URL || "http://ollama.ollama.svc.cluster.local:11434",
    vlmApiKey: "",
    // A small chunk so the fixture yields several chunks per section (the page's 600 / 80 would make three or four in all).
    ragSettings: { weaviateCollection: collection, allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"], maxFileSize: 50, duplicatePolicy: "skip", chunkSize: 300, chunkOverlap: 40, minChunkSize: 50, ...ragExtra },
  };
}

async function ingest(collection, filePaths, ragExtra) {
  const started = await postJson(`${config.appUrl}/api/ingest`, ingestBody(collection, filePaths, ragExtra));
  assert.equal(started.status, 202, `ingest into ${collection} refused: ${started.text}`);
  return waitForIngestion(config.appUrl, started.json.jobId, 600000);
}

async function gql(query) {
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  const res = await fetch(`${config.weaviateUrl}/v1/graphql`, { method: "POST", headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(120000) });
  const j = await res.json();
  if (j.errors) assert.fail(`graphql: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.data;
}

async function objects(base) {
  const cls = `${base}V2`;
  const data = await gql(`{ Get { ${cls}(limit: 500) { text source fileType page chunkIndex sectionNumber sectionTitle docVersion isVisualElement metadata } } }`);
  return (data.Get[cls] || []).map((o) => { let meta = {}; try { meta = JSON.parse(o.metadata || "{}"); } catch (e) {} return { ...o, meta, textMd5: md5(o.text || "") }; }).sort((a, b) => a.chunkIndex - b.chunkIndex);
}

async function deleteClass(base) {
  assertEvalCollection(base);
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  await fetch(`${config.weaviateUrl}/v1/schema/${base}V2`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) }).catch(() => {});
}

const parsedOf = (base) => ledger.readEvents(ledger.defaultLedgerPath()).events.filter((e) => e.collection === `${base}V2` && e.event === "file_parsed");

if (config) {
  after(async () => {
    for (const base of Object.values(classes)) await deleteClass(base);
    if (STAGE_DIR && fs.existsSync(STAGE_DIR)) fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  });
}

describe("I-SECTION 1: the .docx fixture's chunks carry their heading path and never a page word (design D2–D4, D6)", () => {
  test("paginated false on the ledger; every chunk but the front matter has a sectionTitle path; the two Executive Summaries resolve to two paths; the `&` heading is unescaped; no chunk text contains `[Page`; the sentinel tokens sit under their sections", { skip: SKIP }, async (t) => {
    assert.ok(fs.existsSync(FIXTURE_SRC), `the fixture is expected at ${FIXTURE_SRC} (scripts/make_docx_fixture.py)`);
    assert.ok(!fs.existsSync(STAGE_DIR), `a fresh staging folder: ${STAGE_DIR}`);
    fs.mkdirSync(STAGE_DIR, { recursive: true });
    fs.copyFileSync(FIXTURE_SRC, path.join(APP_ROOT, "public", FIXTURE));
    const a = await ingest(classes.a, [FIXTURE]);
    assert.strictEqual(a.status, "completed", JSON.stringify(a).slice(0, 400));
    const fr = (a.fileResults || [])[0];
    assert.strictEqual(fr.status, "indexed", JSON.stringify(fr).slice(0, 300));
    const pa = parsedOf(classes.a);
    assert.strictEqual(pa.length, 1);
    assert.strictEqual(pa[0].paginated, false, "the bridge said the file has no pages (F-11) and the ledger keeps it");
    assert.match(String(pa[0].engine || ""), /docling/i, "the docling path (the ledger records the engine id), not the OfficeParser fallback");
    const A = await objects(classes.a);
    t.diagnostic(`${A.length} chunk(s); paths: ${[...new Set(A.map((o) => o.sectionTitle))].join(" || ")}`);
    assert.ok(A.length >= 6, `several chunks at 300 / 40: ${A.length}`);
    assert.ok(A.every((o) => o.page === 1 && o.fileType === "docx" && !o.isVisualElement));
    for (const o of A) assert.ok(!/\[Page/.test(o.text), `no fabricated page stamp in chunk ${o.chunkIndex}: ${o.text.slice(0, 80)}`);
    // A13: a chunk belongs to the section holding most of its characters; only a chunk that ENDS before the first heading has none.
    const front = A.filter((o) => !o.sectionTitle);
    assert.ok(front.length <= 1 && front.every((o) => o.chunkIndex === 0), `at most the first chunk has no anchor: ${front.map((o) => o.chunkIndex).join(",")}`);
    assert.ok(/Front matter before any heading/.test(A[0].text));
    for (const o of A.filter((x) => x.sectionTitle)) {
      assert.ok(typeof o.sectionTitle === "string" && o.sectionTitle.trim(), `chunk ${o.chunkIndex} carries a path`);
      assert.strictEqual(o.sectionNumber, "", "the regulation-number field is untouched (D6)");
      assert.strictEqual(o.meta.section_title, o.sectionTitle, "the store's sectionTitle is the metadata's section_title");
      assert.ok(typeof o.meta.sectionHeading === "string" && o.sectionTitle.endsWith(o.meta.sectionHeading), "the innermost heading ends the path");
      assert.ok(Number.isInteger(o.meta.section_level) && o.meta.section_level >= 2, "docling's heading level (Word level + 1)");
      const first = o.text.split("\n").find((l) => l.trim()) || "";
      assert.ok(first === `[Section: ${o.sectionTitle}]` || sec.startsWithHeading(o.text), `chunk ${o.chunkIndex} begins with its Section line or its heading: ${first.slice(0, 80)}`);
    }
    const paths = new Set(A.map((o) => o.sectionTitle).filter(Boolean));
    assert.ok(paths.has("Report A › Executive Summary") && paths.has("Report B › Executive Summary"), `both Executive Summaries, told apart by their parent: ${[...paths].join(" || ")}`);
    assert.ok([...paths].some((p) => /Section 1: Methodology & Assumptions/.test(p)), "&amp; unescaped in the anchor (F-146)");
    assert.ok(![...paths].some((p) => /&amp;/.test(p)));
    for (const [token, expectedPath] of Object.entries(TOKENS)) {
      const holders = A.filter((o) => o.text.includes(token));
      assert.ok(holders.length >= 1, `the sentinel ${token} is in a chunk`);
      for (const h of holders) assert.strictEqual(h.sectionTitle, expectedPath, `${token} sits under ${expectedPath}`);
    }
    assert.ok([...paths].every((p) => !/›\s*›|›\s*$|^\s*›/.test(p)), `a blank heading is never a section of its own: ${[...paths].join(" || ")}`);
    const afterBlank = A.find((o) => /after a blank heading/.test(o.text));
    assert.ok(afterBlank && (/1\.1 Scope$/.test(afterBlank.sectionTitle) || /^Report B/.test(afterBlank.sectionTitle)), `the blank heading changes nothing — the paragraph is 1.1 Scope's, or its chunk's majority is Report B's: ${afterBlank && afterBlank.sectionTitle}`);
  });
});

describe("I-SECTION 2: a chat turn on the fixture cites the section, never a page (design D7)", () => {
  test("citations carry page null, locationKind section and a sectionPath; the header the model saw says Section: and never Page:; 0 uncited page claims", { skip: SKIP }, async (t) => {
    // The browser's adminConfig shape (run_citations.js's), the class named in ragSettings (the harness's convention).
    const adminConfig = {
      nimEndpoint: config.chatUrl, nimApiKey: config.token, nimModelName: process.env.RAG_EVAL_CHAT_MODEL || "qwen3.8:27b",
      systemPrompt: "You are a helpful assistant.", temperature: 0, maxTokens: 2048,
      weaviateUrl: config.weaviateUrl, weaviateCollection: classes.a, mlisToken: config.token,
      embedApiKey: config.token, embedEndpoint: config.embedUrl, embedModelName: config.embedModel,
      rerankEndpointUrl: config.rerankUrl, rerankModelName: config.rerankModel, rerankApiKey: config.rerankToken,
      ragSettings: { weaviateCollection: classes.a, schemaVersion: 2 },
      forcedCommand: "/doc",
    };
    const body = { message: "What is the AMBERQUILL finding, and under which report and section does it appear?", history: [], adminConfig };
    const res = await postJson(`${config.appUrl}/api/chat`, body, 600000);
    assert.strictEqual(res.status, 200, res.text.slice(0, 300));
    const data = res.json;
    assert.strictEqual(data.success, true, JSON.stringify(data).slice(0, 300));
    assert.strictEqual(data.retrieval && data.retrieval.state, "ok", JSON.stringify(data.retrieval));
    const cites = Array.isArray(data.citations) ? data.citations : [];
    t.diagnostic(`${cites.length} citation(s): ${cites.map((c) => `${c.marker} ${c.locationKind} ${c.sectionPath}`).join(" | ")}; uncited ${(data.uncitedClaims || []).length}`);
    assert.ok(cites.length >= 1, "the answer cites at least one block");
    for (const c of cites) {
      assert.strictEqual(c.page, null, "a singlePage file's citation has no page");
      assert.strictEqual(c.pageAttribution, "singlePage");
      assert.ok(["section", "none"].includes(c.locationKind), c.locationKind);
    }
    assert.ok(cites.some((c) => c.locationKind === "section" && /Executive Summary$/.test(c.sectionPath || "")), "the AMBERQUILL chunk is cited by its section");
    assert.deepStrictEqual(data.uncitedClaims || [], [], "no uncited page claim: the model was never shown a page for this file");
    const rag = (data.traces || []).find((tr) => tr.category === "rag_pipeline");
    const ctx = rag && rag.details && (rag.details.contextText || rag.details.promptContext || "");
    if (typeof ctx === "string" && ctx.includes("[S1]")) {
      const headers = ctx.split("\n").filter((l) => /^\[S\d+\] \(/.test(l));
      assert.ok(headers.length > 0 && headers.every((h) => /Section: /.test(h) && !/Page: |Slide: /.test(h)), `every header names a section and no page: ${headers.slice(0, 3).join(" | ")}`);
    } else t.diagnostic("the trace carries no context text; the header shape is pinned by U-CITE");
  });
});

describe("I-SECTION 3: a second ingest reproduces every chunk byte for byte", () => {
  test("the same chunks, the same paths, the same texts", { skip: SKIP }, async () => {
    const b = await ingest(classes.b, [FIXTURE]);
    assert.strictEqual(b.status, "completed", JSON.stringify(b).slice(0, 400));
    const A = await objects(classes.a), B = await objects(classes.b);
    assert.deepStrictEqual(B.map((o) => `${o.chunkIndex}|${o.sectionTitle}|${o.textMd5}`), A.map((o) => `${o.chunkIndex}|${o.sectionTitle}|${o.textMd5}`));
    assert.strictEqual(A[0].docVersion, B[0].docVersion);
  });
});
