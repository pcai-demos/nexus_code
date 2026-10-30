/**
 * The single mode router — ticket T15 (FM-N4 / E27 / E28 / E29, F-97 on
 * lookup turns, F-111; design t15-design.md §2–§3, §12a).
 *
 * Before T15 two word lists chose a turn's fate independently: the client's
 * verb scorer picked the backend (and so the model / endpoint trio) and the
 * orchestrator's keyword rule picked the mode (and so the prompt template,
 * the retrieval budget and — in code mode — a DIFFERENT model name on the
 * client's URL). Measured on the owner's twelve questions without the `/doc`
 * prefix: the two disagreed on nine, eight ran on the code model, one
 * produced a 404 answer (§0 items 5–7). This module is the one rule, in one
 * place, evaluated by the client (to pick the endpoint) and by the server
 * (to pick everything else) — U-ROUTER pins the two equal on every fixture.
 *
 * The owner's decision (D2, 2026-09-10): this app is a coding assistant by
 * default, so a turn with no slash command is a CODE turn; `/doc` (= `/rag`)
 * is the door to the RAG module and `/chat` to plain conversation. Phrasing
 * can no longer change the mode, the budget or the model in either
 * direction — that is what the paraphrase-invariance test pins.
 *
 * Pure, total, CJS (imported by the orchestrator, the two routes and the
 * page). It knows nothing about the store; the scope step is scope.js's.
 */
const { detectEnumeration, ENUMERATION_RE } = require("./scope");
const { normaliseTerm } = require("./aggregation");

/** The slash commands and the mode each forces. `/rag` is `/doc`'s alias. */
const SLASH_COMMANDS = Object.freeze({ "/chat": "chat", "/doc": "doc", "/rag": "doc", "/code": "code" });
const SLASH_RE = /^\/(chat|doc|rag|code)\b\s*/i;

/**
 * IDE-context signals (the client's former IDE_CONTEXT_SIGNALS and file
 * reference, unchanged). Since D2 made code the default they no longer
 * decide the mode; they are REPORTED (`modeSource: "ide-signal"`) so the
 * span says why a turn is a code turn when the user pointed at the editor.
 */
const IDE_SIGNALS = Object.freeze([
  /\bthis (file|code|function|class|module|script)\b/i,
  /\bcurrent (file|code|tab|editor)\b/i,
  /\bthe (active|open|selected) (file|code|tab)\b/i,
  /\bline\s+\d+/i,
  /\blines?\s+\d+\s*[-–to]\s*\d+/i,
  /\bin the (editor|ide|workspace)\b/i,
  /\bin my (code|file|project)\b/i,
]);
const FILE_REF_RE = /\b([\w./-]+\.(py|js|ts|java|go|c|cpp|rs|f90|cob|pas|rb|pl|sh|json|yaml|yml|md|sql|html|css|dockerfile))\b/i;

/** The orchestrator's dimensional flag, moved here unchanged (it drives the per-page diversity limit and the legend split). */
const DIMENSIONAL_RE = /\b(dimension|dimensions|square footage|sq ft|storeys|bedrooms|rooms|breakdown)\b/i;

/**
 * The enumerate intent's retrieval overrides and context depth (T08 / T09 / T28 — the numbers the orchestrator carried;
 * unchanged). T42 (t42-design.md D4 as corrected by the owner, §12a): the pool of fifty is the heaviest rerank payload
 * the product sends (79 KB on a fresh class with long captions, ≈ 59–75 s cold at the reranker's measured rate) and it
 * keeps the route's ONE 60 s deadline (`RERANK_BATCH_DEFAULTS.budgetMs`, resolved as `rerankBudgetMs`) — the stage now
 * sends the pool in bounded requests and an overrun is PARTIAL (the tail unscored, disclosed) instead of total
 * (rerank_batches.js); a request may still name its own `rerankBudgetMs`.
 */
const ENUMERATE_RETRIEVAL = Object.freeze({ limit: 100, similarityThreshold: 0.15, candidatesToRerank: 50, keepTopNAfterRerank: 20 });
const ENUMERATE_CONTEXT_DEPTH = 25;

const INTENTS = Object.freeze(["lookup", "enumerate", "count"]);

/**
 * T30 (F-114; design t30-design.md §2, D3 / D4): a follow-up turn. The model
 * sees the last five turns (D6) and regains the referent of "it"; the
 * retriever did not — the retrieval query was the bare message, and "what
 * about its kitchen size?" retrieved three other designs' kitchens and no
 * Chester page (§0a B2). A turn is a follow-up when a previous user turn
 * exists AND the message opens with a continuation cue or carries an
 * anaphoric pronoun. Bare "this" / "that" are NOT pronouns here: the owner's
 * Q7 / Q8 say "this house design" with the design named in the sentence.
 * Constants, not settings (D10) — this design is their record.
 */
const FOLLOW_UP_CUES = Object.freeze(["what about", "how about", "same for", "and for", "and", "also", "but", "plus", "then", "next"]);
const FOLLOW_UP_CUE_RE = new RegExp(`^(?:${FOLLOW_UP_CUES.map((c) => c.replace(/ /g, "\\s+")).join("|")})\\b[\\s,:-]*`, "i");
const ANAPHORA_RE = /\b(it|its|itself|they|them|their|theirs|this one|that one|these ones|those ones|the same|one of them|each of them)\b/i;
/** The previous turn is truncated to this many characters in the prefix; the current message never is (D4). */
const FOLLOW_UP_PREFIX_MAX_CHARS = 600;
const MODES = Object.freeze(["chat", "doc", "code"]);

/** A leading slash command, or null. `/docs` is not `/doc` (word boundary). */
function detectSlash(message) {
  const text = String(message ?? "").trim();
  const m = SLASH_RE.exec(text);
  if (!m) return null;
  const command = `/${m[1].toLowerCase()}`;
  const cleanMessage = text.slice(m[0].length).trim();
  return { command, mode: SLASH_COMMANDS[command], cleanMessage: cleanMessage || text };
}

/** Which IDE signal the message (or the IDE state) carries, or null. */
function detectIdeSignal(message, ideState) {
  if (ideState && ideState.activeFile) return { matched: "ideState.activeFile" };
  const text = String(message ?? "");
  for (const re of IDE_SIGNALS) {
    const m = re.exec(text);
    if (m) return { matched: m[0] };
  }
  const f = FILE_REF_RE.exec(text);
  if (f) return { matched: f[1], fileRef: f[1] };
  return null;
}

/**
 * T09's aggregation-term detector, moved from the orchestrator unchanged:
 * the quoted form ("how many times does the word "bedroom" appear") then the
 * bare form. The term is normalised by the aggregation module's own rule
 * (quotes stripped; a term that normalises to nothing is not a count).
 */
function detectCountTerm(prompt) {
  const text = String(prompt ?? "");
  const quotedMatch = text.match(/(?:how\s+many\s+times|count|occurrences|instances|how\s+often|mentions)\b.*?[\"'“\`]([^\"'”\`]+)[\"'”\`]/i);
  if (quotedMatch && quotedMatch[1]) return normaliseTerm(quotedMatch[1].trim()) || null;
  const unquotedMatch = text.match(/(?:how\s+many\s+times|count\s+(?:occurrences\s+of|instances\s+of)?|find\s+all\s+mentions\s+of)\s+(?:does\s+the\s+word\s+|does\s+the\s+term\s+|the\s+word\s+|the\s+term\s+|occurrences\s+of\s+|instances\s+of\s+)?([A-Za-z0-9_-]+)/i);
  if (unquotedMatch && unquotedMatch[1]) {
    const term = unquotedMatch[1].trim();
    if (!["does", "the", "a", "an", "in", "of", "to", "word", "term"].includes(term.toLowerCase())) return normaliseTerm(term) || null;
  }
  return null;
}

/**
 * The intent of a retrieving turn (D3): `count` (T09's path) beats
 * `enumerate` (T28's whole-document path; the word list unchanged — F-111
 * accepted as coarse, the matched token reported) beats `lookup`.
 */
function detectIntent(cleanMessage) {
  const term = detectCountTerm(cleanMessage);
  if (term) return { intent: "count", rule: { matched: null, term } };
  if (detectEnumeration(cleanMessage)) {
    const m = ENUMERATION_RE.exec(String(cleanMessage ?? ""));
    return { intent: "enumerate", rule: { matched: m ? m[0] : null, term: null } };
  }
  return { intent: "lookup", rule: { matched: null, term: null } };
}

/** The text of a history entry in either shape the page or a runner sends. */
function entryText(h) {
  if (!h || typeof h !== "object") return "";
  return typeof h.text === "string" ? h.text : typeof h.content === "string" ? h.content : "";
}
function entryRole(h) {
  if (!h || typeof h !== "object") return null;
  const who = h.role || h.sender;
  return who === "user" ? "user" : who === "system" ? "system" : who ? "assistant" : null;
}

/**
 * The previous USER turn: the last user entry of the history, its own slash
 * command stripped, or null. The welcome entry and the IDE "applied"
 * confirmations are assistant entries and are skipped by construction.
 */
function previousUserTurn(history) {
  const list = Array.isArray(history) ? history : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (entryRole(list[i]) !== "user") continue;
    const raw = entryText(list[i]).trim();
    if (!raw) continue;
    const slash = detectSlash(raw);
    const text = (slash ? slash.cleanMessage : raw).trim();
    return text || null;
  }
  return null;
}

/**
 * The previous turn's resolved scope (D7): the last ASSISTANT entry's
 * `documentScope.documents[].source` — the page stores the response's
 * scope on every assistant message (T15 D13); a runner sending bare
 * history gets null, and the sticky scope is off for that turn.
 */
function previousTurnScope(history) {
  const list = Array.isArray(history) ? history : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (entryRole(list[i]) !== "assistant") continue;
    const ds = list[i].documentScope;
    if (!ds || typeof ds !== "object") return null;
    const docs = Array.isArray(ds.documents) ? ds.documents : ds.document ? [ds.document] : [];
    const sources = [...new Set(docs.map((d) => (d && typeof d.source === "string" ? d.source : "")).filter(Boolean))];
    return sources.length > 0 ? sources : null;
  }
  return null;
}

/**
 * The follow-up verdict (D3). Pure, total; never throws. `applied` is decided
 * later by scope.js's buildRetrievalQuery, which needs the store summary
 * (a name in the message is a fresh referent — D5).
 */
function detectFollowUp(cleanMessage, history) {
  const text = String(cleanMessage ?? "").trim();
  const previousTurn = previousUserTurn(history);
  const previousScope = previousTurnScope(history);
  const none = (reason) => ({ detected: false, cue: null, cueKind: null, previousTurn, previousScope, reason });
  if (!previousTurn) return none("no previous user turn in the history");
  if (!text) return none("empty message");
  const cue = FOLLOW_UP_CUE_RE.exec(text);
  if (cue) return { detected: true, cue: cue[0].trim().replace(/[\s,:-]+$/, "").toLowerCase(), cueKind: "continuation", previousTurn, previousScope, reason: `opens with "${cue[0].trim().replace(/[\s,:-]+$/, "")}"` };
  const pro = ANAPHORA_RE.exec(text);
  if (pro) return { detected: true, cue: pro[1].toLowerCase(), cueKind: "pronoun", previousTurn, previousScope, reason: `carries the pronoun "${pro[1]}"` };
  return none("no continuation cue and no anaphoric pronoun");
}

/**
 * Route a turn. `forcedCommand` is the page's parsed command (it strips the
 * prefix before sending); a command still in the message text is honoured
 * the same way, so a runner posting "/doc …" verbatim routes identically.
 * Never throws; junk in is a code turn with an empty message.
 */
function routeTurn({ message, forcedCommand = null, ideState = null, contextDefaults = {}, history = [] } = {}) {
  const text = typeof message === "string" ? message : message == null ? "" : String(message);
  const slash = detectSlash(text);
  const forced = typeof forcedCommand === "string" && SLASH_COMMANDS[forcedCommand.trim().toLowerCase()] ? forcedCommand.trim().toLowerCase() : null;
  const cleanMessage = slash ? slash.cleanMessage : text.trim();

  let mode;
  let modeSource;
  let matched = null;
  if (forced) {
    mode = SLASH_COMMANDS[forced];
    modeSource = "slash";
    matched = forced;
  } else if (slash) {
    mode = slash.mode;
    modeSource = "slash";
    matched = slash.command;
  } else {
    // D2 (owner, 2026-09-10): a coding assistant's default turn is a code
    // turn. An IDE signal is reported, not decisive.
    mode = "code";
    const ide = detectIdeSignal(cleanMessage, ideState);
    modeSource = ide ? "ide-signal" : "default";
    matched = ide ? ide.matched : null;
  }

  const { intent, rule } = mode === "chat" ? { intent: "lookup", rule: { matched: null, term: null } } : detectIntent(cleanMessage);
  const dimensional = DIMENSIONAL_RE.test(cleanMessage);
  const defaultDepth = Number.isFinite(Number(contextDefaults.maxContextChunks)) && Number(contextDefaults.maxContextChunks) >= 1 ? Number(contextDefaults.maxContextChunks) : null;

  return {
    mode,
    modeSource,
    matched,
    slash: slash ? { command: slash.command } : forced ? { command: forced } : null,
    cleanMessage,
    intent,
    intentRule: rule,
    flags: { dimensional },
    // D9: the SAME retrieval overrides for doc and code; only the intent
    // changes them. The count intent's overrides are the aggregation
    // resolver's (they need the settings blob), applied by the orchestrator.
    retrieval: intent === "enumerate" ? { ...ENUMERATE_RETRIEVAL } : {},
    contextDepth: intent === "enumerate" ? ENUMERATE_CONTEXT_DEPTH : defaultDepth,
    retrieves: mode !== "chat",
    // T30 (D3): the follow-up verdict — the history read here and nowhere
    // else on the retrieval side. A count turn is never a follow-up (T09's
    // detector runs on the bare message; the aggregation query is its own).
    followUp: intent === "count" ? { detected: false, cue: null, cueKind: null, previousTurn: previousUserTurn(history), previousScope: previousTurnScope(history), reason: "a count question is never prefixed" } : detectFollowUp(cleanMessage, history),
  };
}

/** The host of a URL, for reporting (never the path, never a credential). */
function originOf(url) {
  try {
    return new URL(String(url)).host || null;
  } catch (e) {
    return null;
  }
}

/**
 * The model / endpoint PAIR for a mode (D7): `modelProfiles.code` for code,
 * `modelProfiles.chat` for chat and doc — one object, one URL, one model,
 * one credential. When the request carries no profiles the legacy trio is
 * used as-is for EVERY mode: the mode no longer changes the model on a
 * legacy request (the 404 path of E28 is gone either way). No coder
 * heuristic, no `ollamaModelName` reach, no model literal.
 */
function selectModelProfile({ mode, adminConfig } = {}) {
  const key = mode === "code" ? "code" : "chat";
  const profiles = adminConfig && typeof adminConfig.modelProfiles === "object" && adminConfig.modelProfiles ? adminConfig.modelProfiles : null;
  const p = profiles && typeof profiles[key] === "object" && profiles[key] ? profiles[key] : null;
  if (p && typeof p.url === "string" && p.url.trim()) {
    return {
      profile: key,
      endpointType: typeof p.endpointType === "string" && p.endpointType ? p.endpointType : null,
      url: p.url.trim(),
      model: typeof p.model === "string" && p.model.trim() ? p.model.trim() : null,
      token: typeof p.token === "string" ? p.token : "",
      source: "modelProfiles",
    };
  }
  const legacyUrl = adminConfig && typeof adminConfig.nimEndpoint === "string" ? adminConfig.nimEndpoint.trim() : "";
  return {
    profile: key,
    endpointType: null,
    url: legacyUrl,
    model: adminConfig && typeof adminConfig.nimModelName === "string" && adminConfig.nimModelName.trim() ? adminConfig.nimModelName.trim() : null,
    token: adminConfig && typeof adminConfig.nimApiKey === "string" ? adminConfig.nimApiKey : "",
    source: "legacy",
  };
}

/** `[S3]`, `[S1, S3]`, `[S1,S3]` — the citation markers of an earlier turn. */
function stripMarkers(text) {
  return String(text ?? "")
    .replace(/\s?\[S\d+(?:\s*,\s*S\d+)*\]/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * The conversation the model sees before the current message (D6): the last
 * `limit` entries as the page sends them (`{sender, text}` or `{role,
 * content}`), system entries dropped, empty texts skipped, and the citation
 * markers of earlier answers stripped so a stale `[S#]` cannot be echoed as
 * a citation of the current context. The same in every mode — doc mode's
 * amnesia (E29) is gone.
 */
function replayHistory(history, { limit = 5 } = {}) {
  const list = Array.isArray(history) ? history.slice(-Math.max(0, Math.floor(limit))) : [];
  const out = [];
  for (const h of list) {
    if (!h || typeof h !== "object") continue;
    const who = h.role || h.sender;
    if (who === "system") continue;
    const raw = typeof h.text === "string" ? h.text : typeof h.content === "string" ? h.content : "";
    const content = who === "user" ? raw.trim() : stripMarkers(raw).trim();
    if (!content) continue;
    out.push({ role: who === "user" ? "user" : "assistant", content });
  }
  return out;
}

/**
 * What the span and the response say about the route (D13). `pair` is
 * reported by names only — the token never leaves this function.
 */
function describeRoute(route, pair = null) {
  const modeLabel = route.mode.toUpperCase();
  const badge = route.modeSource === "slash" ? `FORCED ${String(route.matched || "").toUpperCase()}` : route.mode === "chat" ? "CHAT" : `${modeLabel} · ${route.intent.toUpperCase()}`;
  const why =
    route.modeSource === "slash"
      ? `the ${route.matched} command`
      : route.modeSource === "ide-signal"
        ? `the default for this assistant (an IDE signal was present: "${route.matched}")`
        : "the default for this assistant (no slash command)";
  const model = pair
    ? { profile: pair.profile, endpointType: pair.endpointType, origin: originOf(pair.url), model: pair.model, source: pair.source }
    : null;
  const fu = route.followUp || null;
  // T30 (D9): the verdict by names and counts — never the previous turn's
  // text on the wire (the client sent it; it is in the history).
  // Nothing to say without a previous turn: `followUp: null` on the wire.
  const followUp = fu && fu.previousTurn
    ? {
        detected: fu.detected === true,
        cue: fu.cue ?? null,
        cueKind: fu.cueKind ?? null,
        applied: fu.applied === true,
        reason: fu.applied === true ? fu.appliedReason ?? fu.reason : fu.appliedReason ?? fu.reason ?? null,
        previousTurnChars: typeof fu.previousTurn === "string" ? fu.previousTurn.length : 0,
        previousScope: Array.isArray(fu.previousScope) ? [...fu.previousScope] : null,
      }
    : null;
  const followUpWhy = !fu || !fu.previousTurn ? "" : fu.applied === true ? ` A follow-up (${fu.reason}) — the retrieval query is the previous turn plus this one.` : fu.detected ? ` A follow-up cue (${fu.reason}) but ${fu.appliedReason || "not applied"} — retrieved on its own words.` : ` Not a follow-up (${fu.reason}) — retrieved on its own words.`;
  const intentWhy =
    route.intent === "count"
      ? `a count question (term "${route.intentRule.term}")`
      : route.intent === "enumerate"
        ? `an enumeration question (matched "${route.intentRule.matched}")`
        : "a lookup";
  return {
    title: "Mode Router",
    badge,
    badgeType: route.mode === "code" ? "purple" : route.mode === "doc" ? "blue" : "teal",
    description: `Mode ${modeLabel} by ${why}; intent ${route.intent} — ${intentWhy}.${model ? ` Model ${model.model ?? "(none)"} on the ${model.profile} profile (${model.source}${model.origin ? `, ${model.origin}` : ""}).` : ""}${followUpWhy}`,
    details: {
      mode: route.mode,
      modeSource: route.modeSource,
      matched: route.matched,
      cleanMessage: route.cleanMessage,
      intent: route.intent,
      intentRule: route.intentRule,
      flags: route.flags,
      retrievalOverrides: route.retrieval,
      contextDepth: route.contextDepth,
      model,
      followUp,
    },
    response: { mode: route.mode, modeSource: route.modeSource, intent: route.intent, model, followUp },
  };
}

module.exports = {
  SLASH_COMMANDS,
  IDE_SIGNALS,
  FILE_REF_RE,
  DIMENSIONAL_RE,
  ENUMERATE_RETRIEVAL,
  ENUMERATE_CONTEXT_DEPTH,
  INTENTS,
  MODES,
  FOLLOW_UP_CUES,
  FOLLOW_UP_CUE_RE,
  ANAPHORA_RE,
  FOLLOW_UP_PREFIX_MAX_CHARS,
  previousUserTurn,
  previousTurnScope,
  detectFollowUp,
  detectSlash,
  detectIdeSignal,
  detectCountTerm,
  detectIntent,
  routeTurn,
  selectModelProfile,
  stripMarkers,
  replayHistory,
  describeRoute,
  originOf,
};
