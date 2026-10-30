/**
 * U-NOTES — the computed context notes, the pure module (ticket T48, t48-design.md §2.1, §4; D2 b1, D9 b1; F-200,
 * F-177, F-205).
 *
 * Measured before the ticket (design §0e / §0f, production's own turns sampled at the product's decoding): no rule
 * clause moved F-200's side claim (9–10 of 10); two lines computed from the chain block — COLUMNS and NOT PRINTED —
 * cut it to 6 of 30 pooled and took FS-1 GREEN to 10 of 10 (`blockfix2`); a computed dual-unit block made FS-3's six
 * totals the exact millimetre sums (36 of 36). These cases pin what the module adds, and that it adds nothing else:
 *
 *   1. Figure 15's STORED block (production's Fervi #190 chunk — the v9 chunk read, and the same bytes in the captured
 *      FS-1 contexts) gains exactly the measured lines: the captured context composed with the notes IS the design
 *      probe's `blockfix2` arm (policy_probe.js's CONTEXT_EDITS), byte for byte, in both scopes.
 *   2. The corpus's seven admitted chains (production's memo, read-only — `t48-artifacts/records/chain-blocks-*.json`):
 *      Figure 15 renders equal to its stored DESCRIPTION and gains the two lines; the five that compute no point gain
 *      nothing (and under T46's D19 (b) never reach a chunk); Ikea p6 is NO_DIMENSIONS (no block).
 *   3. Every other block of the four captured contexts comes back byte for byte; the splitter's separators are
 *      citations.js's (spec joins, one legend heading, legend joins).
 *   4. The dual-unit block on the FS-3 contexts: six tables, 58 rooms — every room, area and total equal to T44's band
 *      record (the probe that measured them from production's store), 28 of 116 printed conversions disagreeing, each
 *      named beside its room; the header verbatim; the tables named by their captions' TITLE lines, never a name list.
 *   5. The grammar's edges, on synthetic blocks: units, a reached far edge, one point, not-derivable rows, a skipped
 *      line naming an edge, no POINTS section, a repeated table, a text row with no title.
 *   6. Totality and purity: junk in, nothing thrown, nothing added; the module's one require is the chain parser.
 *   7. T64 (F-216, t64-design.md §2.1): the note after the dual-unit block's designs, on synthetic blocks — "no total
 *      floor area is printed" only for a design whose page shows none (a page that may print one is quoted instead,
 *      and only that design's page counts); the examples of what a sum leaves out dropped where a table lists them;
 *      one design reads "the home above … The total above"; the last sentence "The document itself says none of this."
 *      in every form. Case 4 pins the note on FS-3's context verbatim — the measured arm E (`t64-artifacts`).
 *
 * Reads only what ships in the image (tests/ and src/ — memory `unit-tests-run-on-the-deployed-image`).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
process.env.RAG_EVAL_APP_ROOT = REPO_ROOT; // policy_probe.js and compose.js resolve the tree through it (this file's own process)
const B = (...p) => path.join(REPO_ROOT, "tests", "eval", "baselines", ...p);
const N = require("../../src/lib/rag/context_notes");
const dc = require("../../src/lib/ingestion/dimension_chain");
const { blocksOf, compose, SPEC_JOIN, LEGEND_HEAD, LEGEND_JOIN } = require(B("t48-artifacts", "compose.js"));
const { armSystem, CLAUSES } = require(B("t48-artifacts", "probes", "policy_probe.js"));
const json = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const capture = json(B("t48-artifacts", "probes", "records", "messages-1790447697.json"));
const chainBlocks = json(B("t48-artifacts", "records", "chain-blocks-1790494587.json"));
const v9 = json(B("t46-artifacts", "records", "reingest", "post", "v9-chunks-1790413460.json"));
const band = json(B("t44-artifacts", "probes", "records", "band-1790256178.json"));
const turn = (id, scope) => capture.turns.find((t) => t.id === id && t.scope === scope);
const systemOf = (id, scope) => turn(id, scope).request.messages[0].content;
const FIG15 = v9.chunks.find((c) => c.page === 25 && c.chunkIndex === 190).text;

const COLUMNS = "COLUMNS (points sharing an x — four):\nx = 16: A · x = 334: B, C · x = 1516: D, E · x = 1744: F";
const NOT_PRINTED = "NOT PRINTED:\nthe right edge — no dimension in the CHAIN reaches it: the outline's overall length (x) and every point's distance from the right edge are not printed";

describe("U-NOTES 1: Figure 15's stored block gains exactly the measured lines — the design probe's blockfix2 arm, byte for byte (§0e)", () => {
  test("the lines are the probe's CONTEXT_EDITS, character for character (the em dashes and middle dots included)", () => {
    const n = N.chainBlockNotes(FIG15);
    assert.deepStrictEqual(n.columns, { count: 4, line: "x = 16: A · x = 334: B, C · x = 1516: D, E · x = 1744: F" });
    assert.deepStrictEqual(n.notPrinted, ["the right edge"]);
    assert.strictEqual(N.notPrintedLine("the right edge"), "the right edge — no dimension in the CHAIN reaches it: the outline's overall length (x) and every point's distance from the right edge are not printed");
    assert.ok(n.text.includes(`\n\n${COLUMNS}\n\nCLOSURE (checked):`), "COLUMNS after the POINTS, before the CLOSURE");
    assert.ok(n.text.endsWith(`vs the printed 440 ✓\n\n${NOT_PRINTED}`), "NOT PRINTED after the CLOSURE — the block's end");
    assert.strictEqual(n.added, 261);
    assert.strictEqual(n.text.replace(`\n\n${COLUMNS}`, "").replace(`\n\n${NOT_PRINTED}`, ""), FIG15, "nothing else in the block moves");
  });
  for (const scope of ["corpus", "document"]) {
    test(`FS-1 ${scope}: the captured context with the notes IS armSystem(capture, "blockfix2") — the measured arm (${scope === "corpus" ? "5,284" : "5,268"} prompt tokens before)`, () => {
      const system = systemOf("FQ01", scope);
      const s6 = blocksOf(system).find((b) => b.marker === "S6");
      assert.strictEqual(s6.text, FIG15, "the capture's S6 is production's stored Fervi #190 chunk, byte for byte");
      assert.strictEqual(compose(system, { rules: false }).system, armSystem(system, "blockfix2"));
    });
  }
});

describe("U-NOTES 2: the corpus's seven admitted chains, read from production's memo (records/chain-blocks-1790494587.json)", () => {
  const byPage = (file, page) => chainBlocks.pages.find((p) => p.file === file && p.page === page);
  test("the record: the memo's 1,404 records read, 0 unreadable; the seven pages found, one chain record each", () => {
    assert.deepStrictEqual(chainBlocks.memo, { count: 1404, unreadable: 0 });
    assert.deepStrictEqual(chainBlocks.pages.map((p) => `${p.file.split("_")[0]} p${p.page}`), ["Fervi p25", "Fervi p39", "Fervi p43", "Miele p95", "SSX125 p16", "SSX125 p19", "Ikea-wardrobe p6"]);
    assert.ok(chainBlocks.pages.every((p) => p.found && p.records === 1));
  });
  test("Figure 15: the block renders equal to its stored DESCRIPTION (T46's D6 a / D19 b — it replaces it) and gains the two lines", () => {
    const p = byPage("Fervi_Lathe_TechnicalSupportManual.pdf", 25);
    assert.strictEqual(p.replacesDescription, true);
    assert.strictEqual(p.derived, 6);
    assert.ok(FIG15.endsWith(`DESCRIPTION:\n${p.block}`), "the stored chunk's DESCRIPTION is the block");
    const n = N.chainBlockNotes(p.block);
    assert.deepStrictEqual({ columns: n.columns.count, notPrinted: n.notPrinted, added: n.added }, { columns: 4, notPrinted: ["the right edge"], added: 261 });
  });
  test("the five chains that compute no point gain nothing — and never reach a chunk (D19 b: the caption's own DESCRIPTION stands)", () => {
    for (const [file, page] of [["Fervi_Lathe_TechnicalSupportManual.pdf", 39], ["Fervi_Lathe_TechnicalSupportManual.pdf", 43], ["Miele_washing_machine_manual.pdf", 95], ["SSX125_Manual.pdf", 16], ["SSX125_Manual.pdf", 19]]) {
      const p = byPage(file, page);
      assert.strictEqual(p.derived, 0, `${file} p${page}`);
      assert.strictEqual(p.replacesDescription, false, `${file} p${page}`);
      const n = N.chainBlockNotes(p.block);
      assert.ok(n, `${file} p${page}: the grammar is recognised`);
      assert.deepStrictEqual({ text: n.text === p.block, columns: n.columns, notPrinted: n.notPrinted, added: n.added }, { text: true, columns: null, notPrinted: [], added: 0 }, `${file} p${page}`);
    }
  });
  test("Ikea p6 — the mis-typed parts list (F-194): the chain pass answered NO_DIMENSIONS, so there is no block", () => {
    const p = byPage("Ikea-wardrobe_build.pdf", 6);
    assert.strictEqual(p.noDimensions, true);
    assert.strictEqual(p.block, null);
    assert.ok(dc.isNoDimensions(p.reply));
  });
});

describe("U-NOTES 3: every other block of the four captured contexts is returned byte for byte", () => {
  for (const t of capture.turns) {
    test(`${t.id} ${t.scope}: the splitter's separators are citations.js's; only ${t.id === "FQ01" ? "S6 changes" : "no block changes (the dual-unit block is appended after the context)"}`, () => {
      const system = t.request.messages[0].content;
      const blocks = blocksOf(system);
      const seps = blocks.map((b) => (b.sep === SPEC_JOIN ? "J" : b.sep === LEGEND_HEAD ? "H" : b.sep === LEGEND_JOIN ? "L" : b.sep === "" ? "." : "?")).join("");
      assert.match(seps, /^J+HL*\.$/, "spec joins, the legend heading once, legend joins, the end");
      assert.strictEqual(blocks.length, t.id === "FQ01" ? 10 : 17);
      const notes = N.contextNotes(blocks.map((b) => ({ text: b.text })));
      const changed = blocks.filter((b, i) => notes.texts[i] !== b.text).map((b) => b.marker);
      assert.deepStrictEqual(changed, t.id === "FQ01" ? ["S6"] : []);
      assert.strictEqual(notes.dualUnits === null, t.id === "FQ01", "FS-1's context carries no room row; FS-3's does");
      assert.strictEqual(compose(system, { notes: false, rules: false }).system, system, "with nothing applied the composition is the capture");
    });
  }
});

describe("U-NOTES 4: the dual-unit block on FS-3's context — T44's band record, room for room; every disagreement beside its room (§0f)", () => {
  const blocks = blocksOf(systemOf("FQ12", "document"));
  const d = N.dualUnitsBlock(blocks.map((b) => ({ text: b.text })));
  const ORDER = ["Ellerton", "Chester", "Kingsville", "Alderney", "Hesketh", "Radleigh"];
  test("six tables in page order, named by their captions' TITLE lines; 58 rooms; 28 of the 116 printed conversions disagree", () => {
    assert.deepStrictEqual(d.groups.map((g) => g.title), [
      "Ellerton 3 Bedroom Home – floor plans and dimensions",
      "Chester 4 Bedroom Home – Floor Plans and Exterior",
      "Kingsville 4 Bedroom Home – exterior photo and floor plans (Ground, First, Second Floor) with dimensions",
      "Alderney 4 Bedroom Home – exterior photo and floor plans with room dimensions",
      "HESKETH 4 BEDROOM HOME – floor plans and dimensions",
      "Radleigh 4 Bedroom Home – Floor Plans and Dimensions",
    ]);
    assert.deepStrictEqual({ rooms: d.rooms, conversions: d.conversions, disagreements: d.disagreements }, { rooms: 58, conversions: 116, disagreements: 28 });
  });
  test("every table's two totals are the band record's — the millimetre sums 718.0 / 866.0 / 982.5 / 1,071.1 / 995.1 / 1,176.9 and the feet-and-inches sums", () => {
    d.groups.forEach((g, i) => {
      const b = band.designs[ORDER[i]];
      assert.strictEqual(g.rooms, b.rooms, ORDER[i]);
      assert.strictEqual(g.mmSum, b.mmSum, `${ORDER[i]} mm`);
      assert.strictEqual(g.ftinSum, b.ftinSum, `${ORDER[i]} ft-in`);
    });
    assert.deepStrictEqual(d.groups.map((g) => g.mmSum), [718, 866, 982.5, 1071.1, 995.1, 1176.9]);
  });
  test("every room: the band record's name, millimetres and feet-and-inches, and its area from the millimetres (to 0.1)", () => {
    const lines = d.text.split("\n");
    ORDER.forEach((name, i) => {
      const line = lines[i + 1];
      for (const r of band.designs[name].roomsDetail) {
        const at = line.indexOf(` ${r.room} `) >= 0 ? line.indexOf(` ${r.room} `) + 1 : line.indexOf(`: ${r.room} `) + 2;
        assert.ok(at > 0, `${name} ${r.room} is on the table's line`);
        const area = Number(line.slice(at + r.room.length + 1).match(/^(\d+\.\d)/)[1]);
        assert.ok(Math.abs(area - r.mmSqFt) <= 0.051, `${name} ${r.room}: ${area} ≈ ${r.mmSqFt}`);
      }
      assert.match(line, new RegExp(`\\(${band.designs[name].rooms} rooms\\): `));
      assert.ok(line.endsWith(`— total ${band.designs[name].mmSum.toFixed(1)} sq ft from the millimetres (${band.designs[name].ftinSum.toFixed(1)} from the printed feet-and-inches)`), name);
    });
  });
  test("the disagreements: the band's own rule (more than half an inch), each inside its room's entry — the Ellerton lounge's 3620 mm printed 11'8\", is 11'10.5\"", () => {
    let expected = 0;
    for (const name of ORDER) for (const r of band.designs[name].roomsDetail) {
      const mm = r.mm.split(" x ").map(Number);
      const printed = r.ftin.split(" x ").map((s) => { const m = s.match(/(\d+)'(\d+)"/); return Number(m[1]) * 12 + Number(m[2]); });
      for (let k = 0; k < 2; k++) if (Math.abs(printed[k] - mm[k] / 25.4) > 0.5) expected++;
    }
    assert.strictEqual(expected, 28, "the band record's rows give 28 disagreements by the rule");
    assert.ok(d.text.includes("Lounge 154.6 (3620 mm printed 11'8\", is 11'10.5\")"), "beside its room — not in a list apart (§0f's residue)");
    assert.ok(d.text.includes("Bedroom 2 94.4 (2703 mm printed 8'8\", is 8'10.5\"; 3245 mm printed 10'6\", is 10'8\")"), "two disagreements of one room, one parenthesis");
    assert.ok(d.text.includes("Bedroom 3 101.8 (3350 mm printed 10'10\", is 11'0\")"), "the Radleigh's 3350 mm (frontier-comparison.md §2.4)");
    assert.strictEqual((d.text.match(/ mm printed /g) || []).length, 28);
    assert.ok(d.text.endsWith("PRINTED CONVERSIONS THAT DISAGREE with their millimetres beyond half-inch rounding: 28 of 116, each named beside its room above."));
  });
  test("the header is the measured block's, verbatim (dual_units_block.js)", () => {
    assert.strictEqual(d.text.split("\n")[0], N.DUAL_UNITS_HEADER);
    assert.strictEqual(require(B("t48-artifacts", "probes", "dual_units_block.js")).block().split("\n")[0], N.DUAL_UNITS_HEADER);
    assert.strictEqual(d.text.split("\n").length, 9, "the header, six tables, the T64 note, the count");
  });
  test("T64: the note after the six designs is the measured arm E's, verbatim (t64-design.md §0d, §0f) — no page prints a total, nothing listed as a hall, landing, stairs or store", () => {
    assert.strictEqual(d.text.split("\n")[7], "NO TOTAL FLOOR AREA is printed for any home above: neither its room table nor any other text from its page above gives one. Each total above is computed here and covers only the rooms its table lists, so it is not the home's floor area: it leaves out the spaces the table gives no row (such as a hall, a landing, stairs or a store, where the home has them) and the walls. The document itself says none of this.");
    assert.strictEqual(N.totalsNote([], []), "Each total above is computed here and covers only the rooms its table lists, so it is not the home's floor area: it leaves out the spaces the table gives no row (such as a hall, a landing, stairs or a store, where the home has them) and the walls. The document itself says none of this.", "no group: no printed-total sentence");
  });
  test("both FS-3 scopes carry the same block; the corpus scope's blocks give the same text", () => {
    const c = N.dualUnitsBlock(blocksOf(systemOf("FQ12", "corpus")).map((b) => ({ text: b.text })));
    assert.strictEqual(c.text, d.text);
  });
});

describe("U-NOTES 5: the grammar's edges, on synthetic blocks", () => {
  const block = (chain, points, closure = "40 = 40 ✓") => `CHAIN:\n${chain.join("\n")}\n\nPOINTS (computed from the CHAIN, x from the left edge, y from the top edge):\n${points.join("\n")}\n\nCLOSURE (checked):\n${closure}`;
  test("units ride with the x as printed; a reached far edge is not NOT PRINTED; the columns order by x, letters in order", () => {
    const n = N.chainBlockNotes(block(["from left edge to A (horizontal): 10 mm", "from A to B (horizontal): 20 mm", "from B to right edge (horizontal): 5 mm", "from top edge to bottom edge (vertical): 40 mm", "from top edge to A (vertical): 10 mm"], ["A: x = 10 mm, y = 10 mm", "C: x = 30 mm, y = 30 mm", "B: x = 30 mm, y = 10 mm"]));
    assert.deepStrictEqual(n.columns, { count: 2, line: "x = 10 mm: A · x = 30 mm: B, C" });
    assert.deepStrictEqual(n.notPrinted, [], "every edge is named by a CHAIN line");
    assert.ok(n.text.includes("COLUMNS (points sharing an x — two):\nx = 10 mm: A · x = 30 mm: B, C\n\nCLOSURE (checked):"));
  });
  test("one point: NOT PRINTED (the far edges no line names), no COLUMNS; the y wording is the solver's depth", () => {
    const n = N.chainBlockNotes(block(["from left edge to A (horizontal): 16", "from top edge to A (vertical): 20"], ["A: x = 16, y = 20"]));
    assert.strictEqual(n.columns, null);
    assert.deepStrictEqual(n.notPrinted, ["the right edge", "the bottom edge"]);
    assert.ok(n.text.endsWith("40 = 40 ✓\n\nNOT PRINTED:\nthe right edge — no dimension in the CHAIN reaches it: the outline's overall length (x) and every point's distance from the right edge are not printed\nthe bottom edge — no dimension in the CHAIN reaches it: the outline's overall depth (y) and every point's distance from the bottom edge are not printed"));
  });
  test("not-derivable rows after the computed ones stay in the POINTS section; COLUMNS reads the computed rows only", () => {
    const n = N.chainBlockNotes(block(["from left edge to A (horizontal): 5", "from A to B (horizontal): 5", "from top edge to A (vertical): 5", "from top edge to bottom edge (vertical): 40", "from left edge to right edge (horizontal): 40"], ["A: x = 5, y = 5", "B: x = 10, y = 5", "C: not derivable (x unknown)"]));
    assert.deepStrictEqual(n.columns, { count: 2, line: "x = 5: A · x = 10: B" });
    assert.ok(n.text.includes("C: not derivable (x unknown)\n\nCOLUMNS (points sharing an x — two):"));
  });
  test("a line the parser skipped still names its edge: an [unclear] end or an unreadable value reaches the edge it names", () => {
    const n = N.chainBlockNotes(block(["from left edge to A (horizontal): 16", "from A to right edge (horizontal): about 30", "from [unclear] to bottom edge (vertical): 7", "from top edge to A (vertical): 5"], ["A: x = 16, y = 5"]));
    assert.deepStrictEqual(n.notPrinted, [], "right edge (an unreadable value) and bottom edge (an [unclear] end) are named by lines");
  });
  test("no grammar, no notes: a CHAIN without POINTS (computed …), POINTS without a CHAIN, prose that mentions them", () => {
    assert.strictEqual(N.chainBlockNotes("CHAIN:\nfrom left edge to A (horizontal): 16\n\nCLOSURE (checked):\n16 ✓"), null);
    assert.strictEqual(N.chainBlockNotes("POINTS (computed from the CHAIN, x from the left edge, y from the top edge):\nA: x = 1, y = 1"), null);
    assert.strictEqual(N.chainBlockNotes("The CHAIN: section lists POINTS (computed) values."), null);
  });
  test("the dual-unit rows: a table read twice (the same rows) counts once; a text block with rows and no title is named by where it is", () => {
    const rows = "Lounge | 3620 x 3967mm | 11'8\" x 13'0\"\nWC | 1695 x 1050mm | 5'8\" x 3'4\"";
    const d = N.dualUnitsBlock([{ text: `TITLE: The Ellerton\n${rows}` }, { text: `[VISUAL DETAIL: The Ellerton | Section: x]:\n${rows}` }, { text: `[Page 9 - PLANS]\nStudy | 2000 x 3000mm | 6'7" x 9'10"`, source: "Plans.pdf", page: 9 }]);
    assert.deepStrictEqual(d.groups.map((g) => [g.title, g.rooms]), [["The Ellerton", 2], ["Plans.pdf p.9", 1]]);
    assert.strictEqual(d.conversions, 6);
    assert.strictEqual(N.dualUnitsBlock([{ text: "no rows here" }]), null);
    assert.strictEqual(N.titleOf({ text: "[HUMAN-LOGICAL VISUAL ELEMENT: Chester 4 Bedroom Home | Section: Page 3 (Page 3)]:\nrows" }), "Chester 4 Bedroom Home");
  });
});

describe("U-NOTES 7: T64 — the totals note's rules, on synthetic blocks (t64-design.md §2.1; F-216)", () => {
  const rows = "Lounge | 3620 x 3967mm | 11'8\" x 13'0\"\nWC | 1695 x 1050mm | 5'8\" x 3'4\"";
  const noteOf = (blocks) => { const lines = N.dualUnitsBlock(blocks).text.split("\n"); return lines[lines.length - 2]; };
  test("one design, no printed total: \"the home above … The total above\", every example, the last sentence", () => {
    assert.strictEqual(noteOf([{ text: `TITLE: The A\n${rows}`, source: "x.pdf", page: 2 }]), "NO TOTAL FLOOR AREA is printed for the home above: neither its room table nor any other text from its page above gives one. The total above is computed here and covers only the rooms its table lists, so it is not the home's floor area: it leaves out the spaces the table gives no row (such as a hall, a landing, stairs or a store, where the home has them) and the walls. The document itself says none of this.");
  });
  test("a page that may print a total: that design is quoted and left out of the claim; another page's total does not count", () => {
    const note = noteOf([
      { text: `TITLE: The A\n${rows}`, source: "x.pdf", page: 2 },
      { text: "Total floor area 1,075 sq ft", source: "x.pdf", page: 2 },
      { text: `TITLE: The B\n${rows.replace("3620", "3621")}`, source: "x.pdf", page: 3 },
    ]);
    assert.ok(note.startsWith("NO TOTAL FLOOR AREA is printed for The B: neither its room table nor any other text from its page above gives one. The A: its page prints \"Total floor area 1,075 sq ft\" — the page's own figure. Each total above"), note);
    for (const t of ["GIA 99.6 m²", "Gross internal area: 1,020 sq ft", "TOTAL AREA 95 m2", "Internal area 101 sq m", "Net area 1000 sq ft"]) assert.ok(N.printedTotalIn(`x\n${t}`), t);
    for (const t of ["TOTAL ROOMS: 14", "Total bathrooms: 3", "All images used are for illustrative purposes only", `Lounge | 3620 x 3967mm | 11'8" x 13'0"`]) assert.strictEqual(N.printedTotalIn(t), null, t);
  });
  test("a block with no source or page reads only its own text; a total on another source's page 2 does not withdraw the claim", () => {
    assert.ok(noteOf([{ text: `TITLE: The A\n${rows}` }, { text: "Total floor area 1,075 sq ft" }]).startsWith("NO TOTAL FLOOR AREA is printed for the home above:"));
    assert.ok(noteOf([{ text: `TITLE: The A\n${rows}`, source: "x.pdf", page: 2 }, { text: "Total floor area 1,075 sq ft", source: "y.pdf", page: 2 }]).startsWith("NO TOTAL FLOOR AREA is printed for the home above:"));
  });
  test("the examples follow the tables: a listed hall, landing, stairs or store drops out; all four listed — no bracket", () => {
    const hall = noteOf([{ text: `TITLE: The A\n${rows}\nEntrance Hall | 2000 x 3000mm | 6'7" x 9'10"` }]);
    assert.ok(hall.includes("(such as a landing, stairs or a store, where the home has them)"), hall);
    const all = noteOf([{ text: `TITLE: The A\nHall | 2000 x 3000mm | 6'7" x 9'10"\nLanding | 2000 x 3000mm | 6'7" x 9'10"\nStaircase | 1000 x 3000mm | 3'3" x 9'10"\nStorage | 1000 x 1000mm | 3'3" x 3'3"` }]);
    assert.ok(all.endsWith("it leaves out the spaces the table gives no row and the walls. The document itself says none of this."), all);
    const one = noteOf([{ text: `TITLE: The A\n${rows}\nLanding | 2000 x 3000mm | 6'7" x 9'10"\nStairs | 1000 x 3000mm | 3'3" x 9'10"\nStore | 1000 x 1000mm | 3'3" x 3'3"` }]);
    assert.ok(one.includes("(such as a hall, where the home has them)"), one);
  });
  test("the note sits before the printed-conversions count, which stays the block's last line; the chain notes and no-room contexts are untouched", () => {
    const lines = N.dualUnitsBlock([{ text: `TITLE: The A\n${rows}` }]).text.split("\n");
    assert.strictEqual(lines.length, 4);
    assert.ok(lines[3].startsWith("PRINTED CONVERSIONS THAT DISAGREE"));
    assert.strictEqual(N.dualUnitsBlock([{ text: "no rows here" }]), null);
    assert.deepStrictEqual(N.contextNotes([{ text: "a" }]), { texts: ["a"], chain: [], dualUnits: null });
  });
});

describe("U-NOTES 6: totality and purity", () => {
  test("junk in, nothing thrown, nothing added", () => {
    for (const junk of [undefined, null, 0, "", {}, [], "CHAIN:"]) assert.ok(N.chainBlockNotes(junk) === null, String(junk));
    for (const junk of [undefined, null, 7, "x", [null, 5, { text: 9 }, { text: null }]]) {
      const r = N.contextNotes(junk);
      assert.deepStrictEqual(r.chain, []);
      assert.strictEqual(r.dualUnits, null);
    }
    assert.deepStrictEqual(N.contextNotes([{ text: "a" }, { text: FIG15 }]).chain.map((c) => c.index), [1]);
  });
  test("the module's one require is dimension_chain.js (the one chain grammar); no fs, no fetch, no clock", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "rag", "context_notes.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.deepStrictEqual(src.match(/require\([^)]*\)/g), ['require("../ingestion/dimension_chain")']);
    assert.ok(!/\bfetch\(|Date\.now|new Date|process\.env|readFileSync/.test(src));
  });
  test("the measured clauses NOT shipped stay out of the module (F-200's rule clause, the finer-unit clause — §0d / §0f)", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "rag", "context_notes.js"), "utf8");
    for (const c of [CLAUSES.finer, CLAUSES.f200, CLAUSES.f200n]) assert.ok(!src.includes(c.trim().slice(2, 60)), c.slice(0, 40));
  });
});
