/**
 * T18 (t18-design.md D4, D6, §2.2) — the heading pick for a paginated document's page and chunk.
 *
 * Before T18 the page's heading was "the first line of 3–59 characters anywhere on the page" (with a list of brand
 * names and Barratt phrases to skip) and the chunk's heading the first uppercase-looking match of
 * /^([A-Z0-9\s\-\.\:\(\)]{4,50})$/m — whose `\s` spanned `\r\n`, so two lines of a running header, a page number and
 * the line after it, or FCA's rule-status column (`G\nG\nG\nG`) were one "heading" (F-167: 105 production headers
 * with a newline in them). Measured with the running lines removed first (t18-design.md §0d): the page-top rule then
 * takes the first BODY line — `designed to protect the operator/user from possible injury.` — as the heading.
 *
 * The rules, and only the rules:
 *   - `pageTopHeading(text)`: the first HEADING-SHAPED line within the page's first `PAGE_TOP_LINES` non-empty lines —
 *     3 to 59 characters, no terminal `. , ; :`, not starting with a lowercase letter or a bracket, four letters or
 *     more, not a `Page N …` line, and the next non-empty line not a lowercase continuation (a wrapped sentence);
 *     null when no line qualifies (the chunk then reads `[Page N]` — honest);
 *   - `uppercaseHeading(text)`: the first run of consecutive lines matching the uppercase shape where EACH line has
 *     four letters or more and more letters than digits — a blank line ends the run — joined by a SPACE (never a
 *     newline), at most `UPPERCASE_MAX` characters — `OPERATION AND\nMAINTENANCE MANUAL` is `OPERATION AND MAINTENANCE MANUAL`;
 *     `2:39`, `289 289`, `G\nG\nG` are not headings; null when none;
 *   - `chunkHeading(text)`: a markdown `#` heading line, else `uppercaseHeading`, else null.
 * No name of any document, brand or phrase appears here; nothing restores a line another rule removed.
 *
 * Pure: strings in, a string or null out (U-HEADING). Transportable (the standing aim).
 */

const PAGE_TOP_LINES = 5;
const HEADING_MIN = 3;
const HEADING_MAX = 59;
const HEADING_LETTERS = 4;
const UPPERCASE_MAX = 50;
const PAGE_N = /^page\s+\d+(\s+of\s+\d+)?\s*/i;
const UPPERCASE_LINE = /^[A-Z0-9\s\-\.\:\(\)]{4,50}$/;

const letters = (s) => (String(s).match(/[A-Za-z]/g) || []).length;
const digits = (s) => (String(s).match(/\d/g) || []).length;
const nonEmptyLines = (text) => String(text ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);

/** Whether `line` is heading-shaped (see the module comment); `next` is the following non-empty line, if any. */
function isHeadingShaped(line, next = "") {
  const l = String(line ?? "").trim();
  if (l.length < HEADING_MIN || l.length > HEADING_MAX) return false;
  if (/[.,;:]$/.test(l)) return false;
  if (/^[a-z(\[{]/.test(l)) return false;
  if (letters(l) < HEADING_LETTERS) return false;
  if (/^page\s+\d/i.test(l)) return false;
  if (next && /^[a-z]/.test(String(next).trim())) return false;
  return true;
}

/** The page's heading: the first heading-shaped line within its first PAGE_TOP_LINES non-empty lines, or null. */
function pageTopHeading(text) {
  const lines = nonEmptyLines(text);
  const head = lines.slice(0, PAGE_TOP_LINES);
  for (let i = 0; i < head.length; i++) if (isHeadingShaped(head[i], lines[i + 1] || "")) return head[i];
  return null;
}

/** An uppercase line that can head a chunk: the uppercase shape, four letters or more, more letters than digits. */
function isUppercaseHeadingLine(line) {
  const l = String(line ?? "").trim();
  return UPPERCASE_LINE.test(l) && letters(l) >= HEADING_LETTERS && letters(l) > digits(l);
}

/**
 * The first run of CONSECUTIVE uppercase heading lines (a blank line ends a run), joined by a space, at most
 * UPPERCASE_MAX characters; or null.
 */
function uppercaseHeading(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!isUppercaseHeadingLine(lines[i])) continue;
    let h = lines[i];
    for (let j = i + 1; j < lines.length && isUppercaseHeadingLine(lines[j]) && `${h} ${lines[j]}`.length <= UPPERCASE_MAX; j++) h = `${h} ${lines[j]}`;
    return h;
  }
  return null;
}

/** The chunk's heading: a markdown `#` heading, else the uppercase run, else null. */
function chunkHeading(text) {
  const md = String(text ?? "").match(/^#+\s*(.+)$/m);
  if (md && md[1].trim()) return md[1].trim();
  return uppercaseHeading(text);
}

/** A `Page N [of M]` prefix stripped from a title (the only strip left; the brand names are gone). */
function stripPageWord(title) {
  const t = String(title ?? "").trim().replace(PAGE_N, "").trim();
  return t || String(title ?? "").trim();
}

module.exports = {
  PAGE_TOP_LINES, HEADING_MIN, HEADING_MAX, HEADING_LETTERS, UPPERCASE_MAX,
  isHeadingShaped, pageTopHeading, isUppercaseHeadingLine, uppercaseHeading, chunkHeading, stripPageWord
};
