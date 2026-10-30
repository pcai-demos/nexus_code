import { NextResponse } from "next/server";
import { WeaviateClient } from "@/lib/vectordb/weaviate";
// T40 (design D7; F-155): identical text is shown once.
import { collapseRepeats } from "@/lib/rag/repeats";
import {
  resolveRetrievalConfig,
  checkVectorDimMatch,
  RETRIEVAL_ERROR_CODES as CODES,
  retrievalErrorBody,
  retrievalDegradation,
  buildRetrievalReport,
  checkEmbedModelPinForQuery,
  buildEmbedSpaceReport,
} from "@/lib/rag/config";
// T16 — the embedding-space pin is READ here, never written: a pin "derived
// lazily on retrieve" would record the query's model as the collection's,
// which is the guess FM-V3 is about (design D8).
import { defaultLedgerPath, getIndex, revalidateIndex, getCollectionPin, storeOriginOf } from "@/lib/rag/ledger";
// T10 — the reranker score contract. Pure, shared, and unit-tested (U-RERANK):
// a score is either something the reranker said or it is `null`. The three
// fabrications this replaces (the 0.5 seed, the 1.0 default, digits harvested
// from <think> text) were all single tokens in this file, which is why the
// suite also walks this source for their return.
import {
  parseVerdict,
  windowForRerank,
  mapDedicatedScores,
  orderByScore,
  passesFloor,
  countScored,
} from "@/lib/rag/rerank";
// T23 — every hop's credential through the one server-side seam (design D4).
import { resolveCredential } from "@/lib/credentials";
// F-163 — every MLIS hop through one fallback helper with a budget PER ATTEMPT
// (src/lib/rag/fallback_fetch.js, U-FALLBACK): the external attempt used to
// inherit the signal the slow internal attempt had already spent.
import { fetchWithInternalFallback as fetchWithFallback } from "@/lib/rag/fallback_fetch";
// T42 — the dedicated rerank stage plans its requests (src/lib/rag/rerank_batches.js,
// U-RERANK-BATCHES): bounded in documents and chars, sent in retrieval order under
// the stage's deadline; an overrun leaves the tail unscored (RERANK_PARTIAL) where
// one oversized request used to fail the whole stage (F-164).
import { planRerankBatches, remainingBudgetMs, summariseRerankStage, RERANK_BATCH_DEFAULTS } from "@/lib/rag/rerank_batches";

export const dynamic = "force-dynamic";


function translateToInternalUrl(urlText) {
  const url = urlText.trim();
  const headers = {};
  
  if (url.includes("rerank.project-demos.serving.demo.lon-pcai.twlon.com")) {
    headers["Host"] = "rerank.project-demos.serving.demo.lon-pcai.twlon.com";
    return {
      url: url.replace("https://rerank.project-demos.serving.demo.lon-pcai.twlon.com", "http://rerank.project-demos.svc.cluster.local:80"),
      headers
    };
  }

  if (url.includes("nemotron.project-demos.serving.demo.lon-pcai.twlon.com")) {
    headers["Host"] = "nemotron.project-demos.serving.demo.lon-pcai.twlon.com";
    return {
      url: url.replace("https://nemotron.project-demos.serving.demo.lon-pcai.twlon.com", "http://nemotron.project-demos.svc.cluster.local:80"),
      headers
    };
  }

  if (url.includes("ollama.demo.lon-pcai.twlon.com")) {
    return {
      url: url.replace("https://ollama.demo.lon-pcai.twlon.com", "http://ollama.ollama.svc.cluster.local:11434"),
      headers: {}
    };
  }
  
  return { url, headers };
}

// Helper to query HPE MLIS Embeddings API
async function getEmbedding(text, embedUrl, modelName, token) {
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
    input: [text]
  };

  const res = await fetch(internalUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding API failure: ${errText || res.statusText}`);
  }

  const data = await res.json();
  const vector = data?.data?.[0]?.embedding;
  if (!vector) {
    throw new Error("No embedding vector returned in the API response.");
  }
  return vector;
}

// Helper: fetch with internal cluster URL first, with fallback to external URL.
// F-163: each attempt has a signal of its own — the caller names `budgetMs`
// per attempt and never a signal; a timeout is the call's own cost and is not
// retried on the other path, an unreachable internal path is (the module's
// contract). `trace` is filled with which path served.
function fetchWithInternalFallback(targetUrl, options, { budgetMs, trace = null }) {
  return fetchWithFallback(targetUrl, options, {
    budgetMs,
    trace,
    translate: translateToInternalUrl,
    log: (line) => console.log(`[RAG Retrieve] ${line}`),
  });
}

// Detect whether an endpoint URL points to an Ollama instance.
// Ollama does NOT expose a /v1/rerank endpoint — only /api/generate, /api/chat, /api/embed.
function isOllamaEndpoint(url) {
  const lower = (url || "").toLowerCase();
  return lower.includes("ollama") || lower.includes(":11434");
}

// Helper to rerank via OpenAI-compatible Chat Completions on HPE MLIS for Qwen3-Reranker-8B
async function rerankViaOpenAiChatCompletions(query, candidates, rawRerankUrl, modelName, token, rerankProperty) {
  let cleanBase = rawRerankUrl.trim().replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const chatEndpoint = `${cleanBase}/v1/chat/completions`;

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }

  console.log(`[Reranker MLIS Chat] Reranking ${candidates.length} candidates via ${chatEndpoint} (Model: ${modelName})`);

  const batchSize = 5;
  // T10: seeded NULL, never 0.5. This is F-26's mechanism: the old seed
  // survived every failure mode of this loop — an unreachable endpoint, a
  // non-2xx, a timeout, an unparseable body — and then cleared the calibrated
  // 0.05 relevance floor as if the reranker had endorsed the passage. Measured
  // in-pod: an absence probe returned a full keepTopN at exactly 0.5 with
  // success:true and no error.
  const scoredCandidates = [...candidates].map(c => ({ ...c, rerankScore: null }));

  for (let i = 0; i < scoredCandidates.length; i += batchSize) {
    const batch = scoredCandidates.slice(i, i + batchSize);
    await Promise.all(batch.map(async (candidate, batchIdx) => {
      const idx = i + batchIdx;
      const docText = rerankProperty === "title" ? (candidate.source || "") : (candidate.text || "");
      // T10/FM-T3: head AND tail. Head-only truncation scored a tail-heavy
      // chunk on its boilerplate.
      const truncatedDoc = windowForRerank(docText);

      const prompt = `<Instruct>: Given a web search query, retrieve relevant passages that answer the query\n<Query>: ${query}\n<Document>: ${truncatedDoc}\nRelevant:`;

      try {
        const res = await fetchWithInternalFallback(chatEndpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName.trim(),
            messages: [{ role: "user", content: prompt }],
            temperature: 0.0,
            max_tokens: 10
          }),
        }, { budgetMs: 30000 });

        if (res.ok) {
          const data = await res.json();
          // Anchored parse, <think> stripped first, no digit harvesting (E20).
          // Unparseable leaves the candidate unscored rather than inventing a
          // midpoint — "nobody judged this passage" is the honest report.
          scoredCandidates[idx].rerankScore = parseVerdict(data?.choices?.[0]?.message?.content);
        }
      } catch (err) {
        console.warn(`[Reranker MLIS Chat] Failed to score candidate ${idx}: ${err.message}`);
      }
    }));
  }

  return orderByScore(scoredCandidates);
}

// Helper to query a dedicated Reranker API (HPE MLIS, TEI, Jina, vLLM)
// These services expose a standard /v1/rerank endpoint or Chat Completions.
//
// T42 (t42-design.md §2; D3, D4, D5, D8): the candidates go in BOUNDED requests
// — at most `stage.maxDocs` documents / `stage.maxChars` chars each, in
// retrieval order, sequentially (parallel buys nothing: the endpoint
// serialises — measured), each request given what is left of the stage's
// deadline. Scores are mapped back per request by explicit index (T10). A
// request that fails, or is never reached because the deadline passed, leaves
// its candidates `null`; the route's T10 logic then says RERANK_PARTIAL (a real
// ranking with an unchecked tail) — the generative fallback is reached only
// when the dedicated API scored NOTHING.
async function rerankViaDedicatedApi(query, candidates, rerankUrl, modelName, token, rerankProperty, internalUrl, headers, report = {}, stage = {}) {
  // Qwen3-Reranker's scores are only meaningful inside the model's trained
  // instruction template. Raw query/document pairs through the score API
  // produce a near-uniform 0.4-0.7 band with wrong ordering; wrapped, the
  // same pairs separate to ~0.99 (relevant) vs ~0.0001 (irrelevant) —
  // measured against the live vLLM score deployment, 2026-08-13 (T08 PR).
  // Applied by model name so generic /v1/rerank deployments (TEI, bge-style
  // cross-encoders) keep receiving raw text.
  const isQwen3Reranker = /qwen3-reranker/i.test(modelName || "");
  const Q3_PREFIX =
    '<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n';
  const Q3_SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";
  // Mention-style rather than answer-style: judged as "answers the query", a
  // bare entity/anchor query (e.g. a house-type name) scores ~0.0001 against
  // the very chunk that contains it — indistinguishable from nonsense, which
  // breaks anchor recall under any relevance floor. Judged as
  // "contains/mentions/is about", the same chunk scores ~0.02-0.37 while true
  // negatives and nonsense stay ≤0.003 (measured 2026-08-13, T08 PR).
  const Q3_INSTRUCT =
    "Given a search query, judge the document relevant if it contains, mentions, or is about the query, including names, codes, or terms";
  const formatQuery = (q) =>
    isQwen3Reranker ? `${Q3_PREFIX}<Instruct>: ${Q3_INSTRUCT}\n<Query>: ${q}\n` : q;
  const formatDoc = (d) => (isQwen3Reranker ? `<Document>: ${d}${Q3_SUFFIX}` : d);

  const documents = candidates.map(c => {
    if (rerankProperty === "title") {
      return formatDoc(c.source || "");
    }
    return formatDoc(c.text);
  });
  const formattedQuery = formatQuery(query);
  const endpoint = rerankUrl.endsWith("/rerank") || rerankUrl.endsWith("/v1/rerank") ? rerankUrl : `${rerankUrl.endsWith("/") ? rerankUrl.slice(0, -1) : rerankUrl}/v1/rerank`;

  // T42: the plan and the deadline — the resolved config's, else the module's.
  const bounds = {
    maxChars: Number.isFinite(stage.maxChars) && stage.maxChars >= 1 ? stage.maxChars : RERANK_BATCH_DEFAULTS.maxChars,
    maxDocs: Number.isInteger(stage.maxDocs) && stage.maxDocs >= 1 ? stage.maxDocs : RERANK_BATCH_DEFAULTS.maxDocs,
  };
  const budgetMs = Number.isFinite(stage.budgetMs) && stage.budgetMs > 0 ? stage.budgetMs : RERANK_BATCH_DEFAULTS.budgetMs;
  const { batches, plan } = planRerankBatches(documents, bounds);
  // T10: seeded NULL, never 0.5 — a candidate no request scored stays unscored.
  const scored = candidates.map((c) => ({ ...c, rerankScore: null }));
  const sentBatches = [];
  const stageStart = Date.now();
  let answered = false;
  let failureReason = null;
  let payloadChars = 0;

  for (let b = 0; b < batches.length; b++) {
    // D5: a request is never started with no time left; the rest stays unscored.
    const remaining = remainingBudgetMs(budgetMs, Date.now() - stageStart);
    if (remaining <= 0) break;
    const idx = batches[b];
    const body = JSON.stringify({ model: modelName.trim(), query: formattedQuery, documents: idx.map((i) => documents[i]) });
    payloadChars += body.length;
    // F-163: which path served the request and how long each attempt took.
    const transport = {};
    const t0 = Date.now();
    let resData = null;
    let reason = null;
    try {
      const res = await fetchWithInternalFallback(endpoint, {
        method: "POST",
        headers,
        body,
      }, { budgetMs: remaining, trace: transport });
      if (res.ok) {
        resData = await res.json();
      } else {
        reason = `the score API returned HTTP ${res.status}`;
      }
    } catch (err) {
      reason = `the score API was unreachable (${err.message})`;
    }

    let usable = 0;
    if (resData && !resData.error) {
      let results = resData.results || resData.data || resData;
      if (!Array.isArray(results) && resData.results) {
        results = resData.results;
      }
      if (Array.isArray(results)) {
        answered = true;
        // T10/E21: attribution is by EXPLICIT index only — per request, the
        // index is the request's own, mapped back to the candidate it names.
        const mapped = mapDedicatedScores(idx.map((i) => candidates[i]), results);
        mapped.scored.forEach((row, j) => { scored[idx[j]].rerankScore = row.rerankScore; });
        usable = mapped.usableCount;
        if (usable === 0) reason = mapped.reason;
      } else {
        reason = "the score API returned no usable score array";
      }
    } else if (!reason) {
      reason = resData && resData.error ? `the score API returned an error payload (${String(resData.error.message || resData.error).slice(0, 120)})` : "the score API returned no usable score array";
    }
    if (usable === 0 && !failureReason) failureReason = reason;
    const rec = {
      batch: b + 1,
      of: batches.length,
      documents: idx.length,
      payloadChars: body.length,
      ms: Date.now() - t0,
      scored: usable,
      served: transport.served ?? null,
      internalMs: transport.internalMs ?? null,
      internalError: transport.internalError ?? null,
      externalMs: transport.externalMs ?? null,
      externalError: transport.externalError ?? null,
      fallback: transport.fallback ?? null,
      budgetMs: transport.budgetMs ?? remaining,
      error: usable === 0 ? reason : null,
    };
    sentBatches.push(rec);
    console.log(
      `[Reranker Dedicated API] request ${rec.batch}/${rec.of}: ${transport.served ? `served by the ${transport.served} path` : "not served"} — ` +
        `internal ${transport.internalMs ?? "-"} ms${transport.internalError ? ` (${transport.internalError})` : ""}, ` +
        `external ${transport.externalMs ?? "-"} ms${transport.externalError ? ` (${transport.externalError})` : ""}, ` +
        `fallback ${transport.fallback}, budget ${transport.budgetMs} ms per attempt, ${idx.length} documents, ${body.length} chars, ${usable} scored`
    );
  }

  const elapsedMs = Date.now() - stageStart;
  const summary = summariseRerankStage(plan, sentBatches);
  report.transport = { plan, batches: sentBatches, documents: documents.length, payloadChars, budgetMs, elapsedMs, ...summary, servedBy: [...new Set(sentBatches.map((r) => r.served).filter(Boolean))] };
  console.log(
    `[Reranker Dedicated API] stage: ${summary.planned} request(s) planned (≤ ${plan.maxDocs} documents / ${plan.maxChars} chars each), ` +
      `${summary.sent} sent, ${summary.failed} failed, ${summary.unsent} unsent, ${summary.scored} of ${documents.length} scored, ` +
      `${elapsedMs} ms of the ${budgetMs} ms deadline${summary.stoppedEarly ? " — the deadline stopped the stage" : ""}`
  );

  // Complete, or PARTIAL: the route decides which from the nulls (T10).
  if (summary.scored > 0) return orderByScore(scored);

  if (answered) {
    // The API answered and no score could be attributed (T10/E21): every
    // candidate stays unscored and the caller is told; no generative fallback
    // for an endpoint that is up and speaking.
    console.warn(`[Reranker Dedicated API] ${failureReason}`);
    report.degraded = retrievalDegradation(
      CODES.RERANK_DOWN,
      "rerank",
      `the configured reranker (${modelName}) returned no usable scores: ${failureReason}. ` +
        "Results are ordered by the underlying search only and the relevance " +
        "floor could not be applied, so they may include irrelevant passages."
    );
    return orderByScore(scored);
  }

  // Fallback to MLIS / OpenAI Chat Completions for Qwen3-Reranker-8B.
  //
  // T12: reaching here means the configured reranker did not score this query.
  // The generative fallback may recover some ordering, but it may equally leave
  // its 0.5 seed on every candidate — which passes any calibrated floor and
  // makes an irrelevant result set indistinguishable from a relevant one. The
  // caller is told so rather than being handed the scores as if they were real.
  report.degraded = retrievalDegradation(
    CODES.RERANK_DOWN,
    "rerank",
    `the configured reranker (${modelName}) did not score these results: ` +
      `${failureReason || "the score API returned no usable score array"}. ` +
      "Results are ordered by the underlying search only and the relevance " +
      "floor could not be applied, so they may include irrelevant passages."
  );

  console.log(`[Rerank MLIS Fallback] Dedicated /v1/rerank did not return score array. Scoring via MLIS Chat Completions.`);
  return await rerankViaOpenAiChatCompletions(query, candidates, rerankUrl, modelName, token, rerankProperty);
}

// Helper to rerank via Ollama's /api/generate using the Qwen3-Reranker prompt format.
async function rerankViaOllama(query, candidates, rerankUrl, modelName, token, rerankProperty) {
  let baseUrl = rerankUrl.trim().replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const generateUrl = `${baseUrl.replace(/\/+$/, "")}/api/generate`;

  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }

  console.log(`[Reranker Ollama] Reranking ${candidates.length} candidates via ${generateUrl} (Model: ${modelName})`);

  const batchSize = 5;
  // T10: seeded NULL, never 0.5 — same contract as the MLIS chat path above.
  const scoredCandidates = [...candidates].map(c => ({ ...c, rerankScore: null }));

  for (let i = 0; i < scoredCandidates.length; i += batchSize) {
    const batch = scoredCandidates.slice(i, i + batchSize);
    await Promise.all(batch.map(async (candidate, batchIdx) => {
      const idx = i + batchIdx;
      const docText = rerankProperty === "title" ? (candidate.source || "") : (candidate.text || "");
      // T10/FM-T3: head AND tail, not the leading third.
      const truncatedDoc = windowForRerank(docText);

      const prompt = `<Instruct>: Given a web search query, retrieve relevant passages that answer the query\n<Query>: ${query}\n<Document>: ${truncatedDoc}\nRelevant:`;

      try {
        const res = await fetchWithInternalFallback(generateUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName.trim(),
            prompt,
            stream: false,
            options: {
              num_predict: 5,
              temperature: 0.0
            }
          }),
        }, { budgetMs: 30000 });

        if (res.ok) {
          const data = await res.json();
          const parsed = parseVerdict(data?.response);
          scoredCandidates[idx].rerankScore = parsed;
          if (parsed === null) {
            console.log(
              `[Reranker Ollama] Unparseable response for candidate ${idx}: ` +
                `"${String(data?.response || "").slice(0, 80)}" — left unscored`
            );
          }
        }
      } catch (err) {
        console.warn(`[Reranker Ollama] Failed to score candidate ${idx}: ${err.message}`);
      }
    }));
  }

  return orderByScore(scoredCandidates);
}

// Unified reranking dispatcher — auto-detects Ollama vs dedicated rerank API
//
// T12: `report` is an out-parameter, not a behaviour change. The reranking
// helpers keep their existing return type and scoring semantics (those are
// ticket T10's contract); all this records is WHICH path ran, so the route can
// tell the caller that the scores it is returning were not produced by the
// configured reranker. Without it, a dead reranker is completely silent — see
// F-26: the dedicated API refuses, the generative fallback fails every call and
// leaves its 0.5 seed on every candidate, the 0.05 floor passes all of them,
// and an absence probe returns a full keepTopN of confidently irrelevant
// chunks with success:true. That is F-8, restored in full and presented as a
// successful search.
async function rerankCandidates(query, candidates, rerankUrl, modelName, token, rerankProperty = "content", rerankQueryOverride = "", report = {}, stage = {}) {
  const finalQuery = (rerankQueryOverride || "").trim() ? rerankQueryOverride.trim() : query;

  if (isOllamaEndpoint(rerankUrl)) {
    console.log(`[Reranker] Detected Ollama endpoint. Using /api/generate with Qwen3-Reranker prompt format.`);
    // A configured Ollama reranker is a deliberate choice, not a failure, so it
    // is not reported as degraded here even though its generative scoring is
    // weaker (F-9). Only paths that FAILED are reported.
    return await rerankViaOllama(finalQuery, candidates, rerankUrl, modelName, token, rerankProperty);
  }

  let targetUrl = rerankUrl.trim();
  if (!targetUrl.endsWith("/rerank") && !targetUrl.endsWith("/v1/rerank")) {
    const cleanUrl = targetUrl.endsWith("/") ? targetUrl.slice(0, -1) : targetUrl;
    if (cleanUrl.endsWith("/v1")) {
      targetUrl = `${cleanUrl}/rerank`;
    } else {
      targetUrl = `${cleanUrl}/v1/rerank`;
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

  return await rerankViaDedicatedApi(finalQuery, candidates, rerankUrl, modelName, token, rerankProperty, internalUrl, headers, report, stage);
}

export async function POST(req) {
  try {
    const body = await req.json();

    // One resolver for the whole retrieval config (ticket T08). Identity
    // fields are never silently defaulted: a vector-bearing request without
    // its embedding configuration is a typed 400, exactly like ingest.
    const resolved = resolveRetrievalConfig(body);
    if (!resolved.ok) {
      return NextResponse.json(
        retrievalErrorBody(resolved.error.code, resolved.error.message),
        { status: 400 }
      );
    }
    const cfg = resolved.config;

    const query = body.query;
    if (!query) {
      return NextResponse.json(
        retrievalErrorBody(CODES.QUERY_MISSING, "Query is required for retrieval."),
        { status: 400 }
      );
    }

    console.log(`[RAG Retrieval] Processing query: "${query}" via ${cfg.searchStrategy} search`);

    // T23 (design D4): each hop's credential is resolved AT THE POINT OF USE
    // through the one server-side seam — a non-empty request value wins
    // (user-owned), else the env token bound to that URL's origin, else the
    // workload identity (the vector store only), else nothing — and the
    // report names which source served each stage (T13's rule; F-22's
    // failure is a silent 403, so the source must be visible). The
    // resolver's pass-through of the three request fields is untouched
    // (U-CFG); only the EMPTY case changed.
    const embedCred = resolveCredential({ url: cfg.embedUrl, requestValue: cfg.token });
    const weaviateCred = resolveCredential({ url: cfg.weaviateUrl, requestValue: cfg.weaviateToken || cfg.token });
    const rerankCred = resolveCredential({ url: cfg.rerankUrl, requestValue: cfg.rerankToken || cfg.token });

    let queryVector = null;
    if (cfg.needsVector) {
      try {
        queryVector = await getEmbedding(query, cfg.embedUrl, cfg.embedModel, embedCred.value);
      } catch (err) {
        console.error("[Embedding Generation Failed]:", err.message);
        return NextResponse.json(
          retrievalErrorBody(
            CODES.EMBED_DOWN,
            `Embedding failure: ${err.message}. The query could not be embedded, so no search was performed.`
          ),
          { status: 500 }
        );
      }
    }

    const weaviateClient = new WeaviateClient(cfg.weaviateUrl, weaviateCred.value, cfg.weaviateCollection);

    // EMBED_MODEL_MISMATCH guard (T08, F-12/F-19): refuse a query embedded in
    // a different vector space than the collection, loudly and with the fix
    // named, instead of letting it die inside Weaviate as a silent empty set.
    // On a cache-hit mismatch, refresh once before erroring — the collection
    // may have been legitimately re-ingested with a different model.
    if (queryVector) {
      let collectionDim = await weaviateClient.getVectorDimension();
      let mismatch = checkVectorDimMatch(queryVector.length, collectionDim, {
        embedModel: cfg.embedModel,
        collection: cfg.weaviateCollection,
      });
      if (mismatch) {
        collectionDim = await weaviateClient.getVectorDimension({ refresh: true });
        mismatch = checkVectorDimMatch(queryVector.length, collectionDim, {
          embedModel: cfg.embedModel,
          collection: cfg.weaviateCollection,
        });
      }
      if (mismatch) {
        return NextResponse.json(retrievalErrorBody(mismatch.code, mismatch.message), { status: 400 });
      }
    }

    // T16 (design D7 / D8): the case T08's guard cannot see — the SAME
    // dimension under another model NAME. The pin is the ledger's reducer,
    // filtered by the store this request reads (D10). A mismatch is a
    // DEGRADATION on the 200, not an error: the results are real; what a
    // wrong-space vector arm costs is recall, and the person, the model and
    // the eval record are all told. A class with no record is `no_pin`, and
    // T08's guard is its whole protection. An unreadable ledger costs the
    // pin, never the retrieval (F-25's rule), and the report says so.
    let embedSpace = null;
    let embedDegradation = null;
    if (queryVector) {
      let pin = null;
      let pinSource;
      try {
        const ledgerPath = defaultLedgerPath();
        revalidateIndex(ledgerPath);
        // Under the CANONICAL class name (the client's, which is what the
        // ingest worker writes the ledger with); the resolver's name is not
        // canonicalised (review).
        pin = getCollectionPin(getIndex(ledgerPath).events, { collection: weaviateClient.className, store: storeOriginOf(cfg.weaviateUrl) });
      } catch (err) {
        console.warn(`[RAG Retrieve] ledger unreadable — the embedding-space pin is not checked for this query: ${err.message}`);
        pinSource = "ledger_unavailable";
      }
      embedSpace = buildEmbedSpaceReport(pin, { embedModel: cfg.embedModel, queryDim: queryVector.length, pinSource });
      embedDegradation = checkEmbedModelPinForQuery(pin, { embedModel: cfg.embedModel, queryDim: queryVector.length });
      if (embedDegradation) console.warn(`[RAG Retrieve] ${embedDegradation.code}: ${embedDegradation.message}`);
    }

    let candidates = [];
    // T15 (design D4): the optional document filter — applied INSIDE the
    // store's query (a `where`), then post-checked exactly when it rode on
    // the token-matched `source` property (F-109). Absent on every leg's
    // request, so the default path is byte-identical to T08's.
    let documentFilterReport = null;
    // T40 (design D2–D6): the keyword half scores the resolved property list
    // (`["text"]` by default; a request may name another, or "unrestricted");
    // the mode that ran and the list actually sent are measured off the
    // search for the report, never restated from the request.
    let searchOutcome = null;
    try {
      const searched = await weaviateClient.searchFiltered(
        query,
        queryVector,
        cfg.searchStrategy,
        cfg.poolSize,
        cfg.similarityThreshold,
        cfg.hybridAlpha,
        cfg.documentFilter,
        { searchProperties: cfg.searchProperties }
      );
      candidates = searched.rows;
      searchOutcome = { mode: searched.mode, searchProperties: searched.searchProperties };
      if (cfg.documentFilter) {
        const before = candidates.length;
        if (searched.applied === "source" || (searched.applied === null && cfg.documentFilter.sources.length > 0)) {
          const allowed = new Set(cfg.documentFilter.sources);
          candidates = candidates.filter((c) => allowed.has(c.source));
        }
        documentFilterReport = {
          requested: { sourceIds: cfg.documentFilter.sourceIds.length, sources: cfg.documentFilter.sources },
          applied: searched.applied,
          candidatesBeforePostCheck: before,
          droppedByPostCheck: before - candidates.length,
        };
      }
    } catch (err) {
      console.error("[Weaviate Retrieval Failed]:", err.message);
      return NextResponse.json(
        retrievalErrorBody(
          CODES.WEAVIATE_DOWN,
          `Weaviate query failure: ${err.message}. The vector store could not be searched, ` +
            "so nothing is known about what the corpus contains."
        ),
        { status: 500 }
      );
    }

    // keepTopNAfterRerank is an invariant of the response, not of one branch:
    // rerank on, rerank off, and rerank FAILED all slice to it (pre-T08 the
    // failure path returned the whole unfiltered pool).
    let finalResults;
    // T40 (design D7; F-155): identical text is shown once — the collapse runs
    // after the floor and before the keepTopN slice on EVERY path (a freed slot
    // refills from the next row), and the report says what it dropped.
    // A count turn says `collapseRepeats: false` (A9): every stored chunk is
    // scanned, and the report says the stage did not run.
    let repeatsCollapsed = null;
    const collapseThenSlice = (rows) => {
      if (cfg.collapseRepeats === false) {
        repeatsCollapsed = { count: 0, groups: [], applied: false };
        return rows.slice(0, cfg.keepTopNAfterRerank);
      }
      const collapsed = collapseRepeats(rows);
      repeatsCollapsed = { ...collapsed.report, applied: true };
      return collapsed.rows.slice(0, cfg.keepTopNAfterRerank);
    };
    const degraded = [];
    // T16: the embed-space degradation goes FIRST — the classifier reports
    // degraded[0], and a wrong vector space is the more fundamental fact
    // about these results than how they were ranked.
    if (embedDegradation) degraded.push(embedDegradation);
    // T13: whether the floor named by cfg.floorSource actually executed on
    // this call. The similarity floor runs inside search() (vector mode only);
    // the rerank floor runs below — and the throw path skips it entirely,
    // which the report must say rather than imply it ran (F-26 distinguishes
    // "floored fabricated scores" from "never floored at all").
    let floorApplied = cfg.floorSource === "similarity";
    // T10: how many candidates the reranker actually scored. `null` — never 0
    // — when reranking did not run at all, because 0 would assert a
    // measurement of work never attempted (E31).
    let candidatesScored = null;
    // F-163: which path served the dedicated rerank call, when one ran.
    let rerankTransport = null;
    if (candidates.length > 0 && cfg.rerankEffective) {
      const rerankReport = {};
      try {
        const reranked = await rerankCandidates(
          query,
          candidates,
          cfg.rerankUrl,
          cfg.rerankModel,
          rerankCred.value,
          cfg.rerankProperty,
          cfg.rerankQueryOverride,
          rerankReport,
          // T42 (D3, D4): the stage's per-request bounds and its deadline.
          { maxChars: cfg.rerankMaxChars, maxDocs: cfg.rerankMaxDocs, budgetMs: cfg.rerankBudgetMs }
        );

        // T10: candidate COVERAGE, measured before the floor and the slice.
        // This is the input to the DOWN-vs-PARTIAL decision below: with a
        // working reranker, nine candidates scored below the floor and one
        // left unscored is a PARTIAL failure (one unchecked passage shown),
        // not a dead reranker.
        candidatesScored = countScored(reranked);

        // The relevance floor (F-8/T10): applies to SCORED candidates only. An
        // unscored candidate passes — the repository owner's ruling, 2026-09-03.
        // Suppressing nulls would make a total rerank outage return zero
        // results for every query, presenting an infrastructure fault as "the
        // document doesn't mention it" (FM-L7 masking). It is safe ONLY because
        // the turn is disclosed as degraded, all the way to the UI (F-34).
        const floored = reranked.filter(c => passesFloor(c, cfg.minRerankScore));
        floorApplied = true;
        finalResults = collapseThenSlice(floored);
      } catch (err) {
        console.error("[Reranking Step Failed]:", err.message);
        finalResults = collapseThenSlice(candidates);
        // A throw here is not fatal: the candidates are real results from a
        // successful search. But they were never scored, so the relevance floor
        // never ran — say so instead of returning them as if it had (T12/F-26).
        degraded.push(
          retrievalDegradation(
            CODES.RERANK_DOWN,
            "rerank",
            `the reranking stage failed (${err.message}). Results are ordered by the ` +
              "underlying search only and the relevance floor could not be applied, " +
              "so they may include irrelevant passages."
          )
        );
      }

      rerankTransport = rerankReport.transport || null;

      // DESCRIBING the scoring runs OUTSIDE the try that produced the results
      // (F-25, the rule that moved bookkeeping out of retrieval's catch in
      // T12): composing a degradation message must never be able to discard a
      // successfully floored result set. `candidatesScored` is still null iff
      // the catch above ran — and that catch has already spoken — so the
      // branches are mutually exclusive and ONE degradation per stage holds.
      // T16 (review, HIGH): `degraded.length === 0` used to mean "the rerank
      // catch did not run"; with the embed degradation pushed first it would
      // also mean "no embed degradation", and a dead reranker under a
      // name-mismatched query would drop RERANK_DOWN from degraded[] — F-26's
      // shape again. The gate asks whether a RERANK degradation is recorded.
      if (candidatesScored !== null && !degraded.some((d) => d.stage === "rerank")) {
        const uncheckedReturned = finalResults.length - countScored(finalResults);
        if (rerankReport.degraded) {
          // The fallback transition already named the cause; a coverage
          // summary would say less about why.
          degraded.push(rerankReport.degraded);
        } else if (candidatesScored === 0) {
          degraded.push(
            retrievalDegradation(
              CODES.RERANK_DOWN,
              "rerank",
              `the configured reranker (${cfg.rerankModel}) scored none of the ` +
                `${candidates.length} candidates. Results are ordered by the underlying ` +
                "search only and the relevance floor could not be applied, so they may " +
                "include irrelevant passages."
            )
          );
        } else if (uncheckedReturned > 0) {
          degraded.push(
            retrievalDegradation(
              CODES.RERANK_PARTIAL,
              "rerank",
              `the configured reranker (${cfg.rerankModel}) scored ${candidatesScored} of ` +
                `${candidates.length} candidates, so ${uncheckedReturned} of the ` +
                `${finalResults.length} passages returned were never relevance-checked. ` +
                "Those passages are listed last and passed the relevance floor unchecked, " +
                "so they may be irrelevant; the ordering of the others is real."
            )
          );
        }
      }
    } else {
      finalResults = collapseThenSlice(candidates);
    }

    // T13: the retrieval report — resolved config + measured outcome, so a
    // caller can see what the search actually did (pool depth, floor, score
    // shape) instead of inferring it. Additive; built from `cfg` and measured
    // values only, never from the request body (F-25).
    const report = buildRetrievalReport({
      cfg,
      candidatesReturned: candidates.length,
      results: finalResults,
      floorApplied,
      candidatesScored,
      credentialSources: {
        embed: cfg.needsVector ? embedCred.source : null,
        weaviate: weaviateCred.source,
        rerank: cfg.rerankEffective ? rerankCred.source : null,
      },
      documentFilter: documentFilterReport,
      // T40: measured off the search that ran (D3, D6) and the collapse (D7).
      searchMode: searchOutcome ? searchOutcome.mode : undefined,
      searchProperties: searchOutcome ? searchOutcome.searchProperties : undefined,
      repeatsCollapsed,
    });
    // T16: what the pin check compared, on every vector-bearing response.
    if (embedSpace) report.embedSpace = embedSpace;
    // F-163: which path served the dedicated rerank call and what each attempt cost.
    if (rerankTransport) report.rerankTransport = rerankTransport;

    // `degraded` is omitted entirely when nothing degraded, so its presence is
    // itself the signal and older clients are unaffected.
    return NextResponse.json({
      success: true,
      results: finalResults,
      report,
      ...(degraded.length ? { degraded } : {}),
    });

  } catch (error) {
    // Every error response from this route carries a code — an untyped error is
    // exactly what the orchestrator cannot map, and an unmappable error is how
    // an infrastructure failure became "the document doesn't mention it".
    console.error("[RAG Retrieval Endpoint Error]:", error);
    return NextResponse.json(
      retrievalErrorBody(CODES.RETRIEVE_INTERNAL, error.message),
      { status: 500 }
    );
  }
}
