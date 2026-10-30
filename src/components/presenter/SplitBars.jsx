"use client";

/**
 * SplitBars — the "where the tokens went" bars (polish Phase 2, PL-D13 (a) of 2026-10-14), shared by the Stats panel
 * and the evidence record's report. The groups and their shares are the usage module's (src/lib/coding/usage.js); this
 * only draws them. The owner, 2026-10-14, on the report: the legend's labels take the colour of their segment, and each
 * segment shows its value in a tooltip on hover, so a reader can tell the parts apart and read any one of them.
 */
import React from "react";
import { formatInt } from "@/lib/rag/timing";

/** The input groups' colours, in the module's order: your message, rules and documents, code and files, chat history, instructions. */
export const INPUT_HUES = [
  { bg: "bg-brand-vivid", text: "text-brand-vivid" },
  { bg: "bg-blue-400", text: "text-blue-300" },
  { bg: "bg-teal-400", text: "text-teal-300" },
  { bg: "bg-purple-400", text: "text-purple-300" },
  { bg: "bg-neutral-500", text: "text-neutral-300" },
];
/** The output groups' colours: thinking, answer. */
export const OUTPUT_HUES = [
  { bg: "bg-amber-400", text: "text-amber-300" },
  { bg: "bg-brand-contrast", text: "text-brand-contrast" },
];

const valueOf = (g) => `${g.label}: ${formatInt(g.tokens)} tokens (${g.share}%)`;

/**
 * One bar with its legend. `groups` is `[{ id, label, tokens, share }]` from the module; `hues` pairs a segment colour
 * with its text colour. `compact` draws the title, the bar and the legend on one line (the report); otherwise stacked
 * (the Stats panel).
 */
export function SplitBar({ title, groups, hues, compact = false }) {
  const list = Array.isArray(groups) ? groups : [];
  const hue = (i) => hues[i % hues.length];
  const legend = (
    <div className={`flex flex-wrap gap-x-3 gap-y-0.5 ${compact ? "text-[11px]" : "text-[9px]"} font-mono`} data-split-legend>
      {list.map((g, i) => (
        <span key={g.id} className={`flex items-center gap-1 ${hue(i).text}`} title={valueOf(g)}>
          <span className={`w-1.5 h-1.5 rounded-full ${hue(i).bg}`} />
          {g.label}: {formatInt(g.tokens)} ({g.share}%)
        </span>
      ))}
    </div>
  );
  const bar = (
    <div className={`${compact ? "flex-1 min-w-[160px]" : "w-full"} bg-white/5 h-2 rounded-full flex`} role="img" aria-label={list.map(valueOf).join("; ")}>
      {list.map((g, i) => (
        <div
          key={g.id}
          className={`${hue(i).bg} h-full relative group transition-all duration-500 ${i === 0 ? "rounded-l-full" : ""} ${i === list.length - 1 ? "rounded-r-full" : ""}`}
          style={{ width: `${g.share}%` }}
          data-split-segment={g.id}
        >
          {/* The value, shown while the pointer is over the segment (the owner, 2026-10-14). */}
          <span
            role="tooltip"
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 whitespace-nowrap rounded-md border border-white/15 bg-[#161616] px-2 py-1 text-[10px] font-mono text-white opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-lg"
          >
            <span className={hue(i).text}>{g.label}</span>: {formatInt(g.tokens)} tokens ({g.share}%)
          </span>
        </div>
      ))}
    </div>
  );
  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-wrap" data-split-bar={title}>
        {title ? <span className="w-14 shrink-0 text-[12px] font-sans text-neutrals-medium">{title}</span> : null}
        {bar}
        {legend}
      </div>
    );
  }
  return (
    <div className="space-y-1.5" data-split-bar={title}>
      {title ? <div className="text-[10px] font-sans text-neutrals-light">{title}</div> : null}
      {bar}
      {legend}
    </div>
  );
}

export default SplitBar;
