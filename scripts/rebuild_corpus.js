#!/usr/bin/env node
/**
 * Rebuild the production RAG store from a named list of corpus files — the UI's own two steps, in order:
 * Tidy Up (POST /api/ingest/clear on the page's class, confirmed by name) and Ingest (POST /api/ingest in the
 * page's request shape). Written 2026-10-02 for the coding-assistant corpus (FCA SYSC, PCI DSS, PSRs 2017). Since
 * 2026-10-06 (E0, unlocked by the owner) the default list is the nine regulator documents the store holds (the six the
 * owner added and ingested that day beside the three), so a default `go` rebuilds all nine and can never drop six.
 * Since 2026-10-08 (decision C1 (a); the pins unlocked by the owner, D1 (a)) it is ten: FCA SYSC 4 joined the store,
 * so a default `go` can never drop it either.
 *
 * Runs IN THE POD (the routes on 127.0.0.1:3000, the page's source and settings under /usr/src/app), fed on stdin
 * so nothing is copied in:
 *
 *   kubectl -n nexus-nexcode exec -i <pod> -c nexcode -- node - < scripts/rebuild_corpus.js                  # pre-flight only
 *   kubectl -n nexus-nexcode exec -i <pod> -c nexcode -- env REBUILD_MODE=go node - < scripts/rebuild_corpus.js
 *
 * Env: REBUILD_MODE (preflight | go; default preflight), REBUILD_FILES (comma-separated names under
 * public/demos/demo_files/ext_reg_docs; default the ten below), NEXCODE_ROOT, RAG_EVAL_APP_URL.
 *
 * Only the app's routes are called, with the page's empty credential fields (the routes resolve the server's own,
 * T23), so this script never reads or prints a credential. The pre-flight is read-only: health, no ingest job
 * running, every named file present, the clear preview (the class and its counts), the documents the class holds.
 * `go` refuses unless the pre-flight holds, then drops the class, checks it is empty, ingests the files, polls the
 * status stream one frame at a time (the harness's reader — F-140), and checks every file landed as `indexed` and
 * the class holds exactly the named documents. Exit 0 = rebuilt as asked; 1 = a check failed; 2 = usage / pre-flight.
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.env.NEXCODE_ROOT || "/usr/src/app";
const APP = process.env.RAG_EVAL_APP_URL || "http://127.0.0.1:3000";
const MODE = process.env.REBUILD_MODE || "preflight";
const CORPUS_REL = "demos/demo_files/ext_reg_docs";
const DEFAULT_FILES = [
  "BoE_AI-Letter-to-DSIT-HMT_April2024.pdf",
  "FCA_AI-Update_April2024.pdf",
  "FCA_PS21-3_OperationalResilience_March2021.pdf",
  "FCA_SYSC-4_October2026.pdf",
  "FCA_SYSC_June2026.pdf",
  "PCI-DSS-v4_0_1_June2024.pdf",
  "PRA_SS1-21_OperationalResilience_March2022.pdf",
  "PRA_SS1-23_ModelRisk_April2026.pdf",
  "PRA_SS2-21_Outsourcing_November2024.pdf",
  "PSRs_2017_April2026.pdf",
];
const FILES = (process.env.REBUILD_FILES ? process.env.REBUILD_FILES.split(",") : DEFAULT_FILES).map((s) => s.trim()).filter(Boolean);
/** The base collection the drawer's Tidy Up names; the server's default schema version (2) resolves it to RAGChunkV2. */
const BASE_COLLECTION = "RAGChunk";
const EXPECTED_CLASS = "RAGChunkV2";
const JOB_TIMEOUT_MS = 60 * 60 * 1000;

const { readFrame } = require(path.join(ROOT, "tests", "integration", "_harness.js"));
const say = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

/** The page's literal for a useState("…") — the runners' regex (recaption_production.js pageState). */
function pageState(pageSource, name) {
  const m = pageSource.match(new RegExp(`const \\[${name}, set\\w+\\] = useState\\("([^"]*)"\\)`));
  if (!m) throw new Error(`page.js has no state ${name}`);
  return m[1];
}

/** The page's settings: the store URL, the embed pair, the captioner, the two credential fields (empty since T23). */
function pageSettings() {
  const page = fs.readFileSync(path.join(ROOT, "src", "app", "page.js"), "utf8");
  const state = (name) => pageState(page, name);
  return {
    weaviateUrl: state("weaviateUrl"),
    token: state("embedApiKey"),
    weaviateToken: state("mlisToken"),
    embedUrl: state("embedEndpointUrl"),
    embedModel: state("embedModelName"),
    vlmModelName: state("vlmModelName"),
    vlmEndpointUrl: state("vlmEndpointUrl"),
    vlmApiKey: state("vlmApiKey"),
  };
}

async function postJson(route, body, timeoutMs = 120000) {
  const res = await fetch(`${APP}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function documentsHeld(s) {
  const r = await postJson("/api/rag/documents", { weaviateUrl: s.weaviateUrl, token: s.weaviateToken, weaviateCollection: BASE_COLLECTION });
  if (r.status !== 200 || r.json.success === false) throw new Error(`documents route ${r.status}: ${r.json.error || ""}`);
  return { collection: r.json.collection, documents: r.json.documents.map((d) => ({ source: d.source, chunkCount: d.chunkCount, totalPages: d.totalPages })) };
}

async function waitForJob(jobId) {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let last = null;
  let lastLine = "";
  while (Date.now() < deadline) {
    try {
      last = await readFrame(APP, jobId);
      const line = `${last.status} ${last.filesCompleted}/${last.totalFiles} ${last.currentFile || ""} chunks ${last.chunksIndexed}`;
      if (line !== lastLine) { say({ step: "progress", status: last.status, files: `${last.filesCompleted}/${last.totalFiles}`, currentFile: last.currentFile || null, chunksIndexed: last.chunksIndexed }); lastLine = line; }
      if (last.status !== "processing") return last;
    } catch (e) {
      say({ step: "poll-retry", error: String(e.message || e).slice(0, 200) });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`the job did not settle within ${JOB_TIMEOUT_MS / 60000} min (last status ${last ? last.status : "unread"})`);
}

async function main() {
  if (!["preflight", "go"].includes(MODE)) { say({ step: "usage", error: `REBUILD_MODE must be preflight or go, not ${MODE}` }); process.exit(2); }
  const s = pageSettings();
  const filePaths = FILES.map((f) => `${CORPUS_REL}/${f}`);

  // ------------------------------------------------------------ pre-flight (read-only) ------------------------
  const problems = [];
  const health = await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch((e) => ({ error: String(e.message || e) }));
  const missing = filePaths.filter((p) => !fs.existsSync(path.join(ROOT, "public", p)));
  if (missing.length) problems.push(`missing in the pod: ${missing.join(", ")}`);
  const running = await readFrame(APP, null).catch((e) => ({ error: String(e.message || e) }));
  if (running && running.status === "processing") problems.push(`an ingest job is running (${running.jobId})`);
  const preview = await postJson("/api/ingest/clear/preview", { weaviateUrl: s.weaviateUrl, token: s.weaviateToken, mlisToken: s.weaviateToken, weaviateCollection: BASE_COLLECTION });
  if (preview.status !== 200 || preview.json.success === false) problems.push(`clear preview ${preview.status}: ${preview.json.code || ""} ${preview.json.error || ""}`);
  else if (preview.json.collection !== EXPECTED_CLASS) problems.push(`the preview resolves ${preview.json.collection}, not ${EXPECTED_CLASS}`);
  const before = await documentsHeld(s).catch((e) => ({ error: String(e.message || e) }));
  say({
    step: "preflight",
    mode: MODE,
    pod: require("os").hostname(),
    health: health.error ? health : { status: health.status ?? health.ok ?? "answered" },
    files: filePaths,
    store: { weaviateUrl: s.weaviateUrl, embedModel: s.embedModel, vlmModelName: s.vlmModelName, credentialFields: s.token === "" && s.weaviateToken === "" ? "empty (the server resolves its own)" : "set by the page (not printed)" },
    runningJob: running && running.status ? { status: running.status, jobId: running.jobId || null } : running,
    preview: preview.json.success === false ? preview.json : { collection: preview.json.collection, objectCount: preview.json.objectCount, sourceCount: preview.json.sourceCount },
    before,
    problems,
  });
  if (problems.length) { say({ step: "REFUSING", problems }); process.exit(2); }
  if (MODE === "preflight") { say({ step: "preflight-only", note: "nothing written; REBUILD_MODE=go drops the class and ingests the files" }); return; }

  // ------------------------------------------------------------ go: Tidy Up, then Ingest ----------------------
  const clear = await postJson("/api/ingest/clear", { weaviateUrl: s.weaviateUrl, token: s.weaviateToken, mlisToken: s.weaviateToken, weaviateCollection: BASE_COLLECTION, confirmCollection: EXPECTED_CLASS });
  say({ step: "clear", status: clear.status, success: clear.json.success, collection: clear.json.collection, completed: clear.json.completed, message: clear.json.message, code: clear.json.code, error: clear.json.error });
  if (clear.status !== 200 || clear.json.success === false) { say({ step: "STOPPED", why: "the clear did not succeed; nothing was ingested" }); process.exit(1); }
  const emptied = await postJson("/api/ingest/clear/preview", { weaviateUrl: s.weaviateUrl, token: s.weaviateToken, mlisToken: s.weaviateToken, weaviateCollection: BASE_COLLECTION });
  say({ step: "after-clear", collection: emptied.json.collection, objectCount: emptied.json.objectCount });
  if (emptied.json.objectCount !== 0) { say({ step: "STOPPED", why: `the class holds ${emptied.json.objectCount} objects after the clear; nothing was ingested` }); process.exit(1); }

  const { RAG_SETTINGS_DEFAULTS } = require(path.join(ROOT, "src", "lib", "rag", "config.js"));
  // The page's ingest body, key for key (page.js handleIngest): no collection field, no version field — the server's default class.
  const body = { filePaths, ...s, ragSettings: JSON.parse(JSON.stringify(RAG_SETTINGS_DEFAULTS)) };
  const ingest = await postJson("/api/ingest", body);
  say({ step: "ingest-post", status: ingest.status, jobId: ingest.json.jobId, code: ingest.json.code, error: ingest.json.error });
  if (!ingest.json.jobId) { say({ step: "STOPPED", why: "the ingest was not accepted" }); process.exit(1); }
  const final = await waitForJob(ingest.json.jobId);
  const results = (final.fileResults || []).map((f) => ({ fileName: f.fileName, status: f.status, reason: f.reason ?? null, pages: f.pages ?? null, counts: f.counts ?? null, error: f.error ? String(f.error).slice(0, 300) : null }));
  say({ step: "job", status: final.status, files: `${final.filesCompleted}/${final.totalFiles}`, chunksIndexed: final.chunksIndexed, elapsedSeconds: final.elapsedSeconds, results });

  const after = await documentsHeld(s);
  say({ step: "after", ...after });
  const notIndexed = results.filter((r) => r.status !== "indexed");
  const held = after.documents.map((d) => d.source).sort();
  const wanted = [...FILES].sort();
  const failures = [];
  if (final.status !== "completed") failures.push(`job status ${final.status}`);
  if (notIndexed.length) failures.push(`not indexed: ${notIndexed.map((r) => `${r.fileName}:${r.status}`).join(", ")}`);
  if (JSON.stringify(held) !== JSON.stringify(wanted)) failures.push(`the class holds [${held.join(", ")}], not [${wanted.join(", ")}]`);
  say({ step: failures.length ? "FAILED" : "REBUILT", failures, documents: after.documents.length, chunks: after.documents.reduce((n, d) => n + (d.chunkCount || 0), 0) });
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { say({ step: "ERROR", error: String(e.stack || e).slice(0, 800) }); process.exit(1); });
