/**
 * U-USAGE — polish Phase 2, token tracking (inputs/demo-design/polish-design.md; the owner's PL-D7 to PL-D9 and
 * PL-D13 (a) of 2026-10-14): every model answer's tokens in the run log (coding turns, S4's doc-turn, a free-form
 * document chat's chat-turn); the pure module sums them per step, per demo and per session since the last environment
 * reset, with the TOTAL, and apportions the coding turns' tokens by character share; the Stats panel and the evidence
 * record (schema 0.11) read it; the Demo panel shows one demo and offers "Choose another demo".
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const U = require("../../src/lib/coding/usage");
const REC = require("../../src/lib/coding/record");
const { loadScenarios } = require("../../src/lib/coding/scenarios");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const at = (n) => `2026-10-14T10:${String(n).padStart(2, "0")}:00.000Z`;
const tokens = (prompt, completion, providerReported = true) => ({ prompt, completion, providerReported });
const composition = { system: 100, history: 0, evidence: 300, review: 0, layout: 0, files: 500, units: 0, disclosure: 0, tests: 0, fix: 0, instruction: 50, request: 50 };
const turn = (n, scenario, step, t, extra = {}) => ({ kind: "turn", at: at(n), scenario, step, turnId: `t${n}`, success: true, model: "qwen3.8:27b", tokens: t, ...extra });
const s6 = () => loadScenarios().find((s) => s.id === "s6");

describe("U-USAGE: the pure module", () => {
  test("the session is everything since the last environment reset; Clear the chat writes no line, so it leaves the figures", () => {
    const events = [turn(1, null, null, tokens(10, 1)), { kind: "reset-all", at: at(2) }, turn(3, "s1", "diagnose", tokens(100, 10)), { kind: "test-run", at: at(4) }];
    const s = U.sessionEvents(events);
    assert.deepStrictEqual([s.since, s.events.length, s.events[0].at], [at(2), 2, at(3)]);
    assert.deepStrictEqual(U.sessionEvents([turn(1, null, null, tokens(10, 1))]).since, null, "no reset yet: from the beginning");
  });

  test("an answer is a coding turn, a doc-turn or a chat-turn; tokens the server did not report are marked, a missing figure is kept as missing", () => {
    const a = U.answerOf(turn(1, "s6", "build", tokens(1000, 200), { repair: true, composition, thinking: { mode: "on", reasoningChars: 300 }, answerChars: 100 }));
    assert.deepStrictEqual([a.kind, a.scenario, a.step, a.repair, a.tokens, a.reasoningChars, a.answerChars, a.composition === composition], ["turn", "s6", "build", true, { prompt: 1000, completion: 200, reported: true }, 300, 100, true]);
    assert.deepStrictEqual(U.answerOf({ kind: "doc-turn", at: at(2), scenario: "s4", step: "doc", success: true }).tokens, null, "S4's line before Phase 2 carried no tokens");
    assert.deepStrictEqual(U.answerOf({ kind: "chat-turn", at: at(3), scenario: null, tokens: tokens(50, 5, false) }).tokens, { prompt: 50, completion: 5, reported: false });
    assert.strictEqual(U.answerOf({ kind: "test-run", at: at(4), scenario: "s6" }), null);
    assert.strictEqual(U.answerOf({ kind: "apply", at: at(5) }), null);
  });

  test("a sum keeps the answers, the counted, the estimated and the uncounted, and the TOTAL", () => {
    const list = [turn(1, "s1", "a", tokens(100, 10)), turn(2, "s1", "a", tokens(200, 20, false)), { kind: "doc-turn", at: at(3), scenario: "s1" }].map(U.answerOf);
    // Phase 3: the tokens by model too, so each model is costed at its own price (U-PRICING).
    assert.deepStrictEqual(U.sumTokens(list), { answers: 3, counted: 2, prompt: 300, completion: 30, total: 330, estimated: 1, uncounted: 1, byModel: { "qwen3.8:27b": { answers: 2, prompt: 300, completion: 30 } } });
    assert.deepStrictEqual(U.sumTokens([]), { answers: 0, counted: 0, prompt: 0, completion: 0, total: 0, estimated: 0, uncounted: 0, byModel: {} });
  });

  test("PL-D13 (a): the split apportions a coding turn's tokens by the character share of each part, and the thinking against the answer", () => {
    const list = [turn(1, "s6", "build", tokens(1000, 200), { composition, thinking: { mode: "on", reasoningChars: 300 }, answerChars: 100 }), { kind: "chat-turn", at: at(2), scenario: "s6", tokens: tokens(999, 999) }].map(U.answerOf);
    const sp = U.splitOf(list);
    assert.strictEqual(sp.basis, "character share");
    assert.strictEqual(sp.answers, 1, "a document chat answer has no composition: not split");
    assert.deepStrictEqual(
      sp.input.map((g) => [g.id, g.tokens, g.share]),
      [
        ["message", 50, 5],
        ["rules", 300, 30],
        ["code", 500, 50],
        ["history", 0, 0],
        ["instructions", 150, 15],
      ]
    );
    assert.deepStrictEqual(
      sp.output.map((g) => [g.id, g.tokens, g.share]),
      [
        ["thinking", 150, 75],
        ["answer", 50, 25],
      ]
    );
    assert.deepStrictEqual(U.splitOf([]).answers, 0);
    const noOut = U.splitOf([U.answerOf(turn(3, "s6", "build", tokens(10, 5), { composition, thinking: { mode: "off", reasoningChars: 0 }, answerChars: 0 }))]);
    assert.deepStrictEqual(noOut.output.map((g) => g.tokens), [0, 0], "no answer text and no thinking: nothing is invented");
  });

  test("a demo's usage: its current run only, a row per step in the definition's order with repairs inside, a free-form row, the totals and the split", () => {
    const events = [
      turn(1, "s6", "build", tokens(9999, 9999)),
      { kind: "select", scenario: "s6", at: at(2) },
      turn(3, "s6", "build", tokens(1000, 200), { composition, thinking: { mode: "on", reasoningChars: 300 }, answerChars: 100 }),
      turn(4, "s6", "build", tokens(800, 100), { repair: true, composition, thinking: { mode: "on", reasoningChars: 0 }, answerChars: 50 }),
      turn(5, "s1", "diagnose", tokens(5, 5)),
      { kind: "chat-turn", at: at(6), scenario: "s6", step: null, tokens: tokens(300, 20) },
      turn(7, "s6", "comment", tokens(500, 50, false)),
      { kind: "apply", at: at(8), path: "x" },
    ];
    const u = U.demoUsage(events, s6());
    assert.deepStrictEqual([u.id, u.title], ["s6", s6().title]);
    assert.deepStrictEqual(
      u.steps.map((st) => [st.id, st.title, st.answers, st.repairs, st.prompt, st.completion, st.total, st.estimated]),
      [
        ["build", "Build it", 2, 1, 1800, 300, 2100, 0],
        ["comment", "Comment it", 1, 0, 500, 50, 550, 1],
      ]
    );
    assert.deepStrictEqual([u.freeForm.answers, u.freeForm.total], [1, 320]);
    assert.deepStrictEqual([u.totals.answers, u.totals.prompt, u.totals.completion, u.totals.total, u.totals.estimated], [4, 2600, 370, 2970, 1]);
    assert.strictEqual(u.split.answers, 2, "the two coding turns with a composition");
    assert.strictEqual(U.demoUsage(events, null), null);
  });

  test("the session summary: its totals, its demos, its free-form answers and the active demo", () => {
    const events = [
      turn(1, "s1", "diagnose", tokens(9999, 9999)),
      { kind: "reset-all", at: at(2) },
      { kind: "select", scenario: "s1", at: at(3) },
      turn(4, "s1", "diagnose", tokens(100, 10)),
      { kind: "chat-turn", at: at(5), scenario: null, tokens: tokens(40, 4) },
      { kind: "select", scenario: "s4", at: at(6) },
      { kind: "doc-turn", at: at(7), scenario: "s4", step: "doc", tokens: tokens(200, 20), model: "qwen3.8:27b" },
      turn(8, "s4", "money", tokens(300, 30)),
    ];
    const u = U.usageSummary(events, { scenarioId: "s4", scenarios: loadScenarios() });
    assert.strictEqual(u.since, at(2));
    assert.deepStrictEqual([u.session.answers, u.session.prompt, u.session.completion, u.session.total], [4, 640, 64, 704]);
    assert.deepStrictEqual(
      u.session.demos.map((d) => [d.id, d.answers, d.total]),
      [
        ["s1", 1, 110],
        ["s4", 2, 550],
      ]
    );
    assert.deepStrictEqual([u.session.freeForm.answers, u.session.freeForm.total], [1, 44]);
    const order = loadScenarios().find((s) => s.id === "s4").steps.map((st) => st.id).filter((id) => ["money", "doc"].includes(id));
    assert.deepStrictEqual(
      u.demo.steps.map((st) => [st.id, st.answers, st.total]),
      order.map((id) => (id === "money" ? ["money", 1, 330] : ["doc", 1, 220])),
      "the definition's order"
    );
    assert.strictEqual(U.usageSummary(events, { scenarioId: null }).demo, null);
    assert.strictEqual(U.usageSummary(events, { scenarioId: "s9" }).demo.id, "s9", "an unknown demo id still answers, with no steps");
  });
});

describe("U-USAGE: the record (schema 0.11), the turn, the route, the page, the Stats panel, the report and the Demo panel", () => {
  const turnSrc = codeOnly(read("src/lib/coding/turn.js"));
  const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
  const page = codeOnly(read("src/app/page.js"));
  const stats = codeOnly(read("src/components/StatsDrawer.jsx"));
  const report = codeOnly(read("src/components/presenter/RecordReport.jsx"));
  const panel = codeOnly(read("src/components/presenter/DemoPanel.jsx"));

  test("the record carries the demo's usage and prints a Tokens table with the total and the split", () => {
    const events = [
      { kind: "select", scenario: "s6", at: at(0) },
      turn(1, "s6", "build", tokens(1000, 200), { composition, thinking: { mode: "on", reasoningChars: 300 }, answerChars: 100, fileOperations: [], cited: [], unverified: [] }),
      turn(2, "s6", "comment", tokens(500, 50, false), { fileOperations: [], cited: [], unverified: [] }),
    ];
    const { json, markdown } = REC.buildEvidenceRecord({ scenario: s6(), events, recordId: "0a1b2c3d", now: new Date(at(30)) });
    assert.strictEqual(json.schema, "nexcode.evidence/0.12");
    assert.deepStrictEqual(json.usage.steps.map((st) => [st.id, st.total]), [
      ["build", 1200],
      ["comment", 550],
    ]);
    assert.deepStrictEqual([json.usage.totals.total, json.usage.totals.estimated, json.usage.split.answers, json.usage.split.basis], [1750, 1, 1, "character share"]);
    // Phase 3: a Cost column (no price table here: "no price set"); U-PRICING tests the priced record.
    assert.match(markdown, /## Tokens\n\n\| Step \| Answers \| Tokens in \| Tokens out \| Total \| Cost \|\n\|---\|---\|---\|---\|---\|---\|\n\| Build it \| 1 \| 1000 \| 200 \| 1200 \| no price set \|\n\| Comment it \| 1 \(1 estimated by the app\) \| 500 \| 50 \| 550 \| no price set \|\n\| \*\*Total\*\* \| 2 \(1 estimated by the app\) \| \*\*1500\*\* \| \*\*250\*\* \| \*\*1750\*\* \| \*\*no price set\*\* \|/);
    assert.match(markdown, /- Input: your message 50 \(5%\); rules and documents 300 \(30%\); code and files 500 \(50%\); chat history 0 \(0%\); instructions 150 \(15%\)\.\n- Output: thinking 150 \(75%\); answer 50 \(25%\)\./);
    assert.ok(markdown.indexOf("## Tokens") < markdown.indexOf("## Turns"), "before the turns");
    const none = REC.buildEvidenceRecord({ scenario: s6(), events: [{ kind: "select", scenario: "s6", at: at(0) }], recordId: "0a1b2c3d", now: new Date(at(30)) });
    assert.match(none.markdown, /## Tokens\n\nNo answer was recorded for this demo since it was selected\./);
  });

  test("the turn keeps the prompt's part sizes and the answer's size with its tokens", () => {
    assert.match(turnSrc, /const filesContext = filesBlock\(attached, \{ numbered: mode === "explain" \|\| mode === "review" \}\);/);
    assert.match(turnSrc, /const composition = \{\s*system: system\.length,\s*history: replay\.reduce\(\(n, m\) => n \+ String\(m\.content \|\| ""\)\.length, 0\),\s*evidence: evidence\.length,\s*review: reviewContext\.length,\s*layout: layoutContext\.length,\s*files: filesContext\.length,\s*units: unitsContext\.length,\s*disclosure: disclosureContext\.length,\s*tests: testBlock\.length,\s*fix: fixContext\.length,\s*instruction: `INSTRUCTION FOR THIS REQUEST\\n\$\{instruction\}`\.length,\s*request: `REQUEST\\n\$\{cleanMessage\}`\.length,\s*\};/);
    assert.match(turnSrc, /tokens: \{ prompt: tokenTelemetry\.prompt_tokens, completion: tokenTelemetry\.completion_tokens, providerReported: reported \},\s*composition,\s*answerChars: answer\.length,/);
    for (const g of U.INPUT_GROUPS) for (const p of g.parts) assert.ok(new RegExp(`\\b${p}: `).test(turnSrc), `${p} is a part the turn measures`);
  });

  test("the route logs tokens on a doc-turn, logs a chat-turn with the active demo or none, and answers usage from the run log", () => {
    assert.match(route, /import \{ usageSummary, ANSWER_KINDS \} from "@\/lib\/coding\/usage";/);
    assert.match(route, /const tokensOf = \(t\) => \(t && typeof t === "object" && \(num\(t\.prompt\) !== null \|\| num\(t\.completion\) !== null\) \? \{ prompt: num\(t\.prompt\), completion: num\(t\.completion\), providerReported: t\.providerReported === true \} : null\);/);
    assert.match(route, /kind: "doc-turn",[\s\S]*?model: modelOf\(body\.model\),\s*tokens: tokensOf\(body\.tokens\),/);
    assert.match(route, /function chatTurn\(scenario, body\) \{\s*appendRun\(\{\s*kind: "chat-turn",\s*scenario: scenario \? scenario\.id : null,\s*step: null,/);
    assert.match(route, /case "chat-turn":\s*return NextResponse\.json\(chatTurn\(scenario, body\)\);\s*case "usage":\s*return NextResponse\.json\(usageOf\(scenario, scenarios\)\);/);
    // Phase 3: the summary is costed at the stored prices on its way out (U-PRICING).
    assert.match(route, /return priceUsage\(usageSummary\(readRuns\(\{ limit: 5000 \}\), \{ scenarioId: scenario \? scenario\.id : null, scenarios \}\), readPricing\(\)\);/);
    assert.ok(!/\["start", "select", "reset-scenario", "run-tests", "record", "results-shown", "doc-turn", "commit"[^\]]*"usage"/.test(route), "usage and chat-turn take no demo, or the active one");
  });

  test("the page sends the model and the tokens with S4's doc-turn, logs every other document chat answer as a chat-turn, and refreshes the Stats panel after each answer", () => {
    assert.match(page, /action: "doc-turn", scenarioId: docStep\.id, stepId: docStep\.stepId,[^\n]*clientMs, model: data\.router && data\.router\.model \? data\.router\.model : null, tokens: data\.timing && data\.timing\.tokens \? data\.timing\.tokens : null \}\),/);
    assert.match(page, /\} else \{\s*fetch\("\/api\/ide-bridge\/scenarios", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(\{ action: "chat-turn", scenarioId: activeDemoId \|\| undefined,[^\n]*tokens: data\.timing && data\.timing\.tokens \? data\.timing\.tokens : null \}\),/);
    assert.match(page, /servedModel=\{lastRouterModel\}\s*activeDemoId=\{activeDemoId\}\s*refreshKey=\{sessionTimings\.length\}/);
    assert.match(page, /onChooseDemo=\{\(\) => \{\s*setIsDemoOpen\(false\);\s*setIsDemoSelectOpen\(true\);\s*\}\}/);
  });

  test("the Stats panel reads the run log's usage and prints the module's figures: the session, the demo's steps with the total, the split; the cost card (Phase 3)", () => {
    assert.match(stats, /body: JSON\.stringify\(\{ action: "usage", scenarioId: activeDemoId \|\| undefined \}\)/);
    assert.match(stats, /\}, \[isOpen, activeDemoId, refreshKey\]\);/, "read on open and after each answer");
    assert.match(stats, /session = null, servedModel = null, activeDemoId = null, refreshKey = 0/);
    for (const s of ["Session Tokens", "This demo · ", "Demo total", "Session since the last environment reset", "Session total", "Where the tokens went", "apportioned by \\{split\\.basis\\}", "Session Cost", "An apportionment, not a count"]) assert.ok(new RegExp(s).test(stats), s);
    assert.match(stats, /data-stats-step=\{st\.id\}/);
    assert.match(stats, /data-stats-demo-total=\{demo\.totals\.total\}/);
    assert.ok(!/\* 0\.\d|\/ 1000|toFixed\(1\)/.test(stats.replace(/cumulativeCost\.toFixed\(4\)/, "")), "no local arithmetic on the figures: the module's shares and sums are printed as given");
  });

  test("the report prints the Tokens section from the record's usage; the Demo panel shows one demo and offers Choose another demo", () => {
    assert.match(report, /record\.usage && record\.usage\.totals && record\.usage\.totals\.answers > 0 && \(/);
    assert.match(report, /data-report-usage=\{record\.usage\.totals\.total\}/);
    assert.match(report, /data-report-usage-step=\{st\.id\}/);
    assert.match(report, /apportioned by \{record\.usage\.split\.basis\}/);
    assert.ok(!/scenarios\.map\(\(s\) => \(\s*<button/.test(panel), "the demo tabs are gone");
    assert.match(panel, /data-demo-panel-demo=\{scenario\.id\}/);
    assert.match(panel, /onClick=\{\(\) => typeof onChooseDemo === "function" && onChooseDemo\(\)\}/);
    assert.match(panel, /data-choose-demo/);
    assert.match(panel, /onClose, onChooseDemo, onSelected, onRecordTrace \}\) \{/);
  });
});
