/**
 * U-LITELLM — Nexus D31 (2026-10-30): every model role points at the platform LiteLLM; the Ollama-only features
 * (thinking off, captioning, an Ollama reranker) resolve the Ollama behind a LiteLLM model through /model/info and
 * learn what it can do from Ollama's /api/show. Fixture entries mirror lonpcai's LiteLLM (measured 2026-10-30).
 */
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");

const L = require("../../src/lib/models/litellm_backends");

const ENV = { NEXCODE_LITELLM_URL: "http://litellm.litellm.svc.cluster.local:4000", NEXCODE_LITELLM_TOKEN: "app-key" };

const MODEL_INFO = {
  data: [
    { model_name: "qwen3.8:27b", litellm_params: { custom_llm_provider: "ollama_chat", api_base: "https://ollama.demo.lon-pcai.twlon.com/", model: "qwen3.8:27b" } },
    { model_name: "llm-thinking-medium", litellm_params: { custom_llm_provider: "ollama_chat", api_base: "https://ollama.demo.lon-pcai.twlon.com/", model: "qwen3.8:27b" } },
    { model_name: "Qwen3-Reranker-8B", litellm_params: { custom_llm_provider: "ollama", api_base: "https://ollama.demo.lon-pcai.twlon.com/", model: "dengcao/Qwen3-Reranker-8B:Q3_K_M" } },
    { model_name: "embedding", litellm_params: { custom_llm_provider: "hosted_vllm", api_base: "https://embed.project-demos.serving.demo.lon-pcai.twlon.com/v1", model: "Qwen/Qwen3-Embedding-4B" } },
  ],
};

function fakeFetch(calls, { capabilities = ["completion", "vision", "thinking"], showStatus = 200 } = {}) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/model/info")) return { ok: true, status: 200, json: async () => MODEL_INFO };
    if (url.endsWith("/api/show")) return { ok: showStatus < 300, status: showStatus, json: async () => ({ capabilities }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

describe("U-LITELLM: the Ollama behind a LiteLLM model (D31)", () => {
  beforeEach(() => L.resetModelInfoCache());

  test("LiteLLM's base and API URL come from NEXCODE_LITELLM_URL; a URL on that origin is LiteLLM", () => {
    assert.strictEqual(L.litellmBase(ENV), "http://litellm.litellm.svc.cluster.local:4000");
    assert.strictEqual(L.litellmApiUrl(ENV), "http://litellm.litellm.svc.cluster.local:4000/v1");
    assert.ok(L.isLiteLlmUrl("http://litellm.litellm.svc.cluster.local:4000/v1/", ENV));
    assert.ok(!L.isLiteLlmUrl("https://ollama.demo.lon-pcai.twlon.com/v1/", ENV));
    assert.strictEqual(L.litellmBase({}), L.DEFAULT_LITELLM_URL);
  });

  test("an Ollama-backed model resolves to the IN-CLUSTER Ollama and its underlying name; the app key asks LiteLLM", async () => {
    const calls = [];
    const b = await L.ollamaBackend("llm-thinking-medium", { env: ENV, fetchImpl: fakeFetch(calls) });
    assert.deepStrictEqual(b, { origin: "http://ollama.ollama.svc.cluster.local:11434", model: "qwen3.8:27b", provider: "ollama_chat", litellmModel: "llm-thinking-medium" });
    assert.strictEqual(calls[0].url, "http://litellm.litellm.svc.cluster.local:4000/model/info");
    assert.strictEqual(calls[0].init.headers.Authorization, "Bearer app-key", "the env token bound to LiteLLM's origin");
  });

  test("a model that is not on Ollama, or unknown, resolves to null", async () => {
    const opts = { env: ENV, fetchImpl: fakeFetch([]) };
    assert.strictEqual(await L.ollamaBackend("embedding", opts), null);
    assert.strictEqual(await L.ollamaBackend("no-such-model", opts), null);
    assert.strictEqual(await L.ollamaBackend("", opts), null);
  });

  test("/model/info is cached: two lookups, one call", async () => {
    const calls = [];
    const opts = { env: ENV, fetchImpl: fakeFetch(calls) };
    await L.ollamaBackend("qwen3.8:27b", opts);
    await L.ollamaBackend("Qwen3-Reranker-8B", opts);
    assert.strictEqual(calls.filter((c) => c.url.endsWith("/model/info")).length, 1);
  });

  test("describeModel reports the features from Ollama's capabilities, and says why when there are none", async () => {
    const thinking = await L.describeModel("qwen3.8:27b", { env: ENV, fetchImpl: fakeFetch([]) });
    assert.deepStrictEqual(thinking.features, { thinkingOff: true, captioning: true, ollamaRerank: true });
    assert.ok(thinking.ollamaBacked && /runs on Ollama/.test(thinking.message));

    L.resetModelInfoCache();
    const reranker = await L.describeModel("Qwen3-Reranker-8B", { env: ENV, fetchImpl: fakeFetch([], { capabilities: ["completion"] }) });
    assert.deepStrictEqual(reranker.features, { thinkingOff: false, captioning: false, ollamaRerank: true });

    L.resetModelInfoCache();
    const vllm = await L.describeModel("embedding", { env: ENV, fetchImpl: fakeFetch([]) });
    assert.ok(!vllm.ollamaBacked && /not served by Ollama/.test(vllm.message));

    L.resetModelInfoCache();
    const unknown = await L.describeModel("nope", { env: ENV, fetchImpl: fakeFetch([]) });
    assert.ok(!unknown.known && /no model named/.test(unknown.message));

    L.resetModelInfoCache();
    const down = await L.describeModel("qwen3.8:27b", { env: ENV, fetchImpl: fakeFetch([], { showStatus: 500 }) });
    assert.ok(down.ollamaBacked && !down.features.captioning && /did not answer/.test(down.message));
  });
});
