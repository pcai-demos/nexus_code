/**
 * src/lib/coding/chat_text.js — what the chat shows of a coding answer, and what goes to the IDE (presenter flow; the
 * owner's direction of 2026-10-07: the chat is for the human-readable identification of a problem, the
 * recommendation, and how the issue and the fix bear on corporate and regulatory compliance; all code belongs in the
 * IDE window).
 *
 * Pure (no I/O).
 *   chatText(answer, { mode })   the answer without its fenced code: a File block becomes one line naming the file the
 *                                IDE shows as a proposed change; any other fenced block becomes a short note. The full
 *                                answer stays in the run log.
 *   streamingChatText(text)      the same for an answer still arriving: an open fence reads "Writing <file> for the IDE".
 *                                S4 (2026-10-12): an audit answer writes no code, so a block in it with no language and no
 *                                `File:` header (a diagram of the chain) stays in the chat as written.
 *   parseLocations(text, files)  `path:line` and `path:start-end` mentions of attached files, checked against their
 *                                line counts, for the "show in the IDE" chips.
 *   diffStat(before, after)      lines added and removed (a longest-common-subsequence count over lines).
 *   numberLines(text)            the file with its line numbers, for a diagnosis turn: the model reads a line number
 *                                instead of counting one.
 */

const { HEADER_LINE_RE } = require("./file_ops");

const ABOVE_FENCE_LINE_RE = /^[ \t]*(?:#{1,6}[ \t]+|\/\/[ \t]*|--[ \t]*|\*>[ \t]*)?(?:\*\*)?File:(?:\*\*)?[ \t]*`?([^`\n]+?)`?[ \t]*$/;
const LOCATION_SOURCE = "((?:[A-Za-z0-9_.-]+\\/)*[A-Za-z0-9_.-]+\\.[A-Za-z0-9]{1,6}):(\\d{1,6})(?:[ \\t]*[-–][ \\t]*(\\d{1,6}))?";
const DIFF_CELL_CAP = 4000000;

/** The fenced blocks of a text, in order: `{ start, end, body, closed }`; an unclosed fence runs to the end. */
function fencedBlocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("```", i);
    if (open < 0) break;
    const lineEnd = text.indexOf("\n", open);
    const bodyStart = lineEnd < 0 ? text.length : lineEnd + 1;
    const close = text.indexOf("```", bodyStart);
    const info = text.slice(open + 3, lineEnd < 0 ? text.length : lineEnd).trim();
    if (close < 0) {
      out.push({ start: open, end: text.length, body: text.slice(bodyStart), closed: false, info });
      break;
    }
    out.push({ start: open, end: close + 3, body: text.slice(bodyStart, close), closed: true, info });
    i = close + 3;
  }
  return out;
}

/** The file a block writes (its own header, or a `File:` line directly above the fence), and where that line starts. */
function blockFile(text, block) {
  const lines = block.body.split("\n");
  const first = lines[0] && lines[0].startsWith("#!") ? lines[1] : lines[0];
  const own = typeof first === "string" ? first.match(HEADER_LINE_RE) : null;
  if (own) return { path: own[1].trim(), aboveStart: null };
  const head = text.slice(0, block.start);
  const trimmed = head.endsWith("\n") ? head.slice(0, -1) : head;
  const lineStart = trimmed.lastIndexOf("\n") + 1;
  const above = trimmed.slice(lineStart).match(ABOVE_FENCE_LINE_RE);
  if (above) return { path: above[1].trim(), aboveStart: lineStart };
  return { path: null, aboveStart: null };
}

const baseName = (p) => String(p || "").split("/").pop();

function noteFor(file, block, { mode, streaming }) {
  // S2: a review's own findings list becomes the findings table (it is removed from the finished answer).
  if (/^findings\b/i.test(block.info || "")) return streaming && !block.closed ? "> 📋 Listing the findings for the table…" : "> 📋 The findings are in the table below and on their lines in the IDE.";
  if (streaming && !block.closed) return file ? `> ✍️ Writing \`${baseName(file)}\` for the IDE…` : "> ✍️ Writing code for the IDE…";
  if (mode === "explain") return "> Code left out of the chat: this step explains the problem and the recommendation; the change itself comes in the next step.";
  if (mode === "review") return "> Code left out of the chat: this step reviews the pull request; the fixes come in the next step.";
  if (mode === "audit") return "> Code left out of the chat: this step answers a question about the rules; it changes no code.";
  // PR B (D6): the file's name only; the full workspace path overflowed the chat column.
  if (!block.closed) return file ? `> The proposed change to \`${baseName(file)}\` was cut off before it was complete: ask again.` : "> Code left out of the chat.";
  return file ? `> 📄 Proposed change to \`${baseName(file)}\`: review it in the IDE, then Apply.` : "> Code left out of the chat: the code belongs in the IDE.";
}

function render(answer, { mode = "change", streaming = false } = {}) {
  const text = typeof answer === "string" ? answer : "";
  if (!text) return "";
  const blocks = fencedBlocks(text);
  if (blocks.length === 0) return text.trim();
  let out = "";
  let at = 0;
  let lastNote = null;
  for (const b of blocks) {
    const { path: file, aboveStart } = blockFile(text, b);
    if (mode === "audit" && !file && /^(?:text|txt|plaintext)?$/i.test(b.info || "")) {
      out += text.slice(at, b.end);
      lastNote = null;
      at = b.end;
      continue;
    }
    const cut = aboveStart !== null && aboveStart >= at ? aboveStart : b.start;
    const between = text.slice(at, cut);
    const note = noteFor(file, b, { mode, streaming });
    // Back-to-back blocks with the same note (only white space between them) show the note once.
    if (!(note === lastNote && between.trim() === "")) {
      out += between;
      out += `\n\n${note}\n\n`;
    }
    lastNote = note;
    at = b.end;
  }
  out += text.slice(at);
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The chat's text of a finished answer (design: code goes to the IDE). */
function chatText(answer, { mode = "change" } = {}) {
  return render(answer, { mode, streaming: false });
}

/** The chat's text of an answer still arriving (the turn's mode, as the finished answer will have it). */
function streamingChatText(text, { mode = "change" } = {}) {
  return render(text, { mode, streaming: true });
}

/**
 * `[{ path, startLine, endLine, label }]` for the `path:line` / `path:start-end` mentions of the given files (each
 * `{ path, lineCount }`); a mention may name the path's tail (services/x.py for nexus-payments/services/x.py). Lines
 * outside the file are dropped; at most `max`, the first mention of each range kept.
 */
function parseLocations(text, files, { max = 8 } = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === "string" && Number.isInteger(f.lineCount) && f.lineCount > 0);
  const re = new RegExp(LOCATION_SOURCE, "g");
  const src = typeof text === "string" ? text : "";
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(src)) !== null && out.length < max) {
    const token = m[1];
    const f = list.find((x) => x.path === token || x.path.endsWith(`/${token}`));
    if (!f) continue;
    const start = Number(m[2]);
    if (start < 1 || start > f.lineCount) continue;
    let end = m[3] ? Number(m[3]) : start;
    if (end < start) end = start;
    end = Math.min(end, f.lineCount);
    const key = `${f.path}:${start}-${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: f.path, startLine: start, endLine: end, label: `${baseName(f.path)}:${start}${end > start ? `-${end}` : ""}` });
  }
  return out;
}

const linesOf = (t) => {
  const s = typeof t === "string" ? t : "";
  if (!s) return [];
  return (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n");
};

/** `{ added, removed, isNew }`: the lines a proposal adds and removes against the current file (null = a new file). */
function diffStat(before, after) {
  const b = linesOf(after);
  if (before === null || before === undefined) return { added: b.length, removed: 0, isNew: true };
  const a = linesOf(before);
  let common;
  if (a.length * b.length <= DIFF_CELL_CAP) {
    let prev = new Uint32Array(b.length + 1);
    let cur = new Uint32Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      const t = prev;
      prev = cur;
      cur = t;
    }
    common = prev[b.length];
  } else {
    const counts = new Map();
    for (const l of a) counts.set(l, (counts.get(l) || 0) + 1);
    common = 0;
    for (const l of b) {
      const n = counts.get(l) || 0;
      if (n > 0) {
        common += 1;
        counts.set(l, n - 1);
      }
    }
  }
  return { added: b.length - common, removed: a.length - common, isNew: false };
}

/** The text with right-aligned line numbers: "  78 | code". */
function numberLines(text) {
  const lines = linesOf(text);
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width, " ")} | ${l}`).join("\n");
}

module.exports = { fencedBlocks, chatText, streamingChatText, parseLocations, diffStat, numberLines };
