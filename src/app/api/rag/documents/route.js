import { NextResponse } from "next/server";
import { WeaviateClient } from "@/lib/vectordb/weaviate";
import { resolveSchemaVersion, collectionNameForVersion } from "@/lib/rag/config";
import { resolveCredential } from "@/lib/credentials";

// Allow self-signed certs for internal cluster endpoints

/**
 * T15 (design D11; F-115) — the documents the store holds, for the chat
 * composer's scope selector. READ-ONLY: one Aggregate, no write path, no
 * destructive client. A POST with the page's settings (not a GET: the
 * store credential, when a presenter typed one, must not travel in a query
 * string — F-104's lesson); the body names the store the way every other
 * reader does — the class resolves through resolveSchemaVersion and
 * collectionNameForVersion (cut-over D2; U-DESTRUCT's rule for a new
 * reader), the credential through T23's seam.
 *
 * Response: { collection, schemaVersion, documents: [{ source, sourceIds,
 * chunkCount, totalPages }] } — `sourceIds` is the v2 identity the scope
 * pre-filter keys on (empty on a v1 class).
 */
export async function POST(request) {
  try {
    const body = (await request.json().catch(() => ({}))) || {};
    const weaviateUrl = body.weaviateUrl || "http://weaviate.hpe-weaviate.svc.cluster.local:80";
    const schemaVersion = resolveSchemaVersion(body);
    const weaviateCollection = body.weaviateCollection || body.ragSettings?.weaviateCollection || "RAGChunk";
    const authToken = resolveCredential({ url: weaviateUrl, requestValue: body.mlisToken || body.token || "" }).value;
    const weaviateClient = new WeaviateClient(weaviateUrl, authToken, collectionNameForVersion(weaviateCollection, schemaVersion), { schemaVersion });
    const documents = await weaviateClient.getDocumentSummary();
    return NextResponse.json({
      success: true,
      collection: weaviateClient.className,
      schemaVersion,
      documents: (documents || [])
        .map((d) => ({ source: d.source, sourceIds: Array.isArray(d.sourceIds) ? d.sourceIds : [], chunkCount: d.chunkCount ?? 0, totalPages: d.totalPages ?? 0 }))
        .sort((a, b) => String(a.source).localeCompare(String(b.source))),
    });
  } catch (error) {
    console.error("[RAG Documents API Error]:", error);
    return NextResponse.json({ success: false, error: "Internal server error: " + error.message, documents: [] }, { status: 500 });
  }
}
