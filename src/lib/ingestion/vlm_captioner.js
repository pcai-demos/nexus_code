/**
 * VLM figure captioning — ticket T24 (audit E14 / FM-N2; findings F-17,
 * F-116, F-118, F-119; design `inputs/rag-audit/t24-design.md`).
 *
 * Pure module: a crop's path in, one OUTCOME record out. No parser, no
 * Next.js, no store — the fetch is injectable so the request shape is
 * asserted offline (U-CAPTION) and the module travels (owner direction,
 * T09 D7). CommonJS like the rest of `src/lib` (it used to be the one ESM
 * file `parser.js` required — F-4).
 *
 * What T24 changed, and why (measured on this deployment, 2026-09-11):
 *
 *   - `options: CAPTION_DECODING` on every request. The shipped request sent
 *     none, so the model's own Modelfile sampled every caption at
 *     temperature 1 (two passes over 49 production crops: 0 byte-identical,
 *     four decorative flips, "Radleigh" → "Radaigh").
 *   - `resetCaptionServer` before a document's first figure. At temperature
 *     0 this Ollama's reply is a function of the prompt cache's state when
 *     the prompt is evaluated (four different texts from one crop, each
 *     reproducible in its own context); an empty cache and a fixed request
 *     order are the one state every ingest can reproduce.
 *   - One outcome per figure instead of `null` for six reasons. X6 could
 *     not tell a `[DECORATIVE_ELEMENT]` verdict from a timeout; nor could
 *     the ledger, the status frame or the trace.
 *   - CAPTION_TIMEOUT_MS 120 s, about four times the slowest generation
 *     measured (28.8 s), with a cold reload (≈ 4.5 s) inside it. The old
 *     60 s abort lost the Site Plan's site map one ingest in six, silently.
 *   - CAPTION_MAX_TOKENS 6,144: greedy decoding loops on a few crops and
 *     would otherwise run into the abort on every ingest (A9).
 *   - Log lines name the document and the page. `fig_1_0.png` is every
 *     document's page 1.
 *
 * T32 (F-100, F-121, F-129; design `inputs/rag-audit/t32-design.md`): the
 * prompt is GENERIC and verdict-first. One request per page whose reply is
 * `[NO_VISUAL_CONTENT]` (a new remembered outcome, `textOnly` — the page's
 * text chunks are its index entry, no caption chunk), `[DECORATIVE_ELEMENT]`
 * (as before), or a caption made of a `TITLE / TYPE / SUBJECTS` header, a
 * verbatim `TRANSCRIPTION:` of every legible label, number and unit, and a
 * bounded `DESCRIPTION:`. Two prompt variants, chosen by the page's text
 * layer (D2): a page WITH extracted text may answer `[NO_VISUAL_CONTENT]`
 * (its words are already indexed); a page WITHOUT one (a brochure, a scan)
 * is transcribed whole — its caption is its only index entry. No document,
 * figure or design is named in either prompt (the old prompt's examples were
 * the two demo documents and its three forced sections stamped house-plan
 * filler onto every caption in the corpus — 191 of 192 said "site plan").
 * The decoding names the repetition settings it relies on (F-132), so the
 * memo key stops depending on the server's defaults.
 *
 * T29 (F-122): the server's greedy path drifts between blocks of time for
 * the same request, cache state and placement — so a crop is asked ONCE and
 * its outcome kept in the persisted caption memo (`caption_memo.js`), keyed
 * by the crop's bytes, the model's name and digest, the server, the prompt
 * and the decoding. `captionFigure` looks the memo up before any request;
 * `resolveCaptionServer` reads the model's digest once per document.
 *
 * T37 (T32 design D6; design `inputs/rag-audit/t37-design.md`): the default
 * captioner is the CHAT model, `qwen3.8:27b` — T32's arm C. Measured on the
 * six-document A/B (t32-design §11b, 293 pages an arm): equal to `qwen3-vl:30b`
 * (arm B) on every gate question, 0 truncated pages against the VLM's 4 (the
 * legacy prompt's 22), never looping, about a quarter of the hidden thinking
 * per page, and one resident model fewer on an Ollama that serves three
 * (F-14). The value lives in ONE exported constant, `DEFAULT_CAPTION_MODEL`,
 * which the parser reads for BOTH of its fallbacks (the fingerprint input and
 * the model asked and recorded); the page's and the drawer's literals are
 * pinned equal to it by U-SETTINGS (the page-shape runners read the page's
 * literal by regex, so it stays a literal). A different model writes
 * different captions, so the value is part of every document's version
 * fingerprint (`ids.FINGERPRINT_KEYS`): the page-shape production fingerprint
 * moved 42ca5ed33c98 → 9087fdb24b59 by the value alone, and every production
 * document's version moves once, on the owner's re-caption (charter D4).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { memoKey, makeRecord, MEMOISED_OUTCOMES } = require("./caption_memo");

/**
 * The generation cap (design §11a A9). Greedy decoding can fall into a
 * repetition loop on some crops (SSX125 p7, the 50-page fixture's p12 —
 * measured 2026-09-11) and, uncapped, runs until the abort — the same crop
 * every ingest, so the file would be `partial` forever. The longest
 * legitimate reply measured is 4,844 tokens (thinking tokens included);
 * 6,144 lets every one through and stops a loop inside ~50 s. A capped
 * reply is the `truncated` outcome: dropped, counted, not a failure.
 */
const CAPTION_MAX_TOKENS = 6144;

/**
 * Greedy decoding, capped. Constants of the captioner, not settings (T24
 * design D2, A9). T32 (design D5, F-132): the repetition settings the
 * captioner has always relied on are NAMED — `repeat_penalty 1.1` and
 * `repeat_last_n 64` are Ollama's own defaults, in force on every caption
 * since T24 but outside the memo key until now — so an Ollama upgrade that
 * moved a default could not change every caption's bytes without a key miss.
 * One constant for both the shipped VLM and the model arm (`qwen3.8:27b`).
 * The probe (t32-design §0b) measured the alternatives: a presence penalty
 * clears the VLM's last loop page at the price of the site map's plot-number
 * list (50 → 0) and three TYPE flips; a longer repeat window clears nothing
 * and compresses the schematic. The tie went to the shipped constant.
 */
const CAPTION_DECODING = Object.freeze({ temperature: 0, seed: 42, num_predict: CAPTION_MAX_TOKENS, repeat_penalty: 1.1, repeat_last_n: 64 });

/** One request's budget; the reload after a reset fits inside it (design D3). */
const CAPTION_TIMEOUT_MS = 120000;

/** The reset's own budget: an unload answers in well under a second. */
const RESET_TIMEOUT_MS = 30000;

/**
 * How long the reset waits to SEE the model gone from `/api/ps` (design §11a
 * A10). Ollama acknowledges `keep_alive: 0` before the runner is torn down;
 * a caption sent in that window reuses the old cache and the whole document
 * takes another path (measured: two consecutive ingests of the same manual,
 * 25 of 33 captions different). The wait is normally a few hundred
 * milliseconds; an unload that never shows is reported, never assumed.
 */
const RESET_UNLOAD_WAIT_MS = 15000;
const RESET_POLL_MS = 250;

/** Crops under this size are icons and bullet glyphs; never sent (as before T24). */
const CAPTION_MIN_BYTES = 4000;

const DEFAULT_OLLAMA_URL = "http://ollama.ollama.svc.cluster.local:11434";
/**
 * The default captioner (T37, design D1 / D2): the chat model — T32's arm C.
 * Read by the parser's two fallbacks (the fingerprint input and the model
 * asked and recorded as `vlmModel`), by this module's own entry points when a
 * caller names no model, and by the harness (I-CAPTION, I-MEMO, I-INGEST, the
 * coverage leg). The page and the drawer carry the same string as a LITERAL,
 * pinned to this constant by U-SETTINGS. `qwen3-vl:30b` remains available by
 * name (the drawer, `RAG_EVAL_VLM_MODEL`); the caption memo keys by model
 * name AND digest, so the VLM's records stay where they are and arm C's 293
 * records answer for the six workshop documents under this default.
 */
const DEFAULT_CAPTION_MODEL = "qwen3.8:27b";

/**
 * The outcome vocabulary. `captioned` carries a caption; the other eight
 * carry none. Four are the model's or the crop's verdict (normal);
 * four are failures the file must not hide (design D4, D5). T32 adds
 * `textOnly` — the model read the page and found only text (design D1):
 * remembered like `decorative`, counted everywhere, no chunk.
 */
const CAPTION_OUTCOMES = Object.freeze([
  "captioned", // a caption to index
  "decorative", // the model answered [DECORATIVE_ELEMENT]
  "textOnly", // the model answered [NO_VISUAL_CONTENT] (T32): the page's text chunks are its index entry
  "empty", // the model answered nothing
  "truncated", // the model hit CAPTION_MAX_TOKENS (a repetition loop); dropped
  "tiny", // under CAPTION_MIN_BYTES; never sent
  "missing", // the crop file is not on disk (a bridge defect)
  "http_error", // the server answered a non-2xx status
  "timeout", // CAPTION_TIMEOUT_MS elapsed
  "error", // the request threw (network, JSON)
]);
const CAPTION_FAILURE_OUTCOMES = Object.freeze(["missing", "http_error", "timeout", "error"]);

/**
 * T32 (design D1–D4): the verdict tokens. The FIRST non-blank line of a
 * reply decides the outcome; a token inside a caption is caption text.
 */
const VERDICT_TOKENS = Object.freeze({ textOnly: "[NO_VISUAL_CONTENT]", decorative: "[DECORATIVE_ELEMENT]" });

/**
 * The closed TYPE vocabulary (design D3). The parser normalises the reply's
 * TYPE line into `metadata.visualType` from this list (the first listed value
 * found in the line; null when none is — counted, never a failure). T33's
 * tiling classifier keys on it; composite pages come back `mixed`, so a
 * classifier must accept `mixed` and read SUBJECTS / TITLE. `text` is the
 * no-text-layer prompt's verdict for a page of prose (transcribed whole).
 */
const VISUAL_TYPES = Object.freeze(["table", "dimensioned drawing", "schematic", "map or plan", "photo", "assembly step", "chart", "screenshot", "mixed", "text"]);

/**
 * The two prompts (design §2.2, D2, D4). Generic by construction: no document,
 * figure or design name, no unit conversion, no arithmetic (the answer model
 * converts and multiplies at answer time from the transcribed values); the
 * transcription and the description are bounded; "never repeat a line" bounds
 * the visible reply (the hidden thinking is the decoding's business). The
 * Step-1 clause "text arranged in columns or boxes is still text" is D4's
 * amendment: the probe saw the VLM call a two-column prose page a `table`.
 * The md5 of each prompt is the prompt half of every memo key it produces.
 */
const CAPTION_PROMPTS = Object.freeze({
  withText: `You are indexing one page of a document for search. Look at the page image and answer in plain text.

Step 1 - decide what the page contains:
- If the page holds only text (paragraphs, headings, lists, a table of contents, notes in boxes or columns) and no figure, drawing, diagram, chart, map, plan, photo, screenshot or table of values, reply with exactly this line and nothing else (text arranged in columns or boxes is still text, not a table of values):
[NO_VISUAL_CONTENT]
- If the page is blank or carries nothing but a logo, a header or footer band, a page number or a decorative border, reply with exactly this line and nothing else:
[DECORATIVE_ELEMENT]
- Otherwise the page has visual content. Describe only that content (not the surrounding prose), in the format below.

TITLE: a short title for the visual content, using the page's own words when it has a figure number, caption or heading
TYPE: one of  table | dimensioned drawing | schematic | map or plan | photo | assembly step | chart | screenshot | mixed
SUBJECTS: the things the visual content is about, comma-separated

TRANSCRIPTION:
Every legible label, number, unit, part number, code, legend entry and callout inside the visual content, written exactly as printed, in reading order, one item or table row per line (table cells separated by " | "). Keep units and symbols as printed. Write [illegible] for a value you cannot read. Do not convert units, do not calculate, do not estimate, do not add anything that is not printed. At most 80 lines; if there is more, stop and write [more rows not transcribed: about N].

DESCRIPTION:
In at most 8 sentences, what the visual content shows and how a reader would use it: for a drawing, what is dimensioned and between which points; for a table, what its rows and columns are; for a map or plan, what the legend maps to which areas; for a photo, what is depicted; for an assembly step, what is done with which parts. Say "not shown" for anything the page does not state.

Rules: describe what is printed, never what you infer; never repeat a line; never write the same value twice.`,
  noText: `You are indexing one page of a document for search. This page has NO machine-readable text: everything legible on it can only be indexed through your reply, so transcribe it. Answer in plain text.

If the page is blank or carries nothing but a logo, a header or footer band, a page number or a decorative border, reply with exactly this line and nothing else:
[DECORATIVE_ELEMENT]

Otherwise reply in this format:

TITLE: a short title for the page, using the page's own words when it has a heading, figure number or caption
TYPE: one of  text | table | dimensioned drawing | schematic | map or plan | photo | assembly step | chart | screenshot | mixed
SUBJECTS: the things the page is about, comma-separated

TRANSCRIPTION:
All legible text on the page, exactly as printed, in reading order - headings, paragraphs, bullets, labels, numbers, units, part numbers, codes, legend entries and callouts - one line or table row per line (table cells separated by " | "). Keep units and symbols as printed. Write [illegible] for anything you cannot read. Do not convert, calculate, estimate or add anything that is not printed. At most 120 lines; if there is more, stop and write [more not transcribed: about N lines].

DESCRIPTION:
In at most 8 sentences, what the page shows beyond its text and how a reader would use it (a photo's subject, a drawing's dimensions, a plan's layout, a table's structure). Say "not shown" for anything the page does not state.

Rules: transcribe what is printed, never what you infer; never repeat a line.`,
});

/** The md5 of each prompt variant — the prompt half of the memo key, and what a ledger record names (`captionPrompts`). */
const CAPTION_PROMPT_MD5 = Object.freeze({
  withText: crypto.createHash("md5").update(CAPTION_PROMPTS.withText).digest("hex"),
  noText: crypto.createHash("md5").update(CAPTION_PROMPTS.noText).digest("hex"),
});

/**
 * T33 (design D3; `detail_pass.js`): the detail passes' three prompts, as
 * generic as the caption prompts (no document, figure or design named —
 * F-100's lesson; the `subject` a page's own TYPE / TITLE, supplied by the
 * caller from the caption). KEY reads the legend off the whole page render;
 * INDEX reads one tile with the key supplied as text (so a page's tiles are
 * keyed by their own key — a legend change is a new memo key, as it should
 * be); TRANSCRIBE reads one tile of a page whose transcription overflowed or
 * carried `[illegible]`. The md5 of the instantiated prompt is the prompt
 * half of every memo key it produces (`detailPromptMd5`).
 */
const DETAIL_PROMPTS = Object.freeze({
  key: `You are indexing one page of a document for search. The page may contain a legend or key that maps a visual attribute (a fill colour, a hatch pattern or a symbol) to a named category. List EVERY legend or key entry, one per line, in the form
attribute | name
where \`attribute\` is the colour (or pattern or symbol) as you see it, in two or three plain words, and \`name\` is the category exactly as printed. Do not list anything that is not a legend or key entry. If the page has no legend or key, reply with exactly: NONE`,
  index: (keyTextValue, subject) => `This image is ONE TILE of a larger page (${subject}). Labelled elements on it are filled with a colour (or a pattern, or marked with a symbol) that identifies a category. This is the page's key:
${keyTextValue}

List EVERY labelled element that is fully legible in this tile, one per line, in the form
label | category name
reading the label exactly as printed and choosing the category whose attribute matches the element's fill. Write UNKNOWN for a fill that matches no key entry. Do not list an element whose label is cut off at the tile's edge. Do not count, summarise or add anything else. If there is no labelled element, reply with exactly: NONE`,
  transcribe: (subject) => `This image is ONE TILE of a larger page (${subject}). Transcribe EVERY legible line of text, label, number, unit, part number, code and callout inside this tile, exactly as printed, in reading order, one item or table row per line (table cells separated by " | "). Keep units and symbols as printed. Write [illegible] for a value you cannot read. Do not transcribe a line that is cut off at the tile's edge. Do not convert units, do not calculate, do not estimate, do not add anything that is not printed; never repeat a line. If the tile holds no legible text, reply with exactly: NONE`,
});

/** The prompt of a stage, instantiated. */
function detailPromptFor(stage, { keyText: keyTextValue = "", subject = "a page" } = {}) {
  if (stage === "key") return DETAIL_PROMPTS.key;
  if (stage === "index") return DETAIL_PROMPTS.index(String(keyTextValue || "NONE"), String(subject || "a page"));
  if (stage === "transcribe") return DETAIL_PROMPTS.transcribe(String(subject || "a page"));
  throw new Error(`detailPromptFor: unknown stage ${JSON.stringify(stage)}`);
}

/** The md5 of a stage's instantiated prompt — the prompt half of its memo key. */
function detailPromptMd5(stage, opts) {
  return crypto.createHash("md5").update(detailPromptFor(stage, opts)).digest("hex");
}

/** The fixed prompts' md5s (the KEY prompt, and the two templates instantiated with their defaults), for a ledger record. */
const DETAIL_PROMPT_MD5 = Object.freeze({
  key: crypto.createHash("md5").update(detailPromptFor("key")).digest("hex"),
  indexTemplate: crypto.createHash("md5").update(detailPromptFor("index", {})).digest("hex"),
  transcribeTemplate: crypto.createHash("md5").update(detailPromptFor("transcribe", {})).digest("hex"),
});

const DETAIL_STAGES = Object.freeze(["key", "index", "transcribe"]);

/**
 * T33: the outcome vocabulary of a detail request. `answered` carries the
 * reply (a NONE reply is an answer — the model's "nothing here" verdict,
 * remembered like a caption); the rest mirror the captioner's: `truncated`
 * (the cap, remembered), `empty`, `tiny`, and the four failures never
 * remembered.
 */
const DETAIL_OUTCOMES = Object.freeze(["answered", "empty", "truncated", "tiny", "missing", "http_error", "timeout", "error"]);

/**
 * T46 (design §2.1, D1 a, D7, D8; F-174): the CHAIN prompt — a second pass on the page render of a picture whose
 * caption admits a dimensioned drawing (`dimension_chain.js` `chainAdmits`), asked through the same client,
 * decoding, timeout, memo and outcomes as a detail pass. The design probe's V4, byte for byte (the prompt its 29 cold /
 * warm asks measured — `t46-artifacts/probes/records/chain-1790346207.json`, md5 e07b9cbe…): the marked points
 * lettered, the ALIGNED sets, one CHAIN line per printed dimension with its axis, the CLOSURE — and NO points asked
 * (the model's sums were wrong; `dimension_chain.js` computes them), no anchor list of printed numbers (V3's harmed),
 * `NO_DIMENSIONS` on a page with nothing dimensioned. Generic like the caption prompts: no document or figure named.
 * Its md5 is the prompt half of every chain memo key (its own key — every caption and tile key stands).
 */
const CHAIN_PROMPT = `You are reading one page of a document that may hold a dimensioned drawing (a drawing with dimension lines and printed values between features). Answer in plain text.

If the page holds NO dimensioned drawing — no printed dimension value with a dimension line, arrow or leader between two features — reply with exactly this line and nothing else:
NO_DIMENSIONS

Otherwise reply in this format:

POINTS MARKED:
Letter every marked point (a crosshair, a hole centre, a fastening point) A, B, C … left to right, then top to bottom. One line each: <letter>: <where it sits, in the drawing's own terms>. Write: none — when nothing is marked.

ALIGNED:
One line per set of marked points that sit on one straight line: the letters separated by spaces, then (horizontal) when that line runs left–right or (vertical) when it runs top–bottom — e.g. A F (horizontal) or B C (vertical). Write: none — when no two points align.

CHAIN:
One line per printed dimension, exactly: from <endpoint> to <endpoint> (horizontal|vertical): <value> <unit as printed>. An endpoint is a lettered point, or one of: the left edge, the right edge, the top edge, the bottom edge, or a named part. Horizontal means the dimension line runs left–right; vertical means it runs top–bottom. A dimension line between two lettered points starts and ends on the points' own centre lines — name the points, not the edges. Write [unclear] for an endpoint you cannot read. Every printed dimension value appears once. Do not compute anything.

CLOSURE:
Where a total is printed, the arithmetic that reaches it (e.g. 50 + 340 + 50 = 440 ✓); otherwise: none printed

Rules: read what is printed, never what you infer; never repeat a line; never write the same value twice.`;
const CHAIN_PROMPT_MD5 = crypto.createHash("md5").update(CHAIN_PROMPT).digest("hex");

/** The prompt for a page: the verdict-first one when the page has a text layer, the transcribe-first one when it has none (design D2). */
function captionPromptFor(hasTextLayer) {
  return hasTextLayer === false ? CAPTION_PROMPTS.noText : CAPTION_PROMPTS.withText;
}

/**
 * The verdict, from the FIRST non-blank line of a reply (design D1):
 * "textOnly" for `[NO_VISUAL_CONTENT]`, "decorative" for
 * `[DECORATIVE_ELEMENT]`, null for a caption. Surrounding whitespace,
 * markdown emphasis and a trailing full stop on that line are tolerated; a
 * token anywhere AFTER the first line is caption text, not a verdict.
 */
function parseVerdict(reply) {
  const first = String(reply || "").split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!first) return null;
  const bare = first.replace(/^[\s*_`]+|[\s*_`.]+$/g, "");
  if (bare === VERDICT_TOKENS.textOnly) return "textOnly";
  if (bare === VERDICT_TOKENS.decorative) return "decorative";
  return null;
}

function baseUrlOf(ollamaUrl) {
  return String(ollamaUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
}

function generateEndpoint(ollamaUrl) {
  return `${baseUrlOf(ollamaUrl)}/api/generate`;
}

function psEndpoint(ollamaUrl) {
  return `${baseUrlOf(ollamaUrl)}/api/ps`;
}

function tagsEndpoint(ollamaUrl) {
  return `${baseUrlOf(ollamaUrl)}/api/tags`;
}

/**
 * T29 (design D1, the stricter key): the server half of a caption's identity
 * — the origin the captioner talks to and the model's DIGEST as the server
 * reports it (`/api/tags`), read once per document. A memo record made
 * against one digest never answers for a re-pulled tag. Never throws; when
 * the digest cannot be read the memo is bypassed for the document
 * (`ok: false`, the reason recorded) and captioning proceeds as T24 did.
 */
async function resolveCaptionServer(options = {}) {
  const { ollamaUrl = DEFAULT_OLLAMA_URL, modelName = DEFAULT_CAPTION_MODEL, token = "", timeoutMs = 10000, fetchImpl = fetch, label = modelName } = options;
  const t0 = Date.now();
  const server = serverOriginOf(ollamaUrl);
  try {
    const res = await fetchImpl(tagsEndpoint(ollamaUrl), { method: "GET", headers: headersFor(token), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.warn(`[VLM Captioner identity unavailable] ${label}: /api/tags HTTP ${res.status}; the caption memo is bypassed for this document`);
      return { ok: false, server, modelDigest: null, ms: Date.now() - t0, status: res.status, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    const wanted = [modelName, `${modelName}:latest`];
    const found = models.find((m) => m && (wanted.includes(m.name) || wanted.includes(m.model)));
    const digest = found && typeof found.digest === "string" && found.digest ? found.digest : null;
    if (!digest) {
      console.warn(`[VLM Captioner identity unavailable] ${label}: ${modelName} is not among the server's models; the caption memo is bypassed for this document`);
      return { ok: false, server, modelDigest: null, ms: Date.now() - t0, status: res.status, error: "model not listed by the server" };
    }
    return { ok: true, server, modelDigest: digest, ms: Date.now() - t0, status: res.status };
  } catch (err) {
    console.warn(`[VLM Captioner identity unavailable] ${label}: ${err.message}; the caption memo is bypassed for this document`);
    return { ok: false, server, modelDigest: null, ms: Date.now() - t0, status: null, error: String(err.message || err).slice(0, 200) };
  }
}

/** The server origin as the memo key names it (the captioner's own normalisation of the URL). */
function serverOriginOf(ollamaUrl) {
  const base = baseUrlOf(ollamaUrl);
  try { return new URL(base).origin.toLowerCase(); } catch (err) { return base.toLowerCase(); }
}

/**
 * The caption memo key for a crop under THIS captioner's prompt and decoding
 * (T29): the one place the prompt and decoding halves of the key come from,
 * used by the parser's pre-pass and by `captionFigure`. `memoIdentity` is
 * `resolveCaptionServer`'s `{ server, modelDigest }`. T32: the prompt half
 * is the VARIANT the page gets (`hasTextLayer`, default true), so the two
 * variants' records never answer for each other, and a page whose text-layer
 * status changes (an OCR later) simply misses and is asked again.
 */
function captionMemoKey(cropBytes, { modelName = DEFAULT_CAPTION_MODEL, memoIdentity, hasTextLayer = true } = {}) {
  if (!memoIdentity || !memoIdentity.modelDigest || !memoIdentity.server) throw new Error("captionMemoKey: memoIdentity { server, modelDigest } is required");
  return memoKey({ cropBytes, modelName, modelDigest: memoIdentity.modelDigest, server: memoIdentity.server, prompt: captionPromptFor(hasTextLayer), decoding: CAPTION_DECODING });
}

/** Is `modelName` among the server's loaded models? null when /api/ps cannot be read. */
async function modelResident(ollamaUrl, modelName, token, fetchImpl) {
  try {
    const res = await fetchImpl(psEndpoint(ollamaUrl), { method: "GET", headers: headersFor(token), signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const names = Array.isArray(data?.models) ? data.models.map((m) => m && (m.name || m.model)) : [];
    return names.includes(modelName);
  } catch (err) {
    return null;
  }
}

function headersFor(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function isTimeoutError(err) {
  return Boolean(err) && (err.name === "TimeoutError" || err.name === "AbortError" || /aborted due to timeout/i.test(String(err.message || "")));
}

/**
 * Put the VLM server into the one state every ingest can reproduce: the
 * model unloaded, its prompt cache with it (`keep_alive: 0`) — and SEEN to
 * be unloaded (`/api/ps` no longer lists it) before the caller captions,
 * because the acknowledgement comes before the teardown (A10). The next
 * caption reloads it (≈ 4.5 s measured). Never throws — the caller records
 * the result on the document's trace and captions anyway. Resolves to
 *   { ok, unloaded, ms, waitedMs, status?, error? }
 * where `ok` is the request's success and `unloaded` whether the model was
 * observed gone within RESET_UNLOAD_WAIT_MS (null when /api/ps is unreadable).
 */
async function resetCaptionServer(options = {}) {
  const { ollamaUrl = DEFAULT_OLLAMA_URL, modelName = DEFAULT_CAPTION_MODEL, token = "", timeoutMs = RESET_TIMEOUT_MS, fetchImpl = fetch, label = modelName, unloadWaitMs = RESET_UNLOAD_WAIT_MS, pollMs = RESET_POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = options;
  const t0 = Date.now();
  let status = null;
  try {
    const res = await fetchImpl(generateEndpoint(ollamaUrl), {
      method: "POST",
      headers: headersFor(token),
      body: JSON.stringify({ model: modelName, keep_alive: 0 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = res.status;
    if (!res.ok) {
      const errText = String(await res.text().catch(() => "")).slice(0, 200);
      console.warn(`[VLM Captioner reset failed] ${label}: HTTP ${res.status} ${errText}`);
      return { ok: false, unloaded: false, ms: Date.now() - t0, waitedMs: 0, status, error: `HTTP ${res.status} ${errText}`.trim() };
    }
  } catch (err) {
    console.warn(`[VLM Captioner reset failed] ${label}: ${err.message}`);
    return { ok: false, unloaded: false, ms: Date.now() - t0, waitedMs: 0, status: null, error: String(err.message || err).slice(0, 200) };
  }
  // The acknowledgement is not the unload: wait until the server no longer lists the model.
  const waitStart = Date.now();
  let resident = await modelResident(ollamaUrl, modelName, token, fetchImpl);
  while (resident === true && Date.now() - waitStart < unloadWaitMs) {
    await sleep(pollMs);
    resident = await modelResident(ollamaUrl, modelName, token, fetchImpl);
  }
  const waitedMs = Date.now() - waitStart;
  if (resident === true) {
    console.warn(`[VLM Captioner reset incomplete] ${label}: ${modelName} still loaded ${waitedMs} ms after keep_alive 0; captioning from an unknown cache state`);
    return { ok: true, unloaded: false, ms: Date.now() - t0, waitedMs, status };
  }
  if (resident === null) {
    console.warn(`[VLM Captioner reset unverified] ${label}: /api/ps unreadable; the unload could not be confirmed`);
    return { ok: true, unloaded: null, ms: Date.now() - t0, waitedMs, status };
  }
  return { ok: true, unloaded: true, ms: Date.now() - t0, waitedMs, status };
}

/**
 * Caption one figure crop. Resolves to
 *   { outcome, caption, ms, model, source, requested, memoKey, memoised, status?, error? }
 * with `outcome` from CAPTION_OUTCOMES and `caption` a string only for
 * `captioned`. Never throws.
 *
 * T29: with a `memo` (`caption_memo.openCaptionMemo()`) and a `memoIdentity`
 * (`resolveCaptionServer`'s `{ server, modelDigest }`) the crop's key is
 * looked up FIRST — a hit returns the stored outcome with `source: "memo"`
 * and makes NO request; a miss asks the server as before and, when the
 * outcome is one the memo keeps (captioned / decorative / textOnly /
 * truncated — never a failure, never `empty`), stores it (`memoised: true`).
 * Without a memo or an identity the function is T24's. `requested` says
 * whether a server request was made at all (the ledger's `vlmCalls`).
 * T32: `hasTextLayer` (default true) picks the prompt variant and so the key.
 */
async function captionFigure(imageAbsPath, options = {}) {
  const {
    ollamaUrl = DEFAULT_OLLAMA_URL,
    modelName = DEFAULT_CAPTION_MODEL,
    token = "",
    timeoutMs = CAPTION_TIMEOUT_MS,
    fetchImpl = fetch,
    label = path.basename(String(imageAbsPath || "")),
    memo = null,
    memoIdentity = null,
    memoKey: presetKey = null,
    jobId = null,
    hint = null,
    hasTextLayer = true,
  } = options;
  const prompt = captionPromptFor(hasTextLayer);
  const t0 = Date.now();
  const done = (outcome, extra = {}) => ({ outcome, caption: null, ms: Date.now() - t0, model: modelName, source: "vlm", requested: false, memoKey: null, memoised: false, ...extra });

  if (!imageAbsPath || !fs.existsSync(imageAbsPath)) {
    console.warn(`[VLM Captioner missing] ${label}: image file not found: ${imageAbsPath}`);
    return done("missing", { error: "image file not found" });
  }
  const stats = fs.statSync(imageAbsPath);
  if (stats.size < CAPTION_MIN_BYTES) {
    return done("tiny");
  }

  let cropBytes;
  let base64Image;
  try {
    cropBytes = fs.readFileSync(imageAbsPath);
    base64Image = cropBytes.toString("base64");
  } catch (err) {
    console.warn(`[VLM Captioner error] ${label}: ${err.message}`);
    return done("error", { error: String(err.message || err).slice(0, 200) });
  }

  // T29: the memo first. A hit is the whole answer — no request, no reset, no load.
  let keyInfo = null;
  if (memo && memoIdentity && memoIdentity.modelDigest && memoIdentity.server) {
    try {
      keyInfo = captionMemoKey(cropBytes, { modelName, memoIdentity, hasTextLayer });
      if (presetKey && presetKey !== keyInfo.key) console.warn(`[VLM Captioner memo] ${label}: the caller's key differs from the crop's; the crop's is used`);
      const hit = memo.get(keyInfo.key);
      if (hit) {
        return { outcome: hit.outcome, caption: hit.outcome === "captioned" ? hit.caption : null, ms: Date.now() - t0, model: modelName, source: "memo", requested: false, memoKey: keyInfo.key, memoised: false, memoSource: hit.source, capturedAt: hit.capturedAt, loadMs: null };
      }
    } catch (err) {
      console.warn(`[VLM Captioner memo] ${label}: key not formed (${err.message}); asking the server`);
      keyInfo = null;
    }
  }
  const remember = (result) => {
    if (!keyInfo || !memo) return result;
    result.memoKey = keyInfo.key;
    if (!MEMOISED_OUTCOMES.includes(result.outcome)) return result;
    try {
      const record = makeRecord({ keyInfo, cropBytes, outcome: result.outcome, caption: result.caption, source: "vlm", jobId, ms: result.ms, hint });
      const w = memo.put(record);
      result.memoised = w.ok;
      if (!w.ok) result.memoError = w.error;
    } catch (err) {
      result.memoised = false;
      result.memoError = String(err.message || err).slice(0, 200);
    }
    return result;
  };
  const asked = (outcome, extra = {}) => remember(done(outcome, { requested: true, ...extra }));

  try {
    const res = await fetchImpl(generateEndpoint(ollamaUrl), {
      method: "POST",
      headers: headersFor(token),
      body: JSON.stringify({
        model: modelName,
        prompt,
        images: [base64Image],
        stream: false,
        options: { ...CAPTION_DECODING },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = String(await res.text().catch(() => "")).slice(0, 300);
      console.warn(`[VLM Captioner http_error] ${label}: ${res.status} ${errText}`);
      return asked("http_error", { status: res.status, error: `HTTP ${res.status} ${errText}`.trim() });
    }

    const data = await res.json();
    const caption = String(data?.response || "").trim();
    const loadMs = Number.isFinite(data?.load_duration) ? Math.round(data.load_duration / 1e6) : null;
    if (data?.done_reason === "length") {
      console.warn(`[VLM Captioner truncated] ${label}: hit the ${CAPTION_MAX_TOKENS}-token cap (${data?.eval_count ?? "?"} tokens generated); caption dropped`);
      return asked("truncated", { status: res.status, loadMs, error: `hit the ${CAPTION_MAX_TOKENS}-token cap` });
    }
    if (!caption) return asked("empty", { status: res.status, loadMs });
    // T32 (design D1): the first non-blank line is the verdict — a page of
    // text, a decorative page, or a caption. A token inside a caption is text.
    const verdict = parseVerdict(caption);
    if (verdict) {
      console.log(`[VLM Captioner ${verdict}] ${label}`);
      return asked(verdict, { status: res.status, loadMs });
    }
    return remember({ outcome: "captioned", caption, ms: Date.now() - t0, model: modelName, source: "vlm", requested: true, memoKey: null, memoised: false, status: res.status, loadMs });
  } catch (err) {
    if (isTimeoutError(err)) {
      console.warn(`[VLM Captioner timeout] ${label}: no reply within ${timeoutMs} ms`);
      return asked("timeout", { error: `no reply within ${timeoutMs} ms` });
    }
    console.warn(`[VLM Captioner error] ${label}: ${err.message}`);
    return asked("error", { error: String(err.message || err).slice(0, 200) });
  }
}

/**
 * T33 (design D8): the memo key of a detail request — the tile's (or the
 * whole render's) bytes, the captioner's model and digest, the server, the
 * STAGE's instantiated prompt (the INDEX prompt embeds the key text) and the
 * captioner's decoding — the existing key scheme, unchanged.
 */
function detailMemoKey(cropBytes, { modelName = DEFAULT_CAPTION_MODEL, memoIdentity, stage, keyText: keyTextValue, subject } = {}) {
  if (!memoIdentity || !memoIdentity.modelDigest || !memoIdentity.server) throw new Error("detailMemoKey: memoIdentity { server, modelDigest } is required");
  return memoKey({ cropBytes, modelName, modelDigest: memoIdentity.modelDigest, server: memoIdentity.server, prompt: detailPromptFor(stage, { keyText: keyTextValue, subject }), decoding: CAPTION_DECODING });
}

/**
 * T33 (design D3, D8): one detail request — a KEY pass over the page render,
 * or an INDEX / TRANSCRIBE pass over one tile — through the same client,
 * decoding, timeout, memo and outcomes as a caption. Resolves to
 *   { outcome, reply, stage, promptMd5, ms, model, source, requested, memoKey, memoised, loadMs, status?, error? }
 * with `outcome` from DETAIL_OUTCOMES and `reply` a string only for
 * `answered`. Never throws. With a `memo` and a `memoIdentity` the key is
 * looked up FIRST — a hit makes NO request (`source: "memo"`); a miss asks
 * the server and stores an `answered` reply as a `captioned` record and a
 * `truncated` one as `truncated` — never a failure, never `empty` (the memo
 * module's vocabulary is unchanged: the reply travels in its `caption`).
 */
async function askDetail(imageAbsPath, options = {}) {
  const { stage, keyText: keyTextValue = "", subject = "a page" } = options;
  if (!DETAIL_STAGES.includes(stage)) throw new Error(`askDetail: stage must be one of ${DETAIL_STAGES.join(", ")}, got ${JSON.stringify(stage)}`);
  return askPrompt(imageAbsPath, detailPromptFor(stage, { keyText: keyTextValue, subject }), stage, "Detail", options);
}

/**
 * T46 (design §2.1, D8): the memo key of a chain request — the page render's bytes, the captioner's model and digest,
 * the server, the CHAIN prompt and the captioner's decoding: the detail pass's key scheme with its own prompt, so a
 * chain reply never answers for a caption or a tile (and every existing key stands).
 */
function chainMemoKey(cropBytes, { modelName = DEFAULT_CAPTION_MODEL, memoIdentity } = {}) {
  if (!memoIdentity || !memoIdentity.modelDigest || !memoIdentity.server) throw new Error("chainMemoKey: memoIdentity { server, modelDigest } is required");
  return memoKey({ cropBytes, modelName, modelDigest: memoIdentity.modelDigest, server: memoIdentity.server, prompt: CHAIN_PROMPT, decoding: CAPTION_DECODING });
}

/**
 * T46 (design §2.1, D1 a, D8): one chain request — the CHAIN prompt over the page render, the detail pass's shape
 * (`askDetail`'s outcomes, memo, timeout and log lines, under a `VLM Chain` prefix; `stage: "chain"`). A NO_DIMENSIONS
 * reply is an answer, remembered like any other. Never throws.
 */
async function askChain(imageAbsPath, options = {}) {
  return askPrompt(imageAbsPath, CHAIN_PROMPT, "chain", "Chain", options);
}

/**
 * The one request path of a detail or a chain pass (T33's askDetail body, shared since T46): the memo first, then the
 * server; `tag` names the pass in the container log ("Detail", "Chain"). Resolves to
 *   { outcome, reply, stage, promptMd5, ms, model, source, requested, memoKey, memoised, loadMs, status?, error? }.
 */
async function askPrompt(imageAbsPath, prompt, stage, tag, options = {}) {
  const {
    ollamaUrl = DEFAULT_OLLAMA_URL,
    modelName = DEFAULT_CAPTION_MODEL,
    token = "",
    timeoutMs = CAPTION_TIMEOUT_MS,
    fetchImpl = fetch,
    label = path.basename(String(imageAbsPath || "")),
    memo = null,
    memoIdentity = null,
    jobId = null,
    hint = null,
  } = options;
  const promptMd5 = crypto.createHash("md5").update(prompt).digest("hex");
  const t0 = Date.now();
  const done = (outcome, extra = {}) => ({ outcome, reply: null, stage, promptMd5, ms: Date.now() - t0, model: modelName, source: "vlm", requested: false, memoKey: null, memoised: false, loadMs: null, ...extra });

  if (!imageAbsPath || !fs.existsSync(imageAbsPath)) {
    console.warn(`[VLM ${tag} missing] ${label}: image file not found: ${imageAbsPath}`);
    return done("missing", { error: "image file not found" });
  }
  if (fs.statSync(imageAbsPath).size < CAPTION_MIN_BYTES) return done("tiny");

  let cropBytes;
  let base64Image;
  try {
    cropBytes = fs.readFileSync(imageAbsPath);
    base64Image = cropBytes.toString("base64");
  } catch (err) {
    console.warn(`[VLM ${tag} error] ${label}: ${err.message}`);
    return done("error", { error: String(err.message || err).slice(0, 200) });
  }

  let keyInfo = null;
  if (memo && memoIdentity && memoIdentity.modelDigest && memoIdentity.server) {
    try {
      keyInfo = memoKey({ cropBytes, modelName, modelDigest: memoIdentity.modelDigest, server: memoIdentity.server, prompt, decoding: CAPTION_DECODING });
      const hit = memo.get(keyInfo.key);
      if (hit) {
        const outcome = hit.outcome === "captioned" ? "answered" : hit.outcome === "truncated" ? "truncated" : null;
        if (outcome) return { outcome, reply: outcome === "answered" ? hit.caption : null, stage, promptMd5, ms: Date.now() - t0, model: modelName, source: "memo", requested: false, memoKey: keyInfo.key, memoised: false, memoSource: hit.source, capturedAt: hit.capturedAt, loadMs: null };
      }
    } catch (err) {
      console.warn(`[VLM ${tag} memo] ${label}: key not formed (${err.message}); asking the server`);
      keyInfo = null;
    }
  }
  const remember = (result) => {
    if (!keyInfo || !memo) return result;
    result.memoKey = keyInfo.key;
    const stored = result.outcome === "answered" ? "captioned" : result.outcome === "truncated" ? "truncated" : null;
    if (!stored) return result;
    try {
      const record = makeRecord({ keyInfo, cropBytes, outcome: stored, caption: stored === "captioned" ? result.reply : null, source: "vlm", jobId, ms: result.ms, hint });
      const w = memo.put(record);
      result.memoised = w.ok;
      if (!w.ok) result.memoError = w.error;
    } catch (err) {
      result.memoised = false;
      result.memoError = String(err.message || err).slice(0, 200);
    }
    return result;
  };
  const asked = (outcome, extra = {}) => remember(done(outcome, { requested: true, ...extra }));

  try {
    const res = await fetchImpl(generateEndpoint(ollamaUrl), {
      method: "POST",
      headers: headersFor(token),
      body: JSON.stringify({ model: modelName, prompt, images: [base64Image], stream: false, options: { ...CAPTION_DECODING } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const errText = String(await res.text().catch(() => "")).slice(0, 300);
      console.warn(`[VLM ${tag} http_error] ${label}: ${res.status} ${errText}`);
      return asked("http_error", { status: res.status, error: `HTTP ${res.status} ${errText}`.trim() });
    }
    const data = await res.json();
    const reply = String(data?.response || "").trim();
    const loadMs = Number.isFinite(data?.load_duration) ? Math.round(data.load_duration / 1e6) : null;
    if (data?.done_reason === "length") {
      console.warn(`[VLM ${tag} truncated] ${label}: hit the ${CAPTION_MAX_TOKENS}-token cap (${data?.eval_count ?? "?"} tokens generated); reply dropped`);
      return asked("truncated", { status: res.status, loadMs, error: `hit the ${CAPTION_MAX_TOKENS}-token cap` });
    }
    if (!reply) return asked("empty", { status: res.status, loadMs });
    return asked("answered", { reply, status: res.status, loadMs });
  } catch (err) {
    if (isTimeoutError(err)) {
      console.warn(`[VLM ${tag} timeout] ${label}: no reply within ${timeoutMs} ms`);
      return asked("timeout", { error: `no reply within ${timeoutMs} ms` });
    }
    console.warn(`[VLM ${tag} error] ${label}: ${err.message}`);
    return asked("error", { error: String(err.message || err).slice(0, 200) });
  }
}

/** The pre-T24 signature: the caption, or null for any other outcome. */
async function generateImageCaption(imageAbsPath, options = {}) {
  const result = await captionFigure(imageAbsPath, options);
  return result.outcome === "captioned" ? result.caption : null;
}

module.exports = {
  DEFAULT_CAPTION_MODEL,
  CAPTION_DECODING,
  CAPTION_MAX_TOKENS,
  CAPTION_TIMEOUT_MS,
  RESET_TIMEOUT_MS,
  RESET_UNLOAD_WAIT_MS,
  CAPTION_MIN_BYTES,
  CAPTION_OUTCOMES,
  CAPTION_FAILURE_OUTCOMES,
  CAPTION_PROMPTS,
  CAPTION_PROMPT_MD5,
  VERDICT_TOKENS,
  VISUAL_TYPES,
  DETAIL_PROMPTS,
  DETAIL_PROMPT_MD5,
  DETAIL_STAGES,
  DETAIL_OUTCOMES,
  detailPromptFor,
  detailPromptMd5,
  detailMemoKey,
  askDetail,
  CHAIN_PROMPT,
  CHAIN_PROMPT_MD5,
  chainMemoKey,
  askChain,
  captionPromptFor,
  parseVerdict,
  resetCaptionServer,
  resolveCaptionServer,
  captionMemoKey,
  serverOriginOf,
  captionFigure,
  generateImageCaption,
};
