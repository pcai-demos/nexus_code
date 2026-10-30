/**
 * U-SECTION — T34's pure module (`src/lib/ingestion/sections.js`; design `inputs/rag-audit/t34-design.md` D2–D4, D6).
 * Offline, no pod:
 *   - THE HEADING STACK over a fixture with levels 2–5 and 11, a repeated heading under two parents (two different
 *     paths), a blank heading skipped, `&amp;` unescaped, a gap in levels nesting under the nearest shallower heading;
 *   - THE PATH's rendering (D2 b): innermost first, ancestors nearest-first while they fit — the 80 / 200 / 3 limits;
 *   - THE ANCHOR at an offset: null before the first heading; the heading's own offset anchors to it;
 *   - THE CHUNK OFFSETS on the splitter's overlapping chunks (every chunk found at or after the previous start);
 *   - THE PREFIX rule (D3): `[Section: …]`, never a page word; omitted when the chunk starts with the heading line;
 *   - THE REAL DOCUMENT: the bridge's exact markdown of the TCO .docx (t34-artifacts/probes/, taken in the pod on
 *     2026-09-17) — 146 headings, 635 chunks at the page's 600 / 80 shape, one chunk without an anchor (the front
 *     matter), the two "Executive Summary" sections told apart by their parents, the `&` headings unescaped;
 *   - the module is pure and dependency-free.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const sec = require("../../src/lib/ingestion/sections.js");
const { recursiveSplit } = require("../../src/lib/ingestion/parser.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TCO_MD = fs.readFileSync(path.join(REPO_ROOT, "tests", "eval", "baselines", "t34-artifacts", "probes", "tco_docx_bridge_markdown_2026-09-17.md"), "utf8").trim();

const FIXTURE = [
  "Front matter before any heading.",
  "## Report A",
  "Intro of A.",
  "### Executive Summary",
  "A's summary.",
  "### Section 1: Methodology &amp; Assumptions",
  "Body of 1.",
  "#### 1.1 Scope",
  "Body of 1.1.",
  "##### Phase 1: Bring-Up",
  "Body of the phase.",
  "### ",
  "Text under a blank heading (still 1.1's phase? no — the blank is skipped, so still Phase 1).",
  "########### Table of Contents",
  "toc lines",
  "### Section 2: Results",
  "Body of 2.",
  "## Report B",
  "### Executive Summary",
  "B's summary.",
  "#### Deep &lt;tag&gt; heading with &quot;quotes&quot; and it&#39;s apostrophe",
  "Body.",
].join("\n");

describe("U-SECTION: the heading stack (D2, D4)", () => {
  test("every non-blank markdown heading in document order with its level, offset and path; a blank heading is skipped; a level gap nests under the nearest shallower heading; a level-11 TOC heading nests and is popped by the next real heading", () => {
    const h = sec.parseHeadings(FIXTURE);
    assert.deepStrictEqual(h.map((x) => [x.level, x.text]), [
      [2, "Report A"], [3, "Executive Summary"], [3, "Section 1: Methodology & Assumptions"], [4, "1.1 Scope"], [5, "Phase 1: Bring-Up"],
      [11, "Table of Contents"], [3, "Section 2: Results"], [2, "Report B"], [3, "Executive Summary"], [4, "Deep <tag> heading with \"quotes\" and it's apostrophe"],
    ]);
    assert.deepStrictEqual(h[4].path, ["Report A", "Section 1: Methodology & Assumptions", "1.1 Scope", "Phase 1: Bring-Up"], "the full stack");
    assert.deepStrictEqual(h[5].path, ["Report A", "Section 1: Methodology & Assumptions", "1.1 Scope", "Phase 1: Bring-Up", "Table of Contents"], "level 11 nests under level 5");
    assert.deepStrictEqual(h[6].path, ["Report A", "Section 2: Results"], "a level-3 heading pops the TOC (11), the phase (5), 1.1 (4) and Section 1 (3)");
    assert.deepStrictEqual(h[8].path, ["Report B", "Executive Summary"], "the repeated heading under its own parent");
    assert.ok(h.every((x, i) => i === 0 || x.offset > h[i - 1].offset), "offsets ascend");
    assert.strictEqual(FIXTURE.slice(h[1].offset, h[1].offset + 21), "### Executive Summary", "the offset is the heading line's start");
  });

  test("HTML entities docling writes into heading text are unescaped (F-146); whitespace collapsed; junk tolerated", () => {
    assert.strictEqual(sec.unescapeHeading("  Risk &amp;   Sensitivity\t&lt;x&gt; &quot;q&quot; it&#39;s  "), "Risk & Sensitivity <x> \"q\" it's");
    assert.strictEqual(sec.unescapeHeading(null), "");
    assert.deepStrictEqual(sec.parseHeadings(""), []);
    assert.deepStrictEqual(sec.parseHeadings(null), []);
    assert.deepStrictEqual(sec.parseHeadings("no headings here\n#notaheading? yes it is: a hash then text\n"), [{ level: 1, text: "notaheading? yes it is: a hash then text", offset: 17, path: ["notaheading? yes it is: a hash then text"] }]);
    assert.deepStrictEqual(sec.parseHeadings("### Trailing hashes ###").map((x) => x.text), ["Trailing hashes"]);
  });

  test("the anchor at an offset: null before the first heading, the heading in force at its own offset and after it, the innermost with its level and path (a copy)", () => {
    const h = sec.parseHeadings(FIXTURE);
    assert.strictEqual(sec.anchorAt(h, 0), null, "front matter");
    assert.strictEqual(sec.anchorAt(h, h[0].offset - 1), null);
    assert.deepStrictEqual(sec.anchorAt(h, h[0].offset), { innermost: "Report A", level: 2, path: ["Report A"] });
    const a = sec.anchorAt(h, FIXTURE.indexOf("Body of the phase."));
    assert.deepStrictEqual(a, { innermost: "Phase 1: Bring-Up", level: 5, path: ["Report A", "Section 1: Methodology & Assumptions", "1.1 Scope", "Phase 1: Bring-Up"] });
    a.path.push("mutated");
    assert.strictEqual(h[4].path.length, 4, "the anchor's path is a copy");
    assert.deepStrictEqual(sec.anchorAt(h, FIXTURE.indexOf("B's summary.")).path, ["Report B", "Executive Summary"]);
    assert.deepStrictEqual(sec.anchorAt(h, FIXTURE.indexOf("Text under a blank heading")).path, ["Report A", "Section 1: Methodology & Assumptions", "1.1 Scope", "Phase 1: Bring-Up"], "a blank heading changes nothing");
    assert.strictEqual(sec.anchorAt([], 10), null);
    assert.strictEqual(sec.anchorAt(null, undefined), null);
  });

  // §11a A13 (the first live pass): a chunk belongs to the section that holds MOST of its characters — the splitter's
  // overlap makes a section's opening chunk begin with the previous section's tail, and a chunk can span headings.
  test("anchorForChunk: the section holding most of the chunk's characters; a span that opens with the previous section's tail and a heading belongs to the new section; a tie goes to the later section; no length falls back to the start; a chunk ending before the first heading has none", () => {
    const h = sec.parseHeadings(FIXTURE);
    const at = FIXTURE.indexOf("## Report B");
    const span = FIXTURE.slice(at - 12, FIXTURE.indexOf("#### Deep"));
    assert.deepStrictEqual(sec.anchorAt(h, at - 12).path, ["Report A", "Section 2: Results"], "the span opens inside Section 2's tail");
    assert.deepStrictEqual(sec.anchorForChunk(h, at - 12, span.length).path, ["Report B", "Executive Summary"], "12 characters of Report A's tail, then Report B, then its summary — the summary holds most of it");
    const short = sec.parseHeadings("# A\nxxxx\n# B\nyyyy");
    assert.deepStrictEqual(sec.anchorForChunk(short, 0, 18).path, ["B"], "a tie (9 characters each side of the second heading) goes to the later section");
    assert.deepStrictEqual(sec.anchorForChunk(short, 0, 17).path, ["A"], "one character more on A's side: A");
    assert.deepStrictEqual(sec.anchorForChunk(h, FIXTURE.indexOf("B's summary."), 0), sec.anchorAt(h, FIXTURE.indexOf("B's summary.")), "no length: the start rule");
    assert.strictEqual(sec.anchorForChunk(h, 0, 10), null, "front matter that ends before the first heading");
    assert.strictEqual(sec.anchorForChunk(h, 0, h[0].offset + 20), null, "front matter that runs 20 characters into Report A still mostly front matter (33 characters): no anchor");
    assert.deepStrictEqual(sec.anchorForChunk(h, h[0].offset - 5, 35).path, ["Report A"], "five characters of front matter, thirty of Report A: Report A");
    assert.strictEqual(sec.anchorForChunk([], 0, 10), null);
    assert.strictEqual(sec.anchorForChunk(null, undefined, undefined), null);
  });
});

describe("U-SECTION: the path a citation shows (D2 b)", () => {
  test("innermost first, then its ancestors nearest-first while the whole stays within 200 characters and 3 parts; each part cut at a word boundary to 80 with an ellipsis; › joins", () => {
    assert.strictEqual(sec.renderPath(["Report A", "Executive Summary"]), "Report A › Executive Summary");
    assert.strictEqual(sec.renderPath(["Report A", "Section 1: Methodology & Assumptions", "1.1 Scope", "Phase 1: Bring-Up"]), "Section 1: Methodology & Assumptions › 1.1 Scope › Phase 1: Bring-Up", "at most 3 parts — the outermost dropped first");
    const long = "HPE Private Cloud AI (Gen2 Medium) vs Cloud IaaS vs Managed AI Platforms vs API Token Services";
    const cut = sec.renderPath([long]);
    assert.ok(cut.length <= 80 && cut.endsWith("…") && !/\s…$/.test(cut), `a part is cut to 80 at a word boundary: ${cut}`);
    assert.strictEqual(cut, "HPE Private Cloud AI (Gen2 Medium) vs Cloud IaaS vs Managed AI Platforms vs…");
    const p = sec.renderPath(["A".repeat(80), "B".repeat(80), "C".repeat(80)]);
    assert.strictEqual(p, `${"B".repeat(80)} › ${"C".repeat(80)}`, "the whole within 200: the third part would not fit");
    assert.strictEqual(sec.renderPath(["x"], { partsMax: 1 }), "x");
    assert.strictEqual(sec.renderPath(["a", "b", "c"], { partsMax: 2 }), "b › c");
    assert.strictEqual(sec.renderPath([]), null);
    assert.strictEqual(sec.renderPath(null), null);
    assert.strictEqual(sec.renderPath(["", "  ", "Only"]), "Only", "blank parts are ignored");
  });

  test("the prefix (D3): `[Section: …]` and a newline — no page word; nothing for no path; a chunk whose first line is a heading gets none", () => {
    assert.strictEqual(sec.sectionPrefix("Report A › Executive Summary"), "[Section: Report A › Executive Summary]\n");
    assert.strictEqual(sec.sectionPrefix(null), "");
    assert.strictEqual(sec.sectionPrefix(""), "");
    assert.ok(!/page/i.test(sec.sectionPrefix("x")));
    assert.strictEqual(sec.startsWithHeading("### Executive Summary\nA's summary."), true);
    assert.strictEqual(sec.startsWithHeading("\n\n  #### 1.1 Scope\nbody"), true, "leading blank lines are skipped");
    assert.strictEqual(sec.startsWithHeading("A's summary.\n### Next"), false);
    assert.strictEqual(sec.startsWithHeading("#hashtag-like line"), true, "a hash then text is a heading line for docling's markdown");
    assert.strictEqual(sec.startsWithHeading("## "), false, "a blank heading is not a heading");
    assert.strictEqual(sec.startsWithHeading(""), false);
  });
});

describe("U-SECTION: the chunk offsets on the splitter's overlapping chunks", () => {
  test("every chunk is found at or after the previous chunk's start (the overlap makes the next chunk begin inside the previous one); a repeated chunk resolves to the first occurrence after the previous start; junk never yields -1", () => {
    const md = FIXTURE;
    const chunks = recursiveSplit(md, 120, 30);
    assert.ok(chunks.length > 5);
    const offs = sec.chunkOffsets(md, chunks);
    assert.strictEqual(offs.length, chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      const t = chunks[i].trim();
      assert.strictEqual(md.slice(offs[i], offs[i] + t.length), t, `chunk ${i} sits at its offset`);
      if (i) assert.ok(offs[i] >= offs[i - 1], "monotone");
    }
    const rep = "row\nrow\nrow";
    assert.deepStrictEqual(sec.chunkOffsets(rep, ["row", "row", "row"]), [0, 0, 0], "identical chunks: the first occurrence at or after the previous start");
    assert.deepStrictEqual(sec.chunkOffsets("abc", ["zzz", "", null]), [0, 0, 0]);
    assert.deepStrictEqual(sec.chunkOffsets("", []), []);
  });
});

describe("U-SECTION: the TCO .docx — the bridge's exact markdown (t34-design §0, the probe of 2026-09-17)", () => {
  const headings = sec.parseHeadings(TCO_MD);
  const chunks = recursiveSplit(TCO_MD, 600, 80);
  const offsets = sec.chunkOffsets(TCO_MD, chunks);
  const anchors = chunks.map((c, i) => sec.anchorForChunk(headings, offsets[i], c.trim().length));
  const paths = anchors.map((a) => (a ? sec.renderPath(a.path) : null));
  const startAnchors = chunks.map((c, i) => sec.anchorAt(headings, offsets[i]));

  test("228,221 characters, 146 non-blank headings at levels 1–5 and 11 (20 blank heading lines skipped); docling's `#` count is the Word heading level + 1", () => {
    assert.strictEqual(TCO_MD.length, 228221);
    assert.strictEqual(headings.length, 146);
    assert.deepStrictEqual(headings.reduce((m, h) => { m[h.level] = (m[h.level] || 0) + 1; return m; }, {}), { 1: 1, 2: 3, 3: 36, 4: 93, 5: 12, 11: 1 });
    assert.strictEqual((TCO_MD.match(/^#+\s*$/gm) || []).length, 20, "the blank heading lines docling emits");
  });

  test("635 chunks at the page's shape; every offset exact and monotone; every chunk anchored (the front matter runs into Disclaimer within its first chunk); 124 distinct paths, none over 200 characters; 51 chunks anchor differently from the start-of-chunk rule (the overlap tail, a spanned heading — A13)", () => {
    assert.strictEqual(chunks.length, 635);
    for (let i = 0; i < chunks.length; i++) {
      const t = chunks[i].trim();
      assert.strictEqual(TCO_MD.slice(offsets[i], offsets[i] + t.length), t, `chunk ${i}`);
    }
    assert.ok(offsets.every((o, i) => i === 0 || o >= offsets[i - 1]));
    assert.strictEqual(anchors.filter((a) => !a).length, 0);
    assert.strictEqual(paths[0], "Disclaimer", "the first chunk: the front matter plus Disclaimer's opening — Disclaimer holds more of it");
    assert.strictEqual(startAnchors.filter((a) => !a).length, 1, "under the start rule the first chunk had none");
    assert.strictEqual(paths.filter((p, i) => p !== (startAnchors[i] ? sec.renderPath(startAnchors[i].path) : null)).length, 51, "the chunks the majority rule attributes differently");
    const distinct = new Set(paths.filter(Boolean));
    assert.strictEqual(distinct.size, 124);
    assert.ok([...distinct].every((p) => p.length <= 200));
  });

  test("the two Executive Summary sections are told apart by their parents; the `&` headings are unescaped; References belongs to two reports", () => {
    const es = [...new Set(paths.filter((p) => p && /Executive Summary$/.test(p)))];
    assert.deepStrictEqual(es, ["Disclaimer › Executive Summary", "On-Premises DIY vs HPE Private Cloud AI: TCO & ROI Analysis › Executive Summary"]);
    assert.ok(headings.some((h) => h.text === "Section 1: Methodology & Assumptions"), "&amp; unescaped");
    assert.ok(!headings.some((h) => /&amp;/.test(h.text)));
    assert.deepStrictEqual([...new Set(paths.filter((p) => p && /References$/.test(p)))], ["Disclaimer › References", "Conclusion: On-Premises DIY vs HPE PCAI › References"]);
    assert.strictEqual(chunks.filter((c, i) => anchors[i] && !sec.startsWithHeading(c.trim())).length, 542, "chunks that get the prefix (a chunk that begins with a BLANK heading line gets it too)");
    assert.strictEqual(chunks.filter((c) => sec.startsWithHeading(c.trim())).length, 93, "chunks that begin with their heading line");
  });
});

describe("U-SECTION: purity", () => {
  test("the module is pure and dependency-free: no require, no fs, no network, no config", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "ingestion", "sections.js"), "utf8");
    assert.ok(!/\brequire\(/.test(src), "no require");
    assert.ok(!/\bfetch\(|\bfs\.|process\./.test(src), "no I/O");
    assert.deepStrictEqual(Object.keys(sec).sort(), ["PATH_PARTS_MAX", "PATH_PART_MAX", "PATH_SEPARATOR", "PATH_TOTAL_MAX", "anchorAt", "anchorForChunk", "chunkOffsets", "parseHeadings", "renderPath", "sectionPrefix", "startsWithHeading", "unescapeHeading"]);
    assert.deepStrictEqual([sec.PATH_PART_MAX, sec.PATH_TOTAL_MAX, sec.PATH_PARTS_MAX, sec.PATH_SEPARATOR], [80, 200, 3, " › "]);
  });
});
