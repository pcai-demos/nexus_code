"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import sidebarMenuDef from "@/data/sidebar_menu_def.json";
import * as Icons from "@remixicon/react";

export default function Sidebar({
  chatOpen,
  setChatOpen,
  ideOpen,
  setIdeOpen,
  isDemoOpen,
  setIsDemoOpen,
  isDemoSelectOpen,
  setIsDemoSelectOpen,
  isDocsOpen,
  setIsDocsOpen,
  isResultsOpen,
  setIsResultsOpen,
  isStandardsOpen,
  setIsStandardsOpen,
  isFileBrowserOpen,
  setIsFileBrowserOpen,
  isStatsOpen,
  setIsStatsOpen,
  isTracingOpen,
  setIsTracingOpen,
  isAdminOpen,
  setIsAdminOpen,
  handleResetState,
  isResetOpen,
  setIsResetOpen,
}) {
  const [hoveredItem, setHoveredItem] = useState(null);

  // Group items by the requested sections
  const adminItems = sidebarMenuDef.filter(
    (item) =>
      item.label === "AI Context Tracing" ||
      item.label === "AI Consumption Stats" ||
      item.label === "Session Reset" ||
      item.label === "Admin Panel" ||
      item.label === "Exit App"
  );

  // Render a Remixicon dynamically based on string name
  const renderIcon = (iconName, size = 20, className = "") => {
    const IconComponent = Icons[iconName] || Icons.RiQuestionLine;
    return <IconComponent size={size} className={className} />;
  };

  const topItems = [
    // Presenter panels (design §2, 2026-10-07): the Demo panel over the workbench; then (PR B, D2 and D4 (a)) the
    // Documents panel, which replaced Store Admin (its old tray sits behind "Store admin" in that panel's footer), and
    // the Results panel. One overlay at a time: each icon closes the others.
    // Polish (the owner, 2026-10-14; PL-D1 (a)): the Demo icon is first, as the presenter's first click, and it opens
    // the demo selection screen; the Demo panel opens from a card's Details, or from the chat's own links.
    {
      id: "demo",
      label: "Demo",
      tooltip: "Demos: choose a demo, or free flow",
      icon: "RiSlideshow3Line",
      color: "#A855F7", // purple
      isActive: Boolean(isDemoSelectOpen) || Boolean(isDemoOpen),
      onClick: () => {
        if (setIsDemoSelectOpen) setIsDemoSelectOpen(!isDemoSelectOpen);
        if (setIsDemoOpen) setIsDemoOpen(false);
        if (setIsDocsOpen) setIsDocsOpen(false);
        if (setIsResultsOpen) setIsResultsOpen(false);
        if (setIsResetOpen) setIsResetOpen(false);
        setIsStandardsOpen(false);
        setIsFileBrowserOpen(false);
        setIsStatsOpen(false);
        if (setIsTracingOpen) setIsTracingOpen(false);
        setIsAdminOpen(false);
      },
    },
    {
      id: "chat",
      label: "Toggle Chat",
      tooltip: "Toggle Chat Panel",
      icon: "RiChatAi4Fill",
      color: "#F2561D", // vivid orange
      isActive: chatOpen,
      onClick: () => setChatOpen(!chatOpen),
    },
    {
      id: "ide",
      label: "Toggle IDE",
      tooltip: "Toggle IDE Panel",
      icon: "RiCodeBoxFill",
      color: "#14B8A6", // contrast teal
      isActive: ideOpen,
      onClick: () => setIdeOpen(!ideOpen),
    },
    {
      id: "documents",
      label: "Documents",
      tooltip: "Documents: every document in play for the demo",
      icon: "RiBookOpenLine",
      color: "#3B82F6", // blue
      isActive: Boolean(isDocsOpen),
      onClick: () => {
        if (setIsDocsOpen) setIsDocsOpen(!isDocsOpen);
        if (setIsDemoOpen) setIsDemoOpen(false);
        if (setIsDemoSelectOpen) setIsDemoSelectOpen(false);
        if (setIsResultsOpen) setIsResultsOpen(false);
        if (setIsResetOpen) setIsResetOpen(false);
        setIsStandardsOpen(false);
        setIsFileBrowserOpen(false);
        setIsStatsOpen(false);
        if (setIsTracingOpen) setIsTracingOpen(false);
        setIsAdminOpen(false);
      },
    },
    {
      id: "results",
      label: "Results",
      tooltip: "Results: the evidence record and the code change",
      icon: "RiFileChartLine",
      color: "#14B8A6", // teal
      isActive: Boolean(isResultsOpen),
      onClick: () => {
        if (setIsResultsOpen) setIsResultsOpen(!isResultsOpen);
        if (setIsDemoOpen) setIsDemoOpen(false);
        if (setIsDemoSelectOpen) setIsDemoSelectOpen(false);
        if (setIsDocsOpen) setIsDocsOpen(false);
        if (setIsResetOpen) setIsResetOpen(false);
        setIsStandardsOpen(false);
        setIsFileBrowserOpen(false);
        setIsStatsOpen(false);
        if (setIsTracingOpen) setIsTracingOpen(false);
        setIsAdminOpen(false);
      },
    },
    {
      id: "file-browser",
      label: "File Browser",
      tooltip: "File Browser Selector",
      icon: "RiFolder5Line",
      color: "#008A8C", // brand teal
      isActive: isFileBrowserOpen,
      onClick: () => {
        if (setIsDemoOpen) setIsDemoOpen(false);
        if (setIsDemoSelectOpen) setIsDemoSelectOpen(false);
        if (setIsDocsOpen) setIsDocsOpen(false);
        if (setIsResultsOpen) setIsResultsOpen(false);
        setIsFileBrowserOpen(!isFileBrowserOpen);
        setIsStandardsOpen(false);
        setIsStatsOpen(false);
        if (setIsTracingOpen) setIsTracingOpen(false);
        setIsAdminOpen(false);
      },
    },
  ];

  return (
    <>
      <div
        className="fixed left-0 top-20 bottom-0 w-20 z-40 flex flex-col items-center justify-between py-6 border-r border-neutrals-dark/40"
        style={{
          background: "rgba(10, 10, 10, 0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        {/* Top Section - Toggles & Standards */}
        <div className="flex flex-col gap-5 w-full items-center">
          {topItems.map((item) => (
            <div
              key={item.id}
              className="relative group flex items-center justify-center w-full"
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
            >
              <button
                onClick={item.onClick}
                style={{
                  color: item.isActive ? item.color : "#BFBFBF",
                  backgroundColor: item.isActive ? `${item.color}15` : "transparent",
                  borderColor: item.isActive ? `${item.color}40` : "transparent",
                }}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300 relative border cursor-pointer outline-none hover:text-white hover:bg-white/5 hover:border-white/10
                  ${item.isActive ? `shadow-[0_0_12px_${item.color}25]` : ""}`}
              >
                {renderIcon(item.icon, 24, "flex-shrink-0")}
                {item.isActive && (
                  <div
                    className="absolute left-0 w-1 h-6 rounded-r animate-pulse"
                    style={{ backgroundColor: item.color }}
                  />
                )}
              </button>

              <AnimatePresence>
                {hoveredItem === item.id && (
                  <motion.div
                    className="absolute left-24 px-3 py-1.5 rounded-lg border border-neutrals-dark/50 text-[11px] font-sans font-medium uppercase tracking-[2px] text-white whitespace-pre-line w-max max-w-[280px] leading-relaxed z-50 shadow-md"
                    style={{
                      background: "rgba(18, 18, 18, 0.95)",
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                    }}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.15 }}
                  >
                    {item.tooltip}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

        {/* Bottom Section - Admin */}
        <div className="flex flex-col gap-4 w-full items-center">
          {adminItems.map((item) => {
            const isItemActive =
              (item.label === "Session Reset" && Boolean(isResetOpen)) ||
              (item.label === "AI Context Tracing" && isTracingOpen) ||
              (item.label === "AI Consumption Stats" && isStatsOpen) ||
              (item.label === "Admin Panel" && isAdminOpen);

            const handleAction = () => {
              if (setIsDemoOpen) setIsDemoOpen(false);
              if (setIsDemoSelectOpen) setIsDemoSelectOpen(false);
              if (setIsDocsOpen) setIsDocsOpen(false);
              if (setIsResultsOpen) setIsResultsOpen(false);
              if (setIsResetOpen && item.label !== "Session Reset") setIsResetOpen(false);
              setIsFileBrowserOpen(false);
              setIsStandardsOpen(false);
              if (item.label === "AI Context Tracing") {
                setIsAdminOpen(false);
                setIsStatsOpen(false);
                if (setIsTracingOpen) setIsTracingOpen(!isTracingOpen);
              } else if (item.label === "AI Consumption Stats") {
                setIsAdminOpen(false);
                if (setIsTracingOpen) setIsTracingOpen(false);
                setIsStatsOpen(!isStatsOpen);
              } else if (item.label === "Session Reset") {
                // The two-level reset (2026-10-07, D1 (a)): the icon opens the menu: clear the chat, or reset the demo environment.
                if (setIsResetOpen) setIsResetOpen(!isResetOpen);
                else handleResetState();
              } else if (item.label === "Admin Panel") {
                setIsStatsOpen(false);
                if (setIsTracingOpen) setIsTracingOpen(false);
                setIsAdminOpen(!isAdminOpen);
              } else if (item.label === "Exit App") {
                if (typeof window !== "undefined") {
                  window.close();
                }
              }
            };

            return (
              <div
                key={item.label}
                className="relative group flex items-center justify-center w-full"
                onMouseEnter={() => setHoveredItem(item.label)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <button
                  onClick={handleAction}
                  style={{
                    color: isItemActive ? item.color.hex : "#BFBFBF",
                    backgroundColor: isItemActive ? `${item.color.hex}15` : "transparent",
                    borderColor: isItemActive ? `${item.color.hex}40` : "transparent",
                  }}
                  className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300 relative border cursor-pointer outline-none hover:text-white hover:bg-white/5 hover:border-white/10
                    ${isItemActive ? "shadow-[0_0_12px_rgba(140,140,140,0.15)]" : ""}`}
                >
                  {renderIcon(item.icon, 24, "flex-shrink-0")}
                  {isItemActive && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="absolute left-0 w-1 h-6 rounded-r"
                      style={{ backgroundColor: item.color.hex }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}
                </button>

                <AnimatePresence>
                  {hoveredItem === item.label && (
                    <motion.div
                      className="absolute left-24 px-3 py-1.5 rounded-lg border border-neutrals-dark/50 text-[11px] font-sans font-medium uppercase tracking-[2px] text-white whitespace-pre-line w-max max-w-[280px] leading-relaxed z-50 shadow-md"
                      style={{
                        background: "rgba(18, 18, 18, 0.95)",
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                      }}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.15 }}
                    >
                      {item.tooltip}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
