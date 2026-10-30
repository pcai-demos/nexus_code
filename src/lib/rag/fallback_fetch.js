/**
 * F-163 — a fetch that tries an in-cluster URL first and falls back to the
 * external one, each attempt with a signal of its own.
 *
 * Before this module each of the two API routes that talk to an MLIS hop
 * carried its own copy of `fetchWithInternalFallback(targetUrl, options)`,
 * and the caller put ONE `signal: AbortSignal.timeout(60000)` into `options`.
 * The internal attempt and its external fallback then shared that signal, so
 * when the internal call was slow enough to exhaust it the "fallback" fetch
 * rejected at once with the same `The operation was aborted due to timeout`
 * — the container log's `Internal k8s URL … unreachable … Falling back to
 * external URL …` followed within a millisecond by the fallback's failure,
 * and the turn answered `degraded` (RERANK_DOWN on a 200).
 *
 * What the fallback is FOR, measured on 2026-09-22 (session 43,
 * `t40-artifacts/records/livepass43/rerank-curve*.jsonl`): the reranker's
 * time is the payload's, not the path's — the same 83 KB call took 73 s on
 * the internal path and 73 s on the external one, a 121 KB call 99–116 s on
 * both, a 36 KB call 6.7 s on both. So a TIMEOUT on the internal path is the
 * model's time and a second attempt on the other path would spend it again
 * (a half-and-half split of the budget was measured to fail calls that one
 * whole attempt served). The fallback exists for an UNREACHABLE internal
 * path — a refused connection, a DNS miss, a reset — which fails fast.
 *
 * The contract here:
 *   - the caller names a `budgetMs` per attempt; it never passes a `signal`
 *     (a shared signal is the defect — the function refuses one);
 *   - the internal attempt gets the whole budget;
 *   - when the internal attempt fails for a reason OTHER than its timeout and
 *     the URL translates, the external attempt runs with a fresh signal and
 *     the whole budget (such a failure is fast in practice, so the call still
 *     ends near one budget; the trace records both attempts' times);
 *   - when the internal attempt TIMES OUT there is no second attempt: the
 *     error is rethrown and the trace says the fallback was not taken and why;
 *   - when the URL does not translate there is one attempt with the whole
 *     budget and its error is rethrown unchanged;
 *   - a `trace` object, when given, is filled with which path served the call,
 *     how long each attempt took and whether the fallback was taken.
 *
 * Pure: `fetchImpl`, `translate`, `now` and `log` are injected, so the unit
 * suite (U-FALLBACK) runs offline with a fetch that hangs until its signal
 * aborts.
 */

const identityTranslate = (url) => ({ url, headers: {} });

function attemptSignal(ms) {
  return AbortSignal.timeout(Math.max(1, Math.floor(ms)));
}

function errorText(err) {
  return String((err && err.message) || err || "").slice(0, 200);
}

/** AbortSignal.timeout's abort reason is a DOMException named TimeoutError; older runtimes word it in the message. */
function isTimeout(err) {
  return !!err && (err.name === "TimeoutError" || /aborted due to timeout/i.test(String(err.message || "")));
}

/**
 * @param {string} targetUrl        the external (configured) URL
 * @param {object} options          fetch options WITHOUT a signal
 * @param {object} deps
 * @param {number} deps.budgetMs    the budget of an attempt
 * @param {function} [deps.translate]   external URL → { url, headers } (identity by default)
 * @param {function} [deps.fetchImpl]   fetch (global by default)
 * @param {function} [deps.log]         one line when the fallback is taken or refused
 * @param {object} [deps.trace]         filled in place: served, budgetMs, internalMs, internalError, externalMs, externalError, fallback
 * @param {function} [deps.now]         a clock, for the tests
 * @returns {Promise<Response>}
 */
async function fetchWithInternalFallback(targetUrl, options = {}, deps = {}) {
  const {
    budgetMs,
    translate = identityTranslate,
    fetchImpl = globalThis.fetch,
    log = () => {},
    trace = null,
    now = Date.now,
  } = deps;
  if (!(Number.isFinite(budgetMs) && budgetMs > 0)) {
    throw new TypeError("fetchWithInternalFallback: budgetMs (a positive number of milliseconds) is required");
  }
  if (options && options.signal) {
    throw new TypeError("fetchWithInternalFallback: pass budgetMs, not a signal — each attempt gets its own (F-163)");
  }

  const { url: internalUrl, headers: internalHeaders } = translate(targetUrl);
  const hasFallback = internalUrl !== targetUrl;
  const t = trace || {};
  t.budgetMs = budgetMs;
  t.served = null;
  t.internalMs = null;
  t.internalError = null;
  t.externalMs = null;
  t.externalError = null;
  t.fallback = hasFallback ? "not-needed" : "none";

  const t0 = now();
  try {
    const res = await fetchImpl(internalUrl, {
      ...options,
      headers: { ...((options && options.headers) || {}), ...(internalHeaders || {}) },
      signal: attemptSignal(budgetMs),
    });
    t.internalMs = now() - t0;
    t.served = hasFallback ? "internal" : "direct";
    return res;
  } catch (err) {
    t.internalMs = now() - t0;
    t.internalError = errorText(err);
    if (!hasFallback) throw err;
    if (isTimeout(err)) {
      // The model's time, not the path's: a second attempt would spend it again.
      t.fallback = "not-taken-timeout";
      log(
        `Internal k8s URL ${internalUrl} timed out after ${t.internalMs} ms of the ${budgetMs} ms budget. ` +
          `No fallback to ${targetUrl}: a timeout is the call's own cost, not the path's (F-163 / F-164)`
      );
      throw err;
    }
    t.fallback = "taken";
    log(
      `Internal k8s URL ${internalUrl} unreachable (${t.internalError}) after ${t.internalMs} ms. ` +
        `Falling back to external URL ${targetUrl} with its own ${budgetMs} ms budget`
    );
    const t1 = now();
    try {
      const res = await fetchImpl(targetUrl, { ...options, signal: attemptSignal(budgetMs) });
      t.externalMs = now() - t1;
      t.served = "external";
      return res;
    } catch (err2) {
      t.externalMs = now() - t1;
      t.externalError = errorText(err2);
      throw err2;
    }
  }
}

module.exports = { fetchWithInternalFallback, isTimeout };
