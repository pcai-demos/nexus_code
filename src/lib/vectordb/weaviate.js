const { similarityFromDistance, filterBySimilarity, normaliseSchemaVersion, RETRIEVAL_DEFAULTS } = require("../rag/config");
const { INGEST_ERROR_CODES } = require("../ingestion/state");
const { chunkIdFor } = require("../rag/ids");

/**
 * An error that carries a typed code from the ingest taxonomy, so a route can
 * map it to a status without pattern-matching the message.
 */
function codedError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * The plain constructor's name resolution and the destructive predicate live
 * in `src/lib/rag/names.js` since T17 (design D13): the retrieval resolver
 * applies the same rule and must not require this module (this module
 * requires config.js). Re-exported here unchanged so every caller and pin
 * (T21's U-DESTRUCT) keeps its import. `canonicalClassName`'s fallback to
 * "RAGChunk" is INTENDED on the write path (owner decision, session 5) and is
 * exactly what must never happen on a destructive path (F-15) — see
 * forDestructiveOps below.
 */
const { canonicalClassName, isExplicitClassName } = require("../rag/names");
const { isRagClassName } = require("../ingestion/crops");

// T22 (design D12, finding F-69): the bound on one batch insert. Overridable
// per client (`options.batchInsertTimeoutMs`) so a test can prove the bound
// against a hung listener in well under a minute.
const BATCH_INSERT_TIMEOUT_MS = 60000;

/** A fetch failure that PROVES the request never reached the server. */
function connectionRefused(err) {
  const code = err?.cause?.code || err?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN";
}

// Vector dimensionality per (url, class), learned from the first object seen.
// Collections are immutable in dimensionality unless re-ingested with another
// model, so a cache hit is almost always right; getVectorDimension({refresh})
// exists for the caller that suspects staleness (ticket T08).
const vectorDimCache = new Map();

// Property names per (url, class), learned from GET /v1/schema/<class> on the
// first search (ticket T05). Weaviate fails a WHOLE GraphQL query on one
// unknown field (verified 2026-09-04: `Cannot query field "chunkIndex" on
// type "RAGEval_t08_20260813"`, HTTP 200, no data), so search() selects only
// what the class has. Refreshed once when such an error arrives anyway — the
// class was dropped and recreated with another shape under a live process.
const classPropertyCache = new Map();

/** The v1 class, exactly as every collection to date was created. */
const V1_PROPERTIES = Object.freeze([
  { name: "text", dataType: ["text"] },
  { name: "source", dataType: ["text"] },
  { name: "fileType", dataType: ["text"] },
  { name: "chapter", dataType: ["text"] },
  { name: "sectionNumber", dataType: ["text"] },
  { name: "sectionTitle", dataType: ["text"] },
  { name: "page", dataType: ["int"] },
  { name: "docHash", dataType: ["text"] },
  { name: "imagePath", dataType: ["text"] },
  { name: "isVisualElement", dataType: ["boolean"] },
  { name: "metadata", dataType: ["text"] },
]);

/**
 * Schema v2 = v1 + identity (T05, target-architecture §2, design D4). The
 * three text additions are `field`-tokenised so `Equal` matches the whole
 * value (a `word`-tokenised path would match token-wise) and are NOT
 * BM25-searchable, so keyword ranking over the same text is byte-identical
 * between v1 and v2 — the v1 columns' index settings are untouched (E23 is
 * T11's). `engine` persists the parser engine per chunk (F-30).
 */
const V2_EXTRA_PROPERTIES = Object.freeze([
  { name: "sourceId", dataType: ["text"], tokenization: "field", indexFilterable: true, indexSearchable: false },
  { name: "docVersion", dataType: ["text"], tokenization: "field", indexFilterable: true, indexSearchable: false },
  { name: "chunkIndex", dataType: ["int"], indexFilterable: true },
  { name: "engine", dataType: ["text"], tokenization: "field", indexFilterable: true, indexSearchable: false },
]);
const V2_REQUIRED_NAMES = Object.freeze(V2_EXTRA_PROPERTIES.map((p) => p.name));

/** T06: bound on one supersede / unload-by-sourceId batch delete (the live probe's took well under a second for 107 objects). */
const SUPERSEDE_TIMEOUT_MS = 60000;

/** Fields search() selects when — and only when — the class has them. */
const OPTIONAL_SELECT_FIELDS = Object.freeze(["isVisualElement", "imagePath", "chunkIndex", "docVersion", "sourceId"]);
/** The v1 fields every read selects (search() and T28's page / document reads). */
const BASE_SELECT_FIELDS = Object.freeze(["text", "source", "fileType", "chapter", "sectionNumber", "sectionTitle", "page", "docHash", "metadata"]);
/** T28: bound on one page / document read (the measured reads take milliseconds; a hung store must not hold a turn). */
const READ_TIMEOUT_MS = 15000;

/** A GraphQL string literal. */
function gqlString(value) {
  return JSON.stringify(String(value));
}

class WeaviateClient {
  /**
   * READ / WRITE construction. Behaviour is deliberately unchanged by T21: the
   * name is sanitised and null defaults to "RAGChunk", because the retrieve
   * route, the orchestrator's summary and the ingest writes all build clients
   * this way. A client built here CANNOT drop a class or delete objects —
   * clearSchema() and deleteByHash() refuse to run on it (F-15). Obtain one
   * that can via WeaviateClient.forDestructiveOps().
   */
  constructor(url, token, className = "RAGChunk", { schemaVersion, batchInsertTimeoutMs } = {}) {
    this.url = url.endsWith('/') ? url.slice(0, -1) : url;
    this.token = (token || "").trim();
    this.className = this.sanitizeClassName(className);
    this.destructive = false;
    // T22 (design D12): the per-batch insert bound; the default is the
    // supersede's 60 s precedent, a test may shorten it.
    this.batchInsertTimeoutMs = Number.isFinite(batchInsertTimeoutMs) && batchInsertTimeoutMs > 0 ? batchInsertTimeoutMs : BATCH_INSERT_TIMEOUT_MS;
    // T05: 2 (or "2", the same rule as the resolver) makes ensureSchema()
    // create (or require) the v2 properties and batchInsert() send
    // deterministic ids. Anything else is v1, byte-for-byte. search() does
    // not read it — it introspects the class instead.
    this.schemaVersion = normaliseSchemaVersion(schemaVersion);
  }

  sanitizeClassName(name) {
    return canonicalClassName(name);
  }

  static canonicalClassName(name) {
    return canonicalClassName(name);
  }

  static isExplicitClassName(name) {
    return isExplicitClassName(name);
  }

  /**
   * DESTRUCTIVE construction — the only way to obtain a client whose
   * clearSchema() and deleteByHash() will run. Refuses, with the typed code
   * COLLECTION_REQUIRED, anything that is not an explicit class name: null,
   * undefined, "", whitespace, non-strings, and any string the sanitiser would
   * change. The pre-T21 constructor laundered every one of those into the
   * literal "RAGChunk" before any check ran, which is how a destructive call
   * with no collection targeted the production class (F-15, reproduced live
   * 2026-09-03). This is explicitness, not access control: nothing can drop a
   * class without saying "destructive" at the construction site and naming
   * exactly what it drops.
   */
  static forDestructiveOps(url, token, className, options = {}) {
    if (!isExplicitClassName(className)) {
      throw codedError(
        INGEST_ERROR_CODES.COLLECTION_REQUIRED,
        `A destructive Weaviate operation requires an explicit collection name and received ` +
          `${JSON.stringify(className === undefined ? null : className)}. Nothing is dropped or ` +
          `deleted by default; name the exact class (for example "RAGChunk").`
      );
    }
    const client = new WeaviateClient(url, token, className, options);
    client.destructive = true;
    return client;
  }

  /** Gate on the two destructive methods: a plain client never gets past it. */
  assertDestructiveClient(operation) {
    if (this.destructive !== true) {
      throw codedError(
        INGEST_ERROR_CODES.COLLECTION_REQUIRED,
        `${operation} refused: this WeaviateClient was not built for destructive operations. ` +
          `Construct it with WeaviateClient.forDestructiveOps(url, token, collection) and an explicit collection name.`
      );
    }
  }

  getHeaders() {
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.token) {
      headers["x-auth-token"] = this.token;
    }
    return headers;
  }

  /**
   * Make sure this class exists with the properties this client's schema
   * version needs. Check-then-create, as before, with two changes (T05):
   *
   *  - A LOST RACE IS SUCCESS (E26 / H5, design D5). Two concurrent first
   *    ingests both GET 404 and both POST; Weaviate accepts one and refuses
   *    the other with 422 — and with two different messages for the same
   *    condition (`TYPE_ADD_CLASS: class already exists` for the racing
   *    loser, `class name X already exists` sequentially; both measured
   *    2026-09-04 on 1.25.6). So a failed create is followed by a second GET,
   *    and "it exists now" is the answer, status and message aside. Applies
   *    to both versions: the only v1 behaviour that changes is a race that
   *    used to fail the losing job before it parsed anything.
   *  - Under v2 an EXISTING class must already carry the v2 properties, or
   *    this throws. Weaviate's auto-schema would otherwise add `chunkIndex`
   *    and friends to a v1 class on the first insert, leaving it half of
   *    each version with nothing having said so.
   */
  async ensureSchema() {
    const headers = this.getHeaders();
    const cls = this.className;

    // Check if target class exists
    const checkRes = await fetch(`${this.url}/v1/schema/${cls}`, {
      method: "GET",
      headers
    });

    if (checkRes.status === 200) {
      if (this.schemaVersion === 2) await this.assertV2Properties(checkRes);
      this.lastEnsureSchema = { existed: true, created: false, raced: false };
      return true; // Already exists
    }

    // Create target class schema
    const schema = {
      "class": cls,
      "description": `RAG document chunk storage for collection ${cls}` +
        (this.schemaVersion === 2 ? " (schema v2: deterministic ids, chunkIndex / docVersion / sourceId)" : ""),
      "vectorizer": "none",
      "vectorIndexType": "hnsw",
      "vectorIndexConfig": {
        "distance": "cosine"
      },
      "properties": [
        ...V1_PROPERTIES.map((p) => ({ ...p })),
        ...(this.schemaVersion === 2 ? V2_EXTRA_PROPERTIES.map((p) => ({ ...p })) : [])
      ]
    };

    const createRes = await fetch(`${this.url}/v1/schema`, {
      method: "POST",
      headers,
      body: JSON.stringify(schema)
    });

    if (createRes.ok) {
      classPropertyCache.set(`${this.url}|${cls}`, new Set(schema.properties.map((p) => p.name)));
      // T07: the ingest route writes the ledger's collection_created event
      // from this, so the pin T16 needs has a record of the first ingest.
      this.lastEnsureSchema = { existed: false, created: true, raced: false };
      return true;
    }

    const body = (await createRes.text()).slice(0, 500);
    // Somebody else may have created it between our GET and our POST. Ask
    // again rather than parse the refusal.
    const recheck = await fetch(`${this.url}/v1/schema/${cls}`, {
      method: "GET",
      headers
    });
    if (recheck.status === 200) {
      console.log(`[Weaviate ensureSchema] '${cls}' was created concurrently (create answered HTTP ${createRes.status}); treating as success.`);
      if (this.schemaVersion === 2) await this.assertV2Properties(recheck);
      this.lastEnsureSchema = { existed: true, created: false, raced: true };
      return true;
    }
    throw new Error(`Failed to create Weaviate schema for '${cls}': ${body}`);
  }

  /**
   * The v2 guard: `res` is a 200 from GET /v1/schema/<class>. Throws if any
   * required v2 property is missing — an existing v1 class named like a v2
   * one is a configuration error, not something to write into.
   */
  async assertV2Properties(res) {
    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw new Error(`Could not read the schema of '${this.className}' to verify it is a v2 class: ${e.message}`);
    }
    if (!body || typeof body !== "object" || !Array.isArray(body.properties)) {
      throw new Error(`Could not read the schema of '${this.className}' to verify it is a v2 class: the response carried no property list`);
    }
    const names = new Set(body.properties.map((p) => p?.name));
    const missing = V2_REQUIRED_NAMES.filter((n) => !names.has(n));
    if (missing.length > 0) {
      throw new Error(
        `Collection '${this.className}' exists but is not a schema-v2 class: it lacks ${missing.join(", ")}. ` +
          `A v2 ingest will not write into it. Use a different collection name, or drop and recreate it under schemaVersion 2.`
      );
    }
    classPropertyCache.set(`${this.url}|${this.className}`, names);
  }

  /**
   * Property names this class actually has, from GET /v1/schema/<class>,
   * cached per (url, class). Throws on a non-200: the search that needs the
   * answer is about to hit the same server, and a fabricated "no optional
   * fields" would silently drop isVisualElement from every row (E24 again).
   */
  async classProperties({ refresh = false } = {}) {
    const key = `${this.url}|${this.className}`;
    if (!refresh && classPropertyCache.has(key)) return classPropertyCache.get(key);
    const res = await fetch(`${this.url}/v1/schema/${this.className}`, {
      method: "GET",
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
      throw new Error(`Weaviate schema read failed for collection '${this.className}': HTTP ${res.status} ${body}`);
    }
    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw new Error(`Weaviate schema read returned a non-JSON 200 for '${this.className}': ${e.message}`);
    }
    if (!body || typeof body !== "object" || body.class !== this.className || !Array.isArray(body.properties)) {
      // A 200 that is not this class's schema (a proxy page, a rewritten
      // body) must not become "no optional fields" — that is E24 again.
      throw new Error(
        `Weaviate schema read for '${this.className}' returned a body that is not this class's schema: ${JSON.stringify(body).slice(0, 200)}`
      );
    }
    const names = new Set(body.properties.map((p) => p?.name).filter(Boolean));
    classPropertyCache.set(key, names);
    return names;
  }

  /**
   * Delete every object in this class carrying `docHash`. Destructive: runs
   * only on a client from forDestructiveOps().
   *
   * Returns `{ok, status, body}` rather than swallowing a refusal. A network
   * failure still throws (unchanged). The ingest route's v1 overwrite path
   * ignores the return value exactly as it ignored `undefined` before, so its
   * behaviour is unchanged; the unload route reads it, so "successfully
   * unloaded" is no longer reported for a delete Weaviate refused.
   *
   * T05: with `{ sourceId }` the match is `docHash AND sourceId` — under
   * schema v2 the identity is per path, and a second path holding the same
   * bytes must not have the first path's chunks deleted from under it
   * (review finding, 2026-09-04). Without the option the match is the v1
   * content-hash match, byte for byte. Since T06 the v2 ingest path no
   * longer calls this (it supersedes after the insert instead); v1 still does.
   */
  async deleteByHash(docHash, { sourceId } = {}) {
    this.assertDestructiveClient("deleteByHash");

    const hashClause = { "path": ["docHash"], "operator": "Equal", "valueText": docHash };
    const where =
      typeof sourceId === "string" && sourceId
        ? { "operator": "And", "operands": [hashClause, { "path": ["sourceId"], "operator": "Equal", "valueText": sourceId }] }
        : hashClause;
    return this.batchDeleteWhere(where, `for hash ${docHash}`);
  }

  /**
   * Version supersede — ticket T06 (audit E05 / FM-V1; design D1, D5).
   * Delete every object at `sourceId` that is NOT one of the chunks just
   * written: any other `docVersion`, and — when `keepChunkCount` is given —
   * any object of the kept version whose `chunkIndex` is at or beyond it
   * (a same-version re-ingest that produced fewer chunks leaves a stale
   * tail the upsert never touches; caption sampling does this, F-54).
   * Verified live on 1.25.6 (t06-artifacts): the nested Or inside the And
   * matched exactly old + tail, then exactly the tail.
   *
   * Runs AFTER the new version's insert, so the previous version serves
   * until the new one is complete. Destructive: forDestructiveOps() only.
   * Same return contract as deleteByHash; a `{ok:false}` is the caller's to
   * act on (the ingest route aborts the job — design D3).
   *
   * Both properties are `field`-tokenised on a v2 class, so Equal / NotEqual
   * compare the WHOLE value. Never filter this on `source`: it is
   * `word`-tokenised and `source Equal "report"` matched every object of a
   * 107-object class in the live probe.
   */
  async deleteBySourceExceptVersion(sourceId, keepDocVersion, { keepChunkCount } = {}) {
    this.assertDestructiveClient("deleteBySourceExceptVersion");
    if (typeof sourceId !== "string" || !sourceId) {
      throw new Error(`deleteBySourceExceptVersion: sourceId must be a non-empty string, got ${JSON.stringify(sourceId ?? null)}`);
    }
    if (typeof keepDocVersion !== "string" || !keepDocVersion) {
      throw new Error(`deleteBySourceExceptVersion: keepDocVersion must be a non-empty string, got ${JSON.stringify(keepDocVersion ?? null)}`);
    }
    if (keepChunkCount !== undefined && (!Number.isInteger(keepChunkCount) || keepChunkCount < 0)) {
      throw new Error(`deleteBySourceExceptVersion: keepChunkCount must be a non-negative integer, got ${JSON.stringify(keepChunkCount)}`);
    }
    const otherVersion = { "path": ["docVersion"], "operator": "NotEqual", "valueText": keepDocVersion };
    const notKept =
      keepChunkCount === undefined
        ? otherVersion
        : { "operator": "Or", "operands": [otherVersion, { "path": ["chunkIndex"], "operator": "GreaterThanEqual", "valueInt": keepChunkCount }] };
    const where = {
      "operator": "And",
      "operands": [{ "path": ["sourceId"], "operator": "Equal", "valueText": sourceId }, notKept]
    };
    return this.batchDeleteWhere(
      where,
      `of other versions of sourceId ${sourceId} (keeping docVersion ${keepDocVersion}` +
        (keepChunkCount === undefined ? ")" : `, chunkIndex < ${keepChunkCount})`),
      { requireResults: true, timeoutMs: SUPERSEDE_TIMEOUT_MS }
    );
  }

  /**
   * Unload under schema v2 — ticket T06 (F-55, design D6): delete EVERY
   * version at `sourceId`, whatever is on disk now. This is what makes a
   * renamed or moved file's old name removable: nothing else can reach
   * those chunks once the new name is indexed. Destructive: forDestructiveOps()
   * only. Same return contract as deleteByHash.
   */
  async deleteBySourceId(sourceId) {
    this.assertDestructiveClient("deleteBySourceId");
    if (typeof sourceId !== "string" || !sourceId) {
      throw new Error(`deleteBySourceId: sourceId must be a non-empty string, got ${JSON.stringify(sourceId ?? null)}`);
    }
    return this.batchDeleteWhere(
      { "path": ["sourceId"], "operator": "Equal", "valueText": sourceId },
      `of sourceId ${sourceId}`,
      { requireResults: true, timeoutMs: SUPERSEDE_TIMEOUT_MS }
    );
  }

  /**
   * One REST batch delete (`DELETE /v1/batch/objects`) with a `where`
   * filter, reported honestly (T21 D4): `{ok, status, body, matches, failed,
   * limit}`. A non-2xx is `{ok:false}` with the body; a 2xx is NOT "everything
   * matching was deleted" — Weaviate reports per-object failures and its
   * result cap (`limit`, 100 000 on the live build) INSIDE the 200, so
   * `failed > 0` or `matches >= limit` is `{ok:false}` too. A network failure
   * throws. `what` names the target in the log lines. Callers gate on
   * assertDestructiveClient before reaching here.
   *
   * Options (T06 review §6a): `requireResults` makes a 2xx WITHOUT a numeric
   * `results.matches` `{ok:false}` — the two T06 methods pass it, because a
   * supersede or an unload that "succeeded" with no evidence of what it
   * matched is the fabricated-success class this audit keeps finding
   * (countObjects applies the same rule). deleteByHash does not pass it, so
   * its T21 contract (a bodyless 2xx is ok) is unchanged. `timeoutMs` bounds
   * the request; without it the fetch waits as deleteByHash always has.
   */
  async batchDeleteWhere(where, what, { requireResults = false, timeoutMs } = {}) {
    this.assertDestructiveClient("batchDeleteWhere");
    const headers = this.getHeaders();
    const deletePayload = {
      "match": {
        "class": this.className,
        "where": where
      }
    };

    const res = await fetch(`${this.url}/v1/batch/objects`, {
      method: "DELETE",
      headers,
      body: JSON.stringify(deletePayload),
      ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {})
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(`Failed to delete old chunks ${what} in class ${this.className}:`, text);
      return { ok: false, status: res.status, body: text };
    }

    let results = null;
    try {
      results = JSON.parse(text)?.results ?? null;
    } catch (e) {
      results = null;
    }
    if (results && typeof results.matches === "number") {
      const failed = results.failed || 0;
      const capped = typeof results.limit === "number" && results.matches >= results.limit;
      if (failed > 0 || capped) {
        console.error(
          `Incomplete delete ${what} in class ${this.className}: matches=${results.matches} failed=${failed} limit=${results.limit}`
        );
        return { ok: false, status: res.status, body: text, matches: results.matches, failed, limit: results.limit };
      }
      return { ok: true, status: res.status, body: null, matches: results.matches, failed };
    }
    if (requireResults) {
      console.error(`Delete ${what} in class ${this.className} answered HTTP ${res.status} with no results block; not treating it as done: ${text.slice(0, 200)}`);
      return { ok: false, status: res.status, body: text };
    }
    return { ok: true, status: res.status, body: null };
  }

  /**
   * Object count for this class (Aggregate meta.count). Read-only; used by the
   * clear preview and by clear itself to report what it dropped. Throws on an
   * HTTP or GraphQL failure — callers that want "unknown" catch and say so,
   * rather than this method inventing a 0.
   */
  async countObjects() {
    const res = await fetch(`${this.url}/v1/graphql`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ query: `{ Aggregate { ${this.className} { meta { count } } } }` }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      throw new Error(`Weaviate count failed for collection '${this.className}': ${await res.text()}`);
    }
    const data = await res.json();
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      throw new Error(`Weaviate count failed for collection '${this.className}': ${data.errors.map(e => e?.message || JSON.stringify(e)).join("; ")}`);
    }
    const count = data?.data?.Aggregate?.[this.className]?.[0]?.meta?.count;
    if (typeof count !== "number") {
      // Never a fabricated 0: a 200 without meta.count is not Weaviate's
      // answer to this question (a proxy page, a rewritten body, a null class).
      throw new Error(
        `Weaviate count returned no meta.count for '${this.className}': ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return count;
  }

  /**
   * T22 (design D10): the distinct `docHash` values a class holds — the
   * documents whose crops a Tidy Up of THIS class may consider. One
   * Aggregate with groupBy, the read the design's own probe used. Throws on
   * a failed read (the caller treats unknown as "purge nothing"); an absent
   * class reads as [] only when Weaviate says so (a GraphQL error names it).
   */
  async docHashes(className = this.className) {
    const res = await fetch(`${this.url}/v1/graphql`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ query: `{ Aggregate { ${className}(groupBy: ["docHash"]) { groupedBy { value } meta { count } } } }` }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`Weaviate docHash read failed for '${className}': ${await res.text()}`);
    const data = await res.json();
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      throw new Error(`Weaviate docHash read failed for '${className}': ${data.errors.map(e => e?.message || JSON.stringify(e)).join("; ")}`);
    }
    const groups = data?.data?.Aggregate?.[className];
    if (!Array.isArray(groups)) throw new Error(`Weaviate docHash read returned no groups for '${className}': ${JSON.stringify(data).slice(0, 200)}`);
    return groups.map(g => g?.groupedBy?.value).filter(v => typeof v === "string" && v);
  }

  /**
   * T22 (design D10): every class in the store that belongs to this demo's
   * RAG family (RAGChunk, RAGChunkV2, RAGEval_*) — never another
   * application's classes. Throws on a failed read.
   */
  async listRagClasses() {
    const res = await fetch(`${this.url}/v1/schema`, {
      method: "GET",
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`Weaviate schema read failed: ${await res.text()}`);
    const data = await res.json();
    const classes = Array.isArray(data?.classes) ? data.classes.map(c => c?.class).filter(n => typeof n === "string") : null;
    if (!classes) throw new Error(`Weaviate schema read returned no classes: ${JSON.stringify(data).slice(0, 200)}`);
    return classes.filter(isRagClassName).sort();
  }

  /**
   * T22 (design D10): the union of docHashes held by every OTHER RAG class —
   * the set a Tidy Up must not touch. Throws if any read fails (unknown is
   * never "safe to purge").
   */
  async docHashesInOtherRagClasses() {
    const others = (await this.listRagClasses()).filter(n => n !== this.className);
    const all = new Set();
    for (const name of others) {
      for (const h of await this.docHashes(name)) all.add(h);
    }
    return [...all].sort();
  }

  /**
   * Insert a batch of chunks. Under schema v1 the object map is exactly what
   * it always was — no `id`, the eleven v1 properties. Under v2 (T05) every
   * object carries `id = uuidv5(sourceId:docVersion:chunkIndex)` (so a
   * re-send is an upsert, never a duplicate — E25 / FM-D2) plus the four
   * identity properties; a chunk without its identity is refused BEFORE the
   * request, because a v2 object without a deterministic id is the defect.
   */
  async batchInsert(chunks) {
    const headers = this.getHeaders();
    const v2 = this.schemaVersion === 2;
    
    const payload = {
      objects: chunks.map((c, i) => {
        let metaObj = {};
        try {
          metaObj = JSON.parse(c.metadata);
        } catch (e) {}

        let identity = {};
        if (v2) {
          if (typeof c.sourceId !== "string" || !c.sourceId || typeof c.docVersion !== "string" || !c.docVersion || !Number.isInteger(c.chunkIndex)) {
            throw new Error(
              `Schema v2 insert into '${this.className}' refused: chunk ${i} (${c.source || "unknown source"}) has no complete identity ` +
                `(sourceId ${JSON.stringify(c.sourceId ?? null)}, docVersion ${JSON.stringify(c.docVersion ?? null)}, chunkIndex ${JSON.stringify(c.chunkIndex ?? null)}).`
            );
          }
          identity = {
            id: chunkIdFor(c.sourceId, c.docVersion, c.chunkIndex),
            properties: {
              sourceId: c.sourceId,
              docVersion: c.docVersion,
              chunkIndex: c.chunkIndex,
              engine: typeof c.engine === "string" ? c.engine : ""
            }
          };
        }

        return {
          class: this.className,
          ...(v2 ? { id: identity.id } : {}),
          properties: {
            ...(v2 ? identity.properties : {}),
            text: c.text,
            source: c.source,
            fileType: c.fileType,
            chapter: metaObj.chapter || metaObj.chapter_title || metaObj.part_title || "",
            // T41 (design D11 a, F-159): the PCI parser's sub_requirement (`3.1.2`) reaches the column too — before its
            // parent requirement number (`3`), the more specific identifier first; the column is not BM25-searched since T40.
            sectionNumber: metaObj.section_number || metaObj.rule_ref || metaObj.sub_requirement || metaObj.requirement_number || metaObj.regulation_number || "",
            sectionTitle: metaObj.section_title || metaObj.chapter_title || metaObj.part_title || "",
            page: parseInt(c.page) || 0,
            docHash: c.docHash,
            imagePath: c.imagePath || metaObj.imagePath || "",
            isVisualElement: metaObj.isVisualElement || false,
            metadata: c.metadata
          },
          vector: c.vector
        };
      })
    };

    // T22 (design D12, finding F-69): the one unbounded await on the write
    // path. Docling is bounded at 300 s and the embed call at 180 s; a store
    // that accepted the connection and never answered held T07's job lock
    // until a pod restart. 60 s per batch is the supersede's precedent; the
    // failure surfaces as the file's `failed` reason.
    let res;
    try {
      res = await fetch(`${this.url}/v1/batch/objects`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.batchInsertTimeoutMs)
      });
    } catch (err) {
      if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(
          `Failed to batch insert chunks into '${this.className}': the store did not answer within ` +
            `${this.batchInsertTimeoutMs / 1000} s (${payload.objects.length} objects). Nothing from this batch is confirmed.`
        );
      }
      throw err;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to batch insert chunks into '${this.className}': ${body}`);
    }
    
    const resData = await res.json();
    if (Array.isArray(resData)) {
      const failed = resData.find(obj => obj.result?.errors?.error);
      if (failed) {
        const errMsg = failed.result.errors.error.map(e => e.message).join(", ");
        console.error(`[Weaviate Batch Insert Error Details for ${this.className}]:`, errMsg);
        // T17 (design D14, F-72): the hint fires on the refusal Weaviate 1.25.6
        // actually sends — "new node has a vector with length 2560. Existing
        // nodes have vectors with length 4096" (t16-artifacts/t16-reverify-live.json)
        // — as well as the older "vector length mismatch" / "dimension" texts.
        // Before T17 neither substring matched and the person got the bare message.
        if (errMsg.includes("vector length mismatch") || errMsg.includes("dimension") || (/vector/i.test(errMsg) && /length/i.test(errMsg))) {
          throw new Error(`Weaviate batch insert failed: ${errMsg}. Please click the red 'Tidy Up RAG' button in the Standards drawer to reset collection '${this.className}' and retry.`);
        }
        throw new Error(`Weaviate batch insert failed: ${errMsg}`);
      }
    }
    return resData;
  }

  /**
   * The GraphQL for one search. `optionalFields` are the identity /
   * visual fields the class actually has (T05, design D3) — selecting one
   * the class lacks fails the whole query (verified, §0 of t05-design.md).
   *
   * T40 (design D2, D4; audit E23): `searchProperties` is the property list
   * the KEYWORD half scores — written as `properties: [...]` into the `bm25`
   * clause and into the `hybrid` clause (its keyword half; the vector half is
   * untouched, as Weaviate defines it), never into `nearVector`. An array is
   * sent as given; null (or nothing) sends no clause — the pre-T40 query,
   * every searchable property. The caller (searchFiltered) has already
   * intersected the list with the class's own properties.
   */
  buildSearchQuery(queryText, queryVector, searchStrategy, limit, alpha, optionalFields, where = null, searchProperties = null) {
    const hasVector = Array.isArray(queryVector) && queryVector.length > 0;
    const base = BASE_SELECT_FIELDS;
    const fields = base.concat(optionalFields.filter((f) => !base.includes(f)));
    const propertyList = Array.isArray(searchProperties) && searchProperties.length > 0 ? searchProperties.map(String) : null;
    const propertiesClause = propertyList ? ` properties: ${JSON.stringify(propertyList)}` : "";
    let args;
    let additional;
    let mode;
    if (searchStrategy === "vector" && hasVector) {
      mode = "vector";
      args = `nearVector: { vector: ${JSON.stringify(queryVector)} }`;
      additional = "distance";
    } else if (searchStrategy === "keyword" || !hasVector) {
      mode = "keyword";
      args = `bm25: { query: ${JSON.stringify(queryText)}${propertiesClause} }`;
      additional = "score";
    } else {
      mode = "hybrid";
      args = `hybrid: { query: ${JSON.stringify(queryText)} vector: ${JSON.stringify(queryVector)} alpha: ${alpha}${propertiesClause} }`;
      additional = "distance score";
    }
    const query = `{
      Get {
        ${this.className} (
          ${args}
          limit: ${limit}${where ? `
          where: ${where}` : ""}
        ) {
          ${fields.join("\n          ")}
          _additional { ${additional} }
        }
      }
    }`;
    // T40: what the keyword half was asked to score — the list sent, or null
    // (unrestricted, or no keyword half at all in vector mode).
    return { query, mode, fields, searchProperties: mode === "vector" ? null : propertyList };
  }

  async search(queryText, queryVector, searchStrategy, limit, similarityThreshold, alpha = 0.5, options = {}) {
    const { rows } = await this.searchFiltered(queryText, queryVector, searchStrategy, limit, similarityThreshold, alpha, null, options);
    return rows;
  }

  /**
   * T15 (design D4): the `where` for an optional document filter. Keyed on
   * `sourceId` (whole-value match) when the class has the property and the
   * filter names ids; else on `source` — a TOKEN match on the v1 property
   * (F-109) that the caller must post-check exactly. An `Or` of `Equal`
   * clauses (the shape T28's page read uses). Returns { where, applied }.
   */
  static documentWhere(filter, props) {
    if (!filter || typeof filter !== "object") return { where: null, applied: null };
    const ids = Array.isArray(filter.sourceIds) ? filter.sourceIds.filter((x) => typeof x === "string" && x) : [];
    const names = Array.isArray(filter.sources) ? filter.sources.filter((x) => typeof x === "string" && x) : [];
    if (ids.length > 0 && props.has("sourceId")) {
      const clauses = ids.map((id) => `{ path: ["sourceId"], operator: Equal, valueText: ${gqlString(id)} }`);
      return { where: clauses.length === 1 ? clauses[0] : `{ operator: Or, operands: [ ${clauses.join(", ")} ] }`, applied: "sourceId" };
    }
    if (names.length > 0) {
      const clauses = names.map((n) => `{ path: ["source"], operator: Equal, valueText: ${gqlString(n)} }`);
      return { where: clauses.length === 1 ? clauses[0] : `{ operator: Or, operands: [ ${clauses.join(", ")} ] }`, applied: "source" };
    }
    return { where: null, applied: null };
  }

  /**
   * search() with an optional document filter (T15). Returns the rows and
   * which property carried the filter (`applied`: "sourceId" | "source" |
   * null) so the route can post-check and report it (T13: measured).
   *
   * T40 (design D2, D3, D5): `options.searchProperties` is the property list
   * the keyword half scores — an array (intersected here with what THIS class
   * has, since a name the class lacks would fail the whole query, the E24
   * lesson; an intersection that empties out falls back to `text`, which every
   * class has), null for unrestricted (the pre-T40 clause), or absent for the
   * resolver's default. The return also carries `mode` and the list actually
   * sent (`searchProperties`), for the route's report.
   */
  async searchFiltered(queryText, queryVector, searchStrategy, limit, similarityThreshold, alpha = 0.5, documentFilter = null, { searchProperties } = {}) {
    const headers = this.getHeaders();
    const requested = searchProperties === undefined ? RETRIEVAL_DEFAULTS.searchProperties : searchProperties;

    // T05 (E24, E08): select isVisualElement / imagePath / chunkIndex /
    // docVersion / sourceId in EVERY mode — but only those the class has.
    let result = null;
    let applied = null;
    let mode = null;
    let sentProperties = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const props = await this.classProperties({ refresh: attempt > 0 });
      const optional = OPTIONAL_SELECT_FIELDS.filter((f) => props.has(f));
      const filter = WeaviateClient.documentWhere(documentFilter, props);
      applied = filter.applied;
      let effectiveProperties = null;
      if (requested !== null) {
        const wanted = Array.isArray(requested) ? requested.filter((p) => typeof p === "string" && p) : [];
        const have = wanted.filter((p) => props.has(p));
        effectiveProperties = have.length > 0 ? have : ["text"];
      }
      const built = this.buildSearchQuery(queryText, queryVector, searchStrategy, limit, alpha, optional, filter.where, effectiveProperties);
      const { query } = built;
      mode = built.mode;
      sentProperties = built.searchProperties;

      const res = await fetch(`${this.url}/v1/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query })
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Weaviate search failed for collection '${this.className}': ${body}`);
      }

      result = await res.json();

      // GraphQL errors arrive inside an HTTP 200. Reading only data.Get used to
      // convert a loud refusal (e.g. "vector lengths don't match") into a silent
      // empty result set — the false-absence mechanism of F-19. Surface them.
      if (Array.isArray(result?.errors) && result.errors.length > 0) {
        const msg = result.errors.map(e => e?.message || JSON.stringify(e)).join("; ");
        // An unknown field means the cached shape is stale (the class was
        // dropped and recreated). Refresh once and retry; a second failure
        // is reported like any other.
        if (attempt === 0 && /Cannot query field/i.test(msg)) {
          console.warn(`[Weaviate search] '${this.className}' no longer has a selected field (${msg}); refreshing the class schema and retrying once.`);
          continue;
        }
        throw new Error(`Weaviate GraphQL error for collection '${this.className}': ${msg}`);
      }
      break;
    }

    const items = result?.data?.Get?.[this.className] || [];

    return {
      rows: filterBySimilarity(
        items.map((item) => this.projectRow(item)),
        searchStrategy,
        similarityThreshold
      ),
      applied,
      // T40: the mode that ran and the property list the keyword half was
      // asked to score (null: unrestricted, or no keyword half).
      mode,
      searchProperties: sentProperties,
    };
  }

  /**
   * ONE projection for every row this client returns — search() and T28's
   * page / document reads — so a companion has exactly the shape a ranked
   * chunk has. Stored booleans and identity fields when the class has them,
   * null otherwise; similarity and score derived from `_additional` only
   * when present, never fabricated (F-8).
   */
  projectRow(item) {
    let metaObj = {};
    try {
      metaObj = JSON.parse(item.metadata || "{}");
    } catch (e) {}

    return {
      text: item.text,
      source: item.source,
      fileType: item.fileType,
      chapter: item.chapter,
      sectionNumber: item.sectionNumber,
      sectionTitle: item.sectionTitle,
      page: item.page,
      imagePath: item.imagePath || metaObj.imagePath || null,
      // The STORED boolean, now that it is selected (E24). Pre-T05 this
      // was `false` on every row because the selection never asked.
      isVisualElement: item.isVisualElement === true,
      // T05 identity fields: the stored value, or null on a class that
      // has no such property ("no such fact", the similarity convention).
      chunkIndex: typeof item.chunkIndex === "number" ? item.chunkIndex : null,
      docVersion: typeof item.docVersion === "string" && item.docVersion ? item.docVersion : null,
      sourceId: typeof item.sourceId === "string" && item.sourceId ? item.sourceId : null,
      metadata: item.metadata,
      // Derived, never fabricated: hybrid/BM25 rows carry no distance, so
      // they have no similarity (null) — not a fake 1.0 (F-8).
      similarity: similarityFromDistance(item._additional?.distance),
      score: item._additional?.score ? parseFloat(item._additional.score) : null
    };
  }

  /**
   * T28: a filtered read — `Get` with a `where` built by `whereFor(props)`
   * (it receives the class's property set so a filter never names a field
   * the class lacks), the same field projection as search(), the same
   * schema-refresh-once retry and the same GraphQL-errors-inside-200
   * surfacing (F-19). Not a search: no vector, no ranking, no score.
   */
  async fetchWhere(whereFor, { limit, what = "read" } = {}) {
    const headers = this.getHeaders();
    const cap = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 10000) : 100;
    let result = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const props = await this.classProperties({ refresh: attempt > 0 });
      const optional = OPTIONAL_SELECT_FIELDS.filter((f) => props.has(f));
      const fields = BASE_SELECT_FIELDS.concat(optional.filter((f) => !BASE_SELECT_FIELDS.includes(f)));
      const where = whereFor(props);
      const query = `{ Get { ${this.className}(where: ${where}, limit: ${cap}) { ${fields.join(" ")} _additional { id } } } }`;
      const res = await fetch(`${this.url}/v1/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS)
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Weaviate ${what} failed for collection '${this.className}': ${body.slice(0, 300)}`);
      }
      result = await res.json();
      if (Array.isArray(result?.errors) && result.errors.length > 0) {
        const msg = result.errors.map((e) => e?.message || JSON.stringify(e)).join("; ");
        if (attempt === 0 && /Cannot query field/i.test(msg)) {
          console.warn(`[Weaviate ${what}] '${this.className}' no longer has a selected field (${msg}); refreshing the class schema and retrying once.`);
          continue;
        }
        throw new Error(`Weaviate GraphQL error on ${what} for collection '${this.className}': ${msg}`);
      }
      break;
    }
    const items = result?.data?.Get?.[this.className];
    if (!Array.isArray(items)) throw new Error(`Weaviate ${what} returned no rows array for '${this.className}': ${JSON.stringify(result).slice(0, 200)}`);
    return items.map((item) => this.projectRow(item));
  }

  /**
   * T28: the `And(document, page)` filter for one page. Keys on `sourceId`
   * (v2, `field`-tokenised — an exact match) when the class has it and the
   * caller knows it, else on `source` — which is `word`-tokenised, so
   * `Equal` is a TOKEN match ("SitePlan" matches the Site Plan; F-109). The
   * caller post-checks `source` exactly either way (companions.js rule 2).
   */
  static pageFilter(page, props) {
    const useSourceId = props.has("sourceId") && typeof page.sourceId === "string" && page.sourceId;
    const docClause = useSourceId
      ? `{ path: ["sourceId"], operator: Equal, valueText: ${gqlString(page.sourceId)} }`
      : `{ path: ["source"], operator: Equal, valueText: ${gqlString(page.source)} }`;
    const pageClause = `{ path: ["page"], operator: Equal, valueInt: ${Math.floor(Number(page.page))} }`;
    return `{ operator: And, operands: [ ${docClause}, ${pageClause} ] }`;
  }

  /**
   * T28: every chunk of the given `(source, page)` pairs — one `Get`, an
   * `Or` of `And(document, page)` clauses (measured 3 ms for two pages on
   * the production class). Returns the store's rows; exact source equality
   * is the caller's check (F-109).
   */
  async fetchPageChunks(pages) {
    const list = (Array.isArray(pages) ? pages : []).filter((p) => p && typeof p.source === "string" && p.source && Number.isInteger(Number(p.page)) && Number(p.page) > 0);
    if (list.length === 0) return [];
    const whereFor = (props) => {
      const clauses = list.map((p) => WeaviateClient.pageFilter(p, props));
      return clauses.length === 1 ? clauses[0] : `{ operator: Or, operands: [ ${clauses.join(", ")} ] }`;
    };
    return this.fetchWhere(whereFor, { limit: list.length * 64, what: "page read" });
  }

  /**
   * T28: every chunk of one document (design §13.1 step 3). `limit` should
   * be the store's chunk count for the document (the summary's) plus a
   * margin; the caller compares the rows read against that count before
   * claiming complete coverage. Keys on `sourceId` when possible (F-109).
   */
  async fetchDocumentChunks({ source, sourceId = null, limit } = {}) {
    if (typeof source !== "string" || !source) throw new Error("fetchDocumentChunks needs a source");
    const whereFor = (props) => {
      const useSourceId = props.has("sourceId") && typeof sourceId === "string" && sourceId;
      return useSourceId
        ? `{ path: ["sourceId"], operator: Equal, valueText: ${gqlString(sourceId)} }`
        : `{ path: ["source"], operator: Equal, valueText: ${gqlString(source)} }`;
    };
    const rows = await this.fetchWhere(whereFor, { limit: Number.isFinite(limit) && limit > 0 ? limit : 2000, what: "document read" });
    // Exact equality here as well as in the module: a token-matched sibling
    // document must never be counted as coverage of this one.
    return rows.filter((r) => r.source === source);
  }

  /**
   * Dimensionality of the vectors this collection actually holds, from the
   * first stored object. Null when the collection is empty or unreadable —
   * callers treat that as "cannot judge", never as a match. Cached per
   * (url, class); pass {refresh: true} to bypass a possibly-stale entry
   * (e.g. right after a re-ingest with a different embedding model).
   */
  async getVectorDimension({ refresh = false } = {}) {
    const cacheKey = `${this.url}|${this.className}`;
    if (!refresh && vectorDimCache.has(cacheKey)) return vectorDimCache.get(cacheKey);

    try {
      const res = await fetch(`${this.url}/v1/graphql`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          query: `{ Get { ${this.className}(limit: 1) { _additional { vector } } } }`
        }),
        // T22 (design D12, finding F-76): the one read on this client that had
        // no bound — a store that accepts and never answers hung the retrieve
        // before any search, and the ingest before any job.
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) return null;
      const data = await res.json();
      const vector = data?.data?.Get?.[this.className]?.[0]?._additional?.vector;
      const dim = Array.isArray(vector) && vector.length > 0 ? vector.length : null;
      if (dim) vectorDimCache.set(cacheKey, dim);
      return dim;
    } catch (err) {
      // Best-effort guard: the search path's surfaced GraphQL errors remain
      // the authoritative failure signal.
      return null;
    }
  }

  /**
   * Whether any object in this class carries `docHash`. Read-only, so the
   * plain client may ask (the ingest route's "skip" policy is the caller).
   *
   * T03 (audit E04 / FM-D1): the query used to quote the operator —
   * `operator: "Equal"` — which GraphQL will not coerce in literal position.
   * Experiment X1 (2026-09-04, Weaviate 1.25.6, a hash that WAS present)
   * answered HTTP 200 with `errors[]` and no `data`:
   *   In field "operator": Expected type
   *   "AggregateObjectsRAGEval_t08_20260813WhereOperatorEnum", found "Equal".
   * The old `|| 0` read that as "not present", nothing was logged, and every
   * re-ingest under the default "skip" policy re-embedded every file.
   *
   * Contract (design D1): a numeric meta.count is Weaviate's answer (>0 is
   * present, and the count is logged so a skipped document's size is on
   * record — F-48). GraphQL errors, a non-JSON 200, or a 200 without a
   * numeric count THROW — as countObjects does — because a fabricated "not
   * present" is the defect this fixes; in the ingest route that throw is
   * caught by the job's catch and the job finishes `error` / INGEST_FAILED
   * with this message, before any delete or insert has run. A transport
   * failure (fetch throws, non-2xx, the 10 s timeout) keeps the ticket's
   * log-and-return-false: the ingest then re-embeds, which is the pre-T03
   * cost, not a wrong answer.
   */
  async checkDocHashExists(docHash) {
    const headers = this.getHeaders();
    // The operator is a GraphQL enum and MUST be unquoted; the hash is
    // serialised as a JSON string literal so it can never break the document.
    const gqlQuery = `{
      Aggregate {
        ${this.className} (
          where: {
            path: ["docHash"]
            operator: Equal
            valueText: ${JSON.stringify(String(docHash))}
          }
        ) {
          meta {
            count
          }
        }
      }
    }`;

    // Transport only. Everything after this block is Weaviate's answer or
    // evidence that the question was invalid — neither may become "absent".
    let res;
    try {
      res = await fetch(`${this.url}/v1/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: gqlQuery }),
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
        console.error(`[Weaviate checkDocHashExists Failed for ${this.className}]: HTTP ${res.status} ${body}`);
        return false;
      }
    } catch (e) {
      console.error(`[Weaviate checkDocHashExists Failed for ${this.className}]:`, e.message);
      return false;
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error(
        `Weaviate duplicate check returned a non-JSON 200 for '${this.className}' (no meta.count): ${e.message}`
      );
    }
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      throw new Error(
        `Weaviate duplicate check failed for collection '${this.className}': ` +
          data.errors.map((err) => err?.message || JSON.stringify(err)).join("; ")
      );
    }
    const count = data?.data?.Aggregate?.[this.className]?.[0]?.meta?.count;
    if (typeof count !== "number") {
      throw new Error(
        `Weaviate duplicate check returned no meta.count for '${this.className}': ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    if (count > 0) {
      console.log(`[Weaviate checkDocHashExists] ${count} chunk(s) in '${this.className}' already carry docHash ${docHash}; the ingest route will skip this file (duplicatePolicy "skip")`);
    }
    return count > 0;
  }

  /**
   * Whether any object in this class carries this (sourceId, docVersion) —
   * the schema-v2 duplicate check (T05, design D2 / F-50). Same contract as
   * checkDocHashExists (T03 D1): a numeric count is Weaviate's answer and a
   * positive one is logged; GraphQL errors, a non-JSON 200 or a missing
   * count THROW (the ingest job finishes INGEST_FAILED before any delete or
   * insert); a transport failure logs and returns false (the file is then
   * re-indexed, which is a cost, not a wrong answer). Kept as a sibling
   * rather than folded into checkDocHashExists so that method stays exactly
   * as U-DEDUPE pinned it.
   */
  async checkIdentityExists(sourceId, docVersion) {
    const headers = this.getHeaders();
    const gqlQuery = `{
      Aggregate {
        ${this.className} (
          where: {
            operator: And
            operands: [
              { path: ["sourceId"], operator: Equal, valueText: ${JSON.stringify(String(sourceId))} },
              { path: ["docVersion"], operator: Equal, valueText: ${JSON.stringify(String(docVersion))} }
            ]
          }
        ) {
          meta {
            count
          }
        }
      }
    }`;

    let res;
    try {
      res = await fetch(`${this.url}/v1/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: gqlQuery }),
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
        console.error(`[Weaviate checkIdentityExists Failed for ${this.className}]: HTTP ${res.status} ${body}`);
        return false;
      }
    } catch (e) {
      console.error(`[Weaviate checkIdentityExists Failed for ${this.className}]:`, e.message);
      return false;
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error(
        `Weaviate duplicate check returned a non-JSON 200 for '${this.className}' (no meta.count): ${e.message}`
      );
    }
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      throw new Error(
        `Weaviate duplicate check failed for collection '${this.className}': ` +
          data.errors.map((err) => err?.message || JSON.stringify(err)).join("; ")
      );
    }
    const count = data?.data?.Aggregate?.[this.className]?.[0]?.meta?.count;
    if (typeof count !== "number") {
      throw new Error(
        `Weaviate duplicate check returned no meta.count for '${this.className}': ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    if (count > 0) {
      console.log(`[Weaviate checkIdentityExists] ${count} chunk(s) in '${this.className}' already carry sourceId ${sourceId} at docVersion ${docVersion}; the ingest route will skip this file (duplicatePolicy "skip")`);
    }
    return count > 0;
  }

  /**
   * How much of `(sourceId, docVersion)` the class holds — ticket T07
   * (design D4, the completion cross-check): the object count and the
   * highest chunkIndex in ONE Aggregate (verified on 1.25.6, t07-artifacts
   * step 5). With deterministic ids, `count === n && maxChunkIndex === n - 1`
   * is exactly the indices 0..n-1: nothing missing, no stale tail. A partial
   * is contiguous too (0..k-1), so the count alone cannot tell 32-of-89 from
   * 89-of-89 — the ledger's recorded n is what the caller compares against.
   *
   * Contract as checkIdentityExists (T03 D1 / T05 D2): a transport failure
   * logs and returns null ("unknown" — the caller re-indexes, a cost, never
   * a fabricated match); a GraphQL error, a non-JSON 200 or a missing count
   * THROWS. v2 classes only (the query names chunkIndex).
   */
  async countIdentity(sourceId, docVersion) {
    const headers = this.getHeaders();
    const gqlQuery = `{
      Aggregate {
        ${this.className} (
          where: {
            operator: And
            operands: [
              { path: ["sourceId"], operator: Equal, valueText: ${JSON.stringify(String(sourceId))} },
              { path: ["docVersion"], operator: Equal, valueText: ${JSON.stringify(String(docVersion))} }
            ]
          }
        ) {
          meta { count }
          chunkIndex { count maximum }
        }
      }
    }`;

    let res;
    try {
      res = await fetch(`${this.url}/v1/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: gqlQuery }),
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
        console.error(`[Weaviate countIdentity Failed for ${this.className}]: HTTP ${res.status} ${body}`);
        return null;
      }
    } catch (e) {
      console.error(`[Weaviate countIdentity Failed for ${this.className}]:`, e.message);
      return null;
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error(`Weaviate completion check returned a non-JSON 200 for '${this.className}' (no meta.count): ${e.message}`);
    }
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      throw new Error(
        `Weaviate completion check failed for collection '${this.className}': ` +
          data.errors.map((err) => err?.message || JSON.stringify(err)).join("; ")
      );
    }
    const row = data?.data?.Aggregate?.[this.className]?.[0];
    const count = row?.meta?.count;
    if (typeof count !== "number") {
      throw new Error(`Weaviate completion check returned no meta.count for '${this.className}': ${JSON.stringify(data).slice(0, 200)}`);
    }
    const max = row?.chunkIndex?.maximum;
    return { count, maxChunkIndex: typeof max === "number" ? max : null };
  }

  /**
   * T65 (t65-design.md D3 (a), §0b): which documents' stored text holds each word — the census a question's names are
   * read against. One GraphQL Aggregate per word: a token filter on `text` (`Equal` on the `word`-tokenised property is
   * a token match, F-109's rule) grouped by `source` — measured equal to a full read of every chunk on 17 words, at
   * 2–6 ms a word. Returns { word (lower-cased): [source, …] }, most chunks first. A store stop word comes back refused
   * ("only stopwords provided") and is read as held by no document; any other failure throws — the caller degrades
   * (F-25). Read-only.
   */
  async documentsHolding(words, { timeoutMs = READ_TIMEOUT_MS } = {}) {
    const list = [...new Set((Array.isArray(words) ? words : []).map((w) => String(w ?? "").toLowerCase()).filter((w) => /^[a-z0-9]+$/.test(w)))];
    const out = {};
    for (const w of list) {
      const query = `{ Aggregate { ${this.className}(where: { path: ["text"], operator: Equal, valueText: ${gqlString(w)} }, groupBy: ["source"]) { groupedBy { value } meta { count } } } }`;
      const res = await fetch(`${this.url}/v1/graphql`, { method: "POST", headers: this.getHeaders(), body: JSON.stringify({ query }), signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`documentsHolding: HTTP ${res.status} for "${w}"`);
      const data = await res.json();
      if (Array.isArray(data?.errors) && data.errors.length > 0) {
        if (data.errors.every((e) => /only stopwords provided/i.test(String(e?.message ?? "")))) {
          out[w] = [];
          continue;
        }
        throw new Error(`documentsHolding: GraphQL error for "${w}": ${JSON.stringify(data.errors).slice(0, 200)}`);
      }
      const groups = data?.data?.Aggregate?.[this.className] || [];
      out[w] = groups
        .map((g) => ({ source: g?.groupedBy?.value, count: g?.meta?.count || 0 }))
        .filter((g) => typeof g.source === "string" && g.source && g.count > 0)
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
        .map((g) => g.source);
    }
    return out;
  }

  /**
   * T15 (design D11; F-115): the per-document summary WITH the v2 identity.
   * On a class that has `sourceId` one Aggregate grouped by it gives each
   * document's chunk count, its max page and its `source` (the group's top
   * occurrence — one file, one name); rows are then merged by `source` so
   * the shape is getDatabaseSummary()'s plus `sourceIds: [...]`. On a v1
   * class (no `sourceId`) it IS getDatabaseSummary() with `sourceIds: []`.
   * Read-only; a failure is an empty list, as the summary has always been.
   */
  async getDocumentSummary() {
    try {
      const props = await this.classProperties();
      if (!props.has("sourceId")) return (await this.getDatabaseSummary()).map((d) => ({ ...d, sourceIds: [] }));
      const query = `{
        Aggregate {
          ${this.className}(groupBy: ["sourceId"]) {
            groupedBy { value }
            meta { count }
            page { maximum }
            source { topOccurrences(limit: 1) { value occurs } }
          }
        }
      }`;
      const res = await fetch(`${this.url}/v1/graphql`, { method: "POST", headers: this.getHeaders(), body: JSON.stringify({ query }), signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
      if (!res.ok) {
        console.error(`[Weaviate getDocumentSummary Failed for ${this.className}]:`, await res.text());
        return [];
      }
      const data = await res.json();
      if (Array.isArray(data?.errors) && data.errors.length > 0) {
        console.error(`[Weaviate getDocumentSummary GraphQL error for ${this.className}]:`, JSON.stringify(data.errors).slice(0, 300));
        return (await this.getDatabaseSummary()).map((d) => ({ ...d, sourceIds: [] }));
      }
      const groups = data?.data?.Aggregate?.[this.className] || [];
      const bySource = new Map();
      for (const g of groups) {
        const sourceId = g?.groupedBy?.value;
        const source = g?.source?.topOccurrences?.[0]?.value;
        if (!source) continue;
        if (!bySource.has(source)) bySource.set(source, { source, chunkCount: 0, totalPages: 0, sourceIds: [] });
        const row = bySource.get(source);
        row.chunkCount += g?.meta?.count || 0;
        row.totalPages = Math.max(row.totalPages, g?.page?.maximum || 0);
        if (typeof sourceId === "string" && sourceId) row.sourceIds.push(sourceId);
      }
      return [...bySource.values()];
    } catch (err) {
      console.error(`[Weaviate getDocumentSummary Exception for ${this.className}]:`, err.message);
      return [];
    }
  }

  async getDatabaseSummary() {
    try {
      const headers = this.getHeaders();
      const gqlQuery = `{
        Aggregate {
          ${this.className}(groupBy: ["source"]) {
            groupedBy {
              value
            }
            meta {
              count
            }
            page {
              maximum
            }
          }
        }
      }`;

      const res = await fetch(`${this.url}/v1/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: gqlQuery }),
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[Weaviate getDatabaseSummary Failed for ${this.className}]:`, body);
        return [];
      }

      const data = await res.json();
      const items = data?.data?.Aggregate?.[this.className] || [];
      return items.map(item => ({
        source: item.groupedBy?.value,
        chunkCount: item.meta?.count || 0,
        totalPages: item.page?.maximum || 0
      }));
    } catch (err) {
      console.error(`[Weaviate getDatabaseSummary Exception for ${this.className}]:`, err.message);
      return [];
    }
  }

  /**
   * Drop this class and recreate it empty. Destructive: runs only on a client
   * from forDestructiveOps().
   *
   * Failure is SURFACED (F-15, T21 D7). Before this ticket a failed DELETE was
   * console.warn'ed and ensureSchema() ran anyway, so the caller reported
   * "reset successfully" whether or not the drop happened.
   *
   * Three steps, each typed on failure:
   *   1. existence — by GET. Weaviate's DELETE is idempotent (200 for an
   *      absent class on current builds, 400 on old ones), so its status
   *      cannot say whether anything was dropped; GET 200/404 can.
   *   2. drop — only if it existed. Any non-2xx, or a refused connection, is
   *      DESTRUCTIVE_OP_FAILED "not dropped"; a failure AFTER the request was
   *      sent is reported as unknown, never as "not dropped".
   *   3. recreate — via ensureSchema(). If that fails after a successful drop
   *      the error says so and carries `completed: ["drop"]`, because a class
   *      that is gone must never be reported as "nothing happened" (F-25).
   *
   * @returns {{dropped: boolean, recreated: boolean}} `dropped` is false when
   *   the class did not exist.
   */
  async clearSchema() {
    this.assertDestructiveClient("clearSchema");
    const headers = this.getHeaders();
    const cls = this.className;

    console.log(`[Weaviate Store Purge] Purging collection class '${cls}'...`);

    // 1. existence
    let existed;
    try {
      const check = await fetch(`${this.url}/v1/schema/${cls}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(30000)
      });
      if (check.status === 200) existed = true;
      else if (check.status === 404) existed = false;
      else {
        throw codedError(
          INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED,
          `Could not determine whether collection '${cls}' exists (HTTP ${check.status}): ${await check.text()}. Nothing was dropped.`
        );
      }
    } catch (e) {
      if (e.code) throw e;
      throw codedError(
        INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED,
        `Could not reach Weaviate to check collection '${cls}': ${e.message}. Nothing was dropped.`
      );
    }

    // 2. drop
    let dropped = false;
    if (existed) {
      let res;
      try {
        res = await fetch(`${this.url}/v1/schema/${cls}`, {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(60000)
        });
      } catch (e) {
        throw codedError(
          INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED,
          connectionRefused(e)
            ? `Could not drop collection '${cls}': ${e.message}. The collection was not dropped and was not recreated.`
            : `The drop request for collection '${cls}' was sent but no reply arrived (${e.message}). ` +
              `It may or may not have been dropped — run the preview to check before retrying.`
        );
      }
      if (!res.ok) {
        const body = await res.text();
        throw codedError(
          INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED,
          `Weaviate refused to drop collection '${cls}' (HTTP ${res.status}): ${body}. The collection was not dropped and was not recreated.`
        );
      }
      dropped = true;
      // The class is gone: any cached shape or dimensionality is stale.
      classPropertyCache.delete(`${this.url}|${cls}`);
      vectorDimCache.delete(`${this.url}|${cls}`);
      console.log(`[Weaviate Store Purge] Successfully dropped collection '${cls}'.`);
    } else {
      console.log(`[Weaviate Store Purge] Collection '${cls}' did not exist; nothing dropped.`);
    }

    // 3. recreate
    try {
      await this.ensureSchema();
    } catch (e) {
      throw codedError(
        INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED,
        dropped
          ? `Collection '${cls}' WAS dropped but could not be recreated: ${e.message}. Its objects are gone; the class must be recreated before the next ingest.`
          : `Collection '${cls}' did not exist and could not be created: ${e.message}.`,
        { completed: dropped ? ["drop"] : ["drop (collection was absent)"] }
      );
    }
    return { dropped, recreated: true };
  }
}

module.exports = {
  WeaviateClient,
  canonicalClassName,
  isExplicitClassName,
  connectionRefused,
  // T22 (design D12): the default per-batch insert bound (U-TIMEOUT pins it).
  BATCH_INSERT_TIMEOUT_MS,
  V1_PROPERTIES,
  V2_EXTRA_PROPERTIES,
  OPTIONAL_SELECT_FIELDS,
  // Test seam (U-SCHEMA): the per-class property cache is module state.
  _classPropertyCache: classPropertyCache
};
