/**
 * I-CRED — the credential seam against the live services (ticket T23,
 * design D4 / D7; F-22).
 *
 * Read-only on the populated T08 class (RAG_EVAL_COLLECTION, its version
 * stated by RAG_EVAL_SCHEMA_VERSION — the cut-over's D12 convention for the
 * read-only suites; nothing is built or written). Runs IN the pod, where
 * this process shares the server's env, so the expected source of each hop
 * is computed from the same env the server resolves against — never
 * hard-coded, never a value.
 *
 *   1. blank credential fields (the page's shape since T23) → the server
 *      serves the reranker from the Secret (`env`), the store from the
 *      workload identity (or its override), and the scores are real
 *      (differentiated, no degradation) — F-22's uniform-0.5 signature is
 *      absent;
 *   2. a typed rerank key wins and is reported as `request`;
 *   3. a WRONG typed rerank key (the store's token, which the reranker
 *      403s — F-22's exact mistake) is a VISIBLE rerank degradation with
 *      source `request`, not a silent 0.5;
 *   4. a blank key against a FOREIGN rerank origin: nothing is sent (`none`)
 *      and the stage degrades — the platform token never leaves its origin.
 * Needs NEXCODE_RERANK_TOKEN + NEXCODE_RERANK_URL in the env (the Secret);
 * skips with the reason otherwise.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");

const { envConfig, skipReason, assertEvalCollection, evalSchemaVersion, postJson } = require("./_harness");
const { resolveCredential } = require("../../src/lib/credentials");

const config = envConfig();
const baseSkip = skipReason();
const collection = process.env.RAG_EVAL_COLLECTION ? assertEvalCollection(process.env.RAG_EVAL_COLLECTION) : null;
const SCHEMA_VERSION = evalSchemaVersion(1);
const RERANK_URL = process.env.RAG_EVAL_RERANK_URL || "";
const RERANK_MODEL = process.env.RAG_EVAL_RERANK_MODEL || "";
const SKIP =
  baseSkip ||
  (collection ? false : "set RAG_EVAL_COLLECTION to a populated RAGEval_* collection") ||
  (RERANK_URL && RERANK_MODEL ? false : "set RAG_EVAL_RERANK_URL / RAG_EVAL_RERANK_MODEL") ||
  (process.env.NEXCODE_RERANK_TOKEN && process.env.NEXCODE_RERANK_URL ? false : "NEXCODE_RERANK_TOKEN / NEXCODE_RERANK_URL are not in this env — the nexcode-credentials Secret is missing or this pod predates T23");

const QUERY = "Hesketh bedroom dimensions";

function payload(overrides = {}) {
  return {
    query: QUERY,
    weaviateUrl: config.weaviateUrl,
    weaviateCollection: collection,
    schemaVersion: SCHEMA_VERSION,
    // The page's shape since T23: no credential in the request.
    token: "",
    weaviateToken: "",
    rerankToken: "",
    embedUrl: config.embedUrl,
    embedModel: config.embedModel,
    rerankUrl: RERANK_URL,
    rerankModel: RERANK_MODEL,
    searchStrategy: "hybrid",
    hybridAlpha: 0.5,
    limit: 20,
    candidatesToRerank: 10,
    keepTopNAfterRerank: 8,
    ...overrides,
  };
}

/** What the server must report for a hop, computed from THIS process's env. */
const expectedSource = (url) => resolveCredential({ url, requestValue: "" }).source;

async function retrieve(body) {
  const res = await postJson(`${config.appUrl}/api/rag/retrieve`, body);
  assert.ok(res.ok, `retrieve failed: ${res.text}`);
  const json = JSON.parse(res.text);
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(res.text), "no JWT-shaped value in the response");
  return json;
}

describe("I-CRED: the credential seam, live", () => {
  test("1. blank fields: the reranker from the Secret, the store from the workload identity, real scores, no degradation", { skip: SKIP }, async () => {
    const j = await retrieve(payload());
    assert.strictEqual(j.success, true);
    assert.ok(Array.isArray(j.results) && j.results.length > 0, "results returned");
    assert.ok(!j.degraded, `not degraded: ${JSON.stringify(j.degraded)}`);
    assert.deepStrictEqual(j.report.credentialSources, {
      embed: expectedSource(config.embedUrl),
      weaviate: expectedSource(config.weaviateUrl),
      rerank: expectedSource(RERANK_URL),
    });
    assert.strictEqual(j.report.credentialSources.rerank, "env", "the reranker's own token, from the Secret (F-22: per endpoint)");
    assert.ok(["workload", "env"].includes(j.report.credentialSources.weaviate), "the store: the pod's identity or its override");
    assert.ok(j.report.candidatesScored > 0, "the reranker scored");
    const scores = j.results.map((r) => r.rerankScore).filter((s) => typeof s === "number");
    assert.ok(scores.length > 1 && new Set(scores).size > 1, `differentiated scores, never a uniform seed (F-22): ${JSON.stringify(scores)}`);
    assert.ok(!scores.every((s) => s === 0.5), "not the 0.5 seed");
  });

  test("2. a typed rerank key wins and is reported as `request`", { skip: SKIP }, async () => {
    const j = await retrieve(payload({ rerankToken: process.env.NEXCODE_RERANK_TOKEN }));
    assert.strictEqual(j.success, true);
    assert.strictEqual(j.report.credentialSources.rerank, "request");
    assert.ok(!j.degraded, "a correct typed key is as good as the Secret's");
  });

  test("3. F-22 reproduced on purpose: the store's token typed into the rerank field is a VISIBLE degradation with source `request`", { skip: SKIP }, async () => {
    const wrong = resolveCredential({ url: config.weaviateUrl, requestValue: "" }).value;
    assert.ok(wrong, "this pod has a store credential to misuse");
    const j = await retrieve(payload({ rerankToken: wrong }));
    assert.strictEqual(j.success, true, "retrieval itself succeeds (the search is real)");
    assert.strictEqual(j.report.credentialSources.rerank, "request", "the report names the source the presenter chose");
    assert.ok(Array.isArray(j.degraded) && j.degraded.some((d) => d.stage === "rerank"), `a rerank degradation is disclosed, never a silent 0.5: ${JSON.stringify(j.degraded)}`);
    const scores = j.results.map((r) => r.rerankScore).filter((s) => typeof s === "number");
    assert.ok(!scores.some((s) => s === 0.5) || scores.length === 0, "no fabricated 0.5 (T10)");
  });

  test("4. a blank key against a foreign rerank origin sends nothing (`none`) and the stage degrades — the platform token never leaves its origin", { skip: SKIP }, async () => {
    const j = await retrieve(payload({ rerankUrl: "https://rerank.invalid" }));
    assert.strictEqual(j.success, true);
    assert.strictEqual(j.report.credentialSources.rerank, "none");
    assert.ok(Array.isArray(j.degraded) && j.degraded.some((d) => d.stage === "rerank"), `degraded: ${JSON.stringify(j.degraded)}`);
  });
});
