/**
 * Document-scoped enumeration — ticket T28 (F-101, F-97 on enumeration
 * turns, F-96's wording; design t28-design.md §13).
 *
 * A "for each …" question is a coverage question: ranking by relevance
 * cannot answer "all of them" and cannot know what it missed — which is how
 * a confident "these designs have no page" note was born from a recall miss
 * (F-96). The owner's method is the algorithm: identify the document the
 * question is about, then read every page of it when it fits, and only fall
 * back to ranking when it does not — and say which happened. This module is
 * the pure half: it recognises the turn, resolves the document (a request
 * field, a name in the question, or a score-mass vote over the ranked
 * results), checks the budget, orders the document in page order, and words
 * the coverage the model is told. It knows nothing about the store or the
 * orchestrator (U-SCOPE).
 *
 * Measured (t28-design.md §13.0): the score-mass vote picks the right
 * document on all twelve of the owner's questions (share ≥ 0.79); every
 * document in the demo corpus fits under 80k estimated tokens; the
 * generator serves a 45.7k-token whole-document prompt in 27 s.
 *
 * T65 (t65-design.md D2 (a), D4 (a), D5 (a); F-246): since the owner's
 * fourteenth document the vote picks the Elysian brochure for five of the
 * Barratt Site Plan's eight designs asked unscoped — its many middling
 * passages outvote a few strong ones, and the question's name ("the
 * Chester") is never read. A name the question carries now SELECTS its
 * document, before retrieval, as the request's selection does: a name only
 * one document's text holds (the store's census, `nameHolders` — the
 * orchestrator asks the store), or failing that the one document whose text
 * holds every name. Measured on 66 unscoped questions: right on 62 of 64,
 * wrong on none (the vote: 53 and 9). A vote that another document nearly
 * matched, with no name to settle it, carries the list (`contested`) for the
 * page's notice — never the prompt.
 */

/** The orchestrator's multi-entity rule, moved here unchanged (design D14; F-111 notes it is coarse). */
const ENUMERATION_RE = /\b(each|all|every|list all|for each|compare|designs|houses|models|sections|types)\b/i;

/** Tokens of a file stem that name nothing on their own. */
const GENERIC_NAME_TOKENS = new Set(["manual", "guide", "document", "report", "final", "draft", "copy", "version", "file", "notes", "plan", "plans"]);

function detectEnumeration(message) {
  return ENUMERATION_RE.test(String(message ?? ""));
}

/** T65: capitalised words that name nothing (a sentence-initial word is skipped by its position). */
const NAME_STOP = new Set(["the", "this", "that", "these", "those", "what", "which", "where", "when", "who", "whom", "whose", "why", "how", "and", "but", "for", "with", "from", "into", "please", "also", "can", "could", "would", "should", "does", "did", "are", "was", "were", "its", "our", "your", "you", "any", "all", "each", "every", "both", "there", "here", "then", "than", "not", "yes", "has", "have", "had"]);

/** T65 (D5 (a), §0e): another document "nearly matched" a vote when its best passage is at least this share of the winner's best. */
const CONTESTED_RATIO = 0.9;

/**
 * T65 (t65-design.md D2 (a), §0d): the names a question carries — T30's
 * freshProperNoun rule applied to every match rather than the first: a
 * capitalised word of letters and digits, ≥ 3 characters, not
 * sentence-initial, not a short all-caps code (PPE, T999, IKEA — ≤ 5), not a
 * stop word ("The"). Each name once, in the question's order. Pure; total.
 */
function questionNames(message) {
  const text = String(message ?? "");
  const out = [];
  const re = /(^|[^A-Za-z0-9])([A-Za-z0-9]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tok = m[2];
    const before = text.slice(0, m.index + m[1].length).trimEnd();
    const sentenceInitial = before === "" || /[.!?:;]$/.test(before);
    if (!/^[A-Z]/.test(tok) || sentenceInitial || tok.length < 3) continue;
    if (/^[A-Z0-9'-]+$/.test(tok) && tok.length <= 5) continue;
    if (NAME_STOP.has(tok.toLowerCase())) continue;
    out.push(tok);
  }
  return [...new Set(out)];
}

/** The census as a lookup: `nameHolders` is { word (lower-cased): [source, …] } or a Map of the same; anything else holds nothing. */
function holdersFrom(nameHolders) {
  const get = (w) => (nameHolders instanceof Map ? nameHolders.get(w) : nameHolders && typeof nameHolders === "object" ? nameHolders[w] : null);
  return (name) => {
    const v = get(String(name).toLowerCase());
    return Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : [];
  };
}

/**
 * T65 (t65-design.md D2 (a), D4 (a); §0d): the document(s) a question's names
 * select. `holders(name)` lists the documents whose stored text holds the name
 * (the store's census — D3 (a)); `known` is the store summary's sources.
 *   - Every name only ONE known document holds selects it; several such names
 *     in different documents select the set (T15 D5's set rule then applies).
 *   - Failing that, the one known document whose text holds EVERY name the
 *     question carries (names no document holds are ignored) is selected —
 *     "Barratt" (two documents), "Homes" (three), "Phase" (four) → the Barratt
 *     Site Plan alone holds all three.
 *   - Otherwise null.
 * The reason is in words. Pure; total.
 */
function namedByText({ message, holders, known } = {}) {
  if (typeof holders !== "function") return null;
  const isKnown = (d) => !(known instanceof Set) || known.has(d);
  const hits = [];
  const held = [];
  for (const t of questionNames(message)) {
    const h = holders(t).filter(isKnown);
    if (h.length === 1) hits.push({ token: t, source: h[0] });
    if (h.length > 0) held.push({ token: t, sources: h });
  }
  if (hits.length > 0) {
    const byDoc = new Map();
    for (const x of hits) {
      if (!byDoc.has(x.source)) byDoc.set(x.source, []);
      byDoc.get(x.source).push(x.token);
    }
    const reason = [...byDoc.entries()].map(([s, ts]) => `the question names ${ts.map((t) => `"${t}"`).join(" and ")}, which only ${s}'s text holds`).join("; ");
    return { documents: [...byDoc.keys()], reason };
  }
  if (held.length > 1) {
    let common = held[0].sources;
    for (const s of held.slice(1)) common = common.filter((d) => s.sources.includes(d));
    if (common.length === 1) return { documents: common, reason: `the question names ${held.map((s) => `"${s.token}"`).join(", ")}, which only ${common[0]}'s text holds together` };
  }
  return null;
}

/**
 * T65 (t65-design.md D5 (a), §0e): the other ranked documents that nearly
 * matched a vote — each one's best passage at least CONTESTED_RATIO of the
 * winner's best — in vote order, with their best scores. [] when none. For the
 * page's notice only; never in the prompt. Pure; total.
 */
function contestedBy({ ranked, votes, winner, known, ratio = CONTESTED_RATIO } = {}) {
  const best = new Map();
  for (const c of Array.isArray(ranked) ? ranked : []) {
    const source = sourceOf(c);
    const s = Number(c && c.rerankScore);
    if (!source || !Number.isFinite(s)) continue;
    if (!best.has(source) || s > best.get(source)) best.set(source, s);
  }
  const top = best.get(winner) || 0;
  if (!(top > 0)) return [];
  return (Array.isArray(votes) ? votes : [])
    .filter((v) => v && v.source !== winner && (!(known instanceof Set) || known.has(v.source)) && (best.get(v.source) || 0) >= ratio * top)
    .map((v) => ({ source: v.source, best: Number(best.get(v.source).toFixed(4)), winnerBest: Number(top.toFixed(4)) }));
}

function sourceOf(chunk) {
  return chunk && typeof chunk.source === "string" ? chunk.source : "";
}

/** Distinctive name tokens of a file: the stem split on non-alphanumerics, ≥ 4 letters, not generic. */
function nameTokens(source) {
  const stem = String(source || "").replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return [...new Set(stem.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && /[a-z]/.test(t) && !GENERIC_NAME_TOKENS.has(t)))];
}

/**
 * Which summary documents the question names, by a whole-word match on a
 * DISTINCTIVE token: one that names exactly one document in the store (A18 —
 * "homes" is in two Barratt file names and in many questions; it names
 * nothing). Ambiguous tokens fall through to the vote.
 */
function documentsNamedIn(message, summary) {
  const text = String(message ?? "").toLowerCase();
  const docs = (Array.isArray(summary) ? summary : []).map((d) => (d && typeof d.source === "string" ? d.source : "")).filter(Boolean);
  const owners = new Map();
  for (const source of docs) for (const t of nameTokens(source)) owners.set(t, (owners.get(t) || 0) + 1);
  const named = [];
  for (const source of docs) {
    const hit = nameTokens(source)
      .filter((t) => owners.get(t) === 1)
      .find((t) => new RegExp(`(?<![a-z0-9])${t.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&")}(?![a-z0-9])`).test(text));
    if (hit) named.push({ source, token: hit });
  }
  return named;
}

/** The score-mass vote: per document, its ranked chunks, the sum of their finite rerank scores, and the share of the total. */
function voteBySource(ranked) {
  const by = new Map();
  for (const c of Array.isArray(ranked) ? ranked : []) {
    const source = sourceOf(c);
    if (!source) continue;
    if (!by.has(source)) by.set(source, { source, chunks: 0, mass: 0 });
    const v = by.get(source);
    v.chunks++;
    const s = Number(c.rerankScore);
    if (Number.isFinite(s) && s > 0) v.mass += s;
  }
  const votes = [...by.values()];
  const totalMass = votes.reduce((a, v) => a + v.mass, 0);
  const totalChunks = votes.reduce((a, v) => a + v.chunks, 0);
  // Every score null (a degraded turn) → the vote is by chunk count, said so.
  const basis = totalMass > 0 ? "mass" : "count";
  for (const v of votes) v.share = basis === "mass" ? v.mass / totalMass : totalChunks > 0 ? v.chunks / totalChunks : 0;
  votes.sort((a, b) => b.share - a.share || b.chunks - a.chunks || a.source.localeCompare(b.source));
  return { votes: votes.map((v) => ({ ...v, mass: Number(v.mass.toFixed(4)), share: Number(v.share.toFixed(4)) })), basis };
}

function summaryEntry(summary, source) {
  const doc = (Array.isArray(summary) ? summary : []).find((d) => d && d.source === source);
  return {
    source,
    chunkCount: doc && Number.isFinite(Number(doc.chunkCount)) ? Number(doc.chunkCount) : null,
    totalPages: doc && Number.isFinite(Number(doc.totalPages)) ? Number(doc.totalPages) : null,
  };
}

function sourceIdFor(ranked, source) {
  const c = (Array.isArray(ranked) ? ranked : []).find((x) => sourceOf(x) === source && typeof x.sourceId === "string" && x.sourceId);
  return c ? c.sourceId : null;
}

/**
 * Resolve the ONE document an enumeration turn is about (design D15), in
 * precedence: a request field naming a document the store holds → a
 * document named in the question → the vote with a dominance share ≥
 * threshold → none. Pure; total.
 */
function resolveDocumentScope({ message, ranked, summary, requestScope, threshold = 0.5 } = {}) {
  const { votes, basis } = voteBySource(ranked);
  const known = new Set((Array.isArray(summary) ? summary : []).map((d) => d && d.source).filter(Boolean));
  const finish = (method, source, reason) => ({
    method,
    document: source ? { ...summaryEntry(summary, source), sourceId: sourceIdFor(ranked, source) } : null,
    votes,
    voteBasis: basis,
    threshold,
    reason,
  });

  const requested = (Array.isArray(requestScope) ? requestScope : typeof requestScope === "string" && requestScope ? [requestScope] : [])
    .filter((s) => typeof s === "string" && known.has(s));
  if (requested.length > 0) return finish("request", requested[0], `the request named ${requested[0]}`);

  const named = documentsNamedIn(message, summary);
  if (named.length > 0) {
    // Several named → the one the ranked results favour, else the first.
    const pick = named.map((n) => ({ ...n, share: (votes.find((v) => v.source === n.source) || { share: 0 }).share })).sort((a, b) => b.share - a.share)[0];
    return finish("named", pick.source, `the question names "${pick.token}" (${pick.source})`);
  }

  const top = votes[0];
  // Dominance: at or above the threshold AND strictly ahead of the runner-up
  // (two documents at exactly 0.5 each is a tie, not a scope).
  const dominant = top && top.share >= threshold && (!votes[1] || top.share > votes[1].share);
  if (dominant && known.has(top.source)) {
    return finish("vote", top.source, `${top.source} holds ${(top.share * 100).toFixed(0)}% of the ranked results' ${basis === "mass" ? "reranker score" : "chunk count"} (threshold ${(threshold * 100).toFixed(0)}%)`);
  }
  if (dominant && !known.has(top.source)) {
    return finish("none", null, `${top.source} dominates the ranked results but the store's summary does not list it`);
  }
  return finish("none", null, top ? `no single document dominates the ranked results (top: ${top.source} at ${(top.share * 100).toFixed(0)}%)` : "no ranked results to vote on");
}

/**
 * Does the document fit the whole-document budget? Before the read the size
 * is an estimate from the store's chunk count; after it the measured chars.
 */
function budgetFor({ document, chars = null, rows = null, budgetTokens, charsPerToken = 3.2, meanCharsPerChunk = 800, headerCharsPerBlock = 120 } = {}) {
  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? Math.floor(budgetTokens) : 0;
  const cpt = Number.isFinite(charsPerToken) && charsPerToken > 0 ? charsPerToken : 3.2;
  const count = document && Number.isFinite(document.chunkCount) ? document.chunkCount : null;
  // Every block carries a header ([S#] (Document…, Page…, Section…)) the
  // model reads too (A13): counted per row measured, per stored chunk estimated.
  const headerChars = (Number.isFinite(rows) ? rows : count !== null ? count : 0) * headerCharsPerBlock;
  const estimatedChars = Number.isFinite(chars) ? chars + headerChars : count !== null ? count * meanCharsPerChunk + headerChars : null;
  const estimatedTokens = estimatedChars === null ? null : Math.ceil(estimatedChars / cpt);
  return {
    fits: estimatedTokens !== null && budget > 0 && estimatedTokens <= budget,
    estimatedTokens,
    budgetTokens: budget,
    basis: Number.isFinite(chars) ? "measured" : count !== null ? "estimated" : "unknown",
  };
}

function locatedPage(chunk) {
  const p = Number(chunk && chunk.page);
  return Number.isInteger(p) && p > 0 ? p : null;
}
function isCaption(chunk) {
  if (!chunk || typeof chunk !== "object") return false;
  if (chunk.isVisualElement === true) return true;
  try {
    const m = typeof chunk.metadata === "string" ? JSON.parse(chunk.metadata || "{}") : chunk.metadata;
    return !!(m && m.isVisualElement === true);
  } catch (e) {
    return false;
  }
}

/** Page order: page (unlocated last), text before captions, chunkIndex, then stored order. The page-level assembly generalised. */
function orderDocument(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r === "object")
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const pa = locatedPage(a.r) ?? Number.MAX_SAFE_INTEGER;
      const pb = locatedPage(b.r) ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      const ca = isCaption(a.r) ? 1 : 0;
      const cb = isCaption(b.r) ? 1 : 0;
      if (ca !== cb) return ca - cb;
      const ia = Number.isInteger(a.r.chunkIndex) ? a.r.chunkIndex : Number.MAX_SAFE_INTEGER;
      const ib = Number.isInteger(b.r.chunkIndex) ? b.r.chunkIndex : Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/**
 * The coverage block the model reads before the numbered context, and which
 * wording rule 7 gets (design D18 — the F-96 fix).
 */
function coverageStatement({ method, coverage, document, chunksRead = null, chunksInStore = null, pages = null, blocksShown = null, estimatedTokens = null, budgetTokens = null, excludedForeign = 0, reason = "", partialCause = null, error = null } = {}) {
  const name = document && document.source ? document.source : "the document";
  let block;
  if (coverage === "complete") {
    block =
      `[Document scope: ${name} — chosen because ${reason || method}. ` +
      `Coverage: COMPLETE — every one of the document's ${chunksRead} passages` +
      (pages ? ` on ${pages} page(s)` : "") +
      ` was read and is shown below in page order` +
      (Number.isFinite(blocksShown) && blocksShown !== chunksRead ? ` (${blocksShown} blocks after omitting boilerplate without data)` : "") +
      (excludedForeign > 0 ? `; ${excludedForeign} retrieved passage(s) from other documents were left out` : "") +
      `.]`;
  } else if (coverage === "partial") {
    // Two honest causes (A11): the document is over the budget, or the read
    // returned fewer passages than the store holds — never the wrong one.
    const cause =
      partialCause === "incomplete-read"
        ? `the read returned ${chunksRead ?? "?"} of the document's ${chunksInStore ?? "?"} passages`
        : `the document (${chunksInStore ?? "?"} passages` +
          (Number.isFinite(estimatedTokens) ? `, ≈${estimatedTokens} tokens` : "") +
          `) exceeds the whole-document budget` +
          (Number.isFinite(budgetTokens) ? ` of ${budgetTokens} tokens` : "");
    block =
      `[Document scope: ${name} — chosen because ${reason || method}. ` +
      `Coverage: PARTIAL — ${cause}, so only the ranked passages are shown; an enumeration may be incomplete.]`;
  } else if (document && document.source) {
    // A document was chosen but could not be read (A12): say both.
    block =
      `[Document scope: ${name} — chosen because ${reason || method}, but the document could not be read` +
      (error ? ` (${String(error).slice(0, 160)})` : "") +
      `. Coverage: RANKED — only the ranked passages are shown; an enumeration may be incomplete.]`;
  } else {
    block =
      `[Document scope: none — ${reason || "no single document dominated the retrieved passages"}. ` +
      `Coverage: RANKED — only the ranked passages are shown; an enumeration may be incomplete.]`;
  }
  return { block, noteWording: coverage === "complete" ? "complete" : "partial" };
}

/** Rule 7's closing note, worded by what the model was actually shown. */
function legendNoteRule(noteWording) {
  if (noteWording === "complete") {
    return `   - At the very end of your response, list any index-only names in a single concise note: "### Index / Legend Note: The following items appear on the master index/legend but do not have dedicated specification pages in this document: [List of index-only names]." (The whole document was read, so this statement is true of the document.)`;
  }
  return `   - At the very end of your response, list any index-only names in a single concise note: "### Index / Legend Note: The following items appear on the master index/legend but were not among the passages retrieved for this question: [List of index-only names]." NEVER state that such an item has no page in the document — the document was not read in full, so its absence here is not evidence.`;
}

/**
 * T63 (t63-design.md D11 (a), §0i): rule 7's closing-note bullet as a LINE of the prompt — the bullet and its newline —
 * or nothing on a whole-document LOOKUP. Measured on the owner's own turns: with the note, 8 of 85 whole-document lookup
 * answers said an index-only item (Affordable housing, the Show Home) "has its own dedicated specification pages";
 * without it 0 of 30, and nothing else changed (30 / 30 right in both). Enumerations keep the note (T28's F-96 fix is
 * theirs), and a ranked turn keeps today's line byte for byte.
 */
function legendNoteLine({ noteWording, wholeDocumentLookup = false } = {}) {
  return wholeDocumentLookup === true ? "" : `${legendNoteRule(noteWording)}\n`;
}

/**
 * T63 (t63-design.md §2.1; D2 (a), D3 (a), D7 (a)): does a document-mode LOOKUP read its document whole? Only when the
 * REQUEST named the scope (T15's pre-filter scope, method "request" — the composer's selector) and named exactly one
 * document the store holds, the setting is "whole", and the document's pre-read estimate — budgetFor over the summary's
 * chunk count, the one planDocumentReads uses — fits the budget. An enumeration is T28's path and a count T09's; code
 * and chat turns never read a document whole. The verdict comes with its reason in words (the Turn Scope span says it).
 * T65 (t65-design.md D6 (a)): a document a name SELECTED before retrieval (method "named", prefilter — namedByText) is
 * read whole exactly as the request's is; a file-stem name (prefilter false, T15 A11) is not. Pure; total.
 */
function planLookupRead({ mode, intent, scope, setting = "whole", budgetTokens, meanCharsPerChunk = 800, charsPerToken = 3.2, headerCharsPerBlock = 120 } = {}) {
  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? Math.floor(budgetTokens) : 0;
  const no = (reason, document = null, estimatedTokens = null) => ({ read: false, reason, document, estimatedTokens, budgetTokens: budget });
  if (mode !== "doc") return no(`a ${mode || "non-document"} turn never reads a document whole`);
  if (intent !== "lookup") return no(`not a lookup (intent ${intent})`);
  if (setting !== "whole") return no(`lookupDocumentRead is ${setting} — the ranked passages are shown`);
  if (!scope || (scope.method !== "request" && scope.method !== "named") || scope.prefilter !== true) return no("no document was selected in the request");
  const by = scope.method === "named" ? "the question's names selected" : "the request selected";
  const docs = Array.isArray(scope.documents) ? scope.documents.filter((d) => d && typeof d.source === "string" && d.source) : [];
  if (docs.length !== 1) return no(`${by} ${docs.length} documents — a lookup reads one whole`);
  const d = docs[0];
  const est = budgetFor({ document: d, budgetTokens: budget, meanCharsPerChunk, charsPerToken, headerCharsPerBlock });
  if (!est.fits) {
    return no(est.estimatedTokens === null ? `the size of ${d.source} is unknown` : `${d.source} (≈${est.estimatedTokens} estimated tokens) exceeds the whole-document budget of ${budget}`, d, est.estimatedTokens);
  }
  return { read: true, reason: `${by} ${d.source}; ≈${est.estimatedTokens} estimated tokens within the whole-document budget of ${budget}`, document: d, estimatedTokens: est.estimatedTokens, budgetTokens: budget };
}


/**
 * T15 (design D4 / D5): the scope of a turn as a SET of documents, resolved
 * in the same precedence as resolveDocumentScope — every requested name the
 * store knows → every document the question names → the one dominant
 * document by vote → none. `prefilter` says whether the scope was known
 * BEFORE retrieval (request / named), so retrieval itself can be filtered
 * to it; a vote needs the unfiltered ranked set and filters after ranking.
 * T65 (D2 (a)): with the store's census of the question's names
 * (`nameHolders` — { word: [source, …] }), a name the text of one document
 * holds selects it after the request and before every other source
 * (method "named", prefilter); without the census the rule never fires and
 * the scope is exactly T15's. A vote carries `contested` (D5 (a)).
 * Pure; total.
 */
function resolveTurnScope({ message, ranked, summary, requestScope, threshold = 0.5, previousScope = null, followUp = false, nameHolders = null } = {}) {
  const { votes, basis } = voteBySource(ranked);
  const known = new Set((Array.isArray(summary) ? summary : []).map((d) => d && d.source).filter(Boolean));
  const entry = (source) => ({ ...summaryEntry(summary, source), sourceId: sourceIdFor(ranked, source), sourceIds: sourceIdsFor(summary, source) });
  const shareOf = (source) => (votes.find((v) => v.source === source) || { share: 0 }).share;
  const finish = (method, sources, reason, prefilter) => ({
    method,
    documents: sources.map(entry),
    votes,
    voteBasis: basis,
    threshold,
    reason,
    prefilter,
  });

  const requestedRaw = Array.isArray(requestScope) ? requestScope : typeof requestScope === "string" && requestScope ? [requestScope] : [];
  const requested = [...new Set(requestedRaw.filter((s) => typeof s === "string" && known.has(s)))];
  const unknownRequested = requestedRaw.filter((s) => typeof s === "string" && s && !known.has(s));
  if (requested.length > 0) {
    return finish(
      "request",
      requested,
      `the request named ${requested.join(", ")}${unknownRequested.length ? ` (ignored, not in the store: ${unknownRequested.join(", ")})` : ""}`,
      true
    );
  }

  // T65 (t65-design.md D2 (a), D4 (a)): a name the question carries that the
  // store's TEXT holds selects its document(s) — before retrieval, as the
  // request's selection does. The census needs only the message, and the
  // name in the document's own text is the evidence (T15 A11's corroboration
  // stays for file-stem tokens, below). No census → no selection.
  if (nameHolders) {
    const byText = namedByText({ message, holders: holdersFrom(nameHolders), known });
    if (byText) return finish("named", byText.documents, byText.reason, true);
  }

  // A name in the question is EVIDENCE, not a selection (T15 A11 — the
  // session-25 dry run's Q5 "…on the machine" named the Miele manual by its
  // stem token "machine" and a pre-filter then searched the wrong document):
  // a named document counts only when retrieval ranked at least one of its
  // chunks, and it filters after ranking. With no ranked set (the
  // pre-retrieval call) no name is resolved — only the request pre-filters.
  const rankedSources = new Set(votes.map((v) => v.source));
  const namedAll = documentsNamedIn(message, summary);
  const named = namedAll.filter((n) => rankedSources.has(n.source)).sort((a, b) => shareOf(b.source) - shareOf(a.source) || a.source.localeCompare(b.source));
  if (named.length > 0) {
    const dropped = namedAll.filter((n) => !rankedSources.has(n.source));
    return finish(
      "named",
      named.map((n) => n.source),
      `the question names ${named.map((n) => `"${n.token}" (${n.source})`).join(" and ")} and retrieval ranked ${named.length === 1 ? "it" : "them"}` +
        (dropped.length ? ` (${dropped.map((n) => `"${n.token}"`).join(", ")} named nothing retrieval found)` : ""),
      false
    );
  }
  const uncorroborated = namedAll.length > 0 && votes.length > 0 ? ` ("${namedAll.map((n) => n.token).join('", "')}" named a document retrieval did not rank)` : "";

  const top = votes[0];
  const dominant = top && top.share >= threshold && (!votes[1] || top.share > votes[1].share);
  if (dominant && known.has(top.source)) {
    // T65 (D5 (a)): the documents that nearly matched the vote — for the page's notice, never the prompt.
    return {
      ...finish("vote", [top.source], `${top.source} holds ${(top.share * 100).toFixed(0)}% of the ranked results' ${basis === "mass" ? "reranker score" : "chunk count"} (threshold ${(threshold * 100).toFixed(0)}%)${uncorroborated}`, false),
      contested: contestedBy({ ranked, votes, winner: top.source, known }),
    };
  }
  if (dominant && !known.has(top.source)) {
    return finish("none", [], `${top.source} dominates the ranked results but the store's summary does not list it`, false);
  }
  const noVote = (top ? `no single document dominates the ranked results (top: ${top.source} at ${(top.share * 100).toFixed(0)}%)` : "no ranked results to vote on") + uncorroborated;
  // T30 (design D6 / D7): the FOURTH source — the previous turn's resolved
  // document(s), carried forward on a follow-up turn only, and only those
  // the store knows AND retrieval ranked (A11's corroboration: a scope can
  // never empty the prompt). A fresh question never inherits; a follow-up
  // whose own vote is dominant elsewhere follows its vote (above).
  if (followUp === true && Array.isArray(previousScope) && previousScope.length > 0) {
    const carried = [...new Set(previousScope.filter((x) => typeof x === "string" && x && known.has(x) && rankedSources.has(x)))].sort((a, b) => shareOf(b) - shareOf(a) || a.localeCompare(b));
    if (carried.length > 0) {
      const counts = carried.map((x) => `${(votes.find((v) => v.source === x) || { chunks: 0 }).chunks} of its passages ranked`);
      return finish("previous", carried, `carried forward from the previous turn (${carried.join(", ")}) — ${counts.join("; ")}; ${noVote}`, false);
    }
    const unranked = previousScope.filter((x) => typeof x === "string" && x);
    return finish("none", [], `${noVote} (the previous turn's ${unranked.join(", ")} not carried forward: retrieval ranked none of its passages)`, false);
  }
  return finish("none", [], noVote, false);
}

/**
 * T30 (design D5): a proper noun the message introduces that the previous
 * turn does not contain — a capitalised token of ≥ 3 letters that is not
 * sentence-initial and not a short all-caps code (PPE, T999, RPM); "and how
 * much square footage does the Alderney design provide?" after a Chester
 * turn is a fresh question with a conjunction in front of it. Returns the
 * first such token, or null. Pure; total.
 */
function freshProperNoun(message, previousTurn) {
  const text = String(message ?? "");
  const prev = String(previousTurn ?? "").toLowerCase();
  // A token is letters and digits only: "Chester's" is the Chester, "PPE-rated" is PPE.
  const re = /(^|[^A-Za-z0-9])([A-Z][A-Za-z0-9]{2,})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tok = m[2];
    const before = text.slice(0, m.index + m[1].length).trimEnd();
    const sentenceInitial = before === "" || /[.!?:;]$/.test(before);
    if (sentenceInitial) continue;
    if (/^[A-Z0-9'-]+$/.test(tok) && tok.length <= 5) continue; // PPE, T999, RPM, VLM
    if (prev.includes(tok.toLowerCase())) continue;
    return tok;
  }
  return null;
}

/**
 * T30 (design D4 / D5): the retrieval query of a turn. On a follow-up (the
 * router's verdict) it is the previous user turn followed by the current
 * message — one hop, the previous turn truncated at `maxPrefixChars`, the
 * current message never — unless the message names a document (T28's rule
 * against the store summary) or introduces a proper noun the previous turn
 * lacks: a fresh referent retrieves on its own words. The model's message
 * is never this string (D8). Pure; total; never throws on junk.
 */
function buildRetrievalQuery({ route, summary, maxPrefixChars = 600 } = {}) {
  const message = String(route && route.cleanMessage ? route.cleanMessage : "").trim();
  const fu = route && route.followUp && typeof route.followUp === "object" ? route.followUp : null;
  const base = { query: message, applied: false, cue: fu ? fu.cue ?? null : null, previousScope: fu && Array.isArray(fu.previousScope) ? fu.previousScope : null };
  if (!fu || fu.detected !== true) return { ...base, reason: fu ? fu.reason : "no follow-up verdict" };
  const previous = typeof fu.previousTurn === "string" ? fu.previousTurn.trim() : "";
  if (!previous) return { ...base, reason: "no previous user turn" };
  const named = documentsNamedIn(message, summary);
  if (named.length > 0) return { ...base, reason: `the message names "${named[0].token}" (${named[0].source}) — a fresh referent` };
  // A1: the proper-noun guard applies to a CONTINUATION cue ("and … the
  // Alderney …" is a fresh question with a conjunction in front); a pronoun
  // needs its antecedent whatever else the message names ("compare it with
  // the Alderney" needs the Chester AND the Alderney).
  const noun = fu.cueKind === "pronoun" ? null : freshProperNoun(message, previous);
  if (noun) return { ...base, reason: `the message names "${noun}", absent from the previous turn — a fresh referent` };
  const cap = Number.isFinite(maxPrefixChars) && maxPrefixChars > 0 ? Math.floor(maxPrefixChars) : 600;
  const prefix = previous.length > cap ? previous.slice(0, cap).trimEnd() : previous;
  return { ...base, query: `${prefix} ${message}`.trim(), applied: true, reason: fu.reason, prefixChars: prefix.length, truncated: previous.length > cap };
}

/** The summary's `sourceIds` for a document when the documents route supplied them (v2), else []. */
function sourceIdsFor(summary, source) {
  const doc = (Array.isArray(summary) ? summary : []).find((d) => d && d.source === source);
  return doc && Array.isArray(doc.sourceIds) ? doc.sourceIds.filter((s) => typeof s === "string" && s) : [];
}

/**
 * D5: which documents of a set an enumeration turn reads WHOLE — in the given
 * order (vote share, or the request's order), while the running estimate
 * fits the budget. A document that does not fit is never cut: it is left
 * unread and named. Each document carries its pre-read estimate
 * (`budgetFor`'s estimate from the summary's chunk count).
 */
function planDocumentReads({ documents, budgetTokens, meanCharsPerChunk = 800, charsPerToken = 3.2, headerCharsPerBlock = 120 } = {}) {
  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? Math.floor(budgetTokens) : 0;
  const read = [];
  const unread = [];
  let used = 0;
  for (const d of Array.isArray(documents) ? documents : []) {
    if (!d || typeof d !== "object") continue;
    const est = budgetFor({ document: d, budgetTokens: budget, meanCharsPerChunk, charsPerToken, headerCharsPerBlock });
    const tokens = est.estimatedTokens;
    if (tokens !== null && budget > 0 && used + tokens <= budget) {
      read.push({ ...d, estimatedTokens: tokens });
      used += tokens;
    } else {
      unread.push({ ...d, estimatedTokens: tokens, reason: tokens === null ? "size unknown" : budget > 0 ? `≈${tokens} tokens would exceed the remaining budget (${Math.max(0, budget - used)} of ${budget})` : "no budget" });
    }
  }
  return { read, unread, budgetTokens: budget, estimatedTokensUsed: used };
}

/**
 * D5 wording: the coverage block for a SET — one line per document read
 * whole (complete, or partial with A11's true cause), the unread documents
 * named with why, the foreign exclusions counted. Rule 7 may claim absence
 * only when EVERY in-scope document was read whole and none was left unread.
 */
function coverageStatementForSet({ method, reason = "", reads = [], unread = [], excludedForeign = 0, budgetTokens = null, error = null, documents = [] } = {}) {
  const names = [...reads.map((r) => r.source), ...unread.map((u) => u.source)].filter(Boolean);
  if (names.length === 0) {
    // Nothing read and nothing planned: no scope (T28's wording), or a
    // document chosen but not readable (A12 — the error names it).
    const chosen = Array.isArray(documents) && documents.length > 0 ? { source: documents.map((d) => d.source).join(", ") } : null;
    return coverageStatement({ method, coverage: "ranked", document: error ? chosen : null, excludedForeign, reason, error });
  }
  if (names.length === 1) {
    // One document: the T28 wording, unchanged (U-SCOPE's pins) — read
    // whole, read partially, or over the budget before any read.
    const r = reads[0] || { source: unread[0].source, coverage: "partial", partialCause: "budget", chunksRead: null, chunksInStore: unread[0].chunkCount ?? null, pages: unread[0].totalPages ?? null, estimatedTokens: unread[0].estimatedTokens ?? null };
    return coverageStatement({ method, coverage: r.coverage, document: { source: r.source }, chunksRead: r.chunksRead, chunksInStore: r.chunksInStore, pages: r.pages, blocksShown: r.blocksShown ?? null, estimatedTokens: r.estimatedTokens, budgetTokens, excludedForeign, reason, partialCause: r.partialCause ?? null, error });
  }
  const lines = reads.map((r) =>
    r.coverage === "complete"
      ? `${r.source}: COMPLETE — every one of its ${r.chunksRead} passages${r.pages ? ` on ${r.pages} page(s)` : ""} is shown below in page order`
      : `${r.source}: PARTIAL — ${r.partialCause === "incomplete-read" ? `the read returned ${r.chunksRead ?? "?"} of its ${r.chunksInStore ?? "?"} passages` : `it exceeds the whole-document budget`}, so only its ranked passages are shown`
  );
  for (const u of unread) lines.push(`${u.source}: NOT READ — ${u.reason || "over the budget"}; only its ranked passages are shown, so an enumeration over it may be incomplete`);
  const allComplete = unread.length === 0 && reads.length > 0 && reads.every((r) => r.coverage === "complete");
  const block =
    `[Document scope: ${names.join(", ")} — chosen because ${reason || method}. Coverage: ` +
    lines.join("; ") +
    (excludedForeign > 0 ? `; ${excludedForeign} retrieved passage(s) from other documents were left out` : "") +
    `.]`;
  return { block, noteWording: allComplete ? "complete" : "partial" };
}

/**
 * D4: the one-line scope block on a LOOKUP turn (no whole-document read):
 * which document(s) the turn was scoped to, why, and how many retrieved
 * passages from other documents were left out. Nothing is said about
 * coverage — the ranked passages are the context, as on any lookup.
 */
function lookupScopeStatement({ method, documents = [], reason = "", excludedForeign = 0, prefilter = false } = {}) {
  const names = documents.map((d) => d && d.source).filter(Boolean);
  if (names.length === 0) return null;
  return (
    `[Document scope: ${names.join(", ")} — chosen because ${reason || method}. ` +
    (prefilter ? `Retrieval was limited to ${names.length === 1 ? "this document" : "these documents"}` : `Only passages from ${names.length === 1 ? "this document" : "these documents"} are shown`) +
    (excludedForeign > 0 ? `; ${excludedForeign} retrieved passage(s) from other documents were left out` : "") +
    `.]`
  );
}

/** The response's `documentScope` summary (design §13.5): names and numbers only, never the rows. */
function summariseScope(ctx) {
  if (!ctx || typeof ctx !== "object") return null;
  const d = ctx.document && typeof ctx.document === "object" ? ctx.document : null;
  return {
    enumeration: ctx.enumeration === true,
    method: ctx.method ?? null,
    document: d ? { source: d.source ?? null, chunkCount: d.chunkCount ?? null, totalPages: d.totalPages ?? null } : null,
    coverage: ctx.coverage ?? null,
    chunksRead: ctx.chunksRead ?? null,
    chunksInStore: ctx.chunksInStore ?? null,
    pages: ctx.pages ?? null,
    estimatedTokens: ctx.estimatedTokens ?? null,
    budgetTokens: ctx.budgetTokens ?? null,
    excludedForeign: ctx.excludedForeign ?? 0,
    // The distinct located pages the model was shown on a complete read
    // (A19) — the citation instrument's reference set, never "1..N".
    pagesRead: Array.isArray(ctx.pagesRead) ? [...ctx.pagesRead] : null,
    // T15 (D4 / D5): the set — every document in scope, whether retrieval
    // was pre-filtered to it, and what was read / left unread.
    documents: Array.isArray(ctx.documents) ? ctx.documents.map((d) => ({ source: d.source ?? null, chunkCount: d.chunkCount ?? null, totalPages: d.totalPages ?? null })) : null,
    prefilter: ctx.prefilter === true,
    reads: Array.isArray(ctx.reads) ? ctx.reads.map((r) => ({ source: r.source, coverage: r.coverage, chunksRead: r.chunksRead ?? null, chunksInStore: r.chunksInStore ?? null, pages: r.pages ?? null, estimatedTokens: r.estimatedTokens ?? null })) : null,
    unread: Array.isArray(ctx.unread) ? ctx.unread.map((u) => ({ source: u.source, estimatedTokens: u.estimatedTokens ?? null, reason: u.reason ?? null })) : null,
    // Which rule-7 wording the model was given (design D18): "complete" may
    // claim a design has no page; "partial" may not.
    noteWording: ctx.noteWording ?? null,
    reason: ctx.reason ?? null,
    error: ctx.error ?? null,
    // T65 (D5 (a)): on a vote, the documents that nearly matched it — the page's notice reads this, never the prompt.
    contested: Array.isArray(ctx.contested) ? ctx.contested.map((c) => ({ source: c.source, best: c.best ?? null, winnerBest: c.winnerBest ?? null })) : null,
  };
}

module.exports = {
  ENUMERATION_RE,
  CONTESTED_RATIO,
  questionNames,
  namedByText,
  contestedBy,
  resolveTurnScope,
  freshProperNoun,
  buildRetrievalQuery,
  sourceIdsFor,
  planDocumentReads,
  coverageStatementForSet,
  lookupScopeStatement,
  summariseScope,
  detectEnumeration,
  nameTokens,
  documentsNamedIn,
  voteBySource,
  resolveDocumentScope,
  budgetFor,
  orderDocument,
  coverageStatement,
  legendNoteRule,
  legendNoteLine,
  planLookupRead,
};
