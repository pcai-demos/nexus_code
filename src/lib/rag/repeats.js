/**
 * T40 (t40-design.md D7; F-155) — identical text is shown once.
 *
 * A marketing PDF repeats its disclaimer on every page; a furniture manual
 * repeats its parts strip; the splitter stores each copy as its own chunk on
 * its own page, and the reranker scores the copies alike. Measured on the
 * served image, 2026-09-21: the Site Plan's disclaimer FOUR times among one
 * question's eight kept rows (0.069–0.074 each, pairwise cosine 0.999), and
 * 46 such chunks in seven exact-repeat groups across production. Nothing
 * downstream recognised identical text — applyPageDiversity limits chunks per
 * PAGE, and the copies are on different pages.
 *
 * The rule, and only the rule: two rows whose BODIES are byte-identical after
 * the leading bracketed header is stripped (`[Page 4]`, `[Page 2 - KITCHEN …]`,
 * `[Section: …]`, a caption's or a detail chunk's `[… (Page N)]:` head) and
 * whitespace is folded are one row. The survivor is the highest-scored copy
 * (a null score ranks below any number), then the lowest page, then the
 * lowest chunkIndex, then the earlier row; it keeps its own position. Not
 * fuzzy: a differently chunked copy of the same paragraph (the brochure's
 * OCR'd disclaimer straddling two Site Plan chunks) is not matched — that is
 * ingest-time repetition detection, T18's. A header-only chunk (an empty body)
 * is never collapsed.
 *
 * Pure: rows in, the survivors out in their original order, plus what was
 * dropped and why for the retrieval report. Knows nothing about Weaviate or
 * the route (U-REPEATS).
 */

/** One leading bracketed header: `[Page 4] `, `[Page 2 - KITCHEN] `, `[Section: …] `, `[HUMAN-LOGICAL … (Page 4)]: `, `[VISUAL DETAIL: …]: `. */
const LEADING_HEADER = /^\s*\[[^\]]*\]:?\s*/;

/** The comparable body of a chunk: the header stripped, whitespace folded. */
function bodyOf(text) {
  return String(text ?? "").replace(LEADING_HEADER, "").replace(/\s+/g, " ").trim();
}

function scoreOf(row) {
  const s = row && row.rerankScore;
  return typeof s === "number" && Number.isFinite(s) ? s : null;
}
function pageOf(row) {
  const p = Number(row && row.page);
  return Number.isFinite(p) ? p : Number.POSITIVE_INFINITY;
}
function indexOf(row) {
  const i = row && row.chunkIndex;
  return Number.isInteger(i) ? i : Number.POSITIVE_INFINITY;
}

/** True when row `a` (at position `ia`) should survive over row `b` (at `ib`). */
function outranks(a, ia, b, ib) {
  const sa = scoreOf(a), sb = scoreOf(b);
  if (sa !== sb) {
    if (sa === null) return false;
    if (sb === null) return true;
    return sa > sb;
  }
  if (pageOf(a) !== pageOf(b)) return pageOf(a) < pageOf(b);
  if (indexOf(a) !== indexOf(b)) return indexOf(a) < indexOf(b);
  return ia < ib;
}

/** The report's naming of a row: where it is, and what it scored. */
function locate(row) {
  const page = Number(row && row.page);
  return {
    source: row && typeof row.source === "string" ? row.source : null,
    page: Number.isFinite(page) ? page : null,
    chunkIndex: Number.isInteger(row && row.chunkIndex) ? row.chunkIndex : null,
    rerankScore: scoreOf(row),
  };
}

/**
 * @param {Array<object>} rows  ranked rows — `text`, `source`, `page`, `chunkIndex`, `rerankScore` (the store's
 *                              row shape; a missing field is tolerated)
 * @returns {{ rows: Array<object>, report: { count: number, groups: Array<{ kept: object, dropped: object[] }> } }}
 *          the survivors in their original order; `count` = rows dropped; one group per repeated body
 */
function collapseRepeats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byBody = new Map();
  list.forEach((row, i) => {
    const body = bodyOf(row && row.text);
    if (!body) return;
    if (!byBody.has(body)) byBody.set(body, []);
    byBody.get(body).push(i);
  });
  const dropped = new Set();
  const groups = [];
  for (const indices of byBody.values()) {
    if (indices.length < 2) continue;
    let survivor = indices[0];
    for (const i of indices.slice(1)) if (outranks(list[i], i, list[survivor], survivor)) survivor = i;
    const losers = indices.filter((i) => i !== survivor);
    for (const i of losers) dropped.add(i);
    groups.push({ position: survivor, kept: locate(list[survivor]), dropped: losers.map((i) => locate(list[i])) });
  }
  groups.sort((a, b) => a.position - b.position);
  return {
    rows: list.filter((_, i) => !dropped.has(i)),
    report: { count: dropped.size, groups: groups.map(({ kept, dropped: d }) => ({ kept, dropped: d })) },
  };
}

module.exports = { collapseRepeats, bodyOf, LEADING_HEADER };
