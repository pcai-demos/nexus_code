/**
 * T34 — section attribution for unpaginated formats (design `inputs/rag-audit/t34-design.md`, D2–D4, D6).
 *
 * A `.docx` has no pages: docling emits the whole document as ONE markdown string stamped page 1 (F-11), and the
 * only location a passage can honestly carry is the path of headings above it. This module is the pure part of
 * that: it reads docling's markdown headings (`#` × level — one for every Word heading style), keeps the heading
 * stack in force at every offset, names the anchor of a chunk by the offset it starts at, renders the path a
 * citation shows, and finds each chunk's offset in the markdown it was cut from (a chunk is a verbatim substring of
 * its page's markdown — recursiveSplit joins with the separator it split on).
 *
 * Pure and dependency-free: no I/O, no config, no model. Pinned by tests/unit/u-section.test.js.
 */

/** A markdown heading line: 1–12 hashes, optional spaces, the text (a trailing run of hashes is decoration). */
const HEADING_RE = /^(#{1,12})[ \t]*(.*)$/gm;
/** The path's rendering limits (design D2 b): a part, the whole, and how many parts — innermost first, then its ancestors nearest-first while they fit. */
const PATH_PART_MAX = 80;
const PATH_TOTAL_MAX = 200;
const PATH_PARTS_MAX = 3;
const PATH_SEPARATOR = " › ";

/** docling's markdown HTML-escapes heading text (`&amp;` — F-146): the anchor carries the characters Word holds. */
function unescapeHeading(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every heading of `markdown` in document order: { level, text, offset, path } — `path` the heading stack in force
 * once this heading is pushed (its ancestors' texts then its own). A level-n heading pops every heading at level ≥ n
 * (a gap in levels nests under the nearest shallower heading); a blank heading is skipped.
 */
function parseHeadings(markdown) {
  const md = String(markdown || "");
  const out = [];
  const stack = [];
  const re = new RegExp(HEADING_RE.source, "gm");
  let m;
  while ((m = re.exec(md)) !== null) {
    const level = m[1].length;
    const text = unescapeHeading(m[2].replace(/\s*#+\s*$/, ""));
    if (!text) continue;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const path = [...stack.map((s) => s.text), text];
    stack.push({ level, text });
    out.push({ level, text, offset: m.index, path });
  }
  return out;
}

/** The heading in force at `offset`: the last heading that starts at or before it; null before the first heading. */
function anchorAt(headings, offset) {
  const at = Number.isFinite(offset) ? offset : 0;
  let hit = null;
  for (const h of Array.isArray(headings) ? headings : []) {
    if (h.offset <= at) hit = h;
    else break;
  }
  return hit ? { innermost: hit.text, level: hit.level, path: hit.path.slice() } : null;
}

/**
 * The anchor of a CHUNK (D2, amended by §11a A13 — the first live pass): the section that holds MOST of the chunk's
 * characters, not the one in force at its first character. The splitter's overlap makes a section's opening chunk
 * begin with the previous section's tail, and a chunk can span several headings; counting the characters each
 * section owns inside [start, start + length) attributes the chunk to the section its text mostly belongs to. A tie
 * goes to the later section (the one the chunk continues into); a chunk that ends before the first heading has none.
 */
function anchorForChunk(headings, start, length) {
  const s = Number.isFinite(start) ? start : 0;
  const len = Number.isFinite(length) && length > 0 ? length : 0;
  const end = s + len;
  const list = Array.isArray(headings) ? headings : [];
  if (len === 0) return anchorAt(list, s);
  // The segments: [s, first inner heading), [h_i, h_i+1), …, [h_last, end) — each owned by the heading in force there.
  const cuts = [s, ...list.map((h) => h.offset).filter((o) => o > s && o < end), end];
  let best = null;
  for (let i = 0; i < cuts.length - 1; i++) {
    const owner = anchorAt(list, cuts[i]);
    const chars = cuts[i + 1] - cuts[i];
    if (!best || chars >= best.chars) best = { chars, anchor: owner };
  }
  return best ? best.anchor : null;
}

/** A part cut to `max` characters at a word boundary with an ellipsis. */
function cutPart(text, max) {
  const s = String(text || "");
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const atWord = head.replace(/\s+\S*$/, "");
  return `${(atWord.length >= Math.floor(max / 2) ? atWord : head).trim()}…`;
}

/**
 * The path a citation shows (D2 b): the innermost heading, then its ancestors nearest-first while the whole stays
 * within `totalMax` characters and `partsMax` parts; each part within `partMax`. null for an empty path.
 */
function renderPath(path, { partMax = PATH_PART_MAX, totalMax = PATH_TOTAL_MAX, partsMax = PATH_PARTS_MAX, separator = PATH_SEPARATOR } = {}) {
  const parts = (Array.isArray(path) ? path : []).map((p) => cutPart(String(p || "").trim(), partMax)).filter(Boolean);
  if (!parts.length) return null;
  const out = [parts[parts.length - 1]];
  for (let i = parts.length - 2; i >= 0 && out.length < partsMax; i--) {
    if ([parts[i], ...out].join(separator).length > totalMax) break;
    out.unshift(parts[i]);
  }
  return out.join(separator);
}

/** The line at the top of an unpaginated chunk (D3): the section, never a page word. "" for no anchor. */
function sectionPrefix(pathText) {
  return pathText ? `[Section: ${pathText}]\n` : "";
}

/** Whether a chunk's first non-empty line is itself a markdown heading (then the anchor is visibly in the chunk and no prefix is added). */
function startsWithHeading(chunkText) {
  const first = String(chunkText || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return /^#{1,12}[ \t]*[^#\s]/.test(first);
}

/**
 * Each chunk's start offset in the markdown it was cut from: the first occurrence of the chunk's trimmed text at or
 * after the previous chunk's start (chunks are contiguous and overlap by the splitter's tail — the next chunk starts
 * inside the previous one), else of its first 60 characters, else the previous start (never -1).
 */
function chunkOffsets(markdown, chunks) {
  const md = String(markdown || "");
  const out = [];
  let from = 0;
  for (const c of Array.isArray(chunks) ? chunks : []) {
    const text = String(c || "").trim();
    let at = text ? md.indexOf(text, from) : -1;
    if (at < 0 && text) at = md.indexOf(text.slice(0, 60), from);
    if (at < 0) at = from;
    out.push(at);
    from = at;
  }
  return out;
}

module.exports = {
  PATH_PART_MAX,
  PATH_TOTAL_MAX,
  PATH_PARTS_MAX,
  PATH_SEPARATOR,
  unescapeHeading,
  parseHeadings,
  anchorAt,
  anchorForChunk,
  renderPath,
  sectionPrefix,
  startsWithHeading,
  chunkOffsets,
};
