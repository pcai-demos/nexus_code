/**
 * U-S2 — the pull request review wired through the app (S2; the owner's D1 (a), D2 (a) and D8 (a) of 2026-10-09):
 * the scenario's definition, the evidence record's review section, the live bubble's scan line, the review
 * instruction, and the seams in the turn, the route and the bridge extension (source pins: the IDE and the model are
 * not reachable from a unit test). Also S1's fourth retrieval hint (measured 2026-10-09).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { loadScenarios } = require("../../src/lib/coding/scenarios");
const { buildEvidenceRecord } = require("../../src/lib/coding/record");
const { liveTurnReducer } = require("../../src/lib/coding/turn_client");
const { requestInstruction } = require("../../src/lib/coding/persona");
const { stepStates } = require("../../src/lib/coding/steps");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const s2 = () => loadScenarios().find((s) => s.id === "s2");
const RS = "nexus-payments/services/refund-api/src/refund-service.ts";

describe("U-S2: the scenario", () => {
  test("S2 reviews pr/PAY-2318 against main: Select checks the branch out and runs the tests; review, fix the two Criticals, file", () => {
    const s = s2();
    assert.strictEqual(s.title, "Review pull request PAY-2318, the refund API");
    assert.deepStrictEqual(s.select, { reset: true, runTests: true, branch: "pr/PAY-2318" });
    assert.deepStrictEqual(s.review, { base: "main", branch: "pr/PAY-2318", changed: [RS, "nexus-payments/services/refund-api/src/audit-log.ts", "nexus-payments/services/refund-api/package.json"] });
    assert.deepStrictEqual(s.steps.map((x) => [x.id, x.mode, x.action]), [["review", "review", null], ["fix", "change", null], ["record", null, "record"]]);
    assert.match(s.steps[1].prompt, /T1 and T2/);
    assert.ok(s.steps[1].repair && s.steps[1].after.includes("run-tests"));
    assert.strictEqual(s.commands.tests, "s2-tests");
    // D10 (a) of 2026-10-10: the card is what the demo searches, so it lists the two regulator documents its chain cites.
    assert.strictEqual(s.card.artefacts.documents.length, 22);
    for (const src of ["PSRs_2017_April2026.pdf", "PRA_SS1-21_OperationalResilience_March2022.pdf"]) assert.ok(s.card.artefacts.documents.some((d) => d.source === src), src);
    const p = stepStates(s, []);
    assert.deepStrictEqual([p.next.action, p.next.label], ["ask", "Ask NexCODE: Review"]);
  });

  test("S1's Diagnose and Fix carry the fourth hint measured on 2026-10-09 (PAY-012, ADR-004 D3 and PM-2024-011 L2 into the top four)", () => {
    const s1 = loadScenarios().find((s) => s.id === "s1");
    for (const id of ["diagnose", "fix"]) assert.ok(s1.steps.find((x) => x.id === id).retrievalHints.includes("monetary amounts held in decimal and rounded half up once per transaction"), id);
  });
});

describe("U-S2: the review's search", () => {
  test("S2's review searches for the judgement findings and the regulator layer (measured 2026-10-10, V5): the tool findings' rules are traced", () => {
    // inputs/demo-design/evidence/session-90-s2-layers/hints4_probe.json: REG PSRs reg. 98(1) and PCI DSS 3.5.1, SDLC
    // INT-001 and PAY-030, TEAM the digest's F7 and F6 and CLR-WIKI-006 T1. The order is part of the measurement.
    assert.deepStrictEqual(s2().steps.find((x) => x.id === "review").retrievalHints, [
      "management of operational and security risks",
      "effective control and safeguard arrangements for information processing systems",
      "card numbers in audit logs, exception, or troubleshooting logs",
      "an idempotency key reused on every retry of a refund",
      "an audit event for every action that moves money",
      "dump the full request payload when debugging",
    ]);
  });
});

describe("U-S2: the record files the review", () => {
  test("the review's outcome, findings (tool and assessed), status after the fix, verification and the SCS-011 follow-up", () => {
    const review = {
      outcome: "Changes requested",
      counts: { tool: 2, reviewer: 1, critical: 1, high: 2 },
      findings: [
        { id: "T1", established: "tool", check: "secrets", severity: "Critical", title: "A secret written into the code", path: RS, line: 6, rules: ["SCS-010"], status: "fixed", why: 'SCHEME_GATEWAY_API_KEY = "ngw_…3f6a"' },
        { id: "T3", established: "tool", check: "float-money", severity: "High", title: "Money in binary floating point", path: RS, line: 39, rules: ["PAY-012"], status: "open" },
        { id: "A1", established: "reviewer", severity: "High", title: "No audit event on a refund", path: RS, line: 75, rules: ["PAY-030"], status: "open" },
      ],
    };
    const s = s2();
    const { json, markdown } = buildEvidenceRecord({ scenario: s, events: [], changes: null, platform: {}, firm: "Nexus Bank plc", recordId: "abcd1234", now: new Date("2026-10-09T12:00:00Z"), review });
    assert.strictEqual(json.review.outcome, "Changes requested");
    assert.deepStrictEqual(json.review.findings.map((f) => [f.id, f.status]), [["T1", "fixed"], ["T3", "open"], ["A1", "open"]]);
    assert.deepStrictEqual(json.verification.toolVerified.map((f) => f.id), ["T1", "T3"]);
    assert.deepStrictEqual(json.verification.assistantAssessed.map((f) => f.id), ["A1"]);
    assert.match(json.review.followUps[0], /revoked and replaced \(SCS-011\)/);
    assert.match(markdown, /## Review\n\nOutcome: \*\*Changes requested\*\*/);
    assert.match(markdown, /\| T1 \| Critical \| A secret written into the code \| nexus-payments\/services\/refund-api\/src\/refund-service\.ts:6 \| SCS-010 \| verified by tool \| fixed \|/);
    assert.match(markdown, /- Verified by tool: 2 finding\(s\), 1 fixed/);
    assert.ok(!markdown.includes("4f7c2a9e81b34d6f9a0c5e72b18d3f6a"), "the key is never in the record");
  });
});

describe("U-S2: the seams", () => {
  test("the live bubble counts the tool findings; the review instruction asks for the model's OWN findings in a fenced findings list", () => {
    const st = liveTurnReducer(null, { type: "scan", findings: [{ severity: "Critical" }, { severity: "High" }, { severity: "Critical" }] });
    assert.deepStrictEqual(st.scan, { findings: 3, critical: 2 });
    const r = requestInstruction({ mode: "review" });
    assert.match(r, /do not write code or File blocks/);
    assert.match(r, /never drop or re-grade it/);
    assert.match(r, /```findings, holding a JSON list of YOUR OWN findings only \(not the tool findings\)/);
  });

  test("the turn runs the checks before the model, sends the review to the IDE and the run log; the route checks out the branch and re-checks at Record", () => {
    const turn = codeOnly(read("src/lib/coding/turn.js"));
    assert.match(turn, /if \(mode === "review" && scenario && scenario\.review\) \{[\s\S]{0,200}?const change = changeOf\(scenario\);[\s\S]{0,80}?scan = scanChange\(change\);/);
    assert.ok(turn.indexOf("scan = scanChange(change);") < turn.indexOf("const instruction = requestInstruction({ mode, repair"), "the tools before the model");
    // S6 (2026-10-13): a review of the demo's own new files says so (`workspace`).
    assert.match(turn, /const reviewContext = scan \? reviewBlock\(\{ scan, files: reviewFiles, base: scenario\.review\.base, branch: scenario\.review\.branch, workspace: workspaceReview \}\) : "";/);
    assert.match(turn, /const r = await bridgeAction\(\{ type: "showReview", turnId, findings: ideComments\(review\) \}\);/);
    assert.match(turn, /scan: scan \? \{ checks: scan\.checks, findings: scan\.findings \} : null,\s*review,/);
    const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
    // S6 (2026-10-13): \`clean\` also holds the folders of the files a demo writes itself (none in S2).
    assert.match(route, /const result = await bridgeCommand\("scenario-reset", \{ scenario: scenario\.id, paths, branch, clean \}\);/);
    assert.match(route, /bridgeAction\(\{ type: "showBranchDiff", base: scenario\.review\.base, branch: scenario\.review\.branch, paths: scenario\.review\.changed \}\)/);
    assert.match(route, /review = statusAfterFix\(last\.review, scanChange\(changeOf\(scenario\)\), \{ repoPrefix: REVIEW_PREFIX \}\);/);
    assert.match(route, /if \(fs\.existsSync\(SEED_BRANCHES_SOURCE\)\) fs\.cpSync\(SEED_BRANCHES_SOURCE, SEED_BRANCHES_STAGE, \{ recursive: true \}\);/);
  });

  test("the extension: the branch diff and the review comments are guarded and contained; S2's tests are a fixed sequence; the clean-up clears the review", () => {
    const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));
    assert.match(ext, /case "showBranchDiff": \{\s*if \(!gitViewReady\) return/);
    assert.match(ext, /case "showReview": \{\s*if \(!reviewController\) return/);
    assert.match(ext, /const fullPath = resolveInWorkspace\(p\);[\s\S]{0,200}?if \(!rel\.startsWith\(`\$\{SEED_REPO\}\/`\)\)/);
    assert.match(ext, /const fullPath = resolveInWorkspace\(f\.path\);/);
    assert.match(ext, /md\.appendText\(text\(f\.title, 160\)\);/, "the model's words go in as text, never as markdown");
    assert.match(ext, /"s2-tests": \{\s*exec: \[\s*\{ program: "node", args: \["-e", "require\('fs'\)\.rmSync\('services\/refund-api\/dist', \{ recursive: true, force: true \}\)"\], cwd: SEED_REPO \},\s*\{ program: "tsc", args: \["-p", "services\/refund-api\/tsconfig\.json"\], cwd: SEED_REPO \},\s*\{ program: "node", args: \["--test", "services\/refund-api\/dist\/test"\], cwd: SEED_REPO \},\s*\],/);
    assert.match(ext, /proposals\.clear\(\);\s*clearReviewThreads\(\);/);
    assert.match(ext, /registerProposalView\(context\);\s*registerGitView\(context\);\s*registerReviewView\(context\);/);
    assert.ok(!/exec\(|execSync|shell: true/.test(ext), "still no shell");
  });
});
