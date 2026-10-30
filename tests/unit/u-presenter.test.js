/**
 * U-PRESENTER — the presenter panels and the presenter flow (inputs/demo-design/presenter-panels-design.md: PR A of
 * 2026-10-07 and the flow fix after the owner's first run-through the same day: D1 make the next step obvious, D2 no key
 * step can be skipped (Record needs PASSING tests after the change is applied), D3 the chat explains and the IDE
 * carries the code; new tests take their expected values from the fixture).
 *
 *  - steps.js: the gate from the run log and the one next action, through a whole S1 flow, the session-88 and
 *    session-89 run-throughs, a red run, a repair, a stale run after an Apply, windows, optional steps.
 *  - chat_text.js: code left out of the chat (File blocks become one-line notes), the streaming form, the code
 *    locations, the diff counts, the numbered lines.
 *  - the definition: S1's card, modes, repair prompt and Select's test run; the schema's refusals.
 *  - the persona: the plain-language answer shape, no code in the explanation, no self-computed expected values.
 *  - the extension, loaded for real with a stub for vscode: a proposal opens as a diff of in-memory documents, a
 *    location as a selection; a refused path is a 400.
 *  - source pins: the page, the panels, the bar's NEXT panel and refreshes, the chips' IDE buttons, the sidebar, the
 *    route's select / show-proposal / reveal actions, the turn's modes and IDE display.
 */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const Module = require("module");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const exists = (rel) => fs.existsSync(path.join(REPO_ROOT, rel));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { stepStates, flowLayout, windowOf, modeOf } = require("../../src/lib/coding/steps");
const { validateScenario, validateCard, loadScenarios, loadManifest } = require("../../src/lib/coding/scenarios");
const { chatText, streamingChatText, parseLocations, diffStat, numberLines } = require("../../src/lib/coding/chat_text");
const { codingSystemPrompt, requestInstruction } = require("../../src/lib/coding/persona");

const s1 = loadScenarios().find((s) => s.id === "s1");
const RECON = "nexus-payments/services/settlement/settlement_reconciler.py";
const TESTF = "nexus-payments/services/settlement/test_settlement_reconciler.py";
const at = (m) => `2026-10-07T10:${String(m).padStart(2, "0")}:00.000Z`;
const TURN = (step, m, extra = {}) => ({ kind: "turn", scenario: "s1", step, success: true, at: at(m), turnId: `t-${step}-${m}`, thinking: { mode: "on" }, fileOperations: [], ...extra });
const FIX = (m, files = [RECON, TESTF], extra = {}) => TURN("fix", m, { fileOperations: files, ...extra });
const APPLY = (m, p = RECON) => ({ kind: "apply", path: p, ok: true, at: at(m) });
const TESTS = (m, exitCode, summary) => ({ kind: "test-run", scenario: "s1", ran: true, exitCode, summary: summary || (exitCode === 0 ? "8 passed" : "1 of 8 failed"), at: at(m) });
const RECORD = (m) => ({ kind: "record", scenario: "s1", recordId: "abcd1234", paths: ["a.json", "a.md"], at: at(m) });
const statuses = (events) => stepStates(s1, events).steps.map((s) => s.status);
const nextOf = (events) => stepStates(s1, events).next;

describe("U-PRESENTER/steps: the gate from the run log (D3 a; after the run-through, D2: no key step can be skipped)", () => {
  test("a fresh demo: step 1 ready, the rest locked; the next action asks step 1's prompt", () => {
    const p = stepStates(s1, []);
    assert.deepStrictEqual(statuses([]), ["ready", "locked", "locked"]);
    assert.strictEqual(p.currentStepId, "diagnose");
    assert.deepStrictEqual([p.next.action, p.next.stepId], ["ask", "diagnose"]);
    assert.deepStrictEqual(p.steps.map((s) => s.mode), ["explain", "change", null]);
  });

  test("a failed turn does not count and the next action says so; a successful explain turn completes its step", () => {
    const failed = stepStates(s1, [TURN("diagnose", 1, { success: false })]);
    assert.deepStrictEqual(failed.steps.map((s) => s.status), ["ready", "locked", "locked"]);
    assert.match(failed.next.detail, /The last answer failed/);
    const p = stepStates(s1, [TURN("diagnose", 1)]);
    assert.deepStrictEqual(p.steps.map((s) => s.status), ["done", "ready", "locked"]);
    assert.deepStrictEqual([p.next.action, p.next.stepId], ["ask", "fix"]);
  });

  test("the whole S1 flow: ask, apply each proposed file, run the tests, a red run asks for the repair, then apply, run, green, record", () => {
    const ev = [TURN("diagnose", 1)];
    const walk = [];
    const step = (label) => walk.push([label, nextOf(ev).action, statuses(ev).join(",")]);
    ev.push(FIX(3)); step("fix answered");
    ev.push(APPLY(4, RECON)); step("1 of 2 applied");
    ev.push(APPLY(5, TESTF)); step("2 of 2 applied");
    ev.push(TESTS(6, 1)); step("red run");
    ev.push(FIX(8, [TESTF], { repair: true })); step("repair answered");
    ev.push(APPLY(9, TESTF)); step("repair applied");
    ev.push(TESTS(10, 0)); step("green run");
    ev.push(RECORD(11)); step("recorded");
    assert.deepStrictEqual(walk, [
      ["fix answered", "apply", "done,ready,locked"],
      ["1 of 2 applied", "apply", "done,ready,locked"],
      ["2 of 2 applied", "run-tests", "done,ready,locked"],
      ["red run", "repair", "done,ready,locked"],
      ["repair answered", "apply", "done,ready,locked"],
      ["repair applied", "run-tests", "done,ready,locked"],
      ["green run", "record", "done,done,ready"],
      ["recorded", "results", "done,done,done"],
    ]);
    const applying = stepStates(s1, ev.slice(0, 3));
    assert.deepStrictEqual(applying.steps[1].change, { proposed: [RECON, TESTF], applied: [RECON], pending: [TESTF] });
    assert.strictEqual(applying.next.turnId, "t-fix-3");
    assert.deepStrictEqual(applying.next.pending, [TESTF]);
    assert.match(applying.next.detail, /1 of 2 files applied/);
    assert.strictEqual(stepStates(s1, ev).steps[1].turn.repair, true);
  });

  test("D2 (b): a red run never unlocks Record; the session-89 run-through (two Applies, no test run) asks for the tests", () => {
    const red = stepStates(s1, [TURN("diagnose", 1), FIX(3), APPLY(4, RECON), APPLY(5, TESTF), TESTS(6, 1)]);
    assert.deepStrictEqual(red.steps.map((s) => s.status), ["done", "ready", "locked"]);
    assert.strictEqual(red.steps[1].tests.state, "failed");
    assert.match(red.next.detail, /Record unlocks only when they pass/);
    const run89 = stepStates(s1, [TURN("diagnose", 1), FIX(3), APPLY(4, RECON), APPLY(5, TESTF)]);
    assert.deepStrictEqual([run89.next.action, run89.steps[2].status], ["run-tests", "locked"]);
  });

  test("the session-88 run-through (Apply, then Record with no test run) leaves Record locked; tests before the change or before every Apply do not count", () => {
    assert.deepStrictEqual(statuses([TURN("diagnose", 1), FIX(3), APPLY(5, RECON), APPLY(5, TESTF), RECORD(6)]), ["done", "ready", "locked"]);
    assert.strictEqual(nextOf([TURN("diagnose", 1), TESTS(2, 0), FIX(3)]).action, "apply", "a green run before the change is not the change's run");
    assert.strictEqual(nextOf([TURN("diagnose", 1), FIX(3), APPLY(4, RECON), TESTS(5, 0)]).action, "apply", "the test file is still pending: no run counts yet");
  });

  test("an Apply after a green run makes it stale: run the tests again; a record made before that does not complete the demo", () => {
    const ev = [TURN("diagnose", 1), FIX(3), APPLY(4, RECON), APPLY(5, TESTF), TESTS(6, 0), RECORD(7), APPLY(8, RECON)];
    const p = stepStates(s1, ev);
    assert.deepStrictEqual(p.steps.map((s) => s.status), ["done", "ready", "locked"]);
    assert.strictEqual(p.next.action, "run-tests");
    assert.deepStrictEqual(statuses([...ev, TESTS(9, 0)]), ["done", "done", "ready"], "the old record predates the new completion: Record again");
  });

  test("an answer that proposes no file asks again; a change step with no repair prompt asks again after a red run", () => {
    const none = stepStates(s1, [TURN("diagnose", 1), FIX(3, [])]);
    assert.deepStrictEqual([none.next.action, none.next.stepId], ["ask", "fix"]);
    assert.match(none.next.detail, /proposed no change/);
    const plain = { id: "s9", steps: [{ id: "change", title: "Change", prompt: "c", mode: "change", after: ["run-tests"] }] };
    const r = stepStates(plain, [{ kind: "turn", scenario: "s9", step: "change", success: true, at: at(1), fileOperations: ["a.py"] }, { kind: "apply", path: "a.py", ok: true, at: at(2) }, { kind: "test-run", scenario: "s9", ran: true, exitCode: 1, summary: "1 failed", at: at(3) }]);
    assert.strictEqual(r.next.action, "ask");
    assert.match(r.next.detail, /tests failed/);
  });

  test("a re-run of a done step locks nothing after it; an optional step never blocks the next one", () => {
    const rerun = stepStates(s1, [TURN("diagnose", 1), FIX(3), APPLY(4, RECON), APPLY(5, TESTF), TESTS(6, 0), TURN("diagnose", 7, { thinking: { mode: "off" } })]);
    assert.deepStrictEqual(rerun.steps.map((s) => s.status), ["done", "done", "ready"]);
    assert.deepStrictEqual([rerun.steps[0].turn.thinking, rerun.steps[0].turn.runs], ["off", 2]);
    const sc = { id: "s9", steps: [{ id: "explain", title: "Explain", prompt: "x", optional: true }, { id: "migrate", title: "Migrate", prompt: "y" }, { id: "record", title: "Record", action: "record" }] };
    const p = stepStates(sc, []);
    assert.deepStrictEqual(p.steps.map((s) => s.status), ["ready", "ready", "locked"]);
    assert.deepStrictEqual([p.currentStepId, p.next.stepId], ["migrate", "migrate"]);
  });

  test("a reset of everything, a reset of this demo, or a Select starts a new window; another demo's reset does not", () => {
    const done = [TURN("diagnose", 1), FIX(3), APPLY(4, RECON), APPLY(5, TESTF), TESTS(6, 0), RECORD(7)];
    assert.deepStrictEqual(statuses(done), ["done", "done", "done"]);
    assert.deepStrictEqual(statuses([...done, { kind: "reset-all", at: at(8) }]), ["ready", "locked", "locked"]);
    assert.deepStrictEqual(statuses([...done, { kind: "reset-scenario", scenario: "s1", at: at(8) }]), ["ready", "locked", "locked"]);
    assert.deepStrictEqual(statuses([...done, { kind: "select", scenario: "s1", at: at(8) }]), ["ready", "locked", "locked"]);
    assert.deepStrictEqual(statuses([...done, { kind: "reset-scenario", scenario: "s2", at: at(8) }]), ["done", "done", "done"]);
    assert.strictEqual(windowOf([...done, { kind: "select", scenario: "s1", at: at(8) }, APPLY(9)], "s1").length, 1);
    const p = stepStates(s1, [{ kind: "select", scenario: "s1", at: at(8) }, TESTS(8, 1, "3 of 5 failed")]);
    assert.deepStrictEqual([p.next.action, p.lastRun.summary], ["ask", "3 of 5 failed"], "Select's reproduction run is in the window and satisfies nothing");
  });

  test("modeOf and flowLayout: modes from the definition; the chain drawn on the card", () => {
    assert.deepStrictEqual([modeOf({ prompt: "p" }), modeOf({ prompt: "p", after: ["run-tests"] }), modeOf({ action: "record" }), modeOf({ prompt: "p", mode: "change" })], ["explain", "change", null, "change"]);
    const l = flowLayout(s1);
    assert.deepStrictEqual(l.nodes.map((n) => n.id), ["ticket", "diagnose", "fix", "fix:apply", "fix:tests", "record"]);
    assert.deepStrictEqual(l.nodes.map((n) => n.sub), ["opened, tests run once", "explained in the chat", "change shown in the IDE", "the reviewed change", "must pass", "from the run log"]);
    assert.deepStrictEqual(l.layers.targets, ["diagnose", "fix"]);
    assert.strictEqual(l.edges.length, 5);
  });
});

describe("U-PRESENTER/chat_text: the chat explains, the IDE carries the code (D3)", () => {
  const ANSWER = [
    "The fee is truncated at services/settlement/settlement_reconciler.py:78-82, which breaks [REG-1]. Use `Decimal`.",
    "",
    "```python",
    `# File: ${RECON}`,
    "print(1)",
    "```",
    "",
    "Then the query.",
    "",
    "File: nexus-payments/services/settlement/reconciliation.sql",
    "```sql",
    "select 1;",
    "```",
    "",
    "```",
    "snippet",
    "```",
    "Verify with the tests.",
  ].join("\n");

  test("a change answer: each File block becomes one line naming the file; a File: line above a fence goes too; a snippet becomes a note; the prose and inline code stay", () => {
    const t = chatText(ANSWER);
    assert.ok(!t.includes("```") && !t.includes("print(1)") && !t.includes("select 1;") && !t.includes("snippet"), "no code in the chat");
    // PR B (D6): the note names the file only; the full workspace path overflowed the chat column.
    assert.match(t, /> 📄 Proposed change to `settlement_reconciler\.py`: review it in the IDE, then Apply\./);
    assert.match(t, /> 📄 Proposed change to `reconciliation\.sql`/);
    assert.ok(!t.includes("nexus-payments/services"), "no full path in the notes");
    assert.ok(!/^File: /m.test(t), "the File: line above the fence is gone");
    assert.match(t, /> Code left out of the chat: the code belongs in the IDE\./);
    assert.match(t, /breaks \[REG-1\]\. Use `Decimal`\./);
    assert.match(t, /Verify with the tests\.$/);
  });

  test("an explain answer: one note for back-to-back blocks, saying the change comes in the next step; an answer cut inside a block says so", () => {
    const t = chatText("A\n```\nx\n```\n\n```\ny\n```\nB", { mode: "explain" });
    assert.strictEqual((t.match(/Code left out of the chat: this step explains/g) || []).length, 1);
    assert.match(chatText(`Intro\n\n\`\`\`python\n# File: ${RECON}\nimport os\n`), /was cut off before it was complete: ask again/);
    assert.strictEqual(chatText("no code here"), "no code here");
  });

  test("while streaming, an open block reads Writing <file> for the IDE", () => {
    assert.match(streamingChatText(`Intro\n\n\`\`\`python\n# File: ${RECON}\nimport os\n`), /> ✍️ Writing `settlement_reconciler\.py` for the IDE…$/);
    assert.match(streamingChatText("Intro\n\n```\nx = 1\n"), /Writing code for the IDE…$/);
  });

  test("code locations: the tail of an attached path, clamped to the file, first mention kept, unknown files and lines outside ignored", () => {
    const files = [{ path: RECON, lineCount: 166 }, { path: TESTF, lineCount: 102 }];
    const text = "See services/settlement/settlement_reconciler.py:78-82 and settlement_reconciler.py:78-82 again, test_settlement_reconciler.py:95, settlement_reconciler.py:160-999, settlement_reconciler.py:300, other.py:5, settlement_reconciler.py:90-80.";
    assert.deepStrictEqual(parseLocations(text, files).map((l) => l.label), ["settlement_reconciler.py:78-82", "test_settlement_reconciler.py:95", "settlement_reconciler.py:160-166", "settlement_reconciler.py:90"]);
    assert.deepStrictEqual(parseLocations(text, files)[0], { path: RECON, startLine: 78, endLine: 82, label: "settlement_reconciler.py:78-82" });
    assert.strictEqual(parseLocations("a.py:1 a.py:2 a.py:3", [{ path: "a.py", lineCount: 9 }], { max: 2 }).length, 2);
  });

  test("diff counts: an LCS over lines; a new file; the cap's multiset count; numbered lines for a diagnosis", () => {
    assert.deepStrictEqual(diffStat("a\nb\nc\n", "a\nb\nc\n"), { added: 0, removed: 0, isNew: false });
    assert.deepStrictEqual(diffStat("a\nb\nc\n", "a\nB\nc\nd\n"), { added: 2, removed: 1, isNew: false });
    assert.deepStrictEqual(diffStat(null, "x\ny\n"), { added: 2, removed: 0, isNew: true });
    const big = Array.from({ length: 2100 }, (_, i) => `l${i}`).join("\n");
    assert.deepStrictEqual(diffStat(big, `${big}\nextra`), { added: 1, removed: 0, isNew: false });
    assert.strictEqual(numberLines("one\ntwo\n"), "1 | one\n2 | two");
    assert.strictEqual(numberLines(Array.from({ length: 10 }, () => "x").join("\n")).split("\n")[0], " 1 | x");
  });
});

describe("U-PRESENTER/definition: the card, the modes, the repair prompt, Select's test run", () => {
  const SEED = path.join(REPO_ROOT, "public", "demos", "seed");

  test("S1: the card; minutes; Select resets and runs the tests once; Diagnose explains, Fix changes and keeps the existing tests, with a repair prompt", () => {
    assert.ok(s1.card && s1.card.about.length > 40 && s1.card.scenario.length > 40);
    assert.ok(s1.card.people.length >= 3 && s1.card.people.every((p) => p.name && p.role));
    assert.ok(s1.card.teams.length >= 2 && s1.card.outputs.length >= 2 && s1.card.value.length >= 2);
    assert.strictEqual(s1.minutes, 4);
    assert.deepStrictEqual(s1.select, { reset: true, runTests: true, branch: "main" });
    for (const c of s1.card.artefacts.code) assert.ok(fs.existsSync(path.join(SEED, c.path)), c.path);
    const sources = loadManifest().pillars.flatMap((p) => p.documents);
    for (const d of s1.card.artefacts.documents) assert.ok(sources.includes(d.source), d.source);
    assert.deepStrictEqual(s1.steps.map((s) => s.mode), ["explain", "change", null]);
    assert.match(s1.steps[1].prompt, /keep the existing tests/);
    assert.match(s1.steps[1].repair.prompt, /tests failed/);
    assert.strictEqual(s1.steps[0].repair, null);
    assert.match(s1.talkTrack, /tests run once/);
  });

  test("the schema's refusals: a bad mode, a mode on an action, a repair outside a change step that runs the tests, a repair without a prompt, a non-boolean runTests, runTests without a test command", () => {
    const base = { id: "s9", title: "T", ticket: { id: "T-1", path: "nexus-payments/backlog/t.md" }, steps: [{ id: "a", prompt: "p" }] };
    assert.strictEqual(validateScenario(base).card, null);
    assert.deepStrictEqual(validateScenario(base).select, { reset: true, runTests: false, branch: "main" });
    assert.strictEqual(validateScenario(base).steps[0].mode, "explain");
    assert.strictEqual(validateScenario({ ...base, steps: [{ id: "a", prompt: "p", after: ["run-tests"] }] }).steps[0].mode, "change");
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "a", prompt: "p", mode: "write" }] }), /mode must be explain, change, review, migrate, audit, doc, comments or improve/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "r", action: "record", mode: "change" }] }), /an action step has no mode/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "a", prompt: "p", repair: { prompt: "x" } }] }), /repair belongs to a change, migrate, comments or improve step/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "a", prompt: "p", after: ["run-tests"], repair: {} }] }), /repair\.prompt is required/);
    assert.throws(() => validateScenario({ ...base, select: { runTests: "yes" } }), /select\.runTests/);
    assert.throws(() => validateScenario({ ...base, select: { runTests: true } }), /needs a test command/);
    assert.throws(() => validateScenario({ ...base, card: { artefacts: { code: [{ path: "../x.py" }] } } }), /not a path under/);
    assert.throws(() => validateScenario({ ...base, card: { artefacts: { documents: [{ source: "nope.pdf" }] } } }, { documentSources: ["a.pdf"] }), /not in the pillar manifest/);
    assert.throws(() => validateScenario({ ...base, minutes: 0 }), /minutes/);
    assert.throws(() => validateScenario({ ...base, select: { reset: "no" } }), /select\.reset/);
    assert.strictEqual(validateCard(undefined, "scenario s9"), null);
  });

  test("the persona: plain language for a mixed audience, no code in the explanation, locations as path:start-end, no self-computed expected value; the per-request instruction", () => {
    const p = codingSystemPrompt({ scenario: { title: "Settlement mismatch incident", ticket: { id: "INC-2026-0419" } } });
    assert.match(p, /the code itself is shown in the IDE, never in the chat/);
    assert.match(p, /Never put code, code excerpts, diffs or pseudo-code in the explanation/);
    assert.match(p, /path:start-end/);
    assert.match(p, /Never work out an expected value yourself/);
    assert.match(p, /keep the existing tests as they are unless the request asks you to change them/);
    assert.match(requestInstruction({ mode: "explain" }), /do not write code or File blocks/);
    assert.match(requestInstruction({ mode: "change" }), /File block/);
    assert.match(requestInstruction({ mode: "change", repair: true }), /LATEST TEST RUN/);
  });
});

describe("U-PRESENTER/extension: a proposal opens as a diff of in-memory documents, a location as a selection (the real extension, a stub for vscode)", () => {
  const EXT = path.join(REPO_ROOT, "code-server-ext", "nexcode-bridge", "extension.js");
  const TOKEN = "u-presenter-synthetic-token";
  const calls = [];
  const providers = {};
  let lastEditor = null;
  class Range {
    constructor(sl, sc, el, ec) {
      this.start = { line: sl, character: sc };
      this.end = { line: el, character: ec };
    }
  }
  class Selection {
    constructor(a, b) {
      this.anchor = a;
      this.active = b;
    }
  }
  const stub = {
    window: {
      createStatusBarItem: () => ({ text: "", tooltip: "", show() {}, dispose() {} }),
      activeTextEditor: undefined,
      tabGroups: { all: [] },
      showTextDocument: async (doc, opts) => {
        calls.push(["show", doc && doc.uri ? doc.uri : doc, opts || null]);
        lastEditor = { document: doc, selection: null, revealRange: (r) => calls.push(["reveal", r.start.line, r.end.line]) };
        return lastEditor;
      },
    },
    workspace: {
      registerTextDocumentContentProvider: (scheme, provider) => {
        providers[scheme] = provider;
        return { dispose() {} };
      },
      openTextDocument: async (uri) => {
        if (String((uri && uri.path) || "").includes("/missing/")) throw new Error("not found");
        return { uri, lineCount: 120, lineAt: (i) => ({ text: `line ${i + 1}` }) };
      },
    },
    Uri: { file: (p) => ({ scheme: "file", path: p, fsPath: p }), from: (o) => ({ ...o }) },
    Range,
    Selection,
    TextEditorRevealType: { InCenter: 2 },
    ViewColumn: { One: 1, Two: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    commands: { executeCommand: async (...args) => calls.push(["command", ...args]) },
  };
  const realLoad = Module._load;
  let ext = null;
  let port = 0;
  const freePort = () =>
    new Promise((resolve, reject) => {
      const s = net.createServer();
      s.on("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
  const post = (urlPath, body) =>
    new Promise((resolve) => {
      const data = JSON.stringify(body);
      const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "POST", headers: { "x-nexcode-bridge": TOKEN, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
        let t = "";
        res.on("data", (c) => (t += c));
        res.on("end", () => {
          let j = null;
          try {
            j = JSON.parse(t);
          } catch {
            j = null;
          }
          resolve({ status: res.statusCode, json: j });
        });
      });
      req.on("error", (err) => resolve({ status: 0, error: err.message }));
      req.end(data);
    });

  before(async () => {
    Module._load = function loadWithVscodeStub(request, ...rest) {
      if (request === "vscode") return stub;
      return realLoad.call(this, request, ...rest);
    };
    port = await freePort();
    process.env.NEXCODE_BRIDGE_TOKEN = TOKEN;
    process.env.NEXCODE_BRIDGE_PORT = String(port);
    process.env.NEXCODE_BRIDGE_RETRY_MS = "40";
    process.env.NEXCODE_BRIDGE_STANDBY_MS = "400";
    delete require.cache[require.resolve(EXT)];
    ext = require(EXT);
    ext.activate({ subscriptions: [] });
    for (let i = 0; i < 100; i++) {
      const r = await post("/api/action", { type: "noop" });
      if (r.status === 400) break;
      await sleep(20);
    }
  });
  after(() => {
    if (ext) ext.deactivate();
    Module._load = realLoad;
  });

  test("showProposal: the provider is registered; a new file's diff is an empty document against the proposal, both in memory", async () => {
    assert.ok(providers["nexcode-proposal"], "registered at activation");
    const r = await post("/api/action", { type: "showProposal", path: "nexus-payments/new_module.py", content: "print('proposed')\n" });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.json.success, r.json.isNew], [true, true]);
    const diff = calls.filter((c) => c[0] === "command" && c[1] === "vscode.diff").pop();
    assert.ok(diff, "vscode.diff was executed");
    const [, , left, right, title] = diff;
    assert.deepStrictEqual([left.scheme, left.path, left.query], ["nexcode-proposal", "/nexus-payments/new_module.py", "empty"]);
    assert.deepStrictEqual([right.scheme, right.path], ["nexcode-proposal", "/nexus-payments/new_module.py"]);
    assert.match(title, /new_module\.py: new file vs proposed by NexCODE/);
    assert.strictEqual(providers["nexcode-proposal"].provideTextDocumentContent(right), "print('proposed')\n");
    assert.strictEqual(providers["nexcode-proposal"].provideTextDocumentContent(left), "");
  });

  test("S3-D13 (a): a migration's new file opens beside its pair, the pair left and the proposal right, with no diff", async () => {
    const before = calls.length;
    const r = await post("/api/action", { type: "showProposal", path: "nexus-payments/services/clearing/ClearingBatch.java", content: "class ClearingBatch {}\n", beside: "nexus-payments/legacy/clearing-batch/CLEARING.cbl" });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.json.success, r.json.isNew, r.json.view, r.json.beside], [true, true, "beside", "nexus-payments/legacy/clearing-batch/CLEARING.cbl"]);
    const shown = calls.slice(before).filter((c) => c[0] === "show");
    assert.strictEqual(shown.length, 2);
    assert.deepStrictEqual([shown[0][1].scheme, shown[0][1].path.endsWith("/nexus-payments/legacy/clearing-batch/CLEARING.cbl"), shown[0][2].viewColumn, shown[0][2].preserveFocus], ["file", true, 1, true]);
    assert.deepStrictEqual([shown[1][1].scheme, shown[1][1].path, shown[1][2].viewColumn], ["nexcode-proposal", "/nexus-payments/services/clearing/ClearingBatch.java", 2]);
    assert.strictEqual(providers["nexcode-proposal"].provideTextDocumentContent(shown[1][1]), "class ClearingBatch {}\n");
    assert.strictEqual(calls.slice(before).filter((c) => c[1] === "vscode.diff").length, 0, "no diff between two languages");
  });

  test("S3-D13 (a): a migration's other new file opens alone; a pair that cannot be opened falls back to the diff; a pair outside the workspace is refused", async () => {
    let before = calls.length;
    const alone = await post("/api/action", { type: "showProposal", path: "nexus-payments/services/clearing-rs/Cargo.toml", content: "[package]\n", alone: true });
    assert.deepStrictEqual([alone.status, alone.json.view], [200, "alone"]);
    assert.deepStrictEqual(calls.slice(before).filter((c) => c[0] === "show").map((c) => c[1].scheme), ["nexcode-proposal"]);
    assert.strictEqual(calls.slice(before).filter((c) => c[1] === "vscode.diff").length, 0);
    before = calls.length;
    const missing = await post("/api/action", { type: "showProposal", path: "nexus-payments/services/clearing/B.java", content: "x\n", beside: "nexus-payments/missing/CLEARING.cbl" });
    assert.deepStrictEqual([missing.status, missing.json.view], [200, "diff"]);
    assert.strictEqual(calls.slice(before).filter((c) => c[1] === "vscode.diff").length, 1);
    const escape = await post("/api/action", { type: "showProposal", path: "nexus-payments/services/clearing/C.java", content: "x\n", beside: "../etc/passwd" });
    assert.strictEqual(escape.status, 400);
    assert.match(escape.json.error, /parent segment/);
  });

  test("showProposal refuses a path outside the workspace and an oversized proposal (HTTP 400), and opens nothing", async () => {
    const before = calls.length;
    const escape = await post("/api/action", { type: "showProposal", path: "../escape.py", content: "x" });
    assert.strictEqual(escape.status, 400);
    assert.match(escape.json.error, /parent segment/);
    const big = await post("/api/action", { type: "showProposal", path: "nexus-payments/a.py", content: "x".repeat(256 * 1024 + 1) });
    assert.strictEqual(big.status, 400);
    assert.match(big.json.error, /longer than/);
    assert.strictEqual(calls.slice(before).filter((c) => c[1] === "vscode.diff").length, 0);
  });

  test("openFile with endLine selects the whole lines and reveals them; with a line alone the cursor sits at the line", async () => {
    const r = await post("/api/action", { type: "openFile", path: RECON, line: 78, endLine: 82 });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([lastEditor.selection.anchor.line, lastEditor.selection.active.line, lastEditor.selection.active.character], [77, 81, "line 82".length]);
    assert.deepStrictEqual(calls.filter((c) => c[0] === "reveal").pop(), ["reveal", 77, 81]);
    await post("/api/action", { type: "openFile", path: RECON, line: 10 });
    assert.deepStrictEqual([lastEditor.selection.anchor.line, lastEditor.selection.active.line, lastEditor.selection.active.character], [9, 9, 0]);
  });
});

describe("U-PRESENTER/seams: the page, the panels, the bar, the chips, the sidebar, the route", () => {
  const page = codeOnly(read("src/app/page.js"));
  const panel = read("src/components/ChatPanel.jsx").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const chips = codeOnly(read("src/components/CodingLiveTurn.jsx"));
  const bar = codeOnly(read("src/components/StepBar.jsx"));
  const demo = codeOnly(read("src/components/presenter/DemoPanel.jsx"));
  const viewer = codeOnly(read("src/components/presenter/DocumentViewer.jsx"));
  const card = codeOnly(read("src/components/presenter/DemoCard.jsx"));
  const sidebar = codeOnly(read("src/components/Sidebar.jsx"));
  const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
  const turn = codeOnly(read("src/lib/coding/turn.js"));

  test("the page mounts the provider, the Demo panel and the step bar; the IDE column's pinned shape is untouched; the old demo-information panel and the strip are gone", () => {
    assert.match(page, /<PresenterProvider value=\{presenter\}>/);
    assert.match(page, /<\/PresenterProvider>\s*\);\s*\}\s*$/);
    assert.match(page, /<DemoPanel\s/);
    assert.match(page, /<StepBar\s/);
    assert.match(page, /open=\{isDemoOpen\}/);
    // Polish (2026-10-14): the handler after Select is shared with the demo selection screen (U-POLISH pins the screen).
    assert.match(page, /const demoSelected = \(scenario, result\) => \{\s*handleResetState\(\);\s*setActiveScenarioStep\(null\);\s*setActiveDemoId\(scenario\.id\);\s*setIsDemoOpen\(false\);\s*setIsDemoSelectOpen\(false\);/);
    assert.strictEqual((page.match(/onSelected=\{demoSelected\}/g) || []).length, 2, "the Demo panel and the selection screen share it");
    assert.match(page, /technical=\{\{\s*codeModel: codeEndpointType === "ollama" \? codeOllamaModelName/, "the technical block reads the live admin settings");
    assert.match(page, /openPassages: \(\{ passages, scenario \} = \{\}\) => \{/);
    assert.match(page, /<div className=\{\s*ideOpen\s*\?[\s\S]*?: "hidden"\s*\}>\s*<VisualStage \/>\s*<\/div>/, "U-PATHS E3b's shape");
    assert.ok(!/DemoInformationPanel|nexus-demo-info|ScenarioPanel|isDemoInfoOpen/.test(page));
    for (const rel of ["src/nexus-demo-info", "src/app/api/demo-info", "src/components/ScenarioPanel.jsx"]) assert.ok(!exists(rel), `${rel} is deleted`);
    const walk = (dir, out) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    for (const f of walk(path.join(REPO_ROOT, "src"), [])) {
      assert.ok(!/nexus-demo-info|\/api\/demo-info|ScenarioPanel/.test(codeOnly(fs.readFileSync(f, "utf8"))), `${path.relative(REPO_ROOT, f)} references a deleted file`);
    }
  });

  test("ChatPanel still fetches nothing; the chips reach the Demo panel through the context; the bar and the panel do their own fetching", () => {
    assert.strictEqual((panel.match(/\bfetch\(/g) || []).length, 0);
    assert.match(panel, /\{chat\.coding && <CodingTurnChips coding=\{chat\.coding\} \/>\}/, "the pinned call site is unchanged: no new prop");
    assert.match(chips, /import \{ usePresenter \} from "@\/context\/PresenterContext";/);
    assert.match(chips, /const presenter = usePresenter\(\);\s*const \[ideNote, setIdeNote\] = useState\(null\);\s*if \(!coding/, "the hooks run before the early return");
    assert.match(chips, /presenter\.openPassages\(\{ passages: citedPassages, scenario: coding\.scenario \|\| null \}\)/);
    assert.match(bar, /const presenter = usePresenter\(\);/);
    assert.match(bar, /presenter\.openDemoPanel\("overview"\)/);
    assert.ok(/\bfetch\(/.test(bar) && /\bfetch\(/.test(demo), "the bar and the panel fetch for themselves");
    assert.match(bar, /action: "state", light: true/);
    assert.match(demo, /action: "state", light: false/);
    assert.match(demo, /action: "select", scenarioId: s\.id/);
    assert.match(demo, /if \(e\.key === "Escape" && typeof onClose === "function"\) onClose\(\);/);
    assert.match(demo, /className="fixed top-20 left-20 right-0 bottom-0 z-50/, "over the workbench only: the navigation bar and the sidebar stay");
    assert.ok(!/confirm\(/.test(bar + demo + viewer + card), "no dialog confirmation anywhere (U-DESTRUCT/E38)");
    assert.ok(!/reset-all|Rebuild workspace|typedReset/.test(bar), "the bar has no hard reset: the sidebar's reset menu owns it (D1 (a))");
  });

  test("the gate in the bar: a locked step is disabled and says which step to complete first; the record step runs Record; Run tests is never gated", () => {
    // S4: the results step is an action too, held while another action runs.
    // S6 (2026-10-13): the commit step's button waits for a running action too.
    assert.match(bar, /disabled=\{locked \|\| isAnalyzing \|\| \(\(step\.action === "record" \|\| step\.action === "results" \|\| step\.action === "commit"\) && Boolean\(busy\)\)\}/);
    assert.match(bar, /\? `Complete step \$\{previousRequired\(i\)\} first`/);
    assert.match(bar, /if \(!st \|\| st\.status === "locked"\) return;/);
    assert.match(bar, /if \(step\.action === "record"\) \{\s*recordChange\(\);\s*return;\s*\}/);
    assert.match(bar, /disabled=\{!bridgeUp \|\| Boolean\(busy\)\} title=\{bridgeUp \? "Run the demo's tests in the IDE container"/);
    assert.match(bar, /if \(wasAnalyzing\.current && !isAnalyzing\) refresh\(\);/, "a finished turn re-reads the steps");
  });

  test("the viewer renders a document only from the served path the server resolved, opened at the page; the cited passage is quoted above it", () => {
    assert.match(viewer, /src=\{`\$\{docPath\}#page=\$\{page\}&view=FitH`\}/);
    assert.match(viewer, /const docPath = doc && doc\.path \? doc\.path : null;/);
    assert.ok(!/demos\/demo_files/.test(viewer), "no path is built from a name in the browser");
    assert.match(viewer, /data-cited-passage=\{active\.marker\}/);
    assert.match(viewer, /<iframe key=\{`\$\{docPath\}#\$\{page\}`\}/, "re-keyed per page so the viewer navigates");
    assert.match(viewer, /disabled=\{!d\.path\}/, "a document without a served path is listed, not shown");
  });

  test("the card: generated from the definition, the talk track behind a toggle, the technical tiles from props", () => {
    assert.match(card, /const layout = flowLayout\(scenario\);/);
    assert.match(card, /\{notesOpen && \(/);
    assert.match(card, /data-presenter-notes="true"/);
    assert.match(card, /<Tile label="Code model" value=\{technical && technical\.codeModel\}/);
    assert.ok(!/qwen|nemotron|Qwen/.test(card), "no model name is written into the card");
    assert.match(card, /data-select-demo=\{scenario\.id\}/);
  });

  test("the sidebar: Demo, Documents and Results in the top group; Store Admin gone from the menu (PR B, D4 (a)); Session Reset opens the two-level menu", () => {
    assert.match(sidebar, /id: "demo",\s*label: "Demo",/);
    assert.match(sidebar, /icon: "RiSlideshow3Line"/);
    assert.ok(!/id: "standards"/.test(sidebar), "the Standards toggle left the top group");
    assert.match(sidebar, /id: "documents",\s*label: "Documents",/);
    assert.match(sidebar, /id: "results",\s*label: "Results",/);
    assert.match(sidebar, /if \(setIsDocsOpen\) setIsDocsOpen\(!isDocsOpen\);/);
    assert.match(sidebar, /if \(setIsResultsOpen\) setIsResultsOpen\(!isResultsOpen\);/);
    assert.ok(!/Store Admin/.test(sidebar), "no Store Admin item: the Documents panel's footer opens the old tray");
    const menu = JSON.parse(read("src/data/sidebar_menu_def.json"));
    assert.ok(!menu.some((m) => m.label === "Store Admin"));
    assert.strictEqual(menu.find((m) => m.label === "Session Reset").tooltip, "Reset: clear the chat, or reset the demo environment");
    assert.match(sidebar, /\} else if \(item\.label === "Session Reset"\) \{\s*if \(setIsResetOpen\) setIsResetOpen\(!isResetOpen\);\s*else handleResetState\(\);/, "the icon opens the two-level menu");
    assert.match(sidebar, /\(item\.label === "Session Reset" && Boolean\(isResetOpen\)\)/);
    const icons = require("@remixicon/react");
    for (const name of ["RiSlideshow3Line", "RiBookOpenLine", "RiFileChartLine"]) assert.ok(["function", "object"].includes(typeof icons[name]), `${name} exists in the icon set`);
  });

  test("the route: the select action refuses an offline bridge, resets unless the definition says not to, then starts; state carries progress and the catalogue; the turn carries citedPassages", () => {
    assert.match(route, /import \{ stepStates, proposalView, windowOf \} from "@\/lib\/coding\/steps";/);
    assert.match(route, /case "select":\s*return NextResponse\.json\(await select\(scenario\)\);/);
    // S6 (2026-10-13): the presenter's Commit names its demo too.
    assert.match(route, /\["start", "select", "reset-scenario", "run-tests", "record", "results-shown", "doc-turn", "commit"\]/);
    assert.match(route, /if \(!health\) return \{ success: false, error: "Open the IDE panel: the bridge starts with it\.", code: "BRIDGE_OFFLINE" \};/);
    assert.match(route, /if \(scenario\.select && scenario\.select\.reset\) \{\s*reset = await resetScenario\(scenario\);/);
    assert.match(route, /appendRun\(\{ kind: "select", scenario: scenario\.id,/);
    assert.match(route, /for \(const sc of scenarios\) progress\[sc\.id\] = stepStates\(sc, events\);/);
    assert.match(route, /catalogue: p\.documents\.map\(\(source\) => \{/);
    assert.match(route, /return body\.light \? \{ \.\.\.c, talkTrack: undefined \} : c;/, "the light state carries no talk track");
    assert.match(turn, /citedPassages: passages\.filter\(\(p\) => check\.cited\.includes\(p\.marker\)\)/);
  });
  test("the bar's NEXT panel: one primary action from the server's next, dispatched by kind; the current change step's checklist; no stale last-run chip", () => {
    assert.match(bar, /data-next-action=\{next \? next\.action : "unknown"\}/);
    assert.match(bar, /data-next-button=\{next\.action\}/);
    // S3-D14 (b): the same dispatch by kind serves the next action and its alternative ("Record the failed attempt").
    assert.match(bar, /if \(a\.action === "ask" && step\) ask\(step\);\s*else if \(a\.action === "repair" && step\) ask\(step, \{ repair: true \}\);\s*else if \(a\.action === "apply"\) showChanges\(a\);\s*else if \(a\.action === "run-tests"\) runTests\(\);\s*else if \(a\.action === "record"\) recordChange\(\);\s*else if \(a\.action === "record-failed"\) recordFailedAttempt\(\);/);
    assert.match(bar, /const doNext = \(\) => doAction\(next\);/);
    assert.match(bar, /for \(const p of next\.pending \|\| \[\]\) results\.push\(await showProposalInIde\(\{ turnId: next\.turnId, path: p \}\)\);/);
    assert.match(bar, /data-checklist=\{nextStep\.id\}/);
    assert.ok(!/last: /.test(bar) && !/lastTests/.test(bar), "the all-time last-run chip is gone (it showed the previous day's red run)");
    assert.match(bar, /The output is in the IDE's NexCODE Tests panel\./);
  });

  test("the bar re-reads its states when a demo is selected and after each Apply; the page ticks on a successful Apply and passes the repair flag", () => {
    assert.match(bar, /useEffect\(\(\) => \{\s*if \(activeDemoId\) refresh\(\);\s*\}, \[activeDemoId, refresh\]\);/);
    assert.match(bar, /useEffect\(\(\) => \{\s*if \(workspaceTick > 0\) refresh\(\);\s*\}, \[workspaceTick, refresh\]\);/);
    assert.match(page, /const opened = Boolean\(result\?\.applied\?\.extensionResult\?\.success\);\s*setWorkspaceTick\(\(n\) => n \+ 1\);/);
    assert.match(page, /workspaceTick=\{workspaceTick\}/);
    // S4: a doc step also carries its mode and its chat settings (the lookup scope of its one /doc question).
    assert.match(page, /const repair = Boolean\(opts\.repair && step\.repair\);\s*setActiveScenarioStep\(\{ id: scenario\.id, stepId: step\.id, \.\.\.\(repair \? \{ repair: true \} : \{\}\), \.\.\.\(step\.mode === "doc" \? \{ mode: "doc", chat: step\.chat \|\| null \} : \{\}\) \}\);\s*setChatInput\(\(repair \? step\.repair\.prompt : step\.prompt\) \|\| ""\);/);
    assert.match(demo, /if \(r && r\.testTrace && typeof onRecordTrace === "function"\) onRecordTrace\(r\.testTrace\);/);
  });

  test("the chips: the proposed changes and the code locations are buttons that open them in the IDE; the live bubble shows no code", () => {
    assert.match(chips, /import \{ revealInIde, showProposalInIde \} from "@\/lib\/coding\/ide_client";/);
    assert.match(chips, /const r = await showProposalInIde\(\{ turnId: coding\.turnId, path: p\.path \}\);/);
    assert.match(chips, /const r = await revealInIde\(l\);/);
    assert.match(chips, /data-proposals=\{proposals\.length\}/);
    assert.match(chips, /data-locations=\{locations\.length\}/);
    // S4: the bubble streams with the turn's mode, so its text reads as the finished answer will.
    assert.match(chips, /\{streamingChatText\(liveTurn\.text, \{ mode: liveTurn\.mode \|\| "change" \}\)\}/);
    const client = codeOnly(read("src/lib/coding/ide_client.js"));
    assert.match(client, /return post\(\{ action: "reveal", path, startLine, endLine \}\);/);
    assert.match(client, /return post\(\{ action: "show-proposal", turnId, path \}\);/);
    assert.ok(!/content/.test(client), "the browser never sends a proposal's content: the server reads it from the run log");
  });

  test("the route: Select runs the tests once when the definition asks; show-proposal re-reads the answer from the run log; reveal is contained", () => {
    assert.match(route, /const selectCommand = scenario\.commands\.select \|\| scenario\.commands\.tests;\s*const tests = started\.success && scenario\.select && scenario\.select\.runTests && selectCommand \? await runTests\(scenario, selectCommand\) : null;/);
    assert.match(route, /testTrace: tests && tests\.trace \? tests\.trace : null,/);
    assert.match(route, /const turn = readRuns\(\{ limit: 5000, filter: \(e\) => e\.kind === "turn" && e\.turnId === turnId \}\)\.pop\(\);/);
    assert.match(route, /const op = parseFileOperations\(turn\.answer \|\| ""\)\.operations\.find\(\(o\) => o\.path === rel\);/);
    assert.match(route, /if \(!op \|\| turn\.mode === "explain"\) return/);
    assert.ok(!/body\.content/.test(route), "no proposal content is taken from the request");
    assert.match(route, /const rel = safeRelativePath\(body\.path\);/);
    assert.match(route, /if \(!fs\.existsSync\(resolveInside\(WORKSPACE_ROOT, rel\)\)\)/);
    assert.match(route, /case "show-proposal":\s*case "reveal": \{/);
    assert.match(route, /mode: st\.mode, repair: st\.repair/);
  });

  test("the turn: the step's mode shapes the request; an explain turn proposes nothing; the chat gets the answer without code; the change goes to the IDE", () => {
    // S4: a doc step that reaches the coding turn (its "/doc " removed) is answered as the audit question it is.
    assert.match(turn, /const mode = step && step\.mode \? \(step\.mode === "doc" \? "audit" : step\.mode\) : "change";/);
    assert.match(turn, /const repair = Boolean\(body\?\.scenario && body\.scenario\.repair === true && step && step\.repair\);/);
    // S5: a comments turn's units (a tool's list) sit between the files and the instruction, as measured.
    // S6 (2026-10-13): a Python comments or improve turn adds the facts for its AI disclosure after the units; S6-D9 (a): a
    // fix step's findings to fix come last before the instruction.
    // Polish Phase 2 (2026-10-14): the files block is composed once, named, so its size is kept with the turn (U-USAGE).
    assert.match(turn, /const filesContext = filesBlock\(attached, \{ numbered: mode === "explain" \|\| mode === "review" \}\);/);
    assert.match(turn, /filesContext, unitsContext, disclosureContext, testBlock, fixContext, `INSTRUCTION FOR THIS REQUEST\\n\$\{instruction\}`, `REQUEST\\n\$\{cleanMessage\}`/);
    // S6-D4 (a): an improve turn reads the latest test run too.
    assert.match(turn, /const testBlock = repair \|\| mode === "improve" \? latestTestRunBlock\(scenario\) : "";/);
    assert.match(turn, /emptyCut \? described\.userMessage : chatText\(mode === "review" \? stripFindingsBlock\(answer\) : answer, \{ mode \}\);/);
    assert.match(turn, /const proposesNothing = mode === "explain" \|\| mode === "review" \|\| mode === "audit";/);
    // S5-D14 (a): the proposals pass through the code-keeping step (comments turns only) before their diff counts.
    assert.match(turn, /const proposed = \(proposesNothing \? \[\] : parsedFiles\.operations\)\.map\(/);
    assert.match(turn, /const fileOperations = proposed\.map\(/);
    assert.match(turn, /const r = await bridgeAction\(\{ type: "showProposal", path: op\.path, content: op\.content, \.\.\.\(proposalView\(step, op\.path\) \|\| \{\}\) \}\);/);
    assert.match(turn, /const r = await bridgeAction\(\{ type: "openFile", path: loc\.path, line: loc\.startLine, endLine: loc\.endLine \}\);/);
    assert.match(turn, /if \(bridgeConnected && success && \(fileOperations\.length > 0 \|\| locations\.length > 0 \|\| \(review && review\.findings\.length > 0\)\)\)/);
    assert.match(turn, /const locations =\s*mode === "explain"\s*\? parseLocations\(/, "a location is trusted only from numbered lines");
    assert.match(turn, /if \(r\.error && \/not found\/\.test\(r\.error\)\) return \{ \.\.\.op, \.\.\.diffStat\(null, op\.content\) \};\s*return \{ \.\.\.op, added: null, removed: null, isNew: false \};/);
    assert.match(chips, /\{Number\.isFinite\(p\.added\) && Number\.isFinite\(p\.removed\) && \(/, "unknown counts are not printed");
    assert.match(turn, /mode,\s*repair,\s*proposals: fileOperations\.map\(\(o\) => \(\{ path: o\.path, added: o\.added, removed: o\.removed, isNew: o\.isNew \}\)\),/);
    assert.match(turn, /answer,\s*reasoning:/, "the run log keeps the full answer (show-proposal re-reads it)");
  });

  test("the extension: showProposal contains its path first; the proposal view is registered at activation behind a guard; the scenario's tests print in the IDE; still no shell", () => {
    const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));
    assert.match(ext, /case "showProposal": \{\s*const fullPath = resolveInWorkspace\(action\.path\);/);
    assert.match(ext, /context\.subscriptions\.push\(statusBar\);\s*registerProposalView\(context\);/);
    assert.match(ext, /if \(!vscode\.workspace \|\| typeof vscode\.workspace\.registerTextDocumentContentProvider !== "function"\) return;/);
    assert.match(ext, /"s1-tests": \{ exec: \{[^\n]*\}, showOutput: true \},/);
    assert.match(ext, /if \(entry\.exec && entry\.showOutput\) showCommandOutput\(entry, result\);/);
    assert.ok(!/exec\(|execSync|shell: true/.test(ext), "no shell anywhere");
    assert.ok(ext.indexOf('req.url === "/api/action"') > ext.indexOf("if (!authorised(req))"), "behind the gate");
  });

  test("the reset menu: two levels; the hard reset needs RESET typed and the bridge; it lists what it keeps; no dialog confirm", () => {
    const menuSrc = codeOnly(read("src/components/presenter/ResetMenu.jsx"));
    assert.match(menuSrc, /data-reset-action="chat"/);
    assert.match(menuSrc, /data-reset-action="environment"/);
    assert.match(menuSrc, /const typedOk = typed\.trim\(\)\.toUpperCase\(\) === "RESET";/);
    assert.match(menuSrc, /disabled=\{!typedOk \|\| bridgeUp !== true \|\| busy\}/);
    assert.match(menuSrc, /const r = await post\(\{ action: "reset-all" \}\);/);
    for (const kept of ["The documents and the vector store: nothing is re-ingested", "The admin settings and the model endpoints", "The run log&apos;s history: a reset marker restarts every demo at step 1"]) assert.ok(menuSrc.includes(kept), kept);
    assert.ok(!/confirm\(/.test(menuSrc), "U-DESTRUCT/E38: the confirmation is typed");
    assert.ok(!/\/api\/(ingest|rag)/.test(menuSrc), "the reset never calls the store's routes");
  });

  test("the page: the environment reset clears the chat, deselects the demo and returns the presenter controls to their defaults; Clear the chat is Session Reset's old action", () => {
    assert.match(page, /<ResetMenu\s/);
    assert.match(page, /onClearChat=\{\(\) => \{\s*handleResetState\(\);\s*setIsResetOpen\(false\);\s*\}\}/);
    assert.match(page, /onEnvironmentReset=\{\(\) => \{\s*handleResetState\(\);\s*setActiveScenarioStep\(null\);\s*setActiveDemoId\(null\);\s*setDemoRequest\(null\);\s*setIsDemoOpen\(false\);\s*setIsDocsOpen\(false\);\s*setIsResultsOpen\(false\);\s*setThinkingMode\("on"\);\s*setDocumentScopeSelection\(""\);\s*setLiveTurn\(null\);\s*setWorkspaceTick\(\(n\) => n \+ 1\);\s*setIsDemoSelectOpen\(false\);\s*\}\}/);
    assert.match(page, /isResetOpen=\{isResetOpen\}\s*setIsResetOpen=\{setIsResetOpen\}/);
  });

  test("the route and the extension: the hard reset leaves a reset-all marker named environment; seed-reset clears the IDE; nothing touches the store", () => {
    assert.match(route, /appendRun\(\{ kind: "reset-all", scope: "environment",/);
    assert.match(route, /title: "Demo Environment Reset",/);
    const resetFn = route.slice(route.indexOf("async function resetAll()"), route.indexOf("async function resetScenario("));
    assert.ok(resetFn.length > 100 && !/\/api\/(ingest|rag)|weaviate/i.test(resetFn), "the environment reset never reaches the store");
    const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));
    assert.match(ext, /await closeEditors\(\);\s*const ide = await ideCleanup\(\);/);
    assert.match(ext, /for \(const id of \["workbench\.action\.terminal\.killAll", "workbench\.action\.closePanel"\]\)/);
    assert.match(ext, /proposals\.clear\(\);/);
    assert.match(ext, /if \(await ideCommand\("workbench\.view\.explorer"\)\) ide\.commands\.push\("workbench\.view\.explorer"\);/);
  });
});

describe("U-PRESENTER/PR B: the Results panel and the Documents panel (the owner's D1-D7 of 2026-10-07)", () => {
  const { fileDiff, diffText, editScript } = require("../../src/lib/coding/diff");
  const { buildEvidenceRecord, RECORD_SCHEMA } = require("../../src/lib/coding/record");
  const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
  const results = codeOnly(read("src/components/presenter/ResultsPanel.jsx"));
  const report = codeOnly(read("src/components/presenter/RecordReport.jsx"));
  const docsPanel = codeOnly(read("src/components/presenter/DocumentsPanel.jsx"));
  const viewer = codeOnly(read("src/components/presenter/DocumentViewer.jsx"));
  const chips = codeOnly(read("src/components/CodingLiveTurn.jsx"));
  const bar = codeOnly(read("src/components/StepBar.jsx"));
  const page = codeOnly(read("src/app/page.js"));

  test("diff.js: hunks with git's numbering and three lines of context; a new file, a deleted file, an equal pair, a pair too large", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n";
    const after = "a\nb\nC\nd\ne\nf\ng\nh\ni\nj\nk\nl\n";
    const fd = fileDiff("x.py", before, after);
    assert.deepStrictEqual([fd.status, fd.added, fd.removed, fd.tooLarge], ["modified", 2, 1, false]);
    assert.deepStrictEqual(fd.hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines]), [[1, 6, 1, 6], [9, 3, 9, 4]]);
    assert.deepStrictEqual(fd.hunks[0].lines.filter((l) => l.type !== " ").map((l) => [l.type, l.text, l.oldNo, l.newNo]), [["-", "c", 3, null], ["+", "C", null, 3]]);
    const text = diffText(fd);
    assert.match(text, /^--- a\/x\.py\n\+\+\+ b\/x\.py\n@@ -1,6 \+1,6 @@\n a\n b\n-c\n\+C\n/);
    assert.match(text, /@@ -9,3 \+9,4 @@\n i\n j\n k\n\+l$/);
    const added = fileDiff("n.py", null, "x\ny\n");
    assert.deepStrictEqual([added.status, added.added, added.hunks[0].oldStart, added.hunks[0].oldLines, added.hunks[0].newLines], ["added", 2, 0, 0, 2]);
    assert.match(diffText(added), /^--- \/dev\/null\n\+\+\+ b\/n\.py/);
    assert.deepStrictEqual([fileDiff("d.py", "x\n", null).status, fileDiff("d.py", "x\n", null).removed], ["deleted", 1]);
    assert.strictEqual(fileDiff("same.py", "a\n", "a\n"), null);
    const big = Array.from({ length: 2100 }, (_, i) => `l${i}`).join("\n");
    const huge = fileDiff("big.py", big, `${big}\nmore`);
    assert.deepStrictEqual([huge.tooLarge, huge.added, huge.hunks.length], [true, null, 0]);
    assert.strictEqual(editScript(["a"], ["a"]).length, 1);
  });

  test("the record: each cited rule quotes its passage; the code change rides in changes.files and in the Markdown as diff blocks; schema 0.3", () => {
    const s1def = loadScenarios().find((s) => s.id === "s1");
    const events = [
      {
        kind: "turn", scenario: "s1", step: "fix", turnId: "t1", at: at(1), prompt: "Fix it", model: "m", thinking: { mode: "on" }, tokens: { prompt: 1, completion: 2, providerReported: true }, timing: { wallMs: 3 },
        attached: [], layers: [], passages: [{ marker: "REG-1", pillar: "regulator", source: "FCA_SYSC_June2026.pdf", page: 2, sectionPath: null }],
        citedPassages: [{ marker: "REG-1", pillar: "regulator", source: "FCA_SYSC_June2026.pdf", page: 2, sectionPath: null, text: "A firm must take reasonable care to establish and maintain such systems and controls as are appropriate to its business." }],
        cited: ["REG-1"], unverified: [], fileOperations: [RECON], success: true,
      },
      { kind: "apply", path: RECON, ok: true, at: at(2) },
      { kind: "test-run", scenario: "s1", command: "s1-tests", exitCode: 0, summary: "5 passed", excerpt: "OK", at: at(3) },
    ];
    const files = [fileDiff(RECON, "x = float(f)\n", "x = Decimal(f)\n")];
    const { json, markdown } = buildEvidenceRecord({ scenario: s1def, events, changes: { available: true, gitDiffStat: " a | 2 +-", gitStatus: " M a", files }, platform: {}, firm: "Nexus Bank plc", recordId: "abcd1234", now: new Date(at(4)) });
    assert.strictEqual(RECORD_SCHEMA, "nexcode.evidence/0.12");
    assert.strictEqual(json.kind, "change", "S1 changes code");
    assert.strictEqual(json.rules[0].via, "search", "a searched passage says so");
    assert.deepStrictEqual(json.rules[0].tracedFrom, []);
    assert.match(markdown, /\| Layer \| Marker \| Source \| Location \| How found \| Turn \|/);
    assert.strictEqual(json.review, null, "S1 has no review");
    assert.match(markdown, /## Verification\n\nNo pre-merge checks ran in this demo/);
    assert.match(json.rules[0].text, /^A firm must take reasonable care/);
    assert.strictEqual(json.changes.files[0].path, RECON);
    assert.match(markdown, /> \*\*REG-1\*\* FCA_SYSC_June2026\.pdf, page 2: A firm must take reasonable care/);
    assert.match(markdown, /## The code change\n\n### nexus-payments\/services\/settlement\/settlement_reconciler\.py \(modified, \+1 -1\)\n\n```diff\n--- a\//);
    assert.match(markdown, /-x = float\(f\)\n\+x = Decimal\(f\)/);
  });

  test("after Record the next action shows the results; the bar and the record chip open the Results panel on the presenter's click", () => {
    const p = stepStates(s1, [TURN("diagnose", 1), FIX(3), APPLY(4, RECON), APPLY(5, TESTF), TESTS(6, 0), RECORD(7)]);
    assert.deepStrictEqual([p.next.action, p.next.label], ["results", "Show the results"]);
    assert.match(bar, /else if \(a\.action === "results"\) presenter\.openResults\(\{ scenarioId: scenario\.id \}\);/);
    assert.match(bar, /coding: \{ kind: "record", recordId: r\.recordId, scenarioId: scenario\.id \},/);
    assert.match(chips, /if \(coding\.kind === "record"\) \{[\s\S]{0,700}?presenter\.openResults\(\{ recordId: coding\.recordId \|\| null, scenarioId: coding\.scenarioId \|\| null \}\)/);
    assert.match(page, /onNote=\{\(text, extra\) => setChatHistory\(\(prev\) => \[\.\.\.prev, \{ sender: "ai", text, timestamp: formatTime\(\), \.\.\.\(extra && typeof extra === "object" \? extra : \{\}\) \}\]\)\}/);
    // S4-D2 (a): the closer asks for every demo's records (scope "all"); still opened only by the presenter's click.
    assert.match(page, /openResults: \(\{ recordId = null, scenarioId = null, scope = null \} = \{\}\) => \{\s*setResultsRequest\(\{ recordId, scenarioId: scenarioId \|\| activeDemoId, scope: scope === "all" \? "all" : null, nonce: Date\.now\(\) \}\);/);
  });

  test("the route: Record diffs every applied file against the seed and archives the record beside the run log; four read-only actions, each contained", () => {
    assert.match(route, /const RECORDS_ARCHIVE = path\.join\(process\.cwd\(\), "nexcode-data", "state", "coding", "records"\);/);
    assert.match(route, /changes\.files = codeChanges\(eventsSinceReset\(events, scenario\.id\)\);/);
    assert.match(route, /fs\.writeFileSync\(path\.join\(RECORDS_ARCHIVE, name\), content, "utf8"\);/);
    // S4-D4 (a): the line also says whether the record keeps a change or an answer.
    assert.match(route, /appendRun\(\{ kind: "record", scenario: scenario\.id, recordId, paths, wroteVia, archived, archiveError, outcome: failure \? "failed" : "ready", recordKind: json\.kind \}\);/);
    assert.match(route, /case "records":\s*case "record-read":\s*case "outputs":\s*case "output-read": \{/);
    assert.match(route, /if \(!\/\^\[0-9a-f\]\{8\}\$\/\.test\(id\)\) return \{ success: false, error: "a record id is required", status: 400 \};/);
    assert.match(route, /if \(!rel \|\| !rel\.startsWith\(`\$\{OUTPUTS_DIR\}\/`\) \|\| !\/\\\.\(md\|json\)\$\/i\.test\(rel\)\)/);
    assert.match(route, /const r = readText\(resolveInside\(WORKSPACE_ROOT, rel\)\);/);
    assert.match(route, /materials: \(s\.card && s\.card\.artefacts \? s\.card\.artefacts\.code : \[\]\)/);
  });

  test("the environment reset touches nothing without the bridge, then clears every workspace-root entry but the seed repository and dot entries", () => {
    const fn = route.slice(route.indexOf("async function resetAll()"), route.indexOf("async function resetScenario("));
    const bridgeAt = fn.indexOf("if (!(await getBridgeHealth())) return");
    const strayAt = fn.indexOf("fs.rmSync(resolveInside(WORKSPACE_ROOT, name)");
    const stageAt = fn.indexOf("fs.cpSync(SEED_SOURCE, SEED_STAGE");
    assert.ok(bridgeAt > 0 && strayAt > bridgeAt && stageAt > strayAt, "the bridge check comes first, then the stray clean-up, then the seed");
    assert.match(fn, /if \(name === SEED_REPO \|\| name\.startsWith\("\."\)\) continue;/);
    assert.match(fn, /strayRemoved, strayError,/);
    assert.match(codeOnly(read("src/components/presenter/ResetMenu.jsx")), /any other file in the workspace removed/);
  });

  test("the Results panel: Report, Code change and As filed for a record; Markdown and JSON outputs through the same viewers; opened only by the presenter", () => {
    assert.match(results, /className="fixed top-20 left-20 right-0 bottom-0 z-50/);
    // S4: an answer record changes no code, so it has no Code change tab.
    assert.match(results, /\{tabButton\("report", "Report", RiFileShield2Line\)\}\s*\{record\.kind !== "answer" && tabButton\("code", "Code change", RiBracesLine\)\}\s*\{tabButton\("filed", "As filed", RiArticleLine\)\}/);
    assert.match(results, /<RecordReport record=\{record\} onShowCode=\{\(\) => setTab\("code"\)\} onOpenPassage=\{openPassage\} onOpenInIde=\{openInIde\} \/>/);
    assert.match(results, /<DiffView files=\{record\.changes && Array\.isArray\(record\.changes\.files\) \? record\.changes\.files : \[\]\} onOpenInIde=\{openInIde\} \/>/);
    assert.match(results, /doc\.markdown \? \(\s*<MarkdownBlocks text=\{doc\.markdown\} \/>/);
    assert.match(results, /return <JsonView value=\{JSON\.parse\(doc\.text\)\} \/>;/);
    assert.match(results, /action: "records"/);
    assert.match(results, /action: "record-read", id: selected\.id/);
    assert.match(results, /if \(e\.key === "Escape" && typeof onClose === "function"\) onClose\(\);/);
    assert.match(report, /Built by NexCODE from its own run log: no model wrote this record\. A person approves it\./);
    assert.match(report, /<Tile icon=\{RiTestTubeLine\} label="Tests"/);
    assert.match(report, /Open at the page/);
    assert.ok(!/dangerouslySetInnerHTML/.test(results + report + codeOnly(read("src/components/presenter/DiffView.jsx")) + codeOnly(read("src/components/presenter/JsonView.jsx"))), "every value is text");
  });

  test("the Documents panel: the shared viewer with the demo's materials first and why each document matters; the whole store with no demo; the old tray behind Store admin", () => {
    assert.match(docsPanel, /const NO_PASSAGES = \[\];/);
    assert.match(docsPanel, /<DocumentViewer key=\{scenario \? scenario\.id : "all"\} layers=\{layers\} demoSources=\{demoSources\} passages=\{NO_PASSAGES\} roles=\{roles\} defaultShowAll=\{!scenario\} \/>/);
    assert.match(docsPanel, /id: "materials",\s*label: "Demo materials",/);
    assert.match(docsPanel, /onClick=\{\(\) => typeof onStoreAdmin === "function" && onStoreAdmin\(\)\}/);
    assert.match(page, /onStoreAdmin=\{\(\) => \{\s*setIsDocsOpen\(false\);\s*setIsStandardsOpen\(true\);\s*\}\}/);
    assert.match(viewer, /const rows = showAll \|\| isMaterials \? catalogue : catalogue\.filter\(\(d\) => used\.has\(d\.source\)\);/);
    assert.match(viewer, /\{roles && roles\[d\.source\] \? <span className="text-\[11px\] text-neutrals-medium leading-snug whitespace-normal">\{roles\[d\.source\]\}<\/span> : null\}/);
    assert.match(viewer, /const \[showAll, setShowAll\] = useState\(defaultShowAll\);/);
    assert.match(page, /<ResultsPanel open=\{isResultsOpen\} request=\{resultsRequest\} activeDemoId=\{activeDemoId\} onClose=\{\(\) => setIsResultsOpen\(false\)\} \/>/);
    assert.match(page, /<DocumentsPanel\s/);
  });
});
