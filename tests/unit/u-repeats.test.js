/**
 * U-REPEATS — T40 (t40-design.md D7; F-155): identical text is shown once.
 *
 * The pure module src/lib/rag/repeats.js: the comparable body of a chunk (one
 * leading bracketed header stripped, whitespace folded), the survivor rule
 * (score, then page, then chunkIndex, then position), the report's shape, and
 * what is deliberately NOT matched (a differently chunked copy, an empty
 * body). Offline; reads nothing outside src/.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { collapseRepeats, bodyOf } = require("../../src/lib/rag/repeats");

const DISCLAIMER =
  "All images used are for illustrative purposes only. Floor plans are intended to give a general indication of the proposed floor layout only. " +
  "The dimensions are accurate to within + or - 50mm but should not be used for carpet or flooring sizes, appliance spaces or items of furniture.";
const row = (over = {}) => ({ text: "", source: "Barratt_Homes_SitePlan.pdf", page: 1, chunkIndex: 0, rerankScore: null, ...over });
const keys = (rows) => rows.map((r) => `${r.page}/${r.chunkIndex}`);

describe("U-REPEATS/T40 D7: the comparable body", () => {
  test("one leading bracketed header is stripped — a page header, a page header with its heading, a section prefix, a caption's head, a detail chunk's head", () => {
    assert.strictEqual(bodyOf(`[Page 4] ${DISCLAIMER}`), DISCLAIMER);
    assert.strictEqual(bodyOf(`[Page 2 - KITCHEN LOUNGE B] ${DISCLAIMER}`), DISCLAIMER);
    assert.strictEqual(bodyOf(`[Section: Disclaimer › Section 8: Risk & Sensitivity Analysis › 8.2 Cloud] ${DISCLAIMER}`), DISCLAIMER);
    assert.strictEqual(bodyOf("[HUMAN-LOGICAL VISUAL ELEMENT: Kingsville 4 Bedroom Home | Section: All images used (Page 4)]: TITLE: Kingsville"), "TITLE: Kingsville");
    assert.strictEqual(bodyOf("[VISUAL DETAIL: Kingsville | Section: All images (Page 4)]: KEY: letter B | Boiler"), "KEY: letter B | Boiler");
  });
  test("whitespace is folded; only ONE header is stripped; null / undefined / non-strings are an empty body", () => {
    assert.strictEqual(bodyOf("[Page 4]  All  images\n\tused "), "All images used");
    assert.strictEqual(bodyOf("[Page 1] [Section: a] body"), "[Section: a] body");
    assert.strictEqual(bodyOf(null), "");
    assert.strictEqual(bodyOf(undefined), "");
    assert.strictEqual(bodyOf(42), "42");
    assert.strictEqual(bodyOf("[Page 7]"), "");
  });
});

describe("U-REPEATS/T40 D7: the collapse", () => {
  test("the Site Plan's disclaimer on pages 4–7 (measured: four copies among eight kept rows): one survivor, the highest-scored; the others dropped and named; order kept", () => {
    const rows = [
      row({ text: "[Page 1] Alderney 4 bedroom home plots 172 174", page: 1, chunkIndex: 2, rerankScore: 0.963 }),
      row({ text: `[Page 2 - KITCHEN LOUNGE B] single bedroom and a family bathroom 3 BEDROOM HOME ${DISCLAIMER}`, page: 2, chunkIndex: 7, rerankScore: 0.138 }),
      row({ text: `[Page 6] ${DISCLAIMER}`, page: 6, chunkIndex: 15, rerankScore: 0.074 }),
      row({ text: `[Page 5] ${DISCLAIMER}`, page: 5, chunkIndex: 13, rerankScore: 0.072 }),
      row({ text: `[Page 7] ${DISCLAIMER}`, page: 7, chunkIndex: 17, rerankScore: 0.071 }),
      row({ text: `[Page 4] ${DISCLAIMER}`, page: 4, chunkIndex: 11, rerankScore: 0.069 }),
      row({ text: "[Page 3] Chester 4 bedroom home floor plans", page: 3, chunkIndex: 9, rerankScore: 0.05 }),
    ];
    const { rows: kept, report } = collapseRepeats(rows);
    assert.deepStrictEqual(keys(kept), ["1/2", "2/7", "6/15", "3/9"], "the survivors in their original order; p2's chunk is a DIFFERENT body (it carries the bathroom line) and stays");
    assert.strictEqual(report.count, 3);
    assert.strictEqual(report.groups.length, 1);
    assert.deepStrictEqual(report.groups[0].kept, { source: "Barratt_Homes_SitePlan.pdf", page: 6, chunkIndex: 15, rerankScore: 0.074 });
    assert.deepStrictEqual(report.groups[0].dropped.map((d) => `${d.page}/${d.chunkIndex}:${d.rerankScore}`), ["5/13:0.072", "7/17:0.071", "4/11:0.069"]);
  });
  test("the survivor rule: equal scores → the lowest page, then the lowest chunkIndex, then the earlier row; a null score ranks below any number", () => {
    const body = "the same paragraph on every page";
    const tie = collapseRepeats([
      row({ text: `[Page 9] ${body}`, page: 9, chunkIndex: 40, rerankScore: 0.5 }),
      row({ text: `[Page 3] ${body}`, page: 3, chunkIndex: 12, rerankScore: 0.5 }),
      row({ text: `[Page 3] ${body}`, page: 3, chunkIndex: 11, rerankScore: 0.5 }),
    ]);
    assert.deepStrictEqual(keys(tie.rows), ["3/11"], "equal scores: the lowest page, then the lowest chunkIndex");
    const nulls = collapseRepeats([
      row({ text: `[Page 9] ${body}`, page: 9, chunkIndex: 40, rerankScore: null }),
      row({ text: `[Page 12] ${body}`, page: 12, chunkIndex: 50, rerankScore: 0.01 }),
    ]);
    assert.deepStrictEqual(keys(nulls.rows), ["12/50"], "a scored copy beats an unscored one whatever the page");
    const bothNull = collapseRepeats([
      row({ text: `[Page 12] ${body}`, page: 12, chunkIndex: 50, rerankScore: null }),
      row({ text: `[Page 9] ${body}`, page: 9, chunkIndex: 40, rerankScore: null }),
    ]);
    assert.deepStrictEqual(keys(bothNull.rows), ["9/40"], "two unscored copies: the lowest page");
    const noLocation = collapseRepeats([
      row({ text: body, page: null, chunkIndex: null, rerankScore: null, source: "a.md" }),
      row({ text: body, page: null, chunkIndex: null, rerankScore: null, source: "a.md" }),
    ]);
    assert.strictEqual(noLocation.rows.length, 1, "no score, no page, no index: the earlier row survives");
    assert.strictEqual(noLocation.report.count, 1);
  });
  test("a differently chunked copy is NOT matched (the brochure's OCR straddle of two Site Plan chunks) — the rule is identity, never similarity", () => {
    const siteplan11 = `[Page 4] ${DISCLAIMER} Please ask our Sales Adviser for details of the treatments specified for individual plots. Individual features such as windows, brick and other materials’ colours may vary, as may drainage, heating and`;
    const siteplan12 = "[Page 4] electrical layouts. All images, photographs and dimensions are not intended to form part of any contract or warranty unless specifically incorporated in writing into the contract.";
    const brochure = "[Page 2 - BED 2 BED 3] treatments specified for individual plots. Individual features such as windows, brick and other materials' colours may vary, as may drainage, heating and electrical layouts. Images, photographs and dimensions are not intended to form part of any contract";
    const out = collapseRepeats([row({ text: siteplan11, page: 4, chunkIndex: 11, rerankScore: 0.07 }), row({ text: siteplan12, page: 4, chunkIndex: 12, rerankScore: 0.06 }), row({ text: brochure, source: "Barratt_Homes-SaxonFields.pdf", page: 2, chunkIndex: 3, rerankScore: 0.119 })]);
    assert.strictEqual(out.rows.length, 3);
    assert.strictEqual(out.report.count, 0);
    const oneChar = collapseRepeats([row({ text: "[Page 1] abc", chunkIndex: 1 }), row({ text: "[Page 2] abd", page: 2, chunkIndex: 2 })]);
    assert.strictEqual(oneChar.rows.length, 2, "a one-character difference is a different body");
    const ws = collapseRepeats([row({ text: "[Page 1] a  b\nc", chunkIndex: 1, rerankScore: 0.2 }), row({ text: "[Page 2] a b c", page: 2, chunkIndex: 2, rerankScore: 0.1 })]);
    assert.strictEqual(ws.rows.length, 1, "a whitespace-only difference is the same body");
  });
  test("header-only chunks (empty bodies) are never collapsed; rows without text survive; non-array input is an empty result", () => {
    const out = collapseRepeats([row({ text: "[Page 1]", chunkIndex: 1 }), row({ text: "[Page 2]", page: 2, chunkIndex: 2 }), row({ text: null, chunkIndex: 3 }), { source: "x", page: 1 }]);
    assert.strictEqual(out.rows.length, 4);
    assert.deepStrictEqual(out.report, { count: 0, groups: [] });
    assert.deepStrictEqual(collapseRepeats(null), { rows: [], report: { count: 0, groups: [] } });
    assert.deepStrictEqual(collapseRepeats(undefined).rows, []);
  });
  test("several repeated bodies: one group each, groups in the order of their survivors; a page's caption and its text are different bodies and both stay", () => {
    const a = "the parts strip 8x 118331 1 2 3 4 5", b = "a running footer";
    const rows = [
      row({ text: `[Page 7] ${a}`, page: 7, chunkIndex: 20, rerankScore: 0.3 }),
      row({ text: "[HUMAN-LOGICAL VISUAL ELEMENT: Lathe | Section: x (Page 7)]: TITLE: Lathe SUBJECTS: a lathe", page: 7, chunkIndex: 90, rerankScore: 0.29 }),
      row({ text: `[Page 10] ${b}`, page: 10, chunkIndex: 30, rerankScore: 0.2 }),
      row({ text: `[Page 8] ${a}`, page: 8, chunkIndex: 22, rerankScore: 0.1 }),
      row({ text: `[Page 12] ${b}`, page: 12, chunkIndex: 36, rerankScore: 0.25 }),
    ];
    const out = collapseRepeats(rows);
    assert.deepStrictEqual(keys(out.rows), ["7/20", "7/90", "12/36"]);
    assert.strictEqual(out.report.count, 2);
    assert.deepStrictEqual(out.report.groups.map((g) => `${g.kept.page}/${g.kept.chunkIndex}<-${g.dropped.map((d) => d.page + "/" + d.chunkIndex).join(",")}`), ["7/20<-8/22", "12/36<-10/30"]);
  });
  test("the input rows are not mutated and the survivors are the same objects", () => {
    const r1 = row({ text: "[Page 1] same", chunkIndex: 1, rerankScore: 0.9 });
    const r2 = row({ text: "[Page 2] same", page: 2, chunkIndex: 2, rerankScore: 0.8 });
    const snapshot = JSON.stringify([r1, r2]);
    const out = collapseRepeats([r1, r2]);
    assert.strictEqual(out.rows[0], r1);
    assert.strictEqual(JSON.stringify([r1, r2]), snapshot);
  });
});
