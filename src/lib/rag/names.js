/**
 * Collection-name rule — ticket T17 (design D13; finding F-40), lifted from
 * `src/lib/vectordb/weaviate.js` (T21) so the retrieval resolver can apply it
 * without requiring the store client (config.js must not require
 * weaviate.js: weaviate.js already requires config.js). Pure; no I/O.
 *
 * `canonicalClassName` is the WRITE-path sanitiser: strip everything outside
 * [A-Za-z0-9_], capitalise, and default an empty result to "RAGChunk" — the
 * fallback the ingest route relies on (owner decision, session 5) and the one
 * the destructive routes refuse to use (T21). `isExplicitClassName` is the
 * predicate every refusal shares: a non-empty string the sanitiser returns
 * unchanged, starting with an uppercase letter.
 */

function canonicalClassName(name) {
  if (!name || typeof name !== "string" || !name.trim()) return "RAGChunk";
  const clean = name.trim().replace(/[^a-zA-Z0-9_]/g, "");
  if (!clean) return "RAGChunk";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * True only for a name that is exactly what would be read or dropped: a
 * non-empty string that the canonicaliser returns unchanged. "ragchunk",
 * " RAGChunk ", "my collection" and null are all refused — a caller names
 * its target precisely or not at all.
 */
function isExplicitClassName(name) {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    canonicalClassName(name) === name &&
    // Weaviate class names start with an uppercase letter; refusing "1abc" or
    // "_x" here gives a 400 instead of a confusing create failure later.
    /^[A-Z][A-Za-z0-9_]*$/.test(name)
  );
}

module.exports = { canonicalClassName, isExplicitClassName };
