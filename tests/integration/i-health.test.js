/**
 * I-HEALTH — the running server says what it was built from (ticket T22,
 * design D5).
 *
 * Under `next start` the pod's src/ says nothing about what is served; the
 * image's prod stage writes build-info.json and GET /api/health returns it.
 * This suite runs IN the pod (like every I-* suite) so it can compute the
 * tree hash from the same files the server was built from and compare.
 *
 * On the dev target (next dev) there is no build-info.json: the route must
 * say "development" with null build fields — never a fabricated hash.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { envConfig, skipReason } = require("./_harness");

const config = envConfig();
const SKIP = skipReason();
const APP_ROOT = process.cwd();

async function health() {
  const res = await fetch(`${config.appUrl}/api/health`, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}

describe("I-HEALTH: GET /api/health", () => {
  test("answers 200 with the documented shape", { skip: SKIP }, async () => {
    const r = await health();
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.ok, true);
    assert.ok(["production", "development"].includes(r.json.mode), r.text);
    assert.ok(typeof r.json.uptimeSec === "number" && r.json.uptimeSec >= 0);
    assert.ok(typeof r.json.rssMi === "number" && r.json.rssMi > 0);
    assert.match(r.json.node, /^v\d+\.\d+\.\d+$/);
    for (const k of ["srcTreeHash", "srcTreeFiles", "builtAt", "gitSha", "gitDirty", "node", "docling", "pypdfium2"]) assert.ok(k in r.json.build, `build.${k}`);
  });

  test("production: the tree hash equals what the tree computes now, and buildId is Next's BUILD_ID", { skip: SKIP }, async () => {
    const r = await health();
    const hasInfo = fs.existsSync(path.join(APP_ROOT, "build-info.json"));
    if (!hasInfo) {
      assert.strictEqual(r.json.mode, "development", "no build-info.json must read as development");
      for (const k of Object.keys(r.json.build)) assert.strictEqual(r.json.build[k], null, `build.${k} must be null on the dev target`);
      return;
    }
    assert.strictEqual(r.json.mode, "production");
    const local = execFileSync(process.execPath, [path.join(APP_ROOT, "scripts", "write-build-info.js"), "--print"], { encoding: "utf8", cwd: APP_ROOT }).trim();
    assert.strictEqual(r.json.build.srcTreeHash, local, "the served build was made from the tree in this image");
    const buildId = fs.readFileSync(path.join(APP_ROOT, ".next", "BUILD_ID"), "utf8").trim();
    assert.strictEqual(r.json.buildId, buildId);
    assert.match(r.json.build.docling, /^\d+\.\d+\.\d+$/);
    assert.match(r.json.build.pypdfium2, /^\d+\.\d+\.\d+$/);
    assert.strictEqual(r.json.build.node, r.json.node, "built and running on the same Node");
  });

  test("the route is read-only: no credential, no host in the body", { skip: SKIP }, async () => {
    const r = await health();
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(r.text), "no JWT-shaped value");
    assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(r.text), "no LiteLLM-shaped value");
    // T23: `credentials` names the KIND "weaviate"; a host is a dotted name.
    assert.ok(!/\b(weaviate|ollama)\.[a-z0-9-]+|serving\./i.test(r.text), "no service host");
  });

  test("T23 (design D1 / D6): `credentials` names the SOURCE per endpoint kind — presence only", { skip: SKIP }, async () => {
    const r = await health();
    assert.ok(r.json.credentials && typeof r.json.credentials === "object", "credentials present");
    assert.deepStrictEqual(Object.keys(r.json.credentials), ["chat", "embed", "rerank", "litellm", "weaviate"]);
    for (const [k, v] of Object.entries(r.json.credentials)) assert.ok(["env", "workload", "none"].includes(v), `${k}: ${v}`);
    // In the pod the suite shares the server's env, so what the server says
    // must agree with what this process can see (names only).
    for (const k of ["chat", "embed", "rerank", "litellm"]) {
      if (process.env[`NEXCODE_${k.toUpperCase()}_TOKEN`] && process.env[`NEXCODE_${k.toUpperCase()}_URL`]) assert.strictEqual(r.json.credentials[k], "env", `${k} is served from the Secret`);
    }
    if (process.env.NEXCODE_WEAVIATE_URL) {
      const expected = process.env.NEXCODE_WEAVIATE_TOKEN ? "env" : fs.existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token") ? "workload" : "none";
      assert.strictEqual(r.json.credentials.weaviate, expected, "the store: the override, else the pod's own identity");
    }
  });
});
