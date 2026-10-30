/**
 * I-SCHEMA — the T05 acceptance criterion and X5, live (evaluation-plan §4.5
 * addendum, §6 X5; audit E24 / E26 / H5).
 *
 * Two things only a live store can show:
 *
 *  1. `isVisualElement` in every retrieve mode equals the STORED value.
 *     Measured before T05 on RAGEval_t08_20260813 (102 objects, 37 stored
 *     true): every row reported `false` — keyword 9 of 10 rows wrong,
 *     hybrid 4 of 10, vector 1 of 10 — because the selection never asked.
 *     Runs against the populated class named by RAG_EVAL_COLLECTION
 *     (unchanged; this is a read); the stored values are read back by id.
 *     RAG_EVAL_SCHEMA_VERSION states that class's shape (default 1: the v1
 *     T08 class) and is sent on the retrieve — cut-over design D12.
 *
 *  2. X5: two parallel ensureSchema() calls on a fresh class BOTH resolve.
 *     Before T05 the loser threw `TYPE_ADD_CLASS: class already exists`
 *     (measured 2026-09-04) and its whole ingest job failed. On its own
 *     fresh RAGEval_<runId>_x5 class, torn down by a direct schema DELETE
 *     behind assertEvalCollection (F-39). Both a v1 and a v2 class are
 *     raced, and the v2 class is checked for the v2 properties.
 *
 * Running: `node --test tests/integration/i-schema.test.js` (whole file —
 * node 20's --test-name-pattern skipped the target in T03's run).
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { skipReason, envConfig, postJson, assertEvalCollection, evalSchemaVersion, makeRunCollection } = require("./_harness");
const { WeaviateClient, V2_EXTRA_PROPERTIES } = require("../../src/lib/vectordb/weaviate");

const SKIP = skipReason();
const config = envConfig();
const COLLECTION = process.env.RAG_EVAL_COLLECTION || null;
const SCHEMA_VERSION = evalSchemaVersion(1);
const READ_SKIP =
  SKIP ||
  (COLLECTION
    ? /^RAGEval_[A-Za-z0-9_]+$/.test(COLLECTION)
      ? false
      : `RAG_EVAL_COLLECTION must be an RAGEval_* class, got ${COLLECTION}`
    : "set RAG_EVAL_COLLECTION to a populated RAGEval_* collection");

function weaviateHeaders() {
  const h = { "Content-Type": "application/json" };
  if (config.token) h["x-auth-token"] = config.token;
  return h;
}

async function gql(query) {
  const res = await fetch(`${config.weaviateUrl}/v1/graphql`, {
    method: "POST",
    headers: weaviateHeaders(),
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await res.json();
  assert.ok(!body.errors, `GraphQL errors: ${JSON.stringify(body.errors)}`);
  return body.data;
}

describe("I-SCHEMA: isVisualElement matches the stored value in every mode (T05 acceptance, E24)", () => {
  test("hybrid / vector / keyword responses all carry the stored isVisualElement", { skip: READ_SKIP }, async (t) => {
    assertEvalCollection(COLLECTION);
    // Ground truth: every object's stored boolean, keyed by text (the route
    // does not return ids; on a v1 class there is nothing else to key on).
    const data = await gql(`{ Get { ${COLLECTION}(limit: 2000) { text isVisualElement imagePath _additional { id } } } }`);
    const stored = data.Get[COLLECTION] || [];
    const storedVisual = stored.filter((o) => o.isVisualElement === true).length;
    assert.ok(stored.length > 0, `${COLLECTION} is empty`);
    assert.ok(storedVisual > 0, `${COLLECTION} holds no visual chunks — the acceptance is only meaningful with some`);
    // Text is the only key the route returns; a duplicated text would make the
    // lookup ambiguous, so it is refused rather than silently last-wins.
    const byText = new Map();
    for (const o of stored) {
      if (byText.has(o.text) && byText.get(o.text).isVisualElement !== o.isVisualElement) {
        assert.fail(`two objects share the text "${o.text.slice(0, 60)}…" with different isVisualElement — cannot key ground truth by text`);
      }
      byText.set(o.text, o);
    }
    t.diagnostic(`${COLLECTION}: ${stored.length} objects, ${storedVisual} stored isVisualElement:true`);

    // A query a caption chunk ranks well for (F-31 measured a floor-plan
    // caption as BM25 top-1 for the bare token).
    const query = process.env.RAG_EVAL_VISUAL_QUERY || "Alderney floor plan";
    let visualSeen = 0;
    for (const mode of ["hybrid", "vector", "keyword"]) {
      const res = await postJson(`${config.appUrl}/api/rag/retrieve`, {
        query,
        weaviateUrl: config.weaviateUrl,
        weaviateCollection: COLLECTION,
        schemaVersion: SCHEMA_VERSION,
        token: config.token,
        weaviateToken: config.token,
        embedUrl: config.embedUrl,
        embedModel: config.embedModel,
        rerankEnabled: false,
        searchStrategy: mode,
        hybridAlpha: 0.5,
        limit: 10,
        keepTopNAfterRerank: 10,
        candidatesToRerank: 10,
        similarityThreshold: 0,
      }, 300000);
      assert.ok(res.ok, `${mode}: retrieve failed: ${res.text}`);
      assert.strictEqual(res.json.success, true, mode);
      const rows = res.json.results || [];
      assert.ok(rows.length > 0, `${mode}: no results`);
      let modeVisual = 0;
      for (const [i, r] of rows.entries()) {
        const s = byText.get(r.text);
        assert.ok(s, `${mode} row ${i}: result text not found in the collection`);
        assert.strictEqual(typeof r.isVisualElement, "boolean", `${mode} row ${i}: isVisualElement must be a boolean`);
        assert.strictEqual(r.isVisualElement, s.isVisualElement === true, `${mode} row ${i} (page ${r.page}): response ${r.isVisualElement}, stored ${s.isVisualElement}`);
        if (s.isVisualElement) {
          modeVisual += 1;
          assert.ok(r.imagePath, `${mode} row ${i}: a visual chunk carries its imagePath`);
        }
        // T05's identity fields are present on every row: a value or null.
        for (const f of ["chunkIndex", "docVersion", "sourceId"]) {
          assert.ok(f in r, `${mode} row ${i}: ${f} key present`);
        }
      }
      // Per mode, not summed: a mode that returned no visual chunk proved nothing.
      assert.ok(modeVisual > 0, `${mode}: no visual chunk was returned for "${query}" — the criterion is vacuous in this mode (RAG_EVAL_VISUAL_QUERY)`);
      visualSeen += modeVisual;
      t.diagnostic(`${mode}: ${rows.length} rows, ${modeVisual} stored-visual, all matched`);
    }
    // The assertion above is vacuous if no visual chunk was ever returned.
    assert.ok(visualSeen > 0, `no visual chunk was returned in any mode for "${query}" — choose a query that retrieves one (RAG_EVAL_VISUAL_QUERY)`);
  });
});

describe("I-SCHEMA: X5 — parallel ensureSchema on a fresh class (E26 / H5)", () => {
  for (const schemaVersion of [1, 2]) {
    test(`two concurrent ensureSchema() calls both succeed (schema v${schemaVersion})`, { skip: SKIP }, async (t) => {
      const cls = makeRunCollection(`x5v${schemaVersion}`);
      const clients = [1, 2].map(() => new WeaviateClient(config.weaviateUrl, config.token, cls, { schemaVersion }));
      const cleanup = async () => {
        assertEvalCollection(cls);
        assert.match(cls, /_x5v[12]$/, "teardown may only drop this test's own class");
        try {
          const res = await fetch(`${config.weaviateUrl}/v1/schema/${cls}`, { method: "DELETE", headers: weaviateHeaders(), signal: AbortSignal.timeout(15000) });
          t.diagnostic(`teardown: DELETE /v1/schema/${cls} → ${res.status}`);
        } catch (err) {
          console.warn(`[I-SCHEMA teardown] could not drop ${cls}: ${err.message}`);
        }
      };
      try {
        const settled = await Promise.allSettled(clients.map((c) => c.ensureSchema()));
        t.diagnostic(`X5 v${schemaVersion}: ${JSON.stringify(settled.map((s) => (s.status === "fulfilled" ? s.value : String(s.reason?.message).slice(0, 120))))}`);
        for (const [i, s] of settled.entries()) {
          assert.strictEqual(s.status, "fulfilled", `call ${i} rejected: ${s.reason?.message}`);
          assert.strictEqual(s.value, true);
        }
        const res = await fetch(`${config.weaviateUrl}/v1/schema/${cls}`, { headers: weaviateHeaders(), signal: AbortSignal.timeout(15000) });
        assert.strictEqual(res.status, 200, "the class exists exactly once");
        const names = new Set(((await res.json()).properties || []).map((p) => p.name));
        for (const p of V2_EXTRA_PROPERTIES) {
          assert.strictEqual(names.has(p.name), schemaVersion === 2, `v${schemaVersion}: property ${p.name}`);
        }
        // A third call on the now-existing class is a plain success too.
        assert.strictEqual(await clients[0].ensureSchema(), true);
      } finally {
        await cleanup();
      }
    });
  }

  test("a v2 batchInsert re-sent is an upsert: same ids, same count, new text (E25 / FM-D2, live)", { skip: SKIP }, async (t) => {
    const cls = makeRunCollection("x5upsert");
    const client = new WeaviateClient(config.weaviateUrl, config.token, cls, { schemaVersion: 2 });
    const mk = (i, text) => ({
      text, source: "probe.pdf", fileType: "pdf", page: 1, chunkIndex: i, docHash: "deadbeef",
      sourceId: "demos/probe.pdf", docVersion: "deadbeef.0123456789ab", engine: "pypdfium2",
      metadata: "{}", vector: [0.1 * (i + 1), 0.2, 0.3, 0.4],
    });
    try {
      assert.strictEqual(await client.ensureSchema(), true);
      await client.batchInsert([mk(0, "first 0"), mk(1, "first 1")]);
      await client.batchInsert([mk(0, "second 0"), mk(1, "second 1")]);
      await new Promise((r) => setTimeout(r, 1000));
      assert.strictEqual(await client.countObjects(), 2, "two chunks sent twice are two objects");
      const data = await gql(`{ Get { ${cls} { text chunkIndex _additional { id } } } }`);
      const rows = (data.Get[cls] || []).sort((a, b) => a.chunkIndex - b.chunkIndex);
      assert.deepStrictEqual(rows.map((r) => r.text), ["second 0", "second 1"], "the re-send replaced the text");
      const { chunkIdFor } = require("../../src/lib/rag/ids");
      assert.deepStrictEqual(rows.map((r) => r._additional.id), [0, 1].map((i) => chunkIdFor("demos/probe.pdf", "deadbeef.0123456789ab", i)));
    } finally {
      assertEvalCollection(cls);
      assert.match(cls, /_x5upsert$/);
      try {
        const res = await fetch(`${config.weaviateUrl}/v1/schema/${cls}`, { method: "DELETE", headers: weaviateHeaders(), signal: AbortSignal.timeout(15000) });
        t.diagnostic(`teardown: DELETE /v1/schema/${cls} → ${res.status}`);
      } catch (err) {
        console.warn(`[I-SCHEMA teardown] could not drop ${cls}: ${err.message}`);
      }
    }
  });

  test("a v2 client refuses an existing v1 class rather than writing into it", { skip: SKIP }, async (t) => {
    const cls = makeRunCollection("x5mix");
    const v1 = new WeaviateClient(config.weaviateUrl, config.token, cls, { schemaVersion: 1 });
    const v2 = new WeaviateClient(config.weaviateUrl, config.token, cls, { schemaVersion: 2 });
    try {
      assert.strictEqual(await v1.ensureSchema(), true);
      await assert.rejects(v2.ensureSchema(), /is not a schema-v2 class/);
    } finally {
      assertEvalCollection(cls);
      assert.match(cls, /_x5mix$/);
      try {
        const res = await fetch(`${config.weaviateUrl}/v1/schema/${cls}`, { method: "DELETE", headers: weaviateHeaders(), signal: AbortSignal.timeout(15000) });
        t.diagnostic(`teardown: DELETE /v1/schema/${cls} → ${res.status}`);
      } catch (err) {
        console.warn(`[I-SCHEMA teardown] could not drop ${cls}: ${err.message}`);
      }
    }
  });
});
