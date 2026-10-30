/**
 * U-PURGE — a Tidy Up deletes only the crop folders no other collection
 * still cites (ticket T22, design D10; finding F-42).
 *
 * Crops live at public/extracted_images/<docHash>/ and are cited by chunks
 * through `imagePath`. Two classes can hold the same document (the T08 eval
 * class holds four of the production corpus's thirteen), so a purge keyed on
 * the cleared class alone deletes what another class still cites — and once
 * the directory is persistent (design D9) that is for good. Before T22 the
 * whole directory went, whatever class was cleared.
 *
 * Pure-function tests; the live half is I-DESTRUCT's shared-document case.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { cropFoldersToPurge, isRagClassName } = require("../../src/lib/ingestion/crops");

describe("U-PURGE: the rule", () => {
  test("a folder goes only when the cleared class holds it and no other RAG class does", () => {
    const plan = cropFoldersToPurge({
      clearedHashes: ["aaa", "bbb", "ccc"],
      otherHashes: ["bbb", "zzz"],
      existingFolders: ["aaa", "bbb", "ccc", "ddd", "zzz"],
    });
    assert.deepStrictEqual(plan.purge, ["aaa", "ccc"]);
    assert.deepStrictEqual(plan.kept, ["bbb", "ddd", "zzz"]);
    assert.strictEqual(plan.reason, null);
  });

  test("a folder nobody holds is kept (it is not this collection's to delete)", () => {
    const plan = cropFoldersToPurge({ clearedHashes: ["aaa"], otherHashes: [], existingFolders: ["orphan", "aaa"] });
    assert.deepStrictEqual(plan.purge, ["aaa"]);
    assert.deepStrictEqual(plan.kept, ["orphan"]);
  });

  test("a hash the cleared class holds but no folder exists for is simply absent from both lists", () => {
    const plan = cropFoldersToPurge({ clearedHashes: ["aaa", "nofolder"], otherHashes: [], existingFolders: ["aaa"] });
    assert.deepStrictEqual(plan.purge, ["aaa"]);
    assert.deepStrictEqual(plan.kept, []);
  });

  test("an empty directory purges nothing", () => {
    const plan = cropFoldersToPurge({ clearedHashes: ["aaa"], otherHashes: [], existingFolders: [] });
    assert.deepStrictEqual(plan, { purge: [], kept: [], reason: null });
  });
});

describe("U-PURGE: unknown is never 'purge'", () => {
  test("the cleared class's hashes unreadable → nothing purged, the reason says so", () => {
    const plan = cropFoldersToPurge({ clearedHashes: null, otherHashes: ["x"], existingFolders: ["a", "b"] });
    assert.deepStrictEqual(plan.purge, []);
    assert.deepStrictEqual(plan.kept, ["a", "b"]);
    assert.match(plan.reason, /cleared collection's document hashes could not be read/);
  });

  test("the other classes' hashes unreadable → nothing purged, the reason says so", () => {
    const plan = cropFoldersToPurge({ clearedHashes: ["a"], otherHashes: null, existingFolders: ["a", "b"] });
    assert.deepStrictEqual(plan.purge, []);
    assert.match(plan.reason, /other collections' document hashes could not be read/);
  });

  test("non-string and empty entries are ignored, never matched", () => {
    const plan = cropFoldersToPurge({ clearedHashes: ["", null, 42, "a"], otherHashes: [undefined], existingFolders: ["a", "", null] });
    assert.deepStrictEqual(plan.purge, ["a"]);
    assert.deepStrictEqual(plan.kept, []);
  });
});

describe("U-PURGE: only the demo's own class family is consulted", () => {
  test("RAGChunk, RAGChunkV2 and RAGEval_* are RAG classes; other applications' classes are not", () => {
    for (const yes of ["RAGChunk", "RAGChunkV2", "RAGEval_t08_20260813", "RAGEval_x"]) assert.strictEqual(isRagClassName(yes), true, yes);
    for (const no of ["SA_nemotron_nano_12b_v2_vl_1_1783090873643", "Article", "ragchunk", "", null, 42, "XRAGChunk"]) assert.strictEqual(isRagClassName(no), false, String(no));
  });
});

describe("U-PURGE: the routes decide before the drop and delete by folder (source pins — F-37)", () => {
  const clearSrc = fs.readFileSync(path.join(__dirname, "../../src/app/api/ingest/clear/route.js"), "utf8");
  const previewSrc = fs.readFileSync(path.join(__dirname, "../../src/app/api/ingest/clear/preview/route.js"), "utf8");

  test("clear reads the hashes BEFORE clearSchema, and no longer rmSyncs the whole directory", () => {
    const read = clearSrc.indexOf("await weaviateClient.docHashes()");
    const drop = clearSrc.indexOf("await weaviateClient.clearSchema()");
    assert.ok(read > 0 && drop > read, "hashes are read before the drop");
    assert.ok(!clearSrc.includes("fs.rmSync(extractedImagesDir, { recursive: true, force: true })"), "the blanket purge is gone");
    assert.ok(clearSrc.includes("for (const folder of plan.purge)"));
    assert.ok(clearSrc.includes("imageFoldersPurged") && clearSrc.includes("imageFoldersKept") && clearSrc.includes("imagePurgeSkippedReason"));
  });

  test("preview reports what WOULD go under the field the dialog shows, plus the lists", () => {
    assert.ok(previewSrc.includes("extractedImageDirs: plan.purge.length"));
    assert.ok(previewSrc.includes("imageFoldersToPurge: plan.purge"));
    assert.ok(previewSrc.includes("imageFoldersKept: plan.kept"));
  });

  test("the Tidy Up dialog says what the purge now does", () => {
    const drawer = fs.readFileSync(path.join(__dirname, "../../src/components/StandardsDrawer.jsx"), "utf8");
    assert.ok(drawer.includes("that only this collection uses"));
    assert.ok(drawer.includes("crops another collection still cites are kept"));
    assert.ok(!drawer.includes("Delete every extracted diagram crop"));
  });
});
