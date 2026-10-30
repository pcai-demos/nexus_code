/**
 * I-PIN — ticket T16 (audit FM-V3 / E35 / E36; F-12 / F-19's remaining half).
 * Embedding-space pinning by model NAME, live: the ledger's pin
 * (`getCollectionPin`), the ingest-time 409 that runs before any job exists,
 * the same-dimension / different-name warning on retrieve, and the resets.
 *
 * Measured on `main` before T16 (t16-artifacts/t16-reverify-live.json): the
 * four T08 documents re-ingested with the MLIS 2560-dim model under `skip`
 * came back `completed, 0 chunks, 367 ms, four already_indexed` — the wrong
 * model consulted by nothing; under `overwrite` it cost the whole parse
 * (427 s) before Weaviate refused the first insert; and a differently NAMED
 * 4096-dim embedder (only reachable through a model-rewriting proxy — Ollama
 * serves exactly one embedding model) answered 200 with no warning.
 *
 * Cases (each on its own fresh RAGEval_* class, torn down by direct schema
 * DELETE — F-39):
 *   1. pinned by the first landed record; a different-DIMENSION model is
 *      refused 409 before any job, under skip AND overwrite; retrieve is
 *      T08's 400 (unchanged); the pinned model reads `match`
 *   2. the same-dim / different-name witness (the rewrite proxy, D14): ingest
 *      409 on the NAME; retrieve 200 + degradation + report.embedSpace; the
 *      chat path answers `degraded` under the code
 *   3. reset by Tidy Up (a v1 class — `clear` recreates without the v2 flag,
 *      F-71): the alias is accepted afterwards and pins
 *   4. reset by an out-of-band recreate (direct schema DELETE): the alias is
 *      accepted, `since` is the new creation
 *   5. a provisional pin never refuses (D5): a dead embedder on the first
 *      ingest, then ANOTHER name is accepted and pins
 *   6. a stale pin never locks (D4): the class rebuilt by hand at 2560, the
 *      2560-dim model is accepted and the next landed record re-pins
 * Cases 1 and 6 need the second embedder (RAG_EVAL_EMBED_ALT_*: the MLIS
 * Qwen/Qwen3-Embedding-4B, 2560, its own key — F-22) and skip without it.
 * About 5 minutes with the captioner warm (GraemeHick, ~18 chunks, per case).
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { skipReason, envConfig, postJson, waitForIngestion, assertEvalCollection, makeRunCollection } = require("./_harness");
const { startEmbedProxy } = require("./_embed_proxy");
const { missingRegenerableFixture, absPath } = require("../unit/_helpers");
const { WeaviateClient } = require("../../src/lib/vectordb/weaviate");
const ledger = require("../../src/lib/rag/ledger");

const FIXTURE = "tests/fixtures/golden/adversarial/duplicate_a/report.pdf"; // GraemeHick bytes, ~18 chunks
const SKIP = skipReason() || missingRegenerableFixture(FIXTURE);
const ALT = process.env.RAG_EVAL_EMBED_ALT_URL && process.env.RAG_EVAL_EMBED_ALT_MODEL
  ? { url: process.env.RAG_EVAL_EMBED_ALT_URL, model: process.env.RAG_EVAL_EMBED_ALT_MODEL, token: process.env.RAG_EVAL_EMBED_ALT_TOKEN || "" }
  : null;
const SKIP_ALT = SKIP || (ALT ? false : "second embedder not configured — set RAG_EVAL_EMBED_ALT_URL / _MODEL / _TOKEN (the MLIS 2560-dim model)");
const ALIAS = "qwen3-embedding:8b-alias";
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CODE = "EMBED_MODEL_MISMATCH";

/** The events the app's process wrote, read from the file the app writes (same container). */
function ledgerEvents() {
  return ledger.readEvents(ledger.defaultLedgerPath()).events;
}
function ledgerLines() {
  return ledgerEvents().length;
}

function makeClass(t, cfg, suffix, { schemaVersion = 2 } = {}) {
  const base = makeRunCollection(suffix);
  const collection = schemaVersion === 2 ? `${base}V2` : base;
  assertEvalCollection(collection);
  const fixtureDir = path.join(REPO_ROOT, "public", "eval_fixtures", base);
  const headers = { "Content-Type": "application/json" };
  if (cfg.token) headers["x-auth-token"] = cfg.token;
  const client = new WeaviateClient(cfg.weaviateUrl, cfg.token, collection, { schemaVersion });
  const payload = (filePaths, { duplicatePolicy = "skip", embedUrl = cfg.embedUrl, embedModel = cfg.embedModel, embedToken = cfg.token } = {}) => ({
    filePaths,
    weaviateUrl: cfg.weaviateUrl,
    token: embedToken,
    weaviateToken: cfg.token,
    embedUrl,
    embedModel,
    weaviateCollection: base,
    // The version is always stated (cut-over design D12): the server defaults
    // to 2, so a v1 class named without its version would be written as `V2`.
    ragSettings: { weaviateCollection: base, schemaVersion, maxFileSize: 50, duplicatePolicy },
  });
  const post = (filePaths, opts) => postJson(`${cfg.appUrl}/api/ingest`, payload(filePaths, opts));
  async function ingest(label, filePaths, opts) {
    const t0 = Date.now();
    const started = await post(filePaths, opts);
    assert.equal(started.status, 202, `${label}: ingest not accepted: ${started.text}`);
    assert.ok(started.json?.jobId, `${label}: no jobId (F-18)`);
    const final = await waitForIngestion(cfg.appUrl, started.json.jobId, 900000);
    assert.equal(final.jobId, started.json.jobId);
    t.diagnostic(`${label}: ${final.status} ${final.errorCode || ""} in ${Date.now() - t0} ms — chunksIndexed ${final.chunksIndexed}, files ${final.filesCompleted}/${final.totalFiles}${final.error ? `; error: ${String(final.error).slice(0, 160)}` : ""}`);
    return { jobId: started.json.jobId, final };
  }
  const pin = () => ledger.getCollectionPin(ledgerEvents(), { collection, store: ledger.storeOriginOf(cfg.weaviateUrl) });
  const retrieve = ({ embedUrl = cfg.embedUrl, embedModel = cfg.embedModel, embedToken = cfg.token, query = "Graeme Hick" } = {}) =>
    postJson(`${cfg.appUrl}/api/rag/retrieve`, {
      query,
      weaviateUrl: cfg.weaviateUrl,
      weaviateCollection: base,
      schemaVersion,
      token: embedToken,
      weaviateToken: cfg.token,
      embedUrl,
      embedModel,
      searchStrategy: "hybrid",
      rerankEnabled: false,
      limit: 10,
      keepTopNAfterRerank: 5,
    }, 120000);
  const dropSchema = async () => {
    assertEvalCollection(collection);
    const res = await fetch(`${cfg.weaviateUrl}/v1/schema/${collection}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
    return res.status;
  };
  const cleanup = async () => {
    try {
      const c = await postJson(`${cfg.appUrl}/api/ingest/cancel`, {}, 15000);
      if (c.json?.cancelled) await waitForIngestion(cfg.appUrl, c.json.jobId, 180000).catch(() => {});
    } catch (err) {
      console.warn(`[I-PIN teardown] cancel failed: ${err.message}`);
    }
    try {
      t.diagnostic(`teardown: DELETE /v1/schema/${collection} → ${await dropSchema()}`);
    } catch (err) {
      console.warn(`[I-PIN teardown] could not drop ${collection}: ${err.message}`);
    }
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  };
  const seed = (name = "report.pdf") => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.copyFileSync(absPath(FIXTURE), path.join(fixtureDir, name));
    return `eval_fixtures/${base}/${name}`;
  };
  return { base, collection, headers, client, post, ingest, pin, retrieve, dropSchema, cleanup, seed };
}

/** The frame the status route streams for a job (or the latest job without one). */
async function statusFrame(appUrl, jobId) {
  const res = await fetch(`${appUrl}/api/ingest/status${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ""}`, { signal: AbortSignal.timeout(10000) });
  const reader = res.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(value || new Uint8Array());
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return line ? JSON.parse(line.slice(6)) : null;
}

function assertPinned(pin, { embedModel, embedDim, source = "file_indexed" }) {
  assert.ok(pin, "a pin exists");
  assert.equal(pin.embedModel, embedModel);
  assert.equal(pin.embedDim, embedDim);
  assert.equal(pin.enforceable, true);
  assert.equal(pin.source, source);
  assert.ok(pin.pinnedAt && pin.pinnedBy, "pinnedAt / pinnedBy");
}

describe("I-PIN: the pin refuses a different embedding space before any job exists (design D1, D3, D4, D6)", () => {
  test("pinned by the first landed record; a different-dimension model is 409 before any job under skip AND overwrite; retrieve stays T08's 400; the pinned model reads match", { skip: SKIP_ALT }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "pin");
    const filePath = k.seed();
    try {
      const a = await k.ingest("8b on a fresh class", [filePath]);
      assert.equal(a.final.status, "completed", a.final.error || "");
      assert.equal(a.final.fileResults[0].status, "indexed");
      const n = a.final.chunksIndexed;
      const pin = k.pin();
      assertPinned(pin, { embedModel: cfg.embedModel, embedDim: 4096 });
      assert.equal(pin.pinnedBy, a.jobId);
      assert.deepStrictEqual(pin.since?.event, "collection_created", "the class was created by this job");
      assert.deepStrictEqual(pin.modelsSeen, [cfg.embedModel]);
      const created = ledgerEvents().find((e) => e.jobId === a.jobId && e.event === "collection_created");
      assert.equal(created.embedModel, cfg.embedModel);
      assert.equal(created.store, ledger.storeOriginOf(cfg.weaviateUrl), "the store origin is recorded (D10)");
      const indexed = ledgerEvents().find((e) => e.jobId === a.jobId && e.event === "file_indexed");
      assert.equal(indexed.embedDim, 4096);
      assert.equal(indexed.store, ledger.storeOriginOf(cfg.weaviateUrl));
      // the status frame carries the pin of the job's collection (design §8; review: the route change was exercised by nothing)
      const frameA = await statusFrame(cfg.appUrl, a.jobId);
      assert.ok(frameA?.ledger?.pin, `ledger.pin on the frame: ${JSON.stringify(frameA?.ledger).slice(0, 300)}`);
      assert.equal(frameA.ledger.pin.collection, k.collection);
      assert.equal(frameA.ledger.pin.embedModel, cfg.embedModel);
      assert.equal(frameA.ledger.pin.embedDim, 4096);
      assert.equal(frameA.ledger.pin.enforceable, true);
      assert.deepStrictEqual(frameA.ledger.pin.modelsSeen, [cfg.embedModel]);
      assert.equal(frameA.ledger.pin.since?.event, "collection_created");
      assert.ok(!("store" in frameA.ledger.pin), "the store host is not projected onto the unauthenticated frame");

      // the refusal, under skip: before T16 this was `completed, 0 chunks, already_indexed`
      const linesBefore = ledgerLines();
      const t0 = Date.now();
      const refused = await k.post([filePath], { duplicatePolicy: "skip", embedUrl: ALT.url, embedModel: ALT.model, embedToken: ALT.token });
      const wallMs = Date.now() - t0;
      assert.equal(refused.status, 409, `expected 409, got ${refused.status}: ${refused.text}`);
      assert.equal(refused.json.success, false);
      assert.equal(refused.json.code, CODE);
      assert.ok(!("jobId" in refused.json), "no job was created");
      assert.match(refused.json.error, new RegExp(k.collection));
      assert.match(refused.json.error, new RegExp(`'${cfg.embedModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
      assert.match(refused.json.error, new RegExp(`'${ALT.model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
      assert.match(refused.json.error, /4096 dimensions/);
      assert.match(refused.json.error, /recorded \d{4}-\d{2}-\d{2}T/, "the record's date");
      assert.match(refused.json.error, /Nothing was ingested/);
      assert.match(refused.json.error, /set the embedding model back to/, "fix 1");
      assert.match(refused.json.error, /Tidy Up \(clear\) the collection and re-ingest every document with/, "fix 2");
      assert.equal(refused.json.pin.embedModel, cfg.embedModel);
      assert.equal(refused.json.pin.embedDim, 4096);
      assert.equal(ledgerLines(), linesBefore, "nothing recorded for a refused request");
      assert.ok(!ledgerEvents().some((e) => e.collection === k.collection && e.embedModel === ALT.model), "no event names the refused model");
      assert.equal(await k.client.countObjects(), n, "nothing touched");
      const frame = await statusFrame(cfg.appUrl);
      assert.notEqual(frame?.status, "processing", "no job is running");
      t.diagnostic(`409 under skip in ${wallMs} ms (was 367 ms of silent already_indexed before T16)`);

      // and under overwrite — the pin runs before the policy matters (before
      // T16: 427 s of captioning, then Weaviate's refusal at the first insert)
      const t1 = Date.now();
      const refused2 = await k.post([filePath], { duplicatePolicy: "overwrite", embedUrl: ALT.url, embedModel: ALT.model, embedToken: ALT.token });
      assert.equal(refused2.status, 409, refused2.text);
      assert.equal(refused2.json.code, CODE);
      assert.equal(ledgerLines(), linesBefore);
      assert.equal(await k.client.countObjects(), n);
      t.diagnostic(`409 under overwrite in ${Date.now() - t1} ms (was 427 s to a Weaviate refusal before T16)`);

      // a matching name is not refused: the ordinary skip still skips
      const same = await k.ingest("8b again (skip)", [filePath]);
      assert.equal(same.final.status, "completed");
      assert.equal(same.final.fileResults[0].status, "skipped");
      assert.equal(same.final.fileResults[0].reason, "already_indexed");

      // retrieve: another dimension is T08's 400, byte for byte; the pinned model is a match
      const cross = await k.retrieve({ embedUrl: ALT.url, embedModel: ALT.model, embedToken: ALT.token });
      assert.equal(cross.status, 400, cross.text);
      assert.equal(cross.json.code, CODE);
      assert.match(cross.json.error, /2560 dimensions/);
      const ok = await k.retrieve();
      assert.equal(ok.status, 200, ok.text);
      assert.ok(ok.json.results.length > 0, "results");
      assert.equal(ok.json.degraded, undefined, "no degradation");
      assert.deepStrictEqual(ok.json.report.embedSpace, { queryModel: cfg.embedModel, queryDim: 4096, pinnedModel: cfg.embedModel, pinnedDim: 4096, pinSource: "file_indexed", verdict: "match" });
    } finally {
      await k.cleanup();
    }
  });
});

describe("I-PIN: the same-dimension / different-name leg — the model-rewriting proxy is its only witness (design D7, D11, D14)", () => {
  test("an alias of the pinned model: ingest 409 on the NAME; retrieve 200 with an embed degradation and report.embedSpace name_mismatch; the chat path answers degraded under the code", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "alias");
    const filePath = k.seed();
    let proxy = null;
    try {
      const a = await k.ingest("8b on a fresh class", [filePath]);
      assert.equal(a.final.status, "completed", a.final.error || "");
      const n = a.final.chunksIndexed;
      assertPinned(k.pin(), { embedModel: cfg.embedModel, embedDim: 4096 });

      // the app names the alias; the proxy asks Ollama for the real model
      proxy = await startEmbedProxy({ upstream: cfg.embedUrl, rewriteModel: { from: ALIAS, to: cfg.embedModel } });

      // ingest: the dimension WOULD match (4096 comes back), the name does not
      const linesBefore = ledgerLines();
      const refused = await k.post([filePath], { duplicatePolicy: "skip", embedUrl: proxy.url, embedModel: ALIAS });
      assert.equal(refused.status, 409, `expected 409, got ${refused.status}: ${refused.text}`);
      assert.equal(refused.json.code, CODE);
      assert.match(refused.json.error, new RegExp(`'${ALIAS}'`));
      assert.equal(proxy.requests.length, 0, "refused before a single embed request was made");
      assert.equal(ledgerLines(), linesBefore);
      assert.equal(await k.client.countObjects(), n);

      // retrieve: 200, results, the degradation, the report
      const r = await k.retrieve({ embedUrl: proxy.url, embedModel: ALIAS });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.success, true);
      assert.ok(r.json.results.length > 0, "results are still returned");
      assert.ok(Array.isArray(r.json.degraded) && r.json.degraded.length >= 1, `degraded: ${JSON.stringify(r.json.degraded)}`);
      const d = r.json.degraded[0];
      assert.equal(d.stage, "embed");
      assert.equal(d.code, CODE);
      assert.match(d.message, new RegExp(`'${ALIAS}'`));
      assert.match(d.message, /same 4096 dimensions/);
      assert.match(d.message, /relevant passages may be missing/);
      assert.deepStrictEqual(r.json.report.embedSpace, { queryModel: ALIAS, queryDim: 4096, pinnedModel: cfg.embedModel, pinnedDim: 4096, pinSource: "file_indexed", verdict: "name_mismatch" });
      assert.equal(proxy.requests.length, 1, "exactly one embed request (the query)");
      assert.equal(proxy.requests[0].modelSeen, ALIAS);
      assert.equal(proxy.requests[0].forwardedAs, cfg.embedModel);
      // the same query under the real name is a match and not degraded
      const control = await k.retrieve();
      assert.equal(control.status, 200);
      assert.equal(control.json.degraded, undefined);
      assert.equal(control.json.report.embedSpace.verdict, "match");
      // and the retrieve route wrote nothing (D8)
      assert.equal(ledgerLines(), linesBefore, "retrieve never writes the ledger");

      // the chat path: the chip's data (retrieval.state / code) through /api/chat
      const chat = await postJson(`${cfg.appUrl}/api/chat`, {
        message: "Who is Graeme Hick?",
        history: [],
        adminConfig: {
          nimEndpoint: cfg.chatUrl,
          nimApiKey: cfg.token,
          nimModelName: cfg.chatModel,
          systemPrompt: "You are a helpful assistant.",
          temperature: 0,
          maxTokens: 256,
          weaviateUrl: cfg.weaviateUrl,
          weaviateCollection: k.base,
          mlisToken: cfg.token,
          embedApiKey: cfg.token,
          embedEndpoint: proxy.url,
          embedModelName: ALIAS,
          rerankEndpointUrl: "",
          rerankModelName: "",
          rerankApiKey: "",
          ragSettings: { weaviateCollection: k.base, schemaVersion: 2 },
          forcedCommand: "/doc",
        },
      }, 300000);
      assert.equal(chat.status, 200, chat.text?.slice(0, 300));
      assert.ok(chat.json.retrieval, "the typed retrieval outcome is on the response");
      assert.equal(chat.json.retrieval.state, "degraded", JSON.stringify(chat.json.retrieval));
      assert.equal(chat.json.retrieval.code, CODE);
      assert.ok(chat.json.retrieval.chunkCount > 0, "chunks reached the model");
      const ragTrace = (chat.json.traces || []).find((tr) => tr.category === "rag_pipeline");
      assert.ok(ragTrace, "the rag trace exists");
      assert.equal(ragTrace.badgeType, "amber");
      assert.match(String(ragTrace.badge), new RegExp(CODE));
      // The badge's wording is the orchestrator's one-size "(UNRANKED: <code>)"
      // — false for this code (the reranker did rank what came back; what the
      // wrong space costs is recall). T16's design §6 forbids orchestrator
      // changes, so it is FILED (F-73), not fixed, and stated here rather
      // than blessed silently (review).
      if (/UNRANKED/.test(String(ragTrace.badge))) t.diagnostic(`F-73 stands: the trace badge reads "${ragTrace.badge}" for a recall degradation`);
      assert.equal(proxy.requests.length, 2, "the chat turn embedded its query through the proxy");
      assert.equal(proxy.requests[1].modelSeen, ALIAS);
      t.diagnostic(`chat: retrieval ${JSON.stringify(chat.json.retrieval)}; badge ${ragTrace.badge}`);
    } finally {
      if (proxy) await proxy.stop().catch(() => {});
      await k.cleanup();
    }
  });
});

describe("I-PIN: the resets — Tidy Up and an out-of-band recreate (design D1 rules 1–2, F-71)", () => {
  test("reset by Tidy Up (v1 class): pinned, cleared (collection_cleared), then the alias is accepted and pins", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "tidy", { schemaVersion: 1 });
    const filePath = k.seed();
    let proxy = null;
    try {
      const a = await k.ingest("8b on a fresh v1 class", [filePath]);
      assert.equal(a.final.status, "completed", a.final.error || "");
      assertPinned(k.pin(), { embedModel: cfg.embedModel, embedDim: 4096 });
      proxy = await startEmbedProxy({ upstream: cfg.embedUrl, rewriteModel: { from: ALIAS, to: cfg.embedModel } });
      const refused = await k.post([filePath], { duplicatePolicy: "skip", embedUrl: proxy.url, embedModel: ALIAS });
      assert.equal(refused.status, 409, `a v1 class is pinned too: ${refused.text}`);

      // A v1 class, so the version is stated: since the cut-over `clear`
      // resolves the class from (name, version) and defaults to 2 (D2).
      const cleared = await postJson(`${cfg.appUrl}/api/ingest/clear`, { weaviateUrl: cfg.weaviateUrl, token: cfg.token, mlisToken: cfg.token, weaviateCollection: k.collection, schemaVersion: 1 }, 60000);
      assert.equal(cleared.status, 200, cleared.text);
      assert.equal(cleared.json.dropped, true);
      const after = k.pin();
      assert.equal(after.embedModel, null, "the pin is reset to nothing");
      assert.equal(after.enforceable, false);
      assert.equal(after.since?.event, "collection_cleared");
      assert.equal(await k.client.countObjects(), 0);

      const b = await k.ingest("alias after Tidy Up", [filePath], { embedUrl: proxy.url, embedModel: ALIAS });
      assert.equal(b.final.status, "completed", b.final.error || "");
      assert.equal(b.final.fileResults[0].status, "indexed");
      const pin = k.pin();
      assertPinned(pin, { embedModel: ALIAS, embedDim: 4096 });
      assert.equal(pin.pinnedBy, b.jobId);
      assert.equal(pin.since?.event, "collection_cleared", "clear recreated the class, so no second collection_created");
      assert.deepStrictEqual(pin.modelsSeen, [ALIAS]);
      // and the OLD name is now the wrong one
      const old = await k.post([filePath], { duplicatePolicy: "skip" });
      assert.equal(old.status, 409, old.text);
      assert.match(old.json.error, new RegExp(`'${ALIAS}'`));
    } finally {
      if (proxy) await proxy.stop().catch(() => {});
      await k.cleanup();
    }
  });

  test("reset by recreate: a direct schema DELETE behind the ledger's back, then the alias is accepted — collection_created again, since follows", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "recreate");
    const filePath = k.seed();
    let proxy = null;
    try {
      const a = await k.ingest("8b on a fresh class", [filePath]);
      assert.equal(a.final.status, "completed", a.final.error || "");
      const first = k.pin();
      assertPinned(first, { embedModel: cfg.embedModel, embedDim: 4096 });
      assert.equal(first.since?.event, "collection_created");
      const status = await k.dropSchema();
      assert.equal(status, 200, "the class is dropped behind the ledger's back (the harness's own move)");
      assert.equal(ledger.getCollectionPin(ledgerEvents(), { collection: k.collection }).enforceable, true, "the ledger still says pinned");

      proxy = await startEmbedProxy({ upstream: cfg.embedUrl, rewriteModel: { from: ALIAS, to: cfg.embedModel } });
      const b = await k.ingest("alias into the absent class", [filePath], { embedUrl: proxy.url, embedModel: ALIAS });
      assert.equal(b.final.status, "completed", `an absent class has nothing to protect: ${b.final.error || ""}`);
      assert.equal(b.final.fileResults[0].status, "indexed");
      const pin = k.pin();
      assertPinned(pin, { embedModel: ALIAS, embedDim: 4096 });
      assert.equal(pin.since?.event, "collection_created");
      assert.notEqual(pin.since.ts, first.since.ts, "the NEW creation");
      const created = ledgerEvents().filter((e) => e.collection === k.collection && e.event === "collection_created");
      assert.equal(created.length, 2);
      assert.equal(created[1].jobId, b.jobId);
      assert.equal(created[1].embedModel, ALIAS);
    } finally {
      if (proxy) await proxy.stop().catch(() => {});
      await k.cleanup();
    }
  });
});

describe("I-PIN: a provisional pin never refuses, a stale pin never locks (design D4, D5)", () => {
  test("a provisional pin never refuses (D5): a dead embedder on the first ingest records only the creation name; another name is then accepted and pins", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "provisional");
    const filePath = k.seed();
    let dead = null;
    let proxy = null;
    try {
      dead = await startEmbedProxy({ upstream: cfg.embedUrl, passCount: 0 });
      const failed = await k.ingest("dead embedder on a fresh class", [filePath], { embedUrl: dead.url });
      await dead.stop();
      dead = null;
      assert.equal(failed.final.status, "error", "nothing landed");
      assert.equal(failed.final.fileResults[0].status, "failed");
      assert.equal(failed.final.chunksIndexed, 0);
      assert.equal(await k.client.countObjects(), 0);
      const provisional = k.pin();
      assert.ok(provisional, "a pin object exists");
      assert.equal(provisional.embedModel, cfg.embedModel, "the creation name");
      assert.equal(provisional.enforceable, false, "no vector landed");
      assert.equal(provisional.embedDim, null);
      assert.equal(provisional.source, "collection_created");
      assert.equal(provisional.landedRecords, 0);
      const failedEvent = ledgerEvents().find((e) => e.jobId === failed.jobId && e.event === "file_failed");
      assert.ok(failedEvent, "the failure is recorded");
      assert.equal(failedEvent.counts.chunksInserted, 0);

      // the corrected retry names ANOTHER model — and is accepted
      proxy = await startEmbedProxy({ upstream: cfg.embedUrl, rewriteModel: { from: ALIAS, to: cfg.embedModel } });
      const b = await k.ingest("another name after a failed first ingest", [filePath], { embedUrl: proxy.url, embedModel: ALIAS });
      assert.equal(b.final.status, "completed", `a provisional pin must not refuse: ${b.final.error || ""}`);
      assert.equal(b.final.fileResults[0].status, "indexed");
      const pin = k.pin();
      assertPinned(pin, { embedModel: ALIAS, embedDim: 4096 });
      assert.deepStrictEqual(pin.modelsSeen, [ALIAS], "modelsSeen describes vectors IN the class — the provisional name never landed");
    } finally {
      if (dead) await dead.stop().catch(() => {});
      if (proxy) await proxy.stop().catch(() => {});
      await k.cleanup();
    }
  });

  test("a stale pin never locks (D4): the class rebuilt by hand at 2560 while the ledger says 4096 — the 2560-dim model is accepted and the next landed record re-pins", { skip: SKIP_ALT }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "stale");
    const filePath = k.seed();
    try {
      const a = await k.ingest("8b on a fresh class", [filePath]);
      assert.equal(a.final.status, "completed", a.final.error || "");
      assertPinned(k.pin(), { embedModel: cfg.embedModel, embedDim: 4096 });

      // rebuild the class by hand at 2560: drop, recreate (v2 shape), one object
      assert.equal(await k.dropSchema(), 200);
      await k.client.ensureSchema();
      const handId = crypto.randomUUID();
      const put = await fetch(`${cfg.weaviateUrl}/v1/objects`, {
        method: "POST",
        headers: k.headers,
        body: JSON.stringify({
          class: k.collection,
          id: handId,
          vector: Array.from({ length: 2560 }, (_, i) => (i % 7) / 10),
          properties: { text: "hand-written 2560-dim object", source: "hand", fileType: "txt", docHash: "hand", isVisualElement: false, metadata: "{}", sourceId: "hand", docVersion: "hand.000000000000", chunkIndex: 0, engine: "hand" },
        }),
        signal: AbortSignal.timeout(30000),
      });
      assert.ok(put.status === 200 || put.status === 201, `hand object: ${put.status} ${(await put.text()).slice(0, 200)}`);
      assert.equal(await k.client.getVectorDimension({ refresh: true }), 2560, "the store now says 2560");
      assert.equal(k.pin().embedDim, 4096, "the ledger still says 4096 — a stale pin");

      const b = await k.ingest("2560-dim model against the stale pin", [filePath], { embedUrl: ALT.url, embedModel: ALT.model, embedToken: ALT.token });
      assert.equal(b.final.status, "completed", `a stale pin must not lock: ${b.final.error || ""}`);
      assert.equal(b.final.fileResults[0].status, "indexed");
      const pin = k.pin();
      assertPinned(pin, { embedModel: ALT.model, embedDim: 2560 });
      assert.equal(pin.pinnedBy, b.jobId);
      assert.deepStrictEqual(pin.repinnedFrom?.embedModel, cfg.embedModel, "the move is disclosed");
      assert.equal(pin.repinnedFrom?.embedDim, 4096);
      assert.deepStrictEqual(pin.modelsSeen, [ALT.model]);
      // and now the OLD model is the wrong one, on the live dimension
      const old = await k.post([filePath], { duplicatePolicy: "skip" });
      assert.equal(old.status, 409, old.text);
      assert.match(old.json.error, /2560 dimensions/);
    } finally {
      await k.cleanup();
    }
  });
});
