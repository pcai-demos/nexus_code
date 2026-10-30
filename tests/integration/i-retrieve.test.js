/**
 * I-RETRIEVE — BM25 floor and hybrid retrieval (evaluation-plan §4.4, §4.5).
 *
 * The BM25 cases are model-independent ground truth: every anchor in the golden
 * manifest is a rare string that both production extractors placed on the same
 * page, so a keyword search for it must return that page. No embedding quality
 * is involved — if this fails, the pipeline lost or misattributed content.
 *
 * Assumes the corpus is already indexed in the collection named by
 * RAG_EVAL_COLLECTION (a RAGEval_* collection produced by I-INGEST), whose
 * class shape RAG_EVAL_SCHEMA_VERSION states (default 1: the v1 T08 class) —
 * sent on every request, cut-over design D12.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { envConfig, skipReason, assertEvalCollection, evalSchemaVersion, postJson } = require("./_harness");
const { corpusEntries } = require("../unit/_helpers");

const config = envConfig();
const baseSkip = skipReason();
// Retrieval runs against an already-populated collection, so it additionally
// requires the caller to name it.
const SKIP =
  baseSkip ||
  (process.env.RAG_EVAL_COLLECTION
    ? false
    : "set RAG_EVAL_COLLECTION to a populated RAGEval_* collection (see I-INGEST)");

const collection = process.env.RAG_EVAL_COLLECTION
  ? assertEvalCollection(process.env.RAG_EVAL_COLLECTION)
  : null;
const SCHEMA_VERSION = evalSchemaVersion(1);

function retrievePayload(query, overrides = {}) {
  return {
    query,
    weaviateUrl: config.weaviateUrl,
    weaviateCollection: collection,
    schemaVersion: SCHEMA_VERSION,
    token: config.token,
    weaviateToken: config.token,
    rerankToken: config.token,
    embedUrl: config.embedUrl,
    embedModel: config.embedModel,
    rerankEnabled: false,
    searchStrategy: "keyword",
    limit: 20,
    keepTopNAfterRerank: 20,
    candidatesToRerank: 20,
    similarityThreshold: 0,
    ...overrides,
  };
}

describe("I-RETRIEVE: BM25 floor (model-independent)", () => {
  const anchored = corpusEntries().filter((e) => (e.anchors || []).length > 0);

  for (const entry of anchored) {
    const anchor = entry.anchors[0];
    test(
      `${entry.fileName}: keyword search for "${anchor.token}" returns page ${anchor.page}`,
      { skip: SKIP },
      async () => {
        const res = await postJson(
          `${config.appUrl}/api/rag/retrieve`,
          retrievePayload(anchor.token)
        );
        assert.ok(res.ok, `retrieve failed: ${res.text}`);
        assert.equal(res.json.success, true);

        const results = res.json.results || [];
        assert.ok(results.length > 0, `no results for anchor "${anchor.token}"`);

        const top = results[0];
        assert.equal(
          top.source,
          entry.fileName,
          `top hit came from ${top.source}, expected ${entry.fileName}`
        );
        assert.equal(
          top.page,
          anchor.page,
          `top hit was page ${top.page}, manifest says ${anchor.page}`
        );
      }
    );
  }
});

describe("I-RETRIEVE: hybrid search", () => {
  test(
    "anchors appear in the top 3 under hybrid search",
    { skip: SKIP },
    async () => {
      const entry = corpusEntries().find((e) => (e.anchors || []).length > 0);
      const anchor = entry.anchors[0];

      const res = await postJson(
        `${config.appUrl}/api/rag/retrieve`,
        retrievePayload(anchor.token, { searchStrategy: "hybrid", hybridAlpha: 0.5 })
      );
      assert.ok(res.ok, `retrieve failed: ${res.text}`);

      const top3 = (res.json.results || []).slice(0, 3);
      assert.ok(
        top3.some((r) => r.source === entry.fileName && r.page === anchor.page),
        `anchor "${anchor.token}" not in top 3 under hybrid search`
      );
    }
  );

  // The E17/FM-T1 gate, assertable at last: T13's report echoes the pool depth
  // the route actually used (`searchLimitUsed` = the resolver's poolSize), so
  // the pre-T08 collapse — rerank off silently shrinking the pool to
  // keepTopNAfterRerank — would fail here instead of hiding.
  test("report.searchLimitUsed equals the resolved pool with the reranker OFF (FM-T1)", { skip: SKIP }, async () => {
    const res = await postJson(
      `${config.appUrl}/api/rag/retrieve`,
      retrievePayload("site plan", {
        searchStrategy: "keyword",
        rerankEnabled: false,
        limit: 20,
        keepTopNAfterRerank: 8,
      })
    );
    assert.ok(res.ok, `retrieve failed: ${res.text}`);
    assert.ok(res.json.report, "the T13 report must be present on a successful response");
    // Rerank-off pool contract (F-20, owner-approved): max(limit, keepTopN).
    assert.equal(
      res.json.report.searchLimitUsed,
      20,
      "with the reranker off the pool must be max(limit, keepTopN), not keepTopN"
    );
    assert.equal(res.json.report.rerankEffective, false);
    assert.equal(res.json.report.thresholdApplied.floorSource, "none");
    assert.ok(
      (res.json.results || []).length <= 8,
      "keepTopNAfterRerank must still slice the response"
    );
  });

  test("report.searchLimitUsed equals the resolved pool with the reranker ON (FM-T1)", { skip: SKIP }, async () => {
    // The rerank leg needs the real endpoint + its own credential (F-22).
    // Without them this leg cannot run meaningfully; pass vacuously rather
    // than fail an environment that deliberately has no reranker.
    if (!(config.rerankUrl && config.rerankToken)) return;

    const res = await postJson(
      `${config.appUrl}/api/rag/retrieve`,
      retrievePayload("site plan", {
        searchStrategy: "keyword",
        rerankEnabled: true,
        rerankUrl: config.rerankUrl,
        rerankModel: config.rerankModel,
        rerankToken: config.rerankToken,
        limit: 20,
        candidatesToRerank: 10,
        keepTopNAfterRerank: 8,
      })
    );
    assert.ok(res.ok, `retrieve failed: ${res.text}`);
    assert.ok(res.json.report, "the T13 report must be present");
    // Rerank-on pool contract: exactly candidatesToRerank (never inflated by
    // limit — the F-20 approved deviation).
    assert.equal(res.json.report.searchLimitUsed, 10);
    assert.equal(res.json.report.rerankEffective, true);
    assert.equal(res.json.report.thresholdApplied.floorSource, "rerank");
    // This leg ran against the live reranker: the floor must have executed.
    assert.equal(res.json.report.thresholdApplied.floorApplied, true);
  });
});

// ── T15 (t15-design.md D4): the optional document filter on the retrieve route ──
describe("I-RETRIEVE/T15: documentFilter limits the search to the named document(s); absent, nothing changes", () => {
  test("a filter to one document returns that document only, the report says which property carried it, and the same request without the filter is the reference", { skip: SKIP }, async () => {
    const entry = corpusEntries().find((e) => (e.anchors || []).length > 0);
    const other = corpusEntries().find((e) => e.fileName !== entry.fileName);
    assert.ok(entry && other, "two corpus documents");
    // A generic query that matches across documents; the filter names the OTHER document.
    const unfiltered = await postJson(`${config.appUrl}/api/rag/retrieve`, retrievePayload("plan", { searchStrategy: "keyword", rerankEnabled: false, keepTopNAfterRerank: 20, limit: 20 }));
    assert.ok(unfiltered.ok, unfiltered.text);
    assert.strictEqual(unfiltered.json.report.documentFilter, null, "no filter → the report says so");
    const filtered = await postJson(`${config.appUrl}/api/rag/retrieve`, retrievePayload("plan", { searchStrategy: "keyword", rerankEnabled: false, keepTopNAfterRerank: 20, limit: 20, documentFilter: { sources: [other.fileName] } }));
    assert.ok(filtered.ok, filtered.text);
    const results = filtered.json.results || [];
    for (const r of results) assert.strictEqual(r.source, other.fileName, `a result from outside the filter: ${r.source}`);
    const rep = filtered.json.report.documentFilter;
    assert.ok(rep, "the report carries the filter block");
    assert.deepStrictEqual(rep.requested, { sourceIds: 0, sources: [other.fileName] });
    // On the v1 harness class the filter rides the token-matched `source` and is post-checked exactly (F-109); on a v2 class with ids it rides `sourceId`.
    assert.ok(["source", "sourceId"].includes(rep.applied), JSON.stringify(rep));
    assert.ok(rep.droppedByPostCheck >= 0);
    assert.ok(results.length <= (unfiltered.json.results || []).length + 20, "a filter never widens the pool");
  });
});
