/**
 * T22 (design D5) — what the running server was built from.
 *
 * `build-info.json` is written by scripts/write-build-info.js in the image's
 * `prod` stage (after `next build`). The `dev` target has no such file, and
 * says so: `mode: "development"` with every build field null — never a
 * fabricated value. `buildId` is Next's own .next/BUILD_ID when it exists.
 *
 * Pure with respect to the request: reads files, no network, no state.
 */
const fs = require("fs");
const path = require("path");

const BUILD_INFO_FIELDS = Object.freeze(["srcTreeHash", "srcTreeFiles", "builtAt", "gitSha", "gitDirty", "node", "docling", "pypdfium2"]);

function readJsonIfPresent(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

function readTextIfPresent(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() || null : null;
  } catch (e) {
    return null;
  }
}

/**
 * @param {string} [root]  the app root (default process.cwd())
 * @returns {{ mode: "production"|"development", buildId: string|null, build: object }}
 */
function readBuildInfo(root = process.cwd()) {
  const info = readJsonIfPresent(path.join(root, "build-info.json"));
  const build = {};
  for (const k of BUILD_INFO_FIELDS) build[k] = info && info[k] !== undefined ? info[k] : null;
  const buildId = readTextIfPresent(path.join(root, ".next", "BUILD_ID"));
  return {
    mode: info && info.mode === "production" ? "production" : "development",
    buildId,
    build,
  };
}

module.exports = { readBuildInfo, BUILD_INFO_FIELDS };
