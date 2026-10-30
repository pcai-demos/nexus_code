/**
 * U-PRICING — polish Phase 3, pricing (inputs/demo-design/polish-design.md; the owner's PL-D10 to PL-D12 (a) of
 * 2026-10-14): the price table on the server (nexcode-data/state/settings/pricing.json, read and written through the
 * route for the Admin Panel's Misc tab), per model with a default row and a currency; the cost of every sum the usage
 * module gives, "no price set" when a model has no row and no default, never a zero; the Stats panel's cost card and
 * columns; the evidence record (schema 0.12) stamping the prices it used. Also the shared split bars (the legend in the
 * segments' colours, a tooltip per segment) and the Stats panel's session table (the owner, 2026-10-14).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const P = require("../../src/lib/coding/pricing");
const U = require("../../src/lib/coding/usage");
const REC = require("../../src/lib/coding/record");
const { loadScenarios } = require("../../src/lib/coding/scenarios");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const at = (n) => `2026-10-14T11:${String(n).padStart(2, "0")}:00.000Z`;
const tokens = (prompt, completion, providerReported = true) => ({ prompt, completion, providerReported });
const composition = { system: 100, history: 0, evidence: 300, review: 0, layout: 0, files: 500, units: 0, disclosure: 0, tests: 0, fix: 0, instruction: 50, request: 50 };
const turn = (n, scenario, step, t, extra = {}) => ({ kind: "turn", at: at(n), scenario, step, turnId: `t${n}`, success: true, model: "qwen3.8:27b", tokens: t, fileOperations: [], cited: [], unverified: [], ...extra });
const PRICING = { currency: "GBP", default: null, models: { "qwen3.8:27b": { input: 1, output: 2 } } };
const s6 = () => loadScenarios().find((s) => s.id === "s6");

describe("U-PRICING: the pure module", () => {
  test("the table is normalised: the currency upper-case and three letters, rows need both prices as numbers (strings read), invalid rows named", () => {
    const { pricing, invalid } = P.normalisePricing({ currency: " gbp ", default: { input: "0.5", output: 1.5 }, models: { "qwen3.8:27b": { input: "1", output: "2" }, bad: { input: "x", output: 1 }, "": { input: 1, output: 1 }, neg: { input: -1, output: 1 } } });
    assert.deepStrictEqual(pricing, { currency: "GBP", default: { input: 0.5, output: 1.5 }, models: { "qwen3.8:27b": { input: 1, output: 2 } } });
    assert.deepStrictEqual(invalid, ["bad", "neg"]);
    assert.deepStrictEqual(P.normalisePricing(null).pricing, { currency: "GBP", default: null, models: {} });
    assert.strictEqual(P.normalisePricing({ currency: "pounds" }).pricing.currency, "GBP", "a bad code falls back");
    assert.strictEqual(P.normalisePricing({ currency: "usd" }).pricing.currency, "USD");
  });

  test("a model's own row first, then the default, else nothing; the cost per million; never a zero for no price", () => {
    assert.deepStrictEqual(P.priceFor(PRICING, "qwen3.8:27b"), { input: 1, output: 2, source: "model" });
    assert.strictEqual(P.priceFor(PRICING, "other"), null);
    assert.deepStrictEqual(P.priceFor({ ...PRICING, default: { input: 3, output: 4 } }, "other"), { input: 3, output: 4, source: "default" });
    assert.strictEqual(P.amountOf({ prompt: 1000, completion: 200 }, { input: 1, output: 2 }), 0.0014);
    assert.strictEqual(P.amountOf({ prompt: 1500000, completion: 250000 }, { input: 1, output: 2 }), 2);
    assert.strictEqual(P.formatMoney(0.0014, "GBP"), "£0.0014 GBP");
    assert.strictEqual(P.formatMoney(2, "USD"), "$2.0000 USD");
    assert.strictEqual(P.formatMoney(1.5, "CHF"), "1.5000 CHF");
    assert.strictEqual(P.formatMoney(null, "GBP"), "no price set");
  });

  test("the cost of a sum uses each model's own row and names the unpriced models; the usage summary is costed through", () => {
    const sum = U.sumTokens([turn(1, "s6", "build", tokens(1000, 200)), turn(2, "s6", "build", tokens(500, 50), { model: "other" })].map(U.answerOf));
    assert.deepStrictEqual(sum.byModel, { "qwen3.8:27b": { answers: 1, prompt: 1000, completion: 200 }, other: { answers: 1, prompt: 500, completion: 50 } });
    const c = P.costOfSum(sum, PRICING);
    assert.deepStrictEqual([c.amount, c.currency, c.source, c.unpriced, Object.keys(c.priced)], [null, "GBP", "table", ["other"], ["qwen3.8:27b"]]);
    const c2 = P.costOfSum(sum, { ...PRICING, default: { input: 10, output: 10 } });
    assert.deepStrictEqual([c2.amount, c2.unpriced, c2.priced.other.source], [0.0014 + 0.0055, [], "default"]);
    const noModel = U.sumTokens([{ kind: "chat-turn", at: at(3), scenario: null, tokens: tokens(100, 10) }].map(U.answerOf));
    assert.deepStrictEqual(P.costOfSum(noModel, PRICING).unpriced, ["unknown"], "a line naming no model is priced at the default row only");
    assert.deepStrictEqual(P.costOfSum(U.sumTokens([]), PRICING).amount, 0, "nothing counted costs nothing");
    const events = [{ kind: "reset-all", at: at(0) }, { kind: "select", scenario: "s6", at: at(1) }, turn(2, "s6", "build", tokens(1000, 200)), turn(3, "s6", "comment", tokens(500, 50))];
    const priced = P.priceUsage(U.usageSummary(events, { scenarioId: "s6", scenarios: loadScenarios() }), PRICING);
    assert.deepStrictEqual(priced.demo.steps.map((st) => [st.id, st.cost.amount]), [
      ["build", 0.0014],
      ["comment", 0.0006],
    ]);
    assert.deepStrictEqual([priced.demo.totals.cost.amount, priced.session.cost.amount, priced.session.demos[0].cost.amount], [0.002, 0.002, 0.002]);
    assert.deepStrictEqual(priced.demo.pricingUsed, { currency: "GBP", default: null, models: { "qwen3.8:27b": { input: 1, output: 2, source: "model" } } });
    assert.deepStrictEqual(priced.session.pricingUsed.models, priced.demo.pricingUsed.models);
    assert.strictEqual(P.priceUsage(null, PRICING), null);
  });
});

describe("U-PRICING: the record, the route, the Admin Panel, the Stats panel, the report and the bars", () => {
  const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
  const admin = codeOnly(read("src/components/AdminDrawer.jsx"));
  const panel = codeOnly(read("src/components/PricingPanel.jsx"));
  const stats = codeOnly(read("src/components/StatsDrawer.jsx"));
  const report = codeOnly(read("src/components/presenter/RecordReport.jsx"));
  const bars = codeOnly(read("src/components/presenter/SplitBars.jsx"));

  test("the record (schema 0.12) costs each step and the total at the prices given, stamps the rows used, and prints them; without a table it says no price set", () => {
    const events = [{ kind: "select", scenario: "s6", at: at(0) }, turn(1, "s6", "build", tokens(1000, 200), { composition, thinking: { mode: "on", reasoningChars: 300 }, answerChars: 100 }), turn(2, "s6", "comment", tokens(500, 50))];
    const { json, markdown } = REC.buildEvidenceRecord({ scenario: s6(), events, recordId: "0a1b2c3d", now: new Date(at(30)), pricing: PRICING });
    assert.strictEqual(json.schema, "nexcode.evidence/0.12");
    assert.deepStrictEqual(json.usage.steps.map((st) => [st.id, st.cost.amount, st.cost.currency, st.cost.source]), [
      ["build", 0.0014, "GBP", "table"],
      ["comment", 0.0006, "GBP", "table"],
    ]);
    assert.deepStrictEqual([json.usage.totals.cost.amount, json.usage.pricingUsed.models["qwen3.8:27b"]], [0.002, { input: 1, output: 2, source: "model" }]);
    assert.match(markdown, /\| Build it \| 1 \| 1000 \| 200 \| 1200 \| £0\.0014 GBP \|\n\| Comment it \| 1 \| 500 \| 50 \| 550 \| £0\.0006 GBP \|\n\| \*\*Total\*\* \| 2 \| \*\*1500\*\* \| \*\*250\*\* \| \*\*1750\*\* \| \*\*£0\.0020 GBP\*\* \|/);
    assert.match(markdown, /Costed at the prices in force when this record was built, per million tokens in GBP: qwen3\.8:27b in 1, out 2; source: the Admin Panel's price table\./);
    const bare = REC.buildEvidenceRecord({ scenario: s6(), events, recordId: "0a1b2c3d", now: new Date(at(30)) });
    assert.deepStrictEqual([bare.json.usage.totals.cost.amount, bare.json.usage.totals.cost.unpriced], [null, ["qwen3.8:27b"]]);
    assert.match(bare.markdown, /\| \*\*no price set\*\* \|\n\nTokens as the model server reported them[^\n]*\n\nNo price was set for: qwen3\.8:27b \(Admin Panel › Misc\), so no cost is given\./);
  });

  test("the route keeps the table under nexcode-data/state/settings, reads it for usage and the record, and writes it normalised", () => {
    assert.match(route, /const SETTINGS_DIR = path\.join\(process\.cwd\(\), "nexcode-data", "state", "settings"\);\s*const PRICING_FILE = path\.join\(SETTINGS_DIR, "pricing\.json"\);/);
    assert.match(route, /function readPricing\(\) \{\s*try \{\s*return normalisePricing\(JSON\.parse\(fs\.readFileSync\(PRICING_FILE, "utf8"\)\)\)\.pricing;\s*\} catch \{\s*return EMPTY_PRICING;\s*\}/);
    assert.match(route, /return priceUsage\(usageSummary\(readRuns\(\{ limit: 5000 \}\), \{ scenarioId: scenario \? scenario\.id : null, scenarios \}\), readPricing\(\)\);/);
    assert.match(route, /failed: failure,\s*pricing: readPricing\(\),\s*\}\);/, "the record is costed at the prices in force when it is built");
    assert.match(route, /const \{ pricing, invalid \} = normalisePricing\(body && body\.pricing\);[\s\S]*?fs\.writeFileSync\(PRICING_FILE, `\$\{JSON\.stringify\(pricing, null, 2\)\}\\n`, "utf8"\);/);
    assert.match(route, /appendRun\(\{ kind: "pricing", currency: pricing\.currency, models: Object\.keys\(pricing\.models\)\.length, default: Boolean\(pricing\.default\) \}\);/, "a change of prices is on the run log");
    assert.match(route, /case "pricing-read":\s*return NextResponse\.json\(pricingRead\(\)\);\s*case "pricing-write": \{/);
    assert.match(route, /const seen = \[\.\.\.new Set\(readRuns\(\{ limit: 5000 \}\)\.filter\(\(e\) => ANSWER_KINDS\.includes\(e\.kind\) && typeof e\.model === "string" && e\.model\)\.map\(\(e\) => e\.model\)\)\];/);
  });

  test("the Admin Panel has a Misc tab, always shown, holding the pricing panel; the panel reads and writes through the route", () => {
    assert.match(admin, /visibleTabs\.push\(\{ id: "misc", label: "Misc" \}\);/);
    assert.ok(/misc: \{\s*color: "#F59E0B",/.test(admin));
    assert.match(admin, /\{currentActiveTab === "misc" && \(\s*<PricingPanel configuredModels=\{\[localOllamaModelName, localCodeOllamaModelName, localLiteLlmModelName, localCodeLiteLlmModelName\]\} \/>\s*\)\}/);
    assert.match(panel, /post\(\{ action: "pricing-read" \}\)/);
    assert.match(panel, /post\(\{ action: "pricing-write", pricing: body \}\)/);
    assert.match(panel, /const body = \{ currency, default: useDefault \? defaultRow : null, models \};/);
    assert.ok(!/localStorage/.test(panel), "the prices live on the server, not in this browser");
    for (const s of ["data-pricing-currency", "data-pricing-default", "data-pricing-save", "data-pricing-add=\\{m\\}", "never a zero"]) assert.ok(new RegExp(s).test(panel), s);
    assert.ok(!/type="submit"/.test(panel), "its buttons never submit the Admin Panel's form");
  });

  test("the Stats panel: the cost card, a cost column in both tables, the session as a table, wider", () => {
    assert.match(stats, /import \{ formatMoney \} from "@\/lib\/coding\/pricing";/);
    assert.match(stats, /max-w-3xl/);
    assert.match(stats, /Session Cost/);
    assert.match(stats, /no price set for \$\{ses\.cost\.unpriced\.join\(", "\)\}: Admin Panel › Misc/);
    assert.match(stats, /data-stats-session-demo=\{d\.id\}/);
    assert.match(stats, /<th className="text-right font-normal pb-1">Cost<\/th>/);
    assert.strictEqual((stats.match(/formatMoney\(/g) || []).length, 7, "every cost printed by the module's formatter: the card, three demo rows, three session rows");
    assert.ok(!/toFixed\(/.test(stats), "no local arithmetic or formatting of the money");
  });

  test("the report: the cost column, the prices used; the bars: the legend in the segments' colours and a tooltip per segment", () => {
    assert.match(report, /import \{ formatMoney \} from "@\/lib\/coding\/pricing";/);
    assert.match(report, /data-report-usage-cost=/);
    assert.match(report, /data-report-pricing-used/);
    assert.match(report, /<SplitBar compact title="Input" groups=\{record\.usage\.split\.input\} hues=\{INPUT_HUES\} \/>\s*<SplitBar compact title="Output" groups=\{record\.usage\.split\.output\} hues=\{OUTPUT_HUES\} \/>/);
    assert.match(stats, /<SplitBar title="Input: what the prompt was made of" groups=\{split\.input\} hues=\{INPUT_HUES\} \/>/);
    assert.match(bars, /<span key=\{g\.id\} className=\{`flex items-center gap-1 \$\{hue\(i\)\.text\}`\} title=\{valueOf\(g\)\}>/, "the legend's label in its segment's colour");
    assert.match(bars, /role="tooltip"[\s\S]*?group-hover:opacity-100/, "the value shows on hover");
    assert.match(bars, /data-split-segment=\{g\.id\}/);
  });
});
