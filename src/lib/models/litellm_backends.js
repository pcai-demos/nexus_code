/**
 * src/lib/models/litellm_backends.js — which Ollama server and model sit behind a LiteLLM model name
 * (Nexus D31, 2026-10-30: every NexCode model role points at the platform LiteLLM).
 *
 * LiteLLM serves every model through its OpenAI-compatible API. Three NexCode features need Ollama's OWN API, which
 * LiteLLM does not pass through here (its `/ollama/...` route answers 404, measured 2026-10-30):
 *   - thinking off for the code agent: `/api/chat` with `think: false` (t36-design §0a);
 *   - the figure captioner: `/api/generate` with `keep_alive` and the model digest in its memo key (T24, T37);
 *   - reranking with a Qwen3 reranker that runs on Ollama: `/api/generate` with the reranker prompt.
 * They stay available when the chosen LiteLLM model is Ollama-backed. LiteLLM's `/model/info` (readable with the app
 * key) names each model's provider (`ollama` or `ollama_chat`), its `api_base` and the underlying model; Ollama's own
 * `/api/show` then says what that model can do (`thinking`, `vision`, `completion`). The caller uses the in-cluster
 * Ollama origin and the UNDERLYING model name, so a caption made through LiteLLM's `qwen3.8:27b` is byte-for-byte the
 * captioner's earlier call (same server, same model, same memo key).
 *
 * CommonJS with injectable fetch, like credentials.js: the unit suite requires it directly.
 */
const { resolveCredential } = require("../credentials");
const { translateToInternalUrl } = require("../coding/endpoints");

const DEFAULT_LITELLM_URL = "http://litellm.litellm.svc.cluster.local:4000";
const OLLAMA_PROVIDERS = Object.freeze(["ollama", "ollama_chat"]);
const MODEL_INFO_TTL_MS = 60_000;

/** LiteLLM's base URL without `/v1`, from NEXCODE_LITELLM_URL (the chart) or the in-cluster default. */
function litellmBase(env = process.env) {
  const raw = String(env.NEXCODE_LITELLM_URL || DEFAULT_LITELLM_URL).trim();
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** LiteLLM's OpenAI-compatible base (`…/v1`), the URL every model role points at by default. */
function litellmApiUrl(env = process.env) {
  return `${litellmBase(env)}/v1`;
}

function originOf(url) {
  try {
    return new URL(String(url || "").trim()).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** True when `url` points at the configured LiteLLM (same origin). */
function isLiteLlmUrl(url, env = process.env) {
  const o = originOf(url);
  return Boolean(o) && o === originOf(litellmBase(env));
}

let cache = null; // { base, at, models }

/**
 * LiteLLM's `/model/info` entries, cached for a minute. `token` is a key the user typed (it wins); otherwise the
 * credential bound to LiteLLM's origin (NEXCODE_LITELLM_TOKEN, the Nexus app key).
 */
async function modelInfo({ fetchImpl = fetch, token = "", env = process.env, now = Date.now } = {}) {
  const base = litellmBase(env);
  if (cache && cache.base === base && now() - cache.at < MODEL_INFO_TTL_MS) return cache.models;
  const url = `${base}/model/info`;
  const cred = resolveCredential({ url, requestValue: token, env });
  const res = await fetchImpl(url, { headers: cred.value ? { Authorization: `Bearer ${cred.value}` } : {} });
  if (!res.ok) throw new Error(`LiteLLM /model/info answered HTTP ${res.status} (credential source: ${cred.source})`);
  const body = await res.json();
  const models = Array.isArray(body && body.data) ? body.data : [];
  cache = { base, at: now(), models };
  return models;
}

/** Clears the model-info cache (tests; and after LiteLLM's models change). */
function resetModelInfoCache() {
  cache = null;
}

/**
 * The Ollama server and model behind a LiteLLM model name, or null when it is not Ollama-backed (or unknown).
 * `origin` is the in-cluster Ollama origin (a platform hostname is translated), `model` the underlying Ollama name.
 */
async function ollamaBackend(modelName, opts = {}) {
  const name = String(modelName || "").trim();
  if (!name) return null;
  const models = await modelInfo(opts);
  const entry = models.find((m) => m && m.model_name === name);
  const p = (entry && entry.litellm_params) || {};
  if (!OLLAMA_PROVIDERS.includes(p.custom_llm_provider) || !p.api_base || !p.model) return null;
  const external = originOf(p.api_base);
  if (!external) return null;
  const internal = originOf(translateToInternalUrl(external).url) || external;
  return { origin: internal, model: String(p.model), provider: p.custom_llm_provider, litellmModel: name };
}

/** Ollama's capability list for a backend (`/api/show`): e.g. ["completion", "vision", "thinking"]. */
async function ollamaCapabilities(backend, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${backend.origin}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: backend.model }),
  });
  if (!res.ok) throw new Error(`Ollama /api/show answered HTTP ${res.status} for ${backend.model}`);
  const body = await res.json();
  return Array.isArray(body && body.capabilities) ? body.capabilities : [];
}

/**
 * What a LiteLLM model can do in NexCode. The settings screen calls this when a model is picked, so the presenter
 * learns at once whether thinking off, captioning and Ollama reranking are available with it.
 */
async function describeModel(modelName, opts = {}) {
  const name = String(modelName || "").trim();
  const known = (await modelInfo(opts)).some((m) => m && m.model_name === name);
  if (!known) {
    return { model: name, known: false, ollamaBacked: false, capabilities: [], features: { thinkingOff: false, captioning: false, ollamaRerank: false }, message: `LiteLLM has no model named "${name}" for this key. Pick one from the list.` };
  }
  const backend = await ollamaBackend(name, opts);
  if (!backend) {
    return { model: name, known: true, ollamaBacked: false, capabilities: [], features: { thinkingOff: false, captioning: false, ollamaRerank: false }, message: `${name} is not served by Ollama: it works through LiteLLM's API, but thinking off, figure captioning and Ollama reranking need an Ollama-backed model.` };
  }
  let capabilities = [];
  try {
    capabilities = await ollamaCapabilities(backend, opts);
  } catch (e) {
    return { model: name, known: true, ollamaBacked: true, backend, capabilities: [], features: { thinkingOff: false, captioning: false, ollamaRerank: false }, message: `${name} runs on Ollama (${backend.model}), but its API did not answer: ${e.message}.` };
  }
  const features = {
    thinkingOff: capabilities.includes("thinking"),
    captioning: capabilities.includes("vision"),
    ollamaRerank: capabilities.includes("completion"),
  };
  const can = [features.thinkingOff && "thinking off", features.captioning && "figure captioning", features.ollamaRerank && "Ollama reranking"].filter(Boolean);
  return { model: name, known: true, ollamaBacked: true, backend, capabilities, features, message: `${name} runs on Ollama (${backend.model}); available: ${can.length ? can.join(", ") : "none of the Ollama-only features"}.` };
}

module.exports = {
  DEFAULT_LITELLM_URL,
  OLLAMA_PROVIDERS,
  litellmBase,
  litellmApiUrl,
  isLiteLlmUrl,
  modelInfo,
  resetModelInfoCache,
  ollamaBackend,
  ollamaCapabilities,
  describeModel,
};
