"use client";

/**
 * DocumentViewer — the Documents section of the Demo panel (presenter panels design §2; decision D5 of 2026-10-07).
 *
 * The demo's documents grouped by the four layers of rules, each marked as in the store or not; the chosen one
 * rendered on the right: a PDF in the browser's viewer OPENED AT THE PAGE, a Markdown or text file as blocks. When the
 * panel was opened from an answer, that answer's cited passages come first; choosing one quotes its text above the
 * document opened at its page, so the room sees the element the answer relied on rather than a document to navigate.
 * A document renders only from the served path the server resolved (`catalogue[].path`); nothing here builds a path
 * from a name.
 *
 * PR B (the owner's D5 of 2026-10-07): the Documents panel uses the same viewer. A pseudo-layer "materials" (the demo's
 * non-code files, such as the ticket) can lead the list; `roles` says why each document matters to the demo; with no
 * demo selected the list opens on every document in the store.
 */
import React, { useEffect, useState } from "react";
import { RiFilePdf2Line, RiMarkdownLine, RiFileTextLine, RiExternalLinkLine, RiArrowLeftSLine, RiArrowRightSLine, RiCloseLine, RiDoubleQuotesL } from "@remixicon/react";
import MarkdownBlocks from "./MarkdownBlocks";

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
const TEXT_EXT = [".md", ".markdown", ".txt"];
const LABEL = "text-[11px] font-sans font-bold uppercase tracking-[0.18em] text-neutrals-medium";

function iconFor(ext, size = 14) {
  if (ext === ".pdf") return <RiFilePdf2Line size={size} className="text-rose-400 shrink-0" />;
  if (ext === ".md" || ext === ".markdown") return <RiMarkdownLine size={size} className="text-purple-400 shrink-0" />;
  return <RiFileTextLine size={size} className="text-blue-400 shrink-0" />;
}

/** The catalogue entry of a source name across the layers, with its layer, or null. */
function findDocument(layers, source) {
  for (const l of Array.isArray(layers) ? layers : []) {
    for (const d of Array.isArray(l.catalogue) ? l.catalogue : []) if (d.source === source) return { ...d, layerId: l.id, layerLabel: l.label, marker: l.marker };
  }
  return null;
}

export default function DocumentViewer({ layers = [], demoSources = [], passages = [], onClearPassages, roles = {}, defaultShowAll = false }) {
  const [manual, setManual] = useState(null); // { source } chosen from the list
  const [activeMarker, setActiveMarker] = useState(null); // the cited passage shown
  const [pageOverride, setPageOverride] = useState(null);
  const [showAll, setShowAll] = useState(defaultShowAll);
  const [seenPassages, setSeenPassages] = useState(null);
  const [text, setText] = useState({ path: null, body: null, error: null });

  // A new passage list (the panel was opened from an answer): show its first passage. State adjusted during render,
  // the documented pattern for a prop change, so no effect sets state.
  if (passages !== seenPassages) {
    setSeenPassages(passages);
    if (Array.isArray(passages) && passages.length > 0) {
      setActiveMarker(passages[0].marker);
      setManual(null);
      setPageOverride(null);
    }
  }

  const list = Array.isArray(passages) ? passages : [];
  const active = activeMarker ? list.find((p) => p.marker === activeMarker) || null : null;
  const doc = active ? findDocument(layers, active.source) : manual ? findDocument(layers, manual.source) : null;
  const page = pageOverride !== null ? pageOverride : active && active.page ? active.page : 1;
  const docPath = doc && doc.path ? doc.path : null;
  const isPdf = Boolean(doc && doc.ext === ".pdf");
  const isText = Boolean(doc && TEXT_EXT.includes(doc.ext));
  const used = new Set(Array.isArray(demoSources) ? demoSources : []);

  useEffect(() => {
    if (!docPath || !isText) return undefined;
    let cancelled = false;
    fetch(docPath)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body) => {
        if (!cancelled) setText({ path: docPath, body, error: null });
      })
      .catch((err) => {
        if (!cancelled) setText({ path: docPath, body: null, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [docPath, isText]);

  const choose = (d) => {
    setActiveMarker(null);
    setPageOverride(null);
    setManual({ source: d.source });
  };
  const choosePassage = (p) => {
    setActiveMarker(p.marker);
    setManual(null);
    setPageOverride(null);
  };
  const total = doc && Number.isFinite(doc.totalPages) && doc.totalPages > 0 ? doc.totalPages : null;
  const goTo = (n) => {
    const v = Math.max(1, total ? Math.min(total, n) : n);
    setPageOverride(v);
  };

  return (
    <div className="grid grid-cols-12 h-full min-h-0" data-document-viewer="true">
      <aside className="col-span-4 xl:col-span-3 border-r border-white/10 overflow-auto custom-scrollbar px-5 py-5 flex flex-col gap-5 min-h-0">
        <div className="flex items-center gap-2">
          <span className={LABEL}>Documents</span>
          {used.size > 0 && (
            <button type="button" className="ml-auto text-[11px] font-sans text-neutrals-medium hover:text-white underline cursor-pointer" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "this demo's documents" : "every document in the store"}
            </button>
          )}
        </div>
        {(Array.isArray(layers) ? layers : []).map((l) => {
          const catalogue = Array.isArray(l.catalogue) ? l.catalogue : [];
          const isMaterials = l.id === "materials";
          const rows = showAll || isMaterials ? catalogue : catalogue.filter((d) => used.has(d.source));
          return (
            <section key={l.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className={`${CHIP} ${LAYER_HUES[l.id] || MUTED}`}>{l.marker}</span>
                <span className="text-xs font-sans font-bold uppercase tracking-widest text-neutrals-light">{l.label}</span>
                <span className="ml-auto text-[11px] font-mono text-neutrals-medium" title={isMaterials ? "the demo's own files, from its repository" : `${l.documents} of ${l.expected} expected documents are in the store`}>
                  {isMaterials ? `${catalogue.length} file${catalogue.length === 1 ? "" : "s"}` : `${l.documents} in store`}
                </span>
              </div>
              {rows.length === 0 && <div className="text-[12px] font-sans text-neutrals-medium pl-1">{catalogue.length === 0 || l.documents === 0 ? "not in the store yet" : "none used by this demo"}</div>}
              {rows.map((d) => {
                const current = doc && doc.source === d.source;
                return (
                  <button
                    key={d.source}
                    type="button"
                    disabled={!d.path}
                    onClick={() => choose(d)}
                    title={d.path ? d.source : `${d.source}: not in the demo files folder, so it cannot be shown`}
                    className={`flex items-center gap-2 w-full text-left px-2.5 py-2 rounded-xl border text-[12px] font-sans transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${current ? "border-brand-vivid/50 bg-brand-vivid/10 text-white" : "border-white/10 bg-white/2 text-neutrals-light hover:border-white/30"}`}
                  >
                    {iconFor(d.ext)}
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="truncate">{d.source}</span>
                      {roles && roles[d.source] ? <span className="text-[11px] text-neutrals-medium leading-snug whitespace-normal">{roles[d.source]}</span> : null}
                    </span>
                    {used.has(d.source) && <span className="w-1.5 h-1.5 rounded-full bg-brand-vivid shrink-0" title="used by this demo" />}
                    {d.totalPages ? <span className="font-mono text-[10px] text-neutrals-medium shrink-0">{d.totalPages} p</span> : null}
                    {d.inStore === false && <span className={`${CHIP} ${WARN} shrink-0`}>not in store</span>}
                  </button>
                );
              })}
            </section>
          );
        })}
        {(!layers || layers.length === 0) && <div className="text-[12px] font-sans text-neutrals-medium">reading the store…</div>}
      </aside>

      <main className="col-span-8 xl:col-span-9 flex flex-col min-h-0">
        {list.length > 0 && (
          <div className="px-6 pt-4 flex flex-wrap items-center gap-1.5">
            <span className={LABEL}>Cited by the answer</span>
            {list.map((p) => (
              <button
                key={p.marker}
                type="button"
                onClick={() => choosePassage(p)}
                className={`${CHIP} cursor-pointer transition-all ${activeMarker === p.marker ? "bg-blue-500/25 text-white border-blue-400/60" : "bg-blue-500/10 text-blue-300 border-blue-500/25 hover:border-blue-400/60"}`}
                title={p.sectionPath ? `${p.source} · ${p.sectionPath}` : p.source}
              >
                {p.marker} · {p.source}
                {p.page ? ` · p.${p.page}` : ""}
              </button>
            ))}
            {typeof onClearPassages === "function" && (
              <button type="button" className="p-1 rounded-lg text-neutrals-medium hover:text-white cursor-pointer" title="Clear the cited passages" onClick={onClearPassages}>
                <RiCloseLine size={14} />
              </button>
            )}
          </div>
        )}
        {active && (
          <blockquote className="mx-6 mt-3 rounded-2xl border border-blue-500/25 bg-blue-500/5 px-5 py-4" data-cited-passage={active.marker}>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <RiDoubleQuotesL size={14} className="text-blue-300" />
              <span className={`${CHIP} bg-blue-500/15 text-blue-300 border-blue-500/25`}>{active.marker}</span>
              <span className="text-xs font-sans font-semibold text-white">{active.source}</span>
              {active.page ? <span className="text-xs font-mono text-neutrals-medium">page {active.page}</span> : null}
              {active.sectionPath ? <span className="text-xs font-mono text-neutrals-medium truncate" title={active.sectionPath}>§ {active.sectionPath}</span> : null}
              {Array.isArray(active.tracedFrom) && active.tracedFrom.length > 0 ? (
                <span className={`${CHIP} bg-blue-500/10 text-blue-300 border-blue-500/25`} title={active.via === "trace" ? "Looked up through the documents' own \"Traces to:\" lines, not searched" : "Found by the search, and on this finding's chain of rules"}>
                  traced from {active.tracedFrom.join(", ")}
                </span>
              ) : null}
              {!doc && <span className={`${CHIP} ${WARN}`}>the document is not in the demo files, so only its text is shown</span>}
            </div>
            <p className="text-[15px] leading-relaxed text-neutrals-light whitespace-pre-wrap font-sans max-h-44 overflow-auto custom-scrollbar">{active.text || "(the passage's text was not carried on this answer)"}</p>
          </blockquote>
        )}

        <div className="flex-1 min-h-0 flex flex-col px-6 py-4 gap-3">
          {!doc ? (
            <div className="flex-1 flex items-center justify-center text-center text-sm font-sans text-neutrals-medium border border-dashed border-white/10 rounded-2xl">
              {"Choose a document on the left, or open an answer's cited passages from the chat."}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {iconFor(doc.ext, 16)}
                <span className="text-sm font-sans font-bold text-white">{doc.source}</span>
                <span className={`${CHIP} ${LAYER_HUES[doc.layerId] || MUTED}`}>{doc.layerLabel}</span>
                {doc.layerId === "materials" ? (
                  <span className={`${CHIP} ${MUTED}`}>demo material</span>
                ) : doc.inStore ? (
                  <span className={`${CHIP} ${GOOD}`}>in the store{Number.isFinite(doc.chunkCount) ? ` · ${doc.chunkCount} chunks` : ""}</span>
                ) : (
                  <span className={`${CHIP} ${WARN}`}>not in the store</span>
                )}
                {isPdf && (
                  <span className="inline-flex items-center gap-1 ml-2">
                    <button type="button" className="p-1 rounded-lg text-neutrals-medium hover:text-white cursor-pointer disabled:opacity-40" disabled={page <= 1} onClick={() => goTo(page - 1)} title="Previous page">
                      <RiArrowLeftSLine size={16} />
                    </button>
                    <span className="text-[11px] font-mono text-neutrals-medium">page</span>
                    <input
                      type="number"
                      min={1}
                      max={total || undefined}
                      value={page}
                      onChange={(e) => goTo(Number(e.target.value) || 1)}
                      className="w-16 py-0.5 px-1.5 rounded-md border border-white/10 bg-black/40 text-[11px] text-white font-mono outline-none focus:border-brand-vivid"
                      aria-label="Page"
                    />
                    <span className="text-[11px] font-mono text-neutrals-medium">{total ? `of ${total}` : ""}</span>
                    <button type="button" className="p-1 rounded-lg text-neutrals-medium hover:text-white cursor-pointer disabled:opacity-40" disabled={Boolean(total) && page >= total} onClick={() => goTo(page + 1)} title="Next page">
                      <RiArrowRightSLine size={16} />
                    </button>
                  </span>
                )}
                {docPath && (
                  <a href={docPath} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] font-sans text-neutrals-medium hover:text-white">
                    Open in a new tab <RiExternalLinkLine size={12} />
                  </a>
                )}
              </div>
              <div className={`flex-1 min-h-0 rounded-2xl border border-white/10 overflow-hidden ${isPdf ? "bg-white" : "bg-[#0F0F10]"}`}>
                {!docPath ? (
                  <div className="h-full flex items-center justify-center text-sm font-sans text-neutrals-medium">This document is not in the demo files folder, so it cannot be shown here.</div>
                ) : isPdf ? (
                  <iframe key={`${docPath}#${page}`} src={`${docPath}#page=${page}&view=FitH`} title={doc.source} className="w-full h-full border-0" />
                ) : isText ? (
                  <div className="h-full overflow-auto custom-scrollbar px-8 py-6">
                    {text.path !== docPath ? <div className="text-sm text-neutrals-medium">Reading…</div> : text.error ? <div className="text-sm text-red-300">The document could not be read: {text.error}</div> : <MarkdownBlocks text={text.body || ""} />}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm font-sans text-neutrals-medium">No viewer for {doc.ext || "this file"}: open it in a new tab.</div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
