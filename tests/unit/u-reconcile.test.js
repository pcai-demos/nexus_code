/**
 * U-RECONCILE — T47's text-layer label reconciliation (t47-design.md §2.1, §4; D1 a rule E, D2, D3, D7; F-176). Pure:
 * reads only what ships in the image — the module and the committed fixture (every caption of production v8 with its
 * page's indexed text, cut read-only on 2026-09-25: t47-artifacts/records/reconcile-fixture-1790352029.json).
 *   1. the corpus: exactly the seven substitutions of §0c, in caption order, each a proper noun the page prints; none
 *      other on 228 captions; the five captions without a text layer untouched; the output idempotent.
 *   2. the fourteen wrong substitutions of §0b (and the plan's other 17 candidates) never happen — each candidate of
 *      the plan's rule run on its own caption and page.
 *   3. the rule token by token on synthetic pages: the shape, the target, the allowance, the ambiguity, the inflection
 *      guard, the three guards, the sections in scope, once per occurrence, the empty page, determinism.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const B = (...p) => path.join(ROOT, "tests", "eval", "baselines", ...p);
const json = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const { reconcileCaption, reconcileToken, pageLexicon, scopeOf, levenshtein, stem } = require(path.join(ROOT, "src", "lib", "ingestion", "reconcile_labels.js"));
const FIX = json(B("t47-artifacts", "records", "reconcile-fixture-1790352029.json"));
const RULE_A = json(B("t47-artifacts", "probes", "records", "substitutions-1790345791.json"));
const RULE_E = json(B("t47-artifacts", "probes", "records", "substitutions-1790346015.json"));
/** The caption as the parser holds it at the seam: the memo's reply, without the chunk header the parser prepends later. */
const stripHeader = (text) => String(text).replace(/^\[HUMAN-LOGICAL VISUAL ELEMENT:[^\n]*\]:\n/, "");
const pageOf = (c) => FIX.pages[`${c.source}#${c.page}`];
const SEVEN = [
  ["Barratt_Homes_SitePlan.pdf", 1, "Huttondon", "Huntingdon", 3],
  ["Barratt_Homes_SitePlan.pdf", 1, "Osier", "Ostler", 2],
  ["Barratt_Homes_SitePlan.pdf", 1, "Guncaster", "Gumcester", 2],
  ["Fervi_Lathe_TechnicalSupportManual.pdf", 78, "Oilier", "Oiler", 1],
  ["Miele_washing_machine_manual.pdf", 23, "Woolens", "Woollens", 1],
  ["Miele_washing_machine_manual.pdf", 60, "Woolens", "Woollens", 1],
  ["Miele_washing_machine_manual.pdf", 68, "Cotions", "Cottons", 1],
];

describe("U-RECONCILE 1: the corpus fixture — the seven of §0c and none other (D1 a; acceptance 1 / 4)", () => {
  test("228 captions of production v8; 5 without a text layer; the seven substitutions in caption order, every one TRANSCRIPTION's; the pages print every target; the result idempotent", () => {
    assert.strictEqual(FIX.captions.length, 228);
    assert.strictEqual(Object.values(FIX.pages).filter((p) => p === null).length, 5, "the Site Plan's pages 3–7 (§0a)");
    const all = [];
    let untouched = 0;
    for (const c of FIX.captions) {
      const caption = stripHeader(c.text), page = pageOf(c);
      const r = reconcileCaption(caption, page === null ? "" : page);
      if (page === null) { assert.deepStrictEqual(r.substitutions, [], `${c.source} p${c.page}: no text layer`); assert.strictEqual(r.caption, caption); untouched++; continue; }
      for (const s of r.substitutions) { all.push([c.source, c.page, s.from, s.to, s.edits]); assert.deepStrictEqual(s.sections, ["TRANSCRIPTION"], `${c.source} p${c.page}: ${s.from} sits in the TRANSCRIPTION (no title on the corpus changes — §0d)`); assert.ok(new RegExp(`\\b${s.to}\\b`).test(page), `${c.source} p${c.page}: the page prints ${s.to}`); assert.ok(!new RegExp(`\\b${s.from}\\b`).test(r.caption.split("\n").filter((_, i) => s.lines.includes(i)).join("\n")), `${c.source} p${c.page}: ${s.from} replaced on its lines`); if (c.page === 68) assert.deepStrictEqual(s.lines, [7, 27], "Miele p68 prints the Cotions row twice: one substitution, two lines"); else assert.strictEqual(s.lines.length, 1); }
      const again = reconcileCaption(r.caption, page);
      assert.deepStrictEqual(again.substitutions, [], `${c.source} p${c.page}: idempotent`);
      assert.strictEqual(again.caption, r.caption);
    }
    assert.strictEqual(untouched, 5);
    assert.deepStrictEqual(all, SEVEN);
    assert.strictEqual(all.length, 7, "the ledger's captionSubstitutions sums to 7 on the corpus (acceptance 1)");
  });
  test("the fixture is the probe's corpus: the probe's rule-E list is the same seven, chunk for chunk", () => {
    assert.deepStrictEqual(RULE_E.ruleE.map((s) => [s.doc, s.page, s.from, s.to, s.dist]).sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2].localeCompare(b[2])), SEVEN.slice().sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2].localeCompare(b[2])));
    assert.strictEqual(RULE_E.totals.ruleE_D_plusGuards, 7);
    assert.strictEqual(RULE_E.totals.ruleDAmbiguous, 0);
    assert.deepStrictEqual(FIX.docVersions.map((v) => v.split(".")[1]), Array(13).fill("bfd9e449b930"), "cut on production v8");
  });
});

describe("U-RECONCILE 2: the plan's 31 candidates (§0b) — the fourteen wrong ones never happen; only the rule-E six among them are applied", () => {
  test("each candidate of the plan's rule A on its own caption and page: untouched unless rule E applies (Cotions, Osier, Guncaster, Oilier, Woolens ×2)", () => {
    assert.strictEqual(RULE_A.substitutions.length, 31);
    const applied = new Set(["Cotions", "Osier", "Guncaster", "Oilier", "Woolens"]);
    let refused = 0, kept = 0;
    for (const s of RULE_A.substitutions) {
      const c = FIX.captions.find((x) => x.source === s.doc && x.page === s.page && x.chunkIndex === s.chunkIndex);
      assert.ok(c, `${s.doc} p${s.page} #${s.chunkIndex} in the fixture`);
      const page = pageOf(c);
      assert.ok(page !== null, `${s.doc} p${s.page}: a text layer`);
      const r = reconcileCaption(stripHeader(c.text), page);
      const hit = r.substitutions.find((x) => x.from === s.from);
      if (applied.has(s.from)) { assert.ok(hit, `${s.doc} p${s.page}: ${s.from} → ${hit && hit.to} applied`); kept++; }
      else { assert.strictEqual(hit, undefined, `${s.doc} p${s.page}: ${s.from} → ${s.to} (the plan's rule) REFUSED`); refused++; }
    }
    assert.deepStrictEqual({ refused, kept }, { refused: 25, kept: 6 }, "25 of the plan's 31 refused (14 wrong, 2 glyph no-ops, 9 lower-case or all-caps misreads the narrower rule leaves — §0b, §0c), 6 applied; Huttondon is the seventh (3 edits, beyond the plan's reach)");
    const wrong = [["HOMES", "home"], ["SCREW", "screws"], ["selector", "selection"], ["PROTETTIVO", "protective"], ["PROTETTIVI", "protective"], ["PROTETTIVE", "protective"], ["housing", "using"], ["label", "panel"], ["within", "with"], ["right", "rigid"], ["WORLD", "works"], ["T-shirts", "shirts"], ["Replacement", "replacemen"], ["INSTALLATION", "instalation"]];
    for (const [from, to] of wrong) assert.ok(RULE_A.substitutions.some((s) => s.from === from && s.to === to), `${from} → ${to} is among the plan's candidates on record`);
  });
});

describe("U-RECONCILE 3: the rule token by token (§2.1)", () => {
  const PAGE = "Huntingdon\nGumcester Way\nOstler Drive\nCottons | Woollens | Delicates\nWindows may be omitted\nReplacemen t frequency\nMiele\u2019s IntenseClean\nHome and Homes\nT-shirts\nA1198";
  const cap = (title, transcription, description = "The map of Huttondon near Guncaster Way.") => `TITLE: ${title}\nTYPE: map or plan\nSUBJECTS: Huttondon, Guncaster Way\n\nTRANSCRIPTION:\n${transcription}\n\nDESCRIPTION: ${description}`;

  test("the TITLE line and the TRANSCRIPTION lines take the rule; SUBJECTS and DESCRIPTION never (D2); the records carry the section, the line, the edit count", () => {
    const r = reconcileCaption(cap("Huttondon site plan", "Huttondon\nGuncaster Way\nOsier Drive\nA108"), PAGE);
    assert.deepStrictEqual(r.substitutions, [
      { from: "Huttondon", to: "Huntingdon", edits: 3, sections: ["TITLE", "TRANSCRIPTION"], lines: [0, 5] },
      { from: "Guncaster", to: "Gumcester", edits: 2, sections: ["TRANSCRIPTION"], lines: [6] },
      { from: "Osier", to: "Ostler", edits: 2, sections: ["TRANSCRIPTION"], lines: [7] },
    ]);
    assert.strictEqual(r.caption, "TITLE: Huntingdon site plan\nTYPE: map or plan\nSUBJECTS: Huttondon, Guncaster Way\n\nTRANSCRIPTION:\nHuntingdon\nGumcester Way\nOstler Drive\nA108\n\nDESCRIPTION: The map of Huttondon near Guncaster Way.");
    assert.deepStrictEqual(scopeOf(r.caption.split("\n")).map((s) => [s.index, s.section]), [[0, "TITLE"], [5, "TRANSCRIPTION"], [6, "TRANSCRIPTION"], [7, "TRANSCRIPTION"], [8, "TRANSCRIPTION"], [9, "TRANSCRIPTION"]], "the blank line inside the block is in scope (harmless); the DESCRIPTION line ends it");
    const inline = reconcileCaption("HUMAN TITLE: Osier Drive\nTRANSCRIPTION: Guncaster Way\nDESCRIPTION: Guncaster Way.", PAGE);
    assert.deepStrictEqual(inline.substitutions.map((s) => [s.sections, s.lines, s.from]), [[["TITLE"], [0], "Osier"], [["TRANSCRIPTION"], [1], "Guncaster"]], "the legacy label and a transcription that starts on the label's line");
    assert.strictEqual(inline.caption, "HUMAN TITLE: Ostler Drive\nTRANSCRIPTION: Gumcester Way\nDESCRIPTION: Guncaster Way.");
  });

  test("the shape and the target: proper-noun-shaped only (never all-caps, never lower-case), ≥ 5 letters, no digit; a CAPITALISED printed target only; a word the page prints is left alone", () => {
    const lex = pageLexicon(PAGE);
    assert.strictEqual(reconcileToken("HOMES", lex, 5), null, "all-caps");
    assert.strictEqual(reconcileToken("homes", lex, 5), null, "lower-case");
    assert.strictEqual(reconcileToken("Osir", lex, 5), null, "under five letters");
    assert.strictEqual(reconcileToken("A108", lex, 5), null, "a code (§0e — never touched)");
    assert.strictEqual(reconcileToken("Huntingdon", lex, 5), null, "the page's own word");
    assert.deepStrictEqual(reconcileToken("Huttondon", lex, 5), { to: "Huntingdon", edits: 3 });
    const lexLower = pageLexicon("delicates woollens cottons");
    assert.strictEqual(reconcileToken("Woolens", lexLower, 5), null, "a lower-case printed word is never a target (rule E: a capitalised target)");
  });

  test("the allowance and the ambiguity: ≤ 2 edits, ≤ 3 from 8 characters, the lengths within the allowance; two candidates → untouched", () => {
    assert.deepStrictEqual(reconcileToken("Osier", pageLexicon("Ostler"), 5), { to: "Ostler", edits: 2 });
    assert.strictEqual(reconcileToken("Osier", pageLexicon("Ostlers"), 5), null, "three edits on a five-letter token");
    assert.strictEqual(reconcileToken("Osier", pageLexicon("Ostler Oiler"), 5), null, "Ostler AND Oiler within two edits: ambiguous, untouched");
    assert.deepStrictEqual(reconcileToken("Guncaster", pageLexicon("Gumcester"), 5), { to: "Gumcester", edits: 2 });
    assert.strictEqual(reconcileToken("Cotions", pageLexicon("Cottons Cotton"), 5), null, "two candidates within reach: ambiguous, untouched");
    assert.deepStrictEqual(reconcileToken("Cotions", pageLexicon("Cottons"), 5), { to: "Cottons", edits: 1 });
    assert.strictEqual(levenshtein("huttondon", "huntingdon", 3), 3);
    assert.strictEqual(levenshtein("abc", "abcdefg", 2), 3, "capped: the lengths alone exceed it");
  });

  test("the inflection guard and the three guards: an inflectional pair, a glyph-only pair, a truncated-prefix target, a hyphen-free twin — all untouched", () => {
    assert.strictEqual(reconcileToken("Window", pageLexicon("Windows"), 5), null, "Window ~ Windows: an inflection");
    assert.strictEqual(reconcileToken("Dimension", pageLexicon("Dimensions"), 5), null);
    assert.strictEqual(stem("Windows"), stem("Window"));
    assert.strictEqual(reconcileToken("Miele's", pageLexicon("Miele’s"), 5), null, "a glyph-only pair (apostrophes)");
    assert.strictEqual(reconcileToken("Replacement", pageLexicon("Replacemen t frequency"), 5), null, "the layer's broken token is a truncated prefix (F-192)");
    assert.strictEqual(reconcileToken("Close-up", pageLexicon("Close"), 5), null, "a truncated prefix again");
    assert.strictEqual(reconcileToken("T-shirts", pageLexicon("Tshirts Tshirt"), 5), null, "the hyphen-free twin is on the page");
    assert.deepStrictEqual(reconcileToken("Woolens", pageLexicon("Woollens"), 5), { to: "Woollens", edits: 1 }, "…and a plain misread still goes");
  });

  test("once per occurrence on a line, one record per token and line; an empty page or no text layer leaves everything; deterministic and idempotent", () => {
    const r = reconcileCaption("TRANSCRIPTION:\nWoolens | Woolens | Cotions", "Woollens Cottons");
    assert.strictEqual(r.caption, "TRANSCRIPTION:\nWoollens | Woollens | Cottons");
    assert.deepStrictEqual(r.substitutions, [{ from: "Woolens", to: "Woollens", edits: 1, sections: ["TRANSCRIPTION"], lines: [1] }, { from: "Cotions", to: "Cottons", edits: 1, sections: ["TRANSCRIPTION"], lines: [1] }]);
    const twice = reconcileCaption("TRANSCRIPTION:\nCotions | x\nCotions | y", "Cottons");
    assert.deepStrictEqual(twice.substitutions, [{ from: "Cotions", to: "Cottons", edits: 1, sections: ["TRANSCRIPTION"], lines: [1, 2] }], "a row printed twice: one substitution, two lines (Miele p68)");
    assert.strictEqual(twice.caption, "TRANSCRIPTION:\nCottons | x\nCottons | y");
    const none = reconcileCaption("TITLE: Huttondon\nTRANSCRIPTION:\nGuncaster Way", "");
    assert.deepStrictEqual(none, { caption: "TITLE: Huttondon\nTRANSCRIPTION:\nGuncaster Way", substitutions: [] });
    assert.deepStrictEqual(reconcileCaption("TITLE: Huttondon", "   \n"), { caption: "TITLE: Huttondon", substitutions: [] });
    const a = reconcileCaption(cap("Huttondon", "Guncaster Way"), PAGE), b = reconcileCaption(cap("Huttondon", "Guncaster Way"), PAGE);
    assert.deepStrictEqual(a, b, "deterministic");
    assert.deepStrictEqual(reconcileCaption(a.caption, PAGE).substitutions, [], "idempotent");
    assert.deepStrictEqual(reconcileCaption("[NO_VISUAL_CONTENT]", PAGE), { caption: "[NO_VISUAL_CONTENT]", substitutions: [] }, "a verdict line has no section in scope");
  });
});
