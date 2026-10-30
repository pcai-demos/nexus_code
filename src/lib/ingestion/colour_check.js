/**
 * The disclose-only COLOUR CHECK of a keyed-index detail chunk — ticket T57 (F-215; design
 * `inputs/rag-audit/t57-design.md`, D1–D9 approved 2026-09-28).
 *
 * Pure module: no I/O and no framework. It requires only its sibling `detail_pass.js` (pure too) for T45's same-line
 * rule, the cluster radius and the label order, so the two rules can never drift apart. The bridge
 * (`docling_bridge.py --colours`, `colour_layer.py`) reads the page's colour layer; the parser (`parser.js`) runs this
 * check between the tile merge and the chunk text. Everything here is pinned by U-COLOUR against the design probe's
 * records (`tests/eval/baselines/t57-artifacts/records/check57-p1.json` — coded = measured, row for row).
 *
 * What it does (design §0d, §2.2). On a colour-keyed plan every element is drawn in exactly its legend swatch's fill,
 * and every label is in the text layer, so the page itself can check each reading the tiles agreed on (F-215: 22 of the
 * Site Plan's 129 plots were stated as the wrong design, unanimously, so T45's conflicts never saw them):
 *   1. THE LEGEND, from the page: a swatch is a small filled shape with a key entry's name beside it — the words
 *      overlapping its height that start within twice its width to the right, each continued in the text layer's own
 *      order while T45's same-line rule holds (column-local). Only a key entry whose ATTRIBUTE names a colour is
 *      considered (D5). A name is assigned by elimination; a name left with two fills, or a fill two names claim, is
 *      not matched — and a design with no matched swatch is never checked. T60 (F-228): the block's words after the name
 *      are the text the legend prints with it ("5 bedroom home" — `legendTextOf`), returned in the audit as `legendText`.
 *   2. THE FOOTPRINTS: the paths in a matched swatch's exact fill (never the swatch), grouped when their boxes touch,
 *      each group's box ≥ 10 pt² (a garage carries its house's colour).
 *   3. THE LABEL'S POINT: T45's occurrence rule clustered within its 40 pt; exactly ONE cluster, else no check; in it
 *      the occurrence(s) with the LARGEST font size (the plot's own label, never a parking-bay repeat — D6). T59 (F-225):
 *      a RANGE label ("220 - 237") the whole-token rule cannot find is placed as the page prints it ("220-" "237").
 *   4. THE EVIDENCE, nearest first: the designs whose swatch fill covers ≥ 20 % of the pixels around the label's own
 *      words (distance 0 — a building drawn in an image has no path; D3), then those with a footprint within 10 pt of
 *      the point (0 inside one; D4).
 *   5. THE VERDICTS — never a replaced reading (the owner's D1, T56): a plain reading whose colour is present is
 *      CONFIRMED; a plain reading whose colour is absent while another key colour is present is DISCLOSED as a conflict
 *      "reading or nearest colour" (kind "colour", T57 D1 a) and leaves the COUNTS; a reading with no key colour near it
 *      at all stays as read (T57 D2 a — nothing contradicts it); a tile disagreement "A or B" is SETTLED to the one
 *      option whose colour is present when exactly one is (a plain entry that counts — T45 D6's shape), else left.
 * Measured on the census (t57-design §0e): the unhedged wrong readings 22 → 3, 0 readings replaced, 4 tile conflicts
 * settled right and 0 wrong; nothing checked on production's other 18 keyed pages (§0g).
 *
 * T61 (t61-design.md D1 a — the owner's; F-215's residue): the THREE-CUE SETTLE (`associationSettle`), a pure step after
 * the check, on its merge. Where three independent cues on the page all name ONE design within 10 pt — the nearest
 * footprint to the label (R1), the nearest house-sized footprint (R2), the footprint nearest the plot's own parking bays
 * (the label's smaller-font occurrences in its one cluster; R3) — and no image building sits under the label, that design
 * is written: a plain reading REPLACED, a disagreement or a colour disclosure RESOLVED to it when it is one of its options.
 * Every design in the entry must have a matched swatch (the check's own precondition). A range, a multi-valued label, a
 * label with no single cluster or no bay is left as the check wrote it. Measured before any code (t61-design §0, frozen
 * at 83bcced before the hold-out): 13 readings settled on the Site Plan, every one to the truth (the census 102 / 3 / 24 →
 * 115 / 1 / 13); 0 wrong designs on both halves, on the v13, v9 and all-right indexes, at every setting swept.
 */

const { sameLine, labelOrder, LABEL_CLUSTER_HALF_PT, RANGE_LABEL, isRangeLabel } = require("./detail_pass");

/** The constants (design §0f — measured on the Site Plan's page 1; the pixel window and tolerance are the bridge's). */
const COLOUR_CHECK = Object.freeze({
  SWATCH_MIN_PT: 3, // a legend swatch: each side 3–20 pt …
  SWATCH_MAX_PT: 20,
  SWATCH_ASPECT: 2, // … and no longer than twice its width
  SWATCH_GAP: 2, // its name starts within 2 × its width to the right
  TOUCH_PT: 0.3, // same-fill paths whose boxes touch within this are one footprint (a roof split at its ridge)
  MIN_AREA_PT2: 10, // a footprint's box ≥ 10 pt² (a garage ≈ 20–60 pt² counts; a detail piece does not)
  RADIUS_PT: 10, // D4 — the census's radius; the sweep's best
  PIXEL_SHARE: 0.2, // D3 — a swatch fill on ≥ 20 % of the pixels around the label's own words
});

/**
 * T61 (t61-design.md D1 a, D3 a): the three-cue settle's constants — the census's areas (T56) and the check's own radius
 * as the cap, frozen before the hold-out (residue61.js at 83bcced). Safe at every cap from 6 to 14 pt on the Site Plan
 * (the page's one false agreement, 218, needs 14.19 pt); the pixel guard is D3's share.
 */
const ASSOCIATION = Object.freeze({
  CAP_PT: 10, // every cue's footprint within 10 pt — of the label for R1 / R2, of a bay for R3 (T57's RADIUS_PT)
  MIN_HOUSE_PT2: 90, // R2: a HOUSE-sized footprint — its box ≥ 90 pt² (T56's; R1 and R3 take any footprint, ≥ 10 pt²)
});

/** D5: the attribute names a colour — a basic vocabulary (the KEY pass writes the captioner's own colour words, F-186). */
const COLOUR_WORDS = Object.freeze(["red", "orange", "yellow", "green", "blue", "purple", "violet", "pink", "brown", "grey", "gray", "black", "white", "tan", "teal", "cyan", "magenta", "lavender", "lilac", "mauve", "maroon", "navy", "beige", "cream", "gold", "golden", "olive", "turquoise", "aqua", "crimson", "scarlet", "salmon", "peach", "khaki", "ochre", "amber", "lime", "indigo", "burgundy", "charcoal", "silver", "coral", "plum", "ivory", "bronze", "copper", "fuchsia", "azure", "taupe", "buff", "sand"]);
const COLOUR_WORD_SET = new Set(COLOUR_WORDS);

const canonTokens = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const isUnknown = (category) => canonTokens(category).join(" ") === "unknown";
const fillKey = (rgb) => (Array.isArray(rgb) ? rgb.slice(0, 3).join(",") : "");

/** Does this key attribute name a colour? */
function namesColour(attribute) {
  return canonTokens(attribute).some((t) => COLOUR_WORD_SET.has(t));
}

/** Does any key entry name a colour (the parser asks the bridge for the colour layer only then — design §2.1)? */
function keyNamesColour(key) {
  return (Array.isArray(key) ? key : []).some((e) => e && e.name && namesColour(e.attribute));
}

/** A word as the bridge emits it ({ text, x0, y0, x1, y1, size }), or null. */
function word(w) {
  if (!w || typeof w.text !== "string") return null;
  const b = [w.x0, w.y0, w.x1, w.y1].map(Number);
  if (!b.every(Number.isFinite)) return null;
  return { text: w.text, x0: b[0], y0: b[1], x1: b[2], y1: b[3], size: Number.isFinite(Number(w.size)) ? Number(w.size) : 0 };
}

/**
 * 1. The legend (design §0d.1, D5). `key` = the KEY entries ({ attribute, name }); `words` / `paths` = the colour
 * layer's. Returns { swatches: Map(name → { rgb, bbox, index, block }), audit: [{ name, attribute, matched, … }],
 * candidates } — `candidates` counts the small filled shapes that carry a name block.
 */
function legendSwatches(key, words, paths) {
  const C = COLOUR_CHECK;
  const ws = (Array.isArray(words) ? words : []).map(word);
  const cands = [];
  (Array.isArray(paths) ? paths : []).forEach((path, i) => {
    if (!path || !Array.isArray(path.bbox)) return;
    const [x0, y0, x1, y1] = path.bbox.map(Number);
    const w = x1 - x0;
    const h = y1 - y0;
    if (!(w >= C.SWATCH_MIN_PT && h >= C.SWATCH_MIN_PT && w <= C.SWATCH_MAX_PT && h <= C.SWATCH_MAX_PT)) return;
    if (Math.max(w, h) / Math.max(Math.min(w, h), 1e-6) > C.SWATCH_ASPECT) return;
    // Every word beside the shape begins a run in the text layer's own order while T45's same-line rule holds; a run
    // inside another is dropped; the runs are read top to bottom — column-local, a neighbouring column never joins.
    const starts = [];
    ws.forEach((wd, k) => { if (wd && wd.y1 > y0 && wd.y0 < y1 && wd.x0 >= x1 - 1 && wd.x0 - x1 <= C.SWATCH_GAP * w) starts.push(k); });
    const runs = starts.map((k) => { const run = [k]; for (let q = k + 1; q < ws.length && ws[q] && ws[q - 1] && sameLine(ws[q - 1], ws[q]); q++) run.push(q); return run; });
    const kept = runs.filter((r, a) => !runs.some((o, b) => b !== a && o.length > r.length && r.every((k) => o.includes(k))));
    kept.sort((a, b) => ws[a[0]].y1 - ws[b[0]].y1 || ws[a[0]].x0 - ws[b[0]].x0);
    const tokens = [];
    const text = [];
    for (const run of kept) for (const k of run) { tokens.push(...canonTokens(ws[k].text)); text.push(ws[k].text); }
    if (tokens.length) cands.push({ index: i, rgb: path.rgb, bbox: path.bbox, tokens, text: text.join(" ") });
  });
  const contains = (hay, needle) => { for (let s = 0; s + needle.length <= hay.length; s++) if (needle.every((t, k) => hay[s + k] === t)) return true; return false; };
  const entries = (Array.isArray(key) ? key : []).filter((e) => e && e.name && namesColour(e.attribute));
  const names = [...new Set(entries.map((e) => e.name))];
  const options = new Map(names.map((n) => [n, cands.filter((c) => canonTokens(n).length > 0 && contains(c.tokens, canonTokens(n)))]));
  const assigned = new Map();
  for (let changed = true; changed;) {
    changed = false;
    for (const [n, opts] of options) {
      if (assigned.has(n)) continue;
      const taken = new Set([...assigned.values()].map((a) => a.index));
      const free = opts.filter((c) => !taken.has(c.index));
      const fills = [...new Set(free.map((c) => fillKey(c.rgb)))];
      if (fills.length === 1) { assigned.set(n, free[0]); changed = true; }
    }
  }
  const byFill = new Map();
  for (const [n, c] of assigned) byFill.set(fillKey(c.rgb), (byFill.get(fillKey(c.rgb)) || []).concat(n));
  const swatches = new Map();
  const audit = [];
  for (const e of Array.isArray(key) ? key : []) {
    if (!e || !e.name || audit.some((a) => a.name === e.name)) continue;
    if (!namesColour(e.attribute)) { audit.push({ name: e.name, attribute: e.attribute, matched: false, why: "attribute names no colour" }); continue; }
    const c = assigned.get(e.name);
    if (!c) { audit.push({ name: e.name, attribute: e.attribute, matched: false, why: `${options.get(e.name).length} candidate(s)` }); continue; }
    if (byFill.get(fillKey(c.rgb)).length > 1) { audit.push({ name: e.name, attribute: e.attribute, matched: false, why: "fill shared with another name" }); continue; }
    swatches.set(e.name, { rgb: c.rgb.slice(0, 3), bbox: c.bbox, index: c.index, block: c.text });
    audit.push({ name: e.name, attribute: e.attribute, matched: true, rgb: c.rgb.slice(0, 3), block: c.text });
  }
  return { swatches, audit, candidates: cands.length };
}

/**
 * T60 (design D2 a; F-228): the text a legend entry prints WITH its name — the swatch's block (1. above, read by the page's
 * geometry, never by reading order) less the name's own words: "The Malvern 5 bedroom home" → "5 bedroom home". "" when
 * the block is the name alone ("Affordable Housing Shared Ownership", two lines); null when the block does not begin with
 * the name (nothing is read then). Words are compared as canon tokens, so case and punctuation never decide; a word of
 * punctuation alone is passed over. The detail pass groups the COUNTS rows by it (detail_pass.js legendTextLines).
 */
function legendTextOf(block, name) {
  const want = canonTokens(name);
  if (!want.length) return null;
  const words = String(block || "").split(/\s+/).filter(Boolean);
  let k = 0;
  let used = 0;
  while (k < want.length && used < words.length) {
    const got = canonTokens(words[used]);
    if (got.length === 0) { used++; continue; }
    if (got.join(" ") !== want.slice(k, k + got.length).join(" ")) return null;
    k += got.length;
    used++;
  }
  return k === want.length ? words.slice(used).join(" ") : null;
}

/** 2. The footprints of the matched fills: [{ design, rgb, bbox, area, rings }]. */
function colourFootprints(paths, swatches) {
  const C = COLOUR_CHECK;
  const fillName = new Map();
  const swatchIdx = new Set();
  for (const [n, s] of swatches) { fillName.set(fillKey(s.rgb), n); swatchIdx.add(s.index); }
  const cand = [];
  (Array.isArray(paths) ? paths : []).forEach((path, i) => { if (path && !swatchIdx.has(i) && fillName.has(fillKey(path.rgb))) cand.push(path); });
  const parent = cand.map((_, i) => i);
  const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) {
    if (fillKey(cand[a].rgb) !== fillKey(cand[b].rgb)) continue;
    const A = cand[a].bbox;
    const B = cand[b].bbox;
    if (A[0] - C.TOUCH_PT <= B[2] && B[0] - C.TOUCH_PT <= A[2] && A[1] - C.TOUCH_PT <= B[3] && B[1] - C.TOUCH_PT <= A[3]) parent[find(a)] = find(b);
  }
  const groups = new Map();
  cand.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
  const out = [];
  for (const ps of groups.values()) {
    const bb = [Math.min(...ps.map((q) => q.bbox[0])), Math.min(...ps.map((q) => q.bbox[1])), Math.max(...ps.map((q) => q.bbox[2])), Math.max(...ps.map((q) => q.bbox[3]))];
    const area = (bb[2] - bb[0]) * (bb[3] - bb[1]);
    if (area < C.MIN_AREA_PT2) continue;
    out.push({ design: fillName.get(fillKey(ps[0].rgb)), rgb: ps[0].rgb.slice(0, 3), bbox: bb, area, rings: ps.flatMap((q) => (Array.isArray(q.rings) ? q.rings : [])) });
  }
  return out;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRing(px, py, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    if ((y1 > py) !== (y2 > py) && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) c = !c;
  }
  return c;
}

/** The distance from a point to a footprint: 0 inside any of its rings, else to its nearest edge. */
function footprintDistance(px, py, f) {
  let best = Infinity;
  for (const ring of f.rings) {
    if (!Array.isArray(ring) || ring.length === 0) continue;
    if (ring.length >= 3 && insideRing(px, py, ring)) return 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      best = Math.min(best, segDist(px, py, ax, ay, bx, by));
    }
  }
  return best;
}

/**
 * 3. The label's own occurrence(s) (D6): T45's matching — the label's tokens as consecutive words on one line — the
 * occurrences clustered within LABEL_CLUSTER_HALF_PT; exactly ONE cluster, else { why }; in it, the occurrences with
 * the largest font size: { own: [{ idx: [word indexes], x0, y0, x1, y1, size }], occurrences }.
 */
function labelPoint(words, label) {
  const ws = (Array.isArray(words) ? words : []).map(word);
  const tokens = String(label == null ? "" : label).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { why: "no occurrence" };
  const occ = [];
  for (let i = 0; i + tokens.length <= ws.length; i++) {
    let ok = true;
    for (let k = 0; k < tokens.length && ok; k++) {
      const w = ws[i + k];
      if (!w || w.text.trim() !== tokens[k]) ok = false;
      else if (k > 0 && !sameLine(ws[i + k - 1], w)) ok = false;
    }
    if (!ok) continue;
    const run = ws.slice(i, i + tokens.length);
    occ.push({ idx: run.map((_, k) => i + k), x0: Math.min(...run.map((w) => w.x0)), y0: Math.min(...run.map((w) => w.y0)), x1: Math.max(...run.map((w) => w.x1)), y1: Math.max(...run.map((w) => w.y1)), size: Math.max(...run.map((w) => w.size)) });
  }
  if (!occ.length) return { why: "no occurrence" };
  return ownCluster(occ);
}

/** The occurrences clustered within LABEL_CLUSTER_HALF_PT; exactly ONE cluster, else { why }; in it, those with the largest font size. */
function ownCluster(occ) {
  const parent = occ.map((_, i) => i);
  const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const cd = (a, b) => Math.hypot((a.x0 + a.x1 - b.x0 - b.x1) / 2, (a.y0 + a.y1 - b.y0 - b.y1) / 2);
  for (let i = 0; i < occ.length; i++) for (let j = i + 1; j < occ.length; j++) if (cd(occ[i], occ[j]) <= LABEL_CLUSTER_HALF_PT) parent[find(i)] = find(j);
  const roots = new Set(occ.map((_, i) => find(i)));
  if (roots.size !== 1) return { why: `${roots.size} clusters` };
  const top = Math.max(...occ.map((o) => o.size));
  return { own: occ.filter((o) => o.size === top), occurrences: occ.length };
}

/**
 * 3b. T59 (design D3 a; F-225): a RANGE label's own occurrence(s). The page prints a range as its own tokens — "220-"
 * "237", or "255" "-" "266" — which `labelPoint`'s whole-token run never finds (T57's known limit, "no occurrence"). Here:
 * one word "N-M"; or N (or "N-") then M (or "-M") on one line (T45's `sameLine`) at one font size, joined, or with a dash word between them
 * placed by its x (the dash's box can be degenerate — 0.3 pt, off the numbers' baseline: t59-design §0c); the dash is
 * one of the label's words. The same clustering and size rule as `labelPoint`. A range the page does not print on one
 * line (the Site Plan's "255 - 256": three stacked parking-bay labels) is { why: "not printed as a range on one line" }.
 */
function rangeLabelPoint(words, label) {
  const m = RANGE_LABEL.exec(String(label == null ? "" : label).trim());
  if (!m || Number(m[1]) >= Number(m[2])) return { why: "no occurrence" };
  const [n, mm] = [m[1], m[2]];
  const ws = (Array.isArray(words) ? words : []).map(word);
  const DASH = /^[-–—]$/;
  const occ = [];
  const one = new RegExp(`^${n}[-–—]${mm}$`);
  for (let i = 0; i < ws.length; i++) {
    const a = ws[i];
    const at = a ? a.text.trim() : "";
    if (one.test(at)) { occ.push({ idx: [i], x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1, size: a.size }); continue; }
    if (at !== n && at !== `${n}-` && at !== `${n}–`) continue;
    for (let j = 0; j < ws.length; j++) {
      const b = ws[j];
      const bt = b && j !== i ? b.text.trim() : "";
      if (bt !== mm && bt !== `-${mm}` && bt !== `–${mm}`) continue;
      if (b.size !== a.size || b.x0 < a.x1 || !sameLine(a, b)) continue;
      const joined = at !== n || bt !== mm;
      const dash = joined ? -1 : ws.findIndex((d, k) => d && k !== i && k !== j && DASH.test(d.text.trim()) && d.x0 >= a.x1 - 0.5 && d.x1 <= b.x0 + 0.5 && Math.abs((d.y0 + d.y1) / 2 - (a.y0 + a.y1) / 2) <= a.y1 - a.y0);
      if (!joined && dash < 0) continue;
      const idx = dash >= 0 ? [i, dash, j] : [i, j];
      const run = idx.map((k) => ws[k]);
      occ.push({ idx, x0: Math.min(...run.map((w) => w.x0)), y0: Math.min(...run.map((w) => w.y0)), x1: Math.max(...run.map((w) => w.x1)), y1: Math.max(...run.map((w) => w.y1)), size: a.size });
    }
  }
  if (!occ.length) return { why: "not printed as a range on one line" };
  return ownCluster(occ);
}

/**
 * The pixels around the label's own words, tallied per matched swatch fill: { n, tally: Map(name → count) }, or null when
 * the layer carries no usable pixel counts. `pixels` = the layer's { fills: [[r, g, b]], words: [{ w, n, counts }] }.
 */
function labelPixels(point, pixels, swatches) {
  if (!pixels || !Array.isArray(pixels.fills) || !Array.isArray(pixels.words)) return null;
  const fillIdx = new Map(pixels.fills.map((f, i) => [fillKey(f), String(i)]));
  const byWord = new Map(pixels.words.map((w) => [w.w, w]));
  let n = 0;
  const tally = new Map();
  for (const o of point.own) for (const wi of o.idx) {
    const rec = byWord.get(wi);
    if (!rec) continue;
    n += Number(rec.n) || 0;
    for (const [name, s] of swatches) { const k = fillIdx.get(fillKey(s.rgb)); if (k !== undefined && rec.counts && rec.counts[k]) tally.set(name, (tally.get(name) || 0) + rec.counts[k]); }
  }
  return { n, tally };
}

/**
 * 4. The evidence at the label, nearest first (D3, D4): the designs whose swatch fill covers ≥ PIXEL_SHARE of the
 * pixels around the label's own words (distance 0), then the designs with a footprint within RADIUS_PT.
 * `pixels` = the layer's { fills: [[r, g, b]], words: [{ w, n, counts: { fillIndex: count } }] } or null.
 * Returns { source: "pixels+vector" | "pixels" | "vector" | "none", present: [{ design, d, share? }] }.
 */
function colourEvidence(point, footprints, pixels, swatches) {
  const C = COLOUR_CHECK;
  const near = new Map();
  for (const f of footprints) {
    let d = Infinity;
    for (const o of point.own) d = Math.min(d, footprintDistance((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, f));
    if (d <= C.RADIUS_PT && (!near.has(f.design) || d < near.get(f.design))) near.set(f.design, d);
  }
  const vec = [...near.entries()].sort((a, b) => a[1] - b[1]).map(([design, d]) => ({ design, d: Math.round(d * 100) / 100 }));
  const px = labelPixels(point, pixels, swatches);
  const pix = px ? [...px.tally.entries()].filter(([, c]) => px.n > 0 && c / px.n >= C.PIXEL_SHARE).sort((a, b) => b[1] - a[1]).map(([design, c]) => ({ design, share: Math.round((c / px.n) * 1000) / 1000, d: 0 })) : [];
  const present = pix.concat(vec.filter((v) => !pix.some((x) => x.design === v.design)));
  return { source: pix.length && vec.length ? "pixels+vector" : pix.length ? "pixels" : vec.length ? "vector" : "none", present };
}

/** The COUNTS from the plain entries, exactly as mergeTiles computes them (UNKNOWN apart; by count, then name); the conflicts that remain, in label order. */
function recount(index) {
  const perCategory = new Map();
  for (const e of index) {
    if (e.conflict != null || typeof e.category !== "string" || isUnknown(e.category)) continue;
    if (!perCategory.has(e.category)) perCategory.set(e.category, []);
    perCategory.get(e.category).push(e.label);
  }
  const counts = [...perCategory.entries()].map(([category, ls]) => ({ category, n: ls.length, labels: ls.slice().sort(labelOrder) })).sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
  const conflicts = index.filter((e) => Array.isArray(e.conflict) && e.kind !== "one tile, two categories").map((e) => ({ label: e.label, categories: e.conflict.slice(), kind: e.kind || "tiles disagree" })).sort((a, b) => labelOrder(a.label, b.label));
  return { counts, conflicts };
}

/**
 * The check over a merged index (design §2.2). `merged` = detail_pass.mergeTiles's result; `key` = the KEY entries;
 * `layer` = the bridge's --colours reply ({ words, paths, pixels }). Returns { merged, audit }: the merge with each
 * disclosed reading as a conflict of kind "colour" ({ label, category: null, conflict: [reading, colour], kind }),
 * each settled disagreement as a plain entry, the COUNTS recomputed exactly as mergeTiles computes them (UNKNOWN
 * apart; by count, then name) and CONFLICTS in label order; the audit — the swatches matched, the per-label rows, the
 * labels confirmed / disclosed / settled / left, and each unchecked label's reason. A missing or unusable layer, or a
 * key naming no colour, returns the merge unchanged ({ audit.ran: false }).
 */
function colourCheck(merged, { key = [], layer = null } = {}) {
  const none = (why) => ({ merged, audit: { ran: false, why, swatches: 0, matched: [], legend: [], legendText: {}, checked: 0, confirmed: 0, flagged: [], settled: [], left: [], unchecked: {}, rows: [] } });
  if (!merged || !Array.isArray(merged.index)) return none("no merged index");
  if (!keyNamesColour(key)) return none("no key entry names a colour");
  if (!layer || !Array.isArray(layer.words) || layer.words.length === 0 || !Array.isArray(layer.paths)) return none("no colour layer");
  const legend = legendSwatches(key, layer.words, layer.paths);
  if (legend.swatches.size === 0) return { ...none("no swatch matched"), audit: { ...none("no swatch matched").audit, legend: legend.audit } };
  const feet = colourFootprints(layer.paths, legend.swatches);
  const rows = [];
  const index = [];
  for (const e of merged.index) {
    const isPlain = e.conflict == null && typeof e.category === "string";
    const isDisagreement = Array.isArray(e.conflict) && e.kind !== "one tile, two categories";
    const designs = isPlain ? [e.category] : isDisagreement ? e.conflict : [];
    const row = { label: e.label, reading: isPlain ? e.category : null, conflict: isDisagreement ? e.conflict.slice() : null };
    const keep = (why) => { rows.push({ ...row, verdict: "unchecked", why }); index.push(e); };
    if (!designs.length) { keep("multi-valued"); continue; }
    if (!designs.every((d) => legend.swatches.has(d))) { keep("a design without a matched swatch"); continue; }
    let point = labelPoint(layer.words, e.label);
    // T59 (design D3 a; F-225): a range the page prints as its own tokens ("220-" "237") is placed as it is printed.
    if (!point.own && isRangeLabel(e.label)) point = rangeLabelPoint(layer.words, e.label);
    if (!point.own) { keep(point.why); continue; }
    const ev = colourEvidence(point, feet, layer.pixels, legend.swatches);
    const present = ev.present.map((x) => x.design);
    if (isPlain) {
      if (present.includes(e.category)) { rows.push({ ...row, verdict: "confirmed", source: ev.source, present: ev.present }); index.push(e); continue; }
      if (!present.length) { rows.push({ ...row, verdict: "unchecked", why: "no key colour at the label", present: [] }); index.push(e); continue; }
      const disclosed = [e.category, present[0]];
      rows.push({ ...row, verdict: "flagged", source: ev.source, present: ev.present, disclosed });
      index.push({ label: e.label, category: null, conflict: disclosed, kind: "colour" });
      continue;
    }
    const here = e.conflict.filter((d) => present.includes(d));
    if (here.length === 1) {
      rows.push({ ...row, verdict: "resolved", resolvedTo: here[0], source: ev.source, present: ev.present });
      index.push({ label: e.label, category: here[0], conflict: null });
    } else {
      rows.push({ ...row, verdict: "left", resolvedTo: null, source: ev.source, present: ev.present });
      index.push(e);
    }
  }
  const { counts, conflicts } = recount(index);
  const by = (v) => rows.filter((r) => r.verdict === v);
  const unchecked = {};
  for (const r of by("unchecked")) unchecked[r.why] = (unchecked[r.why] || 0) + 1;
  const audit = {
    ran: true,
    why: null,
    swatches: legend.swatches.size,
    matched: [...legend.swatches.keys()],
    legend: legend.audit,
    // T60 (design D2 a): each matched name's legend text ("" when the legend prints the name alone, null when unread).
    legendText: Object.fromEntries([...legend.swatches].map(([n, s]) => [n, legendTextOf(s.block, n)])),
    footprints: feet.length,
    checked: rows.length - by("unchecked").length,
    confirmed: by("confirmed").length,
    flagged: by("flagged").map((r) => r.label),
    settled: by("resolved").map((r) => r.label),
    left: by("left").map((r) => r.label),
    unchecked,
    rows,
  };
  return { merged: { ...merged, index, counts, conflicts }, audit };
}

/**
 * 6. T61 (design §2, D1 a, D3 a): the THREE-CUE SETTLE over the check's merge (`colourCheck(...).merged`); `key` and
 * `layer` as the check's. Per entry — a plain reading, or a disagreement (tiles or colour) — whose every design has a
 * matched swatch, at a label with one cluster that holds a bay, and with no image under it (no swatch fill on
 * ≥ PIXEL_SHARE of the label's pixels): R1 the nearest footprint (box ≥ MIN_AREA_PT2) to the label's own occurrence, R2
 * the nearest house-sized one (box ≥ ASSOCIATION.MIN_HOUSE_PT2), R3 the nearest footprint to a bay (the label's
 * smaller-font occurrences in its cluster) — each only within ASSOCIATION.CAP_PT. When all three name one design, a plain
 * reading becomes it and a disagreement holding it is resolved to it: a plain entry (T45 D6's shape). A range label, a
 * multi-valued label and everything else stay as the check wrote them. Returns { merged, audit: { ran, why, settled:
 * [{ label, from, to, was: "plain" | "colour" | "tiles" }], rows } }, the COUNTS and CONFLICTS recounted as the check's.
 */
function associationSettle(merged, { key = [], layer = null } = {}) {
  const none = (why) => ({ merged, audit: { ran: false, why, settled: [], rows: [] } });
  if (!merged || !Array.isArray(merged.index)) return none("no merged index");
  if (!keyNamesColour(key)) return none("no key entry names a colour");
  if (!layer || !Array.isArray(layer.words) || layer.words.length === 0 || !Array.isArray(layer.paths)) return none("no colour layer");
  const legend = legendSwatches(key, layer.words, layer.paths);
  if (legend.swatches.size === 0) return none("no swatch matched");
  const C = COLOUR_CHECK;
  const A = ASSOCIATION;
  const feet = colourFootprints(layer.paths, legend.swatches);
  const ws = layer.words.map(word);
  const centre = (o) => ({ x: (o.x0 + o.x1) / 2, y: (o.y0 + o.y1) / 2 });
  // The design of the nearest footprint (box ≥ minArea) to any of the points, only within the cap; null when none is.
  const nearest = (points, minArea) => {
    let best = null;
    for (const f of feet) {
      if (f.area < minArea) continue;
      for (const p of points) {
        const d = footprintDistance(p.x, p.y, f);
        if (d <= A.CAP_PT && (!best || d < best.d)) best = { design: f.design, d };
      }
    }
    return best ? best.design : null;
  };
  const settled = [];
  const rows = [];
  const index = merged.index.map((e) => {
    const isPlain = e.conflict == null && typeof e.category === "string";
    const isDisagreement = Array.isArray(e.conflict) && e.kind !== "one tile, two categories";
    if ((!isPlain && !isDisagreement) || isRangeLabel(e.label)) return e;
    if (!(isPlain ? [e.category] : e.conflict).every((d) => legend.swatches.has(d))) { rows.push({ label: e.label, why: "a design without a matched swatch" }); return e; }
    const point = labelPoint(layer.words, e.label);
    if (!point.own) { rows.push({ label: e.label, why: point.why }); return e; }
    const own = point.own.map(centre);
    const top = Math.max(...point.own.map((o) => o.size));
    const bays = ws.filter((w) => w && w.text.trim() === e.label && w.size > 0 && w.size < top).map(centre).filter((b) => own.some((o) => Math.hypot(o.x - b.x, o.y - b.y) <= LABEL_CLUSTER_HALF_PT));
    if (!bays.length) { rows.push({ label: e.label, why: "no bay" }); return e; }
    const px = labelPixels(point, layer.pixels, legend.swatches);
    if (px && px.n > 0 && [...px.tally.values()].some((c) => c / px.n >= C.PIXEL_SHARE)) { rows.push({ label: e.label, why: "an image under the label" }); return e; }
    const r1 = nearest(own, C.MIN_AREA_PT2);
    const r2 = nearest(own, A.MIN_HOUSE_PT2);
    const r3 = nearest(bays, C.MIN_AREA_PT2);
    const agreed = r1 && r1 === r2 && r2 === r3 ? r1 : null;
    rows.push({ label: e.label, r1, r2, r3, agreed });
    if (!agreed) return e;
    if (isPlain) {
      if (agreed === e.category) return e;
      settled.push({ label: e.label, from: e.category, to: agreed, was: "plain" });
      return { label: e.label, category: agreed, conflict: null };
    }
    if (!e.conflict.includes(agreed)) return e;
    settled.push({ label: e.label, from: e.conflict.join(" or "), to: agreed, was: e.kind === "colour" ? "colour" : "tiles" });
    return { label: e.label, category: agreed, conflict: null };
  });
  const { counts, conflicts } = recount(index);
  return { merged: { ...merged, index, counts, conflicts }, audit: { ran: true, why: null, settled, rows } };
}

module.exports = {
  COLOUR_CHECK,
  ASSOCIATION,
  COLOUR_WORDS,
  namesColour,
  keyNamesColour,
  legendSwatches,
  legendTextOf,
  colourFootprints,
  footprintDistance,
  labelPoint,
  rangeLabelPoint,
  colourEvidence,
  colourCheck,
  associationSettle,
};
