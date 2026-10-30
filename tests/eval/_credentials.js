/**
 * T23 (design D9) — the harness's ONE credential source for node runners:
 * the pod's env (the nexcode-credentials Secret) and the kubelet's projected
 * service-account token for the store (design D3). No fallback to page.js —
 * a missing Secret throws, naming the variable, never a value.
 */
const fs = require("fs");

const WORKLOAD_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";

function creds({ env = process.env, workloadTokenPath = process.env.NEXCODE_WORKLOAD_TOKEN_FILE || WORKLOAD_TOKEN_PATH, require: required = ["rerank", "embed"] } = {}) {
  let weaviateToken = (env.NEXCODE_WEAVIATE_TOKEN || "").trim();
  let weaviateSource = weaviateToken ? "env" : "none";
  if (!weaviateToken) {
    try {
      weaviateToken = fs.readFileSync(workloadTokenPath, "utf8").trim();
      if (weaviateToken) weaviateSource = "workload";
    } catch (e) {
      weaviateToken = "";
    }
  }
  const out = {
    weaviateToken,
    weaviateSource,
    rerankToken: (env.NEXCODE_RERANK_TOKEN || "").trim(),
    embedToken: (env.NEXCODE_EMBED_TOKEN || "").trim(),
    chatToken: (env.NEXCODE_CHAT_TOKEN || "").trim(),
    litellmToken: (env.NEXCODE_LITELLM_TOKEN || "").trim(),
  };
  const missing = [];
  if (!out.weaviateToken) missing.push("NEXCODE_WEAVIATE_TOKEN (or the projected service-account token)");
  for (const k of required) if (!out[`${k}Token`]) missing.push(`NEXCODE_${k.toUpperCase()}_TOKEN`);
  if (missing.length) {
    throw new Error(`[T23 credentials] not set in this environment: ${missing.join(", ")} — the nexcode-credentials Secret is missing, or this pod predates T23 (design D9)`);
  }
  return out;
}

module.exports = { creds, WORKLOAD_TOKEN_PATH };
