/**
 * U-WORKSPACE-PERMS — what the demo writes into the workspace, the IDE user can remove (2026-10-12).
 *
 * The app container runs as root and the IDE as the coder user (the pod's fsGroup 1000). S3's Apply wrote the port's
 * new folders as root, without group write, and the next "Reset the demo environment" deleted most of the repository
 * before it met them; the dialog then said "Nothing else was changed". Now: Apply writes through the bridge (the IDE
 * user), the app's own writes are group-writable, the resets check every folder before deleting anything, and the
 * dialog says "nothing was changed" only when the bridge says so.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { writeGroupWritable, DIR_MODE, FILE_MODE } = require("../../src/lib/coding/workspace_write");
const seedgit = require("../../code-server-ext/nexcode-bridge/seedgit");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "u-workspace-perms-"));
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("U-WORKSPACE-PERMS: the app's own writes are group-writable", () => {
  test("every folder made and a file made are group-writable, whatever the umask; an existing file keeps its mode", () => {
    const dir = tmp();
    const old = process.umask(0o022);
    try {
      const r = writeGroupWritable(path.join(dir, "services", "clearing", "src", "Port.java"), "class Port {}\n");
      assert.deepStrictEqual(r, { madeFolders: 3, madeFile: true });
      for (const d of ["services", "services/clearing", "services/clearing/src"]) {
        assert.strictEqual(fs.statSync(path.join(dir, d)).mode & 0o070, 0o070, `${d} is group rwx`);
      }
      assert.strictEqual(fs.statSync(path.join(dir, "services/clearing/src/Port.java")).mode & 0o060, 0o060, "the file is group rw");
      assert.strictEqual(fs.readFileSync(path.join(dir, "services/clearing/src/Port.java"), "utf8"), "class Port {}\n");
      fs.writeFileSync(path.join(dir, "kept.txt"), "x", { mode: 0o640 });
      fs.chmodSync(path.join(dir, "kept.txt"), 0o640);
      assert.deepStrictEqual(writeGroupWritable(path.join(dir, "kept.txt"), "y"), { madeFolders: 0, madeFile: false });
      assert.strictEqual(fs.statSync(path.join(dir, "kept.txt")).mode & 0o777, 0o640, "an existing file's mode is the IDE's business");
      assert.deepStrictEqual([DIR_MODE, FILE_MODE], [0o2775, 0o664]);
    } finally {
      process.umask(old);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("U-WORKSPACE-PERMS: a reset checks before it deletes", () => {
  test("unremovable lists a folder this user cannot change, and does not descend into it", { skip: isRoot ? "root can change any folder: run as a non-root user" : false }, () => {
    const dir = tmp();
    try {
      fs.mkdirSync(path.join(dir, "repo", "services", "clearing", "src"), { recursive: true });
      fs.mkdirSync(path.join(dir, "repo", "legacy"), { recursive: true });
      assert.deepStrictEqual(seedgit.unremovable(path.join(dir, "repo")), [], "all writable: nothing listed");
      fs.chmodSync(path.join(dir, "repo", "services", "clearing"), 0o555);
      assert.deepStrictEqual(seedgit.unremovable(path.join(dir, "repo")), ["services/clearing"]);
      assert.deepStrictEqual(seedgit.unremovable(path.join(dir, "repo", "services", "clearing"), { parent: false }), ["."]);
      fs.chmodSync(path.join(dir, "repo", "services", "clearing"), 0o755);
      fs.chmodSync(dir, 0o555);
      assert.deepStrictEqual(seedgit.unremovable(path.join(dir, "repo")), [".."], "the repository itself cannot leave its parent");
      assert.deepStrictEqual(seedgit.unremovable(path.join(dir, "repo"), { parent: false }), []);
      fs.chmodSync(dir, 0o755);
      assert.deepStrictEqual(seedgit.unremovable(path.join(dir, "absent")), []);
    } finally {
      fs.chmodSync(dir, 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the environment reset and a demo's reset check every folder first; the dialog claims nothing it does not know", () => {
    const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));
    const seed = ext.slice(ext.indexOf("async function seedReset() {"), ext.indexOf("async function scenarioReset(args) {"));
    const checkAt = seed.indexOf("const blocked = seedgit.unremovable(repo);");
    assert.ok(checkAt > 0 && checkAt < seed.indexOf("await closeEditors();") && checkAt < seed.indexOf("fs.rmSync(repo"), "checked before the IDE is touched or anything deleted");
    assert.match(seed, /return \{ success: false, changed: false, error: `the IDE user cannot remove \$\{named\.join\(", "\)\} \(written by another user\); nothing was deleted`/);
    assert.match(seed, /catch \(err\) \{\s*return \{ success: false, changed: true, error: `\$\{err\.message\}: the workspace repository is partly deleted`/);
    const scen = ext.slice(ext.indexOf("async function scenarioReset(args) {"));
    assert.ok(scen.indexOf("seedgit.unremovable(path.join(repo, c), { parent: false })") > 0 && scen.indexOf("seedgit.unremovable(") < scen.indexOf("await closeEditors();"), "Select checks the folders it empties first");
    const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
    assert.match(route, /changed: ok \? true : result && typeof result\.changed === "boolean" \? result\.changed : null,/);
    assert.match(route, /if \(!\(await getBridgeHealth\(\)\)\) return \{ success: false, changed: false, error: "Open the IDE panel: the bridge starts with it\.", code: "BRIDGE_OFFLINE" \};/);
    const menu = codeOnly(read("src/components/presenter/ResetMenu.jsx"));
    assert.match(menu, /r && r\.changed === false\s*\? " Nothing else was changed\."/);
    assert.ok(!/\$\{err\.message\}\. Nothing else was changed\./.test(menu), "a thrown request claims nothing");
  });
});

describe("U-WORKSPACE-PERMS: Apply writes as the IDE user", () => {
  test("Apply asks the bridge to write first; the app writes group-writable only when the bridge did not; the run log says which", () => {
    const s = codeOnly(read("src/app/api/ide-bridge/route.js"));
    assert.match(s, /import \{ writeGroupWritable \} from "@\/lib\/coding\/workspace_write";/);
    assert.match(s, /function writeWorkspaceFile\(relativePath, content\) \{\s*const fullPath = resolveInside\(WORKSPACE_ROOT, relativePath\);\s*writeGroupWritable\(fullPath, content\);/);
    assert.match(s, /if \(!extResult \|\| !extResult\.success\) \{\s*writeWorkspaceFile\(op\.path, content\);\s*via = "app";\s*\}/);
    assert.match(s, /appendRun\(\{ kind: "apply", path: op\.path, ok: true, via \}\);/);
    assert.ok(!/fs\.mkdirSync|fs\.writeFileSync/.test(s), "the route makes no folder and writes no file itself");
    const scen = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
    assert.match(scen, /writeGroupWritable\(resolveInside\(WORKSPACE_ROOT, rel\), content\);/);
    assert.ok(!/mode: 0o2775/.test(scen), "the umask-masked modes are gone");
  });
});
