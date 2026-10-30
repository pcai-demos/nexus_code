/**
 * U-PATH — a request's file path resolves under public/ or is refused
 * (ticket T22, design D11; finding F-59).
 *
 * Before T22 the ingest and unload routes each carried a `resolvePath` that
 * `path.join`ed the request's path onto public/ — and `path.join` collapses
 * "..", so "../package.json" resolved to the repository root. The allow-list
 * of extensions was the only guard, and the API has no auth (T25).
 *
 * Pure-function tests on the shared rule; the routes' 400 is I-DESTRUCT's
 * (unload) and the ingest route's up-front loop, both pinned by source below.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { resolvePublicPath, isUnderPublic, PathOutsidePublicError } = require("../../src/lib/ingestion/paths");
const { INGEST_ERROR_CODES } = require("../../src/lib/ingestion/state");

const ROOT = path.resolve("/srv/app-root");
const PUBLIC = path.join(ROOT, "public");

describe("U-PATH: the lenient spellings the UI relies on all resolve under public/", () => {
  for (const [given, expected] of [
    ["demos/demo_files/x.pdf", path.join(PUBLIC, "demos", "demo_files", "x.pdf")],
    ["/demos/demo_files/x.pdf", path.join(PUBLIC, "demos", "demo_files", "x.pdf")],
    ["public/demos/x.pdf", path.join(PUBLIC, "demos", "x.pdf")],
    ["/public/demos/x.pdf", path.join(PUBLIC, "demos", "x.pdf")],
    ["demos\\demo_files\\x.pdf", path.join(PUBLIC, "demos", "demo_files", "x.pdf")],
    ["demos/./demo_files/x.pdf", path.join(PUBLIC, "demos", "demo_files", "x.pdf")],
    ["demos/a/../b/x.pdf", path.join(PUBLIC, "demos", "b", "x.pdf")],
  ]) {
    test(`${JSON.stringify(given)} → ${expected.replace(ROOT, "<root>")}`, () => {
      assert.strictEqual(resolvePublicPath(given, ROOT), expected);
      assert.strictEqual(isUnderPublic(given, ROOT), true);
    });
  }
});

describe("U-PATH: anything that escapes public/ is refused, typed, before any read", () => {
  for (const given of [
    "../package.json",
    "public/../package.json",
    "/public/../../etc/passwd",
    "demos/../../package.json",
    "..\\package.json",
    "public/../publicX/x.pdf",
    "/", // the root itself is not a file under public/
    "public/", // nor is public/ itself ("public" alone is a FILE named public under public/ — allowed)
    "",
    "   ",
  ]) {
    test(`${JSON.stringify(given)} → PATH_OUTSIDE_PUBLIC`, () => {
      assert.throws(
        () => resolvePublicPath(given, ROOT),
        (err) => err instanceof PathOutsidePublicError && err.code === INGEST_ERROR_CODES.PATH_OUTSIDE_PUBLIC && err.status === 400
      );
      assert.strictEqual(isUnderPublic(given, ROOT), false);
    });
  }

  test("non-string input is refused the same way", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      assert.throws(() => resolvePublicPath(bad, ROOT), (err) => err.code === INGEST_ERROR_CODES.PATH_OUTSIDE_PUBLIC);
    }
  });

  test("the error names the offending path (truncated) and never the root", () => {
    const long = "../" + "a".repeat(400);
    let caught;
    try { resolvePublicPath(long, ROOT); } catch (e) { caught = e; }
    assert.ok(caught.message.includes("does not resolve to a file under public/"));
    assert.ok(!caught.message.includes(ROOT));
    assert.ok(caught.message.length < 400);
  });
});

describe("U-PATH: the routes use the shared rule (source pins — F-37, no component harness)", () => {
  const ingestSrc = fs.readFileSync(path.join(__dirname, "../../src/app/api/ingest/route.js"), "utf8");
  const unloadSrc = fs.readFileSync(path.join(__dirname, "../../src/app/api/ingest/unload/route.js"), "utf8");

  test("both routes import resolvePublicPath and neither keeps a path.join(process.cwd(), …) resolver", () => {
    for (const src of [ingestSrc, unloadSrc]) {
      assert.ok(src.includes('from "@/lib/ingestion/paths"'), "the shared rule is imported");
      assert.ok(src.includes("return resolvePublicPath(filePath);"), "resolvePath delegates to the shared rule");
      assert.ok(!/return path\.join\(process\.cwd\(\), cleanPath\)/.test(src), "the old collapsing resolver is gone");
    }
  });

  test("the ingest route checks EVERY path before the job starts, and answers err.status with err.code", () => {
    const check = ingestSrc.indexOf("for (const p of filePaths) {");
    const jobStart = ingestSrc.indexOf("createJob(");
    assert.ok(check > 0 && jobStart > check, "the path loop precedes job creation");
    assert.ok(ingestSrc.includes("err instanceof PathOutsidePublicError"));
    assert.ok(ingestSrc.includes("{ status: err.status }"));
  });

  test("the unload route refuses before its file-exists check", () => {
    const refusal = unloadSrc.indexOf("err instanceof PathOutsidePublicError");
    const exists = unloadSrc.indexOf("if (!fs.existsSync(resolved))");
    assert.ok(refusal > 0 && exists > refusal);
  });

  test("the crops route (§11a A16) resolves through the same rule and serves nothing outside extracted_images/", () => {
    const cropsSrc = fs.readFileSync(path.join(__dirname, "../../src/app/extracted_images/[...path]/route.js"), "utf8");
    assert.ok(cropsSrc.includes('from "@/lib/ingestion/paths"'), "the shared rule is imported");
    assert.ok(cropsSrc.includes('resolvePublicPath(path.posix.join("extracted_images"'), "the request path is rooted under extracted_images/ before resolution");
    assert.ok(cropsSrc.includes("CROPS_ROOT + path.sep"), "the resolved path must stay inside the crops directory itself");
    assert.ok(cropsSrc.includes('export const dynamic = "force-dynamic"'), "served at request time, never from a build-time index");
  });
});
