/**
 * The answer policy — ticket T48 (t48-design.md §2.2–§2.5; D1 a, D3 a, D4, D5, D7; the owner's D4, lesson 7).
 *
 * Pure module: no I/O, no framework, no clock (T09 D7 — memory `rag-modularity-is-the-goal`); the texts are
 * constants and the orchestrator interpolates them. Its one require is the citation contract's own extractor, so a
 * marker inside the section is found by the same grammar the audit uses (T14: one extractor).
 *
 *   Rule 9 — METHOD & NEXT STEP (always on, D1 a): the one-sentence method when a figure was read, and the next-step
 *     offer at the end of the grounded answer, before any section (D7 — measured: with two rules saying "at the end"
 *     the offer landed inside the section). §0d: the method sentence in 8–9 of 10 samples with the rule (4 today),
 *     the offer in 7–10 of 10 (2 today).
 *   Rule 10 — BEYOND THE DOCUMENTS (only when the setting `beyondTheDocuments` is "on" — off by default, P4): the
 *     sharper wording (D3 a) — §0d: no citation marker inside the section in 8 of 8 sampled sections (the plan's
 *     wording 4 of 8), every section disclaimed and last.
 *   splitAnswer(answer) — the ONE reader of where the grounded body ends (the audit, the response, the chat panel).
 *   sectionMarkers / sectionBreach — a marker inside the section is a breach, reported as its own uncited-claims
 *     entry, never stripped (§2.4).
 *   sectionOffer(content) — T52 (t52-design.md; F-208): the section's closing next-step offer, split off for the chat
 *     only; the audit, the response and splitAnswer are untouched (the owner's D2 (a), D3 (a)).
 *
 * Not here, on purpose (§0c, §0d, §0f): an F-200 rule clause (no effect on the side claim — 9–10 of 10 samples in
 * either wording) and the finer-unit clause (a coin flip; the model's own millimetre arithmetic summed a design 100 sq
 * ft out). Both are replaced by computed context notes (context_notes.js).
 */

const { extractCitations } = require("./citations");

/** The setting's values (D4): "off" (the default — P4) or "on"; request-level, it governs rule 10 only. */
const BEYOND_THE_DOCUMENTS_MODES = Object.freeze(["off", "on"]);
const BEYOND_THE_DOCUMENTS_DEFAULT = "off";
const SECTION_TITLE = "Beyond the documents";
const SECTION_HEADING = `### ${SECTION_TITLE}`;

/** Rule 9 — always on for a grounded doc turn (the rules' 9th, after the citation contract). */
const RULE_METHOD_NEXT_STEP =
  "9. METHOD & NEXT STEP:\n" +
  "   - When a figure, map or drawing was read for this answer, say in one sentence how it was read (from its caption, from a detail read of the page, or from an adjudicated label).\n" +
  `   - When a fuller artefact is one turn away (a full schedule, a per-floor table, a coordinate list), offer it in one sentence at the end of the grounded answer, before any "${SECTION_TITLE}" section.\n`;

/** Rule 10 — the labelled section, only when the setting is on (the sharper wording, §0d `alln2` — D3 a). */
const RULE_BEYOND_THE_DOCUMENTS =
  "10. BEYOND THE DOCUMENTS:\n" +
  `   - After the grounded answer you MAY add ONE final section headed exactly "${SECTION_HEADING}", holding only your own professional judgement or general knowledge that the documents do not state; its first sentence says it is not from the documents.\n` +
  "   - Every fact taken from the context — including facts from OTHER documents in the context, which come before your own knowledge — belongs above that heading with its marker. The section repeats none of them, carries no [S#] marker, and never contradicts the grounded answer.\n";

/** The setting's value as the rules read it: "on" only when it says so; anything else is the default. */
function normaliseBeyondTheDocuments(value) {
  return value === "on" ? "on" : BEYOND_THE_DOCUMENTS_DEFAULT;
}

/** The policy's rules for a grounded doc turn — rule 9 always, rule 10 when the setting is on. */
function policyRules({ beyondTheDocuments } = {}) {
  return RULE_METHOD_NEXT_STEP + (normaliseBeyondTheDocuments(beyondTheDocuments) === "on" ? RULE_BEYOND_THE_DOCUMENTS : "");
}

/**
 * The section's heading: a line holding only "Beyond the documents" — a markdown heading of any level and / or bold,
 * a trailing colon tolerated, any case (rule 10 asks for "### Beyond the documents" exactly; every probe section used
 * it). A sentence that merely starts with the words ("Beyond the documents, I would …") is body, never a heading.
 */
const SECTION_HEADING_LINE = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*beyond the documents[ \t]*:?[ \t]*(?:\*\*|__)?[ \t]*:?[ \t]*$/im;

/**
 * Where the grounded body ends. Returns { body, section, heading, content }: `body` the answer before the FIRST
 * heading line (byte for byte), `section` from the heading line to the end, `heading` that line as written,
 * `content` the section after its heading line; with no heading, the whole answer is `body` and the rest null.
 * Total on junk — a non-string answer is an empty body.
 */
function splitAnswer(answer) {
  const text = typeof answer === "string" ? answer : "";
  const m = SECTION_HEADING_LINE.exec(text);
  if (!m) return { body: text, section: null, heading: null, content: null };
  const section = text.slice(m.index);
  return { body: text.slice(0, m.index), section, heading: m[0].trim(), content: section.slice(m[0].length).replace(/^[ \t]*\r?\n/, "") };
}

/**
 * T52 (t52-design.md §0–§3; the owner's D2 (a), D4 (a), D5 (a) — F-208). With the setting on, the model's next-step offer
 * lands inside the section in 28 of 86 sections on today's rule 10 (T50 §0c); when it does it is always the section's
 * single closing sentence, in one grammar (39 of 39 recorded), and the closing sentence of each of the other 274 recorded
 * sections is judgement, advice or a referral (read by hand — 0 missed offers). The chat shows the offer below the box
 * as the answer's closing line; what the audit and the response read does not move (D3 (a)).
 *
 * The section's sentences exactly as T50 measured them (`sections50.js` `sents`): emphasis dropped, a break after . ! ?
 * before a capital, a bracket, an asterisk or an opening quote — so "p. 84" stays inside its sentence (a naive split at
 * every full stop cut 8 of the 39 offers) — and at every line break.
 */
const SECTION_SENTENCE_BREAK = new RegExp(`(?<!\\b(?:p|pp|e\\.g|i\\.e|approx|fig|no|vs|cf|min|max|ca))(?<=[.!?])\\s+(?=[A-Z(*"${String.fromCharCode(0x201c)}])|\\n+`);
/** The measured offer grammar (D5 (a)): every one of the 39 opens with it; any other form stays inside the box, as before. */
const SECTION_OFFER_OPENING = /^(?:If you would like|If you'd like|If it would help),? I can\b/;

/** The section's sentences, T50's split (emphasis dropped, each trimmed, empties gone). */
function sectionSentences(text) {
  return String(text).replace(/\*\*/g, "").split(SECTION_SENTENCE_BREAK).map((s) => s.trim()).filter(Boolean);
}

/**
 * The section's closing next-step offer, split off for the chat: { judgement, offer }. `offer` is the closing sentence
 * as written (its emphasis kept) when it opens with the measured grammar and judgement remains before it; `judgement` is
 * the content before it, trailing whitespace dropped. Otherwise { judgement: the content byte for byte, offer: null } —
 * the rule never empties a section. Total on junk — a non-string content is an empty section.
 */
function sectionOffer(content) {
  const text = typeof content === "string" ? content : "";
  const kept = { judgement: text, offer: null };
  const sentences = sectionSentences(text);
  const closing = sentences[sentences.length - 1];
  if (sentences.length < 2 || !SECTION_OFFER_OPENING.test(closing)) return kept;
  // Where the closing sentence starts as written: the earliest non-space character after whitespace whose tail reads as
  // the closing sentence once its emphasis is dropped (a "**" opening the sentence goes with it).
  let start = -1;
  for (let i = text.length - 1; i > 0; i--) {
    if (!/\s/.test(text[i - 1]) || /\s/.test(text[i])) continue;
    const tail = text.slice(i).replace(/\*\*/g, "").trim();
    if (tail === closing) start = i;
    else if (tail.length > closing.length) break;
  }
  const judgement = start > 0 ? text.slice(0, start).replace(/\s+$/, "") : "";
  if (!judgement) return kept;
  return { judgement, offer: text.slice(start).replace(/\s+$/, "") };
}

/** The distinct [S#] markers inside a section, in the audit's own grammar (valid and invalid alike): ["S3", "S7"]. */
function sectionMarkers(section, contextMap) {
  if (typeof section !== "string" || !section) return [];
  const { citations, invalidMarkers } = extractCitations(section, Array.isArray(contextMap) ? contextMap : []);
  return citations.map((c) => c.marker).concat(invalidMarkers.map((n) => `S${n}`));
}

/** The uncited-claims entry for markers inside the section (§2.4 — reported, never stripped); null when there are none. */
function sectionBreach(markers) {
  if (!Array.isArray(markers) || markers.length === 0) return null;
  return `a citation marker inside "${SECTION_TITLE}" (${markers.map((m) => `[${m}]`).join(", ")}) — the section holds the model's own knowledge and carries no marker`;
}

/**
 * What the citation audit reads (§2.4): with the setting on, the grounded body — the section is the invited exception
 * (the owner's D4: "ignored by the citation audit"), its markers reported by sectionBreach; with it off, the whole
 * answer, exactly as before T48 (no section was invited, so nothing is exempt).
 */
function auditedText(answer, beyondTheDocuments) {
  const split = splitAnswer(answer);
  return { text: normaliseBeyondTheDocuments(beyondTheDocuments) === "on" ? split.body : typeof answer === "string" ? answer : "", split };
}

/**
 * The response's `answerPolicy` (§2.4): the setting, the section as written ({ present, chars, markers, heading };
 * null when the setting is off and no section was written), and the notes the context carried.
 */
function answerPolicyReport({ beyondTheDocuments, split, markers, notes } = {}) {
  const mode = normaliseBeyondTheDocuments(beyondTheDocuments);
  const s = split && typeof split === "object" ? split : { section: null, heading: null };
  const section =
    s.section === null && mode === "off"
      ? null
      : { present: s.section !== null, chars: s.section === null ? 0 : s.section.length, markers: Array.isArray(markers) ? markers.length : 0, heading: s.heading ?? null };
  return { beyondTheDocuments: mode, section, notes: notes ?? null };
}

module.exports = {
  BEYOND_THE_DOCUMENTS_MODES,
  BEYOND_THE_DOCUMENTS_DEFAULT,
  SECTION_TITLE,
  SECTION_HEADING,
  RULE_METHOD_NEXT_STEP,
  RULE_BEYOND_THE_DOCUMENTS,
  SECTION_HEADING_LINE,
  SECTION_SENTENCE_BREAK,
  SECTION_OFFER_OPENING,
  normaliseBeyondTheDocuments,
  policyRules,
  splitAnswer,
  sectionOffer,
  sectionMarkers,
  sectionBreach,
  auditedText,
  answerPolicyReport,
};
