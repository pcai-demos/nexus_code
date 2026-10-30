/**
 * U-ROUTER — the single mode router, the pure module (ticket T15,
 * t15-design.md §2–§3, §10, §12a; FM-N4 / E27 / E28 / E29, F-111).
 *
 * Measured in-pod before this ticket (t15-design.md §0 items 5–7): two word
 * lists — the client's verb scorer and the orchestrator's keyword rule —
 * chose a turn's backend and mode independently and disagreed on nine of
 * the owner's twelve questions when typed without `/doc`; "write me a
 * summary of the required PPE" ran on the code model, and through the
 * page's default chat shape asked the nemotron endpoint for
 * `qwen3-coder:30b` (HTTP 404, no answer). These cases pin the one rule:
 * phrasing cannot change the mode, the budget or the model.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const {
  routeTurn,
  detectSlash,
  detectIdeSignal,
  detectCountTerm,
  detectIntent,
  selectModelProfile,
  stripMarkers,
  replayHistory,
  describeRoute,
  ENUMERATE_RETRIEVAL,
  ENUMERATE_CONTEXT_DEPTH,
  detectFollowUp,
  previousUserTurn,
  previousTurnScope,
  FOLLOW_UP_CUES,
  ANAPHORA_RE,
  FOLLOW_UP_PREFIX_MAX_CHARS,
} = require("../../src/lib/rag/router");

// The owner's twelve questions (inputs/prompts/test_questions.txt, the
// dry run's input), as asked — every one with the /doc prefix.
const OWNER_QUESTIONS = [
  "/doc how many different spindle speeds is the T999 / 230V capable of? And is the range of speeds variable or fixed?",
  "/doc when operating the T999 what are the required PPE (Personal Protective Equipment)?",
  "/doc I am trying to design my workshop space to house the T99 / 230v, to ensure stability? I need specific dimensions of where the fixing / support points should be located - use any figures in the manual to provide these dimensions",
  "/doc what are the stpes involved in Setting the System",
  "/doc how often should the lubrication oil be checked for the Longitudinal feed handwheel and what type of oil should be used?",
  "/doc based on the Phase 3 full site plan, how many homes of the different configuration types were built?",
  "/doc specifically in relation to the Chester design - how much square footage does this house design provide? please break that down by floor / level.",
  "/doc specifically in relation to the Chester design - how much square footage does this house design provide in total?",
  "/doc specifically in relation to the Hesketh design - how much square footage does this house design provide? please break that down by floor / level.",
  "/doc specifically in relation to the Alderney design - how much square footage does this house design provide in total?",
  "/doc based on the phase 3 site plan map, how many plots have been allocated to the Denby house design and what are the plot numbers?",
  "/doc for each house design type please output the following:\nhouse design type\nnumber of bedrooms\nnumber of storeys\ntotal number of rooms\nroom dimensions in feet and inches and square footage per room\ntotal square footage of the building\nplease also output a summary table format of the information requested above",
];
// The paraphrase pairs of the design (§0 item 5): before T15 the first
// three went three different ways (chat / code / IDE bridge).
const PARAPHRASES = [
  "summarise the required PPE when operating the T999",
  "write me a summary of the required PPE when operating the T999",
  "what PPE is required when operating the T999?",
  "show me the PPE requirements for the T999",
  "explain the PPE requirements in the Fervi manual",
  "list all the house designs in the site plan",
  "check the lubrication schedule for the lathe",
  "how do I fix the belt tension on the lathe?",
  "compare the Chester and the Hesketh designs",
  "create a table of the room sizes for the Alderney",
];

describe("U-ROUTER: the slash commands (D2)", () => {
  test("/chat, /doc, /rag, /code — case-insensitive, the prefix stripped, /docs is not /doc", () => {
    assert.deepStrictEqual(detectSlash("/doc hello"), { command: "/doc", mode: "doc", cleanMessage: "hello" });
    assert.deepStrictEqual(detectSlash("/RAG  hello there"), { command: "/rag", mode: "doc", cleanMessage: "hello there" });
    assert.strictEqual(detectSlash("/code fix it").mode, "code");
    assert.strictEqual(detectSlash("/chat hi").mode, "chat");
    assert.strictEqual(detectSlash("/docs are great"), null);
    assert.strictEqual(detectSlash("tell me about /doc"), null);
    assert.strictEqual(detectSlash(""), null);
    assert.strictEqual(detectSlash("/doc").cleanMessage, "/doc", "a bare command keeps the text (the page never sends one)");
  });

  test("a forcedCommand from the page wins; a command left in the text routes the same way (the runner's shape)", () => {
    const a = routeTurn({ message: "how many speeds?", forcedCommand: "/doc" });
    const b = routeTurn({ message: "/doc how many speeds?" });
    assert.strictEqual(a.mode, "doc");
    assert.strictEqual(a.modeSource, "slash");
    assert.strictEqual(b.mode, "doc");
    assert.strictEqual(a.cleanMessage, b.cleanMessage);
    assert.strictEqual(routeTurn({ message: "x", forcedCommand: "/CODE" }).mode, "code");
    assert.strictEqual(routeTurn({ message: "x", forcedCommand: "/nope" }).mode, "code", "an unknown command is no command");
  });
});

describe("U-ROUTER: the default mode is CODE — the owner's D2 (a coding assistant); doc only by /doc; chat only by /chat", () => {
  test("no slash command → code, whatever the words (the two verb lists are gone)", () => {
    for (const q of [...OWNER_QUESTIONS.map((q) => q.replace(/^\/doc\s*/i, "")), ...PARAPHRASES, "hello", "what are the FCA compliance rules for PCI?"]) {
      const r = routeTurn({ message: q });
      assert.strictEqual(r.mode, "code", q);
      assert.ok(["default", "ide-signal"].includes(r.modeSource), q);
    }
  });

  test("an IDE signal or an active file is REPORTED, never decisive; chat is only /chat", () => {
    assert.deepStrictEqual([routeTurn({ message: "explain this file" }).modeSource, routeTurn({ message: "explain this file" }).matched], ["ide-signal", "this file"]);
    assert.strictEqual(routeTurn({ message: "hi", ideState: { activeFile: { path: "a.py" } } }).matched, "ideState.activeFile");
    assert.strictEqual(routeTurn({ message: "fix line 12 of app.py" }).modeSource, "ide-signal");
    assert.strictEqual(routeTurn({ message: "/doc explain this file" }).mode, "doc", "a slash command beats an IDE signal");
    assert.strictEqual(routeTurn({ message: "/chat how are you" }).mode, "chat");
    assert.strictEqual(routeTurn({ message: "/chat list all the designs" }).intent, "lookup", "chat never retrieves, so it has no intent");
    assert.strictEqual(routeTurn({ message: "/chat x" }).retrieves, false);
    assert.strictEqual(detectIdeSignal("nothing here"), null);
  });

  test("total on junk", () => {
    for (const m of [undefined, null, "", 42, {}]) {
      const r = routeTurn({ message: m });
      assert.strictEqual(r.mode, "code");
      assert.strictEqual(typeof r.cleanMessage, "string");
    }
  });
});

describe("U-ROUTER: paraphrase invariance (FM-T4 / E27 — the backlog's acceptance test)", () => {
  test("the owner's twelve questions route to doc with identical budgets, whether the page stripped /doc or not", () => {
    for (const q of OWNER_QUESTIONS) {
      const asTyped = routeTurn({ message: q });
      const asPage = routeTurn({ message: q.replace(/^\/doc\s*/i, ""), forcedCommand: "/doc" });
      assert.strictEqual(asTyped.mode, "doc", q);
      assert.deepStrictEqual([asPage.mode, asPage.intent, asPage.retrieval, asPage.contextDepth], [asTyped.mode, asTyped.intent, asTyped.retrieval, asTyped.contextDepth], q);
    }
  });

  test("the paraphrase pairs: identical mode, identical retrieval overrides, identical depth — 'write me a summary' and 'summarise' are the same turn", () => {
    const routes = PARAPHRASES.map((q) => routeTurn({ message: q, forcedCommand: "/doc" }));
    for (const r of routes) {
      assert.strictEqual(r.mode, "doc");
      assert.strictEqual(r.contextDepth, r.intent === "enumerate" ? ENUMERATE_CONTEXT_DEPTH : null);
    }
    const [summarise, write, what] = routes;
    assert.deepStrictEqual([write.mode, write.intent, write.retrieval], [summarise.mode, summarise.intent, summarise.retrieval]);
    assert.deepStrictEqual([what.mode, what.intent, what.retrieval], [summarise.mode, summarise.intent, summarise.retrieval]);
    // Without /doc they are all code turns with the SAME budgets too (D9).
    const code = PARAPHRASES.map((q) => routeTurn({ message: q }));
    assert.ok(code.every((r) => r.mode === "code"));
    assert.deepStrictEqual(code[0].retrieval, code[1].retrieval);
  });

  test("the client and the server evaluate ONE function: the endpoint the page picks is the mode the server reports", () => {
    for (const q of [...OWNER_QUESTIONS, ...PARAPHRASES, "/code write a function", "/chat hi"]) {
      const client = routeTurn({ message: q });
      const endpoint = client.mode === "code" ? "/api/ide-bridge" : "/api/chat";
      const server = routeTurn({ message: client.cleanMessage, forcedCommand: client.slash ? client.slash.command : null });
      assert.strictEqual(server.mode, client.mode, q);
      assert.strictEqual(endpoint, server.mode === "code" ? "/api/ide-bridge" : "/api/chat");
    }
  });
});

describe("U-ROUTER: the intent taxonomy (D3 — lookup / enumerate / count; F-111 accepted coarse, the token reported)", () => {
  test("Q6 and Q12 enumerate (Q6 on the bare noun 'types', which is why the list is unchanged), the other ten look up", () => {
    const intents = OWNER_QUESTIONS.map((q) => routeTurn({ message: q }).intent);
    assert.deepStrictEqual(intents, ["lookup", "lookup", "lookup", "lookup", "lookup", "enumerate", "lookup", "lookup", "lookup", "lookup", "lookup", "enumerate"]);
    assert.strictEqual(routeTurn({ message: OWNER_QUESTIONS[5] }).intentRule.matched, "types");
    assert.strictEqual(routeTurn({ message: OWNER_QUESTIONS[11] }).intentRule.matched, "for each");
    assert.deepStrictEqual(routeTurn({ message: OWNER_QUESTIONS[11] }).retrieval, ENUMERATE_RETRIEVAL);
    // T42 (design D4 as corrected by the owner, §12a): ONE rerank deadline for every turn (the route's 60 s) — the profile names none.
    assert.deepStrictEqual(ENUMERATE_RETRIEVAL, { limit: 100, similarityThreshold: 0.15, candidatesToRerank: 50, keepTopNAfterRerank: 20 });
    assert.ok(!("rerankBudgetMs" in ENUMERATE_RETRIEVAL));
  });

  test("count beats enumerate beats lookup; T09's detector moved unchanged (quoted and bare forms, the stop-word guard)", () => {
    assert.deepStrictEqual(detectIntent('how many times does the word "bedroom" appear in each design?'), { intent: "count", rule: { matched: null, term: "bedroom" } });
    assert.strictEqual(detectCountTerm("count occurrences of lathe"), "lathe");
    assert.strictEqual(detectCountTerm("how many times does the word the"), null, "a stop word is not a term");
    assert.strictEqual(detectCountTerm("how many speeds does it have"), null);
    assert.strictEqual(detectIntent("compare the Chester and the Hesketh designs").intent, "enumerate");
    assert.strictEqual(detectIntent("how much is the Chester").intent, "lookup");
    assert.strictEqual(routeTurn({ message: "/doc what are the room dimensions" }).flags.dimensional, true);
    assert.strictEqual(routeTurn({ message: "/doc what is the speed" }).flags.dimensional, false);
  });

  test("the context depth: the enumerate intent's 25, else the config module's (the code-mode 4 and limit 10 are gone — D9)", () => {
    assert.strictEqual(routeTurn({ message: "/doc list all designs", contextDefaults: { maxContextChunks: 8 } }).contextDepth, 25);
    assert.strictEqual(routeTurn({ message: "/doc the speed", contextDefaults: { maxContextChunks: 8 } }).contextDepth, 8);
    assert.strictEqual(routeTurn({ message: "write code", contextDefaults: { maxContextChunks: 8 } }).contextDepth, 8);
    assert.strictEqual(routeTurn({ message: "write code" }).contextDepth, null, "no defaults given → the orchestrator resolves");
    assert.deepStrictEqual(routeTurn({ message: "write code" }).retrieval, {});
  });
});

describe("U-ROUTER: the model / endpoint pair (D7 — E28)", () => {
  const profiles = {
    chat: { endpointType: "ollama", url: "http://ollama.ollama.svc.cluster.local:11434/v1", token: "", model: "qwen3.8:27b" },
    code: { endpointType: "ollama", url: "http://ollama.ollama.svc.cluster.local:11434/v1", token: "t", model: "qwen3.8:27b" },
  };
  test("chat and doc take the chat profile, code the code profile — URL, model and credential from ONE object", () => {
    const doc = selectModelProfile({ mode: "doc", adminConfig: { modelProfiles: profiles, nimEndpoint: "https://nemotron/legacy", nimModelName: "nvidia/nemotron-nano-12b-v2-vl" } });
    assert.deepStrictEqual(doc, { profile: "chat", endpointType: "ollama", url: profiles.chat.url, model: "qwen3.8:27b", token: "", source: "modelProfiles" });
    assert.strictEqual(selectModelProfile({ mode: "chat", adminConfig: { modelProfiles: profiles } }).profile, "chat");
    const code = selectModelProfile({ mode: "code", adminConfig: { modelProfiles: profiles } });
    assert.deepStrictEqual([code.profile, code.token, code.source], ["code", "t", "modelProfiles"]);
  });

  test("legacy: the trio as-is for EVERY mode — the mode no longer swaps the model under the URL (E28's 404); no coder heuristic, no ollamaModelName reach", () => {
    const legacy = { nimEndpoint: "https://nemotron.example/v1 ", nimApiKey: "k", nimModelName: "nvidia/nemotron-nano-12b-v2-vl", ollamaModelName: "qwen3-coder:30b", liteLlmModelName: "x" };
    const code = selectModelProfile({ mode: "code", adminConfig: legacy });
    const doc = selectModelProfile({ mode: "doc", adminConfig: legacy });
    assert.strictEqual(code.model, "nvidia/nemotron-nano-12b-v2-vl", "the code turn keeps the model the URL serves");
    assert.strictEqual(code.url, "https://nemotron.example/v1");
    assert.deepStrictEqual([code.source, doc.source], ["legacy", "legacy"]);
    assert.strictEqual(doc.model, code.model);
    assert.strictEqual(selectModelProfile({ mode: "doc", adminConfig: { modelProfiles: { chat: { url: "  " } }, nimEndpoint: "http://x", nimModelName: "m" } }).source, "legacy", "a profile without a URL is no profile");
    assert.strictEqual(selectModelProfile({ mode: "doc", adminConfig: {} }).model, null, "no model is null, never a literal");
    assert.strictEqual(selectModelProfile({ mode: "doc" }).url, "");
  });

  test("the orchestrator's selection has no ollamaModelName / liteLlmModelName reach, no coder heuristic, no model literal (the backlog's acceptance grep)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "orchestrator.js"), "utf-8").replace(/\/\/.*$/gm, "");
    assert.ok(!/ollamaModelName/.test(src), "ollamaModelName is not read by the orchestrator");
    assert.ok(!/liteLlmModelName/.test(src), "liteLlmModelName is not read by the orchestrator");
    assert.ok(!/includes\("coder"\)/.test(src), "the coder heuristic is gone");
    assert.ok(!/qwen3-coder:30b/.test(src), "the model literal is gone");
    assert.ok(!/nemotron-nano-12b-v2-vl/.test(src), "the default model literal is gone");
    assert.match(src, /const pair = selectModelProfile\(\{ mode: agentMode, adminConfig \}\);\s*let modelName = pair\.model;\s*let targetUrl = pair\.url;\s*let nimApiKey = pair\.token;/, "URL, model and credential come from the one pair");
  });

  test("describeRoute never carries a token — names only", () => {
    const r = routeTurn({ message: "/doc x" });
    const d = describeRoute(r, selectModelProfile({ mode: "doc", adminConfig: { modelProfiles: { chat: { endpointType: "ollama", url: "http://ollama.ollama.svc.cluster.local:11434/v1", token: "SECRET-TOKEN-VALUE", model: "qwen3.8:27b" } } } }));
    const flat = JSON.stringify(d);
    assert.ok(!flat.includes("SECRET-TOKEN-VALUE"));
    // T30: `followUp` is on the response, null without a history (nothing to say).
    assert.deepStrictEqual(d.response, { mode: "doc", modeSource: "slash", intent: "lookup", model: { profile: "chat", endpointType: "ollama", origin: "ollama.ollama.svc.cluster.local:11434", model: "qwen3.8:27b", source: "modelProfiles" }, followUp: null });
    assert.strictEqual(d.title, "Mode Router");
    assert.strictEqual(d.badge, "FORCED /DOC");
    assert.strictEqual(describeRoute(routeTurn({ message: "list all designs" })).badge, "CODE · ENUMERATE");
    assert.strictEqual(describeRoute(routeTurn({ message: "/chat hi" })).badge, "FORCED /CHAT");
  });
});

describe("U-ROUTER: history in every mode (D6 — E29 / FM-T5)", () => {
  test("the last five turns, alternating roles, system dropped, empty skipped, both message shapes", () => {
    const history = [
      { sender: "system", text: "sys" },
      { sender: "user", text: "q1" },
      { sender: "ai", text: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "" },
      { sender: "user", text: "q3" },
      { sender: "ai", text: "a3", timestamp: "t" },
    ];
    assert.deepStrictEqual(replayHistory(history), [
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "user", content: "q3" },
      { role: "assistant", content: "a3" },
    ]);
    assert.deepStrictEqual(replayHistory(history, { limit: 7 }).map((m) => m.role), ["user", "assistant", "user", "user", "assistant"]);
    assert.deepStrictEqual(replayHistory(null), []);
    assert.deepStrictEqual(replayHistory([null, 3, "x"]), []);
  });

  test("an earlier answer's [S#] markers are stripped so a stale marker cannot be echoed as a citation of the current context", () => {
    assert.strictEqual(stripMarkers("860.4 sq ft [S2]. Lounge 174.6 [S1, S3]; kitchen [S4,S5]."), "860.4 sq ft. Lounge 174.6; kitchen.");
    assert.strictEqual(stripMarkers("no markers"), "no markers");
    const out = replayHistory([{ sender: "user", text: "the [S1] question stays" }, { sender: "ai", text: "answer [S9]" }]);
    assert.deepStrictEqual(out, [{ role: "user", content: "the [S1] question stays" }, { role: "assistant", content: "answer" }]);
  });

  test("the orchestrator replays in every mode: the doc-mode branch that pushed the message alone is gone", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "orchestrator.js"), "utf-8").replace(/\/\/.*$/gm, "");
    assert.ok(!/isolate history/.test(src));
    assert.match(src, /for \(const m of replayHistory\(history\)\) formattedMessages\.push\(m\);\s*formattedMessages\.push\(\{ role: "user", content: route\.cleanMessage \|\| message \}\);/);
    assert.ok(!/if \(agentMode === "doc"\) \{\s*formattedMessages\.push/.test(src));
  });
});

describe("U-ROUTER/T30: the follow-up verdict (design D3 — F-114; the cases of t30-design.md §0a)", () => {
  const CHESTER = "specifically in relation to the Chester design - how much square footage does this house design provide in total?";
  const HIST = [
    { sender: "ai", text: "Welcome to NexCODE. Let's write some code!", timestamp: "" },
    { sender: "user", text: "/doc " + CHESTER, timestamp: "t" },
    { sender: "ai", text: "860.4 sq ft [S2]", timestamp: "t", documentScope: { method: "vote", documents: [{ source: "Barratt_Homes_SitePlan.pdf", chunkCount: 26, totalPages: 7 }] } },
  ];
  const fu = (q, history = HIST) => routeTurn({ message: q, forcedCommand: "/doc", history }).followUp;

  test("the previous USER turn: the last user entry, its slash stripped; the welcome and error entries are skipped; none → null", () => {
    assert.strictEqual(previousUserTurn(HIST), CHESTER);
    assert.strictEqual(previousUserTurn([{ sender: "ai", text: "welcome" }]), null);
    assert.strictEqual(previousUserTurn([{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }, { sender: "ai", text: "✅ Applied changes" }]), "q1");
    assert.strictEqual(previousUserTurn([{ sender: "user", text: "   " }]), null);
    assert.strictEqual(previousUserTurn(null), null);
    assert.strictEqual(previousUserTurn([3, "x", null]), null);
  });

  test("the previous turn's scope (D7): the last assistant entry's documentScope.documents[].source; absent → null; a bare runner history → null", () => {
    assert.deepStrictEqual(previousTurnScope(HIST), ["Barratt_Homes_SitePlan.pdf"]);
    assert.strictEqual(previousTurnScope([{ sender: "user", text: CHESTER }, { sender: "ai", text: "860" }]), null);
    assert.strictEqual(previousTurnScope([{ sender: "user", text: CHESTER }, { sender: "ai", text: "860", documentScope: null }]), null);
    assert.deepStrictEqual(previousTurnScope([{ sender: "ai", text: "x", documentScope: { document: { source: "A.pdf" } } }]), ["A.pdf"], "the T28 single-document shape");
    assert.deepStrictEqual(previousTurnScope([{ sender: "ai", text: "x", documentScope: { documents: [{ source: "A.pdf" }, { source: "A.pdf" }, { source: "B.pdf" }, { source: 3 }] } }]), ["A.pdf", "B.pdf"]);
    assert.strictEqual(previousTurnScope(null), null);
  });

  test("§0a B1 / B2 / B6 / B7 / B8 are follow-ups (a continuation cue or a pronoun, the cue reported); B3 (elliptical) and B4 (fresh) are not", () => {
    const b1 = fu("and how many bedrooms does it have, and which floor are they on?");
    assert.deepStrictEqual([b1.detected, b1.cue, b1.cueKind], [true, "and", "continuation"]);
    const b2 = fu("what about its kitchen size?");
    assert.deepStrictEqual([b2.cue, b2.cueKind], ["what about", "continuation"]);
    const b7 = fu("what does it weigh?");
    assert.deepStrictEqual([fu("and how do I lubricate it?").detected, b7.cue, b7.cueKind], [true, "it", "pronoun"]);
    const b8 = fu("compare it with the Alderney");
    assert.deepStrictEqual([b8.detected, b8.cue], [true, "it"]);
    const b3 = fu("which floor are the bedrooms on?");
    assert.deepStrictEqual([b3.detected, b3.reason], [false, "no continuation cue and no anaphoric pronoun"]);
    assert.strictEqual(fu("what PPE do I need to operate the lathe?").detected, false);
    // B5: the cue fires here; the fresh-referent guard (scope.js, D5) decides it is not applied.
    const b5 = fu("and how much square footage does the Alderney design provide in total?");
    assert.deepStrictEqual([b5.detected, b5.cue], [true, "and"]);
    assert.match(b1.reason, /opens with "and"/);
    assert.match(b7.reason, /carries the pronoun "it"/);
  });

  test("bare 'this' / 'that' are not pronouns: the owner's Q7 → Q8 → Q8b sequence ('this house design') is never a follow-up; every owner question after another is not", () => {
    for (let i = 1; i < OWNER_QUESTIONS.length; i++) {
      const history = [{ sender: "user", text: OWNER_QUESTIONS[i - 1] }, { sender: "ai", text: "answer [S1]" }];
      const v = fu(OWNER_QUESTIONS[i], history);
      assert.strictEqual(v.detected, false, "Q" + (i + 1) + " after Q" + i + ": " + v.reason);
    }
    assert.strictEqual(fu("that is the one I meant").detected, false);
    assert.strictEqual(fu("that one is the one I meant").detected, true);
  });

  test("no history, an empty message, a count turn → never a follow-up; the verdict is total on junk; the paraphrase-invariance pins hold with a history present", () => {
    assert.deepStrictEqual([fu("and it?", []).detected, fu("and it?", []).reason], [false, "no previous user turn in the history"]);
    assert.strictEqual(fu("and it?", null).detected, false);
    assert.strictEqual(fu("", HIST).detected, false);
    const count = fu("how many times does the word bedroom appear? and it");
    assert.deepStrictEqual([count.detected, count.reason], [false, "a count question is never prefixed"]);
    assert.strictEqual(routeTurn({ message: "and it?", history: [{ sender: "user", text: {} }, 5] }).followUp.detected, false);
    for (const q of PARAPHRASES) {
      const a = routeTurn({ message: q, forcedCommand: "/doc" });
      const b = routeTurn({ message: q, forcedCommand: "/doc", history: HIST });
      assert.deepStrictEqual([b.mode, b.intent, b.retrieval, b.contextDepth], [a.mode, a.intent, a.retrieval, a.contextDepth], q);
    }
  });

  test("the constants are the design's record (D10: no settings key) and describeRoute reports the verdict by names and counts, never the previous turn's text", () => {
    assert.ok(FOLLOW_UP_CUES.includes("and") && FOLLOW_UP_CUES.includes("what about"));
    assert.ok(ANAPHORA_RE.test("does it") && !ANAPHORA_RE.test("this house design"));
    assert.strictEqual(FOLLOW_UP_PREFIX_MAX_CHARS, 600);
    const route = routeTurn({ message: "what about its kitchen size?", forcedCommand: "/doc", history: HIST });
    route.followUp = { ...route.followUp, applied: true, appliedReason: route.followUp.reason };
    const d = describeRoute(route);
    assert.deepStrictEqual(d.response.followUp, { detected: true, cue: "what about", cueKind: "continuation", applied: true, reason: 'opens with "what about"', previousTurnChars: CHESTER.length, previousScope: ["Barratt_Homes_SitePlan.pdf"] });
    assert.ok(!JSON.stringify(d).includes("square footage"), "the previous turn's text is not on the span or the response");
    assert.match(d.description, /A follow-up \(opens with "what about"\) — the retrieval query is the previous turn plus this one\./);
    const guarded = routeTurn({ message: "and the Alderney?", forcedCommand: "/doc", history: HIST });
    guarded.followUp = { ...guarded.followUp, applied: false, appliedReason: 'the message names "Alderney", absent from the previous turn — a fresh referent' };
    assert.match(describeRoute(guarded).description, /A follow-up cue \(opens with "and"\) but the message names "Alderney", absent from the previous turn — a fresh referent — retrieved on its own words\./);
    assert.match(describeRoute(routeTurn({ message: "which floor?", forcedCommand: "/doc", history: HIST })).description, /Not a follow-up \(no continuation cue and no anaphoric pronoun\) — retrieved on its own words\./);
    assert.ok(!/follow-up/i.test(describeRoute(routeTurn({ message: "which floor?", forcedCommand: "/doc" })).description), "no history → nothing said");
  });
});

describe("U-ROUTER/T63: the whole-document lookup is decided by the SCOPE, never by the word list (t63-design.md §2.1)", () => {
  const OWNER = "how many plots in the Elysian Fields development have been allocated to The Laverton house type?\nalso can you provide details of that house type - number of storeys, number of bedrooms, number of bathrooms, etc?\nFinally, what are the total square footage of the rooms and the total square footage of the house type?";
  test("the owner's Elysian question is a LOOKUP with no enumeration overrides; one added \"all\" still flips it to an enumeration (F-111, unchanged) — T63 did not touch the router", () => {
    const r = routeTurn({ message: OWNER, forcedCommand: "/doc" });
    assert.strictEqual(r.intent, "lookup");
    assert.deepStrictEqual(r.retrieval, {}, "a lookup keeps the resolver's pool; the whole read is region 2c's, not a bigger pool");
    assert.strictEqual(r.flags.dimensional, true);
    const t4 = routeTurn({ message: OWNER.replace("total square footage of the rooms", "total square footage of all the rooms"), forcedCommand: "/doc" });
    assert.strictEqual(t4.intent, "enumerate", "the review's T4: the word list is F-111's, unchanged");
    assert.deepStrictEqual(t4.retrieval, ENUMERATE_RETRIEVAL);
  });
});
