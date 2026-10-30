/**
 * U-FAILED-ATTEMPT — S3-D14 (b) of 2026-10-12: when NexCODE gets it wrong and the tests fail, the presenter can still end
 * the demo in a known state. Beside "Ask NexCODE to fix the failing tests", the step bar offers "Record the failed
 * attempt": an evidence record that says the change failed its tests and is not ready for review (no approval is asked
 * for). Such a record never completes the demo's record step; a repair that turns the tests green carries on as before.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { loadScenarios } = require("../../src/lib/coding/scenarios");
const { stepStates } = require("../../src/lib/coding/steps");
const { buildEvidenceRecord, RECORD_SCHEMA } = require("../../src/lib/coding/record");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const s3 = loadScenarios().find((s) => s.id === "s3");
const PORT = "nexus-payments/services/clearing/src/main/java/com/nexusbank/clearing/ClearingBatch.java";
const TEST = "nexus-payments/services/clearing/src/test/java/com/nexusbank/clearing/ClearingBatchCharacterisationTest.java";
const at = (m) => `2026-10-12T07:${String(m).padStart(2, "0")}:00.000Z`;
const SELECT = { kind: "select", scenario: "s3", at: at(0) };
const MIGRATE = (m, extra = {}) => ({ kind: "turn", scenario: "s3", step: "migrate", success: true, turnId: `t-${m}`, fileOperations: [PORT, TEST], at: at(m), ...extra });
const APPLY = (m, p) => ({ kind: "apply", path: p, ok: true, at: at(m) });
const RUN = (m, exitCode) => ({ kind: "test-run", scenario: "s3", command: "s3-java-tests", ran: true, exitCode, summary: exitCode === 0 ? "byte-identical to the COBOL; 8 passed" : "byte-identical to the COBOL; the characterisation test failed (1 of 8 failed)", at: at(m) });
const RECORD = (m, outcome) => ({ kind: "record", scenario: "s3", recordId: `r${m}`, paths: ["a.json", "a.md"], at: at(m), ...(outcome ? { outcome } : {}) });
const RED = [SELECT, MIGRATE(1), APPLY(2, PORT), APPLY(3, TEST), RUN(4, 1)];

describe("U-FAILED-ATTEMPT: the step bar after a failed test run", () => {
  test("the repair stays the next action; recording the failed attempt is offered beside it", () => {
    const st = stepStates(s3, RED);
    assert.strictEqual(st.next.action, "repair");
    assert.strictEqual(st.next.label, "Ask NexCODE to fix the failing tests");
    assert.deepStrictEqual([st.next.alternative.action, st.next.alternative.label], ["record-failed", "Record the failed attempt"]);
    assert.match(st.next.alternative.detail, /not ready for review/);
    assert.deepStrictEqual(st.steps.map((s) => s.status), ["ready", "ready", "locked"], "Record the change stays locked");
  });

  test("once the failed attempt is recorded, the demo has a known end: show the results, with the repair still on offer", () => {
    const st = stepStates(s3, [...RED, RECORD(5, "failed")]);
    assert.deepStrictEqual([st.next.action, st.next.outcome, st.next.label], ["results", "failed", "Show the results"]);
    assert.strictEqual(st.next.alternative.action, "repair");
    assert.deepStrictEqual(st.steps.find((s) => s.id === "migrate").failedRecord, { at: at(5), recordId: "r5" });
    assert.strictEqual(st.steps.find((s) => s.id === "record").complete, false, "a failed attempt never completes the record step");
    assert.strictEqual(st.complete, false);
  });

  test("a repair that turns the tests green carries on: the failed attempt's record does not count, a new record completes the demo", () => {
    const green = [...RED, RECORD(5, "failed"), MIGRATE(6, { repair: true, fileOperations: [TEST] }), APPLY(7, TEST), RUN(8, 0)];
    let st = stepStates(s3, green);
    assert.strictEqual(st.next.action, "record", "the earlier failed record does not satisfy Record the change");
    assert.strictEqual(st.next.alternative, undefined);
    st = stepStates(s3, [...green, RECORD(9, "ready")]);
    assert.deepStrictEqual([st.next.action, st.next.outcome, st.complete], ["results", undefined, true]);
  });

  test("a step with no repair prompt still offers the failed attempt beside asking again", () => {
    const def = JSON.parse(JSON.stringify(s3));
    def.steps.find((s) => s.id === "migrate").repair = null;
    const st = stepStates(def, RED);
    assert.deepStrictEqual([st.next.action, st.next.alternative.action], ["ask", "record-failed"]);
  });
});

describe("U-FAILED-ATTEMPT: the record of a failed attempt", () => {
  test("the record says not ready for review and asks for no approval; a passing record says ready for review", () => {
    const failed = buildEvidenceRecord({ scenario: s3, events: RED, recordId: "r5", now: new Date(at(5)), failed: { step: "migrate", at: at(4), exitCode: 1, summary: "byte-identical to the COBOL; the characterisation test failed (1 of 8 failed)" } });
    // 0.7 (S4-D4 (a)) adds the record's kind, 0.8 (S5) the documentation check and 0.9 (S5-D14 (a)) the code lines a tool
    // put back; the outcome and the approval of 0.6 are unchanged.
    assert.strictEqual(RECORD_SCHEMA, "nexcode.evidence/0.12");
    assert.deepStrictEqual(failed.json.outcome, { status: "not ready for review", reason: "the tests failed", step: "migrate", lastRun: { at: at(4), exitCode: 1, summary: "byte-identical to the COBOL; the characterisation test failed (1 of 8 failed)" } });
    assert.deepStrictEqual(failed.json.approval, { status: "not requested", approver: null });
    assert.match(failed.markdown, /\| Outcome \| Not ready for review: the tests failed \(byte-identical to the COBOL; the characterisation test failed \(1 of 8 failed\)\) \|/);
    assert.match(failed.markdown, /\*\*This record keeps a failed attempt\.\*\* The change did not pass its tests, so it is not ready for review and nothing ships\./);
    const ok = buildEvidenceRecord({ scenario: s3, events: [...RED.slice(0, 4), RUN(4, 0)], recordId: "r6", now: new Date(at(6)) });
    assert.deepStrictEqual(ok.json.outcome, { status: "ready for review", reason: null, step: null, lastRun: null });
    assert.deepStrictEqual(ok.json.approval, { status: "pending", approver: null });
    assert.match(ok.markdown, /\| Outcome \| Ready for review \|/);
    assert.ok(!/keeps a failed attempt/.test(ok.markdown));
  });

  test("the route records a failed attempt only when a step really failed its tests, and logs the outcome", () => {
    const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
    assert.match(route, /case "record":\s*return NextResponse\.json\(await record\(scenario, \{ failed: body\.outcome === "failed" \}\)\);/);
    assert.match(route, /const failing = stepStates\(scenario, events\)\.steps\.find\(\(s\) => s\.tests && s\.tests\.state === "failed"\);\s*if \(!failing\) return \{ success: false, error: "no step of this demo has failing tests: record the change once they pass" \};/);
    // S4-D4 (a): the line also says whether the record keeps a change or an answer.
    assert.match(route, /appendRun\(\{ kind: "record", scenario: scenario\.id, recordId, paths, wroteVia, archived, archiveError, outcome: failure \? "failed" : "ready", recordKind: json\.kind \}\);/);
    assert.match(route, /badge: failure \? "FAILED ATTEMPT" : "RECORDED",/);
  });

  test("the bar shows the alternative as a second button and never calls a failed attempt complete; the report says it plainly", () => {
    const bar = codeOnly(read("src/components/StepBar.jsx"));
    assert.match(bar, /\{next && next\.alternative && \(\s*<button type="button" className=\{BUTTON\} disabled=\{disabledFor\(next\.alternative\)\} onClick=\{\(\) => doAction\(next\.alternative\)\}/);
    assert.match(bar, /next && next\.action === "results" && next\.outcome !== "failed" && \(/);
    assert.match(bar, /failed attempt recorded: not ready for review/);
    assert.match(bar, /run\("Record the failed attempt", \{ action: "record", scenarioId: scenario\.id, outcome: "failed" \}/);
    const report = codeOnly(read("src/components/presenter/RecordReport.jsx"));
    assert.match(report, /record\.outcome && record\.outcome\.status === "not ready for review" && \(/);
    assert.match(report, /This record keeps a failed attempt: the change did not pass its tests/);
  });
});
