"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "@remixicon/react";
import { formatOffset, formatClock, formatSeconds, formatTokens } from "@/lib/rag/timing";

// Tooltip helper component matching application design system
function TracingTooltip({ text, isVisible }) {
  if (!isVisible || !text) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg border border-neutrals-dark/60 text-[11px] font-sans font-medium text-white whitespace-pre-line w-max max-w-[280px] leading-relaxed z-50 shadow-xl pointer-events-none"
      style={{
        background: "rgba(18, 18, 18, 0.95)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {text}
    </motion.div>
  );
}

export default function TracingDrawer({ isOpen, onClose, traceHistory = [] }) {
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(0); // 0 = Latest
  const [expandedTraceIds, setExpandedTraceIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(null);
  const [hoveredTooltip, setHoveredTooltip] = useState(null);

  // Helper to safely render Remixicon icons
  const renderIcon = (iconName, size = 18, className = "") => {
    const IconComp = Icons[iconName] || Icons.RiInformationLine;
    return <IconComp size={size} className={className} />;
  };

  // Reverse trace history so newest session turns appear first
  const turns = useMemo(() => {
    if (!traceHistory || traceHistory.length === 0) return [];
    return [...traceHistory].reverse();
  }, [traceHistory]);

  const activeTurn = turns[selectedTurnIndex] || turns[0] || null;

  // Filter traces by active category tab and text search
  const filteredTraces = useMemo(() => {
    if (!activeTurn || !activeTurn.traces) return [];
    
    return activeTurn.traces.filter((trace) => {
      // Category filter
      if (selectedCategory !== "ALL" && trace.category !== selectedCategory) {
        return false;
      }
      // Text search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = trace.title?.toLowerCase().includes(q);
        const descMatch = trace.description?.toLowerCase().includes(q);
        const badgeMatch = trace.badge?.toLowerCase().includes(q);
        const detailsMatch = JSON.stringify(trace.details || {}).toLowerCase().includes(q);
        return titleMatch || descMatch || badgeMatch || detailsMatch;
      }
      return true;
    });
  }, [activeTurn, selectedCategory, searchQuery]);

  // Toggle card expansion
  const toggleExpand = (id) => {
    const next = new Set(expandedTraceIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpandedTraceIds(next);
  };

  // Copy details JSON to clipboard
  const handleCopyDetails = (trace) => {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(JSON.stringify(trace.details || {}, null, 2));
      setCopiedId(trace.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Export session trace payload as JSON file
  const handleExportJSON = () => {
    if (!activeTurn) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeTurn, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `ai_context_trace_turn_${activeTurn.turnNumber || 1}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  if (!isOpen) return null;

  // Category Tabs metadata
  const categories = [
    { id: "ALL", label: "ALL SPANS", icon: "RiNodeTree", tooltip: "View all trace steps executed during this prompt turn" },
    { id: "task_classification", label: "TASK INTENT", icon: "RiBrainLine", tooltip: "Focus on task type detection and agent routing decisions" },
    { id: "docling_ingestion", label: "DOCLING LAYOUT AI", icon: "RiFileTextLine", tooltip: "Focus on IBM Docling layout parsing, Markdown table extraction, and fallback status" },
    { id: "rag_pipeline", label: "RAG PIPELINE", icon: "RiBookOpenLine", tooltip: "Focus on vector database retrieval, search weights, and reranking scores" },
    { id: "document_summary", label: "DOC STORE", icon: "RiBookOpenLine", tooltip: "Focus on indexed document files and vector database summaries" },
    { id: "ide_context", label: "IDE WORKSPACE", icon: "RiCodeSSlashLine", tooltip: "Focus on active file code context, selections, and file updates" },
    { id: "chat_history", label: "CHAT HISTORY", icon: "RiChatHistoryLine", tooltip: "Focus on multi-turn conversation memory passed to the prompt" },
    { id: "compliance_audit", label: "COMPLIANCE AUDIT", icon: "RiShieldCheckLine", tooltip: "Focus on regulatory rules audit checks and policy validations" },
    { id: "citation_audit", label: "CITATIONS", icon: "RiDoubleQuotesL", tooltip: "Focus on [S#] citation mapping and uncited page-claim detection" },
    { id: "llm_inference", label: "LLM INFERENCE", icon: "RiSparklingLine", tooltip: "Focus on final prompt payload, model endpoints, and response generation" },
    // Machinery PR 1 (design §8): the scenario panel's test runs and evidence records, each its own entry.
    { id: "test_run", label: "TESTS", icon: "RiTestTubeLine", tooltip: "Focus on test runs in the IDE container: command, exit code, output" },
    { id: "evidence_record", label: "EVIDENCE", icon: "RiFileShield2Line", tooltip: "Focus on evidence records built from the run log" },
  ];

  // Badge styling lookup
  const getBadgeStyle = (type) => {
    switch (type) {
      case "teal":
        return "bg-teal-500/10 text-teal-400 border-teal-500/30";
      case "purple":
        return "bg-purple-500/10 text-purple-400 border-purple-500/30";
      case "blue":
        return "bg-blue-500/10 text-blue-400 border-blue-500/30";
      case "red":
        return "bg-red-500/10 text-red-400 border-red-500/30";
      case "amber":
        return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      default:
        return "bg-neutral-800 text-neutral-300 border-neutral-700";
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8">
        {/* Backdrop overlay - Clicking outside closes the drawer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-md cursor-pointer"
        />

        {/* Modal Window Panel - 85% Width & Height */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()} // Prevent click-away when clicking inside panel
          className="relative w-[85vw] h-[85vh] bg-[#0D0D0D]/95 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-10"
          style={{
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
        >
          {/* Header Bar */}
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/40 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-neutrals-dark/40 border border-white/10 flex items-center justify-center text-[#BFBFBF] shadow-inner">
                {renderIcon("RiFootprintFill", 22)}
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                  AI Context Tracing & Reasoning Engine
                </h2>
                <p className="text-xs text-neutrals-medium font-sans">
                  Real-time breakdown of prompt execution steps, RAG vector retrieval, workspace context, and compliance logic.
                </p>
              </div>
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center gap-3">
              {/* Export Button */}
              {activeTurn && (
                <div className="relative">
                  <button
                    onClick={handleExportJSON}
                    onMouseEnter={() => setHoveredTooltip("hdr_export")}
                    onMouseLeave={() => setHoveredTooltip(null)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-neutrals-medium hover:text-white hover:bg-white/10 transition-all cursor-pointer outline-none"
                  >
                    {renderIcon("RiDownloadLine", 16)}
                    <span>EXPORT TRACE</span>
                  </button>
                  <TracingTooltip
                    text="Download the full JSON execution trace payload for this prompt turn"
                    isVisible={hoveredTooltip === "hdr_export"}
                  />
                </div>
              )}

              {/* Close Button */}
              <div className="relative">
                <button
                  onClick={onClose}
                  onMouseEnter={() => setHoveredTooltip("hdr_close")}
                  onMouseLeave={() => setHoveredTooltip(null)}
                  className="w-9 h-9 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-neutrals-medium hover:text-white hover:bg-white/10 transition-all cursor-pointer outline-none"
                >
                  {renderIcon("RiCloseLine", 20)}
                </button>
                <TracingTooltip
                  text="Close AI Context Tracing Panel"
                  isVisible={hoveredTooltip === "hdr_close"}
                />
              </div>
            </div>
          </div>

          {/* Sub-Header Toolbar: Multi-turn Session Selector & Category Tabs */}
          <div className="px-6 py-3 border-b border-white/5 bg-black/20 flex flex-col gap-3 flex-shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Multi-turn Turn Selector */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-neutrals-medium flex items-center gap-1">
                  {renderIcon("RiChatHistoryLine", 14)}
                  Prompt Turn:
                </span>
                {turns.length > 0 ? (
                  <div className="flex items-center gap-1.5 overflow-x-auto max-w-[400px] scrollbar-none">
                    {turns.map((turn, idx) => (
                      <div key={turn.turnId || idx} className="relative">
                        <button
                          onClick={() => setSelectedTurnIndex(idx)}
                          onMouseEnter={() => setHoveredTooltip(`turn_${idx}`)}
                          onMouseLeave={() => setHoveredTooltip(null)}
                          className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-all cursor-pointer border ${
                            selectedTurnIndex === idx
                              ? "bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-[0_0_8px_rgba(168,85,247,0.2)]"
                              : "bg-black/40 text-neutral-400 border-white/5 hover:text-white hover:bg-white/5"
                          }`}
                        >
                          Turn #{turns.length - idx}
                        </button>
                        <TracingTooltip
                          text={`Prompt: "${turn.userPrompt?.slice(0, 60)}${turn.userPrompt?.length > 60 ? "..." : ""}"`}
                          isVisible={hoveredTooltip === `turn_${idx}`}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs font-mono text-neutral-500 italic">No prompt turns recorded yet</span>
                )}
              </div>

              {/* Search Filter Input */}
              <div className="relative w-64">
                <div className="absolute inset-y-0 left-2.5 flex items-center pointer-events-none text-neutral-400">
                  {renderIcon("RiFilter3Line", 14)}
                </div>
                <input
                  type="text"
                  placeholder="Filter trace logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg pl-8 pr-3 py-1 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500/50 transition-all font-sans"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute inset-y-0 right-2 flex items-center text-neutral-400 hover:text-white"
                  >
                    {renderIcon("RiCloseLine", 12)}
                  </button>
                )}
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {categories.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <div key={cat.id} className="relative flex-shrink-0">
                    <button
                      onClick={() => setSelectedCategory(cat.id)}
                      onMouseEnter={() => setHoveredTooltip(`cat_${cat.id}`)}
                      onMouseLeave={() => setHoveredTooltip(null)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-sans font-bold uppercase transition-all cursor-pointer border ${
                        isSelected
                          ? "bg-purple-600/30 text-white border-purple-500 shadow-[0_0_10px_rgba(139,92,246,0.3)]"
                          : "bg-black/30 text-neutral-400 border-white/5 hover:text-white hover:bg-white/5 hover:border-white/10"
                      }`}
                    >
                      {renderIcon(cat.icon, 14, isSelected ? "text-purple-300" : "text-neutral-400")}
                      <span>{cat.label}</span>
                    </button>
                    <TracingTooltip
                      text={cat.tooltip}
                      isVisible={hoveredTooltip === `cat_${cat.id}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main Body - Trace Timeline View */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 font-sans custom-scrollbar">
            {activeTurn && activeTurn.userPrompt && (
              <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] flex flex-col gap-1.5 mb-6">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-neutrals-medium font-bold">
                  <span className="flex items-center gap-1 text-purple-400">
                    {renderIcon("RiChatAi4Fill", 14)}
                    Active User Prompt (Turn #{turns.length - selectedTurnIndex}):
                  </span>
                  {/* T43 (design §2.5): the turn's start on the server's clock and
                      its wall time from `timing`; a turn recorded before T43 falls
                      back to the page's receive time. */}
                  <span
                    className="font-mono text-neutral-500"
                    title={activeTurn.timing ? `started ${activeTurn.timing.startedAt} · finished ${activeTurn.timing.finishedAt} (server clock)` : ""}
                  >
                    {activeTurn.timing && Number.isFinite(activeTurn.timing.wallMs)
                      ? `${formatClock(activeTurn.timing.startedAt)} · ${formatSeconds(activeTurn.timing.wallMs)} total`
                      : activeTurn.timestamp
                        ? new Date(activeTurn.timestamp).toLocaleTimeString()
                        : ""}
                  </span>
                </div>
                <p className="text-sm text-neutral-200 font-medium leading-relaxed bg-black/30 p-3 rounded-lg border border-white/5">
                  &quot;{activeTurn.userPrompt}&quot;
                </p>
              </div>
            )}

            {filteredTraces && filteredTraces.length > 0 ? (
              filteredTraces.map((trace, index) => {
                const isExpanded = expandedTraceIds.has(trace.id);
                const isCopied = copiedId === trace.id;

                return (
                  <motion.div
                    key={trace.id || index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.03 }}
                    className={`rounded-xl border transition-all ${
                      isExpanded
                        ? "bg-black/50 border-purple-500/40 shadow-[0_0_15px_rgba(139,92,246,0.1)]"
                        : "bg-black/30 border-white/10 hover:border-white/20 hover:bg-black/40"
                    }`}
                  >
                    {/* Trace Card Header */}
                    <div
                      onClick={() => toggleExpand(trace.id)}
                      className="p-4 flex items-center justify-between cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-4">
                        {/* Icon */}
                        <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-purple-300 flex-shrink-0">
                          {renderIcon(trace.icon || "RiInformationLine", 18)}
                        </div>

                        {/* Title & Description */}
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="text-sm font-bold text-white tracking-wide">
                              {trace.title}
                            </span>
                            {trace.badge && (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase border ${getBadgeStyle(trace.badgeType)}`}>
                                {trace.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-neutral-300 mt-0.5 line-clamp-1 leading-relaxed">
                            {trace.description}
                          </p>
                        </div>
                      </div>

                      {/* Right Meta & Controls */}
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {/* T43 (design D1, §2.5): the span's clock time and its offset
                            from the turn's start (`t+`), stamped by the server — never
                            derived here (§0b fact 2); an ingest-scoped span (T13's
                            engine inspections) prints its duration as "at ingest" and
                            is never placed on the timeline; the generation span shows
                            its tokens. The timeline keys on `durationScope`, never on
                            `durationSource`. */}
                        {trace.timestamp && (
                          <span className="text-[11px] font-mono text-neutral-500 hidden sm:inline" title={`recorded ${trace.timestamp}`}>
                            {formatClock(trace.timestamp)}
                          </span>
                        )}
                        {Number.isFinite(trace.offsetMs) && (
                          <span
                            className="text-[11px] font-mono text-purple-300/80"
                            title={trace.durationScope === "ingest" ? "when this span was recorded on the turn's clock; its duration is ingest time" : "this span's start, measured from the turn's start"}
                          >
                            {formatOffset(trace.offsetMs)}
                          </span>
                        )}
                        {trace.category === "llm_inference" && trace.details && trace.details.usage && trace.details.usage.providerReported === true && (
                          <span className="text-[11px] font-mono text-neutral-400 bg-white/5 px-2 py-1 rounded border border-white/5" title="prompt → completion tokens, as the provider reported them">
                            {formatTokens(trace.details.usage)}
                          </span>
                        )}
                        {trace.durationMs !== undefined && (
                          <span
                            className="text-[11px] font-mono text-neutral-400 bg-white/5 px-2 py-1 rounded border border-white/5 flex items-center gap-1"
                            title={trace.durationScope === "ingest" ? `measured at ingest (${trace.details && trace.details.durationSource ? trace.details.durationSource : "recorded"}) — not this turn's time` : "measured on this turn"}
                          >
                            {renderIcon("RiTimeLine", 12)}
                            {trace.durationScope === "ingest" ? `${formatSeconds(trace.durationMs)} at ingest` : `${trace.durationMs}ms`}
                          </span>
                        )}

                        {/* Copy Button */}
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleCopyDetails(trace)}
                            onMouseEnter={() => setHoveredTooltip(`copy_${trace.id}`)}
                            onMouseLeave={() => setHoveredTooltip(null)}
                            className="p-1.5 rounded-lg border border-white/5 bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 transition-all outline-none"
                          >
                            {renderIcon(isCopied ? "RiCheckLine" : "RiFileCopyLine", 15, isCopied ? "text-teal-400" : "")}
                          </button>
                          <TracingTooltip
                            text={isCopied ? "Copied details JSON!" : "Copy trace details JSON to clipboard"}
                            isVisible={hoveredTooltip === `copy_${trace.id}`}
                          />
                        </div>

                        {/* Expand Chevron Icon */}
                        <div className="text-neutral-400">
                          {renderIcon(isExpanded ? "RiArrowDownSLine" : "RiArrowRightSLine", 20)}
                        </div>
                      </div>
                    </div>

                    {/* Expandable Trace Details Body */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden border-t border-white/5 bg-black/40"
                        >
                          <div className="p-4 space-y-3 text-xs">
                            <div className="flex items-center justify-between text-neutral-400 text-[11px] font-mono">
                              <span>SPAN ID: {trace.id}</span>
                              <span>TIMESTAMP: {trace.timestamp}</span>
                            </div>

                            {/* Raw Structured Payload Display */}
                            <div className="bg-[#050505] p-3.5 rounded-xl border border-white/10 overflow-x-auto">
                              <pre className="font-mono text-xs text-purple-200 leading-relaxed whitespace-pre-wrap word-break-all">
                                {JSON.stringify(trace.details || {}, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center text-neutral-500 gap-3 border border-dashed border-white/10 rounded-2xl">
                <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-neutral-400">
                  {renderIcon("RiInformationLine", 24)}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-neutral-300">No Tracing Spans Matched</h4>
                  <p className="text-xs text-neutral-500 mt-1 max-w-sm">
                    {searchQuery
                      ? `No trace steps found matching query "${searchQuery}". Try clearing the search.`
                      : "Submit a prompt in the chat assistant to capture real-time execution steps."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
