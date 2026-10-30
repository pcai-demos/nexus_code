/**
 * T47 (t47-design.md §2.1; D1 a — rule E; D2; D3; F-176) — the text-layer label reconciliation of a caption, pure.
 *
 * A caption's TRANSCRIPTION is the captioner's verbatim read of the printed strings on the page, and its TITLE the
 * figure's own caption; the page's text layer is authoritative for what is PRINTED. A proper noun the captioner
 * misread ("Huttondon" for the printed "Huntingdon", "Guncaster Way" for "Gumcester Way") is replaced by the page's
 * spelling when — and only when — the page prints exactly one capitalised word within reach. Measured on production
 * v8 (t47-design.md §0c, `t47-artifacts/probes/substitution_probe.js`): seven substitutions on 228 captions, every
 * one right by eye, none ambiguous; the plan's looser rule proposed 31 with 14 wrong (§0b).
 *
 * The rule (rule E), token by token over the TITLE line and the TRANSCRIPTION lines ONLY (D2 — the DESCRIPTION is the
 * model's prose and takes sentence-initial capitals for proper nouns, §0d; the SUBJECTS line is its own words):
 *   - the token is proper-noun-shaped: a capital then a lower-case letter (never all-caps), ≥ `minLen` (5) characters,
 *     letters only (an apostrophe or a hyphen inside; no digit — codes and numbers are never touched, §0e, §7);
 *   - its lower-case form is not a word the page prints;
 *   - the candidates are the page's CAPITALISED words (the same shape) within the edit allowance — Levenshtein ≤ 2, or
 *     ≤ 3 when the token has ≥ 8 characters (Huttondon → Huntingdon is three) — and within that many characters of
 *     length; EXACTLY ONE candidate (two or more: ambiguous, untouched);
 *   - not an inflectional pair of the candidate (a crude stem: plural s / es / ies, -ed, -ing, -er — HOMES ~ home,
 *     Window ~ windows are the page's own word in another form);
 *   - the three guards: not a glyph-only pair (apostrophes normalised before comparing — Miele's ~ Miele’s); the
 *     candidate not a truncated prefix of the token (Replacement ~ the layer's broken "Replacemen"); the token's
 *     hyphen-free twin not a word the page prints;
 *   → every occurrence of the token on every line in scope becomes the page's capitalised spelling, and ONE record
 *     { from, to, edits, sections, lines } is kept per distinct token of the caption (the probe's count: a caption that
 *     prints a misread row twice — Miele p68's "Cotions" — is one substitution on two lines).
 * Deterministic and idempotent: the same inputs give the same caption; a reconciled caption reconciles to itself.
 * A page without a text layer (an empty `pageText`) leaves the caption untouched.
 *
 *   reconcileCaption(caption, pageText, { minLen = 5 } = {}) → { caption, substitutions }
 *
 * `pageText` is the page's stripped text as the parser holds it (`doclingPages[i].markdown`, T18) — the input the text
 * chunks are cut from, case preserved. The parser applies this at its one seam (`pic.caption = result.caption`), a memo
 * hit and a model reply alike (D3: the memo stays raw; the rule re-runs on every recall).
 */
const TOKEN = /[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g;
const PROPER = /^[A-Z][a-z]/;
const ALPHA = /^[A-Za-z][A-Za-z'’-]*$/;
const LABEL = /^(?:HUMAN TITLE|TITLE|DIAGRAM TYPE|TYPE|KEY SUBJECTS|SUBJECTS|TRANSCRIPTION|DESCRIPTION):/;

const tokensOf = (s) => String(s || "").match(TOKEN) || [];
const apostrophes = (t) => t.replace(/[’']/g, "'");
/** A crude English stem for the inflection guard (the probe's): plural s / es / ies, -ed, -ing, -er stripped. */
const stem = (t) => t.toLowerCase().replace(/ies$/, "y").replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2)).replace(/(ing|ed|er|es|s)$/, "");

/** Levenshtein distance, capped: `cap + 1` as soon as the lengths alone exceed the cap. */
function levenshtein(a, b, cap) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** The page's lexicon: every word lower-cased, and the capitalised (proper-noun-shaped) words by their lower-case form — the first spelling seen. */
function pageLexicon(pageText) {
  const words = new Set();
  const caps = new Map();
  for (const t of tokensOf(pageText)) {
    const lower = t.toLowerCase();
    words.add(lower);
    if (PROPER.test(t) && !caps.has(lower)) caps.set(lower, t);
  }
  return { words, caps };
}

/** The lines the rule reads: the TITLE line (its text after the label) and the TRANSCRIPTION block's lines, by index. */
function scopeOf(lines) {
  const scope = [];
  let inTranscription = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(?:HUMAN )?TITLE:/.test(line)) { inTranscription = false; scope.push({ index: i, section: "TITLE", offset: line.indexOf(":") + 1 }); continue; }
    if (/^TRANSCRIPTION:/.test(line)) { inTranscription = true; const offset = line.indexOf(":") + 1; if (line.slice(offset).trim()) scope.push({ index: i, section: "TRANSCRIPTION", offset }); continue; }
    if (LABEL.test(line)) { inTranscription = false; continue; }
    if (inTranscription) scope.push({ index: i, section: "TRANSCRIPTION", offset: 0 });
  }
  return scope;
}

/** Rule E for one caption token against the page's lexicon: the page's spelling and the edit count, or null. */
function reconcileToken(tok, lexicon, minLen) {
  if (!PROPER.test(tok) || tok.length < minLen || !ALPHA.test(tok)) return null;
  const lower = tok.toLowerCase();
  if (lexicon.words.has(lower)) return null;
  const maxD = lower.length >= 8 ? 3 : 2;
  const near = [];
  for (const cand of lexicon.caps.keys()) {
    if (cand.length < minLen - 1 || Math.abs(cand.length - lower.length) > maxD) continue;
    const d = levenshtein(lower, cand, maxD);
    if (d <= maxD) { near.push({ cand, d }); if (near.length > 1) return null; }
  }
  if (near.length !== 1) return null;
  const { cand, d } = near[0];
  if (stem(lower) === stem(cand)) return null;
  if (lower.length > cand.length && lower.startsWith(cand)) return null;
  if (apostrophes(lower) === apostrophes(cand)) return null;
  if (/-/.test(lower) && lexicon.words.has(lower.replace(/-/g, ""))) return null;
  return { to: lexicon.caps.get(cand), edits: d };
}

/** Every whole-token occurrence of `from` on the line becomes `to` (tokens are split exactly as TOKEN reads them). */
function replaceOnLine(line, from, to) {
  return line.replace(TOKEN, (t) => (t === from ? to : t));
}

function reconcileCaption(caption, pageText, { minLen = 5 } = {}) {
  const text = String(caption || "");
  if (!/\S/.test(String(pageText || ""))) return { caption: text, substitutions: [] };
  const lexicon = pageLexicon(pageText);
  const lines = text.split("\n");
  const byToken = new Map();
  for (const { index, section, offset } of scopeOf(lines)) {
    const head = lines[index].slice(0, offset), body = lines[index].slice(offset);
    let out = body;
    for (const tok of new Set(tokensOf(body))) {
      const r = byToken.has(tok) ? byToken.get(tok) : reconcileToken(tok, lexicon, minLen);
      if (!r) continue;
      out = replaceOnLine(out, tok, r.to);
      if (!byToken.has(tok)) byToken.set(tok, { from: tok, to: r.to, edits: r.edits, sections: [], lines: [] });
      const rec = byToken.get(tok);
      if (!rec.sections.includes(section)) rec.sections.push(section);
      rec.lines.push(index);
    }
    lines[index] = head + out;
  }
  return { caption: lines.join("\n"), substitutions: [...byToken.values()] };
}

module.exports = { reconcileCaption, reconcileToken, pageLexicon, scopeOf, levenshtein, stem, tokensOf };
