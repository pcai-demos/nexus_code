/**
 * U-PREVIEW — the cited figure's preview, the pure module (ticket T49,
 * t49-design.md §2.1, §4; F-178, F-184).
 *
 * Measured before the ticket (design §0): on T44's acceptance record
 * (`t44-artifacts/records/after/fs-1790261369.json`, six frontier turns) 28 of
 * the 43 citation chips carry `imagePath` — 11 distinct files, every one the
 * bridge's WHOLE-PAGE render (`fig_<page>_0.png`, page 25 of the lathe manual
 * 1190 × 1684, never a crop); the chip printed text only and a ranked caption
 * chunk's chip read like the page's text chunk's. These cases pin what the
 * module decides from the citation alone: which chip previews (the path under
 * the crops route, nothing else), what the caption says (the stored title
 * carried as `title`, then the chip's own source · location), and that the
 * module touches no DOM, fetch or clock. The rendered chip, popover and
 * lightbox are the owner's look (no JSX renderer in this runner — U-FAIL/T49
 * pins the panel's source).
 *
 * Case 2 reads the T44 record from the tree: in the pod it is present only on
 * an image rolled from a tree that holds PR #41's merge (T49's roll is the
 * first — design §5's condition; memory `unit-tests-run-on-the-deployed-image`).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const P = require("../../src/lib/rag/figure_preview");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RECORD = path.join(REPO_ROOT, "tests", "eval", "baselines", "t44-artifacts", "records", "after", "fs-1790261369.json");
const FIG25 = "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_25_0.png";

/** A citation as the chat route puts it on the wire (citations.js renderBlock, T14 / T28 / T34 / T49). */
const cite = (over = {}) => ({
  marker: "S6",
  source: "Fervi_Lathe_TechnicalSupportManual.pdf",
  page: 25,
  sectionPath: "8 ASSEMBLY AND COMMISSIONING",
  imagePath: FIG25,
  title: null,
  pageAttribution: "paginated",
  locationKind: "page",
  ...over,
});

/**
 * The chip's location expression, as ChatPanel.jsx writes it (T34 D5 / D7) —
 * copied here as JS so case 3 compares the module with the chip's rule on the
 * four kinds; U-FAIL/T49 pins the JSX itself unchanged.
 */
const chipLocation = (c) =>
  c.page != null
    ? ` · ${c.locationKind === "slide" ? "slide" : "p."}${c.locationKind === "slide" ? " " : ""}${c.page}`
    : c.sectionPath
      ? ` · §${String(c.sectionPath).split(" › ").pop()}`
      : "";

describe("U-PREVIEW: which chip previews — the path under the crops route, nothing else (design §2.1, D4)", () => {
  test("a citation with a path under /extracted_images/ previews: src the path as cited, alt = caption", () => {
    const p = P.previewFor(cite());
    assert.deepStrictEqual(p, {
      src: FIG25,
      title: null,
      caption: "Fervi_Lathe_TechnicalSupportManual.pdf · p.25",
      alt: "Fervi_Lathe_TechnicalSupportManual.pdf · p.25",
    });
    assert.strictEqual(P.PREVIEW_IMAGE_ROOT, "/extracted_images/");
  });

  test("null for a text chunk's citation (no path), an empty path, a non-string path, a path outside the crops route, the bare root", () => {
    assert.strictEqual(P.previewFor(cite({ imagePath: null })), null, "the page's text chunk — no path on the wire (§0c's scope note)");
    assert.strictEqual(P.previewFor(cite({ imagePath: undefined })), null);
    const { imagePath, ...noPath } = cite();
    assert.strictEqual(P.previewFor(noPath), null);
    assert.strictEqual(P.previewFor(cite({ imagePath: "" })), null);
    assert.strictEqual(P.previewFor(cite({ imagePath: 25 })), null);
    assert.strictEqual(P.previewFor(cite({ imagePath: ["/extracted_images/x/fig_1_0.png"] })), null);
    assert.strictEqual(P.previewFor(cite({ imagePath: "http://evil.example/extracted_images/x/fig_1_0.png" })), null, "an absolute URL is not a citation's path");
    assert.strictEqual(P.previewFor(cite({ imagePath: "/uploads/x.png" })), null);
    assert.strictEqual(P.previewFor(cite({ imagePath: "extracted_images/x/fig_1_0.png" })), null, "relative — not the route");
    assert.strictEqual(P.previewFor(cite({ imagePath: "/extracted_images/" })), null, "the root alone names no file");
  });

  test("total on junk: a non-object never throws and never previews", () => {
    for (const junk of [null, undefined, "S6", 6, true, [FIG25], () => FIG25]) {
      assert.strictEqual(P.previewFor(junk), null, `previewFor(${typeof junk})`);
      assert.strictEqual(P.previewCaption(junk), "", `previewCaption(${typeof junk})`);
      assert.strictEqual(P.previewLocation(junk), "", `previewLocation(${typeof junk})`);
      assert.strictEqual(P.previewTitle(junk), null, `previewTitle(${typeof junk})`);
    }
    assert.deepStrictEqual(P.previewFor({ imagePath: FIG25 }), { src: FIG25, title: null, caption: "", alt: "" }, "a path with nothing else still previews — the caption is empty, never 'undefined'");
  });

  test("companions preview as ranked chunks do: a T28 companion caption carrying a path previews, a companion text chunk without one does not", () => {
    assert.ok(P.previewFor(cite({ marker: "S1", page: 1, imagePath: "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_1_0.png", companionOf: null, companionKind: "caption" })));
    assert.strictEqual(P.previewFor(cite({ marker: "S8", page: 84, imagePath: null, companionOf: "S9", companionKind: "text" })), null);
  });
});

describe("U-PREVIEW: T44's acceptance record — 28 of the 43 chips preview, the eleven files are §0b's (design §0b, §4 case 2)", () => {
  // The record must be in the tree the units run from (the image after T49's roll): ENOENT here is a harness
  // reason — read verify_pod.sh's tests/ diff first.
  const record = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  const chips = record.turns.flatMap((t) => (t.citations || []).map((c) => ({ turn: `${t.id}/${t.scope}`, ...c })));

  test("six turns, 43 chips; exactly 28 preview and 15 do not — and every one that previews carries a path, every one that does not carries none", () => {
    assert.strictEqual(record.turns.length, 6);
    assert.strictEqual(chips.length, 43);
    const previews = chips.map((c) => ({ chip: c, preview: P.previewFor(c) }));
    assert.strictEqual(previews.filter((p) => p.preview).length, 28);
    assert.strictEqual(previews.filter((p) => !p.preview).length, 15);
    for (const { chip, preview } of previews) assert.strictEqual(!!preview, typeof chip.imagePath === "string" && chip.imagePath.length > 0, `${chip.turn} ${chip.marker}`);
  });

  test("the eleven distinct src values are the bridge's page renders of §0b — fig_<page>_0.png under the two document hashes, never a crop name", () => {
    const srcs = [...new Set(chips.map((c) => P.previewFor(c)).filter(Boolean).map((p) => p.src))].sort();
    assert.deepStrictEqual(srcs, [
      "/extracted_images/1bdfca9c878485c870ca1583bc999424/fig_1_0.png",
      "/extracted_images/1bdfca9c878485c870ca1583bc999424/fig_2_0.png",
      "/extracted_images/1bdfca9c878485c870ca1583bc999424/fig_3_0.png",
      "/extracted_images/1bdfca9c878485c870ca1583bc999424/fig_4_0.png",
      "/extracted_images/1bdfca9c878485c870ca1583bc999424/fig_5_0.png",
      "/extracted_images/1bdfca9c878485c870ca1583bc999424/fig_6_0.png",
      "/extracted_images/1bdfca9c878485c870ca1583bc999424/fig_7_0.png",
      "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_10_0.png",
      "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_1_0.png",
      "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_25_0.png",
      "/extracted_images/43e16375c8589fd13da4e592ee80882f/fig_84_0.png",
    ]);
    for (const s of srcs) assert.match(s, /^\/extracted_images\/[0-9a-f]{32}\/fig_\d+_0\.png$/);
  });

  test("Figure 15's chip (the file fig_25_0.png, named — never the marker, which varies per decode) previews on both FS-1 turns; the record predates `title`, so its caption is the source · page alone", () => {
    const fig15 = chips.filter((c) => c.imagePath === FIG25);
    assert.strictEqual(fig15.length, 2, "one per FS-1 scope");
    assert.deepStrictEqual(fig15.map((c) => c.turn), ["FQ01/corpus", "FQ01/document"]);
    for (const c of fig15) {
      assert.ok(!("title" in c), "T44's runner projected no title — the field is T49's");
      assert.strictEqual(P.previewFor(c).caption, "Fervi_Lathe_TechnicalSupportManual.pdf · p.25");
    }
    // The same page's text chunk sits beside it with no path and no preview (F-184's pair).
    const text25 = chips.filter((c) => c.turn === "FQ01/corpus" && c.page === 25 && !c.imagePath);
    assert.strictEqual(text25.length, 1);
    assert.strictEqual(P.previewFor(text25[0]), null);
  });

  test("two chips can carry one file: the Site Plan's page-1 caption AND detail chunks cite fig_1_0.png on each FS-2 turn", () => {
    for (const scope of ["corpus", "document"]) {
      const p1 = chips.filter((c) => c.turn === `FQ11/${scope}` && c.imagePath === "/extracted_images/1bdfca9c878485c870ca1583bc999424/fig_1_0.png");
      assert.strictEqual(p1.length, 2, scope);
      assert.strictEqual(new Set(p1.map((c) => P.previewFor(c).src)).size, 1);
    }
  });
});

describe("U-PREVIEW: the caption — the stored title, then the chip's own source · location (design §2.1, D3 a; T34's four kinds)", () => {
  test("the location equals the chip's rule for the four kinds — page, slide, section, none", () => {
    const kinds = {
      page: cite(),
      slide: cite({ source: "Deck.pptx", page: 8, locationKind: "slide", sectionPath: null }),
      section: cite({ source: "Guide.md", page: null, locationKind: "section", sectionPath: "Section 10: Costs › 10.3 What egress costs" }),
      none: cite({ source: "Note.txt", page: null, locationKind: "none", sectionPath: null }),
    };
    assert.strictEqual(P.previewLocation(kinds.page), " · p.25");
    assert.strictEqual(P.previewLocation(kinds.slide), " · slide 8");
    assert.strictEqual(P.previewLocation(kinds.section), " · §10.3 What egress costs", "the innermost heading, as the chip shows it (the full path is the chip's tooltip)");
    assert.strictEqual(P.previewLocation(kinds.none), "");
    for (const [kind, c] of Object.entries(kinds)) assert.strictEqual(P.previewLocation(c), chipLocation(c), kind);
    assert.strictEqual(P.previewLocation(cite({ page: 0 })), " · p.0", "0 is a page to the chip too (`!= null`)");
    assert.strictEqual(P.previewLocation(cite({ page: null, sectionPath: "" })), "", "an empty section path is none");
  });

  test("with a title: `<title> — <source> · p.N`; without: `<source> · p.N`; a blank or non-string title counts as none; the title is trimmed", () => {
    const withTitle = cite({ title: "Figure 15 – Dimensions and fastening points" });
    assert.strictEqual(P.previewCaption(withTitle), "Figure 15 – Dimensions and fastening points — Fervi_Lathe_TechnicalSupportManual.pdf · p.25");
    assert.strictEqual(P.previewFor(withTitle).title, "Figure 15 – Dimensions and fastening points");
    assert.strictEqual(P.previewCaption(cite()), "Fervi_Lathe_TechnicalSupportManual.pdf · p.25");
    assert.strictEqual(P.previewCaption(cite({ title: "   " })), "Fervi_Lathe_TechnicalSupportManual.pdf · p.25");
    assert.strictEqual(P.previewCaption(cite({ title: 15 })), "Fervi_Lathe_TechnicalSupportManual.pdf · p.25");
    assert.strictEqual(P.previewCaption(cite({ title: "  3 TECHNICAL SPECIFICATIONS  ", page: 10 })), "3 TECHNICAL SPECIFICATIONS — Fervi_Lathe_TechnicalSupportManual.pdf · p.10");
    assert.strictEqual(P.previewCaption(cite({ title: "PHASE THREE – Site Plan and Home Exterior", source: "Barratt_Homes_SitePlan.pdf", page: 1 })), "PHASE THREE – Site Plan and Home Exterior — Barratt_Homes_SitePlan.pdf · p.1");
    assert.strictEqual(P.previewTitle(cite({ title: " x " })), "x");
  });

  test("the caption follows the kinds: a slide's, a section's and a bare source's, with and without a title", () => {
    assert.strictEqual(P.previewCaption(cite({ source: "Deck.pptx", page: 8, locationKind: "slide", title: "Roadmap" })), "Roadmap — Deck.pptx · slide 8");
    assert.strictEqual(P.previewCaption(cite({ source: "Guide.md", page: null, locationKind: "section", sectionPath: "A › B", title: null })), "Guide.md · §B");
    assert.strictEqual(P.previewCaption(cite({ source: "Note.txt", page: null, locationKind: "none", sectionPath: null, title: "T" })), "T — Note.txt");
    assert.strictEqual(P.previewCaption({ imagePath: FIG25 }), "", "no source, no location, no title: nothing — never 'undefined'");
  });

  test("alt is the caption, byte for byte, on every kind", () => {
    for (const c of [cite(), cite({ title: "Figure 15 – Dimensions and fastening points" }), cite({ source: "Deck.pptx", page: 8, locationKind: "slide" }), cite({ page: null, sectionPath: "A › B" })]) {
      const p = P.previewFor(c);
      assert.strictEqual(p.alt, p.caption);
      assert.strictEqual(p.caption, P.previewCaption(c));
    }
  });
});

describe("U-PREVIEW: the module is pure — no DOM, no fetch, no clock, no import (design §2.1; a source pin on itself)", () => {
  test("the source (comments stripped) names no window, document, fetch, Date, timer or require", () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "rag", "figure_preview.js"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
    assert.ok(!/\bwindow\b|\bdocument\b|\bnavigator\b|\bfetch\s*\(|\bXMLHttpRequest\b|Date\.now|new Date|setTimeout|setInterval|\brequire\s*\(|\bimport\b/.test(code), "pure: the citation in, the strings out");
    assert.match(code, /module\.exports = \{ PREVIEW_IMAGE_ROOT, previewLocation, previewTitle, previewCaption, previewFor \};/);
    assert.deepStrictEqual(Object.keys(P).sort(), ["PREVIEW_IMAGE_ROOT", "previewCaption", "previewFor", "previewLocation", "previewTitle"]);
  });

  test("the same citation gives the same preview twice, and the citation object is not written to", () => {
    const c = Object.freeze(cite({ title: "Figure 15 – Dimensions and fastening points" }));
    assert.deepStrictEqual(P.previewFor(c), P.previewFor(c));
    assert.deepStrictEqual(Object.keys(c).sort(), ["imagePath", "locationKind", "marker", "page", "pageAttribution", "sectionPath", "source", "title"]);
  });
});
