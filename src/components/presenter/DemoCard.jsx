"use client";

/**
 * DemoCard — the Overview section of the Demo panel (presenter panels design §2; decisions D1 and D7 of 2026-10-07).
 *
 * Generated from the scenario definition's card: what the demo is, the situation simulated, the people and teams, the
 * artefacts (internal: the code and the internal layers' documents; external: the regulator documents), the outputs,
 * the value, the flow drawn from the steps, and the technical block read LIVE from the admin settings and the store
 * (never from text in the card). The talk track is presenter-only: behind a toggle, hidden by default, because the
 * audience shares the screen. The Select demo button is here.
 */
import React, { useState } from "react";
import { RiPlayLine, RiLoader4Line, RiEyeLine, RiEyeOffLine, RiFileTextLine, RiCodeSSlashLine, RiGovernmentLine, RiBuilding2Line } from "@remixicon/react";
import { flowLayout } from "@/lib/coding/steps";
import FlowDiagram from "./FlowDiagram";

const CHIP = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border";
const MUTED = "bg-white/5 text-neutrals-medium border-white/10";
const GOOD = "bg-teal-500/15 text-teal-300 border-teal-500/20";
const WARN = "bg-amber-500/15 text-amber-400 border-amber-500/20";
const LAYER_HUES = {
  regulator: "bg-blue-500/10 text-blue-300 border-blue-500/25",
  corporate: "bg-purple-500/10 text-purple-300 border-purple-500/25",
  sdlc: "bg-teal-500/10 text-teal-300 border-teal-500/25",
  team: "bg-amber-500/10 text-amber-300 border-amber-500/25",
};
const LABEL = "text-[11px] font-sans font-bold uppercase tracking-[0.18em] text-brand-vivid mb-2";
const BODY = "text-[15px] leading-relaxed text-neutrals-light font-sans";
const PANEL = "rounded-2xl border border-white/10 bg-white/2 px-5 py-4";

function layerOf(layers, source) {
  for (const l of Array.isArray(layers) ? layers : []) {
    const hit = (Array.isArray(l.catalogue) ? l.catalogue : []).find((d) => d.source === source);
    if (hit) return { id: l.id, label: l.label, marker: l.marker, inStore: Boolean(hit.inStore), path: hit.path || null };
  }
  return null;
}

function Section({ title, children, className = "" }) {
  return (
    <section className={`${PANEL} ${className}`}>
      <h3 className={LABEL}>{title}</h3>
      {children}
    </section>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 min-w-0">
      <div className="text-[10px] font-sans font-bold uppercase tracking-[0.14em] text-neutrals-medium">{label}</div>
      <div className="text-sm font-mono text-white truncate" title={value || ""}>
        {value || "—"}
      </div>
      {sub ? <div className="text-[11px] font-sans text-neutrals-medium truncate">{sub}</div> : null}
    </div>
  );
}

export default function DemoCard({ scenario, layers = [], firm = null, technical = null, store = null, bridgeUp = false, seed = null, busy = false, selected = false, onSelect }) {
  const [notesOpen, setNotesOpen] = useState(false);
  if (!scenario) return null;
  const card = scenario.card || { about: "", scenario: "", people: [], teams: [], artefacts: { code: [], documents: [] }, outputs: [], value: [] };
  const docs = (card.artefacts && Array.isArray(card.artefacts.documents) ? card.artefacts.documents : []).map((d) => ({ ...d, layer: layerOf(layers, d.source) }));
  const external = docs.filter((d) => d.layer && d.layer.id === "regulator");
  const internalDocs = docs.filter((d) => !d.layer || d.layer.id !== "regulator");
  const code = card.artefacts && Array.isArray(card.artefacts.code) ? card.artefacts.code : [];
  const layout = flowLayout(scenario);
  const offlineReason = "Open the IDE panel: the bridge starts with it.";
  const layersInStore = (Array.isArray(layers) ? layers : []).filter((l) => l.documents > 0).length;
  const resets = !scenario.select || scenario.select.reset !== false;

  return (
    <div className="flex flex-col gap-5 max-w-[1500px] mx-auto" data-demo-card={scenario.id}>
      <header className="flex items-start gap-6 flex-wrap">
        <div className="flex-1 min-w-[320px]">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={`${CHIP} bg-brand-vivid/15 text-brand-vivid border-brand-vivid/25`}>{scenario.id.toUpperCase()}</span>
            <span className={`${CHIP} ${MUTED}`}>{scenario.ticket.id}</span>
            {scenario.language && <span className={`${CHIP} ${MUTED}`}>{scenario.language}</span>}
            {scenario.minutes ? <span className={`${CHIP} ${MUTED}`}>about {scenario.minutes} minutes</span> : null}
            {selected && <span className={`${CHIP} ${GOOD}`}>selected</span>}
          </div>
          <h2 className="text-3xl font-bold text-white leading-tight">{scenario.title}</h2>
          {scenario.summary && <p className="text-base text-neutrals-light font-sans mt-1">{scenario.summary}</p>}
          {firm && <p className="text-[12px] font-mono text-neutrals-medium mt-2">{firm}</p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            disabled={!bridgeUp || busy}
            onClick={() => typeof onSelect === "function" && onSelect(scenario)}
            title={bridgeUp ? (resets ? "Reset this demo's files, open the ticket and the files in the IDE, clear the chat and load the steps" : "Open the ticket and the files in the IDE, clear the chat and load the steps") : offlineReason}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-brand-vivid text-white text-base font-sans font-bold shadow-[0_0_24px_rgba(242,86,29,0.35)] hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            data-select-demo={scenario.id}
          >
            {busy ? <RiLoader4Line size={18} className="animate-spin" /> : <RiPlayLine size={18} />}
            {selected ? "Select again" : "Select demo"}
          </button>
          <div className="text-[11px] font-sans text-neutrals-medium text-right max-w-[280px]">
            {bridgeUp ? (resets ? "Resets this demo's files, opens them in the IDE, clears the chat and loads the steps." : "Opens the files in the IDE, clears the chat and loads the steps. Nothing is reset.") : offlineReason}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`${CHIP} ${bridgeUp ? GOOD : WARN}`}>{bridgeUp ? "bridge active" : "bridge offline"}</span>
            <span className={`${CHIP} ${seed && seed.commit ? MUTED : WARN}`}>{seed && seed.commit ? `seed ${String(seed.commit).slice(0, 7)}` : "seed not loaded"}</span>
          </div>
        </div>
      </header>

      {card.highlight && (
        <div className="rounded-2xl border border-brand-vivid/40 bg-brand-vivid/10 px-5 py-4" data-card-highlight={card.highlight.rule}>
          <div className="text-[11px] font-sans font-bold uppercase tracking-[0.18em] text-brand-vivid mb-1">The rule this demo proves</div>
          <p className="text-[16px] font-sans text-white leading-relaxed">
            <span className="font-mono font-bold text-brand-vivid">{card.highlight.rule}</span> {card.highlight.text}
          </p>
          <p className="text-[12px] font-sans text-neutrals-medium mt-1">{card.highlight.source}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="About this demo">
          <p className={BODY}>{card.about || scenario.summary}</p>
        </Section>
        <Section title="The scenario">
          <p className={BODY}>{card.scenario || scenario.story}</p>
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section title="People and roles" className="lg:col-span-2">
          {card.people.length === 0 ? (
            <p className={BODY}>Not written yet.</p>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {card.people.map((p) => (
                <li key={p.name} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                  <div className="text-sm font-sans font-bold text-white">{p.name}</div>
                  <div className="text-[12px] font-sans text-brand-vivid">{p.role}</div>
                  {p.part && <div className="text-[13px] font-sans text-neutrals-light mt-1">{p.part}</div>}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Teams">
          <ul className="flex flex-col gap-2">
            {card.teams.map((t) => (
              <li key={t} className="text-[14px] font-sans text-neutrals-light flex items-start gap-2">
                <RiBuilding2Line size={14} className="text-neutrals-medium mt-1 shrink-0" />
                <span>{t}</span>
              </li>
            ))}
            {card.teams.length === 0 && <li className={BODY}>Not written yet.</li>}
          </ul>
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Internal artefacts">
          <ul className="flex flex-col gap-2">
            {code.map((c) => (
              <li key={c.path} className="flex items-start gap-2">
                <RiCodeSSlashLine size={14} className="text-teal-300 mt-1 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] font-mono text-white truncate" title={c.path}>
                    {c.path.replace(/^nexus-payments\//, "")}
                  </div>
                  {c.role && <div className="text-[12px] font-sans text-neutrals-medium">{c.role}</div>}
                </div>
                <span className={`${CHIP} ${MUTED} ml-auto shrink-0`}>seed repository</span>
              </li>
            ))}
            {internalDocs.map((d) => (
              <li key={d.source} className="flex items-start gap-2">
                <RiFileTextLine size={14} className="text-purple-300 mt-1 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] font-mono text-white truncate" title={d.source}>
                    {d.source}
                  </div>
                  {d.role && <div className="text-[12px] font-sans text-neutrals-medium">{d.role}</div>}
                </div>
                <span className={`${CHIP} ${d.layer && d.layer.inStore ? GOOD : WARN} ml-auto shrink-0`}>{d.layer ? (d.layer.inStore ? d.layer.label : `${d.layer.label} · not in store`) : "unknown layer"}</span>
              </li>
            ))}
            {code.length === 0 && internalDocs.length === 0 && <li className={BODY}>None named.</li>}
          </ul>
          {(Array.isArray(layers) ? layers : []).filter((l) => l.id !== "regulator" && l.documents === 0).length > 0 && (
            <p className="text-[12px] font-sans text-neutrals-medium mt-3">
              Not in the store yet:{" "}
              {(Array.isArray(layers) ? layers : [])
                .filter((l) => l.id !== "regulator" && l.documents === 0)
                .map((l) => l.label)
                .join(", ")}
              . The internal layers arrive with the content pack.
            </p>
          )}
        </Section>
        <Section title="External artefacts">
          <ul className="flex flex-col gap-2">
            {external.map((d) => (
              <li key={d.source} className="flex items-start gap-2">
                <RiGovernmentLine size={14} className="text-blue-300 mt-1 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] font-mono text-white truncate" title={d.source}>
                    {d.source}
                  </div>
                  {d.role && <div className="text-[12px] font-sans text-neutrals-medium">{d.role}</div>}
                </div>
                <span className={`${CHIP} ${d.layer && d.layer.inStore ? GOOD : WARN} ml-auto shrink-0`}>{d.layer && d.layer.inStore ? "in the store" : "not in the store"}</span>
              </li>
            ))}
            {external.length === 0 && <li className={BODY}>None named.</li>}
          </ul>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(Array.isArray(layers) ? layers : []).map((l) => (
              <span key={l.id} className={`${CHIP} ${l.documents > 0 ? LAYER_HUES[l.id] || MUTED : MUTED}`} title={l.description || l.label}>
                {l.marker} · {l.documents > 0 ? `${l.documents} document${l.documents === 1 ? "" : "s"}` : "not ingested yet"}
              </span>
            ))}
          </div>
        </Section>
      </div>

      <Section title="The flow">
        <FlowDiagram layout={layout} />
        <ol className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
          {scenario.steps.map((s, i) => (
            <li key={s.id} className="text-[13px] font-sans text-neutrals-light">
              <span className="font-mono text-neutrals-medium">{i + 1}.</span> {s.title}
              {s.prompt ? <span className="text-neutrals-medium"> · “{s.prompt}”</span> : s.action === "record" ? <span className="text-neutrals-medium"> · the record is built from the run log, no model call</span> : s.action === "commit" ? <span className="text-neutrals-medium"> · the presenter&apos;s commit to the Bank&apos;s repository, with the record</span> : null}
              {s.optional ? <span className={`${CHIP} ${MUTED} ml-1`}>optional</span> : null}
            </li>
          ))}
        </ol>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Outputs">
          <ul className="flex flex-col gap-2">
            {card.outputs.map((o) => (
              <li key={o} className="text-[14px] font-sans text-neutrals-light flex items-start gap-2">
                <span className="text-teal-300 mt-0.5 select-none">✓</span>
                <span>{o}</span>
              </li>
            ))}
            {card.outputs.length === 0 && <li className={BODY}>Not written yet.</li>}
          </ul>
        </Section>
        <Section title="Value to the customer">
          <ul className="flex flex-col gap-2">
            {card.value.map((v) => (
              <li key={v} className="text-[14px] font-sans text-neutrals-light flex items-start gap-2">
                <span className="text-brand-vivid mt-0.5 select-none">•</span>
                <span>{v}</span>
              </li>
            ))}
            {card.value.length === 0 && <li className={BODY}>Not written yet.</li>}
          </ul>
        </Section>
      </div>

      <Section title="Technical, read live">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Tile label="Code model" value={technical && technical.codeModel} sub={technical && technical.endpointType ? `${technical.endpointType} endpoint` : null} />
          <Tile label="Thinking" value={technical && technical.thinkingMode ? `${technical.thinkingMode} by default` : null} sub="per turn, recorded" />
          <Tile label="Embeddings" value={technical && technical.embedModel} />
          <Tile label="Reranker" value={technical && technical.rerankModel} />
          <Tile label="Store" value={store && store.collection ? store.collection : null} sub={store && Number.isFinite(store.documentCount) ? `${store.documentCount} documents` : null} />
          <Tile label="Layers in store" value={`${layersInStore} of ${Array.isArray(layers) ? layers.length : 4}`} sub="searched per turn" />
        </div>
      </Section>

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-[12px] font-sans font-semibold text-neutrals-light hover:text-white hover:border-white/30 cursor-pointer" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen}>
          {notesOpen ? <RiEyeOffLine size={14} /> : <RiEyeLine size={14} />}
          {notesOpen ? "Hide presenter notes" : "Presenter notes"}
        </button>
        <span className="text-[11px] font-sans text-neutrals-medium">hidden by default: the audience shares this screen</span>
      </div>
      {notesOpen && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 px-5 py-4" data-presenter-notes="true">
          <h3 className="text-[11px] font-sans font-bold uppercase tracking-[0.18em] text-amber-400 mb-2">Presenter notes</h3>
          <p className={BODY}>{scenario.talkTrack || "No talk track written yet."}</p>
        </div>
      )}
    </div>
  );
}
