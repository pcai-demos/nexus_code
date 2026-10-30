/**
 * Ingestion job state — ticket T12 (finding F-18).
 *
 * This used to be a single module-global object. `POST /api/ingest` returned
 * 202 with no identifier and `/api/ingest/status` streamed that one object, so
 * state was not merely in-process, it was UNATTRIBUTED: any concurrent ingest
 * mutated the same fields and nothing let a caller correlate the state it read
 * with the job it started. Measured consequences (X6): a dropped connection
 * left an orphan running server-side; the next run polled status, saw the
 * orphan's completion and reported `chunksIndexed: 80` while its own collection
 * held 0 objects; a third run accumulated four docling traces for a two-file
 * ingest. A contaminated run looks *successful*, which is why this silently
 * invalidates automated measurement.
 *
 * The fix is identity, not persistence: jobs are registered under an id, the
 * status route is keyed by it, and a second concurrent ingest is refused
 * (409 INGEST_IN_PROGRESS) rather than interleaved. Durability/resume remains
 * out of scope (audit E15).
 *
 * BACKWARDS COMPATIBILITY: the default export is still a live object mirroring
 * the most recent job, because two existing consumers read it without any
 * notion of a job — the admin panel's `EventSource("/api/ingest/status")` and
 * the orchestrator's docling trace span. Both keep working unchanged.
 */

const { randomUUID } = require("crypto");

/** Jobs retained for status lookup after completion. Bounded; this is memory. */
const MAX_RETAINED_JOBS = 10;

const INGEST_ERROR_CODES = Object.freeze({
  // Same {success:false, code, error} shape as the retrieval taxonomy in
  // src/lib/rag/config.js — one convention, one owner per domain.
  INGEST_IN_PROGRESS: "INGEST_IN_PROGRESS",
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  INGEST_CONFIG_MISSING: "INGEST_CONFIG_MISSING",
  INGEST_FAILED: "INGEST_FAILED",
  // T07 (design D6): the job finished, some files did not fully index —
  // a partial file, a failed or empty file beside indexed ones, or a refused
  // supersede. The per-file reasons are in `fileResults`. Not an error body
  // code (the SSE frame is a 200); it lives here so the taxonomy has one owner.
  INGEST_PARTIAL: "INGEST_PARTIAL",
  // T21 (F-15) — the destructive routes. COLLECTION_REQUIRED: a clear / unload
  // / clear-preview request named no explicit collection (400; nothing is ever
  // targeted by default on a destructive path). DESTRUCTIVE_OP_FAILED: the
  // drop or delete did not happen — Weaviate refused or was unreachable (500;
  // the body's `completed` lists any steps that DID run). FILE_NOT_FOUND: the
  // unload route could not resolve the file whose chunks it was asked to
  // delete (404).
  COLLECTION_REQUIRED: "COLLECTION_REQUIRED",
  // T22 (design D11, finding F-59): an ingest or unload request named a file
  // whose resolved path is not under <cwd>/public/ (`..`, an absolute path
  // outside it). Refused before any file is read; nothing is started (400).
  PATH_OUTSIDE_PUBLIC: "PATH_OUTSIDE_PUBLIC",
  // Cut-over review (§11b R2 / R3): `clear` was sent a `confirmCollection`
  // (the class the person was shown and typed) that is not the class the
  // request resolves from (name, version). Nothing is dropped.
  CONFIRM_MISMATCH: "CONFIRM_MISMATCH",
  // T17 (design D12; F-79 / F-80): a destructive request carried a
  // `schemaVersion` that is none of 1 / "1" / 2 / "2" (before T17 the
  // normaliser silently read it as v1 — the frozen v1 class), or a
  // collection name ending in the version suffix `V2` (under version 2 it
  // would resolve `…V2V2`; under version 1 it would reshape the v2 class —
  // F-71's failure by request). Both 400; nothing is dropped. A destructive
  // route never guesses.
  SCHEMA_VERSION_INVALID: "SCHEMA_VERSION_INVALID",
  COLLECTION_NAME_INVALID: "COLLECTION_NAME_INVALID",
  DESTRUCTIVE_OP_FAILED: "DESTRUCTIVE_OP_FAILED",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
});

/** Ordered oldest → newest. */
const jobs = new Map();
let currentJobId = null;

function freshJobState(jobId, totalFiles) {
  return {
    jobId,
    status: "processing", // "processing" | "completed" | "partial" | "error" | "cancelled" (T07: derived from fileResults)
    currentFile: "",
    progressPercent: 0,
    elapsedSeconds: 0,
    etaSeconds: 0,
    chunksIndexed: 0,
    totalFiles,
    filesCompleted: 0,
    cancelled: false,
    error: null,
    errorCode: null,
    doclingTraces: [],
    // T07 (F-49 / E16 / T04's salvage): one entry per request path, in
    // request order, from `outcomes.newFileResult`; every input ends in a
    // terminal status with a reason, so "Chunks: 0" is never the whole story.
    fileResults: [],
    // T07: the first ledger append failure, if any — the store is still the
    // truth, but the person should know the record is incomplete.
    ledgerError: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

/** The one place a job id is minted. */
function createJob(totalFiles) {
  const jobId = randomUUID();
  const state = freshJobState(jobId, totalFiles);
  jobs.set(jobId, state);
  currentJobId = jobId;

  while (jobs.size > MAX_RETAINED_JOBS) {
    const oldest = jobs.keys().next().value;
    if (oldest === currentJobId) break;
    jobs.delete(oldest);
  }

  syncLegacyView();
  return state;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function getCurrentJob() {
  return currentJobId ? jobs.get(currentJobId) || null : null;
}

/**
 * True while a job is still running. This is the concurrency gate: a second
 * ingest is refused rather than queued, because an in-process queue dies with
 * the pod and would reintroduce the same "a job I cannot attribute" problem in
 * a new shape, while rejection actually prevents the overlapping-writes path.
 *
 * T07 (F-63, design D7): the lock is held for as long as the WORKER is
 * running — a cancel sets `cancelled` and the job stays "processing" until
 * its in-flight batches have landed and the worker writes the terminal
 * status. Before T07 `!job.cancelled` released the lock the moment the
 * cancel route ran, and a second ingest was accepted 318 ms later while the
 * first job's batch was still inserting (measured, t07-artifacts).
 */
function activeJob() {
  const job = getCurrentJob();
  return job && job.status === "processing" ? job : null;
}

/** Every job id still retained in memory (for the ledger's live/interrupted distinction). */
function retainedJobIds() {
  return [...jobs.keys()];
}

function finishJob(job, status, { error = null, errorCode = null } = {}) {
  if (!job) return;
  job.status = status;
  job.error = error;
  job.errorCode = errorCode;
  job.finishedAt = new Date().toISOString();
  syncLegacyView();
}

/**
 * Legacy singleton view — the most recent job, in the pre-T12 field shape plus
 * `jobId`. Consumers that never learned about jobs keep reading this and see
 * exactly what they saw before: the newest job's progress.
 */
const ingestionState = {
  status: "idle",
  currentFile: "",
  progressPercent: 0,
  elapsedSeconds: 0,
  etaSeconds: 0,
  chunksIndexed: 0,
  totalFiles: 0,
  filesCompleted: 0,
  cancelled: false,
  error: null,
  doclingTraces: [],
  jobId: null,
};

const MIRRORED_FIELDS = [
  "status", "currentFile", "progressPercent", "elapsedSeconds", "etaSeconds",
  "chunksIndexed", "totalFiles", "filesCompleted", "cancelled", "error",
  "doclingTraces", "jobId", "lastProfile", "lastMetrics",
  "fileResults", "ledgerError",
];

/**
 * Copy the current job's fields onto the legacy view. Called after every
 * mutation; the ingest route calls it as it updates progress.
 */
function syncLegacyView() {
  const job = getCurrentJob();
  if (!job) return;
  for (const key of MIRRORED_FIELDS) {
    if (key in job) ingestionState[key] = job[key];
  }
}

/**
 * Serialisable snapshot for the status route. Built field by field rather than
 * by spreading the module object, so the helper functions attached to the
 * legacy export below can never leak into a response body.
 */
function snapshot(job) {
  const source = job || ingestionState;
  const out = {};
  for (const key of MIRRORED_FIELDS) {
    if (key in source) out[key] = source[key];
  }
  if (job) {
    out.startedAt = job.startedAt;
    out.finishedAt = job.finishedAt;
    out.errorCode = job.errorCode;
  }
  out.jobId = job ? job.jobId : currentJobId;
  return out;
}

/**
 * T07 (design D8): the status-route frame for a job that lives only in the
 * ledger (`ledger.jobsFrom` output). The frame SHAPE is this module's, so it
 * is built here, not in the ledger module (which knows nothing of SSE).
 */
function snapshotFromLedgerJob(job) {
  const terminal = job.status !== "processing";
  const files = Array.isArray(job.files) ? job.files : [];
  const done = files.filter((f) => !["pending", "parsing", "parsed", "indexing"].includes(f.status)).length;
  return {
    jobId: job.jobId,
    status: job.status,
    currentFile: "",
    progressPercent: terminal ? 100 : 0,
    elapsedSeconds: null,
    etaSeconds: 0,
    chunksIndexed: Number.isFinite(job.chunksInserted) ? job.chunksInserted : 0,
    totalFiles: job.totalFiles ?? files.length,
    filesCompleted: done,
    cancelled: job.status === "cancelled",
    error: job.error ?? null,
    errorCode: job.errorCode ?? null,
    doclingTraces: [],
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    fileResults: files,
    ledgerError: null,
    reconstructed: true,
  };
}

module.exports = ingestionState;
module.exports.ingestionState = ingestionState;
module.exports.INGEST_ERROR_CODES = INGEST_ERROR_CODES;
module.exports.createJob = createJob;
module.exports.getJob = getJob;
module.exports.getCurrentJob = getCurrentJob;
module.exports.activeJob = activeJob;
module.exports.retainedJobIds = retainedJobIds;
module.exports.snapshotFromLedgerJob = snapshotFromLedgerJob;
module.exports.finishJob = finishJob;
module.exports.syncLegacyView = syncLegacyView;
module.exports.snapshot = snapshot;
