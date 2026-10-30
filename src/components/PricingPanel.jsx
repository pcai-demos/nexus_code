"use client";

/**
 * PricingPanel — the Admin Panel's Misc tab (polish Phase 3; the owner's PL-D10 to PL-D12 (a) of 2026-10-14): the price
 * table the costs use, per MILLION tokens, in and out, per model, with a default row for a model not listed and the
 * currency. It is read and written through the scenarios route (`pricing-read`, `pricing-write`), so it lives on the
 * server with the run log and the records, not in this browser (PL-D10 (a)). Rows are seeded from the models the app is
 * configured with and the models the run log has seen; any other model id can be typed. Save writes the table at once,
 * apart from the Admin Panel's own Save (which keeps the browser's settings).
 */
import React, { useCallback, useEffect, useState } from "react";
import { RiAddLine, RiCoinLine, RiDeleteBinLine, RiLoader4Line, RiSaveLine } from "@remixicon/react";

const API = "/api/ide-bridge/scenarios";
const INPUT = "bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:border-brand-vivid/50 focus:outline-none w-full";
const LABEL = "text-[9px] md:text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-neutrals-medium";

async function post(body) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`the scenarios route answered HTTP ${res.status}`);
  if (!res.ok || json.success === false) throw new Error(json.error || `the scenarios route answered HTTP ${res.status}`);
  return json;
}

const asText = (v) => (v === null || v === undefined ? "" : String(v));

/** The stored table as rows the form edits (strings, so a half-typed number is kept as typed). */
function rowsOf(pricing) {
  const models = pricing && pricing.models && typeof pricing.models === "object" ? pricing.models : {};
  return Object.entries(models).map(([model, row]) => ({ model, input: asText(row.input), output: asText(row.output) }));
}

export default function PricingPanel({ configuredModels = [] }) {
  const [currency, setCurrency] = useState("GBP");
  const [useDefault, setUseDefault] = useState(false);
  const [defaultRow, setDefaultRow] = useState({ input: "", output: "" });
  const [rows, setRows] = useState([]);
  const [seen, setSeen] = useState([]);
  const [stored, setStored] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await post({ action: "pricing-read" });
      const p = r.pricing || {};
      setCurrency(p.currency || "GBP");
      setUseDefault(Boolean(p.default));
      setDefaultRow(p.default ? { input: asText(p.default.input), output: asText(p.default.output) } : { input: "", output: "" });
      setRows(rowsOf(p));
      setSeen(Array.isArray(r.seen) ? r.seen : []);
      setStored(Boolean(r.stored));
      setMessage(null);
    } catch (err) {
      setMessage({ tone: "bad", text: `The price table could not be read: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const known = [...new Set([...(Array.isArray(configuredModels) ? configuredModels : []), ...seen].filter((m) => typeof m === "string" && m.trim()))];
  const unlisted = known.filter((m) => !rows.some((r) => r.model === m));

  const setRow = (i, field, value) => setRows((prev) => prev.map((r, k) => (k === i ? { ...r, [field]: value } : r)));
  const addRow = (model = "") => setRows((prev) => [...prev, { model, input: "", output: "" }]);
  const removeRow = (i) => setRows((prev) => prev.filter((_, k) => k !== i));

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const models = {};
      for (const r of rows) if (r.model.trim()) models[r.model.trim()] = { input: r.input, output: r.output };
      const body = { currency, default: useDefault ? defaultRow : null, models };
      const r = await post({ action: "pricing-write", pricing: body });
      const p = r.pricing || {};
      setCurrency(p.currency || "GBP");
      setUseDefault(Boolean(p.default));
      setDefaultRow(p.default ? { input: asText(p.default.input), output: asText(p.default.output) } : { input: "", output: "" });
      setRows(rowsOf(p));
      setStored(true);
      const dropped = Array.isArray(r.invalid) ? r.invalid : [];
      const defaultDropped = useDefault && !p.default;
      setMessage(
        dropped.length || defaultDropped
          ? { tone: "warn", text: `Saved, apart from ${[...dropped, ...(defaultDropped ? ["the default row"] : [])].join(", ")}: a row needs both prices as numbers.` }
          : { tone: "good", text: `Saved: ${Object.keys(p.models || {}).length} model row(s)${p.default ? " and a default row" : ""}, in ${p.currency}.` }
      );
    } catch (err) {
      setMessage({ tone: "bad", text: `Not saved: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full" data-pricing-panel>
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center border-b border-white/5 pb-2">
          <h3 className="text-white text-[11px] md:text-xs font-sans font-bold uppercase tracking-[1.2px] flex items-center gap-1.5">
            <RiCoinLine size={14} className="text-[#F2561D]" />
            TOKEN PRICES
          </h3>
          <div className="flex items-center gap-2 text-[10px] font-mono text-neutrals-medium">
            {loading && <RiLoader4Line size={12} className="animate-spin text-brand-vivid" />}
            {stored ? "stored on the server" : "no table stored yet: costs read “no price set”"}
          </div>
        </div>
        <p className="text-[11px] font-sans text-neutrals-light leading-relaxed">
          What a million tokens cost, in and out, for each model. The AI Consumption Stats panel and every evidence record cost each answer at its own model&apos;s row, or at the default row for a model not listed; a model with neither shows &ldquo;no price set&rdquo;, never a zero. A record keeps the prices it was costed at, so changing them later never rewrites an old record. Saved on the server, for every browser.
        </p>
      </div>

      <div className="flex flex-col gap-3.5 bg-white/2 border border-white/5 rounded-xl p-4">
        <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px]">1. Currency and the default row</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Currency (ISO code)</label>
            <input type="text" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className={INPUT} data-pricing-currency />
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-sans font-bold uppercase tracking-[0.5px] text-white pb-2">
            <input type="checkbox" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} className="w-3.5 h-3.5 accent-brand-vivid bg-black/40 border border-white/10 rounded cursor-pointer" data-pricing-default />
            Default row for a model not listed
          </label>
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Default: input, per million</label>
            <input type="number" min="0" step="0.0001" value={defaultRow.input} disabled={!useDefault} onChange={(e) => setDefaultRow((d) => ({ ...d, input: e.target.value }))} className={`${INPUT} disabled:opacity-40`} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={LABEL}>Default: output, per million</label>
            <input type="number" min="0" step="0.0001" value={defaultRow.output} disabled={!useDefault} onChange={(e) => setDefaultRow((d) => ({ ...d, output: e.target.value }))} className={`${INPUT} disabled:opacity-40`} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3.5 bg-white/2 border border-white/5 rounded-xl p-4">
        <h4 className="text-white text-[10px] font-sans font-bold uppercase tracking-[1px]">2. Prices per model</h4>
        {rows.length === 0 && <div className="text-[11px] font-sans text-neutrals-medium">No model row yet. Add the models below, or type one.</div>}
        {rows.length > 0 && (
          <div className="grid grid-cols-[1fr_140px_140px_32px] gap-2 items-center">
            <span className={LABEL}>Model id</span>
            <span className={LABEL}>Input, per million</span>
            <span className={LABEL}>Output, per million</span>
            <span />
            {rows.map((r, i) => (
              <React.Fragment key={i}>
                <input type="text" value={r.model} onChange={(e) => setRow(i, "model", e.target.value)} placeholder="model id, as the endpoint names it" className={INPUT} data-pricing-model={i} />
                <input type="number" min="0" step="0.0001" value={r.input} onChange={(e) => setRow(i, "input", e.target.value)} className={INPUT} />
                <input type="number" min="0" step="0.0001" value={r.output} onChange={(e) => setRow(i, "output", e.target.value)} className={INPUT} />
                <button type="button" onClick={() => removeRow(i)} className="p-1.5 rounded-lg text-neutrals-medium hover:text-red-300 hover:bg-white/5 cursor-pointer" title="Remove this row" aria-label={`Remove the row for ${r.model || "this model"}`}>
                  <RiDeleteBinLine size={14} />
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {unlisted.map((m) => (
            <button key={m} type="button" onClick={() => addRow(m)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-[10px] font-mono text-neutrals-light hover:text-white hover:bg-white/10 cursor-pointer" title={seen.includes(m) ? "a model the run log has seen" : "a model the app is configured with"} data-pricing-add={m}>
              <RiAddLine size={12} /> {m}
            </button>
          ))}
          <button type="button" onClick={() => addRow("")} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-white/15 text-[10px] font-mono text-neutrals-medium hover:text-white cursor-pointer">
            <RiAddLine size={12} /> another model
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving || loading} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-vivid text-white text-xs font-sans font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" data-pricing-save>
          {saving ? <RiLoader4Line size={14} className="animate-spin" /> : <RiSaveLine size={14} />} Save the prices
        </button>
        <button type="button" onClick={load} disabled={saving || loading} className="px-3 py-2 rounded-xl border border-white/10 text-xs font-sans text-neutrals-light hover:text-white hover:bg-white/5 cursor-pointer disabled:opacity-50">
          Re-read
        </button>
        {message && <span className={`text-[11px] font-mono ${message.tone === "good" ? "text-teal-300" : message.tone === "warn" ? "text-amber-300" : "text-red-300"}`}>{message.text}</span>}
      </div>
    </div>
  );
}
