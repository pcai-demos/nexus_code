/**
 * I-IDEMPOTENT / I-VERSION / I-COUNT / I-FAILMODE (evaluation-plan §4.2, §4.3, §4.6, §4.7).
 *
 * Mixed: I-COUNT (T09), I-IDEMPOTENT's skip case (T03) and its v2 case (T05)
 * and I-VERSION (T06) are LIVE; the rest are skeletons, each owned by the
 * ticket that makes it assertable (T12). They were grouped in one file when none could be implemented; the
 * live cases stay here so the evaluation-plan numbering maps to one place.
 *
 * Running this file: `node --test tests/integration/i-lifecycle.test.js`.
 * Node 20's `--test-name-pattern` skipped every case here, including the
 * target, as "does not match pattern" (recorded in t03-artifacts).
 *
 * Class shapes (cut-over, design D12): the server defaults to schemaVersion
 * 2 since the cut-over, so every request here STATES its version. The v2 and
 * I-VERSION cases send 2 (as they always did); the T03 skip case is a v1
 * class by definition and sends 1; I-COUNT reads the populated
 * RAG_EVAL_COLLECTION under RAG_EVAL_SCHEMA_VERSION (default 1: the T08 class).
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  skipReason,
  envConfig,
  postJson,
  waitForIngestion,
  assertEvalCollection,
  evalSchemaVersion,
  makeRunCollection,
} = require("./_harness");
const { corpusEntries } = require("../unit/_helpers");
const { WeaviateClient } = require("../../src/lib/vectordb/weaviate");

const SKIP = skipReason();

describe("I-IDEMPOTENT: re-ingestion does not duplicate (§4.2)", () => {
  /**
   * I-IDEMPOTENT v2 case — implemented by ticket T05 (2026-09-04).
   *
   * Before T05, batchInsert sent no `id` (audit E25): every object got a
   * random UUID, and "re-ingest does not duplicate" was true only because
   * delete-by-hash ran first (FM-D2). Measured live 2026-09-04: the same
   * object POSTed twice without an id → two objects; with the same id → one.
   *
   * Under schemaVersion 2 every object's id is uuidv5(sourceId:docVersion:
   * chunkIndex). This case ingests the four T08 documents twice into a fresh
   * RAGEval_<runId>_idemv2 (class …_idemv2V2) under duplicatePolicy
   * "overwrite" — under "skip" the second run never reaches batchInsert
   * (T03's gate, its own case above) — and asserts (design D9):
   *   1. no duplicates: after the second run, objects === chunksIndexed;
   *   2. identity is stable: for every (source, chunkIndex) present in both
   *      runs, the stored id is identical across runs;
   *   3. identity is honest: every stored id equals uuidv5 of the object's
   *      OWN stored sourceId / docVersion / chunkIndex, and chunkIndex runs
   *      0..n-1 per document;
   *   4. every stored object carries the v2 properties.
   * The ticket's literal "identical object count" is REPORTED, not asserted
   * alone: T03's before leg produced 100 then 102 chunks from identical
   * bytes (VLM caption sampling, T24), which identity cannot remove.
   * Torn down by a direct schema DELETE (F-39).
   */
  test("re-ingesting the same corpus under schema v2 yields the same ids and no duplicates", { skip: SKIP }, async (t) => {
    const cfg = envConfig();
    const { chunkIdFor, sourceIdFor } = require("../../src/lib/rag/ids");
    const base = makeRunCollection("idemv2");
    const collection = `${base}V2`;
    assert.match(collection, /^RAGEval_[A-Za-z0-9_]+_idemv2V2$/);

    const sources = (
      process.env.RAG_EVAL_SOURCES ||
      "Barratt_Homes-SaxonFields.pdf,Barratt_Homes_SitePlan.pdf,GraemeHick.pdf,SSX125_Manual.pdf"
    )
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const filePaths = corpusEntries()
      .filter((e) => sources.includes(e.fileName))
      .map((e) => e.sourceId.replace(/^public\//, ""));
    assert.strictEqual(filePaths.length, sources.length, `manifest entries for ${sources.join(", ")}`);

    const client = new WeaviateClient(cfg.weaviateUrl, cfg.token, collection, { schemaVersion: 2 });
    const headers = { "Content-Type": "application/json" };
    if (cfg.token) headers["x-auth-token"] = cfg.token;
    const payload = () => ({
      filePaths,
      weaviateUrl: cfg.weaviateUrl,
      token: cfg.token,
      weaviateToken: cfg.token,
      embedUrl: cfg.embedUrl,
      embedModel: cfg.embedModel,
      // The BASE name: the route applies the V2 suffix itself (D6).
      weaviateCollection: base,
      ragSettings: {
        weaviateCollection: base,
        schemaVersion: 2,
        allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"],
        maxFileSize: 50,
        duplicatePolicy: "overwrite",
      },
    });

    async function readAll() {
      const res = await fetch(`${cfg.weaviateUrl}/v1/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: `{ Get { ${collection}(limit: 5000) { source sourceId docVersion chunkIndex engine isVisualElement _additional { id } } } }` }),
        signal: AbortSignal.timeout(60000),
      });
      const body = await res.json();
      assert.ok(!body.errors, `read-back failed: ${JSON.stringify(body.errors)}`);
      return body.data.Get[collection] || [];
    }

    async function ingestOnce(label) {
      const t0 = Date.now();
      const started = await postJson(`${cfg.appUrl}/api/ingest`, payload());
      assert.equal(started.status, 202, `${label}: ingest not accepted: ${started.text}`);
      const jobId = started.json?.jobId;
      assert.ok(jobId, `${label}: no jobId (F-18)`);
      const final = await waitForIngestion(cfg.appUrl, jobId, 1200000);
      const wallMs = Date.now() - t0;
      assert.equal(final.jobId, jobId, `${label}: status must report our job`);
      assert.equal(final.status, "completed", `${label}: ${final.status} ${final.error || ""} ${final.errorCode || ""}`);
      const objects = await client.countObjects();
      const rows = await readAll();
      t.diagnostic(`${label}: wall ${wallMs} ms, chunksIndexed ${final.chunksIndexed}, filesCompleted ${final.filesCompleted}/${final.totalFiles}, objects ${objects}, rows read ${rows.length}`);
      return { wallMs, final, objects, rows };
    }

    const cleanup = async () => {
      assertEvalCollection(collection);
      assert.match(collection, /_idemv2V2$/, "teardown may only drop this test's own class");
      try {
        const res = await fetch(`${cfg.weaviateUrl}/v1/schema/${collection}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
        t.diagnostic(`teardown: DELETE /v1/schema/${collection} → ${res.status}`);
      } catch (err) {
        console.warn(`[I-IDEMPOTENT v2 teardown] could not drop ${collection}: ${err.message}`);
      }
      // The route must not have created the base-named (v1) class.
      try {
        const res = await fetch(`${cfg.weaviateUrl}/v1/schema/${base}`, { headers, signal: AbortSignal.timeout(15000) });
        t.diagnostic(`base class ${base} after run: HTTP ${res.status} (404 expected)`);
      } catch (err) {
        console.warn(`[I-IDEMPOTENT v2] could not check ${base}: ${err.message}`);
      }
    };

    const keyOf = (r) => `${r.source}#${r.chunkIndex}`;
    const checkHonest = (label, rows) => {
      const perDoc = new Map();
      for (const r of rows) {
        assert.strictEqual(typeof r.sourceId, "string", `${label}: sourceId stored`);
        assert.match(r.docVersion || "", /^[0-9a-f]{32}\.[0-9a-f]{12}$/, `${label}: docVersion shape`);
        assert.ok(Number.isInteger(r.chunkIndex), `${label}: chunkIndex stored`);
        assert.strictEqual(typeof r.engine, "string", `${label}: engine stored`);
        assert.strictEqual(r._additional.id, chunkIdFor(r.sourceId, r.docVersion, r.chunkIndex), `${label}: ${keyOf(r)} id recomputes from its own fields`);
        if (!perDoc.has(r.source)) perDoc.set(r.source, { indices: [], sourceIds: new Set(), versions: new Set(), engines: new Set() });
        const d = perDoc.get(r.source);
        d.indices.push(r.chunkIndex);
        d.sourceIds.add(r.sourceId);
        d.versions.add(r.docVersion);
        d.engines.add(r.engine);
      }
      for (const [source, d] of perDoc) {
        const sorted = d.indices.slice().sort((a, b) => a - b);
        assert.deepStrictEqual(sorted, sorted.map((_, i) => i), `${label}: ${source} chunkIndex is 0..n-1 consecutive`);
        assert.strictEqual(d.sourceIds.size, 1, `${label}: ${source} has one sourceId`);
        assert.strictEqual(d.versions.size, 1, `${label}: ${source} has one docVersion`);
        const expectedSourceId = sourceIdFor(filePaths.find((p) => p.endsWith(`/${source}`) || p === source));
        assert.strictEqual([...d.sourceIds][0], expectedSourceId, `${label}: ${source} sourceId is the request path relative to public/`);
        t.diagnostic(`${label}: ${source}: ${d.indices.length} chunks, docVersion ${[...d.versions][0]}, engine ${[...d.engines].join("|")}`);
      }
      return perDoc;
    };

    try {
      const first = await ingestOnce("first");
      assert.ok(first.final.chunksIndexed > 0, "first ingest indexed nothing");
      assert.strictEqual(first.final.filesCompleted, filePaths.length, "first ingest: every file completed");
      assert.strictEqual(first.objects, first.final.chunksIndexed, "first ingest: objects === chunksIndexed");
      assert.strictEqual(first.rows.length, first.objects, "first ingest: read-back saw every object");
      checkHonest("first", first.rows);

      const second = await ingestOnce("second");
      assert.strictEqual(second.final.filesCompleted, filePaths.length, "second ingest: every file completed");
      assert.ok(second.final.chunksIndexed > 0, "second ingest under overwrite must re-index (a skip here would be T03's result, not T05's)");
      // 1. no duplicates
      assert.strictEqual(second.objects, second.final.chunksIndexed, "second ingest: objects === chunksIndexed (no duplicates, nothing stale)");
      assert.strictEqual(second.rows.length, second.objects);
      // 3./4. honest identity on every stored object
      checkHonest("second", second.rows);
      // 2. stable identity across runs on the common (source, chunkIndex) range
      const firstIds = new Map(first.rows.map((r) => [keyOf(r), r._additional.id]));
      const secondIds = new Map(second.rows.map((r) => [keyOf(r), r._additional.id]));
      let common = 0;
      for (const [key, id] of secondIds) {
        if (!firstIds.has(key)) continue;
        common += 1;
        assert.strictEqual(id, firstIds.get(key), `${key}: id differs between runs`);
      }
      assert.ok(common > 0, "no (source, chunkIndex) in common between the runs");
      const record = {
        collection,
        files: filePaths.length,
        first: { wallMs: first.wallMs, chunksIndexed: first.final.chunksIndexed, objects: first.objects },
        second: { wallMs: second.wallMs, chunksIndexed: second.final.chunksIndexed, objects: second.objects },
        commonIdentities: common,
        countIdentical: first.objects === second.objects,
        countDelta: second.objects - first.objects,
      };
      t.diagnostic(`I-IDEMPOTENT v2 record ${JSON.stringify(record)}`);
      if (process.env.RAG_EVAL_IDEM_V2_OUT) {
        require("fs").writeFileSync(process.env.RAG_EVAL_IDEM_V2_OUT, JSON.stringify(record, null, 2));
      }
    } finally {
      await cleanup();
    }
  });

  /**
   * I-IDEMPOTENT skip case — implemented by ticket T03 (2026-09-04).
   *
   * Before T03, checkDocHashExists built `operator: "Equal"` (a quoted enum in
   * literal position). Experiment X1, run live against Weaviate 1.25.6 on
   * RAGEval_t08_20260813 with a hash that IS present, returned HTTP 200 with
   * `errors[]` and no `data` ("Expected type
   * AggregateObjects…WhereOperatorEnum, found \"Equal\""), which `|| 0` read as
   * "not present". So "skip" re-parsed and re-embedded every file on every
   * re-ingest (audit E04 / FM-D1).
   *
   * The ticket's Tests line says "zero embed calls (assert via ledger counts
   * post-T07)". T07 is not built, so this is the ticket's own
   * INTERIM assertion: the object count is unchanged by the second ingest and
   * it completes in under 10% of the first run's time — plus two facts the
   * job status already carries, `chunksIndexed === 0` and every file completed.
   *
   * Runs on its own fresh RAGEval_<runId>_idem class built from the T08
   * documents (RAG_EVAL_SOURCES), and tears it down by a direct schema DELETE
   * behind assertEvalCollection: the harness's dropCollection() routes through
   * /api/ingest/clear, which recreates the class empty (F-39).
   */
  test('duplicatePolicy "skip" actually skips', { skip: SKIP }, async (t) => {
    const idemConfig = envConfig();
    const collection = makeRunCollection("idem");
    assert.match(collection, /^RAGEval_[A-Za-z0-9_]+_idem$/);

    const sources = (
      process.env.RAG_EVAL_SOURCES ||
      "Barratt_Homes-SaxonFields.pdf,Barratt_Homes_SitePlan.pdf,GraemeHick.pdf,SSX125_Manual.pdf"
    )
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const filePaths = corpusEntries()
      .filter((e) => sources.includes(e.fileName))
      .map((e) => e.sourceId.replace(/^public\//, ""));
    assert.strictEqual(filePaths.length, sources.length, `manifest entries for ${sources.join(", ")}`);

    const client = new WeaviateClient(idemConfig.weaviateUrl, idemConfig.token, collection);
    const payload = () => ({
      filePaths,
      weaviateUrl: idemConfig.weaviateUrl,
      token: idemConfig.token,
      weaviateToken: idemConfig.token,
      embedUrl: idemConfig.embedUrl,
      embedModel: idemConfig.embedModel,
      weaviateCollection: collection,
      ragSettings: {
        weaviateCollection: collection,
        // T03's case is a v1 class by definition (the hash-keyed skip); stated
        // since the cut-over made 2 the server default (design D12).
        schemaVersion: 1,
        allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"],
        maxFileSize: 50,
        duplicatePolicy: "skip",
      },
    });

    async function ingestOnce(label) {
      const t0 = Date.now();
      const started = await postJson(`${idemConfig.appUrl}/api/ingest`, payload());
      assert.equal(started.status, 202, `${label}: ingest not accepted: ${started.text}`);
      const jobId = started.json?.jobId;
      assert.ok(jobId, `${label}: no jobId (F-18)`);
      const final = await waitForIngestion(idemConfig.appUrl, jobId, 1200000);
      const wallMs = Date.now() - t0;
      assert.equal(final.jobId, jobId, `${label}: status must report our job`);
      assert.equal(final.status, "completed", `${label}: ${final.status} ${final.error || ""} ${final.errorCode || ""}`);
      const objects = await client.countObjects();
      t.diagnostic(
        `${label}: wall ${wallMs} ms, elapsedSeconds ${final.elapsedSeconds}, chunksIndexed ${final.chunksIndexed}, ` +
          `filesCompleted ${final.filesCompleted}/${final.totalFiles}, objects ${objects}`
      );
      return { wallMs, final, objects };
    }

    // Teardown must never mask the real assertion failure (the harness's
    // dropCollection makes the same promise), so it warns instead of throwing.
    const cleanup = async () => {
      assertEvalCollection(collection);
      assert.match(collection, /_idem$/, "teardown may only drop this test's own class");
      const headers = { "Content-Type": "application/json" };
      if (idemConfig.token) headers["x-auth-token"] = idemConfig.token;
      try {
        const res = await fetch(`${idemConfig.weaviateUrl}/v1/schema/${collection}`, {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(15000),
        });
        t.diagnostic(`teardown: DELETE /v1/schema/${collection} → ${res.status}`);
      } catch (err) {
        console.warn(`[I-IDEMPOTENT teardown] could not drop ${collection}: ${err.message}`);
      }
    };

    try {
      // First ingest: the class is fresh, so nothing can be skipped and every
      // file is embedded. This leg is also the I-INGEST evidence for these
      // documents (202 + jobId, settles, completed).
      const first = await ingestOnce("first");
      assert.ok(first.final.chunksIndexed > 0, "first ingest indexed nothing");
      assert.strictEqual(first.final.filesCompleted, filePaths.length, "first ingest: every file completed");
      // F-18 self-consistency: the collection agrees with the job's own report.
      assert.strictEqual(first.objects, first.final.chunksIndexed, "first ingest: objects === chunksIndexed");

      // Second ingest of identical files: every docHash is present, so every
      // file must be skipped — no embedding, no insert, no delete.
      const second = await ingestOnce("second");
      const record = {
        collection,
        files: filePaths.length,
        first: { wallMs: first.wallMs, elapsedSeconds: first.final.elapsedSeconds, chunksIndexed: first.final.chunksIndexed, objects: first.objects },
        second: { wallMs: second.wallMs, elapsedSeconds: second.final.elapsedSeconds, chunksIndexed: second.final.chunksIndexed, objects: second.objects },
      };
      t.diagnostic(`I-IDEMPOTENT record ${JSON.stringify(record)}`);
      if (process.env.RAG_EVAL_IDEM_OUT) {
        require("fs").writeFileSync(process.env.RAG_EVAL_IDEM_OUT, JSON.stringify(record, null, 2));
      }

      assert.strictEqual(second.final.filesCompleted, filePaths.length, "second ingest: every file accounted for");
      assert.strictEqual(second.final.chunksIndexed, 0, "second ingest embedded and inserted chunks — skip did not skip");
      assert.strictEqual(second.objects, first.objects, "second ingest changed the object count");
      assert.ok(
        second.wallMs < first.wallMs * 0.1,
        `second ingest took ${second.wallMs} ms, not under 10% of the first run's ${first.wallMs} ms`
      );
    } finally {
      await cleanup();
    }
  });
});

describe("I-VERSION: superseding a document (§4.3)", () => {
  /**
   * I-VERSION — implemented by ticket T06 (2026-09-05). Audit E05 / FM-V1.
   *
   * Measured live before T06 on a v2 class (t06-artifacts): duplicate_a then
   * duplicate_b at ONE path gave one sourceId, TWO docVersions (18 + 89
   * objects) and the a-only sentinel answered from the old version.
   *
   * Fresh RAGEval_<runId>_version (class …_versionV2), schemaVersion 2,
   * duplicatePolicy "skip" (a byte change is never skipped under v2). The
   * fixture is copied under public/ and REPLACED ON DISK between ingests so
   * both land at the same sourceId. Assertions (design §5 / D8;
   * tightened by the T06 review, §6a):
   *   1. after A, the a-only sentinel answers from A (so step 2's "none of
   *      A" is not vacuous); after B, only B's docVersion remains; objects
   *      === chunksIndexed; ids recompute; chunkIndex 0..n-1;
   *   2. the a-only sentinel returns NO row of the old version through
   *      /api/rag/retrieve — the row COUNT is reported, not asserted: BM25
   *      tokenises "21-year-old" and the FCA text answers "year" (7 rows
   *      measured, all the new version);
   *   2b. B again under "skip" is skipped (D2: the skipped branch never
   *      supersedes; count and ids unchanged);
   *   2c. the same-version TAIL (F-54 / D1): two raw objects at chunkIndex
   *      n and n+1 of B's docVersion, then the client's supersede with
   *      keepChunkCount n removes exactly those two;
   *   3. a failed ingest of DIFFERENT bytes (A again, overwrite, embedder at
   *      a dead port — fails at the first embed batch, before any insert)
   *      leaves B untouched: same count, same ids, the b sentinel still
   *      answers. A supersede that ran BEFORE the insert would have keyed on
   *      A's docVersion and emptied B — this step is D1's ordering witness;
   *   4. unload by an explicit `sourceId` (spelled with the `public/`
   *      prefix, version declared in ragSettings, NO filePath, the file GONE
   *      from disk — F-55's rename remedy) removes every object at that
   *      sourceId; the unsuffixed base class was never created.
   * Torn down by a direct schema DELETE (F-39); the fixture dir removed.
   * ~5 minutes with the captioner warm (FCA SYSC is 50 pages).
   */
  const FIXTURE_A = "tests/fixtures/golden/adversarial/duplicate_a/report.pdf";
  const FIXTURE_B = "tests/fixtures/golden/adversarial/duplicate_b/report.pdf";
  const { missingRegenerableFixture, absPath } = require("../unit/_helpers");
  const VERSION_SKIP = SKIP || missingRegenerableFixture(FIXTURE_A) || missingRegenerableFixture(FIXTURE_B);

  test("re-ingesting changed content leaves only the new version", { skip: VERSION_SKIP }, async (t) => {
    const fs = require("fs");
    const path = require("path");
    const cfg = envConfig();
    const { chunkIdFor, sourceIdFor } = require("../../src/lib/rag/ids");
    const base = makeRunCollection("version");
    const collection = `${base}V2`;
    assert.match(collection, /^RAGEval_[A-Za-z0-9_]+_versionV2$/);

    const REPO_ROOT = path.resolve(__dirname, "..", "..");
    const fixtureDir = path.join(REPO_ROOT, "public", "eval_fixtures", base);
    const fixtureFile = path.join(fixtureDir, "report.pdf");
    const filePath = `eval_fixtures/${base}/report.pdf`;
    const sourceId = sourceIdFor(filePath);
    const A_SENTINEL = "21-year-old"; // GraemeHick p2 (manifest anchor) — not in FCA SYSC
    const B_SENTINEL = "10C.6.1R"; // FCA SYSC p7 (manifest anchor) — not in GraemeHick

    const client = new WeaviateClient(cfg.weaviateUrl, cfg.token, collection, { schemaVersion: 2 });
    const headers = { "Content-Type": "application/json" };
    if (cfg.token) headers["x-auth-token"] = cfg.token;

    const payload = ({ duplicatePolicy = "skip", embedUrl = cfg.embedUrl } = {}) => ({
      filePaths: [filePath],
      weaviateUrl: cfg.weaviateUrl,
      token: cfg.token,
      weaviateToken: cfg.token,
      embedUrl,
      embedModel: cfg.embedModel,
      weaviateCollection: base,
      ragSettings: {
        weaviateCollection: base,
        schemaVersion: 2,
        allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"],
        maxFileSize: 50,
        duplicatePolicy,
      },
    });

    async function readAll() {
      const res = await fetch(`${cfg.weaviateUrl}/v1/graphql`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: `{ Get { ${collection}(limit: 5000) { sourceId docVersion chunkIndex _additional { id } } } }` }),
        signal: AbortSignal.timeout(60000),
      });
      const body = await res.json();
      assert.ok(!body.errors, `read-back failed: ${JSON.stringify(body.errors)}`);
      return body.data.Get[collection] || [];
    }

    async function ingestOnce(label, opts) {
      const t0 = Date.now();
      const started = await postJson(`${cfg.appUrl}/api/ingest`, payload(opts));
      assert.equal(started.status, 202, `${label}: ingest not accepted: ${started.text}`);
      const jobId = started.json?.jobId;
      assert.ok(jobId, `${label}: no jobId (F-18)`);
      const final = await waitForIngestion(cfg.appUrl, jobId, 1200000);
      const wallMs = Date.now() - t0;
      assert.equal(final.jobId, jobId, `${label}: status must report our job`);
      t.diagnostic(`${label}: wall ${wallMs} ms, status ${final.status} ${final.errorCode || ""}, chunksIndexed ${final.chunksIndexed}, filesCompleted ${final.filesCompleted}/${final.totalFiles}`);
      return { wallMs, final };
    }

    async function retrieve(query) {
      const r = await postJson(
        `${cfg.appUrl}/api/rag/retrieve`,
        {
          query,
          weaviateUrl: cfg.weaviateUrl,
          weaviateCollection: base,
          schemaVersion: 2,
          token: cfg.token,
          weaviateToken: cfg.token,
          embedUrl: cfg.embedUrl,
          embedModel: cfg.embedModel,
          rerankEnabled: false,
          searchStrategy: "keyword",
          limit: 10,
          keepTopNAfterRerank: 10,
          candidatesToRerank: 10,
          similarityThreshold: 0,
        },
        300000
      );
      assert.equal(r.status, 200, `retrieve "${query}": ${r.text}`);
      assert.strictEqual(r.json.success, true, `retrieve "${query}": ${r.text}`);
      return r.json.results || [];
    }

    const checkHonest = (label, rows, expectVersion) => {
      const indices = [];
      for (const r of rows) {
        assert.strictEqual(r.sourceId, sourceId, `${label}: every row at the one sourceId`);
        assert.strictEqual(r.docVersion, expectVersion, `${label}: row ${r.chunkIndex} carries docVersion ${r.docVersion}, expected ${expectVersion}`);
        assert.strictEqual(r._additional.id, chunkIdFor(r.sourceId, r.docVersion, r.chunkIndex), `${label}: id recomputes from stored fields`);
        indices.push(r.chunkIndex);
      }
      const sorted = indices.slice().sort((a, b) => a - b);
      assert.deepStrictEqual(sorted, sorted.map((_, i) => i), `${label}: chunkIndex is 0..n-1`);
    };

    const cleanup = async () => {
      assertEvalCollection(collection);
      assert.match(collection, /_versionV2$/, "teardown may only drop this test's own class");
      // A job still running (an assertion failed mid-ingest) would recreate
      // the class through auto-schema after the DELETE; cancel it first and
      // give the in-flight batch a moment. Best effort.
      try {
        const c = await postJson(`${cfg.appUrl}/api/ingest/cancel`, {}, 15000);
        if (c.json?.cancelled) {
          // T07 (F-63): a cancel is a request; the job is finished when the
          // worker says so — wait for that, not for a fixed five seconds.
          t.diagnostic(`teardown: cancelling the running job ${c.json.jobId}, waiting for the worker`);
          await waitForIngestion(cfg.appUrl, c.json.jobId, 180000).catch((err) => console.warn(`[I-VERSION teardown] ${err.message}`));
        }
      } catch (err) {
        console.warn(`[I-VERSION teardown] cancel failed: ${err.message}`);
      }
      try {
        const res = await fetch(`${cfg.weaviateUrl}/v1/schema/${collection}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
        t.diagnostic(`teardown: DELETE /v1/schema/${collection} → ${res.status}`);
      } catch (err) {
        console.warn(`[I-VERSION teardown] could not drop ${collection}: ${err.message}`);
      }
      try {
        const res = await fetch(`${cfg.weaviateUrl}/v1/schema/${base}`, { headers, signal: AbortSignal.timeout(15000) });
        t.diagnostic(`base class ${base} after run: HTTP ${res.status} (404 expected)`);
      } catch (err) {
        console.warn(`[I-VERSION] could not check ${base}: ${err.message}`);
      }
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    };

    const record = { collection, sourceId };
    try {
      // 1. version A
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.copyFileSync(absPath(FIXTURE_A), fixtureFile);
      const first = await ingestOnce("A (duplicate_a)");
      assert.equal(first.final.status, "completed", `A: ${first.final.error || ""}`);
      assert.ok(first.final.chunksIndexed > 0, "A indexed nothing");
      const rowsA = await readAll();
      assert.strictEqual(rowsA.length, first.final.chunksIndexed, "A: objects === chunksIndexed");
      const vA = rowsA[0].docVersion;
      checkHonest("A", rowsA, vA);
      record.a = { wallMs: first.wallMs, chunks: first.final.chunksIndexed, docVersion: vA };
      // The sentinel must resolve while A is live, or "none of A" below is vacuous.
      const aRowsLive = await retrieve(A_SENTINEL);
      assert.ok(aRowsLive.some((r) => r.docVersion === vA), `"${A_SENTINEL}" must answer from A while A is the only version`);

      // 2. version B at the same path — supersedes A
      fs.copyFileSync(absPath(FIXTURE_B), fixtureFile);
      const second = await ingestOnce("B (duplicate_b, same path)");
      assert.equal(second.final.status, "completed", `B: ${second.final.error || ""}`);
      assert.ok(second.final.chunksIndexed > 0, "B must be re-indexed, not skipped (a byte change is a new docVersion)");
      const rowsB = await readAll();
      const objectsB = await client.countObjects();
      assert.strictEqual(objectsB, second.final.chunksIndexed, "B: objects === chunksIndexed — nothing of A remains, nothing duplicated");
      assert.strictEqual(rowsB.length, objectsB);
      const vB = rowsB[0].docVersion;
      assert.notStrictEqual(vB, vA, "B is a different docVersion");
      checkHonest("B", rowsB, vB);
      record.b = { wallMs: second.wallMs, chunks: second.final.chunksIndexed, docVersion: vB };

      // 2b. the sentinels through the retrieve route
      const aRows = await retrieve(A_SENTINEL);
      assert.ok(!aRows.some((r) => r.docVersion === vA), `"${A_SENTINEL}" still returns the superseded version`);
      assert.ok(aRows.every((r) => r.docVersion === vB), "every row is the current version");
      const bRows = await retrieve(B_SENTINEL);
      assert.ok(bRows.length > 0, `"${B_SENTINEL}" must answer from the new version`);
      assert.ok(bRows.every((r) => r.docVersion === vB));
      record.aSentinelRowsAfterSupersede = aRows.length; // reported, not asserted (D8)
      t.diagnostic(`a-sentinel "${A_SENTINEL}" after supersede: ${aRows.length} row(s), none of the old version; b-sentinel ${bRows.length} row(s)`);
      const idsB = rowsB.map((r) => r._additional.id).sort();

      // 2b. the skipped branch never supersedes (D2) — and never re-embeds
      const skipped = await ingestOnce("B again, skip");
      assert.equal(skipped.final.status, "completed");
      assert.strictEqual(skipped.final.chunksIndexed, 0, "an unchanged file under skip must be skipped");
      assert.strictEqual(skipped.final.filesCompleted, 1);
      const rowsAfterSkip = await readAll();
      assert.deepStrictEqual(rowsAfterSkip.map((r) => r._additional.id).sort(), idsB, "the skipped branch changed the store");

      // 2c. the same-version tail (F-54 / D1): objects at chunkIndex n, n+1
      // of B's own docVersion — what a re-ingest that produced fewer chunks
      // would leave behind — are removed by the supersede with keepChunkCount n.
      const n = rowsB.length;
      const tail = [n, n + 1].map((chunkIndex) => ({
        class: collection,
        id: chunkIdFor(sourceId, vB, chunkIndex),
        properties: { text: `stale tail ${chunkIndex}`, source: "report.pdf", fileType: "pdf", page: 1, docHash: vB.split(".")[0], isVisualElement: false, metadata: "{}", sourceId, docVersion: vB, chunkIndex, engine: "test" },
      }));
      const tailRes = await fetch(`${cfg.weaviateUrl}/v1/batch/objects`, { method: "POST", headers, body: JSON.stringify({ objects: tail }), signal: AbortSignal.timeout(30000) });
      assert.equal(tailRes.status, 200, `tail insert: ${await tailRes.text()}`);
      await new Promise((r) => setTimeout(r, 1000));
      assert.strictEqual(await client.countObjects(), n + 2, "the two tail objects must be stored before the supersede");
      const destructive = WeaviateClient.forDestructiveOps(cfg.weaviateUrl, cfg.token, collection, { schemaVersion: 2 });
      const tailDelete = await destructive.deleteBySourceExceptVersion(sourceId, vB, { keepChunkCount: n });
      assert.strictEqual(tailDelete.ok, true, JSON.stringify(tailDelete));
      assert.strictEqual(tailDelete.matches, 2, "the supersede must match exactly the two tail objects");
      const rowsAfterTail = await readAll();
      assert.deepStrictEqual(rowsAfterTail.map((r) => r._additional.id).sort(), idsB, "the tail delete must leave exactly B's chunks");
      record.tail = { inserted: 2, superseded: tailDelete.matches };

      // 3. a failed ingest of DIFFERENT bytes leaves the current version
      // serving (insert-first). A's bytes again: a supersede keyed on A's
      // docVersion that ran BEFORE the insert would delete every B row.
      fs.copyFileSync(absPath(FIXTURE_A), fixtureFile);
      const failed = await ingestOnce("A again, overwrite, embedder at a dead port", { duplicatePolicy: "overwrite", embedUrl: "http://127.0.0.1:9/v1" });
      assert.equal(failed.final.status, "error", "the dead-port ingest must fail");
      assert.equal(failed.final.errorCode, "INGEST_FAILED");
      assert.match(String(failed.final.error), /Embedding API failure|fetch failed|ECONNREFUSED/, `the failure must be the embedder's: ${failed.final.error}`);
      assert.strictEqual(failed.final.chunksIndexed, 0, "the dead-port ingest must insert nothing");
      const rowsAfterFail = await readAll();
      const idsAfterFail = rowsAfterFail.map((r) => r._additional.id).sort();
      assert.strictEqual(rowsAfterFail.length, rowsB.length, "a failed ingest changed the object count");
      assert.deepStrictEqual(idsAfterFail, idsB, "a failed ingest changed the set of ids");
      checkHonest("after failed ingest", rowsAfterFail, vB);
      const bRowsAfterFail = await retrieve(B_SENTINEL);
      assert.ok(bRowsAfterFail.length > 0 && bRowsAfterFail.every((r) => r.docVersion === vB), "the current version still answers after a failed ingest");
      record.failedIngest = { status: failed.final.status, errorCode: failed.final.errorCode, chunksIndexed: failed.final.chunksIndexed, objectsUnchanged: idsAfterFail.length === idsB.length && idsAfterFail.every((id, i) => id === idsB[i]) };

      // 4. unload by an explicit sourceId, no filePath, file gone (F-55)
      fs.rmSync(fixtureFile, { force: true });
      assert.ok(!fs.existsSync(fixtureFile));
      const unloaded = await postJson(`${cfg.appUrl}/api/ingest/unload`, {
        sourceId: `public/${filePath}`, // a second spelling of the same identity
        weaviateUrl: cfg.weaviateUrl,
        token: cfg.token,
        weaviateCollection: base,
        ragSettings: { schemaVersion: 2 }, // resolved through the one function (top-level > ragSettings > default); only ragSettings is sent here
      }, 60000);
      assert.equal(unloaded.status, 200, `unload: ${unloaded.text}`);
      assert.strictEqual(unloaded.json.success, true);
      assert.strictEqual(unloaded.json.collection, collection, "unload names the V2 class");
      assert.strictEqual(unloaded.json.sourceId, sourceId, "the sourceId is normalised to the one identity");
      assert.strictEqual(unloaded.json.deleted, rowsB.length, "unload removed every object at the sourceId");
      assert.strictEqual(await client.countObjects(), 0, "the class is empty after unload");
      record.unload = { deleted: unloaded.json.deleted, fileOnDisk: false, byExplicitSourceId: true };
      const baseCheck = await fetch(`${cfg.weaviateUrl}/v1/schema/${base}`, { headers, signal: AbortSignal.timeout(15000) });
      assert.strictEqual(baseCheck.status, 404, "the unsuffixed base class must never have been created");

      t.diagnostic(`I-VERSION record ${JSON.stringify(record)}`);
      if (process.env.RAG_EVAL_VERSION_OUT) {
        fs.writeFileSync(process.env.RAG_EVAL_VERSION_OUT, JSON.stringify(record, null, 2));
      }
    } finally {
      await cleanup();
    }
  });
});

/**
 * I-COUNT — implemented by ticket T09 (2026-09-04).
 *
 * Runs against a POPULATED RAGEval_* collection (RAG_EVAL_COLLECTION) whose
 * documents are named in RAG_EVAL_SOURCES (default: the four T08 documents),
 * and asserts the manifest's cross-confirmed `termCounts` through /api/chat in
 * doc mode. The eval harness calls /api/rag/retrieve directly and is
 * structurally blind to orchestrator-side counting (F-25), so this is the only
 * real evidence for FM-T2.
 *
 * Measured before T09 on RAGEval_t08_20260813: "ASSEMBLY" → 109 (truth 8): 20
 * of 53 BM25 candidates reached the counter, and 29 of SSX125's 65 chunks are
 * VLM captions that say "Assembly" in the captioner's own words.
 */

const liveConfig = envConfig();
const COUNT_COLLECTION = process.env.RAG_EVAL_COLLECTION || null;
const COUNT_SKIP =
  SKIP ||
  (COUNT_COLLECTION
    ? /^RAGEval_[A-Za-z0-9_]+$/.test(COUNT_COLLECTION)
      ? false
      : `RAG_EVAL_COLLECTION must be an RAGEval_* class, got ${COUNT_COLLECTION}`
    : "set RAG_EVAL_COLLECTION to a populated RAGEval_* collection (see I-INGEST)");
const COUNT_SOURCES = (
  process.env.RAG_EVAL_SOURCES ||
  "Barratt_Homes-SaxonFields.pdf,Barratt_Homes_SitePlan.pdf,GraemeHick.pdf,SSX125_Manual.pdf"
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

function countAdminConfig() {
  return {
    nimEndpoint: process.env.RAG_EVAL_CHAT_URL || liveConfig.chatUrl,
    nimApiKey: process.env.RAG_EVAL_CHAT_TOKEN || liveConfig.token,
    nimModelName: process.env.RAG_EVAL_CHAT_MODEL || liveConfig.chatModel,
    systemPrompt: "You are a helpful assistant.",
    temperature: 0,
    maxTokens: 1024,
    weaviateUrl: liveConfig.weaviateUrl,
    weaviateCollection: COUNT_COLLECTION,
    mlisToken: liveConfig.token,
    embedApiKey: liveConfig.token,
    embedEndpoint: liveConfig.embedUrl,
    embedModelName: liveConfig.embedModel,
    rerankEndpointUrl: liveConfig.rerankUrl,
    rerankModelName: liveConfig.rerankModel,
    rerankApiKey: liveConfig.rerankToken,
    ragSettings: { weaviateCollection: COUNT_COLLECTION, schemaVersion: evalSchemaVersion(1) },
    forcedCommand: "/doc",
  };
}

/** The manifest probes for the documents the collection holds. */
function countProbes() {
  return corpusEntries()
    .filter((e) => COUNT_SOURCES.includes(e.fileName))
    .flatMap((e) =>
      (e.termCounts || [])
        .filter((p) => p.rule === "case-insensitive whole-word")
        .map((p) => ({ fileName: e.fileName, token: p.token, count: p.count }))
    );
}

describe("I-COUNT: aggregation accuracy (§4.6)", () => {
  test("a term-frequency question returns the manifest count", { skip: COUNT_SKIP }, async () => {
    const probes = countProbes();
    assert.ok(probes.length > 0, `no manifest termCounts for any of ${COUNT_SOURCES.join(", ")}`);

    for (const probe of probes) {
      const res = await postJson(
        `${liveConfig.appUrl}/api/chat`,
        {
          message: `/doc How many times does the word ${probe.token} appear in the documents?`,
          history: [],
          adminConfig: countAdminConfig(),
        },
        300000
      );
      const label = `${probe.token} (${probe.fileName}, manifest ${probe.count})`;
      assert.strictEqual(res.ok, true, `${label}: chat failed: ${res.text}`);
      assert.strictEqual(res.json.success, true, `${label}: the turn must succeed`);
      assert.ok(!res.json.bookkeepingError, `${label}: no bookkeeping error expected: ${JSON.stringify(res.json.bookkeepingError)}`);
      assert.strictEqual(res.json.retrieval.state, "ok", `${label}: ${JSON.stringify(res.json.retrieval)}`);

      const traces = res.json.traces || [];
      const plan = traces.find((t) => /^Keyword Frequency Aggregation/.test(t.title || ""));
      const result = traces.find((t) => /^Term Frequency Scan Result/.test(t.title || ""));
      assert.ok(plan, `${label}: the aggregation plan span must be present`);
      assert.ok(result, `${label}: the measured scan-result span must be present`);

      // The server's count is the manifest's count. Caption occurrences are
      // reported separately and never added to it — and for SSX125 they must
      // actually be there (29 of its 65 chunks are captions; "scanned but not
      // counted" is only proven if the scan saw them).
      assert.strictEqual(result.details.occurrences, probe.count, `${label}: computed occurrences`);
      assert.strictEqual(result.details.countStemVariants, false, `${label}: default counting rule`);
      assert.strictEqual(
        result.details.chunksScanned,
        result.details.textChunksScanned + result.details.captionChunksScanned,
        `${label}: every scanned chunk is either text or caption`
      );
      if (probe.fileName === "SSX125_Manual.pdf") {
        assert.ok(result.details.captionChunksScanned > 0, `${label}: caption chunks were scanned`);
        assert.ok(result.details.occurrencesInCaptions > 0, `${label}: caption occurrences were seen and disclosed, not filtered before counting`);
      }

      // Honest coverage: on this collection every document fits inside the
      // scan limit, so the scan is measured complete — and only then may the
      // trace say so. A capped or unknown scan must never claim completeness.
      assert.ok(Number.isFinite(result.details.collectionChunks), `${label}: collection total measured, not inferred`);
      assert.strictEqual(result.details.scanComplete, true, `${label}: ${result.details.coverage}`);
      assert.strictEqual(result.details.capApplied, false, label);
      assert.ok(result.details.chunksScanned >= 1, label);
      assert.strictEqual(res.json.retrieval.chunkCount, result.details.chunksScanned, `${label}: every retrieved chunk was scanned`);
      // E18's mechanism, asserted directly: every row the store matched reached
      // the counter (no slice between the store and the count).
      assert.strictEqual(result.details.chunksMatched, result.details.chunksScanned, `${label}: matched rows all reached the counter`);
      const doc = (result.details.perDocument || []).find((d) => d.source === probe.fileName);
      assert.ok(doc, `${label}: per-document row present`);
      assert.strictEqual(doc.occurrences, probe.count, `${label}: per-document occurrences`);
      assert.ok(Number.isFinite(doc.chunksTotal) && doc.chunksTotal >= doc.chunksScanned, `${label}: scanned N of M with a real M`);

      // E18's literal claims are gone from every span of the turn.
      const serialized = JSON.stringify(traces);
      for (const claim of ["Bypassing Top-K caps", "Uncapped Retrieval", "Full Document Keyword Scan"]) {
        assert.ok(!serialized.includes(claim), `${label}: trace still claims "${claim}"`);
      }

      // And the answer the person reads carries the number.
      // Anchored to a count phrasing so a page number cannot satisfy it.
      const answer = res.json.response || "";
      const n = probe.count;
      const anchored = new RegExp(
        `(?<![0-9])${n}(?![0-9])\\s*\\**\\s*(?:times|occurrences?|instances|mentions)|` +
          `(?:appears|occurs|found|total of|exactly|count(?:ed)? (?:is|of|as))\\W{0,20}(?<![0-9])${n}(?![0-9])`,
        "i"
      );
      assert.ok(anchored.test(answer), `${label}: the answer must state the count ${n} as a count; got: ${answer.slice(0, 400)}`);
    }
  });
});

describe("I-FAILMODE: honest failure reporting (§4.7)", () => {
  test(
    "an unreachable embedding endpoint yields a typed EMBED_DOWN error",
    {
      skip: SKIP,
      todo:
        "audit E30/E31 / FM-L7 — retrieval failures are swallowed and the prompt then " +
        "asserts that nothing matched, while the response still reports success:true. " +
        "Fixed by ticket T12.",
    },
    async () => {
      assert.fail("blocked by E30 — see todo reason");
    }
  );

  test(
    "the chat answer states retrieval failed rather than claiming no matches",
    {
      skip: SKIP,
      todo:
        "audit E30 — orchestrator injects 'No matching text passages ... were retrieved' " +
        "on infrastructure failure, which is indistinguishable from an empty index. " +
        "Fixed by ticket T12.",
    },
    async () => {
      assert.fail("blocked by E30 — see todo reason");
    }
  );
});
