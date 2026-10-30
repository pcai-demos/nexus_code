/**
 * F-207's record-only disclosure check — ticket T53 (t53-design.md; the owner's D1–D8 of 2026-09-28, all as recommended).
 *
 * GENERATED — never edit this file by hand. `tests/eval/baselines/t53-artifacts/port53.js` writes it from T51's frozen v2
 * (`tests/eval/baselines/t51-artifacts/probes/disclosure_check_v2.js`, md5 861e6e896a63db869514e56c822848bc, frozen
 * 2026-09-27T20:24:45Z — `freeze51v2.txt`) and its template (`port53.template.txt`); `port53.js --check` is a unit pin
 * (U-DISCLOSE). Against v2 (D6 (a)) only this header changed, and the four lines that found v2's two requires through
 * the tree's root (`path`, `ROOT`, two `path.join(ROOT, …)`) — now `./context_notes` and `../ingestion/dimension_chain`.
 * Every rule and every literal character after them is v2's, byte for byte, down to `norm`'s digit-group class (a space,
 * a comma, U+00A0, U+202F, U+2009): a hand port is exactly where a literal no-break space turns into an escape, or the
 * reverse, unseen (t53-design.md §0d). T53's record follows v2's code — the one addition; its own require is
 * `./answer_policy` (`splitAnswer`, the one reader of where the grounded body ends).
 *
 * Pure module: no I/O, no framework, no clock (T09 D7 — memory `rag-modularity-is-the-goal`).
 *
 * Why (F-207; T50 §0, T51 §13): about half of FS-1's answers put a number on an edge the drawing does not print — a
 * side claim — or derive one and say so — a labelled derivation. v2, measured on 80 fresh answers read by hand before it
 * ran: 72 of 75 flags real, the side claim found in 37 of 38 answers, every answer with either kind flagged (43 of 43).
 * The orchestrator runs it after the citation audit on every turn whose context carried a NOT PRINTED line; the flags go
 * into `answerPolicy.disclosureCheck` and one blue trace row, and the reader sees nothing (T51 D4 (a)). The two kinds are
 * counted apart (T51 D3 (a)). Whether to show a flag is decided later, on the rate production records.
 *
 * v2's description of its rules, as frozen:
 *
 * A pure function of (the finished answer, the turn's chain facts). The facts come from the chain block the turn's
 * context holds, through the product's own code — `chainFacts(block)`:
 *   notPrinted  the edges no CHAIN line reaches (context_notes.js `chainBlockNotes` — the NOT PRINTED line: "the right
 *               edge — … the outline's overall length (x) and every point's distance from the right edge are not
 *               printed");
 *   printed     per axis, what the CHAIN does print against an edge (dimension_chain.js `parseChain`): `extents` — an
 *               edge-to-edge line ("from top edge to bottom edge: 440"); `edgeValues` — an edge-to-point line ("from
 *               left edge to A: 16"); `pointValues` — a point-to-point line ("from D to F: 228");
 *   points      the computed POINTS (context_notes.js's POINT_ROW grammar) — the extreme point toward an unprinted edge
 *               ("beyond point F"), and the coordinates a subtraction starts from ("1 820 − 1 744"); `chainValues` the
 *               CHAIN's own values per axis (a difference of two of them is the drawing's, not a claim).
 * Every pattern is built from the facts: the unprinted edge's side word, its opposite, its axis's extent words, and the
 * printed values. No drawing's numbers appear in this file (memory `no-point-fixes-foundational-only`); an empty
 * `notPrinted` flags nothing.
 *
 * It flags a UNIT of the answer (a sentence, a list item or a table row — the split keeps "p. 84", "e.g.") that
 *   ON_EDGE        places a lettered point ON an unprinted edge ("| F | 1744 | 220 | Right edge, mid-height |",
 *                  "A and F sit on the left and right edges");
 *   EDGE_DISTANCE  gives a number as a distance to or from an unprinted edge, or as the margin on its side ("76 mm from
 *                  the right edge", "228 mm in from the left and right edges", "the right-hand margin … is 76 mm",
 *                  "| D → F (right cluster to right edge) | 228 |"), a number past the extreme point toward it ("76 mm of
 *                  base overhang beyond point F" — `beyondPoint`), or a subtraction from a point's own coordinate by a number
 *                  the chain does not hold ("1 820 − 1 744" — `subtractPoint`); two sub-rules name no side and are reported
 *                  apart — `respective` (two distinct distances "from the respective edges", not both printed edge values
 *                  nor both point-to-point values) and `endOffsets` ("the 16 mm / 228 mm end offsets");
 *   OUTLINE_EXTENT gives a number as the outline's overall extent on the unprinted axis ("a 1 760 × 440 mm footprint"
 *                  — a pair with the printed extent; "the base … is roughly 1 820 mm wide × 530 mm deep"; "the base
 *                  outline … is 1 728 mm wide"; "left edge → right edge … 1 744 mm"; "16 + 1 728 + 16 = 1 760"; a table row
 *                  labelled as the outline — `rowOutline`); a span qualifier exempts it unless the subject is the outline
 *                  itself (the NOT PRINTED line's own noun: "the base-plate outline … is 1 728 mm wide (A-to-F span)");
 *   SYMMETRY       assumes the unprinted margin equals a printed one ("the 16 mm edge margin at each end", "46 mm of
 *                  margin on each side", "centred within the base", "by symmetry").
 * A unit that only NAMES the edge as unprinted ("the distance from F to the right edge is not printed") is the
 * disclosure and is never flagged for naming it. Exemptions are read in the words around the matched number (one
 * sentence can hold a claim and a qualified span): a points' span ("A-to-F span", "between the outermost points"), the
 * machine's own envelope ("the machine's footprint"), an allowance governing the number ("allow at least 1 820 × 530",
 * "footprint to clear: 1 820 × 530"). A reference's number ("Figure 15", "Page 25", "[S5]") is never a quantity. A flagged
 * unit is `labelled` when it carries a derivation or disclosure word, or the prose unit after it a derivation word
 * (derived / not printed / an inference — F-207's labelled derivation, reported apart; whether to show it is the owner's
 * D-point).
 *   chainFacts(blockText)            → { notPrinted: [edge…], printed: { x: { extents, edgeValues }, y: { … } },
 *                                         points: [{ letter, x, y }], chainValues: { x: [...], y: [...] } }
 *   disclosureCheck(answer, facts)   → { units, flags: [{ index, text, kinds, rules, labelled, edge }] }
 *
 * T53's record (t53-design.md §1; D2 (a), D3 (a), D4 (a), D5 (a)):
 *   disclosureRecord({ answer, blocks }) → null when no block names a NOT PRINTED edge (the check did not run); else
 *                                          { rules: "t51-v2", blocks: [{ marker, notPrinted }], units, flags: [{ index,
 *                                          text, kinds, rules, labelled, edge, marker, inSection }], sideClaims,
 *                                          labelledDerivations }
 *     `blocks` = [{ marker, text }]: each noted chain block's [S#] marker and its STORED chunk text — the text the notes
 *     read (§0a: its facts equal the composed block's on 14 of 14 captures). One run of v2 per block with that block's
 *     facts, each flag naming its block, never merged across blocks. The whole answer is read, exactly as v2 was
 *     measured, with either setting; `inSection` marks a unit inside "Beyond the documents".
 *   disclosureTrace(record)              → { badge, description, details } for the "Disclosure Check" trace row: the
 *                                          badge "N FLAGS · RECORD ONLY" or "NO FLAG", blue, never amber — a flag is a
 *                                          record, not a warning (about 1 flag in 20 is wrong); the details the blocks,
 *                                          the counts and each flag, its text clipped to 240 characters.
 *
 * The known limits — recorded, not patched (t53-design.md §5; the owner's T51 §14 D1 (a) and T53 D8 (a)):
 *   1. An outline named otherwise is not read as the outline ("The rectangle itself is 1820 mm long × 440 mm deep").
 *   2. A width by symmetry ("the right-edge offset would mirror the 16 mm left offset … ≈ 1760 mm") and a derivation in
 *      a table whose row carries no edge word are missed.
 *   3. With the setting on, the `labelled` attribute is wrong on 7 of 33 real flags: five side claims read as labelled
 *      (a hedge, or the next line's label taken to cover the sentence before it), two labelled derivations read as side
 *      claims (a label after a list) — so with the setting on the side-claim count is about 1 in 7 too low.
 *   4. 3 of 75 flags on the fresh answers were not claims, all with the setting on: the disclosure inside a planning
 *      allowance, an INSET form with no edge in it, a next-step offer.
 *   5. One drawing, one question: only Figure 15 carries a NOT PRINTED line on this corpus; the record's behaviour on any
 *      other drawing is unmeasured until that drawing's answers are labelled.
 *   6. A phrase list is never finished: a new decode brings a wording v2 does not know, so the recorded rate is a floor,
 *      not the true rate.
 */
const { chainBlockNotes, POINT_ROW, POINTS_HEAD } = require("./context_notes");
const { parseChain } = require("../ingestion/dimension_chain");

/** The side word, its opposite and its axis for each edge a NOT PRINTED line can name. */
const EDGE_INFO = Object.freeze({
  "the left edge": { side: "left", opp: "right", axis: "x" },
  "the right edge": { side: "right", opp: "left", axis: "x" },
  "the top edge": { side: "top", opp: "bottom", axis: "y" },
  "the bottom edge": { side: "bottom", opp: "top", axis: "y" },
});
const OTHER = Object.freeze({ x: "y", y: "x" });
const EDGE_WORDS = /^the (left|right|top|bottom) edge$/;
/** The outline's extent words per axis (the NOT PRINTED line's "length (x)" / "depth (y)" and their spellings). */
const AXIS_EXTENT = Object.freeze({ x: "length|long|width|wide", y: "depth|deep|height|high|tall" });
/** A clause about the other axis. */
const AXIS_CUE = Object.freeze({ x: /\b(?:length|long|width|wide|left|right|horizontal(?:ly)?|ends?)\b/i, y: /\b(?:depth|deep|front|rear|back|top|bottom|vertical(?:ly)?|height|tall)\b/i });
/** The drawing's outline, named as such (a bare "footprint" can be the machine's). */
const OUTLINE_STRICT = "base(?:[- ]?plate)?(?:\\s+(?:outline|footprint|frame|casting))?|outline|support[- ]base|base[- ]frame|casting";
const OUTLINE_ANY = `${OUTLINE_STRICT}|footprint`;
const NUM = "\\d+(?:\\.\\d+)?";
const UNIT = "(?:\\s*mm)?";
const HEDGE = "(?:(?:approximately|approx\\.|roughly|about|around|close to|likely close to|likely|probably|in the region of|of the order of|on the order of|just under|just over|some|~|≈|≥|≤)\\s*)*";
const HYPH = "[-‑ ]?";

/** A points' span or pattern (printed or computed — never the outline). */
const POINT_SPAN = /\b(?:point\s+)?[A-Z]\s*(?:→|->|–|-|to)\s*(?:point\s+)?[A-Z]\b|\b(?:span\s+)?to\s+(?:point\s+)?[A-Z]\b(?![a-z'’-])|\bspan(?:s)?\s+(?:between|from|of the (?:fixing|fastening|anchor|six|outer))|\b(?:points?|feet|anchors?|holes?|pattern|grid)\s+(?:\w+\s+){0,3}span(?:s|ning)?\b|\b(?:[A-Z]-to-[A-Z]|point-to-point|fixing|fastening)\s+span\b|\(\s*(?:the\s+)?(?:[A-Z]\s*(?:→|->|–|-|to)\s*[A-Z]\s+)?span\b|\bbetween (?:the )?(?:two )?(?:outermost|outer|end|extreme)\b|\b(?:left|right|top|bottom)(?:-hand)?\s+edge\s*(?:→|->|to)\s*(?:point\s+)?[A-Z]\b|\b(?:fastening|fixing|anchor(?:ing)?|bolt|foot|feet)[- ]?(?:point\s+)?(?:pattern|area|envelope|span|grid|zone|footprint|rectangle|layout|positions?|centres?)\b|\bpoint[- ]to[- ]point\b|\bcentre[- ]to[- ]centre\b|\boutermost (?:fixing |fastening |anchor )?(?:points?|feet|holes)\b|\bto (?:the )?(?:last|right-?most|outermost|final|furthest) (?:fixing |fastening )?point\b|\bspanned area\b/i;
/** The outline itself as the subject — the NOT PRINTED line's own noun ("the outline's overall length"): a span qualifier then
 *  says the outline IS the span ("the base-plate outline … is 1 728 mm wide (A-to-F span)"), which is the claim. */
const OUTLINE_SUBJECT = /\boutline\b|\boverall\s+(?:footprint\s+|base\s+)?length\b/i;
/** The machine's own envelope, named as the machine's. */
const MACHINE = /\bmachine(?:'s)?\s+(?:overall\s+|full\s+)?(?:envelope|dimensions?|footprint|width|body|size)\b|\benvelope\b|\(W\s*[×x]\s*D\b|\b(?:overall|full)\s+machine\b/i;
/** An allowance governing the number: the words right before it ("allow at least ", "to clear: ", "a minimum of "). */
const ALLOWANCE_AT = /\b(?:allow(?:ing)?|reserve|plan for|provide|leave|at least|minimum(?: of)?|min\.|to clear|clear(?: floor)? (?:space|area)(?: of)?|to reserve|to plan (?:for|around))\b[^.|;]{0,30}$|≥\s*$/i;
/** A disclosure: the unit says a value is not printed. */
const DISCLOSES = /\bnot (?:fully |explicitly |separately |directly )?(?:printed|dimensioned|given|stated|shown|specified|marked|provided|confirmed)\b|\bdoes(?: not|n't) (?:print|give|state|show|specify|dimension|carry|provide|include|tie|relate)\b|\bno (?:printed |explicit )?(?:dimension|value|figure)\b|\bunprinted\b|\bundimensioned\b|\bunknown\b|\babsent\b|\bisn't (?:printed|given|shown|dimensioned)\b|\bnot part of the (?:chain|drawing)\b/i;
/** A derivation marked as one (F-207's labelled class). */
const LABELLED = /\bderiv(?:ed|ation|e)\b|\binferred?\b|\binference\b|\bdeduc(?:ed|tion)\b|\bmy (?:own )?arithmetic\b|\byour own calculation\b|\bsubtraction\b|\bcross-referenc(?:ed|e)\b|\bif (?:the |that |this )?(?:base|outline|footprint|support[- ]base|plate|machine width|\d+\s*mm)\b[^.]{0,50}\b(?:is|matches|corresponds|applies|equals|were)\b|\bassum(?:e|ed|es|ing|ption)\b|\bestimated?\b|\bif (?:you|we) (?:take|assume|treat|use)\b|\bnot (?:a |one )?printed\b|\bnot (?:explicitly |directly )?(?:stated|given|dimensioned|printed)\b|\bcannot confirm\b|\bunconfirmed\b/i;

/** Digit groups joined ("1 820", "1,820", "1 820" → "1820"); markdown emphasis dropped; a reference's number ("Figure 15", "Page 25", "p. 84", "Section 8.2", "[S5, S6]") is not a quantity and reads "#". */
const norm = (s) => String(s).replace(/\*\*|__|\*/g, "").replace(/(\d)[ ,   ](\d{3})\b/g, "$1$2")
  .replace(/\b(Figures?|Fig\.?|Pages?|pp?\.|Sections?|Table|Chapter|Step|Art\.)\s*\d+(?:\.\d+)*/gi, "$1 #").replace(/\[S\d+(?:\s*,\s*S\d+)*\]/g, "[S#]");
/** The answer's units: lines, then sentences within a line (abbreviations kept — T50's sections50.js split). */
function unitsOf(answer) {
  const out = [];
  for (const line of String(answer || "").split("\n")) {
    const l = line.trim();
    if (!l || /^\|?\s*:?-{3,}/.test(l)) continue;
    if (l.startsWith("|")) { out.push(l); continue; }
    for (const s of l.split(/(?<!\b(?:p|pp|e\.g|i\.e|approx|fig|no|vs|cf|min|max|ca|nos|ref))(?<=[.!?])\s+(?=[A-Z(*"“])/)) if (s.trim()) out.push(s.trim());
  }
  return out;
}

/** The chain facts of one block, through the product's own readers (null when the block carries no chain grammar). */
function chainFacts(blockText) {
  const n = chainBlockNotes(blockText);
  if (!n) return null;
  const lines = String(blockText).split("\n");
  const chainAt = lines.findIndex((l) => /^CHAIN:/.test(l.trim()));
  const pointsAt = lines.findIndex((l, i) => i > chainAt && /^POINTS \(computed\b/.test(l.trim()));
  const parsed = parseChain(lines.slice(chainAt, pointsAt < 0 ? lines.length : pointsAt).join("\n"));
  const printed = { x: { extents: [], edgeValues: [], pointValues: [] }, y: { extents: [], edgeValues: [], pointValues: [] } };
  for (const l of parsed.lines) {
    const ax = l.axis === "horizontal" ? "x" : l.axis === "vertical" ? "y" : null;
    if (!ax || typeof l.value !== "number") continue;
    const fromEdge = EDGE_WORDS.test(l.from), toEdge = EDGE_WORDS.test(l.to);
    if (fromEdge && toEdge) printed[ax].extents.push(l.value);
    else if (fromEdge || toEdge) printed[ax].edgeValues.push(l.value);
    else printed[ax].pointValues.push(l.value);
  }
  // the computed points (the block's POINTS rows, POINT_ROW's grammar): the extreme point toward an unprinted edge, and
  // the coordinates a subtraction can start from
  const points = [];
  const at = lines.findIndex((l) => POINTS_HEAD.test(l.trim()));
  for (let i = at + 1; at >= 0 && i < lines.length && lines[i].trim(); i++) {
    const m = lines[i].trim().match(POINT_ROW);
    if (m) points.push({ letter: m[1], x: Number(m[2]), y: Number(m[4]) });
  }
  const chainValues = { x: parsed.lines.filter((l) => l.axis === "horizontal").map((l) => l.value), y: parsed.lines.filter((l) => l.axis === "vertical").map((l) => l.value) };
  return { notPrinted: n.notPrinted, printed, points, chainValues };
}

/** The words around [at, end) inside its clause: the clause ends at ";", a cell's "|", a dash, or a coordinated clause. */
const CLAUSE_END = /;|\||\s[—–]\s|,\s+(?:and|but|so|while|whereas|leaving)\s|\.\s/g;
const VERB = /\b(?:is|are|was|were|sits?|lies?|falls?|gives?|leaves?|leaving|means|within|beyond|over|under|across|plus|and|with)\b/gi;
function around(u, at, end, pad = 40) {
  let a = 0, b = u.length;
  for (const m of u.matchAll(CLAUSE_END)) {
    if (m.index + m[0].length <= at) a = m.index + m[0].length;
    else if (m.index >= end) { b = m.index; break; }
  }
  // the qualifier of THIS number: not across another number, nor across the verb that ends a subject
  let lo = Math.max(a, at - pad);
  const pre = u.slice(lo, at);
  const lastNum = [...pre.matchAll(/\d[\d.]*/g)].pop();
  if (lastNum) lo += lastNum.index + lastNum[0].length;
  const pre2 = u.slice(lo, at);
  const lastVerb = [...pre2.matchAll(VERB)].pop();
  if (lastVerb) lo += lastVerb.index + lastVerb[0].length;
  let hi = Math.min(b, end + pad);
  const post = u.slice(end, hi);
  const nextNum = post.search(/\d/);
  if (nextNum >= 0) hi = end + nextNum;
  const post2 = u.slice(end, hi);
  const nextVerb = post2.search(/\b(?:is|are|sits?|lies?|gives?|leaves?|leaving|means|plus|and|with|within)\b/i);
  if (nextVerb >= 0) hi = end + nextVerb;
  return { before: u.slice(lo, at), after: u.slice(end, hi), clauseBefore: u.slice(a, at), clause: u.slice(a, b) };
}
function matchesOf(re, u) {
  const out = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = g.exec(u))) { out.push({ at: m.index, end: m.index + m[0].length, text: m[0], groups: m.slice(1) }); if (!m[0].length) g.lastIndex++; }
  return out;
}

/** The patterns one unprinted edge implies. */
function edgePatterns(edge) {
  const info = EDGE_INFO[edge];
  if (!info) return null;
  const S = info.side, O = info.opp, AX = AXIS_EXTENT[info.axis], AXO = AXIS_EXTENT[OTHER[info.axis]];
  const SIDE_EDGE = `${S}(?:${HYPH}hand)?${HYPH}edge`;
  // "right edge", "right-hand edge", "left and right edges", "left / right edges", "right extreme"
  const EDGE = `(?:(?:${O}|top|bottom|left|right)(?:${HYPH}hand)?\\s*(?:and|&|\\/|or)\\s*)?${S}(?:${HYPH}hand)?${HYPH}(?:edges?|extremes?)`;
  const MARGIN = "(?:margin|clearance|offset|gap|overhang|inset)s?";
  // v2: a DISTANCE may be measured to the side's end / side / boundary / reference (a label "Right end" stays no claim —
  // ON_EDGE keeps "edge" alone)
  const EDGE_D = `(?:(?:${O}|top|bottom|left|right)(?:${HYPH}hand)?\\s*(?:and|&|\\/|or)\\s*)?${S}(?:${HYPH}hand)?${HYPH}(?:edges?|extremes?|ends?|sides?|boundary|border|reference)`;
  // the words a number may carry before its edge: "in", "inboard", "(derived)", "(1 820 − 1 744)", "of margin beyond F", "offset of points A and F"
  const FILL = "(?:\\s*(?:mm|in|inboard|inward|inset|clear|short|approximately|approx\\.|roughly|about|around|only|just|~|≈|\\*|\\((?:derived|approx\\.?|implied|est\\.?|by inference)\\)|\\([\\d\\s−–+=-]+\\)|of (?:margin|clearance|overhang|base material|base plate|plate|space|gap|material)|beyond (?:point )?[A-Z]|from (?:point )?[A-Z]\\b|(?:offset|inset|distance|clearance|margin)s? (?:of|for) (?:points? )?[A-Z](?:\\s*(?:and|&|,)\\s*[A-Z])*))*\\s*";
  const CONNECT = `(?:(?:would|will|should|could)\\s+(?:then\\s+)?be|is|are|of|=|:|≈|~|as|works out (?:to|at)|comes to|at|(?:can|could|would|may|might)\\s+be\\s+(?:inferred|derived|estimated|calculated|taken|worked out)(?:\\s+(?:as|at|to be))?|\\(\\s*(?:likely|probably|approximately|roughly|about|approx\\.)?)`;
  return {
    info,
    // ON_EDGE
    rowOnEdge: new RegExp(`^\\|\\s*([A-Z])\\s*\\|.*\\b${SIDE_EDGE}\\b`, "i"),
    proseOnEdge: new RegExp(`\\b[A-Z]\\b[^.|;]{0,80}?\\b(?:on|at|along)\\s+(?:the\\s+)?(?:extreme\\s+|outer\\s+|far\\s+|very\\s+)?${EDGE}\\b|\\b[A-Z]\\s*\\((?:[^()]*[,;]\\s*)?${SIDE_EDGE}\\b[^()]*\\)|\\b[A-Z]\\s*(?:\\([^()]*\\)\\s*)?(?:is|sits|lies)\\s+(?:on|at)\\s+(?:the\\s+)?${SIDE_EDGE}\\b`, "i"),
    // EDGE_DISTANCE
    numToEdge: new RegExp(`\\b${NUM}${UNIT}${FILL}\\b(?:from|to|of|short of|off|before)\\s+(?:the\\s+)?(?:respective\\s+)?${EDGE_D}\\b|\\b${NUM}${UNIT}\\s*(?:and|&|\\/)\\s*(?:\\((?:derived|approx\\.?|implied|by inference)\\)\\s*)?[~≈]?\\s*${NUM}${UNIT}${FILL}\\b(?:from|to|of)\\s+(?:the\\s+)?${EDGE_D}\\b|\\b${NUM}${UNIT}${FILL}\\b(?:from|to)\\s+the\\s+${S}\\b(?![-‑ ]?hand)(?!\\s+(?:edge|of|column|pair|points?|side of|hand|cluster|group))`, "i"),
    edgeThenNum: new RegExp(`\\b${EDGE}\\b\\s*(?:\\)\\s*)?(?:(?:would|will|should|could)\\s+(?:then\\s+)?(?:be|sit|fall|lie)\\s+(?:at\\s+)?|(?:is|sits|lies|falls)\\s+(?:at\\s+)?|at\\s+|=\\s*|:\\s*|→\\s*[A-Z][^|:]{0,6}:\\s*|(?:roughly|approximately|about|some)\\s+)${HEDGE}${NUM}${UNIT}`, "i"),
    rowToEdge: new RegExp(`^\\|([^|]*(?:→|->|\\bto\\b|\\bfrom\\b)\\s*(?:the\\s+)?${SIDE_EDGE}\\b[^|]*)\\|([^|]*)`, "i"),
    sideMargin: new RegExp(`\\b${S}(?:${HYPH}(?:hand|edge|side))?${HYPH}${MARGIN}\\b\\s*(?:(?:beyond|past|from|for|to|of)\\s+(?:point\\s+)?[A-Z]\\b\\s*(?:\\([^)]*\\)\\s*)?)?${CONNECT}\\s*${HEDGE}${NUM}|\\b${NUM}${UNIT}\\s+(?:of\\s+)?(?:the\\s+)?(?:[A-Z]${HYPH}to${HYPH})?${S}(?:${HYPH}(?:hand|edge|side))?${HYPH}${MARGIN}\\b|\\b${NUM}${UNIT}\\s+(?:of\\s+)?${MARGIN}\\b[^.|;,]{0,30}?\\b(?:on|at|to)\\s+the\\s+${S}\\b(?![-‑ ]?hand)`, "i"),
    // v2: the edge's position given by a point plus a number ("the right-edge position … F … plus the 228 mm", "right edge = F + 228")
    edgePlus: new RegExp(`\\b${SIDE_EDGE}\\b[^.|;]{0,60}?\\b(?:plus|adding|add)\\s+(?:the\\s+)?${NUM}|\\b${SIDE_EDGE}\\s*(?:\\([^)]*\\)\\s*)?(?:=|:)\\s*[A-Z]\\s*\\+\\s*${NUM}`, "i"),
    // v2: points on "the outer edges" / "outer ends" — side-agnostic, reported apart
    outerEdges: new RegExp(`\\b[A-Z]\\b[^.|;]{0,60}?\\b(?:on|at)\\s+(?:the\\s+)?(?:outer|outermost|two|far)\\s+(?:side\\s+)?edges\\b`, "i"),
    residual: new RegExp(`\\b(?:residual|remaining|leftover)\\s+(?:${MARGIN}|distance|space)\\b[^.|;]{0,30}?(?:is|of|=|≈|would be|:)\\s*${HEDGE}${NUM}`, "i"),
    respective: new RegExp(`\\b(${NUM})${UNIT}\\s*(?:and|&|\\/)\\s*(?:\\((?:derived|approx\\.?|est\\.?|implied)\\)\\s*)?[~≈]?\\s*(${NUM})${UNIT}[^.|;]{0,40}?\\b(?:from|of|to)\\s+(?:the\\s+|their\\s+)?(?:respective\\s+(?:side\\s+)?(?:edges?|ends?|extremes?)|(?:side\\s+)?(?:edges|ends|extremes)\\s+respectively|(?:each|either)\\s+(?:side\\s+)?(?:edge|end|extreme)\\s+respectively)\\b`, "i"),
    endOffsets: new RegExp(`\\b(${NUM})${UNIT}\\s*(?:\\/|and|&)\\s*(${NUM})${UNIT}\\s+(?:end|edge)\\s+(?:offsets?|margins?|insets?)\\b`, "i"),
    // OUTLINE_EXTENT
    spanEdges: new RegExp(`\\b${O}(?:${HYPH}hand)?${HYPH}edge\\s*(?:→|->|to|–|-)\\s*(?:the\\s+)?${SIDE_EDGE}\\b`, "i"),
    pairThenNoun: new RegExp(`\\b(${NUM})${UNIT}(?:\\s*\\([^)]*\\))?\\s*(?:(?:${AX}|${AXO})\\s*)?[×x]\\s*${HEDGE}(${NUM})${UNIT}(?:\\s*\\([^)]*\\))?\\s*(?:(?:${AX}|${AXO})\\s+)?(?:${OUTLINE_ANY})\\b`, "i"),
    nounThenPair: new RegExp(`\\b(${OUTLINE_ANY})\\b([^.|;]{0,50}?)\\b(?:is|of|measures|:|=|at|roughly|approximately)\\s*${HEDGE}(${NUM})${UNIT}(?:\\s*\\([^)]*\\))?\\s*(?:(?:${AX}|${AXO})\\s*)?[×x]\\s*${HEDGE}(${NUM})`, "i"),
    single: new RegExp(`\\b(?:${OUTLINE_STRICT})\\b[^.|;]{0,50}?\\b(?:is|of|measures|at|≈|~|:|=)\\s*${HEDGE}(${NUM})${UNIT}${HYPH}(?:${AX})\\b|\\b(?:overall|total|full)\\s+(?:${AX})\\s+of\\s+the\\s+(?:${OUTLINE_ANY})\\b\\s*(?:\\(|is\\b|:|=|of\\b|would be\\b)\\s*${HEDGE}(${NUM})|\\b(?:overall|total|full)\\s+(?:${OUTLINE_ANY})\\s+(?:${AX})\\b\\s*(?:\\([^)\\d]*\\)\\s*)?(?:is\\b|of\\b|=|:|\\||\\(|would be\\b)\\s*\\|?\\s*${HEDGE}(${NUM})|\\b(?:${OUTLINE_STRICT})\\s+(?:${AX})\\b\\s*(?:\\([^)\\d]*\\)\\s*)?(?:\\||:|=|\\(|is\\b|of\\b)\\s*${HEDGE}(${NUM})|\\b(${NUM})${UNIT}${HYPH}(?:${AX})\\s+(?:${OUTLINE_STRICT})\\b|\\b(${NUM})${UNIT}\\s+(?:${AX}\\s+)?(?:figure\\s+|value\\s+)?(?:is|would be|represents|gives)\\s+(?:the\\s+)?(?:most likely\\s+|likely\\s+|probable\\s+|best\\s+)?(?:overall\\s+|total\\s+|full\\s+)?(?:${OUTLINE_ANY})\\s*(?:${AX})?\\b`, "i"),
    sumMargin: new RegExp(`\\b${NUM}${UNIT}(?:\\s*(?:${AX}))?\\s*\\(\\s*${NUM}${UNIT}\\s*\\+\\s*${NUM}${UNIT}\\s*\\+\\s*(?:a |an |the )?(?:small |unknown |unprinted |similar |any )?(?:${S}(?:${HYPH}(?:hand|edge))?\\s+)?(?:${MARGIN}|overhang)`, "i"),
    sum3: new RegExp(`\\b${NUM}\\s*\\+\\s*${NUM}\\s*\\+\\s*${NUM}\\s*=\\s*(${NUM})`, "i"),
    // SYMMETRY
    symmetry: new RegExp(`\\b(${NUM})${UNIT}\\s+(?:edge\\s+|end\\s+)?(?:of\\s+)?${MARGIN}\\b[^.|;]{0,20}?\\b(?:at|on)\\s+(?:each|both)\\s+(?:end|side)s?\\b|\\b${MARGIN}\\s+of\\s+${HEDGE}(${NUM})${UNIT}\\s+(?:at|on)\\s+(?:each|both)\\s+(?:end|side)s?\\b|\\b(${NUM})${UNIT}\\s+(?:at|on)\\s+(?:each|both)\\s+ends?\\b|\\bcentred\\s+(?:with)?in\\s+the\\s+(?:${OUTLINE_ANY})\\b|\\bby symmetry\\b|\\bsymmetric(?:al)?\\s+${MARGIN}\\b`, "i"),
  };
}

const firstNum = (groups) => { for (const g of groups) if (g !== undefined && /^\d/.test(g)) return Number(g); return null; };

/** The point(s) at the extreme toward an unprinted edge (right → the largest x; bottom → the largest y; left / top → the smallest). */
function extremePoints(points, info) {
  if (!Array.isArray(points) || !points.length) return [];
  const key = info.axis;
  const pick = info.side === "right" || info.side === "bottom" ? Math.max : Math.min;
  const v = pick(...points.map((q) => q[key]));
  return points.filter((q) => q[key] === v).map((q) => q.letter);
}

/** One unit's claims against one edge's patterns and the block's facts: { kinds, rules } (empty when none). */
function unitClaims(u, p, printed, facts) {
  const rules = [];
  const discloses = DISCLOSES.test(u);
  const ax = p.info.axis, oax = OTHER[ax];
  const pr = printed || { x: { extents: [], edgeValues: [], pointValues: [] }, y: { extents: [], edgeValues: [], pointValues: [] } };
  const otherExtent = (n) => pr[oax].extents.includes(n);
  // v2: a value the drawing prints (either axis) — an allowance that reuses one is a planning choice, not a claim
  const printedAny = (n) => ["x", "y"].some((a) => pr[a].extents.includes(n) || pr[a].edgeValues.includes(n)); // an EDGE value (a point-to-point value read as a margin is the INSET claim)
  const ownCoordinate = (n) => Array.isArray(facts && facts.points) && facts.points.some((q) => q[ax] === n);
  const firstNumIn = (s) => { const m = String(s).match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
  // ON_EDGE — a point placed on the edge; a unit that names the edge as unprinted is the disclosure
  if ((p.rowOnEdge.test(u) || p.proseOnEdge.test(u)) && !discloses && !/\bnot\s+(?:on|at)\s+the\b|,\s*not the\b|\bnot the \w+ edge\b/i.test(u)) rules.push("onEdge");
  if (p.outerEdges.test(u) && !discloses && !rules.includes("onEdge")) rules.push("outerEdges");
  if (p.edgePlus.test(u)) rules.push("edgePlus");
  // EDGE_DISTANCE — a number tied to the edge; the words between them are FILL's whitelist, so "16 mm / (unprinted) mm from the
  // left / right edges" and "the distance from F (x = 1 744) to the right edge" (the disclosure) never match
  if (p.numToEdge.test(u)) rules.push("numToEdge");
  if (p.edgeThenNum.test(u)) rules.push("edgeThenNum");
  const row = u.match(p.rowToEdge);
  if (row && /^\s*[~≈≥]?\s*\d/.test(row[2]) && !POINT_SPAN.test(row[2]) && !DISCLOSES.test(row[2])) rules.push("rowToEdge");
  for (const m of matchesOf(p.sideMargin, u)) {
    if (new RegExp(`^\\s*(?:mm\\s*)?from\\s+the\\s+${p.info.opp}\\b`, "i").test(u.slice(m.end))) continue;
    const w = around(u, m.at, m.end);
    if (/\b(?:allow|leave|at least|minimum|reserve)\b/i.test(w.before) && printedAny(firstNumIn(m.text))) continue;
    rules.push("sideMargin");
    break;
  }
  if (p.residual.test(u)) rules.push("residual");
  const printedEdge = (n) => pr.x.edgeValues.includes(Number(n)) || pr.y.edgeValues.includes(Number(n));
  const pointPoint = (n) => (pr.x.pointValues || []).includes(Number(n)) || (pr.y.pointValues || []).includes(Number(n));
  const resp = u.match(p.respective);
  if (resp && resp[1] !== resp[2] && !(printedEdge(resp[1]) && printedEdge(resp[2])) && !(pointPoint(resp[1]) && pointPoint(resp[2]))) rules.push("respective");
  const eo = u.match(p.endOffsets);
  if (eo && eo[1] !== eo[2] && !(printedEdge(eo[1]) && printedEdge(eo[2])) && !(pointPoint(eo[1]) && pointPoint(eo[2]))) rules.push("endOffsets");
  // OUTLINE_EXTENT — the outline's extent on the unprinted axis, unless the words around it qualify it
  if (p.spanEdges.test(u) && /\d/.test(u) && !discloses) rules.push("spanEdges");
  const exempt = (m) => {
    const w = around(u, m.at, m.end);
    const toNum = w.clauseBefore + m.text.slice(0, Math.max(0, m.text.search(/\d/)));
    return (POINT_SPAN.test(w.before + m.text + w.after) && !OUTLINE_SUBJECT.test(m.text)) || MACHINE.test(w.before + m.text + w.after) || ALLOWANCE_AT.test(toNum) || /\b(?:to clear|need to clear|to reserve|to allow)\b/i.test(toNum);
  };
  for (const m of matchesOf(p.pairThenNoun, u)) {
    const [a, b] = [Number(m.groups[0]), Number(m.groups[1])];
    const strict = new RegExp(`\\b(?:${OUTLINE_STRICT})\\b`, "i").test(m.text);
    // a pair with the printed extent of the other axis is the outline's size; otherwise only a pair named as the base / outline
    if (!(otherExtent(a) || otherExtent(b) || strict)) continue;
    const w = around(u, m.at, m.end);
    if (POINT_SPAN.test(w.before + m.text + w.after) || MACHINE.test(w.before + m.text + w.after)) continue;
    const carriesExtent = otherExtent(a) || otherExtent(b);
    if (!carriesExtent && ALLOWANCE_AT.test(w.clauseBefore) && !/\bthe\s*$/i.test(w.clauseBefore)) continue;
    if (DISCLOSES.test(u.slice(m.end, m.end + 120).split(/[;|]/)[0])) continue;
    rules.push("pairThenNoun");
    break;
  }
  for (const m of matchesOf(p.nounThenPair, u)) {
    const [noun, between, a, b] = [m.groups[0], m.groups[1], Number(m.groups[2]), Number(m.groups[3])];
    const strict = new RegExp(`^(?:${OUTLINE_STRICT})$`, "i").test(noun);
    if (!(otherExtent(a) || otherExtent(b) || strict)) continue;
    const w = around(u, m.at, m.end);
    const numAt = m.at + m.text.search(/\d/);
    const carriesExtent = otherExtent(a) || otherExtent(b);
    const allowance = ALLOWANCE_AT.test(u.slice(m.at, numAt)) || ALLOWANCE_AT.test(w.clauseBefore) || /\bto clear\b/i.test(between);
    if ((POINT_SPAN.test(w.before + m.text + w.after) && !OUTLINE_SUBJECT.test(noun + between)) || MACHINE.test(w.before + m.text + w.after) || (allowance && !carriesExtent)) continue;
    if (DISCLOSES.test(u.slice(m.end, m.end + 120).split(/[;|]/)[0])) continue;
    rules.push("nounThenPair");
    break;
  }
  for (const m of matchesOf(p.single, u)) {
    const n = firstNum(m.groups);
    if (n !== null && (otherExtent(n) || pr[oax].edgeValues.includes(n))) continue;
    if (exempt(m) || AXIS_CUE[oax].test(m.text)) continue;
    rules.push("single");
    break;
  }
  const ro = u.match(new RegExp(`^\\|\\s*([^|]*\\b(?:${OUTLINE_ANY})\\b[^|]*)\\|\\s*([^|]*)`, "i"));
  if (ro) {
    const [label, value] = [ro[1], ro[2]];
    const pair = value.match(new RegExp(`^\\s*${HEDGE}(${NUM})${UNIT}(?:\\s*\\([^)]*\\))?\\s*[×x]\\s*${HEDGE}(${NUM})`, "i"));
    const one = value.match(new RegExp(`^\\s*${HEDGE}(${NUM})${UNIT}\\b`, "i"));
    const sized = pair ? otherExtent(Number(pair[1])) || otherExtent(Number(pair[2])) : one && new RegExp(`\\b(?:${AXIS_EXTENT[ax]})\\b`, "i").test(label) && !otherExtent(Number(one[1])) && !pr[oax].edgeValues.includes(Number(one[1]));
    const qualified = (POINT_SPAN.test(label) || (POINT_SPAN.test(value) && !OUTLINE_SUBJECT.test(label))) || MACHINE.test(label + " " + value) || ALLOWANCE_AT.test(label) || /\bto clear\b/i.test(label) || DISCLOSES.test(value);
    if (sized && !qualified && !rules.includes("single")) rules.push("rowOutline");
  }
  if (p.sumMargin.test(u)) rules.push("sumMargin");
  // EDGE_DISTANCE from the points: a number past the extreme point toward the edge ("76 mm of base overhang beyond point F"),
  // or a subtraction from a point's coordinate on the edge's axis by a number the drawing does not print ("1 820 − 1 744")
  const ext = extremePoints(facts && facts.points, p.info);
  if (ext.length) {
    const P = `(?:${ext.join("|")})`;
    const beyond = new RegExp(`\\b${NUM}${UNIT}\\b([^.|;,]{0,30}?)\\b(?:beyond|past|outboard of)\\s+(?:the\\s+)?(?:point\\s+)?${P}\\b|\\b(?:margin|clearance|offset|gap|overhang|material|plate|base)\\s+(?:beyond|past)\\s+(?:the\\s+)?(?:point\\s+)?${P}\\b[^.|;,]{0,25}?\\b(?:is|of|=|≈|would be|:|at)\\s*${HEDGE}${NUM}`, "i");
    for (const m of matchesOf(beyond, u)) {
      const w = around(u, m.at, m.end);
      if (ownCoordinate(firstNumIn(m.text))) continue; // "≥ 1 744 mm (… beyond F)" — the point's own coordinate, not a margin
      if ((ALLOWANCE_AT.test(w.clauseBefore + (m.groups[0] || "")) || /\ballow\b/i.test(w.clauseBefore)) && printedAny(firstNumIn(m.text))) continue;
      rules.push("beyondPoint");
      break;
    }
  }
  if (facts && Array.isArray(facts.points) && facts.points.length) {
    const own = new Set([...facts.points.map((q) => q[ax]), ...((facts.chainValues || {})[ax] || [])]);
    for (const m of u.matchAll(new RegExp(`\\b(${NUM})\\s*[−–-]\\s*(${NUM})\\b`, "g"))) {
      const [n, x] = [Number(m[1]), Number(m[2])];
      if (n > x && facts.points.some((q) => q[ax] === x) && !own.has(n)) { rules.push("subtractPoint"); break; }
    }
  }
  for (const m of matchesOf(p.sum3, u)) {
    const total = Number(m.groups[0]);
    const w = around(u, m.at, m.end, 60);
    if (otherExtent(total) || AXIS_CUE[oax].test(w.clause)) continue;
    if (!new RegExp(`\\b(?:${OUTLINE_ANY}|${AXIS_EXTENT[ax]})\\b`, "i").test(w.clause)) continue;
    rules.push("sum3");
    break;
  }
  // SYMMETRY — about the unprinted axis: not a printed value of the other axis, no other-axis cue before it, not a working allowance
  for (const m of matchesOf(p.symmetry, u)) {
    const n = firstNum(m.groups);
    // the bare forms ("centred within the base", "by symmetry", "a symmetric margin") only with a number, never in an offer
    if (n === null && (!/\d/.test(u) || /\b(?:I can|I could|if you (?:need|want|would like)|would you like|let me know|just say)\b/i.test(u))) continue;
    const w = around(u, m.at, m.end);
    if (n === null && !/^centred/i.test(m.text) && !/\b(?:margins?|edges?|ends?|offsets?|insets?|inboard|clearances?|overhangs?)\b/i.test(w.clause)) continue;
    if ([...w.clauseBefore.matchAll(/\d+(?:\.\d+)?/g)].some((d) => otherExtent(Number(d[0])))) continue;
    if (n !== null && (pr[oax].edgeValues.includes(n) || otherExtent(n))) continue;
    if (AXIS_CUE[oax].test(w.clauseBefore + m.text) || /\b(?:allow|leave|at least|minimum|working|access|clearance for)\b/i.test(w.before + m.text + w.after)) continue;
    if (/\bsides?\b/i.test(m.text) && !AXIS_CUE[ax].test(w.clause) && !(n !== null && pr[ax].edgeValues.includes(n))) continue;
    rules.push("symmetry");
    break;
  }
  const KIND = { outerEdges: "ON_EDGE", edgePlus: "EDGE_DISTANCE", rowOutline: "OUTLINE_EXTENT", beyondPoint: "EDGE_DISTANCE", subtractPoint: "EDGE_DISTANCE", onEdge: "ON_EDGE", numToEdge: "EDGE_DISTANCE", edgeThenNum: "EDGE_DISTANCE", rowToEdge: "EDGE_DISTANCE", sideMargin: "EDGE_DISTANCE", residual: "EDGE_DISTANCE", respective: "EDGE_DISTANCE", endOffsets: "EDGE_DISTANCE", spanEdges: "OUTLINE_EXTENT", pairThenNoun: "OUTLINE_EXTENT", nounThenPair: "OUTLINE_EXTENT", single: "OUTLINE_EXTENT", sumMargin: "OUTLINE_EXTENT", sum3: "OUTLINE_EXTENT", symmetry: "SYMMETRY" };
  return { kinds: [...new Set(rules.map((r) => KIND[r]))], rules };
}

/**
 * The check. `facts` = chainFacts(block) — or the NOT PRINTED edges alone (an array; then no printed values: a pair
 * counts only when named as the base / outline). An empty or unknown set flags nothing.
 */
function disclosureCheck(answer, facts) {
  const f = Array.isArray(facts) ? { notPrinted: facts, printed: null, points: [] } : facts || { notPrinted: [], printed: null, points: [] };
  const edges = (f.notPrinted || []).map(edgePatterns).filter(Boolean);
  const units = unitsOf(answer);
  const flags = [];
  if (!edges.length) return { units, flags };
  units.forEach((raw, index) => {
    const u = norm(raw);
    for (const p of edges) {
      const { kinds, rules } = unitClaims(u, p, f.printed, f);
      if (!kinds.length) continue;
      const next = index + 1 < units.length ? norm(units[index + 1]) : "";
      // v2: a list item takes the label line after its list; a footnote marker ("76 mm*") takes its footnote
      const isItem = (s) => /^\s*(?:[-•]|\d+[.)])\s/.test(s);
      let after = index + 1;
      if (isItem(raw)) while (after < units.length && isItem(units[after])) after++;
      const afterList = after < units.length ? norm(units[after]) : "";
      const footnote = /\d\s*(?:mm)?\*/.test(raw) ? units.slice(index + 1).map(norm).find((s) => /^\\?\*\s/.test(s) || /^\\\*/.test(s)) || "" : "";
      const labelled = LABELLED.test(u) || DISCLOSES.test(u) || (!u.startsWith("|") && !/^[#|]/.test(next) && LABELLED.test(next)) || (isItem(raw) && !/^[#|]/.test(afterList) && LABELLED.test(afterList)) || LABELLED.test(footnote);
      flags.push({ index, text: raw, kinds, rules, labelled, edge: `the ${p.info.side} edge` });
      break;
    }
  });
  return { units, flags };
}

// ---- T53: the record, the one addition to v2's code (t53-design.md §1; D2 (a), D3 (a), D4 (a), D5 (a)) ----

const { splitAnswer, SECTION_TITLE } = require("./answer_policy");

/** The rules the record names: T51's v2 as frozen (a later version would name itself). */
const RULES = "t51-v2";
/** A flag's text in the trace row's details is clipped to this (D3 (a)); the response's record keeps it whole. */
const TRACE_TEXT_CHARS = 240;
/** Built at run time, so T53's own code stays ASCII — every non-ASCII literal in this file's code is v2's. */
const MIDDLE_DOT = String.fromCharCode(0x00b7);
const ELLIPSIS = String.fromCharCode(0x2026);

/**
 * The record-only check over one answer. `blocks` = [{ marker, text }]: each noted chain block's [S#] marker and its
 * stored chunk text. One run of v2 per block whose facts name a NOT PRINTED edge (D5 (a)), over the whole answer
 * (D4 (a)); each flag keeps v2's fields and gains its block's marker and `inSection` — the unit sits after the grounded
 * body (the section's heading starts a line, so the body's units are the answer's first units). Null when no block
 * names such an edge: the check did not run. Total on junk.
 */
function disclosureRecord({ answer, blocks } = {}) {
  const runs = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const facts = b && typeof b.text === "string" ? chainFacts(b.text) : null;
    if (facts && facts.notPrinted.length > 0) runs.push({ marker: typeof b.marker === "string" ? b.marker : null, facts });
  }
  if (runs.length === 0) return null;
  const text = typeof answer === "string" ? answer : "";
  const split = splitAnswer(text);
  const bodyUnits = unitsOf(split.body).length;
  const flags = [];
  for (const r of runs) {
    for (const f of disclosureCheck(text, r.facts).flags) flags.push({ ...f, marker: r.marker, inSection: split.section !== null && f.index >= bodyUnits });
  }
  return {
    rules: RULES,
    blocks: runs.map((r) => ({ marker: r.marker, notPrinted: r.facts.notPrinted.slice() })),
    units: unitsOf(text).length,
    flags,
    sideClaims: flags.filter((f) => !f.labelled).length,
    labelledDerivations: flags.filter((f) => f.labelled).length,
  };
}

/**
 * The "Disclosure Check" trace row's words for a record (D3 (a)): { badge, description, details }. The badge reads
 * "N FLAGS · RECORD ONLY" or "NO FLAG", and the orchestrator colours the row blue, never amber: a flag is a record, not
 * a warning. The details hold the blocks, the counts and each flag, its text clipped to TRACE_TEXT_CHARS. Total on junk.
 */
function disclosureTrace(record) {
  const r = record && typeof record === "object" ? record : {};
  const flags = (Array.isArray(r.flags) ? r.flags : []).filter((f) => f && typeof f === "object");
  const blocks = (Array.isArray(r.blocks) ? r.blocks : []).filter((b) => b && typeof b === "object");
  const side = flags.filter((f) => !f.labelled).length;
  const labelled = flags.length - side;
  const inSection = flags.filter((f) => f.inSection === true).length;
  const units = Number.isInteger(r.units) ? r.units : 0;
  const clip = (s) => {
    const t = typeof s === "string" ? s : "";
    return t.length > TRACE_TEXT_CHARS ? t.slice(0, TRACE_TEXT_CHARS) + ELLIPSIS : t;
  };
  const edges = blocks.map((b) => "[" + (typeof b.marker === "string" ? b.marker : "?") + "] " + (Array.isArray(b.notPrinted) ? b.notPrinted.join(", ") : "")).join("; ");
  return {
    badge: flags.length > 0 ? flags.length + (flags.length === 1 ? " FLAG " : " FLAGS ") + MIDDLE_DOT + " RECORD ONLY" : "NO FLAG",
    description:
      "v2 (T51, as frozen) read " + units + " unit(s) of the answer against what the drawing does not print (" + edges + "): " +
      side + " side claim(s), " + labelled + " labelled derivation(s)" + (inSection > 0 ? ", " + inSection + ' inside "' + SECTION_TITLE + '"' : "") +
      ". Recorded only; the chat shows nothing.",
    details: {
      rules: typeof r.rules === "string" ? r.rules : null,
      blocks: blocks.map((b) => ({ marker: typeof b.marker === "string" ? b.marker : null, notPrinted: Array.isArray(b.notPrinted) ? b.notPrinted.slice() : [] })),
      units,
      sideClaims: side,
      labelledDerivations: labelled,
      inSection,
      flags: flags.map((f) => ({
        index: f.index,
        marker: typeof f.marker === "string" ? f.marker : null,
        edge: typeof f.edge === "string" ? f.edge : null,
        kinds: Array.isArray(f.kinds) ? f.kinds.slice() : [],
        rules: Array.isArray(f.rules) ? f.rules.slice() : [],
        labelled: f.labelled === true,
        inSection: f.inSection === true,
        text: clip(f.text),
      })),
    },
  };
}

module.exports = { EDGE_INFO, unitsOf, norm, chainFacts, edgePatterns, unitClaims, disclosureCheck, RULES, TRACE_TEXT_CHARS, disclosureRecord, disclosureTrace };
