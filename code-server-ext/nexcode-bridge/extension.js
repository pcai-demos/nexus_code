// NexCODE Bridge Extension
// Exposes IDE state (active file, open tabs, selections) via a lightweight
// HTTP server on port 9100. Only the Next.js server-side API communicates
// with this endpoint — the browser never touches it directly.
//
// E3 (Enablers PR, audit CA-002, 2026-10-06): the server binds the pod's
// loopback address only (the app container shares the pod's network
// namespace), every request must carry the header X-NexCODE-Bridge equal to
// NEXCODE_BRIDGE_TOKEN (rendered into both containers by the Helm chart),
// and the path of openFile / writeFile / applyEdit is contained under the
// workspace before it is used. With no token in the environment the bridge
// answers 503 to everything (fail closed) and says so once in the log.
//
// Session 88 (2026-10-06; evidence: inputs/demo-design/evidence/session-88-bridge-check/findings.md): one port per
// pod, one extension host per IDE browser window. The old retry closed whatever `server` pointed at AND re-armed a
// start from the `close` handler, so every failed bind scheduled two more: when another window's host still held
// the port, the attempts doubled every 3 s and the extension host was OOM-killed (the IDE container's 4 GiB limit)
// three times in four minutes. Now at most ONE retry is ever pending; `close` is handled only on a server that
// listened; a freshly activated host asks the holder to yield once (POST /api/yield, behind the same header gate) so
// the newest window takes the port at once; and a host that yielded is on standby (a slow retry that never asks for
// a yield), so two hosts cannot take the port back and forth.
//
// Presenter flow (2026-10-07: the chat explains, the IDE carries the code): showProposal opens an answer's proposed file
// as a diff against the workspace file (the proposal lives in memory under the nexcode-proposal: scheme; nothing is
// written until Apply; a migration's new file opens beside the file its step pairs it with, S3-D13 (a) of 2026-10-11); openFile can select a range of lines (a diagnosis's location); a command marked showOutput
// (the scenario's tests) prints its output in the IDE's "NexCODE Tests" output panel.
// The two-level reset (2026-10-07, D2 and D3): seed-reset, now only behind "Reset the demo environment", also closes the
// IDE's terminals and bottom panel, clears the test panel and the in-memory proposals, and shows the explorer; a demo's
// own reset (scenario-reset, run by Select demo) restores from the seed commit and moves the branch back to it, so an
// accidental commit in the IDE can never carry into the next demo (the app itself never commits).
//
// S2, the pull request review (the owner's D1 (a) and D2 (a) of 2026-10-09): seed-reset also builds each staged pull
// request as ONE local commit on its own branch (seedgit.js: no remote, nothing pushed), and a demo's reset puts the
// repository on the demo's branch; showBranchDiff opens a pull request's changed files as diffs against its base
// (the base side is `git show base:path`, served in memory under the nexcode-git: scheme); showReview puts each review
// finding on its line as a comment thread (VS Code's comments API), cleared by the IDE clean-up; a command may now be a
// fixed sequence of programs (S2's tests: clear the build, compile, test), still with no shell.
//
// S6, a new component end to end (the owner's S6-D1 to S6-D7 of 2026-10-13): s6-tests runs the new module's tests
// alone (S1's command would run S1's deliberately failing test too); py-doc-check runs the Python documentation check
// (py_doc_check.py, beside this file: the module's syntax tree, read in this container's Python, never imported) and adds
// its findings to the test panel; seed-reset also makes "the Bank's repository" again (a bare repository in the pod,
// the workspace repository's remote `bank`), and bank-commit, the presenter's Commit, commits a demo's named files on a
// feature branch and pushes it there (seedgit.js). The app never commits on its own: Commit is the presenter's click.

const vscode = require("vscode");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const seedgit = require("./seedgit");

// NEXCODE_BRIDGE_PORT / _RETRY_MS / _STANDBY_MS are test seams for tests/unit/u-bridge.test.js; the chart sets none.
const BRIDGE_PORT = Number(process.env.NEXCODE_BRIDGE_PORT) || 9100;
const RETRY_MS = Number(process.env.NEXCODE_BRIDGE_RETRY_MS) || 3000;
const STANDBY_RETRY_MS = Number(process.env.NEXCODE_BRIDGE_STANDBY_MS) || 30000;
const YIELD_RETRY_MS = Math.min(250, RETRY_MS); // after a holder yields: retry well inside its standby interval
const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_HEADER = "x-nexcode-bridge"; // Node lower-cases incoming header names
const BRIDGE_TOKEN = process.env.NEXCODE_BRIDGE_TOKEN || "";
const WORKSPACE_PREFIX = "/home/coder/project";
let warnedNoToken = false;
const PROPOSAL_SCHEME = "nexcode-proposal";
const PROPOSAL_MAX_CHARS = 256 * 1024;
const PROPOSALS_KEPT = 40;
const proposals = new Map(); // "<path>#<seq>" -> content, oldest first
let proposalSeq = 0;
let proposalViewReady = false;
let testOutput = null;
const GIT_SCHEME = "nexcode-git";
let gitViewReady = false;
let gitSeq = 0;
let reviewController = null;
const reviewThreads = [];

/**
 * Contain a caller's relative path under the workspace (the same rule as the
 * app's src/lib/coding/paths.js): a non-empty string, no absolute path, no
 * `..` segment, and the resolved path strictly inside WORKSPACE_PREFIX.
 * Returns the absolute path or throws.
 */
function resolveInWorkspace(relPath) {
  if (typeof relPath !== "string" || relPath.trim() === "" || relPath.includes("\0")) {
    throw new Error("a relative file path is required");
  }
  const normalised = relPath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalised) || /^[A-Za-z]:/.test(normalised)) {
    throw new Error(`an absolute path is refused: ${relPath}`);
  }
  if (normalised.split("/").includes("..")) {
    throw new Error(`a parent segment (..) is refused: ${relPath}`);
  }
  const full = path.resolve(WORKSPACE_PREFIX, normalised);
  if (!full.startsWith(WORKSPACE_PREFIX + path.sep)) {
    throw new Error(`the path does not name a file inside the workspace: ${relPath}`);
  }
  return full;
}

/** true when the request carries the shared token; logs once when none is configured. */
function authorised(req) {
  if (!BRIDGE_TOKEN) {
    if (!warnedNoToken) {
      warnedNoToken = true;
      console.error("[NexCODE Bridge] NEXCODE_BRIDGE_TOKEN is not set: every request is refused (503) until the chart renders it.");
    }
    return false;
  }
  const given = req.headers[BRIDGE_HEADER];
  return typeof given === "string" && given === BRIDGE_TOKEN;
}

let active = null; // the server that is listening, or null
let retryTimeout = null; // the ONE pending retry, or null
let stopped = false; // deactivate() ran
let standby = false; // this host yielded the port to a newer window
let yieldAsked = false; // this activation has asked a holder to yield (logged once)
let holdingSince = null;
let statusBar = null;
const INSTANCE_ID = Math.random().toString(36).slice(2, 10);

/**
 * Gather current IDE state: active editor, open tabs, workspace root.
 */
function getIDEState() {
  const activeEditor = vscode.window.activeTextEditor;
  const openTabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input && tab.input.uri)
    .map((tab) => {
      const uri = tab.input.uri;
      const fullPath = uri.fsPath;
      const relativePath = fullPath.startsWith(WORKSPACE_PREFIX)
        ? fullPath.slice(WORKSPACE_PREFIX.length + 1)
        : fullPath;
      return {
        path: relativePath,
        fullPath: fullPath,
        language: guessLanguage(fullPath),
        isActive: activeEditor
          ? uri.fsPath === activeEditor.document.uri.fsPath
          : false,
      };
    });

  let activeFile = null;
  if (activeEditor) {
    const doc = activeEditor.document;
    const fullPath = doc.uri.fsPath;
    const relativePath = fullPath.startsWith(WORKSPACE_PREFIX)
      ? fullPath.slice(WORKSPACE_PREFIX.length + 1)
      : fullPath;

    // Get the current selection (if any)
    const selection = activeEditor.selection;
    const selectedText = doc.getText(selection);

    activeFile = {
      path: relativePath,
      fullPath: fullPath,
      language: doc.languageId,
      content: doc.getText(),
      lineCount: doc.lineCount,
      selection: {
        startLine: selection.start.line + 1,
        endLine: selection.end.line + 1,
        text: selectedText,
      },
      isDirty: doc.isDirty,
    };
  }

  return {
    activeFile,
    openTabs,
    workspaceRoot: WORKSPACE_PREFIX,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Guess language from file extension for tabs without a document.
 */
function guessLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".py": "python",
    ".js": "javascript",
    ".ts": "typescript",
    ".java": "java",
    ".go": "go",
    ".c": "c",
    ".cpp": "cpp",
    ".rs": "rust",
    ".f90": "fortran",
    ".cob": "cobol",
    ".pas": "pascal",
    ".rb": "ruby",
    ".pl": "perl",
    ".sh": "shellscript",
    ".md": "markdown",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".html": "html",
    ".css": "css",
    ".sql": "sql",
    ".dockerfile": "dockerfile",
  };
  return map[ext] || "plaintext";
}

/**
 * Handle incoming action requests (openFile, writeFile, applyEdit, showProposal).
 */
async function handleAction(action) {
  switch (action.type) {
    case "openFile": {
      const fullPath = resolveInWorkspace(action.path);
      const uri = vscode.Uri.file(fullPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      if (action.line) {
        const line = Math.max(0, Math.min(action.line - 1, doc.lineCount - 1));
        if (Number.isInteger(action.endLine) && action.endLine > action.line) {
          // A location (startLine-endLine): select the whole lines so the audience sees them.
          const last = Math.min(action.endLine - 1, doc.lineCount - 1);
          const range = new vscode.Range(line, 0, last, doc.lineAt(last).text.length);
          editor.selection = new vscode.Selection(range.start, range.end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        } else {
          const range = new vscode.Range(line, 0, line, 0);
          editor.selection = new vscode.Selection(range.start, range.start);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
      }
      return { success: true, action: "openFile", path: action.path };
    }

    case "writeFile": {
      const fullPath = resolveInWorkspace(action.path);
      const dir = path.dirname(fullPath);

      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, action.content, "utf-8");

      // Open the newly written file in the editor
      const uri = vscode.Uri.file(fullPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      return { success: true, action: "writeFile", path: action.path };
    }

    case "applyEdit": {
      const fullPath = resolveInWorkspace(action.path);
      const uri = vscode.Uri.file(fullPath);
      let doc;
      try {
        doc = await vscode.workspace.openTextDocument(uri);
      } catch {
        return { success: false, error: `File not found: ${action.path}` };
      }

      const editor = await vscode.window.showTextDocument(doc);

      // Convert 1-indexed line numbers to 0-indexed Range
      const startLine = Math.max(0, (action.startLine || 1) - 1);
      const endLine = Math.max(startLine, (action.endLine || startLine + 1) - 1);
      const range = new vscode.Range(
        startLine,
        0,
        endLine,
        doc.lineAt(Math.min(endLine, doc.lineCount - 1)).text.length
      );

      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, range, action.content);
      const applied = await vscode.workspace.applyEdit(edit);

      if (applied) {
        // Save the document after applying edits
        await doc.save();
      }

      return {
        success: applied,
        action: "applyEdit",
        path: action.path,
        linesModified: `${action.startLine}-${action.endLine}`,
      };
    }

    case "showProposal": {
      const fullPath = resolveInWorkspace(action.path);
      const content = typeof action.content === "string" ? action.content : "";
      if (content.length > PROPOSAL_MAX_CHARS) return { success: false, error: `the proposal is longer than ${PROPOSAL_MAX_CHARS} characters` };
      if (!proposalViewReady) return { success: false, error: "the proposal view is not available in this IDE window" };
      const rel = action.path.replace(/\\/g, "/");
      const seq = String(++proposalSeq);
      proposals.set(`${rel}#${seq}`, content);
      while (proposals.size > PROPOSALS_KEPT) proposals.delete(proposals.keys().next().value);
      const right = vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${rel}`, query: seq });
      const isNew = !fs.existsSync(fullPath);
      // S3-D13 (a) of 2026-10-11: a migration's NEW file opens beside the workspace file its step pairs it with (the port
      // beside the program it replaces, the characterisation test beside the report it checks), as two plain editors: a
      // diff between two languages would mark every line. Its other new files open alone. An existing file (a repair's
      // fix to an applied port) stays a diff against it, so the fix reads as a fix.
      if (isNew && typeof action.beside === "string" && action.beside) {
        const besideRel = action.beside.replace(/\\/g, "/");
        const besidePath = resolveInWorkspace(besideRel);
        try {
          const partner = await vscode.workspace.openTextDocument(vscode.Uri.file(besidePath));
          await vscode.window.showTextDocument(partner, { viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: true });
          const proposed = await vscode.workspace.openTextDocument(right);
          await vscode.window.showTextDocument(proposed, { viewColumn: vscode.ViewColumn.Two, preview: false });
          return { success: true, action: "showProposal", path: action.path, isNew, view: "beside", beside: besideRel };
        } catch (err) {
          console.error(`[NexCODE Bridge] ${besideRel} could not be opened beside ${rel} (${err.message}): showing the diff`);
        }
      }
      if (isNew && action.alone === true) {
        const proposed = await vscode.workspace.openTextDocument(right);
        await vscode.window.showTextDocument(proposed, { preview: false });
        return { success: true, action: "showProposal", path: action.path, isNew, view: "alone" };
      }
      const left = isNew ? vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: `/${rel}`, query: "empty" }) : vscode.Uri.file(fullPath);
      const title = `${path.basename(rel)}: ${isNew ? "new file" : "current"} vs proposed by NexCODE`;
      await vscode.commands.executeCommand("vscode.diff", left, right, title, { preview: false });
      return { success: true, action: "showProposal", path: action.path, isNew, view: "diff" };
    }

    case "showBranchDiff": {
      if (!gitViewReady) return { success: false, error: "the branch diff view is not available in this IDE window" };
      const base = typeof action.base === "string" && action.base ? action.base : "main";
      if (!seedgit.BRANCH_NAME.test(base)) return { success: false, error: `not a branch name: ${base}` };
      const label = typeof action.branch === "string" && seedgit.BRANCH_NAME.test(action.branch) ? action.branch : "the pull request";
      const paths = Array.isArray(action.paths) ? action.paths.slice(0, 20) : [];
      let shown = 0;
      const errors = [];
      for (const p of paths) {
        try {
          const fullPath = resolveInWorkspace(p);
          const rel = String(p).replace(/\\/g, "/");
          if (!rel.startsWith(`${SEED_REPO}/`)) throw new Error("not a path in the seed repository");
          const repoRel = rel.slice(SEED_REPO.length + 1);
          const left = vscode.Uri.from({ scheme: GIT_SCHEME, path: `/${repoRel}`, query: `ref=${encodeURIComponent(base)}&n=${++gitSeq}` });
          const right = vscode.Uri.file(fullPath);
          await vscode.commands.executeCommand("vscode.diff", left, right, `${path.basename(repoRel)}: ${base} vs ${label}`, { preview: false });
          shown += 1;
        } catch (err) {
          errors.push(`${p}: ${err.message}`);
        }
      }
      return { success: shown > 0, action: "showBranchDiff", shown, errors };
    }

    case "showReview": {
      if (!reviewController) return { success: false, error: "review comments are not available in this IDE window" };
      clearReviewThreads();
      const findings = Array.isArray(action.findings) ? action.findings.slice(0, 40) : [];
      let threads = 0;
      const errors = [];
      for (const f of findings) {
        try {
          const fullPath = resolveInWorkspace(f.path);
          const line = Math.max(0, (Number(f.line) || 1) - 1);
          const text = (v, n) => String(v === undefined || v === null ? "" : v).slice(0, n);
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`**${text(f.id, 8)} · ${text(f.severity, 10)} · `);
          md.appendText(text(f.title, 160));
          md.appendMarkdown("**\n\n");
          md.appendText(text(f.body, 1200));
          md.appendMarkdown(`\n\n_${text(f.established, 40)}_`);
          const comment = { body: md, mode: vscode.CommentMode.Preview, author: { name: "NexCODE review" } };
          const thread = reviewController.createCommentThread(vscode.Uri.file(fullPath), new vscode.Range(line, 0, line, 0), [comment]);
          thread.label = `${text(f.id, 8)} · ${text(f.severity, 10)}`;
          thread.canReply = false;
          thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
          reviewThreads.push(thread);
          threads += 1;
        } catch (err) {
          errors.push(`${f && f.id}: ${err.message}`);
        }
      }
      return { success: threads > 0, action: "showReview", threads, errors };
    }

    default:
      return { success: false, error: `Unknown action type: ${action.type}` };
  }
}

/** The git runner the seed history and the branch diffs use: git in the seed repository, no shell, 30 s. */
function gitRun(args, env) {
  return runProcess("git", args, SEED_REPO, { env: env || {}, timeoutMs: 30000 });
}

/** A pull request's base side, in memory: `git show <ref>:<path>` (empty for a file the base does not have). */
function registerGitView(context) {
  try {
    if (!vscode.workspace || typeof vscode.workspace.registerTextDocumentContentProvider !== "function") return;
    const provider = {
      provideTextDocumentContent(uri) {
        const ref = new URLSearchParams(uri.query).get("ref") || "main";
        return seedgit.showAt({ run: gitRun, ref, rel: uri.path.replace(/^\//, "") }).catch(() => "");
      },
    };
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(GIT_SCHEME, provider));
    gitViewReady = true;
  } catch (err) {
    console.error("[NexCODE Bridge] The branch diff view could not be registered:", err.message);
  }
}

/** The review's comment threads (registered once per extension host). */
function registerReviewView(context) {
  try {
    if (!vscode.comments || typeof vscode.comments.createCommentController !== "function") return;
    reviewController = vscode.comments.createCommentController("nexcode-review", "NexCODE review");
    context.subscriptions.push(reviewController);
  } catch (err) {
    console.error("[NexCODE Bridge] Review comments could not be registered:", err.message);
  }
}

function clearReviewThreads() {
  while (reviewThreads.length) {
    const t = reviewThreads.pop();
    try {
      t.dispose();
    } catch {
      // display only
    }
  }
}

/** The in-memory documents behind a proposal's diff (registered once per extension host; never on disk). */
function registerProposalView(context) {
  try {
    if (!vscode.workspace || typeof vscode.workspace.registerTextDocumentContentProvider !== "function") return;
    const provider = {
      provideTextDocumentContent(uri) {
        if (uri.query === "empty") return "";
        return proposals.get(`${uri.path.replace(/^\//, "")}#${uri.query}`) || "";
      },
    };
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, provider));
    proposalViewReady = true;
  } catch (err) {
    console.error("[NexCODE Bridge] The proposal view could not be registered:", err.message);
  }
}

/** A command marked showOutput prints its output in the IDE's "NexCODE Tests" panel (display only; never throws). */
function showCommandOutput(entry, result) {
  try {
    if (!vscode.window || typeof vscode.window.createOutputChannel !== "function") return;
    if (!testOutput) testOutput = vscode.window.createOutputChannel("NexCODE Tests");
    testOutput.clear();
    const steps = Array.isArray(entry.exec) ? entry.exec : [entry.exec];
    for (const st of steps) testOutput.appendLine(`$ ${st.program} ${st.args.join(" ")}    (in ${st.cwd})`);
    testOutput.appendLine("");
    testOutput.append(String(result.output || result.error || ""));
    testOutput.appendLine("");
    testOutput.appendLine(result.ran ? `exit code ${result.exitCode} · ${result.durationMs} ms${result.timedOut ? " · timed out" : ""}` : `did not run: ${result.error || "unknown"}`);
    testOutput.show(true);
  } catch (err) {
    console.error("[NexCODE Bridge] Could not show the command output:", err.message);
  }
}

// ── Allow-listed commands (Machinery PR 1, design §6; decision D3) ───────────────────────────────────────────────────
// The app names an id; this table decides what runs. No shell: a program and its arguments, run as the IDE user in a
// working folder resolved inside the workspace, with a 120 s limit, a 64 KB output cap, one command at a time, and the
// bridge token removed from the child's environment (a test cannot print it). The table lives here, in the extension,
// so nothing written into the workspace — an applied model answer included — can add a command.
const SEED_REPO = "nexus-payments";
// The app (root) stages the seed here, in the pod-local folder both containers mount, before asking for seed-reset; it
// removes the stage afterwards (this user cannot delete the root-owned folders it made).
const SEED_STAGE = path.join(WORKSPACE_PREFIX, ".shared", "seed", SEED_REPO);
const COMMAND_TIMEOUT_MS = 120000;
const OUTPUT_CAP = 64 * 1024;
// A demo's id, by the app's own rule (src/lib/coding/scenarios.js: "s1", "s3r"; S5-D20 (a) of 2026-10-13). A fixed list
// here refused S5's Select ("unknown scenario: s5"); the rule still keeps the id to a name, never a path, and a reset
// removes only the records whose names carry "-<id>-".
const SCENARIO_ID = /^s\d{1,2}[a-z]?$/;
// S2: each pull request is staged beside the seed (branch.json + files/), in the same pod-local folder.
const SEED_BRANCHES_STAGE = path.join(WORKSPACE_PREFIX, ".shared", "seed", "branches");
// A fixed author and fixed dates: the seed commit has the same id after every reset.
const SEED_GIT_ENV = Object.freeze({
  GIT_AUTHOR_NAME: "Nexus Seed",
  GIT_AUTHOR_EMAIL: "seed@nexus-bank.example",
  GIT_AUTHOR_DATE: "2026-04-18T09:00:00Z",
  GIT_COMMITTER_NAME: "Nexus Seed",
  GIT_COMMITTER_EMAIL: "seed@nexus-bank.example",
  GIT_COMMITTER_DATE: "2026-04-18T09:00:00Z",
});
let commandRunning = null;
// S6 (S6-D6 (a)): the Bank's repository, a bare repository outside the workspace (the explorer does not list its
// internals), the workspace repository's remote `bank`. seed-reset makes it again; bank-commit makes it again when a
// restarted pod lost it (the container's own folders do not outlive the pod).
const BANK_REPO = path.join(path.dirname(WORKSPACE_PREFIX), ".nexus-bank", `${SEED_REPO}.git`);
const BANK_REMOTE = "bank";
// S6 (S6-D3 (a)): the Python documentation check, shipped beside this file; it prints its result on one marked line.
const PY_DOC_CHECK = path.join(__dirname, "py_doc_check.py");
const PY_DOC_MARK = "NEXCODE-PY-DOC-CHECK ";

/** The child's environment: this process's, without the bridge token, with no .pyc files written into the workspace. */
function childEnv(extra = {}) {
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...extra };
  delete env.NEXCODE_BRIDGE_TOKEN;
  return env;
}

/**
 * Run one program (no shell) in a contained working folder: `{ ran, exitCode, signal, timedOut, durationMs, output, truncated }`.
 * `input`, when given, is written to the program's standard input (S6: the module as given to the documentation check).
 */
function runProcess(program, args, cwdRel, { env = {}, timeoutMs = COMMAND_TIMEOUT_MS, input = null } = {}) {
  return new Promise((resolve) => {
    const cwd = resolveInWorkspace(cwdRel);
    const started = Date.now();
    let output = "";
    let truncated = false;
    let settled = false;
    let timedOut = false;
    const append = (chunk) => {
      if (output.length >= OUTPUT_CAP) {
        truncated = true;
        return;
      }
      output += chunk.toString("utf8");
      if (output.length > OUTPUT_CAP) {
        output = output.slice(0, OUTPUT_CAP);
        truncated = true;
      }
    };
    let child;
    try {
      child = spawn(program, args, { cwd, env: childEnv(env), shell: false });
    } catch (err) {
      resolve({ ran: false, error: err.message, durationMs: Date.now() - started });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    if (typeof input === "string") {
      child.stdin.on("error", () => {}); // a program that exits without reading its input: its exit code says why
      child.stdin.end(input, "utf8");
    }
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ran: false, error: err.message, durationMs: Date.now() - started });
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ran: true, exitCode: code, signal: signal || null, timedOut, durationMs: Date.now() - started, output, truncated });
    });
  });
}

async function closeEditors() {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  return { success: true };
}

/** Reset all: the staged seed replaces the workspace repository, and its git history is rebuilt with fixed author and dates. */
/** One IDE command for the clean layout; a failure is reported, never thrown (display only). */
async function ideCommand(id) {
  try {
    await vscode.commands.executeCommand(id);
    return true;
  } catch (err) {
    console.error(`[NexCODE Bridge] ${id} failed:`, err.message);
    return false;
  }
}

/** The IDE back to a clean layout for the next demo: terminals and the bottom panel closed, the test panel and the proposals cleared. */
async function ideCleanup() {
  const done = [];
  for (const id of ["workbench.action.terminal.killAll", "workbench.action.closePanel"]) {
    if (await ideCommand(id)) done.push(id);
  }
  proposals.clear();
  clearReviewThreads();
  if (testOutput) {
    try {
      testOutput.clear();
    } catch {
      // display only
    }
  }
  return { commands: done, proposalsCleared: true, reviewCleared: true };
}

async function seedReset() {
  if (!fs.existsSync(SEED_STAGE)) return { success: false, changed: false, error: "no staged seed: the app stages it before asking for seed-reset" };
  const started = Date.now();
  const repo = resolveInWorkspace(SEED_REPO);
  // 2026-10-12: every folder is checked before anything is deleted: one the IDE user cannot change (written by another
  // user, e.g. the app's root) stops the reset with nothing deleted, instead of halfway through the repository.
  const blocked = seedgit.unremovable(repo);
  if (blocked.length) {
    const named = blocked.map((b) => (b === ".." ? "the workspace folder" : b === "." ? SEED_REPO : `${SEED_REPO}/${b}`));
    return { success: false, changed: false, error: `the IDE user cannot remove ${named.join(", ")} (written by another user); nothing was deleted`, durationMs: Date.now() - started };
  }
  await closeEditors();
  const ide = await ideCleanup();
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch (err) {
    return { success: false, changed: true, error: `${err.message}: the workspace repository is partly deleted`, ide, durationMs: Date.now() - started };
  }
  fs.cpSync(SEED_STAGE, repo, { recursive: true });
  let history;
  try {
    history = await seedgit.buildSeedHistory({ repoDir: repo, branchesDir: SEED_BRANCHES_STAGE, run: gitRun, seedEnv: SEED_GIT_ENV });
  } catch (err) {
    return { success: false, error: err.message, steps: err.steps || [], ide, durationMs: Date.now() - started };
  }
  // S6: the Bank's repository again, from the seed's main. A failure is reported, never fails the reset: only S6's
  // Commit uses it, and the Commit makes it again when it is missing.
  let bank;
  try {
    const b = await seedgit.buildBank({ run: gitRun, bankDir: BANK_REPO, remote: BANK_REMOTE, seedEnv: SEED_GIT_ENV });
    bank = { ready: true, dir: b.dir, remote: b.remote };
  } catch (err) {
    bank = { ready: false, error: err.message };
  }
  if (await ideCommand("workbench.view.explorer")) ide.commands.push("workbench.view.explorer");
  return { success: true, commit: history.commit, branches: history.branches, steps: history.steps, bank, ide, durationMs: Date.now() - started };
}

/** Lines added under the test panel's output (S6: the documentation check's findings after the tests); display only. */
function appendCommandOutput(lines) {
  try {
    if (!testOutput) {
      if (!vscode.window || typeof vscode.window.createOutputChannel !== "function") return;
      testOutput = vscode.window.createOutputChannel("NexCODE Tests");
    }
    testOutput.appendLine("");
    for (const l of lines) testOutput.appendLine(String(l));
    testOutput.show(true);
  } catch (err) {
    console.error("[NexCODE Bridge] Could not add to the command output:", err.message);
  }
}

/**
 * S6 (S6-D3 (a)): the Python documentation check of one module in the seed repository. `before`, when given, is the
 * module as it was given to a comments-only change, compared by syntax tree (DOC-008). `{ success, exitCode, check }`:
 * success says the check ran; `check.passed` says whether the module met the standard.
 */
async function pyDocCheck(args) {
  const rel = args && typeof args.path === "string" ? args.path.replace(/\\/g, "/") : "";
  if (!rel.startsWith(`${SEED_REPO}/`) || !rel.endsWith(".py")) return { success: false, error: "py-doc-check reads one Python module in the seed repository" };
  const full = resolveInWorkspace(rel);
  const before = args && typeof args.before === "string" ? args.before : null;
  if (before !== null && before.length > PROPOSAL_MAX_CHARS) return { success: false, error: `the module as given is longer than ${PROPOSAL_MAX_CHARS} characters` };
  const r = await runProcess("python3", ["-I", "-B", PY_DOC_CHECK, "--path", full, ...(before !== null ? ["--before-stdin"] : [])], SEED_REPO, { timeoutMs: 30000, input: before });
  if (!r.ran) return { success: false, error: r.error || "the check did not run" };
  const line = String(r.output || "")
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(PY_DOC_MARK));
  let check = null;
  try {
    check = line ? JSON.parse(line.slice(PY_DOC_MARK.length)) : null;
  } catch {
    check = null;
  }
  if (!check) return { success: false, exitCode: r.exitCode, error: `the check gave no result${r.timedOut ? " (timed out)" : ""}: ${String(r.output || "").slice(0, 300)}` };
  appendCommandOutput([
    `Documentation check (STD-DOC) of ${rel.split("/").pop()}: ${check.error ? check.error : check.passed ? "passed" : "FAILED"}`,
    ...(Array.isArray(check.findings) ? check.findings : []).map((f) => `- ${f}`),
    ...(Array.isArray(check.notes) ? check.notes : []),
  ]);
  return { success: true, exitCode: r.exitCode, durationMs: r.durationMs, check };
}

/**
 * S6-D6 (a): the presenter's Commit. The named files (workspace paths in the seed repository) on a feature branch,
 * committed as the engineer the presenter plays, and the branch pushed to the Bank's repository (seedgit.commitToBank).
 */
async function bankCommit(args) {
  const paths = args && Array.isArray(args.paths) ? args.paths : [];
  const rel = [];
  for (const p of paths) {
    resolveInWorkspace(p);
    if (typeof p !== "string" || !p.startsWith(`${SEED_REPO}/`)) return { success: false, error: `not a path in the seed repository: ${p}` };
    rel.push(p.slice(SEED_REPO.length + 1));
  }
  const repo = resolveInWorkspace(SEED_REPO);
  if (!fs.existsSync(path.join(repo, ".git"))) return { success: false, error: "the seed repository is not in the workspace: reset the demo environment first" };
  const started = Date.now();
  try {
    const r = await seedgit.commitToBank({ run: gitRun, repoDir: repo, bankDir: BANK_REPO, remote: BANK_REMOTE, branch: args.branch, paths: rel, message: args.message, author: args.author, seedEnv: SEED_GIT_ENV });
    return { success: true, ...r, bank: { dir: BANK_REPO, remote: BANK_REMOTE }, durationMs: Date.now() - started };
  } catch (err) {
    return { success: false, error: err.message, steps: err.steps || [], durationMs: Date.now() - started };
  }
}

/** Reset one scenario: its files back to the seed commit, new files in their folders removed, its records removed. */
async function scenarioReset(args) {
  const scenario = args && typeof args.scenario === "string" ? args.scenario : "";
  if (!SCENARIO_ID.test(scenario)) return { success: false, error: `unknown scenario: ${scenario || "(none)"}` };
  const paths = args && Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0 || paths.length > 50) return { success: false, error: "a scenario reset names 1 to 50 paths" };
  const rel = [];
  for (const p of paths) {
    resolveInWorkspace(p);
    if (typeof p !== "string" || !p.startsWith(`${SEED_REPO}/`)) return { success: false, error: `not a path in the seed repository: ${p}` };
    rel.push(p.slice(SEED_REPO.length + 1));
  }
  // S3: folders a demo writes into that the seed does not hold (a migration's target), cleaned like the paths' folders.
  const clean = [];
  for (const c of args && Array.isArray(args.clean) ? args.clean : []) {
    resolveInWorkspace(c);
    if (typeof c !== "string" || !c.startsWith(`${SEED_REPO}/`) || c.includes("..")) return { success: false, error: `not a folder in the seed repository: ${c}` };
    clean.push(c.slice(SEED_REPO.length + 1).replace(/\/+$/, ""));
  }
  if (clean.length > 10) return { success: false, error: "a scenario reset cleans at most 10 folders" };
  const repo = resolveInWorkspace(SEED_REPO);
  if (!fs.existsSync(path.join(repo, ".git"))) return { success: false, error: "the seed repository is not in the workspace: reset the demo environment first" };
  const branch = args && typeof args.branch === "string" && args.branch ? args.branch : "main";
  // 2026-10-12: a folder the reset must empty but the IDE user cannot change stops Select with nothing changed.
  const blocked = clean.flatMap((c) => seedgit.unremovable(path.join(repo, c), { parent: false }).map((b) => (b === "." ? `${SEED_REPO}/${c}` : `${SEED_REPO}/${c}/${b}`)));
  if (blocked.length) return { success: false, changed: false, error: `the IDE user cannot remove ${blocked.join(", ")} (written by another user); nothing was changed` };
  const started = Date.now();
  await closeEditors();
  // The demo's branch, back at its seed commit (an accidental commit in the IDE is dropped; the app never commits), its
  // paths restored from that commit, new files in their folders removed (seedgit.scenarioCheckout).
  const folders = [...new Set([...rel.map((r) => path.posix.dirname(r)), ...clean].filter((d) => d && d !== "."))];
  let checkout;
  try {
    checkout = await seedgit.scenarioCheckout({ run: gitRun, branch, paths: rel, folders });
  } catch (err) {
    return { success: false, error: err.message, steps: err.steps || [] };
  }
  let recordsRemoved = 0;
  const records = resolveInWorkspace(`${SEED_REPO}/compliance/records`);
  if (fs.existsSync(records)) {
    for (const name of fs.readdirSync(records)) {
      if (name.includes(`-${scenario}-`)) {
        fs.rmSync(resolveInWorkspace(`${SEED_REPO}/compliance/records/${name}`), { force: true });
        recordsRemoved += 1;
      }
    }
  }
  return { success: true, seed: checkout.seed, branch, switched: checkout.switched, restored: rel, cleaned: folders, cleanExitCode: checkout.cleanExitCode, recordsRemoved, durationMs: Date.now() - started };
}

// S3 (the clearing batch migration, s3-design.md; 2026-10-10): the legacy check at Select, then each port's tests. The
// COBOL is compiled and run on the fixture beside the port, so its report is the live oracle; `diff` of the port's report
// against it is the equivalence check (role "equivalence", a tool fact for the record, MIG-001); the port's own
// characterisation test runs last (TST-010). Absolute program paths for what the build makes; no shell anywhere.
const JUNIT_JAR = "/usr/share/java/junit-platform-console-standalone.jar";
const SEED_ABS = path.join(WORKSPACE_PREFIX, SEED_REPO);
const S3_LEGACY = Object.freeze([
  { program: "node", args: ["-e", "const fs = require('fs'); fs.rmSync('build', { recursive: true, force: true }); fs.mkdirSync('build/classes', { recursive: true })"], cwd: SEED_REPO },
  { program: "cobc", args: ["-x", "-o", "build/clearing", "legacy/clearing-batch/CLEARING.cbl"], cwd: SEED_REPO },
  { program: path.join(SEED_ABS, "build", "clearing"), args: [], cwd: SEED_REPO, env: { DD_CLEARIN: "legacy/clearing-batch/clearing_input.dat", DD_CLEAROUT: "build/clearing_totals_cobol.txt" } },
  { program: "diff", args: ["-u", "legacy/clearing-batch/expected_totals.txt", "build/clearing_totals_cobol.txt"], cwd: SEED_REPO, role: "legacy" },
]);
const COMPAT_JAVA = ["Pic", "FixedRecord", "CobolMath", "Picture", "LineSequential", "Reports"].map((n) => `libs/cobol-compat/src/main/java/com/nexusbank/cobol/${n}.java`);
const S3_JAVA = Object.freeze([
  {
    program: "javac",
    args: ["-d", "build/classes", "-cp", JUNIT_JAR, ...COMPAT_JAVA, "libs/cobol-compat/src/test/java/com/nexusbank/cobol/CobolCompatTest.java", "services/clearing/src/main/java/com/nexusbank/clearing/ClearingBatch.java", "services/clearing/src/test/java/com/nexusbank/clearing/ClearingBatchCharacterisationTest.java"],
    cwd: SEED_REPO,
  },
  { program: "java", args: ["-cp", "build/classes", "com.nexusbank.clearing.ClearingBatch", "legacy/clearing-batch/clearing_input.dat", "build/clearing_totals_java.txt"], cwd: SEED_REPO },
  { program: "diff", args: ["-u", "build/clearing_totals_cobol.txt", "build/clearing_totals_java.txt"], cwd: SEED_REPO, role: "equivalence" },
  { program: "java", args: ["-jar", JUNIT_JAR, "execute", "--class-path", "build/classes", "--scan-class-path", "--disable-banner", "--disable-ansi-colors", "--details=tree", "--fail-if-no-tests"], cwd: SEED_REPO, role: "characterisation" },
]);
const CARGO_ENV = Object.freeze({ CARGO_TARGET_DIR: "build/cargo" });
const S3_RUST = Object.freeze([
  { program: "cargo", args: ["build", "--offline", "--quiet", "--manifest-path", "services/clearing-rs/Cargo.toml"], cwd: SEED_REPO, env: CARGO_ENV },
  { program: "cargo", args: ["run", "--offline", "--quiet", "--manifest-path", "services/clearing-rs/Cargo.toml", "--", "legacy/clearing-batch/clearing_input.dat", "build/clearing_totals_rust.txt"], cwd: SEED_REPO, env: CARGO_ENV },
  { program: "diff", args: ["-u", "build/clearing_totals_cobol.txt", "build/clearing_totals_rust.txt"], cwd: SEED_REPO, role: "equivalence" },
  { program: "cargo", args: ["test", "--offline", "--manifest-path", "services/clearing-rs/Cargo.toml"], cwd: SEED_REPO, env: CARGO_ENV, role: "characterisation" },
]);
// The image's GnuCOBOL runtime prints a libxml version warning on stderr at every run (a Debian packaging mismatch,
// harmless: it never reaches a report). Said once under the output, so the room does not read it as a failure.
const S3_NOTES = Object.freeze([{ match: "compiled against libxml", text: "the libxml line is a known packaging warning of the image's GnuCOBOL runtime: it goes to stderr, never into a report (CLR-WIKI-019)." }]);

const COMMANDS = Object.freeze({
  "seed-reset": { run: () => seedReset() },
  "scenario-reset": { run: (args) => scenarioReset(args) },
  "close-editors": { run: () => closeEditors() },
  "s1-tests": { exec: { program: "python3", args: ["-m", "unittest", "discover", "-s", "services/settlement", "-p", "test_*.py", "-v"], cwd: SEED_REPO }, showOutput: true },
  "s2-tests": {
    exec: [
      { program: "node", args: ["-e", "require('fs').rmSync('services/refund-api/dist', { recursive: true, force: true })"], cwd: SEED_REPO },
      { program: "tsc", args: ["-p", "services/refund-api/tsconfig.json"], cwd: SEED_REPO },
      { program: "node", args: ["--test", "services/refund-api/dist/test"], cwd: SEED_REPO },
    ],
    showOutput: true,
  },
  "s3-legacy": { exec: S3_LEGACY, showOutput: true, notes: S3_NOTES },
  "s3-java-tests": { exec: [...S3_LEGACY, ...S3_JAVA], showOutput: true, notes: S3_NOTES },
  "s3-rust-tests": { exec: [...S3_LEGACY, ...S3_RUST], showOutput: true, notes: S3_NOTES },
  // S6: the new module's tests alone (s1-tests would run S1's deliberately failing test too); then the documentation
  // check, which the app asks for by the module's path; then the presenter's Commit.
  "s6-tests": { exec: { program: "python3", args: ["-m", "unittest", "discover", "-s", "services/settlement", "-p", "test_dispute_intake.py", "-v"], cwd: SEED_REPO }, showOutput: true },
  "py-doc-check": { run: (args) => pyDocCheck(args) },
  "bank-commit": { run: (args) => bankCommit(args) },
  "git-diff-stat": { exec: { program: "git", args: ["diff", "--stat", "HEAD"], cwd: SEED_REPO } },
  "git-status": { exec: { program: "git", args: ["status", "--porcelain"], cwd: SEED_REPO } },
});

/**
 * One program, or a fixed sequence of them run in order until one fails (S2's tests: clear the build, compile, test):
 * the output of each, under its command line, and the last run's exit code. No shell. `steps` lists each program that
 * ran with its exit code and role (S3: "legacy", "equivalence", "characterisation"), so the app can tell which check a
 * run passed or failed; `notes` add a line under the output when their text appears in it.
 */
async function runSteps(steps, notes = []) {
  const list = Array.isArray(steps) ? steps : [steps];
  const ran = [];
  let output = "";
  let durationMs = 0;
  let last = null;
  for (const st of list) {
    const r = await runProcess(st.program, st.args, st.cwd, { env: st.env || {} });
    durationMs += r.durationMs || 0;
    ran.push({ command: `${path.basename(st.program)} ${st.args.join(" ")}`.trim(), role: st.role || null, ran: Boolean(r.ran), exitCode: r.ran ? r.exitCode : null });
    output += list.length === 1 ? r.output || r.error || "" : `$ ${path.basename(st.program)} ${st.args.join(" ")}\n${r.output || r.error || ""}${(r.output || "").endsWith("\n") ? "" : "\n"}`;
    last = r;
    if (!r.ran || r.exitCode !== 0) break;
  }
  for (const n of Array.isArray(notes) ? notes : []) if (n && n.match && output.includes(n.match)) output += `\nNote: ${n.text}\n`;
  if (output.length > OUTPUT_CAP) output = output.slice(0, OUTPUT_CAP);
  return { ...last, output, durationMs, steps: ran, truncated: Boolean(last && last.truncated) || output.length >= OUTPUT_CAP };
}

/** `{ status, result }` for a command request: an unknown id is refused (400); a second command while one runs is 409. */
async function handleCommand(body) {
  const id = body && typeof body.id === "string" ? body.id : "";
  const entry = Object.prototype.hasOwnProperty.call(COMMANDS, id) ? COMMANDS[id] : null;
  if (!entry) return { status: 400, result: { success: false, error: `not an allow-listed command: ${id || "(none)"}` } };
  if (commandRunning) return { status: 409, result: { success: false, error: `busy: ${commandRunning} is running` } };
  commandRunning = id;
  try {
    const result = entry.exec ? await runSteps(entry.exec, entry.notes) : await entry.run(body.args || {});
    if (entry.exec && entry.showOutput) showCommandOutput(entry, result);
    const ok = entry.exec ? Boolean(result.ran) : Boolean(result.success);
    return { status: ok ? 200 : 400, result: { ...result, command: id, success: ok } };
  } catch (err) {
    return { status: 400, result: { success: false, command: id, error: err.message } };
  } finally {
    commandRunning = null;
  }
}

/**
 * Parse the request body from an incoming HTTP request.
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Answer one request: the header gate first, then the routes.
 */
async function handleRequest(req, res) {
  // CORS headers (localhost only, but needed for fetch)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-NexCODE-Bridge");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "application/json");

  // E3: the shared header gates everything below; no token configured → 503 for every call.
  if (!authorised(req)) {
    res.writeHead(BRIDGE_TOKEN ? 401 : 503);
    res.end(JSON.stringify({ error: BRIDGE_TOKEN ? "missing or wrong X-NexCODE-Bridge header" : "bridge token not configured" }));
    return;
  }

  try {
    // GET /api/state — return current IDE state
    if (req.method === "GET" && req.url === "/api/state") {
      const state = getIDEState();
      res.writeHead(200);
      res.end(JSON.stringify(state));
      return;
    }

    // GET /api/health — simple health check; names the extension host that answers (pid, instance)
    if (req.method === "GET" && req.url === "/api/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok", port: BRIDGE_PORT, pid: process.pid, instance: INSTANCE_ID, holdingSince }));
      return;
    }

    // POST /api/action — execute an IDE action (a refused path is a 400 with the reason, never a 500)
    if (req.method === "POST" && req.url === "/api/action") {
      const action = await parseBody(req);
      let result;
      try {
        result = await handleAction(action || {});
      } catch (err) {
        result = { success: false, error: err.message, action: action && action.type, path: action && action.path };
      }
      res.writeHead(result.success ? 200 : 400);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/command — an allow-listed command (Machinery PR 1, design §6): the app names an id, the table decides.
    if (req.method === "POST" && req.url === "/api/command") {
      const body = await parseBody(req);
      const { status, result } = await handleCommand(body || {});
      res.writeHead(status);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/yield — a newer IDE window's extension host asks for the port: answer, then stand by.
    if (req.method === "POST" && req.url === "/api/yield") {
      res.writeHead(200);
      res.end(JSON.stringify({ yielded: true, pid: process.pid, instance: INSTANCE_ID }), () => setImmediate(yieldPort));
      return;
    }

    // 404 for everything else
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    console.error("[NexCODE Bridge] Error:", err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * Hand the port to a newer window: stop listening and go on standby.
 */
function yieldPort() {
  const current = active;
  if (!current) return;
  standby = true;
  active = null;
  holdingSince = null;
  updateStatusBar();
  console.log("[NexCODE Bridge] A newer IDE window asked for the bridge port: yielding, now on standby.");
  current.close();
  if (typeof current.closeIdleConnections === "function") current.closeIdleConnections();
}

/**
 * Ask the host that holds the port to yield it — from a fresh activation's retries, never from standby.
 */
function askHolderToYield() {
  if (!BRIDGE_TOKEN) return;
  const req = http.request(
    {
      host: BRIDGE_HOST,
      port: BRIDGE_PORT,
      path: "/api/yield",
      method: "POST",
      headers: { [BRIDGE_HEADER]: BRIDGE_TOKEN, "Content-Length": "0" },
      agent: false,
      timeout: 2000,
    },
    (res) => {
      res.resume();
      if (res.statusCode === 200 && !stopped && !active) {
        // The holder is closing now: retry soon instead of at the normal interval.
        if (retryTimeout) {
          clearTimeout(retryTimeout);
          retryTimeout = null;
        }
        scheduleRetry(YIELD_RETRY_MS);
      }
    }
  );
  req.on("timeout", () => req.destroy());
  req.on("error", () => {});
  req.end();
}

/**
 * At most ONE retry is ever pending: a second request while one waits is ignored.
 */
function scheduleRetry(ms) {
  if (stopped || active || retryTimeout) return;
  retryTimeout = setTimeout(() => {
    retryTimeout = null;
    startServer();
  }, ms);
}

/**
 * Start the HTTP bridge server: one attempt; on failure, one scheduled retry.
 */
function startServer() {
  if (stopped || active) return;
  const server = http.createServer(handleRequest);
  server.on("error", (err) => {
    if (active === server) {
      // A runtime error on the listening server: logged; the server keeps serving or emits close.
      console.error("[NexCODE Bridge] Server error:", err.message);
      return;
    }
    if (err.code === "EADDRINUSE") {
      // The newest window takes the port: ask the holder to yield, again on each retry; a host on standby never asks.
      if (!standby) {
        if (!yieldAsked) console.warn(`[NexCODE Bridge] Port ${BRIDGE_PORT} is held by another IDE window: asking it to yield.`);
        yieldAsked = true;
        askHolderToYield();
      }
    } else {
      console.error("[NexCODE Bridge] Could not listen:", err.message);
    }
    scheduleRetry(standby ? STANDBY_RETRY_MS : RETRY_MS);
  });
  server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    active = server;
    standby = false;
    holdingSince = new Date().toISOString();
    updateStatusBar();
    console.log(
      `[NexCODE Bridge] IDE Bridge server listening on ${BRIDGE_HOST}:${BRIDGE_PORT} (${BRIDGE_TOKEN ? "token configured" : "NO TOKEN — refusing every request"})`
    );
    server.on("close", () => {
      if (active === server) {
        active = null;
        holdingSince = null;
        updateStatusBar();
      }
      // Closed unexpectedly, or yielded: one retry (slow on standby); never after deactivate().
      scheduleRetry(standby ? STANDBY_RETRY_MS : RETRY_MS);
    });
  });
}

/**
 * The status bar says which state this window's bridge is in.
 */
function updateStatusBar() {
  if (!statusBar) return;
  if (active) {
    statusBar.text = "$(plug) NexCODE Bridge";
    statusBar.tooltip = `NexCODE IDE Bridge active on ${BRIDGE_HOST}:${BRIDGE_PORT}`;
  } else if (standby) {
    statusBar.text = "$(debug-disconnect) NexCODE Bridge (standby)";
    statusBar.tooltip = "A newer IDE window holds the NexCODE bridge; this window is on standby";
  } else {
    statusBar.text = "$(sync~spin) NexCODE Bridge (connecting)";
    statusBar.tooltip = `Waiting for ${BRIDGE_HOST}:${BRIDGE_PORT}`;
  }
}

/**
 * Extension activation — called when code-server starts this window's extension host.
 */
function activate(context) {
  console.log("[NexCODE Bridge] Extension activating...");
  stopped = false;
  standby = false;
  yieldAsked = false;

  // Register a status bar item that shows the bridge state
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  updateStatusBar();
  statusBar.show();
  context.subscriptions.push(statusBar);
  registerProposalView(context);
  registerGitView(context);
  registerReviewView(context);

  startServer();
  console.log("[NexCODE Bridge] Extension activated successfully");
}

function deactivate() {
  stopped = true;
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  if (active) {
    const current = active;
    active = null;
    holdingSince = null;
    current.close();
    if (typeof current.closeAllConnections === "function") current.closeAllConnections();
    console.log("[NexCODE Bridge] Server stopped");
  }
}

module.exports = { activate, deactivate };
