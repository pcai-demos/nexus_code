/**
 * src/lib/coding/workspace_write.js — the app's own write into the demo workspace, for when the IDE's bridge cannot
 * write (Apply, the evidence record) (2026-10-12).
 *
 * The app container runs as root and the IDE as the coder user (uid 1000, in group 1000, the pod's fsGroup). Whatever
 * the app makes in the shared workspace volume must be group-writable, or the IDE user can neither change nor remove it
 * until the next pod start, when the fsGroup pass fixes the volume: S3's Apply wrote the port's new folders as root,
 * and the next "Reset the demo environment" deleted half the repository before it met them. mkdir's and write's modes
 * are masked by the process umask (022), so each folder made here, and a file made here, is chmod-ed afterwards.
 *
 * The caller contains the path first (paths.js resolveInside): this module never decides where a file may go.
 */
import fs from "fs";
import path from "path";

export const DIR_MODE = 0o2775;
export const FILE_MODE = 0o664;

/** Write `content` to `fullPath`, making missing folders; each folder made, and the file when made, group-writable. */
export function writeGroupWritable(fullPath, content) {
  const missing = [];
  for (let d = path.dirname(fullPath); !fs.existsSync(d); d = path.dirname(d)) {
    if (path.dirname(d) === d) break;
    missing.unshift(d);
  }
  for (const d of missing) {
    fs.mkdirSync(d);
    fs.chmodSync(d, DIR_MODE);
  }
  const existed = fs.existsSync(fullPath);
  fs.writeFileSync(fullPath, content, "utf8");
  if (!existed) fs.chmodSync(fullPath, FILE_MODE);
  return { madeFolders: missing.length, madeFile: !existed };
}
