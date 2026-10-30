#!/usr/bin/env node
/**
 * T22 (design D5) — build identity.
 *
 * Under a compiled server (`next start`) the pod's `src/` says nothing about
 * what is being served, so "does the pod serve this tree?" needs a value
 * computed from the tree at IMAGE BUILD time and reported by the running
 * server. This script writes `build-info.json` in the app root; GET /api/health
 * returns it (src/lib/build-info.js reads it).
 *
 *   node scripts/write-build-info.js            write build-info.json (the Dockerfile's prod stage)
 *   node scripts/write-build-info.js --print    print the tree hash only (run locally to compare)
 *
 * `srcTreeHash` is the md5 of the sorted "md5  path" lines of every file under
 * src/ and public/demos plus next.config.mjs, package-lock.json, requirements.txt
 * and constraints.txt — the same discipline the audit applied per file, in one
 * string. GIT_SHA / GIT_DIRTY come from the Tiltfile as build args and are
 * informational (a Tilt build is of the working tree, committed or not).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TREE_ROOTS = ["src", path.join("public", "demos")];
const TREE_FILES = ["next.config.mjs", "package-lock.json", "requirements.txt", "constraints.txt"];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    // T23 (F-102): dotfiles are not source — Finder's .DS_Store and ._* files
    // moved the served hash without a source change (2026-09-08).
    if (entry.name.startsWith(".")) continue;
    // T39 (F-153): Python's bytecode cache is not source either — the first
    // import of a module under src/ (T35's ocr_text) wrote one at ingest and
    // moved the pod's own computation off the build's number (2026-09-18).
    if (entry.isDirectory() && entry.name === "__pycache__") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function md5(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

function srcTreeHash() {
  const files = [];
  for (const r of TREE_ROOTS) {
    const abs = path.join(ROOT, r);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  for (const f of TREE_FILES) {
    const abs = path.join(ROOT, f);
    if (fs.existsSync(abs)) files.push(abs);
  }
  const lines = files
    .map((f) => `${md5(fs.readFileSync(f))}  ${path.relative(ROOT, f).split(path.sep).join("/")}`)
    .sort();
  return { hash: md5(lines.join("\n") + "\n"), fileCount: lines.length };
}

function pipVersion(pkg) {
  try {
    const out = execFileSync("python3", ["-m", "pip", "show", pkg], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = out.match(/^Version:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

module.exports = { walk, srcTreeHash, TREE_ROOTS, TREE_FILES };
if (require.main !== module) return;

const tree = srcTreeHash();
if (process.argv.includes("--print")) {
  process.stdout.write(tree.hash + "\n");
  process.exit(0);
}

const info = {
  srcTreeHash: tree.hash,
  srcTreeFiles: tree.fileCount,
  builtAt: new Date().toISOString(),
  gitSha: process.env.GIT_SHA || "unknown",
  gitDirty: process.env.GIT_DIRTY || "unknown",
  node: process.version,
  docling: pipVersion("docling"),
  pypdfium2: pipVersion("pypdfium2"),
  mode: "production",
};
fs.writeFileSync(path.join(ROOT, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
process.stdout.write(`build-info.json written: srcTreeHash ${info.srcTreeHash} (${info.srcTreeFiles} files), docling ${info.docling}, pypdfium2 ${info.pypdfium2}, node ${info.node}\n`);
