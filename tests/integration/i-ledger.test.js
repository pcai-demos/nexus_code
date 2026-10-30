/**
 * I-LEDGER — ticket T07 (audit FM-L3 / E15 / E16; F-48, F-49, F-52, F-61,
 * F-63). The ledger and the per-file outcomes, live, against a real
 * embedder and a real Weaviate with failures injected by
 * tests/integration/_embed_proxy.js.
 *
 * Measured on `main` before T07 (t07-artifacts): a mid-file embedder outage
 * left 16 of 18 chunks that `skip` then froze; a cancel finished the job in
 * 111 ms, a second ingest was accepted 318 ms later, and 16 objects landed
 * after the cancel; a `.xyz` in the batch left one console line and
 * `filesCompleted 1` of `totalFiles 2`.
 *
 * Cases (each on its own fresh RAGEval_*V2 class, torn down by direct schema
 * DELETE — F-39):
 *   1. partial → recorded → repaired by a plain `skip`; the next skip skips
 *      with evidence; a store mismatch and an unload each re-index and say
 *      why (D4's negative paths); every input accounted for (E16, D5); a
 *      lost job is reconstructed from the ledger (D8)
 *   2. cancel mid-file: the lock holds (409 in the window), the status turns
 *      `cancelled` only after the store stopped moving, the record says what
 *      landed, and the next `skip` finishes the version (F-63, F-61, D7)
 *   3. a cancel that lands after the last batch: the whole version
 *      supersedes the old one (F-61's second variant, amendment D7b)
 *   4. a cancel during phase 1 stops the parse queue (F-52, D7)
 *   5. a refused supersede is recorded on the file, the job is `partial`,
 *      and the next `skip` repairs it (D6, amendment D4b)
 * About 12 minutes with the captioner warm (one FCA SYSC parse in case 2).
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { skipReason, envConfig, postJson, waitForIngestion, assertEvalCollection, makeRunCollection } = require("./_harness");
const { startEmbedProxy } = require("./_embed_proxy");
const { missingRegenerableFixture, absPath } = require("../unit/_helpers");
const { WeaviateClient } = require("../../src/lib/vectordb/weaviate");
const { sourceIdFor, chunkIdFor } = require("../../src/lib/rag/ids");
const ledger = require("../../src/lib/rag/ledger");

const FIXTURE_A = "tests/fixtures/golden/adversarial/duplicate_a/report.pdf"; // GraemeHick bytes, ~18 chunks
const FIXTURE_B = "tests/fixtures/golden/adversarial/duplicate_b/report.pdf"; // FCA SYSC bytes, ~89 chunks
const SKIP = skipReason() || missingRegenerableFixture(FIXTURE_A) || missingRegenerableFixture(FIXTURE_B);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The events the app's process wrote, read from the file the app writes (same container). */
function ledgerEvents() {
  return ledger.readEvents(ledger.defaultLedgerPath()).events;
}

async function statusFrame(appUrl, jobId) {
  const res = await fetch(`${appUrl}/api/ingest/status?jobId=${encodeURIComponent(jobId)}`, { signal: AbortSignal.timeout(10000) });
  if (res.status !== 200) return { httpStatus: res.status, body: await res.json().catch(() => null) };
  const reader = res.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(value || new Uint8Array());
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return line ? JSON.parse(line.slice(6)) : null;
}

function makeClass(t, cfg, suffix) {
  const base = makeRunCollection(suffix);
  const collection = `${base}V2`;
  assert.match(collection, new RegExp(`^RAGEval_[A-Za-z0-9_]+_${suffix}V2$`));
  const fixtureDir = path.join(REPO_ROOT, "public", "eval_fixtures", base);
  const headers = { "Content-Type": "application/json" };
  if (cfg.token) headers["x-auth-token"] = cfg.token;
  const client = new WeaviateClient(cfg.weaviateUrl, cfg.token, collection, { schemaVersion: 2 });
  const destructive = () => WeaviateClient.forDestructiveOps(cfg.weaviateUrl, cfg.token, collection, { schemaVersion: 2 });
  const payload = (filePaths, { duplicatePolicy = "skip", embedUrl = cfg.embedUrl, weaviateUrl = cfg.weaviateUrl, settings = {} } = {}) => ({
    filePaths,
    weaviateUrl,
    token: cfg.token,
    weaviateToken: cfg.token,
    embedUrl,
    embedModel: cfg.embedModel,
    weaviateCollection: base,
    ragSettings: { weaviateCollection: base, schemaVersion: 2, maxFileSize: 50, duplicatePolicy, ...settings },
  });
  async function start(label, filePaths, opts) {
    const started = await postJson(`${cfg.appUrl}/api/ingest`, payload(filePaths, opts));
    assert.equal(started.status, 202, `${label}: ingest not accepted: ${started.text}`);
    assert.ok(started.json?.jobId, `${label}: no jobId (F-18)`);
    return started.json.jobId;
  }
  async function ingest(label, filePaths, opts) {
    const t0 = Date.now();
    const jobId = await start(label, filePaths, opts);
    const final = await waitForIngestion(cfg.appUrl, jobId, 1500000);
    assert.equal(final.jobId, jobId);
    t.diagnostic(`${label}: ${final.status} ${final.errorCode || ""} in ${Date.now() - t0} ms — chunksIndexed ${final.chunksIndexed}, files ${final.filesCompleted}/${final.totalFiles}${final.error ? `; error: ${String(final.error).slice(0, 160)}` : ""}`);
    return { jobId, final };
  }
  async function byVersion() {
    const res = await fetch(`${cfg.weaviateUrl}/v1/graphql`, { method: "POST", headers, body: JSON.stringify({ query: `{ Aggregate { ${collection}(groupBy: ["docVersion"]) { groupedBy { value } meta { count } } } }` }), signal: AbortSignal.timeout(30000) });
    const body = await res.json();
    assert.ok(!body.errors, `groupBy failed: ${JSON.stringify(body.errors)}`);
    const out = {};
    for (const it of body.data.Aggregate[collection] || []) out[it.groupedBy.value] = it.meta.count;
    return out;
  }
  const cleanup = async () => {
    assertEvalCollection(collection);
    try {
      const c = await postJson(`${cfg.appUrl}/api/ingest/cancel`, {}, 15000);
      if (c.json?.cancelled) {
        t.diagnostic(`teardown: cancelling ${c.json.jobId}, waiting for the worker`);
        await waitForIngestion(cfg.appUrl, c.json.jobId, 180000).catch(() => {});
      }
    } catch (err) {
      console.warn(`[I-LEDGER teardown] cancel failed: ${err.message}`);
    }
    try {
      const res = await fetch(`${cfg.weaviateUrl}/v1/schema/${collection}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
      t.diagnostic(`teardown: DELETE /v1/schema/${collection} → ${res.status}`);
    } catch (err) {
      console.warn(`[I-LEDGER teardown] could not drop ${collection}: ${err.message}`);
    }
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  };
  const seed = (name, fixture) => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.copyFileSync(absPath(fixture), path.join(fixtureDir, name));
    return `eval_fixtures/${base}/${name}`;
  };
  return { base, collection, fixtureDir, headers, client, destructive, start, ingest, byVersion, cleanup, seed, filePathFor: (name) => `eval_fixtures/${base}/${name}` };
}

/** Poll a job's frames until the first inserted batch shows, then return that frame. */
async function untilFirstInsert(cfg, jobId) {
  const t0 = Date.now();
  let frame = null;
  while (Date.now() - t0 < 1500000) {
    frame = await statusFrame(cfg.appUrl, jobId);
    assert.ok(frame && frame.status === "processing", `the job finished before the cancel: ${JSON.stringify(frame).slice(0, 200)}`);
    if (frame.chunksIndexed > 0) return frame;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("never saw an inserted batch");
}

describe("I-LEDGER: a partial document is recorded and repaired; the skip believes the ledger AND the store (F-48, design D4 / D5 / D6 / D8)", () => {
  test("mid-file embedder outage → partial, recorded; a plain skip re-index completes it; the next skip skips with evidence; store mismatch and unload re-index; every input accounted for; a lost job is reconstructed", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "ledger");
    const filePath = k.seed("report.pdf", FIXTURE_A);
    const sourceId = sourceIdFor(filePath);
    let proxy = null;
    try {
      // 1. the outage: request 1 forwarded (16 chunks), request 2 refused
      proxy = await startEmbedProxy({ upstream: cfg.embedUrl, passCount: 1 });
      const failed = await k.ingest("outage", [filePath], { duplicatePolicy: "overwrite", embedUrl: proxy.url });
      await proxy.stop();
      t.diagnostic(`proxy saw ${JSON.stringify(proxy.requests.map((r) => [r.n, r.inputs, r.action, r.status]))}`);
      assert.equal(failed.final.status, "partial", "a file with chunks in the store is a partial job, not an error");
      assert.equal(failed.final.errorCode, "INGEST_PARTIAL");
      assert.match(String(failed.final.error), /report\.pdf partial \(16\/\d+ chunks\)/);
      assert.match(String(failed.final.error), /simulated embedder outage/, "the embedder's own words are in the job error");
      assert.equal(failed.final.filesCompleted, 1, "a partial file is a terminal, counted outcome");
      const fr = failed.final.fileResults?.[0];
      assert.ok(fr, "fileResults on the frame");
      assert.equal(fr.status, "partial");
      assert.equal(fr.counts.chunksInserted, 16);
      assert.ok(fr.counts.chunksEmitted > 16, `chunksEmitted ${fr.counts.chunksEmitted}`);
      assert.equal(fr.sourceId, sourceId);
      assert.match(fr.docVersion, /^[0-9a-f]{32}\.[0-9a-f]{12}$/);
      assert.match(String(fr.error), /simulated embedder outage/);
      assert.equal(fr.engine, "pypdfium2");
      assert.equal(await k.client.countObjects(), 16, "the store holds what landed");
      const docVersion = fr.docVersion;
      const outcome = ledger.latestFileOutcome(ledgerEvents(), { collection: k.collection, sourceId, docVersion });
      assert.ok(outcome, "the ledger has a record");
      assert.equal(outcome.event, "file_failed");
      assert.equal(outcome.status, "partial");
      assert.equal(outcome.chunksInserted, 16);
      assert.equal(outcome.chunksEmitted, fr.counts.chunksEmitted);
      assert.equal(ledger.isRecordedComplete(outcome), false);
      const jobEvents = ledgerEvents().filter((e) => e.jobId === failed.jobId).map((e) => e.event);
      assert.deepStrictEqual(jobEvents, ["ingest_start", "collection_created", "file_parsed", "file_failed", "ingest_end"], "every event of the job, in order (a fresh class was created)");
      const startEvent = ledgerEvents().find((e) => e.jobId === failed.jobId && e.event === "ingest_start");
      assert.equal(startEvent.embedHost, proxy.origin + "/v1", "the embed endpoint is recorded as origin + path");
      assert.ok(!("embedUrl" in startEvent), "never the raw URL");
      const end = ledgerEvents().find((e) => e.jobId === failed.jobId && e.event === "ingest_end");
      assert.equal(end.status, "partial");
      assert.equal(end.files.partial, 1);
      assert.equal(end.chunks.inserted, 16);
      const parsed = ledgerEvents().find((e) => e.jobId === failed.jobId && e.event === "file_parsed");
      assert.equal(parsed.counts.chunksEmitted, fr.counts.chunksEmitted);
      assert.ok(Number.isFinite(parsed.counts.pages) && parsed.counts.pages > 0, "page count recorded");
      assert.equal(parsed.engine, "pypdfium2");
      assert.equal(typeof parsed.paginated, "boolean");

      // 2. a plain skip re-ingest REPAIRS it (before T07 it froze it)
      const repaired = await k.ingest("skip after partial", [filePath], { duplicatePolicy: "skip" });
      assert.equal(repaired.final.status, "completed", repaired.final.error || "");
      assert.ok(repaired.final.chunksIndexed > 16, "re-indexed, not skipped");
      const fr2 = repaired.final.fileResults[0];
      assert.equal(fr2.status, "indexed");
      assert.equal(fr2.reindexReason, "partial_record", "the outcome says why it was not skipped");
      assert.equal(fr2.counts.chunksInserted, fr2.counts.chunksEmitted);
      assert.equal(typeof fr2.superseded, "number", "the supersede ran (matches reported)");
      const n = fr2.counts.chunksInserted;
      assert.equal(await k.client.countObjects(), n, "objects === chunksIndexed after the repair");
      const complete = ledger.latestFileOutcome(ledgerEvents(), { collection: k.collection, sourceId, docVersion });
      assert.equal(complete.event, "file_indexed");
      assert.equal(complete.status, "complete");
      assert.equal(complete.chunksInserted, n);
      assert.ok(ledger.isRecordedComplete(complete));
      const indexed = ledgerEvents().find((e) => e.jobId === repaired.jobId && e.event === "file_indexed");
      assert.equal(indexed.embedDim, 4096, "the measured embedding dimension is recorded");
      assert.equal(indexed.embedModel, cfg.embedModel);
      assert.deepStrictEqual(await k.destructive().countIdentity(sourceId, docVersion), { count: n, maxChunkIndex: n - 1 }, "count n and highest index n-1: exactly 0..n-1");

      // 3. the next skip skips, with the evidence on the outcome
      const skipped = await k.ingest("skip when complete", [filePath], { duplicatePolicy: "skip" });
      assert.equal(skipped.final.status, "completed");
      assert.equal(skipped.final.chunksIndexed, 0);
      const fr3 = skipped.final.fileResults[0];
      assert.equal(fr3.status, "skipped");
      assert.equal(fr3.reason, "already_indexed");
      assert.equal(fr3.evidence.recorded, n);
      assert.equal(fr3.evidence.storeCount, n);
      assert.equal(fr3.evidence.storeMaxChunkIndex, n - 1);
      assert.equal(fr3.superseded, 0, "nothing else at the sourceId to remove");
      assert.equal(await k.client.countObjects(), n);
      const skipEvent = ledgerEvents().find((e) => e.jobId === skipped.jobId && e.event === "file_skipped");
      assert.equal(skipEvent.reason, "already_indexed");
      assert.equal(skipEvent.evidence.recorded, n);

      // 4. D4's negative path, the store side: one object gone behind the
      //    ledger's back → the record still says complete, the store does
      //    not agree → re-index with the reason (a presence-only or a
      //    record-only skip would have frozen the hole).
      const lastId = chunkIdFor(sourceId, docVersion, n - 1);
      const del = await fetch(`${cfg.weaviateUrl}/v1/objects/${k.collection}/${lastId}`, { method: "DELETE", headers: k.headers, signal: AbortSignal.timeout(15000) });
      assert.ok(del.status === 204 || del.status === 200, `object delete: ${del.status}`);
      await new Promise((r) => setTimeout(r, 1000));
      assert.equal(await k.client.countObjects(), n - 1);
      const mismatch = await k.ingest("skip after a store mismatch", [filePath], { duplicatePolicy: "skip" });
      assert.equal(mismatch.final.status, "completed", mismatch.final.error || "");
      const fr4 = mismatch.final.fileResults[0];
      assert.equal(fr4.status, "indexed");
      assert.equal(fr4.reindexReason, "store_mismatch");
      assert.equal(fr4.evidence, null);
      const reindexed = ledgerEvents().find((e) => e.jobId === mismatch.jobId && e.event === "file_indexed");
      assert.equal(reindexed.reindexReason, "store_mismatch");
      assert.equal(await k.client.countObjects(), fr4.counts.chunksInserted, "whole again");
      const n4 = fr4.counts.chunksInserted;

      // 5. D4's negative path, the record side: an unload invalidates the
      //    completion record (D11's file_unloaded), so the next skip
      //    re-indexes with `record_invalidated` even though the identity
      //    would otherwise be trusted.
      const unloaded = await postJson(`${cfg.appUrl}/api/ingest/unload`, { sourceId, weaviateUrl: cfg.weaviateUrl, token: cfg.token, weaviateCollection: k.base, ragSettings: { schemaVersion: 2 } }, 60000);
      assert.equal(unloaded.status, 200, unloaded.text);
      assert.equal(unloaded.json.deleted, n4);
      assert.equal(await k.client.countObjects(), 0);
      const unloadEvent = ledgerEvents().filter((e) => e.event === "file_unloaded" && e.collection === k.collection && e.sourceId === sourceId).pop();
      assert.ok(unloadEvent, "file_unloaded recorded");
      assert.equal(unloadEvent.matches, n4);
      assert.equal(unloadEvent.schemaVersion, 2);
      const invalidated = ledger.latestFileOutcome(ledgerEvents(), { collection: k.collection, sourceId, docVersion });
      assert.equal(invalidated.invalidatedBy, "file_unloaded");
      assert.equal(ledger.isRecordedComplete(invalidated), false);
      const afterUnload = await k.ingest("skip after an unload", [filePath], { duplicatePolicy: "skip" });
      assert.equal(afterUnload.final.status, "completed", afterUnload.final.error || "");
      assert.equal(afterUnload.final.fileResults[0].status, "indexed");
      assert.equal(afterUnload.final.fileResults[0].reindexReason, "record_invalidated");
      const n5 = afterUnload.final.fileResults[0].counts.chunksInserted;
      assert.equal(await k.client.countObjects(), n5);

      // 6. every input accounted for (E16 / D5): an already-indexed file, a
      //    disallowed extension and a file that does not exist — three
      //    outcomes, three reasons, filesCompleted === totalFiles, and a
      //    `partial` job because one failed.
      fs.writeFileSync(path.join(k.fixtureDir, "notes.xyz"), "not an allowed type\n");
      const mixed = await k.ingest("mixed batch", [filePath, k.filePathFor("notes.xyz"), k.filePathFor("missing.pdf")], { duplicatePolicy: "skip" });
      assert.equal(mixed.final.totalFiles, 3);
      assert.equal(mixed.final.filesCompleted, 3, "E16: every input reaches a terminal status");
      assert.equal(mixed.final.status, "partial");
      const statuses = mixed.final.fileResults.map((f) => [f.fileName, f.status, f.reason]);
      assert.deepStrictEqual(statuses[0], ["report.pdf", "skipped", "already_indexed"]);
      assert.deepStrictEqual(statuses[1], ["notes.xyz", "skipped", "not_allowed_type"]);
      assert.deepStrictEqual(statuses[2].slice(0, 2), ["missing.pdf", "failed"]);
      assert.match(String(mixed.final.fileResults[2].error), /does not exist on disk/);
      assert.match(String(mixed.final.error), /2 of 3 file\(s\) indexed or skipped; missing\.pdf failed/);
      assert.equal(await k.client.countObjects(), n5, "nothing changed in the store");
      const mixedEvents = ledgerEvents().filter((e) => e.jobId === mixed.jobId).map((e) => `${e.event}:${e.reason || e.status || ""}`);
      assert.deepStrictEqual(mixedEvents, ["ingest_start:", "file_superseded:", "file_skipped:already_indexed", "file_skipped:not_allowed_type", "file_failed:failed before indexing", "ingest_end:partial"]);

      // 7. reconstruction (D8): evict the outage job from memory with ten cheap
      //    skips, then ask the status route for it — answered from the ledger.
      let lastEvict = null;
      for (let i = 0; i < 10; i++) lastEvict = await k.ingest(`evict ${i + 1}`, [filePath], { duplicatePolicy: "skip" });
      // The registry retains the last ten jobs: the ten skips above are the
      // retained ones (served from memory); every job before them is evicted.
      const inMemory = await statusFrame(cfg.appUrl, lastEvict.jobId);
      assert.ok(inMemory && !inMemory.reconstructed, "a retained job is served from memory");
      const evictedMixed = await statusFrame(cfg.appUrl, mixed.jobId);
      assert.equal(evictedMixed.reconstructed, true, "the eleventh-newest job is evicted and reconstructed");
      assert.equal(evictedMixed.status, "partial");
      assert.equal(evictedMixed.filesCompleted, 3);
      const gone = await statusFrame(cfg.appUrl, failed.jobId);
      assert.ok(gone && gone.reconstructed === true, `expected a reconstructed frame, got ${JSON.stringify(gone).slice(0, 300)}`);
      assert.equal(gone.status, "partial");
      assert.equal(gone.chunksIndexed, 16);
      assert.equal(gone.fileResults[0].status, "partial");
      assert.equal(gone.fileResults[0].counts.chunksInserted, 16);
      assert.equal(gone.ledger.exists, true);
      assert.ok(gone.ledger.events > 0);
      assert.ok(!path.isAbsolute(gone.ledger.path), "the frame carries a relative path");
      const unknown = await statusFrame(cfg.appUrl, "00000000-0000-0000-0000-00000000dead");
      assert.equal(unknown.httpStatus, 404, "an id the ledger never saw stays 404");
      assert.equal(unknown.body.code, "JOB_NOT_FOUND");
    } finally {
      if (proxy) await proxy.stop().catch(() => {});
      await k.cleanup();
    }
  });
});

describe("I-LEDGER: a cancel is not a stop, and the worker owns the terminal status (F-63, F-61, design D7)", () => {
  test("re-ingest inside the window is 409; status turns cancelled only after the store stopped moving; the next skip finishes the version", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "cancel");
    const filePath = k.seed("report.pdf", FIXTURE_A);
    const sourceId = sourceIdFor(filePath);
    let proxy = null;
    try {
      const a = await k.ingest("A", [filePath], { duplicatePolicy: "skip" });
      assert.equal(a.final.status, "completed");
      const vA = a.final.fileResults[0].docVersion;
      const nA = a.final.chunksIndexed;

      // B at the same path through the pass-through proxy (16 per batch, one in flight)
      k.seed("report.pdf", FIXTURE_B);
      proxy = await startEmbedProxy({ upstream: cfg.embedUrl, passCount: -1 });
      const jobId = await k.start("B via pass-through proxy", [filePath], { duplicatePolicy: "skip", embedUrl: proxy.url });
      const t0 = Date.now();
      const frame = await untilFirstInsert(cfg, jobId);
      assert.equal(frame.fileResults[0].status, "indexing");

      const tCancel = Date.now();
      const cancel = await postJson(`${cfg.appUrl}/api/ingest/cancel`, { jobId }, 15000);
      assert.equal(cancel.status, 200);
      assert.equal(cancel.json.cancelled, true);
      assert.equal(cancel.json.status, "cancelling", "the route only asks");
      const after = await statusFrame(cfg.appUrl, jobId);
      assert.equal(after.status, "processing", "the job is still processing until the worker has stopped");
      assert.equal(after.cancelled, true, "and says it is cancelling");

      // F-63: a second ingest of the same file inside the window is REFUSED
      const inWindow = await postJson(`${cfg.appUrl}/api/ingest`, { filePaths: [filePath], weaviateUrl: cfg.weaviateUrl, token: cfg.token, weaviateToken: cfg.token, embedUrl: cfg.embedUrl, embedModel: cfg.embedModel, weaviateCollection: k.base, ragSettings: { weaviateCollection: k.base, schemaVersion: 2, duplicatePolicy: "skip" } });
      assert.equal(inWindow.status, 409, `a re-ingest inside the cancel window must be refused: ${inWindow.text}`);
      assert.equal(inWindow.json.code, "INGEST_IN_PROGRESS");
      assert.equal(inWindow.json.activeJobId, jobId);
      assert.match(inWindow.json.error, /cancelling/);

      const final = await waitForIngestion(cfg.appUrl, jobId, 180000);
      const tTerminal = Date.now();
      assert.equal(final.status, "cancelled");
      const countAtTerminal = await k.client.countObjects();
      await new Promise((r) => setTimeout(r, 5000));
      const countLater = await k.client.countObjects();
      assert.equal(countLater, countAtTerminal, "nothing landed after the status turned cancelled — the worker waited for its batch");
      const frB = final.fileResults[0];
      // The window was real: the batch in flight at the cancel landed and was
      // counted (D7 — awaited, never discarded, never pretended away).
      assert.ok(frB.counts.chunksInserted > frame.chunksIndexed, `the count grew after the cancel (${frame.chunksIndexed} → ${frB.counts.chunksInserted})`);
      const straddling = proxy.requests.filter((r) => r.action === "forward" && Date.parse(r.at) < tCancel && r.done && Date.parse(r.done) > tCancel);
      assert.ok(straddling.length >= 1, `an embed request must have been in flight at the cancel: ${JSON.stringify(proxy.requests)}`);
      t.diagnostic(`cancel at +${tCancel - t0} ms, terminal at +${tTerminal - t0} ms; requests straddling the cancel: ${straddling.length}; store ${countAtTerminal}`);
      assert.equal(frB.status, "partial", "under the 16-per-batch shape the cancel lands mid-file");
      assert.match(frB.reason, /cancelled at \d+\/\d+ chunks/);
      assert.ok(frB.counts.chunksInserted < frB.counts.chunksEmitted);
      const versions = await k.byVersion();
      const vB = Object.keys(versions).find((v) => v !== vA);
      assert.ok(vB, "B's version is in the store");
      assert.equal(versions[vA], nA, "A is untouched by a cancelled ingest");
      assert.equal(versions[vB], frB.counts.chunksInserted, "the record says exactly what landed");
      const rec = ledger.latestFileOutcome(ledgerEvents(), { collection: k.collection, sourceId, docVersion: vB });
      assert.equal(rec.status, "partial");
      assert.equal(rec.chunksInserted, frB.counts.chunksInserted);
      const end = ledgerEvents().find((e) => e.jobId === jobId && e.event === "ingest_end");
      assert.equal(end.status, "cancelled");
      await proxy.stop();
      proxy = null;

      // F-61: the next plain skip finishes B and supersedes A
      const next = await k.ingest("skip after cancel", [filePath], { duplicatePolicy: "skip" });
      assert.equal(next.final.status, "completed", next.final.error || "");
      const fr = next.final.fileResults[0];
      assert.equal(fr.status, "indexed");
      assert.equal(fr.reindexReason, "partial_record");
      assert.equal(fr.superseded, nA, "A's chunks were superseded by the completed B");
      const finalVersions = await k.byVersion();
      assert.deepStrictEqual(Object.keys(finalVersions), [vB], "one version remains");
      assert.equal(finalVersions[vB], fr.counts.chunksEmitted, "and it is the whole version");
      assert.equal(await k.client.countObjects(), finalVersions[vB]);
      const complete = ledger.latestFileOutcome(ledgerEvents(), { collection: k.collection, sourceId, docVersion: vB });
      assert.ok(ledger.isRecordedComplete(complete));
      assert.equal(complete.chunksInserted, finalVersions[vB]);
    } finally {
      if (proxy) await proxy.stop().catch(() => {});
      await k.cleanup();
    }
  });

  test("a cancel that lands after the last batch: the whole version supersedes the old one (F-61's second variant, amendment D7b)", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "cancelwhole");
    const filePath = k.seed("report.pdf", FIXTURE_A);
    const sourceId = sourceIdFor(filePath);
    let proxy = null;
    try {
      const a = await k.ingest("A", [filePath], { duplicatePolicy: "skip" });
      assert.equal(a.final.status, "completed");
      const vA = a.final.fileResults[0].docVersion;
      const nA = a.final.chunksIndexed;
      // The same bytes with a changed setting: a new docVersion at the same
      // sourceId (T05 D1), same ~18 chunks — two batches of 16 + 2 under the
      // proxy's shape. The proxy holds the SECOND embed request for eight
      // seconds, so the cancel is sent while the last batch is in flight
      // (without the hold a two-chunk batch finishes before a poll can see
      // it — measured). The batch lands, the insert is complete, and T06's
      // old "not cancelled" clause would have left two whole versions.
      proxy = await startEmbedProxy({ upstream: cfg.embedUrl, passCount: -1, delayMs: 8000, delayFrom: 2 });
      const jobId = await k.start("A again, changed setting, via the delayed proxy", [filePath], { duplicatePolicy: "skip", embedUrl: proxy.url, settings: { minChunkSize: 51 } });
      const frame = await untilFirstInsert(cfg, jobId);
      assert.equal(frame.chunksIndexed, 16, "the first batch landed and the second is being held");
      const cancel = await postJson(`${cfg.appUrl}/api/ingest/cancel`, { jobId }, 15000);
      assert.equal(cancel.status, 200);
      assert.equal(cancel.json.cancelled, true, "the cancel was requested while the last batch was in flight");
      const final = await waitForIngestion(cfg.appUrl, jobId, 180000);
      t.diagnostic(`cancel answered ${JSON.stringify(cancel.json)}; job ended ${final.status}; proxy ${JSON.stringify(proxy.requests.map((r) => [r.n, r.inputs, r.action, r.delayedMs || 0]))}`);
      assert.equal(final.status, "cancelled", "the worker saw the cancel");
      const fr = final.fileResults[0];
      assert.ok(fr.counts.chunksInserted > 0, `the changed setting must produce a new docVersion, not a skip (${fr.status}: ${fr.reason || ""})`);
      assert.equal(fr.status, "indexed", "every chunk landed, so the file is whole");
      assert.equal(fr.counts.chunksInserted, fr.counts.chunksEmitted);
      assert.notEqual(fr.docVersion, vA, "a new version");
      assert.equal(fr.superseded, nA, "and it superseded the old one — no second complete version stands");
      const versions = await k.byVersion();
      assert.deepStrictEqual(Object.keys(versions), [fr.docVersion], "one version remains");
      assert.equal(versions[fr.docVersion], fr.counts.chunksInserted);
      const sup = ledgerEvents().find((e) => e.jobId === jobId && e.event === "file_superseded");
      assert.equal(sup.ok, true);
      assert.equal(sup.matches, nA);
    } finally {
      if (proxy) await proxy.stop().catch(() => {});
      await k.cleanup();
    }
  });

  test("a cancel during phase 1 stops the parse queue: nothing is indexed and every file says why (F-52)", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "cancelparse");
    const one = k.seed("report.pdf", FIXTURE_A);
    const two = k.seed("report2.pdf", FIXTURE_A);
    try {
      const jobId = await k.start("two files", [one, two], { duplicatePolicy: "skip" });
      const cancel = await postJson(`${cfg.appUrl}/api/ingest/cancel`, { jobId }, 15000);
      assert.equal(cancel.json.cancelled, true);
      assert.equal(cancel.json.status, "cancelling");
      const final = await waitForIngestion(cfg.appUrl, jobId, 300000);
      assert.equal(final.status, "cancelled");
      assert.equal(final.chunksIndexed, 0, "nothing was embedded or inserted");
      assert.equal(final.filesCompleted, 2, "both files reached a terminal status");
      const [f1, f2] = final.fileResults;
      assert.equal(f1.status, "cancelled");
      assert.equal(f2.status, "cancelled");
      // Where the cancel lands decides the wording: a file mid-parse finishes
      // parsing and is then "parsed but not indexed"; a file not yet started
      // is "cancelled before parsing". Both files must carry one of the two.
      const skips = ledgerEvents().filter((e) => e.jobId === jobId && e.event === "file_skipped");
      assert.equal(skips.length, 2, "one file_skipped per file");
      for (const e of skips) {
        assert.equal(e.reason, "cancelled");
        assert.ok(["parsed but not indexed", "cancelled before parsing"].includes(e.detail), e.detail);
      }
      t.diagnostic(`cancel landed: ${skips.map((e) => `${e.fileName} ${e.detail}`).join("; ")}`);
      assert.equal(ledgerEvents().filter((e) => e.jobId === jobId && e.event === "file_indexed").length, 0, "nothing indexed");
      assert.equal(await k.client.countObjects(), 0);
      const end = ledgerEvents().find((e) => e.jobId === jobId && e.event === "ingest_end");
      assert.equal(end.status, "cancelled");
      assert.equal(end.files.cancelled, 2);
    } finally {
      await k.cleanup();
    }
  });
});

describe("I-LEDGER: a refused supersede is disclosed, and the next skip repairs it (design D6, amendment D4b)", () => {
  test("a refused supersede is recorded on the file and the job is partial; the next skip repairs it", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const k = makeClass(t, cfg, "refused");
    const filePath = k.seed("report.pdf", FIXTURE_A);
    const sourceId = sourceIdFor(filePath);
    let weaviateProxy = null;
    try {
      const a = await k.ingest("A", [filePath], { duplicatePolicy: "skip" });
      assert.equal(a.final.status, "completed");
      const vA = a.final.fileResults[0].docVersion;
      const nA = a.final.chunksIndexed;

      // The same bytes with a changed setting (a new docVersion), with
      // Weaviate fronted by a proxy that refuses only the batch DELETE: the
      // insert lands, the supersede is refused.
      weaviateProxy = await startEmbedProxy({ upstream: cfg.weaviateUrl, failWhen: (req) => req.method === "DELETE" && String(req.url).startsWith("/v1/batch/objects") });
      const refused = await k.ingest("changed setting, supersede refused", [filePath], { duplicatePolicy: "skip", weaviateUrl: weaviateProxy.origin, settings: { minChunkSize: 52 } });
      await weaviateProxy.stop();
      weaviateProxy = null;
      assert.equal(refused.final.status, "partial", "the file is indexed but its previous version could not be removed");
      assert.equal(refused.final.errorCode, "INGEST_PARTIAL");
      const fr = refused.final.fileResults[0];
      assert.equal(fr.status, "indexed");
      assert.ok(fr.counts.chunksInserted > 0 && fr.counts.chunksInserted === fr.counts.chunksEmitted);
      assert.notEqual(fr.docVersion, vA);
      assert.match(String(fr.supersedeError), /The new version of report\.pdf is indexed in .* but its previous version\(s\) could not be removed \(HTTP 503/, "T06 D3's wording, on the file");
      assert.match(String(refused.final.error), /previous versions not removed/);
      const sup = ledgerEvents().find((e) => e.jobId === refused.jobId && e.event === "file_superseded");
      assert.equal(sup.ok, false);
      assert.match(String(sup.error), /HTTP 503/);
      assert.equal(sup.error.length <= 2100, true, "bounded");
      const versions = await k.byVersion();
      assert.equal(versions[vA], nA, "the old version still stands");
      assert.equal(versions[fr.docVersion], fr.counts.chunksInserted, "beside the new one");
      const complete = ledger.latestFileOutcome(ledgerEvents(), { collection: k.collection, sourceId, docVersion: fr.docVersion });
      assert.ok(ledger.isRecordedComplete(complete), "the new version is recorded complete");

      // The next plain skip: the version is complete and the store agrees, so
      // it is skipped — and the repair removes the old version (D4b).
      const repaired = await k.ingest("skip repairs", [filePath], { duplicatePolicy: "skip", settings: { minChunkSize: 52 } });
      assert.equal(repaired.final.status, "completed", repaired.final.error || "");
      const fr2 = repaired.final.fileResults[0];
      assert.equal(fr2.status, "skipped");
      assert.equal(fr2.reason, "already_indexed");
      assert.equal(fr2.superseded, nA, "the old version was removed on the skipped branch");
      assert.equal(fr2.supersedeError, null);
      const onSkip = ledgerEvents().find((e) => e.jobId === repaired.jobId && e.event === "file_superseded");
      assert.equal(onSkip.ok, true);
      assert.equal(onSkip.onSkip, true);
      assert.equal(onSkip.matches, nA);
      const finalVersions = await k.byVersion();
      assert.deepStrictEqual(Object.keys(finalVersions), [fr.docVersion], "one version remains");
      assert.equal(await k.client.countObjects(), fr.counts.chunksInserted);
    } finally {
      if (weaviateProxy) await weaviateProxy.stop().catch(() => {});
      await k.cleanup();
    }
  });
});
