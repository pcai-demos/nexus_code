import { NextResponse } from "next/server";
import { runCodingTurn } from "@/lib/coding/turn";

// Machinery PR 1 (brief §8 M1; design §4; decision D6): one coding turn, streamed to the page as newline-delimited
// JSON events — start, pillars, pillar (one per layer as its search returns), generation, delta (answer text),
// reasoning (a running character count), then `final` with the whole response object in the shape the page already
// reads from POST /api/ide-bridge, or `error`. Closing the stream aborts the searches and the model call.
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the request body is not JSON" }, { status: 400 });
  }
  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "Message parameter is required" }, { status: 400 });
  }

  const abort = new AbortController();
  if (request.signal) request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (event) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        const data = await runCodingTurn({ body, emit, signal: abort.signal });
        emit({ type: "final", data });
      } catch (err) {
        console.error("[Coding Turn API] Error:", err);
        emit({ type: "error", message: `Internal server error: ${err.message}` });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
