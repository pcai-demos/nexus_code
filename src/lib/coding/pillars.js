/**
 * src/lib/coding/pillars.js — the four layers of rules a coding turn searches (Machinery PR 1, design §4 steps 4–5;
 * decision D5).
 *
 * Pure (no I/O). The manifest (src/data/scenarios/pillars.json) names each layer's documents by their store source
 * name; resolvePillars intersects it with what the store actually holds (`POST /api/rag/documents`), so a layer whose
 * documents are not ingested yet is reported as empty instead of searched. The coding turn then calls the frozen
 * retrieve route once per layer with `documentFilter` (the filter that route already accepts), numbers the passages
 * with layer markers (REG-1, CORP-1, SDLC-1, TEAM-1), writes the EVIDENCE block in authority order, and checks the
 * answer's markers against the passages it was given — a marker that matches no passage is listed as unverified.
 */

const { locationKindFor } = require("../rag/citations");

/** Authority order, highest first: the evidence block and the persona list the layers in this order. */
const PILLAR_ORDER = Object.freeze(["regulator", "corporate", "sdlc", "team"]);
const PILLAR_MARKERS = Object.freeze({ regulator: "REG", corporate: "CORP", sdlc: "SDLC", team: "TEAM" });
const MARKER_RE = /^(REG|CORP|SDLC|TEAM)-(\d{1,3})$/;
const PASSAGE_MAX_CHARS = 1500;
const QUERY_MAX_CHARS = 1200;

const asString = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const uniqueStrings = (xs) => [...new Set((Array.isArray(xs) ? xs : []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))];

/** The manifest, checked: exactly the four layers, each with a label, its marker and a list of source names. */
function validateManifest(manifest) {
  const list = manifest && Array.isArray(manifest.pillars) ? manifest.pillars : null;
  if (!list) throw new Error("pillar manifest: `pillars` must be a list");
  const ids = list.map((p) => p && p.id);
  for (const id of PILLAR_ORDER) {
    if (ids.filter((x) => x === id).length !== 1) throw new Error(`pillar manifest: layer "${id}" must appear exactly once`);
  }
  if (list.length !== PILLAR_ORDER.length) throw new Error(`pillar manifest: exactly ${PILLAR_ORDER.length} layers expected, found ${list.length}`);
  return {
    firm: asString(manifest.firm).trim() || null,
    pillars: PILLAR_ORDER.map((id) => {
      const p = list.find((x) => x.id === id);
      if (asString(p.marker) !== PILLAR_MARKERS[id]) throw new Error(`pillar manifest: layer "${id}" must use marker ${PILLAR_MARKERS[id]}`);
      return { id, label: asString(p.label).trim() || id, marker: PILLAR_MARKERS[id], description: asString(p.description).trim(), documents: uniqueStrings(p.documents) };
    }),
  };
}

/**
 * Each layer with the documents the store holds (`present`) and the ones the manifest names but the store does not
 * (`missing`). `storeDocuments` is the documents route's list: `[{ source, sourceIds, chunkCount, totalPages }]`.
 */
function resolvePillars(manifest, storeDocuments) {
  const m = validateManifest(manifest);
  const bySource = new Map((Array.isArray(storeDocuments) ? storeDocuments : []).filter((d) => d && typeof d.source === "string").map((d) => [d.source, d]));
  return m.pillars.map((p) => {
    const present = p.documents.filter((s) => bySource.has(s)).map((s) => {
      const d = bySource.get(s);
      return { source: s, sourceIds: Array.isArray(d.sourceIds) ? d.sourceIds.filter((x) => typeof x === "string") : [], chunkCount: Number.isFinite(d.chunkCount) ? d.chunkCount : null };
    });
    return { ...p, present, missing: p.documents.filter((s) => !bySource.has(s)) };
  });
}

/**
 * The layers cut to a demo's own documents (D10 (a) of 2026-10-10): with a selected demo, each layer keeps only the
 * documents on that demo's card, so a demo searches what its Documents panel shows and nothing from another demo's
 * world (S1's 18 April incident had come to read S2's April digest, dated 5 May, which narrates the incident's cause).
 * No card, or an empty one, leaves the layers as they are: a question outside a demo searches everything.
 */
function scopePillars(pillars, sources) {
  const list = Array.isArray(pillars) ? pillars : [];
  const keep = new Set((Array.isArray(sources) ? sources : []).filter((s) => typeof s === "string" && s));
  if (keep.size === 0) return list;
  return list.map((p) => ({
    ...p,
    documents: p.documents.filter((s) => keep.has(s)),
    present: p.present.filter((d) => keep.has(d.source)),
    missing: p.missing.filter((s) => keep.has(s)),
  }));
}

/**
 * The search text: the message, plus the step's retrieval hints when it has them (D5 (a)). The hints are the step's
 * chosen topics, so they are kept whole and a long message is trimmed to make room for them: S3's migrate prompts
 * (1,225 and 1,446 characters) once pushed all six hints past the limit (2026-10-11).
 */
function retrievalQuery({ message, hints } = {}) {
  const m = asString(message).trim();
  const h = uniqueStrings(hints);
  if (h.length === 0) return m.slice(0, QUERY_MAX_CHARS);
  const topics = `\n\nTopics: ${h.join("; ")}`.slice(0, QUERY_MAX_CHARS);
  return `${m.slice(0, QUERY_MAX_CHARS - topics.length).trimEnd()}${topics}`;
}

/**
 * What each layer searches for (D11 (a) of 2026-10-11): `{ [layer]: { on, text } }`. A layer the step gives topics
 * searches on those topics alone (`on: "topics"`), written in the words of the documents that layer holds; any other
 * layer searches on the message plus the step's hints (`on: "message"`). Measured on S3 after its ingest
 * (inputs/demo-design/evidence/session-90-s3-layers/): topics alone put the intended rules in all four layers, and
 * adding the message's words made every layer worse.
 */
function layerSearch({ message, hints, layerTopics } = {}) {
  const shared = retrievalQuery({ message, hints });
  const byLayer = layerTopics && typeof layerTopics === "object" ? layerTopics : {};
  return Object.fromEntries(
    PILLAR_ORDER.map((id) => {
      const topics = uniqueStrings(byLayer[id]);
      return [id, topics.length ? { on: "topics", text: topics.join("; ").slice(0, QUERY_MAX_CHARS) } : { on: "message", text: shared }];
    })
  );
}

/** The retrieve route's `documentFilter` for one layer, or null when the store holds none of its documents. */
function pillarFilter(pillar) {
  if (!pillar || !Array.isArray(pillar.present) || pillar.present.length === 0) return null;
  return { sources: pillar.present.map((d) => d.source), sourceIds: pillar.present.flatMap((d) => d.sourceIds) };
}

function metaOf(row) {
  try {
    const m = JSON.parse(row && row.metadata ? row.metadata : "{}");
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}
function pageOf(row) {
  const p = Number(row && row.page);
  return Number.isInteger(p) && p > 0 ? p : null;
}
function sectionOf(row, meta) {
  const number = asString(row && row.sectionNumber).trim();
  const title = asString(row && row.sectionTitle).trim();
  if (number && title && title !== number) return `${number} ${title}`;
  return number || title || asString(meta.section_title).trim() || asString(meta.section).trim() || null;
}

/**
 * Number the passages, layer by layer in authority order: `{ marker, pillar, source, page, sectionPath, locationKind,
 * imagePath, title, text, cut, score }`. `rowsByPillar` maps a layer id to the retrieve route's result rows.
 */
function numberPassages(pillars, rowsByPillar) {
  const passages = [];
  for (const id of PILLAR_ORDER) {
    const pillar = (Array.isArray(pillars) ? pillars : []).find((p) => p.id === id);
    if (!pillar) continue;
    const rows = rowsByPillar && Array.isArray(rowsByPillar[id]) ? rowsByPillar[id] : [];
    rows.forEach((row, i) => {
      const meta = metaOf(row);
      const page = pageOf(row);
      const sectionPath = sectionOf(row, meta);
      const text = asString(row && row.text).trim();
      const score = typeof row?.rerankScore === "number" ? row.rerankScore : typeof row?.score === "number" ? row.score : null;
      passages.push({
        marker: `${pillar.marker}-${i + 1}`,
        pillar: id,
        source: asString(row && row.source) || null,
        page,
        sectionPath,
        locationKind: locationKindFor(page, sectionPath, row || {}),
        imagePath: (row && row.imagePath) || meta.imagePath || null,
        title: asString(meta.humanTitle).trim() || null,
        text: text.length > PASSAGE_MAX_CHARS ? `${text.slice(0, PASSAGE_MAX_CHARS)} […]` : text,
        cut: text.length > PASSAGE_MAX_CHARS,
        score,
      });
    });
  }
  return passages;
}

/**
 * The EVIDENCE block the model reads before the request, in authority order. `outcomes` maps a layer id to its
 * search outcome (`{ state, code, message }` from classifyRetrievalOutcome, or `{ state: "absent" }`).
 */
function evidenceBlock(pillars, passages, outcomes = {}) {
  const out = [
    "EVIDENCE — passages retrieved for this request from the four layers of rules, highest authority first.",
    "Cite a passage by its marker in square brackets, e.g. [REG-1]. Cite only these markers.",
  ];
  const traced = (Array.isArray(passages) ? passages : []).filter((p) => Array.isArray(p.tracedFrom) && p.tracedFrom.length);
  if (traced.some((p) => p.pillar !== "regulator")) {
    out.push(
      'A passage marked "traced from T1" was looked up, not searched: the rule that tool finding names, the policy clause its "Traces to:" line names, or a team note whose "Traces to:" line names the rule. Use these chains when you explain each finding.'
    );
  }
  // S4-D5 (a) of 2026-10-12: a regulation passage looked up through a policy clause's or a standard's own trace line.
  if (traced.some((p) => p.pillar === "regulator")) {
    out.push(
      'A regulation passage marked "traced from" a rule (for example "traced from FIN-POL-003 clause 4.3") was looked up, not searched: the provision that rule\'s "Traces to:" line names, found in the regulation\'s own text. Use it for that link of the chain.'
    );
  }
  for (const id of PILLAR_ORDER) {
    const pillar = (Array.isArray(pillars) ? pillars : []).find((p) => p.id === id);
    if (!pillar) continue;
    const ps = (Array.isArray(passages) ? passages : []).filter((p) => p.pillar === id);
    const o = outcomes[id] || {};
    out.push("", `## ${pillar.label} (${pillar.marker}-n)${pillar.description ? ` — ${pillar.description}` : ""}`);
    if (!pillar.present || pillar.present.length === 0) {
      out.push("(No documents from this layer are in the store yet. If this layer matters to the answer, say that it could not be checked.)");
      continue;
    }
    if (o.state === "failed") {
      out.push(`(The search of this layer failed: ${o.code || "UNKNOWN"}. Nothing from it was checked; say so if it matters.)`);
      continue;
    }
    if (ps.length === 0) {
      out.push("(The search found no passage of this layer above the relevance threshold for this request.)");
      continue;
    }
    for (const p of ps) {
      const where = [p.page !== null ? `page ${p.page}` : null, p.sectionPath ? `section ${p.sectionPath}` : null].filter(Boolean).join(", ");
      const traced = Array.isArray(p.tracedFrom) && p.tracedFrom.length ? ` (traced from ${p.tracedFrom.join(", ")})` : "";
      out.push(`[${p.marker}] ${p.source || "unknown document"}${where ? `, ${where}` : ""}${traced}`, p.text, "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The layer markers an answer uses: `cited` (match a passage) and `unknown` (match none — unverified). */
function markerCheck(answer, passages) {
  const known = new Set((Array.isArray(passages) ? passages : []).map((p) => p.marker));
  const cited = [];
  const unknown = [];
  const seen = new Set();
  const re = /\[([^[\]\n]{1,200})\]/g;
  let m;
  const text = asString(answer);
  while ((m = re.exec(text)) !== null) {
    for (const part of m[1].split(/[,;]/)) {
      const tok = part.trim();
      if (!MARKER_RE.test(tok) || seen.has(tok)) continue;
      seen.add(tok);
      (known.has(tok) ? cited : unknown).push(tok);
    }
  }
  return { cited, unknown };
}

/** The cited passages as citation chips (the RAG path's shape, plus the layer), in the order first cited. */
function citationsFor(cited, passages) {
  const byMarker = new Map((Array.isArray(passages) ? passages : []).map((p) => [p.marker, p]));
  return (Array.isArray(cited) ? cited : [])
    .map((mk) => byMarker.get(mk))
    .filter(Boolean)
    .map((p) => ({ marker: p.marker, source: p.source, page: p.page, sectionPath: p.sectionPath, imagePath: p.imagePath, title: p.title, locationKind: p.locationKind, pillar: p.pillar, ...(p.via ? { via: p.via } : {}), ...(p.tracedFrom ? { tracedFrom: p.tracedFrom } : {}) }));
}

/** Layer markers removed from a replayed earlier answer (the model must cite this turn's evidence, not old markers). */
function stripLayerMarkers(text) {
  return asString(text).replace(/\s?\[(?:(?:REG|CORP|SDLC|TEAM)-\d{1,3}(?:\s*[,;]\s*)?)+\]/g, "");
}

/**
 * The turn's retrieval outcome over the layers it searched: failed only when every search failed; degraded when one
 * failed or degraded; empty when nothing was found or nothing could be searched; ok otherwise.
 */
function aggregateRetrieval(outcomes) {
  const searched = (Array.isArray(outcomes) ? outcomes : []).filter((o) => o && o.state && o.state !== "absent");
  if (searched.length === 0) {
    return { state: "empty", code: null, message: "no documents from any layer are in the store, so nothing was searched", chunkCount: 0 };
  }
  const chunkCount = searched.reduce((n, o) => n + (Number.isFinite(o.chunkCount) ? o.chunkCount : 0), 0);
  const failed = searched.filter((o) => o.state === "failed");
  const degraded = searched.filter((o) => o.state === "degraded");
  if (failed.length === searched.length) {
    return { state: "failed", code: failed[0].code || null, message: `every layer's search failed (${failed[0].message || failed[0].code || "unknown error"})`, chunkCount: 0 };
  }
  if (failed.length > 0 || degraded.length > 0) {
    const first = failed[0] || degraded[0];
    return {
      state: "degraded",
      code: first.code || null,
      message: `${failed.length} layer search(es) failed and ${degraded.length} degraded; the first: ${first.message || first.code || "unknown"}`,
      chunkCount,
    };
  }
  if (chunkCount === 0) {
    return { state: "empty", code: null, message: "the searches ran and found no passage above the relevance threshold", chunkCount: 0 };
  }
  return { state: "ok", code: null, message: null, chunkCount };
}

module.exports = {
  PILLAR_ORDER,
  PILLAR_MARKERS,
  MARKER_RE,
  PASSAGE_MAX_CHARS,
  QUERY_MAX_CHARS,
  validateManifest,
  resolvePillars,
  scopePillars,
  retrievalQuery,
  layerSearch,
  pillarFilter,
  numberPassages,
  evidenceBlock,
  markerCheck,
  citationsFor,
  stripLayerMarkers,
  aggregateRetrieval,
};
