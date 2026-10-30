/**
 * T49 (t49-design.md §2.1, D1 a, D2 a, D3 a, D7; F-178, F-184) — the cited
 * figure's preview, as a pure module (no DOM, no fetch, no clock — transportable,
 * memory `rag-modularity-is-the-goal`).
 *
 * Why it exists. Since T22 the crops route has served every page render the
 * bridge writes (`/extracted_images/<docHash>/fig_<page>_0.png` — the WHOLE
 * page at scale 2.0, 3.5 for a dense map; never a crop to the figure, design
 * §0c), and since T14 the chat route has put each citation's `imagePath` on
 * the wire; the chip printed text only, and a ranked caption chunk's chip read
 * exactly like the page's text chunk's (F-184 — the "· figure" suffix is T28's
 * companion mark). This module decides, from the citation alone, whether a
 * chip previews and what the preview says:
 *   previewFor(citation)     — null unless the citation carries a path under
 *                              the crops route; else { src, title, caption, alt }.
 *   previewCaption(citation) — `<title> — <source> · p.25` with the stored
 *                              humanTitle carried as `title` (D3 a), `<source>
 *                              · p.25` without; the location by the chip's own
 *                              rule (T34: p.N / slide N / §<innermost heading>
 *                              / nothing), reproduced here and pinned equal to
 *                              the chip's four cases (U-PREVIEW 3). The chip's
 *                              own expressions are NOT moved (design §7 risk 1).
 * Total on junk: a non-object, a missing or non-string path give null / "".
 */

/** The only prefix a citation's image can carry (the crops route, T22 — F-59's path rule). */
const PREVIEW_IMAGE_ROOT = "/extracted_images/";

const asText = (v) => (typeof v === "string" ? v : "");

/** The chip's location suffix (ChatPanel.jsx, T34 D5 / D7): ` · p.25`, ` · slide 8`, ` · §Heading`, or "". */
function previewLocation(citation) {
  if (!citation || typeof citation !== "object") return "";
  if (citation.page != null) return ` · ${citation.locationKind === "slide" ? "slide " : "p."}${citation.page}`;
  if (citation.sectionPath) return ` · §${String(citation.sectionPath).split(" › ").pop()}`;
  return "";
}

/** The stored title on the citation (D3 a), trimmed; null when absent or blank. */
function previewTitle(citation) {
  const t = citation && typeof citation === "object" ? asText(citation.title).trim() : "";
  return t || null;
}

/**
 * `Figure 15 – Dimensions and fastening points — Fervi_Lathe_TechnicalSupportManual.pdf · p.25`
 * with a title, `Fervi_Lathe_TechnicalSupportManual.pdf · p.25` without; "" on junk.
 */
function previewCaption(citation) {
  if (!citation || typeof citation !== "object") return "";
  const where = `${asText(citation.source)}${previewLocation(citation)}`;
  const title = previewTitle(citation);
  return title ? `${title} — ${where}` : where;
}

/**
 * null unless `citation.imagePath` is a non-empty string under the crops route
 * (a citation cannot point the page anywhere else); else the preview:
 * `src` the path as cited, `title` the stored title or null, `caption` as
 * above, `alt` = the caption.
 */
function previewFor(citation) {
  if (!citation || typeof citation !== "object") return null;
  const src = citation.imagePath;
  if (typeof src !== "string" || !src.startsWith(PREVIEW_IMAGE_ROOT) || src.length === PREVIEW_IMAGE_ROOT.length) return null;
  const caption = previewCaption(citation);
  return { src, title: previewTitle(citation), caption, alt: caption };
}

module.exports = { PREVIEW_IMAGE_ROOT, previewLocation, previewTitle, previewCaption, previewFor };
