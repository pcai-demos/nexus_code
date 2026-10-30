/**
 * U-COMPANIONS — page-level context assembly, the pure module (ticket T28,
 * t28-design.md §2, §7; F-99). Every rule that is a decision is pinned here.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
  COMPANION_MODES,
  identityOf,
  companionPagesFor,
  selectCompanions,
  interleave,
} = require("../../src/lib/rag/companions");

const text = (over = {}) => ({ source: "Fervi.pdf", page: 25, chunkIndex: 78, isVisualElement: false, text: "see Figure 15", metadata: "{}", rerankScore: 0.99, ...over });
const cap = (over = {}) => ({ source: "Fervi.pdf", page: 25, chunkIndex: 204, isVisualElement: true, imagePath: "/extracted_images/x/fig_25_0.png", text: "Figure 15 - 1728 x 440 mm", metadata: JSON.stringify({ isVisualElement: true }), ...over });

describe("U-COMPANIONS: the page list", () => {
  test("distinct located pages in ranked order; sourceId carried; junk skipped", () => {
    const { pages, skipped } = companionPagesFor([
      text({ page: 25, sourceId: "demos/f.pdf" }),
      text({ page: 84, chunkIndex: 191 }),
      text({ page: 25, chunkIndex: 77 }),
      text({ page: 0, chunkIndex: 1 }),
      text({ source: "", page: 3 }),
      null,
      text({ source: "TCO.docx", page: 1, chunkIndex: 5 }),
    ], { paginationFacts: { "TCO.docx": false } });
    assert.deepStrictEqual(pages, [
      { source: "Fervi.pdf", sourceId: "demos/f.pdf", page: 25 },
      { source: "Fervi.pdf", sourceId: null, page: 84 },
    ]);
    assert.deepStrictEqual(skipped, { notLocated: 3, singlePage: 1 });
  });

  test("an unknown pagination attribution keeps its pages (never fabricate 'synthetic')", () => {
    const { pages } = companionPagesFor([text({ source: "Unknown.pdf", page: 2 })], { paginationFacts: {} });
    assert.strictEqual(pages.length, 1);
    assert.strictEqual(companionPagesFor([text()], { paginationFacts: null }).pages.length, 1);
  });
});

describe("U-COMPANIONS: identity", () => {
  test("by (source, chunkIndex) on v2; by (source, page, kind, text) without chunkIndex", () => {
    assert.strictEqual(identityOf(text()), "Fervi.pdf|#78");
    assert.strictEqual(identityOf(text({ chunkIndex: null })), "Fervi.pdf|p25|t|see Figure 15");
    assert.strictEqual(identityOf(cap({ chunkIndex: null })), "Fervi.pdf|p25|c|Figure 15 - 1728 x 440 mm");
    assert.notStrictEqual(identityOf(text({ chunkIndex: null })), identityOf(cap({ chunkIndex: null, text: "see Figure 15" })), "kind separates a caption from text of the same words");
  });
});

describe("U-COMPANIONS: selection (design D3, D5, D7, D9)", () => {
  test("mode captions: a kept text chunk brings its page's caption, behind that anchor, with a reason", () => {
    const kept = [text({ page: 1, chunkIndex: 0 }), text(), text({ page: 84, chunkIndex: 191 })];
    const rows = [cap(), text({ chunkIndex: 76 }), text({ chunkIndex: 77 })];
    const r = selectCompanions({ kept, pageRows: rows, mode: "captions", budget: 8 });
    assert.strictEqual(r.companions.length, 1);
    assert.strictEqual(r.companions[0].anchorIndex, 1);
    assert.strictEqual(r.companions[0].kind, "caption");
    assert.strictEqual(r.companions[0].chunk.chunkIndex, 204);
    assert.match(r.companions[0].reason, /page 25/);
    assert.strictEqual(r.pagesConsidered, 3);
    assert.strictEqual(r.skipped.alreadyKept, 0);
    assert.ok(!("_order" in r.companions[0].chunk), "the internal order key never leaks");
  });

  test("exact source equality: a token-matched sibling document's rows are never companions (F-109)", () => {
    const r = selectCompanions({ kept: [text()], pageRows: [cap({ source: "Fervi_v2.pdf" }), cap()], mode: "captions", budget: 8 });
    assert.strictEqual(r.companions.length, 1);
    assert.strictEqual(r.companions[0].chunk.source, "Fervi.pdf");
    assert.strictEqual(r.skipped.foreignSource, 1);
  });

  test("dedupe: a caption the reranker already kept is not added twice; one reachable from two anchors is added once", () => {
    const r = selectCompanions({ kept: [text(), cap(), text({ chunkIndex: 77 })], pageRows: [cap(), text({ chunkIndex: 76 })], mode: "captions", budget: 8 });
    assert.strictEqual(r.companions.length, 0);
    assert.strictEqual(r.skipped.alreadyKept, 1);
    const two = selectCompanions({ kept: [text(), text({ chunkIndex: 77 })], pageRows: [cap()], mode: "captions", budget: 8 });
    assert.strictEqual(two.companions.length, 1);
    assert.strictEqual(two.companions[0].anchorIndex, 0, "behind the first anchor of the page");
  });

  test("a whole page or nothing: the budget admits a page's companions together or skips them and counts them", () => {
    const kept = [text({ page: 1, chunkIndex: 0 }), text({ page: 2, chunkIndex: 5 })];
    const rows = [cap({ page: 1, chunkIndex: 200 }), cap({ page: 1, chunkIndex: 201, text: "second figure" }), cap({ page: 2, chunkIndex: 202 })];
    const r = selectCompanions({ kept, pageRows: rows, mode: "captions", budget: 1 });
    assert.strictEqual(r.companions.length, 1, "page 1's pair exceeds the budget; page 2's single fits");
    assert.strictEqual(r.companions[0].chunk.page, 2);
    assert.strictEqual(r.skipped.overBudget, 2);
    const zero = selectCompanions({ kept, pageRows: rows, mode: "captions", budget: 0 });
    assert.strictEqual(zero.companions.length, 0);
    assert.strictEqual(zero.skipped.overBudget, 3);
  });

  test("captions of one page are ordered by chunkIndex (stored order without one)", () => {
    const rows = [cap({ chunkIndex: 205, text: "b" }), cap({ chunkIndex: 204, text: "a" })];
    const r = selectCompanions({ kept: [text()], pageRows: rows, mode: "captions", budget: 8 });
    assert.deepStrictEqual(r.companions.map((c) => c.chunk.text), ["a", "b"]);
    const v1 = selectCompanions({ kept: [text({ chunkIndex: null })], pageRows: [cap({ chunkIndex: null, text: "first" }), cap({ chunkIndex: null, text: "second" })], mode: "captions", budget: 8 });
    assert.deepStrictEqual(v1.companions.map((c) => c.chunk.text), ["first", "second"]);
  });

  test("mode page: a kept CAPTION brings its page's text, at most textPerPage, in stored order, counted when capped; a text anchor still brings only captions", () => {
    const rows = [text({ chunkIndex: 76 }), text({ chunkIndex: 77 }), text({ chunkIndex: 78 }), cap()];
    const r = selectCompanions({ kept: [cap()], pageRows: rows, mode: "page", budget: 8, textPerPage: 2 });
    assert.deepStrictEqual(r.companions.map((c) => [c.kind, c.chunk.chunkIndex]), [["text", 76], ["text", 77]]);
    assert.strictEqual(r.skipped.textCapped, 1);
    assert.match(r.companions[0].reason, /page text/);
    const t = selectCompanions({ kept: [text()], pageRows: rows, mode: "page", budget: 8, textPerPage: 2 });
    assert.deepStrictEqual(t.companions.map((c) => c.kind), ["caption"]);
  });

  test("mode captions never brings text; mode off brings nothing and says so", () => {
    const rows = [text({ chunkIndex: 76 }), cap()];
    assert.deepStrictEqual(selectCompanions({ kept: [cap()], pageRows: rows, mode: "captions", budget: 8 }).companions, []);
    const off = selectCompanions({ kept: [text()], pageRows: rows, mode: "off", budget: 8 });
    assert.deepStrictEqual(off.companions, []);
    assert.strictEqual(off.mode, "off");
    assert.strictEqual(off.pagesConsidered, 0);
    assert.deepStrictEqual(COMPANION_MODES, ["off", "captions", "page"]);
  });

  test("single-page sources and unlocated pages are never joined", () => {
    const r = selectCompanions({ kept: [text({ source: "TCO.docx", page: 1 }), text({ page: 0 })], pageRows: [cap({ source: "TCO.docx", page: 1 }), cap({ page: 0 })], mode: "captions", budget: 8, paginationFacts: { "TCO.docx": false } });
    assert.deepStrictEqual(r.companions, []);
    assert.strictEqual(r.skipped.singlePage, 1);
    assert.strictEqual(r.skipped.notLocated, 1);
  });

  test("total on junk", () => {
    for (const args of [undefined, {}, { kept: null, pageRows: null }, { kept: [null, 3, "x"], pageRows: [null, 1], mode: "nonsense", budget: NaN }]) {
      const r = selectCompanions(args);
      assert.ok(Array.isArray(r.companions));
    }
    assert.strictEqual(selectCompanions({ kept: [text()], pageRows: [cap()], mode: "nonsense", budget: 8 }).mode, "captions", "an unknown mode is the default");
  });
});

describe("U-COMPANIONS: interleave", () => {
  test("each companion directly after its anchor, carrying the anchor object, kind and reason; kept chunks unchanged", () => {
    const kept = [text({ page: 1, chunkIndex: 0 }), text(), text({ page: 84, chunkIndex: 191 })];
    const sel = selectCompanions({ kept, pageRows: [cap()], mode: "captions", budget: 8 });
    const out = interleave(kept, sel.companions);
    assert.deepStrictEqual(out.map((c) => c.chunkIndex), [0, 78, 204, 191]);
    assert.strictEqual(out[1], kept[1], "kept chunks are the same objects");
    assert.strictEqual(out[2].companion.anchor, kept[1]);
    assert.strictEqual(out[2].companion.kind, "caption");
    assert.match(out[2].companion.reason, /same page/);
    assert.ok(!("companion" in kept[1]));
  });

  test("a junk entry in kept anchors nothing and shifts no index (A15)", () => {
    const kept = [null, text(), "x"];
    const sel = selectCompanions({ kept, pageRows: [cap()], mode: "captions", budget: 8 });
    assert.strictEqual(sel.companions.length, 1);
    assert.strictEqual(sel.companions[0].anchorIndex, 1);
    const out = interleave(kept, sel.companions);
    assert.strictEqual(out[2].companion.anchor, kept[1]);
  });

  test("total: no companions, junk companions", () => {
    assert.deepStrictEqual(interleave([text()], []).length, 1);
    assert.deepStrictEqual(interleave([text()], [null, { chunk: null }, { chunk: cap(), anchorIndex: 9 }]).length, 1, "an anchor index outside the list attaches nowhere");
    assert.deepStrictEqual(interleave(null, null), []);
  });
});
