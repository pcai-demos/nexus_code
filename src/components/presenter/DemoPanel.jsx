"use client";

/**
 * DemoPanel — the presenter's Demo panel (presenter panels design §2 and §3; decisions D1, D5 and D7 of 2026-10-07).
 *
 * An overlay over the workbench only (below the navigation bar, right of the sidebar), so the sidebar's icon toggles
 * it and the IDE column underneath is never unmounted. One header: the demo tabs, the Overview / Documents switch, the
 * bridge and seed chips, refresh and close. Overview is the demo card with Select demo; Documents is the viewer. The
 * panel does its own fetching (the full state, with the store's layers and their catalogue) so the chat panel stays
 * fetch-free. Escape closes. Polish (the owner, 2026-10-14): the demo tabs are gone, since a demo is chosen on the
 * selection screen; the header names the one demo shown and offers "Choose another demo", which returns to that screen.
 */
import React, { useCallback, useEffect, useState } from "react";
import { RiCloseLine, RiRefreshLine, RiLoader4Line, RiSlideshow3Line } from "@remixicon/react";
import DemoCard from "./DemoCard";
import DocumentViewer from "./DocumentViewer";

const API = "/api/ide-bridge/scenarios";
const CHIP = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border";
const MUTED = "bg-white/5 text-neutrals-medium border-white/10";
const GOOD = "bg-teal-500/15 text-teal-300 border-teal-500/20";
const WARN = "bg-amber-500/15 text-amber-400 border-amber-500/20";
const BAD = "bg-red-500/15 text-red-300 border-red-500/20";

async function post(body) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`the scenarios route answered HTTP ${res.status}`);
  return json;
}

export default function DemoPanel({ open = false, request = null, activeDemoId = null, storeSettings = {}, technical = null, onClose, onChooseDemo, onSelected, onRecordTrace }) {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState("overview");
  const [scenarioId, setScenarioId] = useState(null);
  const [passages, setPassages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [applied, setApplied] = useState(null);

  // The request that opened the panel (section, scenario, cited passages): applied once per request, during render.
  if (request !== applied) {
    setApplied(request);
    if (request) {
      if (request.section) setSection(request.section);
      if (request.scenarioId) setScenarioId(request.scenarioId);
      setPassages(Array.isArray(request.passages) ? request.passages : []);
      setMessage(null);
    }
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await post({ action: "state", light: false, adminConfig: storeSettings });
      setState(s);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [storeSettings]);

  useEffect(() => {
    if (!open) return undefined;
    refresh();
    const onKey = (e) => {
      if (e.key === "Escape" && typeof onClose === "function") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // the store settings are read when the panel opens or on Refresh, not on every settings keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const scenarios = state && Array.isArray(state.scenarios) ? state.scenarios : [];
  const scenario = scenarios.find((s) => s.id === (scenarioId || activeDemoId)) || scenarios[0] || null;
  const bridgeUp = Boolean(state && state.bridge && state.bridge.connected);
  const seed = state && state.seed ? state.seed : null;
  const layers = state && state.store && Array.isArray(state.store.layers) ? state.store.layers : [];
  const store = state && state.store ? { collection: state.store.collection || null, documentCount: Number.isFinite(state.store.documentCount) ? state.store.documentCount : null, error: state.store.error || null } : null;
  const demoSources = scenario && scenario.card && scenario.card.artefacts ? scenario.card.artefacts.documents.map((d) => d.source) : [];

  const select = async (s) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await post({ action: "select", scenarioId: s.id, adminConfig: storeSettings });
      if (r && r.trace && typeof onRecordTrace === "function") onRecordTrace(r.trace);
      // Select runs the demo's tests once when its definition says so: that run is its own trace entry.
      if (r && r.testTrace && typeof onRecordTrace === "function") onRecordTrace(r.testTrace);
      if (r && r.success) {
        if (typeof onSelected === "function") onSelected(s, r);
      } else {
        setMessage({ tone: "bad", text: `Select demo: ${(r && r.error) || "failed"}` });
      }
    } catch (err) {
      setMessage({ tone: "bad", text: `Select demo: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const tab = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setSection(id)}
      className={`px-4 py-1.5 rounded-xl text-[12px] font-sans font-bold uppercase tracking-widest transition-all cursor-pointer ${section === id ? "bg-brand-vivid/15 text-brand-vivid border border-brand-vivid/30" : "text-neutrals-medium border border-transparent hover:text-white hover:bg-white/5"}`}
      aria-pressed={section === id}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed top-20 left-20 right-0 bottom-0 z-50 flex flex-col bg-[#0A0A0A]/97 backdrop-blur-xl text-white" role="dialog" aria-modal="true" aria-label="Demo panel" data-demo-panel={section}>
      <header className="flex items-center gap-3 px-6 py-3 border-b border-white/10 shrink-0 flex-wrap">
        <RiSlideshow3Line size={18} className="text-brand-vivid" />
        <span className="text-xs font-sans font-bold uppercase tracking-widest text-neutrals-light">Demos</span>
        {/* Polish (the owner, 2026-10-14): one demo at a time here; the demo is chosen on the selection screen. */}
        <div className="flex items-center gap-2 ml-2 min-w-0">
          {scenario ? (
            <span className="text-[13px] font-sans font-semibold text-white truncate" title={scenario.title} data-demo-panel-demo={scenario.id}>
              {scenario.id.toUpperCase()} · {scenario.title}
              {activeDemoId === scenario.id ? <span className={`${CHIP} ${GOOD} ml-2`}>selected</span> : null}
            </span>
          ) : (
            scenarios.length === 0 && !loadError && <span className={`${CHIP} ${MUTED}`}>{loading ? "reading…" : "no demos"}</span>
          )}
          <button
            type="button"
            onClick={() => typeof onChooseDemo === "function" && onChooseDemo()}
            className="px-3 py-1 rounded-xl border border-white/15 bg-white/5 text-[11px] font-sans font-bold text-neutrals-light hover:text-white hover:bg-white/10 transition-all cursor-pointer whitespace-nowrap"
            title="Back to the demo selection screen"
            data-choose-demo
          >
            Choose another demo
          </button>
        </div>
        <div className="flex items-center gap-1 ml-4">
          {tab("overview", "Overview")}
          {tab("documents", "Documents")}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {loadError && <span className={`${CHIP} ${BAD}`}>state: {loadError}</span>}
          {message && <span className={`${CHIP} ${message.tone === "good" ? GOOD : BAD}`}>{message.text}</span>}
          <span className={`${CHIP} ${bridgeUp ? GOOD : WARN}`} title={bridgeUp ? `extension host ${state.bridge.pid}` : "Open the IDE panel: the bridge starts with it."}>
            {bridgeUp ? "bridge active" : "bridge offline"}
          </span>
          <span className={`${CHIP} ${seed && seed.commit ? MUTED : WARN}`} title={seed && seed.commit ? `seed commit ${seed.commit}` : "The seed repository is not in the workspace: Rebuild workspace in the step bar."}>
            {seed && seed.commit ? `seed ${seed.commit.slice(0, 7)}` : "seed not loaded"}
          </span>
          {loading && <RiLoader4Line size={14} className="animate-spin text-brand-vivid" />}
          <button type="button" onClick={refresh} className="p-1.5 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 cursor-pointer" title="Re-read the demos, the store and the bridge">
            <RiRefreshLine size={16} />
          </button>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 cursor-pointer" title="Close (Escape)" aria-label="Close the Demo panel">
            <RiCloseLine size={18} />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        {section === "overview" ? (
          <div className="h-full overflow-auto custom-scrollbar px-10 py-8">
            {scenario ? (
              <DemoCard scenario={scenario} layers={layers} firm={state ? state.firm : null} technical={technical} store={store} bridgeUp={bridgeUp} seed={seed} busy={busy} selected={activeDemoId === scenario.id} onSelect={select} />
            ) : (
              <div className="text-sm font-sans text-neutrals-medium">{loadError ? `The demos could not be read: ${loadError}` : "Reading the demos…"}</div>
            )}
          </div>
        ) : (
          <DocumentViewer layers={layers} demoSources={demoSources} passages={passages} onClearPassages={() => setPassages([])} />
        )}
      </div>
    </div>
  );
}
