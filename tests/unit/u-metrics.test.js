/**
 * U-METRICS — eval metric correctness.
 *
 * Not one of the evaluation-plan §2 suites, but the eval harness that T00 must
 * deliver depends on these functions, and a silent metrics bug would corrupt
 * every baseline comparison that later tickets are gated on. Cheap to guard, so
 * guarded here.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  recallAtK,
  reciprocalRankAtK,
  mean,
  kendallTau,
  scoreHygiene,
  citationValidity,
} = require("../eval/lib/metrics");

const QUERY = { relevant: [{ source: "doc.pdf", pages: [3, 7] }] };
const hit3 = { source: "doc.pdf", page: 3 };
const hit7 = { source: "doc.pdf", page: 7 };
const miss = { source: "doc.pdf", page: 99 };
const otherDoc = { source: "other.pdf", page: 3 };

describe("U-METRICS: recall@k", () => {
  test("counts distinct expected pages found within k", () => {
    assert.equal(recallAtK([hit3, miss, hit7], QUERY, 3), 1);
    assert.equal(recallAtK([hit3, miss, hit7], QUERY, 2), 0.5);
    assert.equal(recallAtK([miss, miss], QUERY, 2), 0);
  });

  test("does not credit a matching page from a different document", () => {
    assert.equal(recallAtK([otherDoc], QUERY, 5), 0);
  });

  test("returns null when the query expects nothing (absence probe)", () => {
    assert.equal(recallAtK([hit3], { relevant: [] }, 5), null);
  });
});

describe("U-METRICS: MRR", () => {
  test("uses the rank of the first relevant result", () => {
    assert.equal(reciprocalRankAtK([hit3, hit7], QUERY, 10), 1);
    assert.equal(reciprocalRankAtK([miss, hit3], QUERY, 10), 0.5);
    assert.equal(reciprocalRankAtK([miss, miss, miss, hit3], QUERY, 10), 0.25);
  });

  test("returns 0 when no relevant result is inside k", () => {
    assert.equal(reciprocalRankAtK([miss, hit3], QUERY, 1), 0);
  });
});

describe("U-METRICS: mean", () => {
  test("ignores nulls and non-finite values", () => {
    assert.equal(mean([1, null, 0.5, undefined, NaN]), 0.75);
    assert.equal(mean([null, null]), null);
  });
});

describe("U-METRICS: Kendall tau", () => {
  test("identical rankings score 1", () => {
    assert.equal(kendallTau(["a", "b", "c"], ["a", "b", "c"]), 1);
  });

  test("fully reversed rankings score -1", () => {
    assert.equal(kendallTau(["a", "b", "c"], ["c", "b", "a"]), -1);
  });

  test("a single swap lands strictly between the extremes", () => {
    const tau = kendallTau(["a", "b", "c"], ["b", "a", "c"]);
    assert.ok(tau > 0 && tau < 1, `expected 0 < tau < 1, got ${tau}`);
  });

  test("items absent from either ranking are ignored", () => {
    assert.equal(kendallTau(["a", "b", "z"], ["a", "b"]), 1);
  });

  test("returns null when fewer than two items are shared", () => {
    assert.equal(kendallTau(["a"], ["a"]), null);
    assert.equal(kendallTau([], []), null);
  });
});

describe("U-METRICS: score hygiene", () => {
  test("counts null, undefined and default-valued scores as degraded", () => {
    const results = [
      { rerankScore: 0.9 },
      { rerankScore: 0.5 },
      { rerankScore: null },
      { rerankScore: undefined },
    ];
    assert.equal(scoreHygiene(results), 0.75);
  });

  test("all-confident results score 0", () => {
    assert.equal(scoreHygiene([{ rerankScore: 0.9 }, { rerankScore: 0.1 }]), 0);
  });
});

describe("U-METRICS: citation validity", () => {
  test("cited pages present in the retrieved context are valid", () => {
    const results = [{ page: 12 }, { page: 18 }];
    assert.equal(citationValidity("See page 12 and page 18.", results), 1);
  });

  test("invented page numbers reduce validity", () => {
    const results = [{ page: 12 }];
    assert.equal(citationValidity("See page 12 and page 99.", results), 0.5);
  });

  test("returns null when the answer cites no pages", () => {
    assert.equal(citationValidity("No citations here.", [{ page: 1 }]), null);
  });

  test("recognises the p. abbreviation", () => {
    assert.equal(citationValidity("(p. 7)", [{ page: 7 }]), 1);
  });
});

// T38 (T34's D8 b): SECTION-level scoring for an unpaginated source — the manifest's engine names the heading(s) an
// anchor sits under, the row carries the parser's heading path; both are normalised, the row's innermost compared.
describe("U-METRICS/T38: section-level keys for an unpaginated source", () => {
  const m = require("../eval/lib/metrics");
  const facts = { "TCO.docx": false, "doc.pdf": true, "story.md": false };
  const docQ = { relevant: [{ source: "TCO.docx", pages: [1], sections: ["References"] }] };
  const multiQ = { relevant: [{ source: "TCO.docx", pages: [1], sections: ["6.1 Storage Methodology Transparency", "Appendix A: Primary Source Data"] }] };
  const plainQ = { relevant: [{ source: "TCO.docx", pages: [1] }] };
  const rowRefs = { source: "TCO.docx", page: 1, sectionPath: "Disclaimer › References" };
  const rowSix = { source: "TCO.docx", page: 1, sectionPath: "Disclaimer › Section 6: Cross-Platform Comparative Analysis › 6.1 Storage Methodology Transparency" };
  const rowAmp = { source: "TCO.docx", page: 1, sectionPath: "Disclaimer › Section 1: Methodology &amp; Assumptions" };
  const rowNone = { source: "TCO.docx", page: 1, sectionPath: null };
  const rowPdf = { source: "doc.pdf", page: 3 };

  test("normaliseSection: entities unescaped, whitespace collapsed, case folded, trailing punctuation dropped; innermostOf takes the path's last part", () => {
    assert.equal(m.normaliseSection("  Section 1: Methodology &amp;   Assumptions: "), "section 1: methodology & assumptions");
    assert.equal(m.normaliseSection("References."), "references");
    assert.equal(m.normaliseSection(null), "");
    assert.equal(m.innermostOf("A › B › C"), "C");
    assert.equal(m.innermostOf("Only"), "Only");
    assert.equal(m.innermostOf(""), "");
    assert.equal(m.sectionKey("TCO.docx", "References"), "TCO.docx#§references");
  });

  test("a query with `sections` expects section keys; without, the document key; a paginated source keeps its page keys", () => {
    assert.deepEqual([...m.expectedKeySet(docQ, facts)], ["TCO.docx#§references"]);
    assert.deepEqual([...m.expectedKeySet(multiQ, facts)], ["TCO.docx#§6.1 storage methodology transparency", "TCO.docx#§appendix a: primary source data"]);
    assert.deepEqual([...m.expectedKeySet(plainQ, facts)], ["TCO.docx#*"]);
    assert.deepEqual([...m.expectedKeySet(QUERY, facts)], ["doc.pdf#3", "doc.pdf#7"]);
    assert.deepEqual([...m.expectedKeySet(docQ, null)], ["TCO.docx#1"], "no facts: the pre-T34 page reading");
  });

  test("a result row answers to its document key AND its section key; a row without a section only to the document key; a pdf row to its page key", () => {
    assert.deepEqual(m.resultKeys(rowRefs, facts), ["TCO.docx#*", "TCO.docx#§references"]);
    assert.deepEqual(m.resultKeys(rowSix, facts), ["TCO.docx#*", "TCO.docx#§6.1 storage methodology transparency"]);
    assert.deepEqual(m.resultKeys(rowAmp, facts), ["TCO.docx#*", "TCO.docx#§section 1: methodology & assumptions"], "F-146: the stored path's &amp; is unescaped for the comparison");
    assert.deepEqual(m.resultKeys(rowNone, facts), ["TCO.docx#*"]);
    assert.deepEqual(m.resultKeys({ source: "TCO.docx", page: 1, sectionTitle: "Disclaimer › References" }, facts), ["TCO.docx#*", "TCO.docx#§references"], "the retrieve route's raw row carries sectionTitle, not sectionPath — the first live run missed both docx queries on that");
    assert.deepEqual(m.resultKeys(rowPdf, facts), ["doc.pdf#3"]);
  });

  test("recall and MRR at section level: the right file in the wrong section is a miss; any named section is a hit; document level still passes on the file alone", () => {
    assert.equal(m.recallAtK([rowSix, rowNone], docQ, 5, facts), 0, "References expected; 6.1 and an unanchored row returned");
    assert.equal(m.recallAtK([rowSix, rowRefs], docQ, 5, facts), 1);
    assert.equal(m.reciprocalRankAtK([rowSix, rowRefs], docQ, 5, facts), 0.5);
    assert.equal(m.recallAtK([rowSix], multiQ, 5, facts), 0.5, "one of the two named sections found");
    assert.equal(m.recallAtK([rowSix, rowNone], plainQ, 5, facts), 1, "document level: the file came back");
    assert.equal(m.recallAtK([rowRefs], docQ, 5, null), 1, "no facts: page 1 = page 1, the pre-T34 reading");
  });

  test("granularityOf: section / document / page / mixed / null", () => {
    assert.equal(m.granularityOf(docQ, facts), "section");
    assert.equal(m.granularityOf(plainQ, facts), "document");
    assert.equal(m.granularityOf(QUERY, facts), "page");
    assert.equal(m.granularityOf({ relevant: [{ source: "TCO.docx", pages: [1], sections: ["References"] }, { source: "doc.pdf", pages: [3] }] }, facts), "mixed");
    assert.equal(m.granularityOf({ relevant: [{ source: "TCO.docx", pages: [1], sections: [" "] }] }, facts), "document", "a blank section name is no section");
    assert.equal(m.granularityOf({ relevant: [] }, facts), null);
  });
});

describe("U-METRICS/T40 D10: Kendall tau with a tie tolerance (F-130)", () => {
  const { kendallTauTolerant, tolerantRanks, TAU_TIE_EPSILON } = require("../eval/lib/metrics");
  const r = (page, score, source = "SSX125_Manual.pdf") => ({ source, page, rerankScore: score });
  // F-130's rows, verbatim: the golden page first at 0.9831, then four chaff rows; SaxonFields#1 read 0.0711 on
  // 2026-09-12 and 0.0709 two days later, 0.0021 below the row above it — the swap that failed two legs.
  const dayOne = [r(33, 0.9831), r(6, 0.0845), r(7, 0.073), r(1, 0.0711, "Barratt_Homes-SaxonFields.pdf"), r(31, 0.0553)];
  const dayTwo = [r(33, 0.9831), r(6, 0.0845), r(1, 0.0709, "Barratt_Homes-SaxonFields.pdf"), r(7, 0.073), r(31, 0.0553)];

  test("ε is 0.005 — a constant of the plan, wider than F-130's measured 0.0021 gap and narrower than any gap an answer depends on", () => {
    assert.strictEqual(TAU_TIE_EPSILON, 0.005);
  });
  test("F-130's swap: the raw τ reads 0.8, the tolerant τ reads 1 — the two chaff rows are one rank", () => {
    const keys = (rows) => rows.map((x) => `${x.source}#${x.page}`);
    assert.ok(Math.abs(kendallTau(keys(dayOne), keys(dayTwo)) - 0.8) < 1e-9);
    assert.strictEqual(kendallTauTolerant(dayOne, dayTwo), 1);
  });
  test("a swap between rows further apart than ε still counts: the golden page dropping below a chaff row reads under 1", () => {
    const swapped = [r(6, 0.0845), r(33, 0.9831), r(7, 0.073), r(1, 0.0711, "Barratt_Homes-SaxonFields.pdf"), r(31, 0.0553)];
    const t = kendallTauTolerant(dayOne, swapped);
    assert.ok(t !== null && t < 1, `expected < 1, got ${t}`);
    assert.strictEqual(kendallTauTolerant(dayOne, dayOne), 1);
    const reversed = [...dayOne].reverse();
    assert.ok(kendallTauTolerant(dayOne, reversed) < 0);
  });
  test("the ranks: a chain within ε shares one rank; a gap starts a new one; unscored rows are their own ranks after the scored ones; a repeated key keeps its first rank", () => {
    const rows = [r(1, 0.9), r(2, 0.074), r(3, 0.072), r(4, 0.0705), r(5, 0.05), r(6, null), r(7, null), r(2, 0.001)];
    const ranks = tolerantRanks(rows);
    const rk = (p) => ranks.get(`SSX125_Manual.pdf#${p}`);
    assert.deepStrictEqual([rk(1), rk(2), rk(3), rk(4), rk(5), rk(6), rk(7)], [0, 1, 1, 1, 2, 3, 4]);
    assert.strictEqual(ranks.size, 7, "page 2 appears twice: its first, best rank is kept");
  });
  test("keys and facts follow resultKey: an unpaginated source is one document key on every row, so τ is undefined (null) as before", () => {
    const facts = { "story.md": false };
    const a = [r(1, 0.9, "story.md"), r(1, 0.5, "story.md")];
    assert.strictEqual(kendallTauTolerant(a, a, { facts }), null);
    assert.strictEqual(kendallTauTolerant([], []), null);
    assert.strictEqual(kendallTauTolerant([r(1, 0.9)], [r(1, 0.9)]), null, "fewer than two shared keys");
  });
  test("a custom epsilon: 0 makes it the raw ordering", () => {
    assert.ok(Math.abs(kendallTauTolerant(dayOne, dayTwo, { epsilon: 0 }) - 0.8) < 1e-9);
  });
});
