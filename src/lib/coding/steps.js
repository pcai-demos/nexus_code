/**
 * src/lib/coding/steps.js — the step states of a demo, the one next action, and the flow drawn on its card (presenter
 * panels design §4; the owner's decisions of 2026-10-07: D3 (a) the gate reads the run log; then, after the first
 * run-through, D1 "make the next step obvious" and D2 "the demo flow should be representative of a real-world
 * scenario: you should not be able to skip key aspects of the flow").
 *
 * Pure (no I/O, no clock). The gate is computed from the run log, never from the browser's memory, so a page reload in
 * the middle of a demo shows the same bar. The window is the scenario's events since its last reset (of everything or
 * of this scenario) or its last Select; Apply events carry no scenario and are kept.
 *
 *   An explain step is complete when a successful turn carries its step id.
 *   A change step (one whose `after` names run-tests) is complete only when ALL of these hold, in order:
 *     1. a successful turn of the step proposed at least one file;
 *     2. every file that latest turn proposed was applied after it;
 *     3. a test run after the last Apply PASSED (exit code 0). A red run is not completion: the next action is to
 *        ask the assistant to fix the failure (the step's repair prompt), apply, and run the tests again.
 *   A record step is complete when a record exists at or after the completion of its required predecessors.
 *   A step is unlocked when every required predecessor is complete; an optional step never blocks the next one.
 *
 * S4 (the closer, 2026-10-12): a `results` action step is complete when the Results panel was opened from it (a
 * results-shown line in the run log); a `doc` step, when the document chat answered it (a doc-turn line); an `audit`
 * step, like an explain step, when a successful turn carries its id. A demo whose steps change no code records an answer.
 *
 * S6 (the owner's S6-D1 to S6-D7 of 2026-10-13): four steps change the same two files, so a later step's answer that
 * proposes a file takes it over: its Applies no longer make an earlier step's passing run stale. An `improve` step is a change step (Apply, then the tests pass). A
 * `commit` action step is complete when the presenter's Commit succeeded after the record it carries. An optional step
 * straight after a review whose outcome blocks the merge (Changes requested, REV-007) is offered as the next action,
 * with the record beside it: S6's fix of the audit's findings is needed only when the audit found a blocking one.
 */

const ISO = (e) => (e && typeof e.at === "string" ? e.at : "");
const latestAt = (events) => events.reduce((m, e) => (ISO(e) > m ? ISO(e) : m), "");
const uniq = (xs) => [...new Set(xs)];
const MODES = Object.freeze(["explain", "change", "review", "migrate", "audit", "doc", "comments", "improve"]);
/** The modes whose steps change code: a demo with none of them (S4) records an answer, not a change. S5's comments
 * change a program's file, so its gate is a change step's: Apply, then the checks pass. S6's improve step too. */
const CODE_MODES = Object.freeze(["change", "migrate", "review", "comments", "improve"]);

/** The scenario's events since its last reset or Select, plus every Apply in that window. */
function windowOf(events, scenarioId) {
  const list = Array.isArray(events) ? events : [];
  let start = 0;
  list.forEach((e, i) => {
    if (!e || typeof e !== "object") return;
    if (e.kind === "reset-all" || ((e.kind === "reset-scenario" || e.kind === "select") && e.scenario === scenarioId)) start = i + 1;
  });
  return list.slice(start).filter((e) => e && typeof e === "object" && (e.scenario === scenarioId || e.kind === "apply"));
}

/** A step's mode: an action step has none; otherwise its own, or change when it runs the tests, else explain. */
function modeOf(step) {
  if (!step || step.action) return null;
  if (MODES.includes(step.mode)) return step.mode;
  return Array.isArray(step.after) && step.after.includes("run-tests") ? "change" : "explain";
}

/** True when no step of the demo changes code (S4, the auditor's question): its record keeps an answer. */
function answersOnly(scenario) {
  const steps = scenario && Array.isArray(scenario.steps) ? scenario.steps : [];
  return steps.length > 0 && !steps.some((st) => CODE_MODES.includes(modeOf(st)));
}

/** S6: the latest review's outcome before step `i` blocks the merge (REV-007: a Critical or High finding open). */
function reviewBlocksBefore(steps, i) {
  for (let k = i - 1; k >= 0; k--) {
    if (steps[k].mode === "review") return Boolean(steps[k].review && steps[k].review.outcome === "Changes requested");
  }
  return false;
}

/** The one thing the presenter does next, from the step states. */
function nextAction(scenario, steps) {
  const defs = scenario && Array.isArray(scenario.steps) ? scenario.steps : [];
  const answers = answersOnly(scenario);
  for (const [i, s] of steps.entries()) {
    if (s.complete) continue;
    // S6: an optional step straight after a review that blocks the merge is offered (with the record beside it until it
    // is asked); an optional step the presenter has asked is then followed through, Apply and tests, like any other.
    const offered = s.optional && s.unlocked && i > 0 && steps[i - 1].mode === "review" && reviewBlocksBefore(steps, i);
    if (s.optional && !offered && !s.turn) continue;
    const def = defs.find((d) => d.id === s.id) || {};
    if (s.optional && !s.turn) {
      const rest = nextAction(scenario, steps.map((x, k) => (k === i ? { ...x, complete: true } : x)));
      return {
        action: "ask",
        stepId: s.id,
        label: `Ask NexCODE: ${s.title}`,
        detail: "The review found a Critical or High finding, which blocks the merge (REV-007): ask NexCODE to fix it, then apply and run the tests. Or record the change with the finding open.",
        alternative: rest && rest.action === "record" ? rest : null,
      };
    }
    if (s.action === "record") {
      return answers
        ? { action: "record", stepId: s.id, label: "Record the answer", detail: "The evidence record of the question and the answer is built from the run log, with no model call." }
        : { action: "record", stepId: s.id, label: "Record the change", detail: "The evidence record is built from the run log, with no model call." };
    }
    if (s.action === "results") {
      return { action: "show-record", stepId: s.id, label: s.title || "Show the latest record", detail: "Opens the Results panel on the newest evidence record written since the environment was reset, or on the example record when no demo has run." };
    }
    if (s.action === "commit") {
      const branch = def.commit && def.commit.branch ? def.commit.branch : "a feature branch";
      return {
        action: "commit",
        stepId: s.id,
        label: s.title || "Commit to the Bank repository",
        detail: `Commits the new files and the evidence record on ${branch} as ${def.commit && def.commit.author ? def.commit.author.name : "the engineer"}, labelled AI-assisted (TEC-POL-005 clause 4.4), and pushes the branch to the Bank's repository in the pod for review (REV-005).`,
      };
    }
    if (!s.turn) {
      // S4: a doc step asks the document chat, not NexCODE's four layers.
      const doc = s.mode === "doc";
      return {
        action: "ask",
        stepId: s.id,
        label: doc ? "Ask the document chat (/doc)" : `Ask NexCODE: ${s.title}`,
        detail: s.failedSince
          ? "The last answer failed: ask again."
          : doc
            ? "This puts the /doc question in the chat box; press Send. The document chat answers from the documents as one pile, for contrast."
            : "This puts the step's prompt in the chat box; press Send.",
      };
    }
    if (s.change) {
      const { proposed, applied, pending } = s.change;
      if (proposed.length === 0) {
        return { action: "ask", stepId: s.id, label: `Ask NexCODE again: ${s.title}`, detail: "The last answer proposed no change to apply." };
      }
      if (pending.length > 0) {
        return {
          action: "apply",
          stepId: s.id,
          label: "Show the proposed change in the IDE",
          detail: `Review the change in the IDE, then press Apply Changes in the chat: ${applied.length} of ${proposed.length} file${proposed.length === 1 ? "" : "s"} applied.`,
          turnId: s.turn.turnId,
          pending: showOrder(def, pending),
        };
      }
      // S5: a comments step's tests are the documentation check and the program's own check ("the checks").
      const checks = modeOf(def) === "comments";
      const python = Boolean(checks && def.comments && def.comments.language === "python");
      if (s.tests && s.tests.state === "failed") {
        const fix = checks
          ? def.repair
            ? { action: "repair", stepId: s.id, label: "Ask NexCODE to fix the comments", detail: `The checks failed: ${s.tests.summary || `exit code ${s.tests.exitCode}`}. Record unlocks only when they pass.` }
            : { action: "ask", stepId: s.id, label: `Ask NexCODE again: ${s.title}`, detail: `The checks failed: ${s.tests.summary || `exit code ${s.tests.exitCode}`}. Record unlocks only when they pass.` }
          : def.repair
            ? { action: "repair", stepId: s.id, label: "Ask NexCODE to fix the failing tests", detail: `The tests failed: ${s.tests.summary || `exit code ${s.tests.exitCode}`}. Record unlocks only when they pass.` }
            : { action: "ask", stepId: s.id, label: `Ask NexCODE again: ${s.title}`, detail: `The tests failed: ${s.tests.summary || `exit code ${s.tests.exitCode}`}. Record unlocks only when they pass.` };
        // S3-D14 (b) of 2026-10-12: the presenter can also end the demo in a known state, with an honest record.
        if (s.failedRecord) {
          return { action: "results", stepId: null, outcome: "failed", label: "Show the results", detail: "The failed attempt is recorded as not ready for review: show the room the record, or ask NexCODE to fix the failing tests and carry on.", alternative: fix };
        }
        return { ...fix, alternative: { action: "record-failed", stepId: s.id, label: "Record the failed attempt", detail: "Writes an evidence record that says the change failed its tests and is not ready for review, so the demo ends in a known state." } };
      }
      if (checks) {
        return {
          action: "run-tests",
          stepId: s.id,
          label: "Run the checks",
          detail: python
            ? "The next step unlocks when the checks pass: the module's tests, then the documentation check: no line of code changed, the header complete, every function and class documented, money logic tagged."
            : "Record unlocks when the checks pass: no line of code changed, the program gives the same totals, and the header and every unit are documented.",
        };
      }
      if (modeOf(def) === "improve") {
        return { action: "run-tests", stepId: s.id, label: "Run the tests", detail: "The tests run again on the improved code, with the documentation check; the next step unlocks when they pass." };
      }
      return { action: "run-tests", stepId: s.id, label: "Run the tests", detail: "Record unlocks when the tests pass." };
    }
    return { action: "ask", stepId: s.id, label: `Ask NexCODE: ${s.title}`, detail: "This puts the step's prompt in the chat box; press Send." };
  }
  // PR B (D2): every step done; the next thing is to show the results to the room (the presenter's click opens the panel).
  return { action: "results", stepId: null, label: "Show the results", detail: answers ? "Every step is done: show the room the evidence record of the answer." : "Every step is done: show the room the evidence record and the code change." };
}

/**
 * `{ scenarioId, events, steps, currentStepId, complete, next, lastRun }`. Each step:
 * `{ id, title, optional, action, mode, status, unlocked, complete, completedAt, turn, failedSince, change, tests, record, shown,
 * review, commit }`; `status` is one of locked, ready, done; `change` is `{ proposed, applied, pending }` (paths) on a change
 * step; `review` the latest review's `{ outcome, counts }` on a review step; `commit` the latest Commit on a commit step.
 */
function stepStates(scenario, events) {
  const steps = scenario && Array.isArray(scenario.steps) ? scenario.steps : [];
  const scenarioId = scenario && scenario.id ? scenario.id : null;
  const win = windowOf(events, scenarioId);
  let predecessorsComplete = true;
  let lastRequiredCompletedAt = "";
  const out = [];
  for (const step of steps) {
    const unlocked = predecessorsComplete;
    const s = {
      id: step.id,
      title: step.title || step.id,
      optional: Boolean(step.optional),
      action: step.action || null,
      mode: modeOf(step),
      status: "locked",
      unlocked,
      complete: false,
      completedAt: null,
      turn: null,
      failedSince: false,
      change: null,
      tests: null,
      record: null,
      failedRecord: null,
      shown: null,
      review: null,
      commit: null,
    };
    if (step.action === "commit") {
      // S6-D6 (a): the presenter's Commit, after the record it carries (a record written later needs a new Commit).
      const commits = win.filter((e) => e.kind === "commit" && e.success === true && ISO(e) >= lastRequiredCompletedAt);
      const last = commits[commits.length - 1] || null;
      s.commit = last ? { at: ISO(last), commit: last.commit || null, branch: last.branch || null, recordId: last.recordId || null } : null;
      s.complete = unlocked && Boolean(last);
      s.completedAt = s.complete ? ISO(last) : null;
    } else if (step.action === "results") {
      // S4: the presenter opened the Results panel on the latest record from this step (the route logs which record).
      const shown = win.filter((e) => e.kind === "results-shown");
      const last = shown[shown.length - 1] || null;
      s.shown = last ? { at: ISO(last), recordId: last.recordId || null, example: Boolean(last.example) } : null;
      s.complete = unlocked && Boolean(last);
      s.completedAt = s.complete ? ISO(last) : null;
    } else if (step.action === "record") {
      // A failed attempt's record (S3-D14 (b)) never completes the record step: only a record of passing tests does.
      const records = win.filter((e) => e.kind === "record" && e.outcome !== "failed" && ISO(e) >= lastRequiredCompletedAt);
      const last = records[records.length - 1] || null;
      s.record = last ? { at: ISO(last), recordId: last.recordId || null, paths: Array.isArray(last.paths) ? last.paths : [] } : null;
      s.complete = unlocked && Boolean(last);
      s.completedAt = s.complete ? ISO(last) : null;
    } else {
      // S4: a doc step's answer comes from the document chat (a doc-turn line); a coding turn of the step counts too.
      const mine = win.filter((e) => (e.kind === "turn" || (e.kind === "doc-turn" && modeOf(step) === "doc")) && e.step === step.id);
      const ok = mine.filter((e) => e.success === true);
      const last = ok[ok.length - 1] || null;
      const lastAny = mine[mine.length - 1] || null;
      s.failedSince = Boolean(lastAny && lastAny.success !== true && (!last || ISO(lastAny) > ISO(last)));
      s.turn = last ? { at: ISO(last), turnId: last.turnId || null, thinking: last.thinking && last.thinking.mode ? last.thinking.mode : null, repair: Boolean(last.repair), runs: ok.length } : null;
      // S6: a review's outcome, for the next action (a blocking finding offers the optional fix).
      if (modeOf(step) === "review" && last && last.review && typeof last.review === "object") s.review = { outcome: last.review.outcome || null, counts: last.review.counts || null };
      const needsTests = Array.isArray(step.after) && step.after.includes("run-tests");
      if (!needsTests) {
        s.complete = Boolean(last);
        s.completedAt = last ? ISO(last) : null;
      } else {
        const proposed = last ? uniq((Array.isArray(last.fileOperations) ? last.fileOperations : []).filter((p) => typeof p === "string" && p)) : [];
        // S6: a later answer of ANOTHER step that proposed the same file takes the file over: its Applies belong to that
        // step, and do not make this step's passing run stale (S6's comment, improve and fix steps change the files its
        // build step wrote). Any other Apply after the answer still does.
        const takenOverAt = (p) => {
          const later = last ? win.find((e) => e.kind === "turn" && e.success === true && e.step && e.step !== step.id && ISO(e) > ISO(last) && Array.isArray(e.fileOperations) && e.fileOperations.includes(p)) : null;
          return later ? ISO(later) : null;
        };
        const appliesAfter = last
          ? win.filter((e) => {
              if (e.kind !== "apply" || e.ok !== true || ISO(e) < ISO(last)) return false;
              const t = takenOverAt(e.path);
              return t === null || ISO(e) < t;
            })
          : [];
        const applied = uniq(appliesAfter.map((e) => e.path).filter((p) => proposed.includes(p)));
        const pending = proposed.filter((p) => !applied.includes(p));
        s.change = { proposed, applied, pending };
        let tests = { required: true, state: "pending", summary: null, exitCode: null, at: null };
        if (last && proposed.length > 0 && pending.length === 0) {
          // Any Apply after the answer (of any file) makes an earlier run stale. S6: the step's runs end where a later
          // step took one of its files over; the runs after that are the later step's.
          const since = appliesAfter.length ? latestAt(appliesAfter) : ISO(last);
          const ends = proposed.map(takenOverAt).filter(Boolean).sort();
          const until = ends.length ? ends[0] : null;
          const runs = win.filter((e) => e.kind === "test-run" && e.ran !== false && ISO(e) >= since && (until === null || ISO(e) < until));
          const run = runs[runs.length - 1] || null;
          if (run) {
            tests = {
              required: true,
              state: run.exitCode === 0 ? "passed" : "failed",
              summary: run.summary || null,
              exitCode: run.exitCode === undefined ? null : run.exitCode,
              at: ISO(run),
            };
          }
        }
        s.tests = tests;
        // S3-D14 (b) of 2026-10-12: a failed attempt recorded after the failing run ends the demo in a known state.
        const failedRecords = tests.state === "failed" ? win.filter((e) => e.kind === "record" && e.outcome === "failed" && ISO(e) >= tests.at) : [];
        const lastFailed = failedRecords[failedRecords.length - 1] || null;
        s.failedRecord = lastFailed ? { at: ISO(lastFailed), recordId: lastFailed.recordId || null } : null;
        s.complete = Boolean(last) && proposed.length > 0 && pending.length === 0 && tests.state === "passed";
        s.completedAt = s.complete ? tests.at : null;
      }
    }
    s.status = s.complete ? "done" : unlocked ? "ready" : "locked";
    // S6: an optional code step the presenter has asked (the audit's fix) gates what follows, like a required one: the
    // record and the commit must carry its change whole. An optional question (S3's, S4's) never gates.
    if (!s.optional || (CODE_MODES.includes(s.mode) && Boolean(s.turn))) {
      if (s.complete) {
        if (s.completedAt > lastRequiredCompletedAt) lastRequiredCompletedAt = s.completedAt;
      } else {
        predecessorsComplete = false;
      }
    }
    out.push(s);
  }
  const current = out.find((s) => !s.optional && s.status === "ready") || null;
  const runs = win.filter((e) => e.kind === "test-run");
  const lastRun = runs[runs.length - 1] || null;
  return {
    scenarioId,
    events: win.length,
    steps: out,
    currentStepId: current ? current.id : null,
    complete: out.filter((s) => !s.optional).every((s) => s.complete),
    next: nextAction(scenario, out),
    lastRun: lastRun ? { at: ISO(lastRun), exitCode: lastRun.exitCode === undefined ? null : lastRun.exitCode, summary: lastRun.summary || null, ran: lastRun.ran !== false } : null,
  };
}

const LABEL_MAX = 26;
const shorten = (s) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s);

/**
 * The card's flow, drawn from the definition: the ticket, then each step (a change step followed by Apply and Run
 * tests), then the record. `layers.targets` are the prompt steps the four layers feed. Nodes carry `x` (their column).
 */
function flowLayout(scenario) {
  const steps = scenario && Array.isArray(scenario.steps) ? scenario.steps : [];
  const reproduces = Boolean(scenario && scenario.select && scenario.select.runTests);
  const nodes = [{ id: "ticket", kind: "ticket", label: scenario && scenario.ticket && scenario.ticket.id ? scenario.ticket.id : "Ticket", sub: reproduces ? "opened, tests run once" : "opened in the IDE" }];
  let n = 0;
  for (const step of steps) {
    n += 1;
    if (step.action === "record") {
      nodes.push({ id: step.id, kind: "record", label: shorten(`${n}. ${step.title || step.id}`), sub: "from the run log", optional: Boolean(step.optional) });
      continue;
    }
    if (step.action === "results") {
      nodes.push({ id: step.id, kind: "results", label: shorten(`${n}. ${step.title || step.id}`), sub: "the latest evidence record", optional: Boolean(step.optional) });
      continue;
    }
    if (step.action === "commit") {
      nodes.push({ id: step.id, kind: "commit", label: shorten(`${n}. ${step.title || step.id}`), sub: "to the Bank's repository", optional: Boolean(step.optional) });
      continue;
    }
    const mode = modeOf(step);
    const sub =
      mode === "change"
        ? "change shown in the IDE"
        : mode === "migrate"
          ? "the port shown in the IDE"
          : mode === "comments"
            ? "the comments shown in the IDE"
            : mode === "improve"
              ? "the improvement shown in the IDE"
            : mode === "review"
              ? "findings in the chat and the IDE"
              : mode === "audit"
                ? "the chain in the chat"
                : mode === "doc"
                  ? "the document chat, for contrast"
                  : "explained in the chat";
    nodes.push({ id: step.id, kind: mode === "doc" ? "doc" : "prompt", label: shorten(`${n}. ${step.title || step.id}`), sub: step.optional ? "optional" : sub, optional: Boolean(step.optional) });
    if (Array.isArray(step.after) && step.after.includes("run-tests")) {
      nodes.push({ id: `${step.id}:apply`, kind: "apply", label: "Apply", sub: "the reviewed change" });
      nodes.push({ id: `${step.id}:tests`, kind: "tests", label: mode === "comments" ? "Run the checks" : "Run tests", sub: mode === "migrate" ? "byte-identical to the COBOL" : mode === "comments" ? "no line of code changed" : mode === "improve" ? "pass again, improved" : "must pass" });
    }
  }
  nodes.forEach((node, i) => {
    node.x = i;
  });
  const edges = nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id }));
  return { nodes, edges, layers: { label: "Four layers of rules: regulator, corporate, engineering, team", targets: nodes.filter((x) => x.kind === "prompt").map((x) => x.id) } };
}

/**
 * How the IDE shows a step's proposed file (S3-D13 (a) of 2026-10-11): `{ beside }` for a file a migrate step pairs
 * with a workspace file (the port beside the program it replaces, the characterisation test beside the report it
 * checks), `{ alone: true }` for a migrate step's other files, null for any other step (a diff against the workspace
 * file). The bridge applies it to a NEW file only: a repair's change to an applied port stays a diff, so a fix reads as
 * a fix.
 */
function proposalView(step, filePath) {
  if (!step || modeOf(step) !== "migrate" || !step.migrate) return null;
  const pairs = step.migrate.beside && typeof step.migrate.beside === "object" ? step.migrate.beside : {};
  return typeof pairs[filePath] === "string" && pairs[filePath] ? { beside: pairs[filePath] } : { alone: true };
}

/** The order to show a step's proposed files in: those shown alone first, the one beside the migrated program last, so it stays in front. */
function showOrder(step, paths) {
  const list = Array.isArray(paths) ? paths.filter((p) => typeof p === "string") : [];
  if (!step || !step.migrate) return list;
  const rank = (p) => {
    const v = proposalView(step, p);
    return !v || v.alone ? 0 : v.beside === step.migrate.source ? 2 : 1;
  };
  return list
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}

module.exports = { MODES, CODE_MODES, windowOf, modeOf, answersOnly, nextAction, stepStates, flowLayout, proposalView, showOrder };
