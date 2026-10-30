"use client";

/**
 * RecordReport — an evidence record as a report the room can read (PR B; the owner's D1 (b) of 2026-10-07). Built from
 * the record's JSON (src/lib/coding/record.js, schema nexcode.evidence/*), never from its raw text: the outcome in four
 * tiles; what happened, in order; the rules behind the change, each quoted with a button that opens its document at the
 * page; the tests; the files changed (the code itself is on the Code change tab); approval and verification; the
 * platform. Every value is text; nothing is injected as HTML.
 *
 * S2 (the pull request review, 2026-10-09): a record with a review shows it first after the tiles: the outcome (REV-007),
 * each finding with its severity, location, rules, how it was established (REV-004) and whether the fix resolved it
 * (tool findings are re-checked when the record is built), and the follow-ups.
 *
 * S4 (the closer, 2026-10-12): an answer record (`kind: "answer"`, S4-D4 (a)) shows the question and NexCODE's answer
 * first, the regulations traced through the rules' "Traces to:" lines, and says that it changed no code and ran no
 * tests; the shipped example record (S4-D2 (a)) is marked as an example.
 *
 * S5 (compliant comments, 2026-10-12): a record with the documentation check shows it after the tiles, verified by tool:
 * no line of code changed (DOC-008), the program's own check, the header, the units, card numbers, commented-out code;
 * and (0.9, S5-D14 (a)) any line of code a tool put back before the change was shown.
 *
 * S6 (0.10, the owner's S6-D1 to S6-D7 of 2026-10-13): the Python check (the module's syntax tree: docstrings, money
 * tags, the AI disclosure, and the run that proved the comments-only change); the test-and-improve step's results before
 * and after with NexCODE's recommendations; and the commit to the Bank's repository, once the presenter committed it.
 */
import React, { useState } from "react";
import MarkdownBlocks from "./MarkdownBlocks";
import { SplitBar, INPUT_HUES, OUTPUT_HUES } from "./SplitBars";
import { formatMoney } from "@/lib/coding/pricing";
import {
  RiFileShield2Line,
  RiTestTubeLine,
  RiCodeSSlashLine,
  RiGovernmentLine,
  RiCpuLine,
  RiDoubleQuotesL,
  RiExternalLinkLine,
  RiMapPin2Line,
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiQuestionAnswerLine,
  RiNodeTree,
  RiGitCommitLine,
  RiLightbulbFlashLine,
} from "@remixicon/react";

const CHIP = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border";
const MUTED = "bg-white/5 text-neutrals-medium border-white/10";
const GOOD = "bg-teal-500/15 text-teal-300 border-teal-500/25";
const BAD = "bg-red-500/15 text-red-300 border-red-500/25";
const WARN = "bg-amber-500/15 text-amber-300 border-amber-500/25";
const LAYERS = {
  regulator: { label: "External regulation", hue: "bg-blue-500/10 text-blue-300 border-blue-500/25" },
  corporate: { label: "Corporate policy", hue: "bg-purple-500/10 text-purple-300 border-purple-500/25" },
  sdlc: { label: "Engineering standards", hue: "bg-teal-500/10 text-teal-300 border-teal-500/25" },
  team: { label: "Team knowledge", hue: "bg-amber-500/10 text-amber-300 border-amber-500/25" },
};
const STEP_LABELS = { diagnose: "Diagnose", review: "Review", fix: "Fix and test", explain: "Explain", migrate: "Migrate", record: "Record", build: "Build", comment: "Comment", improve: "Test and improve", audit: "Security audit" };
const SEVERITY_HUES = { Critical: BAD, High: WARN, Medium: "bg-yellow-500/10 text-yellow-200 border-yellow-500/20", Low: MUTED };
const H = "text-[11px] font-sans font-bold uppercase tracking-[0.18em] text-brand-vivid mb-3";
const PANEL = "rounded-2xl border border-white/10 bg-white/2 px-5 py-4";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
function clock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function duration(ms) {
  if (!Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${pad(s % 60)} s` : `${(ms / 1000).toFixed(1)} s`;
}
const withCommas = (n) => (Number.isFinite(n) ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "—");

function Tile({ icon: Icon, label, value, sub, tone = "neutral", compact = false }) {
  const ring = tone === "good" ? "border-teal-500/30 bg-teal-500/5" : tone === "bad" ? "border-red-500/30 bg-red-500/5" : tone === "warn" ? "border-amber-500/30 bg-amber-500/5" : "border-white/10 bg-black/30";
  return (
    <div className={`rounded-2xl border px-4 py-3 min-w-0 ${ring}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-sans font-bold uppercase tracking-[0.16em] text-neutrals-medium">
        <Icon size={12} /> {label}
      </div>
      <div className={`font-sans font-bold text-white mt-1 ${compact ? "text-base break-words leading-snug" : "text-xl truncate"}`} title={String(value)}>
        {value}
      </div>
      {sub ? <div className="text-[12px] font-sans text-neutrals-medium mt-0.5 truncate" title={String(sub)}>{sub}</div> : null}
    </div>
  );
}

export default function RecordReport({ record, onShowCode, onOpenPassage, onOpenInIde }) {
  const [openOutput, setOpenOutput] = useState(null);
  if (!record || typeof record !== "object") return null;
  const turns = Array.isArray(record.turns) ? record.turns : [];
  const tests = Array.isArray(record.tests) ? record.tests : [];
  const rules = Array.isArray(record.rules) ? record.rules : [];
  const files = record.changes && Array.isArray(record.changes.files) ? record.changes.files : [];
  const lastTest = tests.length ? tests[tests.length - 1] : null;
  const passed = lastTest && lastTest.exitCode === 0;
  const layersCited = [...new Set(rules.map((r) => r.layer))];
  const models = [...new Set(turns.map((t) => t.model).filter(Boolean))];
  const modelMs = turns.reduce((n, t) => n + (t.timing && Number.isFinite(t.timing.modelMs) ? t.timing.modelMs : 0), 0);
  const tokensIn = turns.reduce((n, t) => n + (t.tokens && Number.isFinite(t.tokens.prompt) ? t.tokens.prompt : 0), 0);
  const tokensOut = turns.reduce((n, t) => n + (t.tokens && Number.isFinite(t.tokens.completion) ? t.tokens.completion : 0), 0);
  const thinking = [...new Set(turns.map((t) => (t.thinking ? t.thinking.mode : null)).filter(Boolean))];
  const added = files.reduce((n, f) => n + (Number.isFinite(f.added) ? f.added : 0), 0);
  const removed = files.reduce((n, f) => n + (Number.isFinite(f.removed) ? f.removed : 0), 0);
  const unverified = turns.reduce((n, t) => n + (Array.isArray(t.unverifiedMarkers) ? t.unverifiedMarkers.length : 0), 0);
  // S4: an answer record keeps the auditor's questions and NexCODE's answers, and the regulations traced for them.
  const answer = record.kind === "answer";
  const asked = turns.filter((t) => t.mode === "audit");
  const regTraced = [...new Set(asked.flatMap((t) => (t.regulatorTrace && Array.isArray(t.regulatorTrace.found) ? t.regulatorTrace.found.map((x) => x.label) : [])))];
  const regMissing = [...new Set(asked.flatMap((t) => (t.regulatorTrace && Array.isArray(t.regulatorTrace.missing) ? t.regulatorTrace.missing.map((x) => x.label) : [])))].filter((x) => !regTraced.includes(x));
  const regulationsCited = rules.filter((r) => r.layer === "regulator").length;
  const timeline = [
    ...turns.map((t) => ({ at: t.at, kind: "turn", label: t.mode === "audit" ? "The question" : STEP_LABELS[t.step] || (t.step ? t.step : "Free-form question"), detail: `${t.model || "model"}, thinking ${t.thinking ? t.thinking.mode : "?"}, ${duration(t.timing ? t.timing.wallMs : null)}; ${t.cited.length} rule(s) cited${t.fileOperations.length ? `; ${t.fileOperations.length} file(s) proposed` : ""}` })),
    ...tests.map((t) => ({ at: t.at, kind: "test", label: "Tests", detail: `${t.summary || `exit code ${t.exitCode}`} (${t.command})`, ok: t.exitCode === 0 })),
    { at: record.createdAt, kind: "record", label: "Record", detail: "built from the run log" },
    ...(record.commit && record.commit.commit ? [{ at: record.commit.at, kind: "record", label: "Commit", detail: `${String(record.commit.commit).slice(0, 7)} on ${record.commit.branch}, pushed to the Bank's repository` }] : []),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const doc = record.verification && record.verification.documentation && !record.verification.documentation.error ? record.verification.documentation : null;
  const pyDoc = doc && doc.language === "python" ? doc : null;
  const proof = pyDoc ? (pyDoc.compared ? { at: pyDoc.at, codeUnchanged: pyDoc.codeUnchanged } : pyDoc.codeUnchangedProof || null) : null;
  const improvement = record.verification && record.verification.improvement ? record.verification.improvement : null;

  return (
    <div className="flex flex-col gap-5" data-record-report={record.id}>
      <header className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[320px]">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className={`${CHIP} bg-brand-vivid/15 text-brand-vivid border-brand-vivid/25`}>{record.scenario ? String(record.scenario.id).toUpperCase() : "—"}</span>
            {record.scenario && record.scenario.ticket && <span className={`${CHIP} ${MUTED}`}>{record.scenario.ticket}</span>}
            {record.example && (
              <span className={`${CHIP} ${WARN}`} data-record-example={record.example.of || "true"}>
                example
              </span>
            )}
            {answer && (
              <span className={`${CHIP} ${GOOD}`} data-record-kind="answer">
                an answer · no code changed
              </span>
            )}
            <span className={`${CHIP} ${record.approval && record.approval.status === "approved" ? GOOD : WARN}`}>approval {record.approval ? record.approval.status : "pending"}</span>
            {record.outcome && record.outcome.status === "not ready for review" && (
              <span className={`${CHIP} ${BAD}`} data-record-outcome="failed">
                not ready for review: {record.outcome.reason}
              </span>
            )}
            {unverified > 0 && <span className={`${CHIP} ${WARN}`}>{unverified} unverified marker(s)</span>}
            {record.review && <span className={`${CHIP} ${record.review.outcome === "Changes requested" ? WARN : GOOD}`} data-review-outcome={record.review.outcome}>review: {record.review.outcome}</span>}
          </div>
          <h2 className="text-2xl font-bold text-white leading-tight flex items-center gap-2">
            <RiFileShield2Line size={22} className="text-brand-vivid" /> Evidence record {record.id}
          </h2>
          <p className="text-base text-neutrals-light font-sans mt-1">{record.scenario ? record.scenario.title : ""}</p>
          {record.outcome && record.outcome.status === "not ready for review" && (
            <p className="text-[13px] font-sans text-red-200 mt-1" data-failed-attempt-note="true">
              This record keeps a failed attempt: the change did not pass its tests
              {record.outcome.lastRun && record.outcome.lastRun.summary ? ` (${record.outcome.lastRun.summary})` : ""}, so it is not ready for review and nothing ships.
            </p>
          )}
          {record.example && (
            <p className="text-[13px] font-sans text-amber-200 mt-1" data-example-note="true">
              {record.example.note || "An example record, shipped with NexCODE."}
            </p>
          )}
          <p className="text-[12px] font-mono text-neutrals-medium mt-1">
            {when(record.createdAt)}
            {record.firm ? ` · ${record.firm}` : ""}
          </p>
        </div>
        <p className="text-[12px] font-sans text-neutrals-medium max-w-[340px] text-right">Built by NexCODE from its own run log: no model wrote this record. A person approves it.</p>
      </header>

      {answer ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3" data-answer-tiles="true">
          <Tile icon={RiQuestionAnswerLine} label="Questions" value={`${asked.length} answered`} sub="no code changed, no tests run" tone={asked.length ? "good" : "warn"} />
          <Tile icon={RiNodeTree} label="Regulations" value={`${regulationsCited} cited`} sub={regTraced.length ? `${regTraced.length} traced through the rules' trace lines${regMissing.length ? `, ${regMissing.length} not found` : ""}` : "found by the search"} tone={regulationsCited ? "good" : "warn"} />
          <Tile icon={RiGovernmentLine} label="Rules cited" value={`${rules.length} passage${rules.length === 1 ? "" : "s"}`} sub={layersCited.length ? layersCited.map((l) => (LAYERS[l] ? LAYERS[l].label : l)).join(", ") : "none"} tone={rules.length ? "neutral" : "warn"} />
          <Tile compact icon={RiCpuLine} label="AI used" value={models.join(", ") || "—"} sub={`thinking ${thinking.join("/") || "?"} · model time ${duration(modelMs)} · ${withCommas(tokensIn)} → ${withCommas(tokensOut)} tokens`} />
        </div>
      ) : (
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Tile icon={RiTestTubeLine} label="Tests" value={lastTest ? lastTest.summary || `exit ${lastTest.exitCode}` : "not run"} sub={lastTest ? `exit code ${lastTest.exitCode} · ${lastTest.command}` : "no test run was recorded"} tone={!lastTest ? "warn" : passed ? "good" : "bad"} />
        <Tile icon={RiCodeSSlashLine} label="Code change" value={files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "none"} sub={files.length ? `+${added} -${removed} lines` : "no file differs from the seed"} />
        <Tile icon={RiGovernmentLine} label="Rules cited" value={`${rules.length} passage${rules.length === 1 ? "" : "s"}`} sub={layersCited.length ? layersCited.map((l) => (LAYERS[l] ? LAYERS[l].label : l)).join(", ") : "none"} tone={rules.length ? "neutral" : "warn"} />
        <Tile compact icon={RiCpuLine} label="AI used" value={models.join(", ") || "—"} sub={`thinking ${thinking.join("/") || "?"} · model time ${duration(modelMs)} · ${withCommas(tokensIn)} → ${withCommas(tokensOut)} tokens`} />
      </div>
      )}

      {answer && (
        <section className={PANEL} data-report-answers={asked.length}>
          <h3 className={H}>The question and the answer</h3>
          {asked.length === 0 ? (
            <p className="text-[14px] font-sans text-neutrals-medium">No question was answered in this demo since its last reset.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {asked.map((t, i) => (
                <article key={t.turnId || i} className="flex flex-col gap-2" data-report-answer={t.turnId || i}>
                  <p className="text-[16px] font-sans font-bold text-white flex items-start gap-2">
                    <RiQuestionAnswerLine size={18} className="text-brand-vivid shrink-0 mt-0.5" />
                    <span>{t.prompt}</span>
                  </p>
                  <p className="text-[12px] font-mono text-neutrals-medium">
                    {t.model || "model"} · {clock(t.at)} · {Array.isArray(t.cited) ? t.cited.length : 0} passage(s) cited, each checked against the passages given to the model
                    {Array.isArray(t.unverifiedMarkers) && t.unverifiedMarkers.length ? ` · unverified: ${t.unverifiedMarkers.join(", ")}` : ""}
                  </p>
                  <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                    {t.answer ? <MarkdownBlocks text={t.answer} /> : <p className="text-[13px] font-sans text-neutrals-medium">The answer&apos;s text was not kept.</p>}
                  </div>
                </article>
              ))}
            </div>
          )}
          {(regTraced.length > 0 || regMissing.length > 0) && (
            <p className="text-[13px] font-sans text-neutrals-light mt-3" data-report-regtrace={regTraced.length}>
              Regulations traced through the rules&apos; &quot;Traces to:&quot; lines and found in their own text: {regTraced.join("; ") || "none"}
              {regMissing.length ? `. Named but not found: ${regMissing.join("; ")}.` : "."}
            </p>
          )}
        </section>
      )}

      {pyDoc && (
        <section className={PANEL} data-report-documentation={pyDoc.passed ? "passed" : "failed"} data-report-language="python">
          <h3 className={H}>The documentation check (STD-DOC)</h3>
          <p className="text-[15px] font-sans text-neutrals-light flex items-start gap-2">
            {pyDoc.passed && proof && proof.codeUnchanged && pyDoc.programCheckPassed ? <RiCheckboxCircleFill size={20} className="text-teal-300 shrink-0 mt-0.5" /> : <RiCloseCircleFill size={20} className="text-red-300 shrink-0 mt-0.5" />}
            <span>
              {pyDoc.passed ? "Documented to the standard" : "Not yet documented to the standard"}, checked by a tool that reads the module&apos;s syntax tree;{" "}
              {proof ? (proof.codeUnchanged ? "the comments-only change changed no line of code" : "a line of code changed in the comments-only change") : "the code was not compared"}; the module&apos;s tests {pyDoc.programCheckPassed ? "pass" : "failed"}.
            </span>
          </p>
          <ul className="mt-2 text-[13px] font-sans text-neutrals-light list-disc pl-6 space-y-0.5">
            <li>The header (DOC-001): {Array.isArray(pyDoc.headerMissing) && pyDoc.headerMissing.length ? `missing ${pyDoc.headerMissing.join(", ")}` : "every field present"}; the assistant named in it (DOC-007): {pyDoc.aiDisclosure && pyDoc.aiDisclosure.namesAssistant ? "yes" : "no"}.</li>
            <li>Docstrings (DOC-002): {pyDoc.units ? `${pyDoc.units.commented} of ${pyDoc.units.total} classes and functions` : "—"}; money logic naming its requirement (DOC-006): {pyDoc.money ? `${pyDoc.money.tagged} of ${pyDoc.money.total} functions` : "—"}.</li>
            <li>
              Card numbers in comments and docstrings (DOC-004): {Array.isArray(pyDoc.cardNumbers) && pyDoc.cardNumbers.length ? `line ${pyDoc.cardNumbers.join(", ")}` : "none"}; commented-out code (DOC-005): {Array.isArray(pyDoc.commentedOutCode) && pyDoc.commentedOutCode.length ? `line ${pyDoc.commentedOutCode.join(", ")}` : "none"}.
            </li>
            {proof && <li>No line of code changed (DOC-008): compared by syntax tree with the module as NexCODE was given it, docstrings and comments set aside, in the run of {proof.at || "—"}.</li>}
            <li>Verified by tool in the run of {pyDoc.at || "—"}. Whether each docstring agrees with the code (DOC-003) is the reviewer&apos;s to judge.</li>
          </ul>
        </section>
      )}

      {improvement && (
        <section className={PANEL} data-report-improvement={improvement.after && improvement.after.exitCode === 0 ? "passed" : "pending"}>
          <h3 className={H}>Test and improve</h3>
          <p className="text-[15px] font-sans text-neutrals-light flex items-start gap-2">
            <RiLightbulbFlashLine size={20} className="text-brand-vivid shrink-0 mt-0.5" />
            <span>
              Before NexCODE&apos;s recommendations the tests gave <span className="font-bold text-white">{improvement.before ? improvement.before.summary : "no run"}</span>; after the improvements, <span className={`font-bold ${improvement.after && improvement.after.exitCode === 0 ? "text-teal-300" : "text-amber-300"}`}>{improvement.after ? improvement.after.summary : "no run yet"}</span>. The runs are verified by tool; the recommendations are NexCODE&apos;s, for the reviewer.
            </span>
          </p>
          {improvement.recommendations ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
              <MarkdownBlocks text={improvement.recommendations} />
            </div>
          ) : null}
        </section>
      )}

      {record.usage && record.usage.totals && record.usage.totals.answers > 0 && (
        <section className={PANEL} data-report-usage={record.usage.totals.total}>
          <h3 className={H}>Tokens</h3>
          <p className="text-[15px] font-sans text-neutrals-light">
            <span className="font-bold text-white">{withCommas(record.usage.totals.prompt)} in</span> and <span className="font-bold text-white">{withCommas(record.usage.totals.completion)} out</span>, {withCommas(record.usage.totals.total)} in all, over {record.usage.totals.answers} answer{record.usage.totals.answers === 1 ? "" : "s"} since the demo was selected
            {record.usage.totals.estimated ? ` (${record.usage.totals.estimated} estimated by the app, not reported by the model server)` : ""}
            {record.usage.totals.uncounted ? ` (${record.usage.totals.uncounted} with no figure)` : ""}.
            {record.usage.totals.cost ? (
              <span data-report-usage-cost={record.usage.totals.cost.amount === null ? "none" : record.usage.totals.cost.amount}>
                {" "}Cost: <span className="font-bold text-white">{formatMoney(record.usage.totals.cost.amount, record.usage.totals.cost.currency)}</span>
                {record.usage.totals.cost.amount === null ? ` (no price set for ${record.usage.totals.cost.unpriced.join(", ")})` : ""}.
              </span>
            ) : null}
          </p>
          <table className="mt-3 w-full text-[12px] font-mono">
            <thead>
              <tr className="text-neutrals-medium text-[9px] uppercase tracking-wider">
                <th className="text-left font-normal pb-1">Step</th>
                <th className="text-right font-normal pb-1">Answers</th>
                <th className="text-right font-normal pb-1">In</th>
                <th className="text-right font-normal pb-1">Out</th>
                <th className="text-right font-normal pb-1">Total</th>
                <th className="text-right font-normal pb-1">Cost</th>
              </tr>
            </thead>
            <tbody>
              {record.usage.steps.map((st) => (
                <tr key={st.id} className="text-neutrals-light" data-report-usage-step={st.id}>
                  <td className="py-0.5 pr-2 font-sans">
                    {st.title}
                    {st.repairs > 0 ? <span className="text-neutrals-medium"> (+{st.repairs} repair{st.repairs === 1 ? "" : "s"})</span> : null}
                  </td>
                  <td className="text-right py-0.5">{st.answers}</td>
                  <td className="text-right py-0.5">{withCommas(st.prompt)}</td>
                  <td className="text-right py-0.5">{withCommas(st.completion)}</td>
                  <td className="text-right py-0.5 text-white">{withCommas(st.total)}</td>
                  <td className="text-right py-0.5">{st.cost ? formatMoney(st.cost.amount, st.cost.currency) : "—"}</td>
                </tr>
              ))}
              {record.usage.freeForm.answers > 0 && (
                <tr className="text-neutrals-light">
                  <td className="py-0.5 pr-2 font-sans">Free-form, in this demo</td>
                  <td className="text-right py-0.5">{record.usage.freeForm.answers}</td>
                  <td className="text-right py-0.5">{withCommas(record.usage.freeForm.prompt)}</td>
                  <td className="text-right py-0.5">{withCommas(record.usage.freeForm.completion)}</td>
                  <td className="text-right py-0.5 text-white">{withCommas(record.usage.freeForm.total)}</td>
                  <td className="text-right py-0.5">{record.usage.freeForm.cost ? formatMoney(record.usage.freeForm.cost.amount, record.usage.freeForm.cost.currency) : "—"}</td>
                </tr>
              )}
            </tbody>
          </table>
          {record.usage.pricingUsed && Object.keys(record.usage.pricingUsed.models || {}).length > 0 && (
            <p className="mt-2 text-[12px] font-sans text-neutrals-medium" data-report-pricing-used>
              Costed at the prices in force when this record was built, per million tokens in {record.usage.pricingUsed.currency}:{" "}
              {Object.entries(record.usage.pricingUsed.models)
                .map(([m, row]) => `${m} in ${row.input}, out ${row.output}${row.source === "default" ? " (the default row)" : ""}`)
                .join("; ")}
              . Source: the Admin Panel&apos;s price table.
            </p>
          )}
          {record.usage.split && record.usage.split.answers > 0 && (
            <div className="mt-3 space-y-2 text-[12px] font-sans text-neutrals-light" data-report-usage-split={record.usage.split.answers}>
              <p>Where the tokens went, over {record.usage.split.answers} coding answer{record.usage.split.answers === 1 ? "" : "s"}, apportioned by {record.usage.split.basis} (the server counts one figure per answer; the app splits it by the size of each part it composed):</p>
              <SplitBar compact title="Input" groups={record.usage.split.input} hues={INPUT_HUES} />
              <SplitBar compact title="Output" groups={record.usage.split.output} hues={OUTPUT_HUES} />
            </div>
          )}
        </section>
      )}

      {record.commit && record.commit.commit && (
        <section className={PANEL} data-report-commit={String(record.commit.commit).slice(0, 12)}>
          <h3 className={H}>The commit</h3>
          <p className="text-[15px] font-sans text-neutrals-light flex items-start gap-2">
            <RiGitCommitLine size={20} className="text-teal-300 shrink-0 mt-0.5" />
            <span>
              Committed <span className="font-mono text-white">{String(record.commit.commit).slice(0, 12)}</span> on <span className="font-mono text-white">{record.commit.branch}</span> by {record.commit.author}, {when(record.commit.at)}, and pushed to {record.commit.repository}. A person reviews and approves it before it is merged (REV-005).
            </span>
          </p>
          {Array.isArray(record.commit.files) && record.commit.files.length > 0 && (
            <ul className="mt-2 text-[13px] font-mono text-neutrals-light list-disc pl-6 space-y-0.5">
              {record.commit.files.map((x) => (
                <li key={x.path}>
                  {x.status}: {x.path}
                </li>
              ))}
            </ul>
          )}
          {record.commit.note ? <p className="text-[12px] font-sans text-neutrals-medium mt-2">{record.commit.note}</p> : null}
        </section>
      )}

      {record.verification && record.verification.documentation && !record.verification.documentation.error && !pyDoc && (
        <section className={PANEL} data-report-documentation={record.verification.documentation.codeUnchanged ? "unchanged" : "changed"}>
          <h3 className={H}>The documentation check (DOC-008)</h3>
          <p className="text-[15px] font-sans text-neutrals-light flex items-start gap-2">
            {record.verification.documentation.codeUnchanged && record.verification.documentation.programCheckPassed ? (
              <RiCheckboxCircleFill size={20} className="text-teal-300 shrink-0 mt-0.5" />
            ) : (
              <RiCloseCircleFill size={20} className="text-red-300 shrink-0 mt-0.5" />
            )}
            <span>
              {record.verification.documentation.codeUnchanged ? "No line of code changed" : "A line of code changed"}, compared by a tool, and the program&apos;s own check{" "}
              {record.verification.documentation.programCheckPassed ? "still passes: the same report from the same input" : "failed"}.
            </span>
          </p>
          <ul className="mt-2 text-[13px] font-sans text-neutrals-light list-disc pl-6 space-y-0.5">
            <li>
              The header (DOC-001):{" "}
              {Array.isArray(record.verification.documentation.headerMissing) && record.verification.documentation.headerMissing.length ? `missing ${record.verification.documentation.headerMissing.join(", ")}` : "every field present"}.
            </li>
            <li>
              Purpose comments (DOC-002):{" "}
              {record.verification.documentation.units ? `${record.verification.documentation.units.commented} of ${record.verification.documentation.units.total} divisions, sections and paragraphs` : "—"}.
            </li>
            <li>
              Card numbers in comments (DOC-004): {Array.isArray(record.verification.documentation.cardNumbers) && record.verification.documentation.cardNumbers.length ? `line ${record.verification.documentation.cardNumbers.join(", ")}` : "none"}; commented-out code (DOC-005):{" "}
              {Array.isArray(record.verification.documentation.commentedOutCode) && record.verification.documentation.commentedOutCode.length ? `line ${record.verification.documentation.commentedOutCode.join(", ")}` : "none"}.
            </li>
            {Array.isArray(record.verification.documentation.restoredByTool) && record.verification.documentation.restoredByTool.length > 0 && (
              <li data-report-restored={record.verification.documentation.restoredByTool.length}>
                Code kept by a tool before the change was shown:{" "}
                {record.verification.documentation.restoredByTool
                  .map((r) =>
                    r.kind === "changed" ? `line ${r.originalLine} put back (NexCODE's copy changed it)` : r.kind === "lost" ? `line ${r.originalLine} put back (NexCODE's copy left it out)` : "a line of code NexCODE's copy added, removed"
                  )
                  .join("; ")}
                .
              </li>
            )}
            <li>Verified by tool in the run of {record.verification.documentation.at || "—"}. Whether each comment agrees with the code (DOC-003) is the reviewer&apos;s to judge.</li>
          </ul>
        </section>
      )}

      {record.verification && record.verification.equivalence && (
        <section className={PANEL} data-report-equivalence={record.verification.equivalence.identical ? "identical" : "differs"}>
          <h3 className={H}>The equivalence (MIG-001)</h3>
          <p className="text-[15px] font-sans text-neutrals-light flex items-start gap-2">
            {record.verification.equivalence.identical ? <RiCheckboxCircleFill size={20} className="text-teal-300 shrink-0 mt-0.5" /> : <RiCloseCircleFill size={20} className="text-red-300 shrink-0 mt-0.5" />}
            <span>
              The new program&apos;s report is <span className={`font-bold ${record.verification.equivalence.identical ? "text-teal-300" : "text-red-300"}`}>{record.verification.equivalence.identical ? "byte-identical to" : "not identical to"}</span> the COBOL program&apos;s on the same fixture: {record.verification.equivalence.comparedWith}.
            </span>
          </p>
          <ul className="mt-2 text-[13px] font-sans text-neutrals-light list-disc pl-6 space-y-0.5">
            <li>Compared by a tool (<code className="font-mono">diff</code>), not a person: verified by tool, in the run of {record.verification.equivalence.at || "—"}.</li>
            <li>The legacy program&apos;s own report {record.verification.equivalence.legacyMatchesExpected ? "matched" : "did not match"} its expected report in that run.</li>
            <li>The port&apos;s characterisation test (TST-010): {record.verification.equivalence.characterisationPassed === null ? "not reached" : record.verification.equivalence.characterisationPassed ? "passed" : "failed"}.</li>
          </ul>
        </section>
      )}

      {record.review && Array.isArray(record.review.findings) && (
        <section className={PANEL} data-report-review={record.review.findings.length}>
          <h3 className={H}>The review</h3>
          <p className="text-[14px] font-sans text-neutrals-light mb-3">
            Outcome: <span className={`font-bold ${record.review.outcome === "Changes requested" ? "text-amber-300" : "text-teal-300"}`}>{record.review.outcome}</span>
            <span className="text-neutrals-medium">
              {" "}· {record.review.findings.filter((f) => f.established === "tool").length} verified by tool, {record.review.findings.filter((f) => f.established !== "tool").length} assessed by the reviewer · {record.review.findings.filter((f) => f.status === "fixed").length} fixed, re-checked by the tool
            </span>
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-[13px] font-sans">
              <thead>
                <tr className="text-left text-neutrals-medium bg-white/5">
                  <th className="px-3 py-1.5 font-semibold">Severity</th>
                  <th className="px-3 py-1.5 font-semibold">Finding</th>
                  <th className="px-3 py-1.5 font-semibold">Where</th>
                  <th className="px-3 py-1.5 font-semibold">Rules</th>
                  <th className="px-3 py-1.5 font-semibold">Established</th>
                  <th className="px-3 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {record.review.findings.map((f) => (
                  <tr key={f.id} className="border-t border-white/5 align-top" data-report-finding={f.id}>
                    <td className="px-3 py-1.5 whitespace-nowrap"><span className={`${CHIP} ${SEVERITY_HUES[f.severity] || MUTED}`}>{f.severity}</span></td>
                    <td className="px-3 py-1.5 text-neutrals-light"><span className="font-mono text-neutrals-medium">{f.id}</span> {f.title}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {typeof onOpenInIde === "function" ? (
                        <button type="button" onClick={() => onOpenInIde({ path: f.path, hunks: [{ newStart: f.line, newLines: 1 }] })} className="inline-flex items-center gap-1 font-mono text-[12px] text-neutrals-light hover:text-white underline cursor-pointer">
                          <RiMapPin2Line size={12} /> {String(f.path).split("/").pop()}:{f.line}
                        </button>
                      ) : (
                        <span className="font-mono text-[12px] text-neutrals-light">{String(f.path).split("/").pop()}:{f.line}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-neutrals-light">{Array.isArray(f.rules) ? f.rules.join(", ") : ""}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap"><span className={`${CHIP} ${f.established === "tool" ? GOOD : "bg-purple-500/10 text-purple-300 border-purple-500/25"}`}>{f.established === "tool" ? "verified by tool" : "assessed"}</span></td>
                    <td className="px-3 py-1.5 whitespace-nowrap"><span className={`${CHIP} ${f.status === "fixed" ? GOOD : WARN}`}>{f.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Array.isArray(record.review.followUps) && record.review.followUps.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {record.review.followUps.map((x, i) => (
                <li key={i} className="text-[13px] font-sans text-amber-200">Follow-up: {x}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={PANEL}>
        <h3 className={H}>What happened</h3>
        <ol className="flex flex-col gap-2">
          {timeline.map((e, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="font-mono text-[12px] text-neutrals-medium w-20 shrink-0 pt-0.5">{clock(e.at)}</span>
              <span className="shrink-0 pt-0.5">
                {e.kind === "test" ? e.ok ? <RiCheckboxCircleFill size={15} className="text-teal-300" /> : <RiCloseCircleFill size={15} className="text-red-300" /> : e.kind === "record" ? <RiFileShield2Line size={15} className="text-purple-300" /> : <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand-vivid mt-1 ml-0.5" />}
              </span>
              <span className="text-[14px] font-sans">
                <span className="font-bold text-white">{e.label}</span> <span className="text-neutrals-light">· {e.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className={PANEL}>
        <h3 className={H}>{answer ? "The rules behind the answer" : "The rules behind the change"}</h3>
        {rules.length === 0 ? (
          <p className="text-[14px] font-sans text-neutrals-medium">No passage was cited.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rules.map((r) => (
              <article key={`${r.marker}-${r.source}-${r.page}`} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3" data-rule={r.marker}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`${CHIP} ${LAYERS[r.layer] ? LAYERS[r.layer].hue : MUTED}`}>{LAYERS[r.layer] ? LAYERS[r.layer].label : r.layer}</span>
                  <span className={`${CHIP} ${MUTED}`}>{r.marker}</span>
                  {Array.isArray(r.tracedFrom) && r.tracedFrom.length > 0 && (
                    <span
                      className={`${CHIP} ${MUTED}`}
                      data-traced={r.tracedFrom.join(",")}
                      title={r.via === "trace" ? "Looked up through the documents' own \"Traces to:\" lines, not searched" : answer ? "Found by the search" : "Found by the search, and on this finding's chain of rules"}
                    >
                      traced from {r.tracedFrom.join(", ")}
                    </span>
                  )}
                  <span className="text-sm font-sans font-semibold text-white">{r.source}</span>
                  <span className="text-[12px] font-mono text-neutrals-medium">{r.page !== null && r.page !== undefined ? `page ${r.page}` : r.sectionPath || ""}</span>
                  {typeof onOpenPassage === "function" && (
                    <button
                      type="button"
                      onClick={() => onOpenPassage(r)}
                      className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/15 bg-white/5 text-[11px] font-sans font-semibold text-neutrals-light hover:border-brand-vivid/50 hover:text-white cursor-pointer"
                      title="Open the document at this page"
                    >
                      <RiExternalLinkLine size={12} /> Open at the page
                    </button>
                  )}
                </div>
                {r.text ? (
                  <blockquote className="mt-2 border-l-2 border-blue-400/50 pl-3 text-[14px] leading-relaxed text-neutrals-light font-sans whitespace-pre-wrap">
                    <RiDoubleQuotesL size={12} className="inline text-blue-300 mr-1 -mt-1" />
                    {String(r.text).replace(/\s+/g, " ").trim().slice(0, 700)}
                  </blockquote>
                ) : (
                  <p className="mt-2 text-[12px] font-sans text-neutrals-medium">{"The passage's text was not kept for this record: open the document at the page."}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {answer ? (
        <section className={PANEL} data-report-no-change="true">
          <h3 className={H}>Code and tests</h3>
          <p className="text-[14px] font-sans text-neutrals-light">This record keeps an answer: the demo changed no code and ran no tests, and the workspace is not part of it.</p>
        </section>
      ) : (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className={PANEL}>
          <h3 className={H}>Tests</h3>
          {tests.length === 0 ? (
            <p className="text-[14px] font-sans text-neutrals-medium">No test run was recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tests.map((t, i) => (
                <li key={i} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`${CHIP} ${t.exitCode === 0 ? GOOD : BAD}`}>{t.exitCode === 0 ? "passed" : "failed"}</span>
                    <span className="text-[14px] font-sans text-white">{t.summary || `exit code ${t.exitCode}`}</span>
                    <span className="text-[12px] font-mono text-neutrals-medium">
                      {clock(t.at)} · {t.command} · exit {t.exitCode} · {duration(t.durationMs)}
                    </span>
                    {t.excerpt && (
                      <button type="button" className="ml-auto text-[11px] font-sans text-neutrals-medium hover:text-white underline cursor-pointer" onClick={() => setOpenOutput(openOutput === i ? null : i)}>
                        {openOutput === i ? "hide the output" : "show the output"}
                      </button>
                    )}
                  </div>
                  {openOutput === i && <pre className="text-[11px] font-mono text-neutrals-light bg-black/50 border border-white/10 rounded-lg p-3 max-h-72 overflow-auto custom-scrollbar whitespace-pre-wrap">{t.excerpt}</pre>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={PANEL}>
          <h3 className={H}>Files changed</h3>
          {files.length === 0 ? (
            <p className="text-[14px] font-sans text-neutrals-medium">No file differs from the seed.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {files.map((f) => (
                <li key={f.path} className="flex items-center gap-2 flex-wrap">
                  <RiCodeSSlashLine size={14} className="text-teal-300 shrink-0" />
                  <span className="text-[13px] font-mono text-white break-all">{f.path.replace(/^nexus-payments\//, "")}</span>
                  <span className={`${CHIP} ${MUTED}`}>{f.status}</span>
                  {Number.isFinite(f.added) && <span className="text-[13px] font-mono text-teal-300">+{f.added}</span>}
                  {Number.isFinite(f.removed) && <span className="text-[13px] font-mono text-red-300">-{f.removed}</span>}
                  <span className="ml-auto flex items-center gap-1.5">
                    {typeof onShowCode === "function" && (
                      <button type="button" onClick={() => onShowCode(f)} className="text-[11px] font-sans text-neutrals-light hover:text-white underline cursor-pointer">
                        view the change
                      </button>
                    )}
                    {typeof onOpenInIde === "function" && f.status !== "deleted" && Array.isArray(f.hunks) && f.hunks.length > 0 && (
                      <button type="button" onClick={() => onOpenInIde(f)} className="inline-flex items-center gap-1 text-[11px] font-sans text-neutrals-light hover:text-white underline cursor-pointer">
                        <RiMapPin2Line size={11} /> open in the IDE
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className={PANEL}>
          <h3 className={H}>Approval and verification</h3>
          <p className="text-[14px] font-sans text-neutrals-light">
            Approval: <span className="font-bold text-white">{record.approval ? record.approval.status : "pending"}</span>
            {record.approval && record.approval.approver
              ? ` (${record.approval.approver})`
              : answer
                ? ": a person reviews the answer and this record before the answer is given."
                : ": a person reviews the change and this record before it is approved."}
          </p>
          <p className="text-[13px] font-sans text-neutrals-medium mt-2">
            {answer
              ? `Every marker the answer cites was checked against the passages given to the model: ${rules.length} passage(s) cited${unverified ? `, ${unverified} marker(s) unverified` : ", none unverified"}.`
              : record.verification && Array.isArray(record.verification.toolVerified) && record.verification.toolVerified.length
                ? `${record.verification.toolVerified.length} finding(s) verified by a tool.`
                : "Every figure above is the system's own record of what ran; tool-verified findings arrive with the scanner."}
          </p>
        </section>
        <section className={PANEL}>
          <h3 className={H}>Platform</h3>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-[13px] font-sans">
            <dt className="text-neutrals-medium">Models</dt>
            <dd className="text-neutrals-light font-mono">{record.platform && Array.isArray(record.platform.models) ? record.platform.models.join(", ") : models.join(", ") || "—"}</dd>
            <dt className="text-neutrals-medium">App version</dt>
            <dd className="text-neutrals-light font-mono">{record.platform && record.platform.appTreeHash ? String(record.platform.appTreeHash).slice(0, 12) : "—"}</dd>
            <dt className="text-neutrals-medium">Endpoints</dt>
            <dd className="text-neutrals-light font-mono">{[...new Set(turns.map((t) => t.endpointHost).filter(Boolean))].join(", ") || "—"}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
