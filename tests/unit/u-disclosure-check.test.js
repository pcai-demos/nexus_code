/**
 * U-DISCLOSE — F-207's record-only disclosure check (ticket T53, t53-design.md §2–§3; the owner's D1–D8, 2026-09-28, all
 * as recommended; T51 D3 (a), D4 (a)).
 *
 * T51 froze v2 (`t51-artifacts/probes/disclosure_check_v2.js`, md5 861e6e89…) and measured it on 80 fresh answers read
 * by hand first; T53 puts it in the product as a GENERATED port (`src/lib/rag/disclosure_check.js`, written by
 * `t53-artifacts/port53.js` — D6 (a)) and records its flags in `answerPolicy.disclosureCheck` and one blue trace row,
 * shown to no one. The cases:
 *
 *   1. The port: the committed file is the generator's output byte for byte (`port53.js --check`); v2 is the frozen
 *      version; v2's code sits in the port once, byte for byte; T53's own code is ASCII; norm's digit-group class is
 *      U+0020 U+002C U+00A0 U+202F U+2009.
 *   2. The pre-roll acceptance reads OK (`t53-artifacts/coded53.js`): coded = measured flag for flag on the 551 recorded
 *      FS-1 answers — the port against the frozen v2, and through disclosureRecord fed the stored chunk text and the
 *      composed block; the record null on the 131 negatives; the facts equal three ways; the counts = the design's before.
 *   3. The record's shape; one run per block, never merged; `inSection`; null without a NOT PRINTED edge (a real chain
 *      block with none, a chain whose edges are all reached, no block, junk); totality; the trace row's words.
 *   4. The wiring (source pins over comment-stripped code, the U-POLICY 5 way): the import; the blocks kept at the notes
 *      seam after the numbering; the check after the citation audit in its own try (stage "disclosure-check"), only
 *      with an answer and a block; one blue "Disclosure Check" row in the audit's category, only when a record exists;
 *      `disclosureCheck` inside answerPolicy (so every projection U-POLICY 5 pins carries it); T43's audit stage read
 *      by its title too, so the row never reads as the audit.
 *   5. Purity: the port's requires are context_notes, dimension_chain and answer_policy; no I/O, no clock.
 *   6. The harness (D7 (a)): the frontier judge prints each recorded turn's flags and the row's pooled rate and never
 *      gates on them; the dry-run compare prints Q3's record.
 * It reads only what the image ships (no .md, no .log — memory `unit-tests-run-on-the-deployed-image`).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const B = (...p) => path.join(REPO_ROOT, "tests", "eval", "baselines", ...p);
const PORT = require(B("t53-artifacts", "port53.js"));
const D = require("../../src/lib/rag/disclosure_check");
const V2 = require(PORT.V2_FILE);
const { summariseTiming } = require("../../src/lib/rag/timing");
const json = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const read = (...p) => codeOnly(fs.readFileSync(path.join(REPO_ROOT, ...p), "utf8"));
const run = (file, argv = []) => spawnSync(process.execPath, [file, ...argv], { encoding: "utf8", env: { ...process.env, RAG_EVAL_APP_ROOT: REPO_ROOT }, timeout: 120000 });
const MIDDLE_DOT = String.fromCharCode(0x00b7);
const ELLIPSIS = String.fromCharCode(0x2026);
const CHAIN_BLOCKS = json(B("t48-artifacts", "records", "chain-blocks-1790494587.json"));
const FIG15 = CHAIN_BLOCKS.pages.find((p) => p.file === "Fervi_Lathe_TechnicalSupportManual.pdf" && p.page === 25).block;
/** A short FS-1-shaped answer: a point placed on the unprinted edge (a side claim), the disclosure, and a section. */
const ANSWER = [
  "The six fastening points are A to F [S6].",
  "",
  "| Point | x (mm) | y (mm) | Where |",
  "|---|---|---|---|",
  "| F | 1744 | 220 | Right edge, mid-height |",
  "",
  "The distance from F to the right edge is not printed.",
  "",
  "### Beyond the documents",
  "This is my own judgement, not from the documents. The right-hand margin is likely about 76 mm.",
].join("\n");

describe("U-DISCLOSE 1: the port — generated from the frozen v2, byte for byte (D6 (a))", () => {
  test("port53.js --check: the committed port IS the generator's output byte for byte; v2 the frozen version", () => {
    const r = run(B("t53-artifacts", "port53.js"), ["--check"]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^CHECK OK — src\/lib\/rag\/disclosure_check\.js is the generator's output byte for byte \(md5 [0-9a-f]{32}, \d+ bytes\); v2 the frozen version \(md5 861e6e896a63db869514e56c822848bc\)$/m);
  });
  test("v2's code (its lines 72–402) sits in the port exactly once, byte for byte; only the header and the require lines changed", () => {
    const g = PORT.generate();
    const port = fs.readFileSync(PORT.PORT_FILE, "utf8");
    assert.strictEqual(g.port, port);
    assert.deepStrictEqual(g.lines.code, [72, 402]);
    assert.strictEqual(port.split(g.code).length, 2, "once");
    const v2 = fs.readFileSync(PORT.V2_FILE, "utf8");
    assert.ok(v2.includes(PORT.V2_REQUIRES) && !port.includes(PORT.V2_REQUIRES), "v2's tree-root requires are gone");
    assert.match(port, /\nconst \{ chainBlockNotes, POINT_ROW, POINTS_HEAD \} = require\("\.\/context_notes"\);\nconst \{ parseChain \} = require\("\.\.\/ingestion\/dimension_chain"\);\n\n\/\*\* The side word/);
    assert.ok(port.startsWith("/**\n * F-207's record-only disclosure check — ticket T53"), "the port's own header");
    assert.ok(port.includes(g.description) && g.description.startsWith(" * A pure function of (the finished answer, the turn's chain facts)."), "v2's description of its rules carried into the header");
  });
  test("every non-ASCII literal in the port's code is v2's; T53's own code is ASCII; norm's digit-group class carried", () => {
    const g = PORT.generate();
    const port = fs.readFileSync(PORT.PORT_FILE, "utf8");
    assert.deepStrictEqual(PORT.codePoints(PORT.codeOnly(port)).sort(), PORT.codePoints(PORT.codeOnly(g.code)).sort());
    assert.ok([...g.own].every((c) => c.codePointAt(0) < 128), "T53's own code is ASCII");
    assert.deepStrictEqual(PORT.normClass(port).map((c) => c.codePointAt(0)), [0x20, 0x2c, 0xa0, 0x202f, 0x2009]);
  });
  test("the generator refuses a v2 that is not the frozen version, and a template whose markers are missing or doubled", () => {
    const v2Buf = fs.readFileSync(PORT.V2_FILE);
    const template = fs.readFileSync(PORT.TEMPLATE_FILE, "utf8");
    assert.throws(() => PORT.generate({ v2Buf: Buffer.concat([v2Buf, Buffer.from(" ")]), template }), /not the frozen version/);
    assert.throws(() => PORT.generate({ v2Buf, template: template.replace(PORT.MARKERS.code, "") }), /@@V2_CODE@@ — not found/);
    assert.throws(() => PORT.generate({ v2Buf, template: template + PORT.MARKERS.code }), /@@V2_CODE@@ — found more than once/);
    assert.throws(() => PORT.generate({ v2Buf, template: template.replace("const RULES = \"t51-v2\";", "const RULES = \"t51-v2" + MIDDLE_DOT + "\";") }), /T53's own code is not ASCII/);
  });
});

describe("U-DISCLOSE 2: the pre-roll acceptance (t53-artifacts/coded53.js) reads OK — coded = measured on the 551, 0 on the 131", () => {
  test("coded53.js exits 0 with every acceptance line (t53-design.md §3 before the roll)", () => {
    const r = run(B("t53-artifacts", "coded53.js"));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /the committed port = the generator's output byte for byte: yes · v2's code \(its lines 72–402\) in the port 1 time\(s\)/);
    assert.match(r.stdout, /the product's facts = v2's: yes — NOT PRINTED \["the right edge"\]/);
    assert.match(r.stdout, /the stored block's facts on 14 \/ 14$/m);
    assert.match(r.stdout, /one noted block S6, NOT PRINTED = the facts' on 21 \/ 21$/m);
    assert.match(r.stdout, /^ {3}551 answers \(labelled 471: dev 308, holdout 142, production 21; fresh 80\)$/m);
    assert.match(r.stdout, /the product's disclosureCheck = v2's, flag for flag \(index, text, kinds, rules, labelled, edge\): 551 \/ 551$/m);
    assert.match(r.stdout, /disclosureRecord fed the stored chunk text \(the orchestrator's input\) = v2, every flag naming S6: 551 \/ 551$/m);
    assert.match(r.stdout, /disclosureRecord fed the composed context block of the answer's own turn = v2: 551 \/ 551$/m);
    assert.match(r.stdout, /inSection = seam53's reading on every flag: yes · units = v2's: yes · counts, rules and blocks: yes$/m);
    assert.match(r.stdout, /^ {3}131 answers \(chain blocks in their composed context: 0\) · a NOT PRINTED line in 0 · a record in 0 \(null on 131\) · v2's flags 0$/m);
    assert.match(r.stdout, /flags 443 \(side 299 \/ labelled 144\) · inside the section 15 · kinds \{"ON_EDGE":152,"EDGE_DISTANCE":222,"OUTLINE_EXTENT":77,"SYMMETRY":3\} · negatives 131 \(0 flags\) → EQUAL$/m);
    assert.match(r.stdout, /^OK — the port is v2 byte for byte;/m);
  });
});

describe("U-DISCLOSE 3: the record — its shape, one run per block, inSection, null without a NOT PRINTED edge, the trace row", () => {
  test("the record's shape: v2's flag fields + marker + inSection; the counts kept apart (T51 D3 (a)); the whole answer read (D4 (a))", () => {
    const rec = D.disclosureRecord({ answer: ANSWER, blocks: [{ marker: "S6", text: FIG15 }] });
    assert.deepStrictEqual(Object.keys(rec), ["rules", "blocks", "units", "flags", "sideClaims", "labelledDerivations"]);
    assert.strictEqual(rec.rules, "t51-v2");
    assert.deepStrictEqual(rec.blocks, [{ marker: "S6", notPrinted: ["the right edge"] }]);
    assert.strictEqual(rec.units, V2.unitsOf(ANSWER).length);
    assert.deepStrictEqual(rec.flags, [
      { index: 2, text: "| F | 1744 | 220 | Right edge, mid-height |", kinds: ["ON_EDGE"], rules: ["onEdge"], labelled: false, edge: "the right edge", marker: "S6", inSection: false },
      { index: 6, text: "The right-hand margin is likely about 76 mm.", kinds: ["EDGE_DISTANCE"], rules: ["sideMargin"], labelled: false, edge: "the right edge", marker: "S6", inSection: true },
    ]);
    assert.deepStrictEqual([rec.sideClaims, rec.labelledDerivations], [2, 0]);
    const v2 = V2.disclosureCheck(ANSWER, V2.chainFacts(FIG15)).flags;
    assert.deepStrictEqual(rec.flags.map(({ marker, inSection, ...f }) => f), v2, "the flags are v2's on the same text and facts");
  });
  test("a labelled derivation is counted apart from a side claim", () => {
    const answer = "The right-hand margin is 76 mm (derived: 1820 − 1744 = 76; the drawing does not print it).";
    const rec = D.disclosureRecord({ answer, blocks: [{ marker: "S6", text: FIG15 }] });
    assert.strictEqual(rec.flags.length, 1);
    assert.deepStrictEqual([rec.flags[0].labelled, rec.sideClaims, rec.labelledDerivations], [true, 0, 1]);
  });
  test("one run per block, each flag naming its block, never merged (D5 (a))", () => {
    const rec = D.disclosureRecord({ answer: ANSWER, blocks: [{ marker: "S6", text: FIG15 }, { marker: "S9", text: FIG15 }] });
    assert.deepStrictEqual(rec.blocks.map((b) => b.marker), ["S6", "S9"]);
    assert.deepStrictEqual(rec.flags.map((f) => `${f.marker}:${f.index}`), ["S6:2", "S6:6", "S9:2", "S9:6"]);
    assert.strictEqual(rec.units, V2.unitsOf(ANSWER).length, "the units are the answer's, once");
  });
  test("null when no block names a NOT PRINTED edge: no block, the corpus's other admitted chains, a chain whose edges are all reached", () => {
    assert.strictEqual(D.disclosureRecord({ answer: ANSWER, blocks: [] }), null);
    const others = CHAIN_BLOCKS.pages.filter((p) => p.block && p.block !== FIG15);
    assert.strictEqual(others.length, 5);
    for (const p of others) {
      assert.deepStrictEqual(D.chainFacts(p.block).notPrinted, [], `${p.file} p${p.page}`);
      assert.strictEqual(D.disclosureRecord({ answer: ANSWER, blocks: [{ marker: "S2", text: p.block }] }), null, `${p.file} p${p.page}`);
    }
    const reached = FIG15.replace("from A to F (horizontal): 1728", "from A to F (horizontal): 1728\nfrom F to right edge (horizontal): 76");
    assert.notStrictEqual(reached, FIG15);
    assert.deepStrictEqual(D.chainFacts(reached).notPrinted, []);
    assert.strictEqual(D.disclosureRecord({ answer: ANSWER, blocks: [{ marker: "S6", text: reached }] }), null);
    assert.strictEqual(D.disclosureRecord({ answer: ANSWER, blocks: [{ marker: "S6", text: "Plain prose, no chain." }] }), null);
  });
  test("total on junk: no argument, a non-string answer, junk blocks, a non-string marker", () => {
    assert.strictEqual(D.disclosureRecord(), null);
    assert.strictEqual(D.disclosureRecord({ answer: ANSWER, blocks: "S6" }), null);
    assert.strictEqual(D.disclosureRecord({ answer: ANSWER, blocks: [null, 7, { text: 5 }, { marker: "S1" }] }), null);
    const empty = D.disclosureRecord({ answer: 42, blocks: [{ marker: "S6", text: FIG15 }] });
    assert.deepStrictEqual([empty.units, empty.flags, empty.sideClaims, empty.labelledDerivations], [0, [], 0, 0]);
    assert.strictEqual(D.disclosureRecord({ answer: ANSWER, blocks: [{ marker: 6, text: FIG15 }] }).blocks[0].marker, null);
  });
  test("the trace row's words (D3 (a)): N FLAGS · RECORD ONLY or NO FLAG; the details the blocks, the counts and each flag clipped to 240", () => {
    const rec = D.disclosureRecord({ answer: ANSWER, blocks: [{ marker: "S6", text: FIG15 }] });
    const t = D.disclosureTrace(rec);
    assert.strictEqual(t.badge, `2 FLAGS ${MIDDLE_DOT} RECORD ONLY`);
    assert.strictEqual(t.description, 'v2 (T51, as frozen) read 7 unit(s) of the answer against what the drawing does not print ([S6] the right edge): 2 side claim(s), 0 labelled derivation(s), 1 inside "Beyond the documents". Recorded only; the chat shows nothing.');
    assert.deepStrictEqual(Object.keys(t.details), ["rules", "blocks", "units", "sideClaims", "labelledDerivations", "inSection", "flags"]);
    assert.deepStrictEqual(t.details.flags.map((f) => [f.index, f.marker, f.kinds, f.labelled, f.inSection]), [[2, "S6", ["ON_EDGE"], false, false], [6, "S6", ["EDGE_DISTANCE"], false, true]]);
    const one = { ...rec, flags: [{ ...rec.flags[0], text: "x".repeat(300) }] };
    assert.strictEqual(D.disclosureTrace(one).badge, `1 FLAG ${MIDDLE_DOT} RECORD ONLY`);
    assert.strictEqual(D.disclosureTrace(one).details.flags[0].text, "x".repeat(D.TRACE_TEXT_CHARS) + ELLIPSIS);
    assert.strictEqual(D.TRACE_TEXT_CHARS, 240);
    assert.strictEqual(D.disclosureTrace({ ...rec, flags: [] }).badge, "NO FLAG");
    assert.strictEqual(D.disclosureTrace(null).badge, "NO FLAG", "total on junk");
    assert.deepStrictEqual(D.disclosureTrace("junk").details.flags, []);
  });
});

describe("U-DISCLOSE 4: the wiring — the seam, the check after the audit in its own try, one blue row, answerPolicy.disclosureCheck", () => {
  const orch = read("src", "lib", "orchestrator.js");
  test("the orchestrator imports the port's two entry points", () => {
    assert.match(orch, /import \{ disclosureRecord, disclosureTrace \} from "@\/lib\/rag\/disclosure_check";/);
  });
  test("the noted blocks are kept at the notes seam AFTER the numbering (noteTextFor sets the marker), with their stored chunk text", () => {
    assert.match(orch, /let disclosureBlocks = \[\];/);
    const numbered = orch.indexOf("const numbered = buildNumberedContext({ specChunks, legendChunks, paginationFacts, textFor: noteTextFor })");
    const kept = orch.indexOf("disclosureBlocks = notes.chain.filter((n) => n.notPrinted.length > 0).map((n) => ({ marker: n.marker ?? null, text: noteSource[n.index].text }));");
    assert.ok(numbered > -1 && kept > numbered, "after the numbering");
    const notesIf = orch.lastIndexOf("if (notes) {", kept);
    assert.ok(notesIf > numbered && orch.indexOf("contextNotesReport = {", notesIf) < kept, "inside the notes report's block");
    assert.strictEqual((orch.match(/^\s*disclosureBlocks = /gm) || []).length, 1, "one assignment after the declaration");
  });
  test("the check runs after the citation audit, before answerPolicy, in its own try (stage disclosure-check) — only with an answer and a block", () => {
    const audit = orch.indexOf('stage: "citations"');
    const gate = orch.indexOf("if (success && disclosureBlocks.length > 0) {");
    const call = orch.indexOf("disclosureCheck = disclosureRecord({ answer: explanation, blocks: disclosureBlocks });");
    const stage = orch.indexOf('stage: "disclosure-check"');
    const policy = orch.indexOf("let answerPolicy = null;");
    assert.ok(audit > -1 && gate > audit && call > gate && stage > call && policy > stage, "audit → gate → the record → its catch → answerPolicy");
    assert.match(orch, /let disclosureCheck = null;\s*if \(success && disclosureBlocks\.length > 0\) \{\s*const checkStart = Date\.now\(\);\s*try \{\s*disclosureCheck = disclosureRecord\(/);
    assert.match(orch, /\} catch \(err\) \{\s*console\.error\("\[Orchestrate RAG Bookkeeping Error - disclosure check\]:", err\.message\);\s*bookkeepingError = bookkeepingError \|\| \{ code: CODES\.BOOKKEEPING_FAILED, stage: "disclosure-check", message: err\.message \};\s*disclosureCheck = null;\s*\}/);
    assert.strictEqual((orch.match(/disclosureRecord\(/g) || []).length, 1, "one call");
  });
  test("one blue trace row, 'Disclosure Check', in the audit's category, stamped from its own start — only when a record exists (D3 (a))", () => {
    const row = orch.slice(orch.indexOf("if (disclosureCheck) {"), orch.indexOf('stage: "disclosure-check"'));
    assert.match(row, /const row = disclosureTrace\(disclosureCheck\);\s*traces\.push\(\{/);
    assert.match(row, /category: "citation_audit",\s*title: "Disclosure Check",\s*description: row\.description,\s*icon: "RiFlagLine",\s*badge: row\.badge,\s*badgeType: "blue",\s*\.\.\.spanTiming\(clock, checkStart\),\s*details: row\.details,/);
    assert.ok(!/amber/.test(row), "never amber");
    assert.strictEqual((orch.match(/title: "Disclosure Check"/g) || []).length, 1, "one row");
  });
  test("answerPolicy carries disclosureCheck (D2 (a)) — the projections U-POLICY 5 pins carry it with no route or runner change", () => {
    assert.match(orch, /rules: agentMode === "doc" && contextMap\.length > 0 \? \(answerPolicyConfig\.beyondTheDocuments === "on" \? \[9, 10\] : \[9\]\) : \[\],\s*disclosureCheck,\s*\};/);
    for (const r of ["chat", "ide-bridge"]) assert.match(read("src", "app", "api", r, "route.js"), /answerPolicy: result\.answerPolicy \?\? null,/, r);
    assert.strictEqual((read("src", "app", "page.js").match(/answerPolicy: data\.answerPolicy \|\| null,/g) || []).length, 4);
    assert.ok(!/disclosureCheck/.test(read("src", "components", "ChatPanel.jsx")), "the chat shows nothing (T51 D4 (a))");
  });
  test("T43's audit stage is the Citation Audit span by its title too: a Disclosure Check row alone never reads as the audit", () => {
    assert.match(read("src", "lib", "rag", "timing.js"), /audit: \{ category: "citation_audit", title: "Citation Audit" \},/);
    const clock = { startMs: 1000, startedAt: new Date(1000).toISOString() };
    const check = { category: "citation_audit", title: "Disclosure Check", offsetMs: 90, durationMs: 1 };
    const audit = { category: "citation_audit", title: "Citation Audit", offsetMs: 80, durationMs: 4 };
    assert.strictEqual(summariseTiming({ clock, wallMs: 100, traces: [check] }).stages.audit, null, "the audit threw: no audit stage");
    assert.deepStrictEqual(summariseTiming({ clock, wallMs: 100, traces: [check, audit] }).stages.audit, { offsetMs: 80, durationMs: 4 });
  });
});

describe("U-DISCLOSE 5: purity", () => {
  test("the port's requires are context_notes, dimension_chain and answer_policy; no fs, no fetch, no clock, no environment", () => {
    const src = read("src", "lib", "rag", "disclosure_check.js");
    assert.deepStrictEqual(src.match(/require\([^)]*\)/g), ['require("./context_notes")', 'require("../ingestion/dimension_chain")', 'require("./answer_policy")']);
    assert.ok(!/\bfetch\(|Date\.now|new Date|process\.|readFileSync|Math\.random/.test(src));
  });
});

describe("U-DISCLOSE 6: the harness prints the record and never gates on it (D7 (a))", () => {
  const set = json(B("workshop-artifacts", "figure_questions.json"));
  const { judgeRecord } = require(B("frontier-artifacts", "frontier_gate.js"));
  const { disclosureOf } = require(B("t37-artifacts", "d4", "compare_dryrun.js"));
  /** T48's after gate (the setting off) with the record T53 would write on each FS-1 turn, null on the others. */
  const gate = json(B("t48-artifacts", "records", "after", "fs-1790497746.json"));
  const withRecord = { ...gate, turns: gate.turns.map((t) => ({ ...t, answerPolicy: { ...(t.answerPolicy || {}), disclosureCheck: t.id === "FQ01" ? D.disclosureRecord({ answer: t.answer, blocks: [{ marker: "S6", text: FIG15 }] }) : null } })) };
  test("the judge's verdicts, red count and exit are the same with and without the record — it never gates", () => {
    const a = judgeRecord(gate, set), b = judgeRecord(withRecord, set);
    assert.deepStrictEqual([b.judged, b.red, b.exit], [a.judged, a.red, a.exit]);
    assert.deepStrictEqual(b.rows.map((r) => [r.fs, r.cells.corpus.verdict, r.cells.document.verdict]), a.rows.map((r) => [r.fs, r.cells.corpus.verdict, r.cells.document.verdict]));
    assert.ok(a.rows.every((r) => !r.disclosure), "a record before T53 carries no disclosure summary");
  });
  test("each FS-1 turn's counts and the row's pooled rate; FS-2 / FS-3 (null records) carry none", () => {
    const j = judgeRecord(withRecord, set);
    const fs1 = j.rows.find((r) => r.fs === "FS-1");
    const turns = withRecord.turns.filter((t) => t.id === "FQ01");
    const recs = turns.map((t) => t.answerPolicy.disclosureCheck);
    assert.deepStrictEqual(fs1.disclosure, {
      answers: turns.length,
      flagged: recs.filter((r) => r.flags.length > 0).length,
      flags: recs.reduce((a, r) => a + r.flags.length, 0),
      side: recs.reduce((a, r) => a + r.sideClaims, 0),
      labelled: recs.reduce((a, r) => a + r.labelledDerivations, 0),
      inSection: recs.reduce((a, r) => a + r.flags.filter((f) => f.inSection).length, 0),
    });
    assert.ok(fs1.disclosure.flags > 0, "T48's FS-1 answers carry flags (F-207's residue)");
    for (const fs of ["FS-2", "FS-3"]) assert.strictEqual(j.rows.find((r) => r.fs === fs).disclosure, undefined, fs);
    assert.strictEqual(disclosureOf({ answerPolicy: { disclosureCheck: null } }), null);
    assert.strictEqual(disclosureOf({}), null);
  });
  test("the printed lines: every recorded turn under its verdict, the pooled rate under the row; the exit unchanged", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u-disclose-"));
    try {
      const f = path.join(dir, "gate.json");
      fs.writeFileSync(f, JSON.stringify(withRecord));
      const r = run(B("frontier-artifacts", "frontier_gate.js"), [f]);
      const plain = run(B("frontier-artifacts", "frontier_gate.js"), [B("t48-artifacts", "records", "after", "fs-1790497746.json")]);
      assert.strictEqual(r.status, plain.status, "the exit is the judge's truth, never the record's");
      const d = judgeRecord(withRecord, set).rows.find((x) => x.fs === "FS-1").disclosure;
      assert.match(r.stdout, new RegExp(`^  FS-1 disclosure check \\(T53, record only — never gating\\): ${d.flagged} / ${d.answers} answers flagged · flags ${d.flags} \\(side ${d.side} / labelled ${d.labelled}\\)`, "m"));
      assert.strictEqual((r.stdout.match(/^ {11}disclosure check \(record only\): /gm) || []).length, d.answers, "one line per recorded turn");
      assert.ok(!/disclosure check/.test(plain.stdout), "a record before T53 prints exactly as before");
      assert.strictEqual(r.stdout.replace(/^.*disclosure check.*\n/gm, ""), plain.stdout, "every other line exactly as before");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test("both runners record the Disclosure Check row beside the verbatim answerPolicy — badge, colour, category, straight after the Citation Audit", () => {
    const dry = fs.readFileSync(B("dryrun-artifacts", "run_dry_run.js"), "utf8");
    const figq = fs.readFileSync(B("workshop-artifacts", "ab", "run_figure_questions.js"), "utf8");
    for (const [name, src] of [["run_dry_run.js", dry], ["run_figure_questions.js", figq]]) {
      assert.match(src, /const disclosureAt = (?:traces|traceList)\.findIndex\(\(t\) => t && t\.title === "Disclosure Check"\);/, name);
      assert.match(src, /badgeType: (?:traces|traceList)\[disclosureAt\]\.badgeType \?\? null, category: (?:traces|traceList)\[disclosureAt\]\.category \?\? null, afterAudit: disclosureAt > 0 && (?:traces|traceList)\[disclosureAt - 1\]\.title === "Citation Audit"/, name);
      assert.match(src, /answerPolicy: j \? j\.answerPolicy \?\? null : null,\s*\/\/ T53 \(D3 \(a\)\): the Disclosure Check trace row, projected \(null when absent\)\.\s*disclosureRow,/, name);
    }
  });
  test("the dry-run compare prints Q3's record — and null on the other eleven", () => {
    const before = B("t52-artifacts", "records", "after", "dryrun-1790578249.json");
    const dry = json(before);
    const after = { ...dry, turns: dry.turns.map((t) => ({ ...t, answerPolicy: { ...(t.answerPolicy || {}), disclosureCheck: t.n === 3 ? D.disclosureRecord({ answer: t.answer, blocks: [{ marker: "S6", text: FIG15 }] }) : null } })) };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u-disclose-"));
    try {
      const f = path.join(dir, "dry.json");
      fs.writeFileSync(f, JSON.stringify(after));
      const r = run(B("t37-artifacts", "d4", "compare_dryrun.js"), [before, f]);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stdout, /^=== the disclosure check \(T53, record only\): a record on Q3; null on 11; absent \(a record before T53\) on 0$/m);
      const line = r.stdout.split("\n").find((l) => l.startsWith('{"q":3,"disclosureCheck":'));
      assert.ok(line, "Q3's record printed");
      assert.deepStrictEqual(JSON.parse(line).disclosureCheck, disclosureOf(after.turns.find((t) => t.n === 3)));
      const plain = run(B("t37-artifacts", "d4", "compare_dryrun.js"), [before, before]);
      assert.match(plain.stdout, /^=== the disclosure check \(T53, record only\): a record on no turn; null on 0; absent \(a record before T53\) on 12$/m);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
