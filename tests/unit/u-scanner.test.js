/**
 * U-SCANNER — the pre-merge checks of the Code Review Standard (REV-002) as src/lib/coding/scanner.js runs them (S2, the
 * pull request review). Pinned on the seed: Tom Okafor's pull request PAY-2318 (public/demos/seed-branches/pr-PAY-2318)
 * against main (public/demos/seed/nexus-payments) gives exactly the six tool findings the S2 design plants, the main
 * branch gives none, and the fix for the two Critical findings clears those two and leaves the four High ones. The
 * secret in the seed is synthetic: a key for no system.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const S = require("../../src/lib/coding/scanner");

const ROOT = path.resolve(__dirname, "..", "..");
const SEED = path.join(ROOT, "public", "demos", "seed", "nexus-payments");
const PR = path.join(ROOT, "public", "demos", "seed-branches", "pr-PAY-2318", "files");
const read = (base, p) => (fs.existsSync(path.join(base, p)) ? fs.readFileSync(path.join(base, p), "utf8") : null);
const CHANGED = ["services/refund-api/src/refund-service.ts", "services/refund-api/src/audit-log.ts", "services/refund-api/package.json"];
const approved = JSON.parse(read(SEED, "approved-dependencies.json"));
const TESTS = ["services/refund-api/test/audit-log.test.ts", "services/settlement/test_settlement_reconciler.py"];
const prFiles = () => CHANGED.map((p) => ({ path: p, before: read(SEED, p), after: read(PR, p) }));

describe("U-SCANNER: the six checks on the seeded pull request", () => {
  test("PAY-2318 gives exactly the six planted tool findings, in check order, with their rules, severities and lines", () => {
    const r = S.scanChange({ files: prFiles(), approved, testPaths: TESTS });
    const got = r.findings.map((f) => [f.id, f.check, f.rule, f.severity, f.path.split("/").pop(), f.lines.join(",")]);
    assert.deepStrictEqual(got, [
      ["T1", "secrets", "SCS-010", "Critical", "refund-service.ts", "6"],
      ["T2", "card-numbers", "SCS-021", "Critical", "refund-service.ts", "31"],
      ["T3", "float-money", "PAY-012", "High", "refund-service.ts", "39,40,44"],
      ["T4", "sql-strings", "SCS-031", "High", "refund-service.ts", "33,72"],
      ["T5", "dependencies", "DEP-001", "High", "package.json", "12,15"],
      ["T6", "missing-tests", "TST-001", "High", "refund-service.ts", "1"],
    ]);
    assert.deepStrictEqual(r.checks.map((c) => c.findings), [1, 1, 1, 1, 1, 1], "each check found one");
    assert.match(r.findings[4].evidence, /async-retry/);
  });

  test("the planted debug-level payload dump is left to the reviewer's judgement (no card-number name in it)", () => {
    const after = read(PR, CHANGED[0]).split("\n");
    const debugLines = after.map((l, i) => [i + 1, l]).filter(([, l]) => /logger\.debug\(/.test(l)).map(([n]) => n);
    assert.deepStrictEqual(debugLines, [30, 54]);
    const r = S.scanChange({ files: prFiles(), approved, testPaths: TESTS });
    for (const f of r.findings) for (const n of debugLines) assert.ok(!f.lines.includes(n), `${f.id} does not claim debug line ${n}`);
  });

  test("the main branch against itself gives nothing, and the evidence never shows the whole secret", () => {
    const same = CHANGED.map((p) => ({ path: p, before: read(SEED, p), after: read(SEED, p) })).filter((f) => f.after !== null);
    assert.deepStrictEqual(S.scanChange({ files: same, approved, testPaths: TESTS }).findings, []);
    const r = S.scanChange({ files: prFiles(), approved, testPaths: TESTS });
    const block = S.toolFindingsBlock(r);
    assert.ok(!block.includes("4f7c2a9e81b34d6f9a0c5e72b18d3f6a"), "the key is masked in the prompt block");
    assert.match(block, /\[T1\] Critical · SCS-010/);
    assert.match(block, /\[T6\] High · TST-001/);
  });

  test("the fix for the two Critical findings clears T1 and T2 and leaves the four High findings", () => {
    const fixed = read(PR, CHANGED[0])
      .replace('const SCHEME_GATEWAY_API_KEY = "ngw_live_4f7c2a9e81b34d6f9a0c5e72b18d3f6a";', 'const SCHEME_GATEWAY_API_KEY = process.env.SCHEME_GATEWAY_API_KEY ?? "";')
      .replace("logger.info(`Refund requested for card ${req.cardNumber}, payment ${req.paymentId}`);", "logger.info(`Refund requested for card ending ${req.cardNumber.slice(-4)}, payment ${req.paymentId}`);");
    const files = prFiles().map((f) => (f.path === CHANGED[0] ? { ...f, after: fixed } : f));
    const r = S.scanChange({ files, approved, testPaths: TESTS });
    assert.deepStrictEqual(r.findings.map((f) => f.rule), ["PAY-012", "SCS-031", "DEP-001", "TST-001"]);
  });
});

describe("U-SCANNER: the rules one at a time", () => {
  const one = (after, before = null, p = "svc/src/x.ts") => S.scanChange({ files: [{ path: p, before, after }], approved, testPaths: ["svc/test/x.test.ts"] }).findings;

  test("secrets: a literal key is Critical; a value read from the environment or a placeholder is not a finding", () => {
    assert.strictEqual(one('const API_KEY = "abcd1234efgh5678ijkl";')[0].severity, "Critical");
    assert.strictEqual(one("const token = process.env.GATEWAY_TOKEN;").length, 0);
    assert.strictEqual(one('const password = "${VAULT_PASSWORD_PLACEHOLDER}";').length, 0);
    assert.strictEqual(one('headers.push("sk_live_ABCDEFGHIJKLMNOPQRSTUV");')[0].rule, "SCS-010", "a key-shaped literal with no telling name");
  });

  test("card numbers: Critical at info level, High at debug level, nothing once masked; a Luhn-valid literal is Critical", () => {
    assert.strictEqual(one("logger.info(`card ${req.cardNumber}`);")[0].severity, "Critical");
    assert.strictEqual(one("logger.debug(`card ${req.cardNumber}`);")[0].severity, "High");
    assert.strictEqual(one("logger.info(`card ending ${req.cardNumber.slice(-4)}`);").length, 0);
    assert.strictEqual(one("logger.info(`card ${maskPan(req.cardNumber)}`);").length, 0);
    assert.strictEqual(one('const testCard = "4111 1111 1111 1111";')[0].severity, "Critical");
    assert.strictEqual(one('const notACard = "4111 1111 1111 1112";').length, 0, "fails the Luhn check");
    assert.ok(S.luhn("4111111111111111") && !S.luhn("1234567890123"));
    // S6-D10 (a) of 2026-10-13: a card number's first digit is 2 to 6. Sixteen zeros (the obviously synthetic value DOC-004
    // recommends) and an amount in S3's compatibility tests pass the Luhn check alone, and are not card numbers.
    assert.ok(S.luhn("0000000000000000") && !S.isCardNumber("0000000000000000"));
    assert.strictEqual(one('const synthetic = "0000 0000 0000 0000";').length, 0, "sixteen zeros");
    assert.strictEqual(one('assertEquals("0000000137500120", record.amountField());').length, 0, "S3's amount field");
    assert.ok(["4111111111111111", "5555555555554444", "378282246310005", "6011111111111117", "2223003122003222"].every(S.isCardNumber), "Visa, Mastercard, American Express, Discover, Mastercard's 2-series");
    const outside = ["7111111111111114", "8111111111111112", "9111111111111110", "1111111111111117"];
    assert.ok(outside.every(S.luhn) && !outside.some(S.isCardNumber), "Luhn-valid, first digit outside 2 to 6");
  });

  test("float money, SQL strings: only the changed lines are checked", () => {
    const before = "const amount = parseFloat(input);\n";
    assert.strictEqual(one(before, before).length, 0, "an unchanged line is not a finding");
    assert.strictEqual(one(before + "const fee = Number(amount) * 0.015;\n", before)[0].lines.join(","), "2");
    assert.strictEqual(one("db.query(`SELECT * FROM t WHERE id = ${id}`);")[0].rule, "SCS-031");
    assert.strictEqual(one('db.query("SELECT * FROM t WHERE id = $1", [id]);').length, 0, "a bound parameter is fine");
  });

  test("dependencies and tests: an approved package and a tested module are not findings", () => {
    const manifest = (deps) => JSON.stringify({ name: "x", dependencies: deps }, null, 2);
    const files = [{ path: "svc/package.json", before: manifest({}), after: manifest({ "decimal.js": "^10.4.3" }) }];
    assert.strictEqual(S.scanChange({ files, approved, testPaths: [] }).findings.length, 0);
    const untested = S.scanChange({ files: [{ path: "svc/src/y.ts", before: null, after: "export const y = 1;\n" }], approved, testPaths: ["svc/test/x.test.ts"] }).findings;
    assert.deepStrictEqual(untested.map((f) => f.rule), ["TST-001"]);
    assert.strictEqual(S.scanChange({ files: [{ path: "svc/src/x.ts", before: null, after: "export const x = 1;\n" }], approved, testPaths: ["svc/test/x.test.ts"] }).findings.length, 0);
  });
});
