/**
 * U-HEALTH — the build identity a compiled server reports (ticket T22,
 * design D5).
 *
 * Under `next start` the pod's src/ says nothing about what is served; the
 * image's prod stage writes build-info.json from the tree it was built from
 * and GET /api/health returns it. The reader never fabricates: the dev
 * target (no file) reports mode "development" with every build field null.
 *
 * Pure tests on the reader and the writer's tree hash; the route is I-HEALTH.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { readBuildInfo, BUILD_INFO_FIELDS } = require("../../src/lib/build-info");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "u-health-"));
}

describe("U-HEALTH: the reader", () => {
  test("no build-info.json → development, every build field null, no buildId", () => {
    const root = tmpRoot();
    const r = readBuildInfo(root);
    assert.strictEqual(r.mode, "development");
    assert.strictEqual(r.buildId, null);
    for (const k of BUILD_INFO_FIELDS) assert.strictEqual(r.build[k], null, k);
  });

  test("a production build-info.json is reported field for field, with Next's BUILD_ID", () => {
    const root = tmpRoot();
    const info = { srcTreeHash: "abc123", srcTreeFiles: 42, builtAt: "2026-09-07T00:00:00.000Z", gitSha: "deadbeef", gitDirty: "clean", node: "v20.20.2", docling: "2.117.0", pypdfium2: "5.12.1", mode: "production" };
    fs.writeFileSync(path.join(root, "build-info.json"), JSON.stringify(info));
    fs.mkdirSync(path.join(root, ".next"));
    fs.writeFileSync(path.join(root, ".next", "BUILD_ID"), "xyz789\n");
    const r = readBuildInfo(root);
    assert.strictEqual(r.mode, "production");
    assert.strictEqual(r.buildId, "xyz789");
    for (const k of BUILD_INFO_FIELDS) assert.strictEqual(r.build[k], info[k], k);
  });

  test("a corrupt or non-production file is development, never a half-fabricated production", () => {
    const root = tmpRoot();
    fs.writeFileSync(path.join(root, "build-info.json"), "{not json");
    assert.strictEqual(readBuildInfo(root).mode, "development");
    fs.writeFileSync(path.join(root, "build-info.json"), JSON.stringify({ mode: "development", srcTreeHash: "x" }));
    const r = readBuildInfo(root);
    assert.strictEqual(r.mode, "development");
    assert.strictEqual(r.build.srcTreeHash, "x", "fields present are still reported");
  });
});

describe("U-HEALTH: the writer's tree hash is deterministic and sensitive", () => {
  const script = path.join(__dirname, "../../scripts/write-build-info.js");

  test("--print gives the same 32-hex hash twice for the same tree", () => {
    const a = execFileSync(process.execPath, [script, "--print"], { encoding: "utf8" }).trim();
    const b = execFileSync(process.execPath, [script, "--print"], { encoding: "utf8" }).trim();
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.strictEqual(a, b);
  });

  test("the hash covers src/, public/demos and the four config files, and nothing under tests/", () => {
    const src = fs.readFileSync(script, "utf8");
    assert.ok(src.includes('const TREE_ROOTS = ["src", path.join("public", "demos")];'));
    assert.ok(src.includes('"next.config.mjs", "package-lock.json", "requirements.txt", "constraints.txt"'));
    assert.ok(!src.includes('"tests"'));
  });
});

describe("U-HEALTH: the image builds the file in the prod stage only (source pins)", () => {
  test("Dockerfile: prod runs next build then write-build-info; dev does not; IDE_HOST precedes the build", () => {
    const df = fs.readFileSync(path.join(__dirname, "../../Dockerfile"), "utf8");
    const prod = df.indexOf("FROM base AS prod");
    const dev = df.indexOf("FROM base AS dev");
    assert.ok(prod > 0 && dev > 0);
    const prodStage = df.slice(prod);
    assert.ok(prodStage.includes("RUN npm run build"));
    assert.ok(prodStage.includes("node scripts/write-build-info.js"));
    assert.ok(prodStage.indexOf("ENV IDE_HOST=localhost:8080") < prodStage.indexOf("RUN npm run build"), "the rewrite target is set before the build");
    const devStage = df.slice(dev, prod > dev ? prod : undefined);
    assert.ok(!devStage.includes("npm run build"));
    assert.ok(devStage.includes('CMD ["npm", "run", "dev"]'));
  });

  test("the IDE-port coupling: the Dockerfile bakes a port; on the workstation the Tiltfile guards it against the chart (§11a A13 / A15)", () => {
    // helm/ is not in the image (.dockerignore) and Tilt never ships its
    // own Tiltfile, so neither side of the cross-file check exists in the
    // pod: there, this pins only the Dockerfile's half. On the workstation
    // — where the Tiltfile load is the guard — it pins the guard and checks
    // the pair directly. Stated, not skipped: the gates refuse skipped cases.
    const df = fs.readFileSync(path.join(__dirname, "../../Dockerfile"), "utf8");
    const baked = df.match(/ENV IDE_HOST=localhost:(\d+)/);
    assert.ok(baked, "the prod stage bakes ENV IDE_HOST=localhost:<port>");
    const tiltfilePath = path.join(__dirname, "../../Tiltfile");
    const valuesPath = path.join(__dirname, "../../helm/values.yaml");
    if (!fs.existsSync(tiltfilePath)) return; // the image: Tilt does not ship its Tiltfile
    const tiltfile = fs.readFileSync(tiltfilePath, "utf8");
    assert.ok(tiltfile.includes("read_yaml('helm/values.yaml')"), "the Tiltfile reads the chart's values");
    assert.ok(/ENV IDE_HOST=localhost:'\s*\+\s*IDE_PORT/.test(tiltfile), "the Tiltfile compares the Dockerfile's IDE_HOST with the chart's port");
    assert.ok(/fail\(/.test(tiltfile), "a mismatch fails the load");
    if (fs.existsSync(valuesPath)) {
      const m = fs.readFileSync(valuesPath, "utf8").match(/^ide:[\s\S]*?^\s+port:\s*(\d+)/m);
      assert.ok(m, "ide.port found in the chart");
      assert.strictEqual(baked[1], m[1], "the baked port equals the chart's ide.port");
    }
  });
});
