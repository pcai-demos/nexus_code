/**
 * Ingestion ledger — ticket T07 (audit FM-L3 / E15 / E16 / E42; findings
 * F-48, F-49, F-52, F-61, F-63, F-64, F-30).
 *
 * The durable record of what was ingested, with which model, and how far
 * each file got. Before T07 the only record of an ingest was the in-process
 * job registry (E15): a pod roll erased it, a partial document (some batches
 * inserted, then an embedder outage or a cancel) was indistinguishable from
 * a complete one, and the duplicate skip therefore froze partial documents
 * forever (F-48, F-61 — both measured live, t07-artifacts).
 *
 * Pure module over a file path: no Next.js, no orchestrator, no network
 * (the owner's modularity direction, T09 D7). The ingest route composes it
 * with the vector store; nothing here decides a skip or a delete on its
 * own — the ledger is a RECORD, and the store is cross-checked for every
 * decision that matters (design §3).
 *
 * Format: JSON lines, one event per line, appended with O_APPEND by the
 * one writer this deployment has (replicaCount 1, one worker at a time
 * since T12). Every event carries `ts`, `pid`, `event` and the `jobId` it
 * belongs to. A torn last line (a crash mid-write) is skipped and counted
 * on read, never thrown on. Compaction rewrites to a temp file and renames
 * (atomic on one filesystem, NFSv4 included) and is idempotent.
 *
 * Where the file lives is the deployment's decision (design D1): the
 * default is `nexcode-data/state/rag/ledger.jsonl` under the working
 * directory — an app-only PVC subPath in the chart — and RAG_LEDGER_PATH
 * overrides it. The module cannot know whether the path is durable; the
 * status route reports what the file holds rather than promising survival.
 */

const fs = require("fs");
const path = require("path");
// T46 (design D9, D16): the chain pass's counts — one list (pure) for every surface they travel.
const { CHAIN_COUNT_KEYS } = require("../ingestion/dimension_chain");

/** The vocabulary. An event outside it is refused before it is written. */
const EVENT_TYPES = Object.freeze([
  "ingest_start",
  "file_parsed",
  "file_indexed",
  "file_failed",
  "file_skipped",
  "file_superseded",
  "ingest_end",
  "collection_created",
  "collection_cleared",
  "file_unloaded",
]);

/** The two events that say how far a (sourceId, docVersion) got. */
const FILE_TERMINAL_EVENTS = Object.freeze(["file_indexed", "file_failed"]);

const COMPACT_EVENTS = 5000;
const COMPACT_BYTES = 4 * 1024 * 1024;
const KEEP_JOBS = 20;

function defaultLedgerPath() {
  const fromEnv = process.env.RAG_LEDGER_PATH;
  if (typeof fromEnv === "string" && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(process.cwd(), "nexcode-data", "state", "rag", "ledger.jsonl");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Parse JSON lines; an unparsable line is counted, not thrown on. */
function parseLines(text) {
  const events = [];
  let corruptLines = 0;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && typeof obj.event === "string") events.push(obj);
      else corruptLines += 1;
    } catch {
      corruptLines += 1;
    }
  }
  return { events, corruptLines };
}

/** Always from disk. `{ exists, events, corruptLines, bytes }`. */
function readEvents(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, events: [], corruptLines: 0, bytes: 0 };
  const text = fs.readFileSync(filePath, "utf8");
  const { events, corruptLines } = parseLines(text);
  return { exists: true, events, corruptLines, bytes: Buffer.byteLength(text) };
}

// ---------------------------------------------------------------------------
// The in-process index — loaded once per path, kept current by appendEvent,
// so a skip decision is a lookup and a status frame never reads the file.
// ---------------------------------------------------------------------------

const indexes = new Map();

function loadIndex(filePath) {
  const read = readEvents(filePath);
  return { ...read, version: 0 };
}

function getIndex(filePath) {
  if (!indexes.has(filePath)) indexes.set(filePath, loadIndex(filePath));
  return indexes.get(filePath);
}

/** Drop the cached index (all of them without an argument). Tests, and compaction. */
function resetIndex(filePath) {
  if (filePath === undefined) indexes.clear();
  else indexes.delete(filePath);
}

/**
 * Reload the index when the file on disk is not the size the index thinks
 * it is — another writer appended (a rolling update overlaps the old pod's
 * worker with the new pod for a while, and both share the PVC file), or
 * the file was removed. One stat; called before every append and by the
 * status route every few seconds (review §6a). Returns true when reloaded.
 */
function revalidateIndex(filePath) {
  const index = indexes.get(filePath);
  if (!index) return false;
  let size = 0;
  let exists = true;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    exists = false;
  }
  if (exists === index.exists && size === index.bytes) return false;
  indexes.set(filePath, loadIndex(filePath));
  return true;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Append one event. Returns the record as written (with `ts` and `pid`).
 * Throws on an event outside the vocabulary or a non-object payload —
 * a ledger that accepts anything records nothing reliably.
 */
function appendEvent(filePath, event) {
  if (typeof filePath !== "string" || !filePath) throw new Error("ledger.appendEvent: a file path is required");
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("ledger.appendEvent: the event must be an object");
  }
  if (!EVENT_TYPES.includes(event.event)) {
    throw new Error(`ledger.appendEvent: unknown event type ${JSON.stringify(event.event ?? null)}`);
  }
  const record = { ts: typeof event.ts === "string" ? event.ts : new Date().toISOString(), pid: process.pid, ...event };
  record.ts = typeof event.ts === "string" ? event.ts : record.ts;
  const line = JSON.stringify(record);
  // Load the index BEFORE the write, or a first-use load would read the
  // line just written and the push below would count it twice — and
  // revalidate it, so a line another process appended is not lost.
  revalidateIndex(filePath);
  const index = getIndex(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // A crash mid-write leaves a torn last line with no newline; appending
  // straight after it would glue the new event onto the fragment and lose
  // both. Start a fresh line whenever the file does not end with one.
  const prefix = endsWithNewline(filePath) ? "" : "\n";
  fs.appendFileSync(filePath, prefix + line + "\n");
  index.events.push(record);
  index.bytes += Buffer.byteLength(prefix + line) + 1;
  index.exists = true;
  index.version += 1;
  return record;
}

/** True for a missing or empty file too (nothing to separate from). */
function endsWithNewline(filePath) {
  let fd = null;
  try {
    const { size } = fs.statSync(filePath);
    if (size === 0) return true;
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } catch {
    return true;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/** True when the file has grown past the thresholds. Never called mid-job by the route. */
function shouldCompact(filePath, { maxEvents = COMPACT_EVENTS, maxBytes = COMPACT_BYTES } = {}) {
  const index = getIndex(filePath);
  return index.events.length > maxEvents || index.bytes > maxBytes;
}

/**
 * What compaction keeps, in original order:
 *  - every event of the last `keepJobs` jobs that still have an ingest_start;
 *  - the latest terminal file event per (collection, sourceId) — one per
 *    document, whatever its version: the store holds one version per
 *    sourceId (T06), and a skip only ever asks about the version on disk,
 *    so an older version's record can be dropped (it re-indexes once if the
 *    file is ever reverted — a cost, never a wrong skip; review §6a);
 *  - the latest file_parsed per (collection, sourceId) — the recorded engine facts;
 *  - the latest file_unloaded per (collection, sourceId), and the latest
 *    collection_created / collection_cleared per collection — the events
 *    that can invalidate or pin a record;
 *  - T16: a pin WITNESS per (collection, store, model) after the
 *    collection's latest reset — the first landed record (a file_indexed,
 *    or a partial with chunks inserted) of that key, added only when none
 *    of the records the rules above keep is a landed record of the same
 *    key. Without it a document whose latest terminal record is a failed
 *    re-ingest would, once its indexing job is dropped, leave the pin
 *    provisional and let the next wrong-model ingest through; a mixed
 *    record (two names, one dimension) would lose its first writer and its
 *    disclosure; and two stores sharing a class name would keep one witness
 *    (design §7, review). The guard keeps T07's property that an older
 *    version's record may go when a newer landed record of the same model
 *    survives (the pin reads the same model and dimension from either).
 * Each rule is "latest per key", "all of the last K", or "the first per
 * key unless one is already kept", so applying it to its own output
 * selects the same set: compact ∘ compact ≡ compact.
 */
function selectCompacted(events, { keepJobs = KEEP_JOBS } = {}) {
  const keep = new Set();
  const jobsWithStart = [];
  const seenStart = new Set();
  for (const e of events) {
    if (e.event === "ingest_start" && e.jobId && !seenStart.has(e.jobId)) {
      seenStart.add(e.jobId);
      jobsWithStart.push(e.jobId);
    }
  }
  const keptJobs = new Set(jobsWithStart.slice(-keepJobs));
  const lastReset = new Map(); // collection -> index of its latest collection_created / collection_cleared
  events.forEach((e, i) => {
    if (e.event === "collection_created" || e.event === "collection_cleared") lastReset.set(e.collection, i);
  });
  const latest = new Map(); // rule key -> event index
  events.forEach((e, i) => {
    if (e.jobId && keptJobs.has(e.jobId)) keep.add(i);
    if (FILE_TERMINAL_EVENTS.includes(e.event)) latest.set(`t|${e.collection}|${e.sourceId}`, i);
    else if (e.event === "file_parsed") latest.set(`p|${e.collection}|${e.sourceId}`, i);
    else if (e.event === "file_unloaded") latest.set(`u|${e.collection}|${e.sourceId}`, i);
    else if (e.event === "collection_created" || e.event === "collection_cleared") latest.set(`c|${e.event}|${e.collection}`, i);
  });
  for (const i of latest.values()) keep.add(i);
  // T16: the pin witnesses (see above). Keyed after the rules above have
  // decided, so a witness is added only where none survives already.
  const pinKey = (e) => `${e.collection}|${typeof e.store === "string" ? e.store : ""}|${typeof e.embedModel === "string" ? e.embedModel.trim() : ""}`;
  const afterReset = (e, i) => isLandedRecord(e) && e.collection && i > (lastReset.get(e.collection) ?? -1);
  const witnessed = new Set();
  events.forEach((e, i) => {
    if (keep.has(i) && afterReset(e, i)) witnessed.add(pinKey(e));
  });
  const first = new Map();
  events.forEach((e, i) => {
    if (!afterReset(e, i)) return;
    const key = pinKey(e);
    if (!witnessed.has(key) && !first.has(key)) first.set(key, i);
  });
  for (const i of first.values()) keep.add(i);
  return events.filter((_, i) => keep.has(i));
}

/**
 * Rewrite the file compacted. Temp file + rename, so a crash leaves either
 * the old file or the new one, never a torn mix. Returns the before/after
 * counts. The in-process index is reloaded from the new file.
 */
function compact(filePath, opts = {}) {
  const { events, corruptLines } = readEvents(filePath);
  const kept = selectCompacted(events, opts);
  const tmp = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, kept.map((e) => JSON.stringify(e)).join("\n") + (kept.length ? "\n" : ""));
  fs.renameSync(tmp, filePath);
  resetIndex(filePath);
  return { before: events.length, after: kept.length, corruptLinesDropped: corruptLines };
}

// ---------------------------------------------------------------------------
// Pure reducers over an events array (the index's or a fresh read's)
// ---------------------------------------------------------------------------

/**
 * The latest record of how far `(collection, sourceId, docVersion)` got, or
 * null. A later file_unloaded for the sourceId or collection_cleared for
 * the collection does not erase the record but marks it `invalidatedBy`:
 * the caller then knows the record exists AND that the store may not
 * agree with it any more.
 */
function latestFileOutcome(events, { collection, sourceId, docVersion }) {
  let outcome = null;
  for (const e of events) {
    if (e.collection !== collection) continue;
    if (FILE_TERMINAL_EVENTS.includes(e.event) && e.sourceId === sourceId && e.docVersion === docVersion) {
      outcome = {
        event: e.event,
        status: e.status ?? null,
        chunksEmitted: e.counts?.chunksEmitted ?? null,
        chunksInserted: e.counts?.chunksInserted ?? null,
        ts: e.ts ?? null,
        jobId: e.jobId ?? null,
        invalidatedBy: null,
        invalidatedAt: null,
      };
    } else if (outcome && ((e.event === "file_unloaded" && e.sourceId === sourceId) || e.event === "collection_cleared")) {
      outcome = { ...outcome, invalidatedBy: e.event, invalidatedAt: e.ts ?? null };
    }
  }
  return outcome;
}

/**
 * T16: a terminal file event whose vectors are IN the class — file_indexed,
 * or a partial with chunks inserted. A failed record with nothing inserted
 * still carries the dimension of vectors that never landed (measured:
 * t16-artifacts §0 step 3, `embedDim 2560, chunksInserted 0`) and must never
 * pin a space.
 */
function isLandedRecord(e) {
  if (!e || typeof e !== "object") return false;
  if (e.event === "file_indexed") return true;
  return e.event === "file_failed" && e.status === "partial" && Number.isInteger(e.counts?.chunksInserted) && e.counts.chunksInserted > 0;
}

/**
 * The Weaviate origin a record was written against (T16, design D10):
 * protocol + host only — never a path, a query string or userinfo. Null
 * when the value is not a URL. The ledger is keyed by class NAME; two stores
 * sharing a name would otherwise share a pin.
 */
function storeOriginOf(url) {
  try {
    const u = new URL(String(url));
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * T16 (design D1): the embedding-space pin of a collection — "which vector
 * space were this collection's vectors written in, as far as this app has
 * seen". DERIVED from the events, never declared; null when no event names
 * the collection at all. Rules, in event order:
 *  1. collection_cleared resets the pin to nothing (`clear` dropped the class);
 *  2. collection_created resets it to a PROVISIONAL one — the request's
 *     name, no dimension, `enforceable: false` (a second creation for a
 *     pinned name means the class was dropped and recreated out of band);
 *  3. the first record whose vectors LANDED makes it enforceable, with that
 *     record's model and MEASURED dimension;
 *  4. a landed record of another dimension starts a new pin — Weaviate
 *     cannot hold two dimensionalities in one class, so the class was
 *     rebuilt without the ledger seeing it (`repinnedFrom` says so);
 *  5. a landed record of the same dimension under another name does not
 *     move the pin (the first writer wins) but joins `modelsSeen` — a mixed
 *     record is disclosed, never averaged.
 * `store` (optional) ignores records written against another Weaviate
 * origin; a record without the field (pre-T16) matches any store.
 */
function getCollectionPin(events, { collection, store } = {}) {
  if (typeof collection !== "string" || !collection) throw new Error("ledger.getCollectionPin: collection is required");
  const storeFilter = typeof store === "string" && store ? store : null;
  const fresh = () => ({ collection, store: storeFilter, embedModel: null, embedDim: null, enforceable: false, pinnedAt: null, pinnedBy: null, source: null, since: null, modelsSeen: [], landedRecords: 0 });
  const nameOf = (e) => (typeof e.embedModel === "string" && e.embedModel.trim() ? e.embedModel.trim() : null);
  let pin = null;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== "object" || e.collection !== collection) continue;
    if (storeFilter && typeof e.store === "string" && e.store && e.store !== storeFilter) continue;
    if (e.event === "collection_cleared") {
      pin = { ...fresh(), since: { event: e.event, ts: e.ts ?? null } };
      continue;
    }
    if (e.event === "collection_created") {
      const name = nameOf(e);
      pin = { ...fresh(), embedModel: name, pinnedAt: name ? e.ts ?? null : null, pinnedBy: name ? e.jobId ?? null : null, source: name ? "collection_created" : null, since: { event: e.event, ts: e.ts ?? null }, modelsSeen: name ? [name] : [] };
      continue;
    }
    if (!isLandedRecord(e)) continue;
    const name = nameOf(e);
    const dim = Number.isInteger(e.embedDim) && e.embedDim > 0 ? e.embedDim : null;
    if (!name || !dim) continue;
    if (!pin) pin = fresh();
    if (!pin.enforceable) {
      pin = { ...pin, embedModel: name, embedDim: dim, enforceable: true, pinnedAt: e.ts ?? null, pinnedBy: e.jobId ?? null, source: e.event, modelsSeen: [name], landedRecords: 1 };
      continue;
    }
    if (dim !== pin.embedDim) {
      pin = { ...pin, repinnedFrom: { embedModel: pin.embedModel, embedDim: pin.embedDim, pinnedAt: pin.pinnedAt }, embedModel: name, embedDim: dim, pinnedAt: e.ts ?? null, pinnedBy: e.jobId ?? null, source: e.event, modelsSeen: [name], landedRecords: 1 };
      continue;
    }
    pin = { ...pin, landedRecords: pin.landedRecords + 1, modelsSeen: pin.modelsSeen.includes(name) ? pin.modelsSeen : [...pin.modelsSeen, name] };
  }
  return pin;
}

/** True iff the record says the version was written whole and nothing since has removed it. */
function isRecordedComplete(outcome) {
  return Boolean(
    outcome &&
      outcome.event === "file_indexed" &&
      outcome.status === "complete" &&
      Number.isInteger(outcome.chunksInserted) &&
      outcome.chunksInserted > 0 &&
      !outcome.invalidatedBy
  );
}

const FILE_EVENT_STATUS = Object.freeze({
  file_indexed: () => "indexed",
  file_failed: (e) => (e.status === "partial" ? "partial" : e.status === "empty" ? "empty" : "failed"),
  file_skipped: (e) => (e.reason === "cancelled" ? "cancelled" : "skipped"),
  file_parsed: () => "parsing",
});

/**
 * Every job the events describe, in first-appearance order. A job with an
 * ingest_start and no ingest_end that this process does not hold live is
 * INTERRUPTED — the pod died under it (E15's consequence, finally
 * nameable). `liveJobIds` is the caller's set of jobs still in memory.
 */
function jobsFrom(events, { liveJobIds } = {}) {
  const live = liveJobIds instanceof Set ? liveJobIds : new Set(liveJobIds || []);
  const jobs = new Map();
  for (const e of events) {
    if (!e.jobId) continue;
    if (e.event === "ingest_start") {
      jobs.set(e.jobId, {
        jobId: e.jobId,
        collection: e.collection ?? null,
        schemaVersion: e.schemaVersion ?? null,
        duplicatePolicy: e.duplicatePolicy ?? null,
        embedModel: e.embedModel ?? null,
        startedAt: e.ts ?? null,
        finishedAt: null,
        status: null,
        error: null,
        errorCode: null,
        totalFiles: Number.isInteger(e.fileCount) ? e.fileCount : Array.isArray(e.files) ? e.files.length : null,
        files: new Map(Array.isArray(e.files) ? e.files.map((f) => [f, { filePath: f, fileName: path.posix.basename(String(f)), status: "pending", reason: null, error: null, counts: null, superseded: null, sourceId: null, docVersion: null }]) : []),
      });
      continue;
    }
    const job = jobs.get(e.jobId);
    if (!job) continue; // an orphan event whose start was compacted away
    if (e.event === "ingest_end") {
      job.finishedAt = e.ts ?? null;
      job.status = e.status ?? null;
      job.error = e.error ?? null;
      job.errorCode = e.errorCode ?? null;
      continue;
    }
    const toStatus = FILE_EVENT_STATUS[e.event];
    if (!toStatus) continue;
    const key = e.filePath ?? e.sourceId ?? e.fileName;
    if (!job.files.has(key)) job.files.set(key, { filePath: e.filePath ?? null, fileName: e.fileName ?? null, status: "pending", reason: null, error: null, counts: null, superseded: null, sourceId: null, docVersion: null });
    const f = job.files.get(key);
    f.status = toStatus(e);
    f.reason = e.reason ?? f.reason;
    f.error = e.error ?? (e.event === "file_indexed" ? null : f.error);
    if (e.counts) f.counts = { ...e.counts };
    if (e.sourceId) f.sourceId = e.sourceId;
    if (e.docVersion) f.docVersion = e.docVersion;
    if (e.fileName) f.fileName = e.fileName;
    if (e.event === "file_indexed" && typeof e.superseded === "number") f.superseded = e.superseded;
  }
  const out = [];
  for (const job of jobs.values()) {
    const files = [...job.files.values()];
    if (!job.status) {
      job.status = live.has(job.jobId) ? "processing" : "interrupted";
      if (job.status === "interrupted") {
        for (const f of files) if (!["indexed", "partial", "failed", "skipped", "empty", "cancelled"].includes(f.status)) f.status = "interrupted";
      }
    }
    out.push({ ...job, files, chunksInserted: files.reduce((a, f) => a + (f.counts?.chunksInserted || 0), 0) });
  }
  return out;
}

/** The compact summary the status route puts on every frame. */
function summarise(events, { liveJobIds } = {}) {
  const jobs = jobsFrom(events, { liveJobIds });
  const last = jobs.length ? jobs[jobs.length - 1] : null;
  return {
    events: events.length,
    jobs: jobs.length,
    interrupted: jobs.filter((j) => j.status === "interrupted").length,
    lastJob: last ? { jobId: last.jobId, status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, collection: last.collection } : null,
  };
}

/**
 * The parse facts recorded for every document still in `collection`: the
 * latest file_parsed per sourceId, dropped when a later file_unloaded or
 * collection_cleared removed the document. The parser span reads these for
 * documents this process did not ingest (F-30) — facts recorded at ingest
 * time, marked as such, never guessed from an extension.
 */
function recordedParseFacts(events, { collection }) {
  const facts = new Map();
  // A parse describes chunks that may never have landed (an insert that
  // failed at batch 0 leaves the previous version serving — T06 D4). A
  // fact is therefore PENDING until that parse's chunks are in the store:
  // file_indexed, or file_failed with status partial (review §6a).
  const pending = new Map();
  const landed = (e) => e.event === "file_indexed" || (e.event === "file_failed" && e.status === "partial");
  for (const e of events) {
    if (e.collection !== collection) continue;
    if (FILE_TERMINAL_EVENTS.includes(e.event) && e.sourceId) {
      const key = `${e.sourceId}|${e.docVersion}`;
      const fact = pending.get(key);
      pending.delete(key);
      if (landed(e) && fact) facts.set(e.sourceId, fact);
      continue;
    }
    if (e.event === "file_parsed" && e.sourceId) {
      pending.set(`${e.sourceId}|${e.docVersion}`, {
        fileName: e.fileName ?? null,
        filePath: e.filePath ?? null,
        sourceId: e.sourceId,
        docVersion: e.docVersion ?? null,
        engineId: typeof e.engine === "string" ? e.engine : null,
        engine: typeof e.engineLabel === "string" ? e.engineLabel : null,
        paginated: typeof e.paginated === "boolean" ? e.paginated : null,
        pageCount: Number.isFinite(e.counts?.pages) ? e.counts.pages : null,
        chunkCount: Number.isFinite(e.counts?.chunksEmitted) ? e.counts.chunksEmitted : null,
        picturesCaptured: Number.isFinite(e.counts?.figuresCaptured) ? e.counts.figuresCaptured : null,
        vlmCaptionsGenerated: Number.isFinite(e.counts?.figuresCaptioned) ? e.counts.figuresCaptioned : null,
        // T24: the other outcomes, recorded (null on a pre-T24 record).
        vlmDecorative: Number.isFinite(e.counts?.figuresDecorative) ? e.counts.figuresDecorative : null,
        // T32: the text-only verdicts (null on a pre-T32 record, never 0).
        vlmTextOnly: Number.isFinite(e.counts?.figuresTextOnly) ? e.counts.figuresTextOnly : null,
        vlmTruncated: Number.isFinite(e.counts?.figuresTruncated) ? e.counts.figuresTruncated : null,
        vlmTimedOut: Number.isFinite(e.counts?.figuresTimedOut) ? e.counts.figuresTimedOut : null,
        vlmFailed: Number.isFinite(e.counts?.figuresFailed) ? e.counts.figuresFailed : null,
        // T29: the caption memo's share and the requests made (null on a pre-T29 record).
        vlmFromMemo: Number.isFinite(e.counts?.figuresFromMemo) ? e.counts.figuresFromMemo : null,
        vlmCalls: Number.isFinite(e.counts?.vlmCalls) ? e.counts.vlmCalls : null,
        // T31: the caption budget's verdict — considered, beyond the budget, the budget, the pages (null on a pre-T31 record).
        figuresConsidered: Number.isFinite(e.counts?.figuresConsidered) ? e.counts.figuresConsidered : null,
        vlmNotAttempted: Number.isFinite(e.counts?.figuresNotAttempted) ? e.counts.figuresNotAttempted : null,
        captionBudget: Number.isInteger(e.captionBudget) ? e.captionBudget : null,
        notAttemptedPages: typeof e.notAttemptedPages === "string" ? e.notAttemptedPages : null,
        captionMemo: typeof e.captionMemo === "string" ? e.captionMemo : null,
        captioning: e.captioning === "on" || e.captioning === "off" ? e.captioning : null,
        // T33 (design D7): the detail passes — planned pages, tiles, requests, recalls, conflicts, failures,
        // the visual pages that did not qualify under auto, the mode and the pages named (null on a pre-T33 record).
        detailPages: Number.isFinite(e.counts?.detailPages) ? e.counts.detailPages : null,
        detailTiles: Number.isFinite(e.counts?.detailTiles) ? e.counts.detailTiles : null,
        detailCalls: Number.isFinite(e.counts?.detailCalls) ? e.counts.detailCalls : null,
        detailFromMemo: Number.isFinite(e.counts?.detailFromMemo) ? e.counts.detailFromMemo : null,
        detailConflicts: Number.isFinite(e.counts?.detailConflicts) ? e.counts.detailConflicts : null,
        // T45 (design §2.3): the votes the tile edge dropped, the conflicts it settled, the same-tile multi-values (null on a pre-T45 record).
        detailEdgeDropped: Number.isFinite(e.counts?.detailEdgeDropped) ? e.counts.detailEdgeDropped : null,
        detailEdgeSettled: Number.isFinite(e.counts?.detailEdgeSettled) ? e.counts.detailEdgeSettled : null,
        detailMultiValued: Number.isFinite(e.counts?.detailMultiValued) ? e.counts.detailMultiValued : null,
        // T57 (design §2.4): the colour check — the labels checked, the readings disclosed, the tile conflicts settled, the
        // pages whose colour layer could not be read (null on a pre-T57 record).
        detailColourChecked: Number.isFinite(e.counts?.detailColourChecked) ? e.counts.detailColourChecked : null,
        detailColourFlagged: Number.isFinite(e.counts?.detailColourFlagged) ? e.counts.detailColourFlagged : null,
        detailColourSettled: Number.isFinite(e.counts?.detailColourSettled) ? e.counts.detailColourSettled : null,
        detailColourAssociated: Number.isFinite(e.counts?.detailColourAssociated) ? e.counts.detailColourAssociated : null,
        detailColourFailed: Number.isFinite(e.counts?.detailColourFailed) ? e.counts.detailColourFailed : null,
        // T47 (design §2.3): the caption labels reconciled with the text layer — the count and the list (null on a pre-T47 record).
        captionSubstitutions: Number.isFinite(e.counts?.captionSubstitutions) ? e.counts.captionSubstitutions : null,
        captionSubstitutionsList: Array.isArray(e.captionSubstitutionsList) ? e.captionSubstitutionsList : null,
        // T46 (design D9, D16): the chain pass — its counts and its named pages / settled lines (null on a pre-T46 record).
        ...Object.fromEntries(CHAIN_COUNT_KEYS.map((k) => [k, Number.isFinite(e.counts?.[k]) ? e.counts[k] : null])),
        chainPagesList: typeof e.chainPagesList === "string" ? e.chainPagesList : null,
        chainFailedPages: typeof e.chainFailedPages === "string" ? e.chainFailedPages : null,
        chainBlockPages: typeof e.chainBlockPages === "string" ? e.chainBlockPages : null,
        chainSettledList: Array.isArray(e.chainSettledList) ? e.chainSettledList : null,
        detailFailed: Number.isFinite(e.counts?.detailFailed) ? e.counts.detailFailed : null,
        detailNotTaken: Number.isFinite(e.counts?.detailNotTaken) ? e.counts.detailNotTaken : null,
        detailEmpty: Number.isFinite(e.counts?.detailEmpty) ? e.counts.detailEmpty : null,
        detailMode: typeof e.detailMode === "string" ? e.detailMode : null,
        detailPagesList: typeof e.detailPagesList === "string" ? e.detailPagesList : null,
        detailReasons: Array.isArray(e.detailReasons) ? e.detailReasons.filter((r) => typeof r === "string") : null,
        detailFailedPages: typeof e.detailFailedPages === "string" ? e.detailFailedPages : null,
        detailEmptyPages: typeof e.detailEmptyPages === "string" ? e.detailEmptyPages : null,
        detailColourFailedPages: typeof e.detailColourFailedPages === "string" ? e.detailColourFailedPages : null,
        // T35 (design D10): the OCR pass — the mode, the pages without a text layer, the pages OCR read / read
        // empty / failed on (named), the characters, the wall time, the engine (null on a pre-T35 record, never 0).
        ocrMode: typeof e.ocrMode === "string" ? e.ocrMode : null,
        ocrNoText: Number.isFinite(e.counts?.ocrNoText) ? e.counts.ocrNoText : null,
        ocrPages: Number.isFinite(e.counts?.ocrPages) ? e.counts.ocrPages : null,
        ocrEmpty: Number.isFinite(e.counts?.ocrEmpty) ? e.counts.ocrEmpty : null,
        ocrFailed: Number.isFinite(e.counts?.ocrFailed) ? e.counts.ocrFailed : null,
        ocrChars: Number.isFinite(e.counts?.ocrChars) ? e.counts.ocrChars : null,
        ocrDurationMs: Number.isFinite(e.ocrDurationMs) ? e.ocrDurationMs : null,
        ocrNoTextPages: typeof e.ocrNoTextPages === "string" ? e.ocrNoTextPages : null,
        ocrPagesList: typeof e.ocrPagesList === "string" ? e.ocrPagesList : null,
        ocrEmptyPages: typeof e.ocrEmptyPages === "string" ? e.ocrEmptyPages : null,
        ocrFailedPages: typeof e.ocrFailedPages === "string" ? e.ocrFailedPages : null,
        ocrEngine: typeof e.ocrEngine === "string" ? e.ocrEngine : null,
        vlmModel: e.vlmModel ?? null,
        parseDurationMs: Number.isFinite(e.parseDurationMs) ? e.parseDurationMs : null,
        vlmDurationMs: Number.isFinite(e.vlmDurationMs) ? e.vlmDurationMs : null,
        recordedAt: e.ts ?? null,
        jobId: e.jobId ?? null,
        observed: "ledger",
      });
    } else if (e.event === "file_unloaded" && e.sourceId) {
      facts.delete(e.sourceId);
    } else if (e.event === "collection_cleared") {
      facts.clear();
    }
  }
  return [...facts.values()];
}

module.exports = {
  EVENT_TYPES,
  FILE_TERMINAL_EVENTS,
  COMPACT_EVENTS,
  COMPACT_BYTES,
  KEEP_JOBS,
  defaultLedgerPath,
  parseLines,
  readEvents,
  getIndex,
  resetIndex,
  appendEvent,
  shouldCompact,
  selectCompacted,
  compact,
  revalidateIndex,
  latestFileOutcome,
  isRecordedComplete,
  isLandedRecord,
  storeOriginOf,
  getCollectionPin,
  jobsFrom,
  summarise,
  recordedParseFacts,
};
