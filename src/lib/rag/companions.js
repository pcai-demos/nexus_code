/**
 * Page-level context assembly — ticket T28 (F-99; design t28-design.md §1–§2).
 *
 * The chunker stores a page's figure captions as separate objects, appended
 * after every text chunk of the document, and nothing at retrieval time joins
 * a kept text chunk to the captions of its own page. Measured on the demo
 * dry run: the Figure 15 caption that answers Q3 holds every number, is in
 * the candidate pool, and is cut at rank 20 of 50 behind product-code
 * string matches while two text chunks of the SAME page are kept. This
 * module is the pure half of the fix: given the ranked chunks that will be
 * shown and the rows the store holds for their pages, it selects the
 * companions (deterministic order, a budget, no duplicates) and interleaves
 * them behind their anchors. It knows nothing about Weaviate, Next.js or the
 * orchestrator — every input is a value — so it can be lifted into another
 * pipeline unchanged and unit-tested without a pod (U-COMPANIONS).
 *
 * INPUT CONTRACT — a chunk is a plain object with `source`, `page`,
 * `chunkIndex` (integer on a v2 class, null on v1), `isVisualElement`,
 * `text`, `metadata` (JSON string or object) — the shape the store's
 * search() and fetchPageChunks() return. `paginationFacts` is
 * `{ [source]: boolean }`, false marking a file whose stored page is a
 * synthesised stamp (F-11), the same contract citations.js uses.
 *
 * Rules that are decisions, not accidents (design D3, D5, D7, D9):
 *  1. THE PAGE IS THE JOIN. `(source, page)` is the one relation the store
 *     holds between a caption and its text (the parser stamps `pic.page`);
 *     `chunkIndex` adjacency says nothing (captions sit at the end).
 *  2. SOURCE EQUALITY IS EXACT. The store's `Equal` on the word-tokenised
 *     `source` is a token match (F-109: "SitePlan" matches the Site Plan),
 *     so a row is a companion only when its `source` === the anchor's.
 *  3. IDENTITY, NOT TEXT. Dedupe by (source, chunkIndex) where the class
 *     has chunkIndex, else (source, page, kind, text). A row already kept is
 *     never added; a row reachable from two anchors is added once.
 *  4. A WHOLE PAGE OR NOTHING. Under the budget a page's companions are
 *     admitted together or skipped together and counted, never half-added.
 *  5. MODE `captions`: a kept chunk brings its page's captions. MODE `page`:
 *     additionally, when any kept chunk of the page is a caption, the page's
 *     text (≤ textPerPage, in stored order). MODE `off`: nothing, reported.
 *  6. ONLY LOCATED PAGES. A non-positive page is not a location; a source
 *     known to be single-page (F-11) would join the whole file.
 */

const COMPANION_MODES = Object.freeze(["off", "captions", "page"]);

function parseMetadata(chunk) {
  try {
    const raw = chunk && chunk.metadata;
    if (raw && typeof raw === "object") return raw;
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** A page is a location only when it is a positive integer (citations.js's rule). */
function locatedPage(chunk) {
  const p = Number(chunk && chunk.page);
  return Number.isInteger(p) && p > 0 ? p : null;
}

function isCaption(chunk) {
  if (!chunk || typeof chunk !== "object") return false;
  if (chunk.isVisualElement === true) return true;
  return parseMetadata(chunk).isVisualElement === true;
}

function sourceOf(chunk) {
  return chunk && typeof chunk.source === "string" ? chunk.source : "";
}

/** Rule 3: the identity a row is deduplicated by. */
function identityOf(chunk) {
  const src = sourceOf(chunk);
  if (Number.isInteger(chunk && chunk.chunkIndex)) return `${src}|#${chunk.chunkIndex}`;
  const kind = isCaption(chunk) ? "c" : "t";
  return `${src}|p${locatedPage(chunk) ?? 0}|${kind}|${String((chunk && chunk.text) || "")}`;
}

function pageKey(chunk) {
  return `${sourceOf(chunk)}|${locatedPage(chunk)}`;
}

function byStoredOrder(a, b) {
  const ai = Number.isInteger(a.chunkIndex) ? a.chunkIndex : Number.MAX_SAFE_INTEGER;
  const bi = Number.isInteger(b.chunkIndex) ? b.chunkIndex : Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai - bi;
  return a._order - b._order;
}

/**
 * The distinct located pages of `chunks`, in the chunks' order (ranked order
 * when the caller passes ranked chunks), excluding pages that cannot be a
 * join key: no source, no located page, or a source this process knows to be
 * single-page (F-11). Each entry carries the sourceId when the chunk has one
 * so the store read can key on it (rule 2).
 */
function companionPagesFor(chunks, { paginationFacts } = {}) {
  const facts = paginationFacts && typeof paginationFacts === "object" ? paginationFacts : {};
  const seen = new Set();
  const pages = [];
  const skipped = { notLocated: 0, singlePage: 0 };
  for (const c of Array.isArray(chunks) ? chunks : []) {
    const source = sourceOf(c);
    const page = locatedPage(c);
    if (!source || page === null) {
      skipped.notLocated++;
      continue;
    }
    if (facts[source] === false) {
      skipped.singlePage++;
      continue;
    }
    const key = `${source}|${page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pages.push({ source, sourceId: typeof c.sourceId === "string" && c.sourceId ? c.sourceId : null, page });
  }
  return { pages, skipped };
}

/**
 * Select the companions for `kept` (the sliced ranked chunks, in order) from
 * `pageRows` (what the store returned for their pages, any order).
 */
function selectCompanions({ kept, pageRows, mode = "captions", budget = 0, textPerPage = 4, paginationFacts } = {}) {
  // Indices are the contract with interleave(): the list is NOT filtered —
  // a junk entry simply anchors nothing (A15).
  const keptList = Array.isArray(kept) ? kept : [];
  const rows = (Array.isArray(pageRows) ? pageRows : [])
    .filter((r) => r && typeof r === "object")
    .map((r, i) => ({ ...r, _order: i }));
  const effectiveMode = COMPANION_MODES.includes(mode) ? mode : "captions";
  const cap = Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 0;
  const perPage = Number.isFinite(textPerPage) && textPerPage >= 0 ? Math.floor(textPerPage) : 0;
  const skipped = { overBudget: 0, alreadyKept: 0, notLocated: 0, singlePage: 0, textCapped: 0, foreignSource: 0 };
  const out = { companions: [], skipped, pagesConsidered: 0, mode: effectiveMode, budget: cap };
  if (effectiveMode === "off" || keptList.length === 0) return out;

  const { pages, skipped: pageSkips } = companionPagesFor(keptList, { paginationFacts });
  skipped.notLocated = pageSkips.notLocated;
  skipped.singlePage = pageSkips.singlePage;
  out.pagesConsidered = pages.length;
  const wantedPages = new Set(pages.map((p) => `${p.source}|${p.page}`));

  const isObj = (c) => c && typeof c === "object";
  const keptIds = new Set(keptList.filter(isObj).map(identityOf));
  const keptCaptionPages = new Set(keptList.filter(isObj).filter(isCaption).map(pageKey));
  const added = new Set();
  const processed = new Set();
  let addedCount = 0;

  // Rows that do not belong to a wanted page under EXACT source equality are
  // the store's token-match superset (rule 2) — counted, never used.
  const rowsByPage = new Map();
  for (const r of rows) {
    const page = locatedPage(r);
    const key = `${sourceOf(r)}|${page}`;
    if (page === null || !wantedPages.has(key)) {
      skipped.foreignSource++;
      continue;
    }
    if (!rowsByPage.has(key)) rowsByPage.set(key, []);
    rowsByPage.get(key).push(r);
  }

  keptList.forEach((anchor, anchorIndex) => {
    if (!isObj(anchor)) return;
    const key = pageKey(anchor);
    if (processed.has(key) || !rowsByPage.has(key)) return;
    processed.add(key);
    const pageRowsHere = rowsByPage.get(key);
    const captions = pageRowsHere.filter(isCaption).sort(byStoredOrder);
    let texts = [];
    if (effectiveMode === "page" && keptCaptionPages.has(key)) {
      const all = pageRowsHere.filter((r) => !isCaption(r)).sort(byStoredOrder);
      const fresh = all.filter((r) => !keptIds.has(identityOf(r)));
      texts = fresh.slice(0, perPage);
      skipped.textCapped += Math.max(0, fresh.length - texts.length);
    }
    const wanted = [];
    for (const r of [...captions, ...texts]) {
      const id = identityOf(r);
      if (keptIds.has(id) || added.has(id)) {
        skipped.alreadyKept++;
        continue;
      }
      wanted.push({ row: r, kind: isCaption(r) ? "caption" : "text" });
    }
    if (wanted.length === 0) return;
    if (addedCount + wanted.length > cap) {
      skipped.overBudget += wanted.length;
      return;
    }
    for (const w of wanted) {
      const { _order, ...chunk } = w.row;
      added.add(identityOf(chunk));
      addedCount++;
      out.companions.push({
        chunk,
        anchorIndex,
        kind: w.kind,
        reason:
          w.kind === "caption"
            ? `figure caption on the same page (page ${locatedPage(anchor)}) as the retrieved passage`
            : `page text on the same page (page ${locatedPage(anchor)}) as the retrieved figure`,
      });
    }
  });
  return out;
}

/**
 * The ordered context list: each kept chunk, then its companions, each
 * companion a copy carrying `companion: { anchor, kind, reason }` where
 * `anchor` is the kept chunk object it follows (the formatter resolves the
 * anchor's marker from that reference). Kept chunks are returned as-is.
 */
function interleave(kept, companions) {
  const keptList = Array.isArray(kept) ? kept : [];
  const list = Array.isArray(companions) ? companions : [];
  const byAnchor = new Map();
  for (const c of list) {
    if (!c || !c.chunk || !Number.isInteger(c.anchorIndex)) continue;
    if (!byAnchor.has(c.anchorIndex)) byAnchor.set(c.anchorIndex, []);
    byAnchor.get(c.anchorIndex).push(c);
  }
  const out = [];
  keptList.forEach((k, i) => {
    out.push(k);
    for (const c of byAnchor.get(i) || []) {
      out.push({ ...c.chunk, companion: { anchor: k, kind: c.kind, reason: c.reason } });
    }
  });
  return out;
}

module.exports = {
  COMPANION_MODES,
  locatedPage,
  isCaption,
  identityOf,
  companionPagesFor,
  selectCompanions,
  interleave,
};
