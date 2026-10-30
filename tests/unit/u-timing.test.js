/**
 * U-TIMING — time and tokens on every turn, the pure module (ticket T43,
 * t43-design.md §2.1, §4; F-179, F-180).
 *
 * The fixture is the design probe's FS-1 corpus turn (session 49, stamp
 * 1790250510; `tests/fixtures/t43/fs1-corpus-turn.json`, cut by
 * `t43-artifacts/cut_fixture.js`): nine spans with record times and durations
 * and NO offsets (the record predates T43). §0a's table for that turn: wall
 * 55,167 ms; store 114; retrieval 14,578 with the rerank stage 11,050; scope
 * 1; assembly 8; model 40,465; audit 0; tokens 4,968 → 3,087 (provider);
 * the two engine-inspection spans carry 67,272 and 24,699 ms measured AT
 * INGEST — a sum of the durations reads 147 s on a 55 s turn (§0b fact 2).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const T = require("../../src/lib/rag/timing");

const FIXTURE = path.resolve(__dirname, "..", "fixtures", "t43", "fs1-corpus-turn.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
// The turn's entry time: the router span records at +0 ms of its 0 ms of work
// (11:48:31.295Z) and the last span (Citation Audit) records at 11:49:26.462Z
// = the start + telemetry.latency (55,167 ms) to the millisecond (§0b fact 1).
const START_ISO = "2026-09-24T11:48:31.295Z";
const clock = T.turnClock(Date.parse(START_ISO));
const summarise = (over = {}) =>
  T.summariseTiming({ clock, wallMs: fx.telemetry.latency, traces: fx.traces, generation: fx.generation, telemetry: fx.telemetry, model: fx.router.model.model, ...over });

describe("U-TIMING: the clock and the per-span stamps (D1 a)", () => {
  test("turnClock names the two values the orchestrator keeps", () => {
    const c = T.turnClock(1_000);
    assert.deepStrictEqual(c, { startMs: 1000, startedAt: "1970-01-01T00:00:01.000Z" });
    assert.ok(Number.isFinite(T.turnClock().startMs), "defaults to now");
  });

  test("spanOffsets from a fixed clock: start 1,000, span 1,115 → 15,693 gives offsetMs 115, endOffsetMs 14,693 (design §4)", () => {
    assert.deepStrictEqual(T.spanOffsets({ startMs: 1000 }, 1115, 15693), { offsetMs: 115, endOffsetMs: 14693 });
    assert.deepStrictEqual(T.spanOffsets({ startMs: 1000 }, 1115), { offsetMs: 115, endOffsetMs: 115 }, "no end: a point");
    assert.deepStrictEqual(T.spanOffsets(null, 1115, 15693), { offsetMs: null, endOffsetMs: null }, "no clock: not stamped, never 0");
    assert.deepStrictEqual(T.spanOffsets({ startMs: 1000 }, null, 15693), { offsetMs: null, endOffsetMs: null }, "no start: not stamped");
  });

  test("spanTiming reads the clock ONCE: durationMs, offsetMs and endOffsetMs agree by construction (acceptance 2)", () => {
    const c = T.turnClock(1000);
    const s = T.spanTiming(c, 1115, { now: 15693 });
    assert.deepStrictEqual(s, { durationMs: 14578, offsetMs: 115, endOffsetMs: 14693, durationScope: "turn" });
    assert.strictEqual(s.endOffsetMs - s.offsetMs, s.durationMs);
    const kept = T.spanTiming(c, 15694, { durationMs: 1 });
    assert.deepStrictEqual(kept, { durationMs: 1, offsetMs: 14694, endOffsetMs: 14695, durationScope: "turn" }, "a duration the site kept in state: the end follows from it");
    const zero = T.spanTiming(c, 15702, { durationMs: 0 });
    assert.deepStrictEqual(zero, { durationMs: 0, offsetMs: 14702, endOffsetMs: 14702, durationScope: "turn" }, "0 ms is a measurement, not 'did not run'");
    const unset = T.spanTiming(c, null, { durationMs: 0 });
    assert.deepStrictEqual(unset, { durationMs: 0, offsetMs: null, endOffsetMs: null, durationScope: "turn" }, "a start never set: the duration kept, no offsets (the drawer prints no t+)");
    const live = T.spanTiming(c, Date.now() - 5);
    assert.ok(live.durationMs >= 5 && live.endOffsetMs - live.offsetMs === live.durationMs, "the default `now` is Date.now()");
  });

  test("ingestSpanTiming: the record's offset, the same end, scope 'ingest', and it never touches durationMs", () => {
    const c = T.turnClock(1000);
    const s = T.ingestSpanTiming(c, 1114);
    assert.deepStrictEqual(s, { offsetMs: 114, endOffsetMs: 114, durationScope: "ingest" });
    assert.ok(!("durationMs" in s), "T13's duration (measured at ingest / ledger / absent) is the span model's, not this stamp's");
    assert.strictEqual(T.DURATION_SCOPES.INGEST, "ingest");
    assert.strictEqual(T.DURATION_SCOPES.TURN, "turn");
  });
});

describe("U-TIMING: summariseTiming over the FS-1 corpus fixture reproduces §0a's table", () => {
  test("the fixture is the probe's turn: nine spans, two of them ingest-scoped by category, record times monotone, the last at start + latency", () => {
    assert.strictEqual(fx.traces.length, 9);
    assert.strictEqual(fx.traces.filter((t) => t.category === "docling_ingestion").length, 2);
    const times = fx.traces.map((t) => Date.parse(t.timestamp));
    assert.ok(times.every((v, i) => i === 0 || v >= times[i - 1]), "record times monotone");
    assert.strictEqual(new Date(Date.parse(START_ISO) + fx.telemetry.latency).toISOString(), fx.traces[fx.traces.length - 1].timestamp, "the last record time = start + telemetry.latency");
    assert.strictEqual(fx.traces.reduce((a, t) => a + (t.durationMs || 0), 0) > 140000, true, "a sum of the durations reads > 140 s on a 55 s turn — the trap §0b fact 2 names");
  });

  test("wall 55,167; retrieval 14,578 with rerank 11,050 and no deadline; model 40,465; tokens 4,968 → 3,087 (provider); the model named", () => {
    const t = summarise();
    assert.strictEqual(t.clock, "server");
    assert.strictEqual(t.wallMs, 55167);
    assert.strictEqual(t.startedAt, START_ISO);
    assert.strictEqual(t.finishedAt, "2026-09-24T11:49:26.462Z");
    assert.deepStrictEqual(t.stages.store, { offsetMs: null, durationMs: 114 });
    assert.deepStrictEqual(t.stages.retrieval, { offsetMs: null, durationMs: 14578, rerankMs: 11050, rerankDeadline: false, state: "ok", code: null });
    assert.deepStrictEqual(t.stages.scope, { offsetMs: null, durationMs: 1 });
    assert.deepStrictEqual(t.stages.assembly, { offsetMs: null, durationMs: 8 });
    assert.deepStrictEqual(t.stages.generation, { offsetMs: null, durationMs: 40465 });
    assert.deepStrictEqual(t.stages.audit, { offsetMs: null, durationMs: 0 });
    assert.deepStrictEqual(t.tokens, { prompt: 4968, completion: 3087, providerReported: true });
    assert.strictEqual(t.model, "qwen3.8:27b");
    assert.deepStrictEqual(Object.keys(t.stages), [...T.TIMING_STAGES]);
    assert.strictEqual(t.tokens.prompt, fx.telemetry.prompt_tokens, "the same number the telemetry carries");
    assert.strictEqual(t.stages.generation.durationMs, fx.traces.find((s) => s.category === "llm_inference").durationMs, "the LLM span's duration");
    assert.strictEqual(t.stages.retrieval.rerankMs, fx.traces.find((s) => s.details && s.details.report).details.report.rerankTransport.elapsedMs, "the report's rerank stage");
    assert.strictEqual(114 + 14578 + 1 + 8 + 40465 + 0, 55166, "the five turn-time spans account for the wall to 1 ms (§0b fact 3)");
  });

  test("the two ingest spans contribute nothing to any stage: removing them changes no number", () => {
    const withoutIngest = fx.traces.filter((t) => t.category !== "docling_ingestion");
    assert.deepStrictEqual(summarise({ traces: withoutIngest }), summarise());
    const t = summarise();
    const total = Object.values(t.stages).reduce((a, s) => a + (s ? s.durationMs : 0), 0);
    assert.ok(total <= t.wallMs, `no stage carries an ingest duration (${total} ≤ ${t.wallMs})`);
  });

  test("a stage that did not run is null — never 0 (T28's rule)", () => {
    const chatTurn = summarise({ traces: fx.traces.filter((t) => t.category === "task_classification" || t.category === "llm_inference" || t.category === "citation_audit") });
    assert.strictEqual(chatTurn.stages.store, null);
    assert.strictEqual(chatTurn.stages.retrieval, null);
    assert.strictEqual(chatTurn.stages.scope, null);
    assert.strictEqual(chatTurn.stages.assembly, null);
    assert.deepStrictEqual(chatTurn.stages.generation, { offsetMs: null, durationMs: 40465 });
    assert.deepStrictEqual(summarise({ traces: [] }).stages, { store: null, retrieval: null, scope: null, assembly: null, generation: null, audit: null });
  });

  test("no generation (an outage): generation and tokens are null even though an llm_inference span was pushed for the failed call", () => {
    const failed = fx.traces.map((t) => (t.category === "llm_inference" ? { ...t, title: "LLM Call Failed", details: { error: "fetch failed" } } : t));
    const t = summarise({ traces: failed, generation: null });
    assert.strictEqual(t.stages.generation, null);
    assert.strictEqual(t.tokens, null);
    assert.strictEqual(t.wallMs, 55167, "the wall is still measured");
    assert.deepStrictEqual(t.stages.retrieval, { offsetMs: null, durationMs: 14578, rerankMs: 11050, rerankDeadline: false, state: "ok", code: null });
  });

  test("an estimated usage: providerReported false and the numbers are the telemetry's estimate — labelled, never silent", () => {
    const gen = { ...fx.generation, usage: { promptTokens: null, completionTokens: null, providerReported: false } };
    const t = summarise({ generation: gen, telemetry: { ...fx.telemetry, prompt_tokens: 1200, completion_tokens: 300, estimated: true } });
    assert.deepStrictEqual(t.tokens, { prompt: 1200, completion: 300, providerReported: false });
  });

  test("a deadline-stopped rerank stage and a failed retrieval are read from the span, not re-derived", () => {
    const stopped = fx.traces.map((t) => (t.details && t.details.report ? { ...t, details: { ...t.details, retrievalState: "degraded", retrievalCode: "RERANK_PARTIAL", report: { ...t.details.report, rerankTransport: { ...t.details.report.rerankTransport, elapsedMs: 60001, stoppedEarly: true } } } } : t));
    const d = summarise({ traces: stopped }).stages.retrieval;
    assert.deepStrictEqual(d, { offsetMs: null, durationMs: 14578, rerankMs: 60001, rerankDeadline: true, state: "degraded", code: "RERANK_PARTIAL" });
    const failed = fx.traces.map((t) => (t.details && t.details.report ? { ...t, details: { ...t.details, retrievalState: "failed", retrievalCode: "WEAVIATE_DOWN", report: null } } : t));
    const f = summarise({ traces: failed }).stages.retrieval;
    assert.deepStrictEqual(f, { offsetMs: null, durationMs: 14578, rerankMs: null, rerankDeadline: false, state: "failed", code: "WEAVIATE_DOWN" });
  });

  test("a missing clock or wall reads as nulls, never NaN", () => {
    const t = T.summariseTiming({ traces: fx.traces, generation: fx.generation, telemetry: fx.telemetry, model: "" });
    assert.strictEqual(t.wallMs, null);
    assert.strictEqual(t.startedAt, null);
    assert.strictEqual(t.finishedAt, null);
    assert.strictEqual(t.model, null);
  });
});

describe("U-TIMING: the stamped path — spans built through spanTiming carry their offsets into the stages, and checkSpanClock is acceptance 2", () => {
  // The FS-1 turn re-stamped on a fixed clock from the durations §0a measured
  // (the engine spans at their record offset): what the orchestrator writes.
  const c = T.turnClock(1000);
  const stamped = [
    { title: "Mode Router", category: "task_classification", timestamp: "2026-09-24T11:48:31.295Z", ...T.spanTiming(c, 1000, { durationMs: 0 }) },
    { title: "Vector Store Inspection", category: "document_summary", timestamp: "2026-09-24T11:48:31.409Z", ...T.spanTiming(c, 1001, { durationMs: 114 }) },
    { title: "Document Parser Engine Inspection", category: "docling_ingestion", timestamp: "2026-09-24T11:48:31.409Z", durationMs: 67272, details: { durationSource: "measured" }, ...T.ingestSpanTiming(c, 1115) },
    { title: "VLM Diagram & Figure Auto-Captioning Inspection", category: "docling_ingestion", timestamp: "2026-09-24T11:48:31.410Z", durationMs: 24699, details: { durationSource: "measured" }, ...T.ingestSpanTiming(c, 1115) },
    { title: "RAG Retrieval & Reranking Pass", category: "rag_pipeline", timestamp: "2026-09-24T11:48:45.988Z", details: { report: { rerankTransport: { elapsedMs: 11050, stoppedEarly: false } }, retrievalState: "ok", retrievalCode: null }, ...T.spanTiming(c, 1115, { durationMs: 14578 }) },
    { title: "Turn Scope", category: "rag_pipeline", timestamp: "2026-09-24T11:48:45.997Z", details: {}, ...T.spanTiming(c, 15701, { durationMs: 1 }) },
    { title: "Page Context Assembly", category: "rag_pipeline", timestamp: "2026-09-24T11:48:45.997Z", details: {}, ...T.spanTiming(c, 15694, { durationMs: 8 }) },
    { title: "LLM Model Inference Dispatch", category: "llm_inference", timestamp: "2026-09-24T11:49:26.462Z", details: { usage: fx.generation.usage }, ...T.spanTiming(c, 15702, { durationMs: 40465 }) },
    { title: "Citation Audit", category: "citation_audit", timestamp: "2026-09-24T11:49:26.462Z", details: {}, ...T.spanTiming(c, 56167, { durationMs: 0 }) },
  ];

  test("the stages carry the measured offsets (design §2.2's object), the ingest spans stay off the stages", () => {
    const t = T.summariseTiming({ clock: c, wallMs: 55167, traces: stamped, generation: fx.generation, telemetry: fx.telemetry, model: "qwen3.8:27b" });
    assert.deepStrictEqual(t.stages, {
      store: { offsetMs: 1, durationMs: 114 },
      retrieval: { offsetMs: 115, durationMs: 14578, rerankMs: 11050, rerankDeadline: false, state: "ok", code: null },
      scope: { offsetMs: 14701, durationMs: 1 },
      assembly: { offsetMs: 14694, durationMs: 8 },
      generation: { offsetMs: 14702, durationMs: 40465 },
      audit: { offsetMs: 55167, durationMs: 0 },
    });
    assert.deepStrictEqual(t.tokens, { prompt: 4968, completion: 3087, providerReported: true });
    assert.strictEqual(t.finishedAt, "1970-01-01T00:00:56.167Z");
  });

  test("checkSpanClock: the stamped turn passes; 7 turn spans, 2 ingest spans, the last end at the wall", () => {
    const v = T.checkSpanClock(stamped, 55167);
    assert.deepStrictEqual(v, { ok: true, problems: [], turnSpans: 7, ingestSpans: 2, lastEndOffsetMs: 55167, wallMs: 55167 });
  });

  test("checkSpanClock names each violation: an unstamped span, a derived start, an ingest span on the timeline, an end past the wall, a record time out of order", () => {
    const unstamped = T.checkSpanClock(fx.traces, fx.telemetry.latency);
    assert.strictEqual(unstamped.ok, false);
    assert.strictEqual(unstamped.problems.filter((p) => /unstamped/.test(p)).length, 9, "the pre-T43 record: every span unstamped");
    const derived = stamped.map((s, i) => (i === 4 ? { ...s, offsetMs: 100, endOffsetMs: 14693 } : s));
    assert.ok(T.checkSpanClock(derived, 55167).problems.some((p) => /≠ durationMs 14578/.test(p)), "end − offset must equal the duration");
    const ingestOnTimeline = stamped.map((s, i) => (i === 2 ? { ...s, endOffsetMs: 67387 } : s));
    assert.ok(T.checkSpanClock(ingestOnTimeline, 55167).problems.some((p) => /ingest span offsetMs 115 ≠ endOffsetMs 67387/.test(p)));
    const pastWall = stamped.map((s, i) => (i === 8 ? { ...s, offsetMs: 55200, endOffsetMs: 55200 } : s));
    assert.ok(T.checkSpanClock(pastWall, 55167).problems.some((p) => /> wallMs 55167 \+ 1/.test(p)));
    const shortWall = T.checkSpanClock(stamped, 55180);
    assert.ok(shortWall.problems.some((p) => /last end 55167 is 13 ms from the wall 55180/.test(p)), "the last end must be within 5 ms of the wall");
    const outOfOrder = stamped.map((s, i) => (i === 8 ? { ...s, timestamp: "2026-09-24T11:48:00.000Z" } : s));
    assert.ok(T.checkSpanClock(outOfOrder, 55167).problems.some((p) => /before the previous span's/.test(p)));
    assert.deepStrictEqual(T.checkSpanClock([], 1).problems, ["no spans"]);
  });
});

describe("U-TIMING: the formatter — the footer, the tooltip and the drawer's strings, byte for byte (D2 a, D4 a)", () => {
  const base = summarise();

  test("the normal line: `55.2 s · retrieval 14.6 s · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b`", () => {
    const f = T.formatTurnTiming(base, { utc: true });
    assert.strictEqual(f.line, "55.2 s · retrieval 14.6 s · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b");
    assert.strictEqual(
      f.title,
      "store 0.1 s · retrieval 14.6 s (rerank 11.1 s) · scope 0.0 s · assembly 0.0 s · model 40.5 s · audit 0.0 s\n" + "started 11:48:31.295 · finished 11:49:26.462 (UTC)"
    );
    assert.deepStrictEqual(f.parts, ["55.2 s", "retrieval 14.6 s", "model 40.5 s", "4,968 → 3,087 tokens", "qwen3.8:27b"]);
  });

  test("the client's clock beside the server's (D4 a): the page's end-to-end wall and the difference — the network — in the tooltip only", () => {
    const f = T.formatTurnTiming(base, { clientMs: 56000, utc: true });
    assert.strictEqual(f.line, "55.2 s · retrieval 14.6 s · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b", "the line is the server's");
    assert.ok(f.title.endsWith("\n56.0 s end to end (network 0.8 s)"), f.title);
    const probe = T.formatTurnTiming(base, { clientMs: fx.clientMs, utc: true });
    assert.ok(probe.title.endsWith("\n55.2 s end to end (network 0.0 s)"), "measured in-pod: 10 ms apart (§0b fact 6)");
    assert.ok(T.formatTurnTiming(base, { clientMs: 55000, utc: true }).title.endsWith("(network 0.0 s)"), "a client clock behind the server's is clamped, never negative");
  });

  test("a degraded turn: `retrieval 60.0 s (deadline)` on the line, the code in the tooltip", () => {
    const t = { ...base, wallMs: 72345, stages: { ...base.stages, retrieval: { offsetMs: 115, durationMs: 60040, rerankMs: 60001, rerankDeadline: true, state: "degraded", code: "RERANK_PARTIAL" } } };
    const f = T.formatTurnTiming(t, { utc: true });
    assert.strictEqual(f.line, "72.3 s · retrieval 60.0 s (deadline) · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b");
    assert.ok(f.title.startsWith("store 0.1 s · retrieval 60.0 s (rerank 60.0 s, deadline RERANK_PARTIAL) · "), f.title);
    const down = { ...base, stages: { ...base.stages, retrieval: { offsetMs: 115, durationMs: 14578, rerankMs: null, rerankDeadline: false, state: "degraded", code: "RERANK_DOWN" } } };
    const g = T.formatTurnTiming(down, { utc: true });
    assert.strictEqual(g.line, "55.2 s · retrieval 14.6 s · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b", "the numbers are measured either way");
    assert.ok(g.title.startsWith("store 0.1 s · retrieval 14.6 s (degraded RERANK_DOWN) · "), g.title);
  });

  test("a failed retrieval: `retrieval failed (CODE)` — the wall and the model still measured", () => {
    const t = { ...base, stages: { ...base.stages, retrieval: { offsetMs: 115, durationMs: 1203, rerankMs: null, rerankDeadline: false, state: "failed", code: "WEAVIATE_DOWN" } } };
    const f = T.formatTurnTiming(t, { utc: true });
    assert.strictEqual(f.line, "55.2 s · retrieval failed (WEAVIATE_DOWN) · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b");
    assert.ok(f.title.includes("retrieval failed (WEAVIATE_DOWN) after 1.2 s"), f.title);
  });

  test("an estimated usage: `≈ 1,200 → 300 tokens (estimated)`", () => {
    const t = { ...base, tokens: { prompt: 1200, completion: 300, providerReported: false } };
    assert.strictEqual(T.formatTurnTiming(t).line, "55.2 s · retrieval 14.6 s · model 40.5 s · ≈ 1,200 → 300 tokens (estimated) · qwen3.8:27b");
  });

  test("no answer (generation null, T12's red chip): the wall alone", () => {
    const t = { ...base, stages: { ...base.stages, generation: null }, tokens: null };
    const f = T.formatTurnTiming(t, { utc: true });
    assert.strictEqual(f.line, "55.2 s");
    assert.ok(f.title.endsWith("no answer from the model — the wall alone is shown"), f.title);
    assert.ok(f.title.startsWith("store 0.1 s · retrieval 14.6 s (rerank 11.1 s) · "), "the stages that ran are still in the tooltip");
  });

  test("a chat-mode turn (no retrieval) and a turn with no model name", () => {
    const t = { ...base, stages: { ...base.stages, store: null, retrieval: null, scope: null, assembly: null }, model: null };
    assert.strictEqual(T.formatTurnTiming(t, { utc: true }).line, "55.2 s · model 40.5 s · 4,968 → 3,087 tokens");
    assert.strictEqual(T.formatTurnTiming(t, { utc: true }).title, "model 40.5 s · audit 0.0 s\nstarted 11:48:31.295 · finished 11:49:26.462 (UTC)");
  });

  test("nothing to format: null, never a string of dashes", () => {
    assert.strictEqual(T.formatTurnTiming(null), null);
    assert.strictEqual(T.formatTurnTiming({}), null);
    assert.strictEqual(T.formatTurnTiming({ wallMs: "55167" }), null);
  });

  test("formatOffset: `t+114 ms`, `t+14.7 s`, `t+1:05.2` past a minute; '' when unstamped", () => {
    assert.strictEqual(T.formatOffset(114), "t+114 ms");
    assert.strictEqual(T.formatOffset(0), "t+0 ms");
    assert.strictEqual(T.formatOffset(999), "t+999 ms");
    assert.strictEqual(T.formatOffset(1000), "t+1.0 s");
    assert.strictEqual(T.formatOffset(14693), "t+14.7 s");
    assert.strictEqual(T.formatOffset(59999), "t+60.0 s");
    assert.strictEqual(T.formatOffset(65200), "t+1:05.2");
    assert.strictEqual(T.formatOffset(135400), "t+2:15.4");
    assert.strictEqual(T.formatOffset(null), "");
    assert.strictEqual(T.formatOffset(undefined), "");
  });

  test("formatClock: `11:48:45.984` (UTC on request; the viewer's clock by default), '' for nothing", () => {
    assert.strictEqual(T.formatClock("2026-09-24T11:48:45.984Z", { utc: true }), "11:48:45.984");
    assert.strictEqual(T.formatClock("2026-09-24T00:00:00.007Z", { utc: true }), "00:00:00.007");
    assert.match(T.formatClock("2026-09-24T11:48:45.984Z"), /^\d\d:\d\d:\d\d\.984$/, "local: the same millisecond, the viewer's hour");
    assert.strictEqual(T.formatClock(null), "");
    assert.strictEqual(T.formatClock("not a date"), "");
  });

  test("formatSeconds / formatInt / formatTokens: one decimal, thousands grouped, the estimate labelled", () => {
    assert.strictEqual(T.formatSeconds(55167), "55.2 s");
    assert.strictEqual(T.formatSeconds(0), "0.0 s");
    assert.strictEqual(T.formatSeconds(67272), "67.3 s");
    assert.strictEqual(T.formatSeconds(null), "—");
    assert.strictEqual(T.formatInt(4968), "4,968");
    assert.strictEqual(T.formatInt(1234567), "1,234,567");
    assert.strictEqual(T.formatInt(null), "—");
    assert.strictEqual(T.formatTokens({ prompt: 4968, completion: 3087, providerReported: true }), "4,968 → 3,087 tokens");
    assert.strictEqual(T.formatTokens({ prompt: 1200, completion: 300, providerReported: false }), "≈ 1,200 → 300 tokens (estimated)");
    assert.strictEqual(T.formatTokens(fx.generation.usage), "4,968 → 3,087 tokens", "the generation span's `details.usage` shape (promptTokens / completionTokens) reads the same");
    assert.strictEqual(T.formatTokens({ promptTokens: null, completionTokens: null, providerReported: false }), "", "an unreported usage with no numbers prints nothing");
    assert.strictEqual(T.formatTokens(null), "");
  });
});

describe("U-TIMING: the stats drawer's aggregates (D5 a) — summed from each turn's timing, never estimated (acceptance 5)", () => {
  const t1 = summarise();
  const t2 = { ...t1, wallMs: 17559, stages: { ...t1.stages, generation: { offsetMs: 5200, durationMs: 12365 } }, tokens: { prompt: 7631, completion: 890, providerReported: true } };
  const t3 = { ...t1, wallMs: 3000, stages: { ...t1.stages, generation: null }, tokens: null, model: null };
  const est = { ...t1, wallMs: 9000, stages: { ...t1.stages, generation: { offsetMs: 100, durationMs: 8000 } }, tokens: { prompt: 1200, completion: 300, providerReported: false } };

  test("two provider-reported turns: the sums, the last turn's wall and model time, the mean model time", () => {
    const a = T.aggregateSessionTiming([t1, t2]);
    assert.deepStrictEqual(a, {
      turns: 2, timed: 2, tokenTurns: 2,
      promptTokens: 4968 + 7631, completionTokens: 3087 + 890, totalTokens: 4968 + 7631 + 3087 + 890,
      promptShare: 76, completionShare: 24,
      estimatedTurns: 0, allProviderReported: true,
      totalWallMs: 55167 + 17559, lastWallMs: 17559, lastModelMs: 12365,
      modelTurns: 2, meanModelMs: Math.round((40465 + 12365) / 2),
      model: "qwen3.8:27b",
    });
  });

  test("a mixed session: a turn with no timing is counted and not filled; a no-answer turn adds no tokens and no model time; an estimated turn is labelled", () => {
    const a = T.aggregateSessionTiming([t1, null, t3, est]);
    assert.strictEqual(a.turns, 4);
    assert.strictEqual(a.timed, 3, "three of four turns timed");
    assert.strictEqual(a.tokenTurns, 2);
    assert.strictEqual(a.promptTokens, 4968 + 1200);
    assert.strictEqual(a.completionTokens, 3087 + 300);
    assert.strictEqual(a.estimatedTurns, 1);
    assert.strictEqual(a.allProviderReported, false);
    assert.strictEqual(a.promptShare, Math.round(((4968 + 1200) / (4968 + 1200 + 3087 + 300)) * 100));
    assert.strictEqual(a.promptShare + a.completionShare, 100);
    assert.strictEqual(a.modelTurns, 2);
    assert.strictEqual(a.meanModelMs, Math.round((40465 + 8000) / 2));
    assert.strictEqual(a.lastWallMs, 9000);
    assert.strictEqual(a.lastModelMs, 8000);
    assert.strictEqual(a.totalWallMs, 55167 + 3000 + 9000);
  });

  test("an empty session: zeros and nulls, nothing invented (no '194 ms', no 75 / 25)", () => {
    assert.deepStrictEqual(T.aggregateSessionTiming([]), {
      turns: 0, timed: 0, tokenTurns: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, promptShare: 0, completionShare: 0, estimatedTurns: 0, allProviderReported: false,
      totalWallMs: 0, lastWallMs: null, lastModelMs: null, modelTurns: 0, meanModelMs: null, model: null,
    });
    assert.deepStrictEqual(T.aggregateSessionTiming(null).turns, 0);
  });
});

// T49 (t49-design.md §12b, D11 / D12 — the owner's ask): the line's values as labelled pills for the page's footer,
// from the SAME formatter: `id` wall / retrieval / model / in / out / llm, the owner's labels, `value` the figure
// exactly as the line prints it, `state` null or deadline / failed / estimated, `text` what the pill shows after its
// label. The line, the title and the parts are T43's, byte for byte — the pins above stand untouched.
describe("U-TIMING/T49: the pills beside the UNCHANGED line — the owner's six labels, every value a substring of the line (§12b D11 / D12)", () => {
  const base = summarise();
  const F = (t, over = {}) => T.formatTurnTiming(t, { utc: true, ...over });
  const LINE = "55.2 s · retrieval 14.6 s · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b";

  test("the six pills on the normal fixture, in the line's order: total response time · retrieval · thinking · input tokens · output tokens · LLM", () => {
    const f = F(base);
    assert.deepStrictEqual(f.pills, [
      { id: "wall", label: "total response time", value: "55.2 s", state: null, text: "55.2 s" },
      { id: "retrieval", label: "retrieval", value: "14.6 s", state: null, text: "14.6 s" },
      { id: "model", label: "thinking", value: "40.5 s", state: null, text: "40.5 s" },
      { id: "in", label: "input tokens", value: "4,968", state: null, text: "4,968" },
      { id: "out", label: "output tokens", value: "3,087", state: null, text: "3,087" },
      { id: "llm", label: "LLM", value: "qwen3.8:27b", state: null, text: "qwen3.8:27b" },
    ]);
    assert.strictEqual(f.line, LINE, "the line is byte-identical to T43's");
    assert.deepStrictEqual(f.parts, ["55.2 s", "retrieval 14.6 s", "model 40.5 s", "4,968 → 3,087 tokens", "qwen3.8:27b"], "the parts too");
    assert.deepStrictEqual(Object.keys(f), ["line", "title", "parts", "pills"]);
    assert.strictEqual(f.title, F(base).title);
  });

  test("the pills and the parts read the same numbers — the wall is parts[0], each stage's value ends its part (no second computation)", () => {
    const f = F(base);
    assert.strictEqual(f.pills[0].value, f.parts[0]);
    assert.strictEqual(f.parts[1], `retrieval ${f.pills[1].value}`);
    assert.strictEqual(f.parts[2], `model ${f.pills[2].value}`);
    assert.strictEqual(f.parts[3], `${f.pills[3].value} → ${f.pills[4].value} tokens`);
    assert.strictEqual(f.parts[4], f.pills[5].value);
  });

  test("a deadline-stopped rerank stage: the retrieval pill carries the figure and the state — `60.0 s · deadline`; the line is T43's `retrieval 60.0 s (deadline)`", () => {
    const t = { ...base, wallMs: 72345, stages: { ...base.stages, retrieval: { offsetMs: 115, durationMs: 60040, rerankMs: 60001, rerankDeadline: true, state: "degraded", code: "RERANK_PARTIAL" } } };
    const f = F(t);
    assert.strictEqual(f.line, "72.3 s · retrieval 60.0 s (deadline) · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b");
    assert.deepStrictEqual(f.pills[1], { id: "retrieval", label: "retrieval", value: "60.0 s", state: "deadline", text: "60.0 s · deadline" });
    assert.deepStrictEqual(f.pills[0], { id: "wall", label: "total response time", value: "72.3 s", state: null, text: "72.3 s" });
    assert.deepStrictEqual(f.pills.map((p) => p.state), [null, "deadline", null, null, null, null]);
    // A degraded stage that was NOT stopped by the deadline (RERANK_DOWN) carries no state: the line says nothing
    // either — the T10 chip above the answer discloses it, the tooltip names the code.
    const down = { ...base, stages: { ...base.stages, retrieval: { offsetMs: 115, durationMs: 14578, rerankMs: null, rerankDeadline: false, state: "degraded", code: "RERANK_DOWN" } } };
    assert.deepStrictEqual(F(down).pills[1], { id: "retrieval", label: "retrieval", value: "14.6 s", state: null, text: "14.6 s" });
    assert.ok(F(down).title.includes("degraded RERANK_DOWN"));
  });

  test("a failed retrieval: `failed · WEAVIATE_DOWN`, state failed — the value is the line's own phrase `failed (WEAVIATE_DOWN)`", () => {
    const t = { ...base, stages: { ...base.stages, retrieval: { offsetMs: 115, durationMs: 1203, rerankMs: null, rerankDeadline: false, state: "failed", code: "WEAVIATE_DOWN" } } };
    const f = F(t);
    assert.strictEqual(f.line, "55.2 s · retrieval failed (WEAVIATE_DOWN) · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b");
    assert.deepStrictEqual(f.pills[1], { id: "retrieval", label: "retrieval", value: "failed (WEAVIATE_DOWN)", state: "failed", text: "failed · WEAVIATE_DOWN" });
    const noCode = { ...t, stages: { ...t.stages, retrieval: { ...t.stages.retrieval, code: null } } };
    assert.deepStrictEqual(F(noCode).pills[1], { id: "retrieval", label: "retrieval", value: "failed (UNKNOWN)", state: "failed", text: "failed · UNKNOWN" });
    assert.strictEqual(F(noCode).line, "55.2 s · retrieval failed (UNKNOWN) · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b");
  });

  test("an estimated usage: both token pills carry the state — `≈ 1,200 · estimated` / `≈ 300 · estimated`; the values are the line's numbers", () => {
    const t = { ...base, tokens: { prompt: 1200, completion: 300, providerReported: false } };
    const f = F(t);
    assert.strictEqual(f.line, "55.2 s · retrieval 14.6 s · model 40.5 s · ≈ 1,200 → 300 tokens (estimated) · qwen3.8:27b");
    assert.deepStrictEqual(f.pills[3], { id: "in", label: "input tokens", value: "1,200", state: "estimated", text: "≈ 1,200 · estimated" });
    assert.deepStrictEqual(f.pills[4], { id: "out", label: "output tokens", value: "300", state: "estimated", text: "≈ 300 · estimated" });
    assert.deepStrictEqual(f.pills.map((p) => p.state), [null, null, null, "estimated", "estimated", null]);
    const gen = F({ ...base, tokens: fx.generation.usage });
    assert.deepStrictEqual(gen.pills.slice(3, 5).map((p) => p.text), ["4,968", "3,087"], "the generation span's usage shape (promptTokens / completionTokens) reads the same");
  });

  test("no answer (T12's red chip): the total pill alone", () => {
    const t = { ...base, stages: { ...base.stages, generation: null }, tokens: null };
    const f = F(t);
    assert.strictEqual(f.line, "55.2 s");
    assert.deepStrictEqual(f.pills, [{ id: "wall", label: "total response time", value: "55.2 s", state: null, text: "55.2 s" }]);
  });

  test("a chat-mode turn has no retrieval pill; no model name, no LLM pill; a usage with no numbers, no token pills", () => {
    const chat = { ...base, stages: { ...base.stages, store: null, retrieval: null, scope: null, assembly: null } };
    assert.deepStrictEqual(F(chat).pills.map((p) => p.id), ["wall", "model", "in", "out", "llm"]);
    assert.strictEqual(F(chat).line, "55.2 s · model 40.5 s · 4,968 → 3,087 tokens · qwen3.8:27b");
    const noModel = { ...chat, model: null };
    assert.deepStrictEqual(F(noModel).pills.map((p) => p.id), ["wall", "model", "in", "out"]);
    assert.strictEqual(F(noModel).line, "55.2 s · model 40.5 s · 4,968 → 3,087 tokens");
    const noNumbers = { ...base, tokens: { promptTokens: null, completionTokens: null, providerReported: false } };
    assert.deepStrictEqual(F(noNumbers).pills.map((p) => p.id), ["wall", "retrieval", "model", "llm"]);
    const halfNumbers = { ...base, tokens: { prompt: null, completion: 3087, providerReported: true } };
    assert.deepStrictEqual(F(halfNumbers).pills.slice(3, 5).map((p) => p.text), ["—", "3,087"], "a missing number prints the line's dash");
    assert.strictEqual(F(halfNumbers).line, "55.2 s · retrieval 14.6 s · model 40.5 s · — → 3,087 tokens · qwen3.8:27b");
  });

  test("on every variant: every value is a substring of the line, text is the value unless a state adds its word, the ids are unique, the labels are the owner's", () => {
    const variants = [
      base,
      { ...base, wallMs: 72345, stages: { ...base.stages, retrieval: { offsetMs: 115, durationMs: 60040, rerankMs: 60001, rerankDeadline: true, state: "degraded", code: "RERANK_PARTIAL" } } },
      { ...base, stages: { ...base.stages, retrieval: { offsetMs: 115, durationMs: 1203, rerankMs: null, rerankDeadline: false, state: "failed", code: "WEAVIATE_DOWN" } } },
      { ...base, tokens: { prompt: 1200, completion: 300, providerReported: false } },
      { ...base, stages: { ...base.stages, generation: null }, tokens: null },
      { ...base, stages: { ...base.stages, store: null, retrieval: null, scope: null, assembly: null }, model: null },
    ];
    const LABELS = { wall: "total response time", retrieval: "retrieval", model: "thinking", in: "input tokens", out: "output tokens", llm: "LLM" };
    for (const v of variants) {
      const f = F(v);
      assert.ok(f.pills.length >= 1 && f.pills.length <= 6);
      assert.strictEqual(new Set(f.pills.map((p) => p.id)).size, f.pills.length, "ids unique");
      for (const p of f.pills) {
        assert.ok(f.line.includes(p.value), `${p.id}: value "${p.value}" ⊂ line "${f.line}"`);
        assert.strictEqual(p.label, LABELS[p.id]);
        assert.ok([null, "deadline", "failed", "estimated"].includes(p.state), `${p.id}: state ${p.state}`);
        if (p.state === null) assert.strictEqual(p.text, p.value);
        else assert.ok(p.text.includes(p.state) || p.text.startsWith("failed"), `${p.id}: text "${p.text}" carries the state's word`);
        assert.deepStrictEqual(Object.keys(p), ["id", "label", "value", "state", "text"]);
      }
      assert.strictEqual(f.pills[0].id, "wall", "the total pill is always first");
    }
  });

  test("nothing to format: null (no pills to render), as before", () => {
    assert.strictEqual(T.formatTurnTiming(null), null);
    assert.strictEqual(T.formatTurnTiming({ wallMs: null }), null);
  });
});
