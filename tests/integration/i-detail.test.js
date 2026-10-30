/**
 * I-DETAIL — the tiled detail passes, live (ticket T33; design §4 (1), D1–D8).
 * Runs in-pod against Ollama and Weaviate.
 *
 *  1. THE SITE PLAN into a fresh `RAGEval_*V2` class (schemaVersion 2 stated,
 *     the harness shape, `detailPasses` left at its default `auto`): the
 *     job completes; the ledger's file_parsed says the detail passes fired on
 *     every one of the seven captioned pages (the map by its colour-coded
 *     legend, the floor plans by their key/legend — the trigger over the
 *     caption's admissions, D1), 28 tiles, every request recalled or asked,
 *     no page failed (a failed pass never fails the file, D7); the store
 *     holds EXACTLY ONE detail chunk on page 1 — an isVisualElement chunk on
 *     the page's render, `metadata.detail`, kind keyed-index — whose INDEX
 *     carries `302 | The Denby …`, `304 | …`, `313 | …` and whose COUNTS line
 *     reads `The Denby 3 bedroom home: 3` (the charter's ground truth), and
 *     no other Denby plot; the conflicts are DISCLOSED, never resolved (D4).
 *  2. A SECOND fresh class from the same bytes: every detail reply recalled
 *     from the memo (`detailCalls 0`, D8), no reset, and the detail chunks
 *     byte-identical to the first class's (text and page).
 *  Teardown: both classes deleted through the schema API; the tile files
 *  the suite ADDED to the Site Plan's crop folder (production's — F-95)
 *  removed, and only those: the files present before the suite are listed
 *  first and asserted present after. The memo's records stay (harness
 *  ingests leave records by design, T29 D8): the chain's later legs recall
 *  them.
 * Skipped unless RAG_EVAL_WEAVIATE_URL and RAG_EVAL_EMBED_URL are set. About
 * fifteen minutes the first time (seven pages × five requests), a minute
 * once the memo holds the replies.
 */
const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { envConfig, skipReason, makeRunCollection, postJson, waitForIngestion, assertEvalCollection } = require("./_harness");
const cap = require("../../src/lib/ingestion/vlm_captioner.js");
const d = require("../../src/lib/ingestion/detail_pass.js");
const ledger = require("../../src/lib/rag/ledger");

const SKIP = skipReason();
const config = envConfig();
const APP_ROOT = process.cwd();
const CROPS = path.join(APP_ROOT, "public", "extracted_images");
const OLLAMA = process.env.RAG_EVAL_VLM_URL || "http://ollama.ollama.svc.cluster.local:11434";
const VLM_MODEL = process.env.RAG_EVAL_VLM_MODEL || cap.DEFAULT_CAPTION_MODEL;
const SITEPLAN = "demos/demo_files/ext_reg_docs/Barratt_Homes_SitePlan.pdf";
// The key names the legend entry as the captioner reads it — the bold name alone ("The Denby") on the live pass, the
// whole row ("The Denby 3 bedroom home") on the design probe; the acceptance is on the plots and the count, not the spelling.
const DENBY = "The Denby(?: 3 bedroom home)?";
const TRUTH = ["302", "304", "313"];

const classes = config ? { a: makeRunCollection("t33detailA"), b: makeRunCollection("t33detailB") } : null;
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
const docHash = md5(fs.readFileSync(path.join(APP_ROOT, "public", SITEPLAN)));
const folder = path.join(CROPS, docHash);
const tileFilesNow = () => (fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => /^detail_\d+_(whole|r\d+c\d+)\.png$/.test(f)).sort() : []);
const folderFilesNow = () => (fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []);
let filesBefore = null;
let tilesBefore = null;

function ingestBody(collection, filePaths, ragExtra = {}) {
  return {
    filePaths,
    weaviateUrl: config.weaviateUrl,
    token: config.token,
    weaviateToken: config.token,
    embedUrl: config.embedUrl,
    embedModel: config.embedModel,
    schemaVersion: 2,
    weaviateCollection: collection,
    vlmModelName: VLM_MODEL,
    vlmEndpointUrl: OLLAMA,
    vlmApiKey: "",
    ragSettings: { weaviateCollection: collection, allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"], maxFileSize: 50, duplicatePolicy: "skip", ...ragExtra },
  };
}

async function ingest(collection, filePaths, ragExtra) {
  const started = await postJson(`${config.appUrl}/api/ingest`, ingestBody(collection, filePaths, ragExtra));
  assert.equal(started.status, 202, `ingest into ${collection} refused: ${started.text}`);
  return waitForIngestion(config.appUrl, started.json.jobId, 2400000);
}

async function gql(query) {
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  const res = await fetch(`${config.weaviateUrl}/v1/graphql`, { method: "POST", headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(120000) });
  const j = await res.json();
  if (j.errors) assert.fail(`graphql: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.data;
}

/** Every object of a class: the detail chunks marked, keyed for comparison. */
async function objects(base) {
  const cls = `${base}V2`;
  let all = [], afterId = null;
  for (;;) {
    const cursor = afterId ? `, after: "${afterId}"` : "";
    const data = await gql(`{ Get { ${cls}(limit: 200${cursor}) { text source page chunkIndex docVersion imagePath isVisualElement metadata _additional { id } } } }`);
    const rows = data.Get[cls] || [];
    all.push(...rows);
    if (rows.length < 200) break;
    afterId = rows[rows.length - 1]._additional.id;
  }
  return all.map((o) => {
    let meta = {}; try { meta = JSON.parse(o.metadata || "{}"); } catch (e) {}
    const visual = o.isVisualElement === true || meta.isVisualElement === true;
    const detail = meta.detail === true;
    return { key: `${o.source}|${o.page}|${detail ? "detail" : visual ? "caption" : "text"}|${visual ? meta.figureId : o.chunkIndex}`, visual, detail, meta, text: o.text || "", textMd5: md5(o.text || ""), page: o.page, chunkIndex: o.chunkIndex, imagePath: o.imagePath, docVersion: o.docVersion };
  });
}

async function deleteClass(base) {
  assertEvalCollection(base);
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  await fetch(`${config.weaviateUrl}/v1/schema/${base}V2`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) }).catch(() => {});
}

const parsedOf = (base) => ledger.readEvents(ledger.defaultLedgerPath()).events.filter((e) => e.collection === `${base}V2` && e.event === "file_parsed");
const section = (text, name) => { const m = text.match(new RegExp(`^${name}:\\s*$([\\s\\S]*?)(?=^(?:KEY|INDEX|COUNTS|UNKNOWN|CONFLICTS|MULTI-VALUED|TILES NOT READ):|$(?![\\s\\S]))`, "m")); return m ? m[1].trim().split("\n") : []; };

if (config) {
  after(async () => {
    for (const base of Object.values(classes)) await deleteClass(base);
    // F-95: remove ONLY the tile files this suite added to production's crop folder; every pre-existing file stays.
    if (tilesBefore !== null) {
      const added = tileFilesNow().filter((f) => !tilesBefore.includes(f));
      for (const f of added) fs.rmSync(path.join(folder, f), { force: true });
      const missing = filesBefore.filter((f) => !folderFilesNow().includes(f));
      assert.deepStrictEqual(missing, [], `the crop folder's pre-existing files are untouched by this suite (F-95): ${missing.join(", ")}`);
    }
  });
}

describe("I-DETAIL 1: the Site Plan's map page gets ONE detail chunk that indexes the Denby's plots (design D1–D5, D7)", () => {
  test("seven pages fire under auto (28 tiles, five requests a page), no page failed, the file indexed; page 1's detail chunk carries 302 / 304 / 313 under the Denby and `The Denby 3 bedroom home: 3`", { skip: SKIP }, async (t) => {
    assert.ok(fs.existsSync(folder), `the Site Plan's production crop folder is expected at ${folder} (the D4 re-caption rendered it)`);
    filesBefore = folderFilesNow();
    tilesBefore = tileFilesNow();
    t.diagnostic(`crop folder ${docHash}: ${filesBefore.length} file(s) before, ${tilesBefore.length} tile file(s) already present`);
    const identity = await cap.resolveCaptionServer({ ollamaUrl: OLLAMA, modelName: VLM_MODEL, label: "i-detail" });
    assert.strictEqual(identity.ok, true, `the server's identity (digest) must be readable for the memo to apply: ${identity.error || ""}`);

    const a = await ingest(classes.a, [SITEPLAN]);
    assert.strictEqual(a.status, "completed", JSON.stringify(a).slice(0, 400));
    const fr = (a.fileResults || [])[0];
    assert.strictEqual(fr.status, "indexed", "a detail pass never makes a file partial (D7)");
    const pa = parsedOf(classes.a);
    assert.strictEqual(pa.length, 1);
    const c = pa[0].counts;
    assert.strictEqual(c.figuresCaptioned, 7, "the Site Plan's seven pages are captioned (recalled from the memo)");
    assert.deepStrictEqual({ mode: pa[0].detailMode, pages: c.detailPages, tiles: c.detailTiles, failed: c.detailFailed, notTaken: c.detailNotTaken, list: pa[0].detailPagesList }, { mode: "auto", pages: 7, tiles: 28, failed: 0, notTaken: 0, list: "1, 2, 3, 4, 5, 6, 7" }, "every captioned page admits a legend / key (t33-design §0c): all seven fire");
    assert.deepStrictEqual(pa[0].detailReasons, ["p1 legend", "p2 legend", "p3 legend", "p4 legend", "p5 legend", "p6 legend", "p7 legend"]);
    assert.strictEqual(c.detailCalls + c.detailFromMemo, 35, "every request — a KEY pass and four tiles a page — was recalled or asked");
    assert.strictEqual(pa[0].detailFailedPages, "");
    assert.ok(Number.isFinite(c.detailConflicts), "the conflicts are counted");
    assert.deepStrictEqual({ pages: fr.counts.detailPages, calls: fr.counts.detailCalls + fr.counts.detailFromMemo, mode: fr.detailMode, list: fr.detailPagesList }, { pages: 7, calls: 35, mode: "auto", list: "1, 2, 3, 4, 5, 6, 7" }, "the status frame carries the detail counts");
    assert.ok(Array.isArray(fr.detailReasons) && fr.detailReasons.length === 7);
    if (c.detailCalls > 0) assert.strictEqual(pa[0].captionReset, true, "a request was made: the one reset per document preceded it (D8)");
    else assert.strictEqual(pa[0].captionReset, null, "everything recalled: no reset");
    assert.deepStrictEqual(tileFilesNow().filter((f) => /^detail_1_/.test(f)), ["detail_1_r0c0.png", "detail_1_r0c1.png", "detail_1_r1c0.png", "detail_1_r1c1.png", "detail_1_whole.png"], "the page's five tile files sit beside its render, under new names");
    assert.ok(fs.existsSync(path.join(folder, "fig_1_0.png")), "the page render itself is untouched (every caption key stands)");

    const A = await objects(classes.a);
    const details = A.filter((o) => o.detail);
    // T34 (F-142, riding by the owner's D9): five floor plans' tiles list only the room key's own rows — an empty index
    // after the legend-echo drop — so they emit NO chunk and are counted `detailEmpty`; page 1 (the map) and page 4 (six
    // labels — t33-design §11a A16) emit one each.
    assert.strictEqual(details.length, 2, `two detail chunks — page 1's and page 4's; the five empty-index floor plans emit none (F-142): ${details.map((o) => o.key).join(", ")}`);
    assert.deepStrictEqual({ empty: c.detailEmpty, emptyPages: pa[0].detailEmptyPages, chunks: c.detailChunks }, { empty: 5, emptyPages: "2, 3, 5, 6, 7", chunks: 2 }, "the five are counted and named on the ledger (T34 A6, A15)");
    assert.deepStrictEqual({ empty: fr.counts.detailEmpty, emptyPages: fr.detailEmptyPages }, { empty: 5, emptyPages: "2, 3, 5, 6, 7" }, "and on the status frame");
    const p1 = details.filter((o) => o.page === 1);
    assert.strictEqual(p1.length, 1, "EXACTLY one detail chunk on page 1");
    const chunk = p1[0];
    assert.deepStrictEqual({ visual: chunk.visual, kind: chunk.meta.detailKind, reason: chunk.meta.detailReason, figureId: chunk.meta.figureId, image: chunk.imagePath }, { visual: true, kind: "keyed-index", reason: "legend", figureId: "detail_1", image: `/extracted_images/${docHash}/fig_1_0.png` }, "an isVisualElement chunk on the PAGE's render, marked detail (D5)");
    assert.match(chunk.text, /^\[VISUAL DETAIL: .+ \| Section: .+ \(Page 1\)\]:\n/, "the caption chunk's header shape");
    const key = section(chunk.text, "KEY"), index = section(chunk.text, "INDEX"), counts = section(chunk.text, "COUNTS");
    t.diagnostic(`page 1 detail: ${key.length} key entries, ${index.length} index lines, ${counts.length} count lines, conflicts ${chunk.meta.detailConflicts}, chars ${chunk.text.length}`);
    assert.ok(key.some((l) => new RegExp(`^dark red \\| ${DENBY}$`).test(l)), `the KEY names the Denby with its colour: ${key.join(" / ").slice(0, 300)}`);
    const denbyLabels = index.filter((l) => new RegExp(`^\\S+ \\| ${DENBY}$`).test(l)).map((l) => l.split(" | ")[0]);
    assert.deepStrictEqual(denbyLabels, TRUTH, "the INDEX carries the Denby's three plots and no other (the charter's hand-read truth)");
    for (const plot of TRUTH) assert.ok(!index.some((l) => l.startsWith(`${plot} | `) && / or /.test(l)), `plot ${plot} is not a conflict`);
    const denbyCount = counts.find((l) => new RegExp(`^${DENBY}: `).test(l));
    assert.ok(denbyCount, `a COUNTS line for the Denby: ${counts.join(" / ").slice(0, 300)}`);
    // T58 (F-219): the page carries conflicts, so each COUNTS row reads "n confirmed"; no conflict names the Denby, so its row
    // names no possible plot.
    assert.match(denbyCount, new RegExp(`^${DENBY}: 3 confirmed \\(302, 304, 313\\)$`), "the count the acceptance reads (FQ06's counts check)");
    assert.match(chunk.text, /^CONFLICTS: \d+/m, "the conflicts are disclosed, whatever their number (D4)");
    const denbyKey = Object.keys(chunk.meta.detailCounts).find((k) => new RegExp(`^${DENBY}$`).test(k));
    assert.strictEqual(chunk.meta.detailCounts[denbyKey], 3, "the counts travel as metadata too");
    assert.ok(!index.some((l) => /^(The [A-Z][a-z]+|Cycle Store|Bin Store|Visitor Parking Space|Bin Collection Point|CS|BS|V|BCP) \| /.test(l)), "no legend row echoed into the INDEX (§11a A15)");
    // T57 (t57-design D7 a): a reading the page's colour contradicts is a conflict too, with its own tail.
    const conflictLines = index.filter((l) => / \((?:read differently by two tiles|the colour at the label matches [^)]*)\)$/.test(l));
    assert.strictEqual(conflictLines.length, chunk.meta.detailConflicts, "every conflict is in the INDEX as both readings");
    const numeric = index.map((l) => l.split(" | ")[0]).filter((l) => /^\d+$/.test(l)).map(Number);
    assert.ok(numeric.length >= 100 && numeric.every((n) => n >= 172 && n <= 330), `the plots indexed are the map's (172–330): ${numeric.length} numeric labels`);
    // The other pages: a detail chunk each, on their own render, never on page 1.
    for (const o of details.filter((x) => x.page !== 1)) {
      assert.strictEqual(o.imagePath, `/extracted_images/${docHash}/fig_${o.page}_0.png`);
      assert.ok(["keyed-index", "transcribe"].includes(o.meta.detailKind), `${o.key}: a kind`);
      assert.match(o.text, new RegExp(`\\(Page ${o.page}\\)\\]:\\n`));
    }
    assert.strictEqual(A.filter((o) => o.visual && !o.detail).length, 7, "the seven caption chunks are still there, one per page");
    const captionP1 = A.find((o) => o.visual && !o.detail && o.page === 1);
    assert.ok(captionP1 && !/VISUAL DETAIL/.test(captionP1.text), "the caption chunk is byte-for-byte a caption (the detail is its own chunk, D5)");
    assert.ok(details.every((o) => o.docVersion === captionP1.docVersion), "one document version");
    assert.ok(details.every((o) => Number.isInteger(o.chunkIndex) && o.chunkIndex > Math.max(...A.filter((x) => !x.detail).map((x) => x.chunkIndex))), "the detail chunks are appended after every text and caption chunk");
  });
});

describe("I-DETAIL 2: a second ingest recalls every detail reply and reproduces the chunks byte for byte (design D8)", () => {
  test("detailCalls 0, detailFromMemo 35, no reset; the detail chunks identical in text and page", { skip: SKIP }, async (t) => {
    const b = await ingest(classes.b, [SITEPLAN]);
    assert.strictEqual(b.status, "completed", JSON.stringify(b).slice(0, 400));
    const pb = parsedOf(classes.b);
    assert.strictEqual(pb.length, 1);
    const c = pb[0].counts;
    assert.deepStrictEqual({ pages: c.detailPages, calls: c.detailCalls, fromMemo: c.detailFromMemo, failed: c.detailFailed, captions: c.vlmCalls, reset: pb[0].captionReset, memo: pb[0].captionMemo }, { pages: 7, calls: 0, fromMemo: 35, failed: 0, captions: 0, reset: null, memo: "all" }, "everything recalled: no request, no reset, the model never loaded");
    const A = await objects(classes.a), B = await objects(classes.b);
    const dA = A.filter((o) => o.detail).map((o) => `${o.page}|${o.meta.figureId}|${o.textMd5}`).sort();
    const dB = B.filter((o) => o.detail).map((o) => `${o.page}|${o.meta.figureId}|${o.textMd5}`).sort();
    assert.deepStrictEqual(dB, dA, "the detail chunks are byte-identical across the two ingests");
    assert.deepStrictEqual(B.map((o) => `${o.key}|${o.textMd5}`).sort(), A.map((o) => `${o.key}|${o.textMd5}`).sort(), "and so is every other chunk");
    t.diagnostic(`B: detailFromMemo ${c.detailFromMemo}, vlmDurationMs ${pb[0].vlmDurationMs}; ${dB.length} detail chunk(s) identical`);
  });
});

// T45 (t45-design.md §4 item 1 / D3 a, D5 a, D6 a, D7; §2.3): the tile-edge rule through the PRODUCT on the same first
// class — the bridge's textBoxes reach mergeTiles, the page-1 chunk carries 301 / 303 as plain Halton entries that count,
// the eight genuine disagreements stay disclosed, the ledger and the status frame carry the rule's counts, and the second
// class (every reply recalled, detailCalls 0) reproduces it byte for byte (the rule is deterministic: the text layer and
// arithmetic, no decode).
describe("I-DETAIL/T45 (t45-design §2.2, §2.3): the tile edge settles the two false alarms through the product — 301 | The Halton, 303 | The Halton, the Halton 8; CONFLICTS 14 since T61 (3 tile disagreements left + 11 colour disclosures — T61's three cues resolved 296 and ten disclosures; 25 under T59–T60); the ledger's detailEdgeSettled 2 on both classes", () => {
  test("the page-1 chunk's INDEX / COUNTS / CONFLICTS lines as the design predicts; the metadata's detailEdgeSettled; the ledger's and the frame's counts; class B identical with detailCalls 0", { skip: SKIP }, async (t) => {
    const A = await objects(classes.a);
    const chunk = A.find((o) => o.detail && o.page === 1);
    assert.ok(chunk, "page 1's detail chunk (I-DETAIL 1 ran)");
    const index = section(chunk.text, "INDEX"), counts = section(chunk.text, "COUNTS");
    const conflicts = chunk.text.split("\n").find((l) => l.startsWith("CONFLICTS: "));
    t.diagnostic(`page 1: ${index.length} index lines; ${conflicts}; detailEdgeSettled ${JSON.stringify(chunk.meta.detailEdgeSettled)}; detailConflicts ${chunk.meta.detailConflicts}`);
    assert.ok(index.includes("301 | The Halton") && index.includes("303 | The Halton"), "the two FS-2 false alarms are plain Halton entries (D6 a)");
    assert.ok(!index.some((l) => /^(301|303) \|.* or /.test(l)), "neither is a conflict line");
    assert.ok(!/adjudicat|tile edge|settled/i.test(chunk.text), "no mark in the chunk text (D6 a)");
    assert.ok(counts.includes("The Halton: 8 confirmed (281, 282, 283, 284, 301, 303, 312, 314)"), `the Halton counts 8 (D7; T58's row): ${counts.find((l) => /^The Halton/.test(l))}`);
    assert.ok(counts.some((l) => /^The Denby(?: 3 bedroom home)?: 3 confirmed \(302, 304, 313\)$/.test(l)), "the Denby's 3 unchanged (T58's row)");
    // T57 (t57-design §0e): of T45's eight genuine disagreements the page's colour settles four (201, 202, 204, 289); the
    // other four stay disclosed in T45's words, beside the twenty colour disclosures (I-DETAIL/T57 reads those).
    // T61 (t61-design §0f): the three cues resolve 296 to the Kingsville; 198, 267 and 268 stay disclosed.
    for (const l of ["198 | The Radleigh or The Ellerton (read differently by two tiles)", "267 | The Kingsville or The Hesketh (read differently by two tiles)", "268 | The Kingsville or The Hesketh (read differently by two tiles)"]) assert.ok(index.includes(l), `still disclosed: ${l}`);
    assert.ok(index.includes("296 | The Kingsville"), "T61: 296 settled by the three cues — a plain entry");
    assert.match(conflicts, /^CONFLICTS: 14 — /, "the remaining disagreements and the colour disclosures, one line (T59: + the range 220 - 237; T61: 3 tile + 11 colour)");
    assert.ok(!/\b30[13]\b/.test(conflicts), "301 / 303 are gone from the disclosure");
    assert.ok(!/^MULTI-VALUED:/m.test(chunk.text), "no same-tile multi-value on this page");
    assert.deepStrictEqual(chunk.meta.detailEdgeSettled, ["301", "303"], "the audit trail is metadata");
    assert.strictEqual(chunk.meta.detailConflicts, 14, "T61: the conflicts the chunk discloses — 3 tile + 11 colour (220 - 237 among them)");
    assert.strictEqual(chunk.meta.detailMultiValued, undefined);
    assert.strictEqual(chunk.meta.humanTitle, "PHASE THREE – Site Plan and Home Exterior", "the lightbox caption (T49) unchanged");
    const pa = parsedOf(classes.a)[0];
    assert.strictEqual(pa.counts.detailEdgeSettled, 2, "the ledger: two conflicts settled by the tile edge on the document");
    assert.ok(pa.counts.detailEdgeDropped >= 7, `the ledger: at least the page's seven votes dropped (${pa.counts.detailEdgeDropped})`);
    assert.strictEqual(pa.counts.detailMultiValued, 0);
    assert.strictEqual(pa.counts.detailConflicts, 14, "the conflicts disclosed (T61: 3 tile + 11 colour; page 4 has none)");
    t.diagnostic(`ledger A: detailEdgeDropped ${pa.counts.detailEdgeDropped}, detailEdgeSettled ${pa.counts.detailEdgeSettled}, detailMultiValued ${pa.counts.detailMultiValued}, detailConflicts ${pa.counts.detailConflicts}`);
    const pb = parsedOf(classes.b)[0];
    assert.ok(pb, "class B's record (I-DETAIL 2 ran)");
    assert.deepStrictEqual({ calls: pb.counts.detailCalls, settled: pb.counts.detailEdgeSettled, dropped: pb.counts.detailEdgeDropped, conflicts: pb.counts.detailConflicts }, { calls: 0, settled: 2, dropped: pa.counts.detailEdgeDropped, conflicts: 14 }, "deterministic: the same counts with every reply recalled");
    const B = await objects(classes.b);
    const chunkB = B.find((o) => o.detail && o.page === 1);
    assert.strictEqual(chunkB.textMd5, chunk.textMd5, "the page-1 chunk byte-identical on the second class");
    assert.deepStrictEqual(chunkB.meta.detailEdgeSettled, ["301", "303"]);
  });
});

// T57 (t57-design.md §4 items 5–6, D1–D9): the disclose-only colour check through the PRODUCT on the same two classes —
// the bridge's --colours layer reaches colour_check.js, the page-1 chunk is the design's predicted text byte for byte
// (records/after57-p1-product.txt: 20 readings disclosed, 4 tile conflicts settled, the Denby 3, the Halton 8), the
// metadata and the ledger carry the check's counts, no model is asked, and class B (every reply recalled) reproduces it.
// T58 (t58-design.md §4 item 4; F-219): the page-1 chunk's COUNTS rows are T58's — records/after58-p1.txt, T57's text in every
// other line; the colour check's counts and metadata do not move.
// T59 (t59-design.md §4 item 4; F-222, F-218, F-225): the page-1 chunk is records/after59-p1.txt — the phantom 255 - 256
// subsumed (detailRangeSubsumed in the metadata), 220 - 237 disclosed by the colour check (flagged 21, checked 130), the
// rows naming their ranges.
// T60 (t60-design.md §4 item 4; F-228): the page-1 chunk is records/after60-p1.txt — T59's text with the LEGEND TEXT block
// after the COUNTS rows (the legend's own words from the colour layer, the groups added up) and the CONFLICTS line's range
// clause; the colour check's counts do not move.
// T61 (t61-design.md §4 item 2; F-215's residue): the page-1 chunk is records/after61-p1.txt — the three-cue settle writes 13
// readings (187 and 206 replaced; ten colour disclosures and 296's tile disagreement resolved): the disclosed list 21 → 11, the
// colour's settled list + 296, detailColourAssociated the twelve it wrote over the tiles' agreed reading or a disclosure.
describe("I-DETAIL/T57 (t57-design §2, §4): the colour check through the product — the page-1 chunk as predicted, byte for byte; 21 disclosed (T59: + 220 - 237), 4 settled; the ledger's counts; class B identical", () => {
  test("the page-1 chunk = after61-p1.txt (T61: the three-cue settle — 13 readings settled; T60: after59-p1.txt with the LEGEND TEXT block and the CONFLICTS line's range clause; T59: after58-p1.txt with the phantom subsumed, 220 - 237 disclosed, the rows naming their ranges); detailColourFlagged / detailColourSettled / detailColourAssociated / detailRangeSubsumed in the metadata; the ledger's detailColourChecked 130, Flagged 11, Settled 5, Associated 12, Failed 0; page 4 and every other page unchecked; class B byte-identical", { skip: SKIP }, async (t) => {
    const EXPECTED = fs.readFileSync(path.join(APP_ROOT, "tests", "eval", "baselines", "t61-artifacts", "records", "after61-p1.txt"), "utf8").replace(/\n$/, "");
    const A = await objects(classes.a);
    const chunk = A.find((o) => o.detail && o.page === 1);
    assert.ok(chunk, "page 1's detail chunk (I-DETAIL 1 ran)");
    t.diagnostic(`page 1: ${chunk.text.length} chars (expected ${EXPECTED.length}); detailColourFlagged ${JSON.stringify(chunk.meta.detailColourFlagged)}; detailColourSettled ${JSON.stringify(chunk.meta.detailColourSettled)}; detailColourAssociated ${JSON.stringify(chunk.meta.detailColourAssociated)}`);
    assert.strictEqual(chunk.text, EXPECTED, "the chunk the design predicted from the memo's replies and the Mac's colour layer");
    assert.deepStrictEqual(chunk.meta.detailColourFlagged, ["180", "218", "220 - 237", "240", "246", "249", "277", "280", "309", "311", "317"], "T61: the ten the three cues resolved leave the disclosed list");
    assert.deepStrictEqual(chunk.meta.detailColourAssociated, ["173", "176", "177", "182", "183", "184", "187", "206", "305", "310", "315", "316"], "T61: the readings the three-cue settle wrote — metadata, never text");
    assert.deepStrictEqual(chunk.meta.detailRangeSubsumed, ["255 - 256"], "T59 (F-218): the phantom subsumed — metadata, never text");
    assert.deepStrictEqual(chunk.meta.detailColourSettled, ["201", "202", "204", "289", "296"], "T61: 296's tile disagreement resolved by the three cues joins the colour's settled ones");
    for (const o of A.filter((x) => x.detail && x.page !== 1)) assert.ok(o.meta.detailColourFlagged === undefined && o.meta.detailColourSettled === undefined && o.meta.detailColourAssociated === undefined && o.meta.detailRangeSubsumed === undefined, `${o.key}: no colour or range work`);
    const pa = parsedOf(classes.a)[0];
    assert.deepStrictEqual({ checked: pa.counts.detailColourChecked, flagged: pa.counts.detailColourFlagged, settled: pa.counts.detailColourSettled, associated: pa.counts.detailColourAssociated, failed: pa.counts.detailColourFailed }, { checked: 130, flagged: 11, settled: 5, associated: 12, failed: 0 }, "the ledger's colour counts on the document");
    const pb = parsedOf(classes.b)[0];
    assert.deepStrictEqual({ calls: pb.counts.detailCalls, checked: pb.counts.detailColourChecked, flagged: pb.counts.detailColourFlagged, settled: pb.counts.detailColourSettled, associated: pb.counts.detailColourAssociated, failed: pb.counts.detailColourFailed }, { calls: 0, checked: 130, flagged: 11, settled: 5, associated: 12, failed: 0 }, "deterministic: the same with every reply recalled");
    const B = await objects(classes.b);
    assert.strictEqual(B.find((o) => o.detail && o.page === 1).textMd5, chunk.textMd5, "the page-1 chunk byte-identical on the second class");
  });
});
