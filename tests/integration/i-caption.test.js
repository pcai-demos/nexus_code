/**
 * I-CAPTION — figure captioning is deterministic, switchable and honest,
 * live (ticket T24; design §8). Runs in-pod against Ollama and Weaviate.
 *
 *  1. IDENTITY: two fresh `RAGEval_*V2` classes from the same two documents
 *     (the Site Plan — F-116's page — and SaxonFields — F-1's image-only
 *     brochure), the same request; the set of isVisualElement chunks must be
 *     byte-identical (text, page, figureId) and the counts equal; the text
 *     chunks too (the control). Before T24: 0 / 32 identical (t24-design §0
 *     item 9). T24 closed on "identical within a server state" and REPORTED
 *     the diff (D15 a, F-122); T29's persisted caption memo makes the second
 *     ingest a recall — no request, no reset — so the identity is ASSERTED
 *     again (t29-design D11) together with `vlmCalls 0` on the second ingest.
 *     The server probe (three captions of one crop after resets) is still
 *     run and reported: it says whether the server itself held still.
 *  2. SWITCH: a captions-off ingest of `pdf_text.pdf` (no crop folder exists
 *     for it) → zero isVisualElement chunks, no PNG written, no folder
 *     created, `captioning: "off"` in the ledger, the file `indexed`, and a
 *     docVersion different from the captions-on one (design D8).
 *  4. THE PAGE BUDGET (T31): SSX125 under a budget of 10 — the ledger's
 *     counts say 10 considered / 26 beyond / "11–36"; the outcomes sum to the
 *     pages considered; caption chunks only from the considered pages. T32
 *     (design D13, F-133): count-based — the assertions no longer depend on
 *     which pages of the manual hold figures.
 *  5. TEXT-ONLY (T32, design D1, D2, D8): `pdf_text.pdf` — three pages of
 *     prose and nothing else — every page `textOnly`, 0 visual chunks,
 *     `counts.figuresTextOnly 3`, the three verdicts memoised and recalled
 *     on a second ingest at zero calls; the suite removes its class, the
 *     fixture's crop folder and ITS memo records only (F-95).
 *  3. FAILURE IS VISIBLE: SaxonFields with the captioner at a dead port →
 *     every figure `error`, the file `partial` / `captions_incomplete` with
 *     its text indexed, the job `partial`; a plain `skip` re-ingest with the
 *     real captioner re-attempts it (`reindexReason: partial_record`) and
 *     ends `indexed`.
 * Classes deleted through the schema API; crop folders: the suite creates
 * none (the two production documents' folders pre-exist and are only read;
 * pdf_text.pdf must leave none behind — asserted, F-95).
 * Skipped unless RAG_EVAL_WEAVIATE_URL and RAG_EVAL_EMBED_URL are set.
 * About eight minutes with the captioner warm.
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
// T37 (design D6): the suite follows the shipped default; RAG_EVAL_VLM_MODEL overrides it.
const VLM_MODEL = process.env.RAG_EVAL_VLM_MODEL || cap.DEFAULT_CAPTION_MODEL;

const SITEPLAN = "demos/demo_files/ext_reg_docs/Barratt_Homes_SitePlan.pdf";
const SAXON = "demos/demo_files/ext_reg_docs/Barratt_Homes-SaxonFields.pdf";
// A document with a text layer AND figures: with every caption failed it is
// `partial` (its text indexed), where an image-only document would be `empty`.
const HICK = "demos/demo_files/ext_reg_docs/GraemeHick.pdf";
// T31: a 36-page manual whose every crop the memo already holds (the seed +
// the harness's records) — the budget case costs no VLM time and the crop
// folder is production's (byte-identical renders, left alone — F-95).
const SSX = "demos/demo_files/ext_reg_docs/SSX125_Manual.pdf";
const TEXT_PDF = "eval_fixtures/t24_pdf_text.pdf"; // copied from tests/fixtures/golden/pdf_text.pdf below
const FIXTURE_SRC = path.join(APP_ROOT, "tests", "fixtures", "golden", "pdf_text.pdf");

const classes = config ? { a: makeRunCollection("t24capA"), b: makeRunCollection("t24capB"), off: makeRunCollection("t24capOff"), on: makeRunCollection("t24capOn"), fail: makeRunCollection("t24capFail"), budget: makeRunCollection("t31budget"), whole: makeRunCollection("t31whole"), textA: makeRunCollection("t32textA"), textB: makeRunCollection("t32textB") } : null;
const memoMod = require("../../src/lib/ingestion/caption_memo.js");
const memo = memoMod.openCaptionMemo();
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
const md5File = (rel) => md5(fs.readFileSync(path.join(APP_ROOT, "public", rel)));

function ingestBody(collection, filePaths, extra = {}, ragExtra = {}) {
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
    ...extra,
    ragSettings: { weaviateCollection: collection, allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"], maxFileSize: 50, duplicatePolicy: "skip", ...ragExtra },
  };
}

async function ingest(collection, filePaths, extra, ragExtra) {
  const started = await postJson(`${config.appUrl}/api/ingest`, ingestBody(collection, filePaths, extra, ragExtra));
  assert.equal(started.status, 202, `ingest into ${collection} refused: ${started.text}`);
  const final = await waitForIngestion(config.appUrl, started.json.jobId, 1500000);
  return final;
}

async function gql(query) {
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  const res = await fetch(`${config.weaviateUrl}/v1/graphql`, { method: "POST", headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(120000) });
  const j = await res.json();
  // The message is evaluated eagerly: stringify a defined value, or the passing branch throws (the first in-pod run).
  if (j.errors) assert.fail(`graphql: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.data;
}

/** Every object of a class, keyed for comparison. */
async function objects(base) {
  const cls = `${base}V2`;
  let all = [], afterId = null;
  for (;;) {
    const cursor = afterId ? `, after: "${afterId}"` : "";
    const d = await gql(`{ Get { ${cls}(limit: 200${cursor}) { text source page chunkIndex docVersion isVisualElement metadata _additional { id } } } }`);
    const rows = d.Get[cls] || [];
    all.push(...rows);
    if (rows.length < 200) break;
    afterId = rows[rows.length - 1]._additional.id;
  }
  // T33: a detail chunk is an isVisualElement chunk too (`metadata.detail`, its own figureId `detail_<page>`) — keyed
  // as its own kind, so the identity compare sees it and the caption counts below exclude it.
  return all.map((o) => {
    let meta = {}; try { meta = JSON.parse(o.metadata || "{}"); } catch (e) {}
    const visual = o.isVisualElement === true || meta.isVisualElement === true;
    const detail = meta.detail === true;
    return { key: `${o.source}|${o.page}|${detail ? "detail" : visual ? "caption" : "text"}|${visual ? meta.figureId : o.chunkIndex}`, visual, detail, textMd5: md5(o.text || ""), docVersion: o.docVersion, source: o.source, page: o.page };
  });
}

async function deleteClass(base) {
  const name = `${base}V2`;
  assertEvalCollection(base);
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  await fetch(`${config.weaviateUrl}/v1/schema/${name}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) }).catch(() => {});
}

function parsedEvents(base) {
  return ledger.readEvents(ledger.defaultLedgerPath()).events.filter((e) => e.collection === `${base}V2`);
}

/** T32: the memo records that belong to the fixture (its docHash in the hint) — the only ones this suite may touch (F-95). */
const fixtureHash = fs.existsSync(FIXTURE_SRC) ? md5(fs.readFileSync(FIXTURE_SRC)) : null;
function fixtureRecords() {
  return memo.list({ withRecords: true }).records.filter((r) => r.hint && r.hint.docHash === fixtureHash);
}
function removeFixtureRecords() {
  let n = 0;
  for (const r of fixtureRecords()) if (memo.remove(r.key)) n++;
  return n;
}
let memoOthersBefore = null;

if (config) {
  after(async () => {
    for (const base of Object.values(classes)) await deleteClass(base);
    fs.rmSync(path.join(APP_ROOT, "public", TEXT_PDF), { force: true });
    // F-95: the fixture's crop folder must not exist afterwards (the suite never creates one).
    const h = md5(fs.readFileSync(FIXTURE_SRC));
    if (fs.existsSync(path.join(CROPS, h))) fs.rmSync(path.join(CROPS, h), { recursive: true, force: true });
    // T32 (F-95): the fixture's memo records — the only ones this suite wrote — are removed; the memo's other records are counted before and after.
    removeFixtureRecords();
    if (memoOthersBefore !== null) {
      const othersAfter = memo.list().count - fixtureRecords().length;
      assert.strictEqual(othersAfter, memoOthersBefore, "the memo's other records are untouched by this suite (F-95)");
    }
  });
}

describe("I-CAPTION 1: two fresh ingests of the same documents are byte-identical (design D2, D3)", () => {
  test("the server itself: three captions of one crop, each after a reset, are byte-identical (else the tolerated skip)", { skip: SKIP }, async (t) => {
    const crop = path.join(CROPS, md5File(SITEPLAN), "fig_5_0.png");
    assert.ok(fs.existsSync(crop), `the Site Plan's production crop folder is expected at ${crop}`);
    const hashes = [];
    for (let i = 0; i < 3; i++) {
      const reset = await cap.resetCaptionServer({ ollamaUrl: OLLAMA, modelName: VLM_MODEL, label: "i-caption probe" });
      assert.strictEqual(reset.ok, true, `reset ${i + 1} failed: ${reset.error}`);
      const r = await cap.captionFigure(crop, { ollamaUrl: OLLAMA, modelName: VLM_MODEL, label: `i-caption probe ${i + 1}` });
      assert.strictEqual(r.outcome, "captioned", `probe ${i + 1}: ${r.outcome} ${r.error || ""}`);
      hashes.push(md5(r.caption));
    }
    t.diagnostic(`server probe hashes: ${hashes.map((h) => h.slice(0, 8)).join(" ")}`);
    global.__t24ServerDeterministic = hashes.every((h) => h === hashes[0]);
    if (!global.__t24ServerDeterministic) t.diagnostic("the server did not return identical bytes for one crop after a reset (F-122's drift inside one probe); with the caption memo (T29) the identity assertion below no longer depends on it");
  });

  test("Site Plan + SaxonFields twice: caption chunks identical, text chunks identical, counts equal", { skip: SKIP }, async (t) => {
    const a = await ingest(classes.a, [SITEPLAN, SAXON]);
    assert.strictEqual(a.status, "completed", `class A: ${JSON.stringify(a).slice(0, 300)}`);
    const b = await ingest(classes.b, [SITEPLAN, SAXON]);
    assert.strictEqual(b.status, "completed", `class B: ${JSON.stringify(b).slice(0, 300)}`);
    const A = await objects(classes.a), B = await objects(classes.b);
    const mA = new Map(A.map((o) => [o.key, o])), mB = new Map(B.map((o) => [o.key, o]));
    const onlyA = [...mA.keys()].filter((k) => !mB.has(k)), onlyB = [...mB.keys()].filter((k) => !mA.has(k));
    const both = [...mA.keys()].filter((k) => mB.has(k));
    const textDiff = both.filter((k) => !mA.get(k).visual && mA.get(k).textMd5 !== mB.get(k).textMd5);
    const capDiff = both.filter((k) => mA.get(k).visual && mA.get(k).textMd5 !== mB.get(k).textMd5);
    const captions = both.filter((k) => mA.get(k).visual).length;
    t.diagnostic(`A ${A.length} objects, B ${B.length}; captions in both ${captions}, differing ${capDiff.length}; text differing ${textDiff.length}; onlyA ${onlyA.length}, onlyB ${onlyB.length}`);
    assert.deepStrictEqual(textDiff, [], "text chunks are the control: identical");
    assert.ok(captions >= 7, `expected at least 7 caption chunks (the Site Plan's 7 pages), got ${captions}`);
    for (const e of parsedEvents(classes.a).filter((e) => e.event === "file_parsed")) {
      assert.strictEqual(e.captioning, "on");
      // T29: the reset happens only when a crop must be asked (design D3); a
      // document recalled whole (a seeded or earlier-captioned one) has none.
      assert.strictEqual(e.captionReset, e.counts.vlmCalls > 0 ? true : null, `${e.fileName}: reset iff a crop was asked (vlmCalls ${e.counts.vlmCalls})`);
      assert.strictEqual(e.counts.figuresTimedOut, 0, `${e.fileName}: a timeout is a partial file, never a silent loss`);
      assert.strictEqual(e.counts.figuresFailed, 0);
      assert.ok(e.counts.figuresCaptioned + e.counts.figuresDecorative <= e.counts.figuresCaptured, `${e.fileName}: the outcomes add up`);
      assert.strictEqual(e.counts.figuresFromMemo + e.counts.vlmCalls, e.counts.figuresCaptured, `${e.fileName}: every crop was either recalled or asked`);
    }
    // T29 (design D11): the second ingest is a recall — every crop from the
    // memo, no request, no reset — so byte-identity is ASSERTED again (T24's
    // D15 (a) reported it; F-122's drift is what the memo removes).
    for (const e of parsedEvents(classes.b).filter((e) => e.event === "file_parsed")) {
      assert.strictEqual(e.counts.vlmCalls, 0, `${e.fileName}: the second ingest asks the server for nothing`);
      assert.strictEqual(e.counts.figuresFromMemo, e.counts.figuresCaptured, `${e.fileName}: every crop recalled`);
      assert.strictEqual(e.captionMemo, "all");
      assert.strictEqual(e.captionReset, null, `${e.fileName}: no reset when nothing is asked`);
    }
    const identical = onlyA.length === 0 && onlyB.length === 0 && capDiff.length === 0;
    t.diagnostic(`CAPTION IDENTITY: ${identical ? "byte-identical" : `NOT identical — ${capDiff.length} caption(s) differ, ${onlyA.length} only in A, ${onlyB.length} only in B`}; server probe ${global.__t24ServerDeterministic === false ? "drifted within the probe" : "stable"}`);
    assert.deepStrictEqual({ onlyA, onlyB, capDiff }, { onlyA: [], onlyB: [], capDiff: [] }, "two ingests of the same documents are byte-identical in their caption chunks (T29)");
  });
});

describe("I-CAPTION 2: the captioning switch (design D6, D7, D8)", () => {
  test("captions off: zero visual chunks, no PNG, no crop folder, captioning 'off' recorded; captions on is a different docVersion of the same bytes", { skip: SKIP }, async (t) => {
    fs.mkdirSync(path.join(APP_ROOT, "public", "eval_fixtures"), { recursive: true });
    fs.copyFileSync(FIXTURE_SRC, path.join(APP_ROOT, "public", TEXT_PDF));
    const h = md5(fs.readFileSync(FIXTURE_SRC));
    const folder = path.join(CROPS, h);
    assert.ok(!fs.existsSync(folder), `the fixture's crop folder must not pre-exist (${folder}); the suite cannot own it otherwise (F-95)`);
    const off = await ingest(classes.off, [TEXT_PDF], {}, { captionFigures: false });
    assert.strictEqual(off.status, "completed", JSON.stringify(off).slice(0, 300));
    assert.ok(!fs.existsSync(folder), "captioning off wrote no PNG and created no folder");
    const objs = await objects(classes.off);
    assert.ok(objs.length > 0, "the text chunks are indexed");
    assert.strictEqual(objs.filter((o) => o.visual).length, 0, "zero isVisualElement chunks");
    const parsedOff = parsedEvents(classes.off).filter((e) => e.event === "file_parsed");
    assert.strictEqual(parsedOff.length, 1);
    assert.strictEqual(parsedOff[0].captioning, "off");
    assert.strictEqual(parsedOff[0].captionReset, null, "no reset when nothing is captioned");
    assert.strictEqual(parsedOff[0].counts.figuresCaptured, 0);
    assert.strictEqual(parsedOff[0].counts.figuresCaptioned, 0);
    const fr = (off.fileResults || [])[0];
    assert.strictEqual(fr.status, "indexed");
    assert.strictEqual(fr.counts.figuresCaptured, 0, "the status frame carries the figure counts");

    // D8: the same bytes with captioning ON are a NEW version (a different
    // chunk set); the sourceId is the same document. The on ingest renders
    // the page and captions it, creating the fixture's crop folder — which
    // this suite therefore owns and removes (F-95).
    const on = await ingest(classes.on, [TEXT_PDF]);
    assert.strictEqual(on.status, "completed", JSON.stringify(on).slice(0, 300));
    const parsedOn = parsedEvents(classes.on).filter((e) => e.event === "file_parsed");
    assert.strictEqual(parsedOn.length, 1);
    assert.strictEqual(parsedOn[0].captioning, "on");
    assert.strictEqual(parsedOn[0].sourceId, parsedOff[0].sourceId, "one document");
    assert.notStrictEqual(parsedOn[0].docVersion, parsedOff[0].docVersion, "captions off is a different document version (design D8)");
    assert.strictEqual(parsedOn[0].docVersion.split(".")[0], parsedOff[0].docVersion.split(".")[0], "the same content hash");
    assert.ok(parsedOn[0].counts.figuresCaptured >= 1, "captioning on rendered the page");
    assert.ok(fs.existsSync(folder), "captioning on wrote the crop folder (removed by the teardown)");
    t.diagnostic(`docVersion off ${parsedOff[0].docVersion} / on ${parsedOn[0].docVersion}; on captured ${parsedOn[0].counts.figuresCaptured}, captioned ${parsedOn[0].counts.figuresCaptioned}, decorative ${parsedOn[0].counts.figuresDecorative}`);
  });
});

describe("I-CAPTION 3: a failed caption is a visible outcome (design D4)", () => {
  test("captioner at a dead port: every figure error, the file partial / captions_incomplete with its text indexed, the job partial; a skip re-ingest re-attempts and completes", { skip: SKIP }, async (t) => {
    const dead = await ingest(classes.fail, [HICK], { vlmEndpointUrl: "http://127.0.0.1:9" });
    t.diagnostic(`dead-port ingest: ${dead.status} ${dead.errorCode || ""} ${String(dead.error || "").slice(0, 200)}`);
    assert.strictEqual(dead.status, "partial", JSON.stringify(dead).slice(0, 400));
    assert.strictEqual(dead.errorCode, "INGEST_PARTIAL");
    const fr = (dead.fileResults || [])[0];
    assert.strictEqual(fr.status, "partial");
    assert.strictEqual(fr.reason, "captions_incomplete");
    assert.match(fr.error, /5 of 5 figure\(s\) not captioned \(0 timed out, 5 failed\)/);
    assert.strictEqual(fr.counts.figuresFailed, 5);
    assert.strictEqual(fr.counts.figuresCaptioned, 0);
    assert.ok(fr.counts.chunksInserted > 0 && fr.counts.chunksInserted === fr.counts.chunksEmitted, "every text chunk landed");
    assert.match(dead.error, /captions_incomplete/);
    assert.match(dead.error, /5 of 5 figure\(s\) not captioned/);
    const ev = parsedEvents(classes.fail);
    const parsed = ev.find((e) => e.event === "file_parsed");
    assert.strictEqual(parsed.captionReset, false, "the reset against a dead port is recorded as failed");
    // T29: a dead server has no readable identity, so the memo is bypassed
    // (never a key, never a record for a failure) and every crop is asked.
    assert.strictEqual(parsed.captionMemo, "unavailable");
    assert.strictEqual(parsed.counts.figuresFromMemo, 0);
    assert.strictEqual(parsed.counts.vlmCalls, 5);
    const failed = ev.find((e) => e.event === "file_failed");
    assert.ok(failed, "the ledger holds a partial outcome, so T07 re-attempts the file");
    assert.strictEqual(failed.status, "partial");
    assert.strictEqual(failed.reason, "captions_incomplete");
    assert.strictEqual(failed.counts.figuresFailed, 5);
    assert.ok(!ev.some((e) => e.event === "file_indexed"), "no complete record was written for the partial file");
    const objsBefore = await objects(classes.fail);
    assert.ok(objsBefore.length >= 1 && objsBefore.every((o) => !o.visual), "the text is indexed; no caption chunk");

    // The same request with the real captioner, under `skip`: re-attempted, not skipped.
    const again = await ingest(classes.fail, [HICK]);
    assert.strictEqual(again.status, "completed", JSON.stringify(again).slice(0, 300));
    const fr2 = (again.fileResults || [])[0];
    assert.strictEqual(fr2.status, "indexed");
    assert.strictEqual(fr2.reindexReason, "partial_record", "T07's partial path re-attempted the document");
    assert.strictEqual(fr2.counts.figuresFailed, 0);
    assert.strictEqual(fr2.counts.figuresCaptured, 5);
    const parsedAgain = parsedEvents(classes.fail).filter((e) => e.event === "file_parsed");
    const last = parsedAgain[parsedAgain.length - 1];
    // T29: the re-attempt recalls what the memo holds for these crops and asks for the rest; the reset accompanies an ask.
    assert.strictEqual(last.captionReset, last.counts.vlmCalls > 0 ? true : null, `reset iff a crop was asked (vlmCalls ${last.counts.vlmCalls}, fromMemo ${last.counts.figuresFromMemo})`);
    assert.strictEqual(last.counts.figuresFromMemo + last.counts.vlmCalls, 5, "every crop recalled or asked; the dead-port failures were never memoised");
    assert.ok(["all", "partial", "none"].includes(last.captionMemo));
    assert.ok(parsedEvents(classes.fail).some((e) => e.event === "file_indexed"), "a complete record now");
    t.diagnostic(`re-ingest: captured ${fr2.counts.figuresCaptured}, captioned ${fr2.counts.figuresCaptioned} (GraemeHick's pages are mostly decorative)`);
  });
});

describe("I-CAPTION 4 (T31, multimodal-workshop-design D5–D7, F-123): the caption page budget — a visible bound, the pages beyond it counted and named, never partial; the default considers every page", () => {
  test("SSX125 (36 pages) under captionPageBudget 10: 10 considered, 26 beyond the budget named 11–36 on the frame and the ledger, the file indexed; under the default: 36 considered, nothing beyond; two versions of one document", { skip: SKIP }, async (t) => {
    const budget = await ingest(classes.budget, [SSX], {}, { captionPageBudget: 10 });
    assert.strictEqual(budget.status, "completed", JSON.stringify(budget).slice(0, 300));
    const fr = (budget.fileResults || [])[0];
    assert.strictEqual(fr.status, "indexed", "a page beyond the budget is never a partial file (D5)");
    assert.deepStrictEqual(
      { captured: fr.counts.figuresCaptured, considered: fr.counts.figuresConsidered, beyond: fr.counts.figuresNotAttempted, budget: fr.captionBudget, pages: fr.notAttemptedPages },
      { captured: 36, considered: 10, beyond: 26, budget: 10, pages: "11–36" },
      "the status frame names the budget's verdict"
    );
    assert.strictEqual(fr.counts.figuresFromMemo + fr.counts.vlmCalls, 10, "every considered crop was recalled or asked; nothing beyond the budget was touched");
    const parsed = parsedEvents(classes.budget).find((e) => e.event === "file_parsed");
    assert.deepStrictEqual(
      { considered: parsed.counts.figuresConsidered, beyond: parsed.counts.figuresNotAttempted, budget: parsed.captionBudget, pages: parsed.notAttemptedPages },
      { considered: 10, beyond: 26, budget: 10, pages: "11–36" },
      "the ledger's file_parsed says the same"
    );
    const indexed = parsedEvents(classes.budget).find((e) => e.event === "file_indexed");
    assert.strictEqual(indexed.counts.figuresNotAttempted, 26, "the terminal record carries the count (a frame rebuilt from the ledger has it)");
    // T32 (design D13, F-133): the verdicts add up to the pages considered, and the caption chunks come
    // only from those pages — never "how many pages of this manual hold a figure", which is the captioner's
    // business, not the budget's.
    const sumB = parsed.counts.figuresCaptioned + parsed.counts.figuresDecorative + (parsed.counts.figuresTextOnly ?? 0) + parsed.counts.figuresTruncated + parsed.counts.figuresTimedOut + parsed.counts.figuresFailed;
    assert.strictEqual(sumB, 10, `captioned + decorative + textOnly + truncated + timedOut + failed = the pages considered (${JSON.stringify(parsed.counts)})`);
    const objsB = await objects(classes.budget);
    const capsB = objsB.filter((o) => o.visual && !o.detail);
    assert.strictEqual(capsB.length, parsed.counts.figuresCaptioned, "one caption chunk per captioned page");
    assert.ok(capsB.length <= 10, `caption chunks only from the considered pages: ${capsB.length}`);
    assert.ok(capsB.every((o) => o.page <= 10), "no caption chunk beyond page 10");
    // T33 (design D1, D5): a detail chunk rides only on a captioned page — so only on the pages the budget considered.
    const detB = objsB.filter((o) => o.detail);
    // T34 (F-142): a page that fired but read an empty index emits no chunk — the store's detail chunks equal the ledger's
    // detailChunks (the pages that emitted one), not detailPages (the pages that fired); the two differ by detailEmpty.
    assert.strictEqual(detB.length, parsed.counts.detailChunks, "one detail chunk per page that fired under auto AND read an index (the ledger's detailChunks)");
    assert.strictEqual(parsed.counts.detailPages, parsed.counts.detailChunks + (parsed.counts.detailEmpty || 0) + (parsed.counts.detailFailed || 0), "fired = emitted + empty + failed");
    assert.ok(detB.every((o) => o.page <= 10), "no detail chunk beyond page 10: a page beyond the budget is never captioned, so it never fires");
    t.diagnostic(`budget 10: ${capsB.length} caption chunk(s), fromMemo ${fr.counts.figuresFromMemo}, vlmCalls ${fr.counts.vlmCalls}, captioned ${fr.counts.figuresCaptioned}, decorative ${parsed.counts.figuresDecorative}, textOnly ${parsed.counts.figuresTextOnly}, truncated ${parsed.counts.figuresTruncated}`);

    const whole = await ingest(classes.whole, [SSX]);
    assert.strictEqual(whole.status, "completed", JSON.stringify(whole).slice(0, 300));
    const fw = (whole.fileResults || [])[0];
    assert.deepStrictEqual(
      { captured: fw.counts.figuresCaptured, considered: fw.counts.figuresConsidered, beyond: fw.counts.figuresNotAttempted, budget: fw.captionBudget, pages: fw.notAttemptedPages },
      { captured: 36, considered: 36, beyond: 0, budget: 0, pages: null },
      "the default: every page considered, nothing beyond"
    );
    assert.strictEqual(fw.counts.figuresFromMemo + fw.counts.vlmCalls, 36);
    const objsW = await objects(classes.whole);
    const capsW = objsW.filter((o) => o.visual && !o.detail);
    const parsedW = parsedEvents(classes.whole).find((e) => e.event === "file_parsed");
    assert.strictEqual(objsW.filter((o) => o.detail).length, parsedW.counts.detailChunks, "the whole manual: one detail chunk per page that fired and read an index (F-142: SSX125's p26 / p34 read none)");
    assert.strictEqual(parsedW.counts.detailEmpty, 2, "the two empty-index pages counted (T34 A15)");
    assert.ok(objsW.filter((o) => o.detail).length >= detB.length, "the whole manual fires on at least the budgeted pages' detail pages");
    const sumW = parsedW.counts.figuresCaptioned + parsedW.counts.figuresDecorative + (parsedW.counts.figuresTextOnly ?? 0) + parsedW.counts.figuresTruncated + parsedW.counts.figuresTimedOut + parsedW.counts.figuresFailed;
    assert.strictEqual(sumW, 36, `the verdicts add up to every page (${JSON.stringify(parsedW.counts)})`);
    assert.strictEqual(capsW.length, parsedW.counts.figuresCaptioned, "one caption chunk per captioned page");
    assert.ok(capsW.length <= 36 && capsW.every((o) => o.page <= 36), "caption chunks only from considered pages");
    assert.ok(capsW.length >= capsB.length, `the whole manual has at least the budgeted pages' captions (${capsW.length} >= ${capsB.length}): the first ten pages recall the same verdicts from the memo`);
    assert.ok(capsB.every((b) => capsW.some((w) => w.key === b.key && w.textMd5 === b.textMd5)), "every budgeted caption chunk is in the whole ingest, byte for byte (the memo)");
    assert.strictEqual(parsedW.sourceId, parsed.sourceId, "one document");
    assert.notStrictEqual(parsedW.docVersion, parsed.docVersion, "a non-zero budget is a different version of the document (A1: a different chunk set)");
    assert.strictEqual(parsedW.docVersion.split(".")[0], parsed.docVersion.split(".")[0], "the same content hash");
    t.diagnostic(`whole: ${capsW.length} caption chunk(s), fromMemo ${fw.counts.figuresFromMemo}, vlmCalls ${fw.counts.vlmCalls}, captioned ${fw.counts.figuresCaptioned}, decorative ${parsedW.counts.figuresDecorative}, textOnly ${parsedW.counts.figuresTextOnly}, truncated ${parsedW.counts.figuresTruncated}`);
  });
});

describe("I-CAPTION 5 (T32, t32-design D1, D2, D8): a page of prose is textOnly — counted, memoised, no chunk — and recalled at zero calls", () => {
  test("pdf_text.pdf: every page textOnly, 0 visual chunks, figuresTextOnly 3 on the frame and the ledger, the three verdicts memoised; a second ingest recalls them with no request and the same chunks", { skip: SKIP }, async (t) => {
    assert.ok(fixtureHash, `fixture missing: ${FIXTURE_SRC}`);
    fs.mkdirSync(path.join(APP_ROOT, "public", "eval_fixtures"), { recursive: true });
    fs.copyFileSync(FIXTURE_SRC, path.join(APP_ROOT, "public", TEXT_PDF));
    const folder = path.join(CROPS, fixtureHash);
    // Case 2's captions-on ingest may have rendered the fixture (its folder) and memoised its pages under the
    // same keys; this case owns both: the folder goes at teardown, the records go now so the first ingest ASKS.
    const stale = removeFixtureRecords();
    if (stale) t.diagnostic(`removed ${stale} record(s) of the fixture written earlier in this suite`);
    memoOthersBefore = memo.list().count;
    const cap32 = require("../../src/lib/ingestion/vlm_captioner.js");
    assert.strictEqual("SYSTEM_PROMPT" in cap32, false, "the T32 captioner (two generic prompts) is what this image ships");

    const a = await ingest(classes.textA, [TEXT_PDF]);
    assert.strictEqual(a.status, "completed", JSON.stringify(a).slice(0, 300));
    const fra = (a.fileResults || [])[0];
    assert.strictEqual(fra.status, "indexed", "a text-only page is a verdict, never a partial file");
    const pa = parsedEvents(classes.textA).find((e) => e.event === "file_parsed");
    assert.deepStrictEqual(
      { captured: pa.counts.figuresCaptured, captioned: pa.counts.figuresCaptioned, textOnly: pa.counts.figuresTextOnly, decorative: pa.counts.figuresDecorative, truncated: pa.counts.figuresTruncated, timedOut: pa.counts.figuresTimedOut, failed: pa.counts.figuresFailed },
      { captured: 3, captioned: 0, textOnly: 3, decorative: 0, truncated: 0, timedOut: 0, failed: 0 },
      "the ledger's file_parsed: three pages read and found to be text"
    );
    assert.deepStrictEqual({ textOnly: fra.counts.figuresTextOnly, decorative: fra.counts.figuresDecorative, captioned: fra.counts.figuresCaptioned }, { textOnly: 3, decorative: 0, captioned: 0 }, "the status frame carries the verdict counts");
    assert.strictEqual(pa.counts.vlmCalls, 3, "every page asked on the first ingest");
    assert.strictEqual(pa.counts.figuresMemoised, 3, "every verdict kept");
    assert.strictEqual(pa.captionMemo, "none");
    assert.deepStrictEqual(pa.captionPrompts, { withText: cap32.CAPTION_PROMPT_MD5.withText.slice(0, 8), noText: cap32.CAPTION_PROMPT_MD5.noText.slice(0, 8) }, "the ledger names the prompt variants that wrote the document's captions");
    const objsA = await objects(classes.textA);
    assert.ok(objsA.length >= 3, "the text chunks are indexed (the page's index entry)");
    assert.strictEqual(objsA.filter((o) => o.visual).length, 0, "zero isVisualElement chunks: a text-only page emits no caption chunk");
    const recs = fixtureRecords();
    assert.strictEqual(recs.length, 3, "one record per page, hinted with the fixture's docHash");
    assert.ok(recs.every((r) => r.outcome === "textOnly" && r.source === "vlm" && r.captionLength === null), `the records are textOnly verdicts with no caption: ${JSON.stringify(recs.map((r) => [r.hint.page, r.outcome]))}`);
    const indexed = parsedEvents(classes.textA).find((e) => e.event === "file_indexed");
    assert.strictEqual(indexed.counts.figuresTextOnly, 3, "the terminal record carries the count (a frame rebuilt from the ledger has it)");

    const b = await ingest(classes.textB, [TEXT_PDF]);
    assert.strictEqual(b.status, "completed", JSON.stringify(b).slice(0, 300));
    const pb = parsedEvents(classes.textB).find((e) => e.event === "file_parsed");
    assert.deepStrictEqual({ calls: pb.counts.vlmCalls, fromMemo: pb.counts.figuresFromMemo, textOnly: pb.counts.figuresTextOnly, memo: pb.captionMemo, reset: pb.captionReset }, { calls: 0, fromMemo: 3, textOnly: 3, memo: "all", reset: null }, "the second ingest recalls the three verdicts: no request, no reset");
    const objsB = await objects(classes.textB);
    assert.deepStrictEqual(objsB.map((o) => `${o.key}|${o.textMd5}`).sort(), objsA.map((o) => `${o.key}|${o.textMd5}`).sort(), "the two classes' chunk sets are byte-identical");
    assert.strictEqual(fixtureRecords().length, 3, "the second ingest wrote nothing new");
    t.diagnostic(`A: vlmCalls ${pa.counts.vlmCalls}, vlmDurationMs ${pa.vlmDurationMs}; B: fromMemo ${pb.counts.figuresFromMemo}, vlmDurationMs ${pb.vlmDurationMs}; chunks ${objsA.length}`);
  });
});
