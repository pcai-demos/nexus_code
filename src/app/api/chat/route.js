import { NextResponse } from "next/server";
import { orchestrate } from "@/lib/orchestrator";
// T23 — the test query's credential through the one server-side seam (design D4 / D7).
import { resolveCredential } from "@/lib/credentials";

// Allow self-signed certs for internal cluster endpoints

// Mirror the orchestrator's internal URL translation for cluster-local routing
function translateToInternalUrl(urlText) {
  const url = urlText.trim();
  if (url.includes("ollama.demo.lon-pcai.twlon.com")) {
    return {
      url: url.replace("https://ollama.demo.lon-pcai.twlon.com", "http://ollama.ollama.svc.cluster.local:11434"),
      headers: {}
    };
  }
  if (url.includes("nemotron.project-demos.serving.demo.lon-pcai.twlon.com")) {
    return {
      url: url.replace("https://nemotron.project-demos.serving.demo.lon-pcai.twlon.com", "http://nemotron.project-demos.svc.cluster.local:80"),
      headers: { "Host": "nemotron.project-demos.serving.demo.lon-pcai.twlon.com" }
    };
  }
  return { url, headers: {} };
}

// Normalise endpoint URL to OpenAI-compatible /v1/chat/completions path
function normaliseCompletionsUrl(rawUrl) {
  let url = rawUrl.trim();
  if (url.endsWith("/chat/completions") || url.endsWith("/llm/chat")) return url;
  url = url.endsWith("/") ? url.slice(0, -1) : url;
  return url.endsWith("/v1") ? `${url}/chat/completions` : `${url}/v1/chat/completions`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { message, isTestQuery, history, adminConfig } = body;

    // ── Test Query: bypass orchestrator, call model directly ──────────
    // This avoids the NexCODE persona system prompt so the model reveals
    // its true identity (e.g. Qwen, Nemotron, Llama, etc.)
    if (isTestQuery) {
      const rawEndpoint = adminConfig?.nimEndpoint || "";
      if (!rawEndpoint) {
        return NextResponse.json({ response: "No inference endpoint URL is configured." });
      }

      const completionsUrl = normaliseCompletionsUrl(rawEndpoint);
      const { url: internalUrl, headers: internalHeaders } = translateToInternalUrl(completionsUrl);
      const modelName = adminConfig?.nimModelName || adminConfig?.ollamaModelName || adminConfig?.liteLlmModelName || "unknown";
      // T23: the active token when typed, else the env token bound to this endpoint's origin.
      const testCred = resolveCredential({ url: rawEndpoint, requestValue: adminConfig?.nimApiKey || "" });
      const apiKey = testCred.value;

      console.log(`[Test Query] Endpoint: ${internalUrl}, Model: ${modelName}`);

      try {
        const llmRes = await fetch(internalUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...internalHeaders,
            ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: "system", content: adminConfig?.systemPrompt || "You are a helpful assistant. State your name and model name briefly." },
              { role: "user", content: `/no_think ${message}` }
            ],
            temperature: 0.1,
            max_tokens: 512,
            stream: false
          }),
          signal: AbortSignal.timeout(60000)
        });

        if (!llmRes.ok) {
          const errBody = await llmRes.text();
          console.error(`[Test Query] HTTP ${llmRes.status}: ${errBody}`);
          return NextResponse.json({ response: `Model endpoint returned status ${llmRes.status}: ${errBody}` });
        }

        const llmData = await llmRes.json();
        const choice = llmData.choices?.[0];
        const msg = choice?.message;

        // Log the full message object so we can see exactly what Qwen3/Ollama returns
        console.log("[Test Query] Full choice object:", JSON.stringify(choice, null, 2));
        console.log("[Test Query] Message keys:", msg ? Object.keys(msg).join(", ") : "no message");

        // Extract text from all known response fields:
        //  - content: standard OpenAI field (may be "" with Qwen3 thinking mode)
        //  - reasoning_content: Qwen3/DeepSeek thinking mode field
        //  - reasoning: alternative thinking field name
        //  - think: another alternative
        const content = msg?.content || "";
        const reasoning = msg?.reasoning_content || msg?.reasoning || msg?.think || "";

        let text = "";

        // If content has text, use it (strip any <think> blocks)
        if (content) {
          text = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
          // If stripping left nothing, use the raw content
          if (!text) text = content.trim();
        }

        // If content was empty but reasoning has the actual answer, use that
        if (!text && reasoning) {
          text = reasoning.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
          if (!text) text = reasoning.trim();
        }

        // Fallback: try Ollama native response formats
        if (!text) {
          text = llmData.message?.content || llmData.response || llmData.content || "";
        }

        // Final fallback: dump what we actually got for debugging
        if (!text) {
          const msgDump = msg ? JSON.stringify(msg).slice(0, 500) : "null";
          return NextResponse.json({
            response: `Model responded but content was empty. Message object: ${msgDump}`
          });
        }

        return NextResponse.json({ response: text.trim(), credentialSource: testCred.source });
      } catch (fetchErr) {
        console.error("[Test Query] Fetch error:", fetchErr.message);
        return NextResponse.json({ response: `Test query failed: ${fetchErr.message}` });
      }
    }

    // ── Normal query: full orchestrator pipeline ──────────────────────
    const result = await orchestrate({
      message,
      history,
      adminConfig,
      // T28 (design D15): an optional document scope on the request — the
      // hook a file-tray selection will set; today only the API sends it.
      documentScope: body.documentScope ?? null,
      ideState: null,
      originUrl: request.nextUrl.origin
    });

    // T12: `success`, `retrieval` and `retrievalError` are forwarded rather
    // than dropped. Pre-T12 this response hardcoded `error: null` and carried
    // no success flag at all, so a total infrastructure failure and a good
    // answer were indistinguishable to every consumer of this route.
    return NextResponse.json({
      success: result.success,
      response: result.response,
      sql_query: result.sql_query,
      explanation: result.explanation,
      target_view: "local.dev",
      visualization_hint: "table",
      rows: [],
      error: result.error ?? null,
      retrieval: result.retrieval,
      ...(result.retrievalError ? { retrievalError: result.retrievalError } : {}),
      ...(result.bookkeepingError ? { bookkeepingError: result.bookkeepingError } : {}),
      // T23: which credential source served each hop (names only, design D4).
      ...(result.credentialSources ? { credentialSources: result.credentialSources } : {}),
      // T14: structured citations and the fabrication flag. Present (possibly
      // empty) when the audit ran; absent when it did not.
      ...(result.citations ? { citations: result.citations, uncitedClaims: result.uncitedClaims } : {}),
      // T28 (design D6, §13.5): what context assembly did on this turn —
      // null when the step did not run ("did not run" is not "added 0").
      contextAssembly: result.contextAssembly ?? null,
      documentScope: result.documentScope ?? null,
      // T15 (design D13): the router's verdict — mode, why, intent and the
      // model pair by name — so the page shows what the turn was.
      router: result.router ?? null,
      // T36 (design D1; A16's rule — memory chat-route-projects-result-fields):
      // the generator's outcome (finish reason, cut, code, budget, the split)
      // reaches the wire only because it is named here.
      generation: result.generation ?? null,
      // T43 (design §2.2 / §2.3; A16's rule): the turn's clock, stages, tokens
      // and model — named here or null on the wire (F-179).
      timing: result.timing ?? null,
      // T48 (design §2.4; A16's rule): the answer policy — the setting, the section as written, the notes, the rules —
      // named here or null on the wire.
      answerPolicy: result.answerPolicy ?? null,
      traces: result.traces || [],
      telemetry: result.telemetry
    });

  } catch (error) {
    console.error("[Chat API Error]:", error);
    return NextResponse.json(
      { error: "Internal server error: " + error.message },
      { status: 500 }
    );
  }
}
