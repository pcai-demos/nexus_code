/**
 * Detail passes for dense pages — ticket T33 (the multi-modal workshop
 * charter's D12; design `inputs/rag-audit/t33-design.md`, D1–D12).
 *
 * Pure module: no I/O, no framework, no require at all — it is meant to be
 * transportable (owner direction, T09 D7) and is what `config.js` / `ids.js`
 * read the mode vocabulary from (so it must stay free of `fs` / `crypto`:
 * `config.js` is bundled into the page). The parser (`parser.js`) and the
 * captioner (`vlm_captioner.js`) do the I/O; the bridge (`docling_bridge.py`)
 * renders the tiles. Everything here is pinned by U-DETAIL against the
 * design probe's records (`tests/eval/baselines/t33-artifacts/probes/records/`)
 * and the caption census (`…/t33-artifacts/census/`).
 *
 * What a detail pass is (design §2): a page whose caption ADMITS that its
 * detail did not fit into text is cut into tiles (a 2×2 grid, a 10 % overlap,
 * rendered from the PDF at scale 3.5 — D2) and read in two stages by the
 * shipped captioner (D3): a KEY pass over the whole page (the legend's
 * `attribute | name` lines) and an INDEX pass per tile with the key supplied
 * as text (`label | category`); the tiles are merged IN CODE (D4: labels
 * de-duplicated across the overlaps, a disagreement DISCLOSED as a conflict,
 * counts per category computed, never asked of the model) into ONE more
 * `isVisualElement` chunk per page (D5), memoised like a caption (D8).
 *
 * The trigger (D1, option B + E — the owner's decision, §12c): under
 * `detailPasses: "auto"` a page fires on the captioner's OWN ADMISSIONS —
 * the caption names a legend / colour-coding / hatching / symbol key in its
 * header or DESCRIPTION (the mapping is carried by a visual attribute), it
 * wrote `[illegible]` (text too small for the page read), or it wrote the
 * overflow marker (more rows than one pass holds) — plus TYPE `map or plan`.
 * Never a list of document kinds ("map", "site plan" — the first draft the
 * owner sent back), never a per-document prompt (§12b). Under `"all"` every
 * captioned page fires; under `"off"` none. The rule reads the caption
 * because the caption is the one perception the pipeline already paid for.
 *
 * T45 (design `inputs/rag-audit/t45-design.md`, D1 a, D2, D5–D7, D11; F-175, F-187, F-188): the TILE-EDGE RULE
 * before the merge — the page's text layer knows where every label is (the bridge's `--tiles` reply carries its word
 * boxes), so a tile votes on a label only when it holds a whole cluster of the label's occurrences; a read of a label
 * beyond the tile's edge (the top-left tile's "301 | The Denby": it read the plot's parking-bay label beside a
 * neighbour's house) is dropped and the holding tile's read stands as a plain entry that counts. No model is asked:
 * every closer read the design probe measured settled some conflicts WRONGLY (§0e). What remains conflicted is
 * disclosed as before, and a same-tile multi-value (Miele p68's matrix rows) is named apart from a disagreement.
 */

/** The three values of the `detailPasses` setting (config.js's table; ids.js's fingerprint). */
const DETAIL_PASS_MODES = Object.freeze(["auto", "all", "off"]);
const DETAIL_PASS_DEFAULT = "auto";

/** The tile geometry (D2) — constants, not settings: t33-design §0b measured them. */
const DETAIL_GRID = Object.freeze([2, 2]);
const DETAIL_OVERLAP = 0.1;
const DETAIL_RENDER_SCALE = 3.5;

/** A `transcribe` merge longer than this is split at line boundaries into numbered parts (D5). */
const DETAIL_MAX_CHARS = 12000;

const DETAIL_KINDS = Object.freeze(["keyed-index", "transcribe"]);

/** The reason vocabulary a plan carries (the ingest views name it beside the page). */
const DETAIL_REASONS = Object.freeze(["map or plan", "legend", "illegible", "overflow", "all"]);

/**
 * The first admission (D1): the caption names a mapping carried by a visual
 * attribute. Looked for in the header (TITLE, SUBJECTS) and the DESCRIPTION,
 * never in the TRANSCRIPTION. Calibrated on the 2026-09-16 census of 228
 * captions: `legend` is the captioner's word for it (the Site Plan's seven
 * pages, SaxonFields' floor plan, SSX125's screw-symbol boxes, Miele's
 * numbered diagrams, Fervi's part legend); `colour-coded` the Site Plan's
 * map; `hatching` two Fervi cross-sections; a symbol key is named with a
 * verb ("the symbols denote / define …"). A bare `key` (an Allen key, a
 * ZERO key, "Key Statistics", a safety key), `icon` (a Wi-Fi symbol on a
 * screenshot) or `symbol` (a hazard symbol on a photo) is NOT an admission —
 * the census shows each of those on pages whose detail the caption holds.
 */
const DETAIL_TRIGGER_WORDS = Object.freeze({
  legend: /\blegend\b/i,
  colourCoding: /\bcolou?r[- ]?(?:cod(?:ed|ing)|key(?:ed)?)\b/i,
  hatching: /\bhatch(?:ed|ing)\b/i,
  symbolKey: /\bsymbol key\b|\bkey (?:to|of) (?:the )?symbols\b|\bsymbols? (?:denotes?|defines?|represents?|identif(?:y|ies)|indicates?)\b/i,
});

/** The second and third admissions: what the T32 prompts make the captioner write (t32-design D2). */
const ILLEGIBLE_MARK = /\[illegible\]/i;
const OVERFLOW_MARK = /\[more (?:rows )?not transcribed\b/i;

/** `auto` / `all` / `off` (trimmed, case-insensitive); anything else is the default. */
function normaliseDetailMode(value) {
  if (typeof value !== "string") return DETAIL_PASS_DEFAULT;
  const v = value.trim().toLowerCase();
  return DETAIL_PASS_MODES.includes(v) ? v : DETAIL_PASS_DEFAULT;
}

/**
 * The caption's sections, by the parser's own header rules (T32 D3: the
 * generic labels TITLE / TYPE / SUBJECTS at a line start, the legacy
 * HUMAN TITLE / DIAGRAM TYPE / KEY SUBJECTS still accepted) — the
 * TRANSCRIPTION and DESCRIPTION bodies by their labels.
 */
function parseCaptionSections(caption) {
  const text = typeof caption === "string" ? caption : "";
  const line = (label) => {
    const m = text.match(new RegExp(`^(?:HUMAN |DIAGRAM |KEY )?${label}:\\s*(.+)$`, "im"));
    return m ? m[1].trim() : null;
  };
  const body = (label) => {
    const m = text.match(new RegExp(`^${label}:\\s*$([\\s\\S]*?)(?=^(?:TRANSCRIPTION|DESCRIPTION):\\s*$|$(?![\\s\\S]))`, "m"));
    return m ? m[1].trim() : "";
  };
  return { title: line("TITLE"), type: line("TYPE"), subjects: line("SUBJECTS"), transcription: body("TRANSCRIPTION"), description: body("DESCRIPTION") };
}

/**
 * The parser's leading-value rule for the one TYPE this module keys on: a
 * TYPE line that STARTS with `map or plan` (the model's primary answer; a
 * `mixed (map + photo)` line is `mixed`). The parser passes the normalised
 * `visualType` itself; this is for a caller that has only the caption.
 */
function typeLineIsMapOrPlan(typeLine) {
  if (typeof typeLine !== "string") return false;
  return /^map or plan(?:[^a-z]|$)/i.test(typeLine.trim().toLowerCase().replace(/^[\s*_`"']+/, ""));
}

/** The trigger word that matched, or null. */
function admissionIn(text) {
  const t = typeof text === "string" ? text : "";
  for (const [name, re] of Object.entries(DETAIL_TRIGGER_WORDS)) {
    const m = t.match(re);
    if (m) return { word: name, matched: m[0] };
  }
  return null;
}

/**
 * The trigger (D1). Returns null (no closer look) or a plan
 *   { kind: "keyed-index" | "transcribe", reason, reasons, matched, mode }
 * `reason` is the first of `reasons` in this order: "map or plan", "legend"
 * (any of the four phrase families), "illegible", "overflow" — or "all"
 * under that mode. A keyed-index plan whose KEY pass answers NONE is
 * downgraded to `transcribe` by the parser (a map with no legend is still a
 * map of labels). Pure: a caption in, a verdict out.
 */
function detailPlanFor({ caption, visualType, title, subjects, description, transcription, mode, ocr = false } = {}) {
  const m = normaliseDetailMode(mode);
  if (m === "off") return null;
  const s = parseCaptionSections(caption);
  const header = [title ?? s.title, subjects ?? s.subjects].filter((v) => typeof v === "string" && v).join(" | ");
  const desc = typeof description === "string" ? description : s.description;
  const tr = typeof transcription === "string" ? transcription : s.transcription;
  const mapOrPlan = visualType !== undefined ? visualType === "map or plan" : typeLineIsMapOrPlan(s.type);
  const admission = admissionIn(header) || admissionIn(desc);
  const illegible = ILLEGIBLE_MARK.test(tr) || (typeof caption === "string" && ILLEGIBLE_MARK.test(caption));
  const overflow = OVERFLOW_MARK.test(tr) || (typeof caption === "string" && OVERFLOW_MARK.test(caption));
  const reasons = [];
  if (mapOrPlan) reasons.push("map or plan");
  if (admission) reasons.push("legend");
  if (illegible) reasons.push("illegible");
  if (overflow) reasons.push("overflow");
  if (m === "all") return { kind: "keyed-index", reason: reasons[0] || "all", reasons: reasons.length ? reasons : ["all"], matched: admission ? admission.matched : null, mode: m };
  if (reasons.length === 0) return null;
  const kind = mapOrPlan || admission ? "keyed-index" : "transcribe";
  // T35 (t35-design D8): a page OCR read has its text at the page's own resolution, without tile fragments — the
  // transcribe plan (the caption's `[illegible]` / overflow admissions) is not taken on it; the keyed-index plan (a
  // mapping OCR cannot make) still is. `all` is unaffected (it is always a keyed-index plan).
  if (ocr === true && kind === "transcribe") return null;
  return { kind, reason: reasons[0], reasons, matched: admission ? admission.matched : null, mode: m };
}

/**
 * The tile geometry (D2): a rows×cols grid over a page of `pageSize`
 * = [width, height] (points for a PDF page, pixels for a picture), each
 * tile widened by `overlap` × the page's size on every inner edge. Each
 * tile carries its box from the page's TOP-left (`x0, y0, x1, y1`) and the
 * `cropPt` pypdfium2's `render(crop=…)` takes — the amounts to cut off
 * (left, bottom, right, top) with PDF y running upward — exactly the design
 * probe's arithmetic (U-DETAIL pins it against the probe's recorded crops).
 */
function tilePlan(pageSize, { grid = DETAIL_GRID, overlap = DETAIL_OVERLAP } = {}) {
  const w = Number(pageSize && pageSize[0]);
  const h = Number(pageSize && pageSize[1]);
  if (!(w > 0) || !(h > 0)) throw new Error(`tilePlan: a positive page size is required, got ${JSON.stringify(pageSize)}`);
  const rows = Number(grid && grid[0]);
  const cols = Number(grid && grid[1]);
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) throw new Error(`tilePlan: grid must be [rows, cols] of positive integers, got ${JSON.stringify(grid)}`);
  const ov = Number.isFinite(overlap) && overlap >= 0 ? overlap : 0;
  const ovx = w * ov;
  const ovy = h * ov;
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.max(0, (c * w) / cols - ovx);
      const x1 = Math.min(w, ((c + 1) * w) / cols + ovx);
      const y0 = Math.max(0, (r * h) / rows - ovy);
      const y1 = Math.min(h, ((r + 1) * h) / rows + ovy);
      tiles.push({ tile: `r${r}c${c}`, row: r, col: c, x0, y0, x1, y1, cropPt: [x0, h - y1, w - x1, y0] });
    }
  }
  return tiles;
}

/**
 * `a | b` lines → [[a, b], …]. Bullets and markdown emphasis are tolerated;
 * NONE and blank lines are skipped; a line without a bar is not a pair.
 */
function parsePairs(text) {
  const pairs = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    // Bullets only: a label IS often a number ("219 | …"), so digits are never stripped.
    let line = raw.trim().replace(/^[-*•\s]+/, "").replace(/[-*•\s]+$/, "");
    if (!line || /^none\.?$/i.test(line.replace(/^[*_`]+|[*_`]+$/g, ""))) continue;
    const at = line.indexOf("|");
    if (at < 0) continue;
    const a = line.slice(0, at).trim().replace(/^[*_`]+|[*_`]+$/g, "").replace(/\s+/g, " ").trim();
    const b = line.slice(at + 1).trim().replace(/^[*_`]+|[*_`.]+$/g, "").replace(/\s+/g, " ").trim();
    if (!a || !b) continue;
    pairs.push([a, b]);
  }
  return pairs;
}

/** The KEY reply → [{ attribute, name }] (empty for NONE or no pairs). */
function parseKey(text) {
  return parsePairs(text).map(([attribute, name]) => ({ attribute, name }));
}

/** The key as the INDEX prompt embeds it — one `attribute | name` line per entry. */
function keyText(entries) {
  return (Array.isArray(entries) ? entries : []).map((e) => `${e.attribute} | ${e.name}`).join("\n");
}

/** Is the reply the model's "nothing here" verdict? */
function isNoneReply(text) {
  return /^[\s*_`]*none[\s*_`.]*$/i.test(String(text || ""));
}

const canon = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Numeric labels ascending (a range by its first number), then the rest alphabetically. */
function labelOrder(a, b) {
  const na = String(a).match(/^\d+/);
  const nb = String(b).match(/^\d+/);
  if (na && nb) {
    const d = Number(na[0]) - Number(nb[0]);
    return d !== 0 ? d : String(a).localeCompare(String(b));
  }
  if (na) return -1;
  if (nb) return 1;
  return String(a).localeCompare(String(b));
}

/**
 * T59 (design D4; F-222): a RANGE label — exactly two whole numbers joined by a dash, the first the smaller ("220 - 237";
 * "220-237"; an en dash too). A part number ("C-00105-018") or a name ("ECO 40-60") never is: on production's 36 detail
 * chunks only the Site Plan's labels are (t59-design §0b).
 */
const RANGE_LABEL = /^(\d+)\s*[-–—]\s*(\d+)$/;

/** A label's numbers: a whole number → { a, b: a, range: false }; a range "N - M" (N < M) → { a: N, b: M, range: true }; else null. */
function labelSpan(label) {
  const s = String(label == null ? "" : label).trim();
  if (/^\d+$/.test(s)) return { a: Number(s), b: Number(s), range: false };
  const m = RANGE_LABEL.exec(s);
  if (m && Number(m[1]) < Number(m[2])) return { a: Number(m[1]), b: Number(m[2]), range: true };
  return null;
}

/** Is this label a range ("220 - 237")? */
function isRangeLabel(label) {
  const s = labelSpan(label);
  return !!(s && s.range);
}

/**
 * T45 (design §2.2, D2, D12): the geometry the tile-edge rule reads — constants, not settings.
 *   LABEL_CLUSTER_HALF_PT  a label's occurrences within this distance of each other (points, centre to centre, single
 *                          linkage) are ONE cluster: the Site Plan's plot label and its two parking-bay labels span
 *                          ≤ 27 pt; SSX125's repeated screw sizes lie 200–480 pt apart and are several.
 *   LINE_BASELINE_TOL / LINE_GAP_MAX  two consecutive words are on one line when their baselines agree within 0.3 × the
 *                          height and the gap between them is under 1.5 × the height — a multi-word label is matched
 *                          as such a run, whole tokens only ("6" never matches inside "M3x6mm").
 */
const LABEL_CLUSTER_HALF_PT = 40;
const LINE_BASELINE_TOL = 0.3;
const LINE_GAP_MAX = 1.5;

/** A word box as the bridge emits it ({ text, x0, y0, x1, y1 } in points from the page's top-left), or null. */
function wordBox(w) {
  if (!w || typeof w.text !== "string") return null;
  const b = [w.x0, w.y0, w.x1, w.y1].map(Number);
  if (!b.every(Number.isFinite) || b[2] < b[0] || b[3] < b[1]) return null;
  const text = w.text.trim();
  if (!text) return null;
  return { text, x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
}

/** Do two consecutive words sit on one line — the same baseline (within the tolerance) and a small gap? */
function sameLine(a, b) {
  const h = Math.max(a.y1 - a.y0, b.y1 - b.y0, 1e-6);
  const gap = b.x0 - a.x1;
  return Math.abs(a.y1 - b.y1) <= LINE_BASELINE_TOL * h && gap < LINE_GAP_MAX * h && gap > -h;
}

const boxUnion = (boxes) => ({ x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) });
const boxInside = (box, tile) => box.x0 >= tile.x0 && box.x1 <= tile.x1 && box.y0 >= tile.y0 && box.y1 <= tile.y1;
const centreDistance = (a, b) => Math.hypot((a.x0 + a.x1 - b.x0 - b.x1) / 2, (a.y0 + a.y1 - b.y0 - b.y1) / 2);

/**
 * T45 (design §2.2): a label's occurrences in the page's text layer — every run of consecutive words on one line whose
 * words equal the label's (whole tokens only), grouped into clusters by single linkage within `half` points. Each
 * cluster carries its occurrences (their boxes) and their union box. The Site Plan's plot numbers are one cluster
 * each (the plot label and its two rotated parking-bay labels — the rule is the WHOLE cluster, never "the first" or
 * "the largest" occurrence: the tallest-box rule picked the bays, t45-design §0c — it measured the box's height, which a
 * rotated bay label wins; T57's colour check picks the plot's own label by pdfium's font size instead, 3.33 against
 * 2.22 pt, colour_check.js labelPoint); SSX125's screw sizes are several.
 * [] when the label does not occur (a printed range "220 - 237" the text layer holds as other tokens, a symbol): the
 * rule then keeps every vote.
 */
function labelClusters(textBoxes, label, { half = LABEL_CLUSTER_HALF_PT } = {}) {
  const tokens = String(label == null ? "" : label).trim().split(/\s+/).filter(Boolean);
  const words = (Array.isArray(textBoxes) ? textBoxes : []).map(wordBox).filter(Boolean);
  if (tokens.length === 0 || words.length < tokens.length) return [];
  const occurrences = [];
  for (let i = 0; i + tokens.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < tokens.length && ok; k++) {
      if (words[i + k].text !== tokens[k]) ok = false;
      else if (k > 0 && !sameLine(words[i + k - 1], words[i + k])) ok = false;
    }
    if (ok) occurrences.push(boxUnion(words.slice(i, i + tokens.length)));
  }
  const parent = occurrences.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < occurrences.length; i++) for (let j = i + 1; j < occurrences.length; j++) if (centreDistance(occurrences[i], occurrences[j]) <= half) parent[find(i)] = find(j);
  const groups = new Map();
  occurrences.forEach((o, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(o); });
  return [...groups.values()].map((occ) => ({ occurrences: occ, box: boxUnion(occ) })).sort((a, b) => a.box.x0 - b.box.x0 || a.box.y0 - b.box.y0);
}

/**
 * T45 (design §2.2, D2, D5 a — the tile-edge rule): a tile's `label | category` read is DROPPED when the label has
 * occurrences in the text layer, some tile holds a whole cluster of them, the reading tile holds none — it saw no
 * complete instance (r0c0's "301 | The Denby" read the plot's parking-bay label beside a neighbour's crimson house;
 * the plot label lies beyond its edge, §0c) — AND a holder tile also read the label, in any category (F-191 D1 b, the
 * corroborated drop). A label with no occurrence keeps every vote; so does a label no tile holds whole (the rule needs
 * a holder to act, §7 risk 1); so does a read from a tile the plan does not name; so does a read no holder tile made
 * (F-191: Fervi p20's only whole "1" is the prose's "ref. 1 in Figure 2", held by r1c0, which read nothing — r0c0's
 * `1 | Gearbox guard (fixed)` is the drawing's callout and stands; the Site Plan's seven drops are all corroborated).
 *   reads      [{ tile, label, category }]        tiles   tilePlan's [{ tile, x0, y0, x1, y1 }]
 *   textBoxes  the bridge's words ({ text, x0, y0, x1, y1 })
 * Returns { kept, edgeDropped: [{ tile, label, category }], unpositioned: [the labels with no occurrence] }.
 */
function tileVotes(reads, tiles, textBoxes, { half = LABEL_CLUSTER_HALF_PT } = {}) {
  const list = Array.isArray(reads) ? reads : [];
  const boxes = new Map();
  for (const t of Array.isArray(tiles) ? tiles : []) if (t && t.tile) boxes.set(t.tile, t);
  if (boxes.size === 0 || !Array.isArray(textBoxes) || textBoxes.length === 0) return { kept: list.slice(), edgeDropped: [], unpositioned: [] };
  const holdersOf = new Map();
  const unpositioned = [];
  for (const label of new Set(list.map((r) => r.label))) {
    const clusters = labelClusters(textBoxes, label, { half });
    if (clusters.length === 0) { holdersOf.set(label, null); unpositioned.push(label); continue; }
    const holders = new Set();
    for (const [name, t] of boxes) if (clusters.some((c) => boxInside(c.box, t))) holders.add(name);
    holdersOf.set(label, holders.size ? holders : null);
  }
  const readBy = new Map(); // label → the tiles that read it (F-191: a drop needs a holder among them)
  for (const r of list) { if (!readBy.has(r.label)) readBy.set(r.label, new Set()); readBy.get(r.label).add(r.tile); }
  const kept = [];
  const edgeDropped = [];
  for (const r of list) {
    const holders = holdersOf.get(r.label);
    const corroborated = holders ? [...readBy.get(r.label)].some((t) => holders.has(t)) : false;
    if (holders && boxes.has(r.tile) && !holders.has(r.tile) && corroborated) edgeDropped.push({ tile: r.tile, label: r.label, category: r.category });
    else kept.push(r);
  }
  return { kept, edgeDropped, unpositioned };
}

/**
 * T45 (design §2.3): mergeTiles's geometry option from the bridge's --tiles reply — the tile plan over the page's size
 * (a PDF page's points, `pagePt`; a docling picture's pixels, `px`) and the text layer's word boxes (`textBoxes`).
 * {} — no geometry, the merge as before T45 — when the reply carries no words (a scan, a picture, a page without a
 * text layer) or no usable page size.
 */
function detailGeometry(tilesInfo) {
  if (!tilesInfo || typeof tilesInfo !== "object") return {};
  const textBoxes = Array.isArray(tilesInfo.textBoxes) ? tilesInfo.textBoxes : null;
  if (!textBoxes || textBoxes.length === 0) return {};
  const pageSize = Array.isArray(tilesInfo.pagePt) ? tilesInfo.pagePt : tilesInfo.px;
  try {
    const grid = Array.isArray(tilesInfo.grid) && tilesInfo.grid.length === 2 ? tilesInfo.grid : DETAIL_GRID;
    const overlap = Number.isFinite(tilesInfo.overlap) ? tilesInfo.overlap : DETAIL_OVERLAP;
    return { tilePlan: tilePlan(pageSize, { grid, overlap }), textBoxes };
  } catch (err) {
    return {};
  }
}

/**
 * T45 (design §2.2, D11; F-188): a conflicted label's kind — "tiles disagree" (two tiles, different categories) or
 * "one tile, two categories" (every tile that read the label gave the SAME set of categories, and a tile gave two:
 * Miele p68's matrix rows, listed twice by one tile with two ✓ columns — not a disagreement).
 */
function conflictKind(cats) {
  const byTile = new Map();
  for (const [cc, c] of cats) for (const t of c.tiles) { const k = t == null ? "" : String(t); if (!byTile.has(k)) byTile.set(k, new Set()); byTile.get(k).add(cc); }
  const all = [...cats.keys()].sort().join("\u0000");
  const sets = [...byTile.values()];
  const multi = sets.some((s) => s.size > 1);
  const same = sets.every((s) => [...s].sort().join("\u0000") === all);
  return multi && same ? "one tile, two categories" : "tiles disagree";
}

/**
 * The merge (D4). `tiles` = [{ tile, response }] (the INDEX replies in tile
 * order); `key` the KEY entries (a category spelled like a key entry is
 * snapped to the key's spelling — the tiles copy the key, but a stray
 * article or case difference must not make two categories of one).
 *   index      every label once: { label, category, conflict } — `conflict`
 *              lists the categories when tiles disagreed (D4: kept, never
 *              resolved by a coin; the probe's majority rule picked
 *              arbitrarily on 7 of 131)
 *   counts     per category from the UNANIMOUS labels only, never asked of
 *              the model: { category, n, labels }
 *   conflicts  { label, categories: [..] } — the labels read as two categories
 *   unknown    the labels whose fill matched no key entry (the prompt's UNKNOWN)
 *   legendEchoes  the pairs whose LABEL is a key entry's own name or attribute
 *              — a tile that holds the legend box lists its rows as if they
 *              were labelled elements ("The Kingsville | The Kingsville",
 *              "BCP | Bin Collection Point"; the first live pass, t33-design
 *              §11a A15). An element cannot be labelled by its own category,
 *              so the pair is the legend echoed, not the page: dropped from
 *              the index and the counts, counted here.
 * T45 (design §2.2): with the geometry given — `{ key, tilePlan, textBoxes }` — the tile-edge rule (`tileVotes`)
 * runs FIRST; a caller without it merges every read, byte for byte as before T45. Then:
 *   conflicts    the disagreements that remain — { label, categories, kind: "tiles disagree" }
 *   multiValued  a label one tile listed with two categories (every tile agreeing on the set) — kind
 *                "one tile, two categories" (F-188); named apart in the chunk text (D11), counted for nobody (D7)
 *   edgeDropped  the votes the rule dropped [{ tile, label, category }]; edgeSettled the labels whose conflict
 *                disappeared with them (301, 303 on the Site Plan: the holding tile's read stands as a plain entry
 *                that counts — D6 / D7); edgeLost the labels that lost every vote; unpositioned the labels with no
 *                occurrence in the text layer (every vote kept); geometry whether the rule ran.
 */
function mergeTiles(tiles, { key = [], tilePlan: plan = null, textBoxes = null } = {}) {
  const keyNames = new Map();
  const keyWords = new Set();
  for (const e of Array.isArray(key) ? key : []) {
    if (e && e.name) { keyNames.set(canon(e.name), e.name); keyWords.add(canon(e.name)); }
    if (e && e.attribute) keyWords.add(canon(e.attribute));
  }
  const spelling = new Map(keyNames);
  const reads = []; // every pair read, in tile order: { tile, label, category (the key's spelling), cc }
  let pairs = 0;
  let tilesRead = 0;
  let tilesEmpty = 0;
  let legendEchoes = 0;
  for (const t of Array.isArray(tiles) ? tiles : []) {
    const name = typeof t === "string" ? null : t && t.tile;
    const reply = typeof t === "string" ? t : t && t.response;
    const list = parsePairs(reply);
    // A NONE or blank reply is an empty tile; a reply with lines but no pairs was read (and yielded nothing).
    if (list.length === 0) { if (isNoneReply(reply) || !String(reply || "").trim()) tilesEmpty++; else tilesRead++; } else tilesRead++;
    for (const [label, rawCategory] of list) {
      pairs++;
      if (keyWords.size && keyWords.has(canon(label))) { legendEchoes++; continue; }
      const cc = canon(rawCategory);
      if (!spelling.has(cc)) spelling.set(cc, rawCategory);
      reads.push({ tile: name, label, category: spelling.get(cc), cc });
    }
  }
  // T45 (design §2.2, D5 a): the tile-edge rule BEFORE the merge when the geometry is given — a caller without it
  // merges every read, byte for byte as before T45.
  const geometry = Array.isArray(plan) && plan.length > 0 && Array.isArray(textBoxes) && textBoxes.length > 0;
  const votes = geometry ? tileVotes(reads, plan, textBoxes) : { kept: reads, edgeDropped: [], unpositioned: [] };
  const group = (rs) => {
    const m = new Map(); // label → Map(canonical category → { category, tiles: [..] })
    for (const r of rs) {
      if (!m.has(r.label)) m.set(r.label, new Map());
      const cats = m.get(r.label);
      if (!cats.has(r.cc)) cats.set(r.cc, { category: r.category, tiles: [] });
      cats.get(r.cc).tiles.push(r.tile);
    }
    return m;
  };
  const seen = group(votes.kept);
  let edgeSettled = [];
  let edgeLost = [];
  if (votes.edgeDropped.length) {
    const before = group(reads);
    const wereConflicts = [...before.entries()].filter(([, cats]) => cats.size > 1).map(([label]) => label);
    edgeSettled = wereConflicts.filter((l) => seen.has(l) && seen.get(l).size === 1).sort(labelOrder);
    edgeLost = [...before.keys()].filter((l) => !seen.has(l)).sort(labelOrder);
  }
  const labels = [...seen.keys()].sort(labelOrder);
  const index = [];
  const conflicts = [];
  const multiValued = [];
  const unknown = [];
  const perCategory = new Map();
  for (const label of labels) {
    const cats = [...seen.get(label).values()];
    if (cats.length > 1) {
      const categories = cats.map((c) => c.category);
      const kind = conflictKind(seen.get(label));
      index.push({ label, category: null, conflict: categories, kind });
      (kind === "one tile, two categories" ? multiValued : conflicts).push({ label, categories, kind });
      continue;
    }
    const category = cats[0].category;
    index.push({ label, category, conflict: null });
    if (canon(category) === "unknown") { unknown.push(label); continue; }
    if (!perCategory.has(category)) perCategory.set(category, []);
    perCategory.get(category).push(label);
  }
  const counts = [...perCategory.entries()].map(([category, ls]) => ({ category, n: ls.length, labels: ls.slice().sort(labelOrder) })).sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
  return { index, counts, conflicts, multiValued, unknown, pairs, tilesRead, tilesEmpty, labels: labels.length, legendEchoes, geometry, edgeDropped: votes.edgeDropped, edgeSettled, edgeLost, unpositioned: geometry ? votes.unpositioned.slice().sort(labelOrder) : [] };
}

/**
 * T59 (design D2 a; F-218): a PLAIN index entry (one category — never a conflict, never UNKNOWN) whose numbers all lie
 * inside ANOTHER plain range entry of the same category, strictly wider, is dropped from the index and from its
 * category's count — the wider range still names every one of its numbers, so no number leaves the index. On the Site
 * Plan's page 1 it drops exactly "255 - 256": one tile's reading of the 255 - 266 block's three stacked parking-bay labels
 * (t59-design §0c); the page prints no such range. It runs on the FINAL merge — after the tile-edge rule and the colour
 * check (parser.js) — and returns the SAME object when nothing is subsumed (every merge without a range label); else a
 * copy with the index, the counts (recomputed exactly as mergeTiles computes them) and `labels` updated, and
 * `rangeSubsumed: [{ label, by, category }]` — the audit, metadata only (T45 D6's shape), never chunk text.
 */
function subsumeRanges(merged) {
  if (!merged || !Array.isArray(merged.index)) return merged;
  const plain = merged.index.filter((e) => e && e.conflict == null && typeof e.category === "string" && canon(e.category) !== "unknown");
  const ranges = plain.map((e) => ({ e, s: labelSpan(e.label) })).filter((x) => x.s && x.s.range);
  if (ranges.length === 0) return merged;
  const gone = [];
  for (const e of plain) {
    const s = labelSpan(e.label);
    if (!s) continue;
    const by = ranges.find((r) => r.e !== e && r.e.category === e.category && r.s.a <= s.a && s.b <= r.s.b && r.s.b - r.s.a > s.b - s.a);
    if (by) gone.push({ label: e.label, by: by.e.label, category: e.category });
  }
  if (gone.length === 0) return merged;
  const drop = new Set(gone.map((g) => g.label));
  const index = merged.index.filter((e) => !drop.has(e.label));
  const perCategory = new Map();
  for (const e of index) {
    if (e.conflict != null || typeof e.category !== "string" || canon(e.category) === "unknown") continue;
    if (!perCategory.has(e.category)) perCategory.set(e.category, []);
    perCategory.get(e.category).push(e.label);
  }
  const counts = [...perCategory.entries()].map(([category, ls]) => ({ category, n: ls.length, labels: ls.slice().sort(labelOrder) })).sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
  return { ...merged, index, counts, labels: index.length, rangeSubsumed: gone.sort((a, b) => labelOrder(a.label, b.label)) };
}

/** T34 (F-144): the shortest overlap on which two cut lines are re-joined (characters of the whitespace-collapsed text). */
const DETAIL_JOIN_MIN_CHARS = 12;

/** A tile's grid position from its name (`r0c1`), null for a tile with no position (a string reply). */
function tilePosition(name) {
  const m = /r(\d+)c(\d+)/.exec(String(name || ""));
  return m ? { r: Number(m[1]), c: Number(m[2]) } : null;
}

/** The longest k ≥ min with `left` ending in the first k characters of `right` (case-insensitive), R longer than k; 0 when none. */
function overlapLength(left, right, min) {
  const L = String(left || "").toLowerCase();
  const R = String(right || "").toLowerCase();
  if (L.length !== String(left || "").length || R.length !== String(right || "").length) return 0;
  const max = Math.min(L.length, R.length - 1);
  for (let k = max; k >= min; k--) if (L.endsWith(R.slice(0, k))) return k;
  return 0;
}

/**
 * A `transcribe` merge: every tile's lines in tile order, a line already
 * seen (the overlap zone) dropped, NONE replies skipped. T34 (F-144): a line
 * the tile grid cut — the right tile's line begins with the characters the
 * left tile's line ends with (the overlap zone runs through the line) — is
 * RE-JOINED on that overlap (horizontally adjacent tiles of one tile row, the
 * right tile's lines in reading order, each left line joined once, the
 * longest overlap wins and a table row joins a table row); a line contained
 * whole in a longer kept line is dropped. A fragment with no partner is kept
 * as read — the words are the page's, and dropping them would lose text no
 * other line holds (a table cell wrapped across the cut needs column
 * alignment, which no merge rule has — T35's question).
 */
function mergeTranscriptions(tiles, { minOverlap = DETAIL_JOIN_MIN_CHARS } = {}) {
  const perTile = [];
  let tilesRead = 0;
  let tilesEmpty = 0;
  for (const t of Array.isArray(tiles) ? tiles : []) {
    const reply = typeof t === "string" ? t : t && t.response;
    const name = typeof t === "string" ? null : t && t.tile;
    if (isNoneReply(reply) || !String(reply || "").trim()) { tilesEmpty++; continue; }
    tilesRead++;
    const rows = [];
    for (const raw of String(reply).split(/\r?\n/)) {
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text) continue;
      rows.push({ text, joined: false, folded: false });
    }
    perTile.push({ pos: tilePosition(name), rows });
  }
  // The joins: a right tile's line onto the left neighbour's line it continues.
  let joined = 0;
  for (const right of perTile) {
    if (!right.pos) continue;
    const left = perTile.find((x) => x.pos && x.pos.r === right.pos.r && x.pos.c === right.pos.c - 1);
    if (!left) continue;
    for (const R of right.rows) {
      let best = null;
      for (const L of left.rows) {
        if (L.joined) continue;
        const k = overlapLength(L.text, R.text, minOverlap);
        if (k <= 0) continue;
        const tabular = L.text.includes("|") === R.text.includes("|");
        if (!best || (tabular && !best.tabular) || (tabular === best.tabular && k > best.k)) best = { L, k, tabular };
      }
      if (!best) continue;
      best.L.text = `${best.L.text}${R.text.slice(best.k)}`;
      best.L.joined = true;
      R.folded = true;
      joined++;
    }
  }
  // The lines in tile order, a repeat dropped, then a line contained whole in a longer kept line dropped.
  const kept = [];
  const seen = new Set();
  for (const t of perTile) {
    for (const row of t.rows) {
      if (row.folded) continue;
      const k = canon(row.text);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      kept.push(row.text);
    }
  }
  let contained = 0;
  const lines = [];
  for (const text of kept) {
    const k = canon(text);
    if (kept.some((o) => o !== text && canon(o).length > k.length && canon(o).includes(k))) { contained++; continue; }
    lines.push(text);
  }
  return { lines, tilesRead, tilesEmpty, joined, contained };
}

/** The list the views print: "1" / "1, 7". */
function detailPagesList(pages) {
  return [...new Set((Array.isArray(pages) ? pages : []).filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b).join(", ");
}

/** The header line of a detail chunk (the caption chunk's shape, D5). */
function detailHeader({ title, pageTitle, page }) {
  const t = typeof title === "string" && title.trim() ? title.trim() : `Page ${page}`;
  const s = typeof pageTitle === "string" && pageTitle.trim() ? pageTitle.trim() : `Page ${page}`;
  return `[VISUAL DETAIL: ${t} | Section: ${s} (Page ${page})]:`;
}

/**
 * The chunk text (D5). For a keyed-index plan: KEY, INDEX (a conflicted
 * label as `label | A or B (read differently by two tiles)`), COUNTS (from
 * the unambiguous labels), UNKNOWN when any, CONFLICTS (always — 0 says the
 * tiles agreed), TILES NOT READ when a tile's reply failed. For a
 * transcribe plan: the merged lines under one heading.
 * T45 (design D6, D7, D11): an edge-settled label is a PLAIN entry that counts (the reading that stood is a holding
 * tile's own read; the audit trail is the chunk's metadata and the ledger, never the text — so an answer cannot echo
 * a note about it); a same-tile multi-value reads `label | A; B (two categories read on one tile)` and is listed on a
 * `MULTI-VALUED: n — …` line after CONFLICTS (only when any); CONFLICTS counts the disagreements that remain.
 * T57 (design D1 a, D7 a; colour_check.js): a reading the page's own colour contradicts is a conflict of kind "colour"
 * — `176 | The Kingsville or The Alnmouth (the colour at the label matches The Alnmouth, not The Kingsville)`, the
 * tiles' reading first — listed in the one CONFLICTS line with the tile disagreements; a disagreement the colour
 * settled is a plain entry that counts (its audit is metadata, never text — T45 D6's shape).
 * T58 (design D1 a, D2 a; F-219): the COUNTS rows come from `countsLines` — on a chunk with a conflict each row says
 * what the index supports ("n confirmed", the labels that may also be it); a chunk with no conflict is byte-identical.
 * T60 (design D1 a, D2 a; F-228): after the rows, the LEGEND TEXT block (`legendTextLines`) when the colour check read a
 * legend text shared by two or more rows (`legendText`); the CONFLICTS line says what its labels name when one of them is
 * a range (`conflictsRangeNote`). A chunk with neither is byte-identical.
 */
/**
 * T58 (design D1 a, D2 a; F-219): the COUNTS rows. A conflicted label counts for nobody (T45 D7), so on a chunk that
 * carries a conflict a count is a floor — and an answer stated it as the total ("The Ellerton, which has 11 plots";
 * 15 on the page). With NO conflict: today's rows byte for byte ("Name: n (labels)", or NONE). With a conflict (either
 * kind — tiles disagree, or the colour at the label; a same-tile multi-value is not one, F-188): each confirmed row
 * reads "Name: n confirmed (labels)", with "; possibly also L1, L2 (see CONFLICTS)" when a conflict names the category;
 * then a row for each category named only in conflicts, by name — "Name: 0 confirmed; possibly L1, … (see
 * CONFLICTS)"; an UNKNOWN category is never a row; NONE only when there is no row. The possible labels are the index's
 * (a conflict names its label under each of its categories — three for SSX125 p8's label 8), in label order; the
 * words are the kind's, never a plan's. Measured before the code on production's own messages (t58-design.md §0e):
 * a design's count question 0 of 8 answers right-shaped with today's rows, 8 of 8 with these; the Denby unchanged.
 * T59 (design D1 a; F-222): a row that holds a RANGE says so (`rangeNote`, `possibleRangeNote`); a row without one is
 * byte-identical.
 */
/**
 * T59 (design D1 a; F-222): what a row's RANGE labels are. A range is ONE label however many numbers it names, so a count
 * that holds one says so — "; 1 of the 13 is a range counted as one label — 255 - 266 (12 numbers); a range's category
 * was read once for the range, not for each number" (several: "; k of the n are ranges counted as one label each — A (x
 * numbers) and B (y numbers); …") — and a range among the row's POSSIBLE labels is named with its size: "; 220 - 237 (a
 * range of 18 numbers counted as one label) is among the possible labels". Never an expansion: the count stays a count of
 * labels. The words are the kind's ("labels", "ranges", "numbers", "category"). Measured before the code on production's
 * own messages (t59-design.md §0e, §0g): with these rows and F-225's disclosure every answer said "24 confirmed rented;
 * the 18-plot block 220–237 could be rented or shared ownership" (18 of 18).
 */
const rangeSize = (label) => { const s = labelSpan(label); return s ? s.b - s.a + 1 : 0; };
function rangeNote(labels, n) {
  const rs = (Array.isArray(labels) ? labels : []).filter(isRangeLabel).map((r) => `${r} (${rangeSize(r)} numbers)`);
  if (rs.length === 0) return "";
  const list = rs.length === 1 ? rs[0] : `${rs.slice(0, -1).join(", ")} and ${rs[rs.length - 1]}`;
  const tail = "a range's category was read once for the range, not for each number";
  return rs.length === 1 ? `; 1 of the ${n} is a range counted as one label — ${list}; ${tail}` : `; ${rs.length} of the ${n} are ranges counted as one label each — ${list}; ${tail}`;
}
function possibleRangeNote(labels) {
  return (Array.isArray(labels) ? labels : []).filter(isRangeLabel).map((r) => `; ${r} (a range of ${rangeSize(r)} numbers counted as one label) is among the possible labels`).join("");
}
function countsLines(merged) {
  const counts = merged && Array.isArray(merged.counts) ? merged.counts : [];
  const conflicts = (merged && Array.isArray(merged.conflicts) ? merged.conflicts : []).filter((c) => c && c.kind !== "one tile, two categories" && Array.isArray(c.categories));
  if (conflicts.length === 0) return counts.length ? counts.map((c) => `${c.category}: ${c.n} (${c.labels.join(", ")})${rangeNote(c.labels, c.n)}`) : ["NONE"];
  const possible = new Map(); // category → the conflicted labels naming it
  for (const c of conflicts) {
    for (const category of c.categories) {
      if (canon(category) === "unknown") continue;
      if (!possible.has(category)) possible.set(category, []);
      if (!possible.get(category).includes(c.label)) possible.get(category).push(c.label);
    }
  }
  const also = (category) => (possible.get(category) || []).slice().sort(labelOrder);
  const rows = counts.map((c) => { const p = also(c.category); return `${c.category}: ${c.n} confirmed (${c.labels.join(", ")})${p.length ? `; possibly also ${p.join(", ")} (see CONFLICTS)` : ""}${rangeNote(c.labels, c.n)}${possibleRangeNote(p)}`; });
  const only = [...possible.keys()].filter((category) => !counts.some((c) => c.category === category)).sort((a, b) => a.localeCompare(b));
  for (const category of only) rows.push(`${category}: 0 confirmed; possibly ${also(category).join(", ")} (see CONFLICTS)${possibleRangeNote(also(category))}`);
  return rows.length ? rows : ["NONE"];
}

/**
 * T60 (design D1 a, D2 a; F-228): the LEGEND TEXT block — the COUNTS rows added up by the text the page's legend prints
 * with each name (the colour check's `legendText`: the swatch's block less the name, colour_check.js legendTextOf). The
 * answers pair a design with its legend text right (902 of 902 statements on record) and add the groups wrong (the eight
 * 4-bedroom designs to 67–79 for 65 in 12 of 20 answers on production's v12 chunk). Measured before the code on
 * production's own messages (t60-design.md §0e, §0g): with this block no band written wrong in 10 of 10 Q6 answers, the
 * page's total stated in 10 of 10, no new claim. Written only when at least one legend text is shared by two or more rows
 * (a group with something to add up); otherwise [] and the chunk is byte-identical.
 *   LEGEND TEXT (what the page's legend prints with each name; a group's count adds up its names' confirmed counts above):
 *   4 bedroom home: 65 confirmed (The Kingsville 21, …, The Alnmouth 0); possibly also 23 more: 173, … (see CONFLICTS)
 *   the 3 groups together: 83 confirmed
 *   the legend prints the name alone: Affordable Housing Rented, Affordable Housing Shared Ownership
 * The groups' total only when there are two or more groups. The rows are countsLines' (by count, then name; a category
 * named only in conflicts counts 0). A group's possible labels
 * are the conflicts (a same-tile multi-value is not one — F-188) a category of which has the group's text, in label order:
 * T58's "possibly also … (see CONFLICTS)", counted. A row whose name matched no legend swatch, or whose block does not
 * begin with its name, is listed apart as "no legend text read" — never as a name the legend prints alone. The words are
 * the kind's; the legend's text is the page's own. A range stays one label in its row (T59).
 */
const LEGEND_TEXT_HEAD = "LEGEND TEXT (what the page's legend prints with each name; a group's count adds up its names' confirmed counts above):";
function legendTextLines(merged, legendText) {
  const texts = legendText && typeof legendText === "object" ? legendText : {};
  const textOf = (category) => (typeof texts[category] === "string" ? texts[category].trim() : null);
  const counts = merged && Array.isArray(merged.counts) ? merged.counts : [];
  const conflicts = (merged && Array.isArray(merged.conflicts) ? merged.conflicts : []).filter((c) => c && c.kind !== "one tile, two categories" && Array.isArray(c.categories));
  const rows = counts.map((c) => ({ category: c.category, n: c.n }));
  const named = [];
  for (const c of conflicts) for (const category of c.categories) if (canon(category) !== "unknown" && !named.includes(category)) named.push(category);
  for (const category of named.filter((cat) => !counts.some((c) => c.category === cat)).sort((a, b) => a.localeCompare(b))) rows.push({ category, n: 0 });
  const groups = new Map();
  for (const r of rows) {
    const t = textOf(r.category);
    if (!t) continue;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(r);
  }
  if (![...groups.values()].some((rs) => rs.length >= 2)) return [];
  const sum = (rs) => rs.reduce((a, r) => a + r.n, 0);
  const order = [...groups.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const out = [LEGEND_TEXT_HEAD];
  for (const t of order) {
    const rs = groups.get(t);
    const possible = conflicts.filter((c) => c.categories.some((category) => canon(category) !== "unknown" && textOf(category) === t)).map((c) => c.label).sort(labelOrder);
    out.push(`${t}: ${sum(rs)} confirmed (${rs.map((r) => `${r.category} ${r.n}`).join(", ")})${possible.length ? `; possibly also ${possible.length} more: ${possible.join(", ")} (see CONFLICTS)` : ""}`);
  }
  if (order.length > 1) out.push(`the ${order.length} groups together: ${sum([...groups.values()].flat())} confirmed`);
  const alone = rows.filter((r) => textOf(r.category) === "").map((r) => r.category);
  if (alone.length) out.push(`the legend prints the name alone: ${alone.join(", ")}`);
  const unread = rows.filter((r) => textOf(r.category) === null).map((r) => r.category);
  if (unread.length) out.push(`no legend text read: ${unread.join(", ")}`);
  return out;
}

/**
 * T60 (design D1 a; F-228): what a CONFLICTS line's labels name when one of them is a range — T59's row clause carried to
 * the one line T59 left without it: "; 1 of the 25 is a range counted as one label — 220 - 237 (18 numbers); the 25 labels
 * name 42 numbers" (several: "; k of the n are ranges counted as one label each — A (x numbers) and B (y numbers); …").
 * The answers read the line's count as plots ("25 plots", "25 + 18 = 43") until it said what its labels name (t60-design.md
 * §0g: 5 of 10 answers without it, 1 of 10 with it). Written only when every conflicted label is a whole number or a range
 * and at least one is a range; otherwise "" and the line is byte-identical (SSX125's part-number conflicts never qualify).
 * A lone conflicted label reads "the 1 label names …".
 */
function conflictsRangeNote(conflicts) {
  const labels = (Array.isArray(conflicts) ? conflicts : []).map((c) => (c ? c.label : null));
  if (!labels.length || !labels.every((l) => labelSpan(l) !== null)) return "";
  const ranges = labels.filter(isRangeLabel);
  if (!ranges.length) return "";
  const numbers = labels.reduce((a, l) => a + rangeSize(l), 0);
  const rs = ranges.map((r) => `${r} (${rangeSize(r)} numbers)`);
  const list = rs.length === 1 ? rs[0] : `${rs.slice(0, -1).join(", ")} and ${rs[rs.length - 1]}`;
  const n = labels.length;
  return `${rs.length === 1 ? `; 1 of the ${n} is a range counted as one label` : `; ${rs.length} of the ${n} are ranges counted as one label each`} — ${list}; ${n === 1 ? "the 1 label names" : `the ${n} labels name`} ${numbers} numbers`;
}

function detailIndexLine(e) {
  if (!e.conflict) return `${e.label} | ${e.category}`;
  if (e.kind === "one tile, two categories") return `${e.label} | ${e.conflict.join("; ")} (two categories read on one tile)`;
  if (e.kind === "colour") return `${e.label} | ${e.conflict.join(" or ")} (the colour at the label matches ${e.conflict[1]}, not ${e.conflict[0]})`;
  return `${e.label} | ${e.conflict.join(" or ")} (read differently by two tiles)`;
}

function detailChunkText({ title, pageTitle, page, kind, key = [], merged = null, transcription = null, tilesNotRead = [], grid = DETAIL_GRID, overlap = DETAIL_OVERLAP, legendText = null } = {}) {
  const out = [detailHeader({ title, pageTitle, page })];
  const notRead = (Array.isArray(tilesNotRead) ? tilesNotRead : []).filter(Boolean);
  if (kind === "keyed-index") {
    const m = merged || mergeTiles([]);
    out.push(key.length ? `KEY:\n${keyText(key)}` : "KEY: NONE");
    out.push("INDEX:");
    for (const e of m.index) out.push(detailIndexLine(e));
    if (m.index.length === 0) out.push("NONE");
    out.push("COUNTS:");
    out.push(...countsLines(m));
    // T60 (design D1 a, D2 a): the rows added up by the legend's own text — only when a text groups two or more rows.
    out.push(...legendTextLines(m, legendText));
    if (m.unknown.length) out.push(`UNKNOWN: ${m.unknown.length} (${m.unknown.join(", ")})`);
    out.push(`CONFLICTS: ${m.conflicts.length}${m.conflicts.length ? ` — ${m.conflicts.map((c) => `${c.label} (${c.categories.join(" or ")})`).join(", ")}${conflictsRangeNote(m.conflicts)}` : ""}`);
    const mv = Array.isArray(m.multiValued) ? m.multiValued : [];
    if (mv.length) out.push(`MULTI-VALUED: ${mv.length} — ${mv.map((c) => `${c.label} (${c.categories.join("; ")})`).join(", ")}`);
  } else {
    const t = transcription || mergeTranscriptions([]);
    out.push(`TRANSCRIPTION (${grid[0] * grid[1]} tiles, ${grid[0]}x${grid[1]} with a ${Math.round(overlap * 100)}% overlap; a line repeated across tiles is kept once, a line cut by a tile's edge is re-joined on its overlap):`);
    if (t.lines.length) out.push(...t.lines);
    else out.push("NONE");
  }
  if (notRead.length) out.push(`TILES NOT READ: ${notRead.map((x) => (typeof x === "string" ? x : `${x.tile} (${x.outcome})`)).join(", ")}`);
  return out.join("\n");
}

/**
 * The split rule (D5): a text over `maxChars` is cut at line boundaries
 * into parts that each repeat the header line with ` | part i of n`; a text
 * within the bound is returned whole. A single line longer than the bound
 * is kept whole (never cut mid-line).
 */
function splitDetailText(text, maxChars = DETAIL_MAX_CHARS) {
  const whole = String(text || "");
  if (whole.length <= maxChars) return [whole];
  const lines = whole.split("\n");
  const header = lines.shift() || "";
  const room = Math.max(1, maxChars - header.length - 24);
  const groups = [];
  let cur = [];
  let len = 0;
  for (const line of lines) {
    if (cur.length && len + line.length + 1 > room) { groups.push(cur); cur = []; len = 0; }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) groups.push(cur);
  const n = groups.length;
  return groups.map((g, i) => `${header.replace(/\]:$/, ` | part ${i + 1} of ${n}]:`)}\n${g.join("\n")}`);
}

/** The subject phrase the INDEX prompt names, from the caption (never a document or design name of our own). */
function detailSubjectFor({ visualType, title } = {}) {
  const kind = typeof visualType === "string" && visualType ? (visualType === "mixed" ? "page of mixed visual content" : visualType) : "page";
  const article = /^[aeiou]/i.test(kind) ? "an" : "a";
  const t = typeof title === "string" && title.trim() ? ` titled "${title.trim().replace(/"/g, "'")}"` : "";
  return `${article} ${kind}${t}`;
}

module.exports = {
  DETAIL_PASS_MODES,
  DETAIL_PASS_DEFAULT,
  DETAIL_GRID,
  DETAIL_OVERLAP,
  DETAIL_RENDER_SCALE,
  DETAIL_MAX_CHARS,
  DETAIL_KINDS,
  DETAIL_REASONS,
  DETAIL_TRIGGER_WORDS,
  ILLEGIBLE_MARK,
  OVERFLOW_MARK,
  normaliseDetailMode,
  parseCaptionSections,
  typeLineIsMapOrPlan,
  admissionIn,
  detailPlanFor,
  tilePlan,
  parsePairs,
  parseKey,
  keyText,
  isNoneReply,
  mergeTiles,
  mergeTranscriptions,
  LABEL_CLUSTER_HALF_PT,
  sameLine,
  labelClusters,
  tileVotes,
  detailGeometry,
  conflictKind,
  RANGE_LABEL,
  labelSpan,
  isRangeLabel,
  subsumeRanges,
  countsLines,
  LEGEND_TEXT_HEAD,
  legendTextLines,
  conflictsRangeNote,
  detailPagesList,
  detailHeader,
  detailIndexLine,
  detailChunkText,
  splitDetailText,
  detailSubjectFor,
  labelOrder,
  DETAIL_JOIN_MIN_CHARS,
  tilePosition,
  overlapLength,
};
