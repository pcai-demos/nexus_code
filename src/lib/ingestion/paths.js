/**
 * T22 (design D11, finding F-59) — the one rule for a request's file path.
 *
 * The ingest and unload routes each carried a `resolvePath` that stripped a
 * leading "/", prefixed "public/" and `path.join`ed onto the app root — and
 * `path.join` collapses "..", so "../package.json" resolved to the repository
 * root and the allow-list of extensions was all that stood between a request
 * and any file on the pod (F-59; the API has no auth, T25). The demo UI never
 * sends such a path; the API accepted it.
 *
 * `resolvePublicPath` keeps the lenient spelling the UI relies on (with or
 * without a leading "/", with or without "public/", Windows separators) and
 * REFUSES any path whose resolution escapes <root>/public. Pure: no I/O.
 */
const path = require("path");
const { INGEST_ERROR_CODES } = require("./state");

class PathOutsidePublicError extends Error {
  constructor(filePath) {
    super(
      `Refused: '${String(filePath).slice(0, 200)}' does not resolve to a file under public/. ` +
        `Ingest and unload paths are relative to public/ and may not escape it.`
    );
    this.name = "PathOutsidePublicError";
    this.code = INGEST_ERROR_CODES.PATH_OUTSIDE_PUBLIC;
    this.status = 400;
  }
}

/**
 * @param {string} filePath  the request's path ("demos/demo_files/x.pdf", "/public/demos/…", "public\\demos\\…")
 * @param {string} [root]    the app root (default process.cwd())
 * @returns {string}         the absolute path, guaranteed to be under <root>/public
 * @throws {PathOutsidePublicError}
 */
function resolvePublicPath(filePath, root = process.cwd()) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new PathOutsidePublicError(filePath);
  let cleanPath = filePath.replace(/\\/g, "/");
  if (cleanPath.startsWith("/")) cleanPath = cleanPath.slice(1);
  if (!cleanPath.startsWith("public/")) cleanPath = path.posix.join("public", cleanPath);
  const publicRoot = path.resolve(root, "public");
  const resolved = path.resolve(root, cleanPath);
  // Under public/ means: equal to the root is NOT a file, and a sibling that
  // merely starts with "public" (e.g. "publicX") is not inside it.
  if (resolved === publicRoot || !resolved.startsWith(publicRoot + path.sep)) {
    throw new PathOutsidePublicError(filePath);
  }
  return resolved;
}

/** True when the path resolves under public/; never throws. */
function isUnderPublic(filePath, root = process.cwd()) {
  try {
    resolvePublicPath(filePath, root);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { resolvePublicPath, isUnderPublic, PathOutsidePublicError };
