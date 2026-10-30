/**
 * T23 (secrets out of source, design D2 / D3 / D4) — the ONE server-side seam
 * through which an outbound call obtains a credential.
 *
 * Before T23 every credential was a `useState` default in page.js (three
 * Kubernetes service-account JWTs and a LiteLLM key, committed since
 * session 4), seeded into every visitor's localStorage and sent back on
 * every request. Now the page's defaults are empty and the server holds the
 * platform's credentials as RUNTIME env from a Kubernetes Secret the chart
 * references by name (never a value in git, an image, or Tilt's render):
 *
 *   NEXCODE_CHAT_TOKEN     bound to NEXCODE_CHAT_URL     (the MLIS chat deployment; the code agent too)
 *   NEXCODE_EMBED_TOKEN    bound to NEXCODE_EMBED_URL    (the MLIS embedder; Ollama's default needs none)
 *   NEXCODE_RERANK_TOKEN   bound to NEXCODE_RERANK_URL   (the MLIS reranker)
 *   NEXCODE_LITELLM_TOKEN  bound to NEXCODE_LITELLM_URL  (the LiteLLM gateway — a future enhancement, owner 2026-09-08)
 *   NEXCODE_WEAVIATE_TOKEN bound to NEXCODE_WEAVIATE_URL (an OVERRIDE only — see below)
 *
 * ONE credential PER ENDPOINT, never a shared one: each MLIS deployment
 * authorises exactly its own service account, and the wrong token is a 403
 * the rerank stage used to swallow into a uniform 0.5 score (F-22, measured
 * again in t23-design.md §0 item 3). There is deliberately no shared MLIS
 * credential name anywhere in src/ or the chart, and U-CRED asserts it.
 *
 * The rule, in order (design D4):
 *   1. a non-empty REQUEST value wins — a key the presenter typed into the
 *      drawer, or a harness value; user-owned, sent wherever the request
 *      points;
 *   2. else the env token whose bound ORIGIN equals the request URL's origin
 *      — the URL as the client sent it, before translateToInternalUrl
 *      rewrites the host. A platform token is NEVER sent to an origin it is
 *      not bound to: a presenter who points the rerank field at another host
 *      and leaves the key blank sends nothing, and the report says `none`;
 *   3. else, for the vector store only, the pod's own projected
 *      service-account token (design D3 — Weaviate accepts the workload
 *      identity, measured; the kubelet rotates it; nothing to store);
 *   4. else nothing.
 * Every caller reports the SOURCE it used (`request` / `env` / `workload` /
 * `none`) — T13's rule: F-22's failure is silent, so the source must be
 * visible per stage. A source is a name; no value, length or prefix ever
 * leaves this module except as the header the caller sends.
 *
 * CommonJS, no framework imports: the unit suite requires it directly, and
 * it is transportable (memory: the RAG pieces are pure modules).
 */
const fs = require("fs");

const CREDENTIAL_KINDS = Object.freeze(["chat", "embed", "rerank", "litellm", "weaviate"]);
const CREDENTIAL_SOURCES = Object.freeze(["request", "env", "workload", "none"]);

const ENV_TOKEN_NAMES = Object.freeze({
  chat: "NEXCODE_CHAT_TOKEN",
  embed: "NEXCODE_EMBED_TOKEN",
  rerank: "NEXCODE_RERANK_TOKEN",
  litellm: "NEXCODE_LITELLM_TOKEN",
  weaviate: "NEXCODE_WEAVIATE_TOKEN",
});

const ENV_URL_NAMES = Object.freeze({
  chat: "NEXCODE_CHAT_URL",
  embed: "NEXCODE_EMBED_URL",
  rerank: "NEXCODE_RERANK_URL",
  litellm: "NEXCODE_LITELLM_URL",
  weaviate: "NEXCODE_WEAVIATE_URL",
});

/** The projected service-account token the kubelet mounts and refreshes. */
const WORKLOAD_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";

/**
 * The origin (`scheme://host[:port]`, lower-cased, default ports dropped) of
 * a URL, or null when it is absent or unparseable. Both sides of every
 * comparison go through this, so `http://host:80/v1/` and `http://host`
 * are one origin.
 */
function originOf(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    return new URL(url.trim()).origin.toLowerCase();
  } catch (e) {
    return null;
  }
}

function envString(env, name) {
  const v = env ? env[name] : undefined;
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The bindings the environment declares: one per kind whose URL is set and
 * parseable, with that kind's token (possibly empty). Kinds without a URL
 * are not bound — a token with no origin to bind to is never sent anywhere.
 */
function bindingsFrom(env = process.env) {
  const out = [];
  for (const kind of CREDENTIAL_KINDS) {
    const origin = originOf(envString(env, ENV_URL_NAMES[kind]));
    if (!origin) continue;
    out.push({ kind, origin, token: envString(env, ENV_TOKEN_NAMES[kind]) });
  }
  return out;
}

function readWorkloadToken(tokenPath = WORKLOAD_TOKEN_PATH) {
  try {
    return fs.readFileSync(tokenPath, "utf8").trim();
  } catch (e) {
    return "";
  }
}

/**
 * Resolve the credential for ONE outbound call.
 *
 * @param {object} args
 * @param {string} [args.url]            the endpoint AS THE CLIENT SENT IT (pre-translation)
 * @param {string} [args.requestValue]   the request's own field for this hop ("" when blank)
 * @param {object} [args.env]            defaults to process.env (injectable for tests)
 * @param {string} [args.workloadTokenPath] defaults to the kubelet's projection (injectable)
 * @returns {{ value: string, source: "request"|"env"|"workload"|"none", kind: string|null, origin: string|null }}
 */
function resolveCredential({ url, requestValue, env = process.env, workloadTokenPath = WORKLOAD_TOKEN_PATH } = {}) {
  const origin = originOf(url);
  const binding = origin ? bindingsFrom(env).find((b) => b.origin === origin) || null : null;
  const kind = binding ? binding.kind : null;
  const requested = typeof requestValue === "string" ? requestValue.trim() : "";
  if (requested) return { value: requested, source: "request", kind, origin };
  if (binding && binding.token) return { value: binding.token, source: "env", kind, origin };
  if (kind === "weaviate") {
    const workload = readWorkloadToken(workloadTokenPath);
    if (workload) return { value: workload, source: "workload", kind, origin };
  }
  return { value: "", source: "none", kind, origin };
}

/**
 * Presence only — for GET /api/health, the drawer's hint and the boot log.
 * `{ chat: "env"|"none", embed, rerank, litellm, weaviate: "env"|"workload"|"none" }`.
 * Never a value, never a host.
 */
function describeCredentials(env = process.env, workloadTokenPath = WORKLOAD_TOKEN_PATH) {
  const bound = new Map(bindingsFrom(env).map((b) => [b.kind, b]));
  const out = {};
  for (const kind of CREDENTIAL_KINDS) {
    const b = bound.get(kind);
    if (b && b.token) out[kind] = "env";
    else if (kind === "weaviate" && readWorkloadToken(workloadTokenPath)) out[kind] = "workload";
    else out[kind] = "none";
  }
  return out;
}

/** One line for the server's boot log: `credentials: chat=env embed=env … weaviate=workload`. */
function credentialSummaryLine(env = process.env, workloadTokenPath = WORKLOAD_TOKEN_PATH) {
  const d = describeCredentials(env, workloadTokenPath);
  return "credentials: " + CREDENTIAL_KINDS.map((k) => `${k}=${d[k]}`).join(" ");
}

module.exports = {
  CREDENTIAL_KINDS,
  CREDENTIAL_SOURCES,
  ENV_TOKEN_NAMES,
  ENV_URL_NAMES,
  WORKLOAD_TOKEN_PATH,
  originOf,
  bindingsFrom,
  resolveCredential,
  describeCredentials,
  credentialSummaryLine,
};
