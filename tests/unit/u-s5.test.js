/**
 * U-S5 — compliant comments for the clearing batch (s5-design.md; the owner's D5 to D7 of 2026-10-09 and S5-D8 to S5-D11
 * of 2026-10-12): the program S3 ports, commented to the Code Documentation Standard with no line of code changed. The
 * comment step runs with thinking off and a tool's list of the units, with the instruction measured on 2026-10-12
 * (inputs/demo-design/evidence/session-90-s5-probe/, round 3: 5 of 5 on every check); the documentation check runs in the
 * app beside the bridge's existing COBOL check; the Assess step gets S4's regulator lookups; DOC-008 is on the card.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { loadScenarios, validateScenario, loadManifest } = require("../../src/lib/coding/scenarios");
const { requestInstruction } = require("../../src/lib/coding/persona");
const { stepStates, flowLayout } = require("../../src/lib/coding/steps");
const D = require("../../src/lib/coding/doc_check");
const REC = require("../../src/lib/coding/record");
const C = require("../../src/lib/coding/rule_chain");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const s5 = () => loadScenarios().find((s) => s.id === "s5");
const P = "nexus-payments/";
const PROGRAM = `${P}legacy/clearing-batch/CLEARING.cbl`;
const SEED = read(`public/demos/seed/${PROGRAM}`);
const COMMENTED = read("tests/fixtures/s5/CLEARING_commented.cbl");
const at = (n) => `2026-10-12T16:${String(n).padStart(2, "0")}:00.000Z`;
// The step's request and the instruction, as measured (session-90-s5-probe, round 3), restated.
const REQUEST =
  "Bring the clearing batch, nexus-payments/legacy/clearing-batch/CLEARING.cbl, up to the Code Documentation Standard for DOC-2026-14: the mandatory header, a purpose comment for each division, section and paragraph, the stale comments corrected to what the code does, and the commented-out code and the card number removed. Date the history entry 20 July 2026. Change no line of code.";
const INSTRUCTION =
  "This request changes the program's comments only. Explain the changes briefly in plain language, then give the program back whole in one fenced code block: open it with a line of three backticks and the word cobol, make its first line `*> File: <path>`, and close it with three backticks. Every line that is not a comment must stay exactly as it is, character for character and in the same columns: do not reformat, re-indent, re-wrap, reorder or renumber code, and do not add, remove or change any statement, clause, picture or literal. You may add, change or remove only comment lines: an asterisk in column 7, the comment's text in columns 8 to 72. Put each purpose comment on the lines directly above the division, section or paragraph it describes. A tool compares the program's code before and after, and the change is rejected if any line of code differs.";
const UNITS = [
  "UNITS (found by a tool in nexus-payments/legacy/clearing-batch/CLEARING.cbl: each needs a purpose comment, directly above or directly below its line)",
  "- line 9: IDENTIFICATION DIVISION (division)",
  "- line 12: ENVIRONMENT DIVISION (division)",
  "- line 13: INPUT-OUTPUT SECTION (section)",
  "- line 14: FILE-CONTROL (paragraph)",
  "- line 19: DATA DIVISION (division)",
  "- line 20: FILE SECTION (section)",
  "- line 33: WORKING-STORAGE SECTION (section)",
  "- line 90: PROCEDURE DIVISION (division)",
  "- line 91: MAIN-PARA (paragraph)",
  "- line 124: READ-REC (paragraph)",
  "- line 128: PROCESS-REC (paragraph)",
  "- line 151: WRITE-SCHEME (paragraph)",
].join("\n");

describe("U-S5: the definition (D5 to D7, S5-D8 to S5-D11)", () => {
  test("S5 resets and checks the program at Select, assesses with the lookups, comments with thinking off, and records", () => {
    const s = s5();
    assert.deepStrictEqual([s.ticket.id, s.language, s.select.reset, s.select.runTests], ["DOC-2026-14", "COBOL", true, true]);
    assert.deepStrictEqual(s.commands, { tests: "s3-legacy", select: null }, "the bridge's existing COBOL check: no change to the IDE (S5-D10 (a))");
    assert.deepStrictEqual(s.steps.map((x) => [x.id, x.action, x.mode, x.thinking, x.traceRegulators]), [
      ["assess", null, "explain", null, true],
      ["comment", null, "comments", "off", false],
      ["record", "record", null, null, false],
    ]);
    const comment = s.steps[1];
    assert.strictEqual(comment.prompt, REQUEST, "the measured request, word for word");
    assert.deepStrictEqual([comment.comments, comment.attach, comment.after], [{ source: PROGRAM, language: "cobol" }, [PROGRAM], ["run-tests"]]);
    assert.match(comment.repair.prompt, /fix the comments only[\s\S]*Change no line of code\./);
    assert.deepStrictEqual(s.open, [`${P}backlog/DOC-2026-14.md`, PROGRAM]);
    assert.ok(fs.existsSync(path.join(ROOT, "public/demos/seed/nexus-payments/backlog/DOC-2026-14.md")));
  });

  test("the card holds the new documents and the chains' regulators, and puts DOC-008 in front of the audience", () => {
    const card = s5().card;
    const docs = card.artefacts.documents.map((d) => d.source);
    assert.ok(docs.length <= 24);
    for (const need of [
      "Nexus_DOC_Code-Documentation-Standard_v1.md",
      "Nexus_LEG-POL-001_Intellectual-Property-and-Notices-Policy_v2.md",
      "Nexus_CLR-WIKI-021_Commenting-The-Clearing-Batch.md",
      "Nexus_TEC-POL-004_Technology-Lifecycle-and-Modernisation-Policy_v2.md",
      "FCA_SYSC_June2026.pdf",
      "FCA_PS21-3_OperationalResilience_March2021.pdf",
      "PCI-DSS-v4_0_1_June2024.pdf",
      "FCA_AI-Update_April2024.pdf",
    ]) {
      assert.ok(docs.includes(need), need);
    }
    assert.deepStrictEqual([card.highlight.rule, card.highlight.source], ["DOC-008", "Nexus_DOC_Code-Documentation-Standard_v1.md"]);
    const manifest = loadManifest();
    assert.ok(manifest.pillars.find((p) => p.id === "corporate").documents.includes("Nexus_LEG-POL-001_Intellectual-Property-and-Notices-Policy_v2.md"));
    assert.ok(manifest.pillars.find((p) => p.id === "sdlc").documents.includes("Nexus_DOC_Code-Documentation-Standard_v1.md"));
    assert.ok(manifest.pillars.find((p) => p.id === "team").documents.includes("Nexus_CLR-WIKI-021_Commenting-The-Clearing-Batch.md"));
  });

  test("the schema: a comments step names and attaches its COBOL program and runs the checks; thinking and traceRegulators belong to answered steps; a highlight's document is on the card", () => {
    const base = { id: "s9", title: "T", ticket: { id: "T-1", path: "nexus-payments/backlog/t.md" } };
    const ok = { id: "c", mode: "comments", prompt: "Comment it.", attach: [PROGRAM], comments: { source: PROGRAM }, after: ["run-tests"], thinking: "off" };
    assert.deepStrictEqual(validateScenario({ ...base, steps: [ok] }).steps[0].comments, { source: PROGRAM, language: "cobol" });
    assert.throws(() => validateScenario({ ...base, steps: [{ ...ok, comments: undefined }] }), /a comments step needs comments \{ source \}, a COBOL program/);
    // S6 (2026-10-13): a Python module is a comments step's program too; any other file is not.
    assert.deepStrictEqual(validateScenario({ ...base, steps: [{ ...ok, comments: { source: `${P}services/x.py` }, attach: [`${P}services/x.py`] }] }).steps[0].comments, { source: `${P}services/x.py`, language: "python" });
    assert.throws(() => validateScenario({ ...base, steps: [{ ...ok, comments: { source: `${P}services/x.txt` }, attach: [`${P}services/x.txt`] }] }), /a COBOL program or a Python module/);
    assert.throws(() => validateScenario({ ...base, steps: [{ ...ok, attach: [] }] }), /attaches its comments\.source/);
    assert.throws(() => validateScenario({ ...base, steps: [{ ...ok, after: [] }] }), /runs the checks after Apply/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "e", prompt: "p", comments: { source: PROGRAM } }] }), /comments belongs to a comments step/);
    assert.throws(() => validateScenario({ ...base, steps: [{ ...ok, thinking: "maybe" }] }), /thinking is "on" or "off"/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "r", action: "record", thinking: "off" }] }), /thinking is "on" or "off"/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "e", prompt: "p", traceRegulators: "yes" }] }), /traceRegulators is true or false/);
    const card = { artefacts: { documents: [] }, highlight: { rule: "DOC-008", text: "t", source: "Nexus_DOC_Code-Documentation-Standard_v1.md" } };
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "e", prompt: "p" }], card }), /card highlight: "Nexus_DOC_Code-Documentation-Standard_v1\.md" is not among the card's documents/);
  });
});

describe("U-S5: the step gate and the flow", () => {
  const SELECT = { kind: "select", scenario: "s5", at: at(0) };
  const RED_AT_SELECT = { kind: "test-run", scenario: "s5", command: "s3-legacy", ran: true, exitCode: 1, summary: "the documentation check failed (DOC-001, DOC-002, DOC-004, DOC-005)", at: at(1) };
  const ASSESS = { kind: "turn", scenario: "s5", step: "assess", success: true, turnId: "t1", at: at(2) };
  const COMMENT = { kind: "turn", scenario: "s5", step: "comment", success: true, turnId: "t2", fileOperations: [PROGRAM], at: at(3) };
  const APPLY = { kind: "apply", path: PROGRAM, ok: true, at: at(4) };
  const RUN = (n, exitCode) => ({ kind: "test-run", scenario: "s5", command: "s3-legacy", ran: true, exitCode, summary: exitCode === 0 ? "no line of code changed; …" : "the documentation check failed (DOC-002)", at: at(n) });

  test("assess, comment, apply, run the checks; a red check offers the repair and the failed record; green unlocks Record", () => {
    const s = s5();
    const next = (events) => stepStates(s, events).next;
    assert.deepStrictEqual([next([SELECT, RED_AT_SELECT]).action, next([SELECT, RED_AT_SELECT]).label], ["ask", "Ask NexCODE: Assess the comments"], "the red run at Select is the finding, not a step's");
    assert.deepStrictEqual([next([SELECT, ASSESS]).action, next([SELECT, ASSESS]).label], ["ask", "Ask NexCODE: Comment it"]);
    assert.strictEqual(next([SELECT, ASSESS, COMMENT]).action, "apply");
    const toRun = next([SELECT, ASSESS, COMMENT, APPLY]);
    assert.deepStrictEqual([toRun.action, toRun.label], ["run-tests", "Run the checks"]);
    const red = next([SELECT, ASSESS, COMMENT, APPLY, RUN(5, 1)]);
    assert.deepStrictEqual([red.action, red.label, red.alternative.action], ["repair", "Ask NexCODE to fix the comments", "record-failed"]);
    assert.match(red.detail, /^The checks failed: the documentation check failed \(DOC-002\)\./);
    assert.deepStrictEqual([next([SELECT, ASSESS, COMMENT, APPLY, RUN(5, 0)]).action, next([SELECT, ASSESS, COMMENT, APPLY, RUN(5, 0)]).label], ["record", "Record the change"]);
  });

  test("the flow: the assessment in the chat, the comments in the IDE, Apply, the checks, the record", () => {
    assert.deepStrictEqual(
      flowLayout(s5()).nodes.map((n) => [n.kind, n.label, n.sub]),
      [
        ["ticket", "DOC-2026-14", "opened, tests run once"],
        ["prompt", "1. Assess the comments", "explained in the chat"],
        ["prompt", "2. Comment it", "the comments shown in the IDE"],
        ["apply", "Apply", "the reviewed change"],
        ["tests", "Run the checks", "no line of code changed"],
        ["record", "3. Record the change", "from the run log"],
      ]
    );
  });
});

describe("U-S5: the documentation check (doc_check.js)", () => {
  test("the seed fails the standard with its code as it is; the measured answer passes every rule", () => {
    const seed = D.documentationCheck({ seed: SEED, current: SEED });
    assert.deepStrictEqual(seed.rules, { "DOC-008": true, "DOC-001": false, "DOC-002": false, "DOC-004": false, "DOC-005": false });
    assert.deepStrictEqual([seed.cardNumbers, seed.commentedOutCode, seed.units.commented, seed.units.total], [[7], [143], 1, 12]);
    assert.ok(seed.header.missing.includes("notice") && seed.header.missing.includes("aiAssisted"));
    assert.match(D.reportText(seed), /^Documentation check \(STD-DOC\): FAILED\.\n- DOC-001: the header lacks PROGRAM, PURPOSE/);
    assert.match(D.reportText(seed), /Its copyright line reads "COPYRIGHT \(C\) NEXUS PAYMENTS LTD 1998\. ALL RIGHTS RESERVED\."/);
    const good = D.documentationCheck({ seed: SEED, current: COMMENTED });
    assert.deepStrictEqual([good.passed, good.codeUnchanged, good.units.commented, good.notes.length], [true, true, 12, 0]);
    assert.match(D.reportText(good), /^Documentation check \(STD-DOC\): passed\. No line of code changed \(DOC-008\)/);
  });

  test("any change to a line of code fails DOC-008 and names the line; a floating comment, blank lines and trailing spaces do not", () => {
    const changed = D.documentationCheck({ seed: SEED, current: COMMENTED.replace("ADD 1 TO WS-READ", "ADD 2 TO WS-READ") });
    assert.deepStrictEqual([changed.passed, changed.codeUnchanged, changed.firstDifference.before.trim(), changed.firstDifference.after.trim()], [false, false, "ADD 1 TO WS-READ", "ADD 2 TO WS-READ"]);
    assert.match(changed.findings[0], /^DOC-008: a line of code changed\. The original line 129 is/);
    const spaced = D.documentationCheck({ seed: SEED, current: COMMENTED.replace("ADD 1 TO WS-READ", "ADD 1 TO WS-READ   *> one more record").replace(/\n/, "\n\n") });
    assert.strictEqual(spaced.codeUnchanged, true);
    const reflowed = D.documentationCheck({ seed: SEED, current: COMMENTED.replace("           ADD 1 TO WS-READ", "          ADD 1 TO WS-READ") });
    assert.strictEqual(reflowed.codeUnchanged, false, "a column shift is a change: fixed-format COBOL is column-sensitive");
  });

  test("the units, the card numbers and commented-out code are found by rule, not by name", () => {
    assert.strictEqual(D.unitsBlock(PROGRAM, SEED), UNITS, "the block the measurement used");
    assert.deepStrictEqual(D.cardNumbersIn("TESTED WITH CARD 4111111111111111 ON THE SIMULATOR"), ["4111111111111111"]);
    assert.deepStrictEqual(D.cardNumbersIn("4111 1111 1111 1111 and 1234567890123"), ["4111111111111111"], "the Luhn check, groups allowed");
    // S6-D10 (a) of 2026-10-13: the first digit is 2 to 6; sixteen zeros pass the Luhn check alone.
    assert.deepStrictEqual(D.cardNumbersIn("TEST WITH 0000 0000 0000 0000, NOT A CARD; NOR 7111111111111114"), [], "both pass the Luhn check alone");
    const lines = ["      *            COMPUTE WS-FEE = IN-AMOUNT * IN-FEE-RATE", "      * MAIN-PARA: OPENS THE FILES, READS THE HEADER, WRITES THE TOTALS.", "      * ADD EACH FEE TO THE SCHEME'S TOTALS."];
    const flagged = D.documentationCheck({ seed: SEED, current: COMMENTED.replace("       PROCEDURE DIVISION.", `${lines.join("\n")}\n       PROCEDURE DIVISION.`) });
    assert.strictEqual(flagged.commentedOutCode.length, 1, "the statement is code; the prose is not");
    const wide = D.documentationCheck({ seed: SEED, current: COMMENTED.replace("       PROCEDURE DIVISION.", `      * ${"X".repeat(70)}\n       PROCEDURE DIVISION.`) });
    assert.deepStrictEqual([wide.passed, wide.notes.length], [true, 1], "past column 72 is a note: the compiler ignores 73 to 80");
  });

  test("the team's template and the header check agree: a header built from CLR-WIKI-021's template has every field", () => {
    const page = read("public/demos/demo_files/team_knowledge/Nexus_CLR-WIKI-021_Commenting-The-Clearing-Batch.md");
    const template = page.match(/## The header[\s\S]*?```\n([\s\S]*?)```/)[1].replace(/\s+$/, "").split("\n");
    for (const l of template) assert.strictEqual(l.length, 72, `72 columns: ${l}`);
    const filled = template.map((l) => l.replace(/<[^>]*>/, (m) => "X".repeat(m.length)));
    const program = `${filled.join("\n")}\n${SEED.split("\n").slice(8).join("\n")}`;
    const r = D.documentationCheck({ seed: SEED, current: program });
    assert.deepStrictEqual(r.header.missing, []);
    assert.strictEqual(r.codeUnchanged, true);
  });
});

describe("U-S5: the turn, the route, the record and the panels", () => {
  const turn = codeOnly(read("src/lib/coding/turn.js"));
  const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));

  test("the comment step's instruction is the measured one; the step sets thinking off itself and the run log says so", () => {
    assert.strictEqual(requestInstruction({ mode: "comments" }), INSTRUCTION);
    assert.match(turn, /const thinkingRequested = step && \(step\.thinking === "on" \|\| step\.thinking === "off"\) \? step\.thinking : thinkingAsked;/);
    assert.match(turn, /thinking: \{ requested: thinkingRequested, setBy: thinkingSetBy, mode: thinkingMode, form, reasoningChars:/);
    assert.ok(turn.indexOf("const thinkingRequested = step &&") < turn.indexOf('send({ type: "start", turnId, thinking: thinkingRequested,'), "the step's setting is known before the turn starts");
  });

  test("a comments turn lists the program's units from the workspace, between the files and the instruction, and attaches no editor file", () => {
    assert.match(turn, /if \(mode === "comments" && step && step\.comments\) \{\s*const unitsStart = Date\.now\(\);\s*const src = readWorkspaceFile\(step\.comments\.source, FILE_MAX_CHARS\);/);
    assert.match(turn, /text: unitsBlock\(step\.comments\.source, src\.text\)/);
    assert.match(turn, /mode !== "comments" && activeFile/);
  });

  test("the route adds the documentation check to the program's own run: both must pass, the findings in the output, the result in the run log", () => {
    assert.match(route, /const commentsStep = scenario\.steps\.find\(\(st\) => st\.mode === "comments" && st\.comments\) \|\| null;/);
    // S6 (2026-10-13): a Python module's check runs in the IDE (pythonDocumentationOf); a COBOL program's here, as before.
    assert.match(route, /const documentation = ran && commentsStep \? \(python \? await pythonDocumentationOf\(scenario, commentsStep\) : documentationOf\(commentsStep\.comments\.source\)\) : null;/);
    assert.match(route, /const exitCode = !ran \? null : programExit !== 0 \? programExit : documentation && !documentation\.passed \? 1 : programExit;/);
    assert.match(route, /\{ role: "documentation", command: python \? "py-doc-check \(STD-DOC, the module's syntax tree\)" : "documentation check \(STD-DOC\)", ran: true, exitCode: documentation\.passed \? 0 : 1 \}/);
    assert.match(route, /documentation: compactDocumentation\(documentation\),/);
    assert.match(route, /const seed = seedRel \? readText\(path\.join\(SEED_SOURCE, seedRel\)\) : \{ text: null \};/, "the image's seed, never the workspace's own history");
  });

  test("the record keeps the check as verified by tool (schema 0.8, now 0.9); the summary says which check failed", () => {
    assert.strictEqual(REC.RECORD_SCHEMA, "nexcode.evidence/0.12");
    const pass = D.documentationCheck({ seed: SEED, current: COMMENTED });
    const fail = D.documentationCheck({ seed: SEED, current: SEED });
    assert.strictEqual(REC.summariseDocumentation("the COBOL's report matches expected_totals.txt", pass, true), "no line of code changed; the COBOL's report matches expected_totals.txt; the header complete and 12 of 12 units commented");
    assert.strictEqual(REC.summariseDocumentation("the COBOL's report matches expected_totals.txt", fail, true), "the documentation check failed (DOC-001, DOC-002, DOC-004, DOC-005)");
    assert.strictEqual(REC.summariseDocumentation("the COBOL's report differs from expected_totals.txt", pass, false), "the COBOL's report differs from expected_totals.txt", "the program's own failure comes first");
    const s = s5();
    const events = [
      { kind: "select", scenario: "s5", at: at(0) },
      { kind: "turn", scenario: "s5", step: "comment", mode: "comments", turnId: "t", at: at(1), prompt: REQUEST, model: "m", cited: [], unverified: [], fileOperations: [PROGRAM], success: true },
      { kind: "apply", path: PROGRAM, ok: true, at: at(2) },
      { kind: "test-run", scenario: "s5", command: "s3-legacy", ran: true, exitCode: 0, summary: "ok", steps: [{ role: "legacy", ran: true, exitCode: 0 }, { role: "documentation", ran: true, exitCode: 0 }], documentation: REC.compactDocumentation(pass), at: at(3) },
    ];
    const { json, markdown } = REC.buildEvidenceRecord({ scenario: s, events, recordId: "eeee5555", now: new Date(at(4)) });
    assert.deepStrictEqual([json.kind, json.verification.documentation.codeUnchanged, json.verification.documentation.programCheckPassed, json.verification.documentation.verifiedBy], ["change", true, true, "tool"]);
    assert.match(markdown, /- Documentation check \(STD-DOC\), verified by tool, in the run of \S+: no line of code changed \(DOC-008\)\./);
    assert.match(markdown, /Purpose comments \(DOC-002\): 12 of 12 units\./);
    assert.ok(!/No pre-merge checks ran in this demo/.test(markdown));
  });

  test("the report shows the check; the card shows the highlighted rule; the bar's note says checks", () => {
    assert.match(codeOnly(read("src/components/presenter/RecordReport.jsx")), /<h3 className=\{H\}>The documentation check \(DOC-008\)<\/h3>/);
    assert.match(codeOnly(read("src/components/presenter/DemoCard.jsx")), /\{card\.highlight && \(\s*<div className="rounded-2xl border border-brand-vivid\/40 bg-brand-vivid\/10 px-5 py-4" data-card-highlight=\{card\.highlight\.rule\}>/);
    assert.match(codeOnly(read("src/components/StepBar.jsx")), /r\.documentation\s*\? `🧪 Checks: \$\{r\.summary\}/);
  });
});

describe("U-S5: the content", () => {
  test("the three documents parse into rule paragraphs whose trace lines resolve, each DOC rule to a policy clause", () => {
    const P2 = require("../../src/lib/coding/pillars");
    const manifest = loadManifest();
    const layers = P2.resolvePillars(manifest, manifest.pillars.flatMap((p) => p.documents).map((source) => ({ source, sourceIds: ["x"], chunkCount: 1 })));
    const loaded = C.loadRegister(layers, { root: path.join(ROOT, "public/demos/demo_files") });
    const ids = (re) => [...loaded.register.keys()].filter((k) => re.test(k));
    assert.deepStrictEqual(ids(/^DOC-0/), ["DOC-001", "DOC-002", "DOC-003", "DOC-004", "DOC-005", "DOC-006", "DOC-007", "DOC-008"]);
    assert.deepStrictEqual(ids(/^LEG-POL-001/), ["LEG-POL-001 clause 4.1", "LEG-POL-001 clause 4.2", "LEG-POL-001 clause 4.3", "LEG-POL-001 clause 4.4", "LEG-POL-001 clause 5.1"]);
    assert.deepStrictEqual(ids(/^CLR-WIKI-021/), ["CLR-WIKI-021 C1", "CLR-WIKI-021 C2", "CLR-WIKI-021 C3", "CLR-WIKI-021 C4", "CLR-WIKI-021 C5", "CLR-WIKI-021 C6", "CLR-WIKI-021 C7"]);
    for (const id of ids(/^DOC-0/)) assert.ok(loaded.register.get(id).refs.some((r) => loaded.register.get(r) && loaded.register.get(r).layer === "corporate"), `${id} traces to a policy clause`);
    assert.deepStrictEqual(loaded.register.get("DOC-001").refs, ["TEC-POL-004 clause 4.6", "SEC-POL-001 clause 4.2", "LEG-POL-001 clause 4.2"]);
  });

  test("the header's labels are a rule note of their own (one passage at production's chunk size), the ones the check reads", () => {
    const page = read("public/demos/demo_files/team_knowledge/Nexus_CLR-WIKI-021_Commenting-The-Clearing-Batch.md");
    const c1 = page.match(/\*\*CLR-WIKI-021 C1: The header's fields\.\*\*[^\n]*\nTraces to:[^\n]*/)[0];
    assert.ok(c1.length <= 600, `C1 stays one passage: ${c1.length} characters`);
    const order = ["PROGRAM", "PURPOSE", "SERVICE", "OWNER", "CLASSIFICATION", "the copyright line", "the trade mark line", "HISTORY", "REQUIREMENTS", "AI-ASSISTED"];
    let at = 0;
    for (const label of order) {
      const i = c1.indexOf(label, at);
      assert.ok(i >= 0, `C1 names ${label} in order`);
      at = i + label.length;
    }
    assert.deepStrictEqual(D.HEADER_FIELDS.map((f) => f.label), ["PROGRAM", "PURPOSE", "SERVICE", "OWNER", "CLASSIFICATION", "the copyright notice naming Nexus Bank plc", "the trade mark line", "HISTORY", "REQUIREMENTS", "AI-ASSISTED"]);
  });

  test("the notice the policy sets is the one the template and the header check use", () => {
    const policy = read("public/demos/demo_files/corporate_policies/Nexus_LEG-POL-001_Intellectual-Property-and-Notices-Policy_v2.md");
    assert.match(policy, /the notice "Copyright \(c\) Nexus Bank plc <year first written>-<year of the latest change>\. All rights reserved\." and the line "Nexus and the Nexus logo are trade marks of Nexus Bank plc\."/);
    assert.match(policy, /Nexus Payments Ltd \(folded into the Bank on 1 April 2009\)/);
    const page = read("public/demos/demo_files/team_knowledge/Nexus_CLR-WIKI-021_Commenting-The-Clearing-Batch.md");
    assert.match(page, /\* COPYRIGHT \(C\) NEXUS BANK PLC 1998-2026\. ALL RIGHTS RESERVED\. {3}\*/);
    assert.match(page, /\* NEXUS AND THE NEXUS LOGO ARE TRADE MARKS OF NEXUS BANK PLC\. {4}\*/);
  });
});
