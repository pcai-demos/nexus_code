import { NextResponse } from "next/server";
// T23 — the store credential through the one server-side seam (design D4).
import { resolveCredential } from "@/lib/credentials";
import path from "path";
import fs from "fs";
import { WeaviateClient } from "@/lib/vectordb/weaviate";
import { resolveSchemaVersion, collectionNameForVersion } from "@/lib/rag/config";
import ingestionState, { INGEST_ERROR_CODES as INGEST_CODES } from "@/lib/ingestion/state";
import { destructiveRefusal, thrownRefusal } from "@/lib/ingestion/destructive";
import { appendEvent, defaultLedgerPath } from "@/lib/rag/ledger";
import { cropFoldersToPurge } from "@/lib/ingestion/crops";

export const dynamic = "force-dynamic";

/**
 * Drop and recreate ONE named collection, reset the legacy ingestion-state
 * view, and purge the extracted image crops — ticket T21 (F-15, E38).
 *
 * `weaviateCollection` is REQUIRED (400 COLLECTION_REQUIRED without it). Before
 * this ticket the route defaulted to "RAGChunk", and the client constructor
 * laundered null into the same literal, so a request naming nothing dropped
 * the production class — reproduced live 2026-09-03. `POST /api/ingest` keeps
 * its default on purpose (owner decision, session 5); this route does not.
 *
 * The steps run in this order and stop at the first failure: count (best
 * effort) → drop + recreate → reset state → purge images. A failure after the
 * drop reports `completed` so the caller knows what did happen (F-25's lesson:
 * never lose a result while describing it).
 *
 * Cut-over (design D2, findings F-62 / F-71): the class dropped is resolved
 * from (name, version) by the one shared function — top-level
 * `schemaVersion`, then `ragSettings.schemaVersion`, then the module default
 * (2) — and the destructive client is built WITH that version, so the
 * recreate has the shape the version needs (a v2 class recreated in the v1
 * shape refused the next v2 ingest — F-71, measured). The response's
 * `collection` and the ledger's `collection_cleared` name the class actually
 * dropped and carry the version. The NAME still has no default (T21).
 */
export async function POST(req) {
  const completed = [];
  try {
    // A malformed body is a client error, not a failed drop.
    const body = await req.json().catch(() => null);
    const refusal = destructiveRefusal(body);
    if (refusal) {
      return NextResponse.json(
        { success: false, code: refusal.code, error: refusal.error },
        { status: refusal.status }
      );
    }
    const { weaviateUrl, token, mlisToken, weaviateCollection } = body;

    // T23 (design D4): the request's field when set, else the env override,
    // else the pod's workload identity (design D3) — resolved on the store's URL.
    const authToken = resolveCredential({ url: weaviateUrl, requestValue: mlisToken || token }).value;
    const schemaVersion = resolveSchemaVersion(body);
    const weaviateClient = WeaviateClient.forDestructiveOps(
      weaviateUrl,
      authToken,
      collectionNameForVersion(weaviateCollection, schemaVersion),
      { schemaVersion }
    );
    // Review §11b (R2 / R3): an optional `confirmCollection` — the class the
    // caller was SHOWN (the preview's `collection`, the name the person
    // typed) — must be the class this request resolves, or nothing is
    // dropped. A caller that sends none gets T21's behaviour unchanged.
    if (body.confirmCollection !== undefined && body.confirmCollection !== weaviateClient.className) {
      return NextResponse.json(
        {
          success: false,
          code: INGEST_CODES.CONFIRM_MISMATCH,
          error:
            `Refused: the confirmation names '${String(body.confirmCollection).slice(0, 200)}' but this request resolves to ` +
            `'${weaviateClient.className}' (collection '${weaviateCollection}', schemaVersion ${schemaVersion}). Nothing was dropped.`,
          completed,
        },
        { status: 400 }
      );
    }

    // What is about to be dropped — reported, never gated on. Unknown stays
    // null rather than becoming a fabricated 0.
    let droppedObjectCount = null;
    try {
      droppedObjectCount = await weaviateClient.countObjects();
    } catch (err) {
      console.warn(`[Clean Up] Could not count '${weaviateClient.className}' before dropping it: ${err.message}`);
    }

    // T22 (design D10, finding F-42): which crop folders this Tidy Up may
    // delete is decided BEFORE the drop, from the store — the cleared class's
    // document hashes, minus every hash another RAG class still holds. A
    // failed read leaves the hashes unknown, and unknown purges nothing.
    let clearedHashes = null;
    let otherHashes = null;
    let hashReadError = null;
    try {
      clearedHashes = await weaviateClient.docHashes();
      otherHashes = await weaviateClient.docHashesInOtherRagClasses();
    } catch (err) {
      hashReadError = err.message;
      console.warn(`[Clean Up] Could not read document hashes for the crop purge (nothing will be purged): ${err.message}`);
    }

    const { dropped } = await weaviateClient.clearSchema();
    completed.push(dropped ? "drop" : "drop (collection was absent)", "recreate");

    // T07 (T21's deferred `collection_cleared` event, design D11): the ledger
    // records the drop so a later skip cannot trust a completion record for
    // a collection that was emptied. A failed append is logged, never a 500:
    // the drop happened, and reporting it as failed would be the F-25 lie
    // the other way round.
    try {
      appendEvent(defaultLedgerPath(), { event: "collection_cleared", collection: weaviateClient.className, schemaVersion, dropped, droppedObjectCount });
    } catch (err) {
      console.error(`[Clean Up] ledger append failed for '${weaviateClient.className}': ${err.message}`);
    }

    // Reset the legacy ingestion-state view (the most-recent-job mirror, F-18)
    ingestionState.status = "idle";
    ingestionState.currentFile = "";
    ingestionState.progressPercent = 0;
    ingestionState.elapsedSeconds = 0;
    ingestionState.etaSeconds = 0;
    ingestionState.chunksIndexed = 0;
    ingestionState.totalFiles = 0;
    ingestionState.filesCompleted = 0;
    ingestionState.cancelled = false;
    ingestionState.error = null;
    ingestionState.doclingTraces = [];
    completed.push("resetIngestionState");

    // T22 (design D10, finding F-42): purge ONLY the crop folders whose
    // document this collection held and no other RAG class still holds.
    // Before T22 the whole directory went, whatever class was cleared — and
    // with the directory persistent (design D9) that would have deleted the
    // production corpus's images on any Tidy Up of an eval class.
    const extractedImagesDir = path.join(process.cwd(), "public", "extracted_images");
    let existingFolders = [];
    if (fs.existsSync(extractedImagesDir)) {
      existingFolders = fs.readdirSync(extractedImagesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    }
    const plan = cropFoldersToPurge({ clearedHashes, otherHashes, existingFolders });
    const imageFoldersPurged = [];
    for (const folder of plan.purge) {
      try {
        fs.rmSync(path.join(extractedImagesDir, folder), { recursive: true, force: true });
        imageFoldersPurged.push(folder);
      } catch (err) {
        console.warn(`[Clean Up] Could not remove crop folder '${folder}': ${err.message}`);
      }
    }
    const imagesPurged = imageFoldersPurged.length > 0;
    if (imagesPurged) console.log(`[Clean Up] Purged ${imageFoldersPurged.length} crop folder(s) that only '${weaviateClient.className}' used: ${imageFoldersPurged.join(", ")}.`);
    completed.push("purgeImages");

    return NextResponse.json({
      success: true,
      collection: weaviateClient.className,
      schemaVersion,
      dropped,
      droppedObjectCount,
      imagesPurged,
      imageFoldersPurged,
      imageFoldersKept: plan.kept,
      imagePurgeSkippedReason: plan.reason ? `${plan.reason}${hashReadError ? ` (${hashReadError})` : ""}` : null,
      ingestionStateReset: true,
      completed,
      message: `Collection '${weaviateClient.className}' ` +
        (dropped ? "dropped and recreated empty" : "did not exist; created empty") +
        (dropped && droppedObjectCount !== null ? ` (${droppedObjectCount} objects)` : "") +
        `; extracted diagram crops: ${imagesPurged ? `${imageFoldersPurged.length} folder(s) only this collection used purged` : plan.reason ? `none purged — ${plan.reason}` : "none belonged only to this collection"}` +
        (plan.kept.length ? ` (${plan.kept.length} kept)` : "") +
        `; local ingestion tracker reset.`,
    });
  } catch (error) {
    const refusal = thrownRefusal(error);
    // A throw from clearSchema after the drop carries what DID happen (F-25).
    if (Array.isArray(error?.completed)) completed.push(...error.completed);
    console.error(`[Clean Up] ${refusal.code}: ${refusal.error}`);
    return NextResponse.json(
      { success: false, code: refusal.code, error: refusal.error, completed },
      { status: refusal.status }
    );
  }
}
