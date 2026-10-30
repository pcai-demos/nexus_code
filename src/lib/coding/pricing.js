/**
 * src/lib/coding/pricing.js — the price table and the cost of the tokens (polish Phase 3; the owner's PL-D10 to
 * PL-D12 (a) of 2026-10-14; inputs/demo-design/polish-design.md).
 *
 * Pure (no I/O). The table lives on the server, in nexcode-data/state/settings/pricing.json, read and written by the
 * scenarios route for the Admin Panel's Misc tab (PL-D10 (a)), so a record built on the server can stamp the prices it
 * used, and a second browser sees the same prices. Its shape, prices per MILLION tokens:
 *   { currency: "GBP", default: { input, output } | null, models: { "<model id>": { input, output } } }
 * A turn's cost uses its own model's row, or the default row for a model not listed (PL-D11 (a)); when a counted model
 * has neither, the cost is null and the model is named as unpriced: "no price set", never a zero (PL-D12 (a)). Every
 * cost carries `source: "table"`, so a figure reported by LiteLLM's own API can take the same place later (the owner's
 * note of 2026-10-14: held until LiteLLM is the inference endpoint).
 *
 * priceUsage takes the usage module's summary (usage.js), whose sums carry the tokens by model (`byModel`), and adds a
 * `cost` to each sum and `pricingUsed` to the demo and the session: the rows the costs were computed with.
 */

const CURRENCY = /^[A-Z]{3}$/;
const SYMBOLS = Object.freeze({ GBP: "£", USD: "$", EUR: "€" });
const EMPTY_PRICING = Object.freeze({ currency: "GBP", default: null, models: {} });
const MODEL_ID_MAX = 120;

/** A price per million tokens: a non-negative number, or a string that reads as one; else null. */
function money(v) {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

/** A row `{ input, output }`, both prices present and valid; else null. */
function rowOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const input = money(raw.input);
  const output = money(raw.output);
  return input === null || output === null ? null : { input, output };
}

/** The table as stored, from whatever was given: `{ pricing, invalid }`, invalid naming the model rows left out. */
function normalisePricing(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const code = typeof r.currency === "string" ? r.currency.trim().toUpperCase() : "";
  const currency = CURRENCY.test(code) ? code : EMPTY_PRICING.currency;
  const models = {};
  const invalid = [];
  if (r.models && typeof r.models === "object" && !Array.isArray(r.models)) {
    for (const [id, row] of Object.entries(r.models)) {
      const key = String(id).trim();
      if (!key || key.length > MODEL_ID_MAX) continue;
      const v = rowOf(row);
      if (v) models[key] = v;
      else invalid.push(key);
    }
  }
  return { pricing: { currency, default: rowOf(r.default), models }, invalid };
}

/** The row a model's cost uses: its own, else the default, else null; `source` says which. */
function priceFor(pricing, model) {
  const p = pricing && typeof pricing === "object" ? pricing : EMPTY_PRICING;
  if (model && p.models && p.models[model]) return { ...p.models[model], source: "model" };
  if (p.default) return { ...p.default, source: "default" };
  return null;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** The cost of `tokens` `{ prompt, completion }` at `row`, prices per million. */
function amountOf(tokens, row) {
  return round6((tokens.prompt / 1e6) * row.input + (tokens.completion / 1e6) * row.output);
}

/**
 * The cost of a sum (usage.js sumTokens: `byModel`): each model at its own row. `amount` is null when any counted
 * model has no row and no default ("no price set"); `priced` keeps the rows used and `unpriced` the models without one.
 */
function costOfSum(sum, pricing) {
  const p = pricing && typeof pricing === "object" ? pricing : EMPTY_PRICING;
  const byModel = sum && sum.byModel && typeof sum.byModel === "object" ? sum.byModel : {};
  let amount = 0;
  const priced = {};
  const unpriced = [];
  for (const [model, t] of Object.entries(byModel)) {
    const row = priceFor(p, model === "unknown" ? null : model);
    if (!row) {
      unpriced.push(model);
      continue;
    }
    amount += amountOf({ prompt: t.prompt || 0, completion: t.completion || 0 }, row);
    priced[model] = { input: row.input, output: row.output, source: row.source };
  }
  return { amount: unpriced.length ? null : round6(amount), currency: p.currency, source: "table", priced, unpriced };
}

/** The usage summary with a cost on every sum, and the rows used on the demo and the session. */
function priceUsage(usage, pricing) {
  if (!usage || typeof usage !== "object") return usage;
  const p = pricing && typeof pricing === "object" ? pricing : EMPTY_PRICING;
  const withCost = (sum) => (sum && typeof sum === "object" ? { ...sum, cost: costOfSum(sum, p) } : sum);
  const used = (sums) => {
    const models = {};
    for (const s of sums) for (const [m, row] of Object.entries(s && s.cost ? s.cost.priced : {})) models[m] = row;
    return { currency: p.currency, default: p.default, models };
  };
  const out = { ...usage };
  if (usage.demo && typeof usage.demo === "object") {
    const steps = (usage.demo.steps || []).map(withCost);
    const freeForm = withCost(usage.demo.freeForm);
    const totals = withCost(usage.demo.totals);
    out.demo = { ...usage.demo, steps, freeForm, totals, pricingUsed: used([totals]) };
  }
  if (usage.session && typeof usage.session === "object") {
    const demos = (usage.session.demos || []).map(withCost);
    const session = withCost(usage.session);
    out.session = { ...session, demos, freeForm: withCost(usage.session.freeForm), pricingUsed: used([session]) };
  }
  return out;
}

/** An amount for the eye: "£0.1234 GBP", "no price set" when null; the module formats so the panels do no arithmetic. */
function formatMoney(amount, currency, { decimals = 4 } = {}) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "no price set";
  const code = typeof currency === "string" && CURRENCY.test(currency) ? currency : EMPTY_PRICING.currency;
  const symbol = SYMBOLS[code] || "";
  return `${symbol}${amount.toFixed(decimals)} ${code}`;
}

module.exports = { EMPTY_PRICING, SYMBOLS, normalisePricing, priceFor, amountOf, costOfSum, priceUsage, formatMoney };
