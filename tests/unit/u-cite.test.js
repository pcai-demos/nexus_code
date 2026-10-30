/**
 * U-CITE — citation contract (evaluation-plan §2, ticket T14).
 *
 * Pre-T14 there was no contract: context blocks were pasted into the prompt as
 * free text and the model cited pages in prose that nothing validated.
 * inputs/trace_logs/doc_log_01.txt captures the consequence — a PCI-DSS answer
 * citing quoted text at arithmetically spaced page numbers that do not
 * correspond to the document (audit E32 / FM-N7). These cases pin the contract
 * src/lib/rag/citations.js now enforces:
 *
 *   1. numbering and mapping are the same loop: markers S1..Sn in render order,
 *      spec chunks first, legend chunks continuing the sequence under their heading
 *   2. pagination honesty (F-11/F-30): a singlePage file's chunks are never
 *      presented under a page number; unknown attribution shows the stored page
 *   3. extractCitations resolves [S#] groups (comma lists, lowercase),
 *      de-duplicates in first-appearance order, and reports out-of-range
 *      markers as invalid instead of citing them
 *   4. findPageClaims matches prose page mentions and nothing else — bare "P1"
 *      product codes are not claims, and range tails ("pages 3-5") are pinned out
 *   5. auditAnswer flags fabricated pages and phantom markers as uncitedClaims,
 *      and is total: junk input yields empty results, never a throw
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const {
  buildNumberedContext,
  buildReferencePages,
  extractCitations,
  findPageClaims,
  judgePageClaims,
  auditAnswer,
} = require("../../src/lib/rag/citations");

/** A retrieved chunk in the shape the orchestrator hands over. */
const chunk = (over = {}) => ({
  source: "SpecSheet_A.pdf",
  page: 4,
  sectionNumber: "2.3",
  sectionTitle: "Kitchen",
  text: "Counter height is 900mm.",
  metadata: "{}",
  ...over,
});

/** A three-block context for the extraction cases. */
const threeBlockMap = () =>
  buildNumberedContext({
    specChunks: [
      chunk({ source: "A.pdf", page: 4 }),
      chunk({ source: "B.pdf", page: 7, sectionNumber: "3.1", sectionTitle: "Lobby" }),
      chunk({ source: "C.pdf", page: 9 }),
    ],
  }).contextMap;

/** An n-block context for the marker-form cases. */
const mapOf = (n) =>
  buildNumberedContext({
    specChunks: Array.from({ length: n }, (_, i) => chunk({ source: `D${i + 1}.pdf`, page: i + 1 })),
  }).contextMap;

describe("U-CITE/T28: companion blocks (t28-design §4)", () => {
  test("a companion block names its reason and the anchor's marker in the header and carries companionOf / companionKind in the map; a ranked block carries neither", () => {
    const anchor = chunk({ source: "Fervi.pdf", page: 25, text: "see Figure 15" });
    const companion = { ...chunk({ source: "Fervi.pdf", page: 25, text: "Figure 15 - 1728 x 440 mm", imagePath: "/extracted_images/x/fig_25_0.png" }), companion: { anchor, kind: "caption", reason: "figure caption on the same page (page 25) as the retrieved passage" } };
    const { contextText, contextMap } = buildNumberedContext({ specChunks: [chunk({ source: "A.pdf" }), anchor, companion] });
    assert.deepStrictEqual(contextMap.map((e) => e.marker), ["S1", "S2", "S3"]);
    assert.ok(!("companionOf" in contextMap[0]) && !("companionKind" in contextMap[0]), "a ranked block carries no companion field");
    assert.ok(!("companionOf" in contextMap[1]));
    assert.strictEqual(contextMap[2].companionOf, "S2");
    assert.strictEqual(contextMap[2].companionKind, "caption");
    assert.strictEqual(contextMap[2].imagePath, "/extracted_images/x/fig_25_0.png");
    assert.match(contextText, /\[S3\] \(Document: Fervi\.pdf, Page: 25, Section: 2\.3 Kitchen, Companion: figure caption on the same page \(page 25\) as the retrieved passage — belongs with \[S2\]\)\nFigure 15/);
  });

  test("a companion whose anchor was filtered out of the context still renders, with no marker to belong with", () => {
    const anchor = chunk({ source: "Fervi.pdf", page: 25 });
    const companion = { ...chunk({ source: "Fervi.pdf", page: 25, text: "cap" }), companion: { anchor, kind: "text" } };
    const { contextText, contextMap } = buildNumberedContext({ specChunks: [companion] });
    assert.strictEqual(contextMap[0].companionOf, null);
    assert.strictEqual(contextMap[0].companionKind, "text");
    assert.match(contextText, /Companion: page text for the retrieved figure\)\ncap/);
    assert.ok(!/belongs with/.test(contextText));
  });

  test("junk companion annotations never throw", () => {
    for (const bad of [null, 42, "x", {}, { anchor: null, kind: "weird", reason: 7 }]) {
      const { contextMap } = buildNumberedContext({ specChunks: [{ ...chunk(), companion: bad }] });
      assert.strictEqual(contextMap.length, 1);
    }
  });
});

describe("U-CITE: numbered context construction", () => {
  test("markers run S1..Sn in render order: spec chunks first, legend continues under its heading", () => {
    const { contextText, contextMap } = buildNumberedContext({
      specChunks: [chunk({ source: "A.pdf" }), chunk({ source: "B.pdf" })],
      legendChunks: [chunk({ source: "Legend.pdf", page: 1 }), chunk({ source: "Legend.pdf", page: 1 })],
    });
    assert.deepStrictEqual(
      contextMap.map((e) => e.marker),
      ["S1", "S2", "S3", "S4"]
    );
    // The legend does not restart numbering — [S3] appears after its heading.
    const heading = contextText.indexOf("[Document Master Index / Site Plan Map Legend (Page 1 Overview)]");
    assert.ok(heading > contextText.indexOf("[S2] ("), "legend heading follows the spec blocks");
    assert.ok(contextText.indexOf("[S3] (") > heading, "legend blocks are numbered under the heading");
  });

  test('header line format is "[S1] (Document: X, Page: 4, Section: 2.3 Kitchen)"', () => {
    const { contextText } = buildNumberedContext({ specChunks: [chunk()] });
    assert.ok(
      contextText.includes("[S1] (Document: SpecSheet_A.pdf, Page: 4, Section: 2.3 Kitchen)"),
      `header not found in:\n${contextText}`
    );
  });

  test("each contextMap entry carries marker, source, page, sectionPath, imagePath, title and pageAttribution", () => {
    const { contextMap } = buildNumberedContext({
      specChunks: [chunk({ imagePath: "images/p4.png" })],
    });
    assert.deepStrictEqual(contextMap[0], {
      marker: "S1",
      source: "SpecSheet_A.pdf",
      page: 4,
      sectionPath: "2.3 Kitchen",
      imagePath: "images/p4.png",
      // T49 (design D3 a): the stored title, null on a chunk whose metadata carries none.
      title: null,
      pageAttribution: "unknown",
      locationKind: "page",
    });
  });

  // T49 (design D3 a, §2.5; F-178): the stored `humanTitle` rides on the citation as `title`; the prompt does not move.
  test("T49: a caption chunk whose metadata carries humanTitle → the entry's title equals it (trimmed); a chunk without → null; the header and the contextText are byte-identical to the same call without the field", () => {
    const caption = chunk({
      source: "Fervi_Lathe_TechnicalSupportManual.pdf",
      page: 25,
      sectionNumber: "8",
      sectionTitle: "ASSEMBLY AND COMMISSIONING",
      text: "[HUMAN-LOGICAL VISUAL ELEMENT: Figure 15 – Dimensions and fastening points | Section: 8 ASSEMBLY AND COMMISSIONING (Page 25)]: TITLE: Figure 15 – Dimensions and fastening points",
      imagePath: "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_25_0.png",
      metadata: JSON.stringify({ humanTitle: "  Figure 15 – Dimensions and fastening points ", diagramType: "dimensioned drawing", sectionHeading: "8 ASSEMBLY AND COMMISSIONING", imagePath: "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_25_0.png" }),
    });
    const text = chunk({ source: "Fervi_Lathe_TechnicalSupportManual.pdf", page: 25, sectionNumber: "8", sectionTitle: "ASSEMBLY AND COMMISSIONING", text: "8.2 Support base …" });
    const facts = { "Fervi_Lathe_TechnicalSupportManual.pdf": true };
    const { contextText, contextMap } = buildNumberedContext({ specChunks: [caption, text], paginationFacts: facts });
    assert.strictEqual(contextMap[0].title, "Figure 15 – Dimensions and fastening points", "the stored fact, trimmed — never re-parsed from the text");
    assert.strictEqual(contextMap[0].imagePath, "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_25_0.png");
    assert.strictEqual(contextMap[1].title, null);
    assert.ok(contextText.includes("[S1] (Document: Fervi_Lathe_TechnicalSupportManual.pdf, Page: 25, Section: 8 ASSEMBLY AND COMMISSIONING)\n[HUMAN-LOGICAL"), contextText);
    assert.ok(!/Figure 15 – Dimensions and fastening points\)/.test(contextText) && !/Title:/.test(contextText), "the header carries no title — no prompt byte moves (D3 a)");
    // The same chunks with the title stripped from the metadata: the prompt is byte-identical; only the entry differs.
    const stripped = { ...caption, metadata: JSON.stringify({ diagramType: "dimensioned drawing", sectionHeading: "8 ASSEMBLY AND COMMISSIONING", imagePath: "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_25_0.png" }) };
    const again = buildNumberedContext({ specChunks: [stripped, text], paginationFacts: facts });
    assert.strictEqual(again.contextText, contextText);
    assert.strictEqual(again.contextMap[0].title, null);
    const { title: t0, ...rest0 } = contextMap[0];
    const { title: t1, ...rest1 } = again.contextMap[0];
    assert.deepStrictEqual(rest0, rest1, "every other field of the entry is unchanged");
  });

  test("T49: a blank or non-string humanTitle is null; junk metadata is null — the field is total", () => {
    for (const metadata of [JSON.stringify({ humanTitle: "   " }), JSON.stringify({ humanTitle: 15 }), JSON.stringify({ humanTitle: null }), "{}", "not json", ""]) {
      const { contextMap } = buildNumberedContext({ specChunks: [chunk({ metadata })] });
      assert.strictEqual(contextMap[0].title, null, JSON.stringify(metadata));
      assert.ok("title" in contextMap[0], "the key is always present on the entry (the wire's shape)");
    }
  });

  // T35 (design D6): a chunk whose page text OCR read says so in the header; the entry and the chip are unchanged.
  test("T35: a chunk with metadata.textSource ocr carries `Text: OCR` in its header after the section; any other chunk does not", () => {
    const { contextText, contextMap } = buildNumberedContext({
      specChunks: [chunk({ source: "Brochure.pdf", page: 2, sectionNumber: "", sectionTitle: "", metadata: JSON.stringify({ textSource: "ocr", sectionHeading: "Ground Floor" }) }), chunk()],
      paginationFacts: { "Brochure.pdf": true, "SpecSheet_A.pdf": true },
    });
    assert.ok(contextText.includes("[S1] (Document: Brochure.pdf, Page: 2, Section: N/A, Text: OCR)"), contextText);
    assert.ok(contextText.includes("[S2] (Document: SpecSheet_A.pdf, Page: 4, Section: 2.3 Kitchen)"), "a chunk with a text layer says nothing about its text's source");
    assert.strictEqual(contextMap[0].page, 2);
    assert.strictEqual(contextMap[0].locationKind, "page", "the location is the page, as for any chunk");
    assert.ok(!("textSource" in contextMap[0]), "the entry (the chip) is unchanged");
  });

  // T34 (design D5, D7): what locates a block — page | slide | section | none.
  test("T34: a pptx chunk's page is its SLIDE — the header says `Slide: 8`, the entry `locationKind: slide`; a pdf's is a page", () => {
    const { contextText, contextMap } = buildNumberedContext({
      specChunks: [chunk({ source: "Deck.pptx", fileType: "pptx", page: 8, sectionNumber: "", sectionTitle: "" }), chunk()],
      paginationFacts: { "Deck.pptx": true, "SpecSheet_A.pdf": true },
    });
    assert.ok(contextText.includes("[S1] (Document: Deck.pptx, Slide: 8, Section: N/A)"), contextText);
    assert.ok(contextText.includes("[S2] (Document: SpecSheet_A.pdf, Page: 4, Section: 2.3 Kitchen)"));
    assert.strictEqual(contextMap[0].locationKind, "slide");
    assert.strictEqual(contextMap[0].page, 8);
    assert.strictEqual(contextMap[1].locationKind, "page");
  });

  test("T34: a singlePage file's chunk with a section path is located by its SECTION (`Section: <path>`, no page word anywhere in the header); one with no section is `none`", () => {
    const { contextText, contextMap } = buildNumberedContext({
      specChunks: [
        chunk({ source: "TCO.docx", fileType: "docx", page: 1, sectionNumber: "", sectionTitle: "Section 10: Cloud Data Transfer Costs, Data Residency & Sovereignty › 10.3 What egress costs" }),
        chunk({ source: "TCO.docx", fileType: "docx", page: 1, sectionNumber: "", sectionTitle: "", metadata: "{}" }),
      ],
      paginationFacts: { "TCO.docx": false },
    });
    assert.ok(contextText.includes("[S1] (Document: TCO.docx, Section: Section 10: Cloud Data Transfer Costs, Data Residency & Sovereignty › 10.3 What egress costs)"), contextText);
    assert.ok(contextText.includes("[S2] (Document: TCO.docx, Section: N/A)"));
    assert.ok(!/Page:|Slide:/.test(contextText.split("\n").filter((l) => l.startsWith("[S")).join("\n")), "no page word on a singlePage header");
    assert.deepStrictEqual(contextMap.map((e) => [e.page, e.locationKind, e.sectionPath]), [[null, "section", "Section 10: Cloud Data Transfer Costs, Data Residency & Sovereignty › 10.3 What egress costs"], [null, "none", null]]);
    const { citations } = extractCitations("[S1]", contextMap);
    assert.strictEqual(citations[0].locationKind, "section");
    assert.strictEqual(citations[0].page, null);
  });

  test("T34: locationKindFor and isSlideDeck are total", () => {
    const { locationKindFor, isSlideDeck } = require("../../src/lib/rag/citations");
    assert.strictEqual(locationKindFor(4, "x", { fileType: "pdf" }), "page");
    assert.strictEqual(locationKindFor(4, null, { fileType: "PPTX" }), "slide");
    assert.strictEqual(locationKindFor(null, "x", { fileType: "docx" }), "section");
    assert.strictEqual(locationKindFor(null, null, {}), "none");
    assert.strictEqual(locationKindFor(null, "", null), "none");
    assert.strictEqual(isSlideDeck({ fileType: "pptx" }), true);
    assert.strictEqual(isSlideDeck({ fileType: "pdf" }), false);
    assert.strictEqual(isSlideDeck(null), false);
  });

  test("startLine+endLine metadata adds a Lines suffix to the header", () => {
    const { contextText } = buildNumberedContext({
      specChunks: [chunk({ metadata: JSON.stringify({ startLine: 10, endLine: 22 }) })],
    });
    assert.ok(
      contextText.includes("[S1] (Document: SpecSheet_A.pdf, Page: 4, Section: 2.3 Kitchen, Lines: 10-22)"),
      `Lines suffix not found in:\n${contextText}`
    );
  });
});

describe("U-CITE: pagination honesty (F-11/F-30)", () => {
  test("a singlePage file is never presented under a page number", () => {
    // The synthesized "page 1" of a .docx is not a location — the header drops
    // Page: entirely and the map entry carries null, not 1.
    const { contextText, contextMap } = buildNumberedContext({
      specChunks: [chunk({ source: "B.docx", page: 1, sectionNumber: "", sectionTitle: "Appendix B" })],
      paginationFacts: { "B.docx": false },
    });
    assert.ok(!contextText.includes("Page:"), `singlePage header must not carry Page:\n${contextText}`);
    assert.ok(contextText.includes("[S1] (Document: B.docx, Section: Appendix B)"));
    assert.strictEqual(contextMap[0].page, null);
    assert.strictEqual(contextMap[0].pageAttribution, "singlePage");
  });

  test("an observed-paginated file reports paginated with its page shown", () => {
    const { contextText, contextMap } = buildNumberedContext({
      specChunks: [chunk()],
      paginationFacts: { "SpecSheet_A.pdf": true },
    });
    assert.ok(contextText.includes("Page: 4"));
    assert.strictEqual(contextMap[0].page, 4);
    assert.strictEqual(contextMap[0].pageAttribution, "paginated");
  });

  test("a file with no observed ingest is unknown, with the stored page shown as stored", () => {
    // Claiming "synthetic" without evidence would be a fabrication of its own.
    const { contextText, contextMap } = buildNumberedContext({ specChunks: [chunk()] });
    assert.ok(contextText.includes("Page: 4"));
    assert.strictEqual(contextMap[0].page, 4);
    assert.strictEqual(contextMap[0].pageAttribution, "unknown");
  });
});

describe("U-CITE: pages that are not locations (review findings)", () => {
  test("a stored page of 0 renders unlocated — never rewritten to a fabricated Page: 1", () => {
    // Ingestion stores unparseable pages as 0; the old `page || 1` fallback
    // showed "Page: 1" while the audit's reference set carried the raw 0 —
    // the system would then flag its own displayed page as a fabrication.
    const { contextText, contextMap } = buildNumberedContext({
      specChunks: [chunk({ page: 0 })],
    });
    assert.ok(!contextText.includes("Page:"), "no Page: header for a zero-stored page");
    assert.strictEqual(contextMap[0].page, null);
  });

  test("buildReferencePages keeps raw pages, drops known-synthetic-only pages, keeps shared pages", () => {
    const chunks = [
      { source: "real.pdf", page: 4 },
      { source: "real.pdf", page: 1 },
      { source: "stamped.docx", page: 1 }, // synthetic, but page 1 is also real.pdf's
      { source: "stamped.docx", page: 99 }, // hypothetical synthetic-only page
      { source: "unknown.pdf", page: 7 }, // no facts: kept (F-30 — never guessed)
    ];
    const facts = { "real.pdf": true, "stamped.docx": false };
    assert.deepStrictEqual(buildReferencePages(chunks, facts).sort((a, b) => a - b), [1, 4, 7]);
    // With no facts at all, every page is kept.
    assert.deepStrictEqual(buildReferencePages(chunks, {}).sort((a, b) => a - b), [1, 4, 7, 99]);
  });
});

describe("U-CITE: marker extraction", () => {
  test("[S1][S3] markers map to the correct retrieved chunks", () => {
    const { citations, invalidMarkers } = extractCitations("[S1][S3]", threeBlockMap());
    assert.deepStrictEqual(citations.map((c) => c.marker), ["S1", "S3"]);
    assert.deepStrictEqual(citations.map((c) => c.source), ["A.pdf", "C.pdf"]);
    assert.deepStrictEqual(invalidMarkers, []);
  });

  test("each citation carries source, page, sectionPath, imagePath and title (the wire's shape)", () => {
    const { contextMap } = buildNumberedContext({
      specChunks: [chunk({ imagePath: "images/p4.png" })],
    });
    const { citations } = extractCitations("see [S1]", contextMap);
    assert.deepStrictEqual(citations, [
      {
        marker: "S1",
        source: "SpecSheet_A.pdf",
        page: 4,
        sectionPath: "2.3 Kitchen",
        imagePath: "images/p4.png",
        // T49 (design D3 a): the stored title rides on the citation — null when the chunk carries none.
        title: null,
        pageAttribution: "unknown",
        locationKind: "page",
      },
    ]);
  });

  test("comma lists and lowercase markers parse: [S1, S3] and [s2]", () => {
    const { citations, invalidMarkers } = extractCitations("Per [S1, S3] and [s2].", threeBlockMap());
    assert.deepStrictEqual(citations.map((c) => c.marker), ["S1", "S3", "S2"]);
    assert.deepStrictEqual(invalidMarkers, []);
  });

  test("repeated markers are de-duplicated in the citations array", () => {
    const dup = extractCitations("[S1] again [S1, S1]", threeBlockMap());
    assert.strictEqual(dup.citations.length, 1);
    assert.strictEqual(dup.citations[0].marker, "S1");
    // De-duplication keeps first-appearance order.
    const ordered = extractCitations("[S3][S1][S3]", threeBlockMap());
    assert.deepStrictEqual(ordered.citations.map((c) => c.marker), ["S3", "S1"]);
  });

  test("conjunction and Oxford lists parse: [S1 and S2], [S1, S2, and S3], [S1 & S2]", () => {
    // Review finding: models join markers with "and" despite the comma
    // example; dropping the whole group silently un-cited grounded answers.
    const map = mapOf(3);
    assert.deepStrictEqual(extractCitations("[S1 and S2]", map).citations.map((c) => c.marker), ["S1", "S2"]);
    assert.deepStrictEqual(extractCitations("[S1, S2, and S3]", map).citations.map((c) => c.marker), ["S1", "S2", "S3"]);
    assert.deepStrictEqual(extractCitations("[S1 & S2]", map).citations.map((c) => c.marker), ["S1", "S2"]);
  });

  test("ranges expand inclusively: [S1-S3] cites S1, S2 and S3", () => {
    const map = mapOf(4);
    assert.deepStrictEqual(extractCitations("[S1-S3]", map).citations.map((c) => c.marker), ["S1", "S2", "S3"]);
    assert.deepStrictEqual(extractCitations("[S2–S4]", map).citations.map((c) => c.marker), ["S2", "S3", "S4"]);
  });

  test("four-digit phantom markers are flagged, not silently ignored: [S1000]", () => {
    const { citations, invalidMarkers } = extractCitations("[S1000]", mapOf(3));
    assert.deepStrictEqual(citations, []);
    assert.deepStrictEqual(invalidMarkers, [1000]);
  });

  test("prose brackets never parse as citations: [Source 1], [see above]", () => {
    for (const text of ["[Source 1]", "[see above]", "[note: S is the marker]"]) {
      const { citations, invalidMarkers } = extractCitations(text, mapOf(3));
      assert.deepStrictEqual(citations, [], text);
      assert.deepStrictEqual(invalidMarkers, [], text);
    }
  });

  test("an out-of-range marker lands in invalidMarkers, never in citations", () => {
    const { citations, invalidMarkers } = extractCitations("[S9] and [S1]", threeBlockMap());
    assert.deepStrictEqual(citations.map((c) => c.marker), ["S1"]);
    assert.deepStrictEqual(invalidMarkers, [9]);
  });
});

describe("U-CITE: page-claim regex pins", () => {
  /** Every prose form the extractor must catch, with the page it names. */
  const CLAIM_CASES = [
    ["see Page 6 for the detail", 6],
    ["Page: 99", 99],
    ["across pages 12 onward", 12],
    ["pp. 9", 9],
    ["p. 12", 12],
  ];

  for (const [text, page] of CLAIM_CASES) {
    test(`"${text}" claims page ${page}`, () => {
      const claims = findPageClaims(text);
      assert.strictEqual(claims.length, 1, `expected one claim in "${text}"`);
      assert.strictEqual(claims[0].page, page);
      assert.strictEqual(typeof claims[0].excerpt, "string");
    });
  }

  test("bare P-codes and measurements are not page claims", () => {
    // "P1"/"P2" false-positive on product codes; "50mm" is a dimension.
    assert.deepStrictEqual(findPageClaims("The P1 and P2 pumps ship with 50mm couplings."), []);
  });

  test('domain notations are not page claims: "PG 64-22" asphalt grades, initials before "P."', () => {
    // Review finding: "pg" collides with Performance-Grade binder notation
    // (standard in this corpus's domain), so the pg/pgs forms are deliberately
    // NOT claims; a dotted "P." straight after an initial is a name, not a page.
    assert.deepStrictEqual(findPageClaims("Use PG 64-22 binder; rated PG 13."), []);
    assert.deepStrictEqual(findPageClaims("Contact J.P. 500 for access."), []);
    assert.deepStrictEqual(findPageClaims("pg 7 and pgs 9 are abbreviations we no longer accept"), []);
  });

  test('inventory figures are not location claims: "Total pages: 39"', () => {
    // The doc-store summary above the context states per-file totals; an
    // answer echoing one is honest and must not be flagged (review finding).
    assert.deepStrictEqual(findPageClaims("The manual has Total pages: 39."), []);
    assert.deepStrictEqual(findPageClaims("Total Pages: 39"), []);
    // ...but a real location claim right after an inventory phrase still counts.
    assert.deepStrictEqual(findPageClaims("Total pages: 39; details on page 6.").map((c) => c.page), [6]);
  });

  test('"pages 3-5" yields only page 3 — range tails are not claims (deliberate, pinned)', () => {
    assert.deepStrictEqual(findPageClaims("covered in pages 3-5").map((c) => c.page), [3]);
  });
});

describe("U-CITE: page-claim judgement", () => {
  test("claims split on page-number membership — any source, lenient by design", () => {
    // Stricter source+page pairing would need prose-attribution heuristics;
    // the module deliberately accepts a page found on ANY retrieved chunk.
    const claims = findPageClaims("Page 4 says X; Page: 99 says Y; page 7 says Z");
    const { supported, fabricated } = judgePageClaims(claims, [4, 7]);
    assert.deepStrictEqual(supported.map((c) => c.page), [4, 7]);
    assert.deepStrictEqual(fabricated.map((c) => c.page), [99]);
  });
});

describe("U-CITE: fabrication detection", () => {
  const audit = (answer) => {
    const { contextMap } = buildNumberedContext({
      specChunks: [chunk({ source: "A.pdf", page: 4 }), chunk({ source: "B.pdf", page: 7 })],
    });
    return auditAnswer({ answer, contextMap, referencePages: [4, 7] });
  };

  test("a page number cited that matches no retrieved chunk increments uncitedClaims", () => {
    // The doc_log_01.txt regression in miniature: answer says "Page: 99" while
    // no retrieved block came from page 99.
    const { citations, uncitedClaims } = audit("The requirement appears on Page: 99 of the standard [S1].");
    assert.strictEqual(uncitedClaims.length, 1);
    assert.match(uncitedClaims[0], /page 99/);
    assert.deepStrictEqual(citations.map((c) => c.marker), ["S1"]);
  });

  test("an answer citing only valid [S#] markers reports zero uncitedClaims", () => {
    const { citations, uncitedClaims, pageClaimCount } = audit(
      "Counter height is 900mm [S1], confirmed on page 7 [S2]."
    );
    assert.deepStrictEqual(uncitedClaims, []);
    assert.deepStrictEqual(citations.map((c) => c.marker), ["S1", "S2"]);
    // The page-7 mention counts as a claim — it is supported, not absent.
    assert.strictEqual(pageClaimCount, 1);
  });

  test("an out-of-range marker names the phantom block and the real block count", () => {
    const { uncitedClaims } = audit("As shown in [S9].");
    assert.deepStrictEqual(uncitedClaims, [
      "cited context block [S9] does not exist (context has 2 blocks)",
    ]);
  });

  test("repeated fabricated claims of one page collapse to a single entry with a multiplier", () => {
    const { uncitedClaims } = audit("See Page: 99. As noted, page 99 defines the scope.");
    assert.strictEqual(uncitedClaims.length, 1);
    assert.match(uncitedClaims[0], /page 99/);
    assert.match(uncitedClaims[0], /\(×2\)/);
  });
});

describe("U-CITE: totality — auditAnswer never throws", () => {
  test("junk answers, maps and reference pages yield empty results, not exceptions", () => {
    const JUNK = [
      undefined,
      {},
      { answer: null, contextMap: null, referencePages: null },
      { answer: undefined, contextMap: undefined, referencePages: undefined },
      { answer: 12, contextMap: "garbage", referencePages: "garbage" },
      { answer: {}, contextMap: [{}, 42], referencePages: [null] },
    ];
    for (const input of JUNK) {
      const r = auditAnswer(input);
      assert.deepStrictEqual(
        r,
        { citations: [], uncitedClaims: [], pageClaimCount: 0 },
        `expected empty results for ${JSON.stringify(input)}`
      );
    }
  });

  test("an answer beyond the 1MB scan window is truncated, not thrown on", () => {
    // Markers and claims past the window are ignored — the audit stays total.
    const { contextMap } = buildNumberedContext({ specChunks: [chunk()] });
    const huge = "x".repeat(1_000_000) + " [S1] cited on Page: 99";
    const r = auditAnswer({ answer: huge, contextMap, referencePages: [] });
    assert.deepStrictEqual(r, { citations: [], uncitedClaims: [], pageClaimCount: 0 });
  });
});
