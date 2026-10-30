/**
 * src/lib/coding/turn_client.js — the page's reader of a streamed coding turn (Machinery PR 1, design §4; D6).
 *
 * readCodingTurn(response, { onEvent }) reads POST /api/ide-bridge/turn's newline-delimited JSON events, hands each to
 * `onEvent`, and resolves with the `final` event's data — the same object the page used to get from
 * `response.json()` on POST /api/ide-bridge — so every field the page copies onto the message and the trace turn is
 * read exactly as before. liveTurnReducer folds the events into the small state the live bubble shows (the layers'
 * search results, the reasoning count, the answer so far). Pure apart from reading the response body.
 */

/** Read the stream; resolve with the final data, or reject with the stream's error. */
async function readCodingTurn(response, { onEvent = null } = {}) {
  if (!response || !response.body) throw new Error("the coding turn returned no stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final = null;
  let failure = null;
  const handle = (line) => {
    const text = line.trim();
    if (!text) return;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }
    if (event && event.type === "final") final = event.data;
    else if (event && event.type === "error") failure = event.message || "the coding turn failed";
    if (typeof onEvent === "function") {
      try {
        onEvent(event);
      } catch {
        // a display error never costs the turn
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);
  if (final) return final;
  throw new Error(failure || "the coding turn ended without a result");
}

/** The live bubble's state: `{ phase, layers: { id: { label, marker, documents, state, passages } }, reasoningChars, text, model, thinking }`. */
function liveTurnReducer(state, event) {
  const s = state || { phase: "starting", layers: {}, order: [], reasoningChars: 0, text: "", model: null, thinking: null };
  if (!event || typeof event !== "object") return s;
  switch (event.type) {
    case "start":
      return { ...s, phase: "starting", thinking: event.thinking || null, mode: typeof event.mode === "string" ? event.mode : null };
    case "pillars": {
      const layers = {};
      const order = [];
      for (const p of Array.isArray(event.pillars) ? event.pillars : []) {
        layers[p.id] = { label: p.label, marker: p.marker, documents: p.documents, expected: p.expected, state: p.documents > 0 ? "searching" : "absent", passages: 0 };
        order.push(p.id);
      }
      return { ...s, phase: "searching", layers, order };
    }
    case "pillar": {
      const prev = s.layers[event.id] || {};
      return { ...s, layers: { ...s.layers, [event.id]: { ...prev, state: event.state, passages: event.passages, ms: event.ms } } };
    }
    case "scan": {
      // S2: the pre-merge checks ran before the model (REV-002): their count and Critical findings, for the live bubble.
      const findings = Array.isArray(event.findings) ? event.findings : [];
      return { ...s, scan: { findings: findings.length, critical: findings.filter((f) => f && f.severity === "Critical").length } };
    }
    case "layouts": {
      // S3: the program's record and report layouts, computed by a tool before the model writes the port.
      const n = (x) => (Number.isFinite(x) ? x : 0);
      return { ...s, layouts: { records: n(event.records), fields: n(event.fields), error: event.error || null } };
    }
    case "chain": {
      // S2 (D11 (a)): the tool findings' rules followed through the documents' "Traces to:" lines, for the live bubble.
      const n = (x) => (Number.isFinite(x) ? x : 0);
      return { ...s, chain: { traced: n(event.added) + n(event.alreadySearched), rules: n(event.rules), missing: Array.isArray(event.missing) ? event.missing.length : 0 } };
    }
    case "regtrace": {
      // S4-D5 (a): the regulator provisions the policy clauses' trace lines name, looked up in their own documents.
      const n = (x) => (Number.isFinite(x) ? x : 0);
      return { ...s, regtrace: { looked: n(event.looked), found: n(event.found), missing: Array.isArray(event.missing) ? event.missing.length : 0 } };
    }
    case "generation":
      return { ...s, phase: "thinking", model: event.model || null, thinking: event.thinking || s.thinking };
    case "reasoning":
      return { ...s, reasoningChars: typeof event.chars === "number" ? event.chars : s.reasoningChars };
    case "delta":
      return { ...s, phase: "answering", text: s.text + (typeof event.text === "string" ? event.text : "") };
    case "final":
      return { ...s, phase: "done" };
    case "error":
      return { ...s, phase: "failed" };
    default:
      return s;
  }
}

module.exports = { readCodingTurn, liveTurnReducer };
