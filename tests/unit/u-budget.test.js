/**
 * U-BUDGET — T31, the captioner's coverage (multimodal-workshop-design.md
 * D5–D10; F-123): every page is considered unless a VISIBLE budget bounds
 * it, and the pages beyond the budget are counted and NAMED everywhere the
 * figure counts appear.
 *
 * Measured before the ticket (design §0 items 4–5): the bridge renders every
 * PDF page as one "picture" and the parser kept `parsed.pictures.slice(0,
 * 50)` — the first fifty PAGES of a document, whatever they held; the count
 * of the rest reached the in-process trace only. The last 34 pages of the
 * lathe manual and 74 of the washing-machine manual had no caption and
 * nothing said so.
 *
 * The pure module is tested directly; the wiring (the parser, the bridge,
 * the route, the ledger, the views, the drawer) is pinned in source, the
 * U-DESTRUCT way, over comment-stripped code.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const budget = require("../../src/lib/ingestion/caption_budget");
const outcomes = require("../../src/lib/ingestion/outcomes");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) =>
  fs
    .readFileSync(path.join(REPO_ROOT, rel), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const pics = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ id: `fig_${from + i}_0`, page: from + i }));

describe("U-BUDGET: the pure module — selectCaptionTargets, pageRangeLabel, normaliseCaptionPageBudget (design D5, D6)", () => {
  test("the default (0) considers every page: nothing beyond, no range", () => {
    assert.strictEqual(budget.CAPTION_PAGE_BUDGET_UNLIMITED, 0);
    const r = budget.selectCaptionTargets(pics(84), 0);
    assert.strictEqual(r.targets.length, 84);
    assert.deepStrictEqual({ b: r.budget, c: r.considered, n: r.notAttempted, p: r.notAttemptedPages, l: r.notAttemptedPageList }, { b: 0, c: 84, n: 0, p: null, l: [] });
    assert.deepStrictEqual(budget.selectCaptionTargets(pics(84), undefined).notAttempted, 0, "absent is the default");
  });

  test("a budget below the page count keeps the first N in the bridge's order and NAMES the rest as a page range (the F-123 shape: 50 of 84 → pages 51–84)", () => {
    const r = budget.selectCaptionTargets(pics(84), 50);
    assert.strictEqual(r.targets.length, 50);
    assert.strictEqual(r.targets[0].page, 1);
    assert.strictEqual(r.targets[49].page, 50);
    assert.deepStrictEqual({ b: r.budget, c: r.considered, n: r.notAttempted, p: r.notAttemptedPages }, { b: 50, c: 50, n: 34, p: "51–84" });
    assert.strictEqual(r.notAttemptedPageList.length, 34);
    assert.strictEqual(r.notAttemptedPageList[0], 51);
    assert.strictEqual(r.notAttemptedPageList[33], 84);
    const ten = budget.selectCaptionTargets(pics(36), 10);
    assert.deepStrictEqual({ c: ten.considered, n: ten.notAttempted, p: ten.notAttemptedPages }, { c: 10, n: 26, p: "11–36" });
  });

  test("a budget at or above the page count considers every page; a budget of 1 keeps the first page only", () => {
    for (const b of [84, 85, 1000]) {
      const r = budget.selectCaptionTargets(pics(84), b);
      assert.deepStrictEqual({ b: r.budget, c: r.considered, n: r.notAttempted, p: r.notAttemptedPages }, { b, c: 84, n: 0, p: null });
    }
    const one = budget.selectCaptionTargets(pics(3), 1);
    assert.deepStrictEqual({ c: one.considered, n: one.notAttempted, p: one.notAttemptedPages }, { c: 1, n: 2, p: "2–3" });
  });

  test("non-contiguous pages (the docling path's pictures) are named as runs; a picture without a page counts but cannot be named", () => {
    const docling = [{ page: 1 }, { page: 2 }, { page: 3 }, { page: 5 }, { page: 6 }, { page: 9 }, { page: 12 }];
    const r = budget.selectCaptionTargets(docling, 3);
    assert.deepStrictEqual({ c: r.considered, n: r.notAttempted, p: r.notAttemptedPages, l: r.notAttemptedPageList }, { c: 3, n: 4, p: "5–6, 9, 12", l: [5, 6, 9, 12] });
    const nameless = budget.selectCaptionTargets([{ page: 1 }, { id: "x" }, { page: "3" }], 1);
    assert.deepStrictEqual({ c: nameless.considered, n: nameless.notAttempted, p: nameless.notAttemptedPages, l: nameless.notAttemptedPageList }, { c: 1, n: 2, p: null, l: [] }, "the count is the truth; the label names what it can");
  });

  test("an unreadable budget is the default: a negative, a float, a string, null — and the same rule the settings loader and the fingerprint apply", () => {
    for (const junk of [-1, 2.5, "50", "all", null, NaN, Infinity, true, {}]) {
      assert.strictEqual(budget.normaliseCaptionPageBudget(junk), 0, `${JSON.stringify(junk)} → no limit`);
      assert.strictEqual(budget.selectCaptionTargets(pics(5), junk).notAttempted, 0);
    }
    assert.strictEqual(budget.normaliseCaptionPageBudget(7), 7);
    assert.strictEqual(budget.normaliseCaptionPageBudget(0), 0);
    const { loadRagSettings } = require("../../src/lib/rag/config");
    assert.strictEqual(loadRagSettings({ captionPageBudget: 2.5 }).captionPageBudget, 0);
    assert.strictEqual(loadRagSettings({ captionPageBudget: 7 }).captionPageBudget, 7);
  });

  test("selectCaptionTargets never mutates its input and tolerates a non-array", () => {
    const input = pics(4);
    const copy = JSON.stringify(input);
    budget.selectCaptionTargets(input, 2);
    assert.strictEqual(JSON.stringify(input), copy);
    assert.deepStrictEqual(budget.selectCaptionTargets(null, 5), { targets: [], budget: 5, considered: 0, notAttempted: 0, notAttemptedPages: null, notAttemptedPageList: [] });
  });

  test("pageRangeLabel collapses runs, sorts, de-duplicates, and ignores what is not a page", () => {
    assert.strictEqual(budget.pageRangeLabel([51, 52, 53]), "51–53");
    assert.strictEqual(budget.pageRangeLabel([12, 3, 9, 8, 7, 7]), "3, 7–9, 12");
    assert.strictEqual(budget.pageRangeLabel([4]), "4");
    assert.strictEqual(budget.pageRangeLabel([2, 4, 6]), "2, 4, 6");
    assert.strictEqual(budget.pageRangeLabel([]), null);
    assert.strictEqual(budget.pageRangeLabel([0, -1, "2", null, 2.5]), null);
    assert.strictEqual(budget.pageRangeLabel("nope"), null);
  });
});

describe("U-BUDGET: the wiring — the parser, the bridge, the route, the views, the drawer, the span (design D5–D9; source pins)", () => {
  test("the parser has no index cap: the targets come from selectCaptionTargets with the blob's captionPageBudget; the verdict is declared at the block's scope (A5's rule) and reaches the trace", () => {
    const src = read("src/lib/ingestion/parser.js");
    assert.ok(!/slice\(0,\s*50\)/.test(src), "the slice(0, 50) is gone");
    assert.ok(!/pictures\.slice\(0,\s*\d+\)/.test(src), "no other literal cap on the pictures");
    assert.match(src, /const \{ selectCaptionTargets \} = require\("\.\/caption_budget"\);\s*const plan = selectCaptionTargets\(parsed\.pictures, this\.config\?\.captionPageBudget\);\s*const targetPics = plan\.targets;\s*vlmCounts\.notAttempted = plan\.notAttempted;\s*captionBudget = plan\.budget;\s*figuresConsidered = plan\.considered;\s*notAttemptedPages = plan\.notAttemptedPages;/);
    const declared = src.indexOf("let captionBudget = null;");
    const block = src.indexOf("if (captionFigures && Array.isArray(parsed.pictures) && parsed.pictures.length > 0) {");
    const trace = src.indexOf("picturesCaptured: (parsed.pictures || []).length,");
    assert.ok(declared > -1 && block > -1 && trace > -1);
    assert.ok(declared < block, "declared BEFORE the captioning block, where the trace after it can read it (A5)");
    assert.strictEqual((src.match(/let captionBudget = null;/g) || []).length, 1, "declared once");
    assert.match(src, /let figuresConsidered = null;\s*let notAttemptedPages = null;/);
    const traceBlock = src.slice(trace, src.indexOf("markdownSample: (doclingPages[0]"));
    for (const k of ["vlmNotAttempted: vlmCounts.notAttempted,", "figuresConsidered,", "captionBudget,", "notAttemptedPages,"]) assert.ok(traceBlock.includes(k), `the trace records ${k}`);
    assert.match(src, /Processing \$\{targetPics\.length\} of \$\{parsed\.pictures\.length\} figure crops/, "the log says how many of how many");
  });

  test("the bridge's docling path has no cap of its own any more (the 180 px skip stays); the pypdfium2 path still renders every page", () => {
    const bridge = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "ingestion", "docling_bridge.py"), "utf-8");
    assert.ok(!/len\(selected_items\) >= 50/.test(bridge), "the `>= 50: break` is gone");
    assert.ok(!/up to 50/.test(bridge), "no prose promises a fifty either");
    assert.match(bridge, /if img\.width < 180 or img\.height < 180:\s*continue/, "tiny docling pictures are still skipped");
    assert.match(bridge, /for page_idx, page in enumerate\(pdf\):[\s\S]*?img = page\.render\(scale=render_scale\)\.to_pil\(\)/, "every page rendered on the production path");
  });

  test("the file result carries the count, the budget and the pages; the terminal counts carry the count; the partial rule ignores the budget (D5)", () => {
    const route = read("src/app/api/ingest/route.js");
    assert.match(route, /fr\.counts\.figuresConsidered = fig\("figuresConsidered"\);/);
    assert.match(route, /fr\.counts\.figuresNotAttempted = fig\("vlmNotAttempted"\);/);
    assert.match(route, /fr\.captionBudget = Number\.isInteger\(trace\?\.captionBudget\) \? trace\.captionBudget : null;/);
    assert.match(route, /fr\.notAttemptedPages = typeof trace\?\.notAttemptedPages === "string" \? trace\.notAttemptedPages : null;/);
    // T33 (design D7): the terminal counts gained the detail passes' seven counts after the budget's two — the same block.
    assert.match(route, /figuresConsidered: fr\.counts\.figuresConsidered,\s*figuresNotAttempted: fr\.counts\.figuresNotAttempted,\s*(?:detail\w+: fr\.counts\.detail\w+,\s*)*(?:captionSubstitutions: fr\.counts\.captionSubstitutions,\s*)?(?:\/\/[^\n]*\s*)?(?:\.\.\.Object\.fromEntries\(CHAIN_COUNT_KEYS\.map\(\(k\) => \[k, fr\.counts\[k\]\]\)\),\s*)?(?:\/\/[^\n]*\s*)?(?:ocr\w+: fr\.counts\.ocr\w+,\s*)*\};/, "the terminal counts (T33's seven detail counts, T47's caption substitutions, T46's chain counts, then T35's five OCR counts)");
    assert.match(route, /const captionLoss = \(fr\.counts\.figuresTimedOut \|\| 0\) \+ \(fr\.counts\.figuresFailed \|\| 0\);/, "not attempted is not a loss");
    assert.ok(!/figuresNotAttempted \|\| 0\) \+/.test(route) && !/captionLoss[^\n]*figuresNotAttempted/.test(route), "the budget never makes a file partial");
    const ledger = read("src/lib/rag/ledger.js");
    assert.match(ledger, /vlmNotAttempted: Number\.isFinite\(e\.counts\?\.figuresNotAttempted\) \? e\.counts\.figuresNotAttempted : null,/);
    assert.match(ledger, /captionBudget: Number\.isInteger\(e\.captionBudget\) \? e\.captionBudget : null,/);
    assert.match(ledger, /notAttemptedPages: typeof e\.notAttemptedPages === "string" \? e\.notAttemptedPages : null,/);
  });

  test("both ingest views render ONE suffix (figureSuffix) — the old inline expression is gone from both", () => {
    const page = read("src/app/page.js");
    const drawer = read("src/components/StandardsDrawer.jsx");
    for (const [name, src] of [["page.js", page], ["StandardsDrawer.jsx", drawer]]) {
      assert.match(src, /\{figureSuffix\(f\)\}/, `${name} calls the helper`);
      assert.match(src, /import \{ figureSuffix \} from "@\/lib\/ingestion\/outcomes";/, `${name} imports it`);
      assert.ok(!/figuresFromMemo\} from memo/.test(src), `${name} no longer carries the inline wording`);
      assert.ok(!/figures\$\{\[/.test(src), `${name} no longer builds the suffix inline`);
    }
  });

  test("figureSuffix: the T24 / T29 wording unchanged, the T31 part added only when pages lie beyond the budget", () => {
    const f = (counts, over = {}) => ({ status: "indexed", counts, ...over });
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 36, figuresCaptioned: 30, figuresTimedOut: 2, figuresFailed: 0 })), " · 30/36 figures (2 timed out, 0 failed)");
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 7, figuresCaptioned: 7, figuresFromMemo: 7, vlmCalls: 0 })), " · 7/7 figures (7 from memo)");
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 7, figuresCaptioned: 5 })), " · 5/7 figures");
    assert.strictEqual(
      outcomes.figureSuffix(f({ figuresCaptured: 84, figuresCaptioned: 36, figuresTimedOut: 0, figuresFailed: 0, figuresFromMemo: 36, vlmCalls: 14, figuresConsidered: 50, figuresNotAttempted: 34 }, { captionBudget: 50, notAttemptedPages: "51–84" })),
      " · 36/84 figures (36 from memo, 34 beyond the budget (pages 51–84))"
    );
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 84, figuresCaptioned: 36, figuresNotAttempted: 34 })), " · 36/84 figures (34 beyond the budget)", "no range on the record: the count alone");
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 36, figuresCaptioned: 28, figuresNotAttempted: 0 }, { captionBudget: 0, notAttemptedPages: null })), " · 28/36 figures", "within the budget: nothing new");
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 5, figuresCaptioned: 0, figuresFailed: 5 }, { status: "partial" })), " · 0/5 figures (0 timed out, 5 failed)");
    // T32 (design D9): the decorative and text-only verdicts named when > 0, before the memo's share — "64/84 figures" says what the other twenty were.
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 84, figuresCaptioned: 64, figuresDecorative: 17, figuresTextOnly: 12, figuresFromMemo: 84, vlmCalls: 0 })), " · 64/84 figures (17 decorative, 12 text-only, 84 from memo)");
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 3, figuresCaptioned: 0, figuresDecorative: 0, figuresTextOnly: 3, figuresFromMemo: 0, vlmCalls: 3 })), " · 0/3 figures (3 text-only)");
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 7, figuresCaptioned: 7, figuresDecorative: 0, figuresTextOnly: 0, figuresFromMemo: 7 })), " · 7/7 figures (7 from memo)", "zero verdicts: nothing named");
    assert.strictEqual(outcomes.figureSuffix(f({ figuresCaptured: 36, figuresCaptioned: 30, figuresDecorative: 6, figuresTimedOut: 0, figuresFailed: 0, figuresFromMemo: 30, vlmCalls: 6, figuresConsidered: 10, figuresNotAttempted: 26 }, { captionBudget: 10, notAttemptedPages: "11–36" })), " · 30/36 figures (6 decorative, 30 from memo, 26 beyond the budget (pages 11–36))", "the T32 part sits between the failures and the memo's share");
    assert.strictEqual(outcomes.figureSuffix({ status: "skipped", counts: { figuresCaptured: 3 } }), "");
    assert.strictEqual(outcomes.figureSuffix({ status: "indexed", counts: { figuresCaptured: null } }), "");
    assert.strictEqual(outcomes.figureSuffix(null), "");
  });

  test("the drawer: a number input for captionPageBudget in the Documents card, beside the Caption Figures toggle", () => {
    const dr = fs.readFileSync(path.join(REPO_ROOT, "src", "components", "AdminDrawer.jsx"), "utf-8");
    const toggle = dr.indexOf('updateRagSetting("captionFigures"');
    const input = dr.indexOf('updateRagSetting("captionPageBudget"');
    assert.ok(toggle > -1 && input > -1 && input > toggle && input - toggle < 3000, "the budget control follows the toggle");
    assert.match(dr, /type="number"\s*min="0"\s*step="1"\s*value=\{tempRagSettings\.captionPageBudget \?\? 0\}/);
    assert.match(dr, /0 = every page \(the default\)/, "the tooltip says what 0 means");
    assert.match(dr, /never dropped silently/);
  });

  test("the VLM span names the shortfall (engines.js): the total in the outcomes, the per-document sentence, the details", () => {
    const eng = read("src/lib/ingestion/engines.js");
    assert.match(eng, /vlmNotAttempted: sum\("vlmNotAttempted"\),/);
    assert.match(eng, /vlmTextOnly: sum\("vlmTextOnly"\),/, "T32: the text-only total");
    assert.match(eng, /budgetShortfalls: entries\s*\.filter\(\(e\) => Number\.isFinite\(e\?\.vlmNotAttempted\) && e\.vlmNotAttempted > 0\)/);
    assert.match(eng, /beyond the page budget/);
    assert.match(eng, /Pages beyond the caption budget:/);
    const { buildVlmSpanModel } = require("../../src/lib/ingestion/engines");
    const span = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 20, vlmCaptionsGenerated: 8, vlmDecorative: 2, vlmTimedOut: 0, vlmFailed: 0, vlmNotAttempted: 10, captionBudget: 10, notAttemptedPages: "11–20", captioning: "on", vlmModel: "m" }]);
    assert.match(span.description, /10 beyond the page budget/);
    assert.match(span.description, /Pages beyond the caption budget: a\.pdf 11–20 \(budget 10\)\.$/);
  });
});
