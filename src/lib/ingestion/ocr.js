/**
 * OCR for pages without a text layer — ticket T35 (the multi-modal workshop
 * charter's D14; design `inputs/rag-audit/t35-design.md`, D1–D13).
 *
 * The JS half of the mechanism. Pure: no I/O, no framework, no require at all
 * — `config.js` (bundled into the page) reads the mode vocabulary from here,
 * `ids.js` fingerprints it, the parser applies the timeout rule and marks the
 * chunks, and the ledger / the views / the span share the list rendering.
 * The OCR itself runs in Python — `docling_bridge.py`, with `ocr_text.py`
 * holding its pure part (the trigger, the thread pin, the reading order).
 *
 * What it is (design §2): a page whose PDF text layer is EMPTY (0 non-blank
 * characters — D2; never a threshold, never a corpus-wide switch) is
 * rendered at OCR_SCALE and read by RapidOCR (the image's `rapidocr` with
 * `onnxruntime`, D4) inside the bridge's pypdfium2 branch (D5); the OCR
 * lines become the page's text — chunked like any page, `meta.textSource:
 * "ocr"` on each chunk and `Text: OCR` in the context header (D6). The
 * page then HAS a text layer, so its caption takes the `withText` prompt
 * (D7) and the transcribe detail plan is not taken on it (D8). Nothing is
 * silent: the pages OCR read, read empty or failed on are counted and named
 * on the ledger, the status frame, the ingest views and the state probe
 * (D10). `ocrNoTextPages: "auto" | "off"` is the one setting (D3),
 * fingerprinted only when "off" (T24 D8's rule; D9).
 */

/** The two values of the `ocrNoTextPages` setting (config.js's table; ids.js's fingerprint). */
const OCR_MODES = Object.freeze(["auto", "off"]);
const OCR_DEFAULT = "auto";

/**
 * The render OCR reads (D5): 2.0 → ≤ 1654 px on the long side of A4, under
 * rapidocr's `max_side_len` of 2000 (F-149: a larger render is downsized
 * before detection and read the brochure's dimensions worse — the design
 * probe, t35-design §0a). A constant, not a setting; Python holds the same
 * value (ocr_text.OCR_SCALE) and U-OCR pins the two equal.
 */
const OCR_SCALE = 2.0;

/**
 * The bridge's per-file timeout (parser.js): 300 s as before, plus 5 s per
 * page when OCR may run — a 100-page scan then has 800 s (design §2.2). The
 * page count is read cheaply before the parse (`--page-count`); unknown → 0.
 */
const BRIDGE_TIMEOUT_BASE_MS = 300000;
const OCR_TIMEOUT_PER_PAGE_MS = 5000;

/** The value `metadata.textSource` carries on a chunk whose text OCR read (D6). */
const TEXT_SOURCE_OCR = "ocr";

/** The mode as the loader, the parser and the fingerprint read it: a listed value, else the default. */
function normaliseOcrMode(value) {
  if (typeof value !== "string") return OCR_DEFAULT;
  const v = value.trim().toLowerCase();
  return OCR_MODES.includes(v) ? v : OCR_DEFAULT;
}

/** The bridge's exec timeout for a document of `pageCount` pages under `mode`. */
function bridgeTimeoutMs(mode, pageCount) {
  const pages = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 0;
  return normaliseOcrMode(mode) === "off" ? BRIDGE_TIMEOUT_BASE_MS : BRIDGE_TIMEOUT_BASE_MS + OCR_TIMEOUT_PER_PAGE_MS * pages;
}

/** The list the views print: "1" / "1, 7" — the same rendering as the detail passes' (detailPagesList). */
function ocrPagesList(pages) {
  const list = Array.isArray(pages) ? pages.filter((p) => Number.isInteger(p) && p > 0) : [];
  return [...new Set(list)].sort((a, b) => a - b).join(", ");
}

/** A page entry of the bridge's `pages` list whose text OCR read (the parser's test for `textSource`). */
function pageIsOcr(pageEntry) {
  return !!(pageEntry && pageEntry.ocr === true);
}

module.exports = {
  OCR_MODES,
  OCR_DEFAULT,
  OCR_SCALE,
  BRIDGE_TIMEOUT_BASE_MS,
  OCR_TIMEOUT_PER_PAGE_MS,
  TEXT_SOURCE_OCR,
  normaliseOcrMode,
  bridgeTimeoutMs,
  ocrPagesList,
  pageIsOcr,
};
