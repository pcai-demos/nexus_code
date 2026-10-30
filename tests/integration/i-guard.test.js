/**
 * Guard tests for the integration harness itself (evaluation-plan §4).
 *
 * These run WITHOUT live services, because the protection they verify — that no
 * suite can address the shared production collection — must hold unconditionally.
 * If this file ever fails, no other integration suite should be trusted to run.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { assertEvalCollection, makeRunCollection, envConfig, skipReason } = require("./_harness");

describe("integration guard: shared collection protection", () => {
  test("refuses the production collection by name", () => {
    for (const name of ["RAGChunk", "ragchunk", "RAGCHUNK"]) {
      assert.throws(
        () => assertEvalCollection(name),
        /refusing to operate on the shared production collection/,
        `guard let "${name}" through`
      );
    }
  });

  test("refuses any collection outside the RAGEval_ namespace", () => {
    for (const name of ["Documents", "RAGChunkV2", "ragEval_x", "RAGEval", "RAGEval-x", ""]) {
      assert.throws(() => assertEvalCollection(name), /eval guard/, `guard let "${name}" through`);
    }
  });

  test("accepts disposable eval collections", () => {
    assert.equal(assertEvalCollection("RAGEval_abc123"), "RAGEval_abc123");
    assert.equal(assertEvalCollection("RAGEval_run_1_ingest"), "RAGEval_run_1_ingest");
  });

  test("generated run collections are unique and always guarded", () => {
    const a = makeRunCollection("ingest");
    const b = makeRunCollection("retrieve");
    assert.match(a, /^RAGEval_/);
    assert.match(b, /^RAGEval_/);
    assert.notEqual(a, b);
  });
});

describe("integration guard: environment gating", () => {
  test("suites are skipped unless both service URLs are configured", () => {
    const config = envConfig();
    const reason = skipReason();
    if (config) {
      assert.equal(reason, false, "configured environment must not report a skip reason");
      assert.ok(config.weaviateUrl && config.embedUrl);
    } else {
      assert.equal(typeof reason, "string");
      assert.match(reason, /RAG_EVAL_WEAVIATE_URL/);
    }
  });
});
