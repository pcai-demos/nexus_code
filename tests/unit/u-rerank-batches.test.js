/**
 * U-RERANK-BATCHES — T42 (t42-design.md §2.1, §2.3; D3, D4, D5; F-164): the
 * rerank stage plans its requests.
 *
 * The pure module src/lib/rag/rerank_batches.js: the two bounds (documents
 * and chars, whichever binds first), retrieval order kept, every candidate
 * exactly once, an oversized single document alone and never dropped, the
 * plan's numbers equal to the batches', the deadline arithmetic, and the
 * stage's summary. Offline; reads nothing outside src/.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const { RERANK_BATCH_DEFAULTS, planRerankBatches, remainingBudgetMs, summariseRerankStage } = require("../../src/lib/rag/rerank_batches");

const docs = (lengths) => lengths.map((n, i) => String.fromCharCode(97 + (i % 26)).repeat(n));
const flat = (batches) => batches.flat();

describe("U-RERANK-BATCHES/T42 D3, D4: the defaults", () => {
  test("16 documents / 28,000 chars per request under a 60 s deadline; frozen", () => {
    assert.deepStrictEqual(RERANK_BATCH_DEFAULTS, { maxChars: 28000, maxDocs: 16, budgetMs: 60000 });
    assert.ok(Object.isFrozen(RERANK_BATCH_DEFAULTS));
  });
});

describe("U-RERANK-BATCHES/T42 D3: the cut", () => {
  test("the char bound: five 10,000-char documents at 28,000 → [0,1] [2,3] [4], order kept, every index once", () => {
    const { batches, plan } = planRerankBatches(docs([10000, 10000, 10000, 10000, 10000]), { maxChars: 28000, maxDocs: 16 });
    assert.deepStrictEqual(batches, [[0, 1], [2, 3], [4]]);
    assert.deepStrictEqual(plan.batchChars, [20000, 20000, 10000]);
    assert.deepStrictEqual(plan.batchDocs, [2, 2, 1]);
    assert.strictEqual(plan.batchCount, 3);
    assert.strictEqual(plan.chars, 50000);
    assert.strictEqual(plan.documents, 5);
  });
  test("the document bound: forty 100-char documents at 16 → 16 / 16 / 8", () => {
    const { batches, plan } = planRerankBatches(docs(Array(40).fill(100)), { maxChars: 28000, maxDocs: 16 });
    assert.deepStrictEqual(plan.batchDocs, [16, 16, 8]);
    assert.deepStrictEqual(flat(batches), [...Array(40).keys()]);
  });
  test("whichever binds first: sixteen 2,000-char documents fill 28,000 after fourteen, not sixteen", () => {
    const { plan } = planRerankBatches(docs(Array(16).fill(2000)), { maxChars: 28000, maxDocs: 16 });
    assert.deepStrictEqual(plan.batchDocs, [14, 2]);
    assert.ok(plan.batchChars.every((c) => c <= 28000));
  });
  test("an oversized document goes alone, is named, and its neighbours are kept", () => {
    const { batches, plan } = planRerankBatches(docs([5000, 40000, 5000, 5000]), { maxChars: 28000, maxDocs: 16 });
    assert.deepStrictEqual(batches, [[0], [1], [2, 3]]);
    assert.deepStrictEqual(plan.oversized, [1]);
    assert.strictEqual(plan.batchChars[1], 40000);
  });
  test("the empty pool is zero batches; one small document is one batch", () => {
    assert.deepStrictEqual(planRerankBatches([]).batches, []);
    assert.strictEqual(planRerankBatches([]).plan.batchCount, 0);
    assert.deepStrictEqual(planRerankBatches(["abc"]).batches, [[0]]);
  });
  test("the measured pool: I-PAGECTX 3's fifty documents of ≈ 1,580 chars (79,043 in one request before T42) → four requests, none over 28,000", () => {
    const { batches, plan } = planRerankBatches(docs(Array(50).fill(1581)));
    assert.strictEqual(plan.batchCount, 4);
    assert.deepStrictEqual(plan.batchDocs, [16, 16, 16, 2]);
    assert.ok(plan.batchChars.every((c) => c <= 28000), JSON.stringify(plan.batchChars));
    assert.deepStrictEqual(flat(batches), [...Array(50).keys()]);
  });
  test("the plan's numbers are the batches' — on a mixed pool", () => {
    const lengths = [300, 5357, 1212, 2171, 790, 26000, 567, 1500, 4000, 100];
    const { batches, plan } = planRerankBatches(docs(lengths), { maxChars: 8000, maxDocs: 3 });
    assert.strictEqual(plan.batchCount, batches.length);
    assert.deepStrictEqual(plan.batchDocs, batches.map((b) => b.length));
    assert.deepStrictEqual(plan.batchChars, batches.map((b) => b.reduce((a, i) => a + lengths[i], 0)));
    assert.deepStrictEqual(plan.oversized, [5]);
    assert.deepStrictEqual(flat(batches), [...Array(10).keys()]);
    for (const [k, b] of batches.entries()) if (!plan.oversized.includes(b[0])) assert.ok(plan.batchChars[k] <= 8000 && b.length <= 3, `batch ${k}`);
  });
  test("validation: a non-array, a non-string document, a zero char bound, a fractional document bound", () => {
    assert.throws(() => planRerankBatches("abc"), TypeError);
    assert.throws(() => planRerankBatches(["a", 42]), /document 1 is not a string/);
    assert.throws(() => planRerankBatches(["a"], { maxChars: 0 }), /maxChars/);
    assert.throws(() => planRerankBatches(["a"], { maxDocs: 1.5 }), /maxDocs/);
    assert.throws(() => planRerankBatches(["a"], { maxDocs: 0 }), /maxDocs/);
  });
});

describe("U-RERANK-BATCHES/T42 D4: the deadline", () => {
  test("what is left, never below zero", () => {
    assert.strictEqual(remainingBudgetMs(60000, 25000), 35000);
    assert.strictEqual(remainingBudgetMs(60000, 60000), 0);
    assert.strictEqual(remainingBudgetMs(60000, 90000), 0);
    assert.strictEqual(remainingBudgetMs(90000, 0), 90000);
  });
  test("validation", () => {
    assert.throws(() => remainingBudgetMs(-1, 0), TypeError);
    assert.throws(() => remainingBudgetMs(60000, NaN), TypeError);
    assert.throws(() => remainingBudgetMs(undefined, 0), TypeError);
  });
});

describe("U-RERANK-BATCHES/T42 D5, D8: the stage's summary", () => {
  test("four planned, three sent (two scored, one failed), one unsent by the deadline → PARTIAL by construction", () => {
    const plan = { batchCount: 4, documents: 50 };
    const s = summariseRerankStage(plan, [{ documents: 16, scored: 16 }, { documents: 16, scored: 16 }, { documents: 16, scored: 0 }]);
    assert.deepStrictEqual(s, { planned: 4, sent: 3, failed: 1, unsent: 1, scored: 32, unscored: 18, stoppedEarly: true });
  });
  test("everything sent and scored → nothing unsent, nothing unscored, not stopped early", () => {
    const s = summariseRerankStage({ batchCount: 2, documents: 20 }, [{ documents: 16, scored: 16 }, { documents: 4, scored: 4 }]);
    assert.deepStrictEqual(s, { planned: 2, sent: 2, failed: 0, unsent: 0, scored: 20, unscored: 0, stoppedEarly: false });
  });
  test("nothing sent (the deadline was already spent, or the pool was empty)", () => {
    assert.deepStrictEqual(summariseRerankStage({ batchCount: 3, documents: 40 }, []), { planned: 3, sent: 0, failed: 0, unsent: 3, scored: 0, unscored: 40, stoppedEarly: true });
    assert.deepStrictEqual(summariseRerankStage({ batchCount: 0, documents: 0 }, []), { planned: 0, sent: 0, failed: 0, unsent: 0, scored: 0, unscored: 0, stoppedEarly: false });
  });
});
