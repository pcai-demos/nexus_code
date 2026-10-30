/**
 * U-CODING — the coding path's pure modules and its seams (Machinery PR 1; inputs/demo-design/machinery-pr1-design.md).
 *
 *  - stream.js: the two streamed reply forms measured on Ollama 0.33.3 (evidence/machinery-pr1-design/) fold back into
 *    the non-streamed reply, so the frozen readGenerationOutcome reads a streamed turn exactly as a JSON one (D6).
 *  - endpoints.js: the orchestrator's URL rules, and Ollama's own /api/chat for thinking off (D7).
 *  - pillars.js: the manifest, the layers in the store, the per-layer filter, the markers, the evidence block, the
 *    marker check and the turn's retrieval outcome (D5).
 *  - file_ops.js: whole-file proposals in four comment styles; unsafe paths refused (nothing is written here).
 *  - scenarios.js: the shipped definitions validate; every path is under the seed; every command is allow-listed (D3).
 *  - turn_client.js: the page's stream reader and the live bubble's reducer.
 *  - runlog.js: append and read (D8).
 *  - source pins: the new route streams NDJSON; turn.js reuses the frozen modules by import; the page's code branch
 *    posts to the coding route and still copies every field; ChatPanel still fetches nothing.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const { STREAM_FORMS, splitLines, createStreamFold, foldStreamText } = require("../../src/lib/coding/stream");
const { translateToInternalUrl, completionsUrl, ollamaNativeChatUrl, hostOf } = require("../../src/lib/coding/endpoints");
const P = require("../../src/lib/coding/pillars");
const { parseFileOperations, safeRelativePath } = require("../../src/lib/coding/file_ops");
const { validateScenario, loadScenarios, loadManifest, findStep, demoWrites, SEED_PREFIX, SCENARIO_COMMAND_IDS } = require("../../src/lib/coding/scenarios");
const { codingSystemPrompt } = require("../../src/lib/coding/persona");
const { liveTurnReducer, readCodingTurn } = require("../../src/lib/coding/turn_client");
const { appendRun, readRuns } = require("../../src/lib/coding/runlog");
const { readGenerationOutcome, GENERATION_PROVIDERS } = require("../../src/lib/rag/generation");

const sse = (obj) => `data: ${JSON.stringify(obj)}`;

describe("U-CODING/stream: a streamed reply folds into the reply the frozen outcome reader already reads (D6)", () => {
  test("OpenAI-compatible SSE with reasoning, content, a finish reason and a usage frame", () => {
    const lines = [
      ": keep-alive",
      sse({ choices: [{ index: 0, delta: { role: "assistant", content: "", reasoning: "Let me " } }] }),
      sse({ choices: [{ index: 0, delta: { content: "", reasoning: "think." } }] }),
      sse({ choices: [{ index: 0, delta: { content: "The answer" } }] }),
      sse({ choices: [{ index: 0, delta: { content: " is 13." }, finish_reason: "stop" }] }),
      sse({ choices: [], usage: { prompt_tokens: 23, completion_tokens: 48, total_tokens: 71 } }),
      "data: [DONE]",
    ];
    const fold = foldStreamText(STREAM_FORMS.OPENAI, lines.join("\n") + "\n");
    const streamed = readGenerationOutcome({ provider: GENERATION_PROVIDERS.OPENAI_COMPATIBLE, json: fold.reply() });
    const direct = readGenerationOutcome({
      provider: GENERATION_PROVIDERS.OPENAI_COMPATIBLE,
      json: { choices: [{ message: { role: "assistant", content: "The answer is 13.", reasoning: "Let me think." }, finish_reason: "stop" }], usage: { prompt_tokens: 23, completion_tokens: 48 } },
    });
    assert.deepStrictEqual(streamed, direct);
    assert.strictEqual(streamed.usage.providerReported, true);
    assert.strictEqual(fold.state.done, true);
  });

  test("OpenAI-compatible SSE cut at the budget: finish_reason length, reasoning only, an empty answer", () => {
    const text = [sse({ choices: [{ delta: { content: "", reasoning: "a".repeat(130) } }] }), sse({ choices: [{ delta: {}, finish_reason: "length" }] }), "data: [DONE]"].join("\n");
    const o = readGenerationOutcome({ provider: GENERATION_PROVIDERS.OPENAI_COMPATIBLE, json: foldStreamText(STREAM_FORMS.OPENAI, text).reply() });
    assert.strictEqual(o.cut, true);
    assert.strictEqual(o.empty, true);
    assert.strictEqual(o.chars.reasoning, 130);
    assert.strictEqual(o.usage.providerReported, false, "no usage frame → not reported, never guessed");
  });

  test("Ollama's own NDJSON with think false (content only) and with thinking (thinking deltas)", () => {
    const off = [{ message: { role: "assistant", content: "Thirteen" }, done: false }, { message: { role: "assistant", content: "." }, done: true, done_reason: "stop", prompt_eval_count: 25, eval_count: 38 }];
    const o1 = readGenerationOutcome({ provider: GENERATION_PROVIDERS.OLLAMA_NATIVE, json: foldStreamText(STREAM_FORMS.OLLAMA, off.map((x) => JSON.stringify(x)).join("\n")).reply() });
    assert.deepStrictEqual([o1.content, o1.reasoning, o1.finishReason, o1.usage.promptTokens, o1.usage.completionTokens], ["Thirteen.", "", "stop", 25, 38]);
    const on = [{ message: { role: "assistant", content: "", thinking: "hmm" }, done: false }, { message: { role: "assistant", content: "" }, done: true, done_reason: "length", prompt_eval_count: 23, eval_count: 48 }];
    const o2 = readGenerationOutcome({ provider: GENERATION_PROVIDERS.OLLAMA_NATIVE, json: foldStreamText(STREAM_FORMS.OLLAMA, on.map((x) => JSON.stringify(x)).join("\n")).reply() });
    assert.deepStrictEqual([o2.reasoning, o2.cut, o2.empty], ["hmm", true, true]);
  });

  test("lines split across chunks are read whole; a garbled frame is counted, never thrown", () => {
    const fold = createStreamFold(STREAM_FORMS.OPENAI);
    const whole = sse({ choices: [{ delta: { content: "abc" } }] });
    let buf = whole.slice(0, 10);
    let r = splitLines(buf);
    assert.deepStrictEqual(r.lines, []);
    buf = r.rest + whole.slice(10) + "\ndata: {not json\n";
    r = splitLines(buf);
    for (const l of r.lines) fold.pushLine(l);
    assert.strictEqual(fold.state.content, "abc");
    assert.strictEqual(fold.state.errors.length, 1);
    assert.throws(() => createStreamFold("other"), /unknown form/);
  });
});

describe("U-CODING/endpoints: the orchestrator's URL rules and Ollama's own chat endpoint (D7)", () => {
  test("completions URL standardisation, the in-cluster translation and the native endpoint", () => {
    assert.strictEqual(completionsUrl("https://ollama.demo.lon-pcai.twlon.com"), "https://ollama.demo.lon-pcai.twlon.com/v1/chat/completions");
    assert.strictEqual(completionsUrl("http://ollama.ollama.svc.cluster.local:11434/v1/"), "http://ollama.ollama.svc.cluster.local:11434/v1/chat/completions");
    assert.strictEqual(completionsUrl("http://x/v1/chat/completions"), "http://x/v1/chat/completions");
    assert.strictEqual(completionsUrl(""), "");
    const t = translateToInternalUrl("https://ollama.demo.lon-pcai.twlon.com/v1/chat/completions");
    assert.strictEqual(t.url, "http://ollama.ollama.svc.cluster.local:11434/v1/chat/completions");
    assert.deepStrictEqual(t.headers, {});
    assert.strictEqual(translateToInternalUrl("https://rerank.project-demos.serving.demo.lon-pcai.twlon.com/x").headers.Host, "rerank.project-demos.serving.demo.lon-pcai.twlon.com");
    assert.strictEqual(ollamaNativeChatUrl("http://ollama.ollama.svc.cluster.local:11434/v1/chat/completions"), "http://ollama.ollama.svc.cluster.local:11434/api/chat");
    assert.strictEqual(ollamaNativeChatUrl("not a url"), "");
    assert.strictEqual(hostOf("http://ollama.ollama.svc.cluster.local:11434/v1/chat/completions"), "ollama.ollama.svc.cluster.local:11434");
  });
});

describe("U-CODING/pillars: four layers, searched where the store holds their documents (D5)", () => {
  const manifest = {
    pillars: [
      { id: "team", label: "Team knowledge", marker: "TEAM", documents: [] },
      { id: "regulator", label: "External regulation", marker: "REG", documents: ["A.pdf", "B.pdf", "Gone.pdf"] },
      { id: "sdlc", label: "Engineering standards", marker: "SDLC", documents: ["std.md"] },
      { id: "corporate", label: "Corporate policy", marker: "CORP", documents: [] },
    ],
  };
  const store = [
    { source: "A.pdf", sourceIds: ["sa"], chunkCount: 10 },
    { source: "B.pdf", sourceIds: ["sb"], chunkCount: 5 },
    { source: "std.md", sourceIds: ["ss"], chunkCount: 3 },
    { source: "Other.pdf", sourceIds: ["so"], chunkCount: 9 },
  ];

  test("the shipped manifest validates; a manifest without exactly the four layers, or with a wrong marker, throws", () => {
    const shipped = loadManifest();
    assert.strictEqual(P.validateManifest(shipped).pillars.length, 4);
    assert.ok(P.validateManifest(shipped).pillars.find((p) => p.id === "regulator").documents.length >= 9);
    assert.throws(() => P.validateManifest({ pillars: manifest.pillars.slice(1) }), /exactly once/);
    assert.throws(() => P.validateManifest({ pillars: manifest.pillars.map((p) => (p.id === "team" ? { ...p, marker: "T" } : p)) }), /marker TEAM/);
  });

  test("layers in authority order, each with the documents the store holds and the ones it does not; the filter names the present ones", () => {
    const layers = P.resolvePillars(manifest, store);
    assert.deepStrictEqual(layers.map((l) => l.id), ["regulator", "corporate", "sdlc", "team"]);
    const reg = layers[0];
    assert.deepStrictEqual(reg.present.map((d) => d.source), ["A.pdf", "B.pdf"]);
    assert.deepStrictEqual(reg.missing, ["Gone.pdf"]);
    assert.deepStrictEqual(P.pillarFilter(reg), { sources: ["A.pdf", "B.pdf"], sourceIds: ["sa", "sb"] });
    assert.strictEqual(P.pillarFilter(layers[1]), null, "a layer with nothing in the store is not searched");
  });

  test("the search text carries the step's hints (D5 (a)); passages are numbered per layer in authority order", () => {
    assert.strictEqual(P.retrievalQuery({ message: "Fix it", hints: ["money", "rounding", "money"] }), "Fix it\n\nTopics: money; rounding");
    assert.strictEqual(P.retrievalQuery({ message: "Fix it" }), "Fix it");
    // The hints are never cut: a long message is trimmed to make room for them (S3's migrate prompts, 2026-10-11).
    const long = P.retrievalQuery({ message: "x".repeat(2000), hints: ["money code", "rounding"] });
    assert.strictEqual(long.length, P.QUERY_MAX_CHARS);
    assert.ok(long.endsWith("\n\nTopics: money code; rounding"), "the hints survive whole");
    assert.strictEqual(P.retrievalQuery({ message: "y".repeat(2000) }).length, P.QUERY_MAX_CHARS, "with no hints the message alone is cut");
    // D11 (a): a layer with topics searches on them alone; the rest on the message plus the hints.
    const s = P.layerSearch({ message: "Port it", hints: ["money"], layerTopics: { regulator: ["material change", "material change", "testing"] } });
    assert.deepStrictEqual(Object.keys(s), P.PILLAR_ORDER);
    assert.deepStrictEqual(s.regulator, { on: "topics", text: "material change; testing" });
    for (const id of ["corporate", "sdlc", "team"]) assert.deepStrictEqual(s[id], { on: "message", text: "Port it\n\nTopics: money" }, id);
    assert.deepStrictEqual(P.layerSearch({ message: "Hi" }).team, { on: "message", text: "Hi" });
    const layers = P.resolvePillars(manifest, store);
    const rows = {
      sdlc: [{ source: "std.md", text: "PAY-012 decimals", sectionNumber: "3", sectionTitle: "Money" }],
      regulator: [{ source: "A.pdf", text: "keep records", page: 12 }, { source: "B.pdf", text: "x".repeat(P.PASSAGE_MAX_CHARS + 10), page: 3, metadata: JSON.stringify({ humanTitle: "Figure 1" }) }],
    };
    const ps = P.numberPassages(layers, rows);
    assert.deepStrictEqual(ps.map((p) => p.marker), ["REG-1", "REG-2", "SDLC-1"]);
    assert.strictEqual(ps[0].locationKind, "page");
    assert.strictEqual(ps[1].cut, true);
    assert.strictEqual(ps[1].title, "Figure 1");
    assert.strictEqual(ps[2].sectionPath, "3 Money");
    const block = P.evidenceBlock(layers, ps, { regulator: { state: "ok" }, sdlc: { state: "ok" } });
    assert.ok(block.indexOf("[REG-1] A.pdf, page 12") > 0);
    assert.ok(block.indexOf("## External regulation") < block.indexOf("## Corporate policy"), "authority order");
    assert.match(block, /## Corporate policy[\s\S]*No documents from this layer are in the store yet/);
    assert.match(block, /Cite only these markers/);
  });

  test("the marker check splits cited from unverified markers; lists, repeats and links are handled; chips keep the RAG shape", () => {
    const ps = [{ marker: "REG-1", pillar: "regulator", source: "A.pdf", page: 2, sectionPath: null, imagePath: null, title: null, locationKind: "page" }, { marker: "SDLC-1", pillar: "sdlc", source: "s.md", page: null, sectionPath: "3", imagePath: null, title: null, locationKind: "section" }];
    const answer = "Use Decimal [SDLC-1, REG-1]. Again [REG-1]. Invented [CORP-7]. A [link](http://x) and [S1].";
    const check = P.markerCheck(answer, ps);
    assert.deepStrictEqual(check, { cited: ["SDLC-1", "REG-1"], unknown: ["CORP-7"] });
    const chips = P.citationsFor(check.cited, ps);
    assert.deepStrictEqual(chips.map((c) => c.marker), ["SDLC-1", "REG-1"]);
    for (const k of ["marker", "source", "page", "sectionPath", "imagePath", "title", "locationKind", "pillar"]) assert.ok(k in chips[0], k);
    assert.strictEqual(P.stripLayerMarkers("Use Decimal [SDLC-1, REG-1]. Done [REG-2]."), "Use Decimal. Done.");
  });

  test("the turn's retrieval outcome: failed only when every search failed; degraded on any failure; empty when nothing was searched or found", () => {
    assert.strictEqual(P.aggregateRetrieval([{ state: "absent" }, { state: "absent" }]).state, "empty");
    assert.strictEqual(P.aggregateRetrieval([{ state: "ok", chunkCount: 4 }, { state: "absent" }]).state, "ok");
    assert.strictEqual(P.aggregateRetrieval([{ state: "ok", chunkCount: 4 }, { state: "failed", code: "RERANK_DOWN" }]).state, "degraded");
    assert.strictEqual(P.aggregateRetrieval([{ state: "failed", code: "WEAVIATE_DOWN", message: "x" }]).state, "failed");
    assert.strictEqual(P.aggregateRetrieval([{ state: "empty", chunkCount: 0 }]).state, "empty");
  });
});

describe("U-CODING/file_ops: whole-file proposals; nothing is written here; unsafe paths refused", () => {
  test("the four comment styles, a header above the fence, a shebang, the first proposal per path", () => {
    const answer = [
      "```python", "# File: nexus-payments/a.py", "print(1)", "```",
      "```sql", "-- File: nexus-payments/q.sql", "select 1;", "```",
      "```cobol", "*> File: legacy/C.cbl", "       STOP RUN.", "```",
      "**File:** `nexus-payments/b.ts`", "```ts", "export const x = 1;", "```",
      "```bash", "#!/bin/sh", "# File: run.sh", "echo hi", "```",
      "```python", "# File: nexus-payments/a.py", "print(2)", "```",
      "```js", "// no header here", "```",
    ].join("\n");
    const { operations, refused } = parseFileOperations(answer);
    assert.deepStrictEqual(operations.map((o) => o.path), ["nexus-payments/a.py", "nexus-payments/q.sql", "legacy/C.cbl", "nexus-payments/b.ts", "run.sh"]);
    assert.strictEqual(operations[0].content, "print(1)\n", "the header line is not part of the file");
    assert.strictEqual(operations[4].content, "#!/bin/sh\necho hi\n", "a shebang stays");
    assert.strictEqual(operations[0].type, "writeFile");
    assert.deepStrictEqual(refused, []);
  });

  test("absolute and parent-segment paths are refused, never proposed", () => {
    const { operations, refused } = parseFileOperations("```py\n# File: ../etc/x.py\nx\n```\n```py\n# File: /etc/passwd\nx\n```\n```py\n# File: C:\\x.py\nx\n```");
    assert.deepStrictEqual(operations, []);
    assert.strictEqual(refused.length, 3);
    assert.strictEqual(safeRelativePath("./a/./b.py"), "a/b.py");
    assert.strictEqual(safeRelativePath("a/../b"), null);
  });
});

describe("U-CODING/scenarios: the shipped definitions validate; paths under the seed; commands allow-listed (D3, D10)", () => {
  test("every shipped scenario validates, names paths under the seed, and names only allow-listed commands", () => {
    const list = loadScenarios();
    assert.ok(list.length >= 1);
    for (const s of list) {
      for (const p of [s.ticket.path, ...s.open, ...s.steps.flatMap((st) => st.attach)]) assert.ok(p.startsWith(SEED_PREFIX), p);
      if (s.commands.tests) assert.ok(SCENARIO_COMMAND_IDS.includes(s.commands.tests));
    }
    const s1 = list.find((s) => s.id === "s1");
    assert.deepStrictEqual(s1.steps.map((st) => st.id), ["diagnose", "fix", "record"]);
    assert.deepStrictEqual(findStep(list, { id: "s1", stepId: "fix" }).step.id, "fix");
    assert.strictEqual(findStep(list, { id: "s9" }), null);
  });

  test("a path outside the seed, an unknown command or a step without prompt or action is refused", () => {
    const ok = { id: "s9", title: "t", ticket: { id: "T-1", path: "nexus-payments/t.md" }, steps: [{ id: "a", prompt: "p" }] };
    assert.strictEqual(validateScenario(ok).id, "s9");
    assert.throws(() => validateScenario({ ...ok, ticket: { id: "T", path: "../t.md" } }), /not a path under/);
    assert.throws(() => validateScenario({ ...ok, commands: { tests: "rm-rf" } }), /not allow-listed/);
    assert.throws(() => validateScenario({ ...ok, steps: [{ id: "a" }] }), /prompt or an action/);
  });
});

describe("U-CODING/persona and the page's stream reader", () => {
  test("the persona names the four layers in authority order, the evidence rules and the File: header styles", () => {
    const p = codingSystemPrompt({ scenario: { title: "Settlement mismatch incident", ticket: { id: "INC-2026-0419" } } });
    const order = ["REG-n", "CORP-n", "SDLC-n", "TEAM-n"].map((m) => p.indexOf(m));
    assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), "authority order");
    assert.match(p, /Cite only markers that appear in the EVIDENCE block/);
    assert.match(p, /# File: path/);
    assert.match(p, /-- File: path/);
    assert.match(p, /never claim that you did/);
    assert.match(p, /INC-2026-0419/);
  });

  test("the live bubble's reducer follows the events", () => {
    let s = liveTurnReducer(null, { type: "start", thinking: "on" });
    s = liveTurnReducer(s, { type: "pillars", pillars: [{ id: "regulator", label: "R", marker: "REG", documents: 9, expected: 9 }, { id: "team", label: "T", marker: "TEAM", documents: 0, expected: 0 }] });
    assert.deepStrictEqual([s.phase, s.order, s.layers.regulator.state, s.layers.team.state], ["searching", ["regulator", "team"], "searching", "absent"]);
    s = liveTurnReducer(s, { type: "pillar", id: "regulator", state: "ok", passages: 4, ms: 900 });
    s = liveTurnReducer(s, { type: "generation", model: "m", thinking: "on" });
    s = liveTurnReducer(s, { type: "reasoning", chars: 1200 });
    s = liveTurnReducer(s, { type: "delta", text: "Hello" });
    s = liveTurnReducer(s, { type: "delta", text: " world" });
    assert.deepStrictEqual([s.layers.regulator.passages, s.reasoningChars, s.text, s.phase], [4, 1200, "Hello world", "answering"]);
  });

  test("readCodingTurn hands every event over and resolves with the final data; an error event rejects", async () => {
    const enc = new TextEncoder();
    const body = (chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } });
    const seen = [];
    const data = await readCodingTurn({ body: body(['{"type":"start"}\n{"type":"del', 'ta","text":"a"}\n', '{"type":"final","data":{"success":true,"response":"a"}}']) }, { onEvent: (e) => seen.push(e.type) });
    assert.deepStrictEqual(data, { success: true, response: "a" });
    assert.deepStrictEqual(seen, ["start", "delta", "final"]);
    await assert.rejects(readCodingTurn({ body: body(['{"type":"error","message":"boom"}\n']) }), /boom/);
    await assert.rejects(readCodingTurn({ body: body(['{"type":"start"}\n']) }), /without a result/);
  });
});

describe("U-CODING/runlog: one JSON line per event, read back in order (D8)", () => {
  test("append stamps the time; read skips junk lines; a missing file is no events", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "u-coding-")), "runs.jsonl");
    assert.deepStrictEqual(readRuns({ file }), []);
    assert.deepStrictEqual(appendRun({ kind: "turn", turnId: "t1" }, { file, now: new Date("2026-10-06T10:00:00Z") }), { ok: true, error: null });
    fs.appendFileSync(file, "not json\n");
    appendRun({ kind: "test-run", scenario: "s1" }, { file });
    const all = readRuns({ file });
    assert.deepStrictEqual(all.map((e) => e.kind), ["turn", "test-run"]);
    assert.strictEqual(all[0].at, "2026-10-06T10:00:00.000Z");
    assert.deepStrictEqual(readRuns({ file, filter: (e) => e.scenario === "s1" }).map((e) => e.kind), ["test-run"]);
  });
});

describe("U-CODING/seams: the route, the turn, the page and the panel", () => {
  const route = codeOnly(read("src/app/api/ide-bridge/turn/route.js"));
  const turn = codeOnly(read("src/lib/coding/turn.js"));
  const page = codeOnly(read("src/app/page.js"));
  const panel = read("src/components/ChatPanel.jsx").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  test("the coding route streams newline-delimited JSON and aborts the turn when the page closes the stream", () => {
    assert.match(route, /"Content-Type": "application\/x-ndjson; charset=utf-8"/);
    assert.match(route, /emit\(\{ type: "final", data \}\);/);
    assert.match(route, /cancel\(\) \{\s*abort\.abort\(\);/);
  });

  test("turn.js reuses the frozen modules by import (no second outcome reader, clock or redaction) and never writes a proposed file", () => {
    for (const re of [
      /import \{ routeTurn, describeRoute, selectModelProfile, replayHistory \} from "@\/lib\/rag\/router";/,
      /import \{ planGenerationBudget, readGenerationOutcome, describeGeneration, GENERATION_PROVIDERS \} from "@\/lib\/rag\/generation";/,
      /import \{ turnClock, spanTiming, summariseTiming \} from "@\/lib\/rag\/timing";/,
      /import \{ redactTraceDetails \} from "@\/lib\/observability\/trace-redaction";/,
      /import \{ resolveCredential \} from "@\/lib\/credentials";/,
      /import \{ resolveInside, PathContainmentError \} from "@\/lib\/coding\/paths";/,
    ]) assert.match(turn, re);
    assert.ok(!/writeFileSync|writeWorkspaceFile/.test(turn), "a proposed file reaches the workspace only through Apply");
    assert.match(turn, /title: "Pillar Retrieval"[\s\S]{0,700}?report: \{/, "the umbrella span carries `report`: the timing reader's retrieval stage");
    assert.match(turn, /category: "citation_audit",\s*title: "Citation Audit",/, "the timing reader's audit stage");
    assert.match(turn, /think: false/, "thinking off goes through Ollama's own request (D7)");
    assert.match(turn, /stream_options: \{ include_usage: true \}/, "the provider's token counts survive streaming");
  });

  test("the response names every field the page copies, plus `coding`", () => {
    const ret = turn.slice(turn.lastIndexOf("return {"));
    for (const k of ["success", "response: shownExplanation", "intent", "retrieval", "bridgeConnected", "ideContext", "fileOperations", "router", "generation", "timing", "answerPolicy", "citations", "uncitedClaims", "traces: safeTraces", "telemetry", "coding", "citedPassages"]) {
      assert.ok(ret.includes(k), k);
    }
  });

  test("the page's code branch posts to the coding route and reads the stream into the same `data`; ChatPanel still fetches nothing", () => {
    assert.match(page, /const response = await fetch\("\/api\/ide-bridge\/turn", \{/);
    assert.match(page, /data = await readCodingTurn\(response, \{ onEvent: \(event\) => setLiveTurn\(\(prev\) => liveTurnReducer\(prev, event\)\) \}\);/);
    assert.match(page, /scenario: activeScenarioStep,\s*thinking: thinkingMode,/);
    assert.match(page, /coding: data\.coding \|\| null,/);
    assert.strictEqual((panel.match(/\bfetch\(/g) || []).length, 0);
    assert.match(panel, /\{isAnalyzing && liveTurn && <CodingLiveTurn liveTurn=\{liveTurn\} \/>\}/);
    assert.match(panel, /\{chat\.coding && <CodingTurnChips coding=\{chat\.coding\} \/>\}/);
  });
});

describe("U-CODING/record: the evidence record is the system's own account, from the run log (D8)", () => {
  const { eventsSinceReset, summariseTestOutput, buildEvidenceRecord, RECORD_SCHEMA } = require("../../src/lib/coding/record");
  const s1 = loadScenarios().find((s) => s.id === "s1");
  const events = [
    { kind: "turn", scenario: "s1", turnId: "old", at: "2026-10-06T09:00:00.000Z", cited: [] },
    { kind: "reset-scenario", scenario: "s1", at: "2026-10-06T09:30:00.000Z" },
    { kind: "turn", scenario: "s2", turnId: "other", at: "2026-10-06T09:40:00.000Z" },
    {
      kind: "turn", scenario: "s1", step: "diagnose", turnId: "t1", at: "2026-10-06T10:00:00.000Z", prompt: "Diagnose", model: "qwen3.8:27b", endpointHost: "ollama:11434",
      thinking: { mode: "on", form: "openai-compatible", reasoningChars: 4000 }, tokens: { prompt: 9000, completion: 1200, providerReported: true }, timing: { wallMs: 60000, retrievalMs: 9000, modelMs: 50000 },
      attached: [{ path: "nexus-payments/a.py", source: "workspace", sha256: "ab".repeat(32) }], layers: [{ id: "regulator", documents: 9, passages: 4, state: "ok" }, { id: "team", documents: 0, passages: 0, state: "absent" }],
      passages: [{ marker: "REG-1", pillar: "regulator", source: "FCA_SYSC_June2026.pdf", page: 12, sectionPath: null }, { marker: "REG-2", pillar: "regulator", source: "PSRs_2017_April2026.pdf", page: 3, sectionPath: null }],
      cited: ["REG-1"], unverified: ["SDLC-9"], fileOperations: ["nexus-payments/a.py"], success: true, finishReason: "stop",
    },
    { kind: "apply", path: "nexus-payments/a.py", ok: true, at: "2026-10-06T10:02:00.000Z" },
    { kind: "test-run", scenario: "s1", command: "s1-tests", exitCode: 0, durationMs: 1100, summary: "6 passed", excerpt: "Ran 6 tests in 0.01s\n\nOK\n", at: "2026-10-06T10:03:00.000Z" },
  ];

  test("only this scenario's events since its last reset count; applies are matched to the files a turn proposed", () => {
    assert.deepStrictEqual(eventsSinceReset(events, "s1").map((e) => e.turnId || e.kind), ["t1", "apply", "test-run"]);
    const { json, markdown } = buildEvidenceRecord({ scenario: s1, events, changes: { available: true, gitDiffStat: " a.py | 4 ++--", gitStatus: " M a.py" }, platform: { appTreeHash: "abc", models: ["qwen3.8:27b"] }, firm: "Nexus Bank plc", recordId: "r1", now: new Date("2026-10-06T10:05:00Z") });
    assert.strictEqual(json.schema, RECORD_SCHEMA);
    assert.deepStrictEqual(json.turns.map((t) => t.turnId), ["t1"]);
    assert.deepStrictEqual(json.turns[0].fileOperations, [{ path: "nexus-payments/a.py", applied: true }]);
    assert.deepStrictEqual(json.turns[0].unverifiedMarkers, ["SDLC-9"]);
    // PR B (D3): a rule carries the passage's text when the turn kept it (null here: this run-log line predates PR B).
    assert.deepStrictEqual(json.rules, [{ marker: "REG-1", layer: "regulator", source: "FCA_SYSC_June2026.pdf", page: 12, sectionPath: null, turnId: "t1", text: null, via: "search", tracedFrom: [] }], "a passage offered but not cited is not a rule cited");
    assert.deepStrictEqual(json.approval, { status: "pending", approver: null });
    // S5 (schema 0.8): no documentation check either, without a comments step's run.
    // 0.10 (S6): no improvement without an improve step's turn.
    assert.deepStrictEqual(json.verification, { toolVerified: [], assistantAssessed: [], equivalence: null, documentation: null, improvement: null }, "no equivalence without a migration's test run");
    assert.strictEqual(json.tests[0].summary, "6 passed");
    assert.match(markdown, /# Evidence record r1/);
    assert.match(markdown, /\| External regulation \| REG-1 \| FCA_SYSC_June2026\.pdf \| page 12 \| search \| t1 \|/);
    assert.match(markdown, /unverified markers: SDLC-9/);
    assert.match(markdown, /no model wrote this record/);
  });

  test("unittest output is summarised; a failed run names the failures", () => {
    assert.strictEqual(summariseTestOutput("....\nRan 4 tests in 0.002s\n\nOK\n", 0), "4 passed");
    assert.strictEqual(summariseTestOutput("..F.E.\nRan 6 tests in 0.01s\n\nFAILED (failures=1, errors=1)\n", 1), "2 of 6 failed");
    assert.strictEqual(summariseTestOutput("python3: not found", 127), "exit code 127");
  });
});

describe("U-CODING/seed: the S1 seed repository holds every path its scenario names, and its test proves the planted fault (D11)", () => {
  const { spawnSync } = require("child_process");
  const SEED = path.join(REPO_ROOT, "public", "demos", "seed");
  const GOLD = path.join(REPO_ROOT, "tests", "fixtures", "scenarios", "s1", "settlement_reconciler.gold.py");

  test("every path the shipped scenarios name exists in public/demos/seed, or on the scenario's own staged branch (S2)", () => {
    const BRANCHES = path.join(REPO_ROOT, "public", "demos", "seed-branches");
    const overlayOf = (branch) => {
      for (const d of fs.existsSync(BRANCHES) ? fs.readdirSync(BRANCHES) : []) {
        const m = path.join(BRANCHES, d, "branch.json");
        if (fs.existsSync(m) && JSON.parse(fs.readFileSync(m, "utf8")).branch === branch) return path.join(BRANCHES, d, "files");
      }
      return null;
    };
    for (const s of loadScenarios()) {
      // The card's code artefacts (presenter panels design §5, 2026-10-07) are seed paths too.
      const cardCode = s.card ? s.card.artefacts.code.map((c) => c.path) : [];
      const overlay = s.select.branch !== "main" ? overlayOf(s.select.branch) : null;
      if (s.select.branch !== "main") assert.ok(overlay, `${s.id}: a staged branch for ${s.select.branch}`);
      // S6 (2026-10-13): the files a demo writes itself (its workspace review's and its commit's) are the exception: the
      // seed must NOT hold them, so the demo's reset removes them as new files.
      const own = demoWrites(s);
      for (const p of own) assert.ok(!fs.existsSync(path.join(SEED, p)), `${s.id}: ${p} is written by the demo, so the seed does not hold it`);
      for (const p of [s.ticket.path, ...s.open, ...s.steps.flatMap((st) => st.attach), ...cardCode, ...(s.review ? s.review.changed : [])]) {
        if (own.includes(p)) continue;
        const onMain = fs.existsSync(path.join(SEED, p));
        const onBranch = Boolean(overlay) && fs.existsSync(path.join(overlay, p.replace(/^nexus-payments\//, "")));
        assert.ok(onMain || onBranch, p);
      }
    }
  });

  test("the seed's reconciliation test fails on the shipped module (the planted fault) and passes on the gold copy", (t) => {
    const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) {
      t.skip("python3 is not available here");
      return;
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "u-coding-seed-"));
    fs.cpSync(path.join(SEED, "nexus-payments"), path.join(work, "repo"), { recursive: true });
    const run = () =>
      spawnSync("python3", ["-m", "unittest", "discover", "-s", "services/settlement", "-p", "test_*.py"], {
        cwd: path.join(work, "repo"),
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      });
    const faulty = run();
    assert.strictEqual(faulty.status, 1, "the shipped module fails its test");
    assert.match(faulty.stderr, /FAILED \(failures=3\)/);
    assert.match(faulty.stderr, /VISA fees: expected £79\.71 \(scheme settlement\), got £79\.68 \(-3p\)/);
    fs.copyFileSync(GOLD, path.join(work, "repo", "services", "settlement", "settlement_reconciler.py"));
    const gold = run();
    assert.strictEqual(gold.status, 0, gold.stderr);
    assert.match(gold.stderr, /Ran 5 tests[\s\S]*\nOK\n/);
    fs.rmSync(work, { recursive: true, force: true });
  });
});

describe("U-CODING/apply: the chat's Apply state belongs to one turn's proposal", () => {
  test("keyed by the turn and the file, never by the message's place in the chat (Select demo clears the chat, so places repeat)", () => {
    // The owner's S1 re-run of 2026-10-10: S2's Fix answer was message 4 and its file was applied; S1's Fix answer,
    // after Select demo cleared the chat, was message 4 too, and its Apply button showed "Applied" and was disabled.
    const panel = codeOnly(read("src/components/ChatPanel.jsx"));
    assert.match(panel, /const opKey = `\$\{\(chat\.coding && chat\.coding\.turnId\) \|\| `message-\$\{idx\}`\}:\$\{op\.path \|\| opIdx\}`;/);
    assert.doesNotMatch(panel, /const opKey = `\$\{idx\}-\$\{opIdx\}`;/);
    assert.match(panel, /const isApplied = appliedOps\.has\(opKey\);/);
  });
});
