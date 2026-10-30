"use client";

/**
 * DemoSelect — the presenter's demo selection screen (polish design §3, the owner's PL-D1 to PL-D6 of 2026-10-14).
 *
 * The Demo icon opens this screen, before the Demo panel: one large card per demo (its icon, title, one-line summary,
 * language, step count and "about N min", the definition's approximate figure), each with Select demo and Details,
 * and one button back to the app with no demo ("free flow"). Select sets the workspace up through the same route
 * action the Demo panel uses and returns to the app; when the IDE's bridge is not up it opens the IDE panel and waits
 * for the bridge first (PL-D5 (a)). Details opens the existing Demo panel on that demo. Free flow closes the screen and
 * clears the active demo; nothing in the chat or the IDE is reset (PL-D6 (a)). An overlay over the workbench only, as
 * the Demo panel is, so the IDE column underneath is never unmounted. Escape closes.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Icons from "@remixicon/react";
import { RiArrowGoBackLine, RiCloseLine, RiInformationLine, RiLoader4Line, RiPlayLine, RiSlideshow3Line } from "@remixicon/react";

const API = "/api/ide-bridge/scenarios";
/** PL-D5 (a): how long Select waits for the bridge after opening the IDE panel, and how often it asks. */
const BRIDGE_WAIT_MS = 15000;
const BRIDGE_POLL_MS = 1000;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The demo's icon component: the definition's Remixicon name (PL-D2 (a)), or the Demo icon when it names none. */
function iconOf(scenario) {
  const name = scenario && typeof scenario.icon === "string" ? scenario.icon : "";
  const Icon = name && Icons[name] ? Icons[name] : RiSlideshow3Line;
  return Icon;
}

export default function DemoSelect({ open = false, activeDemoId = null, onClose, onOpenIde, onSelected, onDetails, onFreeFlow, onRecordTrace }) {
  const [scenarios, setScenarios] = useState([]);
  const [bridgeUp, setBridgeUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState(null);
  // Whether the screen is still open, for the bridge wait loop (a closed screen stops waiting).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /** Re-reads the demos and the bridge; clears any message from the last action. */
  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const s = await post({ action: "state", light: true });
      setScenarios(Array.isArray(s.scenarios) ? s.scenarios : []);
      setBridgeUp(Boolean(s.bridge && s.bridge.connected));
      setLoadError(null);
      return Boolean(s.bridge && s.bridge.connected);
    } catch (err) {
      setLoadError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    refresh();
    const onKey = (e) => {
      if (e.key === "Escape" && typeof onClose === "function") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, refresh, onClose]);

  if (!open) return null;

  /** The bridge, up: as it stands, or after the IDE panel is opened and the bridge given BRIDGE_WAIT_MS to start. */
  const ensureBridge = async () => {
    if (await refresh()) return true;
    if (typeof onOpenIde === "function") onOpenIde();
    setWaiting(true);
    try {
      const until = Date.now() + BRIDGE_WAIT_MS;
      while (Date.now() < until && openRef.current) {
        await sleep(BRIDGE_POLL_MS);
        if (await refresh()) return true;
      }
      return false;
    } finally {
      setWaiting(false);
    }
  };

  const select = async (s) => {
    setBusy(s.id);
    setMessage(null);
    try {
      if (!(await ensureBridge())) {
        setMessage({ tone: "bad", text: `The IDE's bridge did not start within ${Math.round(BRIDGE_WAIT_MS / 1000)} s: open the IDE panel, wait for it to load, then select again.` });
        return;
      }
      const r = await post({ action: "select", scenarioId: s.id });
      if (r && r.trace && typeof onRecordTrace === "function") onRecordTrace(r.trace);
      if (r && r.testTrace && typeof onRecordTrace === "function") onRecordTrace(r.testTrace);
      if (r && r.success) {
        if (typeof onSelected === "function") onSelected(s, r);
      } else {
        setMessage({ tone: "bad", text: `Select demo: ${(r && r.error) || "failed"}` });
      }
    } catch (err) {
      setMessage({ tone: "bad", text: `Select demo: ${err.message}` });
    } finally {
      setBusy(null);
    }
  };

  const anyBusy = busy !== null;

  return (
    <div className="fixed top-20 left-20 right-0 bottom-0 z-50 flex flex-col bg-[#0A0A0A]/97 backdrop-blur-xl text-white" role="dialog" aria-modal="true" aria-label="Choose a demo" data-demo-select>
      <header className="flex items-center gap-3 px-6 py-3 border-b border-white/10 shrink-0 flex-wrap">
        <RiSlideshow3Line size={18} className="text-brand-vivid" />
        <span className="text-xs font-sans font-bold uppercase tracking-widest text-neutrals-light">Choose a demo</span>
        <span className="text-[12px] font-sans text-neutrals-medium ml-2 hidden md:inline">Select sets the demo up in the IDE and returns here to the app; Details shows the card first.</span>
        <div className="ml-auto flex items-center gap-1.5">
          {loadError && <span className={`${CHIP} ${BAD}`}>state: {loadError}</span>}
          {message && <span className={`${CHIP} ${message.tone === "good" ? GOOD : BAD}`}>{message.text}</span>}
          <span className={`${CHIP} ${bridgeUp ? GOOD : WARN}`} title={bridgeUp ? "the IDE's bridge is up" : "Select opens the IDE panel and waits for its bridge"}>
            {waiting ? "waiting for the bridge…" : bridgeUp ? "bridge active" : "bridge offline"}
          </span>
          {loading && <RiLoader4Line size={14} className="animate-spin text-brand-vivid" />}
          <button
            type="button"
            onClick={() => typeof onFreeFlow === "function" && onFreeFlow()}
            disabled={anyBusy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-sm font-sans font-bold text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title="Back to the app with no demo selected: the chat and the IDE stay as they are"
            data-free-flow
          >
            <RiArrowGoBackLine size={16} /> Free flow: no demo
          </button>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 cursor-pointer" title="Close (Escape)" aria-label="Close the demo selection">
            <RiCloseLine size={18} />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar px-10 py-8">
        {scenarios.length === 0 ? (
          <div className="text-sm font-sans text-neutrals-medium">{loadError ? `The demos could not be read: ${loadError}` : "Reading the demos…"}</div>
        ) : (
          <div className="grid gap-5 max-w-[1500px] mx-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
            {scenarios.map((s) => {
              const Icon = iconOf(s);
              const selected = activeDemoId === s.id;
              const steps = Array.isArray(s.steps) ? s.steps.length : 0;
              const thisBusy = busy === s.id;
              return (
                <article key={s.id} className={`rounded-2xl border px-6 py-5 flex flex-col gap-4 transition-all ${selected ? "border-brand-vivid/50 bg-brand-vivid/10" : "border-white/10 bg-white/2 hover:bg-white/4"}`} data-demo-select-card={s.id}>
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-brand-vivid/15 border border-brand-vivid/25 flex items-center justify-center shrink-0">
                      <Icon size={36} className="text-brand-vivid" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`${CHIP} bg-brand-vivid/15 text-brand-vivid border-brand-vivid/25`}>{s.id.toUpperCase()}</span>
                        {s.language && <span className={`${CHIP} ${MUTED}`}>{s.language}</span>}
                        {steps > 0 && <span className={`${CHIP} ${MUTED}`}>{steps} steps</span>}
                        {s.minutes ? <span className={`${CHIP} ${MUTED}`} title="approximate: model time plus the presenter's clicks">about {s.minutes} min</span> : null}
                        {selected && <span className={`${CHIP} ${GOOD}`}>selected</span>}
                      </div>
                      <h2 className="text-2xl font-bold text-white leading-tight">{s.title}</h2>
                    </div>
                  </div>
                  {s.summary && <p className="text-base leading-relaxed text-neutrals-light font-sans">{s.summary}</p>}
                  <div className="flex items-center gap-2 mt-auto pt-1">
                    <button
                      type="button"
                      disabled={anyBusy}
                      onClick={() => select(s)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-vivid text-white text-sm font-sans font-bold shadow-[0_0_20px_rgba(242,86,29,0.3)] hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Set this demo up in the IDE and return to the app"
                      data-select-demo={s.id}
                    >
                      {thisBusy ? <RiLoader4Line size={16} className="animate-spin" /> : <RiPlayLine size={16} />}
                      {thisBusy ? (waiting ? "Starting the IDE…" : "Setting up…") : selected ? "Select again" : "Select demo"}
                    </button>
                    <button
                      type="button"
                      disabled={anyBusy}
                      onClick={() => typeof onDetails === "function" && onDetails(s)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/15 bg-white/5 text-sm font-sans font-bold text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      title="The demo's card: the situation, the people, the documents and the flow"
                      data-demo-details={s.id}
                    >
                      <RiInformationLine size={16} /> Details
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
