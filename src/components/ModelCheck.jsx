"use client";

import { useEffect, useState } from "react";

/**
 * D31 (2026-10-30): says what a LiteLLM model can do in NexCode as soon as it is picked — whether it runs on Ollama,
 * and so whether thinking off, figure captioning and Ollama reranking work with it (POST /api/models/describe).
 * `need` names the feature this field depends on ("thinkingOff", "captioning" or "ollamaRerank"); when the model
 * lacks it, the note says so in the failure colour. The key, when typed, goes in the body, never the URL.
 */
export default function ModelCheck({ model, token = "", need = null }) {
  const [state, setState] = useState({ status: "idle", text: "" });

  useEffect(() => {
    const name = String(model || "").trim();
    if (!name) {
      setState({ status: "idle", text: "" });
      return undefined;
    }
    let active = true;
    setState({ status: "checking", text: `Checking ${name} with LiteLLM…` });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/models/describe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: name, token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setState({ status: "error", text: data.error || `The model check failed (HTTP ${res.status}).` });
          return;
        }
        const lacking = !data.known || (need && !(data.features && data.features[need]));
        setState({ status: lacking ? "warn" : "ok", text: data.message });
      } catch (err) {
        if (active) setState({ status: "error", text: `The model check failed: ${err.message}` });
      }
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [model, token, need]);

  if (state.status === "idle") return null;
  const colour =
    state.status === "ok" ? "text-emerald-400" : state.status === "checking" ? "text-neutrals-medium" : "text-amber-400";
  return <p className={`text-[10px] font-sans leading-snug ${colour}`}>{state.text}</p>;
}
