// code-server-ext/nexcode-bridge/seedgit.js — the seed repository's git history (S2, the pull request review; the
// owner's D1 (a) of 2026-10-09: a real branch, LOCAL to the demo's own repository in the IDE container: no remote,
// no credentials, nothing pushed). Required by extension.js; unit-tested with real git in a temporary folder.
//
// Nothing here spawns a process itself: every git run goes through the `run(args, env)` the caller hands in (the
// extension's runProcess: no shell, a time limit, the bridge token removed from the environment), and every file it
// copies is named by the staged branch's manifest and contained under the repository.
//
// buildSeedHistory: `main` is the baseline commit (tag seed/main); each staged branch folder (branch.json + files/)
//   becomes ONE commit on its own branch, by its own author at its own date (tag seed/<branch>), so its id is the same
//   after every reset; the repository ends on main.
// scenarioCheckout: a demo's own reset (Select demo): the repository onto the demo's branch (tracked changes another
//   demo left are discarded; untracked files stay), the branch back to its seed commit (an accidental commit in the
//   IDE never carries over), the demo's paths restored from that commit, new files in their folders removed.
// buildBank / commitToBank (S6, the owner's S6-D6 (a) of 2026-10-13): "the Bank's repository", a bare repository
//   inside the pod (still no host: no credentials, nothing leaves the pod). The environment reset makes it again from
//   the seed's main, as the workspace repository's remote `bank`; the presenter's Commit puts a demo's files on a
//   feature branch, commits them as the engineer the presenter plays, and pushes the branch to it.

const fs = require("fs");
const path = require("path");

const BRANCH_NAME = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
const SHA = /^[0-9a-f]{40}$/;

/** A relative path inside `root`, or throws (no absolute path, no `..`, strictly inside). */
function inside(root, rel) {
  if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new Error(`not a contained path: ${rel}`);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`not a contained path: ${rel}`);
  return full;
}

/** One staged branch's manifest, checked: `{ branch, base, author: { name, email }, date, message, files }`. */
function readBranch(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "branch.json"), "utf8"));
  const branch = String(manifest.branch || "");
  if (!BRANCH_NAME.test(branch) || branch === "main") throw new Error(`bad branch name in ${path.basename(dir)}/branch.json: ${branch || "(none)"}`);
  if ((manifest.base || "main") !== "main") throw new Error(`${branch}: only branches from main are supported`);
  const author = manifest.author || {};
  if (!author.name || !author.email || !manifest.date || !manifest.message) throw new Error(`${branch}: author, date and message are required`);
  const files = Array.isArray(manifest.files) ? manifest.files.map(String) : [];
  if (files.length === 0) throw new Error(`${branch}: no files`);
  return { branch, author: { name: String(author.name), email: String(author.email) }, date: String(manifest.date), message: String(manifest.message), files };
}

/** The staged branch folders, by name, each with a branch.json. */
function stagedBranches(branchesDir) {
  if (!branchesDir || !fs.existsSync(branchesDir)) return [];
  return fs
    .readdirSync(branchesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(branchesDir, e.name, "branch.json")))
    .map((e) => path.join(branchesDir, e.name))
    .sort();
}

async function step(run, steps, args, env) {
  const r = await run(args, env);
  const entry = { git: args.join(" "), exitCode: r && r.exitCode !== undefined ? r.exitCode : null, output: String((r && (r.output || r.error)) || "").trim().slice(0, 2000) };
  steps.push(entry);
  if (!r || !r.ran || r.exitCode !== 0) {
    const err = new Error(`git ${args[0]} failed${entry.output ? `: ${entry.output.split("\n")[0]}` : ""}`);
    err.steps = steps;
    throw err;
  }
  return entry.output;
}

/**
 * The seed's history in an already-copied repository folder: the baseline commit on main, then one commit per staged
 * branch. `seedEnv` fixes the baseline's author and dates. Returns `{ commit, branches: [{ name, commit }], steps }`;
 * a failure throws an Error carrying `.steps`.
 */
async function buildSeedHistory({ repoDir, branchesDir, run, seedEnv }) {
  const steps = [];
  await step(run, steps, ["init", "-q", "-b", "main"], seedEnv);
  await step(run, steps, ["add", "-A"], seedEnv);
  await step(run, steps, ["commit", "-q", "-m", "Seed: nexus-payments demo baseline"], seedEnv);
  await step(run, steps, ["tag", "seed/main"], seedEnv);
  const commit = await step(run, steps, ["rev-parse", "HEAD"], seedEnv);
  const branches = [];
  for (const dir of stagedBranches(branchesDir)) {
    const b = readBranch(dir);
    const env = { GIT_AUTHOR_NAME: b.author.name, GIT_AUTHOR_EMAIL: b.author.email, GIT_AUTHOR_DATE: b.date, GIT_COMMITTER_NAME: b.author.name, GIT_COMMITTER_EMAIL: b.author.email, GIT_COMMITTER_DATE: b.date };
    await step(run, steps, ["checkout", "-q", "-b", b.branch], seedEnv);
    for (const rel of b.files) {
      const src = inside(path.join(dir, "files"), rel);
      const dst = inside(repoDir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    await step(run, steps, ["add", "-A"], env);
    await step(run, steps, ["commit", "-q", "-m", b.message], env);
    await step(run, steps, ["tag", `seed/${b.branch}`], env);
    branches.push({ name: b.branch, commit: await step(run, steps, ["rev-parse", "HEAD"], env) });
    await step(run, steps, ["checkout", "-q", "main"], seedEnv);
  }
  return { commit, branches, steps };
}

/**
 * A demo's reset onto `branch` (default main). `paths` are relative to the repository; `folders` are the folders whose
 * new files are removed. Returns `{ branch, seed, switched, restored, cleaned, cleanExitCode }`; throws on failure.
 */
async function scenarioCheckout({ run, branch = "main", paths = [], folders = [] }) {
  if (!BRANCH_NAME.test(branch)) throw new Error(`bad branch name: ${branch}`);
  const steps = [];
  const quiet = async (args) => {
    const r = await run(args, {});
    return r && r.ran && r.exitCode === 0 ? String(r.output || "").trim() : null;
  };
  let seed = await quiet(["rev-parse", "-q", "--verify", `refs/tags/seed/${branch}^{commit}`]);
  if (!seed && branch === "main") {
    // A workspace seeded before the seed tags existed: main's seed commit is the root commit.
    const roots = await quiet(["rev-list", "--max-parents=0", "HEAD"]);
    seed = roots ? roots.split("\n").pop().trim() : null;
  }
  if (!seed || !SHA.test(seed)) throw new Error(`the seed commit of ${branch} is not in the workspace: reset the demo environment`);
  // 2026-10-12: a demo's file that the seed commit lacks means the workspace was built from an older seed (a demo's seed
  // changed since): say so before anything is changed, instead of failing on git's "pathspec did not match".
  if (paths.length) {
    const listed = await quiet(["ls-tree", "-r", "--name-only", seed, "--", ...paths]);
    const have = new Set(String(listed || "").split("\n").map((l) => l.trim()).filter(Boolean));
    const missing = paths.filter((p) => !have.has(p));
    if (missing.length) throw new Error(`the workspace was built from an older seed (it has no ${missing.slice(0, 3).join(", ")}): reset the demo environment`);
  }
  const current = await quiet(["rev-parse", "--abbrev-ref", "HEAD"]);
  let switched = false;
  if (current !== branch) {
    const exists = await quiet(["rev-parse", "-q", "--verify", `refs/heads/${branch}`]);
    await step(run, steps, exists ? ["checkout", "-q", "-f", branch] : ["checkout", "-q", "-f", "-B", branch, seed], {});
    switched = true;
  }
  await step(run, steps, ["reset", "-q", "--mixed", seed], {});
  if (paths.length) await step(run, steps, ["checkout", seed, "--", ...paths], {});
  let cleanExitCode = 0;
  if (folders.length) {
    const r = await run(["clean", "-fdq", "--", ...folders], {});
    cleanExitCode = r && r.exitCode !== undefined ? r.exitCode : null;
  }
  return { branch, seed, switched, restored: paths, cleaned: folders, cleanExitCode, steps };
}

/** A feature branch a demo may commit to (S6): `feature/<name>`. */
const FEATURE_BRANCH = /^feature\/[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;
const AUTHOR_NAME = /^[A-Za-z][A-Za-z .'-]{0,60}$/;
const AUTHOR_EMAIL = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const COMMIT_MESSAGE_MAX = 4000;
const COMMIT_PATHS_MAX = 12;

/** The workspace repository's remote `remote` set to the bare repository: added, or corrected. */
async function pointRemote(run, steps, remote, bankDir, env) {
  const r = await run(["remote", "get-url", remote], {});
  const url = r && r.ran && r.exitCode === 0 ? String(r.output || "").trim() : null;
  if (url === bankDir) return;
  await step(run, steps, url === null ? ["remote", "add", remote, bankDir] : ["remote", "set-url", remote, bankDir], env);
}

/** A new bare repository at `bankDir` whose main is the seed's, and the workspace's remote pointing at it. */
async function initBank(run, steps, bankDir, remote, env) {
  fs.mkdirSync(path.dirname(bankDir), { recursive: true });
  await step(run, steps, ["init", "-q", "--bare", "-b", "main", bankDir], env);
  await pointRemote(run, steps, remote, bankDir, env);
  await step(run, steps, ["push", "-q", remote, "refs/tags/seed/main:refs/heads/main"], env);
}

/**
 * The Bank's repository made again from scratch: a bare repository at `bankDir` (an absolute path) whose main is the
 * seed's main, and the workspace repository's remote `remote` pointing at it. Returns `{ dir, remote, steps }`; throws
 * with `.steps` on failure.
 */
async function buildBank({ run, bankDir, remote = "bank", seedEnv = {} }) {
  if (typeof bankDir !== "string" || !path.isAbsolute(bankDir)) throw new Error("the Bank's repository needs an absolute folder");
  const steps = [];
  fs.rmSync(bankDir, { recursive: true, force: true });
  await initBank(run, steps, bankDir, remote, seedEnv);
  return { dir: bankDir, remote, steps };
}

/**
 * The presenter's Commit (S6-D6 (a)): `paths` (relative to the workspace repository `repoDir`, each an existing file)
 * committed on `branch` (feature/…) as `author` with `message`, and the branch pushed to the Bank's repository. Only
 * the named paths are committed (`git commit -- <paths>`), whatever else the index holds. The Bank's repository is made
 * again first when it is missing: it lives outside the workspace, so a restarted pod loses it. The push replaces a
 * branch an earlier run of the demo pushed (`--force`): a demo run again after its reset starts its branch from main.
 * Returns `{ branch, commit, files: [{ status, path }], bankLog: [lines], remote, rebuilt, steps }`; throws with `.steps`.
 */
async function commitToBank({ run, repoDir, bankDir, remote = "bank", branch, paths, message, author, seedEnv = {} }) {
  if (!FEATURE_BRANCH.test(String(branch || "")) || !BRANCH_NAME.test(branch)) throw new Error(`not a feature branch: ${branch || "(none)"}`);
  const list = Array.isArray(paths) ? paths.map(String) : [];
  if (list.length === 0 || list.length > COMMIT_PATHS_MAX) throw new Error(`a commit names 1 to ${COMMIT_PATHS_MAX} files`);
  for (const rel of list) {
    const st = fs.statSync(inside(repoDir, rel), { throwIfNoEntry: false });
    if (!st || !st.isFile()) throw new Error(`not a file in the repository: ${rel}`);
  }
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > COMMIT_MESSAGE_MAX) throw new Error(`a commit message of 1 to ${COMMIT_MESSAGE_MAX} characters is required`);
  const a = author && typeof author === "object" ? author : {};
  if (!AUTHOR_NAME.test(String(a.name || "")) || !AUTHOR_EMAIL.test(String(a.email || ""))) throw new Error("the commit's author needs a name and an email address");
  if (typeof bankDir !== "string" || !path.isAbsolute(bankDir)) throw new Error("the Bank's repository needs an absolute folder");
  const steps = [];
  const rebuilt = !fs.existsSync(path.join(bankDir, "HEAD"));
  if (rebuilt) await initBank(run, steps, bankDir, remote, seedEnv);
  else await pointRemote(run, steps, remote, bankDir, seedEnv);
  const env = { GIT_AUTHOR_NAME: a.name, GIT_AUTHOR_EMAIL: a.email, GIT_COMMITTER_NAME: a.name, GIT_COMMITTER_EMAIL: a.email };
  await step(run, steps, ["checkout", "-q", "-B", branch], env);
  await step(run, steps, ["add", "--", ...list], env);
  const staged = await run(["diff", "--cached", "--quiet", "HEAD", "--", ...list], {});
  if (staged && staged.ran && staged.exitCode === 0) {
    const err = new Error("nothing to commit: these files are already committed as they are");
    err.steps = steps;
    throw err;
  }
  await step(run, steps, ["commit", "-q", "-m", text, "--", ...list], env);
  const commit = await step(run, steps, ["rev-parse", "HEAD"], env);
  const files = (await step(run, steps, ["diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"], env))
    .split("\n")
    .map((l) => l.trim().split(/\t+/))
    .filter((p) => p.length === 2)
    .map(([status, p]) => ({ status: status === "A" ? "added" : status === "M" ? "modified" : status === "D" ? "deleted" : status, path: p }));
  await step(run, steps, ["push", "-q", "--force", remote, `refs/heads/${branch}:refs/heads/${branch}`], env);
  const bankLog = (await step(run, steps, ["--git-dir", bankDir, "log", "-n", "5", "--format=%h %an %ad %s", "--date=iso-strict", `refs/heads/${branch}`], env)).split("\n").filter(Boolean);
  return { branch, commit, files, bankLog, remote, rebuilt, steps };
}

/** The content of `rel` at `ref` (`git show ref:rel`), or "" when the file is not there (a new file's left side). */
async function showAt({ run, ref, rel }) {
  if (!BRANCH_NAME.test(ref)) throw new Error(`bad ref: ${ref}`);
  if (typeof rel !== "string" || !rel || rel.split("/").includes("..") || rel.startsWith("/")) throw new Error(`bad path: ${rel}`);
  const r = await run(["show", `${ref}:${rel}`], {});
  return r && r.ran && r.exitCode === 0 ? String(r.output || "") : "";
}

/**
 * The folders under `dir` (itself included) whose entries this user cannot delete, relative to `dir` ("." for `dir`;
 * ".." when `parent` and `dir` itself cannot be removed from its parent), at most `limit`; a folder listed is not
 * descended. A reset checks with it before it deletes anything (2026-10-12: S3's Apply wrote the port's folders as
 * root, and a reset deleted half the repository before it met them).
 */
function unremovable(dir, { limit = 10, parent = true } = {}) {
  const out = [];
  const writable = (d) => {
    try {
      fs.accessSync(d, fs.constants.W_OK | fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (!fs.existsSync(dir)) return out;
  if (parent && !writable(path.dirname(dir))) out.push("..");
  const walk = (d) => {
    if (out.length >= limit) return;
    if (!writable(d)) {
      out.push(path.relative(dir, d) || ".");
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      out.push(path.relative(dir, d) || ".");
      return;
    }
    for (const e of entries) if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(d, e.name));
  };
  walk(dir);
  return out.slice(0, limit);
}

module.exports = { BRANCH_NAME, FEATURE_BRANCH, inside, readBranch, stagedBranches, buildSeedHistory, scenarioCheckout, showAt, unremovable, buildBank, commitToBank };
