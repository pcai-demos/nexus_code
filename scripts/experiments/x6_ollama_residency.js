#!/usr/bin/env node
/**
 * X6 — model residency vs. ingest determinism.
 *
 * Protocol: inputs/rag-audit/evaluation-plan.md §6, "X6 — detailed protocol".
 * Hypotheses: H-EVICT (VRAM-pressure eviction) | H-EXPIRE (keep_alive expiry)
 *             | H-NULL (sampling stands; T24 correct as written).
 *
 * Polls Ollama /api/ps across N identical VLM-heavy ingests and records, per run,
 * the chunk count and the docling trace (picturesCaptured vs vlmCaptionsGenerated).
 * Joining residency changes to caption shortfalls is what discriminates the three.
 *
 * MUST run inside the pod: it needs in-cluster DNS for Ollama/Weaviate and
 * localhost:3000 for the app.
 *
 *   kubectl cp scripts/experiments/x6_ollama_residency.js \
 *     nexus-nexcode/$POD:/tmp/x6.js -c nexcode
 *   kubectl exec -n nexus-nexcode $POD -c nexcode -- sh -c "cd /usr/src/app && \
 *     X6_TOKEN=... node /tmp/x6.js"
 *
 * Env:
 *   X6_TOKEN          Weaviate auth (x-auth-token). Never logged.
 *   X6_WEAVIATE_URL   default http://weaviate.hpe-weaviate.svc.cluster.local:80
 *   X6_OLLAMA_URL     default http://ollama.ollama.svc.cluster.local:11434
 *   X6_EMBED_URL      default $X6_OLLAMA_URL/v1
 *   X6_EMBED_MODEL    default qwen3-embedding:8b   (4096-dim — matches collections)
 *   X6_VLM_MODEL      default qwen3-vl:30b
 *   X6_APP_URL        default http://127.0.0.1:3000
 *   X6_RUNS           default 3
 *   X6_GAP_SECONDS    default 400   (> the 5 min default keep_alive)
 *   X6_POLL_MS        default 2000
 *   X6_FILES          comma-separated; default is the two VLM-heavy corpus files
 *   X6_OUT            default /tmp/x6
 *   X6_SMOKE=1        1 run, 1 file, no gap — validates plumbing before the real run
 *
 * Safety: never targets RAGChunk (guard below mirrors tests/eval/run.js:149);
 * one ingest in flight at a time; tokens are never printed.
 */

const fs = require("fs");
const path = require("path");

const env = (n, d) => (process.env[n] === undefined || process.env[n] === "" ? d : process.env[n]);
const SMOKE = env("X6_SMOKE", "") === "1";

const OLLAMA = env("X6_OLLAMA_URL", "http://ollama.ollama.svc.cluster.local:11434").replace(/\/+$/, "");
const CFG = {
  weaviateUrl: env("X6_WEAVIATE_URL", "http://weaviate.hpe-weaviate.svc.cluster.local:80").replace(/\/+$/, ""),
  ollamaUrl: OLLAMA,
  embedUrl: env("X6_EMBED_URL", `${OLLAMA}/v1`),
  embedModel: env("X6_EMBED_MODEL", "qwen3-embedding:8b"),
  vlmModel: env("X6_VLM_MODEL", "qwen3-vl:30b"),
  appUrl: env("X6_APP_URL", "http://127.0.0.1:3000").replace(/\/+$/, ""),
  token: env("X6_TOKEN", ""),
  runs: SMOKE ? 1 : Number(env("X6_RUNS", "3")),
  gapSeconds: SMOKE ? 0 : Number(env("X6_GAP_SECONDS", "400")),
  pollMs: Number(env("X6_POLL_MS", "2000")),
  outDir: env("X6_OUT", "/tmp/x6")
};

const DEFAULT_FILES = [
  // 0-character text layer (F-1): chunks are ENTIRELY VLM-derived, so a caption
  // failure moves the chunk count directly, with no text floor to mask it.
  "demos/demo_files/ext_reg_docs/Barratt_Homes-SaxonFields.pdf",
  // 40 pages, ~10.7k chars: diagram-heavy, mixed text+VLM.
  "demos/demo_files/ext_reg_docs/Ikea-wardrobe_build.pdf"
];
const FILES = env("X6_FILES", "").trim()
  ? env("X6_FILES", "").split(",").map(s => s.trim()).filter(Boolean)
  : (SMOKE ? DEFAULT_FILES.slice(0, 1) : DEFAULT_FILES);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(`[x6 ${nowIso()}]`, ...a);

// ── Ollama residency ────────────────────────────────────────────────────────

async function residency() {
  try {
    const res = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = await res.json();
    return {
      ok: true,
      models: (j.models || []).map(m => ({
        name: m.name || m.model,
        sizeVram: m.size_vram ?? null,
        expiresAt: m.expires_at ?? null
      }))
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Classify what changed between two residency samples.
 * An unload BEFORE expires_at, coincident with another model loading, is an
 * eviction (H-EVICT). An unload AT/AFTER expires_at is expiry (H-EXPIRE).
 * This is the primary discrimination and must not be skipped.
 */
function classifyTransition(prev, curr, tIso) {
  if (!prev?.ok || !curr?.ok) return [];
  const before = new Map(prev.models.map(m => [m.name, m]));
  const after = new Map(curr.models.map(m => [m.name, m]));
  const loaded = [...after.keys()].filter(n => !before.has(n));
  const unloaded = [...before.keys()].filter(n => !after.has(n));
  const events = [];
  const t = Date.parse(tIso);

  for (const name of unloaded) {
    const m = before.get(name);
    const exp = m.expiresAt ? Date.parse(m.expiresAt) : null;
    // 10s tolerance for poll granularity.
    const pastExpiry = exp !== null && !Number.isNaN(exp) && t >= exp - 10000;
    events.push({
      t: tIso,
      kind: pastExpiry ? "expiry" : (loaded.length ? "eviction" : "unload_unexplained"),
      model: name,
      expiresAt: m.expiresAt,
      coincidentLoads: loaded
    });
  }
  for (const name of loaded) {
    events.push({ t: tIso, kind: "load", model: name, coincidentUnloads: unloaded });
  }
  return events;
}

// ── Weaviate ────────────────────────────────────────────────────────────────

const wHeaders = () => {
  const h = { "Content-Type": "application/json" };
  if (CFG.token) h["x-auth-token"] = CFG.token;
  return h;
};

async function chunkCount(collection) {
  try {
    const res = await fetch(`${CFG.weaviateUrl}/v1/graphql`, {
      method: "POST",
      headers: wHeaders(),
      body: JSON.stringify({ query: `{Aggregate{${collection}{meta{count}}}}` }),
      signal: AbortSignal.timeout(30000)
    });
    const j = await res.json();
    return j?.data?.Aggregate?.[collection]?.[0]?.meta?.count ?? null;
  } catch (e) {
    return null;
  }
}

async function dropCollection(collection) {
  if (!/^RAGEval_[A-Za-z0-9_]+$/.test(collection)) throw new Error("guard: refusing to drop " + collection);
  try {
    const r = await fetch(`${CFG.weaviateUrl}/v1/schema/${collection}`, { method: "DELETE", headers: wHeaders() });
    return r.status;
  } catch (e) {
    return `ERR ${e.message}`;
  }
}

// ── App ingest ──────────────────────────────────────────────────────────────

async function startIngest(collection) {
  const body = {
    filePaths: FILES,
    weaviateUrl: CFG.weaviateUrl,
    weaviateToken: CFG.token,
    token: CFG.token,
    embedUrl: CFG.embedUrl,
    embedModel: CFG.embedModel,
    weaviateCollection: collection,
    ragSettings: {
      weaviateCollection: collection,
      vlmEndpointUrl: CFG.ollamaUrl,
      vlmModelName: CFG.vlmModel
    }
  };
  const res = await fetch(`${CFG.appUrl}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  return { status: res.status, body: await res.text().then(t => t.slice(0, 300)) };
}

/**
 * Concurrent retrieval load, fired DURING an ingest.
 *
 * Why this exists: the smoke run showed an ingest loads exactly two Ollama
 * models (embed + VLM) against a ceiling of three, so ingest alone can never
 * evict — three runs of it would report "no evictions" whether or not H-EVICT
 * is true. F-14's four-model scenario needs a query in flight at the same time.
 *
 * X6_QUERY_BACKEND=ollama points embed+rerank at Ollama (4-model demand, the
 * arm that CAN evict). Default "mlis" reproduces the shipped configuration,
 * which per the census demands only 2 from Ollama.
 */
async function queryLoad(collection, stopRef, timelineStream, runIdx) {
  const backend = env("X6_QUERY_BACKEND", "mlis");
  const ollamaQuery = backend === "ollama";
  const queries = [
    "what are the plot numbers and house types",
    "assembly steps for the wardrobe frame",
    "what safety warnings are listed"
  ];
  let i = 0, issued = 0, failed = 0;
  while (!stopRef.stop) {
    const q = queries[i++ % queries.length];
    const body = {
      query: q,
      weaviateUrl: CFG.weaviateUrl,
      weaviateToken: CFG.token,
      token: CFG.token,
      weaviateCollection: collection,
      searchStrategy: "hybrid",
      candidatesToRerank: 10,
      keepTopNAfterRerank: 8,
      ...(ollamaQuery
        ? {
            embedUrl: CFG.embedUrl,
            embedModel: CFG.embedModel,
            rerankUrl: CFG.ollamaUrl,
            rerankModel: env("X6_OLLAMA_RERANK_MODEL", "dengcao/Qwen3-Reranker-8B:Q3_K_M"),
            rerankEnabled: true
          }
        : { embedUrl: CFG.embedUrl, embedModel: CFG.embedModel, rerankEnabled: true })
    };
    try {
      const res = await fetch(`${CFG.appUrl}/api/rag/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000)
      });
      issued++;
      if (!res.ok) failed++;
      timelineStream.write(JSON.stringify({
        t: nowIso(), run: runIdx, phase: "query", backend, q, status: res.status
      }) + "\n");
    } catch (e) {
      issued++; failed++;
      timelineStream.write(JSON.stringify({
        t: nowIso(), run: runIdx, phase: "query", backend, q, error: e.message.slice(0, 120)
      }) + "\n");
    }
    await sleep(Number(env("X6_QUERY_INTERVAL_MS", "8000")));
  }
  return { issued, failed, backend };
}

/** /api/ingest/status is SSE: read one event, then abort. */
async function ingestState() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const res = await fetch(`${CFG.appUrl}/api/ingest/status`, { signal: ac.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const i = buf.indexOf("\n\n");
      if (i !== -1) {
        const line = buf.slice(0, i).trim();
        if (line.startsWith("data:")) {
          ac.abort();
          return JSON.parse(line.slice(5).trim());
        }
        buf = buf.slice(i + 2);
      }
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── One run ─────────────────────────────────────────────────────────────────

/**
 * Wait for global ingest idle BEFORE starting a run.
 *
 * ingestionState is a module singleton (audit E15) with no per-request identity:
 * POST /api/ingest returns 202 with no job id, and /api/ingest/status reports one
 * global object that ANY concurrent ingest mutates. Without this barrier a run
 * reads a foreign job's completion as its own — observed 2026-08-13: run 1
 * reported chunksIndexed=80/filesCompleted=2 while its own collection held 0, and
 * run 2 collected FOUR docling traces for a two-file ingest (two jobs writing to
 * the same array) with filesCompleted=3.
 */
async function waitForIdle(label, maxMs = 15 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  let waited = 0;
  while (Date.now() < deadline) {
    const st = await ingestState();
    if (!st || st.status !== "processing") {
      if (waited) log(`${label}: global ingest idle after ${Math.round(waited / 1000)}s`);
      return true;
    }
    if (!waited) log(`${label}: another ingest is in flight (file=${st.currentFile}) — waiting for idle`);
    await sleep(5000);
    waited += 5000;
  }
  log(`${label}: WARNING — still busy after ${Math.round(maxMs / 1000)}s; run will be marked contaminated`);
  return false;
}

async function doRun(runIdx, collection, timelineStream) {
  log(`run ${runIdx}: collection=${collection} files=${FILES.length}`);
  const startedIdle = await waitForIdle(`run ${runIdx}`);

  const t0 = await residency();
  log(`run ${runIdx}: t0 residency = ${t0.ok ? (t0.models.length ? t0.models.map(m => m.name).join(", ") : "NONE (all cold)") : "ERR " + t0.error}`);

  let prev = t0;
  const events = [];
  let polling = true;
  let peakResident = t0.ok ? t0.models.length : 0;
  const poller = (async () => {
    while (polling) {
      const t = nowIso();
      const r = await residency();
      if (r.ok) peakResident = Math.max(peakResident, r.models.length);
      timelineStream.write(JSON.stringify({ t, run: runIdx, phase: "poll", residency: r }) + "\n");
      for (const ev of classifyTransition(prev, r, t)) {
        ev.residentAfter = r.ok ? r.models.length : null;
        events.push(ev);
        timelineStream.write(JSON.stringify({ t, run: runIdx, phase: "event", ...ev }) + "\n");
        log(`run ${runIdx}: ${ev.kind.toUpperCase()} ${ev.model} (resident=${ev.residentAfter})${ev.coincidentLoads?.length ? " loads: " + ev.coincidentLoads.join(",") : ""}`);
      }
      if (r.ok) prev = r;
      await sleep(CFG.pollMs);
    }
  })();

  await sleep(3000); // baseline samples before load
  const started = nowIso();
  const kick = await startIngest(collection);
  log(`run ${runIdx}: POST /api/ingest -> ${kick.status}`);
  if (kick.status >= 400) {
    polling = false; await poller;
    return { runIdx, collection, error: `ingest start failed: ${kick.status} ${kick.body}`, events };
  }

  // Concurrent query load — without this the run cannot reach the 4-model demand
  // H-EVICT requires (see queryLoad's comment).
  const stopRef = { stop: false };
  let queryTask = null;
  if (env("X6_CONCURRENT", "1") === "1") {
    log(`run ${runIdx}: concurrent query load ON (backend=${env("X6_QUERY_BACKEND", "mlis")})`);
    queryTask = queryLoad(collection, stopRef, timelineStream, runIdx);
  }

  // Wait for completion. Cap generously: VLM captioning on an image-only PDF is slow.
  const capMs = Number(env("X6_TIMEOUT_MS", String(30 * 60 * 1000)));
  const deadline = Date.now() + capMs;
  let last = null, done = false;
  while (Date.now() < deadline) {
    await sleep(4000);
    const st = await ingestState();
    if (!st) continue;
    last = st;
    if (st.status && st.status !== "processing") { done = true; break; }
  }

  stopRef.stop = true;
  const queryStats = queryTask ? await queryTask : null;
  await sleep(5000); // trailing samples
  polling = false;
  await poller;

  const finished = nowIso();
  const count = await chunkCount(collection);
  const traces = (last?.doclingTraces || []).map(tr => ({
    fileName: tr.fileName,
    pageCount: tr.pageCount,
    picturesCaptured: tr.picturesCaptured,
    vlmCaptionsGenerated: tr.vlmCaptionsGenerated,
    // NOTE: shortfall = failures + genuine [DECORATIVE_ELEMENT] replies.
    // generateImageCaption returns null for BOTH (vlm_captioner.js:64-75), so this
    // number alone cannot discriminate. The pod log lines
    // "[VLM Captioner Error…]" / "[VLM Captioner Exception…]" do — capture them
    // alongside this run and join on timestamp.
    captionShortfall: (tr.picturesCaptured ?? 0) - (tr.vlmCaptionsGenerated ?? 0),
    usedDocling: tr.usedDocling,
    reasonIfFallback: tr.reasonIfFallback
  }));

  // Contamination checks. A run polluted by a concurrent ingest looks "successful"
  // -- no error, done=true -- so usability must be judged on self-consistency
  // between what the run asked for, what the state reported, and what actually
  // landed in this run's own uniquely-named collection.
  const contamination = [];
  if (!startedIdle) contamination.push("another ingest was in flight at start");
  if (count === 0) contamination.push("own collection is empty");
  if (traces.length !== FILES.length) {
    contamination.push(`trace count ${traces.length} != files requested ${FILES.length} (concurrent job wrote into the shared state array)`);
  }
  if (last?.filesCompleted != null && last.filesCompleted !== FILES.length) {
    contamination.push(`filesCompleted ${last.filesCompleted} != ${FILES.length}`);
  }
  if (count !== null && last?.chunksIndexed != null && Math.abs(count - last.chunksIndexed) > 2) {
    contamination.push(`collection count ${count} disagrees with reported chunksIndexed ${last.chunksIndexed}`);
  }

  const summary = {
    runIdx, collection, started, finished, done,
    startedIdle,
    contamination,
    usable: contamination.length === 0,
    peakResident,
    queryLoad: queryStats,
    status: last?.status ?? null,
    error: last?.error ?? null,
    chunksInCollection: count,
    chunksIndexedReported: last?.chunksIndexed ?? null,
    filesCompleted: last?.filesCompleted ?? null,
    t0Residency: t0,
    traces,
    events,
    evictions: events.filter(e => e.kind === "eviction").length,
    expiries: events.filter(e => e.kind === "expiry").length,
    unexplained: events.filter(e => e.kind === "unload_unexplained").length
  };
  log(`run ${runIdx}: done=${done} chunks=${count} evictions=${summary.evictions} expiries=${summary.expiries} usable=${summary.usable}${contamination.length ? " [" + contamination.join("; ") + "]" : ""}`);
  return summary;
}

// ── Report ──────────────────────────────────────────────────────────────────

function report(runs) {
  // `!error && done` is NOT sufficient: a run contaminated by a concurrent ingest
  // has no error and a done flag set by reading a FOREIGN job's completion.
  // Judged on self-consistency instead (see doRun's contamination checks).
  const ok = runs.filter(r => !r.error && r.done && r.usable);
  const excludedDetail = runs
    .filter(r => !(!r.error && r.done && r.usable))
    .map(r => ({ run: r.runIdx, reasons: r.error ? [r.error] : (r.contamination || ["not done"]) }));
  const counts = [...new Set(ok.map(r => r.chunksInCollection))];
  const drift = counts.length > 1;
  const anyEvict = ok.some(r => r.evictions > 0);
  const anyExpiry = ok.some(r => r.expiries > 0);
  const shortfall = ok.some(r => r.traces.some(t => t.captionShortfall > 0));

  // Peak concurrent Ollama residency observed. This is the census that decides
  // whether H-EVICT is even reachable: Ollama's ceiling is 3, and the shipped
  // default config demands only 2 (ingest = embed + VLM; retrieval and chat are
  // MLIS-served). Eviction is a property of a CONFIGURATION, not of the system.
  let peakResident = 0;
  for (const r of ok) {
    for (const e of r.events || []) {
      if (e.kind === "load") peakResident = Math.max(peakResident, (e.residentAfter ?? 0));
    }
    peakResident = Math.max(peakResident, r.peakResident ?? 0);
  }

  let verdict, action;
  // A drift verdict needs at least two usable runs -- with one run, "no drift" is
  // true by construction and means nothing.
  if (ok.length < 2) {
    return {
      generatedAt: nowIso(),
      runsAttempted: runs.length,
      runsUsable: ok.length,
      runsExcluded: runs.length - ok.length,
      excludedDetail,
      chunkCounts: ok.map(r => ({ run: r.runIdx, chunks: r.chunksInCollection })),
      peakOllamaResident: peakResident,
      verdict: "insufficient runs",
      action: `Only ${ok.length} usable run(s). A drift verdict requires >= 2. Re-run with X6_RUNS >= 2, or investigate why runs were excluded.`,
      config: { ...CFG, token: CFG.token ? "<set>" : "<empty>" },
      files: FILES
    };
  }

  if (drift && anyEvict && shortfall) {
    verdict = "H-EVICT supported";
    action = "Rescope T24: seeding/temperature does not address the cause. Reduce concurrent model demand or pin residency.";
  } else if (anyExpiry && !anyEvict) {
    verdict = "H-EXPIRE supported";
    action = "Cheaper fix: keep_alive tuning / pre-warm before ingest. T24's determinism scope survives but is not the main cause.";
  } else if (drift && !anyEvict && !anyExpiry) {
    verdict = "H-NULL — sampling stands";
    action = "T24 is correctly scoped as written. Proceed.";
  } else if (!drift) {
    verdict = "non-reproduction";
    action = "Chunk counts identical across runs. Do NOT retire FM-N2 — it was observed once under different load. Record the load conditions that failed to reproduce it.";
  } else {
    verdict = "inconclusive";
    action = "Mixed signals — see per-run events before concluding.";
  }

  return {
    generatedAt: nowIso(),
    runsAttempted: runs.length,
    runsUsable: ok.length,
    runsExcluded: runs.length - ok.length,
    excludedDetail,
    chunkCounts: ok.map(r => ({ run: r.runIdx, chunks: r.chunksInCollection })),
    chunkCountDrift: drift,
    peakOllamaResident: peakResident,
    evictionReachable: peakResident >= 3,
    evictionsTotal: ok.reduce((a, r) => a + r.evictions, 0),
    expiriesTotal: ok.reduce((a, r) => a + r.expiries, 0),
    unexplainedTotal: ok.reduce((a, r) => a + r.unexplained, 0),
    captionShortfallObserved: shortfall,
    verdict,
    action,
    caveat: "captionShortfall conflates VLM failures with genuine [DECORATIVE_ELEMENT] replies; confirm against pod logs before concluding.",
    config: { ...CFG, token: CFG.token ? "<set>" : "<empty>" },
    files: FILES
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  fs.mkdirSync(CFG.outDir, { recursive: true });
  const stamp = Number(env("X6_STAMP", "0")) || Number(process.hrtime.bigint() / 1000000n % 1000000000n);
  const timelinePath = path.join(CFG.outDir, "timeline.jsonl");
  const stream = fs.createWriteStream(timelinePath, { flags: "a" });

  log(`X6 start — runs=${CFG.runs} gap=${CFG.gapSeconds}s poll=${CFG.pollMs}ms smoke=${SMOKE}`);
  log(`files: ${FILES.join(", ")}`);
  if (!CFG.token) log("WARNING: X6_TOKEN empty — Weaviate calls will likely 401.");

  const tags = await fetch(`${OLLAMA}/api/tags`).then(r => r.json()).catch(() => null);
  log(`ollama installed models: ${tags ? (tags.models || []).length : "unreachable"}`);

  const runs = [];
  for (let i = 1; i <= CFG.runs; i++) {
    const collection = `RAGEval_x6_${stamp}_r${i}`;
    if (!/^RAGEval_[A-Za-z0-9_]+$/.test(collection)) throw new Error("guard: bad collection " + collection);
    let summary;
    try {
      summary = await doRun(i, collection, stream);
    } catch (e) {
      summary = { runIdx: i, collection, error: e.message, events: [] };
      log(`run ${i}: FAILED ${e.message}`);
    }
    runs.push(summary);
    fs.writeFileSync(path.join(CFG.outDir, "runs.json"), JSON.stringify(runs, null, 2));

    if (i < CFG.runs && CFG.gapSeconds > 0) {
      log(`gap ${CFG.gapSeconds}s (> keep_alive) so the next run starts comparably cold...`);
      const gapEnd = Date.now() + CFG.gapSeconds * 1000;
      while (Date.now() < gapEnd) {
        const r = await residency();
        stream.write(JSON.stringify({ t: nowIso(), run: `gap${i}`, phase: "poll", residency: r }) + "\n");
        await sleep(10000);
      }
    }
  }

  const rep = report(runs);
  fs.writeFileSync(path.join(CFG.outDir, "report.json"), JSON.stringify(rep, null, 2));
  stream.end();

  console.log("\n════════ X6 REPORT ════════");
  console.log(`runs usable : ${rep.runsUsable}/${rep.runsAttempted} (excluded ${rep.runsExcluded})`);
  for (const x of (rep.excludedDetail || [])) console.log(`  excluded run ${x.run}: ${x.reasons.join("; ")}`);
  console.log(`chunk counts: ${JSON.stringify(rep.chunkCounts)}  drift=${rep.chunkCountDrift}`);
  console.log(`evictions=${rep.evictionsTotal} expiries=${rep.expiriesTotal} unexplained=${rep.unexplainedTotal}`);
  console.log(`caption shortfall observed: ${rep.captionShortfallObserved}`);
  console.log(`VERDICT: ${rep.verdict}`);
  console.log(`ACTION : ${rep.action}`);
  console.log(`\nartifacts: ${timelinePath}, ${path.join(CFG.outDir, "runs.json")}, ${path.join(CFG.outDir, "report.json")}`);

  if (env("X6_KEEP_COLLECTIONS", "") !== "1") {
    for (const r of runs) {
      const st = await dropCollection(r.collection);
      log(`dropped ${r.collection} -> ${st}`);
    }
  }
})().catch(e => {
  console.error("[x6] fatal:", e.message);
  process.exit(1);
});
