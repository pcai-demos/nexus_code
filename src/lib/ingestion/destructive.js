/**
 * Request validation shared by the destructive ingest routes — ticket T21
 * (finding F-15, audit E38).
 *
 * The rule is PER-ROUTE (owner decision, session 5): `POST /api/ingest` keeps
 * its "RAGChunk" default because an unspecified WRITE landing in the demo's own
 * collection is intended; `clear`, `clear/preview` and `unload` refuse to
 * default because an unspecified DROP landing there is how two unconfirmed
 * clicks emptied the production class. Nothing here is a denylist: the demo's
 * own Tidy Up legitimately drops "RAGChunk" — it just has to say so.
 *
 * Both helpers return {status, code, error} PIECES rather than a response
 * body, so each route writes its `{ success:false, code, error }` literal
 * inline and the U-FAIL source walk can see that every non-2xx body is typed.
 */

const { INGEST_ERROR_CODES } = require("./state");
const { isExplicitClassName } = require("../vectordb/weaviate");

/**
 * The 400s a destructive request can earn before anything is constructed.
 * Returns null when the request may proceed.
 *
 * @param {{weaviateUrl?: unknown, weaviateCollection?: unknown}} body
 * @param {string[]} [alsoRequired]  other body keys that must be present
 *   (e.g. "filePath" for unload); reported under INGEST_CONFIG_MISSING.
 */
function destructiveRefusal(body, alsoRequired = []) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      status: 400,
      code: INGEST_ERROR_CODES.INGEST_CONFIG_MISSING,
      error: "The request body must be a JSON object.",
    };
  }
  // T17 (design D12, F-79): a PRESENT schema version must be one of the two
  // the flag has. Before T17 anything else ("two", "v2", 0, 3, true) was read
  // as v1 by the normaliser's write-path rule and the drop landed on the
  // unsuffixed class. Read on the RAW body, top-level then ragSettings — the
  // same two places resolveSchemaVersion reads — before any version is resolved — and BEFORE the required-key check, because unload's
  // required key (filePath under v1, sourceId under v2) depends on the version.
  const rs = body.ragSettings && typeof body.ragSettings === "object" && !Array.isArray(body.ragSettings) ? body.ragSettings : {};
  const present = (v) => v !== undefined && v !== null;
  const version = present(body.schemaVersion) ? body.schemaVersion : present(rs.schemaVersion) ? rs.schemaVersion : undefined;
  if (version !== undefined && ![1, "1", 2, "2"].includes(version)) {
    return {
      status: 400,
      code: INGEST_ERROR_CODES.SCHEMA_VERSION_INVALID,
      error:
        `schemaVersion ${JSON.stringify(version).slice(0, 50)} is not a schema version (1 or 2). ` +
        "A destructive operation never guesses which class a malformed version means. Nothing was dropped.",
    };
  }
  const isText = (v) => typeof v === "string" && v.trim().length > 0;
  const missing = alsoRequired.filter((k) => !isText(body[k]));
  if (!isText(body.weaviateUrl)) missing.unshift("weaviateUrl");
  if (missing.length > 0) {
    return {
      status: 400,
      code: INGEST_ERROR_CODES.INGEST_CONFIG_MISSING,
      error: `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} required (as a non-empty string).`,
    };
  }
  if (!isExplicitClassName(body.weaviateCollection)) {
    return {
      status: 400,
      code: INGEST_ERROR_CODES.COLLECTION_REQUIRED,
      error:
        "weaviateCollection is required and must name the exact collection " +
        `(received ${JSON.stringify(body.weaviateCollection === undefined ? null : body.weaviateCollection)}). ` +
        "Destructive operations never target a collection by default.",
    };
  }
  // T17 (design D12, F-80): the name must be the BASE collection — the schema
  // version selects the class. A name already carrying the `V2` suffix would
  // resolve `…V2V2` under version 2, and under version 1 would drop and
  // reshape the v2 class itself.
  if (/V2$/.test(body.weaviateCollection)) {
    return {
      status: 400,
      code: INGEST_ERROR_CODES.COLLECTION_NAME_INVALID,
      error:
        `weaviateCollection '${body.weaviateCollection}' ends in the schema-version suffix 'V2'. ` +
        "Name the base collection; the schema version selects the class " +
        `(schemaVersion 2 reads and drops '${body.weaviateCollection}' when the base name is '${body.weaviateCollection.slice(0, -2)}'). ` +
        "Nothing was dropped.",
    };
  }
  return null;
}

/**
 * Map an error thrown while performing the operation to a typed status.
 * Errors from WeaviateClient carry `code`; anything else is a failed
 * destructive operation (the drop/delete cannot be assumed to have happened).
 */
function thrownRefusal(err) {
  const code = err?.code;
  if (
    code === INGEST_ERROR_CODES.COLLECTION_REQUIRED ||
    code === INGEST_ERROR_CODES.COLLECTION_NAME_INVALID ||
    code === INGEST_ERROR_CODES.SCHEMA_VERSION_INVALID
  ) {
    return { status: 400, code, error: err.message };
  }
  return {
    status: 500,
    code: INGEST_ERROR_CODES.DESTRUCTIVE_OP_FAILED,
    error: err?.message || String(err),
  };
}

module.exports = { destructiveRefusal, thrownRefusal };
