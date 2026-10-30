/**
 * U-RUNNING — T18 (t18-design.md D2, D3, D5, §2.1, §2.3): the running-line module, pure.
 *
 * The rules pinned here are the ones the design probe measured on the served image (t18-design.md §0a, §0b): the
 * key (digits masked only on a bare number or a lettered line; a glyph-only line never), the zone (the first and
 * last five non-empty lines), once-per-page, the share (half the pages, at least three), `keepFirst`, hidden pages,
 * `\r\n`, and the counts.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const rl = require("../../src/lib/ingestion/running_lines.js");

const pageWith = (n, body, { header = "SYSC Senior Management", footer = null, extraTop = [], extraBottom = [] } = {}) =>
  [header, ...extraTop, ...body, ...extraBottom, footer === null ? `${n}` : footer].filter((l) => l !== undefined && l !== false).join("\n");
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango", "uniform", "victor"];
const bodyLines = (n) => Array.from({ length: 12 }, (_, i) => `Rule ${n}.${i + 1} ${WORDS[(n * 7 + i) % WORDS.length]} ${WORDS[(n * 3 + i * 5) % WORDS.length]} — a firm must take reasonable care over its ${WORDS[(n + i) % WORDS.length]} controls.`);
const document = (pages, opts) => Array.from({ length: pages }, (_, i) => pageWith(i + 1, bodyLines(i + 1), opts));

describe("U-RUNNING: the key", () => {
  test("digits are masked on a bare number line and on a line with four letters or more; a short lettered line keeps its digits; a glyph-only line has no key", () => {
    assert.strictEqual(rl.keyOf("27"), "#");
    assert.strictEqual(rl.keyOf("0 5 10 15 20"), "# # # # #");
    assert.strictEqual(rl.keyOf("3]["), "#][");
    assert.strictEqual(rl.keyOf("Page 2 of 84"), "Page # of #");
    assert.strictEqual(rl.keyOf("©2006 - 2024 PCI Security Standards Council, LLC. All Rights Reserved. Page 74"), "©# - # PCI Security Standards Council, LLC. All Rights Reserved. Page #");
    assert.strictEqual(rl.keyOf("Document Generated: 2026-04-28"), "Document Generated: #-#-#");
    assert.strictEqual(rl.keyOf("2x"), "2x", "a quantity keeps its digits (one letter)");
    assert.strictEqual(rl.keyOf("6 AA-2395783-5"), "6 AA-2395783-5", "a part reference keeps its digits (two letters)");
    assert.strictEqual(rl.keyOf("C-00105-001"), "C-00105-001");
    assert.strictEqual(rl.keyOf("  SYSC   Senior\tManagement  "), "SYSC Senior Management", "trimmed, whitespace collapsed");
    assert.strictEqual(rl.keyOf("•"), null);
    assert.strictEqual(rl.keyOf("■ ---"), null);
    assert.strictEqual(rl.keyOf(""), null);
    assert.strictEqual(rl.keyOf(undefined), null);
  });

  test("normalisePageText: \\r\\n and a lone \\r become \\n; anything but a string is empty (F-168)", () => {
    assert.strictEqual(rl.normalisePageText("a\r\nb\rc\n"), "a\nb\nc\n");
    assert.strictEqual(rl.normalisePageText(null), "");
    assert.strictEqual(rl.normalisePageText(42), "");
  });

  test("the zone is the first and last N non-empty lines, deduplicated on a short page; 0 is the whole page", () => {
    const lines = ["h", "", "a", "b", "c", "d", "e", "f", "g", "", "z"];
    assert.deepStrictEqual(rl.zoneIndices(lines, 2), [0, 2, 8, 10]);
    assert.deepStrictEqual(rl.zoneIndices(["h", "a", "z"], 5), [0, 1, 2]);
    assert.deepStrictEqual(rl.zoneIndices(lines, 0), [0, 2, 3, 4, 5, 6, 7, 8, 10]);
  });
});

describe("U-RUNNING: detection", () => {
  test("a header on every page and a page number at the bottom are running; the body is not; the table and the need are reported", () => {
    const d = rl.detectRunningLines(document(10));
    assert.deepStrictEqual([...d.keys].sort(), ["#", "SYSC Senior Management"]);
    assert.strictEqual(d.pageCount, 10);
    assert.strictEqual(d.need, 5);
    assert.ok(d.table.some((r) => r.key === "SYSC Senior Management" && r.pagesOnce === 10 && r.sample === "SYSC Senior Management"));
    assert.deepStrictEqual(d.ambiguous, []);
  });

  test("the share: half the pages and at least three — a line on 2 of 4 pages is not running, on 3 of 4 it is; a two-page document never has a running line", () => {
    const four = document(4, { footer: false }).map((t, i) => (i < 2 ? `${t}\nfervi.com` : t));
    assert.ok(!rl.detectRunningLines(four).keys.has("fervi.com"), "2 of 4");
    const four3 = document(4, { footer: false }).map((t, i) => (i < 3 ? `${t}\nfervi.com` : t));
    assert.ok(rl.detectRunningLines(four3).keys.has("fervi.com"), "3 of 4");
    assert.strictEqual(rl.detectRunningLines(document(2)).keys.size, 0, "two pages: the minimum is three");
    assert.strictEqual(rl.detectRunningLines(document(3)).keys.size, 2, "three pages of three");
  });

  test("once per page: a bare number that is the page number on some pages and a quantity beside it on others is running only where it stands alone; a page holding it twice is ambiguous and keeps both (SSX125, Ikea)", () => {
    const pages = document(10).map((t, i) => (i % 2 ? `${t}\n${i + 1}` : t)); // odd pages: the number twice in the bottom zone
    const d = rl.detectRunningLines(pages);
    assert.ok(d.keys.has("#"), "once on 5 of 10 pages — running");
    const s = rl.stripRunningLines(pages, { keepFirst: false });
    assert.strictEqual(s.pagesAmbiguous, 5, "the five pages holding it twice");
    assert.strictEqual(s.removed.filter((r) => r.key === "#").length, 5, "removed only where it stood alone");
    for (let i = 1; i < 10; i += 2) assert.ok(s.pages[i].endsWith(`${i + 1}\n${i + 1}`), `page ${i + 1} keeps both numbers`);
    const step = Array.from({ length: 10 }, (_, i) => [`10134${i}`, `${(i % 4) + 2}x`, "1 2", "3", "4", ...bodyLines(i + 1), "41", "42", "43 44 45 46 47"].join("\n"));
    const d2 = rl.detectRunningLines(step);
    assert.ok(!d2.keys.has("#"), "a page whose zone holds several bare numbers has no running page number");
    assert.ok(d2.keys.has("# # # # #"), "the strip that is once per page is");
    assert.ok(d2.ambiguous.some((a) => a.key === "#" && a.pagesAny === 10 && a.pagesOnce === 0), "the bare numbers are reported ambiguous, never running");
    assert.ok(!["2x", "3x", "4x", "5x", "#x"].some((k) => d2.keys.has(k)), "a quantity is an exact key: 2x / 3x / 4x / 5x each on a few pages, never running (the first pass's masked #x was on 30 of 40 Ikea pages — refuted)");
  });

  test("a glyph-only line on every page is never a key; a key occurring mid-page only is not in the zone", () => {
    const glyph = document(8, { extraBottom: ["•", "■"] });
    const d = rl.detectRunningLines(glyph);
    assert.ok(![...d.keys].some((k) => /[•■]/.test(k)));
    const mid = document(8).map((t) => { const ls = t.split("\n"); ls.splice(7, 0, "Good Practice"); return ls.join("\n"); });
    assert.ok(!rl.detectRunningLines(mid).keys.has("Good Practice"), "a sub-heading in the body is content");
    assert.ok(rl.detectRunningLines(mid, { zone: 0 }).keys.has("Good Practice"), "with the whole page as the zone it would be — the design's rejected option (D2 c)");
  });

  test("hidden pages and empty pages are not pages; page objects with markdown or text are read; \\r\\n is normalised before keying", () => {
    const pages = [{ page: 1, markdown: "SYSC Senior Management\r\nbody one\r\n1" }, { page: 2, hidden: true, markdown: "SYSC Senior Management\r\nhidden\r\n2" }, { page: 3, text: "SYSC Senior Management\r\nbody three\r\n3" }, { page: 4, markdown: "" }, { page: 5, markdown: "SYSC Senior Management\nbody five\n5" }];
    const d = rl.detectRunningLines(pages);
    assert.strictEqual(d.pageCount, 3);
    assert.deepStrictEqual([...d.keys].sort(), ["#", "SYSC Senior Management"]);
  });
});

describe("U-RUNNING: the strip", () => {
  test("keepFirst (D3 b): the first page keeps each running key, every other page loses its one occurrence; the counts say so; the order and the hidden pages are preserved", () => {
    const pages = document(6);
    pages.splice(3, 0, { hidden: true, markdown: "SYSC Senior Management\nhidden slide\n99" });
    const s = rl.stripRunningLines(pages);
    assert.strictEqual(s.pages.length, 7);
    assert.ok(s.pages[0].startsWith("SYSC Senior Management\n") && s.pages[0].endsWith("\n1"), "page 1 keeps the header and the number");
    for (const i of [1, 2, 4, 5, 6]) { assert.ok(!s.pages[i].startsWith("SYSC"), `page ${i + 1} header gone`); assert.ok(!/\n\d+$/.test(s.pages[i]), `page ${i + 1} number gone`); }
    assert.strictEqual(s.pages[3], "SYSC Senior Management\nhidden slide\n99", "a hidden page passes through untouched");
    assert.deepStrictEqual(s.keptFirst, [{ page: 1, key: "SYSC Senior Management" }, { page: 1, key: "#" }]);
    assert.strictEqual(s.removed.length, 10);
    assert.strictEqual(s.pagesTouched, 5);
    assert.deepStrictEqual(rl.pageArtifactCounts(s), { linesRemoved: 10, distinctKeys: 2, pagesTouched: 5, keptFirst: 2, pagesWithoutText: 0 });
    const plain = rl.stripRunningLines(pages, { keepFirst: false });
    assert.strictEqual(plain.removed.length, 12);
    assert.deepStrictEqual(plain.keptFirst, []);
  });

  test("a page whose only text is the running block is left without text and named (the Site Plan's five — D3); with keepFirst the first such page keeps it", () => {
    const disclaimer = ["All images used are for illustrative purposes only. Floor plans are intended to give a general indication.", "appliance spaces or items of furniture. Please ask our Sales Adviser for details of the treatments.", "electrical layouts. All images, photographs and dimensions are not intended to form part of any contract.", "developers. We refers to the Barratt Developments PLC group brands including Barratt London."];
    const pages = ["PHASE THREE 206 205 204\nplots 301 302 303", ["KITCHEN LOUNGE", ...disclaimer].join("\n"), ...Array.from({ length: 4 }, () => disclaimer.join("\n")), "A page of its own text\nwith two lines"];
    const s = rl.stripRunningLines(pages, { keepFirst: false });
    assert.deepStrictEqual(s.pagesWithoutText, [3, 4, 5, 6]);
    assert.strictEqual(s.pages[0], "PHASE THREE 206 205 204\nplots 301 302 303", "page 1 has no running line");
    assert.strictEqual(s.pages[1], "KITCHEN LOUNGE", "page 2 keeps its own text");
    const k = rl.stripRunningLines(pages);
    assert.deepStrictEqual(k.pagesWithoutText, [3, 4, 5, 6], "pages 3–6 have nothing but the block either way");
    assert.strictEqual(k.pages[1], ["KITCHEN LOUNGE", ...disclaimer].join("\n"), "page 2 — the first page carrying the block — keeps it (D3 b)");
    assert.strictEqual(rl.pageArtifactCounts(k).pagesWithoutText, 4);
  });

  test("a document with no repetition is returned normalised and untouched; the caller's keys can replace detection", () => {
    const pages = ["Alpha\r\none", "Beta\r\ntwo", "Gamma\r\nthree"];
    const s = rl.stripRunningLines(pages);
    assert.deepStrictEqual(s.pages, ["Alpha\none", "Beta\ntwo", "Gamma\nthree"]);
    assert.strictEqual(s.keys.size, 0);
    assert.deepStrictEqual(rl.pageArtifactCounts(s), { linesRemoved: 0, distinctKeys: 0, pagesTouched: 0, keptFirst: 0, pagesWithoutText: 0 });
    const forced = rl.stripRunningLines(pages, { keys: new Set(["Beta"]), keepFirst: false });
    assert.deepStrictEqual(forced.pages, ["Alpha\none", "two", "Gamma\nthree"]);
  });

  test("the defaults and their guards: zone 5, share 0.5, minPages 3, keepFirst on; a bad option is the default", () => {
    assert.deepStrictEqual([rl.DEFAULT_ZONE, rl.DEFAULT_SHARE, rl.DEFAULT_MIN_PAGES, rl.LETTERS_FOR_MASKING], [5, 0.5, 3, 4]);
    const d = rl.detectRunningLines(document(10), { zone: -1, share: 7, minPages: 0 });
    assert.strictEqual(d.need, 5);
    assert.ok(d.keys.has("SYSC Senior Management"));
    assert.deepStrictEqual(rl.detectRunningLines([]).keys.size, 0);
    assert.deepStrictEqual(rl.stripRunningLines(null).pages, []);
  });
});
