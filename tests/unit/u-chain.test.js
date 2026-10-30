/**
 * U-CHAIN — the dimensioned drawing's chain (T46; design `inputs/rag-audit/t46-design.md` §2.2, D2 a, D4 a, D6 a, D7,
 * D14 a, D17; `src/lib/ingestion/dimension_chain.js`). Offline, no pod, no model: the module on the design probe's
 * records — the captioner's V4 replies (`t46-artifacts/probes/records/chain-1790346207.json`, cold = warm), the
 * by-eye truth (`probes/truth.json`), the D13 (b) geometry's v2 reads at the pinned setting and the cross-check's
 * (`probes/records/d13/v2/rg-*-s4-i{200,128}-*`), and the production captions (T47's fixture, cut read-only from v8 —
 * `t47-artifacts/records/reconcile-fixture-1790352029.json`).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const dc = require("../../src/lib/ingestion/dimension_chain");
const T46 = path.join(REPO_ROOT, "tests", "eval", "baselines", "t46-artifacts", "probes");
const V4 = JSON.parse(fs.readFileSync(path.join(T46, "records", "chain-1790346207.json"), "utf8"));
const TRUTH = JSON.parse(fs.readFileSync(path.join(T46, "truth.json"), "utf8"));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "t47-artifacts", "records", "reconcile-fixture-1790352029.json"), "utf8"));
const FQ = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "workshop-artifacts", "figure_questions.json"), "utf8"));
const FQ01 = (FQ.questions || FQ).find((q) => q.id === "FQ01");
const reply = (page) => V4.runs.find((r) => r.page === page && r.variant === "V4").cold.reply;
const rg = (page, ink) => {
  const dir = path.join(T46, "records", "d13", "v2");
  const f = fs.readdirSync(dir).find((n) => n.startsWith(`rg-${page}-s4-i${ink}-`));
  return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
};
const FIG15 = "Fervi_Lathe_TechnicalSupportManual-p25";
const FIG15_POINTS = Object.fromEntries(Object.entries(TRUTH.pages["Fervi_Lathe_TechnicalSupportManual.pdf#25"].points).map(([L, [x, y]]) => [L, { x, y }]));
/** Figure 15's chain by hand (truth.json's nine dimensions and the drawing's alignments), in V4's grammar. */
const BY_HAND = `POINTS MARKED:
A: left end point
B: first inboard pair, upper
C: first inboard pair, lower
D: second inboard pair, upper
E: second inboard pair, lower
F: right end point

ALIGNED:
A F (horizontal)
B D (horizontal)
C E (horizontal)
B C (vertical)
D E (vertical)

CHAIN:
from the left edge to A (horizontal): 16
from A to B (horizontal): 318
from A to F (horizontal): 1728
from D to F (horizontal): 228
from the top edge to B (vertical): 50
from B to C (vertical): 340
from C to the bottom edge (vertical): 50
from the bottom edge to A (vertical): 220
from the top edge to the bottom edge (vertical): 440`;

describe("U-CHAIN (t46-design §2.2, D2 a): the reply parsed and the points computed — never asked of the model", () => {
  test("the fixtures: the four V4 replies (cold = warm, 4 / 4); the control's NO_DIMENSIONS; the truth's six points", () => {
    for (const r of V4.runs) assert.strictEqual(r.warm.identical, true, `${r.page}: warm = cold`);
    assert.strictEqual(dc.isNoDimensions(reply("fervi53")), true);
    for (const p of ["fervi25", "miele95", "ssx19"]) assert.strictEqual(dc.isNoDimensions(reply(p)), false, p);
    for (const v of ["NO_DIMENSIONS", "  **NO_DIMENSIONS**.", "\n\nNO_DIMENSIONS\n"]) assert.strictEqual(dc.isNoDimensions(v), true, JSON.stringify(v));
    for (const v of ["", null, "NO DIMENSIONS", "CHAIN:\nNO_DIMENSIONS"]) assert.strictEqual(dc.isNoDimensions(v), false, JSON.stringify(v));
    assert.deepStrictEqual(FIG15_POINTS, { A: { x: 16, y: 220 }, B: { x: 334, y: 50 }, C: { x: 334, y: 390 }, D: { x: 1516, y: 50 }, E: { x: 1516, y: 390 }, F: { x: 1744, y: 220 } });
  });

  test("parseChain: Figure 15's reply — 9 chain lines, 5 aligned sets, 6 marked points, nothing skipped; the edges normalised; Miele's 'at least 2 cm' unparsed; SSX125's [unclear] endpoints skipped", () => {
    const p = dc.parseChain(reply("fervi25"));
    assert.strictEqual(p.lines.length, 9);
    assert.strictEqual(p.chainLines, 9);
    assert.deepStrictEqual(p.skipped, []);
    assert.deepStrictEqual(p.marked, ["A", "B", "C", "D", "E", "F"]);
    assert.deepStrictEqual(p.aligned.map((a) => `${a.points.join(" ")} ${a.axis}`), ["A F horizontal", "B D horizontal", "C E horizontal", "B C vertical", "D E vertical"]);
    assert.deepStrictEqual(p.lines[3], { index: p.lines[3].index, line: "from left edge to right edge (horizontal): 1728", from: "the left edge", to: "the right edge", axis: "horizontal", value: 1728, valueText: "1728", unit: null });
    const m = dc.parseChain(reply("miele95"));
    assert.deepStrictEqual(m.lines.map((l) => `${l.from}|${l.to}|${l.value}|${l.unit}`), ["the bottom edge|the top edge|172|cm", "the bottom edge|the top edge|181|cm", "the left edge|the right edge|65|cm"]);
    assert.deepStrictEqual(m.skipped.map((s) => s.why), ["unparsed (no value where the grammar puts one)"]);
    assert.strictEqual(m.unclear, 1);
    const s = dc.parseChain(reply("ssx19"));
    assert.strictEqual(s.lines.length, 0);
    assert.deepStrictEqual(s.skipped.map((x) => x.why), ["an [unclear] endpoint", "an [unclear] endpoint"]);
    assert.strictEqual(s.unclear, 4);
    assert.deepStrictEqual(dc.parseChain(reply("fervi53")), { lines: [], skipped: [], aligned: [], marked: [], chainLines: 0, unclear: 0, noDimensions: true });
  });

  test("pointsFromChain on the chain by hand: all six points exact from the left / top edges; the closure 50 + 340 + 50 = 440 ✓ (§0d)", () => {
    const s = dc.pointsFromChain(BY_HAND);
    assert.deepStrictEqual(s.points, FIG15_POINTS);
    assert.strictEqual(s.derived, 6);
    assert.deepStrictEqual(s.notDerivable, []);
    assert.deepStrictEqual(s.closure, [{ axis: "y", printedTotal: 440, sum: "50 + 340 + 50 = 440", ok: true }]);
    assert.deepStrictEqual(s.extent, { width: null, depth: 440 });
    assert.deepStrictEqual(s.conflicts, { x: [], y: [] });
  });

  test("pointsFromChain on the captioner's reply AS READ: A / B / C exact, D / E / F not derivable (x) — the misread 1728 hangs on the outline's edges and reaches nothing (§0d); the y closure ✓, the x one open", () => {
    const s = dc.pointsFromChain(reply("fervi25"));
    assert.deepStrictEqual(s.points, { A: FIG15_POINTS.A, B: FIG15_POINTS.B, C: FIG15_POINTS.C });
    assert.deepStrictEqual(s.notDerivable, [{ point: "D", missing: ["x"] }, { point: "E", missing: ["x"] }, { point: "F", missing: ["x"] }]);
    assert.deepStrictEqual(s.closure, [{ axis: "x", printedTotal: 1728, sum: null, ok: null, note: "no printed chain reaches the far edge from the near edge" }, { axis: "y", printedTotal: 440, sum: "50 + 340 + 50 = 440", ok: true }]);
  });

  test("where the prototype guessed, the module declines: two printed totals (Miele's 172 / 181 cm) leave the extent ambiguous; a vertical line across columns, a named part, an edge of the other axis are skipped with the reason; an inconsistent axis is withheld; mixed units compute nothing", () => {
    const miele = dc.pointsFromChain(reply("miele95"));
    assert.deepStrictEqual(miele.closure.find((c) => c.axis === "y"), { axis: "y", printedTotal: null, totals: [172, 181], sum: null, ok: null, note: "two printed totals (172, 181) — the overall extent is ambiguous" });
    assert.deepStrictEqual(miele.points, {});
    assert.strictEqual(miele.unit, "cm");
    const cross = dc.pointsFromChain("ALIGNED:\nA B (horizontal)\n\nCHAIN:\nfrom the left edge to A (horizontal): 10\nfrom A to C (vertical): 40\nfrom the top edge to A (vertical): 5");
    assert.deepStrictEqual(cross.skipped.map((x) => x.why), ["the vertical order of two points in different columns is not given by the lettering"]);
    assert.deepStrictEqual(cross.points, { A: { x: 10, y: 5 } }, "C's y never guessed from the letter order");
    const part = dc.parseChain("CHAIN:\nfrom the left edge to the motor (horizontal): 40\nfrom the left edge to A (vertical): 3");
    assert.deepStrictEqual(part.skipped.map((x) => x.why), ["a named part — its place along the axis is not given by the lettering", "an edge of the other axis"]);
    const bad = dc.pointsFromChain("ALIGNED:\nB C (vertical)\n\nCHAIN:\nfrom the top edge to B (vertical): 50\nfrom B to C (vertical): 340\nfrom C to the bottom edge (vertical): 60\nfrom the top edge to the bottom edge (vertical): 440\nfrom the left edge to B (horizontal): 20");
    assert.deepStrictEqual(bad.closure, [{ axis: "y", printedTotal: 440, sum: "50 + 340 + 60 = 450", ok: false }]);
    assert.deepStrictEqual(bad.points, {}, "a misread value: the y axis withheld, never a guessed coordinate");
    assert.deepStrictEqual(bad.notDerivable, [{ point: "B", missing: ["y"], why: "the chain disagrees with itself on y" }, { point: "C", missing: ["y"], why: "the chain disagrees with itself on y" }]);
    const mixed = dc.pointsFromChain("CHAIN:\nfrom the left edge to A (horizontal): 10 mm\nfrom the top edge to A (vertical): 2 cm");
    assert.strictEqual(mixed.mixedUnits, true);
    assert.deepStrictEqual(mixed.notDerivable, [{ point: "A", missing: ["x", "y"], why: "the chain mixes units" }]);
    const outside = dc.pointsFromChain("CHAIN:\nfrom the left edge to A (horizontal): 50\nfrom the left edge to the right edge (horizontal): 40\nfrom the top edge to A (vertical): 5");
    assert.deepStrictEqual(outside.notDerivable, [{ point: "A", missing: ["x"], why: "the chain disagrees with itself on x" }], "a point beyond the printed extent is withheld");
  });
});

describe("U-CHAIN (D4 a): the admission — exactly the census's seven pages on production, never a negated phrase", () => {
  test("on the 228 production captions (v8): Fervi p25 / p39 / p43, Ikea p6, Miele p95 by the TYPE line; SSX125 p16 ('dimension line') and p19 ('dimensioned drawing') by the DESCRIPTION — and nothing else", () => {
    assert.strictEqual(FIXTURE.captions.length, 228);
    const admitted = FIXTURE.captions.filter((c) => dc.chainAdmits(c.text).admitted).map((c) => `${c.source.replace(/\.pdf$/, "")} p${c.page}: ${dc.chainAdmits(c.text).reason}`);
    assert.deepStrictEqual(admitted, [
      "Fervi_Lathe_TechnicalSupportManual p25: TYPE dimensioned drawing",
      "Fervi_Lathe_TechnicalSupportManual p39: TYPE dimensioned drawing",
      "Fervi_Lathe_TechnicalSupportManual p43: TYPE dimensioned drawing",
      "Ikea-wardrobe_build p6: TYPE dimensioned drawing",
      "Miele_washing_machine_manual p95: TYPE dimensioned drawing",
      'SSX125_Manual p16: DESCRIPTION "dimension line"',
      'SSX125_Manual p19: DESCRIPTION "dimensioned drawing"',
    ]);
  });

  test("not admitted: Fervi p40 / p44 (TYPE mixed — a bare 'dimensioned' in a DESCRIPTION that carries a procedure; §11a), SSX125 p11 ('No dimensions are dimensioned'), the captioner's 'No dimensions are shown' convention; a negation within four words refuses the phrase", () => {
    for (const [src, page] of [["Fervi", 40], ["Fervi", 44], ["SSX125", 11], ["Fervi", 38], ["Miele", 29], ["Miele", 85]]) {
      const c = FIXTURE.captions.find((x) => x.source.includes(src) && x.page === page);
      assert.strictEqual(dc.chainAdmits(c.text).admitted, false, `${src} p${page}`);
    }
    const mentions = FIXTURE.captions.filter((c) => /dimension/i.test(c.text) && !dc.chainAdmits(c.text).admitted);
    assert.ok(mentions.length >= 90, `the captions that mention a dimension and are not admitted (${mentions.length})`);
    for (const d of ["No dimension lines are shown.", "The page carries no dimension line.", "It does not show a dimensioned drawing.", "without any dimension lines or values"]) {
      assert.strictEqual(dc.chainAdmits(`TITLE: x\nTYPE: photo\nSUBJECTS: y\n\nDESCRIPTION: ${d}`).admitted, false, d);
    }
    assert.strictEqual(dc.chainAdmits("TITLE: x\nTYPE: photo\n\nDESCRIPTION: No labels. A dimension line reads 28 mm.").admitted, true, "the negation belongs to another sentence");
    assert.strictEqual(dc.chainAdmits("TITLE: A dimensioned drawing of the base\nTYPE: mixed").reason, 'TITLE "dimensioned drawing"');
    assert.strictEqual(dc.chainAdmits("TITLE: x\nTYPE: photo\nTRANSCRIPTION:\ndimension line\n").admitted, false, "the TRANSCRIPTION is the page's words, never an admission");
    assert.strictEqual(dc.chainAdmits(null).admitted, false);
  });
});

describe("U-CHAIN (D14 a, D17): the settlement on the D13 (b) geometry's records — both inks agree, named ends, one free claim", () => {
  const geo = { primary: rg(FIG15, 200), check: rg(FIG15, 128) };

  test("Figure 15: of the reply's nine lines eight are CONFIRMED and one SETTLED — 'from left edge to right edge (horizontal): 1728' → 'from A to F (horizontal): 1728' at both inks; the solver then gives all six points exact (§0i)", () => {
    const s = dc.settleChain(reply("fervi25"), geo);
    assert.deepStrictEqual({ settled: s.settled, confirmed: s.confirmed, unsettled: s.unsettled, lettersOk: s.lettersOk }, { settled: 1, confirmed: 8, unsettled: 0, lettersOk: { primary: true, check: true } });
    const settled = s.lines.filter((l) => l.outcome === "SETTLED");
    assert.deepStrictEqual(settled.map((l) => [l.line, l.settledTo, l.check.outcome, l.check.settledTo]), [["from left edge to right edge (horizontal): 1728", "from A to F (horizontal): 1728", "SETTLED", "from A to F (horizontal): 1728"]]);
    assert.deepStrictEqual(settled[0].span, [139.75, 410.88], "A's column to F's (page points)");
    const before = reply("fervi25").split("\n");
    const after = s.reply.split("\n");
    assert.strictEqual(after.length, before.length);
    assert.deepStrictEqual(after.filter((l, i) => l !== before[i]), ["from A to F (horizontal): 1728"], "one line changed, every other byte as read");
    assert.deepStrictEqual(dc.pointsFromChain(s.reply).points, FIG15_POINTS);
    assert.deepStrictEqual(s.lines.filter((l) => l.check.outcome !== "CONFIRMED" && l.check.outcome !== "SETTLED").map((l) => l.line), ["from left edge to A (horizontal): 16", "from C to bottom edge (vertical): 50"], "at ink 128 two lines lose their claims — confirmation is the pinned ink's; only a settlement needs both");
  });

  test("the cross-check: a settlement the second ink does not make identically never applies — no check read, a check whose 1728 names other ends, the product's own 2.0 render (no crosshair lettered) — the chain stays as read", () => {
    const none = dc.settleChain(reply("fervi25"), { primary: geo.primary, check: null });
    assert.strictEqual(none.settled, 0);
    assert.match(none.lines.find((l) => /1728/.test(l.line)).reason, /^the two ink settings disagree — ink 200 reads "from A to F \(horizontal\): 1728", ink 128 leaves it \(no geometry for the page\)$/);
    assert.strictEqual(none.reply, reply("fervi25"));
    const shifted = JSON.parse(JSON.stringify(geo.check));
    shifted.regions[0].claims.find((c) => c.value === "1728").span = [139.87, 342.12];
    const disagree = dc.settleChain(reply("fervi25"), { primary: geo.primary, check: shifted });
    assert.strictEqual(disagree.settled, 0);
    assert.match(disagree.lines.find((l) => /1728/.test(l.line)).reason, /ink 128 reads "from A to D \(horizontal\): 1728"/);
    const low = dc.settleChain(reply("fervi25"), { primary: JSON.parse(fs.readFileSync(path.join(T46, "records", "d13", "v2", fs.readdirSync(path.join(T46, "records", "d13", "v2")).find((n) => n.startsWith(`rg-${FIG15}-s2-i200-`))), "utf8")), check: geo.check });
    assert.deepStrictEqual({ settled: low.settled, confirmed: low.confirmed, lettersOk: low.lettersOk.primary }, { settled: 0, confirmed: 0, lettersOk: false }, "at the product's 2.0 render the crosshairs are not found: nothing settles, nothing is named");
    assert.strictEqual(dc.settleChain(reply("fervi25"), null).settled, 0);
  });

  test("no lettered crosshair, no settlement: Figure 29 (whose ink-128 read carries two WRONG claims), Figure 31 and Miele p95 — every line UNSETTLED with the reason, never an end named 'the left edge' by default", () => {
    const edgeReply = "ALIGNED:\nnone\n\nCHAIN:\nfrom the left edge to the right edge (horizontal): 13\nfrom the top edge to the bottom edge (vertical): 12\nfrom the top edge to the bottom edge (vertical): 5";
    for (const page of ["Fervi_Lathe_TechnicalSupportManual-p39", "Fervi_Lathe_TechnicalSupportManual-p43", "Miele_washing_machine_manual-p95"]) {
      const g = { primary: rg(page, 200), check: rg(page, 128) };
      assert.strictEqual(dc.chainGeometryOf(g.primary).regionsWithPoints, 0, `${page}: no crosshair`);
      for (const r of [edgeReply, reply("miele95")]) {
        const s = dc.settleChain(r, g);
        assert.deepStrictEqual({ settled: s.settled, confirmed: s.confirmed }, { settled: 0, confirmed: 0 }, page);
        assert.ok(s.lines.every((l) => l.reason === "the geometry found no marked point (a crosshair) to name the ends by"), page);
        assert.strictEqual(s.reply, r);
      }
    }
  });

  test("the lettering guard (D14 a iii): a reply whose ALIGNED lines the crosshairs contradict, or with no ALIGNED line at all, is never settled", () => {
    const swapped = reply("fervi25").replace("B C (vertical)", "B E (vertical)");
    assert.strictEqual(dc.settleChain(swapped, geo).settled, 0);
    assert.strictEqual(dc.settleChain(swapped, geo).lettersOk.primary, false);
    const noAligned = reply("fervi25").replace(/ALIGNED:[\s\S]*?\n\nCHAIN:/, "ALIGNED:\nnone\n\nCHAIN:");
    assert.strictEqual(dc.settleChain(noAligned, geo).settled, 0, "vacuous agreement is not agreement");
  });

  test("chainGeometryOf: the one region holding crosshairs and its claims with a span; two regions with crosshairs are ambiguous", () => {
    const g = dc.chainGeometryOf(geo.primary);
    assert.deepStrictEqual({ regions: g.regions, withPoints: g.regionsWithPoints, points: g.points.map((p) => p.letter).join(""), claims: g.claims.length }, { regions: 1, withPoints: 1, points: "BDAFCE", claims: 9 });
    const two = { regions: [geo.primary.regions[0], geo.primary.regions[0]] };
    assert.deepStrictEqual({ w: dc.chainGeometryOf(two).regionsWithPoints, p: dc.chainGeometryOf(two).points.length }, { w: 2, p: 0 });
    assert.match(dc.settleChain(reply("fervi25"), { primary: two, check: two }).lines[0].reason, /more than one drawing/);
    assert.strictEqual(dc.chainGeometryOf(null), null);
  });
});

describe("U-CHAIN (D6 a, D7): the block, as the DESCRIPTION's body — FQ01's six coordinates, no layout class", () => {
  const settled = dc.settleChain(reply("fervi25"), { primary: rg(FIG15, 200), check: rg(FIG15, 128) });
  const solved = dc.pointsFromChain(settled.reply);
  const block = dc.chainBlockText({ reply: settled.reply, solved });

  test("the block: the reply's POINTS MARKED / ALIGNED / CHAIN as read (the 1728 settled), the computed POINTS, the checked CLOSURE — the design probe's format (answer_probe.js computedBlock)", () => {
    assert.ok(block.startsWith("POINTS MARKED:\nA: left‑hand fastening point"));
    assert.ok(block.includes("\nfrom A to F (horizontal): 1728\n") && !block.includes("left edge to right edge"));
    assert.ok(!/\nCLOSURE:\n50 \+ 340/.test(block), "the reply's own CLOSURE is replaced by the checked one");
    assert.ok(block.endsWith(`POINTS (computed from the CHAIN, x from the left edge, y from the top edge):
A: x = 16, y = 220
B: x = 334, y = 50
C: x = 334, y = 390
D: x = 1516, y = 50
E: x = 1516, y = 390
F: x = 1744, y = 220

CLOSURE (checked):
50 + 340 + 50 = 440 vs the printed 440 ✓`));
    const asRead = dc.chainBlockText({ reply: reply("fervi25") });
    assert.ok(asRead.includes("D: not derivable (x unknown)\nE: not derivable (x unknown)\nF: not derivable (x unknown)"), "as read: named, never guessed");
    assert.ok(dc.chainBlockText({ reply: reply("miele95") }).includes("POINTS (computed from the CHAIN, x from the left edge, y from the top edge):\nnone — the drawing marks no points"));
  });

  test("D19 (b): the block replaces the DESCRIPTION only where it computes a point — Figure 15 (settled: six; as read: three), the chain by hand; never Miele p95, SSX125 p19 or a chain of edges alone (their accurate DESCRIPTIONs stand)", () => {
    assert.strictEqual(dc.chainReplacesDescription(solved), true, "Figure 15 settled");
    assert.strictEqual(dc.chainReplacesDescription(dc.pointsFromChain(reply("fervi25"))), true, "Figure 15 as read: A / B / C computed");
    assert.strictEqual(dc.chainReplacesDescription(dc.pointsFromChain(BY_HAND)), true);
    for (const p of ["miele95", "ssx19"]) assert.strictEqual(dc.chainReplacesDescription(dc.pointsFromChain(reply(p))), false, p);
    assert.strictEqual(dc.chainReplacesDescription(dc.pointsFromChain("CHAIN:\nfrom the left edge to the right edge (horizontal): 13")), false, "a total with no marked point computes nothing");
    assert.strictEqual(dc.chainReplacesDescription(null), false);
  });

  test("FQ01's own check reads the block: all six coordinate patterns match, no mustNotMatch pattern does — the block itself never carries the layout class", () => {
    const hit = FQ01.check.patterns.filter((p) => new RegExp(p, "m").test(block));
    assert.strictEqual(hit.length, 6);
    assert.deepStrictEqual(FQ01.check.mustNotMatch.filter((p) => new RegExp(p, "i").test(block)), []);
  });

  test("replaceDescription on Figure 15's production caption chunk: every byte before DESCRIPTION unchanged, the DESCRIPTION's 'two on each of three vertical lines' gone, the block under the existing label", () => {
    const cap = FIXTURE.captions.find((c) => c.source.startsWith("Fervi_Lathe") && c.page === 25).text;
    assert.ok(/two on each of three vertical lines/.test(cap));
    const out = dc.replaceDescription(cap, block);
    const at = cap.lastIndexOf("\nDESCRIPTION:") + 1;
    assert.strictEqual(out.slice(0, at), cap.slice(0, at));
    assert.strictEqual(out.slice(at), `DESCRIPTION:\n${block}`);
    assert.ok(!/two on each of three/.test(out));
    assert.deepStrictEqual(FQ01.check.mustNotMatch.filter((p) => new RegExp(p, "i").test(out)), [], "the chunk carries no layout-class phrase once the DESCRIPTION is the block");
    assert.strictEqual(dc.replaceDescription("TITLE: t\nTYPE: x", "B"), "TITLE: t\nTYPE: x\n\nDESCRIPTION:\nB", "a caption without a DESCRIPTION gains one");
    assert.strictEqual(dc.replaceDescription("TITLE: t\nTRANSCRIPTION:\nDESCRIPTION: a printed label\n\nDESCRIPTION: old", "B"), "TITLE: t\nTRANSCRIPTION:\nDESCRIPTION: a printed label\n\nDESCRIPTION:\nB", "the caption's LAST DESCRIPTION is its section");
  });
});

describe("U-CHAIN: the constants and the counts", () => {
  test("the pinned geometry (D14 a i–ii): render 4.0, ink 200, the cross-check at 128, crosshair naming within 2 pt; the clause (D5); the count keys in their order (new counts at the END)", () => {
    assert.deepStrictEqual({ ...dc.CHAIN_GEOMETRY }, { scale: 4.0, ink: 200, checkInk: 128, nameTolPt: 2.0 });
    assert.strictEqual(dc.CHAIN_BLOCK_RULE, "   - When a figure's context carries a CHAIN block, tabulate the POINTS (computed) as given, name the ones marked not derivable as such, and never describe a layout the block does not state.");
    assert.deepStrictEqual([...dc.CHAIN_COUNT_KEYS], ["chainPages", "chainNoDimensions", "chainCalls", "chainFromMemo", "chainFailed", "chainLines", "chainUnclear", "chainPointsDerived", "chainPointsNotDerivable", "chainClosureOk", "chainClosureFailed", "chainConfirmed", "chainSettled", "chainGeometryFailed", "chainBlocks", "chainMemoised"]);
    assert.deepStrictEqual([...dc.CHAIN_LIST_KEYS], ["chainPagesList", "chainFailedPages", "chainBlockPages", "chainSettledList"]);
    const t = dc.chainTraceOf(null);
    assert.deepStrictEqual(Object.keys(t), [...dc.CHAIN_COUNT_KEYS, ...dc.CHAIN_LIST_KEYS]);
    assert.ok(dc.CHAIN_COUNT_KEYS.every((k) => t[k] === 0));
    assert.deepStrictEqual(dc.chainTraceOf({ pages: 2, settled: 1, pagesList: [25, 39], settledList: [{ page: 25 }] }).chainPagesList, "25, 39");
  });

  test("the log's phrases: the solved chain and the geometry's shadow read", () => {
    const s = dc.pointsFromChain(reply("fervi25"));
    assert.strictEqual(dc.chainLogSummary(s, dc.parseChain(reply("fervi25"))), "9 line(s), 5 aligned, points 3 derived / 3 not derivable, closure x open y ✓");
    assert.strictEqual(dc.geometrySummary({ readings: { 200: rg(FIG15, 200), 128: rg(FIG15, 128) } }), "ink 128: 6 crosshair(s), 7 claim(s) with a span; ink 200: 6 crosshair(s), 9 claim(s) with a span");
    assert.strictEqual(dc.geometrySummary(null), "none");
  });
});
