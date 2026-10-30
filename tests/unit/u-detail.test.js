/**
 * U-DETAIL — the tiled detail passes' pure module (ticket T33; design
 * `inputs/rag-audit/t33-design.md` D1–D5, §4). Offline, no pod:
 *   - THE TRIGGER (D1, option B + E — the owner's decision, §12c) over the
 *     2026-09-16 caption census (`t33-artifacts/census/`: every caption memo
 *     record under the chat key, 445 records, 228 captioned): which pages
 *     fire under `auto`, for which reason, which do not; the Site Plan's map
 *     page (TYPE `mixed`, "colour-coded … legend" in SUBJECTS) fires as a
 *     keyed-index; SaxonFields' floor plan (the only `map or plan`) fires;
 *     `all` fires on every captioned page; `off` on none; the false
 *     positives the census showed (an Allen key, a Wi-Fi symbol, "Key
 *     Statistics") do NOT fire;
 *   - THE GEOMETRY (D2) against the design probe's recorded crops
 *     (`t33-artifacts/probes/records/`: the Site Plan's page at 595.28 ×
 *     841.89 pt, a 2×2 grid, a 10 % overlap);
 *   - THE MERGE (D4) on the probe's RECORDED replies → the recorded index
 *     (131 labels = every plot 172–330), the Denby exactly {302, 304, 313},
 *     the 7 overlap conflicts DISCLOSED (never resolved by a coin), the
 *     counts from the unambiguous labels = the record's counts minus the
 *     conflicted labels;
 *   - THE CHUNK TEXT (D5) and the split rule;
 *   - the mode vocabulary the settings table and the fingerprint share.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const d = require("../../src/lib/ingestion/detail_pass.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ART = path.join(REPO_ROOT, "tests", "eval", "baselines", "t33-artifacts");
// T58 (design D1 a, D2 a; F-219): the design probe's COUNTS arms, re-derived from a chunk's own INDEX {EM} coded = measured.
const { armText } = require(path.join(REPO_ROOT, "tests", "eval", "baselines", "t58-artifacts", "probes", "counts58.js"));
// T59 (design D1 a, D2 a; F-222, F-218): the design probe's arms — B: the phantom range subsumed, a row naming its ranges.
const { armText: armText59 } = require(path.join(REPO_ROOT, "tests", "eval", "baselines", "t59-artifacts", "probes", "blocks59.js"));
const CENSUS = JSON.parse(fs.readFileSync(path.join(ART, "census", "caption_census_2026-09-16.json"), "utf8"));
const PROBE_1 = JSON.parse(fs.readFileSync(path.join(ART, "probes", "records", "detail-p1-1789545775.json"), "utf8"));
const PROBE_2 = JSON.parse(fs.readFileSync(path.join(ART, "probes", "records", "detail-p1-1789545985.json"), "utf8"));
const captioned = CENSUS.records.filter((r) => r.outcome === "captioned");
const byFile = (rows) => rows.reduce((a, r) => { const k = r.hint.fileName; a[k] = (a[k] || 0) + 1; return a; }, {});
const plansAuto = captioned.map((r) => ({ r, plan: d.detailPlanFor({ caption: r.caption, mode: "auto" }) }));
const fired = plansAuto.filter((p) => p.plan);

describe("U-DETAIL: the constants and the mode vocabulary (D2, D6)", () => {
  test("the modes are auto | all | off with auto the default; junk normalises to the default; the geometry constants are the probe's", () => {
    assert.deepStrictEqual([...d.DETAIL_PASS_MODES], ["auto", "all", "off"]);
    assert.strictEqual(d.DETAIL_PASS_DEFAULT, "auto");
    for (const [v, want] of [["auto", "auto"], ["ALL", "all"], [" off ", "off"], ["", "auto"], [null, "auto"], [undefined, "auto"], [42, "auto"], ["sometimes", "auto"], [true, "auto"]]) assert.strictEqual(d.normaliseDetailMode(v), want, JSON.stringify(v));
    assert.deepStrictEqual([...d.DETAIL_GRID], [2, 2]);
    assert.strictEqual(d.DETAIL_OVERLAP, 0.1);
    assert.strictEqual(d.DETAIL_RENDER_SCALE, 3.5);
    assert.strictEqual(d.DETAIL_MAX_CHARS, 12000);
    assert.deepStrictEqual([...d.DETAIL_KINDS], ["keyed-index", "transcribe"]);
    assert.deepStrictEqual([...d.DETAIL_REASONS], ["map or plan", "legend", "illegible", "overflow", "all"]);
    // Shared by reference: config.js's table and ids.js's fingerprint read the SAME list (one vocabulary).
    const cfg = require("../../src/lib/rag/config.js");
    const ids = require("../../src/lib/rag/ids.js");
    assert.strictEqual(cfg.DETAIL_PASS_MODES, d.DETAIL_PASS_MODES);
    assert.strictEqual(cfg.RAG_SETTINGS_DEFAULTS.detailPasses, d.DETAIL_PASS_DEFAULT);
    assert.strictEqual(ids.FINGERPRINT_DEFAULTS.detailPasses, d.DETAIL_PASS_DEFAULT);
  });

  test("the module is pure and dependency-free (config.js is bundled into the page): no require, no fs, no network", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "ingestion", "detail_pass.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\brequire\(/.test(src), "no require");
    assert.ok(!/\bfetch\(|\bfs\.|process\./.test(src), "no I/O");
    assert.match(src, /module\.exports = \{/);
  });
});

describe("U-DETAIL: the trigger (D1, option B + E) over the 2026-09-16 caption census", () => {
  test("the census is the memo's chat-key records: 445 records, 228 captioned, 209 text-only, 8 decorative; the Site Plan's map page and SaxonFields' floor plan are in it", () => {
    assert.strictEqual(CENSUS.kind, "t33-caption-census");
    assert.strictEqual(CENSUS.model, "qwen3.8:27b");
    assert.strictEqual(CENSUS.records.length, 445);
    assert.deepStrictEqual(CENSUS.byOutcome, { textOnly: 209, captioned: 228, decorative: 8 });
    assert.strictEqual(captioned.length, 228);
    assert.ok(captioned.some((r) => r.hint.fileName === "Barratt_Homes_SitePlan.pdf" && r.hint.page === 1));
    assert.ok(captioned.some((r) => r.hint.fileName === "Barratt_Homes-SaxonFields.pdf" && r.hint.page === 2));
    assert.ok(CENSUS.records.every((r) => r.outcome !== "captioned" || (typeof r.caption === "string" && r.caption.length > 0)), "every captioned record carries its caption");
  });

  test("the census's TYPE census reproduces t33-design §0a: mixed 43, map or plan 1, table 49, schematic 39, assembly step 66, photo 12, screenshot 13, dimensioned drawing 5; 14 pages carry [illegible] (18 marks); no caption overflowed (the longest transcription 62 lines)", () => {
    const types = captioned.reduce((a, r) => { const t = (d.parseCaptionSections(r.caption).type || "").toLowerCase().replace(/[*_`]/g, "").trim(); a[t] = (a[t] || 0) + 1; return a; }, {});
    assert.deepStrictEqual(types, { mixed: 43, "map or plan": 1, photo: 12, table: 49, schematic: 39, "dimensioned drawing": 5, screenshot: 13, "assembly step": 66 });
    const illegible = captioned.filter((r) => d.ILLEGIBLE_MARK.test(r.caption));
    assert.strictEqual(illegible.length, 14);
    assert.strictEqual(illegible.reduce((a, r) => a + (r.caption.match(/\[illegible\]/gi) || []).length, 0), 18);
    assert.deepStrictEqual(byFile(illegible), { "Fervi_Lathe_TechnicalSupportManual.pdf": 8, "Ikea-wardrobe_build.pdf": 1, "Miele_washing_machine_manual.pdf": 4, "PCI-DSS-v4_0_1_June2024.pdf": 1 });
    assert.strictEqual(captioned.filter((r) => d.OVERFLOW_MARK.test(r.caption)).length, 0, "the third admission is dormant on this corpus");
    assert.strictEqual(Math.max(...captioned.map((r) => d.parseCaptionSections(r.caption).transcription.split("\n").filter((l) => l.trim()).length)), 62);
  });

  test("under auto the closer look fires on 46 of the 228 captioned pages — 31 by a legend / colour-coding / hatching phrase, 1 by TYPE map or plan, 14 by [illegible] — and on none of the 217 verdict-only records", () => {
    assert.strictEqual(fired.length, 46);
    const reasons = fired.reduce((a, p) => { a[p.plan.reason] = (a[p.plan.reason] || 0) + 1; return a; }, {});
    assert.deepStrictEqual(reasons, { legend: 31, "map or plan": 1, illegible: 14 });
    const kinds = fired.reduce((a, p) => { a[p.plan.kind] = (a[p.plan.kind] || 0) + 1; return a; }, {});
    assert.deepStrictEqual(kinds, { "keyed-index": 32, transcribe: 14 });
    assert.deepStrictEqual(byFile(fired.map((p) => p.r)), {
      "Barratt_Homes_SitePlan.pdf": 7, "Barratt_Homes-SaxonFields.pdf": 1, "Fervi_Lathe_TechnicalSupportManual.pdf": 11, "Ikea-wardrobe_build.pdf": 1,
      "Miele_washing_machine_manual.pdf": 13, "PCI-DSS-v4_0_1_June2024.pdf": 1, "SSX125_Manual.pdf": 12,
    });
    // The T08 set (the identity leg's four documents) and the workshop six (arm D) — the counts the chain expects.
    assert.strictEqual(fired.filter((p) => /SitePlan|SaxonFields|GraemeHick|SSX125/.test(p.r.hint.fileName)).length, 20, "the identity leg: 110 + 20 detail chunks = 130");
    assert.strictEqual(fired.filter((p) => /SitePlan|SaxonFields|Fervi|SSX125|Ikea|Miele/.test(p.r.hint.fileName)).length, 45, "arm D: 45 pages tiled once");
    for (const r of CENSUS.records.filter((x) => x.outcome !== "captioned")) assert.strictEqual(d.detailPlanFor({ caption: r.caption, mode: "auto" }), null, `${r.outcome} records carry no caption and never fire`);
    for (const p of fired) {
      assert.ok(d.DETAIL_KINDS.includes(p.plan.kind));
      assert.ok(d.DETAIL_REASONS.includes(p.plan.reason));
      assert.strictEqual(p.plan.reasons[0], p.plan.reason);
      assert.strictEqual(p.plan.mode, "auto");
    }
  });

  test("the Site Plan's map page (TYPE mixed — F-141) fires as a keyed-index by the legend named in its SUBJECTS; every one of its seven pages fires (key/legend on the floor plans); SaxonFields' floor plan fires by TYPE map or plan AND its legend", () => {
    const sp = fired.filter((p) => p.r.hint.fileName === "Barratt_Homes_SitePlan.pdf").sort((a, b) => a.r.hint.page - b.r.hint.page);
    assert.deepStrictEqual(sp.map((p) => p.r.hint.page), [1, 2, 3, 4, 5, 6, 7]);
    const p1 = sp[0].plan;
    assert.deepStrictEqual({ kind: p1.kind, reason: p1.reason, reasons: p1.reasons, matched: p1.matched }, { kind: "keyed-index", reason: "legend", reasons: ["legend"], matched: "legend" });
    const p1Caption = sp[0].r.caption;
    assert.strictEqual(d.parseCaptionSections(p1Caption).type, "mixed", "the map page is `mixed`, not `map or plan` (t33-design §0a; F-141): a trigger on TYPE alone would miss it");
    assert.match(d.parseCaptionSections(p1Caption).subjects, /colour-coded house-type legend/);
    assert.ok(sp.every((p) => p.plan.kind === "keyed-index" && p.plan.reason === "legend"));
    const sx = fired.find((p) => p.r.hint.fileName === "Barratt_Homes-SaxonFields.pdf");
    assert.strictEqual(sx.r.hint.page, 2);
    assert.deepStrictEqual({ kind: sx.plan.kind, reason: sx.plan.reason, reasons: sx.plan.reasons }, { kind: "keyed-index", reason: "map or plan", reasons: ["map or plan", "legend"] });
    assert.strictEqual(d.typeLineIsMapOrPlan(d.parseCaptionSections(sx.r.caption).type), true);
    assert.strictEqual(d.typeLineIsMapOrPlan("mixed (map or plan + photo)"), false, "the parser's leading-value rule: a composite page is mixed");
    assert.strictEqual(d.typeLineIsMapOrPlan("Map or Plan"), true);
    assert.strictEqual(d.typeLineIsMapOrPlan(null), false);
  });

  test("the admissions, not a word list about document kinds: a bare key (an Allen key, a ZERO key, a safety key, Key Statistics, Key Management), an icon or a lone symbol does NOT fire; a legend, colour-coding, hatching and a symbol key named with a verb DO", () => {
    const not = [
      { file: "GraemeHick.pdf", page: 2 }, // "Key Statistics"
      { file: "Fervi_Lathe_TechnicalSupportManual.pdf", page: 16 }, // "main switch with safety key"
      { file: "Fervi_Lathe_TechnicalSupportManual.pdf", page: 42 }, // "A ZERO key is shown"
      { file: "PCI-DSS-v4_0_1_June2024.pdf", page: 29 }, // "Key Management Requirements"
      { file: "Miele_washing_machine_manual.pdf", page: 16 }, // a Wi-Fi symbol, a home icon on a screenshot
      { file: "Ikea-wardrobe_build.pdf", page: 9 }, // "hex key wrench"
    ];
    for (const n of not) {
      const r = captioned.find((x) => x.hint.fileName === n.file && x.hint.page === n.page);
      assert.ok(r, `${n.file} p${n.page} is in the census`);
      assert.strictEqual(d.detailPlanFor({ caption: r.caption, mode: "auto" }), null, `${n.file} p${n.page} must not fire`);
    }
    const yes = [
      { file: "Fervi_Lathe_TechnicalSupportManual.pdf", page: 55, reason: "legend", matched: /hatching/i }, // "uses hatching to distinguish"
      { file: "Fervi_Lathe_TechnicalSupportManual.pdf", page: 20, reason: "legend", matched: /legend/i },
      { file: "SSX125_Manual.pdf", page: 26, reason: "legend", matched: /legend/i }, // "screw-type legend"
      { file: "Miele_washing_machine_manual.pdf", page: 88, reason: "legend", matched: /legend/i },
      { file: "Fervi_Lathe_TechnicalSupportManual.pdf", page: 14, reason: "illegible", matched: null }, // a photo with "a small warning symbol" — fires by [illegible] only
    ];
    for (const y of yes) {
      const r = captioned.find((x) => x.hint.fileName === y.file && x.hint.page === y.page);
      assert.ok(r, `${y.file} p${y.page} is in the census`);
      const plan = d.detailPlanFor({ caption: r.caption, mode: "auto" });
      assert.ok(plan, `${y.file} p${y.page} fires`);
      assert.strictEqual(plan.reason, y.reason, `${y.file} p${y.page}`);
      if (y.matched) assert.match(plan.matched, y.matched); else assert.strictEqual(plan.matched, null);
    }
    // The families, on synthetic headers (the phrase in the header or the DESCRIPTION, never the TRANSCRIPTION).
    const cap = (subjects, description = "", transcription = "") => `TITLE: t\nTYPE: schematic\nSUBJECTS: ${subjects}\n\nTRANSCRIPTION:\n${transcription}\n\nDESCRIPTION:\n${description}`;
    assert.strictEqual(d.detailPlanFor({ caption: cap("wiring, colour-coded conductors") }).reason, "legend");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "The hatched zones mark the load-bearing walls.") }).reason, "legend");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "The symbols denote valve types.") }).reason, "legend");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "A symbol key at the foot.") }).reason, "legend");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "", "LEGEND\nred | fire exit") }), null, "a legend printed inside the TRANSCRIPTION is not the captioner's admission");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "", "A | [illegible]") }).kind, "transcribe");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "", "row 1\n[more rows not transcribed: about 40]") }).reason, "overflow");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "", "row 1\n[more not transcribed: about 40 lines]") }).reason, "overflow", "the no-text-layer prompt's marker");
    // T35 (t35-design D8): on a page OCR read, the transcribe plan is not taken; the keyed-index plan still is; `all` is unaffected.
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "", "A | [illegible]"), ocr: true }), null, "illegible on an OCR'd page: OCR read the page at its own resolution");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "", "row 1\n[more not transcribed: about 40 lines]"), ocr: true }), null, "an overflow on an OCR'd page: not taken");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "The symbols denote valve types."), ocr: true }).kind, "keyed-index", "a legend on an OCR'd page: the mapping OCR cannot make");
    assert.strictEqual(d.detailPlanFor({ caption: "TITLE: t\nTYPE: map or plan\nSUBJECTS: a plan\n\nTRANSCRIPTION:\nx\n\nDESCRIPTION:\ny", ocr: true }).kind, "keyed-index", "a map or plan on an OCR'd page: still keyed");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "", "A | [illegible]"), ocr: true, mode: "all" }).kind, "keyed-index", "all takes every page as a keyed plan, OCR or not");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing", "", "A | [illegible]"), ocr: false }).kind, "transcribe", "a page with a text layer: unchanged");
    const both = d.detailPlanFor({ caption: cap("a legend", "", "x | [illegible]") });
    assert.deepStrictEqual({ kind: both.kind, reasons: both.reasons }, { kind: "keyed-index", reasons: ["legend", "illegible"] }, "a legend AND [illegible]: keyed-index (the KEY pass's NONE downgrades it)");
    assert.strictEqual(d.detailPlanFor({ caption: cap("a drawing") }), null, "no admission: the caption claimed the page whole");
    assert.strictEqual(d.detailPlanFor({}), null);
    assert.strictEqual(d.detailPlanFor({ caption: "" }), null);
  });

  test("the caller's normalised visualType wins over the caption's TYPE line; parsed fields override the caption's sections", () => {
    assert.strictEqual(d.detailPlanFor({ caption: "TITLE: x\nTYPE: mixed\nSUBJECTS: a\n", visualType: "map or plan" }).reason, "map or plan");
    assert.strictEqual(d.detailPlanFor({ caption: "TITLE: x\nTYPE: map or plan\nSUBJECTS: a\n", visualType: "mixed" }), null, "the parser's null / other verdict is trusted");
    assert.strictEqual(d.detailPlanFor({ visualType: "photo", title: "A", subjects: "colour-coded zones", description: "" }).kind, "keyed-index");
    assert.strictEqual(d.detailPlanFor({ visualType: "photo", title: "A", subjects: "a", description: "", transcription: "[illegible]" }).kind, "transcribe");
  });

  test("all: every captioned page gets a keyed-index plan (its admission as the reason, else `all`); off: none, whatever the caption", () => {
    const all = captioned.map((r) => d.detailPlanFor({ caption: r.caption, mode: "all" }));
    assert.strictEqual(all.filter(Boolean).length, 228);
    assert.ok(all.every((p) => p.kind === "keyed-index" && p.mode === "all"));
    assert.strictEqual(all.filter((p) => p.reason === "all").length, 228 - 46, "the pages that would not fire under auto say `all`");
    assert.strictEqual(all.filter((p) => p.reason !== "all").length, 46);
    assert.strictEqual(captioned.filter((r) => d.detailPlanFor({ caption: r.caption, mode: "off" })).length, 0);
    assert.strictEqual(d.detailPlanFor({ caption: captioned[0].caption, mode: "OFF" }), null, "the mode is normalised");
  });
});

describe("U-DETAIL: the tile geometry (D2) against the design probe's recorded crops", () => {
  test("the Site Plan's page (595.28 × 841.89 pt), a 2×2 grid, a 10 % overlap → the probe's four crops to 0.05 pt; the tiles cover the page and overlap by 20 % of it", () => {
    const tiles = d.tilePlan(PROBE_1.pagePt);
    assert.strictEqual(tiles.length, 4);
    assert.deepStrictEqual(tiles.map((t) => t.tile), PROBE_1.tiles.map((t) => t.tile));
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 4; k++) assert.ok(Math.abs(tiles[i].cropPt[k] - PROBE_1.tiles[i].cropPt[k]) < 0.05, `${tiles[i].tile} crop[${k}] ${tiles[i].cropPt[k]} vs ${PROBE_1.tiles[i].cropPt[k]}`);
    }
    const [w, h] = PROBE_1.pagePt;
    const r0c0 = tiles[0];
    assert.deepStrictEqual({ x0: r0c0.x0, y0: r0c0.y0 }, { x0: 0, y0: 0 });
    assert.ok(Math.abs(r0c0.x1 - (w / 2 + 0.1 * w)) < 1e-9 && Math.abs(r0c0.y1 - (h / 2 + 0.1 * h)) < 1e-9, "the inner edges are widened by the overlap");
    assert.ok(Math.abs(tiles[3].x1 - w) < 1e-9 && Math.abs(tiles[3].y1 - h) < 1e-9, "the outer edges are the page's");
    assert.ok(Math.abs(tiles[0].x1 - tiles[1].x0 - 0.2 * w) < 1e-9, "two horizontal neighbours share 20 % of the width");
    // At scale 3.5 the probe's tiles measured 1250 × 1768 px.
    assert.strictEqual(Math.round((r0c0.x1 - r0c0.x0) * 3.5), 1250);
    assert.strictEqual(Math.round((r0c0.y1 - r0c0.y0) * 3.5), 1768);
    assert.deepStrictEqual(PROBE_1.tiles.map((t) => t.px), [[1250, 1768], [1250, 1768], [1250, 1768], [1250, 1768]]);
  });

  test("another grid, no overlap, a pixel-sized page; an unusable input is refused", () => {
    const t = d.tilePlan([1000, 500], { grid: [1, 2], overlap: 0 });
    assert.deepStrictEqual(t.map((x) => [x.tile, x.x0, x.y0, x.x1, x.y1]), [["r0c0", 0, 0, 500, 500], ["r0c1", 500, 0, 1000, 500]]);
    assert.deepStrictEqual(t[1].cropPt, [500, 0, 0, 0]);
    assert.throws(() => d.tilePlan([0, 10]), /positive page size/);
    assert.throws(() => d.tilePlan(null), /positive page size/);
    assert.throws(() => d.tilePlan([10, 10], { grid: [0, 2] }), /grid must be/);
  });

  test("the bridge's Python arithmetic is the same function (source pin): tile_boxes mirrors tilePlan line for line", () => {
    const py = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "ingestion", "docling_bridge.py"), "utf8");
    assert.match(py, /def tile_boxes\(width, height, rows, cols, overlap\):/);
    assert.match(py, /x0 = max\(0\.0, c \* width \/ cols - ovx\); x1 = min\(width, \(c \+ 1\) \* width \/ cols \+ ovx\)/);
    assert.match(py, /y0 = max\(0\.0, r \* height \/ rows - ovy\); y1 = min\(height, \(r \+ 1\) \* height \/ rows \+ ovy\)/);
    assert.match(py, /"crop": \(x0, height - y1, width - x1, y0\)/, "pypdfium2's crop = (left, bottom, right, top) amounts, PDF y upward");
    assert.match(py, /page\.render\(scale=scale, crop=t\["crop"\]\)\.to_pil\(\)/, "a tile is RENDERED from the PDF, never cut from the page PNG (D2, F-125)");
    assert.match(py, /f"detail_\{page_no\}_whole\.png"/);
    assert.match(py, /f"detail_\{page_no\}_\{t\['tile'\]\}\.png"/, "new names beside fig_<page>_0.png — nothing overwritten, every caption key stands");
    assert.match(py, /if "--tiles" in argv:/, "its own branch: every other path byte-identical");
    assert.match(py, /shutil\.copyfile\(src, whole_path\)/, "a docling picture is copied whole and cut with PIL");
  });
});

describe("U-DETAIL: the merge (D4) on the probe's recorded replies", () => {
  const key = d.parseKey(PROBE_1.stage1.response);
  const tiles = PROBE_1.stage2.map((s) => ({ tile: s.label.replace("stage2-", ""), response: s.response }));
  const merged = d.mergeTiles(tiles, { key });

  test("the two probe runs are byte-identical (the key, every tile, the index) — the fixture is stable", () => {
    assert.strictEqual(PROBE_1.stage1.response, PROBE_2.stage1.response);
    assert.deepStrictEqual(PROBE_1.stage2.map((s) => s.response), PROBE_2.stage2.map((s) => s.response));
    assert.deepStrictEqual(PROBE_1.index, PROBE_2.index);
    assert.deepStrictEqual({ grid: PROBE_1.grid, overlap: PROBE_1.overlap, scale: PROBE_1.scale, model: PROBE_1.model }, { grid: [2, 2], overlap: 0.1, scale: 3.5, model: "qwen3.8:27b" });
  });

  test("the KEY reply parses to the legend's 18 entries with their colours — the Denby is dark red", () => {
    assert.strictEqual(key.length, 18);
    assert.deepStrictEqual(key[2], { attribute: "dark red", name: "The Denby 3 bedroom home" });
    assert.deepStrictEqual(key[8], { attribute: "yellow", name: "The Chester 4 bedroom home" });
    assert.deepStrictEqual(key[17], { attribute: "symbol BCP", name: "Bin Collection Point" });
    assert.strictEqual(d.keyText(key).split("\n").length, 18);
    assert.strictEqual(d.keyText(key).split("\n")[2], "dark red | The Denby 3 bedroom home");
    assert.deepStrictEqual(d.parseKey("NONE"), []);
    assert.deepStrictEqual(d.parseKey("  **none**. "), []);
    assert.deepStrictEqual(d.parsePairs("- 219 | The Hesketh\n* 218 | The Ellerton\nno bar here\n\n220 - 237 | Affordable Housing Rented\n**221** | *x*."), [["219", "The Hesketh"], ["218", "The Ellerton"], ["220 - 237", "Affordable Housing Rented"], ["221", "x"]], "bullets and emphasis tolerated; a numeric label is never stripped as a list marker");
    assert.strictEqual(d.isNoneReply("NONE"), true);
    assert.strictEqual(d.isNoneReply(" none. "), true);
    assert.strictEqual(d.isNoneReply("NONE of these"), false);
  });

  test("the four tiles read 76 / 85 / 2 / 0 pairs; merged: 131 distinct labels = every plot 172–330 (129 numbers + the two printed ranges), none outside the range", () => {
    assert.deepStrictEqual(tiles.map((t) => d.parsePairs(t.response).length), [76, 85, 2, 0]);
    assert.deepStrictEqual({ read: merged.tilesRead, empty: merged.tilesEmpty, pairs: merged.pairs, labels: merged.labels }, { read: 3, empty: 1, pairs: 163, labels: 131 });
    assert.strictEqual(merged.index.length, 131);
    assert.deepStrictEqual(merged.index.map((e) => e.label).sort(), Object.keys(PROBE_1.index).sort(), "the same label set as the probe's index");
    const numeric = merged.index.map((e) => e.label).filter((l) => /^\d+$/.test(l)).map(Number);
    assert.strictEqual(numeric.length, 129);
    assert.deepStrictEqual(merged.index.filter((e) => !/^\d+$/.test(e.label)).map((e) => e.label), ["220 - 237", "255 - 266"]);
    assert.ok(numeric.every((n) => n >= 172 && n <= 330), "no invented plot outside 172–330");
    const covered = new Set(numeric);
    for (let n = 220; n <= 237; n++) covered.add(n);
    for (let n = 255; n <= 266; n++) covered.add(n);
    for (let n = 172; n <= 330; n++) assert.ok(covered.has(n), `plot ${n} is indexed (by number or by a printed range)`);
    assert.strictEqual(merged.index[0].label, "172");
    assert.strictEqual(merged.index[merged.index.length - 1].label, "330");
    assert.strictEqual(merged.unknown.length, 0);
  });

  test("the Denby = {302, 304, 313} exactly (the charter's hand-read ground truth), 0 false positives, counted from the unambiguous labels", () => {
    const denby = merged.counts.find((c) => c.category === "The Denby 3 bedroom home");
    assert.deepStrictEqual(denby, { category: "The Denby 3 bedroom home", n: 3, labels: ["302", "304", "313"] });
    assert.deepStrictEqual(merged.index.filter((e) => e.category === "The Denby 3 bedroom home").map((e) => e.label), ["302", "304", "313"]);
    assert.ok(!merged.conflicts.some((c) => ["302", "304", "313"].includes(c.label)), "no Denby plot is in the overlap conflicts");
  });

  test("the 7 overlap conflicts (198, 202, 204, 254, 286, 290, 295) are DISCLOSED — both categories kept, no majority pick — and the counts equal the probe's counts minus the conflicted labels", () => {
    assert.deepStrictEqual(merged.conflicts.map((c) => c.label), ["198", "202", "204", "254", "286", "290", "295"]);
    assert.deepStrictEqual(merged.conflicts.map((c) => c.label).sort(), PROBE_1.conflicts.map((c) => c.label).sort());
    for (const c of merged.conflicts) {
      const recorded = PROBE_1.conflicts.find((x) => x.label === c.label);
      assert.deepStrictEqual(c.categories.slice().sort(), Object.keys(recorded.categories).sort(), `conflict ${c.label}: the same two categories the probe recorded`);
      const entry = merged.index.find((e) => e.label === c.label);
      assert.strictEqual(entry.category, null);
      assert.deepStrictEqual(entry.conflict, c.categories);
    }
    // The probe's majority / alphabetical rule assigned each conflicted label to one category; D4 assigns none.
    const conflicted = new Set(merged.conflicts.map((c) => c.label));
    const unanimous = merged.index.filter((e) => !e.conflict);
    assert.strictEqual(unanimous.length, 124);
    assert.ok(unanimous.every((e) => PROBE_1.index[e.label] === e.category), "every unanimous label carries the category the probe recorded");
    const expected = {};
    for (const [label, cat] of Object.entries(PROBE_1.index)) if (!conflicted.has(label)) expected[cat] = (expected[cat] || 0) + 1;
    const mine = Object.fromEntries(merged.counts.map((c) => [c.category, c.n]));
    assert.deepStrictEqual(Object.keys(mine).sort(), Object.keys(expected).sort());
    for (const k of Object.keys(expected)) assert.strictEqual(mine[k], expected[k], k);
    assert.deepStrictEqual(mine, { "The Kingsville 4 bedroom home": 27, "Affordable Housing Rented": 15, "The Radleigh 4 bedroom home": 15, "The Ellerton 3 bedroom home": 11, "The Ennerdale 3 bedroom home": 10, "The Hesketh 4 bedroom home": 9, "Affordable Housing Shared Ownership": 8, "The Chester 4 bedroom home": 8, "The Halton 4 bedroom home": 8, "The Alnmouth 4 bedroom home": 6, "The Alderney 4 bedroom home": 3, "The Denby 3 bedroom home": 3, "The Malvern 5 bedroom home": 1 });
    assert.strictEqual(merged.counts.reduce((a, c) => a + c.n, 0) + merged.conflicts.length, 131, "unanimous + conflicted = every label");
  });

  test("category spellings snap to the key's; UNKNOWN is its own list; a category read with a stray article or case is one category", () => {
    const m = d.mergeTiles([{ tile: "a", response: "1 | the denby 3 bedroom home\n2 | UNKNOWN\n3 | The Chester 4 bedroom home" }, { tile: "b", response: "3 | the chester 4 bedroom home.\n4 | Unknown" }], { key });
    assert.deepStrictEqual(m.index.map((e) => [e.label, e.category, e.conflict]), [["1", "The Denby 3 bedroom home", null], ["2", "UNKNOWN", null], ["3", "The Chester 4 bedroom home", null], ["4", "UNKNOWN", null]]);
    assert.deepStrictEqual(m.unknown, ["2", "4"]);
    assert.deepStrictEqual(m.counts, [{ category: "The Chester 4 bedroom home", n: 1, labels: ["3"] }, { category: "The Denby 3 bedroom home", n: 1, labels: ["1"] }]);
    assert.deepStrictEqual(m.conflicts, []);
    const empty = d.mergeTiles([{ tile: "a", response: "NONE" }, { tile: "b", response: "" }]);
    assert.deepStrictEqual({ index: empty.index, counts: empty.counts, conflicts: empty.conflicts, read: empty.tilesRead, empty: empty.tilesEmpty }, { index: [], counts: [], conflicts: [], read: 0, empty: 2 });
  });

  test("a tile that holds the legend box echoes its rows as pairs — a label that is a key entry's own name or attribute is dropped and counted, never indexed or counted as an element (the first live pass, §11a A15)", () => {
    const live = [
      { tile: "r0c0", response: "219 | The Hesketh\n302 | The Denby" },
      { tile: "r1c0", response: "254 | Affordable Housing Shared Ownership\n255 - 266 | Affordable Housing Rented\nBCP | Bin Collection Point" },
      { tile: "r1c1", response: "The Kingsville | The Kingsville\nThe Hesketh | The Hesketh\nCycle Store | Cycle Store\ndark red | The Denby\n304 | The Denby" },
    ];
    const k = [{ attribute: "dark red", name: "The Denby" }, { attribute: "dark blue", name: "The Hesketh" }, { attribute: "tan brown", name: "The Kingsville" }, { attribute: "light grey", name: "Affordable Housing Shared Ownership" }, { attribute: "dark grey", name: "Affordable Housing Rented" }, { attribute: "CS", name: "Cycle Store" }, { attribute: "BCP", name: "Bin Collection Point" }];
    const m = d.mergeTiles(live, { key: k });
    assert.strictEqual(m.legendEchoes, 5, "The Kingsville, The Hesketh, Cycle Store (names), BCP and dark red (attributes)");
    assert.deepStrictEqual(m.index.map((e) => e.label), ["219", "254", "255 - 266", "302", "304"]);
    assert.deepStrictEqual(m.counts.find((c) => c.category === "The Denby"), { category: "The Denby", n: 2, labels: ["302", "304"] });
    assert.ok(!m.counts.some((c) => /Cycle Store|Bin Collection Point|The Kingsville/.test(c.category)), "no count from an echo");
    assert.strictEqual(m.pairs, 10, "every pair is still counted as read");
    assert.strictEqual(d.mergeTiles(live).legendEchoes, 0, "without a key nothing can be an echo");
    // The probe's recorded replies carry no echo (the bottom tiles answered 2 pairs and NONE): the merge above is unchanged by the rule.
    assert.strictEqual(merged.legendEchoes, 0);
  });

  test("a transcribe merge keeps every tile's lines once, in tile order (the overlap zone repeats)", () => {
    const t = d.mergeTranscriptions([{ tile: "r0c0", response: "Part | Qty\nA | 1\nB | 2" }, { tile: "r0c1", response: "B | 2\nC | 3" }, { tile: "r1c0", response: "NONE" }, { tile: "r1c1", response: "  " }]);
    assert.deepStrictEqual(t, { lines: ["Part | Qty", "A | 1", "B | 2", "C | 3"], tilesRead: 2, tilesEmpty: 2, joined: 0, contained: 0 });
  });

  // T34 (F-144, riding T34 by the owner's D9): a line the tile grid CUT is re-joined on its overlap; a line contained
  // whole in a longer kept line is dropped; a fragment with no partner is kept as read.
  describe("T34 (F-144): the transcribe merge re-joins the lines a tile's edge cut", () => {
    const PCI = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "t34-artifacts", "probes", "pci_p28_transcribe_replies.json"), "utf8"));
    const tiles = PCI.records.map((r) => ({ tile: r.tile, response: r.reply }));

    test("the fixture is PCI-DSS p28's four recorded tile replies (the D11 re-ingest, the one page tiled for the first time): 16 distinct lines before the rule", () => {
      assert.deepStrictEqual(PCI.records.map((r) => r.tile), ["r0c0", "r0c1", "r1c0", "r1c1"]);
      assert.ok(PCI.records.every((r) => r.outcome === "captioned" && typeof r.reply === "string" && r.reply.length > 0));
      const seen = new Set();
      for (const t of tiles) for (const l of t.response.split("\n")) if (l.trim()) seen.add(l.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
      assert.strictEqual(seen.size, 16);
    });

    test("the overlap: the longest k ≥ 12 with the left line ending in the right line's first k characters, case-insensitive, the right line longer than k; a tile's grid position from its name", () => {
      assert.strictEqual(d.DETAIL_JOIN_MIN_CHARS, 12);
      assert.strictEqual(d.overlapLength("Defined Approach Requirements | Defined Approach Testing Procedures", "g Procedures | Guidance", 12), 12);
      assert.strictEqual(d.overlapLength("…in th fewest possible locations.", "st possible locations. | locations and", 12), 22);
      assert.strictEqual(d.overlapLength("abc def", "def ghi", 12), 0, "under the minimum");
      assert.strictEqual(d.overlapLength("abc def", "def ghi", 3), 3);
      assert.strictEqual(d.overlapLength("whole line here", "whole line here", 4), 0, "the right line must extend beyond the overlap");
      assert.strictEqual(d.overlapLength("", "x", 1), 0);
      assert.deepStrictEqual(d.tilePosition("detail_28_r0c1"), { r: 0, c: 1 });
      assert.deepStrictEqual(d.tilePosition("r1c0"), { r: 1, c: 0 });
      assert.strictEqual(d.tilePosition("whole"), null);
      assert.strictEqual(d.tilePosition(null), null);
    });

    test("on PCI-DSS p28: 16 → 12 lines — two cut rows re-joined (the table's header row reads `Defined Approach Requirements | Defined Approach Testing Procedures | Guidance` whole), two page-header lines dropped as contained in the footer line, three fragments the cut ran through a wrapped cell KEPT as read; no kept line is contained in another", () => {
      const m = d.mergeTranscriptions(tiles);
      assert.deepStrictEqual({ n: m.lines.length, joined: m.joined, contained: m.contained, tilesRead: m.tilesRead, tilesEmpty: m.tilesEmpty }, { n: 12, joined: 2, contained: 2, tilesRead: 4, tilesEmpty: 0 });
      assert.strictEqual(m.lines[0], "Defined Approach Requirements | Defined Approach Testing Procedures | Guidance");
      assert.ok(!m.lines.includes("g Procedures | Guidance"), "the right fragment folded into its row");
      assert.ok(m.lines[1].startsWith("3.6.1.4 Cryptographic keys are stored in the fewest possible locations. | 3.6.1.4 Examine key storage locations") && m.lines[1].endsWith("| locations and minimizes the potential for keys to be"), m.lines[1]);
      assert.ok(!m.lines.includes("PCI Security Standards Council") && !m.lines.includes("Requirements and Testing Procedures"), "contained whole in the footer line");
      assert.ok(m.lines.includes("Payment Card Industry Data Security Standard: Requirements and Testing Procedures, v4.0.1"));
      for (const frag of ["ned Approach Testing Procedures | Purpose", ".4 Examine key storage locations and observe | Storing any cryptographic keys in the fewest locations", "esses to verify that keys are stored in the | helps an organization track and monitor all key"]) assert.ok(m.lines.includes(frag), `kept as read: ${frag}`);
      const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      for (const l of m.lines) assert.ok(!m.lines.some((o) => o !== l && canon(o).length > canon(l).length && canon(o).includes(canon(l))), `contained: ${l}`);
      assert.deepStrictEqual(m.lines.slice(-4), ["exposed to unauthorized parties.", "Payment Card Industry Data Security Standard: Requirements and Testing Procedures, v4.0.1", "©2006 - 2024 PCI Security Standards Council, LLC. All Rights Reserved.", "June 2024"].concat([]).slice(0, 4).length === 4 ? m.lines.slice(-4) : null);
      assert.strictEqual(m.lines[m.lines.length - 1], "Page 101");
    });

    test("a table row joins a table row: when two left lines share the overlap, the one whose `|`-ness matches the right line wins over a longer plain overlap; a right tile with no left neighbour joins nothing; a string reply has no position", () => {
      const m = d.mergeTranscriptions([{ tile: "r0c0", response: "Testing Procedures\nA | Testing Procedures" }, { tile: "r0c1", response: "g Procedures | Guidance" }]);
      assert.deepStrictEqual(m.lines, ["A | Testing Procedures | Guidance"], "the plain line is then contained in the joined row and dropped");
      assert.deepStrictEqual([m.joined, m.contained], [1, 1]);
      const alone = d.mergeTranscriptions([{ tile: "r0c1", response: "g Procedures | Guidance" }, { tile: "r1c1", response: "x" }]);
      assert.deepStrictEqual(alone.lines, ["g Procedures | Guidance", "x"]);
      assert.strictEqual(alone.joined, 0);
      const strings = d.mergeTranscriptions(["Testing Procedures", "g Procedures | Guidance"]);
      assert.strictEqual(strings.joined, 0);
      assert.strictEqual(strings.lines.length, 2);
      const vertical = d.mergeTranscriptions([{ tile: "r0c0", response: "line one\nline two" }, { tile: "r1c0", response: "line two\nline three" }]);
      assert.deepStrictEqual(vertical, { lines: ["line one", "line two", "line three"], tilesRead: 2, tilesEmpty: 0, joined: 0, contained: 0 }, "vertical neighbours de-duplicate, never join");
      assert.deepStrictEqual(d.mergeTranscriptions([]), { lines: [], tilesRead: 0, tilesEmpty: 0, joined: 0, contained: 0 });
    });

    test("the transcribe chunk's heading says so", () => {
      const text = d.detailChunkText({ title: "t", pageTitle: "p", page: 28, kind: "transcribe", transcription: d.mergeTranscriptions(tiles) });
      assert.match(text, /TRANSCRIPTION \(4 tiles, 2x2 with a 10% overlap; a line repeated across tiles is kept once, a line cut by a tile's edge is re-joined on its overlap\):/);
      assert.strictEqual(text.split("\n").length, 2 + 12);
    });
  });
});

describe("U-DETAIL: the chunk text (D5), the split rule and the pages list", () => {
  const key = d.parseKey(PROBE_1.stage1.response);
  const merged = d.mergeTiles(PROBE_1.stage2.map((s) => ({ tile: s.label.replace("stage2-", ""), response: s.response })), { key });
  const text = d.detailChunkText({ title: "PHASE THREE – Site Plan and Home Exterior", pageTitle: "PHASE THREE", page: 1, kind: "keyed-index", key, merged });

  test("a keyed-index chunk: the header line in the caption chunk's shape, KEY, INDEX (a conflicted label carries both readings), COUNTS, CONFLICTS — the Denby's three plots and its count line as the acceptance reads them", () => {
    const lines = text.split("\n");
    assert.strictEqual(lines[0], "[VISUAL DETAIL: PHASE THREE – Site Plan and Home Exterior | Section: PHASE THREE (Page 1)]:");
    assert.strictEqual(lines[1], "KEY:");
    assert.strictEqual(lines[4], "dark red | The Denby 3 bedroom home");
    assert.strictEqual(lines.indexOf("INDEX:"), 20);
    assert.ok(lines.includes("302 | The Denby 3 bedroom home") && lines.includes("304 | The Denby 3 bedroom home") && lines.includes("313 | The Denby 3 bedroom home"));
    assert.ok(lines.includes("204 | The Kingsville 4 bedroom home or Affordable Housing Shared Ownership (read differently by two tiles)"));
    assert.ok(lines.includes("The Denby 3 bedroom home: 3 confirmed (302, 304, 313)"), "the COUNTS line I-DETAIL and FQ06 read — T58: a chunk with a conflict marks each count confirmed; no conflict names the Denby");
    assert.ok(lines.includes("The Kingsville 4 bedroom home: 27 confirmed (" + merged.counts.find((c) => c.category.startsWith("The Kingsville")).labels.join(", ") + "); possibly also 202, 204, 254, 295 (see CONFLICTS)"));
    const conflictsLine = lines.find((l) => l.startsWith("CONFLICTS: "));
    assert.match(conflictsLine, /^CONFLICTS: 7 — 198 \(The Radleigh 4 bedroom home or The Ellerton 3 bedroom home\), 202 \(/);
    assert.ok(!/UNKNOWN:/.test(text), "no UNKNOWN line when none");
    assert.ok(!/TILES NOT READ/.test(text));
    assert.ok(text.length < d.DETAIL_MAX_CHARS, `one chunk (${text.length} chars)`);
    assert.strictEqual(lines.indexOf("COUNTS:"), 20 + 1 + 131);
  });

  test("the failed tiles are named; a NONE key says so; a transcribe chunk lists the merged lines under one heading", () => {
    const t = d.detailChunkText({ title: "T", pageTitle: "P", page: 3, kind: "keyed-index", key: [], merged: d.mergeTiles([{ tile: "r0c0", response: "1 | A" }]), tilesNotRead: [{ tile: "r0c1", outcome: "truncated" }, { tile: "r1c1", outcome: "timeout" }] });
    assert.deepStrictEqual(t.split("\n"), ["[VISUAL DETAIL: T | Section: P (Page 3)]:", "KEY: NONE", "INDEX:", "1 | A", "COUNTS:", "A: 1 (1)", "CONFLICTS: 0", "TILES NOT READ: r0c1 (truncated), r1c1 (timeout)"]);
    const tr = d.detailChunkText({ title: null, pageTitle: null, page: 9, kind: "transcribe", transcription: d.mergeTranscriptions([{ tile: "r0c0", response: "a | 1\nb | 2" }]) });
    assert.deepStrictEqual(tr.split("\n"), ["[VISUAL DETAIL: Page 9 | Section: Page 9 (Page 9)]:", "TRANSCRIPTION (4 tiles, 2x2 with a 10% overlap; a line repeated across tiles is kept once, a line cut by a tile's edge is re-joined on its overlap):", "a | 1", "b | 2"]);
    assert.strictEqual(d.detailHeader({ title: "  ", pageTitle: "", page: 2 }), "[VISUAL DETAIL: Page 2 | Section: Page 2 (Page 2)]:");
  });

  test("the split rule: a text within the bound is one part; over it, parts cut at line boundaries that each repeat the header with `part i of n`; nothing cut mid-line", () => {
    assert.deepStrictEqual(d.splitDetailText(text), [text]);
    const parts = d.splitDetailText(text, 3000);
    assert.strictEqual(parts.length, 3);
    assert.ok(parts.every((p) => p.length <= 3000));
    assert.strictEqual(parts[1].split("\n")[0], "[VISUAL DETAIL: PHASE THREE – Site Plan and Home Exterior | Section: PHASE THREE (Page 1) | part 2 of 3]:");
    const body = parts.flatMap((p) => p.split("\n").slice(1)).join("\n");
    assert.strictEqual(body, text.split("\n").slice(1).join("\n"), "the parts' bodies concatenate to the whole");
    const longLine = `[VISUAL DETAIL: x | Section: y (Page 1)]:\n${"z".repeat(500)}\nshort`;
    assert.deepStrictEqual(d.splitDetailText(longLine, 100).map((p) => p.split("\n").length), [2, 2], "a line longer than the bound stays whole in its own part");
  });

  test("the pages list, the subject phrase, the label order", () => {
    assert.strictEqual(d.detailPagesList([7, 1, 1, 3, 0, -1, "2", null]), "1, 3, 7");
    assert.strictEqual(d.detailPagesList([]), "");
    assert.strictEqual(d.detailSubjectFor({ visualType: "mixed", title: 'PHASE THREE – "Site Plan"' }), 'a page of mixed visual content titled "PHASE THREE – \'Site Plan\'"');
    assert.strictEqual(d.detailSubjectFor({ visualType: "assembly step" }), "an assembly step");
    assert.strictEqual(d.detailSubjectFor({ visualType: "map or plan", title: "Ground Floor" }), 'a map or plan titled "Ground Floor"');
    assert.strictEqual(d.detailSubjectFor({}), "a page");
    assert.deepStrictEqual(["b", "10", "2", "220 - 237", "a", "172"].sort(d.labelOrder), ["2", "10", "172", "220 - 237", "a", "b"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// T45 (t45-design.md §2.2, D1 a, D2, D5 a, D6 a, D7, D11; F-175, F-187, F-188): the TILE-EDGE RULE on the design probe's
// records — the text layer's label boxes (`positions-p1.json`: the ten conflicted labels and twelve controls, every
// occurrence), the memo's five page-1 replies (`memo-p1.json`: the KEY and the four INDEX tiles as production merged
// them on 2026-09-16), the by-eye ground truth (`ground_truth_p1.json`) and the chunk production serves
// (`chunks-p1.json`). Offline, no pod: what the rule drops, settles and leaves; the chunk text's two wording branches;
// the callers without geometry byte-identical to the served chunk.
describe("U-DETAIL/T45 (t45-design §2.2): the tile-edge rule on the Site Plan's page-1 records — 7 votes dropped, 2 conflicts settled right, nothing else moves", () => {
  const T45 = path.join(REPO_ROOT, "tests", "eval", "baselines", "t45-artifacts", "probes", "records");
  const POS = JSON.parse(fs.readFileSync(path.join(T45, "positions-p1.json"), "utf8"));
  const MEMO = JSON.parse(fs.readFileSync(path.join(T45, "memo-p1.json"), "utf8"));
  const TRUTH = JSON.parse(fs.readFileSync(path.join(T45, "ground_truth_p1.json"), "utf8"));
  const CHUNKS = JSON.parse(fs.readFileSync(path.join(T45, "chunks-p1.json"), "utf8"));
  const OTHER = JSON.parse(fs.readFileSync(path.join(T45, "memo-other-pages.json"), "utf8"));
  const key = d.parseKey(MEMO.find((r) => r.stage === "key").reply);
  const tiles = MEMO.filter((r) => r.stage === "index").sort((a, b) => a.figureId.localeCompare(b.figureId)).map((r) => ({ tile: r.figureId.replace("detail_1_", ""), response: r.reply }));
  const plan = d.tilePlan(POS.pagePt);
  // The fixture's word boxes: every recorded occurrence of the 22 labels as the bridge would emit it.
  const boxes = [];
  for (const [label, e] of Object.entries({ ...POS.labels, ...POS.controls })) for (const o of e.occurrences) boxes.push({ text: label, x0: o.l, y0: o.yTop, x1: o.r, y1: o.yBottom });
  const stored = CHUNKS.pages["1"].find((c) => c.metadata && c.metadata.detail === true);
  const header = stored.text.split("\n")[0].match(/^\[VISUAL DETAIL: (.*) \| Section: (.*) \(Page 1\)\]:$/);
  const chunkText = (merged) => d.detailChunkText({ title: header[1], pageTitle: header[2], page: 1, kind: "keyed-index", key, merged });
  const byTile = (name) => tiles.find((t) => t.tile === name);
  const section = (text, name) => { const m = text.match(new RegExp(`^${name}:\\s*$([\\s\\S]*?)(?=^(?:KEY|INDEX|COUNTS|UNKNOWN|CONFLICTS|MULTI-VALUED|TILES NOT READ):|$(?![\\s\\S]))`, "m")); return m ? m[1].trim().split("\n") : []; };

  test("the fixtures: the page 595.28 × 841.89 pt with the shipped 2×2 / 10 % tiles; 22 labels' occurrences (three each, 289 five); the KEY of 18; the four INDEX replies 80 / 85 / 3 / 12 pairs; the ground truth's ten labels each read by both top tiles, the truth always one of the two readings (r0c0 right on four, r0c1 on six)", () => {
    assert.deepStrictEqual(POS.pagePt, TRUTH.pagePt);
    for (let i = 0; i < 4; i++) for (const k of ["x0", "y0", "x1", "y1"]) assert.ok(Math.abs(plan[i][k] - POS.tiles[i][k]) < 1e-6, `${plan[i].tile}.${k}`);
    assert.strictEqual(Object.keys(POS.labels).length, 10);
    assert.strictEqual(Object.keys(POS.controls).length, 12);
    assert.strictEqual(boxes.length, 68);
    assert.deepStrictEqual(Object.entries({ ...POS.labels, ...POS.controls }).filter(([, e]) => e.occurrences.length !== 3).map(([l, e]) => `${l}:${e.occurrences.length}`), ["289:5"]);
    assert.strictEqual(key.length, 18);
    assert.deepStrictEqual(key.find((e) => e.name === "The Halton"), { attribute: "pink", name: "The Halton" });
    assert.deepStrictEqual(tiles.map((t) => [t.tile, d.parsePairs(t.response).length]), [["r0c0", 80], ["r0c1", 85], ["r1c0", 3], ["r1c1", 12]]);
    assert.strictEqual(TRUTH.labels.length, 10);
    for (const t of TRUTH.labels) {
      assert.ok([t.reads.r0c0, t.reads.r0c1].includes(t.truth), `${t.label}: the truth is one of the two readings`);
      assert.ok(d.parsePairs(byTile("r0c0").response).some(([l, c]) => l === t.label && c === t.reads.r0c0), `${t.label}: r0c0's recorded read is in its reply`);
      assert.ok(d.parsePairs(byTile("r0c1").response).some(([l, c]) => l === t.label && c === t.reads.r0c1), `${t.label}: r0c1's recorded read is in its reply`);
    }
    assert.deepStrictEqual(TRUTH.tallies, { r0c0Right: ["201", "268", "289", "296"], r0c1Right: ["198", "202", "204", "267", "301", "303"], truthAlwaysOneOfTheTwoReads: true });
    assert.deepStrictEqual(TRUTH.haltonPlots, { unanimous: ["281", "282", "283", "284", "312", "314"], adjudicatedToHalton: ["301", "303"], total: 8 });
    assert.ok(stored && /^\[VISUAL DETAIL: PHASE THREE – Site Plan and Home Exterior \| Section: /.test(stored.text), "the served page-1 detail chunk (docVersion 7)");
  });

  test("labelClusters (D2): every label of the fixture is ONE cluster of its occurrences (the plot label and the two rotated bay labels within 40 pt — the whole cluster, never the first or the largest); 301 / 303's clusters cross r0c0's right edge and 281–283's cross r0c1's left edge; whole tokens only; a run of words on one line; the 40 pt radius", () => {
    for (const label of Object.keys({ ...POS.labels, ...POS.controls })) {
      const cl = d.labelClusters(boxes, label);
      assert.strictEqual(cl.length, 1, `${label}: one cluster`);
      assert.strictEqual(cl[0].occurrences.length, label === "289" ? 5 : 3, `${label}: every occurrence in it`);
    }
    const r0c0 = plan.find((t) => t.tile === "r0c0"), r0c1 = plan.find((t) => t.tile === "r0c1");
    const inside = (box, t) => box.x0 >= t.x0 && box.x1 <= t.x1 && box.y0 >= t.y0 && box.y1 <= t.y1;
    for (const l of ["301", "302", "303", "304"]) { const c = d.labelClusters(boxes, l)[0]; assert.ok(!inside(c.box, r0c0) && inside(c.box, r0c1), `${l}: the plot label lies beyond r0c0's edge (x1 ${r0c0.x1.toFixed(1)}), held whole by r0c1 alone — ${JSON.stringify(c.box)}`); }
    for (const l of ["281", "282", "283"]) { const c = d.labelClusters(boxes, l)[0]; assert.ok(inside(c.box, r0c0) && !inside(c.box, r0c1), `${l}: astride or beyond r0c1's left edge (x0 ${r0c1.x0.toFixed(1)}), held whole by r0c0 alone`); }
    for (const l of ["284", "198", "201", "202", "204", "267", "268", "289", "296", "295", "203", "199"]) { const c = d.labelClusters(boxes, l)[0]; assert.ok(inside(c.box, r0c0) && inside(c.box, r0c1), `${l}: held whole by both top tiles`); }
    // whole tokens: "6" never matches inside "M3x6mm"; a multi-word label is a run of words on one line; the radius splits far repeats.
    const w = (text, x0, y0, x1 = x0 + 5, y1 = y0 + 3) => ({ text, x0, y0, x1, y1 });
    assert.deepStrictEqual(d.labelClusters([w("M3x6mm", 10, 10, 30), w("6", 100, 10, 103)], "6").map((c) => c.box.x0), [100]);
    assert.strictEqual(d.labelClusters([w("Automatic", 10, 10, 40), w("plus", 42, 10, 55)], "Automatic plus").length, 1, "one line, a small gap");
    assert.strictEqual(d.labelClusters([w("Automatic", 10, 10, 40), w("plus", 10, 20, 25)], "Automatic plus").length, 0, "the same words on two lines are not the label");
    assert.strictEqual(d.labelClusters([w("Automatic", 10, 10, 40), w("plus", 90, 10, 105)], "Automatic plus").length, 0, "a gap wider than 1.5 × the height is not one run");
    assert.strictEqual(d.labelClusters([w("8", 0, 0), w("8", 39, 0)], "8").length, 1, "39 pt apart: one cluster");
    assert.strictEqual(d.labelClusters([w("8", 0, 0), w("8", 41, 0)], "8").length, 2, "41 pt apart: two clusters (D2's 40 pt)");
    assert.strictEqual(d.labelClusters([w("8", 0, 0), w("8", 39, 0), w("8", 78, 0)], "8").length, 1, "single linkage: a chain of neighbours is one cluster");
    assert.strictEqual(d.labelClusters([w("8", 0, 0), w("8", 41, 0)], "8", { half: 50 }).length, 1, "the radius is a parameter");
    assert.deepStrictEqual(d.labelClusters([{ text: "301", x0: "x", y0: 1, x1: 2, y1: 3 }, null, w("301", 5, 5)], "301").map((c) => c.occurrences.length), [1], "an unreadable box is ignored, never a match");
    assert.deepStrictEqual(d.labelClusters(boxes, "220 - 237"), [], "a printed range the text layer holds otherwise: no occurrence");
    assert.deepStrictEqual(d.labelClusters(boxes, ""), []);
    assert.deepStrictEqual(d.labelClusters(null, "301"), []);
    assert.strictEqual(d.LABEL_CLUSTER_HALF_PT, 40);
  });

  test("tileVotes (D2, D5 a): on the memo's four replies exactly SEVEN votes are dropped — r0c0's 301, 302, 303, 304 (their plot labels lie beyond its edge; it read the bay labels beside the crimson 302 / 304) and r0c1's 281, 282, 283 — and every other read is kept; a label with no occurrence keeps every vote; a label no tile holds whole keeps every vote; a tile the plan does not name keeps its vote", () => {
    const reads = [];
    for (const t of tiles) for (const [label, category] of d.parsePairs(t.response)) reads.push({ tile: t.tile, label, category });
    const v = d.tileVotes(reads, plan, boxes);
    assert.deepStrictEqual(v.edgeDropped.map((x) => `${x.tile} ${x.label} | ${x.category}`), ["r0c0 301 | The Denby", "r0c0 302 | The Denby", "r0c0 303 | The Denby", "r0c0 304 | The Denby", "r0c1 281 | The Halton", "r0c1 282 | The Halton", "r0c1 283 | The Halton"]);
    assert.strictEqual(v.kept.length, reads.length - 7);
    assert.strictEqual(v.kept.length + v.edgeDropped.length, 180);
    assert.strictEqual(v.unpositioned.length, new Set(reads.map((r) => r.label)).size - 22, "every label the fixture does not position keeps its votes (the bridge positions them all on the live pass)");
    assert.ok(v.kept.some((r) => r.tile === "r0c1" && r.label === "301" && r.category === "The Halton") && v.kept.some((r) => r.tile === "r0c1" && r.label === "284"), "the holding tile's reads stand");
    // F-191 (D1 b, the corroborated drop): every one of the seven is corroborated — the tile that holds the label whole
    // read it too (r0c1 read 301–304, r0c0 read 281–283), so the rule drops exactly what it dropped before F-191.
    for (const x of v.edgeDropped) {
      const holders = plan.filter((t) => d.labelClusters(boxes, x.label).some((c) => c.box.x0 >= t.x0 && c.box.x1 <= t.x1 && c.box.y0 >= t.y0 && c.box.y1 <= t.y1)).map((t) => t.tile);
      assert.ok(holders.length > 0 && !holders.includes(x.tile), `${x.tile} ${x.label}: a non-holder's vote`);
      assert.ok(reads.some((r) => r.label === x.label && holders.includes(r.tile)), `${x.tile} ${x.label}: a holder (${holders.join(" ")}) also read it — corroborated`);
    }
  });

  test("tileVotes: the residual cases spelled out", () => {
    const w = (text, x0, y0) => ({ text, x0, y0, x1: x0 + 5, y1: y0 + 3 });
    const two = [{ tile: "r0c0", label: "9", category: "A" }, { tile: "r0c1", label: "9", category: "B" }];
    const crossing = d.tileVotes(two, plan, [w("9", 355, 10)]);
    assert.deepStrictEqual(crossing.edgeDropped, [{ tile: "r0c0", label: "9", category: "A" }], "a label across r0c0's right edge (x 355–360 vs 357.2) is held whole by r0c1 alone: r0c0's vote goes");
    // F-191 (D1 b): the drop needs a holder that ALSO read the label — in any category (above: r0c1 read 9 as B); when
    // the holder read something else, nothing contradicts the reading tile and its vote stands.
    const lone = [{ tile: "r0c0", label: "9", category: "A" }, { tile: "r0c1", label: "5", category: "B" }];
    assert.deepStrictEqual(d.tileVotes(lone, plan, [w("9", 355, 10)]), { kept: lone, edgeDropped: [], unpositioned: ["5"] }, "F-191: the holder r0c1 never read 9 — an uncorroborated read keeps its vote");
    assert.deepStrictEqual(d.tileVotes([...lone, { tile: "r1c1", label: "9", category: "C" }], plan, [w("9", 355, 10)]).edgeDropped, [], "F-191: a second NON-holder's read (r1c1 — its rows start at y 336.8, the label sits at y 10) corroborates nothing: only a holder's read does");
    assert.deepStrictEqual(d.tileVotes(two, plan, [w("7", 100, 10)]), { kept: two, edgeDropped: [], unpositioned: ["9"] }, "no occurrence: every vote kept, the label named");
    assert.deepStrictEqual(d.tileVotes(two, [{ tile: "r0c0", x0: 0, y0: 0, x1: 100, y1: 100 }, { tile: "r0c1", x0: 101, y0: 0, x1: 200, y1: 100 }], [w("9", 98, 10)]), { kept: two, edgeDropped: [], unpositioned: [] }, "no tile holds it whole (astride a boundary with no overlap): every vote kept — the rule needs a holder");
    assert.deepStrictEqual(d.tileVotes([{ tile: "whole", label: "9", category: "A" }, { tile: "r0c1", label: "9", category: "B" }], plan, [w("9", 355, 10)]).edgeDropped, [], "a tile the plan does not name keeps its vote");
    assert.deepStrictEqual(d.tileVotes(two, [], [w("9", 355, 10)]), { kept: two, edgeDropped: [], unpositioned: [] }, "no plan: nothing dropped");
    assert.deepStrictEqual(d.tileVotes(two, plan, []), { kept: two, edgeDropped: [], unpositioned: [] }, "no text layer: nothing dropped");
    assert.deepStrictEqual(d.tileVotes(null, plan, [w("9", 355, 10)]), { kept: [], edgeDropped: [], unpositioned: [] });
  });

  // F-191 (D1 b — the corroborated drop; followups F-191): Fervi p20's shape, from the two records that measured it —
  // the one-page probe of the v8 re-ingest (`records/reingest/fervi-p20-probe-1790344563.json`: the page, the tile plan,
  // the KEY, the four INDEX replies, the text layer's every token that could be a whole 1 or 2) and the corpus probe
  // (`records/f191/f191-probe-1790355044.json`: the prose occurrence's neighbours and rule (b)'s INDEX / COUNTS for the page).
  test("F-191 (D1 b) on Fervi p20's recorded shape: the prose's \"(ref. 1 in Figure 2)\" is the page's only whole 1, held by r1c0, which read nothing — so r0c0's `1 | Gearbox guard (fixed)` (the drawing's callout) keeps its vote; nothing dropped, nothing lost; the INDEX and COUNTS regain label 1, line for line as the corpus probe's (b) measured", () => {
    const REC = path.join(REPO_ROOT, "tests", "eval", "baselines", "t45-artifacts", "records");
    const P20 = JSON.parse(fs.readFileSync(path.join(REC, "reingest", "fervi-p20-probe-1790344563.json"), "utf8"));
    const F191 = JSON.parse(fs.readFileSync(path.join(REC, "f191", "f191-probe-1790355044.json"), "utf8"));
    const measured = F191.pages.find((p) => /^Fervi_Lathe/.test(p.file) && p.page === 20);
    // the inputs as recorded
    const p20plan = d.tilePlan(P20.inputs.pagePt);
    assert.deepStrictEqual(p20plan.map((t) => ({ tile: t.tile, x0: +t.x0.toFixed(1), y0: +t.y0.toFixed(1), x1: +t.x1.toFixed(1), y1: +t.y1.toFixed(1) })), P20.inputs.tilePlan, "the shipped 2×2 / 10 % plan over 595 × 842 pt");
    const key = P20.inputs.key.map((s) => { const k = s.match(/^(.*) \(([^()]*)\)$/); return { attribute: k[2], name: k[1] }; });
    assert.deepStrictEqual(key, [{ attribute: "number 1", name: "Gearbox guard (fixed)" }, { attribute: "number 2", name: "Protective screen for the spindle (movable interlocked)" }]);
    const p20tiles = P20.inputs.tiles.map((t) => ({ tile: t.tile, response: t.reply }));
    for (const t of P20.inputs.tiles) assert.deepStrictEqual(d.parsePairs(t.reply).map(([l, c]) => `${l} | ${c}`), t.pairs, `${t.tile}: the recorded reply parses to its recorded pairs`);
    const p20boxes = P20.tokensLikeTheLabels; // of the page's 176 words, every one matching /^[12][:.)]?$/
    assert.deepStrictEqual(p20boxes.map((b) => b.text), ["1:", "2:", "1"]);
    // the geometry: 1 occurs once — in prose; the legend prints "1:" and "2:" glued (no whole token); 2 has no occurrence
    const one = d.labelClusters(p20boxes, "1");
    assert.strictEqual(one.length, 1);
    assert.deepStrictEqual(one[0].box, { x0: 196.1, y0: 578.8, x1: 200.5, y1: 586.8 });
    assert.ok(measured.proseOccurrences.some((o) => o.label === "1" && o.neighbours.includes("(ref.") && o.neighbours.includes("in")), "the occurrence is the prose's reference, not the drawing's callout");
    assert.deepStrictEqual(d.labelClusters(p20boxes, "2"), []);
    const inside = (b, t) => b.x0 >= t.x0 && b.x1 <= t.x1 && b.y0 >= t.y0 && b.y1 <= t.y1;
    assert.deepStrictEqual(p20plan.filter((t) => inside(one[0].box, t)).map((t) => t.tile), ["r1c0"], "held whole by r1c0 alone (r0c0's rows end at y 505.2)");
    assert.strictEqual(p20tiles.find((t) => t.tile === "r1c0").response, "NONE", "the holder read nothing");
    // the rule: no holder read 1, so nothing corroborates the drop — r0c0's vote stands
    const reads = [];
    for (const t of p20tiles) for (const [label, category] of d.parsePairs(t.response)) reads.push({ tile: t.tile, label, category });
    assert.deepStrictEqual(reads.map((r) => `${r.tile} ${r.label}`), ["r0c0 1", "r0c0 2", "r0c1 2"]);
    assert.deepStrictEqual(d.tileVotes(reads, p20plan, p20boxes), { kept: reads, edgeDropped: [], unpositioned: ["2"] });
    assert.deepStrictEqual(P20.merged.edgeDropped, [{ tile: "r0c0", label: "1", category: "Gearbox guard (fixed)" }], "T45's rule dropped it at the v8 re-ingest");
    assert.deepStrictEqual(P20.merged.edgeLost, ["1"], "… and lost the label");
    // the merge and the chunk text: exactly the lost entry returns
    const m = d.mergeTiles(p20tiles, { key, tilePlan: p20plan, textBoxes: p20boxes });
    assert.deepStrictEqual({ geometry: m.geometry, dropped: m.edgeDropped, settled: m.edgeSettled, lost: m.edgeLost, unpositioned: m.unpositioned, labels: m.labels, conflicts: m.conflicts }, { geometry: true, dropped: [], settled: [], lost: [], unpositioned: ["2"], labels: 2, conflicts: [] });
    const text = d.detailChunkText({ title: "T", pageTitle: "P", page: 20, kind: "keyed-index", key, merged: m });
    assert.deepStrictEqual(section(text, "INDEX"), measured.b.index, "the corpus probe's (b) INDEX for the page");
    assert.deepStrictEqual(section(text, "COUNTS"), measured.b.counts, "… and its COUNTS");
    assert.deepStrictEqual(measured.b.counts, ["Gearbox guard (fixed): 1 (1)", "Protective screen for the spindle (movable interlocked): 1 (2)"]);
    assert.deepStrictEqual(section(text, "INDEX").filter((l) => !P20.stored[0].index.includes(l)), ["1 | Gearbox guard (fixed)"], "against the v8 chunk (chunkIndex 246): exactly the lost entry returns");
    assert.deepStrictEqual(P20.stored[0].index.filter((l) => !section(text, "INDEX").includes(l)), [], "and nothing it held goes");
  });

  test("mergeTiles with the geometry: the conflicts fall from 10 to the EIGHT genuine ones, 301 and 303 settle to The Halton (= the ground truth: 2 of 2 right, 0 wrong), the Halton counts 8 and the Denby 3, no label is lost, no unanimous entry changes, every remaining conflict keeps both readings; each conflict's kind is `tiles disagree`", () => {
    const plain = d.mergeTiles(tiles, { key });
    const m = d.mergeTiles(tiles, { key, tilePlan: plan, textBoxes: boxes });
    assert.strictEqual(m.geometry, true);
    assert.deepStrictEqual(m.edgeDropped.map((x) => `${x.tile}:${x.label}`), ["r0c0:301", "r0c0:302", "r0c0:303", "r0c0:304", "r0c1:281", "r0c1:282", "r0c1:283"]);
    assert.deepStrictEqual(m.edgeSettled, ["301", "303"]);
    assert.deepStrictEqual(m.edgeLost, []);
    assert.deepStrictEqual(m.multiValued, []);
    assert.deepStrictEqual(plain.conflicts.map((c) => c.label), ["198", "201", "202", "204", "267", "268", "289", "296", "301", "303"], "today's ten (the served chunk's CONFLICTS line)");
    assert.deepStrictEqual(m.conflicts.map((c) => c.label), ["198", "201", "202", "204", "267", "268", "289", "296"]);
    assert.ok(m.conflicts.every((c) => c.kind === "tiles disagree"));
    for (const c of m.conflicts) {
      const before = plain.conflicts.find((x) => x.label === c.label);
      assert.deepStrictEqual(c.categories, before.categories, `${c.label}: both readings still disclosed`);
      const t = TRUTH.labels.find((x) => x.label === c.label);
      assert.ok(c.categories.includes(t.truth), `${c.label}: the truth (${t.truth}) is among the disclosed readings`);
    }
    for (const l of ["301", "303"]) {
      const e = m.index.find((x) => x.label === l);
      const t = TRUTH.labels.find((x) => x.label === l);
      assert.deepStrictEqual(e, { label: l, category: "The Halton", conflict: null }, `${l}: a plain entry`);
      assert.strictEqual(e.category, t.truth, `${l}: settled RIGHT (the holding tile r0c1's read; ground_truth_p1.json)`);
    }
    assert.deepStrictEqual(m.counts.find((c) => c.category === "The Halton"), { category: "The Halton", n: 8, labels: ["281", "282", "283", "284", "301", "303", "312", "314"] }, "the Halton 8 — D7: an edge-settled label counts");
    assert.deepStrictEqual(m.counts.find((c) => c.category === "The Denby"), { category: "The Denby", n: 3, labels: ["302", "304", "313"] }, "the Denby unchanged (r0c0's out-of-bounds 302 / 304 were right reads r0c1 also made)");
    assert.deepStrictEqual(plain.counts.find((c) => c.category === "The Halton"), { category: "The Halton", n: 6, labels: ["281", "282", "283", "284", "312", "314"] }, "today: 6 (F-175)");
    assert.strictEqual(m.labels, plain.labels, "no label lost (132)");
    assert.strictEqual(m.labels, 132);
    const unanimousChanged = plain.index.filter((e) => !e.conflict).filter((e) => { const f = m.index.find((x) => x.label === e.label); return !f || f.category !== e.category || f.conflict; });
    assert.deepStrictEqual(unanimousChanged, [], "0 unanimous entries changed (§0g item 1)");
    assert.deepStrictEqual(m.counts.filter((c) => c.category !== "The Halton"), plain.counts.filter((c) => c.category !== "The Halton"), "every other category's count and plots identical");
    assert.strictEqual(m.pairs, plain.pairs, "every pair is still counted as read");
    assert.strictEqual(m.legendEchoes, plain.legendEchoes);
  });

  test("the callers without geometry are byte-identical to the served chunk but for T58's COUNTS rows and T59's range rules (subsumeRanges on the merge: the phantom 255 - 256 gone, the rented row naming its ranges — the design probe's arm B): mergeTiles(tiles, { key }) → detailChunkText reproduces production's page-1 detail chunk text (docVersion 7) in every other line, its rows the design probe's arm B of the served text (coded = measured); a plan without boxes, or boxes without a plan, or empty boxes change nothing", () => {
    const plain = d.mergeTiles(tiles, { key });
    assert.deepStrictEqual({ geometry: plain.geometry, dropped: plain.edgeDropped, settled: plain.edgeSettled, lost: plain.edgeLost, unpositioned: plain.unpositioned, multi: plain.multiValued }, { geometry: false, dropped: [], settled: [], lost: [], unpositioned: [], multi: [] });
    assert.ok(chunkText(plain).includes("\n255 - 256 | Affordable Housing Rented\n"), "the merge keeps every read — the phantom leaves only by subsumeRanges, on the final merge");
    assert.strictEqual(chunkText(d.subsumeRanges(plain)), armText59(stored.text, "B"), "byte for byte the chunk production served, the COUNTS rows as T58 writes them and T59's range rules");
    for (const opts of [{ key, tilePlan: plan }, { key, textBoxes: boxes }, { key, tilePlan: plan, textBoxes: [] }, { key, tilePlan: [], textBoxes: boxes }]) assert.strictEqual(chunkText(d.subsumeRanges(d.mergeTiles(tiles, opts))), armText59(stored.text, "B"), JSON.stringify(Object.keys(opts)));
  });

  test("the chunk text with the geometry (D6 a, D7, D11): `301 | The Halton` and `303 | The Halton` as plain entries — no mark, no note; `The Halton: 8 confirmed (281, 282, 283, 284, 301, 303, 312, 314)` (T58's row); `CONFLICTS: 8 — …` naming neither 301 nor 303; no MULTI-VALUED line; the KEY and every other line as served", () => {
    const m = d.subsumeRanges(d.mergeTiles(tiles, { key, tilePlan: plan, textBoxes: boxes }));
    const text = chunkText(m);
    const lines = text.split("\n");
    assert.ok(lines.includes("301 | The Halton") && lines.includes("303 | The Halton"));
    assert.ok(!lines.some((l) => /^(301|303) \|.* or /.test(l)), "neither is a conflict line");
    assert.ok(!/adjudicat|settled|tile edge/i.test(text), "D6 a: no mark the generator could echo — the audit trail is the metadata and the ledger");
    assert.ok(lines.includes("The Halton: 8 confirmed (281, 282, 283, 284, 301, 303, 312, 314)"));
    assert.ok(lines.includes("The Denby: 3 confirmed (302, 304, 313)"), "FQ06 / FQ11's count unchanged — and, 301 / 303 settled, no conflict names the Denby");
    const conflicts = lines.find((l) => l.startsWith("CONFLICTS: "));
    assert.strictEqual(conflicts, "CONFLICTS: 8 — 198 (The Radleigh or The Ellerton), 201 (The Radleigh or The Kingsville), 202 (The Radleigh or The Kingsville), 204 (The Kingsville or Affordable Housing Shared Ownership), 267 (The Kingsville or The Hesketh), 268 (The Kingsville or The Hesketh), 289 (The Alnmouth V1 or The Ennerdale), 296 (The Kingsville or The Hesketh)");
    assert.ok(!/\b30[13]\b/.test(conflicts), "the FS-2 false alarms are gone from the disclosure");
    assert.ok(!/^MULTI-VALUED:/m.test(text), "no same-tile multi-value on this page");
    assert.strictEqual(lines.filter((l) => /\(read differently by two tiles\)$/.test(l)).length, 8);
    // Against the served text: the KEY identical; the INDEX differs on exactly 301 and 303; the COUNTS (both in T58's rows) on the
    // Halton and the Denby rows only — 301 / 303 move from "possibly also" under both to the Halton's confirmed eight; the CONFLICTS line.
    assert.deepStrictEqual(section(text, "KEY"), section(stored.text, "KEY"));
    const idxNow = section(text, "INDEX"), idxWas = section(stored.text, "INDEX");
    assert.strictEqual(idxNow.length, idxWas.length - 1, "the INDEX keeps every label but the phantom (131 lines — T59 subsumes 255 - 256)");
    assert.deepStrictEqual(idxNow.filter((l) => !idxWas.includes(l)), ["301 | The Halton", "303 | The Halton"]);
    assert.deepStrictEqual(idxWas.filter((l) => !idxNow.includes(l)), ["255 - 256 | Affordable Housing Rented", "301 | The Denby or The Halton (read differently by two tiles)", "303 | The Denby or The Halton (read differently by two tiles)"].sort((a, b) => idxWas.indexOf(a) - idxWas.indexOf(b)));
    const cNow = section(text, "COUNTS"), cWas = section(armText59(stored.text, "B"), "COUNTS");
    assert.deepStrictEqual(cNow.filter((l) => !cWas.includes(l)), ["The Halton: 8 confirmed (281, 282, 283, 284, 301, 303, 312, 314)", "The Denby: 3 confirmed (302, 304, 313)"]);
    assert.deepStrictEqual(cWas.filter((l) => !cNow.includes(l)), ["The Halton: 6 confirmed (281, 282, 283, 284, 312, 314); possibly also 301, 303 (see CONFLICTS)", "The Denby: 3 confirmed (302, 304, 313); possibly also 301, 303 (see CONFLICTS)"]);
    assert.strictEqual(lines[0], stored.text.split("\n")[0], "the header (the humanTitle the lightbox captions) unchanged");
    assert.ok(text.length < d.DETAIL_MAX_CHARS, "one chunk");
  });

  test("a same-tile multi-value (F-188, D11) on Miele p68's recorded replies: the nine matrix rows one tile listed with two ✓ columns are MULTI-VALUED, not conflicts — `Automatic plus | No recommendation; Recommendation (two categories read on one tile)`, `CONFLICTS: 0`, `MULTI-VALUED: 9 — …`; counted for nobody (D7); SSX125's five stay disagreements", () => {
    const page = (file, no) => {
      const recs = OTHER.filter((r) => r.fileName === file && r.page === no);
      const k = d.parseKey(recs.find((r) => r.stage === "key").reply);
      const t = recs.filter((r) => r.stage === "index").sort((a, b) => a.figureId.localeCompare(b.figureId)).map((r) => ({ tile: r.figureId.replace(/^detail_\d+_/, ""), response: r.reply }));
      const m = d.mergeTiles(t, { key: k });
      return { k, m, text: d.detailChunkText({ title: "t", pageTitle: "p", page: no, kind: "keyed-index", key: k, merged: m }) };
    };
    const miele = page("Miele_washing_machine_manual.pdf", 68);
    assert.deepStrictEqual(miele.k.map((e) => e.name), ["Recommendation", "No recommendation", "Liquid detergent", "Powder detergent"]);
    assert.deepStrictEqual(miele.m.conflicts, []);
    assert.deepStrictEqual(miele.m.multiValued.map((c) => c.label), ["Automatic plus", "Clean machine", "Curtains", "Dark garments", "Denim", "Express 20", "First wash", "Minimum iron", "Trainers"], "production's nine 'conflicts' on this page (§0f)");
    assert.ok(miele.m.multiValued.every((c) => c.kind === "one tile, two categories" && c.categories.length === 2));
    assert.deepStrictEqual(miele.m.index.find((e) => e.label === "Express 20"), { label: "Express 20", category: null, conflict: ["No recommendation", "Liquid detergent"], kind: "one tile, two categories" }, "r0c0 and r1c0 both list the row twice with the same two categories");
    const lines = miele.text.split("\n");
    assert.ok(lines.includes("Automatic plus | No recommendation; Recommendation (two categories read on one tile)"));
    assert.ok(!lines.some((l) => /read differently by two tiles/.test(l)), "the untrue sentence is gone from this page");
    assert.ok(lines.includes("CONFLICTS: 0"));
    const mv = lines.find((l) => l.startsWith("MULTI-VALUED: "));
    assert.ok(mv.startsWith("MULTI-VALUED: 9 — Automatic plus (No recommendation; Recommendation), Clean machine (Powder detergent; No recommendation), "), mv);
    assert.strictEqual(lines.indexOf(mv), lines.indexOf("CONFLICTS: 0") + 1, "after CONFLICTS");
    assert.ok(!miele.m.counts.some((c) => c.labels.includes("Express 20")), "D7: a multi-value counts for nobody");
    assert.ok(miele.m.counts.some((c) => c.category === "Recommendation" && c.labels.includes("Cottons")), "a row listed twice with ONE category is a plain entry");
    for (const [no, want] of [[8, ["6", "8"]], [9, ["6"]], [20, ["6", "10"]]]) {
      const p = page("SSX125_Manual.pdf", no);
      assert.deepStrictEqual(p.m.conflicts.map((c) => c.label), want, `SSX125 p${no}: today's conflicts stay disagreements`);
      assert.ok(p.m.conflicts.every((c) => c.kind === "tiles disagree"));
      assert.deepStrictEqual(p.m.multiValued, []);
      assert.ok(!/MULTI-VALUED/.test(p.text));
    }
    assert.match(page("SSX125_Manual.pdf", 8).text, /^CONFLICTS: 2 — 6 \(M3x6mm #C-3002-30-06 or Flat Head Screw\), 8 \(M3x8mm #C-3002-30-08 or M3x8mm #C-3003-30-08 or Button Head Screw\)$/m);
  });

  test("conflictKind and detailGeometry", () => {
    const cats = (spec) => { const m = new Map(); for (const [cc, tiles] of Object.entries(spec)) m.set(cc, { category: cc, tiles }); return m; };
    assert.strictEqual(d.conflictKind(cats({ a: ["r0c0"], b: ["r0c1"] })), "tiles disagree");
    assert.strictEqual(d.conflictKind(cats({ a: ["r0c0"], b: ["r0c0"] })), "one tile, two categories");
    assert.strictEqual(d.conflictKind(cats({ a: ["r0c0", "r1c0"], b: ["r0c0", "r1c0"] })), "one tile, two categories", "two tiles, each listing both: the same set");
    assert.strictEqual(d.conflictKind(cats({ a: ["r0c0", "r0c1"], b: ["r0c0"] })), "tiles disagree", "one tile lists both, the other one: the sets differ");
    assert.strictEqual(d.conflictKind(cats({ a: ["r0c0", "r0c0"], b: ["r0c0"], c: ["r0c0"] })), "one tile, two categories");
    const reply = { status: "success", pagePt: POS.pagePt, px: [2084, 2947], grid: [2, 2], overlap: 0.1, textBoxes: boxes };
    const g = d.detailGeometry(reply);
    assert.deepStrictEqual(g.tilePlan.map((t) => t.tile), ["r0c0", "r0c1", "r1c0", "r1c1"]);
    assert.strictEqual(g.textBoxes, boxes);
    assert.ok(Math.abs(g.tilePlan[0].x1 - plan[0].x1) < 1e-9, "the plan over the page's points");
    assert.deepStrictEqual(d.detailGeometry({ ...reply, pagePt: null, textBoxes: null }), {}, "the picture path: no boxes, no geometry");
    assert.deepStrictEqual(d.detailGeometry({ ...reply, textBoxes: [] }), {}, "a page without a text layer");
    assert.deepStrictEqual(d.detailGeometry({ ...reply, pagePt: null, px: null }), {}, "no usable page size: no geometry, never a throw");
    assert.deepStrictEqual(d.detailGeometry(null), {});
    assert.strictEqual(d.detailGeometry({ ...reply, pagePt: null }).tilePlan[3].x1, 2084, "a picture with boxes (none today) would plan over its pixels");
  });
});

// T57 (t57-design.md §2.3, D7 a): the INDEX wording of a reading the page's colour contradicts — the tiles' reading
// first, then the colour at the label; the other kinds byte-identical to T45's.
describe("U-DETAIL/T57 (t57-design D7 a): the colour conflict's INDEX line and the one CONFLICTS line", () => {
  test("kind colour reads 'A or B (the colour at the label matches B, not A)'; a tile disagreement, a same-tile multi-value and a plain entry read as before", () => {
    assert.strictEqual(d.detailIndexLine({ label: "176", category: null, conflict: ["The Kingsville", "The Alnmouth"], kind: "colour" }), "176 | The Kingsville or The Alnmouth (the colour at the label matches The Alnmouth, not The Kingsville)");
    assert.strictEqual(d.detailIndexLine({ label: "198", category: null, conflict: ["The Radleigh", "The Ellerton"], kind: "tiles disagree" }), "198 | The Radleigh or The Ellerton (read differently by two tiles)");
    assert.strictEqual(d.detailIndexLine({ label: "Automatic plus", category: null, conflict: ["No recommendation", "Recommendation"], kind: "one tile, two categories" }), "Automatic plus | No recommendation; Recommendation (two categories read on one tile)");
    assert.strictEqual(d.detailIndexLine({ label: "302", category: "The Denby", conflict: null }), "302 | The Denby");
    const merged = { index: [{ label: "176", category: null, conflict: ["The Kingsville", "The Alnmouth"], kind: "colour" }, { label: "198", category: null, conflict: ["The Radleigh", "The Ellerton"], kind: "tiles disagree" }], counts: [], conflicts: [{ label: "176", categories: ["The Kingsville", "The Alnmouth"], kind: "colour" }, { label: "198", categories: ["The Radleigh", "The Ellerton"], kind: "tiles disagree" }], multiValued: [], unknown: [] };
    const text = d.detailChunkText({ title: "T", pageTitle: "P", page: 1, kind: "keyed-index", key: [{ attribute: "tan", name: "The Kingsville" }], merged });
    assert.match(text, /^CONFLICTS: 2 — 176 \(The Kingsville or The Alnmouth\), 198 \(The Radleigh or The Ellerton\)$/m, "one CONFLICTS line, the form every reader already knows");
    assert.ok(Object.keys(require("../../src/lib/ingestion/detail_pass.js")).includes("sameLine"), "T45's same-line rule is exported for the colour check");
  });
});

// T58 (design `inputs/rag-audit/t58-design.md`, D1 a / D2 a approved 2026-09-29; F-219): a keyed index's COUNTS say what they
// count. A conflicted label counts for nobody (T45 D7), so on a chunk with a conflict a count is a floor — measured before the
// code on production's own messages (§0e): a design's count question 0 of 8 answers right-shaped with the old rows, 8 of 8
// with these; the Denby and the Alnmouth unchanged. A chunk with no conflict is byte-identical.
describe("U-DETAIL/T58: the COUNTS rows on a chunk with a conflict — n confirmed, the labels that may also be it, an entry named only in conflicts, nothing else moves", () => {
  const T45 = path.join(REPO_ROOT, "tests", "eval", "baselines", "t45-artifacts", "probes", "records");
  const OTHER = JSON.parse(fs.readFileSync(path.join(T45, "memo-other-pages.json"), "utf8"));
  const page = (file, no) => {
    const recs = OTHER.filter((r) => r.fileName === file && r.page === no);
    const k = d.parseKey(recs.find((r) => r.stage === "key").reply);
    const t = recs.filter((r) => r.stage === "index").sort((a, b) => a.figureId.localeCompare(b.figureId)).map((r) => ({ tile: r.figureId.replace(/^detail_\d+_/, ""), response: r.reply }));
    return d.mergeTiles(t, { key: k });
  };

  test("no conflict: the rows as before T58, byte for byte (— or NONE); a same-tile multi-value is not a conflict (F-188)", () => {
    assert.deepStrictEqual(d.countsLines({ counts: [{ category: "A", n: 2, labels: ["1", "2"] }], conflicts: [] }), ["A: 2 (1, 2)"]);
    assert.deepStrictEqual(d.countsLines({ counts: [], conflicts: [] }), ["NONE"]);
    assert.deepStrictEqual(d.countsLines(null), ["NONE"]);
    assert.deepStrictEqual(d.countsLines({ counts: [{ category: "A", n: 1, labels: ["1"] }], conflicts: [{ label: "X", categories: ["A", "B"], kind: "one tile, two categories" }] }), ["A: 1 (1)"], "a multi-valued label is named on its own line (MULTI-VALUED), never as a possible reading");
    const miele = page("Miele_washing_machine_manual.pdf", 68);
    assert.deepStrictEqual(miele.conflicts, []);
    assert.deepStrictEqual(d.countsLines(miele), miele.counts.map((c) => `${c.category}: ${c.n} (${c.labels.join(", ")})`), "Miele p68 (nine multi-valued, no conflict) keeps its rows");
  });

  test("a conflict (either kind): each confirmed row \"n confirmed\", \"; possibly also … (see CONFLICTS)\" when a conflict names it; an entry named only in conflicts gets \"0 confirmed; possibly …\" after the confirmed rows, by name; a label under each of three categories; UNKNOWN never a row; the labels in label order", () => {
    const m = {
      counts: [{ category: "The Ellerton", n: 2, labels: ["172", "174"] }, { category: "The Denby", n: 1, labels: ["302"] }],
      conflicts: [{ label: "198", categories: ["The Radleigh", "The Ellerton"], kind: "tiles disagree" }, { label: "173", categories: ["The Alnmouth", "The Ellerton"], kind: "colour" }],
    };
    assert.deepStrictEqual(d.countsLines(m), [
      "The Ellerton: 2 confirmed (172, 174); possibly also 173, 198 (see CONFLICTS)",
      "The Denby: 1 confirmed (302)",
      "The Alnmouth: 0 confirmed; possibly 173 (see CONFLICTS)",
      "The Radleigh: 0 confirmed; possibly 198 (see CONFLICTS)",
    ]);
    const parts = {
      counts: [{ category: "Flat Head Screw", n: 1, labels: ["HEX FLAT HEAD SCREWS"] }],
      conflicts: [{ label: "10", categories: ["Socket Head Screw", "Button Head Screw"], kind: "tiles disagree" }, { label: "6", categories: ["Socket Head Screw", "Button Head Screw", "UNKNOWN"], kind: "tiles disagree" }],
    };
    assert.deepStrictEqual(d.countsLines(parts), ["Flat Head Screw: 1 confirmed (HEX FLAT HEAD SCREWS)", "Button Head Screw: 0 confirmed; possibly 6, 10 (see CONFLICTS)", "Socket Head Screw: 0 confirmed; possibly 6, 10 (see CONFLICTS)"]);
    assert.deepStrictEqual(d.countsLines({ counts: [], conflicts: [{ label: "5", categories: ["UNKNOWN", "unknown"], kind: "tiles disagree" }] }), ["NONE"], "a conflict between unknowns names no entry");
    // detailChunkText writes the rows under an unchanged COUNTS heading; the INDEX and CONFLICTS lines are T45 / T57's.
    const text = d.detailChunkText({ title: "T", pageTitle: "P", page: 2, kind: "keyed-index", key: [], merged: d.mergeTiles([{ tile: "r0c0", response: "1 | A\n2 | B" }, { tile: "r0c1", response: "2 | C" }]) });
    assert.deepStrictEqual(text.split("\n"), ["[VISUAL DETAIL: T | Section: P (Page 2)]:", "KEY: NONE", "INDEX:", "1 | A", "2 | B or C (read differently by two tiles)", "COUNTS:", "A: 1 confirmed (1)", "B: 0 confirmed; possibly 2 (see CONFLICTS)", "C: 0 confirmed; possibly 2 (see CONFLICTS)", "CONFLICTS: 1 — 2 (B or C)"]);
  });

  test("SSX125 pages 8, 9, 20 (production's three conflicted parts diagrams): the recorded merges' rows are the design's §0g — \"NONE\" becomes each part named only in a conflict, \"0 confirmed; possibly …\"; p8's label 8 under all three of its readings", () => {
    assert.deepStrictEqual(d.countsLines(page("SSX125_Manual.pdf", 8)), ["Button Head Screw: 0 confirmed; possibly 8 (see CONFLICTS)", "Flat Head Screw: 0 confirmed; possibly 6 (see CONFLICTS)", "M3x6mm #C-3002-30-06: 0 confirmed; possibly 6 (see CONFLICTS)", "M3x8mm #C-3002-30-08: 0 confirmed; possibly 8 (see CONFLICTS)", "M3x8mm #C-3003-30-08: 0 confirmed; possibly 8 (see CONFLICTS)"]);
    assert.deepStrictEqual(d.countsLines(page("SSX125_Manual.pdf", 9)), ["HEX BUTTON HEAD SCREWS: 0 confirmed; possibly 6 (see CONFLICTS)", "HEX FLAT HEAD SCREWS: 0 confirmed; possibly 6 (see CONFLICTS)"]);
    assert.deepStrictEqual(d.countsLines(page("SSX125_Manual.pdf", 20)), ["Flat Head Screw: 1 confirmed (HEX FLAT HEAD SCREWS)", "Button Head Screw: 0 confirmed; possibly 6, 10 (see CONFLICTS)", "Socket Head Screw: 0 confirmed; possibly 6, 10 (see CONFLICTS)"]);
  });
});

// T59 (design `inputs/rag-audit/t59-design.md`, D1 a / D2 a / D3 a approved 2026-09-29; F-222, F-218, F-225): a keyed
// index says what its RANGE labels are, a label a wider range of its category already names leaves (the phantom
// "255 - 256"), and the colour check places a printed range (U-COLOUR/T59). Offline, no pod: the pattern, the rule, the
// rows; production's recorded detail chunks (`t59-artifacts/records/details72.json`, read 2026-09-29) as the reach.
describe("U-DETAIL/T59: a range label is one label, said so in its row; a label a wider same-category range names is subsumed; nothing else moves", () => {
  const plain = (label, category) => ({ label, category, conflict: null });
  const mergeOf = (index) => {
    const per = new Map();
    for (const e of index) { if (e.conflict != null || /^unknown$/i.test(e.category)) continue; if (!per.has(e.category)) per.set(e.category, []); per.get(e.category).push(e.label); }
    const counts = [...per.entries()].map(([category, ls]) => ({ category, n: ls.length, labels: ls.slice().sort(d.labelOrder) })).sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
    return { index, counts, conflicts: index.filter((e) => e.conflict).map((e) => ({ label: e.label, categories: e.conflict, kind: e.kind })), multiValued: [], unknown: [], labels: index.length };
  };

  test("the pattern: exactly two whole numbers joined by a dash, the first the smaller — never a part number, a name or a reversed pair", () => {
    for (const r of ["220 - 237", "220-237", "220 – 237", "1-2"]) assert.strictEqual(d.isRangeLabel(r), true, r);
    for (const n of ["ECO 40-60", "C-00105-018", "C-3001-30-10 M3x10mm - DIN912", "237 - 220", "5 - 5", "220 - 237 a", "A - B", "256", "", null]) assert.strictEqual(d.isRangeLabel(n), false, String(n));
    assert.deepStrictEqual(d.labelSpan("255 - 266"), { a: 255, b: 266, range: true });
    assert.deepStrictEqual(d.labelSpan("256"), { a: 256, b: 256, range: false });
    assert.strictEqual(d.labelSpan("M3x6mm"), null);
  });

  test("subsumeRanges: a plain label wholly inside a wider range of its category leaves — the phantom 255 - 256, a single number inside a range; never across categories, never a conflict, never UNKNOWN; the same object when nothing moves", () => {
    const m = mergeOf([plain("254", "S"), plain("255 - 256", "R"), plain("255 - 266", "R"), plain("260", "R"), plain("261", "S"), plain("270", "R")]);
    const s = d.subsumeRanges(m);
    assert.deepStrictEqual(s.rangeSubsumed, [{ label: "255 - 256", by: "255 - 266", category: "R" }, { label: "260", by: "255 - 266", category: "R" }]);
    assert.deepStrictEqual(s.index.map((e) => e.label), ["254", "255 - 266", "261", "270"], "261 is another category's — kept");
    assert.deepStrictEqual(s.counts, [{ category: "R", n: 2, labels: ["255 - 266", "270"] }, { category: "S", n: 2, labels: ["254", "261"] }], "the counts recomputed as mergeTiles computes them");
    assert.strictEqual(s.labels, 4);
    assert.strictEqual(m.index.length, 6, "the input is not mutated");
    const conflict = mergeOf([plain("255 - 266", "R"), { label: "256", category: null, conflict: ["R", "S"], kind: "tiles disagree" }]);
    assert.strictEqual(d.subsumeRanges(conflict), conflict, "a conflict is never dropped: the same object");
    const unknown = mergeOf([plain("255 - 266", "R"), plain("256", "UNKNOWN")]);
    assert.strictEqual(d.subsumeRanges(unknown), unknown);
    const equal = mergeOf([plain("1 - 5", "R"), plain("1-5", "R")]);
    assert.strictEqual(d.subsumeRanges(equal), equal, "only a STRICTLY wider range subsumes");
    const none = mergeOf([plain("172", "A"), plain("173", "B")]);
    assert.strictEqual(d.subsumeRanges(none), none, "a merge without a range: the same object — every such chunk byte-identical");
    assert.strictEqual(d.subsumeRanges(null), null);
  });

  test("the rows: a confirmed range named with its size, a possible range named apart; both row shapes; one, two and three ranges; a row without a range byte-identical", () => {
    assert.deepStrictEqual(d.countsLines(mergeOf([plain("1", "A"), plain("2", "A")])), ["A: 2 (1, 2)"], "no range: T58's rows byte for byte");
    assert.deepStrictEqual(d.countsLines(mergeOf([plain("1", "A"), plain("5 - 9", "A")])), ["A: 2 (1, 5 - 9); 1 of the 2 is a range counted as one label — 5 - 9 (5 numbers); a range's category was read once for the range, not for each number"], "the no-conflict shape");
    assert.deepStrictEqual(d.countsLines(mergeOf([plain("1 - 3", "A"), plain("5 - 9", "A"), plain("10 - 11", "A")])), ["A: 3 (1 - 3, 5 - 9, 10 - 11); 3 of the 3 are ranges counted as one label each — 1 - 3 (3 numbers), 5 - 9 (5 numbers) and 10 - 11 (2 numbers); a range's category was read once for the range, not for each number"]);
    const e = mergeOf([plain("185", "R"), plain("255 - 266", "R"), plain("186", "S"), { label: "220 - 237", category: null, conflict: ["R", "S"], kind: "colour" }, { label: "182", category: null, conflict: ["K", "R"], kind: "colour" }]);
    assert.deepStrictEqual(d.countsLines(e), [
      "R: 2 confirmed (185, 255 - 266); possibly also 182, 220 - 237 (see CONFLICTS); 1 of the 2 is a range counted as one label — 255 - 266 (12 numbers); a range's category was read once for the range, not for each number; 220 - 237 (a range of 18 numbers counted as one label) is among the possible labels",
      "S: 1 confirmed (186); possibly also 220 - 237 (see CONFLICTS); 220 - 237 (a range of 18 numbers counted as one label) is among the possible labels",
      "K: 0 confirmed; possibly 182 (see CONFLICTS)",
    ], "arm E's shape (t59-design §0g): a confirmed range, a possible range, a 0-confirmed row");
    assert.deepStrictEqual(d.countsLines(mergeOf([{ label: "1 - 4", category: null, conflict: ["A", "B"], kind: "tiles disagree" }])), ["A: 0 confirmed; possibly 1 - 4 (see CONFLICTS); 1 - 4 (a range of 4 numbers counted as one label) is among the possible labels", "B: 0 confirmed; possibly 1 - 4 (see CONFLICTS); 1 - 4 (a range of 4 numbers counted as one label) is among the possible labels"]);
  });

  test("the reach: of production's 36 recorded detail chunks only the Site Plan's page 1 holds a range label — the rules cannot move another chunk; its INDEX, then the rule, gives the measured rows", () => {
    const rec = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "t59-artifacts", "records", "details72.json"), "utf8"));
    assert.strictEqual(rec.chunks.length, 36);
    const withRange = rec.chunks.filter((c) => { const ls = c.text.split("\n"); const i = ls.indexOf("INDEX:"), j = ls.indexOf("COUNTS:"); return i >= 0 && ls.slice(i + 1, j).some((l) => d.isRangeLabel(l.slice(0, l.indexOf(" | ")))); });
    assert.deepStrictEqual(withRange.map((c) => `${c.source} p${c.page}`), ["Barratt_Homes_SitePlan.pdf p1"]);
    const p1 = withRange[0].text.split("\n");
    assert.deepStrictEqual(p1.slice(p1.indexOf("INDEX:") + 1, p1.indexOf("COUNTS:")).map((l) => l.slice(0, l.indexOf(" | "))).filter(d.isRangeLabel), ["220 - 237", "255 - 256", "255 - 266"]);
  });
});

// T60 (design `inputs/rag-audit/t60-design.md`, D1 a / D2 a / D3–D6 approved 2026-09-29; F-228): a keyed index's COUNTS
// rows added up by the text the page's legend prints with each name ("5 bedroom home" — the colour check reads it from the
// legend's own blocks, U-COLOUR/T60), and its CONFLICTS line saying what its labels name when one is a range. Offline, no
// pod: the block, the clause, the chunk's order, and the reach over production's recorded detail chunks.
describe("U-DETAIL/T60: the LEGEND TEXT block adds the rows up by the legend's own text; the CONFLICTS line says what its labels name; a chunk without either is byte-identical", () => {
  const merged = {
    counts: [{ category: "K", n: 21, labels: [] }, { category: "E", n: 11, labels: [] }, { category: "R", n: 24, labels: [] }, { category: "M", n: 4, labels: [] }, { category: "D", n: 3, labels: [] }],
    conflicts: [
      { label: "180", categories: ["A", "M"], kind: "colour" },
      { label: "173", categories: ["N", "E"], kind: "colour" },
      { label: "9", categories: ["K", "UNKNOWN"], kind: "tiles disagree" },
      { label: "Z", categories: ["D", "M"], kind: "one tile, two categories" },
    ],
  };
  const texts = { K: "4 bedroom home", E: "3 bedroom home", D: "3 bedroom home", M: "5 bedroom home", A: "4 bedroom home", N: "4 bedroom home", R: "" };

  test("legendTextLines: a group per shared text in numeric text order — its rows (COUNTS order, then the names only a conflict names, at 0) added up, its possible labels counted in label order (UNKNOWN and a same-tile multi-value never); the groups' total; the names the legend prints alone; the names with no text read", () => {
    assert.deepStrictEqual(d.legendTextLines(merged, texts), [
      d.LEGEND_TEXT_HEAD,
      "3 bedroom home: 14 confirmed (E 11, D 3); possibly also 1 more: 173 (see CONFLICTS)",
      "4 bedroom home: 21 confirmed (K 21, A 0, N 0); possibly also 3 more: 9, 173, 180 (see CONFLICTS)",
      "5 bedroom home: 4 confirmed (M 4); possibly also 1 more: 180 (see CONFLICTS)",
      "the 3 groups together: 39 confirmed",
      "the legend prints the name alone: R",
    ]);
    const { D: _unread, ...lessD } = texts;
    assert.deepStrictEqual(d.legendTextLines(merged, lessD).slice(1), [
      "3 bedroom home: 11 confirmed (E 11); possibly also 1 more: 173 (see CONFLICTS)",
      "4 bedroom home: 21 confirmed (K 21, A 0, N 0); possibly also 3 more: 9, 173, 180 (see CONFLICTS)",
      "5 bedroom home: 4 confirmed (M 4); possibly also 1 more: 180 (see CONFLICTS)",
      "the 3 groups together: 36 confirmed",
      "the legend prints the name alone: R",
      "no legend text read: D",
    ], "a name whose block did not begin with it is never said to print alone");
    assert.deepStrictEqual(d.legendTextLines({ counts: [{ category: "P", n: 2 }, { category: "Q", n: 1 }, { category: "S", n: 5 }], conflicts: [] }, { P: "10 x", Q: "10 x", S: "9 x" }), [d.LEGEND_TEXT_HEAD, "9 x: 5 confirmed (S 5)", "10 x: 3 confirmed (P 2, Q 1)", "the 2 groups together: 8 confirmed"], "numeric order; a conflict-free page has no possibles");
    assert.strictEqual(d.LEGEND_TEXT_HEAD, "LEGEND TEXT (what the page's legend prints with each name; a group's count adds up its names' confirmed counts above):");
  });

  test("no block: no legend text, no text shared by two rows, every name printed alone — [] and the chunk byte-identical", () => {
    for (const t of [null, undefined, {}, "4 bedroom home", { K: "a", E: "b", R: "c", M: "d", D: "e" }, { K: "", E: "", R: "", M: "", D: "" }, { K: "4 bedroom home" }]) assert.deepStrictEqual(d.legendTextLines(merged, t), [], JSON.stringify(t));
    assert.deepStrictEqual(d.legendTextLines(null, texts), []);
    const m = d.mergeTiles([{ tile: "r0c0", response: "1 | A\n2 | B" }, { tile: "r0c1", response: "2 | C" }]);
    const base = { title: "T", pageTitle: "P", page: 2, kind: "keyed-index", key: [], merged: m };
    const plain = d.detailChunkText(base);
    for (const legendText of [null, {}, { A: "x", B: "y", C: "" }]) assert.strictEqual(d.detailChunkText({ ...base, legendText }), plain, JSON.stringify(legendText));
    assert.strictEqual(d.detailChunkText({ ...base, kind: "transcribe", merged: null, transcription: d.mergeTranscriptions([]), legendText: texts }), d.detailChunkText({ ...base, kind: "transcribe", merged: null, transcription: d.mergeTranscriptions([]) }), "a transcription has no rows to group");
  });

  test("conflictsRangeNote: \"\" without a range, or with a label that is not a number; one, two and three ranges; a lone conflicted label", () => {
    for (const cs of [null, [], [{ label: "1" }, { label: "2" }], [{ label: "5 - 9" }, { label: "M3x6mm" }], [{ label: "5 - 9" }, null]]) assert.strictEqual(d.conflictsRangeNote(cs), "", JSON.stringify(cs));
    assert.strictEqual(d.conflictsRangeNote([{ label: "172" }, { label: "5 - 9" }, { label: "12" }]), "; 1 of the 3 is a range counted as one label — 5 - 9 (5 numbers); the 3 labels name 7 numbers");
    assert.strictEqual(d.conflictsRangeNote([{ label: "1 - 3" }, { label: "5 - 9" }, { label: "12" }, { label: "14" }]), "; 2 of the 4 are ranges counted as one label each — 1 - 3 (3 numbers) and 5 - 9 (5 numbers); the 4 labels name 10 numbers");
    assert.strictEqual(d.conflictsRangeNote([{ label: "1 - 3" }, { label: "5 - 9" }, { label: "10 - 11" }]), "; 3 of the 3 are ranges counted as one label each — 1 - 3 (3 numbers), 5 - 9 (5 numbers) and 10 - 11 (2 numbers); the 3 labels name 10 numbers");
    assert.strictEqual(d.conflictsRangeNote([{ label: "3 - 6" }]), "; 1 of the 1 is a range counted as one label — 3 - 6 (4 numbers); the 1 label names 4 numbers");
  });

  test("the chunk: the block after the COUNTS rows, before UNKNOWN and CONFLICTS (one group: no total line); the CONFLICTS line ends with the clause", () => {
    const m = d.mergeTiles([{ tile: "r0c0", response: "1 | A\n2 | B\n3 - 6 | A\n7 | UNKNOWN" }, { tile: "r0c1", response: "3 - 6 | B" }]);
    const text = d.detailChunkText({ title: "T", pageTitle: "P", page: 2, kind: "keyed-index", key: [], merged: m, legendText: { A: "2 x", B: "2 x" } });
    assert.deepStrictEqual(text.split("\n"), [
      "[VISUAL DETAIL: T | Section: P (Page 2)]:", "KEY: NONE", "INDEX:", "1 | A", "2 | B", "3 - 6 | A or B (read differently by two tiles)", "7 | UNKNOWN",
      "COUNTS:", "A: 1 confirmed (1); possibly also 3 - 6 (see CONFLICTS); 3 - 6 (a range of 4 numbers counted as one label) is among the possible labels", "B: 1 confirmed (2); possibly also 3 - 6 (see CONFLICTS); 3 - 6 (a range of 4 numbers counted as one label) is among the possible labels",
      d.LEGEND_TEXT_HEAD, "2 x: 2 confirmed (A 1, B 1); possibly also 1 more: 3 - 6 (see CONFLICTS)",
      "UNKNOWN: 1 (7)", "CONFLICTS: 1 — 3 - 6 (A or B); 1 of the 1 is a range counted as one label — 3 - 6 (4 numbers); the 1 label names 4 numbers",
    ]);
  });

  test("the reach: of production's 36 recorded detail chunks (v11) no CONFLICTS line names a range — the clause moves none of them; T59's page 1 (v12) is the one whose line gains it; SSX125 p8's one legend swatch prints its name alone — no block", () => {
    const conflictLabels = (text) => { const l = text.split("\n").find((x) => x.startsWith("CONFLICTS: ")); return l && l.includes(" — ") ? [...l.slice(l.indexOf(" — ") + 3).matchAll(/(?:^|, )([^()]+?) \([^()]*\)/g)].map((x) => x[1]) : []; };
    const rec = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "t59-artifacts", "records", "details72.json"), "utf8"));
    assert.strictEqual(rec.chunks.length, 36);
    const withConflicts = rec.chunks.filter((c) => conflictLabels(c.text).length);
    assert.deepStrictEqual(withConflicts.map((c) => `${c.source} p${c.page} ${conflictLabels(c.text).length}`), ["Barratt_Homes_SitePlan.pdf p1 24", "SSX125_Manual.pdf p8 2", "SSX125_Manual.pdf p9 1", "SSX125_Manual.pdf p20 2"]);
    for (const c of withConflicts) assert.strictEqual(d.conflictsRangeNote(conflictLabels(c.text).map((label) => ({ label }))), "", `${c.source} p${c.page}`);
    const v12 = fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "t59-artifacts", "records", "after59-p1.txt"), "utf8");
    const labels = conflictLabels(v12);
    assert.strictEqual(labels.length, 25);
    assert.strictEqual(d.conflictsRangeNote(labels.map((label) => ({ label }))), "; 1 of the 25 is a range counted as one label — 220 - 237 (18 numbers); the 25 labels name 42 numbers");
    const recs = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "t45-artifacts", "probes", "records", "memo-other-pages.json"), "utf8")).filter((r) => r.fileName === "SSX125_Manual.pdf" && r.page === 8);
    const p8 = d.mergeTiles(recs.filter((r) => r.stage === "index").sort((a, b) => a.figureId.localeCompare(b.figureId)).map((r) => ({ tile: r.figureId.replace(/^detail_\d+_/, ""), response: r.reply })), { key: d.parseKey(recs.find((r) => r.stage === "key").reply) });
    assert.deepStrictEqual(d.legendTextLines(p8, { "M3x8mm #C-3003-30-08": "" }), [], "the check's legend text on p8 (U-COLOUR/T60)");
  });
});
