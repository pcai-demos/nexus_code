import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { loadScenarios, loadManifest, loadExampleRecord, demoWrites } from "@/lib/coding/scenarios";
import { resolvePillars } from "@/lib/coding/pillars";
import { bridgeAction, bridgeCommand, getBridgeHealth } from "@/lib/coding/bridge";
import { appendRun, readRuns } from "@/lib/coding/runlog";
import { usageSummary, ANSWER_KINDS } from "@/lib/coding/usage";
import { normalisePricing, priceUsage, EMPTY_PRICING } from "@/lib/coding/pricing";
import { buildEvidenceRecord, renderMarkdown, recordKind, latestRecordSince, summariseTestOutput, summariseSteps, summariseDocumentation, compactDocumentation, eventsSinceReset, commitMessage } from "@/lib/coding/record";
import { summarisePyDocumentation, pyReportText } from "@/lib/coding/py_doc";
import { documentationCheck, reportText } from "@/lib/coding/doc_check";
import { fileDiff } from "@/lib/coding/diff";
import { resolveInside } from "@/lib/coding/paths";
import { writeGroupWritable } from "@/lib/coding/workspace_write";
import { readBuildInfo } from "@/lib/build-info";
import { stepStates, proposalView, windowOf } from "@/lib/coding/steps";
import { parseFileOperations, safeRelativePath } from "@/lib/coding/file_ops";
import { scanChange } from "@/lib/coding/scanner";
import { statusAfterFix } from "@/lib/coding/review";
import { changeOf, SEED_PREFIX as REVIEW_PREFIX } from "@/lib/coding/review_files";

// Machinery PR 1 (brief §8 M2, M3, M5; design §5–§7; decisions D2, D3, D4, D8, D9, D10): the scenario panel's actions.
//   state           the definitions, the four layers' documents in the store, the bridge, the seed commit, last tests
//   start           open the scenario's ticket and files in the IDE (bridge openFile)
//   reset-all       stage the seed from the image into the pod's shared folder, then the bridge's seed-reset command
//                   (as the IDE user: replace the workspace repository, rebuild its git history); unstage
//   reset-scenario  the bridge's scenario-reset: the scenario's files back to the seed commit, its records removed
//   run-tests       the scenario's allow-listed test command; the output summarised
//   record          the evidence record, built from the run log (no model call), written into the workspace
//   select          (presenter panels design §3, 2026-10-07) the scenario's reset unless its definition says not to,
//                   then Start; the step states come back for the step bar
// The light state (the step bar, polled) skips the store and the talk track; the full state (the Demo panel) adds the
// store's layers with their catalogue (each document: in the store or not, and its served path when it is under
// public/demos/demo_files) and the firm. Both carry `progress`: every scenario's step states from the run log.
// Presenter flow (2026-10-07): Select runs the scenario's tests once when its definition says so (the failure the
// ticket reports, shown in the IDE's output panel); two display actions take code to the IDE from the chat's chips:
//   show-proposal   a change turn's proposed file as a diff again (the content is read from the run log, never sent)
//   reveal          a workspace file opened with a range of lines selected
// PR B (the owner's D1-D7 of 2026-10-07): Record also computes the code change against the seed (diff.js) and archives the
// record beside the run log, so a reset never loses it; four read-only actions serve the Results panel:
//   records         the archived evidence records, newest first (a summary each)
//   record-read     one archived record: its JSON and its Markdown
//   outputs         other Markdown / JSON outputs of the demos (under nexus-payments/compliance, records excluded)
//   output-read     one of those files
// Each scenario's card also names its non-code materials (the ticket) with a served path, for the Documents panel; and
// the environment reset clears stray files at the workspace root (anything but the seed repository and dot entries).
// S4 (the closer, the owner's S4-D1 to S4-D6 of 2026-10-12): two more actions, each one line in the run log:
//   results-shown   the latest record of any other demo written since the environment reset, or the shipped example
//                   record (S4-D2 (a)): the step bar opens the Results panel on it, and the line completes the step
//   doc-turn        the document chat answered a demo's doc step (the RAG engine keeps no coding run log)
// A demo whose steps change no code records an answer (S4-D4 (a)): no diff of the workspace, which another demo changed.
// S5 (S5-D10 (a)): a demo with a comments step adds the documentation check (doc_check.js, run here on the workspace's
// program against the image's seed) to its test command's run: one run, one exit code, the check's findings in its output.
// S6 (the owner's S6-D1 to S6-D7 of 2026-10-13): a Python module's check runs in the IDE (the bridge's py-doc-check, once
// the comments step has been asked), comparing the code with the module as the comments turn was given it while that
// change is the latest; a demo's reset leaves the files the demo writes itself out of the restore (the seed has none of
// them) and cleans their folders; and one more action, the presenter's Commit:
//   commit          the commit step's files and the evidence record on a feature branch, committed as the engineer the
//                   presenter plays and pushed to the Bank's repository in the pod (the bridge's bank-commit); the
//                   archive's copy of the record then names the commit (the committed copy cannot name its own)
// Every action is one line in the run log, and test runs and records also return a trace-drawer entry.
export const dynamic = "force-dynamic";

const SEED_REPO = "nexus-payments";
const SEED_SOURCE = path.join(process.cwd(), "public", "demos", "seed", SEED_REPO);
// The IDE container sees this pod-local folder as /home/coder/project/.shared (helm/templates/deployment.yaml).
const SEED_STAGE = path.join(process.cwd(), "nexcode-data", "shared", "seed", SEED_REPO);
// S2 (D1 (a), 2026-10-09): each pull request branch is staged beside the seed (branch.json + files/); the bridge makes it
// one local commit on its own branch after the baseline (code-server-ext/nexcode-bridge/seedgit.js).
const SEED_BRANCHES_SOURCE = path.join(process.cwd(), "public", "demos", "seed-branches");
const SEED_BRANCHES_STAGE = path.join(process.cwd(), "nexcode-data", "shared", "seed", "branches");
const WORKSPACE_ROOT = path.join(process.cwd(), "nexcode-data", "workspace");
const LOCAL_ORIGIN = `http://127.0.0.1:${process.env.PORT || 3000}`;
// PR B (D3): the evidence records' archive, on the app's own storage beside the run log (never cleared by a reset).
const RECORDS_ARCHIVE = path.join(process.cwd(), "nexcode-data", "state", "coding", "records");
// Polish Phase 3 (PL-D10 (a)): the price table, on the app's own data folder, edited by the Admin Panel's Misc tab.
const SETTINGS_DIR = path.join(process.cwd(), "nexcode-data", "state", "settings");
const PRICING_FILE = path.join(SETTINGS_DIR, "pricing.json");
// A demo's id may carry one letter after its number (s3r): its records were left out of the list before 2026-10-12.
const RECORD_NAME_RE = /^\d{4}-\d{2}-\d{2}-s\d{1,2}[a-z]?-[0-9a-f]{8}\.(json|md)$/;
const OUTPUTS_DIR = `${SEED_REPO}/compliance`;
const DIFF_FILE_MAX = 256 * 1024;
const MATERIAL_RE = /\.(md|txt|pdf)$/i;

const SPAN_ICONS = { test_run: "RiTestTubeLine", evidence_record: "RiFileShield2Line", ide_context: "RiCodeSSlashLine" };

function actionTrace(userPrompt, { category, title, description, badge, badgeType, durationMs, details }) {
  const now = new Date();
  const d = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0;
  return {
    turnId: `action-${now.getTime().toString(36)}`,
    timestamp: now.toISOString(),
    userPrompt,
    timing: null,
    traces: [
      {
        id: `trace-${category}-${now.getTime()}`,
        timestamp: now.toISOString(),
        category,
        title,
        description,
        icon: SPAN_ICONS[category] || "RiInformationLine",
        badge,
        badgeType,
        durationMs: d,
        offsetMs: 0,
        endOffsetMs: d,
        durationScope: "turn",
        details,
      },
    ],
  };
}

function cardOf(s) {
  return {
    id: s.id,
    title: s.title,
    summary: s.summary,
    story: s.story,
    language: s.language,
    ticket: s.ticket,
    open: s.open,
    minutes: s.minutes,
    icon: s.icon,
    select: s.select,
    review: s.review || null,
    card: s.card,
    steps: s.steps.map((st) => ({ id: st.id, title: st.title, prompt: st.prompt, action: st.action, retrievalHints: st.retrievalHints, after: st.after, optional: st.optional, mode: st.mode, repair: st.repair, chat: st.chat })),
    commands: s.commands,
    talkTrack: s.talkTrack,
    // PR B (D5): the demo's non-code materials (the ticket), each with the path the static server serves from the seed.
    materials: (s.card && s.card.artefacts ? s.card.artefacts.code : [])
      .filter((c) => MATERIAL_RE.test(c.path))
      .map((c) => {
        const rel = c.path.startsWith(`${SEED_REPO}/`) ? c.path.slice(SEED_REPO.length + 1) : null;
        const onDisk = rel ? fs.existsSync(path.join(SEED_SOURCE, rel)) : false;
        return { source: path.basename(c.path), path: onDisk ? `/demos/seed/${c.path}` : null, workspacePath: c.path, ext: path.extname(c.path).toLowerCase(), role: c.role || "" };
      }),
  };
}

/** The seed repository in the workspace: present or not, and its HEAD commit (read from .git, no git binary here). */
function seedStatus() {
  try {
    const gitDir = resolveInside(WORKSPACE_ROOT, `${SEED_REPO}/.git`);
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref: ") ? head.slice(5).trim() : null;
    const commit = ref ? fs.readFileSync(path.join(gitDir, ref), "utf8").trim() : head;
    return { inWorkspace: true, commit: /^[0-9a-f]{40}$/.test(commit) ? commit : null };
  } catch {
    return { inWorkspace: fs.existsSync(path.join(WORKSPACE_ROOT, SEED_REPO)), commit: null };
  }
}

/** The files under public/demos/demo_files by name: the served path (the static server's form) and the extension. */
function servedFiles() {
  const publicDir = path.join(process.cwd(), "public");
  const root = path.join(publicDir, "demos", "demo_files");
  const out = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (!out.has(e.name)) out.set(e.name, { path: `/${path.relative(publicDir, full).split(path.sep).join("/")}`, ext: path.extname(e.name).toLowerCase() });
    }
  };
  walk(root);
  return out;
}

async function storeLayers(adminConfig) {
  const rs = (adminConfig && adminConfig.ragSettings) || {};
  const body = {
    weaviateUrl: (adminConfig && adminConfig.weaviateUrl) || undefined,
    mlisToken: (adminConfig && adminConfig.mlisToken) || "",
    ...(rs.weaviateCollection ? { weaviateCollection: rs.weaviateCollection } : {}),
    ...(rs.schemaVersion !== undefined && rs.schemaVersion !== null ? { schemaVersion: rs.schemaVersion } : {}),
  };
  try {
    const res = await fetch(`${LOCAL_ORIGIN}/api/rag/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const j = await res.json().catch(() => null);
    const docs = res.ok && j && Array.isArray(j.documents) ? j.documents : null;
    if (!docs) return { error: (j && j.error) || `HTTP ${res.status}`, layers: null };
    const served = servedFiles();
    const byName = new Map(docs.map((d) => [d.source, d]));
    return {
      error: null,
      collection: j.collection || null,
      documentCount: docs.length,
      layers: resolvePillars(loadManifest(), docs).map((p) => ({
        id: p.id,
        label: p.label,
        marker: p.marker,
        description: p.description,
        documents: p.present.length,
        expected: p.documents.length,
        missing: p.missing,
        // The Demo panel's viewer renders a document only from this served path; a document with none is listed, not shown.
        catalogue: p.documents.map((source) => {
          const d = byName.get(source) || null;
          const f = served.get(source) || null;
          return { source, inStore: Boolean(d), chunkCount: d ? d.chunkCount : null, totalPages: d ? d.totalPages : null, path: f ? f.path : null, ext: f ? f.ext : null };
        }),
      })),
    };
  } catch (err) {
    return { error: err.message, layers: null };
  }
}

async function stateOf(body, scenarios) {
  const [health, store] = await Promise.all([getBridgeHealth(), body.light ? Promise.resolve(null) : storeLayers(body.adminConfig || {})]);
  const events = readRuns({ limit: 5000 });
  const lastTests = {};
  for (const e of events) {
    if (e.kind === "test-run" && e.scenario) lastTests[e.scenario] = { at: e.at, exitCode: e.exitCode, summary: e.summary || null };
  }
  const progress = {};
  for (const sc of scenarios) progress[sc.id] = stepStates(sc, events);
  const manifest = loadManifest();
  return {
    scenarios: scenarios.map((sc) => {
      const c = cardOf(sc);
      return body.light ? { ...c, talkTrack: undefined } : c;
    }),
    firm: manifest.firm || null,
    store,
    bridge: health ? { connected: true, pid: health.pid ?? null, holdingSince: health.holdingSince ?? null } : { connected: false },
    seed: seedStatus(),
    lastTests,
    progress,
  };
}

async function start(scenario) {
  const t0 = Date.now();
  const paths = [scenario.ticket.path, ...scenario.open.filter((p) => p !== scenario.ticket.path)];
  const opened = [];
  for (const p of paths) {
    const r = await bridgeAction({ type: "openFile", path: p });
    opened.push({ path: p, success: Boolean(r && r.success), error: r && !r.success ? r.error || null : null });
  }
  const ok = opened.every((o) => o.success);
  appendRun({ kind: "start", scenario: scenario.id, opened });
  return { success: ok, opened, durationMs: Date.now() - t0, error: ok ? null : opened.find((o) => !o.success).error || "a file could not be opened (reset the scenario?)" };
}

async function resetAll() {
  const t0 = Date.now();
  if (!fs.existsSync(SEED_SOURCE)) return { success: false, changed: false, error: "the seed repository is not in the image (public/demos/seed/nexus-payments)" };
  // Nothing is touched unless the IDE window's bridge answers: the rebuild runs there.
  if (!(await getBridgeHealth())) return { success: false, changed: false, error: "Open the IDE panel: the bridge starts with it.", code: "BRIDGE_OFFLINE" };
  // PR B (D6): a clean slate: anything at the workspace root other than the seed repository (and dot entries) goes.
  const strayRemoved = [];
  let strayError = null;
  try {
    for (const name of fs.existsSync(WORKSPACE_ROOT) ? fs.readdirSync(WORKSPACE_ROOT) : []) {
      if (name === SEED_REPO || name.startsWith(".")) continue;
      fs.rmSync(resolveInside(WORKSPACE_ROOT, name), { recursive: true, force: true });
      strayRemoved.push(name);
    }
  } catch (err) {
    strayError = err.message;
  }
  fs.rmSync(SEED_STAGE, { recursive: true, force: true });
  fs.rmSync(SEED_BRANCHES_STAGE, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(SEED_STAGE), { recursive: true });
  fs.cpSync(SEED_SOURCE, SEED_STAGE, { recursive: true });
  if (fs.existsSync(SEED_BRANCHES_SOURCE)) fs.cpSync(SEED_BRANCHES_SOURCE, SEED_BRANCHES_STAGE, { recursive: true });
  let result;
  try {
    result = await bridgeCommand("seed-reset");
  } finally {
    fs.rmSync(SEED_STAGE, { recursive: true, force: true });
    fs.rmSync(SEED_BRANCHES_STAGE, { recursive: true, force: true });
  }
  const ok = Boolean(result && result.success);
  // The sidebar's "Reset the demo environment" (2026-10-07, D1 (a), D2): a reset-all marker starts every demo again at step 1.
  appendRun({ kind: "reset-all", scope: "environment", success: ok, commit: ok ? result.commit || null : null, branches: ok && Array.isArray(result.branches) ? result.branches : [], ide: ok ? result.ide || null : null, strayRemoved, strayError, error: ok ? null : (result && result.error) || "unknown" });
  const durationMs = Date.now() - t0;
  return {
    success: ok,
    commit: ok ? result.commit || null : null,
    // 2026-10-12: whether a failed reset changed the workspace repository (the bridge checks before it deletes).
    changed: ok ? true : result && typeof result.changed === "boolean" ? result.changed : null,
    strayRemoved,
    durationMs,
    error: ok ? null : (result && result.error) || "unknown",
    trace: actionTrace("Reset the demo environment", {
      category: "ide_context",
      title: "Demo Environment Reset",
      description: ok
        ? `The workspace repository was rebuilt from the seed (commit ${String(result.commit || "").slice(0, 12)}) and the IDE cleared; the documents and the store were not touched.`
        : `The demo environment reset failed: ${(result && result.error) || "unknown"}`,
      badge: ok ? "RESET" : "RESET FAILED",
      badgeType: ok ? "teal" : "red",
      durationMs,
      details: { command: "seed-reset", commit: ok ? result.commit || null : null, strayRemoved, strayError, steps: result && result.steps ? result.steps : null, error: ok ? null : (result && result.error) || null },
    }),
  };
}

async function resetScenario(scenario) {
  const t0 = Date.now();
  // S6: the files the demo writes itself are not in the seed: they are not restored, their folders are cleaned.
  const own = demoWrites(scenario);
  const paths = [...new Set([scenario.ticket.path, ...scenario.open, ...scenario.steps.flatMap((s) => s.attach), ...(scenario.review ? scenario.review.changed : [])])].filter((p) => !own.includes(p));
  const branch = scenario.select && scenario.select.branch ? scenario.select.branch : "main";
  // S3: a migration's target folder is not in the seed, so the reset empties it by name (`clean`).
  const clean = [...new Set([...(Array.isArray(scenario.clean) ? scenario.clean : []), ...own.map((p) => path.posix.dirname(p))])];
  const result = await bridgeCommand("scenario-reset", { scenario: scenario.id, paths, branch, clean });
  const ok = Boolean(result && result.success);
  appendRun({ kind: "reset-scenario", scenario: scenario.id, branch, success: ok, seed: ok ? result.seed || null : null, error: ok ? null : (result && result.error) || "unknown" });
  return { success: ok, restored: ok ? result.restored || [] : [], recordsRemoved: ok ? result.recordsRemoved || 0 : 0, durationMs: Date.now() - t0, error: ok ? null : (result && result.error) || "unknown" };
}

/** S5: the documentation check of a program in the workspace against its copy in the image's seed. */
function documentationOf(rel) {
  try {
    const current = readText(resolveInside(WORKSPACE_ROOT, rel));
    const seedRel = rel.startsWith(`${SEED_REPO}/`) ? rel.slice(SEED_REPO.length + 1) : null;
    const seed = seedRel ? readText(path.join(SEED_SOURCE, seedRel)) : { text: null };
    if (current.text === null) return { error: `${rel} is not in the workspace (reset the demo)`, passed: false };
    if (seed.text === null) return { error: `${rel} is not in the image's seed`, passed: false };
    return documentationCheck({ seed: seed.text, current: current.text });
  } catch (err) {
    return { error: err.message, passed: false };
  }
}

/**
 * S6 (S6-D3 (a)): the Python documentation check of the demo's module, run in the IDE (py_doc_check.py), once the comments
 * step has been asked (null before: the tests alone). The code is compared with the module as the comments turn was
 * given it while that turn's change is the latest change applied to the module (DOC-008); after a later change of code
 * (the improve step, the audit's fix) the documentation alone is checked.
 */
async function pythonDocumentationOf(scenario, commentsStep) {
  const win = windowOf(readRuns({ limit: 5000 }), scenario.id);
  const source = commentsStep.comments.source;
  const asked = win.filter((e) => e.kind === "turn" && e.step === commentsStep.id && e.success === true);
  if (asked.length === 0) return null;
  const lastComments = asked[asked.length - 1];
  const applies = win.filter((e) => e.kind === "apply" && e.ok === true && e.path === source);
  const lastApply = applies[applies.length - 1] || null;
  const appliedFrom = lastApply
    ? win.filter((e) => e.kind === "turn" && e.success === true && Array.isArray(e.fileOperations) && e.fileOperations.includes(source) && String(e.at) <= String(lastApply.at)).pop() || null
    : null;
  const base = appliedFrom && appliedFrom.turnId === lastComments.turnId && lastComments.commentsBase && typeof lastComments.commentsBase.text === "string" ? lastComments.commentsBase.text : null;
  const r = await bridgeCommand("py-doc-check", { path: source, ...(base !== null ? { before: base } : {}) });
  if (!r || !r.success || !r.check) return { language: "python", error: (r && r.error) || "the check did not run", passed: false };
  if (r.check.error) return { language: "python", error: r.check.error, passed: false };
  return r.check;
}

async function runTests(scenario, command = scenario.commands.tests) {
  if (!command) return { success: false, error: `scenario ${scenario.id} names no test command` };
  const t0 = Date.now();
  const result = await bridgeCommand(command);
  const ran = Boolean(result && result.success);
  // S3: a run whose steps carry roles is summarised from them (which check it reached), the rest from their output.
  const programSteps = ran && Array.isArray(result.steps) ? result.steps : null;
  const programExit = ran ? result.exitCode : null;
  const programSummary = ran ? summariseSteps(result.output, programExit, programSteps) || summariseTestOutput(result.output, programExit) : null;
  // S5: the documentation check joins the run when the demo comments a program; the run passes only when both pass.
  // S6: a Python module's check runs in the IDE, from the comments step on.
  const commentsStep = scenario.steps.find((st) => st.mode === "comments" && st.comments) || null;
  const python = Boolean(commentsStep && commentsStep.comments.language === "python");
  const documentation = ran && commentsStep ? (python ? await pythonDocumentationOf(scenario, commentsStep) : documentationOf(commentsStep.comments.source)) : null;
  const exitCode = !ran ? null : programExit !== 0 ? programExit : documentation && !documentation.passed ? 1 : programExit;
  const steps = documentation
    ? [...(programSteps || []), { role: "documentation", command: python ? "py-doc-check (STD-DOC, the module's syntax tree)" : "documentation check (STD-DOC)", ran: true, exitCode: documentation.passed ? 0 : 1 }]
    : programSteps;
  const summary = documentation ? (python ? summarisePyDocumentation(programSummary, documentation, programExit === 0) : summariseDocumentation(programSummary, documentation, programExit === 0)) : programSummary;
  const passed = ran && exitCode === 0;
  const report = (d) => (python ? pyReportText(d) : d.error ? `Documentation check (STD-DOC): could not run: ${d.error}` : reportText(d));
  const output = !ran ? "" : documentation ? `${String(result.output || "").replace(/\s+$/, "")}\n\n${report(documentation)}\n` : String(result.output || "");
  const durationMs = ran && Number.isFinite(result.durationMs) ? result.durationMs : Date.now() - t0;
  appendRun({
    kind: "test-run",
    scenario: scenario.id,
    command,
    ran,
    exitCode,
    durationMs,
    summary,
    excerpt: output.slice(-4000),
    truncated: ran ? Boolean(result.truncated) : false,
    timedOut: ran ? Boolean(result.timedOut) : false,
    steps,
    documentation: compactDocumentation(documentation),
    error: ran ? null : (result && result.error) || "unknown",
  });
  return {
    success: ran,
    passed,
    documentation: documentation ? compactDocumentation(documentation) : null,
    command,
    exitCode,
    summary,
    durationMs,
    output,
    truncated: ran ? Boolean(result.truncated) : false,
    error: ran ? null : (result && result.error) || "unknown",
    trace: actionTrace(`Run tests (${command})`, {
      category: "test_run",
      title: "Test Run",
      description: ran ? `${command}: ${summary} (exit ${exitCode}).` : `${command} did not run: ${(result && result.error) || "unknown"}`,
      badge: passed ? "PASSED" : ran ? "FAILED" : "NOT RUN",
      badgeType: passed ? "teal" : ran ? "red" : "amber",
      durationMs,
      details: { command, exitCode, summary, truncated: ran ? Boolean(result.truncated) : false, outputTail: output.slice(-2000), error: ran ? null : (result && result.error) || null },
    }),
  };
}

/** A workspace or seed file's text (null when absent, or too large to compare). */
function readText(full) {
  try {
    const st = fs.statSync(full);
    if (!st.isFile() || st.size > DIFF_FILE_MAX) return { text: null, tooLarge: st.isFile() && st.size > DIFF_FILE_MAX };
    return { text: fs.readFileSync(full, "utf8"), tooLarge: false };
  } catch {
    return { text: null, tooLarge: false };
  }
}

/** The code change since the demo's last reset: every applied path, against its seed version (or as a new file). */
function codeChanges(windowEvents) {
  const paths = [...new Set(windowEvents.filter((e) => e.kind === "apply" && e.ok === true && typeof e.path === "string").map((e) => e.path))];
  const out = [];
  for (const p of paths) {
    let current;
    try {
      current = readText(resolveInside(WORKSPACE_ROOT, p));
    } catch {
      continue;
    }
    const seedRel = p.startsWith(`${SEED_REPO}/`) ? p.slice(SEED_REPO.length + 1) : null;
    const seed = seedRel ? readText(path.join(SEED_SOURCE, seedRel)) : { text: null, tooLarge: false };
    if (current.tooLarge || seed.tooLarge) {
      out.push({ path: p, status: "modified", added: null, removed: null, hunks: [], tooLarge: true });
      continue;
    }
    const fd = fileDiff(p, seed.text, current.text);
    if (fd) out.push(fd);
  }
  return out;
}

/** The archived records' JSON files, newest first. */
function archivedRecordFiles() {
  try {
    return fs
      .readdirSync(RECORDS_ARCHIVE)
      .filter((n) => RECORD_NAME_RE.test(n) && n.endsWith(".json"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** A record's summary for the Results panel's list (S4: its kind, its outcome, and whether it is the shipped example). */
function summaryOf(j, name) {
  const lastTest = Array.isArray(j.tests) && j.tests.length ? j.tests[j.tests.length - 1] : null;
  const files = j.changes && Array.isArray(j.changes.files) ? j.changes.files : [];
  return {
    id: j.id,
    name,
    createdAt: j.createdAt,
    scenario: j.scenario,
    kind: j.kind || "change",
    outcome: j.outcome ? j.outcome.status : null,
    example: Boolean(j.example),
    tests: lastTest ? { exitCode: lastTest.exitCode, summary: lastTest.summary } : null,
    files: { count: files.length, added: files.reduce((n, f) => n + (f.added || 0), 0), removed: files.reduce((n, f) => n + (f.removed || 0), 0) },
    rules: Array.isArray(j.rules) ? j.rules.length : 0,
    approval: j.approval ? j.approval.status : null,
    // S6-D6 (a): the commit that carried the record, when the presenter committed it.
    commit: j.commit && j.commit.commit ? { branch: j.commit.branch || null, commit: String(j.commit.commit).slice(0, 12) } : null,
  };
}

function recordSummary(name) {
  try {
    return summaryOf(JSON.parse(fs.readFileSync(path.join(RECORDS_ARCHIVE, name), "utf8")), name);
  } catch {
    return null;
  }
}

/**
 * PR B: the Results panel's read-only actions. Every demo's list ends with the shipped example record (S4-D2 (a)),
 * marked as an example; a single demo's list holds that demo's own records only.
 */
function listRecords(body) {
  const only = typeof body.scenarioId === "string" ? body.scenarioId : null;
  const list = archivedRecordFiles()
    .map(recordSummary)
    .filter((r) => r && (!only || (r.scenario && r.scenario.id === only)))
    .slice(0, 50);
  if (!only) list.push(summaryOf(loadExampleRecord(), "example"));
  return { success: true, records: list };
}

function readRecord(body) {
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f]{8}$/.test(id)) return { success: false, error: "a record id is required", status: 400 };
  const example = loadExampleRecord();
  if (id === example.id) return { success: true, name: "example", json: example, markdown: renderMarkdown(example) };
  const name = archivedRecordFiles().find((n) => n.endsWith(`-${id}.json`));
  if (!name) return { success: false, error: `record ${id} is not in the archive`, status: 404 };
  try {
    const json = JSON.parse(fs.readFileSync(path.join(RECORDS_ARCHIVE, name), "utf8"));
    const mdName = name.replace(/\.json$/, ".md");
    const markdown = fs.existsSync(path.join(RECORDS_ARCHIVE, mdName)) ? fs.readFileSync(path.join(RECORDS_ARCHIVE, mdName), "utf8") : null;
    return { success: true, name, json, markdown };
  } catch (err) {
    return { success: false, error: `record ${id} could not be read: ${err.message}`, status: 500 };
  }
}

function listOutputs() {
  const out = [];
  const walk = (rel, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(resolveInside(WORKSPACE_ROOT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child, depth + 1);
      else if (/\.(md|json)$/i.test(e.name) && !RECORD_NAME_RE.test(e.name)) out.push({ path: child, name: e.name, kind: e.name.toLowerCase().endsWith(".json") ? "json" : "markdown" });
    }
  };
  walk(OUTPUTS_DIR, 0);
  return { success: true, outputs: out.slice(0, 100) };
}

function readOutput(body) {
  const rel = safeRelativePath(body.path);
  if (!rel || !rel.startsWith(`${OUTPUTS_DIR}/`) || !/\.(md|json)$/i.test(rel)) return { success: false, error: `only Markdown or JSON files under ${OUTPUTS_DIR} can be read`, status: 400 };
  try {
    const r = readText(resolveInside(WORKSPACE_ROOT, rel));
    if (r.text === null) return { success: false, error: r.tooLarge ? "the file is too large" : `${rel} is not in the workspace`, status: 404 };
    return { success: true, path: rel, kind: rel.toLowerCase().endsWith(".json") ? "json" : "markdown", text: r.text };
  } catch (err) {
    return { success: false, error: `refused: ${err.message}`, status: 400 };
  }
}

async function record(scenario, { failed = false } = {}) {
  const t0 = Date.now();
  const recordId = crypto.randomBytes(4).toString("hex");
  const date = new Date().toISOString().slice(0, 10);
  const base = `${SEED_REPO}/compliance/records/${date}-${scenario.id}-${recordId}`;
  // S4-D4 (a): an answer changes no code, and the workspace still holds the last demo's change: it is not this record's.
  const answer = recordKind(scenario) === "answer";
  if (answer && failed) return { success: false, error: "this demo changes no code, so it has no failed attempt to record" };
  const diff = answer ? null : await bridgeCommand("git-diff-stat");
  const status = answer ? null : await bridgeCommand("git-status");
  const changes = answer
    ? null
    : {
        available: Boolean(diff && diff.success && status && status.success),
        gitDiffStat: diff && diff.success ? diff.output || "" : null,
        gitStatus: status && status.success ? status.output || "" : null,
      };
  const events = readRuns({ limit: 5000 });
  // S3-D14 (b) of 2026-10-12: a failed attempt is recorded only when a step of this demo really failed its tests.
  let failure = null;
  if (failed) {
    const failing = stepStates(scenario, events).steps.find((s) => s.tests && s.tests.state === "failed");
    if (!failing) return { success: false, error: "no step of this demo has failing tests: record the change once they pass" };
    failure = { step: failing.id, at: failing.tests.at, exitCode: failing.tests.exitCode, summary: failing.tests.summary };
  }
  // PR B (D1 (b)): the code change, file by file, against the seed: every file applied since the demo's last reset.
  if (changes) changes.files = codeChanges(eventsSinceReset(events, scenario.id));
  const models = [...new Set(events.filter((e) => e.kind === "turn" && e.scenario === scenario.id).map((e) => e.model).filter(Boolean))];
  // S2: the latest review in this demo's window, its tool findings re-checked on the workspace as it stands now.
  let review = null;
  if (scenario.review) {
    const last = [...eventsSinceReset(events, scenario.id)].reverse().find((e) => e.kind === "turn" && e.success === true && e.review);
    if (last) review = statusAfterFix(last.review, scanChange(changeOf(scenario)), { repoPrefix: REVIEW_PREFIX });
  }
  const build = readBuildInfo().build;
  const manifest = loadManifest();
  const { json, markdown } = buildEvidenceRecord({
    scenario,
    events,
    changes,
    platform: { appTreeHash: build.srcTreeHash || null, models, store: null },
    firm: manifest.firm,
    recordId,
    review,
    failed: failure,
    // Polish Phase 3: the prices in force now, stamped into the record with the cost.
    pricing: readPricing(),
  });
  const files = [
    [`${base}.json`, `${JSON.stringify(json, null, 2)}\n`],
    [`${base}.md`, markdown],
  ];
  let wroteVia = "bridge";
  const viaBridge = [];
  for (const [rel, content] of files) viaBridge.push(await bridgeAction({ type: "writeFile", path: rel, content }));
  if (!viaBridge.every((r) => r && r.success)) {
    // The bridge is offline: write through the app's own workspace mount, group-writable so the IDE user can remove it.
    for (const [rel, content] of files) {
      // mkdir's and write's own modes are masked by the umask: writeGroupWritable chmods what it makes (2026-10-12).
      writeGroupWritable(resolveInside(WORKSPACE_ROOT, rel), content);
    }
    wroteVia = "app";
  }
  const paths = files.map(([rel]) => rel);
  // PR B (D3): the same record in the archive beside the run log, which no reset touches.
  const archived = [];
  let archiveError = null;
  try {
    fs.mkdirSync(RECORDS_ARCHIVE, { recursive: true });
    for (const [rel, content] of files) {
      const name = path.basename(rel);
      fs.writeFileSync(path.join(RECORDS_ARCHIVE, name), content, "utf8");
      archived.push(name);
    }
  } catch (err) {
    archiveError = err.message;
  }
  appendRun({ kind: "record", scenario: scenario.id, recordId, paths, wroteVia, archived, archiveError, outcome: failure ? "failed" : "ready", recordKind: json.kind });
  const durationMs = Date.now() - t0;
  const summary = { turns: json.turns.length, tests: json.tests.length, rules: json.rules.length, unverified: json.turns.reduce((n, t) => n + t.unverifiedMarkers.length, 0) };
  return {
    success: true,
    recordId,
    paths,
    wroteVia,
    archived,
    summary,
    outcome: failure ? "failed" : "ready",
    kind: json.kind,
    durationMs,
    trace: actionTrace(`${failure ? "Record the failed attempt" : answer ? "Record the answer" : "Record the change"} (${scenario.id.toUpperCase()})`, {
      category: "evidence_record",
      title: "Evidence Record",
      description: `Record ${recordId}: ${summary.turns} turn(s), ${summary.tests} test run(s), ${summary.rules} rule(s) cited${summary.unverified ? `, ${summary.unverified} unverified marker(s)` : ""}${review ? `; review ${review.outcome}, ${review.findings.filter((f) => f.status === "fixed").length} finding(s) fixed` : ""}${failure ? `; not ready for review: the tests failed (${failure.summary || `exit code ${failure.exitCode}`})` : "; approval pending"}.`,
      badge: failure ? "FAILED ATTEMPT" : "RECORDED",
      badgeType: failure ? "amber" : "teal",
      durationMs,
      details: { recordId, paths, wroteVia, kind: json.kind, ...summary, changesAvailable: changes ? changes.available : null },
    }),
  };
}

/** The ticket's title, from its first heading in the image's seed ("# DSP-2026-03: Record …" gives "Record …"). */
function ticketTitle(scenario) {
  const rel = scenario.ticket.path.startsWith(`${SEED_REPO}/`) ? scenario.ticket.path.slice(SEED_REPO.length + 1) : null;
  const text = rel ? readText(path.join(SEED_SOURCE, rel)).text : null;
  const m = text ? text.match(/^#\s+(.+)$/m) : null;
  return m ? m[1].replace(new RegExp(`^${scenario.ticket.id}\\s*[:—-]\\s*`), "").trim() : scenario.title;
}

/** The archived record's JSON by id, or null. */
function archivedRecord(recordId) {
  const name = archivedRecordFiles().find((n) => n.endsWith(`-${recordId}.json`));
  if (!name) return null;
  try {
    return { name, json: JSON.parse(fs.readFileSync(path.join(RECORDS_ARCHIVE, name), "utf8")) };
  } catch {
    return null;
  }
}

/**
 * S6-D6 (a) of 2026-10-13: the presenter's Commit. Refused until the record step is done (the commit carries the record
 * that completed it). The commit step's files and that record's two files go on the step's feature branch, committed as
 * the engineer the presenter plays and pushed to the Bank's repository in the pod (the bridge's bank-commit). The message
 * is built from the record, never by the model. The committed record cannot name its own commit, so the archive's copy
 * gains it afterwards (`commit`, and its Markdown again), and the Results panel shows it.
 */
async function commitChange(scenario) {
  const t0 = Date.now();
  const step = scenario.steps.find((st) => st.action === "commit") || null;
  if (!step || !step.commit) return { success: false, error: `scenario ${scenario.id} has no commit step`, status: 400 };
  const events = readRuns({ limit: 5000 });
  const states = stepStates(scenario, events);
  const st = states.steps.find((x) => x.id === step.id) || null;
  const recordStep = states.steps.filter((x) => x.action === "record" && x.complete).pop() || null;
  const rec = recordStep && recordStep.record ? recordStep.record : null;
  if (!st || !st.unlocked || !rec || !rec.recordId || rec.paths.length === 0) return { success: false, error: "Record the change first: the commit carries its evidence record", status: 409 };
  const archived = archivedRecord(rec.recordId);
  const models = [...new Set(eventsSinceReset(events, scenario.id).filter((e) => e.kind === "turn" && e.success === true).map((e) => e.model).filter(Boolean))];
  const paths = [...step.commit.paths, ...rec.paths];
  const message = commitMessage({
    ticket: scenario.ticket.id,
    title: ticketTitle(scenario),
    paths: paths.map((p) => (p.startsWith(`${SEED_REPO}/`) ? p.slice(SEED_REPO.length + 1) : p)),
    record: archived ? archived.json : { id: rec.recordId },
    models,
  });
  const r = await bridgeCommand("bank-commit", { branch: step.commit.branch, paths, message, author: step.commit.author });
  const ok = Boolean(r && r.success && r.commit);
  const at = new Date().toISOString();
  const committed = ok
    ? { at, branch: r.branch, commit: r.commit, author: `${step.commit.author.name} <${step.commit.author.email}>`, repository: "the Bank's repository (remote bank, a bare repository in the pod)", files: Array.isArray(r.files) ? r.files : [], bankLog: Array.isArray(r.bankLog) ? r.bankLog : [], message }
    : null;
  let annotated = false;
  let annotateError = null;
  if (ok && archived) {
    try {
      const json = { ...archived.json, commit: { ...committed, note: "Added to the archive's copy after the commit: the record committed with the change cannot name its own commit." } };
      fs.writeFileSync(path.join(RECORDS_ARCHIVE, archived.name), `${JSON.stringify(json, null, 2)}\n`, "utf8");
      fs.writeFileSync(path.join(RECORDS_ARCHIVE, archived.name.replace(/\.json$/, ".md")), renderMarkdown(json), "utf8");
      annotated = true;
    } catch (err) {
      annotateError = err.message;
    }
  }
  appendRun({ kind: "commit", scenario: scenario.id, step: step.id, success: ok, recordId: rec.recordId, branch: step.commit.branch, commit: ok ? r.commit : null, paths, author: step.commit.author, files: ok ? committed.files : null, bankLog: ok ? committed.bankLog : null, rebuilt: ok ? Boolean(r.rebuilt) : null, annotated, annotateError, error: ok ? null : (r && r.error) || "unknown" });
  const durationMs = Date.now() - t0;
  const short = ok ? String(r.commit).slice(0, 7) : null;
  return {
    success: ok,
    commit: ok ? r.commit : null,
    branch: step.commit.branch,
    recordId: rec.recordId,
    files: ok ? committed.files : [],
    bankLog: ok ? committed.bankLog : [],
    rebuilt: ok ? Boolean(r.rebuilt) : false,
    message,
    durationMs,
    error: ok ? null : (r && r.error) || "unknown",
    trace: actionTrace(`Commit to the Bank repository (${scenario.id.toUpperCase()})`, {
      category: "evidence_record",
      title: "Commit",
      description: ok
        ? `Commit ${short} on ${step.commit.branch} by ${step.commit.author.name}: ${committed.files.length} file(s), the evidence record ${rec.recordId} among them, pushed to the Bank's repository in the pod${r.rebuilt ? " (made again from the seed's main first: the pod had restarted)" : ""}. Labelled AI-assisted; review and approval pending (REV-005).`
        : `The commit failed: ${(r && r.error) || "unknown"}`,
      badge: ok ? "COMMITTED" : "COMMIT FAILED",
      badgeType: ok ? "teal" : "red",
      durationMs,
      details: { branch: step.commit.branch, commit: ok ? r.commit : null, recordId: rec.recordId, paths, files: ok ? committed.files : null, bankLog: ok ? committed.bankLog : null, annotated, annotateError, steps: r && r.steps ? r.steps : null, error: ok ? null : (r && r.error) || null },
    }),
  };
}

/**
 * Select demo (presenter panels design §3): refuse while the bridge is offline; the scenario's reset unless its
 * definition says `select.reset: false` (the closer must never wipe the record it shows); Start; one `select` line in
 * the run log, which starts a new window for the step states.
 */
async function select(scenario) {
  const t0 = Date.now();
  const health = await getBridgeHealth();
  if (!health) return { success: false, error: "Open the IDE panel: the bridge starts with it.", code: "BRIDGE_OFFLINE" };
  let reset = null;
  if (scenario.select && scenario.select.reset) {
    reset = await resetScenario(scenario);
    if (!reset.success) return { success: false, error: `the demo's reset failed: ${reset.error}`, reset };
  }
  const started = await start(scenario);
  // S2: the pull request's changed files open as diffs against its base branch (S6's review reads its own new files).
  let diffs = null;
  if (started.success && scenario.review && scenario.review.branch) {
    const r = await bridgeAction({ type: "showBranchDiff", base: scenario.review.base, branch: scenario.review.branch, paths: scenario.review.changed });
    diffs = { shown: r && r.success ? r.shown || 0 : 0, error: r && r.success ? null : (r && r.error) || "not shown" };
  }
  appendRun({ kind: "select", scenario: scenario.id, reset: Boolean(reset), diffs, success: started.success, error: started.success ? null : started.error });
  // The failure the ticket reports, reproduced once (inside the new window, before any answer: it satisfies no step).
  // S3: Select may run its own command (the legacy check alone: no port exists yet).
  const selectCommand = scenario.commands.select || scenario.commands.tests;
  const tests = started.success && scenario.select && scenario.select.runTests && selectCommand ? await runTests(scenario, selectCommand) : null;
  const progress = stepStates(scenario, readRuns({ limit: 5000 }));
  const durationMs = Date.now() - t0;
  const label = scenario.id.toUpperCase();
  return {
    success: started.success,
    error: started.success ? null : started.error,
    reset: reset ? { restored: reset.restored, recordsRemoved: reset.recordsRemoved } : null,
    opened: started.opened,
    tests: tests ? { ran: tests.success, passed: tests.passed, exitCode: tests.exitCode, summary: tests.summary, command: tests.command, error: tests.error } : null,
    progress,
    durationMs,
    testTrace: tests && tests.trace ? tests.trace : null,
    trace: actionTrace(`Select demo (${label})`, {
      category: "ide_context",
      title: "Select Demo",
      description: started.success
        ? `${label} is set up: ${reset ? `${reset.restored.length} path(s) restored, ${reset.recordsRemoved} record file(s) removed; ` : ""}${started.opened.length} file(s) opened in the IDE.`
        : `Select demo failed: ${started.error}`,
      badge: started.success ? "SELECTED" : "SELECT FAILED",
      badgeType: started.success ? "teal" : "red",
      durationMs,
      details: { scenario: scenario.id, reset: reset ? { restored: reset.restored, recordsRemoved: reset.recordsRemoved } : null, opened: started.opened, steps: progress.steps.map((st) => `${st.id}: ${st.status}`) },
    }),
  };
}

/**
 * S4-D2 (a) of 2026-10-12: the record the closer opens: the newest record another demo wrote since the environment's
 * last reset whose file is in the archive, else the shipped example record. One results-shown line in the run log
 * completes the demo's results step.
 */
function resultsShown(scenario) {
  if (!scenario.steps.some((st) => st.action === "results")) return { success: false, error: `scenario ${scenario.id} has no step that shows a record`, status: 400 };
  const latest = latestRecordSince(readRuns({ limit: 5000 }), { exclude: scenario.id, archivedNames: archivedRecordFiles() });
  const example = latest ? null : loadExampleRecord();
  const recordId = latest ? latest.recordId : example.id;
  const of = latest ? latest.scenario : example.scenario.id;
  appendRun({ kind: "results-shown", scenario: scenario.id, recordId, example: !latest, of });
  return { success: true, recordId, example: !latest, of };
}

/** S4: the document chat answered a demo's doc step (the page reports it: the RAG engine writes no coding run log). */
const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
/** Polish Phase 2 (PL-D8 (a)): a document chat answer's tokens as the page received them with the turn's timing. */
const tokensOf = (t) => (t && typeof t === "object" && (num(t.prompt) !== null || num(t.completion) !== null) ? { prompt: num(t.prompt), completion: num(t.completion), providerReported: t.providerReported === true } : null);
const modelOf = (m) => (typeof m === "string" && m ? m.slice(0, 120) : null);

function docTurn(scenario, body) {
  const step = scenario.steps.find((st) => st.id === body.stepId) || null;
  if (!step || step.mode !== "doc") return { success: false, error: `step ${body.stepId || "(none)"} of ${scenario.id} is not a doc step`, status: 400 };
  appendRun({
    kind: "doc-turn",
    scenario: scenario.id,
    step: step.id,
    success: body.success === true,
    prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 2000) : null,
    citations: num(body.citations),
    clientMs: num(body.clientMs),
    error: typeof body.error === "string" ? body.error.slice(0, 300) : null,
    // Polish Phase 2: the model and its tokens, for the usage figures.
    model: modelOf(body.model),
    tokens: tokensOf(body.tokens),
  });
  return { success: true };
}

/**
 * Polish Phase 2 (PL-D8 (a)): a document chat answer outside a doc step, logged for the usage figures with the active
 * demo when there is one (it then counts as a free-form answer in that demo) or none.
 */
function chatTurn(scenario, body) {
  appendRun({
    kind: "chat-turn",
    scenario: scenario ? scenario.id : null,
    step: null,
    success: body.success === true,
    prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 2000) : null,
    citations: num(body.citations),
    clientMs: num(body.clientMs),
    model: modelOf(body.model),
    tokens: tokensOf(body.tokens),
  });
  return { success: true };
}

/** The price table as stored, or the empty table (no file yet, or one that does not parse): never a thrown read. */
function readPricing() {
  try {
    return normalisePricing(JSON.parse(fs.readFileSync(PRICING_FILE, "utf8"))).pricing;
  } catch {
    return EMPTY_PRICING;
  }
}

/** Polish Phase 3: the table, and the models the run log has seen, for the Misc tab to seed its rows. */
function pricingRead() {
  const seen = [...new Set(readRuns({ limit: 5000 }).filter((e) => ANSWER_KINDS.includes(e.kind) && typeof e.model === "string" && e.model).map((e) => e.model))];
  return { success: true, pricing: readPricing(), seen, stored: fs.existsSync(PRICING_FILE) };
}

/** Polish Phase 3: the table written as given, normalised; invalid rows are named back, never written. */
function pricingWrite(body) {
  const { pricing, invalid } = normalisePricing(body && body.pricing);
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(PRICING_FILE, `${JSON.stringify(pricing, null, 2)}\n`, "utf8");
  } catch (err) {
    return { success: false, error: `the price table could not be written: ${err.message}`, status: 500 };
  }
  appendRun({ kind: "pricing", currency: pricing.currency, models: Object.keys(pricing.models).length, default: Boolean(pricing.default) });
  return { success: true, pricing, invalid };
}

/** Polish Phase 2 (PL-D7 (a), PL-D9 (a)): the session's and the active demo's token usage, from the run log, costed (Phase 3). */
function usageOf(scenario, scenarios) {
  return priceUsage(usageSummary(readRuns({ limit: 5000 }), { scenarioId: scenario ? scenario.id : null, scenarios }), readPricing());
}

const SHOW_LINE_MAX = 100000;

/** A change turn's proposed file, shown again as a diff in the IDE: the content comes from the run log's answer. */
async function showProposal(body) {
  const turnId = typeof body.turnId === "string" ? body.turnId : "";
  const rel = safeRelativePath(body.path);
  if (!turnId || !rel) return { success: false, error: "a turn id and a relative path are required", status: 400 };
  const turn = readRuns({ limit: 5000, filter: (e) => e.kind === "turn" && e.turnId === turnId }).pop();
  if (!turn) return { success: false, error: `no turn ${turnId} in the run log`, status: 404 };
  const op = parseFileOperations(turn.answer || "").operations.find((o) => o.path === rel);
  if (!op || turn.mode === "explain") return { success: false, error: `turn ${turnId} proposed no change to ${rel}`, status: 404 };
  // S3-D13 (a): a migration's new file opens beside the file its step pairs it with (the run log names the step).
  const scenarioDef = loadScenarios().find((s) => s.id === turn.scenario);
  const stepDef = scenarioDef ? scenarioDef.steps.find((s) => s.id === turn.step) : null;
  // S5-D14 (a): a comments turn's file as it was proposed, after a tool put its code lines back (the answer as written
  // stays in the run log).
  const kept = turn.codeKept && turn.codeKept.path === rel && typeof turn.codeKept.content === "string" ? turn.codeKept.content : null;
  const r = await bridgeAction({ type: "showProposal", path: op.path, content: kept || op.content, ...(proposalView(stepDef, op.path) || {}) });
  return r && r.success ? { success: true, path: op.path, isNew: Boolean(r.isNew), view: r.view || "diff" } : { success: false, error: (r && r.error) || "the IDE did not show it" };
}

/** A workspace file opened in the IDE with lines startLine to endLine selected. */
async function reveal(body) {
  const rel = safeRelativePath(body.path);
  const startLine = Number(body.startLine);
  const endLine = Number(body.endLine || body.startLine);
  if (!rel || !Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > SHOW_LINE_MAX) {
    return { success: false, error: "a relative path and a line range are required", status: 400 };
  }
  try {
    if (!fs.existsSync(resolveInside(WORKSPACE_ROOT, rel))) return { success: false, error: `${rel} is not in the workspace`, status: 404 };
  } catch (err) {
    return { success: false, error: `refused: ${err.message}`, status: 400 };
  }
  const r = await bridgeAction({ type: "openFile", path: rel, line: startLine, endLine });
  return r && r.success ? { success: true, path: rel, startLine, endLine } : { success: false, error: (r && r.error) || "the IDE did not open it" };
}

export async function GET() {
  return NextResponse.json({ scenarios: loadScenarios().map(cardOf) });
}

export async function POST(request) {
  let body;
  try {
    body = (await request.json()) || {};
  } catch {
    return NextResponse.json({ success: false, error: "the request body is not JSON" }, { status: 400 });
  }
  const scenarios = loadScenarios();
  const action = typeof body.action === "string" ? body.action : "";
  const scenario = typeof body.scenarioId === "string" ? scenarios.find((s) => s.id === body.scenarioId) || null : null;
  if (["start", "select", "reset-scenario", "run-tests", "record", "results-shown", "doc-turn", "commit"].includes(action) && !scenario) {
    return NextResponse.json({ success: false, error: `unknown scenario: ${body.scenarioId || "(none)"}` }, { status: 400 });
  }
  try {
    switch (action) {
      case "state":
        return NextResponse.json(await stateOf(body, scenarios));
      case "start":
        return NextResponse.json(await start(scenario));
      case "reset-all":
        return NextResponse.json(await resetAll());
      case "reset-scenario":
        return NextResponse.json(await resetScenario(scenario));
      case "run-tests":
        return NextResponse.json(await runTests(scenario));
      case "record":
        return NextResponse.json(await record(scenario, { failed: body.outcome === "failed" }));
      case "select":
        return NextResponse.json(await select(scenario));
      case "commit": {
        const { status, ...rest } = await commitChange(scenario);
        return NextResponse.json(rest, { status: status || (rest.success ? 200 : 502) });
      }
      case "results-shown":
      case "doc-turn": {
        const r = action === "results-shown" ? resultsShown(scenario) : docTurn(scenario, body);
        const { status, ...rest } = r;
        return NextResponse.json(rest, { status: status || 200 });
      }
      case "chat-turn":
        return NextResponse.json(chatTurn(scenario, body));
      case "usage":
        return NextResponse.json(usageOf(scenario, scenarios));
      case "pricing-read":
        return NextResponse.json(pricingRead());
      case "pricing-write": {
        const { status, ...rest } = pricingWrite(body);
        return NextResponse.json(rest, { status: status || 200 });
      }
      case "records":
      case "record-read":
      case "outputs":
      case "output-read": {
        const r = action === "records" ? listRecords(body) : action === "record-read" ? readRecord(body) : action === "outputs" ? listOutputs() : readOutput(body);
        const { status, ...rest } = r;
        return NextResponse.json(rest, { status: status || 200 });
      }
      case "show-proposal":
      case "reveal": {
        const r = action === "reveal" ? await reveal(body) : await showProposal(body);
        const { status, ...rest } = r;
        return NextResponse.json(rest, { status: status || (rest.success ? 200 : 502) });
      }
      default:
        return NextResponse.json({ success: false, error: `unknown action: ${action || "(none)"}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[Scenarios API] Error:", err);
    return NextResponse.json({ success: false, error: `Internal server error: ${err.message}` }, { status: 500 });
  }
}
