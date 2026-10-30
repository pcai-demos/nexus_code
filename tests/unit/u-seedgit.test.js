/**
 * U-SEEDGIT — the seed repository's history (code-server-ext/nexcode-bridge/seedgit.js; S2, the owner's D1 (a) of
 * 2026-10-09: a real branch, local to the demo's repository). Runs real git in a temporary folder over the real seed
 * (public/demos/seed/nexus-payments) and the staged pull request (public/demos/seed-branches/pr-PAY-2318).
 *
 * The app's image has no git binary (the unit gate runs there): without git these cases check the module's surface and
 * return, an assertion that holds in both places (never a skip).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const G = require("../../code-server-ext/nexcode-bridge/seedgit");

const ROOT = path.resolve(__dirname, "..", "..");
const SEED = path.join(ROOT, "public", "demos", "seed", "nexus-payments");
const BRANCHES = path.join(ROOT, "public", "demos", "seed-branches");
const HAS_GIT = (() => {
  const r = spawnSync("git", ["--version"], { encoding: "utf8" });
  return r.status === 0;
})();
const SEED_ENV = { GIT_AUTHOR_NAME: "Nexus Seed", GIT_AUTHOR_EMAIL: "seed@nexus-bank.example", GIT_AUTHOR_DATE: "2026-04-18T09:00:00Z", GIT_COMMITTER_NAME: "Nexus Seed", GIT_COMMITTER_EMAIL: "seed@nexus-bank.example", GIT_COMMITTER_DATE: "2026-04-18T09:00:00Z" };
const S1_PATHS = ["backlog/INC-2026-0419.md", "services/settlement/settlement_reconciler.py"];
const S2_PATHS = ["services/refund-api/src/refund-service.ts", "services/refund-api/src/audit-log.ts", "services/refund-api/package.json"];

/** A fresh copy of the seed in a temporary folder, and a git runner for it that ignores the user's own git config. */
function freshRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u-seedgit-"));
  fs.cpSync(SEED, dir, { recursive: true });
  const run = async (args, env = {}) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...env } });
    return { ran: r.status !== null && !r.error, exitCode: r.status, output: `${r.stdout || ""}${r.stderr || ""}` };
  };
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).stdout.trim();
  return { dir, run, git };
}

describe("U-SEEDGIT: the seed's main and the pull request branch", () => {
  test("the staged branch's manifest is valid and names only files it carries", () => {
    const dirs = G.stagedBranches(BRANCHES);
    assert.deepStrictEqual(dirs.map((d) => path.basename(d)), ["pr-PAY-2318"]);
    const b = G.readBranch(dirs[0]);
    assert.strictEqual(b.branch, "pr/PAY-2318");
    assert.deepStrictEqual(b.author, { name: "Tom Okafor", email: "tom.okafor@nexus-bank.example" });
    assert.deepStrictEqual(b.files, S2_PATHS);
    for (const f of b.files) assert.ok(fs.existsSync(path.join(dirs[0], "files", f)), f);
    assert.throws(() => G.inside("/tmp/x", "../etc/passwd"), /not a contained path/);
    if (!HAS_GIT) return; // the app's image: no git binary; the history cases below need one
  });

  test("main is the baseline and pr/PAY-2318 one commit on it by Tom Okafor; the ids are the same on every rebuild", async () => {
    if (!HAS_GIT) return assert.strictEqual(typeof G.buildSeedHistory, "function");
    const a = freshRepo();
    const ra = await G.buildSeedHistory({ repoDir: a.dir, branchesDir: BRANCHES, run: a.run, seedEnv: SEED_ENV });
    assert.match(ra.commit, /^[0-9a-f]{40}$/);
    assert.deepStrictEqual(ra.branches.map((b) => b.name), ["pr/PAY-2318"]);
    assert.strictEqual(a.git("rev-parse", "--abbrev-ref", "HEAD"), "main", "the repository ends on main");
    assert.strictEqual(a.git("rev-parse", "seed/main"), ra.commit);
    assert.strictEqual(a.git("rev-parse", "seed/pr/PAY-2318"), ra.branches[0].commit);
    assert.strictEqual(a.git("log", "-1", "--format=%an <%ae> %aI", "pr/PAY-2318"), "Tom Okafor <tom.okafor@nexus-bank.example> 2026-05-12T09:41:00+01:00");
    assert.deepStrictEqual(a.git("diff", "--name-only", "main", "pr/PAY-2318").split("\n").sort(), [...S2_PATHS].sort());
    assert.strictEqual(a.git("rev-list", "--count", "main..pr/PAY-2318"), "1");
    const b = freshRepo();
    const rb = await G.buildSeedHistory({ repoDir: b.dir, branchesDir: BRANCHES, run: b.run, seedEnv: SEED_ENV });
    assert.deepStrictEqual([rb.commit, rb.branches[0].commit], [ra.commit, ra.branches[0].commit], "fixed authors and dates: the same ids every time");
  });

  test("a demo's reset puts the repository on its own branch, restores its paths and drops a stray commit, in either order", async () => {
    if (!HAS_GIT) return assert.strictEqual(typeof G.scenarioCheckout, "function");
    const r = freshRepo();
    const built = await G.buildSeedHistory({ repoDir: r.dir, branchesDir: BRANCHES, run: r.run, seedEnv: SEED_ENV });
    const prFile = path.join(r.dir, S2_PATHS[0]);
    assert.ok(!fs.existsSync(prFile), "refund-service.ts is not on main");
    fs.appendFileSync(path.join(r.dir, S1_PATHS[1]), "\n# an S1 edit left behind\n");
    const s2 = await G.scenarioCheckout({ run: r.run, branch: "pr/PAY-2318", paths: S2_PATHS, folders: ["services/refund-api/src"] });
    assert.strictEqual(r.git("rev-parse", "--abbrev-ref", "HEAD"), "pr/PAY-2318");
    assert.ok(s2.switched && fs.existsSync(prFile), "S2 is on its branch with Tom's file");
    assert.strictEqual(r.git("status", "--porcelain"), "", "the S1 edit left behind was discarded on the switch");
    fs.appendFileSync(prFile, "\n// a reviewer's edit\n");
    r.git("-c", "user.name=x", "-c", "user.email=x@x", "commit", "-qam", "stray");
    assert.notStrictEqual(r.git("rev-parse", "HEAD"), built.branches[0].commit);
    await G.scenarioCheckout({ run: r.run, branch: "pr/PAY-2318", paths: S2_PATHS, folders: ["services/refund-api/src"] });
    assert.strictEqual(r.git("rev-parse", "HEAD"), built.branches[0].commit, "the stray commit is gone");
    assert.strictEqual(r.git("status", "--porcelain"), "");
    const s1 = await G.scenarioCheckout({ run: r.run, branch: "main", paths: S1_PATHS, folders: ["services/settlement"] });
    assert.strictEqual(r.git("rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.strictEqual(s1.seed, built.commit);
    assert.ok(!fs.existsSync(prFile), "back on main: no refund-service.ts");
    assert.strictEqual(await G.showAt({ run: r.run, ref: "main", rel: S2_PATHS[0] }), "", "a new file's left side is empty");
    assert.match(await G.showAt({ run: r.run, ref: "main", rel: S2_PATHS[1] }), /"SETTLEMENT_RELEASED";/);
    assert.match(await G.showAt({ run: r.run, ref: "pr/PAY-2318", rel: S2_PATHS[1] }), /"REFUND_REQUESTED";/);
  });

  test("a workspace seeded before the tags existed still resets main, from its root commit", async () => {
    if (!HAS_GIT) return assert.strictEqual(typeof G.scenarioCheckout, "function");
    const r = freshRepo();
    for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "Seed: nexus-payments demo baseline"]]) await r.run(args, SEED_ENV);
    const root = r.git("rev-parse", "HEAD");
    const out = await G.scenarioCheckout({ run: r.run, branch: "main", paths: S1_PATHS, folders: [] });
    assert.strictEqual(out.seed, root);
    await assert.rejects(G.scenarioCheckout({ run: r.run, branch: "pr/PAY-2318", paths: S2_PATHS }), /reset the demo environment/);
  });

  test("a demo's file that the workspace's seed commit lacks (an older seed) asks for an environment reset and changes nothing", async () => {
    if (!HAS_GIT) return assert.strictEqual(typeof G.scenarioCheckout, "function");
    const r = freshRepo();
    for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "Seed: nexus-payments demo baseline"]]) await r.run(args, SEED_ENV);
    fs.writeFileSync(path.join(r.dir, "backlog", "scratch.md"), "an edit the reset would restore\n");
    const head = r.git("rev-parse", "HEAD");
    await assert.rejects(
      G.scenarioCheckout({ run: r.run, branch: "main", paths: [...S1_PATHS, "libs/cobol-compat/src/main/java/com/nexusbank/cobol/NotInThisSeed.java"], folders: ["backlog"] }),
      /the workspace was built from an older seed \(it has no libs\/cobol-compat\/src\/main\/java\/com\/nexusbank\/cobol\/NotInThisSeed\.java\): reset the demo environment/
    );
    assert.strictEqual(r.git("rev-parse", "HEAD"), head);
    assert.ok(fs.existsSync(path.join(r.dir, "backlog", "scratch.md")), "nothing was cleaned");
  });
});

describe("U-SEEDGIT: the Bank's repository and the presenter's Commit (S6, the owner's S6-D6 (a) of 2026-10-13)", () => {
  const S6_FILES = ["services/settlement/dispute_intake.py", "services/settlement/test_dispute_intake.py", "compliance/records/2026-10-13-s6-0a1b2c3d.md"];
  const PRIYA = { name: "Priya Nair", email: "priya.nair@nexus-bank.example" };
  const bankOf = (r) => path.join(path.dirname(r.dir), `${path.basename(r.dir)}-bank`, "nexus-payments.git");
  const writeS6 = (r) => {
    for (const rel of S6_FILES) fs.writeFileSync(path.join(r.dir, rel), `# ${rel}\n`);
    fs.writeFileSync(path.join(r.dir, "backlog", "not-in-the-commit.md"), "staged by hand\n");
    r.git("add", "backlog/not-in-the-commit.md");
  };

  test("the environment reset makes the Bank's repository from the seed's main, as the workspace's remote bank", async () => {
    if (!HAS_GIT) return assert.strictEqual(typeof G.buildBank, "function");
    const r = freshRepo();
    const built = await G.buildSeedHistory({ repoDir: r.dir, branchesDir: BRANCHES, run: r.run, seedEnv: SEED_ENV });
    const bank = bankOf(r);
    const out = await G.buildBank({ run: r.run, bankDir: bank, remote: "bank", seedEnv: SEED_ENV });
    assert.strictEqual(out.dir, bank);
    assert.strictEqual(r.git("remote", "get-url", "bank"), bank);
    assert.strictEqual(r.git("--git-dir", bank, "rev-parse", "refs/heads/main"), built.commit, "the Bank's main is the seed's main");
    assert.strictEqual(r.git("--git-dir", bank, "for-each-ref", "--format=%(refname)"), "refs/heads/main", "nothing else is in the Bank's repository");
    await G.buildBank({ run: r.run, bankDir: bank, remote: "bank", seedEnv: SEED_ENV });
    assert.strictEqual(r.git("remote", "get-url", "bank"), bank, "made again: the remote is kept, not added twice");
    await assert.rejects(G.buildBank({ run: r.run, bankDir: "relative/bank.git" }), /absolute folder/);
  });

  test("Commit puts only the named files on the feature branch, as the engineer, and pushes it to the Bank's repository", async () => {
    if (!HAS_GIT) return assert.strictEqual(typeof G.commitToBank, "function");
    const r = freshRepo();
    const built = await G.buildSeedHistory({ repoDir: r.dir, branchesDir: BRANCHES, run: r.run, seedEnv: SEED_ENV });
    const bank = bankOf(r);
    await G.buildBank({ run: r.run, bankDir: bank, remote: "bank", seedEnv: SEED_ENV });
    writeS6(r);
    const message = "DSP-2026-03: Record card payment disputes in the settlement service\n\nAI-assisted: NexCODE";
    const c = await G.commitToBank({ run: r.run, repoDir: r.dir, bankDir: bank, branch: "feature/DSP-2026-03", paths: S6_FILES, message, author: PRIYA, seedEnv: SEED_ENV });
    assert.match(c.commit, /^[0-9a-f]{40}$/);
    assert.strictEqual(c.rebuilt, false);
    assert.strictEqual(r.git("rev-parse", "--abbrev-ref", "HEAD"), "feature/DSP-2026-03");
    assert.strictEqual(r.git("rev-parse", "HEAD~1"), built.commit, "one commit on the seed's main");
    assert.deepStrictEqual(c.files.map((f) => `${f.status} ${f.path}`).sort(), S6_FILES.map((p) => `added ${p}`).sort(), "the named files, and only them");
    assert.strictEqual(r.git("log", "-1", "--format=%an <%ae> | %cn <%ce>"), "Priya Nair <priya.nair@nexus-bank.example> | Priya Nair <priya.nair@nexus-bank.example>");
    assert.strictEqual(r.git("log", "-1", "--format=%B"), message);
    assert.strictEqual(r.git("--git-dir", bank, "rev-parse", "refs/heads/feature/DSP-2026-03"), c.commit, "pushed to the Bank's repository");
    assert.strictEqual(c.bankLog.length, 2, "the branch's log in the Bank: the commit and the seed");
    assert.match(c.bankLog[0], /^[0-9a-f]{7,} Priya Nair \S+ DSP-2026-03: Record card payment disputes/);
    assert.strictEqual(r.git("diff", "--cached", "--name-only"), "backlog/not-in-the-commit.md", "a file staged by hand stays out of the commit");
    await assert.rejects(G.commitToBank({ run: r.run, repoDir: r.dir, bankDir: bank, branch: "feature/DSP-2026-03", paths: S6_FILES, message, author: PRIYA }), /nothing to commit/);
  });

  test("a demo run again after its reset replaces its branch in the Bank; a lost Bank is made again; bad input is refused", async () => {
    if (!HAS_GIT) return assert.strictEqual(typeof G.FEATURE_BRANCH, "object");
    const r = freshRepo();
    const built = await G.buildSeedHistory({ repoDir: r.dir, branchesDir: BRANCHES, run: r.run, seedEnv: SEED_ENV });
    const bank = bankOf(r);
    await G.buildBank({ run: r.run, bankDir: bank, remote: "bank", seedEnv: SEED_ENV });
    writeS6(r);
    const args = { run: r.run, repoDir: r.dir, bankDir: bank, branch: "feature/DSP-2026-03", paths: S6_FILES, message: "DSP-2026-03: first run", author: PRIYA, seedEnv: SEED_ENV };
    const first = await G.commitToBank(args);
    const back = await G.scenarioCheckout({ run: r.run, branch: "main", paths: S1_PATHS, folders: ["services/settlement", "compliance/records"] });
    assert.strictEqual(back.switched, true);
    assert.strictEqual(r.git("rev-parse", "HEAD"), built.commit);
    assert.ok(!fs.existsSync(path.join(r.dir, S6_FILES[0])), "back on main: the committed module is not in the working tree");
    for (const rel of S6_FILES) fs.writeFileSync(path.join(r.dir, rel), `# ${rel}, run two\n`);
    fs.rmSync(bank, { recursive: true, force: true });
    const second = await G.commitToBank({ ...args, message: "DSP-2026-03: second run" });
    assert.strictEqual(second.rebuilt, true, "the lost Bank was made again from the seed's main");
    assert.notStrictEqual(second.commit, first.commit);
    assert.strictEqual(r.git("--git-dir", bank, "rev-parse", "refs/heads/feature/DSP-2026-03"), second.commit);
    assert.strictEqual(r.git("--git-dir", bank, "rev-parse", "refs/heads/main"), built.commit);
    await assert.rejects(G.commitToBank({ ...args, branch: "main" }), /not a feature branch/);
    await assert.rejects(G.commitToBank({ ...args, branch: "feature/../main" }), /not a feature branch/);
    await assert.rejects(G.commitToBank({ ...args, paths: ["../outside.txt"] }), /not a contained path/);
    await assert.rejects(G.commitToBank({ ...args, paths: ["services/settlement/missing.py"] }), /not a file in the repository/);
    await assert.rejects(G.commitToBank({ ...args, message: "  " }), /commit message/);
    await assert.rejects(G.commitToBank({ ...args, author: { name: "Priya Nair" } }), /author/);
  });
});
