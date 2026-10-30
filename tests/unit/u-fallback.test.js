/**
 * U-FALLBACK — F-163: the internal-first fetch with a budget PER ATTEMPT.
 *
 * The pure module src/lib/rag/fallback_fetch.js: the caller names a budget
 * per attempt and never a signal; the internal attempt gets the whole budget;
 * a fast failure of the internal path falls back to the external one with a
 * LIVE signal and a full budget; a TIMEOUT is the call's own cost (measured
 * 2026-09-22: the same payload takes the same time on both paths) and is not
 * retried; a URL that does not translate is one attempt; the trace says which
 * path served, what each attempt cost and whether the fallback was taken.
 * Then the two routes that carried their own copy of the helper are walked
 * for the shape that caused F-163 (a shared `signal:` inside the helper's
 * options). Offline; reads nothing outside src/.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { fetchWithInternalFallback, isTimeout } = require("../../src/lib/rag/fallback_fetch");

const EXTERNAL = "https://rerank.example.test/v1/rerank";
const INTERNAL = "http://rerank.svc.cluster.local:80/v1/rerank";
const translate = (url) => (url === EXTERNAL ? { url: INTERNAL, headers: { Host: "rerank.example.test" } } : { url, headers: {} });

// A fetch that answers, one that fails at once, and one that hangs until its
// signal aborts (what a slow MLIS path looks like from the caller's side).
const answer = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const failFast = (message) => async () => { throw new Error(message); };
// (AbortSignal.timeout's own timer is unref'd, so a pending promise alone would
// let the event loop drain and node:test cancel the case — the fake keeps a
// ref'd timer until its signal fires.)
const hang = () => (url, opts) =>
  new Promise((_, reject) => {
    if (!opts || !opts.signal) return reject(new Error("the fake needs a signal"));
    if (opts.signal.aborted) return reject(opts.signal.reason || new Error("aborted before the call"));
    const keepAlive = setTimeout(() => {}, 60000);
    opts.signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(opts.signal.reason || new Error("The operation was aborted due to timeout")); }, { once: true });
  });
// Routes by URL and records every call (url, headers, whether the signal was already spent).
const router = (table) => {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, headers: opts.headers, abortedAtCall: !!(opts.signal && opts.signal.aborted), hasSignal: !!opts.signal });
    const handler = table[url];
    if (!handler) throw new Error(`no route for ${url}`);
    return handler(url, opts);
  };
  return { impl, calls };
};

describe("U-FALLBACK/F-163: the contract", () => {
  test("a budget is required, a signal is refused, a timeout is recognised by name or by wording", async () => {
    await assert.rejects(() => fetchWithInternalFallback(EXTERNAL, {}, { fetchImpl: answer({}) }), /budgetMs/);
    await assert.rejects(() => fetchWithInternalFallback(EXTERNAL, {}, { fetchImpl: answer({}), budgetMs: 0 }), /budgetMs/);
    await assert.rejects(
      () => fetchWithInternalFallback(EXTERNAL, { signal: AbortSignal.timeout(1000) }, { fetchImpl: answer({}), budgetMs: 1000 }),
      /not a signal/
    );
    assert.strictEqual(isTimeout(Object.assign(new Error("x"), { name: "TimeoutError" })), true);
    assert.strictEqual(isTimeout(new Error("The operation was aborted due to timeout")), true);
    assert.strictEqual(isTimeout(new Error("connect ECONNREFUSED")), false);
    assert.strictEqual(isTimeout(null), false);
  });

  test("a URL that does not translate: ONE attempt with the whole budget, served 'direct', an error rethrown unchanged", async () => {
    const r = router({ [EXTERNAL]: answer({ results: [] }) });
    const trace = {};
    const res = await fetchWithInternalFallback(EXTERNAL, { method: "POST", headers: { A: "1" } }, { fetchImpl: r.impl, budgetMs: 500, trace });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(r.calls.map((c) => c.url), [EXTERNAL]);
    assert.ok(r.calls[0].hasSignal && !r.calls[0].abortedAtCall);
    assert.deepStrictEqual(r.calls[0].headers, { A: "1" });
    assert.strictEqual(trace.served, "direct");
    assert.strictEqual(trace.fallback, "none");
    assert.strictEqual(trace.budgetMs, 500);
    assert.ok(Number.isInteger(trace.internalMs));
    assert.strictEqual(trace.externalMs, null);

    const boom = router({ [EXTERNAL]: failFast("ECONNREFUSED") });
    const t2 = {};
    await assert.rejects(() => fetchWithInternalFallback(EXTERNAL, {}, { fetchImpl: boom.impl, budgetMs: 500, trace: t2 }), /ECONNREFUSED/);
    assert.strictEqual(boom.calls.length, 1);
    assert.strictEqual(t2.served, null);
    assert.strictEqual(t2.internalError, "ECONNREFUSED");
  });

  test("the internal path answers: served 'internal', the internal headers merged over the caller's, the external never called", async () => {
    const r = router({ [INTERNAL]: answer({ ok: 1 }), [EXTERNAL]: failFast("must not be called") });
    const trace = {};
    const res = await fetchWithInternalFallback(EXTERNAL, { headers: { "Content-Type": "application/json" } }, { fetchImpl: r.impl, translate, budgetMs: 500, trace });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(r.calls.map((c) => c.url), [INTERNAL]);
    assert.deepStrictEqual(r.calls[0].headers, { "Content-Type": "application/json", Host: "rerank.example.test" });
    assert.strictEqual(trace.served, "internal");
    assert.strictEqual(trace.fallback, "not-needed");
    assert.strictEqual(trace.internalError, null);
    assert.strictEqual(trace.externalMs, null);
  });

  test("F-163 itself: the internal path is UNREACHABLE (a fast failure) — the external attempt gets a LIVE signal and a full budget of its own", async () => {
    const r = router({ [INTERNAL]: failFast("connect ECONNREFUSED 10.0.0.1:80"), [EXTERNAL]: answer({ results: [{ index: 0, relevance_score: 0.9 }] }) });
    const trace = {};
    const lines = [];
    const res = await fetchWithInternalFallback(EXTERNAL, { method: "POST", headers: { "Content-Type": "application/json" } }, {
      fetchImpl: r.impl, translate, budgetMs: 400, trace, log: (l) => lines.push(l),
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(r.calls.map((c) => c.url), [INTERNAL, EXTERNAL]);
    // The defect: the fallback's signal was the internal attempt's. Now it is its own, and unspent.
    assert.strictEqual(r.calls[1].abortedAtCall, false, "the fallback's signal must not be spent");
    assert.deepStrictEqual(r.calls[1].headers, { "Content-Type": "application/json" }, "the external attempt carries the caller's headers, not the internal Host");
    assert.strictEqual(trace.served, "external");
    assert.strictEqual(trace.fallback, "taken");
    assert.strictEqual(trace.internalError, "connect ECONNREFUSED 10.0.0.1:80");
    assert.ok(Number.isInteger(trace.externalMs));
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /Falling back to external URL .* with its own 400 ms budget/);
  });

  test("the internal path TIMES OUT: no second attempt — the time was the call's, the error is the timeout, the trace says the fallback was not taken", async () => {
    const r = router({ [INTERNAL]: hang(), [EXTERNAL]: failFast("must not be called") });
    const trace = {};
    const lines = [];
    const t0 = Date.now();
    await assert.rejects(() => fetchWithInternalFallback(EXTERNAL, {}, { fetchImpl: r.impl, translate, budgetMs: 300, trace, log: (l) => lines.push(l) }), /aborted|timeout/i);
    const elapsed = Date.now() - t0;
    assert.deepStrictEqual(r.calls.map((c) => c.url), [INTERNAL], "the external path was not tried");
    assert.strictEqual(trace.served, null);
    assert.strictEqual(trace.fallback, "not-taken-timeout");
    assert.match(trace.internalError, /aborted|timeout/i);
    assert.strictEqual(trace.externalMs, null);
    assert.ok(trace.internalMs >= 250 && trace.internalMs < 450, `the internal attempt had the WHOLE budget (300 ms): ${trace.internalMs}`);
    assert.ok(elapsed < 300 + 150, `the call ends at one budget: ${elapsed} ms`);
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /timed out after \d+ ms of the 300 ms budget\. No fallback/);
  });

  test("the internal attempt has the whole budget: a call that needs more than half of it is served (the half-and-half split was measured to fail these)", async () => {
    // Answers after 70 % of the budget — inside one attempt, outside a half.
    const slow = (url, opts) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({}) }), 280);
      opts.signal.addEventListener("abort", () => { clearTimeout(timer); reject(opts.signal.reason || new Error("aborted")); }, { once: true });
    });
    const r = router({ [INTERNAL]: slow, [EXTERNAL]: failFast("must not be called") });
    const trace = {};
    const res = await fetchWithInternalFallback(EXTERNAL, {}, { fetchImpl: r.impl, translate, budgetMs: 400, trace });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(trace.served, "internal");
    assert.ok(trace.internalMs >= 250, `${trace.internalMs}`);
    assert.strictEqual(r.calls.length, 1);
  });

  test("both attempts fail: the external's error is thrown and the trace carries both", async () => {
    const r = router({ [INTERNAL]: failFast("getaddrinfo ENOTFOUND"), [EXTERNAL]: failFast("HTTP 503 from the edge") });
    const trace = {};
    await assert.rejects(() => fetchWithInternalFallback(EXTERNAL, {}, { fetchImpl: r.impl, translate, budgetMs: 300, trace }), /503/);
    assert.strictEqual(trace.served, null);
    assert.strictEqual(trace.fallback, "taken");
    assert.strictEqual(trace.internalError, "getaddrinfo ENOTFOUND");
    assert.strictEqual(trace.externalError, "HTTP 503 from the edge");
  });
});

describe("U-FALLBACK/F-163: the routes carry no copy of the helper and no shared signal", () => {
  const ROUTES = ["src/app/api/rag/retrieve/route.js", "src/app/api/rerank-test/route.js"];
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", "..", p), "utf8");

  for (const route of ROUTES) {
    test(`${route}: imports the module, defines no async copy, and every call names budgetMs and no signal`, () => {
      const src = read(route);
      assert.match(src, /from "@\/lib\/rag\/fallback_fetch"/, "the route imports the one helper");
      assert.doesNotMatch(src, /async function fetchWithInternalFallback/, "the pre-F-163 copy is gone");
      const calls = src.split("fetchWithInternalFallback(").slice(1).filter((s) => !/^targetUrl, options/.test(s));
      assert.ok(calls.length >= 3, `the route's hops go through the helper: ${calls.length}`);
      for (const c of calls) {
        // The call's argument list ends at the first `});` — the options object closes and the deps object follows on the same line.
        const end = c.indexOf("});");
        const args = c.slice(0, end + 3);
        assert.doesNotMatch(args, /signal\s*:/, `a shared signal inside the helper's options is F-163's shape: ${args.slice(0, 120)}`);
        assert.match(args, /\{\s*budgetMs\s*:/, `every call names its budget: ${args.slice(0, 120)}`);
      }
    });
  }

  test("the retrieve route: the dedicated rerank stage sends BOUNDED requests, each with the deadline's remaining time as its budget, and the report names which path served each (T42)", () => {
    const src = read(ROUTES[0]);
    // T42: the stage's budget is resolved config (`rerankBudgetMs`; the enumeration profile's own), not a route constant.
    assert.doesNotMatch(src, /const RERANK_CALL_BUDGET_MS/, "the 60 s route constant is gone — the deadline is the resolved config's");
    assert.match(src, /from "@\/lib\/rag\/rerank_batches"/, "the route imports the pure planner");
    assert.match(src, /planRerankBatches\(documents, bounds\)/);
    assert.match(src, /remainingBudgetMs\(budgetMs, Date\.now\(\) - stageStart\)/, "each request is given what is left of the deadline");
    assert.match(src, /if \(remaining <= 0\) break;/, "no request starts with no time left (D5)");
    assert.match(src, /budgetMs: remaining, trace: transport/);
    assert.match(src, /fallback \$\{transport\.fallback\}, budget \$\{transport\.budgetMs\} ms per attempt/);
    assert.match(src, /report\.transport = \{ plan, batches: sentBatches/);
    assert.match(src, /if \(rerankTransport\) report\.rerankTransport = rerankTransport;/);
    assert.match(src, /maxChars: cfg\.rerankMaxChars, maxDocs: cfg\.rerankMaxDocs, budgetMs: cfg\.rerankBudgetMs/, "the route hands the resolved bounds to the stage");
    // The embedding call is a direct fetch with its own signal — not a fallback, not this finding's.
    assert.strictEqual((src.match(/AbortSignal\.timeout\(/g) || []).length, 1, "one direct timeout left: the embedding call");
  });
});
