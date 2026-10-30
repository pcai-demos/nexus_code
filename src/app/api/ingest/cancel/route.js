import { NextResponse } from "next/server";
import {
  INGEST_ERROR_CODES as INGEST_CODES,
  getJob,
  activeJob,
  syncLegacyView,
} from "@/lib/ingestion/state";

export const dynamic = "force-dynamic";

/**
 * Cancel an ingestion job.
 *
 * T12/F-18: cancellation is addressed to a job. With a `jobId` it cancels that
 * job; without one it cancels whichever job is currently running, which is the
 * pre-T12 behaviour the admin panel's cancel button relies on. Pre-T12 this set
 * `status = "idle"` on the shared singleton, so it could silently stop a job
 * the caller had never started.
 *
 * T07/F-63 (design D7): this route only ASKS. It sets the flag and answers
 * `status: "cancelling"`; the job stays `processing` — and holds the
 * concurrency lock — until the worker has seen the flag, let its in-flight
 * batches land, recorded what landed, and written `cancelled` itself.
 * Before T07 this route called finishJob: the job read "cancelled" 111 ms
 * after the click, a second ingest of the same file was accepted 318 ms
 * later, and 16 objects of the "finished" job landed after that (measured,
 * t07-artifacts). A cancel is not a stop; the status now says so.
 */
export async function POST(request) {
  let jobId = null;
  try {
    const body = await request.json();
    jobId = body?.jobId || null;
  } catch {
    /* no body — cancel the running job */
  }

  const job = jobId ? getJob(jobId) : activeJob();

  if (jobId && !job) {
    return NextResponse.json(
      {
        success: false,
        code: INGEST_CODES.JOB_NOT_FOUND,
        error: `No ingestion job with id '${jobId}'.`,
      },
      { status: 404 }
    );
  }

  if (!job) {
    return NextResponse.json({
      success: true,
      cancelled: false,
      message: "No ingestion job is currently running.",
    });
  }

  if (job.status !== "processing") {
    return NextResponse.json({
      success: true,
      cancelled: false,
      jobId: job.jobId,
      status: job.status,
      message: `Ingestion job ${job.jobId} has already finished (${job.status}).`,
    });
  }

  // The worker checks this flag before each parse and between batch slices.
  job.cancelled = true;
  job.etaSeconds = 0;
  syncLegacyView();

  return NextResponse.json({
    success: true,
    cancelled: true,
    jobId: job.jobId,
    status: "cancelling",
    message: "Cancellation requested. The job finishes when its in-flight batches have landed; poll its status for 'cancelled'.",
  });
}
