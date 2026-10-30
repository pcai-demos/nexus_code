/**
 * T22 (design D10, finding F-42) — which extracted-image folders a Tidy Up
 * may delete.
 *
 * Crops live at public/extracted_images/<docHash>/… and are cited by chunks
 * through `imagePath`. Two collections can hold the same document (the T08
 * eval class holds four of the production corpus's thirteen), so a purge keyed
 * on the cleared class alone would delete crops another class still cites —
 * and once the directory is persistent (design D9) that deletion is for good.
 *
 * The rule: a folder is purged only when its docHash is held by the class being
 * cleared AND by no other RAG class in the store. Pure; the routes supply the
 * three inputs (the cleared class's hashes, every other RAG class's hashes, the
 * folders that exist) and do the deleting.
 *
 * Unknown is never "purge": a caller whose reads failed passes `null` for the
 * hashes and gets an empty purge list with the reason.
 */

const RAG_CLASS_PATTERN = /^RAG(Chunk|Eval_)/;

/** The classes whose chunks may cite crops — the demo's own family, never another application's. */
function isRagClassName(name) {
  return typeof name === "string" && RAG_CLASS_PATTERN.test(name);
}

/**
 * @param {object} args
 * @param {string[]|null} args.clearedHashes  docHashes held by the class being cleared (null = unknown)
 * @param {string[]|null} args.otherHashes    docHashes held by every OTHER RAG class (null = unknown)
 * @param {string[]}      args.existingFolders folder names present under extracted_images
 * @returns {{ purge: string[], kept: string[], reason: string|null }}
 */
function cropFoldersToPurge({ clearedHashes, otherHashes, existingFolders }) {
  const folders = Array.isArray(existingFolders) ? existingFolders.filter((f) => typeof f === "string" && f) : [];
  if (!Array.isArray(clearedHashes)) {
    return { purge: [], kept: folders.slice().sort(), reason: "the cleared collection's document hashes could not be read; nothing purged" };
  }
  if (!Array.isArray(otherHashes)) {
    return { purge: [], kept: folders.slice().sort(), reason: "the other collections' document hashes could not be read; nothing purged" };
  }
  const cleared = new Set(clearedHashes.filter((h) => typeof h === "string" && h));
  const other = new Set(otherHashes.filter((h) => typeof h === "string" && h));
  const purge = [];
  const kept = [];
  for (const f of folders) {
    if (cleared.has(f) && !other.has(f)) purge.push(f);
    else kept.push(f);
  }
  return { purge: purge.sort(), kept: kept.sort(), reason: null };
}

module.exports = { cropFoldersToPurge, isRagClassName, RAG_CLASS_PATTERN };
