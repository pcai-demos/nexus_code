/**
 * src/lib/coding/doc_check.js — the documentation check of a fixed-format COBOL program against the Code Documentation
 * Standard (S5, the owner's D7 (a) of 2026-10-09 and S5-D8 to S5-D11 of 2026-10-12: comments only, enforced by a tool).
 *
 * Pure (no I/O). A line with "*" or "/" in column 7 is a comment; a floating "*>" comment (outside a literal) is cut from
 * a line of code; blank lines and trailing spaces are set aside. What a tool can verify, it verifies:
 *   DOC-008  no line of code changed: the code lines of the old and the new program are identical, in order;
 *   DOC-001  the header (the comment lines before the first line of code) carries every field of the team's template
 *            (CLR-WIKI-021), its copyright line naming Nexus Bank plc (LEG-POL-001 clause 4.2);
 *   DOC-002  every division, section and paragraph has a comment directly above or directly below its line;
 *   DOC-004  no card number in a comment (a 13 to 19 digit run whose first digit is 2 to 6 and that passes the Luhn check);
 *   DOC-005  no commented-out code (a comment shaped like a statement: a verb, a hyphenated data name, = / TO / FROM).
 * DOC-003 (a comment that contradicts the code) is judgement, not a tool's: the reviewer and the explanation carry it.
 * A comment line running past column 72 is a note: the compiler ignores columns 73 to 80.
 *
 * Measured with the scorer this module follows (inputs/demo-design/evidence/session-90-s5-probe/score_s5.js): the seed
 * fails DOC-001, DOC-002, DOC-004 and DOC-005; the 15 thinking-off answers kept every line of code.
 */

const asString = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const lines = (text) => asString(text).replace(/\r\n/g, "\n").split("\n");

/** A fixed-format comment line: "*" or "/" in column 7. */
function isCommentLine(line) {
  const l = asString(line);
  return l.length >= 7 && (l[6] === "*" || l[6] === "/");
}

/** A line's code, or null when it has none (a comment line, a blank line). A floating "*>" comment is cut. */
function codeOf(line) {
  const l = asString(line);
  if (isCommentLine(l)) return null;
  let out = "";
  let quote = null;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "*" && l[i + 1] === ">") break;
    out += c;
  }
  out = out.replace(/\s+$/, "");
  return out.trim() ? out : null;
}

/** The program's code lines, in order: `[{ line, code }]` (line numbers from 1). */
function codeLines(text) {
  return lines(text)
    .map((l, i) => ({ line: i + 1, code: codeOf(l) }))
    .filter((x) => x.code !== null);
}

/** The first code line that differs between two programs, or null when their code is identical. */
function firstCodeDifference(before, after) {
  const a = codeLines(before);
  const b = codeLines(after);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (!a[i] || !b[i] || a[i].code !== b[i].code) {
      return { index: i, beforeLine: a[i] ? a[i].line : null, before: a[i] ? a[i].code : null, afterLine: b[i] ? b[i].line : null, after: b[i] ? b[i].code : null };
    }
  }
  return null;
}

/** The divisions, sections and paragraphs: a name alone on its line. PROGRAM-ID and DATE-WRITTEN are not units. */
function unitsOf(text) {
  const out = [];
  lines(text).forEach((l, i) => {
    const code = codeOf(l);
    if (!code) return;
    const m = code.match(/^ {7}([A-Z][A-Z0-9-]*(?: DIVISION| SECTION)?)\.\s*$/);
    if (!m || /^(?:PROGRAM-ID|DATE-WRITTEN|AUTHOR|INSTALLATION|DATE-COMPILED|SECURITY)$/.test(m[1])) return;
    out.push({ line: i + 1, name: m[1], kind: / DIVISION$/.test(m[1]) ? "division" : / SECTION$/.test(m[1]) ? "section" : "paragraph" });
  });
  return out;
}

/** The UNITS block for a comments turn's prompt, as measured (session-90-s5-probe, round 3). */
function unitsBlock(relPath, text) {
  return [
    `UNITS (found by a tool in ${relPath}: each needs a purpose comment, directly above or directly below its line)`,
    ...unitsOf(text).map((u) => `- line ${u.line}: ${u.name} (${u.kind})`),
  ].join("\n");
}

/** DOC-001's fields, as the team's template (CLR-WIKI-021) labels them. */
const HEADER_FIELDS = Object.freeze([
  { id: "program", label: "PROGRAM", re: /\bPROGRAM\s*:\s*\S/i },
  { id: "purpose", label: "PURPOSE", re: /\bPURPOSE\s*:\s*\S/i },
  { id: "service", label: "SERVICE", re: /\bSERVICE\s*:\s*\S/i },
  { id: "owner", label: "OWNER", re: /\bOWNER\s*:\s*\S/i },
  { id: "classification", label: "CLASSIFICATION", re: /\bCLASSIFICATION\s*:\s*\S/i },
  { id: "notice", label: "the copyright notice naming Nexus Bank plc", re: /\bCOPYRIGHT\b[^\n]*\bNEXUS BANK PLC\b/i },
  { id: "tradeMark", label: "the trade mark line", re: /\bTRADE ?MARKS?\b/i },
  { id: "history", label: "HISTORY", re: /\bHISTORY\s*:\s*\S/i },
  { id: "requirements", label: "REQUIREMENTS", re: /\bREQUIREMENTS\s*:\s*\S/i },
  { id: "aiAssisted", label: "AI-ASSISTED", re: /\bAI-ASSISTED\s*:\s*\S/i },
]);

/** The header: the comment lines before the first line of code. */
function headerOf(text) {
  const ls = lines(text);
  const first = ls.findIndex((l) => codeOf(l) !== null);
  return ls.slice(0, first < 0 ? ls.length : first).filter(isCommentLine);
}

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Card numbers in a text: 13 to 19 digits (spaces or hyphens between groups allowed) whose first digit is 2 to 6, as every
 * PCI DSS payment brand's card's is, and that pass the Luhn check (S6-D10 (a) of 2026-10-13: sixteen zeros pass Luhn alone).
 */
function cardNumbersIn(text) {
  const out = [];
  for (const m of asString(text).matchAll(/(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/g)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && /^[2-6]/.test(digits) && luhn(digits)) out.push(digits);
  }
  return out;
}

const STATEMENT_RE = /^\s*(?:COMPUTE|MOVE|ADD|SUBTRACT|MULTIPLY|DIVIDE|PERFORM|INITIALIZE|SET)\s+[A-Z0-9-]*-[A-Z0-9-]*\b[^\n]*?\s(?:=|TO|FROM|BY|GIVING|INTO|UNTIL)\s/;

/**
 * The documentation check of `current` against the program it must not change (`seed`). `{ passed, codeUnchanged,
 * firstDifference, header, units, cardNumbers, commentedOutCode, beyondColumn72, rules, findings }`; `findings` are the
 * lines a person (and a repair turn) reads.
 */
function documentationCheck({ seed, current }) {
  const difference = firstCodeDifference(seed, current);
  const ls = lines(current);
  const headerText = headerOf(current).join("\n");
  const present = HEADER_FIELDS.filter((f) => f.re.test(headerText)).map((f) => f.id);
  const missing = HEADER_FIELDS.filter((f) => !present.includes(f.id));
  const otherOwner = (headerText.match(/\bCOPYRIGHT\b[^\n]*/i) || [""])[0].replace(/\s*\*\s*$/, "").trim();
  const units = unitsOf(current).map((u) => {
    let j = u.line - 2;
    while (j >= 0 && !ls[j].trim()) j--;
    let k = u.line;
    while (k < ls.length && !ls[k].trim()) k++;
    return { ...u, commented: (j >= 0 && isCommentLine(ls[j])) || (k < ls.length && isCommentLine(ls[k])) };
  });
  const comments = ls.map((l, i) => ({ line: i + 1, text: l })).filter((x) => isCommentLine(x.text));
  const cardNumbers = comments.filter((c) => cardNumbersIn(c.text).length > 0).map((c) => c.line);
  const commentedOutCode = comments.filter((c) => STATEMENT_RE.test(c.text.slice(7))).map((c) => c.line);
  const beyondColumn72 = comments.filter((c) => c.text.replace(/\s+$/, "").length > 72).map((c) => c.line);
  const rules = {
    "DOC-008": difference === null,
    "DOC-001": missing.length === 0,
    "DOC-002": units.every((u) => u.commented),
    "DOC-004": cardNumbers.length === 0,
    "DOC-005": commentedOutCode.length === 0,
  };
  const findings = [];
  if (difference) {
    findings.push(
      `DOC-008: a line of code changed. The original line ${difference.beforeLine === null ? "(none)" : difference.beforeLine} is ${JSON.stringify(difference.before)}; the program now has ${JSON.stringify(difference.after)}${difference.afterLine ? ` at line ${difference.afterLine}` : ""}.`
    );
  }
  if (missing.length) findings.push(`DOC-001: the header lacks ${missing.map((f) => f.label).join(", ")}.${!present.includes("notice") && otherOwner ? ` Its copyright line reads "${otherOwner}".` : ""}`);
  const uncommented = units.filter((u) => !u.commented);
  if (uncommented.length) findings.push(`DOC-002: ${uncommented.length} of ${units.length} units have no purpose comment directly above or below their line: ${uncommented.map((u) => `${u.name} (line ${u.line})`).join(", ")}.`);
  if (cardNumbers.length) findings.push(`DOC-004: a card number is in the comment on line ${cardNumbers.join(", ")}.`);
  if (commentedOutCode.length) findings.push(`DOC-005: commented-out code on line ${commentedOutCode.join(", ")}.`);
  const notes = beyondColumn72.length ? [`Note: ${beyondColumn72.length} comment line(s) run past column 72 (line ${beyondColumn72.join(", ")}); the compiler ignores columns 73 to 80.`] : [];
  return {
    passed: Object.values(rules).every(Boolean),
    codeUnchanged: difference === null,
    firstDifference: difference,
    header: { present, missing: missing.map((f) => f.id) },
    units: { total: units.length, commented: units.filter((u) => u.commented).length, missing: uncommented.map((u) => u.name) },
    cardNumbers,
    commentedOutCode,
    beyondColumn72,
    rules,
    findings,
    notes,
  };
}

/** The check's report, as the test run's output shows it. */
function reportText(result) {
  const r = result || {};
  const head = r.passed
    ? `Documentation check (STD-DOC): passed. No line of code changed (DOC-008); the header has every field (DOC-001); ${r.units ? `${r.units.commented} of ${r.units.total}` : "every"} units have a purpose comment (DOC-002); no card number (DOC-004) and no commented-out code (DOC-005).`
    : `Documentation check (STD-DOC): FAILED.`;
  return [head, ...(r.findings || []).map((f) => `- ${f}`), ...(r.notes || [])].join("\n");
}

module.exports = { HEADER_FIELDS, isCommentLine, codeOf, codeLines, firstCodeDifference, unitsOf, unitsBlock, headerOf, cardNumbersIn, documentationCheck, reportText };
