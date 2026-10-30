/**
 * I-CROPS — a Tidy Up deletes only the crop folders no other collection still
 * cites, live (ticket T22, design D10; finding F-42). The pure half is U-PURGE.
 *
 * Two throwaway v2 classes: A holds two documents, B holds one of them. With a
 * crop folder on disk for each document, clearing A must delete the folder of
 * the document only A held and KEEP the folder of the document B still holds —
 * and the preview must have said exactly that. Before T22 the whole directory
 * went, whatever class was cleared.
 *
 * Folders are created by this suite (a marker file each) under the parser's
 * own docHash — md5 of the file's bytes — so the case does not depend on a
 * document having figures to crop. Runs in-pod; ingests two small corpus
 * files three times (~1 min each).
 *
 * The "only-A" document must be one NO persistent class holds: the
 * production corpus `RAGChunkV2` is the thirteen `ext_reg_docs` files, so a
 * document from there is "held elsewhere" by definition and is KEPT (the
 * first run of this suite used story.md and measured exactly that — the
 * rule working, the test wrong). The NGI demo folders are in no persistent
 * class. The shared document may be a production one: "kept" holds either way.
 */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { envConfig, skipReason, makeRunCollection, postJson, waitForIngestion, dropCollection } = require("./_harness");

const config = envConfig();
const SKIP = skipReason();
const APP_ROOT = process.cwd();
const CROPS = path.join(APP_ROOT, "public", "extracted_images");

const SHARED = "demos/demo_files/ext_reg_docs/GraemeHick.pdf";
// Held by no persistent class (see the header) — the folder that MUST go.
const ONLY_A = "demos/demo_files/NGI_corp_docs/demo03/BUG_TRACKER.md";

const classA = config ? makeRunCollection("t22cropsA") : null;
const classB = config ? makeRunCollection("t22cropsB") : null;

function md5File(rel) {
  return crypto.createHash("md5").update(fs.readFileSync(path.join(APP_ROOT, "public", rel))).digest("hex");
}

function ingestBody(collection, filePaths) {
  return {
    filePaths,
    weaviateUrl: config.weaviateUrl,
    token: config.token,
    weaviateToken: config.token,
    mlisToken: config.token,
    embedUrl: config.embedUrl,
    embedModel: config.embedModel,
    embedApiKey: config.token,
    schemaVersion: 2,
    weaviateCollection: collection,
    ragSettings: { weaviateCollection: collection, allowedFileTypes: ["PDF", "DOCX", "TXT", "MD", "XLSX", "PPTX", "CSV"], maxFileSize: 50, duplicatePolicy: "skip" },
  };
}

async function ingest(collection, filePaths) {
  const started = await postJson(`${config.appUrl}/api/ingest`, ingestBody(collection, filePaths));
  assert.ok(started.status === 200 || started.status === 202, `ingest into ${collection} refused: ${started.text}`);
  const final = await waitForIngestion(config.appUrl, started.json && started.json.jobId ? started.json.jobId : null, 900000);
  assert.ok(final && ["completed", "complete", "done", "idle", "partial"].includes(String(final.status)), `ingest into ${collection} ended ${JSON.stringify(final).slice(0, 300)}`);
  return final;
}

function destructiveBody(collection, extra = {}) {
  return { weaviateUrl: config.weaviateUrl, token: config.token, mlisToken: config.token, weaviateCollection: collection, schemaVersion: 2, ...extra };
}

let sharedHash;
let onlyAHash;
const markers = {};
/** Folders this suite CREATED (absent before it ran). Only these may be removed whole — a
 *  folder that already existed is a production document's crops (the shared document is in
 *  `RAGChunkV2`): the suite adds one marker file there and removes only that file (F-95). */
const createdFolders = new Set();

before(async () => {
  if (SKIP) return;
  sharedHash = md5File(SHARED);
  onlyAHash = md5File(ONLY_A);
  await ingest(classA, [SHARED, ONLY_A]);
  await ingest(classB, [SHARED]);
  for (const h of [sharedHash, onlyAHash]) {
    const dir = path.join(CROPS, h);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdFolders.add(h);
    }
    markers[h] = path.join(dir, "i-crops-marker.txt");
    fs.writeFileSync(markers[h], `I-CROPS ${new Date().toISOString()}\n`);
  }
});

/** The clear route recreates a class EMPTY (by design); a teardown must also delete it, or it leaks as an empty RAGEval_* (the first run of this suite left two). */
async function deleteClass(base) {
  const name = `${base}V2`;
  assert.match(name, /^RAGEval_/, "teardown may only delete this suite's own classes");
  const headers = { "Content-Type": "application/json" };
  if (config.token) headers["x-auth-token"] = config.token;
  await fetch(`${config.weaviateUrl}/v1/schema/${name}`, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
  const gone = await fetch(`${config.weaviateUrl}/v1/schema/${name}`, { headers, signal: AbortSignal.timeout(15000) });
  if (gone.status !== 404) console.warn(`[i-crops teardown] ${name} still answers ${gone.status}`);
}

after(async () => {
  if (SKIP) return;
  for (const h of Object.keys(markers)) {
    try {
      if (createdFolders.has(h)) fs.rmSync(path.join(CROPS, h), { recursive: true, force: true });
      else fs.rmSync(markers[h], { force: true }); // a pre-existing (production) folder: only our marker goes
    } catch (e) {}
  }
  await dropCollection(config, classA, 2);
  await dropCollection(config, classB, 2);
  await deleteClass(classA);
  await deleteClass(classB);
});

describe("I-CROPS: a crop written AFTER the server started is served (design §11a A16, finding F-94)", () => {
  // A 1×1 transparent PNG: the smallest real image.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const folder = "i-crops-runtime-" + Date.now().toString(36);

  test("a PNG created now under public/extracted_images answers 200 image/png with its bytes", { skip: SKIP }, async () => {
    fs.mkdirSync(path.join(CROPS, folder), { recursive: true });
    fs.writeFileSync(path.join(CROPS, folder, "fig_1_0.png"), PNG);
    try {
      const res = await fetch(`${config.appUrl}/extracted_images/${folder}/fig_1_0.png`, { signal: AbortSignal.timeout(15000) });
      assert.strictEqual(res.status, 200, "Next's production server indexes public/ at boot; the route must serve what the parser writes later");
      assert.match(res.headers.get("content-type") || "", /^image\/png/);
      const body = Buffer.from(await res.arrayBuffer());
      assert.strictEqual(body.length, PNG.length);
      assert.ok(body.equals(PNG), "the bytes are the file's");
    } finally {
      fs.rmSync(path.join(CROPS, folder), { recursive: true, force: true });
    }
  });

  test("an absent crop is a 404, and a path that escapes the directory is refused", { skip: SKIP }, async () => {
    const missing = await fetch(`${config.appUrl}/extracted_images/${folder}/nothing.png`, { signal: AbortSignal.timeout(15000) });
    assert.strictEqual(missing.status, 404);
    const escape = await fetch(`${config.appUrl}/extracted_images/..%2F..%2Fpackage.json`, { signal: AbortSignal.timeout(15000) });
    assert.ok([400, 404].includes(escape.status), `an escaping path is refused, got ${escape.status}`);
    const text = await escape.text();
    assert.ok(!text.includes('"name": "nexcode"'), "package.json must never be served through the crops route");
  });
});

describe("I-CROPS: the purge is scoped to what only the cleared collection used", () => {
  test("preview of A names the only-A folder to purge and the shared folder as kept", { skip: SKIP }, async () => {
    const res = await postJson(`${config.appUrl}/api/ingest/clear/preview`, destructiveBody(classA));
    assert.strictEqual(res.status, 200, res.text);
    assert.strictEqual(res.json.collection, `${classA}V2`);
    assert.strictEqual(res.json.imagePurgeSkippedReason, null, res.text);
    assert.ok(res.json.imageFoldersToPurge.includes(onlyAHash), `only-A folder to purge: ${res.text}`);
    assert.ok(!res.json.imageFoldersToPurge.includes(sharedHash), `the shared folder is not to purge: ${res.text}`);
    assert.ok(res.json.imageFoldersKept.includes(sharedHash), `the shared folder is kept: ${res.text}`);
    assert.strictEqual(res.json.extractedImageDirs, res.json.imageFoldersToPurge.length, "the dialog's count is the purge count");
  });

  test("clear of A deletes the only-A folder, keeps the shared one, and reports both", { skip: SKIP }, async () => {
    const res = await postJson(`${config.appUrl}/api/ingest/clear`, destructiveBody(classA, { confirmCollection: `${classA}V2` }));
    assert.strictEqual(res.status, 200, res.text);
    assert.strictEqual(res.json.dropped, true);
    assert.ok(res.json.imageFoldersPurged.includes(onlyAHash), res.text);
    assert.ok(!res.json.imageFoldersPurged.includes(sharedHash), res.text);
    assert.ok(res.json.imageFoldersKept.includes(sharedHash), res.text);
    assert.strictEqual(res.json.imagesPurged, true);
    assert.strictEqual(fs.existsSync(markers[onlyAHash]), false, "the only-A crop folder is gone");
    assert.strictEqual(fs.existsSync(markers[sharedHash]), true, "the shared crop folder survives");
    // The purge must not have touched anything else in a pre-existing (production) folder.
    if (!createdFolders.has(sharedHash)) {
      const others = fs.readdirSync(path.join(CROPS, sharedHash)).filter((f) => f !== "i-crops-marker.txt");
      assert.ok(others.length > 0, "the production document's own crops are still there beside the marker");
    }
    assert.match(res.json.message, /only this collection used purged/);
  });

  test("a folder nobody holds is never touched by a clear", { skip: SKIP }, async () => {
    const orphan = path.join(CROPS, "i-crops-orphan-" + Date.now().toString(36));
    fs.mkdirSync(orphan, { recursive: true });
    try {
      const res = await postJson(`${config.appUrl}/api/ingest/clear`, destructiveBody(classA, { confirmCollection: `${classA}V2` }));
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(fs.existsSync(orphan), true, "an orphan folder is not this collection's to delete");
      assert.ok(res.json.imageFoldersKept.includes(path.basename(orphan)));
    } finally {
      fs.rmSync(orphan, { recursive: true, force: true });
    }
  });

  test("a store that cannot be read → nothing purged, and the reason says so (dead port)", { skip: SKIP }, async () => {
    const dir = path.join(CROPS, "i-crops-unreadable-" + Date.now().toString(36));
    fs.mkdirSync(dir, { recursive: true });
    try {
      const res = await postJson(`${config.appUrl}/api/ingest/clear/preview`, { ...destructiveBody(classB), weaviateUrl: "http://127.0.0.1:9" });
      // The preview's count fails typed before the hash read; either way nothing is planned for purge.
      if (res.status === 200) {
        assert.deepStrictEqual(res.json.imageFoldersToPurge, []);
        assert.match(String(res.json.imagePurgeSkippedReason), /could not be read/);
      } else {
        assert.ok(res.json && res.json.code, `a typed refusal: ${res.text}`);
      }
      assert.strictEqual(fs.existsSync(dir), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
