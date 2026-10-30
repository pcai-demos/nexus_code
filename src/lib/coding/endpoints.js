/**
 * src/lib/coding/endpoints.js — where a coding turn sends its model call (Machinery PR 1, design §4 step 6).
 *
 * Pure (no I/O). The two URL rules are the orchestrator's, copied because src/lib/orchestrator.js is frozen and does not
 * export them:
 *   - translateToInternalUrl: a platform hostname the browser knows → the in-cluster service the pod reaches;
 *   - completionsUrl: any base URL → its OpenAI-compatible `/v1/chat/completions` endpoint.
 * ollamaNativeChatUrl gives Ollama's own `/api/chat` on the same origin — the only request form on which this Ollama
 * (0.33.3) honours `think: false` (t36-design.md §0a; re-measured 2026-10-06, evidence/machinery-pr1-design/).
 */

const INTERNAL_HOSTS = Object.freeze([
  { external: "https://rerank.project-demos.serving.demo.lon-pcai.twlon.com", internal: "http://rerank.project-demos.svc.cluster.local:80", host: "rerank.project-demos.serving.demo.lon-pcai.twlon.com" },
  { external: "https://nemotron.project-demos.serving.demo.lon-pcai.twlon.com", internal: "http://nemotron.project-demos.svc.cluster.local:80", host: "nemotron.project-demos.serving.demo.lon-pcai.twlon.com" },
  { external: "https://ollama.demo.lon-pcai.twlon.com", internal: "http://ollama.ollama.svc.cluster.local:11434", host: null },
]);

/** `{ url, headers }` — the in-cluster URL for a platform hostname (with its Host header where the mesh needs one). */
function translateToInternalUrl(urlText) {
  const url = String(urlText || "").trim();
  for (const m of INTERNAL_HOSTS) {
    if (url.includes(m.external.replace("https://", ""))) {
      return { url: url.replace(m.external, m.internal), headers: m.host ? { Host: m.host } : {} };
    }
  }
  return { url, headers: {} };
}

/** The OpenAI-compatible completions URL for a base URL (the orchestrator's standardisation). "" for no URL. */
function completionsUrl(base) {
  const url = String(base || "").trim();
  if (!url) return "";
  if (url.endsWith("/chat/completions") || url.endsWith("/llm/chat")) return url;
  const clean = url.endsWith("/") ? url.slice(0, -1) : url;
  return clean.endsWith("/v1") ? `${clean}/chat/completions` : `${clean}/v1/chat/completions`;
}

/** Ollama's own chat endpoint on the origin of `url` (a completions URL or a base URL). "" when `url` has no origin. */
function ollamaNativeChatUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    return `${u.origin}/api/chat`;
  } catch {
    return "";
  }
}

/** The host:port a URL names, for records and spans (never a credential). */
function hostOf(url) {
  try {
    return new URL(String(url || "").trim()).host || null;
  } catch {
    return null;
  }
}

module.exports = { INTERNAL_HOSTS, translateToInternalUrl, completionsUrl, ollamaNativeChatUrl, hostOf };
