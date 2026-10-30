import { NextResponse } from "next/server";
import path from "path";
import { orchestrate } from "@/lib/orchestrator";
// E2 (CA-001): the one containment rule for a caller-named path (src/lib/coding/paths.js).
import { resolveInside, PathContainmentError } from "@/lib/coding/paths";
// Machinery PR 1 (design §7; D8): an Apply is one line in the coding run log (the evidence record reads it).
import { appendRun } from "@/lib/coding/runlog";
// 2026-10-12: what the app writes into the workspace is group-writable, so the IDE user can change and remove it.
import { writeGroupWritable } from "@/lib/coding/workspace_write";

const BRIDGE_EXT_URL = "http://127.0.0.1:9100";
const WORKSPACE_ROOT = path.join(process.cwd(), "nexcode-data", "workspace");
// E3 (CA-002): the bridge extension listens on the pod's loopback only and answers only a request that carries
// this header with the token the chart renders into BOTH containers (helm/values.yaml ide.bridgeToken). Unset here
// means every bridge call fails closed (bridgeConnected: false) — never a bridge without the header.
const BRIDGE_HEADER = "X-NexCODE-Bridge";
const bridgeHeaders = (extra = {}) => ({ [BRIDGE_HEADER]: process.env.NEXCODE_BRIDGE_TOKEN || "", ...extra });

// Helper: Fetch IDE state from Bridge Extension
async function getIDEState() {
  try {
    const res = await fetch(`${BRIDGE_EXT_URL}/api/state`, {
      headers: bridgeHeaders(),
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      return await res.json();
    }
    console.warn("[IDE Bridge] Extension returned status:", res.status);
    return null;
  } catch (err) {
    console.warn("[IDE Bridge] Cannot reach Bridge Extension:", err.message);
    return null;
  }
}

// Helper: Send action to Bridge Extension
async function sendIDEAction(action) {
  try {
    const res = await fetch(`${BRIDGE_EXT_URL}/api/action`, {
      method: "POST",
      headers: bridgeHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(action),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return await res.json();
    }
    const errText = await res.text();
    console.warn("[IDE Bridge] Action failed:", errText);
    return { success: false, error: errText };
  } catch (err) {
    console.warn("[IDE Bridge] Action error:", err.message);
    return { success: false, error: err.message };
  }
}

// Helper: the app's own write into the workspace, for "Apply" when the IDE's bridge did not write the file
// E2 (CA-001): the path is contained under the workspace root BEFORE any directory is made — an absolute path, a
// parent segment or a path that resolves outside the root throws PathContainmentError and nothing is written.
// 2026-10-12: the app runs as root; the folders and the file it makes are group-writable for the IDE user.
function writeWorkspaceFile(relativePath, content) {
  const fullPath = resolveInside(WORKSPACE_ROOT, relativePath);
  writeGroupWritable(fullPath, content);
  console.log(`[IDE Bridge] Wrote file (app): ${relativePath}`);
}

// POST /api/ide-bridge
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      message,
      history,
      adminConfig,
      intent,
      applyOperation,
    } = body;

    // CASE A: Apply a pending file operation
    if (applyOperation) {
      const op = applyOperation;
      console.log(`[IDE Bridge] Applying operation: ${op.type} → ${op.path}`);

      const content = typeof op.content === "string" ? op.content : "";
      // The path is contained first — a refused path is HTTP 400 and reaches the extension never (E2).
      try {
        resolveInside(WORKSPACE_ROOT, op.path);
      } catch (err) {
        if (err instanceof PathContainmentError) {
          console.warn(`[IDE Bridge] Refused a write outside the workspace: ${JSON.stringify(op.path)} (${err.message})`);
          appendRun({ kind: "apply", path: typeof op.path === "string" ? op.path : null, ok: false, error: err.message });
          return NextResponse.json(
            { success: false, error: `Refused: ${err.message}`, code: err.code, path: op.path ?? null },
            { status: 400 }
          );
        }
        throw err;
      }

      // 2026-10-12: the IDE user writes the file (the bridge's writeFile, which also opens it in the editor), so a reset
      // can remove whatever Apply made; the app writes it only when the bridge did not, group-writable. Apply as root
      // once made folders the IDE user could not delete, and a reset stopped halfway on them.
      const extResult = await sendIDEAction({
        type: "writeFile",
        path: op.path,
        content,
      });
      let via = "bridge";
      if (!extResult || !extResult.success) {
        writeWorkspaceFile(op.path, content);
        via = "app";
      }
      appendRun({ kind: "apply", path: op.path, ok: true, via });

      return NextResponse.json({
        success: true,
        applied: {
          path: op.path,
          type: op.type,
          via,
          extensionResult: extResult,
        },
      });
    }

    // CASE B: Process a chat message with IDE context
    if (!message) {
      return NextResponse.json(
        { error: "Message parameter is required" },
        { status: 400 }
      );
    }

    // Fetch current IDE state from Bridge Extension
    const ideState = await getIDEState();
    const bridgeConnected = ideState !== null;

    // Delegate orchestration to unified orchestrator
    const result = await orchestrate({
      message,
      history,
      adminConfig,
      // T15 (design D4 / D11): the same request-level scope the chat route
      // forwards — a `/code` turn may still be about one document.
      documentScope: body.documentScope ?? null,
      ideState,
      originUrl: request.nextUrl.origin
    });

    return NextResponse.json({
      // T12: this route delegates to the same orchestrator as /api/chat, so it
      // inherits the same failure taxonomy. Dropping these fields here would
      // leave the IDE path masking failures exactly as the chat path used to.
      success: result.success,
      response: result.explanation,
      intent: result.intent,
      retrieval: result.retrieval,
      ...(result.retrievalError ? { retrievalError: result.retrievalError } : {}),
      ...(result.bookkeepingError ? { bookkeepingError: result.bookkeepingError } : {}),
      error: result.error ?? null,
      bridgeConnected,
      ideContext: ideState
        ? {
            activeFile: ideState.activeFile
              ? {
                  path: ideState.activeFile.path,
                  language: ideState.activeFile.language,
                  lineCount: ideState.activeFile.lineCount,
                  isDirty: ideState.activeFile.isDirty,
                }
              : null,
            openTabCount: ideState.openTabs?.length || 0,
          }
        : null,
      fileOperations: result.fileOperations,
      // T15 (design D13, A16's rule): the router's verdict and the two T28
      // fields ride this route too — it delegates to the same orchestrator.
      contextAssembly: result.contextAssembly ?? null,
      documentScope: result.documentScope ?? null,
      router: result.router ?? null,
      // T36 (design D1 / D2; A16's rule): the generator's outcome rides this
      // route too — its consumer is the IDE, and an empty cut is a failure
      // here as on /api/chat (a silent nothing used to be a success).
      generation: result.generation ?? null,
      // T43 (design §2.3; A16's rule): the turn's timing rides this route too.
      timing: result.timing ?? null,
      // T48 (design §2.4; A16's rule): the answer policy rides this route too.
      answerPolicy: result.answerPolicy ?? null,
      ...(result.citations ? { citations: result.citations, uncitedClaims: result.uncitedClaims } : {}),
      traces: result.traces || [],
      telemetry: result.telemetry
    });

  } catch (error) {
    console.error("[IDE Bridge API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error: " + error.message },
      { status: 500 }
    );
  }
}

// GET /api/ide-bridge — Return current IDE state
export async function GET() {
  const ideState = await getIDEState();
  return NextResponse.json({
    bridgeConnected: ideState !== null,
    state: ideState,
  });
}
