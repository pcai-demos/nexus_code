/**
 * I-PAGECTX — page-level context assembly and document-scoped enumeration,
 * end to end through /api/chat on a FRESH v2 class (ticket T28,
 * t28-design.md §14; F-99, F-101, F-97, F-96).
 *
 * Builds `RAGEval_<stamp>_t28` (schemaVersion 2, stated on every request)
 * from the three demo documents the dry run's failures are about — the
 * Fervi manual (84 pages, 36 captions), the Site Plan (7 pages, 7 captions)
 * and the one-chunk SaxonFields brochure (the foreign document F-97
 * tabulated) — ~40 min of VLM captioning at the fresh-class leg's measured
 * rate, so this suite is a T28 suite, not one of the seven gates. Every
 * assertion is STRUCTURAL (fields, counts, pages, which document): what a
 * 27B model writes is judged by the dry run, not here.
 *
 * Cleanup: this suite's own class only (deleted through the store's schema
 * API, never the clear route). The three documents' crop folders are SHARED
 * with production (`RAGChunkV2` holds them) and are never touched (F-95).
 * Runs in-pod; every credential from the pod env (tests/eval/_credentials.sh).
 */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { envConfig, skipReason, makeRunCollection, postJson, waitForIngestion } = require("./_harness");
const { RAG_SETTINGS_DEFAULTS } = require(path.join(process.cwd(), "src", "lib", "rag", "config.js"));

const config = envConfig();
const SKIP = skipReason();
const BASE = config ? makeRunCollection("t28") : null;
const CLASS = BASE ? `${BASE}V2` : null;

const FILES = [
  "demos/demo_files/ext_reg_docs/Fervi_Lathe_TechnicalSupportManual.pdf",
  "demos/demo_files/ext_reg_docs/Barratt_Homes_SitePlan.pdf",
  "demos/demo_files/ext_reg_docs/Barratt_Homes-SaxonFields.pdf",
];
const FERVI = "Fervi_Lathe_TechnicalSupportManual.pdf";
const SITEPLAN = "Barratt_Homes_SitePlan.pdf";
const SAXON = "Barratt_Homes-SaxonFields.pdf";

// The owner's wordings (inputs/prompts/test_questions.txt), verbatim.
const Q3 = "I am trying to design my workshop space to house the T99 / 230v, to ensure stability? I need specific dimensions of where the fixing / support points should be located - use any figures in the manual to provide these dimensions";
const Q12 = "for each house design type please output the following:\nhouse design type\nnumber of bedrooms\nnumber of storeys\ntotal number of rooms\nroom dimensions in feet and inches and square footage per room\ntotal square footage of the building\nplease also output a summary table format of the information requested above";
const CHESTER = "specifically in relation to the Chester design - how much square footage does this house design provide? please break that down by floor / level.";
const FERVI_ALL = "list all the figure numbers mentioned in the fervi manual";
const COUNT_Q = 'how many times does the word "bedroom" appear?';

const CHAT_TIMEOUT_MS = 900000;

function adminConfig(ragOver = {}) {
  return {
    nimEndpoint: config.chatUrl,
    nimApiKey: process.env.RAG_EVAL_CHAT_TOKEN || "",
    nimModelName: config.chatModel,
    systemPrompt: "You are a helpful assistant.",
    temperature: 0.1,
    maxTokens: 4096,
    weaviateUrl: config.weaviateUrl,
    weaviateCollection: BASE,
    schemaVersion: 2,
    mlisToken: config.token,
    embedApiKey: config.token,
    embedEndpoint: config.embedUrl,
    embedModelName: config.embedModel,
    rerankEndpointUrl: config.rerankUrl,
    rerankModelName: config.rerankModel,
    rerankApiKey: config.rerankToken,
    ragSettings: { ...RAG_SETTINGS_DEFAULTS, weaviateCollection: BASE, ...ragOver },
    forcedCommand: "/doc",
  };
}

async function chat(message, ragOver = {}, extra = {}) {
  const res = await postJson(`${config.appUrl}/api/chat`, { message, history: [], adminConfig: adminConfig(ragOver), ...extra }, CHAT_TIMEOUT_MS);
  assert.strictEqual(res.ok, true, `chat failed: ${res.status} ${String(res.text).slice(0, 300)}`);
  assert.strictEqual(res.json.success, true, `no answer: ${String(res.json.error).slice(0, 300)}`);
  const traces = Array.isArray(res.json.traces) ? res.json.traces : [];
  return {
    j: res.json,
    rag: traces.find((t) => t.details && t.details.report !== undefined) || null,
    // T15: the span is the Turn Scope on every retrieving turn (design D13).
    scope: traces.find((t) => t.title === "Turn Scope") || null,
    assembly: traces.find((t) => t.title === "Page Context Assembly") || null,
    llm: traces.find((t) => t.category === "llm_inference") || null,
    summary: traces.find((t) => t.title === "Vector Store Inspection") || null,
  };
}

const isCaptionSnippet = (s) => /^\[HUMAN-LOGICAL VISUAL ELEMENT/.test(String(s || ""));

before(async () => {
  if (SKIP) return;
  const body = {
    filePaths: FILES,
    weaviateUrl: config.weaviateUrl,
    token: config.token,
    weaviateToken: config.token,
    mlisToken: config.token,
    embedUrl: config.embedUrl,
    embedModel: config.embedModel,
    embedApiKey: config.token,
    schemaVersion: 2,
    weaviateCollection: BASE,
    ragSettings: { weaviateCollection: BASE, allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"], maxFileSize: 50, duplicatePolicy: "skip" },
  };
  const started = await postJson(`${config.appUrl}/api/ingest`, body);
  assert.ok(started.status === 200 || started.status === 202, `ingest into ${BASE} refused: ${started.text}`);
  const final = await waitForIngestion(config.appUrl, started.json && started.json.jobId ? started.json.jobId : null, 3 * 3600000);
  assert.ok(final && ["completed", "complete", "done", "idle"].includes(String(final.status)), `ingest into ${BASE} ended ${JSON.stringify(final).slice(0, 300)}`);
  process.stderr.write(`[i-pagectx] ingested ${FILES.length} files into ${CLASS}: ${final.chunksIndexed} chunks\n`);
});

after(async () => {
  if (SKIP || !CLASS) return;
  assert.match(CLASS, /^RAGEval_/, "teardown may only delete this suite's own class");
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  await fetch(`${config.weaviateUrl}/v1/schema/${CLASS}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
  const gone = await fetch(`${config.weaviateUrl}/v1/schema/${CLASS}`, { headers, signal: AbortSignal.timeout(15000) });
  if (gone.status !== 404) console.warn(`[i-pagectx teardown] ${CLASS} still answers ${gone.status}`);
});

describe("I-PAGECTX: companions (design §1–§5; F-99)", () => {
  test("1. Q3's wording: the page-25 Figure 15 caption travels in as a companion of a page-25 passage, and the turn is a scoped lookup, not an enumeration", { skip: SKIP }, async () => {
    const { j, rag, scope, assembly } = await chat(Q3);
    assert.strictEqual(j.retrieval.state, "ok");
    // T15 (design D4): a lookup turn is scoped too — by the vote here (every
    // ranked chunk is the manual's) — and says so; it is not an enumeration.
    assert.ok(j.documentScope && j.documentScope.enumeration === false, JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.method, "vote");
    assert.strictEqual(j.documentScope.documents[0].source, FERVI);
    assert.ok(scope && /^SCOPED: /.test(scope.badge), scope && scope.badge);
    assert.ok(assembly, "the assembly span rides the trace");
    assert.strictEqual(j.contextAssembly.mode, "captions");
    assert.ok(j.contextAssembly.companionsAdded >= 1, `companions added: ${JSON.stringify(j.contextAssembly)}`);
    const fig15 = (assembly.details.added || []).find((a) => a.source === FERVI && a.page === 25 && a.kind === "caption");
    const rankedP25 = (rag.details.retrievedChunks || []).filter((c) => c.source === FERVI && c.page === 25);
    assert.ok(rankedP25.length >= 1, "a page-25 passage is among the ranked chunks (the anchor)");
    const keptCaption = rankedP25.some((c) => isCaptionSnippet(c.snippet));
    assert.ok(fig15 || keptCaption, `the Figure 15 caption is in the context — as a companion (${JSON.stringify(fig15)}) or already ranked`);
    if (fig15) {
      assert.strictEqual(fig15.anchor.page, 25);
      assert.strictEqual(fig15.anchor.source, FERVI);
      assert.match(fig15.snippet, /Figure 15/);
    }
    assert.strictEqual(j.contextAssembly.companionBlocks, j.contextAssembly.companionsAdded, "every companion became a numbered block");
    for (const c of j.citations || []) if (c.companionKind) assert.ok(c.page != null && c.companionOf !== undefined, "a cited companion names its page and its anchor");
  });

  // T65 (t65-design.md §12c, D11 (a)): only the Site Plan's text holds "Chester" in this class, so the question
  // selects it by name and a lookup reads it whole — no companions. lookupDocumentRead "ranked" (T63's knob, case 11)
  // keeps the selection and ranks within the Site Plan: the companion path cases 2 and 8 test. Case 14 pins the default.
  test("2. a Chester question keeping page-3 text: the page-3 caption is in the context exactly once", { skip: SKIP }, async () => {
    const { j, rag, assembly } = await chat(CHESTER, { lookupDocumentRead: "ranked" });
    assert.strictEqual(j.retrieval.state, "ok");
    assert.strictEqual(j.documentScope.method, "named", JSON.stringify(j.documentScope));
    const rankedP3 = (rag.details.retrievedChunks || []).filter((c) => c.source === SITEPLAN && c.page === 3);
    assert.ok(rankedP3.length >= 1, "a page-3 chunk is kept");
    const rankedCaptions = rankedP3.filter((c) => isCaptionSnippet(c.snippet)).length;
    const addedCaptions = (assembly.details.added || []).filter((a) => a.source === SITEPLAN && a.page === 3 && a.kind === "caption").length;
    assert.strictEqual(rankedCaptions + addedCaptions, 1, `the page-3 caption appears once (ranked ${rankedCaptions}, companion ${addedCaptions})`);
    if (rankedCaptions === 1) assert.ok(j.contextAssembly.companionsSkipped.alreadyKept >= 1 || addedCaptions === 0);
    for (const a of assembly.details.added || []) assert.strictEqual(a.page, a.anchor.page, "a companion is on its anchor's page");
  });

  test("8. the knob: off adds nothing and says so; page brings a retrieved figure's page text, at most four per page", { skip: SKIP }, async () => {
    // T65 (D11 (a)): ranked within the named Site Plan, as case 2.
    const off = await chat(CHESTER, { pageCompanions: "off", lookupDocumentRead: "ranked" });
    assert.strictEqual(off.j.documentScope.method, "named", JSON.stringify(off.j.documentScope));
    assert.strictEqual(off.j.contextAssembly.mode, "off");
    assert.strictEqual(off.j.contextAssembly.companionsAdded, 0);
    assert.match(off.assembly.badge, /COMPANIONS OFF/);
    const page = await chat(CHESTER, { pageCompanions: "page", lookupDocumentRead: "ranked" });
    assert.strictEqual(page.j.documentScope.method, "named", JSON.stringify(page.j.documentScope));
    assert.strictEqual(page.j.contextAssembly.mode, "page");
    const texts = (page.assembly.details.added || []).filter((a) => a.kind === "text");
    const perPage = {};
    for (const t of texts) {
      assert.strictEqual(t.page, t.anchor.page);
      const k = `${t.source}|${t.page}`;
      perPage[k] = (perPage[k] || 0) + 1;
      assert.ok(perPage[k] <= 4, "at most four text companions per page");
    }
  });
});

describe("I-PAGECTX: document scope (design §13; F-101, F-97, F-96)", () => {
  test("3. Q12's wording: the Site Plan is read whole in page order, every design caption is a block, the foreign brochure is excluded", { skip: SKIP }, async () => {
    const { j, rag, scope, assembly } = await chat(Q12);
    assert.strictEqual(j.retrieval.state, "ok");
    assert.ok(j.documentScope, "an enumeration turn reports its scope");
    assert.strictEqual(j.documentScope.method, "vote", JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.document.source, SITEPLAN);
    assert.strictEqual(j.documentScope.coverage, "complete", JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.chunksRead, j.documentScope.chunksInStore, "complete means every stored chunk was read");
    // The fresh class chunks the Site Plan into 17 (production's 26 came
    // from another settings fingerprint); the invariant is one read per
    // stored chunk and at least one chunk per page (A17).
    assert.ok(j.documentScope.chunksRead >= (j.documentScope.pages || 7), `at least one chunk per page: ${j.documentScope.chunksRead} for ${j.documentScope.pages} pages`);
    assert.strictEqual(j.documentScope.noteWording, "complete");
    assert.ok(Array.isArray(j.documentScope.pagesRead) && j.documentScope.pagesRead.length >= 1 && j.documentScope.pagesRead.length <= (j.documentScope.pages || 99), `pagesRead ${JSON.stringify(j.documentScope.pagesRead)}`);
    assert.strictEqual(j.contextAssembly.mode, "document");
    assert.match(scope.badge, /^WHOLE DOCUMENT/);
    assert.match(assembly.badge, /WHOLE DOCUMENT/);
    const rankedForeign = (rag.details.retrievedChunks || []).filter((c) => c.source !== SITEPLAN).length;
    assert.ok(j.documentScope.excludedForeign >= rankedForeign, `every ranked foreign chunk is excluded: ranked ${rankedForeign}, excluded ${j.documentScope.excludedForeign}`);
    for (const c of j.citations || []) assert.strictEqual(c.source, SITEPLAN, `a citation from another document: ${JSON.stringify(c)}`);
    assert.ok((j.citations || []).length >= 1, "the answer cites the document");
    const votes = scope.details.votes;
    assert.ok(Array.isArray(votes) && votes[0].source === SITEPLAN && votes[0].share >= 0.5, JSON.stringify(votes));
  });

  test("4. a question naming the Fervi manual: method named, the whole manual read, the prompt measured", { skip: SKIP }, async () => {
    const { j, llm } = await chat(FERVI_ALL);
    assert.strictEqual(j.documentScope.method, "named", JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.document.source, FERVI);
    assert.strictEqual(j.documentScope.coverage, "complete", JSON.stringify(j.documentScope));
    // 186 chunks on the fresh class (228 in production — a different
    // settings fingerprint); the invariant is every stored chunk read (A17).
    assert.ok(j.documentScope.chunksRead >= 100 && j.documentScope.chunksRead === j.documentScope.chunksInStore, `${j.documentScope.chunksRead} of ${j.documentScope.chunksInStore}`);
    assert.ok(j.documentScope.estimatedTokens >= 20000 && j.documentScope.estimatedTokens <= 80000, `estimate ${j.documentScope.estimatedTokens}`);
    assert.ok(llm, "the LLM span rides the trace");
    assert.ok(!j.telemetry.estimated ? j.telemetry.prompt_tokens >= 20000 : true, `a measured prompt of ≥ 20k tokens: ${JSON.stringify(j.telemetry)}`);
  });

  test("5. a budget below the document: coverage partial, the ranked path with companions, the cautious note wording", { skip: SKIP }, async () => {
    const { j, scope } = await chat(Q12, { documentContextBudget: 1000 });
    assert.strictEqual(j.documentScope.coverage, "partial", JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.document.source, SITEPLAN);
    assert.strictEqual(j.documentScope.noteWording, "partial");
    assert.strictEqual(j.documentScope.budgetTokens, 1000);
    assert.match(scope.badge, /PARTIAL COVERAGE/);
    assert.strictEqual(j.contextAssembly.mode, "captions", "the ranked path with companions");
  });

  test("6. enumerationScope off: the ranked path, reported as off", { skip: SKIP }, async () => {
    const { j, scope } = await chat(Q12, { enumerationScope: "off" });
    assert.strictEqual(j.documentScope.method, "off");
    assert.strictEqual(j.documentScope.coverage, "ranked");
    assert.match(scope.badge, /SCOPE OFF/);
    assert.strictEqual(j.contextAssembly.mode, "captions");
  });

  test("7. an aggregation question: neither step runs (T09's path untouched)", { skip: SKIP }, async () => {
    const { j, scope, assembly } = await chat(COUNT_Q);
    assert.strictEqual(j.contextAssembly, null);
    assert.strictEqual(j.documentScope, null);
    assert.strictEqual(scope, null);
    assert.strictEqual(assembly, null);
  });

  test("9. a request-level document scope wins, and a scope the store lacks is ignored", { skip: SKIP }, async () => {
    const { j } = await chat(Q12, {}, { documentScope: [FERVI] });
    assert.strictEqual(j.documentScope.method, "request");
    assert.strictEqual(j.documentScope.document.source, FERVI);
    const ignored = await chat(Q12, {}, { documentScope: ["Nope.pdf"] });
    assert.notStrictEqual(ignored.j.documentScope.method, "request");
    assert.strictEqual(ignored.j.documentScope.document.source, SITEPLAN);
  });
});

describe("I-PAGECTX/T63: a lookup on the ONE document the request selected is read whole when it fits (t63-design.md §2, §4; D2 (a), D4 (a), D5 (a), D8 (a))", () => {
  test("10. the Chester question with the Site Plan selected: the whole document in page order, no rerank, the lookup's own words, the whole-document floor", { skip: SKIP }, async () => {
    const { j, rag, scope, assembly } = await chat(CHESTER, {}, { documentScope: [SITEPLAN] });
    assert.strictEqual(j.router.intent, "lookup", "still a lookup — the scope decides, not the word list");
    assert.ok(j.documentScope && j.documentScope.enumeration === false, JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.method, "request");
    assert.strictEqual(j.documentScope.coverage, "complete", JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.chunksRead, j.documentScope.chunksInStore, "every stored chunk read");
    assert.strictEqual(j.documentScope.noteWording, "complete");
    assert.strictEqual(j.contextAssembly.mode, "document");
    assert.ok(rag && rag.details && rag.details.report, "the search still ran and reported (T12, D4 (a))");
    assert.strictEqual(rag.details.report.candidatesScored, null, "the reranker did not run (T10: null = not run)");
    assert.match(rag.description, /The reranker did not run: the selected document is read whole/);
    assert.match(scope.description, /^Lookup on the selected document: read the whole of Barratt_Homes_SitePlan\.pdf/);
    assert.match(scope.description, /the reranker did not run — every passage is shown/);
    assert.strictEqual(scope.details.rerankSkipped, true);
    assert.strictEqual(scope.details.lookupPlan.read, true);
    assert.strictEqual(assembly.details.mode, "document");
    assert.strictEqual(j.generation.budget.rule, "wholeDocument", "D5 (a): the whole-document floor");
    assert.strictEqual(j.generation.budget.floor, 16384);
  });

  test("11. lookupDocumentRead \"ranked\" restores today's path: the reranker runs, the ranked passages, the lookup line", { skip: SKIP }, async () => {
    const { j, rag, scope } = await chat(CHESTER, { lookupDocumentRead: "ranked" }, { documentScope: [SITEPLAN] });
    assert.strictEqual(j.documentScope.method, "request");
    assert.notStrictEqual(j.documentScope.coverage, "complete", JSON.stringify(j.documentScope));
    assert.ok(rag.details.report.candidatesScored > 0, "the reranker ran");
    assert.match(scope.description, /^Scoped to Barratt_Homes_SitePlan\.pdf by request/);
    assert.match(scope.description, /Not read whole: lookupDocumentRead is ranked — the ranked passages are shown\./);
    assert.notStrictEqual(j.generation.budget.rule, "wholeDocument");
  });

  test("12. two selected documents stay ranked (D2 (a): a lookup reads ONE document whole)", { skip: SKIP }, async () => {
    const { j, rag, scope } = await chat(CHESTER, {}, { documentScope: [SITEPLAN, SAXON] });
    assert.notStrictEqual(j.documentScope.coverage, "complete", JSON.stringify(j.documentScope));
    assert.ok(rag.details.report.candidatesScored > 0, "the reranker ran");
    assert.match(scope.description, /Not read whole: the request selected 2 documents — a lookup reads one whole\./);
  });

  test("13. a selected document over the budget stays ranked and says why (a request-level budget of 1,000)", { skip: SKIP }, async () => {
    const { j, rag, scope } = await chat(CHESTER, { documentContextBudget: 1000 }, { documentScope: [SITEPLAN] });
    assert.notStrictEqual(j.documentScope.coverage, "complete", JSON.stringify(j.documentScope));
    assert.ok(rag.details.report.candidatesScored > 0, "the reranker ran");
    assert.match(scope.description, /Not read whole: Barratt_Homes_SitePlan\.pdf \(≈\d+ estimated tokens\) exceeds the whole-document budget of 1000\./);
  });
});

describe("I-PAGECTX/T65: a name the question carries selects its document (t65-design.md §2, §12c; D2 (a), D6 (a), D11 (a))", () => {
  test("14. the Chester question, no document selected: named by its text, the whole Site Plan in page order, no rerank", { skip: SKIP }, async () => {
    const { j, rag, scope, assembly } = await chat(CHESTER);
    assert.strictEqual(j.router.intent, "lookup", "still a lookup — the name selects the document, not the intent");
    assert.strictEqual(j.documentScope.method, "named", JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.prefilter, true, "selected before retrieval");
    assert.strictEqual(j.documentScope.document.source, SITEPLAN);
    assert.strictEqual(j.documentScope.reason, `the question names "Chester", which only ${SITEPLAN}'s text holds`);
    assert.strictEqual(j.documentScope.coverage, "complete", JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.chunksRead, j.documentScope.chunksInStore, "every stored chunk read");
    assert.strictEqual(j.documentScope.contested, null, "a selection carries no contested list");
    assert.strictEqual(j.contextAssembly.mode, "document");
    assert.ok(rag && rag.details && rag.details.report, "the search still ran and reported");
    assert.strictEqual(rag.details.report.candidatesScored, null, "the reranker did not run (T10: null = not run)");
    assert.match(rag.description, /The reranker did not run: the named document is read whole/);
    assert.match(scope.description, /^Lookup on the named document: read the whole of Barratt_Homes_SitePlan\.pdf/);
    assert.match(scope.description, /the reranker did not run — every passage is shown/);
    assert.deepStrictEqual(scope.details.nameCensus.names, ["Chester"]);
    assert.deepStrictEqual(scope.details.nameCensus.holders.chester, [SITEPLAN], "the census: only the Site Plan's text holds the name");
    assert.strictEqual(scope.details.rerankSkipped, true);
    assert.strictEqual(scope.details.lookupPlan.read, true);
    assert.match(scope.details.lookupPlan.reason, /^the question's names selected Barratt_Homes_SitePlan\.pdf; /);
    assert.strictEqual(assembly.details.mode, "document");
    assert.strictEqual(j.generation.budget.rule, "wholeDocument", "T63's whole-document floor");
    for (const c of j.citations || []) assert.strictEqual(c.source, SITEPLAN, `a citation from another document: ${JSON.stringify(c)}`);
  });
});
