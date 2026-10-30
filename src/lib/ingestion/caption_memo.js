/**
 * The persisted caption memo — ticket T29 (finding F-122; design
 * `inputs/rag-audit/t29-design.md`).
 *
 * A figure caption, once obtained from the VLM, is stored on the ledger
 * volume under a key made of everything the client can name about the
 * request: the crop's bytes, the model's name AND digest, the server it was
 * asked of, the prompt and the decoding (design D1, the owner's stricter
 * option). Every later ingest of the same crop bytes under the same key
 * reuses the stored outcome without a request — so two ingests of one
 * document are byte-identical by construction, in any server state, and
 * the second costs no VLM time. A changed model, digest, server, prompt or
 * decoding is a different key: a natural miss, no invalidation logic.
 *
 * Pure module: a directory in, a record out. No parser, no Next, no store,
 * no network (the captioner resolves the server's identity; this module
 * only hashes what it is given). CommonJS like `ids.js` and `ledger.js`;
 * the file system is injectable for U-MEMO. The memo makes captions
 * REPRODUCIBLE, not canonical: a record holds whatever the server answered
 * the first time its key was asked (design §2.1), and says when, for which
 * job and from which source (`vlm` | `seed`).
 *
 * Layout: `<dir>/<key[0:2]>/<key>.json`, one record per key, written as a
 * temp file then renamed (atomic within a directory on NFS v4). The
 * default directory is `nexcode-data/state/rag/captions/` beside
 * `ledger.jsonl` (the app-state claim: survives a roll, lost by
 * `tilt down` — F-87 — and rebuilt by the next ingests or the seed);
 * RAG_CAPTION_MEMO_DIR overrides it (tests; never production).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** The record format; a record with another `v` is unreadable (a miss). */
const MEMO_RECORD_VERSION = 1;
/** The key scheme; part of the hashed material so a future scheme cannot collide. */
const MEMO_KEY_SCHEME = "captionmemo/v1";
/**
 * The outcomes worth remembering (design D2). Failures never; `empty` never.
 * T32 (design D8): `textOnly` — the model read the page and found only text
 * — is a verdict like `decorative` and is remembered the same way (a record
 * with `caption: null`); the record format stays v1 (additive).
 */
const MEMOISED_OUTCOMES = Object.freeze(["captioned", "decorative", "textOnly", "truncated"]);
/** Where a record came from. */
const MEMO_SOURCES = Object.freeze(["vlm", "seed"]);

const md5 = (data) => crypto.createHash("md5").update(data).digest("hex");
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** JSON with every object's keys sorted, at every depth — order-independent. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The server half of the key: the origin the captioner talks to, with the
 * `/v1` suffix and trailing slashes the page's default carries stripped
 * (the captioner's own normalisation) — so the page's translated default
 * (`http://ollama.ollama.svc.cluster.local:11434/v1/`) and the harness's
 * bare URL name the same server. An unparsable value is used as given,
 * lower-cased, so a key can still be formed and compared.
 */
function serverOrigin(ollamaUrl) {
  const base = String(ollamaUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  try {
    return new URL(base).origin.toLowerCase();
  } catch (err) {
    return base.toLowerCase();
  }
}

/**
 * The key. Every part is required (a missing part is a programming error,
 * not a miss — the caller decides availability, e.g. when the model's
 * digest cannot be read). Resolves to the key and the material it was
 * hashed from, so a record can carry its own provenance.
 */
function memoKey({ cropBytes, cropMd5, modelName, modelDigest, ollamaUrl, server, prompt, promptMd5, decoding }) {
  const crop = cropMd5 || (cropBytes ? md5(cropBytes) : null);
  const promptHash = promptMd5 || (typeof prompt === "string" ? md5(prompt) : null);
  const origin = server || (ollamaUrl ? serverOrigin(ollamaUrl) : null);
  const parts = { crop, modelName, modelDigest, origin, promptHash, decoding };
  for (const [name, value] of Object.entries(parts)) {
    if (value === null || value === undefined || value === "") throw new Error(`caption memo key: ${name} is required`);
  }
  if (!/^[0-9a-f]{32}$/.test(crop)) throw new Error("caption memo key: cropMd5 must be 32 hex characters");
  const decodingCanonical = canonicalJson(decoding);
  const material = [
    MEMO_KEY_SCHEME,
    `crop=md5:${crop}`,
    `model=${modelName}`,
    `digest=${modelDigest}`,
    `server=${origin}`,
    `prompt=md5:${promptHash}`,
    `decoding=${decodingCanonical}`,
  ].join("\n");
  return { key: sha256(material), cropMd5: crop, modelName, modelDigest, server: origin, promptMd5: promptHash, decodingCanonical, material };
}

function defaultMemoDir() {
  const fromEnv = process.env.RAG_CAPTION_MEMO_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(process.cwd(), "nexcode-data", "state", "rag", "captions");
}

function recordPath(dir, key) {
  if (!/^[0-9a-f]{64}$/.test(String(key))) throw new Error("caption memo: a key is 64 hex characters");
  return path.join(dir, key.slice(0, 2), `${key}.json`);
}

/**
 * Build a record from a key's material and an outcome. `caption` is a
 * string iff `captioned`. `hint` is for humans and listings (the first
 * document the crop was seen in) and is not identity; `seed` exists only on
 * seeded records.
 */
function makeRecord({ keyInfo, cropBytes, outcome, caption, source = "vlm", jobId = null, ms = null, capturedAt = null, hint = null, seed = null }) {
  if (!keyInfo || !keyInfo.key) throw new Error("caption memo record: keyInfo is required");
  if (!MEMOISED_OUTCOMES.includes(outcome)) throw new Error(`caption memo record: outcome ${outcome} is not memoised`);
  if (!MEMO_SOURCES.includes(source)) throw new Error(`caption memo record: source ${source} is unknown`);
  if (outcome === "captioned" && (typeof caption !== "string" || !caption)) throw new Error("caption memo record: a captioned record needs its caption");
  let decoding = null;
  try { decoding = JSON.parse(keyInfo.decodingCanonical); } catch (err) { decoding = null; }
  const record = {
    v: MEMO_RECORD_VERSION,
    key: keyInfo.key,
    crop: { md5: keyInfo.cropMd5, bytes: cropBytes ? cropBytes.length : null },
    model: keyInfo.modelName,
    modelDigest: keyInfo.modelDigest,
    server: keyInfo.server,
    promptMd5: keyInfo.promptMd5,
    decoding,
    outcome,
    caption: outcome === "captioned" ? caption : null,
    source,
    capturedAt: capturedAt || new Date().toISOString(),
    jobId: jobId || null,
    ms: Number.isFinite(ms) ? ms : null,
    hint: hint && typeof hint === "object" ? { ...hint } : null,
  };
  if (seed && typeof seed === "object") record.seed = { ...seed };
  return record;
}

/** A record read back is trusted only when it is whole and matches its key. */
function validateRecord(record, key = null) {
  if (!record || typeof record !== "object") return "not an object";
  if (record.v !== MEMO_RECORD_VERSION) return `record version ${record.v}`;
  if (typeof record.key !== "string" || !/^[0-9a-f]{64}$/.test(record.key)) return "no key";
  if (key && record.key !== key) return "key mismatch";
  if (!MEMOISED_OUTCOMES.includes(record.outcome)) return `outcome ${record.outcome}`;
  if (record.outcome === "captioned" && (typeof record.caption !== "string" || !record.caption)) return "captioned without a caption";
  if (record.outcome !== "captioned" && record.caption !== null && record.caption !== undefined) return "a caption on a non-captioned outcome";
  if (!MEMO_SOURCES.includes(record.source)) return `source ${record.source}`;
  return null;
}

/**
 * Open a memo directory. Never throws on use: a read problem is a miss, a
 * write problem is `{ ok: false }` with the reason, both logged once per
 * call so the pod log says what the ledger cannot.
 */
function openCaptionMemo(options = {}) {
  const { dir = defaultMemoDir(), fsImpl = fs, log = console } = options;

  function get(key) {
    let file;
    try { file = recordPath(dir, key); } catch (err) { return null; }
    let text;
    try {
      if (!fsImpl.existsSync(file)) return null;
      text = fsImpl.readFileSync(file, "utf8");
    } catch (err) {
      log.warn(`[Caption memo unreadable] ${key.slice(0, 12)}…: ${err.message}`);
      return null;
    }
    let record;
    try { record = JSON.parse(text); } catch (err) {
      log.warn(`[Caption memo unreadable] ${key.slice(0, 12)}…: not JSON (${err.message}); treated as a miss`);
      return null;
    }
    const problem = validateRecord(record, key);
    if (problem) {
      log.warn(`[Caption memo unreadable] ${key.slice(0, 12)}…: ${problem}; treated as a miss`);
      return null;
    }
    return record;
  }

  function has(key) {
    try { return fsImpl.existsSync(recordPath(dir, key)); } catch (err) { return false; }
  }

  function put(record) {
    const problem = validateRecord(record);
    if (problem) return { ok: false, path: null, error: `refused: ${problem}` };
    let file;
    try { file = recordPath(dir, record.key); } catch (err) { return { ok: false, path: null, error: err.message }; }
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    try {
      fsImpl.mkdirSync(path.dirname(file), { recursive: true });
      fsImpl.writeFileSync(tmp, JSON.stringify(record, null, 1));
      fsImpl.renameSync(tmp, file);
      return { ok: true, path: file, error: null };
    } catch (err) {
      try { fsImpl.rmSync(tmp, { force: true }); } catch (e) { /* the temp file is the only thing that could be left */ }
      log.warn(`[Caption memo write failed] ${record.key.slice(0, 12)}…: ${err.message}`);
      return { ok: false, path: file, error: String(err.message || err).slice(0, 200) };
    }
  }

  /** For a suite that owns its fixture's keys (F-95). Returns whether a record was removed. */
  function remove(key) {
    try {
      const file = recordPath(dir, key);
      if (!fsImpl.existsSync(file)) return false;
      fsImpl.rmSync(file, { force: true });
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Read-only: what the memo holds (the state probe's view). */
  function list({ withRecords = false } = {}) {
    const out = { dir, exists: false, count: 0, bytes: 0, unreadable: 0, bySource: {}, byOutcome: {}, byModel: {}, records: withRecords ? [] : undefined };
    try {
      if (!fsImpl.existsSync(dir)) return out;
      out.exists = true;
      for (const bucket of fsImpl.readdirSync(dir)) {
        const bucketDir = path.join(dir, bucket);
        let entries;
        try { entries = fsImpl.readdirSync(bucketDir); } catch (err) { continue; }
        for (const name of entries) {
          if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
          const file = path.join(bucketDir, name);
          let record = null;
          try {
            const text = fsImpl.readFileSync(file, "utf8");
            out.bytes += Buffer.byteLength(text);
            record = JSON.parse(text);
          } catch (err) { record = null; }
          if (!record || validateRecord(record, name.slice(0, 64))) { out.unreadable++; continue; }
          out.count++;
          out.bySource[record.source] = (out.bySource[record.source] || 0) + 1;
          out.byOutcome[record.outcome] = (out.byOutcome[record.outcome] || 0) + 1;
          const modelLabel = `${record.model}@${String(record.modelDigest || "").slice(0, 12)}`;
          out.byModel[modelLabel] = (out.byModel[modelLabel] || 0) + 1;
          if (withRecords) out.records.push({ key: record.key, outcome: record.outcome, source: record.source, capturedAt: record.capturedAt, hint: record.hint, cropMd5: record.crop?.md5 ?? null, captionMd5: record.caption ? md5(record.caption) : null, captionLength: record.caption ? record.caption.length : null });
        }
      }
    } catch (err) {
      out.error = String(err.message || err).slice(0, 200);
    }
    return out;
  }

  return { dir, get, has, put, remove, list, path: (key) => recordPath(dir, key) };
}

module.exports = {
  MEMO_RECORD_VERSION,
  MEMO_KEY_SCHEME,
  MEMOISED_OUTCOMES,
  MEMO_SOURCES,
  canonicalJson,
  serverOrigin,
  memoKey,
  makeRecord,
  validateRecord,
  defaultMemoDir,
  recordPath,
  openCaptionMemo,
};
