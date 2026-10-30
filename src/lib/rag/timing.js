/**
 * T43 (t43-design.md §2, D1–D6; F-179, F-180) — time and tokens on every turn,
 * as a pure module (no I/O, no app state — transportable, memory
 * `rag-modularity-is-the-goal`).
 *
 * Why it exists. Every span the orchestrator pushes carries `timestamp` (its
 * RECORD time — the END of its work) and `durationMs`; the generation carries
 * its usage; the telemetry carries the latency. Nothing put them on screen as
 * one turn's story, and two of the spans — T13's engine-inspection spans —
 * carry durations measured AT INGEST (67,272 ms on a 55-second turn, design
 * §0b fact 2), so any consumer that derived a start as `timestamp − durationMs`
 * or summed the durations was wrong twice (−67 s; 147 s on a 55 s turn).
 *
 * Six things, each pure:
 *   turnClock              — the turn's clock: `startMs` and `startedAt`, the
 *                            two values the orchestrator already keeps, named.
 *   spanTiming             — ONE clock read per push site: `durationMs`,
 *                            `offsetMs` (the span's own START measured from the
 *                            turn's start — never derived from its record time)
 *                            and `endOffsetMs`, consistent by construction
 *                            (`end − offset === duration`); `durationScope:
 *                            "turn"`. `ingestSpanTiming` marks the two
 *                            engine-inspection spans `"ingest"`: their record
 *                            offset, their T13 duration untouched, never on
 *                            the timeline. `spanOffsets` is the arithmetic.
 *   summariseTiming        — the `timing` object of the response (design §2.2),
 *                            read from the stamped spans by category / title
 *                            and from the retrieval report's rerank transport;
 *                            a stage that did not run is null — "did not run"
 *                            is not "0 ms" (T28's rule).
 *   checkSpanClock         — acceptance 2 as a rule: every turn span on the
 *                            turn's clock, the ingest spans off it, the last
 *                            end at the wall, the record times monotone.
 *   formatTurnTiming       — the footer line and its tooltip (D2 a, D4 a): the
 *                            ONE formatter the page and the harness's renderer
 *                            share, so the footer and the record print the
 *                            same string from the same numbers (acceptance 3);
 *                            since T49 (t49-design.md §12b, D11 / D12) also
 *                            the line's values as labelled `pills` for the
 *                            page's footer — every value a substring of the
 *                            line, the line itself unchanged;
 *                            formatOffset / formatClock / formatSeconds /
 *                            formatTokens for the drawer's rows.
 *   aggregateSessionTiming — the stats drawer's real aggregates (D5 a): summed
 *                            from each turn's `timing`, never estimated; a turn
 *                            without a `timing` is counted, never filled.
 */

const TIMING_STAGES = Object.freeze(["store", "retrieval", "scope", "assembly", "generation", "audit"]);
const DURATION_SCOPES = Object.freeze({ TURN: "turn", INGEST: "ingest" });
// Where each named stage is read from (the spans' own categories and titles;
// the retrieval span is the `rag_pipeline` span that carries the route's
// `report` — the dry-run runner's rule since T13). The audit is the Citation
// Audit span by its title too (T53): the Disclosure Check row shares its
// category, and a turn whose audit threw must not read the check as its audit.
const STAGE_SOURCES = Object.freeze({
  store: { category: "document_summary" },
  retrieval: { category: "rag_pipeline", detailsKey: "report" },
  scope: { title: "Turn Scope" },
  assembly: { title: "Page Context Assembly" },
  generation: { category: "llm_inference" },
  audit: { category: "citation_audit", title: "Citation Audit" },
});

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The turn's clock, from the entry time the orchestrator already reads. */
function turnClock(now = Date.now()) {
  const startMs = finite(now) ?? Date.now();
  return { startMs, startedAt: new Date(startMs).toISOString() };
}

/**
 * A start and an end as offsets from the clock's start. Pure arithmetic; a
 * missing clock or start gives nulls (never 0 — "not stamped" is not "at 0").
 */
function spanOffsets(clock, startMs, endMs) {
  const base = clock ? finite(clock.startMs) : null;
  const start = finite(startMs);
  if (base === null || start === null) return { offsetMs: null, endOffsetMs: null };
  const end = finite(endMs) ?? start;
  return { offsetMs: start - base, endOffsetMs: end - base };
}

/**
 * The fields a turn-time push site spreads: `durationMs`, `offsetMs`,
 * `endOffsetMs`, `durationScope: "turn"`. One clock read (`now`, defaulting to
 * Date.now()) when the duration is measured here; a duration the site kept in
 * state (`{ durationMs }`) is taken as given and the end follows from it — so
 * `endOffsetMs − offsetMs === durationMs` holds by construction either way.
 * A site whose start was never set (its block did not run) keeps its duration
 * and stamps null offsets: the drawer prints no `t+` for it.
 */
function spanTiming(clock, startMs, { durationMs, now } = {}) {
  const start = finite(startMs);
  const given = finite(durationMs);
  if (start === null) return { durationMs: given ?? 0, offsetMs: null, endOffsetMs: null, durationScope: DURATION_SCOPES.TURN };
  const end = given !== null ? start + given : finite(now) ?? Date.now();
  const { offsetMs, endOffsetMs } = spanOffsets(clock, start, end);
  return { durationMs: end - start, offsetMs, endOffsetMs, durationScope: DURATION_SCOPES.TURN };
}

/**
 * The fields an ingest-scoped span spreads (T13's two engine-inspection
 * spans): the offset of its RECORD, the same for its end, `durationScope:
 * "ingest"`. Its `durationMs` — what the process observed at ingest, or the
 * ledger's figure, or absent — is not touched here and is never turn time.
 */
function ingestSpanTiming(clock, now) {
  const at = finite(now) ?? Date.now();
  const { offsetMs } = spanOffsets(clock, at, at);
  return { offsetMs, endOffsetMs: offsetMs, durationScope: DURATION_SCOPES.INGEST };
}

function findStageSpans(traces) {
  const list = Array.isArray(traces) ? traces.filter((t) => t && typeof t === "object") : [];
  const pick = (src) =>
    list.find(
      (t) =>
        (src.category === undefined || t.category === src.category) &&
        (src.title === undefined || t.title === src.title) &&
        (src.detailsKey === undefined || (t.details && typeof t.details === "object" && Object.prototype.hasOwnProperty.call(t.details, src.detailsKey)))
    ) || null;
  const out = {};
  for (const name of TIMING_STAGES) out[name] = pick(STAGE_SOURCES[name]);
  return out;
}

const stageOf = (span) => (span ? { offsetMs: finite(span.offsetMs), durationMs: finite(span.durationMs) } : null);

/**
 * The response's `timing` (design §2.2). `wallMs` is the orchestrator's own
 * `latency` — the same clock, so nothing on the wire can disagree with
 * `telemetry.latency`. Tokens: the provider's usage when reported; otherwise
 * the telemetry's estimate, labelled `providerReported: false` (never silent);
 * null when no generation returned. A span stamped before T43 (no offsets, a
 * harness record) reads with `offsetMs: null` — its durations are still read.
 */
function summariseTiming({ clock, wallMs, traces, generation, telemetry, model } = {}) {
  const spans = findStageSpans(traces);
  const startMs = clock ? finite(clock.startMs) : null;
  const wall = finite(wallMs);
  const startedAt = clock && typeof clock.startedAt === "string" ? clock.startedAt : startMs !== null ? new Date(startMs).toISOString() : null;
  const finishedAt = startMs !== null && wall !== null ? new Date(startMs + wall).toISOString() : null;

  const r = spans.retrieval;
  const rd = r && r.details && typeof r.details === "object" ? r.details : null;
  const transport = rd && rd.report && rd.report.rerankTransport && typeof rd.report.rerankTransport === "object" ? rd.report.rerankTransport : null;
  const retrieval = r
    ? {
        ...stageOf(r),
        rerankMs: transport ? finite(transport.elapsedMs) : null,
        rerankDeadline: transport ? transport.stoppedEarly === true : false,
        state: rd && typeof rd.retrievalState === "string" ? rd.retrievalState : null,
        code: rd && typeof rd.retrievalCode === "string" ? rd.retrievalCode : null,
      }
    : null;

  const gen = generation && spans.generation ? stageOf(spans.generation) : null;
  let tokens = null;
  if (generation) {
    const u = generation.usage && typeof generation.usage === "object" ? generation.usage : null;
    tokens =
      u && u.providerReported === true
        ? { prompt: finite(u.promptTokens), completion: finite(u.completionTokens), providerReported: true }
        : { prompt: telemetry ? finite(telemetry.prompt_tokens) : null, completion: telemetry ? finite(telemetry.completion_tokens) : null, providerReported: false };
  }

  return {
    clock: "server",
    startedAt,
    finishedAt,
    wallMs: wall,
    stages: {
      store: stageOf(spans.store),
      retrieval,
      scope: stageOf(spans.scope),
      assembly: stageOf(spans.assembly),
      generation: gen,
      audit: stageOf(spans.audit),
    },
    tokens,
    model: typeof model === "string" && model ? model : null,
  };
}

/**
 * Acceptance 2 as a rule (design §4): every `"turn"` span has
 * `0 ≤ offsetMs ≤ endOffsetMs ≤ wallMs + 1` and `endOffsetMs − offsetMs ===
 * durationMs`; every `"ingest"` span has `offsetMs === endOffsetMs`; a span
 * with no `durationScope` is unstamped (a pre-T43 record); the last span's end
 * is within `toleranceMs` of the wall; the record times are monotone.
 */
function checkSpanClock(traces, wallMs, { toleranceMs = 5 } = {}) {
  const list = Array.isArray(traces) ? traces : [];
  const wall = finite(wallMs);
  const problems = [];
  let turnSpans = 0;
  let ingestSpans = 0;
  let lastEnd = null;
  let lastRecord = null;
  list.forEach((t, i) => {
    const name = `${i}:${t && t.title ? t.title : "?"}`;
    if (!t || typeof t !== "object") { problems.push(`${name} is not a span`); return; }
    const off = finite(t.offsetMs);
    const end = finite(t.endOffsetMs);
    if (t.durationScope === DURATION_SCOPES.TURN) {
      turnSpans++;
      if (off === null || end === null) problems.push(`${name}: turn span without offsets`);
      else {
        if (off < 0) problems.push(`${name}: offsetMs ${off} < 0`);
        if (end < off) problems.push(`${name}: endOffsetMs ${end} < offsetMs ${off}`);
        if (wall !== null && end > wall + 1) problems.push(`${name}: endOffsetMs ${end} > wallMs ${wall} + 1`);
        const d = finite(t.durationMs);
        if (d !== null && end - off !== d) problems.push(`${name}: endOffsetMs − offsetMs = ${end - off} ≠ durationMs ${d}`);
        lastEnd = end;
      }
    } else if (t.durationScope === DURATION_SCOPES.INGEST) {
      ingestSpans++;
      if (off === null || end === null) problems.push(`${name}: ingest span without a record offset`);
      else if (off !== end) problems.push(`${name}: ingest span offsetMs ${off} ≠ endOffsetMs ${end}`);
    } else {
      problems.push(`${name}: no durationScope (unstamped)`);
    }
    const rec = typeof t.timestamp === "string" ? Date.parse(t.timestamp) : NaN;
    if (Number.isNaN(rec)) problems.push(`${name}: no record time`);
    else {
      if (lastRecord !== null && rec < lastRecord) problems.push(`${name}: record time ${t.timestamp} before the previous span's`);
      lastRecord = rec;
    }
  });
  if (wall !== null && lastEnd !== null && Math.abs(wall - lastEnd) > toleranceMs) problems.push(`last end ${lastEnd} is ${wall - lastEnd} ms from the wall ${wall} (tolerance ${toleranceMs})`);
  if (list.length === 0) problems.push("no spans");
  return { ok: problems.length === 0, problems, turnSpans, ingestSpans, lastEndOffsetMs: lastEnd, wallMs: wall };
}

// ── Formatting (the one place the strings are made) ─────────────────────────

const formatInt = (n) => (finite(n) === null ? "—" : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
const formatSeconds = (ms) => (finite(ms) === null ? "—" : `${(ms / 1000).toFixed(1)} s`);

/** `t+114 ms` under a second, `t+14.7 s` under a minute, `t+1:05.2` past it; "" when unstamped. */
function formatOffset(ms) {
  const v = finite(ms);
  if (v === null) return "";
  if (v < 1000) return `t+${Math.round(v)} ms`;
  if (v < 60000) return `t+${(v / 1000).toFixed(1)} s`;
  const m = Math.floor(v / 60000);
  const s = (v - m * 60000) / 1000;
  return `t+${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** `11:48:45.984` — the viewer's local clock, or UTC on `{ utc: true }` (the harness). */
function formatClock(iso, { utc = false } = {}) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p2 = (n) => String(n).padStart(2, "0");
  const p3 = (n) => String(n).padStart(3, "0");
  return utc
    ? `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p3(d.getUTCMilliseconds())}`
    : `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
}

/**
 * `4,968 → 3,087 tokens`, or `≈ 1,200 → 300 tokens (estimated)`; "" for none.
 * Reads `timing.tokens` ({ prompt, completion }) and the generation span's
 * `details.usage` ({ promptTokens, completionTokens }) — the same numbers
 * under T36's two names.
 */
function formatTokens(tokens) {
  if (!tokens || typeof tokens !== "object") return "";
  const prompt = finite(tokens.prompt) ?? finite(tokens.promptTokens);
  const completion = finite(tokens.completion) ?? finite(tokens.completionTokens);
  if (prompt === null && completion === null) return "";
  const body = `${formatInt(prompt)} → ${formatInt(completion)} tokens`;
  return tokens.providerReported === true ? body : `≈ ${body} (estimated)`;
}

/**
 * The footer under an answer (D2 a) and its tooltip (D4 a):
 *   `55.2 s · retrieval 14.6 s · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b`
 * `retrieval 60.0 s (deadline)` on a deadline-stopped rerank stage; `retrieval
 * failed (CODE)` on a failure; `≈ … (estimated)` on an estimated usage; the
 * wall alone when there is no answer. The tooltip carries the stage split,
 * the start / finish clock times and, given `clientMs` (the page's own
 * send → receive wall), the end-to-end time and the difference (the network).
 * Every number comes from `timing`; the caller does no arithmetic.
 *
 * T49 (t49-design.md §12b, D11 / D12 — the owner's ask): `pills` beside the
 * line — the same values, labelled for an audience, in the line's order:
 *   [{ id, label, value, state, text }] with id ∈ wall / retrieval / model /
 *   in / out / llm; label the owner's words ("total response time",
 *   "retrieval", "thinking", "input tokens", "output tokens", "LLM"); value
 *   the figure EXACTLY as the line prints it (every value is a substring of
 *   `line` — U-TIMING pins it: one formatter, no second computation); state
 *   null or "deadline" / "failed" / "estimated" (the page turns the pill
 *   amber); text what the pill shows after its label — the value, or the
 *   value with T43's disclosure beside it (`60.0 s · deadline`,
 *   `failed · CODE`, `≈ 3,947 · estimated`). A turn with no answer gives
 *   the total pill alone (T43's rule). `line`, `title` and `parts` are
 *   byte-identical to T43's: the harness's renderer, the compare and every
 *   record keep reading the line.
 */
function formatTurnTiming(timing, { clientMs, utc = false } = {}) {
  if (!timing || typeof timing !== "object" || finite(timing.wallMs) === null) return null;
  const s = timing.stages && typeof timing.stages === "object" ? timing.stages : {};
  const retrievalFailed = s.retrieval && s.retrieval.state === "failed";
  const retrievalCode = s.retrieval && s.retrieval.code ? s.retrieval.code : null;
  const parts = [formatSeconds(timing.wallMs)];
  const noAnswer = !s.generation;
  if (!noAnswer) {
    if (s.retrieval) parts.push(retrievalFailed ? `retrieval failed (${retrievalCode || "UNKNOWN"})` : `retrieval ${formatSeconds(s.retrieval.durationMs)}${s.retrieval.rerankDeadline ? " (deadline)" : ""}`);
    parts.push(`model ${formatSeconds(s.generation.durationMs)}`);
    if (timing.tokens) parts.push(formatTokens(timing.tokens));
    if (timing.model) parts.push(timing.model);
  }
  const line = parts.join(" · ");

  // T49 (§12b D12): the pills — built from the same reads as the line, never from the line.
  const pill = (id, label, value, state = null, text = value) => ({ id, label, value, state, text });
  const pills = [pill("wall", "total response time", formatSeconds(timing.wallMs))];
  if (!noAnswer) {
    if (s.retrieval) {
      const rs = formatSeconds(s.retrieval.durationMs);
      if (retrievalFailed) pills.push(pill("retrieval", "retrieval", `failed (${retrievalCode || "UNKNOWN"})`, "failed", `failed · ${retrievalCode || "UNKNOWN"}`));
      else pills.push(pill("retrieval", "retrieval", rs, s.retrieval.rerankDeadline ? "deadline" : null, s.retrieval.rerankDeadline ? `${rs} · deadline` : rs));
    }
    pills.push(pill("model", "thinking", formatSeconds(s.generation.durationMs)));
    if (timing.tokens && formatTokens(timing.tokens)) {
      const estimated = timing.tokens.providerReported !== true;
      const prompt = formatInt(finite(timing.tokens.prompt) ?? finite(timing.tokens.promptTokens));
      const completion = formatInt(finite(timing.tokens.completion) ?? finite(timing.tokens.completionTokens));
      pills.push(pill("in", "input tokens", prompt, estimated ? "estimated" : null, estimated ? `≈ ${prompt} · estimated` : prompt));
      pills.push(pill("out", "output tokens", completion, estimated ? "estimated" : null, estimated ? `≈ ${completion} · estimated` : completion));
    }
    if (timing.model) pills.push(pill("llm", "LLM", timing.model));
  }

  const split = [];
  if (s.store) split.push(`store ${formatSeconds(s.store.durationMs)}`);
  if (s.retrieval) {
    if (retrievalFailed) split.push(`retrieval failed (${retrievalCode || "UNKNOWN"}) after ${formatSeconds(s.retrieval.durationMs)}`);
    else {
      const rerank = s.retrieval.rerankMs !== null && s.retrieval.rerankMs !== undefined ? `rerank ${formatSeconds(s.retrieval.rerankMs)}${s.retrieval.rerankDeadline ? `, deadline${retrievalCode ? ` ${retrievalCode}` : ""}` : ""}` : null;
      const degraded = s.retrieval.state === "degraded" && !s.retrieval.rerankDeadline ? `degraded${retrievalCode ? ` ${retrievalCode}` : ""}` : null;
      const notes = [rerank, degraded].filter(Boolean);
      split.push(`retrieval ${formatSeconds(s.retrieval.durationMs)}${notes.length ? ` (${notes.join("; ")})` : ""}`);
    }
  }
  if (s.scope) split.push(`scope ${formatSeconds(s.scope.durationMs)}`);
  if (s.assembly) split.push(`assembly ${formatSeconds(s.assembly.durationMs)}`);
  if (s.generation) split.push(`model ${formatSeconds(s.generation.durationMs)}`);
  if (s.audit) split.push(`audit ${formatSeconds(s.audit.durationMs)}`);
  const lines = [];
  if (split.length) lines.push(split.join(" · "));
  if (timing.startedAt && timing.finishedAt) lines.push(`started ${formatClock(timing.startedAt, { utc })} · finished ${formatClock(timing.finishedAt, { utc })}${utc ? " (UTC)" : ""}`);
  const c = finite(clientMs);
  if (c !== null) lines.push(`${formatSeconds(c)} end to end (network ${formatSeconds(Math.max(0, c - timing.wallMs))})`);
  if (noAnswer) lines.push("no answer from the model — the wall alone is shown");
  return { line, title: lines.join("\n"), parts, pills };
}

/**
 * The stats drawer's aggregates (D5 a) over the session's turns — an array of
 * `timing` objects, null for a turn that returned none. Sums and means over the
 * turns that carry the figure; nothing is estimated to fill a gap.
 */
function aggregateSessionTiming(timings) {
  const list = Array.isArray(timings) ? timings : [];
  const timed = list.filter((t) => t && typeof t === "object" && finite(t.wallMs) !== null);
  const withTokens = timed.filter((t) => t.tokens && typeof t.tokens === "object");
  const withModel = timed.filter((t) => t.stages && t.stages.generation && finite(t.stages.generation.durationMs) !== null);
  const sum = (xs, f) => xs.reduce((a, x) => a + (finite(f(x)) ?? 0), 0);
  const last = timed.length ? timed[timed.length - 1] : null;
  const promptTokens = sum(withTokens, (t) => t.tokens.prompt);
  const completionTokens = sum(withTokens, (t) => t.tokens.completion);
  const totalTokens = promptTokens + completionTokens;
  // The bar's split, as the provider reported it (never 75 / 25 by assumption).
  const promptShare = totalTokens > 0 ? Math.round((promptTokens / totalTokens) * 100) : 0;
  return {
    turns: list.length,
    timed: timed.length,
    tokenTurns: withTokens.length,
    promptTokens,
    completionTokens,
    totalTokens,
    promptShare,
    completionShare: totalTokens > 0 ? 100 - promptShare : 0,
    estimatedTurns: withTokens.filter((t) => t.tokens.providerReported !== true).length,
    allProviderReported: withTokens.length > 0 && withTokens.every((t) => t.tokens.providerReported === true),
    totalWallMs: sum(timed, (t) => t.wallMs),
    lastWallMs: last ? finite(last.wallMs) : null,
    lastModelMs: last && last.stages && last.stages.generation ? finite(last.stages.generation.durationMs) : null,
    modelTurns: withModel.length,
    meanModelMs: withModel.length ? Math.round(sum(withModel, (t) => t.stages.generation.durationMs) / withModel.length) : null,
    model: last && typeof last.model === "string" ? last.model : null,
  };
}

module.exports = {
  TIMING_STAGES,
  DURATION_SCOPES,
  STAGE_SOURCES,
  turnClock,
  spanOffsets,
  spanTiming,
  ingestSpanTiming,
  findStageSpans,
  summariseTiming,
  checkSpanClock,
  formatInt,
  formatSeconds,
  formatOffset,
  formatClock,
  formatTokens,
  formatTurnTiming,
  aggregateSessionTiming,
};
