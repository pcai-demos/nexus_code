/**
 * U-FOLD — T41 (t41-design.md D2, §2.1): the minimum-size fold, offline.
 * A piece under minChunkSize is never dropped and never a chunk of its own: it folds into the NEXT surviving piece of
 * its page (whose head is already the piece's tail — the splitter's overlap — and is replaced by the whole piece), the
 * page's last piece into the PREVIOUS as its novel remainder, a lone piece is kept, and a page of nothing but short
 * pieces keeps its first with the rest folded in. Pure module, no I/O.
 */
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fold = require("../../src/lib/ingestion/fold");

const LONG_A = "Alpha paragraph with enough characters to clear the fifty-character minimum comfortably.";
const LONG_B = "Bravo paragraph with enough characters to clear the fifty-character minimum comfortably.";
const LONG_C = "Charlie paragraph with enough characters to clear the fifty-character minimum too.";
const coverage = (r, n) => { const seen = []; for (const c of r.chunks) { seen.push(c.index, ...c.absorbed); } return seen.sort((a, b) => a - b).join(",") === [...Array(n).keys()].join(","); };

describe("U-FOLD: normaliseMinChunkSize and sharedOverlap", () => {
  test("a non-negative integer or its numeric string; absent, empty or unreadable is the default 50; 0 is no minimum", () => {
    assert.strictEqual(fold.DEFAULT_MIN_CHUNK_SIZE, 50);
    for (const v of [undefined, null, "", "x", -1, NaN, Infinity, {}]) assert.strictEqual(fold.normaliseMinChunkSize(v), 50, JSON.stringify(v));
    assert.strictEqual(fold.normaliseMinChunkSize(150), 150);
    assert.strictEqual(fold.normaliseMinChunkSize("150"), 150);
    assert.strictEqual(fold.normaliseMinChunkSize(12.7), 12);
    assert.strictEqual(fold.normaliseMinChunkSize(0), 0);
    assert.strictEqual(fold.normaliseMinChunkSize(undefined, 150), 150, "a caller's default");
  });
  test("sharedOverlap is the longest suffix of the first that prefixes the second, at token boundaries, at least 6 characters or holding a space — a one-letter coincidence is not an overlap", () => {
    assert.strictEqual(fold.SHARED_OVERLAP_MIN, 6);
    assert.strictEqual(fold.sharedOverlap("the quick brown fox", "quick brown fox jumps"), 15, "whole words at both boundaries");
    assert.strictEqual(fold.sharedOverlap("HEAD LINE", "HEAD LINE\n\nbody"), 9, "a whole line");
    assert.strictEqual(fold.sharedOverlap("ends with fervi.com", "fervi.com\nnext"), 9, "a single long token at both boundaries");
    assert.strictEqual(fold.sharedOverlap("one short", "two short"), 0, "the letter t is not an overlap");
    assert.strictEqual(fold.sharedOverlap("...of a", "a long piece"), 0, "a one-letter word is not one either (the duplicate is the safer error)");
    assert.strictEqual(fold.sharedOverlap("ends here 29", "29\nnext"), 0, "a two-character line is stored twice rather than risk a clip");
    assert.strictEqual(fold.sharedOverlap("the quick brown", "brownies"), 0, "not a boundary in the second");
    assert.strictEqual(fold.sharedOverlap("abc", "xyz"), 0);
    assert.strictEqual(fold.sharedOverlap("", "abc"), 0);
    assert.strictEqual(fold.sharedOverlap("Master 3-Year TCO Table", "Master 3-Year TCO Table\n\n| a | b |"), 23, "the whole piece");
  });
});

describe("U-FOLD: foldSubMinimum — into the next chunk by default, the last into the previous, nothing dropped", () => {
  test("a short piece in the middle of a page folds in FRONT of the next survivor, whose overlap head it replaces (the text once, the heading first)", () => {
    const heading = "#### Master 3-Year TCO Table";
    const next = `${heading}\n\n${LONG_B}`; // the splitter's overlap put the heading at the next piece's head
    const r = fold.foldSubMinimum([LONG_A, heading, next], 50);
    assert.strictEqual(r.folded, 1);
    assert.strictEqual(r.chunks.length, 2);
    assert.deepStrictEqual(r.chunks.map((c) => c.index), [0, 2]);
    assert.strictEqual(r.chunks[1].body, `${heading}\n${LONG_B}`, "the heading once, opening the chunk it introduces");
    assert.strictEqual(r.chunks[1].original, next, "the survivor's original piece is kept for the heading / prefix decisions");
    assert.deepStrictEqual(r.chunks[1].absorbed, [1]);
    assert.deepStrictEqual(r.details, [{ index: 1, chars: heading.length, into: "next", survivor: 2 }]);
    assert.strictEqual(r.chunks[0].body, LONG_A, "the previous chunk is untouched");
  });
  test("a short piece that shares NO text with the next survivor is simply prepended", () => {
    const r = fold.foldSubMinimum([LONG_A, "| **£108** |", LONG_B], 50);
    assert.strictEqual(r.chunks[1].body, `| **£108** |\n${LONG_B}`);
    assert.strictEqual(r.folded, 1);
  });
  test("the page's LAST short piece folds into the previous survivor as its novel remainder (the overlap not duplicated)", () => {
    const tail = "comfortably.\nThe power cord must be connected to a 230V plug."; // begins with LONG_A's tail — the overlap
    const r = fold.foldSubMinimum([LONG_A, tail], 150);
    assert.strictEqual(r.folded, 1);
    assert.strictEqual(r.chunks.length, 1);
    assert.strictEqual(r.chunks[0].body, `${LONG_A}\nThe power cord must be connected to a 230V plug.`);
    assert.deepStrictEqual(r.details, [{ index: 1, chars: tail.length, into: "previous", survivor: 0 }]);
  });
  test("a last short piece that is ENTIRELY the previous chunk's tail adds nothing (still counted as folded)", () => {
    const r = fold.foldSubMinimum([LONG_A, "minimum comfortably."], 50);
    assert.strictEqual(r.chunks[0].body, LONG_A);
    assert.strictEqual(r.folded, 1);
  });
  test("several short pieces before a survivor keep their order in front of it; several after the last survivor keep theirs behind it", () => {
    const r = fold.foldSubMinimum(["S1 short", "S2 short", LONG_A, "T1 tail", "T2 tail"], 50);
    assert.strictEqual(r.chunks.length, 1);
    assert.strictEqual(r.chunks[0].body, `S1 short\nS2 short\n${LONG_A}\nT1 tail\nT2 tail`);
    assert.strictEqual(r.folded, 4);
    assert.deepStrictEqual(r.details.map((d) => `${d.index}:${d.into}`), ["1:next", "0:next", "3:previous", "4:previous"]);
    assert.ok(coverage(r, 5), "every input piece appears exactly once, as a survivor or absorbed");
  });
  test("a lone piece is kept whatever its length; a page of nothing but short pieces keeps its first with the rest folded in (before T41 such a page lost every piece)", () => {
    assert.deepStrictEqual(fold.foldSubMinimum(["tiny"], 50).chunks.map((c) => c.body), ["tiny"]);
    const r = fold.foldSubMinimum(["one short", "two short", "three short"], 50);
    assert.strictEqual(r.chunks.length, 1);
    assert.strictEqual(r.chunks[0].body, "one short\ntwo short\nthree short");
    assert.strictEqual(r.folded, 2);
    assert.deepStrictEqual(r.chunks[0].absorbed, [1, 2]);
  });
  test("prefer: 'previous' (the markdown path) folds a short piece into its predecessor; the first piece, having none, into its successor", () => {
    const r = fold.foldSubMinimum(["# Title", LONG_A, "short tail", LONG_B, "end."], 50, { prefer: "previous" });
    assert.deepStrictEqual(r.chunks.map((c) => c.body), [`# Title\n${LONG_A}\nshort tail`, `${LONG_B}\nend.`]);
    assert.deepStrictEqual(r.details.map((d) => `${d.index}:${d.into}`), ["0:next", "2:previous", "4:previous"]);
    assert.strictEqual(r.folded, 3);
    assert.ok(coverage(r, 5));
  });
  test("a minimum of 0 folds nothing; empty strings are ignored and the indices refer to the input array", () => {
    const r0 = fold.foldSubMinimum(["a", "b"], 0);
    assert.strictEqual(r0.folded, 0);
    assert.deepStrictEqual(r0.chunks.map((c) => c.body), ["a", "b"]);
    const r = fold.foldSubMinimum(["", LONG_A, "", "tail", ""], 50);
    assert.strictEqual(r.chunks.length, 1);
    assert.strictEqual(r.chunks[0].index, 1);
    assert.deepStrictEqual(r.chunks[0].absorbed, [3]);
    assert.strictEqual(r.chunks[0].body, `${LONG_A}\ntail`);
  });
  test("the minimum is normalised like the parser's setting (a numeric string; unreadable is 50) and reported", () => {
    assert.strictEqual(fold.foldSubMinimum([LONG_A, "x"], "150").minChunkSize, 150);
    assert.strictEqual(fold.foldSubMinimum([LONG_A, "x"], "nope").minChunkSize, 50);
    assert.strictEqual(fold.foldSubMinimum([LONG_A, LONG_B, LONG_C], 50).folded, 0, "nothing under the minimum: nothing folds");
  });
  test("the fold never removes characters that were in no neighbour: every piece's text is a substring of the page's chunks joined", () => {
    const pieces = [LONG_A, "orphan heading", `orphan heading\n\n${LONG_B}`, "a closing sentence of the page."];
    const r = fold.foldSubMinimum(pieces, 50);
    const joined = r.chunks.map((c) => c.body).join("\n");
    for (const p of pieces) for (const line of p.split("\n")) if (line.trim()) assert.ok(joined.includes(line.trim()), `${JSON.stringify(line)} survives`);
    assert.strictEqual((joined.match(/orphan heading/g) || []).length, 1, "the overlap is stored once");
  });
});
