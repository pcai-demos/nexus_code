/**
 * Chunk identity — ticket T05 (audit E08 / E25 / FM-D2; finding F-50).
 *
 * Pure module: the ONE place a chunk's identity is defined, so the ingest
 * write path, the duplicate check, T06's supersede filter and T07's ledger
 * events all agree on it. No Next.js, no orchestrator, no network — it is
 * meant to be transportable (owner direction, T09 D7).
 *
 * The identity has three parts, and each answers a different question:
 *
 *   sourceId   WHERE the document lives: the request's file path, normalised
 *              exactly as the ingest route's resolvePath() normalises it and
 *              taken relative to `public/`. A rename or a move is a new
 *              sourceId (F-50 case 3): the chunks are indexed under the new
 *              name instead of being skipped because the bytes matched.
 *
 *   docVersion WHICH parse of the document this is: the content hash (the
 *              md5 `docHash` the rest of the pipeline already keys on) plus
 *              a fingerprint of everything that shapes the chunks — the
 *              effective chunk settings, the VLM model that captions figures,
 *              and IDENTITY_VERSION, a constant that any chunking-rule change
 *              bumps (T19, T20). Same bytes + same settings → same version, so
 *              a re-upload is skipped; change a setting → a new version, so
 *              the re-upload is re-indexed WITHOUT `overwrite` (F-50 case 1).
 *              The engine that actually parsed the file is deliberately NOT
 *              part of it: it is only known after parsing and the bridge can
 *              fall back run to run, which would make identity
 *              nondeterministic. It is persisted as a fact instead (`engine`).
 *
 *   chunkIndex WHERE in the document: the parser's per-document sequence,
 *              which was computed on every chunk and then dropped at write
 *              time (E08).
 *
 * The object id is RFC-4122 v5 over the three, so re-sending a chunk is an
 * upsert in Weaviate (verified on 1.25.6, 2026-09-04: the same id twice →
 * one object) and a re-ingest can never duplicate (E25 / FM-D2).
 */

const crypto = require("crypto");
const path = require("path");
// T33: the mode vocabulary of the detail passes — the pure module owns it (no I/O, no require), this one fingerprints it.
const { DETAIL_PASS_DEFAULT, normaliseDetailMode } = require("../ingestion/detail_pass");
// T35: the OCR mode vocabulary the same way — the pure module owns it, this one fingerprints it.
const { OCR_DEFAULT, normaliseOcrMode } = require("../ingestion/ocr");

/**
 * The v5 namespace for chunk ids. A fixed literal: change it and every id in
 * every v2 collection changes, which is a re-index — so do not.
 */
const NAMESPACE = "1b4e28ba-2fa1-11d2-883f-b9a761bde3fb";

/**
 * Bump when a chunking rule changes in a way that should re-index existing
 * documents under v2 (T19 heading handling, T20 min-chunk policy, a new
 * separator set …). Part of every docVersion.
 *
 * 1 → 2 (T32, design D7): the caption is chunk content, and T32 changed what
 * every caption IS (a generic verdict-first prompt; a `textOnly` page emits
 * no chunk), so every captioned document's chunk set is different. Without
 * the bump a `skip` re-ingest of production would say "already indexed" and
 * keep the old captions forever (the A7 shape, silently). Every document's
 * docVersion moves once; production is re-ingested only when the owner says
 * (charter D4) — until then the store holds the old versions, correctly.
 */
/*
 * 2 → 3 (T33, design D6): a page whose caption admits its detail did not fit
 * into text gets ONE MORE isVisualElement chunk — the tiled detail pass
 * (`detail_pass.js`) — and the trigger depends on the caption (data), not on
 * a setting, so no fingerprint key can express it in advance. A chunk set
 * changes; the version moves once for every document; a `skip` re-ingest
 * re-parses (the captions recall from the memo, the tiles are new) — on
 * production only on the owner's word (D11).
 */
/*
 * 3 → 4 (T34, design D3, D9): an UNPAGINATED docling file's chunks change
 * their text — `[Section: <heading path>]` replaces the fabricated
 * `[Page 1 - …]` stamp (F-11) — and, riding the same bump (design §12a),
 * a keyed page whose tiles held only the legend's rows emits NO detail
 * chunk (F-142) and a transcribe chunk's cut lines are re-joined (F-144).
 * A chunk set and chunk texts change; the version moves once for every
 * document; production follows through one more owner-instructed
 * re-ingest (≈ 5 min — every caption and tile recalled from the memo).
 */
/*
 * 4 → 5 (T35, design D2, D6–D9): a page whose text layer is EMPTY is read by
 * OCR and its OCR lines become the page's text — text chunks appear where
 * there were none, the page's caption moves to the `withText` prompt (D7)
 * and its transcribe detail plan is not taken (D8): a chunk-set change no
 * fingerprint key expresses in advance (the trigger is the page's own
 * emptiness). Every docVersion moves once; production follows through one
 * more owner-instructed re-ingest (D12 — every caption and tile recalled
 * but the two re-keyed brochure captions, ≈ 4 min).
 */
/*
 * 5 → 6 (T41, design D2–D7): the chunk TEXT changes on every path — a piece
 * under minChunkSize is folded into a neighbour instead of dropped (T20), a
 * markdown heading opens the paragraph it introduces and an oversize
 * paragraph is split (T19), docling's markdown is unescaped and marker-free
 * (F-146), a deck's footer / slide-number placeholders leave the slide's
 * text (F-145) and a hidden slide emits no chunk (F-165). A chunk set and
 * chunk texts change for every document; the version moves once for all;
 * production follows through one owner-instructed re-ingest (≈ 3 min —
 * every caption and tile recalled from the memo, 0 model calls predicted).
 */
// T18 (design D2–D7): 6 → 7 — the running lines a document repeats leave every PDF page before the split, the heading
// pick changed on every paginated page, `\r\n` normalised; every paginated document's chunk text and every caption
// chunk's header line change, so every docVersion moves once more (the production re-ingest on the owner's word).
/*
 * 7 → 8 (T45, design D1 a, D5–D7, D11, D13; F-175, F-187, F-188): the tiled detail pass applies the TILE-EDGE RULE
 * before its merge — a tile votes on a label only when it holds a whole cluster of the label's occurrences in the
 * page's text layer (the bridge's word boxes) — so a conflicted page's INDEX / COUNTS / CONFLICTS lines change (the
 * Site Plan's 301 / 303 become plain Halton entries that count) and a same-tile multi-value is named apart from a
 * disagreement (Miele p68's `MULTI-VALUED:` line). The trigger is data (which tiles read what, where the labels
 * lie), which no fingerprint key can express in advance; every docVersion moves once more, and production follows
 * through ONE ≈ 3-minute re-ingest on the owner's explicit word — 0 model calls (every caption and tile recalled).
 */
/*
 * 8 → 9 (T46 + T47 + F-191 — one window, design t46-design.md D10, t47-design.md D9 a): a caption's labels take the
 * page's printed spelling where the text layer settles one (T47 — seven captions on production); a dimensioned
 * drawing's caption carries its CHAIN block in place of its free DESCRIPTION, the points computed and the chain's
 * long overall dimension settled by the drawing's own geometry (T46 — Figure 15 on production); the tile-edge rule
 * drops a vote only when a holder tile also read the label (F-191 — Fervi p20's lost legend entry returns). Every
 * docVersion moves once more; production follows through ONE re-ingest on the owner's word — the seven chain asks
 * (≈ 45 s each) and the seven geometry reads are the only new work; every caption and tile recalled from the memo.
 */
/*
 * 9 → 10 (T57, design t57-design.md §2.5, D1–D9 approved 2026-09-28; F-215): the tiled detail pass runs a DISCLOSE-ONLY
 * COLOUR CHECK after its merge — on a keyed-index page whose key names colours, each reading is checked against the
 * page's own colour at its label (the legend's swatches found on the page, the fills of the paths, the pixels under a
 * label for a building drawn in an image): a reading the colour contradicts becomes a disclosed conflict (never
 * replaced) and a tile disagreement the colour settles a plain entry that counts — so a colour-keyed page's INDEX /
 * COUNTS / CONFLICTS lines change (the Site Plan's page 1: 20 readings disclosed, 4 conflicts settled). The trigger is
 * data (the page's colours), which no fingerprint key can express in advance; every docVersion moves once more, and
 * production follows through ONE re-ingest on the owner's word — 0 model calls (every caption and tile recalled; the
 * check reads the PDF, never a model).
 */
/*
 * 10 → 11 (T58, design t58-design.md D1 a, D2 a, approved 2026-09-29; F-219): a keyed-index chunk that carries a
 * conflict writes its COUNTS rows as what the index supports — "The Ellerton: 11 confirmed (…); possibly also 173, 198,
 * 218, 246 (see CONFLICTS)", and a category named only in conflicts gets its own row ("0 confirmed; possibly …"); a chunk
 * with no conflict is byte-identical. Four production chunks change (the Site Plan's page 1, SSX125 pages 8, 9, 20);
 * every docVersion moves once more, and production follows through ONE re-ingest on the owner's word — 0 model calls
 * (every caption and tile recalled from the memo; no reading, plot or conflict moves).
 */
/*
 * 11 → 12 (T59, design t59-design.md D1 a, D2 a, D3 a, approved 2026-09-29; F-222, F-218, F-225): a keyed-index chunk
 * says what its RANGE labels are — a COUNTS row that holds a range names it and its size ("1 of the 13 is a range counted
 * as one label — 255 - 266 (12 numbers); …"), a range among a row's possible labels is named with its size; a label a
 * wider range of its category already names is subsumed (the Site Plan's phantom "255 - 256"); and the colour check
 * places a range label as the page prints it ("220-" "237"), so 220 - 237 is disclosed "Affordable Housing Rented or
 * Affordable Housing Shared Ownership". One production chunk changes (the Site Plan's page 1); every docVersion moves
 * once more, and production follows through ONE re-ingest on the owner's word — 0 model calls (every caption and tile
 * recalled from the memo; the colour layer is read from the PDF).
 */
/*
 * 12 → 13 (T60, design t60-design.md D1 a, D2 a, approved 2026-09-29; F-228): a keyed-index chunk adds up its COUNTS rows
 * by the text the page's legend prints with each name ("4 bedroom home: 65 confirmed (…); possibly also 23 more: …") —
 * the text read by the colour check's own legend geometry — and its CONFLICTS line says what its labels name when one is
 * a range ("the 25 labels name 42 numbers"). One production chunk changes (the Site Plan's page 1); every docVersion moves
 * once more, and production follows through ONE re-ingest on the owner's word — 0 model calls (every caption and tile
 * recalled from the memo; the colour layer is read from the PDF).
 */
/*
 * 13 → 14 (T61, design t61-design.md D1 a, approved 2026-09-30; F-215's residue): on a colour-keyed plan, where three
 * independent cues on the page — the nearest footprint to the label, the nearest house-sized footprint and the footprint
 * nearest the plot's own parking bays — all name one design within 10 pt, with no image under the label, the index states
 * that design (a reading replaced, a disclosure resolved; the colour check's three-cue settle). One production chunk
 * changes (the Site Plan's page 1: 13 readings settled, every one to the census's truth); every docVersion moves once
 * more, and production follows through ONE re-ingest on the owner's word — 0 model calls (every caption and tile
 * recalled from the memo; the colour layer is read from the PDF).
 */
const IDENTITY_VERSION = 14;

/** The settings that shape chunks. Order is irrelevant; keys are sorted. */
const FINGERPRINT_KEYS = Object.freeze(["chunkSize", "chunkOverlap", "minChunkSize", "vlmModelName", "captionFigures", "captionPageBudget", "detailPasses", "ocrNoTextPages"]);

/**
 * T24 (design D8): a fingerprinted key whose value is its DEFAULT is left
 * out of the canonical input, exactly as an absent key was before the key
 * existed — so adding `captionFigures` (default on) changed no existing
 * docVersion, and only a captions-OFF ingest is a new version (it emits no
 * isVisualElement chunk: a different chunk set, T05's rule). A key listed
 * here is fingerprinted only when it differs from its default.
 *
 * T31 (workshop design D5, amendment A1): `captionPageBudget` (default 0 =
 * every page) the same way — a non-zero budget leaves pages uncaptioned, a
 * different chunk set, so it is a new version; the default, absent or
 * unreadable is the pre-T31 fingerprint and no existing docVersion moves.
 */
/*
 * T33 (design D6, option E): `detailPasses` (default "auto") the same way —
 * "all" tiles every visual page and "off" none, each a different chunk set,
 * so each is its own version; the default, absent or unreadable is omitted
 * (the version moved once for everyone by IDENTITY_VERSION 3, not by this key).
 */
/*
 * T35 (design D3, D9): `ocrNoTextPages` (default "auto") the same way — "off" leaves a no-text page without text,
 * a different chunk set, so its own version; the default, absent or unreadable is omitted (the version moved once
 * for everyone by IDENTITY_VERSION 5, not by this key).
 */
const FINGERPRINT_DEFAULTS = Object.freeze({ captionFigures: true, captionPageBudget: 0, detailPasses: DETAIL_PASS_DEFAULT, ocrNoTextPages: OCR_DEFAULT });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RFC-4122 version-5 UUID (SHA-1 of namespace bytes + name bytes, version
 * and variant bits set). Matches Python's uuid.uuid5 and the `uuid`
 * package's v5 — pinned in U-IDS against a known vector.
 */
function uuidv5(namespace, name) {
  if (typeof namespace !== "string" || !UUID_RE.test(namespace)) {
    throw new Error(`uuidv5: namespace must be a UUID string, got ${JSON.stringify(namespace)}`);
  }
  if (typeof name !== "string") {
    throw new Error(`uuidv5: name must be a string, got ${typeof name}`);
  }
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = crypto.createHash("sha1").update(nsBytes).update(Buffer.from(name, "utf8")).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC-4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The request path, normalised the way ingest/route.js resolvePath() does
 * (backslashes to "/", a leading "/" dropped, a leading "public/" dropped)
 * and with "./" segments removed — so the same file reached by any of those
 * spellings has one sourceId. Never empty: an unusable input throws, because
 * an identity built on "" would make every such document the same document.
 */
function sourceIdFor(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error(`sourceIdFor: a file path is required, got ${JSON.stringify(filePath)}`);
  }
  let clean = filePath.trim().replace(/\\/g, "/");
  clean = clean.replace(/^\/+/, "");
  if (clean.startsWith("public/")) clean = clean.slice("public/".length);
  // Collapse "." and ".." the way the route's path.join does, so one file
  // reached by two spellings is one document. A path that escapes upward
  // is refused: it would name a file outside public/ (and resolvePath has
  // no guard of its own — F-59).
  clean = path.posix.normalize(clean.replace(/^\/+/, ""));
  if (clean === "." || clean === "" || clean === "/") {
    throw new Error(`sourceIdFor: "${filePath}" normalises to an empty path`);
  }
  if (clean === ".." || clean.startsWith("../") || clean.startsWith("/")) {
    throw new Error(`sourceIdFor: "${filePath}" escapes the public/ root`);
  }
  return clean;
}

/**
 * Canonical JSON: sorted keys, only the fingerprint keys, null for absent.
 * A numeric string is the number it spells (the chunker coerces `"1000"`
 * and `1000` identically, so they must be one version — an API caller and
 * the UI's parseInt'd value would otherwise disagree about identity).
 */
function canonicalFingerprintInput(settings = {}) {
  const out = { identityVersion: IDENTITY_VERSION };
  for (const key of FINGERPRINT_KEYS) {
    const v = settings[key];
    if (Object.prototype.hasOwnProperty.call(FINGERPRINT_DEFAULTS, key)) {
      // A defaulted key: absent, empty or equal to its default → omitted.
      const def = FINGERPRINT_DEFAULTS[key];
      const value = typeof def === "boolean" ? asBoolean(v, def) : typeof def === "number" ? asNonNegativeInteger(v, def) : key === "detailPasses" ? normaliseDetailMode(v) : key === "ocrNoTextPages" ? normaliseOcrMode(v) : v;
      if (value === def || value === undefined) continue;
      out[key] = value;
      continue;
    }
    if (v === undefined || v === null || v === "") out[key] = null;
    else if (typeof v === "number") out[key] = v;
    else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) out[key] = Number(v);
    else out[key] = String(v);
  }
  return JSON.stringify(out, Object.keys(out).sort());
}

/** T31: a page budget — a non-negative integer, or the numeric string of one; anything absent or unreadable is the default. */
function asNonNegativeInteger(v, def) {
  if (v === undefined || v === null || v === "") return def;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : def;
}

/** `false` / `"false"` / `0` are off; `true` / `"true"` / `1` on; anything absent or unreadable is the default. */
function asBoolean(v, def) {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "false" || t === "0" || t === "off" || t === "no") return false;
    if (t === "true" || t === "1" || t === "on" || t === "yes") return true;
  }
  return def;
}

/**
 * 12 hex characters of sha256 over the canonical settings. Short enough to
 * read in a log, long enough that two settings profiles cannot collide by
 * accident (48 bits).
 */
function fingerprintFor(settings) {
  return crypto.createHash("sha256").update(canonicalFingerprintInput(settings)).digest("hex").slice(0, 12);
}

/** `${docHash}.${fingerprint}` — the content hash first so a log reader can eyeball it. */
function docVersionFor(docHash, settings) {
  if (typeof docHash !== "string" || !/^[0-9a-f]+$/i.test(docHash)) {
    throw new Error(`docVersionFor: docHash must be a hex string, got ${JSON.stringify(docHash)}`);
  }
  return `${docHash.toLowerCase()}.${fingerprintFor(settings)}`;
}

/** The name the id is derived from. Exposed so a reader can reproduce an id by hand. */
function identityNameFor(sourceId, docVersion, chunkIndex) {
  if (typeof sourceId !== "string" || !sourceId) throw new Error("chunk identity: sourceId is required");
  if (typeof docVersion !== "string" || !docVersion) throw new Error("chunk identity: docVersion is required");
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error(`chunk identity: chunkIndex must be a non-negative integer, got ${JSON.stringify(chunkIndex)}`);
  }
  return `${sourceId}:${docVersion}:${chunkIndex}`;
}

/** The deterministic object id for one chunk. */
function chunkIdFor(sourceId, docVersion, chunkIndex) {
  return uuidv5(NAMESPACE, identityNameFor(sourceId, docVersion, chunkIndex));
}

module.exports = {
  NAMESPACE,
  IDENTITY_VERSION,
  FINGERPRINT_KEYS,
  FINGERPRINT_DEFAULTS,
  uuidv5,
  sourceIdFor,
  fingerprintFor,
  docVersionFor,
  identityNameFor,
  chunkIdFor,
};
