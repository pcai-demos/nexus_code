/**
 * U-RULECHAIN — the documents' own trace lines, followed (src/lib/coding/rule_chain.js; D11 (a) of 2026-10-10), and each
 * demo searching only its own card's documents (pillars.js scopePillars; D10 (a)).
 *
 * Measured before the change (inputs/demo-design/evidence/session-90-s2-layers/): S2's review found no passage for T1,
 * the Critical hard-coded key, in any layer, and S1's Diagnose read S2's April digest, written after S1's incident.
 * Pinned here on the real documents: every rule paragraph parses with its trace line; S2's tool findings and the
 * review's own rules give exactly the chain the content README states; a paragraph the search already found is not
 * repeated; a demo's layers hold only its card's documents; the turn wires both, the chain only for a review.
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const C = require("../../src/lib/coding/rule_chain");
const P = require("../../src/lib/coding/pillars");
const { REVIEW_RULES } = require("../../src/lib/coding/review");
const { loadScenarios, loadManifest } = require("../../src/lib/coding/scenarios");

const ROOT = path.join(__dirname, "..", "..");
const DEMO_FILES = path.join(ROOT, "public", "demos", "demo_files");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every manifest document as if the store held it (the documents route's shape). */
const storeOf = (manifest) => manifest.pillars.flatMap((p) => p.documents).map((s) => ({ source: s, sourceIds: [`id-${s}`], chunkCount: 1 }));
const scenario = (id) => loadScenarios().find((s) => s.id === id);
const cardOf = (s) => s.card.artefacts.documents.map((d) => d.source);
const layersFor = (s) => P.scopePillars(P.resolvePillars(loadManifest(), storeOf(loadManifest())), s ? cardOf(s) : null);
const S2_ROOTS = [
  ["SCS-010", "T1"],
  ["SCS-021", "T2"],
  ["PAY-012", "T3"],
  ["SCS-031", "T4"],
  ["DEP-001", "T5"],
  ["TST-001", "T6"],
].map(([rule, from]) => ({ rule, from }));
const s2Roots = () => [...S2_ROOTS, ...REVIEW_RULES.map((rule) => ({ rule, from: "the review" }))];

describe("U-RULECHAIN: parsing a document's rules and trace lines", () => {
  const md = [
    "# A standard",
    "",
    "## 2. Secrets",
    "",
    "**SCS-010 No hard-coded secrets.** Code MUST NOT contain a secret.",
    "Traces to: SEC-POL-001 clause 4.3 (Secrets and credentials).",
    "",
    "**SEC-POL-001 clause 4.3: Secrets and credentials.** Secrets live in the vault.",
    "Traces to: FCA SYSC 4.1.1R (effective control); Payment Services Regulations 2017, regulation 98(1).",
    "",
    "**CLR-DIGEST-2026-04 F8: Secrets in test configuration (2 comments).** Use fake values.",
    "Traces to: SCS-010 and SCS-011 (Secure Coding Standard).",
    "",
    "**Not a rule.** A bold opening without an ID.",
  ].join("\n");

  test("each rule paragraph: its ID (a standard's rule, a policy clause, a team note), title, text through its trace line", () => {
    const rules = C.parseRules(md);
    assert.deepStrictEqual(rules.map((r) => [r.id, r.title]), [
      ["SCS-010", "No hard-coded secrets"],
      ["SEC-POL-001 clause 4.3", "Secrets and credentials"],
      ["CLR-DIGEST-2026-04 F8", "Secrets in test configuration (2 comments)"],
    ]);
    assert.match(rules[0].text, /^\*\*SCS-010 No hard-coded secrets\.\*\*[\s\S]*Traces to: SEC-POL-001 clause 4\.3 \(Secrets and credentials\)\.$/);
    assert.strictEqual(rules[2].traces, "SCS-010 and SCS-011 (Secure Coding Standard).");
  });

  test("a trace line's policy clauses: plural clauses, a section skipped, two policies, and none in a regulator line", () => {
    assert.deepStrictEqual(C.policyRefs("SEC-POL-001 clauses 4.3 and 4.9."), ["SEC-POL-001 clause 4.3", "SEC-POL-001 clause 4.9"]);
    assert.deepStrictEqual(C.policyRefs("FIN-POL-003 section 2 (Scope) and clauses 4.1 and 4.2."), ["FIN-POL-003 clause 4.1", "FIN-POL-003 clause 4.2"]);
    assert.deepStrictEqual(C.policyRefs("FIN-POL-003 clause 4.2; TPR-POL-002 clause 4.6."), ["FIN-POL-003 clause 4.2", "TPR-POL-002 clause 4.6"]);
    assert.deepStrictEqual(C.policyRefs("FIN-POL-003 clauses 4.8, 4.9 and 4.10."), ["FIN-POL-003 clause 4.8", "FIN-POL-003 clause 4.9", "FIN-POL-003 clause 4.10"]);
    assert.deepStrictEqual(C.policyRefs("FCA SYSC 4.1.1R; PCI DSS v4.0.1 Requirements 3.3.1 and 3.5.1."), []);
  });

  test("a trace line's rules: never the POL-001 inside a policy ID", () => {
    assert.deepStrictEqual(C.ruleRefs("SCS-010 and SCS-011 (Secure Coding Standard)."), ["SCS-010", "SCS-011"]);
    assert.deepStrictEqual(C.ruleRefs("SEC-POL-001 clause 4.3 (Secrets and credentials)."), []);
    assert.deepStrictEqual(C.ruleRefs("Secure Coding Standard v2.0, SCS-021 (no card numbers in production logs)."), ["SCS-021"]);
  });
});

describe("U-RULECHAIN: the real documents", () => {
  const manifest = loadManifest();
  const all = layersFor(null);
  const loaded = C.loadRegister(all, { root: DEMO_FILES });

  test("all 26 internal documents read (S3 added four, S5 three, S6 two); 175 rule paragraphs, each with its trace line; every reference resolves but the squad-practice tip", () => {
    const internal = manifest.pillars.filter((p) => p.id !== "regulator").flatMap((p) => p.documents);
    assert.strictEqual(internal.length, 26);
    assert.strictEqual(loaded.documents, 26);
    assert.deepStrictEqual(loaded.unreadable, []);
    const reg = [...loaded.register.values()];
    // S5: LEG-POL-001's five clauses, STD-DOC's eight rules and CLR-WIKI-021's seven notes. S6 (2026-10-13): STD-SVS's
    // seven rules and CLR-WIKI-024's eight notes.
    assert.strictEqual(reg.length, 175);
    assert.deepStrictEqual(reg.filter((r) => !r.traces).map((r) => r.id), []);
    assert.deepStrictEqual(reg.filter((r) => r.layer !== "corporate" && r.refs.length === 0).map((r) => r.id), ["CLR-WIKI-006 T2"]);
    for (const r of reg.filter((x) => x.layer === "sdlc")) assert.ok(r.refs.some((id) => loaded.register.get(id).layer === "corporate"), `${r.id} traces to a policy clause`);
  });

  test("team notes for a rule: one per document first (SCS-021: CLR-WIKI-014 R2, CLR-WIKI-006 T1, the digest's F3)", () => {
    const { items } = C.traceChains(loaded.register, [{ rule: "SCS-021", from: "T2" }]);
    assert.deepStrictEqual(items.filter((i) => i.layer === "team").map((i) => i.id), ["CLR-WIKI-014 R2", "CLR-WIKI-006 T1", "CLR-DIGEST-2026-04 F3"]);
  });

  test("a root the documents lack is reported, never guessed", () => {
    const r = C.traceChains(loaded.register, [{ rule: "XYZ-999", from: "T9" }, { rule: "SCS-010", from: "T1" }]);
    assert.deepStrictEqual(r.missing, ["XYZ-999"]);
    assert.ok(r.items.some((i) => i.id === "SCS-010"));
  });

  test("a source with a path, or a document the files do not hold, is never read", () => {
    assert.strictEqual(C.findDocumentFile(DEMO_FILES, "../package.json"), null);
    assert.strictEqual(C.findDocumentFile(DEMO_FILES, "FCA_SYSC-4_October2026.pdf"), null, "only Markdown documents are traced");
    const r = C.loadRegister([{ id: "team", present: [{ source: "Nexus_Not-A-Document.md" }] }], { root: DEMO_FILES });
    assert.deepStrictEqual(r.unreadable, ["Nexus_Not-A-Document.md"]);
  });
});

describe("U-RULECHAIN: S2's review, on S2's card", () => {
  const layers = layersFor(scenario("s2"));
  const loaded = C.loadRegister(layers, { root: DEMO_FILES });
  const chain = C.traceChains(loaded.register, s2Roots());

  test("the six tool findings and the review's own rules give the chain the content README states (30 paragraphs, none missing)", () => {
    assert.deepStrictEqual(REVIEW_RULES, ["REV-002", "REV-003", "REV-004", "REV-006", "REV-007"]);
    assert.deepStrictEqual(chain.missing, []);
    assert.strictEqual(chain.capped, 0);
    const by = (layer) => chain.items.filter((i) => i.layer === layer).map((i) => `${i.id} <- ${i.tracedFrom.join(",")}`);
    assert.deepStrictEqual(by("corporate"), [
      "SEC-POL-001 clause 4.3 <- T1",
      "SEC-POL-001 clause 4.6 <- T2",
      "FIN-POL-003 clause 4.3 <- T3",
      "SEC-POL-001 clause 4.8 <- T4",
      "TPR-POL-002 clause 4.2 <- T5",
      "FIN-POL-003 clause 4.8 <- T6",
      "TEC-POL-002 clause 4.5 <- the review",
      "TEC-POL-002 clause 4.4 <- the review",
      "TEC-POL-005 clause 4.3 <- the review",
      "TEC-POL-005 clause 4.4 <- the review",
      "TEC-POL-002 clause 4.8 <- the review",
    ]);
    assert.deepStrictEqual(by("sdlc"), [
      "SCS-010 <- T1",
      "SCS-021 <- T2",
      "PAY-012 <- T3",
      "SCS-031 <- T4",
      "DEP-001 <- T5",
      "TST-001 <- T6",
      "REV-002 <- the review",
      "REV-003 <- the review",
      "REV-004 <- the review",
      "REV-006 <- the review",
      "REV-007 <- the review",
    ]);
    // S2's card holds CLR-WIKI-014, CLR-WIKI-006, ADR-007 and the digest: S1's ADR-004 and post-mortem are not S2's.
    assert.deepStrictEqual(by("team"), [
      "CLR-DIGEST-2026-04 F8 <- T1",
      "CLR-WIKI-014 R2 <- T2",
      "CLR-WIKI-006 T1 <- T2",
      "CLR-DIGEST-2026-04 F3 <- T2",
      "CLR-DIGEST-2026-04 F1 <- T3",
      "CLR-DIGEST-2026-04 F4 <- T4",
      "CLR-DIGEST-2026-04 F5 <- T5",
      "CLR-DIGEST-2026-04 F2 <- T6",
    ]);
  });

  test("traced passages: a paragraph the search found is not repeated (that passage gains its findings); the rest follow the layer's searched passages", () => {
    const searchedRow = (source, text) => ({ source, text, rerankScore: 0.9, metadata: "{}" });
    const scs = loaded.register.get("SCS-021");
    const rows = {
      regulator: [searchedRow("PCI-DSS-v4_0_1_June2024.pdf", "[Page 17] Cleartext PAN cannot be read from storage.")],
      sdlc: [searchedRow(scs.source, `## 3. Card data ${scs.text}\n\n**SCS-022 Masking card numbers.** …`), searchedRow("Nexus_PAY_Payments-Engineering-Standard_v3.md", "PAY-030 Audit events")],
    };
    const searched = P.numberPassages(layers, rows);
    const markers = Object.fromEntries(layers.map((p) => [p.id, p.marker]));
    const merged = C.withTracedPassages(searched, chain.items, markers);
    assert.deepStrictEqual(merged.alreadySearched, [{ id: "SCS-021", marker: "SDLC-1" }]);
    assert.strictEqual(merged.added.length, chain.items.length - 1);
    const sdlc1 = merged.passages.find((p) => p.marker === "SDLC-1");
    assert.deepStrictEqual([sdlc1.via, sdlc1.tracedFrom], [undefined, ["T2"]]);
    const scs010 = merged.passages.find((p) => p.ruleId === "SCS-010");
    assert.deepStrictEqual([scs010.marker, scs010.via, scs010.tracedFrom, scs010.sectionPath], ["SDLC-3", "trace", ["T1"], "SCS-010 No hard-coded secrets"]);
    assert.ok(merged.passages.every((p) => P.MARKER_RE.test(p.marker)));
    const order = merged.passages.map((p) => P.PILLAR_ORDER.indexOf(p.pillar));
    assert.deepStrictEqual(order, [...order].sort((a, b) => a - b), "authority order");
    assert.strictEqual(new Set(merged.passages.map((p) => p.marker)).size, merged.passages.length, "markers unique");
    // The answer can cite a traced marker, and its chip says how it was found.
    const check = P.markerCheck("SCS-010 [SDLC-3] implements SEC-POL-001 clause 4.3 [CORP-1].", merged.passages);
    assert.deepStrictEqual(check.unknown, []);
    const chips = P.citationsFor(check.cited, merged.passages);
    assert.deepStrictEqual([chips[0].via, chips[0].tracedFrom], ["trace", ["T1"]]);
  });

  test("the evidence block says what a traced passage is, and labels each; without traces it is unchanged", () => {
    const merged = C.withTracedPassages([], chain.items, Object.fromEntries(layers.map((p) => [p.id, p.marker])));
    const ev = P.evidenceBlock(layers, merged.passages, {});
    assert.match(ev, /A passage marked "traced from T1" was looked up, not searched/);
    assert.match(ev, /\[SDLC-1\] Nexus_SCS_Secure-Coding-Standard_v4\.md, section SCS-010 No hard-coded secrets \(traced from T1\)/);
    assert.doesNotMatch(P.evidenceBlock(layers, [], {}), /traced/);
  });

  test("the cap holds the prompt in measure", () => {
    assert.strictEqual(C.MAX_TRACED, 32);
    const many = [...loaded.register.values()].filter((r) => r.layer === "sdlc").map((r, i) => ({ rule: r.id, from: `T${i + 1}` }));
    const r = C.traceChains(loaded.register, many);
    assert.strictEqual(r.items.length, C.MAX_TRACED);
    assert.ok(r.capped > 0);
  });
});

describe("U-RULECHAIN: each demo searches its own card (D10 (a))", () => {
  test("S1 searches its ten documents: S2's April digest, written after S1's incident, is not among them", () => {
    const l = layersFor(scenario("s1"));
    assert.deepStrictEqual(l.map((p) => [p.id, p.present.length]), [["regulator", 5], ["corporate", 1], ["sdlc", 2], ["team", 2]]);
    assert.ok(!l.find((p) => p.id === "team").present.some((d) => /CLR-DIGEST/.test(d.source)));
  });

  test("S2 searches its 22: regulator 7 (with PSRs 2017 and PRA SS1/21), corporate 5, SDLC 6, team 4", () => {
    const l = layersFor(scenario("s2"));
    assert.deepStrictEqual(l.map((p) => [p.id, p.present.length]), [["regulator", 7], ["corporate", 5], ["sdlc", 6], ["team", 4]]);
  });

  test("no demo, or an empty card, searches everything; a card document the store lacks stays missing", () => {
    const all = P.resolvePillars(loadManifest(), storeOf(loadManifest()));
    assert.strictEqual(P.scopePillars(all, null), all);
    assert.strictEqual(P.scopePillars(all, []), all);
    const partial = P.resolvePillars(loadManifest(), storeOf(loadManifest()).filter((d) => d.source !== "Nexus_ADR-004_Monetary-Amounts-Use-Decimal.md"));
    const team = P.scopePillars(partial, cardOf(scenario("s1"))).find((p) => p.id === "team");
    assert.deepStrictEqual(team.missing, ["Nexus_ADR-004_Monetary-Amounts-Use-Decimal.md"]);
  });
});

describe("U-RULECHAIN: the turn's seams", () => {
  const turn = codeOnly(read("src/lib/coding/turn.js"));

  test("a demo's turn scopes its layers to the card before searching", () => {
    assert.match(turn, /const cardSources = scenario && scenario\.card \? scenario\.card\.artefacts\.documents\.map\(\(d\) => d\.source\) : null;/);
    assert.match(turn, /const pillars = scopePillars\(resolvePillars\(manifest, storeDocuments\), cardSources\);/);
  });

  test("a review traces its tool findings' rules and the review's own; a step may name its own rules (S5-D17); from the image's demo files, after the search", () => {
    assert.match(turn, /if \(chainRoots\) \{\s*const chainStart = Date\.now\(\);\s*const roots = chainRoots;/);
    assert.match(turn, /const scanRoots = scan \? \[\.\.\.scan\.findings\.map\(\(f\) => \(\{ rule: f\.rule, from: f\.id \}\)\), \.\.\.REVIEW_RULES\.map/, "a review's roots first, unchanged");
    assert.match(turn, /const stepRoots = step && Array\.isArray\(step\.traceRules\) \? step\.traceRules\.map\(\(rule\) => \(\{ rule, from: rule \}\)\) : \[\];/, "the step's named rules, each from itself");
    // S6 (2026-10-13): a review step may name rules too (the audit: STD-SVS's), after the findings' and the review's.
    assert.match(turn, /const chainRoots = scanRoots\.length \|\| stepRoots\.length \? \[\.\.\.scanRoots, \.\.\.stepRoots\] : null;/);
    assert.match(turn, /loadRegister\(pillars, \{ root: DEMO_FILES_ROOT \}\)/);
    assert.ok(turn.indexOf("withTracedPassages(") > turn.indexOf("let passages = numberPassages("), "traced after the search");
    assert.ok(turn.indexOf("withTracedPassages(") < turn.indexOf("evidenceBlock(pillars, passages, outcomes)"), "traced before the prompt");
  });

  test("the run log and the chips keep how each passage was found", () => {
    assert.match(turn, /citedPassages: passages\.filter\(\(p\) => check\.cited\.includes\(p\.marker\)\)\.map\(\(p\) => \(\{[^}]*text: p\.text, \.\.\.traceFields\(p\) \}\)\)/);
    assert.match(turn, /passages: passages\.map\(\(p\) => \(\{[^}]*\.\.\.traceFields\(p\) \}\)\)/);
  });
});
