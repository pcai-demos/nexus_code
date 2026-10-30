import { NextResponse } from "next/server";
// T23 — the store credential through the one server-side seam (design D4).
import { resolveCredential } from "@/lib/credentials";
import path from "path";
import fs from "fs";
import { WeaviateClient } from "@/lib/vectordb/weaviate";
import { resolveSchemaVersion, collectionNameForVersion } from "@/lib/rag/config";
import { destructiveRefusal, thrownRefusal } from "@/lib/ingestion/destructive";
import { cropFoldersToPurge } from "@/lib/ingestion/crops";

export const dynamic = "force-dynamic";

/**
 * READ-ONLY preview of what `POST /api/ingest/clear` would do — ticket T21
 * (F-15). The Standards Drawer's typed-confirmation dialog shows this, so the
 * person confirming sees the collection's real object and document counts and
 * the two side effects (image purge, tracker reset) before typing its name.
 *
 * A separate URL, not a `dryRun` flag on the destructive route: a flag you can
 * forget is the wrong shape for a route whose failure mode is dropping a class.
 * Same 400 rules as clear. Uses the PLAIN client — nothing here can drop.
 *
 * Counts are honest or null: if Weaviate cannot be counted, `objectCount` and
 * `sourceCount` are null and `countError` says why. The dialog renders that as
 * "count unknown", never as 0.
 *
 * Cut-over (design D2 / D3): the class previewed is resolved from (name,
 * version) exactly as `clear` resolves it, and `collection` on the response
 * is that class — the name the dialog shows and the person must type (D3).
 */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const refusal = destructiveRefusal(body);
    if (refusal) {
      return NextResponse.json(
        { success: false, code: refusal.code, error: refusal.error },
        { status: refusal.status }
      );
    }
    const { weaviateUrl, token, mlisToken, weaviateCollection } = body;

    const schemaVersion = resolveSchemaVersion(body);
    // T23 (design D4): the request's field when set, else the env override,
    // else the pod's workload identity (design D3) — resolved on the store's URL.
    const authToken = resolveCredential({ url: weaviateUrl, requestValue: mlisToken || token }).value;
    const weaviateClient = new WeaviateClient(weaviateUrl, authToken, collectionNameForVersion(weaviateCollection, schemaVersion), { schemaVersion });

    let objectCount = null;
    let sourceCount = null;
    let countError = null;
    try {
      objectCount = await weaviateClient.countObjects();
      // getDatabaseSummary swallows its own failures into []. An empty summary
      // is only believable when the count is 0; otherwise it is "unknown".
      const summary = await weaviateClient.getDatabaseSummary();
      sourceCount = Array.isArray(summary) && (summary.length > 0 || objectCount === 0) ? summary.length : null;
    } catch (err) {
      countError = err.message;
    }

    // T22 (design D10, finding F-42): the crop folders a Tidy Up of THIS class
    // would delete — its own documents' folders, minus any document another
    // RAG class still holds. `extractedImageDirs` keeps its name (the dialog
    // shows it) but now counts what WOULD go, not what exists. Unknown hashes
    // (a failed read) mean nothing would be purged, and the reason says so.
    const extractedImagesDir = path.join(process.cwd(), "public", "extracted_images");
    let existingFolders = [];
    if (fs.existsSync(extractedImagesDir)) {
      existingFolders = fs.readdirSync(extractedImagesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    }
    let clearedHashes = null;
    let otherHashes = null;
    let hashReadError = null;
    try {
      clearedHashes = await weaviateClient.docHashes();
      otherHashes = await weaviateClient.docHashesInOtherRagClasses();
    } catch (err) {
      hashReadError = err.message;
    }
    const plan = cropFoldersToPurge({ clearedHashes, otherHashes, existingFolders });

    return NextResponse.json({
      success: true,
      collection: weaviateClient.className,
      schemaVersion,
      objectCount,
      sourceCount,
      countError,
      extractedImageDirs: plan.purge.length,
      imageFoldersToPurge: plan.purge,
      imageFoldersKept: plan.kept,
      imagePurgeSkippedReason: plan.reason ? `${plan.reason}${hashReadError ? ` (${hashReadError})` : ""}` : null,
      ingestionStateWillReset: true,
    });
  } catch (error) {
    const refusal = thrownRefusal(error);
    return NextResponse.json(
      { success: false, code: refusal.code, error: refusal.error },
      { status: refusal.status }
    );
  }
}
