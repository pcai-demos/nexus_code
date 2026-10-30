/**
 * U-RERANK — the reranker score contract (evaluation-plan §2, ticket T10).
 *
 * The captured strings below are the real shapes this code has to survive,
 * including Qwen3 thinking-mode output, which is why audit E20 records score
 * corruption: the old numeric fallback harvested digits from reasoning text,
 * and any failed call silently kept a 0.5 default that outranked a confident
 * "no" (0.1).
 *
 * These are pure-function tests over src/lib/rag/rerank.js — the module T10
 * extracted out of the retrieve route precisely so the failure shapes are
 * pinned on every `npm test` rather than only when a live endpoint misbehaves.
 * The structural walk at the bottom guards the fabrications from coming back
 * through the route, where the pure tests cannot see them.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  VERDICT_YES,
  VERDICT_NO,
  RERANK_HEAD_CHARS,
  RERANK_TAIL_CHARS,
  parseVerdict,
  stripThinkBlocks,
  windowForRerank,
  mapDedicatedScores,
  orderByScore,
  passesFloor,
  countScored,
  scoreOf,
} = require("../../src/lib/rag/rerank");

const RETRIEVE_ROUTE = path.join(__dirname, "..", "..", "src", "app", "api", "rag", "retrieve", "route.js");

/** Strip comments so a walk cannot be satisfied (or tripped) by prose. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Verdicts once T10's anchored parsing is in place. `expect` is the exact
 * score, or null for "unparseable — nobody judged this passage".
 */
const SCORE_CASES = [
  { input: "yes", expect: VERDICT_YES, note: "plain affirmative" },
  { input: "No.", expect: VERDICT_NO, note: "affirmative/negative with punctuation" },
  { input: "Relevant: yes", expect: VERDICT_YES, note: "prefixed affirmative — the prompt ends with 'Relevant:'" },
  { input: "0.85", expect: 0.85, note: "bare float in range" },
  {
    input: "<think>the passage scores about 7/10 for relevance</think>\n\nyes",
    expect: VERDICT_YES,
    note: "thinking-mode wrapper must be stripped BEFORE parsing, not scanned for digits",
  },
  {
    input: "I think the answer is 42",
    expect: null,
    note: "audit E20 — must NOT harvest 42 as a score; unparseable means null",
  },
  { input: "", expect: null, note: "empty response is unparseable" },
  { input: "__THROW__", expect: null, note: "transport failure must yield null, never 0.5" },
];

describe("U-RERANK: score parsing", () => {
  for (const { input, expect, note } of SCORE_CASES) {
    const label = input === "" ? "(empty)" : input.slice(0, 40).replace(/\n/g, "\\n");
    test(`${label} -> ${String(expect)} — ${note}`, () => {
      // A transport failure never produces a body at all: the caller has
      // nothing to hand the parser, and that must not become a score either.
      const actual = input === "__THROW__" ? parseVerdict(undefined) : parseVerdict(input);
      assert.strictEqual(actual, expect);
    });
  }

  test("no verdict, parseable or not, is ever the 0.5 seed (F-26)", () => {
    for (const { input } of SCORE_CASES) {
      assert.notStrictEqual(parseVerdict(input), 0.5, `"${input}" must not parse to the 0.5 seed`);
    }
  });

  test("affirmatives and negatives must be ANCHORED, not found anywhere in the text", () => {
    // The pre-T10 code used `.startsWith` on a lowercased body but fell back to
    // an unanchored digit search, so prose that merely CONTAINED a verdict word
    // or a number produced a score.
    assert.strictEqual(parseVerdict("The document does not say. Probably no."), null);
    assert.strictEqual(parseVerdict("this passage is 0.9 of the way through the manual"), null);
    assert.strictEqual(parseVerdict("yesterday's revision"), null, "`\\b` must stop 'yesterday' scoring as yes");
  });

  test("a number outside [0,1] is not a score", () => {
    assert.strictEqual(parseVerdict("1.5"), null, "the anchored pattern admits 1.5 — the range check must reject it");
    assert.strictEqual(parseVerdict("7"), null);
    assert.strictEqual(parseVerdict("-0.2"), null);
    assert.strictEqual(parseVerdict("0"), 0, "0 is a legitimate score, and must not be confused with absent");
    assert.strictEqual(parseVerdict("1"), 1);
  });

  test("non-string bodies are unparseable rather than throwing", () => {
    // This runs inside the scoring loop of a live request; a throw here would
    // cost the whole retrieval.
    for (const value of [undefined, null, 42, {}, [], NaN]) {
      assert.strictEqual(parseVerdict(value), null);
    }
  });
});

describe("U-RERANK: <think> handling", () => {
  test("a closed block is removed entirely, and its digits with it", () => {
    assert.strictEqual(stripThinkBlocks("<think>7/10</think>yes"), "yes");
  });

  test("an UNTERMINATED block means the verdict never arrived", () => {
    // These calls run with max_tokens ~10, so a model that starts reasoning is
    // truncated mid-thought: there is no verdict to find, and inventing one
    // from the reasoning text is exactly audit E20.
    assert.strictEqual(parseVerdict("<think>let me weigh this 0.9"), null);
  });

  test("a stray closer is tolerated — the template pre-fills an empty think block", () => {
    assert.strictEqual(parseVerdict("</think>\n\nno"), VERDICT_NO);
  });
});

describe("U-RERANK: ranking semantics", () => {
  test("null-scored candidates never outrank a parsed negative", () => {
    // Audit E20 / FM-N1: a failed scoring call kept 0.5, which beat a
    // confidently-rejected candidate at 0.1 — an unjudged passage outranking a
    // judged one. Nulls now sort below every scored candidate.
    const ordered = orderByScore([
      { id: "unscored-first", rerankScore: null },
      { id: "confident-no", rerankScore: VERDICT_NO },
      { id: "confident-yes", rerankScore: VERDICT_YES },
    ]);
    assert.deepStrictEqual(
      ordered.map((c) => c.id),
      ["confident-yes", "confident-no", "unscored-first"]
    );
  });

  test("scored candidates sort descending; ties and nulls keep retrieval order", () => {
    const ordered = orderByScore([
      { id: "a", rerankScore: null },
      { id: "b", rerankScore: 0.4 },
      { id: "c", rerankScore: null },
      { id: "d", rerankScore: 0.9 },
      { id: "e", rerankScore: 0.4 },
      { id: "f", rerankScore: null },
    ]);
    assert.deepStrictEqual(
      ordered.map((c) => c.id),
      ["d", "b", "e", "a", "c", "f"],
      "b before e (equal scores, retrieval order); a,c,f last in retrieval order"
    );
  });

  test("an all-null set is returned in retrieval order, not reshuffled", () => {
    // The dead-reranker case. `b.rerankScore - a.rerankScore` yields NaN here,
    // and a NaN comparator leaves the order implementation-defined.
    const input = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }].map((c) => ({ ...c, rerankScore: null }));
    assert.deepStrictEqual(orderByScore(input).map((c) => c.id), [1, 2, 3, 4]);
  });

  test("undefined, NaN and non-numeric scores are all treated as unscored", () => {
    assert.strictEqual(scoreOf({ rerankScore: undefined }), null);
    assert.strictEqual(scoreOf({ rerankScore: NaN }), null);
    assert.strictEqual(scoreOf({ rerankScore: "0.9" }), null, "a string is not a score");
    assert.strictEqual(scoreOf({ rerankScore: Infinity }), null);
    assert.strictEqual(scoreOf({ rerankScore: 0 }), 0, "0 is scored");
    assert.strictEqual(countScored([{ rerankScore: 0 }, { rerankScore: null }, { rerankScore: 0.5 }]), 2);
  });

  test("the sort does not mutate its input", () => {
    const input = [{ id: 1, rerankScore: 0.1 }, { id: 2, rerankScore: 0.9 }];
    orderByScore(input);
    assert.deepStrictEqual(input.map((c) => c.id), [1, 2]);
  });
});

describe("U-RERANK: the relevance floor applies to scored candidates only", () => {
  test("minRerankScore filters only candidates that actually have a score", () => {
    const min = 0.05;
    assert.strictEqual(passesFloor({ rerankScore: 0.9 }, min), true);
    assert.strictEqual(passesFloor({ rerankScore: 0.01 }, min), false, "a real score below the floor is dropped");
    // The owner's ruling (2026-09-03): unscored candidates PASS, because
    // suppressing them turns a rerank outage into "the documents do not mention
    // it" for every query (FM-L7 masking). Safe only because the turn is
    // disclosed as degraded — see U-DISCLOSURE.
    assert.strictEqual(passesFloor({ rerankScore: null }, min), true);
    assert.strictEqual(passesFloor({ rerankScore: undefined }, min), true);
    assert.strictEqual(passesFloor({}, min), true);
  });

  test("a floor of 0 keeps every scored candidate (that is how the T08 before-leg was produced)", () => {
    assert.strictEqual(passesFloor({ rerankScore: 0 }, 0), true);
    assert.strictEqual(passesFloor({ rerankScore: null }, 0), true);
  });

  test("the fabricated 0.5 seed used to clear the calibrated floor — and now cannot exist", () => {
    // F-26's mechanism in one assertion: 0.5 >= 0.05 passed everything. The
    // fix is not a different floor, it is that no code path produces 0.5.
    assert.strictEqual(passesFloor({ rerankScore: 0.5 }, 0.05), true);
  });
});

describe("U-RERANK: dedicated-API index mapping", () => {
  const candidates = [{ id: "c0" }, { id: "c1" }, { id: "c2" }];

  test("scores are attributed by explicit index, whatever order the rows arrive in", () => {
    const { scored, usableCount, reason } = mapDedicatedScores(candidates, [
      { index: 2, relevance_score: 0.9 },
      { index: 0, relevance_score: 0.1 },
      { index: 1, relevance_score: 0.5 },
    ]);
    assert.strictEqual(usableCount, 3);
    assert.strictEqual(reason, null);
    assert.deepStrictEqual(
      scored.map((c) => [c.id, c.rerankScore]),
      [["c0", 0.1], ["c1", 0.5], ["c2", 0.9]]
    );
  });

  test("provider results without an index are not mapped positionally", () => {
    // Audit E21: `results.find(r => r.index === idx) || results[idx]` silently
    // assigns scores to the wrong candidates when a provider returns results
    // sorted by relevance without an index field. Nothing may be attributed.
    const { scored, usableCount, reason } = mapDedicatedScores(candidates, [
      { relevance_score: 0.9 },
      { relevance_score: 0.5 },
      { relevance_score: 0.1 },
    ]);
    assert.strictEqual(usableCount, 0);
    assert.match(reason, /index/i);
    for (const c of scored) assert.strictEqual(c.rerankScore, null);
  });

  test("one unusable index poisons the whole batch — partial positional trust is still positional", () => {
    const { usableCount, scored } = mapDedicatedScores(candidates, [
      { index: 0, relevance_score: 0.9 },
      { relevance_score: 0.5 },
      { index: 2, relevance_score: 0.1 },
    ]);
    assert.strictEqual(usableCount, 0);
    for (const c of scored) assert.strictEqual(c.rerankScore, null);
  });

  test("duplicate or out-of-range indices are not usable either", () => {
    assert.strictEqual(mapDedicatedScores(candidates, [
      { index: 0, relevance_score: 0.9 },
      { index: 0, relevance_score: 0.5 },
    ]).usableCount, 0);
    assert.strictEqual(mapDedicatedScores(candidates, [{ index: 99, relevance_score: 0.9 }]).usableCount, 0);
    assert.strictEqual(mapDedicatedScores(candidates, [{ index: 1.5, relevance_score: 0.9 }]).usableCount, 0);
  });

  test("a candidate the provider omitted scores null — NEVER the old 1.0 default (E21)", () => {
    const { scored, usableCount } = mapDedicatedScores(candidates, [{ index: 1, relevance_score: 0.42 }]);
    assert.strictEqual(usableCount, 1);
    assert.deepStrictEqual(
      scored.map((c) => c.rerankScore),
      [null, 0.42, null],
      "an unscored candidate must not be handed the highest possible relevance"
    );
  });

  test("an empty or absent result array scores nothing, and says why", () => {
    for (const rows of [[], null, undefined, "nonsense"]) {
      const { scored, usableCount, reason } = mapDedicatedScores(candidates, rows);
      assert.strictEqual(usableCount, 0);
      assert.ok(reason, "the caller needs a cause to report as the degradation message");
      assert.deepStrictEqual(scored.map((c) => c.rerankScore), [null, null, null]);
    }
  });

  test("a non-numeric or non-finite relevance_score is not a score", () => {
    const { scored, usableCount } = mapDedicatedScores(candidates, [
      { index: 0, relevance_score: "0.9" },
      { index: 1, relevance_score: null },
      { index: 2, score: 0.3 },
    ]);
    assert.strictEqual(usableCount, 1, "only the `score`-dialect row is usable");
    assert.deepStrictEqual(scored.map((c) => c.rerankScore), [null, null, 0.3]);
  });

  test("candidate fields are preserved, not replaced", () => {
    const { scored } = mapDedicatedScores([{ id: "c0", text: "body", page: 7 }], [
      { index: 0, relevance_score: 0.5 },
    ]);
    assert.deepStrictEqual(scored[0], { id: "c0", text: "body", page: 7, rerankScore: 0.5 });
  });
});

describe("U-RERANK: the rerank input window (FM-T3)", () => {
  test("rerank input includes chunk head and tail, not just the first 1500 chars", () => {
    const body = `HEAD${"m".repeat(4000)}TAIL`;
    const windowed = windowForRerank(body);
    assert.ok(windowed.startsWith("HEAD"), "the head must be present");
    assert.ok(windowed.endsWith("TAIL"), "the tail must be present — this is the whole point of FM-T3");
    assert.ok(!windowed.includes("m".repeat(2000)), "the middle must be dropped, not kept");
    assert.ok(
      windowed.length < body.length,
      "a windowed chunk must be shorter than the original"
    );
  });

  test("the window is 1000 head + 400 tail, per the ticket", () => {
    assert.strictEqual(RERANK_HEAD_CHARS, 1000);
    assert.strictEqual(RERANK_TAIL_CHARS, 400);
    const body = "x".repeat(10000);
    const windowed = windowForRerank(body);
    assert.ok(
      windowed.length >= RERANK_HEAD_CHARS + RERANK_TAIL_CHARS &&
        windowed.length <= RERANK_HEAD_CHARS + RERANK_TAIL_CHARS + 16,
      `expected ~1400 chars plus a short elision marker, got ${windowed.length}`
    );
  });

  test("a chunk that fits is passed through untouched", () => {
    // Measured on the eval collection: 69 of 102 chunks are under 1400 chars,
    // so the common case must not gain an elision marker.
    const short = "y".repeat(1400);
    assert.strictEqual(windowForRerank(short), short);
    assert.strictEqual(windowForRerank(""), "");
  });

  test("non-string input yields an empty string rather than throwing", () => {
    for (const value of [undefined, null, 42, {}]) assert.strictEqual(windowForRerank(value), "");
  });
});

describe("U-RERANK: the fabrications cannot come back through the route", () => {
  // The pure tests above cannot see the route's own literals. These walk the
  // deployed source, in the same spirit as U-CFG's banned-literals check: the
  // 0.5 seed and the 1.0 default were both single tokens, and either one
  // reappearing silently restores F-26 or E21.
  const src = codeOnly(fs.readFileSync(RETRIEVE_ROUTE, "utf-8"));

  test("no rerankScore is ever assigned a literal default", () => {
    const offenders = src.match(/rerankScore[\s:=]+(?:0\.5|1\.0|1|0\.1|0\.9)\b/g) || [];
    assert.deepStrictEqual(
      offenders,
      [],
      `a literal rerankScore default is back in the route:\n${offenders.join("\n")}`
    );
  });

  test("the route seeds candidates with null, and parses through the shared module", () => {
    assert.match(src, /rerankScore:\s*null/, "the generative paths must seed null, not 0.5");
    assert.match(src, /parseVerdict/, "verdict parsing must come from src/lib/rag/rerank.js");
    assert.match(src, /orderByScore/, "the sort contract must come from the shared module");
    assert.match(src, /passesFloor/, "the floor must use the shared scored-only predicate");
    assert.match(src, /mapDedicatedScores/, "index mapping must come from the shared module");
  });

  test("the positional-mapping fallback is gone from the route", () => {
    assert.ok(
      !/results\.find\([^)]*\)\s*\|\|\s*results\[/.test(src),
      "`results.find(...) || results[idx]` is E21's score scrambler"
    );
  });

  test("the unanchored digit harvester is gone from the route", () => {
    // `response.match(/\b(0?\.\d+|1\.0|0|1)\b/)` is how "I think the answer is
    // 42"-shaped prose became a score.
    assert.ok(!/numericMatch/.test(src), "the old unanchored numeric fallback must not survive");
  });

  test("T08's three-part reranker arrangement is preserved (F-23)", () => {
    // Break any leg and scores silently become useless: a near-uniform band
    // with wrong ordering (no template), or ~0.0001 for anchor queries against
    // their own chunk (answer-style instruct), which destroys anchor recall
    // under any floor. T10 owns parsing, not prompting.
    assert.match(src, /qwen3-reranker/i, "the template wrap must stay gated on the model name");
    assert.match(src, /<\|im_start\|>system/, "the Qwen3 instruction template must survive");
    assert.match(
      src,
      /contains, mentions, or is about/,
      "the mention-style instruct is load-bearing for anchor recall"
    );
  });
});
