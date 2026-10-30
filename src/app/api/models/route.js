process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { NextResponse } from "next/server";
// T23 (design D7) — the field's value when typed, else the server's credential bound to this endpoint's origin; the response says which.
import { resolveCredential } from "@/lib/credentials";

const DEFAULT_MOCK_MODELS = [
  "qwen3-coder:30b",
  "qwen3.6:27b",
  "gemma4:26b",
  "llama3.2:3b",
  "deepseek-coder:1.5b",
  "custom-developer-model"
];

export async function GET(request) {
  // T23 (design D7): which source served this test's credential — a name, never a value.
  let credentialSource = "none";
  try {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get("endpoint");
    const token = searchParams.get("token");

    if (!endpoint) {
      return NextResponse.json({ credentialSource, error: "endpoint parameter is required" }, { status: 400 });
    }

    // Standardize URL to endpoint/v1/models or endpoint/models
    let targetUrl = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
    if (!targetUrl.endsWith("/models")) {
      if (targetUrl.endsWith("/v1")) {
        targetUrl = `${targetUrl}/models`;
      } else {
        targetUrl = `${targetUrl}/v1/models`;
      }
    }

    const headers = {
      "Content-Type": "application/json",
    };
    // T23 (design D7): the query's token when given (F-104: it travels in the URL — filed), else the
    // env token bound to this endpoint's origin (LiteLLM; none for Ollama).
    const cred = resolveCredential({ url: endpoint, requestValue: token || "" });
    credentialSource = cred.source;
    if (cred.value) {
      headers["Authorization"] = `Bearer ${cred.value}`;
    }

    try {
      console.log(`Proxying models request to: ${targetUrl}`);
      const res = await fetch(targetUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(3000), // Short timeout for snappy local fallback
      });

      if (res.ok) {
        const data = await res.json();
        const models = [];
        if (data && Array.isArray(data.data)) {
          data.data.forEach((m) => {
            if (m.id) models.push(m.id);
          });
        }
        if (models.length > 0) {
          return NextResponse.json({ credentialSource, models });
        }
      }
    } catch (e) {
      console.log("Remote models lookup failed, serving mock models list instead.");
    }

    // Snappy fallback list for offline/local development
    return NextResponse.json({ credentialSource, models: DEFAULT_MOCK_MODELS });
  } catch (error) {
    return NextResponse.json({ credentialSource, models: DEFAULT_MOCK_MODELS });
  }
}
