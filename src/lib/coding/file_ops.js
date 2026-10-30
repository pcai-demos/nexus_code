/**
 * src/lib/coding/file_ops.js — the files an answer proposes (Machinery PR 1, design §4 step 8).
 *
 * Pure (no I/O). A fenced code block whose first line (after an optional shebang) is a `File:` comment in the
 * language's own style — `# File: p` (Python, shell, YAML), `// File: p` (JS, TS, Java, C, Rust, Go), `-- File: p`
 * (SQL), `*> File: p` (COBOL) — or that follows a `File: p` line directly above the fence, is a proposed write of the
 * WHOLE file. The shape `{ type: "writeFile", path, content, language }` is the orchestrator's, so ChatPanel's Apply and
 * the bridge route's contained write handle it unchanged. Nothing is written here: a file reaches the workspace only
 * when the presenter clicks Apply (the old code path wrote it unasked, orchestrator.js:2188-2196). A path that is not
 * a plain relative path inside the workspace is refused here as well as at Apply.
 */

const HEADER_LINE_RE = /^\s*(?:#|\/\/|--|\*>)\s*File:\s*`?([^`\s][^`]*?)`?\s*$/;
const ABOVE_FENCE_RE = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]+|\/\/[ \t]*|--[ \t]*|\*>[ \t]*)?(?:\*\*)?File:(?:\*\*)?[ \t]*`?([^`\n]+?)`?[ \t]*\n?$/;

/** The path as a clean relative workspace path, or null when it is absolute, has a `..` segment or is empty. */
function safeRelativePath(p) {
  if (typeof p !== "string" || !p.trim() || p.includes("\0")) return null;
  let s = p.trim().replace(/\\/g, "/");
  if (s.startsWith("/") || /^[A-Za-z]:/.test(s)) return null;
  const parts = s.split("/").filter((x) => x !== "" && x !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  s = parts.join("/");
  return s;
}

/** `{ operations, refused }` — the whole-file writes an answer proposes, first one per path. */
function parseFileOperations(answer) {
  const text = typeof answer === "string" ? answer : "";
  const operations = [];
  const refused = [];
  const seen = new Set();
  const fence = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(text)) !== null) {
    const language = m[1] || "plaintext";
    const lines = m[2].split("\n");
    let headerIdx = -1;
    let filePath = null;
    const firstCode = lines[0] && lines[0].startsWith("#!") ? 1 : 0;
    for (let i = firstCode; i < Math.min(lines.length, firstCode + 1); i++) {
      const h = lines[i].match(HEADER_LINE_RE);
      if (h) {
        headerIdx = i;
        filePath = h[1].trim();
      }
    }
    if (headerIdx < 0) {
      const before = text.slice(Math.max(0, m.index - 240), m.index);
      const h = before.match(ABOVE_FENCE_RE);
      if (h) filePath = h[1].trim();
    }
    if (!filePath) continue;
    const clean = safeRelativePath(filePath);
    if (!clean) {
      refused.push({ path: filePath, reason: "not a relative path inside the workspace" });
      continue;
    }
    if (seen.has(clean)) continue;
    seen.add(clean);
    const body = (headerIdx >= 0 ? lines.filter((_, i) => i !== headerIdx) : lines).join("\n").replace(/\s+$/, "");
    operations.push({ type: "writeFile", path: clean, content: `${body}\n`, language });
  }
  return { operations, refused };
}

module.exports = { HEADER_LINE_RE, safeRelativePath, parseFileOperations };
