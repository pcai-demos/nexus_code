/**
 * T18 (t18-design.md D2, D3, D5, §2.1, §2.3) — running lines: the page furniture a document repeats on most of its
 * pages (a running header, a footer, a page number, a table's column-header row, a disclaimer, a ruler strip),
 * detected by cross-page repetition and removed before anything reads the page — no brand name, no phrase list.
 *
 * Measured on the served image before any code (t18-design.md §0a, §0b): the brief's rule "a line on ≥ 60 % of pages
 * within the first / last 3 lines" keyed on digit-masked lines strips a picture manual's step and part numbers (348
 * lines of the Ikea manual) and a parts list's part numbers; bullet glyphs on their own line repeat everywhere. The
 * rule that leaves content alone, and only it:
 *   - the KEY of a line is the line trimmed with its whitespace collapsed; its digits are masked to `#` only when the
 *     line is a bare number (digits and punctuation — a page number) or carries four letters or more (a header whose
 *     counter varies: `Page # of #`, `Document Generated: #-#-#`); a short line with fewer than four letters keeps
 *     its exact text (`2x`, `C-00105-001`, `6 AA-2395783-5` are content); a line with no letter and no digit has no
 *     key (a bullet, a rule);
 *   - the ZONE is the page's first `zone` and last `zone` non-empty lines (a header is at the top, a footer at the
 *     bottom; a sub-heading that recurs mid-page is content — PCI-DSS's `Good Practice` on 39 pages);
 *   - a key is RUNNING when it occurs exactly ONCE in the zone of at least `max(minPages, ceil(share × pages))` pages
 *     (a header is one line per page; a page holding the key twice in its zone is a page whose own numbers include
 *     it, and keeps them all);
 *   - on a page the running key's one occurrence in the zone is removed; with `keepFirst` the first page on which a
 *     key would be removed keeps it, so the corpus says every running text once (T18 removes repetition, never
 *     information — the Site Plan's tolerance sentence, the PSRs' currency banner).
 * `\r\n` and a lone `\r` are normalised to `\n` first (F-168: pypdfium2's text layer), by `normalisePageText`.
 *
 * Pure: strings in, strings and counts out; no config, no I/O, no store (U-RUNNING). Transportable (the standing aim).
 */

const DEFAULT_ZONE = 5;
const DEFAULT_SHARE = 0.5;
const DEFAULT_MIN_PAGES = 3;
const LETTERS_FOR_MASKING = 4;

/** `\r\n` and a lone `\r` → `\n` (F-168). Anything that is not a string is "". */
function normalisePageText(text) {
  return typeof text === "string" ? text.replace(/\r\n?/g, "\n") : "";
}

/** The line trimmed, its runs of whitespace collapsed to one space. */
function normaliseLine(line) {
  return String(line ?? "").trim().replace(/\s+/g, " ");
}

/**
 * The key of a line (see the module comment): null for a line with no letter and no digit; digits masked on a bare
 * number line or a line with four letters or more; otherwise the exact normalised line.
 */
function keyOf(line) {
  const n = normaliseLine(line);
  if (!/[A-Za-z0-9]/.test(n)) return null;
  const letters = (n.match(/[A-Za-z]/g) || []).length;
  const bareNumber = !/[A-Za-z]/.test(n);
  return letters >= LETTERS_FOR_MASKING || bareNumber ? n.replace(/\d+/g, "#") : n;
}

/** The indices of a page's non-empty lines that fall in the zone (the first and last `zone` non-empty lines). */
function zoneIndices(lines, zone) {
  const idx = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].trim()) idx.push(i);
  if (!Number.isFinite(zone) || zone <= 0) return idx;
  return [...new Set([...idx.slice(0, zone), ...idx.slice(-zone)])];
}

function normaliseOptions(opts = {}) {
  const zone = Number.isFinite(opts.zone) && opts.zone >= 0 ? Math.floor(opts.zone) : DEFAULT_ZONE;
  const share = Number.isFinite(opts.share) && opts.share > 0 && opts.share <= 1 ? opts.share : DEFAULT_SHARE;
  const minPages = Number.isInteger(opts.minPages) && opts.minPages >= 1 ? opts.minPages : DEFAULT_MIN_PAGES;
  return { zone, share, minPages, keepFirst: opts.keepFirst !== false };
}

/**
 * Detect the running keys of a document.
 * @param {Array<string|{text?: string, markdown?: string, hidden?: boolean}>} pages  the pages' text in order (a
 *        hidden page — `hidden: true` — is not a page for this purpose; an empty page is not counted)
 * @param {{ zone?: number, share?: number, minPages?: number }} [opts]
 * @returns {{ keys: Set<string>, need: number, pageCount: number, table: Array<{ key: string, pagesOnce: number,
 *            pagesAny: number, sample: string }>, ambiguous: Array<{ key: string, pagesOnce: number, pagesAny: number }> }}
 *          `keys` = the running keys; `table` = every key seen once on ≥ 2 pages with its counts; `ambiguous` = keys
 *          that reach the share by ANY count but not by once-per-page (kept as content)
 */
function detectRunningLines(pages, opts = {}) {
  const o = normaliseOptions(opts);
  const texts = pageTexts(pages);
  const pageCount = texts.length;
  const need = Math.max(o.minPages, Math.ceil(o.share * pageCount));
  const once = new Map(), any = new Map(), sample = new Map();
  for (const text of texts) {
    const lines = text.split("\n");
    const counts = new Map();
    for (const i of zoneIndices(lines, o.zone)) {
      const k = keyOf(lines[i]);
      if (k === null) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!sample.has(k)) sample.set(k, normaliseLine(lines[i]));
    }
    for (const [k, c] of counts) {
      any.set(k, (any.get(k) || 0) + 1);
      if (c === 1) once.set(k, (once.get(k) || 0) + 1);
    }
  }
  const keys = new Set([...once.entries()].filter(([, c]) => c >= need).map(([k]) => k));
  const table = [...once.entries()].filter(([, c]) => c >= 2).map(([k, c]) => ({ key: k, pagesOnce: c, pagesAny: any.get(k) || 0, sample: sample.get(k) || k })).sort((a, b) => b.pagesOnce - a.pagesOnce || a.key.localeCompare(b.key));
  const ambiguous = [...any.entries()].filter(([k, c]) => c >= need && !keys.has(k)).map(([k, c]) => ({ key: k, pagesOnce: once.get(k) || 0, pagesAny: c }));
  return { keys, need, pageCount, table, ambiguous };
}

/** The pages' normalised texts, hidden pages and empty pages left out. */
function pageTexts(pages) {
  const out = [];
  for (const p of Array.isArray(pages) ? pages : []) {
    if (p && typeof p === "object" && p.hidden === true) continue;
    const raw = typeof p === "string" ? p : p && typeof p === "object" ? (typeof p.markdown === "string" ? p.markdown : typeof p.text === "string" ? p.text : "") : "";
    const text = normalisePageText(raw);
    if (text.trim()) out.push(text);
  }
  return out;
}

/**
 * Strip a document's running lines page by page.
 * @param {Array<string|{text?: string, markdown?: string, hidden?: boolean}>} pages  in order (hidden pages are passed
 *        through untouched and excluded from detection)
 * @param {{ zone?: number, share?: number, minPages?: number, keepFirst?: boolean, keys?: Set<string> }} [opts]
 *        `keys` skips detection and strips the given keys (the caller ran `detectRunningLines` itself)
 * @returns {{ pages: string[], keys: Set<string>, need: number, pageCount: number, removed: Array<{ page: number,
 *            key: string, line: string }>, keptFirst: Array<{ page: number, key: string }>, pagesTouched: number,
 *            pagesAmbiguous: number, pagesWithoutText: number[] }}
 *          `pages` = each page's text, normalised and stripped, in the caller's order (hidden pages "" as given);
 *          `page` in the details is the 1-based position in `pages`
 */
function stripRunningLines(pages, opts = {}) {
  const o = normaliseOptions(opts);
  const list = Array.isArray(pages) ? pages : [];
  const det = opts.keys instanceof Set ? { keys: opts.keys, need: null, pageCount: pageTexts(list).length } : detectRunningLines(list, o);
  const out = [];
  const removed = [], keptFirst = [];
  const kept = new Set();
  const touched = new Set();
  const pagesWithoutText = [];
  let pagesAmbiguous = 0;
  for (let p = 0; p < list.length; p++) {
    const item = list[p];
    const hidden = item && typeof item === "object" && item.hidden === true;
    const raw = typeof item === "string" ? item : item && typeof item === "object" ? (typeof item.markdown === "string" ? item.markdown : typeof item.text === "string" ? item.text : "") : "";
    const text = normalisePageText(raw);
    if (hidden || !det.keys.size || !text.trim()) { out.push(hidden ? text : text); continue; }
    const lines = text.split("\n");
    const zone = zoneIndices(lines, o.zone);
    const counts = new Map();
    for (const i of zone) { const k = keyOf(lines[i]); if (k !== null && det.keys.has(k)) counts.set(k, (counts.get(k) || 0) + 1); }
    let ambiguous = false;
    const drop = new Set();
    for (const i of zone) {
      const k = keyOf(lines[i]);
      if (k === null || !det.keys.has(k)) continue;
      if (counts.get(k) !== 1) { ambiguous = true; continue; }
      if (o.keepFirst && !kept.has(k)) { kept.add(k); keptFirst.push({ page: p + 1, key: k }); continue; }
      drop.add(i);
      removed.push({ page: p + 1, key: k, line: normaliseLine(lines[i]) });
    }
    if (ambiguous) pagesAmbiguous++;
    if (drop.size) touched.add(p + 1);
    const stripped = lines.filter((_, i) => !drop.has(i)).join("\n");
    if (drop.size && !stripped.trim()) pagesWithoutText.push(p + 1);
    out.push(stripped);
  }
  return { pages: out, keys: det.keys, need: det.need, pageCount: det.pageCount, removed, keptFirst, pagesTouched: touched.size, pagesAmbiguous, pagesWithoutText };
}

/** The per-file counts the ledger, the frame, the views and the log carry (T18 §2.6). */
function pageArtifactCounts(result) {
  const r = result || {};
  const distinct = new Set((r.removed || []).map((x) => x.key));
  return {
    linesRemoved: (r.removed || []).length,
    distinctKeys: distinct.size,
    pagesTouched: Number.isFinite(r.pagesTouched) ? r.pagesTouched : 0,
    keptFirst: (r.keptFirst || []).length,
    pagesWithoutText: (r.pagesWithoutText || []).length
  };
}

module.exports = {
  DEFAULT_ZONE, DEFAULT_SHARE, DEFAULT_MIN_PAGES, LETTERS_FOR_MASKING,
  normalisePageText, normaliseLine, keyOf, zoneIndices, detectRunningLines, stripRunningLines, pageArtifactCounts
};
