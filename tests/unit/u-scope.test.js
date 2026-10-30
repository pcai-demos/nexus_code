/**
 * U-SCOPE — document-scoped enumeration, the pure module (ticket T28,
 * t28-design.md §13, §14; F-101, F-97, F-96).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
  detectEnumeration,
  nameTokens,
  documentsNamedIn,
  voteBySource,
  resolveDocumentScope,
  budgetFor,
  orderDocument,
  coverageStatement,
  legendNoteRule,
  freshProperNoun,
  buildRetrievalQuery,
} = require("../../src/lib/rag/scope");

const SUMMARY = [
  { source: "Barratt_Homes_SitePlan.pdf", chunkCount: 26, totalPages: 7 },
  { source: "Barratt_Homes-SaxonFields.pdf", chunkCount: 1, totalPages: 2 },
  { source: "Fervi_Lathe_TechnicalSupportManual.pdf", chunkCount: 228, totalPages: 84 },
];
const ranked = (source, score, over = {}) => ({ source, page: 2, chunkIndex: 7, rerankScore: score, text: "x", ...over });
// Q12's measured kept set (t28-design.md §0 item 2): SaxonFields first at 0.806, then the Site Plan.
const Q12 = [ranked("Barratt_Homes-SaxonFields.pdf", 0.806), ranked("Barratt_Homes_SitePlan.pdf", 0.789, { sourceId: "demos/sp.pdf" }), ranked("Barratt_Homes_SitePlan.pdf", 0.77), ranked("Barratt_Homes_SitePlan.pdf", 0.754), ranked("Barratt_Homes_SitePlan.pdf", 0.745), ranked("Barratt_Homes_SitePlan.pdf", 0.586), ranked("Barratt_Homes_SitePlan.pdf", 0.299), ranked("Barratt_Homes_SitePlan.pdf", 0.192), ranked("Barratt_Homes_SitePlan.pdf", 0.089)];

describe("U-SCOPE: the enumeration rule (D14)", () => {
  test("fires on the owner's two enumeration questions and not on the others' shapes", () => {
    assert.ok(detectEnumeration("for each house design type please output the following"));
    assert.ok(detectEnumeration("based on the Phase 3 full site plan, how many homes of the different configuration types will there be?"));
    assert.ok(!detectEnumeration("how many different spindle speeds is the T999 / 230V capable of?"));
    assert.ok(!detectEnumeration("specifically in relation to the Chester design - how much square footage does this house design provide?"));
    assert.ok(!detectEnumeration(null));
  });
});

describe("U-SCOPE: naming a document (D15)", () => {
  test("distinctive stem tokens: ≥ 4 letters, not generic, no extension", () => {
    assert.deepStrictEqual(nameTokens("Barratt_Homes_SitePlan.pdf"), ["barratt", "homes", "siteplan"]);
    assert.deepStrictEqual(nameTokens("Fervi_Lathe_TechnicalSupportManual.pdf"), ["fervi", "lathe", "technicalsupportmanual"]);
    assert.deepStrictEqual(nameTokens("SSX125_Manual.pdf"), ["ssx125"]);
    assert.deepStrictEqual(nameTokens(""), []);
  });
  test("a whole-word match on a DISTINCTIVE token names the document; a token shared by two documents, a substring, or 'site plan' (two words) does not (A18)", () => {
    assert.deepStrictEqual(documentsNamedIn("list all figures in the Fervi manual", SUMMARY).map((n) => n.source), ["Fervi_Lathe_TechnicalSupportManual.pdf"]);
    assert.deepStrictEqual(documentsNamedIn("based on the phase 3 site plan, list all designs", SUMMARY), []);
    assert.deepStrictEqual(documentsNamedIn("the lathes", SUMMARY), []);
    // "homes" and "barratt" are in both Barratt file names — Q6's wording must fall through to the vote.
    assert.deepStrictEqual(documentsNamedIn("how many homes of the different configuration types will there be?", SUMMARY), []);
    assert.deepStrictEqual(documentsNamedIn("the barratt homes designs", SUMMARY), []);
    assert.deepStrictEqual(documentsNamedIn("the siteplan designs", SUMMARY).map((n) => n.source), ["Barratt_Homes_SitePlan.pdf"]);
  });
});

describe("U-SCOPE: the vote and the resolution (D15)", () => {
  test("score mass per document, shares, sorted; Q12 → the Site Plan at 0.84 (the measured case)", () => {
    const { votes, basis } = voteBySource(Q12);
    assert.strictEqual(basis, "mass");
    assert.strictEqual(votes[0].source, "Barratt_Homes_SitePlan.pdf");
    assert.strictEqual(votes[0].chunks, 8);
    assert.ok(Math.abs(votes[0].share - 0.84) < 0.01, `share ${votes[0].share}`);
    assert.strictEqual(votes[1].source, "Barratt_Homes-SaxonFields.pdf");
  });
  test("every score null → the vote is by count and says so", () => {
    const { votes, basis } = voteBySource([ranked("A.pdf", null), ranked("A.pdf", null), ranked("B.pdf", null)]);
    assert.strictEqual(basis, "count");
    assert.strictEqual(votes[0].source, "A.pdf");
    assert.ok(Math.abs(votes[0].share - 2 / 3) < 0.001);
  });
  test("precedence: request → named → vote → none", () => {
    const req = resolveDocumentScope({ message: "for each design", ranked: Q12, summary: SUMMARY, requestScope: ["Fervi_Lathe_TechnicalSupportManual.pdf"] });
    assert.strictEqual(req.method, "request");
    assert.strictEqual(req.document.source, "Fervi_Lathe_TechnicalSupportManual.pdf");
    assert.strictEqual(req.document.chunkCount, 228);
    const unknownReq = resolveDocumentScope({ message: "for each design", ranked: Q12, summary: SUMMARY, requestScope: ["Nope.pdf"] });
    assert.notStrictEqual(unknownReq.method, "request", "a request naming a document the store lacks is ignored");
    const named = resolveDocumentScope({ message: "list all figures in the fervi manual", ranked: Q12, summary: SUMMARY });
    assert.strictEqual(named.method, "named");
    assert.strictEqual(named.document.source, "Fervi_Lathe_TechnicalSupportManual.pdf");
    const vote = resolveDocumentScope({ message: "for each house design type", ranked: Q12, summary: SUMMARY });
    assert.strictEqual(vote.method, "vote");
    assert.strictEqual(vote.document.source, "Barratt_Homes_SitePlan.pdf");
    assert.strictEqual(vote.document.sourceId, "demos/sp.pdf", "the sourceId rides from the ranked chunk that has one");
    assert.strictEqual(vote.document.totalPages, 7);
    assert.match(vote.reason, /84%/);
    const none = resolveDocumentScope({ message: "compare", ranked: [ranked("A.pdf", 0.5), ranked("B.pdf", 0.5)], summary: [{ source: "A.pdf", chunkCount: 1 }, { source: "B.pdf", chunkCount: 1 }] });
    assert.strictEqual(none.method, "none");
    assert.strictEqual(none.document, null);
    assert.match(none.reason, /no single document dominates/);
    const empty = resolveDocumentScope({ message: "compare", ranked: [], summary: SUMMARY });
    assert.strictEqual(empty.method, "none");
  });
  test("a dominant document the summary does not list is 'none' with the reason", () => {
    const r = resolveDocumentScope({ message: "each", ranked: [ranked("Ghost.pdf", 0.9)], summary: SUMMARY });
    assert.strictEqual(r.method, "none");
    assert.match(r.reason, /summary does not list/);
  });
  test("total on junk", () => {
    for (const args of [undefined, {}, { message: null, ranked: null, summary: null, requestScope: 42 }]) assert.ok(resolveDocumentScope(args).method);
  });
});

describe("U-SCOPE: the budget (D16)", () => {
  test("an estimate before the read (chunkCount × mean), a measurement after; fits only under the budget", () => {
    const pre = budgetFor({ document: { chunkCount: 228 }, budgetTokens: 80000 });
    assert.strictEqual(pre.basis, "estimated");
    assert.strictEqual(pre.estimatedTokens, Math.ceil((228 * 800 + 228 * 120) / 3.2));
    assert.ok(pre.fits);
    const post = budgetFor({ document: { chunkCount: 228 }, chars: 147270, rows: 228, budgetTokens: 80000 });
    assert.strictEqual(post.basis, "measured");
    assert.strictEqual(post.estimatedTokens, Math.ceil((147270 + 228 * 120) / 3.2), "the block headers are counted (A13)");
    assert.ok(post.fits);
    assert.ok(!budgetFor({ document: { chunkCount: 495 }, chars: 242022, rows: 495, budgetTokens: 40000 }).fits);
    // The boundary: text alone under the budget, text + headers over it → does not fit.
    const edge = budgetFor({ document: { chunkCount: 250 }, chars: 250 * 3.2 * 300, rows: 250, budgetTokens: 75000 });
    assert.ok(!edge.fits, `headers push a boundary document over: ${edge.estimatedTokens}`);
    const unknown = budgetFor({ document: { chunkCount: null }, budgetTokens: 80000 });
    assert.strictEqual(unknown.basis, "unknown");
    assert.ok(!unknown.fits, "an unknown size never fits");
    assert.ok(!budgetFor({ document: { chunkCount: 1 }, budgetTokens: 0 }).fits);
  });
});

describe("U-SCOPE: page order (D17)", () => {
  test("page, then text before captions, then chunkIndex, then stored order; unlocated last", () => {
    const rows = [
      { page: 2, chunkIndex: 20, isVisualElement: true, text: "cap p2" },
      { page: 1, chunkIndex: 4, text: "t1b" },
      { page: 0, chunkIndex: 99, text: "unlocated" },
      { page: 2, chunkIndex: 7, text: "t2b" },
      { page: 1, chunkIndex: 3, text: "t1a" },
      { page: 2, chunkIndex: 6, text: "t2a" },
      { page: 1, chunkIndex: 19, metadata: JSON.stringify({ isVisualElement: true }), text: "cap p1" },
    ];
    assert.deepStrictEqual(orderDocument(rows).map((r) => r.text), ["t1a", "t1b", "cap p1", "t2a", "t2b", "cap p2", "unlocated"]);
    const v1 = [{ page: 1, text: "b" }, { page: 1, text: "a" }];
    assert.deepStrictEqual(orderDocument(v1).map((r) => r.text), ["b", "a"], "without chunkIndex the stored order holds");
    assert.deepStrictEqual(orderDocument(null), []);
  });
});

describe("U-SCOPE: coverage wording (D18 — F-96)", () => {
  test("complete: the block says every passage was read; rule 7 may claim absence", () => {
    const c = coverageStatement({ method: "vote", coverage: "complete", document: { source: "Barratt_Homes_SitePlan.pdf" }, chunksRead: 26, chunksInStore: 26, pages: 7, blocksShown: 24, excludedForeign: 1, reason: "it holds 84% of the score" });
    assert.match(c.block, /Coverage: COMPLETE/);
    assert.match(c.block, /26 passages on 7 page/);
    assert.match(c.block, /24 blocks/);
    assert.match(c.block, /1 retrieved passage\(s\) from other documents were left out/);
    assert.strictEqual(c.noteWording, "complete");
    assert.match(legendNoteRule("complete"), /do not have dedicated specification pages in this document/);
  });
  test("partial and ranked: the block says so, with the true cause; rule 7 must not claim absence", () => {
    const p = coverageStatement({ method: "vote", coverage: "partial", document: { source: "Miele.pdf" }, chunksInStore: 361, estimatedTokens: 66000, budgetTokens: 40000, reason: "x", partialCause: "budget" });
    assert.match(p.block, /Coverage: PARTIAL/);
    assert.match(p.block, /361 passages, ≈66000 tokens/);
    assert.match(p.block, /budget of 40000 tokens/);
    assert.strictEqual(p.noteWording, "partial");
    const short = coverageStatement({ method: "vote", coverage: "partial", document: { source: "Site.pdf" }, chunksRead: 20, chunksInStore: 26, reason: "x", partialCause: "incomplete-read" });
    assert.match(short.block, /the read returned 20 of the document's 26 passages/, "an incomplete read never blames the budget (A11)");
    assert.ok(!/exceeds the whole-document budget/.test(short.block));
    const failed = coverageStatement({ method: "vote", coverage: "ranked", document: { source: "Site.pdf" }, reason: "it holds 84%", error: "store timeout" });
    assert.match(failed.block, /Document scope: Site\.pdf — chosen because it holds 84%, but the document could not be read \(store timeout\)/, "a read failure after a vote says both (A12)");
    assert.match(failed.block, /Coverage: RANKED/);
    const r = coverageStatement({ method: "none", coverage: "ranked", reason: "no single document dominates" });
    assert.match(r.block, /Document scope: none/);
    assert.match(r.block, /Coverage: RANKED/);
    const rule = legendNoteRule("partial");
    assert.match(rule, /were not among the passages retrieved/);
    assert.match(rule, /NEVER state that such an item has no page/);
    assert.ok(!/do not have dedicated specification pages/.test(rule));
  });
  test("total on junk", () => {
    assert.ok(coverageStatement().block.length > 0);
    assert.ok(legendNoteRule(undefined).length > 0);
  });
});

// ── T15 (t15-design.md D4 / D5): the set forms ──────────────────────────────
const { resolveTurnScope, planDocumentReads, coverageStatementForSet, lookupScopeStatement, sourceIdsFor } = require("../../src/lib/rag/scope");

describe("U-SCOPE/T15: the turn scope as a set (D4)", () => {
  const SUM2 = [...SUMMARY.map((d) => ({ ...d })), { source: "Miele_washing_machine_manual.pdf", chunkCount: 361, totalPages: 123, sourceIds: ["demos/miele.pdf", "demos/miele-v2.pdf"] }];
  test("request: every known name is in scope, unknown names are named as ignored, prefilter true", () => {
    const r = resolveTurnScope({ message: "x", ranked: [], summary: SUM2, requestScope: ["Fervi_Lathe_TechnicalSupportManual.pdf", "Nope.pdf", "Barratt_Homes_SitePlan.pdf", "Fervi_Lathe_TechnicalSupportManual.pdf"] });
    assert.strictEqual(r.method, "request");
    assert.deepStrictEqual(r.documents.map((d) => d.source), ["Fervi_Lathe_TechnicalSupportManual.pdf", "Barratt_Homes_SitePlan.pdf"]);
    assert.strictEqual(r.prefilter, true);
    assert.match(r.reason, /ignored, not in the store: Nope\.pdf/);
    assert.deepStrictEqual(sourceIdsFor(SUM2, "Miele_washing_machine_manual.pdf"), ["demos/miele.pdf", "demos/miele-v2.pdf"]);
    assert.deepStrictEqual(resolveTurnScope({ message: "x", ranked: [], summary: SUM2, requestScope: "Miele_washing_machine_manual.pdf" }).documents[0].sourceIds, ["demos/miele.pdf", "demos/miele-v2.pdf"]);
  });
  test("named: every distinctive name RETRIEVAL RANKED, ordered by vote share, filtering after ranking (A11); an uncorroborated name is evidence of nothing; the vote: one document; none: empty", () => {
    const rankedBoth = [ranked("Fervi_Lathe_TechnicalSupportManual.pdf", 0.6), ranked("Miele_washing_machine_manual.pdf", 0.3), ranked("Barratt_Homes_SitePlan.pdf", 0.1)];
    const named = resolveTurnScope({ message: "compare the fervi manual with the miele one", ranked: rankedBoth, summary: SUM2 });
    assert.strictEqual(named.method, "named");
    assert.deepStrictEqual(named.documents.map((d) => d.source), ["Fervi_Lathe_TechnicalSupportManual.pdf", "Miele_washing_machine_manual.pdf"]);
    assert.strictEqual(named.prefilter, false, "a name filters after ranking; only the request pre-filters");
    // Q5's case: "machine" names the Miele manual, retrieval ranked only the Fervi manual → the name is dropped, the vote decides, the reason says so.
    const q5 = resolveTurnScope({ message: "where is the lubrication point located on the machine?", ranked: [ranked("Fervi_Lathe_TechnicalSupportManual.pdf", 0.9), ranked("Fervi_Lathe_TechnicalSupportManual.pdf", 0.8)], summary: SUM2 });
    assert.deepStrictEqual([q5.method, q5.documents[0].source], ["vote", "Fervi_Lathe_TechnicalSupportManual.pdf"]);
    assert.match(q5.reason, /"machine" named a document retrieval did not rank/);
    // Before retrieval (no ranked set) a name resolves nothing — the pre-scope honours the request alone.
    assert.strictEqual(resolveTurnScope({ message: "the fervi manual", ranked: [], summary: SUM2 }).method, "none");
    assert.strictEqual(resolveTurnScope({ message: "the fervi manual", ranked: [], summary: SUM2, requestScope: ["Fervi_Lathe_TechnicalSupportManual.pdf"] }).prefilter, true);
    const vote = resolveTurnScope({ message: "for each design", ranked: Q12, summary: SUM2 });
    assert.deepStrictEqual([vote.method, vote.documents.length, vote.documents[0].source, vote.prefilter], ["vote", 1, "Barratt_Homes_SitePlan.pdf", false]);
    const none = resolveTurnScope({ message: "x", ranked: [ranked("A.pdf", 0.5), ranked("B.pdf", 0.5)], summary: [{ source: "A.pdf" }, { source: "B.pdf" }] });
    assert.deepStrictEqual([none.method, none.documents], ["none", []]);
    assert.strictEqual(resolveTurnScope().method, "none", "total on nothing");
  });
});

describe("U-SCOPE/T15: whole documents in order while they fit (D5)", () => {
  test("the plan admits whole documents in the given order and never cuts one; the rest are unread with the reason", () => {
    const docs = [{ source: "S.pdf", chunkCount: 26, totalPages: 7 }, { source: "F.pdf", chunkCount: 228, totalPages: 84 }, { source: "T.pdf", chunkCount: 2, totalPages: 1 }];
    const plan = planDocumentReads({ documents: docs, budgetTokens: 10000 });
    assert.deepStrictEqual(plan.read.map((r) => r.source), ["S.pdf", "T.pdf"]);
    assert.deepStrictEqual(plan.unread.map((u) => u.source), ["F.pdf"]);
    assert.match(plan.unread[0].reason, /would exceed the remaining budget/);
    assert.ok(plan.estimatedTokensUsed <= 10000);
    assert.deepStrictEqual(planDocumentReads({ documents: docs, budgetTokens: 0 }).read, []);
    assert.deepStrictEqual(planDocumentReads({ documents: [{ source: "U.pdf" }], budgetTokens: 100 }).unread[0].reason, "size unknown");
    assert.deepStrictEqual(planDocumentReads(), { read: [], unread: [], budgetTokens: 0, estimatedTokensUsed: 0 });
  });
  test("the set wording: one line per document, unread named, rule 7 may claim absence only when every document was read whole", () => {
    const one = coverageStatementForSet({ method: "vote", reason: "r", reads: [{ source: "S.pdf", coverage: "complete", chunksRead: 26, chunksInStore: 26, pages: 7 }], excludedForeign: 1 });
    assert.deepStrictEqual(one, coverageStatement({ method: "vote", reason: "r", coverage: "complete", document: { source: "S.pdf" }, chunksRead: 26, chunksInStore: 26, pages: 7, excludedForeign: 1 }), "one document keeps T28's wording");
    const two = coverageStatementForSet({ method: "named", reason: "r", reads: [{ source: "S.pdf", coverage: "complete", chunksRead: 26, chunksInStore: 26, pages: 7 }], unread: [{ source: "F.pdf", reason: "over" }], excludedForeign: 0 });
    assert.match(two.block, /S\.pdf: COMPLETE/);
    assert.match(two.block, /F\.pdf: NOT READ — over; only its ranked passages are shown/);
    assert.strictEqual(two.noteWording, "partial");
    const both = coverageStatementForSet({ method: "named", reason: "r", reads: [{ source: "S.pdf", coverage: "complete", chunksRead: 26, chunksInStore: 26 }, { source: "T.pdf", coverage: "complete", chunksRead: 2, chunksInStore: 2 }] });
    assert.strictEqual(both.noteWording, "complete");
    const overBudget = coverageStatementForSet({ method: "vote", reason: "r", reads: [], unread: [{ source: "S.pdf", chunkCount: 26, estimatedTokens: 7475, reason: "x" }], budgetTokens: 1000 });
    assert.match(overBudget.block, /Coverage: PARTIAL — the document \(26 passages, ≈7475 tokens\) exceeds the whole-document budget of 1000 tokens/);
    const failed = coverageStatementForSet({ method: "vote", reason: "r", documents: [{ source: "S.pdf" }], error: "boom" });
    assert.match(failed.block, /S\.pdf — chosen because r, but the document could not be read \(boom\)/);
    assert.match(coverageStatementForSet({ method: "none", reason: "nothing dominated" }).block, /Document scope: none — nothing dominated/);
  });
  test("the lookup line: which documents, why, what was left out; null with no scope", () => {
    assert.strictEqual(lookupScopeStatement({ method: "vote", documents: [] }), null);
    assert.match(lookupScopeStatement({ method: "vote", documents: [{ source: "F.pdf" }], reason: "F holds 79%", excludedForeign: 3 }), /Document scope: F\.pdf — chosen because F holds 79%\. Only passages from this document are shown; 3 retrieved passage\(s\) from other documents were left out\./);
    assert.match(lookupScopeStatement({ method: "request", documents: [{ source: "F.pdf" }, { source: "S.pdf" }], reason: "r", prefilter: true }), /Retrieval was limited to these documents\./);
  });
});

describe("U-SCOPE/T30: the retrieval query of a follow-up turn (design D4 / D5) and the previous scope as the fourth source (D6 / D7)", () => {
  const { routeTurn } = require("../../src/lib/rag/router");
  const SUM3 = [...SUMMARY, { source: "Miele_washing_machine_manual.pdf", chunkCount: 361, totalPages: 123 }];
  const CHESTER = "specifically in relation to the Chester design - how much square footage does this house design provide in total?";
  const HIST = [{ sender: "user", text: "/doc " + CHESTER }, { sender: "ai", text: "860.4 [S2]", documentScope: { documents: [{ source: "Barratt_Homes_SitePlan.pdf" }] } }];
  const rq = (q, history = HIST, summary = SUM3) => buildRetrievalQuery({ route: routeTurn({ message: q, forcedCommand: "/doc", history }), summary });

  test("freshProperNoun: a capitalised token the previous turn lacks, not sentence-initial, not a short all-caps code", () => {
    assert.strictEqual(freshProperNoun("and how much square footage does the Alderney design provide?", CHESTER), "Alderney");
    assert.strictEqual(freshProperNoun("and the Chester's kitchen?", CHESTER), null, "in the previous turn");
    assert.strictEqual(freshProperNoun("Which floor are the bedrooms on?", CHESTER), null, "sentence-initial");
    assert.strictEqual(freshProperNoun("what PPE for the T999? And the RPM?", "spindle speeds"), null, "codes and acronyms");
    assert.strictEqual(freshProperNoun("And is it PPE-rated?", "x"), null, "a hyphenated code");
    assert.strictEqual(freshProperNoun("compare it with the Alderney", CHESTER), "Alderney");
    assert.strictEqual(freshProperNoun("", ""), null);
    assert.strictEqual(freshProperNoun(null, null), null);
  });

  test("the prefix: the previous user turn (slash-stripped) then the message, one hop; the previous turn truncated at the cap, the message never; no follow-up → the bare message", () => {
    const b1 = rq("and how many bedrooms does it have, and which floor are they on?");
    assert.deepStrictEqual([b1.applied, b1.query, b1.reason, b1.prefixChars, b1.truncated], [true, CHESTER + " and how many bedrooms does it have, and which floor are they on?", 'opens with "and"', CHESTER.length, false]);
    assert.strictEqual(rq("what about its kitchen size?").query, CHESTER + " what about its kitchen size?");
    const long = "x".repeat(700) + " end";
    const capped = buildRetrievalQuery({ route: routeTurn({ message: "and it?", history: [{ sender: "user", text: long }] }), summary: SUM3, maxPrefixChars: 600 });
    assert.deepStrictEqual([capped.applied, capped.truncated, capped.prefixChars, capped.query.endsWith(" and it?")], [true, true, 600, true]);
    const none = rq("which floor are the bedrooms on?");
    assert.deepStrictEqual([none.applied, none.query, none.reason], [false, "which floor are the bedrooms on?", "no continuation cue and no anaphoric pronoun"]);
    assert.deepStrictEqual([rq("and it?", []).applied, rq("and it?", []).query], [false, "and it?"]);
    assert.deepStrictEqual(buildRetrievalQuery(), { query: "", applied: false, cue: null, previousScope: null, reason: "no follow-up verdict" });
    assert.strictEqual(buildRetrievalQuery({ route: { cleanMessage: "q", followUp: { detected: true, previousTurn: "", reason: "r" } } }).reason, "no previous user turn");
  });

  test("the fresh-referent guard (D5): a named document, or a proper noun absent from the previous turn after a CONTINUATION cue, is retrieved on its own words; a pronoun keeps its antecedent (A1)", () => {
    const b5 = rq("and how much square footage does the Alderney design provide in total?");
    assert.deepStrictEqual([b5.applied, b5.query], [false, "and how much square footage does the Alderney design provide in total?"]);
    assert.match(b5.reason, /names "Alderney", absent from the previous turn — a fresh referent/);
    const named = rq("and what does the SaxonFields brochure say?");
    assert.strictEqual(named.applied, false);
    assert.match(named.reason, /names "saxonfields" \(Barratt_Homes-SaxonFields\.pdf\) — a fresh referent/);
    const b8 = rq("compare it with the Alderney");
    assert.deepStrictEqual([b8.applied, b8.query], [true, CHESTER + " compare it with the Alderney"], "a pronoun needs its antecedent whatever else the message names");
    assert.strictEqual(rq("what does it say in the SaxonFields brochure?").applied, false, "a named DOCUMENT blocks either cue kind");
    assert.strictEqual(rq("and what about the chester's kitchen?").applied, true, "a name the previous turn holds is not fresh");
    assert.deepStrictEqual(rq("and it?").previousScope, ["Barratt_Homes_SitePlan.pdf"]);
  });

  test("the previous scope is the FOURTH source: after the request, a corroborated name and a dominant vote; follow-up only; corroborated only; filtering after ranking", () => {
    const split = [ranked("Fervi_Lathe_TechnicalSupportManual.pdf", 0.5), ranked("Miele_washing_machine_manual.pdf", 0.5)];
    const prev = resolveTurnScope({ message: "and how do I lubricate it?", ranked: split, summary: SUM3, previousScope: ["Fervi_Lathe_TechnicalSupportManual.pdf"], followUp: true });
    assert.deepStrictEqual([prev.method, prev.documents.map((d) => d.source), prev.prefilter], ["previous", ["Fervi_Lathe_TechnicalSupportManual.pdf"], false]);
    assert.match(prev.reason, /carried forward from the previous turn \(Fervi_Lathe_TechnicalSupportManual\.pdf\) — 1 of its passages ranked; no single document dominates/);
    assert.strictEqual(resolveTurnScope({ message: "x", ranked: split, summary: SUM3, previousScope: ["Fervi_Lathe_TechnicalSupportManual.pdf"], followUp: false }).method, "none", "a fresh question never inherits");
    const unranked = resolveTurnScope({ message: "x", ranked: split, summary: SUM3, previousScope: ["Barratt_Homes_SitePlan.pdf"], followUp: true });
    assert.strictEqual(unranked.method, "none");
    assert.match(unranked.reason, /the previous turn's Barratt_Homes_SitePlan\.pdf not carried forward: retrieval ranked none of its passages/);
    assert.strictEqual(resolveTurnScope({ message: "x", ranked: [ranked("Miele_washing_machine_manual.pdf", 0.9), ranked("Fervi_Lathe_TechnicalSupportManual.pdf", 0.1)], summary: SUM3, previousScope: ["Fervi_Lathe_TechnicalSupportManual.pdf"], followUp: true }).method, "vote", "a dominant vote elsewhere beats the previous scope");
    assert.strictEqual(resolveTurnScope({ message: "x", ranked: split, summary: SUM3, requestScope: ["Miele_washing_machine_manual.pdf"], previousScope: ["Fervi_Lathe_TechnicalSupportManual.pdf"], followUp: true }).method, "request");
    assert.strictEqual(resolveTurnScope({ message: "the fervi manual", ranked: split, summary: SUM3, previousScope: ["Miele_washing_machine_manual.pdf"], followUp: true }).method, "named");
    assert.strictEqual(resolveTurnScope({ message: "x", ranked: split, summary: SUM3, previousScope: ["Unknown.pdf"], followUp: true }).method, "none", "an unknown previous document is not carried");
    const two = resolveTurnScope({ message: "x", ranked: [...split, ranked("Barratt_Homes_SitePlan.pdf", 0.5)], summary: SUM3, previousScope: ["Miele_washing_machine_manual.pdf", "Fervi_Lathe_TechnicalSupportManual.pdf"], followUp: true });
    assert.deepStrictEqual(two.documents.map((d) => d.source), ["Fervi_Lathe_TechnicalSupportManual.pdf", "Miele_washing_machine_manual.pdf"], "a previous set is carried as a set, ordered by share then name");
  });
});

describe("U-SCOPE/T63: a lookup on the ONE document the request selected is read whole when it fits (t63-design.md §2.1; D2 (a), D3 (a), D7 (a), D11 (a))", () => {
  const { planLookupRead, legendNoteLine, legendNoteRule: rule7 } = require("../../src/lib/rag/scope");
  // The shapes T15's resolveTurnScope gives before retrieval: the request's scope carries the summary's entry.
  const ELY = { source: "ElysianFields_SitePlan.pdf", chunkCount: 101, totalPages: 28, sourceId: null, sourceIds: ["demos/demo_files/ext_reg_docs/ElysianFields_SitePlan.pdf"] };
  const FERVI = { source: "Fervi_Lathe_TechnicalSupportManual.pdf", chunkCount: 255, totalPages: 84, sourceId: null, sourceIds: ["demos/demo_files/ext_reg_docs/Fervi_Lathe_TechnicalSupportManual.pdf"] };
  const MIELE = { source: "Miele_washing_machine_manual.pdf", chunkCount: 405, totalPages: 123, sourceId: null, sourceIds: ["demos/demo_files/ext_reg_docs/Miele_washing_machine_manual.pdf"] };
  const request = (...documents) => ({ method: "request", prefilter: true, documents, votes: [], reason: "the request named …" });
  const plan = (over = {}) => planLookupRead({ mode: "doc", intent: "lookup", scope: request(ELY), setting: "whole", budgetTokens: 80000, ...over });

  test("reads whole: a doc-mode lookup, the request's one selected document, its pre-read estimate within the budget — the verdict, the document and the estimate, with the reason in words", () => {
    const p = plan();
    assert.strictEqual(p.read, true);
    assert.strictEqual(p.document, ELY);
    assert.strictEqual(p.estimatedTokens, 29038, "budgetFor's pre-read estimate: 101 × (800 + 120) ÷ 3.2");
    assert.strictEqual(p.budgetTokens, 80000);
    assert.match(p.reason, /^the request selected ElysianFields_SitePlan\.pdf; ≈29038 estimated tokens within the whole-document budget of 80000$/);
    assert.strictEqual(plan({ scope: request(FERVI) }).read, true, "the lathe manual (≈73.3k estimated) fits 80,000 — the measured long-context case (§0e)");
  });

  test("stays ranked, and says why: a code or chat turn, an enumeration or a count, the setting ranked, no request scope (a vote or a name is post-ranking), several selected documents, a document over the budget or of unknown size", () => {
    const why = (over) => { const p = plan(over); assert.strictEqual(p.read, false); return p.reason; };
    assert.match(why({ mode: "code" }), /a code turn never reads a document whole/);
    assert.match(why({ mode: "chat" }), /a chat turn never reads a document whole/);
    assert.match(why({ intent: "enumerate" }), /not a lookup \(intent enumerate\)/, "an enumeration is T28's path");
    assert.match(why({ intent: "count" }), /not a lookup \(intent count\)/, "a count is T09's");
    assert.match(why({ setting: "ranked" }), /lookupDocumentRead is ranked — the ranked passages are shown/);
    assert.match(why({ scope: null }), /no document was selected in the request/);
    assert.match(why({ scope: { method: "vote", prefilter: false, documents: [ELY] } }), /no document was selected in the request/, "a voted scope is not a selection (D2 (a))");
    assert.match(why({ scope: { method: "named", prefilter: false, documents: [ELY] } }), /no document was selected in the request/, "a name in the question is evidence, not a selection (T15 A11)");
    assert.match(why({ scope: request(ELY, FERVI) }), /the request selected 2 documents — a lookup reads one whole/, "D2 (a): exactly one");
    assert.match(why({ scope: request() }), /the request selected 0 documents/);
    const over = plan({ scope: request(MIELE) });
    assert.strictEqual(over.read, false);
    assert.match(over.reason, /^Miele_washing_machine_manual\.pdf \(≈116438 estimated tokens\) exceeds the whole-document budget of 80000$/);
    assert.strictEqual(over.document, MIELE, "the over-budget document is named");
    assert.strictEqual(over.estimatedTokens, 116438);
    assert.match(why({ scope: request({ source: "X.pdf", chunkCount: null }) }), /the size of X\.pdf is unknown/);
    assert.match(why({ budgetTokens: 1000 }), /exceeds the whole-document budget of 1000/);
  });

  test("total on junk: no argument, a junk scope, a junk budget — a verdict, never a throw", () => {
    assert.strictEqual(planLookupRead().read, false);
    assert.strictEqual(planLookupRead({ mode: "doc", intent: "lookup", scope: { method: "request", prefilter: true, documents: "x" } }).read, false);
    assert.strictEqual(plan({ budgetTokens: -5 }).read, false, "no budget, no read");
    assert.strictEqual(plan({ scope: request(null, undefined, ELY) }).read, true, "junk entries are not documents");
  });

  test("rule 7's line (D11 (a)): today's bullet and its newline on every turn but a whole-document lookup, which has none — byte for byte", () => {
    assert.strictEqual(legendNoteLine({ noteWording: "complete" }), `${rule7("complete")}\n`, "an enumeration read whole keeps the note");
    assert.strictEqual(legendNoteLine({ noteWording: "partial" }), `${rule7("partial")}\n`, "a ranked turn keeps today's note");
    assert.strictEqual(legendNoteLine({ noteWording: "complete", wholeDocumentLookup: true }), "", "a whole-document lookup: no note (0 of 30 false page claims measured, against 8 of 85)");
    assert.strictEqual(legendNoteLine({ noteWording: "complete", wholeDocumentLookup: "yes" }), `${rule7("complete")}\n`, "only true is true");
    assert.strictEqual(legendNoteLine(), `${rule7(undefined)}\n`, "total on junk");
  });

  test("the orchestrator wires the gate BEFORE retrieval, reads with the one function, and joins region 2c only on a COMPLETED read (§2.2, D8 (a))", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "lib", "orchestrator.js"), "utf8").replace(/\/\/[^\n]*/g, "");
    const gate = src.indexOf("lookupPlan = planLookupRead({");
    const fetchAt = src.indexOf("await fetch(`${localOrigin}/api/rag/retrieve`");
    assert.ok(gate > 0 && fetchAt > gate, "the gate runs before the retrieve request");
    assert.match(src, /lookupRead = await readDocumentsWhole\(\{ documents: \[lookupPlan\.document\], budgetTokens: assemblyConfig\.documentContextBudget, client \}\);/);
    assert.match(src, /const wholeLookup = !isMultiEntityQuery && Boolean\(lookupRead && lookupRead\.coverage === "complete" && Array\.isArray\(lookupRead\.rows\) && lookupRead\.rows\.length > 0\);\s*if \(scopeEligible && \(isMultiEntityQuery \|\| wholeLookup\)\) \{/);
    assert.match(src, /enumeration: isMultiEntityQuery,/, "the response says which path read the document");
    assert.match(src, /if \(isMultiEntityQuery && assemblyConfig\.enumerationScope !== "document"\) \{/, "enumerationScope governs enumerations only");
    assert.match(src, /const read = wholeLookup\s*\? lookupRead\s*: await readDocumentsWhole\(\{ documents: scope\.documents, budgetTokens: assemblyConfig\.documentContextBudget, client: storeReadClient\(\) \}\);/, "an enumeration reads with the same function; a lookup's read is not repeated");
    assert.strictEqual((src.match(/fetchDocumentChunks\(/g) || []).length, 1, "ONE place reads a document whole");
  });
});

// ── T65 (t65-design.md D2 (a), D3 (a), D4 (a), D5 (a), D6 (a); F-246): a name the question carries selects its document.
describe("U-SCOPE: T65 — the question's names select a document (D2 (a), D4 (a))", () => {
  const { questionNames, namedByText, contestedBy, resolveTurnScope, planLookupRead, summariseScope, CONTESTED_RATIO } = require("../../src/lib/rag/scope");
  const SP = "Barratt_Homes_SitePlan.pdf";
  const SAX = "Barratt_Homes-SaxonFields.pdf";
  const ELY = "ElysianFields_SitePlan.pdf";
  const LATHE = "Fervi_Lathe_TechnicalSupportManual.pdf";
  const MIELE = "Miele_washing_machine_manual.pdf";
  const FCA = "FCA_SYSC_June2026.pdf";
  const SUM = [
    { source: SP, chunkCount: 17, totalPages: 7 },
    { source: SAX, chunkCount: 7, totalPages: 2 },
    { source: ELY, chunkCount: 101, totalPages: 28 },
    { source: LATHE, chunkCount: 255, totalPages: 84 },
    { source: MIELE, chunkCount: 405, totalPages: 140 },
    { source: FCA, chunkCount: 171, totalPages: 40 },
  ];
  const KNOWN = new Set(SUM.map((d) => d.source));
  // production's census (t65-artifacts/records/vocab65.json, namecount65.json), lower-cased
  const CENSUS = {
    chester: [SP], hesketh: [SP], denby: [SP], laverton: [ELY], elysian: [ELY], fields: [ELY, LATHE, SAX], saxon: [SAX],
    barratt: [SP, SAX], homes: [ELY, SP, SAX], phase: [LATHE, MIELE, SP], setting: [MIELE, LATHE, FCA], system: [MIELE, LATHE, FCA],
    comparator: [LATHE], longitudinal: [LATHE], the: [],
  };
  const holders = (t) => CENSUS[String(t).toLowerCase()] || [];
  const Q8 = "specifically in relation to the Chester design - how much square footage does this house design provide? please break that down by floor / level.";
  const ES = "how many plots in the Elysian Fields development have been allocated to The Laverton house type?\nalso can you provide details of that house type - number of storeys, number of bedrooms, number of bathrooms, etc?\nFinally, what are the total square footage of the rooms and the total square footage of the house type?";

  test("questionNames: capitalised, ≥ 3, not sentence-initial, not a short all-caps code, not a stop word — every match, once, in order", () => {
    assert.deepStrictEqual(questionNames(Q8), ["Chester"]);
    assert.deepStrictEqual(questionNames(ES), ["Elysian", "Fields", "Laverton"], "\"The\" is a stop word; \"Finally\" follows a question mark");
    assert.deepStrictEqual(questionNames("Chester design please"), [], "sentence-initial");
    assert.deepStrictEqual(questionNames("how fast is the T999 / 230V and what PPE do I need"), [], "short codes (≤ 5 capitals and digits) name nothing");
    assert.deepStrictEqual(questionNames("In the SSX125 manual's step 4"), ["SSX125"], "a longer code is a name");
    assert.deepStrictEqual(questionNames("what is in the Chester's kitchen and the Chester's lounge?"), ["Chester"], "Chester's is the Chester, once");
    assert.deepStrictEqual(questionNames(null), []);
  });

  test("namedByText: a name only one known document holds selects it; two names in one document are one selection", () => {
    assert.deepStrictEqual(namedByText({ message: Q8, holders, known: KNOWN }), { documents: [SP], reason: `the question names "Chester", which only ${SP}'s text holds` });
    assert.deepStrictEqual(namedByText({ message: ES, holders, known: KNOWN }), { documents: [ELY], reason: `the question names "Elysian" and "Laverton", which only ${ELY}'s text holds` });
  });

  test("namedByText: unique names in two documents select the set, each document's names in its own clause", () => {
    const r = namedByText({ message: "compare the Chester and the Laverton", holders, known: KNOWN });
    assert.deepStrictEqual(r.documents, [SP, ELY]);
    assert.strictEqual(r.reason, `the question names "Chester", which only ${SP}'s text holds; the question names "Laverton", which only ${ELY}'s text holds`);
  });

  test("namedByText (D4 (a)): no unique name — the ONE document holding every name is selected; two or more holding them all, nothing", () => {
    const r = namedByText({ message: "for each house design type in the Barratt Homes Phase 3 site plan please output", holders, known: KNOWN });
    assert.deepStrictEqual(r, { documents: [SP], reason: `the question names "Barratt", "Homes", "Phase", which only ${SP}'s text holds together` });
    assert.strictEqual(namedByText({ message: "what are the stpes involved in Setting the System", holders, known: KNOWN }), null, "three documents hold both — Q4 keeps the vote");
    assert.strictEqual(namedByText({ message: "based on the Phase 3 full site plan, how many homes", holders, known: KNOWN }), null, "one name held by three documents — Q6 keeps the vote");
  });

  test("namedByText: names no document holds, a stop-word refusal ([]) and documents the store does not list name nothing; no census, no selection", () => {
    assert.strictEqual(namedByText({ message: "the Chesterton design", holders, known: KNOWN }), null);
    assert.strictEqual(namedByText({ message: "about The Thing", holders, known: KNOWN }), null);
    assert.strictEqual(namedByText({ message: Q8, holders: () => ["Gone.pdf"], known: KNOWN }), null, "a holder the summary does not list");
    assert.strictEqual(namedByText({ message: Q8, holders: null, known: KNOWN }), null);
    assert.strictEqual(namedByText(), null);
  });

  test("resolveTurnScope: with the census, a name selects BEFORE retrieval (named, prefilter); without it the scope is exactly T15's", () => {
    const pre = resolveTurnScope({ message: Q8, ranked: [], summary: SUM, nameHolders: CENSUS });
    assert.strictEqual(pre.method, "named");
    assert.strictEqual(pre.prefilter, true);
    assert.deepStrictEqual(pre.documents.map((d) => d.source), [SP]);
    assert.strictEqual(pre.reason, `the question names "Chester", which only ${SP}'s text holds`);
    for (const input of [{ message: Q8, ranked: [], summary: SUM }, { message: "for each house design type please output the following:", ranked: Q12, summary: SUMMARY }, { message: "the Fervi manual", ranked: [ranked("Fervi_Lathe_TechnicalSupportManual.pdf", 0.9)], summary: SUMMARY }]) {
      assert.deepStrictEqual(resolveTurnScope({ ...input, nameHolders: null }), resolveTurnScope(input), "no census → today's scope");
    }
    assert.deepStrictEqual(resolveTurnScope({ message: Q8, ranked: [], summary: SUM, nameHolders: new Map(Object.entries(CENSUS)) }).documents.map((d) => d.source), [SP], "a Map is a census too");
  });

  test("resolveTurnScope: the request still comes first; a text-held name comes before a file-stem name and the vote", () => {
    assert.strictEqual(resolveTurnScope({ message: Q8, ranked: [], summary: SUM, requestScope: [ELY], nameHolders: CENSUS }).method, "request");
    const r = resolveTurnScope({ message: "In the Fervi lathe parts list, which part is the Comparator shaft?", ranked: [ranked(LATHE, 0.9)], summary: SUM, nameHolders: CENSUS });
    assert.strictEqual(r.method, "named");
    assert.strictEqual(r.prefilter, true, "selected by its text, not corroborated by its file stem");
    const voted = resolveTurnScope({ message: Q8, ranked: [ranked(ELY, 0.85), ranked(ELY, 0.84), ranked(ELY, 0.5), ranked(SP, 0.98)], summary: SUM, nameHolders: CENSUS });
    assert.deepStrictEqual(voted.documents.map((d) => d.source), [SP], "the name overrules a vote it contradicts (F-246's Q8)");
  });

  test("planLookupRead (D6 (a)): a name's selection is read whole as the request's is; a file-stem name (prefilter false) is not", () => {
    const named = resolveTurnScope({ message: Q8, ranked: [], summary: SUM, nameHolders: CENSUS });
    const v = planLookupRead({ mode: "doc", intent: "lookup", scope: named, setting: "whole", budgetTokens: 80000 });
    assert.strictEqual(v.read, true);
    assert.match(v.reason, /^the question's names selected Barratt_Homes_SitePlan\.pdf; ≈\d+ estimated tokens within the whole-document budget of 80000$/);
    assert.strictEqual(planLookupRead({ mode: "doc", intent: "lookup", scope: { ...named, prefilter: false }, setting: "whole", budgetTokens: 80000 }).read, false);
    const two = resolveTurnScope({ message: "compare the Chester and the Laverton", ranked: [], summary: SUM, nameHolders: CENSUS });
    assert.strictEqual(planLookupRead({ mode: "doc", intent: "lookup", scope: two, setting: "whole", budgetTokens: 80000 }).reason, "the question's names selected 2 documents — a lookup reads one whole");
    assert.strictEqual(planLookupRead({ mode: "doc", intent: "lookup", scope: resolveTurnScope({ message: "what does the Miele manual say about the Longitudinal axis?", ranked: [], summary: SUM, nameHolders: { longitudinal: [MIELE] } }), setting: "whole", budgetTokens: 80000 }).read, false, "over the budget (405 chunks) stays ranked within the document");
  });

  test("contested (D5 (a)): a vote another document nearly matched carries the list — in vote order, ≥ 0.9 of the winner's best — and its reason is today's, byte for byte", () => {
    const q12 = [ranked(ELY, 0.975), ranked(ELY, 0.968), ranked(ELY, 0.967), ranked(ELY, 0.953), ranked(ELY, 0.917), ranked(SP, 0.9), ranked(SP, 0.833), ranked(SAX, 0.937)];
    const withCensus = resolveTurnScope({ message: "for each house design type please output the following:", ranked: q12, summary: SUM, nameHolders: CENSUS });
    const today = resolveTurnScope({ message: "for each house design type please output the following:", ranked: q12, summary: SUM });
    assert.strictEqual(withCensus.method, "vote");
    assert.deepStrictEqual(withCensus.contested, [{ source: SP, best: 0.9, winnerBest: 0.975 }, { source: SAX, best: 0.937, winnerBest: 0.975 }]);
    assert.strictEqual(withCensus.reason, today.reason, "never in the prompt");
    assert.strictEqual(CONTESTED_RATIO, 0.9);
    const q6 = [ranked(SP, 0.989), ranked(SP, 0.963), ranked(SP, 0.368), ranked(ELY, 0.609), ranked(ELY, 0.524)];
    assert.deepStrictEqual(resolveTurnScope({ message: "based on the Phase 3 full site plan, how many homes", ranked: q6, summary: SUM }).contested, [], "Q6: 0.62 of the winner's best — not contested");
    assert.deepStrictEqual(contestedBy(), [], "total on junk");
    assert.strictEqual(resolveTurnScope({ message: Q8, ranked: [], summary: SUM, nameHolders: CENSUS }).contested, undefined, "only a vote carries the list");
  });

  test("summariseScope carries the contested list onto the wire (the page's notice reads it)", () => {
    assert.deepStrictEqual(summariseScope({ method: "vote", contested: [{ source: SP, best: 0.9, winnerBest: 0.975, extra: 1 }] }).contested, [{ source: SP, best: 0.9, winnerBest: 0.975 }]);
    assert.strictEqual(summariseScope({ method: "named" }).contested, null);
  });

  test("the orchestrator asks the census BEFORE the pre-retrieval scope and hands it to every resolveTurnScope call (§2.3)", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "lib", "orchestrator.js"), "utf8").replace(/\/\/[^\n]*/g, "");
    const census = src.indexOf("nameHolders = await summaryClient.documentsHolding(nameCensus.names);");
    const preScope = src.indexOf("preScope = resolveTurnScope({ message: cleanQuery, ranked: [], summary: dbSummaryDetails, requestScope: documentScope, threshold: CONTEXT_ASSEMBLY_CONSTANTS.SCOPE_DOMINANCE_SHARE, nameHolders });");
    assert.ok(census > 0 && preScope > census, "the census runs before the pre-retrieval scope");
    assert.strictEqual((src.match(/resolveTurnScope\(\{/g) || []).length, 3);
    assert.strictEqual((src.match(/resolveTurnScope\(\{[^}]*nameHolders \}\)/g) || []).length, 3, "every call carries the census");
    assert.match(src, /nameCensus\.names = questionNames\(cleanQuery\);/);
    assert.match(src, /d\.method === "named" \? "Lookup on the named document" : "Lookup on the selected document"/);
    // T30's A5, again (§11b): the Turn Scope spans read the census AFTER the retrieval block, so it is declared at the
    // turn's scope — block-scoped on the first T65 image it threw in the assembly trace on every document turn.
    const block = src.indexOf("const localOrigin = "); // the retrieval block opens here (its URL's // is stripped with the comments)
    for (const d of ["let nameHolders = null;", "const nameCensus = {"]) {
      assert.ok(src.indexOf(d) > -1 && block > -1 && src.indexOf(d) < block, `${d} is declared before the retrieval block`);
      assert.strictEqual(src.split(d).length - 1, 1, `${d} once`);
    }
  });
});

describe("U-SCOPE: T65 — the census, WeaviateClient.documentsHolding (D3 (a))", () => {
  const { WeaviateClient } = require("../../src/lib/vectordb/weaviate");
  const stub = (responses) => {
    const calls = [];
    const f = async (url, opts = {}) => {
      calls.push({ url: String(url), body: JSON.parse(opts.body || "{}") });
      const next = responses.shift();
      if (!next) throw new Error("fetch stub exhausted");
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body, text: async () => JSON.stringify(next.body) };
    };
    f.calls = calls;
    return f;
  };
  const withFetch = async (f, fn) => { const o = global.fetch; global.fetch = f; try { return await fn(); } finally { global.fetch = o; } };
  const groups = (rows) => ({ data: { Aggregate: { RAGChunkV2: rows.map(([value, count]) => ({ groupedBy: { value }, meta: { count } })) } } });

  test("one Aggregate per distinct lower-cased word, a token filter on text grouped by source; sources most chunks first", async () => {
    const f = stub([{ status: 200, body: groups([["Barratt_Homes-SaxonFields.pdf", 3], ["Barratt_Homes_SitePlan.pdf", 5]]) }, { status: 200, body: groups([["Barratt_Homes_SitePlan.pdf", 4]]) }]);
    const client = new WeaviateClient("http://w", "tok", "RAGChunkV2");
    const out = await withFetch(f, () => client.documentsHolding(["Barratt", "Chester", "barratt", "bad word!", ""]));
    assert.deepStrictEqual(out, { barratt: ["Barratt_Homes_SitePlan.pdf", "Barratt_Homes-SaxonFields.pdf"], chester: ["Barratt_Homes_SitePlan.pdf"] });
    assert.strictEqual(f.calls.length, 2);
    assert.match(f.calls[0].body.query, /RAGChunkV2\(where: \{ path: \["text"\], operator: Equal, valueText: "barratt" \}, groupBy: \["source"\]\)/);
    assert.ok(f.calls.every((c) => c.url === "http://w/v1/graphql"));
  });

  test("a store stop word is refused and read as held by no document; any other error throws (the caller degrades)", async () => {
    const client = new WeaviateClient("http://w", "tok", "RAGChunkV2");
    const refused = { errors: [{ message: "shard x: identify groups: retrieve doc IDs from searcher: invalid search term, only stopwords provided. Stopwords can be configured in class.invertedIndexConfig.stopwords" }] };
    assert.deepStrictEqual(await withFetch(stub([{ status: 200, body: refused }]), () => client.documentsHolding(["The"])), { the: [] });
    await assert.rejects(withFetch(stub([{ status: 200, body: { errors: [{ message: "boom" }] } }]), () => client.documentsHolding(["Chester"])), /GraphQL error/);
    await assert.rejects(withFetch(stub([{ status: 503, body: {} }]), () => client.documentsHolding(["Chester"])), /HTTP 503/);
    assert.deepStrictEqual(await withFetch(stub([]), () => client.documentsHolding([])), {}, "no words, no call");
  });
});
