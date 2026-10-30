/**
 * I-ROUTER — the single mode router end to end through /api/chat on a FRESH
 * v2 class (ticket T15, t15-design.md §10; FM-N4 / E27 / E28 / E29, F-97 on
 * lookup turns, D4 / D5 / D6 / D7).
 *
 * Builds `RAGEval_<stamp>_t15V2` from the two Barratt documents F-97's cases
 * are about — the Site Plan (7 pages, 7 captions) and the one-chunk
 * SaxonFields brochure — ~5 min of VLM captioning, so it rides with the T28
 * suites, not the seven gates. Every assertion is STRUCTURAL (fields, which
 * document, which profile, how many messages); what the model writes is
 * judged by the dry run.
 *
 * Cleanup: this suite's own class only, through the schema API. The two
 * documents' crop folders are SHARED with production and never touched
 * (F-95). Runs in-pod; every credential from the pod env.
 */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { envConfig, skipReason, makeRunCollection, postJson, waitForIngestion } = require("./_harness");
const { RAG_SETTINGS_DEFAULTS } = require(path.join(process.cwd(), "src", "lib", "rag", "config.js"));

const config = envConfig();
const SKIP = skipReason();
const BASE = config ? makeRunCollection("t15") : null;
const CLASS = BASE ? `${BASE}V2` : null;

const FILES = ["demos/demo_files/ext_reg_docs/Barratt_Homes_SitePlan.pdf", "demos/demo_files/ext_reg_docs/Barratt_Homes-SaxonFields.pdf"];
const SITEPLAN = "Barratt_Homes_SitePlan.pdf";
const SAXON = "Barratt_Homes-SaxonFields.pdf";

// The owner's wordings (inputs/prompts/test_questions.txt), verbatim.
const Q8 = "specifically in relation to the Chester design - how much square footage does this house design provide in total?";
const CHESTER = "specifically in relation to the Chester design - how much square footage does this house design provide? please break that down by floor / level.";
const FOLLOW_UP = "and how many bedrooms does it have, and which floor are they on?";
// The paraphrase trio of the design (§0 item 5): three routes before T15.
const PARAPHRASES = ["summarise the Chester design's rooms", "write me a summary of the Chester design's rooms", "what rooms does the Chester design have?"];
// Two documents named by their distinctive stem tokens (A18): "siteplan" and "saxonfields".
// A11: a NAME counts only when retrieval ranked the document — the one-chunk
// brochure is not always ranked for this question, so the SET cases below
// select both documents explicitly (the request path, deterministic) and a
// separate case checks the name rule's corroboration.
const TWO_DOCS = "list every house design in the SitePlan and in the SaxonFields brochure, with the number of bedrooms of each";
const ONE_NAMED = "list every house design in the SitePlan with the number of bedrooms of each";

const CHAT_TIMEOUT_MS = 900000;

function adminConfig(ragOver = {}, extra = {}) {
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
    ...extra,
  };
}

async function chat(message, { ragOver = {}, admin = {}, body = {} } = {}) {
  const res = await postJson(`${config.appUrl}/api/chat`, { message, history: [], adminConfig: adminConfig(ragOver, admin), ...body }, CHAT_TIMEOUT_MS);
  assert.strictEqual(res.ok, true, `chat failed: ${res.status} ${String(res.text).slice(0, 300)}`);
  const traces = Array.isArray(res.json.traces) ? res.json.traces : [];
  return {
    j: res.json,
    rag: traces.find((t) => t.details && t.details.report !== undefined) || null,
    router: traces.find((t) => t.title === "Mode Router") || null,
    scope: traces.find((t) => t.title === "Turn Scope") || null,
    assembly: traces.find((t) => t.title === "Page Context Assembly") || null,
    llm: traces.find((t) => t.category === "llm_inference") || null,
  };
}

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
  const final = await waitForIngestion(config.appUrl, started.json && started.json.jobId ? started.json.jobId : null, 3600000);
  assert.ok(final && ["completed", "complete", "done", "idle"].includes(String(final.status)), `ingest into ${BASE} ended ${JSON.stringify(final).slice(0, 300)}`);
  process.stderr.write(`[i-router] ingested ${FILES.length} files into ${CLASS}: ${final.chunksIndexed} chunks\n`);
});

after(async () => {
  if (SKIP || !CLASS) return;
  assert.match(CLASS, /^RAGEval_/, "teardown may only delete this suite's own class");
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  await fetch(`${config.weaviateUrl}/v1/schema/${CLASS}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
  const gone = await fetch(`${config.weaviateUrl}/v1/schema/${CLASS}`, { headers, signal: AbortSignal.timeout(15000) });
  if (gone.status !== 404) console.warn(`[i-router teardown] ${CLASS} still answers ${gone.status}`);
});

describe("I-ROUTER: the scope on a lookup turn (design D4; F-97)", () => {
  test("1. Q8's wording: the turn is scoped to the Site Plan by vote; every ranked brochure chunk is left out of the prompt and counted; the answer cites the Site Plan only", { skip: SKIP }, async () => {
    const { j, rag, scope, router } = await chat(Q8);
    assert.strictEqual(j.success, true, `the turn failed: ${JSON.stringify({ error: j.error, retrieval: j.retrieval, response: String(j.response || "").slice(0, 160) }).slice(0, 400)}`);
    assert.strictEqual(j.retrieval.state, "ok");
    assert.ok(router && router.details.mode === "doc" && router.details.intent === "lookup", JSON.stringify(router && router.details));
    assert.deepStrictEqual([j.router.mode, j.router.intent], ["doc", "lookup"]);
    assert.ok(j.documentScope && j.documentScope.enumeration === false, JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.method, "vote");
    assert.strictEqual(j.documentScope.documents[0].source, SITEPLAN);
    const rankedForeign = (rag.details.retrievedChunks || []).filter((c) => c.source !== SITEPLAN).length;
    assert.strictEqual(j.documentScope.excludedForeign, rankedForeign, `every ranked foreign chunk is excluded (ranked ${rankedForeign})`);
    assert.ok(scope && /^SCOPED: /.test(scope.badge), scope && scope.badge);
    assert.strictEqual((scope.details.excluded || []).length, rankedForeign);
    for (const c of j.citations || []) assert.strictEqual(c.source, SITEPLAN, `a citation from another document: ${JSON.stringify(c)}`);
    // A companion never comes from an excluded chunk (the page read is over the in-scope set).
    if (j.contextAssembly && j.contextAssembly.companionsAdded > 0) for (const c of j.citations || []) if (c.companionKind) assert.strictEqual(c.source, SITEPLAN);
  });

  test("2. lookupScope off: no scope is resolved, the ranked set is shown whole (the before on the same image)", { skip: SKIP }, async () => {
    const { j, scope } = await chat(Q8, { ragOver: { lookupScope: "off" } });
    assert.strictEqual(j.documentScope, null);
    assert.strictEqual(scope, null);
    assert.strictEqual(j.retrieval.state, "ok");
  });

  test("3. a request scope naming the brochure on a Chester question: retrieval itself is limited to it (pre-filter), every shown passage is the brochure's, and the scope says selected", { skip: SKIP }, async () => {
    const { j, rag } = await chat(CHESTER, { body: { documentScope: [SAXON] } });
    assert.strictEqual(j.documentScope.method, "request", JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.prefilter, true);
    assert.deepStrictEqual(j.documentScope.documents.map((d) => d.source), [SAXON]);
    const rep = rag.details.report;
    assert.ok(rep && rep.documentFilter, "the retrieve report carries the filter");
    assert.ok(["sourceId", "source"].includes(rep.documentFilter.applied), JSON.stringify(rep.documentFilter));
    for (const c of rag.details.retrievedChunks || []) assert.strictEqual(c.source, SAXON, `retrieval returned a chunk outside the selected document: ${c.source}`);
    assert.strictEqual(j.documentScope.excludedForeign, 0);
    const ignored = await chat(CHESTER, { body: { documentScope: ["Nope.pdf"] } });
    assert.notStrictEqual(ignored.j.documentScope && ignored.j.documentScope.method, "request", "a name the store lacks is ignored");
  });
});

describe("I-ROUTER: one rule for the mode, the budget and the model (design D2, D7, D9; E27 / E28)", () => {
  test("4. the paraphrase trio through /api/chat with /doc: the same mode, the same retrieval budgets, the same model", { skip: SKIP }, async () => {
    const turns = [];
    for (const q of PARAPHRASES) turns.push(await chat(q));
    const shape = (t) => ({ mode: t.j.router.mode, intent: t.j.router.intent, limit: t.rag.details.report.searchLimitUsed, keep: t.rag.details.report.keepTopNAfterRerank, model: t.llm.details.modelName, profile: t.j.router.model.profile });
    const [a, b, c] = turns.map(shape);
    assert.strictEqual(a.mode, "doc");
    assert.deepStrictEqual(b, a, `"write me a summary" is the same turn as "summarise": ${JSON.stringify([a, b])}`);
    assert.deepStrictEqual(c, a);
  });

  test("5. /code selects the CODE profile — URL, model and credential from one object; a legacy request uses its trio for every mode", { skip: SKIP }, async () => {
    const profiles = {
      chat: { endpointType: "ollama", url: config.chatUrl, token: process.env.RAG_EVAL_CHAT_TOKEN || "", model: config.chatModel },
      code: { endpointType: "ollama", url: config.chatUrl, token: process.env.RAG_EVAL_CHAT_TOKEN || "", model: config.chatModel },
    };
    const code = await chat("write a python function that returns the Chester design's total square footage as a float", { admin: { forcedCommand: "/code", modelProfiles: profiles } });
    assert.strictEqual(code.j.success, true, code.j.error);
    assert.deepStrictEqual([code.j.router.mode, code.j.router.model.profile, code.j.router.model.source], ["code", "code", "modelProfiles"]);
    assert.strictEqual(code.j.router.model.model, config.chatModel);
    assert.ok(String(code.llm.details.targetUrl).startsWith(config.chatUrl.replace(/\/$/, "")), `the code profile's URL was dispatched: ${code.llm.details.targetUrl}`);
    assert.strictEqual(code.llm.details.modelName, config.chatModel);
    assert.ok(!JSON.stringify(code.j.router).includes(process.env.RAG_EVAL_CHAT_TOKEN || "§never§"), "no credential on the wire");
    const legacy = await chat("write a python function that returns 1", { admin: { forcedCommand: "/code" } });
    assert.deepStrictEqual([legacy.j.router.mode, legacy.j.router.model.profile, legacy.j.router.model.source], ["code", "code", "legacy"]);
    assert.strictEqual(legacy.llm.details.modelName, config.chatModel, "the legacy trio's model, never another agent's");
  });
});

describe("I-ROUTER: history in doc mode (design D6; E29)", () => {
  test("6. a follow-up with the previous turn in history: the model receives system + 2 history + the question", { skip: SKIP }, async () => {
    const first = await chat(CHESTER);
    assert.strictEqual(first.j.success, true, `turn 1 failed: ${JSON.stringify({ error: first.j.error, retrieval: first.j.retrieval, response: String(first.j.response || "").slice(0, 160) }).slice(0, 400)}`);
    assert.strictEqual(first.llm.details.messagesCount, 2, "turn 1: system + user");
    const history = [{ sender: "user", text: CHESTER, timestamp: "t" }, { sender: "ai", text: first.j.response, timestamp: "t" }];
    const second = await chat(FOLLOW_UP, { body: { history } });
    assert.strictEqual(second.j.success, true);
    assert.strictEqual(second.llm.details.messagesCount, 4, "turn 2: system + user + assistant + user — doc mode no longer drops the history");
    assert.strictEqual(second.j.router.mode, "doc");
  });
});

describe("I-ROUTER: the set and the budget on an enumeration turn (design D5)", () => {
  test("7. two documents selected on the request: both in scope, both read whole (they fit), nothing foreign; and a name counts only when retrieval ranked it (A11)", { skip: SKIP }, async () => {
    const { j, scope } = await chat(TWO_DOCS, { body: { documentScope: [SITEPLAN, SAXON] } });
    assert.strictEqual(j.documentScope.method, "request", JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.prefilter, true);
    assert.deepStrictEqual(j.documentScope.documents.map((d) => d.source).sort(), [SAXON, SITEPLAN].sort());
    assert.strictEqual(j.documentScope.coverage, "complete", JSON.stringify(j.documentScope.reads));
    assert.strictEqual((j.documentScope.reads || []).length, 2);
    for (const r of j.documentScope.reads) assert.strictEqual(r.coverage, "complete", JSON.stringify(r));
    assert.deepStrictEqual(j.documentScope.unread, []);
    assert.strictEqual(j.documentScope.excludedForeign, 0);
    assert.strictEqual(j.documentScope.noteWording, "complete");
    assert.strictEqual(j.contextAssembly.mode, "document");
    assert.match(scope.badge, /^WHOLE DOCUMENT/);
    assert.strictEqual(j.documentScope.chunksRead, j.documentScope.chunksInStore, "every stored chunk of both documents was read");
    // The name rule: a named document that retrieval ranked is the scope;
    // a named document retrieval did not rank is reported and ignored.
    const named = await chat(ONE_NAMED);
    assert.strictEqual(named.j.documentScope.method, "named", JSON.stringify(named.j.documentScope));
    assert.deepStrictEqual(named.j.documentScope.documents.map((d) => d.source), [SITEPLAN]);
    assert.strictEqual(named.j.documentScope.prefilter, false, "a name filters after ranking");
    const two = await chat(TWO_DOCS);
    assert.ok(["named", "vote"].includes(two.j.documentScope.method), JSON.stringify(two.j.documentScope));
    const twoDocs = two.j.documentScope.documents.map((d) => d.source);
    const rankedSources = new Set((two.rag.details.retrievedChunks || []).map((c) => c.source));
    for (const d of twoDocs) assert.ok(rankedSources.has(d), `a named document in scope was ranked: ${d}`);
    // The dropped name is reported by whichever path resolved the scope: the named path says
    // `("saxonfields" named nothing retrieval found)`, the vote path `"saxonfields" named a document retrieval did not rank`.
    if (!rankedSources.has(SAXON)) assert.match(String(two.j.documentScope.reason), /"saxonfields" named (a document retrieval did not rank|nothing retrieval found)/);
  });

  test("8. a budget that fits one of the two: the smaller is read whole, the larger is left unread and NAMED, the note wording is cautious", { skip: SKIP }, async () => {
    // T35: the brochure carries its OCR text now — 6,595 chars ≈ 2,061 tokens at CHARS_PER_TOKEN 3.2 (5,209 ≈ 1,628 before);
    // the budget that fits one of the two is 3,000 (the Site Plan is ≈ 9,851). The case's rule is unchanged (t35-design §11a A15).
    const { j, scope } = await chat(TWO_DOCS, { ragOver: { documentContextBudget: 3000 }, body: { documentScope: [SITEPLAN, SAXON] } });
    assert.strictEqual(j.documentScope.method, "request");
    assert.strictEqual((j.documentScope.reads || []).length, 1, JSON.stringify(j.documentScope));
    assert.strictEqual(j.documentScope.reads[0].source, SAXON, "the one that fits");
    assert.strictEqual(j.documentScope.reads[0].coverage, "complete");
    assert.deepStrictEqual((j.documentScope.unread || []).map((u) => u.source), [SITEPLAN]);
    assert.strictEqual(j.documentScope.coverage, "partial");
    assert.strictEqual(j.documentScope.noteWording, "partial");
    assert.strictEqual(j.contextAssembly.mode, "document", "the whole brochure is shown, the Site Plan's ranked passages follow");
    assert.match(scope.badge, /^WHOLE DOCUMENT \(1 OF 2\)/);
    assert.match(scope.description, /Not read \(over the budget\): Barratt_Homes_SitePlan\.pdf/);
  });
});

// ── T30 (t30-design.md §7; F-114): the retrieval query of a follow-up turn ──
// The page's shape: the previous user + assistant messages as the history,
// the assistant entry carrying the previous turn's `documentScope` (D7).
describe("I-ROUTER/T30: a follow-up retrieves with its referent (design D2–D7)", () => {
  const CHESTER_PAGE = 3;
  const referentRank = (rag) => (rag.details.retrievedChunks || []).findIndex((c) => c.source === SITEPLAN && Number(c.page) === CHESTER_PAGE);

  test("9. the F-114 pair: turn B's retrieval query is turn A plus turn B; the Chester page ranks FIRST; the scope is the Site Plan; the model still receives system + 2 history + the bare follow-up", { skip: SKIP }, async () => {
    const first = await chat(Q8);
    assert.strictEqual(first.j.success, true, `turn 1 failed: ${JSON.stringify({ error: first.j.error, retrieval: first.j.retrieval, response: String(first.j.response || "").slice(0, 160) }).slice(0, 400)}`);
    assert.strictEqual(first.j.router.followUp, null, "no history → nothing to say");
    assert.strictEqual(first.rag.details.retrievalQuery, Q8, "turn A retrieves on its own words");
    const history = [{ sender: "user", text: Q8, timestamp: "t" }, { sender: "ai", text: first.j.response, timestamp: "t", documentScope: first.j.documentScope }];
    const second = await chat(FOLLOW_UP, { body: { history } });
    assert.strictEqual(second.j.success, true);
    assert.deepStrictEqual([second.j.router.followUp.detected, second.j.router.followUp.applied, second.j.router.followUp.cue], [true, true, "and"], JSON.stringify(second.j.router.followUp));
    assert.strictEqual(second.j.router.followUp.previousTurnChars, Q8.length);
    assert.deepStrictEqual(second.j.router.followUp.previousScope, [SITEPLAN]);
    assert.strictEqual(second.rag.details.retrievalQuery, `${Q8} ${FOLLOW_UP}`, "the retrieval query is the previous turn plus this one");
    assert.strictEqual(second.rag.details.followUp.applied, true);
    assert.strictEqual(referentRank(second.rag), 0, `the Chester page (p${CHESTER_PAGE}) ranks first: ${JSON.stringify((second.rag.details.retrievedChunks || []).map((c) => `${c.source.slice(0, 8)}p${c.page}@${c.rerankScore}`))}`);
    assert.strictEqual(second.j.documentScope.method, "vote", "the vote still scopes it (the Site Plan holds every design)");
    assert.strictEqual(second.j.documentScope.documents[0].source, SITEPLAN);
    assert.strictEqual(second.llm.details.messagesCount, 4, "system + user + assistant + the BARE follow-up (T15 case 6 unchanged)");
    assert.match(second.router.description, /A follow-up \(opens with "and"\) — the retrieval query is the previous turn plus this one\./);
    assert.match(second.router.details.followUp.reason, /opens with "and"/);
  });

  test("10. the false-positive side: after the same turn A, a question naming the brochure is NOT prefixed — retrieved on its own words, scoped by its name", { skip: SKIP }, async () => {
    const first = await chat(Q8);
    const history = [{ sender: "user", text: Q8, timestamp: "t" }, { sender: "ai", text: first.j.response, timestamp: "t", documentScope: first.j.documentScope }];
    const fresh = "and what is the SaxonFields brochure about?";
    const { j, rag } = await chat(fresh, { body: { history } });
    assert.strictEqual(j.success, true);
    assert.deepStrictEqual([j.router.followUp.detected, j.router.followUp.applied], [true, false], JSON.stringify(j.router.followUp));
    assert.match(j.router.followUp.reason, /names "saxonfields" \(Barratt_Homes-SaxonFields\.pdf\) — a fresh referent/);
    assert.strictEqual(rag.details.retrievalQuery, fresh, "nothing of turn A in the query");
    // The one-chunk brochure is not always ranked for a question about it
    // (A15's lesson) — the T30 claim is what must NOT happen: the previous
    // turn's Site Plan carried forward. When the brochure IS ranked, its name
    // is corroborated and the scope is the brochure.
    assert.ok(!j.documentScope || j.documentScope.method !== "previous", JSON.stringify(j.documentScope));
    const brochureRanked = (rag.details.retrievedChunks || []).some((c) => c.source === SAXON);
    process.stderr.write(`[i-router 10] ranked ${JSON.stringify((rag.details.retrievedChunks || []).map((c) => `${c.source.slice(0, 8)}p${c.page}@${c.rerankScore}`))}; scope ${j.documentScope && j.documentScope.method}\n`);
    if (brochureRanked) {
      assert.ok(j.documentScope && ["named", "vote"].includes(j.documentScope.method), JSON.stringify(j.documentScope));
      assert.strictEqual(j.documentScope.documents[0].source, SAXON, "the brochure, not the previous turn's Site Plan");
    } else {
      assert.ok(!j.documentScope || j.documentScope.documents.every((d) => d.source !== SITEPLAN) || j.documentScope.method === "vote", "an uncorroborated name resolves by the vote, never by the previous turn");
    }
    // A no-cue, no-pronoun question after the pair is not a follow-up at all.
    const plain = await chat("which designs are in the brochure?", { body: { history } });
    assert.deepStrictEqual([plain.j.router.followUp.detected, plain.j.router.followUp.applied], [false, false]);
    assert.strictEqual(plain.rag.details.retrievalQuery, "which designs are in the brochure?");
  });

  test("11. the sticky scope (D6 / D7): a pronominal follow-up whose own vote is not dominant keeps the previous turn's document when retrieval ranked it; with bare history (no documentScope) the vote's own verdict stands", { skip: SKIP }, async () => {
    // Constructed (§0a found no vote-splitting case on the production corpus):
    // the previous turn resolved to the BROCHURE; the follow-up's words rank
    // both documents. Whether the vote splits depends on the ranking, so the
    // assertion is conditional on what retrieval returned — and reported.
    const first = await chat("what does the SaxonFields brochure say about the development?");
    const brochureScope = first.j.documentScope && first.j.documentScope.documents && first.j.documentScope.documents.length > 0 ? first.j.documentScope : { method: "request", documents: [{ source: SAXON }] };
    const history = [{ sender: "user", text: "what does the SaxonFields brochure say about the development?", timestamp: "t" }, { sender: "ai", text: first.j.response, timestamp: "t", documentScope: brochureScope }];
    const follow = "and how many bedrooms do they have?";
    const withScope = await chat(follow, { body: { history } });
    assert.strictEqual(withScope.j.success, true);
    assert.strictEqual(withScope.j.router.followUp.applied, true, JSON.stringify(withScope.j.router.followUp));
    assert.deepStrictEqual(withScope.j.router.followUp.previousScope, brochureScope.documents.map((d) => d.source));
    const votes = withScope.scope && withScope.scope.details ? withScope.scope.details.votes || [] : [];
    const top = votes[0];
    const dominant = top && top.share >= 0.5 && (!votes[1] || top.share > votes[1].share);
    const brochureRanked = (withScope.rag.details.retrievedChunks || []).some((c) => c.source === SAXON);
    process.stderr.write(`[i-router 11] votes ${JSON.stringify(votes)}; brochure ranked ${brochureRanked}; scope ${withScope.j.documentScope && withScope.j.documentScope.method}\n`);
    assert.ok(withScope.scope && withScope.scope.details && "previousScope" in withScope.scope.details, "the Turn Scope span reports the previous scope offered");
    assert.deepStrictEqual(withScope.scope.details.previousScope, brochureScope.documents.map((d) => d.source));
    if (!dominant && brochureRanked) {
      assert.strictEqual(withScope.j.documentScope.method, "previous", "the vote split and the brochure was ranked → carried forward");
      assert.match(withScope.scope.badge, /^SCOPED \(PREVIOUS\): /);
      assert.match(withScope.j.documentScope.reason, /carried forward from the previous turn/);
    } else if (dominant) {
      assert.strictEqual(withScope.j.documentScope.method, "vote", "a dominant vote beats the previous scope");
    } else {
      assert.ok(!withScope.j.documentScope || withScope.j.documentScope.method !== "previous", "not corroborated → not carried");
    }
    // The same turn with BARE history: no previous scope, the verdict is the vote's own — never "previous".
    const bare = await chat(follow, { body: { history: history.map((h) => ({ sender: h.sender, text: h.text, timestamp: h.timestamp })) } });
    assert.strictEqual(bare.j.router.followUp.previousScope, null);
    assert.ok(!bare.j.documentScope || bare.j.documentScope.method !== "previous", JSON.stringify(bare.j.documentScope));
  });
});
