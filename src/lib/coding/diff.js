/**
 * src/lib/coding/diff.js — the code change as a unified diff, for the evidence record and the Results panel (PR B; the
 * owner's D1 (b) of 2026-10-07: the code change is shown in the Results panel).
 *
 * Pure (no I/O). Two texts are compared line by line (a longest-common-subsequence table, bounded); the hunks carry the
 * old and new line numbers and three lines of context, the way `git diff` shows them. A pair too large to compare is
 * reported as too large, never guessed.
 */

const CELL_CAP = 4000000;
const CONTEXT = 3;

const linesOf = (t) => {
  const s = typeof t === "string" ? t : "";
  if (!s) return [];
  return (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n");
};

/** The edit script `[{ type: " " | "-" | "+", text, oldNo, newNo }]`, or null when the pair is too large. */
function editScript(a, b) {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > CELL_CAP) return null;
  const w = m + 1;
  const T = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) T[i * w + j] = a[i] === b[j] ? T[(i + 1) * w + j + 1] + 1 : Math.max(T[(i + 1) * w + j], T[i * w + j + 1]);
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: " ", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (T[(i + 1) * w + j] >= T[i * w + j + 1]) {
      out.push({ type: "-", text: a[i], oldNo: i + 1, newNo: null });
      i++;
    } else {
      out.push({ type: "+", text: b[j], oldNo: null, newNo: j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ type: "-", text: a[i], oldNo: ++i, newNo: null });
  while (j < m) out.push({ type: "+", text: b[j], oldNo: null, newNo: ++j });
  return out;
}

/** Group an edit script into hunks with `context` lines around each change: `[{ oldStart, oldLines, newStart, newLines, lines }]`. */
function hunksOf(script, context = CONTEXT) {
  const changed = [];
  script.forEach((l, idx) => {
    if (l.type !== " ") changed.push(idx);
  });
  if (changed.length === 0) return [];
  const ranges = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(script.length - 1, changed[0] + context);
  for (const c of changed.slice(1)) {
    if (c - context <= end + 1) end = Math.min(script.length - 1, c + context);
    else {
      ranges.push([start, end]);
      start = Math.max(0, c - context);
      end = Math.min(script.length - 1, c + context);
    }
  }
  ranges.push([start, end]);
  const before = (s, key) => {
    for (let k = s - 1; k >= 0; k--) if (script[k][key] !== null) return script[k][key];
    return 0;
  };
  return ranges.map(([s, e]) => {
    const lines = script.slice(s, e + 1);
    const firstOld = lines.find((l) => l.oldNo !== null);
    const firstNew = lines.find((l) => l.newNo !== null);
    return {
      oldStart: firstOld ? firstOld.oldNo : before(s, "oldNo"),
      oldLines: lines.filter((l) => l.type !== "+").length,
      newStart: firstNew ? firstNew.newNo : before(s, "newNo"),
      newLines: lines.filter((l) => l.type !== "-").length,
      lines,
    };
  });
}

/**
 * One file's change: `{ path, status: added | modified | deleted, added, removed, hunks, tooLarge }`, or null when the
 * two texts are equal. `before` / `after` null means the file did not exist.
 */
function fileDiff(path, before, after) {
  if (before === after) return null;
  const a = before === null || before === undefined ? [] : linesOf(before);
  const b = after === null || after === undefined ? [] : linesOf(after);
  const status = before === null || before === undefined ? "added" : after === null || after === undefined ? "deleted" : "modified";
  const script = editScript(a, b);
  if (!script) return { path, status, added: null, removed: null, hunks: [], tooLarge: true };
  return {
    path,
    status,
    added: script.filter((l) => l.type === "+").length,
    removed: script.filter((l) => l.type === "-").length,
    hunks: hunksOf(script),
    tooLarge: false,
  };
}

/** The unified diff text of one file's change (for the record's Markdown), at most `maxLines` lines. */
function diffText(fd, { maxLines = 400 } = {}) {
  if (!fd) return "";
  const out = [`--- ${fd.status === "added" ? "/dev/null" : `a/${fd.path}`}`, `+++ ${fd.status === "deleted" ? "/dev/null" : `b/${fd.path}`}`];
  if (fd.tooLarge) {
    out.push("(the file is too large to compare line by line)");
    return out.join("\n");
  }
  for (const h of fd.hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) out.push(`${l.type}${l.text}`);
  }
  if (out.length > maxLines) return [...out.slice(0, maxLines), `… ${out.length - maxLines} more line(s) in the Results panel`].join("\n");
  return out.join("\n");
}

module.exports = { CONTEXT, linesOf, editScript, hunksOf, fileDiff, diffText };
