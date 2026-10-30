/**
 * src/lib/coding/turn.js — one coding turn (Machinery PR 1: brief §8 M1; design §4; decisions D1, D5, D6, D7).
 *
 * Every code turn (anything typed without /doc or /chat, and every scenario step) comes here instead of the RAG
 * orchestrator, which keeps /doc and /chat untouched. A turn:
 *   1. reports the router's verdict and the code profile's model;
 *   2. reads the IDE's state through the bridge (active file, selection);
 *   3. attaches the scenario step's files from the workspace (contained by resolveInside) and the editor's active file;
 *   4. searches the store once per layer of rules — regulator, corporate, SDLC, team — through the frozen retrieve
 *      route with the `documentFilter` it already accepts (a layer whose documents are not ingested is reported, not
 *      searched);
 *   5. composes the coding persona, the EVIDENCE block (layer markers REG-n … TEAM-n) and the files;
 *   6. calls the code model with streaming: thinking on → the portable OpenAI-compatible request; thinking off → Ollama's
 *      own /api/chat with `think: false` (the one form this Ollama honours; t36-design §0a, re-measured 2026-10-06);
 *   7. reads the outcome with the frozen readGenerationOutcome / describeGeneration (the stream is folded back into the
 *      provider's reply), parses the proposed files (never written here — Apply writes), checks the answer's markers;
 *   8. stamps every span with the frozen turn clock (spanTiming), builds `timing` with summariseTiming, scrubs the spans
 *      with redactTraceDetails, appends the turn to the run log, and returns the fields the page, the trace drawer and
 *      the stats drawer already read (the bridge route's shape) plus `coding`.
 * Bookkeeping never costs the answer (F-25's rule): a failed span, record or log line is reported, not thrown.
 *
 * Presenter flow (the owner's direction of 2026-10-07: the chat explains, the IDE carries the code): the step's mode
 * sets the request's instruction (explain: no code, locations as path:start-end against numbered lines; change: whole
 * files as File blocks; repair: the latest failing test run attached). The chat text is the answer without its fenced
 * code (chat_text.js; the full answer stays in the run log); an explain turn proposes nothing; a change turn's files go
 * to the IDE as diffs and a diagnosis's first location is selected in the IDE, both through the bridge.
 *
 * S2 (the pull request review, 2026-10-09): a `review` step runs the six pre-merge checks (scanner.js) on the pull
 * request's changed files, main's copy from the image's seed against the workspace's copy, before the model is called;
 * the prompt carries their findings and the diff; the answer explains them and adds judgement findings in a fenced
 * `findings` list (review.js); the merged review (outcome under REV-007) goes to the run log, the chat's findings table
 * and the IDE's review comments. A review proposes no files.
 *
 * S4 (the closer, the owner's S4-D1 and S4-D5 of 2026-10-12): an `audit` step answers an auditor's question from the
 * four layers with no code and no files. After the search, the regulator provisions that the corporate and standards
 * passages' "Traces to:" lines name are looked up in their own documents (regulator_refs.js, the checked index): each
 * found provision is added to the evidence, marked as traced from the rule that names it; one not found is reported.
 *
 * S5 (compliant comments, the owner's S5-D8 to S5-D11 of 2026-10-12): a `comments` step gives a COBOL program back
 * whole with its comments brought up to the Code Documentation Standard. A tool lists the program's divisions, sections
 * and paragraphs for the prompt (doc_check.js); the step runs with thinking off, which a step may set itself (the run log
 * says who set it); any step may ask for S4's regulator lookups (`traceRegulators`, S5's Assess).
 *
 * S5, measured on the shipped composition (the owner's S5-D13 (a) and S5-D14 (a) of 2026-10-12): a step may run without
 * the chat history (`history: "off"`, S5's comment step: the Assess exchange replayed made the model skip unit comments
 * and slip on code lines); and a comments turn's program keeps every line of code as it was given (code_restore.js): a
 * code line the answer changed or lost is put back before the change is shown, and the chat, the trace and the run log
 * say which.
 *
 * S6 (a new component end to end, the owner's S6-D1 to S6-D7 of 2026-10-13): a comments turn's program may be a Python
 * module, whose units are listed for the prompt (py_doc.js) and whose text as given is kept in the run log
 * (`commentsBase`), for the IDE's documentation check to compare the code by syntax tree after Apply (S6-D3 (a)); the
 * COBOL code-keeping stays COBOL's. An `improve` turn reads the latest test run with the code (S6-D4 (a)). A review of
 * the demo's own new files (`review.workspace`) runs S2's checks on them against main, and follows the step's own rules'
 * chains as well as the findings'.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { routeTurn, describeRoute, selectModelProfile, replayHistory } from "@/lib/rag/router";
import { planGenerationBudget, readGenerationOutcome, describeGeneration, GENERATION_PROVIDERS } from "@/lib/rag/generation";
import { turnClock, spanTiming, summariseTiming } from "@/lib/rag/timing";
import { classifyRetrievalOutcome } from "@/lib/rag/config";
import { resolveCredential } from "@/lib/credentials";
import { redactTraceDetails } from "@/lib/observability/trace-redaction";
import { resolveInside, PathContainmentError } from "@/lib/coding/paths";
import { STREAM_FORMS, createStreamFold, splitLines } from "@/lib/coding/stream";
import {
  PILLAR_ORDER,
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
  PASSAGE_MAX_CHARS,
} from "@/lib/coding/pillars";
import { parseFileOperations } from "@/lib/coding/file_ops";
import { codingSystemPrompt, requestInstruction } from "@/lib/coding/persona";
import { chatText, parseLocations, diffStat, numberLines } from "@/lib/coding/chat_text";
import { translateToInternalUrl, completionsUrl, hostOf } from "@/lib/coding/endpoints";
import { ollamaBackend } from "@/lib/models/litellm_backends";
import { loadScenarios, loadManifest, loadRegulatorIndex, findStep } from "@/lib/coding/scenarios";
import { regulatorLookups, chooseLookups, pickProvision, REGULATOR_LOOKUP } from "@/lib/coding/regulator_refs";
import { unitsBlock, unitsOf } from "@/lib/coding/doc_check";
import { pythonUnitsBlock, pythonUnitsOf } from "@/lib/coding/py_doc";
import { restoreCode, restoredNote } from "@/lib/coding/code_restore";
import { getBridgeState, bridgeAction } from "@/lib/coding/bridge";
import { appendRun, readRuns } from "@/lib/coding/runlog";
import { windowOf, proposalView, showOrder } from "@/lib/coding/steps";
import { scanChange } from "@/lib/coding/scanner";
import { SEED_PREFIX, changeOf, changedLineCounts } from "@/lib/coding/review_files";
import { REVIEW_RULES, reviewBlock, stripFindingsBlock, parseReviewFindings, mergeReview, findingsToFixBlock, ideComments } from "@/lib/coding/review";
import { loadRegister, traceChains, withTracedPassages } from "@/lib/coding/rule_chain";
import { layoutBlock } from "@/lib/coding/cobol_layout";

const WORKSPACE_ROOT = path.join(process.cwd(), "nexcode-data", "workspace");
/** The image's demo documents, where a review's rule chains are read from (rule_chain.js; only what the store holds). */
const DEMO_FILES_ROOT = path.join(process.cwd(), "public", "demos", "demo_files");
const LOCAL_ORIGIN = `http://127.0.0.1:${process.env.PORT || 3000}`;
const FILE_MAX_CHARS = 32 * 1024;
const FILES_MAX_CHARS = 96 * 1024;
/** Per layer: rerank 8 candidates, keep 4 (design §4 step 4; measured in the first live pass with content). */
const PER_LAYER_RETRIEVAL = Object.freeze({ candidatesToRerank: 8, keepTopNAfterRerank: 4 });
/**
 * A code turn asks for 32,768 output tokens (the frozen plan discloses requested → applied): the owner's S3-D8 of
 * 2026-10-10. S3's port needed up to 17,886 with thinking on, and S1's Diagnose had reached 16,253 of the earlier
 * 16,384; the model's context window is 262,144. The timeout gives a full budget room at about 128 tokens a second.
 */
const CODING_REQUESTED_MAX_TOKENS = 32768;
const GENERATION_TIMEOUT_MS = 420000;
const RETRIEVAL_TIMEOUT_MS = 120000;
const HISTORY_MESSAGES = 8;

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
/** A passage's trace fields for the run log and the chips: looked up (`via: "trace"`) and from which findings. */
const traceFields = (p) => ({ ...(p.via ? { via: p.via } : {}), ...(Array.isArray(p.tracedFrom) && p.tracedFrom.length ? { tracedFrom: p.tracedFrom } : {}) });

const LANGUAGE_BY_EXT = {
  ".py": "python",
  ".sql": "sql",
  ".ts": "typescript",
  ".js": "javascript",
  ".java": "java",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cbl": "cobol",
  ".cob": "cobol",
  ".md": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "bash",
  ".toml": "toml",
};
const languageOf = (p) => LANGUAGE_BY_EXT[path.extname(String(p || "")).toLowerCase()] || "";

/** One workspace file, read through the containment rule and cut to the remaining budget. */
function readWorkspaceFile(rel, budget) {
  try {
    const full = resolveInside(WORKSPACE_ROOT, rel);
    const buf = fs.readFileSync(full);
    const text = buf.toString("utf8");
    const limit = Math.max(0, Math.min(FILE_MAX_CHARS, budget));
    const cut = text.length > limit;
    return { path: rel, source: "workspace", bytes: buf.length, sha256: sha256(buf), text: cut ? text.slice(0, limit) : text, cut, error: null };
  } catch (err) {
    const error =
      err instanceof PathContainmentError ? `refused: ${err.message}` : err && err.code === "ENOENT" ? "not found in the workspace (reset the scenario)" : `not readable (${(err && err.code) || (err && err.message)})`;
    return { path: rel, source: "workspace", bytes: 0, sha256: null, text: "", cut: false, error };
  }
}

/** The ATTACHED FILES block: each file under a header carrying its workspace path (the path a `File:` header uses). */
function filesBlock(files, { numbered = false } = {}) {
  const usable = files.filter((f) => !f.error);
  const missing = files.filter((f) => f.error);
  if (usable.length === 0 && missing.length === 0) return "";
  const out = [
    numbered
      ? "ATTACHED FILES (workspace paths; each line carries its number for reference: cite locations as path:start-end, never copy the numbers)"
      : "ATTACHED FILES (workspace paths; use these exact paths in `File:` headers)",
  ];
  for (const f of usable) {
    const notes = [f.source === "editor" ? "the IDE's active editor" : null, f.source === "proposed" ? "your last answer's file, as applied" : null, f.isDirty ? "unsaved changes" : null, f.cut ? "cut to fit" : null].filter(Boolean);
    out.push("", `### ${f.path}${notes.length ? ` (${notes.join("; ")})` : ""}`);
    if (f.selection) out.push(`Selected lines ${f.selection.startLine}-${f.selection.endLine}:`, "```", f.selection.text, "```", "Whole file:");
    out.push(`\`\`\`${languageOf(f.path)}`, numbered ? numberLines(f.text.replace(/\s+$/, "")) : f.text.replace(/\s+$/, ""), "```");
  }
  for (const f of missing) out.push("", `### ${f.path} — ${f.error}`);
  return out.join("\n");
}

/** The scenario's latest test run since its last reset or Select, for a repair turn: the command, the result, the output's tail. */
function latestTestRunBlock(scenario) {
  if (!scenario) return "";
  const runs = windowOf(readRuns({ limit: 5000 }), scenario.id).filter((e) => e.kind === "test-run" && e.ran !== false);
  const run = runs[runs.length - 1];
  if (!run) return "";
  return [
    `LATEST TEST RUN (${run.command || "tests"}: ${run.summary || `exit code ${run.exitCode}`}; exit code ${run.exitCode}; at ${run.at})`,
    "```",
    String(run.excerpt || "").slice(-4000).replace(/\s+$/, ""),
    "```",
  ].join("\n");
}

/** S6-D9 (a): a review step's latest answer since the demo's last reset or Select, with its review (the run log's turn). */
function latestReviewOf(scenario, stepId) {
  if (!scenario || !stepId) return null;
  const turns = windowOf(readRuns({ limit: 5000 }), scenario.id).filter((e) => e.kind === "turn" && e.step === stepId && e.success === true && e.review && typeof e.review === "object");
  const t = turns[turns.length - 1];
  return t ? { turnId: t.turnId || null, at: t.at || null, review: t.review } : null;
}

/** The retrieve route's request fields, exactly as the orchestrator forwards them from the admin config. */
function retrievePayloadBase(adminConfig) {
  return {
    weaviateUrl: adminConfig.weaviateUrl || undefined,
    weaviateCollection: adminConfig.weaviateCollection || adminConfig.ragSettings?.weaviateCollection || undefined,
    token: adminConfig.embedApiKey || adminConfig.mlisToken || "",
    weaviateToken: adminConfig.mlisToken || "",
    rerankToken: adminConfig.rerankApiKey || adminConfig.mlisToken || "",
    embedUrl: adminConfig.embedEndpoint || undefined,
    embedModel: adminConfig.embedModelName || undefined,
    rerankUrl: adminConfig.rerankEndpointUrl || undefined,
    rerankModel: adminConfig.rerankModelName || undefined,
    ragSettings: adminConfig.ragSettings || undefined,
    ...(adminConfig.schemaVersion !== undefined && adminConfig.schemaVersion !== null ? { schemaVersion: adminConfig.schemaVersion } : {}),
  };
}

/** The documents route's request body, as the page builds it for the scope selector. */
function documentsBody(adminConfig) {
  const rs = adminConfig.ragSettings || {};
  return {
    weaviateUrl: adminConfig.weaviateUrl || undefined,
    mlisToken: adminConfig.mlisToken || "",
    ...(rs.weaviateCollection ? { weaviateCollection: rs.weaviateCollection } : {}),
    ...(rs.schemaVersion !== undefined && rs.schemaVersion !== null ? { schemaVersion: rs.schemaVersion } : {}),
    ...(adminConfig.schemaVersion !== undefined && adminConfig.schemaVersion !== null ? { schemaVersion: adminConfig.schemaVersion } : {}),
  };
}

const withTimeout = (signal, ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

/**
 * Run one coding turn. `emit(event)` receives the stream events (start, pillars, pillar, generation, delta, reasoning);
 * the return value is the final response object. `signal` aborts the searches and the model call (the page closed).
 */
export async function runCodingTurn({ body, emit = () => {}, signal = null } = {}) {
  const started = Date.now();
  const clock = turnClock(started);
  const traces = [];
  const turnId = `ct-${started.toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const message = typeof body?.message === "string" ? body.message : "";
  const history = Array.isArray(body?.history) ? body.history : [];
  const adminConfig = body?.adminConfig && typeof body.adminConfig === "object" ? body.adminConfig : {};
  const thinkingAsked = body?.thinking === "off" ? "off" : "on";
  let bookkeepingError = null;
  const noteBookkeeping = (stage, err) => {
    console.error(`[Coding Turn Bookkeeping Error - ${stage}]:`, err && err.message ? err.message : err);
    bookkeepingError = bookkeepingError || { code: "BOOKKEEPING_FAILED", stage, message: err && err.message ? err.message : String(err) };
  };
  const send = (event) => {
    try {
      emit(event);
    } catch (err) {
      noteBookkeeping("emit", err);
    }
  };

  // ── 1. The route, the scenario step and the model pair ────────────────────────────────────────────────────────────
  const routeStart = Date.now();
  const scenarios = loadScenarios();
  const found = findStep(scenarios, body?.scenario);
  const scenario = found ? found.scenario : null;
  const step = found ? found.step : null;
  // Presenter flow: the step's mode shapes the answer; a repair turn follows a failed test run (the step bar offers it).
  // S4: a doc step sent without its "/doc " prefix reaches this turn: it is answered as the auditor's question it is.
  const mode = step && step.mode ? (step.mode === "doc" ? "audit" : step.mode) : "change";
  const repair = Boolean(body?.scenario && body.scenario.repair === true && step && step.repair);
  // S5-D8 (a) of 2026-10-12: a step may set thinking itself (S5's comment step runs with it off, as measured: with it on,
  // 5 of 8 answers came back empty); otherwise the presenter's switch decides. The run log says which.
  const thinkingRequested = step && (step.thinking === "on" || step.thinking === "off") ? step.thinking : thinkingAsked;
  const thinkingSetBy = step && step.thinking ? "step" : "presenter";
  const route = routeTurn({ message, forcedCommand: adminConfig.forcedCommand ?? null, ideState: null, contextDefaults: {}, history });
  const pair = selectModelProfile({ mode: "code", adminConfig });
  const routeReport = describeRoute(route, pair);
  const cleanMessage = route.cleanMessage || message;
  traces.push({
    id: `trace-coding-route-${turnId}`,
    timestamp: new Date().toISOString(),
    category: "task_classification",
    title: "Coding Turn",
    description:
      `A code turn through the coding path (four layers of rules, the attached files, thinking ${thinkingRequested})` +
      (scenario ? `: scenario ${scenario.id}${step ? `, step ${step.id}` : ""}.` : "."),
    icon: "RiBrainLine",
    badge: routeReport.badge,
    badgeType: routeReport.badgeType,
    ...spanTiming(clock, routeStart),
    details: { ...routeReport.details, path: "coding", scenario: scenario ? scenario.id : null, step: step ? step.id : null },
  });
  send({ type: "start", turnId, thinking: thinkingRequested, scenario: scenario ? { id: scenario.id, stepId: step ? step.id : null } : null, mode, repair });

  // ── 2. The IDE's state ────────────────────────────────────────────────────────────────────────────────────────────
  const ideStart = Date.now();
  const ideState = await getBridgeState();
  const bridgeConnected = ideState !== null;
  const activeFile = ideState && ideState.activeFile ? ideState.activeFile : null;
  traces.push({
    id: `trace-coding-ide-${turnId}`,
    timestamp: new Date().toISOString(),
    category: "ide_context",
    title: "IDE State",
    description: bridgeConnected
      ? activeFile
        ? `Active file ${activeFile.path} (${activeFile.lineCount} lines${activeFile.isDirty ? ", unsaved changes" : ""}).`
        : "No file is active in the IDE."
      : "The IDE bridge did not answer (no IDE window open): the editor's active file is not attached.",
    icon: "RiCodeSSlashLine",
    badge: bridgeConnected ? "BRIDGE ACTIVE" : "BRIDGE OFFLINE",
    badgeType: bridgeConnected ? "teal" : "amber",
    ...spanTiming(clock, ideStart),
    details: {
      bridgeConnected,
      activeFile: activeFile ? { path: activeFile.path, language: activeFile.language, lineCount: activeFile.lineCount, isDirty: activeFile.isDirty } : null,
      openTabs: ideState && Array.isArray(ideState.openTabs) ? ideState.openTabs.length : 0,
    },
  });

  // ── 3. The attached files ─────────────────────────────────────────────────────────────────────────────────────────
  const filesStart = Date.now();
  const attached = [];
  let budget = FILES_MAX_CHARS;
  for (const rel of step ? step.attach : []) {
    const f = readWorkspaceFile(rel, budget);
    budget -= f.text.length;
    attached.push(f);
  }
  // A repair turn also attaches the files the step's last answer proposed, as the workspace holds them now (applied): the
  // chat history carries answers without their code, and a migration's port is new files the step's attach list
  // cannot name (S3, 2026-10-10). The model fixes its own code with the failing run beside it, not blind.
  if (repair && scenario && step) {
    const turns = windowOf(readRuns({ limit: 5000 }), scenario.id).filter((e) => e.kind === "turn" && e.step === step.id && e.success === true && Array.isArray(e.fileOperations));
    const last = turns[turns.length - 1];
    for (const rel of last ? last.fileOperations : []) {
      if (typeof rel !== "string" || attached.some((f) => f.path === rel)) continue;
      const f = readWorkspaceFile(rel, budget);
      if (f.error) continue;
      budget -= f.text.length;
      attached.push({ ...f, source: "proposed" });
    }
  }
  // A migrate turn's context is its step's own files, as measured: the active editor's file is not added. A demo shows
  // the fixture and the expected report in the editor, and the migrate instruction tells the model they are not attached
  // (with them attached, the model checked totals by hand instead of porting: session-90-s3-feasibility, 2026-10-10).
  // An audit turn answers from the rules alone, as measured (session-90-s4-probe): the ticket in the editor is not added.
  // A comments turn's context is its program alone, as measured (session-90-s5-probe): the ticket in the editor is not added.
  if (mode !== "migrate" && mode !== "audit" && mode !== "comments" && activeFile && typeof activeFile.content === "string" && !attached.some((f) => f.path === activeFile.path)) {
    const text = activeFile.content;
    const limit = Math.max(0, Math.min(FILE_MAX_CHARS, budget));
    const cut = text.length > limit;
    const sel = activeFile.selection && typeof activeFile.selection.text === "string" && activeFile.selection.text.trim() ? activeFile.selection : null;
    attached.push({
      path: activeFile.path,
      source: "editor",
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
      text: cut ? text.slice(0, limit) : text,
      cut,
      error: null,
      isDirty: Boolean(activeFile.isDirty),
      selection: sel ? { startLine: sel.startLine, endLine: sel.endLine, text: sel.text.slice(0, 8000) } : null,
    });
  }
  const attachedSummary = attached.map((f) => ({ path: f.path, source: f.source, bytes: f.bytes, sha256: f.sha256, cut: f.cut, error: f.error }));
  traces.push({
    id: `trace-coding-files-${turnId}`,
    timestamp: new Date().toISOString(),
    category: "ide_context",
    title: "Files Attached",
    description: attached.length ? `${attached.filter((f) => !f.error).length} of ${attached.length} file(s) attached to the prompt.` : "No file attached (no scenario step and no active editor).",
    icon: "RiFileCodeLine",
    badge: `${attached.filter((f) => !f.error).length} FILES`,
    badgeType: attached.some((f) => f.error) ? "amber" : "purple",
    ...spanTiming(clock, filesStart),
    details: { files: attachedSummary },
  });

  // ── 3b. S2: the pull request's pre-merge checks, before the model (REV-002: the tools first) ────────────────────────
  // S6: the same checks on the demo's own new files in the workspace (`review.workspace`), before their first commit.
  let scan = null;
  let reviewFiles = [];
  const workspaceReview = Boolean(scenario && scenario.review && scenario.review.workspace);
  if (mode === "review" && scenario && scenario.review) {
    const scanStart = Date.now();
    const change = changeOf(scenario);
    reviewFiles = change.files;
    scan = scanChange(change);
    send({ type: "scan", checks: scan.checks, findings: scan.findings.map((f) => ({ id: f.id, severity: f.severity, rule: f.rule, title: f.title, path: `${SEED_PREFIX}${f.path}`, line: f.line })) });
    traces.push({
      id: `trace-coding-scan-${turnId}`,
      timestamp: new Date().toISOString(),
      category: "compliance_audit",
      title: "Pre-merge Checks",
      description: `The six pre-merge checks (REV-002) ran on ${reviewFiles.filter((f) => typeof f.after === "string").length} changed file(s) of ${workspaceReview ? "the demo's new code in the workspace" : scenario.review.branch} against ${scenario.review.base}: ${scan.findings.length} finding(s), each verified by tool.`,
      icon: "RiShieldCheckLine",
      badge: `${scan.findings.length} TOOL FINDINGS`,
      badgeType: scan.findings.length ? "amber" : "teal",
      ...spanTiming(clock, scanStart),
      details: { checks: scan.checks, findings: scan.findings.map((f) => ({ id: f.id, check: f.check, rule: f.rule, severity: f.severity, path: f.path, lines: f.lines, evidence: f.evidence })) },
    });
  }

  // ── 3c. S3: a migration's record and report layouts, computed by a tool from the program's own source ────────────
  let layouts = null;
  if (mode === "migrate" && step && step.migrate) {
    const layoutStart = Date.now();
    const src = readWorkspaceFile(step.migrate.source, FILE_MAX_CHARS);
    if (!src.error) {
      const block = layoutBlock(src.text, { names: step.migrate.records });
      layouts = { source: step.migrate.source, sha256: src.sha256, text: block.text, records: block.records.map((r) => ({ name: r.name, laidOut: r.laidOut, width: r.width, fields: r.fields.length, reason: r.reason })) };
    } else {
      layouts = { source: step.migrate.source, sha256: null, text: "", records: [], error: src.error };
    }
    const laid = layouts.records.filter((r) => r.laidOut).length;
    send({ type: "layouts", records: laid, fields: layouts.records.reduce((n, r) => n + (r.fields || 0), 0), error: layouts.error || null });
    traces.push({
      id: `trace-coding-layouts-${turnId}`,
      timestamp: new Date().toISOString(),
      category: "compliance_audit",
      title: "Record Layouts",
      description: layouts.error
        ? `The layouts of ${step.migrate.source} could not be computed: ${layouts.error}.`
        : `${laid} of ${step.migrate.records.length} record(s) of ${step.migrate.source} laid out by a tool from its DATA DIVISION: every column, picture and literal, verified by tool.`,
      icon: "RiLayoutGridLine",
      badge: layouts.error ? "NO LAYOUTS" : `${laid} RECORDS`,
      badgeType: layouts.error || laid < step.migrate.records.length ? "amber" : "teal",
      ...spanTiming(clock, layoutStart),
      details: { source: layouts.source, sha256: layouts.sha256, records: layouts.records, error: layouts.error || null },
    });
  }

  // ── 3d. S5: a comments turn's units, listed by a tool from the program as the workspace holds it ─────────────────
  // S6: a Python module's classes, functions and methods; and the module as given, kept for the IDE's check (DOC-008).
  let units = null;
  let commentsBase = null;
  if (mode === "comments" && step && step.comments) {
    const unitsStart = Date.now();
    const src = readWorkspaceFile(step.comments.source, FILE_MAX_CHARS);
    const python = step.comments.language === "python";
    units = src.error
      ? { source: step.comments.source, text: "", count: 0, error: src.error }
      : python
        ? { source: step.comments.source, text: pythonUnitsBlock(step.comments.source, src.text), count: pythonUnitsOf(src.text).length, error: null }
        : { source: step.comments.source, text: unitsBlock(step.comments.source, src.text), count: unitsOf(src.text).length, error: null };
    if (python && !src.error && !src.cut) commentsBase = { path: step.comments.source, sha256: src.sha256, text: src.text };
    traces.push({
      id: `trace-coding-units-${turnId}`,
      timestamp: new Date().toISOString(),
      category: "compliance_audit",
      title: "Program Units",
      description: units.error
        ? `The units of ${step.comments.source} could not be listed: ${units.error}.`
        : step.comments.language === "python"
          ? `${units.count} classes, functions and methods of ${step.comments.source} listed by a tool, each to carry a docstring (DOC-002).`
          : `${units.count} divisions, sections and paragraphs of ${step.comments.source} listed by a tool, each to carry a purpose comment (DOC-002).`,
      icon: "RiListCheck2",
      badge: units.error ? "NO UNITS" : `${units.count} UNITS`,
      badgeType: units.error ? "amber" : "teal",
      ...spanTiming(clock, unitsStart),
      details: { source: units.source, count: units.count, error: units.error },
    });
  }

  // ── 4. The four layers of rules ───────────────────────────────────────────────────────────────────────────────────
  const retrievalStart = Date.now();
  const manifest = loadManifest();
  let storeDocuments = [];
  let documentsError = null;
  try {
    const res = await fetch(`${LOCAL_ORIGIN}/api/rag/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(documentsBody(adminConfig)),
      signal: withTimeout(signal, 30000),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && Array.isArray(j.documents)) storeDocuments = j.documents;
    else documentsError = (j && j.error) || `the documents route answered HTTP ${res.status}`;
  } catch (err) {
    documentsError = err.message;
  }
  // D10 (a) of 2026-10-10: a demo's turn searches only the documents on the demo's card.
  const cardSources = scenario && scenario.card ? scenario.card.artefacts.documents.map((d) => d.source) : null;
  const pillars = scopePillars(resolvePillars(manifest, storeDocuments), cardSources);
  send({ type: "pillars", pillars: pillars.map((p) => ({ id: p.id, label: p.label, marker: p.marker, documents: p.present.length, expected: p.documents.length })) });
  const query = retrievalQuery({ message: cleanMessage, hints: step ? step.retrievalHints : [] });
  // D11 (a) of 2026-10-11: a layer the step gives topics searches on them alone; the others on the message plus the hints.
  const search = layerSearch({ message: cleanMessage, hints: step ? step.retrievalHints : [], layerTopics: step ? step.layerTopics : null });
  const onTopics = PILLAR_ORDER.filter((id) => search[id].on === "topics");
  const withHints = step && step.retrievalHints.length ? " plus the step's retrieval hints" : "";
  const searchSummary =
    onTopics.length === PILLAR_ORDER.length
      ? "each layer searched on the step's topics for it"
      : onTopics.length
        ? `${onTopics.join(", ")} searched on the step's topics for each, the others on the message${withHints}`
        : `the search text is the message${withHints}`;
  const base = retrievePayloadBase(adminConfig);
  const outcomes = {};
  const rowsByPillar = {};
  const layerRuns = {};
  await Promise.all(
    pillars.map(async (p) => {
      const filter = pillarFilter(p);
      if (!filter) {
        outcomes[p.id] = { state: "absent", code: null, message: "no documents from this layer are in the store", chunkCount: 0 };
        send({ type: "pillar", id: p.id, state: "absent", passages: 0, ms: 0 });
        return;
      }
      const t0 = Date.now();
      let res = null;
      let json = null;
      try {
        res = await fetch(`${LOCAL_ORIGIN}/api/rag/retrieve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...base, query: search[p.id].text, documentFilter: filter, ...PER_LAYER_RETRIEVAL }),
          signal: withTimeout(signal, RETRIEVAL_TIMEOUT_MS),
        });
        json = await res.json().catch(() => null);
      } catch (err) {
        json = { success: false, code: "RETRIEVE_UNREACHABLE", error: `the retrieval service could not be reached: ${err.message}` };
      }
      const outcome = classifyRetrievalOutcome({ ok: Boolean(res && res.ok), status: res ? res.status : 0, body: json });
      const rows = outcome.state === "failed" ? [] : Array.isArray(json && json.results) ? json.results : [];
      const ms = Date.now() - t0;
      outcomes[p.id] = { ...outcome, ms, documents: filter.sources.length };
      rowsByPillar[p.id] = rows;
      layerRuns[p.id] = { startMs: t0, ms, report: json && json.report ? json.report : null };
      send({ type: "pillar", id: p.id, state: outcome.state, passages: rows.length, ms });
    })
  );
  for (const id of PILLAR_ORDER) {
    const p = pillars.find((x) => x.id === id);
    const o = outcomes[id] || { state: "absent" };
    const run = layerRuns[id];
    traces.push({
      id: `trace-coding-layer-${id}-${turnId}`,
      timestamp: new Date().toISOString(),
      category: "rag_pipeline",
      title: `Layer: ${p.label}`,
      description:
        o.state === "absent"
          ? `No ${p.label.toLowerCase()} documents are in the store yet${p.missing.length ? ` (${p.missing.length} named by the manifest)` : ""}; not searched.`
          : `${(rowsByPillar[id] || []).length} passage(s) from ${p.present.length} document(s) — ${o.state}${o.code ? ` (${o.code})` : ""}.`,
      icon: "RiBookOpenLine",
      badge: o.state === "absent" ? "NOT IN STORE" : `${p.marker} · ${(rowsByPillar[id] || []).length}`,
      badgeType: o.state === "ok" ? "teal" : o.state === "failed" ? "red" : o.state === "absent" ? "blue" : "amber",
      ...(run ? spanTiming(clock, run.startMs, { durationMs: run.ms }) : spanTiming(clock, retrievalStart, { durationMs: 0 })),
      details: {
        layer: id,
        marker: p.marker,
        documentsInStore: p.present.map((d) => d.source),
        documentsMissing: p.missing,
        documentScope: cardSources ? "the demo's card" : "all documents",
        searchedOn: search[id].on,
        searchText: search[id].text,
        layerState: o.state,
        layerCode: o.code || null,
        passages: (rowsByPillar[id] || []).length,
        layerReport: run ? run.report : null,
      },
    });
  }
  let passages = numberPassages(pillars, rowsByPillar);
  const retrieval = aggregateRetrieval(PILLAR_ORDER.map((id) => outcomes[id]));
  traces.push({
    id: `trace-coding-retrieval-${turnId}`,
    timestamp: new Date().toISOString(),
    category: "rag_pipeline",
    title: "Pillar Retrieval",
    description: `${passages.length} passage(s) from ${PILLAR_ORDER.filter((id) => outcomes[id] && outcomes[id].state !== "absent").length} searched layer(s); ${searchSummary}.`,
    icon: "RiBookOpenLine",
    badge: `${passages.length} PASSAGES`,
    badgeType: retrieval.state === "ok" ? "teal" : retrieval.state === "failed" ? "red" : "amber",
    ...spanTiming(clock, retrievalStart),
    details: {
      retrievalState: retrieval.state,
      retrievalCode: retrieval.code,
      retrievalQuery: query,
      layerSearch: search,
      report: {
        layers: PILLAR_ORDER.map((id) => ({ id, state: outcomes[id] ? outcomes[id].state : null, passages: (rowsByPillar[id] || []).length, ms: outcomes[id] && outcomes[id].ms !== undefined ? outcomes[id].ms : null })),
        documentsError,
      },
      documentScope: cardSources ? { kind: "card", scenario: scenario.id, documents: cardSources.length } : { kind: "all" },
    },
  });

  // ── 4b. S2 (D11 (a) of 2026-10-10): each tool finding's rule chain, looked up through the documents' trace lines ──
  // S5-D17 (a) of 2026-10-13: a step may name rules whose chains are followed the same way (`traceRules`, S5's Assess:
  // STD-DOC's eight rules), each root traced from itself; measured in session-90-s5-d16 (all 8 gaps in 5 of 5).
  // S6: a review step may name rules too (the audit: STD-SVS's), followed after the findings' and the review's own.
  let chain = null;
  const scanRoots = scan ? [...scan.findings.map((f) => ({ rule: f.rule, from: f.id })), ...REVIEW_RULES.map((rule) => ({ rule, from: "the review" }))] : [];
  const stepRoots = step && Array.isArray(step.traceRules) ? step.traceRules.map((rule) => ({ rule, from: rule })) : [];
  const chainRoots = scanRoots.length || stepRoots.length ? [...scanRoots, ...stepRoots] : null;
  if (chainRoots) {
    const chainStart = Date.now();
    const roots = chainRoots;
    const loaded = loadRegister(pillars, { root: DEMO_FILES_ROOT });
    const traced = traceChains(loaded.register, roots);
    const merged = withTracedPassages(passages, traced.items, Object.fromEntries(pillars.map((p) => [p.id, p.marker])));
    passages = merged.passages;
    chain = {
      roots: [...new Set(roots.map((r) => r.rule))],
      documents: loaded.documents,
      unreadable: loaded.unreadable,
      missing: traced.missing,
      capped: traced.capped,
      added: merged.added,
      alreadySearched: merged.alreadySearched,
    };
    send({ type: "chain", added: merged.added.length, alreadySearched: merged.alreadySearched.length, rules: chain.roots.length, missing: traced.missing });
    traces.push({
      id: `trace-coding-chain-${turnId}`,
      timestamp: new Date().toISOString(),
      category: "compliance_audit",
      title: "Rule Chains",
      description: `${chain.roots.length} rule(s) ${scan && stepRoots.length ? "from the tool findings, the review and the step" : scan ? "from the tool findings and the review" : "named by the step"} followed through the documents' "Traces to:" lines: ${merged.added.length} passage(s) added, ${merged.alreadySearched.length} already found by the search${traced.missing.length ? `; not in the searched documents: ${traced.missing.join(", ")}` : ""}.`,
      icon: "RiNodeTree",
      badge: `${merged.added.length + merged.alreadySearched.length} TRACED`,
      badgeType: traced.missing.length || loaded.unreadable.length ? "amber" : "teal",
      ...spanTiming(clock, chainStart),
      details: chain,
    });
  }

  // ── 4c. S4-D5 (a): the regulator provisions the evidence's trace lines name, looked up in their own documents ────────
  let regulatorTrace = null;
  // S5-D11 (a): a step may ask for the lookups too (S5's Assess); S1 to S3's steps do not.
  if (mode === "audit" || (step && step.traceRegulators)) {
    const regStart = Date.now();
    const regLayer = pillars.find((p) => p.id === "regulator") || null;
    // Only a document the demo's layers hold (the card's, in the store) is looked in: a provision printed elsewhere is
    // reported as outside the demo's documents, never as not found.
    const searched = new Set(regLayer ? regLayer.present.map((d) => d.source) : []);
    const named = regulatorLookups(passages, loadRegulatorIndex(), { max: Number.MAX_SAFE_INTEGER });
    // S6-D8: the step's own rules' provisions are all looked up, first; the evidence's others fill the usual six.
    const lookups = chooseLookups(named.filter((l) => searched.has(l.source)), { ownRules: step && Array.isArray(step.traceRules) ? step.traceRules : [] });
    const outside = named.filter((l) => !searched.has(l.source));
    const items = [];
    const missing = [];
    await Promise.all(
      lookups.map(async (l, order) => {
        const doc = regLayer.present.find((d) => d.source === l.source);
        let rows = [];
        try {
          const res = await fetch(`${LOCAL_ORIGIN}/api/rag/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...base, query: l.anchor, documentFilter: { sources: [doc.source], sourceIds: doc.sourceIds }, ...REGULATOR_LOOKUP }),
            signal: withTimeout(signal, RETRIEVAL_TIMEOUT_MS),
          });
          const json = await res.json().catch(() => null);
          rows = res.ok && json && Array.isArray(json.results) ? json.results : [];
        } catch (err) {
          missing.push({ key: l.key, label: l.label, tracedFrom: l.tracedFrom, why: `the lookup failed: ${err.message}` });
          return;
        }
        // The provision's own opening words, in order, on its own page, or it is not the provision: never shown as found.
        const hit = pickProvision(rows, l);
        if (!hit) {
          missing.push({ key: l.key, label: l.label, tracedFrom: l.tracedFrom, why: rows.length ? `no passage found on page ${l.page} holds the provision's opening words` : "the lookup found no passage" });
          return;
        }
        const text = String(hit.text || "").trim();
        const page = Number(hit.page);
        items.push({
          order,
          key: l.key,
          layer: "regulator",
          id: l.label,
          source: doc.source,
          page: Number.isInteger(page) && page > 0 ? page : l.page,
          sectionPath: l.label,
          text: text.length > PASSAGE_MAX_CHARS ? `${text.slice(0, PASSAGE_MAX_CHARS)} […]` : text,
          cut: text.length > PASSAGE_MAX_CHARS,
          tracedFrom: l.tracedFrom,
        });
      })
    );
    items.sort((a, b) => a.order - b.order);
    const merged = withTracedPassages(passages, items, Object.fromEntries(pillars.map((p) => [p.id, p.marker])));
    passages = merged.passages;
    const byId = new Map(items.map((it) => [it.id, it]));
    regulatorTrace = {
      looked: lookups.map((l) => ({ key: l.key, label: l.label, source: l.source, tracedFrom: l.tracedFrom })),
      found: [...merged.added, ...merged.alreadySearched].map((x) => ({ key: byId.get(x.id) ? byId.get(x.id).key : null, label: x.id, marker: x.marker })),
      missing: missing.map((m) => ({ key: m.key, label: m.label, tracedFrom: m.tracedFrom, why: m.why })),
      outside: outside.map((l) => ({ key: l.key, label: l.label, source: l.source, tracedFrom: l.tracedFrom })),
    };
    send({ type: "regtrace", looked: lookups.length, found: regulatorTrace.found.length, missing: regulatorTrace.missing.map((m) => m.label) });
    traces.push({
      id: `trace-coding-regtrace-${turnId}`,
      timestamp: new Date().toISOString(),
      category: "compliance_audit",
      title: "Regulator Trace",
      description: lookups.length
        ? `${lookups.length} regulator provision(s) named by the policy clauses' and standards' "Traces to:" lines and not already found: ${regulatorTrace.found.length} looked up in their own documents and added to the evidence${regulatorTrace.missing.length ? `; not found: ${regulatorTrace.missing.map((m) => `${m.label} (${m.why})`).join("; ")}` : ""}${outside.length ? `; outside the demo's documents, not looked up: ${outside.map((l) => l.label).join("; ")}` : ""}.`
        : `No "Traces to:" line in the evidence names a regulator provision in the demo's documents that the search had not already found${outside.length ? ` (outside them, not looked up: ${outside.map((l) => l.label).join("; ")})` : ""}.`,
      icon: "RiNodeTree",
      badge: `${regulatorTrace.found.length} TRACED`,
      badgeType: regulatorTrace.missing.length ? "amber" : "teal",
      ...spanTiming(clock, regStart),
      details: regulatorTrace,
    });
  }

  // ── 5. The messages ───────────────────────────────────────────────────────────────────────────────────────────────
  const memoryStart = Date.now();
  const system = codingSystemPrompt({ firm: manifest.firm, scenario });
  const evidence = evidenceBlock(pillars, passages, outcomes);
  // S6-D4 (a): an improve turn reads the latest test run with the code, as a repair turn does.
  const testBlock = repair || mode === "improve" ? latestTestRunBlock(scenario) : "";
  const instruction = requestInstruction({ mode, repair, language: step && step.comments ? step.comments.language : null, workspace: mode === "review" && workspaceReview });
  const reviewContext = scan ? reviewBlock({ scan, files: reviewFiles, base: scenario.review.base, branch: scenario.review.branch, workspace: workspaceReview }) : "";
  const layoutContext = layouts && layouts.text ? layouts.text : "";
  const unitsContext = units && units.text ? units.text : "";
  // S6: a Python module's AI disclosure names the assistant and the model (DOC-007; TEC-POL-005 clause 4.4), so the turn
  // says which model answers: measured, a comments answer named a model that does not run here (session-90-s6-instructions).
  const disclosureContext =
    (mode === "comments" && step && step.comments && step.comments.language === "python") || mode === "improve"
      ? `FACTS FOR THE AI DISCLOSURE (from NexCODE itself, not from the documents)\n- The assistant: NexCODE. The model answering this request: ${pair.model || "not configured"}.`
      : "";
  // S6-D9 (a) of 2026-10-13: a fix reads the open blocking findings of the review it fixes from that review's latest answer
  // (the run log), never from the chat: measured, 0 of 2 fixes with the chat replayed, 4 of 4 with this block and no history.
  const fixesStep = step && step.fixes && scenario ? scenario.steps.find((x) => x.id === step.fixes) || null : null;
  const fixReview = fixesStep ? latestReviewOf(scenario, fixesStep.id) : null;
  const fixTitle = fixesStep ? `the ${fixesStep.title.charAt(0).toLowerCase()}${fixesStep.title.slice(1)}` : "";
  const fixContext = fixesStep ? findingsToFixBlock(fixReview && fixReview.review, { title: fixTitle }) : "";
  const fixFindings = fixReview && Array.isArray(fixReview.review.findings) ? fixReview.review.findings.filter((f) => f.status !== "fixed" && (f.severity === "Critical" || f.severity === "High")).map((f) => f.id) : [];
  const filesContext = filesBlock(attached, { numbered: mode === "explain" || mode === "review" });
  const userContent = [evidence, reviewContext, layoutContext, filesContext, unitsContext, disclosureContext, testBlock, fixContext, `INSTRUCTION FOR THIS REQUEST\n${instruction}`, `REQUEST\n${cleanMessage}`].filter(Boolean).join("\n\n");
  if (fixesStep) {
    traces.push({
      id: `trace-coding-fixes-${turnId}`,
      timestamp: new Date().toISOString(),
      category: "compliance_audit",
      title: "Findings to Fix",
      description: fixReview
        ? `${fixFindings.length} open Critical or High finding(s) of ${fixTitle}'s latest answer listed for the fix${fixFindings.length ? `: ${fixFindings.join(", ")}` : ""}.`
        : `${fixTitle.charAt(0).toUpperCase()}${fixTitle.slice(1)} has not answered since the demo was selected: no finding listed.`,
      icon: "RiShieldCheckLine",
      badge: `${fixFindings.length} TO FIX`,
      badgeType: fixReview ? "teal" : "amber",
      ...spanTiming(clock, memoryStart),
      details: { step: fixesStep.id, reviewTurnId: fixReview ? fixReview.turnId : null, findings: fixFindings },
    });
  }
  // S5-D13 (a) of 2026-10-12: a step may run without the chat history (S5's comment step, as measured).
  const historyOff = Boolean(step && step.history === "off");
  const replay = historyOff ? [] : replayHistory(history, { limit: HISTORY_MESSAGES }).map((m) => (m.role === "assistant" ? { ...m, content: stripLayerMarkers(m.content) } : m));
  const messages = [{ role: "system", content: system }, ...replay, { role: "user", content: userContent }];
  // Polish Phase 2 (PL-D13 (a) of 2026-10-14): the size of each part of the prompt, so the one prompt count the server
  // reports can be apportioned by character share (usage.js), and the answer's size against the thinking's for the
  // completion count. Kept in the run log with the tokens.
  const composition = {
    system: system.length,
    history: replay.reduce((n, m) => n + String(m.content || "").length, 0),
    evidence: evidence.length,
    review: reviewContext.length,
    layout: layoutContext.length,
    files: filesContext.length,
    units: unitsContext.length,
    disclosure: disclosureContext.length,
    tests: testBlock.length,
    fix: fixContext.length,
    instruction: `INSTRUCTION FOR THIS REQUEST\n${instruction}`.length,
    request: `REQUEST\n${cleanMessage}`.length,
  };
  traces.push({
    id: `trace-coding-memory-${turnId}`,
    timestamp: new Date().toISOString(),
    category: "chat_history",
    title: "Conversation Memory",
    description: historyOff
      ? `No earlier message replayed: this step runs without the chat history, as measured; the prompt carries ${passages.length} passage(s) and ${attached.filter((f) => !f.error).length} file(s).`
      : `${replay.length} earlier message(s) replayed; the prompt carries ${passages.length} passage(s) and ${attached.filter((f) => !f.error).length} file(s).`,
    icon: "RiChatHistoryLine",
    badge: historyOff ? "NO HISTORY" : `${replay.length} MESSAGES`,
    badgeType: "blue",
    ...spanTiming(clock, memoryStart),
    details: { replayed: replay.length, historySetBy: historyOff ? "step" : null, systemChars: system.length, userChars: userContent.length },
  });

  // ── 6. The model, streamed ────────────────────────────────────────────────────────────────────────────────────────
  const genStart = Date.now();
  const plan = planGenerationBudget({ intent: "code", requestedMaxTokens: CODING_REQUESTED_MAX_TOKENS });
  // D31 (2026-10-30): the code model is a LiteLLM model. Thinking off needs Ollama's own /api/chat (`think: false`),
  // so it applies only when that model is Ollama-backed (LiteLLM /model/info); the call then goes straight to that
  // Ollama with the underlying model name, and no LiteLLM key travels to it.
  const ollama = thinkingRequested === "off" ? await ollamaBackend(pair.model, { token: pair.token }).catch(() => null) : null;
  const onOllama = Boolean(ollama);
  const thinkingMode = thinkingRequested === "off" && onOllama ? "off" : "on";
  const thinkingNote =
    thinkingRequested === "off" && !onOllama ? `thinking off needs an Ollama-backed model and ${pair.model || "this code model"} is not one (LiteLLM /model/info), so thinking stayed on` : null;
  const form = thinkingMode === "off" ? STREAM_FORMS.OLLAMA : STREAM_FORMS.OPENAI;
  const target = completionsUrl(pair.url);
  const cred = form === STREAM_FORMS.OLLAMA ? { value: "", source: "none" } : resolveCredential({ url: target, requestValue: pair.token });
  const internal = form === STREAM_FORMS.OLLAMA ? { url: `${ollama.origin}/api/chat`, headers: {} } : translateToInternalUrl(target);
  const callUrl = internal.url;
  const callModel = form === STREAM_FORMS.OLLAMA ? ollama.model : pair.model;
  const temperature = typeof adminConfig.temperature === "number" ? adminConfig.temperature : 0.1;
  const requestBody =
    form === STREAM_FORMS.OLLAMA
      ? { model: callModel, messages, stream: true, think: false, options: { temperature, num_predict: plan.applied } }
      : { model: callModel, messages, temperature, max_tokens: plan.applied, stream: true, stream_options: { include_usage: true } };
  send({ type: "generation", model: pair.model, thinking: thinkingMode, form });
  const fold = createStreamFold(form);
  let outcome = null;
  let described = null;
  let generationError = null;
  let lastReasoningEmit = 0;
  try {
    if (!target) throw new Error("no completions endpoint is configured for the code profile");
    if (!pair.model) throw new Error("no model is configured for the code profile");
    console.log(`[Coding Turn] ${turnId} dispatching to ${pair.model} @ ${hostOf(target)} (thinking ${thinkingMode}, ${form})`);
    const res = await fetch(callUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internal.headers, ...(cred.value ? { Authorization: `Bearer ${cred.value}` } : {}) },
      body: JSON.stringify(requestBody),
      signal: withTimeout(signal, GENERATION_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      throw new Error(`the model API returned HTTP ${res.status}${t ? `: ${t.slice(0, 300)}` : ""}`);
    }
    const decoder = new TextDecoder();
    let buf = "";
    const take = (line) => {
      const d = fold.pushLine(line);
      if (!d) return;
      if (d.content) send({ type: "delta", text: d.content });
      if (d.reasoning) {
        const now = Date.now();
        if (now - lastReasoningEmit > 250) {
          lastReasoningEmit = now;
          send({ type: "reasoning", chars: fold.state.reasoning.length });
        }
      }
    };
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      const { lines, rest } = splitLines(buf);
      buf = rest;
      for (const line of lines) take(line);
    }
    buf += decoder.decode();
    if (buf.trim()) take(buf);
    send({ type: "reasoning", chars: fold.state.reasoning.length });
    outcome = readGenerationOutcome({
      provider: form === STREAM_FORMS.OLLAMA ? GENERATION_PROVIDERS.OLLAMA_NATIVE : GENERATION_PROVIDERS.OPENAI_COMPATIBLE,
      json: fold.reply(),
    });
    described = describeGeneration({
      plan,
      outcome,
      model: pair.model,
      attempts: 1,
      thinkingControl: thinkingMode === "off" ? "off (ollama-native think:false)" : "on (provider default)",
    });
  } catch (err) {
    generationError =
      signal && signal.aborted
        ? "the request was cancelled (the page closed the stream)"
        : err && err.name === "TimeoutError"
          ? `the model did not finish within ${GENERATION_TIMEOUT_MS / 1000} s`
          : err && err.message
            ? err.message
            : String(err);
  }
  const emptyCut = Boolean(outcome && outcome.cut && outcome.empty);
  const success = Boolean(outcome) && !emptyCut;
  const answer = outcome ? outcome.content : "";
  const explanation = !outcome ? `The model call failed: ${generationError}. Nothing was generated.` : emptyCut ? described.userMessage : chatText(mode === "review" ? stripFindingsBlock(answer) : answer, { mode });
  traces.push({
    id: `trace-coding-llm-${turnId}`,
    timestamp: new Date().toISOString(),
    category: "llm_inference",
    title: "LLM Generation",
    description: outcome ? `${pair.model} (thinking ${thinkingMode}): ${described.generation.message}` : `The model call failed: ${generationError}`,
    icon: "RiSparklingLine",
    badge: described ? described.badge : "MODEL CALL FAILED",
    badgeType: described ? described.badgeType : "red",
    ...spanTiming(clock, genStart),
    details: {
      ...(described ? described.spanDetails : {}),
      model: pair.model,
      endpointHost: hostOf(target),
      form,
      thinkingRequest: { requested: thinkingRequested, mode: thinkingMode, note: thinkingNote },
      messages: messages.length,
      systemChars: system.length,
      userChars: userContent.length,
      evidencePassages: passages.length,
      streamFrames: fold.state.frames,
      streamErrors: fold.state.errors.slice(0, 5),
      error: generationError,
    },
  });

  // ── 7. The proposed files, the markers, the record of the turn ────────────────────────────────────────────────────
  const auditStart = Date.now();
  const parsedFiles = parseFileOperations(answer);
  const refusedFiles = parsedFiles.refused;
  // An explain, review or audit step proposes nothing: a file the model wrote anyway is ignored (and left out of the chat).
  const proposesNothing = mode === "explain" || mode === "review" || mode === "audit";
  const ignoredFiles = proposesNothing ? parsedFiles.operations.map((o) => o.path) : [];
  // S5-D14 (a) of 2026-10-12: a comments turn's program keeps every line of code as it was given. A code line the answer
  // changed or lost is put back by a tool before the change is shown (code_restore.js); the chat, the trace and the run
  // log say which. Measured: 5 of 35 answers had slipped on one line; the other 30 come back untouched.
  let codeKept = null;
  const proposed = (proposesNothing ? [] : parsedFiles.operations).map((op) => {
    // COBOL's code-keeping (fixed format); a Python module's code is compared by syntax tree in the IDE instead (S6).
    const given = mode === "comments" && step && step.comments && step.comments.language !== "python" && op.path === step.comments.source ? attached.find((x) => x.path === op.path && !x.error && !x.cut) : null;
    if (!given) return op;
    const kept = restoreCode(given.text, op.content);
    codeKept = { path: op.path, restored: kept.restored, refused: kept.refused, content: kept.restored.length ? kept.text : null };
    return kept.restored.length ? { ...op, content: kept.text } : op;
  });
  const fileOperations = proposed.map((op) => {
    const current = attached.find((x) => x.path === op.path && !x.error && !x.cut);
    if (current) return { ...op, ...diffStat(current.text, op.content) };
    const r = readWorkspaceFile(op.path, FILE_MAX_CHARS);
    if (!r.error && !r.cut) return { ...op, ...diffStat(r.text, op.content) };
    if (r.error && /not found/.test(r.error)) return { ...op, ...diffStat(null, op.content) };
    // Too large or unreadable: the counts are unknown, never reported as a new file.
    return { ...op, added: null, removed: null, isNew: false };
  });
  // Locations only from an explain turn: its files carried line numbers, so a location was read, never counted.
  const locations =
    mode === "explain"
      ? parseLocations(
          explanation,
          attached.filter((x) => !x.error && !x.cut).map((x) => ({ path: x.path, lineCount: x.text.replace(/\n$/, "").split("\n").length }))
        )
      : [];
  if (codeKept) {
    const lines = codeKept.restored.map((r) => (r.kind === "changed" ? `line ${r.originalLine} changed` : r.kind === "lost" ? `line ${r.originalLine} left out` : `a line added (the answer's line ${r.answerLine})`));
    traces.push({
      id: `trace-coding-codekept-${turnId}`,
      timestamp: new Date().toISOString(),
      category: "compliance_audit",
      title: "Code Kept",
      description: codeKept.refused
        ? `The answer's code differs from ${codeKept.path} on ${codeKept.refused.lines} lines, more than the ${codeKept.refused.max} a tool puts back: it is not a comments-only change, and the documentation check judges it as written.`
        : codeKept.restored.length
          ? `A tool compared the answer's code with ${codeKept.path} as given and put the program's own line back: ${lines.join("; ")}. The proposed change keeps every line of code (DOC-008).`
          : `A tool compared the answer's code with ${codeKept.path} as given: every line of code is the program's own; nothing to put back.`,
      icon: "RiShieldCheckLine",
      badge: codeKept.refused ? "NOT COMMENTS-ONLY" : codeKept.restored.length ? `${codeKept.restored.length} PUT BACK` : "CODE KEPT",
      badgeType: codeKept.refused ? "red" : codeKept.restored.length ? "amber" : "teal",
      ...spanTiming(clock, auditStart),
      details: { path: codeKept.path, restored: codeKept.restored, refused: codeKept.refused },
    });
  }
  // The chat says when the tool put code back (the IDE then shows a comments-only change).
  const keptNote = codeKept && codeKept.restored.length ? restoredNote(codeKept.restored, codeKept.path) : "";
  const shownExplanation = keptNote ? `${explanation}\n\n${keptNote}` : explanation;
  const check = markerCheck(answer, passages);
  const citations = citationsFor(check.cited, passages);
  // S2: the review, the tool findings merged with the model's own (read from its fenced findings list).
  let review = null;
  if (scan) {
    const assessed = success ? parseReviewFindings(answer, { changed: changedLineCounts(scenario) }) : { findings: [], dropped: 0, error: "no answer" };
    review = mergeReview({ scan, assessed, repoPrefix: SEED_PREFIX });
  }
  traces.push({
    id: `trace-coding-audit-${turnId}`,
    timestamp: new Date().toISOString(),
    category: "citation_audit",
    title: "Citation Audit",
    description:
      `${check.cited.length} passage(s) cited` +
      (check.unknown.length ? `; ${check.unknown.length} marker(s) match no passage given to the model: ${check.unknown.join(", ")}` : "") +
      (fileOperations.length ? `; ${fileOperations.length} file(s) proposed (shown in the IDE as diffs; written only on Apply)` : "") +
      (ignoredFiles.length ? `; ${ignoredFiles.length} file block(s) ignored (this step ${mode === "review" ? "reviews" : mode === "audit" ? "answers a question" : "explains"}, it does not change code)` : "") +
      (review ? `; review: ${review.counts.tool} tool and ${review.counts.reviewer} reviewer finding(s), outcome ${review.outcome}${review.dropped ? `, ${review.dropped} malformed finding(s) dropped` : ""}` : "") +
      ".",
    icon: "RiDoubleQuotesL",
    badge: check.unknown.length ? `${check.unknown.length} UNVERIFIED` : `${check.cited.length} CITED`,
    badgeType: check.unknown.length ? "amber" : "teal",
    ...spanTiming(clock, auditStart),
    details: { cited: check.cited, unverified: check.unknown, passagesOffered: passages.length, fileOperations: fileOperations.map((o) => o.path), refusedFiles, ignoredFiles, mode, repair, locations },
  });

  // ── 7b. The code goes to the IDE (presenter flow): a change's files as diffs, a diagnosis's first location selected ─
  const ideStartShow = Date.now();
  const ide = { proposalsShown: 0, views: [], revealed: null, reviewComments: 0, errors: [] };
  if (bridgeConnected && success && (fileOperations.length > 0 || locations.length > 0 || (review && review.findings.length > 0))) {
    try {
      if (review && review.findings.length > 0) {
        const r = await bridgeAction({ type: "showReview", turnId, findings: ideComments(review) });
        if (r && r.success) ide.reviewComments = r.threads || review.findings.length;
        else ide.errors.push(`review comments: ${(r && r.error) || "not shown"}`);
      } else if (fileOperations.length > 0) {
        // S3-D13 (a): a migration's new files open beside the files they replace or are checked against, the port last.
        for (const p of showOrder(step, fileOperations.map((o) => o.path))) {
          const op = fileOperations.find((o) => o.path === p);
          const r = await bridgeAction({ type: "showProposal", path: op.path, content: op.content, ...(proposalView(step, op.path) || {}) });
          if (r && r.success) {
            ide.proposalsShown += 1;
            ide.views.push({ path: op.path, view: r.view || "diff", beside: r.beside || null });
          } else ide.errors.push(`${op.path}: ${(r && r.error) || "not shown"}`);
        }
      } else {
        const loc = locations[0];
        const r = await bridgeAction({ type: "openFile", path: loc.path, line: loc.startLine, endLine: loc.endLine });
        if (r && r.success) ide.revealed = loc;
        else ide.errors.push(`${loc.path}: ${(r && r.error) || "not opened"}`);
      }
    } catch (err) {
      ide.errors.push(err.message);
    }
    traces.push({
      id: `trace-coding-ide-show-${turnId}`,
      timestamp: new Date().toISOString(),
      category: "ide_context",
      title: "Shown in the IDE",
      description: review
        ? `${ide.reviewComments} review comment(s) added to the pull request's files in the IDE.`
        : fileOperations.length
        ? `${ide.proposalsShown} of ${fileOperations.length} proposed change(s) opened in the IDE${ide.views.some((v) => v.view === "beside") ? `: ${ide.views.filter((v) => v.view === "beside").map((v) => `${v.path.split("/").pop()} beside ${String(v.beside).split("/").pop()}`).join("; ")}` : " as diffs"}.`
        : ide.revealed
          ? `${ide.revealed.label} selected in the IDE.`
          : "The IDE could not show the location.",
      icon: "RiCodeSSlashLine",
      badge: ide.errors.length ? "IDE PARTIAL" : "IDE",
      badgeType: ide.errors.length ? "amber" : "teal",
      ...spanTiming(clock, ideStartShow),
      details: { ...ide },
    });
  }

  const latency = Date.now() - started;
  const reported = Boolean(outcome && outcome.usage.providerReported);
  const estimate = (chars) => Math.floor(chars / 4);
  const tokenTelemetry = {
    prompt_tokens: reported ? outcome.usage.promptTokens : estimate(messages.reduce((n, m) => n + m.content.length, 0)),
    completion_tokens: reported ? outcome.usage.completionTokens : estimate(answer.length + (outcome ? outcome.reasoning.length : 0)),
    estimated: !reported,
  };
  let timing = null;
  try {
    timing = summariseTiming({ clock, wallMs: latency, traces, generation: described ? described.generation : null, telemetry: tokenTelemetry, model: pair.model });
  } catch (err) {
    noteBookkeeping("timing", err);
  }
  let safeTraces;
  try {
    safeTraces = redactTraceDetails(traces);
  } catch (err) {
    noteBookkeeping("redaction", err);
    safeTraces = traces.map((t) => ({ ...t, details: { redactionFailed: true } }));
  }
  const layers = PILLAR_ORDER.map((id) => {
    const p = pillars.find((x) => x.id === id);
    const o = outcomes[id] || {};
    return {
      id,
      label: p.label,
      marker: p.marker,
      documents: p.present.length,
      expected: p.documents.length,
      state: o.state || null,
      code: o.code || null,
      passages: (rowsByPillar[id] || []).length,
      ms: o.ms !== undefined ? o.ms : null,
      // D11 (a): what this layer searched for, kept with the record (only for a layer that was searched).
      ...(o.state && o.state !== "absent" ? { searchedOn: search[id].on, search: search[id].text } : {}),
    };
  });
  const logged = appendRun({
    kind: "turn",
    turnId,
    scenario: scenario ? scenario.id : null,
    step: step ? step.id : null,
    prompt: message,
    model: pair.model,
    endpointHost: hostOf(target),
    thinking: { requested: thinkingRequested, setBy: thinkingSetBy, mode: thinkingMode, form, reasoningChars: outcome ? outcome.chars.reasoning : 0 },
    // S5-D13 (a): whether the chat history was replayed, and who decided.
    history: { replayed: replay.length, setBy: historyOff ? "step" : "default" },
    tokens: { prompt: tokenTelemetry.prompt_tokens, completion: tokenTelemetry.completion_tokens, providerReported: reported },
    // Polish Phase 2 (PL-D13 (a)): the prompt's parts and the answer's size, for the apportioned split (usage.js).
    composition,
    answerChars: answer.length,
    timing: {
      wallMs: latency,
      retrievalMs: timing && timing.stages.retrieval ? timing.stages.retrieval.durationMs : null,
      modelMs: timing && timing.stages.generation ? timing.stages.generation.durationMs : null,
    },
    attached: attachedSummary,
    layers,
    passages: passages.map((p) => ({ marker: p.marker, pillar: p.pillar, source: p.source, page: p.page, sectionPath: p.sectionPath, ...traceFields(p) })),
    // PR B (D3): the cited passages' text, so the evidence record and the Results panel can quote the rules.
    citedPassages: passages.filter((p) => check.cited.includes(p.marker)).map((p) => ({ marker: p.marker, pillar: p.pillar, source: p.source, page: p.page, sectionPath: p.sectionPath, text: p.text, ...traceFields(p) })),
    chain,
    regulatorTrace,
    cited: check.cited,
    unverified: check.unknown,
    fileOperations: fileOperations.map((o) => o.path),
    mode,
    repair,
    proposals: fileOperations.map((o) => ({ path: o.path, added: o.added, removed: o.removed, isNew: o.isNew })),
    ignoredFiles,
    locations,
    ide,
    scan: scan ? { checks: scan.checks, findings: scan.findings } : null,
    review,
    // S6-D9 (a): the review a fix step fixes, and the findings it was given.
    fixes: fixesStep ? { step: fixesStep.id, reviewTurnId: fixReview ? fixReview.turnId : null, findings: fixFindings } : null,
    layouts: layouts ? { source: layouts.source, sha256: layouts.sha256, records: layouts.records, error: layouts.error || null } : null,
    units: units ? { source: units.source, count: units.count, error: units.error } : null,
    // S6: the Python module as the comments turn was given it, for the IDE's check to compare the code by syntax tree.
    commentsBase,
    // S5-D14 (a): the lines a tool put back, and the file as proposed after it did (the model's answer stays as written);
    // "Show the change" reads that file, not the answer's.
    codeKept,
    success,
    finishReason: outcome ? outcome.finishReason : null,
    error: success ? null : generationError || (emptyCut ? "GENERATION_EMPTY" : null),
    answer,
    reasoning: outcome ? outcome.reasoning : "",
  });
  if (!logged.ok) noteBookkeeping("run-log", new Error(logged.error));

  return {
    success,
    response: shownExplanation,
    intent: "code-generate",
    retrieval,
    ...(retrieval.state === "failed" ? { retrievalError: { code: retrieval.code, message: retrieval.message } } : {}),
    ...(bookkeepingError ? { bookkeepingError } : {}),
    error: success ? null : generationError || (emptyCut ? "GENERATION_EMPTY" : null),
    bridgeConnected,
    ideContext: ideState
      ? {
          activeFile: activeFile ? { path: activeFile.path, language: activeFile.language, lineCount: activeFile.lineCount, isDirty: activeFile.isDirty } : null,
          openTabCount: Array.isArray(ideState.openTabs) ? ideState.openTabs.length : 0,
        }
      : null,
    fileOperations,
    contextAssembly: null,
    documentScope: null,
    router: routeReport.response,
    generation: described ? described.generation : null,
    timing,
    answerPolicy: null,
    citations,
    uncitedClaims: [],
    traces: safeTraces,
    telemetry: {
      latency,
      ...tokenTelemetry,
      cost: 0.0,
      ...(described ? described.telemetry : { finish_reason: null, max_tokens: plan.applied, answer_chars: null, reasoning_chars: null }),
      thinking_mode: thinkingMode,
    },
    coding: {
      turnId,
      scenario: scenario ? { id: scenario.id, title: scenario.title, stepId: step ? step.id : null } : null,
      thinking: { requested: thinkingRequested, setBy: thinkingSetBy, mode: thinkingMode, form, note: thinkingNote },
      history: { replayed: replay.length, setBy: historyOff ? "step" : "default" },
      codeKept: codeKept ? { path: codeKept.path, restored: codeKept.restored, refused: codeKept.refused } : null,
      layers,
      attached: attachedSummary,
      refusedFiles,
      unverifiedMarkers: check.unknown,
      // Presenter panels (design §2, D5 of 2026-10-07): the cited passages with their text, so the chips can open the
      // Demo panel's viewer at the passage the answer relied on.
      citedPassages: passages.filter((p) => check.cited.includes(p.marker)).map((p) => ({ marker: p.marker, pillar: p.pillar, source: p.source, page: p.page, sectionPath: p.sectionPath, text: p.text, ...traceFields(p) })),
      chain,
      regulatorTrace,
      mode,
      repair,
      proposals: fileOperations.map((o) => ({ path: o.path, added: o.added, removed: o.removed, isNew: o.isNew })),
      locations,
      ignoredFiles,
      ide,
      review,
      retrievalQuery: query,
    },
  };
}
