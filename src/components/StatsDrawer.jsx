"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  RiCloseLine,
  RiCoinFill,
  RiCpuLine,
  RiTimeLine,
  RiFlashlightLine,
  RiLoader4Line,
  RiRefreshLine
} from "@remixicon/react";
import { formatSeconds, formatInt } from "@/lib/rag/timing";
import { SplitBar, INPUT_HUES, OUTPUT_HUES } from "@/components/presenter/SplitBars";
import { formatMoney } from "@/lib/coding/pricing";

// T43 (design D5 a; F-180): every figure here is the session's real aggregate,
// summed by the pure module (`aggregateSessionTiming`, U-TIMING pins it) from
// each turn's `timing` in page.js — the last turn's wall and model time, the
// mean model time over the turns that had a model, the prompt / completion
// split as the provider reported it (labelled "estimated" when any turn's
// usage was our own estimate), and the model pair the router served. Before
// T43 this drawer printed "Average Compute Time: 194 ms" (a string literal),
// a 75 / 25 token split by assumption over the cumulative total, a "LiteLLM
// Proxy Rates" cost note and a "NGI LiteLLM Proxy Core • Qwen 2.5 Coder
// Engine" footer — a proxy and a model not in the path. T13's rule (measured
// or absent, never invented) applies here now. The cost field is the
// orchestrator's literal 0.0: it is not metered on this deployment, and the
// card says so.
//
// Polish Phase 2 (the owner's PL-D7 to PL-D9 and PL-D13 of 2026-10-14): the token figures that matter come from the
// run log through the route's `usage` action (src/lib/coding/usage.js): everything since the last environment reset
// (a reload or a roll loses nothing; Clear the chat leaves it), the active demo's tokens per step with its total, the
// session's demos and free-form answers, and the coding turns' tokens apportioned by character share. Every number is
// the module's; this drawer only prints them. The page's own timings stay for the response times.
// Polish Phase 3 (PL-D10 to PL-D12 (a)): the cost at the prices in the Admin Panel's Misc tab (pricing.js, through the
// route), per step, per demo and per session, "no price set" when a model has no row and no default; the panel is
// wider and the session's demos are a table (the owner, 2026-10-14: the list was hard to read).
const EMPTY_SESSION = {
  turns: 0,
  timed: 0,
  tokenTurns: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  promptShare: 0,
  completionShare: 0,
  estimatedTurns: 0,
  allProviderReported: false,
  totalWallMs: 0,
  lastWallMs: null,
  lastModelMs: null,
  modelTurns: 0,
  meanModelMs: null,
  model: null,
};
const API = "/api/ide-bridge/scenarios";
const CARD = "bg-white/2 border border-white/5 rounded-xl p-4";
const LABEL = "text-[9px] uppercase font-bold tracking-wider text-neutrals-medium block border-b border-white/5 pb-2";

/** A sum's note: how many answers were counted, estimated by the app, or carried no figure. */
function countNote(sum) {
  if (!sum) return "";
  const parts = [`${sum.answers} answer${sum.answers === 1 ? "" : "s"}`];
  if (sum.estimated > 0) parts.push(`${sum.estimated} estimated`);
  if (sum.uncounted > 0) parts.push(`${sum.uncounted} with no figure`);
  return parts.join(", ");
}

export default function StatsDrawer({ isOpen, onClose, cumulativeCost = 0, session = null, servedModel = null, activeDemoId = null, refreshKey = 0 }) {
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState(null);
  const [loading, setLoading] = useState(false);

  // The run log's figures, read when the drawer opens and again after each answer (the page's refreshKey).
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "usage", scenarioId: activeDemoId || undefined }) });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json || !json.session) throw new Error((json && json.error) || `the route answered HTTP ${res.status}`);
        setUsage(json);
        setUsageError(null);
      } catch (err) {
        if (!cancelled) setUsageError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeDemoId, refreshKey]);

  if (!isOpen) return null;

  const s = session && typeof session === "object" ? { ...EMPTY_SESSION, ...session } : EMPTY_SESSION;
  const estimatedNote = s.estimatedTurns > 0 ? ` (estimated on ${s.estimatedTurns} of ${s.tokenTurns})` : "";
  const servedLine =
    servedModel && servedModel.model
      ? `${servedModel.model} @ ${servedModel.origin || servedModel.endpointType || "endpoint"}${servedModel.profile ? ` · ${servedModel.profile} profile` : ""}`
      : "no turn served yet";
  const ses = usage && usage.session ? usage.session : null;
  const demo = usage && usage.demo ? usage.demo : null;
  const split = demo && demo.split && demo.split.answers > 0 ? demo.split : ses && ses.split && ses.split.answers > 0 ? ses.split : null;
  const splitScope = demo && demo.split && demo.split.answers > 0 ? `this demo's ${demo.split.answers} coding answer${demo.split.answers === 1 ? "" : "s"}` : split ? `the session's ${split.answers} coding answer${split.answers === 1 ? "" : "s"}` : "";

  return (
    <>
      {/* Backdrop overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: "100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-3xl bg-black border-l border-white/15 p-6 flex flex-col justify-between shadow-2xl h-screen overflow-hidden text-white"
        style={{
          background: "rgba(10, 10, 10, 0.95)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
        }}
      >
      <div className="flex flex-col h-full justify-between min-h-0">
        <div className="min-h-0 overflow-auto custom-scrollbar pr-1">
          {/* Header */}
          <div className="flex justify-between items-center border-b border-white/10 pb-3 mb-6">
            <div className="flex items-center gap-2">
              <RiCoinFill size={18} className="text-neutrals-medium" />
              <h3 className="text-xs uppercase font-bold tracking-widest text-white font-sans">AI Consumption & Telemetry</h3>
              {loading && <RiLoader4Line size={14} className="animate-spin text-brand-vivid" />}
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neutrals-medium hover:text-white cursor-pointer"
            >
              <RiCloseLine size={16} />
            </button>
          </div>

          <p className="text-[11px] text-neutrals-light mb-6 leading-relaxed">
            Tokens as the model server reported them for every answer, read from the run log since the last environment reset{usage && usage.since ? ` (${usage.since.slice(0, 16).replace("T", " ")} UTC)` : ""}; nothing here is estimated to fill a gap, and an estimate is marked as one. Response times are this page&apos;s own turns: {s.timed} of {s.turns} timed.
          </p>

          <div className="space-y-6">
            {/* Top Grid Counters */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/2 border border-white/5 p-4 rounded-xl flex flex-col justify-center transition-all duration-300 hover:bg-white/4" data-stats-session-cost={ses && ses.cost && ses.cost.amount !== null ? ses.cost.amount : ""}>
                <span className="text-[9px] uppercase tracking-wider text-neutrals-medium mb-1 flex items-center gap-1">
                  <RiCoinFill size={11} className="text-neutrals-medium" />
                  Session Cost
                </span>
                <span className="text-xl font-mono text-white">{ses && ses.cost ? formatMoney(ses.cost.amount, ses.cost.currency) : "—"}</span>
                <span className="text-[8px] text-neutrals-medium mt-1 font-mono">
                  {ses && ses.cost ? (ses.cost.amount === null ? `no price set for ${ses.cost.unpriced.join(", ")}: Admin Panel › Misc` : `at the prices in Admin Panel › Misc (source: ${ses.cost.source})`) : "read from the run log"}
                </span>
              </div>

              <div className="bg-white/2 border border-white/5 p-4 rounded-xl flex flex-col justify-center transition-all duration-300 hover:bg-white/4" data-stats-session-total={ses ? ses.total : ""}>
                <span className="text-[9px] uppercase tracking-wider text-neutrals-medium mb-1 flex items-center gap-1">
                  <RiCpuLine size={11} className="text-neutrals-medium" />
                  Session Tokens
                </span>
                <span className="text-xl font-mono text-white">{ses ? formatInt(ses.total) : formatInt(s.totalTokens)} <span className="text-xs text-neutrals-medium">tokens</span></span>
                <span className="text-[8px] text-brand-vivid mt-1 font-mono">
                  {ses ? `${formatInt(ses.prompt)} in · ${formatInt(ses.completion)} out · ${countNote(ses)}` : `${s.tokenTurns} of ${s.turns} turn(s)${estimatedNote}`}
                </span>
              </div>
            </div>

            {usageError && (
              <div className="text-[11px] font-mono text-red-300 flex items-center gap-2">
                <RiRefreshLine size={12} /> The run log could not be read: {usageError}
              </div>
            )}

            {/* The active demo: tokens per step, from the run log */}
            {demo && (
              <div className={`${CARD} space-y-3`} data-stats-demo={demo.id}>
                <span className={LABEL}>This demo · {String(demo.id).toUpperCase()} · {demo.title}</span>
                {demo.steps.length === 0 && demo.freeForm.answers === 0 ? (
                  <div className="text-[11px] text-neutrals-medium">No answer yet since the demo was selected.</div>
                ) : (
                  <table className="w-full text-[11px] font-mono">
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
                      {demo.steps.map((st) => (
                        <tr key={st.id} className="text-neutrals-light" data-stats-step={st.id}>
                          <td className="py-0.5 pr-2 font-sans truncate max-w-[200px]" title={st.title}>
                            {st.title}
                            {st.repairs > 0 ? <span className="text-neutrals-medium"> (+{st.repairs} repair{st.repairs === 1 ? "" : "s"})</span> : null}
                            {st.estimated > 0 ? <span className="text-amber-300"> est.</span> : null}
                          </td>
                          <td className="text-right py-0.5">{st.answers}</td>
                          <td className="text-right py-0.5">{formatInt(st.prompt)}</td>
                          <td className="text-right py-0.5">{formatInt(st.completion)}</td>
                          <td className="text-right py-0.5 text-white">{formatInt(st.total)}</td>
                          <td className="text-right py-0.5 text-neutrals-light">{st.cost ? formatMoney(st.cost.amount, st.cost.currency) : "—"}</td>
                        </tr>
                      ))}
                      {demo.freeForm.answers > 0 && (
                        <tr className="text-neutrals-light" data-stats-step="free-form">
                          <td className="py-0.5 pr-2 font-sans">Free-form, in this demo</td>
                          <td className="text-right py-0.5">{demo.freeForm.answers}</td>
                          <td className="text-right py-0.5">{formatInt(demo.freeForm.prompt)}</td>
                          <td className="text-right py-0.5">{formatInt(demo.freeForm.completion)}</td>
                          <td className="text-right py-0.5 text-white">{formatInt(demo.freeForm.total)}</td>
                          <td className="text-right py-0.5 text-neutrals-light">{demo.freeForm.cost ? formatMoney(demo.freeForm.cost.amount, demo.freeForm.cost.currency) : "—"}</td>
                        </tr>
                      )}
                      <tr className="text-white border-t border-white/10" data-stats-demo-total={demo.totals.total}>
                        <td className="py-1 pr-2 font-sans font-bold">Demo total</td>
                        <td className="text-right py-1">{demo.totals.answers}</td>
                        <td className="text-right py-1">{formatInt(demo.totals.prompt)}</td>
                        <td className="text-right py-1">{formatInt(demo.totals.completion)}</td>
                        <td className="text-right py-1 font-bold">{formatInt(demo.totals.total)}</td>
                        <td className="text-right py-1 font-bold">{demo.totals.cost ? formatMoney(demo.totals.cost.amount, demo.totals.cost.currency) : "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {demo.totals.estimated > 0 || demo.totals.uncounted > 0 ? <div className="text-[9px] font-mono text-amber-300">{countNote(demo.totals)}</div> : null}
              </div>
            )}

            {/* The session: its demos and free-form answers, as a table (the owner, 2026-10-14) */}
            {ses && (ses.demos.length > 0 || ses.freeForm.answers > 0) && (
              <div className={`${CARD} space-y-3`} data-stats-session-demos={ses.demos.length}>
                <span className={LABEL}>Session since the last environment reset</span>
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-neutrals-medium text-[9px] uppercase tracking-wider">
                      <th className="text-left font-normal pb-1">Demo</th>
                      <th className="text-right font-normal pb-1">Answers</th>
                      <th className="text-right font-normal pb-1">In</th>
                      <th className="text-right font-normal pb-1">Out</th>
                      <th className="text-right font-normal pb-1">Total</th>
                      <th className="text-right font-normal pb-1">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ses.demos.map((d) => (
                      <tr key={d.id} className="text-neutrals-light" data-stats-session-demo={d.id}>
                        <td className="py-0.5 pr-2 font-sans truncate max-w-[280px]" title={d.title}>
                          <span className="font-bold text-white">{String(d.id).toUpperCase()}</span> · {d.title}
                        </td>
                        <td className="text-right py-0.5">{d.answers}</td>
                        <td className="text-right py-0.5">{formatInt(d.prompt)}</td>
                        <td className="text-right py-0.5">{formatInt(d.completion)}</td>
                        <td className="text-right py-0.5 text-white">{formatInt(d.total)}</td>
                        <td className="text-right py-0.5">{d.cost ? formatMoney(d.cost.amount, d.cost.currency) : "—"}</td>
                      </tr>
                    ))}
                    {ses.freeForm.answers > 0 && (
                      <tr className="text-neutrals-light" data-stats-session-demo="free-form">
                        <td className="py-0.5 pr-2 font-sans">Free-form, no demo</td>
                        <td className="text-right py-0.5">{ses.freeForm.answers}</td>
                        <td className="text-right py-0.5">{formatInt(ses.freeForm.prompt)}</td>
                        <td className="text-right py-0.5">{formatInt(ses.freeForm.completion)}</td>
                        <td className="text-right py-0.5 text-white">{formatInt(ses.freeForm.total)}</td>
                        <td className="text-right py-0.5">{ses.freeForm.cost ? formatMoney(ses.freeForm.cost.amount, ses.freeForm.cost.currency) : "—"}</td>
                      </tr>
                    )}
                    <tr className="text-white border-t border-white/10" data-stats-session-total-row={ses.total}>
                      <td className="py-1 pr-2 font-sans font-bold">Session total</td>
                      <td className="text-right py-1">{ses.answers}</td>
                      <td className="text-right py-1">{formatInt(ses.prompt)}</td>
                      <td className="text-right py-1">{formatInt(ses.completion)}</td>
                      <td className="text-right py-1 font-bold">{formatInt(ses.total)}</td>
                      <td className="text-right py-1 font-bold">{ses.cost ? formatMoney(ses.cost.amount, ses.cost.currency) : "—"}</td>
                    </tr>
                  </tbody>
                </table>
                {ses.cost && ses.cost.amount === null ? <div className="text-[9px] font-mono text-amber-300">No price set for {ses.cost.unpriced.join(", ")}: Admin Panel › Misc.</div> : null}
              </div>
            )}

            {/* PL-D13 (a): where the tokens went, apportioned by character share over the coding turns */}
            {split && (
              <div className={`${CARD} space-y-4`} data-stats-split={split.answers}>
                <span className={LABEL}>Where the tokens went · {splitScope} · apportioned by {split.basis}</span>
                <SplitBar title="Input: what the prompt was made of" groups={split.input} hues={INPUT_HUES} />
                <SplitBar title="Output: thinking against the answer" groups={split.output} hues={OUTPUT_HUES} />
                <div className="text-[9px] font-mono text-neutrals-medium">The server counts one figure per answer; the app splits it by the size of each part it composed. An apportionment, not a count.</div>
              </div>
            )}

            {/* Latency — the last turn and the session's mean, from `timing` */}
            <div className="bg-white/2 border border-white/5 rounded-xl p-4 space-y-4">
              <span className="text-[9px] uppercase font-bold tracking-wider text-neutrals-medium block border-b border-white/5 pb-2">Response Time (server clock)</span>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <RiTimeLine size={14} className="text-brand-vivid" />
                  <span>Last turn:</span>
                </div>
                <span className="font-mono text-xs text-white">
                  {s.lastWallMs !== null ? `${formatSeconds(s.lastWallMs)} (model ${s.lastModelMs !== null ? formatSeconds(s.lastModelMs) : "—"})` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <RiFlashlightLine size={14} className="text-emerald-400" />
                  <span>Average model time:</span>
                </div>
                <span className="font-mono text-xs text-white">
                  {s.meanModelMs !== null ? `${formatSeconds(s.meanModelMs)} over ${s.modelTurns} turn(s)` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <RiTimeLine size={14} className="text-neutrals-medium" />
                  <span>This page&apos;s turns:</span>
                </div>
                <span className="font-mono text-xs text-white">{s.timed > 0 ? `${formatSeconds(s.totalWallMs)} over ${s.timed} turn(s)` : "—"}</span>
              </div>
            </div>

            {/* This page's token split — as the provider reported it */}
            <div className="bg-white/2 border border-white/5 rounded-xl p-4 space-y-3">
              <span className="text-[9px] uppercase font-bold tracking-wider text-neutrals-medium block">This page&apos;s Prompt / Completion Tokens{s.estimatedTurns > 0 ? " (estimated)" : ""}</span>
              <div className="space-y-2">
                <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden flex">
                  <div
                    className="bg-brand-vivid h-full transition-all duration-500"
                    style={{ width: `${s.promptShare}%` }}
                  />
                  <div
                    className="bg-brand-contrast h-full transition-all duration-500"
                    style={{ width: `${s.completionShare}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] font-mono text-neutrals-medium">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-vivid" />
                    <span>Prompt: {formatInt(s.promptTokens)} ({s.promptShare}%)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-contrast" />
                    <span>Completion: {formatInt(s.completionTokens)} ({s.completionShare}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-[9px] text-neutrals-medium font-mono text-center pt-4 border-t border-white/5" title="the model pair the router reported on the last turn">
          {servedLine}
        </div>
      </div>
    </motion.div>
    </>
  );
}
