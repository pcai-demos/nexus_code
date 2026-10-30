/**
 * src/lib/coding/scanner.js — the pre-merge checks of the Code Review Standard (REV-002), as a pure module (S2, the
 * pull request review; brief §8 M4).
 *
 * Pure (no I/O). Six deterministic checks over a change, in a fixed order:
 *   1. secrets in code (SCS-010)                         4. SQL built from strings (SCS-031)
 *   2. card numbers in code and in logs (SCS-021)        5. dependencies missing from the approved list (DEP-001)
 *   3. money in binary floating point (PAY-012)          6. changed modules with no test (TST-001)
 * Only the lines a change adds or alters are checked, the way a pull request check reads a diff; a new file is all
 * added lines. A check reports at most one finding per file, with every matching line, so the six checks give at most
 * one finding each on a one-file change. A finding is verified by tool (REV-004): it names its check, its rule, its
 * severity on the REV-003 scale, its file and lines, and evidence in which a secret or a card number is masked.
 * The model explains and adds judgement findings; it never invents a tool finding, and it cannot remove one.
 */

const { editScript, linesOf } = require("./diff");

const CHECKS = Object.freeze([
  { id: "secrets", rule: "SCS-010", title: "A secret written into the code" },
  { id: "card-numbers", rule: "SCS-021", title: "A card number in the code or in a log" },
  { id: "float-money", rule: "PAY-012", title: "Money in binary floating point" },
  { id: "sql-strings", rule: "SCS-031", title: "SQL built from strings" },
  { id: "dependencies", rule: "DEP-001", title: "A dependency missing from the approved list" },
  { id: "missing-tests", rule: "TST-001", title: "A changed module with no test" },
]);

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|rs|go)$/i;
const TEST_FILE = /(^|\/)(test_[^/]+\.py|[^/]+\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)|[^/]+Test\.java)$/;

const SECRET_NAME = /\b((?:[A-Za-z_][A-Za-z0-9_]*)?(?:api[_-]?key|apikey|secret|token|password|passwd|credential)[A-Za-z0-9_]*)\s*[:=]\s*(["'`])([^"'`\n]{12,})\2/i;
const KEY_SHAPE = /\b(?:sk|pk|rk|ngw)_(?:live|test)_[A-Za-z0-9]{16,}\b/;
const PLACEHOLDER = /\$\{|process\.env|os\.environ|<[^>]+>|changeme|placeholder|dummy|x{6,}/i;

const LOG_CALL = /\b(?:logger|log|console)\.(debug|trace|info|log|warn|error)\s*\(/;
const CARD_NAME = /\b(?:card_?number|cardNo|pan|primaryAccountNumber)\b/i;
const MASKED = /\b(?:mask\w*|last4|lastFour|truncat\w*)\b|\.slice\(\s*-4\s*\)/i;
const DIGITS = /\b(?:\d[ -]?){13,19}\b/g;

const MONEY = /\b(?:amount|amounts|fee|fees|price|total|refund\w*|charge\w*|captured|balance)\b/i;
const FLOAT_PARSE = /\b(?:parseFloat|Number)\s*\(/;
const FLOAT_ROUND = /Math\.round\([^)]*\*\s*100\s*\)\s*\/\s*100|\.toFixed\(\s*2\s*\)/;

const SQL_START = /\b(?:SELECT\s+[\w*,\s]+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
const SQL_TEMPLATE = /`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{[^`]*`/i;
const SQL_CONCAT = /["']\s*\+|\+\s*["']/; // on a line that starts an SQL statement: a string joined with +

const SEVERITY_RANK = Object.freeze({ Critical: 0, High: 1, Medium: 2, Low: 3 });

/** True when the digits (spaces and dashes removed), 13 to 19 of them, pass the Luhn check. */
function luhn(digits) {
  const d = String(digits).replace(/[^0-9]/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/**
 * True when a 13 to 19 digit run is a card number: its first digit is 2 to 6 and it passes the Luhn check (S6-D10 (a) of
 * 2026-10-13). Every card of the PCI DSS payment brands starts with 2 to 6 (Mastercard 2 and 5; American Express, Diners
 * Club and JCB 3; Visa 4; Discover and UnionPay 6). Sixteen zeros, the obviously synthetic value DOC-004 recommends, pass
 * the Luhn check alone: measured, 2 of 6 fix answers used them and were reported as card numbers (session-90-s6-measure).
 */
function isCardNumber(digits) {
  const d = String(digits).replace(/[^0-9]/g, "");
  return /^[2-6]/.test(d) && luhn(d);
}

/** A secret or card number shown safely: its first four characters and its last four, the rest hidden. */
function maskValue(v) {
  const s = String(v);
  if (s.length <= 8) return "…";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** The 1-based numbers of the lines a change adds or alters in `after` (every line of a new file). */
function addedLines(before, after) {
  const b = linesOf(after);
  if (before === null || before === undefined) return b.map((_, i) => i + 1);
  const script = editScript(linesOf(before), b);
  if (!script) return b.map((_, i) => i + 1); // too large to compare: check every line, never skip one
  return script.filter((e) => e.type === "+").map((e) => e.newNo);
}

const isTest = (p) => TEST_FILE.test(p);
const isSource = (p) => SOURCE.test(p) && !isTest(p);
const stemOf = (p) => String(p).split("/").pop().replace(/\.[^.]+$/, "");

function lineFinding(check, file, hits, severity, evidence) {
  return { check: check.id, rule: check.rule, title: check.title, severity, path: file.path, line: hits[0], lines: hits, evidence };
}

function checkSecrets(file, added, lines) {
  const hits = [];
  let evidence = null;
  for (const n of added) {
    const text = lines[n - 1] || "";
    const named = text.match(SECRET_NAME);
    const shaped = text.match(KEY_SHAPE);
    if (named && !PLACEHOLDER.test(named[3])) {
      hits.push(n);
      if (!evidence) evidence = `${named[1]} = "${maskValue(named[3])}"`;
    } else if (shaped) {
      hits.push(n);
      if (!evidence) evidence = `"${maskValue(shaped[0])}"`;
    }
  }
  return hits.length ? lineFinding(CHECKS[0], file, hits, "Critical", evidence) : null;
}

function checkCardNumbers(file, added, lines) {
  const hits = [];
  let severity = null;
  let evidence = null;
  for (const n of added) {
    const text = lines[n - 1] || "";
    const log = text.match(LOG_CALL);
    if (log && CARD_NAME.test(text) && !MASKED.test(text)) {
      const level = log[1] === "debug" || log[1] === "trace" ? "High" : "Critical";
      hits.push(n);
      if (!severity || SEVERITY_RANK[level] < SEVERITY_RANK[severity]) severity = level;
      if (!evidence) evidence = `${/^[aeiou]/.test(log[1]) ? "an" : "a"} ${log[1]}-level log line writes the full card number (${text.match(CARD_NAME)[0]})`;
      continue;
    }
    for (const m of text.matchAll(DIGITS)) {
      if (isCardNumber(m[0])) {
        hits.push(n);
        severity = "Critical";
        if (!evidence) evidence = `a card number literal "${maskValue(m[0].replace(/[^0-9]/g, ""))}"`;
        break;
      }
    }
  }
  return hits.length ? lineFinding(CHECKS[1], file, hits, severity, evidence) : null;
}

function checkFloatMoney(file, added, lines) {
  const hits = [];
  for (const n of added) {
    const text = lines[n - 1] || "";
    if ((FLOAT_PARSE.test(text) && MONEY.test(text)) || (FLOAT_ROUND.test(text) && MONEY.test(text))) hits.push(n);
  }
  return hits.length ? lineFinding(CHECKS[2], file, hits, "High", "amounts parsed or rounded as binary floating point (parseFloat, Number, Math.round(x * 100) / 100)") : null;
}

function checkSql(file, added, lines) {
  const hits = [];
  for (const n of added) {
    const text = lines[n - 1] || "";
    if (SQL_START.test(text) && (SQL_TEMPLATE.test(text) || SQL_CONCAT.test(text))) hits.push(n);
  }
  return hits.length ? lineFinding(CHECKS[3], file, hits, "High", "values written into the SQL text by interpolation or concatenation, not passed as bound parameters") : null;
}

/** npm manifests: every dependency the change adds that the approved list does not name for npm. */
function checkDependencies(file, approved) {
  if (!/(^|\/)package\.json$/.test(file.path) || typeof file.after !== "string") return null;
  let after;
  let before = {};
  try {
    after = JSON.parse(file.after);
    if (typeof file.before === "string") before = JSON.parse(file.before);
  } catch {
    return null;
  }
  const names = (m) => new Set([...Object.keys((m && m.dependencies) || {}), ...Object.keys((m && m.devDependencies) || {})]);
  const had = names(before);
  const allowed = new Set(((approved && approved.packages) || []).filter((p) => p && p.ecosystem === "npm").map((p) => p.name));
  const missing = [...names(after)].filter((n) => !had.has(n) && !allowed.has(n)).sort();
  if (!missing.length) return null;
  const lines = linesOf(file.after);
  const hits = missing.map((name) => lines.findIndex((l) => l.includes(`"${name}"`)) + 1).filter((n) => n > 0).sort((a, b) => a - b);
  return lineFinding(CHECKS[4], file, hits.length ? hits : [1], "High", `not on the approved list: ${missing.join(", ")}`);
}

/** A source module the change adds or alters, with no test file for it anywhere in the repository after the change. */
function checkMissingTests(file, added, testPaths) {
  if (!isSource(file.path) || !added.length || typeof file.after !== "string") return null;
  const stem = stemOf(file.path);
  const tested = (testPaths || []).some((t) => {
    const s = stemOf(t);
    return s === `${stem}.test` || s === `${stem}.spec` || s === `test_${stem}` || s === `${stem}Test`;
  });
  return tested ? null : lineFinding(CHECKS[5], file, [1], "High", `no test file for ${String(file.path).split("/").pop()}`);
}

/**
 * The checks over one change. `files`: `[{ path, before, after }]` (before null for a new file, after null for a removed
 * one); `approved`: the approved-dependencies list; `testPaths`: the repository's test files after the change.
 * Returns `{ checks: [{ id, rule, title, findings }], findings: [{ id: "T1"…, check, rule, title, severity, path, line,
 * lines, evidence }] }`, findings in check order then file order, numbered T1, T2 and so on.
 */
function scanChange({ files = [], approved = null, testPaths = [] } = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === "string" && typeof f.after === "string");
  const perCheck = CHECKS.map(() => []);
  for (const file of [...list].sort((a, b) => a.path.localeCompare(b.path))) {
    const added = addedLines(file.before, file.after);
    const lines = linesOf(file.after);
    const results = [
      checkSecrets(file, added, lines),
      checkCardNumbers(file, added, lines),
      checkFloatMoney(file, added, lines),
      checkSql(file, added, lines),
      checkDependencies(file, approved),
      checkMissingTests(file, added, testPaths),
    ];
    results.forEach((r, i) => {
      if (r) perCheck[i].push(r);
    });
  }
  const findings = perCheck.flat().map((f, i) => ({ id: `T${i + 1}`, ...f }));
  return {
    checks: CHECKS.map((c, i) => ({ id: c.id, rule: c.rule, title: c.title, findings: perCheck[i].length })),
    findings,
  };
}

/** The TOOL FINDINGS block the review prompt carries: each finding with its id, so the answer can refer to it. */
function toolFindingsBlock(scan) {
  const findings = scan && Array.isArray(scan.findings) ? scan.findings : [];
  const out = [
    "TOOL FINDINGS — the pre-merge checks (REV-002) ran on this pull request before the review. Each finding below is verified by tool (REV-004): keep it, with its id, severity and rule; do not drop or re-grade it.",
  ];
  if (!findings.length) out.push("(The six checks found nothing.)");
  for (const f of findings) out.push(`[${f.id}] ${f.severity} · ${f.rule} · ${f.title} · ${f.path}:${f.lines.join(",")} · ${f.evidence}`);
  const ran = scan && Array.isArray(scan.checks) ? scan.checks.map((c) => `${c.rule} ${c.id}: ${c.findings}`).join("; ") : "";
  if (ran) out.push(`Checks run: ${ran}.`);
  return out.join("\n");
}

module.exports = { CHECKS, SEVERITY_RANK, luhn, isCardNumber, maskValue, addedLines, scanChange, toolFindingsBlock, isTest, isSource };
