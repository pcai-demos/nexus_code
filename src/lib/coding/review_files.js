/**
 * src/lib/coding/review_files.js — the files a pull request review reads (S2), shared by the coding turn (the review
 * step's checks) and the scenarios route (the record's re-check after the fix).
 *
 * Reads only: main's copy of each changed file from the seed the image ships (public/demos/seed/nexus-payments, the
 * base every pull request branch is built on), the pull request's copy from the workspace (the branch Select checked
 * out, with any fix the presenter applied), the approved-dependencies list and the repository's test files. Every path
 * goes through the containment rule.
 */
import fs from "fs";
import path from "path";
import { resolveInside } from "./paths";
import { isTest } from "./scanner";

export const SEED_PREFIX = "nexus-payments/";
const SKIP_DIRS = new Set([".git", "dist", "node_modules", "__pycache__"]);
const workspaceRoot = () => path.join(process.cwd(), "nexcode-data", "workspace");
const seedRoot = () => path.join(process.cwd(), "public", "demos", "seed", "nexus-payments");

const readUnder = (root, rel) => {
  try {
    return fs.readFileSync(resolveInside(root, rel), "utf8");
  } catch {
    return null;
  }
};

/** main's copy of a file (repository path), or null when main has none. */
export const readSeedText = (rel) => readUnder(seedRoot(), rel);
/** The workspace's copy of a file (workspace path), or null. */
export const readWorkspaceText = (rel) => readUnder(workspaceRoot(), rel);

/** The repository's test files in the workspace, as repository paths. */
export function listTestFiles() {
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > 8) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), `${rel}${e.name}/`, depth + 1);
      } else if (isTest(`${rel}${e.name}`)) out.push(`${rel}${e.name}`);
    }
  };
  walk(path.join(workspaceRoot(), SEED_PREFIX), "", 0);
  return out.sort();
}

/** The pull request as the checks read it: `{ files: [{ path, before, after }], approved, testPaths }` (repository paths). */
export function changeOf(scenario) {
  const changed = scenario && scenario.review && Array.isArray(scenario.review.changed) ? scenario.review.changed : [];
  const files = changed.map((ws) => {
    const rel = ws.startsWith(SEED_PREFIX) ? ws.slice(SEED_PREFIX.length) : ws;
    return { path: rel, before: readSeedText(rel), after: readWorkspaceText(ws) };
  });
  let approved = null;
  try {
    approved = JSON.parse(readWorkspaceText(`${SEED_PREFIX}approved-dependencies.json`) || "null");
  } catch {
    approved = null;
  }
  return { files, approved, testPaths: listTestFiles() };
}

/** Each changed file's line count in the workspace (workspace paths), for reading the model's locations. */
export function changedLineCounts(scenario) {
  const changed = scenario && scenario.review && Array.isArray(scenario.review.changed) ? scenario.review.changed : [];
  return changed.map((ws) => {
    const t = readWorkspaceText(ws);
    return { path: ws, lineCount: t ? t.replace(/\n$/, "").split("\n").length : 0 };
  });
}

