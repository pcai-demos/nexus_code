/**
 * I-MEMO — the persisted caption memo, live (ticket T29; design §8). Runs
 * in-pod against Ollama and Weaviate.
 *
 *  1. MISS THEN HIT on a fixture the suite owns: `pdf_text.pdf` copied to
 *     `public/eval_fixtures/t29_pdf_text.pdf` (the ingest route reads under
 *     public/ only — F-59; no crop folder pre-exists, so the suite owns the
 *     folder and removes it — F-95). Ingest A into a fresh `RAGEval_*V2`
 *     class: every crop asked (`vlmCalls` = the crops sent, `figuresFromMemo`
 *     0, `captionMemo: "none"`, the reset observed) and every outcome kept
 *     in the memo (`source: "vlm"`, the fixture's docHash as the hint).
 *     Ingest B into a second fresh class: every crop recalled (`vlmCalls` 0,
 *     `figuresFromMemo` = the crops, `captionMemo: "all"`, NO reset, the VLM
 *     stage in well under two seconds), the ledger's file_parsed and the
 *     status frame carrying the counts, the two classes' chunk sets equal.
 *  2. The memo's listing (the state probe's view) counts the suite's records
 *     by source and outcome and never carries a caption's text.
 *  Teardown: both classes deleted through the schema API; the fixture copy,
 *  its crop folder and ITS memo records removed — only those (F-95): the
 *  memo's other records are counted before and after and must be equal.
 * Skipped unless RAG_EVAL_WEAVIATE_URL and RAG_EVAL_EMBED_URL are set.
 */
const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { envConfig, skipReason, makeRunCollection, postJson, waitForIngestion, assertEvalCollection } = require("./_harness");
const cap = require("../../src/lib/ingestion/vlm_captioner.js");
const memoMod = require("../../src/lib/ingestion/caption_memo.js");
const ledger = require("../../src/lib/rag/ledger");

const SKIP = skipReason();
const config = envConfig();
const APP_ROOT = process.cwd();
const CROPS = path.join(APP_ROOT, "public", "extracted_images");
const OLLAMA = process.env.RAG_EVAL_VLM_URL || "http://ollama.ollama.svc.cluster.local:11434";
// T37 (design D6): the suite follows the shipped default; RAG_EVAL_VLM_MODEL overrides it.
const VLM_MODEL = process.env.RAG_EVAL_VLM_MODEL || cap.DEFAULT_CAPTION_MODEL;
const TEXT_PDF = "eval_fixtures/t29_pdf_text.pdf";
const FIXTURE_SRC = path.join(APP_ROOT, "tests", "fixtures", "golden", "pdf_text.pdf");

const classes = config ? { a: makeRunCollection("t29memoA"), b: makeRunCollection("t29memoB") } : null;
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
const fixtureHash = fs.existsSync(FIXTURE_SRC) ? md5(fs.readFileSync(FIXTURE_SRC)) : null;
const memo = memoMod.openCaptionMemo();

function ingestBody(collection, filePaths) {
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
    ragSettings: { weaviateCollection: collection, allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"], maxFileSize: 50, duplicatePolicy: "skip" },
  };
}

async function ingest(collection, filePaths) {
  const started = await postJson(`${config.appUrl}/api/ingest`, ingestBody(collection, filePaths));
  assert.equal(started.status, 202, `ingest into ${collection} refused: ${started.text}`);
  return waitForIngestion(config.appUrl, started.json.jobId, 900000);
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
  const d = await gql(`{ Get { ${cls}(limit: 500) { text source page chunkIndex metadata } } }`);
  return (d.Get[cls] || []).map((o) => { let m = {}; try { m = JSON.parse(o.metadata || "{}"); } catch (e) {} return { key: `${o.source}|${o.page}|${m.isVisualElement ? "caption" : "text"}|${m.isVisualElement ? m.figureId : o.chunkIndex}`, textMd5: md5(o.text || "") }; }).sort((a, b) => a.key.localeCompare(b.key));
}

async function deleteClass(base) {
  assertEvalCollection(base);
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  await fetch(`${config.weaviateUrl}/v1/schema/${base}V2`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) }).catch(() => {});
}

const parsedOf = (base) => ledger.readEvents(ledger.defaultLedgerPath()).events.filter((e) => e.collection === `${base}V2` && e.event === "file_parsed");

/** The memo records that belong to the fixture (its docHash in the hint) — the only ones this suite may touch (F-95). */
function fixtureRecords() {
  return memo.list({ withRecords: true }).records.filter((r) => r.hint && r.hint.docHash === fixtureHash);
}
function removeFixtureRecords() {
  let n = 0;
  for (const r of fixtureRecords()) if (memo.remove(r.key)) n++;
  return n;
}

let othersBefore = null;

if (config) {
  after(async () => {
    for (const base of Object.values(classes)) await deleteClass(base);
    fs.rmSync(path.join(APP_ROOT, "public", TEXT_PDF), { force: true });
    if (fixtureHash && fs.existsSync(path.join(CROPS, fixtureHash))) fs.rmSync(path.join(CROPS, fixtureHash), { recursive: true, force: true });
    removeFixtureRecords();
    if (othersBefore !== null) {
      const othersAfter = memo.list().count - fixtureRecords().length;
      assert.strictEqual(othersAfter, othersBefore, "the memo's other records are untouched by this suite (F-95)");
    }
  });
}

describe("I-MEMO 1: a miss is asked once, a hit is never asked (design D1, D2, D3, D7)", () => {
  test("ingest A: every crop asked and remembered; ingest B: every crop recalled, no reset, no request, the same chunks", { skip: SKIP }, async (t) => {
    assert.ok(fixtureHash, `fixture missing: ${FIXTURE_SRC}`);
    const identity = await cap.resolveCaptionServer({ ollamaUrl: OLLAMA, modelName: VLM_MODEL, label: "i-memo" });
    assert.strictEqual(identity.ok, true, `the server's identity (digest) must be readable for the memo to apply: ${identity.error || ""}`);
    t.diagnostic(`server ${identity.server}, ${VLM_MODEL}@${identity.modelDigest.slice(0, 12)}; memo dir ${memo.dir}`);
    fs.mkdirSync(path.join(APP_ROOT, "public", "eval_fixtures"), { recursive: true });
    fs.copyFileSync(FIXTURE_SRC, path.join(APP_ROOT, "public", TEXT_PDF));
    const folder = path.join(CROPS, fixtureHash);
    assert.ok(!fs.existsSync(folder), `the fixture's crop folder must not pre-exist (${folder}); the suite cannot own it otherwise (F-95)`);
    const stale = removeFixtureRecords();
    if (stale) t.diagnostic(`removed ${stale} stale record(s) of the fixture left by an earlier run`);
    othersBefore = memo.list().count;

    const a = await ingest(classes.a, [TEXT_PDF]);
    assert.strictEqual(a.status, "completed", JSON.stringify(a).slice(0, 300));
    const pa = parsedOf(classes.a);
    assert.strictEqual(pa.length, 1);
    const ca = pa[0].counts;
    assert.ok(ca.figuresCaptured >= 1, "the fixture renders at least one page crop");
    assert.strictEqual(ca.figuresFromMemo, 0, "a first ingest recalls nothing");
    assert.strictEqual(ca.vlmCalls, ca.figuresCaptured, "every crop was asked of the server");
    assert.strictEqual(ca.figuresMemoised, ca.figuresCaptured, "every outcome was kept (the fixture's pages are decorative or captioned, never a failure)");
    assert.strictEqual(pa[0].captionMemo, "none");
    assert.strictEqual(pa[0].captionReset, true, "a document with a crop to ask is preceded by the observed reset");
    assert.strictEqual(pa[0].vlmModelDigest, identity.modelDigest);
    assert.strictEqual(pa[0].vlmServer, identity.server);
    assert.strictEqual(ca.figuresTimedOut, 0);
    assert.strictEqual(ca.figuresFailed, 0);
    const recsA = fixtureRecords();
    assert.strictEqual(recsA.length, ca.figuresCaptured, "one record per crop, hinted with the fixture's docHash");
    assert.ok(recsA.every((r) => r.source === "vlm"));
    // T32: the fixture's three prose pages are `textOnly` under the verdict-first prompt — a memoised verdict like the others.
    assert.ok(recsA.every((r) => ["captioned", "decorative", "textOnly", "truncated"].includes(r.outcome)));
    const fra = (a.fileResults || [])[0];
    assert.deepStrictEqual({ m: fra.counts.figuresFromMemo, c: fra.counts.vlmCalls }, { m: 0, c: ca.figuresCaptured }, "the status frame carries the memo counts");
    t.diagnostic(`A: captured ${ca.figuresCaptured}, captioned ${ca.figuresCaptioned}, decorative ${ca.figuresDecorative}, textOnly ${ca.figuresTextOnly}, vlmCalls ${ca.vlmCalls}, vlmDurationMs ${pa[0].vlmDurationMs}`);

    const b = await ingest(classes.b, [TEXT_PDF]);
    assert.strictEqual(b.status, "completed", JSON.stringify(b).slice(0, 300));
    const pb = parsedOf(classes.b);
    assert.strictEqual(pb.length, 1);
    const cb = pb[0].counts;
    assert.strictEqual(cb.figuresCaptured, ca.figuresCaptured);
    assert.strictEqual(cb.figuresFromMemo, ca.figuresCaptured, "every crop recalled from the memo");
    assert.strictEqual(cb.vlmCalls, 0, "no request was made");
    assert.strictEqual(cb.figuresMemoised, 0);
    assert.strictEqual(pb[0].captionMemo, "all");
    assert.strictEqual(pb[0].captionReset, null, "no crop to ask: no reset, the model never loaded (design D3)");
    assert.ok(Number.isFinite(pb[0].vlmDurationMs) && pb[0].vlmDurationMs < 2000, `the VLM stage is a directory read: ${pb[0].vlmDurationMs} ms`);
    assert.deepStrictEqual({ cap: cb.figuresCaptioned, dec: cb.figuresDecorative, to: cb.figuresTextOnly, tr: cb.figuresTruncated }, { cap: ca.figuresCaptioned, dec: ca.figuresDecorative, to: ca.figuresTextOnly, tr: ca.figuresTruncated }, "the recalled outcomes are A's outcomes (T32: the text-only verdict included)");
    const frb = (b.fileResults || [])[0];
    assert.deepStrictEqual({ m: frb.counts.figuresFromMemo, c: frb.counts.vlmCalls }, { m: ca.figuresCaptured, c: 0 });
    const A = await objects(classes.a), B = await objects(classes.b);
    assert.deepStrictEqual(B, A, "the two classes' chunk sets are byte-identical (keys and text)");
    assert.strictEqual(fixtureRecords().length, recsA.length, "B wrote nothing new");
    t.diagnostic(`B: fromMemo ${cb.figuresFromMemo}, vlmCalls ${cb.vlmCalls}, vlmDurationMs ${pb[0].vlmDurationMs}, chunks ${B.length}`);
  });
});

describe("I-MEMO 2: the memo's listing is the state probe's view (design D7, D8)", () => {
  test("counts by source / outcome / model; no caption text in a listing", { skip: SKIP }, async (t) => {
    const l = memo.list({ withRecords: true });
    assert.strictEqual(l.exists, true);
    assert.ok(l.count >= 1);
    assert.ok((l.bySource.vlm || 0) >= 1);
    assert.ok(Object.keys(l.byModel).some((k) => k.startsWith(`${VLM_MODEL}@`)));
    assert.ok(!l.records.some((r) => "caption" in r), "a listing carries caption md5s and lengths, never the text");
    t.diagnostic(`memo: ${l.count} record(s), ${l.bytes} bytes, bySource ${JSON.stringify(l.bySource)}, byOutcome ${JSON.stringify(l.byOutcome)}`);
  });
});
