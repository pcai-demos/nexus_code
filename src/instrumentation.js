/**
 * T23 (design D1): the server's one boot-time line about its credentials —
 * presence per endpoint, never a value. Next runs `register()` once when the
 * server starts; the Node-only module is loaded lazily so the edge bundle
 * never sees `fs`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const mod = await import("./lib/credentials.js");
    const line = (mod.credentialSummaryLine || (mod.default && mod.default.credentialSummaryLine))();
    console.log(`[nexcode boot] ${line}`);
  } catch (err) {
    console.error("[nexcode boot] could not describe credentials:", err && err.message);
  }
}
