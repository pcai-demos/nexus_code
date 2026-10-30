/**
 * src/lib/coding/ide_client.js — the browser's two IDE requests from the chat's chips (presenter flow, 2026-10-07):
 * open a code location in the IDE with its lines selected, and show an answer's proposed change in the IDE as a diff
 * again. Both go through the scenarios route, which contains the path and asks the bridge; the proposal's content is
 * read from the run log on the server, never sent from the browser.
 */

const API = "/api/ide-bridge/scenarios";

async function post(body) {
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    return json && typeof json === "object" ? json : { success: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Open `path` in the IDE with lines `startLine`–`endLine` selected. */
function revealInIde({ path, startLine, endLine }) {
  return post({ action: "reveal", path, startLine, endLine });
}

/** Show the change turn `turnId` proposed for `path` as a diff in the IDE. */
function showProposalInIde({ turnId, path }) {
  return post({ action: "show-proposal", turnId, path });
}

module.exports = { revealInIde, showProposalInIde };
