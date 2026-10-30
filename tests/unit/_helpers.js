/**
 * Shared helpers for the golden-corpus unit suites (audit ticket T00).
 *
 * Not a test file: the runner glob is `*.test.js`, so this is never executed
 * as a suite.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "tests", "manifests", "golden.json");

let cachedManifest = null;

function loadManifest() {
  if (cachedManifest) return cachedManifest;
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      `Golden manifest missing at ${MANIFEST_PATH}. Regenerate it with:\n` +
        `  .venv/bin/python scripts/derive_golden_manifest.py`
    );
  }
  cachedManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  return cachedManifest;
}

/** Corpus entries that produced real ground truth (skipped ones excluded). */
function corpusEntries() {
  return loadManifest().corpus.filter((e) => !e.skipped);
}

function corpusEntriesOfType(fileType) {
  return corpusEntries().filter((e) => e.fileType === fileType);
}

function generatedExpectation(sourceId) {
  const found = loadManifest().generatedExpectations.find((e) => e.sourceId === sourceId);
  if (!found) throw new Error(`No generated expectation for ${sourceId}`);
  return found;
}

function absPath(sourceId) {
  return path.join(REPO_ROOT, sourceId);
}

function readFixture(sourceId) {
  return fs.readFileSync(absPath(sourceId));
}

/**
 * Skip reason for fixtures that are git-ignored because they are byte copies of
 * corpus documents (the adversarial PDF probes). They exist after running the
 * derivation script, but not on a fresh clone — so tests that need them skip
 * with an actionable message rather than failing.
 *
 * Returns false when the fixture is present, i.e. the test should run.
 */
function missingRegenerableFixture(sourceId) {
  if (fs.existsSync(absPath(sourceId))) return false;
  return (
    `${sourceId} is not present (it is git-ignored and regenerable). ` +
    "Create it with: .venv/bin/python scripts/derive_golden_manifest.py"
  );
}

/**
 * PDFs exercised by default in the unit suite.
 *
 * The full corpus is 442 pages across 31 MB; extracting all of it on every
 * `npm test` would make the suite too slow to run per-change. This subset is
 * chosen for coverage of distinct document characters — narrative prose, a
 * sparse diagram-heavy site plan, a dimensioned technical manual, and the
 * image-only document — and the remainder is opt-in.
 *
 * Set GOLDEN_FULL=1 to sweep every corpus PDF.
 */
const UNIT_PDF_SUBSET = [
  "tests/fixtures/legacy_corpus/GraemeHick.pdf",
  "tests/fixtures/legacy_corpus/Barratt_Homes_SitePlan.pdf",
  "tests/fixtures/legacy_corpus/SSX125_Manual.pdf",
  "tests/fixtures/legacy_corpus/Barratt_Homes-SaxonFields.pdf",
];

function pdfEntriesUnderTest() {
  const all = corpusEntriesOfType("pdf");
  if (process.env.GOLDEN_FULL === "1") return all;
  return all.filter((e) => UNIT_PDF_SUBSET.includes(e.sourceId));
}

/**
 * The per-chunk contract from evaluation-plan §2 (U-PARSE).
 * Returns a list of human-readable violations; empty means the chunk conforms.
 */
function chunkContractViolations(chunk, index, opts = {}) {
  const { expectedSource, chunkSize = 800 } = opts;
  const problems = [];

  if (typeof chunk.text !== "string" || chunk.text.length === 0) {
    problems.push(`chunk[${index}].text missing or empty`);
  }
  if (!chunk.source) {
    problems.push(`chunk[${index}].source missing`);
  } else if (expectedSource && chunk.source !== expectedSource) {
    problems.push(`chunk[${index}].source is "${chunk.source}", expected "${expectedSource}"`);
  }
  if (!chunk.fileType) {
    problems.push(`chunk[${index}].fileType missing`);
  }
  if (!Number.isInteger(chunk.page) || chunk.page < 1) {
    problems.push(`chunk[${index}].page must be an integer >= 1, got ${chunk.page}`);
  }
  if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex !== index) {
    problems.push(`chunk[${index}].chunkIndex must be ${index}, got ${chunk.chunkIndex}`);
  }
  if (typeof chunk.metadata !== "string") {
    problems.push(`chunk[${index}].metadata must be a JSON string`);
  } else {
    try {
      JSON.parse(chunk.metadata);
    } catch (err) {
      problems.push(`chunk[${index}].metadata is not parseable JSON: ${err.message}`);
    }
  }
  if (typeof chunk.text === "string" && chunk.text.length > 2 * chunkSize) {
    problems.push(
      `chunk[${index}].text is ${chunk.text.length} chars, exceeds 2x chunkSize (${2 * chunkSize})`
    );
  }
  return problems;
}

module.exports = {
  REPO_ROOT,
  MANIFEST_PATH,
  loadManifest,
  corpusEntries,
  corpusEntriesOfType,
  generatedExpectation,
  absPath,
  readFixture,
  missingRegenerableFixture,
  UNIT_PDF_SUBSET,
  pdfEntriesUnderTest,
  chunkContractViolations,
};
