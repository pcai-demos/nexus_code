"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RiCloseLine,
  RiFolder5Fill,
  RiFileTextLine,
  RiFilePdf2Line,
  RiMarkdownLine,
  RiFileWordLine,
  RiFilePptLine,
  RiFileExcelLine,
  RiArrowLeftSLine,
  RiCheckLine,
  RiLoader4Line,
  RiFolder5Line
} from "@remixicon/react";

export default function FileBrowserDrawer({ isOpen, onClose, loadedFiles, setLoadedFiles, triggerIngestion }) {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState("/demos/demo_files");
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewContent, setPreviewContent] = useState("");
  const [previewMetadata, setPreviewMetadata] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadSuccess, setLoadSuccess] = useState(false);

  // Fetch file tree on mount
  useEffect(() => {
    async function fetchTree() {
      try {
        setLoading(true);
        const res = await fetch("/api/files");
        const data = await res.json();
        if (data.success) {
          setTree(data.tree);
        }
      } catch (err) {
        console.error("Failed to fetch files tree:", err);
      } finally {
        setLoading(false);
      }
    }
    if (isOpen) {
      fetchTree();
    }
  }, [isOpen]);

  // Load selected files into application state
  const handleLoadSelected = () => {
    // Gather all selected file objects
    const filesToLoad = [];
    const collectFiles = (nodes) => {
      for (const node of nodes) {
        if (node.type === "file" && selectedPaths.includes(node.path)) {
          filesToLoad.push(node);
        }
        if (node.children) {
          collectFiles(node.children);
        }
      }
    };
    collectFiles(tree);

    // Merge with currently loaded files, avoiding duplicates
    const existingPaths = loadedFiles.map((f) => f.path);
    const newFiles = filesToLoad.filter((f) => !existingPaths.includes(f.path));

    if (newFiles.length > 0) {
      setLoadedFiles((prev) => [...prev, ...newFiles]);
      if (triggerIngestion) {
        triggerIngestion(newFiles);
      }
    }

    setLoadSuccess(true);
    setTimeout(() => {
      setLoadSuccess(false);
      setSelectedPaths([]); // clear selections
    }, 1200);
  };

  // Helper: Find folder children based on path
  const getCurrentItems = () => {
    if (currentPath === "/demos/demo_files") {
      return tree;
    }
    const findFolder = (nodes, path) => {
      for (const n of nodes) {
        if (n.path === path && n.type === "directory") return n;
        if (n.children) {
          const found = findFolder(n.children, path);
          if (found) return found;
        }
      }
      return null;
    };
    const folder = findFolder(tree, currentPath);
    return folder ? folder.children : [];
  };

  // Get Breadcrumbs from current path
  const getBreadcrumbs = () => {
    const parts = currentPath.split("/").filter(Boolean); // ['demos', 'demo_files', ...]
    const crumbs = [];
    let currentAccumulated = "";
    
    // We want the breadcrumbs list to display relative to our root
    parts.forEach((part, index) => {
      currentAccumulated += "/" + part;
      // Skip displaying the top 'demos' segment for presenter clarity, or show it
      if (index >= 1) { // starts displaying from 'demo_files'
        crumbs.push({
          name: part === "demo_files" ? "Root" : part,
          path: currentAccumulated
        });
      }
    });
    return crumbs;
  };

  // Handle double click to go inside directories
  const handleFolderDoubleClick = (folder) => {
    setCurrentPath(folder.path);
  };

  // Handle single click to preview files or highlight
  const handleItemSingleClick = async (item) => {
    if (item.type === "directory") {
      setPreviewFile(null);
      setPreviewContent("");
      return;
    }

    setPreviewFile(item);
    setPreviewContent("");
    setPreviewMetadata(null);

    if (item.extension === ".pdf") {
      // PDF is handled via native iframe embed
      return;
    }

    try {
      setLoadingPreview(true);
      const response = await fetch(`/api/files/preview?path=${encodeURIComponent(item.path)}`);
      const data = await response.json();
      if (data.success) {
        setPreviewContent(data.text || "");
        setPreviewMetadata(data.metadata || null);
      } else {
        setPreviewContent(`Failed to read file preview: ${data.error}`);
      }
    } catch (err) {
      setPreviewContent(`Failed to read file contents:\n${err.message}`);
    } finally {
      setLoadingPreview(false);
    }
  };

  // Checkbox toggle
  const toggleSelectPath = (path, e) => {
    e.stopPropagation(); // prevent clicking from triggering preview
    setSelectedPaths((prev) => {
      if (prev.includes(path)) {
        return prev.filter((p) => p !== path);
      } else {
        return [...prev, path];
      }
    });
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

  // Get file icons based on extension
  const getFileIcon = (file, size = 18) => {
    const ext = file.extension?.toLowerCase();
    if (ext === ".pdf") {
      return <RiFilePdf2Line size={size} className="text-rose-400" />;
    }
    if (ext === ".md") {
      return <RiMarkdownLine size={size} className="text-purple-400" />;
    }
    if ([".docx", ".doc"].includes(ext)) {
      return <RiFileWordLine size={size} className="text-blue-400" />;
    }
    if ([".pptx", ".ppt"].includes(ext)) {
      return <RiFilePptLine size={size} className="text-amber-400" />;
    }
    if ([".xlsx", ".xls", ".csv"].includes(ext)) {
      return <RiFileExcelLine size={size} className="text-emerald-400" />;
    }
    return <RiFileTextLine size={size} className="text-neutrals-medium" />;
  };

  const currentItems = getCurrentItems();
  const breadcrumbs = getBreadcrumbs();

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ scale: 0.97, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.97, opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 pl-20 flex bg-black/35 backdrop-blur-sm justify-center items-center p-8 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-7xl rounded-2xl border border-white/12 flex flex-col h-[90vh] shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden text-white bg-[#121212]/85 backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/10 flex justify-between items-center bg-white/2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-vivid/10 border border-brand-vivid/20 flex items-center justify-center text-brand-vivid">
              <RiFolder5Line size={16} />
            </div>
            <div>
              <h2 className="text-white text-xs md:text-sm font-sans font-bold uppercase tracking-[1.5px]">
                File Browser
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neutrals-medium hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          >
            <RiCloseLine size={16} />
          </button>
        </div>

        {/* Content Body - Split Screen layout */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Grid Browser (30% width) */}
          <div className="w-[30%] flex flex-col h-full bg-[#141414]/40 p-4 border-r border-white/10">
            {/* Navigation & Breadcrumbs */}
            <div className="flex items-center gap-2 bg-black/40 border border-white/5 rounded-lg p-2 mb-4">
              {currentPath !== "/demos/demo_files" && (
                <button
                  type="button"
                  onClick={() => {
                    const parts = currentPath.split("/").filter(Boolean);
                    parts.pop();
                    setCurrentPath("/" + parts.join("/"));
                  }}
                  className="p-1 rounded bg-white/5 border border-white/10 text-neutrals-medium hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                >
                  <RiArrowLeftSLine size={16} />
                </button>
              )}
              
              <div className="flex items-center gap-1.5 text-[11px] font-sans font-bold uppercase tracking-[0.5px]">
                {breadcrumbs.map((crumb, idx) => (
                  <div key={crumb.path} className="flex items-center gap-1.5">
                    {idx > 0 && <span className="text-white/20">/</span>}
                    <button
                      type="button"
                      onClick={() => setCurrentPath(crumb.path)}
                      className={`hover:text-brand-vivid transition-colors cursor-pointer ${
                        currentPath === crumb.path ? "text-brand-vivid" : "text-neutrals-medium"
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Folder & Files Grid */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 bg-black/20 border border-white/5 rounded-xl">
              {loading ? (
                <div className="w-full h-full flex flex-col justify-center items-center text-neutrals-medium text-xs font-sans gap-2">
                  <RiLoader4Line size={24} className="animate-spin text-brand-vivid" />
                  Scanning file directories...
                </div>
              ) : currentItems.length === 0 ? (
                <div className="w-full h-full flex justify-center items-center text-neutrals-medium text-xs font-sans italic">
                  This folder is empty
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {currentItems.map((item) => {
                    const isDirectory = item.type === "directory";
                    const isSelected = selectedPaths.includes(item.path);
                    const isPreviewed = previewFile?.path === item.path;

                    return (
                      <div
                        key={item.path}
                        onDoubleClick={() => isDirectory && handleFolderDoubleClick(item)}
                        onClick={() => handleItemSingleClick(item)}
                        className={`group flex items-center justify-between p-2 rounded-lg border transition-all duration-200 select-none cursor-pointer ${
                          isPreviewed
                            ? "bg-brand-vivid/10 border-brand-vivid/30 text-white"
                            : "bg-white/2 border-white/5 hover:bg-white/4 hover:border-white/10 text-neutrals-light hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2 overflow-hidden flex-1">
                          {isDirectory ? (
                            <RiFolder5Fill size={18} className="text-brand-vivid/85 shrink-0" />
                          ) : (
                            <div className="shrink-0">{getFileIcon(item, 18)}</div>
                          )}
                          <span className="text-[11px] font-sans font-medium truncate">
                            {item.name}
                          </span>
                        </div>

                        {!isDirectory && (
                          <div
                            onClick={(e) => toggleSelectPath(item.path, e)}
                            className={`w-4 h-4 rounded border transition-all flex items-center justify-center shrink-0 ml-2 ${
                              isSelected
                                ? "bg-brand-vivid border-brand-vivid text-white"
                                : "bg-black/50 border-white/20 group-hover:border-white/40"
                            }`}
                          >
                            {isSelected && <RiCheckLine size={10} />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom Actions Area */}
            <div className="mt-4 flex justify-between items-center border-t border-white/10 pt-4">
              <span className="text-[10px] font-sans text-neutrals-medium italic">
                💡 Double click folders to enter. Click files to preview.
              </span>
              <button
                type="button"
                onClick={handleLoadSelected}
                disabled={selectedPaths.length === 0}
                className="py-2 px-5 bg-brand-vivid hover:brightness-110 rounded-lg text-[10px] font-sans font-bold uppercase tracking-[1.2px] text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-brand-vivid/20 disabled:opacity-30 disabled:pointer-events-none"
              >
                {loadSuccess ? (
                  <>
                    <RiCheckLine size={14} />
                    Files Loaded!
                  </>
                ) : (
                  <>
                    <RiCheckLine size={14} />
                    Load Selected Files ({selectedPaths.length})
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Previewer Pane (70% width) */}
          <div className="w-[70%] flex flex-col h-full bg-black/30">
            {previewFile ? (
              <div className="flex flex-col h-full overflow-hidden">
                {/* Preview File Details */}
                <div className="px-5 py-3 border-b border-white/10 bg-white/2 flex justify-between items-center">
                  <div className="flex items-center gap-2 overflow-hidden">
                    {getFileIcon(previewFile, 24)}
                    <div className="flex flex-col overflow-hidden leading-none">
                      <span className="text-[11px] font-sans font-bold text-white truncate">{previewFile.name}</span>
                      <span className="text-[9px] font-mono text-neutrals-medium mt-0.5">
                        {(previewFile.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  </div>
                </div>

                {/* Content Renderer */}
                <div className="flex-1 overflow-y-auto p-5 custom-scrollbar bg-black/40">
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
                  ) : [".docx", ".pptx", ".xlsx", ".doc", ".ppt", ".xls"].includes(previewFile.extension) ? (
                    <div className="flex flex-col h-full gap-3">
                      {/* Office Document Summary Banner */}
                      <div className="p-3 bg-brand-vivid/10 border border-brand-vivid/30 rounded-xl flex justify-between items-center text-xs font-sans shrink-0">
                        <div className="flex items-center gap-2.5">
                          <span className="px-2 py-0.5 rounded bg-brand-vivid/20 text-brand-vivid text-[10px] font-bold uppercase tracking-wider">
                            {previewFile.extension.replace('.', '')} DOCUMENT
                          </span>
                          {previewMetadata?.nativeProperties?.Slides && (
                            <span className="text-[11px] font-medium text-white/80">
                              {previewMetadata.nativeProperties.Slides} Slides
                            </span>
                          )}
                          {previewMetadata?.author && (
                            <span className="text-[11px] text-white/50 truncate max-w-xs">
                              Author: {previewMetadata.author}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-neutrals-medium font-mono">
                          Native Office Parser Extracted Text
                        </span>
                      </div>

                      {/* Extracted Text Viewer */}
                      <div className="flex-1 overflow-y-auto p-4 rounded-xl border border-white/10 bg-black/40 text-left font-sans text-neutrals-light space-y-1.5 custom-scrollbar">
                        {renderMarkdown(previewContent)}
                      </div>
                    </div>
                  ) : previewFile.extension === ".md" ? (
                    <div className="text-left font-sans text-neutrals-light space-y-1">
                      {renderMarkdown(previewContent)}
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-mono text-[10px] text-neutrals-light leading-relaxed bg-black/25 p-3 rounded-lg border border-white/5 overflow-auto">
                      {previewContent}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col justify-center items-center text-center p-6 text-neutrals-medium">
                <RiFileTextLine size={32} className="text-white/20 mb-2" />
                <span className="text-xs font-sans">No file selected for preview</span>
                <p className="text-[10px] font-sans text-neutrals-medium leading-relaxed max-w-xs mt-1">
                  Click on any file in the browser grid to present a preview of its contents here.
                </p>
              </div>
            )}
          </div>

        </div>

      </div>
    </motion.div>
  );
}
