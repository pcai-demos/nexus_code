/**
 * T41 (t41-design.md D2, §2.1) — the minimum-size fold.
 *
 * Before T41 every chunking path but markdown DROPPED a piece shorter than `minChunkSize` when the page had more than
 * one piece (T07 counted the drops: 185 on production). Measured on the served image (t41-design.md §0b): the
 * splitter's overlap already copies the tail of each emitted piece into the head of the next one, so a short piece
 * dropped in the middle of a page was mostly still in the index — and the docx's table tails, the last sentence of
 * forty-three PDF pages and a slide's title (7,770 characters) were in no chunk at all.
 *
 * The rule, and only the rule: a piece under the minimum is never emitted alone and never dropped. It is FOLDED into
 * a neighbour on the same page:
 *   - into the NEXT surviving piece by default — that piece's head is already the short piece's tail (the overlap), and
 *     the overlap head is replaced by the whole piece, so the text is stored once and a heading opens the chunk it
 *     introduces;
 *   - into the PREVIOUS surviving piece when nothing follows on the page (the page's last piece), as its novel
 *     remainder — the part that does not already end that piece;
 *   - `prefer: "previous"` flips the order for a path whose pieces do not overlap forward (the markdown path: a split
 *     paragraph's short tail belongs to its own paragraph);
 *   - a page whose pieces are ALL under the minimum keeps its first piece and folds the rest into it (before T41 such a
 *     page lost every piece); a page with one piece keeps it.
 * The caller applies headings, prefixes and metadata to the survivor's ORIGINAL piece (`original`, `index`) and stores
 * its folded `body` — the heading state machine never sees a folded piece, exactly as it never saw a dropped one.
 *
 * Pure: strings and numbers in, strings out; no config, no I/O, no store (U-FOLD). Transportable (the standing aim).
 */

/** The module's default when a request names no minimum (the drawer sends 150; an API caller without a blob gets this). */
const DEFAULT_MIN_CHUNK_SIZE = 50;

/** A non-negative integer (or the numeric string of one); absent, empty or unreadable is the default. 0 = no minimum. */
function normaliseMinChunkSize(value, def = DEFAULT_MIN_CHUNK_SIZE) {
  if (value === undefined || value === null || value === "") return def;
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

/**
 * The length of the longest suffix of `a` that is a prefix of `b` — the splitter's overlap between consecutive pieces.
 * The splitter's overlap is made of whole parts (lines, sentences, words), so a match counts only when it starts at a
 * token boundary in `a` and ends at one in `b`, and is either at least SHARED_OVERLAP_MIN characters long or holds a
 * space (a one-letter coincidence — "one short" / "two short" — is not an overlap). A real short overlap that is
 * missed is stored twice (a page number, a one-word line); a coincidence that is taken would clip a word — the safer
 * error is the duplicate.
 */
const SHARED_OVERLAP_MIN = 6;
function sharedOverlap(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  const boundary = (ch) => ch === undefined || /\s/.test(ch);
  for (let k = Math.min(x.length, y.length); k > 0; k--) {
    const suffix = x.slice(x.length - k);
    if (!y.startsWith(suffix)) continue;
    if (!boundary(x[x.length - k - 1]) || !boundary(y[k])) continue;
    if (k >= SHARED_OVERLAP_MIN || /\s/.test(suffix)) return k;
  }
  return 0;
}

/** `piece` folded in front of `body` (the body's overlap head — the piece's tail — replaced by the whole piece). */
function foldBefore(piece, body, sep) {
  const rest = body.slice(sharedOverlap(piece, body)).replace(/^\s+/, "");
  return rest ? `${piece}${sep}${rest}` : piece;
}

/** `piece` folded after `body` (only its novel remainder — the part not already ending the body). */
function foldAfter(body, piece, sep) {
  const novel = piece.slice(sharedOverlap(body, piece)).replace(/^\s+/, "");
  return novel ? `${body}${sep}${novel}` : body;
}

/**
 * @param {string[]} pieces         a page's pieces in order (the splitter's output, trimmed); empty strings are ignored
 * @param {number|string} minChunkSize
 * @param {{ prefer?: "next"|"previous", separator?: string }} [opts]
 * @returns {{ chunks: Array<{ body: string, original: string, index: number, absorbed: number[] }>, folded: number,
 *            details: Array<{ index: number, chars: number, into: "next"|"previous", survivor: number }>, minChunkSize: number }}
 *          the survivors in order — each with its folded body, its original piece and that piece's index in `pieces`
 */
function foldSubMinimum(pieces, minChunkSize, opts = {}) {
  const prefer = opts.prefer === "previous" ? "previous" : "next";
  const sep = typeof opts.separator === "string" ? opts.separator : "\n";
  const min = normaliseMinChunkSize(minChunkSize);
  const active = (Array.isArray(pieces) ? pieces : []).map((p, i) => ({ s: typeof p === "string" ? p : String(p ?? ""), i })).filter((x) => x.s.length > 0);
  const details = [];
  const chunk = (x) => ({ body: x.s, original: x.s, index: x.i, absorbed: [] });
  if (active.length <= 1 || min <= 0) return { chunks: active.map(chunk), folded: 0, details, minChunkSize: min };
  const isSub = (x) => x.s.length < min;
  if (active.every(isSub)) {
    // Nothing on the page reaches the minimum: the first piece survives and the rest fold into it (before T41 the whole
    // page was dropped).
    const first = chunk(active[0]);
    for (const x of active.slice(1)) { first.body = foldAfter(first.body, x.s, sep); first.absorbed.push(x.i); details.push({ index: x.i, chars: x.s.length, into: "previous", survivor: first.index }); }
    return { chunks: [first], folded: active.length - 1, details, minChunkSize: min };
  }
  const out = [];
  let pending = [];
  const intoPrevious = (prev, x) => { prev.body = foldAfter(prev.body, x.s, sep); prev.absorbed.push(x.i); details.push({ index: x.i, chars: x.s.length, into: "previous", survivor: prev.index }); };
  for (const x of active) {
    if (isSub(x)) {
      if (prefer === "previous" && out.length) intoPrevious(out[out.length - 1], x);
      else pending.push(x);
      continue;
    }
    const c = chunk(x);
    // The pieces waiting for this survivor fold in front of it in their order: the nearest first (its tail is this
    // survivor's head), then each earlier one in front of the result.
    for (let j = pending.length - 1; j >= 0; j--) { const p = pending[j]; c.body = foldBefore(p.s, c.body, sep); details.push({ index: p.i, chars: p.s.length, into: "next", survivor: c.index }); }
    c.absorbed = pending.map((p) => p.i);
    out.push(c);
    pending = [];
  }
  // The page's trailing short pieces (nothing follows on the page): into the last survivor, in their order.
  for (const x of pending) intoPrevious(out[out.length - 1], x);
  return { chunks: out, folded: details.length, details, minChunkSize: min };
}

module.exports = { DEFAULT_MIN_CHUNK_SIZE, SHARED_OVERLAP_MIN, normaliseMinChunkSize, sharedOverlap, foldSubMinimum };
