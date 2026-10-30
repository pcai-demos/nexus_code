/**
 * The answer's markdown as a block tree — ticket T55 (t55-design.md; the owner's D1 (a), D3 (b); F-217).
 *
 * Pure module: no require, no I/O, no framework, no clock (T09 D7 — memory `rag-modularity-is-the-goal`). The chat
 * (`ChatPanel.jsx` `formatMessageContent`) maps the tree to elements whose children are TEXT — nothing here is HTML, so
 * nothing the model writes is ever injected or fetched.
 *
 * The answer is read the way the chat always read it: split on ``` fences first (today's regex, so a code block renders
 * exactly as before), then LINE BY LINE — nothing is joined, so no two of the model's lines or rows can merge (CommonMark
 * would join consecutive lines into one paragraph: 236 recorded answers, t55-design §0d). Blocks:
 *   blank · heading (# … ######) · table · hr (---, ***, ___) · quote (> …, its inner line read as a line) ·
 *   bullet (-, *, + — a depth from the indentation) · ordered (the model's own number kept as text, never renumbered) ·
 *   para (anything else — today's paragraph) · codeblock.
 * A table is GFM's: a header row with a pipe, directly followed by a delimiter row with the SAME number of cells; body
 * rows run until a blank line or a line without a pipe. A row with MORE cells than its header keeps them (GFM drops the
 * excess — production's FS-1 "| Bottom edge → A (vertical) | 220 mm | [S6]" would lose its citation, §0b).
 * Inline: code spans (backtick runs of equal length), then * / _ delimiter runs paired by CommonMark's flanking rules
 * (two for strong, one for em, the rule of three kept); an unpaired run stays text. On every recorded answer the shown
 * text equals CommonMark's but for the cases above (§0d).
 *
 * Every text node carries its source range [start, end); with { withMarkup: true } the parse also returns every source
 * offset consumed as markup, so the census (`t55-artifacts/census55.js`, U-MARKDOWN) proves no character is lost: each
 * one is shown, or consumed as a named piece of markup, or whitespace.
 */
"use strict";

const FENCE_SPLIT = /(```[\s\S]*?```)/g;
const DELIM_ROW = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t\r]*$/;
const HEADING = /^( {0,3})(#{1,6})([ \t]+|$)/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t\r]*$/;
const QUOTE = /^( {0,3}>[ \t]?)/;
const BULLET = /^([ \t]*)([-*+])([ \t]+)/;
const ORDERED = /^([ \t]*)(\d{1,9}[.)])([ \t]+)/;
const PIPE_UNESCAPED = /(^|[^\\])\|/;
const MAX_LIST_DEPTH = 4;
const MAX_PARA_DEPTH = 5;

const isWs = (c) => c === undefined || /\s/.test(c);
const isPunct = (c) => c !== undefined && /[\p{P}\p{S}]/u.test(c);

/** A pipe row's cells as source ranges: split on unescaped pipes; the empty cell outside a leading / trailing pipe dropped. */
function rowCells(line, base) {
  const cuts = [];
  for (let i = 0; i < line.length; i++) if (line[i] === "|" && line[i - 1] !== "\\") cuts.push(i);
  const spans = [];
  let from = 0;
  for (const c of cuts) { spans.push([from, c]); from = c + 1; }
  spans.push([from, line.length]);
  const blank = (s) => line.slice(s[0], s[1]).trim() === "";
  if (spans.length > 1 && blank(spans[0]) && line.slice(0, cuts[0]).trim() === "") spans.shift();
  if (spans.length > 1 && blank(spans[spans.length - 1])) spans.pop();
  return spans.map(([a, b]) => {
    let s = a, e = b;
    while (s < e && /[ \t]/.test(line[s])) s++;
    while (e > s && /[ \t]/.test(line[e - 1])) e--;
    return { start: base + s, end: base + e, raw: line.slice(s, e) };
  });
}

/** Inline tokens of `s` (at source offset `base`): { tokens, markup } — text / code leaves, strong / em nodes. */
function inline(s, base) {
  // 1. Atoms: text runs, escapes, code spans, delimiter runs (with CommonMark's flanking flags).
  const atoms = [];
  let i = 0, text = "", textStart = 0;
  const flush = (at) => { if (text) atoms.push({ kind: "text", text, start: base + textStart, end: base + at }); text = ""; };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && (s[i + 1] === "|" || s[i + 1] === "*" || s[i + 1] === "_" || s[i + 1] === "`")) {
      flush(i);
      atoms.push({ kind: "escape", start: base + i, end: base + i + 1 });
      textStart = i + 1; text = s[i + 1]; i += 2;
      continue;
    }
    if (c === "`") {
      let n = 0;
      while (s[i + n] === "`") n++;
      let j = i + n, close = -1;
      while (j < s.length) {
        if (s[j] === "`") { let m = 0; while (s[j + m] === "`") m++; if (m === n) { close = j; break; } j += m; } else j++;
      }
      if (close > i + n) {
        flush(i);
        atoms.push({ kind: "code", text: s.slice(i + n, close), start: base + i + n, end: base + close, open: [base + i, base + i + n], close: [base + close, base + close + n] });
        i = close + n; textStart = i;
        continue;
      }
      if (!text) textStart = i;
      text += s.slice(i, i + n); i += n;
      continue;
    }
    if (c === "*" || c === "_") {
      let n = 0;
      while (s[i + n] === c) n++;
      const before = s[i - 1], after = s[i + n];
      const left = !isWs(after) && (!isPunct(after) || isWs(before) || isPunct(before));
      const right = !isWs(before) && (!isPunct(before) || isWs(after) || isPunct(after));
      const canOpen = c === "*" ? left : left && (!right || isPunct(before));
      const canClose = c === "*" ? right : right && (!left || isPunct(after));
      flush(i);
      atoms.push({ kind: "delim", ch: c, n, left: n, start: base + i, end: base + i + n, canOpen, canClose });
      i += n; textStart = i;
      continue;
    }
    if (!text) textStart = i;
    text += c; i++;
  }
  flush(s.length);

  // 2. Pair the delimiter runs (CommonMark's process-emphasis, simplified; the rule of three kept).
  const pairs = [];
  for (let k = 0; k < atoms.length; k++) {
    const closer = atoms[k];
    if (closer.kind !== "delim" || !closer.canClose) continue;
    while (closer.left > 0) {
      let found = -1;
      for (let o = k - 1; o >= 0; o--) {
        const op = atoms[o];
        if (op.kind !== "delim" || op.ch !== closer.ch || !op.canOpen || op.left === 0) continue;
        if ((op.canClose || closer.canOpen) && (op.n + closer.n) % 3 === 0 && !(op.n % 3 === 0 && closer.n % 3 === 0)) continue;
        found = o;
        break;
      }
      if (found < 0) break;
      const op = atoms[found];
      const use = op.left >= 2 && closer.left >= 2 ? 2 : 1;
      const oEnd = op.start + op.left, oStart = oEnd - use;
      const cStart = closer.start + (closer.n - closer.left), cEnd = cStart + use;
      pairs.push({ kind: use === 2 ? "strong" : "em", open: [oStart, oEnd], close: [cStart, cEnd] });
      op.left -= use;
      closer.left -= use;
      for (let m = found + 1; m < k; m++) if (atoms[m].kind === "delim") atoms[m].left = 0;
    }
  }

  // 3. The tree: a paired delimiter character is markup; every other character is in a text (or code) leaf, in place.
  const consumed = new Set();
  for (const p of pairs) {
    for (let x = p.open[0]; x < p.open[1]; x++) consumed.add(x);
    for (let x = p.close[0]; x < p.close[1]; x++) consumed.add(x);
  }
  const leaves = [];
  for (const a of atoms) {
    if (a.kind === "text") leaves.push({ t: "text", text: a.text, start: a.start, end: a.end });
    else if (a.kind === "code") leaves.push({ t: "code", text: a.text, start: a.start, end: a.end });
    else if (a.kind === "delim") {
      let runStart = -1;
      for (let x = a.start; x <= a.end; x++) {
        const free = x < a.end && !consumed.has(x);
        if (free && runStart < 0) runStart = x;
        if (!free && runStart >= 0) { leaves.push({ t: "text", text: a.ch.repeat(x - runStart), start: runStart, end: x }); runStart = -1; }
      }
    }
  }
  const ranges = pairs.map((p) => ({ kind: p.kind, from: p.open[1], to: p.close[0] })).sort((a, b) => a.from - b.from || b.to - a.to);
  function nest(from, to, rs) {
    const out = [];
    const inside = leaves.filter((l) => l.start >= from && l.end <= to);
    let li = 0;
    const top = [];
    for (const r of rs) if (r.from >= from && r.to <= to && !top.some((t) => r.from >= t.from && r.to <= t.to)) top.push(r);
    for (const r of top) {
      while (li < inside.length && inside[li].end <= r.from) out.push(inside[li++]);
      out.push({ t: r.kind, children: nest(r.from, r.to, rs.filter((x) => x !== r && x.from >= r.from && x.to <= r.to)) });
      while (li < inside.length && inside[li].start < r.to) li++;
    }
    while (li < inside.length) out.push(inside[li++]);
    return out;
  }
  const tokens = nest(base, base + s.length, ranges);
  const markup = [...consumed].sort((a, b) => a - b);
  for (const a of atoms) if (a.kind === "escape") markup.push(a.start);
  for (const a of atoms) if (a.kind === "code") for (const [p, q] of [a.open, a.close]) for (let x = p; x < q; x++) markup.push(x);
  return { tokens, markup };
}

/**
 * The answer's block tree: { blocks } — with { withMarkup: true }, also { markup }: the source offsets consumed as
 * syntax. Total on junk — a non-string answer is an empty tree.
 */
function parseAnswerMarkdown(text, { withMarkup = false } = {}) {
  const src = typeof text === "string" ? text : "";
  if (!src) return withMarkup ? { blocks: [], markup: [] } : { blocks: [] };
  const blocks = [];
  const markup = [];
  const mark = (a, b) => { for (let x = a; x < b; x++) markup.push(x); };
  const addInline = (s, base) => { const r = inline(s, base); for (const x of r.markup) markup.push(x); return r.tokens; };
  let offset = 0;
  for (const part of src.split(FENCE_SPLIT)) {
    const base = offset;
    offset += part.length;
    // A fenced block: today's regex, today's language / code split.
    if (part.startsWith("```") && part.endsWith("```") && part.length >= 6) {
      const m = part.match(/```([a-zA-Z0-9-]*)\n([\s\S]*?)```/);
      const language = m ? m[1] : "";
      const code = m ? m[2] : part.slice(3, -3);
      const codeStart = m ? base + 3 + m[1].length + 1 : base + 3;
      // The fence's backticks and newline are markup; the language label is shown (the block's header bar).
      mark(base, base + 3);
      mark(base + 3 + language.length, codeStart);
      mark(codeStart + code.length, base + part.length);
      blocks.push({ t: "codeblock", language, text: code, start: codeStart, end: codeStart + code.length, languageRange: language ? [base + 3, base + 3 + language.length] : null });
      continue;
    }
    const lines = [];
    let at = base;
    for (const l of part.split("\n")) { lines.push({ s: l, at }); at += l.length + 1; }
    const indentStack = [];
    const indentOf = (ws) => ws.replace(/\t/g, "    ").length;
    const depthFor = (ind) => {
      while (indentStack.length && indentStack[indentStack.length - 1] > ind) indentStack.pop();
      if (!indentStack.length || indentStack[indentStack.length - 1] < ind) indentStack.push(ind);
      return Math.min(indentStack.length - 1, MAX_LIST_DEPTH);
    };
    for (let i = 0; i < lines.length; i++) {
      const { s, at: la } = lines[i];
      if (s.trim() === "") { blocks.push({ t: "blank" }); mark(la, la + s.length); continue; }
      const next = lines[i + 1];

      // A GFM table: this row, then a delimiter row of the same width.
      if (s.includes("|") && next && DELIM_ROW.test(next.s) && next.s.includes("-") && !HEADING.test(s)) {
        const head = rowCells(s, la), delim = rowCells(next.s, next.at);
        if (head.length === delim.length) {
          const align = delim.map((d) => { const r = d.raw; return /^:-+:$/.test(r) ? "center" : /^:-+$/.test(r) ? "left" : /^-+:$/.test(r) ? "right" : null; });
          const cell = (c) => ({ tokens: addInline(src.slice(c.start, c.end), c.start) });
          const markRow = (line, lat, cs) => { let p = lat; for (const c of cs) { mark(p, c.start); p = c.end; } mark(p, lat + line.length); };
          markRow(s, la, head);
          mark(next.at, next.at + next.s.length);
          const header = head.map(cell);
          const rows = [];
          let j = i + 2;
          while (j < lines.length && lines[j].s.trim() !== "" && PIPE_UNESCAPED.test(lines[j].s) && !HEADING.test(lines[j].s) && !HR.test(lines[j].s)) {
            const cs = rowCells(lines[j].s, lines[j].at);
            markRow(lines[j].s, lines[j].at, cs);
            rows.push(cs.map(cell));
            j++;
          }
          blocks.push({ t: "table", align, header, rows, width: Math.max(header.length, ...rows.map((r) => r.length)) });
          i = j - 1;
          indentStack.length = 0;
          continue;
        }
      }

      const h = HEADING.exec(s);
      if (h) {
        const body = s.slice(h[0].length);
        // An optional closing run of #s (after a space) is markup too.
        const close = /[ \t]+#+[ \t]*$/.exec(body);
        const bodyEnd = close ? close.index : /^#+[ \t]*$/.test(body) ? 0 : body.length;
        const trimmedEnd = body.slice(0, bodyEnd).replace(/[ \t]+$/, "").length;
        mark(la, la + h[0].length);
        mark(la + h[0].length + trimmedEnd, la + s.length);
        blocks.push({ t: "heading", level: h[2].length, tokens: addInline(body.slice(0, trimmedEnd), la + h[0].length) });
        indentStack.length = 0;
        continue;
      }

      if (HR.test(s)) { mark(la, la + s.length); blocks.push({ t: "hr" }); indentStack.length = 0; continue; }

      const q = QUOTE.exec(s);
      if (q) {
        const qa = la + q[1].length;
        mark(la, qa);
        const inner = s.slice(q[1].length);
        const ib = BULLET.exec(inner), io = ORDERED.exec(inner), ih = HEADING.exec(inner);
        if (ib && !HR.test(inner)) {
          mark(qa, qa + ib[0].length);
          blocks.push({ t: "quote", inner: { t: "bullet", depth: 0, tokens: addInline(inner.slice(ib[0].length), qa + ib[0].length) } });
        } else if (io) {
          mark(qa, qa + io[1].length);
          mark(qa + io[1].length + io[2].length, qa + io[0].length);
          blocks.push({ t: "quote", inner: { t: "ordered", depth: 0, number: io[2], numberRange: [qa + io[1].length, qa + io[1].length + io[2].length], tokens: addInline(inner.slice(io[0].length), qa + io[0].length) } });
        } else if (ih) {
          mark(qa, qa + ih[0].length);
          blocks.push({ t: "quote", inner: { t: "heading", level: ih[2].length, tokens: addInline(inner.slice(ih[0].length), qa + ih[0].length) } });
        } else {
          blocks.push({ t: "quote", inner: { t: "para", tokens: addInline(inner, qa) } });
        }
        continue;
      }

      const b = BULLET.exec(s);
      if (b) {
        mark(la, la + b[0].length);
        blocks.push({ t: "bullet", depth: depthFor(indentOf(b[1])), tokens: addInline(s.slice(b[0].length), la + b[0].length) });
        continue;
      }
      const o = ORDERED.exec(s);
      if (o) {
        mark(la, la + o[1].length);
        mark(la + o[1].length + o[2].length, la + o[0].length);
        blocks.push({ t: "ordered", depth: depthFor(indentOf(o[1])), number: o[2], numberRange: [la + o[1].length, la + o[1].length + o[2].length], tokens: addInline(s.slice(o[0].length), la + o[0].length) });
        continue;
      }

      // A plain line — indented under a list item, it keeps the item's depth + 1.
      const lead = /^[ \t]*/.exec(s)[0];
      mark(la, la + lead.length);
      const ind = indentOf(lead);
      let depth = 0;
      if (ind > 0 && indentStack.length) {
        let d = 0;
        for (let k = 0; k < indentStack.length; k++) if (indentStack[k] < ind) d = k + 1;
        depth = Math.min(d, MAX_PARA_DEPTH);
      } else if (ind === 0) indentStack.length = 0;
      blocks.push({ t: "para", depth, tokens: addInline(s.slice(lead.length), la + lead.length) });
    }
  }
  return withMarkup ? { blocks, markup } : { blocks };
}

/** Every text leaf in document order, with its range — the text a renderer of this tree shows (the census's reader). */
function textNodes(tree) {
  const out = [];
  const walkTokens = (ts) => { for (const t of ts) { if (t.t === "text" || t.t === "code") out.push({ start: t.start, end: t.end, text: t.text }); else if (t.children) walkTokens(t.children); } };
  const walkBlock = (b) => {
    if (b.t === "codeblock") {
      if (b.languageRange) out.push({ start: b.languageRange[0], end: b.languageRange[1], text: b.language });
      out.push({ start: b.start, end: b.end, text: b.text });
    } else if (b.t === "table") {
      for (const c of b.header) walkTokens(c.tokens);
      for (const r of b.rows) for (const c of r) walkTokens(c.tokens);
    } else if (b.t === "quote") walkBlock(b.inner);
    else if (b.t === "ordered") { out.push({ start: b.numberRange[0], end: b.numberRange[1], text: b.number }); walkTokens(b.tokens); }
    else if (b.tokens) walkTokens(b.tokens);
  };
  for (const b of tree.blocks) walkBlock(b);
  return out;
}

module.exports = { parseAnswerMarkdown, textNodes, rowCells };
