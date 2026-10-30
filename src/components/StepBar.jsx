"use client";

/**
 * StepBar — the presenter's step bar above the composer (presenter panels design §4; decisions D2 a and D3 a; then the
 * owner's answers after the first run-through, 2026-10-07: D1 "make the next step obvious", D2 "the demo flow should be
 * representative of a real-world scenario: you shouldn't be able to skip key aspects of the flow").
 *
 * Three rows. The demo and its numbered steps (done, ready, locked). A NEXT panel with the ONE thing to do now, worked
 * out on the server from the run log (src/lib/coding/steps.js nextAction): ask a step's prompt, review and apply the
 * proposed change, run the tests, ask NexCODE to fix them when they fail, record; with the current step's checklist.
 * Then the secondary actions: Run tests (never gated: a red run is information) and Reset this demo. The hard reset
 * between demos is the sidebar's "Reset the demo environment" (2026-10-07, D1 (a)), so each reset has one name. This
 * component does the fetching, so ChatPanel stays fetch-free. It re-reads the states on a ten-second poll, after its own
 * actions, when a turn finishes, when a demo is selected, and when the workspace changes (the page's workspaceTick:
 * every Apply and the environment reset).
 *
 * S4 (the closer, 2026-10-12): a results step's button asks the server for the latest record of any demo since the
 * environment reset, or the example record (S4-D2 (a)), and opens the Results panel on it: still the presenter's click
 * (PR B D2). A demo with no test command has no Run tests.
 *
 * S6 (the owner's S6-D6 (a) of 2026-10-13): a commit step's button is the presenter's Commit: the server commits the new
 * files and the evidence record on the demo's feature branch and pushes it to the Bank's repository in the pod; the chat
 * says which commit, and the Results panel shows it with the record.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  RiCheckboxCircleFill,
  RiCheckboxBlankCircleLine,
  RiCloseCircleFill,
  RiPlayCircleLine,
  RiLock2Line,
  RiTestTubeLine,
  RiFileShield2Line,
  RiArrowGoBackLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSlideshow3Line,
  RiCodeSSlashLine,
  RiArrowRightLine,
  RiFileChartLine,
  RiGitCommitLine,
} from "@remixicon/react";
import { usePresenter } from "@/context/PresenterContext";
import { showProposalInIde } from "@/lib/coding/ide_client";

const API = "/api/ide-bridge/scenarios";
const CHIP = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border";
const MUTED = "bg-white/5 text-neutrals-medium border-white/10";
const GOOD = "bg-teal-500/15 text-teal-300 border-teal-500/20";
const WARN = "bg-amber-500/15 text-amber-400 border-amber-500/20";
const BAD = "bg-red-500/15 text-red-300 border-red-500/20";
const BUTTON =
  "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-[11px] font-sans font-semibold text-neutrals-light hover:border-brand-vivid/50 hover:text-white transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none";
const PRIMARY =
  "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-vivid text-white text-[12px] font-sans font-bold shadow-[0_0_14px_rgba(242,86,29,0.35)] hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none";
const seconds = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "—");
const POLL_MS = 10000;
const NEXT_ICONS = { ask: RiPlayCircleLine, repair: RiPlayCircleLine, apply: RiCodeSSlashLine, "run-tests": RiTestTubeLine, record: RiFileShield2Line, "record-failed": RiFileShield2Line, results: RiFileChartLine, "show-record": RiFileChartLine, commit: RiGitCommitLine };

async function post(body) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`the scenarios route answered HTTP ${res.status}`);
  return json;
}

function stepClass(status, current, active) {
  const base = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12px] font-sans font-semibold transition-all cursor-pointer disabled:cursor-not-allowed";
  const ring = active ? " ring-1 ring-brand-vivid/70" : "";
  if (status === "done") return `${base} border-teal-500/30 bg-teal-500/10 text-teal-200 hover:border-teal-400/60${ring}`;
  if (status === "ready") return `${base} ${current ? "border-brand-vivid/60 bg-brand-vivid/15 text-white" : "border-white/15 bg-white/5 text-neutrals-light"} hover:border-brand-vivid/70${ring}`;
  return `${base} border-white/10 bg-transparent text-neutrals-dark`;
}

function Check({ state, children }) {
  const icon =
    state === "done" ? <RiCheckboxCircleFill size={13} className="text-teal-300" /> : state === "failed" ? <RiCloseCircleFill size={13} className="text-red-300" /> : <RiCheckboxBlankCircleLine size={13} className="text-neutrals-medium" />;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-sans ${state === "done" ? "text-teal-200" : state === "failed" ? "text-red-200" : "text-neutrals-light"}`}>
      {icon}
      {children}
    </span>
  );
}

export default function StepBar({ activeDemoId = null, activeStep = null, onUseStep, onClearStep, onRecordTrace, onNote, onResetChat, isAnalyzing = false, workspaceTick = 0 }) {
  const presenter = usePresenter();
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const wasAnalyzing = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const s = await post({ action: "state", light: true });
      setState(s);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // A turn finishing (the page's isAnalyzing falling) changes the step states: re-read them.
  useEffect(() => {
    if (wasAnalyzing.current && !isAnalyzing) refresh();
    wasAnalyzing.current = isAnalyzing;
  }, [isAnalyzing, refresh]);

  // A demo selected in the Demo panel, an Apply in the chat or the environment reset changes them too.
  useEffect(() => {
    if (activeDemoId) refresh();
  }, [activeDemoId, refresh]);
  useEffect(() => {
    if (workspaceTick > 0) refresh();
  }, [workspaceTick, refresh]);

  const scenarios = state && Array.isArray(state.scenarios) ? state.scenarios : [];
  const scenario = scenarios.find((s) => s.id === activeDemoId) || null;
  const progress = scenario && state.progress && state.progress[scenario.id] ? state.progress[scenario.id] : null;
  const bridgeUp = Boolean(state && state.bridge && state.bridge.connected);
  const seed = state && state.seed ? state.seed : null;
  const offlineReason = "Open the IDE panel: the bridge starts with it.";

  const run = async (name, body, after) => {
    setBusy(name);
    setMessage(null);
    try {
      const r = await post(body);
      if (r && r.trace && typeof onRecordTrace === "function") onRecordTrace(r.trace);
      if (after) after(r);
      if (r && r.success === false) setMessage({ tone: "bad", text: `${name}: ${r.error || "failed"}` });
    } catch (err) {
      setMessage({ tone: "bad", text: `${name}: ${err.message}` });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const focusComposer = () => {
    try {
      const ta = document.querySelector('form textarea[placeholder^="Ask NexCODE"]');
      if (ta) ta.focus();
    } catch {
      // focusing is a convenience
    }
  };
  const ask = (step, opts = {}) => {
    if (typeof onUseStep === "function") onUseStep(scenario, step, opts);
    setTimeout(focusComposer, 50);
  };
  const runTests = () =>
    run("Run tests", { action: "run-tests", scenarioId: scenario.id }, (r) => {
      if (r.success && typeof onNote === "function")
        onNote(
          r.documentation
            ? `🧪 Checks: ${r.summary}, exit code ${r.exitCode}, ${seconds(r.durationMs)}. The program's own run is in the IDE's NexCODE Tests panel; the documentation check is in the trace.`
            : `🧪 Tests (${r.command}): ${r.summary}, exit code ${r.exitCode}, ${seconds(r.durationMs)}. The output is in the IDE's NexCODE Tests panel.`
        );
    });
  const recordChange = () =>
    run("Record", { action: "record", scenarioId: scenario.id }, (r) => {
      if (r.success) {
        setMessage({ tone: "good", text: `Record ${r.recordId} written: ${r.paths[1]}` });
        if (typeof onNote === "function")
          onNote(
            r.kind === "answer"
              ? `📋 Evidence record ${r.recordId} keeps the answer: ${r.summary.turns} turn(s), ${r.summary.rules} rule(s) cited, no code changed. It is open in the IDE: \`${r.paths[1]}\` (review pending before the answer is given).`
              : `📋 Evidence record ${r.recordId}: ${r.summary.turns} turn(s), ${r.summary.tests} test run(s), ${r.summary.rules} rule(s) cited. It is open in the IDE: \`${r.paths[1]}\` (approval pending).`,
            {
              coding: { kind: "record", recordId: r.recordId, scenarioId: scenario.id },
            }
          );
      }
    });
  // S4-D2 (a): the latest record of any demo since the environment reset, or the example record, opened by this click.
  const showRecord = () =>
    run("Show the latest record", { action: "results-shown", scenarioId: scenario.id }, (r) => {
      if (!r || !r.success) return;
      presenter.openResults({ recordId: r.recordId, scope: "all" });
      if (typeof onNote === "function")
        onNote(
          r.example
            ? "📋 No demo has written a record since the environment was reset, so the Results panel shows the example record: a real S3 record, shipped with NexCODE and marked as an example."
            : `📋 The latest record, ${String(r.of || "").toUpperCase()} record ${r.recordId}, is open in the Results panel.`
        );
    });
  // S6-D6 (a): the presenter's Commit to the Bank's repository (the app never commits on its own).
  const commitChange = () =>
    run("Commit", { action: "commit", scenarioId: scenario.id }, (r) => {
      if (!r || !r.success) return;
      setMessage({ tone: "good", text: `Committed ${String(r.commit).slice(0, 7)} on ${r.branch}` });
      if (typeof onNote === "function")
        onNote(
          `📦 Committed \`${String(r.commit).slice(0, 7)}\` on \`${r.branch}\` and pushed it to the Bank's repository: ${r.files.length} file(s), evidence record ${r.recordId} among them, labelled AI-assisted. It waits there for a person to review and approve it (REV-005).`,
          { coding: { kind: "record", recordId: r.recordId, scenarioId: scenario.id } }
        );
    });
  const showChanges = async (next) => {
    setBusy("Show the change");
    setMessage(null);
    const results = [];
    for (const p of next.pending || []) results.push(await showProposalInIde({ turnId: next.turnId, path: p }));
    const failed = results.filter((r) => !r || !r.success);
    setMessage(failed.length ? { tone: "bad", text: `Show the change: ${failed[0].error || "the IDE did not show it"}` } : { tone: "good", text: `${results.length} proposed change(s) open in the IDE.` });
    setBusy(null);
  };
  // S3-D14 (b) of 2026-10-12: the demo ends in a known state, with a record that says the change failed its tests.
  const recordFailedAttempt = () =>
    run("Record the failed attempt", { action: "record", scenarioId: scenario.id, outcome: "failed" }, (r) => {
      if (r.success) {
        setMessage({ tone: "bad", text: `Failed attempt recorded: ${r.recordId}, not ready for review (${r.paths[1]})` });
        if (typeof onNote === "function")
          onNote(`📋 Evidence record ${r.recordId} keeps the failed attempt: the change did not pass its tests, so it is not ready for review and nothing ships. It is open in the IDE: \`${r.paths[1]}\`.`, {
            coding: { kind: "record", recordId: r.recordId, scenarioId: scenario.id },
          });
      }
    });
  const resetScenario = () =>
    run("Reset this demo", { action: "reset-scenario", scenarioId: scenario.id }, (r) => {
      if (r.success) {
        if (typeof onClearStep === "function") onClearStep();
        if (typeof onResetChat === "function") onResetChat();
        setMessage({ tone: "good", text: `${scenario.id.toUpperCase()} reset: ${r.restored.length} path(s) restored, ${r.recordsRemoved} record file(s) removed.` });
      }
    });
  const stateChips = (
    <div className="ml-auto flex items-center gap-1.5">
      {busy && <RiLoader4Line size={14} className="animate-spin text-brand-vivid" />}
      <span className={`${CHIP} ${bridgeUp ? GOOD : WARN}`} title={bridgeUp ? `extension host ${state.bridge.pid}` : offlineReason}>
        {bridgeUp ? "bridge active" : "bridge offline"}
      </span>
      <span className={`${CHIP} ${seed && seed.commit ? MUTED : WARN}`} title={seed && seed.commit ? `seed commit ${seed.commit}` : "The seed repository is not in the workspace: use the sidebar's Reset, then Reset the demo environment."}>
        {seed && seed.commit ? `seed ${seed.commit.slice(0, 7)}` : "seed not loaded"}
      </span>
      <button type="button" onClick={refresh} className="p-1 rounded-lg text-neutrals-medium hover:text-white cursor-pointer" title="Re-read the steps, the bridge and the seed">
        <RiRefreshLine size={14} />
      </button>
    </div>
  );

  if (!scenario) {
    return (
      <div className="bg-[#121212] border border-white/10 rounded-3xl px-5 py-3 shadow-2xl shrink-0 text-white flex flex-col gap-2.5" data-step-bar="none">
        <div className="flex items-center gap-2 flex-wrap">
          <RiSlideshow3Line size={16} className="text-brand-vivid" />
          <span className="text-xs font-sans font-bold uppercase tracking-widest text-neutrals-light">No demo selected</span>
          {state && stateChips}
        </div>
        <div className="rounded-2xl border border-brand-vivid/40 bg-brand-vivid/10 px-3.5 py-2.5 flex items-center gap-2.5 flex-wrap" data-next-action="select">
          <span className="text-[10px] font-sans font-bold uppercase tracking-[0.2em] text-brand-vivid">Next</span>
          <button type="button" className={PRIMARY} onClick={() => presenter.openDemoPanel("overview")}>
            <RiSlideshow3Line size={14} /> Open the Demo panel
          </button>
          <span className="text-[12px] font-sans text-neutrals-light">Choose a demo and press Select demo.</span>
        </div>
        {(loadError || message) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {loadError && <span className={`${CHIP} ${BAD}`}>steps: {loadError}</span>}
            {message && <span className={`${CHIP} ${message.tone === "good" ? GOOD : BAD}`}>{message.text}</span>}
          </div>
        )}
      </div>
    );
  }

  const steps = progress ? progress.steps : [];
  const next = progress && progress.next ? progress.next : null;
  const previousRequired = (i) => {
    for (let k = i - 1; k >= 0; k--) if (!steps[k].optional && steps[k].status !== "done") return k + 1;
    return i;
  };
  const pickStep = (step, st) => {
    if (!st || st.status === "locked") return;
    if (step.action === "record") {
      recordChange();
      return;
    }
    if (step.action === "results") {
      showRecord();
      return;
    }
    if (step.action === "commit") {
      commitChange();
      return;
    }
    ask(step);
  };
  // The server's next action, or its alternative (S3-D14 (b): "Record the failed attempt" beside the repair).
  const doAction = (a) => {
    if (!a) return;
    const step = scenario.steps.find((x) => x.id === a.stepId) || null;
    if (a.action === "ask" && step) ask(step);
    else if (a.action === "repair" && step) ask(step, { repair: true });
    else if (a.action === "apply") showChanges(a);
    else if (a.action === "run-tests") runTests();
    else if (a.action === "record") recordChange();
    else if (a.action === "record-failed") recordFailedAttempt();
    else if (a.action === "results") presenter.openResults({ scenarioId: scenario.id });
    else if (a.action === "show-record") showRecord();
    else if (a.action === "commit") commitChange();
  };
  const doNext = () => doAction(next);
  const disabledFor = (a) =>
    !a ||
    ((a.action === "ask" || a.action === "repair") && isAnalyzing) ||
    ((a.action === "apply" || a.action === "run-tests") && (!bridgeUp || Boolean(busy) || isAnalyzing)) ||
    ((a.action === "record" || a.action === "record-failed" || a.action === "show-record") && (Boolean(busy) || isAnalyzing)) ||
    (a.action === "commit" && (!bridgeUp || Boolean(busy) || isAnalyzing));
  const nextDisabled = disabledFor(next);
  const nextStep = next && next.stepId ? steps.find((x) => x.id === next.stepId) : null;
  const NextIcon = next && NEXT_ICONS[next.action] ? NEXT_ICONS[next.action] : RiArrowRightLine;

  return (
    <div className="bg-[#121212] border border-white/10 rounded-3xl px-5 py-3 shadow-2xl shrink-0 text-white flex flex-col gap-2.5" data-step-bar={scenario.id}>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="flex items-center gap-1.5 cursor-pointer" onClick={() => presenter.openDemoPanel("overview", scenario.id)} title="Open the Demo panel">
          <RiSlideshow3Line size={14} className="text-brand-vivid" />
          <span className="text-xs font-sans font-bold uppercase tracking-widest text-neutrals-light">{scenario.id.toUpperCase()}</span>
          <span className="text-xs font-sans text-neutrals-medium hidden xl:inline">· {scenario.title}</span>
        </button>
        <span className={`${CHIP} ${MUTED}`}>{scenario.ticket.id}</span>
        {stateChips}
      </div>

      <ol className="flex items-center gap-1 flex-wrap" data-steps="true">
        {scenario.steps.map((step, i) => {
          const st = steps.find((x) => x.id === step.id) || { status: i === 0 ? "ready" : "locked" };
          const current = Boolean(next && next.stepId === step.id);
          const active = Boolean(activeStep && activeStep.id === scenario.id && activeStep.stepId === step.id);
          const locked = st.status === "locked";
          const title = locked
            ? `Complete step ${previousRequired(i)} first`
            : step.action === "record"
              ? st.status === "done"
                ? "Recorded; press to write a new record"
                : "Build the evidence record from the run log and write it into the workspace"
              : step.action === "results"
                ? "Open the Results panel on the latest record of any demo since the environment reset, or the example record"
              : step.action === "commit"
                ? st.status === "done"
                  ? "Committed; press to commit again"
                  : "Commit the new files and the evidence record to the Bank's repository, on the demo's feature branch"
              : st.status === "done"
                ? "Done; press to use the prompt again"
                : "Put this step's prompt into the chat box (edit it, then send)";
          return (
            <li key={step.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-neutrals-dark text-[11px] select-none">›</span>}
              <button
                type="button"
                className={stepClass(st.status, current, active)}
                disabled={locked || isAnalyzing || ((step.action === "record" || step.action === "results" || step.action === "commit") && Boolean(busy))}
                title={title}
                onClick={() => pickStep(step, st)}
                data-step={step.id}
                data-status={st.status}
              >
                <span className="font-mono text-[10px] opacity-80">{i + 1}</span>
                {st.status === "done" ? <RiCheckboxCircleFill size={13} /> : locked ? <RiLock2Line size={12} /> : step.action === "record" ? <RiFileShield2Line size={13} /> : step.action === "results" ? <RiFileChartLine size={13} /> : step.action === "commit" ? <RiGitCommitLine size={13} /> : <RiPlayCircleLine size={13} />}
                {step.title}
                {step.optional ? <span className="text-[10px] font-mono opacity-70">optional</span> : null}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl border border-brand-vivid/40 bg-brand-vivid/10 px-3.5 py-2.5 flex flex-col gap-1.5" data-next-action={next ? next.action : "unknown"}>
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-[10px] font-sans font-bold uppercase tracking-[0.2em] text-brand-vivid">Next</span>
          {next && next.action === "results" && next.outcome !== "failed" && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-sans font-bold text-teal-200">
              <RiCheckboxCircleFill size={14} /> Demo complete
            </span>
          )}
          {next && next.action === "results" && next.outcome === "failed" && (
            <span className={`${CHIP} ${WARN}`} data-failed-attempt="true">
              failed attempt recorded: not ready for review
            </span>
          )}
          {next ? (
            <button type="button" className={PRIMARY} disabled={nextDisabled} onClick={doNext} title={next.detail || ""} data-next-button={next.action}>
              <NextIcon size={14} /> {next.label}
            </button>
          ) : (
            <span className="text-[12px] font-sans text-neutrals-medium">{loadError ? `The steps could not be read: ${loadError}` : "Reading the steps…"}</span>
          )}
          {next && next.alternative && (
            <button type="button" className={BUTTON} disabled={disabledFor(next.alternative)} onClick={() => doAction(next.alternative)} title={next.alternative.detail || ""} data-alternative-button={next.alternative.action}>
              {next.alternative.label}
            </button>
          )}
        </div>
        {next && next.detail && <div className="text-[12px] font-sans text-neutrals-light leading-snug">{next.detail}</div>}
        {nextStep && nextStep.change && (
          <div className="flex items-center gap-3 flex-wrap" data-checklist={nextStep.id}>
            <Check state={nextStep.turn ? "done" : "todo"}>{nextStep.turn ? "Change proposed" : "Ask for the change"}</Check>
            <Check state={nextStep.change.proposed.length > 0 && nextStep.change.pending.length === 0 ? "done" : "todo"}>
              {nextStep.change.proposed.length > 0 ? `${nextStep.change.applied.length} of ${nextStep.change.proposed.length} applied` : "Apply the change"}
            </Check>
            <Check state={nextStep.tests && nextStep.tests.state === "passed" ? "done" : nextStep.tests && nextStep.tests.state === "failed" ? "failed" : "todo"}>
              {nextStep.tests && nextStep.tests.state === "passed"
                ? `Tests pass (${nextStep.tests.summary || "exit 0"})`
                : nextStep.tests && nextStep.tests.state === "failed"
                  ? `Tests failed (${nextStep.tests.summary || `exit ${nextStep.tests.exitCode}`})`
                  : "Tests pass"}
            </Check>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {scenario.commands && scenario.commands.tests ? (
          <button type="button" className={BUTTON} disabled={!bridgeUp || Boolean(busy)} title={bridgeUp ? "Run the demo's tests in the IDE container" : offlineReason} onClick={runTests}>
            <RiTestTubeLine size={12} /> Run tests
          </button>
        ) : null}
        <button type="button" className={BUTTON} disabled={!bridgeUp || Boolean(busy) || isAnalyzing} title={bridgeUp ? "This demo's files back to the seed, its records removed, the chat cleared" : offlineReason} onClick={resetScenario}>
          <RiArrowGoBackLine size={12} /> Reset this demo
        </button>
        {!bridgeUp && <span className="text-[11px] text-amber-400 font-sans">{offlineReason}</span>}
        {loadError && <span className={`${CHIP} ${BAD}`}>steps: {loadError}</span>}
        {message && <span className={`${CHIP} ${message.tone === "good" ? GOOD : BAD}`}>{message.text}</span>}
      </div>
    </div>
  );
}
