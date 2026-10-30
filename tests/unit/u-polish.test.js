/**
 * U-POLISH — the polish phase (inputs/demo-design/polish-design.md; the owner's answers of 2026-10-14).
 *
 * Phase 1, the demo selection screen (PL-D1 to PL-D6): the Demo icon is first in the sidebar and opens the screen; one
 * card per demo with its icon (new to the definitions), title, summary, language, step count and "about N min"; Select
 * sets the demo up (opening the IDE panel and waiting for the bridge when it is down) and returns to the app through
 * the handler the Demo panel uses; Details opens the Demo panel on that demo; free flow clears the active demo.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { loadScenarios, validateScenario } = require("../../src/lib/coding/scenarios");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/** PL-D2 (a): the seven icons the owner chose, Remixicon names. */
const ICONS = { s1: "RiBugLine", s2: "RiGitPullRequestLine", s3: "RiCupLine", s3r: "RiSettings5Line", s4: "RiScalesLine", s5: "RiDoubleQuotesL", s6: "RiHammerLine" };

describe("U-POLISH: the definitions carry an icon (PL-D2 (a)); the runtime is the definition's minutes (PL-D3 (a)); seven cards (PL-D4 (a))", () => {
  test("every demo has its chosen icon, and each exists in the icon set", () => {
    const icons = require("@remixicon/react");
    const all = loadScenarios();
    assert.deepStrictEqual(Object.fromEntries(all.map((s) => [s.id, s.icon])), ICONS);
    for (const name of Object.values(ICONS)) assert.ok(["function", "object"].includes(typeof icons[name]), `${name} exists in the icon set`);
    assert.deepStrictEqual(all.map((s) => [s.id, s.minutes]), [["s1", 4], ["s2", 4], ["s3", 5], ["s3r", 5], ["s4", 2], ["s5", 4], ["s6", 10]], "the approximate minutes the cards show");
    assert.ok(all.every((s) => s.summary && s.summary.length > 20), "every card has its one-line summary");
  });

  test("the schema: an icon is a Remixicon component name, optional", () => {
    const base = { id: "s9", title: "T", ticket: { id: "T-1", path: "nexus-payments/backlog/t.md" }, steps: [{ id: "e", prompt: "p" }] };
    assert.strictEqual(validateScenario({ ...base, icon: "RiBugLine" }).icon, "RiBugLine");
    assert.strictEqual(validateScenario(base).icon, null);
    for (const bad of ["bug", "RiBug Line", "ri-bug-line", "Ri"]) assert.throws(() => validateScenario({ ...base, icon: bad }), /icon must be a Remixicon component name/, bad);
  });

  test("the route's card carries the icon to the page", () => {
    const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
    assert.match(route, /minutes: s\.minutes,\s*icon: s\.icon,\s*select: s\.select,/);
  });
});

describe("U-POLISH: the selection screen (PL-D1 (a), PL-D5 (a), PL-D6 (a)) and the sidebar", () => {
  const screen = codeOnly(read("src/components/presenter/DemoSelect.jsx"));
  const page = codeOnly(read("src/app/page.js"));
  const sidebar = codeOnly(read("src/components/Sidebar.jsx"));

  test("the sidebar: the Demo icon is first and toggles the selection screen; every other icon closes it", () => {
    assert.match(sidebar, /const topItems = \[\s*\{\s*id: "demo",\s*label: "Demo",\s*tooltip: "Demos: choose a demo, or free flow",\s*icon: "RiSlideshow3Line",/);
    assert.match(sidebar, /isActive: Boolean\(isDemoSelectOpen\) \|\| Boolean\(isDemoOpen\),/);
    assert.match(sidebar, /if \(setIsDemoSelectOpen\) setIsDemoSelectOpen\(!isDemoSelectOpen\);\s*if \(setIsDemoOpen\) setIsDemoOpen\(false\);/, "the icon opens the screen and closes the panel");
    assert.strictEqual((sidebar.match(/setIsDemoSelectOpen\(!isDemoSelectOpen\)/g) || []).length, 1);
    assert.ok((sidebar.match(/if \(setIsDemoSelectOpen\) setIsDemoSelectOpen\(false\);/g) || []).length >= 4, "Documents, Results, File Browser and the lower icons close it");
    const ids = [...sidebar.matchAll(/^\s*id: "([a-z-]+)",$/gm)].map((m) => m[1]);
    assert.deepStrictEqual(ids, ["demo", "chat", "ide", "documents", "results", "file-browser"]);
  });

  test("the page: the screen is mounted, Select shares the Demo panel's handler, Details opens the panel, free flow clears the demo, the resets close it", () => {
    assert.match(page, /import DemoSelect from "@\/components\/presenter\/DemoSelect";/);
    assert.match(page, /<DemoSelect\s+open=\{isDemoSelectOpen\}\s+activeDemoId=\{activeDemoId\}/);
    assert.match(page, /onOpenIde=\{\(\) => setIdeOpen\(true\)\}/, "PL-D5 (a): Select opens the IDE panel");
    assert.match(page, /onDetails=\{\(scenario\) => presenter\.openDemoPanel\("overview", scenario\.id\)\}/);
    assert.match(page, /onFreeFlow=\{\(\) => \{\s*setIsDemoSelectOpen\(false\);\s*setActiveScenarioStep\(null\);\s*setActiveDemoId\(null\);\s*setDemoRequest\(null\);\s*\}\}/, "PL-D6 (a): the step bar goes, nothing else is touched");
    assert.ok(!/onFreeFlow=\{\(\) => \{[^}]*handleResetState/.test(page), "free flow never clears the chat");
    assert.strictEqual((page.match(/onSelected=\{demoSelected\}/g) || []).length, 2);
    assert.match(page, /openDemoPanel: \(section = "overview", scenarioId = null\) => \{[\s\S]*?setIsDemoSelectOpen\(false\);\s*setIsDemoOpen\(true\);/, "the panel replaces the screen");
    assert.match(page, /setWorkspaceTick\(\(n\) => n \+ 1\);\s*setIsDemoSelectOpen\(false\);/, "the environment reset closes it");
    assert.match(page, /isDemoSelectOpen=\{isDemoSelectOpen\}\s*setIsDemoSelectOpen=\{setIsDemoSelectOpen\}/);
  });

  test("the screen: one card per demo with the icon, the step count and the minutes; Select, Details and free flow; the bridge wait", () => {
    assert.match(screen, /post\(\{ action: "state", light: true \}\)/, "the light state: the demos and the bridge, no store read");
    assert.match(screen, /post\(\{ action: "select", scenarioId: s\.id \}\)/, "the Demo panel's own select action");
    assert.match(screen, /const BRIDGE_WAIT_MS = 15000;/);
    assert.match(screen, /if \(await refresh\(\)\) return true;\s*if \(typeof onOpenIde === "function"\) onOpenIde\(\);/, "the bridge up, or the IDE panel opened and waited for");
    assert.match(screen, /const Icon = name && Icons\[name\] \? Icons\[name\] : RiSlideshow3Line;/, "an unknown icon name falls back, never throws");
    assert.match(screen, /\{steps\} steps/);
    assert.match(screen, /about \{s\.minutes\} min/);
    assert.match(screen, /data-select-demo=\{s\.id\}/);
    assert.match(screen, /data-demo-details=\{s\.id\}/);
    assert.match(screen, /data-free-flow/);
    assert.match(screen, /Free flow: no demo/);
    assert.match(screen, /if \(e\.key === "Escape" && typeof onClose === "function"\) onClose\(\);/);
    assert.match(screen, /className="fixed top-20 left-20 right-0 bottom-0 z-50/, "an overlay over the workbench, as the Demo panel is: the IDE column stays mounted");
    assert.ok(!/action: "reset|\/api\/(ingest|rag)/.test(screen), "the screen never resets anything itself and never touches the store");
  });
});
