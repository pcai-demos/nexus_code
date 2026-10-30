/**
 * U-SECRETS — the acceptance check of ticket T23 (design D12): the tree
 * carries no credential.
 *
 * The ticket's own check is `grep -rn "eyJhbGciOi" src/ | wc -l` → 0; it is
 * necessary but not sufficient — it misses a LiteLLM key (`sk-…`, live in
 * page.js until T23) and, widened to tests/, it would flag U-TRACE's
 * synthetic JWTs. So this suite DECODES: a JWT-shaped string is a finding
 * only when its payload carries the claims a real token has (a Kubernetes
 * service-account claim, `iss`, `sub`, `exp`, `aud`, `iat`); a synthetic
 * `{"fake":"u1"}` passes by construction, with no allow-list to maintain.
 *
 * Runs in gate 1 in-pod on the image's tree (src/, tests/, scripts/, helm/
 * and the root files; inputs/ is not in the image) and locally over the
 * working tree, where inputs/ is scanned too — except inputs/tokens/, which
 * is gitignored and is where the owner keeps the real values for
 * scripts/secrets/apply-credentials.sh. Findings are reported as
 * file:line:count; never a value.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".venv", "__pycache__", "nexcode-data", "scratch", "tokens", "extracted_images", "uploads"]);
const TEXT = /\.(js|jsx|mjs|cjs|ts|tsx|json|jsonl|yaml|yml|sh|md|txt|py|env|toml|cfg|ini|html|css|tpl|log)$/;
const BARE = new Set(["Dockerfile", "Dockerfile.ide", "Tiltfile", ".dockerignore", ".tiltignore", ".gitignore"]);
const MAX_BYTES = 8 * 1024 * 1024;

const JWT_SHAPE = /\beyJ[A-Za-z0-9_-]{2,}\.([A-Za-z0-9_-]{2,})\.[A-Za-z0-9_-]*/g;
const CLAIMS = ["kubernetes.io", "iss", "sub", "exp", "aud", "iat", "nbf", "jti"];
const LITELLM_SHAPE = /\bsk-[A-Za-z0-9_-]{16,}\b/g;
const BAKED_SHAPE = /NEXT_PUBLIC_[A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD)/g;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
      continue;
    }
    if (!e.isFile()) continue;
    if (TEXT.test(e.name) || BARE.has(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

function scanRoots() {
  const roots = ["src", "tests", "scripts", "helm", "public/demos"].map((r) => path.join(REPO_ROOT, r)).filter((p) => fs.existsSync(p));
  const inputs = path.join(REPO_ROOT, "inputs");
  if (fs.existsSync(inputs)) roots.push(inputs);
  const files = [];
  for (const r of roots) walk(r, files);
  for (const e of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (e.isFile() && (TEXT.test(e.name) || BARE.has(e.name))) files.push(path.join(REPO_ROOT, e.name));
  }
  return files;
}

/** true when the JWT's payload decodes to an object carrying a real claim. */
function looksReal(payloadSegment) {
  try {
    const json = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    if (!json || typeof json !== "object") return false;
    return Object.keys(json).some((k) => CLAIMS.includes(k) || k.startsWith("kubernetes.io"));
  } catch (e) {
    return false;
  }
}

function findings(files) {
  const out = [];
  for (const f of files) {
    let s;
    try {
      if (fs.statSync(f).size > MAX_BYTES) continue;
      s = fs.readFileSync(f, "utf8");
    } catch (e) {
      continue;
    }
    const rel = path.relative(REPO_ROOT, f);
    const lines = s.split("\n");
    lines.forEach((line, i) => {
      let jwt = 0;
      for (const m of line.matchAll(JWT_SHAPE)) if (looksReal(m[1])) jwt++;
      if (jwt) out.push(`${rel}:${i + 1}: ${jwt} real-looking JWT(s)`);
      const sk = (line.match(LITELLM_SHAPE) || []).length;
      if (sk) out.push(`${rel}:${i + 1}: ${sk} LiteLLM-shaped key(s)`);
      const baked = (line.match(BAKED_SHAPE) || []).length;
      if (baked) out.push(`${rel}:${i + 1}: ${baked} NEXT_PUBLIC_ credential name(s)`);
    });
  }
  return out;
}

describe("U-SECRETS: the tree carries no credential (T23 acceptance)", () => {
  test("no real-looking JWT, no LiteLLM-shaped key, no NEXT_PUBLIC_ credential name in src/, tests/, scripts/, helm/, the root files (and inputs/ when present)", () => {
    const files = scanRoots();
    assert.ok(files.length > 100, `scanned ${files.length} files`);
    const found = findings(files);
    assert.deepStrictEqual(found, [], `credential-shaped values found (file:line:count — values are never printed):\n  ${found.join("\n  ")}`);
  });

  test("the ticket's literal check: grep -rn eyJhbGciOi src/ → 0", () => {
    const hits = [];
    for (const f of walk(path.join(REPO_ROOT, "src"), [])) {
      const s = fs.readFileSync(f, "utf8");
      if (s.includes("eyJhbGciOi")) hits.push(path.relative(REPO_ROOT, f));
    }
    assert.deepStrictEqual(hits, []);
  });

  test("the decoder separates a real token from a synthetic one without an allow-list", () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const header = b64({ alg: "RS256", kid: "x" });
    const real = `${header}.${b64({ iss: "https://kubernetes.default.svc.cluster.local", "kubernetes.io": { namespace: "ui" }, sub: "system:serviceaccount:ui:x", exp: 1 })}.sig`;
    const synthetic = `${header}.${b64({ fake: "u1" })}.sig`;
    assert.strictEqual(looksReal(real.split(".")[1]), true);
    assert.strictEqual(looksReal(synthetic.split(".")[1]), false);
    assert.strictEqual(looksReal("not-base64-json"), false);
    // U-TRACE's fixtures are synthetic by this rule.
    const trace = fs.readFileSync(path.join(__dirname, "u-trace.test.js"), "utf8");
    const fakes = [...trace.matchAll(JWT_SHAPE)];
    assert.ok(fakes.length >= 3, "U-TRACE still carries its synthetic tokens");
    for (const m of fakes) assert.strictEqual(looksReal(m[1]), false);
  });

  test("the stray copies are gone and the trace logs are redacted (design D10)", () => {
    for (const f of ["trigger_ingest.js", "test_api_chat.js", "inputs/modules/admin-panel"]) {
      assert.ok(!fs.existsSync(path.join(REPO_ROOT, f)), `${f} was deleted`);
    }
    const logs = path.join(REPO_ROOT, "inputs", "trace_logs");
    if (fs.existsSync(logs)) {
      for (const f of fs.readdirSync(logs).filter((n) => n.endsWith(".json"))) {
        const s = fs.readFileSync(path.join(logs, f), "utf8");
        assert.ok(!JWT_SHAPE.test(s), `${f} holds no JWT`);
        JWT_SHAPE.lastIndex = 0;
      }
    }
  });
});
