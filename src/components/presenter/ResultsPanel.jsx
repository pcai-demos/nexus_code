"use client";

/**
 * ResultsPanel — the completed demo's results, full size, for the room (PR B; the owner's asks and D1 (b), D2, D3 of
 * 2026-10-07). An overlay over the workbench (the sidebar and the IDE column stay), opened by the presenter only: the
 * sidebar's Results icon, the step bar's NEXT after Record ("Show the results"), or the chip on the chat's record line.
 *
 * Left: the archived evidence records, newest first (this demo's, or every demo's), and any other Markdown or JSON output
 * of the demos. Right, for a record: Report (RecordReport: the outcome, what happened, the rules quoted, tests, files),
 * Code change (DiffView: the change against the seed, line by line), As filed (the record's Markdown, formatted). Any
 * other output: Markdown formatted (MarkdownBlocks) or JSON as readable tables (JsonView). This component does its own
 * fetching (the scenarios route's records / record-read / outputs / output-read actions, all read-only).
 *
 * S4 (the closer, 2026-10-12): a request may ask for every demo's records (`scope: "all"`), so the record another demo
 * wrote, or the shipped example record at the end of that list, is shown selected; an answer record and the example are
 * marked as such in the list.
 */
import React, { useCallback, useEffect, useState } from "react";
import { RiFileChartLine, RiCloseLine, RiRefreshLine, RiLoader4Line, RiFileShield2Line, RiArticleLine, RiBracesLine } from "@remixicon/react";
import { usePresenter } from "@/context/PresenterContext";
import { revealInIde } from "@/lib/coding/ide_client";
import RecordReport from "./RecordReport";
import DiffView from "./DiffView";
import JsonView from "./JsonView";
import MarkdownBlocks from "./MarkdownBlocks";

const API = "/api/ide-bridge/scenarios";
const CHIP = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border";
const MUTED = "bg-white/5 text-neutrals-medium border-white/10";
const GOOD = "bg-teal-500/15 text-teal-300 border-teal-500/25";
const BAD = "bg-red-500/15 text-red-300 border-red-500/25";
const WARN = "bg-amber-500/15 text-amber-300 border-amber-500/25";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};

async function post(body) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`the scenarios route answered HTTP ${res.status}`);
  return json;
}

export default function ResultsPanel({ open = false, request = null, activeDemoId = null, onClose }) {
  const presenter = usePresenter();
  const [records, setRecords] = useState([]);
  const [outputs, setOutputs] = useState([]);
  const [scope, setScope] = useState("demo");
  const [selected, setSelected] = useState(null); // { kind: "record", id } | { kind: "output", path }
  const [doc, setDoc] = useState(null); // the loaded record or output
  const [tab, setTab] = useState("report");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ideNote, setIdeNote] = useState(null);
  const [applied, setApplied] = useState(null);

  // The request that opened the panel (a record id, a demo): applied once per request, during render.
  if (request !== applied) {
    setApplied(request);
    if (request) {
      setSelected(request.recordId ? { kind: "record", id: request.recordId } : null);
      setTab("report");
      setScope(request.scope === "all" ? "all" : request.scenarioId || activeDemoId ? "demo" : "all");
    }
  }

  const demoFilter = scope === "demo" ? (request && request.scenarioId) || activeDemoId || null : null;

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const [r, o] = await Promise.all([post({ action: "records", ...(demoFilter ? { scenarioId: demoFilter } : {}) }), post({ action: "outputs" })]);
      const list = r && Array.isArray(r.records) ? r.records : [];
      setRecords(list);
      setOutputs(o && Array.isArray(o.outputs) ? o.outputs : []);
      setError(r && r.success === false ? r.error : null);
      setSelected((prev) => prev || (list[0] ? { kind: "record", id: list[0].id } : null));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [demoFilter]);

  useEffect(() => {
    if (!open) return undefined;
    loadList();
    const onKey = (e) => {
      if (e.key === "Escape" && typeof onClose === "function") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // re-read when the panel opens or the demo filter changes; onClose is the page's setter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadList]);

  useEffect(() => {
    if (!open || !selected) return undefined;
    let cancelled = false;
    const body = selected.kind === "record" ? { action: "record-read", id: selected.id } : { action: "output-read", path: selected.path };
    post(body)
      .then((r) => {
        if (cancelled) return;
        if (r && r.success) setDoc({ ...r, kind: selected.kind });
        else setDoc({ kind: "error", error: (r && r.error) || "the result could not be read" });
      })
      .catch((err) => {
        if (!cancelled) setDoc({ kind: "error", error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [open, selected]);

  if (!open) return null;

  const record = doc && doc.kind === "record" ? doc.json : null;
  const openPassage = (r) =>
    presenter.openPassages({
      passages: [{ marker: r.marker, pillar: r.layer, source: r.source, page: r.page, sectionPath: r.sectionPath, text: r.text }],
      scenario: record && record.scenario ? { id: record.scenario.id } : null,
    });
  const openInIde = async (f) => {
    const h = Array.isArray(f.hunks) && f.hunks.length ? f.hunks[0] : null;
    const startLine = h ? Math.max(1, h.newStart) : 1;
    const endLine = h ? Math.max(startLine, h.newStart + Math.max(0, h.newLines - 1)) : 1;
    setIdeNote({ tone: "muted", text: `opening ${f.path.split("/").pop()} in the IDE…` });
    const r = await revealInIde({ path: f.path, startLine, endLine });
    setIdeNote(r && r.success ? { tone: "good", text: `${f.path.split("/").pop()} is open in the IDE` } : { tone: "bad", text: (r && r.error) || "the IDE did not open it" });
  };
  const tabButton = (id, label, Icon) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[12px] font-sans font-bold uppercase tracking-widest transition-all cursor-pointer ${tab === id ? "bg-brand-vivid/15 text-brand-vivid border border-brand-vivid/30" : "text-neutrals-medium border border-transparent hover:text-white hover:bg-white/5"}`}
      aria-pressed={tab === id}
      data-results-tab={id}
    >
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <div className="fixed top-20 left-20 right-0 bottom-0 z-50 flex flex-col bg-[#0A0A0A]/97 backdrop-blur-xl text-white" role="dialog" aria-modal="true" aria-label="Results panel" data-results-panel="true">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-white/10 shrink-0 flex-wrap">
        <RiFileChartLine size={18} className="text-brand-vivid" />
        <span className="text-xs font-sans font-bold uppercase tracking-widest text-neutrals-light">Results</span>
        {record && (
          <div className="flex items-center gap-1 ml-4">
            {tabButton("report", "Report", RiFileShield2Line)}
            {record.kind !== "answer" && tabButton("code", "Code change", RiBracesLine)}
            {tabButton("filed", "As filed", RiArticleLine)}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {ideNote && <span className={`${CHIP} ${ideNote.tone === "good" ? GOOD : ideNote.tone === "bad" ? BAD : MUTED}`}>{ideNote.text}</span>}
          {loading && <RiLoader4Line size={14} className="animate-spin text-brand-vivid" />}
          <button type="button" onClick={loadList} className="p-1.5 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 cursor-pointer" title="Re-read the results">
            <RiRefreshLine size={16} />
          </button>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 cursor-pointer" title="Close (Escape)" aria-label="Close the Results panel">
            <RiCloseLine size={18} />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 grid grid-cols-12">
        <aside className="col-span-4 xl:col-span-3 border-r border-white/10 overflow-auto custom-scrollbar px-4 py-4 flex flex-col gap-3" data-results-list="true">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-sans font-bold uppercase tracking-[0.18em] text-neutrals-medium">Runs</span>
            <button type="button" className="ml-auto text-[11px] font-sans text-neutrals-medium hover:text-white underline cursor-pointer" onClick={() => setScope(scope === "demo" ? "all" : "demo")}>
              {scope === "demo" ? "every demo" : "this demo only"}
            </button>
          </div>
          {records.length === 0 && !loading && <div className="text-[13px] font-sans text-neutrals-medium">{error ? `The results could not be read: ${error}` : "No results yet: run a demo to its Record step."}</div>}
          {records.map((r) => {
            const active = selected && selected.kind === "record" && selected.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setSelected({ kind: "record", id: r.id });
                  setTab("report");
                }}
                className={`text-left rounded-xl border px-3 py-2.5 transition-all cursor-pointer ${active ? "border-brand-vivid/50 bg-brand-vivid/10" : "border-white/10 bg-white/2 hover:border-white/30"}`}
                data-record-item={r.id}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[12px] font-sans font-bold text-white">{r.scenario ? `${String(r.scenario.id).toUpperCase()} · ${r.scenario.title}` : r.id}</span>
                </div>
                <div className="text-[11px] font-mono text-neutrals-medium mt-0.5">
                  {when(r.createdAt)} · record {r.id}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                  {r.example && <span className={`${CHIP} ${WARN}`} data-record-example="true">example</span>}
                  {r.kind === "answer" ? (
                    <span className={`${CHIP} ${GOOD}`} data-record-kind="answer">an answer · no code changed</span>
                  ) : (
                    <>
                      <span className={`${CHIP} ${!r.tests ? WARN : r.tests.exitCode === 0 ? GOOD : BAD}`}>{r.tests ? r.tests.summary || `exit ${r.tests.exitCode}` : "no tests"}</span>
                      <span className={`${CHIP} ${MUTED}`}>
                        {r.files.count} file{r.files.count === 1 ? "" : "s"} · +{r.files.added} -{r.files.removed}
                      </span>
                    </>
                  )}
                  <span className={`${CHIP} ${MUTED}`}>{r.rules} rule{r.rules === 1 ? "" : "s"}</span>
                  {r.commit && (
                    <span className={`${CHIP} ${GOOD}`} data-record-commit={r.commit.commit} title={`Committed on ${r.commit.branch} in the Bank's repository`}>
                      committed {String(r.commit.commit).slice(0, 7)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {outputs.length > 0 && (
            <>
              <span className="text-[11px] font-sans font-bold uppercase tracking-[0.18em] text-neutrals-medium mt-3">Other outputs</span>
              {outputs.map((o) => (
                <button
                  key={o.path}
                  type="button"
                  onClick={() => setSelected({ kind: "output", path: o.path })}
                  className={`text-left rounded-xl border px-3 py-2 text-[12px] font-mono cursor-pointer ${selected && selected.kind === "output" && selected.path === o.path ? "border-brand-vivid/50 bg-brand-vivid/10 text-white" : "border-white/10 bg-white/2 text-neutrals-light hover:border-white/30"}`}
                >
                  {o.kind === "json" ? <RiBracesLine size={12} className="inline mr-1" /> : <RiArticleLine size={12} className="inline mr-1" />}
                  {o.path.replace(/^nexus-payments\//, "")}
                </button>
              ))}
            </>
          )}
        </aside>
        <main className="col-span-8 xl:col-span-9 overflow-auto custom-scrollbar px-8 py-6 min-h-0" data-results-view={doc ? doc.kind : "none"}>
          {!doc ? (
            <div className="text-sm font-sans text-neutrals-medium">{selected ? "Reading…" : "Choose a run on the left."}</div>
          ) : doc.kind === "error" ? (
            <div className="text-sm font-sans text-red-300">{doc.error}</div>
          ) : doc.kind === "record" ? (
            tab === "report" ? (
              <RecordReport record={record} onShowCode={() => setTab("code")} onOpenPassage={openPassage} onOpenInIde={openInIde} />
            ) : tab === "code" ? (
              <div className="flex flex-col gap-4">
                <h2 className="text-xl font-bold text-white">The code change against the seed</h2>
                <DiffView files={record.changes && Array.isArray(record.changes.files) ? record.changes.files : []} onOpenInIde={openInIde} />
              </div>
            ) : doc.markdown ? (
              <MarkdownBlocks text={doc.markdown} />
            ) : (
              <JsonView value={record} />
            )
          ) : doc.kind === "output" && doc.text !== undefined ? (
            doc.path && doc.path.toLowerCase().endsWith(".json") ? (
              (() => {
                try {
                  return <JsonView value={JSON.parse(doc.text)} />;
                } catch {
                  return <pre className="text-[12px] font-mono text-neutrals-light whitespace-pre-wrap">{doc.text}</pre>;
                }
              })()
            ) : (
              <MarkdownBlocks text={doc.text} />
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}
