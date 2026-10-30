
import { NextResponse } from "next/server";
// T23 (design D7) — the field's value when typed, else the server's credential bound to this endpoint's origin; the response says which.
import { resolveCredential } from "@/lib/credentials";

/**
 * Detect whether an endpoint URL points to an Ollama instance.
 */
function isOllamaEndpoint(url) {
  const lower = (url || "").toLowerCase();
  return lower.includes("ollama") || lower.includes(":11434");
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
 * Build standard OpenAI Chat Completions URL for vision models.
 */
function buildOpenAiVisionUrl(endpoint) {
  let baseUrl = endpoint.trim();
  if (!baseUrl.endsWith("/chat/completions")) {
    const cleanUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    if (cleanUrl.endsWith("/v1")) {
      return `${cleanUrl}/chat/completions`;
    }
    return `${cleanUrl}/v1/chat/completions`;
  }
  return baseUrl;
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

    // Small 1x1 transparent PNG Base64 string for testing multimodal VLM image analysis
    const testImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    if (isOllamaEndpoint(endpoint)) {
      const generateUrl = buildOllamaGenerateUrl(endpoint);
      console.log(`[VLM Test] Testing Ollama VLM at: ${generateUrl} (Model: ${model})`);

      const payload = {
        model: model.trim(),
        prompt: "Describe this test image in one short sentence.",
        images: [testImageBase64],
        stream: false,
        options: {
          num_predict: 30,
          temperature: 0.0
        }
      };

      const res = await fetch(generateUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });

      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ credentialSource,
          success: true,
          provider: "Ollama VLM (via /api/generate)",
          targetUrl: generateUrl,
          data
        });
      } else {
        const errText = await res.text();
        return NextResponse.json({ credentialSource,
          success: false,
          provider: "Ollama VLM",
          targetUrl: generateUrl,
          status: res.status,
          error: errText || `Returned status ${res.status}`
        });
      }
    } else {
      const targetUrl = buildOpenAiVisionUrl(endpoint);
      console.log(`[VLM Test] Testing OpenAI-compatible VLM at: ${targetUrl} (Model: ${model})`);

      const payload = {
        model: model.trim(),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this test image in one short sentence." },
              { type: "image_url", image_url: { url: `data:image/png;base64,${testImageBase64}` } }
            ]
          }
        ],
        max_tokens: 50
      };

      const res = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });

      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ credentialSource,
          success: true,
          provider: "OpenAI Vision Compatible API",
          targetUrl,
          data
        });
      } else {
        const errText = await res.text();
        return NextResponse.json({ credentialSource,
          success: false,
          provider: "OpenAI Vision Compatible API",
          targetUrl,
          status: res.status,
          error: errText || `Returned status ${res.status}`
        });
      }
    }
  } catch (err) {
    console.error("[VLM Test] Connection test error:", err.message);
    return NextResponse.json({ credentialSource, success: false, error: err.message });
  }
}
