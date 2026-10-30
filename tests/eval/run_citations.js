/**
 * Citation-validity eval runner — ticket T14 (evaluation-plan §5's end-to-end
 * metric, null in every snapshot until now).
 *
 * Drives /api/chat (doc mode, temperature 0) over the scoped golden queries
 * PLUS a committed citation-eliciting set, and judges every page the answer
 * cites against the pages actually retrieved for that turn. The judge is
 * src/lib/rag/citations.js — the SAME module the orchestrator uses, so the
 * measurement cannot disagree with the product about what a claim is.
 *
 * Run BOTH legs with this one instrument (F-29):
 *   before leg — against main's deployed prompt, BEFORE any src/ edit syncs;
 *                answers carry prose page claims only (no [S#] markers exist).
 *   after leg  — same env, same queries, after the pod verifiably serves the
 *                treatment; answers additionally carry [S#] markers, returned
 *                as response.citations / response.uncitedClaims.
 * citationValidityRate = supported claims / all claims under one definition in
 * both legs — marker terms are simply zero in the before leg.
 *
 * Environment (mirrors run.js / run_eval.sh; per-endpoint tokens, F-22):
 *   RAG_EVAL_APP_URL, RAG_EVAL_WEAVIATE_URL, RAG_EVAL_COLLECTION (RAGEval_*),
 *   RAG_EVAL_SOURCES (REQUIRED here — an unscoped citation run would score
 *   queries whose documents were never ingested, F-29),
 *   RAG_EVAL_EMBED_URL, RAG_EVAL_EMBED_MODEL (identity, never defaulted),
 *   RAG_EVAL_SCHEMA_VERSION ("1" | "2" — the class SHAPE, identity, never
 *   defaulted; sent as ragSettings.schemaVersion so both the retrieval and the
 *   orchestrator's summary resolve the same class; cut-over design D12),
 *   RAG_EVAL_RERANK_URL, RAG_EVAL_RERANK_MODEL, RAG_EVAL_TOKEN,
 *   RAG_EVAL_WEAVIATE_TOKEN, RAG_EVAL_RERANK_TOKEN,
 *   RAG_EVAL_CHAT_URL, RAG_EVAL_CHAT_MODEL (the generation identity — record
 *   it; legs are comparable only on the same model), RAG_EVAL_CHAT_TOKEN
 *   (placeholder "1234567890" for Ollama), RAG_EVAL_LEG ("before"|"after").
 *
 * Usage:  node tests/eval/run_citations.js --out /tmp/citations-<leg>.json
 *         [--spot-check]   re-runs the first 3 scored queries once more and
 *                          reports page-claim agreement (stability evidence).
 *
 * Per-query exclusions (X6 discipline — excluded and COUNTED, never hidden):
 *   retrieval.state "failed"/"skipped" → excluded (infrastructure, not
 *   fabrication); "empty" and "degraded" stay in — an answer citing pages when
 *   nothing was retrieved is exactly the fabrication this metric exists for.
 *
 * F-11 anti-whitewash: pages contributed ONLY by manifest-declared
 * synthetic-pagination sources (fileType docx — docling leaves
 * document.pages unpopulated and the bridge stamps page 1; X4/F-11) are
 * removed from the judgment reference set, and claims/citations touching them
 * are counted separately as synthetic*, excluded from numerator AND
 * denominator. The current 4-PDF corpus has none; the machinery is pinned by
 * U-CITE fixtures so a future .docx corpus cannot score "p.1" as valid.
 */

const fs = require("fs");
const path = require("path");

const { findPageClaims, judgePageClaims } = require("../../src/lib/rag/citations.js");

const MANIFEST_PATH = path.join(__dirname, "..", "manifests", "golden.json");
const QUERIES_PATH = path.join(__dirname, "queries.json");

/** Manifest fileTypes whose page attribution is a synthesized single page (F-11/X4). */
const SYNTHETIC_PAGINATION_FILETYPES = new Set(["docx"]);

/**
 * The committed citation-eliciting set (approved design, ask #1). The golden
 * queries were written for retrieval and rarely provoke page claims (verified
 * in the T14 design probe: bare anchors yield answers with ~0 claims), so the
 * rate over them alone would be vacuous. These explicitly request page
 * citations — the doc_log_01 failure shape (E32). Identical in both legs.
 * E6 is the fabrication-tempting absence case: it DEMANDS a page for content
 * the corpus does not contain.
 */
const ELICITING_QUERIES = [
  {
    id: "e001",
    style: "elicit",
    query:
      "/doc List the key specifications of the Hesketh 4-bedroom home. For each specification, cite the exact page number of the document it appears on.",
  },
  {
    id: "e002",
    style: "elicit",
    query:
      "/doc Summarise the main sections of the SSX125 manual, citing the page number where each section begins.",
  },
  {
    id: "e003",
    style: "elicit",
    query:
      "/doc Summarise Graeme Hick's cricketing career, citing the page number for each fact you state.",
  },
  {
    id: "e004",
    style: "elicit",
    query:
      "/doc What house designs appear on the Saxon Fields site plan? Cite the page number where each design's floor plan appears.",
  },
  {
    id: "e005",
    style: "elicit",
    query:
      "/doc Describe the Saxon Fields development layout, citing the page number for every detail you mention.",
  },
  {
    id: "e006",
    style: "elicit-absence",
    query:
      "/doc Which page of the documentation discusses the ZORBLATTIUM_9 coupling assembly? Cite the exact page number and quote the relevant passage.",
  },
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Mirrors run.js scopeFilter exactly; here an unset scope is an error (F-29). */
function scopeFilter(queries) {
  const raw = (process.env.RAG_EVAL_SOURCES || "").trim();
  if (!raw) {
    throw new Error(
      "[citation eval guard] RAG_EVAL_SOURCES is required: an unscoped run scores queries " +
        "whose documents were never ingested and the rate becomes actively misleading (F-29)."
    );
  }
  const allowed = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  const kept = queries.filter((q) => {
    if ((q.relevant || []).length === 0) return true; // absence probes always apply
    return q.relevant.every((rel) => allowed.has(rel.source));
  });
  return {
    queries: kept,
    scope: {
      sources: [...allowed].sort(),
      queriesIncluded: kept.length,
      queriesExcluded: queries.length - kept.length,
      note: "A comparison run must use the same RAG_EVAL_SOURCES to be meaningful.",
    },
  };
}

function serviceConfig() {
  const required = {
    RAG_EVAL_WEAVIATE_URL: process.env.RAG_EVAL_WEAVIATE_URL,
    RAG_EVAL_EMBED_URL: process.env.RAG_EVAL_EMBED_URL,
    RAG_EVAL_EMBED_MODEL: process.env.RAG_EVAL_EMBED_MODEL,
    RAG_EVAL_COLLECTION: process.env.RAG_EVAL_COLLECTION,
    RAG_EVAL_SCHEMA_VERSION: process.env.RAG_EVAL_SCHEMA_VERSION,
    RAG_EVAL_CHAT_URL: process.env.RAG_EVAL_CHAT_URL,
    RAG_EVAL_CHAT_MODEL: process.env.RAG_EVAL_CHAT_MODEL,
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`[citation eval] missing env: ${missing.join(", ")}`);
  if (required.RAG_EVAL_SCHEMA_VERSION !== "1" && required.RAG_EVAL_SCHEMA_VERSION !== "2") {
    throw new Error(`[eval guard] RAG_EVAL_SCHEMA_VERSION="${required.RAG_EVAL_SCHEMA_VERSION}" is not "1" or "2".`);
  }
  const schemaVersion = Number(required.RAG_EVAL_SCHEMA_VERSION);
  if (!/^RAGEval_[A-Za-z0-9_]+$/.test(required.RAG_EVAL_COLLECTION)) {
    throw new Error(
      `[eval guard] RAG_EVAL_COLLECTION="${required.RAG_EVAL_COLLECTION}" is not a disposable RAGEval_* collection.`
    );
  }
  const token = process.env.RAG_EVAL_TOKEN || "";
  return {
    appUrl: process.env.RAG_EVAL_APP_URL || "http://127.0.0.1:3000",
    weaviateUrl: required.RAG_EVAL_WEAVIATE_URL,
    collection: required.RAG_EVAL_COLLECTION,
    schemaVersion,
    collectionClass: schemaVersion === 2 ? `${required.RAG_EVAL_COLLECTION}V2` : required.RAG_EVAL_COLLECTION,
    embedUrl: required.RAG_EVAL_EMBED_URL,
    embedModel: required.RAG_EVAL_EMBED_MODEL,
    rerankUrl: process.env.RAG_EVAL_RERANK_URL || "",
    rerankModel: process.env.RAG_EVAL_RERANK_MODEL || "",
    chatUrl: required.RAG_EVAL_CHAT_URL,
    chatModel: required.RAG_EVAL_CHAT_MODEL,
    chatToken: process.env.RAG_EVAL_CHAT_TOKEN || "1234567890",
    token,
    weaviateToken: process.env.RAG_EVAL_WEAVIATE_TOKEN || token,
    rerankToken: process.env.RAG_EVAL_RERANK_TOKEN || token,
    leg: process.env.RAG_EVAL_LEG || "unlabelled",
  };
}

/** The I-FAILMODE adminConfig shape — the payload a real browser sends. */
function adminConfig(config) {
  return {
    nimEndpoint: config.chatUrl,
    nimApiKey: config.chatToken,
    nimModelName: config.chatModel,
    systemPrompt: "You are a helpful assistant.",
    temperature: 0,
    maxTokens: 2048,
    weaviateUrl: config.weaviateUrl,
    weaviateCollection: config.collection,
    mlisToken: config.weaviateToken,
    embedApiKey: config.chatToken,
    embedEndpoint: config.embedUrl,
    embedModelName: config.embedModel,
    rerankEndpointUrl: config.rerankUrl,
    rerankModelName: config.rerankModel,
    rerankApiKey: config.rerankToken,
    ragSettings: { weaviateCollection: config.collection, schemaVersion: config.schemaVersion },
    forcedCommand: "/doc",
  };
}

async function chat(config, message) {
  const res = await fetch(`${config.appUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history: [], adminConfig: adminConfig(config) }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`/api/chat ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * Warm the pipeline so leg-to-leg differences are not cold starts (F-17):
 * one direct model call (isTestQuery bypasses the orchestrator) and one
 * throwaway retrieve to load the embed model and wake the CPU-served reranker
 * (its first call timed out in the design probe).
 */
async function warmUp(config) {
  // A silently failed warm-up leaves the CPU-served reranker cold (the exact
  // first-call timeout the design probe observed) — so HTTP status is checked
  // and logged, and the retrieve warm-up retries once on a non-OK response.
  try {
    const res = await fetch(`${config.appUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "warm-up: reply with one word", isTestQuery: true, adminConfig: adminConfig(config) }),
      signal: AbortSignal.timeout(240000),
    });
    console.log(`[warm-up] chat: HTTP ${res.status}`);
  } catch (e) {
    console.error(`[warm-up] chat: ${e.message}`);
  }
  const retrieveOnce = () =>
    fetch(`${config.appUrl}/api/rag/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "warm-up",
        weaviateUrl: config.weaviateUrl,
        weaviateCollection: config.collection,
        schemaVersion: config.schemaVersion,
        token: config.weaviateToken,
        weaviateToken: config.weaviateToken,
        rerankToken: config.rerankToken,
        embedUrl: config.embedUrl,
        embedModel: config.embedModel,
        rerankUrl: config.rerankUrl,
        rerankModel: config.rerankModel,
      }),
      signal: AbortSignal.timeout(240000),
    });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await retrieveOnce();
      console.log(`[warm-up] retrieve attempt ${attempt}: HTTP ${res.status}`);
      if (res.ok) break;
    } catch (e) {
      console.error(`[warm-up] retrieve attempt ${attempt}: ${e.message}`);
    }
  }
}

async function residency() {
  try {
    const url = (process.env.RAG_EVAL_OLLAMA_URL || "http://ollama.ollama.svc.cluster.local:11434") + "/api/ps";
    const ps = await fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
    return (ps?.models || []).map((m) => m.name);
  } catch (e) {
    return { error: e.message };
  }
}

function syntheticSources(manifest) {
  const synth = new Set();
  for (const entry of manifest.corpus || []) {
    // T34: the manifest's own `paginated` flag decides; the file-type list is the pre-T34 reading for an entry without it.
    if (typeof entry.paginated === "boolean" ? entry.paginated === false : SYNTHETIC_PAGINATION_FILETYPES.has(entry.fileType)) synth.add(entry.fileName);
  }
  return synth;
}

/**
 * Score one answered turn. Excluded turns (infrastructure, not fabrication —
 * X6 discipline: excluded and counted, never hidden):
 *   - retrieval failed/skipped/undefined: nothing was searched;
 *   - success !== true: no answer was generated (the T12 error string
 *     contains no claims and must not count as an honestly claim-free turn);
 *   - no rag_pipeline trace evidence: the reference pages are unattributable
 *     (F-24 — judging claims against an empty set would read a bookkeeping
 *     gap as fabrication).
 */
function scoreTurn({ data, synthSources }) {
  const state = data?.retrieval?.state;
  if (state === "failed" || state === "skipped" || state === undefined) {
    return { excluded: true, reason: `retrieval.state=${state}` };
  }
  if (data.success !== true) {
    return { excluded: true, reason: "generation failed (success !== true)" };
  }

  const ragTrace = (data.traces || []).find((t) => t.category === "rag_pipeline");
  if (!ragTrace || !Array.isArray(ragTrace?.details?.retrievedChunks)) {
    return { excluded: true, reason: "no retrieval evidence in trace (rag_pipeline details missing)" };
  }
  const chunks = ragTrace.details.retrievedChunks;

  // Reference pages for judgment, minus pages contributed ONLY by
  // synthetic-pagination sources (F-11: a stored "page 1" is not a location).
  const realPages = new Set();
  const synthOnlyPages = new Set();
  for (const c of chunks) {
    if (synthSources.has(c.source)) synthOnlyPages.add(c.page);
    else realPages.add(c.page);
  }
  // T28: on a complete document read the model was SHOWN every page of the
  // document (the response's documentScope.pagesRead, measured from the
  // rows read) — those pages are reference pages too; companions add no page
  // (they share their anchor's). The pre-T28 reference set is unchanged on
  // every other turn.
  const scope = data && data.documentScope;
  // T15 (design D5; A9): with a SET a turn may read one document whole while
  // another is left unread — `coverage` is then "partial" but `pagesRead`
  // (the union over the documents read whole) is still what the model saw.
  if (scope && Array.isArray(scope.pagesRead) && scope.pagesRead.length > 0 && scope.document && !synthSources.has(scope.document.source)) {
    for (const p of scope.pagesRead) if (Number.isInteger(p) && p > 0) realPages.add(p);
  }
  for (const p of realPages) synthOnlyPages.delete(p);

  const answer = data.response || "";
  const claims = findPageClaims(answer);
  const syntheticPageClaims = claims.filter((c) => synthOnlyPages.has(c.page));
  const judgeable = claims.filter((c) => !synthOnlyPages.has(c.page));
  const { supported, fabricated } = judgePageClaims(judgeable, [...realPages]);

  // Marker citations exist only after the treatment; the server resolves them
  // (same module) and returns them on the response. A citation to a
  // synthetic-pagination source counts separately — classified by the
  // MANIFEST (the instrument's ground truth) as well as by the server's
  // pageAttribution (durable since T07: the ledger records `paginated` per
  // file, so a restart no longer reads "unknown"). T34: how many of those
  // carry a section anchor is the ticket's citation metric.
  const serverCitations = Array.isArray(data.citations) ? data.citations : [];
  const syntheticCitations = serverCitations.filter(
    (c) => c.pageAttribution === "singlePage" || synthSources.has(c.source)
  );
  const validCitations = serverCitations.filter((c) => !syntheticCitations.includes(c));
  const serverUncited = Array.isArray(data.uncitedClaims) ? data.uncitedClaims : [];
  // Our own stable format, pinned by U-CITE — invalid markers are fabrications.
  const invalidMarkerCount = serverUncited.filter((s) => /^cited context block \[S\d+\] does not exist/.test(s)).length;

  return {
    excluded: false,
    retrievalState: state,
    chunkCount: data.retrieval?.chunkCount ?? chunks.length,
    referencePages: [...realPages].sort((a, b) => a - b),
    documentScope: scope ? { method: scope.method, coverage: scope.coverage, document: scope.document && scope.document.source, pagesRead: scope.pagesRead ?? null } : null,
    answer,
    pageClaims: claims,
    supportedClaimCount: supported.length,
    fabricatedClaims: fabricated,
    syntheticPageClaimCount: syntheticPageClaims.length,
    serverCitations,
    serverUncitedClaims: serverUncited,
    validCitationCount: validCitations.length,
    invalidMarkerCount,
    syntheticCitationCount: syntheticCitations.length,
    syntheticCitationWithAnchorCount: syntheticCitations.filter((c) => typeof c.sectionPath === "string" && c.sectionPath.trim()).length,
    validInstances: supported.length + validCitations.length,
    totalInstances: supported.length + fabricated.length + validCitations.length + invalidMarkerCount,
  };
}

/**
 * Three rates, because one number cannot serve both jobs (review finding):
 *
 *   pageClaimValidityRate — PROSE page claims only. Its definition contains
 *     no marker term, so it is computed identically in both legs — this is
 *     the before/after no-degradation pair.
 *   markerResolutionRate  — [S#] references that resolve to a real block.
 *     Null in the before leg (no markers exist); the treatment's own health.
 *   citationValidityRate  — the headline §5 gate (≥0.95): every citing act
 *     (prose claim or marker reference) that is valid. Marker citations are
 *     valid by construction, so this rate is NOT comparable across legs —
 *     compare pageClaimValidityRate instead; the gate is absolute.
 */
function aggregate(perQuery) {
  const scored = perQuery.filter((q) => q.score && !q.score.excluded);
  const sum = (f) => scored.reduce((n, q) => n + f(q.score), 0);
  const valid = sum((s) => s.validInstances);
  const total = sum((s) => s.totalInstances);
  const supportedClaims = sum((s) => s.supportedClaimCount);
  const fabricatedClaims = sum((s) => s.fabricatedClaims.length);
  const validMarkers = sum((s) => s.validCitationCount);
  const invalidMarkers = sum((s) => s.invalidMarkerCount);
  const rate = (num, den) => (den > 0 ? num / den : null);
  return {
    citationValidityRate: rate(valid, total),
    pageClaimValidityRate: rate(supportedClaims, supportedClaims + fabricatedClaims),
    markerResolutionRate: rate(validMarkers, validMarkers + invalidMarkers),
    citedInstances: total,
    validInstances: valid,
    fabricatedPageClaims: fabricatedClaims,
    invalidMarkers,
    syntheticPageClaims: sum((s) => s.syntheticPageClaimCount),
    syntheticCitations: sum((s) => s.syntheticCitationCount),
    // T34 (design D8): a citation to an unpaginated source that names its section — the anchor the ticket adds.
    syntheticCitationsWithAnchor: sum((s) => s.syntheticCitationWithAnchorCount),
    queriesScored: scored.length,
    queriesExcluded: perQuery.length - scored.length,
  };
}

async function main() {
  const outFlag = process.argv.indexOf("--out");
  const outPath = outFlag !== -1 ? process.argv[outFlag + 1] : null;
  if (!outPath) throw new Error("--out <path> is required (fresh path — F-24).");
  if (fs.existsSync(outPath)) {
    throw new Error(`[F-24 guard] output path already exists: ${outPath} — a stale artifact must never read as a completed run.`);
  }
  const spotCheck = process.argv.includes("--spot-check");

  const config = serviceConfig();
  const manifest = loadJson(MANIFEST_PATH);
  const synthSources = syntheticSources(manifest);
  const querySet = loadJson(QUERIES_PATH);
  const { queries: goldenQueries, scope } = scopeFilter(querySet.queries);

  const runQueries = [
    ...goldenQueries.map((q) => ({ id: q.id, style: q.style, set: "natural", message: `/doc ${q.query}` })),
    ...ELICITING_QUERIES.map((q) => ({ id: q.id, style: q.style, set: "elicited", message: q.query })),
  ];

  console.log(`Leg "${config.leg}": ${goldenQueries.length} scoped golden + ${ELICITING_QUERIES.length} eliciting queries, chat=${config.chatModel}`);

  const residentAtT0 = await residency();
  console.log(`Resident models at t0: ${JSON.stringify(residentAtT0)}`);
  await warmUp(config);
  console.log("Warm-up complete.");

  const perQuery = [];
  for (const q of runQueries) {
    const started = Date.now();
    let record = { id: q.id, style: q.style, set: q.set };
    try {
      const data = await chat(config, q.message);
      record.durationMs = Date.now() - started;
      record.score = scoreTurn({ data, synthSources });
    } catch (e) {
      record.durationMs = Date.now() - started;
      record.score = { excluded: true, reason: `request failed: ${e.message}` };
    }
    const s = record.score;
    console.log(
      `  ${q.id} [${q.set}] ${s.excluded ? `EXCLUDED (${s.reason})` : `state=${s.retrievalState} claims=${s.pageClaims.length} fabricated=${s.fabricatedClaims.length} citations=${s.serverCitations.length}`}`
    );
    perQuery.push(record);
  }

  let stability = null;
  if (spotCheck) {
    stability = [];
    // Elicited queries only: the naturals carry ~0 page claims (that is why
    // the eliciting set exists), so their claim sets agree trivially and
    // prove nothing about stability (review finding).
    const candidates = runQueries.filter(
      (x) => x.set === "elicited" && perQuery.find((p) => p.id === x.id && p.score && !p.score.excluded)
    );
    for (const q of candidates.slice(0, 3)) {
      try {
        const data = await chat(config, q.message);
        const rerun = scoreTurn({ data, synthSources });
        if (rerun.excluded) {
          stability.push({ id: q.id, skipped: `rerun excluded: ${rerun.reason}` });
          console.log(`  spot-check ${q.id}: SKIPPED (${rerun.reason})`);
          continue;
        }
        const first = perQuery.find((p) => p.id === q.id).score;
        const key = (s) => JSON.stringify({ c: s.pageClaims.map((c) => c.page).sort(), f: s.fabricatedClaims.map((c) => c.page).sort() });
        stability.push({ id: q.id, claimSetIdentical: key(first) === key(rerun), firstClaims: first.pageClaims.length, rerunClaims: rerun.pageClaims.length });
        console.log(`  spot-check ${q.id}: claim sets ${stability.at(-1).claimSetIdentical ? "identical" : "DIFFER"}`);
      } catch (e) {
        // A transient rerun failure must never cost the completed leg.
        stability.push({ id: q.id, skipped: `rerun failed: ${e.message}` });
        console.log(`  spot-check ${q.id}: SKIPPED (${e.message})`);
      }
    }
  }

  const snapshot = {
    capturedAt: new Date().toISOString(),
    leg: config.leg,
    scope,
    runConfig: {
      appUrl: config.appUrl,
      collection: config.collection,
      collectionSchemaVersion: config.schemaVersion,
      collectionClass: config.collectionClass,
      chatUrl: config.chatUrl,
      chatModel: config.chatModel,
      embedUrl: config.embedUrl,
      embedModel: config.embedModel,
      rerankUrl: config.rerankUrl,
      rerankModel: config.rerankModel,
      temperature: 0,
      maxTokens: 2048,
      elicitingQueryIds: ELICITING_QUERIES.map((q) => q.id),
      syntheticPaginationSources: [...synthSources].sort(),
    },
    residentModelsAtT0: residentAtT0,
    metrics: {
      overall: aggregate(perQuery),
      natural: aggregate(perQuery.filter((q) => q.set === "natural")),
      elicited: aggregate(perQuery.filter((q) => q.set === "elicited")),
    },
    stabilitySpotCheck: stability,
    perQuery,
  };

  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  const o = snapshot.metrics.overall;
  const show = (v) => (v === null ? "n/a" : v.toFixed(4));
  console.log(`\ncitationValidityRate (overall, §5 gate): ${show(o.citationValidityRate)}`);
  console.log(`pageClaimValidityRate (leg-comparable):  ${show(o.pageClaimValidityRate)}`);
  console.log(`markerResolutionRate (after-leg only):   ${show(o.markerResolutionRate)}`);
  console.log(`  instances: ${o.validInstances}/${o.citedInstances} valid; fabricated claims: ${o.fabricatedPageClaims}; invalid markers: ${o.invalidMarkers}`);
  console.log(`  excluded queries: ${o.queriesExcluded}`);
  console.log(`SNAPSHOT -> ${outPath}`);
}

// The metric machinery is exported for U-CITE-METRIC's unit pins; the leg
// only runs when this file is the entrypoint (a bare require must never fire
// network calls or the --out guard).
module.exports = { scoreTurn, aggregate, syntheticSources, scopeFilter, ELICITING_QUERIES };

if (require.main === module) {
  main().catch((e) => {
    console.error(`CITATION EVAL FAILED: ${e.message}`);
    process.exit(1);
  });
}
