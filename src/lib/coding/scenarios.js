/**
 * src/lib/coding/scenarios.js — the scenario definitions and the pillar manifest (Machinery PR 1, brief §8 M2; design
 * §5; decision D10 (a); the card, `minutes`, `select` and `optional` from the presenter panels design §5, 2026-10-07).
 *
 * Definitions are JSON under src/data/scenarios/, one file per scenario: reviewed in PRs, shipped in the image, proven
 * by TREE MATCH, and never editable at run time (an applied model answer cannot change a demo). Every path a scenario
 * names is a plain relative workspace path under `nexus-payments/` (the seed repository); every command it names must
 * be one of the bridge extension's allow-listed ids (design §6, decision D3); every document the card names must be
 * one the pillar manifest knows. A prompt step has a mode (presenter flow, 2026-10-07): `explain` answers in the chat
 * with no code (a diagnosis, a review), `change` proposes files the IDE shows as a diff; a change step that runs the
 * tests may carry a `repair` prompt, which the step bar offers when the tests fail.
 *
 * S2 (the pull request review, 2026-10-09): a `review` step reviews a pull request: the scenario's `review` block names
 * the base branch, the pull request's branch and its changed files; Select checks the branch out (`select.branch`) and
 * opens each changed file as a diff against the base; the review step runs the pre-merge checks and answers with findings.
 *
 * S3 (the clearing batch migration, 2026-10-10): a `migrate` step ports a legacy program; its `migrate` block names the
 * source and the records whose layouts a tool computes for the prompt (cobol_layout.js). `commands.select` runs at
 * Select when it differs from the tests (S3: the legacy check alone, before any port exists), and `clean` names the
 * folders a demo writes into that the seed does not hold (a port's target), which the demo's reset empties. A demo's id
 * may carry one letter after its number (s3r: the same scenario with Rust as the target). A migrate block's `beside`
 * pairs each file the step writes with the workspace file the IDE shows beside it (S3-D13 (a) of 2026-10-11).
 *
 * Search topics (D11 (a) of 2026-10-11): a prompt step's `retrievalHints` are topics added to its message for every
 * layer's search; its `layerTopics` name topics per layer, in the words of that layer's documents, and a layer with
 * topics searches on them alone (pillars.js `layerSearch`). Both are checked here, never cut silently.
 *
 * S4 (the closer, the owner's S4-D1 to S4-D6 of 2026-10-12): an `audit` step answers an auditor's question from the four
 * layers, with no code; a `doc` step asks the same question through the document chat (its prompt starts "/doc ", the
 * page sends it to the RAG engine, not the coding turn), for contrast; its `chat` block may set the lookup scope of that
 * one question. A `results` action step opens the Results panel on the latest record of any demo, or the example record.
 *
 * S5 (compliant comments, the owner's S5-D8 to S5-D11 of 2026-10-12): a `comments` step gives a program back whole with
 * its comments brought up to the Code Documentation Standard and no line of code changed; its `comments.source` names
 * the program, whose units a tool lists for the prompt and whose code the documentation check compares. A prompt step
 * may set `thinking` ("on" or "off": S5's comment step runs with thinking off, as measured) and `traceRegulators` (S4's
 * lookups of the regulations its policy clauses name). A card may highlight one rule (`highlight`: S5's DOC-008).
 * S5-D13 (a) of 2026-10-12: a prompt step may set `history` ("on" or "off"): with it off, the turn replays no earlier
 * message (S5's comment step: with the Assess exchange replayed, 3 of 15 answers left units uncommented and 3 changed a
 * line of code; without it, 0 of 10 did either).
 * S5-D17 (a) of 2026-10-13: a prompt step may name rules (`traceRules`, e.g. "DOC-001") whose chains the turn follows
 * through the documents' "Traces to:" lines, as S2's review follows its findings' rules (S5's Assess: STD-DOC's eight).
 *
 * S6 (a new component end to end, the owner's S6-D1 to S6-D7 of 2026-10-13): a comments step's program may be Python
 * (`comments.source` a .py module the demo itself wrote: the documentation check reads its syntax tree in the IDE); an
 * `improve` step reads the latest test run with the code and proposes improvements with their tests (S6-D4 (a)); a review
 * block may audit the demo's own new files in the workspace (`review.workspace: true`: no pull request branch, the files
 * against the seed, which lacks them); a `commit` action step, after the record, commits the step's named files and the
 * record on a feature branch of the Bank's repository as the engineer the presenter plays (S6-D6 (a)). S6-D9 (a): a change
 * step may name the earlier review step whose open blocking findings it fixes (`fixes`): the turn lists them, computed from
 * that review's latest answer, and the step runs without the chat history (measured: a fix that replayed the chat copied
 * its lines instead of writing files).
 */

const { safeRelativePath } = require("./file_ops");
const { validateManifest, PILLAR_ORDER, QUERY_MAX_CHARS } = require("./pillars");

const SEED_PREFIX = "nexus-payments/";
/** The bridge extension's allow-listed command ids a scenario may name (code-server-ext/nexcode-bridge/extension.js). */
const SCENARIO_COMMAND_IDS = Object.freeze(["s1-tests", "s2-tests", "s3-legacy", "s3-java-tests", "s3-rust-tests", "s6-tests"]);
const STEP_AFTER = Object.freeze(["run-tests"]);
const STEP_ACTIONS = Object.freeze(["record", "results", "commit"]);
const STEP_MODES = Object.freeze(["explain", "change", "review", "migrate", "audit", "doc", "comments", "improve"]);
/** S6-D6 (a): a commit goes to a feature branch of the Bank's repository, as a named engineer. */
const FEATURE_BRANCH = /^feature\/[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;
const AUTHOR_EMAIL = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const COMMIT_PATHS_MAX = 10;
const THINKING = Object.freeze(["on", "off"]);
const HISTORY = Object.freeze(["on", "off"]);
/** A rule a step may trace (S5-D17 (a)): a standard's requirement ID, as the documents' trace lines name them. */
const RULE_ID = /^[A-Z]{2,4}-\d{3}$/;
const TRACE_RULES_MAX = 12;
/** A doc step's lookup scope for its one question (the RAG engine's own values, src/lib/rag/config.js). */
const DOC_LOOKUP_SCOPES = Object.freeze(["off", "document"]);
const COBOL_NAME = /^[A-Z][A-Z0-9-]{0,29}$/;
/** A step's search topics (D11 (a) of 2026-10-11): at most this many hints, and this many topics per layer. */
const STEP_HINTS_MAX = 6;
const LAYER_TOPICS_MAX = 6;
const BRANCH_NAME = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
const CARD_MAX_ITEMS = 12;
/** Documents in play may be more: the Documents panel groups them by layer (S2 cites twenty across the four). */
const CARD_MAX_DOCUMENTS = 24;
const CARD_MAX_CHARS = 700;

const str = (v) => (typeof v === "string" ? v.trim() : "");

function seedPath(p, what) {
  const clean = safeRelativePath(p);
  if (!clean || !clean.startsWith(SEED_PREFIX)) throw new Error(`${what}: "${p}" is not a path under ${SEED_PREFIX}`);
  return clean;
}

function shortList(xs, what) {
  const list = (Array.isArray(xs) ? xs : []).map(str).filter(Boolean);
  if (list.length > CARD_MAX_ITEMS) throw new Error(`${what}: at most ${CARD_MAX_ITEMS} items`);
  for (const x of list) if (x.length > CARD_MAX_CHARS) throw new Error(`${what}: an item is longer than ${CARD_MAX_CHARS} characters`);
  return list;
}

/**
 * The demo card (presenter panels design §5): what the demo is, the situation simulated, the people and teams, the
 * artefacts (code under the seed; documents the manifest names), the outputs and the value. Absent → null.
 */
function validateCard(card, where, { documentSources = null } = {}) {
  if (card === undefined || card === null) return null;
  if (typeof card !== "object" || Array.isArray(card)) throw new Error(`${where}: card must be an object`);
  const people = (Array.isArray(card.people) ? card.people : []).map((p, i) => {
    const name = str(p && p.name);
    const role = str(p && p.role);
    if (!name || !role) throw new Error(`${where} card people ${i + 1}: name and role are required`);
    return { name, role, part: str(p && p.part) };
  });
  if (people.length > CARD_MAX_ITEMS) throw new Error(`${where} card people: at most ${CARD_MAX_ITEMS} items`);
  const art = card.artefacts && typeof card.artefacts === "object" ? card.artefacts : {};
  const code = (Array.isArray(art.code) ? art.code : []).map((c, i) => ({ path: seedPath(c && c.path, `${where} card artefact ${i + 1}`), role: str(c && c.role) }));
  const documents = (Array.isArray(art.documents) ? art.documents : []).map((d, i) => {
    const source = str(d && d.source);
    if (!source) throw new Error(`${where} card document ${i + 1}: source is required`);
    if (Array.isArray(documentSources) && !documentSources.includes(source)) throw new Error(`${where} card document "${source}" is not in the pillar manifest`);
    return { source, role: str(d && d.role) };
  });
  if (code.length > CARD_MAX_ITEMS) throw new Error(`${where} card artefacts: at most ${CARD_MAX_ITEMS} code files`);
  if (documents.length > CARD_MAX_DOCUMENTS) throw new Error(`${where} card artefacts: at most ${CARD_MAX_DOCUMENTS} documents`);
  // S5 (D7 (a) of 2026-10-09): the one rule the card puts in front of the audience, with its words and its document.
  let highlight = null;
  if (card.highlight !== undefined && card.highlight !== null) {
    const h = card.highlight;
    const rule = str(h && h.rule);
    const text = str(h && h.text);
    const source = str(h && h.source);
    if (!rule || !text || !source || text.length > CARD_MAX_CHARS) throw new Error(`${where} card highlight: rule, text (at most ${CARD_MAX_CHARS} characters) and source are required`);
    if (!documents.some((d) => d.source === source)) throw new Error(`${where} card highlight: "${source}" is not among the card's documents`);
    highlight = { rule, text, source };
  }
  return {
    about: str(card.about),
    scenario: str(card.scenario),
    people,
    teams: shortList(card.teams, `${where} card teams`),
    artefacts: { code, documents },
    outputs: shortList(card.outputs, `${where} card outputs`),
    value: shortList(card.value, `${where} card value`),
    highlight,
  };
}

/** One definition, checked and normalised; throws with the field that is wrong. */
function validateScenario(def, { documentSources = null } = {}) {
  if (!def || typeof def !== "object") throw new Error("scenario: not an object");
  const id = str(def.id);
  if (!/^s\d{1,2}[a-z]?$/.test(id)) throw new Error(`scenario: id "${def.id}" must look like s1 or s3r`);
  const where = `scenario ${id}`;
  const title = str(def.title);
  if (!title) throw new Error(`${where}: title is required`);
  const ticket = def.ticket && typeof def.ticket === "object" ? { id: str(def.ticket.id), path: seedPath(def.ticket.path, `${where} ticket`) } : null;
  if (!ticket || !ticket.id) throw new Error(`${where}: ticket { id, path } is required`);
  const open = (Array.isArray(def.open) ? def.open : []).map((p) => seedPath(p, `${where} open`));
  const steps = (Array.isArray(def.steps) ? def.steps : []).map((s, i) => {
    const sid = str(s && s.id);
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(sid)) throw new Error(`${where} step ${i + 1}: id "${s && s.id}" is not a short lower-case id`);
    const action = str(s.action) || null;
    if (action && !STEP_ACTIONS.includes(action)) throw new Error(`${where} step ${sid}: unknown action "${action}"`);
    const prompt = str(s.prompt);
    if (!action && !prompt) throw new Error(`${where} step ${sid}: a step needs a prompt or an action`);
    const after = (Array.isArray(s.after) ? s.after : []).map(str).filter(Boolean);
    for (const a of after) if (!STEP_AFTER.includes(a)) throw new Error(`${where} step ${sid}: unknown follow-up "${a}"`);
    if (s.optional !== undefined && typeof s.optional !== "boolean") throw new Error(`${where} step ${sid}: optional must be true or false`);
    const modeRaw = str(s.mode);
    if (modeRaw && !STEP_MODES.includes(modeRaw)) throw new Error(`${where} step ${sid}: mode must be explain, change, review, migrate, audit, doc, comments or improve`);
    if (action && modeRaw) throw new Error(`${where} step ${sid}: an action step has no mode`);
    const mode = action ? null : modeRaw || (after.includes("run-tests") ? "change" : "explain");
    let repair = null;
    if (s.repair !== undefined && s.repair !== null) {
      if (!["change", "migrate", "comments", "improve"].includes(mode) || !after.includes("run-tests")) throw new Error(`${where} step ${sid}: repair belongs to a change, migrate, comments or improve step that runs the tests`);
      const repairPrompt = str(s.repair && s.repair.prompt);
      if (!repairPrompt) throw new Error(`${where} step ${sid}: repair.prompt is required`);
      repair = { prompt: repairPrompt };
    }
    let migrate = null;
    if (mode === "migrate") {
      const m = s.migrate && typeof s.migrate === "object" ? s.migrate : null;
      if (!m) throw new Error(`${where} step ${sid}: a migrate step needs migrate { source, records }`);
      const records = (Array.isArray(m.records) ? m.records : []).map(str).filter(Boolean);
      if (records.length === 0 || records.length > 20 || !records.every((r) => COBOL_NAME.test(r))) throw new Error(`${where} step ${sid}: migrate.records names 1 to 20 COBOL records`);
      // S3-D13 (a) of 2026-10-11: `beside` pairs a new file the step writes with the workspace file the IDE shows beside
      // it (the port beside the program it replaces, the characterisation test beside the report it checks).
      const beside = {};
      if (m.beside !== undefined && m.beside !== null) {
        if (typeof m.beside !== "object" || Array.isArray(m.beside)) throw new Error(`${where} step ${sid}: migrate.beside maps a file the step writes to the file shown beside it`);
        const pairs = Object.entries(m.beside);
        if (pairs.length > 10) throw new Error(`${where} step ${sid}: migrate.beside pairs at most 10 files`);
        for (const [target, partner] of pairs) beside[seedPath(target, `${where} step ${sid} migrate.beside`)] = seedPath(partner, `${where} step ${sid} migrate.beside`);
      }
      migrate = { source: seedPath(m.source, `${where} step ${sid} migrate.source`), records, beside };
    } else if (s.migrate !== undefined) {
      throw new Error(`${where} step ${sid}: migrate belongs to a migrate step`);
    }
    const retrievalHints = (Array.isArray(s.retrievalHints) ? s.retrievalHints : []).map(str).filter(Boolean);
    if (retrievalHints.length > STEP_HINTS_MAX) throw new Error(`${where} step ${sid}: at most ${STEP_HINTS_MAX} retrieval hints`);
    let layerTopics = null;
    if (s.layerTopics !== undefined && s.layerTopics !== null) {
      if (action) throw new Error(`${where} step ${sid}: an action step searches nothing, so it has no layerTopics`);
      if (typeof s.layerTopics !== "object" || Array.isArray(s.layerTopics)) throw new Error(`${where} step ${sid}: layerTopics maps a layer to its topics`);
      layerTopics = {};
      for (const [layer, list] of Object.entries(s.layerTopics)) {
        if (!PILLAR_ORDER.includes(layer)) throw new Error(`${where} step ${sid}: layerTopics names an unknown layer "${layer}"`);
        const topics = (Array.isArray(list) ? list : []).map(str).filter(Boolean);
        if (topics.length === 0 || topics.length > LAYER_TOPICS_MAX) throw new Error(`${where} step ${sid}: layerTopics.${layer} lists 1 to ${LAYER_TOPICS_MAX} topics`);
        if (topics.join("; ").length > QUERY_MAX_CHARS) throw new Error(`${where} step ${sid}: layerTopics.${layer} is longer than one search (${QUERY_MAX_CHARS} characters)`);
        layerTopics[layer] = topics;
      }
    }
    const attach = (Array.isArray(s.attach) ? s.attach : []).map((p) => seedPath(p, `${where} step ${sid} attach`));
    // S4: a doc step goes to the document chat, which searches no layer and reads no file; only its lookup scope is set.
    let chat = null;
    if (mode === "doc") {
      if (!/^\/doc\s+\S/.test(prompt)) throw new Error(`${where} step ${sid}: a doc step's prompt starts with "/doc " and asks a question`);
      if (after.length || attach.length || retrievalHints.length || layerTopics) throw new Error(`${where} step ${sid}: a doc step asks the document chat: no follow-up, files, hints or layer topics`);
      if (s.chat !== undefined && s.chat !== null) {
        const scope = str(s.chat && s.chat.lookupScope);
        if (typeof s.chat !== "object" || Array.isArray(s.chat) || !DOC_LOOKUP_SCOPES.includes(scope)) throw new Error(`${where} step ${sid}: chat.lookupScope must be off or document`);
        chat = { lookupScope: scope };
      }
    } else if (s.chat !== undefined) {
      throw new Error(`${where} step ${sid}: chat belongs to a doc step`);
    }
    if (mode === "audit" && after.length) throw new Error(`${where} step ${sid}: an audit step answers in the chat: it has no follow-up`);
    // S6-D4 (a): an improve step changes the code with its tests, so the tests run again after Apply.
    if (mode === "improve" && !after.includes("run-tests")) throw new Error(`${where} step ${sid}: an improve step runs the tests after Apply (after: ["run-tests"])`);
    // S5: a comments step names the program whose code must not change; it runs the checks after Apply. S6: the program
    // may be a Python module (the documentation check then reads its syntax tree in the IDE).
    let comments = null;
    if (mode === "comments") {
      const c = s.comments && typeof s.comments === "object" ? s.comments : null;
      const source = c ? seedPath(c.source, `${where} step ${sid} comments.source`) : null;
      const language = source && /\.(?:cbl|cob|cpy)$/i.test(source) ? "cobol" : source && /\.py$/i.test(source) ? "python" : null;
      if (!language) throw new Error(`${where} step ${sid}: a comments step needs comments { source }, a COBOL program or a Python module`);
      if (!attach.includes(source)) throw new Error(`${where} step ${sid}: a comments step attaches its comments.source`);
      if (!after.includes("run-tests")) throw new Error(`${where} step ${sid}: a comments step runs the checks after Apply (after: ["run-tests"])`);
      comments = { source, language };
    } else if (s.comments !== undefined) {
      throw new Error(`${where} step ${sid}: comments belongs to a comments step`);
    }
    let thinking = null;
    if (s.thinking !== undefined && s.thinking !== null) {
      thinking = str(s.thinking);
      if (action || mode === "doc" || !THINKING.includes(thinking)) throw new Error(`${where} step ${sid}: thinking is "on" or "off", on a step NexCODE answers`);
    }
    let history = null;
    if (s.history !== undefined && s.history !== null) {
      history = str(s.history);
      if (action || mode === "doc" || !HISTORY.includes(history)) throw new Error(`${where} step ${sid}: history is "on" or "off", on a step NexCODE answers`);
    }
    if (s.traceRegulators !== undefined && (typeof s.traceRegulators !== "boolean" || action || mode === "doc")) {
      throw new Error(`${where} step ${sid}: traceRegulators is true or false, on a step NexCODE answers`);
    }
    let traceRules = [];
    if (s.traceRules !== undefined && s.traceRules !== null) {
      const list = Array.isArray(s.traceRules) ? s.traceRules.map(str) : null;
      if (!list || action || mode === "doc" || list.length === 0 || list.length > TRACE_RULES_MAX || list.some((r) => !RULE_ID.test(r)) || new Set(list).size !== list.length) {
        throw new Error(`${where} step ${sid}: traceRules names 1 to ${TRACE_RULES_MAX} distinct rule IDs (such as "DOC-001"), on a step NexCODE answers`);
      }
      traceRules = list;
    }
    // S6-D9 (a): a change step may name the earlier review step it fixes (checked against the steps below).
    let fixes = null;
    if (s.fixes !== undefined && s.fixes !== null) {
      fixes = str(s.fixes);
      if (mode !== "change" || !fixes) throw new Error(`${where} step ${sid}: fixes names an earlier review step, on a change step`);
    }
    // S6-D6 (a): a commit step names the feature branch, the files it commits beside the record, and the engineer.
    let commit = null;
    if (action === "commit") {
      const c = s.commit && typeof s.commit === "object" && !Array.isArray(s.commit) ? s.commit : null;
      const branch = str(c && c.branch);
      if (!FEATURE_BRANCH.test(branch) || !BRANCH_NAME.test(branch)) throw new Error(`${where} step ${sid}: commit.branch must be a feature branch (feature/<name>)`);
      const paths = (c && Array.isArray(c.paths) ? c.paths : []).map((p) => seedPath(p, `${where} step ${sid} commit.paths`));
      if (paths.length === 0 || paths.length > COMMIT_PATHS_MAX || new Set(paths).size !== paths.length) throw new Error(`${where} step ${sid}: commit.paths names 1 to ${COMMIT_PATHS_MAX} distinct files`);
      const author = { name: str(c && c.author && c.author.name), email: str(c && c.author && c.author.email) };
      if (!author.name || !AUTHOR_EMAIL.test(author.email)) throw new Error(`${where} step ${sid}: commit.author needs a name and an email address`);
      commit = { branch, paths, author };
    } else if (s.commit !== undefined) {
      throw new Error(`${where} step ${sid}: commit belongs to a commit step`);
    }
    return {
      id: sid,
      title: str(s.title) || sid,
      prompt: prompt || null,
      action,
      attach,
      retrievalHints,
      layerTopics,
      after,
      optional: s.optional === true,
      mode,
      repair,
      migrate,
      chat,
      comments,
      thinking,
      history,
      traceRegulators: s.traceRegulators === true,
      traceRules,
      fixes,
      commit,
    };
  });
  if (steps.length === 0) throw new Error(`${where}: at least one step is required`);
  if (new Set(steps.map((s) => s.id)).size !== steps.length) throw new Error(`${where}: step ids must be unique`);
  // S6-D6 (a): the commit carries the evidence record, so a record step comes before it. S6-D9 (a): a fix follows its review.
  steps.forEach((st, i) => {
    if (st.fixes && !steps.slice(0, i).some((x) => x.id === st.fixes && x.mode === "review")) throw new Error(`${where} step ${st.id}: fixes names an earlier review step`);
    if (st.action === "commit" && !steps.slice(0, i).some((x) => x.action === "record")) throw new Error(`${where} step ${st.id}: a commit step follows a record step`);
  });
  const commands = def.commands && typeof def.commands === "object" ? { tests: str(def.commands.tests) || null, select: str(def.commands.select) || null } : { tests: null, select: null };
  for (const c of [commands.tests, commands.select]) if (c && !SCENARIO_COMMAND_IDS.includes(c)) throw new Error(`${where}: command "${c}" is not allow-listed`);
  const clean = (Array.isArray(def.clean) ? def.clean : []).map((p) => seedPath(p, `${where} clean`).replace(/\/+$/, ""));
  if (clean.length > 10) throw new Error(`${where}: clean names at most 10 folders`);
  // Polish, PL-D2 (a) of 2026-10-14: the demo's icon on the selection screen, a Remixicon component name.
  let icon = null;
  if (def.icon !== undefined && def.icon !== null) {
    icon = str(def.icon);
    if (!/^Ri[A-Z][A-Za-z0-9]*$/.test(icon)) throw new Error(`${where}: icon must be a Remixicon component name, such as "RiBugLine"`);
  }
  let minutes = null;
  if (def.minutes !== undefined && def.minutes !== null) {
    if (!Number.isInteger(def.minutes) || def.minutes < 1 || def.minutes > 60) throw new Error(`${where}: minutes must be a whole number from 1 to 60`);
    minutes = def.minutes;
  }
  let reset = true;
  let runTests = false;
  let branch = "main";
  if (def.select !== undefined && def.select !== null) {
    if (typeof def.select !== "object" || (def.select.reset !== undefined && typeof def.select.reset !== "boolean")) throw new Error(`${where}: select.reset must be true or false`);
    if (def.select.runTests !== undefined && typeof def.select.runTests !== "boolean") throw new Error(`${where}: select.runTests must be true or false`);
    if (def.select.reset === false) reset = false;
    if (def.select.runTests === true) runTests = true;
    if (def.select.branch !== undefined) {
      branch = str(def.select.branch);
      if (!BRANCH_NAME.test(branch)) throw new Error(`${where}: select.branch "${def.select.branch}" is not a branch name`);
    }
  }
  if (runTests && !commands.tests && !commands.select) throw new Error(`${where}: select.runTests needs a test command`);
  let review = null;
  if (def.review !== undefined && def.review !== null) {
    const r = def.review;
    const base = str(r && r.base) || "main";
    const changed = (Array.isArray(r.changed) ? r.changed : []).map((p) => seedPath(p, `${where} review changed`));
    if (changed.length === 0 || changed.length > 20) throw new Error(`${where}: review.changed names 1 to 20 files`);
    if (r.workspace === true) {
      // S6: the demo's own new files, as the workspace holds them, against the seed: no pull request branch.
      if (r.branch !== undefined || base !== "main" || branch !== "main") throw new Error(`${where}: a workspace review reads the demo's own files on main: no branch`);
      review = { base, branch: null, workspace: true, changed };
    } else {
      const prBranch = str(r && r.branch);
      if (!BRANCH_NAME.test(base) || !BRANCH_NAME.test(prBranch) || base === prBranch) throw new Error(`${where}: review needs a base and a different pull request branch`);
      if (branch !== prBranch) throw new Error(`${where}: select.branch must be the review's branch (${prBranch})`);
      review = { base, branch: prBranch, changed };
    }
  }
  if (steps.some((st) => st.mode === "review") && !review) throw new Error(`${where}: a review step needs the scenario's review block`);
  return {
    id,
    title,
    summary: str(def.summary),
    ticket,
    story: str(def.story),
    language: str(def.language),
    minutes,
    icon,
    select: { reset, runTests, branch },
    review,
    card: validateCard(def.card, where, { documentSources }),
    open,
    steps,
    commands,
    clean,
    talkTrack: str(def.talkTrack),
  };
}

// The shipped definitions (static requires, so the bundle and the unit suite read the same files).
const RAW_SCENARIOS = [
  require("../../data/scenarios/s1-settlement-incident.json"),
  require("../../data/scenarios/s2-pull-request-review.json"),
  require("../../data/scenarios/s3-clearing-batch-java.json"),
  require("../../data/scenarios/s3r-clearing-batch-rust.json"),
  require("../../data/scenarios/s4-closer.json"),
  require("../../data/scenarios/s5-comments.json"),
  require("../../data/scenarios/s6-dispute-intake.json"),
];
const RAW_MANIFEST = require("../../data/scenarios/pillars.json");
// S4-D5 (a) of 2026-10-12: where each regulator provision a trace line names is printed, checked against the live store.
const RAW_REGULATOR_INDEX = require("../../data/scenarios/regulator_index.json");
// S4-D2 (a) of 2026-10-12: the example record the closer opens when no demo has written one since the environment reset.
const RAW_EXAMPLE_RECORD = require("../../data/scenarios/example-record.json");

function manifestSources() {
  return (Array.isArray(RAW_MANIFEST.pillars) ? RAW_MANIFEST.pillars : []).flatMap((p) => (p && Array.isArray(p.documents) ? p.documents : []));
}

function loadScenarios() {
  const documentSources = manifestSources();
  const list = RAW_SCENARIOS.map((def) => validateScenario(def, { documentSources }));
  if (new Set(list.map((s) => s.id)).size !== list.length) throw new Error("scenarios: ids must be unique");
  return list;
}

function loadManifest() {
  validateManifest(RAW_MANIFEST);
  return RAW_MANIFEST;
}

/**
 * The regulator index (src/data/scenarios/regulator_index.json), checked: every entry names its document, its page and
 * the provision's opening words, and says whether the build's check against the store found them (`verified`). An
 * unverified entry is kept but never looked up (regulator_refs.regulatorLookups).
 */
function loadRegulatorIndex() {
  const idx = RAW_REGULATOR_INDEX;
  const entries = idx && idx.entries && typeof idx.entries === "object" && !Array.isArray(idx.entries) ? idx.entries : null;
  if (!entries) throw new Error("regulator index: `entries` must map a provision key to its entry");
  for (const [key, e] of Object.entries(entries)) {
    if (!/^[a-z0-9-]+:[A-Za-z0-9.()-]+$/.test(key)) throw new Error(`regulator index: "${key}" is not a provision key`);
    if (!e || !str(e.source) || !str(e.anchor) || !str(e.label) || !Number.isInteger(e.page) || e.page < 1 || typeof e.verified !== "boolean") {
      throw new Error(`regulator index: ${key} needs a label, a source, a page, an anchor and verified`);
    }
  }
  return idx;
}

/**
 * The files a demo writes itself (S6): its workspace review's files and its commit's, which the seed does not hold. A
 * demo's reset never restores them from the seed commit (it has none to restore): it removes them as new files in their
 * folders.
 */
function demoWrites(scenario) {
  const review = scenario && scenario.review && scenario.review.workspace ? scenario.review.changed : [];
  const commits = (scenario && Array.isArray(scenario.steps) ? scenario.steps : []).flatMap((st) => (st.commit ? st.commit.paths : []));
  return [...new Set([...review, ...commits])];
}

/** `{ scenario, step }` for a request's `{ id, stepId }`, or null when either is unknown. */
function findStep(scenarios, ref) {
  if (!ref || typeof ref !== "object") return null;
  const scenario = (Array.isArray(scenarios) ? scenarios : []).find((s) => s.id === ref.id) || null;
  if (!scenario) return null;
  const step = ref.stepId ? scenario.steps.find((s) => s.id === ref.stepId) || null : null;
  return { scenario, step };
}

/** The shipped example record, checked: a record (an 8-hex id, a scenario, turns) marked `example` with the record it copies. */
function loadExampleRecord() {
  const r = RAW_EXAMPLE_RECORD;
  if (!r || !/^[0-9a-f]{8}$/.test(String(r.id)) || !r.scenario || !Array.isArray(r.turns) || !r.example || !/^[0-9a-f]{8}$/.test(String(r.example.of))) {
    throw new Error("example record: an id, a scenario, turns and example { of, note } are required");
  }
  return r;
}

module.exports = { SEED_PREFIX, SCENARIO_COMMAND_IDS, STEP_MODES, STEP_ACTIONS, DOC_LOOKUP_SCOPES, BRANCH_NAME, FEATURE_BRANCH, validateCard, validateScenario, loadScenarios, loadManifest, loadRegulatorIndex, loadExampleRecord, findStep, demoWrites };
