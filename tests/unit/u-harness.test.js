/**
 * U-HARNESS — T39 (harness hygiene; t39-design.md D2–D7, D11, D12): the instrument's own contract, pinned so the
 * defects that cost sessions 36–40 a false red or a wrong estimate cannot come back unnoticed.
 *
 *   D2  one chat model — the harness and every live runner fall back to vlm_captioner.js's DEFAULT_CAPTION_MODEL
 *       (F-154, F-138)
 *   D3  one SSE frame reader — parseFrame / readFrame / waitForIngestion read to the frame boundary (F-140)
 *   D4  the re-ingest pre-flight tells a caption render from a detail_* tile (F-143)
 *   D5  the T36 witness runs against a live class and skips a retired one by name (F-152)
 *   D6  the T15 chat probe creates its record directory (F-139)
 *   D7  the tree-hash walk skips __pycache__ and the tree carries no bytecode (F-153)
 *   D11 the chain's inputs resolve from the image (chain_inputs.sh; the committed question set md5-pinned)
 *   D12 no chain step's exit code comes from a trailing grep / cut pipeline
 *
 * Offline: the frame reader is exercised against a local http server that streams a thirteen-file frame in two
 * chunks and never closes — the shape of GET /api/ingest/status.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

const harness = require("../integration/_harness.js");
const { DEFAULT_CAPTION_MODEL } = require("../../src/lib/ingestion/vlm_captioner.js");

const CHAIN_RUNNERS = [
  "tests/eval/baselines/t32-artifacts/run_t32_chain.sh",
  "tests/eval/baselines/f134-artifacts/run_f134_chain.sh",
  "tests/eval/baselines/t35-artifacts/run_t35_chain.sh",
];
const LIVE_CHAT_RUNNERS = [
  "tests/eval/baselines/t23-artifacts/run_pod_gates.sh",
  "tests/eval/baselines/t15-artifacts/run_t15_suites.sh",
  "tests/eval/baselines/t15-artifacts/probes/t15_chat_probe.js",
  "tests/eval/baselines/t15-artifacts/probes/t15_history_probe.js",
];

describe("U-HARNESS/T39 D2: one chat model (F-154, F-138)", () => {
  test("the harness's default chat model IS the demo's — vlm_captioner.js's DEFAULT_CAPTION_MODEL, not a literal", () => {
    assert.strictEqual(harness.DEFAULT_CHAT_MODEL, DEFAULT_CAPTION_MODEL);
    const src = codeOnly(read("tests/integration/_harness.js"));
    assert.ok(!/qwen3-vl:30b|qwen3\.6:27b|qwen3\.8:27b/.test(src), "no chat-model literal in the harness");
    assert.match(src, /chatModel: process\.env\.RAG_EVAL_CHAT_MODEL \|\| DEFAULT_CHAT_MODEL/);
  });

  test("envConfig() falls back to that constant when RAG_EVAL_CHAT_MODEL is unset, and honours it when set", () => {
    const saved = { ...process.env };
    try {
      process.env.RAG_EVAL_WEAVIATE_URL = "http://w.test"; process.env.RAG_EVAL_EMBED_URL = "http://e.test/v1"; process.env.RAG_EVAL_EMBED_MODEL = "m";
      delete process.env.RAG_EVAL_CHAT_MODEL;
      assert.strictEqual(harness.envConfig().chatModel, DEFAULT_CAPTION_MODEL, "unset → the demo's chat model");
      process.env.RAG_EVAL_CHAT_MODEL = "some-other:model";
      assert.strictEqual(harness.envConfig().chatModel, "some-other:model", "set → honoured (an A/B is still possible)");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  for (const rel of LIVE_CHAT_RUNNERS) {
    test(`${path.basename(rel)} names no chat model of its own — it reads DEFAULT_CAPTION_MODEL`, () => {
      const src = codeOnly(read(rel));
      assert.ok(!/RAG_EVAL_CHAT_MODEL\s*(\|\||=|:-)\s*["']?qwen/.test(src), `no literal chat default in ${rel}`);
      assert.ok(!/RAG_EVAL_CHAT_MODEL="qwen/.test(src), `no exported literal in ${rel}`);
      assert.match(src, /DEFAULT_CAPTION_MODEL/, `${rel} reads the one constant`);
    });
  }
});

describe("U-HARNESS/T39 D3: one SSE frame reader (F-140)", () => {
  const thirteenFileFrame = () => {
    const payload = { jobId: "j1", status: "processing", fileResults: Array.from({ length: 13 }, (_, i) => ({ fileName: `f${i}.pdf`, status: "indexing", evidence: { recorded: 100 + i, note: "x".repeat(1800) } })) };
    return `event: status\ndata: ${JSON.stringify(payload)}\n\n`;
  };

  test("parseFrame: a frame cut at 22,371 chars is incomplete, not a parse error; the whole frame parses; the FIRST event wins", () => {
    const frame = thirteenFileFrame();
    assert.ok(frame.length > 22371, "a thirteen-file frame is well over one chunk");
    const cut = frame.slice(0, 22371);
    assert.deepStrictEqual(harness.parseFrame(cut), { complete: false, payload: null });
    assert.throws(() => JSON.parse(cut.split("\n").find((l) => l.startsWith("data: ")).slice(6)), SyntaxError, "…which is what the one-read poller parsed (F-140)");
    const whole = harness.parseFrame(cut + frame.slice(22371));
    assert.strictEqual(whole.complete, true);
    assert.strictEqual(whole.payload.fileResults.length, 13);
    assert.strictEqual(harness.parseFrame(`data: {"jobId":"a","status":"completed"}\n\ndata: {"jobId":"b"}\n\n`).payload.jobId, "a");
    assert.deepStrictEqual(harness.parseFrame(": keep-alive\n"), { complete: false, payload: null });
    assert.deepStrictEqual(harness.parseFrame(""), { complete: false, payload: null });
  });

  /** A stand-in for GET /api/ingest/status: streams `frames[n]` on the n-th request, in `pieces` chunks, never closes. */
  function statusServer(frames, { pieces = 2, gapMs = 30 } = {}) {
    let n = 0;
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(req.url);
      const frame = frames[Math.min(n++, frames.length - 1)];
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const size = Math.ceil(frame.length / pieces);
      let i = 0;
      const tick = () => { if (i < pieces) { res.write(frame.slice(i * size, (i + 1) * size)); i++; setTimeout(tick, gapMs); } };
      tick();
      req.on("close", () => { try { res.destroy(); } catch (e) { /* the client cancelled */ } });
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, server, seen })));
  }

  test("readFrame reads until the event is complete across two chunks and cancels — the thirteen-file frame that broke the D4 --go", async () => {
    const { url, server } = await statusServer([thirteenFileFrame()], { pieces: 2 });
    try {
      const j = await harness.readFrame(url, "j1");
      assert.strictEqual(j.jobId, "j1");
      assert.strictEqual(j.fileResults.length, 13);
    } finally { server.close(); }
  });

  test("readFrame refuses another job's frame (F-18) instead of returning it", async () => {
    const { url, server } = await statusServer([`data: {"jobId":"other","status":"completed"}\n\n`]);
    try {
      await assert.rejects(() => harness.readFrame(url, "mine"), /\[F-18\]/);
    } finally { server.close(); }
  });

  test("waitForIngestion polls whole frames and settles on the first non-processing one; a job id is on the URL", async () => {
    const done = `data: ${JSON.stringify({ jobId: "j1", status: "completed", chunksIndexed: 7 })}\n\n`;
    const { url, server, seen } = await statusServer([thirteenFileFrame(), thirteenFileFrame(), done], { pieces: 3, gapMs: 10 });
    try {
      const frames = [];
      const j = await harness.waitForIngestion(url, "j1", 20000, { onFrame: (f) => frames.push(f.status), everyMs: 20 });
      assert.strictEqual(j.status, "completed");
      assert.strictEqual(j.chunksIndexed, 7);
      assert.deepStrictEqual(frames, ["processing", "processing", "completed"]);
      assert.ok(seen.every((u) => u.includes("jobId=j1")), "every poll named the job");
    } finally { server.close(); }
  });

  test("waitForIngestion retries a read that does not complete and lets only the deadline throw", async () => {
    // A frame with no terminating blank line never completes; the reader hits its read cap and the poller retries until the deadline.
    const { url, server } = await statusServer([`data: {"jobId":"j1","status":"processing"`], { pieces: 1 });
    try {
      const errors = [];
      await assert.rejects(() => harness.waitForIngestion(url, "j1", 400, { onError: (e) => errors.push(e.message), everyMs: 50 }), /did not settle within 400ms/);
      assert.ok(errors.length >= 1, "each failed read was reported, not swallowed");
    } finally { server.close(); }
  });

  test("the D4 runner reads through the harness (one reader in the tree) and keeps none of its own", () => {
    const src = codeOnly(read("tests/eval/baselines/t37-artifacts/recaption_production.js"));
    assert.match(src, /const \{ parseFrame, readFrame \} = require\([^)]*_harness\.js"\)\)/);
    assert.ok(!/function parseFrame\(|function readFrame\(/.test(src));
    const runner = require("../eval/baselines/t37-artifacts/recaption_production.js");
    assert.strictEqual(runner.parseFrame, harness.parseFrame);
    assert.strictEqual(runner.readFrame, harness.readFrame);
  });
});

describe("U-HARNESS/T39 D4: the pre-flight tells a caption render from a tile (F-143)", () => {
  const runner = require("../eval/baselines/t37-artifacts/recaption_production.js");
  test("detail_* files are tiles; anything else is a caption render", () => {
    assert.strictEqual(runner.isDetailFile("detail_p2_r1c1.png"), true);
    assert.strictEqual(runner.isDetailFile("detail_p28_whole.png"), true);
    assert.strictEqual(runner.isDetailFile("DETAIL_x.png"), true, "case-insensitive");
    assert.strictEqual(runner.isDetailFile("figure_3.png"), false);
    assert.strictEqual(runner.isDetailFile("page_2_picture_1.png"), false);
    assert.strictEqual(runner.isDetailFile(""), false);
  });
  test("the walk keys only caption renders, counts tiles apart, and the verdict sums the tiles' memo writes too", () => {
    const src = codeOnly(read("tests/eval/baselines/t37-artifacts/recaption_production.js"));
    assert.match(src, /const tileFiles = pngs\.filter\(isDetailFile\);\s*const crops = pngs\.filter\(\(n\) => !isDetailFile\(n\)\);/, "tiles are split off before keying");
    assert.match(src, /tiles: tileFiles\.length/, "the per-document record carries the tile count");
    assert.match(src, /tiles: tilesTotal, tilesRecordedFromMemo/, "the cost line names the tiles apart from the crops to ask");
    assert.match(src, /memoGrewByTheJobsMemoised: record\.memo\.delta === null \? null : record\.memo\.delta === sum\("figuresMemoised"\) \+ sum\("detailMemoised"\)/, "the memo's growth is captions + tiles");
    assert.match(src, /detailCallsByTheJob: sum\("detailCalls"\)/, "the detail calls are reported beside the caption calls");
    assert.match(src, /vlmCallsAsPredicted: Number\.isFinite\(toAskTotal\) \? sum\("vlmCalls"\) === toAskTotal : null/, "the caption calls are compared with the caption prediction alone");
  });
  test("the D4 compare script types a detail chunk as its own kind", () => {
    const src = codeOnly(read("tests/eval/baselines/t37-artifacts/d4/compare_dryrun.js"));
    assert.match(src, /\[VISUAL DETAIL:.*\? "detail"/);
  });
});

describe("U-HARNESS/T39 D5: the T36 witness against a live class (F-152)", () => {
  test("the witness checks the class exists, skips a retired one by name with exit 0, and gates the request's SHAPE", () => {
    const src = codeOnly(read("tests/eval/baselines/f134-artifacts/probes/witness_prompt.js"));
    assert.match(src, /async function classExists\(\)/);
    assert.match(src, /WITNESS: SKIPPED/);
    assert.match(src, /process\.exit\(0\);\s*\}\s*const before = JSON\.parse/, "the skip exits 0 before any turn is sent");
    assert.match(src, /sys\.endsWith\(MASTER\)/, "the system message's tail is page.js's MASTER_SYSTEM_PROMPT byte for byte");
    assert.match(src, /const SUMMARY_MARK = "\(Vector Store Summary\)\]";/, "the preamble ends where the class's store summary begins");
    assert.match(src, /if \(preA !== preB\)/, "the preamble is compared byte for byte with the T32 capture's");
    assert.match(src, /if \(user !== bUser\)/, "the user message is compared byte for byte with the T32 capture's");
    assert.match(src, /GENERATION_FLOORS\.enumerate/, "max_tokens is checked against T36's floor");
    assert.match(src, /shapeHolds: diffs\.length === 0/);
    assert.ok(!/promptIdentical: diffs/.test(src), "the byte-identity gate against the T32 capture is retired");
    assert.match(src, /systemPromptIdenticalToBefore/, "…and still REPORTED");
  });
  test("the T36 chain runner asks the store before each retired arm and runs the witness on the chain's live arm", () => {
    const src = read("tests/eval/baselines/f134-artifacts/run_f134_chain.sh");
    assert.match(src, /class_exists\.js "\$T32_ARM_CLASS"/);
    assert.match(src, /class_exists\.js "\$F134_ARM_C_CLASS"/);
    assert.match(src, /SKIPPED fq12B1 fq12B2/);
    assert.match(src, /SKIPPED fq12C1 fq12C2/);
    assert.match(src, /F134_COLLECTION=\$T32_CHAIN_ARM_CLASS/, "the witness runs against the live arm");
    assert.ok(fs.existsSync(path.join(ROOT, "tests/eval/baselines/f134-artifacts/probes/class_exists.js")));
  });
});

describe("U-HARNESS/T39 D6: the T15 chat probe's record (F-139)", () => {
  test("the probe creates T15_OUT (default /tmp/t15) and writes its record there", () => {
    const src = codeOnly(read("tests/eval/baselines/t15-artifacts/probes/t15_chat_probe.js"));
    assert.match(src, /const OUT=process\.env\.T15_OUT\|\|'\/tmp\/t15'; fs\.mkdirSync\(OUT,\{recursive:true\}\);/);
    assert.match(src, /path\.join\(OUT,'t15-chat-probe\.json'\)/);
    assert.ok(!/writeFileSync\('\/tmp\/t15\//.test(src), "no fixed /tmp path");
  });
});

describe("U-HARNESS/T39 D7: the tree hash only source can move (F-153)", () => {
  test("write-build-info.js's walk skips __pycache__ as it skips dotfiles", () => {
    const { walk } = require("../../scripts/write-build-info.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t39walk-"));
    try {
      fs.mkdirSync(path.join(dir, "lib", "__pycache__"), { recursive: true });
      fs.writeFileSync(path.join(dir, "lib", "a.py"), "print(1)\n");
      fs.writeFileSync(path.join(dir, "lib", "__pycache__", "a.cpython-311.pyc"), Buffer.from([0x42]));
      fs.writeFileSync(path.join(dir, "lib", ".DS_Store"), "x");
      const files = walk(dir, []).map((f) => path.relative(dir, f));
      assert.deepStrictEqual(files, [path.join("lib", "a.py")]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  // The point of F-153 is that the tree hash is INDIFFERENT to bytecode, not that bytecode never appears: a `python3 -c`
  // that imports a module under src/ without `sys.dont_write_bytecode` writes a cache, and the pod's own chain did
  // exactly that at 13:04 on 2026-09-18 while the served hash stayed 195c80e1… (t39-design.md §11a A9). Asserting
  // "no .pyc on disk" would re-introduce the coupling this ticket removed — so assert what must hold instead.
  test("the tree hash is indifferent to bytecode: the walk over the REAL src/ yields no .pyc, whatever is on disk", () => {
    const { walk } = require("../../scripts/write-build-info.js");
    const files = walk(path.join(ROOT, "src"), []).map((f) => path.relative(ROOT, f));
    const pyc = files.filter((f) => /__pycache__|\.pyc$/.test(f));
    assert.deepStrictEqual(pyc, [], "the hashed file list carries no bytecode, present on disk or not");
    const onDisk = [];
    const scan = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) { if (e.name === "__pycache__") onDisk.push(path.relative(ROOT, q)); else scan(q); } else if (/\.pyc$/.test(e.name)) onDisk.push(path.relative(ROOT, q)); } };
    scan(path.join(ROOT, "src"));
    if (onDisk.length) console.log(`# U-HARNESS/T39 D7: ${onDisk.length} bytecode path(s) on disk and none hashed — ${onDisk.slice(0, 3).join(", ")}`);
  });
  // A repo fact, and the image is not the repo: `.gitignore` and `.git` are both `.dockerignore`d, so in the pod this
  // case asserts that pair is absent together (I-HEALTH's two-branch pattern) rather than reading a file that cannot
  // be there. `skip` is not available — run_pod_gates.sh fails the run on any skipped unit case.
  test("no .pyc is TRACKED by git under src/, and .gitignore keeps it out (in the repo; in the image, neither travels)", () => {
    const hasIgnore = fs.existsSync(path.join(ROOT, ".gitignore"));
    const hasGit = fs.existsSync(path.join(ROOT, ".git"));
    if (!hasIgnore) {
      assert.strictEqual(hasGit, false, ".gitignore and .git are dockerignored together — one without the other means the image changed shape");
      return;
    }
    assert.match(read(".gitignore"), /^__pycache__\/$/m);
    if (!hasGit) return;
    const tracked = require("child_process").execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => /__pycache__|\.pyc$/.test(f));
    assert.deepStrictEqual(tracked, [], "the tracked Mac .pyc left the tree with T39");
  });
});

describe("U-HARNESS/T39 D11: a chain starts from the image (chain_inputs.sh)", () => {
  test("the committed question set is the owner's file of 2026-09-18, byte for byte (md5 3779c763…)", () => {
    const f = path.join(ROOT, "tests/eval/baselines/dryrun-artifacts/test_questions.txt");
    assert.ok(fs.existsSync(f));
    assert.strictEqual(md5(fs.readFileSync(f)), "3779c76349d59b53d1b3426ef94ab79f");
  });
  test("the resolution order is env → /tmp copy → the image, and both arm-A records are committed", () => {
    const src = read("tests/eval/baselines/t39-artifacts/chain_inputs.sh");
    assert.match(src, /\/tmp\/dryrun\/test_questions\.txt/);
    assert.match(src, /tests\/eval\/baselines\/dryrun-artifacts\/test_questions\.txt/);
    assert.match(src, /tests\/eval\/baselines\/t32-artifacts\/before\/armA\/figq-A-1789407343-1\.json/);
    assert.match(src, /CHAIN REFUSED/);
    for (const n of [1, 2]) assert.ok(fs.existsSync(path.join(ROOT, `tests/eval/baselines/t32-artifacts/before/armA/figq-A-1789407343-${n}.json`)));
  });
  for (const rel of CHAIN_RUNNERS) {
    test(`${path.basename(rel)} sources chain_inputs.sh and demands no hand-copied input`, () => {
      const src = read(rel);
      assert.match(src, /^\. tests\/eval\/baselines\/t39-artifacts\/chain_inputs\.sh$/m);
      assert.ok(!/\$\{T15_QUESTIONS:\?/.test(src), "T15_QUESTIONS is resolved, not demanded");
      assert.ok(!/\$\{T32_ARM_A_RECORDS:\?/.test(src), "T32_ARM_A_RECORDS is resolved, not demanded");
      const cdAt = src.indexOf("\ncd /usr/src/app"), srcAt = src.indexOf("\n. tests/eval/baselines/t39-artifacts/chain_inputs.sh");
      assert.ok(cdAt >= 0 && cdAt < srcAt, "the cd precedes the relative source");
    });
  }
});

describe("U-HARNESS/T39 D12: every chain step's exit code is its command's, never a trailing grep's", () => {
  for (const rel of CHAIN_RUNNERS) {
    test(`${path.basename(rel)}: no step whose sh -c command ends in a grep / cut / tail / head pipeline`, () => {
      const lines = read(rel).split("\n").filter((l) => /^\s*step\s+\S+\s+sh -c "/.test(l));
      const offenders = [];
      for (const l of lines) {
        const cmd = l.slice(l.indexOf('sh -c "') + 7).replace(/"\s*$/, "");
        const segments = cmd.split(/;|&&|\|\|/).map((x) => x.trim()).filter(Boolean);
        const last = segments[segments.length - 1] || "";
        if (/^(grep|cut|tail|head)\b/.test(last) || /\|\s*(grep|cut|tail|head)\b[^|]*$/.test(last)) offenders.push(l.slice(0, 120));
      }
      assert.deepStrictEqual(offenders, [], "a step gated on a filter's exit committed and rolled a red suite once (T34)");
    });
  }
  test("the probes and follow-up steps capture each probe's rc and gate on both", () => {
    const src = read("tests/eval/baselines/t32-artifacts/run_t32_chain.sh");
    assert.match(src, /step probes .*rc1=\\\$\?.*rc2=\\\$\?.*\[ \\"\\\$rc1\\" = 0 \] && \[ \\"\\\$rc2\\" = 0 \]"/);
    assert.match(src, /step followup .*rc1=\\\$\?.*rc2=\\\$\?.*\[ \\"\\\$rc1\\" = 0 \] && \[ \\"\\\$rc2\\" = 0 \]"/);
  });
});

describe("U-HARNESS/T40 D12: the dry-run compare's two answer heuristics read the Q11 shapes correctly (F-157)", () => {
  const { facts, hasTable, declines, kind } = require("../eval/baselines/t37-artifacts/d4/compare_dryrun.js");
  const aligned = "The Denby design occupies 3 plots.\n\n| Plot | Design |\n|:-----------:|:------:|\n| 302 | Denby |\n| 304 | Denby |\n| 313 | Denby |\n";
  const plain = "| Plot | Design |\n|---|---|\n| 302 | Denby |";
  const conflict = "Plots 301 and 303 cannot be definitively assigned to one design or the other from the legend [S2].";
  const decline = "The document does not provide the number of plots for this design.";
  test("hasTable: a colon-aligned separator row is a table, as is the plain one; prose is not", () => {
    assert.strictEqual(hasTable(aligned), true);
    assert.strictEqual(hasTable(plain), true);
    assert.strictEqual(hasTable("Three plots: 302, 304 and 313."), false);
    assert.strictEqual(hasTable(null), false);
  });
  test("declines: T33's conflict disclosure is not a decline, nor is any sentence that cites a source; a plain refusal still is", () => {
    assert.strictEqual(declines(conflict), false);
    assert.strictEqual(declines("I cannot find this in the document [S1]."), false, "a cited sentence is an answer from a source");
    assert.strictEqual(declines(decline), true);
    assert.strictEqual(declines(`${aligned}\n${conflict}`), false);
    assert.strictEqual(declines(`${aligned}\n${conflict}\n${decline}`), true, "judged per sentence: the refusal elsewhere in the same answer still counts");
    assert.strictEqual(declines(""), false);
  });
  test("facts on the Q11 answer shape T39's clean chain produced: three plots, a table, no decline", () => {
    const f = facts({ answer: `${aligned}\n${conflict}` });
    assert.deepStrictEqual(f.denbyPlots, ["302", "304", "313"]);
    assert.strictEqual(f.hasTable, true);
    assert.strictEqual(f.declines, false);
    assert.strictEqual(f.designsNamed, 1);
    assert.deepStrictEqual(facts(null), { denbyPlots: [], designsNamed: 0, hasTable: false, declines: false, answerChars: 0 });
  });
  test("the script is importable without running, and the D4 kind classifier is unchanged", () => {
    assert.strictEqual(kind({ snippet: "[VISUAL DETAIL: x" }), "detail");
    assert.strictEqual(kind({ snippet: "[HUMAN-LOGICAL VISUAL ELEMENT: x" }), "caption");
    assert.strictEqual(kind({ snippet: "[Page 3] x" }), "text");
    const src = codeOnly(read("tests/eval/baselines/t37-artifacts/d4/compare_dryrun.js"));
    assert.match(src, /require\.main === module/);
  });
});
