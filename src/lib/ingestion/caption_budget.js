/**
 * T31 (multimodal-workshop-design.md D5–D7, F-123): which of a document's
 * page renders are sent to the captioner, and what is said about the rest.
 *
 * Before T31 the parser kept the first fifty "pictures" the bridge produced
 * (`parsed.pictures.slice(0, 50)`) — and since the bridge renders EVERY page
 * as one picture, that was the first fifty PAGES of a document whatever they
 * contained: the last 34 pages of the lathe manual and 74 of the washing-
 * machine manual were never shown to the captioner, and only the in-process
 * trace counted them (F-123).
 *
 * Now the only bound is the settings key `captionPageBudget` (pages per
 * document, in the bridge's page order — design D6): 0, the default, means
 * every page is considered; a positive budget keeps the first N. A page
 * beyond the budget is NOT ATTEMPTED — never a failure (the budget is the
 * presenter's choice, so the file is never `partial` for it) but counted and
 * NAMED by page number wherever the figure counts are shown: the trace, the
 * ledger's file_parsed and every terminal record, the status frame, both
 * ingest views and the VLM span (design D7).
 *
 * Pure, CommonJS, no I/O — the parser calls it once per document; the views
 * and the span reuse `pageRangeLabel`.
 */

/** The default: every page is considered. */
const CAPTION_PAGE_BUDGET_UNLIMITED = 0;

/**
 * The budget a value means: a non-negative integer is itself; anything else
 * (absent, null, a float, a negative, a string) is the default — no limit.
 * The settings loader applies the same rule (config.js), so the parser and
 * the drawer agree on what a stored value does.
 */
function normaliseCaptionPageBudget(value) {
  return Number.isInteger(value) && value >= 0 ? value : CAPTION_PAGE_BUDGET_UNLIMITED;
}

/**
 * A compact, human-readable label for a list of page numbers: "51–84",
 * "3, 7–9, 12", null when the list is empty. Runs of consecutive pages are
 * collapsed; the input is sorted and de-duplicated first.
 */
function pageRangeLabel(pages) {
  const sorted = [...new Set((Array.isArray(pages) ? pages : []).filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const runs = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const p = sorted[i];
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = p;
    prev = p;
  }
  return runs.join(", ");
}

/**
 * Split the bridge's pictures into the ones the captioner considers and the
 * ones beyond the budget.
 *
 *   selectCaptionTargets(pictures, budget) → {
 *     targets,              the pictures to caption, in the bridge's order
 *     budget,               the budget applied (0 = no limit)
 *     considered,           targets.length
 *     notAttempted,         how many pictures lie beyond the budget
 *     notAttemptedPages,    "51–84" | "3, 7–9" | null — their pages, labelled
 *     notAttemptedPageList, the same pages as a sorted list of integers
 *   }
 *
 * A picture without an integer `page` counts as not attempted but cannot be
 * named; the count is the truth, the label names what it can.
 */
function selectCaptionTargets(pictures, budget) {
  const list = Array.isArray(pictures) ? pictures : [];
  const limit = normaliseCaptionPageBudget(budget);
  const targets = limit === CAPTION_PAGE_BUDGET_UNLIMITED ? list.slice() : list.slice(0, limit);
  const rest = list.slice(targets.length);
  const pages = [...new Set(rest.map((p) => (p && Number.isInteger(p.page) && p.page > 0 ? p.page : null)).filter((p) => p !== null))].sort((a, b) => a - b);
  return {
    targets,
    budget: limit,
    considered: targets.length,
    notAttempted: rest.length,
    notAttemptedPages: pageRangeLabel(pages),
    notAttemptedPageList: pages,
  };
}

module.exports = {
  CAPTION_PAGE_BUDGET_UNLIMITED,
  normaliseCaptionPageBudget,
  pageRangeLabel,
  selectCaptionTargets,
};
