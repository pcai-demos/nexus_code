/**
 * Computed context notes — ticket T48 (t48-design.md §2.1; D1 a, D2 b1, D9 b1; F-200, F-177, F-205).
 *
 * Pure module: no I/O, no framework, no clock (T09 D7 — memory `rag-modularity-is-the-goal`); its one require is
 * dimension_chain.js's own chain parser, so a chain is read by exactly one grammar. The orchestrator hands it the
 * numbered context's blocks after retrieval and assembly, before the rules; it recognises two block grammars and
 * returns what to add. A block with neither grammar is returned byte for byte, and a context without them gets
 * nothing — so a turn without them is today's prompt.
 *
 * Why (the design probe, §0e / §0f — production's own turns, sampled at the product's decoding). No rule clause moved
 * F-200's side claim (the answer asserting the drawing's unprinted right edge — 9–10 of 10 samples in either wording);
 * two lines computed from the chain block did (6 of 30 pooled, the unprinted edge named in 30 of 30, FS-1 GREEN 10 of
 * 10 with both). The model's own arithmetic on the Site Plan's millimetres summed a design 100 sq ft out; a computed
 * block made FS-3's six totals the exact millimetre sums in 36 of 36 with ≈ 40 % less generation. When the model
 * states something false about a block, fix what the block says (memory `fix-the-context-not-the-instruction`).
 *
 *   chainBlockNotes(text)  — a chain block (T46's grammar: a `CHAIN:` section, then `POINTS (computed …):`, then
 *                            `CLOSURE (checked):` — chainBlockText's shape) gains, exactly as measured (`blockfix2`):
 *                            COLUMNS after the POINTS — the points sharing an x, from the block's own POINTS
 *                            ("COLUMNS (points sharing an x — four):" / "x = 16: A · x = 334: B, C · …"), when the
 *                            block computes two points or more; and NOT PRINTED after the CLOSURE — every edge no
 *                            CHAIN line names, with what follows from it ("the right edge — no dimension in the CHAIN
 *                            reaches it: the outline's overall length (x) and every point's distance from the right
 *                            edge are not printed"), when the block computes at least one point. Under T46's D19 (b) a
 *                            block reaches a stored chunk only where it computes a point, so that condition is every
 *                            chain block a prompt can hold; the corpus's other admitted chains (no point computed)
 *                            gain nothing (U-NOTES pins all seven).
 *   dualUnitsBlock(blocks) — the room rows of a dual-unit table (`Lounge | 3620 x 3967mm | 11'8" x 13'0"` — the
 *                            grammar of T44's band probe, `t44-artifacts/probes/band_probe.js`, lifted with its row
 *                            pattern) become ONE computed block for the end of the context: each block's rooms with
 *                            their areas from the millimetre column (the finer unit), the block's total both ways,
 *                            and every printed conversion that disagrees with its millimetres beyond half-inch
 *                            rounding BESIDE its room (the design's §0f residue: listed apart, the disagreements were
 *                            passed on in 0 of 6 answers). A group is named by its block's own title (the caption's
 *                            TITLE line), never by a list of known names. T64 (F-216): one note after the groups says
 *                            what the totals are — no total floor area is printed (detected on the table's own page),
 *                            each total covers only the rooms its table lists and is not the home's floor area, what it
 *                            leaves out, and "The document itself says none of this." (`totalsNote`).
 *   contextNotes(blocks)   — both over a turn's blocks: { texts, chain, dualUnits }.
 *
 * Question time, not ingest (D2 b1): the stored chunks, their vectors and every docVersion are untouched.
 */

const { parseChain } = require("../ingestion/dimension_chain");

/** The chain block's POINTS header, as chainBlockText writes it (the datum phrase may vary; the word "computed" may not). */
const POINTS_HEAD = /^POINTS \(computed\b[^\n]*\):\s*$/;
const CHAIN_HEAD = /^CHAIN:/;
const CLOSURE_HEAD = /^CLOSURE \(checked\):\s*$/;
/** A computed point's row: `A: x = 16, y = 220` (a unit after each number when the chain printed one: `x = 16 mm`). */
const POINT_ROW = /^([A-Z]):\s*x\s*=\s*(-?\d+(?:\.\d+)?)((?:\s*[A-Za-z"'′″]+)?),\s*y\s*=\s*(-?\d+(?:\.\d+)?)/;
/** A chain line's two ends, read off a line the parser skipped (its value or an end unreadable) — only for the edges it names. */
const LINE_ENDS = /^from (.+?) to (.+?)(?: \((?:horizontal|vertical)\))?:/i;
const EDGE_NAME = /^(?:the )?(left|right|top|bottom) edge$/i;
const EDGES = Object.freeze(["the left edge", "the right edge", "the top edge", "the bottom edge"]);
const EDGE_AXIS = Object.freeze({ "the left edge": "x", "the right edge": "x", "the top edge": "y", "the bottom edge": "y" });
/** What an unreached edge leaves unprinted, per axis — the x wording is the measured line's (§0e); y is the solver's own word (`extent.depth`). */
const EXTENT_WORD = Object.freeze({ x: "length (x)", y: "depth (y)" });
const NUMBER_WORDS = Object.freeze(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]);
const countWord = (n) => NUMBER_WORDS[n] || String(n);

/** The line NOT PRINTED gives an edge no CHAIN line names (§0e's text for the right edge, word for word). */
function notPrintedLine(edge) {
  return `${edge} — no dimension in the CHAIN reaches it: the outline's overall ${EXTENT_WORD[EDGE_AXIS[edge]]} and every point's distance from ${edge} are not printed`;
}

/** The edges the CHAIN section's lines name as an end — the parsed lines, and the lines the parser skipped (a value or an end unreadable) as read. */
function edgesReached(parsed) {
  const reached = new Set();
  for (const l of parsed.lines) for (const e of [l.from, l.to]) if (EDGES.includes(e)) reached.add(e);
  for (const s of parsed.skipped) {
    const m = String(s.line || "").match(LINE_ENDS);
    if (!m) continue;
    for (const end of [m[1], m[2]]) {
      const e = String(end).trim().replace(/\s+/g, " ").match(EDGE_NAME);
      if (e) reached.add(`the ${e[1].toLowerCase()} edge`);
    }
  }
  return reached;
}

/** The section starting at `head` runs to the first blank line (chainBlockText separates its sections with one). */
function sectionEnd(lines, head) {
  let i = head + 1;
  while (i < lines.length && lines[i].trim() !== "") i++;
  return i;
}

/**
 * One block's chain notes. Null when the block does not carry the chain grammar (a CHAIN section followed by a POINTS
 * (computed …) section); else { text, columns: { count, line } | null, notPrinted: [edge…], added } — `text` is the
 * block with the lines inserted (the input byte for byte when nothing applies), `added` the characters added.
 */
function chainBlockNotes(text) {
  const src = typeof text === "string" ? text : "";
  if (!src) return null;
  const lines = src.split("\n");
  const chainAt = lines.findIndex((l) => CHAIN_HEAD.test(l.trim()));
  if (chainAt < 0) return null;
  const pointsAt = lines.findIndex((l, i) => i > chainAt && POINTS_HEAD.test(l.trim()));
  if (pointsAt < 0) return null;
  const parsed = parseChain(lines.slice(chainAt, pointsAt).join("\n"));
  const pointsEnd = sectionEnd(lines, pointsAt);
  const points = [];
  for (const l of lines.slice(pointsAt + 1, pointsEnd)) {
    const m = l.trim().match(POINT_ROW);
    if (m) points.push({ letter: m[1], x: Number(m[2]), xText: `${m[2]}${m[3] || ""}` });
  }
  // COLUMNS — the points sharing an x, lowest x first, a column's letters in order (§0e: the old layout, "three
  // columns", read RED in 11 of 60 sampled answers; with this line, in none of 10).
  let columns = null;
  if (points.length >= 2) {
    const byX = new Map();
    for (const p of points) {
      if (!byX.has(p.x)) byX.set(p.x, { xText: p.xText, letters: [] });
      byX.get(p.x).letters.push(p.letter);
    }
    const cols = [...byX.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => `x = ${c.xText}: ${c.letters.sort().join(", ")}`);
    columns = { count: cols.length, line: cols.join(" · "), header: `COLUMNS (points sharing an x — ${countWord(cols.length)}):` };
  }
  // NOT PRINTED — every edge no CHAIN line names, on a block that computes a point (§0e: the answer's side claim
  // in 10 of 10 samples without it, the edge named "not printed" in 30 of 30 with it).
  const reached = edgesReached(parsed);
  const notPrinted = points.length >= 1 ? EDGES.filter((e) => !reached.has(e)) : [];
  if (!columns && !notPrinted.length) return { text: src, columns: null, notPrinted: [], added: 0 };
  const out = lines.slice();
  if (columns) out.splice(pointsEnd, 0, "", columns.header, columns.line);
  if (notPrinted.length) {
    const closureAt = out.findIndex((l, i) => i > pointsAt && CLOSURE_HEAD.test(l.trim()));
    const at = closureAt >= 0 ? sectionEnd(out, closureAt) : sectionEnd(out, columns ? pointsEnd + 1 : pointsAt);
    out.splice(at, 0, "", "NOT PRINTED:", ...notPrinted.map(notPrintedLine));
  }
  const noted = out.join("\n");
  return { text: noted, columns: columns ? { count: columns.count, line: columns.line } : null, notPrinted, added: noted.length - src.length };
}

// ---- the dual-unit block (F-177) ----

/** One room row of a dual-unit table — T44's band probe's pattern, lifted as is (a trailing * or " tolerated — the page's footnote marks). */
const DUAL_UNIT_ROW = /^\s*([A-Za-z][A-Za-z0-9 \/\-']*?)\s*\|\s*(\d{3,4})\s*x\s*(\d{3,4})\s*mm\*?\s*\|\s*(\d+)'(\d+)"\*?"?\s*x\s*(\d+)'(\d+)"/;
const SQ_MM_PER_SQ_FT = 92903.04;
const MM_PER_INCH = 25.4;
/** A printed conversion disagrees when it is more than half an inch from its millimetres (the page rounds to the inch). */
const HALF_INCH = 0.5;
const DUAL_UNITS_HEADER = "[COMPUTED from the room tables above — each area from the millimetre column (the finer unit): width × depth in mm ÷ 92,903.04 = sq ft; the page prints feet-and-inches beside the millimetres, rounded]";

// ---- T64 (F-216): the room totals say what they are — t64-design.md §2.1, D2 (a) ----
//
// Measured before the ticket (§0e–§0f, production's own turns at the product's decoding, every answer read by hand):
// with today's block the answers gave a design's room sum as the house's area ("Total internal area (8 rooms): 718.0
// sq ft") in 39 of 40 draws; with this note the sum was named as the listed rooms' and not the floor area in 20 of 20,
// every figure kept. The note's last sentence is measured too: without it the same words were credited to the
// brochure in 5–10 of 20 draws ("the document explicitly states that no total floor area is printed"); with it, 1.

/** The spaces a room table often gives no row — named in the note as examples only where no table above lists one as a room. */
const UNLISTED_SPACES = Object.freeze([
  ["a hall", /\bhall(?:way)?s?\b/i],
  ["a landing", /\blandings?\b/i],
  ["stairs", /\bstair(?:s|case|way|well)?\b/i],
  ["a store", /\bstor(?:e|es|age)\b/i],
]);
/** A line that may print a total area — wide on purpose: a page that might print one is never told it prints none. */
const PRINTED_TOTAL = /\b(?:total|gross|net)\b.*?(?:\barea\b|sq\.?\s*f(?:ee)?t\b|square\s+f(?:ee|oo)t|ft²|m²|\bsq\.?\s*m\b|square\s+met)|\b(?:floor|internal)\s+area\b|\b(?:GIA|NIA|GEA)\b/i;
const listOf = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** The first line of a block that may print a total area; a room row never counts. Null when none. */
function printedTotalIn(text) {
  for (const line of String(text || "").split("\n")) if (!DUAL_UNIT_ROW.test(line) && PRINTED_TOTAL.test(line)) return line.trim().slice(0, 160);
  return null;
}

/**
 * The note after the designs' lines (T64). Built from the blocks the dual-unit block reads — question time, no store
 * call. A design's page is its table's own block and, where that block has a source and a page, every block of the same
 * page in the context. Says:
 *   - which designs' pages print no total floor area ("for any home above" when none does, "for the home above" for one);
 *     a page that may print one (PRINTED_TOTAL) is quoted instead, never contradicted;
 *   - that each total is computed here, covers only the rooms its table lists and is not the home's floor area;
 *   - what it leaves out: the spaces with no row — a hall, a landing, stairs, a store as examples, each only where no
 *     table above lists it as a room, hedged "where the home has them" — and the walls;
 *   - "The document itself says none of this." — always true: it speaks of the computed totals, which no page describes.
 */
function totalsNote(groups, blocks) {
  const samePage = (g, b) => b === g.block || (g.block && g.block.source != null && b && b.source === g.block.source && b.page === g.block.page);
  const printed = groups.map((g) => {
    for (const b of blocks) if (samePage(g, b)) { const t = printedTotalIn(b && b.text); if (t) return t; }
    return null;
  });
  const one = groups.length === 1;
  const unprinted = groups.filter((g, i) => !printed[i]);
  const out = [];
  if (unprinted.length) out.push(`NO TOTAL FLOOR AREA is printed for ${unprinted.length === groups.length ? (one ? "the home above" : "any home above") : unprinted.map((g) => g.title).join("; ")}: neither its room table nor any other text from its page above gives one.`);
  groups.forEach((g, i) => { if (printed[i]) out.push(`${g.title}: its page prints "${printed[i]}" — the page's own figure.`); });
  const listed = groups.flatMap((g) => g.rows.map((r) => r.room));
  const absent = UNLISTED_SPACES.filter(([, re]) => !listed.some((room) => re.test(room))).map(([name]) => name);
  const eg = absent.length ? ` (such as ${listOf(absent)}, where the home has them)` : "";
  out.push(`${one ? "The" : "Each"} total above is computed here and covers only the rooms its table lists, so it is not the home's floor area: it leaves out the spaces the table gives no row${eg} and the walls. The document itself says none of this.`);
  return out.join(" ");
}

/** Inches as the page prints them, from a whole inch count to the nearest half: 142.5 → 11'10.5". */
const feetInches = (inches) => `${Math.floor(inches / 12)}'${(inches % 12).toFixed(1).replace(/\.0$/, "")}"`;

/** A block's own name for its table: the caption's TITLE line, else its element header's name, else where it is. */
function titleOf(block) {
  const text = String((block && block.text) || "");
  const t = text.match(/^(?:HUMAN )?TITLE:[ \t]*(.+)$/m);
  if (t && t[1].trim()) return t[1].trim();
  const h = text.match(/^\[(?:HUMAN-LOGICAL VISUAL ELEMENT|VISUAL DETAIL): ([^|\]\n]+?)\s*(?:\|[^\]\n]*)?\]:?$/m);
  if (h && h[1].trim()) return h[1].trim();
  if (block && block.source) return `${block.source}${Number.isInteger(block.page) && block.page > 0 ? ` p.${block.page}` : ""}`;
  return "a room table";
}

/** The rows of one block: [{ room, mm: [w, d], ftin: ["11'8\"", "13'0\""], printedInches: [140, 156], mmSqFt, ftinSqFt }]. */
function roomRows(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.match(DUAL_UNIT_ROW);
    if (!m) continue;
    const [, room, w, d, f1, i1, f2, i2] = m;
    const mm = [Number(w), Number(d)];
    const printedInches = [Number(f1) * 12 + Number(i1), Number(f2) * 12 + Number(i2)];
    rows.push({ room: room.trim(), mm, ftin: [`${f1}'${i1}"`, `${f2}'${i2}"`], printedInches, mmSqFt: (mm[0] * mm[1]) / SQ_MM_PER_SQ_FT, ftinSqFt: (printedInches[0] / 12) * (printedInches[1] / 12) });
  }
  return rows;
}

/**
 * The ONE computed block for a turn's context, or null when no block carries a room row. `blocks` = [{ text, source?,
 * page? }] in context order. Each block with rows is one group (a block whose rows repeat an earlier block's exactly —
 * a second read of the same table — is not counted twice). After the groups' lines comes the T64 note (`totalsNote`),
 * then the printed-conversions count, which stays the block's last line. Returns { text, groups: [{ title, rooms, mmSum, ftinSum,
 * disagreements }], rooms, conversions, disagreements }.
 */
function dualUnitsBlock(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const seen = new Set();
  const groups = [];
  for (const b of list) {
    const rows = roomRows(b && b.text);
    if (!rows.length) continue;
    const signature = rows.map((r) => `${r.room}|${r.mm.join("x")}|${r.ftin.join("x")}`).join("\n");
    if (seen.has(signature)) continue;
    seen.add(signature);
    groups.push({ title: titleOf(b), rows, block: b });
  }
  if (!groups.length) return null;
  const lines = [DUAL_UNITS_HEADER];
  let conversions = 0;
  let disagreements = 0;
  const summary = [];
  for (const g of groups) {
    let groupDisagreements = 0;
    const rooms = g.rows.map((r) => {
      const off = [];
      for (let i = 0; i < 2; i++) {
        conversions++;
        const trueInches = r.mm[i] / MM_PER_INCH;
        if (Math.abs(r.printedInches[i] - trueInches) > HALF_INCH) off.push(`${r.mm[i]} mm printed ${r.ftin[i]}, is ${feetInches(Math.round(trueInches * 2) / 2)}`);
      }
      disagreements += off.length;
      groupDisagreements += off.length;
      return `${r.room} ${r.mmSqFt.toFixed(1)}${off.length ? ` (${off.join("; ")})` : ""}`;
    });
    const mmSum = g.rows.reduce((a, r) => a + r.mmSqFt, 0);
    const ftinSum = g.rows.reduce((a, r) => a + r.ftinSqFt, 0);
    lines.push(`${g.title} (${g.rows.length} rooms): ${rooms.join(" · ")} — total ${mmSum.toFixed(1)} sq ft from the millimetres (${ftinSum.toFixed(1)} from the printed feet-and-inches)`);
    summary.push({ title: g.title, rooms: g.rows.length, mmSum: Number(mmSum.toFixed(1)), ftinSum: Number(ftinSum.toFixed(1)), disagreements: groupDisagreements });
  }
  lines.push(totalsNote(groups, list));
  lines.push(`PRINTED CONVERSIONS THAT DISAGREE with their millimetres beyond half-inch rounding: ${disagreements} of ${conversions}${disagreements ? ", each named beside its room above" : ""}.`);
  const rooms = groups.reduce((a, g) => a + g.rows.length, 0);
  return { text: lines.join("\n"), groups: summary, rooms, conversions, disagreements };
}

/**
 * Both notes over a turn's blocks ([{ text, source?, page? }] in context order). Returns { texts, chain, dualUnits }:
 * `texts[i]` is block i's text with its chain notes (the input when it has none); `chain` names the blocks that gained
 * lines ({ index, columns, notPrinted, added }); `dualUnits` is dualUnitsBlock's result (null when no room row).
 * Total on junk — a missing or non-string text is an empty block.
 */
function contextNotes(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const texts = [];
  const chain = [];
  list.forEach((b, index) => {
    const text = b && typeof b.text === "string" ? b.text : "";
    const n = chainBlockNotes(text);
    if (n && n.added > 0) {
      texts.push(n.text);
      chain.push({ index, columns: n.columns ? n.columns.count : null, notPrinted: n.notPrinted, added: n.added });
    } else texts.push(text);
  });
  return { texts, chain, dualUnits: dualUnitsBlock(list.map((b) => ({ text: b && typeof b.text === "string" ? b.text : "", source: b && b.source, page: b && b.page }))) };
}

module.exports = {
  POINTS_HEAD,
  POINT_ROW,
  DUAL_UNIT_ROW,
  DUAL_UNITS_HEADER,
  UNLISTED_SPACES,
  PRINTED_TOTAL,
  printedTotalIn,
  totalsNote,
  SQ_MM_PER_SQ_FT,
  HALF_INCH,
  notPrintedLine,
  chainBlockNotes,
  roomRows,
  titleOf,
  dualUnitsBlock,
  contextNotes,
};
