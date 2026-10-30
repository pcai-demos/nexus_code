/**
 * U-ROUTE — parser routing (evaluation-plan §2).
 *
 * `getParserForFile` (src/lib/ingestion/parser.js:776-808) selects a parser from
 * FILENAME SUBSTRINGS. Audit E12 records that the patterns are bare `includes()`
 * checks, so an unrelated document whose name happens to contain "dpa", "psr",
 * "pci" or "sysc" is routed to a domain parser and subjected to that parser's
 * header/footer stripping.
 *
 * These tests pin the routing table as it stands today (so a change is visible)
 * and mark the defective behaviour with its owning ticket.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { absPath, readFixture, missingRegenerableFixture } = require("./_helpers");
const { getParserForFile, extractPages, routeForFileName } = require("../../src/lib/ingestion/parser.js");

const MISLEADING = "tests/fixtures/golden/adversarial/misleading_name_dpa.pdf";
// Git-ignored (a byte copy of a corpus document), so it may be absent on a
// fresh clone until the derivation script has been run.
const MISSING_PROBE = missingRegenerableFixture(MISLEADING);

function routeOf(sourceId, config = {}) {
  const parser = getParserForFile(sourceId, readFixture(sourceId), config, absPath(sourceId));
  return parser.constructor.name;
}

describe("U-ROUTE: documented routing table", () => {
  const cases = [
    ["public/demos/demo_files/ext_reg_docs/FCA_SYSC_June2026.pdf", "SyscParser"],
    ["public/demos/demo_files/ext_reg_docs/PCI-DSS-v4_0_1_June2024.pdf", "PciDssParser"],
    ["public/demos/demo_files/ext_reg_docs/PSRs_2017_April2026.pdf", "PsrParser"],
    ["tests/fixtures/legacy_corpus/GraemeHick.pdf", "GenericParser"],
    ["tests/fixtures/legacy_corpus/Miele_washing_machine_manual.pdf", "GenericParser"],
    ["tests/fixtures/legacy_corpus/story.md", "MarkdownParser"],
    ["tests/fixtures/golden/md_headings.md", "MarkdownParser"],
    ["tests/fixtures/golden/text_basic.txt", "GenericParser"],
    ["tests/fixtures/golden/csv_table.csv", "GenericParser"],
  ];

  for (const [sourceId, expected] of cases) {
    test(`${sourceId.split("/").pop()} routes to ${expected}`, () => {
      assert.equal(routeOf(sourceId), expected);
    });
  }
});

describe("U-ROUTE: filename-substring misrouting", () => {
  test("T18 (t18-design D9): the router reads the file name's TOKENS — every corpus route holds, a misleading name is generic", () => {
    const table = [
      ["public/demos/demo_files/ext_reg_docs/FCA_SYSC_June2026.pdf", "sysc"], ["public/demos/demo_files/ext_reg_docs/PCI-DSS-v4_0_1_June2024.pdf", "pci"],
      ["public/demos/demo_files/ext_reg_docs/PSRs_2017_April2026.pdf", "psr"], ["tests/fixtures/legacy_corpus/GraemeHick.pdf", "generic"],
      ["tests/fixtures/legacy_corpus/story.md", "markdown"], ["dpa_2018_c12.pdf", "dpa"], ["DPA.pdf", "dpa"], ["psrs_2017.pdf", "psr"], ["psr.pdf", "psr"], ["sysc.pdf", "sysc"],
      [MISLEADING, "generic"], ["gdpa_notes.pdf", "generic"], ["topical_report.pdf", "generic"], ["pci_invoice.pdf", "generic"], ["my_psrs_notes.pdf", "generic"], ["notes.markdown", "markdown"],
    ];
    for (const [name, want] of table) assert.equal(routeForFileName(name), want, name);
  });

  test("a generic document named *_dpa.pdf is routed to GenericParser (T18 — it used to be DpaParser by a bare substring)", { skip: MISSING_PROBE }, () => {
    assert.equal(routeOf(MISLEADING), "GenericParser");
  });

  test(
    "a generic document named *_dpa.pdf must not lose content to DPA header stripping (audit E12 — the todo flipped by T18, design D9)",
    { skip: MISSING_PROBE },
    async () => {
      const pages = await extractPages(readFixture(MISLEADING));
      const parser = getParserForFile(MISLEADING, readFixture(MISLEADING), {}, absPath(MISLEADING));

      assert.equal(
        parser.constructor.name,
        "GenericParser",
        "an unrelated document must not be routed to a domain-specific parser"
      );
      assert.ok(pages.length > 0, "fixture should extract at least one page");
    }
  );

  test("domain parsers expose the header/footer pattern that drives stripping", { skip: MISSING_PROBE }, () => {
    // Documents the blast radius of a misroute: these patterns are applied to
    // the first and last three lines of every page (parser.js:165-185).
    // T18 (design D9): the misleading name is generic now; a real DPA name (the same bytes) still routes to DpaParser.
    const dpa = getParserForFile("tests/fixtures/golden/adversarial/dpa_2018_probe.pdf", readFixture(MISLEADING), {}, absPath(MISLEADING));
    assert.equal(dpa.constructor.name, "DpaParser");
    assert.ok(dpa.headerFooterPattern instanceof RegExp, "DpaParser should define a strip pattern");

    const generic = getParserForFile(
      "tests/fixtures/legacy_corpus/GraemeHick.pdf",
      readFixture("tests/fixtures/legacy_corpus/GraemeHick.pdf"),
      {},
      absPath("tests/fixtures/legacy_corpus/GraemeHick.pdf")
    );
    assert.equal(generic.headerFooterPattern, null, "GenericParser should not strip headers");
  });
});
