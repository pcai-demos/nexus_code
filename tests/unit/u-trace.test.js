/**
 * U-TRACE — truthful observability (ticket T13; audit E03, E31, finding F-28).
 *
 * Three contracts, all pure so every state is pinned on every `npm test`
 * rather than only reachable with the right file shape or a live pod:
 *
 *  1. REDACTION (F-28): no trace leaving the orchestrator may carry a
 *     credential — by key name or by JWT shape — and the scrubber must be
 *     total, because observability code lives inside the blast radius F-25
 *     mapped: a throw while describing work must never cost the work.
 *  2. PROJECTION: the retrieval trace carries an allowlisted view of the
 *     RESOLVED config, never the raw request payload (the F-25 trap) and
 *     never a credential (which the resolved config does hold — resolution
 *     alone is not redaction).
 *  3. ENGINE SPANS (E03): an engine is reported only when this process
 *     observed it; durations are measured or absent, never invented.
 *
 * The JWTs in these fixtures are SYNTHETIC — three base64url segments built
 * for shape alone; they decode to {"alg":"none"}-style junk and are secrets
 * for no system.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  isCredentialKey,
  redactTraceDetails,
  projectRetrievalConfigForTrace,
} = require("../../src/lib/observability/trace-redaction.js");
const {
  ENGINE_IDS,
  normalizeEngine,
  engineBadge,
  buildParserSpanModel,
  buildVlmSpanModel,
} = require("../../src/lib/ingestion/engines.js");
const { resolveRetrievalConfig } = require("../../src/lib/rag/config.js");

/** Synthetic JWT-shaped strings (fake header.payload.signature). */
const FAKE_JWT_1 = "eyJhbGciOiJub25lIn0.eyJmYWtlIjoidTEifQ.c2lnbmF0dXJl";
const FAKE_JWT_2 = "eyJhbGciOiJub25lIn0.eyJmYWtlIjoidTIifQ.c2ln";
const FAKE_JWT_3 = "eyJhbGciOiJub25lIn0.eyJmYWtlIjoidTMifQ.eA";

const JWT_SHAPE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./;

/** Depth-first sweep: every {key, value} pair of string leaves. */
function stringLeaves(node, path = "$", acc = []) {
  if (typeof node === "string") {
    acc.push({ path, value: node });
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => stringLeaves(v, `${path}[${i}]`, acc));
    return acc;
  }
  if (node && typeof node === "object") {
    for (const k of Object.keys(node)) stringLeaves(node[k], `${path}.${k}`, acc);
  }
  return acc;
}

describe("U-TRACE/F-28: credential redaction", () => {
  // The ticket's named unit test: a payload carrying all three tokens, fed
  // through the boundary — no trace details may contain a credential key with
  // a live value or a JWT-shaped string anywhere.
  test("a payload carrying all three tokens leaves no credential in any trace details", () => {
    const traces = [
      {
        id: "trace-rag-1",
        category: "rag_pipeline",
        description: "Retrieved 4 chunks",
        details: {
          requestParameters: {
            query: "hesketh bedroom dimensions",
            token: FAKE_JWT_1,
            weaviateToken: FAKE_JWT_2,
            rerankToken: FAKE_JWT_3,
            embedUrl: "http://ollama:11434/v1",
            ragSettings: { nested: { mlisToken: FAKE_JWT_1 } },
          },
          retrievedChunks: [{ source: "a.pdf", snippet: "text" }],
        },
      },
    ];

    const safe = redactTraceDetails(traces);
    const leaves = stringLeaves(safe);

    const jwtLeaves = leaves.filter((l) => JWT_SHAPE.test(l.value));
    assert.deepStrictEqual(
      jwtLeaves,
      [],
      `JWT-shaped values survived redaction at: ${jwtLeaves.map((l) => l.path).join(", ")}`
    );

    // Credential-named keys must be redacted wholesale, not merely mangled.
    assert.strictEqual(safe[0].details.requestParameters.token, "[REDACTED]");
    assert.strictEqual(safe[0].details.requestParameters.weaviateToken, "[REDACTED]");
    assert.strictEqual(safe[0].details.requestParameters.rerankToken, "[REDACTED]");
    assert.strictEqual(safe[0].details.requestParameters.ragSettings.nested.mlisToken, "[REDACTED]");

    // Non-credential content is untouched.
    assert.strictEqual(safe[0].details.requestParameters.query, "hesketh bedroom dimensions");
    assert.strictEqual(safe[0].details.retrievedChunks[0].source, "a.pdf");
  });

  test("a JWT embedded inside a longer string (URL, error message) is scrubbed", () => {
    const traces = [
      {
        details: {
          errorMessage: `fetch failed for https://host/v1?auth=${FAKE_JWT_1}&x=1 after retry`,
        },
        description: `dispatched with bearer ${FAKE_JWT_2}`,
      },
    ];
    const safe = redactTraceDetails(traces);
    assert.ok(!JWT_SHAPE.test(safe[0].details.errorMessage), "URL-embedded JWT survived");
    assert.ok(!JWT_SHAPE.test(safe[0].description), "description-embedded JWT survived");
    assert.ok(safe[0].details.errorMessage.includes("fetch failed"), "non-secret text must survive");
  });

  test("credential keys are matched by suffix, not by enumeration", () => {
    for (const key of ["token", "weaviateToken", "rerankToken", "mlisToken", "embedApiKey", "rerankApiKey", "nimApiKey", "vlmApiKey", "authorization", "someFutureApiKey", "clientSecret", "dbPassword"]) {
      assert.ok(isCredentialKey(key), `"${key}" must be treated as a credential key`);
    }
    // T36: the generation field's keys (finishReason, the split in characters, the usage counts) are not credentials.
    for (const key of ["maxTokens", "prompt_tokens", "completion_tokens", "durationSource", "searchStrategy", "tokenizer", "finishReason", "finish_reason", "reasoningChars", "answerChars", "reasoning_chars", "answer_chars", "promptTokens", "completionTokens", "max_tokens", "reasoningShare"]) {
      assert.ok(!isCredentialKey(key), `"${key}" must NOT be treated as a credential key`);
    }
  });

  test("an empty credential value is kept — 'nothing was sent' is a debugging fact", () => {
    const safe = redactTraceDetails([{ details: { token: "", rerankToken: FAKE_JWT_1 } }]);
    assert.strictEqual(safe[0].details.token, "");
    assert.strictEqual(safe[0].details.rerankToken, "[REDACTED]");
  });

  test("the scrubber is total: cycles, depth, junk and scale never throw", () => {
    const cyclic = { details: {} };
    cyclic.details.self = cyclic; // true ancestor cycle

    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 200; i++) {
      cursor.next = {};
      cursor = cursor.next;
    }
    cursor.token = FAKE_JWT_1;

    const shared = { note: "diamond, not a cycle" };

    const inputs = [
      null,
      undefined,
      42,
      "bare string with " + FAKE_JWT_1,
      [cyclic],
      [{ details: deep }],
      [{ a: shared, b: shared }],
      [{ details: { big: "x".repeat(100000), n: NaN, d: new Date(0).toISOString() } }],
    ];
    for (const input of inputs) {
      assert.doesNotThrow(() => redactTraceDetails(input), `threw on ${String(input).slice(0, 40)}`);
    }

    // The bare string is still scrubbed even outside an array.
    const scrubbed = redactTraceDetails("prefix " + FAKE_JWT_1 + " suffix");
    assert.ok(!JWT_SHAPE.test(scrubbed));

    // A shared (diamond) reference is not falsely reported as a cycle.
    const diamond = redactTraceDetails([{ a: shared, b: shared }]);
    assert.strictEqual(diamond[0].a.note, "diamond, not a cycle");
    assert.strictEqual(diamond[0].b.note, "diamond, not a cycle");

    // A true cycle is cut, not recursed into.
    const cut = redactTraceDetails([cyclic]);
    assert.strictEqual(cut[0].details.self, "[CYCLE]");
  });

  test("redaction returns a copy — the input traces are never mutated", () => {
    const details = { token: FAKE_JWT_1, keep: "original" };
    const traces = [{ details }];
    redactTraceDetails(traces);
    assert.strictEqual(details.token, FAKE_JWT_1, "input must not be mutated");
  });
});

describe("U-TRACE/F-28: resolved-config projection (allowlist)", () => {
  const fullBody = {
    query: "q",
    embedUrl: "http://ollama:11434/v1",
    embedModel: "qwen3-embedding:8b",
    token: FAKE_JWT_1,
    weaviateToken: FAKE_JWT_2,
    rerankToken: FAKE_JWT_3,
    weaviateCollection: "RAGEval_test",
  };

  test("a resolved config projects its tuning and identity, and no credential key at all", () => {
    const resolved = resolveRetrievalConfig(fullBody);
    assert.strictEqual(resolved.ok, true);
    // Precondition that makes the projection necessary: the resolved config
    // itself DOES hold the credentials — resolution alone is not redaction.
    assert.strictEqual(resolved.config.token, FAKE_JWT_1);

    const projected = projectRetrievalConfigForTrace(resolved);
    assert.strictEqual(projected.resolved, true);
    assert.strictEqual(projected.poolSize, resolved.config.poolSize);
    assert.strictEqual(projected.searchStrategy, resolved.config.searchStrategy);
    assert.strictEqual(projected.embedModel, "qwen3-embedding:8b");
    // The class actually read: the request named no version, so the resolver's
    // default (2 since the cut-over, design D1) suffixed it. T13's rule — the
    // report says what was read — is what makes the projection show `V2`.
    assert.strictEqual(projected.weaviateCollection, "RAGEval_testV2");

    for (const key of Object.keys(projected)) {
      assert.ok(!isCredentialKey(key), `projection leaked a credential-named key: ${key}`);
    }
    const leaves = stringLeaves(projected);
    assert.deepStrictEqual(
      leaves.filter((l) => JWT_SHAPE.test(l.value)),
      [],
      "projection leaked a JWT-shaped value"
    );
  });

  test("an UNRESOLVED config projects {resolved:false, error} instead of throwing (F-25)", () => {
    const resolved = resolveRetrievalConfig({ query: "q" }); // vector-bearing, no embed identity
    assert.strictEqual(resolved.ok, false);
    const projected = projectRetrievalConfigForTrace(resolved);
    assert.deepStrictEqual(projected, {
      resolved: false,
      error: { code: "CONFIG_MISSING", field: "embedUrl" },
    });
  });

  test("garbage input never throws — a trace builder must be total", () => {
    for (const junk of [null, undefined, {}, { ok: true }, { ok: true, config: null }, "nope"]) {
      assert.doesNotThrow(() => projectRetrievalConfigForTrace(junk));
      assert.strictEqual(projectRetrievalConfigForTrace(junk).resolved, false);
    }
  });
});

describe("U-TRACE/T14: citation-audit projection (allowlist)", () => {
  const { projectCitationAuditForTrace } = require("../../src/lib/observability/trace-redaction");

  test("the trace copy of an uncited claim is the verdict alone — the answer excerpt never rides", () => {
    // The chat response keeps the excerpt (the chip tooltip needs it); the
    // trace projection truncates at this module's own excerpt delimiter so
    // its "nothing not named here" contract stays true.
    const projected = projectCitationAuditForTrace(
      {
        citations: [{ marker: "S1", source: "A.pdf", page: 4, sectionPath: "2.3", pageAttribution: "paginated" }],
        uncitedClaims: [
          'page 99 is cited but matches no retrieved chunk: "a dosage of 40mg daily, as stated on page 99"',
          "cited context block [S9] does not exist (context has 1 block)",
        ],
        pageClaimCount: 2,
      },
      1
    );
    assert.deepStrictEqual(projected.uncitedClaims, [
      "page 99 is cited but matches no retrieved chunk",
      "cited context block [S9] does not exist (context has 1 block)",
    ]);
    assert.strictEqual(projected.citations[0].marker, "S1");
    assert.strictEqual(projected.contextBlockCount, 1);
  });

  test("the projection is total: null audits and non-object citation elements project, never throw", () => {
    assert.deepStrictEqual(projectCitationAuditForTrace(null, 0).citations, []);
    const projected = projectCitationAuditForTrace({ citations: [null, "junk", { marker: "S2" }], uncitedClaims: null }, 2);
    assert.deepStrictEqual(projected.citations.map((c) => c.marker), ["S2"]);
    assert.deepStrictEqual(projected.uncitedClaims, []);
  });
});

describe("U-TRACE/E03: engine identity is looked up, never guessed", () => {
  test("bridge labels normalize onto stable ids", () => {
    assert.strictEqual(normalizeEngine("PyPDFium2 (Fast Multimodal Engine)"), ENGINE_IDS.PYPDFIUM2);
    assert.strictEqual(normalizeEngine("pypdfium2 (Lightweight Fallback)"), ENGINE_IDS.PYPDFIUM2);
    assert.strictEqual(normalizeEngine("Docling (Layout AI & Table Transformer)"), ENGINE_IDS.DOCLING);
    assert.strictEqual(normalizeEngine("IBM Docling (Layout AI & Table Transformer)"), ENGINE_IDS.DOCLING);
    assert.strictEqual(normalizeEngine("OfficeParser (Native DOCX)"), ENGINE_IDS.OFFICEPARSER);
    assert.strictEqual(normalizeEngine("pdf-parse (Spatial Fallback)"), ENGINE_IDS.PDF_PARSE);
    assert.strictEqual(normalizeEngine(""), ENGINE_IDS.UNKNOWN);
    assert.strictEqual(normalizeEngine(null), ENGINE_IDS.UNKNOWN);
    assert.strictEqual(normalizeEngine("SomeNewEngine 9000"), ENGINE_IDS.UNKNOWN);
  });

  test("every engine id has a distinct badge; unknown asserts nothing", () => {
    const badges = Object.values(ENGINE_IDS).map((id) => engineBadge(id).badge);
    assert.strictEqual(new Set(badges).size, badges.length, "badges must be distinct");
    assert.strictEqual(engineBadge(ENGINE_IDS.PYPDFIUM2).badge, "PYPDFIUM2 TEXT");
    assert.strictEqual(engineBadge(ENGINE_IDS.PYPDFIUM2).badgeType, "amber");
    assert.strictEqual(engineBadge(ENGINE_IDS.DOCLING).badge, "DOCLING LAYOUT AI");
    assert.strictEqual(engineBadge(ENGINE_IDS.DOCLING).badgeType, "purple");
    assert.strictEqual(engineBadge(ENGINE_IDS.OFFICEPARSER).badge, "OFFICEPARSER");
    assert.strictEqual(engineBadge(ENGINE_IDS.UNKNOWN).badge, "ENGINE UNKNOWN");
    assert.strictEqual(engineBadge("nonsense"), engineBadge(ENGINE_IDS.UNKNOWN));
  });
});

describe("U-TRACE/E03: the parser span reports only what this process observed", () => {
  const pypdfiumLog = {
    fileName: "SSX125_Manual.pdf",
    engine: "PyPDFium2 (Fast Multimodal Engine)",
    engineId: "pypdfium2",
    usedDocling: false,
    paginated: true,
    pageCount: 36,
    parseDurationMs: 1200,
    vlmDurationMs: 8000,
    picturesCaptured: 36,
    vlmCaptionsGenerated: 30,
    vlmModel: "qwen3-vl:30b",
  };
  const doclingLog = {
    fileName: "deck.pptx",
    engine: "Docling (Layout AI & Table Transformer)",
    engineId: "docling",
    usedDocling: true,
    paginated: true,
    pageCount: 15,
    parseDurationMs: 4000,
    vlmDurationMs: null,
  };
  const summary = [
    { source: "SSX125_Manual.pdf", totalPages: 36, chunkCount: 40 },
    { source: "GraemeHick.pdf", totalPages: 5, chunkCount: 12 },
  ];

  test("a uniform pypdfium2 batch gets the ticket's badge and wording", () => {
    const span = buildParserSpanModel([pypdfiumLog], []);
    assert.strictEqual(span.badge, "PYPDFIUM2 TEXT");
    assert.strictEqual(span.badgeType, "amber");
    assert.match(span.description, /PyPDFium2 text extraction \(no layout model\)/);
    assert.strictEqual(span.durationMs, 1200);
    assert.strictEqual(span.details.durationSource, "measured");
    assert.strictEqual(span.details.parserEngine, "PyPDFium2 (Fast Multimodal Engine)");
  });

  test("a docling ingest gets the docling badge — from the trace, not the extension", () => {
    const span = buildParserSpanModel([doclingLog], []);
    assert.strictEqual(span.badge, "DOCLING LAYOUT AI");
    assert.strictEqual(span.badgeType, "purple");
  });

  test("mixed engines are reported as mixed, with per-file truth intact", () => {
    const span = buildParserSpanModel([pypdfiumLog, doclingLog], []);
    assert.strictEqual(span.badge, "MIXED ENGINES");
    assert.strictEqual(span.details.parserEngine, "mixed");
    const byFile = Object.fromEntries(span.details.ingestedFileTraces.map((t) => [t.fileName, t]));
    assert.strictEqual(byFile["SSX125_Manual.pdf"].engineId, "pypdfium2");
    assert.strictEqual(byFile["deck.pptx"].engineId, "docling");
    assert.strictEqual(span.durationMs, 5200, "measured durations sum");
  });

  test("E03's live shape: no ingest in this process → ENGINE UNKNOWN, no per-file engine guess", () => {
    const span = buildParserSpanModel([], summary);
    assert.strictEqual(span.badge, "ENGINE UNKNOWN");
    assert.strictEqual(span.badgeType, "neutral");
    assert.match(span.description, /did not ingest them.*engine.*unknown/i);
    assert.strictEqual(span.details.parserEngine, null);
    for (const entry of span.details.ingestedFileTraces) {
      assert.strictEqual(entry.engineId, "unknown", `${entry.fileName} must not get a guessed engine`);
      assert.strictEqual(entry.engine, null);
      assert.strictEqual(entry.usedDocling, null);
      // The real facts survive.
      assert.ok(Number.isFinite(entry.pageCount));
      assert.ok(Number.isFinite(entry.chunkCount));
    }
    // No measurement happened, so none is reported.
    assert.ok(!("durationMs" in span), "an unmeasured span must omit durationMs entirely");
    assert.strictEqual(span.details.durationSource, "unavailable");
    assert.strictEqual(span.details.durationMs, null);
  });

  test("observed files merge with unobserved indexed files, each telling its own truth", () => {
    const span = buildParserSpanModel([pypdfiumLog], summary);
    assert.strictEqual(span.badge, "PYPDFIUM2 TEXT", "badge reflects what WAS observed");
    assert.match(span.description, /1 other indexed document\(s\)/);
    const byFile = Object.fromEntries(span.details.ingestedFileTraces.map((t) => [t.fileName, t]));
    assert.strictEqual(byFile["SSX125_Manual.pdf"].engineId, "pypdfium2");
    assert.strictEqual(byFile["GraemeHick.pdf"].engineId, "unknown");
  });

  test("durationSource is never 'measured' without a finite measurement", () => {
    const noDuration = { ...pypdfiumLog };
    delete noDuration.parseDurationMs;
    const span = buildParserSpanModel([noDuration], []);
    assert.ok(!("durationMs" in span));
    assert.strictEqual(span.details.durationSource, "unavailable");
  });

  test("empty everything: no logs, no summary — nothing is asserted", () => {
    const span = buildParserSpanModel([], []);
    assert.strictEqual(span.badge, "ENGINE UNKNOWN");
    assert.match(span.description, /No documents are indexed/);
    assert.deepStrictEqual(span.details.ingestedFileTraces, []);
  });
});

describe("U-TRACE/T07: recorded facts — the engine of a document this process never parsed (F-30, design D10)", () => {
  const summary = [
    { source: "SSX125_Manual.pdf", totalPages: 36, chunkCount: 40 },
    { source: "GraemeHick.pdf", totalPages: 5, chunkCount: 12 },
  ];
  const recorded = (over = {}) => ({
    fileName: "SSX125_Manual.pdf",
    engineId: "pypdfium2",
    engine: "PyPDFium2 (Fast Multimodal Engine)",
    paginated: true,
    pageCount: 36,
    chunkCount: 40,
    parseDurationMs: 1500,
    vlmDurationMs: 9000,
    picturesCaptured: 36,
    vlmCaptionsGenerated: 30,
    vlmModel: "qwen3-vl:30b",
    recordedAt: "2026-09-05T10:00:00.000Z",
    observed: "ledger",
    ...over,
  });

  test("nothing observed, one recorded → the recorded engine's badge, worded 'recorded at ingest', durationSource ledger", () => {
    const span = buildParserSpanModel([], summary, [recorded()]);
    assert.strictEqual(span.badge, "PYPDFIUM2 TEXT");
    assert.strictEqual(span.badgeType, "amber");
    assert.match(span.description, /recorded at ingest for 1 document\(s\); this process did not parse them/);
    assert.match(span.description, /1 other indexed document\(s\) have no record/);
    assert.strictEqual(span.details.engineSource, "ledger");
    assert.strictEqual(span.details.parserEngine, "PyPDFium2 (Fast Multimodal Engine)");
    assert.strictEqual(span.durationMs, 1500);
    assert.strictEqual(span.details.durationSource, "ledger", "recorded, never 'measured'");
    const byFile = Object.fromEntries(span.details.ingestedFileTraces.map((t) => [t.fileName, t]));
    assert.strictEqual(byFile["SSX125_Manual.pdf"].engineId, "pypdfium2");
    assert.strictEqual(byFile["SSX125_Manual.pdf"].observed, "ledger");
    assert.strictEqual(byFile["SSX125_Manual.pdf"].chunkCount, 40, "the store's chunk count, not the record's");
    assert.strictEqual(byFile["GraemeHick.pdf"].engineId, "unknown", "no record, no guess");
    assert.strictEqual(span.details.recordedCount, 1);
  });

  test("a record without a duration reports none; a record for a document the store no longer lists is ignored (the store is the truth)", () => {
    const span = buildParserSpanModel([], summary, [recorded({ parseDurationMs: null })]);
    assert.ok(!("durationMs" in span));
    assert.strictEqual(span.details.durationSource, "unavailable");
    const gone = buildParserSpanModel([], summary, [recorded({ fileName: "Unloaded.pdf" })]);
    assert.strictEqual(gone.badge, "ENGINE UNKNOWN");
    assert.strictEqual(gone.details.recordedCount, 0);
    assert.strictEqual(gone.details.engineSource, "none");
  });

  test("an in-process observation outranks a record for the same file, and the badge follows what was observed", () => {
    const observedLog = { fileName: "SSX125_Manual.pdf", engine: "Docling", engineId: "docling", parseDurationMs: 700 };
    const span = buildParserSpanModel([observedLog], summary, [recorded()]);
    assert.strictEqual(span.badge, "DOCLING LAYOUT AI");
    assert.strictEqual(span.details.engineSource, "observed");
    assert.strictEqual(span.details.durationSource, "measured");
    assert.strictEqual(span.durationMs, 700);
    const entries = span.details.ingestedFileTraces.filter((t) => t.fileName === "SSX125_Manual.pdf");
    assert.strictEqual(entries.length, 1, "one entry per file");
    assert.strictEqual(entries[0].engineId, "docling");
  });

  test("mixed recorded engines are reported as mixed, and the old signatures still work without a third argument", () => {
    const span = buildParserSpanModel([], summary, [recorded(), recorded({ fileName: "GraemeHick.pdf", engineId: "docling", engine: "Docling" })]);
    assert.strictEqual(span.badge, "MIXED ENGINES");
    assert.match(span.description, /recorded at ingest/);
    assert.strictEqual(buildParserSpanModel([], summary).badge, "ENGINE UNKNOWN");
  });

  test("the VLM span: nothing observed but captions recorded → VLM RECORDED with the recorded counts; a record without pictures is not evidence", () => {
    const span = buildVlmSpanModel([], [recorded()]);
    assert.strictEqual(span.badge, "VLM RECORDED (QWEN3-VL:30B)");
    assert.strictEqual(span.badgeType, "purple");
    assert.match(span.description, /Recorded at ingest for 1 document\(s\): 30 of 36 isolated figure crop\(s\)/);
    assert.strictEqual(span.details.picturesIsolated, 36);
    assert.strictEqual(span.details.vlmCaptionsGenerated, 30);
    assert.strictEqual(span.details.durationSource, "ledger");
    assert.strictEqual(span.durationMs, 9000);
    assert.strictEqual(buildVlmSpanModel([], [recorded({ picturesCaptured: null })]).badge, "NOT OBSERVED");
    assert.strictEqual(buildVlmSpanModel([], []).badge, "NOT OBSERVED");
    const zero = buildVlmSpanModel([], [recorded({ vlmCaptionsGenerated: 0, vlmDurationMs: null })]);
    assert.strictEqual(zero.badge, "0 CAPTIONS RECORDED");
    assert.ok(!("durationMs" in zero));
  });
});

describe("U-TRACE/T24: the VLM span shows the caption outcomes beside the count (design D9)", () => {
  const recorded24 = (over = {}) => ({
    fileName: "SSX125_Manual.pdf", engineId: "pypdfium2", engine: "PyPDFium2 (Fast Multimodal Engine)", paginated: true, pageCount: 36, chunkCount: 40,
    parseDurationMs: 1500, vlmDurationMs: 9000, picturesCaptured: 36, vlmCaptionsGenerated: 30, vlmDecorative: 4, vlmTruncated: 0, vlmTimedOut: 2, vlmFailed: 0, captioning: "on",
    vlmModel: "qwen3-vl:30b", recordedAt: "2026-09-11T10:00:00.000Z", observed: "ledger", ...over,
  });

  test("recorded facts with outcomes → the split in the description and the details; a pre-T24 record contributes nothing and alone reads null", () => {
    const span = buildVlmSpanModel([], [recorded24()]);
    assert.strictEqual(span.badge, "VLM RECORDED (QWEN3-VL:30B)");
    assert.match(span.description, /30 of 36 isolated figure crop\(s\) captioned into the vector store \(4 decorative, 2 timed out, 0 failed\); this process did not run the captioner\./);
    assert.deepStrictEqual({ d: span.details.vlmDecorative, t: span.details.vlmTimedOut, f: span.details.vlmFailed, c: span.details.captioning }, { d: 4, t: 2, f: 0, c: "on" });
    const withLoop = buildVlmSpanModel([], [recorded24({ vlmTruncated: 1 })]);
    assert.match(withLoop.description, /\(4 decorative, 1 truncated, 2 timed out, 0 failed\)/, "a truncated caption (A9) is named only when it happened");
    assert.strictEqual(withLoop.details.vlmTruncated, 1);
    const old = buildVlmSpanModel([], [recorded24({ vlmDecorative: undefined, vlmTruncated: undefined, vlmTimedOut: undefined, vlmFailed: undefined, captioning: undefined })]);
    assert.match(old.description, /captioned into the vector store; this process did not run the captioner\./, "no counts, no parenthesis");
    assert.deepStrictEqual({ d: old.details.vlmDecorative, t: old.details.vlmTimedOut, f: old.details.vlmFailed, c: old.details.captioning }, { d: null, t: null, f: null, c: null });
    const mixed = buildVlmSpanModel([], [recorded24(), recorded24({ fileName: "b.pdf", vlmDecorative: undefined, vlmTruncated: undefined, vlmTimedOut: undefined, vlmFailed: undefined, captioning: undefined })]);
    assert.strictEqual(mixed.details.vlmTimedOut, 2, "sums over the records that carry the count");
  });

  test("observed in this process → the same split; captioning off → its own badge and wording", () => {
    const span = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 12, vlmCaptionsGenerated: 9, vlmDecorative: 2, vlmTimedOut: 1, vlmFailed: 0, captioning: "on", vlmDurationMs: 30000, vlmModel: "qwen3-vl:30b" }]);
    assert.match(span.badge, /VLM ACTIVE/);
    assert.match(span.description, /9 of 12 isolated figure crop\(s\) captioned into the vector store \(2 decorative, 1 timed out, 0 failed\)\./);
    assert.strictEqual(span.details.vlmTimedOut, 1);
    const off = buildVlmSpanModel([{ fileName: "t.pdf", picturesCaptured: 0, vlmCaptionsGenerated: 0, vlmDecorative: 0, vlmTimedOut: 0, vlmFailed: 0, captioning: "off", vlmDurationMs: null }]);
    assert.strictEqual(off.badge, "CAPTIONING OFF");
    assert.strictEqual(off.badgeType, "blue");
    assert.match(off.description, /switched off \(captionFigures: false\): no page rendered, no crop captioned, no visual chunk emitted/);
    assert.strictEqual(off.details.captioning, "off");
    const both = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 3, vlmCaptionsGenerated: 1, captioning: "on" }, { fileName: "t.pdf", picturesCaptured: 0, vlmCaptionsGenerated: 0, captioning: "off" }]);
    assert.strictEqual(both.details.captioning, "mixed");
    const none = buildVlmSpanModel([]);
    assert.deepStrictEqual({ d: none.details.vlmDecorative, c: none.details.captioning }, { d: null, c: null }, "nothing observed: null");
    assert.deepStrictEqual({ m: none.details.vlmFromMemo, calls: none.details.vlmCalls }, { m: null, calls: null }, "T29: the memo counts are null when nothing was observed");
  });

  test("T29: the memo's share is named beside the outcomes — recalled from the caption memo / asked of the server — and only when a record carries it", () => {
    const span = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 9, vlmCaptionsGenerated: 8, vlmDecorative: 1, vlmTimedOut: 0, vlmFailed: 0, vlmFromMemo: 7, vlmCalls: 2, captioning: "on", vlmDurationMs: 21000, vlmModel: "qwen3-vl:30b" }]);
    assert.match(span.description, /8 of 9 isolated figure crop\(s\) captioned into the vector store \(1 decorative, 0 timed out, 0 failed, 7 recalled from the caption memo, 2 asked of the server\)\./);
    assert.deepStrictEqual({ m: span.details.vlmFromMemo, c: span.details.vlmCalls }, { m: 7, c: 2 });
    const whole = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 9, vlmCaptionsGenerated: 8, vlmDecorative: 1, vlmTimedOut: 0, vlmFailed: 0, vlmFromMemo: 9, vlmCalls: 0, captioning: "on", vlmDurationMs: 40, vlmModel: "qwen3-vl:30b" }]);
    assert.match(whole.badge, /VLM ACTIVE/, "captions landed in the store: the badge follows the captions, the wording names the source");
    assert.match(whole.description, /9 recalled from the caption memo, 0 asked of the server/);
    const recorded = buildVlmSpanModel([], [{ fileName: "a.pdf", engineId: "pypdfium2", picturesCaptured: 7, vlmCaptionsGenerated: 7, vlmDecorative: 0, vlmTruncated: 0, vlmTimedOut: 0, vlmFailed: 0, vlmFromMemo: 7, vlmCalls: 0, captioning: "on", vlmModel: "qwen3-vl:30b", vlmDurationMs: 35, observed: "ledger" }]);
    assert.match(recorded.description, /\(0 decorative, 0 timed out, 0 failed, 7 recalled from the caption memo, 0 asked of the server\); this process did not run the captioner\./);
    const pre29 = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 12, vlmCaptionsGenerated: 9, vlmDecorative: 2, vlmTimedOut: 1, vlmFailed: 0, captioning: "on", vlmDurationMs: 30000, vlmModel: "qwen3-vl:30b" }]);
    assert.match(pre29.description, /\(2 decorative, 1 timed out, 0 failed\)\.$/, "a record without the memo counts shows nothing new");
    assert.deepStrictEqual({ m: pre29.details.vlmFromMemo, c: pre29.details.vlmCalls }, { m: null, c: null });
  });

  test("T32 (design D9): the text-only verdicts are named beside the decorative ones — only when a record carries them and they are more than none; the details carry the sum; a pre-T32 record reads null", () => {
    const span = buildVlmSpanModel([{ fileName: "Fervi.pdf", picturesCaptured: 84, vlmCaptionsGenerated: 40, vlmDecorative: 17, vlmTextOnly: 24, vlmTruncated: 3, vlmTimedOut: 0, vlmFailed: 0, vlmFromMemo: 0, vlmCalls: 84, vlmNotAttempted: 0, captionBudget: 0, notAttemptedPages: null, captioning: "on", vlmDurationMs: 900000, vlmModel: "qwen3-vl:30b" }]);
    assert.match(span.description, /40 of 84 isolated figure crop\(s\) captioned into the vector store \(17 decorative, 24 text-only, 3 truncated, 0 timed out, 0 failed, 0 recalled from the caption memo, 84 asked of the server\)\.$/);
    assert.strictEqual(span.details.vlmTextOnly, 24);
    const two = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 9, vlmCaptionsGenerated: 8, vlmDecorative: 1, vlmTextOnly: 0, vlmTimedOut: 0, vlmFailed: 0, captioning: "on" }, { fileName: "b.pdf", picturesCaptured: 5, vlmCaptionsGenerated: 0, vlmDecorative: 0, vlmTextOnly: 5, vlmTimedOut: 0, vlmFailed: 0, captioning: "on" }]);
    assert.match(two.description, /\(1 decorative, 5 text-only, 0 timed out, 0 failed\)/, "summed over the records that carry the count");
    assert.strictEqual(two.details.vlmTextOnly, 5);
    const none = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 9, vlmCaptionsGenerated: 8, vlmDecorative: 1, vlmTextOnly: 0, vlmTimedOut: 0, vlmFailed: 0, captioning: "on" }]);
    assert.match(none.description, /\(1 decorative, 0 timed out, 0 failed\)\.$/, "no text-only page: nothing named");
    assert.strictEqual(none.details.vlmTextOnly, 0);
    const recorded = buildVlmSpanModel([], [{ fileName: "Fervi.pdf", engineId: "pypdfium2", picturesCaptured: 84, vlmCaptionsGenerated: 40, vlmDecorative: 17, vlmTextOnly: 24, vlmTruncated: 3, vlmTimedOut: 0, vlmFailed: 0, captioning: "on", vlmModel: "qwen3-vl:30b", vlmDurationMs: 900000, observed: "ledger" }]);
    assert.match(recorded.description, /\(17 decorative, 24 text-only, 3 truncated, 0 timed out, 0 failed\); this process did not run the captioner\./);
    const pre32 = buildVlmSpanModel([], [recorded24()]);
    assert.match(pre32.description, /\(4 decorative, 2 timed out, 0 failed\); this process did not run the captioner\./, "a record without the text-only count shows nothing new");
    assert.strictEqual(pre32.details.vlmTextOnly, null);
    assert.strictEqual(buildVlmSpanModel([]).details.vlmTextOnly, null, "nothing observed: null");
  });

  test("T31 (workshop design D7): the pages beyond the caption budget are named beside the outcomes and per document, in this process and from the ledger; a document within its budget shows nothing new", () => {
    const fervi = { fileName: "Fervi.pdf", picturesCaptured: 84, vlmCaptionsGenerated: 36, vlmDecorative: 14, vlmTimedOut: 0, vlmFailed: 0, vlmFromMemo: 36, vlmCalls: 14, vlmNotAttempted: 34, captionBudget: 50, notAttemptedPages: "51–84", captioning: "on", vlmDurationMs: 90000, vlmModel: "qwen3-vl:30b" };
    const span = buildVlmSpanModel([fervi]);
    assert.match(span.description, /36 of 84 isolated figure crop\(s\) captioned into the vector store \(14 decorative, 0 timed out, 0 failed, 34 beyond the page budget, 36 recalled from the caption memo, 14 asked of the server\)\. Pages beyond the caption budget: Fervi\.pdf 51–84 \(budget 50\)\.$/);
    assert.strictEqual(span.details.vlmNotAttempted, 34);
    assert.deepStrictEqual(span.details.budgetShortfalls, [{ fileName: "Fervi.pdf", notAttempted: 34, captionBudget: 50, notAttemptedPages: "51–84" }]);
    const two = buildVlmSpanModel([fervi, { fileName: "Miele.pdf", picturesCaptured: 124, vlmCaptionsGenerated: 33, vlmDecorative: 3, vlmTimedOut: 0, vlmFailed: 0, vlmFromMemo: 33, vlmCalls: 17, vlmNotAttempted: 74, captionBudget: 50, notAttemptedPages: "51–124", captioning: "on", vlmDurationMs: 1000, vlmModel: "qwen3-vl:30b" }]);
    assert.match(two.description, /108 beyond the page budget/);
    assert.match(two.description, /Pages beyond the caption budget: Fervi\.pdf 51–84 \(budget 50\); Miele\.pdf 51–124 \(budget 50\)\.$/);
    const whole = buildVlmSpanModel([{ ...fervi, vlmNotAttempted: 0, captionBudget: 0, notAttemptedPages: null, vlmCalls: 48, vlmCaptionsGenerated: 60, vlmDecorative: 24 }]);
    assert.match(whole.description, /\(24 decorative, 0 timed out, 0 failed, 36 recalled from the caption memo, 48 asked of the server\)\.$/, "no page beyond the budget: nothing named, no sentence");
    assert.deepStrictEqual({ n: whole.details.vlmNotAttempted, s: whole.details.budgetShortfalls }, { n: 0, s: [] });
    const recorded = buildVlmSpanModel([], [{ fileName: "Fervi.pdf", engineId: "pypdfium2", picturesCaptured: 84, vlmCaptionsGenerated: 36, vlmDecorative: 14, vlmTruncated: 0, vlmTimedOut: 0, vlmFailed: 0, vlmFromMemo: 36, vlmCalls: 14, vlmNotAttempted: 34, captionBudget: 50, notAttemptedPages: "51–84", captioning: "on", vlmModel: "qwen3-vl:30b", vlmDurationMs: 90000, observed: "ledger" }]);
    assert.match(recorded.description, /34 beyond the page budget, 36 recalled from the caption memo, 14 asked of the server\); this process did not run the captioner\. Pages beyond the caption budget: Fervi\.pdf 51–84 \(budget 50\)\.$/);
    assert.strictEqual(recorded.details.vlmNotAttempted, 34);
    const pre31 = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 12, vlmCaptionsGenerated: 9, vlmDecorative: 2, vlmTimedOut: 1, vlmFailed: 0, captioning: "on", vlmDurationMs: 30000, vlmModel: "qwen3-vl:30b" }]);
    assert.match(pre31.description, /\(2 decorative, 1 timed out, 0 failed\)\.$/, "a record without the budget counts shows nothing new");
    assert.deepStrictEqual({ n: pre31.details.vlmNotAttempted, s: pre31.details.budgetShortfalls }, { n: null, s: [] });
    const none = buildVlmSpanModel([]);
    assert.deepStrictEqual({ n: none.details.vlmNotAttempted, s: none.details.budgetShortfalls }, { n: null, s: [] }, "nothing observed: null, no shortfalls");
  });
});

describe("U-TRACE/E31: the VLM span measures or says it cannot", () => {
  const logWithCaptions = {
    fileName: "a.pdf",
    picturesCaptured: 12,
    vlmCaptionsGenerated: 9,
    vlmDurationMs: 30000,
    vlmModel: "qwen3-vl:30b",
  };

  test("captions observed → active badge, observed model, measured duration", () => {
    const span = buildVlmSpanModel([logWithCaptions]);
    assert.match(span.badge, /VLM ACTIVE/);
    assert.strictEqual(span.durationMs, 30000);
    assert.strictEqual(span.details.durationSource, "measured");
    assert.deepStrictEqual(span.details.vlmModels, ["qwen3-vl:30b"]);
    assert.strictEqual(span.details.vlmCaptionsGenerated, 9);
    assert.strictEqual(span.details.picturesIsolated, 12);
  });

  test("ingest observed but zero captions → says exactly that", () => {
    const span = buildVlmSpanModel([{ fileName: "b.docx", picturesCaptured: 0, vlmCaptionsGenerated: 0 }]);
    assert.strictEqual(span.badge, "0 CAPTIONS");
    assert.strictEqual(span.details.vlmCaptionsGenerated, 0);
  });

  test("nothing observed → null counts (not zero) and no invented duration", () => {
    const span = buildVlmSpanModel([]);
    assert.strictEqual(span.badge, "NOT OBSERVED");
    assert.strictEqual(span.badgeType, "neutral");
    assert.strictEqual(span.details.picturesIsolated, null, "0 is a measurement; null is the absence of one");
    assert.strictEqual(span.details.vlmCaptionsGenerated, null);
    assert.strictEqual(span.details.vlmModels, null);
    assert.ok(!("durationMs" in span));
    assert.strictEqual(span.details.durationSource, "unavailable");
  });
});
