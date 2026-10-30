/**
 * src/lib/coding/code_restore.js — a comments-only answer's code, kept as the program had it (S5, the owner's S5-D14 (a)
 * of 2026-10-12). NexCODE gives the program back whole with its comments changed; this tool keeps every line of code as
 * the program had it, and says which lines it had to put back. The documentation check (doc_check.js) then verifies the
 * result as it verifies any change: DOC-008 holds because the tool kept the code, and the record says the tool did.
 *
 * Pure (no I/O). Fixed-format COBOL, read as doc_check.js reads it: a line with "*" or "/" in column 7 is a comment, a
 * floating "*>" comment is cut from a line of code, blank lines and trailing spaces are set aside. The answer's code lines
 * are aligned with the program's by a longest common subsequence:
 *   - an aligned line is kept as the answer wrote it (its code is the program's; a floating comment may differ);
 *   - a line the answer changed takes the program's line back ("changed");
 *   - a line the answer lost is put back ("lost"): a division, section or paragraph line directly before the answer's
 *     next aligned code line, so the comment written for it stays above it; any other line directly after the previous
 *     aligned code line;
 *   - a line of code the answer added is removed ("added").
 * Comment and blank lines stay where the answer put them. An answer that would need more than RESTORE_MAX_LINES lines put
 * back is not a comments-only change: it is returned as written (`refused`), for the check to judge.
 *
 * Measured before the change (inputs/demo-design/evidence/session-90-s5-measure/, restore_code.js): of 35 answers, the
 * 30 with no slip came back byte-identical; the 5 slips (a changed token, a paragraph line replaced by its own comment,
 * a bare "* PAY-012" after a statement) were each put right, every comment kept; each restored program compiled and
 * printed the expected totals.
 *
 *   restoreCode(original, answer)  { text, restored: [{ kind, originalLine, answerLine, was, now }], refused }
 */

const { codeOf } = require("./doc_check");

const RESTORE_MAX_LINES = 5;
const UNIT_RE = /^ {7}[A-Z][A-Z0-9-]*(?: DIVISION| SECTION)?\.\s*$/;
const NOT_UNIT_RE = /^ {7}(?:PROGRAM-ID|DATE-WRITTEN|AUTHOR|INSTALLATION|DATE-COMPILED|SECURITY)\b/;

const linesOf = (text) => String(typeof text === "string" ? text : "").replace(/\r\n/g, "\n").split("\n");
const isUnit = (line) => {
  const code = codeOf(line);
  return Boolean(code) && UNIT_RE.test(code) && !NOT_UNIT_RE.test(code);
};

function restoreCode(original, answer) {
  const S = linesOf(original);
  const M = linesOf(answer);
  const sc = S.map((l, i) => ({ i, code: codeOf(l) })).filter((x) => x.code !== null);
  const mc = M.map((l, i) => ({ i, code: codeOf(l) })).filter((x) => x.code !== null);
  const n = sc.length;
  const m = mc.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let a = n - 1; a >= 0; a--) for (let b = m - 1; b >= 0; b--) dp[a][b] = sc[a].code === mc[b].code ? dp[a + 1][b + 1] + 1 : Math.max(dp[a + 1][b], dp[a][b + 1]);
  // The edit script over code lines: E (aligned), L (the program's line, lost), A (the answer's line, not the program's).
  const ops = [];
  for (let a = 0, b = 0; a < n || b < m; ) {
    if (a < n && b < m && sc[a].code === mc[b].code) ops.push({ k: "E", s: a++, m: b++ });
    else if (b >= m || (a < n && dp[a + 1][b] >= dp[a][b + 1])) ops.push({ k: "L", s: a++ });
    else ops.push({ k: "A", m: b++ });
  }
  const before = new Map();
  const after = new Map();
  const replaced = new Map();
  const restored = [];
  const push = (map, k, v) => map.set(k, [...(map.get(k) || []), v]);
  ops.forEach((op, k) => {
    if (op.k !== "L") return;
    const line = S[sc[op.s].i];
    // A substitution: a lost line beside a line the answer changed takes that line's place.
    const sub = [ops[k - 1], ops[k + 1]].find((o) => o && o.k === "A" && !replaced.has(mc[o.m].i));
    if (sub) {
      replaced.set(mc[sub.m].i, line);
      restored.push({ kind: "changed", originalLine: sc[op.s].i + 1, answerLine: mc[sub.m].i + 1, was: M[mc[sub.m].i], now: line });
      return;
    }
    const prev = ops.slice(0, k).reverse().find((o) => o.k === "E");
    const next = ops.slice(k + 1).find((o) => o.k === "E");
    if (isUnit(line) && next) push(before, mc[next.m].i, line);
    else if (prev) push(after, mc[prev.m].i, line);
    else if (next) push(before, mc[next.m].i, line);
    else push(after, M.length - 1, line);
    restored.push({ kind: "lost", originalLine: sc[op.s].i + 1, answerLine: null, was: null, now: line });
  });
  for (const op of ops) if (op.k === "A" && !replaced.has(mc[op.m].i)) restored.push({ kind: "added", originalLine: null, answerLine: mc[op.m].i + 1, was: M[mc[op.m].i], now: null });
  if (restored.length > RESTORE_MAX_LINES) return { text: String(answer), restored: [], refused: { lines: restored.length, max: RESTORE_MAX_LINES } };
  if (restored.length === 0) return { text: String(answer), restored: [], refused: null };
  const aligned = new Set(ops.filter((o) => o.k === "E").map((o) => mc[o.m].i));
  const out = [];
  M.forEach((line, i) => {
    for (const l of before.get(i) || []) out.push(l);
    if (aligned.has(i)) out.push(line);
    else if (replaced.has(i)) out.push(replaced.get(i));
    else if (codeOf(line) === null) out.push(line);
    for (const l of after.get(i) || []) out.push(l);
  });
  restored.sort((x, y) => (x.originalLine || x.answerLine) - (y.originalLine || y.answerLine));
  return { text: out.join("\n"), restored, refused: null };
}

/** What the chat says when the tool put code back: the lines by the program's numbering, in plain words. */
function restoredNote(restored, path) {
  const list = Array.isArray(restored) ? restored : [];
  if (!list.length) return "";
  const name = String(path || "the program").split("/").pop();
  const parts = list.map((r) => {
    if (r.kind === "changed") return `line ${r.originalLine} (NexCODE's copy changed it)`;
    if (r.kind === "lost") return `line ${r.originalLine} (NexCODE's copy left it out)`;
    return `a line of code NexCODE's copy added at its line ${r.answerLine} (removed)`;
  });
  return `> 🛠️ A tool kept ${name}'s code as it was (DOC-008): it put back ${parts.join("; ")}. The proposed change in the IDE changes comments only.`;
}

module.exports = { RESTORE_MAX_LINES, restoreCode, restoredNote };
