/**
 * U-OCR — OCR for pages without a text layer, the pure parts (ticket T35; design
 * `inputs/rag-audit/t35-design.md` D2–D10, §4 (1)). Offline, no pod:
 *   - the JS half (`src/lib/ingestion/ocr.js`): the mode vocabulary the settings
 *     table and the fingerprint share, the normalisation, the bridge timeout
 *     rule (§2.2), the page list rendering, the chunk marker;
 *   - the Python half (`src/lib/ingestion/ocr_text.py`) through its own
 *     self-test (spawned): the trigger (D2), the thread pin from the two cgroup
 *     layouts (F-148), the engine params (D4), the reading order (the design
 *     probe's rule), the page-entry fields, the engine label; and the reading
 *     order on the probe's recorded fixture when one exists;
 *   - the two halves agree on OCR_SCALE and the modes (D5);
 *   - source pins: the bridge OCRs ONLY in the pypdfium2 branch, on its own
 *     render, never writes a file for it, reports the pass on every return
 *     path, takes `--ocr` and `--page-count`; the parser passes the mode, sizes
 *     the timeout, marks the chunks, declines the transcribe plan on an OCR'd
 *     page (D8) and fingerprints the key; the citation header says `Text: OCR`.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ocr = require("../../src/lib/ingestion/ocr.js");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PY_MODULE = path.join(REPO_ROOT, "src", "lib", "ingestion", "ocr_text.py");
const BRIDGE = path.join(REPO_ROOT, "src", "lib", "ingestion", "docling_bridge.py");
const PARSER = path.join(REPO_ROOT, "src", "lib", "ingestion", "parser.js");
const read = (p) => fs.readFileSync(p, "utf8");
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
const python = () => process.env.PYTHON_BIN || (fs.existsSync(path.join(REPO_ROOT, ".venv", "bin", "python")) ? path.join(REPO_ROOT, ".venv", "bin", "python") : "python3");
const py = (args) => spawnSync(python(), [PY_MODULE, ...args], { encoding: "utf8", timeout: 60000 });

describe("U-OCR: the JS half (ocr.js) — the vocabulary, the timeout rule, the list, the marker", () => {
  test("the modes are auto | off, the default auto; the normalisation accepts case and whitespace and nothing else", () => {
    assert.deepStrictEqual([...ocr.OCR_MODES], ["auto", "off"]);
    assert.ok(Object.isFrozen(ocr.OCR_MODES));
    assert.strictEqual(ocr.OCR_DEFAULT, "auto");
    assert.strictEqual(ocr.normaliseOcrMode(" OFF "), "off");
    assert.strictEqual(ocr.normaliseOcrMode("Auto"), "auto");
    for (const junk of ["all", "sometimes", "", null, undefined, 1, true, ["off"]]) assert.strictEqual(ocr.normaliseOcrMode(junk), "auto", `${JSON.stringify(junk)} → the default`);
  });

  test("the bridge timeout (§2.2): 300 s, plus 5 s a page when OCR may run; off keeps 300 s; an unknown page count keeps 300 s", () => {
    assert.strictEqual(ocr.BRIDGE_TIMEOUT_BASE_MS, 300000);
    assert.strictEqual(ocr.OCR_TIMEOUT_PER_PAGE_MS, 5000);
    assert.strictEqual(ocr.bridgeTimeoutMs("auto", 100), 800000, "a 100-page scan has 800 s");
    assert.strictEqual(ocr.bridgeTimeoutMs("auto", 2), 310000);
    assert.strictEqual(ocr.bridgeTimeoutMs("off", 100), 300000);
    for (const unknown of [0, -1, null, undefined, 2.5, "7"]) assert.strictEqual(ocr.bridgeTimeoutMs("auto", unknown), 300000, `${JSON.stringify(unknown)} pages: the base`);
  });

  test("the page list renders as the detail passes' does; the chunk marker and the page test", () => {
    assert.strictEqual(ocr.ocrPagesList([2, 1, 2, 0, -3, 1.5]), "1, 2");
    assert.strictEqual(ocr.ocrPagesList([]), "");
    assert.strictEqual(ocr.ocrPagesList(null), "");
    assert.strictEqual(ocr.TEXT_SOURCE_OCR, "ocr");
    assert.strictEqual(ocr.pageIsOcr({ page: 1, markdown: "x", ocr: true }), true);
    assert.strictEqual(ocr.pageIsOcr({ page: 1, markdown: "x" }), false);
    assert.strictEqual(ocr.pageIsOcr({ page: 1, ocr: false, ocrEmpty: true }), false);
    assert.strictEqual(ocr.pageIsOcr(undefined), false);
  });

  test("the module is pure: no require, no fs, no process (config.js is bundled into the page)", () => {
    const src = codeOnly(read(path.join(REPO_ROOT, "src", "lib", "ingestion", "ocr.js")));
    assert.ok(!/\brequire\(/.test(src), "no require");
    assert.ok(!/\bprocess\./.test(src) && !/\bfs\./.test(src), "no process, no fs");
  });
});

describe("U-OCR: the Python half (ocr_text.py) — its self-test, and the two halves agree", () => {
  test("the self-test passes: the trigger, the thread pin on cgroup v1 / v2 / unlimited / unreadable / capped, the params, the reading order, the page entry, the label", () => {
    const r = py(["--self-test"]);
    assert.strictEqual(r.status, 0, `self-test failed: ${(r.stdout || "").slice(0, 600)} ${(r.stderr || "").slice(0, 300)}`);
    const verdict = JSON.parse(r.stdout.trim().split("\n").pop());
    assert.strictEqual(verdict.ok, true, JSON.stringify(verdict.checks));
    for (const [name, ok] of Object.entries(verdict.checks)) assert.strictEqual(ok, true, `check ${name}`);
    assert.strictEqual(verdict.OCR_SCALE, ocr.OCR_SCALE, "D5: one render scale in both halves");
    assert.deepStrictEqual(verdict.OCR_MODES, [...ocr.OCR_MODES], "one vocabulary in both halves");
    assert.strictEqual(verdict.OCR_DEFAULT, ocr.OCR_DEFAULT);
    assert.strictEqual(verdict.DEFAULT_THREADS, 2, "F-148: the fallback pin is the container's quota here (2)");
  });

  test("the reading order on a recorded fixture reproduces the recorded lines (the design probe's rule; a synthetic fixture when the probe's raw boxes are not recorded)", () => {
    const fixture = path.join(REPO_ROOT, "tests", "eval", "baselines", "t35-artifacts", "probes", "records", "reading_order_fixture.json");
    const spec = fs.existsSync(fixture)
      ? JSON.parse(read(fixture))
      : { boxes: [[[10, 50], [90, 50], [90, 70], [10, 70]], [[120, 12], [200, 12], [200, 32], [120, 32]], [[10, 10], [100, 10], [100, 30], [10, 30]]], txts: ["Dining Room", "4628 x 4605mm", "Kitchen/Family"], scores: [0.9, 0.95, 0.99], expectedLines: ["Kitchen/Family 4628 x 4605mm", "Dining Room"] };
    const tmp = path.join(require("os").tmpdir(), `u-ocr-ro-${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(spec));
    try {
      const r = py(["--reading-order", tmp]);
      assert.strictEqual(r.status, 0, r.stderr);
      const lines = JSON.parse(r.stdout.trim());
      assert.deepStrictEqual(lines.map((l) => l.text), spec.expectedLines);
    } finally { fs.rmSync(tmp, { force: true }); }
  });
});

describe("U-OCR: source pins — the bridge, the parser, the header", () => {
  test("the bridge: OCR only in the pypdfium2 branch on an in-memory render at OCR_SCALE (no file), the engine constructed once and lazily with the thread pin, the pass reported on every return path, `--ocr` and `--page-count` parsed, docling's do_ocr still False", () => {
    const src = read(BRIDGE);
    assert.match(src, /sys\.dont_write_bytecode = True\s*\n\s*sys\.path\.insert\(0, os\.path\.dirname\(os\.path\.abspath\(__file__\)\)\)\s*\n\s*import ocr_text/, "no bytecode cache under src/ (F-153: the in-pod tree hash walks __pycache__)");
    assert.match(src, /def _ocr_engine\(\):/);
    assert.match(src, /RapidOCR\(params=ocr_text\.engine_params\(threads\)\)/, "the params carry the thread pin (F-148)");
    assert.match(src, /threads = ocr_text\.cpu_quota_threads\(\)/);
    assert.match(src, /img = page\.render\(scale=ocr_text\.OCR_SCALE\)\.to_pil\(\)\s*\n\s*out = eng\["engine"\]\(img\)/, "the render is handed to the engine in memory");
    assert.ok(!/ocr[_a-z]*\.png/.test(src), "no OCR render is written to the crop folder (every caption memo key stands)");
    assert.match(src, /if not ocr_text\.has_text_layer\(text\):\s*\n\s*ocr_stats\["noText"\] \+= 1/, "a page without a text layer is counted before the mode is consulted");
    assert.match(src, /if ocr_text\.page_needs_ocr\(text, ocr_mode\):/, "D2: the trigger is the page's own emptiness under auto");
    assert.strictEqual((src.match(/"ocr": finish_ocr_stats\(ocr_stats\)/g) || []).length, 3, "the pass is reported on the pypdfium2, docling and fallback return paths");
    assert.match(src, /pipeline_options\.do_ocr = False/, "docling's own OCR pipeline stays off (D13)");
    assert.match(src, /if "--page-count" in argv:/);
    assert.match(src, /if "--ocr" in argv:/);
    assert.match(src, /def convert_document_to_markdown_pages\(doc_path, output_dir=None, no_images=False, ocr_mode="auto"\):/);
    assert.match(src, /ocr_mode = ocr_text\.normalise_mode\(ocr_mode\)/);
    // A failed pass never fails the file: the page keeps its (empty) text and is counted and named.
    assert.match(src, /stats\["failed"\] \+= 1\s*\n\s*stats\["failedPages"\]\.append\(page_no\)/);
  });

  test("the parser: the mode reaches the bridge, the timeout follows the page count, the OCR'd page's chunks are marked, the transcribe plan is declined on it, the trace carries the pass, the key is fingerprinted", () => {
    const src = read(PARSER);
    assert.match(src, /const \{ normaliseOcrMode, bridgeTimeoutMs, TEXT_SOURCE_OCR, ocrPagesList, pageIsOcr \} = require\('\.\/ocr'\);/);
    assert.match(src, /const ocrMode = normaliseOcrMode\(this\.config\?\.ocrNoTextPages\);/);
    assert.match(src, /--page-count/, "the page count is read cheaply before the parse");
    assert.match(src, /--ocr \$\{ocrMode\}/, "the mode rides to the bridge");
    assert.match(src, /--no-images/, "T24's switch is intact");
    assert.match(src, /timeout: bridgeTimeoutMs\(ocrMode, pageCountForTimeout\)/);
    assert.match(src, /if \(pageIsOcr\(pItem\)\) meta\.textSource = TEXT_SOURCE_OCR;/, "D6: the chunks of an OCR'd page are marked");
    assert.match(src, /detailPlanFor\(\{ caption: pic\.caption, visualType, mode: detailMode, ocr: pageOcr \}\)/, "D8: the plan knows the page was OCR'd");
    assert.match(src, /ocrNoTextPages: this\.config\?\.ocrNoTextPages/, "D9: the key reaches the fingerprint (U-PARSE walks the list)");
    for (const field of ["ocrMode", "ocrNoText", "ocrPages", "ocrEmpty", "ocrFailed", "ocrChars", "ocrDurationMs", "ocrNoTextPages", "ocrPagesList", "ocrEmptyPages", "ocrFailedPages", "ocrEngine", "ocrThreads", "ocrError", "detailNotTakenOcr", "detailNotTakenOcrPages"]) assert.match(src, new RegExp(`\\b${field}:`), `the trace carries ${field}`);
    assert.match(src, /console\.log\(`\[OCR\] \$\{this\.fileName\}: \$\{ocr\.noText\} page\(s\) without a text layer/, "the container log names the pass (D10)");
  });

  test("the detail module declines the transcribe plan on an OCR'd page and the header says `Text: OCR` (the rules live where the design puts them)", () => {
    const dp = read(path.join(REPO_ROOT, "src", "lib", "ingestion", "detail_pass.js"));
    assert.match(dp, /if \(ocr === true && kind === "transcribe"\) return null;/);
    const cit = read(path.join(REPO_ROOT, "src", "lib", "rag", "citations.js"));
    assert.match(cit, /if \(meta\.textSource === "ocr"\) parts\.push\("Text: OCR"\);/);
    const ids = require("../../src/lib/rag/ids.js");
    assert.ok(ids.FINGERPRINT_KEYS.includes("ocrNoTextPages"));
    const config = require("../../src/lib/rag/config.js");
    assert.strictEqual(config.OCR_MODES, ocr.OCR_MODES);
  });

  test("the VLM span sums the OCR pass and names it (D10): the pages without a text layer per document, the pages read with the characters, read empty, failed, the engine; nothing on a pre-T35 record", () => {
    const engines = require("../../src/lib/ingestion/engines.js");
    const src = read(path.join(REPO_ROOT, "src", "lib", "ingestion", "engines.js"));
    for (const k of ["ocrNoText", "ocrPages", "ocrEmpty", "ocrFailed", "ocrChars"]) assert.match(src, new RegExp(`${k}: sum\\("${k}"\\),`), `the span sums ${k}`);
    assert.strictEqual((src.match(/ocrPassWording\(outcomes\)/g) || []).length, 4, "the definition and the three descriptions (observed, recorded, no captions)");
    assert.strictEqual(engines.ocrPassWording({ ocrNoText: 0 }), "");
    assert.strictEqual(engines.ocrPassWording({}), "", "a pre-T35 record: nothing new");
    const s = engines.ocrPassWording({ ocrNoText: 3, ocrPages: 2, ocrEmpty: 1, ocrFailed: 0, ocrChars: 1787, ocrPageLists: [{ fileName: "Barratt_Homes-SaxonFields.pdf", mode: "auto", noText: 2, pages: 2, pagesList: "1, 2", noTextPages: "1, 2", engine: "rapidocr 3.9.2 / onnxruntime 1.30.0 / models x" }, { fileName: "Miele.pdf", mode: "auto", noText: 1, pages: 0, pagesList: "", noTextPages: "122", engine: "rapidocr 3.9.2 / onnxruntime 1.30.0 / models x" }] });
    assert.strictEqual(s, " OCR (pages without a text layer): 3 page(s) — Barratt_Homes-SaxonFields.pdf p1, p2; Miele.pdf p122; 2 read (1787 characters), 1 read empty, 0 failed; engine rapidocr 3.9.2 / onnxruntime 1.30.0 / models x.");
    assert.match(engines.ocrPassWording({ ocrNoText: 2, ocrPages: 0, ocrEmpty: 0, ocrFailed: 0, ocrChars: 0, ocrPageLists: [{ fileName: "b.pdf", mode: "off", noText: 2, pages: 0, pagesList: "", noTextPages: "1, 2", engine: null }] }), /b\.pdf p1, p2 \(OCR off\); 0 read \(0 characters\)/, "under off the sentence says so");
  });

  test("the image's pins: requirements.txt names onnxruntime 1.30.0 and constraints.txt holds it with its two dependencies (D4; F-127)", () => {
    const req = read(path.join(REPO_ROOT, "requirements.txt"));
    assert.match(req, /^onnxruntime==1\.30\.0$/m);
    const cons = read(path.join(REPO_ROOT, "constraints.txt"));
    for (const pin of ["onnxruntime==1.30.0", "protobuf==7.36.2", "flatbuffers==25.12.19", "rapidocr==3.9.2"]) assert.ok(cons.split("\n").includes(pin), `constraints.txt pins ${pin}`);
  });
});
