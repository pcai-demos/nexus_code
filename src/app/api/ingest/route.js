import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getParserForFile } from "@/lib/ingestion/parser";
import { ENGINE_IDS } from "@/lib/ingestion/engines";
import { CHAIN_COUNT_KEYS } from "@/lib/ingestion/dimension_chain";
import { WeaviateClient } from "@/lib/vectordb/weaviate";
import { resolveSchemaVersion, collectionNameForVersion, checkEmbedModelPinForIngest } from "@/lib/rag/config";
import {
  appendEvent,
  defaultLedgerPath,
  getIndex,
  revalidateIndex,
  latestFileOutcome,
  isRecordedComplete,
  getCollectionPin,
  storeOriginOf,
  shouldCompact,
  compact,
} from "@/lib/rag/ledger";
import {
  newFileResult,
  isTerminalFileStatus,
  SKIP_REASONS,
  REINDEX_REASONS,
  jobStatusFrom,
  jobErrorFrom,
  jobErrorCodeFor,
  fileCountsFrom, PARTIAL_REASONS } from "@/lib/ingestion/outcomes";
import ingestionState, {
  INGEST_ERROR_CODES as INGEST_CODES,
  createJob,
  activeJob,
  finishJob,
  syncLegacyView,
} from "@/lib/ingestion/state";
import { resolvePublicPath, PathOutsidePublicError } from "@/lib/ingestion/paths";
// T23 — the embed, store and captioner credentials through the one server-side seam (design D4).
import { resolveCredential } from "@/lib/credentials";
import { isLiteLlmUrl, ollamaBackend } from "@/lib/models/litellm_backends";

export const dynamic = "force-dynamic";

// T22 (design D11, finding F-59): one rule for a request's file path, shared
// with the unload route — under public/, or refused. Every path is checked
// before the job starts (below), so this call cannot throw inside the worker.
function resolvePath(filePath) {
  return resolvePublicPath(filePath);
}

function translateToInternalUrl(urlText) {
  const url = urlText.trim();
  const headers = {};
  let result = { url, headers };
  
  if (url.includes("rerank.project-demos.serving.demo.lon-pcai.twlon.com")) {
    headers["Host"] = "rerank.project-demos.serving.demo.lon-pcai.twlon.com";
    result = {
      url: url.replace("https://rerank.project-demos.serving.demo.lon-pcai.twlon.com", "http://rerank.project-demos.svc.cluster.local:80"),
      headers
    };
  } else if (url.includes("nemotron.project-demos.serving.demo.lon-pcai.twlon.com")) {
    headers["Host"] = "nemotron.project-demos.serving.demo.lon-pcai.twlon.com";
    result = {
      url: url.replace("https://nemotron.project-demos.serving.demo.lon-pcai.twlon.com", "http://nemotron.project-demos.svc.cluster.local:80"),
      headers
    };
  } else if (url.includes("ollama.demo.lon-pcai.twlon.com")) {
    result = {
      url: url.replace("https://ollama.demo.lon-pcai.twlon.com", "http://ollama.ollama.svc.cluster.local:11434"),
      headers: {}
    };
  }
  
  console.log(`[translateToInternalUrl] Input: "${urlText}" -> Output: "${result.url}" (Headers: ${JSON.stringify(result.headers)})`);
  return result;
}

// Helper to query HPE MLIS Embeddings API in batch
async function getEmbeddingsBatch(texts, embedUrl, modelName, token) {
  let targetUrl = embedUrl.trim();
  if (!targetUrl.endsWith("/embeddings") && !targetUrl.endsWith("/v1/embeddings")) {
    const cleanUrl = targetUrl.endsWith("/") ? targetUrl.slice(0, -1) : targetUrl;
    if (cleanUrl.endsWith("/v1")) {
      targetUrl = `${cleanUrl}/embeddings`;
    } else {
      targetUrl = `${cleanUrl}/v1/embeddings`;
    }
  }

  const { url: internalUrl, headers: internalHeaders } = translateToInternalUrl(targetUrl);

  const headers = {
    "Content-Type": "application/json",
    ...internalHeaders
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }

  const payload = {
    model: modelName.trim(),
    input: texts
  };

  const res = await fetch(internalUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding API failure: ${errText || res.statusText}`);
  }

  const data = await res.json();
  const results = data?.data;
  if (!results || !Array.isArray(results)) {
    throw new Error("Invalid embedding response format.");
  }
  
  const sorted = [...results].sort((a, b) => (a.index || 0) - (b.index || 0));
  return sorted.map(item => item.embedding);
}

export async function POST(req) {
  try {
    const body = await req.json();
    // T23: the request's own credential fields, resolved through the seam below
    // once the identity fields are validated; `token` / `weaviateToken` past
    // that point are the RESOLVED values (the page's defaults are empty now).
    const { filePaths, weaviateUrl, token: requestToken, weaviateToken: requestWeaviateToken, embedUrl, embedModel, ragSettings } = body;
    // T17 (design D11, F-85): the VLM trio arrives TOP-LEVEL like the embed
    // pair (identity fields — `vlmModelName` is in docVersion's fingerprint,
    // T05), is merged into the parser's config with top-level precedence over
    // the blob (the resolver's rule), and the endpoint goes through the same
    // ingress→in-cluster translation the embed URL gets. Before T17 the admin
    // panel's VLM fields fed /api/vlm-test only and every ingest captioned
    // with the parser's own defaults. Absent or empty: the parser's fallbacks,
    // as before, for callers that send none.
    const vlmOverrides = {};
    if (typeof body.vlmModelName === "string" && body.vlmModelName.trim()) vlmOverrides.vlmModelName = body.vlmModelName.trim();
    if (typeof body.vlmEndpointUrl === "string" && body.vlmEndpointUrl.trim()) vlmOverrides.vlmEndpointUrl = translateToInternalUrl(body.vlmEndpointUrl).url;
    // T23 (design D4): the captioner's key — the field when typed, else the env
    // token bound to the VLM endpoint's origin (none for the Ollama default).
    const vlmCred = resolveCredential({ url: body.vlmEndpointUrl, requestValue: typeof body.vlmApiKey === "string" ? body.vlmApiKey : "" });
    if (vlmCred.value) vlmOverrides.vlmApiKey = vlmCred.value;
    // D31 (2026-10-30): the VLM is a LiteLLM model, but the captioner speaks Ollama's own API (keep_alive, the model
    // digest in its memo key). A LiteLLM model that runs on Ollama captions on THAT Ollama under its underlying name —
    // the same server and model as before, so docVersion fingerprints and memo keys do not move — and no LiteLLM key
    // travels there. A model that is not Ollama-backed cannot caption: the ingest is refused with what to change.
    if (typeof body.vlmEndpointUrl === "string" && isLiteLlmUrl(body.vlmEndpointUrl) && (ragSettings || {}).captionFigures !== false) {
      const vlmName = vlmOverrides.vlmModelName || "";
      const backend = await ollamaBackend(vlmName, { token: typeof body.vlmApiKey === "string" ? body.vlmApiKey : "" }).catch(() => null);
      if (!backend) {
        return NextResponse.json(
          {
            success: false,
            code: INGEST_CODES.INGEST_CONFIG_MISSING,
            error: `Figure captioning needs an Ollama-backed vision model, and "${vlmName}" is not one (LiteLLM /model/info). Pick one in the RAG settings, or turn Caption Figures off.`,
          },
          { status: 400 }
        );
      }
      vlmOverrides.vlmEndpointUrl = backend.origin;
      vlmOverrides.vlmModelName = backend.model;
      delete vlmOverrides.vlmApiKey;
    }
    const config = { ...(ragSettings || {}), ...vlmOverrides };

    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return NextResponse.json(
        { success: false, code: INGEST_CODES.INGEST_CONFIG_MISSING, error: "No files specified for ingestion." },
        { status: 400 }
      );
    }
    // T22 (design D11, finding F-59): every path must resolve under public/
    // BEFORE anything is read or started. `..` used to reach the repository
    // root; the allow-list of extensions was the only guard.
    for (const p of filePaths) {
      try {
        resolvePublicPath(p);
      } catch (err) {
        if (err instanceof PathOutsidePublicError) {
          return NextResponse.json({ success: false, code: err.code, error: err.message }, { status: err.status });
        }
        throw err;
      }
    }
    if (!weaviateUrl) {
      return NextResponse.json(
        { success: false, code: INGEST_CODES.INGEST_CONFIG_MISSING, error: "Weaviate endpoint URL is required." },
        { status: 400 }
      );
    }
    if (!embedUrl || !embedModel) {
      return NextResponse.json(
        { success: false, code: INGEST_CODES.INGEST_CONFIG_MISSING, error: "Embedding endpoint configuration is required." },
        { status: 400 }
      );
    }
    // T23 (design D4): a non-empty request value wins; else the env token
    // bound to that URL's origin; else (the store only) the pod's workload
    // identity; else nothing. The page's ingest body sends `token:
    // embedApiKey` and `weaviateToken: mlisToken` — both empty since T23 —
    // so the demo's own ingest runs on the server's credentials, and the
    // 202 below says which source served each hop.
    const embedCred = resolveCredential({ url: embedUrl, requestValue: requestToken });
    const weaviateCred = resolveCredential({ url: weaviateUrl, requestValue: requestWeaviateToken || requestToken });
    const token = embedCred.value;
    const weaviateToken = weaviateCred.value;

    // F-18: a second concurrent ingest is REFUSED, not interleaved. Two jobs
    // sharing one state produced a run that reported another job's completion
    // (`chunksIndexed: 80`) while its own collection held 0 objects, and a
    // two-file ingest that accumulated four docling traces. Refusing is what
    // actually prevents the overlapping writes; queueing would only defer them.
    // T07 (F-63): the lock now holds until the worker has finished — a
    // cancelled job's in-flight batches are still writes.
    const running = activeJob();
    if (running) {
      return NextResponse.json(
        {
          success: false,
          code: INGEST_CODES.INGEST_IN_PROGRESS,
          error:
            `An ingestion job is already running (started ${running.startedAt}, ` +
            `${running.filesCompleted}/${running.totalFiles} files complete` +
            (running.cancelled ? ", cancelling — its in-flight batches have not landed yet" : "") +
            "). Wait for it to finish or cancel it before starting another.",
          activeJobId: running.jobId,
        },
        { status: 409 }
      );
    }

    // T16 (design D3 / D4 / D5 / D6): the embedding-space pin, checked at
    // REQUEST level, before a job exists. Under v2 an embed-model change is
    // a skip (the model is not in docVersion's fingerprint), so a check
    // after the skip decision never fires; and the whole request is in the
    // wrong space, so a per-file refusal after minutes of captioning would
    // say what this says in a millisecond (both measured, t16-artifacts §0:
    // 367 ms of `already_indexed`, then 427 s to a Weaviate refusal). The
    // pin is DERIVED from the ledger and the store's live dimension is read
    // first, so a ledger that has fallen behind the store cannot lock anyone
    // out. Nothing is recorded for a refused request — there is no job —
    // and the class name is resolved exactly as the worker resolves it.
    const pinCollection = ragSettings?.weaviateCollection || body.weaviateCollection || "RAGChunk";
    const pinClassName = collectionNameForVersion(WeaviateClient.canonicalClassName(pinCollection), resolveSchemaVersion(body));
    const pinRefusal = await embedModelPinRefusal({ ledgerPath: defaultLedgerPath(), className: pinClassName, weaviateUrl, weaviateToken: weaviateToken || token, embedModel });
    if (pinRefusal) {
      return NextResponse.json(
        { success: false, code: pinRefusal.code, error: pinRefusal.message, pin: pinRefusal.pin },
        { status: 409 }
      );
    }
    // The pin check awaited the store, which opens a window inside F-18's
    // lock (review): two requests arriving within that window would both
    // have passed `activeJob()` above. Re-check before the job is created.
    if (activeJob()) {
      return NextResponse.json(
        {
          success: false,
          code: INGEST_CODES.INGEST_IN_PROGRESS,
          error: "An ingestion job started while this request was being checked against the collection's embedding-space pin. Wait for it to finish or cancel it before starting another.",
          activeJobId: activeJob().jobId,
        },
        { status: 409 }
      );
    }

    // Every job gets an identity, so a caller can correlate the state it reads
    // with the job it started.
    const job = createJob(filePaths.length);
    // T07 (F-49 / E16, design D5): one outcome per request path, in request
    // order, from the first frame on. Every entry ends in a terminal status
    // with a reason; `filesCompleted` counts exactly those.
    job.fileResults = filePaths.map((filePath) =>
      newFileResult({ filePath: String(filePath), fileName: path.basename(String(filePath)) })
    );
    syncLegacyView();

    // Start timer incrementing in background
    const timer = setInterval(() => {
      if (job.status === "processing") {
        job.elapsedSeconds += 1;
        syncLegacyView();
      } else {
        clearInterval(timer);
      }
    }, 1000);

    // Run ingestion in background so we return a 202 immediately
    (async () => {
      // The WRITE path keeps its "RAGChunk" default by owner decision (session
      // 5): an unspecified write landing in the demo's own collection is
      // intended. T21 changed only the construction: the overwrite path below
      // calls deleteByHash(), which now runs only on a client built for
      // destructive operations, and that factory demands an EXACT name. So the
      // name is canonicalised here first — the same sanitising the plain
      // constructor always did — which keeps ingest's class resolution
      // byte-identical to before T21 while the delete is explicit at the site.
      const collection = ragSettings?.weaviateCollection || body.weaviateCollection || "RAGChunk";
      // T05: schemaVersion 2 writes the `V2` class (canonical name + suffix,
      // applied AFTER canonicalisation and BEFORE the factory, so
      // `RAGEval_x` → `RAGEval_xV2`). Since the cut-over (design D1 / D2)
      // the version is resolved by the one shared function — top-level, then
      // ragSettings, then the module default, now 2 — so a request naming
      // no version writes the `V2` class; `schemaVersion: 1` is the
      // one-release override (D4). The production `RAGChunkV2` was created
      // by the cut-over's migration (D7), not by this route's default alone.
      const schemaVersion = resolveSchemaVersion(body);
      const className = collectionNameForVersion(WeaviateClient.canonicalClassName(collection), schemaVersion);
      const duplicatePolicy = config.duplicatePolicy || "skip";

      // T07: the ledger (src/lib/rag/ledger.js) is the durable record of this
      // job. An append that fails is logged and surfaced on the job as
      // `ledgerError`; it never stops the ingest — the store is the truth,
      // the ledger describes it (design §2, §3).
      const ledgerPath = defaultLedgerPath();
      // T16 (design D10): every event of the job names the Weaviate origin
      // it was written against — protocol + host, never the raw URL — so a
      // second store sharing a class name never inherits this one's pin.
      const store = storeOriginOf(weaviateUrl);
      const record = (event) => {
        try {
          appendEvent(ledgerPath, boundEvent({ collection: className, schemaVersion, store, jobId: job.jobId, ...event }));
        } catch (err) {
          if (!job.ledgerError) {
            job.ledgerError = `ledger append failed (${path.relative(process.cwd(), ledgerPath)}): ${clip(err.message, 500)}`;
            syncLegacyView();
          }
          console.error("[Ledger] append failed:", err.message);
        }
      };
      const completeFile = () => {
        job.filesCompleted += 1;
        syncLegacyView();
      };
      // Measured from the first vector this job embeds; null until then.
      let embedDim = null;

      try {
        record({
          event: "ingest_start",
          duplicatePolicy,
          embedModel,
          embedHost: embedHostOf(embedUrl),
          // T23: which credential source served each hop (names only).
          credentialSources: { embed: embedCred.source, weaviate: weaviateCred.source, vlm: vlmCred.source },
          files: filePaths.map((f) => String(f)),
          fileCount: filePaths.length,
        });

        // The name is canonicalised inline here (U-DESTRUCT pins that the
        // factory receives canonicalClassName's result); `className` above is
        // the same expression, computed once for the ledger events.
        const weaviateClient = WeaviateClient.forDestructiveOps(
          weaviateUrl,
          weaviateToken || token,
          collectionNameForVersion(WeaviateClient.canonicalClassName(collection), schemaVersion),
          { schemaVersion }
        );
        await weaviateClient.ensureSchema();
        if (weaviateClient.lastEnsureSchema?.created) {
          // T16's pin: the model this collection was first written with. The
          // dimension is recorded on the first file_indexed (it is measured).
          record({ event: "collection_created", embedModel });
        }

        // 1. Pre-parse all files to calculate total chunk counts and check Weaviate caches.
        //    T07 (D5): each file's failure is ITS OWN — recorded, counted, and
        //    the batch continues (T04's salvaged isolation). Before T07 a
        //    missing file, an oversize file, a parse throw or a duplicate-check
        //    throw failed the whole job and discarded every earlier file's
        //    parsed work (F-52), with an error that named no file (F-49).
        const filesToProcess = [];
        let totalChunks = 0;
        const allowedTypes = (config.allowedFileTypes || ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX"]).map(t => `.${String(t).toLowerCase()}`);

        for (let i = 0; i < filePaths.length; i++) {
          const filePath = String(filePaths[i]);
          const fr = job.fileResults[i];

          // T07 (F-52, D7): phase 1 honours the cancel — the remaining files
          // are not parsed. Before T07 a cancel during captioning kept
          // captioning for minutes.
          if (job.cancelled) {
            fr.status = "cancelled";
            fr.reason = SKIP_REASONS.CANCELLED;
            record({ event: "file_skipped", filePath, fileName: fr.fileName, reason: SKIP_REASONS.CANCELLED, detail: "cancelled before parsing" });
            completeFile();
            continue;
          }

          // Enforce Allowed File Types. T07 (E16): the skip is a per-file
          // outcome the person can see, not a console line.
          const ext = path.extname(filePath).toLowerCase();
          if (!allowedTypes.includes(ext)) {
            console.log(`[Ingestion Filter] Skipping file ${filePath} because extension is not in allowed list.`);
            fr.status = "skipped";
            fr.reason = SKIP_REASONS.NOT_ALLOWED_TYPE;
            fr.error = `${ext || "(no extension)"} is not an allowed file type (${allowedTypes.join(", ")})`;
            record({ event: "file_skipped", filePath, fileName: fr.fileName, reason: SKIP_REASONS.NOT_ALLOWED_TYPE, detail: fr.error });
            completeFile();
            continue;
          }

          // F-49: the person sees which file is being parsed (this was empty
          // for the whole of phase 1 — 236 s measured).
          fr.status = "parsing";
          job.currentFile = fr.fileName;
          syncLegacyView();

          try {
            const resolved = resolvePath(filePath);
            if (!fs.existsSync(resolved)) {
              throw new Error(`Document file does not exist on disk: ${filePath}`);
            }

            // Enforce Max File Size (in MB)
            const stats = fs.statSync(resolved);
            const sizeMb = stats.size / (1024 * 1024);
            const maxLimit = config.maxFileSize || 25;
            if (sizeMb > maxLimit) {
              throw new Error(`File ${filePath} exceeds the maximum size limit of ${maxLimit}MB (file is ${sizeMb.toFixed(2)}MB).`);
            }

            const buffer = fs.readFileSync(resolved);
            const parser = getParserForFile(filePath, buffer, config, resolved);
            // T29: the job's id travels with the parser (not a setting), so a
            // caption memo record can say which ingest made it.
            parser.ingestJobId = job.jobId;

            if (parser.profile) {
              job.lastProfile = parser.profile;
              job.lastMetrics = parser.profileMetrics;
            }
            fr.sourceId = parser.sourceId;
            fr.docVersion = parser.docVersion;

            // Respect Duplicate Policy (skip vs overwrite)
            // T05 (F-50): under v2 the duplicate check keys on the same identity
            // the objects carry — this sourceId at this docVersion — so a renamed
            // file or a changed chunk setting is re-indexed, not skipped. v1
            // keeps T03's content-hash check unchanged.
            // T07 (F-48 / F-61, design D4), v2 only: presence is not
            // completeness. The skip needs the ledger's record that this
            // version was written WHOLE (n chunks) AND the store holding
            // exactly those n (count n, highest chunkIndex n-1); anything
            // else re-indexes — the upsert completes the version and the
            // supersede cleans up — and the outcome says why.
            let alreadyIndexed = false;
            let decision = null;
            if (duplicatePolicy === "skip") {
              if (schemaVersion === 2) {
                decision = await completionDecision(weaviateClient, ledgerPath, className, parser.sourceId, parser.docVersion);
                alreadyIndexed = decision.skip;
                fr.reindexReason = decision.skip ? null : decision.reindexReason;
              } else {
                alreadyIndexed = await weaviateClient.checkDocHashExists(parser.docHash);
              }
            }

            if (alreadyIndexed) {
              console.log(`[Ingestion Cache] Document already exists in Weaviate, skipping embedding: ${filePath}`);
              fr.status = "skipped";
              fr.reason = SKIP_REASONS.ALREADY_INDEXED;
              fr.evidence = decision ? decision.evidence : null;
              // T07 (design §3, D4/D6), v2 only: the version is known
              // complete, so anything ELSE at this sourceId — another
              // version left by a refused supersede or a cancel that landed
              // after the last batch (F-61's second variant), or a stale
              // tail — is removed now. A skip that leaves a mixed store is
              // a skip that lied. Refusal is recorded on the file, never
              // hidden; the version that serves is never touched.
              if (schemaVersion === 2 && decision && Number.isInteger(decision.evidence?.recorded)) {
                await repairSupersede(weaviateClient, record, fr, {
                  fileName: fr.fileName,
                  sourceId: parser.sourceId,
                  docVersion: parser.docVersion,
                  keepChunkCount: decision.evidence.recorded,
                });
              }
              record({
                event: "file_skipped",
                filePath,
                fileName: fr.fileName,
                sourceId: parser.sourceId,
                docVersion: parser.docVersion,
                contentHash: parser.docHash,
                reason: SKIP_REASONS.ALREADY_INDEXED,
                evidence: fr.evidence,
                superseded: fr.superseded,
                supersedeError: fr.supersedeError,
              });
              completeFile();
              continue;
            }

            const chunks = await parser.chunk();
            if (parser.doclingTrace) {
              if (!job.doclingTraces) job.doclingTraces = [];
              job.doclingTraces.push(parser.doclingTrace);
              syncLegacyView();
            }
            const trace = parser.doclingTrace || null;
            // The engine that parsed the file, from the trace; the markdown
            // path records no trace, so it is the vocabulary's "unknown" —
            // the same word its chunks carry (T13), never a guess.
            fr.engine = trace?.engineId || ENGINE_IDS.UNKNOWN;
            fr.pages = Number.isFinite(trace?.pageCount) ? trace.pageCount : null;
            fr.counts.chunksEmitted = chunks.length;
            fr.counts.chunksDroppedMinSize = Number.isFinite(parser.chunksDroppedMinSize) ? parser.chunksDroppedMinSize : null;
            // T41 (design D2, D7): the pieces folded under the minimum, and a deck's hidden slides (counted, named).
            fr.counts.chunksMergedMinSize = Number.isFinite(parser.chunksMergedMinSize) ? parser.chunksMergedMinSize : null;
            fr.counts.slidesHidden = Number.isFinite(trace?.slidesHidden) ? trace.slidesHidden : null;
            // T18 (design D2, §2.6): the running lines removed (null for an unpaginated file).
            const pa = trace?.pageArtifacts && typeof trace.pageArtifacts === "object" ? trace.pageArtifacts : null;
            fr.counts.pageArtifactLines = pa && Number.isFinite(pa.linesRemoved) ? pa.linesRemoved : null;
            fr.counts.pageArtifactKeys = pa && Number.isFinite(pa.distinctKeys) ? pa.distinctKeys : null;
            fr.counts.pageArtifactPages = pa && Number.isFinite(pa.pagesTouched) ? pa.pagesTouched : null;
            fr.counts.pageArtifactKeptFirst = pa && Number.isFinite(pa.keptFirst) ? pa.keptFirst : null;
            fr.counts.pageArtifactPagesWithoutText = pa && Number.isFinite(pa.pagesWithoutText) ? pa.pagesWithoutText : null;
            fr.hiddenSlidesList = typeof trace?.hiddenSlidesList === "string" ? trace.hiddenSlidesList : null;
            // T24 (design D9): the figure outcomes travel with the file — the
            // status frame's fileResults carry them, the ledger's file_parsed
            // records them, and a shortfall has a cause.
            const fig = (k) => (Number.isFinite(trace?.[k]) ? trace[k] : null);
            fr.counts.figuresCaptured = fig("picturesCaptured");
            fr.counts.figuresCaptioned = fig("vlmCaptionsGenerated");
            fr.counts.figuresTimedOut = fig("vlmTimedOut");
            fr.counts.figuresFailed = fig("vlmFailed");
            // T29 (design D7): the caption memo's share and the requests made.
            fr.counts.figuresFromMemo = fig("vlmFromMemo");
            fr.counts.vlmCalls = fig("vlmCalls");
            // T31 (workshop design D5, D7): the pages beyond the caption budget —
            // counted and NAMED, never a failure (the budget is the presenter's).
            fr.counts.figuresConsidered = fig("figuresConsidered");
            fr.counts.figuresNotAttempted = fig("vlmNotAttempted");
            fr.captionBudget = Number.isInteger(trace?.captionBudget) ? trace.captionBudget : null;
            fr.notAttemptedPages = typeof trace?.notAttemptedPages === "string" ? trace.notAttemptedPages : null;
            // T32 (design D9): the decorative and text-only verdicts travel with
            // the file too, so the views' suffix can name them.
            fr.counts.figuresDecorative = fig("vlmDecorative");
            fr.counts.figuresTextOnly = fig("vlmTextOnly");
            // T33 (design D7): the detail passes travel with the file too —
            // planned pages, tiles, requests, recalls, conflicts, failures,
            // the visual pages that did not qualify under auto — with the
            // mode, the pages and the reason each fired for, named.
            fr.counts.detailPages = fig("detailPages");
            fr.counts.detailTiles = fig("detailTiles");
            fr.counts.detailCalls = fig("detailCalls");
            fr.counts.detailFromMemo = fig("detailFromMemo");
            fr.counts.detailConflicts = fig("detailConflicts");
            // T45 (design §2.3): the tile-edge rule's counts travel with the file too.
            fr.counts.detailEdgeDropped = fig("detailEdgeDropped");
            fr.counts.detailEdgeSettled = fig("detailEdgeSettled");
            fr.counts.detailMultiValued = fig("detailMultiValued");
            // T57 (design §2.4): the colour check's counts travel with the file too — the labels checked, the readings
            // disclosed, the tile conflicts settled, the pages whose colour layer could not be read.
            fr.counts.detailColourChecked = fig("detailColourChecked");
            fr.counts.detailColourFlagged = fig("detailColourFlagged");
            fr.counts.detailColourSettled = fig("detailColourSettled");
            // T61 (design §2): the readings the three-cue settle wrote travel with the file too.
            fr.counts.detailColourAssociated = fig("detailColourAssociated");
            fr.counts.detailColourFailed = fig("detailColourFailed");
            // T47 (design §2.3): the caption labels reconciled with the text layer travel with the file too — the count and the list.
            fr.counts.captionSubstitutions = fig("captionSubstitutions");
            fr.captionSubstitutionsList = Array.isArray(trace?.captionSubstitutionsList) ? trace.captionSubstitutionsList : null;
            fr.counts.detailFailed = fig("detailFailed");
            fr.counts.detailNotTaken = fig("detailNotTaken");
            fr.counts.detailEmpty = fig("detailEmpty");
            fr.detailMode = typeof trace?.detailMode === "string" ? trace.detailMode : null;
            fr.detailPagesList = typeof trace?.detailPagesList === "string" ? trace.detailPagesList : null;
            fr.detailReasons = Array.isArray(trace?.detailReasons) ? trace.detailReasons.slice() : null;
            fr.detailFailedPages = typeof trace?.detailFailedPages === "string" ? trace.detailFailedPages : null;
            fr.detailEmptyPages = typeof trace?.detailEmptyPages === "string" ? trace.detailEmptyPages : null;
            // T57 (design §2.4): the pages whose colour layer could not be read (they merged as before T57), named.
            fr.detailColourFailedPages = typeof trace?.detailColourFailedPages === "string" ? trace.detailColourFailedPages : null;
            // T46 (design D9, D16): the chain pass travels with the file too — its counts (dimension_chain.js
            // CHAIN_COUNT_KEYS), the admitted / failed / block pages and the lines the drawing's geometry settled, named.
            for (const k of CHAIN_COUNT_KEYS) fr.counts[k] = fig(k);
            fr.chainPagesList = typeof trace?.chainPagesList === "string" ? trace.chainPagesList : null;
            fr.chainFailedPages = typeof trace?.chainFailedPages === "string" ? trace.chainFailedPages : null;
            fr.chainBlockPages = typeof trace?.chainBlockPages === "string" ? trace.chainBlockPages : null;
            fr.chainSettledList = Array.isArray(trace?.chainSettledList) ? trace.chainSettledList : null;
            // T35 (design D10): the OCR pass travels with the file too — the pages without a text layer, the
            // pages OCR read / read empty / failed on (named), the characters, the wall time, the engine.
            fr.counts.ocrNoText = fig("ocrNoText");
            fr.counts.ocrPages = fig("ocrPages");
            fr.counts.ocrEmpty = fig("ocrEmpty");
            fr.counts.ocrFailed = fig("ocrFailed");
            fr.counts.ocrChars = fig("ocrChars");
            fr.ocrMode = typeof trace?.ocrMode === "string" ? trace.ocrMode : null;
            fr.ocrNoTextPages = typeof trace?.ocrNoTextPages === "string" ? trace.ocrNoTextPages : null;
            fr.ocrPagesList = typeof trace?.ocrPagesList === "string" ? trace.ocrPagesList : null;
            fr.ocrEmptyPages = typeof trace?.ocrEmptyPages === "string" ? trace.ocrEmptyPages : null;
            fr.ocrFailedPages = typeof trace?.ocrFailedPages === "string" ? trace.ocrFailedPages : null;
            fr.ocrEngine = typeof trace?.ocrEngine === "string" ? trace.ocrEngine : null;
            fr.ocrDurationMs = fig("ocrDurationMs");
            record({
              event: "file_parsed",
              filePath,
              fileName: fr.fileName,
              sourceId: parser.sourceId,
              docVersion: parser.docVersion,
              contentHash: parser.docHash,
              engine: fr.engine,
              engineLabel: trace?.engine || null,
              paginated: typeof trace?.paginated === "boolean" ? trace.paginated : null,
              vlmModel: trace?.vlmModel || null,
              parseDurationMs: Number.isFinite(trace?.parseDurationMs) ? trace.parseDurationMs : null,
              vlmDurationMs: Number.isFinite(trace?.vlmDurationMs) ? trace.vlmDurationMs : null,
              // T41 (design D7): the hidden slides, named.
              hiddenSlidesList: fr.hiddenSlidesList,
              counts: {
                pages: fr.pages,
                chunksEmitted: chunks.length,
                chunksDroppedMinSize: fr.counts.chunksDroppedMinSize,
                // T41 (design D2, D7): the pieces folded under the minimum; the hidden slides skipped.
                chunksMergedMinSize: fr.counts.chunksMergedMinSize,
                slidesHidden: fr.counts.slidesHidden,
                // T18 (design D2, §2.6): the running lines removed.
                pageArtifactLines: fr.counts.pageArtifactLines,
                pageArtifactKeys: fr.counts.pageArtifactKeys,
                pageArtifactPages: fr.counts.pageArtifactPages,
                pageArtifactKeptFirst: fr.counts.pageArtifactKeptFirst,
                pageArtifactPagesWithoutText: fr.counts.pageArtifactPagesWithoutText,
                figuresCaptured: Number.isFinite(trace?.picturesCaptured) ? trace.picturesCaptured : null,
                figuresCaptioned: Number.isFinite(trace?.vlmCaptionsGenerated) ? trace.vlmCaptionsGenerated : null,
                figuresDecorative: fig("vlmDecorative"),
                // T32: the pages read and found to be text (no chunk).
                figuresTextOnly: fig("vlmTextOnly"),
                figuresTruncated: fig("vlmTruncated"),
                figuresTimedOut: fig("vlmTimedOut"),
                figuresFailed: fig("vlmFailed"),
                figuresFromMemo: fig("vlmFromMemo"),
                figuresMemoised: fig("vlmMemoised"),
                vlmCalls: fig("vlmCalls"),
                // T31: the pages considered and the pages beyond the budget.
                figuresConsidered: fig("figuresConsidered"),
                figuresNotAttempted: fig("vlmNotAttempted"),
                // T33: the detail passes.
                detailPages: fig("detailPages"),
                detailTiles: fig("detailTiles"),
                detailCalls: fig("detailCalls"),
                detailFromMemo: fig("detailFromMemo"),
                detailMemoised: fig("detailMemoised"),
                detailConflicts: fig("detailConflicts"),
                detailEdgeDropped: fig("detailEdgeDropped"),
                detailEdgeSettled: fig("detailEdgeSettled"),
                detailMultiValued: fig("detailMultiValued"),
                detailColourChecked: fig("detailColourChecked"),
                detailColourFlagged: fig("detailColourFlagged"),
                detailColourSettled: fig("detailColourSettled"),
                detailColourAssociated: fig("detailColourAssociated"),
                detailColourFailed: fig("detailColourFailed"),
                detailFailed: fig("detailFailed"),
                detailNotTaken: fig("detailNotTaken"),
                detailChunks: fig("detailChunks"),
                detailEmpty: fig("detailEmpty"),
                // T47 (design §2.3): the caption labels reconciled with the text layer.
                captionSubstitutions: fig("captionSubstitutions"),
                // T46 (design D9, D16): the chain pass.
                ...Object.fromEntries(CHAIN_COUNT_KEYS.map((k) => [k, fig(k)])),
                // T35: the OCR pass.
                ocrNoText: fig("ocrNoText"),
                ocrPages: fig("ocrPages"),
                ocrEmpty: fig("ocrEmpty"),
                ocrFailed: fig("ocrFailed"),
                ocrChars: fig("ocrChars"),
              },
              captioning: trace?.captioning === "off" ? "off" : trace?.captioning === "on" ? "on" : null,
              // T33: the detail passes' mode, the pages that fired with their reasons, the pages whose pass failed.
              detailMode: fr.detailMode,
              detailPagesList: fr.detailPagesList,
              detailReasons: fr.detailReasons,
              detailFailedPages: fr.detailFailedPages,
              detailEmptyPages: fr.detailEmptyPages,
              // T57 (design §2.4): the pages whose colour layer could not be read, named.
              detailColourFailedPages: fr.detailColourFailedPages,
              // T47 (design §2.3): the reconciled labels, named (page, figureId, from, to, edits).
              captionSubstitutionsList: fr.captionSubstitutionsList,
              // T46 (design D9, D16): the chain pass's pages and the lines the drawing's geometry settled, named.
              chainPagesList: fr.chainPagesList,
              chainFailedPages: fr.chainFailedPages,
              chainBlockPages: fr.chainBlockPages,
              chainSettledList: fr.chainSettledList,
              // T35 (design D8, D10): the OCR pass — the mode, the pages named, the engine and its models, the wall
              // time, the thread pin; the transcribe plans not taken because OCR read the page.
              ocrMode: fr.ocrMode,
              ocrNoTextPages: fr.ocrNoTextPages,
              ocrPagesList: fr.ocrPagesList,
              ocrEmptyPages: fr.ocrEmptyPages,
              ocrFailedPages: fr.ocrFailedPages,
              ocrEngine: fr.ocrEngine,
              ocrDurationMs: fr.ocrDurationMs,
              ocrThreads: Number.isInteger(trace?.ocrThreads) ? trace.ocrThreads : null,
              ocrError: typeof trace?.ocrError === "string" ? trace.ocrError : null,
              detailNotTakenOcr: fig("detailNotTakenOcr"),
              detailNotTakenOcrPages: typeof trace?.detailNotTakenOcrPages === "string" ? trace.detailNotTakenOcrPages : null,
              // T31: the budget applied and the pages beyond it, named (null = no limit / none).
              captionBudget: fr.captionBudget,
              notAttemptedPages: fr.notAttemptedPages,
              // T29: the memo's state for the document and the server identity the key named.
              captionMemo: typeof trace?.captionMemo === "string" ? trace.captionMemo : null,
              // T32: which prompt variants (md5-8) wrote this document's captions.
              captionPrompts: trace?.captionPrompts && typeof trace.captionPrompts === "object" ? { ...trace.captionPrompts } : null,
              vlmModelDigest: typeof trace?.vlmModelDigest === "string" ? trace.vlmModelDigest : null,
              vlmServer: typeof trace?.vlmServer === "string" ? trace.vlmServer : null,
              captionReset: typeof trace?.captionReset === "boolean" ? trace.captionReset : null,
              captionResetWaitMs: Number.isFinite(trace?.captionResetWaitMs) ? trace.captionResetWaitMs : null,
              vlmFirstLoadMs: Number.isFinite(trace?.vlmFirstLoadMs) ? trace.vlmFirstLoadMs : null,
            });

            // T06's zero-chunk rule, now a visible outcome (design §4): a
            // parse that yields nothing supersedes nothing and indexes
            // nothing — the previous version keeps serving, and the job
            // is `partial` rather than silently complete.
            if (chunks.length === 0) {
              fr.status = "empty";
              fr.reason = "parsed to 0 chunks; previous versions left in place";
              console.log(`[Ingestion Supersede] ${fr.fileName} parsed to no chunks; previous versions at sourceId ${parser.sourceId} are left in place.`);
              record({
                event: "file_failed",
                filePath,
                fileName: fr.fileName,
                sourceId: parser.sourceId,
                docVersion: parser.docVersion,
                status: "empty",
                reason: fr.reason,
                counts: { chunksEmitted: 0, chunksInserted: 0, chunksDroppedMinSize: fr.counts.chunksDroppedMinSize },
              });
              completeFile();
              continue;
            }

            totalChunks += chunks.length;
            fr.status = "parsed";
            filesToProcess.push({
              index: i,
              filePath,
              fileName: fr.fileName,
              docHash: parser.docHash,
              sourceId: parser.sourceId,
              docVersion: parser.docVersion,
              chunks,
            });
          } catch (err) {
            fr.status = "failed";
            fr.error = clip(err.message);
            fr.reason = "failed before indexing";
            console.error(`[Ingestion] ${fr.fileName} failed before indexing:`, err.message);
            record({
              event: "file_failed",
              filePath,
              fileName: fr.fileName,
              sourceId: fr.sourceId,
              docVersion: fr.docVersion,
              status: "failed",
              reason: fr.reason,
              error: err.message,
              counts: { chunksEmitted: null, chunksInserted: 0, chunksDroppedMinSize: null },
            });
            completeFile();
          }
        }

        // 2. Process and index files sequentially.
        //    T07 (review §6a): once a file's embed or insert has FAILED, the
        //    files after it are not attempted — the embedder or the store is
        //    down, so under v1 each would delete its old chunks first and
        //    insert nothing, and under either version a hung embedder would
        //    cost 180 s per file. They end `skipped` with the reason, not
        //    silently untouched.
        let phase2Failed = false;
        for (let i = 0; i < filesToProcess.length; i++) {
          const item = filesToProcess[i];
          const fr = job.fileResults[item.index];
          job.currentFile = item.fileName;
          syncLegacyView();

          if (phase2Failed) {
            fr.status = "skipped";
            fr.reason = SKIP_REASONS.NOT_ATTEMPTED;
            fr.error = "not attempted: an earlier file's embed or insert failed in this job";
            record({ event: "file_skipped", filePath: item.filePath, fileName: item.fileName, sourceId: item.sourceId, docVersion: item.docVersion, reason: SKIP_REASONS.NOT_ATTEMPTED, detail: fr.error });
            completeFile();
            continue;
          }

          if (job.cancelled) {
            fr.status = "cancelled";
            fr.reason = SKIP_REASONS.CANCELLED;
            record({ event: "file_skipped", filePath: item.filePath, fileName: item.fileName, sourceId: item.sourceId, docVersion: item.docVersion, reason: SKIP_REASONS.CANCELLED, detail: "parsed but not indexed" });
            completeFile();
            continue;
          }
          fr.status = "indexing";
          syncLegacyView();

          // v1: delete this document's old vectors by content hash BEFORE the
          // insert, exactly as before (the return is ignored, T21 D4).
          // v2 (T06, design D1 / D2): nothing is deleted before the insert.
          // Every object is an upsert on its deterministic id (T05), so the
          // new version lands beside the old one, and the old one is
          // SUPERSEDED after this file's insert completes (below) — it keeps
          // serving until the new version is whole. F-41's abort-on-refusal
          // contract moves with it (D3).
          if (schemaVersion !== 2) {
            await weaviateClient.deleteByHash(item.docHash);
          }

          const chunks = item.chunks;
          
          // The embedding batch shape. T17 (design D8, F-68): an explicit
          // positive integer in the blob (`embedBatchSize` / `embedConcurrency`)
          // wins; otherwise ("auto", null) the endpoint rule as before — the
          // GPU-served Ollama hosts get 64 / 5, anything else (a CPU-served
          // MLIS endpoint, a proxy, a port-forward) 16 / 1.
          // LiteLLM's embedding deployments take the conservative 16 / 1 (F-68's non-Ollama rule).
          const isGpuServed = embedUrl.includes("ollama.svc.cluster.local") || embedUrl.includes("ollama.demo.lon-pcai.twlon.com");
          const positiveInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);
          const batchSize = positiveInt(config.embedBatchSize) ?? (isGpuServed ? 64 : 16);
          const concurrencyLimit = positiveInt(config.embedConcurrency) ?? (isGpuServed ? 5 : 1);

          const batches = [];
          for (let j = 0; j < chunks.length; j += batchSize) {
            batches.push(chunks.slice(j, j + batchSize));
          }

          // Chunks of THIS file actually inserted — the supersede below runs
          // only when this equals chunks.length (T06 D2).
          let inserted = 0;
          // T07 (D5, D7): a failed batch fails THIS file, not the job — and
          // it is recorded only after its sibling batches in the slice have
          // settled, so the count is what landed, never what was in flight.
          let fileError = null;

          const processBatch = async (batch) => {
            if (job.cancelled) return;
            try {
              const texts = batch.map(c => c.text);
              const vectors = await getEmbeddingsBatch(texts, embedUrl, embedModel, token);
              if (embedDim === null && Array.isArray(vectors[0])) embedDim = vectors[0].length;
              
              for (let k = 0; k < batch.length; k++) {
                batch[k].vector = vectors[k];
              }

              const insertResult = await weaviateClient.batchInsert(batch);
              // T06 (review §6a), v2 only: "inserted" feeds a DELETE, so it must
              // mean what it says — Weaviate's batch answer is one entry per
              // object, and anything else is not evidence that the chunks are
              // stored. v1 keeps counting as it always did.
              if (schemaVersion === 2 && (!Array.isArray(insertResult) || insertResult.length !== batch.length)) {
                throw new Error(
                  `Weaviate's batch insert into '${weaviateClient.className}' did not account for every chunk of ${item.fileName} ` +
                    `(${Array.isArray(insertResult) ? insertResult.length : "no"} result(s) for ${batch.length} object(s)); ` +
                    `the previous version was not superseded.`
                );
              }
              job.chunksIndexed += batch.length;
              inserted += batch.length;
              fr.counts.chunksInserted = inserted;

              if (totalChunks > 0) {
                job.progressPercent = Math.min(99, Math.round((job.chunksIndexed / totalChunks) * 100));
              }

              // Calculate precise remaining ETA
              const chunksLeft = totalChunks - job.chunksIndexed;
              const avgTimePerChunk = job.elapsedSeconds / job.chunksIndexed;
              job.etaSeconds = Math.round(chunksLeft * avgTimePerChunk);
              syncLegacyView();
            } catch (err) {
              if (!fileError) fileError = err;
            }
          };

          // Execute batch jobs with concurrency limits
          for (let j = 0; j < batches.length; j += concurrencyLimit) {
            if (job.cancelled) {
              console.log("[Ingestion] Processing loop aborted due to cancellation.");
              break;
            }
            if (fileError) break;
            const slice = batches.slice(j, j + concurrencyLimit);
            await Promise.all(slice.map(b => processBatch(b)));
          }

          fr.counts.chunksInserted = inserted;
          const counts = {
            chunksEmitted: chunks.length,
            chunksDroppedMinSize: fr.counts.chunksDroppedMinSize,
            chunksEmbedded: inserted,
            chunksInserted: inserted,
            // T24 (design D9): the figure outcomes on every terminal record, so
            // a frame rebuilt from the ledger after a restart carries them too.
            figuresCaptured: fr.counts.figuresCaptured,
            figuresCaptioned: fr.counts.figuresCaptioned,
            // T32: the decorative and text-only verdicts on every terminal record too.
            figuresDecorative: fr.counts.figuresDecorative,
            figuresTextOnly: fr.counts.figuresTextOnly,
            figuresTimedOut: fr.counts.figuresTimedOut,
            figuresFailed: fr.counts.figuresFailed,
            figuresFromMemo: fr.counts.figuresFromMemo,
            vlmCalls: fr.counts.vlmCalls,
            // T31: the pages beyond the caption budget, on every terminal record too.
            figuresConsidered: fr.counts.figuresConsidered,
            figuresNotAttempted: fr.counts.figuresNotAttempted,
            // T33: the detail passes, on every terminal record too (a frame rebuilt from the ledger carries them).
            detailPages: fr.counts.detailPages,
            detailTiles: fr.counts.detailTiles,
            detailCalls: fr.counts.detailCalls,
            detailFromMemo: fr.counts.detailFromMemo,
            detailConflicts: fr.counts.detailConflicts,
            detailEdgeDropped: fr.counts.detailEdgeDropped,
            detailEdgeSettled: fr.counts.detailEdgeSettled,
            detailMultiValued: fr.counts.detailMultiValued,
            detailColourChecked: fr.counts.detailColourChecked,
            detailColourFlagged: fr.counts.detailColourFlagged,
            detailColourSettled: fr.counts.detailColourSettled,
            detailColourAssociated: fr.counts.detailColourAssociated,
            detailColourFailed: fr.counts.detailColourFailed,
            detailFailed: fr.counts.detailFailed,
            detailNotTaken: fr.counts.detailNotTaken,
            detailEmpty: fr.counts.detailEmpty,
            captionSubstitutions: fr.counts.captionSubstitutions,
            // T46: the chain pass's counts ride every terminal record too.
            ...Object.fromEntries(CHAIN_COUNT_KEYS.map((k) => [k, fr.counts[k]])),
            // T35: the OCR pass's counts ride every terminal record too (a ledger-rebuilt frame keeps them).
            ocrNoText: fr.counts.ocrNoText,
            ocrPages: fr.counts.ocrPages,
            ocrEmpty: fr.counts.ocrEmpty,
            ocrFailed: fr.counts.ocrFailed,
            ocrChars: fr.counts.ocrChars,
          };
          const identity = { filePath: item.filePath, fileName: item.fileName, sourceId: item.sourceId, docVersion: item.docVersion, contentHash: item.docHash };

          if (!fileError && inserted === 0 && job.cancelled) {
            // The cancel landed before any batch of this file (under v1,
            // while its pre-insert delete was awaited — the old chunks are
            // gone and nothing of the file is in the store): that is a
            // cancelled file, not a partial one (review §6a).
            fr.status = "cancelled";
            fr.reason = SKIP_REASONS.CANCELLED;
            fr.error = schemaVersion !== 2 ? "cancelled before any chunk landed; the previous chunks of this file were deleted before the cancel (v1 deletes before it inserts)" : null;
            record({ event: "file_skipped", ...identity, reason: SKIP_REASONS.CANCELLED, detail: schemaVersion !== 2 ? "cancelled before any chunk landed (v1: previous chunks already deleted)" : "cancelled before any chunk landed", counts });
            completeFile();
            continue;
          }

          if (fileError) {
            fr.status = inserted > 0 ? "partial" : "failed";
            fr.error = clip(fileError.message);
            phase2Failed = true;
            fr.reason = inserted > 0 ? `insert stopped at ${inserted}/${chunks.length} chunks` : "insert failed before any chunk landed";
            console.error(`[Ingestion] ${item.fileName} ${fr.status} (${inserted}/${chunks.length}):`, fileError.message);
            record({ event: "file_failed", ...identity, status: fr.status, reason: fr.reason, error: fileError.message, counts, embedModel, embedDim });
            completeFile();
            continue;
          }
          if (inserted !== chunks.length) {
            // Only a cancel between slices gets here: the file is partial and
            // the version that was serving is left alone (T06 D2 / D4).
            fr.status = "partial";
            fr.reason = `cancelled at ${inserted}/${chunks.length} chunks`;
            console.log(`[Ingestion Supersede] ${item.fileName}: insert incomplete (${inserted}/${chunks.length}${job.cancelled ? ", cancelled" : ""}); previous versions at sourceId ${item.sourceId} are left in place.`);
            record({ event: "file_failed", ...identity, status: "partial", reason: fr.reason, counts, embedModel, embedDim });
            completeFile();
            continue;
          }

          // T06 (E05 / FM-V1; design D1, D2, D3), schema v2 only: now that
          // every chunk of the new version is in, remove everything else at
          // this sourceId — any other docVersion (a byte or settings change),
          // and any stale tail of the SAME docVersion beyond this run's chunk
          // count (a re-ingest whose caption sampling produced fewer chunks,
          // F-54). It runs only when this file's insert COMPLETED: a partial
          // file never deletes the version that is still serving.
          // T07 (F-61's second variant, design D6): a cancel that landed after
          // the last batch no longer withholds it — the new version is whole,
          // so superseding loses nothing and leaving two complete versions
          // was the defect. A refused or thrown supersede is recorded on the
          // file (T06's D3 wording) and makes the job `partial`; it no
          // longer aborts the files after it.
          if (schemaVersion === 2) {
            const mixedStore =
              `The new version of ${item.fileName} is indexed in '${weaviateClient.className}', but its previous ` +
              `version(s) could not be removed`;
            const retryHint = `The collection now holds more than one version of this document; re-ingest it (any duplicate policy) to retry the clean-up.`;
            let superseded;
            try {
              superseded = await weaviateClient.deleteBySourceExceptVersion(
                item.sourceId,
                item.docVersion,
                { keepChunkCount: chunks.length }
              );
            } catch (err) {
              // A network failure or timeout is the same mixed state as a
              // refusal, and the caller must hear the same truth (D3).
              superseded = { ok: false, thrown: true, status: null, body: err.message, matches: null, failed: null };
            }
            if (superseded.ok === false) {
              fr.supersedeError =
                `${mixedStore} (` +
                (superseded.thrown
                  ? String(superseded.body ?? "").slice(0, 500)
                  : `HTTP ${superseded.status}` +
                    (typeof superseded.matches === "number" ? `, matches ${superseded.matches}, failed ${superseded.failed}` : "") +
                    `: ${String(superseded.body ?? "").slice(0, 500)}`) +
                `). ${retryHint}`;
              console.error(`[Ingestion Supersede] ${fr.supersedeError}`);
              record({ event: "file_superseded", ...identity, keptDocVersion: item.docVersion, keepChunkCount: chunks.length, ok: false, matches: typeof superseded.matches === "number" ? superseded.matches : null, error: fr.supersedeError });
            } else {
              fr.superseded = typeof superseded.matches === "number" ? superseded.matches : null;
              console.log(`[Ingestion Supersede] ${item.fileName}: removed ${typeof superseded.matches === "number" ? superseded.matches : "an unreported number of"} object(s) of other versions at sourceId ${item.sourceId} in '${weaviateClient.className}'.`);
              record({ event: "file_superseded", ...identity, keptDocVersion: item.docVersion, keepChunkCount: chunks.length, ok: true, matches: fr.superseded, error: null });
            }
          }

          // T24 (design D4): every chunk landed and the old versions are
          // superseded, but a figure's caption timed out or failed — the file
          // is `partial` with the loss named, recorded as a partial outcome so
          // the next `skip` ingest re-attempts it (T07's partial_record path),
          // and the job ends `partial`. Silence here is what F-116 cost.
          const captionLoss = (fr.counts.figuresTimedOut || 0) + (fr.counts.figuresFailed || 0);
          if (captionLoss > 0) {
            fr.status = "partial";
            fr.reason = PARTIAL_REASONS.CAPTIONS_INCOMPLETE;
            fr.error =
              `${captionLoss} of ${fr.counts.figuresCaptured} figure(s) not captioned` +
              ` (${fr.counts.figuresTimedOut || 0} timed out, ${fr.counts.figuresFailed || 0} failed); ` +
              `the text and the ${fr.counts.figuresCaptioned || 0} caption(s) that succeeded are indexed; re-ingest to retry`;
            console.warn(`[Ingestion] ${item.fileName} partial: ${fr.error}`);
            record({ event: "file_failed", ...identity, status: "partial", reason: fr.reason, error: fr.error, counts, embedModel, embedDim, superseded: fr.superseded, supersedeError: fr.supersedeError, reindexReason: fr.reindexReason, engine: fr.engine });
            completeFile();
            continue;
          }

          fr.status = "indexed";
          record({ event: "file_indexed", ...identity, status: "complete", counts, embedModel, embedDim, superseded: fr.superseded, supersedeError: fr.supersedeError, reindexReason: fr.reindexReason, engine: fr.engine });
          completeFile();
        }

        job.progressPercent = 100;
        job.etaSeconds = 0;
        // T07 (design D6): the job's status is DERIVED from its files.
        const status = jobStatusFrom(job.fileResults, { cancelled: job.cancelled });
        const errorCode = jobErrorCodeFor(status, INGEST_CODES);
        const error = jobErrorFrom(job.fileResults, status);
        const tally = fileCountsFrom(job.fileResults);
        record({ event: "ingest_end", status, error, errorCode, files: tally.files, chunks: tally.chunks, durationMs: Date.now() - Date.parse(job.startedAt) });
        finishJob(job, status, { error, errorCode });
        clearInterval(timer);
        try {
          if (shouldCompact(ledgerPath)) {
            const r = compact(ledgerPath);
            console.log(`[Ledger] compacted ${ledgerPath}: ${r.before} → ${r.after} events.`);
          }
        } catch (err) {
          console.error("[Ledger] compaction failed:", err.message);
        }

      } catch (err) {
        clearInterval(timer);
        // T07 (F-52): a cancel is not overwritten by a later throw, and no
        // file is left without a terminal status — in the job AND in the
        // ledger (review §6a): a job-level throw (ensureSchema, a v1
        // pre-insert delete against a dead store) still ends with
        // filesCompleted === totalFiles and one terminal event per file.
        const status = job.cancelled ? "cancelled" : "error";
        for (const fr of job.fileResults) {
          if (!isTerminalFileStatus(fr.status)) {
            fr.status = job.cancelled ? "cancelled" : "failed";
            fr.error = fr.error || clip(err.message);
            fr.reason = fr.reason || (job.cancelled ? SKIP_REASONS.CANCELLED : "job aborted");
            const identity = { filePath: fr.filePath, fileName: fr.fileName, sourceId: fr.sourceId, docVersion: fr.docVersion };
            if (job.cancelled) {
              record({ event: "file_skipped", ...identity, reason: SKIP_REASONS.CANCELLED, detail: "job aborted after the cancel", error: fr.error });
            } else {
              record({ event: "file_failed", ...identity, status: "failed", reason: fr.reason, error: fr.error, counts: { chunksEmitted: fr.counts?.chunksEmitted ?? null, chunksInserted: fr.counts?.chunksInserted ?? 0, chunksDroppedMinSize: fr.counts?.chunksDroppedMinSize ?? null } });
            }
            completeFile();
          }
        }
        job.progressPercent = 100;
        job.etaSeconds = 0;
        const errorCode = job.cancelled ? null : INGEST_CODES.INGEST_FAILED;
        const tally = fileCountsFrom(job.fileResults);
        record({ event: "ingest_end", status, error: clip(err.message), errorCode, files: tally.files, chunks: tally.chunks, durationMs: Date.now() - Date.parse(job.startedAt) });
        finishJob(job, status, { error: clip(err.message), errorCode });
        console.error("[Ingestion Pipeline Error]:", err);
      }
    })();

    // F-18: the 202 now carries the job's identity. Without it a driver could
    // only poll a global singleton and had no way to tell its own job's state
    // from a concurrent or orphaned one — which is how an automated run
    // reported another job's completion as its own.
    return NextResponse.json(
      {
        success: true,
        jobId: job.jobId,
        statusUrl: `/api/ingest/status?jobId=${job.jobId}`,
        // T23 (design D4): names only — `request` / `env` / `workload` / `none`.
        credentialSources: { embed: embedCred.source, weaviate: weaviateCred.source, vlm: vlmCred.source },
        message: "Ingestion queue started successfully.",
      },
      { status: 202 }
    );

  } catch (error) {
    console.error("[Ingestion Endpoint Error]:", error);
    return NextResponse.json(
      { success: false, code: INGEST_CODES.INGEST_FAILED, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * T16 (design D3 / D4 / D5): the request-level verdict against the
 * collection's embedding-space pin. The pin is the ledger's reducer over the
 * in-process index (revalidated by one stat first — A11), filtered by the
 * store this request targets (D10). It refuses only when the record is
 * enforceable, names another model, and nothing in the store contradicts
 * it: the class's LIVE dimension is read through a plain read-only client
 * (never the destructive factory, never ensureSchema — this must create
 * nothing). An absent class has nothing to protect: the job will create it
 * and `collection_created` resets the pin. An existing class that is empty,
 * or a store that cannot be read, leaves the record standing (409). A
 * provisional pin (creation name only, no vector landed) never refuses. An
 * unreadable ledger is logged and not enforced — the ingest itself will
 * record what it can.
 */
async function embedModelPinRefusal({ ledgerPath, className, weaviateUrl, weaviateToken, embedModel }) {
  let pin = null;
  try {
    revalidateIndex(ledgerPath);
    pin = getCollectionPin(getIndex(ledgerPath).events, { collection: className, store: storeOriginOf(weaviateUrl) });
  } catch (err) {
    console.error(`[Ingestion Pin] ledger unreadable (${path.relative(process.cwd(), ledgerPath)}): ${err.message}; the pin is not enforced for this request.`);
    return null;
  }
  if (!pin || !pin.embedModel) return null;
  // Bounded before it is echoed into a body or a log line (review).
  const requested = clip(String(embedModel).trim(), 200);
  if (!pin.enforceable) {
    if (requested !== pin.embedModel) {
      console.log(`[Ingestion Pin] '${className}' carries a provisional pin only ('${pin.embedModel}', no vector landed); this request names '${requested}' — proceeding (D5).`);
    }
    return null;
  }
  if (requested === pin.embedModel) return null;
  const store = await probeStoreDimension(weaviateUrl, weaviateToken, className);
  if (store.exists === false) {
    console.log(`[Ingestion Pin] '${className}' is pinned to '${pin.embedModel}' but the class is not in the store; proceeding — the job will create it and the pin follows (D1 rule 2).`);
    return null;
  }
  const refusal = checkEmbedModelPinForIngest(pin, { embedModel: requested, storeDim: store.dim });
  if (!refusal) {
    console.warn(`[Ingestion Pin] STALE pin on '${className}': the ledger says '${pin.embedModel}' (${pin.embedDim}), the store holds ${store.dim}-dimensional vectors; this request names '${requested}' — proceeding, the next landed record re-pins (D4).`);
    return null;
  }
  console.warn(`[Ingestion Pin] refused (${refusal.code}): ${refusal.message}`);
  return refusal;
}

/**
 * `{ exists, dim }` for a class: `exists` is false on a 404 from the schema
 * read, null when the store could not be asked; `dim` is the live vector
 * length of one object (T08's read, refreshed) or null when the class is
 * empty or unreadable.
 */
async function probeStoreDimension(weaviateUrl, weaviateToken, className) {
  const client = new WeaviateClient(weaviateUrl, weaviateToken, className);
  let exists = null;
  try {
    await client.classProperties({ refresh: true });
    exists = true;
  } catch (err) {
    if (/HTTP 404\b/.test(String(err.message))) return { exists: false, dim: null };
    exists = null;
  }
  const dim = exists ? await client.getVectorDimension({ refresh: true }) : null;
  return { exists, dim };
}

/** Bound a string for the ledger and the status frame (review §6a): never an unbounded provider body. */
function clip(value, max = 2000) {
  if (typeof value !== "string") return value;
  return value.length > max ? `${value.slice(0, max)}… [${value.length - max} more chars]` : value;
}

/** The embed endpoint as origin + path only — never a query string or userinfo (review §6a). */
function embedHostOf(url) {
  try {
    const u = new URL(String(url));
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "(unparseable)";
  }
}

const BOUNDED_EVENT_FIELDS = ["error", "detail", "supersedeError", "reason"];

/** Every request-derived or provider-derived string in an event is bounded before it is written. */
function boundEvent(event) {
  const out = { ...event };
  for (const key of BOUNDED_EVENT_FIELDS) if (typeof out[key] === "string") out[key] = clip(out[key]);
  for (const key of ["filePath", "fileName", "sourceId"]) if (typeof out[key] === "string") out[key] = clip(out[key], 4096);
  if (Array.isArray(out.files)) out.files = out.files.slice(0, 1000).map((f) => clip(String(f), 4096));
  return out;
}

/**
 * T07 (design §3 / D4): is `(sourceId, docVersion)` in `collection` complete?
 * The ledger's latest record must say `file_indexed` / `complete` with n
 * chunks and not have been invalidated by an unload or a clear since; the
 * store must hold exactly n objects whose highest chunkIndex is n-1. The
 * store alone cannot answer (a partial is contiguous too — 32 of 89 looks
 * like 32 of 32); the ledger alone cannot either (an unload, a clear, a
 * refused supersede or a lost file make it stale). A transport failure of
 * the count is "unknown", which re-indexes (a cost, never a wrong answer);
 * a GraphQL refusal throws, and the file fails with that reason.
 */
async function completionDecision(client, ledgerPath, collection, sourceId, docVersion) {
  const outcome = latestFileOutcome(getIndex(ledgerPath).events, { collection, sourceId, docVersion });
  if (!outcome) {
    return { skip: false, reindexReason: REINDEX_REASONS.NO_COMPLETION_RECORD, evidence: { recorded: null } };
  }
  const evidence = { recorded: outcome.chunksInserted, recordedStatus: outcome.status, recordedAt: outcome.ts, recordedBy: outcome.jobId };
  if (outcome.invalidatedBy) {
    return { skip: false, reindexReason: REINDEX_REASONS.RECORD_INVALIDATED, evidence: { ...evidence, invalidatedBy: outcome.invalidatedBy, invalidatedAt: outcome.invalidatedAt } };
  }
  if (!isRecordedComplete(outcome)) {
    return { skip: false, reindexReason: REINDEX_REASONS.PARTIAL_RECORD, evidence };
  }
  const store = await client.countIdentity(sourceId, docVersion);
  if (!store) {
    return { skip: false, reindexReason: REINDEX_REASONS.STORE_UNAVAILABLE, evidence: { ...evidence, storeCount: null } };
  }
  const n = outcome.chunksInserted;
  const matches = store.count === n && store.maxChunkIndex === n - 1;
  return {
    skip: matches,
    reindexReason: matches ? null : REINDEX_REASONS.STORE_MISMATCH,
    evidence: { ...evidence, storeCount: store.count, storeMaxChunkIndex: store.maxChunkIndex },
  };
}

/**
 * T07 (design §3): on the skipped branch under v2 the version is known to be
 * complete, so everything else at the sourceId — other versions, a stale
 * tail — is removed with the same filter the insert path uses. `matches 0`
 * is the normal case (nothing to repair). A refusal is recorded on the
 * file, never thrown: the version that serves is untouched either way.
 */
async function repairSupersede(client, record, fr, { fileName, sourceId, docVersion, keepChunkCount }) {
  let result;
  try {
    result = await client.deleteBySourceExceptVersion(sourceId, docVersion, { keepChunkCount });
  } catch (err) {
    result = { ok: false, thrown: true, status: null, body: err.message, matches: null, failed: null };
  }
  if (result.ok === false) {
    fr.supersedeError =
      `${fileName} is indexed in '${client.className}' but other versions at its sourceId could not be removed (` +
      (result.thrown ? String(result.body ?? "").slice(0, 500) : `HTTP ${result.status}: ${String(result.body ?? "").slice(0, 500)}`) +
      `). Re-ingest it to retry the clean-up.`;
    console.error(`[Ingestion Supersede] ${fr.supersedeError}`);
    record({ event: "file_superseded", fileName, sourceId, docVersion, keptDocVersion: docVersion, keepChunkCount, ok: false, matches: typeof result.matches === "number" ? result.matches : null, error: fr.supersedeError, onSkip: true });
    return;
  }
  fr.superseded = typeof result.matches === "number" ? result.matches : null;
  if (fr.superseded > 0) {
    console.log(`[Ingestion Supersede] ${fileName}: skipped as complete; removed ${fr.superseded} object(s) of other versions at sourceId ${sourceId} in '${client.className}'.`);
  }
  record({ event: "file_superseded", fileName, sourceId, docVersion, keptDocVersion: docVersion, keepChunkCount, ok: true, matches: fr.superseded, error: null, onSkip: true });
}
