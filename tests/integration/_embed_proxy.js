/**
 * A local HTTP proxy for the integration suites — ticket T07.
 *
 * Forwards every request to `upstream` until `passCount` requests have been
 * served, then answers 503 for the rest: a mid-file embedder outage on demand
 * (the ticket's "kill-mid-ingest (abort embed endpoint)"). `passCount: -1`
 * never fails on count; `failWhen(req)` refuses a request by shape instead —
 * pointed at Weaviate with `req.method === "DELETE"`, it turns a supersede
 * refusal into a live case. A pass-through has one side effect worth
 * knowing: the ingest route sees a non-Ollama embed host and takes its
 * CPU-served batch shape (16 chunks per batch, one batch in flight), which
 * makes "cancel lands mid-file" reproducible rather than a race (F-68).
 *
 * In-process (no spawn): the app and the test run in the same container, so
 * 127.0.0.1 is reachable from the route. Every header except hop-by-hop ones
 * is forwarded (the app's `x-auth-token`, `authorization`) and none is logged.
 * Each request record carries `at` (received) and `done` (answered), so a
 * test can show a request straddled a cancel. `delayMs` holds every request
 * numbered `delayFrom` or later for that long before forwarding it — the
 * way to make "the cancel lands while the LAST batch is in flight"
 * deterministic for a small document (a two-chunk final batch otherwise
 * finishes before a poll can see it).
 *
 * T16: `rewriteModel: { from, to }` rewrites the JSON body's `model` field
 * from one name to another before forwarding — "a differently NAMED embedder
 * in the same vector space", which no real embedder in this deployment can
 * be (Ollama serves exactly one embedding model and no alias): the app names
 * `from`, Ollama is asked for `to`, and the same-dimension vectors come back
 * under a name the collection was not built with. It is the only live
 * witness the same-dim / different-name leg can have (design D14). Each
 * request record carries `modelSeen` and `forwardedAs`.
 */

const http = require("http");

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "proxy-connection"]);

async function startEmbedProxy({ upstream, passCount = -1, failWhen = null, delayMs = 0, delayFrom = 1, port = 0, rewriteModel = null } = {}) {
  if (!upstream) throw new Error("startEmbedProxy: upstream is required");
  const base = String(upstream).replace(/\/+$/, "").replace(/\/v1$/, "");
  const requests = [];
  let served = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      let body = Buffer.concat(chunks);
      const n = ++served;
      let inputs = null;
      let modelSeen = null;
      let forwardedAs = null;
      try {
        const j = JSON.parse(body.toString("utf8"));
        inputs = Array.isArray(j.input) ? j.input.length : typeof j.input === "string" ? 1 : null;
        if (typeof j.model === "string") {
          modelSeen = j.model;
          forwardedAs = j.model;
          if (rewriteModel && j.model === rewriteModel.from) {
            j.model = rewriteModel.to;
            forwardedAs = rewriteModel.to;
            body = Buffer.from(JSON.stringify(j), "utf8");
          }
        }
      } catch {
        /* not JSON — forwarded as-is */
      }
      const rec = { n, at: new Date().toISOString(), method: req.method, path: req.url, inputs, modelSeen, forwardedAs, action: null, status: null, done: null };
      requests.push(rec);
      const refuse = (reason) => {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `proxy: ${reason}` }));
        rec.action = "fail";
        rec.status = 503;
        rec.done = new Date().toISOString();
      };
      if (passCount >= 0 && n > passCount) return refuse(`simulated embedder outage on request ${n} (passCount ${passCount})`);
      if (typeof failWhen === "function" && failWhen(req)) return refuse(`simulated refusal of ${req.method} ${req.url}`);
      if (delayMs > 0 && n >= delayFrom) {
        rec.delayedMs = delayMs;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
        const up = await fetch(`${base}${req.url}`, { method: req.method, headers, body: body.length ? body : undefined, signal: AbortSignal.timeout(180000) });
        const text = await up.text();
        res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" });
        res.end(text);
        rec.action = "forward";
        rec.status = up.status;
      } catch (err) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `proxy upstream failure: ${err.message}` }));
        rec.action = "upstream-error";
        rec.status = 502;
        rec.error = err.message;
      }
      rec.done = new Date().toISOString();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const actualPort = server.address().port;
  return {
    url: `http://127.0.0.1:${actualPort}/v1`,
    origin: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    requests,
    stop: () =>
      new Promise((resolve) => {
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

module.exports = { startEmbedProxy };
