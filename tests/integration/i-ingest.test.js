/**
 * I-INGEST — golden-corpus ingestion (evaluation-plan §4.1), the T07
 * acceptance: after the ingest, `chunksEmitted == chunksInserted` per file
 * and the ledger's totals match the class's Aggregate count; every input is
 * accounted for as indexed | skipped-with-reason | failed-with-reason (audit
 * E16 — a disallowed extension used to be a console line); each document
 * meets its manifest minimum.
 *
 * Scope: RAG_EVAL_SOURCES (comma-separated fileNames) selects corpus entries;
 * unset = the whole golden corpus (13 documents, ~an hour of captioning).
 * The T07 gate runs the four T08 PDFs + story.md + the .docx + the .pptx —
 * every parser path — plus a generated `unsupported.xyz` (design D13).
 * RAG_EVAL_SCHEMA_VERSION (default 2) picks the class shape; under 1 the
 * per-identity cross-check is skipped (v1 has no identity columns). The
 * version is stated on the request either way (cut-over design D12): the
 * server's default is 2, so a v1 run that sent nothing would write a `V2`
 * class while this suite counted the unsuffixed one.
 *
 * Skipped unless RAG_EVAL_WEAVIATE_URL and RAG_EVAL_EMBED_URL are set.
 * Torn down by a direct schema DELETE (F-39: /api/ingest/clear recreates).
 *
 * T39 (design D10; F-156) — the spreadsheet case at the end: no spreadsheet is
 * in the demo corpus and no test in either suite named `xlsx` until now, while
 * the product lists it as an allowed type and the parser routes it to the
 * bridge. The golden fixture `tests/fixtures/golden/xlsx_sheets.xlsx` (two
 * sheets, a sentinel token on each — the manifest's anchors) is staged under
 * public/eval_fixtures/<run>/, ingested into its OWN v2 class at the unit
 * contract's chunk size, read back, and both class and staging removed.
 */

const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { envConfig, skipReason, makeRunCollection, postJson, waitForIngestion, assertEvalCollection, evalSchemaVersion } = require("./_harness");
const { corpusEntries, generatedExpectation, chunkContractViolations } = require("../unit/_helpers");
const { WeaviateClient } = require("../../src/lib/vectordb/weaviate");
const ledger = require("../../src/lib/rag/ledger");
// T37 (design D6): the captioner the request names top-level is the shipped default.
const { DEFAULT_CAPTION_MODEL } = require("../../src/lib/ingestion/vlm_captioner");

const SKIP = skipReason();
const config = envConfig();
const SCHEMA_VERSION = evalSchemaVersion(2);
const base = config ? makeRunCollection("ingest") : null;
const collection = base ? `${base}${SCHEMA_VERSION === 2 ? "V2" : ""}` : null;
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const fixtureDir = base ? path.join(REPO_ROOT, "public", "eval_fixtures", base) : null;

const sources = (process.env.RAG_EVAL_SOURCES || "").split(",").map((x) => x.trim()).filter(Boolean);
const entries = corpusEntries().filter((e) => sources.length === 0 || sources.includes(e.fileName));

let jobId = null;
let finalState = null;

if (config) {
  after(async () => {
    assertEvalCollection(collection);
    const headers = { "Content-Type": "application/json" };
    if (config.token) headers["x-auth-token"] = config.token;
    try {
      const res = await fetch(`${config.weaviateUrl}/v1/schema/${collection}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
      console.log(`[I-INGEST teardown] DELETE /v1/schema/${collection} → ${res.status}`);
    } catch (err) {
      console.warn(`[I-INGEST teardown] could not drop ${collection}: ${err.message}`);
    }
    if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
  });
}

describe("I-INGEST: golden corpus ingestion", () => {
  test("corpus ingests into a disposable collection and settles", { skip: SKIP }, async (t) => {
    assert.ok(entries.length > 0, `no manifest entries for ${sources.join(", ") || "(all)"}`);
    const filePaths = entries.map((e) => e.sourceId.replace(/^public\//, ""));
    // E16: one input outside the allow-list, generated here so the run does
    // not depend on a git-ignored fixture.
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, "unsupported.xyz"), "this file type is not allowed\n");
    filePaths.push(`eval_fixtures/${base}/unsupported.xyz`);

    const ragSettings = {
      weaviateCollection: base,
      allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"],
      maxFileSize: 50,
      duplicatePolicy: "overwrite",
    };
    ragSettings.schemaVersion = SCHEMA_VERSION;
    const body = () => ({
      filePaths,
      weaviateUrl: config.weaviateUrl,
      token: config.token,
      weaviateToken: config.token,
      embedUrl: config.embedUrl,
      embedModel: config.embedModel,
      weaviateCollection: base,
      // T17 (design D11, F-85): the captioner's identity, top-level like the
      // embed pair — the parser's own default (T37: vlm_captioner.js's
      // DEFAULT_CAPTION_MODEL), so no docVersion moves against a request naming none.
      vlmModelName: DEFAULT_CAPTION_MODEL,
      vlmEndpointUrl: "http://ollama.ollama.svc.cluster.local:11434/v1/",
      vlmApiKey: "1234567890",
      ragSettings,
    });

    const t0 = Date.now();
    const started = await postJson(`${config.appUrl}/api/ingest`, body());
    assert.equal(started.status, 202, `ingest did not accept the batch: ${started.text}`);

    // F-18: the batch must come back with an identity, or nothing below can be
    // attributed to it.
    jobId = started.json?.jobId;
    assert.ok(jobId, `POST /api/ingest returned no jobId: ${started.text}`);

    // A second concurrent ingest is refused rather than interleaved — the
    // overlapping-writes path that produced four docling traces for a two-file
    // ingest and a run reporting a foreign job's completion as its own.
    const concurrent = await postJson(`${config.appUrl}/api/ingest`, body());
    assert.equal(concurrent.status, 409, `a concurrent ingest was not refused: ${concurrent.text}`);
    assert.equal(concurrent.json.code, "INGEST_IN_PROGRESS");
    assert.equal(concurrent.json.activeJobId, jobId, "the refusal must name the job that holds the lock");

    finalState = await waitForIngestion(config.appUrl, jobId, 5400000);
    t.diagnostic(`ingest ${finalState.status} in ${Date.now() - t0} ms: chunksIndexed ${finalState.chunksIndexed}, files ${finalState.filesCompleted}/${finalState.totalFiles}${finalState.error ? `; ${String(finalState.error).slice(0, 300)}` : ""}`);
    assert.equal(finalState.jobId, jobId, "status must report the job we started, not the latest one");
    assert.notEqual(finalState.status, "error", `ingestion failed: ${finalState.error}`);
    assert.equal(finalState.status, "completed", `expected completed, got ${finalState.status}: ${finalState.error}`);
    assert.equal(finalState.filesCompleted, finalState.totalFiles, "every input reached a terminal status");
    assert.equal(finalState.totalFiles, filePaths.length);
  });

  test("an unknown job id is refused, not silently answered with someone else's state", { skip: SKIP }, async () => {
    const res = await fetch(
      `${config.appUrl}/api/ingest/status?jobId=00000000-0000-0000-0000-000000000000`,
      { signal: AbortSignal.timeout(10000) }
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, "JOB_NOT_FOUND");
  });

  test("every input file is accounted for as indexed, skipped or failed — with a reason (E16; T07)", { skip: SKIP }, async (t) => {
    assert.ok(finalState, "the ingest case must have run");
    const results = finalState.fileResults;
    assert.ok(Array.isArray(results) && results.length === finalState.totalFiles, "one outcome per input");
    for (const f of results) {
      assert.ok(["indexed", "skipped", "failed", "partial", "empty"].includes(f.status), `${f.fileName}: ${f.status}`);
      if (f.status !== "indexed") assert.ok(f.reason || f.error, `${f.fileName} is ${f.status} without a reason`);
      t.diagnostic(`${f.fileName}: ${f.status}${f.reason ? ` (${f.reason})` : ""} — ${f.counts.chunksInserted}/${f.counts.chunksEmitted} chunks, engine ${f.engine}, pages ${f.pages}, dropped ${f.counts.chunksDroppedMinSize}`);
    }
    const xyz = results.find((f) => f.fileName === "unsupported.xyz");
    assert.ok(xyz, "the disallowed input has an outcome");
    assert.equal(xyz.status, "skipped");
    assert.equal(xyz.reason, "not_allowed_type");
    const indexed = results.filter((f) => f.status === "indexed");
    assert.equal(indexed.length, entries.length, "every corpus document indexed");
    for (const f of indexed) {
      assert.equal(f.counts.chunksInserted, f.counts.chunksEmitted, `${f.fileName}: chunksEmitted == chunksInserted (the ticket's acceptance)`);
      assert.ok(f.counts.chunksInserted > 0, `${f.fileName} inserted nothing`);
      assert.equal(typeof f.engine, "string", `${f.fileName}: engine recorded`);
    }
  });

  test("the ledger's counts equal the store's: per file and in total (the ticket's acceptance)", { skip: SKIP }, async (t) => {
    assert.ok(finalState, "the ingest case must have run");
    const events = ledger.readEvents(ledger.defaultLedgerPath()).events.filter((e) => e.jobId === jobId);
    assert.ok(events.length > 0, `no ledger events for job ${jobId} at ${ledger.defaultLedgerPath()}`);
    const end = events.find((e) => e.event === "ingest_end");
    assert.ok(end, "ingest_end recorded");
    assert.equal(end.status, "completed");
    const indexedEvents = events.filter((e) => e.event === "file_indexed");
    assert.equal(indexedEvents.length, entries.length);
    // T17 (design D11): the request named the captioner top-level; every
    // parse that captioned records that model and none records another.
    const parsed = events.filter((e) => e.event === "file_parsed");
    assert.ok(parsed.length > 0, "file_parsed events recorded");
    const models = new Set(parsed.map((e) => e.vlmModel).filter((m) => m !== null && m !== undefined));
    t.diagnostic(`file_parsed vlmModel values: ${JSON.stringify([...models])} over ${parsed.length} parses`);
    for (const m of models) assert.equal(m, DEFAULT_CAPTION_MODEL, "the captioner named top-level (the shipped default) is the one recorded");
    const client = new WeaviateClient(config.weaviateUrl, config.token, collection, { schemaVersion: SCHEMA_VERSION });
    const total = await client.countObjects();
    const ledgerTotal = indexedEvents.reduce((a, e) => a + e.counts.chunksInserted, 0);
    t.diagnostic(`store ${total} objects; ledger ${ledgerTotal} inserted; job chunksIndexed ${finalState.chunksIndexed}`);
    assert.equal(ledgerTotal, total, "ledger totals match the Aggregate count");
    assert.equal(end.chunks.inserted, total);
    assert.equal(finalState.chunksIndexed, total);
    for (const e of indexedEvents) {
      assert.equal(e.status, "complete");
      assert.equal(e.counts.chunksInserted, e.counts.chunksEmitted, `${e.fileName}: complete means every emitted chunk landed`);
      assert.equal(e.embedDim, 4096, `${e.fileName}: measured embedding dimension recorded`);
      if (SCHEMA_VERSION === 2) {
        const store = await WeaviateClient.forDestructiveOps(config.weaviateUrl, config.token, collection, { schemaVersion: 2 }).countIdentity(e.sourceId, e.docVersion);
        assert.deepStrictEqual(store, { count: e.counts.chunksInserted, maxChunkIndex: e.counts.chunksInserted - 1 }, `${e.fileName}: the store holds exactly 0..n-1`);
        const outcome = ledger.latestFileOutcome(ledger.readEvents(ledger.defaultLedgerPath()).events, { collection, sourceId: e.sourceId, docVersion: e.docVersion });
        assert.ok(ledger.isRecordedComplete(outcome), `${e.fileName}: recorded complete`);
      }
    }
  });

  test("per-document chunk counts meet the manifest minimums", { skip: SKIP }, async () => {
    assert.ok(finalState, "the ingest case must have run");
    for (const e of entries) {
      const f = finalState.fileResults.find((r) => r.fileName === e.fileName);
      assert.ok(f, `${e.fileName}: no outcome`);
      assert.ok(
        f.counts.chunksInserted >= e.expectedMinChunks,
        `${e.fileName}: ${f.counts.chunksInserted} chunks, manifest minimum ${e.expectedMinChunks}`
      );
    }
  });
});

describe("I-INGEST: the spreadsheet path (T39 D10; F-156) — xlsx_sheets.xlsx through the bridge into its own class", () => {
  const XLSX_SRC = "tests/fixtures/golden/xlsx_sheets.xlsx";
  const xlsxBase = config ? makeRunCollection("xlsx") : null;
  const xlsxClass = xlsxBase ? `${xlsxBase}V2` : null;
  const xlsxStage = xlsxBase ? path.join(REPO_ROOT, "public", "eval_fixtures", xlsxBase) : null;
  const CHUNK_SIZE = 800; // the unit contract's (u-parse.test.js), so the per-chunk ceiling is the same one
  let xlsxJob = null;
  let xlsxState = null;
  let xlsxObjects = null;

  const headers = () => {
    const h = { "Content-Type": "application/json" };
    if (config.token) h["x-auth-token"] = config.token;
    return h;
  };

  if (config) {
    after(async () => {
      // Only what this describe created: its class and its staged copy of the fixture.
      assertEvalCollection(xlsxBase);
      try {
        const res = await fetch(`${config.weaviateUrl}/v1/schema/${xlsxClass}`, { method: "DELETE", headers: headers(), signal: AbortSignal.timeout(15000) });
        console.log(`[I-INGEST xlsx teardown] DELETE /v1/schema/${xlsxClass} → ${res.status}`);
      } catch (err) {
        console.warn(`[I-INGEST xlsx teardown] could not drop ${xlsxClass}: ${err.message}`);
      }
      if (xlsxStage) fs.rmSync(xlsxStage, { recursive: true, force: true });
    });
  }

  test("the fixture ingests through the docling bridge and settles", { skip: SKIP }, async (t) => {
    const src = path.join(REPO_ROOT, XLSX_SRC);
    assert.ok(fs.existsSync(src), `${XLSX_SRC} exists`);
    fs.mkdirSync(xlsxStage, { recursive: true });
    fs.copyFileSync(src, path.join(xlsxStage, "xlsx_sheets.xlsx"));
    const body = {
      filePaths: [`eval_fixtures/${xlsxBase}/xlsx_sheets.xlsx`],
      weaviateUrl: config.weaviateUrl,
      token: config.token,
      weaviateToken: config.token,
      embedUrl: config.embedUrl,
      embedModel: config.embedModel,
      schemaVersion: 2,
      weaviateCollection: xlsxBase,
      vlmModelName: DEFAULT_CAPTION_MODEL,
      vlmEndpointUrl: "http://ollama.ollama.svc.cluster.local:11434/v1/",
      vlmApiKey: "1234567890",
      ragSettings: { weaviateCollection: xlsxBase, schemaVersion: 2, allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"], maxFileSize: 50, duplicatePolicy: "skip", chunkSize: CHUNK_SIZE, chunkOverlap: 100, minChunkSize: 50 },
    };
    const t0 = Date.now();
    const started = await postJson(`${config.appUrl}/api/ingest`, body);
    assert.equal(started.status, 202, `ingest did not accept the spreadsheet: ${started.text}`);
    xlsxJob = started.json?.jobId;
    assert.ok(xlsxJob, `POST /api/ingest returned no jobId: ${started.text}`);
    xlsxState = await waitForIngestion(config.appUrl, xlsxJob, 600000);
    t.diagnostic(`xlsx ingest ${xlsxState.status} in ${Date.now() - t0} ms: chunksIndexed ${xlsxState.chunksIndexed}`);
    assert.equal(xlsxState.jobId, xlsxJob);
    assert.equal(xlsxState.status, "completed", `expected completed, got ${xlsxState.status}: ${xlsxState.error}`);
    const f = (xlsxState.fileResults || []).find((r) => r.fileName === "xlsx_sheets.xlsx");
    assert.ok(f, "the spreadsheet has an outcome");
    assert.equal(f.status, "indexed", `outcome ${f.status}: ${f.reason || f.error || ""}`);
    // The bridge read it — not the officeparser / raw-UTF-8 fallback (T02's shape is that fallback's; a bridge parse
    // is what this case certifies).
    assert.match(String(f.engine || ""), /Docling/i, `the engine was the bridge, not a fallback: ${f.engine}`);
  });

  test("both sheets' sentinel anchors reach chunk text, on real page numbers, under the per-chunk contract", { skip: SKIP }, async (t) => {
    assert.ok(xlsxState, "the ingest case must have run");
    const expectation = generatedExpectation(XLSX_SRC);
    assert.ok((expectation.anchors || []).length >= 2, "the manifest supplies the two sheets' sentinels");
    const q = `{ Get { ${xlsxClass}(limit: 200) { text source fileType page chunkIndex docVersion isVisualElement metadata } } }`;
    const res = await fetch(`${config.weaviateUrl}/v1/graphql`, { method: "POST", headers: headers(), body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(60000) });
    const j = await res.json();
    if (j.errors) assert.fail(`graphql: ${JSON.stringify(j.errors).slice(0, 300)}`);
    xlsxObjects = (j.data.Get[xlsxClass] || []).sort((a, b) => a.chunkIndex - b.chunkIndex);
    t.diagnostic(`${xlsxObjects.length} chunk(s): pages ${JSON.stringify(xlsxObjects.map((o) => o.page))}`);
    assert.ok(xlsxObjects.length >= expectation.expectedMinChunks, `${xlsxObjects.length} chunks, manifest minimum ${expectation.expectedMinChunks}`);
    assert.equal(xlsxObjects.length, xlsxState.chunksIndexed, "the store holds what the job says it indexed");
    for (const anchor of expectation.anchors) {
      const holder = xlsxObjects.find((o) => String(o.text || "").includes(anchor.token));
      assert.ok(holder, `anchor "${anchor.token}" absent from every chunk`);
      if (Number.isInteger(anchor.page)) assert.equal(holder.page, anchor.page, `anchor "${anchor.token}" is on sheet ${anchor.page} (the bridge's page)`);
    }
    const pages = new Set(xlsxObjects.map((o) => o.page));
    assert.ok([...pages].every((p) => p === 1 || p === 2), `every chunk is on sheet 1 or 2: ${JSON.stringify([...pages])}`);
    assert.ok(pages.size === 2, "both sheets produced chunks");
    const violations = [];
    xlsxObjects.forEach((o, i) => violations.push(...chunkContractViolations({ ...o, source: o.source, fileType: o.fileType, metadata: o.metadata }, i, { chunkSize: CHUNK_SIZE })));
    assert.deepEqual(violations, [], violations.join("\n"));
    for (const o of xlsxObjects) assert.equal(o.fileType, "xlsx", `fileType is xlsx on chunk ${o.chunkIndex}`);
    // A table row survives the chunker whole (the fixture's rows are short).
    assert.ok(xlsxObjects.some((o) => /\|\s*L-001\s*\|/.test(o.text)), "sheet 1's first row is a table row in chunk text");
  });
});
