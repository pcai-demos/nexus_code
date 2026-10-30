"use client";

/**
 * ResetMenu — the sidebar's reset, in two levels (presenter panels design §13; the owner's decisions of 2026-10-07:
 * D1 (a) one entry with two levels, D2 what the hard reset resets and what it keeps, D4 folded into PR #70).
 *
 *   Clear the chat               the chat, the traces and the stats, as Session Reset always did; instant.
 *   Reset the demo environment   the hard reset between demos, RESET typed (the house rule, U-DESTRUCT/E38): the
 *                                workspace repository rebuilt from the seed (applied changes, new files, records and
 *                                any stray commit gone; the same seed commit every time); the IDE's editors, diffs,
 *                                terminals and test panel closed; the chat, traces and stats cleared; no demo selected;
 *                                thinking on; all documents in scope. It needs the IDE window, where the bridge runs.
 * Never touched: the documents and the vector store, the admin settings and model endpoints, the IDE's own settings,
 * and the run log's history (a reset marker starts every demo again at step 1). This component does its own fetching.
 */
import React, { useEffect, useRef, useState } from "react";
import { RiCloseLine, RiChatDeleteLine, RiRestartLine, RiLoader4Line, RiCheckLine, RiShieldCheckLine } from "@remixicon/react";

const API = "/api/ide-bridge/scenarios";
const CHIP = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border";
const GOOD = "bg-teal-500/15 text-teal-300 border-teal-500/20";
const WARN = "bg-amber-500/15 text-amber-400 border-amber-500/20";
const BAD = "bg-red-500/15 text-red-300 border-red-500/20";
const MUTED = "bg-white/5 text-neutrals-medium border-white/10";
const LIST = "text-[12px] font-sans text-neutrals-light leading-snug list-disc pl-4 flex flex-col gap-0.5";
const seconds = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "—");

async function post(body) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`the scenarios route answered HTTP ${res.status}`);
  return json;
}

export default function ResetMenu({ open = false, onClose, onClearChat, onEnvironmentReset }) {
  const [bridgeUp, setBridgeUp] = useState(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [wasOpen, setWasOpen] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Each opening starts clean (state adjusted during render, so no effect sets it).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTyped("");
      setMessage(null);
      setBridgeUp(null);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    post({ action: "state", light: true })
      .then((s) => {
        if (!cancelled) setBridgeUp(Boolean(s && s.bridge && s.bridge.connected));
      })
      .catch(() => {
        if (!cancelled) setBridgeUp(false);
      });
    const onKey = (e) => {
      if (e.key === "Escape" && typeof closeRef.current === "function") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  const typedOk = typed.trim().toUpperCase() === "RESET";
  const resetEnvironment = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await post({ action: "reset-all" });
      if (r && r.success) {
        if (typeof onEnvironmentReset === "function") onEnvironmentReset(r);
        setTyped("");
        setMessage({ tone: "good", text: `Done: the workspace was rebuilt from the seed (commit ${String(r.commit || "").slice(0, 7)}) in ${seconds(r.durationMs)}. Ready for the next demo.` });
      } else {
        // 2026-10-12: say "nothing was changed" only when the bridge says so (it checks before it deletes).
        const after =
          r && r.changed === false
            ? " Nothing else was changed."
            : r && r.changed === true
              ? " Part of the workspace repository was already removed: reset again once the cause is fixed."
              : "";
        setMessage({ tone: "bad", text: `The reset did not complete: ${(r && r.error) || "unknown"}.${after}` });
      }
    } catch (err) {
      setMessage({ tone: "bad", text: `The reset did not complete: ${err.message}.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[65]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && typeof onClose === "function") onClose();
      }}
      data-reset-menu="true"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reset"
        className="absolute left-24 bottom-6 w-[480px] max-w-[calc(100vw-7rem)] rounded-2xl border border-white/15 bg-[#0F0F10]/98 backdrop-blur-2xl shadow-[0_12px_48px_rgba(0,0,0,0.8)] text-white p-5 flex flex-col gap-4"
      >
        <div className="flex items-center gap-2">
          <RiRestartLine size={16} className="text-brand-vivid" />
          <span className="text-xs font-sans font-bold uppercase tracking-widest text-neutrals-light">Reset</span>
          <button type="button" onClick={onClose} disabled={busy} className="ml-auto p-1 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 cursor-pointer disabled:opacity-40" aria-label="Close the reset menu" title="Close (Escape)">
            <RiCloseLine size={16} />
          </button>
        </div>

        <section className="rounded-xl border border-white/10 bg-white/2 px-4 py-3 flex flex-col gap-2" data-reset-level="chat">
          <div className="flex items-center gap-2">
            <span className="text-sm font-sans font-bold text-white">Clear the chat</span>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-[12px] font-sans font-semibold text-neutrals-light hover:border-brand-vivid/50 hover:text-white cursor-pointer disabled:opacity-40"
              disabled={busy}
              onClick={() => typeof onClearChat === "function" && onClearChat()}
              data-reset-action="chat"
            >
              <RiChatDeleteLine size={14} /> Clear the chat
            </button>
          </div>
          <p className="text-[12px] font-sans text-neutrals-medium leading-snug">The chat, the traces and the stats. The workspace, the IDE and the selected demo stay as they are.</p>
        </section>

        <section className="rounded-xl border border-brand-vivid/30 bg-brand-vivid/5 px-4 py-3 flex flex-col gap-2.5" data-reset-level="environment">
          <div className="flex items-center gap-2">
            <span className="text-sm font-sans font-bold text-white">Reset the demo environment</span>
            <span className={`${CHIP} ml-auto ${bridgeUp === null ? MUTED : bridgeUp ? GOOD : WARN}`}>{bridgeUp === null ? "checking the IDE…" : bridgeUp ? "bridge active" : "bridge offline"}</span>
          </div>
          <p className="text-[12px] font-sans text-neutrals-light leading-snug">A clean slate for the next demo.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-sans font-bold uppercase tracking-[0.16em] text-brand-vivid mb-1">Resets</div>
              <ul className={LIST}>
                <li>The workspace repository, rebuilt from the seed: applied changes, new files, records and any stray commit removed; any other file in the workspace removed</li>
                <li>The IDE&apos;s editors, diffs, terminals and test panel</li>
                <li>The chat, traces and stats; no demo selected</li>
                <li>Thinking back to on; all documents in scope</li>
              </ul>
            </div>
            <div>
              <div className="text-[10px] font-sans font-bold uppercase tracking-[0.16em] text-teal-300 mb-1 inline-flex items-center gap-1">
                <RiShieldCheckLine size={11} /> Keeps
              </div>
              <ul className={LIST}>
                <li>The documents and the vector store: nothing is re-ingested</li>
                <li>The admin settings and the model endpoints</li>
                <li>The IDE&apos;s own settings</li>
                <li>The run log&apos;s history: a reset marker restarts every demo at step 1</li>
              </ul>
            </div>
          </div>
          {bridgeUp === false && <div className="text-[12px] font-sans text-amber-400">Open the IDE panel first: the reset runs through the bridge in the IDE window.</div>}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-sans text-amber-400">Type RESET to confirm:</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              className="w-24 py-1 px-2 rounded-md border border-white/15 bg-black/40 text-[12px] text-white font-mono outline-none focus:border-brand-vivid"
              aria-label="Type RESET to reset the demo environment"
            />
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-vivid text-white text-[12px] font-sans font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              disabled={!typedOk || bridgeUp !== true || busy}
              onClick={resetEnvironment}
              data-reset-action="environment"
            >
              {busy ? <RiLoader4Line size={14} className="animate-spin" /> : <RiRestartLine size={14} />} Reset the environment
            </button>
          </div>
          {message && (
            <span className={`${CHIP} self-start whitespace-normal ${message.tone === "good" ? GOOD : BAD}`}>
              {message.tone === "good" ? <RiCheckLine size={11} /> : null} {message.text}
            </span>
          )}
        </section>
      </div>
    </div>
  );
}
