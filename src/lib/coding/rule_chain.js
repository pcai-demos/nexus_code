/**
 * src/lib/coding/rule_chain.js — the documents' own trace lines, followed (S2 follow-up, D11 (a) of 2026-10-10).
 *
 * Every rule paragraph of the internal layers opens with its bold ID (`**SCS-010 No hard-coded secrets.**`,
 * `**SEC-POL-001 clause 4.3: Secrets and credentials.**`, `**CLR-DIGEST-2026-04 F8: …**`) and ends with a `Traces to:`
 * line naming what it implements. A review's tool findings each name their rule. For each, the turn adds to the
 * evidence the rule's own paragraph (SDLC), the policy clauses its trace line names (corporate) and the team notes whose
 * trace line names the rule (team): the chain the documents state, looked up rather than searched, so a Critical
 * finding never depends on a search ranking. The regulator layer is not traced: a clause's trace line names the
 * provisions, and the turn's search brings their text.
 *
 * Measured before the change (inputs/demo-design/evidence/session-90-s2-layers/): one blended search of four passages
 * per layer gave S2's review nothing for T1 (the hard-coded key), T3, T4, T5 and idempotency; one search per finding
 * found each rule first but took 229 s for 52 searches.
 *
 * Pure apart from loadRegister, which reads the Markdown files of the documents a layer resolved as present (in the
 * store, and on the demo's card when a demo is selected) from the image's demo files.
 */

const fs = require("fs");
const path = require("path");

const TRACED_LAYERS = Object.freeze(["corporate", "sdlc", "team"]);
/** A paragraph's ID: a policy clause, a team note (a letter and a number after the document ID), or a standard's rule. */
const PARAGRAPH_RE = /^\*\*([A-Z]{3}-POL-\d{3} clause \d+\.\d+(?=:)|[A-Z][A-Z0-9-]*\d [A-Z]\d{1,2}(?=:)|[A-Z]{2,4}-\d{3}(?= ))/;
const POLICY_ID_RE = /[A-Z]{3}-POL-\d{3}/g;
const RULE_REF_RE = /(?<![A-Z0-9-])([A-Z]{2,4}-\d{3})(?![\d-])/g;
/** Team notes kept per rule (document order), and traced passages per turn: the prompt stays in measure. */
const TEAM_PER_RULE = 3;
const MAX_TRACED = 32;

const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** A paragraph's title: the bold opening without its ID (`No hard-coded secrets`, `Secrets and credentials`). */
function titleOf(firstLine, id) {
  const m = firstLine.match(/^\*\*(.+?)\.?\*\*/);
  if (!m) return null;
  return squash(m[1].slice(id.length).replace(/^[:\s]+/, "").replace(/\.$/, "")) || null;
}

/** The rule paragraphs of one Markdown document: `[{ id, title, text, traces }]`, in document order. */
function parseRules(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PARAGRAPH_RE);
    if (!m) continue;
    const id = m[1];
    const body = [lines[i]];
    let traces = "";
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (PARAGRAPH_RE.test(line) || /^#{1,6}\s/.test(line)) break;
      if (/^Traces to:/.test(line)) {
        body.push(line);
        traces = squash(line.replace(/^Traces to:/, ""));
        i = j;
        break;
      }
      body.push(line);
    }
    out.push({ id, title: titleOf(body[0], id), text: body.join("\n").trim(), traces });
  }
  return out;
}

/** The policy clauses a trace line names: `SEC-POL-001 clauses 4.3 and 4.9` → `SEC-POL-001 clause 4.3`, `… clause 4.9`. */
function policyRefs(traces) {
  const t = String(traces || "");
  const ids = [...t.matchAll(POLICY_ID_RE)];
  const out = [];
  ids.forEach((m, k) => {
    const end = k + 1 < ids.length ? ids[k + 1].index : t.length;
    const segment = t.slice(m.index + m[0].length, end).split(";")[0];
    for (const n of segment.matchAll(/\b(\d+\.\d+)\b/g)) out.push(`${m[0]} clause ${n[1]}`);
  });
  return [...new Set(out)];
}

/** The standards' rules a trace line names (`SCS-010 and SCS-011 (Secure Coding Standard)` → SCS-010, SCS-011). */
function ruleRefs(traces) {
  return [...new Set([...String(traces || "").matchAll(RULE_REF_RE)].map((m) => m[1]))];
}

/**
 * The register: every rule paragraph of the given documents, keyed by ID. `docs` is `[{ layer, source, markdown }]`;
 * each entry is `{ id, title, layer, source, text, traces, refs }`, `refs` being the IDs its trace line names that the
 * register holds.
 */
function buildRegister(docs) {
  const byId = new Map();
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || !TRACED_LAYERS.includes(d.layer)) continue;
    for (const r of parseRules(d.markdown)) {
      if (!byId.has(r.id)) byId.set(r.id, { ...r, layer: d.layer, source: d.source, refs: [] });
    }
  }
  for (const r of byId.values()) r.refs = [...policyRefs(r.traces), ...ruleRefs(r.traces)].filter((x) => x !== r.id && byId.has(x));
  return byId;
}

/**
 * The team notes whose trace line names a rule, at most TEAM_PER_RULE, one per document first (in layer order), so one
 * page's several notes do not crowd out another page or the digest: for SCS-021, CLR-WIKI-014 R2, CLR-WIKI-006 T1 (the
 * stale tip) and the digest's F3 rather than CLR-WIKI-014 R2, R3 and R4.
 */
function teamNotes(team, ruleId) {
  const bySource = new Map();
  for (const t of team.filter((x) => x.refs.includes(ruleId))) {
    if (!bySource.has(t.source)) bySource.set(t.source, []);
    bySource.get(t.source).push(t);
  }
  const out = [];
  for (let round = 0; out.length < TEAM_PER_RULE; round++) {
    const picks = [...bySource.values()].map((xs) => xs[round]).filter(Boolean);
    if (!picks.length) break;
    out.push(...picks.slice(0, TEAM_PER_RULE - out.length));
  }
  return out;
}

/**
 * The chains for the given roots (`[{ rule, from }]`, e.g. `{ rule: "SCS-010", from: "T1" }`): the rule, the clauses its
 * trace line names, and up to TEAM_PER_RULE team notes whose trace line names the rule (teamNotes). `{ items, missing,
 * capped }`:
 * items `[{ id, title, layer, source, text, tracedFrom }]` in authority order (corporate, SDLC, team), one per
 * paragraph, its `tracedFrom` listing every root that reached it; `missing` the roots the register lacks.
 */
function traceChains(register, roots) {
  const reg = register instanceof Map ? register : new Map();
  const items = new Map();
  const add = (r, from) => {
    if (!r) return;
    const it = items.get(r.id) || { id: r.id, title: r.title, layer: r.layer, source: r.source, text: r.text, tracedFrom: [] };
    if (!it.tracedFrom.includes(from)) it.tracedFrom.push(from);
    items.set(r.id, it);
  };
  const missing = [];
  const team = [...reg.values()].filter((r) => r.layer === "team");
  for (const root of Array.isArray(roots) ? roots : []) {
    const rule = reg.get(root && root.rule);
    if (!rule) {
      if (root && root.rule && !missing.includes(root.rule)) missing.push(root.rule);
      continue;
    }
    add(rule, root.from);
    for (const ref of rule.refs) if (reg.get(ref).layer === "corporate") add(reg.get(ref), root.from);
    teamNotes(team, rule.id).forEach((t) => add(t, root.from));
  }
  const order = { corporate: 0, sdlc: 1, team: 2 };
  const all = [...items.values()].sort((a, b) => order[a.layer] - order[b.layer]);
  return { items: all.slice(0, MAX_TRACED), missing, capped: Math.max(0, all.length - MAX_TRACED) };
}

/**
 * The searched passages with the traced paragraphs added: a paragraph a searched passage of the same document already
 * holds is not repeated (that passage gains its `tracedFrom`); the others are numbered after the layer's searched
 * passages (SDLC-5, SDLC-6 …) with `via: "trace"`. `markers` maps a layer id to its marker (pillars' `marker`).
 * Returns `{ passages, added, alreadySearched }`, the passages in authority order.
 */
function withTracedPassages(passages, items, markers) {
  const list = (Array.isArray(passages) ? passages : []).map((p) => ({ ...p }));
  const added = [];
  const alreadySearched = [];
  for (const it of Array.isArray(items) ? items : []) {
    const needle = squash(it.text).slice(0, 200);
    const hit = list.find((p) => p.source === it.source && squash(p.text).includes(needle));
    if (hit) {
      hit.tracedFrom = [...new Set([...(hit.tracedFrom || []), ...it.tracedFrom])];
      alreadySearched.push({ id: it.id, marker: hit.marker });
      continue;
    }
    const marker = markers && markers[it.layer];
    if (!marker) continue;
    const n = list.filter((p) => p.pillar === it.layer).length + 1;
    const p = {
      marker: `${marker}-${n}`,
      pillar: it.layer,
      source: it.source,
      // S4-D5 (a): a regulator provision looked up in its PDF keeps its page and its own label.
      page: Number.isInteger(it.page) && it.page > 0 ? it.page : null,
      sectionPath: it.sectionPath || (it.title ? `${it.id} ${it.title}` : it.id),
      locationKind: Number.isInteger(it.page) && it.page > 0 ? "page" : "section",
      imagePath: null,
      title: null,
      text: it.text,
      cut: Boolean(it.cut),
      score: null,
      via: "trace",
      ruleId: it.id,
      tracedFrom: it.tracedFrom,
    };
    list.push(p);
    added.push({ id: it.id, marker: p.marker });
  }
  const order = { regulator: 0, corporate: 1, sdlc: 2, team: 3 };
  const num = (p) => Number(String(p.marker).split("-").pop()) || 0;
  list.sort((a, b) => (order[a.pillar] ?? 9) - (order[b.pillar] ?? 9) || num(a) - num(b));
  return { passages: list, added, alreadySearched };
}

/** The demo files' folders, searched for a document by its store source name (the file name). */
function findDocumentFile(root, source) {
  if (!source || /[\\/]/.test(source) || !/\.md$/i.test(source)) return null;
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const p = path.join(root, dir, source);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * The register for the layers a turn resolved: only the `present` documents of the corporate, SDLC and team layers
 * (what the store holds, cut to the demo's card), read from `root` (the image's public/demos/demo_files). A document
 * whose file cannot be read is listed in `unreadable`, never thrown.
 */
function loadRegister(pillars, { root } = {}) {
  const docs = [];
  const unreadable = [];
  for (const p of Array.isArray(pillars) ? pillars : []) {
    if (!TRACED_LAYERS.includes(p.id)) continue;
    for (const d of Array.isArray(p.present) ? p.present : []) {
      const file = findDocumentFile(root, d.source);
      if (!file) {
        if (/\.md$/i.test(d.source || "")) unreadable.push(d.source);
        continue;
      }
      try {
        docs.push({ layer: p.id, source: d.source, markdown: fs.readFileSync(file, "utf8") });
      } catch {
        unreadable.push(d.source);
      }
    }
  }
  return { register: buildRegister(docs), documents: docs.length, unreadable };
}

module.exports = {
  TRACED_LAYERS,
  TEAM_PER_RULE,
  MAX_TRACED,
  parseRules,
  policyRefs,
  ruleRefs,
  buildRegister,
  traceChains,
  withTracedPassages,
  findDocumentFile,
  loadRegister,
};
