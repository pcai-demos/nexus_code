import { NextResponse } from "next/server";
import path from "path";
import {
  INGEST_ERROR_CODES as INGEST_CODES,
  getJob,
  getCurrentJob,
  snapshot,
  retainedJobIds,
  snapshotFromLedgerJob,
} from "@/lib/ingestion/state";
import {
  defaultLedgerPath,
  getIndex,
  revalidateIndex,
  jobsFrom,
  summarise,
  getCollectionPin,
} from "@/lib/rag/ledger";

export const dynamic = "force-dynamic";

/**
 * T07 (design D8): the ledger summary every frame carries, and the lookup
 * for a job this process no longer holds. Read from the module's in-process
 * index, never the file, and memoised on the index version so a 300 ms
 * frame costs nothing when nothing was appended.
 */
const summaryCache = new Map();
const REVALIDATE_MS = 5000;
let lastRevalidatedAt = 0;
function ledgerView() {
  let filePath;
  try {
    filePath = defaultLedgerPath();
    // Another process may have appended (a rolling update's overlap): one
    // stat every few seconds keeps the summary honest (review §6a).
    if (Date.now() - lastRevalidatedAt > REVALIDATE_MS) {
      lastRevalidatedAt = Date.now();
      revalidateIndex(filePath);
    }
    const index = getIndex(filePath);
    const live = new Set(retainedJobIds());
    const liveKey = [...live].sort().join(",");
    const cached = summaryCache.get(filePath);
    let summary;
    let collections;
    // Keyed on the index OBJECT as well as its version: compaction reloads
    // the index and restarts the version at 0 (review §6a).
    if (cached && cached.index === index && cached.version === index.version && cached.liveKey === liveKey) {
      summary = cached.summary;
      collections = cached.collections;
    } else {
      summary = {
        // Relative to the working directory: the frame is an unauthenticated
        // route and a server path is nobody's business (review §6a).
        path: path.relative(process.cwd(), filePath),
        exists: index.exists,
        corruptLines: index.corruptLines,
        ...summarise(index.events, { liveJobIds: live }),
      };
      // T16: which collection (and store) each recorded job wrote, for the
      // pin below — from the ingest_start events directly (one pass), and
      // the pin memo itself, so both die with this entry (review: an
      // unbounded map keyed by collection would pin old index objects).
      collections = new Map();
      for (const e of index.events) if (e.event === "ingest_start" && e.jobId) collections.set(e.jobId, { collection: e.collection ?? null, store: typeof e.store === "string" ? e.store : null });
      summaryCache.set(filePath, { index, version: index.version, liveKey, summary, collections, pins: new Map() });
    }
    const entry = summaryCache.get(filePath);
    return { filePath, index, live, summary, collections, pins: entry.pins };
  } catch (err) {
    return { filePath, index: null, live: new Set(), summary: { path: filePath ? path.relative(process.cwd(), filePath) : null, exists: null, error: String(err.message).slice(0, 500) }, collections: new Map(), pins: new Map() };
  }
}

/**
 * T16 (design §8): the embedding-space pin of the collection a job wrote —
 * the ledger's reducer, projected (name, dimension, whether it is
 * enforceable, the models the record names, the last reset). Additive on
 * the frame's `ledger` summary; read by nothing in the UI yet. Memoised on
 * the index object, its version and the collection.
 */
function pinView(view, jobId) {
  if (!view.index) return null;
  const job = (jobId && view.collections.get(jobId)) || (view.summary.lastJob?.jobId && view.collections.get(view.summary.lastJob.jobId)) || null;
  const collection = job?.collection || view.summary.lastJob?.collection || null;
  if (!collection) return null;
  const store = job?.store || null;
  const key = `${collection}|${store ?? ""}`;
  if (view.pins.has(key)) return view.pins.get(key);
  let pin = null;
  try {
    // Filtered by the store the job wrote (D10), like the two routes that
    // enforce the pin; the host itself is not projected onto the frame.
    const full = getCollectionPin(view.index.events, { collection, store: store ?? undefined });
    pin = full
      ? { collection, embedModel: full.embedModel, embedDim: full.embedDim, enforceable: full.enforceable, source: full.source, pinnedAt: full.pinnedAt, modelsSeen: full.modelsSeen, since: full.since }
      : null;
  } catch {
    pin = null;
  }
  view.pins.set(key, pin);
  return pin;
}

/**
 * Ingestion progress stream.
 *
 * T12/F-18: the stream is now KEYED BY JOB. `?jobId=` returns that job's state
 * and nothing else, so a caller can only ever read the job it started. Without
 * a jobId it falls back to the most recent job — the pre-T12 behaviour the
 * admin panel's EventSource still relies on, and the reason an automated driver
 * must always pass its own id: "status is no longer processing" is not evidence
 * about YOUR job unless the state you read is attributable to it.
 *
 * T07 (design D8): a job the process does not hold — evicted, or lost with
 * the pod — is looked up in the ledger. One that ended is answered with its
 * recorded terminal state; one that never ended is `interrupted` (the pod
 * died under it, E15's consequence). Both frames carry `reconstructed: true`
 * and the per-file results the events allow. An id the ledger never saw
 * stays 404 JOB_NOT_FOUND. Every frame gains `fileResults` (from the job)
 * and a `ledger` summary.
 */
export async function GET(request) {
  const jobId = request.nextUrl.searchParams.get("jobId");

  let reconstructed = null;
  if (jobId && !getJob(jobId)) {
    const view = ledgerView();
    const found = view.index ? jobsFrom(view.index.events, { liveJobIds: view.live }).find((j) => j.jobId === jobId) : null;
    if (!found) {
      return NextResponse.json(
        {
          success: false,
          code: INGEST_CODES.JOB_NOT_FOUND,
          error:
            `No ingestion job with id '${jobId}'. Jobs live in process memory and only the ` +
            "most recent few are retained; a pod restart clears them all, and the ingestion " +
            "ledger has no record of this id either.",
        },
        { status: 404 }
      );
    }
    reconstructed = snapshotFromLedgerJob(found);
  }

  const encoder = new TextEncoder();

  const customReadable = new ReadableStream({
    start(controller) {
      const interval = setInterval(() => {
        const view = ledgerView();
        const base = reconstructed ? reconstructed : snapshot(jobId ? getJob(jobId) : getCurrentJob());
        const summary = { ...view.summary, pin: pinView(view, base.jobId) };
        const frame = { ...base, ledger: summary };
        const data = `data: ${JSON.stringify(frame)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }, 300);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
      });
    }
  });

  return new Response(customReadable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    }
  });
}
