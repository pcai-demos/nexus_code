/**
 * U-S6 — a new component end to end (s6-design.md; the owner's S6-D1 to S6-D7 of 2026-10-13): dispute intake, built in
 * Python in the settlement service (D1 (a)), in five sections (D2 (a)): build it; comment it, checked by a tool that
 * reads the Python itself (D3 (a)); test and improve, recommended and made (D4 (a)); a security audit against the Bank's
 * standards and OWASP ASVS 5.0.0, added to the store (D5 (b)); record, then commit to the Bank's repository, a bare
 * repository in the pod (D6 (a)), with the evidence record beside the code as the report (D7 (a)).
 *
 * The Python check (code-server-ext/nexcode-bridge/py_doc_check.py) runs here on a real build from the feasibility probe
 * (inputs/demo-design/evidence/session-90-s6-probe/, round 2 run 2, whose tests passed) and on that module documented by
 * hand with no line of code changed (tests/fixtures/s6/). The Bank's repository is tested with real git in U-SEEDGIT.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadScenarios, validateScenario, loadManifest, loadRegulatorIndex, demoWrites } = require("../../src/lib/coding/scenarios");
const { requestInstruction } = require("../../src/lib/coding/persona");
const { stepStates, flowLayout } = require("../../src/lib/coding/steps");
const REC = require("../../src/lib/coding/record");
const PY = require("../../src/lib/coding/py_doc");
const R = require("../../src/lib/coding/regulator_refs");
const { reviewBlock, parseReviewFindings, mergeReview, findingsToFixBlock } = require("../../src/lib/coding/review");
const RC = require("../../src/lib/coding/rule_chain");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const s6 = () => loadScenarios().find((s) => s.id === "s6");
const P = "nexus-payments/";
const MODULE = `${P}services/settlement/dispute_intake.py`;
const TESTS = `${P}services/settlement/test_dispute_intake.py`;
const RECONCILER = `${P}services/settlement/settlement_reconciler.py`;
const FIXTURE = `${P}services/settlement/fixtures/settlement_fixture.sql`;
const BUILT = read("tests/fixtures/s6/dispute_intake_built.py");
const COMMENTED = read("tests/fixtures/s6/dispute_intake_commented.py");
const CHECK = path.join(ROOT, "code-server-ext", "nexcode-bridge", "py_doc_check.py");
const HAS_PYTHON = spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;
const at = (n) => `2026-10-13T15:${String(n).padStart(2, "0")}:00.000Z`;

/** py_doc_check.py on `text` (and `before` on its standard input): `{ exitCode, result }`. */
function pyCheck(text, before = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u-s6-"));
  const file = path.join(dir, "dispute_intake.py");
  fs.writeFileSync(file, text);
  const r = spawnSync("python3", ["-I", "-B", CHECK, "--path", file, ...(before !== null ? ["--before-stdin"] : [])], { encoding: "utf8", input: before !== null ? before : "" });
  const line = String(r.stdout || "")
    .split("\n")
    .find((l) => l.startsWith("NEXCODE-PY-DOC-CHECK "));
  return { exitCode: r.status, result: line ? JSON.parse(line.slice("NEXCODE-PY-DOC-CHECK ".length)) : null, stderr: r.stderr };
}

describe("U-S6: the definition (S6-D1 (a), S6-D2 (a))", () => {
  test("dispute intake in Python: build, comment, test and improve, audit, an optional fix, record, commit", () => {
    const s = s6();
    assert.strictEqual(s.language, "Python");
    assert.deepStrictEqual([s.ticket.id, s.ticket.path, s.minutes], ["DSP-2026-03", `${P}backlog/DSP-2026-03.md`, 10]);
    assert.deepStrictEqual(s.select, { reset: true, runTests: false, branch: "main" }, "nothing to reproduce at Select: there is nothing yet to test");
    assert.deepStrictEqual(s.commands, { tests: "s6-tests", select: null });
    assert.deepStrictEqual(
      s.steps.map((x) => [x.id, x.mode, x.action, x.optional]),
      [
        ["build", "change", null, false],
        ["comment", "comments", null, false],
        ["improve", "improve", null, false],
        ["audit", "review", null, false],
        ["fix", "change", null, true],
        ["record", null, "record", false],
        ["commit", null, "commit", false],
      ]
    );
    const [build, comment, improve, audit, fix] = s.steps;
    assert.deepStrictEqual(build.attach, [RECONCILER, `${P}services/settlement/test_settlement_reconciler.py`, FIXTURE], "as measured: the reconciler, its test and the fixture (round 2: 4 of 5 passed first time)");
    assert.match(build.prompt, /^Build dispute intake for ticket DSP-2026-03 in the settlement service, in Python 3\.13, the service's language\./);
    assert.deepStrictEqual(build.traceRules, ["SCS-021", "SCS-022", "SCS-030", "SCS-031", "PAY-012", "PAY-030", "TST-001"], "the rules the probe gave the model, now traced from the store");
    // session-90-s6-measure: with Select's chat replayed the build thought three times longer (~31,000 tokens, ~4.3 min, one
    // run cut at the limit); without it, ~12,000 and ~90 s.
    assert.strictEqual(build.history, "off");
    assert.deepStrictEqual([comment.comments, comment.attach, comment.thinking, comment.history, comment.after], [{ source: MODULE, language: "python" }, [MODULE], "off", "off", ["run-tests"]]);
    assert.match(comment.prompt, /Date the history entry 10 August 2026\. Change no line of code\.$/);
    assert.deepStrictEqual([improve.attach, improve.after, improve.history], [[MODULE, TESTS, FIXTURE], ["run-tests"], "off"]);
    assert.deepStrictEqual([audit.attach, audit.traceRegulators, audit.traceRules, audit.history], [[MODULE, TESTS], true, ["SVS-001", "SVS-010", "SVS-011", "SVS-012", "SVS-013", "SVS-014", "SVS-020"], "off"], "the audit reads the files and the rules, not the chat");
    assert.deepStrictEqual(s.review, { base: "main", branch: null, workspace: true, changed: [MODULE, TESTS] }, "the audit reads the demo's own new files, against main");
    assert.deepStrictEqual([fix.optional, fix.after, Boolean(fix.repair)], [true, ["run-tests"], true]);
    // session-90-s6-measure: on its prompt alone the fix's search found 2 passages; its topics find each layer's rules on
    // card data in tests (PCI DSS 6.5.5, SEC-POL-001 4.7, SCS-030, DOC-004) and the severity that blocks a merge.
    assert.deepStrictEqual(Object.keys(fix.layerTopics), ["regulator", "corporate", "sdlc", "team"]);
    assert.match(fix.layerTopics.regulator[0], /live PANs are not used in pre-production environments/);
    // S6-D9 (a) of 2026-10-13: the fix reads the audit's open blocking findings from its latest answer, with no chat replayed
    // (session-90-s6-measure: replaying the chat, 0 of 2 fixed and one copied the chat's lines; with the findings, 4 of 4).
    assert.deepStrictEqual([fix.fixes, fix.history], ["audit", "off"]);
    assert.deepStrictEqual(s.steps[6].commit, { branch: "feature/DSP-2026-03", paths: [MODULE, TESTS], author: { name: "Priya Nair", email: "priya.nair@nexus-bank.example" } });
    assert.deepStrictEqual(demoWrites(s), [MODULE, TESTS], "the files the demo writes itself, which its reset removes");
  });

  test("the card: the four layers' documents (OWASP ASVS among the regulator's), SVS-020 highlighted, Priya presenting", () => {
    const c = s6().card;
    const sources = c.artefacts.documents.map((d) => d.source);
    assert.strictEqual(sources.length, 22);
    for (const src of ["OWASP_ASVS-5.0.0_May2025.pdf", "PCI-DSS-v4_0_1_June2024.pdf", "Nexus_SVS_Security-Verification-Standard_v1.md", "Nexus_CLR-WIKI-024_Building-A-Settlement-Component.md", "Nexus_DOC_Code-Documentation-Standard_v1.md"]) assert.ok(sources.includes(src), src);
    assert.deepStrictEqual([c.highlight.rule, c.highlight.source], ["SVS-020", "Nexus_SVS_Security-Verification-Standard_v1.md"]);
    assert.ok(read("public/demos/demo_files/engineering_standards/Nexus_SVS_Security-Verification-Standard_v1.md").includes("**SVS-020 Evidence with the change.** The verification's results, by tool and by reviewer, MUST be kept with the change record"));
    assert.strictEqual(c.people[0].name, "Priya Nair");
    assert.ok(c.artefacts.code.every((a) => fs.existsSync(path.join(ROOT, "public/demos/seed", a.path))), "the card's code is in the seed");
  });

  test("the schema: a commit step follows a record, names a feature branch, its files and the engineer; an improve step runs the tests; a workspace review has no branch", () => {
    const base = { id: "s9", title: "T", ticket: { id: "T-1", path: `${P}backlog/t.md` } };
    const rec = { id: "r", action: "record" };
    const commit = { id: "c", action: "commit", commit: { branch: "feature/T-1", paths: [MODULE], author: { name: "Priya Nair", email: "priya.nair@nexus-bank.example" } } };
    assert.deepStrictEqual(validateScenario({ ...base, steps: [rec, commit] }).steps[1].commit, commit.commit);
    assert.throws(() => validateScenario({ ...base, steps: [commit, rec] }), /a commit step follows a record step/);
    assert.throws(() => validateScenario({ ...base, steps: [rec, { ...commit, commit: { ...commit.commit, branch: "main" } }] }), /feature branch/);
    assert.throws(() => validateScenario({ ...base, steps: [rec, { ...commit, commit: { ...commit.commit, branch: "feature/../main" } }] }), /feature branch/);
    assert.throws(() => validateScenario({ ...base, steps: [rec, { ...commit, commit: { ...commit.commit, paths: [] } }] }), /commit\.paths names 1 to 10/);
    assert.throws(() => validateScenario({ ...base, steps: [rec, { ...commit, commit: { ...commit.commit, paths: ["../x.py"] } }] }), /not a path under nexus-payments/);
    assert.throws(() => validateScenario({ ...base, steps: [rec, { ...commit, commit: { ...commit.commit, author: { name: "Priya Nair" } } }] }), /commit\.author/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "e", prompt: "p", commit: commit.commit }] }), /commit belongs to a commit step/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "i", prompt: "p", mode: "improve" }] }), /an improve step runs the tests after Apply/);
    assert.strictEqual(validateScenario({ ...base, steps: [{ id: "i", prompt: "p", mode: "improve", after: ["run-tests"], repair: { prompt: "fix" } }] }).steps[0].repair.prompt, "fix");
    const review = { base: "main", workspace: true, changed: [MODULE] };
    assert.deepStrictEqual(validateScenario({ ...base, review, steps: [{ id: "a", prompt: "p", mode: "review" }] }).review, { base: "main", branch: null, workspace: true, changed: [MODULE] });
    assert.throws(() => validateScenario({ ...base, review: { ...review, branch: "pr/x" }, steps: [{ id: "a", prompt: "p", mode: "review" }] }), /a workspace review reads the demo's own files on main/);
    // S6-D9 (a): a change step may name the earlier review step it fixes.
    const audit = { id: "a", prompt: "p", mode: "review" };
    const fixing = { id: "f", prompt: "p", mode: "change", fixes: "a" };
    assert.strictEqual(validateScenario({ ...base, review, steps: [audit, fixing] }).steps[1].fixes, "a");
    assert.strictEqual(validateScenario({ ...base, review, steps: [audit] }).steps[0].fixes, null);
    assert.throws(() => validateScenario({ ...base, review, steps: [fixing, audit] }), /fixes names an earlier review step/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "b", prompt: "p", mode: "change" }, { ...fixing, fixes: "b" }] }), /fixes names an earlier review step/);
    assert.throws(() => validateScenario({ ...base, review, steps: [audit, { ...fixing, mode: "explain" }] }), /fixes names an earlier review step, on a change step/);
  });

  test("the flow: the improvement and the commit are drawn; the commit is the presenter's", () => {
    const nodes = flowLayout(s6()).nodes.map((n) => [n.kind, n.sub]);
    assert.deepStrictEqual(nodes.slice(-2), [["record", "from the run log"], ["commit", "to the Bank's repository"]]);
    assert.ok(nodes.some(([k, sub]) => k === "prompt" && sub === "the improvement shown in the IDE"));
    assert.ok(nodes.some(([k, sub]) => k === "tests" && sub === "pass again, improved"));
  });
});

describe("U-S6: the instructions (S6-D3 (a), S6-D4 (a), S6-D5 (b))", () => {
  test("comments for Python: the module back whole, docstrings and comments only, compared by syntax tree", () => {
    const t = requestInstruction({ mode: "comments", language: "python" });
    assert.match(t, /give the module back whole in one fenced code block: open it with a line of three backticks and the word python, make its first line `# File: <path>`/);
    assert.match(t, /the module's header docstring as the first statement of the file, a docstring as the first statement of every class and function/);
    assert.match(t, /A tool compares the module's code before and after, with docstrings and comments set aside/);
    assert.notStrictEqual(t, requestInstruction({ mode: "comments" }), "COBOL's instruction is unchanged and separate");
  });

  test("improve: recommend with kind, reason and rule, then make them with a test for each new case, the documentation kept", () => {
    const t = requestInstruction({ mode: "improve" });
    assert.match(t, /The LATEST TEST RUN block shows the tests' last result\. First, in plain language, recommend the improvements, numbered, each with its kind \(correctness: a case the tests miss; performance; maintainability\), its reason and the rule behind it/);
    assert.match(t, /Add a test for each new case, with its expected value taken from the fixture or the ticket\./);
    assert.match(t, /adding a HISTORY entry for this change/);
  });

  test("the audit of new code: S2's findings contract, worded for new code; the review block says it reads the workspace", () => {
    const t = requestInstruction({ mode: "review", workspace: true });
    assert.match(t, /^This request is a security audit of new code before it is committed for review, not a change: do not write code or File blocks\./);
    assert.match(t, /each is verified by tool: keep its id, severity and rule, and never drop or re-grade it/);
    assert.match(t, /```findings, holding a JSON list of YOUR OWN findings only \(not the tool findings\)/);
    assert.match(requestInstruction({ mode: "review" }), /^This request is a review of a pull request/, "S2's is unchanged");
    const scan = { checks: [], findings: [] };
    assert.match(reviewBlock({ scan, files: [{ path: "services/settlement/dispute_intake.py", before: null, after: "x = 1\n" }], workspace: true }), /THE NEW CODE — the demo's files in the workspace against main \(a new file is every line added\), as a unified diff:/);
    assert.match(reviewBlock({ scan, files: [], base: "main", branch: "pr/PAY-2318" }), /THE PULL REQUEST'S CHANGES — pr\/PAY-2318 against main/);
  });

  test("the audit's findings keep an OWASP ASVS requirement in one form; a passage marker is not a rule", () => {
    // session-90-s6-instructions, round 1: the model wrote "OWASP ASVS 2.2.1" or "REG-2" beside SVS-010.
    const answer = `Text.\n\`\`\`findings\n${JSON.stringify([{ severity: "Medium", title: "reason_code not validated", path: MODULE, line: 3, rules: ["SVS-010", "OWASP ASVS 2.2.1", "REG-2", "ASVS 5.0.0 requirement 16.2.5", "asvs v1.2.4"] }])}\n\`\`\``;
    const out = parseReviewFindings(answer, { changed: [{ path: MODULE, lineCount: 10 }] });
    assert.deepStrictEqual(out.findings[0].rules, ["SVS-010", "ASVS 2.2.1", "ASVS 16.2.5", "ASVS 1.2.4"]);
  });

  test("the comments turn's prompt lists the module's classes and functions, never a name inside a docstring", () => {
    assert.strictEqual(
      PY.pythonUnitsBlock(MODULE, BUILT),
      [
        `UNITS (found by a tool in ${MODULE}: each class, function and method needs a docstring saying what it does and why)`,
        "- line 25: class DisputeIntakeError",
        "- line 30: class Dispute (a dataclass: its 8 field lines, 33 to 40, are code: keep them, below its docstring)",
        "- line 43: function mask_card_number",
        "- line 55: function _ensure_tables",
        "- line 89: function record_dispute (money logic: it builds or rounds a Decimal, which PAY-012 governs (monetary values: types and rounding); its docstring names that requirement)",
      ].join("\n")
    );
    // session-90-s6-measure: money logic is a Decimal built or rounded in the function's own code, never one a docstring,
    // a comment or a string only mentions.
    assert.deepStrictEqual(
      PY.pythonUnitsOf('def f(x):\n    """Decimal(x) in a docstring."""\n    # Decimal( in a comment\n    s = "Decimal(1)"\n    return x\n\ndef g(a):\n    return a.quantize(Decimal("0.01"))\n').map((u) => [u.name, Boolean(u.money)]),
      [["f", false], ["g", true]]
    );
    assert.deepStrictEqual(PY.pythonUnitsOf('class A:\n    """def x():"""\n    def m(self):\n        def inner():\n            pass\n'), [
      { line: 1, name: "A", kind: "class" },
      { line: 3, name: "A.m", kind: "method" },
      { line: 4, name: "A.m.inner", kind: "function" },
    ]);
  });
});

describe("U-S6: the Python documentation check (S6-D3 (a): the module's syntax tree, never imported)", () => {
  test("a real build has docstrings and the PAY-012 tag but no header and no AI disclosure; its documented copy passes with no line of code changed", (t) => {
    if (!HAS_PYTHON) return t.skip("python3 is not available here");
    const built = pyCheck(BUILT, BUILT);
    assert.strictEqual(built.exitCode, 1);
    assert.deepStrictEqual(built.result.rules, { "DOC-008": true, "DOC-001": false, "DOC-002": true, "DOC-004": true, "DOC-005": true, "DOC-006": true, "DOC-007": false });
    assert.deepStrictEqual([built.result.units, built.result.money], [{ total: 5, commented: 5, missing: [] }, { total: 1, tagged: 1, missing: [] }]);
    assert.match(built.result.findings[0], /^DOC-001: the header lacks MODULE, PURPOSE, SERVICE, OWNER, CLASSIFICATION, the copyright line naming Nexus Bank plc, the trade mark line, HISTORY, REQUIREMENTS, AI-ASSISTED\.$/);
    const commented = pyCheck(COMMENTED, BUILT);
    assert.strictEqual(commented.exitCode, 0, commented.stderr);
    assert.deepStrictEqual(commented.result.rules, { "DOC-008": true, "DOC-001": true, "DOC-002": true, "DOC-004": true, "DOC-005": true, "DOC-006": true, "DOC-007": true });
    assert.deepStrictEqual([commented.result.compared, commented.result.codeUnchanged, commented.result.findings], [true, true, []]);
    assert.deepStrictEqual([commented.result.aiDisclosure.present, commented.result.aiDisclosure.namesAssistant], [true, true]);
    assert.match(commented.result.aiDisclosure.text, /^Code, tests and comments written with NexCODE \(qwen3\.8:27b\), reviewed by Priya Nair$/);
    // session-90-s6-instructions, round 1: a value wrapped onto its next line still names the assistant.
    const wrapped = pyCheck(COMMENTED.replace("AI-ASSISTED:     Code, tests and comments written with NexCODE (qwen3.8:27b), reviewed by Priya Nair", "AI-ASSISTED:     Header and docstrings written with\n                 NexCODE (qwen3.8:27b), reviewed by Priya Nair"), BUILT);
    assert.deepStrictEqual([wrapped.result.rules["DOC-007"], wrapped.result.aiDisclosure.text], [true, "Header and docstrings written with NexCODE (qwen3.8:27b), reviewed by Priya Nair"]);
  });

  test("a changed line of code is named with its function and lines; commented-out code, a card number and a missing money tag are found", (t) => {
    if (!HAS_PYTHON) return t.skip("python3 is not available here");
    const changed = pyCheck(COMMENTED.replace("if amount <= 0:", "if amount < 0:"), BUILT);
    assert.strictEqual(changed.result.rules["DOC-008"], false);
    assert.deepStrictEqual(changed.result.firstDifference, { unit: "record_dispute", beforeLine: 118, before: "if amount <= 0:", afterLine: 137, after: "if amount < 0:" });
    assert.match(changed.result.findings[0], /^DOC-008: a line of code changed in record_dispute\. The module as given has "if amount <= 0:" at line 118; it now has "if amount < 0:" at line 137\.$/);
    const dead = pyCheck(COMMENTED.replace("    # --- Ensure tables exist ---", "    # --- Ensure tables exist ---\n    # conn.execute(\"DELETE FROM disputes\")"), BUILT);
    assert.deepStrictEqual([dead.result.rules["DOC-005"], dead.result.rules["DOC-008"], dead.result.commentedOutCode.length], [false, true, 1], "a comment is not code: DOC-008 still holds");
    const card = pyCheck(COMMENTED.replace('    """Return the last four digits', '    """Given 4111 1111 1111 1111, return the last four digits'), BUILT);
    assert.deepStrictEqual([card.result.rules["DOC-004"], card.result.cardNumbers.length], [false, 1]);
    // S6-D10 (a) of 2026-10-13: sixteen zeros, the obviously synthetic value DOC-004 recommends, pass the Luhn check but
    // are not a card number (a card's first digit is 2 to 6).
    const zeros = pyCheck(COMMENTED.replace('    """Return the last four digits', '    """Given 0000 0000 0000 0000, return the last four digits'), BUILT);
    assert.deepStrictEqual([zeros.result.rules["DOC-004"], zeros.result.cardNumbers.length], [true, 0]);
    const untagged = pyCheck(COMMENTED.replace("(PAY-012)", "(the decimal rule)").replace("    # --- Normalise amount to Decimal (PAY-012) ---", "    # --- Normalise amount to Decimal ---"), BUILT);
    assert.deepStrictEqual([untagged.result.rules["DOC-006"], untagged.result.money.missing], [false, ["record_dispute"]]);
    const noAi = pyCheck(COMMENTED.replace("AI-ASSISTED:     Code, tests and comments written with NexCODE (qwen3.8:27b), reviewed by Priya Nair", "AI-ASSISTED:     yes"));
    assert.deepStrictEqual([noAi.result.rules["DOC-007"], noAi.result.rules["DOC-001"], noAi.result.compared, "DOC-008" in noAi.result.rules], [false, true, false, false], "without --before-stdin the code is not compared");
  });

  test("a module that does not parse fails; a before that does not parse is not compared, and says so", (t) => {
    if (!HAS_PYTHON) return t.skip("python3 is not available here");
    const broken = pyCheck("def f(:\n    pass\n");
    assert.deepStrictEqual([broken.exitCode, broken.result.passed], [1, false]);
    assert.match(broken.result.findings[0], /^The module does not parse \(line 1: /);
    const notCompared = pyCheck(COMMENTED, "def f(:\n");
    assert.deepStrictEqual([notCompared.result.compared, notCompared.result.codeUnchanged, "DOC-008" in notCompared.result.rules], [false, null, false]);
    assert.match(notCompared.result.notes[0], /^Note: the module as it was given does not parse/);
  });

  test("the summary and the report say what the tool verified, and that a later change of code is not compared", () => {
    const ok = { language: "python", passed: true, compared: true, codeUnchanged: true, rules: { "DOC-008": true }, units: { total: 5, commented: 5 }, money: { total: 1, tagged: 1 }, findings: [], notes: [] };
    assert.strictEqual(PY.summarisePyDocumentation("7 passed", ok, true), "7 passed; documented to the standard, no line of code changed (5 of 5 units)");
    assert.strictEqual(PY.summarisePyDocumentation("1 of 7 failed", ok, false), "1 of 7 failed", "failing tests are the summary");
    assert.strictEqual(PY.summarisePyDocumentation("7 passed", { ...ok, passed: false, rules: { "DOC-008": false, "DOC-002": false }, codeUnchanged: false }, true), "7 passed; the documentation check failed (DOC-002, DOC-008): a line of code changed");
    assert.match(PY.pyReportText(ok), /^Documentation check \(STD-DOC\), by the module's syntax tree: passed\. No line of code changed \(DOC-008\);/);
    assert.match(PY.pyReportText({ ...ok, compared: false }), /Note: the code was not compared with an earlier version in this run: the module's latest change was a change of code, not a comments-only change\.$/);
    assert.strictEqual(PY.pyReportText({ error: "not checked: missing" }), "Documentation check (STD-DOC): could not run: not checked: missing");
  });
});

describe("U-S6: the step gate (S6-D4 (a), S6-D6 (a))", () => {
  const S = () => s6();
  const turn = (step, n, extra = {}) => ({ kind: "turn", scenario: "s6", step, turnId: `t-${step}-${n}`, success: true, at: at(n), ...extra });
  const apply = (p, n) => ({ kind: "apply", path: p, ok: true, at: at(n) });
  const run = (n, exitCode, summary) => ({ kind: "test-run", scenario: "s6", command: "s6-tests", ran: true, exitCode, summary, at: at(n) });
  const BOTH = [MODULE, TESTS];
  const through = (audit) => [
    { kind: "select", scenario: "s6", at: at(0) },
    turn("build", 1, { fileOperations: BOTH }),
    apply(MODULE, 2),
    apply(TESTS, 3),
    run(4, 0, "7 passed"),
    turn("comment", 5, { fileOperations: [MODULE] }),
    apply(MODULE, 6),
    run(7, 0, "7 passed; documented to the standard, no line of code changed (5 of 5 units)"),
    turn("improve", 8, { fileOperations: BOTH }),
    apply(MODULE, 9),
    apply(TESTS, 10),
    run(11, 0, "9 passed; documented to the standard (5 of 5 units)"),
    turn("audit", 12, { review: { outcome: audit, counts: { tool: 1, reviewer: 1 } } }),
  ];

  test("an audit that blocks the merge offers the fix, with the record beside it; once asked, the fix gates the record", () => {
    const blocked = stepStates(S(), through("Changes requested"));
    assert.deepStrictEqual(blocked.steps.slice(0, 4).map((x) => x.status), ["done", "done", "done", "done"]);
    assert.deepStrictEqual(blocked.steps[3].review, { outcome: "Changes requested", counts: { tool: 1, reviewer: 1 } });
    assert.deepStrictEqual([blocked.next.action, blocked.next.stepId, blocked.next.alternative && blocked.next.alternative.action], ["ask", "fix", "record"]);
    const asked = stepStates(S(), [...through("Changes requested"), turn("fix", 13, { fileOperations: [TESTS] })]);
    assert.deepStrictEqual([asked.next.action, asked.next.stepId], ["apply", "fix"], "an asked fix is followed through");
    assert.strictEqual(asked.steps.find((x) => x.id === "record").status, "locked", "an asked fix must finish before the record");
    const fixed = stepStates(S(), [...through("Changes requested"), turn("fix", 13, { fileOperations: [TESTS] }), apply(TESTS, 14), run(15, 0, "9 passed")]);
    assert.deepStrictEqual([fixed.steps.find((x) => x.id === "fix").status, fixed.next.action], ["done", "record"]);
  });

  test("an audit that does not block goes straight to the record; Commit unlocks after it and completes the demo", () => {
    const events = through("Approved with comments");
    assert.strictEqual(stepStates(S(), events).next.action, "record");
    const recorded = [...events, { kind: "record", scenario: "s6", recordId: "0a1b2c3d", paths: ["x.json", "x.md"], outcome: "ready", at: at(20) }];
    const r = stepStates(S(), recorded);
    assert.deepStrictEqual([r.next.action, r.next.label], ["commit", "Commit to the Bank repository"]);
    assert.match(r.next.detail, /on feature\/DSP-2026-03 as Priya Nair, labelled AI-assisted \(TEC-POL-005 clause 4\.4\), and pushes the branch to the Bank's repository in the pod for review \(REV-005\)\.$/);
    const failedCommit = stepStates(S(), [...recorded, { kind: "commit", scenario: "s6", success: false, at: at(21) }]);
    assert.strictEqual(failedCommit.next.action, "commit", "a failed commit completes nothing");
    const done = stepStates(S(), [...recorded, { kind: "commit", scenario: "s6", success: true, commit: "c".repeat(40), branch: "feature/DSP-2026-03", recordId: "0a1b2c3d", at: at(21) }]);
    assert.deepStrictEqual([done.complete, done.next.action, done.steps[6].commit.branch], [true, "results", "feature/DSP-2026-03"]);
    const stale = stepStates(S(), [...recorded, { kind: "commit", scenario: "s6", success: true, commit: "c".repeat(40), at: at(19) }]);
    assert.strictEqual(stale.next.action, "commit", "a commit before the record does not carry it");
  });

  test("a later step's answer takes its files over: its Apply leaves the build's passing run standing; any other Apply still makes a run stale", () => {
    const base = [{ kind: "select", scenario: "s6", at: at(0) }, turn("build", 1, { fileOperations: BOTH }), apply(MODULE, 2), apply(TESTS, 3), run(4, 0, "7 passed")];
    const later = stepStates(S(), [...base, turn("comment", 5, { fileOperations: [MODULE] }), apply(MODULE, 6)]);
    assert.deepStrictEqual([later.steps[0].status, later.steps[0].tests.at, later.next.stepId], ["done", at(4), "comment"], "the comment step's Apply is the comment step's");
    const stray = stepStates(S(), [...base, apply(`${P}backlog/DSP-2026-03.md`, 5)]);
    assert.deepStrictEqual([stray.steps[0].tests.state, stray.next.stepId], ["pending", "build"], "an Apply no later answer proposed still makes the run stale");
  });

  test("the comment step's checks say what the Python check verifies; the improve step's tests run again", () => {
    const ev = [{ kind: "select", scenario: "s6", at: at(0) }, turn("build", 1, { fileOperations: BOTH }), apply(MODULE, 2), apply(TESTS, 3), run(4, 0, "7 passed"), turn("comment", 5, { fileOperations: [MODULE] }), apply(MODULE, 6)];
    const n = stepStates(S(), ev).next;
    assert.deepStrictEqual([n.action, n.label], ["run-tests", "Run the checks"]);
    assert.match(n.detail, /the module's tests, then the documentation check: no line of code changed, the header complete, every function and class documented, money logic tagged\.$/);
    const red = stepStates(S(), [...ev, run(7, 1, "7 passed; the documentation check failed (DOC-001)")]).next;
    assert.deepStrictEqual([red.action, red.label], ["repair", "Ask NexCODE to fix the comments"]);
  });
});

describe("U-S6: the record and the commit (schema 0.10; S6-D4 (a), S6-D6 (a), S6-D7 (a))", () => {
  const scenario = () => s6();
  const doc = (compared) => ({ language: "python", tool: "py_doc_check (the module's syntax tree)", passed: true, compared, codeUnchanged: compared ? true : null, firstDifference: null, rules: {}, headerMissing: [], units: { total: 5, commented: 5, missing: [] }, money: { total: 1, tagged: 1, missing: [] }, aiDisclosure: { present: true, namesAssistant: true }, cardNumbers: [], commentedOutCode: [], findings: [], notes: [] });
  const events = [
    { kind: "select", scenario: "s6", at: at(0) },
    { kind: "turn", scenario: "s6", step: "comment", mode: "comments", turnId: "t-c", success: true, at: at(5), model: "qwen3.8:27b", fileOperations: [MODULE], cited: [], unverified: [] },
    { kind: "test-run", scenario: "s6", command: "s6-tests", exitCode: 0, summary: "7 passed; documented to the standard, no line of code changed (5 of 5 units)", documentation: doc(true), steps: [{ role: null, ran: true, exitCode: 0 }, { role: "documentation", ran: true, exitCode: 0 }], at: at(7) },
    { kind: "turn", scenario: "s6", step: "improve", mode: "improve", turnId: "t-i", success: true, at: at(8), model: "qwen3.8:27b", fileOperations: [MODULE, TESTS], cited: [], unverified: [], answer: "1. **Correctness:** a dispute for a REFUNDED payment is refused, and no test shows it (SVS-010).\n\n```python\n# File: x.py\nx = 1\n```" },
    { kind: "test-run", scenario: "s6", command: "s6-tests", exitCode: 0, summary: "9 passed; documented to the standard (5 of 5 units)", documentation: doc(false), steps: [{ role: null, ran: true, exitCode: 0 }, { role: "documentation", ran: true, exitCode: 0 }], at: at(11) },
  ];

  test("the record keeps the Python check, the comments-only proof from the earlier run, and the improvement before and after", () => {
    const { json, markdown } = REC.buildEvidenceRecord({ scenario: scenario(), events, recordId: "0a1b2c3d", now: new Date(at(30)) });
    assert.strictEqual(json.schema, "nexcode.evidence/0.12");
    assert.strictEqual(json.commit, null, "the committed copy cannot name its own commit");
    const d = json.verification.documentation;
    assert.deepStrictEqual([d.language, d.compared, d.at, d.codeUnchangedProof], ["python", false, at(11), { at: at(7), command: "s6-tests", codeUnchanged: true }]);
    const imp = json.verification.improvement;
    assert.deepStrictEqual([imp.turnId, imp.before.summary, imp.after.summary], ["t-i", "7 passed; documented to the standard, no line of code changed (5 of 5 units)", "9 passed; documented to the standard (5 of 5 units)"]);
    assert.match(imp.recommendations, /^1\. \*\*Correctness:\*\* a dispute for a REFUNDED payment is refused/);
    assert.ok(!imp.recommendations.includes("x = 1"), "the recommendations without the code");
    assert.match(markdown, /- The comments-only change \(DOC-008\), verified by tool in the run of 2026-10-13T15:07:00\.000Z: no line of code changed, the module's syntax tree compared with the module as NexCODE was given it/);
    assert.match(markdown, /- Test and improve \(S6-D4 \(a\)\): before NexCODE's recommendations, the tests gave 7 passed; documented to the standard, no line of code changed \(5 of 5 units\); after the improvements, 9 passed; documented to the standard \(5 of 5 units\)\./);
    assert.ok(!/## Commit/.test(markdown));
    const committed = REC.renderMarkdown({ ...json, commit: { at: at(40), branch: "feature/DSP-2026-03", commit: "0123456789abcdef0123456789abcdef01234567", author: "Priya Nair <priya.nair@nexus-bank.example>", repository: "the Bank's repository (remote bank, a bare repository in the pod)", files: [{ status: "added", path: "services/settlement/dispute_intake.py" }], note: "Added to the archive's copy after the commit." } });
    assert.match(committed, /## Commit\n\nCommitted 0123456789ab on feature\/DSP-2026-03 by Priya Nair <priya\.nair@nexus-bank\.example> at 2026-10-13T15:40:00\.000Z, and pushed to the Bank's repository \(remote bank, a bare repository in the pod\)\. Approval pending/);
    assert.ok(REC.compactDocumentation({ language: "python", error: "not checked" }).error, "a check that could not run is kept as such");
  });

  test("the commit message is built from the record: the ticket, the files, the AI-assisted label, the record's facts", () => {
    const record = { id: "0a1b2c3d", tests: [{ summary: "9 passed; documented to the standard (5 of 5 units)" }], review: { outcome: "Approved with comments", findings: [{ severity: "Medium", status: "open" }, { severity: "Critical", status: "fixed" }] } };
    const m = REC.commitMessage({ ticket: "DSP-2026-03", title: "Record card payment disputes in the settlement service", paths: ["services/settlement/dispute_intake.py", "services/settlement/test_dispute_intake.py", "compliance/records/2026-10-13-s6-0a1b2c3d.json", "compliance/records/2026-10-13-s6-0a1b2c3d.md"], record, models: ["qwen3.8:27b"] });
    assert.strictEqual(
      m,
      [
        "DSP-2026-03: Record card payment disputes in the settlement service",
        "",
        "The change: services/settlement/dispute_intake.py, services/settlement/test_dispute_intake.py.",
        "Its evidence record: compliance/records/2026-10-13-s6-0a1b2c3d.md, with its JSON, built by NexCODE from its run log.",
        "",
        "AI-assisted: written with NexCODE (qwen3.8:27b); the engineer reviewed and applied each change. A person reviews and approves it before it is merged (TEC-POL-005 clause 4.4, REV-005).",
        "",
        "Ticket: DSP-2026-03",
        "Evidence-record: 0a1b2c3d",
        "Tests: 9 passed; documented to the standard (5 of 5 units)",
        "Security-audit: Approved with comments (1 finding(s) open, none Critical or High)",
        "Approval: pending (REV-005)",
      ].join("\n")
    );
  });
});

describe("U-S6: the seams (the bridge, the route, the turn, the bar)", () => {
  const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));
  const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
  const turn = codeOnly(read("src/lib/coding/turn.js"));
  const bar = codeOnly(read("src/components/StepBar.jsx"));

  test("the bridge: the module's tests alone; the check read in this container's Python, with no shell; the Bank's repository outside the workspace", () => {
    assert.match(ext, /"s6-tests": \{ exec: \{ program: "python3", args: \["-m", "unittest", "discover", "-s", "services\/settlement", "-p", "test_dispute_intake\.py", "-v"\], cwd: SEED_REPO \}, showOutput: true \},/);
    assert.match(ext, /const r = await runProcess\("python3", \["-I", "-B", PY_DOC_CHECK, "--path", full, \.\.\.\(before !== null \? \["--before-stdin"\] : \[\]\)\], SEED_REPO, \{ timeoutMs: 30000, input: before \}\);/);
    assert.match(ext, /const BANK_REPO = path\.join\(path\.dirname\(WORKSPACE_PREFIX\), "\.nexus-bank", `\$\{SEED_REPO\}\.git`\);/);
    assert.match(ext, /const b = await seedgit\.buildBank\(\{ run: gitRun, bankDir: BANK_REPO, remote: BANK_REMOTE, seedEnv: SEED_GIT_ENV \}\);[\s\S]{0,120}bank = \{ ready: true/);
    assert.match(ext, /bank = \{ ready: false, error: err\.message \};/, "the Bank never fails the environment reset");
    assert.match(ext, /const r = await seedgit\.commitToBank\(\{ run: gitRun, repoDir: repo, bankDir: BANK_REPO, remote: BANK_REMOTE, branch: args\.branch, paths: rel, message: args\.message, author: args\.author, seedEnv: SEED_GIT_ENV \}\);/);
    assert.ok(fs.existsSync(CHECK), "the check ships beside the extension");
    assert.ok(!/exec\(|execSync|shell: true/.test(ext), "no shell anywhere");
  });

  test("the route: the check from the comments step on, compared while the comments turn's change is the latest; Commit refused before the record; the archive's copy names the commit", () => {
    assert.match(route, /if \(asked\.length === 0\) return null;/, "before the comments step, the tests alone");
    assert.match(route, /const base = appliedFrom && appliedFrom\.turnId === lastComments\.turnId && lastComments\.commentsBase && typeof lastComments\.commentsBase\.text === "string" \? lastComments\.commentsBase\.text : null;/);
    assert.match(route, /const r = await bridgeCommand\("py-doc-check", \{ path: source, \.\.\.\(base !== null \? \{ before: base \} : \{\}\) \}\);/);
    assert.match(route, /if \(!st \|\| !st\.unlocked \|\| !rec \|\| !rec\.recordId \|\| rec\.paths\.length === 0\) return \{ success: false, error: "Record the change first: the commit carries its evidence record", status: 409 \};/);
    assert.match(route, /const paths = \[\.\.\.step\.commit\.paths, \.\.\.rec\.paths\];/);
    assert.match(route, /const r = await bridgeCommand\("bank-commit", \{ branch: step\.commit\.branch, paths, message, author: step\.commit\.author \}\);/);
    assert.match(route, /const json = \{ \.\.\.archived\.json, commit: \{ \.\.\.committed, note: /);
    assert.match(route, /const own = demoWrites\(scenario\);/);
    assert.match(route, /if \(started\.success && scenario\.review && scenario\.review\.branch\) \{/, "no branch diff for a workspace review");
  });

  test("the turn: a Python comments turn keeps the module as given for the check; COBOL's code-keeping stays COBOL's; an improve turn reads the latest run", () => {
    assert.match(turn, /if \(python && !src\.error && !src\.cut\) commentsBase = \{ path: step\.comments\.source, sha256: src\.sha256, text: src\.text \};/);
    assert.match(turn, /\/\/ S6: the Python module as the comments turn was given it, for the IDE's check to compare the code by syntax tree\.\s*commentsBase,/.test(read("src/lib/coding/turn.js")) ? /commentsBase,/ : /never/);
    assert.match(turn, /step\.comments\.language !== "python" && op\.path === step\.comments\.source/);
    assert.match(turn, /const testBlock = repair \|\| mode === "improve" \? latestTestRunBlock\(scenario\) : "";/);
    // session-90-s6-instructions, round 1: 3 of 10 comments answers named a model that does not run here; the turn says which does.
    assert.match(turn, /\(mode === "comments" && step && step\.comments && step\.comments\.language === "python"\) \|\| mode === "improve"\s*\? `FACTS FOR THE AI DISCLOSURE \(from NexCODE itself, not from the documents\)\\n- The assistant: NexCODE\. The model answering this request: \$\{pair\.model \|\| "not configured"\}\.`/);
    assert.match(turn, /const instruction = requestInstruction\(\{ mode, repair, language: step && step\.comments \? step\.comments\.language : null, workspace: mode === "review" && workspaceReview \}\);/);
  });

  test("the turn (S6-D8, S6-D9 (a)): a fix lists its review's open blocking findings from the run log, before the instruction; the lookups put the step's own rules first", () => {
    assert.match(turn, /const turns = windowOf\(readRuns\(\{ limit: 5000 \}\), scenario\.id\)\.filter\(\(e\) => e\.kind === "turn" && e\.step === stepId && e\.success === true && e\.review && typeof e\.review === "object"\);/);
    assert.match(turn, /const fixContext = fixesStep \? findingsToFixBlock\(fixReview && fixReview\.review, \{ title: fixTitle \}\) : "";/);
    assert.match(turn, /unitsContext, disclosureContext, testBlock, fixContext, `INSTRUCTION FOR THIS REQUEST/);
    assert.match(turn, /fixes: fixesStep \? \{ step: fixesStep\.id, reviewTurnId: fixReview \? fixReview\.turnId : null, findings: fixFindings \} : null,/, "the run log keeps what the fix was given");
    assert.match(turn, /const lookups = chooseLookups\(named\.filter\(\(l\) => searched\.has\(l\.source\)\), \{ ownRules: step && Array\.isArray\(step\.traceRules\) \? step\.traceRules : \[\] \}\);/);
  });

  test("the bar: the commit step's button and the next action are the presenter's Commit", () => {
    assert.match(bar, /run\("Commit", \{ action: "commit", scenarioId: scenario\.id \}/);
    assert.match(bar, /else if \(a\.action === "commit"\) commitChange\(\);/);
    assert.match(bar, /\(a\.action === "commit" && \(!bridgeUp \|\| Boolean\(busy\) \|\| isAnalyzing\)\)/);
  });
});

describe("U-S6: the fix and the lookups, as measured (S6-D8, S6-D9 (a))", () => {
  test("the fix's block: the review's open Critical and High findings, each with its id, severity, rules, place and why", () => {
    const review = mergeReview({
      scan: { findings: [{ id: "T1", check: "card-numbers", rule: "SCS-021", title: "A card number in the code or in a log", severity: "Critical", path: "services/settlement/test_dispute_intake.py", line: 29, lines: [29], evidence: "a card number literal in the test data" }] },
      assessed: {
        findings: [
          { id: "A1", severity: "High", title: "The full card number in an error message", path: MODULE, line: 61, rules: ["SCS-021", "ASVS 16.5.1"], why: "the ValueError echoes the card number", established: "reviewer" },
          { id: "A2", severity: "Medium", title: "No limit on the reason's length", path: MODULE, line: 70, rules: ["ASVS 2.2.1"], why: "", established: "reviewer" },
        ],
        dropped: 0,
        error: null,
      },
      repoPrefix: P,
    });
    assert.strictEqual(review.outcome, "Changes requested");
    assert.strictEqual(
      findingsToFixBlock(review, { title: "the security audit" }),
      [
        "FINDINGS TO FIX (the security audit's open Critical and High findings, which block the merge under REV-003; T findings are verified by tool, A findings were assessed by the reviewer)",
        `- T1 · Critical · SCS-021 · ${TESTS}:29 · A card number in the code or in a log: a card number literal in the test data`,
        `- A1 · High · SCS-021, ASVS 16.5.1 · ${MODULE}:61 · The full card number in an error message: the ValueError echoes the card number`,
      ].join("\n"),
      "a Medium finding does not block the merge"
    );
    const t1Fixed = { ...review, findings: review.findings.map((f) => (f.id === "T1" ? { ...f, status: "fixed" } : f)) };
    assert.doesNotMatch(findingsToFixBlock(t1Fixed, { title: "the security audit" }), /^- T1/m, "a fixed finding is not listed");
    const clean = mergeReview({ scan: { findings: [] }, assessed: { findings: [], dropped: 0, error: null } });
    assert.match(findingsToFixBlock(clean, { title: "the security audit" }), /\nNone: the security audit's latest answer has no Critical or High finding open\.$/);
    assert.match(findingsToFixBlock(null, { title: "the security audit" }), /\nNone listed: the security audit has not answered since the demo was selected\.$/);
  });

  test("the lookups: the step's own rules' provisions first, every one, then six of the others; a step with no own provisions looks up as before", () => {
    // session-90-s6-measure: the 18 provisions S6's audit evidence named, in evidence order; SEC-POL-001's PCI DSS six
    // filled the cap, and the OWASP ASVS requirements STD-SVS's rules name came 14th to 18th.
    const order = ["pci:6.2.1", "pci:6.2.3", "pci:6.2.4", "pci:3.2.1", "pci:6.5.5", "pci:6.2.3.1", "pci:3.3.1", "pci:3.5.1", "fca-ai:p18", "fca-ai:p16", "pci:6.5.1", "sysc:4.1.1R", "pci:3.4.1", "asvs:14.2.6", "asvs:14.2.7", "asvs:16.2.1", "asvs:16.2.5", "asvs:16.5.1"];
    const own = { "pci:6.2.4": ["SEC-POL-001 clause 4.8", "TEC-POL-002 clause 4.5", "SVS-001"], "asvs:14.2.6": ["SVS-012"], "asvs:14.2.7": ["SVS-012"], "asvs:16.2.1": ["SVS-013"], "asvs:16.2.5": ["SVS-013"], "asvs:16.5.1": ["SVS-014"] };
    const named = order.map((key) => ({ key, tracedFrom: own[key] || ["SEC-POL-001 clause 4.7"] }));
    const audit = s6().steps.find((x) => x.id === "audit");
    assert.deepStrictEqual(R.chooseLookups(named, { ownRules: audit.traceRules }).map((l) => l.key), ["pci:6.2.4", "asvs:14.2.6", "asvs:14.2.7", "asvs:16.2.1", "asvs:16.2.5", "asvs:16.5.1", "pci:6.2.1", "pci:6.2.3", "pci:3.2.1", "pci:6.5.5", "pci:6.2.3.1", "pci:3.3.1"]);
    assert.deepStrictEqual(R.chooseLookups(named).map((l) => l.key), order.slice(0, 6), "no own rules: the first six, as before");
    // How many provisions a step's own rules can add: what their trace lines name, before the search finds any. A change
    // to the rules or the index that moves these counts is a decision, not a drift.
    const m = loadManifest();
    const idx = loadRegulatorIndex();
    const docs = [];
    for (const p of m.pillars.filter((x) => x.id !== "regulator")) {
      for (const source of p.documents) {
        const file = RC.findDocumentFile(path.join(ROOT, "public/demos/demo_files"), source);
        if (file && /\.md$/i.test(file)) docs.push({ layer: p.id, source, markdown: fs.readFileSync(file, "utf8") });
      }
    }
    const register = RC.buildRegister(docs);
    const ruleOf = (id) => (register instanceof Map ? register.get(id) : register[id]);
    const ownCounts = {};
    for (const sc of loadScenarios()) {
      const card = new Set(sc.card.artefacts.documents.map((d) => d.source));
      for (const st of sc.steps.filter((x) => (x.mode === "audit" || x.traceRegulators) && x.traceRules.length)) {
        const keys = new Set();
        for (const rule of st.traceRules) {
          const e = ruleOf(rule);
          assert.ok(e, `${sc.id} ${st.id}: ${rule} is in the documents`);
          for (const r of R.regulatorRefs(e.text)) if (idx.entries[r.key] && idx.entries[r.key].verified === true && card.has(idx.entries[r.key].source)) keys.add(r.key);
        }
        ownCounts[`${sc.id}:${st.id}`] = [...keys];
      }
    }
    assert.deepStrictEqual(ownCounts, {
      "s5:assess": [],
      "s6:audit": ["pci:6.2.4", "asvs:2.2.1", "asvs:1.2.4", "asvs:14.2.6", "asvs:14.2.7", "asvs:16.2.1", "asvs:16.2.5", "asvs:16.5.1"],
    });
  });
});

describe("U-S6: the content (S6-D5 (b))", () => {
  test("STD-SVS's trace lines name OWASP ASVS requirements the index locates, checked against the store after the ingest and looked up", () => {
    const idx = loadRegulatorIndex();
    const svs = read("public/demos/demo_files/engineering_standards/Nexus_SVS_Security-Verification-Standard_v1.md");
    const asvs = R.regulatorRefs(svs).filter((r) => r.key.startsWith("asvs:")).map((r) => r.key);
    assert.deepStrictEqual(asvs, ["asvs:2.2.1", "asvs:1.2.4", "asvs:14.2.6", "asvs:14.2.7", "asvs:16.2.1", "asvs:16.2.5", "asvs:16.5.1"]);
    for (const k of asvs) {
      const e = idx.entries[k];
      assert.ok(e, k);
      assert.deepStrictEqual([e.source, e.verified, e.storePage, e.label], ["OWASP_ASVS-5.0.0_May2025.pdf", true, e.page, `OWASP ASVS 5.0.0 requirement ${k.slice(5)}`]);
    }
    // Verified after the ingest (session-90-s6-measure): the lookups now follow STD-SVS's trace lines into the ASVS text.
    const looked = R.regulatorLookups([{ marker: "SDLC-1", pillar: "sdlc", source: "Nexus_SVS_Security-Verification-Standard_v1.md", text: svs }], idx, { max: 20 });
    assert.deepStrictEqual(looked.filter((l) => l.key.startsWith("asvs:")).map((l) => [l.key, l.tracedFrom]), [
      ["asvs:2.2.1", ["SVS-001"]],
      ["asvs:1.2.4", ["SVS-001"]],
      ["asvs:14.2.6", ["SVS-001"]],
      ["asvs:14.2.7", ["SVS-001"]],
      ["asvs:16.2.1", ["SVS-001"]],
      ["asvs:16.2.5", ["SVS-001"]],
      ["asvs:16.5.1", ["SVS-001"]],
    ]);
    assert.deepStrictEqual(R.segmentRefs("OWASP ASVS 5.0.0 requirements 14.2.6 and 14.2.7").map((r) => r.key), ["asvs:14.2.6", "asvs:14.2.7"]);
    assert.deepStrictEqual(R.segmentRefs("PCI DSS v4.0.1 Requirement 6.2.4").map((r) => r.key), ["pci:6.2.4"], "PCI DSS unchanged");
  });

  test("the documents are in the manifest's layers, and the OWASP standard is the published PDF, unchanged", () => {
    const m = loadManifest();
    const layer = (src) => m.pillars.find((p) => p.documents.includes(src)).id;
    assert.deepStrictEqual(["OWASP_ASVS-5.0.0_May2025.pdf", "Nexus_SVS_Security-Verification-Standard_v1.md", "Nexus_CLR-WIKI-024_Building-A-Settlement-Component.md"].map(layer), ["regulator", "sdlc", "team"]);
    const pdf = fs.readFileSync(path.join(ROOT, "public/demos/demo_files/ext_standards/OWASP_ASVS-5.0.0_May2025.pdf"));
    assert.strictEqual(require("crypto").createHash("sha256").update(pdf).digest("hex"), "f3e9a2f1098bc4af594578acb404121af69e3964aa4d90abd4b00607218d30c6");
    assert.strictEqual(pdf.length, 516102);
  });

  test("the ticket is in the seed's backlog; the content pack's copies match the shipped files (only where inputs/ exists)", () => {
    const ticket = read("public/demos/seed/nexus-payments/backlog/DSP-2026-03.md");
    assert.match(ticket, /^# DSP-2026-03: Record card payment disputes in the settlement service$/m);
    assert.match(ticket, /`record_dispute\(conn, transaction_id, card_number, amount, reason_code, received_on, actor\)`/);
    const pack = path.join(ROOT, "inputs", "demo-design", "content", "s6");
    if (!fs.existsSync(pack)) return; // the image ships no inputs/ (.dockerignore): the copies are checked where they exist
    for (const [copy, shipped] of [
      ["ticket/DSP-2026-03.md", "public/demos/seed/nexus-payments/backlog/DSP-2026-03.md"],
      ["standards/Nexus_SVS_Security-Verification-Standard_v1.md", "public/demos/demo_files/engineering_standards/Nexus_SVS_Security-Verification-Standard_v1.md"],
      ["team/Nexus_CLR-WIKI-024_Building-A-Settlement-Component.md", "public/demos/demo_files/team_knowledge/Nexus_CLR-WIKI-024_Building-A-Settlement-Component.md"],
    ]) {
      assert.strictEqual(fs.readFileSync(path.join(pack, copy), "utf8"), read(shipped), copy);
    }
  });
});
