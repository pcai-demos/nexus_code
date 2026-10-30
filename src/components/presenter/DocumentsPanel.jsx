"use client";

/**
 * DocumentsPanel — every document in play for the selected demo, full size (PR B; the owner's ask of 2026-10-07 and
 * decisions D4 (a), D5). The sidebar's Documents icon, which replaced Store Admin, opens it over the workbench (the
 * sidebar and the IDE column stay). It lists the demo's documents in the four layers of rules plus its non-code
 * materials (the ticket), each with why it matters and whether the store holds it, and opens them in the same viewer as
 * the Demo panel's Documents tab (a PDF at the page, Markdown formatted). With no demo selected it lists every document
 * in the store. The old ingest tray and Tidy Up stay one click away: "Store admin" in the footer opens that unchanged
 * drawer. This component does its own fetching (the scenarios route's full state, read-only).
 */
import React, { useCallback, useEffect, useState } from "react";
import { RiBookOpenLine, RiCloseLine, RiRefreshLine, RiLoader4Line, RiDatabase2Line } from "@remixicon/react";
import DocumentViewer from "./DocumentViewer";

const API = "/api/ide-bridge/scenarios";
const CHIP = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border";
const MUTED = "bg-white/5 text-neutrals-medium border-white/10";
const BAD = "bg-red-500/15 text-red-300 border-red-500/20";
// A stable empty list: the viewer treats a new passages array as a new request.
const NO_PASSAGES = [];

async function post(body) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`the scenarios route answered HTTP ${res.status}`);
  return json;
}

export default function DocumentsPanel({ open = false, activeDemoId = null, storeSettings = {}, onClose, onStoreAdmin }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await post({ action: "state", light: false, adminConfig: storeSettings });
      setState(s);
      setError(s && s.store && s.store.error ? s.store.error : null);
    } catch (err) {
      setError(err.message);
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
    // read when the panel opens or on Refresh, not on every settings keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const scenarios = state && Array.isArray(state.scenarios) ? state.scenarios : [];
  const scenario = activeDemoId ? scenarios.find((s) => s.id === activeDemoId) || null : null;
  const storeLayers = state && state.store && Array.isArray(state.store.layers) ? state.store.layers : [];
  const materials = scenario && Array.isArray(scenario.materials) ? scenario.materials : [];
  const cardDocs = scenario && scenario.card && scenario.card.artefacts ? scenario.card.artefacts.documents : [];
  const layers = materials.length
    ? [
        {
          id: "materials",
          label: "Demo materials",
          marker: "DEMO",
          documents: materials.length,
          expected: materials.length,
          catalogue: materials.map((m) => ({ source: m.source, inStore: null, chunkCount: null, totalPages: null, path: m.path, ext: m.ext })),
        },
        ...storeLayers,
      ]
    : storeLayers;
  const demoSources = [...cardDocs.map((d) => d.source), ...materials.map((m) => m.source)];
  const roles = Object.fromEntries([...cardDocs.map((d) => [d.source, d.role]), ...materials.map((m) => [m.source, m.role])]);
  const inStore = state && state.store && Number.isFinite(state.store.documentCount) ? state.store.documentCount : null;

  return (
    <div className="fixed top-20 left-20 right-0 bottom-0 z-50 flex flex-col bg-[#0A0A0A]/97 backdrop-blur-xl text-white" role="dialog" aria-modal="true" aria-label="Documents panel" data-documents-panel={scenario ? scenario.id : "all"}>
      <header className="flex items-center gap-3 px-6 py-3 border-b border-white/10 shrink-0 flex-wrap">
        <RiBookOpenLine size={18} className="text-brand-vivid" />
        <span className="text-xs font-sans font-bold uppercase tracking-widest text-neutrals-light">Documents</span>
        <span className={`${CHIP} ${scenario ? "bg-brand-vivid/15 text-brand-vivid border-brand-vivid/25" : MUTED}`}>{scenario ? `${scenario.id.toUpperCase()} · ${scenario.title}` : "every document in the store"}</span>
        {scenario && <span className="text-[12px] font-sans text-neutrals-medium">the documents in play for this demo: regulation, policy, standards, team knowledge and its own materials</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {error && <span className={`${CHIP} ${BAD}`}>store: {error}</span>}
          {inStore !== null && <span className={`${CHIP} ${MUTED}`}>{inStore} documents in the store</span>}
          {loading && <RiLoader4Line size={14} className="animate-spin text-brand-vivid" />}
          <button type="button" onClick={refresh} className="p-1.5 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 cursor-pointer" title="Re-read the store">
            <RiRefreshLine size={16} />
          </button>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 cursor-pointer" title="Close (Escape)" aria-label="Close the Documents panel">
            <RiCloseLine size={18} />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <DocumentViewer key={scenario ? scenario.id : "all"} layers={layers} demoSources={demoSources} passages={NO_PASSAGES} roles={roles} defaultShowAll={!scenario} />
      </div>
      <footer className="shrink-0 border-t border-white/10 px-6 py-2 flex items-center gap-2">
        <span className="text-[11px] font-sans text-neutrals-medium">Adding or removing documents is an admin task:</span>
        <button
          type="button"
          onClick={() => typeof onStoreAdmin === "function" && onStoreAdmin()}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-[11px] font-sans font-semibold text-neutrals-light hover:border-brand-vivid/50 hover:text-white cursor-pointer"
          data-store-admin="true"
        >
          <RiDatabase2Line size={12} /> Store admin
        </button>
        <span className="text-[11px] font-sans text-neutrals-dark">the ingest tray and Tidy Up, unchanged</span>
      </footer>
    </div>
  );
}
