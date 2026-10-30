/**
 * src/lib/coding/regulator_refs.js — the regulator provisions a rule's "Traces to:" line names, and the checked index
 * that says where each one is printed (S4-D5 (a) of 2026-10-12: follow a policy clause's trace line into the regulator
 * layer, D11's rule chains taken one layer higher).
 *
 * Pure (no I/O). regulatorRefs reads the trace lines in a passage's text and returns canonical keys:
 *   psrs:84          Payment Services Regulations 2017, regulation 84
 *   sysc:4.1.1R      FCA SYSC 4.1.1R (and sysc:15A.4.3R, sysc:15A.5.6G …)
 *   ss1-21:6.6       PRA SS1/21 paragraph 6.6;  ss2-21:2.4  PRA SS2/21 paragraph 2.4
 *   pci:6.5.1        PCI DSS v4.0.1 Requirement 6.5.1
 *   fca-ai:p16       FCA AI Update (April 2024), page 16
 *   boe-ai:annex-9   Bank of England AI letter, annex paragraph 9
 *   ps21-3:p30       FCA PS21/3, page 30;  ps21-3:1.7  FCA PS21/3 paragraph 1.7
 *   asvs:1.2.4       OWASP ASVS 5.0.0 requirement 1.2.4 (S6-D5 (b) of 2026-10-13: the external secure-coding reference)
 * Lists and ranges expand ("regulations 89(1), 89(3) and 99(1)", "paragraphs 2.3 to 2.6", "SYSC 4.1.1R and 4.1.2R").
 * A segment naming no regulator (a policy clause, "none (squad practice)") gives nothing.
 *
 * The index (src/data/scenarios/regulator_index.json, built and checked against the live store by the S4 build's
 * evidence scripts) maps a key to the store document, the page and the provision's own opening words (the anchor).
 * matchesAnchor accepts a retrieved passage only when it holds those words in order, so a lookup that lands on the
 * wrong passage is reported as not found, never shown as the provision.
 */

const asString = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/**
 * How a provision is looked up: a search inside its one document with the anchor as the query, the whole pool of 8
 * returned, with the retrieve route's reranker off (`rerankEnabled: false`, an option the frozen route already takes).
 * The query is the provision's own words and pickProvision decides which passage is the provision, so ranking adds time,
 * not accuracy: with the reranker on, a lookup took 2 to 15 s while the reranker served one request at a time; off, the
 * index's 57 checks took under 5 s in all (session-90-s4-build). The index check and the measurement use this setting.
 */
const REGULATOR_LOOKUP = Object.freeze({ rerankEnabled: false, limit: 8, keepTopNAfterRerank: 8 });
/** At most this many of the provisions the evidence names are looked up in one turn, besides the step's own (chooseLookups). */
const REGULATOR_LOOKUPS_MAX = 6;

/** The trace lines of a passage: every "Traces to:" up to the end of its line. */
function traceLines(text) {
  const out = [];
  for (const m of asString(text).matchAll(/Traces to:\s*([^\n]+)/g)) out.push(m[1].trim());
  return out;
}

const rangeOf = (a, b) => {
  const [ma, na] = a.split(".").map(Number);
  const [mb, nb] = b.split(".").map(Number);
  if (ma !== mb || !(nb >= na) || nb - na > 20) return [a, b];
  const out = [];
  for (let n = na; n <= nb; n++) out.push(`${ma}.${n}`);
  return out;
};

/** Paragraph numbers in "paragraphs 2.3 to 2.6", "paragraphs 5.9 and 6.6", "paragraph 8.1". */
function paragraphs(s) {
  const out = [];
  const t = s.replace(/(\d+\.\d+)\s+to\s+(\d+\.\d+)/g, (m, a, b) => rangeOf(a, b).join(" "));
  for (const m of t.matchAll(/\b(\d+\.\d+)\b/g)) out.push(m[1]);
  return out;
}

/** One trace-line segment (between semicolons) → [{ key, label }]. */
function segmentRefs(segment) {
  const s = segment.replace(/\s+/g, " ").trim();
  const out = [];
  const push = (key, label) => out.push({ key, label });
  let m;
  if ((m = s.match(/Payment Services Regulations 2017,? regulations? (.+)$/i))) {
    for (const n of [...new Set([...m[1].matchAll(/(?:^|[^\d(])(\d{1,3})(?=\(|\b)/g)].map((x) => x[1]))]) push(`psrs:${n}`, `Payment Services Regulations 2017, regulation ${n}`);
  } else if (/\bSYSC\b/.test(s)) {
    for (const x of s.matchAll(/\b(\d{1,2}[A-Z]?\.\d{1,2}\.\d{1,2})(?:-?A)?\s?([RG])\b/g)) push(`sysc:${x[1]}${x[2]}`, `FCA SYSC ${x[1]}${x[2]}`);
  } else if ((m = s.match(/PRA SS1\/21 paragraphs? (.+)$/i))) {
    for (const p of paragraphs(m[1])) push(`ss1-21:${p}`, `PRA SS1/21 paragraph ${p}`);
  } else if ((m = s.match(/PRA SS2\/21 paragraphs? (.+)$/i))) {
    for (const p of paragraphs(m[1])) push(`ss2-21:${p}`, `PRA SS2/21 paragraph ${p}`);
  } else if ((m = s.match(/PCI DSS v4\.0\.1 Requirements? (.+)$/i))) {
    for (const x of m[1].matchAll(/\b(\d+\.\d+(?:\.\d+)*)\b/g)) push(`pci:${x[1]}`, `PCI DSS v4.0.1 Requirement ${x[1]}`);
  } else if ((m = s.match(/OWASP ASVS 5\.0\.0,? requirements? (.+)$/i))) {
    for (const x of m[1].matchAll(/\b(\d{1,2}\.\d{1,2}\.\d{1,2})\b/g)) push(`asvs:${x[1]}`, `OWASP ASVS 5.0.0 requirement ${x[1]}`);
  } else if ((m = s.match(/FCA AI Update \(April 2024\),? pages? (.+)$/i))) {
    for (const x of m[1].matchAll(/\b(\d{1,3})\b/g)) push(`fca-ai:p${x[1]}`, `FCA AI Update (April 2024), page ${x[1]}`);
  } else if ((m = s.match(/Bank of England AI letter.*?annex paragraph (\d+)/i))) {
    push(`boe-ai:annex-${m[1]}`, `Bank of England AI letter (April 2024), annex paragraph ${m[1]}`);
  } else if ((m = s.match(/FCA PS21\/3,? chapter \d+ \(pages? ([^)]+)\)/i))) {
    for (const x of m[1].matchAll(/\b(\d{1,3})\b/g)) push(`ps21-3:p${x[1]}`, `FCA PS21/3, page ${x[1]}`);
  } else if ((m = s.match(/FCA PS21\/3,? paragraphs? (.+)$/i))) {
    for (const p of paragraphs(m[1])) push(`ps21-3:${p}`, `FCA PS21/3 paragraph ${p}`);
  }
  return out;
}

/** Every regulator provision the passage's trace lines name, each once, in order. */
function regulatorRefs(text) {
  const seen = new Set();
  const out = [];
  for (const line of traceLines(text)) {
    for (const seg of line.split(";")) {
      for (const r of segmentRefs(seg)) {
        if (seen.has(r.key)) continue;
        seen.add(r.key);
        out.push(r);
      }
    }
  }
  return out;
}

/** Lower-case alphanumeric words, accents and punctuation dropped: the form two extractions of one PDF agree on. */
function wordsOf(s) {
  return asString(s)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * True when `text` holds `need` consecutive words of `anchor` in order, taken from any of the anchor's first windows
 * (a heading at the anchor's start may be printed differently by the store's own PDF extraction). Eight words in a
 * row are specific enough that a wrong passage does not pass.
 */
function matchesAnchor(text, anchor, need = 8) {
  return anchorStart(text, anchor, need) !== null;
}

/**
 * Where the anchor starts in `text`, in words from the text's start (negative when the text begins inside the anchor), or
 * null when the text does not hold it (matchesAnchor's rule). The earliest window that matches decides.
 */
function anchorStart(text, anchor, need = 8) {
  const a = wordsOf(anchor);
  const t = wordsOf(text);
  const k = Math.min(need, a.length);
  if (k === 0) return null;
  let best = null;
  for (let s = 0; s + k <= a.length && s <= 6; s++) {
    for (let i = 0; i + k <= t.length; i++) {
      let j = 0;
      while (j < k && t[i + j] === a[s + j]) j++;
      if (j === k && (best === null || i - s < best)) best = i - s;
    }
  }
  return best;
}

/**
 * The returned passage that IS the provision (session 90, 2026-10-12): a row on the page where the build located the
 * provision by its own number that holds the anchor, and of those the one where the anchor starts earliest, which
 * carries the provision on rather than ending with its first words (chunks overlap). An anchor's words may be repeated
 * elsewhere in a document (PSRs regulation 89's on page 18, SS1/21 paragraph 4.5's on page 14): a row on another page is
 * never taken for the provision. Null when no row qualifies: the provision is then reported as not found.
 */
function pickProvision(rows, entry) {
  const page = Number(entry && entry.page);
  const list = (Array.isArray(rows) ? rows : [])
    .map((row, rank) => ({ row, rank, at: row && Number(row.page) === page ? anchorStart(row.text, entry.anchor) : null }))
    .filter((x) => x.at !== null);
  if (list.length === 0) return null;
  list.sort((x, y) => x.at - y.at || x.rank - y.rank);
  return list[0].row;
}

/**
 * The provisions to look up for a turn's evidence: each regulator key named by a corporate or standards passage's trace
 * lines that the index holds as verified, at most `max`, with the rule ids that named it (tracedFrom). Keys whose
 * provision the evidence already carries (a regulator passage holding the anchor) are left out.
 */
function regulatorLookups(passages, index, { max = 6 } = {}) {
  const entries = index && index.entries && typeof index.entries === "object" ? index.entries : {};
  const list = Array.isArray(passages) ? passages : [];
  const regulatorText = list.filter((p) => p.pillar === "regulator").map((p) => asString(p.text));
  const byKey = new Map();
  for (const p of list) {
    if (p.pillar !== "corporate" && p.pillar !== "sdlc") continue;
    const from = ruleIdOf(p) || p.marker;
    for (const r of regulatorRefs(p.text)) {
      const e = entries[r.key];
      if (!e || e.verified !== true) continue;
      if (regulatorText.some((t) => matchesAnchor(t, e.anchor))) continue;
      const it = byKey.get(r.key) || { key: r.key, label: r.label, source: e.source, page: e.page, anchor: e.anchor, tracedFrom: [] };
      if (from && !it.tracedFrom.includes(from)) it.tracedFrom.push(from);
      byKey.set(r.key, it);
    }
  }
  return [...byKey.values()].slice(0, max);
}

/**
 * The provisions a turn looks up, from those the evidence names (regulatorLookups, in evidence order), S6-D8 of
 * 2026-10-13: the provisions the step's own rules (`traceRules`) name first, every one of them, then up to `max` of the
 * others. Measured: S6's audit named 18 provisions and SEC-POL-001's PCI DSS ones filled the six, so the OWASP ASVS
 * requirements its own rules (STD-SVS) name, 14th to 18th, were never looked up (session-90-s6-measure). A step that names
 * no rules, or rules that name no provision (S5's Assess: STD-DOC's), looks up what it did before.
 */
function chooseLookups(named, { ownRules = [], max = REGULATOR_LOOKUPS_MAX } = {}) {
  const own = new Set(Array.isArray(ownRules) ? ownRules : []);
  const list = Array.isArray(named) ? named : [];
  const mine = list.filter((l) => (l.tracedFrom || []).some((r) => own.has(r)));
  return [...mine, ...list.filter((l) => !mine.includes(l)).slice(0, max)];
}

/** The rule a passage states: its bold id at the start ("**FIN-POL-003 clause 4.3:", "**PAY-012 …"), or null. */
function ruleIdOf(p) {
  if (p && typeof p.ruleId === "string" && p.ruleId) return p.ruleId;
  const m = asString(p && p.text).match(/\*\*((?:[A-Z]{2,5}-POL-\d{3} clause \d+\.\d+)|(?:[A-Z]{2,5}-\d{3}))\b/);
  return m ? m[1] : null;
}

module.exports = { REGULATOR_LOOKUP, REGULATOR_LOOKUPS_MAX, traceLines, segmentRefs, regulatorRefs, wordsOf, matchesAnchor, anchorStart, pickProvision, regulatorLookups, chooseLookups, ruleIdOf };
