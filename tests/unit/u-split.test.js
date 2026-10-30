/**
 * U-SPLIT — chunker invariants (evaluation-plan §2).
 *
 * Property-based over `recursiveSplit` (src/lib/ingestion/parser.js:103-162)
 * using a seeded PRNG, so a failure is always reproducible: the seed is printed
 * in the assertion message and can be replayed via GOLDEN_SPLIT_SEED.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const { readFixture } = require("./_helpers");
const { recursiveSplit } = require("../../src/lib/ingestion/parser.js");

/** Deterministic 32-bit PRNG (mulberry32) — no Math.random anywhere. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "reconciliation", "settlement", "ledger", "clearing", "exception", "cutoff",
  "audit", "break", "owner", "reference", "posting", "variance", "tolerance",
];

function synthesiseText(rng, approxLength) {
  const parts = [];
  let length = 0;
  while (length < approxLength) {
    const sentenceWords = 4 + Math.floor(rng() * 12);
    const sentence = [];
    for (let i = 0; i < sentenceWords; i += 1) {
      sentence.push(WORDS[Math.floor(rng() * WORDS.length)]);
    }
    const text = sentence.join(" ") + ".";
    parts.push(text);
    length += text.length + 1;
    if (rng() < 0.2) {
      parts.push("\n\n");
      length += 2;
    } else {
      parts.push(" ");
      length += 1;
    }
  }
  return parts.join("");
}

/**
 * Words are the loss-detection unit: chunking may re-space and may drop the
 * separator sitting exactly on a chunk boundary, but must never drop a content
 * word. Tokens are normalised to their alphanumeric core so that boundary
 * punctuation ("clearing." -> "clearing") is not mistaken for content loss —
 * see the dedicated boundary-separator test below, which pins that behaviour.
 */
function wordMultiset(text) {
  const counts = new Map();
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!word) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return counts;
}

const BASE_SEED = Number(process.env.GOLDEN_SPLIT_SEED || 20260812);
const CASE_COUNT = Number(process.env.GOLDEN_SPLIT_CASES || 40);

describe("U-SPLIT: recursiveSplit invariants", () => {
  test("every piece respects the chunk size budget", () => {
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const seed = BASE_SEED + i;
      const rng = makeRng(seed);
      const chunkSize = 120 + Math.floor(rng() * 900);
      const overlap = Math.floor(rng() * Math.min(200, chunkSize / 2));
      const text = synthesiseText(rng, chunkSize * (2 + Math.floor(rng() * 6)));

      const pieces = recursiveSplit(text, chunkSize, overlap);
      for (const piece of pieces) {
        assert.ok(
          piece.length <= chunkSize,
          `seed=${seed} chunkSize=${chunkSize}: produced a ${piece.length}-char piece`
        );
      }
    }
  });

  test("no words are lost", () => {
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const seed = BASE_SEED + 1000 + i;
      const rng = makeRng(seed);
      const chunkSize = 150 + Math.floor(rng() * 600);
      const text = synthesiseText(rng, chunkSize * (2 + Math.floor(rng() * 5)));

      // Overlap duplicates content by design, so the output multiset must
      // *contain* the input multiset rather than equal it.
      const pieces = recursiveSplit(text, chunkSize, 0);
      const before = wordMultiset(text);
      const after = wordMultiset(pieces.join(" "));

      for (const [word, count] of before) {
        const got = after.get(word) || 0;
        assert.ok(
          got >= count,
          `seed=${seed}: word "${word}" appeared ${count}x in input but ${got}x in output`
        );
      }
    }
  });

  test("splitting is deterministic across runs", () => {
    for (let i = 0; i < 10; i += 1) {
      const seed = BASE_SEED + 2000 + i;
      const rng = makeRng(seed);
      const chunkSize = 200 + Math.floor(rng() * 400);
      const text = synthesiseText(makeRng(seed), chunkSize * 4);

      const first = recursiveSplit(text, chunkSize, 50);
      const second = recursiveSplit(text, chunkSize, 50);
      assert.deepEqual(second, first, `seed=${seed}: repeated split produced different output`);
    }
  });

  test("overlap never exceeds the configured budget plus one separator", () => {
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const seed = BASE_SEED + 3000 + i;
      const rng = makeRng(seed);
      const chunkSize = 200 + Math.floor(rng() * 500);
      const overlap = 20 + Math.floor(rng() * Math.min(180, chunkSize / 2));
      const text = synthesiseText(rng, chunkSize * 4);

      const pieces = recursiveSplit(text, chunkSize, overlap);
      for (let p = 1; p < pieces.length; p += 1) {
        const previous = pieces[p - 1];
        const current = pieces[p];

        // Longest suffix of `previous` that prefixes `current`.
        let shared = 0;
        const limit = Math.min(previous.length, current.length);
        for (let len = limit; len > 0; len -= 1) {
          if (previous.endsWith(current.slice(0, len))) {
            shared = len;
            break;
          }
        }
        assert.ok(
          shared <= overlap + 2,
          `seed=${seed}: overlap of ${shared} chars exceeds budget ${overlap} (+1 separator)`
        );
      }
    }
  });

  test("a separator landing on a chunk boundary is consumed, not preserved", () => {
    // Documented behaviour, pinned so a future change is visible. recursiveSplit
    // splits on ". " and rejoins parts with the separator *within* a chunk, but
    // the separator between the last part of one chunk and the first part of the
    // next is dropped. Content words always survive; a chunk-terminal sentence
    // loses its full stop. Recorded in inputs/rag-audit/followups.md (F-3).
    const text =
      "alpha beta clearing. gamma delta clearing. epsilon zeta eta theta " +
      "iota kappa lambda mu nu xi omicron pi rho sigma tau";
    const pieces = recursiveSplit(text, 60, 0);
    const joined = pieces.join(" ");

    assert.equal((text.match(/clearing/g) || []).length, 2);
    assert.equal(
      (joined.match(/clearing/g) || []).length,
      2,
      "content words must survive chunking"
    );
    assert.equal(
      (joined.match(/clearing\./g) || []).length,
      1,
      "the boundary full stop is consumed — pinning current behaviour"
    );
  });

  test("empty and whitespace-only input do not throw", () => {
    for (const input of ["", "   ", "\n\n\n"]) {
      const pieces = recursiveSplit(input, 500, 50);
      assert.ok(Array.isArray(pieces), `expected an array for input ${JSON.stringify(input)}`);
    }
  });

  test("separator-free input terminates inside the time budget", () => {
    const text = readFixture("tests/fixtures/golden/adversarial/huge_line.txt").toString("utf-8");
    const started = Date.now();
    const pieces = recursiveSplit(text, 800, 100);
    const elapsedSeconds = (Date.now() - started) / 1000;

    assert.ok(pieces.length > 1, "separator-free input must still split");
    assert.ok(elapsedSeconds < 2, `took ${elapsedSeconds}s, budget is 2s`);
  });
});


// T41 (t41-design.md D4; T02): an overlap that is not smaller than half the chunk size made every accumulated piece
// too big and the recursion cut characters — a 200-character CSV chunking with overlap 200 read 90 chunks and 96
// broken rows (§0d). The splitter clamps such an overlap to half the chunk size and says so once.
describe("U-SPLIT/T41 (t41-design D4): an overlap at or above half the chunk size is clamped, and the splitter never cuts a CSV row", () => {
  const { recursiveSplit } = require("../../src/lib/ingestion/parser");
  const csv = require("fs").readFileSync(require("path").join(__dirname, "..", "fixtures", "golden", "csv_table.csv"), "utf8");
  const rows = (pieces) => pieces.flatMap((p) => p.split("\n")).map((l) => l.trim()).filter((l) => l && !/^plot_id/.test(l));
  test("overlap 200 at chunkSize 200 behaves as overlap 100: every piece within the size, every row intact (96 broken rows before T41)", () => {
    const warned = [];
    const orig = console.warn; console.warn = (m) => warned.push(String(m));
    let pieces;
    try { pieces = recursiveSplit(csv, 200, 200); } finally { console.warn = orig; }
    assert.ok(pieces.every((p) => p.length <= 200), `no piece over 200: ${pieces.map((p) => p.length).join("/")}`);
    assert.strictEqual(rows(pieces).filter((l) => !/^P\d{3},Design\d{2},\d+,\d+,\d+$/.test(l)).length, 0, "no row cut");
    assert.ok(pieces.length < 20, `a handful of chunks, not 90: ${pieces.length}`);
    assert.ok(warned.some((m) => /chunkOverlap 200 is not smaller than half of chunkSize 200: clamped to 100/.test(m)), "said once on the console");
    const again = [];
    console.warn = (m) => again.push(String(m));
    try { recursiveSplit(csv, 200, 200); } finally { console.warn = orig; }
    assert.strictEqual(again.length, 0, "once per (size, overlap) pair");
  });
  test("an overlap under half the chunk size is untouched, a negative or unreadable one is 0", () => {
    assert.deepStrictEqual(recursiveSplit(csv, 200, 0), recursiveSplit(csv, 200, -3));
    assert.deepStrictEqual(recursiveSplit(csv, 200, 0), recursiveSplit(csv, 200, "nope"));
    assert.ok(recursiveSplit(csv, 200, 99).every((p) => p.length <= 200));
  });
});
