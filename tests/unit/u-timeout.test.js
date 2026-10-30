/**
 * U-TIMEOUT — the store client's last two unbounded awaits are bounded
 * (ticket T22, design D12; findings F-69 and F-76).
 *
 * A Weaviate that ACCEPTS the connection and never answers is the case a
 * refused port cannot stand in for (I-FAILMODE's dead port fails in one
 * hop). Before T22, `batchInsert` — the write path's one unbounded call —
 * held T07's job lock until a pod restart, and `getVectorDimension` hung the
 * retrieve before any search. A real listener here accepts and stays silent;
 * the client must give up on its own.
 *
 * `batchInsert`'s bound is per client (`batchInsertTimeoutMs`, default 60 s)
 * so the case runs in half a second; `getVectorDimension`'s is the client's
 * standard 10 s, so that case waits for it once.
 */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const net = require("net");

const { WeaviateClient, BATCH_INSERT_TIMEOUT_MS } = require("../../src/lib/vectordb/weaviate");

let server;
let url;
const sockets = new Set();

before(async () => {
  server = net.createServer((socket) => {
    sockets.add(socket); // accept, read, never write
    socket.on("data", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((resolve) => server.close(resolve));
});

describe("U-TIMEOUT: batchInsert gives up on a silent store (F-69)", () => {
  test("the default bound is the supersede's 60 s", () => {
    assert.strictEqual(BATCH_INSERT_TIMEOUT_MS, 60000);
    assert.strictEqual(new WeaviateClient("http://127.0.0.1:9", "", "RAGEval_u_timeout").batchInsertTimeoutMs, 60000);
  });

  test("a hung listener → the insert rejects within the bound, naming it, and nothing is confirmed", async () => {
    const client = new WeaviateClient(url, "", "RAGEval_u_timeout", { schemaVersion: 1, batchInsertTimeoutMs: 500 });
    const chunk = { text: "t", source: "s.pdf", fileType: "pdf", page: 1, chapter: "", sectionNumber: "", sectionTitle: "", docHash: "h", imagePath: "", isVisualElement: false, metadata: "{}", vector: [0.1, 0.2] };
    const t0 = Date.now();
    await assert.rejects(client.batchInsert([chunk]), (err) => {
      assert.match(err.message, /did not answer within 0\.5 s \(1 objects\)/);
      assert.match(err.message, /Nothing from this batch is confirmed/);
      return true;
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 400 && elapsed < 5000, `gave up after ${elapsed} ms`);
  });
});

describe("U-TIMEOUT: getVectorDimension gives up on a silent store (F-76)", () => {
  test("a hung listener → null within the client's 10 s read bound, never a hang", { timeout: 30000 }, async () => {
    const client = new WeaviateClient(url, "", "RAGEval_u_timeout_dim", { schemaVersion: 1 });
    const t0 = Date.now();
    const dim = await client.getVectorDimension({ refresh: true });
    const elapsed = Date.now() - t0;
    assert.strictEqual(dim, null);
    assert.ok(elapsed >= 9000 && elapsed < 20000, `gave up after ${elapsed} ms`);
  });
});
