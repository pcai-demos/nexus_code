/**
 * U-S5M — S5 after its measurement on the shipped composition (inputs/demo-design/evidence/session-90-s5-measure/; the
 * owner's S5-D12 to S5-D15 of 2026-10-12): Comment it searches the team page's template, labels and facts and the
 * standard's unit rule (D12); it runs without the chat history (D13); a tool keeps the program's code lines and says
 * which it put back (D14); the team page's template opens the history with the batch's first entry (D15). Measured:
 * Comment it 0 of 5 as shipped; with D12 and D13, 9 of 10, no code slip; the restore kept 30 of 35 answers untouched and
 * put right all 5 slips. S5-D17 (a) of 2026-10-13: Assess follows STD-DOC's eight rules through the documents' trace
 * lines (S2's rule chains), as measured in session-90-s5-d16: all 8 gaps in 5 of 5.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { loadScenarios, validateScenario } = require("../../src/lib/coding/scenarios");
const D = require("../../src/lib/coding/doc_check");
const R = require("../../src/lib/coding/code_restore");
const REC = require("../../src/lib/coding/record");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const s5 = () => loadScenarios().find((s) => s.id === "s5");
const PROGRAM = "nexus-payments/legacy/clearing-batch/CLEARING.cbl";
const SEED = read(`public/demos/seed/${PROGRAM}`);
const COMMENTED = read("tests/fixtures/s5/CLEARING_commented.cbl");
const TEAM_PAGE = "Nexus_CLR-WIKI-021_Commenting-The-Clearing-Batch.md";
const at = (n) => `2026-10-12T22:${String(n).padStart(2, "0")}:00.000Z`;
const once = (text, from, to) => {
  assert.strictEqual(text.split(from).length, 2, `exactly one ${JSON.stringify(from)}`);
  return text.replace(from, to);
};

describe("U-S5M: what Comment it searches, and without the history (S5-D12, S5-D13)", () => {
  test("the comment step's team and standards topics are the measured ones, word for word", () => {
    const comment = s5().steps.find((x) => x.id === "comment");
    assert.deepStrictEqual(comment.layerTopics.team, [
      "the header's fields in order: PROGRAM, PURPOSE, SERVICE, OWNER, CLASSIFICATION, the copyright line and the trade mark line, HISTORY, REQUIREMENTS and AI-ASSISTED",
      "the facts for the header: who wrote CLEARING and when, the important business service, the owning squad, its classification and the requirement its fee calculation implements",
    ]);
    assert.deepStrictEqual(comment.layerTopics.sdlc, [
      "the mandatory header: name, purpose, service, owner, classification, notice, history and requirements",
      "a purpose comment for every division, section and paragraph",
      "money logic carries the requirement it implements; AI assistance is disclosed in the header",
    ]);
  });

  test("the comment step runs without the chat history; Assess keeps it; the setting belongs to answered steps", () => {
    const steps = s5().steps;
    assert.deepStrictEqual(steps.map((x) => [x.id, x.history]), [["assess", null], ["comment", "off"], ["record", null]]);
    const base = { id: "s9", title: "T", ticket: { id: "T-1", path: "nexus-payments/backlog/t.md" } };
    assert.strictEqual(validateScenario({ ...base, steps: [{ id: "e", prompt: "p", history: "on" }] }).steps[0].history, "on");
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "e", prompt: "p", history: "none" }] }), /history is "on" or "off"/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "r", action: "record", history: "off" }] }), /history is "on" or "off", on a step NexCODE answers/);
  });

  test("the turn replays no history when its step says so, and the trace and the run log say who decided", () => {
    const turn = codeOnly(read("src/lib/coding/turn.js"));
    assert.match(turn, /const historyOff = Boolean\(step && step\.history === "off"\);\s*const replay = historyOff \? \[\] : replayHistory\(history, \{ limit: HISTORY_MESSAGES \}\)/);
    assert.match(turn, /badge: historyOff \? "NO HISTORY" : `\$\{replay\.length\} MESSAGES`/);
    assert.match(turn, /history: \{ replayed: replay\.length, setBy: historyOff \? "step" : "default" \},\s*tokens:/);
  });
});

describe("U-S5M: the code kept by a tool (S5-D14)", () => {
  test("an answer whose code is the program's comes back untouched", () => {
    const r = R.restoreCode(SEED, COMMENTED);
    assert.deepStrictEqual([r.text === COMMENTED, r.restored, r.refused], [true, [], null]);
    const floating = once(COMMENTED, "COMPUTE WS-FEE ROUNDED = IN-AMOUNT * IN-FEE-RATE", "COMPUTE WS-FEE ROUNDED = IN-AMOUNT * IN-FEE-RATE *> PAY-012");
    assert.strictEqual(R.restoreCode(SEED, floating).text, floating, "a floating comment on a line of code is a comment: kept");
  });

  test("a changed token: the program's line takes its place, every comment kept (measured: RD-FEES became RD-GFEES)", () => {
    const slipped = once(COMMENTED, "MOVE WS-G-FEES TO RD-FEES", "MOVE WS-G-FEES TO RD-GFEES");
    assert.strictEqual(D.documentationCheck({ seed: SEED, current: slipped }).rules["DOC-008"], false);
    const r = R.restoreCode(SEED, slipped);
    assert.strictEqual(r.text, COMMENTED);
    assert.deepStrictEqual(r.restored.map((x) => [x.kind, x.originalLine, x.was.trim(), x.now.trim()]), [["changed", 115, "MOVE WS-G-FEES TO RD-GFEES", "MOVE WS-G-FEES TO RD-FEES"]]);
    assert.strictEqual(D.documentationCheck({ seed: SEED, current: r.text }).passed, true);
  });

  test("a lost paragraph line goes back below the comment written for it (measured twice: FILE-CONTROL)", () => {
    const lost = once(COMMENTED, "\n       FILE-CONTROL.\n", "\n");
    const r = R.restoreCode(SEED, lost);
    assert.deepStrictEqual(r.restored.map((x) => [x.kind, x.originalLine]), [["lost", 14]]);
    assert.strictEqual(r.text, COMMENTED);
    const ls = r.text.split("\n");
    const i = ls.indexOf("       FILE-CONTROL.");
    assert.ok(D.isCommentLine(ls[i - 1]) || D.isCommentLine(ls[i + 1]), "its purpose comment is beside it");
    assert.strictEqual(D.documentationCheck({ seed: SEED, current: r.text }).passed, true);
  });

  test("a bare asterisk after a statement is code, so the statement comes back as the program has it (measured twice)", () => {
    const tagged = once(COMMENTED, "COMPUTE WS-FEE ROUNDED = IN-AMOUNT * IN-FEE-RATE", "COMPUTE WS-FEE ROUNDED = IN-AMOUNT * IN-FEE-RATE  * PAY-012");
    const r = R.restoreCode(SEED, tagged);
    assert.deepStrictEqual(r.restored.map((x) => [x.kind, x.originalLine]), [["changed", 144]]);
    assert.strictEqual(r.text, COMMENTED);
  });

  test("an added line of code is removed; an answer that is not a comments-only change is left for the check to judge", () => {
    const added = once(COMMENTED, "           MOVE WS-S-NET TO RD-NET\n", "           MOVE WS-S-NET TO RD-NET\n           DISPLAY RD-NET\n");
    const r = R.restoreCode(SEED, added);
    assert.deepStrictEqual(r.restored.map((x) => [x.kind, x.was.trim()]), [["added", "DISPLAY RD-NET"]]);
    assert.strictEqual(r.text, COMMENTED);
    const rewrite = COMMENTED.replace(/ MOVE /g, " MOVX ");
    const big = R.restoreCode(SEED, rewrite);
    assert.deepStrictEqual([big.text === rewrite, big.restored.length, big.refused.max], [true, 0, R.RESTORE_MAX_LINES]);
    assert.ok(big.refused.lines > R.RESTORE_MAX_LINES);
  });

  test("the chat's note names the lines in plain words", () => {
    const slipped = once(COMMENTED, "MOVE WS-G-FEES TO RD-FEES", "MOVE WS-G-FEES TO RD-GFEES");
    assert.strictEqual(
      R.restoredNote(R.restoreCode(SEED, slipped).restored, PROGRAM),
      "> 🛠️ A tool kept CLEARING.cbl's code as it was (DOC-008): it put back line 115 (NexCODE's copy changed it). The proposed change in the IDE changes comments only."
    );
    assert.strictEqual(R.restoredNote([], PROGRAM), "");
  });

  test("the turn keeps the code before the change is shown; Show the change shows the kept file; the trace says what was kept", () => {
    const turn = codeOnly(read("src/lib/coding/turn.js"));
    // S6 (2026-10-13): COBOL's code-keeping stays COBOL's; a Python module's code is compared by syntax tree in the IDE.
    assert.match(turn, /const given = mode === "comments" && step && step\.comments && step\.comments\.language !== "python" && op\.path === step\.comments\.source \? attached\.find\(\(x\) => x\.path === op\.path && !x\.error && !x\.cut\) : null;/);
    assert.match(turn, /const kept = restoreCode\(given\.text, op\.content\);/);
    assert.ok(turn.indexOf("const kept = restoreCode(") < turn.indexOf("const fileOperations = proposed.map("), "kept before the diff counts and the IDE");
    assert.match(turn, /title: "Code Kept",/);
    assert.match(turn, /response: shownExplanation,/);
    assert.match(turn, /codeKept,\s*success,/);
    const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
    assert.match(route, /const kept = turn\.codeKept && turn\.codeKept\.path === rel && typeof turn\.codeKept\.content === "string" \? turn\.codeKept\.content : null;/);
    assert.match(route, /content: kept \|\| op\.content,/);
  });

  test("the record (schema 0.9) keeps the lines a tool put back, for the change the check verified", () => {
    assert.strictEqual(REC.RECORD_SCHEMA, "nexcode.evidence/0.12");
    const slipped = once(COMMENTED, "MOVE WS-G-FEES TO RD-FEES", "MOVE WS-G-FEES TO RD-GFEES");
    const kept = R.restoreCode(SEED, slipped);
    const pass = D.documentationCheck({ seed: SEED, current: kept.text });
    const events = [
      { kind: "select", scenario: "s5", at: at(0) },
      { kind: "turn", scenario: "s5", step: "comment", mode: "comments", turnId: "t", at: at(1), prompt: "p", model: "m", cited: [], unverified: [], fileOperations: [PROGRAM], success: true, codeKept: { path: PROGRAM, restored: kept.restored, refused: null, content: kept.text } },
      { kind: "apply", path: PROGRAM, ok: true, at: at(2) },
      { kind: "test-run", scenario: "s5", command: "s3-legacy", ran: true, exitCode: 0, summary: "ok", steps: [{ role: "legacy", ran: true, exitCode: 0 }, { role: "documentation", ran: true, exitCode: 0 }], documentation: REC.compactDocumentation(pass), at: at(3) },
    ];
    const { json, markdown } = REC.buildEvidenceRecord({ scenario: s5(), events, recordId: "f0f05555", now: new Date(at(4)) });
    assert.deepStrictEqual(json.turns[0].codeKept.restored.map((x) => [x.kind, x.originalLine]), [["changed", 115]]);
    assert.ok(!("content" in json.turns[0].codeKept), "the lines, never the file");
    assert.deepStrictEqual(json.verification.documentation.restoredByTool.map((x) => x.originalLine), [115]);
    assert.match(markdown, /- Code kept by a tool: line 115 put back \(the answer had `MOVE WS-G-FEES TO RD-GFEES`\)/);
    assert.match(markdown, /- Code kept by a tool before the change was shown \(S5-D14 \(a\)\): line 115 put back/);
    assert.match(codeOnly(read("src/components/presenter/RecordReport.jsx")), /data-report-restored=\{record\.verification\.documentation\.restoredByTool\.length\}/);
  });
});

describe("U-S5M: the team page's template opens the history (S5-D15)", () => {
  test("the template's history starts with the batch's first entry, in the box, and both copies agree", () => {
    const page = read(`public/demos/demo_files/team_knowledge/${TEAM_PAGE}`);
    // The content pack lives under inputs/, which the image does not ship (.dockerignore): compared where it exists.
    const copy = path.join(ROOT, "inputs/demo-design/content/s5/team", TEAM_PAGE);
    if (fs.existsSync(copy)) assert.strictEqual(page, fs.readFileSync(copy, "utf8"), "the content pack's copy is the demo file");
    const template = page.match(/## The header[\s\S]*?```\n([\s\S]*?)```/)[1].replace(/\s+$/, "").split("\n");
    const i = template.findIndex((l) => /\* HISTORY:/.test(l));
    assert.strictEqual(template[i], "      * HISTORY:        1998-09-14 FIRST WRITTEN BY NEXUS PAYMENTS LTD *");
    assert.match(template[i + 1], /^ {6}\* {17}<YYYY-MM-DD> <CHANGE> <TICKET>, OLDEST FIRST {3}\*$/);
    for (const l of template) assert.strictEqual(l.length, 72, `72 columns: ${l}`);
    assert.match(page, /\| Version \| 2 \|\n\| Effective date \| 2026-07-17 \|/);
  });
});

describe("U-S5M: Assess follows STD-DOC's rules through the documents (S5-D17)", () => {
  const C = require("../../src/lib/coding/rule_chain");
  const P2 = require("../../src/lib/coding/pillars");
  const { loadManifest } = require("../../src/lib/coding/scenarios");
  const RULES = ["DOC-001", "DOC-002", "DOC-003", "DOC-004", "DOC-005", "DOC-006", "DOC-007", "DOC-008"];

  test("Assess names the standard's eight rules and keeps S4's lookups; of the other demos, only S6's build and audit trace rules", () => {
    const steps = s5().steps;
    assert.deepStrictEqual(steps.map((x) => [x.id, x.traceRules, x.traceRegulators]), [["assess", RULES, true], ["comment", [], false], ["record", [], false]]);
    // S6 (2026-10-13): the build traces the rules its code must meet, the audit STD-SVS's rules.
    const S6 = { build: ["SCS-021", "SCS-022", "SCS-030", "SCS-031", "PAY-012", "PAY-030", "TST-001"], audit: ["SVS-001", "SVS-010", "SVS-011", "SVS-012", "SVS-013", "SVS-014", "SVS-020"] };
    for (const s of loadScenarios().filter((x) => x.id !== "s5")) for (const st of s.steps) assert.deepStrictEqual(st.traceRules, (s.id === "s6" && S6[st.id]) || [], `${s.id} ${st.id}`);
  });

  test("the schema: 1 to 12 distinct rule IDs, on a step NexCODE answers", () => {
    const base = { id: "s9", title: "T", ticket: { id: "T-1", path: "nexus-payments/backlog/t.md" } };
    assert.deepStrictEqual(validateScenario({ ...base, steps: [{ id: "e", prompt: "p", traceRules: ["DOC-001", "SCS-010"] }] }).steps[0].traceRules, ["DOC-001", "SCS-010"]);
    for (const bad of [[], ["doc-001"], ["DOC-001", "DOC-001"], "DOC-001", Array.from({ length: 13 }, (_, i) => `DOC-${String(i + 1).padStart(3, "0")}`)]) {
      assert.throws(() => validateScenario({ ...base, steps: [{ id: "e", prompt: "p", traceRules: bad }] }), /traceRules names 1 to 12 distinct rule IDs/, JSON.stringify(bad));
    }
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "r", action: "record", traceRules: ["DOC-001"] }] }), /on a step NexCODE answers/);
  });

  test("over S5's card, the chains reach the 26 paragraphs the measurement traced (session-90-s5-d16), in its order", () => {
    const manifest = loadManifest();
    const docs = manifest.pillars.flatMap((p) => p.documents).map((source) => ({ source, sourceIds: ["x"], chunkCount: 1 }));
    const pillars = P2.scopePillars(P2.resolvePillars(manifest, docs), s5().card.artefacts.documents.map((d) => d.source));
    const loaded = C.loadRegister(pillars, { root: path.join(ROOT, "public/demos/demo_files") });
    const traced = C.traceChains(loaded.register, RULES.map((rule) => ({ rule, from: rule })));
    assert.deepStrictEqual(traced.items.map((i) => i.id), [
      "TEC-POL-004 clause 4.6", "SEC-POL-001 clause 4.2", "LEG-POL-001 clause 4.2", "SEC-POL-001 clause 4.3", "SEC-POL-001 clause 4.4", "TEC-POL-002 clause 4.8",
      "FIN-POL-003 clause 4.3", "TEC-POL-005 clause 4.4", "TEC-POL-005 clause 4.5", "TEC-POL-002 clause 4.5", "TEC-POL-004 clause 4.3",
      ...RULES,
      "CLR-WIKI-021 C1", "CLR-WIKI-021 C2", "CLR-WIKI-021 C3", "CLR-WIKI-021 C5", "CLR-WIKI-021 C4", "CLR-WIKI-021 C7", "CLR-WIKI-021 C6",
    ]);
    assert.deepStrictEqual([traced.missing, traced.capped, loaded.unreadable], [[], 0, []]);
  });

  test("the turn follows a step's rules as it follows a review's, before S4's lookups, and says whose rules they were", () => {
    const turn = codeOnly(read("src/lib/coding/turn.js"));
    assert.match(turn, /const stepRoots = step && Array\.isArray\(step\.traceRules\) \? step\.traceRules\.map\(\(rule\) => \(\{ rule, from: rule \}\)\) : \[\];/);
    assert.ok(turn.indexOf("if (chainRoots) {") < turn.indexOf('if (mode === "audit" || (step && step.traceRegulators)) {'), "the chains first, then the regulations they name");
    assert.match(turn, /rule\(s\) \$\{scan && stepRoots\.length \? "from the tool findings, the review and the step" : scan \? "from the tool findings and the review" : "named by the step"\} followed through/);
  });
});

describe("U-S5M: every demo's Select and reset reach the IDE's reset (S5-D20)", () => {
  // The extension's reset refused S5 ("unknown scenario: s5"): its fixed list predated the demo. It now checks the app's
  // own rule for a demo's id, and this test holds the two together, so a new demo cannot be refused again.
  const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));
  const rule = new RegExp(ext.match(/const SCENARIO_ID = \/(.+?)\/;/)[1]);

  test("the extension's rule is the app's rule for a demo's id, and its reset uses it", () => {
    const app = codeOnly(read("src/lib/coding/scenarios.js")).match(/if \(!\/(.+?)\/\.test\(id\)\) throw new Error\(`scenario: id/)[1];
    assert.strictEqual(rule.source, app);
    assert.match(ext, /if \(!SCENARIO_ID\.test\(scenario\)\) return \{ success: false, error: `unknown scenario: /);
    assert.ok(!/SCENARIO_IDS/.test(ext), "no fixed list of demos left in the extension");
  });

  test("every demo passes it (Select resets five of them; Reset this demo is offered on all)", () => {
    const ids = loadScenarios().map((s) => s.id);
    assert.ok(ids.includes("s4") && ids.includes("s5"));
    for (const id of ids) assert.ok(rule.test(id), id);
  });

  test("it still keeps the id to a name: no path, no empty id, no other shape", () => {
    for (const bad of ["", "s", "S5", "s123", "s5-", "s5/x", "../s5", "s5 ", "x5", "s5ab"]) assert.ok(!rule.test(bad), JSON.stringify(bad));
  });
});
