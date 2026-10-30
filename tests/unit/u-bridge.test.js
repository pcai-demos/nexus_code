/**
 * U-BRIDGE — how the bridge extension holds its port (session 88 fix).
 *
 * Measured on the pod 2026-10-06 (inputs/demo-design/evidence/session-88-bridge-check/findings.md): when another IDE
 * window's extension host still held 127.0.0.1:9100, the old startServer() restarted twice per failure (the
 * EADDRINUSE handler and the close handler), the attempts doubled every 3 s, and the IDE container's 4 GiB limit
 * killed the visible window's extension host three times in four minutes.
 *
 * These cases run the REAL code-server-ext/nexcode-bridge/extension.js (a stub stands in for the `vscode` module) as
 * separately loaded module instances, i.e. separate extension hosts, on a free local port with short intervals.
 * NEXCODE_BRIDGE_PORT / _RETRY_MS / _STANDBY_MS are the extension's test seams; the chart sets none of them. The token
 * below is a synthetic test value, a secret for no system.
 */
const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const net = require("net");
const path = require("path");
const Module = require("module");

const EXT = path.join(__dirname, "..", "..", "code-server-ext", "nexcode-bridge", "extension.js");
const TOKEN = "u-bridge-synthetic-token";
const RETRY_MS = 40;
const STANDBY_MS = 400; // ten times the quick retry after a yield (min(250, RETRY_MS) = 40 ms)

// Every server the extension instances create is counted (they share this process's http module).
let created = 0;
const realCreateServer = http.createServer;
http.createServer = function countedCreateServer(...args) {
  created += 1;
  return realCreateServer.apply(this, args);
};

// The extension requires "vscode"; only the status bar is touched on these paths.
const vscodeStub = {
  window: {
    createStatusBarItem: () => ({ text: "", tooltip: "", show() {}, dispose() {} }),
    activeTextEditor: undefined,
    tabGroups: { all: [] },
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  commands: { executeCommand: async () => undefined },
};
const realLoad = Module._load;
Module._load = function loadWithVscodeStub(request, ...rest) {
  if (request === "vscode") return vscodeStub;
  return realLoad.call(this, request, ...rest);
};

const hosts = [];
/** Load a fresh instance of the extension (one extension host) and activate it on `port`. */
function startHost(port) {
  process.env.NEXCODE_BRIDGE_TOKEN = TOKEN;
  process.env.NEXCODE_BRIDGE_PORT = String(port);
  process.env.NEXCODE_BRIDGE_RETRY_MS = String(RETRY_MS);
  process.env.NEXCODE_BRIDGE_STANDBY_MS = String(STANDBY_MS);
  delete require.cache[require.resolve(EXT)];
  const ext = require(EXT);
  const host = {
    stopped: false,
    stop() {
      if (!this.stopped) {
        this.stopped = true;
        ext.deactivate();
      }
    },
  };
  hosts.push(host);
  ext.activate({ subscriptions: [] });
  return host;
}
after(() => {
  for (const h of hosts) h.stop();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function call(port, method, urlPath, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", (e) => resolve({ status: 0, code: e.code }));
    req.end();
  });
}

/** The instance id of the extension host that answers /api/health on `port`, or null. */
async function holder(port) {
  const r = await call(port, "GET", "/api/health", { "X-NexCODE-Bridge": TOKEN });
  if (r.status !== 200) return null;
  try {
    return JSON.parse(r.body).instance || null;
  } catch {
    return null;
  }
}

async function waitFor(fn, ms, step = 15) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

describe("U-BRIDGE: the bridge extension's port handling (session 88)", () => {
  test("a host that cannot bind keeps ONE retry chain (the old code doubled the attempts every interval), binds once the port is free, and stops when deactivated", async () => {
    const port = await freePort();
    // A holder that cannot yield (404 to everything), like a host that predates the handover.
    const foreign = realCreateServer((req, res) => {
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => foreign.listen(port, "127.0.0.1", resolve));

    const before = created;
    const h = startHost(port);
    await sleep(RETRY_MS * 25);
    const attempts = created - before;
    assert.ok(attempts >= 2 && attempts <= 2 * 25 + 5, `one chain: ${attempts} attempts in about 25 retry intervals`);

    await new Promise((resolve) => {
      foreign.close(resolve);
      foreign.closeAllConnections();
    });
    assert.ok(await waitFor(() => holder(port), 2000), "the host binds the port once it is free");

    h.stop();
    const stoppedAt = created;
    await sleep(RETRY_MS * 10);
    assert.strictEqual(created, stoppedAt, "no attempt after deactivate()");
    assert.strictEqual((await call(port, "GET", "/api/health", { "X-NexCODE-Bridge": TOKEN })).status, 0, "nothing listens after deactivate()");
  });

  test("a newer host takes the port at once; the older one stands by, does not take it back while the newer one holds it, and rebinds when the newer one leaves", async () => {
    const port = await freePort();
    const a = startHost(port);
    const idA = await waitFor(() => holder(port), 2000);
    assert.ok(idA, "the first host holds the port");

    const t0 = Date.now();
    const b = startHost(port);
    const idB = await waitFor(async () => {
      const id = await holder(port);
      return id && id !== idA ? id : null;
    }, 2000, 10);
    const tookMs = Date.now() - t0;
    assert.ok(idB, "the newer host holds the port");
    assert.ok(tookMs < 1500, `taken over in ${tookMs} ms`);

    const before = created;
    for (let i = 0; i < 6; i += 1) {
      await sleep(STANDBY_MS / 2);
      assert.strictEqual(await holder(port), idB, "the newer host keeps the port");
    }
    const standbyAttempts = created - before;
    assert.ok(standbyAttempts <= 6, `the standby host retries slowly: ${standbyAttempts} attempts in about three standby intervals`);

    b.stop();
    assert.ok(await waitFor(async () => (await holder(port)) === idA, STANDBY_MS * 6), "the standby host rebinds once the holder leaves");
    a.stop();
  });

  test("POST /api/yield is behind the header gate: without the header, or with a wrong one, the holder keeps the port", async () => {
    const port = await freePort();
    const a = startHost(port);
    const idA = await waitFor(() => holder(port), 2000);
    assert.ok(idA, "the host holds the port");
    assert.strictEqual((await call(port, "POST", "/api/yield")).status, 401);
    assert.strictEqual((await call(port, "POST", "/api/yield", { "X-NexCODE-Bridge": "wrong" })).status, 401);
    await sleep(RETRY_MS * 5);
    assert.strictEqual(await holder(port), idA, "the holder still holds the port");
    a.stop();
  });
});

describe("U-BRIDGE: the allow-listed command route (Machinery PR 1, design §6)", () => {
  test("POST /api/command: behind the header gate; an id the table does not hold is refused; a table command runs", async () => {
    const port = await freePort();
    const a = startHost(port);
    assert.ok(await waitFor(() => holder(port), 2000), "the host holds the port");
    const post = (body, headers) =>
      new Promise((resolve) => {
        const data = JSON.stringify(body);
        const req = http.request({ host: "127.0.0.1", port, path: "/api/command", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers }, agent: false }, (res) => {
          let b = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
        });
        req.on("error", (e) => resolve({ status: 0, code: e.code }));
        req.end(data);
      });
    const auth = { "X-NexCODE-Bridge": TOKEN };
    assert.strictEqual((await post({ id: "close-editors" }, {})).status, 401, "no header");
    const unknown = await post({ id: "rm-rf" }, auth);
    assert.strictEqual(unknown.status, 400);
    assert.match(unknown.body.error, /not an allow-listed command: rm-rf/);
    const proto = await post({ id: "constructor" }, auth);
    assert.strictEqual(proto.status, 400, "an inherited property name is not a command");
    const ok = await post({ id: "close-editors" }, auth);
    assert.deepStrictEqual([ok.status, ok.body.success, ok.body.command], [200, true, "close-editors"]);
    a.stop();
  });
});
