process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { NextResponse } from "next/server";
// T23 (design D7) — the field's value when typed, else the server's credential bound to this endpoint's origin; the response says which.
import { resolveCredential } from "@/lib/credentials";
// F-163 — the same fallback helper the retrieve route uses, a budget per attempt.
import { fetchWithInternalFallback as fetchWithFallback } from "@/lib/rag/fallback_fetch";

/**
 * Translate external domain to internal k8s cluster DNS for HPE MLIS.
 */
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

/**
 * Helper: fetch with internal cluster URL first, with fallback to external URL.
 * F-163: a budget per attempt — the caller names `budgetMs`, never a signal.
 */
function fetchWithInternalFallback(targetUrl, options, { budgetMs, trace = null }) {
  return fetchWithFallback(targetUrl, options, {
    budgetMs,
    trace,
    translate: translateToInternalUrl,
    log: (line) => console.log(`[Rerank Test] ${line}`),
  });
}

/**
 * Detect whether an endpoint URL points to an Ollama instance.
 */
function isOllamaEndpoint(url) {
  const lower = (url || "").toLowerCase();
  return lower.includes("ollama") || lower.includes(":11434");
}

/**
 * Build the standard rerank API URL for dedicated services (HPE MLIS, TEI, Jina, vLLM).
 */
function buildRerankUrl(endpoint) {
  let targetUrl = endpoint.trim();
  if (!targetUrl.endsWith("/rerank") && !targetUrl.endsWith("/v1/rerank")) {
    const cleanUrl = targetUrl.endsWith("/") ? targetUrl.slice(0, -1) : targetUrl;
    if (cleanUrl.endsWith("/v1")) {
      targetUrl = `${cleanUrl}/rerank`;
    } else {
      targetUrl = `${cleanUrl}/v1/rerank`;
    }
  }
  return targetUrl;
}

/**
 * Build the Ollama /api/generate URL from the user-provided endpoint.
 */
function buildOllamaGenerateUrl(endpoint) {
  let baseUrl = endpoint.trim();
  baseUrl = baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  return `${baseUrl}/api/generate`;
}

/**
 * Test reranking via a dedicated rerank API (standard /v1/rerank format or HPE MLIS Chat Completions fallback).
 */
async function testDedicatedRerank(targetUrl, model, origHeaders, rawEndpoint) {
  const payload = {
    model: model.trim(),
    query: "What is the capital of France?",
    documents: [
      "Paris is the capital of France.",
      "Berlin is the capital of Germany."
    ]
  };

  // 1. Attempt native /v1/rerank
  try {
    const res = await fetchWithInternalFallback(targetUrl, {
      method: "POST",
      headers: origHeaders,
      body: JSON.stringify(payload),
    }, { budgetMs: 15000 });

    if (res.ok) {
      const data = await res.json();
      if (!data.error && (Array.isArray(data.results) || Array.isArray(data.data) || Array.isArray(data))) {
        return { success: true, provider: "Dedicated Rerank API (/v1/rerank)", targetUrl, data };
      }
      console.warn(`[Rerank Test] /v1/rerank returned error payload (attempting Chat Completions fallback):`, data.error || data);
    }
  } catch (err) {
    console.warn(`[Rerank Test] Dedicated /v1/rerank endpoint test failed: ${err.message}. Trying Chat Completions fallback...`);
  }

  // 2. Fallback for HPE MLIS / vLLM OpenAI-compatible Chat Completions endpoints hosting Qwen3-Reranker-8B
  try {
    let cleanBase = rawEndpoint.trim().replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    const chatEndpoint = `${cleanBase}/v1/chat/completions`;

    const chatPayload = {
      model: model.trim(),
      messages: [
        {
          role: "user",
          content: `<Instruct>: Given a web search query, retrieve relevant passages that answer the query\n<Query>: What is the capital of France?\n<Document>: Paris is the capital of France.\nRelevant:`
        }
      ],
      temperature: 0.0,
      max_tokens: 10
    };

    const chatRes = await fetchWithInternalFallback(chatEndpoint, {
      method: "POST",
      headers: origHeaders,
      body: JSON.stringify(chatPayload),
    }, { budgetMs: 15000 });

    if (chatRes.ok) {
      const chatData = await chatRes.json();
      const outputText = chatData?.choices?.[0]?.message?.content || "";

      return {
        success: true,
        provider: "HPE MLIS / OpenAI Chat Completions (Qwen3-Reranker)",
        targetUrl: chatEndpoint,
        modelResponse: outputText || "Endpoint responded with HTTP 200 OK",
        note: "HPE MLIS inference engine endpoint validated successfully via OpenAI Chat Completions API with Qwen3-Reranker model.",
        data: chatData
      };
    } else {
      const errText = await chatRes.text();
      return {
        success: false,
        provider: "HPE MLIS Dedicated Rerank API",
        targetUrl,
        status: chatRes.status,
        error: errText || `Returned status ${chatRes.status}`
      };
    }
  } catch (chatErr) {
    return {
      success: false,
      provider: "HPE MLIS Dedicated Rerank API",
      targetUrl,
      error: chatErr.message
    };
  }
}

/**
 * Test reranking via Ollama /api/generate.
 */
async function testOllamaRerank(generateUrl, model, origHeaders) {
  const testQuery = "What is the capital of France?";
  const testDoc = "Paris is the capital of France.";

  const prompt = `<Instruct>: Given a web search query, retrieve relevant passages that answer the query\n<Query>: ${testQuery}\n<Document>: ${testDoc}\nRelevant:`;

  const payload = {
    model: model.trim(),
    prompt,
    stream: false,
    options: {
      num_predict: 10,
      temperature: 0.0
    }
  };

  const res = await fetchWithInternalFallback(generateUrl, {
    method: "POST",
    headers: origHeaders,
    body: JSON.stringify(payload),
  }, { budgetMs: 30000 });

  if (res.ok) {
    const data = await res.json();
    return {
      success: true,
      provider: "Ollama (via /api/generate with Qwen3-Reranker prompt format)",
      targetUrl: generateUrl,
      modelResponse: data?.response || "",
      note: "Ollama reranking validated using /api/generate with Qwen3-Reranker prompt format.",
      data
    };
  } else {
    const errText = await res.text();
    return {
      success: false,
      provider: "Ollama (via /api/generate)",
      targetUrl: generateUrl,
      status: res.status,
      error: errText || `Returned status ${res.status}`
    };
  }
}

export async function POST(req) {
  // T23 (design D7): which source served this test's credential — a name, never a value.
  let credentialSource = "none";
  try {
    const body = await req.json();
    let { endpoint, model, apiKey } = body;

    if (!endpoint) {
      return NextResponse.json({ credentialSource, success: false, error: "Endpoint URL is required." });
    }
    if (!model) {
      return NextResponse.json({ credentialSource, success: false, error: "Model Name is required." });
    }

    const headers = {
      "Content-Type": "application/json"
    };

    const cred = resolveCredential({ url: endpoint, requestValue: apiKey || "" });
    credentialSource = cred.source;
    apiKey = cred.value;
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    if (isOllamaEndpoint(endpoint)) {
      console.log(`[Rerank Test] Detected Ollama endpoint. Using /api/generate with Qwen3-Reranker prompt format.`);
      const generateUrl = buildOllamaGenerateUrl(endpoint);
      const result = await testOllamaRerank(generateUrl, model, headers);
      return NextResponse.json({ ...result, credentialSource });
    } else {
      const targetUrl = buildRerankUrl(endpoint);
      console.log(`[Rerank Test] Testing dedicated rerank API: ${targetUrl} (Model: ${model})`);
      const result = await testDedicatedRerank(targetUrl, model, headers, endpoint);
      return NextResponse.json({ ...result, credentialSource });
    }
  } catch (err) {
    console.error("[Rerank Test] Connection test error:", err.message);
    return NextResponse.json({ credentialSource, success: false, error: err.message });
  }
}

