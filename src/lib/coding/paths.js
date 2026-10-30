/**
 * src/lib/coding/paths.js — the one containment rule for every file the coding side reads or writes on a caller's
 * say-so (Enablers PR E2; audit findings CA-001 and CA-003, 2026-10-06).
 *
 * Coding-owned, pure (no I/O). Used by:
 *   - src/app/api/ide-bridge/route.js   writeWorkspaceFile  → the workspace root (HTTP 400 on refusal)
 *   - src/app/api/files/preview/route.js GET                 → public/demos/demo_files (HTTP 403 on refusal)
 * src/lib/orchestrator.js:108-120 (writeWorkspaceFile, the model's `# File:` path) carries the SAME three checks
 * inline: that file is frozen except for those lines, so it cannot gain an import; U-PATHS pins both copies.
 *
 * The rule: `relPath` must be a non-empty string, relative (neither a POSIX nor a Windows absolute path), with no
 * `..` segment in either separator style, and the resolved path must lie strictly inside `root`. Symbolic links are
 * not resolved (the demo workspace is the pod's own PVC; the posture is "no gaping holes", not production grade).
 */
import path from "path";

export class PathContainmentError extends Error {
  constructor(message, relPath) {
    super(message);
    this.name = "PathContainmentError";
    this.code = "PATH_OUTSIDE_ROOT";
    this.relPath = relPath;
  }
}

/**
 * Resolve `relPath` under `root` and return the absolute path, or throw PathContainmentError.
 * @param {string} root     the directory every result must lie inside (resolved against process.cwd())
 * @param {string} relPath  the caller's path, relative to `root`; `/` or `\` separators
 * @returns {string}        the absolute path, strictly inside `root`
 */
export function resolveInside(root, relPath) {
  if (typeof relPath !== "string" || relPath.trim() === "" || relPath.includes("\0")) {
    throw new PathContainmentError("a relative file path is required", relPath);
  }
  const normalised = relPath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalised) || path.win32.isAbsolute(relPath) || /^[A-Za-z]:/.test(normalised)) {
    throw new PathContainmentError("an absolute path is refused", relPath);
  }
  if (normalised.split("/").includes("..")) {
    throw new PathContainmentError("a parent segment (..) is refused", relPath);
  }
  const rootAbs = path.resolve(root);
  const full = path.resolve(rootAbs, normalised);
  if (!full.startsWith(rootAbs + path.sep)) {
    throw new PathContainmentError("the path does not name a file inside the root", relPath);
  }
  return full;
}
