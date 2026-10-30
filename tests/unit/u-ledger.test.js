/**
 * U-LEDGER — ticket T07 (audit FM-L3 / E15 / E16; F-48, F-49, F-52, F-61,
 * F-63, F-64, F-30). The ingestion ledger (src/lib/rag/ledger.js) and the
 * per-file outcomes (src/lib/ingestion/outcomes.js), plus the source pins
 * that keep the routes wired to them.
 *
 * Every case here asks the review question first: what one-line change would
 * make this pass while the behaviour is wrong? A compaction that dropped a
 * document's completion record would still be "idempotent"; a reducer that
 * ignored an unload would still find "complete"; a cancel route that quietly
 * kept finishJob would still answer 200. Each of those is pinned.
 */

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ledger = require("../../src/lib/rag/ledger");
const outcomes = require("../../src/lib/ingestion/outcomes");
const { INGEST_ERROR_CODES, snapshotFromLedgerJob } = require("../../src/lib/ingestion/state");

const {
  EVENT_TYPES,
  defaultLedgerPath,
  readEvents,
  appendEvent,
  getIndex,
  resetIndex,
  shouldCompact,
  selectCompacted,
  compact,
  revalidateIndex,
  latestFileOutcome,
  isRecordedComplete,
  jobsFrom,
  summarise,
  recordedParseFacts,
} = ledger;

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "t07-ledger-"));
  file = path.join(dir, "nested", "ledger.jsonl");
  resetIndex();
});
afterEach(() => {
  resetIndex();
  fs.rmSync(dir, { recursive: true, force: true });
});

const C = "RAGEval_uV2";
const S = "demos/x.pdf";
const V1 = "aaaa.111111111111";
const V2 = "bbbb.222222222222";

/** One job's worth of events for a document, in the route's order. */
function jobEvents(jobId, { sourceId = S, docVersion = V1, n = 5, status = "complete", end = true, fileName = "x.pdf", ts = "2026-09-05T10:00:00.000Z", collection = C } = {}) {
  const base = { jobId, collection, schemaVersion: 2, ts };
  const out = [
    { ...base, event: "ingest_start", files: [sourceId], fileCount: 1, embedModel: "m" },
    { ...base, event: "file_parsed", filePath: sourceId, fileName, sourceId, docVersion, engine: "pypdfium2", engineLabel: "PyPDFium2", paginated: true, counts: { pages: 3, chunksEmitted: n, figuresCaptured: 2, figuresCaptioned: 1 }, parseDurationMs: 120, vlmModel: "qwen3-vl:30b" },
  ];
  if (status === "complete") {
    out.push({ ...base, event: "file_indexed", filePath: sourceId, fileName, sourceId, docVersion, status: "complete", counts: { chunksEmitted: n, chunksInserted: n }, embedModel: "m", embedDim: 4096 });
  } else {
    out.push({ ...base, event: "file_failed", filePath: sourceId, fileName, sourceId, docVersion, status, counts: { chunksEmitted: n, chunksInserted: status === "partial" ? n - 2 : 0 }, error: "boom" });
  }
  if (end) out.push({ ...base, event: "ingest_end", status: status === "complete" ? "completed" : "error" });
  return out;
}

describe("U-LEDGER/T07: append and read", () => {
  test("an event outside the vocabulary or a non-object is refused before anything is written", () => {
    assert.throws(() => appendEvent(file, { event: "file_indexd" }), /unknown event type/);
    assert.throws(() => appendEvent(file, "ingest_start"), /must be an object/);
    assert.throws(() => appendEvent(file, null), /must be an object/);
    assert.throws(() => appendEvent("", { event: "ingest_start" }), /file path is required/);
    assert.ok(!fs.existsSync(file), "nothing was written");
    assert.strictEqual(EVENT_TYPES.length, 10);
  });

  test("append creates the directory, writes one line per event with ts and pid, and read returns them in order", () => {
    const a = appendEvent(file, { event: "ingest_start", jobId: "j1", collection: C });
    const b = appendEvent(file, { event: "ingest_end", jobId: "j1", collection: C, status: "completed", ts: "2026-01-01T00:00:00.000Z" });
    assert.strictEqual(a.pid, process.pid);
    assert.match(a.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.strictEqual(b.ts, "2026-01-01T00:00:00.000Z", "a caller-supplied ts is kept");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    assert.strictEqual(lines.length, 3, "two lines plus the trailing newline");
    assert.strictEqual(lines[2], "");
    const read = readEvents(file);
    assert.strictEqual(read.exists, true);
    assert.strictEqual(read.corruptLines, 0);
    assert.deepStrictEqual(read.events.map((e) => e.event), ["ingest_start", "ingest_end"]);
    assert.strictEqual(read.bytes, Buffer.byteLength(fs.readFileSync(file)));
  });

  test("a torn last line is skipped and counted, and the next append starts a fresh line (never glues onto the fragment)", () => {
    appendEvent(file, { event: "ingest_start", jobId: "j1", collection: C });
    fs.appendFileSync(file, '{"event":"file_indexed","jobId":"j1","coll'); // crash mid-write, no newline
    resetIndex(file);
    const read = readEvents(file);
    assert.strictEqual(read.events.length, 1);
    assert.strictEqual(read.corruptLines, 1);
    appendEvent(file, { event: "ingest_end", jobId: "j1", collection: C, status: "error" });
    const again = readEvents(file);
    assert.deepStrictEqual(again.events.map((e) => e.event), ["ingest_start", "ingest_end"], "the new event is readable after the torn one");
    assert.strictEqual(again.corruptLines, 1, "the fragment stays counted, not merged into the new line");
  });

  test("a missing file reads as empty, exists:false — never a throw", () => {
    assert.deepStrictEqual(readEvents(path.join(dir, "nope.jsonl")), { exists: false, events: [], corruptLines: 0, bytes: 0 });
  });

  test("the in-process index loads once and follows appends (a status frame never reads the file)", () => {
    appendEvent(file, { event: "ingest_start", jobId: "j1", collection: C });
    const index = getIndex(file);
    assert.strictEqual(index.events.length, 1);
    const v = index.version;
    appendEvent(file, { event: "ingest_end", jobId: "j1", collection: C, status: "completed" });
    assert.strictEqual(getIndex(file), index, "same object");
    assert.strictEqual(index.events.length, 2);
    assert.ok(index.version > v, "the version moves on append (the status route memoises on it)");
    // A write behind the module's back (another process on the same PVC
    // file — a rolling update's overlap) is not seen by a plain read of the
    // index, but revalidation and every append notice it (review §6a).
    fs.appendFileSync(file, JSON.stringify({ event: "ingest_start", jobId: "j2", collection: C }) + "\n");
    assert.strictEqual(getIndex(file).events.length, 2, "a plain read does not stat the file");
    assert.strictEqual(revalidateIndex(file), true, "the size changed, so the index reloads");
    assert.strictEqual(getIndex(file).events.length, 3);
    assert.strictEqual(revalidateIndex(file), false, "nothing changed since");
    fs.appendFileSync(file, JSON.stringify({ event: "ingest_end", jobId: "j2", collection: C, status: "completed" }) + "\n");
    appendEvent(file, { event: "ingest_start", jobId: "j3", collection: C });
    assert.deepStrictEqual(getIndex(file).events.map((e) => e.jobId), ["j1", "j1", "j2", "j2", "j3"], "an append first picks up the foreign line, then adds its own");
    assert.strictEqual(readEvents(file).events.length, 5);
    fs.rmSync(file);
    assert.strictEqual(revalidateIndex(file), true, "a removed file reloads to empty");
    assert.strictEqual(getIndex(file).exists, false);
  });

  test("defaultLedgerPath: RAG_LEDGER_PATH wins, otherwise nexcode-data/state/rag/ledger.jsonl under cwd (the chart's app-only mount, D1)", () => {
    const saved = process.env.RAG_LEDGER_PATH;
    try {
      delete process.env.RAG_LEDGER_PATH;
      assert.strictEqual(defaultLedgerPath(), path.join(process.cwd(), "nexcode-data", "state", "rag", "ledger.jsonl"));
      process.env.RAG_LEDGER_PATH = "  /var/lib/nexcode/ledger.jsonl ";
      assert.strictEqual(defaultLedgerPath(), path.resolve("/var/lib/nexcode/ledger.jsonl"));
      process.env.RAG_LEDGER_PATH = "   ";
      assert.strictEqual(defaultLedgerPath(), path.join(process.cwd(), "nexcode-data", "state", "rag", "ledger.jsonl"), "blank is unset");
    } finally {
      if (saved === undefined) delete process.env.RAG_LEDGER_PATH;
      else process.env.RAG_LEDGER_PATH = saved;
    }
  });
});

describe("U-LEDGER/T07: compaction is idempotent and loses no answer", () => {
  function manyJobs(count) {
    const events = [];
    for (let i = 1; i <= count; i++) {
      // every job indexes its own document; job 3's ends PARTIAL (a dropped
      // job's partial record must survive as partial — review §6a)
      events.push(...jobEvents(`j${i}`, { sourceId: `demos/d${i}.pdf`, docVersion: V1, n: i, status: i === 3 ? "partial" : "complete", ts: `2026-09-05T10:${String(i).padStart(2, "0")}:00.000Z` }));
    }
    return events;
  }

  test("compact ∘ compact ≡ compact, and the file is rewritten by rename (no .tmp survives)", () => {
    for (const e of manyJobs(25)) appendEvent(file, e);
    const first = compact(file, { keepJobs: 20 });
    assert.strictEqual(first.before, 100);
    // 20 kept jobs × 4 events + the 5 dropped jobs' latest file_parsed and terminal event each
    assert.strictEqual(first.after, 20 * 4 + 5 * 2);
    const afterFirst = fs.readFileSync(file, "utf8");
    const second = compact(file, { keepJobs: 20 });
    assert.strictEqual(second.before, first.after);
    assert.strictEqual(second.after, first.after, "a second compaction changes nothing");
    assert.strictEqual(fs.readFileSync(file, "utf8"), afterFirst, "byte-identical");
    assert.ok(!fs.existsSync(`${file}.tmp`));
    assert.strictEqual(getIndex(file).events.length, first.after, "the index was reloaded from the compacted file");
  });

  test("every completion answer survives compaction: dropped jobs keep their document's latest terminal record", () => {
    const events = manyJobs(25);
    const before = {};
    for (let i = 1; i <= 25; i++) before[i] = latestFileOutcome(events, { collection: C, sourceId: `demos/d${i}.pdf`, docVersion: V1 });
    const kept = selectCompacted(events, { keepJobs: 20 });
    for (let i = 1; i <= 25; i++) {
      const after = latestFileOutcome(kept, { collection: C, sourceId: `demos/d${i}.pdf`, docVersion: V1 });
      assert.deepStrictEqual(after, before[i], `document ${i}`);
      assert.strictEqual(isRecordedComplete(after), i !== 3, `document ${i} reads ${i === 3 ? "partial" : "complete"} as before`);
    }
    assert.strictEqual(latestFileOutcome(kept, { collection: C, sourceId: "demos/d3.pdf", docVersion: V1 }).status, "partial", "a dropped job's partial record survives as partial (a one-line `file_indexed` filter would lose it)");
    assert.deepStrictEqual(selectCompacted(kept, { keepJobs: 20 }), kept, "selection is a fixed point");
  });

  test("the terminal record is kept per DOCUMENT: a newer version's record replaces an older version's, and the answers about the newer one are unchanged", () => {
    const events = [...jobEvents("j1", { docVersion: V1, ts: "t1" }), ...jobEvents("j2", { docVersion: V2, n: 7, ts: "t2" })];
    const kept = selectCompacted(events, { keepJobs: 1 });
    assert.strictEqual(latestFileOutcome(kept, { collection: C, sourceId: S, docVersion: V1 }), null, "the older version's record is gone (it re-indexes once if the file is ever reverted — a cost, never a wrong skip)");
    assert.deepStrictEqual(latestFileOutcome(kept, { collection: C, sourceId: S, docVersion: V2 }), latestFileOutcome(events, { collection: C, sourceId: S, docVersion: V2 }));
    assert.deepStrictEqual(recordedParseFacts(kept, { collection: C }), recordedParseFacts(events, { collection: C }), "the recorded parse facts are those of the latest parse");
    assert.deepStrictEqual(summarise(kept).lastJob, summarise(events).lastJob);
    assert.deepStrictEqual(selectCompacted(kept, { keepJobs: 1 }), kept);
  });

  test("the invalidating and pinning events survive: latest file_unloaded per document, latest collection_cleared / collection_created per collection", () => {
    const events = [
      { event: "collection_created", collection: C, embedModel: "m", ts: "t0", jobId: "j0" },
      ...jobEvents("j1", { ts: "t1" }),
      { event: "file_unloaded", collection: C, sourceId: S, matches: 5, ts: "t2" },
      ...jobEvents("j2", { ts: "t3" }),
      { event: "collection_cleared", collection: C, dropped: true, ts: "t4" },
      ...jobEvents("j3", { ts: "t5" }),
      { event: "file_unloaded", collection: C, sourceId: S, matches: 5, ts: "t6" },
    ];
    const kept = selectCompacted(events, { keepJobs: 1 });
    const names = kept.map((e) => `${e.event}@${e.ts}`);
    assert.ok(names.includes("collection_created@t0"));
    assert.ok(names.includes("collection_cleared@t4"));
    assert.ok(names.includes("file_unloaded@t6"), "the LATEST unload is kept");
    assert.ok(!names.includes("file_unloaded@t2"), "an older unload is not");
    assert.deepStrictEqual(
      latestFileOutcome(kept, { collection: C, sourceId: S, docVersion: V1 }),
      latestFileOutcome(events, { collection: C, sourceId: S, docVersion: V1 }),
      "the outcome (invalidated by the t6 unload) is unchanged by compaction"
    );
    assert.deepStrictEqual(selectCompacted(kept, { keepJobs: 1 }), kept);
  });

  test("shouldCompact trips on event count or bytes, and the route's thresholds are the module's", () => {
    appendEvent(file, { event: "ingest_start", jobId: "j1", collection: C });
    assert.strictEqual(shouldCompact(file), false);
    assert.strictEqual(shouldCompact(file, { maxEvents: 0 }), true);
    assert.strictEqual(shouldCompact(file, { maxBytes: 1 }), true);
    assert.strictEqual(ledger.COMPACT_EVENTS, 5000);
    assert.strictEqual(ledger.COMPACT_BYTES, 4 * 1024 * 1024);
  });
});

describe("U-LEDGER/T07: latestFileOutcome — what the skip may believe (design D4)", () => {
  test("no record → null; a partial record is not complete; a complete record is", () => {
    assert.strictEqual(latestFileOutcome([], { collection: C, sourceId: S, docVersion: V1 }), null);
    const partial = latestFileOutcome(jobEvents("j1", { status: "partial" }), { collection: C, sourceId: S, docVersion: V1 });
    assert.strictEqual(partial.event, "file_failed");
    assert.strictEqual(partial.status, "partial");
    assert.strictEqual(partial.chunksInserted, 3);
    assert.strictEqual(isRecordedComplete(partial), false);
    const complete = latestFileOutcome(jobEvents("j1"), { collection: C, sourceId: S, docVersion: V1 });
    assert.strictEqual(complete.event, "file_indexed");
    assert.strictEqual(complete.chunksInserted, 5);
    assert.strictEqual(isRecordedComplete(complete), true);
  });

  test("the record is per collection AND per docVersion — another version or class never answers for this one", () => {
    const events = jobEvents("j1");
    assert.strictEqual(latestFileOutcome(events, { collection: C, sourceId: S, docVersion: V2 }), null);
    assert.strictEqual(latestFileOutcome(events, { collection: "OtherV2", sourceId: S, docVersion: V1 }), null);
    assert.strictEqual(latestFileOutcome(events, { collection: C, sourceId: "demos/y.pdf", docVersion: V1 }), null);
  });

  test("a later unload of the document, or a clear of the collection, invalidates the record; a later re-index restores it", () => {
    const events = [
      ...jobEvents("j1"),
      { event: "file_unloaded", collection: C, sourceId: S, matches: 5, ts: "t-unload" },
    ];
    const unloaded = latestFileOutcome(events, { collection: C, sourceId: S, docVersion: V1 });
    assert.strictEqual(unloaded.invalidatedBy, "file_unloaded");
    assert.strictEqual(unloaded.invalidatedAt, "t-unload");
    assert.strictEqual(isRecordedComplete(unloaded), false, "an unloaded document is not skippable");
    const cleared = latestFileOutcome([...jobEvents("j1"), { event: "collection_cleared", collection: C, ts: "t-clear" }], { collection: C, sourceId: S, docVersion: V1 });
    assert.strictEqual(cleared.invalidatedBy, "collection_cleared");
    // an unload of ANOTHER document or a clear of ANOTHER collection does not touch it
    const untouched = latestFileOutcome([...jobEvents("j1"), { event: "file_unloaded", collection: C, sourceId: "demos/other.pdf" }, { event: "collection_cleared", collection: "OtherV2" }], { collection: C, sourceId: S, docVersion: V1 });
    assert.strictEqual(untouched.invalidatedBy, null);
    const restored = latestFileOutcome([...events, ...jobEvents("j2")], { collection: C, sourceId: S, docVersion: V1 });
    assert.strictEqual(restored.invalidatedBy, null);
    assert.strictEqual(restored.jobId, "j2");
    assert.ok(isRecordedComplete(restored));
  });

  test("a record with zero inserted chunks is never 'complete' (a fabricated n would make an empty document skippable forever)", () => {
    const zero = [{ event: "file_indexed", collection: C, sourceId: S, docVersion: V1, status: "complete", counts: { chunksEmitted: 0, chunksInserted: 0 }, jobId: "j" }];
    assert.strictEqual(isRecordedComplete(latestFileOutcome(zero, { collection: C, sourceId: S, docVersion: V1 })), false);
  });
});

describe("U-LEDGER/T07: jobs, interruption and the reconstructed snapshot (design D8)", () => {
  test("an ended job carries its recorded status; a live job without an end is processing; a dead one is interrupted", () => {
    const ended = jobsFrom(jobEvents("j1"), { liveJobIds: [] });
    assert.strictEqual(ended.length, 1);
    assert.strictEqual(ended[0].status, "completed");
    assert.strictEqual(ended[0].chunksInserted, 5);
    assert.strictEqual(ended[0].files[0].status, "indexed");
    const open = jobEvents("j2", { end: false });
    assert.strictEqual(jobsFrom(open, { liveJobIds: ["j2"] })[0].status, "processing");
    const dead = jobsFrom(open, { liveJobIds: [] })[0];
    assert.strictEqual(dead.status, "interrupted");
    assert.strictEqual(dead.files[0].status, "indexed", "a file that finished before the pod died keeps its outcome");
    const parsedOnly = jobsFrom(open.slice(0, 2), { liveJobIds: [] })[0];
    assert.strictEqual(parsedOnly.files[0].status, "interrupted", "a file that never reached a terminal status is interrupted too");
  });

  test("file statuses map from the events: skipped with reason, cancelled, partial, empty, failed", () => {
    const base = { jobId: "j", collection: C };
    const events = [
      { ...base, event: "ingest_start", files: ["a", "b", "c", "d", "e"] },
      { ...base, event: "file_skipped", filePath: "a", reason: "not_allowed_type" },
      { ...base, event: "file_skipped", filePath: "b", reason: "cancelled" },
      { ...base, event: "file_failed", filePath: "c", status: "partial", counts: { chunksEmitted: 10, chunksInserted: 4 } },
      { ...base, event: "file_failed", filePath: "d", status: "empty", counts: { chunksEmitted: 0, chunksInserted: 0 } },
      { ...base, event: "file_failed", filePath: "e", status: "failed", error: "x" },
      { ...base, event: "ingest_end", status: "partial", errorCode: "INGEST_PARTIAL" },
    ];
    const [job] = jobsFrom(events);
    const by = Object.fromEntries(job.files.map((f) => [f.filePath, f]));
    assert.strictEqual(by.a.status, "skipped");
    assert.strictEqual(by.a.reason, "not_allowed_type");
    assert.strictEqual(by.b.status, "cancelled");
    assert.strictEqual(by.c.status, "partial");
    assert.strictEqual(by.d.status, "empty");
    assert.strictEqual(by.e.status, "failed");
    assert.strictEqual(job.chunksInserted, 4);
    assert.strictEqual(job.errorCode, "INGEST_PARTIAL");
  });

  test("snapshotFromLedgerJob (state.js owns the frame shape) is marked reconstructed, and an interrupted job is terminal (never 'processing')", () => {
    const [dead] = jobsFrom(jobEvents("j2", { end: false }), { liveJobIds: [] });
    const snap = snapshotFromLedgerJob(dead);
    assert.strictEqual(snap.reconstructed, true);
    assert.strictEqual(snap.status, "interrupted");
    assert.strictEqual(snap.jobId, "j2");
    assert.strictEqual(snap.chunksIndexed, 5);
    assert.strictEqual(snap.totalFiles, 1);
    assert.strictEqual(snap.filesCompleted, 1);
    assert.deepStrictEqual(snap.doclingTraces, []);
    assert.strictEqual(snap.cancelled, false);
    for (const key of ["status", "currentFile", "progressPercent", "chunksIndexed", "totalFiles", "filesCompleted", "error", "errorCode", "startedAt", "finishedAt", "fileResults", "ledgerError"]) {
      assert.ok(key in snap, key);
    }
    assert.ok(!("snapshotFromJob" in ledger), "the ledger module knows nothing of the SSE frame shape (modularity)");
  });

  test("totalFiles comes from fileCount, never from a (bounded) files list", () => {
    const events = [{ event: "ingest_start", jobId: "j", collection: C, files: ["a", "b"], fileCount: 5 }, { event: "ingest_end", jobId: "j", collection: C, status: "partial" }];
    assert.strictEqual(jobsFrom(events)[0].totalFiles, 5);
    assert.strictEqual(snapshotFromLedgerJob(jobsFrom(events)[0]).totalFiles, 5);
    assert.strictEqual(jobsFrom([{ event: "ingest_start", jobId: "k", collection: C, files: ["a"] }])[0].totalFiles, 1, "an old record without fileCount falls back to the list");
  });

  test("summarise counts jobs and interruptions and names the last job", () => {
    const events = [...jobEvents("j1", { ts: "t1" }), ...jobEvents("j2", { end: false, ts: "t2" })];
    const s = summarise(events, { liveJobIds: [] });
    assert.strictEqual(s.events, events.length);
    assert.strictEqual(s.jobs, 2);
    assert.strictEqual(s.interrupted, 1);
    assert.strictEqual(s.lastJob.jobId, "j2");
    assert.strictEqual(s.lastJob.status, "interrupted");
    assert.deepStrictEqual(summarise([]).lastJob, null);
  });
});

describe("U-LEDGER/T07: recorded parse facts for the parser span (F-30, design D10)", () => {
  test("the latest file_parsed per document, dropped by a later unload or clear, scoped to the collection", () => {
    const events = [
      ...jobEvents("j1", { ts: "t1" }),
      ...jobEvents("j2", { sourceId: "demos/y.pdf", fileName: "y.pdf", ts: "t2" }),
      ...jobEvents("j3", { ts: "t3", n: 9 }),
      { event: "file_unloaded", collection: C, sourceId: "demos/y.pdf", ts: "t4" },
      ...jobEvents("j4", { collection: "OtherV2", sourceId: "demos/z.pdf", fileName: "z.pdf", ts: "t5" }),
    ];
    const facts = recordedParseFacts(events, { collection: C });
    assert.deepStrictEqual(facts.map((f) => f.fileName), ["x.pdf"], "y was unloaded, z is another collection");
    const x = facts[0];
    assert.strictEqual(x.engineId, "pypdfium2");
    assert.strictEqual(x.engine, "PyPDFium2");
    assert.strictEqual(x.paginated, true);
    assert.strictEqual(x.pageCount, 3);
    assert.strictEqual(x.chunkCount, 9, "the latest parse wins");
    assert.strictEqual(x.parseDurationMs, 120);
    assert.strictEqual(x.observed, "ledger");
    assert.strictEqual(x.jobId, "j3");
    assert.deepStrictEqual(recordedParseFacts([...events, { event: "collection_cleared", collection: C }], { collection: C }), [], "a clear drops every fact");
  });

  test("a parse whose chunks never landed does not replace the fact of the version that serves; a partial's does (review §6a)", () => {
    const base = [...jobEvents("j1", { ts: "t1" })]; // x.pdf, version V1, pypdfium2, complete
    const failedParse = [
      { event: "ingest_start", jobId: "j2", collection: C, files: [S], fileCount: 1 },
      { event: "file_parsed", jobId: "j2", collection: C, filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V2, engine: "docling", engineLabel: "Docling", paginated: false, counts: { pages: 1, chunksEmitted: 40 } },
      { event: "file_failed", jobId: "j2", collection: C, filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V2, status: "failed", counts: { chunksEmitted: 40, chunksInserted: 0 } },
      { event: "ingest_end", jobId: "j2", collection: C, status: "error" },
    ];
    const facts = recordedParseFacts([...base, ...failedParse], { collection: C });
    assert.strictEqual(facts.length, 1);
    assert.strictEqual(facts[0].engineId, "pypdfium2", "the serving version's engine, not the failed parse's");
    assert.strictEqual(facts[0].paginated, true);
    assert.strictEqual(facts[0].docVersion, V1);
    const partialParse = failedParse.map((e) => (e.event === "file_failed" ? { ...e, status: "partial", counts: { chunksEmitted: 40, chunksInserted: 16 } } : e));
    const withPartial = recordedParseFacts([...base, ...partialParse], { collection: C });
    assert.strictEqual(withPartial[0].engineId, "docling", "a partial's chunks are in the store, so its parse facts stand");
    assert.strictEqual(recordedParseFacts(failedParse, { collection: C }).length, 0, "a parse with nothing landed is no fact at all");
    assert.strictEqual(recordedParseFacts(failedParse.slice(0, 2), { collection: C }).length, 0, "a pending parse (no terminal event yet) is not a fact either");
  });
});

describe("U-LEDGER/T24: the caption outcomes are recorded and read back; a caption loss is a partial file (design D4, D9)", () => {
  test("recordedParseFacts carries figuresDecorative / TimedOut / Failed and the captioning mode; a pre-T24 record reads null, never 0", () => {
    const base = { jobId: "j", collection: C, schemaVersion: 2, ts: "2026-09-11T10:00:00.000Z" };
    const events = [
      { ...base, event: "file_parsed", filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V1, engine: "pypdfium2", counts: { pages: 7, chunksEmitted: 18, figuresCaptured: 7, figuresCaptioned: 5, figuresDecorative: 1, figuresTimedOut: 1, figuresFailed: 0 }, captioning: "on", captionReset: true, vlmModel: "qwen3-vl:30b" },
      { ...base, event: "file_failed", filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V1, status: "partial", reason: "captions_incomplete", counts: { chunksEmitted: 18, chunksInserted: 18 } },
      { ...base, event: "file_parsed", filePath: "demos/old.pdf", fileName: "old.pdf", sourceId: "demos/old.pdf", docVersion: V2, engine: "pypdfium2", counts: { pages: 2, chunksEmitted: 3, figuresCaptured: 2, figuresCaptioned: 1 }, vlmModel: "qwen3-vl:30b" },
      { ...base, event: "file_indexed", filePath: "demos/old.pdf", fileName: "old.pdf", sourceId: "demos/old.pdf", docVersion: V2, status: "complete", counts: { chunksEmitted: 3, chunksInserted: 3 } },
    ];
    const facts = recordedParseFacts(events, { collection: C });
    const x = facts.find((f) => f.fileName === "x.pdf");
    assert.deepStrictEqual({ d: x.vlmDecorative, t: x.vlmTimedOut, f: x.vlmFailed, c: x.captioning, cap: x.vlmCaptionsGenerated, pics: x.picturesCaptured }, { d: 1, t: 1, f: 0, c: "on", cap: 5, pics: 7 }, "a partial (captions_incomplete) parse is still a landed fact — its chunks serve");
    const old = facts.find((f) => f.fileName === "old.pdf");
    assert.deepStrictEqual({ d: old.vlmDecorative, t: old.vlmTimedOut, f: old.vlmFailed, c: old.captioning }, { d: null, t: null, f: null, c: null }, "a pre-T24 record has no outcome counts: null, never 0");
    // T29: a record without the memo counts reads null (never 0) for them too.
    assert.deepStrictEqual({ m: x.vlmFromMemo, calls: x.vlmCalls, memo: x.captionMemo }, { m: null, calls: null, memo: null });
  });

  test("T29: recordedParseFacts carries figuresFromMemo / vlmCalls and the memo's state; the route records them on file_parsed and every terminal record (source pin)", () => {
    const base = { jobId: "j", collection: C, schemaVersion: 2, ts: "2026-09-11T20:00:00.000Z" };
    const events = [
      { ...base, event: "file_parsed", filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V1, engine: "pypdfium2", counts: { pages: 7, chunksEmitted: 18, figuresCaptured: 7, figuresCaptioned: 7, figuresDecorative: 0, figuresTimedOut: 0, figuresFailed: 0, figuresFromMemo: 7, figuresMemoised: 0, vlmCalls: 0 }, captioning: "on", captionReset: null, captionMemo: "all", vlmModelDigest: "eda0be10", vlmServer: "http://o:11434", vlmModel: "qwen3-vl:30b" },
      { ...base, event: "file_indexed", filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V1, status: "complete", counts: { chunksEmitted: 18, chunksInserted: 18, figuresFromMemo: 7, vlmCalls: 0 } },
    ];
    const x = recordedParseFacts(events, { collection: C })[0];
    assert.deepStrictEqual({ m: x.vlmFromMemo, calls: x.vlmCalls, memo: x.captionMemo, cap: x.vlmCaptionsGenerated }, { m: 7, calls: 0, memo: "all", cap: 7 });
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "ingest", "route.js"), "utf-8");
    assert.match(src, /fr\.counts\.figuresFromMemo = fig\("vlmFromMemo"\);\s*fr\.counts\.vlmCalls = fig\("vlmCalls"\);/, "the file result carries the memo counts");
    assert.match(src, /figuresFromMemo: fig\("vlmFromMemo"\),\s*figuresMemoised: fig\("vlmMemoised"\),\s*vlmCalls: fig\("vlmCalls"\),/, "file_parsed records them");
    assert.match(src, /captionMemo: typeof trace\?\.captionMemo === "string" \? trace\.captionMemo : null,/, "file_parsed records the memo's state");
    // T33 (design D7): the same block gained the detail passes' seven counts after T31's two.
    assert.match(src, /figuresFailed: fr\.counts\.figuresFailed,\s*figuresFromMemo: fr\.counts\.figuresFromMemo,\s*vlmCalls: fr\.counts\.vlmCalls,\s*(?:\/\/[^\n]*\s*)?figuresConsidered: fr\.counts\.figuresConsidered,\s*figuresNotAttempted: fr\.counts\.figuresNotAttempted,\s*(?:\/\/[^\n]*\s*)?(?:detail\w+: fr\.counts\.detail\w+,\s*)*(?:captionSubstitutions: fr\.counts\.captionSubstitutions,\s*)?(?:\/\/[^\n]*\s*)?(?:\.\.\.Object\.fromEntries\(CHAIN_COUNT_KEYS\.map\(\(k\) => \[k, fr\.counts\[k\]\]\)\),\s*)?(?:\/\/[^\n]*\s*)?(?:ocr\w+: fr\.counts\.ocr\w+,\s*)*\};/, "every terminal record carries them (a ledger-rebuilt frame has them) — and T31's two counts (and T33's seven)");
  });

  test("T31: recordedParseFacts carries figuresConsidered / vlmNotAttempted / captionBudget / notAttemptedPages; a pre-T31 record reads null, never 0; the route records them on file_parsed and every terminal record (source pin)", () => {
    const base = { jobId: "j", collection: C, schemaVersion: 2, ts: "2026-09-13T20:00:00.000Z" };
    const events = [
      { ...base, event: "file_parsed", filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V1, engine: "pypdfium2", counts: { pages: 84, chunksEmitted: 228, figuresCaptured: 84, figuresCaptioned: 36, figuresDecorative: 14, figuresTimedOut: 0, figuresFailed: 0, figuresFromMemo: 36, figuresMemoised: 14, vlmCalls: 14, figuresConsidered: 50, figuresNotAttempted: 34 }, captioning: "on", captionBudget: 50, notAttemptedPages: "51–84", captionMemo: "partial", vlmModel: "qwen3-vl:30b" },
      { ...base, event: "file_indexed", filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V1, status: "complete", counts: { chunksEmitted: 228, chunksInserted: 228, figuresConsidered: 50, figuresNotAttempted: 34 } },
      { ...base, event: "file_parsed", filePath: "demos/old.pdf", fileName: "old.pdf", sourceId: "demos/old.pdf", docVersion: V2, engine: "pypdfium2", counts: { pages: 7, chunksEmitted: 26, figuresCaptured: 7, figuresCaptioned: 7 }, captioning: "on", vlmModel: "qwen3-vl:30b" },
      { ...base, event: "file_indexed", filePath: "demos/old.pdf", fileName: "old.pdf", sourceId: "demos/old.pdf", docVersion: V2, status: "complete", counts: { chunksEmitted: 26, chunksInserted: 26 } },
    ];
    const facts = recordedParseFacts(events, { collection: C });
    const x = facts.find((f) => f.fileName === "x.pdf");
    const old = facts.find((f) => f.fileName === "old.pdf");
    assert.deepStrictEqual({ c: x.figuresConsidered, n: x.vlmNotAttempted, b: x.captionBudget, p: x.notAttemptedPages }, { c: 50, n: 34, b: 50, p: "51–84" });
    assert.deepStrictEqual({ c: old.figuresConsidered, n: old.vlmNotAttempted, b: old.captionBudget, p: old.notAttemptedPages }, { c: null, n: null, b: null, p: null }, "a pre-T31 record has no budget verdict: null, never 0");
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "ingest", "route.js"), "utf-8");
    assert.match(src, /fr\.counts\.figuresConsidered = fig\("figuresConsidered"\);\s*fr\.counts\.figuresNotAttempted = fig\("vlmNotAttempted"\);\s*fr\.captionBudget = Number\.isInteger\(trace\?\.captionBudget\) \? trace\.captionBudget : null;\s*fr\.notAttemptedPages = typeof trace\?\.notAttemptedPages === "string" \? trace\.notAttemptedPages : null;/, "the file result (the status frame) carries the count, the budget and the pages");
    // T33 (design D7): file_parsed's counts gained the detail passes' counts after T31's two.
    assert.match(src, /figuresConsidered: fig\("figuresConsidered"\),\s*figuresNotAttempted: fig\("vlmNotAttempted"\),\s*(?:\/\/[^\n]*\s*)?(?:detail\w+: fig\("detail\w+"\),\s*)*(?:\/\/[^\n]*\s*)?(?:captionSubstitutions: fig\("captionSubstitutions"\),\s*)?(?:\/\/[^\n]*\s*)?(?:\.\.\.Object\.fromEntries\(CHAIN_COUNT_KEYS\.map\(\(k\) => \[k, fig\(k\)\]\)\),\s*)?(?:\/\/[^\n]*\s*)?(?:ocr\w+: fig\("ocr\w+"\),\s*)*\},/, "file_parsed's counts record them (then T33's detail counts, T47's caption substitutions, then T35's OCR counts)");
    assert.match(src, /captionBudget: fr\.captionBudget,\s*notAttemptedPages: fr\.notAttemptedPages,/, "file_parsed records the budget and the pages");
    assert.match(src, /const captionLoss = \(fr\.counts\.figuresTimedOut \|\| 0\) \+ \(fr\.counts\.figuresFailed \|\| 0\);/, "a page beyond the budget is never a partial file (D5): the loss rule reads only timeouts and failures");
  });

  test("T32 (design D9): recordedParseFacts carries vlmTextOnly; a pre-T32 record reads null, never 0; the route records figuresTextOnly (and figuresDecorative) on the file result, file_parsed and every terminal record, and the prompt variants on file_parsed (source pin)", () => {
    const base = { jobId: "j", collection: C, schemaVersion: 2, ts: "2026-09-14T20:00:00.000Z" };
    const events = [
      { ...base, event: "file_parsed", filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V1, engine: "pypdfium2", counts: { pages: 84, chunksEmitted: 220, figuresCaptured: 84, figuresCaptioned: 40, figuresDecorative: 17, figuresTextOnly: 24, figuresTruncated: 3, figuresTimedOut: 0, figuresFailed: 0, figuresFromMemo: 0, figuresMemoised: 84, vlmCalls: 84, figuresConsidered: 84, figuresNotAttempted: 0 }, captioning: "on", captionBudget: 0, captionMemo: "none", captionPrompts: { withText: "af0ec7ef", noText: "a40a2b64" }, vlmModel: "qwen3-vl:30b" },
      { ...base, event: "file_indexed", filePath: S, fileName: "x.pdf", sourceId: S, docVersion: V1, status: "complete", counts: { chunksEmitted: 220, chunksInserted: 220, figuresDecorative: 17, figuresTextOnly: 24 } },
      { ...base, event: "file_parsed", filePath: "demos/old.pdf", fileName: "old.pdf", sourceId: "demos/old.pdf", docVersion: V2, engine: "pypdfium2", counts: { pages: 7, chunksEmitted: 26, figuresCaptured: 7, figuresCaptioned: 7, figuresDecorative: 0, figuresTruncated: 0 }, captioning: "on", vlmModel: "qwen3-vl:30b" },
      { ...base, event: "file_indexed", filePath: "demos/old.pdf", fileName: "old.pdf", sourceId: "demos/old.pdf", docVersion: V2, status: "complete", counts: { chunksEmitted: 26, chunksInserted: 26 } },
    ];
    const facts = recordedParseFacts(events, { collection: C });
    const x = facts.find((f) => f.fileName === "x.pdf");
    const old = facts.find((f) => f.fileName === "old.pdf");
    assert.deepStrictEqual({ t: x.vlmTextOnly, d: x.vlmDecorative, tr: x.vlmTruncated, cap: x.vlmCaptionsGenerated }, { t: 24, d: 17, tr: 3, cap: 40 });
    assert.strictEqual(x.vlmCaptionsGenerated + x.vlmDecorative + x.vlmTextOnly + x.vlmTruncated, x.figuresConsidered, "the verdicts add up to the pages considered");
    assert.strictEqual(old.vlmTextOnly, null, "a pre-T32 record has no text-only count: null, never 0");
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "ingest", "route.js"), "utf-8");
    assert.match(src, /fr\.counts\.figuresDecorative = fig\("vlmDecorative"\);\s*fr\.counts\.figuresTextOnly = fig\("vlmTextOnly"\);/, "the file result (the status frame) carries both verdict counts");
    assert.match(src, /figuresDecorative: fig\("vlmDecorative"\),\s*(?:\/\/[^\n]*\s*)?figuresTextOnly: fig\("vlmTextOnly"\),\s*figuresTruncated: fig\("vlmTruncated"\),/, "file_parsed's counts record the text-only verdicts");
    assert.match(src, /captionPrompts: trace\?\.captionPrompts && typeof trace\.captionPrompts === "object" \? \{ \.\.\.trace\.captionPrompts \} : null,/, "file_parsed names the prompt variants that wrote the captions");
    assert.match(src, /figuresCaptioned: fr\.counts\.figuresCaptioned,\s*(?:\/\/[^\n]*\s*)?figuresDecorative: fr\.counts\.figuresDecorative,\s*figuresTextOnly: fr\.counts\.figuresTextOnly,\s*figuresTimedOut: fr\.counts\.figuresTimedOut,/, "every terminal record carries them (a ledger-rebuilt frame has them)");
    const ledgerSrc = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "rag", "ledger.js"), "utf-8");
    assert.match(ledgerSrc, /vlmTextOnly: Number\.isFinite\(e\.counts\?\.figuresTextOnly\) \? e\.counts\.figuresTextOnly : null,/);
  });

  test("newFileResult carries the figure counts (null until the parse said; T29 adds figuresFromMemo and vlmCalls; T31 figuresConsidered / figuresNotAttempted, the budget and the pages; T32 figuresDecorative / figuresTextOnly); PARTIAL_REASONS names captions_incomplete", () => {
    const fr = outcomes.newFileResult({ filePath: S, fileName: "x.pdf" });
    // T29: the caption memo's share and the server requests made join the four figure counts.
    // T31: the pages considered and the pages beyond the budget; the budget and the page range beside the counts.
    // T32: the decorative and text-only verdicts, so the views' suffix can name them.
    assert.deepStrictEqual(fr.counts, { chunksEmitted: null, chunksInserted: 0, chunksDroppedMinSize: null, chunksMergedMinSize: null, slidesHidden: null, figuresCaptured: null, figuresCaptioned: null, figuresTimedOut: null, figuresFailed: null, figuresFromMemo: null, vlmCalls: null, figuresConsidered: null, figuresNotAttempted: null, figuresDecorative: null, figuresTextOnly: null, detailPages: null, detailTiles: null, detailCalls: null, detailFromMemo: null, detailConflicts: null, detailEdgeDropped: null, detailEdgeSettled: null, detailMultiValued: null, detailColourChecked: null, detailColourFlagged: null, detailColourSettled: null, detailColourAssociated: null, detailColourFailed: null, detailFailed: null, detailNotTaken: null, detailEmpty: null, captionSubstitutions: null, chainPages: null, chainNoDimensions: null, chainCalls: null, chainFromMemo: null, chainFailed: null, chainLines: null, chainUnclear: null, chainPointsDerived: null, chainPointsNotDerivable: null, chainClosureOk: null, chainClosureFailed: null, chainConfirmed: null, chainSettled: null, chainGeometryFailed: null, chainBlocks: null, chainMemoised: null, ocrNoText: null, ocrPages: null, ocrEmpty: null, ocrFailed: null, ocrChars: null, pageArtifactLines: null, pageArtifactKeys: null, pageArtifactPages: null, pageArtifactKeptFirst: null, pageArtifactPagesWithoutText: null });
    assert.deepStrictEqual({ b: fr.captionBudget, p: fr.notAttemptedPages }, { b: null, p: null });
    // T33 (design D7): the detail passes' seven counts (null until the parse said) and the mode, the pages, the reasons and the failed pages beside them.
    assert.deepStrictEqual({ m: fr.detailMode, l: fr.detailPagesList, r: fr.detailReasons, f: fr.detailFailedPages }, { m: null, l: null, r: null, f: null });
    // T35 (design D10): the OCR pass's five counts (null until the parse said) and the mode, the pages, the engine, the wall time beside them.
    assert.deepStrictEqual({ m: fr.ocrMode, n: fr.ocrNoTextPages, p: fr.ocrPagesList, e: fr.ocrEmptyPages, f: fr.ocrFailedPages, g: fr.ocrEngine, d: fr.ocrDurationMs }, { m: null, n: null, p: null, e: null, f: null, g: null, d: null });
    assert.strictEqual(outcomes.PARTIAL_REASONS.CAPTIONS_INCOMPLETE, "captions_incomplete");
    assert.ok(Object.isFrozen(outcomes.PARTIAL_REASONS));
  });

  test("a captions_incomplete file makes the job partial, and the job's error names the loss", () => {
    const f = (status, over = {}) => ({ ...outcomes.newFileResult({ filePath: S, fileName: "x.pdf" }), status, ...over });
    const partial = f("partial", { reason: "captions_incomplete", error: "1 of 7 figure(s) not captioned (1 timed out, 0 failed)", counts: { chunksEmitted: 18, chunksInserted: 18, chunksDroppedMinSize: 0, figuresCaptured: 7, figuresCaptioned: 5, figuresTimedOut: 1, figuresFailed: 0 } });
    const list = [f("indexed", { fileName: "a.pdf", counts: { chunksEmitted: 3, chunksInserted: 3 } }), partial];
    assert.strictEqual(outcomes.jobStatusFrom(list), "partial");
    const msg = outcomes.jobErrorFrom(list, "partial");
    assert.match(msg, /^1 of 2 file\(s\) indexed or skipped; x\.pdf partial \(18\/18 chunks; 1 of 7 figure\(s\) not captioned\): captions_incomplete \(1 of 7 figure\(s\) not captioned \(1 timed out, 0 failed\)\)/);
    const plainPartial = f("partial", { reason: "insert stopped at 2/5 chunks", counts: { chunksEmitted: 5, chunksInserted: 2 } });
    assert.match(outcomes.jobErrorFrom([plainPartial], "partial"), /x\.pdf partial \(2\/5 chunks\): insert stopped/, "the pre-T24 wording for an insert failure is unchanged");
  });

  test("the ingest route (source pin): the figure counts reach the file result and the ledger, and a caption loss ends the file partial with captions_incomplete before it can be indexed", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "ingest", "route.js"), "utf-8");
    assert.match(src, /fr\.counts\.figuresCaptured = fig\("picturesCaptured"\)/);
    assert.match(src, /fr\.counts\.figuresTimedOut = fig\("vlmTimedOut"\)/);
    // T32 slots `figuresTextOnly` (with its comment) between the decorative and truncated counts.
    assert.match(src, /figuresDecorative: fig\("vlmDecorative"\),\s*(?:\/\/[^\n]*\s*)?(?:figuresTextOnly: fig\("vlmTextOnly"\),\s*)?figuresTruncated: fig\("vlmTruncated"\),\s*figuresTimedOut: fig\("vlmTimedOut"\),\s*figuresFailed: fig\("vlmFailed"\),/, "file_parsed records the outcomes (A9: truncated too)");
    assert.match(src, /captioning: trace\?\.captioning === "off" \? "off" : trace\?\.captioning === "on" \? "on" : null/);
    const rule = src.slice(src.indexOf("const captionLoss = (fr.counts.figuresTimedOut || 0) + (fr.counts.figuresFailed || 0);"), src.indexOf('fr.status = "indexed";'));
    assert.ok(rule.length > 0, "the rule sits before the indexed outcome");
    assert.match(rule, /fr\.status = "partial";\s*fr\.reason = PARTIAL_REASONS\.CAPTIONS_INCOMPLETE;/);
    assert.match(rule, /record\(\{ event: "file_failed", \.\.\.identity, status: "partial", reason: fr\.reason/, "recorded as a partial outcome — T07 re-attempts it");
    assert.match(rule, /completeFile\(\);\s*continue;/);
  });
});

describe("U-LEDGER/T07: per-file outcomes → job status (design D5, D6)", () => {
  const f = (status, extra = {}) => ({ ...outcomes.newFileResult({ filePath: `p/${status}`, fileName: `${status}.pdf` }), status, ...extra });

  test("newFileResult starts pending with the counts block and no verdict", () => {
    const r = outcomes.newFileResult({ filePath: "demos/a.pdf", fileName: "a.pdf" });
    assert.strictEqual(r.status, "pending");
    // T24 (design D9): the four figure counts travel with the file, null until the parse said.
    // T29: the memo's share and the calls; T31: the pages considered and the pages beyond the budget; T33: the detail passes.
    assert.deepStrictEqual(r.counts, { chunksEmitted: null, chunksInserted: 0, chunksDroppedMinSize: null, chunksMergedMinSize: null, slidesHidden: null, figuresCaptured: null, figuresCaptioned: null, figuresTimedOut: null, figuresFailed: null, figuresFromMemo: null, vlmCalls: null, figuresConsidered: null, figuresNotAttempted: null, figuresDecorative: null, figuresTextOnly: null, detailPages: null, detailTiles: null, detailCalls: null, detailFromMemo: null, detailConflicts: null, detailEdgeDropped: null, detailEdgeSettled: null, detailMultiValued: null, detailColourChecked: null, detailColourFlagged: null, detailColourSettled: null, detailColourAssociated: null, detailColourFailed: null, detailFailed: null, detailNotTaken: null, detailEmpty: null, captionSubstitutions: null, chainPages: null, chainNoDimensions: null, chainCalls: null, chainFromMemo: null, chainFailed: null, chainLines: null, chainUnclear: null, chainPointsDerived: null, chainPointsNotDerivable: null, chainClosureOk: null, chainClosureFailed: null, chainConfirmed: null, chainSettled: null, chainGeometryFailed: null, chainBlocks: null, chainMemoised: null, ocrNoText: null, ocrPages: null, ocrEmpty: null, ocrFailed: null, ocrChars: null, pageArtifactLines: null, pageArtifactKeys: null, pageArtifactPages: null, pageArtifactKeptFirst: null, pageArtifactPagesWithoutText: null });
    assert.strictEqual(r.supersedeError, null);
    assert.strictEqual(r.reindexReason, null);
    assert.ok(outcomes.FILE_STATUSES.includes("parsed"));
    for (const s of outcomes.TERMINAL_FILE_STATUSES) assert.ok(outcomes.isTerminalFileStatus(s), s);
    for (const s of ["pending", "parsing", "parsed", "indexing"]) assert.ok(!outcomes.isTerminalFileStatus(s), s);
  });

  test("the truth table", () => {
    const st = outcomes.jobStatusFrom;
    assert.strictEqual(st([f("indexed"), f("skipped")]), "completed");
    assert.strictEqual(st([f("indexed"), f("partial")]), "partial");
    assert.strictEqual(st([f("indexed"), f("failed")]), "partial");
    assert.strictEqual(st([f("indexed"), f("empty")]), "partial", "a document that parsed to nothing is not searchable");
    assert.strictEqual(st([f("skipped"), f("failed")]), "partial", "a skip is usable; something else failed");
    assert.strictEqual(st([f("failed")]), "error", "nothing landed");
    assert.strictEqual(st([f("partial")]), "partial", "a lone partial file's chunks are serving — the ticket's partial, not an error");
    assert.strictEqual(st([f("failed"), f("partial")]), "partial");
    assert.strictEqual(st([f("failed"), f("failed")]), "error", "I-VERSION's dead-port step: nothing landed → error");
    assert.strictEqual(st([f("empty")]), "partial", "an empty parse is not an error of the pipeline");
    assert.strictEqual(st([f("indexed", { supersedeError: "old versions remain" })]), "partial", "a refused supersede is disclosed as partial (T06 D3 → T07 D6)");
    assert.strictEqual(st([f("indexed"), f("indexing")]), "partial", "a file left non-terminal can never read as completed");
    assert.strictEqual(st([f("indexed")], { cancelled: true }), "cancelled", "the worker observed a cancel");
    assert.strictEqual(st([f("indexed")], { jobError: new Error("x") }), "error");
    assert.strictEqual(st([f("indexed")], { cancelled: true, jobError: new Error("x") }), "cancelled", "a throw after a cancel does not overwrite it (F-52)");
    assert.strictEqual(st([f("skipped"), f("skipped")]), "completed", "an all-skipped batch is complete (every input accounted for)");
    assert.strictEqual(st([f("empty"), f("empty")]), "partial", "an all-empty batch indexed nothing but failed nothing");
    assert.strictEqual(st([f("failed"), f("skipped", { reason: outcomes.SKIP_REASONS.NOT_ATTEMPTED }), f("skipped", { reason: outcomes.SKIP_REASONS.NOT_ATTEMPTED })]), "error", "a dead embedder on a batch: nothing landed, the rest were not attempted — an error, not '2 of 3 skipped' (review §6a)");
    assert.strictEqual(st([f("indexed"), f("failed"), f("skipped", { reason: outcomes.SKIP_REASONS.NOT_ATTEMPTED })]), "partial", "one landed before the embedder died");
    assert.strictEqual(outcomes.isUsable(f("skipped", { reason: outcomes.SKIP_REASONS.NOT_ATTEMPTED })), false);
    assert.strictEqual(outcomes.isUsable(f("skipped", { reason: outcomes.SKIP_REASONS.ALREADY_INDEXED })), true);
    assert.strictEqual(outcomes.isUsable(f("skipped", { reason: outcomes.SKIP_REASONS.NOT_ALLOWED_TYPE })), true, "a disallowed type was never going to be in the store; the batch is complete without it");
    assert.strictEqual(st([]), "completed", "unreachable through the route (an empty batch is a 400) — pinned so a change is deliberate");
    assert.strictEqual(outcomes.SKIP_REASONS.NOT_ATTEMPTED, "not_attempted_after_failure");
  });

  test("error text names the failing file and keeps its message; partial text accounts for every non-indexed file; codes match the taxonomy", () => {
    const failed = f("failed", { fileName: "report.pdf", error: "Embedding API failure: dead port" });
    assert.strictEqual(outcomes.jobErrorFrom([failed], "error"), "report.pdf: Embedding API failure: dead port");
    const partialText = outcomes.jobErrorFrom([f("indexed", { fileName: "a.pdf" }), f("partial", { fileName: "b.pdf", counts: { chunksEmitted: 89, chunksInserted: 32 }, reason: "cancelled at 32/89 chunks" }), f("skipped", { fileName: "c.xyz", reason: "not_allowed_type" }), f("empty", { fileName: "d.pdf", reason: "parsed to 0 chunks" })], "partial");
    assert.match(partialText, /^2 of 4 file\(s\) indexed or skipped; /, "a skipped file is in the store too (already indexed)");
    assert.match(partialText, /b\.pdf partial \(32\/89 chunks\): cancelled at 32\/89 chunks/);
    const withError = outcomes.jobErrorFrom([f("indexed", { fileName: "a.pdf" }), f("partial", { fileName: "b.pdf", counts: { chunksEmitted: 18, chunksInserted: 16 }, reason: "insert stopped at 16/18 chunks", error: "Embedding API failure: outage" })], "partial");
    assert.match(withError, /b\.pdf partial \(16\/18 chunks\): insert stopped at 16\/18 chunks \(Embedding API failure: outage\)/, "the embedder's words survive beside the reason");
    assert.match(partialText, /d\.pdf empty: parsed to 0 chunks/);
    assert.ok(!/c\.xyz/.test(partialText), "a skip is not a problem");
    const notAttempted = outcomes.jobErrorFrom([f("indexed", { fileName: "a.pdf" }), f("failed", { fileName: "b.pdf", error: "Embedding API failure: down" }), f("skipped", { fileName: "c.pdf", reason: outcomes.SKIP_REASONS.NOT_ATTEMPTED, error: "not attempted: an earlier file's embed or insert failed in this job" })], "partial");
    assert.match(notAttempted, /^1 of 3 file\(s\) indexed or skipped; b\.pdf failed: Embedding API failure: down; c\.pdf skipped: not_attempted_after_failure \(not attempted: /, "a not-attempted file is a problem, named");
    const refusedOnSkip = outcomes.jobErrorFrom([f("skipped", { fileName: "r.pdf", reason: outcomes.SKIP_REASONS.ALREADY_INDEXED, supersedeError: "r.pdf is indexed but other versions could not be removed (HTTP 503)" })], "partial");
    assert.match(refusedOnSkip, /^1 of 1 file\(s\) indexed or skipped; r\.pdf skipped \(previous versions not removed\): r\.pdf is indexed but other versions could not be removed/, "a refused repair on the skipped branch names the file and the refusal");
    assert.strictEqual(outcomes.jobErrorFrom([f("indexed")], "completed"), null);
    assert.strictEqual(outcomes.jobErrorCodeFor("error", INGEST_ERROR_CODES), "INGEST_FAILED");
    assert.strictEqual(outcomes.jobErrorCodeFor("partial", INGEST_ERROR_CODES), "INGEST_PARTIAL");
    assert.strictEqual(outcomes.jobErrorCodeFor("completed", INGEST_ERROR_CODES), null);
    assert.strictEqual(outcomes.jobErrorCodeFor("cancelled", INGEST_ERROR_CODES), null);
    assert.strictEqual(INGEST_ERROR_CODES.INGEST_PARTIAL, "INGEST_PARTIAL");
  });

  test("fileCountsFrom tallies statuses and chunk totals", () => {
    const t = outcomes.fileCountsFrom([f("indexed", { counts: { chunksEmitted: 5, chunksInserted: 5 } }), f("partial", { counts: { chunksEmitted: 9, chunksInserted: 4 } }), f("skipped"), f("parsing")]);
    assert.deepStrictEqual(t.files, { total: 4, indexed: 1, partial: 1, failed: 0, skipped: 1, empty: 0, cancelled: 0, pending: 1 });
    assert.deepStrictEqual(t.chunks, { emitted: 14, inserted: 9 });
  });
});

describe("U-LEDGER/T07: the routes are wired to the ledger (source pins)", () => {
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ingest = read("src/app/api/ingest/route.js");
  const cancel = read("src/app/api/ingest/cancel/route.js");
  const status = read("src/app/api/ingest/status/route.js");

  test("the ingest route records every event of the vocabulary it owns, through one `record` helper that never throws into the job", () => {
    for (const name of ["ingest_start", "collection_created", "file_parsed", "file_indexed", "file_failed", "file_skipped", "file_superseded", "ingest_end"]) {
      assert.match(ingest, new RegExp(`event: "${name}"`), name);
    }
    assert.match(ingest, /const record = \(event\) => \{\s*try \{\s*appendEvent\(ledgerPath/, "one append site, guarded");
    assert.match(ingest, /job\.ledgerError = /, "a failed append is surfaced on the job, not swallowed");
    assert.match(read("src/app/api/ingest/clear/route.js"), /event: "collection_cleared"/, "T21's deferred event lives in clear");
    assert.match(read("src/app/api/ingest/unload/route.js"), /event: "file_unloaded"/);
  });

  test("under v2 the skip consults completion state and the store; v1 keeps T03's content-hash check byte for byte (D4)", () => {
    assert.match(ingest, /schemaVersion === 2\s*\)\s*\{\s*decision = await completionDecision\(weaviateClient, ledgerPath, className, parser\.sourceId, parser\.docVersion\)/);
    assert.match(ingest, /alreadyIndexed = await weaviateClient\.checkDocHashExists\(parser\.docHash\)/, "v1 unchanged");
    assert.match(ingest, /latestFileOutcome\(getIndex\(ledgerPath\)\.events/, "the ledger is consulted");
    assert.match(ingest, /await client\.countIdentity\(sourceId, docVersion\)/, "and the store is cross-checked");
    assert.match(ingest, /store\.count === n && store\.maxChunkIndex === n - 1/, "count AND highest index — a partial is contiguous too");
    assert.match(ingest, /isRecordedComplete\(outcome\)/);
    for (const reason of ["NO_COMPLETION_RECORD", "PARTIAL_RECORD", "RECORD_INVALIDATED", "STORE_MISMATCH", "STORE_UNAVAILABLE"]) {
      assert.match(ingest, new RegExp(`REINDEX_REASONS\\.${reason}`), `every reindex reason is reachable: ${reason}`);
    }
    // The repair on the skipped branch (design §3, amendment D4b) is guarded by
    // the version being known complete AND the store agreeing — the call must
    // sit inside the `alreadyIndexed` branch, under schemaVersion 2, with the
    // recorded count as keepChunkCount.
    const skippedAt = ingest.indexOf("if (alreadyIndexed) {");
    const repairAt = ingest.indexOf("await repairSupersede(weaviateClient, record, fr");
    const chunkAt = ingest.indexOf("const chunks = await parser.chunk();");
    assert.ok(skippedAt > -1 && repairAt > skippedAt && repairAt < chunkAt, "repairSupersede runs on the skipped branch only");
    assert.match(ingest.slice(skippedAt, chunkAt), /if \(schemaVersion === 2 && decision && Number\.isInteger\(decision\.evidence\?\.recorded\)\) \{\s*await repairSupersede\([\s\S]{0,300}?keepChunkCount: decision\.evidence\.recorded/, "guarded by v2 and the recorded complete count (D4b)");
    assert.match(ingest, /const matches = store\.count === n && store\.maxChunkIndex === n - 1;\s*return \{\s*skip: matches,/, "the store's agreement decides the skip — not the record alone");
  });

  test("a failed file no longer fails the job, and a failed batch is recorded only after its slice settled (D5, D7)", () => {
    assert.match(ingest, /catch \(err\) \{\s*fr\.status = "failed";\s*fr\.error = clip\(err\.message\);\s*fr\.reason = "failed before indexing";/, "phase-1 isolation, bounded");
    assert.match(ingest, /if \(phase2Failed\) \{\s*fr\.status = "skipped";\s*fr\.reason = SKIP_REASONS\.NOT_ATTEMPTED;/, "after the first phase-2 failure the remaining files are not attempted, and say so (review §6a)");
    assert.match(ingest, /appendEvent\(ledgerPath, boundEvent\(/, "every event is bounded before it is written");
    assert.match(ingest, /embedHost: embedHostOf\(embedUrl\)/, "the embed endpoint is recorded as origin + path only");
    assert.ok(!/embedUrl: String\(embedUrl\)/.test(ingest), "the raw embed URL is never recorded");
    assert.match(ingest, /catch \(err\) \{\s*if \(!fileError\) fileError = err;\s*\}/, "a batch failure is captured, not thrown, so Promise.all waits for the slice");
    assert.match(ingest, /if \(fileError\) break;/);
    assert.match(ingest, /fr\.status = inserted > 0 \? "partial" : "failed";/);
    assert.match(ingest, /const status = jobStatusFrom\(job\.fileResults, \{ cancelled: job\.cancelled \}\);/, "the job status is derived, never set by the last error");
    assert.match(ingest, /const status = job\.cancelled \? "cancelled" : "error";/, "a throw after a cancel stays cancelled (F-52)");
    // The outer catch (a job-level throw: ensureSchema, a v1 pre-insert delete
    // against a dead store) still gives every stranded file a terminal event
    // and counts it, and a cancelled job carries no error code (review §6a).
    const errAt = ingest.indexOf("[Ingestion Pipeline Error]");
    const catchAt = ingest.lastIndexOf("} catch (err) {", errAt);
    const outerCatch = ingest.slice(catchAt, errAt);
    assert.ok(errAt > catchAt && catchAt > -1, "the outer catch is located");
    assert.match(outerCatch, /if \(!isTerminalFileStatus\(fr\.status\)\) \{[\s\S]{0,1200}?record\(\{ event: "file_skipped", \.\.\.identity, reason: SKIP_REASONS\.CANCELLED, detail: "job aborted after the cancel"/, "a stranded file of a cancelled job is recorded cancelled");
    assert.match(outerCatch, /record\(\{ event: "file_failed", \.\.\.identity, status: "failed", reason: fr\.reason, error: fr\.error/, "a stranded file of a failed job is recorded failed");
    assert.match(outerCatch, /completeFile\(\);/, "and counted");
    assert.match(outerCatch, /const errorCode = job\.cancelled \? null : INGEST_CODES\.INGEST_FAILED;/, "no error code on a cancelled job (D6)");
    assert.match(ingest, /if \(!fileError && inserted === 0 && job\.cancelled\) \{\s*fr\.status = "cancelled";/, "a cancel before any batch landed is a cancelled file, not partial 0/N (review §6a)");
  });

  test("the cancel route only asks: it sets the flag, answers 'cancelling', and never finishes the job (F-63, D7)", () => {
    assert.ok(!/finishJob/.test(cancel), "cancel/route.js must not import or call finishJob");
    assert.match(cancel, /job\.cancelled = true;/);
    assert.match(cancel, /status: "cancelling"/);
    assert.match(read("src/lib/ingestion/state.js"), /return job && job\.status === "processing" \? job : null;/, "activeJob holds the lock while the worker runs, cancelled or not");
    // Phase 1 honours the cancel per file (F-52): the check must sit BEFORE
    // the parse, with its own reason — a phase-2 check cannot satisfy this.
    const phase1CancelAt = ingest.indexOf('detail: "cancelled before parsing"');
    const parseAt = ingest.indexOf("const chunks = await parser.chunk();");
    assert.ok(phase1CancelAt > -1 && parseAt > -1 && phase1CancelAt < parseAt, "the phase-1 cancel check precedes the parse");
    assert.match(ingest.slice(0, parseAt), /if \(job\.cancelled\) \{\s*fr\.status = "cancelled";\s*fr\.reason = SKIP_REASONS\.CANCELLED;\s*record\(\{ event: "file_skipped"[^\n]*detail: "cancelled before parsing"/, "phase 1: cancelled before parsing");
    assert.match(ingest, /if \(job\.cancelled\) \{\s*console\.log\("\[Ingestion\] Processing loop aborted due to cancellation\."\);\s*break;/, "phase 2 stops between slices");
  });

  test("the status route reconstructs a lost job from the ledger and keeps the 404 for an id nobody saw (D8)", () => {
    assert.match(status, /jobsFrom\(view\.index\.events, \{ liveJobIds: view\.live \}\)\.find\(\(j\) => j\.jobId === jobId\)/);
    assert.match(status, /reconstructed = snapshotFromLedgerJob\(found\)/);
    assert.match(status, /cached\.index === index && cached\.version === index\.version && cached\.liveKey === liveKey/, "the memo is keyed on the index object, its version and the live set (review §6a: compaction resets the version)");
    assert.match(status, /path: path\.relative\(process\.cwd\(\), filePath\)/, "the frame carries a relative path, never a server path");
    assert.match(status, /code: INGEST_CODES\.JOB_NOT_FOUND/);
    assert.match(status, /ledger: summary/, "every frame carries the ledger summary");
    assert.match(read("src/lib/ingestion/state.js"), /"fileResults", "ledgerError",/, "fileResults ride on every frame");
  });

  test("the page closes the stream on every terminal status (D9)", () => {
    const page = read("src/app/page.js");
    assert.match(page, /const INGEST_TERMINAL_STATUSES = \["completed", "partial", "error", "cancelled", "interrupted"\];/);
    assert.match(page, /if \(INGEST_TERMINAL_STATUSES\.includes\(state\.status\)\) \{\s*eventSource\.close\(\);/);
    for (const file of ["src/app/page.js", "src/components/StandardsDrawer.jsx"]) {
      // Comments stripped (JSX comments too), so a pin is satisfied by markup, never by prose about markup.
      const src = read(file).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      assert.match(src, /<ul [^>]*data-testid="ingest-file-results"/, `${file} renders the per-file list`);
      assert.match(src, /ingestionProgress\.fileResults\.map\(/, `${file} maps every outcome`);
      assert.match(src, /\{ingestionProgress\.cancelled \? "Cancelling…" : "Cancel"\}/, `${file}: the cancel button reflects a pending cancel`);
      assert.match(src, /disabled=\{Boolean\(ingestionProgress\.cancelled\)\}/, `${file}: one cancel is enough`);
      assert.match(src, /"Cancelling\.\.\."/, `${file} names the cancelling state`);
    }
  });

  test("the orchestrator's recorded pagination facts never override an in-process fact and are read inside a catch (D10, F-25)", () => {
    const orch = read("src/lib/orchestrator.js");
    assert.match(orch, /for \(const f of recordedFacts\) \{\s*if \(f && f\.fileName && typeof f\.paginated === "boolean" && !\(f\.fileName in paginationFacts\)\) \{\s*paginationFacts\[f\.fileName\] = f\.paginated;/, "a recorded boolean lands in the same map as a trace boolean, only when no trace exists for the file");
    assert.match(orch, /try \{\s*const \{ defaultLedgerPath, getIndex, recordedParseFacts \} = require\("\.\/rag\/ledger"\);\s*recordedFacts = recordedParseFacts\([\s\S]{0,200}?\} catch \(ledgerErr\) \{\s*recordedFacts = \[\];/, "an unreadable ledger is no facts, never a failed turn");
    assert.match(orch, /buildParserSpanModel\(doclingLogs, summary, recordedFacts\)/);
    assert.match(orch, /buildVlmSpanModel\(doclingLogs, recordedFacts\)/);
  });
});

/**
 * T16 — the embedding-space pin (design D1, D10). Derived from the ledger,
 * never declared: reset on collection_cleared and on a (re)collection_created;
 * provisional from the creation name; enforceable from the first record whose
 * vectors LANDED; a landed record of another dimension re-pins (Weaviate cannot
 * hold two dimensionalities in one class — measured, t16-artifacts step 3);
 * same dimension, another name is disclosed in `modelsSeen`, never averaged.
 * The review question for each case: what one-line change would make it pass
 * with the behaviour wrong? Pinning from `collection_created` alone, pinning
 * on a failed record's embedDim (the §0 step 3 shape carries 2560 with 0
 * inserted), letting an unload reset, and a compaction that drops the only
 * landed record are each pinned below.
 */
describe("U-LEDGER/T16: getCollectionPin — the embedding-space pin is derived, never declared (design D1)", () => {
  const { getCollectionPin, storeOriginOf } = ledger;
  const M8 = "qwen3-embedding:8b";
  const M4 = "Qwen/Qwen3-Embedding-4B";
  const ALIAS = "qwen3-embedding:8b-alias";
  const created = (embedModel, ts = "t0", extra = {}) => ({ event: "collection_created", collection: C, embedModel, ts, jobId: `j-${ts}`, ...extra });
  const cleared = (ts = "tc") => ({ event: "collection_cleared", collection: C, dropped: true, ts });
  const landed = (embedModel, embedDim, { ts = "t1", sourceId = S, docVersion = V1, event = "file_indexed", status = "complete", inserted = 5, ...extra } = {}) => ({
    event, collection: C, sourceId, docVersion, status, counts: { chunksEmitted: 5, chunksInserted: inserted }, embedModel, embedDim, ts, jobId: `j-${ts}`, ...extra,
  });
  const pinOf = (events, opts = {}) => getCollectionPin(events, { collection: C, ...opts });

  test("no record for the collection → null; another collection's events never answer for this one", () => {
    assert.strictEqual(pinOf([]), null);
    assert.strictEqual(pinOf([{ ...created(M8), collection: "OtherV2" }, { ...landed(M8, 4096), collection: "OtherV2" }]), null);
    assert.strictEqual(pinOf(jobEvents("j1", { collection: "OtherV2" })), null);
  });

  test("collection_created alone is PROVISIONAL: the request's name, no dimension, never enforceable (D5)", () => {
    const pin = pinOf([created(M8)]);
    assert.strictEqual(pin.collection, C);
    assert.strictEqual(pin.embedModel, M8);
    assert.strictEqual(pin.embedDim, null);
    assert.strictEqual(pin.enforceable, false);
    assert.strictEqual(pin.source, "collection_created");
    assert.strictEqual(pin.pinnedBy, "j-t0");
    assert.deepStrictEqual(pin.since, { event: "collection_created", ts: "t0" });
    assert.deepStrictEqual(pin.modelsSeen, [M8]);
    assert.strictEqual(pin.landedRecords, 0);
  });

  test("the first record whose vectors landed makes the pin enforceable, with the MEASURED dimension", () => {
    const pin = pinOf([created(M8), landed(M8, 4096, { ts: "t1" }), landed(M8, 4096, { ts: "t2", sourceId: "demos/y.pdf" })]);
    assert.strictEqual(pin.enforceable, true);
    assert.strictEqual(pin.embedModel, M8);
    assert.strictEqual(pin.embedDim, 4096);
    assert.strictEqual(pin.source, "file_indexed");
    assert.strictEqual(pin.pinnedAt, "t1", "the FIRST landed record after the last reset");
    assert.strictEqual(pin.pinnedBy, "j-t1");
    assert.deepStrictEqual(pin.since, { event: "collection_created", ts: "t0" });
    assert.deepStrictEqual(pin.modelsSeen, [M8]);
    assert.strictEqual(pin.landedRecords, 2);
    // A legacy class written before the ledger, then a first post-T16 write:
    // no creation event at all, and the first landed record still pins (D9).
    const legacy = pinOf([landed(M8, 4096, { ts: "t5" })]);
    assert.strictEqual(legacy.enforceable, true);
    assert.strictEqual(legacy.since, null, "no reset event was ever recorded");
  });

  test("a failed record with nothing inserted never pins — even though it carries an embedDim (the §0 step 3 shape: 2560 for vectors that never landed)", () => {
    const events = [created(M8), landed(M4, 2560, { ts: "t1", event: "file_failed", status: "failed", inserted: 0 })];
    const pin = pinOf(events);
    assert.strictEqual(pin.enforceable, false, "a record of vectors that never landed must not pin");
    assert.strictEqual(pin.embedModel, M8, "the provisional name stands");
    assert.strictEqual(pin.embedDim, null);
    assert.deepStrictEqual(pin.modelsSeen, [M8], "the failed model is not 'seen' either — nothing of it is in the class");
    // an `empty` parse neither
    const empty = pinOf([created(M8), landed(M4, null, { ts: "t1", event: "file_failed", status: "empty", inserted: 0 })]);
    assert.strictEqual(empty.enforceable, false);
    // a landed record with no measured dimension cannot pin a dimension
    const nodim = pinOf([created(M8), landed(M8, null, { ts: "t1" })]);
    assert.strictEqual(nodim.enforceable, false, "no measured dim → no enforceable pin");
    // the > 0 boundary itself: a PARTIAL with nothing inserted is not landed (review)
    const partialZero = pinOf([created(M8), landed(M4, 2560, { ts: "t1", event: "file_failed", status: "partial", inserted: 0 })]);
    assert.strictEqual(partialZero.enforceable, false, "partial with 0 inserted never pins");
    assert.strictEqual(ledger.isLandedRecord({ event: "file_failed", status: "partial", counts: { chunksInserted: 0 } }), false);
    assert.strictEqual(ledger.isLandedRecord({ event: "file_failed", status: "partial", counts: { chunksInserted: 1 } }), true);
  });

  test("a PARTIAL record with inserted > 0 pins: its vectors are in the class", () => {
    const pin = pinOf([created(M8), landed(M8, 4096, { ts: "t1", event: "file_failed", status: "partial", inserted: 16 })]);
    assert.strictEqual(pin.enforceable, true);
    assert.strictEqual(pin.source, "file_failed");
    assert.strictEqual(pin.embedDim, 4096);
  });

  test("collection_cleared resets the pin to nothing; a second collection_created resets it to the NEW provisional name (out-of-band recreate)", () => {
    const after = pinOf([created(M8), landed(M8, 4096, { ts: "t1" }), cleared("t2")]);
    assert.strictEqual(after.embedModel, null);
    assert.strictEqual(after.embedDim, null);
    assert.strictEqual(after.enforceable, false);
    assert.strictEqual(after.source, null);
    assert.deepStrictEqual(after.since, { event: "collection_cleared", ts: "t2" });
    assert.deepStrictEqual(after.modelsSeen, []);
    assert.strictEqual(after.landedRecords, 0);
    const recreated = pinOf([created(M8), landed(M8, 4096, { ts: "t1" }), created(ALIAS, "t3")]);
    assert.strictEqual(recreated.embedModel, ALIAS);
    assert.strictEqual(recreated.enforceable, false);
    assert.deepStrictEqual(recreated.since, { event: "collection_created", ts: "t3" });
    assert.deepStrictEqual(recreated.modelsSeen, [ALIAS], "the old class's vectors are gone with it");
    // and what is written next defines the space
    const next = pinOf([created(M8), landed(M8, 4096, { ts: "t1" }), cleared("t2"), landed(ALIAS, 4096, { ts: "t4" })]);
    assert.strictEqual(next.embedModel, ALIAS);
    assert.strictEqual(next.enforceable, true);
    assert.deepStrictEqual(next.since, { event: "collection_cleared", ts: "t2" });
  });

  test("a landed record of ANOTHER dimension re-pins (rule 4): the class was rebuilt without the ledger seeing it", () => {
    const pin = pinOf([created(M8), landed(M8, 4096, { ts: "t1" }), landed(M4, 2560, { ts: "t2", sourceId: "demos/y.pdf" })]);
    assert.strictEqual(pin.embedModel, M4);
    assert.strictEqual(pin.embedDim, 2560);
    assert.strictEqual(pin.enforceable, true);
    assert.strictEqual(pin.pinnedAt, "t2");
    assert.deepStrictEqual(pin.modelsSeen, [M4], "the previous space's names do not carry over");
    assert.strictEqual(pin.landedRecords, 1);
    assert.deepStrictEqual(pin.repinnedFrom, { embedModel: M8, embedDim: 4096, pinnedAt: "t1" }, "the move is disclosed");
  });

  test("same dimension, another name: the first writer wins and the name joins modelsSeen — disclosed, never averaged (rule 5)", () => {
    const pin = pinOf([created(M8), landed(M8, 4096, { ts: "t1" }), landed(ALIAS, 4096, { ts: "t2", sourceId: "demos/y.pdf" }), landed(M8, 4096, { ts: "t3", sourceId: "demos/z.pdf" })]);
    assert.strictEqual(pin.embedModel, M8);
    assert.strictEqual(pin.pinnedAt, "t1");
    assert.deepStrictEqual(pin.modelsSeen, [M8, ALIAS]);
    assert.strictEqual(pin.landedRecords, 3);
  });

  test("file_unloaded does not reset: the index was built at one dimension, and the honest reset is clear", () => {
    const pin = pinOf([created(M8), landed(M8, 4096, { ts: "t1" }), { event: "file_unloaded", collection: C, sourceId: S, matches: 5, ts: "t2" }]);
    assert.strictEqual(pin.enforceable, true);
    assert.strictEqual(pin.embedModel, M8);
  });

  test("the store filter (D10): a record naming another Weaviate origin is ignored; a record without `store` matches any", () => {
    const a = "http://weaviate-a.svc:80";
    const b = "http://weaviate-b.svc:80";
    const events = [created(M8, "t0", { store: a }), landed(M8, 4096, { ts: "t1", store: a }), landed(M4, 2560, { ts: "t2", sourceId: "demos/y.pdf", store: b })];
    const onA = pinOf(events, { store: a });
    assert.strictEqual(onA.embedModel, M8);
    assert.strictEqual(onA.embedDim, 4096, "b's 2560 record did not re-pin a");
    assert.strictEqual(onA.store, a);
    const onB = pinOf(events, { store: b });
    assert.strictEqual(onB.embedModel, M4, "b's own record pins b (no creation event was recorded for b)");
    assert.strictEqual(onB.since, null);
    const unfiltered = pinOf(events);
    assert.strictEqual(unfiltered.embedDim, 2560, "without a store filter the reducer sees every record (pre-T16 behaviour)");
    const legacy = pinOf([created(M8), landed(M8, 4096, { ts: "t1" })], { store: b });
    assert.strictEqual(legacy.enforceable, true, "a pre-T16 record (no store field) matches any store");
    // The URL parser normalises a default port away, so "http://w:80" and
    // "http://w" are ONE origin — which is right: both routes derive the
    // store through this helper, so a record and a query naming the same
    // server differently still meet.
    assert.strictEqual(storeOriginOf("http://weaviate.hpe-weaviate.svc.cluster.local:80/v1/schema?x=1"), "http://weaviate.hpe-weaviate.svc.cluster.local");
    assert.strictEqual(storeOriginOf("http://weaviate.hpe-weaviate.svc.cluster.local"), storeOriginOf("http://weaviate.hpe-weaviate.svc.cluster.local:80/"));
    assert.strictEqual(storeOriginOf("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080", "a non-default port is kept");
    assert.strictEqual(storeOriginOf("https://user:secret@w.example/v1"), "https://w.example", "never userinfo, path or query");
    assert.strictEqual(storeOriginOf("not a url"), null);
  });

  test("compaction keeps the pin: compact ∘ pin ≡ pin on embedModel, embedDim, enforceable and modelsSeen", () => {
    const events = [created("m", "2026-09-05T09:00:00.000Z")];
    for (let i = 1; i <= 25; i++) events.push(...jobEvents(`j${i}`, { sourceId: `demos/d${i}.pdf`, n: i, status: i === 3 ? "partial" : "complete", ts: `2026-09-05T10:${String(i).padStart(2, "0")}:00.000Z` }));
    const before = pinOf(events);
    assert.strictEqual(before.enforceable, true);
    for (const keepJobs of [20, 1, 0]) {
      const kept = selectCompacted(events, { keepJobs });
      const after = pinOf(kept);
      for (const key of ["embedModel", "embedDim", "enforceable", "modelsSeen", "collection"]) {
        assert.deepStrictEqual(after[key], before[key], `${key} after compaction (keepJobs ${keepJobs})`);
      }
      assert.deepStrictEqual(selectCompacted(kept, { keepJobs }), kept, "still a fixed point");
    }
    // The edge a per-document rule alone would lose: the ONLY document's latest
    // terminal record is a failed re-ingest (0 inserted) after its indexed
    // record, and the job that indexed it is dropped. Compaction keeps the
    // latest LANDED record per collection too, so the pin stays enforceable
    // instead of degrading to provisional — which would let the next
    // wrong-model ingest through (design §7, "compaction keeps the pin").
    const edge = [
      created("m", "t0"),
      ...jobEvents("j1", { ts: "t1" }),
      ...jobEvents("j2", { status: "failed", ts: "t2" }),
    ];
    const edgeBefore = pinOf(edge);
    assert.strictEqual(edgeBefore.enforceable, true);
    const edgeKept = selectCompacted(edge, { keepJobs: 0 });
    assert.ok(edgeKept.some((e) => e.event === "file_indexed"), "the landed record survives compaction");
    const edgeAfter = pinOf(edgeKept);
    assert.strictEqual(edgeAfter.enforceable, true, "a compacted ledger must not turn an enforceable pin provisional");
    assert.strictEqual(edgeAfter.embedDim, 4096);
    assert.deepStrictEqual(selectCompacted(edgeKept, { keepJobs: 0 }), edgeKept);
    // and a pin whose latest landed record is a partial survives as such
    const partialEdge = [created("m", "t0"), ...jobEvents("j1", { status: "partial", ts: "t1" }).map((e) => (e.event === "file_failed" ? { ...e, embedModel: "m", embedDim: 4096 } : e))];
    assert.strictEqual(pinOf(selectCompacted(partialEdge, { keepJobs: 0 })).enforceable, pinOf(partialEdge).enforceable);
    // A MIXED record (rule 5 — written before T16 or by an older pod): the
    // same document indexed under two names. "Latest terminal per document"
    // alone keeps only the second name, so the first writer's pin would flip
    // and the "more than one model" disclosure would vanish (review). The
    // rule keeps the FIRST landed record per (collection, store, model)
    // after the last reset, so both the pin and modelsSeen survive.
    const mixed = [created(M8, "t0"), ...jobEvents("j1", { ts: "t1" }).map((e) => (e.event === "file_indexed" ? { ...e, embedModel: M8 } : e)), ...jobEvents("j2", { ts: "t2" }).map((e) => (e.event === "file_indexed" ? { ...e, embedModel: ALIAS } : e))];
    const mixedBefore = pinOf(mixed);
    assert.strictEqual(mixedBefore.embedModel, M8);
    assert.deepStrictEqual(mixedBefore.modelsSeen, [M8, ALIAS]);
    const mixedKept = selectCompacted(mixed, { keepJobs: 0 });
    const mixedAfter = pinOf(mixedKept);
    assert.strictEqual(mixedAfter.embedModel, M8, "the first writer still wins after compaction");
    assert.deepStrictEqual(mixedAfter.modelsSeen, [M8, ALIAS], "the mixed record is still disclosed");
    assert.deepStrictEqual(selectCompacted(mixedKept, { keepJobs: 0 }), mixedKept);
    // Two stores sharing a class name and a sourceId (D10): each keeps its own witness.
    const a = "http://weaviate-a.svc";
    const b = "http://weaviate-b.svc";
    const twoStores = [...jobEvents("j1", { ts: "t1" }).map((e) => ({ ...e, store: a })), ...jobEvents("j2", { ts: "t2" }).map((e) => (e.event === "file_indexed" ? { ...e, store: b, embedModel: M4, embedDim: 2560 } : { ...e, store: b }))];
    const twoKept = selectCompacted(twoStores, { keepJobs: 0 });
    assert.deepStrictEqual([pinOf(twoKept, { store: a }).embedModel, pinOf(twoKept, { store: a }).embedDim], ["m", 4096], "store a's pin survives (jobEvents' model is \"m\")");
    assert.deepStrictEqual([pinOf(twoKept, { store: b }).embedModel, pinOf(twoKept, { store: b }).embedDim], [M4, 2560], "store b's pin survives");
    assert.deepStrictEqual(selectCompacted(twoKept, { keepJobs: 0 }), twoKept);
    // A record BEFORE the last reset is not a witness: it may go.
    const resetThen = [...jobEvents("j1", { ts: "t1" }), cleared("t2"), ...jobEvents("j2", { ts: "t3", n: 7 })];
    const resetKept = selectCompacted(resetThen, { keepJobs: 0 });
    assert.deepStrictEqual(pinOf(resetKept).pinnedAt, pinOf(resetThen).pinnedAt);
    assert.strictEqual(pinOf(resetKept).since.event, "collection_cleared");
  });

  test("the reducer is pure and tolerant: malformed records are skipped, and events are never mutated", () => {
    const events = [created(M8), { event: "file_indexed", collection: C, status: "complete" }, landed(M8, 4096, { ts: "t1" })];
    const snapshot = JSON.stringify(events);
    const pin = pinOf(events);
    assert.strictEqual(pin.enforceable, true);
    assert.strictEqual(pin.pinnedAt, "t1", "a record with no model or dimension is skipped, not pinned");
    assert.strictEqual(JSON.stringify(events), snapshot);
    assert.throws(() => getCollectionPin(events, {}), /collection is required/);
  });
});

describe("U-LEDGER/T35 (t35-design D10): the OCR pass on the ledger's recorded facts, the file result and the views' line", () => {
  const S = "demos/b.pdf";
  const base = { ts: "2026-09-17T21:00:00.000Z", collection: "RAGChunkV2", schemaVersion: 2, store: "http://w", jobId: "j1" };
  const fresh = () => outcomes.newFileResult({ filePath: S, fileName: "b.pdf" });
  test("recordedParseFacts carries the OCR facts (null on a pre-T35 record, never 0); the route records them on file_parsed and on every terminal record (source pin)", () => {
    const { recordedParseFacts } = require("../../src/lib/rag/ledger");
    const events = [
      { ...base, event: "file_parsed", filePath: S, fileName: "b.pdf", sourceId: S, docVersion: "h.v5", engine: "pypdfium2", counts: { pages: 2, chunksEmitted: 7, figuresCaptured: 2, figuresCaptioned: 2, ocrNoText: 2, ocrPages: 2, ocrEmpty: 0, ocrFailed: 0, ocrChars: 1787 }, ocrMode: "auto", ocrNoTextPages: "1, 2", ocrPagesList: "1, 2", ocrEmptyPages: "", ocrFailedPages: "", ocrEngine: "rapidocr 3.9.2 / onnxruntime 1.30.0 / models x", ocrDurationMs: 5240 },
      { ...base, event: "file_indexed", filePath: S, fileName: "b.pdf", sourceId: S, docVersion: "h.v5", status: "complete", counts: { chunksEmitted: 7, chunksInserted: 7 } },
      { ...base, event: "file_parsed", filePath: "demos/old.pdf", fileName: "old.pdf", sourceId: "demos/old.pdf", docVersion: "o.v4", engine: "pypdfium2", counts: { pages: 7, chunksEmitted: 26 } },
      { ...base, event: "file_indexed", filePath: "demos/old.pdf", fileName: "old.pdf", sourceId: "demos/old.pdf", docVersion: "o.v4", status: "complete", counts: { chunksEmitted: 26, chunksInserted: 26 } },
    ];
    const facts = recordedParseFacts(events, { collection: "RAGChunkV2" });
    const b = facts.find((f) => f.fileName === "b.pdf");
    const old = facts.find((f) => f.fileName === "old.pdf");
    assert.deepStrictEqual({ m: b.ocrMode, n: b.ocrNoText, p: b.ocrPages, e: b.ocrEmpty, f: b.ocrFailed, c: b.ocrChars, d: b.ocrDurationMs, l: b.ocrPagesList, g: b.ocrEngine }, { m: "auto", n: 2, p: 2, e: 0, f: 0, c: 1787, d: 5240, l: "1, 2", g: "rapidocr 3.9.2 / onnxruntime 1.30.0 / models x" });
    assert.deepStrictEqual({ m: old.ocrMode, n: old.ocrNoText, p: old.ocrPages, g: old.ocrEngine }, { m: null, n: null, p: null, g: null }, "a pre-T35 record: null, never 0");
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "ingest", "route.js"), "utf-8");
    assert.match(src, /fr\.counts\.ocrNoText = fig\("ocrNoText"\);\s*fr\.counts\.ocrPages = fig\("ocrPages"\);\s*fr\.counts\.ocrEmpty = fig\("ocrEmpty"\);\s*fr\.counts\.ocrFailed = fig\("ocrFailed"\);\s*fr\.counts\.ocrChars = fig\("ocrChars"\);/, "the file result (the status frame) carries the five OCR counts");
    assert.match(src, /ocrNoText: fig\("ocrNoText"\),\s*ocrPages: fig\("ocrPages"\),\s*ocrEmpty: fig\("ocrEmpty"\),\s*ocrFailed: fig\("ocrFailed"\),\s*ocrChars: fig\("ocrChars"\),/, "file_parsed's counts record them");
    assert.match(src, /ocrMode: fr\.ocrMode,\s*ocrNoTextPages: fr\.ocrNoTextPages,\s*ocrPagesList: fr\.ocrPagesList,\s*ocrEmptyPages: fr\.ocrEmptyPages,\s*ocrFailedPages: fr\.ocrFailedPages,\s*ocrEngine: fr\.ocrEngine,\s*ocrDurationMs: fr\.ocrDurationMs,/, "file_parsed names the mode, the pages, the engine and the wall time");
    assert.match(src, /ocrNoText: fr\.counts\.ocrNoText,\s*ocrPages: fr\.counts\.ocrPages,\s*ocrEmpty: fr\.counts\.ocrEmpty,\s*ocrFailed: fr\.counts\.ocrFailed,\s*ocrChars: fr\.counts\.ocrChars,/, "every terminal record carries the counts (a ledger-rebuilt frame keeps them)");
  });
  test("the views' line (figureSuffix): the OCR part names the pages read with the characters and the seconds, the pages read empty, the failures — or, under off, the pages left without text; nothing when every page has a text layer", () => {
    const f = (over) => ({ ...fresh(), status: "indexed", ...over });
    assert.strictEqual(outcomes.figureSuffix(f({ counts: { ...fresh().counts, figuresCaptured: 2, figuresCaptioned: 2, ocrNoText: 2, ocrPages: 2, ocrEmpty: 0, ocrFailed: 0, ocrChars: 1787 }, ocrMode: "auto", ocrPagesList: "1, 2", ocrDurationMs: 5240 })), " · 2/2 figures · OCR: 2 pages without a text layer — 2 pages read (p1, p2) — 1,787 characters in 5.2 s");
    assert.strictEqual(outcomes.figureSuffix(f({ counts: { ...fresh().counts, ocrNoText: 1, ocrPages: 0, ocrEmpty: 1, ocrFailed: 0, ocrChars: 0 }, ocrMode: "auto", ocrEmptyPages: "122" })), " · OCR: 1 page without a text layer — 1 read empty (p122)", "captioning off still names the OCR pass");
    assert.strictEqual(outcomes.figureSuffix(f({ counts: { ...fresh().counts, figuresCaptured: 5, figuresCaptioned: 5, ocrNoText: 2, ocrPages: 0, ocrEmpty: 0, ocrFailed: 2, ocrChars: 0 }, ocrMode: "auto", ocrFailedPages: "1, 2" })), " · 5/5 figures · OCR: 2 pages without a text layer — 2 failed (p1, p2)");
    assert.strictEqual(outcomes.figureSuffix(f({ counts: { ...fresh().counts, figuresCaptured: 5, figuresCaptioned: 5, ocrNoText: 2 }, ocrMode: "off", ocrNoTextPages: "1, 2" })), " · 5/5 figures · OCR off: 2 pages without a text layer left without text (p1, p2)");
    assert.strictEqual(outcomes.figureSuffix(f({ counts: { ...fresh().counts, figuresCaptured: 5, figuresCaptioned: 5, ocrNoText: 0 } })), " · 5/5 figures", "every page has a text layer: no OCR part");
    assert.strictEqual(outcomes.ocrSuffix({ counts: {} }), "", "a pre-T35 record: nothing");
  });
});
