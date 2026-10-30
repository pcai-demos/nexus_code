/**
 * src/lib/coding/record.js — the evidence record (Machinery PR 1: brief §8 M5 skeleton; design §7; decision D8 (a)).
 *
 * Pure (no I/O). The record is built by the system from its own run log (src/lib/coding/runlog.js), never written by
 * the model: what each turn was asked, which model answered and how (thinking mode, tokens, time), which passages it
 * cited from which layer, which markers matched nothing (unverified), which files it proposed and which the presenter
 * applied, each test run with its exit code, and the repository's changes against the seed commit. The approver is
 * "pending" until a person signs. `verification` stays empty until the scanner (M4, Machinery PR 2) fills it.
 *
 * PR B (the owner's D1 (b) and D3 of 2026-10-07): each cited rule carries the passage's text when the turn kept it, and
 * `changes.files` carries the code change against the seed as unified-diff hunks (computed by the route, diff.js), so
 * the Results panel can quote the rules and show the change; the Markdown gains both.
 *
 * 0.4 (D11 (a) of 2026-10-10): each cited rule says how it was found (`via`: the search, or the trace through the
 * documents' "Traces to:" lines) and the findings it traces from (`tracedFrom`); the Markdown's rules table gains a
 * "How found" column.
 *
 * 0.5 (S3, 2026-10-10): a test run keeps its steps (each program's exit code and role), and `verification.equivalence`
 * records a migration's proof: the new program's report against the COBOL program's on the same fixture, compared by
 * `diff` (MIG-001, verified by tool), with the legacy program's own check and the port's characterisation test.
 *
 * 0.6 (S3-D14 (b) of 2026-10-12): the record's outcome; a failed attempt is recorded as not ready for review.
 *
 * 0.7 (S4-D4 (a) of 2026-10-12): the record's `kind`: "change", or "answer" for a demo whose steps change no code (S4,
 * the auditor's question), which keeps the question and NexCODE's answer, the rules cited and the chain each was traced
 * through, and says that it changed no code and ran no tests. Each turn says its mode; an audit turn keeps its answer.
 *
 * 0.8 (S5, the owner's S5-D10 (a) of 2026-10-12): `verification.documentation` keeps a comments-only change's proof,
 * verified by tool: no line of code changed (DOC-008), the program's own check, the header (DOC-001), the units'
 * comments (DOC-002), no card number (DOC-004) and no commented-out code (DOC-005). DOC-003 stays the reviewer's.
 *
 * 0.9 (S5-D14 (a) of 2026-10-12): a comments turn keeps the code lines a tool put back (`codeKept`: the line, what the
 * answer had, what the program has), and `verification.documentation.restoredByTool` names them for the change the
 * check verified, so the record says that the code is unchanged because a tool kept it, not only that it is unchanged.
 *
 * 0.10 (S6, the owner's S6-D1 to S6-D7 of 2026-10-13): `verification.documentation` may be the Python check's (the
 * module's syntax tree, read in the IDE: `language: "python"`), with the run that proved the comments-only change
 * (`codeUnchangedProof`) when a later change of code ran the check without comparing; `verification.improvement` keeps
 * the test-and-improve step's recommendations and the test results before and after (S6-D4 (a)); `commit` is null in
 * the record a commit carries, and the archive's copy gains the commit afterwards (S6-D6 (a), S6-D7 (a)). commitMessage
 * builds the commit's message from the record.
 */

const RECORD_SCHEMA = "nexcode.evidence/0.12";
/** The modes whose steps change code, from steps.js (one list: S5's comments joined it): a demo with none records an answer. */
const { CODE_MODES } = require("./steps");
const { demoUsage } = require("./usage");
const { priceUsage, formatMoney, EMPTY_PRICING } = require("./pricing");
const ANSWER_CHARS = 12000;
const { diffText } = require("./diff");
const { chatText } = require("./chat_text");
const EXCERPT_CHARS = 4000;
const RECOMMENDATIONS_CHARS = 6000;

/** The events of one scenario since its last reset (a reset of everything, or of this scenario). Apply events carry no scenario and are kept. */
function eventsSinceReset(events, scenarioId) {
  const list = Array.isArray(events) ? events : [];
  let start = 0;
  list.forEach((e, i) => {
    if (e && (e.kind === "reset-all" || (e.kind === "reset-scenario" && e.scenario === scenarioId))) start = i + 1;
  });
  return list.slice(start).filter((e) => e && (e.scenario === scenarioId || e.kind === "apply"));
}

/**
 * S4-D2 (a) of 2026-10-12: the record the closer shows: the newest `record` line written since the environment's last
 * reset by a demo other than `exclude` (the closer itself), whose file the archive still holds (`archivedNames`);
 * null when there is none (the closer then shows the shipped example record).
 */
function latestRecordSince(events, { exclude = null, archivedNames = [] } = {}) {
  const list = Array.isArray(events) ? events : [];
  let start = 0;
  list.forEach((e, i) => {
    if (e && e.kind === "reset-all") start = i + 1;
  });
  const archived = new Set(Array.isArray(archivedNames) ? archivedNames : []);
  const hits = list
    .slice(start)
    .filter((e) => e && e.kind === "record" && typeof e.scenario === "string" && e.scenario !== exclude && typeof e.recordId === "string")
    .filter((e) => (Array.isArray(e.archived) ? e.archived : []).some((n) => archived.has(n)));
  const last = hits[hits.length - 1];
  return last ? { recordId: last.recordId, scenario: last.scenario, at: last.at || null } : null;
}

/** A one-line summary of a unittest run: "6 passed", "2 of 6 failed", or the exit code. */
function summariseTestOutput(output, exitCode) {
  const text = typeof output === "string" ? output : "";
  // JUnit's console launcher and cargo test (S3's ports).
  const junitOk = text.match(/\[\s*(\d+) tests successful\s*\]/);
  const junitFailed = text.match(/\[\s*(\d+) tests failed\s*\]/);
  if (junitOk && junitFailed) {
    const ok = Number(junitOk[1]);
    const bad = Number(junitFailed[1]);
    return bad === 0 && exitCode === 0 ? `${ok} passed` : `${bad} of ${ok + bad} failed`;
  }
  const cargo = [...text.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed/g)];
  if (cargo.length) {
    const passed = cargo.reduce((n, m) => n + Number(m[1]), 0);
    const failed = cargo.reduce((n, m) => n + Number(m[2]), 0);
    return failed === 0 && exitCode === 0 ? `${passed} passed` : `${failed} of ${passed + failed} failed`;
  }
  const ran = text.match(/Ran (\d+) tests? in [\d.]+s/);
  const total = ran ? Number(ran[1]) : null;
  const failed = text.match(/FAILED \(([^)]*)\)/);
  if (total !== null && /\nOK\b/.test(text) && exitCode === 0) return `${total} passed`;
  if (total !== null && failed) {
    const n = failed[1]
      .split(",")
      .map((x) => x.trim())
      .reduce((sum, part) => {
        const m = part.match(/^(failures|errors)=(\d+)$/);
        return sum + (m ? Number(m[2]) : 0);
      }, 0);
    return `${n} of ${total} failed`;
  }
  return exitCode === 0 ? "passed" : `exit code ${exitCode === null || exitCode === undefined ? "unknown" : exitCode}`;
}

/**
 * A run's summary from its steps when they carry roles (S3): which check it reached and how it ended, in words; null
 * when the run has no roles (S1, S2: summariseTestOutput reads their output).
 */
function summariseSteps(output, exitCode, steps) {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.some((st) => st && st.role)) return null;
  const legacy = list.find((st) => st.role === "legacy");
  const eq = list.find((st) => st.role === "equivalence");
  const ch = list.find((st) => st.role === "characterisation");
  const failed = list.find((st) => !st.ran || st.exitCode !== 0);
  const tests = summariseTestOutput(output, ch ? ch.exitCode : exitCode);
  if (failed && failed === legacy) return "the COBOL's report differs from expected_totals.txt";
  if (failed && failed.role === "equivalence") return "the port's report differs from the COBOL's";
  if (failed && failed.role === "characterisation") return `byte-identical to the COBOL; the characterisation test failed (${tests})`;
  if (failed) return `${eq ? "the port" : "the legacy program"} did not build or run (${failed.command.split(" ")[0]}, exit ${failed.ran ? failed.exitCode : "not run"})`;
  if (eq && ch) return `byte-identical to the COBOL; ${tests}`;
  if (eq) return "byte-identical to the COBOL";
  return legacy ? "the COBOL's report matches expected_totals.txt" : exitCode === 0 ? "passed" : `exit code ${exitCode}`;
}

/**
 * S5: a run's summary when it carries the documentation check: the program's own check first (its summary from
 * summariseSteps), then the check's verdict.
 */
function summariseDocumentation(programSummary, result, programPassed) {
  if (!result) return programSummary;
  if (result.error) return `the documentation check could not run: ${result.error}`;
  if (!programPassed) return programSummary;
  if (result.passed) return `no line of code changed; ${programSummary}; the header complete and ${result.units.commented} of ${result.units.total} units commented`;
  const failed = Object.entries(result.rules || {})
    .filter(([, ok]) => !ok)
    .map(([id]) => id);
  return `the documentation check failed (${failed.join(", ")})${result.codeUnchanged ? "" : ": a line of code changed"}`;
}

/** S5: the documentation check as the run log keeps it (the findings' text, not the program). S6: the Python check's too. */
function compactDocumentation(result) {
  if (!result) return null;
  if (result.error) return { error: result.error, passed: false, ...(result.language ? { language: result.language } : {}) };
  if (result.language === "python") {
    return {
      language: "python",
      tool: "py_doc_check (the module's syntax tree)",
      passed: result.passed,
      compared: Boolean(result.compared),
      codeUnchanged: result.compared ? result.codeUnchanged : null,
      firstDifference: result.firstDifference || null,
      rules: result.rules,
      headerMissing: result.header ? result.header.missing : [],
      units: result.units,
      money: result.money || null,
      aiDisclosure: result.aiDisclosure || null,
      cardNumbers: result.cardNumbers || [],
      commentedOutCode: result.commentedOutCode || [],
      findings: result.findings || [],
      notes: result.notes || [],
    };
  }
  return {
    passed: result.passed,
    codeUnchanged: result.codeUnchanged,
    firstDifference: result.firstDifference,
    rules: result.rules,
    headerMissing: result.header.missing,
    units: result.units,
    cardNumbers: result.cardNumbers,
    commentedOutCode: result.commentedOutCode,
    beyondColumn72: result.beyondColumn72.length,
    findings: result.findings,
  };
}

/** A run's equivalence (S3, MIG-001) from its steps: null when the run has no equivalence step. */
function equivalenceOf(run) {
  const steps = run && Array.isArray(run.steps) ? run.steps : [];
  const eq = steps.find((st) => st.role === "equivalence");
  if (!eq) return null;
  const legacy = steps.find((st) => st.role === "legacy");
  const ch = steps.find((st) => st.role === "characterisation");
  return {
    at: run.at || null,
    command: run.command || null,
    comparedWith: "the COBOL program's report on the same fixture, produced in the same run",
    identical: Boolean(eq.ran && eq.exitCode === 0),
    legacyMatchesExpected: legacy ? Boolean(legacy.ran && legacy.exitCode === 0) : null,
    characterisationPassed: ch ? Boolean(ch.ran && ch.exitCode === 0) : null,
    verifiedBy: "tool",
  };
}

/** "answer" when the scenario's steps change no code (S4), else "change" (a scenario given without its steps too). */
function recordKind(scenario) {
  const steps = scenario && Array.isArray(scenario.steps) ? scenario.steps : [];
  return steps.length > 0 && !steps.some((st) => CODE_MODES.includes(st.mode) || (!st.action && !st.mode && Array.isArray(st.after) && st.after.includes("run-tests"))) ? "answer" : "change";
}

/** The record as JSON and Markdown. */
/** 0.9: a comments turn's code-keeping as the record keeps it: the lines a tool put back, never the file itself. */
function keptOf(k) {
  const restored = (Array.isArray(k.restored) ? k.restored : []).map((r) => ({
    kind: r.kind,
    originalLine: Number.isInteger(r.originalLine) ? r.originalLine : null,
    answerLine: Number.isInteger(r.answerLine) ? r.answerLine : null,
    was: typeof r.was === "string" ? r.was : null,
    now: typeof r.now === "string" ? r.now : null,
  }));
  return { path: typeof k.path === "string" ? k.path : null, restored, refused: k.refused || null };
}

/** One put-back line, as the Markdown says it. */
const keptLine = (r) =>
  r.kind === "changed"
    ? `line ${r.originalLine} put back (the answer had \`${String(r.was || "").trim()}\`)`
    : r.kind === "lost"
      ? `line ${r.originalLine} put back (the answer left it out)`
      : `a line of code the answer added removed (\`${String(r.was || "").trim()}\`)`;

function buildEvidenceRecord({ scenario, events, changes = null, platform = {}, firm = null, recordId, now = new Date(), review = null, failed = null, pricing = EMPTY_PRICING } = {}) {
  if (!scenario || !scenario.id) throw new Error("buildEvidenceRecord: a scenario is required");
  if (!recordId) throw new Error("buildEvidenceRecord: a record id is required");
  const kind = recordKind(scenario);
  const window = eventsSinceReset(events, scenario.id);
  const applied = window.filter((e) => e.kind === "apply" && e.ok === true);
  const turns = window.filter((e) => e.kind === "turn");
  const tests = window.filter((e) => e.kind === "test-run");

  const turnsOut = turns.map((t) => ({
    turnId: t.turnId,
    at: t.at,
    step: t.step || null,
    mode: t.mode || null,
    prompt: t.prompt,
    model: t.model,
    endpointHost: t.endpointHost || null,
    thinking: t.thinking ? { mode: t.thinking.mode, form: t.thinking.form, reasoningChars: t.thinking.reasoningChars } : null,
    tokens: t.tokens || null,
    timing: t.timing || null,
    attached: (Array.isArray(t.attached) ? t.attached : []).map((f) => ({ path: f.path, source: f.source, sha256: f.sha256 })),
    layers: (Array.isArray(t.layers) ? t.layers : []).map((l) => ({ id: l.id, documents: l.documents, passages: l.passages, state: l.state, searchedOn: l.searchedOn || null, search: l.search || null })),
    cited: Array.isArray(t.cited) ? t.cited : [],
    unverifiedMarkers: Array.isArray(t.unverified) ? t.unverified : [],
    fileOperations: (Array.isArray(t.fileOperations) ? t.fileOperations : []).map((p) => ({ path: p, applied: applied.some((a) => a.path === p && String(a.at) >= String(t.at)) })),
    success: t.success === true,
    finishReason: t.finishReason || null,
    // 0.7: an audit turn's answer is what the record keeps (the auditor's question answered); a change keeps its diff.
    ...(t.mode === "audit" ? { answer: typeof t.answer === "string" ? t.answer.slice(0, ANSWER_CHARS) : "", regulatorTrace: t.regulatorTrace || null } : {}),
    // 0.9: the code lines a tool put back in a comments turn's program (the file itself is in the change's diff).
    ...(t.codeKept && typeof t.codeKept === "object" ? { codeKept: keptOf(t.codeKept) } : {}),
  }));

  const rules = [];
  const seenRule = new Set();
  for (const t of turns) {
    const byMarker = new Map((Array.isArray(t.passages) ? t.passages : []).map((p) => [p.marker, p]));
    const textByMarker = new Map((Array.isArray(t.citedPassages) ? t.citedPassages : []).map((p) => [p.marker, p.text]));
    for (const mk of Array.isArray(t.cited) ? t.cited : []) {
      const p = byMarker.get(mk);
      if (!p) continue;
      const key = `${p.source}|${p.page}|${p.sectionPath}`;
      if (seenRule.has(key)) continue;
      seenRule.add(key);
      rules.push({
        marker: mk,
        layer: p.pillar,
        source: p.source,
        page: p.page,
        sectionPath: p.sectionPath || null,
        turnId: t.turnId,
        text: textByMarker.get(mk) || null,
        // D11 (a) of 2026-10-10: a passage looked up through the documents' trace lines, and the findings it traces from.
        via: p.via || "search",
        tracedFrom: Array.isArray(p.tracedFrom) ? p.tracedFrom : [],
      });
    }
  }

  const testsOut = tests.map((r) => ({
    command: r.command,
    at: r.at,
    exitCode: r.exitCode === undefined ? null : r.exitCode,
    durationMs: r.durationMs === undefined ? null : r.durationMs,
    summary: r.summary || summariseTestOutput(r.excerpt, r.exitCode),
    excerpt: typeof r.excerpt === "string" ? r.excerpt.slice(-EXCERPT_CHARS) : "",
    steps: Array.isArray(r.steps) ? r.steps : null,
  }));
  // S3: the latest run with an equivalence step is the migration's proof (the step gate requires it after the last Apply).
  const lastEq = [...tests].reverse().find((r) => equivalenceOf(r));
  // S5: the latest run with the documentation check is the comments-only change's proof.
  const lastDoc = [...tests].reverse().find((r) => r.documentation && typeof r.documentation === "object");
  // 0.9: the comments turn that change came from (the latest before that run), and the lines a tool put back in it.
  const keptTurn = lastDoc ? [...turns].reverse().find((t) => t.codeKept && typeof t.codeKept === "object" && String(t.at) <= String(lastDoc.at)) : null;
  // 0.10 (S6): the run that proved the comments-only change, when a later change of code ran the check without comparing.
  const lastCompared = lastDoc && lastDoc.documentation.language === "python" && !lastDoc.documentation.compared ? [...tests].reverse().find((r) => r.documentation && r.documentation.compared === true) : null;
  // 0.10 (S6-D4 (a)): the test-and-improve step: its recommendations, and the test results before and after it.
  const improveTurn = [...turns].reverse().find((t) => t.mode === "improve" && t.success === true) || null;
  const runBrief = (r) => (r ? { at: r.at || null, command: r.command || null, exitCode: r.exitCode === undefined ? null : r.exitCode, summary: r.summary || summariseTestOutput(r.excerpt, r.exitCode) } : null);
  const improvement = improveTurn
    ? {
        turnId: improveTurn.turnId || null,
        at: improveTurn.at || null,
        recommendations: chatText(typeof improveTurn.answer === "string" ? improveTurn.answer : "", { mode: "change" }).slice(0, RECOMMENDATIONS_CHARS),
        before: runBrief([...tests].reverse().find((r) => String(r.at) <= String(improveTurn.at))),
        after: runBrief([...tests].reverse().find((r) => String(r.at) > String(improveTurn.at))),
        verifiedBy: "tool (the test runs); the recommendations are NexCODE's, for the reviewer",
      }
    : null;

  const json = {
    schema: RECORD_SCHEMA,
    id: recordId,
    kind,
    createdAt: now.toISOString(),
    builtBy: "NexCODE, from its run log (no model wrote this record)",
    firm: firm || null,
    scenario: { id: scenario.id, title: scenario.title, ticket: scenario.ticket ? scenario.ticket.id : null },
    turns: turnsOut,
    tests: testsOut,
    changes: changes || null,
    rules,
    review: review
      ? {
          outcome: review.outcome,
          counts: review.counts || null,
          findings: (review.findings || []).map((f) => ({ id: f.id, established: f.established, severity: f.severity, title: f.title, path: f.path, line: f.line, rules: f.rules || [], status: f.status || "open", why: f.why || "" })),
          followUps: (review.findings || []).some((f) => f.check === "secrets") ? ["The exposed secret must be revoked and replaced (SCS-011), even though the code no longer holds it."] : [],
        }
      : null,
    verification: {
      toolVerified: review ? (review.findings || []).filter((f) => f.established === "tool").map((f) => ({ id: f.id, rule: (f.rules || [])[0] || null, severity: f.severity, status: f.status || "open" })) : [],
      assistantAssessed: review ? (review.findings || []).filter((f) => f.established !== "tool").map((f) => ({ id: f.id, rules: f.rules || [], severity: f.severity, status: f.status || "open" })) : [],
      equivalence: lastEq ? equivalenceOf(lastEq) : null,
      documentation: lastDoc
        ? {
            at: lastDoc.at || null,
            command: lastDoc.command || null,
            ...lastDoc.documentation,
            programCheckPassed: (Array.isArray(lastDoc.steps) ? lastDoc.steps : []).filter((st) => st.role !== "documentation").every((st) => st.ran !== false && st.exitCode === 0),
            restoredByTool: keptTurn ? keptOf(keptTurn.codeKept).restored : [],
            ...(lastCompared ? { codeUnchangedProof: { at: lastCompared.at || null, command: lastCompared.command || null, codeUnchanged: lastCompared.documentation.codeUnchanged } } : {}),
            assessedByReviewer: ["DOC-003"],
            verifiedBy: "tool",
          }
        : null,
      improvement,
    },
    // 0.11 (polish Phase 2; PL-D9 (a) and PL-D13 (a) of 2026-10-14): the tokens per step and in all since the demo was
    // selected, with the free-form answers, and the coding turns' tokens apportioned by character share.
    // 0.12 (polish Phase 3; PL-D10 to PL-D12 (a)): each sum's cost at the prices in force when the record was built, the
    // rows used stamped beside it (pricingUsed), "no price set" when a model had no row and no default.
    usage: priceUsage({ demo: demoUsage(events, scenario) }, pricing).demo,
    // S6-D6 (a): the commit this record went in; null here, set in the archive's copy after the commit.
    commit: null,
    // S3-D14 (b): a failed attempt is kept honestly: not ready for review, and no approval is asked for.
    outcome: failed
      ? { status: "not ready for review", reason: "the tests failed", step: failed.step || null, lastRun: { at: failed.at || null, exitCode: failed.exitCode === undefined ? null : failed.exitCode, summary: failed.summary || null } }
      : { status: "ready for review", reason: null, step: null, lastRun: null },
    approval: failed ? { status: "not requested", approver: null } : { status: "pending", approver: null },
    platform: platform || {},
  };
  return { json, markdown: renderMarkdown(json) };
}

const cell = (v) => String(v === null || v === undefined || v === "" ? "—" : v).replace(/\|/g, "\\|").replace(/\n/g, " ");
const LAYER_NAMES = { regulator: "External regulation", corporate: "Corporate policy", sdlc: "Engineering standards", team: "Team knowledge" };
/** How a cited passage was found: by the search, traced from findings' rules, or both. */
const howFound = (x) => {
  const from = Array.isArray(x.tracedFrom) && x.tracedFrom.length ? x.tracedFrom.join(", ") : "";
  if (x.via === "trace") return `traced from ${from || "a rule"}`;
  return from ? `search; on ${from}'s chain` : "search";
};

/** An answer kept as a quotation, line by line, so its own headings and lists stay inside the record's section. */
const quoted = (text) =>
  String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");

function renderMarkdown(r) {
  const out = [];
  const answer = r.kind === "answer";
  out.push(`# Evidence record ${r.id}`, "");
  out.push("| Field | Value |", "|---|---|");
  out.push(`| Scenario | ${cell(`${r.scenario.id.toUpperCase()} — ${r.scenario.title}`)} |`);
  out.push(`| Ticket | ${cell(r.scenario.ticket)} |`);
  if (answer) out.push("| Kind | An answer to a question: no code was changed |");
  if (r.firm) out.push(`| Firm | ${cell(r.firm)} |`);
  out.push(`| Created | ${cell(r.createdAt)} |`);
  if (r.outcome) out.push(`| Outcome | ${cell(r.outcome.status === "not ready for review" ? `Not ready for review: ${r.outcome.reason}${r.outcome.lastRun && r.outcome.lastRun.summary ? ` (${r.outcome.lastRun.summary})` : ""}` : answer ? "Ready for review: a person reviews the answer before it is given" : "Ready for review")} |`);
  out.push(`| Approval | ${cell(r.approval.status)}${r.approval.approver ? ` (${cell(r.approval.approver)})` : ""} |`);
  out.push(`| Built by | ${cell(r.builtBy)} |`, "");
  if (r.outcome && r.outcome.status === "not ready for review") {
    out.push("**This record keeps a failed attempt.** The change did not pass its tests, so it is not ready for review and nothing ships. Asking NexCODE to fix the failing tests continues the demo; a record of passing tests then replaces this one.", "");
  }

  if (r.review) {
    const rv = r.review;
    out.push("## Review", "");
    out.push(`Outcome: **${cell(rv.outcome)}** (REV-007). Tool findings are verified by the pre-merge checks; reviewer findings were assessed with an AI assistant and stay open until a reviewer closes them (REV-004, REV-006).`, "");
    out.push("| ID | Severity | Finding | Where | Rules | Established | Status |", "|---|---|---|---|---|---|---|");
    for (const f of rv.findings) out.push(`| ${cell(f.id)} | ${cell(f.severity)} | ${cell(f.title)} | ${cell(`${f.path}:${f.line}`)} | ${cell((f.rules || []).join(", "))} | ${cell(f.established === "tool" ? "verified by tool" : "assessed by the reviewer")} | ${cell(f.status)} |`);
    out.push("");
    for (const x of rv.followUps || []) out.push(`- Follow-up: ${x}`);
    if ((rv.followUps || []).length) out.push("");
  }

  if (answer) {
    out.push("## The question and the answer", "");
    const asked = r.turns.filter((t) => t.mode === "audit");
    if (asked.length === 0) out.push("No question was answered in this demo since its last reset.", "");
    asked.forEach((t, i) => {
      out.push(`### ${i + 1}. ${cell(t.prompt)}`, "");
      out.push(`Answered by ${cell(t.model)} at ${cell(t.at)}, from the passages listed under Rules cited; every marker it uses was checked against them${t.unverifiedMarkers.length ? ` (unverified: ${t.unverifiedMarkers.join(", ")})` : ""}.`, "");
      out.push(t.answer ? quoted(t.answer) : "> (no answer text was kept)", "");
    });
  }

  out.push("## Rules cited", "");
  if (answer && r.rules.some((x) => x.via === "trace")) out.push('"Traced" passages were looked up, not searched: the regulation a policy clause\'s or a standard\'s own "Traces to:" line names, found in the regulation\'s text.', "");
  else if (r.rules.some((x) => x.via === "trace")) out.push('"Traced" passages were looked up from a tool finding\'s rule through the documents\' own "Traces to:" lines, not searched.', "");
  if (r.rules.length === 0) out.push("No passage was cited.", "");
  else {
    out.push("| Layer | Marker | Source | Location | How found | Turn |", "|---|---|---|---|---|---|");
    for (const x of r.rules) out.push(`| ${cell(LAYER_NAMES[x.layer] || x.layer)} | ${cell(x.marker)} | ${cell(x.source)} | ${cell(x.page !== null && x.page !== undefined ? `page ${x.page}` : x.sectionPath)} | ${cell(howFound(x))} | ${cell(x.turnId)} |`);
    out.push("");
    for (const x of r.rules.filter((y) => y.text)) {
      out.push(`> **${x.marker}** ${x.source}${x.page !== null && x.page !== undefined ? `, page ${x.page}` : ""}: ${String(x.text).replace(/\s+/g, " ").trim().slice(0, 600)}`, "");
    }
  }

  // 0.11: the tokens, per step and in all, then the apportioned split.
  out.push("## Tokens", "");
  if (!r.usage || !r.usage.totals || r.usage.totals.answers === 0) out.push("No answer was recorded for this demo since it was selected.", "");
  else {
    const u = r.usage;
    const note = (x) => `${x.answers}${x.estimated ? ` (${x.estimated} estimated by the app)` : ""}${x.uncounted ? ` (${x.uncounted} with no figure)` : ""}`;
    const cost = (x) => (x.cost ? formatMoney(x.cost.amount, x.cost.currency) : "—");
    out.push("| Step | Answers | Tokens in | Tokens out | Total | Cost |", "|---|---|---|---|---|---|");
    for (const st of u.steps) out.push(`| ${cell(st.title)}${st.repairs ? ` (+${st.repairs} repair${st.repairs === 1 ? "" : "s"})` : ""} | ${note(st)} | ${cell(st.prompt)} | ${cell(st.completion)} | ${cell(st.total)} | ${cost(st)} |`);
    if (u.freeForm.answers) out.push(`| Free-form, in this demo | ${note(u.freeForm)} | ${cell(u.freeForm.prompt)} | ${cell(u.freeForm.completion)} | ${cell(u.freeForm.total)} | ${cost(u.freeForm)} |`);
    out.push(`| **Total** | ${note(u.totals)} | **${cell(u.totals.prompt)}** | **${cell(u.totals.completion)}** | **${cell(u.totals.total)}** | **${cost(u.totals)}** |`, "");
    out.push("Tokens as the model server reported them for each answer; an estimate is marked as one.", "");
    // 0.12: the prices the costs were computed at, so a later change of the table never rewrites this record.
    if (u.totals.cost && u.totals.cost.amount === null) out.push(`No price was set for: ${u.totals.cost.unpriced.join(", ")} (Admin Panel › Misc), so no cost is given.`, "");
    else if (u.pricingUsed && Object.keys(u.pricingUsed.models || {}).length) out.push(`Costed at the prices in force when this record was built, per million tokens in ${u.pricingUsed.currency}: ${Object.entries(u.pricingUsed.models).map(([m, row]) => `${m} in ${row.input}, out ${row.output}${row.source === "default" ? " (the default row)" : ""}`).join("; ")}; source: the Admin Panel's price table.`, "");
    if (u.split && u.split.answers) {
      out.push(`Where the tokens went, over ${u.split.answers} coding answer(s), apportioned by ${u.split.basis} (the server counts one figure per answer; the app splits it by the size of each part it composed):`, "");
      out.push(`- Input: ${u.split.input.map((g) => `${g.label} ${cell(g.tokens)} (${g.share}%)`).join("; ")}.`);
      out.push(`- Output: ${u.split.output.map((g) => `${g.label} ${cell(g.tokens)} (${g.share}%)`).join("; ")}.`, "");
    }
  }

  out.push("## Turns", "");
  if (r.turns.length === 0) out.push("No coding turn was recorded for this scenario since its last reset.", "");
  r.turns.forEach((t, i) => {
    out.push(`### ${i + 1}. ${cell(t.step || "free-form")} — ${cell(t.at)}`, "");
    out.push(`- Prompt: ${cell(t.prompt)}`);
    out.push(`- Model: ${cell(t.model)} at ${cell(t.endpointHost)}; thinking ${cell(t.thinking && t.thinking.mode)}`);
    if (t.tokens) out.push(`- Tokens: ${cell(t.tokens.prompt)} in → ${cell(t.tokens.completion)} out${t.tokens.providerReported ? "" : " (estimated)"}`);
    if (t.timing) out.push(`- Time: ${cell(t.timing.wallMs)} ms in all (retrieval ${cell(t.timing.retrievalMs)} ms, model ${cell(t.timing.modelMs)} ms)`);
    out.push(`- Layers searched: ${t.layers.map((l) => `${l.id} ${l.state === "absent" ? "not in store" : `${l.passages} passage(s)`}`).join("; ") || "—"}`);
    // D11 (a) of 2026-10-11: what each layer searched for; once when every searched layer shared one text.
    const searched = t.layers.filter((l) => l.search);
    if (searched.length && searched.every((l) => l.search === searched[0].search)) {
      out.push(`- Searched for (${searched.length === t.layers.length ? "every layer" : searched.map((l) => l.id).join(", ")}): ${cell(searched[0].search)}`);
    } else if (searched.length) {
      out.push("- Searched for, by layer:");
      for (const l of searched) out.push(`  - ${LAYER_NAMES[l.id] || l.id}${l.searchedOn === "topics" ? " (the step's topics)" : ""}: ${cell(l.search)}`);
    }
    out.push(`- Cited: ${t.cited.join(", ") || "none"}${t.unverifiedMarkers.length ? `; unverified markers: ${t.unverifiedMarkers.join(", ")}` : ""}`);
    if (t.attached.length) out.push(`- Files attached: ${t.attached.map((f) => `${f.path}${f.sha256 ? ` (sha256 ${String(f.sha256).slice(0, 12)})` : ""}`).join("; ")}`);
    if (t.fileOperations.length) out.push(`- Files proposed: ${t.fileOperations.map((f) => `${f.path}${f.applied ? " (applied)" : " (not applied)"}`).join("; ")}`);
    if (t.codeKept) {
      out.push(
        t.codeKept.refused
          ? `- Code kept: not by the tool; the answer's code differed on ${cell(t.codeKept.refused.lines)} lines, more than the ${cell(t.codeKept.refused.max)} it puts back, so the documentation check judged the answer as written`
          : t.codeKept.restored.length
            ? `- Code kept by a tool: ${cell(t.codeKept.restored.map(keptLine).join("; "))}`
            : "- Code kept by a tool: every line of code in the answer was the program's own"
      );
    }
    out.push("");
  });

  out.push("## Tests", "");
  if (answer && r.tests.length === 0) out.push("This demo runs no tests: it answers a question from the rules.", "");
  else if (r.tests.length === 0) out.push("No test run was recorded.", "");
  else {
    out.push("| Command | When | Exit code | Time | Result |", "|---|---|---|---|---|");
    for (const t of r.tests) out.push(`| ${cell(t.command)} | ${cell(t.at)} | ${cell(t.exitCode)} | ${cell(t.durationMs)} ms | ${cell(t.summary)} |`);
    out.push("");
  }

  out.push("## Changes against the seed commit", "");
  const diff = r.changes && r.changes.gitDiffStat ? String(r.changes.gitDiffStat).trim() : "";
  const status = r.changes && r.changes.gitStatus ? String(r.changes.gitStatus).trim() : "";
  if (answer && !r.changes) out.push("This demo changes no code: the workspace is not part of this record.", "");
  else out.push(diff ? ["```", diff, "```"].join("\n") : "No tracked file differs from the seed commit.", "");
  if (status) out.push("Working tree:", "", "```", status, "```", "");
  const files = r.changes && Array.isArray(r.changes.files) ? r.changes.files : [];
  if (files.length) {
    out.push("## The code change", "");
    for (const fd of files) {
      out.push(`### ${cell(fd.path)} (${fd.status}${Number.isFinite(fd.added) ? `, +${fd.added} -${fd.removed}` : ""})`, "", "```diff", diffText(fd), "```", "");
    }
  }

  out.push("## Verification", "");
  const tv = r.verification.toolVerified;
  const aa = r.verification.assistantAssessed;
  const eqv = r.verification.equivalence || null;
  const doc = r.verification.documentation || null;
  const imp = r.verification.improvement || null;
  if (doc && !doc.error && doc.language === "python") {
    const yes = (ok) => (ok ? "passed" : "FAILED");
    const proof = doc.compared ? { at: doc.at, codeUnchanged: doc.codeUnchanged } : doc.codeUnchangedProof || null;
    out.push(
      `- Documentation check (STD-DOC), verified by a tool that reads the module's syntax tree, in the run of ${cell(doc.at)}: ${yes(doc.passed)}. The header (DOC-001): ${doc.headerMissing && doc.headerMissing.length ? `missing ${doc.headerMissing.join(", ")}` : "every field present"}. Docstrings (DOC-002): ${doc.units ? `${doc.units.commented} of ${doc.units.total} classes and functions` : "—"}. Money logic naming its requirement (DOC-006): ${doc.money ? `${doc.money.tagged} of ${doc.money.total} functions` : "—"}. The assistant named in the header (DOC-007): ${doc.aiDisclosure && doc.aiDisclosure.namesAssistant ? "yes" : "no"}. Card numbers (DOC-004): ${doc.cardNumbers && doc.cardNumbers.length ? `line ${doc.cardNumbers.join(", ")}` : "none"}. Commented-out code (DOC-005): ${doc.commentedOutCode && doc.commentedOutCode.length ? `line ${doc.commentedOutCode.join(", ")}` : "none"}.`,
      proof
        ? `- The comments-only change (DOC-008), verified by tool in the run of ${cell(proof.at)}: ${proof.codeUnchanged ? "no line of code changed" : "A LINE OF CODE CHANGED"}, the module's syntax tree compared with the module as NexCODE was given it, docstrings and comments set aside.`
        : "- The comments-only change (DOC-008): no run compared the code.",
      `- The module's tests in that run: ${yes(doc.programCheckPassed)}.`,
      "- DOC-003 (comments agree with the code) is the reviewer's to assess.",
      ""
    );
  } else if (doc && !doc.error) {
    const yes = (ok) => (ok ? "passed" : "FAILED");
    out.push(
      `- Documentation check (STD-DOC), verified by tool, in the run of ${cell(doc.at)}: ${doc.codeUnchanged ? "no line of code changed" : "A LINE OF CODE CHANGED"} (DOC-008).`,
      `- The program's own check (compile, run, compare with the expected report): ${yes(doc.programCheckPassed)}.`,
      `- The header (DOC-001): ${doc.headerMissing && doc.headerMissing.length ? `missing ${doc.headerMissing.join(", ")}` : "every field present"}. Purpose comments (DOC-002): ${doc.units ? `${doc.units.commented} of ${doc.units.total} units` : "—"}. Card numbers (DOC-004): ${doc.cardNumbers && doc.cardNumbers.length ? `line ${doc.cardNumbers.join(", ")}` : "none"}. Commented-out code (DOC-005): ${doc.commentedOutCode && doc.commentedOutCode.length ? `line ${doc.commentedOutCode.join(", ")}` : "none"}.`,
      ...(Array.isArray(doc.restoredByTool) && doc.restoredByTool.length
        ? [`- Code kept by a tool before the change was shown (S5-D14 (a)): ${cell(doc.restoredByTool.map(keptLine).join("; "))}. The check verified the change with the program's own lines.`]
        : []),
      "- DOC-003 (comments agree with the code) is the reviewer's to assess.",
      ""
    );
  }
  if (imp) {
    out.push(
      `- Test and improve (S6-D4 (a)): before NexCODE's recommendations, the tests gave ${cell(imp.before ? imp.before.summary : "no run")}; after the improvements, ${cell(imp.after ? imp.after.summary : "no run yet")}. The runs are verified by tool; the recommendations below are NexCODE's, for the reviewer.`,
      ""
    );
    if (imp.recommendations) out.push(quoted(imp.recommendations), "");
  }
  if (eqv) {
    out.push(
      `- Equivalence (MIG-001), verified by tool: the new program's report is ${eqv.identical ? "byte-identical to" : "NOT identical to"} the COBOL program's on the same fixture, compared by \`diff\` in the run of ${cell(eqv.at)}.`,
      `- The legacy program's own report ${eqv.legacyMatchesExpected ? "matched" : "did not match"} its expected report in that run.`,
      `- The port's characterisation test (TST-010): ${eqv.characterisationPassed === null ? "not reached" : eqv.characterisationPassed ? "passed" : "failed"}.`,
      ""
    );
  } else if (answer) {
    const cited = r.turns.reduce((n, t) => n + t.cited.length, 0);
    const unverified = r.turns.reduce((n, t) => n + t.unverifiedMarkers.length, 0);
    out.push(`- Citations, checked by the system: ${cited} marker(s) cited match a passage given to the model; ${unverified} match none${unverified ? " (listed with each answer)" : ""}.`);
    const traced = r.turns.filter((t) => t.regulatorTrace);
    const found = [...new Set(traced.flatMap((t) => (t.regulatorTrace.found || []).map((x) => x.label)))];
    const missing = [...new Set(traced.flatMap((t) => (t.regulatorTrace.missing || []).map((x) => x.label)))].filter((x) => !found.includes(x));
    if (found.length || missing.length) {
      out.push(`- Regulations traced through the rules' "Traces to:" lines and found in their own text: ${found.join("; ") || "none"}${missing.length ? `. Named but not found: ${missing.join("; ")}` : ""}.`);
    }
    out.push("");
  } else if (tv.length || aa.length) {
    out.push(`- Verified by tool: ${tv.length} finding(s), ${tv.filter((f) => f.status === "fixed").length} fixed (re-checked by the same checks when this record was built).`);
    out.push(`- Assessed by the reviewer: ${aa.length} finding(s), open until a reviewer closes them.`, "");
  } else if (!doc) out.push("No pre-merge checks ran in this demo; everything above is the system's own record of what ran.", "");
  if (eqv && (tv.length || aa.length)) {
    out.push(`- Verified by tool: ${tv.length} finding(s), ${tv.filter((f) => f.status === "fixed").length} fixed.`, `- Assessed by the reviewer: ${aa.length} finding(s).`, "");
  }
  if (r.commit && r.commit.commit) {
    out.push("## Commit", "");
    out.push(`Committed ${cell(String(r.commit.commit).slice(0, 12))} on ${cell(r.commit.branch)} by ${cell(r.commit.author)} at ${cell(r.commit.at)}, and pushed to ${cell(r.commit.repository)}. Approval pending: a person reviews and approves it before merge (REV-005).`, "");
    if (Array.isArray(r.commit.files) && r.commit.files.length) out.push(...r.commit.files.map((x) => `- ${cell(x.status)}: ${cell(x.path)}`), "");
    if (r.commit.note) out.push(`_${r.commit.note}_`, "");
  }
  out.push("## Platform", "");
  const p = r.platform || {};
  out.push(`- App tree: ${cell(p.appTreeHash)}`, `- Store: ${cell(p.store)}`, `- Models: ${cell(Array.isArray(p.models) ? p.models.join(", ") : p.models)}`, "");
  return out.join("\n");
}

/**
 * S6-D6 (a): the commit's message, built from the evidence record (never by the model): the ticket and its title, the
 * files, the AI-assisted label naming the assistant and the model (TEC-POL-005 clause 4.4, REV-005), and the record's
 * facts as trailers. `paths` are repository paths; the record's own files are named as the record.
 */
function commitMessage({ ticket, title, paths = [], record = null, models = [] } = {}) {
  const r = record && typeof record === "object" ? record : {};
  const isRecord = (p) => /^compliance\/records\//.test(p);
  const code = paths.filter((p) => !isRecord(p));
  const recordMd = paths.find((p) => isRecord(p) && p.endsWith(".md")) || null;
  const lastTest = Array.isArray(r.tests) && r.tests.length ? r.tests[r.tests.length - 1] : null;
  const open = r.review && Array.isArray(r.review.findings) ? r.review.findings.filter((x) => x.status !== "fixed") : [];
  const blocking = open.filter((x) => x.severity === "Critical" || x.severity === "High").length;
  const lines = [
    `${ticket}: ${title}`,
    "",
    `The change: ${code.join(", ") || "(none)"}.`,
    ...(recordMd ? [`Its evidence record: ${recordMd}, with its JSON, built by NexCODE from its run log.`] : []),
    "",
    `AI-assisted: written with NexCODE (${models.length ? models.join(", ") : "model not recorded"}); the engineer reviewed and applied each change. A person reviews and approves it before it is merged (TEC-POL-005 clause 4.4, REV-005).`,
    "",
    `Ticket: ${ticket}`,
    ...(r.id ? [`Evidence-record: ${r.id}`] : []),
    ...(lastTest && lastTest.summary ? [`Tests: ${lastTest.summary}`] : []),
    ...(r.review ? [`Security-audit: ${r.review.outcome}${blocking ? ` (${blocking} Critical or High finding(s) open)` : open.length ? ` (${open.length} finding(s) open, none Critical or High)` : ""}`] : []),
    "Approval: pending (REV-005)",
  ];
  return lines.join("\n");
}

module.exports = { RECORD_SCHEMA, eventsSinceReset, latestRecordSince, summariseTestOutput, summariseSteps, summariseDocumentation, compactDocumentation, equivalenceOf, recordKind, buildEvidenceRecord, renderMarkdown, commitMessage };
