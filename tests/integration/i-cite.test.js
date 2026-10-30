/**
 * I-CITE — the citation contract reaches the user end to end (ticket T14;
 * FM-N7 / E32).
 *
 * This suite exists because a green eval suite is NOT evidence that the
 * application works. `tests/eval/run_citations.js` exercises the extractor
 * directly, so its metrics can be green while the live chat path attaches no
 * citations at all — exactly how F-25 happened for retrieval. Citations reach
 * users through the orchestrator, so they are asserted here end to end through
 * /api/chat, against the response the UI actually receives.
 *
 * Every assertion is STRUCTURAL: field presence, marker shape, page numbers
 * cross-checked against the rag_pipeline trace. Prose wording of model output
 * is never asserted — which sources a 27B model chooses to cite, and how it
 * phrases an absence, are model-dependent.
 *
 * Requires the live environment (see _harness.js) plus RAG_EVAL_COLLECTION
 * pointing at a populated RAGEval_* collection, whose class shape
 * RAG_EVAL_SCHEMA_VERSION states (default 1: the v1 T08 class; sent on every
 * request, cut-over design D12). Timeouts are long (300s): a 27B chat model
 * answers slowly.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { envConfig, skipReason, assertEvalCollection, evalSchemaVersion, postJson } = require("./_harness");
const { findPageClaims } = require("../../src/lib/rag/citations");

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

/** The only attributions the contract admits (citations.js, F-11/F-30). */
const PAGE_ATTRIBUTIONS = ["paginated", "singlePage", "unknown"];

/**
 * A question engineered to elicit citations: the answer IS in the golden
 * corpus and the prompt explicitly asks for per-specification page numbers.
 */
const GROUNDED_CITE_QUESTION =
  "/doc List the key specifications of the Hesketh 4-bedroom home. " +
  "For each specification, cite the exact page number of the document it appears on.";

/**
 * A question about content that does NOT exist anywhere in the corpus, phrased
 * to pressure the model into naming a page anyway. Any page number in the
 * answer is either a retrieved page or a fabrication the contract must flag.
 */
const ABSENCE_QUESTION =
  "/doc Which page of the documentation discusses the ZORBLATTIUM_9 coupling assembly? " +
  "Cite the exact page number.";

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

/**
 * The pages actually retrieved, read from the rag_pipeline trace — the same
 * bookkeeping the F-25 control case pinned. Missing trace reads as the empty
 * set, which only makes the fabrication assertions stricter.
 */
function tracePages(json) {
  const ragTrace = (json.traces || []).find((t) => t.category === "rag_pipeline");
  return new Set(((ragTrace && ragTrace.details.retrievedChunks) || []).map((c) => Number(c.page)));
}

/**
 * One grounded generation shared by cases 1 and 3 — a 27B answer is too slow
 * to buy twice for the same response object.
 */
let groundedPromise = null;
function groundedChat() {
  if (!groundedPromise) groundedPromise = chat(GROUNDED_CITE_QUESTION);
  return groundedPromise;
}

describe("I-CITE: citations reach the user through /api/chat", () => {
  test("citations ride the chat response for a grounded question", { skip: SKIP }, async () => {
    const res = await groundedChat();
    assert.strictEqual(res.ok, true, `chat failed: ${res.text}`);
    assert.strictEqual(res.json.success, true, "the grounded question must succeed");

    // The contract's structure, entry by entry. Whether the model chose to
    // cite at all is model-dependent, so emptiness is not an offence — but
    // anything present must be well-formed.
    assert.ok(Array.isArray(res.json.citations), "citations must ride the response as an array");
    // Liveness (review finding): every per-citation assertion below is inside
    // this loop, so an always-empty citations array would pass vacuously — a
    // dead citation contract must fail this suite, not slide through it. The
    // question explicitly demands per-fact page citations; rule 8 instructs
    // [S#] markers; zero resolved citations means the contract is not live.
    assert.ok(
      res.json.citations.length >= 1,
      "a citation-demanding grounded question must resolve at least one [S#] citation"
    );
    for (const citation of res.json.citations) {
      assert.match(
        String(citation.marker),
        /^S[0-9]+$/,
        `citation marker "${citation.marker}" is not [S#]-shaped`
      );
      assert.ok(
        typeof citation.source === "string" && citation.source.length > 0,
        `citation ${citation.marker} carries no source`
      );
      assert.ok(
        PAGE_ATTRIBUTIONS.includes(citation.pageAttribution),
        `citation ${citation.marker} has pageAttribution "${citation.pageAttribution}" — ` +
          `expected one of ${PAGE_ATTRIBUTIONS.join("/")}`
      );
    }

    // Every page a citation names must be a page that was actually retrieved —
    // the trace is the bookkeeping ground truth (F-25 property, end to end).
    const ragTrace = (res.json.traces || []).find((t) => t.category === "rag_pipeline");
    assert.ok(ragTrace, "the rag_pipeline trace must be present");
    const retrievedPages = tracePages(res.json);
    for (const citation of res.json.citations) {
      if (citation.page !== null && citation.page !== undefined) {
        assert.ok(
          retrievedPages.has(Number(citation.page)),
          `citation ${citation.marker} names page ${citation.page}, ` +
            `which is not among the retrieved trace pages [${[...retrievedPages].join(", ")}]`
        );
      }
    }

    // The audit's other half is present too; its content is model-dependent
    // (a well-behaved answer legitimately yields an empty array).
    assert.ok(Array.isArray(res.json.uncitedClaims), "uncitedClaims must ride the response as an array");
  });

  test("absence answers cannot smuggle page claims", { skip: SKIP }, async () => {
    const res = await chat(ABSENCE_QUESTION);
    assert.strictEqual(res.ok, true, `chat failed: ${res.text}`);

    // Judge the answer with the SAME extractor the product uses — one
    // definition of "page claim", so this test cannot disagree with the
    // orchestrator about what was claimed. Zero claims is a pass: a model
    // that names no page fabricated nothing.
    const claims = findPageClaims(res.json.response || "");
    const retrievedPages = tracePages(res.json);
    const uncited = Array.isArray(res.json.uncitedClaims) ? res.json.uncitedClaims : [];

    for (const claim of claims) {
      const flagged = uncited.some((entry) =>
        new RegExp(`\\bpage ${claim.page}\\b`, "i").test(String(entry))
      );
      assert.ok(
        retrievedPages.has(claim.page) || flagged,
        `answer claims page ${claim.page} ("${claim.excerpt}") that matches no retrieved chunk, ` +
          `and uncitedClaims does not flag it — an unflagged fabrication reached the user`
      );
    }
  });

  test("citation fields are present-empty when nothing is cited, absent never", { skip: SKIP }, async () => {
    // "Ran and found none" is an empty array; "did not run" is the fields
    // being absent, which is legitimate only on success:false or a
    // bookkeeping failure — a state this test does not try to force against
    // a live environment. On any successful doc-mode response BOTH fields
    // must be arrays, so the UI can distinguish the two without guessing.
    const res = await groundedChat();
    assert.strictEqual(res.ok, true, `chat failed: ${res.text}`);
    assert.strictEqual(res.json.success, true, "this case pins the success-path shape");
    assert.ok(
      Array.isArray(res.json.citations),
      "success:true must carry citations as an array — empty means the audit ran and found none"
    );
    assert.ok(
      Array.isArray(res.json.uncitedClaims),
      "success:true must carry uncitedClaims as an array — absence would be indistinguishable from a skipped audit"
    );
  });
});
