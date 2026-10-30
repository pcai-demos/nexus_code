/**
 * Trace credential redaction — ticket T13, finding F-28.
 *
 * F-28 (measured live, 2026-08-13): the rag_pipeline trace attached the whole
 * retrieve payload as `details.requestParameters`, so all three service-account
 * JWTs (`token`, `weaviateToken`, `rerankToken`) rode back to the browser on
 * every doc-mode turn — rendered by the Tracing Drawer, one click from the
 * clipboard, and inside every exported turn. The standing rule is "never put
 * credential values in conversation, logs, traces, or terminal output"; the
 * application violated the trace half of its own rule, in a demo feature.
 *
 * Two layers, both structural rather than careful:
 *
 *  1. `projectRetrievalConfigForTrace` — the trace never carries the request
 *     payload at all. It carries the RESOLVED config through an ALLOWLIST
 *     projection: a function that names what it includes fails closed when a
 *     fourth credential appears, where `delete details.token` would fail open.
 *     (The resolved config itself still holds the tokens — resolution alone is
 *     not redaction; the projection is.) This is also more useful for
 *     debugging: the raw payload deliberately omits every key the browser did
 *     not set (T08), so it showed what was SENT, not what RAN — the same trap
 *     that produced F-25.
 *
 *  2. `redactTraceDetails` — one scrubber at the boundary, run once on the
 *     whole trace array immediately before the orchestrator returns. It makes
 *     "no JWT-shaped value anywhere in `traces`" an invariant of the pipeline
 *     rather than a property of one call site: the next span that attaches
 *     headers or a payload is covered before it is written.
 *
 * This is observability code, so it lives inside the blast radius F-25 mapped:
 * it must be total (never throw on any input), cheap, and its failure mode at
 * the call site is "drop the details", never "ship them unredacted" and never
 * "lose the answer".
 */

/**
 * Key names whose string values are credentials wherever they appear.
 * Suffix-matched case-insensitively so `rerankApiKey`, `nimApiKey`,
 * `weaviateToken` etc. are all caught without enumerating every spelling —
 * while `maxTokens` / `prompt_tokens` (plural) are not.
 */
const CREDENTIAL_KEY_SUFFIXES = Object.freeze([
  "token",
  "apikey",
  "api_key",
  "secret",
  "password",
  "credential",
  "authorization",
]);

function isCredentialKey(key) {
  const k = String(key).toLowerCase();
  return CREDENTIAL_KEY_SUFFIXES.some((sfx) => k === sfx || k.endsWith(sfx));
}

/**
 * A JWT is three dot-joined base64url segments; every JSON-payload JWT starts
 * `eyJ` ("{"...). Matching the shape anywhere INSIDE a string also catches a
 * token embedded in a URL or an error message.
 */
const JWT_SHAPE = /\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*/g;

const REDACTED = "[REDACTED]";

/** Recursion guards: a trace is small; anything past these is pathological. */
const MAX_DEPTH = 24;
const MAX_NODES = 50000;

function deepRedact(node, seen, depth, budget) {
  if (budget.nodes-- <= 0) return "[TRUNCATED: trace too large to redact]";
  if (typeof node === "string") return node.replace(JWT_SHAPE, REDACTED);
  if (node === null || typeof node !== "object") return node;
  if (depth > MAX_DEPTH) return "[TRUNCATED: max depth]";
  if (seen.has(node)) return "[CYCLE]";
  seen.add(node);

  let out;
  if (Array.isArray(node)) {
    out = node.map((v) => deepRedact(v, seen, depth + 1, budget));
  } else {
    out = {};
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (isCredentialKey(key) && typeof value === "string" && value.length > 0) {
        // An empty string is kept: "no credential was sent" is a debugging
        // fact worth seeing; a non-empty one is redacted wholesale.
        out[key] = REDACTED;
      } else {
        out[key] = deepRedact(value, seen, depth + 1, budget);
      }
    }
  }

  // DFS bookkeeping, not memoisation: only a true ancestor cycle is a cycle.
  // A shared (diamond) reference is legitimate and must not be eaten.
  seen.delete(node);
  return out;
}

/**
 * Return a deep-redacted COPY of a trace array (input is never mutated —
 * spans may reference live module state such as ingestionState.doclingTraces).
 * Total: never throws, whatever it is fed.
 */
function redactTraceDetails(traces) {
  const seen = new WeakSet();
  const budget = { nodes: MAX_NODES };
  if (!Array.isArray(traces)) return deepRedact(traces, seen, 0, budget);
  return traces.map((t) => deepRedact(t, seen, 0, budget));
}

/**
 * The allowlisted view of a resolveRetrievalConfig() result for trace
 * `details`. Tuning knobs, pools, endpoints, model names, collection — never
 * a credential, which is simply not named here.
 *
 * The unresolved branch is explicit because that is when the trace is most
 * useful (a misconfigured browser) and exactly where a naive `.config.x` read
 * would throw inside a trace builder and be swallowed (F-25).
 */
function projectRetrievalConfigForTrace(resolved) {
  if (!resolved || resolved.ok !== true || !resolved.config) {
    return {
      resolved: false,
      error: resolved && resolved.error
        ? { code: resolved.error.code || null, field: resolved.error.field || null }
        : null,
    };
  }
  const c = resolved.config;
  return {
    resolved: true,
    searchStrategy: c.searchStrategy,
    hybridAlpha: c.hybridAlpha,
    limit: c.limit,
    candidatesToRerank: c.candidatesToRerank,
    keepTopNAfterRerank: c.keepTopNAfterRerank,
    poolSize: c.poolSize,
    minRerankScore: c.minRerankScore,
    similarityThreshold: c.similarityThreshold,
    floorSource: c.floorSource,
    rerankEnabled: c.rerankEnabled,
    rerankEffective: c.rerankEffective,
    rerankUrl: c.rerankUrl,
    rerankModel: c.rerankModel,
    rerankProperty: c.rerankProperty,
    // T42 (design D3, D4, D8): the rerank stage's per-request bounds and its deadline.
    rerankMaxChars: c.rerankMaxChars,
    rerankMaxDocs: c.rerankMaxDocs,
    rerankBudgetMs: c.rerankBudgetMs,
    weaviateUrl: c.weaviateUrl,
    weaviateCollection: c.weaviateCollection,
    embedUrl: c.embedUrl,
    embedModel: c.embedModel,
  };
}

/**
 * The allowlisted view of a citation audit (T14) for trace `details`. Marker
 * mappings and the uncited-claim VERDICTS — no answer text (the fabricated-
 * claim strings embed a short answer excerpt for the chat response's chip
 * tooltip; the trace copy is truncated at the excerpt delimiter so this
 * module's "nothing not named here" contract stays true), no chunk bodies.
 * Total: null/garbage audit shapes and non-object elements project to
 * empty/skipped, never throw (F-25 — this runs inside a trace builder).
 */
function projectCitationAuditForTrace(audit, contextBlockCount) {
  const a = audit && typeof audit === "object" ? audit : {};
  return {
    contextBlockCount: Number(contextBlockCount) || 0,
    citations: (Array.isArray(a.citations) ? a.citations : [])
      .filter((c) => c && typeof c === "object")
      .map((c) => ({
        marker: c.marker,
        source: c.source,
        page: c.page,
        sectionPath: c.sectionPath,
        pageAttribution: c.pageAttribution,
      })),
    uncitedClaims: (Array.isArray(a.uncitedClaims) ? a.uncitedClaims : []).map(
      // Our own stable format ends the verdict at `: "` before the excerpt.
      (s) => String(s).split(': "')[0]
    ),
    pageClaimCount: Number(a.pageClaimCount) || 0,
  };
}

module.exports = {
  CREDENTIAL_KEY_SUFFIXES,
  isCredentialKey,
  redactTraceDetails,
  projectRetrievalConfigForTrace,
  projectCitationAuditForTrace,
};
