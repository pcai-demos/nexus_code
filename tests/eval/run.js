#!/usr/bin/env node
/**
 * Retrieval-quality eval harness (evaluation-plan §5) — audit ticket T00.
 *
 * Produces the baseline snapshot that later tickets are gated against. Ticket
 * T00 exists precisely so that "this change improved retrieval" is falsifiable:
 * without a committed pre-fix baseline, every later claim is unverifiable.
 *
 * Every query's expected (source, page) pairs come from tests/manifests/golden.json,
 * where they were recorded only when both production PDF extractors agreed. The
 * harness refuses to run if the query set has drifted from the manifest.
 *
 * Live services are required to produce real numbers:
 *   RAG_EVAL_WEAVIATE_URL, RAG_EVAL_EMBED_URL, RAG_EVAL_COLLECTION (RAGEval_*),
 *   RAG_EVAL_EMBED_MODEL (identity, never defaulted — must be the model that
 *   built the collection; see F-12),
 *   RAG_EVAL_SCHEMA_VERSION ("1" | "2" — identity too, never defaulted:
 *   the class SHAPE the run reads. Sent as `schemaVersion` on every request
 *   and recorded in the provenance. Since the cut-over the server defaults
 *   to 2, so a run that named a v1 class without stating its version would
 *   read an absent `V2` sibling and score an empty store; design D12.)
 * When they are absent the harness writes a "services unavailable" stub instead,
 * recording exactly what was attempted and why. T00's acceptance criteria
 * explicitly permit the stub; it must be replaced by a real in-cluster run
 * before any ticket claims a retrieval improvement.
 *
 * Usage:
 *   node tests/eval/run.js                       # write/refresh the baseline
 *   node tests/eval/run.js --out <path>          # write elsewhere (per-ticket runs)
 *   node tests/eval/run.js --compare <baseline>  # compare without overwriting
 */

const fs = require("fs");
const path = require("path");

const metrics = require("./lib/metrics");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "tests", "manifests", "golden.json");
const QUERIES_PATH = path.join(__dirname, "queries.json");
const DEFAULT_BASELINE = path.join(__dirname, "baselines", "baseline-pre-fix.json");

// Pinned so a baseline is reproducible: any change here invalidates comparison,
// which is why the resolved values are written into every snapshot.
//
// A few are env-tunable because the reranker in this environment is CPU-served
// and therefore slow: bounding the candidate pool keeps a run tractable without
// editing (and thus silently changing) the pinned defaults. Any override is
// recorded in the snapshot, and a comparison run must use the same values.
const num = (name, fallback) =>
  process.env[name] === undefined ? fallback : Number(process.env[name]);

// Env-only knobs: undefined when the env var is unset, in which case the key is
// omitted from the request entirely (JSON.stringify drops undefined) and the
// server's shipped config contract resolves it. Ticket T08 exists because those
// server-side semantics are what the metric must measure: a harness that pins
// minRerankScore:0 into every request would hold absenceProbesReturningNothing
// at 0.00 no matter what the application ships.
const envOnly = (name) =>
  process.env[name] === undefined ? undefined : Number(process.env[name]);

const RUN_CONFIG = {
  searchStrategy: process.env.RAG_EVAL_STRATEGY || "hybrid",
  hybridAlpha: num("RAG_EVAL_ALPHA", 0.5),
  similarityThreshold: envOnly("RAG_EVAL_THRESHOLD"),
  limit: num("RAG_EVAL_LIMIT", 20),
  candidatesToRerank: num("RAG_EVAL_CANDIDATES", 20),
  keepTopNAfterRerank: num("RAG_EVAL_KEEP_TOP_N", 8),
  minRerankScore: envOnly("RAG_EVAL_MIN_RERANK"),
  rerankEnabled: process.env.RAG_EVAL_RERANK !== "0",
  temperature: 0,
  recallK: num("RAG_EVAL_RECALL_K", 20),
  mrrK: num("RAG_EVAL_MRR_K", 10),
};

// What the snapshot records for the env-only knobs: an unset knob is a real,
// reportable state ("the server default applied"), not a missing field.
/**
 * T17 (design §7 item 2): the DEMO-SHAPE leg. Every leg before T17 sent no
 * `ragSettings` blob, so the resolver's defaults were what the metric
 * measured — while the admin panel sends a blob on every chat turn, and the
 * blob's `minRerankScore: 0.0` switched the calibrated floor off (F-83).
 * RAG_EVAL_RAG_SETTINGS = "page" sends the panel's own blob as `ragSettings`
 * on every retrieve, beside the stated identity fields: evaluated from the
 * deployed page.js's `DEFAULT_RAG_SETTINGS` literal when the file has one
 * (main before T17), else from the module's `RAG_SETTINGS_DEFAULTS` (after
 * T17 — a fresh browser's blob). A file path sends that JSON. Unset: no
 * blob, exactly as before. Top-level RUN_CONFIG keys still win at the
 * resolver (per-key precedence, T08), so the blob only decides what the
 * harness leaves unset — which is the point.
 */
function demoRagSettings() {
  const raw = process.env.RAG_EVAL_RAG_SETTINGS;
  if (!raw) return { blob: undefined, source: null };
  if (raw === "page") {
    const pageFile = path.join(REPO_ROOT, "src", "app", "page.js");
    const pageSrc = fs.readFileSync(pageFile, "utf-8");
    const literal = pageSrc.match(/const DEFAULT_RAG_SETTINGS = (\{[\s\S]*?\n\});/);
    if (literal) {
      // eslint-disable-next-line no-new-func
      const blob = new Function(`return ${literal[1]}`)();
      return { blob, source: "src/app/page.js DEFAULT_RAG_SETTINGS literal" };
    }
    const cfg = require(path.join(REPO_ROOT, "src", "lib", "rag", "config.js"));
    if (!cfg.RAG_SETTINGS_DEFAULTS || typeof cfg.RAG_SETTINGS_DEFAULTS !== "object") {
      throw new Error(
        "[eval guard] RAG_EVAL_RAG_SETTINGS=page: page.js has no DEFAULT_RAG_SETTINGS literal " +
          "and src/lib/rag/config.js exports no RAG_SETTINGS_DEFAULTS — nothing to send as the demo's blob."
      );
    }
    return {
      blob: JSON.parse(JSON.stringify(cfg.RAG_SETTINGS_DEFAULTS)),
      source: "src/lib/rag/config.js RAG_SETTINGS_DEFAULTS",
    };
  }
  const file = path.resolve(raw);
  return { blob: JSON.parse(fs.readFileSync(file, "utf-8")), source: file };
}
const DEMO_RAG_SETTINGS = demoRagSettings();

const RUN_CONFIG_RECORD = {
  ...RUN_CONFIG,
  similarityThreshold: RUN_CONFIG.similarityThreshold ?? "(server default)",
  minRerankScore: RUN_CONFIG.minRerankScore ?? "(server default)",
  // T17: what blob (if any) rode on every retrieve, and where it came from.
  ragSettings: DEMO_RAG_SETTINGS.blob
    ? { source: DEMO_RAG_SETTINGS.source, keys: Object.keys(DEMO_RAG_SETTINGS.blob).length, blob: DEMO_RAG_SETTINGS.blob }
    : "(none — the resolver's defaults)",
};

function parseArgs(argv) {
  const args = { out: DEFAULT_BASELINE, compare: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = path.resolve(argv[++i]);
    else if (argv[i] === "--compare") args.compare = path.resolve(argv[++i]);
  }
  return args;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * Fail loudly if the query set references ground truth the manifest no longer
 * supports. Silent drift here would produce a baseline that measures nothing.
 */
function assertQueriesMatchManifest(queries, manifest) {
  const byFileName = new Map();
  for (const entry of manifest.corpus) {
    if (entry.skipped) continue;
    byFileName.set(entry.fileName, entry);
  }

  const problems = [];
  for (const query of queries) {
    for (const rel of query.relevant || []) {
      const entry = byFileName.get(rel.source);
      if (!entry) {
        problems.push(`${query.id}: unknown source "${rel.source}"`);
        continue;
      }
      for (const page of rel.pages) {
        const known = (entry.anchors || []).some((a) => a.page === page);
        if (!known) {
          problems.push(
            `${query.id}: page ${page} of ${rel.source} is not a manifest anchor page`
          );
        }
      }
      // T38: a section named by the query must be a heading the manifest's independent engine placed an anchor under.
      for (const section of Array.isArray(rel.sections) ? rel.sections : []) {
        const known = (entry.anchors || []).some((a) => Array.isArray(a.headings) && a.headings.some((h) => metrics.normaliseSection(h) === metrics.normaliseSection(section)));
        if (!known) problems.push(`${query.id}: section "${section}" of ${rel.source} is not a manifest anchor heading`);
      }
    }
  }
  if (problems.length) {
    throw new Error(
      "Eval query set has drifted from the golden manifest:\n  " +
        problems.join("\n  ") +
        "\nRegenerate the manifest (scripts/derive_golden_manifest.py) or update queries.json."
    );
  }
}

/**
 * Optional scoping: RAG_EVAL_SOURCES is a comma-separated list of corpus file
 * names that are actually indexed in the target collection.
 *
 * Ingesting the full 442-page corpus runs VLM captioning over every rendered
 * page, so a first baseline is often captured over a subset. Scoring queries
 * whose documents were never indexed would record zeros that look like
 * retrieval failures, making the baseline actively misleading — so queries
 * outside the scope are excluded, and the scope is recorded in the snapshot.
 * A later run must use the same scope to be comparable.
 */
function scopeFilter(queries) {
  const raw = (process.env.RAG_EVAL_SOURCES || "").trim();
  if (!raw) return { queries, scope: null };

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
      note:
        "Baseline scoped to the documents actually indexed in the target collection. " +
        "A comparison run must use the same RAG_EVAL_SOURCES to be meaningful.",
    },
  };
}

function serviceConfig() {
  const weaviateUrl = process.env.RAG_EVAL_WEAVIATE_URL;
  const embedUrl = process.env.RAG_EVAL_EMBED_URL;
  const collection = process.env.RAG_EVAL_COLLECTION;
  // The embedding model is identity, not tuning: it decides which vector space
  // the query lands in, so it is never defaulted. The old default here named a
  // 2560-dim model while the corpus collections are built 4096-dim, which is
  // exactly the incident that invalidated the first T00 baseline (see F-12).
  const embedModel = process.env.RAG_EVAL_EMBED_MODEL;
  // The class shape is identity as well (cut-over, design D12): the run must
  // say which shape it measured, and a run that named a v1 class without a
  // version would, under the server's v2 default, read an absent `V2` class.
  const schemaVersionRaw = process.env.RAG_EVAL_SCHEMA_VERSION;
  if (!weaviateUrl || !embedUrl || !collection || !embedModel || !schemaVersionRaw) return null;
  if (schemaVersionRaw !== "1" && schemaVersionRaw !== "2") {
    throw new Error(`[eval guard] RAG_EVAL_SCHEMA_VERSION="${schemaVersionRaw}" is not "1" or "2".`);
  }
  const schemaVersion = Number(schemaVersionRaw);
  if (!/^RAGEval_[A-Za-z0-9_]+$/.test(collection)) {
    throw new Error(
      `[eval guard] RAG_EVAL_COLLECTION="${collection}" is not a disposable RAGEval_* collection.`
    );
  }
  // Each hop can authenticate differently — the embedding service, the vector
  // store and the reranker are separate deployments with separate credentials.
  // A single shared token silently 403s on whichever service it does not belong
  // to, and a 403 on retrieval is swallowed upstream (audit E30), so it would
  // surface as "no results" rather than an auth error.
  const token = process.env.RAG_EVAL_TOKEN || "";
  return {
    weaviateUrl,
    embedUrl,
    collection,
    embedModel,
    schemaVersion,
    // The class the server resolves from (collection, schemaVersion) — the
    // suffix rule of src/lib/rag/config.js collectionNameForVersion, stated
    // here so the snapshot names the class that was actually read.
    collectionClass: schemaVersion === 2 ? `${collection}V2` : collection,
    rerankUrl: process.env.RAG_EVAL_RERANK_URL || "",
    rerankModel: process.env.RAG_EVAL_RERANK_MODEL || "",
    token,
    weaviateToken: process.env.RAG_EVAL_WEAVIATE_TOKEN || token,
    rerankToken: process.env.RAG_EVAL_RERANK_TOKEN || token,
    appUrl: process.env.RAG_EVAL_APP_URL || "http://127.0.0.1:3000",
  };
}

async function retrieve(config, query) {
  const res = await fetch(`${config.appUrl}/api/rag/retrieve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      weaviateUrl: config.weaviateUrl,
      weaviateCollection: config.collection,
      schemaVersion: config.schemaVersion,
      token: config.token,
      weaviateToken: config.weaviateToken,
      rerankToken: config.rerankToken,
      embedUrl: config.embedUrl,
      embedModel: config.embedModel,
      rerankUrl: config.rerankUrl,
      rerankModel: config.rerankModel,
      // T17: the demo-shape leg's blob (undefined → the key is dropped).
      ragSettings: DEMO_RAG_SETTINGS.blob,
      ...RUN_CONFIG,
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`retrieve failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  if (!body.success) throw new Error(`retrieve returned success:false — ${body.error}`);
  // T10: the response's report and degradations are part of the measurement,
  // not decoration. Score hygiene now has to distinguish "never scored" from
  // "fabricated" (T13's scoreStats.allEqual is the fabrication signature), and
  // per-query degradation codes make a reranker flap attributable instead of a
  // mystery — the T14 spot-check lesson, where one query's context pool changed
  // between runs because the CPU-served reranker flapped.
  return {
    results: body.results || [],
    report: body.report || null,
    degraded: Array.isArray(body.degraded) ? body.degraded : [],
  };
}

async function runLive(config, queries, paginationFacts = null) {
  const perQuery = [];
  const recalls = [];
  const recallsTopN = [];
  const rrs = [];
  const taus = [];
  const tausRaw = [];
  const hygienes = [];
  const neverScoreds = [];
  let collapseCollapsed = 0;
  let collapseTotal = 0;
  let absenceClean = 0;
  let absenceTotal = 0;

  for (const query of queries) {
    // Two identical runs: rank stability is a first-class metric because the
    // reranker's failure mode (audit E20) shows up as run-to-run reordering.
    const first = await retrieve(config, query.query);
    const second = await retrieve(config, query.query);
    const firstRows = first.results;

    // T40 (design D10; F-130): the GATED τ tolerates ties within TAU_TIE_EPSILON of rerank score — the reranker's
    // fourth-decimal drift between blocks of time swapped two chaff rows 0.002 apart and read a leg red on a ticket
    // that changed no retrieval. The raw τ — the pre-T40 definition, byte for byte — is recorded beside it, never gated.
    const tauRaw = metrics.kendallTau(
      firstRows.map(metrics.resultKey),
      second.results.map(metrics.resultKey)
    );
    const tau = metrics.kendallTauTolerant(firstRows, second.results, { epsilon: metrics.TAU_TIE_EPSILON, facts: paginationFacts });
    if (tau !== null) taus.push(tau);
    if (tauRaw !== null) tausRaw.push(tauRaw);

    const hygiene = metrics.scoreHygiene(firstRows);
    if (hygiene !== null) hygienes.push(hygiene);

    // T10's two discriminating metrics. The collapse denominator is "queries
    // that returned at least 2 rows" rather than "queries with 2+ SCORED rows":
    // once T10 lands, a dead reranker produces zero scored rows, and a
    // denominator that shrank to zero would report `null` instead of the 0.000
    // that is the actual result. A denominator that moves between legs cannot
    // be compared (F-29).
    const neverScored = metrics.neverScoredFraction(firstRows);
    if (neverScored !== null) neverScoreds.push(neverScored);
    if (firstRows.length >= 2) {
      collapseTotal += 1;
      // Consume T13's computed signature; do not re-derive it here.
      if (first.report?.scoreStats?.allEqual === true) collapseCollapsed += 1;
    }

    // Per-result rerank scores, each marked ground-truth-relevant or not, are
    // the calibration dataset for T08's relevance floor: the floor default must
    // sit inside the measured gap between relevant and non-matching scores.
    // T34 (design D8 a): an unpaginated source is scored at document level — the manifest's `paginated` flag says which.
    const expected = metrics.expectedKeySet(query, paginationFacts);
    const round = (v) =>
      typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v ?? null;
    const resultRecords = firstRows.map((r) => ({
      source: r.source,
      page: r.page,
      // T34: the section anchor the chunk carries (an unpaginated file's location; null where the store holds none).
      sectionPath: typeof r.sectionTitle === "string" && r.sectionTitle.trim() ? r.sectionTitle : null,
      rerankScore: round(r.rerankScore),
      relevant: expected.has(metrics.resultKey(r, paginationFacts)),
    }));

    // T10: what the route SAID about this query's scoring, recorded per query
    // so a moved aggregate can be attributed to specific queries and states.
    const scoringRecord = {
      degraded: first.degraded.map((d) => d.code),
      nullScoreCount: first.report ? first.report.nullScoreCount : null,
      candidatesScored: first.report ? first.report.candidatesScored ?? null : null,
      allEqual: first.report?.scoreStats?.allEqual ?? null,
      // T16 / cut-over (review §11b M2): the pin verdict per query, so a run
      // on a pinned class can be checked for `match` on every query (F-74).
      embedSpace: first.report?.embedSpace?.verdict ?? null,
      // Cut-over (review §11b M9): the class the server SAYS it read.
      collection: first.report?.collection ?? null,
    };
    // The class observed on the response must be the class this run believes
    // it measures (derived from RAG_EVAL_COLLECTION + RAG_EVAL_SCHEMA_VERSION);
    // a server resolving differently would otherwise be recorded as measured.
    if (typeof first.report?.collection === "string" && first.report.collection !== config.collectionClass) {
      throw new Error(`[eval guard] the server read '${first.report.collection}' but this run states ${config.collectionClass} (RAG_EVAL_SCHEMA_VERSION=${config.schemaVersion})`);
    }

    if ((query.relevant || []).length === 0) {
      absenceTotal += 1;
      if (firstRows.length === 0) absenceClean += 1;
      perQuery.push({
        id: query.id,
        style: query.style,
        returned: firstRows.length,
        tau,
        tauRaw,
        hygiene,
        neverScored,
        ...scoringRecord,
        results: resultRecords,
      });
      continue;
    }

    const recall = metrics.recallAtK(firstRows, query, RUN_CONFIG.recallK, paginationFacts);
    const recallTopN = metrics.recallAtK(firstRows, query, RUN_CONFIG.keepTopNAfterRerank, paginationFacts);
    const rr = metrics.reciprocalRankAtK(firstRows, query, RUN_CONFIG.mrrK, paginationFacts);
    const granularity = metrics.granularityOf(query, paginationFacts);

    recalls.push(recall);
    recallsTopN.push(recallTopN);
    rrs.push(rr);

    perQuery.push({
      id: query.id,
      style: query.style,
      returned: firstRows.length,
      recallAtK: recall,
      recallAtKeepTopN: recallTopN,
      reciprocalRank: rr,
      // T34: page (a paginated source), document (an unpaginated one — a hit is the right FILE), mixed.
      granularity,
      tau,
      tauRaw,
      hygiene,
      neverScored,
      ...scoringRecord,
      results: resultRecords,
    });
  }

  return {
    status: "measured",
    metrics: {
      [`recall@${RUN_CONFIG.recallK}`]: metrics.mean(recalls),
      [`recall@keepTopN(${RUN_CONFIG.keepTopNAfterRerank})`]: metrics.mean(recallsTopN),
      [`MRR@${RUN_CONFIG.mrrK}`]: metrics.mean(rrs),
      rankStabilityKendallTau: metrics.mean(taus),
      // T40 (D10): the pre-T40 τ, reported beside the gated one.
      rankStabilityKendallTauRaw: metrics.mean(tausRaw),
      scoreHygieneDegradedFraction: metrics.mean(hygienes),
      neverScoredFraction: metrics.mean(neverScoreds),
      scoreCollapseFraction: collapseTotal ? collapseCollapsed / collapseTotal : null,
      absenceProbesReturningNothing: absenceTotal ? absenceClean / absenceTotal : null,
      citationValidityRate: null,
      answerSubstringHitRate: null,
    },
    // T34 (design D8 a): the queries whose relevant source has no pages are scored at DOCUMENT level — the number
    // says the right file came back, never the right page — and are counted here so no snapshot claims a page-level
    // recall it did not measure. Section-level scoring is the next ticket (t34-design.md §12b).
    unpaginated: {
      queries: perQuery.filter((q) => q.granularity === "document" || q.granularity === "section" || q.granularity === "mixed").map((q) => q.id),
      // T38: a query that names the section its anchor sits under is scored at SECTION level (the row's innermost heading).
      sectionLevel: perQuery.filter((q) => q.granularity === "section").map((q) => q.id),
      documentLevel: perQuery.filter((q) => q.granularity === "document").map((q) => q.id),
      sources: paginationFacts ? Object.keys(paginationFacts).filter((s) => paginationFacts[s] === false).sort() : [],
    },
    notes: [
      "T10: scoreHygieneDegradedFraction keeps its ORIGINAL definition (null OR exactly " +
        "0.5) so the number stays comparable with every earlier snapshot — but it cannot " +
        "distinguish an honest null from a fabricated 0.5, so with a failing reranker it " +
        "reads 1.000 both before and after T10. neverScoredFraction and " +
        "scoreCollapseFraction are the discriminating pair: honest nulls RAISE the first " +
        "(correct, per the owner's ruling that unscored candidates pass the floor with " +
        "disclosure) while the fabricated uniform band drives the second to zero.",
      "citationValidityRate is measured end-to-end by tests/eval/run_citations.js (T14) — " +
        "this retrieval-only harness never generates answers, so it stays null here. " +
        "answerSubstringHitRate lacks ground truth in queries.json (F-33).",
    ],
    perQuery,
  };
}

function buildStub(reason, attempted) {
  return {
    status: "services_unavailable",
    reason,
    attempted,
    metrics: {
      [`recall@${RUN_CONFIG.recallK}`]: null,
      [`recall@keepTopN(${RUN_CONFIG.keepTopNAfterRerank})`]: null,
      [`MRR@${RUN_CONFIG.mrrK}`]: null,
      rankStabilityKendallTau: null,
      rankStabilityKendallTauRaw: null,
      scoreHygieneDegradedFraction: null,
      neverScoredFraction: null,
      scoreCollapseFraction: null,
      absenceProbesReturningNothing: null,
      citationValidityRate: null,
      answerSubstringHitRate: null,
    },
    notes: [
      "No retrieval was executed, so these metrics are null rather than zero.",
      "T00's acceptance criteria permit this stub when live services are unreachable.",
      "A real in-cluster run must replace this before any ticket claims a retrieval " +
        "improvement; until then there is no baseline to compare against.",
    ],
    perQuery: [],
  };
}

/** T34: the manifest's per-source `paginated` flag → { [fileName]: boolean } (an entry without the flag is left out: the pre-T34 page reading). */
function paginationFactsOf(manifest) {
  const facts = {};
  for (const entry of (manifest && manifest.corpus) || []) {
    if (entry && !entry.skipped && typeof entry.paginated === "boolean") facts[entry.fileName] = entry.paginated;
  }
  return facts;
}

function summarise(snapshot) {
  const lines = [`status: ${snapshot.status}`];
  for (const [key, value] of Object.entries(snapshot.metrics)) {
    lines.push(`  ${key}: ${value === null ? "n/a" : Number(value).toFixed(4)}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);

  const manifest = loadJson(MANIFEST_PATH);
  const querySet = loadJson(QUERIES_PATH);
  assertQueriesMatchManifest(querySet.queries, manifest);
  console.log(
    `Loaded ${querySet.queries.length} queries over ${manifest.corpus.filter((e) => !e.skipped).length} corpus documents.`
  );

  const { queries, scope } = scopeFilter(querySet.queries);
  if (scope) {
    console.log(
      `Scoped to ${scope.sources.length} indexed documents: ` +
        `${scope.queriesIncluded} queries kept, ${scope.queriesExcluded} excluded.`
    );
  }

  const config = serviceConfig();
  let result;

  if (!config) {
    const attempted = {
      RAG_EVAL_WEAVIATE_URL: process.env.RAG_EVAL_WEAVIATE_URL || null,
      RAG_EVAL_EMBED_URL: process.env.RAG_EVAL_EMBED_URL || null,
      RAG_EVAL_COLLECTION: process.env.RAG_EVAL_COLLECTION || null,
      RAG_EVAL_EMBED_MODEL: process.env.RAG_EVAL_EMBED_MODEL || null,
      RAG_EVAL_SCHEMA_VERSION: process.env.RAG_EVAL_SCHEMA_VERSION || null,
    };
    result = buildStub(
      "RAG_EVAL_WEAVIATE_URL, RAG_EVAL_EMBED_URL, RAG_EVAL_COLLECTION, " +
        "RAG_EVAL_EMBED_MODEL and RAG_EVAL_SCHEMA_VERSION must all be set (the embed model " +
        "and the schema version are identity, not tuning — the model that built the " +
        "collection and the class shape it has). The demo services are " +
        "cluster-internal (weaviate.hpe-weaviate.svc.cluster.local and the MLIS endpoints) " +
        "and are not resolvable outside the cluster, so this baseline " +
        "must be captured from inside it.",
      attempted
    );
    console.log("\nLive services not configured — writing a services-unavailable stub.");
  } else {
    console.log(`Measuring against ${config.collection} (schemaVersion ${config.schemaVersion}, class ${config.collectionClass}) via ${config.appUrl} ...`);
    try {
      result = await runLive(config, queries, paginationFactsOf(manifest));
    } catch (err) {
      result = buildStub(`live run failed: ${err.message}`, {
        collection: config.collection,
        appUrl: config.appUrl,
      });
      console.error(`\nLive run failed, writing stub: ${err.message}`);
    }
  }

  // Provenance is mandatory, not decorative. A retrieval baseline is only
  // comparable against a run that used the same embedding space and reranker;
  // audit FM-V3/E35 is precisely the failure of not recording which model built
  // a collection. Endpoints and models are recorded; tokens never are.
  const provenance = config
    ? {
        collection: config.collection,
        collectionSchemaVersion: config.schemaVersion,
        collectionClass: config.collectionClass,
        embedModel: config.embedModel,
        embedEndpoint: config.embedUrl,
        rerankModel: config.rerankModel || null,
        rerankEndpoint: config.rerankUrl || null,
        weaviateEndpoint: config.weaviateUrl,
        appUrl: config.appUrl,
      }
    : null;

  const snapshot = {
    schemaVersion: 1,
    kind: "rag-retrieval-eval-baseline",
    createdFor: process.env.RAG_EVAL_CREATED_FOR || "audit ticket T00 (pre-fix baseline)",
    provenance,
    corpusRoot: manifest.corpusRoot,
    manifestSchemaVersion: manifest.schemaVersion,
    queryCount: queries.length,
    queryCountTotal: querySet.queries.length,
    scope,
    runConfig: RUN_CONFIG_RECORD,
    ...result,
  };

  if (args.compare) {
    const other = loadJson(args.compare);
    console.log(`\nBaseline (${path.relative(REPO_ROOT, args.compare)}):\n${summarise(other)}`);
    console.log(`\nCurrent run:\n${summarise(snapshot)}`);
    return 0;
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`\nWrote ${path.relative(REPO_ROOT, args.out)}\n${summarise(snapshot)}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`eval harness failed: ${err.message}`);
    process.exit(1);
  }
);
