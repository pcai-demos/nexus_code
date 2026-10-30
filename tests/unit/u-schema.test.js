/**
 * U-SCHEMA — the schema-v2 write path and the introspected read selection
 * (ticket T05; audit E08 / E24 / E25 / E26; design D3, D4, D5, D7).
 *
 * Measured live before this ticket (t05-artifacts/t05-reverify-live.json,
 * Weaviate 1.25.6, 2026-09-04):
 *   - a Get selecting a field the class lacks answers HTTP 200, no data,
 *     `Cannot query field "chunkIndex" on type "…"` — the WHOLE query fails;
 *   - two parallel first creates: one 200, one refusal whose message is
 *     `TYPE_ADD_CLASS: class already exists`, while a sequential duplicate
 *     create is 422 `class name X already exists` — two messages, one
 *     condition;
 *   - a batch object with an id is an upsert; without one it is a new
 *     random-UUID object; a non-UUID id is 422 for the batch.
 *
 * Pure-function tests over a stubbed fetch. The stub is routed by
 * `METHOD url` with a queue per route, so the SEQUENCE of calls is asserted,
 * not just their count — and it can return a non-JSON 200, a 404 and a 200
 * carrying errors[], the three shapes a queue-only stub hid in T03's review.
 * The live half is I-SCHEMA and I-IDEMPOTENT's v2 case.
 */

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");

const {
  WeaviateClient,
  V1_PROPERTIES,
  V2_EXTRA_PROPERTIES,
  OPTIONAL_SELECT_FIELDS,
  _classPropertyCache,
} = require("../../src/lib/vectordb/weaviate");
const { chunkIdFor } = require("../../src/lib/rag/ids");

const URL = "http://weaviate.test";
const CLS = "RAGEval_u";

function routedFetch(routes) {
  const calls = [];
  const stub = async (url, opts = {}) => {
    const method = opts.method || "GET";
    const key = `${method} ${String(url).replace(URL, "")}`;
    calls.push({ key, body: opts.body ? JSON.parse(opts.body) : null });
    const queue = routes[key];
    if (!queue || queue.length === 0) throw new Error(`fetch stub: no response queued for ${key}`);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    const body = typeof next.body === "string" ? next.body : JSON.stringify(next.body ?? {});
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  };
  stub.calls = calls;
  return stub;
}

async function withFetch(stub, fn) {
  const original = global.fetch;
  global.fetch = stub;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

async function silenced(fn) {
  const o = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  console.log = console.warn = console.error = (...a) => lines.push(a.map(String).join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, o);
  }
}

const v1Names = V1_PROPERTIES.map((p) => p.name);
const v2Names = v1Names.concat(V2_EXTRA_PROPERTIES.map((p) => p.name));
const schemaBody = (names, cls = CLS) => ({ class: cls, properties: names.map((name) => ({ name, dataType: ["text"] })) });
const plain = (opts) => new WeaviateClient(URL, "x", CLS, opts);

beforeEach(() => _classPropertyCache.clear());

describe("U-SCHEMA: ensureSchema — v1 class exactly as before, v2 additive", () => {
  test("v1: an existing class is accepted with no create (unchanged)", async () => {
    const stub = routedFetch({ [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }] });
    await withFetch(stub, () => plain().ensureSchema());
    assert.deepStrictEqual(stub.calls.map((c) => c.key), [`GET /v1/schema/${CLS}`]);
  });

  test("v1: the created class carries exactly the eleven v1 properties, no id-related field", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 404, body: { error: "not found" } }],
      "POST /v1/schema": [{ status: 200, body: {} }],
    });
    await withFetch(stub, () => plain().ensureSchema());
    const created = stub.calls[1].body;
    assert.deepStrictEqual(created.properties.map((p) => p.name), v1Names);
    assert.deepStrictEqual(created.properties, V1_PROPERTIES.map((p) => ({ ...p })));
    assert.strictEqual(created.vectorizer, "none");
  });

  test("v2: the created class is v1 + sourceId/docVersion/chunkIndex/engine, exact-match and not BM25-searchable", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 404, body: {} }],
      "POST /v1/schema": [{ status: 200, body: {} }],
    });
    await withFetch(stub, () => plain({ schemaVersion: 2 }).ensureSchema());
    const created = stub.calls[1].body;
    assert.deepStrictEqual(created.properties.map((p) => p.name), v2Names);
    const byName = Object.fromEntries(created.properties.map((p) => [p.name, p]));
    for (const name of ["sourceId", "docVersion", "engine"]) {
      assert.strictEqual(byName[name].tokenization, "field", `${name} is exact-match`);
      assert.strictEqual(byName[name].indexSearchable, false, `${name} stays out of BM25`);
      assert.deepStrictEqual(byName[name].dataType, ["text"]);
    }
    assert.deepStrictEqual(byName.chunkIndex.dataType, ["int"]);
    // The v1 columns' index settings are untouched (E23 is T11's).
    for (const name of v1Names) assert.deepStrictEqual(byName[name], V1_PROPERTIES.find((p) => p.name === name));
  });

  test("a successful create records the class shape, so the next search does not read the schema again", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 404, body: {} }],
      "POST /v1/schema": [{ status: 200, body: {} }],
      "POST /v1/graphql": [{ status: 200, body: { data: { Get: { [CLS]: [] } } } }],
    });
    await withFetch(stub, async () => {
      const c = plain({ schemaVersion: 2 });
      await c.ensureSchema();
      await c.search("q", null, "keyword", 5, 0);
    });
    assert.deepStrictEqual(stub.calls.map((c) => c.key), [`GET /v1/schema/${CLS}`, "POST /v1/schema", "POST /v1/graphql"]);
    assert.ok(selectedFields(stub, 2).includes("chunkIndex"), "the shape just created is the one selected");
  });

  test("a lost race is success: create refused, class exists on re-check (E26 / H5), both versions", async () => {
    for (const [version, names] of [[1, v1Names], [2, v2Names]]) {
      const stub = routedFetch({
        [`GET /v1/schema/${CLS}`]: [{ status: 404, body: {} }, { status: 200, body: schemaBody(names) }],
        "POST /v1/schema": [{ status: 422, body: { error: [{ message: "updating schema: TYPE_ADD_CLASS: class already exists" }] } }],
      });
      const { result, lines } = await silenced(() => withFetch(stub, () => plain({ schemaVersion: version }).ensureSchema()));
      assert.strictEqual(result, true, `v${version}`);
      assert.deepStrictEqual(
        stub.calls.map((c) => c.key),
        [`GET /v1/schema/${CLS}`, "POST /v1/schema", `GET /v1/schema/${CLS}`],
        `v${version}: GET, POST, re-GET`
      );
      assert.ok(lines.some((l) => /created concurrently/.test(l)), `v${version}: the race is logged`);
    }
  });

  test("v2 lost race where the winner created a v1-shaped class: refused, not written into", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 404, body: {} }, { status: 200, body: schemaBody(v1Names) }],
      "POST /v1/schema": [{ status: 422, body: { error: [{ message: "class name RAGEval_u already exists" }] } }],
    });
    await assert.rejects(silenced(() => withFetch(stub, () => plain({ schemaVersion: 2 }).ensureSchema())), /is not a schema-v2 class/);
  });

  test("the race handling does not depend on the message or the status", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 404, body: {} }, { status: 200, body: schemaBody(v1Names) }],
      "POST /v1/schema": [{ status: 500, body: "<html>gateway</html>" }],
    });
    const { result } = await silenced(() => withFetch(stub, () => plain().ensureSchema()));
    assert.strictEqual(result, true);
  });

  test("a failed create for a class that is still absent throws with Weaviate's body", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 404, body: {} }, { status: 404, body: {} }],
      "POST /v1/schema": [{ status: 422, body: { error: [{ message: "invalid property" }] } }],
    });
    await assert.rejects(withFetch(stub, () => plain().ensureSchema()), /Failed to create Weaviate schema for 'RAGEval_u'.*invalid property/);
  });

  test("v2 refuses an existing class that lacks the v2 properties (auto-schema must not half-migrate a v1 class)", async () => {
    const stub = routedFetch({ [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }] });
    await assert.rejects(
      withFetch(stub, () => plain({ schemaVersion: 2 }).ensureSchema()),
      /is not a schema-v2 class: it lacks sourceId, docVersion, chunkIndex, engine/
    );
    assert.strictEqual(stub.calls.length, 1, "nothing is created over it");
  });

  test("v2 accepts an existing v2 class", async () => {
    const stub = routedFetch({ [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v2Names) }] });
    assert.strictEqual(await withFetch(stub, () => plain({ schemaVersion: 2 }).ensureSchema()), true);
  });

  test("forDestructiveOps carries the schema version through", () => {
    assert.strictEqual(WeaviateClient.forDestructiveOps(URL, "x", CLS, { schemaVersion: 2 }).schemaVersion, 2);
    assert.strictEqual(WeaviateClient.forDestructiveOps(URL, "x", CLS).schemaVersion, 1);
    assert.strictEqual(plain({ schemaVersion: "2" }).schemaVersion, 2, "\"2\" is v2 at the client too — the resolver's rule");
    for (const v of [1, "1", "v2", 3, null, undefined]) assert.strictEqual(plain({ schemaVersion: v }).schemaVersion, 1, JSON.stringify(v));
  });
});

const chunk = (i, extra = {}) => ({
  text: `chunk ${i}`,
  source: "x.pdf",
  fileType: "pdf",
  page: 1,
  chunkIndex: i,
  docHash: "deadbeef",
  sourceId: "demos/x.pdf",
  docVersion: "deadbeef.0123456789ab",
  engine: "pypdfium2",
  metadata: JSON.stringify({ isVisualElement: i === 1, imagePath: i === 1 ? "/extracted_images/x/1.png" : undefined }),
  vector: [0.1, 0.2],
  ...extra,
});

describe("U-SCHEMA/T17 (design D14, F-72): batchInsert's Tidy Up hint fires on the refusal Weaviate 1.25.6 actually sends", () => {
  // The exact per-object error text measured live (t16-artifacts/t16-reverify-live.json, step 3).
  const LIVE_REFUSAL = "Validate vector index for b93158b6-a534-5972-9fe7-82221c00e8de: new node has a vector with length 2560. Existing nodes have vectors with length 4096";
  const refusal = (message) => ({ status: 200, body: [{ result: { errors: { error: [{ message }] } } }] });

  test("the live 1.25.6 text carries the hint (before T17 neither 'vector length mismatch' nor 'dimension' matched it)", async () => {
    const stub = routedFetch({ "POST /v1/batch/objects": [refusal(LIVE_REFUSAL)] });
    await assert.rejects(
      silenced(() => withFetch(stub, () => plain().batchInsert([chunk(0)]))),
      (err) => /Tidy Up RAG/.test(err.message) && err.message.includes(LIVE_REFUSAL)
    );
  });

  test("the older texts still carry it, and an unrelated refusal does not", async () => {
    for (const text of ["vector length mismatch", "dimension mismatch: 2560 vs 4096"]) {
      const stub = routedFetch({ "POST /v1/batch/objects": [refusal(text)] });
      await assert.rejects(silenced(() => withFetch(stub, () => plain().batchInsert([chunk(0)]))), (err) => /Tidy Up RAG/.test(err.message));
    }
    const other = routedFetch({ "POST /v1/batch/objects": [refusal("invalid text property 'page': not a number")] });
    await assert.rejects(silenced(() => withFetch(other, () => plain().batchInsert([chunk(0)]))), (err) => !/Tidy Up RAG/.test(err.message) && /batch insert failed/.test(err.message));
  });
});

// T41 (t41-design.md D11 a; F-159): the PCI parser's sub_requirement reaches the sectionNumber column — before its
// parent requirement number, after rule_ref; the column is not BM25-searched since T40, so no retrieval moves.
describe("U-SCHEMA/T41 (t41-design D11 a, F-159): sectionNumber receives sub_requirement", () => {
  test("sub_requirement fills the column, ahead of requirement_number and regulation_number, behind section_number and rule_ref", async () => {
    const stub = routedFetch({ "POST /v1/batch/objects": [{ status: 200, body: [] }] });
    const withMeta = (i, meta) => ({ ...chunk(i), metadata: JSON.stringify(meta) });
    await withFetch(stub, () => plain({ schemaVersion: 2 }).batchInsert([
      withMeta(0, { sub_requirement: "3.1.2", requirement_number: "3" }),
      withMeta(1, { requirement_number: "3" }),
      withMeta(2, { rule_ref: "SYSC 4.1.1R", sub_requirement: "4.1.1" }),
      withMeta(3, { section_number: "12", sub_requirement: "12.1" }),
      withMeta(4, { regulation_number: "7" }),
      withMeta(5, {}),
    ]));
    const sent = stub.calls[0].body.objects.map((o) => o.properties.sectionNumber);
    assert.deepStrictEqual(sent, ["3.1.2", "3", "SYSC 4.1.1R", "12", "7", ""]);
  });
});

describe("U-SCHEMA: batchInsert — v1 byte-identical, v2 deterministic ids", () => {
  test("v1 sends no id and exactly the v1 property map, whatever identity the chunk carries", async () => {
    const stub = routedFetch({ "POST /v1/batch/objects": [{ status: 200, body: [] }] });
    await withFetch(stub, () => plain().batchInsert([chunk(0), chunk(1)]));
    const objects = stub.calls[0].body.objects;
    assert.strictEqual(objects.length, 2);
    for (const o of objects) {
      assert.ok(!("id" in o), "v1 objects carry no id");
      assert.deepStrictEqual(Object.keys(o.properties), v1Names, "v1 property map is exactly the eleven v1 properties");
    }
    // The whole v1 object, values included: this is the pre-T05 contract.
    assert.deepStrictEqual(objects[1], {
      class: CLS,
      properties: {
        text: "chunk 1",
        source: "x.pdf",
        fileType: "pdf",
        chapter: "",
        sectionNumber: "",
        sectionTitle: "",
        page: 1,
        docHash: "deadbeef",
        imagePath: "/extracted_images/x/1.png",
        isVisualElement: true,
        metadata: JSON.stringify({ isVisualElement: true, imagePath: "/extracted_images/x/1.png" }),
      },
      vector: [0.1, 0.2],
    });
    assert.strictEqual(objects[0].properties.isVisualElement, false);
    assert.strictEqual(objects[0].properties.imagePath, "");
  });

  test("v2 sends id = uuidv5(sourceId:docVersion:chunkIndex) and the four identity properties — from the CHUNK's index, not its batch position", async () => {
    const stub = routedFetch({ "POST /v1/batch/objects": [{ status: 200, body: [] }] });
    // The route slices a document into batches of 64, so position and
    // chunkIndex differ from the second batch on.
    await withFetch(stub, () => plain({ schemaVersion: 2 }).batchInsert([chunk(7), chunk(3)]));
    const objects = stub.calls[0].body.objects;
    for (const [pos, o] of objects.entries()) {
      const idx = [7, 3][pos];
      assert.strictEqual(o.id, chunkIdFor("demos/x.pdf", "deadbeef.0123456789ab", idx));
      assert.notStrictEqual(o.id, chunkIdFor("demos/x.pdf", "deadbeef.0123456789ab", pos));
      assert.strictEqual(o.properties.sourceId, "demos/x.pdf");
      assert.strictEqual(o.properties.docVersion, "deadbeef.0123456789ab");
      assert.strictEqual(o.properties.chunkIndex, idx);
      assert.strictEqual(o.properties.engine, "pypdfium2");
      assert.strictEqual(o.properties.docHash, "deadbeef", "docHash is kept for overwrite-delete and unload");
    }
    assert.deepStrictEqual(Object.keys(objects[0].properties).sort(), v2Names.slice().sort());
  });

  test("v2 re-sending the same chunks produces the same ids (idempotent by construction)", async () => {
    const stub = routedFetch({ "POST /v1/batch/objects": [{ status: 200, body: [] }, { status: 200, body: [] }] });
    await withFetch(stub, async () => {
      const c = plain({ schemaVersion: 2 });
      await c.batchInsert([chunk(0), chunk(1)]);
      await c.batchInsert([chunk(0), chunk(1)]);
    });
    assert.deepStrictEqual(stub.calls[0].body.objects.map((o) => o.id), stub.calls[1].body.objects.map((o) => o.id));
  });

  test("v2 refuses a chunk without a complete identity BEFORE any request", async () => {
    for (const broken of [{ sourceId: "" }, { docVersion: undefined }, { chunkIndex: "0" }, { chunkIndex: null }]) {
      const stub = routedFetch({ "POST /v1/batch/objects": [{ status: 200, body: [] }] });
      await assert.rejects(
        withFetch(stub, () => plain({ schemaVersion: 2 }).batchInsert([chunk(0), chunk(1, broken)])),
        /Schema v2 insert into 'RAGEval_u' refused: chunk 1 \(x\.pdf\) has no complete identity/
      );
      assert.strictEqual(stub.calls.length, 0, `${JSON.stringify(broken)}: nothing was sent`);
    }
  });

  test("an engine that was not recorded is stored as \"\", never a guess", async () => {
    const stub = routedFetch({ "POST /v1/batch/objects": [{ status: 200, body: [] }] });
    await withFetch(stub, () => plain({ schemaVersion: 2 }).batchInsert([chunk(0, { engine: undefined })]));
    assert.strictEqual(stub.calls[0].body.objects[0].properties.engine, "");
  });
});

const row = (over = {}) => ({
  text: "t", source: "x.pdf", fileType: "pdf", chapter: "", sectionNumber: "", sectionTitle: "", page: 3, docHash: "d",
  metadata: JSON.stringify({ isVisualElement: true, imagePath: "/extracted_images/x/1.png" }),
  _additional: { score: "0.5" },
  ...over,
});
const getBody = (rows) => ({ data: { Get: { [CLS]: rows } } });
const selectedFields = (stub, i) => {
  const q = stub.calls[i].body.query;
  const m = q.match(/\)\s*\{([\s\S]*?)_additional/);
  return m[1].split(/\s+/).filter(Boolean);
};

describe("U-SCHEMA: search — select what the class has, in every mode (E24 / E08)", () => {
  test("a v1 class: isVisualElement and imagePath are selected in keyword, vector and hybrid; chunkIndex is not", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }],
      "POST /v1/graphql": [{ status: 200, body: getBody([row()]) }, { status: 200, body: getBody([row()]) }, { status: 200, body: getBody([row()]) }],
    });
    await withFetch(stub, async () => {
      const c = plain();
      await c.search("q", null, "keyword", 5, 0);
      await c.search("q", [0.1], "vector", 5, 0);
      await c.search("q", [0.1], "hybrid", 5, 0);
    });
    assert.strictEqual(stub.calls.filter((c) => c.key.startsWith("GET")).length, 1, "the schema is read once per class");
    // The EXACT selection: the nine v1 fields every mode always selected,
    // plus the two the class has. Nothing dropped, nothing unknown.
    const expected = ["text", "source", "fileType", "chapter", "sectionNumber", "sectionTitle", "page", "docHash", "metadata", "isVisualElement", "imagePath"];
    for (const i of [1, 2, 3]) assert.deepStrictEqual(selectedFields(stub, i), expected, `call ${i}`);
    assert.match(stub.calls[1].body.query, /bm25:/);
    assert.match(stub.calls[2].body.query, /nearVector:/);
    assert.match(stub.calls[3].body.query, /hybrid:/);
  });

  test("a v2 class: all five optional fields are selected", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v2Names) }],
      "POST /v1/graphql": [{ status: 200, body: getBody([row({ isVisualElement: false, chunkIndex: 4, docVersion: "d.0123456789ab", sourceId: "demos/x.pdf" })]) }],
    });
    const rows = await withFetch(stub, () => plain().search("q", null, "keyword", 5, 0));
    assert.deepStrictEqual(
      selectedFields(stub, 1),
      ["text", "source", "fileType", "chapter", "sectionNumber", "sectionTitle", "page", "docHash", "metadata", ...OPTIONAL_SELECT_FIELDS]
    );
    assert.strictEqual(rows[0].chunkIndex, 4);
    assert.strictEqual(rows[0].docVersion, "d.0123456789ab");
    assert.strictEqual(rows[0].sourceId, "demos/x.pdf");
  });

  test("the property cache is keyed by (url, class): another class or another server is read again", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }],
      "GET /v1/schema/RAGEval_other": [{ status: 200, body: schemaBody(v2Names, "RAGEval_other") }],
      "POST /v1/graphql": [{ status: 200, body: getBody([row()]) }, { status: 200, body: { data: { Get: { RAGEval_other: [row()] } } } }, { status: 200, body: getBody([row()]) }, { status: 200, body: getBody([row()]) }],
    });
    const otherServer = async (url, opts) => stub(String(url).replace("http://other.test", URL), opts);
    await withFetch(stub, async () => {
      await plain().search("q", null, "keyword", 5, 0);
      await new WeaviateClient(URL, "x", "RAGEval_other").search("q", null, "keyword", 5, 0);
      await plain().search("q", null, "keyword", 5, 0);
    });
    assert.deepStrictEqual(
      stub.calls.map((c) => c.key),
      [`GET /v1/schema/${CLS}`, "POST /v1/graphql", "GET /v1/schema/RAGEval_other", "POST /v1/graphql", "POST /v1/graphql"],
      "one GET per class; the second client for the same class hits the cache"
    );
    assert.ok(selectedFields(stub, 3).includes("chunkIndex") && !selectedFields(stub, 1).includes("chunkIndex"), "each class gets its own shape");
    // A different URL for the same class name is a different cache entry.
    _classPropertyCache.clear();
    const stub2 = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }, { status: 200, body: schemaBody(v2Names) }],
      "POST /v1/graphql": [{ status: 200, body: getBody([row()]) }, { status: 200, body: getBody([row()]) }],
    });
    const stub2Other = async (url, opts) => stub2(String(url).replace("http://other.test", URL), opts);
    await withFetch(stub2, () => plain().search("q", null, "keyword", 5, 0));
    await withFetch(stub2Other, () => new WeaviateClient("http://other.test", "x", CLS).search("q", null, "keyword", 5, 0));
    assert.strictEqual(stub2.calls.filter((c) => c.key.startsWith("GET")).length, 2, "same class on another server is read again");
    assert.ok(selectedFields(stub2, 3).includes("chunkIndex"));
    void otherServer;
  });

  test("isVisualElement is the STORED boolean, not the metadata's and not a default", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }],
      "POST /v1/graphql": [{ status: 200, body: getBody([row({ isVisualElement: true }), row({ isVisualElement: false, metadata: JSON.stringify({ isVisualElement: true }) }), row({ isVisualElement: undefined })]) }],
    });
    const rows = await withFetch(stub, () => plain().search("q", null, "keyword", 5, 0));
    assert.deepStrictEqual(rows.map((r) => r.isVisualElement), [true, false, false]);
    assert.strictEqual(rows[0].imagePath, "/extracted_images/x/1.png", "imagePath keeps its metadata fallback");
  });

  test("on a v1 class the identity fields are null — a fact the class does not have, never 0 or \"\"", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }],
      "POST /v1/graphql": [{ status: 200, body: getBody([row()]) }],
    });
    const rows = await withFetch(stub, () => plain().search("q", null, "keyword", 5, 0));
    assert.strictEqual(rows[0].chunkIndex, null);
    assert.strictEqual(rows[0].docVersion, null);
    assert.strictEqual(rows[0].sourceId, null);
  });

  test("a stale cached shape (class recreated) is refreshed once on `Cannot query field`, then retried", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v2Names) }, { status: 200, body: schemaBody(v1Names) }],
      "POST /v1/graphql": [
        { status: 200, body: { errors: [{ message: `Cannot query field "chunkIndex" on type "${CLS}".` }] } },
        { status: 200, body: getBody([row()]) },
      ],
    });
    const { result: rows } = await silenced(() => withFetch(stub, () => plain().search("q", null, "keyword", 5, 0)));
    assert.deepStrictEqual(stub.calls.map((c) => c.key), [`GET /v1/schema/${CLS}`, "POST /v1/graphql", `GET /v1/schema/${CLS}`, "POST /v1/graphql"]);
    assert.ok(selectedFields(stub, 1).includes("chunkIndex"), "first query used the stale shape");
    assert.ok(!selectedFields(stub, 3).includes("chunkIndex"), "retry used the fresh shape");
    assert.strictEqual(rows.length, 1);
  });

  test("a second `Cannot query field` — or any other GraphQL error — throws (F-19: never a silent empty set)", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v2Names) }, { status: 200, body: schemaBody(v2Names) }],
      "POST /v1/graphql": [
        { status: 200, body: { errors: [{ message: `Cannot query field "chunkIndex" on type "${CLS}".` }] } },
        { status: 200, body: { errors: [{ message: `Cannot query field "chunkIndex" on type "${CLS}".` }] } },
      ],
    });
    await assert.rejects(silenced(() => withFetch(stub, () => plain().search("q", null, "keyword", 5, 0))), /Weaviate GraphQL error .*Cannot query field/);
    const stub2 = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }],
      "POST /v1/graphql": [{ status: 200, body: { errors: [{ message: "vector lengths don't match" }] } }],
    });
    await assert.rejects(withFetch(stub2, () => plain().search("q", [0.1], "vector", 5, 0)), /vector lengths don't match/);
  });

  test("a schema read that fails or is not JSON throws typed — it never becomes 'no optional fields'", async () => {
    const stub = routedFetch({ [`GET /v1/schema/${CLS}`]: [{ status: 404, body: { error: "not found" } }] });
    await assert.rejects(withFetch(stub, () => plain().search("q", null, "keyword", 5, 0)), /Weaviate schema read failed for collection 'RAGEval_u': HTTP 404/);
    const stub2 = routedFetch({ [`GET /v1/schema/${CLS}`]: [{ status: 200, body: "<html>proxy</html>" }] });
    await assert.rejects(withFetch(stub2, () => plain().search("q", null, "keyword", 5, 0)), /schema read returned a non-JSON 200/);
  });
});

describe("U-SCHEMA: cache invalidation and body sanity (review findings, 2026-09-04)", () => {
  test("clearSchema forgets the class shape: a recreated wider class is read again", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [
        { status: 200, body: schemaBody(v1Names) },   // search 1: v1 shape
        { status: 200, body: schemaBody(v1Names) },   // clearSchema existence check
        { status: 404, body: {} },                    // ensureSchema (recreate) check
        { status: 200, body: schemaBody(v2Names) },   // search 2: read again
      ],
      [`DELETE /v1/schema/${CLS}`]: [{ status: 200, body: {} }],
      "POST /v1/schema": [{ status: 200, body: {} }],
      "POST /v1/graphql": [{ status: 200, body: getBody([row()]) }, { status: 200, body: getBody([row()]) }],
    });
    await silenced(() => withFetch(stub, async () => {
      await plain().search("q", null, "keyword", 5, 0);
      // The destructive client recreates as v1 (a foreign process could make it v2 — the point is the cache is dropped).
      await WeaviateClient.forDestructiveOps(URL, "x", CLS).clearSchema();
      _classPropertyCache.delete(`${URL}|${CLS}`); // simulate the foreign recreate having invalidated nothing else
      await plain().search("q", null, "keyword", 5, 0);
    }));
    const gets = stub.calls.filter((c) => c.key === `GET /v1/schema/${CLS}`).length;
    assert.strictEqual(gets, 4, "the shape was re-read after the drop");
  });

  test("clearSchema itself drops the cached shape (no manual delete needed)", async () => {
    _classPropertyCache.set(`${URL}|${CLS}`, new Set(v1Names));
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }, { status: 404, body: {} }],
      [`DELETE /v1/schema/${CLS}`]: [{ status: 200, body: {} }],
      "POST /v1/schema": [{ status: 200, body: {} }],
    });
    await silenced(() => withFetch(stub, () => WeaviateClient.forDestructiveOps(URL, "x", CLS).clearSchema()));
    // After drop + recreate the cache holds the shape just created (v1 here).
    assert.deepStrictEqual([..._classPropertyCache.get(`${URL}|${CLS}`)], v1Names);
  });

  test("a 200 schema body that is not this class's schema throws — never 'no optional fields'", async () => {
    for (const body of [{}, { class: "Other", properties: [] }, { class: CLS }, "[]"]) {
      _classPropertyCache.clear();
      const stub = routedFetch({ [`GET /v1/schema/${CLS}`]: [{ status: 200, body }] });
      await assert.rejects(withFetch(stub, () => plain().search("q", null, "keyword", 5, 0)), /not this class's schema|non-JSON|schema read/, JSON.stringify(body));
    }
  });

  test("deleteByHash scoped by sourceId sends docHash AND sourceId; unscoped is the v1 match, byte for byte", async () => {
    const stub = routedFetch({ "DELETE /v1/batch/objects": [{ status: 200, body: { results: { matches: 2, failed: 0 } } }, { status: 200, body: { results: { matches: 2, failed: 0 } } }] });
    const c = WeaviateClient.forDestructiveOps(URL, "x", CLS, { schemaVersion: 2 });
    await withFetch(stub, async () => {
      await c.deleteByHash("deadbeef", { sourceId: "demos/x.pdf" });
      await c.deleteByHash("deadbeef");
    });
    assert.deepStrictEqual(stub.calls[0].body.match.where, {
      operator: "And",
      operands: [
        { path: ["docHash"], operator: "Equal", valueText: "deadbeef" },
        { path: ["sourceId"], operator: "Equal", valueText: "demos/x.pdf" },
      ],
    });
    assert.deepStrictEqual(stub.calls[1].body.match.where, { path: ["docHash"], operator: "Equal", valueText: "deadbeef" });
  });
});

describe("U-SCHEMA: checkIdentityExists — the v2 duplicate check (D2 / F-50)", () => {
  const aggregate = (count) => ({ status: 200, body: { data: { Aggregate: { [CLS]: [{ meta: { count } }] } } } });

  test("asks for this sourceId AND this docVersion with unquoted enums and JSON string literals", async () => {
    const stub = routedFetch({ "POST /v1/graphql": [aggregate(3)] });
    const { result, lines } = await silenced(() => withFetch(stub, () => plain({ schemaVersion: 2 }).checkIdentityExists('demos/x "y".pdf', "d.0123456789ab")));
    assert.strictEqual(result, true);
    const q = stub.calls[0].body.query;
    assert.match(q, /operator: And/);
    assert.match(q, /path: \["sourceId"\], operator: Equal, valueText: "demos\/x \\"y\\"\.pdf"/);
    assert.match(q, /path: \["docVersion"\], operator: Equal, valueText: "d\.0123456789ab"/);
    assert.ok(!/operator: "Equal"/.test(q) && !/operator: "And"/.test(q), "enums are unquoted (E04)");
    assert.ok(lines.some((l) => /3 chunk\(s\) in 'RAGEval_u' already carry sourceId/.test(l)), "a positive answer is logged with the count");
  });

  test("count 0 → false", async () => {
    const stub = routedFetch({ "POST /v1/graphql": [aggregate(0)] });
    assert.strictEqual(await withFetch(stub, () => plain().checkIdentityExists("a", "b")), false);
  });

  test("GraphQL errors, a non-JSON 200 and a missing count THROW (T03 D1 contract)", async () => {
    for (const [resp, re] of [
      [{ status: 200, body: { errors: [{ message: 'Cannot query field "sourceId"' }] } }, /duplicate check failed .*Cannot query field/],
      [{ status: 200, body: "<html>proxy</html>" }, /non-JSON 200/],
      [{ status: 200, body: { data: { Aggregate: { [CLS]: [] } } } }, /returned no meta\.count/],
    ]) {
      const stub = routedFetch({ "POST /v1/graphql": [resp] });
      await assert.rejects(withFetch(stub, () => plain().checkIdentityExists("a", "b")), re);
    }
  });

  test("a transport failure logs and returns false (the file is re-indexed, a cost not a wrong answer)", async () => {
    for (const resp of [{ status: 503, body: "unavailable" }, new Error("ECONNREFUSED")]) {
      const stub = routedFetch({ "POST /v1/graphql": [resp] });
      const { result, lines } = await silenced(() => withFetch(stub, () => plain().checkIdentityExists("a", "b")));
      assert.strictEqual(result, false);
      assert.ok(lines.some((l) => /checkIdentityExists Failed/.test(l)));
    }
  });
});

describe("U-SCHEMA/T06: deleteBySourceExceptVersion and deleteBySourceId — the supersede filters (E05 / FM-V1, design D1, D5, D6)", () => {
  // Measured live on 1.25.6 (t06-artifacts/t06-reverify-live.json): the
  // two-operand And matched exactly the 18 objects of the other version; the
  // nested Or/GreaterThanEqual form matched 18 + 2 (the other version plus
  // the tail at or beyond the kept count), then exactly 2 once the other
  // version was gone. The result cap on that build is 100 000, inside a 200.
  const ok = (matches, extra = {}) => ({ status: 200, body: { results: { matches, successful: matches, failed: 0, limit: 100000, ...extra } } });
  const destructive = () => WeaviateClient.forDestructiveOps(URL, "x", CLS, { schemaVersion: 2 });
  const S = "eval_fixtures/t06/report.pdf";
  const V = "48b0c846c5599cd9026f9daa25d79e9c.819db7888e60";

  test("without keepChunkCount: the ticket's And[sourceId Equal, docVersion NotEqual], on this class, as a DELETE", async () => {
    const stub = routedFetch({ "DELETE /v1/batch/objects": [ok(18)] });
    const result = await withFetch(stub, () => destructive().deleteBySourceExceptVersion(S, V));
    assert.deepStrictEqual(stub.calls.map((c) => c.key), ["DELETE /v1/batch/objects"]);
    assert.deepStrictEqual(stub.calls[0].body, {
      match: {
        class: CLS,
        where: {
          operator: "And",
          operands: [
            { path: ["sourceId"], operator: "Equal", valueText: S },
            { path: ["docVersion"], operator: "NotEqual", valueText: V },
          ],
        },
      },
    });
    assert.deepStrictEqual(result, { ok: true, status: 200, body: null, matches: 18, failed: 0 });
  });

  test("with keepChunkCount: And[sourceId Equal, Or[docVersion NotEqual, chunkIndex GreaterThanEqual n]] — the exact live-verified form", async () => {
    const stub = routedFetch({ "DELETE /v1/batch/objects": [ok(20)] });
    await withFetch(stub, () => destructive().deleteBySourceExceptVersion(S, V, { keepChunkCount: 87 }));
    assert.deepStrictEqual(stub.calls[0].body.match.where, {
      operator: "And",
      operands: [
        { path: ["sourceId"], operator: "Equal", valueText: S },
        {
          operator: "Or",
          operands: [
            { path: ["docVersion"], operator: "NotEqual", valueText: V },
            { path: ["chunkIndex"], operator: "GreaterThanEqual", valueInt: 87 },
          ],
        },
      ],
    });
  });

  test("keepChunkCount 0 is a real value (a document whose kept version has no chunks below index 0), not 'absent'", async () => {
    const stub = routedFetch({ "DELETE /v1/batch/objects": [ok(0)] });
    await withFetch(stub, () => destructive().deleteBySourceExceptVersion(S, V, { keepChunkCount: 0 }));
    const tail = stub.calls[0].body.match.where.operands[1].operands[1];
    assert.deepStrictEqual(tail, { path: ["chunkIndex"], operator: "GreaterThanEqual", valueInt: 0 });
  });

  test("the filter never names `source` (word-tokenised: `source Equal \"report\"` matched every object live)", async () => {
    const stub = routedFetch({ "DELETE /v1/batch/objects": [ok(1), ok(1)] });
    await withFetch(stub, async () => {
      await destructive().deleteBySourceExceptVersion(S, V, { keepChunkCount: 3 });
      await destructive().deleteBySourceId(S);
    });
    for (const call of stub.calls) {
      assert.ok(!JSON.stringify(call.body).includes('"source"'), `a delete filter must not touch source: ${JSON.stringify(call.body)}`);
    }
  });

  test("arguments are validated BEFORE any request: empty sourceId / keepDocVersion, a bad keepChunkCount", async () => {
    const stub = routedFetch({});
    await withFetch(stub, async () => {
      for (const [s, v, opts] of [
        ["", V, {}],
        [null, V, {}],
        [S, "", {}],
        [S, undefined, {}],
        [S, V, { keepChunkCount: -1 }],
        [S, V, { keepChunkCount: 1.5 }],
        [S, V, { keepChunkCount: "87" }],
      ]) {
        await assert.rejects(() => destructive().deleteBySourceExceptVersion(s, v, opts), /deleteBySourceExceptVersion:/, JSON.stringify([s, v, opts]));
      }
      await assert.rejects(() => destructive().deleteBySourceId(""), /deleteBySourceId:/);
      await assert.rejects(() => destructive().deleteBySourceId(42), /deleteBySourceId:/);
    });
    assert.strictEqual(stub.calls.length, 0, "no request may be sent for an invalid argument");
  });

  test("deleteByHash's contract carries over: non-2xx, per-object failures and the result cap are all {ok:false}", async () => {
    const stub = routedFetch({
      "DELETE /v1/batch/objects": [
        { status: 422, body: "validate: invalid where filter" },
        { status: 200, body: { results: { matches: 18, successful: 16, failed: 2, limit: 100000 } } },
        { status: 200, body: { results: { matches: 100000, successful: 100000, failed: 0, limit: 100000 } } },
      ],
    });
    const { result: r } = await silenced(() =>
      withFetch(stub, async () => [
        await destructive().deleteBySourceExceptVersion(S, V, { keepChunkCount: 5 }),
        await destructive().deleteBySourceExceptVersion(S, V, { keepChunkCount: 5 }),
        await destructive().deleteBySourceExceptVersion(S, V),
      ])
    );
    assert.deepStrictEqual(r[0], { ok: false, status: 422, body: "validate: invalid where filter" });
    assert.strictEqual(r[1].ok, false);
    assert.strictEqual(r[1].failed, 2);
    assert.strictEqual(r[1].matches, 18);
    assert.strictEqual(r[2].ok, false);
    assert.strictEqual(r[2].limit, 100000);
  });

  test("a 2xx WITHOUT a results block is {ok:false} on both T06 methods (review §6a) — and still {ok:true} on deleteByHash (T21's pin)", async () => {
    const stub = routedFetch({
      "DELETE /v1/batch/objects": [
        { status: 200, body: "" },
        { status: 204, body: "" },
        { status: 200, body: { unexpected: true } },
        { status: 200, body: "<html>proxy page</html>" },
        { status: 200, body: "" },
      ],
    });
    const { result: r } = await silenced(() =>
      withFetch(stub, async () => [
        await destructive().deleteBySourceExceptVersion(S, V, { keepChunkCount: 5 }),
        await destructive().deleteBySourceId(S),
        await destructive().deleteBySourceId(S),
        await destructive().deleteBySourceExceptVersion(S, V),
        await WeaviateClient.forDestructiveOps(URL, "x", CLS).deleteByHash("h"),
      ])
    );
    assert.deepStrictEqual(r[0], { ok: false, status: 200, body: "" });
    assert.deepStrictEqual(r[1], { ok: false, status: 204, body: "" });
    assert.strictEqual(r[2].ok, false);
    assert.strictEqual(r[3].ok, false);
    assert.match(r[3].body, /proxy page/);
    assert.deepStrictEqual(r[4], { ok: true, status: 200, body: null }, "deleteByHash is unchanged");
  });

  test("the T06 methods send a bounded request; deleteByHash sends none (unchanged)", async () => {
    const seen = [];
    const stub = async (url, opts = {}) => {
      seen.push(opts.signal instanceof AbortSignal);
      return { ok: true, status: 200, text: async () => JSON.stringify({ results: { matches: 1, successful: 1, failed: 0, limit: 100000 } }), json: async () => ({}) };
    };
    await withFetch(stub, async () => {
      await destructive().deleteBySourceExceptVersion(S, V, { keepChunkCount: 1 });
      await destructive().deleteBySourceId(S);
      await WeaviateClient.forDestructiveOps(URL, "x", CLS).deleteByHash("h");
    });
    assert.deepStrictEqual(seen, [true, true, false]);
  });

  test("a network failure throws (the ingest job then fails typed, as for any other throw)", async () => {
    const stub = routedFetch({ "DELETE /v1/batch/objects": [new Error("fetch failed")] });
    await withFetch(stub, async () => {
      await assert.rejects(() => destructive().deleteBySourceExceptVersion(S, V), /fetch failed/);
    });
  });

  test("deleteBySourceId: sourceId Equal alone — every version at that path, whatever is on disk", async () => {
    const stub = routedFetch({ "DELETE /v1/batch/objects": [ok(89)] });
    const result = await withFetch(stub, () => destructive().deleteBySourceId(S));
    assert.deepStrictEqual(stub.calls[0].body, { match: { class: CLS, where: { path: ["sourceId"], operator: "Equal", valueText: S } } });
    assert.strictEqual(result.matches, 89);
  });

  test("a plain (read/write) client is refused before any request — both methods and the shared helper", async () => {
    const stub = routedFetch({});
    await withFetch(stub, async () => {
      for (const fn of [
        () => plain({ schemaVersion: 2 }).deleteBySourceExceptVersion(S, V, { keepChunkCount: 1 }),
        () => plain({ schemaVersion: 2 }).deleteBySourceId(S),
        () => plain().batchDeleteWhere({ path: ["sourceId"], operator: "Equal", valueText: S }, "x"),
      ]) {
        await assert.rejects(fn, (err) => err.code === "COLLECTION_REQUIRED");
      }
    });
    assert.strictEqual(stub.calls.length, 0);
  });

  test("deleteByHash is unchanged by the refactor: the same three payload/return shapes as U-DESTRUCT/D4 pins", async () => {
    const stub = routedFetch({ "DELETE /v1/batch/objects": [ok(12), { status: 422, body: "bad where" }] });
    const c = WeaviateClient.forDestructiveOps(URL, "x", CLS);
    const { result: r } = await silenced(() => withFetch(stub, async () => [await c.deleteByHash("h"), await c.deleteByHash("h")]));
    assert.deepStrictEqual(stub.calls[0].body, { match: { class: CLS, where: { path: ["docHash"], operator: "Equal", valueText: "h" } } });
    assert.deepStrictEqual(r[0], { ok: true, status: 200, body: null, matches: 12, failed: 0 });
    assert.deepStrictEqual(r[1], { ok: false, status: 422, body: "bad where" });
  });
});

describe("U-SCHEMA/T07: lastEnsureSchema says whether the class was created; countIdentity reads count and highest chunkIndex honestly", () => {
  test("ensureSchema records existed / created / raced on each of its three success paths", async () => {
    let stub = routedFetch({ [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v1Names) }] });
    let c = plain();
    await withFetch(stub, () => c.ensureSchema());
    assert.deepStrictEqual(c.lastEnsureSchema, { existed: true, created: false, raced: false });

    stub = routedFetch({ [`GET /v1/schema/${CLS}`]: [{ status: 404, body: {} }], "POST /v1/schema": [{ status: 200, body: {} }] });
    c = plain();
    await withFetch(stub, () => c.ensureSchema());
    assert.deepStrictEqual(c.lastEnsureSchema, { existed: false, created: true, raced: false }, "the ingest route writes collection_created from this");

    stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 404, body: {} }, { status: 200, body: schemaBody(v1Names) }],
      "POST /v1/schema": [{ status: 422, body: { error: [{ message: "class already exists" }] } }],
    });
    c = plain();
    const { result } = await silenced(() => withFetch(stub, () => c.ensureSchema()));
    assert.strictEqual(result, true);
    assert.deepStrictEqual(c.lastEnsureSchema, { existed: true, created: false, raced: true }, "a lost race is not a creation");
    assert.strictEqual(plain().lastEnsureSchema, undefined, "unset until ensureSchema ran");
  });

  test("countIdentity: one Aggregate with both identity operands, meta.count and chunkIndex { count maximum }", async () => {
    const stub = routedFetch({
      "POST /v1/graphql": [{ status: 200, body: { data: { Aggregate: { [CLS]: [{ meta: { count: 19 }, chunkIndex: { count: 19, maximum: 18 } }] } } } }],
    });
    const r = await withFetch(stub, () => plain({ schemaVersion: 2 }).countIdentity("demos/x.pdf", "aaaa.111111111111"));
    assert.deepStrictEqual(r, { count: 19, maxChunkIndex: 18 });
    const query = stub.calls[0].body.query;
    assert.match(query, /path: \["sourceId"\], operator: Equal, valueText: "demos\/x\.pdf"/);
    assert.match(query, /path: \["docVersion"\], operator: Equal, valueText: "aaaa\.111111111111"/);
    assert.match(query, /operator: And/);
    assert.match(query, /chunkIndex \{ count maximum \}/);
    assert.match(query, /meta \{ count \}/);
  });

  test("countIdentity: an empty class answers count 0 with a null maximum, never a fabricated index", async () => {
    const stub = routedFetch({
      "POST /v1/graphql": [{ status: 200, body: { data: { Aggregate: { [CLS]: [{ meta: { count: 0 }, chunkIndex: { count: 0, maximum: null } }] } } } }],
    });
    assert.deepStrictEqual(await withFetch(stub, () => plain({ schemaVersion: 2 }).countIdentity("s", "v")), { count: 0, maxChunkIndex: null });
  });

  test("countIdentity: transport failure → null (unknown, re-index); GraphQL errors, a non-JSON 200 or a missing count → throw (T03 D1's contract)", async () => {
    const { result: down } = await silenced(() => withFetch(routedFetch({ "POST /v1/graphql": [{ status: 503, body: "down" }] }), () => plain({ schemaVersion: 2 }).countIdentity("s", "v")));
    assert.strictEqual(down, null);
    const { result: thrown } = await silenced(() => withFetch(routedFetch({ "POST /v1/graphql": [new Error("fetch failed")] }), () => plain({ schemaVersion: 2 }).countIdentity("s", "v")));
    assert.strictEqual(thrown, null);
    await assert.rejects(
      withFetch(routedFetch({ "POST /v1/graphql": [{ status: 200, body: { errors: [{ message: "Cannot query field chunkIndex" }] } }] }), () => plain({ schemaVersion: 2 }).countIdentity("s", "v")),
      /Cannot query field chunkIndex/
    );
    await assert.rejects(
      withFetch(routedFetch({ "POST /v1/graphql": [{ status: 200, body: "<html>proxy</html>" }] }), () => plain({ schemaVersion: 2 }).countIdentity("s", "v")),
      /non-JSON 200/
    );
    await assert.rejects(
      withFetch(routedFetch({ "POST /v1/graphql": [{ status: 200, body: { data: { Aggregate: { [CLS]: null } } } }] }), () => plain({ schemaVersion: 2 }).countIdentity("s", "v")),
      /no meta\.count/
    );
  });
});

describe("U-SCHEMA/T40: the keyword half names its properties (t40-design.md D2, D4, D5; audit E23)", () => {
  const { SEARCHABLE_V1_PROPERTIES, RETRIEVAL_DEFAULTS } = require("../../src/lib/rag/config");
  const args = (stub, i) => stub.calls[i].body.query.replace(/\s+/g, " ").match(/\(\s*(.*?)\s*limit:/)[1];
  const threeModes = (names, options) => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(names) }],
      "POST /v1/graphql": [{ status: 200, body: getBody([row()]) }, { status: 200, body: getBody([row()]) }, { status: 200, body: getBody([row()]) }],
    });
    return withFetch(stub, async () => {
      const c = plain();
      const k = await c.searchFiltered("q", null, "keyword", 5, 0, 0.5, null, options);
      const v = await c.searchFiltered("q", [0.1], "vector", 5, 0, 0.5, null, options);
      const h = await c.searchFiltered("q", [0.1], "hybrid", 5, 0, 0.5, null, options);
      return { stub, k, v, h };
    });
  };

  test("the default: `properties: [\"text\"]` on the bm25 clause and on the hybrid clause; nothing on nearVector", async () => {
    const { stub, k, v, h } = await threeModes(v1Names, undefined);
    assert.strictEqual(args(stub, 1), 'bm25: { query: "q" properties: ["text"] }');
    assert.strictEqual(args(stub, 2), "nearVector: { vector: [0.1] }");
    assert.strictEqual(args(stub, 3), 'hybrid: { query: "q" vector: [0.1] alpha: 0.5 properties: ["text"] }');
    assert.deepStrictEqual([k.mode, v.mode, h.mode], ["keyword", "vector", "hybrid"]);
    assert.deepStrictEqual([k.searchProperties, v.searchProperties, h.searchProperties], [["text"], null, ["text"]], "what was sent: the list for the two keyword-bearing modes, null where no keyword half ran");
    assert.deepStrictEqual([...RETRIEVAL_DEFAULTS.searchProperties], ["text"]);
  });

  test("`searchProperties: null` (unrestricted) sends no clause — the pre-T40 query byte for byte — and says so", async () => {
    const { stub, k, h } = await threeModes(v1Names, { searchProperties: null });
    assert.strictEqual(args(stub, 1), 'bm25: { query: "q" }');
    assert.strictEqual(args(stub, 3), 'hybrid: { query: "q" vector: [0.1] alpha: 0.5 }');
    assert.strictEqual(k.searchProperties, null);
    assert.strictEqual(h.searchProperties, null);
  });

  test("the list is intersected with what THIS class has; a list the class cannot serve falls back to text; order and duplicates are the caller's", async () => {
    // The class shape is cached per (url, class) — cleared before each test, not between these calls — so each
    // sub-case clears it itself and reads the schema afresh.
    const withoutTitles = v1Names.filter((n) => n !== "sectionTitle" && n !== "chapter");
    const a = await threeModes(withoutTitles, { searchProperties: ["sectionTitle", "text", "chapter"] });
    assert.strictEqual(args(a.stub, 1), 'bm25: { query: "q" properties: ["text"] }', "sectionTitle and chapter are not on this class");
    assert.deepStrictEqual(a.k.searchProperties, ["text"]);
    _classPropertyCache.clear();
    const b = await threeModes(withoutTitles, { searchProperties: ["chapter"] });
    assert.strictEqual(args(b.stub, 1), 'bm25: { query: "q" properties: ["text"] }', "an emptied intersection: text, which every class has");
    _classPropertyCache.clear();
    const c = await threeModes(v1Names, { searchProperties: ["sectionTitle", "text", "source"] });
    assert.strictEqual(args(c.stub, 3), 'hybrid: { query: "q" vector: [0.1] alpha: 0.5 properties: ["sectionTitle","text","source"] }', "order kept as given");
    _classPropertyCache.clear();
    const d = await threeModes(v1Names, { searchProperties: [] });
    assert.strictEqual(args(d.stub, 1), 'bm25: { query: "q" properties: ["text"] }', "an empty array is not 'unrestricted'");
  });

  test("search() — the six-argument convenience — passes the option through, and a document filter rides beside the clause", async () => {
    const stub = routedFetch({
      [`GET /v1/schema/${CLS}`]: [{ status: 200, body: schemaBody(v2Names) }],
      "POST /v1/graphql": [{ status: 200, body: getBody([row()]) }, { status: 200, body: getBody([row()]) }],
    });
    await withFetch(stub, async () => {
      const c = plain();
      await c.search("q", null, "keyword", 5, 0, 0.5, { searchProperties: ["text", "source"] });
      await c.searchFiltered("q", [0.1], "hybrid", 5, 0, 0.5, { sourceIds: ["demos/x.pdf"] }, { searchProperties: ["text"] });
    });
    assert.strictEqual(args(stub, 1), 'bm25: { query: "q" properties: ["text","source"] }');
    assert.match(stub.calls[2].body.query, /hybrid: \{ query: "q" vector: \[0\.1\] alpha: 0\.5 properties: \["text"\] \}/);
    assert.match(stub.calls[2].body.query, /where: \{ path: \["sourceId"\], operator: Equal, valueText: "demos\/x\.pdf" \}/);
  });

  test("buildSearchQuery: an array is written as given, null or an empty list writes no clause, vector mode never carries one", () => {
    const c = plain();
    assert.match(c.buildSearchQuery("q", null, "keyword", 5, 0.5, [], null, ["text", "metadata"]).query, /bm25: \{ query: "q" properties: \["text","metadata"\] \}/);
    assert.doesNotMatch(c.buildSearchQuery("q", null, "keyword", 5, 0.5, [], null, null).query, /properties/);
    assert.doesNotMatch(c.buildSearchQuery("q", null, "keyword", 5, 0.5, [], null, []).query, /properties/);
    const vec = c.buildSearchQuery("q", [0.2], "vector", 5, 0.5, [], null, ["text"]);
    assert.doesNotMatch(vec.query, /properties/);
    assert.strictEqual(vec.searchProperties, null);
    assert.deepStrictEqual(c.buildSearchQuery("q", [0.2], "hybrid", 5, 0.5, [], null, ["text"]).searchProperties, ["text"]);
  });

  test("the searchable set the resolver sanitises against IS the v1 class's text-typed columns, in order (one list, two homes)", () => {
    const textTyped = V1_PROPERTIES.filter((p) => p.dataType[0] === "text").map((p) => p.name);
    assert.deepStrictEqual([...SEARCHABLE_V1_PROPERTIES], textTyped);
    assert.strictEqual(textTyped.length, 9);
  });
});
