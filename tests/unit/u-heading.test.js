/**
 * U-HEADING — T18 (t18-design.md D4, D6, §2.2): the heading-pick module, pure.
 *
 * The rules pinned here are the ones the design probe measured side by side on the stripped pages (t18-design.md
 * §0d): a heading-SHAPED page-top line within the first five lines, and an uppercase run whose every line carries
 * letters, joined by a space — never a newline (F-167). The measured casualties of the shipped rules
 * (`designed to protect the operator/user from possible injury.`, `G\nG\nG\nG`, `2:39`, `MACHINES AND\r\nACCESSORIES`)
 * are the negative cases.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const ph = require("../../src/lib/ingestion/page_heading.js");

describe("U-HEADING: the page-top pick", () => {
  test("a title within the first five lines is the heading; a wrapped body line, a lowercase start, a bracket start, a terminal stop, a page word and a line without four letters are not", () => {
    assert.strictEqual(ph.pageTopHeading("PREFACE\nThis manual describes the lathe.\nMore text."), "PREFACE");
    assert.strictEqual(ph.pageTopHeading("2 GENERAL SAFETY WARNINGS\nThe operator must read this manual."), "2 GENERAL SAFETY WARNINGS");
    assert.strictEqual(ph.pageTopHeading("Textual Amendments\nF63 Words in reg. 2 inserted."), "Textual Amendments");
    assert.strictEqual(ph.pageTopHeading("designed to protect the operator/user from possible injury.\nnext line."), null, "a body line: lowercase start, terminal stop");
    assert.strictEqual(ph.pageTopHeading("Requirement 3.1.1 is about effectively managing and\nassigning roles."), null, "a wrapped sentence: the next line continues in lowercase");
    assert.strictEqual(ph.pageTopHeading("(b) be used only for holding those funds or assets [\nmore"), null, "a bracket start");
    assert.strictEqual(ph.pageTopHeading("3.2 Storage of account data is kept to a minimum.\nbody"), null, "a terminal stop");
    assert.strictEqual(ph.pageTopHeading("Page 58 of 84 fervi.com\nbody"), null, "a page word never heads a page");
    assert.strictEqual(ph.pageTopHeading("2:39\n289 289\n12 00\nbody"), null, "fewer than four letters");
    assert.strictEqual(ph.pageTopHeading("SA XONFI EL DS LINCOLN 4 BEDROOMHOME\nBED 2 BED 3"), "SA XONFI EL DS LINCOLN 4 BEDROOMHOME");
  });

  test("only the first five non-empty lines are read; a heading on the sixth line is not the page's; blank lines and \\r\\n do not count", () => {
    const body = ["one line.", "two lines.", "three lines.", "four lines.", "five lines."];
    assert.strictEqual(ph.pageTopHeading([...body, "Section Title", "text"].join("\n")), null);
    assert.strictEqual(ph.pageTopHeading([...body.slice(0, 4), "Section Title", "Text follows."].join("\r\n\r\n")), "Section Title");
    assert.strictEqual(ph.pageTopHeading(""), null);
    assert.strictEqual(ph.pageTopHeading(null), null);
  });

  test("the shape test is exported and bounded (3–59 characters)", () => {
    assert.strictEqual(ph.isHeadingShaped("Internal audit"), true);
    assert.strictEqual(ph.isHeadingShaped("Internal audit", "and its findings"), false, "the next line continues");
    assert.strictEqual(ph.isHeadingShaped("Internal audit", "Records"), true);
    assert.strictEqual(ph.isHeadingShaped("A".repeat(60)), false);
    assert.strictEqual(ph.isHeadingShaped("Ab"), false);
    assert.deepStrictEqual([ph.PAGE_TOP_LINES, ph.HEADING_MIN, ph.HEADING_MAX, ph.HEADING_LETTERS, ph.UPPERCASE_MAX], [5, 3, 59, 4, 50]);
  });
});

describe("U-HEADING: the chunk heading", () => {
  test("an uppercase run is joined by a space and never carries a newline; a blank line ends the run; the run is capped at 50 characters", () => {
    assert.strictEqual(ph.uppercaseHeading("OPERATION AND\r\nMAINTENANCE MANUAL\r\nThe lathe."), "OPERATION AND MAINTENANCE MANUAL");
    assert.strictEqual(ph.uppercaseHeading("TOKENS\n\nCHARACTERS\ntext"), "TOKENS", "a blank line ends the run");
    assert.strictEqual(ph.uppercaseHeading("MACHINES AND\nACCESSORIES\nbody"), "MACHINES AND ACCESSORIES");
    const long = ph.uppercaseHeading("ABCDEFGHIJ KLMNOPQRST\nUVWXYZ ABCDEFGHIJ KLMNOP\nQRSTUVWXYZ ABCDEFGHIJ\nbody");
    assert.ok(long.length <= 50 && !/\n/.test(long), long);
    assert.strictEqual(ph.chunkHeading("Some text\nOPERATION AND\nMAINTENANCE MANUAL"), "OPERATION AND MAINTENANCE MANUAL");
  });

  test("a line needs four letters and more letters than digits: the rule-status column, a time, a plot number and a number strip are not headings", () => {
    for (const bad of ["G\nG\nG\nG", "2:39\n3:19\n1:59", "289 289\n290 290", "12 00\n11 59", "1 2\n3\n4", "P\nN\nL\nM", "1\n0", "ECO 40-60 1600"]) assert.strictEqual(ph.uppercaseHeading(`${bad}\nbody`), null, JSON.stringify(bad));
    assert.strictEqual(ph.uppercaseHeading("SYSC 3.2.6G\nR\nR\nG"), "SYSC 3.2.6G", "letters four, more than the digits — one line, the column excluded");
    assert.strictEqual(ph.isUppercaseHeadingLine("A COMMON COMPLEX TASK CONSIDERED BY ENTERPRISE"), true);
    assert.strictEqual(ph.isUppercaseHeadingLine("lowercase words"), false);
  });

  test("a markdown heading wins over an uppercase run; none of either is null", () => {
    assert.strictEqual(ph.chunkHeading("# Master 3-Year TCO Table\nTOTALS BELOW\nrows"), "Master 3-Year TCO Table");
    assert.strictEqual(ph.chunkHeading("plain body text\nmore body"), null);
    assert.strictEqual(ph.chunkHeading(""), null);
  });

  test("stripPageWord removes only a leading `Page N [of M]` and never empties a title", () => {
    assert.strictEqual(ph.stripPageWord("Page 12 of 84 Spindle speeds"), "Spindle speeds");
    assert.strictEqual(ph.stripPageWord("page 3 Chester"), "Chester");
    assert.strictEqual(ph.stripPageWord("Page 4"), "Page 4", "a bare page word stays rather than an empty title");
    assert.strictEqual(ph.stripPageWord("Barratt Homes Chester"), "Barratt Homes Chester", "no brand strip anywhere (D6)");
    assert.strictEqual(ph.stripPageWord("  The Chester  "), "The Chester");
  });
});
