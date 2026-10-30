"use client";

/**
 * FlowDiagram — the demo's flow as an inline SVG drawn from `flowLayout(scenario)` (presenter panels design §2,
 * 2026-10-07): the ticket, each step, Apply and Run tests where a step asks for them, the record; the four layers of
 * rules shown feeding every prompt step. Nothing is hand-drawn, so a changed step cannot leave the picture stale.
 */
import React from "react";

const W = 164;
const H = 56;
const GAP = 36;
const PAD = 16;
const TOP = 24;
const BAND_Y = 124;
const BAND_H = 34;
const STYLE = {
  ticket: { fill: "rgba(255,255,255,0.04)", stroke: "#8C8C8C", text: "#FFFFFF" },
  prompt: { fill: "rgba(242,86,29,0.12)", stroke: "#F2561D", text: "#FFFFFF" },
  apply: { fill: "rgba(20,184,166,0.10)", stroke: "#14B8A6", text: "#FFFFFF" },
  tests: { fill: "rgba(20,184,166,0.10)", stroke: "#14B8A6", text: "#FFFFFF" },
  record: { fill: "rgba(168,85,247,0.12)", stroke: "#A855F7", text: "#FFFFFF" },
  // S4: the latest record shown to the room, and the document chat asked for contrast (not fed by the four layers).
  results: { fill: "rgba(168,85,247,0.06)", stroke: "#A855F7", text: "#FFFFFF" },
  doc: { fill: "rgba(59,130,246,0.08)", stroke: "#3B82F6", text: "#FFFFFF" },
  // S6: the presenter's Commit to the Bank's repository, after the record.
  commit: { fill: "rgba(20,184,166,0.16)", stroke: "#2DD4BF", text: "#FFFFFF" },
};

export default function FlowDiagram({ layout }) {
  const nodes = layout && Array.isArray(layout.nodes) ? layout.nodes : [];
  if (nodes.length === 0) return null;
  const edges = Array.isArray(layout.edges) ? layout.edges : [];
  const width = PAD * 2 + nodes.length * W + (nodes.length - 1) * GAP;
  const height = BAND_Y + BAND_H + PAD;
  const xOf = (i) => PAD + i * (W + GAP);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const targets = (layout.layers && Array.isArray(layout.layers.targets) ? layout.layers.targets : []).map((id) => index.get(id)).filter((i) => i !== undefined);
  const bandX1 = targets.length ? xOf(Math.min(...targets)) : PAD;
  const bandX2 = targets.length ? xOf(Math.max(...targets)) + W : PAD + W;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto max-h-60" role="img" aria-label="The flow of the demo" data-flow-diagram="true">
      <defs>
        <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#8C8C8C" />
        </marker>
        <marker id="flow-arrow-blue" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#3B82F6" />
        </marker>
      </defs>
      {edges.map((e) => {
        const a = index.get(e.from);
        const b = index.get(e.to);
        if (a === undefined || b === undefined) return null;
        return <line key={`${e.from}-${e.to}`} x1={xOf(a) + W} y1={TOP + H / 2} x2={xOf(b) - 1} y2={TOP + H / 2} stroke="#8C8C8C" strokeWidth="1.5" markerEnd="url(#flow-arrow)" />;
      })}
      {nodes.map((n, i) => {
        const st = STYLE[n.kind] || STYLE.ticket;
        return (
          <g key={n.id}>
            <rect x={xOf(i)} y={TOP} width={W} height={H} rx="12" fill={st.fill} stroke={st.stroke} strokeWidth="1.2" strokeDasharray={n.optional ? "5 4" : undefined} />
            <text x={xOf(i) + W / 2} y={TOP + 24} textAnchor="middle" fill={st.text} fontSize="13" fontWeight="700" fontFamily="inherit">
              {n.label}
            </text>
            <text x={xOf(i) + W / 2} y={TOP + 42} textAnchor="middle" fill="#8C8C8C" fontSize="10.5" fontFamily="inherit">
              {n.sub}
            </text>
          </g>
        );
      })}
      {targets.length > 0 && (
        <g>
          {targets.map((i) => (
            <line key={i} x1={xOf(i) + W / 2} y1={BAND_Y} x2={xOf(i) + W / 2} y2={TOP + H + 3} stroke="#3B82F6" strokeWidth="1.2" strokeDasharray="3 3" markerEnd="url(#flow-arrow-blue)" />
          ))}
          <rect x={bandX1} y={BAND_Y} width={bandX2 - bandX1} height={BAND_H} rx="10" fill="rgba(59,130,246,0.08)" stroke="#3B82F6" strokeDasharray="4 3" />
          <text x={(bandX1 + bandX2) / 2} y={BAND_Y + 21} textAnchor="middle" fill="#93C5FD" fontSize="11.5" fontWeight="600" fontFamily="inherit">
            {layout.layers && layout.layers.label ? layout.layers.label : "Four layers of rules"}
          </text>
        </g>
      )}
    </svg>
  );
}
