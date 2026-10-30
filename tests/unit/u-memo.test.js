/**
 * U-MEMO — the persisted caption memo's contract, offline (ticket T29;
 * design §3, §8). A temp directory stands in for the ledger volume.
 *   - the key: the same bytes give the same key; each of the six parts (crop,
 *     model name, model digest, server, prompt, decoding) changes it; the
 *     decoding is order-independent; the server origin is normalised the way
 *     the captioner normalises its URL;
 *   - the store: put then get round-trips; `has` reads no body; an unreadable
 *     or mismatched record is a miss; a write is atomic (a whole file appears,
 *     no temp file stays); a write failure is { ok: false } and never throws;
 *     only the memoised outcomes are accepted; `list` counts by source /
 *     outcome / model; `remove` is for a suite that owns its keys (F-95);
 *   - `defaultMemoDir` honours RAG_CAPTION_MEMO_DIR and sits beside the ledger.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const memo = require("../../src/lib/ingestion/caption_memo.js");

const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
const CROP = Buffer.alloc(5000, 3);
const BASE = { cropBytes: CROP, modelName: "qwen3-vl:30b", modelDigest: "eda0be1008774ea4e575187712b9a3b1201f3e66e7ecff899cc295db1cf00248", ollamaUrl: "http://ollama.ollama.svc.cluster.local:11434/v1/", prompt: "the prompt", decoding: { temperature: 0, seed: 42, num_predict: 6144 } };

describe("U-MEMO: the key (design D1, the stricter option)", () => {
  test("the same inputs give the same 64-hex key; the material names every part", () => {
    const a = memo.memoKey(BASE), b = memo.memoKey({ ...BASE, cropBytes: Buffer.from(CROP) });
    assert.strictEqual(a.key, b.key);
    assert.match(a.key, /^[0-9a-f]{64}$/);
    assert.strictEqual(a.cropMd5, md5(CROP));
    assert.strictEqual(a.promptMd5, md5("the prompt"));
    assert.strictEqual(a.server, "http://ollama.ollama.svc.cluster.local:11434", "the /v1/ suffix is not part of the server's identity");
    assert.strictEqual(a.decodingCanonical, '{"num_predict":6144,"seed":42,"temperature":0}');
    assert.match(a.material, /^captionmemo\/v1\ncrop=md5:[0-9a-f]{32}\nmodel=qwen3-vl:30b\ndigest=eda0be10/);
    assert.match(a.material, /\nserver=http:\/\/ollama\.ollama\.svc\.cluster\.local:11434\nprompt=md5:[0-9a-f]{32}\ndecoding=\{"num_predict":6144,"seed":42,"temperature":0\}$/);
  });

  test("each part changes the key: the crop, the model name, the digest, the server, the prompt, the decoding", () => {
    const k = memo.memoKey(BASE).key;
    assert.notStrictEqual(memo.memoKey({ ...BASE, cropBytes: Buffer.alloc(5000, 4) }).key, k, "crop bytes");
    assert.notStrictEqual(memo.memoKey({ ...BASE, modelName: "qwen3-vl:32b" }).key, k, "model name");
    assert.notStrictEqual(memo.memoKey({ ...BASE, modelDigest: "ffff" }).key, k, "model digest (a re-pulled tag)");
    assert.notStrictEqual(memo.memoKey({ ...BASE, ollamaUrl: "http://other:11434" }).key, k, "server");
    assert.notStrictEqual(memo.memoKey({ ...BASE, prompt: "another prompt" }).key, k, "prompt");
    assert.notStrictEqual(memo.memoKey({ ...BASE, decoding: { ...BASE.decoding, num_predict: 4096 } }).key, k, "decoding (the cap included)");
    assert.strictEqual(memo.memoKey({ ...BASE, decoding: { num_predict: 6144, temperature: 0, seed: 42 } }).key, k, "the decoding's key order does not matter");
    assert.strictEqual(memo.memoKey({ ...BASE, cropBytes: undefined, cropMd5: md5(CROP) }).key, k, "a precomputed crop md5 is the same identity");
    assert.strictEqual(memo.memoKey({ ...BASE, prompt: undefined, promptMd5: md5("the prompt") }).key, k);
    assert.strictEqual(memo.memoKey({ ...BASE, ollamaUrl: undefined, server: "http://ollama.ollama.svc.cluster.local:11434" }).key, k);
  });

  test("a missing part is an error, never a weaker key", () => {
    for (const part of ["modelName", "modelDigest", "prompt", "decoding", "ollamaUrl"]) {
      assert.throws(() => memo.memoKey({ ...BASE, [part]: undefined }), new RegExp("is required"), part);
    }
    assert.throws(() => memo.memoKey({ ...BASE, cropBytes: undefined }), /is required/);
    assert.throws(() => memo.memoKey({ ...BASE, cropBytes: undefined, cropMd5: "abc" }), /32 hex/);
  });

  test("serverOrigin: trailing slashes and /v1 stripped, lower-cased; an unparsable value is used as given", () => {
    assert.strictEqual(memo.serverOrigin("http://ollama.ollama.svc.cluster.local:11434/v1/"), "http://ollama.ollama.svc.cluster.local:11434");
    assert.strictEqual(memo.serverOrigin("HTTP://Ollama:11434"), "http://ollama:11434");
    assert.strictEqual(memo.serverOrigin("https://ollama.demo.lon-pcai.twlon.com/v1"), "https://ollama.demo.lon-pcai.twlon.com");
    assert.strictEqual(memo.serverOrigin("not a url"), "not a url");
  });

  test("canonicalJson sorts keys at every depth", () => {
    assert.strictEqual(memo.canonicalJson({ b: { z: 1, a: [3, { y: 2, x: 1 }] }, a: null }), '{"a":null,"b":{"a":[3,{"x":1,"y":2}],"z":1}}');
  });
});

describe("U-MEMO: the store (design D4)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u-memo-"));
  const store = memo.openCaptionMemo({ dir, log: { warn: () => {} } });
  const keyInfo = memo.memoKey(BASE);

  test("put then get round-trips a captioned record; has reads no body; the file sits in a two-character bucket", () => {
    assert.strictEqual(store.get(keyInfo.key), null);
    assert.strictEqual(store.has(keyInfo.key), false);
    const rec = memo.makeRecord({ keyInfo, cropBytes: CROP, outcome: "captioned", caption: "HUMAN TITLE: x", source: "vlm", jobId: "j1", ms: 1234, hint: { fileName: "a.pdf", page: 1, figureId: "fig_1_0", docHash: "d" } });
    const w = store.put(rec);
    assert.deepStrictEqual({ ok: w.ok, error: w.error }, { ok: true, error: null });
    assert.strictEqual(w.path, path.join(dir, keyInfo.key.slice(0, 2), `${keyInfo.key}.json`));
    assert.strictEqual(store.has(keyInfo.key), true);
    const back = store.get(keyInfo.key);
    assert.strictEqual(back.outcome, "captioned");
    assert.strictEqual(back.caption, "HUMAN TITLE: x");
    assert.strictEqual(back.v, memo.MEMO_RECORD_VERSION);
    assert.deepStrictEqual(back.crop, { md5: md5(CROP), bytes: 5000 });
    assert.deepStrictEqual({ m: back.model, d: back.modelDigest, s: back.server, p: back.promptMd5, dec: back.decoding }, { m: "qwen3-vl:30b", d: BASE.modelDigest, s: "http://ollama.ollama.svc.cluster.local:11434", p: md5("the prompt"), dec: { num_predict: 6144, seed: 42, temperature: 0 } });
    assert.deepStrictEqual({ src: back.source, job: back.jobId, ms: back.ms, hint: back.hint }, { src: "vlm", job: "j1", ms: 1234, hint: { fileName: "a.pdf", page: 1, figureId: "fig_1_0", docHash: "d" } });
    assert.match(back.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.strictEqual("seed" in back, false, "no provenance block on a vlm record");
    assert.ok(!fs.readdirSync(path.dirname(w.path)).some((n) => /\.tmp-/.test(n)), "no temp file left behind");
  });

  test("decorative, textOnly and truncated records carry no caption; failures and empty are refused by makeRecord and by put", () => {
    const k2 = memo.memoKey({ ...BASE, cropBytes: Buffer.alloc(5000, 9) });
    const dec = memo.makeRecord({ keyInfo: k2, cropBytes: CROP, outcome: "decorative" });
    assert.strictEqual(dec.caption, null);
    assert.strictEqual(store.put(dec).ok, true);
    assert.strictEqual(store.get(k2.key).outcome, "decorative");
    const k3 = memo.memoKey({ ...BASE, cropBytes: Buffer.alloc(5000, 10) });
    assert.strictEqual(memo.makeRecord({ keyInfo: k3, cropBytes: CROP, outcome: "truncated" }).outcome, "truncated");
    for (const o of ["timeout", "http_error", "error", "missing", "empty", "tiny"]) {
      assert.throws(() => memo.makeRecord({ keyInfo: k3, cropBytes: CROP, outcome: o }), /not memoised/, o);
      const forged = { ...memo.makeRecord({ keyInfo: k3, cropBytes: CROP, outcome: "decorative" }), outcome: o };
      assert.match(store.put(forged).error, /refused/, `put refuses ${o}`);
    }
    assert.throws(() => memo.makeRecord({ keyInfo: k3, cropBytes: CROP, outcome: "captioned", caption: "" }), /needs its caption/);
    assert.throws(() => memo.makeRecord({ keyInfo: k3, cropBytes: CROP, outcome: "captioned", caption: "c", source: "guess" }), /source guess/);
    // T32 (design D8): textOnly joins the memoised outcomes — a verdict with no caption; a caption on it is refused.
    assert.deepStrictEqual(memo.MEMOISED_OUTCOMES, ["captioned", "decorative", "textOnly", "truncated"]);
    assert.ok(Object.isFrozen(memo.MEMOISED_OUTCOMES));
    const k4 = memo.memoKey({ ...BASE, cropBytes: Buffer.alloc(5000, 14) });
    const textOnly = memo.makeRecord({ keyInfo: k4, cropBytes: CROP, outcome: "textOnly" });
    assert.deepStrictEqual({ o: textOnly.outcome, c: textOnly.caption, v: textOnly.v }, { o: "textOnly", c: null, v: 1 }, "the record format stays v1 (additive)");
    assert.strictEqual(store.put(textOnly).ok, true);
    assert.strictEqual(store.get(k4.key).outcome, "textOnly");
    assert.match(store.put({ ...textOnly, caption: "a caption" }).error, /a caption on a non-captioned outcome/, "a textOnly record with a caption is refused");
    assert.strictEqual(memo.validateRecord({ ...textOnly, caption: "x" }), "a caption on a non-captioned outcome");
  });

  test("an unreadable record is a miss (not JSON, wrong version, key mismatch, a caption on a decorative); a later put overwrites it", () => {
    const k = memo.memoKey({ ...BASE, cropBytes: Buffer.alloc(5000, 11) });
    const file = store.path(k.key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    assert.strictEqual(store.get(k.key), null);
    assert.strictEqual(store.has(k.key), true, "has is existence only; get is the judge");
    const good = memo.makeRecord({ keyInfo: k, cropBytes: CROP, outcome: "captioned", caption: "c" });
    fs.writeFileSync(file, JSON.stringify({ ...good, v: 99 }));
    assert.strictEqual(store.get(k.key), null, "another record version");
    fs.writeFileSync(file, JSON.stringify({ ...good, key: "0".repeat(64) }));
    assert.strictEqual(store.get(k.key), null, "a record under the wrong name");
    fs.writeFileSync(file, JSON.stringify({ ...good, outcome: "decorative" }));
    assert.strictEqual(store.get(k.key), null, "a caption on a non-captioned outcome");
    assert.strictEqual(store.put(good).ok, true);
    assert.strictEqual(store.get(k.key).caption, "c");
    assert.strictEqual(memo.validateRecord(good), null);
    assert.strictEqual(memo.validateRecord(null), "not an object");
  });

  test("a write failure is { ok: false } with the reason, never a throw; the temp file is removed", () => {
    const failing = { ...fs, renameSync: () => { throw new Error("EIO: nfs went away"); } };
    const s2 = memo.openCaptionMemo({ dir, fsImpl: failing, log: { warn: () => {} } });
    const k = memo.memoKey({ ...BASE, cropBytes: Buffer.alloc(5000, 12) });
    const w = s2.put(memo.makeRecord({ keyInfo: k, cropBytes: CROP, outcome: "decorative" }));
    assert.strictEqual(w.ok, false);
    assert.match(w.error, /EIO/);
    assert.strictEqual(fs.existsSync(s2.path(k.key)), false);
    assert.ok(!fs.readdirSync(path.dirname(s2.path(k.key))).some((n) => /\.tmp-/.test(n)), "the temp file is cleaned up");
    const unreadable = memo.openCaptionMemo({ dir, fsImpl: { ...fs, readFileSync: () => { throw new Error("EACCES"); } }, log: { warn: () => {} } });
    assert.strictEqual(unreadable.get(keyInfo.key), null, "a read error is a miss");
  });

  test("list counts by source, outcome and model; remove takes one key; the atomic write shows a whole file", () => {
    const seedKey = memo.memoKey({ ...BASE, cropBytes: Buffer.alloc(5000, 13) });
    store.put(memo.makeRecord({ keyInfo: seedKey, cropBytes: CROP, outcome: "captioned", caption: "seeded", source: "seed", seed: { class: "RAGChunkV2", docVersion: "x.y", chunkIndex: 3, note: "pre-T24 sampled captioner" } }));
    assert.deepStrictEqual(store.get(seedKey.key).seed, { class: "RAGChunkV2", docVersion: "x.y", chunkIndex: 3, note: "pre-T24 sampled captioner" });
    const l = store.list();
    assert.strictEqual(l.exists, true);
    assert.strictEqual(l.count, 5, "the four vlm records above plus the seed (the refused puts and the failed write left nothing)");
    assert.ok(l.bytes > 0);
    assert.deepStrictEqual(l.bySource, { vlm: 4, seed: 1 });
    assert.deepStrictEqual(l.byOutcome, { captioned: 3, decorative: 1, textOnly: 1 }, "T32: the listing counts the text-only verdict");
    assert.deepStrictEqual(Object.keys(l.byModel), ["qwen3-vl:30b@eda0be100877"]);
    assert.strictEqual(l.unreadable, 0);
    const withRecords = store.list({ withRecords: true });
    assert.strictEqual(withRecords.records.length, 5);
    const seedRow = withRecords.records.find((r) => r.key === seedKey.key);
    assert.deepStrictEqual({ o: seedRow.outcome, s: seedRow.source, len: seedRow.captionLength, md5: seedRow.captionMd5 }, { o: "captioned", s: "seed", len: 6, md5: md5("seeded") });
    assert.ok(!JSON.stringify(withRecords).includes('"caption":"seeded"'), "a listing never carries the caption text");
    assert.strictEqual(store.remove(seedKey.key), true);
    assert.strictEqual(store.remove(seedKey.key), false);
    assert.strictEqual(store.list().count, 4);
    const empty = memo.openCaptionMemo({ dir: path.join(dir, "nope") }).list();
    assert.deepStrictEqual({ e: empty.exists, c: empty.count }, { e: false, c: 0 });
  });
});

describe("U-MEMO: where it lives (design D4)", () => {
  test("defaultMemoDir sits beside the ledger under nexcode-data/state/rag and honours RAG_CAPTION_MEMO_DIR", () => {
    const saved = process.env.RAG_CAPTION_MEMO_DIR;
    try {
      delete process.env.RAG_CAPTION_MEMO_DIR;
      assert.strictEqual(memo.defaultMemoDir(), path.join(process.cwd(), "nexcode-data", "state", "rag", "captions"));
      const ledgerDir = path.dirname(require("../../src/lib/rag/ledger.js").defaultLedgerPath());
      assert.strictEqual(path.dirname(memo.defaultMemoDir()), ledgerDir, "the same directory as ledger.jsonl: the same claim, the same fate");
      process.env.RAG_CAPTION_MEMO_DIR = "/tmp/some/where";
      assert.strictEqual(memo.defaultMemoDir(), path.resolve("/tmp/some/where"));
    } finally {
      if (saved === undefined) delete process.env.RAG_CAPTION_MEMO_DIR; else process.env.RAG_CAPTION_MEMO_DIR = saved;
    }
    assert.throws(() => memo.recordPath("/x", "short"), /64 hex/);
  });
});
