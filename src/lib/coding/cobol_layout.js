/**
 * src/lib/coding/cobol_layout.js — a COBOL program's record and report layouts, computed from its DATA DIVISION (S3,
 * the clearing batch migration; s3-design.md, the feasibility measurement of 2026-10-10).
 *
 * Pure (no I/O). A migration fails first on column positions: asked to port CLEARING.cbl with only its source, the code
 * model miscounted the input record's columns in its head (the amount read one column off) and then distrusted the
 * program's own output (inputs/demo-design/evidence/session-90-s3-feasibility/). The positions are a fact of the
 * source, so a tool computes them: each 01 record's fields with their 1-based columns, widths and pictures, what each
 * picture means, and each literal exactly as written. The block reaches the prompt as tool facts, as S2's pre-merge
 * checks do; the model ports the logic.
 *
 * Scope: fixed-format source (columns 8 to 72, `*` in column 7 for a comment), level 01 records with elementary items
 * (any level number above 01), PIC X, 9, S, V, the editing symbols Z , . - and the repeat form `9(4)`,
 * SIGN LEADING SEPARATE, VALUE literals. A REDEFINES, an OCCURS or a group nested inside a record is reported as not
 * laid out rather than guessed.
 */

const REPEAT = /([A-Z9,.\-+*$])\((\d+)\)/g;
const NOT_LAID_OUT = /\b(REDEFINES|OCCURS|COMP(?:UTATIONAL)?(?:-\d)?|BINARY|PACKED-DECIMAL)\b/;

/** A picture with its repeats written out: `S9(3)V99` → `S999V99`. */
function expandPicture(pic) {
  return String(pic || "").toUpperCase().replace(REPEAT, (_, c, n) => c.repeat(Number(n)));
}

/** The characters a field takes in a record: every symbol but S and V, and one more for a separate sign. */
function pictureWidth(pic, { signSeparate = false } = {}) {
  const exp = expandPicture(pic);
  return exp.replace(/^S/, "").replace(/V/g, "").length + (signSeparate && exp.startsWith("S") ? 1 : 0);
}

/** What a picture holds, in words. */
function describePicture(pic, { signSeparate = false } = {}) {
  const exp = expandPicture(pic);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (/^X+$/.test(exp)) return `text, ${plural(exp.length, "character")}`;
  if (/^S?9+(V9+)?$/.test(exp)) {
    const [whole, frac] = exp.replace(/^S/, "").split("V");
    const sign = exp.startsWith("S") ? (signSeparate ? "a separate leading sign character (+ or -), then " : "signed, ") : "";
    return frac
      ? `number: ${sign}${plural(whole.length, "digit")} before an implied decimal point and ${frac.length} after it (no point is stored)`
      : `number: ${sign}${plural(whole.length, "digit")}`;
  }
  if (/^[Z9,.\-]+$/.test(exp)) return `edited number (${plural(exp.length, "character")}; see the editing symbols below)`;
  return `picture ${pic} (${plural(exp.length, "character")})`;
}

/** The DATA DIVISION as sentences: comment lines dropped, whitespace collapsed outside quoted literals. */
function dataSentences(source) {
  const all = String(source || "").split(/\r?\n/);
  const start = all.findIndex((l) => /^\s*DATA\s+DIVISION\b/i.test(l.slice(7)));
  const end = all.findIndex((l, i) => i > start && /^\s*PROCEDURE\s+DIVISION\b/i.test(l.slice(7)));
  const lines = all.slice(start < 0 ? 0 : start, end < 0 ? all.length : end).filter((l) => l.length > 6 && l[6] !== "*" && l[6] !== "/").map((l) => l.slice(7, 72));
  let text = "";
  let quoted = false;
  for (const ch of lines.join(" ")) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && /\s/.test(ch)) {
      if (!text.endsWith(" ")) text += " ";
      continue;
    }
    text += ch;
  }
  // A sentence ends at a period followed by a space or the end: the period in a picture (9.99) does not end one.
  const out = [];
  let cur = "";
  quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "." && (i + 1 === text.length || text[i + 1] === " ")) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Every level 01 record of the DATA DIVISION: `[{ name, pic, value, fields: [{ level, name, pic, value, signSeparate,
 * start, end, width, description }], width, laidOut, reason }]`. A record whose items cannot be laid out exactly is
 * returned with `laidOut: false` and the reason.
 */
function recordLayouts(source) {
  const records = [];
  let rec = null;
  for (const s of dataSentences(source)) {
    const m = s.match(/^(\d{2})\s+([A-Z0-9-]+)\b\s*(.*)$/i);
    if (!m) continue;
    const level = Number(m[1]);
    const rest = m[3];
    const pic = (rest.match(/\bPIC(?:TURE)?\s+(?:IS\s+)?(\S+)/i) || [])[1] || null;
    const value = (rest.match(/\bVALUE\s+(?:IS\s+)?("[^"]*"|\S+)/i) || [])[1] || null;
    const item = { level, name: m[2].toUpperCase(), pic, value, signSeparate: /\bSIGN\s+(?:IS\s+)?LEADING\s+SEPARATE\b/i.test(rest), clauses: rest };
    if (level === 1) {
      rec = { name: item.name, pic, value, items: [item], laidOut: true, reason: null };
      records.push(rec);
    } else if (rec && level > 1 && level < 50) {
      rec.items.push(item);
    }
  }
  return records.map((r) => {
    const own = r.items[0];
    const elems = r.items.length > 1 ? r.items.slice(1) : [own];
    const blocked = r.items.find((i) => NOT_LAID_OUT.test(i.clauses)) || (r.items.length > 1 && elems.find((i) => !i.pic));
    if (blocked) return { name: r.name, pic: r.pic, value: r.value, fields: [], width: null, laidOut: false, reason: `${blocked.name}: ${NOT_LAID_OUT.test(blocked.clauses) ? blocked.clauses.match(NOT_LAID_OUT)[1] : "a group item"} is not laid out by this tool` };
    let col = 1;
    const fields = elems
      .filter((i) => i.pic)
      .map((i) => {
        const width = pictureWidth(i.pic, { signSeparate: i.signSeparate });
        const f = { level: i.level, name: i.name, pic: i.pic, value: i.value, signSeparate: i.signSeparate, start: col, end: col + width - 1, width, description: describePicture(i.pic, { signSeparate: i.signSeparate }) };
        col += width;
        return f;
      });
    return { name: r.name, pic: r.pic, value: r.value, fields, width: col - 1, laidOut: true, reason: null };
  });
}

const EDITING_SYMBOLS = [
  "Editing symbols in an edited number: 9 is always a digit; Z is a digit that shows as a space while it is a leading zero; a comma shows only once a digit before it has shown (otherwise a space); . is a literal decimal point; a trailing - shows - for a negative value and a space otherwise.",
];
const TEXT_MOVES = "Text items: a MOVE to a PIC X(n) item pads the value with spaces on the right to exactly n characters (or cuts it to n): a short value still takes all n columns.";

/**
 * A record that mixes data items and fillers, as a line template: each data item a named placeholder, each filler its
 * exact text ("{RD-SCHEME}  {RD-COUNT}  {RD-GROSS} {RD-FEES} {RD-NET}", 5 data items). Measured on 2026-10-10: Rust
 * ports wrote the detail line's format string with six placeholders for five values in 4 of 5 runs, even when told
 * the order in words; the template is a fact of the source, with exactly one placeholder per data item.
 */
function assemblyText(record) {
  if (!record.laidOut || record.fields.length < 2) return null;
  const data = record.fields.filter((f) => !(f.name === "FILLER" && f.value));
  if (data.length === record.fields.length || data.length === 0) return null;
  const parts = record.fields.map((f) => {
    if (f.name === "FILLER" && f.value) {
      const v = String(f.value);
      if (/^SPACES?$/i.test(v)) return " ".repeat(f.width);
      return /^".*"$/.test(v) ? v.slice(1, -1).padEnd(f.width).slice(0, f.width) : v;
    }
    return `{${f.name}}`;
  });
  return `"${parts.join("")}" (${data.length} data item${data.length === 1 ? "" : "s"}, each {NAME} the item at its full width)`;
}

/** A record made only of literals (every field has a VALUE) as it prints, or null. */
function constantText(record) {
  if (!record.laidOut || record.fields.length === 0 || !record.fields.every((f) => f.value)) return null;
  return record.fields
    .map((f) => {
      const v = String(f.value);
      const literal = /^".*"$/.test(v) ? v.slice(1, -1) : /^SPACES?$/i.test(v) ? "" : null;
      return literal === null ? null : literal.padEnd(f.width).slice(0, f.width);
    })
    .reduce((acc, x) => (acc === null || x === null ? null : acc + x), "");
}

/**
 * The RECORD AND REPORT LAYOUTS block for the prompt: the named records (all laid-out records when `names` is empty),
 * in source order, each field with its columns, width, picture, meaning and literal. `{ text, records }`.
 */
function layoutBlock(source, { names = [] } = {}) {
  const wanted = (Array.isArray(names) ? names : []).map((n) => String(n).toUpperCase());
  const all = recordLayouts(source);
  const records = wanted.length ? all.filter((r) => wanted.includes(r.name)) : all.filter((r) => r.laidOut);
  const out = [
    "RECORD AND REPORT LAYOUTS — computed by a tool from the program's DATA DIVISION, verified by tool: columns are 1-based; every record and report line is fixed width, and a line-sequential file is written without its trailing spaces.",
  ];
  let edited = false;
  let textMoves = false;
  for (const r of records) {
    out.push("", `${r.name}${r.laidOut ? ` (${r.width} characters)` : ""}:`);
    if (!r.laidOut) {
      out.push(`- not laid out: ${r.reason}`);
      continue;
    }
    const constant = constantText(r);
    if (constant !== null) out.push(`- as it prints, every character literal (trailing spaces dropped on a line-sequential file): "${constant.replace(/ +$/, "")}"`);
    const assembly = assemblyText(r);
    if (assembly !== null) out.push(`- as a line: ${assembly}`);
    for (const f of r.fields) {
      if (/edited/.test(f.description)) edited = true;
      if (/^text/.test(f.description) && !f.value) textMoves = true;
      const literal = f.value ? `; holds ${f.value}` : "";
      out.push(`- columns ${f.start}-${f.end} (${f.width}): ${f.name === r.name ? r.name : f.name} PIC ${f.pic}${f.signSeparate ? " SIGN LEADING SEPARATE" : ""} — ${f.description}${literal}`);
    }
  }
  if (edited) out.push("", ...EDITING_SYMBOLS);
  if (textMoves) out.push("", TEXT_MOVES);
  return { text: out.join("\n"), records };
}

module.exports = { expandPicture, pictureWidth, describePicture, dataSentences, recordLayouts, constantText, assemblyText, layoutBlock };
