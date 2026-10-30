/**
 * The dimensioned drawing's CHAIN — ticket T46 (F-174; design `inputs/rag-audit/t46-design.md`, D1 a, D2 a, D4 a,
 * D5, D6 a, D7, D14 a and D15–D18).
 *
 * Pure module: no I/O, no framework, no require (owner direction, T09 D7). The captioner (`vlm_captioner.js`) asks
 * the chain pass; the bridge (`docling_bridge.py --geometry`, `dimension_geometry.py`) reads the drawing's pixels;
 * the parser (`parser.js`) does the I/O and writes the block into the caption chunk. Everything here is pinned by
 * U-CHAIN against the design probe's records (`tests/eval/baselines/t46-artifacts/probes/records/`).
 *
 * What the probe established (§0g): the captioner READS a dimensioned drawing's chain right — every printed value
 * once, the axis of every line, which marked points align, the lettering, the closure — deterministically (29 / 29
 * cold = warm), and COMPUTES coordinates wrong (its own sums: B at 354 for 334). So the model is asked only what it
 * reads (the chain pass, V4's grammar) and every derived number is computed here, "not derivable" a first-class
 * answer. The one thing it misreads at every variant — the endpoints of Figure 15's long overall dimension, 1728
 * "edge to edge" where the drawing dimensions A to F — the drawing's own pixels settle (§0i): `settleChain` applies a
 * geometry claim only when the two ink thresholds agree on it, both its ends are named by the reply's own lettered
 * points (or the edge beyond every point), and it is the one free claim for its value and axis (D14 a); on the corpus
 * that is one line. The block (`chainBlockText`) REPLACES the caption's free DESCRIPTION (D6 a: beside it, the
 * generator echoed the old layout sentence).
 *
 * The grammar (V4 — the chain prompt in `vlm_captioner.js`), one line per printed dimension:
 *   from <endpoint> to <endpoint> (horizontal|vertical): <value>[ <unit>]
 * An endpoint is a lettered point (A, B, … lettered left → right, then top → bottom) or an edge (the left / right /
 * top / bottom edge); ALIGNED lines — `A F (horizontal)`, `B C (vertical)` — name the points that share a line (a
 * horizontal line shares y, a vertical one x). The solver's datum: x from the left edge, y from the top edge.
 *
 * Where the prototype (`probes/points_from_chain.js`) guessed, this module declines (the design's promise is "every
 * coordinate stated is right; the rest named not derivable"):
 *   - two different edge-to-edge totals on one axis (Miele's 172 / 181 cm) leave that extent AMBIGUOUS — no pick;
 *   - a line with a named-part endpoint is kept as read, never solved through (its place along the axis is unknown);
 *   - a vertical line between two points is used only when the reply puts them in one column (ALIGNED vertical): the
 *     lettering orders a column top → bottom, but says nothing of two columns' vertical order;
 *   - an axis whose lines disagree with the solved coordinates (a misread value) is WITHHELD — not derivable, named;
 *   - a chain that mixes units computes no point at all;
 *   - the settlement names nothing on a page whose geometry found no crosshair (the prototype would have named every
 *     span end "the left edge").
 */

/** D14 (a) i–ii and D15: the geometry's pinned setting — the render scale, the ink threshold, the cross-check's. */
const CHAIN_GEOMETRY = Object.freeze({ scale: 4.0, ink: 200, checkInk: 128, nameTolPt: 2.0 });

/** The chain prompt's answer for a page with no dimensioned drawing (the control, Fervi p53 — §0c). */
const NO_DIMENSIONS = "NO_DIMENSIONS";

/**
 * D5: the generator's clause — insurance (§0f: with the computed table present the generator complied without it);
 * the mechanism is the block replacing the DESCRIPTION (D6 a). One constant, inserted by the orchestrator under rule 5.
 */
const CHAIN_BLOCK_RULE = "   - When a figure's context carries a CHAIN block, tabulate the POINTS (computed) as given, name the ones marked not derivable as such, and never describe a layout the block does not state.";

const EDGE_NAMES = Object.freeze({ left: "the left edge", right: "the right edge", top: "the top edge", bottom: "the bottom edge" });
/** An edge's axis and side: -1 the near side (x = 0 or y = 0), +1 the far side. */
const EDGE_AXIS = Object.freeze({ "the left edge": ["x", -1], "the right edge": ["x", 1], "the top edge": ["y", -1], "the bottom edge": ["y", 1] });
const FAR_EDGE = Object.freeze({ x: "the right edge", y: "the bottom edge" });
const NEAR_EDGE = Object.freeze({ x: "the left edge", y: "the top edge" });

const LINE_RE = /^from (.+?) to (.+?)(?: \((horizontal|vertical)\))?:\s*([0-9]+(?:[.,][0-9]+)?)(?:\s*([a-zA-Z"'′″]+))?\s*$/i;
const LINE_SHAPE = /^from .+ to .+:/i;
const ALIGNED_RE = /^([A-Z](?:[ ,]+[A-Z])+)\s*\((horizontal|vertical)\)\s*$/;
const SECTION_RE = /^(POINTS MARKED|ALIGNED|CHAIN|CLOSURE):\s*(.*)$/i;
const MARKED_RE = /^([A-Z])\s*[:.)]\s*\S/;

const isLetter = (e) => /^[A-Z]$/.test(String(e));
const eq = (a, b) => Math.abs(a - b) < 1e-6;
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

/** Is the reply the chain prompt's "nothing dimensioned here" verdict? The FIRST non-blank line decides (T32's rule). */
function isNoDimensions(reply) {
  const first = String(reply || "").split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!first) return false;
  return first.replace(/^[\s*_`]+|[\s*_`.]+$/g, "") === NO_DIMENSIONS;
}

/** A caption's section body (`TITLE`, `TYPE`, `SUBJECTS`, `TRANSCRIPTION`, `DESCRIPTION`), "" when absent. */
function captionSection(caption, name) {
  const heads = "(?:HUMAN )?TITLE|(?:DIAGRAM )?TYPE|SUBJECTS|TRANSCRIPTION|DESCRIPTION";
  const prefix = name === "TITLE" ? "(?:HUMAN )?" : name === "TYPE" ? "(?:DIAGRAM )?" : "";
  const m = String(caption || "").match(new RegExp(`^${prefix}${name}:[ \\t]*([\\s\\S]*?)(?=^(?:${heads}):|(?![\\s\\S]))`, "m"));
  return m ? m[1] : "";
}

const ADMIT_PHRASE = /\b(dimension lines?|dimensioned drawings?)\b/gi;
const NEGATION = /\b(?:no|not|without|none|never|nor|neither)\b/i;

/**
 * D4 (a) — the admission: the caption's TYPE line reads `dimensioned drawing`, or its TITLE / DESCRIPTION names a
 * `dimension line` or a `dimensioned drawing` that no negation in the same sentence's preceding four words refuses
 * ("No dimension lines are shown"). On production (228 captions) that admits exactly the design's seven pages —
 * Fervi p25 / p39 / p43, Miele p95, Ikea p6 (TYPE) and SSX125 p16 / p19 (the phrase). A bare `dimensioned` does NOT
 * admit (§11a: it would add Fervi p40 / p44, TYPE `mixed` pages whose DESCRIPTION carries a procedure the block would
 * replace — unprobed); `dimensions` never does (the captioner's own "No dimensions are shown" convention, ~79 pages).
 * Returns { admitted, reason }.
 */
function chainAdmits(caption) {
  const text = String(caption || "");
  const typeLine = (text.match(/^(?:DIAGRAM )?TYPE:[ \t]*(.*)$/im) || [])[1] || "";
  if (/\bdimensioned drawing\b/i.test(typeLine)) return { admitted: true, reason: "TYPE dimensioned drawing" };
  for (const name of ["TITLE", "DESCRIPTION"]) {
    const body = captionSection(text, name);
    for (const m of body.matchAll(ADMIT_PHRASE)) {
      const sentence = body.slice(0, m.index).split(/[.!?;:\n]/).pop();
      const lead = sentence.trim().split(/\s+/).filter(Boolean).slice(-4).join(" ");
      if (!NEGATION.test(lead)) return { admitted: true, reason: `${name} "${m[1].toLowerCase()}"` };
    }
  }
  return { admitted: false, reason: null };
}

function endpointOf(raw) {
  const t = String(raw).trim().replace(/\s+/g, " ");
  if (/\[?unclear\]?/i.test(t)) return { kind: "unclear", name: "[unclear]" };
  if (isLetter(t)) return { kind: "point", name: t };
  const m = t.toLowerCase().match(/^(?:the )?(left|right|top|bottom) edge$/);
  if (m) return { kind: "edge", name: EDGE_NAMES[m[1]] };
  return { kind: "part", name: t };
}

/**
 * The reply's structure: `lines` (the chain lines the solver can use — { index, line, from, to, axis, value,
 * valueText, unit }), `skipped` ({ index, line, why } — every other `from … to …` line, as read), `aligned`
 * ({ points, axis, line }), `marked` (the POINTS MARKED letters), `chainLines` / `unclear` (the reply's own count of
 * chain lines and `[unclear]` marks), `noDimensions`. `index` is the line's place in `reply.split("\n")`.
 */
function parseChain(reply) {
  const text = String(reply || "");
  const rows = text.split("\n");
  const out = { lines: [], skipped: [], aligned: [], marked: [], chainLines: 0, unclear: 0, noDimensions: isNoDimensions(text) };
  let section = null;
  rows.forEach((raw, index) => {
    let t = raw.trim();
    const head = t.match(SECTION_RE);
    if (head) {
      section = head[1].toUpperCase();
      t = head[2].trim();
      if (!t) return;
    }
    if (section === "POINTS MARKED") {
      const mk = t.match(MARKED_RE);
      if (mk) { if (!out.marked.includes(mk[1])) out.marked.push(mk[1]); return; }
    }
    const al = t.match(ALIGNED_RE);
    if (al) { out.aligned.push({ points: al[1].split(/[ ,]+/).filter(Boolean), axis: al[2], line: t }); return; }
    if (!LINE_SHAPE.test(t)) return;
    out.chainLines++;
    out.unclear += (t.match(/\[unclear\]/gi) || []).length;
    const m = t.match(LINE_RE);
    if (!m) { out.skipped.push({ index, line: t, why: "unparsed (no value where the grammar puts one)" }); return; }
    const a = endpointOf(m[1]);
    const b = endpointOf(m[2]);
    if (a.kind === "unclear" || b.kind === "unclear") { out.skipped.push({ index, line: t, why: "an [unclear] endpoint" }); return; }
    if (a.name === b.name) { out.skipped.push({ index, line: t, why: "both ends name the same feature" }); return; }
    if (a.kind === "part" || b.kind === "part") { out.skipped.push({ index, line: t, why: "a named part — its place along the axis is not given by the lettering" }); return; }
    let axis = m[3] ? m[3].toLowerCase() : null;
    const edgeAxes = [a, b].filter((e) => e.kind === "edge").map((e) => (EDGE_AXIS[e.name][0] === "x" ? "horizontal" : "vertical"));
    if (!axis) axis = edgeAxes[0] || null;
    if (!axis) { out.skipped.push({ index, line: t, why: "no axis and no edge endpoint — ambiguous" }); return; }
    if (edgeAxes.some((x) => x !== axis)) { out.skipped.push({ index, line: t, why: "an edge of the other axis" }); return; }
    out.lines.push({ index, line: t, from: a.name, to: b.name, axis, value: Number(m[4].replace(",", ".")), valueText: m[4], unit: m[5] || null });
  });
  return out;
}

/**
 * D2 (a) — the POINTS computed from CHAIN + ALIGNED, never asked of the model. Accepts a reply or `parseChain`'s
 * result. Returns { points: { A: { x, y } … }, derived, notDerivable: [{ point, missing, why? }], extent: { width,
 * depth }, closure: [{ axis, printedTotal, sum, ok, note? }], aligned, lines, skipped, unit, mixedUnits, conflicts }.
 */
function pointsFromChain(input) {
  const parsed = input && typeof input === "object" && Array.isArray(input.lines) ? input : parseChain(input);
  const { lines, aligned, marked } = parsed;
  const letters = new Set(marked);
  for (const l of lines) for (const e of [l.from, l.to]) if (isLetter(e)) letters.add(e);
  for (const a of aligned) for (const P of a.points) letters.add(P);
  const units = [...new Set(lines.map((l) => l.unit).filter(Boolean).map((u) => u.toLowerCase()))];
  const mixedUnits = units.length > 1;
  const sameColumn = (p, q) => aligned.some((a) => a.axis === "vertical" && a.points.includes(p) && a.points.includes(q));
  const totals = { x: [], y: [] };
  const usable = [];
  const unusable = [];
  for (const l of lines) {
    const k = l.axis === "horizontal" ? "x" : "y";
    const ea = EDGE_AXIS[l.from];
    const eb = EDGE_AXIS[l.to];
    if (ea && eb) {
      if (ea[1] === eb[1]) unusable.push({ index: l.index, line: l.line, why: "both ends on one side" });
      else totals[k].push(l);
      continue;
    }
    let p;
    let q;
    if (ea || eb) {
      const edge = ea ? l.from : l.to;
      const pt = ea ? l.to : l.from;
      [p, q] = EDGE_AXIS[edge][1] < 0 ? [edge, pt] : [pt, edge];
    } else if (k === "x") {
      if (sameColumn(l.from, l.to)) { unusable.push({ index: l.index, line: l.line, why: "a horizontal dimension between two points of one column" }); continue; }
      [p, q] = l.from < l.to ? [l.from, l.to] : [l.to, l.from];
    } else {
      if (!sameColumn(l.from, l.to)) { unusable.push({ index: l.index, line: l.line, why: "the vertical order of two points in different columns is not given by the lettering" }); continue; }
      [p, q] = l.from < l.to ? [l.from, l.to] : [l.to, l.from];
    }
    usable.push({ ...l, k, p, q });
  }
  const coord = { x: new Map([[NEAR_EDGE.x, 0]]), y: new Map([[NEAR_EDGE.y, 0]]) };
  const extent = { x: null, y: null };
  const extentNote = { x: null, y: null };
  for (const k of ["x", "y"]) {
    const vals = [...new Set(totals[k].map((l) => l.value))];
    if (vals.length === 1) { extent[k] = vals[0]; coord[k].set(FAR_EDGE[k], vals[0]); }
    else if (vals.length > 1) extentNote[k] = `two printed totals (${vals.map(fmt).join(", ")}) — the overall extent is ambiguous`;
  }
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 200) {
    moved = false;
    for (const l of usable) {
      const m = coord[l.k];
      if (m.has(l.p) && !m.has(l.q)) { m.set(l.q, m.get(l.p) + l.value); moved = true; }
      else if (!m.has(l.p) && m.has(l.q)) { m.set(l.p, m.get(l.q) - l.value); moved = true; }
    }
    for (const a of aligned) {
      const m = coord[a.axis === "horizontal" ? "y" : "x"];
      const known = a.points.find((P) => m.has(P));
      if (known === undefined) continue;
      for (const P of a.points) if (!m.has(P)) { m.set(P, m.get(known)); moved = true; }
    }
  }
  // Consistency: every usable line and every aligned set must agree with the solved coordinates, and nothing may
  // sit outside the printed extent; an axis that disagrees with itself is withheld (a misread value, never a guess).
  const conflicts = { x: [], y: [] };
  for (const l of usable) {
    const m = coord[l.k];
    if (m.has(l.p) && m.has(l.q) && !eq(m.get(l.q) - m.get(l.p), l.value)) conflicts[l.k].push(l.line);
  }
  for (const a of aligned) {
    const k = a.axis === "horizontal" ? "y" : "x";
    const vs = a.points.filter((P) => coord[k].has(P)).map((P) => coord[k].get(P));
    if (vs.some((v) => !eq(v, vs[0]))) conflicts[k].push(`${a.points.join(" ")} (${a.axis})`);
  }
  for (const k of ["x", "y"]) {
    for (const L of letters) {
      const v = coord[k].get(L);
      if (v === undefined) continue;
      if (v < -1e-6 || (extent[k] !== null && v > extent[k] + 1e-6)) conflicts[k].push(`${L} outside the printed extent`);
    }
  }
  const points = {};
  const notDerivable = [];
  for (const L of [...letters].sort()) {
    if (mixedUnits) { notDerivable.push({ point: L, missing: ["x", "y"], why: "the chain mixes units" }); continue; }
    const got = {};
    const missing = [];
    const why = [];
    for (const k of ["x", "y"]) {
      if (conflicts[k].length) { missing.push(k); why.push(`the chain disagrees with itself on ${k}`); continue; }
      const v = coord[k].get(L);
      if (v === undefined) missing.push(k); else got[k] = v;
    }
    if (missing.length === 0) points[L] = { x: got.x, y: got.y };
    else notDerivable.push(why.length ? { point: L, missing, why: why.join("; ") } : { point: L, missing });
  }
  const closure = [];
  for (const k of ["x", "y"]) {
    if (extentNote[k]) { closure.push({ axis: k, printedTotal: null, totals: [...new Set(totals[k].map((l) => l.value))], sum: null, ok: null, note: extentNote[k] }); continue; }
    if (extent[k] === null) continue;
    const path = chainPath(usable.filter((l) => l.k === k), NEAR_EDGE[k], FAR_EDGE[k]);
    if (path) {
      const sum = path.reduce((n, l) => n + l.value, 0);
      closure.push({ axis: k, printedTotal: extent[k], sum: `${path.map((l) => fmt(l.value)).join(" + ")} = ${fmt(sum)}`, ok: eq(sum, extent[k]) });
    } else closure.push({ axis: k, printedTotal: extent[k], sum: null, ok: null, note: "no printed chain reaches the far edge from the near edge" });
  }
  return {
    points,
    derived: Object.keys(points).length,
    notDerivable,
    aligned: aligned.length,
    extent: { width: extent.x, depth: extent.y },
    closure,
    lines: lines.length,
    skipped: parsed.skipped.concat(unusable).sort((a, b) => a.index - b.index),
    unit: units.length === 1 ? units[0] : null,
    mixedUnits,
    conflicts,
  };
}

/** A path near → far along oriented lines (p before q), the first found in reply order; null when none reaches. */
function chainPath(lines, from, to) {
  const seen = new Set([from]);
  const walk = (at, acc) => {
    if (at === to) return acc;
    for (const l of lines) {
      if (l.p !== at || seen.has(l.q)) continue;
      seen.add(l.q);
      const r = walk(l.q, acc.concat([l]));
      if (r) return r;
      seen.delete(l.q);
    }
    return null;
  };
  const r = walk(from, []);
  return r && r.length ? r : null;
}

/**
 * One ink's geometry reduced to what the settlement reads (D15): the drawing region that holds the lettered
 * crosshairs — exactly one, or the lettering is ambiguous — and that region's claims. `reading` is the bridge's
 * per-ink output `{ regions: [{ points: [{ letter, x, y }], claims: [{ value, axis, span, … }] }] }`; null when absent.
 */
function chainGeometryOf(reading) {
  if (!reading || !Array.isArray(reading.regions)) return null;
  const withPoints = reading.regions.filter((r) => Array.isArray(r.points) && r.points.length > 0);
  const one = withPoints.length === 1 ? withPoints[0] : null;
  return {
    regions: reading.regions.length,
    regionsWithPoints: withPoints.length,
    points: one ? one.points.map((p) => ({ letter: p.letter, x: p.x, y: p.y })) : [],
    claims: one && Array.isArray(one.claims) ? one.claims.filter((c) => c && Array.isArray(c.span) && c.span.length === 2) : [],
  };
}

/** One ink's settlement of the parsed chain — the per-line outcome and, for a SETTLED line, the drawing's line. */
function settleOnce(parsed, g, tol) {
  const base = parsed.lines.map((l) => ({ index: l.index, line: l.line }));
  const refuse = (why, lettersOk = false) => ({ lettersOk, lines: base.map((o) => ({ ...o, outcome: "UNSETTLED", reason: why })) });
  if (!g) return refuse("no geometry for the page");
  if (g.regionsWithPoints === 0) return refuse("the geometry found no marked point (a crosshair) to name the ends by");
  if (g.regionsWithPoints > 1) return refuse("the geometry found marked points in more than one drawing on the page");
  const P = new Map(g.points.map((p) => [p.letter, p]));
  const spread = (a) => { const k = a.axis === "horizontal" ? "y" : "x"; const vs = a.points.map((L) => P.get(L)[k]); return Math.max(...vs) - Math.min(...vs); };
  const replyLetters = new Set(parsed.lines.flatMap((l) => [l.from, l.to]).filter(isLetter));
  const lettersOk = parsed.aligned.length > 0
    && parsed.aligned.every((a) => a.points.every((L) => P.has(L)) && spread(a) <= tol)
    && [...replyLetters].every((L) => P.has(L))
    && (parsed.marked.length === 0 || parsed.marked.length === g.points.length);
  if (!lettersOk) return refuse("the drawing's crosshairs do not letter as the reply does (its ALIGNED lines, its marked points)");
  const nameOf = (axis, v) => {
    const k = axis === "horizontal" ? "x" : "y";
    const letters = g.points.filter((p) => Math.abs(p[k] - v) <= tol).map((p) => p.letter).sort();
    if (letters.length) return { letters };
    const vs = g.points.map((p) => p[k]);
    if (v < Math.min(...vs) - tol) return { edge: k === "x" ? EDGE_NAMES.left : EDGE_NAMES.top };
    if (v > Math.max(...vs) + tol) return { edge: k === "x" ? EDGE_NAMES.right : EDGE_NAMES.bottom };
    return {};
  };
  const consistent = (e, n) => (isLetter(e) ? !!(n.letters && n.letters.includes(e)) : !!(n.edge && n.edge === e));
  const named = (n) => !!(n.letters || n.edge);
  const used = new Set();
  const lines = parsed.lines.map((l, i) => {
    const o = base[i];
    const cand = g.claims.filter((c) => c.axis === l.axis && Number(c.value) === l.value);
    if (cand.length === 0) return { ...o, outcome: "UNSETTLED", reason: "no geometry claim with this value and axis" };
    const free = cand.filter((c) => !used.has(c));
    if (free.length === 0) return { ...o, outcome: "UNSETTLED", reason: "the geometry's claim with this value and axis is taken by an earlier line" };
    const ends = free.map((c) => ({ c, n: [nameOf(l.axis, c.span[0]), nameOf(l.axis, c.span[1])] }));
    const agree = ends.filter(({ n }) => (consistent(l.from, n[0]) && consistent(l.to, n[1])) || (consistent(l.from, n[1]) && consistent(l.to, n[0])));
    if (agree.length === 1) { used.add(agree[0].c); return { ...o, outcome: "CONFIRMED", span: agree[0].c.span }; }
    if (agree.length > 1) return { ...o, outcome: "UNSETTLED", reason: "two geometry claims agree with the line" };
    if (free.length > 1) return { ...o, outcome: "UNSETTLED", reason: "two free geometry claims with this value and axis, neither agrees — ambiguous" };
    const { c, n } = ends[0];
    if (!named(n[0]) || !named(n[1])) return { ...o, outcome: "UNSETTLED", reason: "a span end has no name (off every crosshair's line and not beyond every point)", span: c.span };
    const flip = consistent(l.to, n[0]) || consistent(l.from, n[1]);
    const g2 = flip ? [n[1], n[0]] : n;
    const pick = (x, prefer) => (x.letters ? (x.letters.includes(prefer) ? prefer : x.letters[0]) : x.edge);
    const from = consistent(l.from, g2[0]) ? l.from : pick(g2[0], l.from);
    const to = consistent(l.to, g2[1]) ? l.to : pick(g2[1], l.to);
    if (from === to) return { ...o, outcome: "UNSETTLED", reason: "both span ends name the same feature", span: c.span };
    used.add(c);
    return { ...o, outcome: "SETTLED", settledTo: `from ${from} to ${to} (${l.axis}): ${l.valueText}${l.unit ? ` ${l.unit}` : ""}`, from: l.from, to: l.to, settledFrom: from, settledEnd: to, span: c.span };
  });
  return { lettersOk: true, lines };
}

/**
 * D14 (a), D15, D16 — the chain reply settled by the drawing's geometry. `geometry` = { primary, check } — the
 * bridge's readings at the pinned ink (200) and the cross-check's (128), each `{ regions: [...] }` (or already
 * reduced by `chainGeometryOf`); null / missing → nothing settles. A line is SETTLED only when BOTH inks settle it
 * to the same line; CONFIRMED when the pinned ink's claim agrees with it as read; otherwise UNSETTLED with the reason.
 * The settled reply replaces a SETTLED line in place (by its line index) and keeps every other byte.
 * Returns { reply, lines: [{ index, line, outcome, reason?, settledTo?, span?, check }], settled, confirmed,
 * unsettled, lettersOk: { primary, check } }.
 */
function settleChain(reply, geometry, { tol = CHAIN_GEOMETRY.nameTolPt } = {}) {
  const text = String(reply || "");
  const parsed = parseChain(text);
  const reduce = (g) => (g && Array.isArray(g.regions) ? chainGeometryOf(g) : g || null);
  const primary = settleOnce(parsed, reduce(geometry && geometry.primary), tol);
  const check = settleOnce(parsed, reduce(geometry && geometry.check), tol);
  const brief = (c) => ({ outcome: c.outcome, ...(c.settledTo ? { settledTo: c.settledTo } : {}), ...(c.reason ? { reason: c.reason } : {}) });
  const lines = primary.lines.map((p, i) => {
    const c = check.lines[i];
    if (p.outcome === "SETTLED" && !(c.outcome === "SETTLED" && c.settledTo === p.settledTo)) {
      return { index: p.index, line: p.line, outcome: "UNSETTLED", reason: `the two ink settings disagree — ink ${CHAIN_GEOMETRY.ink} reads "${p.settledTo}", ink ${CHAIN_GEOMETRY.checkInk} ${c.outcome === "SETTLED" ? `reads "${c.settledTo}"` : `leaves it (${c.reason || c.outcome})`}`, span: p.span, check: brief(c) };
    }
    return { ...p, check: brief(c) };
  });
  const rows = text.split("\n");
  for (const l of lines) if (l.outcome === "SETTLED") rows[l.index] = rows[l.index].replace(l.line, l.settledTo);
  const count = (o) => lines.filter((l) => l.outcome === o).length;
  return { reply: rows.join("\n"), lines, settled: count("SETTLED"), confirmed: count("CONFIRMED"), unsettled: count("UNSETTLED"), lettersOk: { primary: primary.lettersOk, check: check.lettersOk } };
}

/**
 * D6 (a), D7 — the block: the reply's POINTS MARKED / ALIGNED / CHAIN sections as read (settled), then the POINTS
 * computed by the solver and the CLOSURE checked — the design probe's `computedBlock`, the format the generator was
 * measured on (§0f: right where it speaks, silent where the chain does not close, no layout class hit).
 */
function chainBlockText({ reply, solved = null }) {
  const s = solved || pointsFromChain(reply);
  const chain = String(reply || "").replace(/\n\s*CLOSURE:[\s\S]*$/, "").trim();
  const u = s.unit ? ` ${s.unit}` : "";
  const rows = Object.entries(s.points).map(([L, p]) => `${L}: x = ${fmt(p.x)}${u}, y = ${fmt(p.y)}${u}`);
  const nd = s.notDerivable.map((n) => `${n.point}: not derivable (${n.missing.join(", ")} unknown${n.why ? ` — ${n.why}` : ""})`);
  const points = rows.concat(nd);
  const closure = s.closure.map((c) => (c.sum ? `${c.sum} vs the printed ${fmt(c.printedTotal)} ${c.ok ? "✓" : "✗"}` : `${c.axis}: ${c.note}`));
  return `${chain}\n\nPOINTS (computed from the CHAIN, x from the left edge, y from the top edge):\n${points.length ? points.join("\n") : "none — the drawing marks no points"}\n\nCLOSURE (checked):\n${closure.length ? closure.join("\n") : "none printed"}`;
}

/**
 * D7 — the caption with its DESCRIPTION's body replaced by the block, under the existing `DESCRIPTION:` label (the
 * caption's LAST section; the TITLE / TYPE / SUBJECTS / TRANSCRIPTION and every byte before it unchanged). A caption
 * without a DESCRIPTION gains one at its end.
 */
function replaceDescription(caption, block) {
  const text = String(caption || "");
  const body = `DESCRIPTION:\n${block}`;
  let at = text.startsWith("DESCRIPTION:") ? 0 : -1;
  const last = text.lastIndexOf("\nDESCRIPTION:");
  if (last >= 0) at = last + 1;
  if (at < 0) return `${text.trimEnd()}\n\n${body}`;
  return `${text.slice(0, at)}${body}`;
}

/**
 * D6 (a) as narrowed by D19 (b) (the owner, 2026-09-25, session 58 — t46-design.md §12e): a chain page's block REPLACES
 * its caption's DESCRIPTION only where it computes at least one point — Figure 15 on the corpus, whose DESCRIPTION is
 * wrong. Where the chain computes nothing (no marked point: Miele p95's a / b / c, SSX125's insets, Figures 29 / 31) the
 * caption's own DESCRIPTION — accurate there, and carrying the page's procedure — stands; the chain is still asked,
 * memoised, settled and recorded (metadata.chain, the counts). The one place the rule lives.
 */
function chainReplacesDescription(solved) {
  return !!solved && solved.derived > 0;
}

/**
 * D9, D16 — the chain pass's counts, one list for every surface they travel (the trace, the route's file result,
 * file_parsed and every terminal record, the ledger's reducer, the span, the views, the state probe): the pages
 * admitted, the NO_DIMENSIONS verdicts, the requests and recalls, the failed asks, the chain lines and `[unclear]`
 * marks read, the points computed / not derivable, the closures checked, the lines the geometry confirmed / settled,
 * the failed geometry reads, the captions whose DESCRIPTION the block replaced, and the chain replies the job memoised
 * (the re-ingest's memo-growth check reads it). New counts go at the END.
 */
const CHAIN_COUNT_KEYS = Object.freeze([
  "chainPages", "chainNoDimensions", "chainCalls", "chainFromMemo", "chainFailed", "chainLines", "chainUnclear",
  "chainPointsDerived", "chainPointsNotDerivable", "chainClosureOk", "chainClosureFailed", "chainConfirmed", "chainSettled",
  "chainGeometryFailed", "chainBlocks", "chainMemoised",
]);
/** The named lists beside the counts: the admitted, failed and block pages (a comma list) and the settled lines. */
const CHAIN_LIST_KEYS = Object.freeze(["chainPagesList", "chainFailedPages", "chainBlockPages", "chainSettledList"]);

/** The parser's chain summary → the trace's flat keys (0 / "" / [] when the pass did not run). */
function chainTraceOf(s) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const list = (a) => (Array.isArray(a) ? a.join(", ") : "");
  const x = s || {};
  return {
    chainPages: n(x.pages), chainNoDimensions: n(x.noDimensions), chainCalls: n(x.calls), chainFromMemo: n(x.fromMemo), chainFailed: n(x.failed),
    chainLines: n(x.lines), chainUnclear: n(x.unclear), chainPointsDerived: n(x.pointsDerived), chainPointsNotDerivable: n(x.pointsNotDerivable),
    chainClosureOk: n(x.closureOk), chainClosureFailed: n(x.closureFailed), chainConfirmed: n(x.confirmed), chainSettled: n(x.settled),
    chainGeometryFailed: n(x.geometryFailed), chainBlocks: n(x.blocks), chainMemoised: n(x.memoised),
    chainPagesList: list(x.pagesList), chainFailedPages: list(x.failedPages), chainBlockPages: list(x.blockPages),
    chainSettledList: Array.isArray(x.settledList) ? x.settledList.map((e) => ({ ...e })) : [],
  };
}

/** The geometry's shadow read in one phrase for the log (D16): per ink, the crosshairs and the claims with a span. */
function geometrySummary(geometry) {
  if (!geometry || !geometry.readings) return "none";
  return Object.entries(geometry.readings).map(([ink, r]) => {
    const regions = Array.isArray(r && r.regions) ? r.regions : [];
    const points = regions.reduce((a, g) => a + (Array.isArray(g.points) ? g.points.length : 0), 0);
    const spans = regions.reduce((a, g) => a + (Array.isArray(g.claims) ? g.claims.filter((c) => c && Array.isArray(c.span)).length : 0), 0);
    return `ink ${ink}: ${points} crosshair(s), ${spans} claim(s) with a span`;
  }).join("; ");
}

/** The container log's summary of a solved chain (D9): `9 line(s), 5 aligned, points 6 derived / 0 not derivable, closure y ✓`. */
function chainLogSummary(solved, parsed) {
  const s = solved;
  const closure = s.closure.map((c) => `${c.axis} ${c.ok === true ? "✓" : c.ok === false ? "✗" : "open"}`).join(" ");
  return `${parsed ? parsed.chainLines : s.lines} line(s), ${s.aligned} aligned, points ${s.derived} derived / ${s.notDerivable.length} not derivable${closure ? `, closure ${closure}` : ""}${parsed && parsed.unclear ? `, ${parsed.unclear} [unclear]` : ""}`;
}

module.exports = {
  CHAIN_GEOMETRY,
  CHAIN_BLOCK_RULE,
  NO_DIMENSIONS,
  isNoDimensions,
  captionSection,
  chainAdmits,
  parseChain,
  pointsFromChain,
  chainGeometryOf,
  settleChain,
  chainBlockText,
  replaceDescription,
  chainReplacesDescription,
  CHAIN_COUNT_KEYS,
  CHAIN_LIST_KEYS,
  chainTraceOf,
  geometrySummary,
  chainLogSummary,
};
