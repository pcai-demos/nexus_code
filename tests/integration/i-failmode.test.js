/**
 * I-FAILMODE — typed failures reach the user honestly (evaluation-plan §4.7,
 * ticket T12; gates FM-L7).
 *
 * This suite exists because a green eval suite is NOT evidence that the
 * application works. `tests/eval/run.js` calls /api/rag/retrieve directly, so
 * every T08 metric was green (absence 1.000, recall 1.000) while the live chat
 * path returned zero chunks (F-25). Anything whose value reaches users through
 * the orchestrator needs at least one /api/chat assertion — so the control case
 * below is deliberately an end-to-end chat request, not a retrieve call.
 *
 * Measured pre-T12 baseline for the EMBED_DOWN case (in-pod, session 5): the
 * chat answer was "Hesketh 4-Bedroom Home: Listed in index/legend/summary, but
 * no detailed specification section or data table is present in the document."
 * — a confident denial of content the control case retrieves correctly.
 *
 * Requires the live environment (see _harness.js) plus RAG_EVAL_COLLECTION
 * pointing at a populated RAGEval_* collection. RAG_EVAL_SCHEMA_VERSION states
 * that collection's class shape (default 1: this suite only ever READS the v1
 * T08 class) and is sent on every request — cut-over design D12.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { envConfig, skipReason, assertEvalCollection, evalSchemaVersion, postJson } = require("./_harness");

const config = envConfig();
const baseSkip = skipReason();
const SKIP =
  baseSkip ||
  (process.env.RAG_EVAL_COLLECTION
    ? false
    : "set RAG_EVAL_COLLECTION to a populated RAGEval_* collection (see I-INGEST)");

const collection = process.env.RAG_EVAL_COLLECTION
  ? assertEvalCollection(process.env.RAG_EVAL_COLLECTION)
  : null;
const SCHEMA_VERSION = evalSchemaVersion(1);

/** Connection-refused in one hop: no DNS wait, no retry ambiguity. */
const DEAD_PORT = "http://127.0.0.1:9";

/**
 * A question whose answer IS in the golden corpus. The point of every failure
 * case is that the corpus demonstrably contains this — so any answer claiming
 * it does not is a fabrication, not a correct "not found".
 */
const GROUNDED_QUESTION = "/doc What bedroom sizes does the Hesketh design have?";

/**
 * Values that exist only in the retrieved chunks. With retrieval down, an
 * answer containing any of them was invented — this is how "no invented
 * content" is asserted deterministically rather than by judging prose.
 */
const CORPUS_ONLY_VALUES = ["3684", "3175", "4076", "3532", "3220"];

/** Phrasings that assert absence. Honest only when retrieval actually ran. */
const ABSENCE_CLAIMS = [
  "No matching text passages",
  "no detailed specification section",
  "is not present in the document",
  "does not appear in the document",
  "not mentioned in the document",
];

function adminConfig(overrides = {}) {
  return {
    nimEndpoint: config.chatUrl,
    nimApiKey: config.token,
    nimModelName: config.chatModel,
    systemPrompt: "You are a helpful assistant.",
    temperature: 0,
    maxTokens: 1024,
    weaviateUrl: config.weaviateUrl,
    weaviateCollection: collection,
    mlisToken: config.token,
    embedApiKey: config.token,
    embedEndpoint: config.embedUrl,
    embedModelName: config.embedModel,
    rerankEndpointUrl: config.rerankUrl,
    rerankModelName: config.rerankModel,
    rerankApiKey: config.rerankToken,
    ragSettings: { weaviateCollection: collection, schemaVersion: SCHEMA_VERSION },
    forcedCommand: "/doc",
    ...overrides,
  };
}

function chat(message, cfgOverrides = {}) {
  return postJson(
    `${config.appUrl}/api/chat`,
    { message, history: [], adminConfig: adminConfig(cfgOverrides) },
    300000
  );
}

function retrieve(overrides = {}) {
  return postJson(`${config.appUrl}/api/rag/retrieve`, {
    query: "Hesketh bedroom dimensions",
    weaviateUrl: config.weaviateUrl,
    weaviateCollection: collection,
    schemaVersion: SCHEMA_VERSION,
    token: config.token,
    weaviateToken: config.token,
    // Rerank config is always explicit so these cases never inherit the module
    // default endpoint with the wrong credential — that combination degrades
    // silently (F-22) and would make the degradation assertions meaningless.
    rerankUrl: config.rerankUrl,
    rerankModel: config.rerankModel,
    rerankToken: config.rerankToken,
    ...overrides,
    embedUrl: overrides.embedUrl ?? config.embedUrl,
    embedModel: overrides.embedModel ?? config.embedModel,
  });
}

describe("I-FAILMODE: the retrieve route types its failures", () => {
  test("a dead embedding endpoint returns EMBED_DOWN, not an empty result set", { skip: SKIP }, async () => {
    const res = await retrieve({ embedUrl: `${DEAD_PORT}/v1` });
    assert.strictEqual(res.ok, false, "a dependency failure must not be a 200");
    assert.strictEqual(res.json.success, false);
    assert.strictEqual(res.json.code, "EMBED_DOWN", `expected EMBED_DOWN, got: ${res.text}`);
    assert.ok(!Array.isArray(res.json.results), "a failure must not carry results");
  });

  test("a dead Weaviate returns WEAVIATE_DOWN", { skip: SKIP }, async () => {
    const res = await retrieve({ weaviateUrl: DEAD_PORT, searchStrategy: "keyword" });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.json.code, "WEAVIATE_DOWN", `expected WEAVIATE_DOWN, got: ${res.text}`);
  });

  test("a missing query is typed too — no untyped error survives", { skip: SKIP }, async () => {
    const res = await retrieve({ query: "" });
    assert.strictEqual(res.status, 400);
    assert.ok(res.json.code, `every error response must carry a code, got: ${res.text}`);
  });

  test(
    "a dead reranker DEGRADES a successful response rather than failing it (F-26)",
    { skip: SKIP },
    async () => {
      const res = await retrieve({ rerankUrl: DEAD_PORT, rerankModel: "Qwen/Qwen3-Reranker-8B" });
      assert.strictEqual(res.ok, true, "a transient reranker fault must not take retrieval down");
      assert.strictEqual(res.json.success, true);
      assert.ok(Array.isArray(res.json.degraded), `expected a degraded[] array, got: ${res.text}`);
      assert.strictEqual(res.json.degraded[0].code, "RERANK_DOWN");
      assert.strictEqual(res.json.degraded[0].stage, "rerank");
    }
  );

  test(
    "T10: a dead reranker's results are NULL-scored, never the fabricated 0.5 (F-26)",
    { skip: SKIP },
    async () => {
      const res = await retrieve({ rerankUrl: DEAD_PORT, rerankModel: "Qwen/Qwen3-Reranker-8B" });
      assert.strictEqual(res.json.success, true);
      const results = res.json.results || [];
      // The owner's ruling: unscored passages PASS the relevance floor, so they
      // must still be RETURNED. Suppressing them would turn a rerank outage
      // into "the documents do not mention it" for every query.
      assert.ok(results.length > 0, `unscored passages must still be returned: ${res.text}`);
      for (const r of results) {
        assert.strictEqual(
          r.rerankScore,
          null,
          `every score must be null; a 0.5 seed clears the calibrated floor as if the ` +
            `reranker had endorsed the passage (F-26). Got ${r.rerankScore}`
        );
      }
      // The report must agree with the rows it describes.
      assert.strictEqual(res.json.report.nullScoreCount, results.length);
      assert.strictEqual(res.json.report.scoreStats, null, "no scores means no score statistics");
      assert.strictEqual(res.json.report.candidatesScored, 0, "the reranker scored nothing, and says so");
      // F-26 is NOT closed by T10 and this assertion records that on purpose:
      // the floor ran, and with nothing to discriminate it passed everything.
      // That is the ruling's accepted cost — disclosed, not suppressed.
      assert.strictEqual(res.json.report.thresholdApplied.floorApplied, true);
    }
  );

  test("a healthy retrieval reports no degradation at all", { skip: SKIP }, async () => {
    const res = await retrieve();
    assert.strictEqual(res.json.success, true);
    assert.ok(
      res.json.degraded === undefined,
      `a healthy response must omit degraded entirely, got: ${JSON.stringify(res.json.degraded)}`
    );
  });
});

describe("I-FAILMODE: /api/chat tells the truth about retrieval", () => {
  // The control case. F-25 proved the eval harness cannot see this path.
  test("CONTROL: a healthy request answers from retrieved context", { skip: SKIP }, async () => {
    const res = await chat(GROUNDED_QUESTION);
    assert.strictEqual(res.ok, true, `chat failed: ${res.text}`);
    assert.strictEqual(res.json.success, true, "a healthy request must report success");
    assert.ok(!res.json.retrievalError, "a healthy request must carry no retrievalError");
    assert.strictEqual(res.json.retrieval.state, "ok", `expected state ok, got ${JSON.stringify(res.json.retrieval)}`);
    assert.ok(res.json.retrieval.chunkCount > 0, "the control question must retrieve context");
    assert.ok((res.json.response || "").length > 0, "a healthy request must produce an answer");

    // Bookkeeping preserved every retrieved chunk (the F-25 property, end to end).
    const ragTrace = (res.json.traces || []).find((t) => t.category === "rag_pipeline");
    assert.ok(ragTrace, "the rag_pipeline trace must be present");
    assert.strictEqual(
      ragTrace.details.retrievedChunksCount,
      res.json.retrieval.chunkCount,
      "post-retrieval bookkeeping must not lose chunks"
    );
    assert.ok(!res.json.bookkeepingError, "no bookkeeping error expected on the healthy path");

    // T13: the trace carries the RESOLVED config and the route's report — and
    // no longer the raw request payload (that is how F-28 shipped credentials).
    assert.ok(!("requestParameters" in ragTrace.details), "the raw request payload must be gone from the trace");
    assert.strictEqual(ragTrace.details.retrievalConfig?.resolved, true, "the trace must carry the resolved config view");
    assert.ok(ragTrace.details.report, "the trace must carry the route's retrieval report");
    assert.strictEqual(
      ragTrace.details.report.searchLimitUsed,
      ragTrace.details.retrievalConfig.poolSize,
      "report.searchLimitUsed must equal the resolved pool"
    );
  });

  // T13 acceptance criterion (F-28), literally: no eyJ-prefixed value anywhere
  // in a live /api/chat response's traces. The committed credentials are
  // k8s service-account JWTs, so "eyJ" is their invariant prefix.
  test("F-28: a live doc-mode response carries no JWT-shaped value anywhere in traces", { skip: SKIP }, async () => {
    const res = await chat(GROUNDED_QUESTION);
    assert.strictEqual(res.ok, true, `chat failed: ${res.text}`);
    assert.ok(Array.isArray(res.json.traces) && res.json.traces.length > 0, "traces must be present");

    const serialized = JSON.stringify(res.json.traces);
    const jwtShaped = serialized.match(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g) || [];
    assert.strictEqual(
      jwtShaped.length,
      0,
      `traces still carry ${jwtShaped.length} JWT-shaped value(s) — F-28 regressed`
    );

    // And the failure path's trace must be equally clean: a failed resolve or
    // dead dependency must not fall back to attaching the raw payload.
    const failRes = await chat(GROUNDED_QUESTION, { embedEndpoint: `${DEAD_PORT}/v1` });
    const failSerialized = JSON.stringify(failRes.json.traces || []);
    assert.ok(
      !/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(failSerialized),
      "the failure path's traces still carry a JWT-shaped value — F-28 regressed on the error branch"
    );
  });

  test(
    "a dead embedding endpoint is reported as a failure, not as an absent document",
    { skip: SKIP },
    async () => {
      const res = await chat(GROUNDED_QUESTION, { embedEndpoint: `${DEAD_PORT}/v1` });

      assert.strictEqual(res.ok, true, "the chat route itself still answers");
      assert.strictEqual(res.json.retrieval.state, "failed");
      assert.ok(res.json.retrievalError, "retrievalError must be present when retrieval failed");
      assert.strictEqual(res.json.retrievalError.code, "EMBED_DOWN");

      const answer = res.json.response || "";

      // The ticket's acceptance criterion, literally.
      assert.ok(
        !answer.includes("No matching text passages"),
        `answer still contains the masking text:\n${answer}`
      );

      // FM-L7: it must not deny content that the control case retrieves.
      for (const claim of ABSENCE_CLAIMS) {
        assert.ok(
          !answer.toLowerCase().includes(claim.toLowerCase()),
          `answer asserts absence ("${claim}") when no search took place:\n${answer}`
        );
      }

      // "No invented content", operationalised: these values exist only in the
      // chunks, and no chunk was retrieved.
      for (const value of CORPUS_ONLY_VALUES) {
        assert.ok(
          !answer.includes(value),
          `answer contains corpus-only value "${value}" with retrieval down — it was invented:\n${answer}`
        );
      }

      // And it must actually say what went wrong.
      assert.ok(
        /retriev/i.test(answer) && /fail|error|unavailable/i.test(answer),
        `answer does not tell the user retrieval failed:\n${answer}`
      );
    }
  );

  test(
    "T10/F-34: a degraded turn reaches the response the UI renders",
    { skip: SKIP },
    async () => {
      // The gap F-34 measured: the model, the trace drawer and API consumers
      // were all told a turn's passages were never relevance-ranked, while
      // page.js and ChatPanel carried nothing — so the turn rendered
      // identically to a healthy one. U-DISCLOSURE pins the UI wiring; this
      // asserts the DATA that wiring depends on actually arrives, end to end,
      // through the orchestrator. A source pin plus a live assertion is the
      // same pairing T12 and T14 shipped their chips with.
      const res = await chat(GROUNDED_QUESTION, { rerankEndpointUrl: DEAD_PORT });
      assert.strictEqual(res.ok, true, `chat failed: ${res.text}`);
      assert.strictEqual(res.json.success, true, "a reranker fault must not cost the answer");
      assert.strictEqual(
        res.json.retrieval.state,
        "degraded",
        `expected a degraded turn, got ${JSON.stringify(res.json.retrieval)}`
      );
      assert.strictEqual(res.json.retrieval.code, "RERANK_DOWN");
      assert.ok(
        (res.json.retrieval.message || "").length > 0,
        "the chip's tooltip is this message — an empty one discloses nothing"
      );
      assert.ok(res.json.retrieval.chunkCount > 0, "unscored passages still reach the context");
      assert.ok(
        !res.json.retrievalError,
        "a degradation is not a failure: T12's retrievalError chip must not fire as well"
      );

      // Every chunk that reached the prompt must be honestly unscored.
      const ragTrace = (res.json.traces || []).find((t) => t.category === "rag_pipeline");
      assert.ok(ragTrace, "the rag_pipeline trace must be present");
      const traced = ragTrace.details.retrievedChunks || [];
      assert.ok(traced.length > 0, "the trace must show the chunks that were used");
      for (const c of traced) {
        assert.strictEqual(c.rerankScore, null, `a context chunk carried a fabricated score: ${c.rerankScore}`);
      }
      assert.strictEqual(ragTrace.badgeType, "amber", "the trace badge must still mark the degradation");
    }
  );

  test("a refused config (CONFIG_MISSING) is also a failure, not an absent document", { skip: SKIP }, async () => {
    const res = await chat(GROUNDED_QUESTION, { embedEndpoint: "", embedModelName: "" });
    assert.strictEqual(res.json.retrieval.state, "failed");
    assert.strictEqual(res.json.retrievalError.code, "CONFIG_MISSING");
    assert.ok(!(res.json.response || "").includes("No matching text passages"));
  });

  test("an LLM outage returns success:false and no fabricated essay", { skip: SKIP }, async () => {
    const res = await chat(GROUNDED_QUESTION, { nimEndpoint: `${DEAD_PORT}/v1` });

    assert.strictEqual(res.json.success, false, "an LLM outage must report success:false");
    const answer = res.json.response || "";
    assert.ok(!answer.includes("[SYSTEM FALLBACK"), `the offline essay is still being returned:\n${answer}`);
    assert.strictEqual(res.json.sql_query, "", "an LLM outage must not return a stub code snippet");
    assert.ok(res.json.error, "a failed turn must populate `error` for the UI");
  });

  test("telemetry never presents an estimate as a measurement", { skip: SKIP }, async () => {
    const res = await chat(GROUNDED_QUESTION);
    assert.ok(res.json.telemetry, "telemetry must be present");
    assert.strictEqual(
      typeof res.json.telemetry.estimated,
      "boolean",
      "token counts must declare whether they are estimated or provider-reported"
    );
  });
});

// ── T36 (t36-design.md §4, D8; F-134): the generator's outcome on the wire ──
//
// A stand-in completions endpoint INSIDE the test process answers the
// generator in Ollama's OpenAI-compatible reply shape (design §0a: message
// {role, content, reasoning}, finish_reason, usage), so a cut is witnessed end
// to end — the route projection (A16), the failure contract (D2), the span,
// the telemetry — without needing a real 8,192-token cut from Ollama.
// Retrieval runs for real against the eval class (read-only). The pattern is
// the design probe's `capturePrompt` (f134-artifacts/probes/probe_options.js).
const http = require("http");
const { GENERATION_FLOORS } = require("../../src/lib/rag/generation");

async function withStandInGenerator(reply, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = { unparsable: body.slice(0, 200) };
      }
      seen.push({ path: req.url, body: parsed });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(typeof reply === "function" ? reply(parsed) : reply));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    return await fn({ nimEndpoint: `http://127.0.0.1:${port}/v1`, seen });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Ollama 0.33.3's /v1/chat/completions reply for a thinking model (design §0a). */
const ollamaOpenAiReply = ({ content, reasoning, finish, completion = 8192 }) => ({
  id: "chatcmpl-standin",
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model: "stand-in",
  choices: [{ index: 0, message: { role: "assistant", content, reasoning }, ...(finish === undefined ? {} : { finish_reason: finish }) }],
  usage: { prompt_tokens: 10025, completion_tokens: completion, total_tokens: 10025 + completion },
});
const CUT_ANSWER = "The Hesketh design's bedrooms are listed on its specification page; the table begins:\n\n| Room | Dimensions (ft in) |";
const HIDDEN_REASONING = "r".repeat(13002);

describe("I-FAILMODE/T36: the generator's outcome reaches the wire, and an empty cut is a failure (t36-design §4; F-134)", () => {
  test(
    "1. a cut WITH an answer: 200, success, GENERATION_CUT on the response, the span and the telemetry; the budget is the floor for the intent; the request is D5's shape",
    { skip: SKIP },
    async () => {
      const { r, seen } = await withStandInGenerator(
        ollamaOpenAiReply({ content: CUT_ANSWER, reasoning: HIDDEN_REASONING, finish: "length" }),
        async ({ nimEndpoint, seen }) => ({ r: await chat(GROUNDED_QUESTION, { nimEndpoint }), seen })
      );
      assert.strictEqual(r.ok, true, `chat failed: ${r.text}`);
      assert.strictEqual(r.json.success, true, "a cut with an answer is a degradation on a 200, not a failure");
      assert.strictEqual(r.json.response, CUT_ANSWER, "the visible answer is returned as the provider gave it");
      const g = r.json.generation;
      assert.ok(g, `the response must carry generation (A16 — null means a route did not name it): ${r.text.slice(0, 300)}`);
      assert.strictEqual(g.provider, "openai-compatible");
      assert.strictEqual(g.finishReason, "length");
      assert.strictEqual(g.cut, true);
      assert.strictEqual(g.code, "GENERATION_CUT");
      assert.strictEqual(g.attempts, 1);
      // The budget: the harness asks for 1,024; the floor for the router's intent applies and is disclosed.
      const expectedRule = r.json.router && r.json.router.intent === "enumerate" ? "enumerate" : "default";
      assert.strictEqual(g.budget.rule, expectedRule);
      assert.strictEqual(g.budget.requested, 1024);
      assert.strictEqual(g.budget.floor, GENERATION_FLOORS[expectedRule]);
      assert.strictEqual(g.budget.applied, GENERATION_FLOORS[expectedRule]);
      // The split, in characters; the usage as the provider reported it.
      assert.strictEqual(g.thinking.reasoningChars, HIDDEN_REASONING.length);
      assert.strictEqual(g.thinking.answerChars, CUT_ANSWER.length);
      assert.strictEqual(g.thinking.shareBasis, "characters");
      assert.deepStrictEqual(g.usage, { promptTokens: 10025, completionTokens: 8192, providerReported: true });
      assert.match(g.message, /output limit/);
      // The telemetry.
      assert.strictEqual(r.json.telemetry.finish_reason, "length");
      assert.strictEqual(r.json.telemetry.max_tokens, g.budget.applied);
      assert.strictEqual(r.json.telemetry.answer_chars, CUT_ANSWER.length);
      assert.strictEqual(r.json.telemetry.reasoning_chars, HIDDEN_REASONING.length);
      assert.strictEqual(r.json.telemetry.completion_tokens, 8192);
      assert.strictEqual(r.json.telemetry.estimated, false);
      // The span.
      const span = (r.json.traces || []).find((t) => t.category === "llm_inference");
      assert.ok(span, "the LLM span is present");
      assert.strictEqual(span.badge, `CUT AT ${g.budget.applied} TOKENS`);
      assert.strictEqual(span.badgeType, "amber");
      assert.strictEqual(span.details.finishReason, "length");
      assert.deepStrictEqual(span.details.budget, g.budget);
      // The request the generator sent (D5): the OpenAI-compatible shape, one budget field, no think control.
      assert.strictEqual(seen.length, 1, "exactly one generation call");
      assert.strictEqual(seen[0].path, "/v1/chat/completions");
      assert.deepStrictEqual(Object.keys(seen[0].body), ["model", "messages", "temperature", "max_tokens"]);
      assert.strictEqual(seen[0].body.max_tokens, g.budget.applied, "the wire carries the applied budget");
      // The retrieval side is untouched by the generator's outcome.
      assert.strictEqual(r.json.retrieval.state, "ok");
      assert.ok(!r.json.retrievalError);
    }
  );

  test(
    "2. a cut with NO answer: success:false, GENERATION_EMPTY, the error names the limit and the code, no code snippet, no citations",
    { skip: SKIP },
    async () => {
      const { r } = await withStandInGenerator(
        ollamaOpenAiReply({ content: "", reasoning: HIDDEN_REASONING, finish: "length" }),
        async ({ nimEndpoint, seen }) => ({ r: await chat(GROUNDED_QUESTION, { nimEndpoint }), seen })
      );
      assert.strictEqual(r.ok, true, "the chat route itself still answers (a 200 carrying success:false, like an LLM outage)");
      assert.strictEqual(r.json.success, false, "an empty cut must report success:false — before T36 it was a success with an empty answer");
      assert.ok(r.json.error, "a failed turn must populate `error` for the UI");
      assert.match(r.json.error, /output limit/, `the error must name the limit: ${r.json.error}`);
      assert.match(r.json.error, /GENERATION_EMPTY/);
      assert.match(r.json.error, /Retry, or ask for fewer items/);
      assert.strictEqual(r.json.response, r.json.error, "the answer IS the error text (T12's path)");
      assert.strictEqual(r.json.sql_query, "", "no stub code snippet");
      assert.strictEqual(r.json.citations, undefined, "no audit ran: there is no answer to audit");
      const g = r.json.generation;
      assert.ok(g, "the field is carried on a failed turn too");
      assert.strictEqual(g.cut, true);
      assert.strictEqual(g.code, "GENERATION_EMPTY");
      assert.strictEqual(g.thinking.answerChars, 0);
      assert.strictEqual(g.thinking.reasoningShare, 1);
      const span = (r.json.traces || []).find((t) => t.category === "llm_inference");
      assert.strictEqual(span.badge, "NO ANSWER — BUDGET SPENT REASONING");
      assert.strictEqual(span.badgeType, "red");
      assert.strictEqual(r.json.telemetry.finish_reason, "length");
      assert.strictEqual(r.json.telemetry.answer_chars, 0);
      // Retrieval succeeded; the failure is the generator's, and the taxonomy says which.
      assert.strictEqual(r.json.retrieval.state, "ok");
      assert.ok(!r.json.retrievalError, "a generation failure is not a retrieval failure");
    }
  );

  test(
    "3. no finish_reason on the reply: finishReason null, cut false, success — 'not reported', never a guess",
    { skip: SKIP },
    async () => {
      const { r } = await withStandInGenerator(
        ollamaOpenAiReply({ content: "The Hesketh design has four bedrooms.", reasoning: "", finish: undefined, completion: 40 }),
        async ({ nimEndpoint, seen }) => ({ r: await chat(GROUNDED_QUESTION, { nimEndpoint }), seen })
      );
      assert.strictEqual(r.ok, true, `chat failed: ${r.text}`);
      assert.strictEqual(r.json.success, true);
      const g = r.json.generation;
      assert.ok(g);
      assert.strictEqual(g.finishReason, null);
      assert.strictEqual(g.cut, false);
      assert.strictEqual(g.code, null);
      assert.match(g.message, /reported no finish reason/);
      assert.strictEqual(r.json.telemetry.finish_reason, null);
      const span = (r.json.traces || []).find((t) => t.category === "llm_inference");
      assert.strictEqual(span.badge, "FINISH REASON NOT REPORTED");
      assert.strictEqual(span.badgeType, "blue");
    }
  );
});
