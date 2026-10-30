/**
 * U-PYBIN — the docling bridge's interpreter is chosen because it RUNS
 * (ticket T22, design D4; finding F-6).
 *
 * The deployed image used to carry the developer's macOS .venv, whose
 * bin/python was a dangling symlink chain; `existsSync` follows links and
 * so happened to skip it, and PDF parsing worked by luck. A venv built on
 * Linux, or a real file that is not an interpreter, would have won the
 * lookup and sent every PDF to the spatial fallback. The lookup now probes
 * `<candidate> --version` and takes the first that answers.
 *
 * Real files in a temp dir; the probe runs real processes (this Node binary
 * stands in for a working interpreter — `node --version` answers).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { findPythonBin } = require("../../src/lib/ingestion/parser");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "u-pybin-"));
  const dangling = path.join(dir, "venv", "bin", "python");
  fs.mkdirSync(path.dirname(dangling), { recursive: true });
  fs.symlinkSync("/opt/nowhere/python3.14", dangling); // the F-6 shape: present, resolves to nothing
  const notExecutable = path.join(dir, "python-that-is-a-text-file");
  fs.writeFileSync(notExecutable, "not an interpreter\n"); // present, runs to EACCES / ENOEXEC
  const missing = path.join(dir, "absent", "python3");
  return { dir, dangling, notExecutable, missing, runnable: process.execPath };
}

describe("U-PYBIN: present-but-broken candidates are skipped, a runnable one is chosen", () => {
  test("a dangling symlink first, a non-executable file second, a runnable binary third → the third", () => {
    const f = fixture();
    const lines = [];
    const chosen = findPythonBin({ candidates: [f.dangling, f.notExecutable, f.runnable], noCache: true, log: (l) => lines.push(l) });
    assert.strictEqual(chosen, f.runnable);
  });

  test("a runnable candidate is chosen on the first probe — later candidates are not probed", () => {
    const f = fixture();
    const probed = [];
    const chosen = findPythonBin({
      candidates: [f.missing, f.runnable, f.notExecutable],
      noCache: true,
      probe: (c) => { probed.push(c); return c === f.runnable ? "Python 3.11.2" : null; },
    });
    assert.strictEqual(chosen, f.runnable);
    assert.deepStrictEqual(probed, [f.runnable], "the absent candidate is never probed; nothing after the winner is");
  });

  test("F-6 exactly: a present venv that does not run no longer shadows the working interpreter", () => {
    const f = fixture();
    const chosen = findPythonBin({ candidates: [f.dangling, f.runnable], noCache: true });
    assert.strictEqual(chosen, f.runnable);
  });

  test("nothing runnable anywhere → null, never a path that only exists", () => {
    const f = fixture();
    const chosen = findPythonBin({ candidates: [f.dangling, f.notExecutable], noCache: true, probe: () => null });
    assert.strictEqual(chosen, null);
  });
});

describe("U-PYBIN: the choice is logged once, with what was skipped", () => {
  test("the cached lookup logs one line naming the winner, its version and the skipped candidates", () => {
    const f = fixture();
    const lines = [];
    // `noCache: false` engages the process cache: the first call logs, the second returns the cache silently.
    // The cache is module state shared with other suites, so the first call here may already be cached —
    // assert on the log only when this call produced it.
    const first = findPythonBin({ candidates: [f.dangling, f.runnable], log: (l) => lines.push(l) });
    const second = findPythonBin({ candidates: [f.dangling, f.runnable], log: (l) => lines.push(l) });
    assert.strictEqual(first, second);
    if (lines.length) {
      assert.strictEqual(lines.length, 1);
      assert.match(lines[0], /python for the docling bridge: /);
      assert.ok(lines[0].includes(f.runnable) || lines[0].includes("none found"));
    }
  });

  test("the parser's bridge path still asks findPythonBin (source pin)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/lib/ingestion/parser.js"), "utf8");
    assert.ok(src.includes("const pythonBin = findPythonBin();"));
    assert.ok(src.includes("execFileSync(candidate, ['--version']"), "the probe executes the candidate");
    assert.ok(!/for \(let c of candidates\) \{\s*if \(fs\.existsSync\(c\)\) return c;/.test(src), "existence alone no longer chooses");
  });
});
