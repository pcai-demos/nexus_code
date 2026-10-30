"use client";

/**
 * CodingLiveTurn — what a streaming code turn shows while it runs, and the coding path's chips on the finished message
 * (Machinery PR 1, design §4; decisions D6, D7).
 *
 * The live bubble replaces the timer-driven progress bar for code turns: the four layers of rules as each search
 * returns (passages found, or "not in store"), the model's reasoning as a running character count, then the answer as
 * it arrives. The chips on the finished message say how the turn ran: thinking on or off, each layer's passage count,
 * any marker in the answer that matches no passage given to the model, and the scenario step. Every value is read from
 * the turn's own events and `coding` report; nothing is computed from a clock here.
 *
 * Presenter flow (2026-10-07: the chat explains, the IDE carries the code): the live bubble shows the answer without its
 * code (a block being written reads "Writing <file> for the IDE"); the chips list the change's proposed files and the
 * answer's code locations as buttons that open them in the IDE (src/lib/coding/ide_client.js, on a click only).
 *
 * S2 (the pull request review, 2026-10-09): a review turn's findings show as a table under the answer: severity, the
 * finding, where (a button that selects the line in the IDE), its rules, and how it was established (verified by tool
 * or assessed by the reviewer, REV-004), with the outcome above it (REV-007). The same findings are review comments on
 * their lines in the IDE.
 */
import React, { useState } from "react";
import { RiLoader4Line, RiFileSearchLine, RiCodeSSlashLine, RiMapPin2Line, RiFileChartLine } from "@remixicon/react";
import { streamingChatText } from "@/lib/coding/chat_text";
import { revealInIde, showProposalInIde } from "@/lib/coding/ide_client";
// Presenter panels (design §6, 2026-10-07): the cited-passages button reaches the Demo panel through the context.
import { usePresenter } from "@/context/PresenterContext";

const CHIP = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border";
const LAYER_HUES = {
  regulator: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  corporate: "bg-purple-500/10 text-purple-300 border-purple-500/20",
  sdlc: "bg-teal-500/10 text-teal-300 border-teal-500/20",
  team: "bg-amber-500/10 text-amber-300 border-amber-500/20",
};
const MUTED = "bg-white/5 text-neutrals-medium border-white/10";
const AMBER = "bg-amber-500/15 text-amber-400 border-amber-500/20";
const PHASES = {
  starting: "Starting",
  searching: "Searching the four layers of rules",
  thinking: "Thinking",
  answering: "Writing the answer",
  done: "Finishing",
  failed: "The turn failed",
};
const withCommas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const baseName = (p) => String(p || "").split("/").pop();
const MODE_LABELS = { explain: "diagnosis", change: "change", review: "review", migrate: "migration", audit: "audit" };
const SEVERITY_HUES = {
  Critical: "bg-red-500/15 text-red-300 border-red-500/30",
  High: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Medium: "bg-yellow-500/10 text-yellow-200 border-yellow-500/20",
  Low: "bg-white/5 text-neutrals-light border-white/15",
};

function layerText(l) {
  if (!l) return "";
  if (l.state === "searching") return "searching…";
  if (l.state === "absent") return "not in store";
  if (l.state === "failed") return "search failed";
  return `${l.passages} passage${l.passages === 1 ? "" : "s"}`;
}

/** S2: a review's findings as a table, each location a button that selects the line in the IDE. */
function ReviewFindings({ review, onLocate }) {
  const findings = review && Array.isArray(review.findings) ? review.findings : [];
  if (findings.length === 0) return null;
  const tool = findings.filter((f) => f.established === "tool").length;
  return (
    <div className="flex flex-col gap-1.5 mt-1" data-review-findings={findings.length}>
      <div className="text-[11px] font-sans text-neutrals-light">
        Outcome: <span className={`font-semibold ${review.outcome === "Changes requested" ? "text-amber-300" : "text-teal-300"}`}>{review.outcome}</span>
        <span className="text-neutrals-medium"> · {tool} verified by tool · {findings.length - tool} assessed by the reviewer</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-[11px] font-sans">
          <thead>
            <tr className="text-left text-neutrals-medium bg-white/5">
              <th className="px-2 py-1 font-semibold">Severity</th>
              <th className="px-2 py-1 font-semibold">Finding</th>
              <th className="px-2 py-1 font-semibold">Where</th>
              <th className="px-2 py-1 font-semibold">Rules</th>
              <th className="px-2 py-1 font-semibold">Established</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} className="border-t border-white/5 align-top" data-finding={f.id}>
                <td className="px-2 py-1 whitespace-nowrap">
                  <span className={`${CHIP} ${SEVERITY_HUES[f.severity] || MUTED}`}>{f.severity}</span>
                </td>
                <td className="px-2 py-1 text-neutrals-light">
                  <span className="font-mono text-neutrals-medium">{f.id}</span> {f.title}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    type="button"
                    className={`${CHIP} bg-white/5 text-neutrals-light border-white/15 cursor-pointer hover:border-brand-vivid/50 hover:text-white transition-all`}
                    title={`Select ${f.path} line ${f.line} in the IDE`}
                    onClick={() => onLocate(f)}
                  >
                    <RiMapPin2Line size={10} aria-hidden="true" /> {baseName(f.path)}:{f.line}
                  </button>
                </td>
                <td className="px-2 py-1 font-mono text-[10px] text-neutrals-light">{Array.isArray(f.rules) ? f.rules.join(", ") : ""}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <span className={`${CHIP} ${f.established === "tool" ? "bg-teal-500/10 text-teal-300 border-teal-500/20" : "bg-purple-500/10 text-purple-300 border-purple-500/20"}`}>
                    {f.established === "tool" ? "verified by tool" : "assessed"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The chips on a finished code turn's message. */
export function CodingTurnChips({ coding }) {
  const presenter = usePresenter();
  const [ideNote, setIdeNote] = useState(null);
  if (!coding || typeof coding !== "object") return null;
  // PR B (D2): the record line in the chat carries a chip that opens the Results panel at that record.
  if (coding.kind === "record") {
    return (
      <div className="flex flex-wrap items-center gap-1.5 mt-2" data-coding-chips="record">
        <button
          type="button"
          className={`${CHIP} bg-teal-500/10 text-teal-200 border-teal-500/25 cursor-pointer hover:border-teal-400/60 hover:text-white transition-all`}
          title="Open the Results panel at this evidence record"
          onClick={() => presenter.openResults({ recordId: coding.recordId || null, scenarioId: coding.scenarioId || null })}
          data-show-results={coding.recordId || ""}
        >
          <RiFileChartLine size={10} aria-hidden="true" /> Show the results
        </button>
      </div>
    );
  }
  const citedPassages = Array.isArray(coding.citedPassages) ? coding.citedPassages : [];
  const proposals = Array.isArray(coding.proposals) ? coding.proposals : [];
  const locations = Array.isArray(coding.locations) ? coding.locations : [];
  const openProposal = async (p) => {
    setIdeNote({ tone: "muted", text: `opening ${baseName(p.path)} in the IDE…` });
    const r = await showProposalInIde({ turnId: coding.turnId, path: p.path });
    setIdeNote(r && r.success ? { tone: "good", text: `${baseName(p.path)}: the proposed change is open in the IDE` } : { tone: "bad", text: `${baseName(p.path)}: ${(r && r.error) || "the IDE did not open it"}` });
  };
  const openLocation = async (l) => {
    setIdeNote({ tone: "muted", text: `opening ${l.label} in the IDE…` });
    const r = await revealInIde(l);
    setIdeNote(r && r.success ? { tone: "good", text: `${l.label} is selected in the IDE` } : { tone: "bad", text: `${l.label}: ${(r && r.error) || "the IDE did not open it"}` });
  };
  const layers = Array.isArray(coding.layers) ? coding.layers : [];
  const thinking = coding.thinking || {};
  const unverified = Array.isArray(coding.unverifiedMarkers) ? coding.unverifiedMarkers : [];
  return (
    <div className="flex flex-col gap-1.5 mt-2" data-coding-chips="true">
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`${CHIP} ${thinking.mode === "off" ? MUTED : "bg-brand-vivid/15 text-brand-vivid border-brand-vivid/20"}`}
        title={thinking.note || `thinking ${thinking.mode} (${thinking.form} request)`}
      >
        thinking {thinking.mode || "on"}
      </span>
      {layers.map((l) => (
        <span
          key={l.id}
          className={`${CHIP} ${l.state === "absent" ? MUTED : l.state === "failed" || l.state === "degraded" ? AMBER : LAYER_HUES[l.id] || MUTED}`}
          title={`${l.label}: ${l.documents} of ${l.expected} document(s) in the store; ${l.state}${l.code ? ` (${l.code})` : ""}${l.search ? `; searched for: ${l.search}` : ""}`}
        >
          {l.marker} · {layerText(l)}
        </span>
      ))}
      {unverified.length > 0 && (
        <span className={`${CHIP} ${AMBER}`} title="Markers in the answer that match no passage the model was given: treat those statements as unverified.">
          {unverified.length} unverified marker{unverified.length === 1 ? "" : "s"}: {unverified.join(", ")}
        </span>
      )}
      {coding.scenario && (
        <span className={`${CHIP} ${MUTED}`} title={coding.scenario.title || ""}>
          {String(coding.scenario.id).toUpperCase()}
          {coding.scenario.stepId ? ` · ${coding.scenario.stepId}` : ""}
        </span>
      )}
      {citedPassages.length > 0 && (
        <button
          type="button"
          className={`${CHIP} bg-blue-500/10 text-blue-300 border-blue-500/20 cursor-pointer hover:border-blue-400/60 hover:text-white transition-all`}
          title="Open the Demo panel's viewer at the passages this answer cited"
          onClick={() => presenter.openPassages({ passages: citedPassages, scenario: coding.scenario || null })}
          data-cited-passages={citedPassages.length}
        >
          <RiFileSearchLine size={10} aria-hidden="true" /> {citedPassages.length} cited passage{citedPassages.length === 1 ? "" : "s"}
        </button>
      )}
      {coding.mode && (
        <span className={`${CHIP} ${MUTED}`} title={coding.mode === "explain" ? "This step explains: it proposes no code" : coding.mode === "review" ? "This step reviews a pull request: findings in the chat and the IDE, no code" : "This step proposes a change, shown in the IDE"}>
          {coding.repair ? "repair" : MODE_LABELS[coding.mode] || coding.mode}
        </span>
      )}
    </div>
    {proposals.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5" data-proposals={proposals.length}>
        <span className="text-[10px] font-mono uppercase tracking-wider text-neutrals-medium">Proposed change{proposals.length === 1 ? "" : "s"}, shown in the IDE:</span>
        {proposals.map((p) => (
          <button
            key={p.path}
            type="button"
            className={`${CHIP} bg-teal-500/10 text-teal-200 border-teal-500/25 cursor-pointer hover:border-teal-400/60 hover:text-white transition-all`}
            title={`Show the proposed change to ${p.path} in the IDE`}
            onClick={() => openProposal(p)}
          >
            <RiCodeSSlashLine size={10} aria-hidden="true" /> {baseName(p.path)}
            {p.isNew ? " (new)" : ""}
            {Number.isFinite(p.added) && Number.isFinite(p.removed) && (
              <>
                {" "}
                <span className="text-teal-300">+{p.added}</span> <span className="text-red-300">-{p.removed}</span>
              </>
            )}
          </button>
        ))}
      </div>
    )}
    {coding.review && (
      <ReviewFindings
        review={coding.review}
        onLocate={(f) => openLocation({ path: f.path, startLine: f.line, endLine: f.line, label: `${baseName(f.path)}:${f.line}` })}
      />
    )}
    {locations.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5" data-locations={locations.length}>
        <span className="text-[10px] font-mono uppercase tracking-wider text-neutrals-medium">Code locations:</span>
        {locations.map((l) => (
          <button
            key={`${l.path}:${l.startLine}-${l.endLine}`}
            type="button"
            className={`${CHIP} bg-white/5 text-neutrals-light border-white/15 cursor-pointer hover:border-brand-vivid/50 hover:text-white transition-all`}
            title={`Select ${l.path} lines ${l.startLine} to ${l.endLine} in the IDE`}
            onClick={() => openLocation(l)}
          >
            <RiMapPin2Line size={10} aria-hidden="true" /> {l.label}
          </button>
        ))}
      </div>
    )}
    {ideNote && <span className={`${CHIP} self-start ${ideNote.tone === "good" ? "bg-teal-500/10 text-teal-300 border-teal-500/20" : ideNote.tone === "bad" ? AMBER : MUTED}`}>{ideNote.text}</span>}
    </div>
  );
}

/** The live bubble of a streaming code turn. */
export default function CodingLiveTurn({ liveTurn }) {
  if (!liveTurn) return null;
  const order = Array.isArray(liveTurn.order) ? liveTurn.order : [];
  return (
    <div className="flex flex-col gap-2 w-full max-w-[85%] bg-white/2 border border-white/5 rounded-2xl p-4 rounded-bl-none" data-coding-live="true">
      <div className="flex items-center gap-2.5 text-sm text-brand-vivid font-bold tracking-wider">
        <RiLoader4Line size={14} className="animate-spin" />
        <span>{PHASES[liveTurn.phase] || "Working"}…</span>
        {liveTurn.thinking && <span className={`${CHIP} ${MUTED}`}>thinking {liveTurn.thinking}</span>}
        {liveTurn.model && <span className={`${CHIP} ${MUTED}`}>{liveTurn.model}</span>}
      </div>
      {order.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {order.map((id) => {
            const l = liveTurn.layers[id];
            return (
              <span key={id} className={`${CHIP} ${l && l.state === "absent" ? MUTED : LAYER_HUES[id] || MUTED}`} title={l ? l.label : id}>
                {l ? l.marker : id} · {layerText(l)}
              </span>
            );
          })}
        </div>
      )}
      {liveTurn.scan && (
        <div className="text-[11px] font-mono text-neutrals-light" data-live-scan={liveTurn.scan.findings}>
          pre-merge checks · {liveTurn.scan.findings} finding{liveTurn.scan.findings === 1 ? "" : "s"} verified by tool{liveTurn.scan.critical ? ` · ${liveTurn.scan.critical} Critical` : ""}
        </div>
      )}
      {liveTurn.layouts && (
        <div className="text-[11px] font-mono text-neutrals-light" data-live-layouts={liveTurn.layouts.records}>
          {liveTurn.layouts.error
            ? `record layouts · not computed: ${liveTurn.layouts.error}`
            : `record layouts · ${liveTurn.layouts.records} record${liveTurn.layouts.records === 1 ? "" : "s"}, ${liveTurn.layouts.fields} fields, computed by a tool`}
        </div>
      )}
      {liveTurn.chain && (
        <div className="text-[11px] font-mono text-neutrals-light" data-live-chain={liveTurn.chain.traced}>
          rule chains · {liveTurn.chain.traced} passage{liveTurn.chain.traced === 1 ? "" : "s"} traced from {liveTurn.chain.rules} rule{liveTurn.chain.rules === 1 ? "" : "s"}
          {liveTurn.chain.missing ? ` · ${liveTurn.chain.missing} rule${liveTurn.chain.missing === 1 ? "" : "s"} not in the documents` : ""}
        </div>
      )}
      {liveTurn.regtrace && liveTurn.regtrace.looked > 0 && (
        <div className="text-[11px] font-mono text-neutrals-light" data-live-regtrace={liveTurn.regtrace.found}>
          regulations · {liveTurn.regtrace.found} provision{liveTurn.regtrace.found === 1 ? "" : "s"} traced through the rules&apos; trace lines
          {liveTurn.regtrace.missing ? ` · ${liveTurn.regtrace.missing} not found in the documents` : ""}
        </div>
      )}
      {liveTurn.reasoningChars > 0 && (
        <div className="text-[11px] font-mono text-neutrals-medium">reasoning · {withCommas(liveTurn.reasoningChars)} characters</div>
      )}
      {liveTurn.text && <div className="text-sm text-neutrals-light whitespace-pre-wrap font-sans max-h-96 overflow-auto custom-scrollbar">{streamingChatText(liveTurn.text, { mode: liveTurn.mode || "change" })}</div>}
    </div>
  );
}
