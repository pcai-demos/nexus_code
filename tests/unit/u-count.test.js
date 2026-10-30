/**
 * U-COUNT — aggregation math (evaluation-plan §2). Ticket T09.
 *
 * Counting used to happen inline in the orchestrator over whatever 20 chunks
 * retrieval returned (audit E18/E17), through a stem-variant regex nobody
 * could switch off (E33), while the trace claimed an uncapped scan. The rules
 * now live in the pure module src/lib/rag/aggregation.js, so every one of them
 * is pinned here on synthetic chunk sets — no pod, no Weaviate.
 *
 * Ground truth for the real corpus is tests/manifests/golden.json `termCounts`
 * (both production extractors agreeing, rule "case-insensitive whole-word");
 * the module implements that rule, and the first case below guards that the
 * ground truth is still there for I-COUNT to assert against.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { corpusEntries } = require("./_helpers");
const {
  RULE_EXACT,
  buildTermRegex,
  expandAggregationQuery,
  countTermOccurrences,
  buildScanDisclosure,
  uncappedClaimAllowed,
  describeScanPlan,
  describeScanResult,
  renderAggregationBlock,
  renderAggregationFailureBlock,
  buildScanResultFacts,
} = require("../../src/lib/rag/aggregation");
const { RETRIEVAL_DEFAULTS, resolveAggregationConfig } = require("../../src/lib/rag/config");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ORCHESTRATOR = fs.readFileSync(path.join(REPO_ROOT, "src/lib/orchestrator.js"), "utf8");

/** The manifest's own pattern (scripts/derive_golden_manifest.py count_token). */
function manifestCount(text, token) {
  const re = new RegExp(`(?<![A-Za-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "gi");
  return (text.match(re) || []).length;
}

const chunk = (source, page, text, extra = {}) => ({ source, page, text, ...extra });
const caption = (source, page, text) =>
  chunk(source, page, text, { metadata: JSON.stringify({ isVisualElement: true }) });
const FORBIDDEN_CLAIMS = [/uncapped/i, /all matching passages/i, /Bypassing Top-K/i, /complete scan/i];

describe("U-COUNT: manifest supplies cross-confirmed count ground truth", () => {
  test("at least one corpus document carries a confirmed term count", () => {
    const withCounts = corpusEntries().filter((e) => (e.termCounts || []).length > 0);
    assert.ok(withCounts.length > 0, "no termCounts were derived for any corpus document");

    for (const entry of withCounts) {
      for (const probe of entry.termCounts) {
        assert.ok(probe.count > 0, `${entry.fileName}: ${probe.token} has a non-positive count`);
        assert.equal(probe.rule, "case-insensitive whole-word", "count rule must be explicit so T09 can implement it exactly");
      }
    }
    assert.strictEqual(RULE_EXACT, "case-insensitive whole-word", "the module names the manifest's rule");
  });
});

describe("U-COUNT: counting semantics", () => {
  test("exact whole-word count matches the manifest rule for a known term", () => {
    const text =
      "The ASSEMBLY starts here. assembly, Assembly's bracket; pre-assembly and assembly_2.\n" +
      "Reassembly and assemblies do not count. ASSEMBLYX neither.";
    const chunks = [chunk("m.pdf", 3, text)];
    const result = countTermOccurrences(chunks, "assembly");
    // The manifest's rule: non-alphanumeric boundaries, so the hyphenated,
    // apostrophe and underscore forms count and the fused ones do not.
    assert.strictEqual(result.occurrences, manifestCount(text, "assembly"));
    assert.strictEqual(result.occurrences, 5);
    assert.strictEqual(result.rule, RULE_EXACT);
    assert.strictEqual(result.countStemVariants, false);
    assert.strictEqual(result.occurrencesInCaptions, 0);
  });

  test("the query term is matched literally — quotes stripped, regex metacharacters escaped, case ignored", () => {
    const chunks = [chunk("m.pdf", 1, "Model SSX-125 and ssx-125 ship; SSX125 does not match the hyphenated form.")];
    assert.strictEqual(countTermOccurrences(chunks, '"SSX-125"').occurrences, 2);
    assert.strictEqual(countTermOccurrences(chunks, "‘ssx-125’").term, "ssx-125");
    assert.throws(() => buildTermRegex("   "), /empty term/);
    assert.throws(() => buildTermRegex("“"), /empty term/, "a quote-only term normalises to nothing");
  });

  test("stem variants are excluded unless countStemVariants is enabled", () => {
    // Audit E33: "test" used to count "testing", "tested", "tests" with no way out.
    const chunks = [chunk("d.pdf", 1, "test tests testing tested test's tests' testes contest")];
    const exact = countTermOccurrences(chunks, "test");
    assert.strictEqual(exact.occurrences, 2, "exact: 'test' and \"test's\" (the possessive is whole-word 'test' followed by an apostrophe)");

    const stem = countTermOccurrences(chunks, "test", { countStemVariants: true });
    assert.strictEqual(stem.occurrences, 7, "stem variants: every listed form except 'contest'");
    assert.notStrictEqual(stem.rule, RULE_EXACT);

    // Only the stem mode strips the QUERY term: "testing" exact means "testing".
    assert.strictEqual(countTermOccurrences(chunks, "testing").occurrences, 1);
    assert.strictEqual(countTermOccurrences(chunks, "testing", { countStemVariants: true }).occurrences, 7);
  });

  test("retrieval expansion follows the counting policy (retrieve what you count)", () => {
    // Weaviate tokenises "term's" into a lone "s" token that matched 31 of 102
    // chunks in the eval collection (measured 2026-09-04) — the apostrophe
    // forms are never sent, in either mode.
    assert.strictEqual(expandAggregationQuery("ASSEMBLY"), "ASSEMBLY");
    assert.strictEqual(expandAggregationQuery('"testing"'), "testing");
    const expanded = expandAggregationQuery("testing", { countStemVariants: true });
    assert.strictEqual(expanded, "test tests testes testing tested");
    assert.ok(!/['’]/.test(expanded), "no apostrophe tokens in the expansion");
    // Every expanded token is something the stem regex would count.
    for (const tok of expanded.split(" ")) {
      const re = buildTermRegex("testing", { countStemVariants: true });
      assert.ok(re.test(tok), `${tok} must be countable`);
    }
  });

  test("an overlap copy of a passage in a second chunk of the same page is counted once", () => {
    // Hypothesis H2 / FM-D4, with the REAL chunker's shape: recursiveSplit
    // runs per page and starts the next chunk with an EXACT copy of the
    // previous chunk's tail (up to chunkOverlap chars), which can begin
    // mid-line. Measured live: six same-page pairs sharing 186–199 chars.
    const tail = "at last the FLUXCAPACITOR requires 1.21 gigawatts of";
    const chunks = [
      chunk("bttf.pdf", 2, `Doc opens here. Marty asks about power and ${tail}`),
      chunk("bttf.pdf", 2, `${tail} power, Doc replies, and a FLUXCAPACITOR is what makes time travel possible.`),
      chunk("bttf.pdf", 3, `${tail} power, Doc replies, and a FLUXCAPACITOR is what makes time travel possible.`), // page 3: genuine repeats
    ];
    const result = countTermOccurrences(chunks, "FLUXCAPACITOR");
    // page 2: the tail's occurrence once (chunk 1) + the second chunk's own
    // second mention; page 3: both of its mentions.
    assert.strictEqual(result.occurrences, 4);
    assert.strictEqual(result.chunksScanned, 3);
    // Retrieval order is BM25 order, not document order: the overlap is found
    // whichever chunk arrives first.
    assert.strictEqual(countTermOccurrences([chunks[1], chunks[0]], "FLUXCAPACITOR").occurrences, 2);
    // Two chunks that merely share a line but not a suffix→prefix copy are
    // genuine repeats (334 of the 421 same-page repeated lines measured).
    const repeats = countTermOccurrences(
      [chunk("t.pdf", 1, "row: FLUXCAPACITOR 1\nrow: FLUXCAPACITOR 2"), chunk("t.pdf", 1, "row: FLUXCAPACITOR 2\nrow: FLUXCAPACITOR 3")],
      "FLUXCAPACITOR"
    );
    assert.strictEqual(repeats.occurrences, 3, "an exact tail→head copy ('row: FLUXCAPACITOR 2') collapses; the rest count");
  });

  test("identical lines inside ONE chunk are genuine repeats and all count (the Aluminium 13-vs-14 defect)", () => {
    // Measured live 2026-09-04: SSX125 page 3 lists "Aluminium handle • hardened
    // tool tip" twice in one chunk; the inherited per-line dedupe counted it
    // once and I-COUNT failed 13 !== 14. The manifest rule counts both.
    const text = "Hex Drivers\nAluminium handle • hardened tool tip\nNut Drivers\nAluminium handle • hardened tool tip\nTorq Master";
    const result = countTermOccurrences([chunk("SSX125_Manual.pdf", 3, text)], "Aluminium");
    assert.strictEqual(result.occurrences, manifestCount(text, "Aluminium"));
    assert.strictEqual(result.occurrences, 2);
    // And the same two lines split across two chunks on the same page with
    // DIFFERENT surrounding context are two occurrences, not an overlap copy.
    const split = countTermOccurrences(
      [chunk("m.pdf", 3, "Hex Drivers\nAluminium handle • hardened tool tip\nNut Drivers"), chunk("m.pdf", 3, "Nut Drivers\nAluminium handle • hardened tool tip\nTorq Master")],
      "Aluminium"
    );
    assert.strictEqual(split.occurrences, 2);
  });

  test("a line with several hits is one evidence line carrying its hit count", () => {
    const chunks = [chunk("d.pdf", 1, "bolt, bolt and bolt again\nno match here\nbolt once")];
    const result = countTermOccurrences(chunks, "bolt");
    assert.strictEqual(result.occurrences, 4);
    assert.deepStrictEqual(result.lines.map((l) => l.hits), [3, 1]);
    const block = renderAggregationBlock(result, buildScanDisclosure({ count: result, candidatesReturned: 1, poolSize: 500 }));
    assert.ok(block.includes("×3"), "a multi-hit line renders once with its multiplicity");
    assert.strictEqual((block.match(/bolt, bolt and bolt again/g) || []).length, 1, "and is not repeated per hit");
  });

  test("VLM caption chunks are scanned but not counted, and are disclosed", () => {
    // Measured on RAGEval_t08_20260813: ASSEMBLY occurs 8 times in SSX125's
    // text chunks and 133 further times in its 29 diagram captions.
    const chunks = [
      chunk("m.pdf", 4, "Assembly step one.\nAssembly step two."),
      caption("m.pdf", 4, "DIAGRAM TYPE: Mechanical Assembly Blueprint\nHUMAN TITLE: Servo Assembly Diagram"),
      chunk("m.pdf", 5, "Assembly (hydrated flag, no metadata)", { isVisualElement: true }),
    ];
    const result = countTermOccurrences(chunks, "assembly");
    assert.strictEqual(result.occurrences, 2);
    assert.strictEqual(result.occurrencesInCaptions, 3);
    assert.strictEqual(result.textChunksScanned, 1);
    assert.strictEqual(result.captionChunksScanned, 2);
    assert.strictEqual(result.chunksScanned, 3);
    const doc = result.perDocument.find((d) => d.source === "m.pdf");
    assert.strictEqual(doc.occurrences, 2);
    assert.strictEqual(doc.occurrencesInCaptions, 3);

    const block = renderAggregationBlock(result, buildScanDisclosure({ count: result, candidatesReturned: 3, poolSize: 500 }));
    assert.ok(/\[Term Frequency Scan: "assembly" — 2 occurrences/.test(block), "the headline is the text count");
    assert.ok(/Not counted: 3 further occurrences in image-description chunks/.test(block));
    assert.ok(/computed count above \(2\) is authoritative/.test(block));
    assert.ok(/State separately that 3 further occurrences appear in image-description chunks and are NOT included in the count of 2/.test(block),
      "the caption instruction is unconditional");
  });

  test("a computed zero is still rendered as a count block (never raw chunks and no number)", () => {
    // BM25 tokenises "spur-gear" into spur + gear and returns the chunk; the
    // whole-word regex finds nothing. Pre-review this fell back to the numbered
    // context and the model tallied for itself — E18 by another door.
    const result = countTermOccurrences([chunk("m.pdf", 2, "the spur-gear installs first")], "spur gear");
    assert.strictEqual(result.occurrences, 0);
    const disclosure = buildScanDisclosure({ count: result, candidatesReturned: 1, poolSize: 500 });
    const block = renderAggregationBlock(result, disclosure);
    assert.ok(/— 0 occurrences in the document text/.test(block));
    assert.ok(/computed count above \(0\) is authoritative/.test(block));
    assert.ok(/complete scan/.test(block));
    // And a scan that matched nothing at all is a complete scan of zero.
    const empty = countTermOccurrences([], "spur gear");
    const emptyDisclosure = buildScanDisclosure({ count: empty, candidatesReturned: 0, poolSize: 500 });
    assert.strictEqual(emptyDisclosure.scanComplete, true);
    assert.ok(/— 0 occurrences/.test(renderAggregationBlock(empty, emptyDisclosure)));
  });

  test("a stored page of 0 or a single-page file is never rendered as 'Page: 1'", () => {
    // F-30/F-11, the same rule citations.js applies: a page is a location only
    // when it is a positive integer and the file is known to be paginated.
    const result = countTermOccurrences(
      [chunk("contract.docx", 0, "indemnity clause"), chunk("stamped.docx", 1, "indemnity again"), chunk("real.pdf", 7, "indemnity here")],
      "indemnity",
      { paginationFacts: { "stamped.docx": false } }
    );
    assert.deepStrictEqual(result.lines.map((l) => l.page), [null, null, 7]);
    const block = renderAggregationBlock(result, buildScanDisclosure({ count: result, candidatesReturned: 3, poolSize: 500 }));
    assert.strictEqual((block.match(/Page: /g) || []).length, 1, "only the located page renders");
    assert.ok(block.includes("[Page: 7, Section: N/A]"));
    assert.ok(!block.includes("Page: 1"));
  });

  test("the evidence shown to the model is bounded; the count is not", () => {
    const chunks = Array.from({ length: 300 }, (_, i) => chunk("big.pdf", i + 1, `widget on page ${i + 1}`));
    const result = countTermOccurrences(chunks, "widget");
    assert.strictEqual(result.occurrences, 300);
    const disclosure = buildScanDisclosure({ count: result, candidatesReturned: 300, poolSize: 500 });
    const block = renderAggregationBlock(result, disclosure, { evidenceLines: 10 });
    assert.strictEqual((block.match(/^- \[Page: /gm) || []).length, 10);
    assert.ok(block.includes("(showing 10 of 300 occurrence lines)"));
    assert.ok(/a sample of 10 of 300/.test(block), "the instruction says it is a sample only when it is");
    assert.ok(block.includes("— 300 occurrences"), "the headline still carries the full count");
    const full = renderAggregationBlock(result, disclosure, { evidenceLines: 300 });
    assert.ok(/even though they are the complete set/.test(full), "and says so when it is not");
    assert.strictEqual(RETRIEVAL_DEFAULTS.aggregationEvidenceLines, 80);
  });

  test("the failure block never asks the model to count or to deny content", () => {
    const block = renderAggregationFailureBlock("bolt", "boom");
    assert.ok(/Term Frequency Scan FAILED for "bolt"/.test(block));
    assert.ok(/Do NOT estimate or count occurrences yourself/.test(block));
    assert.ok(/do NOT claim the documents lack the term/.test(block));
  });
});

describe("U-COUNT: honest scan disclosure (E18)", () => {
  const count = countTermOccurrences([chunk("a.pdf", 1, "x"), chunk("a.pdf", 2, "x"), chunk("b.pdf", 1, "x")], "x");

  test("complete when every matched row reached the counter and BM25 returned fewer rows than the pool allowed", () => {
    const d = buildScanDisclosure({ count, candidatesReturned: 3, poolSize: 500, scanLimit: 500, collectionChunks: 9000 });
    assert.strictEqual(d.scanComplete, true);
    assert.strictEqual(d.capApplied, false);
    assert.ok(uncappedClaimAllowed(d));
    assert.ok(/complete scan: all 3 matching chunks were read/.test(d.coverage));
    assert.strictEqual(describeScanResult(count, d).badge, "COMPLETE SCAN");
  });

  test("complete when the whole collection fits inside the pool, even if the pool filled", () => {
    const three = countTermOccurrences([chunk("a.pdf", 1, "x"), chunk("a.pdf", 2, "x"), chunk("b.pdf", 1, "x")], "x");
    const d = buildScanDisclosure({ count: three, candidatesReturned: 3, poolSize: 3, scanLimit: 3, collectionChunks: 3 });
    assert.strictEqual(d.scanComplete, true);
  });

  test("E18 itself: rows the store matched but the counter never saw is a capped scan, never complete", () => {
    // The pre-T09 shape — pool 100, slice 20 — must render as capped even
    // though BM25 returned fewer rows than the pool: a slice between the store
    // and the count is a cap.
    const d = buildScanDisclosure({ count, candidatesReturned: 53, poolSize: 100, scanLimit: 100, collectionChunks: 102 });
    assert.strictEqual(d.scanComplete, false);
    assert.strictEqual(d.capApplied, true);
    assert.ok(/matched 53 chunks but only 3 reached the counter/.test(d.coverage));
    assert.ok(/lower bound/.test(d.coverage));
    for (const forbidden of FORBIDDEN_CLAIMS) assert.ok(!forbidden.test(d.coverage), `${forbidden}`);
  });

  test("capped when the pool filled and the collection is known to be larger — no uncapped claim anywhere", () => {
    const big = countTermOccurrences(Array.from({ length: 500 }, (_, i) => chunk("a.pdf", i + 1, "x")), "x");
    const d = buildScanDisclosure({ count: big, candidatesReturned: 500, poolSize: 500, scanLimit: 500, collectionChunks: 9000 });
    assert.strictEqual(d.scanComplete, false);
    assert.strictEqual(d.capApplied, true);
    assert.ok(!uncappedClaimAllowed(d));
    assert.ok(/capped scan/.test(d.coverage) && /lower bound/.test(d.coverage));
    const span = describeScanResult(big, d);
    assert.strictEqual(span.badge, "CAPPED SCAN: 500 CHUNKS READ, MORE MAY MATCH");
    assert.strictEqual(span.badgeType, "amber");
    assert.ok(!/OF 9000/.test(span.badge), "the badge never prints the collection total as if it were a match count");
    const block = renderAggregationBlock(big, d, { evidenceLines: 5 });
    assert.ok(/state that 500 is a lower bound/.test(block));
    for (const forbidden of FORBIDDEN_CLAIMS) {
      assert.ok(!forbidden.test(block), `a capped scan must not render ${forbidden}`);
      assert.ok(!forbidden.test(d.coverage));
      assert.ok(!forbidden.test(span.description + span.badge));
    }
  });

  test("unknown — never true — when the numbers to decide are unavailable, and no number is invented", () => {
    // The pool filled and countObjects() threw (a 200 without meta.count, a
    // proxy page, Weaviate down): the honest answer is "unknown".
    const big = countTermOccurrences(Array.from({ length: 500 }, (_, i) => chunk("a.pdf", i + 1, "x")), "x");
    const d = buildScanDisclosure({ count: big, candidatesReturned: 500, poolSize: 500, scanLimit: 500, collectionChunks: null });
    assert.strictEqual(d.scanComplete, null);
    assert.strictEqual(d.collectionChunks, null);
    assert.ok(!uncappedClaimAllowed(d));
    assert.ok(/could not be determined/.test(d.coverage));
    assert.strictEqual(describeScanResult(big, d).badge, "SCAN COVERAGE UNKNOWN");
    assert.ok(!/\b0\b/.test(d.coverage), "no fabricated zero total");
    const facts = buildScanResultFacts(big, d);
    assert.strictEqual(facts.scanComplete, null);
    assert.strictEqual(facts.collectionChunks, null);
    // No report at all (the route's measured row count is missing) is also
    // unknown — even when the collection would fit the pool, because without
    // X nothing proves the counter saw every row.
    assert.strictEqual(buildScanDisclosure({ count, candidatesReturned: null, poolSize: 500, collectionChunks: 3 }).scanComplete, null);
    // A collectionChunks of 0 is not proof of completeness on its own either.
    assert.strictEqual(buildScanDisclosure({ count, candidatesReturned: null, poolSize: 500, collectionChunks: 0 }).scanComplete, null);
    assert.ok(/may be incomplete/.test(renderAggregationBlock(big, d, { evidenceLines: 1 })));
  });

  test("per-document N of M comes from the summary rows; a missing row says so instead of guessing", () => {
    const d = buildScanDisclosure({
      count,
      candidatesReturned: 3,
      poolSize: 500,
      summaryRows: [{ source: "a.pdf", chunkCount: 65, totalPages: 36 }, { source: "b.pdf", chunkCount: 0 }],
    });
    assert.deepStrictEqual(
      d.perDocument.map((p) => [p.source, p.chunksScanned, p.chunksTotal]),
      [["a.pdf", 2, 65], ["b.pdf", 1, null]]
    );
    const block = renderAggregationBlock(count, d);
    assert.ok(block.includes("a.pdf: 2 of its 65 chunks matched the term and all 2 were read"));
    assert.ok(block.includes("b.pdf: 1 matching chunks were read; its total chunk count could not be determined"));
    assert.ok(!block.includes("of its 0 chunks"), "a zero summary row is unknown, never rendered as 0");
    assert.ok(!/badge/.test(JSON.stringify(d)), "the disclosure is data; badge vocabulary lives in describeScanResult");
  });

  test("the plan span states the plan and nothing that has not happened yet", () => {
    const plan = describeScanPlan({ term: "bolt", scanLimit: 500, countStemVariants: false, queryText: "bolt" });
    assert.ok(/up to 500 matching chunks/.test(plan.description));
    assert.deepStrictEqual(plan.details, {
      targetKeyword: "bolt",
      strategy: "Keyword scan, capped at 500 chunks",
      scanLimit: 500,
      countStemVariants: false,
      queryText: "bolt",
      countRule: RULE_EXACT,
    });
    for (const forbidden of [/uncapped/i, /all matching passages/i, /Bypassing/i]) {
      assert.ok(!forbidden.test(plan.description + plan.details.strategy));
    }
  });
});

describe("U-COUNT: the orchestrator wires the module in (source pins)", () => {
  test("the false trace claims are gone from src/ entirely", () => {
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(js|jsx)$/.test(d.name) ? [path.join(dir, d.name)] : []
      );
    for (const file of walk(path.join(REPO_ROOT, "src"))) {
      const text = fs.readFileSync(file, "utf8");
      for (const claim of ["Bypassing Top-K caps", "Uncapped Retrieval", "Full Document Keyword Scan"]) {
        // The orchestrator's own comment may quote the old wording as history;
        // a string literal may not.
        const literal = new RegExp(`["'\`][^"'\`\\n]*${claim}[^"'\`\\n]*["'\`]`);
        assert.ok(!literal.test(text), `${path.relative(REPO_ROOT, file)} still carries the literal "${claim}"`);
      }
    }
  });

  test("the aggregation override sends the resolved scan limit as BOTH limit and keepTopNAfterRerank, last in the payload", () => {
    // E18's mechanism: keepTopNAfterRerank slices on every path, so a raised
    // limit with the slice left at 20 counts exactly 20 chunks. The override
    // must be the LAST spread so nothing after it can re-clamp either knob.
    const override = ORCHESTRATOR.match(/targetAggregationKeyword\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{\}\),\s*\n\s*\};/);
    assert.ok(override, "the aggregation override object must exist and close the payload");
    const body = override[1];
    assert.ok(/^\s*limit:\s*aggregationConfig\.scanLimit,\s*$/m.test(body), "limit must be exactly the resolved scan limit");
    assert.ok(/^\s*keepTopNAfterRerank:\s*aggregationConfig\.scanLimit,\s*$/m.test(body), "keepTopNAfterRerank must be exactly the resolved scan limit");
    assert.ok(/^\s*rerankEnabled:\s*false,\s*$/m.test(body));
    assert.ok(/^\s*searchStrategy:\s*"keyword",\s*$/m.test(body));
    assert.ok(!/\b(limit|keepTopNAfterRerank|candidatesToRerank):\s*\d/.test(body), "no literal pool numbers in the override");
  });

  test("the orchestrator counts through the pure module, with the resolved policy, not an inline regex", () => {
    assert.ok(!/buildVariantStemRegex/.test(ORCHESTRATOR), "the inline stem regex is gone");
    assert.ok(
      /countTermOccurrences\(retrievedChunks,\s*targetAggregationKeyword,\s*\{\s*countStemVariants:\s*aggregationConfig\.countStemVariants,\s*paginationFacts,\s*\}\)/.test(ORCHESTRATOR),
      "the count call takes the resolved stem policy and the pagination facts"
    );
    assert.ok(/expandAggregationQuery\(targetAggregationKeyword,\s*\{\s*countStemVariants:\s*aggregationConfig\.countStemVariants\s*\}\)/.test(ORCHESTRATOR));
    assert.ok(/resolveAggregationConfig\(adminConfig\?\.ragSettings\)/.test(ORCHESTRATOR));
    // T15: the detector lives in the router (normalised there); the orchestrator reads the route's term.
    assert.ok(/const targetAggregationKeyword = route\.intent === "count" \? route\.intentRule\.term : null;/.test(ORCHESTRATOR), "the count term is the router's");
    assert.ok(/countClient\.countObjects\(\)/.test(ORCHESTRATOR), "the collection total comes from countObjects (T21), not inference");
    // T23: the same credential seam retrieval used (a blank field resolves to
    // the store's env override or the pod's workload identity).
    assert.ok(/new WeaviateClient\(rc\.weaviateUrl,\s*resolveCredential\(\{ url: rc\.weaviateUrl, requestValue: rc\.weaviateToken \|\| rc\.token \}\)\.value,\s*rc\.weaviateCollection\)/.test(ORCHESTRATOR),
      "the count client is built from the RESOLVED config the retrieval used, through the credential seam (T23)");
    assert.ok(/describeScanResult\(aggregationCount,\s*aggregationDisclosure\)/.test(ORCHESTRATOR), "the measured span exists");
    assert.ok(/renderAggregationFailureBlock\(targetAggregationKeyword,\s*err\.message\)/.test(ORCHESTRATOR), "a throw after the commit costs the block, not the turn");
  });

  test("a count turn gets its own grounding rules; the entity-breakdown rules that tell the model to count are not emitted", () => {
    const start = ORCHESTRATOR.indexOf("CRITICAL INSTRUCTIONS FOR THIS TERM-FREQUENCY TURN");
    assert.ok(start > 0, "the term-frequency rule block exists");
    const block = ORCHESTRATOR.slice(start, ORCHESTRATOR.indexOf("CRITICAL GROUNDING & CALCULATION INSTRUCTIONS", start));
    assert.ok(/ONLY source of the count/.test(block));
    assert.ok(/NEVER re-count, estimate, or tally/.test(block));
    assert.ok(/Never claim a complete or uncapped scan unless the block says so/.test(block));
    assert.ok(/never add them to the count/.test(block));
    assert.ok(/targetAggregationKeyword \? `CRITICAL INSTRUCTIONS FOR THIS TERM-FREQUENCY TURN/.test(ORCHESTRATOR), "selected by the count intent");
    assert.ok(!/Count item\/room totals/.test(block), "rule 3's own-tally instruction is not in the count block");
  });

  test("the scan limit default is 500, above every document in the demo corpus, and resolves from ragSettings", () => {
    assert.strictEqual(RETRIEVAL_DEFAULTS.aggregationScanLimit, 500);
    assert.strictEqual(RETRIEVAL_DEFAULTS.countStemVariants, false);
    assert.deepStrictEqual(resolveAggregationConfig(undefined), { scanLimit: 500, countStemVariants: false, evidenceLines: 80 });
    assert.deepStrictEqual(resolveAggregationConfig({ aggregationScanLimit: 50, countStemVariants: true, aggregationEvidenceLines: 5 }), {
      scanLimit: 50,
      countStemVariants: true,
      evidenceLines: 5,
    });
    // Junk falls through to the default; a non-boolean is not "true".
    assert.deepStrictEqual(resolveAggregationConfig({ aggregationScanLimit: "lots", countStemVariants: "yes", aggregationEvidenceLines: -1 }), {
      scanLimit: 500,
      countStemVariants: false,
      evidenceLines: 80,
    });
  });
});
