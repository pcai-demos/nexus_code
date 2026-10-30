"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { figureSuffix } from "@/lib/ingestion/outcomes";
import {
  RiCloseLine,
  RiGitRepositoryFill,
  RiFileTextLine,
  RiFilePdf2Line,
  RiMarkdownLine,
  RiLoader4Line,
  RiDeleteBinLine,
  RiFileList3Line
} from "@remixicon/react";

export default function StandardsDrawer({ isOpen, onClose, loadedFiles, setLoadedFiles, ingestionProgress, weaviateUrl, token, weaviateCollection, schemaVersion, onPreviewDocument = null }) {
  const [previewFile, setPreviewFile] = useState(null);
  const [previewContent, setPreviewContent] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Tidy Up confirmation (ticket T21, F-15). The collection this drawer will
  // name in every destructive request — the server refuses to default, so it
  // is resolved once here and shown to the person confirming.
  const targetCollection = weaviateCollection || "RAGChunk";
  // Cut-over (design D2, finding F-62): the schema version the browser runs
  // under (ragSettings.schemaVersion, forwarded by page.js) rides on every
  // destructive request, so unload / preview / clear resolve the SAME class
  // the chat path reads. Absent, the server's default applies — the same
  // rule as ingest. Sent only when present so a browser without an override
  // sends exactly what it sent before.
  const versionField = schemaVersion !== undefined && schemaVersion !== null ? { schemaVersion } : {};
  const [tidyUpOpen, setTidyUpOpen] = useState(false);
  // Review §11b (R1 / R3): the (name, version) the dialog was opened for,
  // SNAPSHOTTED at open and sent unchanged by both the preview and the drop —
  // the props can move under an open dialog (the admin panel owns
  // ragSettings), and the typed guard compares against the preview's
  // resolved class, so the drop must name exactly what the preview named.
  const [tidyUpTarget, setTidyUpTarget] = useState(null);
  const [typedCollection, setTypedCollection] = useState("");
  const [tidyUpPreview, setTidyUpPreview] = useState(null);
  const [tidyUpPreviewError, setTidyUpPreviewError] = useState(null);
  const [tidyUpBusy, setTidyUpBusy] = useState(false);
  const [tidyUpError, setTidyUpError] = useState(null);
  // Preview requests are sequenced so a slow response from a cancelled dialog
  // cannot overwrite the counts of a newer one.
  const previewSeq = useRef(0);

  // Sync active preview if selected file is deleted
  useEffect(() => {
    if (previewFile && !loadedFiles.some((f) => f.path === previewFile.path)) {
      setPreviewFile(null);
      setPreviewContent("");
    }
  }, [loadedFiles, previewFile]);

  // Handle single click to preview and present documents
  const handleFileClick = async (file) => {
    setPreviewFile(file);
    setPreviewContent("");
    // T15 (design D11): the tray knows what the user is looking at — a
    // previewed document becomes the chat's document scope until cleared.
    if (typeof onPreviewDocument === "function" && file && file.name) onPreviewDocument(file.name);

    if (file.extension === ".pdf") {
      // PDF is handled via native iframe embed
      return;
    }

    try {
      setLoadingPreview(true);
      const res = await fetch(file.path);
      const text = await res.text();
      setPreviewContent(text);
    } catch (err) {
      setPreviewContent(`Failed to read file contents:\n${err.message}`);
    } finally {
      setLoadingPreview(false);
    }
  };

  // Remove one document's chunks from the collection, then from the tray.
  // The tray entry goes only AFTER the server confirms (T21): before, it was
  // removed optimistically, so a refused delete left the UI claiming the
  // document was gone while its chunks were still being retrieved.
  const handleRemoveFile = async (path, e) => {
    e.stopPropagation();

    try {
      const res = await fetch("/api/ingest/unload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: path,
          weaviateUrl,
          token,
          // Named explicitly; the server 400s (COLLECTION_REQUIRED) without it.
          weaviateCollection: targetCollection,
          ...versionField
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        console.error(`[Unload] ${data.code || res.status}: ${data.error || "unload failed"} (${path} kept in the tray)`);
        return;
      }
      setLoadedFiles((prev) => prev.filter((f) => f.path !== path));
      console.log(`[Unload] Chunks for ${path} deleted from '${data.collection || targetCollection}'.`);
    } catch (err) {
      console.error(`Failed to unload file ${path} from Weaviate:`, err);
    }
  };

  // Tidy Up RAG, step 1: open the typed-confirmation dialog and fetch a
  // read-only preview of what the drop would do. Nothing destructive happens
  // here. (Before T21 this button dropped the collection on a single click
  // with no confirmation — F-15.)
  const handleClearAllFiles = async () => {
    setTypedCollection("");
    setTidyUpPreview(null);
    setTidyUpPreviewError(null);
    setTidyUpError(null);
    const target = { weaviateCollection: targetCollection, ...versionField };
    setTidyUpTarget(target);
    setTidyUpOpen(true);
    const mine = ++previewSeq.current;

    try {
      const res = await fetch("/api/ingest/clear/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weaviateUrl,
          token,
          mlisToken: token,
          ...target
        })
      });
      const data = await res.json().catch(() => ({}));
      if (mine !== previewSeq.current) return;
      if (!res.ok || data.success === false) {
        setTidyUpPreviewError(`${data.code || res.status}: ${data.error || "preview failed"}`);
        return;
      }
      setTidyUpPreview(data);
    } catch (err) {
      if (mine !== previewSeq.current) return;
      setTidyUpPreviewError(err.message);
    }
  };

  // While the confirmation is open, the drawer itself must not close — its
  // header X and backdrop are still reachable by keyboard behind the dialog,
  // and unmounting mid-drop would discard the typed failure text.
  const guardedClose = () => {
    if (tidyUpOpen) return;
    onClose();
  };

  const closeTidyUp = () => {
    if (tidyUpBusy) return;
    setTidyUpOpen(false);
    setTypedCollection("");
    setTidyUpTarget(null);
  };

  // The class the drop will hit, as the read-only preview resolved it from
  // (name, version) — cut-over design D3. What is typed is what is dropped:
  // under the default that is `RAGChunkV2`, under a v1 override `RAGChunk`.
  // Until the preview has answered there is nothing to confirm against.
  const resolvedCollection = typeof tidyUpPreview?.collection === "string" ? tidyUpPreview.collection : null;
  // The one condition that makes the destructive request reachable: the
  // person typed the exact, case-sensitive class name shown to them.
  const tidyUpConfirmed = resolvedCollection !== null && typedCollection === resolvedCollection;

  // Tidy Up RAG, step 2: the destructive request. Reachable only through the
  // dialog's confirm button, which is disabled until tidyUpConfirmed; the
  // guard is repeated here so no other path can call it.
  const performTidyUp = async () => {
    if (!tidyUpConfirmed || tidyUpBusy || !tidyUpTarget) return;
    setTidyUpBusy(true);
    setTidyUpError(null);

    try {
      const res = await fetch("/api/ingest/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weaviateUrl,
          token,
          mlisToken: token,
          // The snapshot the preview was taken for, plus the class the person
          // typed: the server refuses (400 CONFIRM_MISMATCH) if that is not
          // the class it resolves — what is typed is what is dropped (D3).
          ...tidyUpTarget,
          confirmCollection: resolvedCollection
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        // Typed failure (T21 D7). Only the route's own shape can vouch for what
        // did not happen: a gateway error or a non-JSON body may have arrived
        // while the server was still completing the drop, so say "not known".
        let done;
        if (Array.isArray(data.completed)) {
          done = data.completed.length > 0
            ? ` Steps that did complete: ${data.completed.join(", ")}.`
            : " Nothing was dropped.";
        } else {
          done = " Nothing is known to have been dropped.";
        }
        setTidyUpError(`${data.code || res.status}: ${data.error || "tidy up failed"}${done}`);
        return;
      }
      if (typeof data.collection === "string" && data.collection !== resolvedCollection) {
        // The drop happened; say what was dropped rather than what was typed.
        setTidyUpError(`The server reports it dropped '${data.collection}', not '${resolvedCollection}'. Steps completed: ${(data.completed || []).join(", ")}.`);
        return;
      }
      setLoadedFiles([]);
      setPreviewFile(null);
      setPreviewContent("");
      setTidyUpOpen(false);
      setTypedCollection("");
      setTidyUpTarget(null);
      console.log(`[Tidy Up] ${data.message}`);
    } catch (err) {
      setTidyUpError(`Request failed: ${err.message}. Nothing is known to have been dropped.`);
    } finally {
      setTidyUpBusy(false);
    }
  };

  // Simple Markdown Parser
  const renderMarkdown = (text) => {
    const lines = text.split("\n");
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      
      // Headers
      if (trimmed.startsWith("# ")) {
        return <h1 key={idx} className="text-sm font-sans font-bold text-white uppercase tracking-wider mt-4 mb-2 border-b border-white/10 pb-1">{trimmed.slice(2)}</h1>;
      }
      if (trimmed.startsWith("## ")) {
        return <h2 key={idx} className="text-xs font-sans font-semibold text-brand-vivid uppercase mt-3 mb-1.5">{trimmed.slice(3)}</h2>;
      }
      if (trimmed.startsWith("### ")) {
        return <h3 key={idx} className="text-xs font-sans font-medium text-purple-400 mt-2 mb-1">{trimmed.slice(4)}</h3>;
      }

      // Bullet points
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        return <li key={idx} className="text-[11px] font-sans text-neutrals-light ml-4 list-disc leading-relaxed my-0.5">{trimmed.slice(2)}</li>;
      }

      // Empty line
      if (trimmed === "") {
        return <div key={idx} className="h-2" />;
      }

      // Default paragraph
      return <p key={idx} className="text-[11px] font-sans text-neutrals-light leading-relaxed my-1">{line}</p>;
    });
  };

  // Get file icon based on extension
  const getFileIcon = (file, size = 18) => {
    if (file.extension === ".pdf") {
      return <RiFilePdf2Line size={size} className="text-rose-400" />;
    }
    if (file.extension === ".md") {
      return <RiMarkdownLine size={size} className="text-purple-400" />;
    }
    return <RiFileTextLine size={size} className="text-blue-400" />;
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ scale: 0.97, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.97, opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 pl-20 flex bg-black/35 backdrop-blur-sm justify-center items-center p-8 overflow-y-auto"
      onClick={guardedClose}
    >
      {tidyUpOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeTidyUp(); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeTidyUp();
            if (e.key === "Enter" && e.target.tagName === "INPUT" && tidyUpConfirmed) performTidyUp();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tidyup-title"
            className="w-full max-w-lg rounded-2xl border border-rose-500/40 bg-[#141414] text-white shadow-[0_8px_32px_rgba(0,0,0,0.6)] p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="tidyup-title" className="text-sm font-sans font-bold uppercase tracking-[1.2px] text-rose-300">
              Drop collection &lsquo;{resolvedCollection ?? "…"}&rsquo;?
            </h3>

            <p className="text-xs font-sans text-neutrals-light leading-relaxed">
              This cannot be undone. Tidy Up RAG will:
            </p>
            <ul className="text-xs font-sans text-neutrals-light leading-relaxed list-disc pl-5 flex flex-col gap-1">
              <li>
                Drop the Weaviate collection <span className="font-mono text-white">{resolvedCollection ?? "…"}</span> and recreate it empty
                {tidyUpPreview && tidyUpPreview.objectCount !== null ? (
                  <> — currently <strong className="text-white">{tidyUpPreview.objectCount}</strong> chunks
                  {tidyUpPreview.sourceCount !== null ? <> from <strong className="text-white">{tidyUpPreview.sourceCount}</strong> documents</> : null}.</>
                ) : tidyUpPreview || tidyUpPreviewError ? (
                  <> — <strong className="text-amber-300">object count unknown</strong>
                  {(tidyUpPreview?.countError || tidyUpPreviewError) ? <span className="text-neutrals-medium"> ({tidyUpPreview?.countError || tidyUpPreviewError})</span> : null}.</>
                ) : (
                  <> — <span className="text-neutrals-medium">counting…</span></>
                )}
              </li>
              <li>
                Delete the extracted diagram crops under <span className="font-mono">public/extracted_images</span> that only this collection uses
                {tidyUpPreview ? <> (<strong className="text-white">{tidyUpPreview.extractedImageDirs}</strong> document folders; crops another collection still cites are kept)</> : null}.
              </li>
              <li>Reset the ingestion progress tracker.</li>
            </ul>

            <label className="text-[10px] font-sans font-bold uppercase tracking-wider text-neutrals-medium flex flex-col gap-1.5">
              Type <span className="font-mono normal-case text-white">{resolvedCollection ?? "…"}</span> to confirm
              <input
                type="text"
                autoFocus
                value={typedCollection}
                onChange={(e) => setTypedCollection(e.target.value)}
                placeholder={resolvedCollection ?? "waiting for the preview…"}
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-sm font-mono text-white placeholder:text-white/20 outline-none focus:border-rose-400/60"
              />
            </label>

            {tidyUpError && (
              <div className="text-xs font-sans text-rose-300 leading-relaxed whitespace-pre-wrap border border-rose-500/30 bg-rose-500/10 rounded-lg p-3">
                {tidyUpError}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-1">
              <button
                type="button"
                onClick={closeTidyUp}
                disabled={tidyUpBusy}
                className="px-4 py-2 rounded-full text-[10px] font-sans font-bold uppercase tracking-wider border border-white/15 bg-white/5 text-neutrals-light hover:bg-white/10 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performTidyUp}
                disabled={!tidyUpConfirmed || tidyUpBusy}
                className="px-4 py-2 rounded-full text-[10px] font-sans font-bold uppercase tracking-wider border border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {tidyUpBusy ? "Dropping…" : `Drop ${resolvedCollection ?? "…"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="w-full max-w-7xl rounded-2xl border border-white/12 flex flex-col h-[90vh] shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden text-white bg-[#121212]/85 backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/10 flex justify-between items-center bg-white/2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#A855F7]/10 border border-[#A855F7]/20 flex items-center justify-center text-[#A855F7]">
              <RiGitRepositoryFill size={16} />
            </div>
            <div>
              <h2 className="text-white text-xs md:text-sm font-sans font-bold uppercase tracking-[1.5px]">
                Corporate Standards & Docs
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={guardedClose}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neutrals-medium hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          >
            <RiCloseLine size={16} />
          </button>
        </div>

        {/* Content Body - Split Screen layout */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Panel: Imported Files Tray (30% width) */}
          <div className="w-[30%] flex flex-col h-full bg-[#141414]/40 p-4 border-r border-white/10 overflow-y-auto custom-scrollbar">
            <h3 className="text-[10px] font-sans font-bold uppercase tracking-[1.2px] text-neutrals-medium mb-3 pb-1 border-b border-white/5 flex justify-between items-center">
              <span>Active Presentation Tray ({loadedFiles.length} files)</span>
              {/* Always rendered (T21): the tray is per-page-load memory, not a
                  mirror of the store, so after a reload it is empty while the
                  collection is not — and since session reset no longer drops
                  anything, this button is the only confirmed drop path. */}
              <button
                type="button"
                onClick={handleClearAllFiles}
                className="text-[9px] font-sans text-rose-400 hover:text-rose-300 font-bold uppercase tracking-wider cursor-pointer border-none bg-transparent outline-none"
              >
                Tidy Up RAG
              </button>
            </h3>

            {ingestionProgress && (
              <div className="mb-6 p-5 rounded-2xl border border-purple-500/30 bg-[#0F0F10]/95 backdrop-blur-md flex flex-col gap-3.5 shadow-lg">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-purple-300 uppercase tracking-wider flex items-center gap-2">
                    {ingestionProgress.status === "processing" && (
                      <RiLoader4Line className="animate-spin text-purple-400" size={14} />
                    )}
                    {ingestionProgress.status === "completed" && "Ingestion Done"}
                    {ingestionProgress.status === "partial" && "Ingestion Partial"}
                    {ingestionProgress.status === "error" && "Ingestion Error"}
                    {ingestionProgress.status === "cancelled" && "Ingestion Cancelled"}
                    {ingestionProgress.status === "interrupted" && "Ingestion Interrupted"}
                    {ingestionProgress.status === "processing" && (ingestionProgress.cancelled ? "Cancelling..." : "Indexing Vector DB...")}
                  </span>
                  <span className="font-mono text-purple-400 font-extrabold text-sm">{ingestionProgress.progressPercent || 0}%</span>
                </div>

                {ingestionProgress.status === "processing" && (
                  <div className="text-xs text-neutrals-light leading-relaxed truncate">
                    Ingesting: <span className="text-white font-mono font-medium">{ingestionProgress.currentFile}</span>
                  </div>
                )}

                {(ingestionProgress.status === "error" || ingestionProgress.status === "partial") && ingestionProgress.error && (
                  <div className={`text-xs font-semibold leading-relaxed whitespace-pre-wrap ${ingestionProgress.status === "error" ? "text-rose-400" : "text-amber-300"}`}>
                    {ingestionProgress.error}
                  </div>
                )}

                {/* T07 (F-49 / E16, design D9): every input file, its outcome and
                    the reason — a skipped, failed, partial or empty file is no
                    longer a completed job with "Chunks: 0". */}
                {Array.isArray(ingestionProgress.fileResults) && ingestionProgress.fileResults.length > 0 && (
                  <ul className="flex flex-col gap-1 text-[10px] font-mono text-neutrals-light max-h-40 overflow-y-auto" data-testid="ingest-file-results">
                    {ingestionProgress.fileResults.map((f) => (
                      <li key={f.filePath || f.fileName} className="flex justify-between gap-2">
                        <span className="truncate" title={f.filePath || f.fileName}>{f.fileName}</span>
                        <span className={`shrink-0 ${f.status === "indexed" ? "text-emerald-300" : f.status === "skipped" ? "text-neutrals-medium" : f.status === "failed" || f.status === "partial" || f.status === "empty" || f.status === "cancelled" ? "text-rose-300" : "text-purple-300"}`} title={f.error || f.supersedeError || f.reason || ""}>
                          {f.status}
                          {f.status === "indexed" && f.counts ? ` · ${f.counts.chunksInserted} chunks` : ""}
                          {f.status === "partial" && f.counts ? ` · ${f.counts.chunksInserted}/${f.counts.chunksEmitted}` : ""}
                          {/* T24 (design D13) / T29 / T31 (design D7): the figure outcomes, when the parse counted them — one wording for both views */}
                          {figureSuffix(f)}
                          {f.status === "skipped" && f.reason ? ` · ${f.reason}` : ""}
                          {(f.status === "failed" || f.status === "empty") && (f.reason || f.error) ? ` · ${(f.reason || f.error).slice(0, 80)}` : ""}
                          {f.supersedeError ? " · previous versions not removed" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Progress bar wrapper */}
                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
                  <div
                    className={`h-full transition-all duration-300 ${ingestionProgress.status === 'error' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]' : 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]'}`}
                    style={{ width: `${ingestionProgress.progressPercent || 0}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-xs text-neutrals-medium font-mono mt-1">
                  <div className="flex gap-4">
                    <span>Chunks: <strong className="text-white font-mono font-bold text-xs">{ingestionProgress.chunksIndexed || 0}</strong></span>
                    {ingestionProgress.status === "processing" && (
                      <span>ETA: <strong className="text-white font-mono font-bold text-xs">{ingestionProgress.etaSeconds || 0}s</strong></span>
                    )}
                  </div>
                  {ingestionProgress.status === "processing" && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await fetch("/api/ingest/cancel", { method: "POST" });
                        } catch (err) {
                          console.error("Cancel failed:", err);
                        }
                      }}
                      className="px-3.5 py-1.5 rounded-full text-[10px] font-sans font-bold border border-rose-500/40 bg-rose-500/10 text-rose-300 shadow-[0_2px_8px_rgba(244,63,94,0.2),_inset_0_1px_1px_rgba(255,255,255,0.05)] hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer border-none outline-none"
                      disabled={Boolean(ingestionProgress.cancelled)}
                    >
                      {ingestionProgress.cancelled ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {loadedFiles.length === 0 ? (
              <div className="flex-1 flex flex-col justify-center items-center text-center p-6 text-neutrals-medium leading-relaxed">
                <RiFileList3Line size={32} className="text-white/20 mb-2" />
                <span className="text-xs font-sans">Tray is currently empty</span>
                <p className="text-[10px] font-sans text-neutrals-medium max-w-xs mt-1.5">
                  Use the **File Browser** (folder icon on the sidebar) to navigate and import guidelines or standards documents into this presenter view.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {loadedFiles.map((file) => {
                  const isPreviewed = previewFile?.path === file.path;
                  return (
                    <div
                      key={file.path}
                      onClick={() => handleFileClick(file)}
                      className={`group flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                        isPreviewed
                          ? "bg-[#A855F7]/10 border-[#A855F7]/30 text-white"
                          : "bg-white/2 border-white/5 hover:bg-white/4 hover:border-white/10 text-neutrals-light hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden flex-1">
                        <div className="flex-shrink-0">
                          {getFileIcon(file, 18)}
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-xs font-semibold truncate">
                            {file.name}
                          </span>
                          <span className="text-[9px] font-mono text-neutrals-medium mt-0.5">
                            {file.path.split("/").slice(-2, -1)[0]} • {(file.size / 1024).toFixed(1)} KB
                          </span>
                        </div>
                      </div>

                      {/* Remove from tray */}
                      <button
                        type="button"
                        onClick={(e) => handleRemoveFile(file.path, e)}
                        className="p-1.5 rounded-lg text-neutrals-medium hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer border-0 outline-none"
                      >
                        <RiDeleteBinLine size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Panel: Selection Previewer (70% width) */}
          <div className="w-[70%] flex flex-col h-full bg-black/30">
            {previewFile ? (
              <div className="flex flex-col h-full overflow-hidden">
                {/* Preview File Header */}
                <div className="px-5 py-3 border-b border-white/10 bg-white/2 flex justify-between items-center flex-shrink-0">
                  <div className="flex items-center gap-2 overflow-hidden">
                    {getFileIcon(previewFile, 24)}
                    <div className="flex flex-col overflow-hidden leading-none">
                      <span className="text-[11px] font-sans font-bold text-white truncate">{previewFile.name}</span>
                      <span className="text-[9px] font-mono text-neutrals-medium mt-0.5">
                        {previewFile.path}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Content Renderer */}
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-black/40">
                  {loadingPreview ? (
                    <div className="w-full h-full flex flex-col justify-center items-center text-neutrals-medium text-xs font-sans gap-2">
                      <RiLoader4Line size={20} className="animate-spin text-brand-vivid" />
                      Loading contents...
                    </div>
                  ) : previewFile.extension === ".pdf" ? (
                    <iframe
                      src={previewFile.path}
                      className="w-full h-full rounded-lg border border-white/10 bg-white"
                      title={previewFile.name}
                    />
                  ) : previewFile.extension === ".md" ? (
                    <div className="text-left font-sans text-neutrals-light space-y-1">
                      {renderMarkdown(previewContent)}
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-mono text-[10px] text-neutrals-light leading-relaxed bg-black/25 p-4 rounded-lg border border-white/5 overflow-auto">
                      {previewContent}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col justify-center items-center text-center p-6 text-neutrals-medium">
                <RiFileTextLine size={32} className="text-white/20 mb-2" />
                <span className="text-xs font-sans">No file selected for presentation</span>
                <p className="text-[10px] font-sans text-neutrals-medium max-w-xs mt-1.5 leading-relaxed">
                  Select a document from your active tray on the left to project its compliance or architectural details.
                </p>
              </div>
            )}
          </div>

        </div>

      </div>
    </motion.div>
  );
}
