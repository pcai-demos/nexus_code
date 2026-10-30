/**
 * Integration harness (evaluation-plan §4).
 *
 * SAFETY: these suites write to a vector store. The shared production class
 * `RAGChunk` must never be touched. Every collection name that reaches a request
 * builder here passes through assertEvalCollection(), which hard-fails on
 * anything that is not a disposable `RAGEval_*` collection. The guard is
 * deliberately in the harness rather than in each suite so an individual test
 * cannot opt out of it.
 *
 * These suites are skipped unless the live-service environment is configured:
 *   RAG_EVAL_WEAVIATE_URL   e.g. http://127.0.0.1:8080
 *   RAG_EVAL_EMBED_URL      e.g. https://embed.example/v1
 *   RAG_EVAL_EMBED_MODEL    the model that built the target collection — identity,
 *                           never defaulted (the old default here named a 2560-dim
 *                           model against 4096-dim collections; see F-12)
 * Optional:
 *   RAG_EVAL_TOKEN          bearer/auth token for embed + Weaviate
 *   RAG_EVAL_APP_URL        default http://127.0.0.1:3000 (the Next.js app)
 *   RAG_EVAL_SCHEMA_VERSION the class SHAPE a suite reads or writes: "1" or
 *                           "2" (cut-over, design D12). The server's default
 *                           is 2 since the cut-over, so a request that names
 *                           a v1 class without stating its version would read
 *                           or write a `V2` sibling. Suites that only READ the
 *                           populated T08 class default to 1 and say so in
 *                           their headers; suites that build their own class
 *                           state what they build.
 */

const FORBIDDEN_COLLECTIONS = new Set(["RAGChunk", "ragchunk", "RAGCHUNK"]);

// T39 (design D2; F-154, F-138): the harness names no chat model of its own.
// The demo's chat model has been ONE string since T37 D8 — vlm_captioner.js's
// DEFAULT_CAPTION_MODEL (it captions and it chats) — and every suite and
// runner that chats falls back to it. The old literal here was the VLM, whose
// hidden reasoning spends the whole output budget (GENERATION_EMPTY) and read
// as a suite red in session 39.
const { DEFAULT_CAPTION_MODEL: DEFAULT_CHAT_MODEL } = require("../../src/lib/ingestion/vlm_captioner");

/**
 * @throws if `name` is not a disposable eval collection.
 */
function assertEvalCollection(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("[eval guard] collection name is required");
  }
  if (FORBIDDEN_COLLECTIONS.has(name.trim())) {
    throw new Error(
      `[eval guard] refusing to operate on the shared production collection "${name}". ` +
        "Integration tests must use a disposable RAGEval_* collection."
    );
  }
  if (!/^RAGEval_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `[eval guard] collection "${name}" is not a disposable eval collection ` +
        "(expected /^RAGEval_[A-Za-z0-9_]+$/)."
    );
  }
  return name;
}

/**
 * The schema version a suite states on every request (cut-over, design D12).
 * `RAG_EVAL_SCHEMA_VERSION` unset → `defaultVersion`; "1" → 1; "2" → 2; any
 * other value is a hard failure, never silently v1 — the server's own
 * normaliser treats garbage as v1 on purpose (a write-path default), but a
 * harness that measured the wrong shape by a typo would be F-24's family.
 */
function evalSchemaVersion(defaultVersion = 1) {
  const raw = process.env.RAG_EVAL_SCHEMA_VERSION;
  if (raw === undefined || raw === "") return defaultVersion;
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  throw new Error(`[eval guard] RAG_EVAL_SCHEMA_VERSION="${raw}" is not "1" or "2"`);
}

function envConfig() {
  const weaviateUrl = process.env.RAG_EVAL_WEAVIATE_URL;
  const embedUrl = process.env.RAG_EVAL_EMBED_URL;
  const embedModel = process.env.RAG_EVAL_EMBED_MODEL;
  if (!weaviateUrl || !embedUrl || !embedModel) return null;

  return {
    weaviateUrl,
    embedUrl,
    embedModel,
    token: process.env.RAG_EVAL_TOKEN || "",
    // Per-endpoint, never shared: each MLIS deployment authorises its own
    // service account, and a token from one returns 403 at another — silently,
    // on the rerank path (F-22). Falls back to the shared token only because
    // Ollama and Weaviate accept it.
    rerankToken: process.env.RAG_EVAL_RERANK_TOKEN || process.env.RAG_EVAL_TOKEN || "",
    rerankUrl: process.env.RAG_EVAL_RERANK_URL || "",
    rerankModel: process.env.RAG_EVAL_RERANK_MODEL || "",
    chatUrl: process.env.RAG_EVAL_CHAT_URL || embedUrl,
    chatModel: process.env.RAG_EVAL_CHAT_MODEL || DEFAULT_CHAT_MODEL,
    appUrl: process.env.RAG_EVAL_APP_URL || "http://127.0.0.1:3000",
  };
}

/** Reason string for node:test `skip`, or false when the suite can run. */
function skipReason() {
  return envConfig()
    ? false
    : "live services not configured — set RAG_EVAL_WEAVIATE_URL, RAG_EVAL_EMBED_URL " +
        "and RAG_EVAL_EMBED_MODEL";
}

/**
 * Collection name for this run. Unique per process so parallel or repeated runs
 * never collide, and always inside the RAGEval_ namespace.
 */
function makeRunCollection(suffix = "") {
  const stamp = `${Date.now().toString(36)}_${process.pid}`;
  const clean = suffix ? `_${suffix.replace(/[^A-Za-z0-9_]/g, "")}` : "";
  return assertEvalCollection(`RAGEval_${stamp}${clean}`);
}

async function postJson(url, body, timeoutMs = 120000) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body preserved in `text` */
  }
  return { status: res.status, ok: res.ok, json, text };
}

/**
 * The first complete SSE event in `buffer` (T39 design D3; F-140). The status
 * route streams `text/event-stream` and a thirteen-file frame is ~26 KB, so
 * ONE `reader.read()` can hand back a `data:` line cut mid-JSON. An event is
 * complete only when its `data:` line is followed by a blank line; until then
 * this answers `{ complete: false }` — never a parse error. Pure; pinned by
 * U-HARNESS and U-RECAPTION. (Moved here from t37-artifacts/recaption_production.js,
 * which imports it back, so the tree holds one reader.)
 */
function parseFrame(buffer) {
  const text = String(buffer || "");
  const at = text.indexOf("data: ");
  if (at < 0) return { complete: false, payload: null };
  const end = text.indexOf("\n\n", at);
  if (end < 0) return { complete: false, payload: null };
  const line = text.slice(at, end).split("\n").find((l) => l.startsWith("data: "));
  return { complete: true, payload: JSON.parse(line.slice(6)) };
}

/**
 * One frame of GET /api/ingest/status: read the stream until the buffer holds
 * a complete event, then cancel. Never `.json()` / `.text()` the route — it
 * never closes. F-18's job guard: a frame for another job is an error, never
 * this job's state.
 */
async function readFrame(appUrl, jobId = null, { timeoutMs = 15000, maxReads = 64 } = {}) {
  const url = jobId
    ? `${appUrl}/api/ingest/status?jobId=${encodeURIComponent(jobId)}`
    : `${appUrl}/api/ingest/status`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let parsed = { complete: false, payload: null };
  try {
    for (let reads = 0; reads < maxReads && !parsed.complete; reads++) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      parsed = parseFrame(buffer);
    }
  } finally {
    try { await reader.cancel(); } catch (e) { /* the frame is read */ }
  }
  if (!parsed.complete) throw new Error(`the status route's frame did not complete in ${buffer.length} chars`);
  const j = parsed.payload;
  if (jobId && j.jobId && j.jobId !== jobId) {
    throw new Error(
      `[F-18] ingestion status returned job ${j.jobId} while waiting on ${jobId} — ` +
        "refusing to accept another job's state as this one's result"
    );
  }
  return j;
}

/**
 * Poll the ingestion state until it leaves "processing".
 *
 * ALWAYS pass the `jobId` returned by POST /api/ingest. Without it this reads
 * the most recent job, whoever started it — and "status is no longer
 * processing" is not evidence about your job unless the state you read is
 * attributable to it. That is exactly how an automated run once reported
 * `chunksIndexed: 80` while its own collection held 0 objects (F-18).
 *
 * T39 (F-140): one whole frame per poll through `readFrame`; a read that
 * fails or does not complete is retried on the next tick (and reported through
 * `onError`), never taken for a settled job — only the deadline throws. A
 * frame for another job (F-18) is NOT retried: it is the caller's error.
 */
async function waitForIngestion(appUrl, jobId = null, timeoutMs = 600000, { onFrame = null, onError = null, everyMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      last = await readFrame(appUrl, jobId);
      lastError = null;
      if (onFrame && last) onFrame(last);
      if (last && last.status !== "processing") return last;
    } catch (err) {
      if (String(err.message).startsWith("[F-18]")) throw err;
      lastError = err;
      if (onError) onError(err);
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(
    `ingestion did not settle within ${timeoutMs}ms (last state: ${JSON.stringify(last)}` +
      `${lastError ? `; last read error: ${lastError.message}` : ""})`
  );
}

/**
 * Drop an eval collection. Guarded, and a no-op when the app is unreachable so
 * teardown never masks the real test failure.
 */
async function dropCollection(config, collection, schemaVersion) {
  assertEvalCollection(collection);
  // Cut-over (review §11b M7): `clear` resolves the class from (name, version)
  // with a v2 default, so the caller must say which shape it built.
  if (schemaVersion !== 1 && schemaVersion !== 2) throw new Error("[eval teardown] dropCollection needs schemaVersion 1 or 2");
  try {
    await postJson(`${config.appUrl}/api/ingest/clear`, {
      weaviateUrl: config.weaviateUrl,
      token: config.token,
      mlisToken: config.token,
      weaviateCollection: collection,
      schemaVersion,
    });
  } catch (err) {
    console.warn(`[eval teardown] could not drop ${collection}: ${err.message}`);
  }
}

module.exports = {
  assertEvalCollection,
  evalSchemaVersion,
  envConfig,
  skipReason,
  makeRunCollection,
  postJson,
  parseFrame,
  readFrame,
  waitForIngestion,
  dropCollection,
  DEFAULT_CHAT_MODEL,
};
