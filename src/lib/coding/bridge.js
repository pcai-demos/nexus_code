/**
 * src/lib/coding/bridge.js — the coding side's calls to the IDE bridge extension (Machinery PR 1, design §6).
 *
 * The extension listens on the pod's loopback (127.0.0.1:9100) inside the IDE window's extension host and answers only
 * a request carrying X-NexCODE-Bridge = NEXCODE_BRIDGE_TOKEN (E3). The original route's two calls stay where they are
 * (src/app/api/ide-bridge/route.js, pinned by U-PATHS); the new routes call through here. Every call fails soft: an
 * unreachable bridge is `null` / `{ success: false }`, never a thrown error.
 */

const BRIDGE_EXT_URL = "http://127.0.0.1:9100";
const BRIDGE_HEADER = "X-NexCODE-Bridge";

export function bridgeHeaders(extra = {}) {
  return { [BRIDGE_HEADER]: process.env.NEXCODE_BRIDGE_TOKEN || "", ...extra };
}

async function getJson(pathName, timeoutMs) {
  try {
    const res = await fetch(`${BRIDGE_EXT_URL}${pathName}`, { headers: bridgeHeaders(), signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function postJson(pathName, body, timeoutMs) {
  try {
    const res = await fetch(`${BRIDGE_EXT_URL}${pathName}`, {
      method: "POST",
      headers: bridgeHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null);
    if (json && typeof json === "object") return { httpStatus: res.status, ...json };
    return { success: false, httpStatus: res.status, error: `the bridge answered HTTP ${res.status}` };
  } catch (err) {
    return { success: false, httpStatus: 0, error: `the bridge could not be reached (${err.message})` };
  }
}

/** The IDE's state (active file, selection, tabs), or null when no IDE window's bridge answers. */
export function getBridgeState() {
  return getJson("/api/state", 2000);
}

/** `{ status, pid, instance, holdingSince }` of the extension host holding the port, or null. */
export function getBridgeHealth() {
  return getJson("/api/health", 2000);
}

/** An editor action (openFile, writeFile, applyEdit) through the bridge. */
export function bridgeAction(action) {
  return postJson("/api/action", action, 5000);
}

/** An allow-listed command (design §6): `{ id, args }` → `{ success, exitCode, output, … }`. */
export function bridgeCommand(id, args = {}) {
  return postJson("/api/command", { id, args }, 150000);
}
