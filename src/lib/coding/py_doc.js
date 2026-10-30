/**
 * src/lib/coding/py_doc.js — S6's Python documentation, on the app's side (the owner's S6-D3 (a) of 2026-10-13: the
 * check itself reads the module's syntax tree in the IDE container, code-server-ext/nexcode-bridge/py_doc_check.py).
 *
 * Pure (no I/O).
 *   pythonUnitsOf(text)            the classes, functions and methods of a module, for a comments turn's prompt: a line
 *                                  that opens one (`class`, `def`, `async def`) outside a triple-quoted string, named by
 *                                  its enclosing classes and functions. A prompt aid only: the check reads the tree.
 *   pythonUnitsBlock(path, text)   the UNITS block a comments turn's prompt carries, as S5's lists COBOL's units; a
 *                                  dataclass's field lines are named as code to keep (session-90-s6-instructions: a
 *                                  general instruction left 5 of 6 dataclass answers without their fields); a function
 *                                  that builds or rounds a Decimal is named as money logic, whose docstring names its
 *                                  requirement, PAY-012 (DOC-006; session-90-s6-measure: 1 of 5 answers left one untagged, then tagged it
 *                                  PAY-030, the audit-event rule, when the note said only "such as PAY-012").
 *   summarisePyDocumentation(...)  a test run's one-line summary when the run carries the check.
 *   pyReportText(result)           the check's report, as the test run's output shows it.
 */

const asString = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const UNIT_LINE = /^([ \t]*)(?:(async[ \t]+)?def|(class))[ \t]+([A-Za-z_][A-Za-z0-9_]*)/;

const DATACLASS = /^[ \t]*@(?:dataclasses\.)?dataclass\b/;
/** Money logic, as the check reads it (py_doc_check.py is_money_logic): a Decimal built, or one rounded. */
const MONEY_CALL = /\bDecimal\s*\(|\.quantize\s*\(/;
const FIELD = /^[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*:[ \t]*\S/;

/**
 * `[{ line, name, kind, fields?, money? }]`: kind is class, function or method (a function directly inside a class); a
 * dataclass carries `fields: { first, last, count }`, its annotated field lines before its first method; a function whose
 * own code builds or rounds a Decimal carries `money: true`.
 */
function pythonUnitsOf(text) {
  const out = [];
  const stack = []; // { indent, name, kind }
  let quote = null; // the triple quote of an open string
  const all = asString(text).replace(/\r\n/g, "\n").split("\n");
  let open = null; // the dataclass whose field lines are being counted: { unit, indent }
  all.forEach((line, i) => {
      if (open && !quote && line.trim()) {
        const indent = line.replace(/\t/g, "    ").match(/^ */)[0].length;
        if (indent <= open.indent || UNIT_LINE.test(line)) open = null;
        else if (FIELD.test(line)) {
          const f = open.unit.fields || (open.unit.fields = { first: i + 1, last: i + 1, count: 0 });
          f.last = i + 1;
          f.count += 1;
        }
      }
      // Money logic: the innermost function open at this line (outside a string) builds or rounds a Decimal.
      // The line's code only: its strings (a one-line docstring included) and a trailing comment set aside.
      const code = line
        .replace(/("""|''')[\s\S]*?\1/g, "")
        .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "")
        .replace(/("""|''').*$/, "")
        .replace(/#.*$/, "");
      if (!quote && MONEY_CALL.test(code)) {
        const fn = [...stack].reverse().find((x) => x.kind === "function" && line.replace(/\t/g, "    ").match(/^ */)[0].length > x.indent);
        if (fn && fn.unit) fn.unit.money = true;
      }
      if (!quote) {
        const m = line.match(UNIT_LINE);
        if (m) {
          const indent = m[1].replace(/\t/g, "    ").length;
          while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
          const parent = stack[stack.length - 1] || null;
          const kind = m[3] ? "class" : parent && parent.kind === "class" ? "method" : "function";
          const name = [...stack.map((x) => x.name), m[4]].join(".");
          const unit = { line: i + 1, name, kind };
          out.push(unit);
          stack.push({ indent, name: m[4], kind: m[3] ? "class" : "function", unit });
          let d = i - 1;
          while (d >= 0 && /^[ \t]*@/.test(all[d])) d -= 1;
          if (m[3] && all.slice(d + 1, i).some((l) => DATACLASS.test(l))) open = { unit, indent };
        }
      }
      // Triple-quoted strings open and close on this line (a docstring's own `def` is not a unit).
      let at = 0;
      while (at < line.length) {
        const pos = quote ? line.indexOf(quote, at) : Math.min(...['"""', "'''"].map((q) => line.indexOf(q, at)).map((x) => (x < 0 ? Infinity : x)));
        if (pos < 0 || pos === Infinity) break;
        if (!quote) quote = line.slice(pos, pos + 3);
        else quote = null;
        at = pos + 3;
      }
    });
  return out;
}

/** The UNITS block for a Python comments turn: each unit needs a docstring (DOC-002, CLR-WIKI-024 C2). */
function pythonUnitsBlock(relPath, text) {
  return [
    `UNITS (found by a tool in ${relPath}: each class, function and method needs a docstring saying what it does and why)`,
    ...pythonUnitsOf(text).map(
      (u) =>
        `- line ${u.line}: ${u.kind} ${u.name}${u.fields ? ` (a dataclass: its ${u.fields.count} field lines, ${u.fields.first} to ${u.fields.last}, are code: keep them, below its docstring)` : ""}${u.money ? " (money logic: it builds or rounds a Decimal, which PAY-012 governs (monetary values: types and rounding); its docstring names that requirement)" : ""}`
    ),
  ].join("\n");
}

/** The rules a run's check failed, in the order the standard numbers them. */
const failedRules = (result) =>
  Object.entries((result && result.rules) || {})
    .filter(([, ok]) => !ok)
    .map(([id]) => id)
    .sort();

/**
 * A run's summary when it carries the Python check: the tests first (their own summary), then the check. A run whose
 * tests failed is summarised by its tests alone, as S5's program check is.
 */
function summarisePyDocumentation(programSummary, result, programPassed) {
  if (!result) return programSummary;
  if (result.error) return `the documentation check could not run: ${result.error}`;
  if (!programPassed) return programSummary;
  if (result.passed) {
    return `${programSummary}; documented to the standard${result.compared ? ", no line of code changed" : ""} (${result.units.commented} of ${result.units.total} units)`;
  }
  return `${programSummary}; the documentation check failed (${failedRules(result).join(", ")})${result.compared && result.codeUnchanged === false ? ": a line of code changed" : ""}`;
}

/** The check's report, as the test run's output shows it. */
function pyReportText(result) {
  const r = result || {};
  if (r.error) return `Documentation check (STD-DOC): could not run: ${r.error}`;
  const units = r.units || { commented: 0, total: 0 };
  const money = r.money || { tagged: 0, total: 0 };
  const head = r.passed
    ? `Documentation check (STD-DOC), by the module's syntax tree: passed. ${r.compared ? "No line of code changed (DOC-008); " : ""}the header has every field (DOC-001); ${units.commented} of ${units.total} classes and functions are documented (DOC-002); no card number (DOC-004) and no commented-out code (DOC-005); money logic names its requirement in ${money.tagged} of ${money.total} functions (DOC-006); the header names the assistant (DOC-007).`
    : "Documentation check (STD-DOC), by the module's syntax tree: FAILED.";
  const notCompared = r.compared ? [] : ["Note: the code was not compared with an earlier version in this run: the module's latest change was a change of code, not a comments-only change."];
  return [head, ...(r.findings || []).map((f) => `- ${f}`), ...(r.notes || []), ...notCompared].join("\n");
}

module.exports = { pythonUnitsOf, pythonUnitsBlock, summarisePyDocumentation, pyReportText, failedRules };
