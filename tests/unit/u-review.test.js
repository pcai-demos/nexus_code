/**
 * U-REVIEW — the pull request review's pure parts (src/lib/coding/review.js; S2): the prompt block, the model's own
 * findings read back from its fenced `findings` list (anything malformed or outside the change dropped), the merge with
 * the tool findings and its REV-007 outcome, the IDE's review comments, and the status after the fix (tool findings
 * re-checked, reviewer findings left open).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const S = require("../../src/lib/coding/scanner");
const R = require("../../src/lib/coding/review");

const ROOT = path.resolve(__dirname, "..", "..");
const SEED = path.join(ROOT, "public", "demos", "seed", "nexus-payments");
const PR = path.join(ROOT, "public", "demos", "seed-branches", "pr-PAY-2318", "files");
const read = (base, p) => (fs.existsSync(path.join(base, p)) ? fs.readFileSync(path.join(base, p), "utf8") : null);
const CHANGED = ["services/refund-api/src/refund-service.ts", "services/refund-api/src/audit-log.ts", "services/refund-api/package.json"];
const files = CHANGED.map((p) => ({ path: p, before: read(SEED, p), after: read(PR, p) }));
const approved = JSON.parse(read(SEED, "approved-dependencies.json"));
const scan = S.scanChange({ files, approved, testPaths: ["services/refund-api/test/audit-log.test.ts"] });
const changed = files.map((f) => ({ path: `nexus-payments/${f.path}`, lineCount: f.after.replace(/\n$/, "").split("\n").length }));

const answer = (list) => `The pull request adds refunds.\n\nT1 and T2 block the merge.\n\n\`\`\`findings\n${JSON.stringify(list)}\n\`\`\`\n`;

describe("U-REVIEW: the block, the model's findings and the outcome", () => {
  test("the prompt block carries the six tool findings and every changed file's diff against main", () => {
    const block = R.reviewBlock({ scan, files, base: "main", branch: "pr/PAY-2318" });
    for (const id of ["T1", "T2", "T3", "T4", "T5", "T6"]) assert.match(block, new RegExp(`\\[${id}\\]`));
    assert.match(block, /pr\/PAY-2318 against main/);
    assert.match(block, /\+\s*"async-retry": "\^1\.3\.3"/);
    assert.match(block, /REFUND_REQUESTED/);
  });

  test("the model's findings are read from its findings block; out-of-change, out-of-range and malformed entries are dropped", () => {
    const got = R.parseReviewFindings(
      answer([
        { severity: "High", title: "No audit event on a refund", path: "nexus-payments/services/refund-api/src/refund-service.ts", line: 75, rules: ["PAY-030", "FIN-POL-003 clause 4.3"], why: "REFUND_REQUESTED is added but never emitted." },
        { severity: "high", title: "No idempotency key on the gateway call", path: "services/refund-api/src/refund-service.ts", line: 56, rules: "INT-001; ADR-007 D2", why: "A retry is a new refund." },
        { severity: "High", title: "Payload dump at debug level", path: "nexus-payments/services/refund-api/src/refund-service.ts", line: 30, rules: ["SCS-021", "CLR-WIKI-006 T1", "made-up rule"] },
        { severity: "Severe", title: "bad severity", path: "nexus-payments/services/refund-api/src/refund-service.ts", line: 3 },
        { severity: "High", title: "outside the change", path: "nexus-payments/services/settlement/settlement_reconciler.py", line: 3 },
        { severity: "High", title: "past the end", path: "nexus-payments/services/refund-api/src/refund-service.ts", line: 999 },
      ]),
      { changed },
    );
    assert.strictEqual(got.error, null);
    assert.strictEqual(got.dropped, 3);
    assert.deepStrictEqual(got.findings.map((f) => [f.id, f.severity, f.line, f.rules.join("|")]), [
      ["A1", "High", 75, "PAY-030|FIN-POL-003 clause 4.3"],
      ["A2", "High", 56, "INT-001|ADR-007 D2"],
      ["A3", "High", 30, "SCS-021|CLR-WIKI-006 T1"],
    ]);
    assert.strictEqual(got.findings[1].path, "nexus-payments/services/refund-api/src/refund-service.ts", "a repository path is matched to its workspace path");
    assert.deepStrictEqual(R.parseReviewFindings("no block here", { changed }).findings, []);
    assert.match(R.parseReviewFindings("```findings\nnot json\n```", { changed }).error, /not JSON/);
    assert.strictEqual(R.stripFindingsBlock(answer([])), "The pull request adds refunds.\n\nT1 and T2 block the merge.");
  });

  test("the merged review: tool findings first and unchanged, the outcome Changes requested; the IDE gets every finding", () => {
    const assessed = R.parseReviewFindings(answer([{ severity: "High", title: "No audit event", path: "nexus-payments/services/refund-api/src/refund-service.ts", line: 75, rules: ["PAY-030"] }]), { changed });
    const review = R.mergeReview({ scan, assessed, repoPrefix: "nexus-payments/" });
    assert.strictEqual(review.outcome, "Changes requested");
    assert.deepStrictEqual(review.counts, { tool: 6, reviewer: 1, critical: 2, high: 5 });
    assert.deepStrictEqual(review.findings.map((f) => f.id), ["T1", "T2", "T3", "T4", "T5", "T6", "A1"]);
    assert.strictEqual(review.findings[0].path, "nexus-payments/services/refund-api/src/refund-service.ts");
    const comments = R.ideComments(review);
    assert.strictEqual(comments.length, 7);
    assert.deepStrictEqual([comments[0].established, comments[6].established], ["verified by tool", "assessed by the reviewer"]);
    assert.ok(!JSON.stringify(comments).includes("4f7c2a9e81b34d6f9a0c5e72b18d3f6a"), "the key never reaches the IDE comments");
  });

  test("after the fix: the tool findings that no longer reproduce are fixed, the rest stay open, and the outcome follows", () => {
    const review = R.mergeReview({ scan, assessed: { findings: [], dropped: 0, error: null }, repoPrefix: "nexus-payments/" });
    const fixedText = files[0].after
      .replace(/const SCHEME_GATEWAY_API_KEY = "[^"]+";/, 'const SCHEME_GATEWAY_API_KEY = process.env.SCHEME_GATEWAY_API_KEY ?? "";')
      .replace("Refund requested for card ${req.cardNumber},", "Refund requested for card ending ${req.cardNumber.slice(-4)},");
    const rescan = S.scanChange({ files: files.map((f, i) => (i === 0 ? { ...f, after: fixedText } : f)), approved, testPaths: [] });
    const after = R.statusAfterFix(review, rescan, { repoPrefix: "nexus-payments/" });
    assert.deepStrictEqual(after.findings.map((f) => `${f.id}:${f.status}`), ["T1:fixed", "T2:fixed", "T3:open", "T4:open", "T5:open", "T6:open"]);
    assert.strictEqual(after.outcome, "Changes requested", "four High findings stay open");
    assert.strictEqual(R.outcomeOf([{ severity: "Low", status: "open" }]), "Approved with comments");
    assert.strictEqual(R.outcomeOf([]), "Approved");
  });
});
