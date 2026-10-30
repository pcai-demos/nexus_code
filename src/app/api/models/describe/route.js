import { NextResponse } from "next/server";
import { describeModel } from "@/lib/models/litellm_backends";

export const dynamic = "force-dynamic";

/**
 * D31 (2026-10-30): what a LiteLLM model can do in NexCode, checked when the presenter picks it — whether it runs on
 * Ollama, and so whether thinking off, figure captioning and Ollama reranking are available with it. Body:
 * { model, token? } (a typed key wins; else the server's LiteLLM credential). The key never comes back.
 */
export async function POST(request) {
  const body = (await request.json().catch(() => ({}))) || {};
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return NextResponse.json({ error: "Name a model to check." }, { status: 400 });
  try {
    const info = await describeModel(model, { token: typeof body.token === "string" ? body.token : "" });
    const { backend, ...rest } = info;
    return NextResponse.json({ ...rest, backendModel: backend ? backend.model : null });
  } catch (error) {
    return NextResponse.json(
      { model, error: `LiteLLM could not be asked about ${model}: ${error.message}. Check the LiteLLM endpoint and key.` },
      { status: 502 },
    );
  }
}
