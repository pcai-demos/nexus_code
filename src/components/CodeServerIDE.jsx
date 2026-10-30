"use client";

import React, { useState, useEffect, useCallback } from "react";
import { RiCodeBoxLine, RiTerminalLine, RiLoader4Line, RiRefreshLine, RiExternalLinkLine, RiPlugLine } from "@remixicon/react";

/**
 * CodeServerIDE — Embeds code-server (VS Code) via iframe with health checking,
 * bridge status polling, and a beautiful fallback placeholder when the IDE
 * container is not running.
 */
export default function CodeServerIDE() {
  const [ideStatus, setIdeStatus] = useState("checking"); // "checking" | "available" | "unavailable"
  const [retryCount, setRetryCount] = useState(0);
  const [bridgeStatus, setBridgeStatus] = useState("unknown"); // "unknown" | "connected" | "disconnected"

  const checkHealth = useCallback(async () => {
    setIdeStatus("checking");
    try {
      const res = await fetch("/ide/", {
        method: "GET",
        cache: "no-store",
        redirect: "manual",
      });
      // code-server returns 302 redirect to workbench — any response means it's alive
      if (res.status < 500) {
        setIdeStatus("available");
      } else {
        setIdeStatus("unavailable");
      }
    } catch {
      setIdeStatus("unavailable");
    }
  }, []);

  // Poll bridge extension status every 3 seconds when IDE is available
  useEffect(() => {
    if (ideStatus !== "available") return;

    let failedPings = 0;

    const checkBridge = async () => {
      try {
        const res = await fetch("/api/ide-bridge", {
          method: "GET",
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.bridgeConnected) {
            setBridgeStatus("connected");
            failedPings = 0;
            return;
          }
        }
        throw new Error("offline");
      } catch {
        failedPings += 1;
        // Only set status to disconnected if we fail 3 consecutive pings (9 seconds of downtime)
        if (failedPings >= 3) {
          setBridgeStatus("disconnected");
        }
      }
    };

    checkBridge();
    const interval = setInterval(checkBridge, 3000);
    return () => clearInterval(interval);
  }, [ideStatus]);

  useEffect(() => {
    checkHealth();
  }, [checkHealth, retryCount]);

  // Auto-retry every 5 seconds when unavailable
  useEffect(() => {
    if (ideStatus !== "unavailable") return;
    const timer = setInterval(() => {
      checkHealth();
    }, 5000);
    return () => clearInterval(timer);
  }, [ideStatus, checkHealth]);

  if (ideStatus === "checking") {
    return <IDELoadingState />;
  }

  if (ideStatus === "unavailable") {
    return (
      <IDEUnavailablePlaceholder
        onRetry={() => setRetryCount((c) => c + 1)}
      />
    );
  }

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-white/10 shadow-2xl group">
      {/* Top bar mimicking NexCODE panel style */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-[#0A0A0A]/90 backdrop-blur-md border-b border-white/5 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RiCodeBoxLine size={16} className="text-brand-vivid" />
          <span className="text-xs font-sans font-bold uppercase tracking-widest text-neutrals-light">
            NexCODE IDE
          </span>
          <span className="ml-2 px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] font-mono rounded-full border border-green-500/20">
            CONNECTED
          </span>
          {/* Bridge status indicator */}
          <span className={`px-2 py-0.5 text-[10px] font-mono rounded-full border flex items-center gap-1 ${
            bridgeStatus === "connected"
              ? "bg-brand-vivid/15 text-brand-vivid border-brand-vivid/20"
              : "bg-yellow-500/15 text-yellow-400 border-yellow-500/20"
          }`}>
            <RiPlugLine size={10} />
            {bridgeStatus === "connected" ? "BRIDGE ACTIVE" : "BRIDGE OFFLINE"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRetryCount((c) => c + 1)}
            className="p-1.5 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 transition-all cursor-pointer"
            title="Refresh IDE"
          >
            <RiRefreshLine size={14} />
          </button>
          <a
            href="/ide/"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-neutrals-medium hover:text-white hover:bg-white/5 transition-all"
            title="Open in new tab"
          >
            <RiExternalLinkLine size={14} />
          </a>
        </div>
      </div>

      {/* iframe — offset by the top bar height */}
      <iframe
        key={retryCount}
        src="/ide/?folder=/home/coder/project"
        className="w-full h-full border-0"
        style={{ paddingTop: "36px" }}
        title="NexCODE IDE"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

/**
 * Loading spinner shown while checking code-server health
 */
function IDELoadingState() {
  return (
    <div className="w-full h-full rounded-2xl border border-white/10 bg-[#121212] flex items-center justify-center shadow-2xl">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-brand-vivid/10 flex items-center justify-center">
            <RiCodeBoxLine size={32} className="text-brand-vivid" />
          </div>
          <RiLoader4Line
            size={20}
            className="absolute -bottom-1 -right-1 text-brand-vivid animate-spin"
          />
        </div>
        <div className="text-center">
          <p className="text-sm font-sans font-semibold text-neutrals-light">
            Connecting to IDE...
          </p>
          <p className="text-xs text-neutrals-medium mt-1">
            Checking code-server availability
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Beautiful placeholder shown when code-server is not running
 */
function IDEUnavailablePlaceholder({ onRetry }) {
  return (
    <div className="w-full h-full rounded-2xl border border-white/10 bg-[#121212] flex items-center justify-center shadow-2xl relative overflow-hidden">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
          backgroundSize: "24px 24px",
        }}
      />

      {/* Floating decorative code lines */}
      <div className="absolute top-8 left-8 opacity-5 font-mono text-xs text-white leading-6 select-none">
        <div>{"import { useState } from 'react';"}</div>
        <div>{"const app = createApp();"}</div>
        <div>{"export default function Main() {"}</div>
        <div>{"  return <div>Hello NexCODE</div>;"}</div>
        <div>{"}"}</div>
      </div>
      <div className="absolute bottom-8 right-8 opacity-5 font-mono text-xs text-white leading-6 select-none text-right">
        <div>{"def train_model(data):"}</div>
        <div>{"    model = Pipeline()"}</div>
        <div>{"    model.fit(data)"}</div>
        <div>{"    return model.predict()"}</div>
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-6 max-w-md px-6 text-center">
        {/* Icon */}
        <div className="relative">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-vivid/20 to-brand-vivid/5 flex items-center justify-center border border-brand-vivid/20 shadow-lg shadow-brand-vivid/5">
            <RiCodeBoxLine size={40} className="text-brand-vivid" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-red-400" />
          </div>
        </div>

        {/* Title */}
        <div>
          <h3 className="text-lg font-sans font-bold text-white mb-2">
            IDE Not Running
          </h3>
          {/* E6 (CA-019): on the cluster the IDE is the nexcode-ide sidecar of the same pod; nothing is started by hand. */}
          <p className="text-sm text-neutrals-medium leading-relaxed">
            The IDE container (<span className="font-mono">nexcode-ide</span>, the code-server sidecar of this pod) is not reachable from the app. It is usually still starting after a roll; this panel keeps checking and reconnects on its own.
          </p>
        </div>

        {/* What is checked (the health probe this panel runs) */}
        <div className="w-full bg-black/60 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <RiTerminalLine size={14} className="text-brand-vivid" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutrals-medium">
              Health check
            </span>
          </div>
          <code className="text-sm font-mono text-green-400 block">
            GET /ide/ (proxied to the nexcode-ide container)
          </code>
        </div>

        {/* Retry button */}
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-vivid/10 border border-brand-vivid/20 text-brand-vivid text-sm font-semibold hover:bg-brand-vivid/20 hover:border-brand-vivid/30 transition-all cursor-pointer active:scale-95"
        >
          <RiRefreshLine size={16} />
          Retry Connection
        </button>

        {/* Auto-retry indicator */}
        <p className="text-[10px] text-neutrals-medium font-mono">
          Auto-retrying every 5 seconds...
        </p>
      </div>
    </div>
  );
}
