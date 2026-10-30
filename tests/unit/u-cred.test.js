/**
 * U-CRED — the one credential seam (ticket T23, design D2 / D3 / D4; F-22).
 *
 * Before T23 every credential was a committed `useState` default in page.js,
 * seeded into every visitor's localStorage and sent back on every request;
 * the server trusted whatever arrived. Now the page's defaults are empty and
 * `src/lib/credentials.js` is the ONLY place a server-side call obtains a
 * credential it was not sent: a non-empty request value wins (user-owned),
 * else the env token bound to the request URL's ORIGIN, else — the vector
 * store only — the pod's own projected service-account token, else nothing;
 * and every stage reports the SOURCE it used, never a value.
 *
 * Pure cases on the module with an injected env and a temp workload-token
 * file; then source pins over the twelve call sites, the page, the drawer,
 * the chart and the runners (the U-DESTRUCT way: a later edit cannot quietly
 * bypass the seam or seed a value again).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const C = require("../../src/lib/credentials");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const listFiles = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
};

const ENV = Object.freeze({
  NEXCODE_CHAT_URL: "https://chat.example",
  NEXCODE_CHAT_TOKEN: "chat-from-env",
  NEXCODE_EMBED_URL: "https://embed.example",
  NEXCODE_EMBED_TOKEN: "embed-from-env",
  NEXCODE_RERANK_URL: "https://rerank.example",
  NEXCODE_RERANK_TOKEN: "rerank-from-env",
  NEXCODE_LITELLM_URL: "https://litellm.example",
  NEXCODE_LITELLM_TOKEN: "",
  NEXCODE_WEAVIATE_URL: "http://weaviate.example:80",
});
const NO_FILE = path.join(os.tmpdir(), "u-cred-no-such-token-file");

function workloadFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u-cred-"));
  const p = path.join(dir, "token");
  fs.writeFileSync(p, content);
  return p;
}

describe("U-CRED: resolveCredential — the rule, in order", () => {
  test("1. a non-empty request value wins, trimmed, at any origin — even a foreign one", () => {
    const r = C.resolveCredential({ url: "https://rerank.example/v1/rerank", requestValue: "  typed-by-the-presenter  ", env: ENV, workloadTokenPath: NO_FILE });
    assert.deepStrictEqual(r, { value: "typed-by-the-presenter", source: "request", kind: "rerank", origin: "https://rerank.example" });
    const foreign = C.resolveCredential({ url: "https://somewhere.else/v1/rerank", requestValue: "mine", env: ENV, workloadTokenPath: NO_FILE });
    assert.strictEqual(foreign.source, "request");
    assert.strictEqual(foreign.kind, null, "a foreign origin is bound to no kind");
    assert.strictEqual(foreign.value, "mine");
  });

  test("2. the env token applies ONLY to its bound origin: path ignored, port and case normalised, any other host gets nothing", () => {
    const bound = C.resolveCredential({ url: "https://rerank.example/v1/rerank", requestValue: "", env: ENV, workloadTokenPath: NO_FILE });
    assert.deepStrictEqual(bound, { value: "rerank-from-env", source: "env", kind: "rerank", origin: "https://rerank.example" });
    const port = C.resolveCredential({ url: "https://rerank.example:443/v1/rerank", requestValue: "", env: ENV, workloadTokenPath: NO_FILE });
    assert.strictEqual(port.source, "env", "the default port is the same origin");
    const upper = C.resolveCredential({ url: "HTTPS://RERANK.EXAMPLE/v1/rerank", requestValue: "", env: ENV, workloadTokenPath: NO_FILE });
    assert.strictEqual(upper.source, "env");
    for (const url of ["https://rerank.example:8443/v1/rerank", "http://rerank.example/v1/rerank", "https://rerank.example.evil/v1/rerank", "https://other.example/v1/rerank"]) {
      const r = C.resolveCredential({ url, requestValue: "", env: ENV, workloadTokenPath: NO_FILE });
      assert.strictEqual(r.source, "none", url);
      assert.strictEqual(r.value, "", `no platform token leaves its origin (${url})`);
    }
  });

  test("a bound kind whose env token is empty resolves to none (LiteLLM here); an unbound kind is null", () => {
    const r = C.resolveCredential({ url: "https://litellm.example/v1/models", requestValue: "", env: ENV, workloadTokenPath: NO_FILE });
    assert.deepStrictEqual(r, { value: "", source: "none", kind: "litellm", origin: "https://litellm.example" });
    const noUrlEnv = { ...ENV, NEXCODE_RERANK_URL: "" };
    const r2 = C.resolveCredential({ url: "https://rerank.example/v1/rerank", requestValue: "", env: noUrlEnv, workloadTokenPath: NO_FILE });
    assert.strictEqual(r2.kind, null, "a token with no URL to bind to is bound to nothing");
    assert.strictEqual(r2.source, "none");
  });

  test("3. the workload token serves the vector store only, after request and env, and never any other kind", () => {
    const file = workloadFile("projected-sa-token\n");
    const store = C.resolveCredential({ url: "http://weaviate.example/v1/schema", requestValue: "", env: ENV, workloadTokenPath: file });
    assert.deepStrictEqual(store, { value: "projected-sa-token", source: "workload", kind: "weaviate", origin: "http://weaviate.example" });
    const override = C.resolveCredential({ url: "http://weaviate.example/v1/schema", requestValue: "", env: { ...ENV, NEXCODE_WEAVIATE_TOKEN: "store-override" }, workloadTokenPath: file });
    assert.strictEqual(override.source, "env", "an explicit store token overrides the workload identity");
    assert.strictEqual(override.value, "store-override");
    const typed = C.resolveCredential({ url: "http://weaviate.example/v1/schema", requestValue: "typed", env: ENV, workloadTokenPath: file });
    assert.strictEqual(typed.source, "request");
    const rerank = C.resolveCredential({ url: "https://rerank.example/v1/rerank", requestValue: "", env: { ...ENV, NEXCODE_RERANK_TOKEN: "" }, workloadTokenPath: file });
    assert.strictEqual(rerank.source, "none", "the workload token is never sent to an MLIS endpoint (measured 403, t23-design §0 item 4)");
    const foreignStore = C.resolveCredential({ url: "http://another-store.example/v1/schema", requestValue: "", env: ENV, workloadTokenPath: file });
    assert.strictEqual(foreignStore.source, "none", "and never to a store at an unbound origin");
  });

  test("4. nothing: an unreadable workload file, an empty file, a missing or unparseable URL", () => {
    assert.strictEqual(C.resolveCredential({ url: "http://weaviate.example/v1/schema", requestValue: "", env: ENV, workloadTokenPath: NO_FILE }).source, "none");
    assert.strictEqual(C.resolveCredential({ url: "http://weaviate.example/v1/schema", requestValue: "", env: ENV, workloadTokenPath: workloadFile("   \n") }).source, "none");
    for (const url of [undefined, null, "", "   ", "not a url", "weaviate.example/v1"]) {
      const r = C.resolveCredential({ url, requestValue: "", env: ENV, workloadTokenPath: NO_FILE });
      assert.deepStrictEqual(r, { value: "", source: "none", kind: null, origin: null }, String(url));
    }
    assert.deepStrictEqual(C.resolveCredential(), { value: "", source: "none", kind: null, origin: null }, "no arguments at all is nothing, not a throw");
  });

  test("a non-string request value is treated as blank, never coerced", () => {
    for (const requestValue of [undefined, null, 42, {}, []]) {
      const r = C.resolveCredential({ url: "https://rerank.example/x", requestValue, env: ENV, workloadTokenPath: NO_FILE });
      assert.strictEqual(r.source, "env", String(requestValue));
    }
  });
});

describe("U-CRED: describeCredentials / credentialSummaryLine — presence only", () => {
  test("one word per kind, from the env and the workload file, and no value anywhere in the output", () => {
    const file = workloadFile("projected-sa-token");
    const d = C.describeCredentials(ENV, file);
    assert.deepStrictEqual(d, { chat: "env", embed: "env", rerank: "env", litellm: "none", weaviate: "workload" });
    assert.deepStrictEqual(C.describeCredentials(ENV, NO_FILE).weaviate, "none");
    assert.strictEqual(C.describeCredentials({ ...ENV, NEXCODE_WEAVIATE_TOKEN: "store-override" }, file).weaviate, "env");
    assert.strictEqual(C.describeCredentials({}, NO_FILE).chat, "none", "an empty env is all none");
    const line = C.credentialSummaryLine(ENV, file);
    assert.strictEqual(line, "credentials: chat=env embed=env rerank=env litellm=none weaviate=workload");
    const printed = JSON.stringify(d) + line + JSON.stringify(C.bindingsFrom(ENV).map((b) => ({ kind: b.kind, origin: b.origin })));
    for (const v of ["chat-from-env", "embed-from-env", "rerank-from-env", "projected-sa-token"]) assert.ok(!printed.includes(v), `${v} must never be described`);
    assert.deepStrictEqual(Object.keys(d), [...C.CREDENTIAL_KINDS]);
  });

  test("the vocabulary is fixed and frozen", () => {
    assert.deepStrictEqual([...C.CREDENTIAL_KINDS], ["chat", "embed", "rerank", "litellm", "weaviate"]);
    assert.deepStrictEqual([...C.CREDENTIAL_SOURCES], ["request", "env", "workload", "none"]);
    assert.ok(Object.isFrozen(C.CREDENTIAL_KINDS) && Object.isFrozen(C.ENV_TOKEN_NAMES) && Object.isFrozen(C.ENV_URL_NAMES));
    for (const k of C.CREDENTIAL_KINDS) {
      assert.strictEqual(C.ENV_TOKEN_NAMES[k], `NEXCODE_${k.toUpperCase()}_TOKEN`);
      assert.strictEqual(C.ENV_URL_NAMES[k], `NEXCODE_${k.toUpperCase()}_URL`);
    }
    assert.strictEqual(C.WORKLOAD_TOKEN_PATH, "/var/run/secrets/kubernetes.io/serviceaccount/token");
  });
});

describe("U-CRED: source pins — every server-side credential goes through the seam (design D4 / D7)", () => {
  const retrieve = () => read("src/app/api/rag/retrieve/route.js");
  const orchestrator = () => read("src/lib/orchestrator.js");
  const ingest = () => read("src/app/api/ingest/route.js");

  test("the retrieve route resolves the three hops at the point of use and reports their sources", () => {
    const s = retrieve();
    assert.match(s, /import \{ resolveCredential \} from "@\/lib\/credentials";/);
    assert.match(s, /const embedCred = resolveCredential\(\{ url: cfg\.embedUrl, requestValue: cfg\.token \}\);/);
    assert.match(s, /const weaviateCred = resolveCredential\(\{ url: cfg\.weaviateUrl, requestValue: cfg\.weaviateToken \|\| cfg\.token \}\);/, "the request precedence is unchanged; only the empty case is new");
    assert.match(s, /const rerankCred = resolveCredential\(\{ url: cfg\.rerankUrl, requestValue: cfg\.rerankToken \|\| cfg\.token \}\);/);
    assert.match(s, /getEmbedding\(query, cfg\.embedUrl, cfg\.embedModel, embedCred\.value\)/);
    assert.match(s, /new WeaviateClient\(cfg\.weaviateUrl, weaviateCred\.value, cfg\.weaviateCollection\)/);
    assert.match(s, /rerankCred\.value,\s*cfg\.rerankProperty,/);
    assert.match(s, /credentialSources: \{\s*embed: cfg\.needsVector \? embedCred\.source : null,\s*weaviate: weaviateCred\.source,\s*rerank: cfg\.rerankEffective \? rerankCred\.source : null,\s*\}/);
    assert.ok(!/cfg\.weaviateToken \|\| cfg\.token, cfg\.weaviateCollection/.test(s), "no raw request token reaches the store client");
    assert.ok(!/getEmbedding\([^)]*cfg\.token\)/.test(s), "no raw request token reaches the embedder");
  });

  test("the resolver still passes the three request fields through untouched (U-CFG's contract) and the report carries the sources additively", () => {
    const cfg = read("src/lib/rag/config.js");
    assert.match(cfg, /token: typeof body\.token === "string" \? body\.token : "",\s*weaviateToken: typeof body\.weaviateToken === "string" \? body\.weaviateToken : "",\s*rerankToken: typeof body\.rerankToken === "string" \? body\.rerankToken : "",/);
    assert.match(cfg, /function buildRetrievalReport\(\{ cfg, candidatesReturned, results, floorApplied, candidatesScored, credentialSources, documentFilter = null, searchMode, searchProperties, repeatsCollapsed = null \}\)/);
    assert.match(cfg, /\.\.\.\(credentialSources \? \{ credentialSources \} : \{\}\),/);
    const { buildRetrievalReport } = require("../../src/lib/rag/config");
    const base = { searchStrategy: "hybrid", weaviateCollection: "X", schemaVersion: 2, poolSize: 10, keepTopNAfterRerank: 8, rerankEffective: true, floorSource: "rerank", minRerankScore: 0.05, similarityThreshold: 0 };
    assert.ok(!("credentialSources" in buildRetrievalReport({ cfg: base, candidatesReturned: 0, results: [], floorApplied: false, candidatesScored: null })), "absent when not given");
    const withSources = buildRetrievalReport({ cfg: base, candidatesReturned: 0, results: [], floorApplied: false, candidatesScored: null, credentialSources: { embed: "none", weaviate: "workload", rerank: "env" } });
    assert.deepStrictEqual(withSources.credentialSources, { embed: "none", weaviate: "workload", rerank: "env" });
  });

  test("the orchestrator: the summary's store token, the chat token, the count client, the dispatch trace and the response", () => {
    const s = orchestrator();
    assert.match(s, /import \{ resolveCredential \} from "@\/lib\/credentials";/);
    assert.match(s, /const token = resolveCredential\(\{ url: weaviateUrl, requestValue: adminConfig\?\.mlisToken \|\| "" \}\)\.value;/);
    assert.match(s, /const chatCred = resolveCredential\(\{ url: targetUrl, requestValue: nimApiKey \}\);\s*nimApiKey = chatCred\.value;/);
    assert.ok(s.indexOf("const chatCred = resolveCredential(") > s.indexOf("// Standardise completions URL"), "resolved on the standardised URL, before translation");
    assert.ok(s.indexOf("const chatCred = resolveCredential(") < s.indexOf("const runGenerationCall"), "and before the generation call is defined");
    assert.match(s, /new WeaviateClient\(rc\.weaviateUrl, resolveCredential\(\{ url: rc\.weaviateUrl, requestValue: rc\.weaviateToken \|\| rc\.token \}\)\.value, rc\.weaviateCollection\)/);
    assert.match(s, /credentialSource: chatCred\.source,/, "the dispatch trace names the source");
    // The retrieve route's report lives in the RAG trace's details, not on the
    // `retrieval` outcome object — the sources are captured where the report is
    // read (A12) and returned from that function-scoped capture.
    assert.match(s, /let retrievalCredentialSources = null;/);
    assert.match(s, /retrievalReport = retData\.report \?\? null;\s*retrievalCredentialSources = retrievalReport\?\.credentialSources \?\? null;/);
    assert.match(s, /credentialSources: \{\s*chat: chatCred\.source,\s*embed: retrievalCredentialSources\?\.embed \?\? null,\s*weaviate: retrievalCredentialSources\?\.weaviate \?\? null,\s*rerank: retrievalCredentialSources\?\.rerank \?\? null,\s*\},/);
    assert.ok(!/retrieval\?\.report\?\.credentialSources/.test(s), "never read from the outcome object, which carries no report");
    assert.ok(!/const token = adminConfig\?\.mlisToken \|\| "";/.test(s), "the raw admin token no longer reaches the summary client");
    const chat = read("src/app/api/chat/route.js");
    assert.match(chat, /const testCred = resolveCredential\(\{ url: rawEndpoint, requestValue: adminConfig\?\.nimApiKey \|\| "" \}\);\s*const apiKey = testCred\.value;/);
    assert.match(chat, /credentialSource: testCred\.source/);
    assert.match(chat, /\.\.\.\(result\.credentialSources \? \{ credentialSources: result\.credentialSources \} : \{\}\),/, "the chat response forwards the sources");
  });

  test("ingest: the request's fields are renamed, resolved after the identity check, and the start body / start record say which source served each hop", () => {
    const s = ingest();
    assert.match(s, /const \{ filePaths, weaviateUrl, token: requestToken, weaviateToken: requestWeaviateToken, embedUrl, embedModel, ragSettings \} = body;/);
    assert.match(s, /const vlmCred = resolveCredential\(\{ url: body\.vlmEndpointUrl, requestValue: typeof body\.vlmApiKey === "string" \? body\.vlmApiKey : "" \}\);\s*if \(vlmCred\.value\) vlmOverrides\.vlmApiKey = vlmCred\.value;/);
    const resolveAt = s.indexOf("const embedCred = resolveCredential({ url: embedUrl, requestValue: requestToken });");
    assert.ok(resolveAt > s.indexOf('error: "Embedding endpoint configuration is required."'), "resolved after the identity fields are validated");
    assert.ok(resolveAt < s.indexOf("const running = activeJob();"), "and before the lock, the pin check and the job");
    assert.match(s, /const weaviateCred = resolveCredential\(\{ url: weaviateUrl, requestValue: requestWeaviateToken \|\| requestToken \}\);\s*const token = embedCred\.value;\s*const weaviateToken = weaviateCred\.value;/);
    assert.match(s, /event: "ingest_start",[\s\S]{0,400}?credentialSources: \{ embed: embedCred\.source, weaviate: weaviateCred\.source, vlm: vlmCred\.source \},/);
    assert.match(s, /statusUrl: `\/api\/ingest\/status\?jobId=\$\{job\.jobId\}`,[\s\S]{0,200}?credentialSources: \{ embed: embedCred\.source, weaviate: weaviateCred\.source, vlm: vlmCred\.source \},/);
    assert.ok(!/body\.vlmApiKey\.trim\(\)/.test(s), "the raw VLM key is not copied any more");
  });

  test("unload / clear / preview resolve the store credential on the store's URL", () => {
    const unload = read("src/app/api/ingest/unload/route.js");
    assert.match(unload, /const \{ filePath, weaviateUrl, token: requestToken, weaviateCollection \} = body;\s*(\/\/[^\n]*\n\s*)*const token = resolveCredential\(\{ url: weaviateUrl, requestValue: requestToken \}\)\.value;/);
    const clear = read("src/app/api/ingest/clear/route.js");
    assert.match(clear, /const authToken = resolveCredential\(\{ url: weaviateUrl, requestValue: mlisToken \|\| token \}\)\.value;/);
    assert.ok(!/const authToken = mlisToken \|\| token;/.test(clear));
    const preview = read("src/app/api/ingest/clear/preview/route.js");
    assert.match(preview, /const authToken = resolveCredential\(\{ url: weaviateUrl, requestValue: mlisToken \|\| token \}\)\.value;\s*const weaviateClient = new WeaviateClient\(weaviateUrl, authToken, collectionNameForVersion\(weaviateCollection, schemaVersion\), \{ schemaVersion \}\);/);
    for (const f of [unload, clear, preview]) assert.match(f, /import \{ resolveCredential \} from "@\/lib\/credentials";/);
  });

  test("the five test routes and the model listing use the seam and echo credentialSource on every JSON response (D7)", () => {
    for (const f of ["vectordb-test", "embedding-test", "vlm-test", "rerank-test", "models"]) {
      const s = read(`src/app/api/${f}/route.js`);
      assert.match(s, /import \{ resolveCredential \} from "@\/lib\/credentials";/, f);
      assert.match(s, /let credentialSource = "none";/, f);
      assert.match(s, /credentialSource = cred\.source;/, f);
      const responses = s.match(/NextResponse\.json\(/g) || [];
      const withSource = s.match(/NextResponse\.json\(\s*\{ credentialSource,|NextResponse\.json\(\{ \.\.\.result, credentialSource \}\)/g) || [];
      assert.strictEqual(withSource.length, responses.length, `${f}: every response says which source served it`);
    }
    for (const f of ["embedding-test", "vlm-test", "rerank-test"]) {
      const s = read(`src/app/api/${f}/route.js`);
      assert.match(s, /const cred = resolveCredential\(\{ url: endpoint, requestValue: apiKey \|\| "" \}\);/, f);
      assert.ok(!/apiKey\.trim\(\)\}`/.test(s), `${f}: the raw field no longer builds the header`);
    }
    assert.match(read("src/app/api/vectordb-test/route.js"), /const cred = resolveCredential\(\{ url, requestValue: token \|\| "" \}\);/);
    assert.match(read("src/app/api/models/route.js"), /const cred = resolveCredential\(\{ url: endpoint, requestValue: token \|\| "" \}\);/);
  });

  test("the health route reports presence through describeCredentials, and the boot hook logs the summary line", () => {
    const health = read("src/app/api/health/route.js");
    assert.match(health, /import \{ describeCredentials \} from "@\/lib\/credentials";/);
    assert.match(health, /credentials: describeCredentials\(\),/);
    const boot = read("src/instrumentation.js");
    assert.match(boot, /export async function register\(\)/);
    assert.match(boot, /process\.env\.NEXT_RUNTIME !== "nodejs"/, "node-only: the edge bundle never loads fs");
    assert.match(boot, /credentialSummaryLine/);
  });

  test("page.js: no committed credential, no seeding, guard v18 (v9 at T23, v10 at T28, v11 at T15, v12 at T24, v13 at T31, v14 at T37, v15 at T33, v16 at T35, v17 at T48, v18 at T63) purges the token keys once (design D5)", () => {
    const page = read("src/app/page.js");
    for (const name of ["mlisToken", "codeMlisToken", "embedApiKey", "rerankApiKey", "liteLlmToken", "codeLiteLlmToken"]) {
      assert.match(page, new RegExp(`const \\[${name}, set\\w+\\] = useState\\(""\\)`), `${name} defaults to empty`);
    }
    assert.ok(!/useState\("eyJ/.test(page), "no JWT-shaped default");
    assert.ok(!/useState\("sk-/.test(page), "no LiteLLM-shaped default");
    for (const key of ["nxs_mlisToken", "nxs_codeMlisToken", "nxs_embedApiKey", "nxs_rerankApiKey", "nxs_liteLlmToken", "nxs_codeLiteLlmToken"]) {
      assert.ok(!new RegExp(`localStorage\\.setItem\\("${key}"`).test(page), `${key} is never seeded`);
      assert.match(page, new RegExp(`localStorage\\.removeItem\\("${key}"\\)`), `${key} is purged by the v9 block`);
    }
    assert.ok(!/localStorage\.setItem\("nxs_mlisToken_/.test(page), "the per-URL slot is never seeded");
    assert.match(page, /for \(const key of Object\.keys\(localStorage\)\) \{\s*if \(key\.startsWith\("nxs_mlisToken_"\)\) localStorage\.removeItem\(key\);\s*\}/, "every per-URL slot is purged");
    assert.match(page, /nxs_migrated_demos_v19/);
    assert.ok(!/nxs_migrated_demos_v8/.test(page) && !/nxs_migrated_demos_v7/.test(page), "the old guards are gone");
    const block = page.slice(page.indexOf('getItem("nxs_migrated_demos_v19")'), page.indexOf('setItem("nxs_migrated_demos_v19"'));
    assert.ok(!/eyJ|sk-/.test(block), "the migration block carries no value");
  });

  test("the drawer shows the server's presence beside the four token fields, from /api/health, and nothing else about credentials", () => {
    const drawer = read("src/components/AdminDrawer.jsx");
    assert.match(drawer, /fetch\("\/api\/health"/);
    assert.match(drawer, /setServerCredentials\(j && j\.credentials \? j\.credentials : null\)/);
    const hints = drawer.match(/serverCredentialHint\("(chat|litellm|embed|rerank)"\)/g) || [];
    // D31 (Nexus, 2026-10-30): the chat and code agents are LiteLLM-only, so their two MLIS key fields are gone.
    assert.deepStrictEqual(hints.sort(), ['serverCredentialHint("embed")', 'serverCredentialHint("litellm")', 'serverCredentialHint("litellm")', 'serverCredentialHint("rerank")']);
    for (const local of ["localLiteLlmToken", "localCodeLiteLlmToken", "localEmbedApiKey", "localRerankApiKey"]) {
      const at = drawer.indexOf(`value={${local}}`);
      assert.ok(at > 0, local);
      assert.ok(/serverCredentialHint\(/.test(drawer.slice(at, at + 900)), `${local} has the hint under it`);
    }
  });

  // The chart is .dockerignored, so the image's copy of this suite (gate 1 runs
  // in-pod, and the gate forbids skips) cannot read helm/. In the pod the
  // chart's RENDERED output is the container's own env — a stronger, live
  // check — so the same origins are asserted from process.env there, and
  // from values.yaml / deployment.yaml on the workstation (the PR's run).
  const HELM_PRESENT = fs.existsSync(path.join(REPO_ROOT, "helm", "values.yaml"));
  test("the chart: one Secret by name, optional, one URL + one token per kind, and the bound origins equal the page's defaults", () => {
    const endpoints = {};
    if (HELM_PRESENT) {
      const values = read("helm/values.yaml");
      const deployment = read("helm/templates/deployment.yaml");
      assert.match(values, /^credentials:\n  secretName: nexcode-credentials\n  endpoints:\n/m);
      for (const m of values.matchAll(/^    (chat|embed|rerank|litellm|weaviate): (\S+)$/gm)) endpoints[m[1]] = m[2];
      assert.match(deployment, /\{\{- range \$kind, \$url := \.Values\.credentials\.endpoints \}\}\s*- name: NEXCODE_\{\{ upper \$kind \}\}_URL\s*value: \{\{ \$url \| quote \}\}\s*- name: NEXCODE_\{\{ upper \$kind \}\}_TOKEN\s*valueFrom:\s*secretKeyRef:\s*name: \{\{ \$\.Values\.credentials\.secretName \| quote \}\}\s*key: \{\{ printf "%sToken" \$kind \| quote \}\}\s*optional: true\s*\{\{- end \}\}/);
      assert.ok(!/kind: Secret/.test(listFiles(path.join(REPO_ROOT, "helm", "templates")).map((f) => fs.readFileSync(f, "utf8")).join("\n")), "the chart renders no Secret (design D1)");
    } else {
      // In the image: the Deployment rendered the chart into this env.
      for (const kind of C.CREDENTIAL_KINDS) {
        const url = process.env[C.ENV_URL_NAMES[kind]];
        assert.ok(typeof url === "string" && C.originOf(url), `${C.ENV_URL_NAMES[kind]} is set in the pod's env (the chart's rendered binding)`);
        endpoints[kind] = url;
      }
      assert.ok(!("MLIS_TOKEN" in process.env), "no shared MLIS token in the env (design D2)");
    }
    assert.deepStrictEqual(Object.keys(endpoints).sort(), ["chat", "embed", "litellm", "rerank", "weaviate"]);
    const page = read("src/app/page.js");
    const def = (name) => page.match(new RegExp(`const \\[${name}, set\\w+\\] = useState\\("([^"]*)"\\)`))[1];
    assert.strictEqual(C.originOf(endpoints.chat), C.originOf(def("mlisUrl")), "chat ↔ the page's MLIS endpoint");
    assert.strictEqual(C.originOf(endpoints.chat), C.originOf(def("codeMlisUrl")), "and the code agent's");
    assert.strictEqual(C.originOf(endpoints.rerank), C.originOf(def("rerankEndpointUrl")), "rerank ↔ the page's rerank endpoint");
    assert.strictEqual(C.originOf(endpoints.litellm), C.originOf(def("liteLlmUrl")), "litellm ↔ the page's LiteLLM endpoint");
    assert.strictEqual(C.originOf(endpoints.weaviate), C.originOf(def("weaviateUrl")), "weaviate ↔ the page's store");
    const gates = read("tests/eval/baselines/cutover-artifacts/run_pod_gates.sh");
    const alt = gates.match(/RAG_EVAL_EMBED_ALT_URL="([^"]+)"/)[1];
    assert.strictEqual(C.originOf(endpoints.embed), C.originOf(alt), "embed ↔ the MLIS embedder the harness names (the page's default embedder is Ollama, unauthenticated)");
  });

  test("nothing in src/ or the chart names a shared MLIS credential; no NEXT_PUBLIC_ credential anywhere it could be baked (design D2)", () => {
    const files = [
      ...listFiles(path.join(REPO_ROOT, "src")),
      ...(HELM_PRESENT ? listFiles(path.join(REPO_ROOT, "helm")) : []),
      path.join(REPO_ROOT, "Dockerfile"), path.join(REPO_ROOT, "next.config.mjs"), path.join(REPO_ROOT, "Tiltfile"),
    ].filter((f) => fs.existsSync(f));
    assert.ok(files.length > 20, "the tree is here");
    for (const f of files) {
      if (!/\.(js|jsx|mjs|ts|tsx|yaml|yml|tpl|json)$|Dockerfile$|Tiltfile$/.test(f)) continue;
      const s = fs.readFileSync(f, "utf8");
      assert.ok(!/MLIS_TOKEN/.test(s), `${path.relative(REPO_ROOT, f)} names a shared MLIS token`);
      assert.ok(!/NEXT_PUBLIC_[A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD)/.test(s), `${path.relative(REPO_ROOT, f)} would bake a credential into the client bundle`);
    }
  });

  test("the runners read the pod's env through the one helper, never the page (design D9)", () => {
    for (const f of [
      "tests/eval/baselines/cutover-artifacts/run_pod_gates.sh",
      "tests/eval/baselines/cutover-artifacts/run_eval_leg.sh",
      "tests/eval/baselines/cutover-artifacts/run_fresh_class.sh",
      "tests/eval/baselines/t17-artifacts/run_demo_shape_leg.sh",
      "tests/eval/baselines/t22-artifacts/run_t22_suites.sh",
      "tests/eval/baselines/t07-artifacts/run_idem_legs.sh",
      "tests/eval/baselines/t07-artifacts/run_ledger_legs.sh",
      "tests/eval/baselines/t23-artifacts/run_pod_gates.sh",
      "tests/eval/baselines/t23-artifacts/run_t23_suites.sh",
    ]) {
      const s = read(f);
      assert.match(s, /\. tests\/eval\/_credentials\.sh/, `${f} sources the helper`);
      assert.ok(!/useState\\\(/.test(s) && !/page\.js","utf8"/.test(s), `${f} no longer reads page.js for a token`);
    }
    for (const f of [
      "tests/eval/baselines/t22-artifacts/probe_state.js",
      "tests/eval/baselines/t22-artifacts/witness_images.js",
      "tests/eval/baselines/t22-artifacts/repin_production.js",
      "tests/eval/baselines/dryrun-artifacts/probes/see_figure_probe.js",
      "tests/eval/baselines/dryrun-artifacts/probes/store_chunks_probe.js",
    ]) {
      const s = read(f);
      assert.match(s, /_credentials(\.js)?"?'?\)/, `${f} requires the helper`);
      assert.ok(!/mlisToken, set\\w\+\\\] = useState/.test(s), `${f} no longer regexes page.js for the store token`);
    }
    const helper = read("tests/eval/_credentials.sh");
    assert.match(helper, /_t23_fail\(\) \{ echo "GATE FAILED: \$1"; exit 1; \}/);
    assert.match(helper, /NEXCODE_RERANK_TOKEN is not set in this environment/);
    assert.ok(!/src\/app\/page\.js|useState/.test(helper), "no fallback to the page — a missing Secret is loud");
    const js = read("tests/eval/_credentials.js");
    assert.match(js, /NEXCODE_RERANK_TOKEN/);
    assert.match(js, /throw new Error\(`\[T23 credentials\] not set in this environment/);
    assert.ok(!/src\/app\/page\.js|useState/.test(js));
  });
});
