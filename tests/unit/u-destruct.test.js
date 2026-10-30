/**
 * U-DESTRUCT — destructive operations name their target or do not run
 * (ticket T21; finding F-15; audit E38 / FM-V2).
 *
 * Measured in-pod on `main` (b4fb7d2, 2026-09-03) before this ticket:
 *
 *   new WeaviateClient(url, tok, v).className  ===  "RAGChunk"
 *     for EVERY v in [null, undefined, "", "   ", "!!!", 42]
 *
 *   POST /api/ingest/clear {weaviateUrl:<dead port>}   (no weaviateCollection)
 *     → pod log: [Weaviate Store Purge] Purging collection class 'RAGChunk'...
 *     → HTTP 500 {"error":"fetch failed"}            (untyped)
 *
 * So a destructive request that named nothing was silently retargeted at the
 * production class, and the "Shared DB Safety Guard" (a non-empty-string check
 * that the sanitiser had just satisfied) could never fire. Two unconfirmed UI
 * clicks dropped the class.
 *
 * The rule is PER-ROUTE (owner, session 5): `POST /api/ingest` KEEPS its
 * "RAGChunk" default — an unspecified write landing in the demo's own
 * collection is intended. Only the destructive paths refuse to default. These
 * cases pin both halves: that the destructive paths refuse, and that the read
 * and write paths are unchanged.
 *
 * Pure-function and source-level tests: no live service. The live half is
 * I-DESTRUCT. The confirmation DIALOG's rendering is not verifiable here
 * (F-37 — no component harness); its wiring is pinned structurally below, the
 * same recorded compromise T12, T14 and T10 made.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { WeaviateClient, canonicalClassName, isExplicitClassName, connectionRefused } = require("../../src/lib/vectordb/weaviate");
const { INGEST_ERROR_CODES } = require("../../src/lib/ingestion/state");
const { destructiveRefusal, thrownRefusal } = require("../../src/lib/ingestion/destructive");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(REPO_ROOT, "src");
const FILES = {
  weaviate: path.join(SRC, "lib", "vectordb", "weaviate.js"),
  clear: path.join(SRC, "app", "api", "ingest", "clear", "route.js"),
  preview: path.join(SRC, "app", "api", "ingest", "clear", "preview", "route.js"),
  unload: path.join(SRC, "app", "api", "ingest", "unload", "route.js"),
  ingest: path.join(SRC, "app", "api", "ingest", "route.js"),
  retrieve: path.join(SRC, "app", "api", "rag", "retrieve", "route.js"),
  orchestrator: path.join(SRC, "lib", "orchestrator.js"),
  page: path.join(SRC, "app", "page.js"),
  drawer: path.join(SRC, "components", "StandardsDrawer.jsx"),
};

const DEAD = "http://127.0.0.1:9";

/**
 * Every method that can delete data, by name. T06 added two (supersede and
 * unload-by-sourceId) plus the shared helper; a new destructive method that
 * is not listed here is invisible to the walks below, so add it here first.
 */
const DESTRUCTIVE_METHODS = ["clearSchema", "deleteByHash", "deleteBySourceExceptVersion", "deleteBySourceId", "batchDeleteWhere"];
const DESTRUCTIVE_CALL = new RegExp(DESTRUCTIVE_METHODS.map((m) => `\\.${m}\\(`).join("|"));
const DESTRUCTIVE_USE = new RegExp(["forDestructiveOps"].concat(DESTRUCTIVE_METHODS.map((m) => `${m}\\(`)).join("|"));

/** Strip comments so a pin is satisfied by code, never by prose about code. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function read(file) {
  return codeOnly(fs.readFileSync(file, "utf-8"));
}

/** Every file under src/ (recursively) — for whole-tree walks. */
function walkSrc(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSrc(full, out);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Minimal fetch stub: a queue of responses, and a log of what was asked. */
function fetchStub(responses) {
  const calls = [];
  const stub = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", body: opts.body });
    const next = responses.shift();
    if (!next) throw new Error(`fetch stub exhausted at ${opts.method || "GET"} ${url}`);
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

const LAUNDERED_INPUTS = [null, undefined, "", "   ", "!!!", 42];

describe("U-DESTRUCT/F-15: the destructive factory refuses to default", () => {
  test("every input the old constructor laundered into RAGChunk is refused, typed", () => {
    for (const v of LAUNDERED_INPUTS) {
      assert.throws(
        () => WeaviateClient.forDestructiveOps(DEAD, "x", v),
        (err) => err.code === INGEST_ERROR_CODES.COLLECTION_REQUIRED,
        `forDestructiveOps accepted ${JSON.stringify(v)} — the F-15 laundering path is open`
      );
    }
  });

  test("a name the sanitiser would CHANGE is refused — explicit means exact", () => {
    // Each of these silently became a different class before T21. "1abc" and
    // "_x" survive the sanitiser but are not Weaviate class names (must start
    // with an uppercase letter) — refused here so they 400 instead of failing
    // confusingly at create time.
    for (const v of ["ragEval_x", " RAGChunk", "RAGChunk ", "my collection", "RAG-Chunk", "1abc", "_x"]) {
      assert.throws(
        () => WeaviateClient.forDestructiveOps(DEAD, "x", v),
        (err) => err.code === INGEST_ERROR_CODES.COLLECTION_REQUIRED,
        `forDestructiveOps accepted ${JSON.stringify(v)}, which sanitises to ${JSON.stringify(canonicalClassName(v))}`
      );
    }
  });

  test("an exact name is accepted and marks the client destructive", () => {
    for (const v of ["RAGChunk", "RAGEval_t08_20260813", "RAGEval_abc_123"]) {
      const client = WeaviateClient.forDestructiveOps(DEAD, "x", v);
      assert.strictEqual(client.className, v);
      assert.strictEqual(client.destructive, true);
    }
  });

  test("isExplicitClassName is the same predicate the routes and the factory share", () => {
    for (const v of LAUNDERED_INPUTS) assert.strictEqual(isExplicitClassName(v), false, JSON.stringify(v));
    assert.strictEqual(isExplicitClassName("ragEval_x"), false);
    assert.strictEqual(isExplicitClassName("RAGChunk"), true);
    assert.strictEqual(isExplicitClassName("RAGEval_x"), true);
  });
});

describe("U-DESTRUCT/D2: the READ/WRITE constructor is unchanged", () => {
  // Pinned deliberately (owner decision, T21 D2): the retrieve route, the
  // orchestrator's summary and the ingest writes all rely on this. The
  // read-path retargeting of a garbage name to RAGChunk is FILED, not fixed.
  test("null / empty / garbage still resolve to RAGChunk on the plain path", () => {
    for (const v of LAUNDERED_INPUTS) {
      assert.strictEqual(new WeaviateClient(DEAD, "x", v).className, "RAGChunk", JSON.stringify(v));
      assert.strictEqual(canonicalClassName(v), "RAGChunk");
    }
  });

  test("the plain path still sanitises (strip non-identifier chars, capitalise)", () => {
    assert.strictEqual(new WeaviateClient(DEAD, "x", "ragEval_x").className, "RagEval_x");
    assert.strictEqual(new WeaviateClient(DEAD, "x", " RAGChunk ").className, "RAGChunk");
    assert.strictEqual(new WeaviateClient(DEAD, "x", "my collection").className, "Mycollection");
  });

  test("a plain client is not destructive", () => {
    assert.strictEqual(new WeaviateClient(DEAD, "x", "RAGEval_x").destructive, false);
  });
});

describe("U-DESTRUCT/D1: a plain client cannot drop or delete", () => {
  test("clearSchema on a plain client throws before any request is made", async () => {
    const stub = fetchStub([]);
    await withFetch(stub, async () => {
      await assert.rejects(
        () => new WeaviateClient(DEAD, "x", "RAGEval_x").clearSchema(),
        (err) => err.code === INGEST_ERROR_CODES.COLLECTION_REQUIRED
      );
    });
    assert.strictEqual(stub.calls.length, 0, "the gate must fire before the DELETE");
  });

  test("deleteByHash on a plain client throws before any request is made", async () => {
    const stub = fetchStub([]);
    await withFetch(stub, async () => {
      await assert.rejects(
        () => new WeaviateClient(DEAD, "x", "RAGEval_x").deleteByHash("abc"),
        (err) => err.code === INGEST_ERROR_CODES.COLLECTION_REQUIRED
      );
    });
    assert.strictEqual(stub.calls.length, 0);
  });

  test("T06: deleteBySourceExceptVersion, deleteBySourceId and the shared helper refuse a plain client before any request", async () => {
    const stub = fetchStub([]);
    await withFetch(stub, async () => {
      const c = new WeaviateClient(DEAD, "x", "RAGEval_x", { schemaVersion: 2 });
      await assert.rejects(() => c.deleteBySourceExceptVersion("a/b.pdf", "h.f", { keepChunkCount: 1 }), (err) => err.code === INGEST_ERROR_CODES.COLLECTION_REQUIRED);
      await assert.rejects(() => c.deleteBySourceId("a/b.pdf"), (err) => err.code === INGEST_ERROR_CODES.COLLECTION_REQUIRED);
      await assert.rejects(() => c.batchDeleteWhere({ path: ["sourceId"], operator: "Equal", valueText: "a/b.pdf" }, "x"), (err) => err.code === INGEST_ERROR_CODES.COLLECTION_REQUIRED);
    });
    assert.strictEqual(stub.calls.length, 0);
  });

  test("every destructive method the client has is in DESTRUCTIVE_METHODS (so the walks cannot go stale)", () => {
    const src = read(FILES.weaviate);
    const gated = [...src.matchAll(/this\.assertDestructiveClient\("([A-Za-z]+)"\)/g)].map((m) => m[1]);
    assert.ok(gated.length >= 5, `expected the gate at five sites, found ${gated.length}`);
    for (const name of gated) assert.ok(DESTRUCTIVE_METHODS.includes(name), `${name} is gated in weaviate.js but not listed for the source walks`);
    for (const name of DESTRUCTIVE_METHODS) assert.ok(gated.includes(name), `${name} is listed but not gated by assertDestructiveClient`);
  });

  test("the old false guard is gone from the tree", () => {
    for (const file of walkSrc()) {
      assert.ok(
        !read(file).includes("assertTargetClass"),
        `${path.relative(REPO_ROOT, file)} still references assertTargetClass — a non-empty-string check whose message claimed to protect the shared database (F-15)`
      );
    }
  });
});

describe("U-DESTRUCT/D7: clearSchema surfaces failure instead of recreating over it", () => {
  const url = "http://weaviate.test";
  const client = () => WeaviateClient.forDestructiveOps(url, "x", "RAGEval_x");
  const GET = `GET ${url}/v1/schema/RAGEval_x`;
  const DEL = `DELETE ${url}/v1/schema/RAGEval_x`;
  const CREATE = `POST ${url}/v1/schema`;
  const trace = (stub) => stub.calls.map((c) => `${c.method} ${c.url}`);

  test("existing class: GET 200 → DELETE 200 → recreated; dropped:true", async () => {
    // Existence comes from GET, not from the DELETE status: Weaviate's DELETE
    // is idempotent (200 for an absent class on current builds, 400 on old
    // ones), so it cannot say whether anything was dropped.
    const stub = fetchStub([{ status: 200 }, { status: 200 }, { status: 404 }, { status: 200 }]);
    const result = await withFetch(stub, () => client().clearSchema());
    assert.deepStrictEqual(result, { dropped: true, recreated: true });
    assert.deepStrictEqual(trace(stub), [GET, DEL, GET, CREATE]);
  });

  test("absent class: GET 404 → no DELETE sent → created; dropped:false", async () => {
    const stub = fetchStub([{ status: 404 }, { status: 404 }, { status: 200 }]);
    const result = await withFetch(stub, () => client().clearSchema());
    assert.deepStrictEqual(result, { dropped: false, recreated: true });
    assert.deepStrictEqual(trace(stub), [GET, GET, CREATE]);
    assert.ok(!stub.calls.some((c) => c.method === "DELETE"), "nothing to drop, so no DELETE");
  });

  test("existence check unreachable → typed throw, 'Nothing was dropped', no DELETE", async () => {
    const stub = fetchStub([Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } })]);
    await withFetch(stub, async () => {
      await assert.rejects(
        () => client().clearSchema(),
        (err) => err.code === INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED && /Nothing was dropped/.test(err.message)
      );
    });
    assert.strictEqual(stub.calls.length, 1);
  });

  test("existence check answers 500 → typed throw, nothing dropped", async () => {
    const stub = fetchStub([{ status: 500, body: "boom" }]);
    await withFetch(stub, async () => {
      await assert.rejects(
        () => client().clearSchema(),
        (err) => err.code === INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED && /Nothing was dropped/.test(err.message)
      );
    });
    assert.strictEqual(stub.calls.length, 1);
  });

  test("DELETE refused (500) → typed throw, and the class is NOT recreated", async () => {
    // Pre-T21: console.warn, then ensureSchema() ran and the route reported
    // "reset successfully" over a class that was never dropped.
    const stub = fetchStub([{ status: 200 }, { status: 500, body: "shard locked" }]);
    await withFetch(stub, async () => {
      await assert.rejects(
        () => client().clearSchema(),
        (err) =>
          err.code === INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED &&
          /shard locked/.test(err.message) &&
          /was not dropped and was not recreated/.test(err.message)
      );
    });
    assert.deepStrictEqual(trace(stub), [GET, DEL], "no recreate after a failed drop");
  });

  test("DELETE connection refused → 'not dropped' is claimed (the request never left)", async () => {
    const stub = fetchStub([{ status: 200 }, Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } })]);
    await withFetch(stub, async () => {
      await assert.rejects(
        () => client().clearSchema(),
        (err) => err.code === INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED && /was not dropped and was not recreated/.test(err.message)
      );
    });
    assert.deepStrictEqual(trace(stub), [GET, DEL]);
  });

  test("DELETE sent but the reply never came → 'may or may not', never 'not dropped'", async () => {
    // A reset or timeout after the request was sent: Weaviate may have done it.
    const stub = fetchStub([{ status: 200 }, new Error("The operation was aborted due to timeout")]);
    await withFetch(stub, async () => {
      await assert.rejects(
        () => client().clearSchema(),
        (err) =>
          err.code === INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED &&
          /may or may not have been dropped/.test(err.message) &&
          !/was not dropped/.test(err.message)
      );
    });
  });

  test("dropped but NOT recreated → the error says so and carries completed:['drop'] (F-25)", async () => {
    // The T10-review pattern: a result computed inside the try that describes
    // it. A class that is gone must never be reported as "nothing happened".
    const stub = fetchStub([{ status: 200 }, { status: 200 }, { status: 404 }, { status: 500, body: "nope" }]);
    await withFetch(stub, async () => {
      await assert.rejects(
        () => client().clearSchema(),
        (err) =>
          err.code === INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED &&
          /WAS dropped but could not be recreated/.test(err.message) &&
          Array.isArray(err.completed) &&
          err.completed.includes("drop")
      );
    });
  });

  test("connectionRefused recognises only errors that prove the request never left", () => {
    assert.strictEqual(connectionRefused(Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } })), true);
    assert.strictEqual(connectionRefused(Object.assign(new Error("x"), { cause: { code: "ENOTFOUND" } })), true);
    assert.strictEqual(connectionRefused(Object.assign(new Error("x"), { cause: { code: "ECONNRESET" } })), false);
    assert.strictEqual(connectionRefused(new Error("timeout")), false);
  });
});

describe("U-DESTRUCT/D4: deleteByHash reports instead of swallowing", () => {
  const client = () => WeaviateClient.forDestructiveOps("http://weaviate.test", "x", "RAGEval_x");

  test("a 2xx with a clean result body is {ok:true} carrying the match count", async () => {
    const body = { results: { matches: 12, successful: 12, failed: 0, limit: 10000 } };
    const result = await withFetch(fetchStub([{ status: 200, body }]), () => client().deleteByHash("h"));
    assert.deepStrictEqual(result, { ok: true, status: 200, body: null, matches: 12, failed: 0 });
  });

  test("a 2xx with per-object failures inside it is {ok:false} — a 200 is not 'all deleted'", async () => {
    const body = { results: { matches: 12, successful: 10, failed: 2, limit: 10000 } };
    const result = await withFetch(fetchStub([{ status: 200, body }]), () => client().deleteByHash("h"));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failed, 2);
  });

  test("a 2xx that hit Weaviate's result cap is {ok:false} — more may remain", async () => {
    const body = { results: { matches: 10000, successful: 10000, failed: 0, limit: 10000 } };
    const result = await withFetch(fetchStub([{ status: 200, body }]), () => client().deleteByHash("h"));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.limit, 10000);
  });

  test("a bodyless 2xx (older server) is {ok:true}", async () => {
    const result = await withFetch(fetchStub([{ status: 200, body: "" }]), () => client().deleteByHash("h"));
    assert.deepStrictEqual(result, { ok: true, status: 200, body: null });
  });

  test("a refusal is {ok:false} carrying the status and body — never undefined", async () => {
    const result = await withFetch(fetchStub([{ status: 422, body: "bad where" }]), () =>
      client().deleteByHash("h")
    );
    assert.deepStrictEqual(result, { ok: false, status: 422, body: "bad where" });
  });

  test("a network failure still throws (ingest's behaviour on that path is unchanged)", async () => {
    await withFetch(fetchStub([new Error("fetch failed")]), async () => {
      await assert.rejects(() => client().deleteByHash("h"), /fetch failed/);
    });
  });
});

describe("U-DESTRUCT/D3: countObjects is honest or throws — never a fabricated 0", () => {
  const client = () => new WeaviateClient("http://weaviate.test", "x", "RAGEval_x");

  test("returns Aggregate meta.count", async () => {
    const stub = fetchStub([{ status: 200, body: { data: { Aggregate: { RAGEval_x: [{ meta: { count: 102 } }] } } } }]);
    assert.strictEqual(await withFetch(stub, () => client().countObjects()), 102);
  });

  test("a GraphQL error inside an HTTP 200 throws (F-19's mechanism)", async () => {
    const stub = fetchStub([{ status: 200, body: { errors: [{ message: "Cannot query field" }] } }]);
    await withFetch(stub, async () => {
      await assert.rejects(() => client().countObjects(), /Cannot query field/);
    });
  });

  test("a non-2xx throws", async () => {
    await withFetch(fetchStub([{ status: 503, body: "down" }]), async () => {
      await assert.rejects(() => client().countObjects(), /down/);
    });
  });

  test("a 200 without meta.count throws rather than inventing 0", async () => {
    // A proxy page, a rewritten body, a null class: none of them is Weaviate
    // saying "zero", and the dialog would render 0 as "this drop is harmless".
    await withFetch(fetchStub([{ status: 200, body: { data: { Aggregate: { RAGEval_x: null } } } }]), async () => {
      await assert.rejects(() => client().countObjects(), /no meta\.count/);
    });
    await withFetch(fetchStub([{ status: 200, body: { hello: "world" } }]), async () => {
      await assert.rejects(() => client().countObjects(), /no meta\.count/);
    });
  });
});

describe("U-DESTRUCT/D5: the request validator and the typed codes", () => {
  test("the three T21 codes live with the ingest taxonomy (one owner per domain)", () => {
    for (const code of ["COLLECTION_REQUIRED", "DESTRUCTIVE_OP_FAILED", "FILE_NOT_FOUND"]) {
      assert.strictEqual(INGEST_ERROR_CODES[code], code);
    }
    // And T12's are untouched.
    for (const code of ["INGEST_IN_PROGRESS", "JOB_NOT_FOUND", "INGEST_CONFIG_MISSING", "INGEST_FAILED"]) {
      assert.strictEqual(INGEST_ERROR_CODES[code], code);
    }
  });

  test("no weaviateUrl → 400 INGEST_CONFIG_MISSING (the previously untyped 400)", () => {
    const r = destructiveRefusal({ weaviateCollection: "RAGEval_x" });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.code, INGEST_ERROR_CODES.INGEST_CONFIG_MISSING);
    assert.match(r.error, /weaviateUrl/);
  });

  test("unload's extra required key is reported under the same code", () => {
    const r = destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_x" }, ["filePath"]);
    assert.strictEqual(r.code, INGEST_ERROR_CODES.INGEST_CONFIG_MISSING);
    assert.match(r.error, /filePath/);
  });

  test("no collection → 400 COLLECTION_REQUIRED, and the message says nothing is targeted by default", () => {
    for (const v of LAUNDERED_INPUTS) {
      const r = destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: v });
      assert.strictEqual(r?.status, 400, JSON.stringify(v));
      assert.strictEqual(r.code, INGEST_ERROR_CODES.COLLECTION_REQUIRED);
      assert.match(r.error, /never target a collection by default/);
    }
  });

  test("a non-exact name is refused at the route too", () => {
    const r = destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "ragchunk" });
    assert.strictEqual(r.code, INGEST_ERROR_CODES.COLLECTION_REQUIRED);
  });

  test("an explicit request proceeds", () => {
    assert.strictEqual(destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_x" }), null);
  });

  test("a malformed or wrongly typed request is a 400, never a 'failed destructive op'", () => {
    // Review finding: req.json() throwing, weaviateUrl: 42 (url.endsWith
    // TypeError) and filePath: 42 (filePath.replace TypeError) all used to
    // surface as 500 DESTRUCTIVE_OP_FAILED — telling the caller to retry
    // something Weaviate never saw.
    for (const body of [null, undefined, "x", [], 42]) {
      const r = destructiveRefusal(body);
      assert.strictEqual(r?.status, 400, JSON.stringify(body));
      assert.strictEqual(r.code, INGEST_ERROR_CODES.INGEST_CONFIG_MISSING);
    }
    assert.strictEqual(destructiveRefusal({ weaviateUrl: 42, weaviateCollection: "RAGEval_x" })?.code, INGEST_ERROR_CODES.INGEST_CONFIG_MISSING);
    assert.strictEqual(
      destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_x", filePath: 42 }, ["filePath"])?.code,
      INGEST_ERROR_CODES.INGEST_CONFIG_MISSING
    );
  });

  // T17 (design D12; F-79 / F-80): two refusals on the RAW body, before any
  // version is resolved. A destructive route never guesses.
  test("T17/F-79: a PRESENT schemaVersion that is not 1 / \"1\" / 2 / \"2\" → 400 SCHEMA_VERSION_INVALID, top-level or in ragSettings; absent proceeds", () => {
    for (const v of ["two", "v2", 0, 3, true, "", {}, [], NaN]) {
      const top = destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_x", schemaVersion: v });
      assert.strictEqual(top?.status, 400, JSON.stringify(v));
      assert.strictEqual(top.code, INGEST_ERROR_CODES.SCHEMA_VERSION_INVALID);
      assert.match(top.error, /Nothing was dropped/);
      const nested = destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_x", ragSettings: { schemaVersion: v } });
      assert.strictEqual(nested?.code, INGEST_ERROR_CODES.SCHEMA_VERSION_INVALID, JSON.stringify(v));
    }
    for (const v of [1, "1", 2, "2"]) {
      assert.strictEqual(destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_x", schemaVersion: v }), null, JSON.stringify(v));
    }
    assert.strictEqual(destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_x", schemaVersion: null }), null, "null is absent");
    // Top-level wins over ragSettings for the CHECK too (the same two places resolveSchemaVersion reads).
    assert.strictEqual(destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_x", schemaVersion: 2, ragSettings: { schemaVersion: "junk" } }), null);
  });

  test("T17/F-80: a collection name ending in the V2 suffix → 400 COLLECTION_NAME_INVALID, whatever the version", () => {
    for (const body of [
      { weaviateCollection: "RAGChunkV2" },
      { weaviateCollection: "RAGChunkV2", schemaVersion: 2 },
      { weaviateCollection: "RAGChunkV2", schemaVersion: 1 },
      { weaviateCollection: "RAGEval_xV2" },
    ]) {
      const r = destructiveRefusal({ weaviateUrl: DEAD, ...body });
      assert.strictEqual(r?.status, 400, JSON.stringify(body));
      assert.strictEqual(r.code, INGEST_ERROR_CODES.COLLECTION_NAME_INVALID);
      assert.match(r.error, /base collection/);
      assert.match(r.error, /Nothing was dropped/);
    }
    // The base name proceeds; a name merely CONTAINING V2 is fine.
    assert.strictEqual(destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_xV2y" }), null);
  });

  test("T17: the order of the refusals — a malformed body, then the VERSION (unload's required key depends on it), then the url / required keys, the explicit-name rule, the suffix", () => {
    assert.strictEqual(destructiveRefusal({ weaviateCollection: "RAGChunkV2", schemaVersion: "junk" }).code, INGEST_ERROR_CODES.SCHEMA_VERSION_INVALID);
    // Measured live before the reorder (§11a A3): unload resolved 3 → v1
    // first, demanded filePath, and answered INGEST_CONFIG_MISSING.
    assert.strictEqual(destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_x", schemaVersion: 3, sourceId: "a" }, ["filePath"]).code, INGEST_ERROR_CODES.SCHEMA_VERSION_INVALID);
    assert.strictEqual(destructiveRefusal({ weaviateCollection: "RAGChunkV2" }).code, INGEST_ERROR_CODES.INGEST_CONFIG_MISSING);
    assert.strictEqual(destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: " x" }).code, INGEST_ERROR_CODES.COLLECTION_REQUIRED);
    assert.strictEqual(destructiveRefusal({ weaviateUrl: DEAD, weaviateCollection: "RAGEval_xV2" }).code, INGEST_ERROR_CODES.COLLECTION_NAME_INVALID);
  });

  test("T17: the two codes live with the ingest taxonomy and thrownRefusal maps them to 400", () => {
    for (const code of ["SCHEMA_VERSION_INVALID", "COLLECTION_NAME_INVALID"]) {
      assert.strictEqual(INGEST_ERROR_CODES[code], code);
      const err = Object.assign(new Error("x"), { code });
      assert.strictEqual(thrownRefusal(err).status, 400);
      assert.strictEqual(thrownRefusal(err).code, code);
    }
  });

  test("a thrown factory refusal maps to 400; anything else is a 500 DESTRUCTIVE_OP_FAILED", () => {
    let thrown;
    try {
      WeaviateClient.forDestructiveOps(DEAD, "x", null);
    } catch (err) {
      thrown = err;
    }
    assert.deepStrictEqual(thrownRefusal(thrown).status, 400);
    assert.strictEqual(thrownRefusal(thrown).code, INGEST_ERROR_CODES.COLLECTION_REQUIRED);

    const other = thrownRefusal(new Error("fetch failed"));
    assert.strictEqual(other.status, 500);
    assert.strictEqual(other.code, INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED);
    assert.strictEqual(other.error, "fetch failed");
  });
});

describe("U-DESTRUCT source walk: the per-route rule is applied per route", () => {
  test("clear, unload and ingest build their client through the destructive factory", () => {
    for (const key of ["clear", "unload", "ingest"]) {
      assert.match(read(FILES[key]), /WeaviateClient\.forDestructiveOps\(/, `${key} route`);
    }
  });

  test("the destructive routes carry no collection default and refuse before constructing anything", () => {
    for (const key of ["clear", "unload", "preview"]) {
      const src = read(FILES[key]);
      // No literal at all — not `|| "RAGChunk"`, not `?? 'RAGChunk'`, nothing.
      assert.ok(!/\bRAGChunk\b/.test(src), `${key} route names the production class`);
      assert.match(
        src,
        /const refusal = destructiveRefusal\(body[^)]*\);\s*if \(refusal\)/,
        `${key} route must validate through the shared helper AND act on the result`
      );
      const refuseAt = src.indexOf("destructiveRefusal(body");
      const buildAt = src.search(/WeaviateClient\.forDestructiveOps\(|new WeaviateClient\(/);
      assert.ok(refuseAt > -1 && buildAt > refuseAt, `${key} route must refuse before it builds a client`);
    }
  });

  test("the preview route is read-only: plain constructor, no destructive call", () => {
    const src = read(FILES.preview);
    assert.match(src, /new WeaviateClient\(/);
    assert.ok(!DESTRUCTIVE_USE.test(src), "preview must not be able to drop");
  });

  test("POST /api/ingest KEEPS its RAGChunk default (owner decision, session 5) and canonicalises before the factory", () => {
    const src = read(FILES.ingest);
    assert.match(src, /\|\|\s*"RAGChunk"/, "the write path's default must survive T21 — do not \"fix\" it");
    assert.match(
      src,
      /forDestructiveOps\([^)]*canonicalClassName\(/s,
      "ingest must canonicalise its name before the factory so its class resolution is byte-identical to pre-T21"
    );
  });

  test("the READ path is untouched: retrieve route and orchestrator use the plain constructor", () => {
    for (const key of ["retrieve", "orchestrator"]) {
      const src = read(FILES[key]);
      assert.match(src, /new WeaviateClient\(/, key);
      assert.ok(!DESTRUCTIVE_USE.test(src), `${key} must not gain a destructive call`);
    }
  });

  test("every destructive call site in src/ sits in a file that builds through the factory", () => {
    for (const file of walkSrc()) {
      if (file === FILES.weaviate) continue;
      const src = read(file);
      if (DESTRUCTIVE_CALL.test(src)) {
        assert.match(
          src,
          /forDestructiveOps\(/,
          `${path.relative(REPO_ROOT, file)} calls a destructive method on a client it did not build for destruction`
        );
      }
    }
  });
});

describe("U-DESTRUCT/T06: the v2 write path supersedes AFTER the insert; unload declares v2 before it refuses", () => {
  test("ingest: under v2 no pre-insert deleteByHash remains (the scoped call is gone) and supersede keeps this run's chunk count", () => {
    const src = read(FILES.ingest);
    assert.ok(!/deleteByHash\([^)]*sourceId/.test(src), "the T05 scoped pre-insert delete must not survive T06");
    assert.match(src, /if \(schemaVersion !== 2\) \{\s*await weaviateClient\.deleteByHash\(item\.docHash\);/, "v1 keeps its unscoped pre-insert delete, byte for byte");
    assert.match(src, /deleteBySourceExceptVersion\(\s*item\.sourceId,\s*item\.docVersion,\s*\{ keepChunkCount: chunks\.length \}/s, "supersede keeps exactly the chunks just written (D1)");
    // D2: only after a COMPLETE insert — the guard must read the per-file
    // inserted count and the cancel flag, and the supersede must come after
    // the batch loop, not before it.
    const loopAt = src.indexOf("await Promise.all(slice.map(b => processBatch(b)))");
    const supersedeAt = src.indexOf("deleteBySourceExceptVersion(");
    assert.ok(loopAt > -1 && supersedeAt > -1, "both anchors must exist");
    assert.ok(supersedeAt > loopAt, "supersede runs after the insert loop");
    // D2, made real (T07 review §6a): the partial guard must `continue` past
    // the supersede — the bare presence of the comparison proved nothing.
    const between = src.slice(loopAt, supersedeAt);
    assert.match(between, /if \(inserted !== chunks\.length\) \{[\s\S]{0,900}?continue;\s*\}/, "a partial file must not supersede (D2): the guard continues before the supersede");
    assert.match(between, /if \(fileError\) \{[\s\S]{0,900}?continue;\s*\}/, "a failed file must not supersede");
    // T07 amendment D7b: a cancel that landed after the last batch no longer
    // withholds the supersede (the version is whole; two complete versions
    // was F-61's second variant). T06's withholding branch must be gone.
    assert.ok(!/else if \(job\.cancelled\)/.test(between), "T06's cancel-withholding branch is gone: a complete insert supersedes even when cancelled (T07 D7b)");
    assert.match(src, /if \(job\.cancelled\) \{\s*console\.log\("\[Ingestion\] Processing loop aborted due to cancellation\."\);\s*break;/, "the batch loop still stops between slices on a cancel");
    // The zero-chunk rule (design §2): a parse that yields no chunks must
    // not send keepChunkCount 0, which would delete every previous version.
    const zeroAt = src.indexOf("chunks.length === 0");
    assert.ok(zeroAt > -1 && zeroAt < supersedeAt, "a zero-chunk parse is refused before the supersede");
    // D3: both the refused and the THROWN supersede must rethrow with the
    // same truth — the new version is indexed, the old one(s) remain.
    assert.match(src, /const mixedStore =\s*`The new version of \$\{item\.fileName\} is indexed in/, "the D3 wording exists once");
    // T07 (design D6): a refused or thrown supersede is recorded on the FILE
    // with the D3 wording and makes the job `partial`; it no longer aborts
    // the files after it. Both paths must land on fr.supersedeError.
    assert.match(src, /superseded\.ok === false\)\s*\{[\s\S]{0,200}?fr\.supersedeError =\s*`\$\{mixedStore\}/, "a refused supersede is recorded on the file with the D3 wording (T07 D6)");
    assert.match(src, /catch \(err\)\s*\{[\s\S]{0,200}?superseded = \{ ok: false, thrown: true/, "a THROWN supersede (network, timeout) takes the same recorded path (T07 D6)");
    assert.ok(!/superseded\.ok === false\)\s*\{[\s\S]{0,600}?throw new Error/.test(src), "a refused supersede must not abort the job any more (T07 D6)");
    const indexedAt = src.indexOf('fr.status = "indexed";');
    assert.ok(indexedAt > supersedeAt, "the file is marked indexed after the supersede block");
    assert.match(src.slice(supersedeAt, indexedAt), /event: "file_superseded"[^\n]*ok: false/, "the refusal is in the ledger too (the insert-path site, not only the skip-branch one)");
  });

  test("weaviate.js: every DELETE request lives inside a gated method (a new ungated delete cannot hide)", () => {
    const src = read(FILES.weaviate);
    const deletes = src.match(/method: "DELETE"/g) || [];
    // batchDeleteWhere (the one batch delete) and clearSchema (the schema drop).
    assert.strictEqual(deletes.length, 2, `expected exactly two DELETE requests in weaviate.js, found ${deletes.length} — add the new one to a gated method and to DESTRUCTIVE_METHODS`);
  });

  test("unload: resolves schemaVersion through the one shared function BEFORE the refusal (cut-over D1 / D2), derives sourceId through ids.js, deletes by sourceId on the suffixed class", () => {
    const src = read(FILES.unload);
    const versionAt = src.indexOf("resolveSchemaVersion(body ?? {})");
    const refuseAt = src.indexOf("destructiveRefusal(body");
    assert.ok(versionAt > -1 && versionAt < refuseAt, "the version is declared in the request and read before the refusal (D6)");
    assert.match(src, /const named = hasSourceId \? body\.sourceId : filePath;[\s\S]{0,600}?sourceIdFor\(named\)/, "sourceId is the request's or derived from filePath by the one normaliser (F-57)");
    assert.match(src, /body\.sourceId !== undefined && !hasSourceId/, "a sourceId that is present but not a non-empty string is refused, never silently replaced by filePath (review §6a)");
    assert.match(src, /collectionNameForVersion\(weaviateCollection, schemaVersion\),\s*\{ schemaVersion \}/, "the suffix is applied as ingest applies it, from the resolved version (2 by default since the cut-over)");
    assert.ok(!/normaliseSchemaVersion\(/.test(src), "no second version reader beside the shared function (D1)");
    assert.match(src, /deleteBySourceId\(sourceId\)/);
    // The v1 path is byte-identical: file check, then hash, then deleteByHash.
    assert.match(src, /if \(!fs\.existsSync\(resolved\)\)[\s\S]*FILE_NOT_FOUND[\s\S]*deleteByHash\(docHash\)/);
    assert.ok(src.indexOf("deleteBySourceId(") < src.indexOf("fs.existsSync(resolved)"), "under v2 the file on disk is never consulted (F-55)");
  });
});

describe("U-DESTRUCT/E38: the UI half — what actually changes demo behaviour", () => {
  // The server-side 400 protects OTHER callers: the UI already named its
  // collection since T08, so it would never have fired from the demo. These
  // two pins are the demo-visible change.
  const page = read(FILES.page);
  const drawer = read(FILES.drawer);

  test("session reset no longer calls /api/ingest/clear anywhere in page.js", () => {
    assert.ok(!page.includes("ingest/clear"), "reset must clear chat state only (ticket acceptance criterion)");
  });

  /** A slice between two anchors that must BOTH exist, in order. */
  function between(src, startMarker, endMarker) {
    const start = src.indexOf(startMarker);
    assert.ok(start > -1, `anchor "${startMarker}" moved`);
    const end = src.indexOf(endMarker, start + startMarker.length);
    assert.ok(end > start, `anchor "${endMarker}" moved (a slice without an end would silently widen)`);
    return src.slice(start, end);
  }

  test("session reset leaves the file tray alone (D6)", () => {
    const handler = between(page, "const handleResetState", "const handleGenerateQuery");
    assert.ok(!/setLoadedFiles\(\s*\[\s*\]\s*\)/.test(handler), "reset must not empty the tray over a store it no longer touches");
    assert.ok(!handler.includes("nxs_loadedFiles"), "reset must not clear the persisted tray either");
  });

  test("there is still no window.confirm anywhere — the confirmation is typed", () => {
    for (const file of walkSrc()) {
      assert.ok(!/\bconfirm\(/.test(read(file)), `${path.relative(REPO_ROOT, file)} uses confirm(`);
    }
  });

  test("Tidy Up opens a dialog backed by the read-only preview, not the destructive route", () => {
    const handler = between(drawer, "const handleClearAllFiles", "const closeTidyUp");
    assert.ok(handler.includes('"/api/ingest/clear/preview"'), "the button must fetch the preview");
    assert.ok(!handler.includes('"/api/ingest/clear"'), "the button itself must not be able to drop");
    assert.match(handler, /setTidyUpOpen\(true\)/);
    // Review finding: a dialog that opens with the name pre-filled is no
    // confirmation. The typed field must start empty and be emptied on open.
    assert.match(handler, /setTypedCollection\(""\)/, "opening the dialog must clear the typed name");
  });

  test("the typed field starts empty — the dialog cannot open pre-confirmed", () => {
    assert.match(drawer, /const \[typedCollection, setTypedCollection\] = useState\(""\);/);
  });

  test("the destructive request is reachable only after the typed name matches exactly — the class the PREVIEW resolved (cut-over D3)", () => {
    // What is typed is what is dropped: the preview route's `collection` is
    // the class `clear` will resolve from the same (name, version) — under
    // the default `RAGChunkV2`, under a v1 override `RAGChunk`. Until the
    // preview has answered there is nothing to confirm against.
    assert.match(drawer, /const resolvedCollection = typeof tidyUpPreview\?\.collection === "string" \? tidyUpPreview\.collection : null;/);
    assert.match(drawer, /const tidyUpConfirmed = resolvedCollection !== null && typedCollection === resolvedCollection;/);
    const body = between(drawer, "const performTidyUp", "return (");
    assert.match(
      body,
      /^\s*const performTidyUp = async \(\) => \{\s*if \(!tidyUpConfirmed \|\| tidyUpBusy \|\| !tidyUpTarget\) return;/m,
      "the guard must be the first statement, and it needs the snapshot the preview was taken for"
    );
    // Review §11b (R1 / R3): the preview and the drop send the SAME snapshot,
    // taken at open — never live props, which the admin panel can move under
    // an open dialog — and the drop carries the typed class for the server to
    // check (400 CONFIRM_MISMATCH), so what is typed is what is dropped.
    const opener = between(drawer, "const handleClearAllFiles", "const closeTidyUp");
    assert.match(opener, /const target = \{ weaviateCollection: targetCollection, \.\.\.versionField \};\s*setTidyUpTarget\(target\);/, "the snapshot is taken when the dialog opens");
    assert.match(opener, /mlisToken: token,\s*\.\.\.target\s*\}\)/, "the preview sends the snapshot");
    assert.match(body, /mlisToken: token,[\s\S]{0,400}?\.\.\.tidyUpTarget,\s*confirmCollection: resolvedCollection\s*\}\)/, "the drop sends the same snapshot plus the typed class");
    assert.ok(!/weaviateCollection: targetCollection/.test(body), "the drop never reads the live prop");
    assert.match(body, /data\.collection !== resolvedCollection/, "a drop of any other class is reported, never celebrated");
    assert.match(drawer, /const closeTidyUp = \(\) => \{\s*if \(tidyUpBusy\) return;\s*setTidyUpOpen\(false\);\s*setTypedCollection\(""\);\s*setTidyUpTarget\(null\);/, "closing drops the snapshot");
    // The dialog never shows the unresolved base name as the thing to drop.
    assert.ok(!/resolvedCollection \?\? targetCollection/.test(drawer), "no fallback to the unsuffixed name in the dialog");
    assert.ok(body.includes('"/api/ingest/clear"'), "performTidyUp is where the destructive fetch lives");
    const fetches = (drawer.match(/"\/api\/ingest\/clear"/g) || []).length;
    assert.strictEqual(fetches, 1, "exactly one destructive clear call site in the drawer");
  });

  test("the confirm button is disabled until the name matches, and the dialog names the consequences", () => {
    assert.match(drawer, /disabled=\{(!tidyUpConfirmed \|\| tidyUpBusy|tidyUpBusy \|\| !tidyUpConfirmed)\}/);
    assert.match(drawer, /objectCount/, "the live object count is shown");
    assert.match(drawer, /object count unknown/, "an unknown count is said to be unknown, never rendered as 0");
    assert.match(drawer, /extracted_images/, "the image purge is named");
    assert.match(drawer, /ingestion progress tracker/i, "the tracker reset is named");
  });

  test("the drawer names the collection the server will receive, and the request carries it — with the browser's schema version when it has one (cut-over D2, F-62)", () => {
    assert.match(drawer, /const targetCollection = weaviateCollection \|\| "RAGChunk";/);
    assert.match(drawer, /weaviateCollection: targetCollection/);
    // The version rides on all three destructive requests (unload, preview,
    // clear) so they resolve the SAME class the chat path reads; absent, the
    // server default applies — the same rule as ingest.
    assert.match(drawer, /const versionField = schemaVersion !== undefined && schemaVersion !== null \? \{ schemaVersion \} : \{\};/);
    assert.strictEqual((drawer.match(/weaviateCollection: targetCollection,\s*\.\.\.versionField/g) || []).length, 2, "unload carries the version field; the Tidy Up snapshot is built from the same two values");
    assert.strictEqual((drawer.match(/\.\.\.target\b|\.\.\.tidyUpTarget\b/g) || []).length, 2, "preview and clear send the snapshot");
    assert.match(drawer, /weaviateCollection, schemaVersion, onPreviewDocument = null \}\) \{/, "the drawer takes schemaVersion as a prop (and T15's preview hook)");
    const page = read(FILES.page);
    assert.match(page, /schemaVersion=\{ragSettings\?\.schemaVersion\}/, "page.js forwards ragSettings.schemaVersion to the drawer");
  });

  test("cut-over D2 / F-71: clear and preview resolve the class from (name, version) through the one function, and clear's client carries the version so the recreate has the right shape", () => {
    for (const key of ["clear", "preview"]) {
      const src = read(FILES[key]);
      assert.match(src, /const schemaVersion = resolveSchemaVersion\(body\);/, `${key}: the one shared function`);
      assert.match(src, /collectionNameForVersion\(weaviateCollection, schemaVersion\)/, `${key}: the one suffix rule`);
      assert.match(src, /\{ schemaVersion \}\s*\)/, `${key}: the client is built WITH the version`);
      assert.ok(!/normaliseSchemaVersion\(/.test(src), `${key}: no second version reader`);
      assert.match(src, /collection: weaviateClient\.className,\s*schemaVersion,/, `${key}: the response names the class resolved and its version`);
      // T21's rules survive: refuse first, no name default.
      const refuseAt = src.indexOf("destructiveRefusal(body");
      assert.ok(refuseAt > -1 && src.indexOf("resolveSchemaVersion(body)") > refuseAt, `${key}: the version is read after the refusal`);
    }
    const clear = read(FILES.clear);
    assert.match(clear, /forDestructiveOps\(\s*weaviateUrl,\s*authToken,\s*collectionNameForVersion\(weaviateCollection, schemaVersion\),\s*\{ schemaVersion \}\s*\)/, "clear: the destructive client carries the version (F-71: the recreate is v2-shaped under v2)");
    // Review §11b (R2): an optional confirmCollection is checked against the
    // resolved class BEFORE the count and the drop; a mismatch is a typed 400
    // and nothing is dropped. Absent, T21's behaviour is unchanged.
    const confirmAt = clear.indexOf("body.confirmCollection !== undefined && body.confirmCollection !== weaviateClient.className");
    assert.ok(confirmAt > -1, "clear checks confirmCollection against the resolved class");
    assert.ok(confirmAt < clear.indexOf("countObjects()") && confirmAt < clear.indexOf("clearSchema()"), "before the count and the drop");
    assert.match(clear.slice(confirmAt, confirmAt + 900), /code: INGEST_CODES\.CONFIRM_MISMATCH[\s\S]{0,500}?\{ status: 400 \}/, "typed 400");
    assert.strictEqual(INGEST_ERROR_CODES.CONFIRM_MISMATCH, "CONFIRM_MISMATCH");
    assert.match(clear, /event: "collection_cleared", collection: weaviateClient\.className, schemaVersion, dropped, droppedObjectCount/, "collection_cleared carries the version (§10 item 3)");
    const preview = read(FILES.preview);
    assert.match(preview, /const authToken = resolveCredential\(\{ url: weaviateUrl, requestValue: mlisToken \|\| token \}\)\.value;\s*const weaviateClient = new WeaviateClient\(weaviateUrl, authToken, collectionNameForVersion\(weaviateCollection, schemaVersion\), \{ schemaVersion \}\)/, "preview: the plain client, same resolution — the credential through T23's seam");
  });

  test("cut-over D2 / F-53: the orchestrator's database summary reads the class retrieval reads, and its trace names it", () => {
    const src = read(FILES.orchestrator);
    assert.match(src, /const schemaVersion = resolveSchemaVersion\(adminConfig \|\| \{\}\);\s*const collection = collectionNameForVersion\(\s*adminConfig\?\.weaviateCollection \|\| adminConfig\?\.ragSettings\?\.weaviateCollection \|\| "RAGChunk",\s*schemaVersion\s*\);\s*const weaviateClient = new WeaviateClient\(weaviateUrl, token, collection, \{ schemaVersion \}\);/, "the summary's client: the name's own precedence, the version through the one function, the suffix through the one rule");
    assert.match(src, /documentsIndexed: dbSummaryDetails,\s*weaviateEndpoint: weaviateUrl,[\s\S]{0,200}?collection: weaviateClient\.className,\s*schemaVersion,/, "the Vector Store Inspection trace says which class was read (T13's rule)");
    // Review §11b (R2): a top-level admin-config schemaVersion — what the
    // summary reads first — is forwarded to retrieval, so both resolve one class.
    const payload = between(src, "const retrievePayload = {", "const resolvedForTrace");
    assert.match(payload, /\.\.\.\(adminConfig\?\.schemaVersion !== undefined && adminConfig\?\.schemaVersion !== null\s*\? \{ schemaVersion: adminConfig\.schemaVersion \}\s*: \{\}\)/, "retrievePayload forwards a top-level schemaVersion");
    const { resolveRetrievalConfig, resolveSchemaVersion } = require("../../src/lib/rag/config");
    for (const adminConfig of [{ schemaVersion: 1, ragSettings: { schemaVersion: 2 } }, { ragSettings: { schemaVersion: 1 } }, {}]) {
      const forwarded = { ragSettings: adminConfig.ragSettings, ...(adminConfig.schemaVersion !== undefined && adminConfig.schemaVersion !== null ? { schemaVersion: adminConfig.schemaVersion } : {}), searchStrategy: "keyword" };
      assert.strictEqual(resolveRetrievalConfig(forwarded).config.schemaVersion, resolveSchemaVersion(adminConfig), JSON.stringify(adminConfig));
    }
  });

  test("T15 (design D11): the documents route — a new READER of a collection name — resolves through the one function and the one suffix rule, read-only, the credential through T23's seam", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "app", "api", "rag", "documents", "route.js"), "utf-8");
    assert.match(src, /const schemaVersion = resolveSchemaVersion\(body\);/);
    assert.match(src, /collectionNameForVersion\(weaviateCollection, schemaVersion\), \{ schemaVersion \}\)/);
    assert.match(src, /resolveCredential\(\{ url: weaviateUrl, requestValue: body\.mlisToken \|\| body\.token \|\| "" \}\)\.value/);
    assert.ok(!/forDestructiveOps|clearSchema|deleteBy|batchDelete|normaliseSchemaVersion\(/.test(src), "read-only; no second version reader");
    assert.match(src, /getDocumentSummary\(\)/);
    assert.match(src, /export async function POST/, "a POST, so a typed store credential never travels in a query string (F-104)");
  });

  test("the drawer cannot be closed while the confirmation is open", () => {
    // Review finding: Tab reaches the drawer's header X behind the dialog;
    // closing it mid-drop unmounts the component and discards the failure text.
    assert.match(drawer, /const guardedClose = \(\) => \{\s*if \(tidyUpOpen\) return;/);
    assert.ok(!/onClick=\{onClose\}/.test(drawer), "every close path must go through guardedClose");
  });

  test("a file leaves the tray only after the server confirms the unload", () => {
    const handler = between(drawer, "const handleRemoveFile", "const handleClearAllFiles");
    const fetchAt = handler.indexOf('"/api/ingest/unload"');
    const removeAt = handler.indexOf("setLoadedFiles((prev) => prev.filter");
    assert.ok(fetchAt > -1 && removeAt > -1);
    assert.ok(removeAt > fetchAt, "the tray removal must follow the request, not precede it");
    assert.match(handler, /if \(!res\.ok \|\| data\.success === false\)/, "a refused unload keeps the file in the tray");
  });
});
