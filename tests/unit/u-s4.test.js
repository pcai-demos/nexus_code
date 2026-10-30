/**
 * U-S4 — the closer (s4-design.md; the owner's S4-D1 to S4-D6 of 2026-10-12): the evidence record and the auditor's
 * question. Selecting S4 resets nothing (S4-D6); its first step opens the Results panel on the latest record of any demo
 * since the environment reset, or the shipped example record (S4-D2 (a)); the question goes first to the document chat
 * (/doc) and then to NexCODE's four layers as an `audit` turn (S4-D1 (c)), on two scripted questions (S4-D3 (a)) with the
 * per-layer topics and the instruction measured on 2026-10-12 (inputs/demo-design/evidence/session-90-s4-probe/); the
 * regulator provisions the policy clauses' "Traces to:" lines name are looked up in their own documents through the
 * checked index (S4-D5 (a)); the answer is recorded (S4-D4 (a)).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { loadScenarios, validateScenario, loadRegulatorIndex, loadExampleRecord, loadManifest } = require("../../src/lib/coding/scenarios");
const { requestInstruction } = require("../../src/lib/coding/persona");
const { chatText } = require("../../src/lib/coding/chat_text");
const { stepStates, flowLayout, answersOnly } = require("../../src/lib/coding/steps");
const { evidenceBlock, resolvePillars, scopePillars } = require("../../src/lib/coding/pillars");
const { withTracedPassages } = require("../../src/lib/coding/rule_chain");
const { liveTurnReducer } = require("../../src/lib/coding/turn_client");
const R = require("../../src/lib/coding/regulator_refs");
const REC = require("../../src/lib/coding/record");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const byId = (id) => loadScenarios().find((s) => s.id === id);
const at = (n) => `2026-10-12T10:${String(n).padStart(2, "0")}:00.000Z`;
const Q1 = "Which of our standards require decimal arithmetic for monetary values, and which regulation do they trace to?";
const Q2 = "Which of our rules govern code written with an AI assistant, and which regulator expectations do they rest on?";
// The per-layer topics measured on 2026-10-12 (session-90-s4-probe, make_b.js and make_b_q2.js, variant B2), restated.
const Q1_TOPICS = {
  regulator: ["the full amount of the payment transaction is transferred and no charges are deducted from the amount transferred", "sound administrative and accounting procedures"],
  corporate: ["accurate records of payment transactions and charges"],
  sdlc: ["amounts, fees and charges held and calculated in a decimal type", "amounts and rates parsed into the decimal type from their text form", "every monetary value carries its currency and a scale of two decimal places"],
  team: ["money is never a float", "decimal, never float", "no binary floating point for money"],
};
const Q2_TOPICS = {
  regulator: ["firms remain accountable under existing rules for their use of AI", "governance, human oversight and accountability of AI models", "a senior manager responsible for the use of AI"],
  corporate: ["AI-assisted development is software development: existing controls apply", "a human reviews and approves every AI-generated change", "AI-assisted changes are labelled", "records of AI use are kept with the change record"],
  sdlc: ["AI-generated changes are labelled and reviewed by a human"],
  team: ["using an AI coding assistant on this team", "AI-assisted pull requests"],
};
// The audit instruction measured on 2026-10-12 (b_probe.js and b_q2_probe.js hold it verbatim), restated.
const AUDIT_INSTRUCTION =
  "This request is an auditor's question about the firm's rules, not a code change: do not write code or File blocks. Answer from the EVIDENCE only. For each rule that answers the question, name it by its ID and cite its passage marker, then follow its \"Traces to:\" line up to the policy clause and the regulation it rests on, citing each of those passages too. Say plainly when a link in a chain is not among the passages.";
const FIN_43 =
  "**FIN-POL-003 clause 4.3: Accurate records of payment transactions and charges.** Every payment transaction, customer charge and card scheme fee is calculated exactly, to the penny, under a documented rule.\nTraces to: Payment Services Regulations 2017, regulation 84(1) and (2); FCA SYSC 4.1.1R (sound administrative and accounting procedures).";

describe("U-S4: the definition (S4-D1, S4-D3, S4-D6)", () => {
  test("S4 resets nothing, shows the latest record, asks /doc then NexCODE on the two measured questions, and records the answer", () => {
    const s = byId("s4");
    assert.strictEqual(s.ticket.id, "IA-2026-14");
    assert.deepStrictEqual(s.select, { reset: false, runTests: false, branch: "main" }, "S4-D6: the demo's record stays");
    assert.deepStrictEqual(s.commands, { tests: null, select: null });
    assert.deepStrictEqual(
      s.steps.map((x) => [x.id, x.action, x.mode, x.optional]),
      [["show-record", "results", null, false], ["doc", null, "doc", false], ["money", null, "audit", false], ["ai", null, "audit", true], ["record", "record", null, false]]
    );
    const [, doc, money, ai] = s.steps;
    assert.strictEqual(doc.prompt, `/doc ${Q1}`, "the contrast asks the same question through the document chat");
    assert.deepStrictEqual(doc.chat, { lookupScope: "off" }, "as measured: the answer may span documents");
    assert.deepStrictEqual([money.prompt, ai.prompt], [Q1, Q2]);
    assert.deepStrictEqual(money.layerTopics, Q1_TOPICS);
    assert.deepStrictEqual(ai.layerTopics, Q2_TOPICS);
    for (const st of s.steps) assert.deepStrictEqual([st.attach, st.after, st.repair], [[], [], null], `${st.id}: no files, no follow-up, no repair`);
    assert.ok(answersOnly(s), "no step of S4 changes code");
    for (const id of ["s1", "s2", "s3", "s3r"]) assert.ok(!answersOnly(byId(id)), `${id} changes code`);
  });

  test("the card holds both chains' documents, each one the manifest knows, within the card's limit", () => {
    const s = byId("s4");
    const docs = s.card.artefacts.documents.map((d) => d.source);
    assert.ok(docs.length <= 24 && docs.length === new Set(docs).size);
    for (const need of [
      "PSRs_2017_April2026.pdf",
      "FCA_SYSC-4_October2026.pdf",
      "FCA_AI-Update_April2024.pdf",
      "BoE_AI-Letter-to-DSIT-HMT_April2024.pdf",
      "PCI-DSS-v4_0_1_June2024.pdf",
      "PRA_SS2-21_Outsourcing_November2024.pdf",
      "Nexus_FIN-POL-003_Financial-Controls-and-Reconciliation-Policy_v4.md",
      "Nexus_TEC-POL-005_AI-Assisted-Development-Policy_v2.md",
      "Nexus_PAY_Payments-Engineering-Standard_v3.md",
      "Nexus_REV_Code-Review-Standard_v2.md",
      "Nexus_ADR-004_Monetary-Amounts-Use-Decimal.md",
      "Nexus_PM-2024-011_Penny-Drift-Post-Mortem.md",
    ]) {
      assert.ok(docs.includes(need), need);
    }
    // Every regulator document the two chains' lookups need is on the card: the provisions FIN-POL-003 clause 4.3 and
    // every TEC-POL-005 clause name (a provision another clause names, in a document off the card, is reported as outside).
    const idx = loadRegulatorIndex();
    const fin = read("public/demos/demo_files/corporate_policies/Nexus_FIN-POL-003_Financial-Controls-and-Reconciliation-Policy_v4.md");
    const clause43 = fin.slice(fin.indexOf("**FIN-POL-003 clause 4.3:"), fin.indexOf("**FIN-POL-003 clause 4.4:"));
    const tec = read("public/demos/demo_files/corporate_policies/Nexus_TEC-POL-005_AI-Assisted-Development-Policy_v2.md");
    const keys = [...R.regulatorRefs(clause43), ...R.regulatorRefs(tec)].map((r) => r.key);
    assert.ok(keys.includes("psrs:84") && keys.includes("sysc:4.1.1R") && keys.includes("fca-ai:p16") && keys.includes("boe-ai:annex-9"));
    for (const k of keys) assert.ok(docs.includes(idx.entries[k].source), `${k}'s document ${idx.entries[k].source}`);
    assert.ok(fs.existsSync(path.join(ROOT, "public/demos/seed/nexus-payments/backlog/IA-2026-14.md")), "the ticket is in the seed");
  });

  test("the schema: a doc step asks /doc with nothing else; chat belongs to it; an audit step has no follow-up; results is an action", () => {
    const base = { id: "s9", title: "T", ticket: { id: "T-1", path: "nexus-payments/backlog/t.md" } };
    const ok = validateScenario({ ...base, steps: [{ id: "r", action: "results" }, { id: "d", mode: "doc", prompt: "/doc What applies?", chat: { lookupScope: "document" } }, { id: "a", mode: "audit", prompt: "What applies?" }] });
    assert.deepStrictEqual(ok.steps.map((x) => [x.action, x.mode, x.chat]), [["results", null, null], [null, "doc", { lookupScope: "document" }], [null, "audit", null]]);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "d", mode: "doc", prompt: "What applies?" }] }), /a doc step's prompt starts with "\/doc "/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "d", mode: "doc", prompt: "/doc What?", layerTopics: { sdlc: ["x"] } }] }), /no follow-up, files, hints or layer topics/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "d", mode: "doc", prompt: "/doc What?", attach: ["nexus-payments/backlog/t.md"] }] }), /no follow-up, files, hints or layer topics/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "d", mode: "doc", prompt: "/doc What?", chat: { lookupScope: "all" } }] }), /chat\.lookupScope must be off or document/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "a", mode: "audit", prompt: "What?", chat: { lookupScope: "off" } }] }), /chat belongs to a doc step/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "a", mode: "audit", prompt: "What?", after: ["run-tests"] }] }), /an audit step answers in the chat: it has no follow-up/);
    assert.throws(() => validateScenario({ ...base, steps: [{ id: "r", action: "results", mode: "audit" }] }), /an action step has no mode/);
  });
});

describe("U-S4: the step gate and the flow", () => {
  const s4 = byId("s4");
  const SELECT = { kind: "select", scenario: "s4", at: at(1) };
  const SHOWN = { kind: "results-shown", scenario: "s4", recordId: "aaaa1111", example: false, at: at(2) };
  const DOC = (n, success) => ({ kind: "doc-turn", scenario: "s4", step: "doc", success, at: at(n) });
  const AUDIT = (n, step) => ({ kind: "turn", scenario: "s4", step, mode: "audit", success: true, turnId: `t${n}`, at: at(n) });
  const RECORDED = { kind: "record", scenario: "s4", recordId: "bbbb2222", outcome: "ready", at: at(9) };

  test("show the record, ask the document chat, ask NexCODE, record the answer, show the results; a failed /doc is asked again", () => {
    const walk = (events) => {
      const st = stepStates(s4, events);
      return [st.steps.map((x) => x.status).join(" "), st.next.action, st.next.label];
    };
    assert.deepStrictEqual(walk([SELECT]), ["ready locked locked locked locked", "show-record", "Show the latest record"]);
    assert.deepStrictEqual(walk([SELECT, SHOWN]), ["done ready locked locked locked", "ask", "Ask the document chat (/doc)"]);
    const failed = stepStates(s4, [SELECT, SHOWN, DOC(3, false)]);
    assert.deepStrictEqual([failed.next.action, failed.next.detail], ["ask", "The last answer failed: ask again."]);
    assert.deepStrictEqual(walk([SELECT, SHOWN, DOC(3, false), DOC(4, true)]), ["done done ready locked locked", "ask", "Ask NexCODE: The auditor's question"]);
    assert.deepStrictEqual(walk([SELECT, SHOWN, DOC(4, true), AUDIT(5, "money")]), ["done done done ready ready", "record", "Record the answer"]);
    const done = stepStates(s4, [SELECT, SHOWN, DOC(4, true), AUDIT(5, "money"), RECORDED]);
    assert.deepStrictEqual([done.complete, done.next.action, done.next.detail], [true, "results", "Every step is done: show the room the evidence record of the answer."]);
    assert.strictEqual(stepStates(s4, [SELECT, SHOWN, DOC(4, true), AUDIT(5, "money"), RECORDED, { kind: "select", scenario: "s4", at: at(10) }]).next.action, "show-record", "a new Select starts again");
  });

  test("a doc step sent without its /doc reaches the coding turn, and that answer completes it too", () => {
    const st = stepStates(s4, [SELECT, SHOWN, { kind: "turn", scenario: "s4", step: "doc", mode: "audit", success: true, turnId: "t3", at: at(3) }]);
    assert.strictEqual(st.steps.find((x) => x.id === "doc").status, "done");
    const other = stepStates(byId("s1"), [{ kind: "select", scenario: "s1", at: at(1) }, { kind: "doc-turn", scenario: "s1", step: "diagnose", success: true, at: at(2) }]);
    assert.strictEqual(other.steps[0].status, "ready", "a doc-turn line completes only a doc step");
  });

  test("the flow: the record shown, the document chat for contrast, the questions fed by the four layers, the record", () => {
    const l = flowLayout(s4);
    assert.deepStrictEqual(
      l.nodes.map((n) => [n.kind, n.label, n.sub]),
      [
        ["ticket", "IA-2026-14", "opened in the IDE"],
        ["results", "1. Show the latest record", "the latest evidence record"],
        ["doc", "2. The document chat first", "the document chat, for contrast"],
        ["prompt", "3. The auditor's question", "the chain in the chat"],
        ["prompt", "4. AI governance", "optional"],
        ["record", "5. Record the answer", "from the run log"],
      ]
    );
    assert.deepStrictEqual(l.layers.targets, ["money", "ai"], "the document chat does not search the four layers");
  });
});

describe("U-S4: the regulator follow-through (S4-D5 (a))", () => {
  test("trace lines become provision keys: lists, ranges, letters and the regulators' own forms; a policy clause names none", () => {
    assert.deepStrictEqual(R.regulatorRefs(FIN_43).map((r) => r.key), ["psrs:84", "sysc:4.1.1R"]);
    const keys = (line) => R.regulatorRefs(`Traces to: ${line}`).map((r) => r.key);
    assert.deepStrictEqual(keys("Payment Services Regulations 2017, regulations 89(1), 89(3) and 99(1)"), ["psrs:89", "psrs:99"]);
    assert.deepStrictEqual(keys("PRA SS2/21 paragraphs 2.3 to 2.6"), ["ss2-21:2.3", "ss2-21:2.4", "ss2-21:2.5", "ss2-21:2.6"]);
    assert.deepStrictEqual(keys("FCA SYSC 4.1.1R and 4.1.2R; PCI DSS v4.0.1 Requirements 3.2.1 and 3.5.1"), ["sysc:4.1.1R", "sysc:4.1.2R", "pci:3.2.1", "pci:3.5.1"]);
    assert.deepStrictEqual(keys("FCA AI Update (April 2024), page 10; Bank of England AI letter (22 April 2024), annex paragraph 9(c)(ii)"), ["fca-ai:p10", "boe-ai:annex-9"]);
    assert.deepStrictEqual(keys("TEC-POL-005 clauses 4.3 and 4.4."), [], "a policy clause is not a regulator provision");
    assert.deepStrictEqual(keys("none (squad practice)"), []);
    assert.strictEqual(R.ruleIdOf({ text: FIN_43 }), "FIN-POL-003 clause 4.3");
    assert.strictEqual(R.ruleIdOf({ text: "**PAY-012 Monetary values: types and rounding.** …" }), "PAY-012");
  });

  test("the provision is the passage on its own page where its words start earliest; never a repeat of its words elsewhere", () => {
    const anchor = "General requirements (1) A firm must have robust governance arrangements, which include a clear";
    const entry = { anchor, page: 4 };
    // Chunks overlap: the provision's first words end chunk 4 and open chunk 5, which carries the provision on.
    const end = { page: 4, chunkIndex: 4, text: "Application … R SYSC 4.1.1 General requirements (1) A firm must have robust governance arrangements, which include a clear" };
    const start = { page: 4, chunkIndex: 5, text: "(1) A firm must have robust governance arrangements, which include a clear organisational structure with well defined lines" };
    const repeat = { page: 9, chunkIndex: 30, text: "General requirements (1) A firm must have robust governance arrangements, which include a clear structure" };
    assert.deepStrictEqual([R.anchorStart(end.text, anchor), R.anchorStart(start.text, anchor), R.anchorStart("nothing here", anchor)], [6, -2, null]);
    assert.strictEqual(R.pickProvision([end, repeat, start], entry), start, "the passage that carries the provision on");
    assert.strictEqual(R.pickProvision([repeat], entry), null, "the same words on another page are not the provision");
    assert.strictEqual(R.pickProvision([], entry), null);
    assert.deepStrictEqual(R.REGULATOR_LOOKUP, { rerankEnabled: false, limit: 8, keepTopNAfterRerank: 8 }, "the whole pool of 8, the reranker off: the pick decides, not the rank");
    assert.strictEqual(R.REGULATOR_LOOKUPS_MAX, 6);
  });

  test("a provision is found only when a passage holds its opening words in order: eight in a row, a heading may differ", () => {
    const anchor = "General requirements (1) A firm must have robust governance arrangements, which include a clear";
    assert.ok(R.matchesAnchor("SYSC 4.1.1 R General requirements (1) A firm must have robust governance arrangements, which include a clear organisational structure", anchor));
    assert.ok(R.matchesAnchor("4.1.1 R (1) A firm must have robust governance arrangements, which include a clear structure", anchor), "the heading printed differently");
    assert.ok(!R.matchesAnchor("A firm must have robust arrangements, which include governance", anchor), "the words out of order");
    assert.ok(!R.matchesAnchor("", anchor) && !R.matchesAnchor("anything", ""));
  });

  test("the index covers every provision a policy clause, a standard or a team note names; every entry was checked against the store", () => {
    const idx = loadRegulatorIndex();
    const named = new Set();
    for (const dir of ["corporate_policies", "engineering_standards", "team_knowledge"]) {
      const base = path.join(ROOT, "public/demos/demo_files", dir);
      for (const f of fs.readdirSync(base).filter((n) => n.endsWith(".md"))) for (const r of R.regulatorRefs(fs.readFileSync(path.join(base, f), "utf8"))) named.add(r.key);
    }
    for (const k of named) assert.ok(idx.entries[k] || idx.unresolved.includes(k), `${k} is in the index or listed as unresolved`);
    assert.deepStrictEqual(idx.unresolved, ["ps21-3:1.7"]);
    // S6-D5 (b) of 2026-10-13: the OWASP ASVS entries, located in the PDF's own text, were checked against the store
    // after the owner's ingest (session-90-s6-measure/verify_asvs.js), as S4's were; that check is recorded beside S4's.
    for (const [k, e] of Object.entries(idx.entries)) {
      assert.ok(R.wordsOf(e.anchor).length >= 8, `${k}'s anchor has eight words to match`);
      assert.strictEqual(e.verified, true, `${k} was found in the store`);
      assert.strictEqual(e.storePage, e.page, `${k}: found on the page the build located it on`);
    }
    assert.match(String(idx.asvsVerifiedAt), /^2026-10-13T/);
    // TEC-POL-005 4.4 cites page 16 for "the accountability and governance principle", printed half way down the page.
    assert.strictEqual(idx.entries["fca-ai:p16"].topic, "accountability and governance");
    assert.match(idx.entries["fca-ai:p16"].anchor, /^Accountability and governance Under this principle/);
    const sources = new Set(loadManifest().pillars.find((p) => p.id === "regulator").documents);
    for (const [k, e] of Object.entries(idx.entries)) assert.ok(sources.has(e.source), `${k}: ${e.source} is a regulator document`);
  });

  test("the lookups: each verified provision a corporate or standards passage names, once, with the rules that name it; none already in the evidence", () => {
    const idx = loadRegulatorIndex();
    const corp = { marker: "CORP-1", pillar: "corporate", source: "Nexus_FIN-POL-003_Financial-Controls-and-Reconciliation-Policy_v4.md", text: FIN_43 };
    const team = { marker: "TEAM-1", pillar: "team", source: "x.md", text: "**ADR-004 D1: …**\nTraces to: FCA SYSC 4.1.2R" };
    const looked = R.regulatorLookups([corp, team], idx);
    assert.deepStrictEqual(looked.map((l) => [l.key, l.source, l.tracedFrom]), [
      ["psrs:84", "PSRs_2017_April2026.pdf", ["FIN-POL-003 clause 4.3"]],
      ["sysc:4.1.1R", "FCA_SYSC-4_October2026.pdf", ["FIN-POL-003 clause 4.3"]],
    ], "a team note's trace line is not followed");
    const reg = { marker: "REG-1", pillar: "regulator", source: "FCA_SYSC-4_October2026.pdf", text: `SYSC 4.1.1 R ${idx.entries["sysc:4.1.1R"].anchor} organisational structure` };
    assert.deepStrictEqual(R.regulatorLookups([reg, corp], idx).map((l) => l.key), ["psrs:84"], "a provision the search already found is not looked up again");
    const unverified = { entries: { "psrs:84": { ...idx.entries["psrs:84"], verified: false } } };
    assert.deepStrictEqual(R.regulatorLookups([corp], unverified), [], "an unchecked entry is never looked up");
    assert.strictEqual(R.regulatorLookups([corp], idx, { max: 1 }).length, 1);
  });

  test("a looked-up provision joins the evidence with its page and its label, marked as traced from the rule; the S2 sentence stays S2's", () => {
    const pillars = scopePillars(resolvePillars(loadManifest(), loadManifest().pillars.flatMap((p) => p.documents).map((source) => ({ source, sourceIds: [`id-${source}`], chunkCount: 1 }))), null);
    const corp = { marker: "CORP-1", pillar: "corporate", source: "Nexus_FIN-POL-003_Financial-Controls-and-Reconciliation-Policy_v4.md", page: null, sectionPath: "4. Policy statements", text: FIN_43 };
    const item = { layer: "regulator", id: "FCA SYSC 4.1.1R", source: "FCA_SYSC-4_October2026.pdf", page: 4, sectionPath: "FCA SYSC 4.1.1R", text: "4.1.1 R (1) A firm must have robust governance arrangements …", tracedFrom: ["FIN-POL-003 clause 4.3"] };
    const merged = withTracedPassages([corp], [item], { regulator: "REG", corporate: "CORP", sdlc: "SDLC", team: "TEAM" });
    const reg = merged.passages[0];
    assert.deepStrictEqual([reg.marker, reg.page, reg.sectionPath, reg.locationKind, reg.via, reg.ruleId], ["REG-1", 4, "FCA SYSC 4.1.1R", "page", "trace", "FCA SYSC 4.1.1R"]);
    const ev = evidenceBlock(pillars, merged.passages, {});
    assert.match(ev, /\[REG-1\] FCA_SYSC-4_October2026\.pdf, page 4, section FCA SYSC 4\.1\.1R \(traced from FIN-POL-003 clause 4\.3\)/);
    assert.match(ev, /A regulation passage marked "traced from" a rule \(for example "traced from FIN-POL-003 clause 4\.3"\) was looked up, not searched/);
    assert.ok(!/traced from T1/.test(ev), "no tool finding in an audit turn: S2's sentence is not shown");
    const s2 = evidenceBlock(pillars, [{ ...corp, tracedFrom: ["T1"] }], {});
    assert.match(s2, /A passage marked "traced from T1" was looked up, not searched/);
    assert.ok(!/A regulation passage marked/.test(s2), "S2's evidence is as it was");
    const plain = withTracedPassages([], [{ layer: "sdlc", id: "PAY-012", title: "Monetary values", source: "p.md", text: "x", tracedFrom: ["T3"] }], { sdlc: "SDLC" }).passages[0];
    assert.deepStrictEqual([plain.page, plain.sectionPath, plain.locationKind, plain.cut], [null, "PAY-012 Monetary values", "section", false], "a rule chain's passage is as before");
  });
});

describe("U-S4: the audit turn", () => {
  const turn = codeOnly(read("src/lib/coding/turn.js"));

  test("the instruction is the measured one; code is left out of the chat, a diagram of the chain stays", () => {
    assert.strictEqual(requestInstruction({ mode: "audit" }), AUDIT_INSTRUCTION);
    assert.match(chatText("The rules.\n```java\nint x;\n```", { mode: "audit" }), /Code left out of the chat: this step answers a question about the rules; it changes no code\./);
    // Measured run 3 of the decimal-money question drew the chain in an untagged block: it is kept as written.
    const diagram = "## Summary of the chain\n\n```\nPAY-012\n   │ Traces to\n   ▼\nFIN-POL-003 clause 4.3\n```\n\nEvery link is present.";
    assert.strictEqual(chatText(diagram, { mode: "audit" }), diagram);
    assert.match(chatText(diagram, { mode: "explain" }), /Code left out of the chat: this step explains/, "other modes are unchanged");
    assert.match(chatText("A\n```text\n// File: nexus-payments/x.java\nint x;\n```", { mode: "audit" }), /Code left out of the chat/, "a File block is never kept");
    assert.strictEqual(liveTurnReducer(null, { type: "start", thinking: "on", mode: "audit" }).mode, "audit");
  });

  test("the turn looks each provision up in its own document, as the index was checked, and adds only the passage that is the provision", () => {
    assert.match(turn, /import \{ regulatorLookups, chooseLookups, pickProvision, REGULATOR_LOOKUP \} from "@\/lib\/coding\/regulator_refs";/, "the index check's own setting and rule");
    // S5-D11 (a): a step that asks for them (S5's Assess) gets the lookups too.
    assert.match(turn, /if \(mode === "audit" \|\| \(step && step\.traceRegulators\)\) \{\s*const regStart = Date\.now\(\);/);
    assert.match(turn, /const searched = new Set\(regLayer \? regLayer\.present\.map\(\(d\) => d\.source\) : \[\]\);/, "only a document the demo's layers hold");
    // S6-D8 (2026-10-13): the step's own rules' provisions first, then six of the others (U-S6 tests chooseLookups).
    assert.match(turn, /const lookups = chooseLookups\(named\.filter\(\(l\) => searched\.has\(l\.source\)\), \{ ownRules: step && Array\.isArray\(step\.traceRules\) \? step\.traceRules : \[\] \}\);\s*const outside = named\.filter\(\(l\) => !searched\.has\(l\.source\)\);/);
    assert.match(turn, /outside: outside\.map\(\(l\) => \(\{ key: l\.key, label: l\.label, source: l\.source, tracedFrom: l\.tracedFrom \}\)\),/, "a provision off the card is reported as outside, not as not found");
    assert.match(turn, /body: JSON\.stringify\(\{ \.\.\.base, query: l\.anchor, documentFilter: \{ sources: \[doc\.source\], sourceIds: doc\.sourceIds \}, \.\.\.REGULATOR_LOOKUP \}\),/);
    assert.match(turn, /const hit = pickProvision\(rows, l\);/);
    assert.match(turn, /const merged = withTracedPassages\(passages, items, Object\.fromEntries\(pillars\.map\(\(p\) => \[p\.id, p\.marker\]\)\)\);\s*passages = merged\.passages;/);
    assert.match(turn, /send\(\{ type: "regtrace", looked: lookups\.length, found: regulatorTrace\.found\.length, missing: regulatorTrace\.missing\.map\(\(m\) => m\.label\) \}\);/);
    assert.ok(turn.indexOf("let passages = numberPassages(pillars, rowsByPillar);") < turn.indexOf("const named = regulatorLookups("), "after the search");
    assert.ok(turn.indexOf("const named = regulatorLookups(") < turn.indexOf("const evidence = evidenceBlock(pillars, passages, outcomes);"), "before the evidence is written");
    assert.match(turn, /chain,\s*regulatorTrace,\s*cited: check\.cited,/, "the run log keeps what was looked up, found and missed");
  });

  test("an audit turn attaches no file, proposes nothing and shows nothing in the IDE; a doc step's turn is answered as the audit it is", () => {
    assert.match(turn, /const mode = step && step\.mode \? \(step\.mode === "doc" \? "audit" : step\.mode\) : "change";/);
    assert.match(turn, /if \(mode !== "migrate" && mode !== "audit" && mode !== "comments" && activeFile/);
    assert.match(turn, /const proposesNothing = mode === "explain" \|\| mode === "review" \|\| mode === "audit";/);
    assert.match(turn, /const locations =\s*mode === "explain"/, "locations come from a diagnosis only");
  });

  test("the live bubble counts the provisions traced and those not found", () => {
    const s = liveTurnReducer(null, { type: "regtrace", looked: 3, found: 2, missing: ["FCA SYSC 4.1.2R"] });
    assert.deepStrictEqual(s.regtrace, { looked: 3, found: 2, missing: 1 });
    assert.match(codeOnly(read("src/components/CodingLiveTurn.jsx")), /const MODE_LABELS = \{ explain: "diagnosis", change: "change", review: "review", migrate: "migration", audit: "audit" \};/);
  });
});

describe("U-S4: the answer record (S4-D4 (a))", () => {
  const s4 = byId("s4");
  const TRACE = { looked: [{ key: "sysc:4.1.1R", label: "FCA SYSC 4.1.1R" }, { key: "psrs:84", label: "Payment Services Regulations 2017, regulation 84" }], found: [{ key: "sysc:4.1.1R", label: "FCA SYSC 4.1.1R", marker: "REG-5" }], missing: [{ key: "psrs:84", label: "Payment Services Regulations 2017, regulation 84", why: "no passage found holds the provision's opening words" }] };
  const events = [
    { kind: "reset-all", at: at(0) },
    { kind: "apply", path: "nexus-payments/services/clearing/src/main/java/com/nexusbank/clearing/ClearingBatch.java", ok: true, at: at(1) },
    { kind: "select", scenario: "s4", at: at(2) },
    {
      kind: "turn", scenario: "s4", step: "money", mode: "audit", turnId: "t1", at: at(3), prompt: Q1, model: "qwen3.8:27b", thinking: { mode: "on" }, tokens: { prompt: 9, completion: 9, providerReported: true }, timing: { wallMs: 20000, modelMs: 15000 },
      attached: [], layers: [{ id: "regulator", documents: 6, passages: 4, state: "ok", searchedOn: "topics", search: "x" }],
      passages: [{ marker: "REG-5", pillar: "regulator", source: "FCA_SYSC-4_October2026.pdf", page: 4, sectionPath: "FCA SYSC 4.1.1R", via: "trace", tracedFrom: ["FIN-POL-003 clause 4.3"] }],
      citedPassages: [{ marker: "REG-5", pillar: "regulator", source: "FCA_SYSC-4_October2026.pdf", page: 4, sectionPath: "FCA SYSC 4.1.1R", text: "A firm must have robust governance arrangements", via: "trace", tracedFrom: ["FIN-POL-003 clause 4.3"] }],
      cited: ["REG-5"], unverified: [], fileOperations: [], success: true, answer: "## The chain\n\n- **PAY-012** [SDLC-1] traces to FIN-POL-003 clause 4.3 [CORP-1], which rests on SYSC 4.1.1R [REG-5].", regulatorTrace: TRACE,
    },
  ];

  test("an answer record keeps the question, the answer and the regulations traced, and says it changed no code and ran no tests", () => {
    const { json, markdown } = REC.buildEvidenceRecord({ scenario: s4, events, changes: null, platform: {}, firm: "Nexus Bank plc", recordId: "cccc3333", now: new Date(at(4)) });
    assert.deepStrictEqual([json.schema, json.kind, json.changes, json.tests.length], ["nexcode.evidence/0.12", "answer", null, 0]);
    assert.deepStrictEqual([json.turns[0].mode, json.turns[0].fileOperations], ["audit", []]);
    assert.match(json.turns[0].answer, /^## The chain/);
    assert.deepStrictEqual(json.turns[0].regulatorTrace, TRACE);
    assert.deepStrictEqual([json.rules[0].via, json.rules[0].tracedFrom], ["trace", ["FIN-POL-003 clause 4.3"]]);
    assert.deepStrictEqual([json.outcome.status, json.approval.status], ["ready for review", "pending"], "a person reviews the answer before it is given");
    assert.match(markdown, /\| Kind \| An answer to a question: no code was changed \|/);
    assert.match(markdown, /\| Outcome \| Ready for review: a person reviews the answer before it is given \|/);
    assert.match(markdown, /## The question and the answer\n\n### 1\. Which of our standards require decimal arithmetic/);
    assert.match(markdown, /> ## The chain\n>\n> - \*\*PAY-012\*\* \[SDLC-1\]/, "the answer is quoted, so its own headings stay inside the section");
    assert.match(markdown, /"Traced" passages were looked up, not searched: the regulation a policy clause's or a standard's own "Traces to:" line names/);
    assert.match(markdown, /\| traced from FIN-POL-003 clause 4\.3 \|/);
    assert.match(markdown, /This demo runs no tests: it answers a question from the rules\./);
    assert.match(markdown, /This demo changes no code: the workspace is not part of this record\./);
    assert.ok(!/ClearingBatch\.java/.test(markdown), "the last demo's change in the workspace is not this record's");
    assert.match(markdown, /- Regulations traced through the rules' "Traces to:" lines and found in their own text: FCA SYSC 4\.1\.1R\. Named but not found: Payment Services Regulations 2017, regulation 84\./);
  });

  test("a change record is as it was: kind change, no answer kept", () => {
    const s1 = byId("s1");
    const { json } = REC.buildEvidenceRecord({ scenario: s1, events: [{ kind: "turn", scenario: "s1", step: "diagnose", mode: "explain", turnId: "t", at: at(1), answer: "x", cited: [], unverified: [], fileOperations: [], success: true }], recordId: "dddd4444", now: new Date(at(2)) });
    assert.deepStrictEqual([json.kind, json.turns[0].mode, "answer" in json.turns[0]], ["change", "explain", false]);
    assert.strictEqual(REC.recordKind({ id: "x" }), "change", "a scenario given without its steps");
  });

  test("the record the closer shows: the newest other demo's record since the environment reset, still archived; else none", () => {
    const rec = (n, scenario, archived = [`2026-10-12-${scenario}-r${n}.json`]) => ({ kind: "record", scenario, recordId: `r${n}`, archived, at: at(n) });
    const names = ["2026-10-12-s1-r1.json", "2026-10-12-s3r-r3.json", "2026-10-12-s4-r4.json"];
    const pick = (events) => REC.latestRecordSince(events, { exclude: "s4", archivedNames: names });
    assert.deepStrictEqual(pick([rec(1, "s1"), rec(3, "s3r"), rec(4, "s4")]), { recordId: "r3", scenario: "s3r", at: at(3) }, "the closer's own record is never the one shown");
    assert.strictEqual(pick([rec(1, "s1"), { kind: "reset-all", at: at(2) }]), null, "nothing since the environment reset");
    assert.deepStrictEqual(pick([rec(1, "s1"), rec(2, "s2", ["2026-10-12-s2-r2.json"])]), { recordId: "r1", scenario: "s1", at: at(1) }, "a record whose file left the archive is skipped");
  });
});

describe("U-S4: the example record, the route, the bar, the page and the panels", () => {
  const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
  const bar = codeOnly(read("src/components/StepBar.jsx"));
  const page = codeOnly(read("src/app/page.js"));
  const results = codeOnly(read("src/components/presenter/ResultsPanel.jsx"));
  const report = codeOnly(read("src/components/presenter/RecordReport.jsx"));

  test("the example is a real S3 record, marked as an example, with its own id", () => {
    const ex = loadExampleRecord();
    assert.deepStrictEqual([ex.id, ex.example.of, ex.scenario.id, ex.schema], ["4c67b759", "f226e248", "s3", "nexcode.evidence/0.6"]);
    assert.match(ex.example.note, /^An example: a real evidence record of an S3 run on 12 October 2026/);
    assert.deepStrictEqual([ex.tests.length, ex.tests[ex.tests.length - 1].exitCode, ex.verification.equivalence.identical], [2, 0, true]);
    assert.ok(!/eyJ[A-Za-z0-9_-]{10}|Bearer\s|"token"\s*:/.test(read("src/data/scenarios/example-record.json")), "no credential in the shipped record");
  });

  test("the route: s3r records are listed; the closer's record is chosen as tested; the example ends every demo's list; a doc turn is logged only for a doc step", () => {
    assert.match(route, /const RECORD_NAME_RE = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}-s\\d\{1,2\}\[a-z\]\?-\[0-9a-f\]\{8\}\\\.\(json\|md\)\$\/;/);
    assert.match(route, /const latest = latestRecordSince\(readRuns\(\{ limit: 5000 \}\), \{ exclude: scenario\.id, archivedNames: archivedRecordFiles\(\) \}\);/);
    assert.match(route, /appendRun\(\{ kind: "results-shown", scenario: scenario\.id, recordId, example: !latest, of \}\);/);
    assert.match(route, /if \(!only\) list\.push\(summaryOf\(loadExampleRecord\(\), "example"\)\);/);
    assert.match(route, /if \(id === example\.id\) return \{ success: true, name: "example", json: example, markdown: renderMarkdown\(example\) \};/);
    assert.match(route, /if \(!step \|\| step\.mode !== "doc"\) return \{ success: false, error: `step \$\{body\.stepId \|\| "\(none\)"\} of \$\{scenario\.id\} is not a doc step`, status: 400 \};/);
    assert.match(route, /case "results-shown":\s*case "doc-turn": \{/);
    assert.match(route, /const answer = recordKind\(scenario\) === "answer";/);
    assert.match(route, /const diff = answer \? null : await bridgeCommand\("git-diff-stat"\);/, "an answer never reads the workspace's diff");
    assert.match(route, /if \(changes\) changes\.files = codeChanges\(eventsSinceReset\(events, scenario\.id\)\);/);
    assert.match(route, /repair: st\.repair, chat: st\.chat \}\)\),/, "the catalogue carries a doc step's chat settings");
  });

  test("the bar opens the latest record on the presenter's click, with every demo's records listed; no Run tests without a test command", () => {
    assert.match(bar, /run\("Show the latest record", \{ action: "results-shown", scenarioId: scenario\.id \}, \(r\) => \{\s*if \(!r \|\| !r\.success\) return;\s*presenter\.openResults\(\{ recordId: r\.recordId, scope: "all" \}\);/);
    assert.match(bar, /else if \(a\.action === "show-record"\) showRecord\(\);/);
    assert.match(bar, /if \(step\.action === "results"\) \{\s*showRecord\(\);\s*return;\s*\}/);
    assert.match(bar, /\{scenario\.commands && scenario\.commands\.tests \? \(\s*<button type="button" className=\{BUTTON\} disabled=\{!bridgeUp \|\| Boolean\(busy\)\}/);
  });

  test("the page: a doc step's question keeps its lookup scope and reports its answer; the Results panel honours scope all", () => {
    assert.match(page, /const docStep = activeScenarioStep && activeScenarioStep\.mode === "doc" \? activeScenarioStep : null;/);
    assert.match(page, /adminConfig: stepScope \? \{ \.\.\.adminConfigPayload, ragSettings: \{ \.\.\.\(ragSettings \|\| \{\}\), lookupScope: stepScope \} \} : adminConfigPayload,/);
    assert.match(page, /body: JSON\.stringify\(\{ action: "doc-turn", scenarioId: docStep\.id, stepId: docStep\.stepId, success: data\.success !== false && Boolean\(data\.explanation\),/);
    assert.match(results, /setScope\(request\.scope === "all" \? "all" : request\.scenarioId \|\| activeDemoId \? "demo" : "all"\);/);
    assert.match(results, /\{r\.example && <span className=\{`\$\{CHIP\} \$\{WARN\}`\} data-record-example="true">example<\/span>\}/);
  });

  test("the report: an answer shows the question and the answer first, no code and no tests; the example says what it is", () => {
    assert.match(report, /const answer = record\.kind === "answer";/);
    assert.match(report, /<h3 className=\{H\}>The question and the answer<\/h3>/);
    assert.match(report, /\{t\.answer \? <MarkdownBlocks text=\{t\.answer\} \/> :/, "the answer is rendered as text, never as HTML");
    assert.match(report, /This record keeps an answer: the demo changed no code and ran no tests, and the workspace is not part of it\./);
    assert.match(report, /\{record\.example\.note \|\| "An example record, shipped with NexCODE\."\}/);
    assert.ok(!/dangerouslySetInnerHTML/.test(report));
  });
});
