/**
 * U-CITE-METRIC — the citation eval instrument's scoring machinery (T14).
 *
 * tests/eval/run_citations.js is the instrument that measures the §5
 * citation-validity metric; a silent change to its exclusion or aggregation
 * rules would move the T14 headline number with every repo test green. These
 * pins import the machinery directly (the runner is require-safe: the leg
 * only fires as an entrypoint) and feed it synthetic /api/chat responses.
 *
 * The synthetic-pagination cases pin the F-11 anti-whitewash mechanics at
 * unit level, because the live eval corpus (4 real-paginated PDFs) cannot
 * exercise them — a future .docx corpus must not score "p.1" as valid.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { scoreTurn, aggregate, syntheticSources } = require("../eval/run_citations.js");

const SYNTH = new Set(["stamped.docx"]);

/** A minimal /api/chat response shape as the runner consumes it. */
function chatResponse({
  state = "ok",
  success = true,
  answer = "",
  chunks = [{ source: "real.pdf", page: 4 }],
  citations,
  uncitedClaims,
  omitTrace = false,
} = {}) {
  return {
    success,
    response: answer,
    retrieval: { state, code: null, message: null, chunkCount: chunks.length },
    traces: omitTrace
      ? []
      : [{ category: "rag_pipeline", details: { retrievedChunks: chunks } }],
    ...(citations ? { citations } : {}),
    ...(uncitedClaims ? { uncitedClaims } : {}),
  };
}

describe("U-CITE-METRIC: exclusion rules (excluded and counted, never hidden)", () => {
  test("retrieval failed, skipped and undefined are excluded", () => {
    for (const state of ["failed", "skipped"]) {
      const s = scoreTurn({ data: chatResponse({ state }), synthSources: SYNTH });
      assert.strictEqual(s.excluded, true, `state=${state}`);
    }
    const noRetrieval = chatResponse({});
    delete noRetrieval.retrieval;
    assert.strictEqual(scoreTurn({ data: noRetrieval, synthSources: SYNTH }).excluded, true, "missing retrieval object");
  });

  test("a generation failure is excluded — the T12 error string is not an honestly claim-free answer", () => {
    const s = scoreTurn({
      data: chatResponse({ success: false, answer: "Model request failed (x): timeout. No answer was generated" }),
      synthSources: SYNTH,
    });
    assert.strictEqual(s.excluded, true);
    assert.match(s.reason, /generation failed/);
  });

  test("a missing rag_pipeline trace excludes the turn — reference pages must be attributable (F-24)", () => {
    const s = scoreTurn({
      data: chatResponse({ answer: "see Page 4", omitTrace: true }),
      synthSources: SYNTH,
    });
    assert.strictEqual(s.excluded, true);
    assert.match(s.reason, /no retrieval evidence/);
  });

  test("empty and degraded stay in — citing pages when nothing relevant was retrieved is the point", () => {
    for (const state of ["empty", "degraded", "ok"]) {
      const s = scoreTurn({ data: chatResponse({ state }), synthSources: SYNTH });
      assert.strictEqual(s.excluded, false, `state=${state}`);
    }
  });
});

describe("U-CITE-METRIC: judgment and F-11 synthetic handling", () => {
  test("a supported and a fabricated claim split against trace pages", () => {
    const s = scoreTurn({
      data: chatResponse({ answer: "Detail on Page 4; more on Page 9." }),
      synthSources: SYNTH,
    });
    assert.strictEqual(s.supportedClaimCount, 1);
    assert.deepStrictEqual(s.fabricatedClaims.map((c) => c.page), [9]);
  });

  test("pages contributed only by manifest-synthetic sources neither support nor fabricate — counted separately", () => {
    const s = scoreTurn({
      data: chatResponse({
        answer: "As stated on Page 1 and on Page 4.",
        chunks: [
          { source: "stamped.docx", page: 1 },
          { source: "real.pdf", page: 4 },
        ],
      }),
      synthSources: SYNTH,
    });
    // Page 1 exists ONLY via the synthetic source: excluded from judgment.
    assert.strictEqual(s.syntheticPageClaimCount, 1);
    assert.strictEqual(s.supportedClaimCount, 1);
    assert.deepStrictEqual(s.fabricatedClaims, []);
  });

  test("a page shared by a synthetic and a real source stays judgeable", () => {
    const s = scoreTurn({
      data: chatResponse({
        answer: "See Page 1.",
        chunks: [
          { source: "stamped.docx", page: 1 },
          { source: "real.pdf", page: 1 },
        ],
      }),
      synthSources: SYNTH,
    });
    assert.strictEqual(s.syntheticPageClaimCount, 0);
    assert.strictEqual(s.supportedClaimCount, 1);
  });

  test("marker citations to manifest-synthetic sources are synthetic even when the pod says 'unknown'", () => {
    // Process-local pageAttribution reads "unknown" after any pod restart
    // (F-30); the instrument classifies by the manifest instead.
    const s = scoreTurn({
      data: chatResponse({
        citations: [
          { marker: "S1", source: "stamped.docx", page: 1, pageAttribution: "unknown" },
          { marker: "S2", source: "real.pdf", page: 4, pageAttribution: "unknown" },
        ],
        uncitedClaims: [],
      }),
      synthSources: SYNTH,
    });
    assert.strictEqual(s.syntheticCitationCount, 1);
    assert.strictEqual(s.validCitationCount, 1);
  });

  test("invalid markers are read from the server's pinned uncitedClaims format", () => {
    const s = scoreTurn({
      data: chatResponse({
        citations: [],
        uncitedClaims: [
          "cited context block [S9] does not exist (context has 3 blocks)",
          'page 99 is cited but matches no retrieved chunk: "excerpt"',
        ],
      }),
      synthSources: SYNTH,
    });
    assert.strictEqual(s.invalidMarkerCount, 1);
  });
});

describe("U-CITE-METRIC: aggregation — three rates, one job each", () => {
  const perQuery = [
    { set: "elicited", score: { excluded: false, supportedClaimCount: 3, fabricatedClaims: [{ page: 9 }], validCitationCount: 4, invalidMarkerCount: 1, syntheticPageClaimCount: 0, syntheticCitationCount: 0, validInstances: 7, totalInstances: 9, pageClaims: [] } },
    { set: "elicited", score: { excluded: true, reason: "retrieval.state=failed" } },
  ];

  test("pageClaimValidityRate carries no marker term — the leg-comparable pair", () => {
    const m = aggregate(perQuery);
    assert.strictEqual(m.pageClaimValidityRate, 3 / 4);
  });

  test("markerResolutionRate is the treatment's own health, null when no markers exist", () => {
    const m = aggregate(perQuery);
    assert.strictEqual(m.markerResolutionRate, 4 / 5);
    const before = aggregate([
      { set: "elicited", score: { excluded: false, supportedClaimCount: 2, fabricatedClaims: [], validCitationCount: 0, invalidMarkerCount: 0, syntheticPageClaimCount: 0, syntheticCitationCount: 0, validInstances: 2, totalInstances: 2, pageClaims: [] } },
    ]);
    assert.strictEqual(before.markerResolutionRate, null);
    assert.strictEqual(before.pageClaimValidityRate, 1);
  });

  test("citationValidityRate is the §5 gate over every citing act; exclusions are counted", () => {
    const m = aggregate(perQuery);
    assert.strictEqual(m.citationValidityRate, 7 / 9);
    assert.strictEqual(m.queriesScored, 1);
    assert.strictEqual(m.queriesExcluded, 1);
  });
});

describe("U-CITE-METRIC: manifest-derived synthetic sources", () => {
  test("docx entries are synthetic-pagination; pdf entries are not (F-11/X4)", () => {
    const synth = syntheticSources({
      corpus: [
        { fileName: "a.pdf", fileType: "pdf" },
        { fileName: "b.docx", fileType: "docx" },
        { fileName: "c.pptx", fileType: "pptx" },
      ],
    });
    assert.deepStrictEqual([...synth], ["b.docx"]);
  });
});
