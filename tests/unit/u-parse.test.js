/**
 * U-PARSE — per-format parse contract (evaluation-plan §2).
 *
 * Scope boundary
 * --------------
 * This suite must stay offline and fast. `DocumentParser.chunk()` on a PDF or
 * Office file spawns the Python bridge, which renders EVERY page to PNG under
 * public/extracted_images and then attempts VLM captioning over the network
 * (src/lib/ingestion/parser.js:246-295). For the 124-page Miele manual that is
 * minutes of work and hundreds of megabytes, so it cannot run per-change.
 *
 * The split is therefore:
 *   - text formats (txt / md / csv)  -> full chunk() contract here
 *   - PDFs                           -> text-layer + page-attribution contract
 *                                       here via the production extractPages()
 *                                       (pdf-parse, pure Node, no subprocess);
 *                                       the bridge path is asserted in the
 *                                       integration suite
 *   - docx / pptx / xlsx             -> the routing to the bridge path is asserted
 *                                       here (T39 D9); the parse itself in the
 *                                       integration suite (I-INGEST, I-SECTION)
 *
 * Expected failures are marked `todo` with their audit evidence ID and the
 * ticket that OWNS them today, so the run stays green while recording the
 * defect. The owning ticket flips the marker. T39 (F-156) audited the eight
 * markers: a marker states something true about who owns it, or it goes.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  loadManifest,
  corpusEntries,
  generatedExpectation,
  absPath,
  readFixture,
  pdfEntriesUnderTest,
  chunkContractViolations,
} = require("./_helpers");

const { getParserForFile, extractPages, recursiveSplit, pageHasTextLayer, normaliseVisualType } = require("../../src/lib/ingestion/parser.js");

describe("U-PARSE: manifest integrity", () => {
  test("golden manifest loads and describes the real corpus", () => {
    const manifest = loadManifest();
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.corpusRoot, "public/demos/demo_files/ext_reg_docs");
    assert.ok(corpusEntries().length >= 10, "expected at least 10 usable corpus documents");
  });

  test("every corpus document referenced by the manifest exists on disk", () => {
    for (const entry of corpusEntries()) {
      assert.ok(
        require("fs").existsSync(absPath(entry.sourceId)),
        `missing corpus file: ${entry.sourceId}`
      );
    }
  });

  test("PDF ground truth was confirmed by both production extractors", () => {
    // Anchors only reach the manifest when pypdfium2 and pdf-parse agree, which
    // is what keeps these tests from being circular. If an anchor ever lands
    // unconfirmed, the ground truth is single-engine and must not be trusted.
    for (const entry of corpusEntries().filter((e) => e.fileType === "pdf")) {
      for (const anchor of entry.anchors || []) {
        assert.equal(
          anchor.confirmedByBothEngines,
          true,
          `${entry.fileName}: anchor "${anchor.token}" was not cross-confirmed`
        );
      }
    }
  });
});

describe("U-PARSE: PDF text layer and page attribution", () => {
  for (const entry of pdfEntriesUnderTest()) {
    const label = entry.fileName;

    test(`${label}: page count matches manifest ground truth`, async () => {
      const pages = await extractPages(readFixture(entry.sourceId));
      assert.equal(
        pages.length,
        entry.pageCount,
        `expected ${entry.pageCount} pages, extractor returned ${pages.length}`
      );
    });

    if (entry.hasTextLayer) {
      test(`${label}: anchors appear on their attributed pages`, async () => {
        const pages = await extractPages(readFixture(entry.sourceId));
        const byNumber = new Map(pages.map((p) => [p.pageNumber, p.text || ""]));

        assert.ok((entry.anchors || []).length > 0, "manifest supplied no anchors");
        for (const anchor of entry.anchors) {
          const text = byNumber.get(anchor.page);
          assert.ok(text !== undefined, `page ${anchor.page} absent from extraction`);
          assert.ok(
            text.includes(anchor.token),
            `anchor "${anchor.token}" not found on page ${anchor.page} of ${label}`
          );
        }
      });

      test(`${label}: per-page chunking preserves anchors and respects size bounds`, async () => {
        const pages = await extractPages(readFixture(entry.sourceId));
        const chunkSize = 800;

        for (const anchor of entry.anchors) {
          const page = pages.find((p) => p.pageNumber === anchor.page);
          const pieces = recursiveSplit(page.text || "", chunkSize, 100);

          for (const piece of pieces) {
            assert.ok(
              piece.length <= 2 * chunkSize,
              `${label} p${anchor.page}: piece of ${piece.length} chars exceeds 2x chunkSize`
            );
          }
          assert.ok(
            pieces.some((piece) => piece.includes(anchor.token)),
            `anchor "${anchor.token}" was lost by chunking on page ${anchor.page} of ${label}`
          );
        }
      });
    } else {
      test(`${label}: image-only document is detectable, not silently empty`, async () => {
        // Barratt_Homes-SaxonFields.pdf has no text layer at all. The parse
        // stage must be able to distinguish "no text in this document" from
        // "extraction succeeded", otherwise an image-only file looks identical
        // to a successfully ingested one (audit FM-L2 / E16).
        const pages = await extractPages(readFixture(entry.sourceId));
        const totalChars = pages.reduce((sum, p) => sum + (p.text || "").length, 0);
        assert.equal(pages.length, entry.pageCount);
        assert.ok(
          totalChars <= 20 * entry.pageCount,
          `expected no meaningful text layer, extracted ${totalChars} chars`
        );
      });
    }
  }
});

describe("U-PARSE: DocumentParser retains its source buffer (audit E01 regression)", () => {
  // The constructor normalises `buffer` to hash it but historically discarded the
  // result, so chunk() read an undefined this.buffer and threw TypeError on every
  // text, Office and PDF-fallback path — failing the whole ingestion batch.
  // Ticket T01 assigns it. These tests pin the invariant directly, independently
  // of any one format's chunking behaviour.

  test("a Buffer input is retained as a Buffer", () => {
    const sourceId = "tests/fixtures/golden/text_basic.txt";
    const parser = getParserForFile(sourceId, readFixture(sourceId), {}, absPath(sourceId));
    assert.ok(Buffer.isBuffer(parser.buffer), "parser.buffer must be a Buffer");
    assert.ok(parser.buffer.length > 0, "parser.buffer must not be empty");
  });

  test("the retained buffer is the same content that produced docHash", () => {
    const sourceId = "tests/fixtures/golden/text_basic.txt";
    const raw = readFixture(sourceId);
    const parser = getParserForFile(sourceId, raw, {}, absPath(sourceId));

    const expected = require("crypto").createHash("md5").update(parser.buffer).digest("hex");
    assert.equal(
      parser.docHash,
      expected,
      "docHash must be derived from the same bytes that chunk() will read"
    );
    assert.equal(parser.buffer.compare(raw), 0, "retained buffer must equal the input bytes");
  });

  test("a string input is normalised to a Buffer rather than left as a string", () => {
    // extractOfficeText calls fileBuffer.toString('utf-8'); a raw string would
    // survive that call but behave differently downstream, so normalisation
    // must happen in the constructor.
    const parser = getParserForFile("note.txt", "plain string content", {}, "note.txt");
    assert.ok(Buffer.isBuffer(parser.buffer));
    assert.equal(parser.buffer.toString("utf-8"), "plain string content");
  });
});

describe("U-PARSE/T17 (design D11, F-85): the parser receives the VLM trio through its config", () => {
  // The ingest route merges the request's top-level vlmModelName /
  // vlmEndpointUrl / vlmApiKey into the config it hands getParserForFile;
  // before T17 the admin panel's fields never reached this point and every
  // ingest captioned with the parser's own defaults.
  test("the three fields land on parser.config, and vlmModelName is in the document's version fingerprint (T05)", () => {
    const { fingerprintFor } = require("../../src/lib/rag/ids");
    const sourceId = "tests/fixtures/golden/text_basic.txt";
    const cfg = { chunkSize: 600, chunkOverlap: 80, minChunkSize: 150, vlmModelName: "some-vlm:1b", vlmEndpointUrl: "http://ollama.ollama.svc.cluster.local:11434/v1/", vlmApiKey: "k" };
    const parser = getParserForFile(sourceId, readFixture(sourceId), cfg, absPath(sourceId));
    assert.strictEqual(parser.config.vlmModelName, "some-vlm:1b");
    assert.strictEqual(parser.config.vlmEndpointUrl, "http://ollama.ollama.svc.cluster.local:11434/v1/");
    assert.strictEqual(parser.config.vlmApiKey, "k");
    // T37: the default is vlm_captioner.js's DEFAULT_CAPTION_MODEL (the chat model); the pre-T37 default was the VLM — both are "another model" here.
    const { DEFAULT_CAPTION_MODEL } = require("../../src/lib/ingestion/vlm_captioner");
    const withDefault = getParserForFile(sourceId, readFixture(sourceId), { ...cfg, vlmModelName: DEFAULT_CAPTION_MODEL }, absPath(sourceId));
    assert.notStrictEqual(parser.docVersion, withDefault.docVersion, "a changed captioner is a new document version");
    assert.notStrictEqual(fingerprintFor(cfg), fingerprintFor({ ...cfg, vlmModelName: DEFAULT_CAPTION_MODEL }));
    assert.notStrictEqual(fingerprintFor(cfg), fingerprintFor({ ...cfg, vlmModelName: "qwen3-vl:30b" }));
  });

  test("the ingest route merges the trio top-level over the blob and translates the endpoint (source pin)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "ingest", "route.js"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(src, /const config = \{ \.\.\.\(ragSettings \|\| \{\}\), \.\.\.vlmOverrides \}/);
    assert.match(src, /vlmOverrides\.vlmEndpointUrl = translateToInternalUrl\(body\.vlmEndpointUrl\)\.url/);
    assert.match(src, /vlmOverrides\.vlmModelName = body\.vlmModelName\.trim\(\)/);
    assert.match(src, /getParserForFile\(filePath, buffer, config, resolved\)/);
  });
});

describe("U-PARSE/T37 (t37-design D1, D2): a request naming NO captioner follows vlm_captioner.js's DEFAULT_CAPTION_MODEL — both server-side fallbacks, one constant", () => {
  const { DEFAULT_CAPTION_MODEL } = require("../../src/lib/ingestion/vlm_captioner");
  const parserSrc = () => fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "parser.js"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("a config without vlmModelName fingerprints as the constant: the same docVersion as naming it, a different one from naming the VLM (the pre-T37 default)", () => {
    const { fingerprintFor } = require("../../src/lib/rag/ids");
    const sourceId = "tests/fixtures/golden/text_basic.txt";
    const base = { chunkSize: 600, chunkOverlap: 80, minChunkSize: 150 };
    const none = getParserForFile(sourceId, readFixture(sourceId), base, absPath(sourceId));
    const named = getParserForFile(sourceId, readFixture(sourceId), { ...base, vlmModelName: DEFAULT_CAPTION_MODEL }, absPath(sourceId));
    const vl = getParserForFile(sourceId, readFixture(sourceId), { ...base, vlmModelName: "qwen3-vl:30b" }, absPath(sourceId));
    assert.strictEqual(none.docVersion, named.docVersion, "no captioner named = the default named: the page and an API caller stamp ONE version for one shape");
    assert.notStrictEqual(none.docVersion, vl.docVersion, "the VLM by name is another version");
    assert.strictEqual(none.docVersion.split(".")[1], fingerprintFor({ ...base, vlmModelName: DEFAULT_CAPTION_MODEL }), "the parser's fingerprint input is ids.js's, with the constant filled in");
    assert.strictEqual(none.docVersion.split(".")[1], "a5d02a609ad9", "the page-shape production fingerprint under the pick and IDENTITY_VERSION 14 (U-IDS pins the same number; 94195d3aa6bb was v13's, 0c708178f137 v12's, 0008a8c2d1f3 v11's, 852f45f6ef65 v10's, 864cbc8489ad v9's, bfd9e449b930 v8's, 384ec4e0e1c3 v7's, be2a00d66f36 v6's, dd257f24f95c v5's, 42bb5ef65e46 v4's, 9087fdb24b59 v2's, 42ca5ed33c98 the VLM's under v2)");
    // The route trims a name and drops an empty one; null / undefined / "" all mean "no captioner".
    for (const empty of ["", null, undefined]) {
      assert.strictEqual(getParserForFile(sourceId, readFixture(sourceId), { ...base, vlmModelName: empty }, absPath(sourceId)).docVersion, none.docVersion, `vlmModelName ${JSON.stringify(empty)} is no captioner`);
    }
  });

  test("both fallbacks read the constant through ONE top-level require; no model literal remains in the parser (source pin — the captioning branch needs the bridge, so the recorded vlmModel is measured live by I-INGEST and the chain's identity leg)", () => {
    const src = parserSrc();
    assert.match(src, /const \{ DEFAULT_CAPTION_MODEL \} = require\(['"]\.\/vlm_captioner['"]\);/, "one top-level require of the constant");
    assert.strictEqual((src.match(/this\.config\?\.vlmModelName \|\| DEFAULT_CAPTION_MODEL/g) || []).length, 2, "the fingerprint input AND the model asked / recorded");
    assert.match(src, /vlmModelName: this\.config\?\.vlmModelName \|\| DEFAULT_CAPTION_MODEL,/, "the fingerprint input");
    assert.match(src, /const vlmModelUsed = this\.config\?\.vlmModelName \|\| DEFAULT_CAPTION_MODEL;/, "the model asked and recorded as vlmModel");
    assert.ok(!/qwen3-vl:30b/.test(src), "no VLM literal");
    assert.ok(!/qwen3\.8:27b/.test(src), "and no chat-model literal either: the value lives in vlm_captioner.js only");
  });
});

describe("U-PARSE/T24: the captioning switch, the sequential reset-first loop and the fingerprint (t24-design D2, D3, D6, D7, D8)", () => {
  const parserSrc = () => fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "parser.js"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("captionFigures reaches parser.config; false is a different docVersion, true or absent the pre-T24 one (D8)", () => {
    const { fingerprintFor } = require("../../src/lib/rag/ids");
    const sourceId = "tests/fixtures/golden/text_basic.txt";
    const cfg = { chunkSize: 600, chunkOverlap: 80, minChunkSize: 150, vlmModelName: "qwen3-vl:30b" };
    const plain = getParserForFile(sourceId, readFixture(sourceId), cfg, absPath(sourceId));
    const on = getParserForFile(sourceId, readFixture(sourceId), { ...cfg, captionFigures: true }, absPath(sourceId));
    const off = getParserForFile(sourceId, readFixture(sourceId), { ...cfg, captionFigures: false }, absPath(sourceId));
    assert.strictEqual(off.config.captionFigures, false);
    assert.strictEqual(plain.docVersion, on.docVersion, "on is the default: no version moves");
    assert.notStrictEqual(off.docVersion, plain.docVersion, "off emits no visual chunk: a new version");
    assert.strictEqual(plain.docVersion.split(".")[1], fingerprintFor(cfg), "the parser's fingerprint input is ids.js's");
    assert.strictEqual(off.docVersion.split(".")[1], fingerprintFor({ ...cfg, captionFigures: false }));
  });

  test("T31 (A7): EVERY key of ids.FINGERPRINT_KEYS reaches the parser's docVersion input — a key added to ids.js but not to the parser's object is silently inert (the defect I-CAPTION 4 caught)", () => {
    const ids = require("../../src/lib/rag/ids");
    const sourceId = "tests/fixtures/golden/text_basic.txt";
    const base = { chunkSize: 600, chunkOverlap: 80, minChunkSize: 150, vlmModelName: "qwen3-vl:30b" };
    const plain = getParserForFile(sourceId, readFixture(sourceId), base, absPath(sourceId));
    // A non-default value per fingerprinted key. A key with no entry here is a
    // key this pin cannot check — the assertion below says so rather than passing.
    const NON_DEFAULT = { chunkSize: 900, chunkOverlap: 100, minChunkSize: 200, vlmModelName: "other-model", captionFigures: false, captionPageBudget: 25, detailPasses: "all", ocrNoTextPages: "off" };
    for (const key of ids.FINGERPRINT_KEYS) {
      assert.ok(key in NON_DEFAULT, `FINGERPRINT_KEYS gained ${key}: give this pin a non-default value for it`);
      const changed = getParserForFile(sourceId, readFixture(sourceId), { ...base, [key]: NON_DEFAULT[key] }, absPath(sourceId));
      assert.notStrictEqual(changed.docVersion, plain.docVersion, `${key} is fingerprinted by ids.js but does not reach the parser's docVersion input`);
    }
    // And the default-omission rule holds through the parser: a zero / absent /
    // unreadable budget is the pre-T31 version of the same bytes.
    for (const none of [0, undefined, -1, 2.5, "all"]) {
      const p = getParserForFile(sourceId, readFixture(sourceId), { ...base, captionPageBudget: none }, absPath(sourceId));
      assert.strictEqual(p.docVersion, plain.docVersion, `captionPageBudget ${JSON.stringify(none)} is the default: no version moves`);
    }
  });

  test("the bridge is called with --no-images when captioning is off, and the captioner is never required (source pin)", () => {
    const src = parserSrc();
    assert.match(src, /const captionFigures = this\.config\?\.captionFigures !== false;/);
    // T35 (design D3): the OCR mode rides after T24's switch — `--ocr auto | off` on every bridge call.
    assert.match(src, /const bridgeArgs = `\$\{captionFigures \? `"\$\{imgDir\}"` : `"\$\{imgDir\}" --no-images`\} --ocr \$\{ocrMode\}`;/);
    assert.match(src, /if \(captionFigures && Array\.isArray\(parsed\.pictures\) && parsed\.pictures\.length > 0\) \{\s*const \{ captionFigure, resetCaptionServer, CAPTION_FAILURE_OUTCOMES \} = require\("\.\/vlm_captioner"\);/);
    assert.match(src, /captioning: captionFigures \? "on" : "off",/);
    const bridge = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "docling_bridge.py"), "utf-8");
    assert.match(bridge, /no_images = "--no-images" in sys\.argv\[1:\]/);
    assert.match(bridge, /if no_images:\s*output_dir = None/, "no render, no folder");
    assert.match(bridge, /pipeline_options\.generate_picture_images = not no_images/);
  });

  test("captions run one at a time, in page order, after ONE server reset per document; every outcome is tallied (D2, D3, D5)", () => {
    const src = parserSrc();
    // T29 (design D3): the reset is sent only when a crop must be asked; a document recalled whole has none.
    // T33 (design D8): the ONE reset site lives in a once-per-document closure the caption loop and the detail passes share.
    const loop = src.slice(src.indexOf("const reset = memoMisses > 0 ? await resetOnce() : null;"), src.indexOf("const detail = { mode: detailMode,"));
    assert.ok(loop.length > 0);
    assert.strictEqual((src.match(/await resetCaptionServer\(/g) || []).length, 1, "one reset call site — inside resetOnce");
    assert.match(src, /const resetOnce = async \(\) => \{\s*if \(resetSent\) return resetSent;\s*resetSent = await resetCaptionServer\(\{ \.\.\.vlmOptions, label: this\.fileName \}\);\s*return resetSent;\s*\};/, "the closure sends the reset once and returns the same result afterwards");
    assert.match(loop, /captionReset = reset \? \(reset\.ok \? reset\.unloaded : false\) : null;/, "A10: the trace says whether the unload was SEEN; T29: null when no reset was needed");
    assert.match(loop, /if \(vlmFirstLoadMs === null && Number\.isFinite\(result\.loadMs\)\) vlmFirstLoadMs = result\.loadMs;/, "A10: the first caption's reload is recorded");
    assert.match(loop, /for \(const pic of targetPics\) \{\s*const result = await captionFigure\(pic\.abs_path/, "sequential: awaited inside a for-of, in the bridge's page order");
    assert.ok(!/Promise\.all\(batch\.map/.test(src), "the pre-T24 batch of three is gone");
    assert.ok(!/const batchSize = 3;/.test(src));
    for (const o of ["decorative", "textOnly", "empty", "truncated", "tiny"]) assert.match(loop, new RegExp(`result\\.outcome === "${o}"\\) vlmCounts\\.${o}\\+\\+`));
    assert.match(loop, /result\.outcome === "timeout"\) vlmCounts\.timedOut\+\+/);
    assert.match(loop, /CAPTION_FAILURE_OUTCOMES\.includes\(result\.outcome\)\) vlmCounts\.failed\+\+/);
    assert.match(loop, /label: `\$\{this\.fileName\} p\$\{pic\.page\} \(\$\{pic\.id\}\)`/, "the log label names the document and the page (F-119)");
    const trace = src.slice(src.indexOf("picturesCaptured: (parsed.pictures || []).length,"), src.indexOf("markdownSample: (doclingPages[0]"));
    for (const k of ["captionResetWaitMs,", "vlmFirstLoadMs,", "vlmDecorative: vlmCounts.decorative", "vlmTextOnly: vlmCounts.textOnly", "vlmTypeUnlisted: 0,", "captionPrompts,", "vlmEmpty: vlmCounts.empty", "vlmTruncated: vlmCounts.truncated", "vlmTiny: vlmCounts.tiny", "vlmTimedOut: vlmCounts.timedOut", "vlmFailed: vlmCounts.failed", "vlmNotAttempted: vlmCounts.notAttempted", "captionReset,"]) {
      assert.ok(trace.includes(k), `the trace records ${k}`);
    }
  });

  test("T29: the caption memo is consulted for every crop BEFORE the server is touched; the reset only on a miss; the memo's share, the calls and the server identity are on the trace (t29-design D1, D3, D7)", () => {
    const src = parserSrc();
    const block = src.slice(src.indexOf('const { openCaptionMemo } = require("./caption_memo");'), src.indexOf("vlmDurationMs = Date.now() - vlmStart;"));
    assert.ok(block.length > 0, "the memo is opened inside the captioning branch");
    assert.match(block, /const identity = await resolveCaptionServer\(\{ \.\.\.vlmOptions, label: this\.fileName \}\);/, "the server's identity (digest, origin) is read once per document");
    assert.match(block, /const memoIdentity = identity\.ok && identity\.modelDigest \? \{ server: identity\.server, modelDigest: identity\.modelDigest \} : null;/, "no digest, no memo (bypassed, never a weaker key)");
    assert.ok(block.indexOf("memo.has(k.key)") < block.indexOf("await resetCaptionServer("), "every crop is looked up before the reset");
    assert.match(block, /if \(!bytes \|\| bytes\.length < CAPTION_MIN_BYTES\) continue;/, "a tiny or missing crop needs no server and forces no reset");
    assert.match(block, /captionMemo = !memoIdentity \? "unavailable" : memoMisses === 0 \? "all" : memoHits > 0 \? "partial" : "none";/);
    assert.match(block, /const reset = memoMisses > 0 \? await resetOnce\(\) : null;/, "D3: reset only when a crop must be asked (T33: through the once-per-document closure)");
    assert.match(block, /await captionFigure\(pic\.abs_path, \{ \.\.\.vlmOptions, label: `\$\{this\.fileName\} p\$\{pic\.page\} \(\$\{pic\.id\}\)`, memo, memoIdentity, memoKey: memoKeys\.get\(pic\.id\) \|\| null/, "the memo and the identity travel with every caption call");
    // T32 (design D2): the page's text-layer status picks the prompt variant — on the pre-pass key AND on the caption call, from ONE rule.
    assert.match(block, /const textLayerOf = \(pic\) => pageHasTextLayer\(doclingPages, pic\.page\);/, "one rule for the variant");
    assert.match(block, /captionMemoKey\(bytes, \{ modelName: vlmModelUsed, memoIdentity, hasTextLayer: textLayerOf\(pic\) \}\)/, "the pre-pass forms the key with the variant");
    assert.match(block, /hint: \{ \.\.\.hintBase, page: pic\.page, figureId: pic\.id \}, hasTextLayer: textLayerOf\(pic\) \}\);/, "the caption call carries the variant");
    assert.match(block, /captionPrompts = \{ withText: CAPTION_PROMPT_MD5\.withText\.slice\(0, 8\), noText: CAPTION_PROMPT_MD5\.noText\.slice\(0, 8\) \};/, "the trace names the variants used");
    for (const k of ['if (result.source === "memo") vlmCounts.fromMemo++;', "if (result.requested) vlmCounts.calls++;", "if (result.memoised) vlmCounts.memoised++;", "if (result.memoError) vlmCounts.memoWriteFailed++;"]) assert.ok(block.includes(k), `the loop tallies ${k}`);
    const trace = src.slice(src.indexOf("picturesCaptured: (parsed.pictures || []).length,"), src.indexOf("markdownSample: (doclingPages[0]"));
    for (const k of ["vlmFromMemo: vlmCounts.fromMemo", "vlmCalls: vlmCounts.calls", "vlmMemoised: vlmCounts.memoised", "vlmMemoWriteFailed: vlmCounts.memoWriteFailed", "captionMemo,", "vlmModelDigest,", "vlmServer,"]) assert.ok(trace.includes(k), `the trace records ${k}`);
    assert.ok(!/this\.config\?\.(captionMemo|memo)/.test(src), "the memo is not a setting (D5): nothing about it is read off the blob");
  });
});

describe("U-PARSE: text formats through the full chunk() contract", () => {
  // Ticket T01 assigned this.buffer, so these paths now execute instead of
  // throwing TypeError (audit E01). Cases that still fail do so for a different,
  // named reason and keep a todo pointing at their owning ticket.
  const cases = [
    { sourceId: "tests/fixtures/golden/text_basic.txt", chunkSize: 800 },
    { sourceId: "tests/fixtures/golden/md_headings.md", chunkSize: 800 },
    { sourceId: "tests/fixtures/golden/csv_table.csv", chunkSize: 800 },
    // T41 (design D3; T19): an oversize paragraph is split by recursiveSplit — the 6,449-character paragraph reads
    // eleven chunks, the longest 664 at an 800 budget (t41-design.md §0c); the marker T39 left here is gone.
    { sourceId: "tests/fixtures/golden/md_longpara.md", chunkSize: 800 },
  ];

  for (const { sourceId, chunkSize, todo } of cases) {
    const expectation = generatedExpectation(sourceId);
    const name = sourceId.split("/").pop();

    test(
      `${name}: chunk() satisfies the per-chunk contract`,
      todo ? { todo } : {},
      async () => {
        const parser = getParserForFile(
          sourceId,
          readFixture(sourceId),
          { chunkSize, chunkOverlap: 100 },
          absPath(sourceId)
        );
        const chunks = await parser.chunk();

        assert.ok(
          chunks.length >= expectation.expectedMinChunks,
          `expected >= ${expectation.expectedMinChunks} chunks, got ${chunks.length}`
        );

        const violations = [];
        chunks.forEach((chunk, i) => {
          violations.push(...chunkContractViolations(chunk, i, { chunkSize }));
        });
        assert.deepEqual(violations, [], violations.join("\n"));
      }
    );
  }

  // Anchor presence is content fidelity, asserted separately from chunk shape so
  // the two are independently attributable. md_headings.md is deliberately
  // excluded here: its only manifest anchor is the heading-only token, which has
  // its own dedicated test below against audit E10 / ticket T19.
  const anchorCases = cases.filter(
    (c) => !generatedExpectation(c.sourceId).headingOnlyToken
  );

  for (const { sourceId, chunkSize, anchorTodo } of anchorCases) {
    const expectation = generatedExpectation(sourceId);
    const name = sourceId.split("/").pop();

    // T39 (F-156): anchor presence has its own marker field (`anchorTodo`, none
    // today) — md_longpara's oversize chunk still CONTAINS its anchors, so this
    // case is green and says so.
    test(`${name}: manifest anchors survive chunking`, anchorTodo ? { todo: anchorTodo } : {}, async () => {
      const parser = getParserForFile(
        sourceId,
        readFixture(sourceId),
        { chunkSize, chunkOverlap: 100 },
        absPath(sourceId)
      );
      const chunks = await parser.chunk();

      assert.ok((expectation.anchors || []).length > 0, "manifest supplied no anchors");
      for (const anchor of expectation.anchors) {
        assert.ok(
          chunks.some((c) => c.text.includes(anchor.token)),
          `anchor "${anchor.token}" absent from all chunks of ${name}`
        );
      }
    });
  }

  // T41 (design D3; T19; audit E10): a heading opens the paragraph that follows it, so a term that lives only in a
  // heading is in the body of the chunk it introduces — measured green (t41-design.md §0c); the marker is gone.
  test(
    "md_headings.md: heading-only term survives into chunk text",
    async () => {
      const sourceId = "tests/fixtures/golden/md_headings.md";
      const expectation = generatedExpectation(sourceId);
      const parser = getParserForFile(
        sourceId,
        readFixture(sourceId),
        { chunkSize: 800, chunkOverlap: 100 },
        absPath(sourceId)
      );
      const chunks = await parser.chunk();
      assert.ok(
        chunks.some((c) => c.text.includes(expectation.headingOnlyToken)),
        `heading-only token "${expectation.headingOnlyToken}" must appear in chunk text, ` +
          "not only in metadata"
      );
    }
  );

  // T41 (design D4; T02): the mid-record cuts were the getter's `|| 200` turning an explicit overlap of 0 into
  // 200 = chunkSize (the splitter then cut characters — 90 chunks, 96 broken rows); and with the overlap honoured, the
  // office path's former 150-character minimum dropped the CSV's last chunk (14 of 20 rows). Both are gone: an explicit
  // 0 is 0, and a short piece is folded, never dropped (t41-design.md §0d). The marker is gone with them.
  test(
    "csv_table.csv: rows are not split mid-record, and every row survives",
    async () => {
      const sourceId = "tests/fixtures/golden/csv_table.csv";
      const parser = getParserForFile(
        sourceId,
        readFixture(sourceId),
        { chunkSize: 200, chunkOverlap: 0 },
        absPath(sourceId)
      );
      assert.strictEqual(parser.chunkOverlap, 0, "an explicit overlap of 0 is 0 (it read 200 before T41)");
      const chunks = await parser.chunk();
      const rowPattern = /^P\d{3},Design\d{2},\d+,\d+,\d+$/;
      const rows = [];
      for (const chunk of chunks) {
        for (const line of chunk.text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("plot_id")) continue;
          assert.match(trimmed, rowPattern, `CSV row was split mid-record: "${trimmed}"`);
          rows.push(trimmed);
        }
      }
      assert.strictEqual(rows.length, 20, `all twenty rows survive (14 did before T41 under the office path's 150 minimum): ${rows.length}`);
      assert.strictEqual(new Set(rows).size, 20, "no row twice");
      assert.strictEqual(parser.chunksDroppedMinSize, 0, "nothing dropped");
      assert.strictEqual(parser.minChunkSize, 50, "the one minimum (the request names none)");
      assert.strictEqual(parser.chunksMergedMinSize, 0, "at the module's 50 every chunk (182 / 183 / 138) clears the minimum: nothing to fold");
      const at150 = getParserForFile(sourceId, readFixture(sourceId), { chunkSize: 200, chunkOverlap: 0, minChunkSize: 150 }, absPath(sourceId));
      const c150 = await at150.chunk();
      assert.strictEqual(at150.chunksMergedMinSize, 1, "under the drawer's 150 the 138-character last chunk is folded into its neighbour, not dropped");
      assert.strictEqual(c150.flatMap((c) => c.text.split("\n")).filter((l) => /^P\d{3},/.test(l.trim())).length, 20, "all twenty rows at 150 too (14 before T41)");
    }
  );
});

describe("U-PARSE: Office formats (bridge-dependent) — what the unit layer CAN assert (T39 D9; F-156)", () => {
  // The parse itself needs the Python Docling bridge (a subprocess that renders
  // pages and captions figures), which this offline suite never spawns. Until
  // T39 these three were `assert.fail` placeholders marked `todo` with reasons
  // citing audit E02 (REFUTED 2026-08-13, superseded by F-10) and ticket T04
  // (CLOSED VOID for that reason). What IS true at the unit level: each format
  // is routed to the bridge-eligible path and the bridge script the parser
  // would spawn exists. The parse is asserted live by the integration test named
  // per case.
  const parserSrc = fs.readFileSync(path.join(__dirname, "../../src/lib/ingestion/parser.js"), "utf8");
  const bridgeEligible = parserSrc.match(/const bridgeEligible = \[([^\]]+)\]\.includes\(ext\)/);
  const chunkBranch = parserSrc.match(/if \(\[([^\]]+)\]\.includes\(ext\)\) \{\s*\n\s*let doclingPages = null;/);
  const officeCases = [
    { name: "HPE PCAI TCO Analysis - July2026.docx", ext: "docx", coveredBy: "I-INGEST (the golden corpus) and I-SECTION (tests/fixtures/golden/section_headings.docx)" },
    { name: "The Tokenomics Time Bomb - HPE.pptx", ext: "pptx", coveredBy: "I-INGEST (the golden corpus: 15 slides, 32 chunks on the D12 run)" },
    { name: "xlsx_sheets.xlsx", ext: "xlsx", coveredBy: "I-INGEST's spreadsheet case (tests/fixtures/golden/xlsx_sheets.xlsx — added by T39; no spreadsheet is in the demo corpus)" },
  ];

  test("the parser's bridge-eligible list and chunk() branch are readable from the source", () => {
    assert.ok(bridgeEligible, "parser.js declares `const bridgeEligible = [...]​.includes(ext)`");
    assert.ok(chunkBranch, "parser.js's chunk() opens its docling branch on an extension list");
  });

  for (const { name, ext, coveredBy } of officeCases) {
    test(`${name}: .${ext} is routed to the docling bridge path; the parse is asserted live by ${coveredBy.split(" (")[0]}`, () => {
      const listed = (m) => m && m[1].split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, ""));
      assert.ok(listed(bridgeEligible).includes(ext), `.${ext} is bridge-eligible in parser.js (live coverage: ${coveredBy})`);
      assert.ok(listed(chunkBranch).includes(ext), `.${ext} takes chunk()'s docling branch (live coverage: ${coveredBy})`);
      assert.ok(fs.existsSync(path.join(__dirname, "../../src/lib/ingestion/docling_bridge.py")), "the bridge script the parser would spawn exists");
      const fixture = ext === "xlsx" ? "tests/fixtures/golden/xlsx_sheets.xlsx" : `tests/fixtures/legacy_corpus/${name}`;
      assert.ok(fs.existsSync(absPath(fixture)), `the file the live test ingests exists: ${fixture}`);
    });
  }
});

describe("U-PARSE: adversarial fixtures", () => {
  test("empty.txt produces no chunks and must be reported, not silently counted", () => {
    const sourceId = "tests/fixtures/golden/adversarial/empty.txt";
    const buffer = readFixture(sourceId);
    assert.equal(buffer.length, 0, "fixture should be a zero-byte file");
    // The reporting requirement itself (audit E16) is a behaviour change owned
    // by ticket T04; here we only pin the fixture's shape.
  });

  test("utf8_stress.md survives chunking without mojibake", () => {
    const sourceId = "tests/fixtures/golden/adversarial/utf8_stress.md";
    const text = readFixture(sourceId).toString("utf-8");
    const pieces = recursiveSplit(text, 200, 40);
    const rejoined = pieces.join("");

    assert.ok(!rejoined.includes("�"), "replacement character present after chunking");
    for (const probe of ["\u{1F680}", "文書検索", "مرحبا", "שלום", "“quoted”"]) {
      assert.ok(
        pieces.some((p) => p.includes(probe)),
        `multi-byte probe ${JSON.stringify(probe)} was corrupted or dropped by chunking`
      );
    }
  });

  test("huge_line.txt splits within bounds and terminates quickly", () => {
    const sourceId = "tests/fixtures/golden/adversarial/huge_line.txt";
    const expectation = generatedExpectation(sourceId);
    const text = readFixture(sourceId).toString("utf-8");

    const started = Date.now();
    const pieces = recursiveSplit(text, 800, 100);
    const elapsedSeconds = (Date.now() - started) / 1000;

    assert.ok(
      pieces.length >= expectation.expectedMinChunks,
      `expected >= ${expectation.expectedMinChunks} pieces, got ${pieces.length}`
    );
    assert.ok(
      pieces.every((p) => p.length <= 800),
      "separator-free input must still be split down to chunkSize"
    );
    assert.ok(
      elapsedSeconds < expectation.maxSplitSeconds,
      `split took ${elapsedSeconds}s, budget is ${expectation.maxSplitSeconds}s`
    );
  });
});

describe("U-PARSE/T32: the text layer per page, the header parse and the closed TYPE list (t32-design D2, D3)", () => {
  const parserSrc = () => fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "parser.js"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("pageHasTextLayer: text → true; blank → false; no page entry → false (the honest default: nothing else indexes that page)", () => {
    const pages = [{ page: 1, markdown: "MACHINES AND ACCESSORIES\nPage 7 of 84" }, { page: 2, markdown: "   \n\t\n" }, { page: 3, markdown: "" }, { page: 4 }, { markdown: "an entry with no page number is page 1" }];
    assert.strictEqual(pageHasTextLayer(pages, 1), true);
    assert.strictEqual(pageHasTextLayer(pages, 2), false, "whitespace only is no text layer");
    assert.strictEqual(pageHasTextLayer(pages, 3), false);
    assert.strictEqual(pageHasTextLayer(pages, 4), false, "no markdown");
    assert.strictEqual(pageHasTextLayer(pages, 5), false, "no entry");
    assert.strictEqual(pageHasTextLayer([{ markdown: "x" }], 1), true, "an entry without a page number is page 1, as the chunker reads it");
    assert.strictEqual(pageHasTextLayer(null, 1), false);
    assert.strictEqual(pageHasTextLayer([], 1), false);
    assert.strictEqual(pageHasTextLayer([{ page: 1, markdown: "x" }], 1), true);
  });

  test("normaliseVisualType: the closed list, case-insensitive, the leading value first, else the first listed value in the line; null when none (the legacy vocabulary)", () => {
    assert.strictEqual(normaliseVisualType("dimensioned drawing"), "dimensioned drawing");
    assert.strictEqual(normaliseVisualType("Map or Plan"), "map or plan");
    assert.strictEqual(normaliseVisualType("dimensioned drawing | table"), "dimensioned drawing", "the leading value is the model's primary answer");
    assert.strictEqual(normaliseVisualType("mixed (photo + plan)"), "mixed", "composite pages come back mixed — T33's classifier must accept it (t32-design §0b)");
    assert.strictEqual(normaliseVisualType("**screenshot**"), "screenshot");
    assert.strictEqual(normaliseVisualType("a table of values"), "table", "no leading value: the first listed value found");
    assert.strictEqual(normaliseVisualType("text"), "text");
    assert.strictEqual(normaliseVisualType("Textual Policy Document"), null, "`text` as a whole word only");
    assert.strictEqual(normaliseVisualType("Architectural Floor Plan"), null, "the legacy vocabulary is unlisted (counted on the trace, never a failure)");
    assert.strictEqual(normaliseVisualType("Mechanical Assembly Blueprint"), null);
    assert.strictEqual(normaliseVisualType(""), null);
    assert.strictEqual(normaliseVisualType(null), null);
    assert.strictEqual(normaliseVisualType(42), null);
  });

  test("the header parse accepts the generic labels AND the legacy ones, at a line start; visualType is written on every caption chunk's metadata (null when unlisted) and the unlisted are counted (source pin)", () => {
    const src = parserSrc();
    assert.match(src, /const humanTitleMatch = capStr\.match\(\/\^\(\?:HUMAN \)\?TITLE:\\s\*\(\.\+\)\$\/im\);/);
    assert.match(src, /const diagramTypeMatch = capStr\.match\(\/\^\(\?:DIAGRAM \)\?TYPE:\\s\*\(\.\+\)\$\/im\);/);
    assert.match(src, /const keySubjectsMatch = capStr\.match\(\/\^\(\?:KEY \)\?SUBJECTS:\\s\*\(\.\+\)\$\/im\);/);
    assert.match(src, /const visualType = normaliseVisualType\(diagramType\);/);
    assert.match(src, /if \(diagramType && visualType === null && this\.doclingTrace && Number\.isFinite\(this\.doclingTrace\.vlmTypeUnlisted\)\) this\.doclingTrace\.vlmTypeUnlisted\+\+;/);
    assert.match(src, /if \(keySubjects\) meta\.keySubjects = keySubjects;\s*meta\.visualType = visualType;/, "visualType lands beside the three parsed fields");
    // The regexes themselves, on a new-style and a legacy caption.
    const T = /^(?:HUMAN )?TITLE:\s*(.+)$/im, Y = /^(?:DIAGRAM )?TYPE:\s*(.+)$/im, S = /^(?:KEY )?SUBJECTS:\s*(.+)$/im;
    const fresh = "TITLE: Figure 15 – Dimensions and fastening points\nTYPE: dimensioned drawing\nSUBJECTS: lathe base, fixing points\n\nTRANSCRIPTION:\n1728\n";
    assert.deepStrictEqual([fresh.match(T)[1], fresh.match(Y)[1], fresh.match(S)[1]], ["Figure 15 – Dimensions and fastening points", "dimensioned drawing", "lathe base, fixing points"]);
    const legacy = "HUMAN TITLE: Chester 4-Bedroom Home Architectural Floor Plan\nDIAGRAM TYPE: Architectural Floor Plan\nKEY SUBJECTS: Chester 4-Bedroom, Ground Floor\n1. Room Specifications";
    assert.deepStrictEqual([legacy.match(T)[1], legacy.match(Y)[1], legacy.match(S)[1]], ["Chester 4-Bedroom Home Architectural Floor Plan", "Architectural Floor Plan", "Chester 4-Bedroom, Ground Floor"]);
    assert.strictEqual(normaliseVisualType(legacy.match(Y)[1]), null, "a legacy caption's TYPE is unlisted");
    const neither = "A caption with no header at all.\nThe subtitle says TYPE: table inside prose.";
    assert.strictEqual(neither.match(T), null);
    assert.strictEqual(neither.match(Y), null, "a label must start its line");
  });
});

describe("U-PARSE/T33 (t33-design D1, D5–D8): the detail passes run AFTER the captions, through the memo, the once-per-document reset and the bridge's --tiles mode; one detail chunk per page after the caption chunks; the mode is fingerprinted", () => {
  const parserSrc = () => fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "parser.js"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("detailPasses reaches the parser's docVersion input: all / off are other versions of the same bytes, auto / absent / junk the page-shape one (D6)", () => {
    const sourceId = "tests/fixtures/golden/text_basic.txt";
    const base = { chunkSize: 600, chunkOverlap: 80, minChunkSize: 150 };
    const plain = getParserForFile(sourceId, readFixture(sourceId), base, absPath(sourceId));
    assert.strictEqual(plain.docVersion.split(".")[1], "a5d02a609ad9", "the page-shape fingerprint under IDENTITY_VERSION 14 (U-IDS pins the same number; 94195d3aa6bb was v13's, 0c708178f137 v12's, 0008a8c2d1f3 v11's, 852f45f6ef65 v10's, 864cbc8489ad v9's)");
    for (const def of ["auto", undefined, null, "", "nope", 7]) assert.strictEqual(getParserForFile(sourceId, readFixture(sourceId), { ...base, detailPasses: def }, absPath(sourceId)).docVersion, plain.docVersion, `detailPasses ${JSON.stringify(def)} is the default`);
    const all = getParserForFile(sourceId, readFixture(sourceId), { ...base, detailPasses: "all" }, absPath(sourceId));
    const off = getParserForFile(sourceId, readFixture(sourceId), { ...base, detailPasses: "off" }, absPath(sourceId));
    assert.notStrictEqual(all.docVersion, plain.docVersion); assert.notStrictEqual(off.docVersion, plain.docVersion); assert.notStrictEqual(all.docVersion, off.docVersion);
    assert.strictEqual(all.docVersion.split(".")[0], plain.docVersion.split(".")[0], "the same content hash");
    const src = parserSrc();
    assert.match(src, /detailPasses: this\.config\?\.detailPasses,\s*ocrNoTextPages: this\.config\?\.ocrNoTextPages\s*\}\);/, "the fingerprint input names the key (T35's ocrNoTextPages after it)");
    assert.match(src, /const detailMode = normaliseDetailMode\(this\.config\?\.detailPasses\);/, "the mode is read once, normalised (auto | all | off)");
  });

  test("the detail loop sits AFTER the caption loop and BEFORE the VLM duration is measured; the trigger reads each captioned page's caption with the parser's normalised TYPE; the tiles come from the bridge's --tiles mode at the module's geometry; KEY then INDEX / TRANSCRIBE per tile through askDetail with the memo; NONE downgrades; the merge, the text, the split (source pins)", () => {
    const src = parserSrc();
    const captionLoopEnd = src.indexOf("else if (CAPTION_FAILURE_OUTCOMES.includes(result.outcome)) vlmCounts.failed++;");
    const detailStart = src.indexOf("const detail = { mode: detailMode, pages: 0, tiles: 0, calls: 0, fromMemo: 0, memoised: 0, conflicts: 0, failed: 0, notTaken: 0, chunks: 0, empty: 0, pagesList: [], reasons: [], failedPages: [], emptyPages: [], notTakenOcr: 0, notTakenOcrPages: [], edgeDropped: 0, edgeSettled: 0, multiValued: 0, colourPages: 0, colourChecked: 0, colourFlagged: 0, colourSettled: 0, colourAssociated: 0, colourFailed: 0, colourFailedPages: [] };");
    const durationAt = src.indexOf("vlmDurationMs = Date.now() - vlmStart;");
    assert.ok(captionLoopEnd > 0 && detailStart > captionLoopEnd && durationAt > detailStart, "captions, then the detail passes, then the duration");
    const loop = src.slice(detailStart, durationAt);
    assert.match(loop, /if \(detailMode !== "off"\) \{/, "off: no pass at all");
    assert.match(loop, /if \(pic\.captionOutcome !== "captioned" \|\| typeof pic\.caption !== "string"\) continue;/, "only a captioned page is offered to the trigger");
    assert.match(loop, /const visualType = normaliseVisualType\(typeLine\);/);
    // T35 (design D8): the trigger also knows whether OCR read the page (the transcribe plan is then not taken).
    assert.match(loop, /const plan = detailPlanFor\(\{ caption: pic\.caption, visualType, mode: detailMode, ocr: pageOcr \}\);/, "the pure trigger, on the caption, the parser's TYPE verdict and the page's OCR state");
    assert.match(loop, /if \(!plan\) \{\s*detail\.notTaken\+\+;\s*if \(pageOcr && detailPlanFor\(\{ caption: pic\.caption, visualType, mode: detailMode \}\)\) \{ detail\.notTakenOcr\+\+; detail\.notTakenOcrPages\.push\(pic\.page\); \}\s*continue;\s*\}/, "a visual page that did not qualify is counted (the widen sentence); one declined for OCR is counted and named too");
    assert.match(loop, /--tiles \$\{pic\.page\}:\$\{DETAIL_GRID\[0\]\}x\$\{DETAIL_GRID\[1\]\}:\$\{DETAIL_OVERLAP\}:\$\{DETAIL_RENDER_SCALE\}/, "the bridge renders the tiles at the module's geometry (D2)");
    assert.match(loop, /` --tile-image "\$\{pic\.abs_path\}"`/, "a docling picture is cut, not re-rendered");
    assert.match(loop, /if \(wholeBytes && willMiss\(wholeBytes, \{ stage: "key" \}\)\) await resetOnce\(\);/, "the reset before the first request that will miss the memo (D8)");
    assert.match(loop, /if \(bytes && willMiss\(bytes, stageOpts\)\) await resetOnce\(\);/);
    assert.match(loop, /await askDetail\(tilesInfo\.whole\.abs_path, \{ \.\.\.askOpts, stage: "key"/, "KEY on the whole page render");
    assert.match(loop, /if \(isNoneReply\(k\.reply\)\) kind = "transcribe";/, "a NONE key downgrades the plan (D3)");
    assert.match(loop, /const stage = kind === "keyed-index" \? "index" : "transcribe";/);
    assert.match(loop, /for \(const t of tilesInfo\.tiles\) \{/, "one request per tile, sequential, awaited");
    assert.match(loop, /await askDetail\(t\.abs_path, \{ \.\.\.askOpts, \.\.\.stageOpts, label: `\$\{label\} \(\$\{t\.tile\}\)`/);
    assert.match(loop, /const geometry = detailGeometry\(tilesInfo\);\s*let merged = kind === "keyed-index" \? mergeTiles\(replies, \{ key, \.\.\.geometry \}\) : null;/, "the merge in code (D4), under the page's geometry (T45); `let` since T57 — the colour check may return the checked merge");
    assert.match(loop, /const text = detailChunkText\(\{ title, pageTitle, page: pic\.page, kind, key, merged, transcription, tilesNotRead, legendText \}\);/);
    assert.match(loop, /const parts = splitDetailText\(text\);/, "the split rule (D5)");
    assert.match(loop, /const failPage = \(why\) => \{ detail\.failed\+\+; detail\.failedPages\.push\(pic\.page\);/, "a failed pass is counted and the page named — never a partial file (D7)");
    assert.ok(!/PARTIAL_REASONS|captions_incomplete/.test(loop), "the detail loop never marks the file partial");
    for (const k of ["if (r.source === \"memo\") detail.fromMemo++;", "if (r.requested) detail.calls++;", "if (r.memoised) detail.memoised++;", "if (vlmFirstLoadMs === null && Number.isFinite(r.loadMs)) vlmFirstLoadMs = r.loadMs;"]) assert.ok(loop.includes(k), `the loop tallies ${k}`);
    // The trace's captionReset is "reset iff a request" (T24 D2 / T29 D3 / T33 D8): a reset the detail loop sent — every
    // caption recalled, a tile asked — is written after the loop (the first live run recorded null there; §11a A17).
    assert.match(loop, /if \(resetSent && captionReset === null\) \{\s*captionReset = resetSent\.ok \? resetSent\.unloaded : false;\s*captionResetWaitMs = Number\.isFinite\(resetSent\.waitedMs\) \? resetSent\.waitedMs : null;\s*\}/, "a reset sent by the detail loop reaches the trace");
    assert.ok(loop.indexOf("if (resetSent && captionReset === null)") > loop.lastIndexOf("await askDetail("), "after the last detail request");
    const trace = src.slice(src.indexOf("picturesCaptured: (parsed.pictures || []).length,"), src.indexOf("markdownSample: (doclingPages[0]"));
    for (const k of ["detailMode,", "detailPages:", "detailTiles:", "detailCalls:", "detailFromMemo:", "detailMemoised:", "detailConflicts:", "detailFailed:", "detailNotTaken:", "detailChunks:", "detailPagesList:", "detailReasons:", "detailFailedPages:"]) assert.ok(trace.includes(k), `the trace records ${k}`);
    // The chunk assembly: the detail chunks after the caption chunks, an isVisualElement chunk on the page's render, marked `detail`.
    const captionChunks = src.indexOf("[HUMAN-LOGICAL VISUAL ELEMENT: ${displayLabel}");
    const detailChunks = src.indexOf("if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {");
    assert.ok(captionChunks > 0 && detailChunks > captionChunks && detailChunks < src.indexOf("return allChunks;", captionChunks), "the detail chunks come after the caption chunks, before the return");
    const append = src.slice(detailChunks, src.indexOf("return allChunks;", detailChunks));
    for (const k of ["meta.isVisualElement = true;", "meta.detail = true;", "meta.detailKind = dr.kind;", "meta.detailReason = dr.reason;", "meta.imagePath = dr.pic.web_path;", "meta.detailCounts = dr.counts;", "meta.detailConflicts = dr.conflicts;", "imagePath: dr.pic.web_path,", "chunkIndex: chunkSeq++,", "...this.chunkIdentity(),"]) assert.ok(append.includes(k), `the detail chunk carries ${k}`);
    assert.match(append, /meta\.figureId = n > 1 \? `detail_\$\{dr\.page\}_\$\{i \+ 1\}` : `detail_\$\{dr\.page\}`;/);
    assert.ok(!/this\.config\?\.(detailGrid|detailOverlap|detailScale|tileGrid)/.test(src), "the geometry is a constant, not a setting (D2)");
  });

  test("the bridge's --tiles mode is its own branch and the parser calls it with the page's render folder; every existing bridge path is untouched (source pin)", () => {
    const bridge = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "docling_bridge.py"), "utf-8");
    assert.match(bridge, /def render_detail_tiles\(doc_path, output_dir, page_no, rows, cols, overlap, scale, image_path=None\):/);
    assert.match(bridge, /def parse_tiles_spec\(spec\):/);
    // T35: the `--page-count` branch and the `--ocr` flag sit between the tiles branch and the argument handling; the
    // `--no-images` read is byte-identical, the default call carries the OCR mode.
    assert.match(bridge, /if "--tiles" in argv:[\s\S]*?sys\.exit\(0\)\s*\n\s*(?:#[^\n]*\n\s*)?if "--page-count" in argv:[\s\S]*?sys\.exit\(0\)\s*\n\s*(?:#[^\n]*\n\s*)?ocr_mode = "auto"[\s\S]*?args = \[a for i, a in enumerate\(argv\) if a != "--no-images" and a != "--ocr" and not \(i > 0 and argv\[i - 1\] == "--ocr"\)\]/, "the tiles branch returns first; then the page count; then the OCR flag; then the argument handling");
    assert.match(bridge, /no_images = "--no-images" in sys\.argv\[1:\]/);
    assert.match(bridge, /print\(convert_document_to_markdown_pages\(input_file, out_dir, no_images, ocr_mode\)\)/, "the default path is the pre-T33 call plus the OCR mode (T35)");
    const src = parserSrc();
    assert.match(src, /await execAsync\(`"\$\{pythonBin\}" "\$\{bridgeScript\}" "\$\{this\.filePath\}" "\$\{imgDir\}" \$\{tileArgs\}`, \{ maxBuffer: 20 \* 1024 \* 1024, timeout: 120000 \}\);/, "the same interpreter and script, the document's own crop folder");
  });
});

// T34 (design D2–D4, D6; F-142 riding by the owner's D9): the unpaginated branch of the docling path, the empty-index
// rule, and the counts the trace carries — source pins, in the style of the T29 / T33 blocks above.
describe("U-PARSE: T34 — an unpaginated docling file takes its anchors from the markdown headings; a keyed page with an empty index emits no chunk", () => {
  const parserSrc = () => fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "parser.js"), "utf-8");

  test("the bridge's `paginated: false` selects the branch BEFORE the page-top / uppercase heuristics; the branch reads sections.js only; a paginated page falls through to the rules below, byte for byte", () => {
    const src = parserSrc();
    const branch = src.slice(src.indexOf("const unpaginated = this.doclingTrace?.paginated === false;"), src.indexOf("// T18 (design D4): the page's heading is a heading-shaped line within its first five lines"));
    assert.ok(branch.length > 0, "the branch precedes the page heuristics");
    assert.ok(!/\bparsed\.paginated\b/.test(branch), "the fact is read off the trace, not the bridge branch's local (the first live pass: `parsed is not defined`)");
    assert.match(branch, /const sections = require\("\.\/sections"\);/);
    assert.match(branch, /if \(unpaginated\) \{\s*const headings = sections\.parseHeadings\(pMd\);\s*const pageChunks = recursiveSplit\(pMd, this\.chunkSize, this\.chunkOverlap\);\s*const offsets = sections\.chunkOffsets\(pMd, pageChunks\);/, "the headings once per document, the chunks at the page's shape, each chunk's offset");
    // T41 (design D2): the anchor and the prefix decision read the survivor's ORIGINAL piece (its offset), the stored text is the folded body.
    assert.match(branch, /const anchor = sections\.anchorForChunk\(headings, offsets\[c\.index\], cleanedTxt\.length\);\s*const pathText = anchor \? sections\.renderPath\(anchor\.path\) : null;/, "the anchor of the chunk — the section holding most of its characters (A13) — rendered as the path (D2 b)");
    assert.match(branch, /const chunkWithHeader = pathText && !sections\.startsWithHeading\(cleanedTxt\) \? `\$\{sections\.sectionPrefix\(pathText\)\}\$\{c\.body\}` : c\.body;/, "D3: `[Section: …]` heads the chunk unless the chunk begins with its heading line — never `[Page`");
    assert.match(branch, /meta\.section_title = pathText;\s*meta\.sectionHeading = anchor\.innermost;\s*meta\.section_level = anchor\.level;/, "D6: the path lands in section_title (the store's sectionTitle), the innermost in sectionHeading");
    assert.ok(!/pageTopHeading|chunkHeading|\[Page \$\{pNo\}/.test(branch), "none of the PDF-page rules in the branch (D4; T18's picks)");
    assert.match(branch, /const foldedPage = foldSubMinimum\(pageChunks\.map\(\(p\) => String\(p \|\| ""\)\.trim\(\)\), this\.minChunkSize, \{ prefer: "next" \}\);/, "T41 (design D2): the minimum-size rule is the fold — the same as the paginated path's");
    assert.match(branch, /\.\.\.this\.chunkIdentity\(\),/, "the identity fields as everywhere");
    assert.match(branch, /continue;\s*\}\s*$/, "the paginated rules below are skipped for the unpaginated file only");
    const after = src.slice(src.indexOf("// T18 (design D4): the page's heading is a heading-shaped line within its first five lines"), src.indexOf("// Append VLM-captioned Visual RAG Chunks with Human-Logical Metadata"));
    assert.match(after, /const headerTag = currentSectionHeading \? `\[Page \$\{pNo\} - \$\{currentSectionHeading\}\]\\n` : `\[Page \$\{pNo\}\]\\n`;/, "the paginated path's prefix is unchanged");
    assert.match(after, /let currentSectionHeading = pageTopHeading\(pMd\) \|\| "";/, "the page-top pick (T18 D4) stays for paginated pages");
  });

  test("F-142: a keyed-index merge with an EMPTY index emits no chunk — counted as detailEmpty, the page named — before the conflicts are tallied; the replies stay memoised (no memo write is undone)", () => {
    const src = parserSrc();
    const loop = src.slice(src.indexOf("const detail = { mode: detailMode,"), src.indexOf("this.detailSummary = detail;"));
    assert.match(loop, /const detail = \{ mode: detailMode, pages: 0, tiles: 0, calls: 0, fromMemo: 0, memoised: 0, conflicts: 0, failed: 0, notTaken: 0, chunks: 0, empty: 0, pagesList: \[\], reasons: \[\], failedPages: \[\], emptyPages: \[\], notTakenOcr: 0, notTakenOcrPages: \[\], edgeDropped: 0, edgeSettled: 0, multiValued: 0, colourPages: 0, colourChecked: 0, colourFlagged: 0, colourSettled: 0, colourAssociated: 0, colourFailed: 0, colourFailedPages: \[\] \};/);
    const merged = loop.indexOf('let merged = kind === "keyed-index" ? mergeTiles(replies, { key, ...geometry }) : null;');
    const empty = loop.indexOf("if (merged && merged.index.length === 0) {");
    const transcription = loop.indexOf('const transcription = kind === "transcribe" ? mergeTranscriptions(replies) : null;');
    const conflicts = loop.indexOf("if (merged) detail.conflicts += merged.conflicts.length;");
    assert.ok(merged > 0 && empty > merged && empty < transcription && transcription < conflicts, "the empty check sits between the merge and the transcription / conflicts lines");
    // T57 (design §2.4): the colour check follows the empty check and precedes the transcription / conflicts lines —
    // an empty index is never checked; the F-142 block itself ends where the colour check begins.
    const colourAt = loop.indexOf("let colour = null;");
    assert.ok(colourAt > empty && colourAt < transcription, "the colour check sits after the empty check, before the transcription line");
    const block = loop.slice(empty, colourAt).replace(/^\s*\/\/.*$/gm, "");
    assert.match(block, /detail\.empty\+\+;\s*detail\.emptyPages\.push\(pic\.page\);/);
    assert.match(block, /no detail chunk \(F-142\)/);
    assert.match(block, /continue;\s*\}\s*$/);
    assert.ok(!/memo\.(delete|remove|forget)/.test(block), "the replies stay in the memo");
    const trace = src.slice(src.indexOf("picturesCaptured: (parsed.pictures || []).length,"), src.indexOf("markdownSample: (doclingPages[0]"));
    for (const k of ["detailEmpty: this.detailSummary ? this.detailSummary.empty : 0,", 'detailEmptyPages: this.detailSummary ? detailPagesList(this.detailSummary.emptyPages) : "",']) assert.ok(trace.includes(k), `the trace records ${k}`);
  });

  test("the count travels: the route (the file result, the ledger record, the terminal records), the ledger's reducer, the views' suffix, the span and the state probe", () => {
    const route = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "api", "ingest", "route.js"), "utf-8");
    assert.match(route, /fr\.counts\.detailEmpty = fig\("detailEmpty"\);/);
    assert.match(route, /fr\.detailEmptyPages = typeof trace\?\.detailEmptyPages === "string" \? trace\.detailEmptyPages : null;/);
    assert.match(route, /detailEmpty: fig\("detailEmpty"\),/, "the ledger record's counts");
    assert.match(route, /detailEmptyPages: fr\.detailEmptyPages,/, "the ledger record names the pages");
    assert.match(route, /detailEmpty: fr\.counts\.detailEmpty,/, "every terminal record");
    const ledger = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "rag", "ledger.js"), "utf-8");
    assert.match(ledger, /detailEmpty: Number\.isFinite\(e\.counts\?\.detailEmpty\) \? e\.counts\.detailEmpty : null,/);
    assert.match(ledger, /detailEmptyPages: typeof e\.detailEmptyPages === "string" \? e\.detailEmptyPages : null,/);
    const outcomes = require("../../src/lib/ingestion/outcomes.js");
    const f = { detailMode: "auto", detailReasons: ["p1 legend", "p2 legend"], detailEmptyPages: "2", counts: { detailPages: 2, detailTiles: 8, detailCalls: 0, detailFromMemo: 10, detailConflicts: 3, detailFailed: 0, detailNotTaken: 0, detailEmpty: 1 } };
    assert.strictEqual(outcomes.detailSuffix(f), " · detail passes: p1 legend, p2 legend — 8 tiles, 0 asked, 10 from memo, 3 conflicts, 1 keyed with an empty index, no chunk (p2)");
    assert.strictEqual(outcomes.detailSuffix({ ...f, detailEmptyPages: "", counts: { ...f.counts, detailEmpty: 0 } }), " · detail passes: p1 legend, p2 legend — 8 tiles, 0 asked, 10 from memo, 3 conflicts", "nothing new when none");
    const engines = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "engines.js"), "utf-8");
    assert.match(engines, /detailEmpty: sum\("detailEmpty"\),/);
    assert.match(engines, /keyed page\(s\) with an empty index \(no chunk\)/);
    const probe = fs.readFileSync(path.join(__dirname, "..", "..", "tests", "eval", "baselines", "t22-artifacts", "probe_state.js"), "utf-8");
    assert.match(probe, /empty: f\.detailEmpty \?\? null, emptyPages: f\.detailEmptyPages \?\? null/);
  });
});


// T41 (t41-design.md D2–D4, D7; T19 / T20 / T02 / F-165): the chunk settings as numbers, one minimum on every path
// and a short piece folded (never dropped), a heading in the paragraph it introduces, an oversize paragraph split, a
// typed Office failure, a hidden page emitting no chunk — the parts the offline paths can prove, and source pins for
// the docling branch the bridge alone can run (the first live pass and I-INGEST prove those).
describe("U-PARSE/T41 (t41-design D2–D4, D7): the chunk settings, the fold, the markdown rules, the typed Office failure, the hidden page", () => {
  const { extractOfficeText, chunkSetting } = require("../../src/lib/ingestion/parser");
  const parserSrc = () => fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "parser.js"), "utf-8");
  const txt = "tests/fixtures/golden/text_basic.txt";

  test("D4: chunkSetting reads a number — an explicit 0 overlap is 0, a numeric string its number, absent or unreadable the default; a chunk size of 0 is no setting", () => {
    assert.strictEqual(chunkSetting(0, 200), 0);
    assert.strictEqual(chunkSetting("80", 200), 80);
    for (const v of [undefined, null, "", "x", -5, NaN]) assert.strictEqual(chunkSetting(v, 200), 200, JSON.stringify(v));
    assert.strictEqual(chunkSetting(0, 800, { positive: true }), 800);
    assert.strictEqual(chunkSetting("600", 800, { positive: true }), 600);
    const p = getParserForFile(txt, readFixture(txt), { chunkSize: "600", chunkOverlap: 0, minChunkSize: "150" }, absPath(txt));
    assert.deepStrictEqual([p.chunkSize, p.chunkOverlap, p.minChunkSize], [600, 0, 150]);
    const d = getParserForFile(txt, readFixture(txt), {}, absPath(txt));
    assert.strictEqual(d.minChunkSize, 50, "the module's default when the request names no minimum (the drawer sends 150)");
    assert.strictEqual(d.chunkOverlap, 200);
    assert.strictEqual(getParserForFile(txt, readFixture(txt), { minChunkSize: 0 }, absPath(txt)).minChunkSize, 0, "0 is no minimum");
  });

  test("D2 (the office / plain-text path): a short last piece is folded into its predecessor, the short first into its successor; nothing dropped, the fold counted", async () => {
    const body = "A first paragraph long enough to clear the minimum of fifty characters with room to spare.";
    const text = `${body}\n\nshort tail`;
    // A chunk size the body fits alone but not with its neighbour, so the splitter cuts exactly at the blank line.
    const size = body.length + 5;
    const p = getParserForFile("tests/fixtures/tmp/fold.txt", Buffer.from(text), { chunkSize: size, chunkOverlap: 0, minChunkSize: 50 }, absPath("tests/fixtures/tmp/fold.txt"));
    const chunks = await p.chunk();
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].text, `${body}\nshort tail`);
    assert.strictEqual(p.chunksMergedMinSize, 1);
    assert.strictEqual(p.chunksDroppedMinSize, 0, "measured 0 — the office path's former 150 minimum and its drop are gone");
    const first = getParserForFile("tests/fixtures/tmp/fold2.txt", Buffer.from(`Heading\n\n${body}`), { chunkSize: size, chunkOverlap: 0, minChunkSize: 50 }, absPath("tests/fixtures/tmp/fold2.txt"));
    const c2 = await first.chunk();
    assert.strictEqual(c2.length, 1);
    assert.strictEqual(c2[0].text, `Heading\n${body}`, "the short first piece opens the chunk that follows it");
    assert.strictEqual(first.chunksMergedMinSize, 1);
    const sentinels = getParserForFile(txt, readFixture(txt), { chunkSize: 200, chunkOverlap: 20, minChunkSize: 50 }, absPath(txt));
    const c3 = await sentinels.chunk();
    const all = c3.map((c) => c.text).join("\n");
    for (const s of ["QUARTZLINE", "BASALTNINE"]) assert.ok(all.includes(s), `${s} survives`);
    assert.strictEqual(sentinels.chunksDroppedMinSize, 0);
  });

  test("D3 (the markdown path): a heading opens the paragraph it introduces, an oversize paragraph is split, the line range rides every piece, a short chunk is folded into its predecessor", async () => {
    const md = "tests/fixtures/golden/md_headings.md";
    const p = getParserForFile(md, readFixture(md), { chunkSize: 800, chunkOverlap: 100 }, absPath(md));
    const chunks = await p.chunk();
    assert.strictEqual(chunks.length, 1);
    assert.ok(chunks[0].text.includes("## ZEPHYRQUARTZ Control Framework\nThis section body deliberately"), "the heading and its paragraph are one unit");
    assert.ok(chunks[0].text.startsWith("# Corporate Standards Handbook\nIntroductory paragraph"), "the title opens the first chunk");
    const meta = JSON.parse(chunks[0].metadata);
    assert.strictEqual(meta.section_title, "Corporate Standards Handbook", "the chunk's own first heading line names its section");
    assert.ok(Number.isInteger(meta.startLine) && Number.isInteger(meta.endLine) && meta.startLine <= meta.endLine, "the line range");
    assert.strictEqual(p.chunksDroppedMinSize, 0, "measured on this path now (it read null before T41)");
    const lp = "tests/fixtures/golden/md_longpara.md";
    const q = getParserForFile(lp, readFixture(lp), { chunkSize: 800, chunkOverlap: 100 }, absPath(lp));
    const pieces = await q.chunk();
    assert.ok(pieces.length >= 2, `the 6,449-character paragraph is split: ${pieces.length} chunks`);
    assert.ok(pieces.every((c) => c.text.length <= 1600), "every piece within the contract's ceiling");
    assert.ok(pieces[0].text.startsWith("# Long Paragraph Fixture\nThe settlement engine"), "the heading opens the first piece");
    assert.ok(pieces.every((c) => Number.isInteger(JSON.parse(c.metadata).startLine)), "the unit's line range on every piece");
    assert.ok(pieces.every((c, i) => c.chunkIndex === i), "sequential chunkIndex");
    const tiny = "tests/fixtures/golden/adversarial/tiny.md";
    const t = await getParserForFile(tiny, readFixture(tiny), { chunkSize: 800, chunkOverlap: 100 }, absPath(tiny)).chunk();
    assert.deepStrictEqual(t.map((c) => c.text), ["# Tiny\nOne short line: OBSIDIANFOUR."], "a lone short chunk is kept, its heading in the body");
    // A trailing heading with no text: at a size that cannot accumulate it, it is its own short chunk and folds into its
    // predecessor (at a larger size the accumulation joins it first — no fold needed either way, never a loss).
    const trailing = getParserForFile("tests/fixtures/tmp/trail.md", Buffer.from("# Doc\n\nA first paragraph long enough to clear the minimum of fifty characters with room.\n\n# Trailing heading\n"), { chunkSize: 90, chunkOverlap: 10 }, absPath("tests/fixtures/tmp/trail.md"));
    const tr = await trailing.chunk();
    assert.strictEqual(tr.length, 1, `one chunk: ${JSON.stringify(tr.map((c) => c.text))}`);
    assert.ok(tr[0].text.endsWith("\n# Trailing heading"), "a trailing heading with no text folds into its predecessor");
    assert.strictEqual(trailing.chunksMergedMinSize, 1);
    const joined = getParserForFile("tests/fixtures/tmp/trail2.md", Buffer.from("# Doc\n\nA first paragraph long enough to clear the minimum of fifty characters with room.\n\n# Trailing heading\n"), { chunkSize: 800, chunkOverlap: 100 }, absPath("tests/fixtures/tmp/trail2.md"));
    const j = await joined.chunk();
    assert.strictEqual(j.length, 1);
    assert.ok(j[0].text.endsWith("\n# Trailing heading") && joined.chunksMergedMinSize === 0, "at 800 the accumulation joins it — no fold needed");
  });

  test("D4: a failed Office parse is a typed PARSE_FAILED failure — no bytes decoded as text; plain-text formats still decode", async () => {
    // officeparser@7 resolves an EMPTY result for bytes that are not a zip at all (measured: garbage, a corrupt PK
    // header and an empty buffer all resolve to "" — the route then records `parsed to 0 chunks`, an honest outcome);
    // the catch this test proves is the one a parse that THROWS reaches — simulated by the module's own function.
    const officeParser = require("officeparser");
    const real = officeParser.parseOffice;
    officeParser.parseOffice = async () => { throw new Error("End of central directory not found"); };
    try {
      await assert.rejects(extractOfficeText(Buffer.from("PK\u0003\u0004 corrupt"), "/tmp/corrupt.docx"), (err) => err && err.code === "PARSE_FAILED" && /PARSE_FAILED: corrupt\.docx could not be parsed as docx \(End of central directory not found\)/.test(err.message) && /no bytes were indexed as text/.test(err.message) && err.fileType === "docx");
    } finally { officeParser.parseOffice = real; }
    assert.strictEqual(String(await extractOfficeText(Buffer.from("not a zip, not a document"), "/tmp/garbage.docx")), "", "bytes that are not a zip parse to nothing (the route's empty outcome), never to UTF-8 garbage");
    assert.strictEqual(await extractOfficeText(Buffer.from("a,b\n1,2\n"), "/tmp/x.csv"), "a,b\n1,2\n");
    assert.strictEqual(await extractOfficeText(Buffer.from("# md"), "/tmp/x.md"), "# md");
    const src = parserSrc();
    assert.match(src, /failure\.code = "PARSE_FAILED";/);
    assert.ok(!/console\.error\(`\[OfficeParser Error\][^\n]*\n\s*return fileBuffer\.toString\('utf-8'\);/.test(src), "the catch no longer decodes the binary");
  });

  test("D2 / D7 (the docling branch — source pins; the bridge alone runs it): every path folds through fold.js on the survivor's original piece, a hidden page emits no chunk and is counted and named, the log line says both", () => {
    const src = parserSrc();
    assert.match(src, /const \{ foldSubMinimum, DEFAULT_MIN_CHUNK_SIZE \} = require\('\.\/fold'\);/);
    assert.strictEqual((src.match(/foldSubMinimum\(/g) || []).length, 5, "the unpaginated, paginated, pdf-parse, office and markdown paths — five calls");
    assert.ok(!/chunksDroppedMinSize\+\+/.test(src), "no path drops a piece any more");
    assert.match(src, /if \(pItem\.hidden === true\) \{ hiddenPages\.push\(pNo\); continue; \}/, "a hidden page: no chunk, counted");
    assert.match(src, /this\.doclingTrace\.slidesHidden = hiddenPages\.length; this\.doclingTrace\.hiddenSlidesList = hiddenPages\.join\(", "\);/, "the trace names them (the ledger and the status line read it there)");
    assert.match(src, /const cleanedTxt = c\.original;\s*\n\s*\/\/ Detect nearest preceding heading inside this specific chunk/, "the heading detection reads the survivor's ORIGINAL piece");
    assert.match(src, /\? c\.body\s*: `\$\{headerTag\}\$\{c\.body\}`;/, "the stored text is the folded body under the header decided on the original");
    assert.match(src, /console\.log\(`\[Parser\] \$\{this\.fileName\}: \$\{allChunks\.length\} text chunk\(s\); \$\{this\.chunksMergedMinSize\} piece\(s\) under the minimum/, "one [Parser] line per file");
    assert.ok(!/minChunkSize \|\| (50|150)/.test(src), "the two fallbacks (50 / 150) are gone: one getter");
  });

  test("T18 (t18-design D2, D4, D6, D9–D11): the running lines leave the pages before any rule reads them, the heading picks are the modules', no brand name or phrase list survives, the router matches tokens", () => {
    const src = parserSrc();
    assert.match(src, /const \{ stripRunningLines, pageArtifactCounts \} = require\('\.\/running_lines'\);/);
    assert.match(src, /const \{ pageTopHeading, chunkHeading, stripPageWord \} = require\('\.\/page_heading'\);/);
    assert.ok(!/romans|barratt|machines\s+and|all images|bedroom home|sanitizeHeading|headingMatch|rawTopHeading|pageSpecificHeading/i.test(src), "the backlog's acceptance grep: no brand name, no Barratt phrase, no restoring fallback, no first-short-line rule");
    assert.ok(!src.includes("cleanedTxt.match(/^([A-Z0-9\\s\\-\\.\\:\\(\\)]{4,50})$/m)"), "the uppercase rule that spanned newlines is gone (F-167)");
    // the strip runs on the bridge's pages BEFORE the detail pass, the caption titles and the chunk loop read them
    const stripAt = src.indexOf("const stripped = stripRunningLines(doclingPages, { keepFirst: true });");
    assert.ok(stripAt > 0 && stripAt < src.indexOf("const ocr = parsed.ocr && typeof parsed.ocr") && stripAt < src.indexOf("const title = captionTitleOf(pic.caption);"), "the strip is the first thing after the bridge's pages land");
    assert.match(src, /if \(parsed\.paginated !== false\) \{\s*const stripped = stripRunningLines\(doclingPages, \{ keepFirst: true \}\);\s*doclingPages\.forEach\(\(p, i\) => \{ if \(p\.hidden !== true\) \{ p\.hadTextLayer = \/\\S\/\.test\(String\(p\.markdown \|\| ""\)\); p\.markdown = stripped\.pages\[i\]; \} \}\);\s*pageArtifacts = pageArtifactCounts\(stripped\);/, "a paginated document only; the first copy kept (D3 b); hidden pages untouched; the text-layer fact recorded BEFORE the strip (A9)");
    // A9: a page whose only text was the running block keeps its text LAYER for the captioner (the with-text prompt, the memo key)
    const { pageHasTextLayer } = require("../../src/lib/ingestion/parser.js");
    assert.strictEqual(pageHasTextLayer([{ page: 3, markdown: "", hadTextLayer: true }], 3), true, "the bridge's text layer stands although the strip emptied the page");
    assert.strictEqual(pageHasTextLayer([{ page: 4, markdown: "", hadTextLayer: false }], 4), false);
    assert.strictEqual(pageHasTextLayer([{ page: 5, markdown: "some text" }], 5), true, "a page never stripped reads its markdown");
    assert.strictEqual(pageHasTextLayer([{ page: 6, markdown: "   " }], 6), false);
    assert.match(src, /const strippedFallback = stripRunningLines\(pages\.map\(\(p\) => p\.text\), \{ keepFirst: true \}\);\s*this\.doclingTrace\.pageArtifacts = pageArtifactCounts\(strippedFallback\);/, "the pdf-parse fallback path strips too (D11)");
    assert.match(src, /let currentSectionHeading = pageTopHeading\(pMd\) \|\| "";/, "the page's heading is the shaped pick or none (D4)");
    assert.match(src, /const chunkHead = chunkHeading\(cleanedTxt\);\s*if \(chunkHead && chunkHead\.length > 3 && !\/\^page\\s\/i\.test\(chunkHead\)\) currentSectionHeading = stripPageWord\(chunkHead\);/, "the chunk's heading is a markdown line or the uppercase run joined by a space (D4)");
    assert.match(src, /const humanTitle = rawHumanTitle \? stripPageWord\(rawHumanTitle\) : null;\s*const pageTitle = pageTitleFor\(doclingPages, pic\.page\);/, "the caption's title is the VLM's; the page title is the page's heading (D6)");
    assert.match(src, /return pageTopHeading\(pageObj\?\.markdown \|\| ""\) \|\| `Page \$\{pageNo\}`;/, "pageTitleFor reads the same pick");
    assert.match(src, /this\.doclingTrace\.pageArtifacts = pageArtifacts; \}/, "the counts ride the trace");
    assert.match(src, /running line\(s\) removed \(\$\{pa\.distinctKeys\} key\(s\), \$\{pa\.keptFirst\} kept once, \$\{pa\.pagesWithoutText\} page\(s\) left without text\)/, "the [Parser] line says so");
    assert.match(src, /const route = routeForFileName\(filePath\);/, "the router reads tokens (D9)");
    const bridge = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "docling_bridge.py"), "utf-8");
    assert.ok(!/25, 53/.test(bridge), "the fallback branch's page list is gone (D10)");
    assert.match(bridge, /if output_dir and page_idx < FALLBACK_RENDER_PAGES:/);
    assert.match(bridge, /FALLBACK_RENDER_PAGES = int\(os\.environ\.get\("NEXCODE_FALLBACK_RENDER_PAGES", "15"\)\)/);
  });

  test("T18 (t18-design D2, D3, D4 — the corpus's PSRs document through the parser at the drawer's shape): the legislation banner and the page number leave every page but the first, no \\r survives, no header spans lines, every heading is heading-shaped", async () => {
    const psrs = "public/demos/demo_files/ext_reg_docs/PSRs_2017_April2026.pdf";
    const parser = getParserForFile(psrs, readFixture(psrs), { chunkSize: 600, chunkOverlap: 80, minChunkSize: 150, captionFigures: false }, absPath(psrs));
    const chunks = await parser.chunk();
    assert.ok(chunks.length > 50, `chunks: ${chunks.length}`);
    const pa = parser.doclingTrace && parser.doclingTrace.pageArtifacts;
    assert.ok(pa && pa.linesRemoved > 0 && pa.distinctKeys > 0 && pa.keptFirst > 0, `pageArtifacts ${JSON.stringify(pa)}`);
    assert.strictEqual(pa.pagesWithoutText, 0);
    // the kept first copy is page 1's heading too (A7: `[Page 1 - Document Generated: …]` heads page 1's chunks) — the BODY carries it once
    const bodyOf = (t) => t.replace(/^\[Page \d+[^\]]*\]\n/, "");
    const withBanner = chunks.filter((c) => /Document Generated:/.test(bodyOf(c.text)));
    assert.ok(withBanner.length === 1 && withBanner[0].page === 1, `the banner survives in exactly one chunk body, on page 1 (D3 b): ${withBanner.map((c) => c.page)}`);
    assert.ok(chunks.filter((c) => c.page > 1).every((c) => !/Document Generated:/.test(c.text)), "no chunk of any later page carries it, in the body or the header");
    assert.ok(chunks.every((c) => !/\r/.test(c.text)), "no \\r in any chunk (F-168)");
    assert.ok(chunks.every((c) => { const f = c.text.split("\n")[0]; return !/^\[Page /.test(f) || f.includes("]"); }), "no header spans lines (F-167)");
    for (const c of chunks) {
      const h = JSON.parse(c.metadata).sectionHeading;
      if (!h) continue;
      assert.ok(!/[.,;:]$/.test(h) && !/^[a-z(\[]/.test(h) && (h.match(/[A-Za-z]/g) || []).length >= 4 && !/\n/.test(h), `a heading-shaped heading: ${JSON.stringify(h)}`);
    }
  });
});


// T45 (t45-design.md §2.3, D1 a, D5 a, D6 a, D7, D11, D13): the tile-edge rule's wiring — the bridge's textBoxes through
// detailGeometry into mergeTiles, the three counts on the trace / the ledger / the route's records / the views / the
// span / the state probe, the chunk's metadata — source pins in the style of the T33 / T34 blocks, and the wording
// helpers run. The rule itself is U-DETAIL/T45's; the product's page-1 chunk is I-DETAIL/T45's.
describe("U-PARSE/T45 (t45-design §2.3): the tile-edge rule is wired before the merge; its counts travel everywhere the conflicts do", () => {
  const parserSrc = () => fs.readFileSync(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "parser.js"), "utf-8");
  const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf-8");

  test("the parser: detailGeometry(tilesInfo) feeds mergeTiles after the tile loop and before the F-142 empty check; the counts are tallied after the conflicts; the trace and the chunk metadata carry them; no model is asked (no adjudicate stage, no crop render, no new setting)", () => {
    const src = parserSrc();
    assert.match(src, /detailSubjectFor, detailGeometry, subsumeRanges, labelOrder \} = require\('\.\/detail_pass'\);/, "the pure module supplies the geometry helper (and T59's subsumeRanges)");
    const loop = src.slice(src.indexOf("const detail = { mode: detailMode,"), src.indexOf("this.detailSummary = detail;"));
    const lastAsk = loop.lastIndexOf("await askDetail(");
    const geometry = loop.indexOf("const geometry = detailGeometry(tilesInfo);");
    const merged = loop.indexOf('let merged = kind === "keyed-index" ? mergeTiles(replies, { key, ...geometry }) : null;');
    const empty = loop.indexOf("if (merged && merged.index.length === 0) {");
    assert.ok(lastAsk > 0 && geometry > lastAsk && merged > geometry && empty > merged, "after the last tile ask, before the merge, before the empty-index rule");
    assert.match(loop, /if \(merged\) detail\.conflicts \+= merged\.conflicts\.length;\s*(?:\/\/[^\n]*\s*)?if \(merged\) \{ detail\.edgeDropped \+= merged\.edgeDropped\.length; detail\.edgeSettled \+= merged\.edgeSettled\.length; detail\.multiValued \+= merged\.multiValued\.length; \}/, "the three counts beside the conflicts (the remaining disagreements)");
    assert.match(loop, /geometry: merged \? merged\.geometry : false, edgeDropped: merged \? merged\.edgeDropped\.length : 0, edgeSettled: merged \? merged\.edgeSettled\.slice\(\) : \[\], edgeLost: merged \? merged\.edgeLost\.slice\(\) : \[\], multiValued: merged \? merged\.multiValued\.length : 0,/, "the page's result carries the audit trail");
    assert.match(loop, /tile edge: \$\{merged\.edgeDropped\.length\} vote\(s\) dropped, \$\{merged\.edgeSettled\.length\} settled/, "the container log names the rule's work per page");
    assert.match(loop, /no geometry \(no text layer\)/, "…and says when the page had none");
    assert.ok(!/adjudicat|stage: "adjudicate"|adj_/.test(loop), "D1 a: no adjudicate stage, no crop render");
    assert.ok(!/this\.config\?\.(detailAdjudication|tileEdge|edgeRule)/.test(src), "D12: no new setting");
    const trace = src.slice(src.indexOf("picturesCaptured: (parsed.pictures || []).length,"), src.indexOf("markdownSample: (doclingPages[0]"));
    for (const k of ["detailEdgeDropped: this.detailSummary ? this.detailSummary.edgeDropped : 0,", "detailEdgeSettled: this.detailSummary ? this.detailSummary.edgeSettled : 0,", "detailMultiValued: this.detailSummary ? this.detailSummary.multiValued : 0,"]) assert.ok(trace.includes(k), `the trace records ${k}`);
    const append = src.slice(src.indexOf("if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {"), src.indexOf("return allChunks;", src.indexOf("if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {")));
    assert.match(append, /if \(Array\.isArray\(dr\.edgeSettled\) && dr\.edgeSettled\.length\) meta\.detailEdgeSettled = dr\.edgeSettled\.slice\(\);/, "D6 a: the settled labels are metadata, never chunk text");
    assert.match(append, /if \(dr\.multiValued\) meta\.detailMultiValued = dr\.multiValued;/);
    assert.ok(!/adjudicated/.test(read("src/lib/ingestion/detail_pass.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\`[^\`]*\`/g, "")), "D6 a: no '(adjudicated)' mark in any chunk text");
  });

  test("the counts travel: the route (the file result, the ledger record, every terminal record), the ledger's reducer, the views' suffix, the span's totals and wording, the state probe", () => {
    const route = read("src/app/api/ingest/route.js");
    for (const k of ["detailEdgeDropped", "detailEdgeSettled", "detailMultiValued"]) {
      assert.match(route, new RegExp(`fr\\.counts\\.${k} = fig\\("${k}"\\);`), `the file result carries ${k}`);
      assert.match(route, new RegExp(`${k}: fig\\("${k}"\\),`), `the ledger record's counts carry ${k}`);
      assert.match(route, new RegExp(`${k}: fr\\.counts\\.${k},`), `every terminal record carries ${k}`);
      assert.match(read("src/lib/rag/ledger.js"), new RegExp(`${k}: Number\\.isFinite\\(e\\.counts\\?\\.${k}\\) \\? e\\.counts\\.${k} : null,`), `the reducer reads ${k} (null on a pre-T45 record)`);
      assert.match(read("src/lib/ingestion/engines.js"), new RegExp(`${k}: sum\\("${k}"\\),`), `the span sums ${k}`);
    }
    const outcomes = require("../../src/lib/ingestion/outcomes.js");
    assert.deepStrictEqual(Object.keys(outcomes.newFileResult("x.pdf").counts).filter((k) => /^detail/.test(k)), ["detailPages", "detailTiles", "detailCalls", "detailFromMemo", "detailConflicts", "detailEdgeDropped", "detailEdgeSettled", "detailMultiValued", "detailColourChecked", "detailColourFlagged", "detailColourSettled", "detailColourAssociated", "detailColourFailed", "detailFailed", "detailNotTaken", "detailEmpty"], "the template's detail counts, the three after the conflicts");
    const f = { detailMode: "auto", detailReasons: ["p1 legend"], counts: { detailPages: 1, detailTiles: 4, detailCalls: 0, detailFromMemo: 5, detailConflicts: 8, detailEdgeDropped: 7, detailEdgeSettled: 2, detailMultiValued: 0, detailFailed: 0, detailNotTaken: 0, detailEmpty: 0 } };
    assert.strictEqual(outcomes.detailSuffix(f), " · detail passes: p1 legend — 4 tiles, 0 asked, 5 from memo, 10 conflicts found, 2 settled by the tile edge, 8 disclosed", "D11: found / settled / disclosed once the rule settled any");
    assert.strictEqual(outcomes.detailSuffix({ ...f, counts: { ...f.counts, detailConflicts: 0, detailEdgeDropped: 0, detailEdgeSettled: 0, detailMultiValued: 9 } }), " · detail passes: p1 legend — 4 tiles, 0 asked, 5 from memo, 0 conflicts, 9 multi-valued (one tile, two categories)", "Miele p68's shape: a same-tile multi-value named apart (F-188)");
    assert.strictEqual(outcomes.detailSuffix({ ...f, counts: { ...f.counts, detailConflicts: 3, detailEdgeDropped: undefined, detailEdgeSettled: undefined, detailMultiValued: undefined } }), " · detail passes: p1 legend — 4 tiles, 0 asked, 5 from memo, 3 conflicts", "a pre-T45 record reads as before");
    assert.strictEqual(outcomes.detailSuffix({ ...f, counts: { ...f.counts, detailConflicts: 1, detailEdgeSettled: 0 } }), " · detail passes: p1 legend — 4 tiles, 0 asked, 5 from memo, 1 conflict", "nothing settled: the T33 wording, singular");
    const { buildVlmSpanModel } = require("../../src/lib/ingestion/engines");
    const entry = (over) => ({ fileName: "a.pdf", picturesCaptured: 7, vlmCaptionsGenerated: 7, vlmDecorative: 0, vlmTimedOut: 0, vlmFailed: 0, captioning: "on", vlmModel: "m", detailTiles: 4, detailCalls: 0, detailFromMemo: 5, detailFailed: 0, ...over });
    // Summed over two records (the Site Plan's shape and Miele's) — the totals reach the wording.
    const span = buildVlmSpanModel([entry({ detailPages: 1, detailConflicts: 8, detailEdgeDropped: 7, detailEdgeSettled: 2, detailMultiValued: 0, detailPagesList: "1" }), entry({ fileName: "b.pdf", detailPages: 1, detailConflicts: 0, detailEdgeDropped: 0, detailEdgeSettled: 0, detailMultiValued: 9, detailPagesList: "68" })]);
    assert.match(span.description, /2 page\(s\) — a\.pdf p1; b\.pdf p68; 8 tile\(s\), 0 asked of the server, 10 recalled from the caption memo, 10 conflict\(s\) found, 2 settled by the tile edge, 8 disclosed, 9 multi-valued \(one tile, two categories\), 0 failed\./, "the VLM span's wording (D11), the counts summed");
    const before = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 7, vlmCaptionsGenerated: 7, vlmDecorative: 0, vlmTimedOut: 0, vlmFailed: 0, captioning: "on", vlmModel: "m", detailPages: 1, detailTiles: 4, detailCalls: 0, detailFromMemo: 5, detailConflicts: 3, detailFailed: 0, detailPagesList: "1" }]);
    assert.match(before.description, /5 recalled from the caption memo, 3 conflict\(s\) disclosed, 0 failed\./, "a pre-T45 record: the T33 wording");
    const probe = read("tests/eval/baselines/t22-artifacts/probe_state.js");
    assert.match(probe, /edgeDropped: f\.detailEdgeDropped \?\? null, edgeSettled: f\.detailEdgeSettled \?\? null, multiValued: f\.detailMultiValued \?\? null/);
  });

  test("the bridge's --tiles reply carries textBoxes on the PDF path (the text layer word by word, top-left points), None on the picture path; a failure to read them never fails the page; the tiles' bytes untouched (source pins)", () => {
    const bridge = read("src/lib/ingestion/docling_bridge.py");
    assert.match(bridge, /def text_word_boxes\(page\):/);
    assert.match(bridge, /boxes = \[tp\.get_charbox\(k\) for k in range\(i, j\)\]/, "the union of pypdfium2's character boxes");
    assert.match(bridge, /"x0": round\(l, 3\), "y0": round\(h - tt, 3\), "x1": round\(r, 3\), "y1": round\(h - bt, 3\)/, "points from the page's TOP-left (PDF y flipped)");
    assert.match(bridge, /try:\s*text_boxes = text_word_boxes\(page\)\s*except Exception as tb_err:[\s\S]*?text_boxes = \[\]/, "a failure leaves the page without geometry, never without tiles");
    assert.match(bridge, /"tiles": tiles, "textBoxes": text_boxes\}\)/, "the PDF path's reply");
    assert.match(bridge, /"tiles": tiles, "textBoxes": None\}\)/, "the picture path's reply: no PDF page, no boxes");
    assert.match(bridge, /page\.render\(scale=scale, crop=t\["crop"\]\)\.to_pil\(\)/, "the tiles are rendered exactly as before (every memo key stands)");
  });
});

// T57 (t57-design.md §2.1–§2.4, D1–D9; F-215): the disclose-only colour check — wired after the tile merge and the F-142
// empty check, only for a keyed-index page of a PDF whose KEY names a colour and whose page has a text layer; the bridge's
// --colours mode reads the page's colour layer; a failed read never fails the page; the counts travel as T45's do.
describe("U-PARSE/T57 (t57-design §2.1–§2.4): the colour check is wired after the tile merge, only where it can act; a failed read merges as before; its counts travel everywhere the tile-edge counts do", () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf-8");
  const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("the parser: the pure module is required; the layer is asked for only on a keyed-index merge of a pypdfium2 PDF page whose KEY names a colour and whose tiles reply carried words; the bridge's --colours mode at the page; the checked merge replaces the tile merge; a failure is counted, named, logged — never a failed page, never a skipped chunk", () => {
    const src = code("src/lib/ingestion/parser.js");
    assert.match(src, /const \{ colourCheck, keyNamesColour, associationSettle \} = require\('\.\/colour_check'\);/);
    const loop = src.slice(src.indexOf("const detail = { mode: detailMode,"), src.indexOf("this.detailSummary = detail;"));
    assert.match(loop, /if \(merged && tileFromPdf && keyNamesColour\(key\) && Array\.isArray\(geometry\.textBoxes\) && geometry\.textBoxes\.length > 0\) \{/, "the guard: a keyed merge, a PDF page, a colour key, a text layer");
    assert.match(loop, /await execAsync\(`"\$\{pythonBin\}" "\$\{bridgeScript\}" "\$\{this\.filePath\}" --colours \$\{pic\.page\}`, \{ maxBuffer: 20 \* 1024 \* 1024, timeout: 120000 \}\);/, "the bridge's own mode, the tiles' buffer and timeout");
    assert.match(loop, /colour = colourCheck\(merged, \{ key, layer \}\);/);
    assert.match(loop, /if \(colour\.audit\.ran\) \{\s*association = associationSettle\(colour\.merged, \{ key, layer \}\);\s*merged = association\.audit\.ran \? association\.merged : colour\.merged;/, "the checked merge — then T61's three-cue settle on it — flows into every later line (the text, the counts, the page's result)");
    const failure = loop.slice(loop.indexOf("} catch (err) {", loop.indexOf("--colours")), loop.indexOf("const colourAudit ="));
    assert.match(failure, /detail\.colourFailed\+\+;\s*detail\.colourFailedPages\.push\(pic\.page\);/);
    assert.match(failure, /the page merges as before T57/);
    assert.ok(!/failPage\(|continue;/.test(failure), "a failed read never fails the page nor drops its chunk");
    assert.ok(loop.indexOf("--colours") > loop.indexOf("if (merged && merged.index.length === 0) {") && loop.indexOf("--colours") < loop.indexOf("const text = detailChunkText("), "after the empty check, before the chunk text");
    assert.match(loop, /colour: colourAudit,/, "the page's result carries the audit");
    assert.match(loop, /colour check: \$\{colourAudit\.swatches\} swatch\(es\), \$\{colourAudit\.checked\} label\(s\) checked, \$\{colourAudit\.flagged\.length\} disclosed/, "the container log names the check's work per page");
    assert.ok(!/stage: "colour"|askDetail\([^)]*colour|askChain\([^)]*colour/.test(loop), "no model is asked (D9)");
    const trace = src.slice(src.indexOf("picturesCaptured: (parsed.pictures || []).length,"), src.indexOf("markdownSample: (doclingPages[0]"));
    for (const k of ["detailColourChecked: this.detailSummary ? this.detailSummary.colourChecked : 0,", "detailColourFlagged: this.detailSummary ? this.detailSummary.colourFlagged : 0,", "detailColourSettled: this.detailSummary ? this.detailSummary.colourSettled : 0,", "detailColourFailed: this.detailSummary ? this.detailSummary.colourFailed : 0,", 'detailColourFailedPages: this.detailSummary ? detailPagesList(this.detailSummary.colourFailedPages) : "",']) assert.ok(trace.includes(k), `the trace records ${k}`);
    const append = src.slice(src.indexOf("if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {"), src.indexOf("return allChunks;", src.indexOf("if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {")));
    assert.match(append, /if \(dr\.colour && dr\.colour\.flagged\.length\) meta\.detailColourFlagged = dr\.colour\.flagged\.slice\(\);/, "D7 a: the disclosed labels are metadata");
    assert.match(append, /if \(dr\.colour && dr\.colour\.settled\.length\) meta\.detailColourSettled = dr\.colour\.settled\.slice\(\);/);
    assert.ok(!/this\.config\?\.(colourCheck|colourRadius|colourGuard)/.test(src), "no new setting — the check is part of the detail pass");
  });

  test("the counts travel: the route (the file result, the ledger record, every terminal record, the named failed pages), the ledger's reducer, the span's totals, the state probe", () => {
    const route = read("src/app/api/ingest/route.js");
    for (const k of ["detailColourChecked", "detailColourFlagged", "detailColourSettled", "detailColourFailed"]) {
      assert.match(route, new RegExp(`fr\\.counts\\.${k} = fig\\("${k}"\\);`), `the file result carries ${k}`);
      assert.match(route, new RegExp(`${k}: fig\\("${k}"\\),`), `the ledger record's counts carry ${k}`);
      assert.match(route, new RegExp(`${k}: fr\\.counts\\.${k},`), `every terminal record carries ${k}`);
      assert.match(read("src/lib/rag/ledger.js"), new RegExp(`${k}: Number\\.isFinite\\(e\\.counts\\?\\.${k}\\) \\? e\\.counts\\.${k} : null,`), `the reducer reads ${k} (null on a pre-T57 record)`);
      assert.match(read("src/lib/ingestion/engines.js"), new RegExp(`${k}: sum\\("${k}"\\),`), `the span sums ${k}`);
    }
    assert.match(route, /fr\.detailColourFailedPages = typeof trace\?\.detailColourFailedPages === "string" \? trace\.detailColourFailedPages : null;/);
    assert.match(route, /detailColourFailedPages: fr\.detailColourFailedPages,/);
    assert.match(read("src/lib/rag/ledger.js"), /detailColourFailedPages: typeof e\.detailColourFailedPages === "string" \? e\.detailColourFailedPages : null,/);
    assert.match(read("tests/eval/baselines/t22-artifacts/probe_state.js"), /colourChecked: f\.detailColourChecked \?\? null, colourFlagged: f\.detailColourFlagged \?\? null, colourSettled: f\.detailColourSettled \?\? null, colourAssociated: f\.detailColourAssociated \?\? null, colourFailed: f\.detailColourFailed \?\? null/);
  });

  test("the views' wording: the Site Plan's page 1 — the tile conflicts found (the ones left plus those the tile edge and the colour settled), the readings the colour contradicts, the conflicts disclosed; a failed layer named; a record without the colour counts reads exactly as before", () => {
    const outcomes = require("../../src/lib/ingestion/outcomes.js");
    const f = { detailMode: "auto", detailReasons: ["p1 legend"], counts: { detailPages: 1, detailTiles: 4, detailCalls: 0, detailFromMemo: 5, detailConflicts: 24, detailEdgeDropped: 7, detailEdgeSettled: 2, detailMultiValued: 0, detailColourChecked: 128, detailColourFlagged: 20, detailColourSettled: 4, detailColourFailed: 0, detailFailed: 0, detailNotTaken: 0, detailEmpty: 0 } };
    assert.strictEqual(outcomes.detailSuffix(f), " · detail passes: p1 legend — 4 tiles, 0 asked, 5 from memo, 10 conflicts found, 2 settled by the tile edge, 4 settled by the page's colour, 20 readings the page's colour contradicts, 24 disclosed");
    assert.strictEqual(outcomes.detailSuffix({ ...f, counts: { ...f.counts, detailConflicts: 8, detailColourChecked: 0, detailColourFlagged: 0, detailColourSettled: 0 } }), " · detail passes: p1 legend — 4 tiles, 0 asked, 5 from memo, 10 conflicts found, 2 settled by the tile edge, 8 disclosed", "no colour work: T45's wording, byte for byte");
    assert.strictEqual(outcomes.detailSuffix({ ...f, detailColourFailedPages: "1", counts: { ...f.counts, detailConflicts: 8, detailColourChecked: 0, detailColourFlagged: 0, detailColourSettled: 0, detailColourFailed: 1 } }), " · detail passes: p1 legend — 4 tiles, 0 asked, 5 from memo, 10 conflicts found, 2 settled by the tile edge, 8 disclosed, the colour layer not read on 1 page (p1)");
    const { buildVlmSpanModel } = require("../../src/lib/ingestion/engines");
    const span = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 7, vlmCaptionsGenerated: 7, vlmDecorative: 0, vlmTimedOut: 0, vlmFailed: 0, captioning: "on", vlmModel: "m", detailPages: 1, detailTiles: 4, detailCalls: 0, detailFromMemo: 5, detailConflicts: 24, detailEdgeDropped: 7, detailEdgeSettled: 2, detailMultiValued: 0, detailColourChecked: 128, detailColourFlagged: 20, detailColourSettled: 4, detailColourFailed: 0, detailFailed: 0, detailPagesList: "1" }]);
    assert.match(span.description, /5 recalled from the caption memo, 10 conflict\(s\) found, 2 settled by the tile edge, 4 settled by the page's colour, 20 reading\(s\) the page's colour contradicts, 24 disclosed, 0 failed\./);
  });

  test("the bridge: the --colours mode is its own branch (every other path byte-identical); it imports colour_layer only there and hands it the tiles mode's own text_word_boxes; a non-PDF is an error, never a throw; colour_layer.py writes nothing and names its caps", () => {
    const bridge = read("src/lib/ingestion/docling_bridge.py");
    assert.match(bridge, /if "--colours" in argv:[\s\S]*?print\(read_colours\(positional\[0\], page\)\)\s*sys\.exit\(0\)/);
    assert.match(bridge, /def read_colours\(doc_path, page_no\):[\s\S]*?import colour_layer[\s\S]*?layer = colour_layer\.read_layer\(page, text_word_boxes\)[\s\S]*?"mode": "colours"/);
    assert.match(bridge, /return json\.dumps\(\{"error": "the colour layer reads a PDF page only"\}\)/);
    assert.strictEqual((bridge.match(/import colour_layer/g) || []).length, 1, "imported in the colour mode only");
    const layer = read("src/lib/ingestion/colour_layer.py");
    assert.ok(!/\.save\(|open\([^)]*["']w/.test(layer), "no file is written");
    assert.match(layer, /SCALE = 3\.5/);
    assert.match(layer, /MARGIN_PT = 3\.0/);
    assert.match(layer, /TOL = 12/);
    assert.match(layer, /MAX_FILLS = 64/);
    assert.match(layer, /MAX_PATHS = 20000/);
    assert.match(layer, /if len\(sizes\) != len\(words\):\s*raise ValueError/, "the sizes never guess an alignment");
  });
});

// T59 (t59-design.md §2.1, §2.2; D2 a, D3 a): a label a wider range of its category already names leaves the index — on the
// FINAL merge, after the colour check and before the chunk text — and the labels it subsumed travel as metadata, never as
// text; the colour check places a printed range itself (colour_check.js — U-COLOUR). Source pins in the T57 block's style.
describe("U-PARSE/T59 (t59-design §2.1): subsumeRanges runs on the final merge, after the colour check and before the chunk text; its audit is metadata", () => {
  const code = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  test("the parser: required from the pure module; `if (merged) merged = subsumeRanges(merged);` after the colour check, before the audit and the chunk text; the page's result and the chunk's metadata carry the labels; the container log names them; no model is asked", () => {
    const src = code("src/lib/ingestion/parser.js");
    const loop = src.slice(src.indexOf("const detail = { mode: detailMode,"), src.indexOf("this.detailSummary = detail;"));
    const at = loop.indexOf("if (merged) merged = subsumeRanges(merged);");
    assert.ok(at > 0, "the seam");
    assert.ok(at > loop.indexOf("merged = colour.merged;") && at < loop.indexOf("const colourAudit =") && at < loop.indexOf("const text = detailChunkText("), "after the colour check, before the audit and the text");
    assert.strictEqual(loop.split("subsumeRanges(").length - 1, 1, "once");
    assert.match(loop, /rangeSubsumed: merged && Array\.isArray\(merged\.rangeSubsumed\) \? merged\.rangeSubsumed\.map\(\(x\) => x\.label\) : \[\],/, "the page's result carries the labels");
    assert.match(loop, /range label\(s\) subsumed \(\$\{merged\.rangeSubsumed\.map\(\(x\) => `\$\{x\.label\} by \$\{x\.by\}`\)\.join\(", "\)\}\)/, "the container log names each label and its range");
    const append = src.slice(src.indexOf("if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {"), src.indexOf("return allChunks;", src.indexOf("if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {")));
    assert.match(append, /if \(Array\.isArray\(dr\.rangeSubsumed\) && dr\.rangeSubsumed\.length\) meta\.detailRangeSubsumed = dr\.rangeSubsumed\.slice\(\);/, "metadata, never text");
    assert.ok(!/stage: "range"|askDetail\([^)]*range/.test(loop), "no model is asked");
  });
});

// T47 (t47-design.md §2.2, §2.3; D1 a, D2, D3, D4, D8): the text-layer label reconciliation at the parser's ONE caption seam,
// its count and list on the trace / the route's records / the ledger / the views / the span / the state probe, the chunk's
// metadata — source pins in the style of the T33 / T45 blocks, and the wording helpers run. The rule itself is
// U-RECONCILE's; the product's seven substitutions are the ticket leg's (t47-artifacts/ticket_leg.js, at T46's roll).
describe("U-PARSE/T47 (t47-design §2.2, §2.3): the reconciliation at the one caption seam; its count and list travel everywhere the caption counts do", () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf-8");

  test("the parser: reconcileCaption at `pic.caption = result.caption` for a page with a text layer (T18's fact), the page's stripped text as the lexicon, the list on the picture and the chunk's metadata, the container log line, the trace's count and list; a page without a text layer keeps the reply; nothing after the seam reads the raw reply; no new setting", () => {
    const src = read("src/lib/ingestion/parser.js");
    assert.match(src, /const \{ reconcileCaption \} = require\('\.\/reconcile_labels'\);/, "the pure module");
    assert.match(src, /const pageTextOf = \(pic\) => \{ const p = \(Array\.isArray\(doclingPages\) \? doclingPages : \[\]\)\.find\(\(x\) => x && \(x\.page \|\| 1\) === pic\.page\); return p \? String\(p\.markdown \|\| ""\) : ""; \};/, "the page's stripped text (T18) is the lexicon");
    const seam = src.slice(src.indexOf('if (result.outcome === "captioned") {'), src.indexOf('} else if (result.outcome === "decorative") vlmCounts.decorative++;'));
    assert.match(seam, /if \(textLayerOf\(pic\)\) \{\s*const reconciled = reconcileCaption\(result\.caption, pageTextOf\(pic\)\);\s*pic\.caption = reconciled\.caption;\s*pic\.captionSubstitutions = reconciled\.substitutions;/, "the one seam, a memo hit and a model reply alike");
    assert.match(seam, /\} else pic\.caption = result\.caption;/, "no text layer: the reply as it is (D2)");
    assert.match(seam, /captionSubstitutionsList\.push\(\{ page: pic\.page, figureId: pic\.id, from: s\.from, to: s\.to, edits: s\.edits \}\)/, "the list names the page, the figure, the words, the edits");
    assert.match(seam, /\[VLM Caption\] \$\{this\.fileName\} p\$\{pic\.page\}: \$\{reconciled\.substitutions\.length\} label\(s\) reconciled with the text layer — /, "the container log names them on the page's line");
    assert.ok(seam.indexOf("vlmCaptionsCount++;") < seam.indexOf("reconcileCaption("), "counted as captioned before the rule — the rule never changes a verdict");
    const trace = src.slice(src.indexOf("picturesCaptured: (parsed.pictures || []).length,"), src.indexOf("markdownSample: (doclingPages[0]"));
    assert.match(trace, /captionSubstitutions,\s*captionSubstitutionsList: captionSubstitutionsList\.slice\(\),/, "the trace carries the count and the list");
    assert.match(src, /if \(Array\.isArray\(pic\.captionSubstitutions\) && pic\.captionSubstitutions\.length > 0\) meta\.captionSubstitutions = pic\.captionSubstitutions\.map\(\(s\) => \(\{ from: s\.from, to: s\.to, edits: s\.edits \}\)\);/, "the caption chunk's metadata lists them (the text already carries the page's spelling)");
    const after = src.slice(src.indexOf('} else if (result.outcome === "decorative") vlmCounts.decorative++;'));
    assert.ok(!/result\.caption\b/.test(after), "nothing after the seam reads the raw reply — the title, the detail plan, the chunk text and the humanTitle read pic.caption");
    assert.ok(!/this\.config\?\.(reconcile|labelReconciliation|captionReconcile)/.test(src), "D8: no new setting");
    assert.ok(!/memo\.(set|put|write)\([^)]*reconciled/.test(src), "D3: the memo stays raw");
  });

  test("the count travels: the route (the file result, the ledger record's counts and its list, every terminal record), the ledger's reducer (count and list), the span's per-file record, sum and wording, the views' figure suffix, the template, the state probe", () => {
    const route = read("src/app/api/ingest/route.js");
    assert.match(route, /fr\.counts\.captionSubstitutions = fig\("captionSubstitutions"\);/, "the file result carries the count");
    assert.match(route, /fr\.captionSubstitutionsList = Array\.isArray\(trace\?\.captionSubstitutionsList\) \? trace\.captionSubstitutionsList : null;/, "…and the list");
    assert.match(route, /captionSubstitutions: fig\("captionSubstitutions"\),/, "the ledger record's counts carry it");
    assert.match(route, /captionSubstitutionsList: fr\.captionSubstitutionsList,/, "the ledger record names the substitutions");
    assert.match(route, /captionSubstitutions: fr\.counts\.captionSubstitutions,/, "every terminal record carries it");
    const ledger = read("src/lib/rag/ledger.js");
    assert.match(ledger, /captionSubstitutions: Number\.isFinite\(e\.counts\?\.captionSubstitutions\) \? e\.counts\.captionSubstitutions : null,/, "the reducer reads the count (null on a pre-T47 record)");
    assert.match(ledger, /captionSubstitutionsList: Array\.isArray\(e\.captionSubstitutionsList\) \? e\.captionSubstitutionsList : null,/, "…and the list");
    const engines = read("src/lib/ingestion/engines.js");
    assert.match(engines, /captionSubstitutions: Number\.isFinite\(f\.captionSubstitutions\) \? f\.captionSubstitutions : null,/, "the span's per-file record");
    assert.match(engines, /captionSubstitutions: sum\("captionSubstitutions"\),/, "the span sums it");
    const outcomes = require("../../src/lib/ingestion/outcomes.js");
    assert.strictEqual(outcomes.newFileResult("x.pdf").counts.captionSubstitutions, null, "the template's count (null until the parse said)");
    const fileResult = (counts) => { const r = { ...outcomes.newFileResult("x.pdf"), status: "indexed" }; r.counts = { ...r.counts, figuresCaptured: 7, figuresCaptioned: 7, figuresFromMemo: 7, ...counts }; return r; };
    assert.match(outcomes.figureSuffix(fileResult({ captionSubstitutions: 3 })), /7\/7 figures \(7 from memo, 3 labels reconciled with the text layer\)/, "the views' suffix names them");
    assert.match(outcomes.figureSuffix(fileResult({ captionSubstitutions: 1 })), /1 label reconciled with the text layer/, "singular");
    assert.match(outcomes.figureSuffix(fileResult({})), /7\/7 figures \(7 from memo\)/, "a pre-T47 record (null) reads as before");
    assert.ok(!/reconciled/.test(outcomes.figureSuffix(fileResult({ captionSubstitutions: 0 }))), "none reconciled: nothing new");
    const { buildVlmSpanModel } = require("../../src/lib/ingestion/engines");
    const entry = (over) => ({ fileName: "a.pdf", picturesCaptured: 7, vlmCaptionsGenerated: 7, vlmDecorative: 0, vlmTimedOut: 0, vlmFailed: 0, captioning: "on", vlmModel: "m", vlmFromMemo: 7, vlmCalls: 0, ...over });
    assert.match(buildVlmSpanModel([entry({ captionSubstitutions: 3 }), entry({ fileName: "b.pdf", captionSubstitutions: 1 })]).description, /4 label\(s\) reconciled with the text layer/, "the VLM span's wording, the counts summed");
    assert.ok(!/reconciled/.test(buildVlmSpanModel([entry({})]).description), "a pre-T47 record: the span says nothing new");
    assert.match(read("tests/eval/baselines/t22-artifacts/probe_state.js"), /captionSubstitutions: f\.captionSubstitutions \?\? null, captionSubstitutionsList: f\.captionSubstitutionsList \?\? null,/, "the state probe per document");
  });
});

describe("U-PARSE/T46 (t46-design §2.1–§2.5, D5, D6 a, D9, D14 a, D15, D16): the chain pass after the detail passes; its counts and lists travel everywhere the detail counts do", () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf-8");
  const src = read("src/lib/ingestion/parser.js");
  const pass = src.slice(src.indexOf("// T46 (design §2.1, D1 a, D4 a, D8, D9, D14 a, D15, D16; F-174): the CHAIN PASS"), src.indexOf("this.chainSummary = chainStats;"));

  test("the parser: the pure module required; the pass AFTER the detail loop and before the reset's trace; the admission on the (reconciled) caption; the memo first — a reset only when the chain key misses; askChain on the page render with a `chain` hint; a failed ask named, the caption kept", () => {
    assert.match(src, /const dimensionChain = require\('\.\/dimension_chain'\);/);
    assert.ok(pass.length > 0 && src.indexOf("this.detailSummary = detail;") > src.indexOf("this.chainSummary = chainStats;") && src.indexOf("this.chainSummary = chainStats;") > src.indexOf("this.detailResults.push({"), "after the detail passes, inside the captioning branch");
    assert.match(pass, /if \(pic\.captionOutcome !== "captioned" \|\| typeof pic\.caption !== "string"\) continue;\s*const admit = dimensionChain\.chainAdmits\(pic\.caption\);\s*if \(!admit\.admitted\) continue;/);
    assert.match(pass, /if \(bytes && chainWillMiss\(bytes\)\) await resetOnce\(\);/, "the one reset per document, only when a chain key misses");
    assert.match(pass, /const r = await askChain\(pic\.abs_path, \{ \.\.\.vlmOptions, memo, memoIdentity, jobId: this\.ingestJobId \|\| null, label: `\$\{label\} \(chain\)`, hint: \{ fileName: this\.fileName, docHash: this\.docHash, page: pic\.page, figureId: pic\.id, stage: "chain" \} \}\);/);
    assert.match(pass, /\[VLM Chain failed\] \$\{label\}: the chain pass ended \$\{r\.outcome\}[\s\S]*?; the page keeps its caption/);
    assert.match(src, /this\.chainSummary = null;/, "declared where the trace reads it");
  });

  test("the geometry (D14 a, D15, §12d): recalled from the chain record when it holds this module's read of this document's page at the pinned setting, else the bridge's --geometry at CHAIN_GEOMETRY's scale and two inks, written INTO the chain record (no memo entry of its own); a failure keeps the chain as read, counted", () => {
    assert.match(src, /function geometryModuleMd5\(\) \{\s*try \{ return crypto\.createHash\('md5'\)\.update\(fs\.readFileSync\(path\.join\(process\.cwd\(\), 'src', 'lib', 'ingestion', 'dimension_geometry\.py'\)\)\)\.digest\('hex'\); \} catch \(err\) \{ return null; \}/);
    assert.match(pass, /held\.version === geometryVersion && held\.docHash === this\.docHash && held\.page === pic\.page && held\.scale === G\.scale && JSON\.stringify\(held\.inks\) === JSON\.stringify\(\[G\.ink, G\.checkInk\]\)/);
    assert.match(pass, /--geometry \$\{pic\.page\}:\$\{G\.scale\}:\$\{G\.ink\},\$\{G\.checkInk\}/);
    assert.match(pass, /const w = memo\.put\(\{ \.\.\.record, geometry \}\);/, "the read rides inside the chain reply's record");
    assert.ok(!/openCaptionMemo\(|makeRecord\(/.test(pass), "no memo record of its own");
    assert.match(pass, /chainStats\.geometryFailed\+\+;/);
    assert.match(pass, /\[VLM Chain geometry failed\] \$\{label\}: .*; the chain stays as the captioner read it/);
  });

  test("the chain (D2 a, D14 a, D16): NO_DIMENSIONS leaves the caption and is counted; otherwise settled by both inks, solved, the block written; the counts; the per-line record on the picture; the log names every settled line", () => {
    assert.match(pass, /if \(dimensionChain\.isNoDimensions\(r\.reply\)\) \{\s*chainStats\.noDimensions\+\+;\s*pic\.chain = \{ admitted: admit\.reason, outcome: "noDimensions", source: r\.source, geometry: geometrySource, replaces: false, block: null \};/);
    assert.match(pass, /const settlement = dimensionChain\.settleChain\(r\.reply, geometry \? \{ primary: geometry\.readings\[String\(G\.ink\)\], check: geometry\.readings\[String\(G\.checkInk\)\] \} : null\);\s*const solved = dimensionChain\.pointsFromChain\(settlement\.reply\);\s*const block = dimensionChain\.chainBlockText\(\{ reply: settlement\.reply, solved \}\);\s*const replaces = dimensionChain\.chainReplacesDescription\(solved\);/);
    for (const k of ["lines += parsedChain.chainLines", "unclear += parsedChain.unclear", "pointsDerived += solved.derived", "pointsNotDerivable += solved.notDerivable.length", "confirmed += settlement.confirmed", "settled += settlement.settled"]) assert.ok(pass.includes(`chainStats.${k};`), k);
    assert.match(pass, /settled from the drawing's geometry — \$\{bare\(l\.from\)\} → \$\{bare\(l\.to\)\} read as \$\{bare\(l\.settledFrom\)\} → \$\{bare\(l\.settledEnd\)\}/, "D16's log line");
  });

  test("the chunk (D6 a, D7): a chain page's caption chunk text has the block as its DESCRIPTION (replaceDescription) and its metadata the chain's record without the block; the header and the humanTitle read the caption's own TITLE", () => {
    assert.match(src, /const captionText = pic\.chain && pic\.chain\.replaces && pic\.chain\.block \? dimensionChain\.replaceDescription\(pic\.caption, pic\.chain\.block\) : pic\.caption;/);
    assert.match(src, /text: `\[HUMAN-LOGICAL VISUAL ELEMENT: \$\{displayLabel\} \| Section: \$\{pageTitle\} \(Page \$\{pic\.page\}\)\]:\\n\$\{captionText\}`,/);
    assert.match(src, /if \(pic\.chain\) \{ const \{ block, \.\.\.chainMeta \} = pic\.chain; meta\.chain = chainMeta; \}/);
    assert.match(src, /const humanTitleMatch = capStr\.match\(\/\^\(\?:HUMAN \)\?TITLE:\\s\*\(\.\+\)\$\/im\);/, "the title from the caption, unchanged");
  });

  test("the travel: the trace (chainTraceOf); the route's file result, file_parsed and every terminal record (CHAIN_COUNT_KEYS); the ledger's reducer; the span's totals and sentence; the views' suffix; the state probe; the orchestrator's clause under rule 5; the bridge's --geometry branch", () => {
    const trace = src.slice(src.indexOf("picturesCaptured: (parsed.pictures || []).length,"), src.indexOf("markdownSample: (doclingPages[0]"));
    assert.match(trace, /captionSubstitutionsList: captionSubstitutionsList\.slice\(\),\s*(?:\/\/[^\n]*\s*)?\.\.\.dimensionChain\.chainTraceOf\(this\.chainSummary\),/);
    const route = read("src/app/api/ingest/route.js");
    assert.match(route, /import \{ CHAIN_COUNT_KEYS \} from "@\/lib\/ingestion\/dimension_chain";/);
    assert.match(route, /for \(const k of CHAIN_COUNT_KEYS\) fr\.counts\[k\] = fig\(k\);/);
    assert.match(route, /\.\.\.Object\.fromEntries\(CHAIN_COUNT_KEYS\.map\(\(k\) => \[k, fig\(k\)\]\)\),/, "file_parsed's counts");
    assert.match(route, /\.\.\.Object\.fromEntries\(CHAIN_COUNT_KEYS\.map\(\(k\) => \[k, fr\.counts\[k\]\]\)\),/, "every terminal record");
    for (const k of ["chainPagesList", "chainFailedPages", "chainBlockPages", "chainSettledList"]) assert.ok(route.includes(`${k}: fr.${k},`), `file_parsed names ${k}`);
    const ledger = read("src/lib/rag/ledger.js");
    assert.match(ledger, /\.\.\.Object\.fromEntries\(CHAIN_COUNT_KEYS\.map\(\(k\) => \[k, Number\.isFinite\(e\.counts\?\.\[k\]\) \? e\.counts\[k\] : null\]\)\),/);
    assert.match(ledger, /chainSettledList: Array\.isArray\(e\.chainSettledList\) \? e\.chainSettledList : null,/);
    const engines = read("src/lib/ingestion/engines.js");
    assert.match(engines, /\$\{detailPassWording\(outcomes\)\}\$\{chainPassWording\(outcomes\)\}\$\{ocrPassWording\(outcomes\)\}/);
    assert.match(read("tests/eval/baselines/t22-artifacts/probe_state.js"), /chain: Number\.isFinite\(f\.chainPages\) \? \{ pages: f\.chainPages, pagesList: f\.chainPagesList,/);
    const orch = read("src/lib/orchestrator.js");
    assert.match(orch, /import \{ CHAIN_BLOCK_RULE \} from "@\/lib\/ingestion\/dimension_chain";/);
    assert.match(orch, /Only list levels that contain actual components\/rooms in the document data\.\n\$\{CHAIN_BLOCK_RULE\}\n6\. COMPLETE MULTI-ENTITY COVERAGE/, "D5: one clause, under rule 5, on every grounded non-count turn");
    const bridge = read("src/lib/ingestion/docling_bridge.py");
    assert.match(bridge, /if "--geometry" in argv:/);
    assert.match(bridge, /import dimension_geometry/);
    assert.ok(bridge.indexOf('if "--geometry" in argv:') < bridge.indexOf('if "--page-count" in argv:'), "its own branch, before the other modes");
  });

  test("the views and the span say it: the chain suffix on the file's line and the span's sentence — named only when a page was admitted (a pre-T46 record reads as before)", () => {
    const outcomes = require("../../src/lib/ingestion/outcomes");
    const engines = require("../../src/lib/ingestion/engines");
    const f = { status: "indexed", chainPagesList: "25, 39, 43", chainBlockPages: "25", chainFailedPages: "", counts: { figuresCaptured: 90, figuresCaptioned: 80, chainPages: 3, chainCalls: 3, chainFromMemo: 0, chainNoDimensions: 0, chainSettled: 1, chainBlocks: 1, chainFailed: 0, chainGeometryFailed: 0 } };
    assert.strictEqual(outcomes.chainSuffix(f), " · drawing chains: 3 pages (p25, p39, p43) — 3 asked, 0 from memo, 1 line settled by the drawing's geometry, 1 caption carrying the chain (p25)");
    assert.ok(outcomes.figureSuffix(f).endsWith(outcomes.chainSuffix(f)));
    assert.strictEqual(outcomes.chainSuffix({ ...f, counts: { ...f.counts, chainPages: 0 } }), "");
    assert.strictEqual(outcomes.chainSuffix({ status: "indexed", counts: { figuresCaptured: 1 } }), "", "a pre-T46 record");
    assert.strictEqual(engines.chainPassWording({ chainPages: 7, chainPageLists: [{ fileName: "Fervi.pdf", pages: 3, pagesList: "25, 39, 43" }], chainCalls: 7, chainFromMemo: 0, chainNoDimensions: 1, chainSettled: 1, chainBlocks: 6, chainFailed: 0, chainGeometryFailed: 0 }), " Drawing chains: 7 page(s) — Fervi.pdf p25, p39, p43; 7 asked of the server, 0 recalled from the caption memo, 1 with no dimension, 1 line(s) settled by the drawing's geometry, 6 caption(s) carrying the chain, 0 failed.");
    assert.strictEqual(engines.chainPassWording({ chainPages: null }), "");
  });
});

// T61 (t61-design.md §2, D1 a, D4 a; F-215's residue): the three-cue settle — run on the colour check's merge before the
// merge is replaced (a failure merges as before T57); the audit kept as the chunk stands (a disclosure the cues resolved
// leaves the disclosed list, a disagreement they resolved joins the colour's settled ones, the readings they wrote are
// `associated`), so the views' found = disclosed − flagged + settled holds; the new count travels as T57's do.
describe("U-PARSE/T61 (t61-design §2): the three-cue settle is wired on the checked merge; its readings are counted, recorded as metadata and named in the views", () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf-8");
  const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("the parser: the settle runs on the checked merge and replaces the merge only after both steps succeeded; a failure clears it; the audit as the chunk stands; the counts, the trace, the metadata and the container log", () => {
    const src = code("src/lib/ingestion/parser.js");
    assert.match(src, /labelOrder \} = require\('\.\/detail_pass'\);/);
    const loop = src.slice(src.indexOf("const detail = { mode: detailMode,"), src.indexOf("this.detailSummary = detail;"));
    assert.match(loop, /colourAssociated: 0, colourFailed: 0,/);
    assert.match(loop, /association = associationSettle\(colour\.merged, \{ key, layer \}\);\s*merged = association\.audit\.ran \? association\.merged : colour\.merged;/, "both steps, then the merge");
    assert.match(loop, /colour = null;\s*association = null;\s*detail\.colourFailed\+\+;/, "a failure: neither step's merge, counted as T57's");
    assert.ok(loop.indexOf("associationSettle(") > loop.indexOf("colourCheck(merged") && loop.indexOf("associationSettle(") < loop.indexOf("merged = subsumeRanges(merged)") && loop.indexOf("merged = subsumeRanges(merged)") < loop.indexOf("const text = detailChunkText("), "the check, the three cues, the range rule, the chunk text");
    assert.match(loop, /const threeCue = association && association\.audit\.ran \? association\.audit\.settled : \[\];/);
    assert.match(loop, /flagged: colour\.audit\.flagged\.filter\(\(l\) => !byWas\("colour"\)\.includes\(l\)\), settled: colour\.audit\.settled\.concat\(byWas\("tiles"\)\)\.sort\(labelOrder\), associated: byWas\("plain"\)\.concat\(byWas\("colour"\)\)\.sort\(labelOrder\), left: colour\.audit\.left\.filter\(\(l\) => !byWas\("tiles"\)\.includes\(l\)\),/, "the audit as the chunk stands");
    assert.match(loop, /if \(colourAudit && colourAudit\.ran\) \{\s*detail\.colourChecked \+= colourAudit\.checked;\s*detail\.colourFlagged \+= colourAudit\.flagged\.length;\s*detail\.colourSettled \+= colourAudit\.settled\.length;\s*detail\.colourAssociated \+= colourAudit\.associated\.length;\s*\}/);
    assert.match(loop, /\$\{colourAudit\.associated\.length\} settled by three cues/, "the container log names the settle's work");
    assert.ok(!/stage: "association"|askDetail\([^)]*associat/.test(loop), "no model is asked");
    const trace = src.slice(src.indexOf("picturesCaptured: (parsed.pictures || []).length,"), src.indexOf("markdownSample: (doclingPages[0]"));
    assert.ok(trace.includes("detailColourAssociated: this.detailSummary ? this.detailSummary.colourAssociated : 0,"));
    const append = src.slice(src.indexOf("if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {"), src.indexOf("return allChunks;", src.indexOf("if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {")));
    assert.match(append, /if \(dr\.colour && Array\.isArray\(dr\.colour\.associated\) && dr\.colour\.associated\.length\) meta\.detailColourAssociated = dr\.colour\.associated\.slice\(\);/, "metadata, never text");
    assert.ok(!/this\.config\?\.(association|threeCue)/.test(src), "no new setting — part of the detail pass");
  });

  test("the count travels: the route (the file result, the ledger record, every terminal record), the ledger's reducer, the span's per-document and summed totals, the state probe", () => {
    const route = read("src/app/api/ingest/route.js");
    const k = "detailColourAssociated";
    assert.match(route, new RegExp(`fr\\.counts\\.${k} = fig\\("${k}"\\);`));
    assert.match(route, new RegExp(`${k}: fig\\("${k}"\\),`));
    assert.match(route, new RegExp(`${k}: fr\\.counts\\.${k},`));
    assert.match(read("src/lib/rag/ledger.js"), new RegExp(`${k}: Number\\.isFinite\\(e\\.counts\\?\\.${k}\\) \\? e\\.counts\\.${k} : null,`), "null on a pre-T61 record");
    const engines = read("src/lib/ingestion/engines.js");
    assert.match(engines, new RegExp(`${k}: Number\\.isFinite\\(f\\.${k}\\) \\? f\\.${k} : null,`));
    assert.match(engines, new RegExp(`${k}: sum\\("${k}"\\),`));
    assert.match(read("tests/eval/baselines/t22-artifacts/probe_state.js"), /colourAssociated: f\.detailColourAssociated \?\? null/);
  });

  test("the views' wording: the Site Plan's page 1 after T61 — 10 tile conflicts found (3 left + 2 by the tile edge + 5 by the page's colour), 11 readings the colour contradicts still disclosed, 12 settled by three cues, 14 disclosed; a record without the count reads exactly as before", () => {
    const outcomes = require("../../src/lib/ingestion/outcomes.js");
    const f = { detailMode: "auto", detailReasons: ["p1 legend"], counts: { detailPages: 1, detailTiles: 4, detailCalls: 0, detailFromMemo: 5, detailConflicts: 14, detailEdgeDropped: 7, detailEdgeSettled: 2, detailMultiValued: 0, detailColourChecked: 130, detailColourFlagged: 11, detailColourSettled: 5, detailColourAssociated: 12, detailColourFailed: 0, detailFailed: 0, detailNotTaken: 0, detailEmpty: 0 } };
    assert.strictEqual(outcomes.detailSuffix(f), " · detail passes: p1 legend — 4 tiles, 0 asked, 5 from memo, 10 conflicts found, 2 settled by the tile edge, 5 settled by the page's colour, 11 readings the page's colour contradicts, 12 readings settled by three cues on the page, 14 disclosed");
    assert.strictEqual(outcomes.detailSuffix({ ...f, counts: { ...f.counts, detailColourAssociated: 1 } }).includes("1 reading settled by three cues on the page"), true, "singular");
    const t57 = { ...f, counts: { ...f.counts, detailConflicts: 24, detailColourFlagged: 20, detailColourSettled: 4, detailColourAssociated: undefined } };
    assert.strictEqual(outcomes.detailSuffix(t57), " · detail passes: p1 legend — 4 tiles, 0 asked, 5 from memo, 10 conflicts found, 2 settled by the tile edge, 4 settled by the page's colour, 20 readings the page's colour contradicts, 24 disclosed", "a T57-era record reads exactly as before");
    assert.deepStrictEqual(Object.keys(outcomes.newFileResult("x.pdf").counts).filter((key) => /^detailColour/.test(key)), ["detailColourChecked", "detailColourFlagged", "detailColourSettled", "detailColourAssociated", "detailColourFailed"]);
    const { buildVlmSpanModel } = require("../../src/lib/ingestion/engines");
    const span = buildVlmSpanModel([{ fileName: "a.pdf", picturesCaptured: 7, vlmCaptionsGenerated: 7, vlmDecorative: 0, vlmTimedOut: 0, vlmFailed: 0, captioning: "on", vlmModel: "m", detailPages: 1, detailTiles: 4, detailCalls: 0, detailFromMemo: 5, detailConflicts: 14, detailEdgeDropped: 7, detailEdgeSettled: 2, detailMultiValued: 0, detailColourChecked: 130, detailColourFlagged: 11, detailColourSettled: 5, detailColourAssociated: 12, detailColourFailed: 0, detailFailed: 0, detailPagesList: "1" }]);
    assert.match(span.description, /5 recalled from the caption memo, 10 conflict\(s\) found, 2 settled by the tile edge, 5 settled by the page's colour, 11 reading\(s\) the page's colour contradicts, 12 reading\(s\) settled by three cues on the page, 14 disclosed, 0 failed\./);
  });
});
