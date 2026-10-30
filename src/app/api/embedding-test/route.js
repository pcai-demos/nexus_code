
import { NextResponse } from "next/server";
// T23 (design D7) — the field's value when typed, else the server's credential bound to this endpoint's origin; the response says which.
import { resolveCredential } from "@/lib/credentials";

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

    // Standardize URL to point to /v1/embeddings or /embeddings
    let targetUrl = endpoint.trim();
    if (!targetUrl.endsWith("/embeddings") && !targetUrl.endsWith("/v1/embeddings")) {
      const cleanUrl = targetUrl.endsWith("/") ? targetUrl.slice(0, -1) : targetUrl;
      if (cleanUrl.endsWith("/v1")) {
        targetUrl = `${cleanUrl}/embeddings`;
      } else {
        targetUrl = `${cleanUrl}/v1/embeddings`;
      }
    }

    console.log(`[Embedding Test] Proxying test to: ${targetUrl} (Model: ${model})`);

    const headers = {
      "Content-Type": "application/json"
    };

    const cred = resolveCredential({ url: endpoint, requestValue: apiKey || "" });
    credentialSource = cred.source;
    apiKey = cred.value;
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const payload = {
      model: model.trim(),
      input: ["test query"]
    };

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({ credentialSource, success: true, data });
    } else {
      const errText = await res.text();
      return NextResponse.json({ credentialSource,
        success: false,
        status: res.status,
        error: errText || `Returned status ${res.status}`
      });
    }
  } catch (err) {
    console.error("[Embedding Test] Connection test error:", err.message);
    return NextResponse.json({ credentialSource, success: false, error: err.message });
  }
}
