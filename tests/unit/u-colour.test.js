/**
 * U-COLOUR — T57's disclose-only colour check (design `inputs/rag-audit/t57-design.md`, D1–D9 approved 2026-09-28;
 * `src/lib/ingestion/colour_check.js`; F-215). Offline, no pod, no model:
 *   - the Site Plan's page 1 as the product holds it: the memo's recorded KEY and INDEX replies (T45's
 *     `memo-p1.json`) merged by `mergeTiles` over the bridge's word layer — byte for byte the chunk production stores
 *     (`t56-artifacts/records/index56.json`) — then checked against the page's colour layer (`layer57-p1.json`, equal to
 *     the bridge's `--colours` reply, t57-design §4.1);
 *   - coded = measured: every row equal to the design probe's (`check57-p1.json`);
 *   - the chunk after the check (`after57-p1-product.txt`) and the census's own rules on it (`compare56.js`'s parse)
 *     against the frozen truth (`t56-artifacts/truth56.json`, 5816d47): 22 → 3 unhedged wrong, 0 readings replaced;
 *   - production's other colour-key pages (SSX125 p5 / p8 / p9) and the spurious white box of Miele p14 — nothing moves;
 *   - small synthetic pages for every branch; the purity pin.
 * T58 (design `t58-design.md` D1 a, D2 a; F-219): the chunk's COUNTS rows say what they count — the stored v9 chunk and
 * production's v10 chunk are pinned in every line but those rows, and the rows are the design probe's arm B of them
 * (`t58-artifacts/probes/counts58.js` — coded = measured); the chunk after the check is `after58-p1.txt`.
 * T59 (design `t59-design.md` D1 a, D2 a, D3 a; F-222, F-218, F-225): the colour check places a range label as the page
 * prints it (220 - 237 disclosed, 255 - 266 confirmed — the probe's rows, `t59-artifacts/records/f225-probe.json`), a label
 * a wider same-category range names is subsumed, and a row says what its ranges are: the chunk after the check and
 * `subsumeRanges` is `after59-p1.txt` — the design probe's arm E, measured (`t59-artifacts/probes/blocks59.js`).
 * T60 (design `t60-design.md` D1 a, D2 a; F-228): the check returns the text the legend prints with each matched name
 * (`legendTextOf` — "5 bedroom home"), and the chunk adds its rows up by it and says what its CONFLICTS labels name: the
 * chunk after the check, `subsumeRanges` and the legend text is `after60-p1.txt` — the design probe's arm D, measured
 * (`t60-artifacts/probes/bands60.js`).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const d = require("../../src/lib/ingestion/detail_pass.js");
const c = require("../../src/lib/ingestion/colour_check.js");

const B = path.join(REPO_ROOT, "tests", "eval", "baselines");
const T57 = path.join(B, "t57-artifacts", "records");
const json = (...p) => JSON.parse(fs.readFileSync(path.join(...p), "utf8"));
const { armText } = require(path.join(B, "t58-artifacts", "probes", "counts58.js"));
const { armText: armText59 } = require(path.join(B, "t59-artifacts", "probes", "blocks59.js"));
const { armText: armText60, LEGEND_TEXT } = require(path.join(B, "t60-artifacts", "probes", "bands60.js"));

describe("U-COLOUR (t57-design §0, §2.2): the colour check on the Site Plan's page 1 — 22 silent wrong readings → 3, nothing replaced, 4 tile conflicts settled right", () => {
  const LAYER = json(T57, "layer57-p1.json");
  const MEASURED = json(T57, "check57-p1.json");
  const TRUTH = json(B, "t56-artifacts", "truth56.json");
  const STORED = json(B, "t56-artifacts", "records", "index56.json").chunks.find((x) => x.chunkIndex === 15).text;
  const AFTER = fs.readFileSync(path.join(T57, "after57-p1-product.txt"), "utf8").replace(/\n$/, "");
  const AFTER58 = fs.readFileSync(path.join(B, "t58-artifacts", "records", "after58-p1.txt"), "utf8").replace(/\n$/, "");
  const AFTER59 = fs.readFileSync(path.join(B, "t59-artifacts", "records", "after59-p1.txt"), "utf8").replace(/\n$/, "");
  const AFTER60 = fs.readFileSync(path.join(B, "t60-artifacts", "records", "after60-p1.txt"), "utf8").replace(/\n$/, "");
  const T59ROWS = json(B, "t59-artifacts", "records", "f225-probe.json").rows;
  const MEMO = json(B, "t45-artifacts", "probes", "records", "memo-p1.json");
  const key = d.parseKey(MEMO.find((r) => r.stage === "key").reply);
  const tiles = MEMO.filter((r) => r.stage === "index").sort((a, b) => a.figureId.localeCompare(b.figureId)).map((r) => ({ tile: r.figureId.replace("detail_1_", ""), response: r.reply }));
  const merged = d.mergeTiles(tiles, { key, tilePlan: d.tilePlan(LAYER.pagePt), textBoxes: LAYER.words });
  const header = STORED.split("\n")[0].match(/^\[VISUAL DETAIL: (.*) \| Section: (.*) \(Page 1\)\]:$/);
  const chunkText = (m, legendText = null) => d.detailChunkText({ title: header[1], pageTitle: header[2], page: 1, kind: "keyed-index", key, merged: m, legendText });
  const checked = c.colourCheck(merged, { key, layer: LAYER });
  const rowOf = (label) => checked.audit.rows.find((r) => r.label === label);
  // compare56.js's own reading of a chunk (the census's standing check), line for line.
  const census = (text) => {
    const lines = {};
    for (const l of text.split("\n")) { const m = /^\s*(\d{3})\s*\|\s*(.+?)\s*$/.exec(l); if (m) lines[m[1]] = m[2]; }
    const conflicts = {};
    const cm = /CONFLICTS: \d+ — (.*)$/m.exec(text);
    if (cm) for (const m of cm[1].matchAll(/(\d{3}) \(([^)]+)\)/g)) conflicts[m[1]] = m[2].split(" or ");
    const out = { right: 0, wrong: [], conflictsWithTruth: 0, conflictsWithoutTruth: [], missing: 0 };
    for (const [plot, t] of Object.entries(TRUTH.plots)) {
      if (conflicts[plot]) { if (conflicts[plot].includes(t.design)) out.conflictsWithTruth++; else out.conflictsWithoutTruth.push(plot); continue; }
      if (!lines[plot]) out.missing++;
      else if (lines[plot] === t.design) out.right++;
      else out.wrong.push(plot);
    }
    return out;
  };

  test("the fixtures: the page's layer (567 words with their font sizes, 1,138 filled paths in 37 fills, the pixel counts at 3.5 / 3 pt / 12); the KEY of 18; the truth's 129 plots; the stored v9 chunk of 5,214 characters", () => {
    assert.deepStrictEqual(LAYER.pagePt.map((v) => Math.round(v * 100) / 100), [595.28, 841.89]);
    assert.strictEqual(LAYER.words.length, 567);
    assert.strictEqual(LAYER.paths.length, 1138);
    assert.strictEqual(new Set(LAYER.paths.map((p) => p.rgb.join(","))).size, 37);
    assert.deepStrictEqual({ s: LAYER.pixels.scale, m: LAYER.pixels.marginPt, t: LAYER.pixels.tol, f: LAYER.pixels.fills.length, w: LAYER.pixels.words.length }, { s: 3.5, m: 3, t: 12, f: 37, w: 567 });
    assert.strictEqual(key.length, 18);
    assert.strictEqual(Object.keys(TRUTH.plots).length, 129);
    assert.strictEqual(STORED.length, 5214);
  });

  test("the input is the product's own: mergeTiles over the memo's replies and the layer's words writes production's stored v9 chunk in every line but its COUNTS rows, which read as T59 writes them (the phantom 255 - 256 subsumed; the rented row naming its ranges) — T59's design probe's arm B of the stored text, byte for byte (T45's seven edge drops, 301 / 303 settled)", () => {
    assert.strictEqual(chunkText(d.subsumeRanges(merged)), armText59(STORED, "B"));
    assert.deepStrictEqual(d.subsumeRanges(merged).rangeSubsumed, [{ label: "255 - 256", by: "255 - 266", category: "Affordable Housing Rented" }], "F-218: exactly the phantom");
    assert.strictEqual(merged.edgeDropped.length, 7);
    assert.deepStrictEqual(merged.edgeSettled, ["301", "303"]);
  });

  test("the legend (D5): all fourteen colour entries matched to their exact legend fills from the page alone — the Alnmouth / Alnmouth V1 pair and the two tenures by elimination; the four letter entries are not colour entries", () => {
    const expected = {
      "The Ellerton": [166, 166, 224], "The Ennerdale": [163, 191, 217], "The Denby": [194, 46, 77], "The Alnmouth": [255, 222, 135], "The Alnmouth V1": [105, 163, 212],
      "The Radleigh": [138, 191, 99], "The Kingsville": [194, 168, 105], "The Hesketh": [56, 79, 166], "The Chester": [250, 222, 0], "The Alderney": [102, 171, 176],
      "The Halton": [217, 161, 222], "The Malvern": [140, 217, 232], "Affordable Housing Shared Ownership": [194, 194, 194], "Affordable Housing Rented": [107, 107, 107],
    };
    assert.ok(c.keyNamesColour(key));
    const legend = c.legendSwatches(key, LAYER.words, LAYER.paths);
    assert.deepStrictEqual(Object.fromEntries([...legend.swatches].map(([n, s]) => [n, s.rgb])), expected);
    assert.strictEqual(legend.swatches.get("The Alnmouth V1").block, "The Alnmouth V1 4 bedroom home");
    assert.strictEqual(legend.swatches.get("Affordable Housing Shared Ownership").block, "Affordable Housing Shared Ownership");
    assert.deepStrictEqual(legend.audit.filter((a) => !a.matched).map((a) => `${a.attribute} | ${a.name}: ${a.why}`), ["CS | Cycle Store: attribute names no colour", "BS | Bin Store: attribute names no colour", "V | Visitor Parking Space: attribute names no colour", "BCP | Bin Collection Point: attribute names no colour"]);
    assert.deepStrictEqual(checked.audit.matched.slice().sort(), Object.keys(expected).sort());
  });

  test("the label's point (D6): every one of the 129 plot labels is one cluster (2, 3 or 5 occurrences with its bays) and its own occurrence is the one 3.33 pt label; the range labels have no occurrence", () => {
    const occurrences = {};
    for (const plot of Object.keys(TRUTH.plots)) {
      const pt = c.labelPoint(LAYER.words, plot);
      assert.ok(pt.own, `${plot}: ${pt.why}`);
      assert.strictEqual(pt.own.length, 1, `${plot}: one own occurrence`);
      assert.strictEqual(pt.own[0].size, 3.33, `${plot}: the 3.33 pt plot label, never a 2.22 pt bay`);
      occurrences[pt.occurrences] = (occurrences[pt.occurrences] || 0) + 1;
    }
    assert.deepStrictEqual(occurrences, { 2: 5, 3: 117, 5: 7 });
    for (const range of ["220 - 237", "255 - 256", "255 - 266"]) assert.deepStrictEqual(c.labelPoint(LAYER.words, range), { why: "no occurrence" });
  });

  test("coded = measured: every one of the 132 rows equals the design probe's (check57-p1.json), the three range labels T59's (f225-probe.json — placed as the page prints them) — the verdict, the reason, the disclosed pair, the settlement, and the evidence with its distances and pixel shares", () => {
    const proj = (r) => JSON.stringify([r.label, r.verdict, r.why || null, r.disclosed || null, r.resolvedTo || null, (r.present || []).map((p) => [p.design, p.d, p.share ?? null])]);
    assert.strictEqual(checked.audit.rows.length, 132);
    assert.strictEqual(MEASURED.rows.length, 132);
    for (let i = 0; i < 132; i++) {
      const t59 = T59ROWS.find((r) => r.label === MEASURED.rows[i].label);
      const want = t59 ? { label: t59.label, verdict: t59.verdict, why: t59.why, disclosed: t59.disclosed, present: t59.present } : MEASURED.rows[i];
      assert.strictEqual(proj(checked.audit.rows[i]), proj(want), `row ${i} (${MEASURED.rows[i].label})`);
    }
    assert.deepStrictEqual(T59ROWS.map((r) => [r.label, r.verdict]), [["220 - 237", "flagged"], ["255 - 256", "unchecked"], ["255 - 266", "confirmed"]]);
    assert.deepStrictEqual(MEASURED.params, { SWATCH_MIN: 3, SWATCH_MAX: 20, SWATCH_ASPECT: 2, SWATCH_GAP: 2, TOUCH: 0.3, MIN_AREA: 10, R: 10, PIX_SHARE: 0.2, CLUSTER_HALF: 40, PIXELS: "always", ALT: "nearest", NO_EVIDENCE: "unchecked", COLOUR_GUARD: true }, "the recommended rule the owner approved (D1–D9)");
  });

  test("the verdicts: 101 confirmed (the Denby's 302 / 304 / 313 and T59's 255 - 266 among them); 21 disclosed (T59's 220 - 237 among them); 4 tile conflicts settled, 4 left; 217 left as read (no key colour near it — D2 a); the pixels read exactly the four raster buildings", () => {
    const a = checked.audit;
    assert.deepStrictEqual({ ran: a.ran, swatches: a.swatches, checked: a.checked, confirmed: a.confirmed }, { ran: true, swatches: 14, checked: 130, confirmed: 101 });
    assert.deepStrictEqual(a.flagged, ["173", "176", "177", "180", "182", "183", "184", "218", "220 - 237", "240", "246", "249", "277", "280", "305", "309", "310", "311", "315", "316", "317"]);
    assert.deepStrictEqual(a.settled, ["201", "202", "204", "289"]);
    assert.deepStrictEqual(a.left, ["198", "267", "268", "296"]);
    assert.deepStrictEqual(a.unchecked, { "not printed as a range on one line": 1, "no key colour at the label": 1 }, "T59: the two printed ranges are checked; the phantom 255 - 256 is not a printed range");
    assert.strictEqual(rowOf("217").why, "no key colour at the label");
    for (const denby of ["302", "304", "313"]) assert.strictEqual(rowOf(denby).verdict, "confirmed", `${denby}: the Denby stays`);
    assert.deepStrictEqual(a.rows.filter((r) => (r.present || []).some((p) => p.share !== undefined)).map((r) => `${r.label} ${r.present.filter((p) => p.share !== undefined).map((p) => `${p.design} ${p.share}`).join(", ")}`), ["220 - 237 Affordable Housing Shared Ownership 0.265", "238 Affordable Housing Rented 0.329", "239 Affordable Housing Rented 0.348", "240 Affordable Housing Rented 0.313", "254 Affordable Housing Shared Ownership 0.583", "255 - 266 Affordable Housing Rented 0.505"]);
    assert.deepStrictEqual(rowOf("220 - 237").disclosed, ["Affordable Housing Rented", "Affordable Housing Shared Ownership"], "T59 (F-225): the block's own label sits on Shared Ownership's grey — disclosed, never replaced");
    assert.deepStrictEqual(rowOf("240").disclosed, ["The Kingsville", "Affordable Housing Rented"], "a raster building under the label: its pixels name the truth first");
    assert.deepStrictEqual(rowOf("176").disclosed, ["The Kingsville", "The Alnmouth"]);
  });

  test("never a replaced reading (the owner's D1): every disclosed pair starts with the tiles' own reading; every plain entry after the check is the plain entry before it or one of a settled conflict's two readings; the index keeps every label in order", () => {
    const before = new Map(merged.index.map((e) => [e.label, e]));
    assert.deepStrictEqual(checked.merged.index.map((e) => e.label), merged.index.map((e) => e.label));
    for (const e of checked.merged.index) {
      const b = before.get(e.label);
      if (e.kind === "colour") { assert.strictEqual(e.conflict[0], b.category, `${e.label}: the reading first`); assert.strictEqual(e.category, null); continue; }
      if (e.conflict == null && b.conflict != null) { assert.ok(b.conflict.includes(e.category), `${e.label}: settled to one of the two tiles' readings`); continue; }
      assert.deepStrictEqual(e, b, `${e.label}: unchanged`);
    }
    assert.ok(checked.merged !== merged && merged.index.every((e) => e.kind !== "colour"), "the input merge is not mutated");
  });

  test("the chunk after the check, subsumeRanges and the legend text is after60-p1.txt byte for byte (T60) — 9,408 characters, one chunk: T59's after59-p1.txt (8,483) with the LEGEND TEXT block after the COUNTS rows and the CONFLICTS line's range clause (T60's arm D, measured); before it T59's: T58's after58-p1.txt (7,964) with the phantom 255 - 256 gone, 220 - 237 disclosed and the rows naming their ranges (T59's arm E, measured); before it T58's: production's v10 chunk (after57-p1-product.txt) in every line but the COUNTS rows, which are the design probe's arm B of it (coded = measured); the Denby 3 and the Halton 8 confirmed; the Kingsville 21 confirmed with 11 possible; the Ellerton 11 with four; the Alnmouth and the Ennerdale 0 confirmed; 24 conflicts in one line", () => {
    const after = chunkText(d.subsumeRanges(checked.merged), checked.audit.legendText);
    assert.strictEqual(after, AFTER60);
    assert.strictEqual(after, armText60(AFTER59, "D"), "coded = measured: bands60.js's arm D of production's v12 chunk (t60-design §0g)");
    assert.strictEqual(AFTER59, armText59(AFTER58, "E"), "T59's chunk — blocks59.js's arm E of production's v11 chunk (t59-design §0g) — the v13 BEFORE");
    assert.strictEqual(armText(AFTER, "B"), AFTER58, "T58's chunk — counts58.js's arm B of production's v10 chunk (t58-design §0e) — the v11 BEFORE");
    assert.strictEqual(after.length, 9408);
    const was = AFTER59.split("\n");
    assert.deepStrictEqual(after.split("\n").filter((l) => !was.includes(l)).map((l) => l.slice(0, 40)), ["LEGEND TEXT (what the page's legend prin", "3 bedroom home: 14 confirmed (The Ellert", "4 bedroom home: 65 confirmed (The Kingsv", "5 bedroom home: 4 confirmed (The Malvern", "the 3 groups together: 83 confirmed", "the legend prints the name alone: Afford", "CONFLICTS: 25 — 173 (The Alnmouth or The"], "T60 adds the block and changes the CONFLICTS line only");
    assert.deepStrictEqual(was.filter((l) => !after.split("\n").includes(l)).map((l) => l.slice(0, 14)), ["CONFLICTS: 25 "], "every other v12 line stands");
    assert.deepStrictEqual(d.splitDetailText(after), [after], "under the 12,000-character split");
    const lines = after.split("\n");
    assert.ok(lines.includes("176 | The Kingsville or The Alnmouth (the colour at the label matches The Alnmouth, not The Kingsville)"), "D7: the tiles' reading, then the colour at the label");
    assert.ok(lines.includes("240 | The Kingsville or Affordable Housing Rented (the colour at the label matches Affordable Housing Rented, not The Kingsville)"));
    assert.ok(lines.includes("201 | The Radleigh"), "a settled conflict is a plain entry (T45 D6's shape)");
    assert.ok(lines.includes("198 | The Radleigh or The Ellerton (read differently by two tiles)"), "a conflict the colour could not settle stays as T45 wrote it");
    assert.ok(lines.includes("The Denby: 3 confirmed (302, 304, 313)"), "no conflict names the Denby: a confirmed count, nothing possible");
    assert.ok(lines.includes("The Halton: 8 confirmed (281, 282, 283, 284, 301, 303, 312, 314)"));
    assert.ok(lines.includes("The Kingsville: 21 confirmed (181, 202, 203, 211, 212, 253, 269, 270, 297, 298, 299, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329); possibly also 176, 177, 183, 184, 240, 267, 268, 296, 309, 310, 317 (see CONFLICTS)"));
    assert.ok(lines.includes("The Ellerton: 11 confirmed (172, 174, 175, 197, 213, 214, 215, 216, 217, 247, 248); possibly also 173, 198, 218, 246 (see CONFLICTS)"), "F-219's own design: the floor marked, the index's possible plots named");
    assert.deepStrictEqual(lines.filter((l) => /^The (Alnmouth|Ennerdale): /.test(l)), ["The Alnmouth: 0 confirmed; possibly 173, 176, 177, 182, 249, 280, 309, 310, 311, 317 (see CONFLICTS)", "The Ennerdale: 0 confirmed; possibly 277, 305, 315 (see CONFLICTS)"], "no Alnmouth or Ennerdale stated plainly — named only as possible, each with its own row");
    assert.match(after, /^CONFLICTS: 25 — 173 \(The Alnmouth or The Ellerton\), 176 \(The Kingsville or The Alnmouth\), 177 /m);
    assert.ok(lines.includes("220 - 237 | Affordable Housing Rented or Affordable Housing Shared Ownership (the colour at the label matches Affordable Housing Shared Ownership, not Affordable Housing Rented)"), "T59 (F-225): the printed range checked at its own label — disclosed, never replaced");
    assert.ok(!lines.some((l) => l.startsWith("255 - 256 |")), "T59 (F-218): the phantom subsumed");
    assert.ok(lines.includes("255 - 266 | Affordable Housing Rented"), "the real block stays, confirmed by its colour");
    assert.ok(lines.includes("Affordable Housing Rented: 13 confirmed (185, 188, 189, 190, 191, 192, 193, 194, 207, 208, 238, 239, 255 - 266); possibly also 182, 183, 184, 220 - 237, 240 (see CONFLICTS); 1 of the 13 is a range counted as one label — 255 - 266 (12 numbers); a range's category was read once for the range, not for each number; 220 - 237 (a range of 18 numbers counted as one label) is among the possible labels"), "T59 (F-222): the row names its range and its possible range, never expands them");
    assert.ok(lines.includes("Affordable Housing Shared Ownership: 10 confirmed (186, 187, 195, 196, 204, 205, 206, 209, 210, 254); possibly also 220 - 237 (see CONFLICTS); 220 - 237 (a range of 18 numbers counted as one label) is among the possible labels"));
    assert.ok(!/adjudicat|colour check|subsum|T57|T58|T59|T60/i.test(after.replace(/\(the colour at the label matches [^)]*\)/g, "")), "the audit is metadata: no other note in the text");
    assert.ok(lines.includes("4 bedroom home: 65 confirmed (The Kingsville 21, The Radleigh 15, The Chester 8, The Halton 8, The Hesketh 7, The Alderney 3, The Alnmouth V1 3, The Alnmouth 0); possibly also 23 more: 173, 176, 177, 180, 182, 183, 184, 198, 218, 240, 246, 249, 267, 268, 277, 280, 296, 305, 309, 310, 311, 316, 317 (see CONFLICTS)"), "T60 (F-228): the band added up, its possible labels counted");
    assert.ok(lines.includes("3 bedroom home: 14 confirmed (The Ellerton 11, The Denby 3, The Ennerdale 0); possibly also 7 more: 173, 198, 218, 246, 277, 305, 315 (see CONFLICTS)"));
    assert.ok(lines.includes("5 bedroom home: 4 confirmed (The Malvern 4); possibly also 5 more: 180, 280, 311, 315, 316 (see CONFLICTS)"));
    assert.ok(lines.includes("the 3 groups together: 83 confirmed") && lines.includes("the legend prints the name alone: Affordable Housing Rented, Affordable Housing Shared Ownership"));
    assert.match(after, /\(The Kingsville or The Alnmouth\); 1 of the 25 is a range counted as one label — 220 - 237 \(18 numbers\); the 25 labels name 42 numbers$/m, "T60: the CONFLICTS line says what its labels name");
  });

  test("the census's rules on the chunk (compare56.js's parse): before 99 right / 22 wrong / 8 conflicts; after 102 right / 3 wrong (187, 206, 275) / 24 conflicts with the truth in 21 (not 180, 249, 311 — D1's named exceptions) / 0 missing", () => {
    assert.deepStrictEqual(census(STORED), { right: 99, wrong: census(STORED).wrong, conflictsWithTruth: 8, conflictsWithoutTruth: [], missing: 0 });
    assert.strictEqual(census(STORED).wrong.length, 22);
    assert.deepStrictEqual(census(AFTER), { right: 102, wrong: ["187", "206", "275"], conflictsWithTruth: 21, conflictsWithoutTruth: ["180", "249", "311"], missing: 0 });
    assert.deepStrictEqual(census(AFTER59), census(AFTER), "T59: no plot verdict moves (the range conflict is not a house plot; the census reads plot lines and CONFLICTS)");
    assert.deepStrictEqual(census(AFTER60), census(AFTER), "T60: no plot verdict moves (the block has no plot line; the clause's 237 is not a house plot)");
    assert.deepStrictEqual(census(AFTER58), census(AFTER), "T58 moves no verdict — only the COUNTS rows change");
  });
});

describe("U-COLOUR (t57-design §0g): production's other colour-key pages — nothing moves", () => {
  const DETAILS = json(T57, "details57.json");
  // A stored chunk back into a merge-shaped index (what mergeTiles held) — enough for the check, which reads the index.
  const mergedOf = (text) => {
    const index = [];
    let inIndex = false;
    for (const line of text.split("\n")) {
      if (line === "INDEX:") { inIndex = true; continue; }
      if (/^(COUNTS|UNKNOWN|CONFLICTS|MULTI-VALUED|TILES NOT READ)/.test(line)) inIndex = false;
      if (!inIndex) continue;
      const at = line.indexOf(" | ");
      const label = line.slice(0, at);
      const rest = line.slice(at + 3);
      const m = /^(.*) \((read differently by two tiles|two categories read on one tile)\)$/.exec(rest);
      if (m && m[2] === "read differently by two tiles") index.push({ label, category: null, conflict: m[1].split(" or "), kind: "tiles disagree" });
      else if (m) index.push({ label, category: null, conflict: m[1].split("; "), kind: "one tile, two categories" });
      else index.push({ label, category: rest, conflict: null });
    }
    return { index, counts: [], conflicts: [], multiValued: [], unknown: [] };
  };
  const page = (source, pg) => DETAILS.chunks.find((x) => x.source === source && x.page === pg && x.kind === "keyed-index");

  test("SSX125 p5, p8 and p9 (their keys name colours, so the parser reads their layers): p8's pink circle matches its entry, but its two labels are tile conflicts whose other options have no swatch — nothing checked; p5 and p9 match no swatch — the check does not run; every merge returned unchanged", () => {
    for (const [pg, tag] of [[5, "ssx125-p5"], [8, "ssx125-p8"], [9, "ssx125-p9"]]) {
      const ch = page("SSX125_Manual.pdf", pg);
      const key = d.parseKey(ch.text.slice(ch.text.indexOf("KEY:") + 4, ch.text.indexOf("INDEX:")));
      assert.ok(c.keyNamesColour(key), `p${pg}: a colour key`);
      const merged = mergedOf(ch.text);
      const r = c.colourCheck(merged, { key, layer: json(T57, `colours57-${tag}.json`) });
      if (pg === 8) {
        assert.deepStrictEqual({ ran: r.audit.ran, swatches: r.audit.swatches, matched: r.audit.matched, checked: r.audit.checked, flagged: r.audit.flagged, settled: r.audit.settled }, { ran: true, swatches: 1, matched: ["M3x8mm #C-3003-30-08"], checked: 0, flagged: [], settled: [] });
        assert.deepStrictEqual(r.merged.index, merged.index, "p8: the index unchanged");
        assert.deepStrictEqual(r.audit.unchecked, { "a design without a matched swatch": 2 });
        assert.deepStrictEqual(r.audit.legendText, { "M3x8mm #C-3003-30-08": "" }, "T60: its block is its name — no legend text, so no group");
      } else {
        assert.deepStrictEqual({ ran: r.audit.ran, why: r.audit.why }, { ran: false, why: "no swatch matched" }, `p${pg}`);
        assert.strictEqual(r.merged, merged, `p${pg}: the very same merge`);
      }
    }
  });

  test("Miele p14 (a numbered-callout key): no entry names a colour, so the parser never asks for the layer — and even given it, the white box beside 'Touch display' is never a swatch (the guard, D5)", () => {
    const ch = page("Miele_washing_machine_manual.pdf", 14);
    const key = d.parseKey(ch.text.slice(ch.text.indexOf("KEY:") + 4, ch.text.indexOf("INDEX:")));
    assert.ok(!c.keyNamesColour(key));
    const layer = json(T57, "colours57-miele-p14.json");
    assert.strictEqual(c.legendSwatches(key, layer.words, layer.paths).swatches.size, 0);
    const merged = mergedOf(ch.text);
    const r = c.colourCheck(merged, { key, layer });
    assert.deepStrictEqual({ ran: r.audit.ran, why: r.audit.why }, { ran: false, why: "no key entry names a colour" });
    assert.strictEqual(r.merged, merged);
  });
});

describe("U-COLOUR (t57-design §0d, D2–D6): the rule on small synthetic pages — every branch", () => {
  // A 200 × 200 pt page: a legend of two 10 pt swatches (red "The Red", blue "The Blue") at the bottom, their names
  // beside them; red and blue houses above; labels as words with font sizes.
  const sq = (x0, y0, w, h, rgb) => ({ rgb, bbox: [x0, y0, x0 + w, y0 + h], rings: [[[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]] });
  const wd = (text, x0, y0, size = 3, w = 5, h = 2.4) => ({ text, x0, y0, x1: x0 + w, y1: y0 + h, size });
  const RED = [200, 0, 0];
  const BLUE = [0, 0, 200];
  const legendPaths = [sq(20, 170, 10, 10, RED), sq(100, 170, 10, 10, BLUE)];
  const legendWords = [wd("The", 34, 172, 7, 10, 6), wd("Red", 46, 172, 7, 12, 6), wd("The", 114, 172, 7, 10, 6), wd("Blue", 126, 172, 7, 14, 6)];
  const key = [{ attribute: "red", name: "The Red" }, { attribute: "blue", name: "The Blue" }, { attribute: "letters CS", name: "Cycle Store" }];
  const plain = (label, category) => ({ label, category, conflict: null });
  const layerOf = (words, paths, pixels = null) => ({ words: [...legendWords, ...words], paths: [...legendPaths, ...paths], pixels });

  test("confirmed, disclosed with the nearest colour, settled, left, no evidence, two clusters, a bay repeat, a design without a swatch", () => {
    const words = [
      wd("11", 10, 10), // a red house 4 pt to its right → confirmed as red
      wd("12", 60, 10), // read red, a blue house beside it → disclosed "The Red or The Blue"
      wd("13", 110, 10), // a tile conflict red / blue, only blue near → settled to blue
      wd("14", 10, 60), // a tile conflict red / blue, both near → left
      wd("15", 150, 60), // read red, nothing near → left as read (D2 a)
      wd("16", 10, 110), wd("16", 90, 110), // two clusters (80 pt apart) → unchecked
      wd("17", 60, 110), wd("17", 70, 110, 2), // the 3 pt label and a 2 pt bay repeat by a red footprint → the label's own occurrence decides
    ];
    const paths = [
      sq(19, 8, 12, 8, RED),
      sq(69, 8, 12, 8, BLUE),
      sq(119, 8, 12, 8, BLUE),
      sq(19, 58, 8, 8, RED), sq(0, 58, 8, 8, BLUE),
      sq(80, 108, 6, 6, RED), sq(69, 106, 8, 3, BLUE),
    ];
    const merged = { index: [plain("11", "The Red"), plain("12", "The Red"), { label: "13", category: null, conflict: ["The Red", "The Blue"], kind: "tiles disagree" }, { label: "14", category: null, conflict: ["The Red", "The Blue"], kind: "tiles disagree" }, plain("15", "The Red"), plain("16", "The Red"), plain("17", "The Red"), plain("18", "Cycle Store"), { label: "19", category: null, conflict: ["The Red", "The Blue"], kind: "one tile, two categories" }], counts: [], conflicts: [], multiValued: [], unknown: [] };
    const r = c.colourCheck(merged, { key, layer: layerOf(words, paths) });
    const v = Object.fromEntries(r.audit.rows.map((x) => [x.label, x.verdict === "unchecked" ? `unchecked: ${x.why}` : x.verdict]));
    assert.deepStrictEqual(v, { 11: "confirmed", 12: "flagged", 13: "resolved", 14: "left", 15: "unchecked: no key colour at the label", 16: "unchecked: 2 clusters", 17: "flagged", 18: "unchecked: a design without a matched swatch", 19: "unchecked: multi-valued" });
    assert.deepStrictEqual(r.audit.rows.find((x) => x.label === "12").disclosed, ["The Red", "The Blue"]);
    assert.deepStrictEqual(r.audit.rows.find((x) => x.label === "17").disclosed, ["The Red", "The Blue"], "the 3 pt label's own neighbourhood decides — the 2 pt repeat beside the red footprint does not");
    const e = Object.fromEntries(r.merged.index.map((x) => [x.label, x]));
    assert.deepStrictEqual(e["12"], { label: "12", category: null, conflict: ["The Red", "The Blue"], kind: "colour" });
    assert.deepStrictEqual(e["13"], { label: "13", category: "The Blue", conflict: null });
    assert.deepStrictEqual(r.merged.counts, [{ category: "The Red", n: 3, labels: ["11", "15", "16"] }, { category: "Cycle Store", n: 1, labels: ["18"] }, { category: "The Blue", n: 1, labels: ["13"] }], "COUNTS from the plain entries, as mergeTiles counts them");
    assert.deepStrictEqual(r.merged.conflicts.map((x) => `${x.label} ${x.kind}`), ["12 colour", "14 tiles disagree", "17 colour"], "in label order; a multi-value stays apart");
    assert.strictEqual(d.detailIndexLine(e["12"]), "12 | The Red or The Blue (the colour at the label matches The Blue, not The Red)");
  });

  test("the pixels under the label (D3): a building drawn in an image has no path — its pixels match a swatch fill on ≥ 20 % of the label's window; below the share, no evidence", () => {
    const words = [wd("21", 60, 60)];
    const fills = [RED, BLUE];
    const layer = (share) => layerOf(words, [], { scale: 3.5, marginPt: 3, tol: 12, fills, words: [{ w: legendWords.length, n: 1000, counts: { 1: Math.round(share * 1000) } }] });
    const merged = { index: [plain("21", "The Blue")], counts: [], conflicts: [], multiValued: [], unknown: [] };
    assert.strictEqual(c.colourCheck(merged, { key, layer: layer(0.2) }).audit.rows[0].verdict, "confirmed");
    assert.deepStrictEqual(c.colourCheck(merged, { key, layer: layer(0.2) }).audit.rows[0].present, [{ design: "The Blue", share: 0.2, d: 0 }]);
    assert.strictEqual(c.colourCheck(merged, { key, layer: layer(0.19) }).audit.rows[0].why, "no key colour at the label");
    const red = { index: [plain("21", "The Red")], counts: [], conflicts: [], multiValued: [], unknown: [] };
    assert.deepStrictEqual(c.colourCheck(red, { key, layer: layer(0.5) }).audit.rows[0].disclosed, ["The Red", "The Blue"]);
  });

  test("the legend's guards (D5): a name whose words sit beside two fills matches neither fill; a fill two names claim matches neither name; an attribute naming no colour is never considered; a shape too large or too long is no swatch", () => {
    // "The Red" printed beside the red swatch AND beside a second, blue one: ambiguous — not matched; "The Blue" keeps its own.
    const twice = { words: [...legendWords, wd("The", 34, 152, 7, 10, 6), wd("Red", 46, 152, 7, 12, 6)], paths: [...legendPaths, sq(20, 150, 10, 10, BLUE)] };
    const a = c.legendSwatches(key, twice.words, twice.paths).audit;
    assert.deepStrictEqual(a.find((x) => x.name === "The Red"), { name: "The Red", attribute: "red", matched: false, why: "2 candidate(s)" });
    assert.deepStrictEqual(a.find((x) => x.name === "The Blue"), { name: "The Blue", attribute: "blue", matched: true, rgb: BLUE, block: "The Blue" });
    // "The Red" beside a blue swatch only, and "The Blue" beside another blue one: both names claim one fill — neither is evidence.
    const shared = c.legendSwatches(key, legendWords, [sq(20, 170, 10, 10, BLUE), sq(100, 170, 10, 10, BLUE)]).audit;
    assert.deepStrictEqual(shared.filter((x) => x.attribute !== "letters CS").map((x) => `${x.name}: ${x.why}`), ["The Red: fill shared with another name", "The Blue: fill shared with another name"]);
    const big = c.legendSwatches(key, legendWords, [sq(20, 170, 30, 10, RED), sq(100, 170, 10, 25, BLUE)]).audit;
    assert.deepStrictEqual(big.filter((x) => x.matched), [], "30 × 10 (too long) and 10 × 25 (too tall) are not swatches");
    assert.ok(!c.namesColour("letters CS") && !c.namesColour("number 1") && !c.namesColour("circled 1") && c.namesColour("tan brown") && c.namesColour("Light Grey") && c.namesColour("pink circle 8"));
  });

  test("the degenerate inputs: no layer, no words, a key naming no colour, no swatch matched, an empty index — the merge comes back unchanged, the audit says why", () => {
    const merged = { index: [plain("11", "The Red")], counts: [], conflicts: [], multiValued: [], unknown: [] };
    for (const [layer, k, why] of [[null, key, "no colour layer"], [{ words: [], paths: [] }, key, "no colour layer"], [layerOf([], []), [{ attribute: "number 1", name: "Sensor" }], "no key entry names a colour"], [{ words: [wd("11", 10, 10)], paths: [] }, key, "no swatch matched"]]) {
      const r = c.colourCheck(merged, { key: k, layer });
      assert.deepStrictEqual({ ran: r.audit.ran, why: r.audit.why }, { ran: false, why });
      assert.strictEqual(r.merged, merged);
    }
    assert.deepStrictEqual(c.colourCheck(null, { key, layer: layerOf([], []) }).audit.why, "no merged index");
    assert.deepStrictEqual(c.colourCheck({ index: [], counts: [], conflicts: [], multiValued: [], unknown: [] }, { key, layer: layerOf([], []) }).audit.checked, 0);
  });

  test("the constants and the purity pin: the design's numbers, frozen; the module requires only its sibling detail_pass.js (T45's same-line rule, the cluster radius, the label order) — no fs, no child_process, no network", () => {
    assert.deepStrictEqual({ ...c.COLOUR_CHECK }, { SWATCH_MIN_PT: 3, SWATCH_MAX_PT: 20, SWATCH_ASPECT: 2, SWATCH_GAP: 2, TOUCH_PT: 0.3, MIN_AREA_PT2: 10, RADIUS_PT: 10, PIXEL_SHARE: 0.2 });
    assert.ok(Object.isFrozen(c.COLOUR_CHECK) && Object.isFrozen(c.COLOUR_WORDS));
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "ingestion", "colour_check.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.deepStrictEqual([...src.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1]), ['"./detail_pass"']);
    assert.ok(!/process\.|fetch\(|child_process|\bfs\b/.test(src));
  });
});

// T59 (design `inputs/rag-audit/t59-design.md` D3 a; F-225): a RANGE label the page prints as its own words ("220-"
// "237"; "255" "-" "266"; or one word "12-15") is placed as printed, and T57's evidence and rule then read it —
// disclose-only, never replaced. `labelPoint` itself is unchanged ("no occurrence" for a range — pinned above).
describe("U-COLOUR/T59 (t59-design §0h, §2.2): a printed range label is placed and checked; an unprinted one is not; nothing else moves", () => {
  const LAYER = json(T57, "layer57-p1.json");
  const sq = (x0, y0, w, h, rgb) => ({ rgb, bbox: [x0, y0, x0 + w, y0 + h], rings: [[[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]] });
  const wd = (text, x0, y0, size = 3, w = 5, h = 2.4) => ({ text, x0, y0, x1: x0 + w, y1: y0 + h, size });
  const RED = [200, 0, 0];
  const BLUE = [0, 0, 200];
  const legend = { paths: [sq(20, 170, 10, 10, RED), sq(100, 170, 10, 10, BLUE)], words: [wd("The", 34, 172, 7, 10, 6), wd("Red", 46, 172, 7, 12, 6), wd("The", 114, 172, 7, 10, 6), wd("Blue", 126, 172, 7, 14, 6)] };
  const key = [{ attribute: "red", name: "The Red" }, { attribute: "blue", name: "The Blue" }];
  const plain = (label, category) => ({ label, category, conflict: null });

  test("on the Site Plan's recorded layer: 220 - 237 is \"220-\" \"237\", 255 - 266 is \"255\" \"-\" \"266\" (the dash placed by its x), 255 - 256 is not printed as a range (the stacked bays) — at the plot-label size", () => {
    const words = (p) => p.own.map((o) => o.idx.map((i) => LAYER.words[i].text).join(" "));
    const a = c.rangeLabelPoint(LAYER.words, "220 - 237");
    assert.deepStrictEqual({ words: words(a), size: a.own[0].size, n: a.occurrences }, { words: ["220- 237"], size: 3.33, n: 1 });
    const b = c.rangeLabelPoint(LAYER.words, "255 - 266");
    assert.deepStrictEqual({ words: words(b), size: b.own[0].size, n: b.occurrences }, { words: ["255 - 266"], size: 3.33, n: 1 });
    assert.deepStrictEqual(c.rangeLabelPoint(LAYER.words, "255 - 256"), { why: "not printed as a range on one line" });
    for (const r of ["220 - 237", "255 - 256", "255 - 266"]) assert.deepStrictEqual(c.labelPoint(LAYER.words, r), { why: "no occurrence" }, `${r}: labelPoint unchanged`);
  });

  test("the forms: one word \"12-15\", \"12-\" \"15\", \"12\" \"-15\", \"12\" \"-\" \"15\"; never a reversed pair, another size, another line, a part number or a name", () => {
    const at = (ws, label) => { const p = c.rangeLabelPoint(ws, label); return p.own ? p.own.map((o) => o.idx.map((i) => ws[i].text).join(" ")) : p.why; };
    assert.deepStrictEqual(at([wd("12-15", 10, 10)], "12 - 15"), ["12-15"]);
    assert.deepStrictEqual(at([wd("12-", 10, 10), wd("15", 16, 10)], "12 - 15"), ["12- 15"]);
    assert.deepStrictEqual(at([wd("12", 10, 10), wd("-15", 16, 10)], "12 - 15"), ["12 -15"]);
    assert.deepStrictEqual(at([wd("12", 10, 10), wd("-", 15.5, 11, 3, 1, 0.3), wd("15", 17, 10)], "12 - 15"), ["12 - 15"], "a degenerate dash box between them");
    assert.strictEqual(at([wd("12", 10, 10), wd("15", 16, 10)], "12 - 15"), "not printed as a range on one line", "two numbers side by side with no dash are neighbours, not a range");
    assert.strictEqual(at([wd("12-", 10, 10), wd("15", 16, 10, 2)], "12 - 15"), "not printed as a range on one line", "another size");
    assert.strictEqual(at([wd("12-", 10, 10), wd("15", 16, 20)], "12 - 15"), "not printed as a range on one line", "another line");
    assert.strictEqual(at([wd("15-", 10, 10), wd("12", 16, 10)], "15 - 12"), "no occurrence", "not a range");
    assert.strictEqual(at([wd("C-00105-018", 10, 10)], "C-00105-018"), "no occurrence");
    assert.strictEqual(at([wd("ECO", 10, 10), wd("40-60", 16, 10)], "ECO 40-60"), "no occurrence");
  });

  test("the check reads a placed range as any label: its colour present → confirmed; another colour only → disclosed \"reading or colour\", never replaced; a plain label beside it unchanged", () => {
    const ranges = [wd("10-", 20, 30), wd("19", 26, 30), wd("30-", 120, 30), wd("39", 126, 30), wd("50", 20, 100)];
    const houses = [sq(24, 36, 20, 12, RED), sq(124, 36, 20, 12, BLUE), sq(24, 106, 20, 12, RED)];
    const merged = d.mergeTiles([{ tile: "a", response: "10 - 19 | The Red\n30 - 39 | The Red\n50 | The Red" }], { key });
    const r = c.colourCheck(merged, { key, layer: { words: [...legend.words, ...ranges], paths: [...legend.paths, ...houses], pixels: null } });
    const v = Object.fromEntries(r.audit.rows.map((x) => [x.label, x.verdict]));
    assert.deepStrictEqual(v, { "10 - 19": "confirmed", "30 - 39": "flagged", 50: "confirmed" });
    assert.deepStrictEqual(r.merged.index.find((e) => e.label === "30 - 39"), { label: "30 - 39", category: null, conflict: ["The Red", "The Blue"], kind: "colour" });
    assert.deepStrictEqual(r.merged.counts, [{ category: "The Red", n: 2, labels: ["10 - 19", "50"] }]);
  });
});

describe("U-COLOUR/T60 (t60-design §2.1; D2 a): the text a legend entry prints with its name — the swatch's block less the name", () => {
  test("legendTextOf: the block's words after the name's own words; the name alone \"\"; a block that does not begin with the name null; case and punctuation never decide", () => {
    assert.strictEqual(c.legendTextOf("The Malvern 5 bedroom home", "The Malvern"), "5 bedroom home");
    assert.strictEqual(c.legendTextOf("The Alnmouth V1 4 bedroom home", "The Alnmouth V1"), "4 bedroom home", "a name of three words");
    assert.strictEqual(c.legendTextOf("THE MALVERN – 5 bedroom home", "The Malvern"), "– 5 bedroom home", "case never decides; a punctuation word after the name is the text's");
    assert.strictEqual(c.legendTextOf("The – Malvern 5 bedroom home", "The Malvern"), "5 bedroom home", "a punctuation word inside the name is passed over");
    assert.strictEqual(c.legendTextOf("Affordable Housing Shared Ownership", "Affordable Housing Shared Ownership"), "", "the legend prints the name alone");
    assert.strictEqual(c.legendTextOf("5 bedroom home The Malvern", "The Malvern"), null, "the name must lead its block");
    assert.strictEqual(c.legendTextOf("The Malvernia 5 bedroom home", "The Malvern"), null, "a word that is not the name's");
    assert.strictEqual(c.legendTextOf("The", "The Malvern"), null, "a block shorter than the name");
    assert.strictEqual(c.legendTextOf("", "The Malvern"), null);
    assert.strictEqual(c.legendTextOf("The Malvern 5", ""), null, "no name, nothing read");
  });

  test("the Site Plan's page 1 on the recorded layer: the check returns the twelve designs' texts and the two tenures' \"\" — the design probe's constant (bands60.js LEGEND_TEXT, proven there by --check); a check that did not run returns no text", () => {
    const LAYER = json(T57, "layer57-p1.json");
    const MEMO = json(B, "t45-artifacts", "probes", "records", "memo-p1.json");
    const key = d.parseKey(MEMO.find((r) => r.stage === "key").reply);
    const tiles = MEMO.filter((r) => r.stage === "index").sort((a, b) => a.figureId.localeCompare(b.figureId)).map((r) => ({ tile: r.figureId.replace("detail_1_", ""), response: r.reply }));
    const merged = d.mergeTiles(tiles, { key, tilePlan: d.tilePlan(LAYER.pagePt), textBoxes: LAYER.words });
    const r = c.colourCheck(merged, { key, layer: LAYER });
    assert.deepStrictEqual(r.audit.legendText, { ...LEGEND_TEXT, "Affordable Housing Shared Ownership": "", "Affordable Housing Rented": "" });
    assert.deepStrictEqual(Object.values(r.audit.legendText).filter(Boolean).sort(), ["3 bedroom home", "3 bedroom home", "3 bedroom home", "4 bedroom home", "4 bedroom home", "4 bedroom home", "4 bedroom home", "4 bedroom home", "4 bedroom home", "4 bedroom home", "4 bedroom home", "5 bedroom home"]);
    assert.deepStrictEqual(c.colourCheck(merged, { key, layer: null }).audit.legendText, {}, "no colour layer: no text");
    assert.deepStrictEqual(c.colourCheck(merged, { key: [{ attribute: "letters CS", name: "Cycle Store" }], layer: LAYER }).audit.legendText, {}, "a key naming no colour: no text");
  });
});

// T61 (t61-design.md D1 a, D3 a; F-215's residue): the THREE-CUE SETTLE after the check — where the nearest footprint, the
// nearest house and the footprint nearest the plot's own bays all name one design within 10 pt, with no image under the
// label, that design is written. Coded = measured against the probe frozen at 83bcced before its hold-out (residue61.js's
// F1 — records/residue61-all.json) and the chunk its prototype predicted (records/after61-p1.txt).
describe("U-COLOUR/T61 (t61-design §0, §2): the three-cue settle — 13 readings settled on the Site Plan, every one to the truth; never a wrong design on v9's index or an all-right one; the image buildings guarded; production's other colour-key pages unmoved", () => {
  const T61 = path.join(B, "t61-artifacts", "records");
  const LAYER = json(T57, "layer57-p1.json");
  const TRUTH = json(B, "t56-artifacts", "truth56.json");
  const MEMO = json(B, "t45-artifacts", "probes", "records", "memo-p1.json");
  const PROBE = json(T61, "residue61-all.json");
  const AFTER60 = fs.readFileSync(path.join(B, "t60-artifacts", "records", "after60-p1.txt"), "utf8").replace(/\n$/, "");
  const AFTER61 = fs.readFileSync(path.join(T61, "after61-p1.txt"), "utf8").replace(/\n$/, "");
  const STORED_V9 = json(B, "t56-artifacts", "records", "index56.json").chunks.find((x) => x.chunkIndex === 15).text;
  const key = d.parseKey(MEMO.find((r) => r.stage === "key").reply);
  const tiles = MEMO.filter((r) => r.stage === "index").sort((a, b) => a.figureId.localeCompare(b.figureId)).map((r) => ({ tile: r.figureId.replace("detail_1_", ""), response: r.reply }));
  const merged = d.mergeTiles(tiles, { key, tilePlan: d.tilePlan(LAYER.pagePt), textBoxes: LAYER.words });
  const checked = c.colourCheck(merged, { key, layer: LAYER });
  const settled = c.associationSettle(checked.merged, { key, layer: LAYER });
  const header = AFTER60.split("\n")[0].match(/^\[VISUAL DETAIL: (.*) \| Section: (.*) \(Page 1\)\]:$/);
  const chunkText = (m) => d.detailChunkText({ title: header[1], pageTitle: header[2], page: 1, kind: "keyed-index", key, merged: d.subsumeRanges(m), legendText: checked.audit.legendText });
  // a stored chunk back into a merge-shaped index (the colour-key describe's reconstruction, above)
  const mergedOf = (text) => {
    const index = [];
    let inIndex = false;
    for (const line of text.split("\n")) {
      if (line === "INDEX:") { inIndex = true; continue; }
      if (/^(COUNTS|UNKNOWN|CONFLICTS|MULTI-VALUED|TILES NOT READ)/.test(line)) inIndex = false;
      if (!inIndex) continue;
      const at = line.indexOf(" | ");
      const label = line.slice(0, at);
      const rest = line.slice(at + 3);
      const m = /^(.*) \((read differently by two tiles|two categories read on one tile)\)$/.exec(rest);
      if (m && m[2] === "read differently by two tiles") index.push({ label, category: null, conflict: m[1].split(" or "), kind: "tiles disagree" });
      else if (m) index.push({ label, category: null, conflict: m[1].split("; "), kind: "one tile, two categories" });
      else index.push({ label, category: rest, conflict: null });
    }
    return { index, counts: [], conflicts: [], multiValued: [], unknown: [] };
  };
  const verdict = (e, t) => (!e ? "missing" : e.conflict ? (e.conflict.includes(t) ? "disclosed+" : "disclosed-") : e.category === t ? "right" : "wrong");
  // every plot's verdict before and after: the corrections, and every wrong design written (a silent wrong substitution)
  const judge = (before, after) => {
    const out = { corrected: [], wrongWritten: [] };
    for (const [p, tr] of Object.entries(TRUTH.plots)) {
      const a = before.index.find((e) => e.label === p);
      const b = after.index.find((e) => e.label === p);
      const va = verdict(a, tr.design);
      const vb = verdict(b, tr.design);
      if (va !== "right" && vb === "right") out.corrected.push(p);
      if (vb === "wrong" && (va !== "wrong" || a.category !== b.category)) out.wrongWritten.push(p);
    }
    return out;
  };

  test("the constants the probe froze (t61-design D3 a): every cue within 10 pt — T57's own radius; a house-sized footprint ≥ 90 pt² (T56's); the pixel guard is D3's share", () => {
    assert.deepStrictEqual({ ...c.ASSOCIATION }, { CAP_PT: 10, MIN_HOUSE_PT2: 90 });
    assert.strictEqual(c.ASSOCIATION.CAP_PT, c.COLOUR_CHECK.RADIUS_PT, "the cap is the check's radius");
    assert.strictEqual(c.COLOUR_CHECK.PIXEL_SHARE, 0.2);
  });

  test("coded = measured: the module settles exactly the 13 labels the frozen probe's F1 corrected (sample 173 176 177 182 183 184 187 206; hold-out 296 305 310 315 316) — two plain readings replaced, ten colour disclosures and one tile disagreement resolved, every one to the census's truth", () => {
    const f1 = PROBE.rows.find((r) => r.cand === "F1 C:S123 settle, cues within 10 pt");
    const measured = [...f1.per.sample.corrected, ...f1.per.holdout.corrected];
    assert.deepStrictEqual(settled.audit.settled.map((s) => s.label), measured);
    assert.deepStrictEqual(settled.audit.settled.map((s) => s.was), ["colour", "colour", "colour", "colour", "colour", "colour", "plain", "plain", "tiles", "colour", "colour", "colour", "colour"]);
    for (const s of settled.audit.settled) assert.strictEqual(s.to, TRUTH.plots[s.label].design, `${s.label}: settled to the truth`);
    assert.deepStrictEqual(settled.audit.settled.filter((s) => s.was === "plain").map((s) => [s.label, s.from, s.to]), [["187", "Affordable Housing Shared Ownership", "Affordable Housing Rented"], ["206", "Affordable Housing Shared Ownership", "Affordable Housing Rented"]], "the residue's two greys");
    const census = (x) => ({ right: x.right, wrong: x.wrong, withTruth: x["disclosed+"], withoutTruth: x["disclosed-"], missing: x.missing });
    assert.deepStrictEqual([census(f1.per.sample), census(f1.per.holdout)], [{ right: 55, wrong: 0, withTruth: 4, withoutTruth: 2, missing: 0 }, { right: 60, wrong: 1, withTruth: 6, withoutTruth: 1, missing: 0 }], "the frozen probe's census under F1, per half (t61-design §0e)");
    assert.deepStrictEqual([f1.per.sample.replacedWrong, f1.per.holdout.replacedWrong, f1.v9.sample.replacedWrong, f1.v9.holdout.replacedWrong, f1.allRight.sample.replacedWrong, f1.allRight.holdout.replacedWrong], [[], [], [], [], [], []], "the frozen probe: 0 wrong designs on v13, v9 and an all-right index, both halves");
  });

  test("the chunk after the settle is after61-p1.txt byte for byte (7,901 characters, one chunk): thirteen plain entries, CONFLICTS 25 → 14, T60's bands 16 / 70 / 5 and 91; the census on it 115 right / 1 wrong (275) / 13 disclosed (the truth in 10) / 0 missing", () => {
    assert.strictEqual(chunkText(checked.merged), AFTER60, "the check alone still writes production's v13 chunk");
    const after = chunkText(settled.merged);
    assert.strictEqual(after, AFTER61);
    assert.strictEqual(after.length, 7901);
    assert.deepStrictEqual(d.splitDetailText(after), [after]);
    const lines = after.split("\n");
    for (const [label, design] of [["187", "Affordable Housing Rented"], ["206", "Affordable Housing Rented"], ["176", "The Alnmouth"], ["315", "The Ennerdale"], ["296", "The Kingsville"]]) assert.ok(lines.includes(`${label} | ${design}`), `${label} | ${design}`);
    assert.match(after, /^CONFLICTS: 14 — 180 \(The Alderney or The Malvern\), 198 /m);
    assert.match(after, /the 14 labels name 31 numbers$/m);
    assert.ok(lines.includes("3 bedroom home: 16 confirmed (The Ellerton 12, The Denby 3, The Ennerdale 1); possibly also 4 more: 198, 218, 246, 277 (see CONFLICTS)"));
    assert.ok(lines.some((l) => l.startsWith("4 bedroom home: 70 confirmed (The Kingsville 22, ")));
    assert.ok(lines.includes("5 bedroom home: 5 confirmed (The Malvern 5); possibly also 3 more: 180, 280, 311 (see CONFLICTS)"));
    assert.ok(lines.includes("the 3 groups together: 91 confirmed"));
    assert.ok(lines.includes("The Denby: 3 confirmed (302, 304, 313)") && lines.includes("The Halton: 8 confirmed (281, 282, 283, 284, 301, 303, 312, 314)"), "FS-2's Denby and the Halton unmoved");
    assert.ok(!/three cues|associat|T61/i.test(after), "the settle's audit is metadata, never text");
    const out = { right: 0, wrong: [], disclosed: 0, withTruth: 0, missing: 0 };
    const idx = {};
    for (const l of lines) { const m = /^\s*(\d{3})\s*\|\s*(.+?)\s*$/.exec(l); if (m) idx[m[1]] = m[2]; }
    const conf = {};
    for (const m of /CONFLICTS: \d+ — (.*)$/m.exec(after)[1].matchAll(/(\d{3}) \(([^)]+)\)/g)) conf[m[1]] = m[2].split(" or ");
    for (const [p, t] of Object.entries(TRUTH.plots)) {
      if (conf[p]) { out.disclosed++; if (conf[p].includes(t.design)) out.withTruth++; continue; }
      if (!idx[p]) out.missing++;
      else if (idx[p] === t.design) out.right++;
      else out.wrong.push(p);
    }
    assert.deepStrictEqual(out, { right: 115, wrong: ["275"], disclosed: 13, withTruth: 10, missing: 0 });
  });

  test("never a wrong design: on T56's v9 index (99 right, 22 wrong, 8 conflicts) it settles 16 readings, every one a correction; on an index reading every plot right it settles nothing — the three cues agree on 79 plots, all on the truth, abstain on 46, and are guarded on the 4 image buildings", () => {
    const v9 = mergedOf(STORED_V9);
    const s9 = c.associationSettle(v9, { key, layer: LAYER });
    const j9 = judge(v9, s9.merged);
    assert.strictEqual(s9.audit.settled.length, 16);
    assert.deepStrictEqual({ corrected: j9.corrected.length, wrongWritten: j9.wrongWritten }, { corrected: 16, wrongWritten: [] });
    const allRight = { index: Object.entries(TRUTH.plots).map(([p, t]) => ({ label: p, category: t.design, conflict: null })), counts: [], conflicts: [], multiValued: [], unknown: [] };
    const sa = c.associationSettle(allRight, { key, layer: LAYER });
    assert.deepStrictEqual(sa.audit.settled, [], "a right reading is never replaced");
    const agreed = sa.audit.rows.filter((r) => r.agreed);
    assert.strictEqual(agreed.length, 79);
    for (const r of agreed) assert.strictEqual(r.agreed, TRUTH.plots[r.label].design, `${r.label}: the three cues name the truth`);
    assert.strictEqual(sa.audit.rows.filter((r) => !r.why && !r.agreed).length, 46, "no agreement: left as read");
    assert.deepStrictEqual(sa.audit.rows.filter((r) => r.why === "an image under the label").map((r) => r.label), ["238", "239", "240", "254"], "the buildings drawn as images (T57 D3): no geometric cue speaks for them");
  });

  test("the guards: a design without a matched swatch, a range label, a multi-valued label and a label with no single cluster are left as the check wrote them; the three cues are capped (218's false agreement, at 14.19 pt, never fires); the residue it cannot reach stays (275 wrong; 180, 249, 311 disclosed without the truth)", () => {
    const one = (entry) => c.associationSettle({ index: [entry], counts: [], conflicts: [], multiValued: [], unknown: [] }, { key, layer: LAYER });
    assert.deepStrictEqual(one({ label: "187", category: "The Blue", conflict: null }).audit.rows, [{ label: "187", why: "a design without a matched swatch" }]);
    assert.deepStrictEqual(one({ label: "187", category: null, conflict: ["The Blue", "Affordable Housing Rented"], kind: "tiles disagree" }).audit.settled, [], "an option without a swatch: never resolved (SSX125 p8's shape)");
    assert.deepStrictEqual(one({ label: "220 - 237", category: "Affordable Housing Rented", conflict: null }).audit.rows, [], "a range label: left");
    assert.deepStrictEqual(one({ label: "187", category: null, conflict: ["Affordable Housing Rented", "Affordable Housing Shared Ownership"], kind: "one tile, two categories" }).audit.rows, [], "a multi-valued label: left");
    assert.deepStrictEqual(one({ label: "999", category: "Affordable Housing Rented", conflict: null }).audit.rows, [{ label: "999", why: "no occurrence" }]);
    const row = (label) => settled.audit.rows.find((r) => r.label === label);
    assert.deepStrictEqual(row("218"), { label: "218", r1: "The Hesketh", r2: null, r3: "The Hesketh", agreed: null }, "218: the nearest house (219's Hesketh) is 14.19 pt away — beyond the cap");
    assert.deepStrictEqual(row("275"), { label: "275", r1: "The Malvern", r2: null, r3: "The Radleigh", agreed: null }, "275: the bays sit against 276's Radleigh; the Malvern's house is 10.45 pt away");
    for (const label of ["180", "249", "311"]) assert.strictEqual(row(label).agreed, null, `${label}: one cue disagrees`);
    assert.deepStrictEqual(c.associationSettle(checked.merged, { key, layer: null }).audit, { ran: false, why: "no colour layer", settled: [], rows: [] });
    assert.deepStrictEqual(c.associationSettle(checked.merged, { key: [{ attribute: "letters CS", name: "Cycle Store" }], layer: LAYER }).audit.why, "no key entry names a colour");
  });

  test("production's other colour-key pages move nothing (t61-design §0f; reach61.js): SSX125 p5 and p9 and Miele p14 match no swatch; SSX125 p8's options have none", () => {
    const DETAILS = json(T57, "details57.json");
    for (const [src, pg, tag] of [["SSX125", 5, "ssx125-p5"], ["SSX125", 8, "ssx125-p8"], ["SSX125", 9, "ssx125-p9"], ["Miele", 14, "miele-p14"]]) {
      const ch = DETAILS.chunks.find((x) => x.page === pg && x.kind === "keyed-index" && String(x.source).startsWith(src));
      const k = d.parseKey(ch.text.slice(ch.text.indexOf("KEY:") + 4, ch.text.indexOf("INDEX:")));
      const layer = json(T57, `colours57-${tag}.json`);
      const r = c.colourCheck(mergedOf(ch.text), { key: k, layer });
      assert.deepStrictEqual(c.associationSettle(r.merged, { key: k, layer }).audit.settled, [], `${tag}: nothing settled`);
    }
  });
});
