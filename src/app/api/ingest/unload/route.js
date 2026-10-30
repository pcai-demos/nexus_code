import { NextResponse } from "next/server";
// T23 — the store credential through the one server-side seam (design D4).
import { resolveCredential } from "@/lib/credentials";
import path from "path";
import fs from "fs";
import { getParserForFile } from "@/lib/ingestion/parser";
import { WeaviateClient } from "@/lib/vectordb/weaviate";
import { resolveSchemaVersion, collectionNameForVersion } from "@/lib/rag/config";
import { sourceIdFor } from "@/lib/rag/ids";
import { INGEST_ERROR_CODES as INGEST_CODES } from "@/lib/ingestion/state";
import { destructiveRefusal, thrownRefusal } from "@/lib/ingestion/destructive";
import { appendEvent, defaultLedgerPath } from "@/lib/rag/ledger";
import { resolvePublicPath, PathOutsidePublicError } from "@/lib/ingestion/paths";

export const dynamic = "force-dynamic";

/** A path longer than this is not a document under public/ (review §6a). */
const MAX_SOURCE_ID_LENGTH = 4096;

/**
 * T07 (design D11): record the unload so the ledger's completion record for
 * this document is invalidated (a later `skip` would otherwise trust it).
 * Logged on failure, never a 500 — the delete happened.
 */
function recordUnloaded(fields) {
  try {
    appendEvent(defaultLedgerPath(), { event: "file_unloaded", ...fields });
  } catch (err) {
    console.error(`[Unload] ledger append failed: ${err.message}`);
  }
}

// T22 (design D11, finding F-59): the shared rule — under public/, or refused
// with a typed 400 before the file is read.
function resolvePath(filePath) {
  return resolvePublicPath(filePath);
}

/**
 * Delete one document's chunks from ONE named collection — ticket T21
 * (F-15). `weaviateCollection` is REQUIRED (400 COLLECTION_REQUIRED without
 * it); the pre-T21 default was "RAGChunk". A delete Weaviate refuses is a
 * typed 500, not "successfully unloaded".
 *
 * Schema v1 (the default): by the content hash of the file CURRENTLY on
 * disk, so the file must exist (404 FILE_NOT_FOUND) — byte-identical to T21.
 *
 * Schema v2 — ticket T06 (F-55, design D6), THE DEFAULT since the cut-over:
 * the version is resolved by the one shared function (top-level
 * `schemaVersion`, then `ragSettings.schemaVersion`, then the module default
 * — cut-over D1 / D2; `schemaVersion: 1` is the one-release override, D4),
 * the `V2` suffix applied as ingest applies it. The delete keys on the
 * document's `sourceId` (given, or derived from `filePath` by the same
 * normalisation ingest uses), removes EVERY version at that path, and does
 * not need the file on disk — which is what lets a renamed or moved file's
 * old name be unloaded. It is declared rather than introspected because the
 * v1 file check must run before any network call (I-DESTRUCT pins the 404
 * at a dead Weaviate port).
 */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const schemaVersion = resolveSchemaVersion(body ?? {});
    const hasSourceId = typeof body?.sourceId === "string" && body.sourceId.trim().length > 0;
    // Under v2 an explicit sourceId stands in for filePath; v1 needs the file.
    const required = schemaVersion === 2 && hasSourceId ? [] : ["filePath"];
    const refusal = destructiveRefusal(body, required);
    if (refusal) {
      return NextResponse.json(
        { success: false, code: refusal.code, error: refusal.error },
        { status: refusal.status }
      );
    }
    const { filePath, weaviateUrl, token: requestToken, weaviateCollection } = body;
    // T23 (design D4): the field when set, else the env override, else the
    // pod's workload identity (design D3) — resolved on the store's URL.
    const token = resolveCredential({ url: weaviateUrl, requestValue: requestToken }).value;

    if (schemaVersion === 2) {
      // A sourceId that is present but unusable is refused, never silently
      // replaced by filePath's identity (review §6a): a destructive request
      // must delete what the caller named or nothing.
      if (body.sourceId !== undefined && !hasSourceId) {
        return NextResponse.json(
          { success: false, code: INGEST_CODES.INGEST_CONFIG_MISSING, error: "sourceId must be a non-empty string when given." },
          { status: 400 }
        );
      }
      const named = hasSourceId ? body.sourceId : filePath;
      if (named.length > MAX_SOURCE_ID_LENGTH) {
        return NextResponse.json(
          { success: false, code: INGEST_CODES.INGEST_CONFIG_MISSING, error: `sourceId / filePath is longer than ${MAX_SOURCE_ID_LENGTH} characters.` },
          { status: 400 }
        );
      }
      let sourceId;
      try {
        sourceId = sourceIdFor(named);
      } catch (err) {
        return NextResponse.json(
          { success: false, code: INGEST_CODES.INGEST_CONFIG_MISSING, error: `Cannot unload: ${err.message}` },
          { status: 400 }
        );
      }
      const weaviateClient = WeaviateClient.forDestructiveOps(
        weaviateUrl,
        token,
        collectionNameForVersion(weaviateCollection, schemaVersion),
        { schemaVersion }
      );
      const result = await weaviateClient.deleteBySourceId(sourceId);
      if (!result.ok) {
        return NextResponse.json(
          {
            success: false,
            code: INGEST_CODES.DESTRUCTIVE_OP_FAILED,
            error:
              `The delete of every version of ${sourceId} from '${weaviateClient.className}' did not complete ` +
              `(HTTP ${result.status}` +
              (typeof result.matches === "number" ? `, matches ${result.matches}, failed ${result.failed}` : "") +
              `): ${String(result.body ?? "").slice(0, 500)}`,
          },
          { status: 500 }
        );
      }
      recordUnloaded({ collection: weaviateClient.className, schemaVersion, sourceId, matches: typeof result.matches === "number" ? result.matches : null });
      return NextResponse.json({
        success: true,
        collection: weaviateClient.className,
        sourceId,
        deleted: typeof result.matches === "number" ? result.matches : null,
        message:
          `Every version of ${sourceId} unloaded from '${weaviateClient.className}'` +
          (typeof result.matches === "number" ? ` (${result.matches} object(s))` : "") +
          ".",
      });
    }

    let resolved;
    try {
      resolved = resolvePath(filePath);
    } catch (err) {
      if (err instanceof PathOutsidePublicError) {
        return NextResponse.json({ success: false, code: err.code, error: err.message }, { status: err.status });
      }
      throw err;
    }
    if (!fs.existsSync(resolved)) {
      return NextResponse.json(
        { success: false, code: INGEST_CODES.FILE_NOT_FOUND, error: `File not found: ${filePath}` },
        { status: 404 }
      );
    }

    const buffer = fs.readFileSync(resolved);
    const parser = getParserForFile(filePath, buffer);
    const docHash = parser.docHash;

    // v1 (the override): the unsuffixed class, exactly as before the cut-over.
    const weaviateClient = WeaviateClient.forDestructiveOps(weaviateUrl, token, collectionNameForVersion(weaviateCollection, schemaVersion), { schemaVersion });
    const result = await weaviateClient.deleteByHash(docHash);
    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          code: INGEST_CODES.DESTRUCTIVE_OP_FAILED,
          error:
            `The delete of ${path.basename(filePath)}'s chunks from '${weaviateClient.className}' did not complete ` +
            `(HTTP ${result.status}` +
            (typeof result.matches === "number" ? `, matches ${result.matches}, failed ${result.failed}` : "") +
            `): ${result.body}`,
        },
        { status: 500 }
      );
    }

    let v1SourceId = null;
    try {
      v1SourceId = sourceIdFor(filePath);
    } catch {
      /* an identity the normaliser refuses: the event keys on docHash alone */
    }
    recordUnloaded({ collection: weaviateClient.className, schemaVersion: 1, sourceId: v1SourceId, docHash, fileName: path.basename(filePath), matches: typeof result.matches === "number" ? result.matches : null });
    return NextResponse.json({
      success: true,
      collection: weaviateClient.className,
      message: `Document ${path.basename(filePath)} successfully unloaded from '${weaviateClient.className}'.`,
    });
  } catch (error) {
    const refusal = thrownRefusal(error);
    return NextResponse.json(
      { success: false, code: refusal.code, error: refusal.error },
      { status: refusal.status }
    );
  }
}
