/**
 * U-IDS — chunk identity is deterministic, complete and reproducible
 * (ticket T05; audit E08 / E25 / FM-D2; finding F-50).
 *
 * The identity module is pure, so every rule is pinned here without a store:
 *   - uuidv5 is RFC-4122 v5 (known vector, version and variant bits);
 *   - the same (sourceId, docVersion, chunkIndex) is the same id, and any
 *     one of the three changing changes it;
 *   - sourceId normalises every spelling of one path to one value and
 *     refuses an empty one (an identity built on "" would make every such
 *     document the same document);
 *   - docVersion changes when ANY fingerprinted setting changes and when
 *     IDENTITY_VERSION is bumped, and not otherwise (F-50 case 1: a config
 *     change must be a new version or a re-index is skipped).
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");

const ids = require("../../src/lib/rag/ids");
// T37 (design D1, D2): the page-shape settings name the captioner through the module's constant, so the pin moves with it.
const { DEFAULT_CAPTION_MODEL } = require("../../src/lib/ingestion/vlm_captioner");

const NS_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("U-IDS: uuidv5", () => {
  test("matches the RFC-4122 reference vector (DNS namespace, www.example.com)", () => {
    // python3: uuid.uuid5(uuid.NAMESPACE_DNS, "www.example.com")
    assert.strictEqual(ids.uuidv5(NS_DNS, "www.example.com"), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  test("sets the version nibble to 5 and the RFC variant bits", () => {
    for (const name of ["", "a", "a:b:0", "ünïcödé", "x".repeat(5000)]) {
      assert.match(ids.uuidv5(ids.NAMESPACE, name), UUID_RE, `name ${JSON.stringify(name.slice(0, 20))}`);
    }
  });

  test("is deterministic and distinguishes names", () => {
    assert.strictEqual(ids.uuidv5(ids.NAMESPACE, "a:b:0"), ids.uuidv5(ids.NAMESPACE, "a:b:0"));
    assert.notStrictEqual(ids.uuidv5(ids.NAMESPACE, "a:b:0"), ids.uuidv5(ids.NAMESPACE, "a:b:1"));
    assert.notStrictEqual(ids.uuidv5(ids.NAMESPACE, "a:b:0"), ids.uuidv5(NS_DNS, "a:b:0"));
  });

  test("refuses a non-UUID namespace and a non-string name", () => {
    assert.throws(() => ids.uuidv5("not-a-uuid", "x"), /namespace must be a UUID/);
    assert.throws(() => ids.uuidv5(ids.NAMESPACE, 42), /name must be a string/);
  });

  test("the chunk namespace is a fixed UUID literal (changing it re-keys every v2 collection)", () => {
    assert.strictEqual(ids.NAMESPACE, "1b4e28ba-2fa1-11d2-883f-b9a761bde3fb");
    assert.strictEqual(ids.uuidv5(ids.NAMESPACE, "a:b:0"), "a878bc25-d9b8-5e5b-8486-31d61ec86a5e");
  });
});

describe("U-IDS: sourceId", () => {
  test("normalises every spelling of one path to one sourceId", () => {
    const expected = "demos/demo_files/ext_reg_docs/SSX125_Manual.pdf";
    for (const spelling of [
      "demos/demo_files/ext_reg_docs/SSX125_Manual.pdf",
      "/demos/demo_files/ext_reg_docs/SSX125_Manual.pdf",
      "public/demos/demo_files/ext_reg_docs/SSX125_Manual.pdf",
      "/public/demos/demo_files/ext_reg_docs/SSX125_Manual.pdf",
      "demos\\demo_files\\ext_reg_docs\\SSX125_Manual.pdf",
      "./demos/demo_files/./ext_reg_docs/SSX125_Manual.pdf",
      "  demos/demo_files/ext_reg_docs/SSX125_Manual.pdf  ",
    ]) {
      assert.strictEqual(ids.sourceIdFor(spelling), expected, spelling);
    }
  });

  test("a rename or a move is a different sourceId (F-50 case 3)", () => {
    assert.notStrictEqual(ids.sourceIdFor("a/report.pdf"), ids.sourceIdFor("b/report.pdf"));
    assert.notStrictEqual(ids.sourceIdFor("a/report.pdf"), ids.sourceIdFor("a/report_v2.pdf"));
  });

  test("refuses an empty or non-string path", () => {
    for (const bad of ["", "   ", "/", "public/", null, undefined, 42]) {
      assert.throws(() => ids.sourceIdFor(bad), /file path is required|normalises to an empty path/, JSON.stringify(bad));
    }
  });
});

describe("U-IDS: docVersion and the fingerprint", () => {
  const settings = { chunkSize: 600, chunkOverlap: 80, minChunkSize: 150, vlmModelName: DEFAULT_CAPTION_MODEL };
  const HASH = "14fe0a24c9fb7a031f91a4b615d85df7";
  // The production corpus's page-shape fingerprint (600 / 80 / 150 + the default captioner): d0767e67555d under
  // IDENTITY_VERSION 1 (T05 → T31); 42ca5ed33c98 under IDENTITY_VERSION 2 with the VLM as the default (T32 → T36);
  // 9087fdb24b59 under IDENTITY_VERSION 2 with the chat model as the default (T37, design D4 — the VALUE of
  // vlmModelName moved, ids.js did not; the D4 re-caption of 2026-09-16 put every production document on it);
  // 65b740dc14dd under IDENTITY_VERSION 3 (T33, design D6 — a dense page's chunk set gains a detail chunk; the D11
  // re-ingest of 2026-09-16 put every production document on it); 42bb5ef65e46 under IDENTITY_VERSION 4 (T34, design
  // D3 / D9 — an unpaginated file's chunk text carries its section, F-142 / F-144 ride); dd257f24f95c under
  // IDENTITY_VERSION 5 (T35, design D2 / D6–D9 — a page without a text layer is read by OCR and gains text chunks,
  // its caption takes the with-text prompt, its transcribe plan is not taken). A change here is a re-index of every
  // document — deliberate, never incidental: the thirteen production docVersions (on .42bb5ef65e46 since D9) move
  // ONCE more, on the owner's T35 re-ingest (D12).
  // be2a00d66f36 under IDENTITY_VERSION 6 (T41, design D2–D8 — a piece under the minimum is folded, never dropped; a
  // markdown heading opens its paragraph and an oversize one is split; docling's markdown unescaped and marker-free; a
  // deck's chrome removed and its hidden slides skipped): every docVersion moves once more, on the owner's T41 re-ingest.
  // 384ec4e0e1c3 under IDENTITY_VERSION 7 (T18, design D2–D7 — the running lines a document repeats leave every PDF page
  // before the split, the heading pick changed on every paginated page, \r\n normalised): every docVersion moves once more,
  // on the owner's T18 re-ingest.
  // bfd9e449b930 under IDENTITY_VERSION 8 (T45, design D1 a / D5–D7 / D11 / D13 — the tile-edge rule before the tiled
  // merge: a conflicted page's INDEX / COUNTS / CONFLICTS lines change and a same-tile multi-value is named apart):
  // every docVersion moves once more, on the owner's T45 re-ingest (0 model calls — every caption and tile recalled).
  // 864cbc8489ad under IDENTITY_VERSION 9 (T46 + T47 + F-191, one window — a dimensioned drawing's caption carries its
  // chain block, a caption's labels take the text layer's spelling, a tile-edge drop needs a holder's read): every
  // docVersion moves once more, on the owner's v9 re-ingest (the seven chain asks the only model calls).
  // 852f45f6ef65 under IDENTITY_VERSION 10 (T57, design D1–D9 — the disclose-only colour check after the tiled merge: a
  // colour-keyed page's INDEX / COUNTS / CONFLICTS lines change): every docVersion moves once more, on the owner's v10
  // re-ingest (0 model calls — every caption and tile recalled; the check reads the PDF).
  // 0008a8c2d1f3 under IDENTITY_VERSION 11 (T58, design D1 a / D2 a — a keyed-index chunk with a conflict writes its COUNTS
  // rows as what the index supports: "n confirmed", "possibly also …"): every docVersion moves once more, on the owner's
  // v11 re-ingest (0 model calls — no reading, plot or conflict moves).
  // 0c708178f137 under IDENTITY_VERSION 12 (T59, design D1 a / D2 a / D3 a — a keyed-index chunk says what its range labels
  // are, a label a wider range names is subsumed, the colour check places a range the page prints): every docVersion moves
  // once more, on the owner's v12 re-ingest (0 model calls — one production chunk changes).
  // 94195d3aa6bb under IDENTITY_VERSION 13 (T60, design D1 a / D2 a — a keyed-index chunk adds up its COUNTS rows by the
  // text its legend prints with each name, and its CONFLICTS line says what its labels name when one is a range): every
  // docVersion moves once more, on the owner's v13 re-ingest (0 model calls — one production chunk changes).
  // a5d02a609ad9 under IDENTITY_VERSION 14 (T61, design D1 a — the colour check's three-cue settle: where the nearest
  // footprint, the nearest house and the footprint nearest the plot's bays name one design within 10 pt, the index states
  // it): every docVersion moves once more, on the owner's v14 re-ingest (0 model calls — one production chunk changes).
  const PRODUCTION_FINGERPRINT = "a5d02a609ad9";
  const T60_PAGE_FINGERPRINT = "94195d3aa6bb"; // T60 → the v13 re-ingest (2026-09-30): IDENTITY_VERSION 13 (history — production's recorded suffix until the v14 re-ingest)
  const T59_PAGE_FINGERPRINT = "0c708178f137"; // T59 → the v12 re-ingest (2026-09-29): IDENTITY_VERSION 12 (history — production's recorded suffix until the v13 re-ingest)
  const T58_PAGE_FINGERPRINT = "0008a8c2d1f3"; // T58 → the v11 re-ingest (2026-09-29): IDENTITY_VERSION 11 (history — production's recorded suffix until the v12 re-ingest)
  const T57_PAGE_FINGERPRINT = "852f45f6ef65"; // T57 → the v10 re-ingest (2026-09-28): IDENTITY_VERSION 10 (history — production's recorded suffix until the v11 re-ingest)
  const T46_PAGE_FINGERPRINT = "864cbc8489ad"; // T46 + T47 + F-191 → the v9 re-ingest (2026-09-26): IDENTITY_VERSION 9 (history — production's recorded suffix until the v10 re-ingest)
  const T45_PAGE_FINGERPRINT = "bfd9e449b930"; // T45 → the v8 re-ingest (2026-09-25): IDENTITY_VERSION 8 (history — production's recorded suffix until the v9 re-ingest)
  const T18_PAGE_FINGERPRINT = "384ec4e0e1c3"; // T18 → the v7 re-ingest (2026-09-23): IDENTITY_VERSION 7 (history — production's recorded suffix until the T45 re-ingest)
  const T41_PAGE_FINGERPRINT = "be2a00d66f36"; // T41 → the v6 re-ingest (2026-09-23): IDENTITY_VERSION 6 (history — production's recorded suffix until the T18 re-ingest)
  const T35_PAGE_FINGERPRINT = "dd257f24f95c"; // T35 → the D12 re-ingest: IDENTITY_VERSION 5 (history — production's recorded suffix until the T41 re-ingest)
  const T34_PAGE_FINGERPRINT = "42bb5ef65e46"; // T34 → the D9 re-ingest: IDENTITY_VERSION 4 (history — production's recorded suffix until the T35 re-ingest)
  const T33_PAGE_FINGERPRINT = "65b740dc14dd"; // T33 → the D11 re-ingest: IDENTITY_VERSION 3 (history — production's recorded suffix until the T34 re-ingest)
  const T37_PAGE_FINGERPRINT = "9087fdb24b59"; // T37 → the D4 re-caption: IDENTITY_VERSION 2 with the chat model (history — production's recorded suffix until D11)
  const T32_PAGE_FINGERPRINT = "42ca5ed33c98"; // T32–T36: the same shape with vlmModelName "qwen3-vl:30b" (history)
  const V1_FINGERPRINT = "d0767e67555d"; // T05–T31: IDENTITY_VERSION 1 with the VLM (history)
  const hand = (identityVersion, vlmModelName, extra = {}) => {
    const crypto = require("crypto");
    const o = { chunkOverlap: 80, chunkSize: 600, identityVersion, minChunkSize: 150, vlmModelName, ...extra };
    return crypto.createHash("sha256").update(JSON.stringify(o, Object.keys(o).sort())).digest("hex").slice(0, 12);
  };

  test("T61 (design D1 a): IDENTITY_VERSION is 14 — the colour check's three-cue settle states the design three cues agree on; T60 (design D1 a, D2 a): 13 — a keyed chunk adds up its rows by its legend's text and its CONFLICTS line says what a range names; T59 (design D1 a, D2 a, D3 a): 12 — a keyed chunk says what its range labels are, a subsumed range leaves, the colour check places a printed range; T58 (design D1 a, D2 a): 11 — a conflicted keyed chunk's COUNTS rows say what the index supports; T57 (design §2.5): 10 — the colour check discloses a reading the page's colour contradicts; T46 + T47 + F-191 (one window): 9 — a drawing's chain block, the text layer's spellings, the corroborated drop; T45 (design D1 a, D13): 8 — the tile-edge rule changes a conflicted page's detail chunk text and names a same-tile multi-value apart; T18 (design D2–D7): 7 — the running lines gone, the heading pick changed, \\r\\n normalised; T41 (design D2–D8): 6 — the chunk text changes on every path — so every docVersion moves once; the seven earlier page-shape numbers are reproduced by hand as history", () => {
    assert.strictEqual(ids.IDENTITY_VERSION, 14);
    assert.strictEqual(hand(1, "qwen3-vl:30b"), V1_FINGERPRINT, "the pre-T32 production fingerprint, reproduced by hand");
    assert.strictEqual(hand(2, "qwen3-vl:30b"), T32_PAGE_FINGERPRINT, "the T32–T36 page-shape fingerprint (the VLM as the default)");
    assert.strictEqual(hand(2, "qwen3.8:27b"), T37_PAGE_FINGERPRINT, "the T37 page-shape fingerprint — the D4 re-caption's target, production's recorded suffix until D11");
    assert.strictEqual(hand(3, "qwen3.8:27b"), T33_PAGE_FINGERPRINT, "the T33 page-shape fingerprint — the D11 re-ingest's target, production's recorded suffix until the T34 re-ingest");
    assert.strictEqual(hand(4, "qwen3.8:27b"), T34_PAGE_FINGERPRINT, "the T34 page-shape fingerprint — the D9 re-ingest's target, production's recorded suffix until the T35 re-ingest");
    assert.strictEqual(hand(5, "qwen3.8:27b"), T35_PAGE_FINGERPRINT, "the T35 page-shape fingerprint — the D12 re-ingest's target, production's recorded suffix until the T41 re-ingest");
    assert.strictEqual(hand(6, "qwen3.8:27b"), T41_PAGE_FINGERPRINT, "the T41 page-shape fingerprint — the v6 re-ingest's target, production's recorded suffix until the T18 re-ingest");
    assert.strictEqual(hand(7, "qwen3.8:27b"), T18_PAGE_FINGERPRINT, "the T18 page-shape fingerprint — the v7 re-ingest's target, production's recorded suffix until the T45 re-ingest");
    assert.strictEqual(hand(8, "qwen3.8:27b"), T45_PAGE_FINGERPRINT, "the T45 page-shape fingerprint — the v8 re-ingest's target, production's recorded suffix until the v9 re-ingest");
    assert.strictEqual(hand(9, "qwen3.8:27b"), T46_PAGE_FINGERPRINT, "the T46 + T47 + F-191 page-shape fingerprint — the v9 re-ingest's target, production's recorded suffix until the v10 re-ingest");
    assert.strictEqual(hand(10, "qwen3.8:27b"), T57_PAGE_FINGERPRINT, "the T57 page-shape fingerprint — the v10 re-ingest's target, production's recorded suffix until the v11 re-ingest");
    assert.strictEqual(hand(11, "qwen3.8:27b"), T58_PAGE_FINGERPRINT, "the T58 page-shape fingerprint — the v11 re-ingest's target, production's recorded suffix until the v12 re-ingest");
    assert.strictEqual(hand(12, "qwen3.8:27b"), T59_PAGE_FINGERPRINT, "the T59 page-shape fingerprint — the v12 re-ingest's target, production's recorded suffix until the v13 re-ingest");
    assert.strictEqual(hand(13, "qwen3.8:27b"), T60_PAGE_FINGERPRINT, "the T60 page-shape fingerprint — the v13 re-ingest's target, production's recorded suffix until the v14 re-ingest");
    assert.strictEqual(hand(14, "qwen3.8:27b"), PRODUCTION_FINGERPRINT, "the T61 page-shape fingerprint, reproduced by hand");
    assert.strictEqual(ids.fingerprintFor(settings), PRODUCTION_FINGERPRINT);
    assert.strictEqual(ids.fingerprintFor({ ...settings, vlmModelName: "qwen3-vl:30b" }), "485eb0bb18da", "the same shape under the VLM, IDENTITY_VERSION 14");
    assert.strictEqual(hand(13, "qwen3-vl:30b"), "1453a9804bff", "the VLM's number under IDENTITY_VERSION 13 (history)");
    assert.strictEqual(hand(12, "qwen3-vl:30b"), "ee7b6c761a4e", "the VLM's number under IDENTITY_VERSION 12 (history)");
    assert.strictEqual(hand(11, "qwen3-vl:30b"), "ad61422bb0cb", "the VLM's number under IDENTITY_VERSION 11 (history)");
    assert.strictEqual(hand(10, "qwen3-vl:30b"), "f68986fc8efa", "the VLM's number under IDENTITY_VERSION 10 (history)");
    assert.strictEqual(hand(9, "qwen3-vl:30b"), "55607800ce52", "the VLM's number under IDENTITY_VERSION 9 (history)");
    assert.strictEqual(hand(8, "qwen3-vl:30b"), "e9f6848b7fd8", "the VLM's number under IDENTITY_VERSION 8 (history)");
    assert.strictEqual(hand(7, "qwen3-vl:30b"), "503ac9c4cf7a", "the VLM's number under IDENTITY_VERSION 7 (history)");
    assert.strictEqual(hand(6, "qwen3-vl:30b"), "24a4e12acf65", "the VLM's number under IDENTITY_VERSION 6 (history)");
    assert.strictEqual(hand(5, "qwen3-vl:30b"), "54048b0b40af", "the VLM's number under IDENTITY_VERSION 5 (history)");
    assert.strictEqual(hand(4, "qwen3-vl:30b"), "d6385e7034c1", "the VLM's number under IDENTITY_VERSION 4 (history)");
    assert.strictEqual(hand(3, "qwen3-vl:30b"), "db0cde8b514f", "the VLM's number under IDENTITY_VERSION 3 (history)");
    for (const old of [V1_FINGERPRINT, T32_PAGE_FINGERPRINT, T37_PAGE_FINGERPRINT, T33_PAGE_FINGERPRINT, T34_PAGE_FINGERPRINT, T35_PAGE_FINGERPRINT, T41_PAGE_FINGERPRINT, T18_PAGE_FINGERPRINT, T45_PAGE_FINGERPRINT, T46_PAGE_FINGERPRINT, T57_PAGE_FINGERPRINT, T58_PAGE_FINGERPRINT, T59_PAGE_FINGERPRINT, T60_PAGE_FINGERPRINT]) assert.notStrictEqual(ids.fingerprintFor(settings), old, "the same settings are a NEW version: a skip re-ingest re-parses (every caption and tile recalled from the memo) and supersedes (T06)");
  });

  test("T37 (design D4): the page-shape fingerprint moved by the VALUE of vlmModelName alone under IDENTITY_VERSION 2 — 42ca5ed33c98 → 9087fdb24b59 (history now); the model is never omitted at a default; the harness shape's suffixes under v2 (the three kept arm classes) and under v3 (T33's chain) noted for a ledger reader", () => {
    assert.strictEqual(DEFAULT_CAPTION_MODEL, "qwen3.8:27b", "T32's arm C — the chat model (t37-design D1)");
    assert.ok(!("vlmModelName" in ids.FINGERPRINT_DEFAULTS), "the model is never omitted at a default — an omission would move every EXISTING fingerprint (D4's rejected option b)");
    assert.strictEqual(hand(2, "qwen3.8:27b"), "9087fdb24b59", "reproduced by hand: the literal number the D4 re-caption stamped on all thirteen production documents");
    assert.strictEqual(hand(2, "qwen3-vl:30b"), "42ca5ed33c98");
    // The harness's shape (the arm helper sends no chunk settings: the profile path's 900 / 200, no minimum) — the
    // docVersion suffix on the three kept arm classes (RAGEval_ws_1789410402_CV2 b0444533c428, arm B a7595ac80503)
    // under IDENTITY_VERSION 2, and what the same shape stamps under IDENTITY_VERSION 3 (T33's arm D and every chain
    // leg); NOT the page's; the judge compares captions and answers, never versions.
    const crypto = require("crypto");
    const harness = (identityVersion, vlmModelName) => crypto.createHash("sha256").update(JSON.stringify({ chunkOverlap: 200, chunkSize: 900, identityVersion, minChunkSize: null, vlmModelName }, ["chunkOverlap", "chunkSize", "identityVersion", "minChunkSize", "vlmModelName"])).digest("hex").slice(0, 12);
    assert.strictEqual(harness(2, "qwen3.8:27b"), "b0444533c428", "arm C's suffix (history)");
    assert.strictEqual(harness(2, "qwen3-vl:30b"), "a7595ac80503", "arm B's suffix (history)");
    assert.strictEqual(harness(3, "qwen3.8:27b"), "ee85efee4c5c", "the harness shape under the chat model, IDENTITY_VERSION 3 (arm D's suffix — history)");
    assert.strictEqual(harness(3, "qwen3-vl:30b"), "1f0c064f2e19", "the harness shape under the VLM, IDENTITY_VERSION 3 (history)");
    assert.strictEqual(harness(4, "qwen3.8:27b"), "34e1ecb0b755", "the harness shape under the chat model, IDENTITY_VERSION 4 (T34's chain legs — history)");
    assert.strictEqual(harness(4, "qwen3-vl:30b"), "c5eda8e015c8", "the harness shape under the VLM, IDENTITY_VERSION 4 (history)");
    assert.strictEqual(harness(5, "qwen3.8:27b"), "cb4e417cb1e4", "the harness shape under the chat model, IDENTITY_VERSION 5 (T35's → T42's chain legs — history)");
    assert.strictEqual(harness(5, "qwen3-vl:30b"), "be691262add3", "the harness shape under the VLM, IDENTITY_VERSION 5 (history)");
    assert.strictEqual(harness(6, "qwen3.8:27b"), "1cf8ea51da4b", "the harness shape under the chat model, IDENTITY_VERSION 6 (T41's chain legs — history)");
    assert.strictEqual(harness(6, "qwen3-vl:30b"), "22a0dd34130b", "the harness shape under the VLM, IDENTITY_VERSION 6 (history)");
    assert.strictEqual(harness(7, "qwen3.8:27b"), "549cb22a4f1f", "the harness shape under the chat model, IDENTITY_VERSION 7 (T18's chain legs — history)");
    assert.strictEqual(harness(7, "qwen3-vl:30b"), "7fb76f7f39ce", "the harness shape under the VLM, IDENTITY_VERSION 7 (history)");
    assert.strictEqual(ids.fingerprintFor({ chunkSize: 900, chunkOverlap: 200, vlmModelName: "qwen3.8:27b" }), "b559bba33b5c", "the harness shape under the chat model, IDENTITY_VERSION 14 (T61's legs; b87c353e60be under 13 — T60's legs; 445955540c40 under 12 — T59's legs; 09f54084eefd under 11 — T58's legs; 4808927e554a under 10 — T57's legs; 1843c3c49535 under 9 — T46's chain legs; e0d581848717 under 8 — T45's chain legs)");
    assert.strictEqual(ids.fingerprintFor({ chunkSize: 900, chunkOverlap: 200, vlmModelName: "qwen3-vl:30b" }), "b9818a62e213", "the harness shape under the VLM, IDENTITY_VERSION 14 (81b8c35595d9 under 13, 928a956a5bbe under 12, 816e433afa57 under 11, 0ef9ae6c9b2c under 10, 4320ab150893 under 9)");
    assert.strictEqual(ids.fingerprintFor({ chunkSize: 1500, chunkOverlap: 200, vlmModelName: "qwen3.8:27b" }), "0a8ef55ed3d8", "the profiler's medium tier (1500 / 200) under the chat model, IDENTITY_VERSION 14 (028cb711eef8 under 13, 01afe643c52d under 12, 6e29150c6a91 under 11, f5b193b8ed48 under 10, b84cc2aba702 under 9, 694ae0e0dd18 under 8)");
    assert.strictEqual(harness(13, "qwen3.8:27b"), "b87c353e60be", "the harness shape under the chat model, IDENTITY_VERSION 13 (T60's legs — history)");
    assert.strictEqual(harness(13, "qwen3-vl:30b"), "81b8c35595d9", "the harness shape under the VLM, IDENTITY_VERSION 13 (history)");
    assert.strictEqual(harness(12, "qwen3.8:27b"), "445955540c40", "the harness shape under the chat model, IDENTITY_VERSION 12 (T59's legs — history)");
    assert.strictEqual(harness(12, "qwen3-vl:30b"), "928a956a5bbe", "the harness shape under the VLM, IDENTITY_VERSION 12 (history)");
    assert.strictEqual(harness(11, "qwen3.8:27b"), "09f54084eefd", "the harness shape under the chat model, IDENTITY_VERSION 11 (T58's legs — history)");
    assert.strictEqual(harness(11, "qwen3-vl:30b"), "816e433afa57", "the harness shape under the VLM, IDENTITY_VERSION 11 (history)");
    assert.strictEqual(harness(10, "qwen3.8:27b"), "4808927e554a", "the harness shape under the chat model, IDENTITY_VERSION 10 (T57's legs — history)");
    assert.strictEqual(harness(10, "qwen3-vl:30b"), "0ef9ae6c9b2c", "the harness shape under the VLM, IDENTITY_VERSION 10 (history)");
    assert.strictEqual(harness(9, "qwen3.8:27b"), "1843c3c49535", "the harness shape under the chat model, IDENTITY_VERSION 9 (T46's chain legs — history)");
    assert.strictEqual(harness(9, "qwen3-vl:30b"), "4320ab150893", "the harness shape under the VLM, IDENTITY_VERSION 9 (history)");
    assert.strictEqual(harness(8, "qwen3.8:27b"), "e0d581848717", "the harness shape under the chat model, IDENTITY_VERSION 8 (T45's chain legs — history)");
    assert.strictEqual(harness(8, "qwen3-vl:30b"), "2ee0823c0de7", "the harness shape under the VLM, IDENTITY_VERSION 8 (history)");
    assert.strictEqual(harness(7, "qwen3.8:27b"), "549cb22a4f1f", "reproduced by hand");
    const medium = (identityVersion, vlmModelName) => crypto.createHash("sha256").update(JSON.stringify({ chunkOverlap: 200, chunkSize: 1500, identityVersion, minChunkSize: null, vlmModelName }, ["chunkOverlap", "chunkSize", "identityVersion", "minChunkSize", "vlmModelName"])).digest("hex").slice(0, 12);
    assert.strictEqual(medium(7, "qwen3.8:27b"), "06b0ce60f67b", "the profiler's MEDIUM shape under IDENTITY_VERSION 7 (42f47467de9a under 6 — a file of 50–500 KB — story.md on T41's leg; 98c5e2e48dae under 5) — history, reproduced by hand");
    assert.strictEqual(medium(8, "qwen3.8:27b"), "694ae0e0dd18", "…and under IDENTITY_VERSION 8 (history)");
    assert.strictEqual(medium(9, "qwen3.8:27b"), "b84cc2aba702", "…and under IDENTITY_VERSION 9 (history)");
    assert.strictEqual(medium(10, "qwen3.8:27b"), "f5b193b8ed48", "…and under IDENTITY_VERSION 10 (history)");
    assert.strictEqual(medium(11, "qwen3.8:27b"), "6e29150c6a91", "…and under IDENTITY_VERSION 11 (history)");
    assert.strictEqual(medium(12, "qwen3.8:27b"), "01afe643c52d", "…and under IDENTITY_VERSION 12 (history)");
    assert.strictEqual(medium(13, "qwen3.8:27b"), "028cb711eef8", "…and under IDENTITY_VERSION 13 (history)");
    assert.strictEqual(medium(14, "qwen3.8:27b"), "0a8ef55ed3d8", "…and under IDENTITY_VERSION 14, by hand = the module's");
  });

  test("T33 (design D6, option E): detailPasses is fingerprinted only when NOT auto — auto, absent or unreadable is the production fingerprint; all and off are two other versions; the value is normalised (case, whitespace)", () => {
    const base = ids.fingerprintFor(settings);
    assert.strictEqual(base, PRODUCTION_FINGERPRINT);
    for (const def of [undefined, null, "", "auto", "AUTO", " auto ", "sometimes", 42, true]) assert.strictEqual(ids.fingerprintFor({ ...settings, detailPasses: def }), base, `detailPasses ${JSON.stringify(def)} is the default: no version moves`);
    const all = ids.fingerprintFor({ ...settings, detailPasses: "all" });
    const off = ids.fingerprintFor({ ...settings, detailPasses: "off" });
    assert.strictEqual(all, "11975684e540", "all: every visual page gains a detail chunk — a different chunk set (IDENTITY_VERSION 14; 16849503e978 under 13, fafe4a2288a4 under 12, 86be73f035c8 under 11, 031725f8279f under 10, 1f1b3a9913b4 under 9, c4f5ed9f1293 under 8, a27836529448 under 7, fe11814b6ba7 under 6, 6663e26cb92c under 5, bb78c79bb628 under 4, c61f3a683efe under 3)");
    assert.strictEqual(off, "10530198fae9", "off: no detail chunk at all — a different chunk set (IDENTITY_VERSION 14; 1ef3c107dd14 under 13, cd33242ee778 under 12, b18000cfc81c under 11, 0341e7bb5be6 under 10, e589e1014022 under 9, af33fa724e02 under 8, 11ef46e4818c under 7, 0a0f13dbaca0 under 6, 34bab52934e2 under 5, 8e6ca926fdf3 under 4, 569163feeff2 under 3)");
    assert.strictEqual(hand(13, "qwen3.8:27b", { detailPasses: "all" }), "16849503e978", "the v13 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(13, "qwen3.8:27b", { detailPasses: "off" }), "1ef3c107dd14");
    assert.strictEqual(hand(12, "qwen3.8:27b", { detailPasses: "all" }), "fafe4a2288a4", "the v12 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(12, "qwen3.8:27b", { detailPasses: "off" }), "cd33242ee778");
    assert.strictEqual(hand(11, "qwen3.8:27b", { detailPasses: "all" }), "86be73f035c8", "the v11 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(11, "qwen3.8:27b", { detailPasses: "off" }), "b18000cfc81c");
    assert.strictEqual(hand(10, "qwen3.8:27b", { detailPasses: "all" }), "031725f8279f", "the v10 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(10, "qwen3.8:27b", { detailPasses: "off" }), "0341e7bb5be6");
    assert.strictEqual(hand(9, "qwen3.8:27b", { detailPasses: "all" }), "1f1b3a9913b4", "the v9 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(9, "qwen3.8:27b", { detailPasses: "off" }), "e589e1014022");
    assert.strictEqual(hand(8, "qwen3.8:27b", { detailPasses: "all" }), "c4f5ed9f1293", "the v8 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(8, "qwen3.8:27b", { detailPasses: "off" }), "af33fa724e02");
    assert.strictEqual(hand(7, "qwen3.8:27b", { detailPasses: "all" }), "a27836529448", "the v7 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(7, "qwen3.8:27b", { detailPasses: "off" }), "11ef46e4818c");
    assert.strictEqual(hand(5, "qwen3.8:27b", { detailPasses: "all" }), "6663e26cb92c", "the v5 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(5, "qwen3.8:27b", { detailPasses: "off" }), "34bab52934e2");
    assert.strictEqual(hand(4, "qwen3.8:27b", { detailPasses: "all" }), "bb78c79bb628", "the v4 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(4, "qwen3.8:27b", { detailPasses: "off" }), "8e6ca926fdf3");
    assert.notStrictEqual(all, base); assert.notStrictEqual(off, base); assert.notStrictEqual(all, off);
    assert.strictEqual(ids.fingerprintFor({ ...settings, detailPasses: "ALL " }), all, "normalised");
    assert.strictEqual(all, hand(14, "qwen3.8:27b", { detailPasses: "all" }), "all: the key in the sorted canonical form");
    assert.strictEqual(off, hand(14, "qwen3.8:27b", { detailPasses: "off" }));
    assert.strictEqual(hand(6, "qwen3.8:27b", { detailPasses: "all" }), "fe11814b6ba7", "the v6 numbers, reproduced by hand (history)");
    assert.strictEqual(hand(6, "qwen3.8:27b", { detailPasses: "off" }), "0a0f13dbaca0");
    assert.strictEqual(ids.fingerprintFor({ ...settings, detailPasses: "all", captionFigures: true, captionPageBudget: 0 }), all, "the three defaulted keys are independent");
  });

  test("is the content hash, a dot, and 12 hex characters of fingerprint", () => {
    const v = ids.docVersionFor(HASH, settings);
    assert.match(v, /^[0-9a-f]{32}\.[0-9a-f]{12}$/);
    assert.ok(v.startsWith(`${HASH}.`));
    assert.strictEqual(ids.docVersionFor(HASH.toUpperCase(), settings), v, "hash case does not change the version");
  });

  test("same bytes and same settings → same version (a re-upload is skipped)", () => {
    assert.strictEqual(ids.docVersionFor(HASH, settings), ids.docVersionFor(HASH, { ...settings }));
    assert.strictEqual(
      ids.fingerprintFor(settings),
      ids.fingerprintFor({ vlmModelName: settings.vlmModelName, minChunkSize: 150, chunkOverlap: 80, chunkSize: 600 }),
      "key order is irrelevant"
    );
  });

  test("any fingerprinted setting changing → a new version (F-50 case 1)", () => {
    const base = ids.docVersionFor(HASH, settings);
    for (const key of ids.FINGERPRINT_KEYS) {
      // T24: captionFigures is fingerprinted only when OFF (its default is on).
      // T31: captionPageBudget only when non-zero (its default is 0, every page).
      // T33: detailPasses only when not "auto". T35: ocrNoTextPages only when "off".
      const changed = { ...settings, [key]: key === "vlmModelName" ? "other-model" : key === "captionFigures" ? false : key === "captionPageBudget" ? 25 : key === "detailPasses" ? "all" : key === "ocrNoTextPages" ? "off" : settings[key] + 1 };
      assert.notStrictEqual(ids.docVersionFor(HASH, changed), base, `changing ${key}`);
    }
    assert.notStrictEqual(ids.docVersionFor("0".repeat(32), settings), base, "different bytes");
  });

  test("settings outside the fingerprint do not change the version", () => {
    assert.strictEqual(
      ids.docVersionFor(HASH, { ...settings, searchStrategy: "keyword", maxFileSize: 99, autoProfile: false }),
      ids.docVersionFor(HASH, settings)
    );
  });

  test("an absent setting is one canonical value, however it is absent", () => {
    const a = ids.fingerprintFor({ chunkSize: 600 });
    assert.strictEqual(ids.fingerprintFor({ chunkSize: 600, minChunkSize: undefined }), a);
    assert.strictEqual(ids.fingerprintFor({ chunkSize: 600, minChunkSize: null }), a);
    assert.strictEqual(ids.fingerprintFor({ chunkSize: 600, minChunkSize: "" }), a);
    assert.notStrictEqual(ids.fingerprintFor({ chunkSize: 600, minChunkSize: 0 }), a, "0 is a real value");
  });

  test("the fingerprint includes IDENTITY_VERSION (a chunking-rule bump re-indexes)", () => {
    assert.strictEqual(typeof ids.IDENTITY_VERSION, "number");
    // Reproduce the canonical input by hand: bumping the version constant
    // must change the fingerprint, which is what a T19/T20 bump relies on.
    const crypto = require("crypto");
    const canonical = (version) =>
      JSON.stringify(
        { chunkOverlap: 80, chunkSize: 600, identityVersion: version, minChunkSize: 150, vlmModelName: settings.vlmModelName },
        ["chunkOverlap", "chunkSize", "identityVersion", "minChunkSize", "vlmModelName"]
      );
    const expected = crypto.createHash("sha256").update(canonical(ids.IDENTITY_VERSION)).digest("hex").slice(0, 12);
    assert.strictEqual(ids.fingerprintFor(settings), expected, "the canonical form is sorted keys, JSON");
    const bumped = crypto.createHash("sha256").update(canonical(ids.IDENTITY_VERSION + 1)).digest("hex").slice(0, 12);
    assert.notStrictEqual(bumped, expected);
  });

  test("T24 (design D8): a defaulted key is omitted at its default — captionFigures on or absent changes no existing fingerprint; off is a new version", () => {
    const four = ids.fingerprintFor(settings);
    assert.deepStrictEqual([...ids.FINGERPRINT_KEYS], ["chunkSize", "chunkOverlap", "minChunkSize", "vlmModelName", "captionFigures", "captionPageBudget", "detailPasses", "ocrNoTextPages"]);
    assert.ok(Object.isFrozen(ids.FINGERPRINT_DEFAULTS));
    assert.deepStrictEqual({ ...ids.FINGERPRINT_DEFAULTS }, { captionFigures: true, captionPageBudget: 0, detailPasses: "auto", ocrNoTextPages: "auto" });
    for (const on of [undefined, null, "", true, "true", 1, "on"]) {
      assert.strictEqual(ids.fingerprintFor({ ...settings, captionFigures: on }), four, `captionFigures ${JSON.stringify(on)} is the default: the pre-T24 fingerprint`);
    }
    // The production corpus's fingerprint (the page's 600 / 80 / 150 + the default captioner) is unchanged by the key's existence.
    // T32 (design D7): IDENTITY_VERSION 1 → 2 moved it DELIBERATELY from d0767e67555d — every caption is different
    // content now, so a `skip` re-ingest must re-index instead of saying "already indexed" (the A7 shape).
    assert.strictEqual(four, PRODUCTION_FINGERPRINT, "the production fingerprint under IDENTITY_VERSION 6 — the thirteen production documents' docVersion moves ONCE more, on the owner's T41 re-ingest");
    const off = ids.fingerprintFor({ ...settings, captionFigures: false });
    assert.notStrictEqual(off, four, "captions off emits a different chunk set: a new version");
    for (const v of ["false", 0, "off", "0"]) assert.strictEqual(ids.fingerprintFor({ ...settings, captionFigures: v }), off, `${JSON.stringify(v)} is off`);
    assert.strictEqual(ids.fingerprintFor({ ...settings, captionFigures: "nonsense" }), four, "an unreadable value is the default");
    // The canonical input carries the key only when off, and never the decoding constants (D2, D8).
    assert.strictEqual(ids.fingerprintFor({ ...settings, temperature: 0, seed: 42 }), four, "the captioner's decoding is not a setting");
    const crypto = require("crypto");
    const canonicalOff = JSON.stringify(
      { captionFigures: false, chunkOverlap: 80, chunkSize: 600, identityVersion: ids.IDENTITY_VERSION, minChunkSize: 150, vlmModelName: settings.vlmModelName },
      ["captionFigures", "chunkOverlap", "chunkSize", "identityVersion", "minChunkSize", "vlmModelName"]
    );
    assert.strictEqual(off, crypto.createHash("sha256").update(canonicalOff).digest("hex").slice(0, 12), "off: the key in the sorted canonical form");
  });

  test("T31 (workshop design D5, amendment A1): captionPageBudget is fingerprinted only when non-zero — 0, absent or unreadable is the production fingerprint; a budget is a new version; a numeric string is its number", () => {
    const four = ids.fingerprintFor(settings);
    assert.strictEqual(four, PRODUCTION_FINGERPRINT, "the production fingerprint (moved by T32's IDENTITY_VERSION 2 and T33's 3, never by the budget key)");
    for (const none of [undefined, null, "", 0, "0", -1, 2.5, "all", true]) {
      assert.strictEqual(ids.fingerprintFor({ ...settings, captionPageBudget: none }), four, `captionPageBudget ${JSON.stringify(none)} is the default (every page): the pre-T31 fingerprint`);
    }
    const fifty = ids.fingerprintFor({ ...settings, captionPageBudget: 50 });
    assert.notStrictEqual(fifty, four, "a budget leaves pages uncaptioned — a different chunk set, a new version");
    assert.strictEqual(ids.fingerprintFor({ ...settings, captionPageBudget: "50" }), fifty, "the UI's parseInt'd value and an API integer are one version");
    assert.notStrictEqual(ids.fingerprintFor({ ...settings, captionPageBudget: 10 }), fifty, "different budgets, different versions");
    assert.strictEqual(ids.fingerprintFor({ ...settings, captionPageBudget: 50, captionFigures: true }), fifty, "the two defaulted keys are independent");
    const crypto = require("crypto");
    const canonical50 = JSON.stringify(
      { captionPageBudget: 50, chunkOverlap: 80, chunkSize: 600, identityVersion: ids.IDENTITY_VERSION, minChunkSize: 150, vlmModelName: settings.vlmModelName },
      ["captionPageBudget", "chunkOverlap", "chunkSize", "identityVersion", "minChunkSize", "vlmModelName"]
    );
    assert.strictEqual(fifty, crypto.createHash("sha256").update(canonical50).digest("hex").slice(0, 12), "the budget in the sorted canonical form, the on-by-default switch omitted");
  });

  test("refuses a non-hex hash", () => {
    for (const bad of ["", "not hex", null, 42]) {
      assert.throws(() => ids.docVersionFor(bad, settings), /docHash must be a hex string/);
    }
  });
});

describe("U-IDS: chunk id", () => {
  const sourceId = "demos/x.pdf";
  const docVersion = "14fe0a24c9fb7a031f91a4b615d85df7.0123456789ab";

  test("same inputs → same uuid; differing chunkIndex → different (the ticket's test)", () => {
    const a = ids.chunkIdFor(sourceId, docVersion, 0);
    assert.strictEqual(ids.chunkIdFor(sourceId, docVersion, 0), a);
    assert.notStrictEqual(ids.chunkIdFor(sourceId, docVersion, 1), a);
    assert.notStrictEqual(ids.chunkIdFor("demos/y.pdf", docVersion, 0), a);
    assert.notStrictEqual(ids.chunkIdFor(sourceId, `${docVersion.slice(0, -1)}c`, 0), a);
    assert.match(a, UUID_RE);
  });

  test("is exactly uuidv5(NAMESPACE, `${sourceId}:${docVersion}:${chunkIndex}`) — reproducible by hand", () => {
    assert.strictEqual(ids.identityNameFor(sourceId, docVersion, 7), `${sourceId}:${docVersion}:7`);
    assert.strictEqual(ids.chunkIdFor(sourceId, docVersion, 7), ids.uuidv5(ids.NAMESPACE, `${sourceId}:${docVersion}:7`));
  });

  test("refuses an incomplete identity rather than minting an id for it", () => {
    assert.throws(() => ids.chunkIdFor("", docVersion, 0), /sourceId is required/);
    assert.throws(() => ids.chunkIdFor(sourceId, "", 0), /docVersion is required/);
    for (const bad of [-1, 1.5, "0", null, undefined, NaN]) {
      assert.throws(() => ids.chunkIdFor(sourceId, docVersion, bad), /chunkIndex must be a non-negative integer/, JSON.stringify(bad));
    }
  });
});

describe("U-IDS: review findings, 2026-09-04", () => {
  test("a numeric string is the number it spells — the chunker coerces both the same way", () => {
    assert.strictEqual(
      ids.fingerprintFor({ chunkSize: "1000", chunkOverlap: "200", minChunkSize: "50" }),
      ids.fingerprintFor({ chunkSize: 1000, chunkOverlap: 200, minChunkSize: 50 })
    );
    assert.notStrictEqual(ids.fingerprintFor({ chunkSize: "1000" }), ids.fingerprintFor({ chunkSize: 1001 }));
    assert.notStrictEqual(ids.fingerprintFor({ vlmModelName: "7" }), ids.fingerprintFor({ vlmModelName: "8" }));
  });

  test("'..' segments are collapsed like the route's path.join, and an escaping path is refused", () => {
    assert.strictEqual(ids.sourceIdFor("demos/a/../b/x.pdf"), "demos/b/x.pdf");
    assert.strictEqual(ids.sourceIdFor("demos/b/x.pdf"), "demos/b/x.pdf");
    for (const bad of ["../x.pdf", "demos/../../x.pdf", "..", "public/../x.pdf"]) {
      assert.throws(() => ids.sourceIdFor(bad), /escapes the public\/ root/, bad);
    }
  });
});

describe("U-IDS/T35 (t35-design D3, D9): ocrNoTextPages is fingerprinted only when NOT auto", () => {
  const settings = { chunkSize: 600, chunkOverlap: 80, minChunkSize: 150, vlmModelName: DEFAULT_CAPTION_MODEL };
  test("auto, absent or unreadable is the production fingerprint; off is another version; the value is normalised (case, whitespace)", () => {
    const base = ids.fingerprintFor(settings);
    assert.strictEqual(base, "a5d02a609ad9", "IDENTITY_VERSION 14 (94195d3aa6bb under 13, 0c708178f137 under 12, 0008a8c2d1f3 under 11, 852f45f6ef65 under 10, 864cbc8489ad under 9, bfd9e449b930 under 8, 384ec4e0e1c3 under 7, be2a00d66f36 under 6, dd257f24f95c under 5)");
    for (const v of ["auto", "AUTO", " auto ", undefined, null, "", "sometimes", 1]) assert.strictEqual(ids.fingerprintFor({ ...settings, ocrNoTextPages: v }), base, `${JSON.stringify(v)} is the default: no version moves`);
    assert.strictEqual(ids.fingerprintFor({ ...settings, ocrNoTextPages: "off" }), "efc665a1b7ec", "IDENTITY_VERSION 14 (454ac3cd28ac under 13, 1469ecd67cac under 12, fd0dcb555a4e under 11, ce4db2f51515 under 10, a2aaa47d0641 under 9, 91466d268ae4 under 8, 1814223900ce under 7, e7388a0a8a8b under 6, 18314c43722c under 5)");
    assert.strictEqual(ids.fingerprintFor({ ...settings, ocrNoTextPages: " OFF " }), "efc665a1b7ec");
    assert.ok(ids.FINGERPRINT_KEYS.includes("ocrNoTextPages"));
    assert.strictEqual(ids.FINGERPRINT_DEFAULTS.ocrNoTextPages, "auto");
  });
});
