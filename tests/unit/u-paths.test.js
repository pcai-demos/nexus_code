/**
 * U-PATHS — the containment rule for caller-named paths and the Enablers PR's source pins
 * (Enablers PR E1–E8, 2026-10-06; audit findings CA-001, CA-002, CA-003, CA-006, CA-007, CA-012, CA-013, CA-019).
 *
 * The rule (src/lib/coding/paths.js resolveInside): a non-empty string, relative (no POSIX or Windows absolute
 * path), no `..` segment in either separator style, and the resolved path strictly inside the root. Three call
 * sites use it or carry it: the IDE-bridge route (Apply → the workspace, HTTP 400 on refusal), the file-preview
 * route (public/demos/demo_files, HTTP 403) and the orchestrator's writeWorkspaceFile — the one coding-owned hunk
 * of that frozen file (lines 108-120), which carries the same three checks INLINE because it cannot gain an import.
 * The bridge extension (code-server-ext) carries its own copy, resolveInWorkspace, which is executed here against
 * the same table of cases so the two cannot drift apart.
 *
 * Source pins read the files as text (the routes import next/server and the extension requires vscode, so neither
 * loads in node --test); a pin is satisfied by code, never by prose about code (comments are stripped first).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const { resolveInside, PathContainmentError } = require("../../src/lib/coding/paths");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "u-paths-"));
const ROOT_ABS = path.resolve(ROOT);

/** [input, expected relative result or null when refused] — the one table both copies of the rule must agree on. */
const CASES = [
  ["a.py", "a.py"],
  ["src/utils/a.py", path.join("src", "utils", "a.py")],
  ["./src/a.py", path.join("src", "a.py")],
  ["src\\utils\\a.py", path.join("src", "utils", "a.py")],
  ["dir/./a.py", path.join("dir", "a.py")],
  ["a..b/c.py", path.join("a..b", "c.py")],
  ["..", null],
  ["../x", null],
  ["a/../../x", null],
  ["..\\x", null],
  ["a/..", null],
  ["/etc/passwd", null],
  ["\\etc\\passwd", null],
  ["C:\\Windows\\x", null],
  ["C:/x", null],
  [".", null],
  ["", null],
  ["   ", null],
  ["a\0b", null],
];

describe("U-PATHS: resolveInside (src/lib/coding/paths.js)", () => {
  test("every accepted case resolves strictly inside the root; every refused case throws PathContainmentError", () => {
    for (const [input, expected] of CASES) {
      if (expected === null) {
        assert.throws(() => resolveInside(ROOT, input), (e) => e instanceof PathContainmentError && e.code === "PATH_OUTSIDE_ROOT" && e.name === "PathContainmentError", `refused: ${JSON.stringify(input)}`);
      } else {
        const full = resolveInside(ROOT, input);
        assert.strictEqual(full, path.join(ROOT_ABS, expected), JSON.stringify(input));
        assert.ok(full.startsWith(ROOT_ABS + path.sep), "strictly inside");
      }
    }
  });

  test("a non-string path is refused; the error names the path it refused", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      assert.throws(() => resolveInside(ROOT, bad), PathContainmentError, String(bad));
    }
    try {
      resolveInside(ROOT, "../x");
      assert.fail("should throw");
    } catch (e) {
      assert.strictEqual(e.relPath, "../x");
      assert.match(e.message, /parent segment/);
    }
  });

  test("the root may carry a trailing separator or be relative to process.cwd(); the result is the same absolute path", () => {
    assert.strictEqual(resolveInside(ROOT + path.sep, "a.py"), path.join(ROOT_ABS, "a.py"));
    const rel = path.relative(process.cwd(), ROOT);
    assert.strictEqual(resolveInside(rel, "a.py"), path.join(ROOT_ABS, "a.py"));
  });

  test("a sibling directory whose name starts with the root's name is outside (the separator is part of the check)", () => {
    // ROOT = /tmp/u-paths-abc; a path that resolves to /tmp/u-paths-abc2/x must be refused — it can only be reached
    // through a parent segment, which the segment check refuses before the prefix check.
    assert.throws(() => resolveInside(ROOT, `../${path.basename(ROOT)}2/x`), PathContainmentError);
  });
});

describe("U-PATHS: the three call sites (source pins)", () => {
  test("ide-bridge route: Apply resolves the path inside the workspace root and answers HTTP 400 on refusal (CA-001)", () => {
    const s = codeOnly(read("src/app/api/ide-bridge/route.js"));
    assert.match(s, /import \{ resolveInside, PathContainmentError \} from "@\/lib\/coding\/paths";/);
    assert.match(s, /function writeWorkspaceFile\(relativePath, content\) \{\s*const fullPath = resolveInside\(WORKSPACE_ROOT, relativePath\);/);
    assert.ok(!/path\.join\(WORKSPACE_ROOT, relativePath\)/.test(s), "the uncontained join is gone");
    assert.match(s, /if \(err instanceof PathContainmentError\) \{[\s\S]*?\{ status: 400 \}/);
    const applyAt = s.indexOf("if (applyOperation) {");
    const containAt = s.indexOf("resolveInside(WORKSPACE_ROOT, op.path);", applyAt);
    const extAt = s.indexOf("sendIDEAction({", applyAt);
    const writeAt = s.indexOf("writeWorkspaceFile(op.path", applyAt);
    // 2026-10-12: the IDE user writes an applied file (the bridge), the app only when the bridge did not.
    assert.ok(applyAt > 0 && containAt > applyAt && extAt > containAt && writeAt > extAt, "the path is contained before the extension is asked to write it; the app writes only after");
  });

  test("file-preview route: reads only under public/demos/demo_files and answers HTTP 403 on refusal (CA-003)", () => {
    const s = codeOnly(read("src/app/api/files/preview/route.js"));
    assert.match(s, /import \{ resolveInside, PathContainmentError \} from "@\/lib\/coding\/paths";/);
    assert.match(s, /const PREVIEW_ROOT = path\.join\(process\.cwd\(\), "public", "demos", "demo_files"\);/);
    assert.match(s, /const PREVIEW_PREFIX = "demos\/demo_files\/";/, "the browser's public-relative form is accepted");
    assert.match(s, /fullPath = resolveInside\(PREVIEW_ROOT, cleanPath\);/);
    assert.match(s, /if \(err instanceof PathContainmentError\) \{[\s\S]*?\{ status: 403 \}/);
    assert.ok(!/path\.join\(process\.cwd\(\), "public", cleanPath\)/.test(s), "the uncontained join is gone");
  });

  test("orchestrator: writeWorkspaceFile (lines 108-120, the one permitted hunk of the frozen file) carries the same three checks inline and skips on refusal", () => {
    const raw = read("src/lib/orchestrator.js");
    const lines = raw.split("\n");
    assert.strictEqual(lines[107], "function writeWorkspaceFile(filename, content) {", "the helper still starts at line 108 (the freeze gate's window)");
    const start = raw.indexOf("function writeWorkspaceFile(filename, content) {");
    const end = raw.indexOf("\n}\n", start);
    const body = codeOnly(raw.slice(start, end));
    assert.match(body, /const rel = String\(filename\)\.replace\(\/\\\\\/g, "\/"\);/, "back-slashes normalised like resolveInside");
    assert.match(body, /const rootAbs = path\.resolve\(WORKSPACE_ROOT\);/);
    assert.match(body, /path\.posix\.isAbsolute\(rel\)/, "check 1: no absolute path");
    assert.match(body, /\/\^\[A-Za-z\]:\/\.test\(rel\)/, "check 1b: no Windows drive");
    assert.match(body, /rel\.split\("\/"\)\.includes\("\.\."\)/, "check 2: no parent segment");
    assert.match(body, /!filePath\.startsWith\(rootAbs \+ path\.sep\)/, "check 3: strictly inside the root");
    const refuseAt = body.indexOf("Refused a write outside the workspace");
    const mkdirAt = body.indexOf("fs.mkdirSync");
    const writeAt = body.indexOf("fs.writeFileSync");
    assert.ok(refuseAt > 0 && mkdirAt > refuseAt && writeAt > mkdirAt, "the refusal returns before any directory or file is made");
    assert.match(body.slice(refuseAt, mkdirAt), /return;/);
    assert.ok(!/path\.join\(WORKSPACE_ROOT, filename\)/.test(body), "the uncontained join is gone");
    assert.ok(!/from "@\/lib\/coding\/paths"/.test(raw), "the frozen file gained no import (the rule is inline by design)");
  });
});

describe("U-PATHS/E3: the bridge extension (CA-002)", () => {
  const ext = read("code-server-ext/nexcode-bridge/extension.js");
  const s = codeOnly(ext);

  test("binds the loopback address, requires X-NexCODE-Bridge = NEXCODE_BRIDGE_TOKEN, and fails closed (503) with no token", () => {
    assert.match(s, /const BRIDGE_HOST = "127\.0\.0\.1";/);
    assert.match(s, /server\.listen\(BRIDGE_PORT, BRIDGE_HOST,/);
    assert.ok(!/"0\.0\.0\.0"/.test(s), "no wildcard bind");
    assert.match(s, /const BRIDGE_HEADER = "x-nexcode-bridge";/);
    assert.match(s, /const BRIDGE_TOKEN = process\.env\.NEXCODE_BRIDGE_TOKEN \|\| "";/);
    assert.match(s, /if \(!authorised\(req\)\) \{\s*res\.writeHead\(BRIDGE_TOKEN \? 401 : 503\);/);
    assert.match(s, /return typeof given === "string" && given === BRIDGE_TOKEN;/);
    const gateAt = s.indexOf("if (!authorised(req))");
    for (const route of ['req.url === "/api/state"', 'req.url === "/api/health"', 'req.url === "/api/action"', 'req.url === "/api/yield"', 'req.url === "/api/command"']) {
      assert.ok(s.indexOf(route) > gateAt, `${route} is behind the gate`);
    }
  });

  test("openFile, writeFile and applyEdit resolve their path inside the workspace; a refusal is a 400 with the reason", () => {
    for (const c of ["openFile", "writeFile", "applyEdit"]) {
      assert.match(s, new RegExp(`case "${c}": \\{\\s*const fullPath = resolveInWorkspace\\(action\\.path\\);`), c);
    }
    assert.ok(!/path\.join\(WORKSPACE_PREFIX, action\.path\)/.test(s), "the uncontained join is gone");
    assert.match(s, /result = \{ success: false, error: err\.message, action: action && action\.type, path: action && action\.path \};/);
  });

  test("the extension's resolveInWorkspace agrees with resolveInside on every case of the table", () => {
    const fnStart = ext.indexOf("function resolveInWorkspace(relPath) {");
    const fnEnd = ext.indexOf("\n}\n", fnStart);
    assert.ok(fnStart > 0 && fnEnd > fnStart, "the function is found");
    const fn = new Function("path", "WORKSPACE_PREFIX", `${ext.slice(fnStart, fnEnd + 2)}; return resolveInWorkspace;`)(path, ROOT_ABS);
    for (const [input, expected] of CASES) {
      if (expected === null) {
        assert.throws(() => fn(input), Error, `extension refuses ${JSON.stringify(input)}`);
      } else {
        assert.strictEqual(fn(input), path.join(ROOT_ABS, expected), `extension accepts ${JSON.stringify(input)}`);
      }
    }
  });

  test("the app sends the header on both bridge calls, from the same env name the chart renders into both containers", () => {
    const route = codeOnly(read("src/app/api/ide-bridge/route.js"));
    assert.match(route, /const BRIDGE_HEADER = "X-NexCODE-Bridge";/);
    assert.match(route, /\[BRIDGE_HEADER\]: process\.env\.NEXCODE_BRIDGE_TOKEN \|\| ""/);
    assert.strictEqual((route.match(/headers: bridgeHeaders\(/g) || []).length, 2, "GET /api/state and POST /api/action");
    const valuesPath = path.join(REPO_ROOT, "helm", "values.yaml");
    if (fs.existsSync(valuesPath)) {
      // helm/ is .dockerignored: the chart is checked on the workstation; in the pod the rendered env is the check.
      assert.match(read("helm/values.yaml"), /^  bridgeToken: "[^"]+"$/m);
      const dep = read("helm/templates/deployment.yaml");
      assert.strictEqual((dep.match(/- name: NEXCODE_BRIDGE_TOKEN\s*value: \{\{ \.Values\.ide\.bridgeToken \| quote \}\}/g) || []).length, 2, "rendered into both containers");
    } else {
      assert.ok(typeof process.env.NEXCODE_BRIDGE_TOKEN === "string" && process.env.NEXCODE_BRIDGE_TOKEN.length > 0, "the pod's env carries the token");
    }
  });
});

describe("U-PATHS/Enablers: the page, the drawer, the panel and the dependencies (E1, E5, E6, E7, E8)", () => {
  const page = codeOnly(read("src/app/page.js"));

  test("E1: motion is imported where it is rendered; Session Reset no longer calls the setters T43 removed; the tooltip promises only what it does", () => {
    assert.match(page, /import \{ AnimatePresence, motion \} from "framer-motion";/);
    assert.match(page, /<motion\.div/);
    assert.ok(!/setCumulativeTokens\(/.test(page) && !/setLastLatency\(/.test(page), "the two undefined setters are gone");
    const menu = JSON.parse(read("src/data/sidebar_menu_def.json"));
    const reset = menu.find((m) => m.label === "Session Reset");
    // The owner's D1 (a) of 2026-10-07: the icon opens two levels; the tooltip still promises only what it does.
    assert.strictEqual(reset.tooltip, "Reset: clear the chat, or reset the demo environment");
    assert.match(page, /text: `The request failed: \$\{err\.message\}\. Nothing was generated\.`/);
    assert.ok(!/offline fallback/.test(page));
  });

  test("E5: the Data Connector, the SQL-era turn states, the saved-task dropdown and the dead files are gone; nothing imports them", () => {
    for (const name of ["nexusApiBaseUrl", "supabaseUrl", "supabaseAnonKey", "dbConnectionMethod", "mcpUrl", "mcpApiKey", "dataConnectorToggle", "currentSql", "currentRows", "currentError", "currentTargetView", "currentExplanation", "lastSql", "lastTargetView", "activeStage", "chartType", "lastPrompt"]) {
      assert.ok(!new RegExp(`\\b${name}\\b`).test(page), `page.js no longer carries ${name}`);
    }
    assert.match(page, /<VisualStage \/>/);
    const drawer = codeOnly(read("src/components/AdminDrawer.jsx"));
    for (const name of ["localDbConnectionMethod", "localSupabaseUrl", "localNexusApiUrl", "handleRunDatabaseTest", "/api/db-test", "RiGlobalLine", "Data Connector", "dataConnectorToggle"]) {
      assert.ok(!drawer.includes(name), `AdminDrawer.jsx no longer carries ${name}`);
    }
    // The "Saved code tasks" dropdown went with the owner's unlock of 2026-10-06 (tests/unit/u-fail.test.js T49 case 5
    // now pins 0 fetches in the panel); the brief's scenario panel (M2, Machinery PR 1) replaces it.
    const panel = codeOnly(read("src/components/ChatPanel.jsx"));
    for (const name of ["SAVED_TASKS", "selectedTaskUrl", "handleSelectSavedTask", "saved-code-tasks", "Saved code tasks"]) {
      assert.ok(!panel.includes(name), `ChatPanel.jsx no longer carries ${name}`);
    }
    assert.strictEqual((panel.match(/\bfetch\(/g) || []).length, 0, "the dropdown was the panel's one fetch");
    for (const rel of [
      "src/components/KpiPanel.jsx", "src/components/DataSelector.jsx", "src/components/ShortcutBar.jsx", "src/components/nexus.json",
      "src/data/master_system_prompt.json", "src/data/schema_registry.json", "src/data/create_analytics_quality_view.sql",
      "src/app/api/user-settings", "src/app/api/shared-files", "src/app/api/db-test", "src/nexus-demo-info/templates",
    ]) {
      assert.ok(!fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} is deleted`);
    }
    const walk = (dir, out) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(p); } return out; };
    for (const f of walk(path.join(REPO_ROOT, "src"), [])) {
      const s = codeOnly(fs.readFileSync(f, "utf8"));
      assert.ok(!/KpiPanel|DataSelector|ShortcutBar|components\/nexus\.json|master_system_prompt|schema_registry|cannedSqlMap|user-settings|shared-files|\/api\/db-test|demo-info\/templates/.test(s), `${path.relative(REPO_ROOT, f)} references a deleted file`);
    }
  });

  test("E6 / E7: the IDE placeholder names the sidecar, not a local script; the two Ollama placeholder tokens are empty; the captioner's key is untouched", () => {
    const ide = codeOnly(read("src/components/CodeServerIDE.jsx"));
    assert.ok(!/start-ide\.sh/.test(ide));
    assert.match(ide, /nexcode-ide/);
    assert.match(page, /const \[ollamaToken, setOllamaToken\] = useState\(""\)/);
    assert.match(page, /const \[codeOllamaToken, setCodeOllamaToken\] = useState\(""\)/);
    // D31 (Nexus, 2026-10-30): the captioner is a LiteLLM model whose Ollama the server resolves; no key travels to
    // Ollama, so the old numeric placeholder is gone too.
    assert.match(page, /const \[vlmApiKey, setVlmApiKey\] = useState\(""\)/, "the captioner key has no placeholder (D31)");
    assert.match(page, /result\?\.applied\?\.extensionResult\?\.success/, "open-in-the-IDE is claimed only when the bridge said so");
    assert.match(page, /the IDE did not open it \(bridge offline\)/);
  });

  test("E4 / E8: npm run lint is eslint over the tree; the five unused packages are gone; motion and eslint-config-next stay", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.strictEqual(pkg.scripts.lint, "eslint .");
    for (const dep of ["@supabase/supabase-js", "http-proxy-middleware", "react-force-graph-3d", "recharts", "three"]) {
      assert.ok(!(dep in pkg.dependencies) && !(dep in (pkg.devDependencies || {})), `${dep} removed`);
    }
    assert.ok("motion" in pkg.dependencies && "framer-motion" in pkg.dependencies);
    assert.ok("eslint-config-next" in pkg.devDependencies && "eslint" in pkg.devDependencies);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "eslint.config.mjs")));
    assert.match(read("eslint.config.mjs"), /"no-undef": "error"/);
  });
});

describe("U-PATHS/E3b (session 88): one retry chain, the handover, and an IDE column that stays mounted (evidence: inputs/demo-design/evidence/session-88-bridge-check/findings.md)", () => {
  const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));
  const page = codeOnly(read("src/app/page.js"));

  test("the extension keeps at most one pending retry and handles close only on a server that listened; the double restart is gone", () => {
    assert.match(ext, /function scheduleRetry\(ms\) \{\s*if \(stopped \|\| active \|\| retryTimeout\) return;/);
    assert.match(ext, /server\.listen\(BRIDGE_PORT, BRIDGE_HOST, \(\) => \{[\s\S]*?server\.on\("close", /, "close is attached inside the listen callback");
    assert.ok(!/Server closed unexpectedly/.test(ext) && !/setTimeout\(startServer, /.test(ext), "the close handler no longer re-arms a start of its own");
    assert.strictEqual((ext.match(/retryTimeout = setTimeout\(/g) || []).length, 1, "one retry timer site: scheduleRetry");
  });

  test("a fresh activation asks the holder to yield once, with the header; standby never asks; the yield route is behind the gate", () => {
    assert.match(ext, /if \(err\.code === "EADDRINUSE"\) \{\s*if \(!standby\) \{[\s\S]{0,260}?askHolderToYield\(\);\s*\}/);
    assert.match(ext, /const YIELD_RETRY_MS = Math\.min\(250, RETRY_MS\);/, "the quick retry after a yield stays inside the holder's standby interval");
    assert.match(ext, /path: "\/api\/yield",\s*method: "POST",\s*headers: \{ \[BRIDGE_HEADER\]: BRIDGE_TOKEN, "Content-Length": "0" \},/);
    assert.ok(ext.indexOf('req.url === "/api/yield"') > ext.indexOf("if (!authorised(req))"), "behind the gate");
  });

  test("the page keeps the IDE column mounted and hides it while the panel is closed, so a toggle opens no new code-server window", () => {
    assert.ok(!/\{ideOpen && \(/.test(page), "the column is not unmounted by the toggle");
    assert.match(page, /<div className=\{\s*ideOpen\s*\?[\s\S]*?: "hidden"\s*\}>\s*<VisualStage \/>\s*<\/div>/);
  });
});

describe("U-PATHS/E3c (Machinery PR 1, design §6, D3): the allow-listed commands", () => {
  const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));

  test("the app names an id and the extension's table decides: no shell, a contained working folder, the token stripped, one at a time", () => {
    const table = ext.slice(ext.indexOf("const COMMANDS = Object.freeze({"), ext.indexOf("async function handleCommand("));
    const ids = [...table.matchAll(/^\s*"([a-z0-9-]+)": \{/gm)].map((m) => m[1]);
    // S6 (2026-10-13): the new module's tests, the Python documentation check and the presenter's Commit joined the table.
    assert.deepStrictEqual(ids, ["seed-reset", "scenario-reset", "close-editors", "s1-tests", "s2-tests", "s3-legacy", "s3-java-tests", "s3-rust-tests", "s6-tests", "py-doc-check", "bank-commit", "git-diff-stat", "git-status"]);
    assert.match(ext, /const entry = Object\.prototype\.hasOwnProperty\.call\(COMMANDS, id\) \? COMMANDS\[id\] : null;\s*if \(!entry\) return \{ status: 400,/);
    assert.match(ext, /if \(commandRunning\) return \{ status: 409,/);
    assert.match(ext, /child = spawn\(program, args, \{ cwd, env: childEnv\(env\), shell: false \}\);/);
    assert.match(ext, /const cwd = resolveInWorkspace\(cwdRel\);/);
    assert.match(ext, /function childEnv\(extra = \{\}\) \{[\s\S]{0,200}?delete env\.NEXCODE_BRIDGE_TOKEN;/);
    assert.ok(!/exec\(|execSync|shell: true/.test(ext), "no shell anywhere");
    assert.ok(ext.indexOf('req.url === "/api/command"') > ext.indexOf("if (!authorised(req))"), "behind the gate");
  });

  test("a scenario reset restores only paths in the seed repository, contained; the seed reset rebuilds git with a fixed author and dates", () => {
    assert.match(ext, /resolveInWorkspace\(p\);\s*if \(typeof p !== "string" \|\| !p\.startsWith\(`\$\{SEED_REPO\}\/`\)\)/);
    // The owner's D3 of 2026-10-07: restore from the seed commit and move the branch back to it, never from HEAD. Since S2
    // (D1 (a) of 2026-10-09: a pull request branch, local) the git steps live in seedgit.js, per branch: main's seed
    // commit is tagged seed/main (the root commit for a workspace seeded before the tags), a branch's is seed/<branch>.
    const git = codeOnly(read("code-server-ext/nexcode-bridge/seedgit.js"));
    assert.match(ext, /checkout = await seedgit\.scenarioCheckout\(\{ run: gitRun, branch, paths: rel, folders \}\);/);
    assert.match(ext, /history = await seedgit\.buildSeedHistory\(\{ repoDir: repo, branchesDir: SEED_BRANCHES_STAGE, run: gitRun, seedEnv: SEED_GIT_ENV \}\);/);
    assert.match(git, /\["rev-list", "--max-parents=0", "HEAD"\]/);
    assert.match(git, /\["reset", "-q", "--mixed", seed\]/);
    assert.match(git, /\["checkout", seed, "--", \.\.\.paths\]/);
    assert.ok(!/\["checkout", "HEAD", "--"/.test(ext + git), "no restore from HEAD");
    assert.match(ext, /GIT_AUTHOR_DATE: "2026-04-18T09:00:00Z",/);
    assert.match(git, /\["init", "-q", "-b", "main"\], seedEnv\);\s*await step\(run, steps, \["add", "-A"\], seedEnv\);\s*await step\(run, steps, \["commit", "-q", "-m", "Seed: nexus-payments demo baseline"\], seedEnv\);/);
    assert.ok(!/exec\(|execSync|shell: true|spawn\(/.test(git), "seedgit.js runs nothing itself");
  });

  test("every command a scenario names is in the extension's table", () => {
    const { SCENARIO_COMMAND_IDS } = require("../../src/lib/coding/scenarios");
    for (const id of SCENARIO_COMMAND_IDS) assert.ok(ext.includes(`"${id}": {`), id);
  });
});
