#!/usr/bin/env node
/**
 * Golden-corpus ground truth: second-opinion PDF text extraction.
 *
 * Emits per-page text for one PDF using the *production* spatial extraction
 * path (`extractPages` in src/lib/ingestion/parser.js, backed by pdf-parse /
 * pdf.js). The derivation script cross-checks this against pypdfium2, which is
 * the other production extractor (src/lib/ingestion/docling_bridge.py).
 *
 * Two independent engines are used deliberately: deriving the manifest from a
 * single extractor would make the golden tests circular — they would assert
 * only that an engine agrees with itself, and could never detect reading-order
 * or dropped-text defects.
 *
 * Usage:  node scripts/lib/extract_pdfparse.js <absolute-pdf-path>
 * Output: JSON on stdout — { engine, pageCount, pages: [{ page, text }] }
 */

const fs = require("fs");
const path = require("path");

const { extractPages } = require(path.join(__dirname, "..", "..", "src", "lib", "ingestion", "parser.js"));

async function main() {
  const target = process.argv[2];
  if (!target) {
    process.stdout.write(JSON.stringify({ error: "usage: extract_pdfparse.js <pdf-path>" }));
    process.exit(1);
  }
  if (!fs.existsSync(target)) {
    process.stdout.write(JSON.stringify({ error: `file not found: ${target}` }));
    process.exit(1);
  }

  try {
    const buffer = fs.readFileSync(target);
    const pages = await extractPages(buffer);
    // extractPages pushes pages in pdf-parse render order; sort defensively so
    // page numbering is authoritative rather than arrival-order dependent.
    const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
    process.stdout.write(
      JSON.stringify({
        engine: "pdf-parse (production spatial fallback)",
        pageCount: sorted.length,
        pages: sorted.map((p) => ({ page: p.pageNumber, text: p.text || "" })),
      })
    );
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: `${err.name}: ${err.message}` }));
    process.exit(1);
  }
}

main();
