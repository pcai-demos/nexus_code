/**
 * U-POLICY — the answer policy (ticket T48, t48-design.md §2.2–§2.5, §4; D1 a, D3 a, D4, D5, D7, D11 a; the owner's D4,
 * lesson 7; F-200, F-177, F-205).
 *
 * The acceptance's byte pin (§4 item 2): with the setting OFF the composed system message is production's captured
 * message (session 60's in-process capture of the served image's exact generation requests — `t48-artifacts/probes/
 * records/messages-1790447697.json`, prompt tokens 5,284 / 5,268 / 13,082 / 13,054 = the post-v9 gate's) PLUS exactly
 * rule 9 and the computed notes; ON, plus rule 10. The cases:
 *
 *   1. The rules: rule 10 IS the design probe's sharper section wording (policy_probe.js `section2`, measured in §0d)
 *      byte for byte; rule 9 is the probe's method clause with D7's placement words — the one difference, stated;
 *      rule 9 always, rule 10 only on "on"; the setting's values; what is NOT shipped (F-200's clause, the finer-unit
 *      clause) is in no source.
 *   2. The composed FS-1 message, the setting off: the capture + the measured blockfix2 lines + rule 9 after rule 8 —
 *      byte for byte against policy_probe.js's own construction; on: + rule 10 after rule 9; nothing applied: the
 *      capture. FS-3: the capture + the dual-unit block after the numbered context + rule 9. All four turns, both
 *      states: equal to the golden record (`records/expected-messages-1790495532.json`) the post-roll re-capture is
 *      diffed against — since T64 (F-216, t64-design.md §2.1), T48's golden plus exactly one line in FS-3's dual-unit
 *      block: the totals note, before the printed-conversions count; FS-1's turns (no room table) unchanged.
 *   3. splitAnswer — the one reader of where the grounded body ends: the 40 sections the probe wrote (every one
 *      "### Beyond the documents") split exactly where the probe's judge split them; the heading's forms; a sentence that
 *      starts with the words stays body; the first heading wins; totality.
 *   4. The audit: the setting on → the grounded body; off → the whole answer (nothing was invited, nothing is exempt);
 *      a marker inside the section is a breach — one entry, the markers named, through the citation contract's own
 *      extractor; answerPolicyReport's shape.
 *   5. The wiring (source pins over comment-stripped code, the U-FAIL way): the orchestrator's notes seam (its own try
 *      and stage), the rules inside rule 8's conditional, the audit's text, the breach, `answerPolicy` on the return;
 *      both routes, page.js's four sites, both runners; the drawer's toggle; the panel's section block.
 *   6. Purity: answer_policy.js's one require is the citation contract.
 *   7. T52 (t52-design.md §3; F-208) — sectionOffer, the section's closing next-step offer split off for the chat: the
 *      pre-roll acceptance reads OK (`t52-artifacts/sections52.js` — coded = measured on T50's 313 recorded sections,
 *      exactly the 39 closing offers, 0 emptied, every other section byte for byte, the audit's output byte-identical on
 *      the 370 setting-on answers); the split is sections50.js's; the rule's edges (an offer alone, a non-closing or
 *      unknown form, emphasis, abbreviations, the opening's three forms, junk).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
process.env.RAG_EVAL_APP_ROOT = REPO_ROOT; // policy_probe.js and compose.js resolve the tree through it (this file's own process)
const B = (...p) => path.join(REPO_ROOT, "tests", "eval", "baselines", ...p);
const P = require("../../src/lib/rag/answer_policy");
const { buildNumberedContext } = require("../../src/lib/rag/citations");
const { compose, RULE8_END } = require(B("t48-artifacts", "compose.js"));
const { armSystem, CLAUSES, ANCHOR } = require(B("t48-artifacts", "probes", "policy_probe.js"));
const json = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const capture = json(B("t48-artifacts", "probes", "records", "messages-1790447697.json"));
const golden = json(B("t48-artifacts", "records", "expected-messages-1790495532.json"));
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const systemOf = (id, scope) => capture.turns.find((t) => t.id === id && t.scope === scope).request.messages[0].content;
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const read = (...p) => codeOnly(fs.readFileSync(path.join(REPO_ROOT, ...p), "utf8"));

describe("U-POLICY 1: the rules — rule 10 is the measured sharper wording, rule 9 the method clause with D7's placement", () => {
  test("rule 10 IS policy_probe.js's section2 (§0d `alln2`: no marker inside 8 of 8 sampled sections), byte for byte", () => {
    assert.strictEqual(P.RULE_BEYOND_THE_DOCUMENTS, CLAUSES.section2(10));
    assert.match(P.RULE_BEYOND_THE_DOCUMENTS, /headed exactly "### Beyond the documents"/);
  });
  test("rule 9 is the probe's method clause (§0d: the method sentence 8–9 of 10, the offer 7–10 of 10) with D7's placement words — the one difference", () => {
    const probe = CLAUSES.method(9).split("\n");
    const shipped = P.RULE_METHOD_NEXT_STEP.split("\n");
    assert.deepStrictEqual(shipped.slice(0, 2), probe.slice(0, 2));
    assert.strictEqual(shipped[2], probe[2].replace(/at the end\.$/, 'at the end of the grounded answer, before any "Beyond the documents" section.'));
    assert.strictEqual(shipped.length, 4, "two bullets and the closing newline");
  });
  test("rule 9 always, rule 10 only on \"on\"; the setting's two values, \"off\" the default and anything else", () => {
    assert.deepStrictEqual([...P.BEYOND_THE_DOCUMENTS_MODES], ["off", "on"]);
    assert.strictEqual(P.BEYOND_THE_DOCUMENTS_DEFAULT, "off");
    assert.strictEqual(P.policyRules({ beyondTheDocuments: "off" }), P.RULE_METHOD_NEXT_STEP);
    assert.strictEqual(P.policyRules({ beyondTheDocuments: "on" }), P.RULE_METHOD_NEXT_STEP + P.RULE_BEYOND_THE_DOCUMENTS);
    for (const junk of [undefined, null, "ON", "true", true, 1, "yes"]) assert.strictEqual(P.policyRules({ beyondTheDocuments: junk }), P.RULE_METHOD_NEXT_STEP, String(junk));
    assert.strictEqual(P.policyRules(), P.RULE_METHOD_NEXT_STEP);
  });
  test("NOT shipped (§0c, §0d, §0f): F-200's rule clause in either wording and the finer-unit clause are in no product source; CHAIN_BLOCK_RULE is word for word", () => {
    const sources = ["src/lib/orchestrator.js", "src/lib/rag/answer_policy.js", "src/lib/rag/context_notes.js", "src/app/page.js"].map((f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8")).join("\n");
    for (const c of [CLAUSES.finer, CLAUSES.f200, CLAUSES.f200n]) assert.ok(!sources.includes(c.trim().slice(2, 70)), c.slice(0, 50));
    assert.ok(!/finer unit \(millimetres over feet-and-inches\)/.test(sources));
    assert.strictEqual(require("../../src/lib/ingestion/dimension_chain").CHAIN_BLOCK_RULE, "   - When a figure's context carries a CHAIN block, tabulate the POINTS (computed) as given, name the ones marked not derivable as such, and never describe a layout the block does not state.");
  });
});

describe("U-POLICY 2: the composed messages — production's capture + exactly rule 9 and the notes (off), + rule 10 (on) — §4 item 2", () => {
  for (const scope of ["corpus", "document"]) {
    test(`FS-1 ${scope}, the setting off: armSystem(capture, "blockfix2") with rule 9 at rule 8's end — the probe's own construction, byte for byte`, () => {
      const system = systemOf("FQ01", scope);
      assert.strictEqual(ANCHOR.rule8End, RULE8_END, "the same anchor as the probe's");
      const expected = armSystem(system, "blockfix2").replace(ANCHOR.rule8End, () => `say so plainly and cite nothing.\n${P.RULE_METHOD_NEXT_STEP}\nMaintain an educated, clear, and business-casual tone`);
      assert.strictEqual(compose(system).system, expected);
      assert.strictEqual(compose(system).system.length - system.length, 261 + P.RULE_METHOD_NEXT_STEP.length);
    });
    test(`FS-1 ${scope}, the setting on: + rule 10 straight after rule 9; with nothing applied, the capture byte for byte`, () => {
      const system = systemOf("FQ01", scope);
      assert.strictEqual(compose(system, { beyondTheDocuments: "on" }).system, compose(system).system.replace(P.RULE_METHOD_NEXT_STEP, () => P.RULE_METHOD_NEXT_STEP + P.RULE_BEYOND_THE_DOCUMENTS));
      assert.strictEqual(compose(system, { notes: false, rules: false }).system, system);
    });
  }
  test("FS-3, both scopes: the dual-unit block after the numbered context (before the rules — where the probe's `units` arm put it) and rule 9; no chain block", () => {
    for (const scope of ["corpus", "document"]) {
      const system = systemOf("FQ12", scope);
      const c = compose(system);
      assert.deepStrictEqual(c.notes.chain, []);
      assert.ok(c.system.includes(`\n\n\n\n${c.notes.dualUnits.text}\n\nCRITICAL GROUNDING & CALCULATION INSTRUCTIONS:`), "after the context's closing blank line, before the rules");
      assert.strictEqual(c.system.length - system.length, c.notes.dualUnits.text.length + 2 + P.RULE_METHOD_NEXT_STEP.length);
    }
  });
  test("all four turns, both states: equal to the golden record the post-roll re-capture is diffed against (md5 and text) — plus T64's one note line on FS-3", () => {
    assert.strictEqual(golden.capture, "messages-1790447697.json");
    assert.strictEqual(golden.turns.length, 4);
    // T64 (F-216): the golden is T48's composition; T64 adds exactly one line to the dual-unit block — the totals note,
    // the measured arm E's words — before the printed-conversions count, and nothing else.
    const NOTE = "NO TOTAL FLOOR AREA is printed for any home above: neither its room table nor any other text from its page above gives one. Each total above is computed here and covers only the rooms its table lists, so it is not the home's floor area: it leaves out the spaces the table gives no row (such as a hall, a landing, stairs or a store, where the home has them) and the walls. The document itself says none of this.";
    const withNote = (s) => s.replace("\nPRINTED CONVERSIONS THAT DISAGREE", () => `\n${NOTE}\nPRINTED CONVERSIONS THAT DISAGREE`);
    for (const g of golden.turns) {
      const system = systemOf(g.id, g.scope);
      assert.strictEqual(g.captureMd5, md5(system), `${g.id}/${g.scope}: the golden record was composed on this capture`);
      const off = compose(system, { beyondTheDocuments: "off" }).system;
      const on = compose(system, { beyondTheDocuments: "on" }).system;
      const want = g.id === "FQ12" ? withNote : (s) => s;
      if (g.id === "FQ12") assert.notStrictEqual(want(g.off.system), g.off.system, `${g.id}/${g.scope}: the golden carries the dual-unit block the note joins`);
      assert.strictEqual(off, want(g.off.system), `${g.id}/${g.scope} off`);
      assert.strictEqual(on, want(g.on.system), `${g.id}/${g.scope} on`);
      assert.strictEqual(md5(off), g.id === "FQ12" ? md5(want(g.off.system)) : g.off.md5);
      assert.strictEqual(off.length - system.length, g.off.delta + (g.id === "FQ12" ? NOTE.length + 1 : 0), `${g.id}/${g.scope}: T48's delta plus the note line`);
    }
    assert.deepStrictEqual(golden.turns.map((g) => [g.id, g.scope, g.off.delta, g.on.delta]), [["FQ01", "corpus", 668, 1229], ["FQ01", "document", 668, 1229], ["FQ12", "corpus", 3616, 4177], ["FQ12", "document", 3616, 4177]]);
  });
  test("the product's own seam renders a noted block in place — buildNumberedContext's textFor changes the block's text and nothing else", () => {
    const a = { source: "A.pdf", page: 1, text: "alpha" };
    const b = { source: "B.pdf", page: 2, text: "beta" };
    const plain = buildNumberedContext({ specChunks: [a, b] });
    const noted = buildNumberedContext({ specChunks: [a, b], textFor: (chunk, marker) => (chunk === b ? `beta\n\nNOTE ${marker}` : chunk.text) });
    assert.strictEqual(noted.contextText, plain.contextText.replace("\nbeta\n\n", "\nbeta\n\nNOTE S2\n\n"));
    assert.deepStrictEqual(noted.contextMap, plain.contextMap);
    assert.strictEqual(buildNumberedContext({ specChunks: [a, b], textFor: () => { throw new Error("x"); } }).contextText, plain.contextText, "a supplier that throws gives the chunk's own text");
    assert.strictEqual(buildNumberedContext({ specChunks: [a, b], textFor: () => 42 }).contextText, plain.contextText, "a non-string gives the chunk's own text");
  });
});

describe("U-POLICY 3: splitAnswer — the one reader of where the grounded body ends", () => {
  test("the 40 sections the probe wrote (§0c–§0f): each split where the probe's judge split it; the heading exactly as rule 10 asks", () => {
    let n = 0;
    for (const f of ["policy-1790448100.json", "policy-1790451520.json", "policy-1790451521.json", "policy-1790454374.json", "policy-1790455030.json", "policy-1790455289.json"]) {
      for (const run of json(B("t48-artifacts", "probes", "records", f)).runs) {
        const s = P.splitAnswer(run.answer);
        const probe = run.judge.section;
        assert.strictEqual(s.section !== null, probe.present, `${f} ${run.id}/${run.scope}/${run.arm}`);
        if (!probe.present) continue;
        n++;
        assert.strictEqual(s.section.length, probe.chars);
        assert.strictEqual(s.heading, "### Beyond the documents");
        assert.strictEqual(s.body + s.section, run.answer);
      }
    }
    assert.strictEqual(n, 40);
  });
  test("the heading's forms: any level, bold, a trailing colon, any case — the line holds the words and nothing else", () => {
    for (const h of ["### Beyond the documents", "## Beyond the Documents", "# BEYOND THE DOCUMENTS", "**Beyond the documents**", "**Beyond the documents:**", "### **Beyond the documents**", "Beyond the documents:", "  ### Beyond the documents  "]) {
      const s = P.splitAnswer(`Grounded [S1].\n\n${h}\nMy own view.`);
      assert.strictEqual(s.body, "Grounded [S1].\n\n", h);
      assert.strictEqual(s.content, "My own view.", h);
    }
  });
  test("a sentence that starts with the words is body; no heading → the whole answer is body; the first heading wins; junk is an empty body", () => {
    assert.strictEqual(P.splitAnswer("Beyond the documents, I would add a slab.").section, null);
    assert.strictEqual(P.splitAnswer("See 'Beyond the documents' below.").section, null);
    assert.deepStrictEqual(P.splitAnswer("Just grounded."), { body: "Just grounded.", section: null, heading: null, content: null });
    const two = P.splitAnswer("A\n### Beyond the documents\nB\n### Beyond the documents\nC");
    assert.strictEqual(two.body, "A\n");
    assert.strictEqual(two.content, "B\n### Beyond the documents\nC");
    for (const junk of [undefined, null, 5, {}]) assert.deepStrictEqual(P.splitAnswer(junk), { body: "", section: null, heading: null, content: null });
  });
});

describe("U-POLICY 4: the audit — the body when the section is invited, the whole answer when it is not; a marker inside is a breach", () => {
  const contextMap = [{ marker: "S1", source: "A.pdf", page: 1 }, { marker: "S2", source: "B.pdf", page: 2 }];
  const answer = "The slab is 100 mm [S1].\n\n### Beyond the documents\nThis is not from the documents. A 150 mm slab is common [S2]; see also [S9].";
  test("auditedText: on → the grounded body (the owner's D4: the section is ignored by the audit); off → the whole answer, as before T48", () => {
    assert.strictEqual(P.auditedText(answer, "on").text, "The slab is 100 mm [S1].\n\n");
    assert.strictEqual(P.auditedText(answer, "off").text, answer);
    assert.strictEqual(P.auditedText(answer, undefined).text, answer);
    assert.strictEqual(P.auditedText(answer, "on").split.heading, "### Beyond the documents");
  });
  test("sectionMarkers reads markers with the citation contract's own extractor — valid and invalid alike, distinct; sectionBreach names them in one entry", () => {
    const { section } = P.splitAnswer(answer);
    assert.deepStrictEqual(P.sectionMarkers(section, contextMap), ["S2", "S9"]);
    assert.strictEqual(P.sectionBreach(["S2", "S9"]), 'a citation marker inside "Beyond the documents" ([S2], [S9]) — the section holds the model\'s own knowledge and carries no marker');
    assert.strictEqual(P.sectionBreach([]), null);
    assert.deepStrictEqual(P.sectionMarkers(null, contextMap), []);
    assert.deepStrictEqual(P.sectionMarkers("[Source 1] prose [S1-S2]", contextMap), ["S1", "S2"], "the extractor's own grammar (ranges expand, prose brackets do not parse)");
  });
  test("answerPolicyReport: null section when off and none written; { present, chars, markers, heading } otherwise; the notes carried", () => {
    const split = P.splitAnswer(answer);
    assert.deepStrictEqual(P.answerPolicyReport({ beyondTheDocuments: "off", split: P.splitAnswer("x"), markers: [], notes: null }), { beyondTheDocuments: "off", section: null, notes: null });
    assert.deepStrictEqual(P.answerPolicyReport({ beyondTheDocuments: "on", split: P.splitAnswer("x"), markers: [], notes: null }).section, { present: false, chars: 0, markers: 0, heading: null });
    assert.deepStrictEqual(P.answerPolicyReport({ beyondTheDocuments: "on", split, markers: ["S2", "S9"], notes: { chain: [], dualUnits: null } }), { beyondTheDocuments: "on", section: { present: true, chars: split.section.length, markers: 2, heading: "### Beyond the documents" }, notes: { chain: [], dualUnits: null } });
    assert.strictEqual(P.answerPolicyReport({ beyondTheDocuments: "off", split, markers: [], notes: null }).section.present, true, "an uninvited section is still reported");
  });
});

describe("U-POLICY 5: the wiring — the orchestrator, both routes, page.js, both runners, the drawer and the panel", () => {
  const orch = read("src", "lib", "orchestrator.js");
  test("the orchestrator: the notes after the assembly (their own try and stage), the noted text through textFor, the dual-unit block after the context", () => {
    assert.match(orch, /import \{ contextNotes \} from "@\/lib\/rag\/context_notes";/);
    assert.match(orch, /import \{ policyRules, splitAnswer, auditedText, sectionMarkers, sectionBreach, answerPolicyReport \} from "@\/lib\/rag\/answer_policy";/);
    const notes = orch.indexOf("notes = contextNotes(noteSource.map(");
    const numbered = orch.indexOf("const numbered = buildNumberedContext({ specChunks, legendChunks, paginationFacts, textFor: noteTextFor })");
    assert.ok(notes > -1 && numbered > notes, "the notes are computed before the context is numbered");
    assert.match(orch, /stage: "context-notes"/);
    assert.match(orch, /RAGRulesText = exactOccurrencesSummary \+ numbered\.contextText \+ \(notes && notes\.dualUnits \? `\\n\\n\$\{notes\.dualUnits\.text\}` : ""\);/);
    assert.match(orch, /const noteSource = specChunks\.concat\(legendChunks\);/);
  });
  test("the rules: rule 9 (+ 10 on the setting) inside rule 8's conditional, straight after its last line — only on a grounded doc turn", () => {
    assert.match(orch, /const answerPolicyConfig = resolveAnswerPolicyConfig\(adminConfig\?\.ragSettings\);/);
    assert.match(orch, /say so plainly and cite nothing\.\n\$\{policyRules\(\{ beyondTheDocuments: answerPolicyConfig\.beyondTheDocuments \}\)\}` : ""\}/);
    assert.match(orch, /\$\{contextMap\.length > 0 \? `8\. CITATION CONTRACT:/);
    assert.strictEqual((orch.match(/policyRules\(/g) || []).length, 1, "one place");
  });
  test("the audit: auditedText's text; the breach only with the setting on; answerPolicy (+ rules) on the return, its own try and stage", () => {
    assert.match(orch, /const audited = auditedText\(explanation, answerPolicyConfig\.beyondTheDocuments\);\s*citationAudit = auditAnswer\(\{\s*answer: audited\.text,/);
    assert.match(orch, /const breach = answerPolicyConfig\.beyondTheDocuments === "on" \? sectionBreach\(sectionMarkers\(audited\.split\.section, contextMap\)\) : null;\s*if \(breach\) citationAudit\.uncitedClaims\.push\(breach\);/);
    assert.match(orch, /rules: agentMode === "doc" && contextMap\.length > 0 \? \(answerPolicyConfig\.beyondTheDocuments === "on" \? \[9, 10\] : \[9\]\) : \[\],/);
    assert.match(orch, /stage: "answer-policy"/);
    const ret = orch.lastIndexOf("return {");
    assert.ok(orch.indexOf("answerPolicy,", ret) > ret, "answerPolicy is on the orchestrator's return");
    assert.match(orch, /notes: contextNotesReport,/, "the assembly span names the notes");
  });
  test("both routes name answerPolicy (memory chat-route-projects-result-fields); page.js carries it on both messages and both trace turns", () => {
    for (const r of ["chat", "ide-bridge"]) assert.match(read("src", "app", "api", r, "route.js"), /answerPolicy: result\.answerPolicy \?\? null,/, r);
    assert.strictEqual((read("src", "app", "page.js").match(/answerPolicy: data\.answerPolicy \|\| null,/g) || []).length, 4);
  });
  test("both runners record it; the figure runner sends the setting request-level and asks N passes", () => {
    const dry = fs.readFileSync(B("dryrun-artifacts", "run_dry_run.js"), "utf8");
    const figq = fs.readFileSync(B("workshop-artifacts", "ab", "run_figure_questions.js"), "utf8");
    assert.match(dry, /answerPolicy: j \? j\.answerPolicy \?\? null : null,/);
    assert.match(figq, /answerPolicy: j \? j\.answerPolicy \?\? null : null,/);
    assert.match(figq, /\.\.\.\(BEYOND \? \{ beyondTheDocuments: BEYOND \} : \{\}\)/);
    assert.match(figq, /for \(let rep = 1; rep <= REPEAT; rep\+\+\) for \(const q of selected\) for \(const scope of scopes\) \{/);
  });
  test("the drawer: a toggle beside Caption Figures mapping checked ↔ \"on\", its tooltip naming what it adds and that it is off by default; the panel: the section in its own block under the amber pill", () => {
    const dr = read("src", "components", "AdminDrawer.jsx");
    assert.match(dr, /checked=\{tempRagSettings\.beyondTheDocuments === "on"\}/);
    assert.match(dr, /updateRagSetting\("beyondTheDocuments", e\.target\.checked \? "on" : "off"\)/);
    const tip = (fs.readFileSync(path.join(REPO_ROOT, "src", "components", "AdminDrawer.jsx"), "utf8").match(/id="adv_beyondTheDocuments" text="([^"]*)"/) || [])[1] || "";
    for (const w of ["Off (the default)", "Beyond the documents", "not from your documents", "citation audit", "vary", "nothing is re-ingested"]) assert.ok(tip.includes(w), w);
    const b = dr.indexOf('updateRagSetting("beyondTheDocuments"'), c = dr.indexOf('updateRagSetting("captionFigures"');
    assert.ok(b > -1 && c > b && c - b < 3000, "beside Caption Figures (just before it — T31's budget control still follows the toggle)");
    const panel = read("src", "components", "ChatPanel.jsx");
    assert.match(panel, /import \{ splitAnswer, sectionOffer \} from "@\/lib\/rag\/answer_policy";/);
    assert.match(panel, /chat\.answerPolicy && chat\.answerPolicy\.section && chat\.answerPolicy\.section\.present \? \(\s*<AnswerWithSection text=\{chat\.text\} format=\{formatMessageContent\} \/>\s*\) : \(\s*formatMessageContent\(chat\.text\)\s*\)/);
    assert.match(panel, /Beyond the documents · not from your documents/);
    assert.match(panel, /bg-amber-500\/15 text-amber-400 border border-amber-500\/20/);
  });
  test("T52 (D2 a, D4 a): the panel splits the section's closing offer by sectionOffer — the box holds the judgement, the offer renders after the box in the body's style", () => {
    const panel = read("src", "components", "ChatPanel.jsx");
    const fn = panel.slice(panel.indexOf("function AnswerWithSection("), panel.indexOf("function TurnTimingFooter("));
    assert.match(fn, /const \{ judgement, offer \} = sectionOffer\(split\.content\);/);
    assert.strictEqual((fn.match(/sectionOffer\(/g) || []).length, 1, "one call");
    assert.ok(!/format\(split\.content\)/.test(fn), "the box no longer renders the content whole");
    const box = fn.indexOf("<div data-beyond-the-documents=");
    const judgement = fn.indexOf("{format(judgement)}");
    const offer = fn.indexOf("<div data-section-offer=");
    assert.ok(box > -1 && judgement > box && offer > judgement, "the judgement inside the box, the offer after it");
    assert.match(fn.slice(judgement), /^\{format\(judgement\)\}\s*<\/div>\s*\{offer !== null && \(\s*<div data-section-offer="" className="mt-3">\s*\{format\(offer\)\}\s*<\/div>\s*\)\}\s*<\/>/, "the box closes, then the offer — only when there is one — in the body's own formatter");
  });
});

describe("U-POLICY 6: purity", () => {
  test("answer_policy.js's one require is the citation contract; no fs, no fetch, no clock", () => {
    const src = read("src", "lib", "rag", "answer_policy.js");
    assert.deepStrictEqual(src.match(/require\([^)]*\)/g), ['require("./citations")']);
    assert.ok(!/\bfetch\(|Date\.now|new Date|process\.env|readFileSync/.test(src));
  });
});

describe("U-POLICY 7: sectionOffer — T52 (F-208): the section's closing offer split off for the chat, never emptying the section", () => {
  test("the pre-roll acceptance (t52-artifacts/sections52.js) reads OK: coded = measured on T50's 313 sections, 0 emptied, the audit byte-identical on the 370", () => {
    const { spawnSync } = require("child_process");
    const r = spawnSync(process.execPath, [B("t52-artifacts", "sections52.js")], { encoding: "utf8", env: { ...process.env, RAG_EVAL_APP_ROOT: REPO_ROOT }, timeout: 60000 });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^the sections: 313 over 370 setting-on answers$/m);
    assert.match(r.stdout, /^1\. coded = measured: T50's closing offers 39 \(each the single closing sentence: 39\); split off by the rule 39; the same sentence 39; missed 0; split where T50 read none 0 → yes$/m);
    assert.match(r.stdout, /^2\. sections emptied: 0;/m);
    assert.match(r.stdout, /^3\. every other section byte for byte: 274 \/ 274$/m);
    assert.match(r.stdout, /370 \/ 370 identical; md5 of all [0-9a-f]{32} = before's → byte-identical$/m);
    assert.match(r.stdout, /the section's ONLY marker in the offer \(the amber chip stays\): 3$/m, "D3 (a)'s cost, as designed (3 of the 62 marked sections)");
  });
  test("the split is sections50.js's own (the reader T50 measured with — 'p. 84' kept inside a sentence), source and flags", () => {
    const s50 = fs.readFileSync(B("t50-artifacts", "probes", "sections50.js"), "utf8");
    const m = s50.match(/const sents = \(t\) => String\(t\)\.replace\(\/\\\*\\\*\/g, ""\)\.split\(\/(.*)\/\)\.map\(/);
    assert.ok(m, "sections50.js's split found");
    assert.strictEqual(P.SECTION_SENTENCE_BREAK.source, m[1]);
    assert.strictEqual(P.SECTION_SENTENCE_BREAK.flags, "");
  });
  test("an offer in the measured grammar closing the section is split off; the judgement before it keeps its bytes, trailing whitespace dropped", () => {
    const c = "This is not from the manual. A resin anchor suits a slab of that depth.\n\nIf you would like, I can pull the wiring diagram (CQG232, p. 84) [S9] so you can plan the supply.\n";
    assert.deepStrictEqual(P.sectionOffer(c), { judgement: "This is not from the manual. A resin anchor suits a slab of that depth.", offer: "If you would like, I can pull the wiring diagram (CQG232, p. 84) [S9] so you can plan the supply." });
    for (const opening of ["If you would like, I can", "If you'd like, I can", "If it would help, I can", "If you would like I can"]) {
      assert.strictEqual(P.sectionOffer(`My own view. ${opening} pull the table.`).offer, `${opening} pull the table.`, opening);
    }
    assert.deepStrictEqual(P.sectionOffer("My view.\n\n**If you'd like, I can pull the table (e.g. p. 10).**"), { judgement: "My view.", offer: "**If you'd like, I can pull the table (e.g. p. 10).**" }, "the emphasis goes with the offer");
  });
  test("everything else stays inside the box, byte for byte: an offer alone (never emptied), an offer that does not close the section, another form, a referral, no sentence break, junk", () => {
    for (const c of [
      "If you would like, I can pull the full table.",
      "\n\nIf you would like, I can pull the full table.\n",
      "My view. If you would like, I can pull the table. Always verify with an engineer.",
      "My view. Would you like me to pull the table?",
      "My view. Let me know if you would like the table.",
      "My view. If you would like, the Sales Adviser can supply the certified schedule.",
      "My view. If you need a figure for valuation, I can recommend asking the Sales Adviser.",
      "One judgement with no break at all",
      "",
    ]) assert.deepStrictEqual(P.sectionOffer(c), { judgement: c, offer: null }, JSON.stringify(c));
    for (const junk of [undefined, null, 5, {}]) assert.deepStrictEqual(P.sectionOffer(junk), { judgement: "", offer: null });
  });
});
