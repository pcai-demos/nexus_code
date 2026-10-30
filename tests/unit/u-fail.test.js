/**
 * U-FAIL — the failure taxonomy and the orchestrator's retrieval mapping
 * (ticket T12, evaluation-plan §2).
 *
 * The defect under test is FM-L7: an infrastructure failure used to reach the
 * user as "the document doesn't mention it". Measured in-pod before this ticket
 * (session 5): with the embedding endpoint pointed at a dead port, /api/chat
 * answered a question about indexed content with
 *
 *   "Hesketh 4-Bedroom Home: Listed in index/legend/summary, but no detailed
 *    specification section or data table is present in the document."
 *
 * HTTP 200, no success flag, no error — while a control request 60 seconds
 * earlier answered the same question correctly from the same collection.
 *
 * Four causes used to be indistinguishable because every one of them left
 * `retrievedChunks` empty and the code inferred meaning from its length:
 *
 *   1. retrieval failed          (dependency down / config refused)
 *   2. retrieval returned zero   (legitimate since T08's relevance floor)
 *   3. retrieval was degraded    (results real but never relevance-ranked)
 *   4. post-retrieval bookkeeping threw (F-25 — success destroyed while
 *      describing itself)
 *
 * These cases pin each apart. They are pure-function tests: no live service is
 * required, so the failure paths are covered on every `npm test` rather than
 * only when infrastructure happens to be broken.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  RETRIEVAL_ERROR_CODES,
  retrievalErrorBody,
  retrievalDegradation,
  classifyRetrievalOutcome,
  buildRetrievalPromptBlock,
} = require("../../src/lib/rag/config");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RETRIEVE_ROUTE = path.join(REPO_ROOT, "src", "app", "api", "rag", "retrieve", "route.js");
const ORCHESTRATOR = path.join(REPO_ROOT, "src", "lib", "orchestrator.js");

/** The exact masking sentence this ticket removes. */
const MASKING_TEXT = "No matching text passages";

/**
 * Source with comment lines removed. These walks assert what the code DOES, so
 * a comment recording what was removed ("the old text was X") must not read as
 * the removed thing still being present.
 */
function codeOnly(src) {
  return src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("U-FAIL taxonomy: one convention, extended not forked", () => {
  test("T08's codes are still the same strings (T16 reuses EMBED_MODEL_MISMATCH)", () => {
    assert.strictEqual(RETRIEVAL_ERROR_CODES.CONFIG_MISSING, "CONFIG_MISSING");
    assert.strictEqual(RETRIEVAL_ERROR_CODES.EMBED_MODEL_MISMATCH, "EMBED_MODEL_MISMATCH");
  });

  test("T12's codes exist", () => {
    for (const code of ["EMBED_DOWN", "WEAVIATE_DOWN", "RERANK_DOWN"]) {
      assert.strictEqual(RETRIEVAL_ERROR_CODES[code], code, `${code} missing from the taxonomy`);
    }
  });

  test("T17's code exists (design D13, F-40): a present non-canonical collection name is a caller-contract 400", () => {
    assert.strictEqual(RETRIEVAL_ERROR_CODES.COLLECTION_INVALID, "COLLECTION_INVALID");
  });

  test("the error body shape is T08's, unchanged", () => {
    assert.deepStrictEqual(retrievalErrorBody("EMBED_DOWN", "boom"), {
      success: false,
      code: "EMBED_DOWN",
      error: "boom",
    });
  });

  test("a degradation is not an error body — it rides on success", () => {
    const d = retrievalDegradation("RERANK_DOWN", "rerank", "no scores");
    assert.deepStrictEqual(d, { stage: "rerank", code: "RERANK_DOWN", message: "no scores" });
    assert.ok(!("success" in d), "a degradation must not carry a success flag");
  });
});

describe("U-FAIL classification: retrieval failed vs nothing found", () => {
  test("HTTP 500 EMBED_DOWN is a failure carrying the route's code", () => {
    const r = classifyRetrievalOutcome({
      ok: false,
      status: 500,
      body: { success: false, code: "EMBED_DOWN", error: "Embedding failure: fetch failed" },
    });
    assert.strictEqual(r.state, "failed");
    assert.strictEqual(r.code, "EMBED_DOWN");
    assert.strictEqual(r.chunkCount, 0);
  });

  test("HTTP 400 CONFIG_MISSING is a failure, not an empty corpus", () => {
    const r = classifyRetrievalOutcome({
      ok: false,
      status: 400,
      body: { success: false, code: "CONFIG_MISSING", error: "'embedUrl' is required" },
    });
    assert.strictEqual(r.state, "failed");
    assert.strictEqual(r.code, "CONFIG_MISSING");
  });

  test("HTTP 400 EMBED_MODEL_MISMATCH is a failure (F-19: it used to read as absence)", () => {
    const r = classifyRetrievalOutcome({
      ok: false,
      status: 400,
      body: { success: false, code: "EMBED_MODEL_MISMATCH", error: "2560 vs 4096" },
    });
    assert.strictEqual(r.state, "failed");
    assert.strictEqual(r.code, "EMBED_MODEL_MISMATCH");
  });

  test("an unparseable body still yields a typed failure, never a silent empty", () => {
    const r = classifyRetrievalOutcome({ ok: false, status: 502, body: null });
    assert.strictEqual(r.state, "failed");
    assert.strictEqual(r.code, RETRIEVAL_ERROR_CODES.RETRIEVE_INTERNAL);
    assert.match(r.message, /502/);
  });

  test("HTTP 200 with success:false is a failure, not a success (the pre-T12 fall-through)", () => {
    const r = classifyRetrievalOutcome({
      ok: true,
      status: 200,
      body: { success: false, code: "WEAVIATE_DOWN", error: "connection refused" },
    });
    assert.strictEqual(r.state, "failed");
    assert.strictEqual(r.code, "WEAVIATE_DOWN");
  });

  test("zero results with success:true is EMPTY — a legitimate outcome since T08", () => {
    const r = classifyRetrievalOutcome({ ok: true, status: 200, body: { success: true, results: [] } });
    assert.strictEqual(r.state, "empty");
    assert.strictEqual(r.code, null, "an empty result set is not an error and carries no code");
    assert.strictEqual(r.chunkCount, 0);
  });

  test("results with success:true is OK", () => {
    const r = classifyRetrievalOutcome({
      ok: true,
      status: 200,
      body: { success: true, results: [{ text: "a" }, { text: "b" }] },
    });
    assert.strictEqual(r.state, "ok");
    assert.strictEqual(r.chunkCount, 2);
  });

  test("results plus a degradation is DEGRADED, keeping the chunks", () => {
    const r = classifyRetrievalOutcome({
      ok: true,
      status: 200,
      body: {
        success: true,
        results: [{ text: "a" }],
        degraded: [retrievalDegradation("RERANK_DOWN", "rerank", "the score API was unreachable")],
      },
    });
    assert.strictEqual(r.state, "degraded");
    assert.strictEqual(r.code, "RERANK_DOWN");
    assert.strictEqual(r.chunkCount, 1, "a degradation must not discard real results");
  });

  test("T10: a PARTIAL rerank failure is degraded too, under its own code", () => {
    // The case the owner's null-score ruling did not settle: 6 of 8 candidates
    // scored, 2 unscored, so the ranking is partly real. It is still a
    // degradation — an unscored passage passed the relevance floor unchecked
    // and is being shown to a user — but it is NOT RERANK_DOWN, because the
    // ordering of the scored passages genuinely means something.
    const r = classifyRetrievalOutcome({
      ok: true,
      status: 200,
      body: {
        success: true,
        results: [{ text: "a", rerankScore: 0.9 }, { text: "b", rerankScore: null }],
        degraded: [
          retrievalDegradation(
            "RERANK_PARTIAL",
            "rerank",
            "scored 6 of 8 candidates, so 2 of the 2 passages returned were never relevance-checked"
          ),
        ],
      },
    });
    assert.strictEqual(r.state, "degraded");
    assert.strictEqual(r.code, "RERANK_PARTIAL");
    assert.strictEqual(r.chunkCount, 2, "a partial failure must not discard the ranking that DID happen");
  });

  test("zero results AND a degradation reports both, not just the emptiness", () => {
    const r = classifyRetrievalOutcome({
      ok: true,
      status: 200,
      body: {
        success: true,
        results: [],
        degraded: [retrievalDegradation("RERANK_DOWN", "rerank", "the score API was unreachable")],
      },
    });
    assert.strictEqual(r.state, "empty");
    assert.match(r.message, /score API was unreachable/, "the degradation must not be swallowed");
  });
});

describe("U-FAIL prompt: the model is told which of the four things happened", () => {
  const failed = { state: "failed", code: "EMBED_DOWN", message: "Embedding failure: fetch failed" };
  const empty = {
    state: "empty",
    code: null,
    message: "the search ran successfully and returned no passage above the relevance threshold",
  };

  test("retrieval failure states the ticket's required sentence verbatim", () => {
    const block = buildRetrievalPromptBlock(failed);
    assert.ok(
      block.includes("Retrieval failed (EMBED_DOWN); do not claim the document lacks content"),
      "T12's acceptance sentence must appear verbatim"
    );
  });

  test("retrieval failure never emits the masking text", () => {
    assert.ok(!buildRetrievalPromptBlock(failed).includes(MASKING_TEXT));
  });

  test("retrieval failure forbids denying the content exists", () => {
    const block = buildRetrievalPromptBlock(failed);
    assert.match(block, /MUST NOT say the documents do not mention/i);
    assert.match(block, /know NOTHING about whether/i);
  });

  test("retrieval failure forbids answering from general knowledge", () => {
    assert.match(buildRetrievalPromptBlock(failed), /MUST NOT answer from general knowledge/i);
  });

  test("an EMPTY result set is the one state where 'not covered' is allowed", () => {
    const block = buildRetrievalPromptBlock(empty);
    assert.match(block, /Retrieval WORKED/);
    assert.match(block, /correct and expected to tell the user/i);
    assert.ok(!block.includes(MASKING_TEXT));
  });

  test("empty and failed produce materially different prompts", () => {
    assert.notStrictEqual(buildRetrievalPromptBlock(failed), buildRetrievalPromptBlock(empty));
  });

  test("a degraded result set keeps its context AND warns the order is meaningless", () => {
    const context = "[Retrieved Specification Sheets & Passages]\nchunk text here";
    const block = buildRetrievalPromptBlock(
      { state: "degraded", code: "RERANK_DOWN", message: "the score API was unreachable." },
      context
    );
    assert.ok(block.includes(context), "real results must survive a degradation");
    assert.match(block, /NOT RELEVANCE-RANKED \(RERANK_DOWN\)/);
    assert.match(block, /ORDER as meaningless/);
  });

  test("T10: a partial failure gets a DIFFERENT instruction from a total one", () => {
    const context = "[Retrieved Specification Sheets & Passages]\nchunk text here";
    const partial = buildRetrievalPromptBlock(
      {
        state: "degraded",
        code: "RERANK_PARTIAL",
        message: "the configured reranker scored 6 of 8 candidates, so 2 of the 8 passages " +
          "returned were never relevance-checked.",
      },
      context
    );
    assert.ok(partial.includes(context), "real results must survive a partial degradation");
    assert.match(partial, /NOT RELEVANCE-CHECKED \(RERANK_PARTIAL\)/);
    assert.match(partial, /listed LAST/, "the model must know WHERE the unchecked passages are");
    assert.ok(
      !/ORDER as meaningless/.test(partial),
      "the scored passages' order IS meaningful — telling the model to ignore it discards real ranking"
    );

    // And the total-failure wording must not have drifted onto the partial case.
    const down = buildRetrievalPromptBlock(
      { state: "degraded", code: "RERANK_DOWN", message: "the score API was unreachable." },
      context
    );
    assert.notStrictEqual(partial, down, "one code, one instruction");
    assert.match(down, /ORDER as meaningless/);
  });

  test("an unrecognised degradation code still warns, rather than passing silently", () => {
    // degraded[] is an open vocabulary. A future stage's code must not render
    // as a healthy prompt.
    const block = buildRetrievalPromptBlock(
      { state: "degraded", code: "SOME_FUTURE_CODE", message: "something else degraded." },
      "context"
    );
    assert.match(block, /WARNING/);
    assert.match(block, /SOME_FUTURE_CODE/);
  });

  test("a healthy retrieval's prompt is exactly the context, with nothing bolted on", () => {
    const context = "[Retrieved Specification Sheets & Passages]\nchunk";
    assert.strictEqual(buildRetrievalPromptBlock({ state: "ok" }, context), context);
  });

  test("chat mode (skipped) contributes no RAG block at all", () => {
    assert.strictEqual(buildRetrievalPromptBlock({ state: "skipped" }, "ignored"), "");
  });
});

describe("U-FAIL invariant: every retrieve error response carries a code", () => {
  // An untyped error is exactly what the orchestrator cannot map, and an
  // unmappable error is how a failure became "the document doesn't mention it".
  test("no untyped {success:false} literal survives in the retrieve route", () => {
    const src = fs.readFileSync(RETRIEVE_ROUTE, "utf-8");
    const untyped = src.match(/\{\s*success:\s*false(?![^}]*code)[^}]*\}/g) || [];
    assert.deepStrictEqual(
      untyped,
      [],
      `untyped error bodies found in retrieve/route.js:\n${untyped.join("\n")}`
    );
  });

  test("the masking sentence is gone from the orchestrator entirely", () => {
    const src = fs.readFileSync(ORCHESTRATOR, "utf-8");
    const offending = src
      .split("\n")
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => line.includes(MASKING_TEXT) && !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    assert.deepStrictEqual(
      offending,
      [],
      `the masking text still reaches a prompt:\n${offending.map(([n, l]) => `${n}: ${l}`).join("\n")}`
    );
  });

  test("the [SYSTEM FALLBACK] essay and its stub snippet are gone", () => {
    const src = codeOnly(fs.readFileSync(ORCHESTRATOR, "utf-8"));
    assert.ok(
      !src.includes("[SYSTEM FALLBACK: OFFLINE]"),
      "an LLM outage must return a plain error, not an essay that reads as an answer"
    );
    assert.ok(
      !src.includes('console.log("LLM API endpoint is currently unreachable.")'),
      "an LLM outage must not return a stub code snippet that reads as generated code"
    );
  });

  test("the orchestrator never hardcodes success:true on its return", () => {
    const src = codeOnly(fs.readFileSync(ORCHESTRATOR, "utf-8"));
    assert.ok(
      !/return\s*\{\s*\n\s*success:\s*true,/.test(src),
      "`success` must reflect whether the model actually answered"
    );
  });
});

describe("U-FAIL/T21 invariant: every non-2xx body on the ingest routes carries a code", () => {
  // The walk above covers retrieve/route.js and matches `{ success: false … }`
  // literals. The ingest routes' untyped bodies (measured 2026-09-03: five of
  // them, in clear/ and unload/) were `{ error: … }` with no `success` field at
  // all, so that pattern could not see them. This walk finds every
  // `NextResponse.json(body, { status: N })` call with N >= 400 under
  // src/app/api/ingest/ and requires `code` in the body literal — the same
  // {success:false, code, error} shape, one owner per domain (state.js).
  const INGEST_API = path.join(REPO_ROOT, "src", "app", "api", "ingest");

  function routeFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) routeFiles(full, out);
      else if (entry.name === "route.js") out.push(full);
    }
    return out;
  }

  /** Top-level arguments of the call starting right after `open` (index of "("). */
  function callArgs(src, open) {
    const args = [];
    let depth = 0;
    let start = open + 1;
    let quote = null;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        depth--;
        if (depth === 0) {
          args.push(src.slice(start, i).trim());
          return args;
        }
      } else if (ch === "," && depth === 1) {
        args.push(src.slice(start, i).trim());
        start = i + 1;
      }
    }
    throw new Error("unbalanced call");
  }

  /** Comment-blanking that keeps line structure (a multi-line call must survive). */
  function blankComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  }

  /** Blank string contents so a `code:` inside a message cannot satisfy the pin. */
  function blankStrings(src) {
    return src.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => m[0] + m[0]);
  }

  /**
   * Every NextResponse.json call site in the ingest routes, classified. A
   * second argument with a literal status < 400 is a success body; ANY other
   * second argument (literal >= 400, or a non-literal such as
   * `{ status: refusal.status }`) is an error path and must carry `code`.
   * Review finding: the first version of this walk skipped non-literal
   * statuses, which is exactly what every T21 refusal site uses — it passed
   * vacuously on 6 of 8 bodies.
   */
  function classify(file) {
    const src = blankComments(fs.readFileSync(file, "utf-8"));
    const re = /NextResponse\.json\s*\(/g;
    const sites = [];
    let m;
    while ((m = re.exec(src))) {
      const args = callArgs(src, m.index + m[0].length - 1);
      const literal = args[1] && args[1].match(/status:\s*(\d{3})\b/);
      const isError = args[1] ? !(literal && Number(literal[1]) < 400) : false;
      const typed = /\bcode\s*:/.test(blankStrings(args[0]));
      sites.push({ status: literal ? literal[1] : args[1] ? "non-literal" : "200", isError, typed, body: args[0].replace(/\s+/g, " ") });
    }
    return sites;
  }

  test("no NextResponse.json error body lacks a code under src/app/api/ingest/", () => {
    const offending = [];
    for (const file of routeFiles(INGEST_API)) {
      for (const site of classify(file)) {
        if (site.isError && !site.typed) {
          offending.push(`${path.relative(REPO_ROOT, file)}: status ${site.status} body ${site.body}`);
        }
      }
    }
    assert.deepStrictEqual(offending, [], `untyped error bodies:\n${offending.join("\n")}`);
  });

  test("the walk actually classifies error sites in every destructive route (zero inspected proves nothing)", () => {
    const files = routeFiles(INGEST_API);
    const rel = files.map((f) => path.relative(INGEST_API, f));
    for (const expected of ["clear/route.js", "clear/preview/route.js", "unload/route.js", "route.js"]) {
      assert.ok(rel.includes(expected), `${expected} not walked`);
    }
    for (const name of ["clear/route.js", "clear/preview/route.js", "unload/route.js"]) {
      const errors = classify(path.join(INGEST_API, name)).filter((s) => s.isError).length;
      assert.ok(errors >= 2, `${name}: only ${errors} error site(s) classified — the walk is not seeing the refusals`);
    }
  });

  test("the classifier catches an untyped body behind a non-literal status and a decoy inside a string", () => {
    const tmp = path.join(require("os").tmpdir(), `u-fail-walk-${process.pid}.js`);
    fs.writeFileSync(
      tmp,
      [
        'return NextResponse.json({ error: "Missing code: " + x }, { status: refusal.status });',
        "return NextResponse.json({ success: false, // code: pending",
        '  error: "x" }, { status: 500 });',
        'return NextResponse.json({ success: false, code: C.X, error: "y" }, { status: 400 });',
        'return NextResponse.json({ success: true, message: "code: fine" });',
      ].join("\n")
    );
    try {
      const sites = classify(tmp);
      assert.deepStrictEqual(
        sites.map((s) => [s.isError, s.typed]),
        [[true, false], [true, false], [true, true], [false, false]]
      );
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe("U-FAIL/F-18: ingestion jobs have identity", () => {
  // Pre-T12 `POST /api/ingest` returned 202 with no identifier and the status
  // route streamed one module-global object, so a caller could not tell its own
  // job's state from a concurrent or orphaned one. Measured consequence: a run
  // reported `chunksIndexed: 80` while its own collection held 0 objects.
  const state = require("../../src/lib/ingestion/state");

  test("every job gets a distinct id", () => {
    const a = state.createJob(2);
    const b = state.createJob(3);
    assert.ok(a.jobId && b.jobId);
    assert.notStrictEqual(a.jobId, b.jobId);
    assert.strictEqual(state.getJob(a.jobId).totalFiles, 2);
    assert.strictEqual(state.getJob(b.jobId).totalFiles, 3);
  });

  test("a completed job is still addressable by id afterwards", () => {
    const job = state.createJob(1);
    state.finishJob(job, "completed");
    assert.strictEqual(state.getJob(job.jobId).status, "completed");
  });

  test("activeJob gates concurrency and clears when the job ends", () => {
    const job = state.createJob(1);
    assert.strictEqual(state.activeJob()?.jobId, job.jobId, "a running job must hold the lock");
    state.finishJob(job, "completed");
    assert.strictEqual(state.activeJob(), null, "a finished job must release the lock");
  });

  test("a cancelled job releases the lock", () => {
    const job = state.createJob(1);
    job.cancelled = true;
    state.finishJob(job, "cancelled");
    assert.strictEqual(state.activeJob(), null);
  });

  test("T07 (F-63): a cancel REQUEST does not release the lock — only the worker's finishJob does", () => {
    // Before T07 `activeJob()` read `!job.cancelled`, so the lock went the
    // moment the cancel route set the flag, while the worker's in-flight
    // batches were still inserting; a second ingest of the same file was
    // accepted 318 ms later (measured, t07-artifacts).
    const job = state.createJob(1);
    job.cancelled = true;
    assert.strictEqual(state.activeJob()?.jobId, job.jobId, "a cancelling job still holds the lock");
    state.finishJob(job, "cancelled");
    assert.strictEqual(state.activeJob(), null);
    assert.ok(state.retainedJobIds().includes(job.jobId));
  });

  test("T07: a fresh job carries fileResults and ledgerError, the snapshot mirrors them, and INGEST_PARTIAL is in the taxonomy", () => {
    const job = state.createJob(2);
    assert.deepStrictEqual(job.fileResults, []);
    assert.strictEqual(job.ledgerError, null);
    job.fileResults = [{ fileName: "a.pdf", status: "indexed" }];
    job.ledgerError = "append failed";
    state.syncLegacyView();
    const snap = state.snapshot(job);
    assert.deepStrictEqual(snap.fileResults, [{ fileName: "a.pdf", status: "indexed" }]);
    assert.strictEqual(snap.ledgerError, "append failed");
    assert.strictEqual(state.ingestionState.fileResults, job.fileResults, "the legacy view mirrors fileResults");
    assert.strictEqual(state.INGEST_ERROR_CODES.INGEST_PARTIAL, "INGEST_PARTIAL");
  });

  test("an unknown job id resolves to nothing rather than to the latest job", () => {
    state.createJob(1);
    assert.strictEqual(state.getJob("not-a-real-job-id"), null);
  });

  test("the legacy singleton view still mirrors the most recent job", () => {
    // The admin panel's EventSource and the orchestrator's docling span both
    // read this without any notion of a job; they must keep working.
    const job = state.createJob(7);
    job.chunksIndexed = 42;
    state.syncLegacyView();
    assert.strictEqual(state.ingestionState.totalFiles, 7);
    assert.strictEqual(state.ingestionState.chunksIndexed, 42);
    assert.strictEqual(state.ingestionState.jobId, job.jobId);
  });

  test("a status snapshot carries the job id and leaks no module internals", () => {
    const job = state.createJob(1);
    const snap = state.snapshot(job);
    assert.strictEqual(snap.jobId, job.jobId);
    for (const [key, value] of Object.entries(snap)) {
      assert.notStrictEqual(typeof value, "function", `snapshot leaked a function at "${key}"`);
    }
    assert.ok(!("createJob" in snap), "snapshot must not expose the registry API");
  });
});

describe("U-FAIL/F-25: bookkeeping is outside retrieval's blast radius", () => {
  // F-25: a throw inside a trace builder destroyed a SUCCESSFUL retrieval and
  // presented it as "no context found". The guarantee is structural — the
  // results are committed before anything that merely describes them runs — so
  // it is pinned structurally, in the same spirit as U-CFG's banned-literals
  // walk. A behavioural test cannot reach it: there is deliberately no longer
  // any input that makes the bookkeeping throw.
  const src = codeOnly(fs.readFileSync(ORCHESTRATOR, "utf-8"));

  test("results are committed before any bookkeeping runs", () => {
    const commit = src.indexOf("retrievedChunks = rawResults;");
    // The CALL SITE, not the function definition near the top of the file.
    const diversity = src.indexOf("= applyPageDiversity(");
    const trace = src.indexOf('category: "rag_pipeline"');
    assert.ok(commit > -1, "the commit point must exist");
    assert.ok(diversity > -1, "the diversity call site must exist");
    assert.ok(diversity > commit, "the diversity filter must run after the commit");
    assert.ok(trace > commit, "the trace builder must run after the commit");
  });

  test("a bookkeeping failure is recorded under its own code, never as a retrieval failure", () => {
    assert.match(src, /bookkeepingError\s*=\s*\{\s*code:\s*CODES\.BOOKKEEPING_FAILED/);
    // The retrieval outcome is only ever assigned from the classifier or the
    // unreachable case — never from a bookkeeping catch.
    const bookkeepingCatches = src.match(/Bookkeeping Error[\s\S]{0,400}?\}/g) || [];
    assert.ok(bookkeepingCatches.length >= 2, "both bookkeeping regions must have their own catch");
    for (const block of bookkeepingCatches) {
      assert.ok(
        !/retrieval\s*=\s*\{/.test(block),
        `a bookkeeping catch must not overwrite the retrieval outcome:\n${block}`
      );
    }
  });

  test("the diversity filter reorders rather than drops", () => {
    // Its second pass exists precisely so nothing is lost. If that regresses, a
    // successful retrieval silently loses context — the same user-visible
    // outcome as F-25, reached from a different direction. I-FAILMODE asserts
    // the same property end to end against live results.
    const fn = src.slice(
      src.indexOf("function applyPageDiversity"),
      src.indexOf("function auditCodeCompliance")
    );
    assert.ok(fn.length > 0, "applyPageDiversity must exist as an extracted function");
    assert.match(fn, /if \(!diverseChunks\.includes\(c\)\)\s*\{\s*diverseChunks\.push\(c\);/);
    assert.match(fn, /return diverseChunks;/);
  });
});

describe("U-FAIL/T28: the page read, the document scope and the assembly are bookkeeping (t28-design D8, §13.3)", () => {
  const src = codeOnly(fs.readFileSync(ORCHESTRATOR, "utf-8"));

  test("regions 2b and 2c run after the commit point, before the assembly, each with its own catch and stage", () => {
    const commit = src.indexOf("retrievedChunks = rawResults;");
    const scope = src.indexOf("Bookkeeping Error - scope");
    const companions = src.indexOf("Bookkeeping Error - companions");
    const assembly = src.indexOf("Bookkeeping Error - assembly]");
    const numbered = src.indexOf("const numbered = buildNumberedContext(");
    assert.ok(commit > -1 && scope > commit && companions > scope && assembly > companions && numbered > assembly, "commit → scope → companions → assembly → the numbered context");
    for (const stage of ["scope", "companions", "assembly", "coverage", "assembly-trace"]) {
      assert.match(src, new RegExp(`stage:\\s*"${stage}"`), `a bookkeeping stage "${stage}"`);
    }
  });

  test("the store reads go through T23's credential seam and the retrieval's own resolved config", () => {
    const fn = src.slice(src.indexOf("const storeReadClient = () =>"), src.indexOf("if (assemblyEligible && isMultiEntityQuery)"));
    assert.match(fn, /resolveCredential\(\{ url: rc\.weaviateUrl, requestValue: rc\.weaviateToken \|\| rc\.token \}\)/);
    assert.match(fn, /rc\.weaviateCollection/);
  });

  test("the aggregation path, code mode and a failed / empty retrieval never assemble (design D7) — except T15's explicitly scoped enumeration (A10)", () => {
    const gate = src.slice(src.indexOf("const assemblyEligible ="), src.indexOf("const storeReadClient"));
    assert.match(gate, /!isCodeTask/);
    assert.match(gate, /!targetAggregationKeyword/);
    assert.match(gate, /retrieval\.state === "ok" \|\| retrieval\.state === "degraded"/);
    assert.match(gate, /retrievedChunks\.length > 0/);
    // T15 (A10): a request / named scope whose filtered retrieval ranked
    // nothing still reads the document whole on an enumeration turn — and
    // ONLY then: a failed retrieval, code mode and a count never do.
    const scopeGate = src.slice(src.indexOf("const scopeEligible ="), src.indexOf("if (scopeEligible && isMultiEntityQuery)"));
    assert.match(scopeGate, /assemblyEligible \|\|/);
    assert.match(scopeGate, /retrieval\.state === "empty"/);
    assert.match(scopeGate, /preScope && preScope\.prefilter && preScope\.documents\.length > 0/);
    assert.match(scopeGate, /!isCodeTask/);
    assert.match(scopeGate, /!targetAggregationKeyword/);
    assert.match(src, /if \(retrievedChunks\.length > 0 \|\| \(documentContext && documentContext\.rows\.length > 0\)\) \{/, "the assembly runs on a whole-document read with nothing ranked");
    assert.match(src, /retrieval\.state === "empty" && documentContext && documentContext\.rows\.length > 0\s*\? `\[NO PASSAGE ABOVE THE RELEVANCE FLOOR/, "the empty-state instruction does not contradict a shown document");
  });

  test("the slice still bounds the ranked chunks; companions and the document set are separate; the pinned call shape holds", () => {
    // T15 (design D4): the slice is over the IN-SCOPE ranked chunks.
    assert.match(src, /const slicedChunks = scopedChunks\.slice\(0, maxContextChunks\)/);
    assert.match(src, /assembledChunks = interleave\(slicedChunks, selection\.companions\)/);
    assert.match(src, /assembledChunks = documentContext\.rows/);
    assert.match(src, /const numbered = buildNumberedContext\(\{ specChunks, legendChunks, paginationFacts, textFor: noteTextFor \}\)/);
    assert.match(src, /referencePages: buildReferencePages\(referenceChunks, paginationFacts\)/, "the audit's reference set is retrieval's pages, plus the document's on a complete read");
  });

  test("the chat route forwards contextAssembly / documentScope (A16 — the smoke pass found them dropped)", () => {
    const route = codeOnly(fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "chat", "route.js"), "utf-8"));
    assert.match(route, /contextAssembly: result\.contextAssembly \?\? null,/);
    assert.match(route, /documentScope: result\.documentScope \?\? null,/);
    assert.match(route, /documentScope: body\.documentScope \?\? null,/, "the request field is forwarded into orchestrate()");
  });

  test("T15 (design D13; A16's rule): BOTH routes forward `router`, and the IDE bridge forwards the scope and the T28 fields too", () => {
    const chat = codeOnly(fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "chat", "route.js"), "utf-8"));
    const bridge = codeOnly(fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "ide-bridge", "route.js"), "utf-8"));
    assert.match(chat, /router: result\.router \?\? null,/);
    assert.match(bridge, /router: result\.router \?\? null,/);
    assert.match(bridge, /documentScope: body\.documentScope \?\? null,/);
    assert.match(bridge, /contextAssembly: result\.contextAssembly \?\? null,\s*documentScope: result\.documentScope \?\? null,/);
    assert.match(src, /router: routeReport\.response,/, "the orchestrator returns the router's verdict");
    assert.match(src, /const route = routeTurn\(\{\s*message,\s*forcedCommand: adminConfig\?\.forcedCommand \?\? null,\s*ideState,/, "one router call, before anything reads the message");
    assert.match(src, /stage: "turn-scope"/, "the turn scope is bookkeeping (F-25)");
    assert.match(src, /stage: "pre-scope"/);
  });

  test("rule 7's wording follows measured coverage, and the response carries contextAssembly / documentScope", () => {
    // T63 (D11 (a)): the wording still follows measured coverage, through the note's LINE — which a whole-document lookup leaves out.
    assert.match(src, /legendNoteLine\(\{ noteWording: documentContext && documentContext\.noteWording === "complete" \? "complete" : "partial", wholeDocumentLookup: Boolean\(documentContext && documentContext\.rows\.length > 0 && documentContext\.enumeration === false\) \}\)/);
    assert.ok(!/do not have dedicated specification pages in this document: \[List/.test(src), "the unconditional absence claim is gone from the prompt");
    // T15: a lookup turn with a document in scope reports it too (design D4); a whole-document read is "rows shown", not only "every document complete" (D5).
    assert.match(src, /contextAssembly,\s*documentScope: documentContext\s*\? summariseScope\(documentContext\)\s*: turnScope && turnScope\.documents\.length > 0/);
    assert.match(src, /const generationTimeoutMs = documentContext && documentContext\.rows\.length > 0 \? 600000 : 300000/);
  });
});

describe("U-FAIL/T30: the follow-up query is bookkeeping, the model's message is unchanged, and the verdict reaches the wire (t30-design D4, D8, D9)", () => {
  const src = codeOnly(fs.readFileSync(ORCHESTRATOR, "utf-8"));

  test("the router reads the history once; the query step has its own catch and stage, before retrieval, after the summary; a throw leaves the bare message", () => {
    assert.match(src, /const route = routeTurn\(\{\s*message,\s*forcedCommand: adminConfig\?\.forcedCommand \?\? null,\s*ideState,\s*contextDefaults: resolveContextConfig\(adminConfig\?\.ragSettings\),\s*history,\s*\}\);/);
    assert.match(src, /stage: "follow-up"/);
    const step = src.indexOf("followUpQuery = buildRetrievalQuery(");
    const summary = src.indexOf("dbSummaryDetails = summary || [];");
    const retrieve = src.indexOf("query: expandedQueryText,");
    assert.ok(summary > -1 && step > summary && retrieve > step, "summary → the follow-up step → retrieval");
    assert.match(src, /const expandedQueryText = targetAggregationKeyword \? aggregationQueryText : followUpQuery\.query;/, "a count turn keeps the aggregation query");
    assert.match(src, /followUpQuery = \{ query: cleanQuery, applied: false, reason: `the follow-up step failed: \$\{err\.message\}`/);
    // A5: declared at the turn's scope (beside turnScope), not inside the retrieval block — the Turn Scope span reads it after the block.
    const decl = src.indexOf("let followUpQuery = {");
    const block = src.indexOf("const localOrigin = `http://127.0.0.1:");
    assert.ok(decl > -1 && block > -1 && decl < block, "followUpQuery is declared before the retrieval block");
    assert.strictEqual((src.match(/let followUpQuery = \{/g) || []).length, 1, "declared once");
  });

  test("the model's user message is the bare message (D8); the two post-ranking scope calls carry the previous scope and the applied verdict (D6); the pre-scope does not", () => {
    assert.match(src, /formattedMessages\.push\(\{ role: "user", content: route\.cleanMessage \|\| message \}\);/);
    // T65 (t65-design.md §2.3): every scope call also carries the census of the question's names (`nameHolders`).
    const calls = src.match(/resolveTurnScope\(\{ message: cleanQuery, ranked: retrievedChunks,[^)]*previousScope: followUpQuery\.previousScope, followUp: followUpQuery\.applied === true, nameHolders \}\)/g) || [];
    assert.strictEqual(calls.length, 2, "region 2a and region 2c");
    assert.match(src, /preScope = resolveTurnScope\(\{ message: cleanQuery, ranked: \[\], summary: dbSummaryDetails, requestScope: documentScope, threshold: CONTEXT_ASSEMBLY_CONSTANTS\.SCOPE_DOMINANCE_SHARE, nameHolders \}\);/);
  });

  test("the verdict is on the router span, the RAG span and the response; both routes forward `router` whole; the dry-run runner and the chip read it", () => {
    assert.match(src, /routeReport\.response = described\.response;/);
    assert.match(src, /router: routeReport\.response,/);
    assert.match(src, /retrievalQuery: expandedQueryText,/);
    assert.match(src, /SCOPED\$\{t\.method === "previous" \? " \(PREVIOUS\)" : ""\}:/);
    const router = codeOnly(fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "rag", "router.js"), "utf-8"));
    assert.match(router, /response: \{ mode: route\.mode, modeSource: route\.modeSource, intent: route\.intent, model, followUp \}/);
    const runner = fs.readFileSync(path.join(__dirname, "..", "..", "tests", "eval", "baselines", "dryrun-artifacts", "run_dry_run.js"), "utf-8");
    assert.match(runner, /followUp: j && j\.router \? j\.router\.followUp \?\? null : null,/);
    assert.match(runner, /retrievalQuery: d\.retrievalQuery \?\? null,/);
    const panel = fs.readFileSync(path.join(__dirname, "..", "..", "src", "components", "ChatPanel.jsx"), "utf-8");
    assert.match(panel, /chat\.router\.followUp && chat\.router\.followUp\.applied \? " · follow-up" : ""/);
  });
});

describe("U-FAIL/T14: citation audit is bookkeeping, outside every blast radius", () => {
  // T14 adds a post-GENERATION bookkeeping region: extraction failure must
  // cost the citations, never the answer, and never present as a retrieval
  // failure. Structural pins, same spirit as the F-25 block above.
  const src = codeOnly(fs.readFileSync(ORCHESTRATOR, "utf-8"));

  test("the audit runs after the answer is final, before the return", () => {
    const fallback = src.indexOf("No answer was generated");
    const audit = src.indexOf("citationAudit = auditAnswer(");
    // The orchestrator's response object is the file's final `return {`.
    const ret = src.lastIndexOf("return {");
    assert.ok(fallback > -1 && audit > -1, "fallback and audit call sites must exist");
    assert.ok(audit > fallback, "the audit must run after the LLM-outage fallback settles the answer");
    assert.ok(ret > audit, "the audit must run before the orchestrator returns");
  });

  test("the audit is gated on a real answer and a real retrieval outcome", () => {
    assert.match(
      src,
      /if \(success && retrieval\.state !== "failed" && retrieval\.state !== "skipped"\)/,
      'the audit must not run without an answer, nor judge claims when nothing was searched (state "failed"/"skipped")'
    );
  });

  test("a citation-audit failure is bookkeeping, with its own stage, and touches nothing else", () => {
    // The whole catch body: from the error log to the null reset that ends it.
    const catchBlock = (src.match(/Citation Audit Error[\s\S]{0,600}?citationAudit = null/g) || [])[0];
    assert.ok(catchBlock, "the citation audit's catch must log, set bookkeeping, and reset the audit");
    assert.match(catchBlock, /stage:\s*"citations"/);
    assert.ok(!/retrieval\s*=\s*\{/.test(catchBlock), "the catch must not overwrite the retrieval outcome");
    assert.ok(!/explanation\s*=/.test(catchBlock), "the catch must not touch the answer");
  });

  test("the numbered context actually reaches the prompt — the contract cannot be silently dead", () => {
    // Review finding: without this pin, reverting the formatter wiring would
    // leave every U-CITE case green while the app ships unnumbered context,
    // zero citations, and a vacuous eval leg.
    assert.match(src, /const numbered = buildNumberedContext\(\{ specChunks, legendChunks, paginationFacts, textFor: noteTextFor \}\)/);
    assert.match(src, /contextMap = numbered\.contextMap/);
    assert.match(src, /RAGRulesText = exactOccurrencesSummary \+ numbered\.contextText/);
    assert.match(src, /contextMap\.length > 0 \? `8\. CITATION CONTRACT:/);
    // T28: the reference set is the ranked chunks, plus the document's own
    // rows on a complete read (a page the model was shown is not a fabrication).
    assert.match(src, /referencePages: buildReferencePages\(referenceChunks, paginationFacts\)/);
    // T15 (design D4): the in-scope ranked chunks — a passage left out of the prompt was never shown.
    assert.match(src, /const referenceChunks =\s*documentContext && documentContext\.rows\.length > 0 \? scopedChunks\.concat\(documentContext\.rows\) : scopedChunks;/);
  });

  test("citation fields ship only when the audit ran", () => {
    assert.match(
      src,
      /\.\.\.\(citationAudit\s*\?\s*\{ citations: citationAudit\.citations, uncitedClaims: citationAudit\.uncitedClaims \}\s*:\s*\{\}\)/,
      "present-possibly-empty when the audit ran; absent when it did not — one meaning per field"
    );
  });
});

/**
 * T16 — the ingest-time 409 sits BEFORE the job exists, the retrieve-side
 * check never writes the ledger, the degradation reaches the orchestrator's
 * classifier unchanged, and the ChatPanel's consequence line exists (design
 * D3, D7, D8, D11). Source pins resolve by symbol; a moved block breaks a pin,
 * which is the pin doing its job (session-state §9).
 */
describe("U-FAIL/T16: the ingest refusal is request-level and records nothing (design D3, D4)", () => {
  const INGEST_ROUTE = path.join(REPO_ROOT, "src", "app", "api", "ingest", "route.js");
  const src = codeOnly(fs.readFileSync(INGEST_ROUTE, "utf-8"));

  test("the pin check runs after the INGEST_IN_PROGRESS check and before createJob — outside the job, before the skip decision", () => {
    const activeAt = src.indexOf("const running = activeJob();");
    const checkAt = src.indexOf("const pinRefusal = await embedModelPinRefusal(");
    const createAt = src.indexOf("const job = createJob(");
    const skipAt = src.indexOf("completionDecision(weaviateClient");
    assert.ok(activeAt > -1 && checkAt > -1 && createAt > -1 && skipAt > -1, "all four sites exist");
    assert.ok(checkAt > activeAt, "after the concurrency 409");
    assert.ok(checkAt < createAt, "before the job is created — a refused request has no job, no ledger event, no lock");
    assert.ok(createAt < skipAt, "and therefore before any skip decision (T03 / T05's constraint)");
    // The pin check awaits the store, which opens a window inside F-18's
    // lock: two rapid POSTs could both pass the first activeJob() and both
    // create a job (review). The lock is re-checked right before createJob.
    const region = src.slice(checkAt, createAt);
    assert.match(region, /if \(activeJob\(\)\) \{[\s\S]{0,600}?code: INGEST_CODES\.INGEST_IN_PROGRESS[\s\S]{0,400}?\{ status: 409 \}/, "the concurrency lock is re-checked after the await, before the job is created");
  });

  test("the refusal is a typed 409 carrying the pin, and the store is consulted first with a refreshed read (D4)", () => {
    const region = src.slice(src.indexOf("const running = activeJob();"), src.indexOf("const job = createJob("));
    assert.match(region, /const pinRefusal = await embedModelPinRefusal\(\{ ledgerPath: defaultLedgerPath\(\), className: pinClassName, weaviateUrl, weaviateToken: weaviateToken \|\| token, embedModel \}\);/);
    assert.match(region, /code: pinRefusal\.code/, "the body carries the taxonomy's code");
    assert.match(region, /pin: pinRefusal\.pin \},\s*\{ status: 409 \}/, "and the pin it was refused against, as a 409 — the concurrency 409 in the same region cannot satisfy this (review)");
    // Cut-over (D1 / D2): the version through the one shared function, the
    // suffix through the one rule — the same two calls the worker makes.
    assert.match(region, /pinClassName = collectionNameForVersion\(WeaviateClient\.canonicalClassName\(pinCollection\), resolveSchemaVersion\(body\)\)/, "the class is resolved exactly as the worker resolves it");
    assert.match(src, /const schemaVersion = resolveSchemaVersion\(body\);\s*const className = collectionNameForVersion\(WeaviateClient\.canonicalClassName\(collection\), schemaVersion\);/, "and the worker resolves it through the same function");
    // The helper the handler calls: the ledger read, the store probe, and what it must NOT do.
    const helperAt = src.indexOf("async function embedModelPinRefusal(");
    const probeAt = src.indexOf("async function probeStoreDimension(");
    const clipAt = src.indexOf("function clip(");
    assert.ok(helperAt > -1 && probeAt > helperAt && clipAt > probeAt, "the helper and its probe exist");
    const helper = src.slice(helperAt, clipAt);
    assert.match(helper, /revalidateIndex\(ledgerPath\)/, "the in-process index is revalidated by one stat first (A11)");
    assert.match(helper, /getCollectionPin\(getIndex\(ledgerPath\)\.events, \{ collection: className, store: storeOriginOf\(weaviateUrl\) \}\)/, "the pin is the reducer's, filtered by the store this request targets (D10)");
    assert.match(helper, /if \(!pin\.enforceable\) \{[\s\S]{0,400}?return null;/, "a provisional pin never refuses (D5)");
    assert.match(helper, /if \(store\.exists === false\) \{[\s\S]{0,400}?return null;/, "an absent class has nothing to protect");
    assert.match(helper, /checkEmbedModelPinForIngest\(pin, \{ embedModel: requested, storeDim: store\.dim \}\)/, "the verdict is the pure function's");
    assert.match(helper, /classProperties\(\{ refresh: true \}\)/, "the class's existence is read fresh");
    assert.match(helper, /getVectorDimension\(\{ refresh: true \}\)/, "the class's LIVE dimension, never the cached one");
    assert.match(helper, /new WeaviateClient\(weaviateUrl, weaviateToken, className\)/, "a plain read-only client");
    assert.ok(!/record\(|appendEvent\(/.test(region + helper), "nothing is written to the ledger for a refused request");
    assert.ok(!/forDestructiveOps\(/.test(region + helper), "never the destructive factory");
    assert.ok(!/\.ensureSchema\(/.test(region + helper), "and creates nothing");
  });

  test("the ingest route stamps every event with the store origin (D10) and never the raw URL", () => {
    assert.match(src, /const store = storeOriginOf\(weaviateUrl\);/);
    assert.match(src, /boundEvent\(\{ collection: className, schemaVersion, store, jobId: job\.jobId, \.\.\.event \}\)/, "one append site, the store on every event of the job");
    assert.ok(!/store: weaviateUrl/.test(src), "never the raw URL (it may carry userinfo)");
  });
});

describe("U-FAIL/T16: the retrieve-side check reads, never writes, and rides the 200 as a degradation (design D7, D8)", () => {
  const src = codeOnly(fs.readFileSync(RETRIEVE_ROUTE, "utf-8"));

  test("the same-dim name check runs after T08's dimension guard and before the search; T08's guard is byte for byte what it was", () => {
    const guardAt = src.lastIndexOf("checkVectorDimMatch(");
    const nameAt = src.indexOf("checkEmbedModelPinForQuery(");
    const searchAt = src.indexOf("await weaviateClient.searchFiltered(");
    assert.ok(guardAt > -1 && nameAt > -1 && searchAt > -1);
    assert.ok(nameAt > guardAt && nameAt < searchAt, "after the dimension guard, before the search");
    assert.match(src, /if \(mismatch\) \{\s*return NextResponse\.json\(retrievalErrorBody\(mismatch\.code, mismatch\.message\), \{ status: 400 \}\);\s*\}/, "T08's 400 is untouched");
    assert.match(src, /queryDim: queryVector\.length/);
  });

  test("the retrieve route never writes the ledger (a pin 'derived lazily on retrieve' would record the query's guess as the collection's truth)", () => {
    assert.ok(!/appendEvent/.test(src), "no ledger write in the retrieve route");
    assert.match(src, /revalidateIndex\(ledgerPath\)/, "the read is revalidated first");
    // The ledger keys on the CANONICAL class name (the worker's className);
    // the resolver's `cfg.weaviateCollection` is not canonicalised, so a
    // stored "my-coll" would search the right class and miss its pin (review).
    assert.match(src, /getCollectionPin\(getIndex\(ledgerPath\)\.events, \{ collection: weaviateClient\.className, store: storeOriginOf\(cfg\.weaviateUrl\) \}\)/, "the pin is looked up under the class the client actually reads");
  });

  test("the embed degradation must not silence a rerank degradation on the same response (review, HIGH)", () => {
    // T12's coverage gate read `degraded.length === 0` to mean "the rerank
    // catch did not run". With the embed degradation pushed first that would
    // also mean "no embed degradation", and a dead reranker under a
    // name-mismatched query would drop RERANK_DOWN from degraded[], the chip
    // and the eval record — F-26's shape, reintroduced in exactly the
    // degraded case.
    assert.match(src, /if \(candidatesScored !== null && !degraded\.some\(\(d\) => d\.stage === "rerank"\)\)/, "the gate asks whether a RERANK degradation was already recorded, not whether any was");
    assert.ok(!/candidatesScored !== null && degraded\.length === 0/.test(src), "the length-based gate is gone");
  });

  test("the degradation is pushed FIRST (the classifier reports degraded[0]) and report.embedSpace is set on every vector-bearing response", () => {
    const declAt = src.indexOf("const degraded = [];");
    const pushAt = src.indexOf("degraded.push(embedDegradation)");
    const rerankAt = src.indexOf("if (candidates.length > 0 && cfg.rerankEffective)");
    assert.ok(declAt > -1 && pushAt > -1 && rerankAt > -1);
    assert.ok(pushAt > declAt && pushAt < rerankAt, "before any rerank degradation");
    assert.ok(!/degraded\.push\(/.test(src.slice(declAt, pushAt)), "and nothing is pushed ahead of it (review)");
    assert.match(src, /report\.embedSpace = embedSpace/);
    assert.match(src, /buildEmbedSpaceReport\(/);
  });

  test("an unreadable ledger costs the pin, never the retrieval (F-25's rule)", () => {
    const at = src.indexOf("getCollectionPin(");
    const region = src.slice(Math.max(0, at - 800), at + 800);
    assert.match(region, /try \{(?:(?!\} catch)[\s\S])*?getCollectionPin\((?:(?!\} catch)[\s\S])*?\} catch/, "the ledger read is inside its own try (tempered: no `} catch` between the try and the call — review)");
    assert.match(region, /pinSource = "ledger_unavailable"/, "and the report says so");
  });
});

describe("U-FAIL/T16: the degradation reaches the chat path unchanged, and the person is told what it costs (design D7, D11)", () => {
  test("classifyRetrievalOutcome: results plus an EMBED_MODEL_MISMATCH degradation is DEGRADED under that code, chunks kept", () => {
    const r = classifyRetrievalOutcome({
      ok: true,
      status: 200,
      body: { success: true, results: [{ text: "a" }, { text: "b" }], degraded: [retrievalDegradation("EMBED_MODEL_MISMATCH", "embed", "same dimensions, other name")] },
    });
    assert.strictEqual(r.state, "degraded");
    assert.strictEqual(r.code, "EMBED_MODEL_MISMATCH");
    assert.strictEqual(r.chunkCount, 2);
    // and with a rerank degradation behind it, the embed one is still what is reported
    const both = classifyRetrievalOutcome({ ok: true, status: 200, body: { success: true, results: [{ text: "a" }], degraded: [retrievalDegradation("EMBED_MODEL_MISMATCH", "embed", "x"), retrievalDegradation("RERANK_DOWN", "rerank", "y")] } });
    assert.strictEqual(both.code, "EMBED_MODEL_MISMATCH");
  });

  test("ChatPanel: the degraded chip has a plain-language consequence line for EMBED_MODEL_MISMATCH beside RERANK_DOWN's (T26 is not scheduled — a source pin)", () => {
    const panel = fs.readFileSync(path.join(REPO_ROOT, "src", "components", "ChatPanel.jsx"), "utf-8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const chipAt = panel.indexOf('chat.retrieval?.state === "degraded" && (');
    const intentAt = panel.indexOf("chat.intent && !chat.router && (");
    assert.ok(chipAt > -1 && intentAt > chipAt, "the degraded chip block is located");
    const block = panel.slice(chipAt, intentAt);
    assert.match(block, /chat\.retrieval\.code === "EMBED_MODEL_MISMATCH" \? \(/, "the consequence line is gated on the code");
    assert.match(block, /different (embedding )?model from the one that indexed the collection/);
    assert.match(block, /relevant passages may be missing/);
    assert.match(block, /chat\.retrieval\.code === "RERANK_DOWN" \? \(/, "RERANK_DOWN's line is still there");
  });
});

describe("U-FAIL/T36: the generator's outcome is read, disclosed and typed; an empty cut is a failure (t36-design D1, D2, D4, D5; F-134)", () => {
  // Measured before the ticket (t36-design.md §0b): FQ12 cut at exactly 8,192
  // completion tokens in all four runs on the kept arm classes, one with an
  // EMPTY answer that was `success: true`, HTTP 200, `citations: []` and
  // "Processed successfully." on the page. The provider had said
  // `finish_reason: "length"` every time; nothing read it. These pins are the
  // A16 rule: a field the route does not name is null on the wire.
  const src = codeOnly(fs.readFileSync(ORCHESTRATOR, "utf-8"));
  const chat = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src", "app", "api", "chat", "route.js"), "utf-8"));
  const bridge = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src", "app", "api", "ide-bridge", "route.js"), "utf-8"));
  const page = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src", "app", "page.js"), "utf-8"));
  const panel = fs.readFileSync(path.join(REPO_ROOT, "src", "components", "ChatPanel.jsx"), "utf-8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  test("the taxonomy carries the two codes as their own strings", () => {
    assert.strictEqual(RETRIEVAL_ERROR_CODES.GENERATION_CUT, "GENERATION_CUT");
    assert.strictEqual(RETRIEVAL_ERROR_CODES.GENERATION_EMPTY, "GENERATION_EMPTY");
  });

  test("the budget is planned by the pure module and the request shape is unchanged (D5): model, messages, temperature, max_tokens — no think control", () => {
    // T63 (D5 (a)): the plan also knows whether the prompt is a whole document.
    assert.match(src, /const generationPlan = planGenerationBudget\(\{ intent: route\.intent, requestedMaxTokens: adminConfig\?\.maxTokens, wholeDocument: Boolean\(documentContext && documentContext\.rows\.length > 0\) \}\);/);
    assert.match(src, /body: JSON\.stringify\(\{\s*model: modelName,\s*messages,\s*temperature: adminConfig\?\.temperature \?\? 0\.1,\s*max_tokens: generationPlan\.applied\s*\}\)/);
    assert.ok(!/Math\.max\(adminConfig\?\.maxTokens/.test(src), "the inline floor arithmetic is gone");
    assert.ok(!/\bthink:|reasoning_effort|num_predict|max_completion_tokens/.test(src), "no think control on the chat path (D3: thinking stays on; D5: no native path)");
  });

  test("the outcome is read on every call — the first and the self-correction retry — never inferred from the content's length", () => {
    assert.match(src, /generationOutcome = readGenerationOutcome\(\{ provider: GENERATION_PROVIDERS\.OPENAI_COMPATIBLE, json: llmData \}\);\s*explanation = generationOutcome\.content;/);
    assert.match(src, /const retryOutcome = readGenerationOutcome\(\{ provider: GENERATION_PROVIDERS\.OPENAI_COMPATIBLE, json: retryData \}\);/);
    assert.match(src, /generationAttempts = 2;/);
    assert.ok(!/llmData\.choices\?\.\[0\]\?\.message\?\.content/.test(src), "the old bare content read is gone");
    assert.ok(!/retryData\.choices\?\.\[0\]/.test(src), "the retry's bare read is gone too");
  });

  test("success = false on cut && empty, with the plain error text and no code snippet (D2 — T12's contract: success means an answer exists)", () => {
    assert.match(src, /const generationEmptyCut = success && generationReport !== null && generationOutcome\.cut && generationOutcome\.empty;/);
    assert.match(src, /if \(generationEmptyCut\) \{[\s\S]{0,400}?success = false;\s*\}/);
    assert.match(src, /explanation = generationEmptyCut\s*\? generationReport\.userMessage/);
    assert.match(src, /if \(!success\) \{[\s\S]{0,600}?code_snippet = "";\s*\}/);
  });

  test("the LLM span's badge and details come from the description; the return and the telemetry carry the field", () => {
    assert.match(src, /badge: generationSpan\.badge,\s*badgeType: generationSpan\.badgeType,/);
    assert.match(src, /\.\.\.generationSpan\.spanDetails,/);
    assert.match(src, /generation: generationReport \? generationReport\.generation : null,/);
    assert.match(src, /\? generationReport\.telemetry\s*: \{ finish_reason: null, max_tokens: generationPlan\.applied, answer_chars: null, reasoning_chars: null \}/);
    assert.match(src, /generation: retrySpan\.spanDetails/, "the self-correction spans carry the retry's outcome");
  });

  test("BOTH routes name `generation` (A16's rule — a field the route does not name is null on the wire)", () => {
    assert.match(chat, /generation: result\.generation \?\? null,/);
    assert.match(bridge, /generation: result\.generation \?\? null,/);
  });

  test("page.js copies `generation` onto the message in both paths and never renders an absent answer as a success", () => {
    assert.strictEqual((page.match(/generation: data\.generation \|\| null,/g) || []).length, 2, "both message builders copy the field verbatim");
    assert.ok(!/Processed successfully/.test(page), "the untrue sentence is gone from both fallbacks");
    assert.strictEqual((page.match(/\(the model returned no answer text\)/g) || []).length, 2);
  });

  test("ChatPanel gates the amber chip on the typed field and renders its message — never a number re-derived here", () => {
    assert.match(panel, /chat\.generation\?\.cut && chat\.generation\.code === "GENERATION_CUT" && \(/);
    assert.match(panel, /Answer cut short · \{chat\.generation\.code\}/);
    assert.match(panel, /\{chat\.generation\.message\}/);
    assert.ok(!/reasoningChars\s*\/|\* 100/.test(panel.slice(panel.indexOf('chat.generation?.cut &&'), panel.indexOf('chat.generation?.cut &&') + 1500)), "no arithmetic on the field in the chip");
    const bubble = (panel.match(/chat\.isFailure[\s\S]{0,700}?bg-white\/3/) || [])[0];
    assert.ok(bubble && /chat\.generation\?\.cut/.test(bubble), "a cut turn's bubble is marked like a degraded one");
  });

  test("the settings table is 33 keys and the guard is v18 (29 / v14 at T36's time: T37 bumped the guard for the captioner default, T33 added detailPasses, T35 added ocrNoTextPages, T48 beyondTheDocuments, T63 lookupDocumentRead) — nothing about the generator's budget is in the blob (D4: the floors are constants, no knob)", () => {
    const { RAG_SETTINGS_DEFAULTS } = require("../../src/lib/rag/config");
    assert.strictEqual(Object.keys(RAG_SETTINGS_DEFAULTS).length, 33);
    assert.ok(!Object.keys(RAG_SETTINGS_DEFAULTS).some((k) => /^(maxTokens|generation\w*|outputBudget|enumerationBudget)$/i.test(k)), "no settings key for the generator's budget (documentContextBudget / captionPageBudget / detailPasses are other tickets' keys)");
    assert.match(fs.readFileSync(path.join(REPO_ROOT, "src", "app", "page.js"), "utf-8"), /nxs_migrated_demos_v18/);
  });
});

describe("U-FAIL/T43: time and tokens on every turn — one clock, twenty stamped push sites, the four projection seams, the footer and the drawers (t43-design.md D1, D2, D4, D5, §2.3; F-179, F-180)", () => {
  // Measured before the ticket (t43-design.md §0): every span's `timestamp`
  // is its RECORD time and the two engine-inspection spans carry ingest-time
  // durations (67,272 / 24,699 ms on a 55 s turn) — a start derived as
  // `timestamp − durationMs` read −67 s, a sum of durations 147 s. These pins
  // are the A16 rule (a field the route does not name is null on the wire)
  // plus the design's own: offsets are stamped on the server from each span's
  // own start clock, never derived on the client.
  const src = codeOnly(fs.readFileSync(ORCHESTRATOR, "utf-8"));
  const chat = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src", "app", "api", "chat", "route.js"), "utf-8"));
  const bridge = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src", "app", "api", "ide-bridge", "route.js"), "utf-8"));
  const page = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src", "app", "page.js"), "utf-8"));
  const panel = fs.readFileSync(path.join(REPO_ROOT, "src", "components", "ChatPanel.jsx"), "utf-8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const drawer = fs.readFileSync(path.join(REPO_ROOT, "src", "components", "TracingDrawer.jsx"), "utf-8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  // The drawer names F-180's old literals in its header comment (the record of what it replaced): pin the CODE.
  const stats = fs.readFileSync(path.join(REPO_ROOT, "src", "components", "StatsDrawer.jsx"), "utf-8").replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const runner = fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "dryrun-artifacts", "run_dry_run.js"), "utf-8");
  const figq = fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "workshop-artifacts", "ab", "run_figure_questions.js"), "utf-8");

  test("the orchestrator names ONE clock and every push site is stamped from its own start — none computes `Date.now() - xxxStart` on its own any more", () => {
    assert.match(src, /const clock = turnClock\(startTime\);/);
    const pushes = (src.match(/traces\.push\(/g) || []).length;
    const turnStamps = (src.match(/\.\.\.spanTiming\(clock, /g) || []).length;
    const ingestStamps = (src.match(/\.\.\.ingestSpanTiming\(clock\)/g) || []).length;
    assert.strictEqual(pushes, 21, "twenty-one push sites (the design counted nineteen; §11a A1; T53's Disclosure Check row is the twenty-first)");
    assert.strictEqual(turnStamps, 19, "T53's Disclosure Check row is stamped from its own start (the nineteenth turn stamp)");
    assert.strictEqual(ingestStamps, 2, "the two engine-inspection spans (T13) are ingest-scoped");
    assert.strictEqual((src.match(/durationMs: Date\.now\(\) - /g) || []).length, 0, "no push site keeps its own second clock read");
    assert.ok(!/timestamp\) - |Date\.parse\([^)]*timestamp[^)]*\) -/.test(src), "no start derived from a record time");
  });

  test("the ingest stamps sit on the two docling_ingestion spans after the span model's spread (durationSource untouched)", () => {
    assert.match(src, /\.\.\.parserSpan,[\s\S]{0,400}?\.\.\.ingestSpanTiming\(clock\),/);
    assert.match(src, /\.\.\.vlmSpan,\s*\.\.\.ingestSpanTiming\(clock\),/);
  });

  test("the state-kept durations are stamped from hoisted MEASURED starts, never re-derived", () => {
    assert.match(src, /let turnScopeStartMs = null;\s*let documentScopeStartMs = null;\s*let companionsStartMs = null;\s*let assemblyStartMs = null;/);
    assert.match(src, /turnScopeStartMs = turnScopeStart;/);
    assert.match(src, /documentScopeStartMs = scopeStart;/);
    assert.match(src, /companionsStartMs = companionsStart;/);
    assert.match(src, /assemblyStartMs = Date\.now\(\);/);
    assert.match(src, /\.\.\.spanTiming\(clock, documentScopeStartMs, \{ durationMs: d\.durationMs \?\? 0 \}\),/);
    assert.strictEqual((src.match(/\.\.\.spanTiming\(clock, turnScopeStartMs, \{ durationMs: turnScopeMs \?\? 0 \}\),/g) || []).length, 2, "both Turn Scope sites");
    assert.match(src, /\.\.\.spanTiming\(clock, companionState \? companionsStartMs : assemblyStartMs, \{ durationMs: companionState \? companionState\.durationMs \?\? 0 : 0 \}\),/);
    assert.match(src, /\.\.\.spanTiming\(clock, aggregationStart, \{ durationMs: aggregationDurationMs \}\),/);
  });

  test("`timing` is built from the stamped spans with the wall = latency and named in the return; the telemetry reads the same token values", () => {
    assert.match(src, /const timing = summariseTiming\(\{\s*clock,\s*wallMs: latency,\s*traces,\s*generation: generationReport \? generationReport\.generation : null,\s*telemetry: tokenTelemetry,\s*model: modelName,\s*\}\);/);
    assert.match(src, /generation: generationReport \? generationReport\.generation : null,\s*timing,/);
    assert.match(src, /latency,\s*\.\.\.tokenTelemetry,\s*cost: 0\.0,/);
    assert.match(src, /const tokenTelemetry = \{\s*prompt_tokens: llmUsage\?\.prompt_tokens \?\? Math\.floor\(message\.length \/ 4\) \+ \(retrievedChunks\.length \* 20\),\s*completion_tokens: llmUsage\?\.completion_tokens \?\? Math\.floor\(explanation\.length \/ 4\) \+ Math\.floor\(code_snippet\.length \/ 4\),\s*estimated: !llmUsage,\s*\};/);
  });

  test("BOTH routes name `timing` (A16's rule — a field the route does not name is null on the wire)", () => {
    assert.match(chat, /timing: result\.timing \?\? null,/);
    assert.match(bridge, /timing: result\.timing \?\? null,/);
  });

  test("page.js copies `timing` onto the message in both paths and onto both trace turns, keeps its own clock, and feeds the stats drawer from the aggregate", () => {
    assert.strictEqual((page.match(/timing: data\.timing \|\| null,/g) || []).length, 4, "two message builders + two trace turns");
    assert.strictEqual((page.match(/const sentAtMs = Date\.now\(\);/g) || []).length, 1);
    assert.strictEqual((page.match(/const clientMs = Date\.now\(\) - sentAtMs;/g) || []).length, 2);
    // Polish Phase 2 (2026-10-14): the two message builders, plus the doc-turn and chat-turn posts that carry clientMs to the run log (U-USAGE).
    assert.strictEqual((page.match(/\bclientMs,/g) || []).length, 4);
    assert.strictEqual((page.match(/setSessionTimings\(prev => \[\.\.\.prev, data\.timing \|\| null\]\);/g) || []).length, 2);
    assert.match(page, /session=\{aggregateSessionTiming\(sessionTimings\)\}/);
    assert.match(page, /servedModel=\{lastRouterModel\}/);
    assert.ok(!/cumulativeTokens|lastLatency/.test(page), "the old cumulative count and last latency are gone (the aggregate carries them, labelled)");
  });

  test("ChatPanel renders the footer through the one formatter and does no arithmetic on the field — since T49 (§12b D12) as the formatter's pills, never the line", () => {
    assert.match(panel, /import \{ formatTurnTiming \} from "@\/lib\/rag\/timing";/);
    assert.match(panel, /const formatted = formatTurnTiming\(timing, \{ clientMs \}\);/);
    assert.match(panel, /\{chat\.timing && <TurnTimingFooter timing=\{chat\.timing\} clientMs=\{chat\.clientMs\} \/>\}/);
    const footer = panel.slice(panel.indexOf("function TurnTimingFooter"), panel.indexOf("export default function ChatPanel"));
    assert.ok(footer.length > 0 && !/\/ 1000|\* 100|toFixed|Date\.now|new Date/.test(footer), "no arithmetic, no clock in the component");
    assert.match(panel, /\{chat\.timestamp\}/, "the send-time clock stays where it was");
    // T49 (t49-design.md §12b, D11 / D12): the footer renders `formatted.pills` — the line's values labelled for an
    // audience — and no longer the line itself; the harness's renderer (render_dry_run.js) and every record keep
    // the line; the row's tooltip is T43's exact split; a pill with a state turns amber; no second formatter.
    assert.match(footer, /\{formatted\.pills\.map\(\(pill\) => \(/);
    assert.match(footer, /data-turn-timing=\{pill\.id\}/);
    assert.match(footer, /<span className="uppercase opacity-60">\{pill\.label\}<\/span>\s*<span>\{pill\.text\}<\/span>/);
    assert.match(footer, /title=\{formatted\.title\}/, "the tooltip is T43's, verbatim");
    assert.ok(!/data-turn-timing="line"|\{formatted\.line\}/.test(footer), "the line span is gone (§12b D12) — the pills carry the ids");
    assert.ok(!/formatSeconds|formatInt|formatTokens|\.line\b/.test(footer), "the footer names no second formatter and never re-reads the line");
    const hues = panel.slice(panel.indexOf("const PILL_HUES"), panel.indexOf("function TurnTimingFooter"));
    for (const id of ["wall", "retrieval", "model", "in", "out", "llm"]) assert.ok(new RegExp(`\\b${id}: "bg-`).test(hues), `a hue for ${id}`);
    assert.match(hues, /const PILL_STATE_HUE = "bg-amber-500\/15 text-amber-400 border-amber-500\/20";/, "a state turns the pill amber (the page's degradation hue)");
    assert.match(footer, /pill\.state \? PILL_STATE_HUE : PILL_HUES\[pill\.id\]/);
    const renderer = fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "dryrun-artifacts", "render_dry_run.js"), "utf-8");
    assert.match(renderer, /esc\(footer\.line\)/, "the harness's renderer keeps printing the line (unchanged by T49)");
    assert.ok(!/pills/.test(renderer));
  });

  test("TracingDrawer prints the clock time, the `t+` offset and the ingest label from the stamps, and the generation row's tokens; it keys on durationScope, never durationSource", () => {
    assert.match(drawer, /import \{ formatOffset, formatClock, formatSeconds, formatTokens \} from "@\/lib\/rag\/timing";/);
    assert.match(drawer, /\{formatOffset\(trace\.offsetMs\)\}/);
    assert.match(drawer, /\{formatClock\(trace\.timestamp\)\}/);
    assert.match(drawer, /trace\.durationScope === "ingest" \? `\$\{formatSeconds\(trace\.durationMs\)\} at ingest` : `\$\{trace\.durationMs\}ms`/);
    assert.match(drawer, /\{formatTokens\(trace\.details\.usage\)\}/);
    assert.match(drawer, /formatClock\(activeTurn\.timing\.startedAt\)/);
    assert.ok(!/durationSource === "measured"|durationSource === "ledger"/.test(drawer), "the timeline keys on durationScope, never on durationSource (§0b fact 2)");
    assert.ok(!/timestamp\) - |- trace\.durationMs/.test(drawer), "no start derived from a record time in the drawer");
  });

  test("StatsDrawer: the invented figures are gone; every number is the session's aggregate; the cost card says it is not metered", () => {
    assert.ok(!/194 ms|\* 0\.75|\* 0\.25|LiteLLM Proxy Rates|Qwen 2\.5 Coder Engine|NGI LiteLLM Proxy Core/.test(stats), "F-180's literals");
    // Polish Phase 3 (2026-10-14): the cost card is the session's cost at the Admin Panel's prices, formatted by the pricing
    // module, "no price set" when a model has no row and no default; never the orchestrator's zero (U-PRICING).
    assert.match(stats, /Session Cost/);
    assert.match(stats, /formatMoney\(ses\.cost\.amount, ses\.cost\.currency\)/);
    assert.ok(!/not metered on this deployment|cumulativeCost\.toFixed/.test(stats));
    assert.match(stats, /session = null, servedModel = null/);
    for (const field of ["lastWallMs", "lastModelMs", "meanModelMs", "promptShare", "completionShare", "estimatedTurns", "totalWallMs"]) assert.ok(new RegExp(`s\\.${field}`).test(stats), `reads ${field} from the aggregate`);
    assert.ok(!/\* 0\.\d|\/ 1000|toFixed\(1\)/.test(stats.replace(/cumulativeCost\.toFixed\(4\)/, "")), "no local arithmetic on the figures (the cost's own toFixed aside)");
  });

  test("the two runners name `timing` in their turn records (the dry run's compare and the figure judge read it)", () => {
    assert.match(runner, /timing: j \? j\.timing \?\? null : null,/);
    assert.match(figq, /timing: j \? j\.timing \?\? null : null,/);
  });
});

describe("U-FAIL/T49: the cited figure's preview and the footer's legend — the pure module gates the chip, the no-image chip is byte-identical, nothing is fetched at render, the lightbox is a dialog, the citation carries the stored title and both runners project it (t49-design.md §2, §4; F-178, F-184)", () => {
  // Measured before the ticket (t49-design.md §0): 28 of the 43 chips on T44's acceptance record carry a path — the
  // bridge's whole-page render — and the chip printed text only; a ranked caption chunk's chip read like the page's
  // text chunk's (F-184). No JSX renderer in this runner: the rendered chip, popover, lightbox and pills are the
  // owner's look; these pins are the source-level half of acceptance 1 / 2 (design §4).
  const panel = fs.readFileSync(path.join(REPO_ROOT, "src", "components", "ChatPanel.jsx"), "utf-8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const cites = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "rag", "citations.js"), "utf-8"));
  const runner = fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "dryrun-artifacts", "run_dry_run.js"), "utf-8");
  const figq = fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "workshop-artifacts", "ab", "run_figure_questions.js"), "utf-8");
  const CHIP_CLASS = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider bg-white/5 text-neutrals-medium border border-white/10";
  const esc = (str) => str.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

  test("(1) ChatPanel imports previewFor and gates the button on it: no preview → the <span>; a preview → a <button type=\"button\"> with the glyph after the text (D1 a, D2 a)", () => {
    assert.match(panel, /import \{ previewFor \} from "@\/lib\/rag\/figure_preview";/);
    assert.strictEqual((panel.match(/previewFor\(/g) || []).length, 1, "called once, on the citation");
    assert.match(panel, /const preview = previewFor\(cite\);/);
    assert.match(panel, /if \(!preview\) \{\s*return \(\s*<span key=\{cite\.marker \|\| cIdx\} className="/);
    assert.match(panel, /<button\s+key=\{cite\.marker \|\| cIdx\}\s+type="button"\s+title="Show the cited figure"/);
    assert.match(panel, /\{chipBody\}\s*<RiImageLine size=\{10\} aria-hidden="true" \/>\s*<\/button>/, "the 10 px glyph AFTER the chip's text — the text unchanged");
    assert.match(panel, /RiImageLine, RiCloseLine \} from "@remixicon\/react";/);
  });

  test("(2) the no-preview <span>'s class string is byte-identical to today's, and the chip's children expressions are unchanged — each present exactly once, inside the shared fragment", () => {
    assert.match(panel, new RegExp(`<span key=\\{cite\\.marker \\|\\| cIdx\\} className="${esc(CHIP_CLASS)}">\\s*\\{chipBody\\}\\s*<\\/span>`));
    const once = (re, what) => assert.strictEqual((panel.match(re) || []).length, 1, `${what} appears exactly once`);
    once(/\[\{cite\.marker\}\] \{cite\.source\}/g, "the marker and the source");
    once(/\{cite\.page != null\s*\? ` · \$\{cite\.locationKind === "slide" \? "slide" : "p\."\}\$\{cite\.locationKind === "slide" \? " " : ""\}\$\{cite\.page\}`\s*: cite\.sectionPath\s*\? <span title=\{cite\.sectionPath\}>\{` · §\$\{String\(cite\.sectionPath\)\.split\(" › "\)\.pop\(\)\}`\}<\/span>\s*: ""\}/g, "the T34 location ternary");
    once(/\{cite\.companionKind === "caption" \? " · figure" : cite\.companionKind === "text" \? " · page text" : ""\}/g, "the T28 companion suffix");
    const fragment = panel.slice(panel.indexOf("const chipBody = ("), panel.indexOf("if (!preview) {"));
    assert.ok(/<>\s*\[\{cite\.marker\}\] \{cite\.source\}/.test(fragment) && /" · page text" : ""\}\s*<\/>/.test(fragment), "the three children live in ONE fragment — the DOM is the span's children as before");
    // The button carries the same string plus the hover / focus classes; the chip's TEXT gains no word (D2 a, never c).
    assert.match(panel, new RegExp(`className="${esc(CHIP_CLASS)} cursor-pointer hover:border-brand-vivid\\/50 hover:text-neutrals-light focus-visible:border-brand-vivid"`));
    assert.strictEqual((panel.match(/" · figure"/g) || []).length, 1, "the word figure is the T28 suffix's alone");
  });

  test("(3) every <img in the panel sits inside a hoverPreview && or lightbox && guard — nothing is fetched at render (D5)", () => {
    const imgs = [...panel.matchAll(/<img\b/g)].map((m) => m.index);
    assert.strictEqual(imgs.length, 2, "one in the popover, one in the lightbox");
    const hover = panel.indexOf("{hoverPreview && (");
    const light = panel.indexOf("{lightbox && (");
    assert.ok(hover > 0 && light > hover, "the two guards, the popover first");
    assert.ok(imgs[0] > hover && imgs[0] < light, "the popover's image is inside the hoverPreview guard");
    assert.ok(imgs[1] > light, "the lightbox's image is inside the lightbox guard");
    assert.ok(!/<img\b/.test(panel.slice(0, hover)), "no image element before the guards — the chips row renders none");
    assert.match(panel, /onMouseEnter=\{\(e\) => showPreview\(e, preview, cite\.marker\)\}/);
    assert.match(panel, /onFocus=\{\(e\) => showPreview\(e, preview, cite\.marker\)\}/);
    assert.match(panel, /onMouseLeave=\{\(\) => setHoverPreview\(null\)\}/);
    assert.match(panel, /onBlur=\{\(\) => setHoverPreview\(null\)\}/);
    assert.match(panel, /src=\{hoverPreview\.preview\.src\}\s*alt=\{hoverPreview\.preview\.alt\}\s*loading="eager"/);
    assert.match(panel, /src=\{lightbox\.preview\.src\}\s*alt=\{lightbox\.preview\.alt\}/);
  });

  test("(4) the lightbox is a dialog: role, aria-modal, an Escape handler, click-outside, a close button, focus back to the opener, and a failed load disclosed with the path — never a broken icon", () => {
    assert.match(panel, /<figure\s+role="dialog"\s+aria-modal="true"\s+aria-label=\{lightbox\.preview\.caption\}/);
    assert.match(panel, /const onKey = \(e\) => \{ if \(e\.key === "Escape"\) closeLightbox\(\); \};\s*window\.addEventListener\("keydown", onKey\);/);
    assert.match(panel, /return \(\) => window\.removeEventListener\("keydown", onKey\);/, "the listener lives only while the lightbox is open");
    assert.match(panel, /onClick=\{closeLightbox\}>\s*<figure/, "a click on the backdrop closes");
    assert.match(panel, /onClick=\{\(e\) => e\.stopPropagation\(\)\}\s*>\s*<button\s+ref=\{lightboxCloseRef\}/, "a click inside does not");
    assert.match(panel, /aria-label="Close"/);
    assert.match(panel, /if \(opener && typeof opener\.focus === "function"\) opener\.focus\(\);/, "focus returns to the chip that opened it");
    assert.match(panel, /opener: e\.currentTarget/);
    assert.match(panel, /The crop could not be loaded: \{lightbox\.preview\.src\} — the crops route answered an error; see the container log\./);
    assert.match(panel, /crop not available/, "the popover's failed line");
    assert.match(panel, /\[\{lightbox\.marker\}\] · \{lightbox\.preview\.caption\}/, "the caption: the marker, the stored title, the source · location (D3 a)");
    assert.match(panel, /onScroll=\{\(\) => setHoverPreview\(null\)\}/, "the log's scroll clears a stale popover");
  });

  test("(5) the new code fetches nothing, computes nothing from `timing`, reads no clock; the popover is fixed from the chip's rect", () => {
    assert.strictEqual((panel.match(/\bfetch\(/g) || []).length, 0, "no fetch at all: the saved-task dropdown, the one pre-existing fetch, was removed by the Enablers PR (the owner's unlock, 2026-10-06)");
    assert.ok(!/Date\.now|new Date|toFixed/.test(panel), "no clock, no arithmetic on a figure");
    assert.ok(!/timing\.(wallMs|stages|tokens|model)/.test(panel), "the panel reads `timing` through the formatter only");
    assert.match(panel, /placePreview\(e\.currentTarget\.getBoundingClientRect\(\)\)/, "placed from the chip's rect");
    assert.match(panel, /const above = rect\.top >= 260;/, "below the chip when it sits within 260 px of the viewport's top");
    assert.match(panel, /className="fixed z-\[55\] pointer-events-none/);
    assert.match(panel, /className="fixed inset-0 z-\[70\] flex items-center justify-center bg-black\/80 backdrop-blur-sm p-6"/);
    assert.match(panel, /className="max-w-\[92vw\] max-h-\[82vh\] object-contain rounded-lg bg-white"/, "the page fitted in the lightbox (D4)");
    assert.match(panel, /className="max-h-60 max-w-\[20rem\] object-contain rounded-lg border border-white\/15 bg-white shadow-2xl"/, "a portrait page in the popover");
  });

  test("(6) citations.js pushes `title` from the stored humanTitle, and headerFor's parts are unchanged — the prompt carries no title (D3 a: no prompt byte moves)", () => {
    assert.match(cites, /title: asString\(meta\.humanTitle\)\.trim\(\) \|\| null,/);
    assert.strictEqual((cites.match(/humanTitle/g) || []).length, 1, "read once, for the citation");
    const header = cites.slice(cites.indexOf("function headerFor("), cites.indexOf("function companionOf("));
    assert.ok(header.length > 0);
    assert.ok(!/humanTitle|[Tt]itle:/.test(header), "headerFor names no title");
    assert.strictEqual((header.match(/parts\.push\(/g) || []).length, 5, "the five pushes — page / slide, section, lines, OCR, companion");
    for (const literal of ['"Slide" : "Page"', "Section: ", "Lines: ", '"Text: OCR"', "Companion: "]) assert.ok(header.includes(literal), literal);
    assert.match(header, /const parts = \[`Document: \$\{chunk\.source \|\| "Unknown Document"\}`\];/);
  });

  test("(7) both runners project `title` on every citation (memory chat-route-projects-result-fields)", () => {
    assert.match(runner, /imagePath: c\.imagePath \?\? null, title: c\.title \?\? null,/);
    assert.match(figq, /imagePath: c\.imagePath \?\? null, title: c\.title \?\? null,/);
  });

  test("(8) the figure runner records imageChecks — a HEAD per cited path, 15 s, ERR on failure — after citations; the dry-run runner's field is unchanged", () => {
    assert.match(figq, /async function imageStatus\(p\) \{\s*try \{ const r = await fetch\(APP \+ p, \{ method: "HEAD", signal: AbortSignal\.timeout\(15000\) \}\); return r\.status; \} catch \(e\) \{ return "ERR"; \}/);
    assert.match(figq, /for \(const c of citations \|\| \[\]\) if \(c\.imagePath\) imageChecks\.push\(\{ imagePath: c\.imagePath, status: await imageStatus\(c\.imagePath\) \}\);/);
    assert.match(figq, /citations,\s*imageChecks,\s*citedGoldenPage:/);
    assert.match(runner, /async function imageStatus\(p\) \{\s*try \{ const r = await fetch\(APP \+ p, \{ method: "HEAD", signal: AbortSignal\.timeout\(15000\) \}\); return r\.status; \} catch \(e\) \{ return "ERR"; \}/, "the same check, verbatim");
    assert.match(runner, /uncitedClaims: j && Array\.isArray\(j\.uncitedClaims\) \? j\.uncitedClaims : null,\s*imageChecks,/);
  });
});
