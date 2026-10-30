/**
 * U-FIGCHECK — the frontier set as a standing gate (ticket T44, t44-design.md §2, §4; D1 a, D2 a, D4 a; F-174,
 * F-175, F-177). Pure: reads only what ships in the image — the evaluator, the set file, the committed records.
 *
 *   1. `mustNotMatch` — any hit FAILS the check, every hit is recorded with the words that hit, no list evaluates as
 *      before (byte for byte).
 *   2. the labelled band `{ label, range: [lo, hi] }` — a decimal and its rounded integer inside pass, one outside
 *      fails, the number must sit on the label's line, thousands separators tolerated, the label word-bounded, the
 *      old `{ value, tolerance }` form untouched beside it.
 *   3. the FS-2 class string in the set EQUALS compare_dryrun.js's CONFLICT source (they cannot drift); the set is
 *      what set_v5.js writes (T45: FQ06 gains the Halton's 8 beside the Denby's 3 — t45-design.md D10; F-204: FQ01's
 *      layout class gains four spellings found on record — the owner's D4 (b); F-211: six more — the owner's D4 (a) of
 *      2026-09-28); the six bands are the band probe's record, never by hand.
 *   4. the TWELVE recorded frontier answers of the design's §0d read RED / RED / GREEN through the real evaluator
 *      and the real set entries — the strongest pin: a change to the checks that lets today's FS-1 or FS-2 answer
 *      pass is a red unit test.
 *   5. every non-frontier turn of the last chain's figure records (T18's chain, 2026-09-23, arm D ×2) gets the
 *      same verdict from the new evaluator as the record carries (acceptance 3); FQ01 reads RED under the new check
 *      on the same records (design §7 risk 4: the T32 judge's regression rule sees RED → RED).
 *   6. the runner's production guard — `--production` lifts the RAGEval-only guard for the `frontier` ids ONLY;
 *      every other id, a class under --production, a non-RAGEval class, a bad scope are refused before a request.
 *   7. the frontier judge's pure core — the pair per question, RED / RED / GREEN and exit 1 on today's answers,
 *      exit 0 when all are green, before → after cells, T43's columns from `timing` and the labelled fallbacks.
 *   8. scores.json — the comparison's tuples verbatim, each summing to its total; the four totals 37 / 84 / 78 / 70.
 *   9. F-189 (b) (the owner's choice, 2026-09-25 — the harness PR of the T46 + T47 window): a WORDED must-not-match on a
 *      check that names its subject (FQ11's Denby) counts only in a sentence that names the Denby or one of its plots
 *      and is not negated; FQ01 (no subject) is byte for byte T44's. The recorded negated answers (the class gate's
 *      document cell of session 55, production's corpus cells after the v8 and v9 re-ingests) read GREEN with the
 *      discounted words on record; THE CENSUS (below) — every FS-2 cell on record through T44's reading, F-189 (b) alone,
 *      + F-199 (a), + F-206 (c), + F-209 and the judge (+ F-220 + F-221), and the judge on the text before F-202 / F-203 (b);
 *      the forms;
 *      the shape (since F-211 FQ01 reads each hit for a negation); the class vocabulary partitioned.
 *  10. F-199 (a) (the owner's choice, 2026-09-26 — the range rule only, the harness PR before T48): on the same checks a
 *      plot number (\b301\b, \b303\b) still fails on any mention EXCEPT as the end of a range ("plots 301–308", "from
 *      301 through 318"). The two recorded range answers (T46's chain arm D FQ11 run 1; production's document cell after
 *      the v9 re-ingest — both right: 302, 304, 313, the count 3) read GREEN with the range on record; production's
 *      post-v9 gate re-judged GREEN in all six cells; the forms (a dash, "to", "through", an arrow; a range inside a
 *      Denby sentence; 301 named as a Denby still RED; lists never ranges); the residue stated (a hedge worded only as a
 *      range reads GREEN — none on record); gates35's FQ11 line gating T35's own facts, re-judged on T46's chain.
 *  11. T48 (t48-design.md §3, D10; F-205) — the gate as a RATE: the runner's `--repeat N` (N passes, each turn its
 *      `repeat`) and `--beyond-the-documents` (request-level), refused when malformed before any request; the judge reads
 *      N runs per cell as "GREEN k / N" with every run's own cell — session 60's sampled BEFORE reads FS-1 GREEN 6 / 10,
 *      F-205's number — and a record without repeats exactly as before (the post-v9 gate GREEN × 6, exit 0).
 *  12. F-206 (c), F-202, F-203 (b), F-204 (b) (the owner's D1–D4, 2026-09-27 — the FS-2 judge's harness PR after T48): a
 *      plot number written as ANOTHER design's plot ("301 (The Halton)", "303 being The Halton") is discounted with the
 *      design recorded — T48's three right answers read GREEN and T48's two gate records re-judge FS-2 GREEN 10 / 10 in
 *      both states (the by-hand count); the forms (an attribution naming the Denby, a Denby plot, a second design or a
 *      word of doubt — or a doubt in its sentence — still counts; a negated attribution, a table row, a shared one); the
 *      residue stated; "No." / "Nos." before a digit keeps its sentence; the thousands rule ("1,072" and "1 744" join,
 *      "301,303" and "(1744,220)" stay two numbers — every FS-1 / FS-3 verdict of the runner records unchanged); FQ01's
 *      four new spellings on the recorded answers (three probe answers RED, "four vertical columns" never a hit, no gate
 *      record's verdict moved under set v4); since set v5, T48's setting-off gate reads FS-1 9 / 10 (F-211, by hand).
 *  13. F-209 + F-211 (the owner's D1–D4, 2026-09-28 — the judge's harness PR after T53, measured first by
 *      frontier-artifacts/f209/measure_f209.js): a plot PLACED, not claimed — "between roughly 301 and 314" (D1), the
 *      design named first "The Halton (301, 303)" (D2), a neighbour list "near plots 301, 303, 305" (D3) — the six right
 *      answers on record GREEN with each discount, T52's leg FS-2 10 / 10; the forms, the guards, the residue, the helpers;
 *      FQ01's layout class in set v5 (six spellings) read for a negation (D4) — every wrong layout on record RED (25 by
 *      hand), no right answer a spelling touches, the gate records re-based (T48's setting off, T53's setting on: FS-1
 *      9 / 10); THE FS-1 CENSUS of the runner records.
 *  14. F-220 + F-221 (the owner's D1 (a) / D2 (a), 2026-09-29 — the judge's harness PR after T57, measured first by
 *      frontier-artifacts/f220/measure_f220.js): a doubt word in a clause that DENIES doubt is not a hedge — production's
 *      v10 FS-2 document cell ("The counts were cross-checked against the conflict list to confirm no ambiguity for the
 *      three Denby plots.") reads GREEN and the v10 gate GREEN in all six cells; a negation reaches its OWN doubt word —
 *      "There is no ambiguity in the conflict list about whether a fourth plot may be a Denby" reads RED; the forms, the
 *      guards, the residue, the helpers; FQ01 and every FS-2 cell on record under F-221 alone unchanged.
 *
 * THE CENSUS GROWS WITH THE RECORDS (F-201 — the owner's D3 (a), 2026-09-26). Case 9's census walks every `fs-*` /
 * `fsclass-*` / `figq-*` record under tests/eval/baselines, so a NEW gate record can add a flip under any rule, and
 * this suite then reads RED until the flip is named. Case 13's FS-1 census does the same for FQ01's layout class (the
 * `fs-*` / `fs1-*` / `fsclass-*` / `figq-*` records: a new wrong-layout spelling, read by hand, is named there). That is the design, not a defect: a flip is READ BY HAND against
 * the truth (the Denby = plots 302, 304, 313, the count 3; 301 / 303 are the Halton's) and, only when the answer is
 * right, named in the census's list for its rule with the record, the scope and why — never accepted silently, never
 * named from the verdict alone. So run `npm test` BEFORE committing ANY gate record, records-only commits included (a
 * records-only commit turned `main` red once — session 59, `386cfbd`); `frontier-artifacts/fs2_census.js` prints every
 * flip and every discounted occurrence with its sentence for that read.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const B = (...p) => path.join(ROOT, "tests", "eval", "baselines", ...p);
const json = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const { evaluateCheck, bandOnLine, normalise, subjectOf, isWorded, sentencesOf, negated, rangeEndpoints, DOUBT_WORD } = require(B("workshop-artifacts", "ab", "figure_checks.js"));
const { CONFLICT } = require(B("t37-artifacts", "d4", "compare_dryrun.js"));
const { judgeRecord, timingCell } = require(B("frontier-artifacts", "frontier_gate.js"));
const SET_PATH = B("workshop-artifacts", "figure_questions.json");
const set = json(SET_PATH);
const q = (id) => { const e = set.questions.find((x) => x.id === id); if (!e) throw new Error(`no ${id}`); return e; };
const FRONTIER = ["FQ01", "FQ11", "FQ12"];

describe("U-FIGCHECK 1: mustNotMatch — any hit fails, the hits recorded (D1 a)", () => {
  test("a hit fails the check even when every pattern matches; the words that hit are recorded, normalised (× → x, ** gone)", () => {
    const check = { patterns: ["fastening"], mustNotMatch: ["three vertical lines", "two (?:feet|points) on each", "3 ?[x×] ?2 grid"] };
    const v = evaluateCheck(check, "The six **fastening** points sit two feet on each of **three vertical lines** — a 3 × 2 grid.");
    assert.strictEqual(v.pass, false);
    assert.strictEqual(v.matches, 1);
    assert.deepStrictEqual(v.detail.mustNotMatch, [
      { pattern: "three vertical lines", match: "three vertical lines" },
      { pattern: "two (?:feet|points) on each", match: "two feet on each" },
      { pattern: "3 ?[x×] ?2 grid", match: "3 x 2 grid" },
    ]);
  });

  test("case-insensitive; no hit passes with an empty list recorded", () => {
    const check = { patterns: ["fastening"], mustNotMatch: ["three vertical lines"] };
    assert.strictEqual(evaluateCheck(check, "fastening points on Three Vertical Lines").pass, false);
    const v = evaluateCheck(check, "six fastening points on four transverse lines: 1 + 2 + 2 + 1");
    assert.strictEqual(v.pass, true);
    assert.deepStrictEqual(v.detail.mustNotMatch, []);
  });

  test("the FS-2 shape: 3 / 3 plots, the count of 3, and ONE false alarm still fails", () => {
    const check = { patterns: ["\\b302\\b", "\\b304\\b", "\\b313\\b"], minMatches: 3, counts: [{ label: "Denby", value: 3 }], mustNotMatch: ["\\b301\\b", "\\b303\\b"] };
    const clean = evaluateCheck(check, "The Denby: 3 plots — 302, 304 and 313.");
    assert.strictEqual(clean.pass, true);
    assert.deepStrictEqual(clean.detail.counts, [{ label: "Denby", value: 3, ok: true }]);
    const hedged = evaluateCheck(check, "The Denby: 3 plots — 302, 304 and 313. Plot 301 may also be a Denby.");
    assert.strictEqual(hedged.pass, false);
    assert.strictEqual(hedged.matches, 3);
    assert.deepStrictEqual(hedged.detail.counts[0].ok, true);
    assert.deepStrictEqual(hedged.detail.mustNotMatch, [{ pattern: "\\b301\\b", match: "301" }]);
  });

  test("no list: the verdict object is exactly the T33 shape plus an empty mustNotMatch (the sixteen other questions)", () => {
    assert.deepStrictEqual(evaluateCheck({ patterns: ["once a day", "oil[- ]level window"], minMatches: 2 }, "Top up once a day through the oil-level window."), {
      pass: true, matches: 2, needed: 2, detail: { matched: ["once a day", "oil[- ]level window"], missed: [], totals: [], table: null, counts: [], mustNotMatch: [] },
    });
  });
});

describe("U-FIGCHECK 2: the labelled band — a line naming the label carries a number inside [lo, hi] (D2 a)", () => {
  const ellerton = { patterns: ["Ellerton"], totals: [{ label: "Ellerton", range: [698, 719] }] };
  const total = (answer) => evaluateCheck(ellerton, answer).detail.totals[0];

  test("the decimal and its rounded integer both pass; the band's edges pass; outside fails", () => {
    assert.deepStrictEqual(total("| The Ellerton | 3 | 2 | 8 | ≈ 698.5 |"), { label: "Ellerton", range: [698, 719], found: 698.5, ok: true, lines: 1 });
    assert.deepStrictEqual(total("| The Ellerton | 3 | 2 | 8 | ≈ 698 |"), { label: "Ellerton", range: [698, 719], found: 698, ok: true, lines: 1 });
    assert.strictEqual(total("Ellerton: 718.0 sq ft from the millimetres").found, 718);
    assert.strictEqual(total("Ellerton 719").ok, true);
    assert.deepStrictEqual(total("| The Ellerton | 3 | 2 | 8 | ≈ 697.9 |"), { label: "Ellerton", range: [698, 719], found: null, ok: false, lines: 1 });
    assert.strictEqual(total("Ellerton total 720 sq ft").ok, false);
    assert.strictEqual(evaluateCheck(ellerton, "Ellerton 720").pass, false, "a total outside the band fails the check");
  });

  test("the number must sit on the label's line; the label is word-bounded; thousands separators are dropped", () => {
    assert.deepStrictEqual(total("The Ellerton\n698.5 sq ft"), { label: "Ellerton", range: [698, 719], found: null, ok: false, lines: 1 });
    const chester = evaluateCheck({ patterns: ["Chester"], totals: [{ label: "Chester", range: [860, 867] }] }, "Chesterfield 860").detail.totals[0];
    assert.deepStrictEqual(chester, { label: "Chester", range: [860, 867], found: null, ok: false, lines: 0 });
    const alderney = evaluateCheck({ patterns: ["Alderney"], totals: [{ label: "Alderney", range: [1071, 1072] }] }, "| The Alderney | 4 | 2 | 10 | ≈ 1,072 |").detail.totals[0];
    assert.deepStrictEqual(alderney, { label: "Alderney", range: [1071, 1072], found: 1072, ok: true, lines: 1 });
    assert.strictEqual(total("ELLERTON — about 700 square feet").ok, true, "case-insensitive label");
    assert.deepStrictEqual(bandOnLine(normalise("x\nEllerton 1,072\nEllerton 700"), "Ellerton", [698, 719]), { found: 700, ok: true, lines: 2 }, "the first line in band wins; every line naming it is counted");
  });

  test("the old { value, tolerance } form is untouched beside a band", () => {
    const check = { patterns: ["Chester"], totals: [{ label: "ground floor sq ft", value: 436.7, tolerance: 0.02 }, { label: "Chester", range: [860, 867] }] };
    const v = evaluateCheck(check, "Chester ground floor 437 sq ft; total: 860.4 sq ft for the Chester");
    assert.deepStrictEqual(v.detail.totals, [
      { label: "ground floor sq ft", value: 436.7, found: 437, ok: true },
      { label: "Chester", range: [860, 867], found: 860.4, ok: true, lines: 1 },
    ]);
    assert.strictEqual(v.pass, true);
  });
});

describe("U-FIGCHECK 3: the set — version 5, the frontier ids, the class string, the bands from the probe, FQ06's two counts, FQ01's eighteen spellings", () => {
  test("version 5; FQ01 = FS-1, FQ11 = FS-2, FQ12 = FS-3; no other entry carries frontier or mustNotMatch or a band", () => {
    assert.strictEqual(set.version, 5);
    assert.deepStrictEqual(set.questions.filter((x) => x.frontier).map((x) => [x.id, x.frontier]), [["FQ01", "FS-1"], ["FQ11", "FS-2"], ["FQ12", "FS-3"]]);
    for (const x of set.questions) {
      if (FRONTIER.includes(x.id)) continue;
      assert.ok(!x.check.mustNotMatch, `${x.id} has no mustNotMatch`);
      assert.ok(!(x.check.totals || []).some((t) => Array.isArray(t.range)), `${x.id} has no band total`);
    }
    assert.strictEqual(set.questions.length, 19);
  });

  test("FQ11's third must-not-match IS compare_dryrun.js's CONFLICT source (the same string, so they cannot drift); the flags are i", () => {
    assert.ok(CONFLICT instanceof RegExp);
    assert.strictEqual(CONFLICT.flags, "i");
    assert.deepStrictEqual(q("FQ11").check.mustNotMatch, ["\\b301\\b", "\\b303\\b", CONFLICT.source]);
    assert.deepStrictEqual(q("FQ11").check.counts, [{ label: "Denby", value: 3 }]);
    assert.deepStrictEqual(q("FQ11").check.patterns, ["\\b302\\b", "\\b304\\b", "\\b313\\b"]);
  });

  test("T45 (t45-design.md D10): FQ06's counts are the page's — the Denby 3 AND the Halton 8 (301 / 303 settled by the tile edge); the check reads a line naming the design with the number", () => {
    assert.deepStrictEqual(q("FQ06").check.counts, [{ label: "Denby", value: 3 }, { label: "Halton", value: 8 }]);
    assert.strictEqual(q("FQ06").mode, "record", "FQ06 stays a record question for the T32 judge; the frontier judge does not read it");
    const v = evaluateCheck(q("FQ06").check, "| The Denby | 3 |\n| The Halton | 8 |\n" + q("FQ06").check.patterns.join(", "));
    assert.deepStrictEqual(v.detail.counts, [{ label: "Denby", value: 3, ok: true }, { label: "Halton", value: 8, ok: true }]);
    assert.strictEqual(v.pass, true);
    const six = evaluateCheck(q("FQ06").check, "| The Denby | 3 |\n| The Halton | 6 |\n" + q("FQ06").check.patterns.join(", "));
    assert.deepStrictEqual(six.detail.counts, [{ label: "Denby", value: 3, ok: true }, { label: "Halton", value: 8, ok: false }], "the pre-T45 chunk's 6 fails the count (F-175)");
    assert.strictEqual(six.pass, false);
  });

  test("FQ01: the six coordinates, all required, and the layout class in eighteen spellings (five from the record, three from the first live pass, four from F-204's census, six from F-211's by-hand read — appended)", () => {
    const c = q("FQ01").check;
    assert.strictEqual(c.minMatches, 6);
    assert.deepStrictEqual(c.patterns.map((p) => p.replace(/^\(\^\|\[\^0-9\]\)/, "").replace(/\(\[\^0-9\]\|\$\)$/, "").replace(/,\?/g, "")), ["334", "1516", "1744", "390", "220", "16"]);
    assert.deepStrictEqual(c.mustNotMatch, ["three vertical lines", "two (?:feet|points) on each", "3[- ]column", "three columns", "3 ?[x×] ?2 grid", "three transverse(?: \\([^)]*\\))? lines", "two on each of three", "each line carries two", "three vertical columns", "three fastening columns", "three foot columns", "three horizontal column", "2 ?[x×] ?3 grid", "2-2-2", "three-column", "two-column, three-row", "2-3-1", "two (?:rows|columns) of three"]);
    // The sixth spelling, from the first live pass (session 51): the parenthetical inside the phrase must not hide it.
    const sixth = evaluateCheck(c, "334, 1516, 1744, 390, 220, 16 — six points (two on each of three transverse lines). Three transverse (width-wise) lines run across the 440 mm depth; each line carries two fastening points.");
    // Hits are recorded in LIST order (the pattern's first match in the text): "three transverse lines" is the phrase's first occurrence.
    assert.deepStrictEqual(sixth.detail.mustNotMatch.map((h) => h.match), ["three transverse lines", "two on each of three", "each line carries two"]);
    assert.deepStrictEqual(evaluateCheck(c, "Three transverse (width-wise) lines carry the feet.").detail.mustNotMatch.map((h) => h.match), ["Three transverse (width-wise) lines"], "the parenthetical inside the phrase does not hide it");
    assert.strictEqual(sixth.pass, false, "all six coordinates present and the wrong layout still fails (D1 a)");
    const right = evaluateCheck(c, "Six points on four transverse lines (1 + 2 + 2 + 1): A 16/220, B 334/50, C 334/390, D 1516/50, E 1516/390, F 1744/220; the two inboard lines carry two points each.");
    assert.deepStrictEqual({ pass: right.pass, matches: right.matches, hits: right.detail.mustNotMatch }, { pass: true, matches: 6, hits: [] }, "a right answer with the six coordinates passes");
  });

  test("FQ12's six bands are the band probe's record (band-1790256178.json), min / max of the ft-in and mm sums — the mm sum the SMALLER on the Kingsville and the Alderney", () => {
    const band = json(B("t44-artifacts", "probes", "records", "band-1790256178.json"));
    const c = q("FQ12").check;
    assert.strictEqual(c.requireTable, true);
    assert.strictEqual(c.minMatches, 6);
    assert.deepStrictEqual(c.totals, ["Ellerton", "Chester", "Kingsville", "Alderney", "Hesketh", "Radleigh"].map((d) => ({ label: d, range: band.designs[d].band })));
    // The record's `ftinSum` / `mmSum` are printed to one decimal; the band was computed from the unrounded sums (the
    // Ellerton's mm sum is 718.04 — it prints 718.0 and ceils to 719), so the band is read from the record, never
    // re-derived from the printed sums: the pin is containment plus the per-room sums (two decimals) closing on it.
    for (const [d, b] of Object.entries(band.designs)) {
      assert.ok(b.band[0] <= Math.min(b.ftinSum, b.mmSum) && b.band[1] >= Math.max(b.ftinSum, b.mmSum), `${d}: the band contains both sums`);
      const ft = b.roomsDetail.reduce((a, r) => a + r.ftinSqFt, 0), mm = b.roomsDetail.reduce((a, r) => a + r.mmSqFt, 0);
      assert.deepStrictEqual(b.band, [Math.floor(Math.min(ft, mm)), Math.ceil(Math.max(ft, mm))], `${d}: [floor(min), ceil(max)] of the room sums ${ft.toFixed(2)} / ${mm.toFixed(2)}`);
      assert.strictEqual(b.roomsDetail.length, b.rooms, `${d}: ${b.rooms} rooms`);
    }
    assert.ok(band.designs.Kingsville.mmSum < band.designs.Kingsville.ftinSum && band.designs.Alderney.mmSum < band.designs.Alderney.ftinSum, "the two designs where the printed conversions round up");
    assert.deepStrictEqual(c.totals.map((t) => t.range), [[698, 719], [860, 867], [982, 984], [1071, 1072], [993, 996], [1165, 1177]]);
  });

  test("the set is what set_v5.js writes (never by hand)", () => {
    const r = spawnSync(process.execPath, [B("frontier-artifacts", "f209", "set_v5.js"), "--check"], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  });
});

// The twelve answers of t44-design.md §0d: the design probe (stamp 1790250510, the post-v7 image), T43's after probe
// (1790254993, the T43 image), the FS-3 probe (1790256178, the T43 image), and the two dry runs' Q12.
const RAW = (dir, fsId, scope, stamp) => json(path.join(dir, `fs-${fsId}-${scope}-${stamp}.json`)).response.response;
const DESIGN = B("t43-artifacts", "probes", "records"), AFTER = B("t43-artifacts", "records", "after"), FS3 = B("t44-artifacts", "probes", "records");
const TWELVE = [
  ...["corpus", "document"].map((s) => ({ fs: "FS-1", id: "FQ01", name: `design probe ${s}`, answer: RAW(DESIGN, "FS-1", s, 1790250510) })),
  ...["corpus", "document"].map((s) => ({ fs: "FS-2", id: "FQ11", name: `design probe ${s}`, answer: RAW(DESIGN, "FS-2", s, 1790250510) })),
  ...["corpus", "document"].map((s) => ({ fs: "FS-1", id: "FQ01", name: `after probe ${s}`, answer: RAW(AFTER, "FS-1", s, 1790254993) })),
  ...["corpus", "document"].map((s) => ({ fs: "FS-2", id: "FQ11", name: `after probe ${s}`, answer: RAW(AFTER, "FS-2", s, 1790254993) })),
  ...["corpus", "document"].map((s) => ({ fs: "FS-3", id: "FQ12", name: `FS-3 probe ${s}`, answer: RAW(FS3, "FS-3", s, 1790256178) })),
  { fs: "FS-3", id: "FQ12", name: "post-v7 dry run Q12", answer: json(B("t18-artifacts", "records", "reingest", "t32-dryrun-after-1790200001.json")).turns.find((t) => t.n === 12).answer },
  { fs: "FS-3", id: "FQ12", name: "T43 dry run Q12", answer: json(path.join(AFTER, "dryrun-1790254993.json")).turns.find((t) => t.n === 12).answer },
];

describe("U-FIGCHECK 4: the twelve recorded frontier answers read RED / RED / GREEN through the real evaluator and the real set (§0d)", () => {
  test("twelve answers on record: eight RED (FS-1 ×4, FS-2 ×4), four GREEN (FS-3 ×4)", () => {
    assert.strictEqual(TWELVE.length, 12);
    const verdicts = TWELVE.map((a) => ({ fs: a.fs, pass: evaluateCheck(q(a.id).check, a.answer).pass }));
    assert.deepStrictEqual(verdicts.filter((v) => v.fs === "FS-1").map((v) => v.pass), [false, false, false, false]);
    assert.deepStrictEqual(verdicts.filter((v) => v.fs === "FS-2").map((v) => v.pass), [false, false, false, false]);
    assert.deepStrictEqual(verdicts.filter((v) => v.fs === "FS-3").map((v) => v.pass), [true, true, true, true]);
  });

  test("FS-1 ×4: 2 of the six coordinates (220 and 16 — the printed ones) and the layout class hit, every answer", () => {
    for (const a of TWELVE.filter((x) => x.fs === "FS-1")) {
      const v = evaluateCheck(q("FQ01").check, a.answer);
      assert.strictEqual(v.matches, 2, `${a.name}: ${v.matches} of 6`);
      assert.strictEqual(v.needed, 6);
      assert.deepStrictEqual(v.detail.matched, ["(^|[^0-9])220([^0-9]|$)", "(^|[^0-9])16([^0-9]|$)"], `${a.name}: only the two printed coordinates`);
      assert.ok(v.detail.mustNotMatch.some((h) => h.pattern === "three vertical lines"), `${a.name}: "three vertical lines" hit`);
      assert.ok(v.detail.mustNotMatch.some((h) => h.pattern === "two (?:feet|points) on each"), `${a.name}: "two feet/points on each" hit`);
    }
  });

  test("FS-2 ×4: 3 / 3 plots and the count of 3 — and 301, 303 and the conflict class hit, every answer", () => {
    for (const a of TWELVE.filter((x) => x.fs === "FS-2")) {
      const v = evaluateCheck(q("FQ11").check, a.answer);
      assert.strictEqual(v.matches, 3, a.name);
      assert.deepStrictEqual(v.detail.counts, [{ label: "Denby", value: 3, ok: true }], `${a.name}: the count`);
      assert.deepStrictEqual(v.detail.mustNotMatch.map((h) => h.pattern), ["\\b301\\b", "\\b303\\b", CONFLICT.source], `${a.name}: the two false alarms and the class`);
      // F-189 (b): the recorded hit is the class word that COUNTS — "conflict", in a sentence naming the Denby, on every
      // one; the "Ambiguous / Conflict" headers and the "unambiguously" assertions are discounted beside it.
      assert.match(v.detail.mustNotMatch[2].match, /^conflict$/i, `${a.name}: the class word that counts`);
      const worded = v.detail.mustNotMatchDiscounted.filter((d) => d.reason !== "a range endpoint");
      assert.ok(worded.length >= 3 && worded.every((d) => /^(ambiguous|conflict|one design or the other)$/i.test(d.match) && /^(negated|not about the subject|negated, not about the subject)$/.test(d.reason)), `${a.name}: the discounted occurrences ${JSON.stringify(worded.map((d) => [d.match, d.reason]))}`);
      // F-199 (a): the "301" of "All five candidate plots (301–304 and 313) sit in the same cluster" is a range's end,
      // discounted beside the same answer's counted 301 / 303 (its table rows) — the verdict stays RED.
      const ranges = v.detail.mustNotMatchDiscounted.filter((d) => d.reason === "a range endpoint").map((d) => [d.match, d.range]);
      assert.deepStrictEqual(ranges, /^(design probe document|after probe corpus)$/.test(a.name) ? [["301", "301–304"]] : [], `${a.name}: the range ends discounted`);
    }
  });

  test("FS-3 ×4: 6 / 6 names, the table, six totals inside their bands — rounded (698 …) on the T43 image, decimal (698.5 …) on the post-v7 dry run", () => {
    const found = {};
    for (const a of TWELVE.filter((x) => x.fs === "FS-3")) {
      const v = evaluateCheck(q("FQ12").check, a.answer);
      assert.strictEqual(v.matches, 6, a.name);
      assert.strictEqual(v.detail.table, true, a.name);
      assert.deepStrictEqual(v.detail.totals.map((t) => t.ok), [true, true, true, true, true, true], `${a.name}: ${JSON.stringify(v.detail.totals)}`);
      assert.deepStrictEqual(v.detail.mustNotMatch, []);
      found[a.name] = v.detail.totals.map((t) => t.found);
    }
    assert.deepStrictEqual(found["FS-3 probe corpus"], [698, 860, 983, 1072, 994, 1165]);
    assert.deepStrictEqual(found["FS-3 probe document"], [698, 860, 983, 1072, 994, 1165]);
    assert.deepStrictEqual(found["T43 dry run Q12"], [698, 860, 983, 1072, 994, 1165]);
    assert.deepStrictEqual(found["post-v7 dry run Q12"], [698.5, 860.4, 983.1, 1071.8, 993.5, 1165.3]);
  });
});

describe("U-FIGCHECK 5: the last chain's figure records re-evaluate verdict-identical on every non-frontier turn (acceptance 3) — but for FQ06's new Halton count under set v3 (T45 D10)", () => {
  const CHAIN = [1, 2].map((n) => B("t18-artifacts", "records", "chain", `figq-D-1790161000-${n}.json`));
  test("32 non-frontier turns (16 questions × 2 runs): pass / matches / needed / detail identical to the record; FQ01 reads RED on both runs (design §7 risk 4)", () => {
    let same = 0; const fq01 = [];
    for (const f of CHAIN) {
      const rec = json(f);
      assert.strictEqual(rec.setVersion, 1, "the chain ran on the version-1 set");
      for (const t of rec.turns) {
        const v = evaluateCheck(q(t.id).check, t.answer || "");
        if (t.id === "FQ01") { fq01.push({ was: t.check.pass, now: v.pass, matches: v.matches }); continue; }
        if (FRONTIER.includes(t.id)) continue;
        const { mustNotMatch, ...rest } = v.detail;
        if (t.id === "FQ06") {
          // T45 (set v3, D10): FQ06 gained the Halton's 8; the recorded chain (production on the pre-T45 chunk, the Halton 6)
          // reads that one count MISSED and nothing else moves — the design's predicted RED until the re-ingest.
          assert.deepStrictEqual(rest.counts, [{ label: "Denby", value: 3, ok: true }, { label: "Halton", value: 8, ok: false }], `${path.basename(f)} FQ06: the Denby met, the Halton's 8 missed on the pre-T45 chunk`);
          assert.deepStrictEqual({ matches: v.matches, needed: v.needed, matched: rest.matched, missed: rest.missed }, { matches: t.check.matches, needed: t.check.needed, matched: t.check.detail.matched, missed: t.check.detail.missed }, `${path.basename(f)} FQ06: the names unchanged`);
          assert.strictEqual(v.pass, false);
          assert.deepStrictEqual(mustNotMatch, []);
          same++;
          continue;
        }
        assert.deepStrictEqual({ pass: v.pass, matches: v.matches, needed: v.needed, detail: rest }, { pass: t.check.pass, matches: t.check.matches, needed: t.check.needed, detail: t.check.detail }, `${path.basename(f)} ${t.id}`);
        assert.deepStrictEqual(mustNotMatch, []);
        same++;
      }
    }
    assert.strictEqual(same, 32);
    assert.deepStrictEqual(fq01.map((x) => [x.was, x.now]), [[true, false], [true, false]], "arm D PASSED FQ01 on the printed numbers and reads RED on the six coordinates: the T32 judge's rule sees RED → RED");
    assert.ok(fq01.every((x) => x.matches <= 2), "at most the two printed coordinates");
  });
});

describe("U-FIGCHECK 6: the runner's production guard — --production for the frontier ids only (D4; design §7 risk 1)", () => {
  const RUNNER = B("workshop-artifacts", "ab", "run_figure_questions.js");
  const run = (args) => {
    const out = path.join(require("os").tmpdir(), `u-figcheck-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    const r = spawnSync(process.execPath, [RUNNER, SET_PATH, out, ...args], { encoding: "utf8", env: { ...process.env, RAG_EVAL_APP_ROOT: ROOT, RAG_EVAL_APP_URL: "http://127.0.0.1:9" }, timeout: 20000 });
    return { status: r.status, stderr: r.stderr, wrote: fs.existsSync(out) };
  };
  test("a non-frontier id under --production is refused with the guard's message, before any request (no record written)", () => {
    for (const only of ["FQ02", "FQ01,FQ02", "FQ06,FQ11,FQ12", "FQ18"]) {
      const r = run(["--production", "--only", only, "--arm", "P"]);
      assert.strictEqual(r.status, 2, only);
      assert.match(r.stderr, /refusing FQ\d+\w*(?:,FQ\d+\w*)* under --production: the figure set never runs against production/, only);
      assert.strictEqual(r.wrote, false, only);
    }
    const all = run(["--production", "--arm", "P"]);
    assert.strictEqual(all.status, 2, "the whole set under --production is refused");
    assert.match(all.stderr, /refusing FQ02,FQ03/);
  });
  test("--production with a --collection, a non-RAGEval class without it, a bad --scopes, and no class at all are refused", () => {
    assert.match(run(["--production", "--collection", "RAGEval_x", "--only", "FQ01"]).stderr, /refusing --production with --collection RAGEval_x/);
    assert.match(run(["--collection", "RAGChunkV2", "--only", "FQ01"]).stderr, /refusing non-RAGEval_ class RAGChunkV2: the figure set never runs against production/);
    assert.match(run(["--production", "--only", "FQ01", "--scopes", "bogus"]).stderr, /--scopes must be corpus, document or both/);
    assert.match(run(["--only", "FQ01"]).stderr, /^usage:/);
    for (const a of [["--production", "--collection", "RAGEval_x", "--only", "FQ01"], ["--collection", "RAGChunkV2", "--only", "FQ01"], ["--production", "--only", "FQ01", "--scopes", "bogus"], ["--only", "FQ01"]]) assert.strictEqual(run(a).status, 2);
  });
  test("the source: the class and the version are omitted from the request only under --production; the scoped turn sends documentScope: q.document", () => {
    const src = fs.readFileSync(RUNNER, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
    assert.match(src, /\.\.\.\(PRODUCTION \? \{\} : \{ weaviateCollection: BASE, schemaVersion: 2 \}\)/);
    assert.match(src, /selected\.filter\(\(q\) => !q\.frontier\)/, "the guard reads the frontier flag");
    assert.match(src, /scope === "document" \? \{ documentScope: q\.document \} : \{\}/);
    assert.match(src, /^if \(BASE && !\/\^RAGEval_/m, "the RAGEval-only guard stays");
  });
});

describe("U-FIGCHECK 7: the frontier judge's pure core (§2.4)", () => {
  // A runner-shaped record from the after probe's raw responses (T43 image: `timing` on every turn) and the FS-3 probe's.
  const rawTurn = (dir, fsId, id, scope, stamp) => { const r = json(path.join(dir, `fs-${fsId}-${scope}-${stamp}.json`)).response; return { id, scope, answer: r.response, httpStatus: 200, success: true, timing: r.timing, citations: r.citations, uncitedClaims: r.uncitedClaims, documentScope: r.documentScope, report: { collection: "RAGChunkV2" }, chunksShown: [] }; };
  const record = { pod: "test", production: true, setVersion: 2, health: { srcTreeHash: "t" }, turns: [
    rawTurn(AFTER, "FS-1", "FQ01", "corpus", 1790254993), rawTurn(AFTER, "FS-1", "FQ01", "document", 1790254993),
    rawTurn(AFTER, "FS-2", "FQ11", "corpus", 1790254993), rawTurn(AFTER, "FS-2", "FQ11", "document", 1790254993),
    rawTurn(FS3, "FS-3", "FQ12", "corpus", 1790256178), rawTurn(FS3, "FS-3", "FQ12", "document", 1790256178),
  ] };
  test("the pair per question: RED / RED / GREEN in both scopes on today's answers, exit 1; the reasons name the words and the totals; T43's columns per scope", () => {
    const j = judgeRecord(record, set);
    assert.deepStrictEqual(j.rows.map((r) => [r.fs, r.cells.corpus.verdict, r.cells.document.verdict]), [["FS-1", "RED", "RED"], ["FS-2", "RED", "RED"], ["FS-3", "GREEN", "GREEN"]]);
    assert.deepStrictEqual({ judged: j.judged, red: j.red, exit: j.exit }, { judged: 6, red: 4, exit: 1 });
    const fs1 = j.rows[0].cells.corpus;
    assert.match(fs1.reasons[0], /^2 \/ 6 patterns \(220, 16\); missed 334, 1516, 1744, 390$/);
    assert.match(fs1.reasons.find((r) => /must-not-match HIT/.test(r)), /"three vertical lines"/);
    assert.strictEqual(fs1.timing.line, "36.4 s · retrieval 7.1 s · model 29.1 s · 4,968 → 1,933 tokens", "T43's footer numbers for that turn (t43-design.md §11b)");
    assert.strictEqual(fs1.timingPresent, true);
    const fs2 = j.rows[1].cells.document;
    assert.match(fs2.reasons.join("; "), /3 \/ 3 patterns \(302, 304, 313\); count Denby = 3: ok; must-not-match HIT "301", "303", "conflict"; discounted 5: "ambiguous" \(negated\) in "The following plot numbers are unambiguously assigned to The Denby:"/);
    const fs3 = j.rows[2].cells.corpus;
    assert.match(fs3.reasons.join("; "), /6 \/ 6 patterns .*; Ellerton 698 in \[698, 719\]; Chester 860 in \[860, 867\]; Kingsville 983 in \[982, 984\]; Alderney 1072 in \[1071, 1072\]; Hesketh 994 in \[993, 996\]; Radleigh 1165 in \[1165, 1177\]; table present$/);
    assert.strictEqual(fs3.timing.line, "92.3 s · retrieval 11.3 s · model 80.9 s · 13,073 → 10,394 tokens");
    assert.strictEqual(fs3.documentScope, "vote/enumeration");
    assert.strictEqual(j.rows[2].cells.document.documentScope, "request/prefilter/enumeration");
    assert.strictEqual(j.rows[0].cells.document.documentScope, "request/prefilter");
    assert.deepStrictEqual(j.rows.flatMap((r) => [r.cells.corpus.uncited, r.cells.document.uncited]), [0, 0, 0, 0, 0, 0]);
  });
  test("all green → exit 0; a before record gives before → after cells with compare_dryrun's columns; a record without frontier turns judges nothing", () => {
    const green = { ...record, turns: record.turns.filter((t) => t.id === "FQ12") };
    assert.deepStrictEqual((({ judged, red, exit }) => ({ judged, red, exit }))(judgeRecord(green, set)), { judged: 2, red: 0, exit: 0 });
    const j = judgeRecord(record, set, { before: record });
    assert.strictEqual(j.rows[0].cells.corpus.before.verdict, "RED");
    assert.strictEqual(j.rows[0].cells.corpus.before.columns.wall, "36.4 s → 36.4 s");
    assert.strictEqual(j.rows[0].cells.corpus.before.columns.tokens, "4,968 → 1,933 | 4,968 → 1,933");
    assert.deepStrictEqual(judgeRecord({ turns: [{ id: "FQ02", answer: "x" }] }, set), { rows: [], judged: 0, red: 0, exit: 0 });
  });
  test("timingCell: `timing` when present; the harness clock and the LLM span, labelled, on a record that predates T43; a missing turn prints dashes", () => {
    assert.strictEqual(timingCell({ latencyMs: 35600, llmDurationMs: 24800, promptTokens: { value: 4968, estimated: false }, completionTokens: 2311 }).line, "35.6 s (harness clock) · retrieval — · model 24.8 s (LLM span) · 4,968 → 2,311 tokens");
    assert.strictEqual(timingCell(null).line, "—");
    assert.strictEqual(timingCell({ timing: { wallMs: 1234, stages: { retrieval: { durationMs: 200 }, generation: { durationMs: 1000 } }, tokens: { prompt: 10, completion: 5, providerReported: false } } }).line, "1.2 s · retrieval 0.2 s · model 1.0 s · 10 → 5 tokens (estimated)");
  });
});

describe("U-FIGCHECK 8: scores.json — the comparison's numbers verbatim (D5; frontier-comparison.md §4 / §5)", () => {
  const scores = json(B("frontier-artifacts", "scores.json"));
  const TUPLES = {
    Gemini: { "FS-1": [3, 2, 1, 3, 3, 4], "FS-2": [0, 0, 0, 3, 1, 2], "FS-3": [2, 4, 2, 1, 2, 4] },
    ChatGPT: { "FS-1": [5, 5, 5, 5, 4, 3], "FS-2": [5, 5, 4, 5, 4, 5], "FS-3": [5, 5, 5, 5, 4, 5] },
    Claude: { "FS-1": [5, 5, 5, 5, 4, 5], "FS-2": [5, 5, 4, 4, 3, 3], "FS-3": [4, 5, 4, 5, 3, 4] },
    Ours: { "FS-1": [3, 3, 1, 4, 5, 3], "FS-2": [4, 4, 3, 4, 5, 4], "FS-3": [5, 5, 3, 5, 5, 4] },
  };
  test("four systems × three questions × six criteria, every tuple summing to its total, every system to its total: 37 / 84 / 78 / 70 of 90", () => {
    assert.deepStrictEqual(scores.rubric, ["Accuracy", "Completion", "Interpretation", "Honesty & caveats", "Traceability", "Presentation"]);
    assert.deepStrictEqual(scores.entries.map((e) => e.system), ["Gemini", "ChatGPT", "Claude", "Ours"]);
    const totals = {};
    for (const e of scores.entries) {
      let sum = 0;
      for (const fsId of ["FS-1", "FS-2", "FS-3"]) {
        const s = e.scores[fsId];
        assert.deepStrictEqual(s.criteria, TUPLES[e.system][fsId], `${e.system} ${fsId}`);
        assert.strictEqual(s.criteria.length, 6);
        assert.ok(s.criteria.every((c) => Number.isInteger(c) && c >= 0 && c <= scores.maxPerCriterion));
        assert.strictEqual(s.criteria.reduce((a, b) => a + b, 0), s.total, `${e.system} ${fsId} sums to ${s.total}`);
        assert.ok(typeof s.model === "string" && s.model.length, "the model named per cell");
        sum += s.total;
      }
      assert.strictEqual(sum, e.total, `${e.system} total`);
      totals[e.system] = e.total;
    }
    assert.deepStrictEqual(totals, { Gemini: 37, ChatGPT: 84, Claude: 78, Ours: 70 });
    assert.deepStrictEqual([scores.maxPerCriterion, scores.maxPerQuestion, scores.maxTotal], [5, 30, 90]);
  });
  test("ours names the record, the turns and the latencies of §5", () => {
    const ours = scores.entries.find((e) => e.system === "Ours");
    assert.strictEqual(ours.record, "tests/eval/baselines/t18-artifacts/records/reingest/t32-dryrun-after-1790200001.json");
    assert.ok(fs.existsSync(path.join(ROOT, ours.record)), "the record ships");
    assert.deepStrictEqual(ours.turns, { "FS-1": 3, "FS-2": 11, "FS-3": 12 });
    assert.deepStrictEqual(ours.latency, {
      "FS-1": { wallS: 35.6, modelS: 24.8, promptTokens: 4968, completionTokens: 2311 },
      "FS-2": { wallS: 50.5, modelS: 10.9, promptTokens: 7647, completionTokens: 663 },
      "FS-3": { wallS: 135.0, modelS: 83.8, promptTokens: 13073, completionTokens: 9839 },
    });
    const rec = json(path.join(ROOT, ours.record));
    for (const [fsId, n] of Object.entries(ours.turns)) {
      const t = rec.turns.find((x) => x.n === n);
      assert.strictEqual(t.promptTokens.value, ours.latency[fsId].promptTokens, `${fsId}: the prompt tokens are the record's`);
      assert.strictEqual(t.completionTokens, ours.latency[fsId].completionTokens, `${fsId}: the completion tokens are the record's`);
      assert.strictEqual(Math.round(t.latencyMs / 100) / 10, ours.latency[fsId].wallS, `${fsId}: the wall is the record's`);
    }
  });
});

describe("U-FIGCHECK 9: F-189 (b) — a worded must-not-match on a check that names its subject is read in its sentence (the owner's choice, 2026-09-25)", () => {
  const FQ11 = q("FQ11").check;
  const hits = (v) => v.detail.mustNotMatch.map((h) => h.match);
  const disc = (v) => (v.detail.mustNotMatchDiscounted || []).map((d) => [d.match, d.reason]);
  const RIGHT = "The Denby: 3 plots — 302, 304 and 313.";
  const CLS = B("t45-artifacts", "records", "after", "fsclass-1790325161.json"), PROD = B("t45-artifacts", "records", "reingest", "fs-1790343280.json");
  const cellAnswer = (r, scope) => r.turns.find((t) => t.id === "FQ11" && t.scope === scope).answer;

  test("the two recorded negated answers read GREEN — the class gate's document cell (session 55, F-189's first occurrence) and production's corpus cell after the v8 re-ingest (session 56, the second) — with the discounted words and their sentences on record; the sibling cells unchanged; T44's reading of the same two answers RED", () => {
    const cls = json(CLS), prod = json(PROD);
    const a = evaluateCheck(FQ11, cellAnswer(cls, "document"));
    assert.strictEqual(a.pass, true);
    assert.deepStrictEqual({ matches: a.matches, counts: a.detail.counts, hits: hits(a) }, { matches: 3, counts: [{ label: "Denby", value: 3, ok: true }], hits: [] });
    assert.deepStrictEqual(disc(a), [["conflict", "negated"], ["ambiguous", "negated"], ["ambiguous", "negated"]]);
    assert.match(a.detail.mustNotMatchDiscounted[0].sentence, /^None of the three Denby plots appear in the list of 8 conflicting\/ambiguous readings, so their identification is unambiguous/);
    const b = evaluateCheck(FQ11, cellAnswer(prod, "corpus"));
    assert.strictEqual(b.pass, true);
    assert.deepStrictEqual({ matches: b.matches, counts: b.detail.counts, hits: hits(b) }, { matches: 3, counts: [{ label: "Denby", value: 3, ok: true }], hits: [] });
    assert.deepStrictEqual(disc(b), [["conflict", "negated, not about the subject"]]);
    assert.strictEqual(b.detail.mustNotMatchDiscounted[0].sentence, "No reading conflicts are noted for any of these plot numbers [S1].");
    assert.strictEqual(evaluateCheck(FQ11, cellAnswer(cls, "document"), { subjectRule: false }).pass, false, "T44's any-hit reading: RED on the class word");
    assert.strictEqual(evaluateCheck(FQ11, cellAnswer(prod, "corpus"), { subjectRule: false }).pass, false);
    assert.strictEqual(evaluateCheck(FQ11, cellAnswer(cls, "corpus")).pass, true);
    assert.strictEqual(evaluateCheck(FQ11, cellAnswer(prod, "document")).pass, true);
    for (const r of [cls, prod]) { const fs2 = judgeRecord(r, set).rows.find((x) => x.fs === "FS-2"); assert.deepStrictEqual([fs2.cells.corpus.verdict, fs2.cells.document.verdict], ["GREEN", "GREEN"], `${path.basename(r === cls ? CLS : PROD)}: FS-2 GREEN / GREEN through the judge`); }
    assert.match(judgeRecord(prod, set).rows.find((x) => x.fs === "FS-2").cells.corpus.reasons.join("; "), /no must-not-match hit; discounted 1: "conflict" \(negated, not about the subject\) in "No reading conflicts are noted for any of these plot numbers \[S1\]\."$/);
    assert.deepStrictEqual(judgeRecord(prod, set).rows.map((r) => [r.fs, r.cells.corpus.verdict, r.cells.document.verdict]), [["FS-1", "RED", "RED"], ["FS-2", "GREEN", "GREEN"], ["FS-3", "GREEN", "GREEN"]], "production after the v8 re-ingest, re-judged: FS-2 GREEN / GREEN, the rest as recorded");
  });

  // THE CENSUS — it GROWS with the records (F-201, the owner's D3 (a); the file header states the rule): a new record that
  // flips a cell under any rule turns this case RED until the cell is READ BY HAND and, only when the answer is right,
  // named in its rule's list below with why. Six readings of every cell: T44's any-hit ({ subjectRule: false }), F-189 (b)
  // alone ({ rangeRule: false } and F-220's flags off — the judge of sessions 57–59), + F-199 (a) ({ attributionRule: false } and
  // F-209's and F-220's flags off — the rules of sessions 60–61), + F-206 (c) (F-209's and F-220's flags off — the judge of
  // sessions 62–66), + F-209 (F-220's flags off — the judge of sessions 67–71) and the judge (+ F-220 + F-221); and the
  // judge on the text before F-202 / F-203 (b) ({ nosRule: false, thousandsRule: false }), which flips nothing on record.
  test("THE CENSUS: every FS-2 cell on record (the runner records fs-* / fsclass-* / figq-* under tests/eval/baselines and the four raw answers of §0d) through T44's reading, F-189 (b) alone, + F-199 (a), + F-206 (c), + F-209 and the judge (+ F-220 + F-221) — each rule flips exactly its named cells, every hedge stays RED, no rule turns a GREEN cell RED, the text fixes flip nothing", () => {
    const files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/^(fs|fsclass|figq)-.*\.json$/.test(e.name)) files.push(p); } })(B());
    const cells = [];
    // T48 (D10): a record of N passes (`--repeat N`, N > 1) names each cell's pass — " r3" — so a flip is named unambiguously;
    // a record of one pass keeps the name it always had.
    for (const f of files.sort()) { const r = json(f); if (!Array.isArray(r.turns)) continue; for (const t of r.turns) if (t.id === "FQ11" && typeof t.answer === "string") cells.push({ name: `${path.relative(B(), f)} ${t.scope || "corpus"}${Number(r.repeat) > 1 && Number.isInteger(t.repeat) ? ` r${t.repeat}` : ""}`, answer: t.answer }); }
    for (const a of TWELVE.filter((x) => x.fs === "FS-2")) cells.push({ name: a.name, answer: a.answer });
    const flips189 = [], flips199 = [], flips206 = [], flips209 = [], flips220 = [], flipsText = [], red = [];
    const PRE_F220 = { clauseDenialRule: false, cueScopeRule: false };
    const PRE_F209 = { betweenRule: false, designFirstRule: false, neighbourRule: false, ...PRE_F220 };
    for (const c of cells) {
      const t44 = evaluateCheck(FQ11, c.answer, { subjectRule: false }), f189 = evaluateCheck(FQ11, c.answer, { rangeRule: false, ...PRE_F220 }), f199 = evaluateCheck(FQ11, c.answer, { attributionRule: false, ...PRE_F209 }), f206 = evaluateCheck(FQ11, c.answer, PRE_F209), f209 = evaluateCheck(FQ11, c.answer, PRE_F220), judge = evaluateCheck(FQ11, c.answer), text = evaluateCheck(FQ11, c.answer, { nosRule: false, thousandsRule: false });
      if (t44.pass !== f189.pass) flips189.push(c.name);
      if (f189.pass !== f199.pass) flips199.push(c.name);
      if (f199.pass !== f206.pass) flips206.push(c.name);
      if (f206.pass !== f209.pass) flips209.push(c.name);
      if (f209.pass !== judge.pass) flips220.push(c.name);
      if (text.pass !== judge.pass) flipsText.push(c.name);
      // A RED cell with the plots and the count met is red on a must-not-match hit that COUNTED (a hedge); the arm-B / arm-C
      // records of T32 / T37 are red on the patterns (0 / 3) and name no hit.
      if (!judge.pass) { red.push(c.name); if (judge.matches >= judge.needed && judge.detail.counts.every((x) => x.ok)) assert.ok(hits(judge).length > 0, `${c.name}: a RED cell with the facts met names a counted hit`); }
      assert.ok(!(t44.pass && !f189.pass), `${c.name}: F-189 (b) never turns a GREEN cell RED`);
      assert.ok(!(f189.pass && !f199.pass), `${c.name}: F-199 (a) never turns a GREEN cell RED`);
      assert.ok(!(f199.pass && !f206.pass), `${c.name}: F-206 (c) never turns a GREEN cell RED`);
      assert.ok(!(f206.pass && !f209.pass), `${c.name}: F-209 never turns a GREEN cell RED`);
      assert.ok(!(f209.pass && !judge.pass), `${c.name}: F-220 + F-221 never turn a GREEN cell RED`);
      for (const d of judge.detail.mustNotMatchDiscounted || []) {
        if (d.reason === "a range endpoint") assert.ok(d.range.includes(d.match) && d.sentence.includes(d.range), `${c.name}: a discounted range end names its range, in its sentence`);
        if (d.reason === "attributed to another design") assert.ok(d.design && d.attribution.includes(d.design) && d.sentence.includes(d.attribution) && !/denby/i.test(d.attribution), `${c.name}: a discounted attribution names its design, in its sentence, never the Denby`);
        if (d.reason === "a neighbour list") assert.ok(d.cue && d.neighbours.startsWith(d.cue) && d.neighbours.includes(d.match) && d.sentence.includes(d.neighbours) && !/denby/i.test(d.neighbours), `${c.name}: a discounted neighbour list names its cue and words, in its sentence, never the Denby`);
        if (d.reason === "in a clause that denies doubt") assert.ok(DOUBT_WORD.test(d.match) && d.clause && d.sentence.includes(d.clause) && d.clause.includes(d.match), `${c.name}: a doubt word discounted in a denying clause names its clause, in its sentence`);
      }
    }
    assert.ok(cells.length >= 50, `${cells.length} cells on record`);
    // F-189 (b)'s flips, each read by hand — a right answer whose class word is negated:
    //   the class gate's document cell (session 55): "None of the three Denby plots appear in the list of 8 conflicting/ambiguous readings, …";
    //   production's corpus cell after the v8 re-ingest (session 56): "No reading conflicts are noted for any of these plot numbers [S1].";
    //   production's corpus cell after the v9 re-ingest (session 59, F-201's cell): "None of these plot numbers appear in the conflicts list, so the allocation is unambiguous [S1].";
    //   T48's gate on production, the setting off (session 61, 5 passes — each read by hand: 302, 304, 313, the count 3, no hedge):
    //   document r1 "None of the Denby plots appear in the list of adjudicated label conflicts, so the assignments are unambiguous [S1].";
    //   corpus r5 "None of the three appear in the conflicts list, so the allocation is unambiguous [S1]."
    //   T52's setting-on leg on production (session 65, 5 passes — each read by hand: 302, 304, 313, the count 3, no hedge,
    //   no 301 / 303): document r1 "None of the eight flagged label conflicts on the plan involve The Denby, so the allocation
    //   is unambiguous [S1]."; corpus r2 "No reading conflicts were flagged for any of these three numbers, so the allocation is
    //   unambiguous [S1]."; document r5 "All three are listed unambiguously in the index with no conflicting readings noted [S1]."
    //   T54's frontier re-score, the setting-on column on production (session 68, one draw, corpus — read by hand: 302, 304,
    //   313, the count 3, no hedge, no 301 / 303): "None of the three plots appear in the list of conflicting/ambiguous
    //   readings, so the allocation is unambiguous [S1]."
    //   T57's after sequence (session 70 — each read by hand: 302, 304, 313, the count 3, no hedge, no 301 / 303): production's
    //   live gate, corpus "None of the three appear in the document's list of conflicting/ambiguous readings, so the allocation
    //   is unambiguous [S1]."; the colour check's class gate, corpus "These three assignments are listed unambiguously in the
    //   index with no colour-label conflicts noted for any of them [S1]." and document "These three plots are all confirmed in
    //   the index with no colour-label conflicts noted for The Denby [S1]."
    //   T58's after sequence (session 71 — read by hand whole: 302, 304, 313, the count 3, no hedge, no 301 / 303): the class
    //   gate's document cell "No conflicts or ambiguous readings were flagged for any of these three numbers in the adjudication
    //   notes [S1]."
    //   T58's re-ingest (session 71, production on IDENTITY_VERSION 11 — each read by hand whole: 302, 304, 313, the count 3,
    //   no hedge, no 301 / 303): production's live gate, corpus "These three assignments are listed as confirmed in the plan's
    //   index, with no colour-label conflicts flagged for any of them [S1]." and document "The Denby appears in the master
    //   legend and index with a confirmed allocation; no additional Denby plots are flagged in the conflict list, so the total
    //   stands at 3."
    //   T59's after sequence (session 72 — each read by hand whole: 302, 304, 313, the count 3, no hedge, no 301 / 303):
    //   production's live gate (v11, untouched), document "These are listed as confirmed allocations in the document's index
    //   and counts section, with no conflicting readings noted for any of the three plots [S1]." (its "ambiguous" is about the
    //   24 other plots); the class gate on T59's chunk, corpus "These three assignments are listed as confirmed in the index read
    //   of the plan, with no conflicting or ambiguous readings recorded for any of them [S1]." and document "These three plots
    //   are all confirmed assignments (no colour/label conflicts were flagged for any of them) [S1]."
    //   T60's after sequence (session 73 — read by hand whole: 302, 304, 313, the count 3, no hedge, no 301 / 303): the class
    //   gate on T60's chunk, document "All three are listed as unambiguous (confirmed) assignments in the plan's index, with no
    //   conflicting readings noted for any of them [S1]." (it quotes the LEGEND TEXT block: "the broader 3-bedroom home group,
    //   which totals 14 confirmed plots across The Ellerton (11), The Denby (3), and The Ennerdale (0 confirmed)").
    //   T60's v13 re-ingest gate on production (session 73 — read by hand whole: 302, 304, 313, the count 3, no hedge, no
    //   301 / 303): document "No conflicts or ambiguous readings were flagged for any of these three numbers in the adjudicated
    //   label pass, so the count of **3** is firm [S1]." (its corpus twin stays RED — right by hand, F-223's shape: "(with 303
    //   between them, which is allocated to The Halton)").
    //   T61's after sequence (session 74 — read by hand whole: 302, 304, 313, the count 3, no hedge, no 301 / 303): the class
    //   gate on T61's chunk, document "These three plots are listed as confirmed in the document's count summary, and none of
    //   them appear in the 14 flagged label conflicts, so the attribution is unambiguous [S1]."
    //   T62's closing measurement, production's robustness leg, the setting off (session 75 — each read by hand whole: 302,
    //   304, 313, the count 3, no hedge, no 301 / 303 as the Denby's): document r1 "All three are confirmed with no label
    //   conflicts noted in the plan's adjudication [S1]."; corpus r5 "All three readings are unambiguous — none of these plot
    //   numbers appear in the document's conflict list, so the colour-to-legend match is clean [S1]." (both give our list to
    //   the document — the Honesty point of frontier-comparison.md §12.1's added rule, not a hedge).
    //   T63's BEFOREs on today's tree (session 77 — production's gate, the setting off, 5 passes per scope, each read by hand
    //   whole: 302, 304, 313, the count 3, no hedge, no 301 / 303 as the Denby's): corpus r1 "These three plots are confirmed in
    //   the plan's index with no conflicting readings noted for any of them [S1]."; document r1 "These three plots are all
    //   confirmed with no conflicting readings — none of the 14 adjudicated label conflicts on the plan involve The Denby
    //   [S1]."; document r2 "None of the 14 flagged label conflicts on the page involve The Denby, so this count of 3 is
    //   unambiguous [S1]."; corpus r3 "All three are confirmed with no label conflicts recorded for any of these plot numbers
    //   [S1]."; corpus r4 "All three plots are confirmed with no colour/label conflicts noted for The Denby in the adjudication
    //   [S1]."; corpus r5 "All three allocations are confirmed with no label conflicts noted in the plan's adjudication [S1]."
    //   T63's after legs on the rolled tree (session 77 — production's gate, the setting off, 5 passes per scope, the document
    //   cells reading the Site Plan whole; each read by hand whole: 302, 304, 313, the count 3, no hedge, no 301 / 303 as the
    //   Denby's): document r1 "The Denby does not appear in the document's list of 14 colour-reading conflicts, so all three
    //   allocations are unambiguous [S7]."; corpus r2 "All three are confirmed without any label-reading conflicts [S1].";
    //   document r2 "…no conflicts or alternative readings were flagged for any of them [S7]."; document r3 "No conflicts or
    //   alternative readings were flagged for any of these three numbers."; document r5 "…with no conflicting readings recorded
    //   for any of them [S7]."
    //   T64's after legs on the rolled tree (session 79 — production's gate, the setting off, 5 passes per scope; each read
    //   by hand whole: 302, 304, 313, the count 3, no hedge, no 301 / 303): document r1 "…with no conflicting readings noted
    //   for any of them [S7]."; corpus r2 "All three are confirmed with no conflicting readings noted in the plan's
    //   adjudication [S1]."; document r2 "…with no conflicting readings noted for any of them [S7]."; corpus r3 "These three
    //   assignments are confirmed in the plan's index with no conflicting readings noted for any of them [S1]."; document r3
    //   "No conflicts or ambiguous readings were flagged for any of these three plots …"; document r4 "…with no conflicting
    //   readings noted for any of them [S7]."; corpus r5 "…all confirmed without ambiguity (no colour-label conflicts involve
    //   this design) [S1]."; document r5 "…with no conflicting readings noted for any of them [S7]."
    //   T65's after legs on the first rolled tree (session 80 — production's gate, the setting off, 5 passes per scope; the
    //   corpus cell now read whole by name, "Denby"; each read by hand whole: 302, 304, 313, the count 3, no hedge, no 301 / 303):
    //   corpus r1 "These three assignments are confirmed without ambiguity — none of the 14 colour-reading conflicts noted on
    //   the plan involve a Denby plot [S7]."; document r1 "No conflicts or alternative readings were flagged for any of these
    //   three numbers."; corpus r2 "All three are listed as **confirmed** in the adjudicated plot index, with no
    //   colour-reading conflicts flagged for any of them [S7]."; document r2 "…with no conflicting readings noted for any of the
    //   three plots [S7]."; corpus r3 "…with no colour-reading conflicts flagged for any of them [S7]."; document r3 "…with no
    //   colour-reading conflicts flagged against them [S7]."; document r4 "…with no conflicting readings noted for any of them
    //   [S7]."; document r5 "…with no colour-reading conflicts flagged for any of them [S7]."
    assert.deepStrictEqual(flips189, ["t45-artifacts/records/after/fsclass-1790325161.json document", "t45-artifacts/records/reingest/fs-1790343280.json corpus", "t46-artifacts/records/reingest/fs-1790413460.json corpus", "t48-artifacts/records/after/fs-1790497746.json document r1", "t48-artifacts/records/after/fs-1790497746.json corpus r5", "t52-artifacts/records/after/fs-on-1790578249.json document r1", "t52-artifacts/records/after/fs-on-1790578249.json corpus r2", "t52-artifacts/records/after/fs-on-1790578249.json document r5", "t54-artifacts/records/fs-on-1790599533.json corpus", "t57-artifacts/records/after/pod/fs-1790622506.json corpus", "t57-artifacts/records/after/pod/fsclass-1790622506.json corpus", "t57-artifacts/records/after/pod/fsclass-1790622506.json document", "t58-artifacts/records/after/pod/fsclass-1790674781.json document", "t58-artifacts/records/reingest/fs-1790683028.json corpus", "t58-artifacts/records/reingest/fs-1790683028.json document", "t59-artifacts/records/after/pod/fs-1790696198.json document", "t59-artifacts/records/after/pod/fsclass-1790696198.json corpus", "t59-artifacts/records/after/pod/fsclass-1790696198.json document", "t60-artifacts/records/after/pod/fsclass-1790721476.json document", "t60-artifacts/records/reingest/fs-1790750314.json document", "t61-artifacts/records/after/pod/fsclass-1790758084.json document", "t62-artifacts/records/fs-off-1790766437.json document r1", "t62-artifacts/records/fs-off-1790766437.json corpus r5", "t63-artifacts/records/after/fs-off-1790809955.json document r1", "t63-artifacts/records/after/fs-off-1790809955.json corpus r2", "t63-artifacts/records/after/fs-off-1790809955.json document r2", "t63-artifacts/records/after/fs-off-1790809955.json document r3", "t63-artifacts/records/after/fs-off-1790809955.json document r5", "t63-artifacts/records/before/fs-off-1790801309.json corpus r1", "t63-artifacts/records/before/fs-off-1790801309.json document r1", "t63-artifacts/records/before/fs-off-1790801309.json document r2", "t63-artifacts/records/before/fs-off-1790801309.json corpus r3", "t63-artifacts/records/before/fs-off-1790801309.json corpus r4", "t63-artifacts/records/before/fs-off-1790801309.json corpus r5", "t64-artifacts/records/after/fs-off-1790865401.json document r1", "t64-artifacts/records/after/fs-off-1790865401.json corpus r2", "t64-artifacts/records/after/fs-off-1790865401.json document r2", "t64-artifacts/records/after/fs-off-1790865401.json corpus r3", "t64-artifacts/records/after/fs-off-1790865401.json document r3", "t64-artifacts/records/after/fs-off-1790865401.json document r4", "t64-artifacts/records/after/fs-off-1790865401.json corpus r5", "t64-artifacts/records/after/fs-off-1790865401.json document r5", "t65-artifacts/records/after/fs-off-1790892230.json corpus r1", "t65-artifacts/records/after/fs-off-1790892230.json document r1", "t65-artifacts/records/after/fs-off-1790892230.json corpus r2", "t65-artifacts/records/after/fs-off-1790892230.json document r2", "t65-artifacts/records/after/fs-off-1790892230.json corpus r3", "t65-artifacts/records/after/fs-off-1790892230.json document r3", "t65-artifacts/records/after/fs-off-1790892230.json document r4", "t65-artifacts/records/after/fs-off-1790892230.json document r5"]);
    // F-199 (a)'s flips, each read by hand (session 60) — a right answer (302, 304, 313, the count 3) whose only 301 is a range's end:
    //   T46's chain, arm D FQ11 run 1 (session 58): "… along the stretch of plots running from 301 through 318, which sits off Gumcester Way …";
    //   production's document cell after the v9 re-ingest (session 59): "… plots 302 and 304 sit adjacent to each other in the cluster around plots 301–308 …".
    //   T48's gate and leg on production (session 61, 5 passes each — each read by hand: 302, 304, 313, the count 3, 301 only as a range's end):
    //   the gate's document r2 "… situated along the stretch of plots running between the 301–314 range [S1, S3].";
    //   the leg's corpus r3 "… plots 302 and 304 sit adjacent to one another in the cluster around plots 301–314 …";
    //   the leg's document r5 "… situated in the cluster of plots along the southern portion of the development (near plots 301–315) [S3, S5]."
    //   T54's robustness leg on production, the setting off (session 68, 5 passes per scope — each read by hand: 302, 304, 313,
    //   the count 3, 301 only as a range's end): document r3 "… along the stretch of plots running between the 301–314 range,
    //   near Gumcester Way and the A108 corridor …"; document r4 "… between the 301–314 range, adjacent to The Halton and The
    //   Ennerdale allocations …" (the A108 spelling and the Ennerdale's plot are other residues — T47's named A108, F-215).
    //   T57's after sequence, production's live gate (session 70 — read by hand: 302, 304, 313, the count 3, no hedge, 301 only
    //   as a range's end): document "Spatially, plots 302 and 304 sit adjacent to one another in the cluster around plots
    //   301–318 (near the Gumcester Way / A108 boundary), while plot 313 is positioned slightly further along that same row".
    //   T58's after sequence (session 71 — read by hand whole: 302, 304, 313, the count 3, no hedge, 301 only as a range's end):
    //   production's live gate, corpus "…plots 302 and 304 sit adjacent to each other in the cluster around plots 301–308 (near
    //   the Gumcester Way / A108 boundary)…"; the class gate's corpus "…in the cluster along the Fisherman Way / Gumcester Way
    //   area (between plots 301–308), while plot 313 is located slightly further along the same stretch, near plots 311–314".
    //   T59's after sequence (session 72 — read by hand whole: 302, 304, 313, the count 3, no hedge, 301 only as a range's end):
    //   production's live gate (v11, untouched), corpus "They sit within the cluster of plots (301–314) along the southern
    //   portion of the development, near Gumcester Way and the A108 boundary [S3, S5]."
    //   T62's closing measurement, production's robustness leg, the setting off (session 75 — read by hand whole: 302, 304,
    //   313, the count 3, no hedge, 301 only as a range's end): document r5 "They sit within the cluster of plots in the
    //   301–315 range, along the Gumcester Way / A108 boundary area of the plan [S2, S3]." (the location is the draw's
    //   residue — the cluster is mid-plan, the road the A1198: frontier-comparison.md §13).
    //   T63's BEFOREs on today's tree (session 77 — each read by hand whole: 302, 304, 313, the count 3, no hedge, 301 only as a
    //   range's end): corpus r2 "… along the stretch between Fisherman Way and Gumcester Way, near plots 301–314 [S3, S4].";
    //   document r3 "… near plots 301–314, along the Gumcester Way / A108 boundary area [S3, S6]."; document r4 "… near plots
    //   301–314, along the Gumcester Way / A108 boundary area [S3, S6]."; document r5 "… (between plots 301–308), while plot 313
    //   is located in the adjacent row near plots 310–315 [S3, S5, S6]." (the locations are F-233's residue, not the Denby's plots).
    //   T64's after legs on the rolled tree (session 79 — read by hand whole: 302, 304, 313, the count 3, no hedge, 301 only as a
    //   range's end): corpus r1 "They sit in the lower-central cluster of the plan, along the stretch between Fisherman Way and
    //   Gumcester Way, near plots 301–315 [S3, S4]." (F-233's location residue, as T63's).
    assert.deepStrictEqual(flips199, ["t46-artifacts/records/chain/t32after/figq-D-1790377666-1.json corpus", "t46-artifacts/records/reingest/fs-1790413460.json document", "t48-artifacts/records/after/fs-1790497746.json document r2", "t48-artifacts/records/after/fs-on-1790497746.json corpus r3", "t48-artifacts/records/after/fs-on-1790497746.json document r5", "t54-artifacts/records/fs-off-1790599533.json document r3", "t54-artifacts/records/fs-off-1790599533.json document r4", "t57-artifacts/records/after/pod/fs-1790622506.json document", "t58-artifacts/records/after/pod/fs-1790674781.json corpus", "t58-artifacts/records/after/pod/fsclass-1790674781.json corpus", "t59-artifacts/records/after/pod/fs-1790696198.json corpus", "t62-artifacts/records/fs-off-1790766437.json document r5", "t63-artifacts/records/before/fs-off-1790801309.json corpus r2", "t63-artifacts/records/before/fs-off-1790801309.json document r3", "t63-artifacts/records/before/fs-off-1790801309.json document r4", "t63-artifacts/records/before/fs-off-1790801309.json document r5", "t64-artifacts/records/after/fs-off-1790865401.json corpus r1"]);
    // F-206 (c)'s flips, each read by hand (session 62, frontier-artifacts/f206/measure_f206.js) — T48's gate on production
    // (session 61, 5 passes per scope): right answers (302, 304, 313, the count 3, finish stop, no hedge) whose only 301 / 303
    // are named as the Halton's — true since T45:
    //   the setting off, corpus r3 "… adjacent to plots 301 (The Halton), 303 (The Halton), and 312 (The Halton) …";
    //   the setting off, document r4 "… (with 303 being The Halton between them), while plot 313 is located …";
    //   the setting on, document r4 "… adjacent to plots 301 (The Halton), 303 (The Halton), 312 (The Halton), and 314 (The Halton) …".
    //   T61's v14 re-ingest gate on production (session 74 — read by hand whole: 302, 304, 313, the count 3, no hedge), corpus
    //   "Plots 302 and 304 are adjacent to one another (with 303 – a Halton – between them), while 313 is … flanked by 312
    //   (Halton) and 314 (Halton)".
    //   T62's closing measurement, production's robustness leg, the setting off (session 75 — read by hand whole: 302, 304,
    //   313, the count 3, no hedge, 303 only as the Halton's): corpus r4 "Plot 302 and 304 are adjacent to one another (with
    //   303 – a Halton – between them), while 313 is positioned slightly further along the same row, flanked by 312 (Halton)
    //   and 314 (Halton) [S3, S5, S6]."
    //   T64's after legs on the rolled tree (session 79 — read by hand whole: 302, 304, 313, the count 3, no hedge, 303 only
    //   as the Halton's): corpus r4 "Plot 302 and 304 are adjacent to one another (with plot 303 – a Halton – between them),
    //   while plot 313 is a short distance further along the same row, flanked by Halton plots 312 and 314" (its "southern
    //   cluster … Gumcester Way and the A108" is F-233's location residue).
    assert.deepStrictEqual(flips206, ["t48-artifacts/records/after/fs-1790497746.json corpus r3", "t48-artifacts/records/after/fs-1790497746.json document r4", "t48-artifacts/records/after/fs-on-1790497746.json document r4", "t61-artifacts/records/reingest/fs-1790762748.json corpus", "t62-artifacts/records/fs-off-1790766437.json corpus r4", "t64-artifacts/records/after/fs-off-1790865401.json corpus r4"]);
    // F-209's flips, each read by hand WHOLE (session 67, frontier-artifacts/f209/measure_f209.js) — T52's setting-on leg on
    // production (session 65, 5 passes per scope): right answers (302, 304, 313, the count 3, no hedge) whose only 301 / 303
    // place the Denby's plots without claiming another:
    //   corpus r3 (D1, "between") "… along the stretch of plots running between roughly 301 and 314, near the Gumcester Way / A108 boundary";
    //   document r3 (D2, the design named first) "Plot 302 and Plot 304 are adjacent to each other, flanked by The Halton (301, 303) and The Ennerdale (305)";
    //   corpus r5 (D3, a neighbour list) "… plots 302 and 304 sit in the cluster around the 300-range (near plots 301, 303, 305, 306, …, 314) …".
    // (T50's probe holds the same three spellings — outside this census's walk; U-FIGCHECK 13 pins them.)
    //   T54's robustness leg on production, the setting off (session 68 — read by hand whole: 302, 304, 313, the count 3, no
    //   hedge): corpus r1 (D1, "between") "… along the stretch of plots running between roughly 301 and 314, near the Gumcester
    //   Way / A108 boundary …".
    //   T57's v10 re-ingest gate on production (session 70 — read by hand whole: 302, 304, 313, the count 3, no hedge — "All
    //   three assignments are unambiguous"): corpus (D2, the design named first) "They are interspersed with The Halton (301,
    //   303, 312, 314) and The Ennerdale / Alnmouth V1 (305) plots [S1]."
    //   T59's v12 re-ingest gate on production (session 72 — each read by hand whole: 302, 304, 313, the count 3, no hedge):
    //   corpus (D3, a neighbour list) "…plots 302 and 304 sit in the cluster along the Fisherman Way / Gumcester Way area (near
    //   plots 301, 303, 305–308)…"; document (D2, the design named first) "All three Denby plots fall within the cluster along
    //   Gumcester Way / Fisherman Way, … interspersed among The Halton (301, 303, 312, 314) and The Kingsville / The Alnmouth
    //   plots" ("None of these three plots appear in the document's list of 25 label conflicts, so the attribution is unambiguous").
    //   T60's after sequence (session 73 — each read by hand whole: 302, 304, 313, the count 3, no hedge): production's live
    //   gate (v12, untouched), corpus (D2, the design named first) "…interspersed with The Halton (301, 303, 312, 314) and The
    //   Ennerdale / Alnmouth V1 (305) plots [S2, S3, S6]." ("None of these three plots appear in the document's list of 25 label
    //   conflicts, so the attribution is unambiguous"); the class gate on T60's chunk, corpus (D2) "The Denby plots sit in the
    //   cluster along the Fisherman Way / Gumcester Way area of the site, interspersed with The Halton (301, 303, 312, 314) and
    //   The Kingsville (317, 318) plots" (its "The Kingsville (317, 318)" is a side slip — 318 is the Radleigh's, 317 a
    //   conflict — never the Denby's).
    //   T61's after sequence (session 74 — each read by hand whole: 302, 304, 313, the count 3, no hedge): production's live
    //   gate (v13, untouched), corpus (D2, the design named first) "…interspersed with The Halton (301, 303, 312, 314) and The
    //   Kingsville (315–318) plots" ("All three assignments are unambiguous"; its "The Kingsville (315–318)" is a side slip —
    //   never the Denby's); the class gate on T61's chunk, corpus (D2) "For context, the Denby sits alongside The Ennerdale (plot
    //   315) and The Halton (plots 301, 303, 312, 314) in the same cluster" (315 the Ennerdale's — T61's settle).
    //   T61's v14 re-ingest gate on production (session 74 — read by hand whole: 302, 304, 313, the count 3, no hedge), document
    //   (D3, a neighbour list) "…plots 302 and 304 sit in the cluster along the Fisherman Way / Gumcester Way area (neighbouring
    //   plots 301, 303, 305–308), while plot 313 is located in the adjacent row near plots 310–315".
    //   T62's closing measurement on production (session 75 — each read by hand whole: 302, 304, 313, the count 3, no hedge):
    //   the robustness leg, the setting off — corpus r1 (D3) "…in the cluster along the Fisherman Way / Gumcester Way stretch
    //   (neighbouring plots 301, 303, 305–308)…"; corpus r2 (D3) "…along the Fisherman Way / Gumcester Way area (near plots
    //   301, 303, 305–308)…"; corpus r3 (D2) "…interspersed with The Halton (301, 303) and The Alnmouth V1 (305) plots" (305
    //   the Alnmouth V1's — T61's settle); document r3 (D3) "…along the Fisherman Way / Gumcester Way stretch (neighbouring
    //   plots 301, 303, 305–308)…"; and the setting-on draw, corpus (D1) "…along the stretch of plots between roughly 301 and
    //   314, near Gumcester Way and the A108 boundary". Each location sentence is the draw's residue, not a hedge (§13).
    //   T63's after legs on the rolled tree (session 77 — production's gate, the setting off; each read by hand whole: 302, 304,
    //   313, the count 3, no hedge): corpus r1 (D2, the design named first) "The surrounding plots in that area are a mix of The
    //   Halton (301, 303, 312, 314), The Alnmouth V1 (305), The Chester (306, 308), and The Kingsville (317) [S1]." (its "plots
    //   301–318 … near Gumcester Way and the A108 boundary" is the cluster's range and F-233's residue); corpus r4 (D3, a neighbour
    //   list) "…the plots appear in the lower-central cluster of the plan, situated near plots 301, 303, 312, 314 and 315 [S3, S4]."
    assert.deepStrictEqual(flips209, ["t52-artifacts/records/after/fs-on-1790578249.json corpus r3", "t52-artifacts/records/after/fs-on-1790578249.json document r3", "t52-artifacts/records/after/fs-on-1790578249.json corpus r5", "t54-artifacts/records/fs-off-1790599533.json corpus r1", "t57-artifacts/records/reingest/fs-1790627657.json corpus", "t59-artifacts/records/reingest/fs-1790701237.json corpus", "t59-artifacts/records/reingest/fs-1790701237.json document", "t60-artifacts/records/after/pod/fs-1790721476.json corpus", "t60-artifacts/records/after/pod/fsclass-1790721476.json corpus", "t61-artifacts/records/after/pod/fs-1790758084.json corpus", "t61-artifacts/records/after/pod/fsclass-1790758084.json corpus", "t61-artifacts/records/reingest/fs-1790762748.json document", "t62-artifacts/records/fs-off-1790766437.json corpus r1", "t62-artifacts/records/fs-off-1790766437.json corpus r2", "t62-artifacts/records/fs-off-1790766437.json corpus r3", "t62-artifacts/records/fs-off-1790766437.json document r3", "t62-artifacts/records/fs-on-1790766437.json corpus", "t63-artifacts/records/after/fs-off-1790809955.json corpus r1", "t63-artifacts/records/after/fs-off-1790809955.json corpus r4"]);
    // F-220 + F-221's flips, each read by hand WHOLE (session 71, frontier-artifacts/f220/measure_f220.js — F-221 alone moves no
    // cell on record): production's v10 re-ingest gate (session 70 — 302, 304, 313 in a table and "3 plots", no hedge, 301 only
    // as a range's end), document (F-220, a doubt word in a clause that denies doubt) "The counts were cross-checked against
    // the conflict list to confirm no ambiguity for the three Denby plots."
    assert.deepStrictEqual(flips220, ["t57-artifacts/records/reingest/fs-1790627657.json document"]);
    // F-202 / F-203 (b) change the text the judge reads, never a verdict on record (measured before the change: 0 of 139 FS-2 answers).
    assert.deepStrictEqual(flipsText, []);
    assert.ok(red.length >= 30, `${red.length} hedges stay RED`);
    // The by-hand read's tool walks the same cells (F-201): the census and fs2_census.js cannot drift apart.
    assert.deepStrictEqual(require(B("frontier-artifacts", "fs2_census.js")).fs2Cells().map((c) => c.name), cells.map((c) => c.name));
  });

  test("the forms on the FS-2 check: a denial is discounted (no / none / not / n't / un- / non-), a hedge in its own words counts, a double negation asserts the doubt, the comma ends a cue's clause, a sentence not about the Denby is discounted, a plot number fails on any mention, a trailing denial reads as a hit (RED, by hand — stated)", () => {
    const v = (s) => evaluateCheck(FQ11, `${RIGHT} ${s}`);
    const denials = ["No reading conflicts are noted for any of these plot numbers.", "None of the three Denby plots appear in the list of 8 conflicting/ambiguous readings, so their identification is unambiguous.", "These three are listed unambiguously in the plot index.", "The Denby's plots are non-conflicting.", "The Denby plots aren't ambiguous.", "There is not one conflict on the Denby's plots."];
    for (const d of denials) { const r = v(d); assert.strictEqual(r.pass, true, d); assert.deepStrictEqual(hits(r), [], d); assert.ok(r.detail.mustNotMatchDiscounted.length >= 1 && r.detail.mustNotMatchDiscounted.every((x) => /negated/.test(x.reason)), d); }
    assert.deepStrictEqual(disc(v(denials[1])), [["conflict", "negated"], ["ambiguous", "negated"], ["ambiguous", "negated"]]);
    const hedges = [["Plot 302 could not be definitively assigned to a single design.", "definitively assigned"], ["Plot 302 could be one design or the other.", "one design or the other"], ["Whether 313 is the Denby cannot be confirmed from the legend.", "cannot be confirmed from the legend"], ["The reading of plot 302 is not unambiguous.", "ambiguous"], ["No, the Denby's plots are ambiguous.", "ambiguous"], ["Plot 302 is ambiguous; no conflict is noted.", "ambiguous"], ["### Ambiguous Plots (Denby or Halton): 2", "Ambiguous"]];
    for (const [h, word] of hedges) { const r = v(h); assert.strictEqual(r.pass, false, h); assert.deepStrictEqual(hits(r), [word], h); }
    assert.deepStrictEqual(disc(v(hedges[5][0])), [["conflict", "negated"]], "the second clause's denial is discounted beside the first clause's hit");
    const elsewhere = ["Eight reading conflicts remain on the plan.", "The Halton's plot 305 is ambiguous.", "### Ambiguous / Conflict Plots"];
    for (const e of elsewhere) { const r = v(e); assert.strictEqual(r.pass, true, e); assert.ok(r.detail.mustNotMatchDiscounted.length >= 1 && r.detail.mustNotMatchDiscounted.every((x) => x.reason === "not about the subject"), e); }
    assert.deepStrictEqual(hits(v("Plot 301 may also be a Denby.")), ["301"]);
    assert.deepStrictEqual(hits(v("Plots 301 and 303 are not the Denby's.")), ["301", "303"], "a plot number is a fact: any mention fails, negated or not (T44's rule)");
    assert.deepStrictEqual(hits(v("Ambiguous readings for the Denby: none.")), ["Ambiguous"], "a cue after the match is not read — the residue errs toward RED");
  });

  test("the shape: FQ11's verdict carries mustNotMatchDiscounted (empty on a clean answer); FQ01 (no subject) reads each hit for a negation since F-211 (the owner's D4 (a)) — { negationRule: false }, { subjectRule: false } and a check without a list are byte for byte T44's; T44's any-hit reading is { subjectRule: false }, F-189 (b) alone { rangeRule: false }", () => {
    const clean = evaluateCheck(FQ11, RIGHT);
    assert.deepStrictEqual({ pass: clean.pass, hits: clean.detail.mustNotMatch, discounted: clean.detail.mustNotMatchDiscounted }, { pass: true, hits: [], discounted: [] });
    const NEG = "not three vertical lines: 334, 1516, 1744, 390, 220, 16";
    const fs1 = evaluateCheck(q("FQ01").check, NEG);
    assert.deepStrictEqual({ pass: fs1.pass, hits: fs1.detail.mustNotMatch, discounted: fs1.detail.mustNotMatchDiscounted }, { pass: true, hits: [], discounted: [{ pattern: "three vertical lines", match: "three vertical lines", sentence: NEG, reason: "negated" }] }, "no subject: F-211's negation reading — the denied layout is discounted, on record");
    for (const opts of [{ negationRule: false }, { subjectRule: false }]) {
      const any = evaluateCheck(q("FQ01").check, NEG, opts);
      assert.ok(!("mustNotMatchDiscounted" in any.detail), `${JSON.stringify(opts)}: no discounted list`);
      assert.deepStrictEqual(any.detail.mustNotMatch, [{ pattern: "three vertical lines", match: "three vertical lines" }]);
      assert.strictEqual(any.pass, false, `${JSON.stringify(opts)}: T44's any-hit reading — a negation does not save it`);
    }
    const off = evaluateCheck(FQ11, RIGHT + " No reading conflicts are noted.", { subjectRule: false });
    assert.deepStrictEqual(off.detail.mustNotMatch, [{ pattern: CONFLICT.source, match: "conflict" }]);
    assert.ok(!("mustNotMatchDiscounted" in off.detail));
    assert.ok(!("mustNotMatchDiscounted" in evaluateCheck({ patterns: ["x"], counts: [{ label: "Denby", value: 3 }] }, "Denby 3 x").detail), "counts without a list: no key");
    const numeric = { patterns: ["\\b302\\b"], counts: [{ label: "Denby", value: 3 }], mustNotMatch: ["\\b301\\b"] };
    assert.deepStrictEqual(evaluateCheck(numeric, "Denby 3: 302").detail.mustNotMatchDiscounted, [], "a numeric list alone: F-199 (a) reads the numbers — the key present, empty on a clean answer");
    assert.ok(!("mustNotMatchDiscounted" in evaluateCheck(numeric, "Denby 3: 302", { rangeRule: false }).detail), "a numeric list alone under F-189 (b) alone: no key (its shape of sessions 57–59)");
    assert.ok(!("mustNotMatchDiscounted" in evaluateCheck(numeric, "Denby 3: 302", { subjectRule: false }).detail), "T44's reading: no key");
  });

  test("the class vocabulary: every alternative of CONFLICT is a doubt word (denied by a negation) or a hedge in its own words (counted as written) — a new alternative must be placed; the helpers", () => {
    const alts = CONFLICT.source.split(/\|(?![^(]*\))/); // the top-level alternatives (not the ones inside a group)
    assert.deepStrictEqual(alts.filter((a) => DOUBT_WORD.test(a)), ["conflict", "ambiguous"]);
    assert.deepStrictEqual(alts.filter((a) => !DOUBT_WORD.test(a)), ["definitively assigned", "one design or the other", "cannot be (?:confirmed|determined|read) from the (?:legend|key|map)"]);
    assert.ok(isWorded(CONFLICT.source) && !isWorded("\\b301\\b") && !isWorded("\\b303\\b") && isWorded("three vertical lines"));
    assert.deepStrictEqual(subjectOf(FQ11).map(String), ["/\\bDenby\\b/i", "/\\b302\\b/i", "/\\b304\\b/i", "/\\b313\\b/i"]);
    assert.strictEqual(subjectOf(q("FQ01").check), null);
    assert.deepStrictEqual(sentencesOf("A first sentence. Two additional plots (i.e. 301 and 303) are flagged.\n| 302 | The Denby |"), ["A first sentence.", "Two additional plots (i.e. 301 and 303) are flagged.", "| 302 | The Denby |"]);
    assert.deepStrictEqual([negated("no conflicts here", 3), negated("No, the plots are ambiguous", 18), negated("is not unambiguous", 9), negated("the plots are unambiguous", 16), negated("without any conflict", 12)], [true, false, false, true, true]);
  });
});

describe("U-FIGCHECK 10: F-199 (a) — a plot number fails on any mention except as a range's end (the owner's choice, 2026-09-26: the range rule only)", () => {
  const FQ11 = q("FQ11").check;
  const hits = (v) => v.detail.mustNotMatch.map((h) => h.match);
  const ranges = (v) => (v.detail.mustNotMatchDiscounted || []).filter((d) => d.reason === "a range endpoint").map((d) => [d.match, d.range]);
  const RIGHT = "The Denby: 3 plots — 302, 304 and 313.";
  const CHAIN = B("t46-artifacts", "records", "chain", "t32after", "figq-D-1790377666-1.json"), PROD9 = B("t46-artifacts", "records", "reingest", "fs-1790413460.json");
  const cell = (r, scope) => r.turns.find((t) => t.id === "FQ11" && (t.scope || "corpus") === scope).answer;

  test("the two recorded range answers read GREEN — T46's chain arm D FQ11 run 1 and production's document cell after the v9 re-ingest, both right (302, 304, 313, the count 3) — with the range on record; F-189 (b) alone read both RED on the range's 301; production's post-v9 gate re-judged GREEN in all six cells, exit 0", () => {
    const chain = evaluateCheck(FQ11, cell(json(CHAIN), "corpus"));
    assert.deepStrictEqual({ pass: chain.pass, matches: chain.matches, counts: chain.detail.counts, hits: hits(chain), ranges: ranges(chain) }, { pass: true, matches: 3, counts: [{ label: "Denby", value: 3, ok: true }], hits: [], ranges: [["301", "301 through 318"]] });
    const prod = json(PROD9);
    const doc = evaluateCheck(FQ11, cell(prod, "document"));
    assert.deepStrictEqual({ pass: doc.pass, matches: doc.matches, counts: doc.detail.counts, hits: hits(doc), ranges: ranges(doc) }, { pass: true, matches: 3, counts: [{ label: "Denby", value: 3, ok: true }], hits: [], ranges: [["301", "301–308"]] });
    for (const a of [cell(json(CHAIN), "corpus"), cell(prod, "document")]) assert.deepStrictEqual(hits(evaluateCheck(FQ11, a, { rangeRule: false, clauseDenialRule: false, cueScopeRule: false })), ["301"], "F-189 (b) alone: RED on the range's 301");
    const j = judgeRecord(prod, set);
    assert.deepStrictEqual(j.rows.map((r) => [r.fs, r.cells.corpus.verdict, r.cells.document.verdict]), [["FS-1", "GREEN", "GREEN"], ["FS-2", "GREEN", "GREEN"], ["FS-3", "GREEN", "GREEN"]]);
    assert.deepStrictEqual({ judged: j.judged, red: j.red, exit: j.exit }, { judged: 6, red: 0, exit: 0 });
    assert.match(j.rows[1].cells.document.reasons.join("; "), /no must-not-match hit; discounted 1: "301" \(a range endpoint "301–308"\) in "Looking at the plot layout, plots 302 and 304 sit adjacent to each other in the cluster around plots 301–308/);
  });

  test("the forms: a range's end in every spelling is discounted (a hyphen, an en / em dash, a minus, \"to\", \"through\", \"thru\", an arrow, \"to plot\"; a range inside a Denby sentence; 303 as the upper end); 301 / 303 named as a Denby, in a list, after a dash with no number, beside a number of another length or in a descending pair still FAIL", () => {
    const v = (s) => evaluateCheck(FQ11, `${RIGHT} ${s}`);
    const discounted = [
      ["They sit in the cluster around plots 301–308.", "301–308"],
      ["They sit in the cluster around plots 301-308.", "301-308"],
      ["They sit in the row 301 — 308 on the plan.", "301 — 308"],
      ["They sit in the row 301−308.", "301−308"],
      ["They sit along the stretch of plots running from 301 through 318.", "301 through 318"],
      ["They sit along the stretch from 301 to 318.", "301 to 318"],
      ["They sit along plots 301 thru 318.", "301 thru 318"],
      ["They sit in the row that runs 301 → 314.", "301 → 314"],
      ["They sit in the row from plot 301 to plot 318.", "301 to plot 318"],
      ["The Denby is the least-represented home type, appearing only in the 301–313 cluster.", "301–313"],
      ["Plots 295–303 lie to the west.", "295–303"],
    ];
    for (const [s, range] of discounted) {
      const r = v(s);
      assert.deepStrictEqual({ pass: r.pass, hits: hits(r) }, { pass: true, hits: [] }, s);
      assert.ok(ranges(r).length === 1 && ranges(r)[0][1] === range, `${s}: ${JSON.stringify(ranges(r))}`);
    }
    const counted = [
      ["Plot 301 may also be a Denby.", ["301"]],
      ["The Denby: 301, 302, 304 and 313.", ["301"]],
      ["- Plot 301 – The Denby or The Halton", ["301"]],
      ["Plots 301 and 303 could be the Denby.", ["301", "303"]],
      ["Possible additional plots: 301, 303.", ["301", "303"]],
      ["Possible additional plots: 301/303.", ["301", "303"]],
      ["Plot 301 – 4-bedroom, the Halton or the Denby.", ["301"]],
      ["The plots run 318 to 301 along the road.", ["301"]],
      ["Plots 301 and 303 are not the Denby's.", ["301", "303"]],
    ];
    for (const [s, want] of counted) { const r = v(s); assert.strictEqual(r.pass, false, s); assert.deepStrictEqual(hits(r), want, s); assert.deepStrictEqual(ranges(r), [], `${s}: no range`); }
    const both = v("They sit in the cluster around plots 301–308. Plot 303 may also be a Denby.");
    assert.deepStrictEqual({ pass: both.pass, hits: hits(both), ranges: ranges(both) }, { pass: false, hits: ["303"], ranges: [["301", "301–308"]] }, "a range's end is discounted beside a mention that counts");
    const twice = v("They sit in the cluster around plots 301–308. Plot 301 is a Denby.");
    assert.deepStrictEqual({ pass: twice.pass, hits: hits(twice), ranges: ranges(twice) }, { pass: false, hits: ["301"], ranges: [["301", "301–308"]] }, "the same number as a range's end and named: the named one counts");
  });

  test("the residue, stated with the owner's choice: a hedge worded ONLY as a range reads GREEN (its ends discounted, no class word in its sentence) — none on record, every hedge on record also names 301 / 303 on its own (the census: every hedge RED); the class's words in a sentence about the Denby still make it RED", () => {
    const r = evaluateCheck(FQ11, `${RIGHT} The Denby could rise to 5 plots (301–304 + 313).`);
    assert.deepStrictEqual({ pass: r.pass, hits: hits(r), ranges: ranges(r) }, { pass: true, hits: [], ranges: [["301", "301–304"]] });
    const worded = evaluateCheck(FQ11, `${RIGHT} The Denby plots (301–304) could not be definitively assigned.`);
    assert.deepStrictEqual({ pass: worded.pass, hits: hits(worded) }, { pass: false, hits: ["definitively assigned"] });
  });

  test("rangeEndpoints: both ends of every range with its words; not a range — a dash with no number after, unequal digit counts, descending, a list, a pair with a space", () => {
    assert.deepStrictEqual(rangeEndpoints("plots 301–308 and 310"), [{ start: 6, end: 9, range: "301–308" }, { start: 10, end: 13, range: "301–308" }]);
    assert.deepStrictEqual(rangeEndpoints("from 301 through 318, then 320 → 330").map((e) => e.range), ["301 through 318", "301 through 318", "320 → 330", "320 → 330"]);
    for (const s of ["301 – The Denby", "301 – 4-bedroom", "318 to 301", "301 and 303", "301, 303", "301/303", "301 303"]) assert.deepStrictEqual(rangeEndpoints(s), [], s);
  });

  test("gates35's FQ11 line gates T35's own facts (the three plots, the Denby's count of 3) and notes the frontier judge's verdict beside it: T46's chain re-judged from its committed records reads \"T35 GATES: all met\"; a hedge with the facts met is OK on the line with the judge's RED and its words noted", () => {
    const GATES35 = B("t35-artifacts", "gates35.js");
    const env = (tmp) => ({ ...process.env, NEXCODE_ROOT: ROOT, T35_TMP: tmp, T35_IDENTITY_NON_DETAIL_BASE: "105" });
    const r = spawnSync(process.execPath, [GATES35, "1790377666", "121", "728"], { encoding: "utf8", cwd: ROOT, env: env(B("t46-artifacts", "records", "chain")), timeout: 60000 });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^OK {3}FQ11 \(gate\) run 1: 3\/3 counts Denby=3:ok finish=stop golden rank=1 — the frontier judge \(not gated here\): GREEN$/m);
    assert.match(r.stdout, /^T35 GATES: all met$/m);
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "u-figcheck-g35-"));
    try {
      fs.mkdirSync(path.join(tmp, "t32after"));
      const hedge = `${RIGHT} Plot 301 may also be a Denby.`;
      fs.writeFileSync(path.join(tmp, "t32after", "figq-D-1-1.json"), JSON.stringify({ turns: [{ id: "FQ11", mode: "gate", answer: hedge, finishReason: "stop", goldenRank: 1, check: { pass: false } }] }));
      const h = spawnSync(process.execPath, [GATES35, "1", "121", "728"], { encoding: "utf8", cwd: ROOT, env: env(tmp), timeout: 60000 });
      assert.match(h.stdout, /^OK {3}FQ11 \(gate\) run 1: 3\/3 counts Denby=3:ok finish=stop golden rank=1 — the frontier judge \(not gated here\): RED on "301"$/m, h.stdout);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe("U-FIGCHECK 11: the gate as a RATE — `--repeat N` and \"GREEN k / N\" (T48, t48-design.md §3, D10; F-205)", () => {
  const RUNNER = B("workshop-artifacts", "ab", "run_figure_questions.js");
  const run = (args) => {
    const out = path.join(require("os").tmpdir(), `u-figcheck-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    const r = spawnSync(process.execPath, [RUNNER, SET_PATH, out, ...args], { encoding: "utf8", env: { ...process.env, RAG_EVAL_APP_ROOT: ROOT, RAG_EVAL_APP_URL: "http://127.0.0.1:9" }, timeout: 20000 });
    return { status: r.status, stderr: r.stderr, wrote: fs.existsSync(out) };
  };
  // Session 60's sampled BEFORE (t48-artifacts/probes/records/policy-1790451520.json — production's captured FS-1 turn,
  // today's rules, 5 samples per scope at the product's decoding) shaped as the runner's --repeat 5 record.
  const sampled = json(B("t48-artifacts", "probes", "records", "policy-1790451520.json"));
  const rateRecord = { turns: sampled.runs.filter((r) => r.arm === "baseline").map((r) => ({ id: r.id, scope: r.scope, repeat: r.sample, answer: r.answer, httpStatus: 200, success: true })) };
  test("the sampled BEFORE reads FS-1 GREEN 3 / 5 per scope, 6 / 10 pooled — F-205's rate, through the product's judge; each run keeps its own verdict, reasons and repeat", () => {
    const j = judgeRecord(rateRecord, set);
    assert.strictEqual(j.rows.length, 1);
    const row = j.rows[0];
    assert.deepStrictEqual([row.cells.corpus.verdict, row.cells.document.verdict], ["GREEN 3 / 5", "GREEN 3 / 5"]);
    assert.deepStrictEqual(row.rate, { green: 6, n: 10 });
    assert.deepStrictEqual(row.cells.corpus.runs.map((r) => [r.repeat, r.verdict]), [[1, "GREEN"], [2, "GREEN"], [3, "RED"], [4, "GREEN"], [5, "RED"]]);
    for (const r of row.cells.corpus.runs.filter((x) => !x.pass)) assert.match(r.reasons.join("; "), /must-not-match HIT/, "every RED is the old layout (§0d: \"three columns\")");
    assert.deepStrictEqual({ judged: j.judged, red: j.red, exit: j.exit }, { judged: 10, red: 4, exit: 1 }, "the exit still states the truth: any RED run is 1");
    assert.strictEqual(row.cells.corpus.pass, false);
  });
  test("a record without repeats judges exactly as before T48 (no rate, no runs) — the post-v9 production gate: GREEN in all six cells, exit 0", () => {
    const j = judgeRecord(json(B("t46-artifacts", "records", "reingest", "fs-1790413460.json")), set);
    assert.ok(j.rows.every((r) => r.rate === undefined && Object.values(r.cells).every((c) => c.runs === undefined && /^(GREEN|RED)$/.test(c.verdict))));
    assert.deepStrictEqual(j.rows.map((r) => [r.fs, r.cells.corpus.verdict, r.cells.document.verdict]), [["FS-1", "GREEN", "GREEN"], ["FS-2", "GREEN", "GREEN"], ["FS-3", "GREEN", "GREEN"]]);
    assert.strictEqual(j.exit, 0);
  });
  test("all green over N runs is \"GREEN N / N\" and passes; a before record's cell sits beside the first run", () => {
    const green = { turns: rateRecord.turns.filter((t) => judgeRecord({ turns: [t] }, set).red === 0) };
    const j = judgeRecord(green, set, { before: json(B("t46-artifacts", "records", "reingest", "fs-1790413460.json")) });
    const c = j.rows[0].cells.corpus;
    assert.strictEqual(c.verdict, `GREEN ${c.n} / ${c.n}`);
    assert.strictEqual(c.pass, true);
    assert.strictEqual(c.runs[0].before.verdict, "GREEN");
  });
  test("the runner refuses a bad --repeat or --beyond-the-documents before any request (no record written); the setting rides in the request's ragSettings", () => {
    for (const bad of ["0", "51", "2.5", "x"]) {
      const r = run(["--production", "--only", "FQ01", "--repeat", bad]);
      assert.strictEqual(r.status, 2, bad);
      assert.match(r.stderr, /--repeat must be an integer from 1 to 50/, bad);
      assert.strictEqual(r.wrote, false, bad);
    }
    for (const bad of [["--beyond-the-documents", "yes"], ["--beyond-the-documents"]]) {
      const r = run(["--production", "--only", "FQ01", ...bad]);
      assert.strictEqual(r.status, 2, bad.join(" "));
      assert.match(r.stderr, /--beyond-the-documents must be on or off/);
    }
    const src = fs.readFileSync(RUNNER, "utf8");
    assert.match(src, /repeat: REPEAT,\n  beyondTheDocuments: adminConfigBase\.ragSettings\.beyondTheDocuments \?\? null,/, "the record names the passes and the setting");
    assert.match(src, /repeat: rep,/, "every turn names its pass");
  });
});

describe("U-FIGCHECK 12: F-206 (c), F-202, F-203 (b), F-204 (b) — the owner's D1–D4 (2026-09-27, the FS-2 judge's harness PR after T48)", () => {
  const FQ11 = q("FQ11").check, FQ01 = q("FQ01").check;
  const { attributionOf } = require(B("workshop-artifacts", "ab", "figure_checks.js"));
  const hits = (v) => v.detail.mustNotMatch.map((h) => h.match);
  const attributed = (v) => (v.detail.mustNotMatchDiscounted || []).filter((d) => d.reason === "attributed to another design").map((d) => [d.match, d.design, d.attribution]);
  const RIGHT = "The Denby: 3 plots — 302, 304 and 313.";
  const T48 = (f) => json(B("t48-artifacts", "records", "after", f));
  const cell = (r, scope, rep) => r.turns.find((t) => t.id === "FQ11" && t.scope === scope && t.repeat === rep).answer;
  /** Every turn of the runner records (fs-* / fsclass-* / figq-*) for the given question ids, named by record, id, scope and pass. */
  const runnerTurns = (ids) => {
    const files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/^(fs|fsclass|figq)-.*\.json$/.test(e.name)) files.push(p); } })(B());
    const out = [];
    for (const f of files.sort()) { const r = json(f); if (!Array.isArray(r.turns)) continue; for (const t of r.turns) if (ids.includes(t.id) && typeof t.answer === "string") out.push({ name: `${path.relative(B(), f)} ${t.id} ${t.scope || "corpus"}${t.repeat ? ` r${t.repeat}` : ""}`, id: t.id, answer: t.answer }); }
    return out;
  };

  test("F-206 (c): T48's three right-answer REDs read GREEN with the design and the attribution on record (the rules of sessions 60–61 read all three RED); T48's two gate records re-judged — FS-2 GREEN 10 / 10 in both states, the by-hand count (FS-1 9 / 10 with the setting off since set v5 — F-211, by hand); the judge prints the discount", () => {
    const off = T48("fs-1790497746.json"), on = T48("fs-on-1790497746.json");
    const want = [
      [off, "corpus", 3, [["301", "The Halton", "(The Halton)"], ["303", "The Halton", "(The Halton)"]]],
      [off, "document", 4, [["303", "The Halton", "being The Halton between them"]]],
      [on, "document", 4, [["301", "The Halton", "(The Halton)"], ["303", "The Halton", "(The Halton)"]]],
    ];
    for (const [r, scope, rep, attr] of want) {
      const v = evaluateCheck(FQ11, cell(r, scope, rep));
      assert.deepStrictEqual({ pass: v.pass, matches: v.matches, counts: v.detail.counts, hits: hits(v), attributed: attributed(v) }, { pass: true, matches: 3, counts: [{ label: "Denby", value: 3, ok: true }], hits: [], attributed: attr }, `${scope} r${rep}`);
      assert.strictEqual(evaluateCheck(FQ11, cell(r, scope, rep), { attributionRule: false }).pass, false, `${scope} r${rep}: RED under F-189 (b) + F-199 (a)`);
    }
    // Since set v5 (F-211, the owner's D4 (a), 2026-09-28) the setting-off record's FS-1 corpus r2 reads RED on "2 x 3 grid" —
    // a wrong layout by hand ("The pattern is essentially a 2 × 3 grid (two rows …) plus two mid-depth points", after its own
    // "four vertical columns"): FS-1 9 / 10 there, the by-hand count; FS-2 stays 10 / 10 in both states (this test's point).
    for (const [r, fs1, exit] of [[off, 9, 1], [on, 10, 0]]) {
      const j = judgeRecord(r, set);
      assert.deepStrictEqual(j.rows.map((x) => [x.fs, x.rate]), [["FS-1", { green: fs1, n: 10 }], ["FS-2", { green: 10, n: 10 }], ["FS-3", { green: 10, n: 10 }]]);
      assert.strictEqual(j.exit, exit);
    }
    assert.match(judgeRecord(off, set).rows[0].cells.corpus.runs.find((x) => x.repeat === 2).reasons.join("; "), /must-not-match HIT "2 x 3 grid"/);
    const r3 = judgeRecord(off, set).rows.find((x) => x.fs === "FS-2").cells.corpus.runs.find((x) => x.repeat === 3);
    assert.match(r3.reasons.join("; "), /no must-not-match hit; discounted 4: "301" \(attributed to another design — The Halton, "\(The Halton\)"\) in "These three plots are situated in the lower-central cluster/);
  });

  test("F-206 (c) — the forms: a number written as ONE other design's plot is discounted (a parenthesis, a copula, an apposition, emphasis; any design, named as a design is named); still counted — the Denby, a Denby plot, a second design or a doubt in the attribution, a doubt or the class asserted in its sentence, a negated attribution, no name first, a table row, a shared attribution; the residue stated", () => {
    const v = (s) => evaluateCheck(FQ11, `${RIGHT} ${s}`);
    const discounted = [
      ["They sit beside 301 (The Halton).", [["301", "The Halton", "(The Halton)"]]],
      ["Plot 303 is The Halton.", [["303", "The Halton", "is The Halton."]]],
      ["Plots 302 and 304 sit together (with 303 being The Halton between them).", [["303", "The Halton", "being The Halton between them"]]],
      ["Plot 301 — The Halton — sits to the west.", [["301", "The Halton", "— The Halton — sits to the west."]]],
      ["301: The Halton.", [["301", "The Halton", ": The Halton."]]],
      ["301 (*The Halton*) lies west.", [["301", "The Halton", "(*The Halton*)"]]],
      ["301 (The Kingsville) lies west.", [["301", "The Kingsville", "(The Kingsville)"]]],
    ];
    for (const [s, attr] of discounted) { const r = v(s); assert.deepStrictEqual({ pass: r.pass, hits: hits(r), attributed: attributed(r) }, { pass: true, hits: [], attributed: attr }, s); }
    const counted = [
      "They sit beside 301 (The Denby or The Halton).", // the subject in the attribution
      "Plot 301 (The Denby).", // the subject itself
      "Plot 301 (possibly Denby).", // a doubt word, no design named first
      "Plot 301 (possibly The Halton).",
      "Plot 301 (The Halton or The Kingsville).", // a second design
      "Plot 301 (The Halton?)", // a doubt mark
      "Plot 301 (The Halton, next to 302).", // a Denby plot in the attribution
      "They may sit beside 301 (The Halton).", // a doubt word in its sentence
      "Plot 301 (The Halton) is a conflict reading.", // the class asserted in its sentence
      "Plot 301 is not The Halton.", // a negated attribution
      "Plot 301 – read as The Denby.", // no design named first
      "| 301 | The Halton |", // a table row is no attribution
      "Plots 301 and 303 (both The Halton).", // a shared attribution is not read
    ];
    for (const s of counted) { const r = v(s); assert.strictEqual(r.pass, false, s); assert.ok(hits(r).includes("301"), `${s}: 301 counted`); assert.deepStrictEqual(attributed(r).filter((a) => a[0] === "301"), [], `${s}: 301 not attributed`); }
    // The residue, stated with the owner's choice: a doubt about an attributed plot written in a LATER sentence, and any
    // capitalised name after the connector read as a design — both GREEN, none on record.
    const later = v("They sit beside 301 (The Halton). It may also be a Denby.");
    assert.deepStrictEqual({ pass: later.pass, attributed: attributed(later) }, { pass: true, attributed: [["301", "The Halton", "(The Halton)"]] });
    assert.deepStrictEqual(attributed(v("Plot 301 (Gumcester Way) lies west.")), [["301", "Gumcester Way", "(Gumcester Way)"]]);
    // … and the other way: the sentence's doubt list cannot tell "either side" from "either … or" — the number counts (RED, by hand; the rule errs toward RED).
    assert.deepStrictEqual(hits(v("Plots 302 and 304 sit either side of 303 (The Halton).")), ["303"]);
    // The helper; a check without a subject reads no attribution (FQ01 — T44's any-hit reading); { rangeRule: false } reads none either.
    const s = "adjacent to plots 301 (The Halton), 303";
    assert.deepStrictEqual(attributionOf(FQ11, subjectOf(FQ11), s, s.indexOf("301") + 3), { design: "The Halton", words: "(The Halton)" });
    assert.strictEqual(attributionOf(FQ11, subjectOf(FQ11), "plots 301 (The Denby)", 9), null);
    const fq01 = evaluateCheck(FQ01, "three columns (The Halton)");
    assert.deepStrictEqual({ hits: hits(fq01), discounted: fq01.detail.mustNotMatchDiscounted }, { hits: ["three columns"], discounted: [] }, "a check without a subject reads no attribution — since F-211 only its negation reading, none here");
    assert.deepStrictEqual(hits(evaluateCheck(FQ11, `${RIGHT} They sit beside 301 (The Halton).`, { rangeRule: false })), ["301"]);
  });

  test("F-202: \"No.\" / \"Nos.\" before a digit keeps its sentence — a class word after \"(Nos. 305, 306)\" is read in its Denby sentence (the old splitter cut it off: GREEN on a hedge); \"No.\" before a word still ends one; { nosRule: false } is the old splitter", () => {
    assert.deepStrictEqual(sentencesOf("Possible Denby plots (Nos. 305, 306) conflict. Plot No. 5 is here."), ["Possible Denby plots (Nos. 305, 306) conflict.", "Plot No. 5 is here."]);
    assert.deepStrictEqual(sentencesOf("Possible Denby plots (Nos. 305, 306) conflict.", { nosRule: false }), ["Possible Denby plots (Nos.", "305, 306) conflict."]);
    assert.deepStrictEqual(sentencesOf("The answer is No. The plots are 302."), ["The answer is No.", "The plots are 302."]);
    const hedge = `${RIGHT} Possible Denby plots (Nos. 305, 306) conflict.`;
    assert.deepStrictEqual({ pass: evaluateCheck(FQ11, hedge).pass, hits: hits(evaluateCheck(FQ11, hedge)) }, { pass: false, hits: ["conflict"] });
    assert.strictEqual(evaluateCheck(FQ11, hedge, { nosRule: false }).pass, true, "the old splitter cut the Denby off the class word");
  });

  test("F-203 (b) — the thousands rule: a separator joins only after a one- or two-digit leading group (\"1,072\", \"1 744\", \"12,345\"); a list of same-length plot numbers and a four-digit lead stay apart (\"301,303\", \"(1744,220)\"); F-203's hedge now reads RED; every FS-1 / FS-3 answer of the runner records and §0d reads as under the old join; { thousandsRule: false } is the old join", () => {
    assert.strictEqual(normalise("1,072 sq ft · 1 744 mm · 12,345 · 1 820"), "1072 sq ft · 1744 mm · 12345 · 1820");
    assert.strictEqual(normalise("301,303 · 301 303 · (1744,220) · (1516,390) · (334,390) · 100,000"), "301,303 · 301 303 · (1744,220) · (1516,390) · (334,390) · 100,000");
    assert.strictEqual(normalise("301,303 · 301 303 · (1744,220) · 1,072", { thousandsRule: false }), "301303 · 301303 · (1744220) · 1072");
    const hedge = `${RIGHT} Possibly also 301,303.`;
    assert.deepStrictEqual(hits(evaluateCheck(FQ11, hedge)), ["301", "303"]);
    assert.strictEqual(evaluateCheck(FQ11, hedge, { thousandsRule: false }).pass, true, "the old join hid both plots: a hedge read GREEN");
    const answers = [...runnerTurns(["FQ01", "FQ12"]), ...TWELVE.filter((x) => x.fs !== "FS-2")];
    for (const a of answers) { const c = q(a.id).check, x = evaluateCheck(c, a.answer), y = evaluateCheck(c, a.answer, { thousandsRule: false }); assert.deepStrictEqual([x.pass, x.matches, x.detail.totals], [y.pass, y.matches, y.detail.totals], a.name); }
    assert.ok(answers.length >= 150, `${answers.length} FS-1 / FS-3 answers read`);
  });

  test("F-204 (b): FQ01's four new spellings hit the three-column picture as the answers on record write it, never the right layout (\"four vertical columns\", \"two inner columns\"); the three probe answers they turn RED carry all six coordinates; no gate record's FS-1 verdict moved under set v4 (the runner records read as under set v3's eight spellings)", () => {
    // Since set v5 the class carries F-211's six after these four; F-204's claims are about set v4 (twelve) against set v3
    // (eight), read as F-204 was measured — T44's any-hit reading ({ negationRule: false }).
    assert.deepStrictEqual(FQ01.mustNotMatch.slice(8, 12), ["three vertical columns", "three fastening columns", "three foot columns", "three horizontal column"]);
    const ANY = { negationRule: false };
    const v3 = { ...FQ01, mustNotMatch: FQ01.mustNotMatch.slice(0, 8) }, v4 = { ...FQ01, mustNotMatch: FQ01.mustNotMatch.slice(0, 12) };
    for (const phrase of ["arranged in three vertical columns", "the three fastening columns", "The Three Foot Columns", "one of the three horizontal column positions"]) assert.strictEqual(evaluateCheck(v4, phrase, ANY).detail.mustNotMatch.length, 1, phrase);
    for (const phrase of ["four vertical columns", "two inner columns", "four columns", "4 columns", "two intermediate columns", "two per column"]) assert.deepStrictEqual(evaluateCheck(FQ01, phrase).detail.mustNotMatch, [], `${phrase}: never a hit, set v5 included`);
    const probe = (f, arm, key, val) => json(B("t48-artifacts", "probes", "records", f)).runs.find((r) => r.id === "FQ01" && r.arm === arm && r.scope === "corpus" && r[key] === val).answer;
    for (const a of [probe("policy-1790448100.json", "f200n", "pass", "cold"), probe("policy-1790448100.json", "f200n", "pass", "warm"), probe("policy-1790454374.json", "blockfix", "sample", 1)]) {
      const now = evaluateCheck(v4, a, ANY), before = evaluateCheck(v3, a, ANY);
      assert.deepStrictEqual({ before: before.pass, now: now.pass, matches: now.matches, hits: hits(now) }, { before: true, now: false, matches: 6, hits: ["three vertical columns"] });
    }
    const turns = runnerTurns(["FQ01"]);
    for (const t of turns) assert.strictEqual(evaluateCheck(v4, t.answer, ANY).pass, evaluateCheck(v3, t.answer, ANY).pass, t.name);
    assert.ok(turns.length >= 60, `${turns.length} FS-1 cells of the runner records`);
  });
});

describe("U-FIGCHECK 13: F-209 + F-211 — the owner's D1–D4 (2026-09-28, the judge's harness PR after T53): a plot placed, not claimed; FS-1's layout class v5, read for a negation", () => {
  const FQ11 = q("FQ11").check, FQ01 = q("FQ01").check;
  const { betweenEndpoints, designFirstLists, neighbourLists } = require(B("workshop-artifacts", "ab", "figure_checks.js"));
  const PRE_F209 = { betweenRule: false, designFirstRule: false, neighbourRule: false, clauseDenialRule: false, cueScopeRule: false };
  const RIGHT = "The Denby: 3 plots — 302, 304 and 313.";
  const hits = (v) => v.detail.mustNotMatch.map((h) => h.match);
  /** The discounts the judge adds beyond the judge of sessions 62–66 (F-209's own): [match, reason, words]. */
  const beyond = (a) => {
    const pre = evaluateCheck(FQ11, a, PRE_F209).detail.mustNotMatchDiscounted || [];
    return (evaluateCheck(FQ11, a).detail.mustNotMatchDiscounted || []).filter((d) => !pre.some((x) => x.pattern === d.pattern && x.match === d.match && x.sentence === d.sentence && x.reason === d.reason)).map((d) => [d.match, d.reason, d.range || d.attribution || d.neighbours]);
  };
  const run = (f, id, scope, rep) => json(f).turns.find((t) => t.id === id && t.scope === scope && t.repeat === rep).answer;
  const t50 = (f, id, arm, scope, sample) => json(B("t50-artifacts", "probes", "records", f)).runs.find((x) => x.id === id && x.arm === arm && x.scope === scope && x.sample === sample).answer;
  const t48 = (f, arm, scope, key, val) => json(B("t48-artifacts", "probes", "records", f)).runs.find((x) => x.id === "FQ01" && x.arm === arm && x.scope === scope && x[key] === val).answer;
  const T52 = B("t52-artifacts", "records", "after", "fs-on-1790578249.json");

  test("F-209: the six right answers on record read GREEN — T52's setting-on leg (corpus r3, document r3, corpus r5) and T50's probe (base corpus s3, r10w1 corpus s4, r10w2 document s3), each read whole in session 67 (302, 304, 313, the count 3, no hedge) — with each discount on record; the judge of sessions 62–66 read all six RED; T52's leg re-judged FS-2 GREEN 10 / 10 (was 7 / 10), exit 0; the judge prints the words", () => {
    const BETWEEN = "between roughly 301 and 314", NEAR5 = "near plots 301, 303, 305, 306, 307, 308, 309, 310, 311, 312, 314";
    const both = (reason, words) => [["301", reason, words], ["303", reason, words]];
    const want = [
      ["T52 corpus r3 (D1)", run(T52, "FQ11", "corpus", 3), [["301", "a range endpoint", BETWEEN]]],
      ["T50 base corpus s3 (D1)", t50("policy50-f208rest-1790518589.json", "FQ11", "base", "corpus", 3), [["301", "a range endpoint", BETWEEN]]],
      ["T52 document r3 (D2)", run(T52, "FQ11", "document", 3), both("attributed to another design", "The Halton (301, 303)")],
      ["T50 r10w1 corpus s4 (D2)", t50("policy50-f208rest-1790518589.json", "FQ11", "r10w1", "corpus", 4), both("attributed to another design", "The Halton at 301, 303, 312, 314")],
      ["T52 corpus r5 (D3)", run(T52, "FQ11", "corpus", 5), both("a neighbour list", NEAR5)],
      ["T50 r10w2 document s3 (D3)", t50("policy50-onrest-1790521599.json", "FQ11", "r10w2", "document", 3), both("a neighbour list", "near plots 301, 303, 305, and 312")],
    ];
    for (const [name, a, disc] of want) {
      const v = evaluateCheck(FQ11, a);
      assert.deepStrictEqual({ pass: v.pass, matches: v.matches, counts: v.detail.counts, hits: hits(v), beyond: beyond(a) }, { pass: true, matches: 3, counts: [{ label: "Denby", value: 3, ok: true }], hits: [], beyond: disc }, name);
      assert.strictEqual(evaluateCheck(FQ11, a, PRE_F209).pass, false, `${name}: RED under the judge of sessions 62–66`);
    }
    const j = judgeRecord(json(T52), set);
    assert.deepStrictEqual(j.rows.map((x) => [x.fs, x.rate]), [["FS-1", { green: 10, n: 10 }], ["FS-2", { green: 10, n: 10 }], ["FS-3", { green: 10, n: 10 }]]);
    assert.strictEqual(j.exit, 0);
    assert.match(j.rows[1].cells.corpus.runs.find((x) => x.repeat === 5).reasons.join("; "), /no must-not-match hit; discounted 2: "301" \(a neighbour list — near, "near plots 301, 303, 305, 306/);
  });

  test("F-209 — the forms: D1 \"between [roughly] N and M\" (F-199 (a)'s shape); D2 the design named first (a parenthesis, at, on, an apposition, \"plots\"); D3 a neighbour list (near, adjacent to, next to, flanked by, close to, beside); still counted — a descending or unequal pair, \"or\" before the name or in the list, the Denby or a Denby plot, a word of doubt or the class in the sentence, the Denby after a neighbour list, \"adjacent\" without \"to\"; the residue stated; the helpers", () => {
    const EN = String.fromCharCode(0x2013);
    const v = (s) => evaluateCheck(FQ11, `${RIGHT} ${s}`);
    const green = [
      ["They sit along the stretch between 301 and 314.", "a range endpoint"],
      ["They sit between roughly 301 and 314.", "a range endpoint"],
      ["They lie between approximately plots 301 and 318.", "a range endpoint"],
      ["They are flanked by The Halton (301, 303) and The Ennerdale (305).", "attributed to another design"],
      ["Neighbours include The Halton at 301, 303, 312 and 314.", "attributed to another design"],
      ["The Halton: 301 and 303.", "attributed to another design"],
      [`The Halton ${EN} 301, 303.`, "attributed to another design"],
      ["Halton plots 301 and 303 sit beside them.", "attributed to another design"],
      ["the Halton on plots 301 and 303 lies west.", "attributed to another design"],
      ["They sit near plots 301, 303, 305 and 312.", "a neighbour list"],
      ["They sit adjacent to 301 and 303.", "a neighbour list"],
      ["They sit next to plots 301 & 303.", "a neighbour list"],
      ["They are flanked by 301 and 303.", "a neighbour list"],
      ["They sit close to plots 301/303.", "a neighbour list"],
      ["They sit beside 301.", "a neighbour list"],
    ];
    for (const [s, reason] of green) {
      const r = v(s), b = beyond(`${RIGHT} ${s}`);
      assert.deepStrictEqual({ pass: r.pass, hits: hits(r) }, { pass: true, hits: [] }, s);
      assert.ok(b.length > 0 && b.every((d) => d[1] === reason), `${s}: ${JSON.stringify(b)}`);
    }
    const counted = [
      ["They sit between 318 and 301.", ["301"]], // descending
      ["They sit between 301 and 1200.", ["301"]], // unequal digit counts
      ["The Denby or The Halton (301, 303).", ["301", "303"]], // "or" (and the Denby) before the name
      ["The Denby (301, 303).", ["301", "303"]], // the subject itself
      ["The Halton (301, 302).", ["301"]], // a Denby plot in the list
      ["They may be The Halton (301, 303).", ["301", "303"]], // a word of doubt in the sentence
      ["The Halton (301, 303) is a conflict reading.", ["301", "303"]], // the class asserted in the sentence
      ["They sit near plots 301 or 303.", ["303"]], // "or" ends the list: 301 a neighbour, 303 counted
      ["They sit near plots 301 and 303, which are also Denby.", ["301", "303"]], // the Denby after the list
      ["They may sit near plots 301 and 303.", ["301", "303"]], // a word of doubt
      ["They sit near plots 301, 302 and 303.", ["301", "303"]], // a Denby plot in the list
      ["Two adjacent plots (301, 303) are flagged.", ["301", "303"]], // "adjacent" without "to" is no cue
    ];
    for (const [s, want] of counted) { const r = v(s); assert.strictEqual(r.pass, false, s); assert.deepStrictEqual(hits(r), want, s); }
    // The residue, stated with the owner's choice — none on record: a hedge worded ONLY as "between N and M" reads GREEN
    // (F-199 (a)'s residue); any capitalised name before a bracketed plot list reads as a design; a re-assignment written in
    // a LATER sentence reads GREEN.
    for (const s of ["The Denby could also take the plots between 301 and 303.", "Gumcester Way (301, 303) lies west.", "They sit near plots 301 and 303. Both are also Denby homes."]) assert.strictEqual(v(s).pass, true, `the residue: ${s}`);
    // The helpers: both ends of a "between" range with its words; every number of a design-first list with the design and
    // the words; every number of a neighbour list with the cue and the words; a descending or unequal pair is no range.
    assert.deepStrictEqual(betweenEndpoints("running between roughly 301 and 314"), [{ start: 24, end: 27, range: "between roughly 301 and 314" }, { start: 32, end: 35, range: "between roughly 301 and 314" }]);
    assert.deepStrictEqual(betweenEndpoints("between 318 and 301 · between 301 and 1200"), []);
    assert.deepStrictEqual(designFirstLists(FQ11, subjectOf(FQ11), "flanked by The Halton (301, 303) and The Ennerdale (305)"), [{ start: 23, end: 26, design: "The Halton", words: "The Halton (301, 303)" }, { start: 28, end: 31, design: "The Halton", words: "The Halton (301, 303)" }, { start: 52, end: 55, design: "The Ennerdale", words: "The Ennerdale (305)" }]);
    assert.deepStrictEqual(neighbourLists(FQ11, subjectOf(FQ11), "they sit near plots 301, 303 and 305").map((x) => [x.start, x.end, x.cue, x.words]), [[20, 23, "near", "near plots 301, 303 and 305"], [25, 28, "near", "near plots 301, 303 and 305"], [33, 36, "near", "near plots 301, 303 and 305"]]);
    assert.deepStrictEqual(hits(evaluateCheck(FQ11, `${RIGHT} They sit between roughly 301 and 314.`, PRE_F209)), ["301"], "the judge of sessions 62–66: RED on the range's 301");
  });

  test("F-211: set v5's six spellings, read for a negation, turn every wrong layout on record RED — T50's 14 by hand (layout50.js) and the 11 read in session 67 (measure_f209.js) — and no right answer a spelling touches; the right layouts are never a hit; { negationRule: false } reads the denied grid RED; the residue stated; the gate records re-based — T48's setting off and T53's setting on FS-1 9 / 10, the others as recorded", () => {
    const { VERDICTS } = require(B("t50-artifacts", "probes", "layout50.js"));
    const t50key = (k) => { const [f, arm, scope, sample] = k.split("|"); return t50(f, "FQ01", arm, scope, Number(sample)); };
    const v4 = { ...FQ01, mustNotMatch: FQ01.mustNotMatch.slice(0, 12) };
    const ANY = { negationRule: false };
    // The 11 read in session 67 — each after the six coordinates, each a stated structure that contradicts the four x-columns.
    const READ67 = [
      [run(B("t48-artifacts", "records", "after", "fs-1790497746.json"), "FQ01", "corpus", 2), "2 x 3 grid"], // "The pattern is essentially a 2 × 3 grid … plus two mid-depth points"
      [run(B("t53-artifacts", "records", "after", "fs1-on-1790584882.json"), "FQ01", "document", 4), "2-2-2"], // "six points in a 2-2-2 arrangement (two mid-height edge points A & F, plus two pairs …)"
      [json(B("t48-artifacts", "records", "after", "dryrun-1790497746.json")).turns.find((t) => t.n === 3).answer, "2-2-2"], // "Six fixing locations in a 2-2-2 pattern"
      [t48("policy-1790451520.json", "alln2", "corpus", "sample", 5), "2-2-2"], // "a 2-2-2 pattern (two at each end, two in the middle-left, two in the middle-right)"
      [t48("policy-1790454374.json", "blockfixon", "corpus", "sample", 1), "2 x 3 grid"], // "a 2 × 3 grid of anchor holes"
      [t48("policy-1790451520.json", "alln", "document", "sample", 1), "two-column, three-row"], // "a two-column, three-row pattern"
      [t48("policy-1790454374.json", "blockfixon", "document", "sample", 3), "2-3-1"], // "a 2-3-1 pattern"
      [t48("policy-1790448100.json", "baseline", "document", "pass", "cold"), "two rows of three"], // "arranged in two rows of three, plus two mid-height side points"
      [t48("policy-1790448100.json", "baseline", "document", "pass", "warm"), "two rows of three"],
      [t48("policy-1790451520.json", "alln2", "document", "sample", 1), "two columns of three"], // "arranged in two columns of three, plus two mid-height points"
      [t48("policy-1790454374.json", "blockfixon", "corpus", "sample", 3), "two columns of three"],
    ];
    for (const [a, match] of READ67) {
      const now = evaluateCheck(FQ01, a), before = evaluateCheck(v4, a, ANY);
      assert.deepStrictEqual({ before: before.pass, now: now.pass, matches: now.matches, hit: hits(now).includes(match) }, { before: true, now: false, matches: 6, hit: true }, match);
    }
    const t50wrong = Object.keys(VERDICTS).map((k) => [k, t50key(k)]);
    assert.strictEqual(t50wrong.length, 14);
    for (const [k, a] of t50wrong) assert.strictEqual(evaluateCheck(FQ01, a).pass, false, `${k}: RED under set v5`);
    assert.strictEqual(t50wrong.filter(([, a]) => evaluateCheck(v4, a, ANY).pass).length, 11, "11 of T50's 14 read GREEN under set v4");
    // The four right answers a candidate spelling touches — GREEN; the grid DENIED is discounted, never counted.
    const denied = t50key("policy50-onplace-1790527192.json|base|document|2");
    const rights = [denied, t48("policy-1790451520.json", "alwayson", "document", "sample", 2), t50key("policy50-oncombo-1790521599.json|rhmost+tie+rightmost+edges+r10w2|document|2"), t50key("policy50-oncombo-1790524602.json|rhmost+r10w1|document|1")];
    for (const a of rights) assert.strictEqual(evaluateCheck(FQ01, a).pass, true);
    assert.deepStrictEqual((evaluateCheck(FQ01, denied).detail.mustNotMatchDiscounted || []).map((d) => [d.match, d.reason]), [["2 x 3 grid", "negated"]]);
    assert.deepStrictEqual(hits(evaluateCheck(FQ01, denied, ANY)), ["2 x 3 grid"], "T44's any-hit reading would read the denied grid RED — the reason for the negation reading");
    // The spellings on the answers' words: the wrong ones hit, the right ones never.
    for (const [phrase, match] of [["six feet in a 2 × 3 grid", "2 x 3 grid"], ["a 2x3 grid", "2x3 grid"], ["a 2-2-2 arrangement", "2-2-2"], ["a two-row, three-column grid", "three-column"], ["a two-column, three-row pattern", "two-column, three-row"], ["a 2-3-1 pattern", "2-3-1"], ["arranged in two rows of three", "two rows of three"], ["arranged in two columns of three", "two columns of three"]]) assert.deepStrictEqual(hits(evaluateCheck(FQ01, phrase)), [match], phrase);
    for (const phrase of ["four vertical columns", "two inner columns", "three horizontal rows", "a 4-column / 3-row pattern", "The two-column pairs (B/C and D/E)", "a two-column-plus-two-end pattern", "the four inner points form a 2 x 2 grid", "a 1-2-2-1 pattern", "three rows of two"]) assert.deepStrictEqual(hits(evaluateCheck(FQ01, phrase)), [], phrase);
    // The residue, stated with the owner's choice — none on record: a wrong layout under a negation cue in its clause reads as denied.
    assert.deepStrictEqual((evaluateCheck(FQ01, "without doubt a 2-2-2 pattern").detail.mustNotMatchDiscounted || []).map((d) => [d.match, d.reason]), [["2-2-2", "negated"]]);
    // The gate records re-judged: the two wrong layouts on gate records read RED (the by-hand count); the others as recorded.
    const rate = (...p) => judgeRecord(json(B(...p)), set).rows.find((r) => r.fs === "FS-1").rate;
    assert.deepStrictEqual(rate("t48-artifacts", "records", "after", "fs-1790497746.json"), { green: 9, n: 10 });
    assert.deepStrictEqual(rate("t48-artifacts", "records", "after", "fs-on-1790497746.json"), { green: 10, n: 10 });
    assert.deepStrictEqual(rate("t52-artifacts", "records", "after", "fs-on-1790578249.json"), { green: 10, n: 10 });
    assert.deepStrictEqual(rate("t53-artifacts", "records", "after", "fs1-off-1790584882.json"), { green: 10, n: 10 });
    assert.deepStrictEqual(rate("t53-artifacts", "records", "after", "fs1-on-1790584882.json"), { green: 9, n: 10 });
  });

  // THE FS-1 CENSUS — it GROWS with the records, as case 9's does (F-201's rule): every FS-1 cell of the runner records
  // (fs-* / fsclass-* / figq-* and, since T53, fs1-*) reads under set v5 (+ the negation reading) as under set v4 (T44's
  // any-hit reading) except exactly the named cells; a new gate record that flips another turns this case RED until the
  // cell is READ BY HAND against the truth (four x-columns: 16 · 334 · 1516 · 1744) and, only when its layout is wrong,
  // named below with why — never from the verdict alone.
  test("THE FS-1 CENSUS: every FS-1 cell of the runner records reads under set v5 (+ the negation reading) as under set v4 (T44's any-hit) but for exactly the named cells — each a wrong layout read by hand; no cell turns GREEN", () => {
    const files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/^(fs|fs1|fsclass|figq)-.*\.json$/.test(e.name)) files.push(p); } })(B());
    const v4 = { ...FQ01, mustNotMatch: FQ01.mustNotMatch.slice(0, 12) };
    const flips = [];
    let n = 0;
    for (const f of files.sort()) {
      const r = json(f);
      if (!Array.isArray(r.turns)) continue;
      for (const t of r.turns) {
        if (t.id !== "FQ01" || typeof t.answer !== "string") continue;
        n++;
        const name = `${path.relative(B(), f)} ${t.scope || "corpus"}${Number(r.repeat) > 1 && Number.isInteger(t.repeat) ? ` r${t.repeat}` : ""}`;
        const before = evaluateCheck(v4, t.answer, { negationRule: false }).pass, now = evaluateCheck(FQ01, t.answer).pass;
        if (before !== now) { flips.push(name); assert.ok(before && !now, `${name}: F-211 never turns a RED cell GREEN on record`); }
      }
    }
    // Each read by hand (session 67): T48's production gate, the setting off, corpus r2 — "The pattern is essentially a 2 × 3
    // grid (two rows at y = 50 and y = 390, spanning x = 334 to x = 1 516) plus two mid-depth points"; T53's setting-on leg,
    // document r4 — "six points in a 2-2-2 arrangement (two mid-height edge points A & F, plus two pairs B/C and D/E …)".
    assert.deepStrictEqual(flips, ["t48-artifacts/records/after/fs-1790497746.json corpus r2", "t53-artifacts/records/after/fs1-on-1790584882.json document r4"]);
    assert.ok(n >= 90, `${n} FS-1 cells of the runner records`);
  });
});

describe("U-FIGCHECK 14: F-220 + F-221 — the owner's D1 (a) / D2 (a) (2026-09-29, the judge's harness PR after T57): a doubt word in a clause that denies doubt is not a hedge; a negation reaches its own doubt word", () => {
  const FQ11 = q("FQ11").check, FQ01 = q("FQ01").check;
  const { negatedScoped, clauseDenial } = require(B("workshop-artifacts", "ab", "figure_checks.js"));
  const { fs2Cells } = require(B("frontier-artifacts", "fs2_census.js"));
  /** F-220's and F-221's rules off: the judge of sessions 67–71. */
  const PRE_F220 = { clauseDenialRule: false, cueScopeRule: false };
  const FACTS = "The Denby: 3 plots — 302, 304 and 313 [S1].";
  const hits = (v) => v.detail.mustNotMatch.map((h) => h.match);
  const disc = (v) => (v.detail.mustNotMatchDiscounted || []).map((d) => [d.match, d.reason]);
  const v = (s, opts) => evaluateCheck(FQ11, `${FACTS}\n\n${s}`, opts);
  const V10 = B("t57-artifacts", "records", "reingest", "fs-1790627657.json");
  const METHOD = "The counts were cross-checked against the conflict list to confirm no ambiguity for the three Denby plots.";

  test("F-220: production's FS-2 document cell after the v10 re-ingest reads GREEN — read by hand whole in session 71 (302, 304, 313 in a table, \"3 plots\", no hedge, 301 only as a range's end) — its method note's \"conflict\" discounted \"in a clause that denies doubt\"; the judge of sessions 67–71 read it RED on \"conflict\"; the v10 gate re-judged GREEN in all six cells, exit 0; the judge prints the reason", () => {
    const rec = json(V10);
    const a = rec.turns.find((t) => t.id === "FQ11" && t.scope === "document").answer;
    const now = evaluateCheck(FQ11, a), before = evaluateCheck(FQ11, a, PRE_F220);
    assert.deepStrictEqual({ pass: now.pass, matches: now.matches, counts: now.detail.counts, hits: hits(now) }, { pass: true, matches: 3, counts: [{ label: "Denby", value: 3, ok: true }], hits: [] });
    const d = now.detail.mustNotMatchDiscounted.filter((x) => x.reason === "in a clause that denies doubt");
    assert.deepStrictEqual(d.map((x) => [x.match, x.sentence, x.clause]), [["conflict", `${METHOD}*`, `${METHOD}*`]]);
    assert.deepStrictEqual({ pass: before.pass, hits: hits(before) }, { pass: false, hits: ["conflict"] }, "the judge of sessions 67–71: RED on the method note's word");
    const j = judgeRecord(rec, set);
    assert.deepStrictEqual(j.rows.map((r) => [r.fs, r.cells.corpus.verdict, r.cells.document.verdict]), [["FS-1", "GREEN", "GREEN"], ["FS-2", "GREEN", "GREEN"], ["FS-3", "GREEN", "GREEN"]]);
    assert.strictEqual(j.exit, 0);
    assert.match(j.rows.find((r) => r.fs === "FS-2").cells.document.reasons.join("; "), /no must-not-match hit; discounted \d+: .*"conflict" \(in a clause that denies doubt\) in "The counts were cross-checked against the conflict list/);
  });

  test("F-220 — the forms (constructed; measured in session 71): a doubt word in a clause that carries a denial reads GREEN (\"to confirm no ambiguity\", \"are unambiguous\", the denial at the clause's end, a one-digit count, the list in capitals); still counted — the denial in another clause (; , and with), a plot number, a word of doubt, a contrast or restriction, a hedge phrase; the residue and the right forms still RED, stated; the helper", () => {
    const green = [
      METHOD,
      "Checking the conflicts list confirms the three Denby plots are unambiguous.",
      "The Denby's plots were cross-checked against the conflict log to confirm there is no ambiguity.",
      "The conflict list was checked to confirm no ambiguity for the 3 Denby plots.",
      "Cross-referencing the CONFLICTS section confirmed the Denby's three plots are unambiguous.",
    ];
    for (const s of green) {
      const r = v(s);
      assert.deepStrictEqual({ pass: r.pass, hits: hits(r) }, { pass: true, hits: [] }, s);
      assert.ok(disc(r).some(([, reason]) => reason === "in a clause that denies doubt"), s);
      assert.strictEqual(v(s, PRE_F220).pass, false, `${s}: RED under the judge of sessions 67–71`);
    }
    const counted = [
      ["One Denby plot is in the conflict list; there is no ambiguity for the others.", "conflict"], // the denial in another clause (;)
      ["Plot 313 is in the conflict list and there is no ambiguity about 302 or 304.", "conflict"], // a plot number
      ["The conflict list shows no ambiguity for two Denby plots but one remains disputed.", "conflict"], // a contrast, a word of doubt
      ["The conflict list names one Denby plot and shows no ambiguity for the other two.", "conflict"], // the denial after "and"
      ["The Denby count cannot be confirmed without the conflict list, as no ambiguity check was made.", "conflict"], // the denial after ","
      ["The conflict list confirms no ambiguity for the Denby's first two plots only.", "conflict"], // a restriction
      ["The conflict list shows a Denby plot with no ambiguity about its neighbours.", "conflict"], // the denial after "with"
      ["The Denby plots could not be definitively assigned, with no ambiguity about the count.", "definitively assigned"], // a hedge phrase counts as written
    ];
    for (const [s, word] of counted) { const r = v(s); assert.strictEqual(r.pass, false, s); assert.deepStrictEqual(hits(r), [word], s); }
    // The residue, stated with the owner's choice — none on record: a hedge and a denial in ONE unbroken clause with no joining
    // word reads GREEN; a right answer that names the plots by number, or joins its denial with "and", still reads RED (the
    // judge errs toward RED — read by hand).
    assert.strictEqual(v("The conflict list names one Denby plot showing no ambiguity for its neighbours.").pass, true, "the residue");
    for (const s of ["Plots 302, 304 and 313 were cross-checked against the conflict list to confirm no ambiguity.", "The Denby's plots were checked against the conflict list and none is ambiguous."]) assert.strictEqual(v(s).pass, false, `still RED: ${s}`);
    // The helper: the clause's words when the clause carries a denial and the sentence is unguarded; null otherwise, and for a
    // hedge phrase (it counts as written).
    const m = (s, w) => new RegExp(w, "i").exec(s);
    assert.strictEqual(clauseDenial(METHOD, m(METHOD, "conflict")), METHOD);
    const CUT = "One Denby plot is in the conflict list; there is no ambiguity for the others.";
    assert.strictEqual(clauseDenial(CUT, m(CUT, "conflict")), null);
    const WITH = "The Denby's three plots appear in the conflict list, with no ambiguity.";
    assert.strictEqual(clauseDenial(WITH, m(WITH, "conflict")), null);
    const PHRASE = "The three Denby plots are definitively assigned with no ambiguity.";
    assert.strictEqual(clauseDenial(PHRASE, m(PHRASE, "definitively assigned")), null);
    for (const g of ["The counts may be checked against the conflict list to confirm no ambiguity.", "Plot 302 was cross-checked against the conflict list to confirm no ambiguity.", "Only the Denby was cross-checked against the conflict list to confirm no ambiguity."]) assert.strictEqual(clauseDenial(g, m(g, "conflict")), null, `guarded: ${g}`);
    assert.strictEqual(clauseDenial("The Denby [S1] was checked against the conflict list to confirm no ambiguity.", m("The Denby [S1] was checked against the conflict list to confirm no ambiguity.", "conflict")), "The Denby [S1] was checked against the conflict list to confirm no ambiguity.", "a citation's digits are no plot number");
  });

  test("F-221: a negation reaches its own doubt word — \"no ambiguity in the conflict list … may be a Denby\" and \"no ambiguity except where the conflict list flags a fourth plot\" read RED (the judge of sessions 67–71: GREEN, \"conflict\" discounted as negated); \"No ambiguity and no conflict affect the Denby's plots\" reads GREEN (before: RED, two cues cancelled); one cue reaches two LISTED doubt words; negated() and FQ01's negation reading unchanged; F-221 alone moves nothing on record", () => {
    for (const s of ["There is no ambiguity in the conflict list about whether a fourth plot may be a Denby.", "The Denby shows no ambiguity except where the conflict list flags a fourth plot."]) {
      assert.deepStrictEqual({ now: v(s).pass, hits: hits(v(s)), before: v(s, PRE_F220).pass, beforeDisc: disc(v(s, PRE_F220)) }, { now: false, hits: ["conflict"], before: true, beforeDisc: [["conflict", "negated"]] }, s);
    }
    const both = "No ambiguity and no conflict affect the Denby's plots.";
    assert.deepStrictEqual({ now: v(both).pass, disc: disc(v(both)), before: v(both, PRE_F220).pass, hits: hits(v(both, PRE_F220)) }, { now: true, disc: [["conflict", "negated"]], before: false, hits: ["conflict"] });
    for (const s of ["None of the Denby plots appear in the list of conflicting/ambiguous readings.", "There are no conflicting or ambiguous readings for the Denby."]) {
      const r = v(s);
      assert.strictEqual(r.pass, true, s);
      assert.deepStrictEqual(disc(r), [["conflict", "negated"], ["ambiguous", "negated"]], s);
    }
    // The helper beside negated() (unchanged): the cue reaches its own word, both words of a list, and reads un- / non- as before.
    const S = "There is no ambiguity in the conflict list";
    assert.deepStrictEqual([negated(S, S.indexOf("conflict")), negatedScoped(S, S.indexOf("conflict"))], [true, false]);
    const L = "no conflicting/ambiguous readings";
    assert.deepStrictEqual([negatedScoped(L, L.indexOf("conflict")), negatedScoped(L, L.indexOf("ambiguous"))], [true, true]);
    const T = "No ambiguity and no conflict";
    assert.deepStrictEqual([negated(T, T.indexOf("conflict")), negatedScoped(T, T.indexOf("conflict"))], [false, true]);
    assert.deepStrictEqual([negatedScoped("no conflicts here", 3), negatedScoped("No, the plots are ambiguous", 18), negatedScoped("is not unambiguous", 9), negatedScoped("the plots are unambiguous", 16), negatedScoped("without any conflict", 12)], [true, false, false, true, true]);
    // F-221 alone moves nothing on record (measured: 0 of 212); FQ01 (no subject) reads exactly as before under either flag.
    for (const c of fs2Cells()) assert.deepStrictEqual(evaluateCheck(FQ11, c.answer, { clauseDenialRule: false }), evaluateCheck(FQ11, c.answer, PRE_F220), `${c.name}: F-221 alone`);
    const files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/^(fs|fs1|fsclass|figq)-.*\.json$/.test(e.name)) files.push(p); } })(B());
    let n = 0;
    for (const f of files) { const r = json(f); if (!Array.isArray(r.turns)) continue; for (const t of r.turns) if (t.id === "FQ01" && typeof t.answer === "string") { n++; assert.deepStrictEqual(evaluateCheck(FQ01, t.answer), evaluateCheck(FQ01, t.answer, PRE_F220), `${path.relative(B(), f)}: FQ01 unchanged`); } }
    assert.ok(n >= 90, `${n} FS-1 cells`);
  });
});
