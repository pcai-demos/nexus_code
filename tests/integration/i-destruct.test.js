/**
 * I-DESTRUCT — the destructive routes refuse to default, live (ticket T21,
 * finding F-15). The live half of U-DESTRUCT.
 *
 * SAFETY, read before editing:
 *   - No case ever sends a real Weaviate URL together with a missing or
 *     `RAGChunk` collection. The "no collection" cases use a dead port, where
 *     the app must refuse BEFORE constructing anything (the pre-T21 route
 *     reached the dead port having already logged "Purging collection class
 *     'RAGChunk'").
 *   - The only class this suite creates or drops is its own
 *     `RAGEval_t21_<runId>`, guarded by assertEvalCollection.
 *   - The populated eval collection (RAG_EVAL_COLLECTION) and `RAGChunk` are
 *     COUNTED (read-only) before and after, and the counts must be unchanged.
 *     `RAGChunk` being 0 is the expected steady state, not a finding; the
 *     assertion is "unchanged", not "zero".
 *   - `/api/ingest/clear` also purges public/extracted_images regardless of
 *     collection (pre-existing, collection-agnostic — filed as a follow-up).
 *     In the pod those crops are baked into the image and return on the next
 *     roll.
 *
 * Teardown drops the throwaway by a direct schema DELETE, because the clear
 * route recreates an empty class and would leave one behind.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");

const { envConfig, skipReason, assertEvalCollection, postJson } = require("./_harness");

const config = envConfig();
const baseSkip = skipReason();
const SKIP =
  baseSkip ||
  (process.env.RAG_EVAL_COLLECTION
    ? false
    : "set RAG_EVAL_COLLECTION to a populated RAGEval_* collection (see I-INGEST)");

const evalCollection = process.env.RAG_EVAL_COLLECTION
  ? assertEvalCollection(process.env.RAG_EVAL_COLLECTION)
  : null;

/** Connection-refused in one hop. */
const DEAD_PORT = "http://127.0.0.1:9";
/** A real corpus file under public/, so unload gets past its file check. */
const CORPUS_FILE = "demos/demo_files/ext_reg_docs/GraemeHick.pdf";

// Built so it matches the teardown's own regex (makeRunCollection puts the
// suffix LAST, which the first version of this suite got wrong — the teardown
// could never have matched, and the class would have leaked, green).
const throwaway = config
  ? assertEvalCollection(`RAGEval_t21_${Date.now().toString(36)}_${process.pid}`)
  : null;

function weaviateHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  return headers;
}

/** Read-only Aggregate count. Null when the class does not exist. */
async function countClass(name) {
  const res = await fetch(`${config.weaviateUrl}/v1/graphql`, {
    method: "POST",
    headers: weaviateHeaders(),
    body: JSON.stringify({ query: `{ Aggregate { ${name} { meta { count } } } }` }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`count of ${name} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (Array.isArray(json.errors) && json.errors.length > 0) return null;
  const count = json?.data?.Aggregate?.[name]?.[0]?.meta?.count;
  if (typeof count !== "number") throw new Error(`count of ${name}: no meta.count in ${JSON.stringify(json).slice(0, 200)}`);
  return count;
}

async function classExists(name) {
  const res = await fetch(`${config.weaviateUrl}/v1/schema/${name}`, {
    headers: weaviateHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  return res.status === 200;
}

/** The only drop that is not through the app: guarded, throwaway only. */
async function dropThrowaway(name) {
  assertEvalCollection(name);
  assert.match(name, /^RAGEval_t21_/, "teardown may only drop this suite's own class");
  await fetch(`${config.weaviateUrl}/v1/schema/${name}`, {
    method: "DELETE",
    headers: weaviateHeaders(),
    signal: AbortSignal.timeout(15000),
  });
}

const counts = { before: {}, after: {} };
/** How many clears actually ran — the final "untouched" test is vacuous without one. */
let clearsRun = 0;

if (config && evalCollection) {
  before(async () => {
    counts.before.eval = await countClass(evalCollection);
    counts.before.production = await countClass("RAGChunk");
  });

  after(async () => {
    try {
      if (await classExists(throwaway)) await dropThrowaway(throwaway);
    } catch (err) {
      console.warn(`[I-DESTRUCT teardown] could not drop ${throwaway}: ${err.message}`);
    }
  });
}

function clearBody(overrides = {}) {
  return {
    weaviateUrl: config.weaviateUrl,
    token: config.token,
    mlisToken: config.token,
    weaviateCollection: throwaway,
    // The throwaway is a v1 class and these cases assert on its unsuffixed
    // name; since the cut-over clear / preview / unload resolve the class from
    // (name, version) with a v2 default, so the version is stated (D2, D12).
    schemaVersion: 1,
    ...overrides,
  };
}

describe("I-DESTRUCT: nothing is targeted by default (dead port — the app must refuse first)", () => {
  const deadBase = { weaviateUrl: DEAD_PORT, token: "x", mlisToken: "x" };

  for (const route of ["/api/ingest/clear", "/api/ingest/clear/preview"]) {
    test(`${route} without a collection → 400 COLLECTION_REQUIRED`, { skip: SKIP }, async () => {
      const r = await postJson(`${config.appUrl}${route}`, deadBase, 20000);
      assert.strictEqual(r.status, 400, r.text);
      assert.strictEqual(r.json?.success, false);
      assert.strictEqual(r.json?.code, "COLLECTION_REQUIRED");
    });
  }

  test("/api/ingest/unload without a collection → 400 COLLECTION_REQUIRED", { skip: SKIP }, async () => {
    const r = await postJson(`${config.appUrl}/api/ingest/unload`, { ...deadBase, filePath: CORPUS_FILE }, 20000);
    assert.strictEqual(r.status, 400, r.text);
    assert.strictEqual(r.json?.code, "COLLECTION_REQUIRED");
  });

  test("a non-exact name is refused too (explicit means exact)", { skip: SKIP }, async () => {
    const r = await postJson(`${config.appUrl}/api/ingest/clear`, { ...deadBase, weaviateCollection: " RAGEval_x" }, 20000);
    assert.strictEqual(r.status, 400, r.text);
    assert.strictEqual(r.json?.code, "COLLECTION_REQUIRED");
  });

  test("the previously untyped 400 (no weaviateUrl) is typed now", { skip: SKIP }, async () => {
    const r = await postJson(`${config.appUrl}/api/ingest/clear`, { token: "x", weaviateCollection: "RAGEval_x" }, 20000);
    assert.strictEqual(r.status, 400, r.text);
    assert.strictEqual(r.json?.code, "INGEST_CONFIG_MISSING");
  });

  test("an explicit throwaway name at the dead port fails TYPED, and nothing was dropped", { skip: SKIP }, async () => {
    // Pre-T21 this was HTTP 500 {"error":"fetch failed"}.
    const r = await postJson(`${config.appUrl}/api/ingest/clear`, { ...deadBase, weaviateCollection: "RAGEval_t21_deadport" }, 20000);
    assert.strictEqual(r.status, 500, r.text);
    assert.strictEqual(r.json?.code, "DESTRUCTIVE_OP_FAILED");
    assert.deepStrictEqual(r.json?.completed, [], "no step may be reported complete");
    assert.match(r.json?.error, /Nothing was dropped/);
    assert.match(r.json?.error, /RAGEval_t21_deadportV2/, "no version → the class resolved is the V2 sibling (cut-over)");
  });

  // T06 (design D6): under a DECLARED schema v2 the unload keys on sourceId
  // and never consults the disk — so at the dead port it reaches Weaviate
  // and fails TYPED (500 DESTRUCTIVE_OP_FAILED), never 404; the refusals
  // still all happen before any network call.
  test("T06: unload with schemaVersion 2 and a sourceId (no filePath) at the dead port → 500 DESTRUCTIVE_OP_FAILED, not 404", { skip: SKIP }, async () => {
    const r = await postJson(
      `${config.appUrl}/api/ingest/unload`,
      { ...deadBase, weaviateCollection: "RAGEval_t21_deadport", schemaVersion: 2, sourceId: "demos/no_such_file.pdf" },
      20000
    );
    assert.strictEqual(r.status, 500, r.text);
    assert.strictEqual(r.json?.success, false);
    assert.strictEqual(r.json?.code, "DESTRUCTIVE_OP_FAILED");
  });

  test("T06: unload with schemaVersion 2 and no collection → 400 COLLECTION_REQUIRED (the version does not relax the rule)", { skip: SKIP }, async () => {
    const r = await postJson(`${config.appUrl}/api/ingest/unload`, { ...deadBase, schemaVersion: 2, sourceId: "demos/x.pdf" }, 20000);
    assert.strictEqual(r.status, 400, r.text);
    assert.strictEqual(r.json?.code, "COLLECTION_REQUIRED");
  });

  test("T06: unload with schemaVersion 2 refuses an escaping sourceId, a non-string sourceId, and neither key — all 400, before any request", { skip: SKIP }, async () => {
    for (const body of [
      { sourceId: "../package.json" },
      // Three `..` escape public/; two would only collapse to `x.pdf`, a
      // legitimate identity under public/ (sourceIdFor normalises as the
      // route's path.join does — T05 review §6a item 2).
      { sourceId: "demos/a/../../../x.pdf" },
      { sourceId: 42, filePath: CORPUS_FILE },
      { sourceId: "   ", filePath: CORPUS_FILE },
      {},
    ]) {
      const r = await postJson(
        `${config.appUrl}/api/ingest/unload`,
        { ...deadBase, weaviateCollection: "RAGEval_t21_deadport", schemaVersion: 2, ...body },
        20000
      );
      assert.strictEqual(r.status, 400, `${JSON.stringify(body)}: ${r.text}`);
      assert.strictEqual(r.json?.success, false);
      assert.strictEqual(r.json?.code, "INGEST_CONFIG_MISSING", JSON.stringify(body));
    }
  });

  // T17 (design D12; F-79 / F-80): two refusals on the raw body, at the dead
  // port, so a 400 proves the route refused BEFORE any request. Before T17 a
  // garbage version resolved v1 (the frozen unsuffixed class) and a `…V2`
  // name resolved `…V2V2` — or, with version 1, the v2 class itself.
  for (const route of ["/api/ingest/clear", "/api/ingest/clear/preview", "/api/ingest/unload"]) {
    test(`T17/F-79: ${route} with a garbage schemaVersion → 400 SCHEMA_VERSION_INVALID, nothing dropped`, { skip: SKIP }, async () => {
      for (const version of ["v2", "two", 3, 0]) {
        const r = await postJson(`${config.appUrl}${route}`, { ...deadBase, weaviateCollection: "RAGEval_t21_deadport", schemaVersion: version, sourceId: "demos/x.pdf" }, 20000);
        assert.strictEqual(r.status, 400, `${JSON.stringify(version)}: ${r.text}`);
        assert.strictEqual(r.json?.success, false);
        assert.strictEqual(r.json?.code, "SCHEMA_VERSION_INVALID", JSON.stringify(version));
        assert.match(r.json?.error, /Nothing was dropped/);
      }
    });

    test(`T17/F-80: ${route} naming the suffixed class → 400 COLLECTION_NAME_INVALID under version 2, version 1 and no version`, { skip: SKIP }, async () => {
      // Both keys unload can require are sent (filePath under v1, sourceId
      // under v2), so the required-key check — which runs BEFORE the name
      // checks (§11a A3) — passes and the suffix refusal is what answers.
      for (const extra of [{}, { schemaVersion: 2 }, { schemaVersion: 1 }]) {
        const r = await postJson(`${config.appUrl}${route}`, { ...deadBase, weaviateCollection: "RAGEval_t21_deadportV2", sourceId: "demos/x.pdf", filePath: CORPUS_FILE, ...extra }, 20000);
        assert.strictEqual(r.status, 400, `${JSON.stringify(extra)}: ${r.text}`);
        assert.strictEqual(r.json?.code, "COLLECTION_NAME_INVALID", JSON.stringify(extra));
        assert.match(r.json?.error, /base collection/);
      }
    });
  }

  test("unload of a file that does not exist → 404 FILE_NOT_FOUND, typed (v1: the hash of the file on disk)", { skip: SKIP }, async () => {
    // A v1 contract, stated since the cut-over made 2 the default (D12).
    const r = await postJson(
      `${config.appUrl}/api/ingest/unload`,
      { ...deadBase, filePath: "demos/no_such_file.pdf", weaviateCollection: "RAGEval_t21_deadport", schemaVersion: 1 },
      20000
    );
    assert.strictEqual(r.status, 404, r.text);
    assert.strictEqual(r.json?.code, "FILE_NOT_FOUND");
  });

  test("cut-over: the same request with NO version takes the v2 path — the file need not exist, the delete keys on sourceId and fails TYPED at the dead port (500, not 404)", { skip: SKIP }, async () => {
    const r = await postJson(
      `${config.appUrl}/api/ingest/unload`,
      { ...deadBase, filePath: "demos/no_such_file.pdf", weaviateCollection: "RAGEval_t21_deadport" },
      20000
    );
    assert.strictEqual(r.status, 500, r.text);
    assert.strictEqual(r.json?.code, "DESTRUCTIVE_OP_FAILED");
    // At a dead port the delete THROWS before any response names a class
    // (`fetch failed`, the thrown-refusal shape), so the class is not in the
    // message here — the point of this case is 500-not-404: the v2 path never
    // consulted the disk. The resolved name is pinned on the clear case below.
    assert.notStrictEqual(r.json?.code, "FILE_NOT_FOUND");
  });
});

describe("I-DESTRUCT: the explicit path still works, on a throwaway class only", () => {
  test("preview of an absent class reports the count as UNKNOWN, not 0", { skip: SKIP }, async () => {
    assert.strictEqual(await classExists(throwaway), false, "throwaway must not pre-exist");
    const r = await postJson(`${config.appUrl}/api/ingest/clear/preview`, clearBody(), 30000);
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.collection, throwaway);
    assert.strictEqual(r.json.objectCount, null, "an unreadable count must be null");
    assert.ok(r.json.countError, "and say why");
    assert.strictEqual(r.json.ingestionStateWillReset, true);
    assert.strictEqual(typeof r.json.extractedImageDirs, "number");
    assert.strictEqual(await classExists(throwaway), false, "preview must not create anything");
  });

  test("clear on an absent class: dropped:false, recreated empty, every step reported", { skip: SKIP }, async () => {
    const r = await postJson(`${config.appUrl}/api/ingest/clear`, clearBody(), 60000);
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.success, true);
    assert.strictEqual(r.json.collection, throwaway);
    assert.strictEqual(r.json.dropped, false);
    assert.strictEqual(r.json.ingestionStateReset, true);
    clearsRun += 1;
    assert.ok(r.json.completed.includes("recreate") && r.json.completed.includes("purgeImages"), JSON.stringify(r.json.completed));
    assert.strictEqual(await classExists(throwaway), true, "the class must exist afterwards");
    assert.strictEqual(await countClass(throwaway), 0);
  });

  test("preview of the (now empty) class reports 0 honestly", { skip: SKIP }, async () => {
    const r = await postJson(`${config.appUrl}/api/ingest/clear/preview`, clearBody(), 30000);
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.objectCount, 0);
    assert.strictEqual(r.json.sourceCount, 0);
    assert.strictEqual(r.json.countError, null);
  });

  test("unload against the throwaway succeeds and names the collection", { skip: SKIP }, async () => {
    const r = await postJson(`${config.appUrl}/api/ingest/unload`, { ...clearBody(), filePath: CORPUS_FILE }, 60000);
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.success, true);
    assert.strictEqual(r.json.collection, throwaway);
  });

  test("clear on the existing class: dropped:true, droppedObjectCount 0", { skip: SKIP }, async () => {
    const r = await postJson(`${config.appUrl}/api/ingest/clear`, clearBody(), 60000);
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.dropped, true);
    assert.strictEqual(r.json.droppedObjectCount, 0);
    assert.deepStrictEqual(r.json.completed, ["drop", "recreate", "resetIngestionState", "purgeImages"]);
    clearsRun += 1;
  });

  test("T07: a v1 unload is recorded in the ingestion ledger as file_unloaded (design D11)", { skip: SKIP }, async () => {
    const ledger = require("../../src/lib/rag/ledger");
    const events = ledger.readEvents(ledger.defaultLedgerPath()).events;
    const unloads = events.filter((e) => e.event === "file_unloaded" && e.collection === throwaway);
    assert.ok(unloads.length >= 1, `no file_unloaded event for ${throwaway} in ${ledger.defaultLedgerPath()}`);
    const last = unloads[unloads.length - 1];
    assert.strictEqual(last.schemaVersion, 1);
    assert.match(String(last.docHash), /^[0-9a-f]{32}$/, "the v1 unload keys on the content hash and records it");
    assert.strictEqual(typeof last.sourceId, "string", "and the normalised path, so a completion record for it is invalidated");
    assert.ok(!("token" in last) && !JSON.stringify(last).includes("eyJ"), "no credential in the event");
  });

  test("T07: a clear is recorded in the ingestion ledger as collection_cleared (T21's deferred event, design D11)", { skip: SKIP }, async () => {
    const ledger = require("../../src/lib/rag/ledger");
    const events = ledger.readEvents(ledger.defaultLedgerPath()).events;
    const cleared = events.filter((e) => e.event === "collection_cleared" && e.collection === throwaway);
    assert.ok(cleared.length >= 1, `no collection_cleared event for ${throwaway} in ${ledger.defaultLedgerPath()}`);
    const last = cleared[cleared.length - 1];
    assert.strictEqual(last.dropped, true);
    assert.strictEqual(last.droppedObjectCount, 0);
    assert.ok(cleared.some((e) => e.dropped === false), "the absent-class clear was recorded too (dropped:false)");
  });

  test("clear on RAGEval_x leaves RAGEval_y intact — and RAGChunk untouched (ticket acceptance)", { skip: SKIP }, async () => {
    assert.ok(clearsRun >= 1, "no clear ran in this process, so 'untouched' would be vacuous");
    counts.after.eval = await countClass(evalCollection);
    counts.after.production = await countClass("RAGChunk");
    assert.strictEqual(counts.after.eval, counts.before.eval, `${evalCollection} count changed: ${JSON.stringify(counts)}`);
    assert.ok(counts.before.eval > 0, "the eval collection must be populated for this to mean anything");
    assert.strictEqual(counts.after.production, counts.before.production, `RAGChunk count changed: ${JSON.stringify(counts)}`);
  });
});
