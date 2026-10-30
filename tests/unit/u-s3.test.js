/**
 * U-S3 — the clearing batch migration (s3-design.md; the owner's D1–D6 and S3-D7 to S3-D10 of 2026-10-10): two demos on
 * one seed (S3 to Java, S3r to Rust), a `migrate` step whose prompt carries the program's layouts computed by a tool,
 * the instruction measured in the feasibility runs (inputs/demo-design/evidence/session-90-s3-feasibility/: 0 of 32
 * without the library and the layouts, 5 of 5 with them after one repair), the bridge's legacy check and the ports'
 * tests with the equivalence step, the record's equivalence, and the coding budget of 32,768 tokens (S3-D8).
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { loadScenarios, validateScenario, SCENARIO_COMMAND_IDS } = require("../../src/lib/coding/scenarios");
const { requestInstruction } = require("../../src/lib/coding/persona");
const { stepStates, flowLayout } = require("../../src/lib/coding/steps");
const R = require("../../src/lib/coding/record");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const byId = (id) => loadScenarios().find((s) => s.id === id);
const P = "nexus-payments/";
const RECORDS = ["IN-REC", "RPT-TITLE", "RPT-DATE-LINE", "RPT-HEADINGS", "RPT-DETAIL", "RPT-COUNT-LINE"];

describe("U-S3: the two demos", () => {
  test("S3 ports to Java and S3r to Rust, from one seed: Select runs the legacy check, the migrate step proposes the port, the tests prove it", () => {
    for (const [id, tests, target, lib] of [
      ["s3", "s3-java-tests", `${P}services/clearing`, `${P}libs/cobol-compat/src/main/java/com/nexusbank/cobol/Picture.java`],
      ["s3r", "s3-rust-tests", `${P}services/clearing-rs`, `${P}libs/cobol-compat-rs/src/picture.rs`],
    ]) {
      const s = byId(id);
      assert.strictEqual(s.ticket.id, "MOD-2026-07");
      assert.deepStrictEqual(s.select, { reset: true, runTests: true, branch: "main" });
      assert.deepStrictEqual(s.commands, { tests, select: "s3-legacy" }, "Select runs the COBOL alone: no port exists yet");
      assert.deepStrictEqual(s.clean, [target], "the reset empties the port's folder, which the seed does not hold");
      assert.deepStrictEqual(s.steps.map((x) => [x.id, x.mode, x.action, x.optional]), [["explain", "explain", null, true], ["migrate", "migrate", null, false], ["record", null, "record", false]]);
      const m = s.steps[1];
      assert.deepStrictEqual([m.migrate.source, m.migrate.records], [`${P}legacy/clearing-batch/CLEARING.cbl`, RECORDS]);
      assert.ok(m.after.includes("run-tests") && m.repair && /byte for byte/.test(m.repair.prompt));
      assert.ok(m.attach.includes(`${P}legacy/clearing-batch/CLEARING.cbl`) && m.attach.includes(lib) && m.attach.includes(`${P}backlog/MOD-2026-07.md`));
      // The measured prompt shape: the fixture and the expected report are never attached (with them, the model worked
      // totals out by hand and distrusted the COBOL's own output; feasibility v1).
      assert.ok(!m.attach.some((p) => /clearing_input\.dat|expected_totals\.txt/.test(p)), "no data in the prompt");
      assert.match(m.prompt, /Pass each PICTURE exactly as the COBOL source writes it, with its column from the layouts\./);
      assert.match(m.prompt, /nexus-payments\/services\/clearing/, "the files to write by their workspace paths (Apply writes there)");
      assert.ok(s.open.includes(`${P}legacy/clearing-batch/expected_totals.txt`), "the oracle is open in the IDE for the room");
    }
    assert.match(byId("s3").steps[1].prompt, /writes its report to a JUnit @TempDir/);
    assert.match(byId("s3r").steps[1].prompt, /which Marcus Thorne agreed under ADR-008 D2/);
    assert.match(byId("s3r").steps[1].prompt, /std::env::temp_dir\(\)/);
  });

  test("the cards: Java 19 documents, Rust 22 (adding STD-DEP, TPR-POL-002 and PRA SS2/21), the four new documents on both", () => {
    const s3 = byId("s3").card.artefacts.documents.map((d) => d.source);
    const s3r = byId("s3r").card.artefacts.documents.map((d) => d.source);
    assert.strictEqual(s3.length, 19);
    assert.strictEqual(s3r.length, 22);
    for (const d of ["Nexus_TEC-POL-004_Technology-Lifecycle-and-Modernisation-Policy_v2.md", "Nexus_MIG_Legacy-Modernisation-Standard_v1.md", "Nexus_CLR-WIKI-019_Running-The-Clearing-Batch-Locally.md", "Nexus_ADR-008_Target-Languages-For-Batch-Modernisation.md"]) {
      assert.ok(s3.includes(d) && s3r.includes(d), d);
    }
    assert.deepStrictEqual(s3r.filter((d) => !s3.includes(d)), ["Nexus_DEP_Approved-Dependencies-and-Licences-Standard_v3.md", "Nexus_TPR-POL-002_Third-Party-and-Open-Source-Software-Policy_v3.md", "PRA_SS2-21_Outsourcing_November2024.pdf"]);
    assert.ok(!s3.some((d) => /SYSC-?13/.test(d)), "SYSC 13 applies to insurers (13.1.1G): never on a card");
  });

  test("the definitions refuse what S3 must not do: a migrate step without its block, a block elsewhere, a non-COBOL record name, a folder outside the seed, an unlisted command", () => {
    const base = () => ({
      id: "s9",
      title: "T",
      ticket: { id: "X-1", path: `${P}backlog/MOD-2026-07.md` },
      steps: [{ id: "a", mode: "migrate", prompt: "p", migrate: { source: `${P}legacy/clearing-batch/CLEARING.cbl`, records: ["IN-REC"] }, after: ["run-tests"] }],
      commands: { tests: "s3-java-tests" },
    });
    assert.ok(validateScenario(base()));
    const bad = (mutate, re) => {
      const d = base();
      mutate(d);
      assert.throws(() => validateScenario(d), re);
    };
    bad((d) => delete d.steps[0].migrate, /a migrate step needs migrate \{ source, records \}/);
    bad((d) => Object.assign(d.steps[0], { mode: "change" }), /migrate belongs to a migrate step/);
    bad((d) => (d.steps[0].migrate.records = ["in-rec"]), /migrate\.records names 1 to 20 COBOL records/);
    bad((d) => (d.steps[0].migrate.source = "../CLEARING.cbl"), /is not a path under nexus-payments\//);
    bad((d) => (d.clean = ["services/clearing"]), /is not a path under nexus-payments\//);
    bad((d) => (d.commands.select = "rm-everything"), /is not allow-listed/);
    bad((d) => (d.id = "s3rr"), /must look like s1 or s3r/);
    assert.ok(["s3-legacy", "s3-java-tests", "s3-rust-tests"].every((c) => SCENARIO_COMMAND_IDS.includes(c)));
  });
});

describe("U-S3: the migrate step", () => {
  test("the instruction is the one measured: port paragraph by paragraph, use the layouts, never recompute the oracle, whole files", () => {
    const t = requestInstruction({ mode: "migrate" });
    assert.match(t, /^This request migrates a program to a new language\. Port its logic paragraph by paragraph from the source\./);
    assert.match(t, /The RECORD AND REPORT LAYOUTS block gives every column position: use it, and never count columns yourself\./);
    assert.match(t, /The fixture and the expected report are not attached: they are the old program's input and its own output, read by the characterisation test at run time, and correct by definition\. Do not try to work out any totals\./);
    assert.match(t, /give each new file whole in one fenced code block whose first line is a `File:` comment/);
    assert.match(requestInstruction({ mode: "migrate", repair: true }), /^The tests failed after the last change/, "a repair is a repair, whatever the mode");
  });

  test("the gate treats a migrate step like a change: proposed, applied, then a passing run after the last Apply", () => {
    const s = byId("s3");
    const at = (n) => `2026-10-10T20:00:${String(n).padStart(2, "0")}.000Z`;
    const PORT = `${P}services/clearing/src/main/java/com/nexusbank/clearing/ClearingBatch.java`;
    const TEST = `${P}services/clearing/src/test/java/com/nexusbank/clearing/ClearingBatchCharacterisationTest.java`;
    const ev = [
      { kind: "select", scenario: "s3", at: at(1) },
      { kind: "test-run", scenario: "s3", command: "s3-legacy", exitCode: 0, at: at(2) },
      { kind: "turn", scenario: "s3", step: "migrate", success: true, fileOperations: [PORT, TEST], at: at(3) },
    ];
    let st = stepStates(s, ev).steps.find((x) => x.id === "migrate");
    assert.deepStrictEqual(st.change.pending, [PORT, TEST]);
    ev.push({ kind: "apply", path: PORT, ok: true, at: at(4) }, { kind: "apply", path: TEST, ok: true, at: at(5) });
    st = stepStates(s, ev).steps.find((x) => x.id === "migrate");
    assert.strictEqual(st.tests.state, "pending", "Select's legacy run satisfies nothing");
    ev.push({ kind: "test-run", scenario: "s3", command: "s3-java-tests", exitCode: 0, at: at(6) });
    st = stepStates(s, ev).steps.find((x) => x.id === "migrate");
    assert.strictEqual(st.complete, true);
    const flow = flowLayout(s);
    assert.ok(flow.nodes.some((n) => n.id === "migrate:tests" && n.sub === "byte-identical to the COBOL"));
  });

  test("the turn: the layouts computed from the workspace's own program, placed before the files, as a tool's facts; 32,768 tokens", () => {
    const turn = codeOnly(read("src/lib/coding/turn.js"));
    assert.match(turn, /const CODING_REQUESTED_MAX_TOKENS = 32768;/);
    assert.match(turn, /const GENERATION_TIMEOUT_MS = 420000;/);
    assert.match(turn, /if \(mode === "migrate" && step && step\.migrate\) \{/);
    assert.match(turn, /const src = readWorkspaceFile\(step\.migrate\.source, FILE_MAX_CHARS\);/);
    assert.match(turn, /const block = layoutBlock\(src\.text, \{ names: step\.migrate\.records \}\);/);
    // Polish Phase 2 (2026-10-14): the files block is composed once as filesContext (U-USAGE), still after the layouts.
    assert.match(turn, /const userContent = \[evidence, reviewContext, layoutContext, filesContext, /);
    assert.match(turn, /title: "Record Layouts",/);
    assert.match(turn, /layouts: layouts \? \{ source: layouts\.source, sha256: layouts\.sha256, records: layouts\.records, error: layouts\.error \|\| null \} : null,/);
  });

  test("the live turn says the layouts were computed by a tool", async () => {
    const { liveTurnReducer } = await import("../../src/lib/coding/turn_client.js");
    const s = liveTurnReducer(liveTurnReducer(null, { type: "start", thinking: "on" }), { type: "layouts", records: 6, fields: 31, error: null });
    assert.deepStrictEqual(s.layouts, { records: 6, fields: 31, error: null });
    assert.match(read("src/components/CodingLiveTurn.jsx"), /computed by a tool/);
  });
});

describe("U-S3: the bridge", () => {
  const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));

  test("the legacy check compiles and runs the COBOL with its DD names, then compares with the expected report", () => {
    assert.match(ext, /\{ program: "cobc", args: \["-x", "-o", "build\/clearing", "legacy\/clearing-batch\/CLEARING\.cbl"\], cwd: SEED_REPO \}/);
    assert.match(ext, /env: \{ DD_CLEARIN: "legacy\/clearing-batch\/clearing_input\.dat", DD_CLEAROUT: "build\/clearing_totals_cobol\.txt" \}/);
    assert.match(ext, /\{ program: "diff", args: \["-u", "legacy\/clearing-batch\/expected_totals\.txt", "build\/clearing_totals_cobol\.txt"\], cwd: SEED_REPO, role: "legacy" \}/);
  });

  test("each port's tests run the legacy check first, then compare the port's report with the live COBOL's (the equivalence), then its own test", () => {
    assert.match(ext, /"s3-legacy": \{ exec: S3_LEGACY, showOutput: true, notes: S3_NOTES \}/);
    assert.match(ext, /"s3-java-tests": \{ exec: \[\.\.\.S3_LEGACY, \.\.\.S3_JAVA\], showOutput: true, notes: S3_NOTES \}/);
    assert.match(ext, /"s3-rust-tests": \{ exec: \[\.\.\.S3_LEGACY, \.\.\.S3_RUST\], showOutput: true, notes: S3_NOTES \}/);
    assert.match(ext, /\{ program: "diff", args: \["-u", "build\/clearing_totals_cobol\.txt", "build\/clearing_totals_java\.txt"\], cwd: SEED_REPO, role: "equivalence" \}/);
    assert.match(ext, /\{ program: "diff", args: \["-u", "build\/clearing_totals_cobol\.txt", "build\/clearing_totals_rust\.txt"\], cwd: SEED_REPO, role: "equivalence" \}/);
    assert.match(ext, /role: "characterisation" \}/);
    assert.match(ext, /"--offline"/, "cargo never reaches a registry");
    assert.match(ext, /ran\.push\(\{ command: [^\n]*role: st\.role \|\| null, ran: Boolean\(r\.ran\), exitCode: r\.ran \? r\.exitCode : null \}\);/);
    assert.match(ext, /return \{ \.\.\.last, output, durationMs, steps: ran,/);
    assert.match(ext, /match: "compiled against libxml"/, "the runtime's known warning is labelled, not hidden");
  });

  test("a demo's reset may empty named folders, only inside the seed repository", () => {
    assert.match(ext, /if \(typeof c !== "string" \|\| !c\.startsWith\(`\$\{SEED_REPO\}\/`\) \|\| c\.includes\("\.\."\)\) return \{ success: false, error: `not a folder in the seed repository: \$\{c\}` \};/);
    assert.match(ext, /const folders = \[\.\.\.new Set\(\[\.\.\.rel\.map\(\(r\) => path\.posix\.dirname\(r\)\), \.\.\.clean\]/);
    const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
    // S6 (2026-10-13): with the folders of the files a demo writes itself, which the seed does not hold.
    assert.match(route, /const clean = \[\.\.\.new Set\(\[\.\.\.\(Array\.isArray\(scenario\.clean\) \? scenario\.clean : \[\]\), \.\.\.own\.map\(\(p\) => path\.posix\.dirname\(p\)\)\]\)\];/);
    assert.match(route, /bridgeCommand\("scenario-reset", \{ scenario: scenario\.id, paths, branch, clean \}\)/);
    // S5: the program's own steps first; a comments demo adds the documentation check's step after them.
    assert.match(route, /const programSteps = ran && Array\.isArray\(result\.steps\) \? result\.steps : null;/);
  });
});

describe("U-S3: the record's equivalence (MIG-001)", () => {
  const steps = (eq, ch = 0) => [
    { command: "cobc -x -o build/clearing legacy/clearing-batch/CLEARING.cbl", role: null, ran: true, exitCode: 0 },
    { command: "diff -u legacy/clearing-batch/expected_totals.txt build/clearing_totals_cobol.txt", role: "legacy", ran: true, exitCode: 0 },
    { command: "javac -d build/classes", role: null, ran: true, exitCode: 0 },
    { command: "diff -u build/clearing_totals_cobol.txt build/clearing_totals_java.txt", role: "equivalence", ran: true, exitCode: eq },
    ...(eq === 0 ? [{ command: "java -jar junit execute", role: "characterisation", ran: true, exitCode: ch }] : []),
  ];

  test("summaries say which check a run reached", () => {
    const junit = "[         7 tests successful      ]\n[         0 tests failed          ]";
    assert.strictEqual(R.summariseSteps(junit, 0, steps(0)), "byte-identical to the COBOL; 7 passed");
    assert.strictEqual(R.summariseSteps("", 1, steps(1)), "the port's report differs from the COBOL's");
    assert.strictEqual(R.summariseSteps("[ 6 tests successful ]\n[ 1 tests failed ]", 1, steps(0, 1)), "byte-identical to the COBOL; the characterisation test failed (1 of 7 failed)");
    assert.strictEqual(R.summariseSteps("", 0, steps(0).slice(0, 2)), "the COBOL's report matches expected_totals.txt");
    assert.strictEqual(R.summariseSteps("", 0, [{ command: "python3 -m unittest", role: null, ran: true, exitCode: 0 }]), null, "S1 and S2 keep their summaries");
    assert.strictEqual(R.summariseTestOutput("test result: ok. 2 passed; 0 failed; 0 ignored", 0), "2 passed");
  });

  test("the record carries the proof, from the last run with an equivalence step, and the Markdown says it plainly", () => {
    const s = byId("s3");
    const at = (n) => `2026-10-10T21:00:${String(n).padStart(2, "0")}.000Z`;
    const events = [
      { kind: "select", scenario: "s3", at: at(1) },
      { kind: "test-run", scenario: "s3", command: "s3-legacy", exitCode: 0, steps: steps(0).slice(0, 2), at: at(2) },
      { kind: "test-run", scenario: "s3", command: "s3-java-tests", exitCode: 1, steps: steps(1), at: at(3) },
      { kind: "test-run", scenario: "s3", command: "s3-java-tests", exitCode: 0, steps: steps(0), summary: "byte-identical to the COBOL; 7 passed", at: at(4) },
    ];
    const { json, markdown } = R.buildEvidenceRecord({ scenario: s, events, recordId: "r3", now: new Date(at(5)) });
    assert.deepStrictEqual(json.verification.equivalence, {
      at: at(4),
      command: "s3-java-tests",
      comparedWith: "the COBOL program's report on the same fixture, produced in the same run",
      identical: true,
      legacyMatchesExpected: true,
      characterisationPassed: true,
      verifiedBy: "tool",
    });
    assert.match(markdown, /Equivalence \(MIG-001\), verified by tool: the new program's report is byte-identical to the COBOL program's on the same fixture/);
    assert.strictEqual(json.tests[2].steps.length, 5);
    const failed = R.buildEvidenceRecord({ scenario: s, events: events.slice(0, 3), recordId: "r4", now: new Date(at(5)) });
    assert.strictEqual(failed.json.verification.equivalence.identical, false);
    assert.match(failed.markdown, /is NOT identical to the COBOL program's/);
  });
});

describe("U-S3: each layer searches on its own topics (D11 (a) of 2026-10-11)", () => {
  // The wording measured after the S3 ingest (inputs/demo-design/evidence/session-90-s3-layers/): searched alone, each
  // layer's topics put the intended rules in its top four; the migrate prompt's own words found none in two layers.
  const MEASURED = {
    regulatorExplain: "testing proportionate to whether the operational resources supporting an important business service have materially changed; review its compliance if there is a material change to the firm's business or its important business services; changes to system components are made according to established procedures, including testing",
    regulatorMigrate: "testing proportionate to whether the operational resources supporting an important business service have materially changed; review its compliance if there is a material change to the firm's business or its important business services; changes to all system components in the production environment are made according to established procedures that include testing",
    corporateExplain: "end-of-life technology replaced under a plan; knowledge held by few people; equivalence proved before go-live; testing of changes to systems that calculate charges",
    corporateMigrate: "equivalence proved before go-live; parallel run and approved cut-over; mapping and testing after a replacement; testing of changes to systems that calculate charges",
    sdlcExplain: "a migration MUST NOT change behaviour, even where that looks wrong; equivalence evidence: a tool compares the old and the new program's outputs byte for byte; characterisation tests for migrations; changes to fee and settlement code",
    teamExplain: "a rewrite is a change to money code; trust the code, not its comments; ROUNDED rounds half away from zero",
  };
  const { layerSearch } = require("../../src/lib/coding/pillars");
  const searchOf = (s, stepId) => {
    const st = s.steps.find((x) => x.id === stepId);
    return layerSearch({ message: st.prompt, hints: st.retrievalHints, layerTopics: st.layerTopics });
  };

  test("S3's and S3r's explain and migrate steps search every layer on the measured topics, never on the prompt", () => {
    for (const [id, mapping, language] of [
      ["s3", "COBOL to Java mapping with the COBOL compatibility library", "Java 21 by default"],
      ["s3r", "COBOL to Rust mapping with the COBOL compatibility crate", "Rust where memory safety or a small footprint matters"],
    ]) {
      const s = byId(id);
      const explain = searchOf(s, "explain");
      const migrate = searchOf(s, "migrate");
      for (const layer of ["regulator", "corporate", "sdlc", "team"]) {
        assert.strictEqual(explain[layer].on, "topics", `${id} explain ${layer}`);
        assert.strictEqual(migrate[layer].on, "topics", `${id} migrate ${layer}`);
      }
      assert.strictEqual(explain.regulator.text, MEASURED.regulatorExplain);
      assert.strictEqual(migrate.regulator.text, MEASURED.regulatorMigrate);
      assert.strictEqual(explain.corporate.text, MEASURED.corporateExplain);
      assert.strictEqual(migrate.corporate.text, MEASURED.corporateMigrate);
      assert.strictEqual(explain.sdlc.text, MEASURED.sdlcExplain);
      assert.strictEqual(migrate.sdlc.text, `a tool, not a person, compares their outputs byte for byte; a migration MUST NOT change behaviour; characterisation tests for migrations; ${mapping}`);
      assert.strictEqual(explain.team.text, MEASURED.teamExplain);
      assert.strictEqual(migrate.team.text, `a rewrite is a change to money code; ROUNDED rounds half away from zero; ${language}`);
      for (const st of s.steps.filter((x) => x.prompt)) assert.deepStrictEqual(st.retrievalHints, [], `${id} ${st.id}: no hints, which no layer would use`);
      assert.ok(!JSON.stringify(s.steps).includes("SYSC 13"), "SYSC 13 applies to insurers: never a topic");
    }
  });

  test("S1's and S2's steps still search every layer on the message plus their hints, as measured before", () => {
    for (const [id, stepId, chars] of [["s1", "diagnose", 361], ["s1", "fix", 355], ["s2", "review", 400], ["s2", "fix", 279]]) {
      const search = searchOf(byId(id), stepId);
      const texts = new Set(Object.values(search).map((x) => `${x.on}:${x.text}`));
      assert.strictEqual(texts.size, 1, `${id} ${stepId}: one shared search`);
      assert.strictEqual(search.team.on, "message");
      assert.strictEqual(search.team.text.length, chars, `${id} ${stepId}`);
    }
  });

  test("the definitions refuse topics that would be cut or ignored: an unknown layer, an empty or long list, an action step, a seventh hint", () => {
    const base = () => ({
      id: "s9",
      title: "T",
      ticket: { id: "X-1", path: `${P}backlog/MOD-2026-07.md` },
      steps: [{ id: "a", mode: "explain", prompt: "p", layerTopics: { regulator: ["material change"], team: ["money code"] } }, { id: "r", action: "record" }],
    });
    assert.deepStrictEqual(validateScenario(base()).steps[0].layerTopics, { regulator: ["material change"], team: ["money code"] });
    assert.strictEqual(validateScenario({ ...base(), steps: [{ id: "a", prompt: "p" }] }).steps[0].layerTopics, null);
    const bad = (mutate, re) => {
      const d = base();
      mutate(d);
      assert.throws(() => validateScenario(d), re);
    };
    bad((d) => (d.steps[0].layerTopics = { regulators: ["x"] }), /layerTopics names an unknown layer "regulators"/);
    bad((d) => (d.steps[0].layerTopics = { team: [] }), /layerTopics\.team lists 1 to 6 topics/);
    bad((d) => (d.steps[0].layerTopics = { team: ["a", "b", "c", "d", "e", "f", "g"] }), /layerTopics\.team lists 1 to 6 topics/);
    bad((d) => (d.steps[0].layerTopics = { team: ["x".repeat(700), "y".repeat(600)] }), /layerTopics\.team is longer than one search \(1200 characters\)/);
    bad((d) => (d.steps[0].layerTopics = ["material change"]), /layerTopics maps a layer to its topics/);
    bad((d) => (d.steps[1].layerTopics = { team: ["x"] }), /an action step searches nothing, so it has no layerTopics/);
    bad((d) => (d.steps[0].retrievalHints = ["1", "2", "3", "4", "5", "6", "7"]), /at most 6 retrieval hints/);
  });

  test("the turn searches each layer on its own text and keeps that text in the trace and the run log", () => {
    const turn = codeOnly(read("src/lib/coding/turn.js"));
    assert.match(turn, /const search = layerSearch\(\{ message: cleanMessage, hints: step \? step\.retrievalHints : \[\], layerTopics: step \? step\.layerTopics : null \}\);/);
    assert.match(turn, /body: JSON\.stringify\(\{ \.\.\.base, query: search\[p\.id\]\.text, documentFilter: filter, \.\.\.PER_LAYER_RETRIEVAL \}\),/);
    assert.match(turn, /searchedOn: search\[id\]\.on,\s*searchText: search\[id\]\.text,/);
    assert.match(turn, /\.\.\.\(o\.state && o\.state !== "absent" \? \{ searchedOn: search\[id\]\.on, search: search\[id\]\.text \} : \{\}\),/);
    assert.match(turn, /"each layer searched on the step's topics for it"/);
  });

  test("the record says what each layer searched for: once when the layers shared one text, by layer when they did not", () => {
    const s = byId("s3");
    const at = (n) => `2026-10-11T14:00:${String(n).padStart(2, "0")}.000Z`;
    const own = searchOf(s, "migrate");
    const layers = ["regulator", "corporate", "sdlc", "team"].map((id) => ({ id, documents: 3, passages: 4, state: "ok", searchedOn: own[id].on, search: own[id].text }));
    const turn = { kind: "turn", scenario: "s3", step: "migrate", turnId: "t1", success: true, layers, at: at(2) };
    const md = (events) => R.buildEvidenceRecord({ scenario: s, events: [{ kind: "select", scenario: "s3", at: at(1) }, ...events], recordId: "r9", now: new Date(at(9)) });
    const perLayer = md([turn]);
    assert.strictEqual(perLayer.json.turns[0].layers[0].searchedOn, "topics");
    assert.strictEqual(perLayer.json.turns[0].layers[3].search, own.team.text);
    assert.match(perLayer.markdown, /- Searched for, by layer:\n  - External regulation \(the step's topics\): testing proportionate to whether/);
    assert.match(perLayer.markdown, /  - Team knowledge \(the step's topics\): a rewrite is a change to money code; ROUNDED rounds half away from zero; Java 21 by default/);
    const shared = md([{ ...turn, layers: layers.map((l) => ({ ...l, searchedOn: "message", search: "Fix it\n\nTopics: money" })) }]);
    assert.match(shared.markdown, /- Searched for \(every layer\): Fix it  Topics: money\n/);
    const older = md([{ ...turn, layers: layers.map(({ searchedOn, search, ...l }) => l) }]);
    assert.ok(!/Searched for/.test(older.markdown), "a turn logged before the change says nothing it does not know");
    assert.strictEqual(older.json.turns[0].layers[0].search, null);
  });
});

describe("U-S3: a migrate turn attaches its step's files only", () => {
  test("the active editor's file is never added to a migrate turn: the fixture and the expected report stay out, as measured", () => {
    const turn = codeOnly(read("src/lib/coding/turn.js"));
    // S4: an audit turn leaves the editor's file out too (the ticket), as measured.
    // S5: a comments turn leaves the editor's file out too, as measured.
    assert.match(turn, /if \(mode !== "migrate" && mode !== "audit" && mode !== "comments" && activeFile && typeof activeFile\.content === "string" && !attached\.some\(\(f\) => f\.path === activeFile\.path\)\) \{/);
    for (const id of ["s3", "s3r"]) {
      const s = byId(id);
      for (const p of [`${P}legacy/clearing-batch/clearing_input.dat`, `${P}legacy/clearing-batch/expected_totals.txt`]) {
        assert.ok(s.open.includes(p), `${id}: Select shows ${p} in the editor`);
        assert.ok(!s.steps.find((x) => x.id === "migrate").attach.includes(p), `${id}: and the migrate step never attaches it`);
      }
    }
  });
});

describe("U-S3: the IDE shows a migration beside what it replaces (S3-D13 (a) of 2026-10-11)", () => {
  const S = require("../../src/lib/coding/steps");
  const SRC = `${P}legacy/clearing-batch/CLEARING.cbl`;
  const EXP = `${P}legacy/clearing-batch/expected_totals.txt`;
  const JAVA = { port: `${P}services/clearing/src/main/java/com/nexusbank/clearing/ClearingBatch.java`, test: `${P}services/clearing/src/test/java/com/nexusbank/clearing/ClearingBatchCharacterisationTest.java` };
  const RUST = { cargo: `${P}services/clearing-rs/Cargo.toml`, port: `${P}services/clearing-rs/src/main.rs`, test: `${P}services/clearing-rs/tests/characterisation.rs` };

  test("the port opens beside the COBOL it replaces, the characterisation test beside the report it checks, anything else alone", () => {
    const m3 = byId("s3").steps.find((x) => x.id === "migrate");
    const m3r = byId("s3r").steps.find((x) => x.id === "migrate");
    assert.deepStrictEqual(m3.migrate.beside, { [JAVA.port]: SRC, [JAVA.test]: EXP });
    assert.deepStrictEqual(m3r.migrate.beside, { [RUST.port]: SRC, [RUST.test]: EXP });
    for (const [m, files] of [[m3, JAVA], [m3r, RUST]]) for (const f of [files.port, files.test]) assert.ok(m.prompt.includes(f), `the prompt names ${f}`);
    assert.deepStrictEqual(S.proposalView(m3, JAVA.port), { beside: SRC });
    assert.deepStrictEqual(S.proposalView(m3, JAVA.test), { beside: EXP });
    assert.deepStrictEqual(S.proposalView(m3r, RUST.cargo), { alone: true }, "a migration's other new file opens alone, never against an empty document");
    assert.strictEqual(S.proposalView(byId("s1").steps.find((x) => x.id === "fix"), "nexus-payments/services/settlement/settlement_reconciler.py"), null, "S1 and S2 keep their diffs");
    assert.strictEqual(S.proposalView(null, JAVA.port), null);
  });

  test("the port is shown last, so it stays in front; the step bar's Show button follows the same order", () => {
    const m3 = byId("s3").steps.find((x) => x.id === "migrate");
    const m3r = byId("s3r").steps.find((x) => x.id === "migrate");
    assert.deepStrictEqual(S.showOrder(m3, [JAVA.port, JAVA.test]), [JAVA.test, JAVA.port]);
    assert.deepStrictEqual(S.showOrder(m3r, [RUST.cargo, RUST.port, RUST.test]), [RUST.cargo, RUST.test, RUST.port]);
    assert.deepStrictEqual(S.showOrder(byId("s1").steps.find((x) => x.id === "fix"), ["b", "a"]), ["b", "a"], "other steps keep the answer's order");
    const at = (n) => `2026-10-11T17:00:${String(n).padStart(2, "0")}.000Z`;
    const events = [
      { kind: "select", scenario: "s3", at: at(1) },
      { kind: "turn", scenario: "s3", step: "migrate", turnId: "t1", success: true, fileOperations: [JAVA.port, JAVA.test], at: at(2) },
    ];
    const next = S.stepStates(byId("s3"), events).next;
    assert.strictEqual(next.action, "apply");
    assert.deepStrictEqual(next.pending, [JAVA.test, JAVA.port]);
  });

  test("the definitions refuse a pairing outside the seed or that is not a map", () => {
    const base = () => ({
      id: "s9",
      title: "T",
      ticket: { id: "X-1", path: `${P}backlog/MOD-2026-07.md` },
      steps: [{ id: "a", mode: "migrate", prompt: "p", migrate: { source: SRC, records: ["IN-REC"], beside: { [JAVA.port]: SRC } }, after: ["run-tests"] }],
      commands: { tests: "s3-java-tests" },
    });
    assert.deepStrictEqual(validateScenario(base()).steps[0].migrate.beside, { [JAVA.port]: SRC });
    const bad = (mutate, re) => {
      const d = base();
      mutate(d);
      assert.throws(() => validateScenario(d), re);
    };
    bad((d) => (d.steps[0].migrate.beside = { [JAVA.port]: "../CLEARING.cbl" }), /is not a path under nexus-payments\//);
    bad((d) => (d.steps[0].migrate.beside = { "services/x.java": SRC }), /is not a path under nexus-payments\//);
    bad((d) => (d.steps[0].migrate.beside = [SRC]), /migrate\.beside maps a file the step writes to the file shown beside it/);
  });

  test("the turn and the route send the view with each proposal, in the show order; the bridge applies it to a new file only", () => {
    const turn = codeOnly(read("src/lib/coding/turn.js"));
    assert.match(turn, /for \(const p of showOrder\(step, fileOperations\.map\(\(o\) => o\.path\)\)\) \{/);
    assert.match(turn, /bridgeAction\(\{ type: "showProposal", path: op\.path, content: op\.content, \.\.\.\(proposalView\(step, op\.path\) \|\| \{\}\) \}\)/);
    const route = codeOnly(read("src/app/api/ide-bridge/scenarios/route.js"));
    assert.match(route, /const stepDef = scenarioDef \? scenarioDef\.steps\.find\(\(s\) => s\.id === turn\.step\) : null;/);
    // S5-D14 (a): a comments turn's file is shown as kept by the tool, when it put a code line back.
    assert.match(route, /bridgeAction\(\{ type: "showProposal", path: op\.path, content: kept \|\| op\.content, \.\.\.\(proposalView\(stepDef, op\.path\) \|\| \{\}\) \}\)/);
    const ext = codeOnly(read("code-server-ext/nexcode-bridge/extension.js"));
    assert.match(ext, /if \(isNew && typeof action\.beside === "string" && action\.beside\) \{/);
    assert.match(ext, /if \(isNew && action\.alone === true\) \{/);
  });
});

describe("U-S3: a repair sees its own code", () => {
  test("a repair turn attaches the files the step's last successful answer proposed, as applied, beside the failing run", () => {
    const turn = codeOnly(read("src/lib/coding/turn.js"));
    assert.match(turn, /if \(repair && scenario && step\) \{\s*const turns = windowOf\(readRuns\(\{ limit: 5000 \}\), scenario\.id\)\.filter\(\(e\) => e\.kind === "turn" && e\.step === step\.id && e\.success === true && Array\.isArray\(e\.fileOperations\)\);/);
    assert.match(turn, /attached\.push\(\{ \.\.\.f, source: "proposed" \}\);/);
    assert.match(turn, /f\.source === "proposed" \? "your last answer's file, as applied" : null/);
  });
});
