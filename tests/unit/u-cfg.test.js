/**
 * U-CFG — retrieval config contract (ticket T08).
 *
 * The original U-CFG spec assumed server-side precedence over a server-held
 * configuration (ragSettings > legacy > default). F-12 disproved the premise:
 * there is no server-side configuration authority — configuration arrives in
 * the request body, per call, from browser localStorage. These cases pin the
 * rebased contract instead:
 *
 *   1. per-key precedence WITHIN a request: top-level > ragSettings > default
 *   2. identity fields (embedUrl/embedModel) are never silently defaulted
 *   3. pool arithmetic: each knob means one thing, on every path
 *   4. the relevance floor (minRerankScore) has a real, non-zero default
 *   5. similarityThreshold has per-mode semantics; similarity is never fabricated
 *   6. the target collection always resolves, in one place
 *   7. cross-space queries are refused loudly (EMBED_MODEL_MISMATCH)
 *   8. the wrong embedding defaults are gone from the codebase entirely
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  resolveRetrievalConfig,
  RETRIEVAL_DEFAULTS,
  RETRIEVAL_ERROR_CODES,
  buildRetrievalReport,
  checkVectorDimMatch,
  similarityFromDistance,
  filterBySimilarity,
} = require("../../src/lib/rag/config");

describe("U-CFG precedence: top-level > ragSettings > default", () => {
  test("top-level field wins over ragSettings", () => {
    const r = resolveRetrievalConfig({
      searchStrategy: "keyword",
      candidatesToRerank: 5,
      ragSettings: { candidatesToRerank: 12 },
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.config.candidatesToRerank, 5);
  });

  test("ragSettings wins over the default", () => {
    const r = resolveRetrievalConfig({
      searchStrategy: "keyword",
      ragSettings: { candidatesToRerank: 12 },
    });
    assert.strictEqual(r.config.candidatesToRerank, 12);
  });

  test("defaults apply when a key is absent everywhere", () => {
    const r = resolveRetrievalConfig({ searchStrategy: "keyword" });
    assert.strictEqual(r.config.candidatesToRerank, RETRIEVAL_DEFAULTS.candidatesToRerank);
    assert.strictEqual(r.config.keepTopNAfterRerank, RETRIEVAL_DEFAULTS.keepTopNAfterRerank);
  });

  test("ragSettings aliases map to canonical keys (searchMode, topKRetrieval, rerankerEnabled)", () => {
    const r = resolveRetrievalConfig({
      embedUrl: "http://embed.example/v1",
      embedModel: "m",
      ragSettings: { searchMode: "vector", topKRetrieval: 42, rerankerEnabled: false },
    });
    assert.strictEqual(r.config.searchStrategy, "vector");
    assert.strictEqual(r.config.limit, 42);
    assert.strictEqual(r.config.rerankEnabled, false);
  });

  test("the drift pairs are single-sourced: one default each", () => {
    // Pre-T08 the route and orchestrator disagreed (candidates 20 vs 30,
    // minRerankScore 0.0 vs 0.01). The module is now the only place a default
    // may live, so this pins the resolved values.
    assert.strictEqual(RETRIEVAL_DEFAULTS.candidatesToRerank, 20);
    assert.strictEqual(RETRIEVAL_DEFAULTS.keepTopNAfterRerank, 8);
    assert.strictEqual(RETRIEVAL_DEFAULTS.limit, 100);
    assert.strictEqual(RETRIEVAL_DEFAULTS.searchStrategy, "hybrid");
  });

  test("T09: the aggregation defaults live here too, and only here", () => {
    // The aggregation branch used to carry its own literals in the
    // orchestrator (limit 100, keepTopN 20 — E18). They resolve from this
    // module now; U-COUNT pins the orchestrator side.
    assert.strictEqual(RETRIEVAL_DEFAULTS.aggregationScanLimit, 500);
    assert.strictEqual(RETRIEVAL_DEFAULTS.countStemVariants, false);
    assert.strictEqual(RETRIEVAL_DEFAULTS.aggregationEvidenceLines, 80);
    // The pre-T09 literals, by name: neither may return anywhere in the
    // orchestrator's aggregation override (U-COUNT pins the override's shape;
    // this pins the absence of the old numbers next to the knobs they capped).
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "orchestrator.js"), "utf8");
    const override = src.match(/targetAggregationKeyword\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{\}\)/);
    assert.ok(override, "the aggregation override exists");
    assert.ok(!/keepTopNAfterRerank:\s*20\b/.test(override[1]), "E18's slice literal is gone");
    assert.ok(!/limit:\s*100\b/.test(override[1]), "E18's pool literal is gone");
  });

  test("non-numeric junk in a numeric knob falls through to the next level", () => {
    const r = resolveRetrievalConfig({
      searchStrategy: "keyword",
      candidatesToRerank: "not-a-number",
      ragSettings: { candidatesToRerank: 12 },
    });
    assert.strictEqual(r.config.candidatesToRerank, 12);
  });
});

describe("U-CFG orchestrator payload shape", () => {
  // The orchestrator builds its payload with `undefined` for keys the admin
  // config does not carry, so JSON.stringify drops them and the route's
  // resolver supplies the defaults. Anything that then wants to DISPLAY a
  // value must resolve it — reading the raw payload yields undefined and
  // throws inside the orchestrator's try/catch, silently turning a good
  // retrieval into a zero-chunk answer (regression, caught live 2026-08-13).
  const asSent = (payload) => JSON.parse(JSON.stringify(payload));

  test("a payload of all-undefined optional keys still resolves completely", () => {
    const r = resolveRetrievalConfig(
      asSent({
        query: "q",
        weaviateUrl: undefined,
        weaviateCollection: undefined,
        embedUrl: "http://e/v1",
        embedModel: "m",
        rerankUrl: undefined,
        rerankModel: undefined,
        ragSettings: undefined,
      })
    );
    assert.strictEqual(r.ok, true);
    for (const key of ["searchStrategy", "weaviateUrl", "weaviateCollection", "rerankUrl", "rerankModel"]) {
      assert.ok(
        typeof r.config[key] === "string" && r.config[key].length > 0,
        `${key} must resolve to a usable string, got ${JSON.stringify(r.config[key])}`
      );
    }
    assert.ok(Number.isFinite(r.config.poolSize));
    assert.ok(Number.isFinite(r.config.keepTopNAfterRerank));
  });
});

describe("U-CFG identity: embed configuration is never silently defaulted", () => {
  test("hybrid without embedModel is refused with a typed CONFIG_MISSING", () => {
    const r = resolveRetrievalConfig({ embedUrl: "http://embed.example/v1" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, "CONFIG_MISSING");
    assert.strictEqual(r.error.field, "embedModel");
    assert.match(r.error.message, /embedModel/);
  });

  test("vector without embedUrl is refused with a typed CONFIG_MISSING", () => {
    const r = resolveRetrievalConfig({ searchStrategy: "vector", embedModel: "m" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, "CONFIG_MISSING");
    assert.strictEqual(r.error.field, "embedUrl");
  });

  test("keyword search needs no embedding config (no vector leg)", () => {
    const r = resolveRetrievalConfig({ searchStrategy: "keyword" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.config.needsVector, false);
  });

  test("an explicit embed pair passes through verbatim", () => {
    const r = resolveRetrievalConfig({ embedUrl: "http://e/v1", embedModel: "qwen3-embedding:8b" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.config.embedModel, "qwen3-embedding:8b");
    assert.strictEqual(r.config.embedUrl, "http://e/v1");
    assert.strictEqual(r.config.needsVector, true);
  });

  test("there is no embed default to fall back to", () => {
    assert.strictEqual(RETRIEVAL_DEFAULTS.embedUrl, undefined);
    assert.strictEqual(RETRIEVAL_DEFAULTS.embedModel, undefined);
  });

  test("credentials pass through untouched and never default to anything but empty", () => {
    const r = resolveRetrievalConfig({
      searchStrategy: "keyword",
      token: "tok-a",
      weaviateToken: "tok-b",
      rerankToken: "tok-c",
    });
    assert.strictEqual(r.config.token, "tok-a");
    assert.strictEqual(r.config.weaviateToken, "tok-b");
    assert.strictEqual(r.config.rerankToken, "tok-c");
    const empty = resolveRetrievalConfig({ searchStrategy: "keyword" });
    assert.strictEqual(empty.config.token, "");
  });
});

describe("U-CFG pool arithmetic: each knob means one thing", () => {
  const embed = { embedUrl: "http://e/v1", embedModel: "m" };

  test("rerank on: the pool is candidatesToRerank, limit does not inflate it", () => {
    // The ticket's literal formula max(limit, candidatesToRerank) would have
    // grown the rerank-on pool whenever limit > candidates (orchestrator sends
    // limit 100), multiplying CPU-served reranker latency and perturbing the
    // committed baseline pool. Owner-approved deviation, 2026-08-13.
    const r = resolveRetrievalConfig({
      ...embed,
      limit: 20,
      candidatesToRerank: 10,
      rerankEnabled: true,
    });
    assert.strictEqual(r.config.poolSize, 10);
  });

  test("rerank off: pool honours limit, sliced to keepTopN after retrieval", () => {
    const r = resolveRetrievalConfig({
      ...embed,
      limit: 20,
      keepTopNAfterRerank: 8,
      rerankEnabled: false,
    });
    assert.strictEqual(r.config.poolSize, 20);
    assert.strictEqual(r.config.keepTopNAfterRerank, 8);
  });

  test("rerank off: pool never shrinks below keepTopN", () => {
    const r = resolveRetrievalConfig({
      ...embed,
      limit: 5,
      keepTopNAfterRerank: 8,
      rerankEnabled: false,
    });
    assert.strictEqual(r.config.poolSize, 8);
  });

  test("T63 (t63-design D4 (a)): a lookup whose selected document was read whole asks for no rerank — the request-level rerankEnabled: false beats the page's blob (rerankerEnabled true), the search keeps its own pool, the slice keeps 8", () => {
    const { RAG_SETTINGS_DEFAULTS: T } = require("../../src/lib/rag/config");
    const r = resolveRetrievalConfig({ ...embed, ragSettings: { ...T }, rerankEnabled: false, documentFilter: { sourceIds: ["demos/x.pdf"], sources: ["x.pdf"] } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(T.rerankerEnabled, true, "the blob asks for the reranker");
    assert.strictEqual(r.config.rerankEnabled, false, "the request's field wins");
    assert.strictEqual(r.config.rerankEffective, false);
    assert.strictEqual(r.config.poolSize, Math.max(T.topKRetrieval, T.keepTopNAfterRerank), "the search's own pool — no rerank pool");
    assert.strictEqual(r.config.keepTopNAfterRerank, T.keepTopNAfterRerank);
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "orchestrator.js"), "utf8").replace(/\/\/[^\n]*/g, "");
    assert.match(src, /if \(lookupRead\.coverage === "complete" && lookupRead\.rows\.length > 0\) retrievePayload\.rerankEnabled = false;/, "only a COMPLETED whole read skips the reranker (D8 (a))");
    assert.strictEqual((src.match(/retrievePayload\.rerankEnabled = false/g) || []).length, 1, "one site sets it");
  });

  test("rerankEnabled with a blanked endpoint is not effective reranking", () => {
    // Pre-T08 this combination silently skipped reranking and returned the whole
    // unsliced pool. Now it resolves to the rerank-off contract.
    const r = resolveRetrievalConfig({
      ...embed,
      rerankEnabled: true,
      rerankUrl: "",
      limit: 20,
      keepTopNAfterRerank: 8,
    });
    assert.strictEqual(r.config.rerankEffective, false);
    assert.strictEqual(r.config.poolSize, 20);
  });

  test("rerank endpoint defaults remain (they are correct for this deployment)", () => {
    const r = resolveRetrievalConfig({ ...embed });
    assert.ok(r.config.rerankUrl.length > 0);
    assert.ok(r.config.rerankModel.length > 0);
    assert.strictEqual(r.config.rerankEffective, true);
  });
});

describe("U-CFG relevance floor: minRerankScore is a real floor", () => {
  const embed = { embedUrl: "http://e/v1", embedModel: "m" };

  test("the default floor is non-zero (calibrated from measured score distributions)", () => {
    assert.ok(
      RETRIEVAL_DEFAULTS.minRerankScore > 0,
      "a zero floor filters nothing — that is F-8"
    );
    assert.ok(RETRIEVAL_DEFAULTS.minRerankScore < 1);
  });

  test("the default floor sits inside the measured separation window", () => {
    // Calibrated 2026-08-13 against Qwen/Qwen3-Reranker-8B on the golden
    // corpus (t08-before-floor.json): absence probes topped out at 0.0068,
    // the weakest score page-level recall depends on was 0.3708. Pinned so a
    // future edit to the default cannot silently leave that window — which
    // would either stop filtering absence (F-8 returns) or start costing
    // recall.
    const ABSENCE_MAX = 0.0068;
    const WEAKEST_RELEVANT = 0.3708;
    assert.ok(
      RETRIEVAL_DEFAULTS.minRerankScore > ABSENCE_MAX,
      `floor ${RETRIEVAL_DEFAULTS.minRerankScore} must exceed the measured absence ceiling ${ABSENCE_MAX}`
    );
    assert.ok(
      RETRIEVAL_DEFAULTS.minRerankScore <= WEAKEST_RELEVANT,
      `floor ${RETRIEVAL_DEFAULTS.minRerankScore} must not exceed the weakest recall-critical score ${WEAKEST_RELEVANT}`
    );
    assert.strictEqual(RETRIEVAL_DEFAULTS.minRerankScore, 0.05);
  });

  test("an explicit zero disables the floor (legitimate override)", () => {
    const r = resolveRetrievalConfig({ ...embed, minRerankScore: 0 });
    assert.strictEqual(r.config.minRerankScore, 0);
  });

  test("floorSource names what actually protects the result set", () => {
    const rerankOn = resolveRetrievalConfig({ ...embed });
    assert.strictEqual(rerankOn.config.floorSource, "rerank");

    const vectorNoRerank = resolveRetrievalConfig({
      ...embed,
      searchStrategy: "vector",
      rerankEnabled: false,
    });
    assert.strictEqual(vectorNoRerank.config.floorSource, "similarity");

    const hybridNoRerank = resolveRetrievalConfig({ ...embed, rerankEnabled: false });
    assert.strictEqual(hybridNoRerank.config.floorSource, "none");
  });
});

describe("U-CFG similarity semantics: never fabricated, vector-mode-only threshold", () => {
  test("similarityFromDistance: real distance maps, absence maps to null — never 1.0", () => {
    assert.strictEqual(similarityFromDistance(0.25), 0.75);
    assert.strictEqual(similarityFromDistance(0), 1);
    assert.strictEqual(similarityFromDistance(null), null);
    assert.strictEqual(similarityFromDistance(undefined), null);
    assert.strictEqual(similarityFromDistance("garbage"), null);
  });

  test("vector mode: threshold filters on real similarity", () => {
    const rows = [
      { similarity: 0.9 },
      { similarity: 0.4 },
      { similarity: null }, // no distance -> cannot judge -> kept
    ];
    const kept = filterBySimilarity(rows, "vector", 0.7);
    assert.deepStrictEqual(kept.map((r) => r.similarity), [0.9, null]);
  });

  test("hybrid and keyword modes: threshold is not applicable and filters nothing", () => {
    const rows = [{ similarity: null }, { similarity: null }];
    assert.strictEqual(filterBySimilarity(rows, "hybrid", 0.7).length, 2);
    assert.strictEqual(filterBySimilarity(rows, "keyword", 0.7).length, 2);
  });

  test("a zero or absent threshold filters nothing in any mode", () => {
    const rows = [{ similarity: 0.1 }];
    assert.strictEqual(filterBySimilarity(rows, "vector", 0).length, 1);
    assert.strictEqual(filterBySimilarity(rows, "vector", undefined).length, 1);
  });
});

describe("U-CFG collection propagation", () => {
  // Since the cut-over (design D1) the read-path default resolves to the v2
  // class: the default NAME is still "RAGChunk", and the default VERSION (2)
  // suffixes it. The name's precedence is unchanged; the suffix is applied
  // after it, to whichever name won.
  test("the collection resolves once, with the read-path default — RAGChunk under the default version 2", () => {
    const r = resolveRetrievalConfig({ searchStrategy: "keyword" });
    assert.strictEqual(r.config.weaviateCollection, "RAGChunkV2");
    assert.strictEqual(r.config.schemaVersion, 2);
    assert.strictEqual(RETRIEVAL_DEFAULTS.weaviateCollection, "RAGChunk", "the default NAME did not move; the version did");
  });

  test("top-level weaviateCollection wins over ragSettings", () => {
    const r = resolveRetrievalConfig({
      searchStrategy: "keyword",
      weaviateCollection: "RAGEval_a",
      ragSettings: { weaviateCollection: "RAGEval_b" },
    });
    assert.strictEqual(r.config.weaviateCollection, "RAGEval_aV2");
  });

  test("ragSettings carries the collection when no top-level value is sent", () => {
    const r = resolveRetrievalConfig({
      searchStrategy: "keyword",
      ragSettings: { weaviateCollection: "RAGEval_b" },
    });
    assert.strictEqual(r.config.weaviateCollection, "RAGEval_bV2");
  });
});

describe("U-CFG/T17 (design D13, F-40): a PRESENT non-canonical collection name is a typed 400, an absent one keeps the default", () => {
  const embed = { embedUrl: "http://e/v1", embedModel: "m" };

  test("names the plain client used to sanitise or launder are refused with COLLECTION_INVALID, top-level and in ragSettings", () => {
    for (const bad of ["my collection", " RAGChunk ", "ragchunk", "!!!", "1abc", "_x", 42, {}, true]) {
      const top = resolveRetrievalConfig({ ...embed, weaviateCollection: bad });
      assert.strictEqual(top.ok, false, JSON.stringify(bad));
      assert.strictEqual(top.error.code, RETRIEVAL_ERROR_CODES.COLLECTION_INVALID);
      assert.strictEqual(top.error.field, "weaviateCollection");
      const nested = resolveRetrievalConfig({ ...embed, ragSettings: { weaviateCollection: bad } });
      assert.strictEqual(nested.ok, false, JSON.stringify(bad));
      assert.strictEqual(nested.error.code, RETRIEVAL_ERROR_CODES.COLLECTION_INVALID);
    }
  });

  test("absent, null or empty keeps the read-path default (RAGChunk under version 2)", () => {
    for (const absent of [undefined, null, ""]) {
      const r = resolveRetrievalConfig({ ...embed, weaviateCollection: absent });
      assert.strictEqual(r.ok, true, JSON.stringify(absent));
      assert.strictEqual(r.config.weaviateCollection, "RAGChunkV2");
    }
    assert.strictEqual(resolveRetrievalConfig({ ...embed, ragSettings: { weaviateCollection: "" } }).config.weaviateCollection, "RAGChunkV2");
  });

  test("an exact name passes, suffixed by the version as before; the rule is the destructive routes' predicate (names.js)", () => {
    const { isExplicitClassName } = require("../../src/lib/rag/names");
    const r = resolveRetrievalConfig({ ...embed, weaviateCollection: "RAGEval_x" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.config.weaviateCollection, "RAGEval_xV2");
    assert.strictEqual(isExplicitClassName("RAGEval_x"), true);
    assert.strictEqual(isExplicitClassName("my collection"), false);
    // The same function weaviate.js exports (one predicate, two homes for the import).
    const { isExplicitClassName: fromClient } = require("../../src/lib/vectordb/weaviate");
    assert.strictEqual(fromClient, isExplicitClassName);
  });

  test("the refusal comes before the identity check, and CONFIG_MISSING still fires when the name is fine", () => {
    const both = resolveRetrievalConfig({ weaviateCollection: "bad name" });
    assert.strictEqual(both.error.code, RETRIEVAL_ERROR_CODES.COLLECTION_INVALID);
    const onlyIdentity = resolveRetrievalConfig({ weaviateCollection: "RAGEval_x" });
    assert.strictEqual(onlyIdentity.error.code, RETRIEVAL_ERROR_CODES.CONFIG_MISSING);
  });

  test("the code is in the taxonomy and the retrieve route maps a resolver refusal to 400 (T12's classifier then says 'failed', never 'empty')", () => {
    assert.strictEqual(RETRIEVAL_ERROR_CODES.COLLECTION_INVALID, "COLLECTION_INVALID");
    const { classifyRetrievalOutcome } = require("../../src/lib/rag/config");
    const outcome = classifyRetrievalOutcome({ ok: false, status: 400, body: { success: false, code: "COLLECTION_INVALID", error: "x" } });
    assert.strictEqual(outcome.state, "failed");
    assert.strictEqual(outcome.code, "COLLECTION_INVALID");
  });
});

describe("U-CFG/T17 (design D1, F-83): the admin panel's blob no longer disables the floor", () => {
  test("RAG_SETTINGS_DEFAULTS carries the resolver's floor, and a request carrying it resolves to RETRIEVAL_DEFAULTS on every retrieval key", () => {
    const { RAG_SETTINGS_DEFAULTS } = require("../../src/lib/rag/config");
    const r = resolveRetrievalConfig({ embedUrl: "http://e/v1", embedModel: "m", ragSettings: RAG_SETTINGS_DEFAULTS });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.config.minRerankScore, RETRIEVAL_DEFAULTS.minRerankScore);
    assert.strictEqual(r.config.similarityThreshold, RETRIEVAL_DEFAULTS.similarityThreshold);
    assert.strictEqual(r.config.limit, RETRIEVAL_DEFAULTS.limit);
    assert.strictEqual(r.config.candidatesToRerank, RETRIEVAL_DEFAULTS.candidatesToRerank);
    assert.strictEqual(r.config.keepTopNAfterRerank, RETRIEVAL_DEFAULTS.keepTopNAfterRerank);
    assert.strictEqual(r.config.hybridAlpha, RETRIEVAL_DEFAULTS.hybridAlpha);
    assert.strictEqual(r.config.searchStrategy, RETRIEVAL_DEFAULTS.searchStrategy);
    assert.strictEqual(r.config.rerankEnabled, RETRIEVAL_DEFAULTS.rerankEnabled);
    assert.strictEqual(r.config.rerankProperty, RETRIEVAL_DEFAULTS.rerankProperty);
    assert.strictEqual(r.config.poolSize, RETRIEVAL_DEFAULTS.candidatesToRerank);
  });

  test("the pre-T17 page blob (minRerankScore 0.0) DID disable the floor — the case the demo-shape leg measures", () => {
    const r = resolveRetrievalConfig({ embedUrl: "http://e/v1", embedModel: "m", ragSettings: { minRerankScore: 0.0 } });
    assert.strictEqual(r.config.minRerankScore, 0, "an explicit zero is still the legitimate override (T08) — the fix is the blob's value, not the resolver's rule");
  });
});

describe("U-CFG EMBED_MODEL_MISMATCH: cross-space queries are refused loudly", () => {
  test("a dimension mismatch produces the typed error, naming both spaces and the fix", () => {
    const err = checkVectorDimMatch(2560, 4096, {
      embedModel: "Qwen/Qwen3-Embedding-4B",
      collection: "RAGEval_x",
    });
    assert.ok(err);
    assert.strictEqual(err.code, "EMBED_MODEL_MISMATCH");
    assert.match(err.message, /2560/);
    assert.match(err.message, /4096/);
    assert.match(err.message, /Qwen\/Qwen3-Embedding-4B/);
    assert.match(err.message, /RAGEval_x/);
    assert.match(err.message, /re-ingest/i);
  });

  test("matching dimensions pass", () => {
    assert.strictEqual(checkVectorDimMatch(4096, 4096, {}), null);
  });

  test("an empty collection (no pinnable dimension) cannot mismatch", () => {
    assert.strictEqual(checkVectorDimMatch(4096, null, {}), null);
    assert.strictEqual(checkVectorDimMatch(4096, undefined, {}), null);
  });

  test("a missing query vector cannot mismatch (keyword path)", () => {
    assert.strictEqual(checkVectorDimMatch(null, 4096, {}), null);
  });
});

describe("U-CFG/T13: buildRetrievalReport — resolved config in, measured truth out", () => {
  // A body that resolves cleanly on a vector-bearing strategy.
  const baseBody = {
    embedUrl: "http://ollama:11434/v1",
    embedModel: "qwen3-embedding:8b",
  };
  const resolve = (overrides = {}) => {
    const resolved = resolveRetrievalConfig({ ...baseBody, ...overrides });
    assert.strictEqual(resolved.ok, true, "fixture body must resolve");
    return resolved.config;
  };
  const rows = (scores) => scores.map((s, i) => ({ text: `c${i}`, rerankScore: s }));

  test("rerank-on: searchLimitUsed echoes the resolver's poolSize (= candidatesToRerank)", () => {
    const cfg = resolve({ candidatesToRerank: 10, limit: 100, keepTopNAfterRerank: 8 });
    const report = buildRetrievalReport({
      cfg,
      candidatesReturned: 10,
      results: rows([0.9, 0.4, 0.2]),
      floorApplied: true,
    });
    assert.strictEqual(report.searchLimitUsed, 10);
    assert.strictEqual(report.searchLimitUsed, cfg.poolSize);
    // Cut-over review (§11b M9): the report names the class read and the version.
    assert.strictEqual(report.collection, cfg.weaviateCollection);
    assert.strictEqual(report.schemaVersion, cfg.schemaVersion);
    assert.match(report.collection, /V2$/, "no version in the request → the default (2) → the suffixed class is what was read");
    assert.strictEqual(report.candidatesReturned, 10);
    assert.strictEqual(report.resultsReturned, 3);
    assert.strictEqual(report.rerankEffective, true);
    assert.strictEqual(report.thresholdApplied.floorSource, "rerank");
    assert.strictEqual(report.thresholdApplied.floorApplied, true);
    assert.strictEqual(report.nullScoreCount, 0);
    assert.strictEqual(report.scoreStats.count, 3);
    assert.strictEqual(report.scoreStats.min, 0.2);
    assert.strictEqual(report.scoreStats.max, 0.9);
    assert.strictEqual(report.scoreStats.allEqual, false);
  });

  test("rerank-off: the pool is max(limit, keepTopN) — FM-T1's collapse is visible, not silent", () => {
    const cfg = resolve({ rerankEnabled: false, limit: 20, keepTopNAfterRerank: 8 });
    const report = buildRetrievalReport({
      cfg,
      candidatesReturned: 20,
      results: [{ text: "c0" }, { text: "c1" }], // no rerankScore key at all
      floorApplied: false,
    });
    assert.strictEqual(report.searchLimitUsed, 20, "rerank-off pool must not collapse to keepTopN");
    assert.strictEqual(report.rerankEffective, false);
    assert.strictEqual(report.thresholdApplied.floorSource, "none");
    assert.strictEqual(report.thresholdApplied.floorApplied, false);
    // Honest but degenerate until T10: unscored rows count as null-scored.
    assert.strictEqual(report.nullScoreCount, 2);
    assert.strictEqual(report.scoreStats, null, "no real scores → no stats, never fabricated ones");
  });

  test("the F-26 signature is computable: a uniform 0.5 set reports allEqual", () => {
    const cfg = resolve({});
    const report = buildRetrievalReport({
      cfg,
      candidatesReturned: 8,
      results: rows([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
      floorApplied: true,
    });
    assert.strictEqual(report.scoreStats.allEqual, true);
    assert.strictEqual(report.scoreStats.distinct, 1);
    assert.strictEqual(report.scoreStats.min, 0.5);
    assert.strictEqual(report.scoreStats.max, 0.5);
  });

  test("a single score is not 'allEqual' — the signature needs a band, not a point", () => {
    const report = buildRetrievalReport({
      cfg: resolve({}),
      candidatesReturned: 1,
      results: rows([0.5]),
      floorApplied: true,
    });
    assert.strictEqual(report.scoreStats.allEqual, false);
  });

  test("the rerank-throw path: floorApplied false distinguishes 'never floored' from 'floored fabricated scores'", () => {
    const cfg = resolve({});
    const report = buildRetrievalReport({
      cfg,
      candidatesReturned: 8,
      results: [{ text: "c0" }],
      floorApplied: false, // the route's catch path — the floor never ran
    });
    assert.strictEqual(report.rerankEffective, true, "the reranker was configured…");
    assert.strictEqual(report.thresholdApplied.floorSource, "rerank", "…and owns the floor…");
    assert.strictEqual(report.thresholdApplied.floorApplied, false, "…but it never executed");
  });

  test("mixed null and real scores: stats cover the real ones, the count covers the rest (T10's vocabulary)", () => {
    const report = buildRetrievalReport({
      cfg: resolve({}),
      candidatesReturned: 5,
      results: [...rows([0.8, 0.3]), { text: "c2", rerankScore: null }, { text: "c3" }],
      floorApplied: true,
    });
    assert.strictEqual(report.nullScoreCount, 2);
    assert.strictEqual(report.scoreStats.count, 2);
    assert.strictEqual(report.scoreStats.max, 0.8);
  });

  test("empty results: zero counts, null stats — a report of work, not a fabrication of it", () => {
    const report = buildRetrievalReport({
      cfg: resolve({}),
      candidatesReturned: 0,
      results: [],
      floorApplied: true,
    });
    assert.strictEqual(report.candidatesReturned, 0);
    assert.strictEqual(report.resultsReturned, 0);
    assert.strictEqual(report.nullScoreCount, 0);
    assert.strictEqual(report.scoreStats, null);
  });
});

describe("U-CFG banned literals: the wrong embedding defaults are gone", () => {
  // F-12: the shipped defaults named a 2560-dim model against 4096-dim
  // collections. This walks src/ so the literals cannot creep back in.
  const SRC_ROOT = path.join(__dirname, "..", "..", "src");
  const BANNED = ["Qwen/Qwen3-Embedding-4B", "nv-embedqa"];

  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
    });
  }

  test("no source file names the wrong embedding model or its endpoint", () => {
    const offenders = [];
    for (const file of walk(SRC_ROOT)) {
      const text = fs.readFileSync(file, "utf-8");
      for (const banned of BANNED) {
        if (text.includes(banned)) {
          offenders.push(`${path.relative(SRC_ROOT, file)}: ${banned}`);
        }
      }
    }
    assert.deepStrictEqual(offenders, []);
  });
});

/**
 * T05 — schemaVersion resolves through the one resolver, and the `V2` class
 * suffix is applied there so every read path sees the class that was read.
 * Cut-over (design D1 / D2 / D4): the default is 2, resolved by ONE pure
 * function — resolveSchemaVersion — that every reader calls; `schemaVersion:
 * 1` (top-level or ragSettings) is the one-release override, read and write;
 * rollback is the constant.
 */
describe("U-CFG: schemaVersion and the v2 class suffix (T05; default 2 since the cut-over, D1 / D2)", () => {
  const { normaliseSchemaVersion, collectionNameForVersion, resolveSchemaVersion } = require("../../src/lib/rag/config");
  const base = { searchStrategy: "keyword" };

  test("the default is v2 and the collection is suffixed (the cut-over's flip, D1); the explicit v1 flag reads exactly as before (D4)", () => {
    assert.strictEqual(RETRIEVAL_DEFAULTS.schemaVersion, 2);
    const r = resolveRetrievalConfig({ ...base, weaviateCollection: "RAGEval_x" });
    assert.strictEqual(r.config.schemaVersion, 2);
    assert.strictEqual(r.config.weaviateCollection, "RAGEval_xV2");
    assert.strictEqual(resolveRetrievalConfig(base).config.weaviateCollection, "RAGChunkV2");
    // The override: the same flag as 1, top-level or in ragSettings — the v1
    // class, unsuffixed, byte-identical to the pre-cut-over default.
    for (const body of [{ ...base, weaviateCollection: "RAGEval_x", schemaVersion: 1 }, { ...base, weaviateCollection: "RAGEval_x", ragSettings: { schemaVersion: 1 } }, { ...base, weaviateCollection: "RAGEval_x", schemaVersion: "1" }]) {
      const v1 = resolveRetrievalConfig(body);
      assert.strictEqual(v1.config.schemaVersion, 1, JSON.stringify(body));
      assert.strictEqual(v1.config.weaviateCollection, "RAGEval_x", JSON.stringify(body));
    }
    assert.strictEqual(resolveRetrievalConfig({ ...base, schemaVersion: 1 }).config.weaviateCollection, "RAGChunk");
  });

  test("2 or \"2\" selects v2 and suffixes the collection; an UNSET value takes the default (2); any other explicit value is v1 by the normaliser's rule", () => {
    for (const v of [2, "2"]) {
      const r = resolveRetrievalConfig({ ...base, weaviateCollection: "RAGEval_x", ragSettings: { schemaVersion: v } });
      assert.strictEqual(r.config.schemaVersion, 2, JSON.stringify(v));
      assert.strictEqual(r.config.weaviateCollection, "RAGEval_xV2");
      assert.match(r.config.weaviateCollection, /^RAGEval_[A-Za-z0-9_]+$/, "still inside the harness guard");
    }
    // Garbage is v1 (the normaliser's rule: an explicit wrong value is not
    // "unset"); null / undefined ARE unset and fall through to the default.
    for (const v of [1, "1", "v2", 3, true, ""]) {
      assert.strictEqual(normaliseSchemaVersion(v), 1, JSON.stringify(v));
      const r = resolveRetrievalConfig({ ...base, weaviateCollection: "RAGEval_x", ragSettings: { schemaVersion: v } });
      assert.strictEqual(r.config.weaviateCollection, "RAGEval_x", JSON.stringify(v));
    }
    for (const v of [null, undefined]) {
      const r = resolveRetrievalConfig({ ...base, weaviateCollection: "RAGEval_x", ragSettings: { schemaVersion: v } });
      assert.strictEqual(r.config.weaviateCollection, "RAGEval_xV2", `${JSON.stringify(v)} is unset → the default`);
    }
  });

  test("resolveSchemaVersion is the one function every reader calls (D1): top-level > ragSettings > the constant, on a body, an admin-config blob or nothing", () => {
    assert.strictEqual(resolveSchemaVersion(), 2);
    assert.strictEqual(resolveSchemaVersion({}), 2);
    assert.strictEqual(resolveSchemaVersion({ ragSettings: null }), 2);
    assert.strictEqual(resolveSchemaVersion({ ragSettings: "junk" }), 2);
    assert.strictEqual(resolveSchemaVersion({ schemaVersion: 1 }), 1);
    assert.strictEqual(resolveSchemaVersion({ schemaVersion: "1" }), 1);
    assert.strictEqual(resolveSchemaVersion({ ragSettings: { schemaVersion: 1 } }), 1);
    assert.strictEqual(resolveSchemaVersion({ ragSettings: { schemaVersion: "2" } }), 2);
    assert.strictEqual(resolveSchemaVersion({ schemaVersion: 2, ragSettings: { schemaVersion: 1 } }), 2, "top-level wins");
    assert.strictEqual(resolveSchemaVersion({ schemaVersion: 1, ragSettings: { schemaVersion: 2 } }), 1, "top-level wins the other way too");
    assert.strictEqual(resolveSchemaVersion({ schemaVersion: null, ragSettings: { schemaVersion: 1 } }), 1, "a null top-level is unset, not garbage");
    assert.strictEqual(resolveSchemaVersion({ schemaVersion: "v2" }), 1, "an explicit wrong value is v1, never the default");
    // The resolver agrees with it on every shape above.
    for (const body of [{}, { schemaVersion: 1 }, { ragSettings: { schemaVersion: 1 } }, { schemaVersion: 2, ragSettings: { schemaVersion: 1 } }, { schemaVersion: "v2" }]) {
      assert.strictEqual(resolveRetrievalConfig({ ...base, ...body }).config.schemaVersion, resolveSchemaVersion(body), JSON.stringify(body));
    }
    // Rollback is the constant: nothing else in the chain names a 2.
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "lib", "rag", "config.js"), "utf8");
    const fn = src.slice(src.indexOf("function resolveSchemaVersion("), src.indexOf("const STRATEGIES"));
    assert.match(fn, /: RETRIEVAL_DEFAULTS\.schemaVersion\s*\)/, "the fallback is the constant, not a literal");
    assert.ok(!/\b2\b/.test(fn.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "no literal 2 inside the function body");
  });

  test("F-75 (cut-over D14): the retrieve-side EMBED_MODEL_MISMATCH text names the fix Weaviate accepts — clear, then re-ingest — aligned with T16 D6's ingest-side wording", () => {
    const err = checkVectorDimMatch(2560, 4096, { embedModel: "Qwen/Qwen3-Embedding-4B", collection: "RAGEval_x" });
    assert.match(err.message, /Tidy Up \(clear\) the collection and re-ingest every document with 'Qwen\/Qwen3-Embedding-4B'/);
    assert.ok(!/re-ingest the corpus with/.test(err.message), "never the bare re-ingest a v2 class refuses after the whole parse (F-75)");
    assert.match(err.message, /set the embedding model to the one that built the collection/, "fix 1 unchanged");
  });

  test("top-level beats ragSettings, like every other knob", () => {
    const r = resolveRetrievalConfig({ ...base, schemaVersion: 1, ragSettings: { schemaVersion: 2, weaviateCollection: "RAGEval_x" } });
    assert.strictEqual(r.config.schemaVersion, 1);
    assert.strictEqual(r.config.weaviateCollection, "RAGEval_x");
    const r2 = resolveRetrievalConfig({ ...base, schemaVersion: 2, ragSettings: { schemaVersion: 1, weaviateCollection: "RAGEval_x" } });
    assert.strictEqual(r2.config.weaviateCollection, "RAGEval_xV2");
  });

  test("the suffix is applied to the default too, so a v2 read of the demo's own collection names RAGChunkV2", () => {
    assert.strictEqual(collectionNameForVersion("RAGChunk", 2), "RAGChunkV2");
    assert.strictEqual(collectionNameForVersion("RAGChunk", 1), "RAGChunk");
    assert.strictEqual(resolveRetrievalConfig({ ...base, schemaVersion: 2 }).config.weaviateCollection, "RAGChunkV2");
  });
});

/**
 * T16 — the two pin verdicts (design D2–D8) and the third degraded prompt
 * branch (D11). Pure: the pin is data from the ledger's reducer, the store's
 * live dimension is a number the route read; nothing here touches a file or
 * the network, so the whole truth table runs on every `npm test`.
 */
describe("U-CFG/T16: checkEmbedModelPinForIngest — the ingest-time 409 (design D3, D4, D5, D6)", () => {
  const { checkEmbedModelPinForIngest } = require("../../src/lib/rag/config");
  const M8 = "qwen3-embedding:8b";
  const M4 = "Qwen/Qwen3-Embedding-4B";
  const pin = (over = {}) => ({ collection: "RAGEval_xV2", embedModel: M8, embedDim: 4096, enforceable: true, pinnedAt: "2026-09-05T19:41:00.000Z", pinnedBy: "j1", source: "file_indexed", since: null, modelsSeen: [M8], landedRecords: 4, ...over });

  test("no pin, or a pin with no name → proceed (nothing to protect; the first landed record pins)", () => {
    assert.strictEqual(checkEmbedModelPinForIngest(null, { embedModel: M4, storeDim: 4096 }), null);
    assert.strictEqual(checkEmbedModelPinForIngest(undefined, { embedModel: M4, storeDim: null }), null);
    assert.strictEqual(checkEmbedModelPinForIngest(pin({ embedModel: null, embedDim: null, enforceable: false, source: null }), { embedModel: M4, storeDim: 4096 }), null, "after a clear");
  });

  test("a PROVISIONAL pin never refuses, whatever the name (D5)", () => {
    assert.strictEqual(checkEmbedModelPinForIngest(pin({ enforceable: false, embedDim: null, source: "collection_created" }), { embedModel: M4, storeDim: null }), null);
    assert.strictEqual(checkEmbedModelPinForIngest(pin({ enforceable: false, embedDim: null, source: "collection_created" }), { embedModel: M4, storeDim: 4096 }), null);
  });

  test("the name matches → proceed", () => {
    assert.strictEqual(checkEmbedModelPinForIngest(pin(), { embedModel: M8, storeDim: 4096 }), null);
    assert.strictEqual(checkEmbedModelPinForIngest(pin(), { embedModel: ` ${M8} `, storeDim: 4096 }), null, "whitespace is not a different model");
  });

  test("the name differs and the store's live dimension equals the pin's → 409 EMBED_MODEL_MISMATCH naming both models, the dimension, the date and BOTH fixes (D6)", () => {
    const r = checkEmbedModelPinForIngest(pin(), { embedModel: M4, storeDim: 4096 });
    assert.ok(r);
    assert.strictEqual(r.code, "EMBED_MODEL_MISMATCH");
    assert.strictEqual(r.status, 409);
    assert.match(r.message, /RAGEval_xV2/);
    assert.match(r.message, /'qwen3-embedding:8b'/);
    assert.match(r.message, /'Qwen\/Qwen3-Embedding-4B'/);
    assert.match(r.message, /4096 dimensions/);
    assert.match(r.message, /recorded 2026-09-05T19:41/);
    assert.match(r.message, /Nothing was ingested/);
    assert.match(r.message, /set the embedding model back to 'qwen3-embedding:8b'/, "fix 1: restore the pinned model");
    assert.match(r.message, /Tidy Up \(clear\) the collection and re-ingest every document with 'Qwen\/Qwen3-Embedding-4B'/, "fix 2: clear, then re-ingest with the new one");
    assert.ok(!/re-ingest the corpus with/.test(r.message), "never T08's bare 're-ingest with the new model' — Weaviate refuses it without a clear (§0 step 3)");
    assert.deepStrictEqual(r.pin, { embedModel: M8, embedDim: 4096, pinnedAt: "2026-09-05T19:41:00.000Z", modelsSeen: [M8] });
    assert.ok(!/more than one model/.test(r.message));
  });

  test("the name differs and the class is EMPTY or its dimension UNREADABLE → 409 (nothing contradicts the record), and the message says the store did not confirm it", () => {
    for (const storeDim of [null, undefined, 0, NaN]) {
      const r = checkEmbedModelPinForIngest(pin(), { embedModel: M4, storeDim });
      assert.ok(r && r.status === 409, `storeDim ${String(storeDim)}`);
      assert.match(r.message, /could not be read to confirm/, `storeDim ${String(storeDim)}: the person is told the store was not consulted`);
    }
    assert.ok(!/could not be read/.test(checkEmbedModelPinForIngest(pin(), { embedModel: M4, storeDim: 4096 }).message), "a confirmed refusal does not carry the caveat");
    assert.match(checkEmbedModelPinForIngest(pin({ pinnedAt: null }), { embedModel: M4, storeDim: 4096 }).message, /recorded at an unknown time/, "never 'recorded null'");
  });

  test("the name differs and the store's live dimension CONTRADICTS the pin → proceed (a stale pin never locks, D4)", () => {
    assert.strictEqual(checkEmbedModelPinForIngest(pin(), { embedModel: M4, storeDim: 2560 }), null);
    // the comparison is against the PIN's dimension, not a literal 4096 (review)
    const p2560 = pin({ embedModel: M4, embedDim: 2560, modelsSeen: [M4] });
    assert.ok(checkEmbedModelPinForIngest(p2560, { embedModel: M8, storeDim: 2560 }), "2560 pin, 2560 store, other name → 409");
    assert.match(checkEmbedModelPinForIngest(p2560, { embedModel: M8, storeDim: 2560 }).message, /2560 dimensions/);
    assert.strictEqual(checkEmbedModelPinForIngest(p2560, { embedModel: M8, storeDim: 4096 }), null, "2560 pin, 4096 store → stale, proceed");
  });

  test("a mixed record (modelsSeen > 1) is disclosed in the refusal", () => {
    const r = checkEmbedModelPinForIngest(pin({ modelsSeen: [M8, "qwen3-embedding:8b-alias"] }), { embedModel: M4, storeDim: 4096 });
    assert.match(r.message, /record names more than one model \(qwen3-embedding:8b, qwen3-embedding:8b-alias\)/);
  });

  test("the verdict is pure: the pin object is not mutated and no field is fabricated", () => {
    const p = pin();
    const snapshot = JSON.stringify(p);
    checkEmbedModelPinForIngest(p, { embedModel: M4, storeDim: 4096 });
    assert.strictEqual(JSON.stringify(p), snapshot);
  });
});

describe("U-CFG/T16: checkEmbedModelPinForQuery + buildEmbedSpaceReport — the same-dim warning on retrieve (design D7, D8)", () => {
  const { checkEmbedModelPinForQuery, buildEmbedSpaceReport } = require("../../src/lib/rag/config");
  const M8 = "qwen3-embedding:8b";
  const ALIAS = "qwen3-embedding:8b-alias";
  const pin = (over = {}) => ({ collection: "RAGEval_xV2", embedModel: M8, embedDim: 4096, enforceable: true, pinnedAt: "t1", pinnedBy: "j1", source: "file_indexed", since: null, modelsSeen: [M8], landedRecords: 4, ...over });

  test("no pin (a class with no record — D8) → no degradation, verdict no_pin", () => {
    assert.strictEqual(checkEmbedModelPinForQuery(null, { embedModel: ALIAS, queryDim: 4096 }), null);
    assert.deepStrictEqual(buildEmbedSpaceReport(null, { embedModel: ALIAS, queryDim: 4096 }), { queryModel: ALIAS, queryDim: 4096, pinnedModel: null, pinnedDim: null, pinSource: null, verdict: "no_pin" });
    const unavailable = buildEmbedSpaceReport(null, { embedModel: ALIAS, queryDim: 4096, pinSource: "ledger_unavailable" });
    assert.strictEqual(unavailable.verdict, "no_pin");
    assert.strictEqual(unavailable.pinSource, "ledger_unavailable", "an unreadable ledger is said, not hidden");
  });

  test("a provisional pin → no degradation, verdict no_pin with its source", () => {
    const p = pin({ enforceable: false, embedDim: null, source: "collection_created" });
    assert.strictEqual(checkEmbedModelPinForQuery(p, { embedModel: ALIAS, queryDim: 4096 }), null);
    const r = buildEmbedSpaceReport(p, { embedModel: ALIAS, queryDim: 4096 });
    assert.strictEqual(r.verdict, "no_pin");
    assert.strictEqual(r.pinSource, "collection_created");
    assert.strictEqual(r.pinnedModel, M8, "the provisional name is reported");
  });

  test("the name matches → no degradation, verdict match", () => {
    assert.strictEqual(checkEmbedModelPinForQuery(pin(), { embedModel: M8, queryDim: 4096 }), null);
    assert.deepStrictEqual(buildEmbedSpaceReport(pin(), { embedModel: M8, queryDim: 4096 }), { queryModel: M8, queryDim: 4096, pinnedModel: M8, pinnedDim: 4096, pinSource: "file_indexed", verdict: "match" });
  });

  test("same dimension, another name → a DEGRADATION on the 200 (stage embed, T08's code), naming both models, the shared dimension and the fix", () => {
    const d = checkEmbedModelPinForQuery(pin(), { embedModel: ALIAS, queryDim: 4096 });
    assert.deepStrictEqual(Object.keys(d).sort(), ["code", "message", "stage"]);
    assert.strictEqual(d.stage, "embed");
    assert.strictEqual(d.code, "EMBED_MODEL_MISMATCH");
    assert.match(d.message, /'qwen3-embedding:8b-alias'/);
    assert.match(d.message, /'qwen3-embedding:8b'/);
    assert.match(d.message, /RAGEval_xV2/);
    assert.match(d.message, /same 4096 dimensions/);
    assert.match(d.message, /relevant passages may be missing/);
    assert.match(d.message, /Fix: set the embedding model to 'qwen3-embedding:8b'/);
    assert.ok(!("success" in d), "a degradation is not an error body");
    assert.strictEqual(buildEmbedSpaceReport(pin(), { embedModel: ALIAS, queryDim: 4096 }).verdict, "name_mismatch");
  });

  test("another DIMENSION is T08's guard's, not this check's: no second verdict, verdict stale_pin", () => {
    // If the query reached here with a different dimension, T08's live
    // dimension check passed — the STORE agrees with the query and the
    // ledger's pin is behind (the class was rebuilt out of band, rule 4
    // re-pins on the next write). Degrading here would blame a healthy query.
    assert.strictEqual(checkEmbedModelPinForQuery(pin(), { embedModel: "Qwen/Qwen3-Embedding-4B", queryDim: 2560 }), null);
    assert.strictEqual(buildEmbedSpaceReport(pin(), { embedModel: "Qwen/Qwen3-Embedding-4B", queryDim: 2560 }).verdict, "stale_pin");
    // against the PIN's dimension, not a literal (review)
    const p2560 = pin({ embedModel: "Qwen/Qwen3-Embedding-4B", embedDim: 2560, modelsSeen: ["Qwen/Qwen3-Embedding-4B"] });
    assert.ok(checkEmbedModelPinForQuery(p2560, { embedModel: ALIAS, queryDim: 2560 }), "2560 pin, 2560 query, other name → degradation");
    assert.strictEqual(checkEmbedModelPinForQuery(p2560, { embedModel: ALIAS, queryDim: 4096 }), null);
    assert.strictEqual(buildEmbedSpaceReport(p2560, { embedModel: ALIAS, queryDim: 4096 }).verdict, "stale_pin");
  });

  test("a mixed record is disclosed in the warning too", () => {
    const d = checkEmbedModelPinForQuery(pin({ modelsSeen: [M8, "other"] }), { embedModel: ALIAS, queryDim: 4096 });
    assert.match(d.message, /record names more than one model/);
  });
});

describe("U-CFG/T16: the third degraded prompt branch — recall, not order (design D11)", () => {
  const { buildRetrievalPromptBlock, RETRIEVAL_ERROR_CODES } = require("../../src/lib/rag/config");
  const context = "[Retrieved Specification Sheets & Passages]\nchunk text here";
  const mismatch = { state: "degraded", code: RETRIEVAL_ERROR_CODES.EMBED_MODEL_MISMATCH, message: "the query was embedded by 'a' but collection 'X' was indexed by 'b' (same 4096 dimensions); relevant passages may be missing." };

  test("EMBED_MODEL_MISMATCH keeps the context, warns that passages may be MISSING, and forbids claiming absence", () => {
    const block = buildRetrievalPromptBlock(mismatch, context);
    assert.ok(block.includes(context), "real results must survive the degradation");
    // The classifier reports ONE code; a rerank degradation may sit behind
    // this one on the same response, so the branch must not vouch for the
    // ranking (review).
    assert.ok(!/ranking .* is real/.test(block) && !/relevance-ranked, but/.test(block), "the branch must not claim the ranking is real — the reranker may have failed on the same turn");
    assert.match(block, /CONTEXT MAY BE INCOMPLETE \(EMBED_MODEL_MISMATCH\)/);
    assert.match(block, /different embedding model/);
    assert.match(block, /may be MISSING/);
    assert.match(block, /MUST NOT (say|claim) the documents? (do not|does not|lack)/i, "absence must not be asserted from an incomplete context");
    assert.match(block, /set the embedding model back to the one named above/, "the fix is named (review: /embedding model/ alone was satisfied two lines earlier)");
    assert.ok(block.includes(mismatch.message), "the route's message reaches the model");
  });

  test("it does NOT carry the rerank wording: the ranking of what came back is real", () => {
    const block = buildRetrievalPromptBlock(mismatch, context);
    assert.ok(!/ORDER as meaningless/.test(block), "the reranker did rank what came back");
    assert.ok(!/NOT RELEVANCE-RANKED/.test(block));
    assert.ok(!/NOT RELEVANCE-CHECKED/.test(block));
    assert.ok(!/listed LAST/.test(block));
  });

  test("one code, one instruction: the three degraded branches differ from each other and the generic fallback still exists", () => {
    const down = buildRetrievalPromptBlock({ state: "degraded", code: "RERANK_DOWN", message: "x." }, context);
    const partial = buildRetrievalPromptBlock({ state: "degraded", code: "RERANK_PARTIAL", message: "x." }, context);
    const embed = buildRetrievalPromptBlock(mismatch, context);
    const future = buildRetrievalPromptBlock({ state: "degraded", code: "SOME_FUTURE_CODE", message: "x." }, context);
    assert.notStrictEqual(embed, down);
    assert.notStrictEqual(embed, partial);
    assert.notStrictEqual(embed, future);
    assert.match(future, /NOT RELEVANCE-RANKED \(SOME_FUTURE_CODE\)/, "an unknown code still takes the conservative wording");
  });
});

// ── T15 (t15-design.md D4): the optional document filter ─────────────────────
describe("U-CFG/T15: documentFilter — request-level, normalised, null when empty; the report carries what was applied", () => {
  const { resolveRetrievalConfig, normaliseDocumentFilter, buildRetrievalReport } = require("../../src/lib/rag/config");
  const { test } = require("node:test");
  const assert = require("node:assert");
  test("normalised: trimmed, de-duplicated, non-strings dropped; nothing → null; never read from ragSettings", () => {
    assert.deepStrictEqual(normaliseDocumentFilter({ sourceIds: [" a ", "a", 3, ""], sources: ["S.pdf"] }), { sourceIds: ["a"], sources: ["S.pdf"] });
    assert.strictEqual(normaliseDocumentFilter({ sourceIds: [], sources: [] }), null);
    assert.strictEqual(normaliseDocumentFilter(null), null);
    assert.strictEqual(normaliseDocumentFilter(["x"]), null);
    const r = resolveRetrievalConfig({ searchStrategy: "keyword", documentFilter: { sources: ["S.pdf"] }, ragSettings: { documentFilter: { sources: ["T.pdf"] } } });
    assert.deepStrictEqual(r.config.documentFilter, { sourceIds: [], sources: ["S.pdf"] });
    assert.strictEqual(resolveRetrievalConfig({ searchStrategy: "keyword", ragSettings: { documentFilter: { sources: ["T.pdf"] } } }).config.documentFilter, null, "the blob cannot carry a filter (a request field, like the scope)");
    assert.strictEqual(resolveRetrievalConfig({ searchStrategy: "keyword" }).config.documentFilter, null, "absent by default — the legs' requests are unchanged");
  });
  test("the report: null without a filter, the applied block with one", () => {
    const base = { searchStrategy: "hybrid", weaviateCollection: "X", schemaVersion: 2, poolSize: 10, keepTopNAfterRerank: 8, rerankEffective: true, floorSource: "rerank", minRerankScore: 0.05, similarityThreshold: 0 };
    assert.strictEqual(buildRetrievalReport({ cfg: base, candidatesReturned: 0, results: [], floorApplied: false, candidatesScored: null }).documentFilter, null);
    const f = { requested: { sourceIds: 1, sources: [] }, applied: "sourceId", candidatesBeforePostCheck: 5, droppedByPostCheck: 0 };
    assert.deepStrictEqual(buildRetrievalReport({ cfg: base, candidatesReturned: 5, results: [], floorApplied: false, candidatesScored: null, documentFilter: f }).documentFilter, f);
  });
});

describe("U-CFG/T36: the generator's codes live in the one taxonomy (t36-design D1 / D2; F-134)", () => {
  test("GENERATION_CUT and GENERATION_EMPTY are their own strings, frozen beside RERANK_PARTIAL", () => {
    assert.strictEqual(RETRIEVAL_ERROR_CODES.GENERATION_CUT, "GENERATION_CUT");
    assert.strictEqual(RETRIEVAL_ERROR_CODES.GENERATION_EMPTY, "GENERATION_EMPTY");
    assert.strictEqual(RETRIEVAL_ERROR_CODES.RERANK_PARTIAL, "RERANK_PARTIAL");
    assert.ok(Object.isFrozen(RETRIEVAL_ERROR_CODES), "the taxonomy is frozen");
  });
});

describe("U-CFG/T40: searchProperties — the keyword half's property list (t40-design.md D3, D4, D6; audit E23)", () => {
  const {
    SEARCHABLE_V1_PROPERTIES,
    SEARCH_PROPERTIES_UNRESTRICTED,
    normaliseSearchProperties,
    RAG_SETTINGS_API_ONLY_KEYS,
    RAG_SETTINGS_DEFAULTS,
  } = require("../../src/lib/rag/config");
  const keyword = (extra = {}) => resolveRetrievalConfig({ searchStrategy: "keyword", ...extra });

  test("the default is [\"text\"] — one property, frozen, and the resolver's value is a copy of it", () => {
    assert.deepStrictEqual([...RETRIEVAL_DEFAULTS.searchProperties], ["text"]);
    assert.ok(Object.isFrozen(RETRIEVAL_DEFAULTS.searchProperties));
    const r = keyword();
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.config.searchProperties, ["text"]);
    assert.notStrictEqual(r.config.searchProperties, RETRIEVAL_DEFAULTS.searchProperties, "a copy, never the frozen default itself");
    // Every mode resolves it — the count path sends `keyword` (T09), hybrid is the demo's.
    assert.deepStrictEqual(resolveRetrievalConfig({ embedUrl: "u", embedModel: "m" }).config.searchProperties, ["text"]);
    assert.deepStrictEqual(resolveRetrievalConfig({ searchStrategy: "vector", embedUrl: "u", embedModel: "m" }).config.searchProperties, ["text"]);
  });

  test("precedence: top-level > ragSettings > default; \"unrestricted\" (any case) is null at either level", () => {
    assert.deepStrictEqual(keyword({ searchProperties: ["text", "sectionTitle"], ragSettings: { searchProperties: "unrestricted" } }).config.searchProperties, ["text", "sectionTitle"]);
    assert.strictEqual(keyword({ ragSettings: { searchProperties: "unrestricted" } }).config.searchProperties, null);
    assert.strictEqual(keyword({ searchProperties: "Unrestricted" }).config.searchProperties, null);
    assert.strictEqual(keyword({ searchProperties: " UNRESTRICTED " }).config.searchProperties, null);
    assert.deepStrictEqual(keyword({ ragSettings: { searchProperties: ["sectionNumber", "text"] } }).config.searchProperties, ["sectionNumber", "text"]);
    assert.deepStrictEqual(keyword({ searchProperties: [], ragSettings: { searchProperties: "unrestricted" } }).config.searchProperties, ["text"], "an empty top-level list is the default, not the blob's value");
    assert.strictEqual(SEARCH_PROPERTIES_UNRESTRICTED, "unrestricted");
  });

  test("sanitising: unknown names dropped, order kept, duplicates and non-strings removed, an emptied list or a stray string is the default", () => {
    assert.deepStrictEqual(normaliseSearchProperties(["sectionTitle", " text ", "nope", "text", 7, null, "metadata"]), ["sectionTitle", "text", "metadata"]);
    assert.deepStrictEqual(normaliseSearchProperties(["nope", "zzz"]), ["text"]);
    assert.deepStrictEqual(normaliseSearchProperties("text"), ["text"], "a bare string other than 'unrestricted' is the default");
    assert.deepStrictEqual(normaliseSearchProperties({ text: true }), ["text"]);
    assert.deepStrictEqual(normaliseSearchProperties(undefined), ["text"]);
    assert.deepStrictEqual(normaliseSearchProperties(null), ["text"]);
    assert.strictEqual(normaliseSearchProperties("unrestricted"), null);
    assert.deepStrictEqual(normaliseSearchProperties(["source"], ["metadata"]), ["source"]);
    assert.deepStrictEqual(normaliseSearchProperties([], ["metadata"]), ["metadata"], "the fallback is the caller's");
  });

  test("the searchable set is the v1 class's nine text columns, and searchProperties is an API-only blob key (no drawer control, not a default)", () => {
    assert.deepStrictEqual([...SEARCHABLE_V1_PROPERTIES], ["text", "source", "fileType", "chapter", "sectionNumber", "sectionTitle", "docHash", "imagePath", "metadata"]);
    assert.ok(RAG_SETTINGS_API_ONLY_KEYS.includes("searchProperties"));
    assert.ok(!("searchProperties" in RAG_SETTINGS_DEFAULTS), "not a settings-table key: the drawer cannot set it (D3)");
  });

  test("the report says what the keyword half scored — measured off the search when the route supplies it, derived from the config otherwise", () => {
    const cfg = keyword().config;
    const base = { cfg, candidatesReturned: 3, results: [], floorApplied: true };
    assert.deepStrictEqual(buildRetrievalReport({ ...base, searchMode: "keyword", searchProperties: ["text"] }).searchProperties, { keywordHalf: true, properties: ["text"], unrestricted: false });
    assert.deepStrictEqual(buildRetrievalReport({ ...base, searchMode: "hybrid", searchProperties: ["text", "sectionTitle"] }).searchProperties, { keywordHalf: true, properties: ["text", "sectionTitle"], unrestricted: false });
    assert.deepStrictEqual(buildRetrievalReport({ ...base, searchMode: "keyword", searchProperties: null }).searchProperties, { keywordHalf: true, properties: null, unrestricted: true }, "the pre-T40 clause, said in one word");
    assert.deepStrictEqual(buildRetrievalReport({ ...base, searchMode: "vector", searchProperties: null }).searchProperties, { keywordHalf: false, properties: null, unrestricted: false }, "no keyword half ran: not 'unrestricted'");
    // Derived from the resolved config when the route did not measure it (an older caller).
    assert.deepStrictEqual(buildRetrievalReport(base).searchProperties, { keywordHalf: true, properties: ["text"], unrestricted: false });
    const vec = resolveRetrievalConfig({ searchStrategy: "vector", embedUrl: "u", embedModel: "m" }).config;
    assert.deepStrictEqual(buildRetrievalReport({ ...base, cfg: vec }).searchProperties, { keywordHalf: false, properties: null, unrestricted: false });
    const unres = keyword({ searchProperties: "unrestricted" }).config;
    assert.deepStrictEqual(buildRetrievalReport({ ...base, cfg: unres }).searchProperties, { keywordHalf: true, properties: null, unrestricted: true });
  });

  test("the report carries the collapse's result verbatim, and null when the stage did not run (D7)", () => {
    const cfg = keyword().config;
    const base = { cfg, candidatesReturned: 3, results: [], floorApplied: true };
    const collapsed = { count: 3, groups: [{ kept: { source: "s.pdf", page: 6, chunkIndex: 15, rerankScore: 0.074 }, dropped: [{ source: "s.pdf", page: 5, chunkIndex: 13, rerankScore: 0.072 }] }] };
    assert.deepStrictEqual(buildRetrievalReport({ ...base, repeatsCollapsed: collapsed }).repeatsCollapsed, collapsed);
    assert.deepStrictEqual(buildRetrievalReport({ ...base, repeatsCollapsed: { count: 0, groups: [] } }).repeatsCollapsed, { count: 0, groups: [] });
    assert.strictEqual(buildRetrievalReport(base).repeatsCollapsed, null);
  });
});

describe("U-CFG/T40 A9: collapseRepeats — a count turn sees every chunk (design D7)", () => {
  const fs = require("fs");
  const path = require("path");
  test("the default is on; a request-level boolean is honoured; a non-boolean or the blob is ignored", () => {
    assert.strictEqual(RETRIEVAL_DEFAULTS.collapseRepeats, true);
    assert.strictEqual(resolveRetrievalConfig({ searchStrategy: "keyword" }).config.collapseRepeats, true);
    assert.strictEqual(resolveRetrievalConfig({ searchStrategy: "keyword", collapseRepeats: false }).config.collapseRepeats, false);
    assert.strictEqual(resolveRetrievalConfig({ searchStrategy: "keyword", collapseRepeats: "false" }).config.collapseRepeats, true, "a string is not a switch");
    assert.strictEqual(resolveRetrievalConfig({ searchStrategy: "keyword", ragSettings: { collapseRepeats: false } }).config.collapseRepeats, true, "a request-level field, never read from the blob (the T28 A3 rule)");
  });
  test("the orchestrator's aggregation override switches the collapse off beside its keyword / no-rerank / scan-limit knobs", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "orchestrator.js"), "utf8").replace(/\/\/[^\n]*/g, "");
    assert.match(src, /searchStrategy: "keyword",\s*similarityThreshold: 0,\s*rerankEnabled: false,\s*collapseRepeats: false,\s*limit: aggregationConfig\.scanLimit,/);
  });
  test("the route reports `applied` on the collapse either way", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "rag", "retrieve", "route.js"), "utf8");
    assert.match(src, /cfg\.collapseRepeats === false/);
    assert.match(src, /repeatsCollapsed = \{ count: 0, groups: \[\], applied: false \}/);
    assert.match(src, /repeatsCollapsed = \{ \.\.\.collapsed\.report, applied: true \}/);
  });
});

describe("U-CFG/T42: the rerank stage's per-request bounds and its deadline (t42-design.md D3, D4, D7; F-164)", () => {
  const { resolveRetrievalConfig: resolve42, RETRIEVAL_DEFAULTS: D42, RAG_SETTINGS_API_ONLY_KEYS: API42 } = require("../../src/lib/rag/config");
  const { RERANK_BATCH_DEFAULTS: B42 } = require("../../src/lib/rag/rerank_batches");
  const base = { embedUrl: "u", embedModel: "m" };
  test("the defaults are the pure module's: 28,000 chars / 16 documents per request, a 60 s deadline", () => {
    assert.strictEqual(D42.rerankMaxChars, B42.maxChars);
    assert.strictEqual(D42.rerankMaxDocs, B42.maxDocs);
    assert.strictEqual(D42.rerankBudgetMs, B42.budgetMs);
    const c = resolve42(base).config;
    assert.deepStrictEqual([c.rerankMaxChars, c.rerankMaxDocs, c.rerankBudgetMs], [28000, 16, 60000]);
  });
  test("precedence: the request's top-level value (the enumeration profile's rerankBudgetMs rides the router's overrides), then the blob's, then the default", () => {
    assert.strictEqual(resolve42({ ...base, rerankBudgetMs: 90000 }).config.rerankBudgetMs, 90000);
    assert.strictEqual(resolve42({ ...base, ragSettings: { rerankBudgetMs: 45000 } }).config.rerankBudgetMs, 45000);
    assert.strictEqual(resolve42({ ...base, rerankBudgetMs: 90000, ragSettings: { rerankBudgetMs: 45000 } }).config.rerankBudgetMs, 90000);
    assert.strictEqual(resolve42({ ...base, ragSettings: { rerankMaxChars: 12000, rerankMaxDocs: 8 } }).config.rerankMaxChars, 12000);
    assert.strictEqual(resolve42({ ...base, ragSettings: { rerankMaxChars: 12000, rerankMaxDocs: 8 } }).config.rerankMaxDocs, 8);
    // the harness's same-image "one request" arm: bounds no pool reaches
    const one = resolve42({ ...base, rerankMaxChars: 1e9, rerankMaxDocs: 1e6 }).config;
    assert.deepStrictEqual([one.rerankMaxChars, one.rerankMaxDocs], [1e9, 1e6]);
  });
  test("sanitised: a non-number, an empty string, a zero or a negative fall through; a fractional document count is floored", () => {
    assert.strictEqual(resolve42({ ...base, rerankBudgetMs: "soon" }).config.rerankBudgetMs, 60000);
    assert.strictEqual(resolve42({ ...base, rerankMaxChars: "" }).config.rerankMaxChars, 28000);
    assert.strictEqual(resolve42({ ...base, rerankMaxChars: 0 }).config.rerankMaxChars, 28000);
    assert.strictEqual(resolve42({ ...base, rerankMaxDocs: -3 }).config.rerankMaxDocs, 16);
    assert.strictEqual(resolve42({ ...base, rerankMaxDocs: 12.9 }).config.rerankMaxDocs, 12);
    assert.strictEqual(resolve42({ ...base, rerankMaxDocs: "10" }).config.rerankMaxDocs, 10);
  });
  test("API-only (D7): the three keys are on the list and none is a settings default (31 keys at T42, no guard bump; 32 since T48's beyondTheDocuments; 33 since T63's lookupDocumentRead)", () => {
    for (const k of ["rerankMaxChars", "rerankMaxDocs", "rerankBudgetMs"]) assert.ok(API42.includes(k), k);
    const { RAG_SETTINGS_DEFAULTS } = require("../../src/lib/rag/config");
    for (const k of ["rerankMaxChars", "rerankMaxDocs", "rerankBudgetMs"]) assert.ok(!(k in RAG_SETTINGS_DEFAULTS), `${k} is a default`);
    assert.strictEqual(Object.keys(RAG_SETTINGS_DEFAULTS).length, 33);
  });
});
