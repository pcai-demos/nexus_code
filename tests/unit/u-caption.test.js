/**
 * U-CAPTION — the VLM captioner's contract, offline (ticket T24; design §8).
 *
 * The fetch is injected, so this suite asserts the REQUEST the captioner
 * sends and the OUTCOME it returns for every reply shape, with no network:
 *   - every caption request carries `options` deep-equal to CAPTION_DECODING
 *     (temperature 0, seed 42, and — T32, F-132 — the repetition settings
 *     named) and nothing else new — the ticket's own acceptance fallback
 *     ("assert temperature 0 sent in request body via mock"), which here is
 *     the primary assertion;
 *   - T32 (t32-design §8): the two generic prompts (no document, figure or
 *     design named; the verdict tokens; the header labels; the line bounds;
 *     D4's Step-1 clause), the verdict parse on the first non-blank line, the
 *     `textOnly` outcome memoised with `caption: null`, and a memo key that
 *     differs between the two prompt variants for one crop;
 *   - `resetCaptionServer` sends exactly `{ model, keep_alive: 0 }`;
 *   - one outcome per reply shape: captioned / decorative / empty / tiny /
 *     missing / http_error / timeout / error; `generateImageCaption` keeps
 *     the pre-T24 signature (a string or null);
 *   - the log line names the document and page (F-119), not the crop file.
 * The parser's use of the module (a reset once per document, sequential
 * captions in page order, the switch) is pinned in U-PARSE.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const cap = require("../../src/lib/ingestion/vlm_captioner.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "u-caption-"));
const BIG = path.join(tmp, "fig_1_0.png");
const TINY = path.join(tmp, "fig_2_0.png");
fs.writeFileSync(BIG, Buffer.alloc(cap.CAPTION_MIN_BYTES + 10, 7));
fs.writeFileSync(TINY, Buffer.alloc(cap.CAPTION_MIN_BYTES - 1, 7));

/** A fetch that records the request and answers as told. */
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (typeof reply === "function") return reply(calls.length);
    return reply;
  };
  impl.calls = calls;
  return impl;
}
const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
const httpError = (status, text) => ({ ok: false, status, json: async () => ({}), text: async () => text });
const timeoutErr = () => { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; return e; };

describe("U-CAPTION: the request shape (design D2)", () => {
  test("every caption request carries options deep-equal to CAPTION_DECODING and the shipped body otherwise", async () => {
    const f = fakeFetch(okJson({ response: "HUMAN TITLE: x\nDIAGRAM TYPE: y" }));
    const r = await cap.captionFigure(BIG, { ollamaUrl: "http://o:11434/v1/", modelName: "m:1", token: "", fetchImpl: f, label: "doc.pdf p1 (fig_1_0)" });
    assert.strictEqual(r.outcome, "captioned");
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].url, "http://o:11434/api/generate", "the /v1 suffix and trailing slash are stripped, as before");
    const body = f.calls[0].body;
    assert.deepStrictEqual(Object.keys(body).sort(), ["images", "model", "options", "prompt", "stream"], "one new key: options");
    // T32 (design D5, F-132): the repetition settings the captioner relies on are NAMED (Ollama's defaults, now inside the key).
    assert.deepStrictEqual(body.options, { temperature: 0, seed: 42, num_predict: 6144, repeat_penalty: 1.1, repeat_last_n: 64 });
    assert.deepStrictEqual(body.options, { ...cap.CAPTION_DECODING });
    assert.strictEqual(cap.CAPTION_MAX_TOKENS, 6144, "A9: above the longest legitimate reply (4,844 tokens), a loop stops inside ~50 s");
    assert.ok(Object.isFrozen(cap.CAPTION_DECODING));
    assert.strictEqual(body.model, "m:1");
    assert.strictEqual(body.stream, false);
    assert.strictEqual(body.prompt, cap.CAPTION_PROMPTS.withText, "a page with a text layer (the default) gets the verdict-first prompt");
    assert.strictEqual(body.images.length, 1);
    assert.strictEqual(Buffer.from(body.images[0], "base64").length, cap.CAPTION_MIN_BYTES + 10, "the crop's bytes, base64");
    assert.strictEqual(f.calls[0].init.headers.Authorization, undefined, "no token, no header");
  });

  test("a token becomes a Bearer header; the timeout budget is the module constant unless overridden", async () => {
    const f = fakeFetch(okJson({ response: "caption" }));
    await cap.captionFigure(BIG, { token: "t", fetchImpl: f });
    assert.strictEqual(f.calls[0].init.headers.Authorization, "Bearer t");
    assert.ok(f.calls[0].init.signal instanceof AbortSignal);
    assert.strictEqual(cap.CAPTION_TIMEOUT_MS, 120000, "design D3: four times the slowest measured generation");
  });

  test("T32 (design D2): a page WITHOUT a text layer gets the transcribe-first prompt; the request is otherwise the same", async () => {
    const f = fakeFetch(okJson({ response: "TITLE: cover\nTYPE: photo\nSUBJECTS: a house\n\nTRANSCRIPTION:\nLINCOLN\n\nDESCRIPTION:\nA photo." }));
    const r = await cap.captionFigure(BIG, { fetchImpl: f, hasTextLayer: false });
    assert.strictEqual(r.outcome, "captioned");
    assert.strictEqual(f.calls[0].body.prompt, cap.CAPTION_PROMPTS.noText);
    assert.deepStrictEqual(f.calls[0].body.options, { ...cap.CAPTION_DECODING });
    assert.strictEqual(cap.captionPromptFor(true), cap.CAPTION_PROMPTS.withText);
    assert.strictEqual(cap.captionPromptFor(false), cap.CAPTION_PROMPTS.noText);
    assert.strictEqual(cap.captionPromptFor(undefined), cap.CAPTION_PROMPTS.withText, "unknown is the text-layer default (the parser always says)");
  });

  /** A fetch that answers the reset (generate) and then /api/ps with a scripted residency sequence. */
  function resetFetch(psSequence) {
    const calls = [];
    let psCalls = 0;
    const impl = async (url, init) => {
      calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
      if (/\/api\/ps$/.test(url)) { const models = psSequence[Math.min(psCalls, psSequence.length - 1)]; psCalls++; return okJson({ models: models.map((n) => ({ name: n })) }); }
      return okJson({ done: true });
    };
    impl.calls = calls;
    return impl;
  }

  test("resetCaptionServer sends exactly { model, keep_alive: 0 } to /api/generate, then polls /api/ps until the model is gone (A10)", async () => {
    const f = resetFetch([["m:1", "other"], ["m:1"], ["other"]]);
    const r = await cap.resetCaptionServer({ ollamaUrl: "http://o:11434/v1/", modelName: "m:1", fetchImpl: f, pollMs: 1, sleep: async () => {} });
    assert.deepStrictEqual({ ok: r.ok, unloaded: r.unloaded, status: r.status }, { ok: true, unloaded: true, status: 200 });
    assert.ok(Number.isFinite(r.waitedMs));
    assert.deepStrictEqual(f.calls[0].body, { model: "m:1", keep_alive: 0 });
    assert.strictEqual(f.calls[0].url, "http://o:11434/api/generate");
    const psCalls = f.calls.filter((c) => /\/api\/ps$/.test(c.url));
    assert.strictEqual(psCalls.length, 3, "polled until the model was absent");
    assert.strictEqual(psCalls[0].url, "http://o:11434/api/ps");
    assert.strictEqual(cap.RESET_UNLOAD_WAIT_MS, 15000);
  });

  test("a model that stays loaded is reported (unloaded false), never assumed gone; an unreadable /api/ps is null", async () => {
    const lines = [];
    const orig = console.warn; console.warn = (...a) => lines.push(a.join(" "));
    try {
      const stuck = await cap.resetCaptionServer({ modelName: "m:1", fetchImpl: resetFetch([["m:1"]]), unloadWaitMs: 3, pollMs: 1, sleep: async () => {}, label: "doc.pdf" });
      assert.deepStrictEqual({ ok: stuck.ok, unloaded: stuck.unloaded }, { ok: true, unloaded: false });
      assert.match(lines[lines.length - 1], /^\[VLM Captioner reset incomplete\] doc\.pdf: m:1 still loaded/);
      const blind = await cap.resetCaptionServer({ modelName: "m:1", fetchImpl: async (url) => (/\/api\/ps$/.test(url) ? httpError(500, "x") : okJson({ done: true })), pollMs: 1, sleep: async () => {} });
      assert.deepStrictEqual({ ok: blind.ok, unloaded: blind.unloaded }, { ok: true, unloaded: null });
    } finally { console.warn = orig; }
  });

  test("a failed reset never throws: ok false with the reason (the document still captions)", async () => {
    const bad = await cap.resetCaptionServer({ fetchImpl: fakeFetch(httpError(500, "boom")) });
    assert.deepStrictEqual({ ok: bad.ok, unloaded: bad.unloaded, status: bad.status }, { ok: false, unloaded: false, status: 500 });
    assert.match(bad.error, /HTTP 500 boom/);
    const thrown = await cap.resetCaptionServer({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
    assert.strictEqual(thrown.ok, false);
    assert.match(thrown.error, /ECONNREFUSED/);
  });

  test("captionFigure reports the server's load time, so a document's first caption witnesses the reload (A10)", async () => {
    const r = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: "cap", load_duration: 4500000000 })) });
    assert.strictEqual(r.loadMs, 4500);
    const none = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: "cap" })) });
    assert.strictEqual(none.loadMs, null);
  });
});

describe("U-CAPTION: one outcome per reply shape (design D5; X6's third piece)", () => {
  test("the vocabulary and its failure subset", () => {
    assert.deepStrictEqual([...cap.CAPTION_OUTCOMES], ["captioned", "decorative", "textOnly", "empty", "truncated", "tiny", "missing", "http_error", "timeout", "error"]);
    assert.deepStrictEqual([...cap.CAPTION_FAILURE_OUTCOMES], ["missing", "http_error", "timeout", "error"]);
    for (const o of cap.CAPTION_FAILURE_OUTCOMES) assert.ok(cap.CAPTION_OUTCOMES.includes(o));
  });

  test("captioned: the trimmed reply, with the status and the model", async () => {
    const r = await cap.captionFigure(BIG, { modelName: "m:1", fetchImpl: fakeFetch(okJson({ response: "  HUMAN TITLE: A\nbody  " })) });
    // T29: every result says where it came from (`source`), whether a request was made (`requested`) and what the memo did (`memoKey`, `memoised`).
    assert.deepStrictEqual({ ...r, ms: 0 }, { outcome: "captioned", caption: "HUMAN TITLE: A\nbody", ms: 0, model: "m:1", status: 200, loadMs: null, source: "vlm", requested: true, memoKey: null, memoised: false });
  });

  test("decorative: the marker on the FIRST non-blank line, caption null, not a failure; a marker after the first line is caption text (T32 design D1)", async () => {
    for (const reply of ["[DECORATIVE_ELEMENT]", "\n\n  [DECORATIVE_ELEMENT]  \n", "**[DECORATIVE_ELEMENT]**", "[DECORATIVE_ELEMENT]\nThe page carries only a logo."]) {
      const r = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: reply })) });
      assert.strictEqual(r.outcome, "decorative", JSON.stringify(reply));
      assert.strictEqual(r.caption, null);
      assert.ok(!cap.CAPTION_FAILURE_OUTCOMES.includes(r.outcome));
    }
    const inside = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: "TITLE: Logo\n[DECORATIVE_ELEMENT]" })) });
    assert.strictEqual(inside.outcome, "captioned", "a token inside a caption is not a verdict");
    assert.strictEqual(inside.caption, "TITLE: Logo\n[DECORATIVE_ELEMENT]");
  });

  test("T32 (design D1): textOnly — [NO_VISUAL_CONTENT] on the first non-blank line — is a verdict with no caption, not a failure; the log line names it", async () => {
    const lines = [];
    const orig = console.log; console.log = (...a) => lines.push(a.join(" "));
    try {
      for (const reply of ["[NO_VISUAL_CONTENT]", "\n[NO_VISUAL_CONTENT]\n\nThe page holds only prose.", "[NO_VISUAL_CONTENT]."]) {
        const r = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: reply })), label: "Fervi.pdf p7 (fig_7_0)" });
        assert.strictEqual(r.outcome, "textOnly", JSON.stringify(reply));
        assert.strictEqual(r.caption, null);
        assert.strictEqual(r.requested, true);
      }
    } finally { console.log = orig; }
    assert.ok(lines.some((l) => l === "[VLM Captioner textOnly] Fervi.pdf p7 (fig_7_0)"), `the verdict is logged with the document and page: ${JSON.stringify(lines)}`);
    assert.ok(cap.CAPTION_OUTCOMES.includes("textOnly") && !cap.CAPTION_FAILURE_OUTCOMES.includes("textOnly"));
    const capped = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: "[NO_VISUAL_CONTENT]", done_reason: "length", eval_count: 6144 })) });
    assert.strictEqual(capped.outcome, "truncated", "the cap is judged before the verdict: a capped reply is truncated whatever its text");
  });

  test("parseVerdict: the first non-blank line decides — whitespace, markdown emphasis and a trailing full stop tolerated; anything else is a caption", () => {
    assert.strictEqual(cap.parseVerdict("[NO_VISUAL_CONTENT]"), "textOnly");
    assert.strictEqual(cap.parseVerdict("[DECORATIVE_ELEMENT]"), "decorative");
    assert.strictEqual(cap.parseVerdict("\n\n   [NO_VISUAL_CONTENT]   \n"), "textOnly", "leading blank lines");
    assert.strictEqual(cap.parseVerdict("**[DECORATIVE_ELEMENT]**"), "decorative", "markdown emphasis");
    assert.strictEqual(cap.parseVerdict("`[NO_VISUAL_CONTENT]`."), "textOnly");
    assert.strictEqual(cap.parseVerdict("TITLE: Figure 15\nTYPE: dimensioned drawing"), null, "a caption");
    assert.strictEqual(cap.parseVerdict("TITLE: x\n[NO_VISUAL_CONTENT]"), null, "a token inside a caption is not a verdict");
    assert.strictEqual(cap.parseVerdict("[NO_VISUAL_CONTENT] because the page is prose"), null, "a token with trailing words is not the exact line");
    assert.strictEqual(cap.parseVerdict(""), null);
    assert.strictEqual(cap.parseVerdict(null), null);
    assert.deepStrictEqual({ ...cap.VERDICT_TOKENS }, { textOnly: "[NO_VISUAL_CONTENT]", decorative: "[DECORATIVE_ELEMENT]" });
  });

  test("truncated: a reply that hit the token cap (done_reason length) is dropped and counted, not a failure (A9)", async () => {
    const r = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: "HUMAN TITLE: x\nthe the the the", done_reason: "length", eval_count: 6144 })) });
    assert.strictEqual(r.outcome, "truncated");
    assert.strictEqual(r.caption, null);
    assert.match(r.error, /6144-token cap/);
    assert.ok(!cap.CAPTION_FAILURE_OUTCOMES.includes("truncated"));
    const midThink = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: "", done_reason: "length", eval_count: 6144 })) });
    assert.strictEqual(midThink.outcome, "truncated", "a cap hit with no visible text is still truncated, not empty");
    const stopped = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: "fine", done_reason: "stop", eval_count: 12 })) });
    assert.strictEqual(stopped.outcome, "captioned");
  });

  test("empty: a blank reply", async () => {
    const r = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(okJson({ response: "   " })) });
    assert.strictEqual(r.outcome, "empty");
    assert.strictEqual(r.caption, null);
  });

  test("tiny: under CAPTION_MIN_BYTES, no request is made", async () => {
    const f = fakeFetch(okJson({ response: "x" }));
    const r = await cap.captionFigure(TINY, { fetchImpl: f });
    assert.strictEqual(r.outcome, "tiny");
    assert.strictEqual(f.calls.length, 0);
    assert.strictEqual(cap.CAPTION_MIN_BYTES, 4000, "the pre-T24 threshold");
  });

  test("missing: a crop that is not on disk, no request", async () => {
    const f = fakeFetch(okJson({ response: "x" }));
    const r = await cap.captionFigure(path.join(tmp, "nope.png"), { fetchImpl: f });
    assert.strictEqual(r.outcome, "missing");
    assert.strictEqual(f.calls.length, 0);
    assert.ok(cap.CAPTION_FAILURE_OUTCOMES.includes("missing"));
  });

  test("http_error: a non-2xx status with its text", async () => {
    const r = await cap.captionFigure(BIG, { fetchImpl: fakeFetch(httpError(503, "model busy")) });
    assert.strictEqual(r.outcome, "http_error");
    assert.strictEqual(r.status, 503);
    assert.match(r.error, /HTTP 503 model busy/);
  });

  test("timeout: an aborted request is a timeout, not a generic error (F-118)", async () => {
    const r = await cap.captionFigure(BIG, { timeoutMs: 1234, fetchImpl: async () => { throw timeoutErr(); } });
    assert.strictEqual(r.outcome, "timeout");
    assert.match(r.error, /1234 ms/);
  });

  test("error: any other throw (network, JSON)", async () => {
    const r = await cap.captionFigure(BIG, { fetchImpl: async () => { throw new Error("socket hang up"); } });
    assert.strictEqual(r.outcome, "error");
    assert.match(r.error, /socket hang up/);
    const badJson = await cap.captionFigure(BIG, { fetchImpl: fakeFetch({ ok: true, status: 200, json: async () => { throw new Error("Unexpected token"); }, text: async () => "" }) });
    assert.strictEqual(badJson.outcome, "error");
  });

  test("generateImageCaption keeps the pre-T24 signature: the caption, or null for every other outcome", async () => {
    assert.strictEqual(await cap.generateImageCaption(BIG, { fetchImpl: fakeFetch(okJson({ response: "cap" })) }), "cap");
    assert.strictEqual(await cap.generateImageCaption(BIG, { fetchImpl: fakeFetch(okJson({ response: "[DECORATIVE_ELEMENT]" })) }), null);
    assert.strictEqual(await cap.generateImageCaption(TINY, { fetchImpl: fakeFetch(okJson({ response: "cap" })) }), null);
    assert.strictEqual(await cap.generateImageCaption(BIG, { fetchImpl: async () => { throw timeoutErr(); } }), null);
  });
});

describe("U-CAPTION: the log line names the document and the page (F-119)", () => {
  test("a timeout, an http error and a missing crop are logged with the caller's label, never only the crop file", async () => {
    const lines = [];
    const orig = console.warn;
    console.warn = (...a) => lines.push(a.join(" "));
    try {
      await cap.captionFigure(BIG, { label: "Barratt_Homes_SitePlan.pdf p1 (fig_1_0)", timeoutMs: 5, fetchImpl: async () => { throw timeoutErr(); } });
      await cap.captionFigure(BIG, { label: "GraemeHick.pdf p1 (fig_1_0)", fetchImpl: fakeFetch(httpError(500, "x")) });
      await cap.captionFigure(path.join(tmp, "gone.png"), { label: "SSX125_Manual.pdf p26 (fig_26_0)", fetchImpl: fakeFetch(okJson({})) });
      await cap.resetCaptionServer({ label: "SSX125_Manual.pdf", fetchImpl: async () => { throw new Error("down"); } });
    } finally {
      console.warn = orig;
    }
    assert.strictEqual(lines.length, 4);
    assert.match(lines[0], /^\[VLM Captioner timeout\] Barratt_Homes_SitePlan\.pdf p1 \(fig_1_0\): no reply within 5 ms/);
    assert.match(lines[1], /^\[VLM Captioner http_error\] GraemeHick\.pdf p1 \(fig_1_0\): 500 x/);
    assert.match(lines[2], /^\[VLM Captioner missing\] SSX125_Manual\.pdf p26 \(fig_26_0\)/);
    assert.match(lines[3], /^\[VLM Captioner reset failed\] SSX125_Manual\.pdf: down/);
    for (const l of lines.slice(0, 2)) assert.ok(!/^\[VLM Captioner (Error|Exception) for fig_/.test(l), "the pre-T24 crop-only wording is gone");
  });

  test("the module is CommonJS and is what the parser requires (F-4)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "vlm_captioner.js"), "utf-8");
    assert.ok(!/^\s*import\s/m.test(src) && !/^\s*export\s/m.test(src), "no ESM syntax");
    assert.match(src, /module\.exports = \{/);
    const parser = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "parser.js"), "utf-8");
    assert.match(parser, /require\("\.\/vlm_captioner"\)/);
  });
});

describe("U-CAPTION/T29: the caption memo first, the server second (t29-design D1, D2, D3)", () => {
  const memoMod = require("../../src/lib/ingestion/caption_memo.js");
  const os2 = require("os");
  const dir = fs.mkdtempSync(path.join(os2.tmpdir(), "u-caption-memo-"));
  const memo = memoMod.openCaptionMemo({ dir, log: { warn: () => {} } });
  const identity = { server: "http://o:11434", modelDigest: "eda0be1008774ea4e575187712b9a3b1201f3e66e7ecff899cc295db1cf00248" };
  const never = async () => { throw new Error("a memo hit must make NO request"); };

  test("resolveCaptionServer reads the model's digest from /api/tags and names the origin; a missing model or an unreachable server is ok:false (the memo bypassed), never a throw", async () => {
    const tags = okJson({ models: [{ name: "other:1", model: "other:1", digest: "ff" }, { name: "m:1", model: "m:1", digest: "abc123" }] });
    const f = fakeFetch(tags);
    const r = await cap.resolveCaptionServer({ ollamaUrl: "http://o:11434/v1/", modelName: "m:1", fetchImpl: async (url, init) => { f.calls.push({ url, init }); return tags; } });
    assert.deepStrictEqual({ ok: r.ok, server: r.server, digest: r.modelDigest, status: r.status }, { ok: true, server: "http://o:11434", digest: "abc123", status: 200 });
    assert.strictEqual(f.calls[0].url, "http://o:11434/api/tags");
    assert.strictEqual(f.calls[0].init.method, "GET");
    const latest = await cap.resolveCaptionServer({ modelName: "m", fetchImpl: async () => okJson({ models: [{ name: "m:latest", digest: "d1" }] }) });
    assert.strictEqual(latest.modelDigest, "d1", "a bare name matches its :latest tag");
    const missing = await cap.resolveCaptionServer({ modelName: "nope:1", fetchImpl: async () => tags });
    assert.deepStrictEqual({ ok: missing.ok, digest: missing.modelDigest }, { ok: false, digest: null });
    assert.match(missing.error, /not listed/);
    const down = await cap.resolveCaptionServer({ modelName: "m:1", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
    assert.deepStrictEqual({ ok: down.ok, digest: down.modelDigest, server: down.server }, { ok: false, digest: null, server: "http://ollama.ollama.svc.cluster.local:11434" });
    const http = await cap.resolveCaptionServer({ modelName: "m:1", fetchImpl: async () => httpError(503, "busy") });
    assert.deepStrictEqual({ ok: http.ok, status: http.status }, { ok: false, status: 503 });
    assert.strictEqual(cap.serverOriginOf("HTTP://Ollama.demo:11434/v1/"), "http://ollama.demo:11434");
  });

  test("captionMemoKey is the memo key under THIS captioner's prompt VARIANT and decoding; the two variants are two keys for one crop; it needs the identity", () => {
    const bytes = fs.readFileSync(BIG);
    const k = cap.captionMemoKey(bytes, { modelName: "m:1", memoIdentity: identity });
    const direct = memoMod.memoKey({ cropBytes: bytes, modelName: "m:1", modelDigest: identity.modelDigest, server: identity.server, prompt: cap.CAPTION_PROMPTS.withText, decoding: cap.CAPTION_DECODING });
    assert.strictEqual(k.key, direct.key);
    // T32: the shipped text-layer prompt's md5 is the prompt half of every key it produces (the memo's records name it); the probed
    // draft (25342f62…) differs by D4's Step-1 clause and the legacy prompt (f1de927a…) keys the 275 pre-T32 records — neither answers here.
    assert.strictEqual(k.promptMd5, cap.CAPTION_PROMPT_MD5.withText);
    assert.strictEqual(k.promptMd5, "af0ec7efac016c0aa20a04b54015fff6", "the shipped withText prompt's md5 — change the prompt and this pin, deliberately");
    assert.notStrictEqual(k.promptMd5, "f1de927a854650e10be5c2274ba571f7", "the legacy key is not this key");
    assert.strictEqual(k.decodingCanonical, '{"num_predict":6144,"repeat_last_n":64,"repeat_penalty":1.1,"seed":42,"temperature":0}', "F-132: the repetition settings are inside the key");
    const noText = cap.captionMemoKey(bytes, { modelName: "m:1", memoIdentity: identity, hasTextLayer: false });
    assert.notStrictEqual(noText.key, k.key, "one crop, two variants, two keys");
    assert.strictEqual(noText.promptMd5, cap.CAPTION_PROMPT_MD5.noText);
    assert.strictEqual(noText.promptMd5, "a40a2b6495228e43d4d74c803d20622e", "the no-text-layer prompt is byte-identical to the probed V2 (t32-design §0b)");
    assert.strictEqual(cap.captionMemoKey(bytes, { modelName: "m:1", memoIdentity: identity, hasTextLayer: true }).key, k.key);
    assert.throws(() => cap.captionMemoKey(bytes, { modelName: "m:1" }), /memoIdentity/);
    assert.throws(() => cap.captionMemoKey(bytes, { modelName: "m:1", memoIdentity: { server: "x" } }), /memoIdentity/);
  });

  test("a miss asks the server and remembers captioned / decorative / textOnly / truncated — never a failure, never empty; the request body is unchanged", async () => {
    const f = fakeFetch(okJson({ response: "HUMAN TITLE: A\nbody" }));
    const r = await cap.captionFigure(BIG, { modelName: "m:1", fetchImpl: f, memo, memoIdentity: identity, jobId: "job-1", hint: { fileName: "a.pdf", page: 1, figureId: "fig_1_0", docHash: "h" } });
    assert.deepStrictEqual({ o: r.outcome, s: r.source, req: r.requested, mem: r.memoised }, { o: "captioned", s: "vlm", req: true, mem: true });
    assert.match(r.memoKey, /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(f.calls[0].body.options, { ...cap.CAPTION_DECODING }, "the request on a miss is T24's request");
    const rec = memo.get(r.memoKey);
    assert.deepStrictEqual({ o: rec.outcome, c: rec.caption, s: rec.source, j: rec.jobId, h: rec.hint, m: rec.model, d: rec.modelDigest, srv: rec.server }, { o: "captioned", c: "HUMAN TITLE: A\nbody", s: "vlm", j: "job-1", h: { fileName: "a.pdf", page: 1, figureId: "fig_1_0", docHash: "h" }, m: "m:1", d: identity.modelDigest, srv: "http://o:11434" });
    // decorative and truncated are remembered too — under other keys (another model name keeps this test's crop apart)
    const dec = await cap.captionFigure(BIG, { modelName: "m:2", fetchImpl: fakeFetch(okJson({ response: "[DECORATIVE_ELEMENT]" })), memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: dec.outcome, mem: dec.memoised }, { o: "decorative", mem: true });
    assert.strictEqual(memo.get(dec.memoKey).caption, null);
    const tr = await cap.captionFigure(BIG, { modelName: "m:3", fetchImpl: fakeFetch(okJson({ response: "x x x", done_reason: "length", eval_count: 6144 })), memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: tr.outcome, mem: tr.memoised }, { o: "truncated", mem: true });
    // T32 (design D8): textOnly is remembered like decorative — a verdict, caption null.
    const to = await cap.captionFigure(BIG, { modelName: "m:11", fetchImpl: fakeFetch(okJson({ response: "[NO_VISUAL_CONTENT]" })), memo, memoIdentity: identity, hint: { fileName: "a.pdf", page: 7, figureId: "fig_7_0", docHash: "h" } });
    assert.deepStrictEqual({ o: to.outcome, mem: to.memoised, c: to.caption }, { o: "textOnly", mem: true, c: null });
    assert.deepStrictEqual({ o: memo.get(to.memoKey).outcome, c: memo.get(to.memoKey).caption, p: memo.get(to.memoKey).promptMd5 }, { o: "textOnly", c: null, p: cap.CAPTION_PROMPT_MD5.withText });
    // never a failure, never empty
    const cases = [
      ["m:4", fakeFetch(okJson({ response: "   " })), "empty"],
      ["m:5", fakeFetch(httpError(500, "boom")), "http_error"],
      ["m:6", async () => { throw timeoutErr(); }, "timeout"],
      ["m:7", async () => { throw new Error("ECONNRESET"); }, "error"],
    ];
    for (const [model, fetchImpl, expected] of cases) {
      const x = await cap.captionFigure(BIG, { modelName: model, fetchImpl, memo, memoIdentity: identity });
      assert.strictEqual(x.outcome, expected);
      assert.deepStrictEqual({ req: x.requested, mem: x.memoised, s: x.source }, { req: true, mem: false, s: "vlm" }, `${expected} is asked but never remembered`);
      assert.match(x.memoKey, /^[0-9a-f]{64}$/, "the key is still reported, so the caller knows the memo was in play");
      assert.strictEqual(memo.has(x.memoKey), false, `${expected}: no record`);
    }
    const tiny = await cap.captionFigure(TINY, { modelName: "m:8", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: tiny.outcome, req: tiny.requested, key: tiny.memoKey }, { o: "tiny", req: false, key: null }, "a tiny crop is neither asked nor keyed");
  });

  test("a hit makes NO request and returns the stored outcome with source memo; a hit needs no reset and no load", async () => {
    const hit = await cap.captionFigure(BIG, { modelName: "m:1", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: hit.outcome, c: hit.caption, s: hit.source, req: hit.requested, mem: hit.memoised, src: hit.memoSource, load: hit.loadMs }, { o: "captioned", c: "HUMAN TITLE: A\nbody", s: "memo", req: false, mem: false, src: "vlm", load: null });
    assert.match(hit.capturedAt, /^\d{4}-/);
    const decHit = await cap.captionFigure(BIG, { modelName: "m:2", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: decHit.outcome, c: decHit.caption, s: decHit.source }, { o: "decorative", c: null, s: "memo" });
    const trHit = await cap.captionFigure(BIG, { modelName: "m:3", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: trHit.outcome, s: trHit.source }, { o: "truncated", s: "memo" });
    const toHit = await cap.captionFigure(BIG, { modelName: "m:11", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: toHit.outcome, c: toHit.caption, s: toHit.source, req: toHit.requested }, { o: "textOnly", c: null, s: "memo", req: false }, "T32: a textOnly verdict is recalled, never re-asked");
    const otherVariant = fakeFetch(okJson({ response: "TITLE: t\nTYPE: text\nSUBJECTS: s\n\nTRANSCRIPTION:\nwords\n\nDESCRIPTION:\nprose." }));
    const nt = await cap.captionFigure(BIG, { modelName: "m:11", fetchImpl: otherVariant, memo, memoIdentity: identity, hasTextLayer: false });
    assert.deepStrictEqual({ o: nt.outcome, s: nt.source, req: nt.requested }, { o: "captioned", s: "vlm", req: true }, "the same crop under the other variant is a miss: the variants never answer for each other");
    // a seeded record is served the same way and says so
    const bytes = fs.readFileSync(BIG);
    const kSeed = cap.captionMemoKey(bytes, { modelName: "m:9", memoIdentity: identity });
    memo.put(memoMod.makeRecord({ keyInfo: kSeed, cropBytes: bytes, outcome: "captioned", caption: "the verified caption", source: "seed", seed: { class: "RAGChunkV2", docVersion: "x.y", chunkIndex: 1 } }));
    const seeded = await cap.captionFigure(BIG, { modelName: "m:9", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ c: seeded.caption, s: seeded.source, src: seeded.memoSource }, { c: "the verified caption", s: "memo", src: "seed" });
  });

  test("without a memo, or without the server's identity, captionFigure is T24's: the server is asked and nothing is stored", async () => {
    const f1 = fakeFetch(okJson({ response: "cap" }));
    const plain = await cap.captionFigure(BIG, { modelName: "m:1", fetchImpl: f1 });
    assert.deepStrictEqual({ s: plain.source, req: plain.requested, key: plain.memoKey, mem: plain.memoised }, { s: "vlm", req: true, key: null, mem: false });
    const f2 = fakeFetch(okJson({ response: "cap" }));
    const noId = await cap.captionFigure(BIG, { modelName: "m:1", fetchImpl: f2, memo, memoIdentity: null });
    assert.deepStrictEqual({ s: noId.source, req: noId.requested, key: noId.memoKey }, { s: "vlm", req: true, key: null }, "no digest, no key: the memo is bypassed, not weakened");
    assert.strictEqual(f2.calls.length, 1);
    const f3 = fakeFetch(okJson({ response: "cap" }));
    const halfId = await cap.captionFigure(BIG, { modelName: "m:1", fetchImpl: f3, memo, memoIdentity: { server: "http://o:11434", modelDigest: null } });
    assert.strictEqual(halfId.memoKey, null);
  });

  test("a memo write failure is reported on the result and never fails the caption", async () => {
    const failing = memoMod.openCaptionMemo({ dir, fsImpl: { ...fs, renameSync: () => { throw new Error("EIO"); } }, log: { warn: () => {} } });
    const r = await cap.captionFigure(BIG, { modelName: "m:10", fetchImpl: fakeFetch(okJson({ response: "cap" })), memo: failing, memoIdentity: identity });
    assert.deepStrictEqual({ o: r.outcome, c: r.caption, mem: r.memoised }, { o: "captioned", c: "cap", mem: false });
    assert.match(r.memoError, /EIO/);
  });
});

describe("U-CAPTION/T32: the two generic prompts (t32-design §2.2, D2, D4; F-100)", () => {
  const DENYLIST = [/Chester/i, /Figure 15/i, /Barratt/i, /Fervi/i, /lathe/i, /IKEA/i, /Saxon/i, /Miele/i, /floor plan/i, /square footage/i, /sq ft/i, /feet\/inches/i, /plot number/i, /site plan/i, /color-coded/i, /colour-coded/i];

  test("SYSTEM_PROMPT is gone; both prompts exist, are frozen, and name no document, figure, design or forced house-plan section", () => {
    assert.strictEqual("SYSTEM_PROMPT" in cap, false, "the demo-specific prompt is removed, not kept beside the new ones (D14: no legacy knob)");
    assert.ok(Object.isFrozen(cap.CAPTION_PROMPTS));
    assert.deepStrictEqual(Object.keys(cap.CAPTION_PROMPTS).sort(), ["noText", "withText"]);
    for (const [name, text] of Object.entries(cap.CAPTION_PROMPTS)) {
      assert.ok(typeof text === "string" && text.length > 500, name);
      for (const re of DENYLIST) assert.ok(!re.test(text), `${name} must not mention ${re}`);
      assert.ok(!/HUMAN TITLE|DIAGRAM TYPE|KEY SUBJECTS/.test(text), `${name}: the generic header labels, not the legacy ones`);
      assert.match(text, /^TITLE: /m); assert.match(text, /^TYPE: one of /m); assert.match(text, /^SUBJECTS: /m);
      assert.match(text, /^TRANSCRIPTION:$/m); assert.match(text, /^DESCRIPTION:$/m);
      assert.match(text, /exactly as printed/); assert.match(text, /\[illegible\]/); assert.match(text, /never repeat a line/);
      assert.match(text, /Do not convert/, "no unit conversion, no arithmetic in the caption (D4)");
      assert.match(text, /at most 8 sentences/i, "the description is bounded");
      assert.strictEqual((text.match(/\[DECORATIVE_ELEMENT\]/g) || []).length, 1, `${name}: the decorative token exactly once`);
    }
  });

  test("withText: verdict-first — the textOnly token exactly once, D4's Step-1 clause for text in columns, an 80-line bound with an honest tail; noText: no textOnly verdict, a 120-line bound, TYPE offers `text`", () => {
    const w = cap.CAPTION_PROMPTS.withText, n = cap.CAPTION_PROMPTS.noText;
    assert.strictEqual((w.match(/\[NO_VISUAL_CONTENT\]/g) || []).length, 1);
    assert.match(w, /^Step 1 - decide what the page contains:/m);
    assert.match(w, /text arranged in columns or boxes is still text/, "D4: the probe saw a two-column prose page called a table");
    assert.match(w, /At most 80 lines; if there is more, stop and write \[more rows not transcribed: about N\]/);
    assert.match(w, /Describe only that content \(not the surrounding prose\)/);
    assert.match(w, /^TYPE: one of  table \| dimensioned drawing \| schematic \| map or plan \| photo \| assembly step \| chart \| screenshot \| mixed$/m);
    assert.ok(!n.includes("[NO_VISUAL_CONTENT]"), "a page without a text layer is never text-only: its caption is its only index entry (D2)");
    assert.match(n, /This page has NO machine-readable text/);
    assert.match(n, /At most 120 lines; if there is more, stop and write \[more not transcribed: about N lines\]/);
    assert.match(n, /^TYPE: one of  text \| table \| dimensioned drawing \| schematic \| map or plan \| photo \| assembly step \| chart \| screenshot \| mixed$/m);
    assert.deepStrictEqual([...cap.VISUAL_TYPES], ["table", "dimensioned drawing", "schematic", "map or plan", "photo", "assembly step", "chart", "screenshot", "mixed", "text"], "the closed TYPE list the parser normalises into (D3)");
  });

  test("the md5 of each prompt is exported and is the memo key's prompt half; the decoding names every relied-on option (F-132)", () => {
    const crypto = require("crypto");
    const md5 = (t) => crypto.createHash("md5").update(t).digest("hex");
    assert.deepStrictEqual({ ...cap.CAPTION_PROMPT_MD5 }, { withText: md5(cap.CAPTION_PROMPTS.withText), noText: md5(cap.CAPTION_PROMPTS.noText) });
    assert.deepStrictEqual({ ...cap.CAPTION_DECODING }, { temperature: 0, seed: 42, num_predict: 6144, repeat_penalty: 1.1, repeat_last_n: 64 });
    assert.ok(!("presence_penalty" in cap.CAPTION_DECODING) && !("frequency_penalty" in cap.CAPTION_DECODING), "D5: the shipped greedy constant, no penalty arm adopted");
  });
});

describe("U-CAPTION/T37 (t37-design D1, D2): DEFAULT_CAPTION_MODEL — the chat model, exported; what a caller that names no model gets", () => {
  test("the constant is qwen3.8:27b (T32's arm C), exported under that name only, written once in the module's code", () => {
    assert.strictEqual(cap.DEFAULT_CAPTION_MODEL, "qwen3.8:27b");
    assert.ok(!("DEFAULT_MODEL" in cap), "the old private name is not an export");
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "vlm_captioner.js"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(src, /const DEFAULT_CAPTION_MODEL = "qwen3\.8:27b";/);
    assert.strictEqual((src.match(/"qwen3\.8:27b"/g) || []).length, 1, "the value is written once (the code, not the comments)");
    assert.ok(!/"qwen3-vl:30b"/.test(src), "no VLM literal remains in the module's code");
  });

  test("captionFigure without modelName posts the constant and reports it", async () => {
    const f = fakeFetch(okJson({ response: "TITLE: x\nTYPE: y\nSUBJECTS: z" }));
    const r = await cap.captionFigure(BIG, { fetchImpl: f });
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].body.model, cap.DEFAULT_CAPTION_MODEL);
    assert.strictEqual(r.model, cap.DEFAULT_CAPTION_MODEL);
    assert.strictEqual(r.outcome, "captioned");
  });

  test("resolveCaptionServer without modelName reads the constant's digest from /api/tags; resetCaptionServer without modelName unloads it; captionMemoKey without modelName keys by it (the VLM's records are another key)", async () => {
    const tags = okJson({ models: [{ name: "qwen3-vl:30b", model: "qwen3-vl:30b", digest: "eda0be100877" }, { name: cap.DEFAULT_CAPTION_MODEL, model: cap.DEFAULT_CAPTION_MODEL, digest: "22130167c4c2" }] });
    const id = await cap.resolveCaptionServer({ ollamaUrl: "http://o:11434/v1/", fetchImpl: async () => tags });
    assert.strictEqual(id.ok, true, "the default is among the server's tags");
    assert.strictEqual(id.modelDigest, "22130167c4c2", "the default's digest, not the VLM's");
    const calls = [];
    const impl = async (url, init) => { calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return /\/api\/ps$/.test(url) ? okJson({ models: [] }) : okJson({ done: true }); };
    const reset = await cap.resetCaptionServer({ ollamaUrl: "http://o:11434/v1/", fetchImpl: impl, pollMs: 1, sleep: async () => {} });
    assert.strictEqual(reset.ok, true);
    assert.deepStrictEqual(calls[0].body, { model: cap.DEFAULT_CAPTION_MODEL, keep_alive: 0 }, "the reset unloads the default captioner — the chat model (design D5)");
    const bytes = fs.readFileSync(BIG);
    const identity = { server: "http://o:11434", modelDigest: "22130167c4c2" };
    const none = cap.captionMemoKey(bytes, { memoIdentity: identity });
    assert.deepStrictEqual(none, cap.captionMemoKey(bytes, { modelName: cap.DEFAULT_CAPTION_MODEL, memoIdentity: identity }), "no model named = the default's key");
    assert.strictEqual(none.modelName, cap.DEFAULT_CAPTION_MODEL);
    assert.notStrictEqual(none.key, cap.captionMemoKey(bytes, { modelName: "qwen3-vl:30b", memoIdentity: identity }).key, "the VLM's records stay under their own key");
  });
});

describe("U-CAPTION/T33 (t33-design D3, D8): the detail passes' prompts and askDetail — the same client, decoding, timeout, memo and outcomes as a caption", () => {
  const DENYLIST = [/Chester/i, /Figure 15/i, /Barratt/i, /Fervi/i, /lathe/i, /IKEA/i, /Saxon/i, /Miele/i, /floor plan/i, /square footage/i, /sq ft/i, /feet\/inches/i, /plot number/i, /site plan/i, /color-coded/i, /colour-coded/i, /Denby/i];
  const memoMod = require("../../src/lib/ingestion/caption_memo.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u-detail-memo-"));
  const memo = memoMod.openCaptionMemo({ dir, log: { warn: () => {} } });
  const identity = { server: "http://o:11434", modelDigest: "22130167c4c2" };
  const never = async () => { throw new Error("a memo hit must make NO request"); };
  const KEY = "dark red | The D 3 bedroom home\nyellow | The C 4 bedroom home";

  test("three generic prompts — KEY (fixed), INDEX (the key text and the page's subject embedded), TRANSCRIBE (the subject embedded): no document, figure or design named; their md5s exported; a different key is a different INDEX prompt", () => {
    assert.ok(Object.isFrozen(cap.DETAIL_PROMPTS));
    assert.deepStrictEqual(Object.keys(cap.DETAIL_PROMPTS).sort(), ["index", "key", "transcribe"]);
    assert.deepStrictEqual([...cap.DETAIL_STAGES], ["key", "index", "transcribe"]);
    const texts = { key: cap.detailPromptFor("key"), index: cap.detailPromptFor("index", { keyText: "", subject: "" }), transcribe: cap.detailPromptFor("transcribe", { subject: "" }) };
    for (const [name, text] of Object.entries(texts)) {
      assert.ok(text.length > 300, name);
      for (const re of DENYLIST) assert.ok(!re.test(text), `${name} must not mention ${re}`);
      assert.match(text, /reply with exactly: NONE$/, `${name}: the "nothing here" verdict`);
    }
    assert.match(texts.key, /^attribute \| name$/m);
    assert.match(texts.key, /legend or key entry/);
    assert.match(texts.index, /^label \| category name$/m);
    assert.match(texts.index, /Write UNKNOWN for a fill that matches no key entry/);
    assert.match(texts.index, /cut off at the tile's edge/);
    assert.match(texts.transcribe, /exactly as printed/); assert.match(texts.transcribe, /\[illegible\]/); assert.match(texts.transcribe, /never repeat a line/); assert.match(texts.transcribe, /Do not convert units/);
    const withKey = cap.detailPromptFor("index", { keyText: KEY, subject: "a map or plan" });
    assert.ok(withKey.includes(`This is the page's key:\n${KEY}\n`), "the key text rides inside the prompt");
    assert.ok(withKey.includes("(a map or plan)"));
    const crypto = require("crypto");
    const md5 = (t) => crypto.createHash("md5").update(t).digest("hex");
    assert.deepStrictEqual({ ...cap.DETAIL_PROMPT_MD5 }, { key: md5(texts.key), indexTemplate: md5(texts.index), transcribeTemplate: md5(texts.transcribe) });
    assert.strictEqual(cap.detailPromptMd5("index", { keyText: KEY, subject: "a map or plan" }), md5(withKey));
    assert.notStrictEqual(cap.detailPromptMd5("index", { keyText: KEY, subject: "a map or plan" }), cap.detailPromptMd5("index", { keyText: KEY + "\nteal | The A", subject: "a map or plan" }), "a legend change is a new prompt — a new memo key for every tile of the page (D8)");
    assert.throws(() => cap.detailPromptFor("nope"), /unknown stage/);
    assert.deepStrictEqual([...cap.DETAIL_OUTCOMES], ["answered", "empty", "truncated", "tiny", "missing", "http_error", "timeout", "error"]);
  });

  test("the request: the stage's prompt, the tile's bytes, options deep-equal to CAPTION_DECODING, the constant model when none is named; the answered outcome carries the trimmed reply; a NONE reply is an answer", async () => {
    const f = fakeFetch(okJson({ response: "  219 | The C 4 bedroom home\n218 | The D 3 bedroom home  ", load_duration: 6600000000 }));
    const r = await cap.askDetail(BIG, { stage: "index", keyText: KEY, subject: "a map or plan", ollamaUrl: "http://o:11434/v1/", fetchImpl: f, label: "doc.pdf p1 (r0c0)" });
    assert.deepStrictEqual({ o: r.outcome, reply: r.reply, stage: r.stage, model: r.model, source: r.source, req: r.requested, key: r.memoKey, mem: r.memoised, load: r.loadMs, status: r.status }, { o: "answered", reply: "219 | The C 4 bedroom home\n218 | The D 3 bedroom home", stage: "index", model: cap.DEFAULT_CAPTION_MODEL, source: "vlm", req: true, key: null, mem: false, load: 6600, status: 200 });
    assert.strictEqual(r.promptMd5, cap.detailPromptMd5("index", { keyText: KEY, subject: "a map or plan" }));
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].url, "http://o:11434/api/generate");
    const body = f.calls[0].body;
    assert.deepStrictEqual(Object.keys(body).sort(), ["images", "model", "options", "prompt", "stream"]);
    assert.deepStrictEqual(body.options, { ...cap.CAPTION_DECODING }, "the captioner's decoding, unchanged (D8)");
    assert.strictEqual(body.prompt, cap.detailPromptFor("index", { keyText: KEY, subject: "a map or plan" }));
    assert.strictEqual(body.model, cap.DEFAULT_CAPTION_MODEL);
    assert.strictEqual(Buffer.from(body.images[0], "base64").length, cap.CAPTION_MIN_BYTES + 10);
    const none = await cap.askDetail(BIG, { stage: "key", fetchImpl: fakeFetch(okJson({ response: "NONE" })) });
    assert.deepStrictEqual({ o: none.outcome, reply: none.reply }, { o: "answered", reply: "NONE" }, "NONE is the model's verdict, an answer (the parser downgrades a keyed-index plan on it)");
    const k = await cap.askDetail(BIG, { stage: "key", fetchImpl: fakeFetch(okJson({ response: "x" })) });
    assert.strictEqual(k.promptMd5, cap.DETAIL_PROMPT_MD5.key);
    assert.strictEqual(cap.detailPromptFor("key", { keyText: "ignored", subject: "ignored" }), cap.DETAIL_PROMPTS.key, "the KEY prompt is fixed");
  });

  test("one outcome per reply shape, never a throw: truncated (the cap, before any parse), empty, tiny, missing, http_error, timeout, error; a wrong stage is a programming error", async () => {
    const tr = await cap.askDetail(BIG, { stage: "transcribe", fetchImpl: fakeFetch(okJson({ response: "a a a", done_reason: "length", eval_count: 6144 })) });
    assert.deepStrictEqual({ o: tr.outcome, reply: tr.reply }, { o: "truncated", reply: null });
    assert.match(tr.error, /6144-token cap/);
    assert.strictEqual((await cap.askDetail(BIG, { stage: "key", fetchImpl: fakeFetch(okJson({ response: "   " })) })).outcome, "empty");
    const f = fakeFetch(okJson({ response: "x" }));
    assert.strictEqual((await cap.askDetail(TINY, { stage: "key", fetchImpl: f })).outcome, "tiny");
    assert.strictEqual((await cap.askDetail(path.join(tmp, "nope.png"), { stage: "key", fetchImpl: f })).outcome, "missing");
    assert.strictEqual(f.calls.length, 0, "tiny and missing make no request");
    const he = await cap.askDetail(BIG, { stage: "key", fetchImpl: fakeFetch(httpError(503, "busy")) });
    assert.deepStrictEqual({ o: he.outcome, s: he.status }, { o: "http_error", s: 503 });
    const to = await cap.askDetail(BIG, { stage: "key", timeoutMs: 77, fetchImpl: async () => { throw timeoutErr(); } });
    assert.strictEqual(to.outcome, "timeout"); assert.match(to.error, /77 ms/);
    const er = await cap.askDetail(BIG, { stage: "key", fetchImpl: async () => { throw new Error("socket hang up"); } });
    assert.strictEqual(er.outcome, "error");
    await assert.rejects(() => cap.askDetail(BIG, { stage: "caption", fetchImpl: f }), /stage must be one of key, index, transcribe/);
    assert.strictEqual(cap.CAPTION_TIMEOUT_MS, 120000, "the same timeout as a caption (D8)");
  });

  test("the memo (D8): a miss asks and remembers an answered reply as a captioned record and a truncated one as truncated — never a failure, never empty; a hit makes NO request; the stage's prompt is the key's prompt half; the hint names the tile", async () => {
    const f = fakeFetch(okJson({ response: "219 | The C 4 bedroom home" }));
    const r = await cap.askDetail(BIG, { stage: "index", keyText: KEY, subject: "a map or plan", modelName: "m:1", fetchImpl: f, memo, memoIdentity: identity, jobId: "job-33", hint: { fileName: "a.pdf", docHash: "h", page: 1, figureId: "detail_1_r0c0", stage: "index" } });
    assert.deepStrictEqual({ o: r.outcome, s: r.source, req: r.requested, mem: r.memoised }, { o: "answered", s: "vlm", req: true, mem: true });
    assert.match(r.memoKey, /^[0-9a-f]{64}$/);
    const rec = memo.get(r.memoKey);
    assert.deepStrictEqual({ o: rec.outcome, c: rec.caption, p: rec.promptMd5, h: rec.hint, j: rec.jobId, m: rec.model, d: rec.modelDigest, srv: rec.server }, { o: "captioned", c: "219 | The C 4 bedroom home", p: cap.detailPromptMd5("index", { keyText: KEY, subject: "a map or plan" }), h: { fileName: "a.pdf", docHash: "h", page: 1, figureId: "detail_1_r0c0", stage: "index" }, j: "job-33", m: "m:1", d: identity.modelDigest, srv: identity.server }, "the memo module's vocabulary unchanged: the reply travels in `caption`");
    assert.strictEqual(r.memoKey, cap.detailMemoKey(fs.readFileSync(BIG), { modelName: "m:1", memoIdentity: identity, stage: "index", keyText: KEY, subject: "a map or plan" }).key, "detailMemoKey forms the same key the call used");
    const hit = await cap.askDetail(BIG, { stage: "index", keyText: KEY, subject: "a map or plan", modelName: "m:1", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: hit.outcome, reply: hit.reply, s: hit.source, req: hit.requested, src: hit.memoSource }, { o: "answered", reply: "219 | The C 4 bedroom home", s: "memo", req: false, src: "vlm" });
    const other = await cap.askDetail(BIG, { stage: "index", keyText: KEY + "\nteal | The A", subject: "a map or plan", modelName: "m:1", fetchImpl: fakeFetch(okJson({ response: "1 | The A" })), memo, memoIdentity: identity });
    assert.deepStrictEqual({ s: other.source, req: other.requested }, { s: "vlm", req: true }, "another key text is another prompt, another memo key: a miss");
    const stage2 = await cap.askDetail(BIG, { stage: "key", modelName: "m:1", fetchImpl: fakeFetch(okJson({ response: "NONE" })), memo, memoIdentity: identity });
    assert.deepStrictEqual({ s: stage2.source, req: stage2.requested, mem: stage2.memoised, reply: stage2.reply }, { s: "vlm", req: true, mem: true, reply: "NONE" }, "the same bytes under the KEY prompt are another key; NONE is remembered");
    const noneHit = await cap.askDetail(BIG, { stage: "key", modelName: "m:1", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: noneHit.outcome, reply: noneHit.reply, s: noneHit.source }, { o: "answered", reply: "NONE", s: "memo" });
    const tr = await cap.askDetail(BIG, { stage: "transcribe", subject: "a table", modelName: "m:2", fetchImpl: fakeFetch(okJson({ response: "x", done_reason: "length", eval_count: 6144 })), memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: tr.outcome, mem: tr.memoised }, { o: "truncated", mem: true });
    const trHit = await cap.askDetail(BIG, { stage: "transcribe", subject: "a table", modelName: "m:2", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: trHit.outcome, s: trHit.source, reply: trHit.reply }, { o: "truncated", s: "memo", reply: null }, "a truncated reply is a deterministic absence, recalled");
    for (const [model, fetchImpl, expected] of [["m:4", fakeFetch(okJson({ response: " " })), "empty"], ["m:5", fakeFetch(httpError(500, "boom")), "http_error"], ["m:6", async () => { throw timeoutErr(); }, "timeout"], ["m:7", async () => { throw new Error("ECONNRESET"); }, "error"]]) {
      const x = await cap.askDetail(BIG, { stage: "key", modelName: model, fetchImpl, memo, memoIdentity: identity });
      assert.strictEqual(x.outcome, expected);
      assert.deepStrictEqual({ req: x.requested, mem: x.memoised }, { req: true, mem: false }, `${expected} is asked but never remembered`);
      assert.strictEqual(memo.has(x.memoKey), false);
    }
    const plain = await cap.askDetail(BIG, { stage: "key", modelName: "m:1", fetchImpl: fakeFetch(okJson({ response: "NONE" })) });
    assert.deepStrictEqual({ s: plain.source, key: plain.memoKey }, { s: "vlm", key: null }, "without a memo or an identity: asked, nothing stored");
    assert.throws(() => cap.detailMemoKey(fs.readFileSync(BIG), { stage: "key" }), /memoIdentity/);
  });

  test("the log lines name the document, the page and the tile (F-119's rule), under a `VLM Detail` prefix", async () => {
    const lines = [];
    const orig = console.warn; console.warn = (...a) => lines.push(a.join(" "));
    try {
      await cap.askDetail(BIG, { stage: "index", label: "Barratt_Homes_SitePlan.pdf p1 (r0c1)", timeoutMs: 5, fetchImpl: async () => { throw timeoutErr(); } });
      await cap.askDetail(path.join(tmp, "gone.png"), { stage: "key", label: "SSX125_Manual.pdf p26 (key)", fetchImpl: fakeFetch(okJson({})) });
    } finally { console.warn = orig; }
    assert.match(lines[0], /^\[VLM Detail timeout\] Barratt_Homes_SitePlan\.pdf p1 \(r0c1\): no reply within 5 ms/);
    assert.match(lines[1], /^\[VLM Detail missing\] SSX125_Manual\.pdf p26 \(key\)/);
  });
});

// T46 (t46-design §2.1, D1 a, D7, D8): the CHAIN pass — the design probe's V4 prompt byte for byte, asked through
// askDetail's own request path (the memo, the decoding, the timeout, the outcomes), under its own memo key.
describe("U-CAPTION/T46 (t46-design §2.1, D8): the chain prompt and askChain — the detail pass's shape under its own key", () => {
  const memoMod = require("../../src/lib/ingestion/caption_memo.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u-chain-memo-"));
  const memo = memoMod.openCaptionMemo({ dir, log: { warn: () => {} } });
  const identity = { server: "http://o:11434", modelDigest: "22130167c4c2" };
  const never = async () => { throw new Error("a memo hit must make NO request"); };
  const PROBE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "eval", "baselines", "t46-artifacts", "probes", "records", "chain-1790346207.json"), "utf8"));

  test("the chain prompt IS the probe's V4 — byte for byte (the prompt its 29 cold / warm asks measured), md5 e07b9cbe…; generic: no document, figure or value named; NO_DIMENSIONS for the control; no POINTS asked, no anchor list", () => {
    assert.strictEqual(cap.CHAIN_PROMPT, PROBE.variants.V4);
    assert.strictEqual(cap.CHAIN_PROMPT_MD5, "e07b9cbe4f1a44376ee0577e8f14a538");
    assert.match(cap.CHAIN_PROMPT, /^NO_DIMENSIONS$/m);
    assert.match(cap.CHAIN_PROMPT, /^ALIGNED:$/m);
    assert.match(cap.CHAIN_PROMPT, /from <endpoint> to <endpoint> \(horizontal\|vertical\): <value> <unit as printed>/);
    assert.match(cap.CHAIN_PROMPT, /Do not compute anything\./);
    assert.ok(!/^POINTS:/m.test(cap.CHAIN_PROMPT), "the points are dimension_chain.js's, never the model's");
    for (const word of [/Fervi/i, /Figure 15/i, /1728/, /Miele/i, /lathe/i, /as already transcribed/i]) assert.ok(!word.test(cap.CHAIN_PROMPT), `${word} is not in the prompt`);
  });

  test("askChain: the request is askDetail's (the page render, the captioner's decoding, stage \"chain\"); a miss remembers the reply — NO_DIMENSIONS too — and a hit makes NO request; chainMemoKey forms the call's key, which is neither a caption's nor a tile's", async () => {
    const f = fakeFetch(okJson({ response: "NO_DIMENSIONS" }));
    const r = await cap.askChain(BIG, { modelName: "m:1", fetchImpl: f, memo, memoIdentity: identity, jobId: "job-46", hint: { fileName: "a.pdf", docHash: "h", page: 53, figureId: "fig_53_0", stage: "chain" } });
    assert.deepStrictEqual({ o: r.outcome, reply: r.reply, stage: r.stage, s: r.source, req: r.requested, mem: r.memoised, p: r.promptMd5 }, { o: "answered", reply: "NO_DIMENSIONS", stage: "chain", s: "vlm", req: true, mem: true, p: cap.CHAIN_PROMPT_MD5 });
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].body.prompt, cap.CHAIN_PROMPT);
    assert.deepStrictEqual(f.calls[0].body.options, { ...cap.CAPTION_DECODING });
    assert.strictEqual(f.calls[0].body.images.length, 1);
    assert.strictEqual(r.memoKey, cap.chainMemoKey(fs.readFileSync(BIG), { modelName: "m:1", memoIdentity: identity }).key);
    assert.deepStrictEqual(memo.get(r.memoKey).hint, { fileName: "a.pdf", docHash: "h", page: 53, figureId: "fig_53_0", stage: "chain" });
    const hit = await cap.askChain(BIG, { modelName: "m:1", fetchImpl: never, memo, memoIdentity: identity });
    assert.deepStrictEqual({ o: hit.outcome, reply: hit.reply, s: hit.source, req: hit.requested }, { o: "answered", reply: "NO_DIMENSIONS", s: "memo", req: false });
    const bytes = fs.readFileSync(BIG);
    const chainKey = cap.chainMemoKey(bytes, { modelName: "m:1", memoIdentity: identity }).key;
    assert.notStrictEqual(chainKey, cap.captionMemoKey(bytes, { modelName: "m:1", memoIdentity: identity }).key, "not the caption's key (the same render)");
    for (const stage of ["key", "index", "transcribe"]) assert.notStrictEqual(chainKey, cap.detailMemoKey(bytes, { modelName: "m:1", memoIdentity: identity, stage }).key, `not the ${stage} key`);
    assert.throws(() => cap.chainMemoKey(bytes, { modelName: "m:1" }), /memoIdentity/);
  });

  test("the outcomes and the log line are the detail pass's under a `VLM Chain` prefix; askDetail still refuses a chain stage (its three stages unchanged)", async () => {
    assert.strictEqual((await cap.askChain(TINY, { fetchImpl: never })).outcome, "tiny");
    const lines = [];
    const orig = console.warn; console.warn = (...a) => lines.push(a.join(" "));
    try {
      const to = await cap.askChain(BIG, { label: "Fervi_Lathe_TechnicalSupportManual.pdf p25 (chain)", timeoutMs: 5, fetchImpl: async () => { throw timeoutErr(); } });
      assert.strictEqual(to.outcome, "timeout");
      const cut = await cap.askChain(BIG, { label: "x.pdf p1 (chain)", fetchImpl: fakeFetch(okJson({ response: "from", done_reason: "length", eval_count: 6144 })) });
      assert.deepStrictEqual({ o: cut.outcome, reply: cut.reply }, { o: "truncated", reply: null });
    } finally { console.warn = orig; }
    assert.match(lines[0], /^\[VLM Chain timeout\] Fervi_Lathe_TechnicalSupportManual\.pdf p25 \(chain\): no reply within 5 ms/);
    assert.match(lines[1], /^\[VLM Chain truncated\] x\.pdf p1 \(chain\)/);
    await assert.rejects(() => cap.askDetail(BIG, { stage: "chain", fetchImpl: never }), /stage must be one of key, index, transcribe/);
  });
});
