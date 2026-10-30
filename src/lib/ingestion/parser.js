const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse');
const crypto = require('crypto');
const officeParser = require('officeparser');
const { ENGINE_IDS, normalizeEngine } = require('./engines');
const { sourceIdFor, docVersionFor } = require('../rag/ids');
// T35 (t35-design D2–D10): OCR for pages without a text layer — the JS half (the mode, the timeout rule, the chunk marker).
const { normaliseOcrMode, bridgeTimeoutMs, TEXT_SOURCE_OCR, ocrPagesList, pageIsOcr } = require('./ocr');
// T37 (design D1, D2): the default captioner for a request that names none —
// ONE constant, read here for BOTH fallbacks (the fingerprint input and the
// model asked and recorded). The module is pure CommonJS and requires only
// caption_memo.js, so this top-level require is not circular; the captioning
// branch below still requires the rest of the module lazily, as before.
const { DEFAULT_CAPTION_MODEL } = require('./vlm_captioner');
// T33 (design D1, D5, D9): the pure detail-pass module — the trigger over a
// caption, the tile geometry, the merge, the chunk text, the split rule.
const { DETAIL_GRID, DETAIL_OVERLAP, DETAIL_RENDER_SCALE, normaliseDetailMode, detailPlanFor, parseKey, keyText, isNoneReply, mergeTiles, mergeTranscriptions, detailChunkText, splitDetailText, detailPagesList, detailSubjectFor, detailGeometry, subsumeRanges, labelOrder } = require('./detail_pass');
// T57 (t57-design.md §2.2; F-215): the disclose-only colour check of a keyed-index merge — pure; the bridge reads the
// page's colour layer (--colours), this file wires them.
const { colourCheck, keyNamesColour, associationSettle } = require('./colour_check');
// T41 (design D2, §2.1): the pure minimum-size fold — a piece under minChunkSize is folded into a neighbour, never dropped.
const { foldSubMinimum, DEFAULT_MIN_CHUNK_SIZE } = require('./fold');
// T18 (design D2–D6, D9): the running lines a document repeats on most of its pages, detected by cross-page repetition
// and removed before any rule reads a page; the heading pick that follows; the router by filename token. No brand
// name and no phrase list anywhere in this file.
const { stripRunningLines, pageArtifactCounts } = require('./running_lines');
// T47 (t47-design.md §2.1, §2.2; D1 a): the text-layer label reconciliation of a caption — pure.
const { reconcileCaption } = require('./reconcile_labels');
// T46 (design §2.2–§2.5, D14 a): the dimensioned drawing's chain — pure (the admission, the solver, the settlement,
// the block, the counts); the captioner asks, the bridge reads the geometry, this file wires them.
const dimensionChain = require('./dimension_chain');

/**
 * T46 (D15, §12d): the geometry module's md5 — the version a chain record's geometry is recalled by (the bridge
 * reports the same md5 of the same file); null when unreadable (the geometry is then read again, never recalled).
 */
function geometryModuleMd5() {
  try { return crypto.createHash('md5').update(fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'ingestion', 'dimension_geometry.py'))).digest('hex'); } catch (err) { return null; }
}
const { pageTopHeading, chunkHeading, stripPageWord } = require('./page_heading');

/**
 * T41 (design D4; T02): a chunk setting as a NUMBER — an explicit 0 is 0 (the former `||` form read `chunkOverlap: 0` as
 * 200, and 200 = the chunk size made recursiveSplit cut a 200-character CSV mid-row — t41-design.md §0d), a numeric
 * string is its number, absent or unreadable is the default; `positive` refuses 0 (a chunk size of 0 is no setting).
 */
function chunkSetting(value, def, { positive = false } = {}) {
  if (value === undefined || value === null || value === "") return def;
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return def;
  return positive ? (n > 0 ? n : def) : n >= 0 ? n : def;
}

async function extractOfficeText(fileBuffer, filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  
  if (['txt', 'md', 'markdown', 'csv'].includes(ext)) {
    return fileBuffer.toString('utf-8');
  }

  if (['docx', 'xlsx', 'pptx', 'xls', 'ppt'].includes(ext)) {
    try {
      const ast = await officeParser.parseOffice(fileBuffer, { fileType: ext });
      if (ast && typeof ast.toText === 'function') {
        return ast.toText();
      }
      return ast || "";
    } catch (err) {
      // T41 (design D4; T02): a binary Office file whose parse failed is NOT decoded as UTF-8 and indexed as garbage —
      // it is a typed failure the ingest route records as the file's `failed before indexing` outcome, with the reason.
      console.error(`[OfficeParser Error] Failed to parse ${filePath}:`, err);
      const failure = new Error(`PARSE_FAILED: ${path.basename(filePath)} could not be parsed as ${ext} (${err && err.message ? err.message : err}); no bytes were indexed as text`);
      failure.code = "PARSE_FAILED";
      failure.fileName = path.basename(filePath);
      failure.fileType = ext;
      failure.cause = err;
      throw failure;
    }
  }
  
  return fileBuffer.toString('utf-8');
}

// Helper to discover Python virtualenv / system executable for Docling Layout AI
//
// T22 (design D4, finding F-6): a candidate is chosen only if it RUNS. The
// deployed image used to carry the developer's macOS .venv, whose
// `bin/python` was a dangling symlink chain; `existsSync` follows links and
// so happened to skip it, and PDF parsing worked by luck. The probe
// (`<candidate> --version`) makes the choice deliberate either way: a venv
// that actually executes is used, one that does not is passed over. The
// result is cached for the process and logged once.
let cachedPythonBin;
function probePythonBin(candidate, execFileSync) {
  try {
    const out = execFileSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
    return String(out || '').trim() || 'ok';
  } catch (e) {
    return null;
  }
}

function findPythonBin(options = {}) {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync, execSync } = require('child_process');
  const probe = options.probe || ((c) => probePythonBin(c, options.execFileSync || execFileSync));
  if (!options.noCache && cachedPythonBin !== undefined) return cachedPythonBin;

  const root = options.root || process.cwd();
  const candidates = options.candidates || [
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, '..', '.venv', 'bin', 'python'),
    '/usr/src/app/.venv/bin/python',
    '/usr/bin/python3',
    '/usr/local/bin/python3'
  ];

  let chosen = null;
  let version = null;
  const skipped = [];
  for (let c of candidates) {
    if (!fs.existsSync(c)) continue;
    const v = probe(c);
    if (v) { chosen = c; version = v; break; }
    skipped.push(c);
  }

  if (!chosen) {
    try {
      const systemPy = execSync('which python3 || which python').toString().trim();
      if (systemPy && fs.existsSync(systemPy)) {
        const v = probe(systemPy);
        if (v) { chosen = systemPy; version = v; }
        else skipped.push(systemPy);
      }
    } catch (e) {}
  }

  if (!options.noCache) {
    cachedPythonBin = chosen;
    const log = options.log || console.log;
    log(`[Parser] python for the docling bridge: ${chosen ? `${chosen} (${version})` : 'none found'}` +
      (skipped.length ? `; skipped (present but does not run): ${skipped.join(', ')}` : ''));
  }
  return chosen;
}

// Sort and parse PDF buffer into pages
async function extractPages(fileBuffer) {
  const pages = [];
  
  const options = {
    pagerender: async function(pageData) {
      const textContent = await pageData.getTextContent();
      let lastY, text = '';
      
      // Sort text tokens: top-to-bottom, then left-to-right
      const items = textContent.items.sort((a, b) => {
        if (Math.abs(a.transform[5] - b.transform[5]) > 4) {
          return b.transform[5] - a.transform[5];
        }
        return a.transform[4] - b.transform[4];
      });

      let lastX = 0;
      for (let item of items) {
        const currentY = item.transform[5];
        const currentX = item.transform[4];
        
        if (lastY !== undefined && Math.abs(lastY - currentY) >= 4) {
          text += '\n';
        } else if (text.length > 0 && !text.endsWith('\n') && !text.endsWith(' ')) {
          if (currentX - lastX > 2) {
            text += ' ';
          }
        }
        text += item.str;
        lastY = currentY;
        lastX = currentX + (item.width || 0);
      }
      
      pages.push({
        pageNumber: pageData.pageIndex + 1,
        text: text
      });
      return text;
    }
  };
  
  await pdf(fileBuffer, options);
  return pages;
}

// Chunker algorithm implementing recursive splitting with overlaps
// T41 (design D4; T02): an overlap that is not smaller than half the chunk size makes every accumulated piece too big
// and the recursion ends cutting characters (a 200-character CSV chunking with overlap 200 read 96 broken rows —
// t41-design.md §0d); it is clamped to half the chunk size and said once per (size, overlap) pair.
const overlapWarned = new Set();
function clampOverlap(chunkSize, chunkOverlap) {
  const size = Number(chunkSize);
  let overlap = Number(chunkOverlap);
  if (!Number.isFinite(overlap) || overlap < 0) overlap = 0;
  if (Number.isFinite(size) && size > 0 && overlap * 2 > size) {
    const clamped = Math.floor(size / 2);
    const key = `${size}/${overlap}`;
    if (!overlapWarned.has(key)) { overlapWarned.add(key); console.warn(`[Parser] chunkOverlap ${overlap} is not smaller than half of chunkSize ${size}: clamped to ${clamped} (an overlap that large makes the splitter cut characters — T41)`); }
    return clamped;
  }
  return overlap;
}
function recursiveSplit(text, chunkSize, rawOverlap) {
  const chunkOverlap = clampOverlap(chunkSize, rawOverlap);
  const separators = ["\n\n", "\n", ". ", " ", ""];
  
  function splitRecurse(txt, level) {
    if (txt.length <= chunkSize || level >= separators.length) {
      return [txt];
    }
    
    const separator = separators[level];
    const parts = txt.split(separator);
    const chunks = [];
    let currentChunk = "";
    
    for (let part of parts) {
      const potential = currentChunk ? (currentChunk + separator + part) : part;
      
      if (potential.length <= chunkSize) {
        currentChunk = potential;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        
        // Handle overlap
        if (chunkOverlap > 0 && currentChunk) {
          const words = currentChunk.split(separator);
          let overlapText = "";
          for (let i = words.length - 1; i >= 0; i--) {
            const nextOverlap = words.slice(i).join(separator);
            if (nextOverlap.length <= chunkOverlap) {
              overlapText = nextOverlap;
            } else {
              break;
            }
          }
          currentChunk = overlapText ? (overlapText + separator + part) : part;
        } else {
          currentChunk = part;
        }
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    // If a chunk is still too big, force recursion with the next separator
    let finalChunks = [];
    for (let chunk of chunks) {
      if (chunk.length > chunkSize) {
        finalChunks = finalChunks.concat(splitRecurse(chunk, level + 1));
      } else {
        finalChunks.push(chunk);
      }
    }
    return finalChunks;
  }
  
  return splitRecurse(text, 0);
}

// Helper to filter out header/footers from lines
function cleanHeaderFooters(lines, pattern) {
  if (!pattern) return lines;
  
  // Look at first 3 lines and last 3 lines for heuristic match
  const cleaned = [...lines];
  const maxLineCheck = Math.min(3, cleaned.length);
  
  for (let i = 0; i < maxLineCheck; i++) {
    if (pattern.test(cleaned[i])) {
      cleaned[i] = ""; // strip header line
    }
  }
  
  for (let i = cleaned.length - 1; i >= cleaned.length - maxLineCheck; i--) {
    if (i >= 0 && pattern.test(cleaned[i])) {
      cleaned[i] = ""; // strip footer line
    }
  }
  
  return cleaned.filter(l => l.trim() !== "");
}

/**
 * T32 (design D2): does the bridge's page entry for `pageNo` carry a text
 * layer — at least one non-blank character of extracted markdown? No entry
 * → false (nothing else indexes that page, so it is transcribed whole).
 */
function pageHasTextLayer(doclingPages, pageNo) {
  if (!Array.isArray(doclingPages)) return false;
  const entry = doclingPages.find((p) => p && (p.page || 1) === pageNo);
  if (!entry) return false;
  // T18 (§11a A9): the text LAYER is the bridge's, read before the running lines left the page — a page whose only text
  // was the running block (the Site Plan's pages 3–7) keeps its with-text prompt and its memo key.
  if (typeof entry.hadTextLayer === "boolean") return entry.hadTextLayer;
  return /\S/.test(String(entry.markdown || ""));
}

/**
 * T32 (design D3): the caption's TYPE line normalised into the closed list
 * (`vlm_captioner.VISUAL_TYPES`), case-insensitive, as a whole phrase: the
 * value the line STARTS with when it starts with one (the model's primary
 * answer — "mixed (photo + plan)" is `mixed`), else the first listed value
 * found anywhere in it; null when none is. A legacy "Architectural Floor
 * Plan" is null (counted as unlisted on the trace, never a failure).
 */
function normaliseVisualType(typeLine) {
  if (typeof typeLine !== "string" || !typeLine.trim()) return null;
  const { VISUAL_TYPES } = require("./vlm_captioner");
  const line = typeLine.trim().toLowerCase().replace(/^[\s*_`"']+/, "");
  const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leading = VISUAL_TYPES.filter((v) => new RegExp(`^${escape(v)}([^a-z]|$)`).test(line)).sort((a, b) => b.length - a.length)[0];
  if (leading) return leading;
  for (const v of VISUAL_TYPES) {
    if (new RegExp(`(^|[^a-z])${escape(v)}([^a-z]|$)`).test(line)) return v;
  }
  return null;
}

/**
 * T33: the caption's TITLE — the detail chunk's title and the caption chunk's `humanTitle`. T18 (design D6): the VLM's
 * text, with only a leading `Page N` stripped (the brand strips are gone — 0 production captions carried one).
 */
function captionTitleOf(caption) {
  const m = String(caption || "").match(/^(?:HUMAN )?TITLE:\s*(.+)$/im);
  if (!m) return null;
  return stripPageWord(m[1]) || m[1].trim();
}

/**
 * T33: the page's title, the way the caption chunk's `pageTitle` is found. T18 (design D4, D6): the page's heading —
 * a heading-shaped line within its first five lines, read from the page AFTER its running lines left — or `Page N`;
 * the same answer the text chunks' page-top rule gives.
 */
function pageTitleFor(doclingPages, pageNo) {
  const pageObj = (Array.isArray(doclingPages) ? doclingPages : []).find((p) => (p.page || 1) === pageNo);
  return pageTopHeading(pageObj?.markdown || "") || `Page ${pageNo}`;
}

class DocumentParser {
  constructor(fileName, buffer, config = {}, realFilePath = "") {
    this.fileName = path.basename(fileName);
    this.rawPath = fileName;
    let bufToHash = buffer;
    if (Buffer.isBuffer(buffer)) {
      bufToHash = buffer;
    } else if (typeof buffer === "string") {
      bufToHash = Buffer.from(buffer);
    } else if (buffer && typeof buffer === "object" && Buffer.isBuffer(buffer.buffer)) {
      bufToHash = buffer.buffer;
    } else {
      bufToHash = Buffer.from(fileName || "doc");
    }
    this.docHash = crypto.createHash('md5').update(bufToHash).digest('hex');
    // Retain the normalised buffer: chunk() reads this.buffer on the text,
    // Office and PDF-fallback paths.
    this.buffer = bufToHash;
    this.config = config;

    let targetPath = realFilePath || fileName;
    if (targetPath && typeof targetPath === "string" && !path.isAbsolute(targetPath)) {
      let clean = targetPath.replace(/\\/g, "/");
      if (clean.startsWith("/")) clean = clean.slice(1);
      if (!clean.startsWith("public/")) clean = path.join("public", clean);
      targetPath = path.join(process.cwd(), clean);
    }
    this.filePath = targetPath;

    // T05 — chunk identity (src/lib/rag/ids.js). Both are known BEFORE
    // chunk() runs, so the v2 duplicate check can key on them: sourceId is
    // the request path relative to public/ (a rename is a new document);
    // docVersion is the content hash plus a fingerprint of the EFFECTIVE
    // chunk settings (the getters below, after the profiler merge) and the
    // VLM model. The engine actually used is not part of it — it is only
    // known after parsing — and is stamped on each chunk as a fact instead.
    this.sourceId = sourceIdFor(this.rawPath || this.fileName);
    // T24 (design D8): the captioning switch shapes the chunk set (no
    // isVisualElement chunks when off), so it is fingerprinted — only when
    // OFF, under ids.js's default-omission rule, so no existing version moves.
    // T31 (workshop design D5, amendment A7): the page budget shapes the chunk
    // set the same way (the pages beyond it emit no isVisualElement chunk), so
    // it is fingerprinted too — only when NON-ZERO, under the same
    // default-omission rule, so no existing version moves. Every key of
    // ids.FINGERPRINT_KEYS must appear here or it is silently inert (U-PARSE
    // walks the list; I-CAPTION 4 caught this one live).
    // T37 (design D1): a request naming no captioner fingerprints as the shipped
    // default — the same model the page names — so the page and an API caller
    // stamp ONE version for one shape. The value is vlm_captioner.js's constant.
    this.docVersion = docVersionFor(this.docHash, {
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      minChunkSize: this.config?.minChunkSize,
      vlmModelName: this.config?.vlmModelName || DEFAULT_CAPTION_MODEL,
      captionFigures: this.config?.captionFigures,
      captionPageBudget: this.config?.captionPageBudget,
      // T33 (design D6): the detail passes' mode shapes the chunk set (a
      // detail chunk per page that fires) — fingerprinted only when NOT the
      // default `auto`, under the same rule; IDENTITY_VERSION 3 moved every
      // version once for the default itself.
      detailPasses: this.config?.detailPasses,
      // T35 (design D3, D9): the OCR mode shapes a no-text page's chunk set — fingerprinted only when NOT the
      // default `auto`, under the same rule; IDENTITY_VERSION 5 moved every version once for the default itself.
      ocrNoTextPages: this.config?.ocrNoTextPages
    });
  }

  /**
   * The identity fields every emitted chunk carries (T05). Under schema v1
   * batchInsert's explicit property map ignores them, so the v1 write is
   * byte-identical; under v2 they become the object's id and its
   * sourceId / docVersion / engine properties. `engine` is the engineId this
   * parse actually used, or the vocabulary's "unknown" when no trace recorded
   * one (the MarkdownParser's own path) — never a guess.
   */
  chunkIdentity() {
    return {
      sourceId: this.sourceId,
      docVersion: this.docVersion,
      engine: this.doclingTrace?.engineId || ENGINE_IDS.UNKNOWN
    };
  }
  
  // Subclasses override these.
  // T41 (design D2, D4): the getters read the setting as a number — an explicit 0 overlap is 0 (it used to become 200);
  // ONE minimum-size threshold on every path — the request's, else the module's 50 (the page's drawer sends 150; the
  // office path's former 150 and the markdown path's "none" are gone).
  get chunkSize() { return chunkSetting(this.config?.chunkSize, 800, { positive: true }); }
  get chunkOverlap() { return chunkSetting(this.config?.chunkOverlap, 200); }
  get minChunkSize() { return chunkSetting(this.config?.minChunkSize, DEFAULT_MIN_CHUNK_SIZE); }
  get headerFooterPattern() { return null; }
  
  extractMetadata(chunkText, pageNum) {
    return {
      source: this.fileName,
      fileType: this.fileName.split('.').pop()
    };
  }
  
  async chunk() {
    const ext = this.fileName.split('.').pop().toLowerCase();
    // T07 (audit FM-L4, the §3 counts block): chunks dropped for being under
    // minChunkSize are COUNTED here. T41 (design D2, T20): no path drops one any
    // more — a piece under the minimum is FOLDED into a neighbour on its page
    // (fold.js) and counted in chunksMergedMinSize; the drop count stays a
    // measured 0 on every path that applies the minimum.
    this.chunksDroppedMinSize = 0;
    this.chunksMergedMinSize = 0;
    // T41 (design D7, F-165): the hidden slides the bridge named — no chunk, counted, named.
    const hiddenPages = [];
    // T18 (design D2, §2.6): the running lines removed — null until a paginated document was stripped.
    let pageArtifacts = null;
    
    if (['pdf', 'docx', 'pptx', 'xlsx'].includes(ext)) {
      let doclingPages = null;
      const pythonBin = findPythonBin();
      const bridgeScript = path.join(process.cwd(), 'src', 'lib', 'ingestion', 'docling_bridge.py');

      // Provisional trace: describes the fallback path that will be used if
      // the bridge does not succeed. Overwritten on bridge success.
      this.doclingTrace = {
        timestamp: new Date().toISOString(),
        fileName: this.fileName,
        pythonBin: pythonBin || "None Found",
        usedDocling: false,
        engine: ext === 'pdf' ? "pdf-parse (Spatial Fallback)" : `OfficeParser (${ext.toUpperCase()} Fallback)`,
        engineId: ext === 'pdf' ? ENGINE_IDS.PDF_PARSE : ENGINE_IDS.OFFICEPARSER,
        // pdf-parse chunks each physical page; the office path stamps
        // everything page 1 (no real pagination).
        paginated: ext === 'pdf',
        reasonIfFallback: pythonBin ? "Docling execution pending or failed." : "No Python environment with Docling installed.",
        pageCount: 0,
        tablesDetected: 0,
        markdownSample: ""
      };

      // Measured, never asserted (T13): bridge wall time and VLM wall time are
      // recorded separately so the orchestrator's spans can report real
      // durations — or honestly report none — instead of hardcoded literals.
      const bridgeStart = Date.now();
      let parseDurationMs = null;
      let vlmDurationMs = null;
      const bridgeAttempted = Boolean(pythonBin && require('fs').existsSync(bridgeScript) && this.filePath);

      if (bridgeAttempted) {
        try {
          const { exec } = require('child_process');
          const util = require('util');
          const execAsync = util.promisify(exec);
          const imgDir = path.join(process.cwd(), 'public', 'extracted_images', this.docHash);
          // T24 (design D6, D7): the captioning switch. Off = text only: the
          // bridge renders nothing and creates no crop folder (`--no-images`),
          // the captioner is never loaded, no isVisualElement chunk is emitted.
          const captionFigures = this.config?.captionFigures !== false;
          // T35 (design D2, D3, D5; §2.2): the OCR mode rides to the bridge (`--ocr auto | off`), and the bridge's
          // per-file timeout grows by 5 s a page when OCR may run — the page count read cheaply first
          // (`--page-count`, milliseconds; unknown → the base timeout).
          const ocrMode = normaliseOcrMode(this.config?.ocrNoTextPages);
          let pageCountForTimeout = 0;
          if (ext === 'pdf' && ocrMode !== "off") {
            try {
              const { stdout: pc } = await execAsync(`"${pythonBin}" "${bridgeScript}" "${this.filePath}" --page-count`, { maxBuffer: 1024 * 1024, timeout: 60000 });
              const n = JSON.parse(pc).pages;
              pageCountForTimeout = Number.isInteger(n) && n > 0 ? n : 0;
            } catch (err) { pageCountForTimeout = 0; }
          }
          const bridgeArgs = `${captionFigures ? `"${imgDir}"` : `"${imgDir}" --no-images`} --ocr ${ocrMode}`;

          const { stdout: rawResult } = await execAsync(`"${pythonBin}" "${bridgeScript}" "${this.filePath}" ${bridgeArgs}`, {
            maxBuffer: 100 * 1024 * 1024,
            timeout: bridgeTimeoutMs(ocrMode, pageCountForTimeout)
          });
          parseDurationMs = Date.now() - bridgeStart;
          const parsed = JSON.parse(rawResult);
          if (parsed.status === 'success' && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
            doclingPages = parsed.pages;
            // T18 (design D2, D3, D5): a PAGINATED document's running lines leave every page HERE — before the detail
            // pass, the caption titles and the chunk loop read the pages — and `\r\n` is normalised (F-168); the first
            // copy of every running key stays (D3 b); the counts ride the trace (the ledger, the frame, the views, the
            // log). An unpaginated docling file (the docx) is one page: nothing repeats across pages, nothing is stripped.
            if (parsed.paginated !== false) {
              const stripped = stripRunningLines(doclingPages, { keepFirst: true });
              doclingPages.forEach((p, i) => { if (p.hidden !== true) { p.hadTextLayer = /\S/.test(String(p.markdown || "")); p.markdown = stripped.pages[i]; } });
              pageArtifacts = pageArtifactCounts(stripped);
            }
            // T35 (design D10): what the bridge reports about the OCR pass (null on a pre-T35 bridge reply).
            const ocr = parsed.ocr && typeof parsed.ocr === "object" ? parsed.ocr : null;
            
            let tableCount = 0;
            for (let p of doclingPages) {
              const matches = (p.markdown || "").match(/\|.*?\|/g);
              if (matches) tableCount += Math.floor(matches.length / 3);
            }
            
            // T24 (design D2, D3, D4, D5): captions run ONE AT A TIME, in page
            // order, after the VLM server is reset to the one state every
            // ingest can reproduce — at temperature 0 this deployment's reply
            // depends on the prompt cache's state, so a fixed order from an
            // empty cache is what makes two ingests byte-identical (t24-design
            // §0 items 8b–8d). Every figure gets one OUTCOME; the counts below
            // reach the ledger, the status frame and the VLM span, and a
            // failed caption makes the file partial (the route's rule).
            let vlmCaptionsCount = 0;
            const vlmCounts = { decorative: 0, textOnly: 0, empty: 0, truncated: 0, tiny: 0, timedOut: 0, failed: 0, notAttempted: 0, fromMemo: 0, calls: 0, memoised: 0, memoWriteFailed: 0 };
            let captionReset = null;
            let captionResetWaitMs = null;
            let vlmFirstLoadMs = null;
            // T47 (design §2.3): the caption labels reconciled with the page's text layer — the document's count and the list.
            let captionSubstitutions = 0;
            const captionSubstitutionsList = [];
            // T29: the caption memo's state for this document — "all" (every
            // crop recalled, no reset, no request), "partial", "none" (every
            // crop asked), "unavailable" (the server's identity could not be
            // read, the memo bypassed), null when nothing was captioned.
            let captionMemo = null;
            let vlmModelDigest = null;
            let vlmServer = null;
            // T31 (workshop design D5–D7): the page budget's verdict for this
            // document — declared here, where the trace below reads it (A5's rule).
            let captionBudget = null;
            let figuresConsidered = null;
            let notAttemptedPages = null;
            // T32 (design D2, D9): which prompt variants this document's captions
            // came from (md5-8 of each) — declared here, read by the trace below.
            let captionPrompts = null;
            // T37 (design D1): the model asked and recorded (`vlmModel` on the
            // ledger and the frame) follows the same constant as the fingerprint.
            const vlmModelUsed = this.config?.vlmModelName || DEFAULT_CAPTION_MODEL;
            // T33 (design D6): the detail passes' mode — auto | all | off — a
            // setting read once here; anything unreadable is the default (auto).
            const detailMode = normaliseDetailMode(this.config?.detailPasses);
            this.detailSummary = null;
            this.detailResults = [];
            // T46 (design D9): the chain pass's summary — declared here, read by the trace below.
            this.chainSummary = null;
            if (captionFigures && Array.isArray(parsed.pictures) && parsed.pictures.length > 0) {
              const { captionFigure, resetCaptionServer, CAPTION_FAILURE_OUTCOMES } = require("./vlm_captioner");
              const { resolveCaptionServer, captionMemoKey, CAPTION_MIN_BYTES, CAPTION_PROMPT_MD5 } = require("./vlm_captioner");
              const { openCaptionMemo } = require("./caption_memo");
              // T32 (design D2): the prompt a page gets is chosen by its text
              // layer — a page WITH extracted text may answer [NO_VISUAL_CONTENT]
              // (its words are indexed by the text pipeline); a page WITHOUT one
              // (a brochure, a scan) is transcribed whole, because its caption is
              // its only index entry. No page entry → no text layer (the honest
              // default: nothing else indexes that page).
              const textLayerOf = (pic) => pageHasTextLayer(doclingPages, pic.page);
              // T47 (design §2.2): the page's stripped text (T18's) — the lexicon the reconciliation reads; "" without a page entry.
              const pageTextOf = (pic) => { const p = (Array.isArray(doclingPages) ? doclingPages : []).find((x) => x && (x.page || 1) === pic.page); return p ? String(p.markdown || "") : ""; };
              captionPrompts = { withText: CAPTION_PROMPT_MD5.withText.slice(0, 8), noText: CAPTION_PROMPT_MD5.noText.slice(0, 8) };
              // T31 (F-123): no index cap. The only bound is captionPageBudget
              // (0 = every page); the pages beyond it are counted and NAMED.
              const { selectCaptionTargets } = require("./caption_budget");
              const plan = selectCaptionTargets(parsed.pictures, this.config?.captionPageBudget);
              const targetPics = plan.targets;
              vlmCounts.notAttempted = plan.notAttempted;
              captionBudget = plan.budget;
              figuresConsidered = plan.considered;
              notAttemptedPages = plan.notAttemptedPages;
              const vlmOptions = {
                ollamaUrl: this.config?.vlmEndpointUrl || this.config?.ollamaUrl || "http://ollama.ollama.svc.cluster.local:11434",
                modelName: vlmModelUsed,
                token: this.config?.vlmApiKey || ""
              };
              const vlmStart = Date.now();

              // T29 (design D1, D3): identify the server and the model once, then
              // ask the memo about every crop BEFORE touching the server. A crop
              // too small to send, or absent, needs no server either.
              const memo = openCaptionMemo();
              const identity = await resolveCaptionServer({ ...vlmOptions, label: this.fileName });
              const memoIdentity = identity.ok && identity.modelDigest ? { server: identity.server, modelDigest: identity.modelDigest } : null;
              vlmModelDigest = identity.modelDigest || null;
              vlmServer = identity.server || null;
              const memoKeys = new Map();
              let memoHits = 0;
              let memoMisses = 0;
              for (const pic of targetPics) {
                let bytes = null;
                try { bytes = require('fs').readFileSync(pic.abs_path); } catch (err) { bytes = null; }
                if (!bytes || bytes.length < CAPTION_MIN_BYTES) continue; // missing or tiny: never sent, never memoised
                if (!memoIdentity) { memoMisses++; continue; }
                try {
                  const k = captionMemoKey(bytes, { modelName: vlmModelUsed, memoIdentity, hasTextLayer: textLayerOf(pic) });
                  memoKeys.set(pic.id, k.key);
                  if (memo.has(k.key)) memoHits++; else memoMisses++;
                } catch (err) { memoMisses++; }
              }
              captionMemo = !memoIdentity ? "unavailable" : memoMisses === 0 ? "all" : memoHits > 0 ? "partial" : "none";
              console.log(`[VLM Pipeline] Processing ${targetPics.length} of ${parsed.pictures.length} figure crops for document ${this.fileName} (${plan.notAttempted > 0 ? `budget ${captionBudget}: ${plan.notAttempted} beyond it${notAttemptedPages ? `, pages ${notAttemptedPages}` : ""}; ` : ""}sequential; caption memo ${captionMemo}: ${memoHits} recalled, ${memoMisses} to ask${memoMisses > 0 ? ", after a server reset" : ", no reset"})...`);

              // T24 (design D2, D3): one reset per document — T29 (D3): only when a
              // crop must be asked. A document recalled whole never loads the model.
              // T33 (design D8): the ONE reset serves the detail passes too — sent
              // here when a caption must be asked, else lazily before the first
              // detail request that misses the memo; never twice.
              let resetSent = null;
              const resetOnce = async () => {
                if (resetSent) return resetSent;
                resetSent = await resetCaptionServer({ ...vlmOptions, label: this.fileName });
                return resetSent;
              };
              const reset = memoMisses > 0 ? await resetOnce() : null;
              // true only when the unload was SEEN (A10); false when the request
              // failed or the model stayed loaded; null when /api/ps was unreadable
              // — or when no reset was needed (T29).
              captionReset = reset ? (reset.ok ? reset.unloaded : false) : null;
              captionResetWaitMs = reset && Number.isFinite(reset.waitedMs) ? reset.waitedMs : null;
              const hintBase = { fileName: this.fileName, docHash: this.docHash };
              for (const pic of targetPics) {
                const result = await captionFigure(pic.abs_path, { ...vlmOptions, label: `${this.fileName} p${pic.page} (${pic.id})`, memo, memoIdentity, memoKey: memoKeys.get(pic.id) || null, jobId: this.ingestJobId || null, hint: { ...hintBase, page: pic.page, figureId: pic.id }, hasTextLayer: textLayerOf(pic) });
                if (vlmFirstLoadMs === null && Number.isFinite(result.loadMs)) vlmFirstLoadMs = result.loadMs;
                if (result.source === "memo") vlmCounts.fromMemo++;
                if (result.requested) vlmCounts.calls++;
                if (result.memoised) vlmCounts.memoised++;
                if (result.memoError) vlmCounts.memoWriteFailed++;
                pic.captionOutcome = result.outcome;
                pic.captionSource = result.source;
                if (result.outcome === "captioned") {
                  vlmCaptionsCount++;
                  // T47 (design §2.2; D1 a, D2, D3): the text-layer label reconciliation at the ONE seam — a memo hit and a
                  // model reply alike; the memo stays raw, the rule re-runs on every recall. Only a page with a text layer
                  // (T18's fact) reconciles, against its stripped text. Every later reader (the title, the detail plan, the
                  // chunk text, the humanTitle) reads the reconciled caption; the list rides the picture for the chunk's metadata.
                  if (textLayerOf(pic)) {
                    const reconciled = reconcileCaption(result.caption, pageTextOf(pic));
                    pic.caption = reconciled.caption;
                    pic.captionSubstitutions = reconciled.substitutions;
                    if (reconciled.substitutions.length > 0) {
                      captionSubstitutions += reconciled.substitutions.length;
                      for (const s of reconciled.substitutions) captionSubstitutionsList.push({ page: pic.page, figureId: pic.id, from: s.from, to: s.to, edits: s.edits });
                      console.log(`[VLM Caption] ${this.fileName} p${pic.page}: ${reconciled.substitutions.length} label(s) reconciled with the text layer — ${reconciled.substitutions.map((s) => `${s.from} → ${s.to}`).join(", ")}`);
                    }
                  } else pic.caption = result.caption;
                } else if (result.outcome === "decorative") vlmCounts.decorative++;
                else if (result.outcome === "textOnly") vlmCounts.textOnly++;
                else if (result.outcome === "empty") vlmCounts.empty++;
                else if (result.outcome === "truncated") vlmCounts.truncated++;
                else if (result.outcome === "tiny") vlmCounts.tiny++;
                else if (result.outcome === "timeout") vlmCounts.timedOut++;
                else if (CAPTION_FAILURE_OUTCOMES.includes(result.outcome)) vlmCounts.failed++;
              }

              // T33 (design §2, D1–D8): the detail passes, AFTER the captions — the
              // trigger reads each captioned page's caption (its admissions), the
              // bridge renders the page's tiles from the PDF (D2), the KEY pass then
              // one INDEX / TRANSCRIBE pass per tile go through the memo first
              // (D8), the tiles are merged in code with conflicts disclosed (D4),
              // and one detail chunk per page is queued for the chunk assembly
              // below (D5). A failed pass never fails the file (D7): the page keeps
              // its caption, the failure is counted and the page named.
              const detail = { mode: detailMode, pages: 0, tiles: 0, calls: 0, fromMemo: 0, memoised: 0, conflicts: 0, failed: 0, notTaken: 0, chunks: 0, empty: 0, pagesList: [], reasons: [], failedPages: [], emptyPages: [], notTakenOcr: 0, notTakenOcrPages: [], edgeDropped: 0, edgeSettled: 0, multiValued: 0, colourPages: 0, colourChecked: 0, colourFlagged: 0, colourSettled: 0, colourAssociated: 0, colourFailed: 0, colourFailedPages: [] };
              this.detailResults = [];
              if (detailMode !== "off") {
                const { askDetail, detailMemoKey } = require("./vlm_captioner");
                const willMiss = (bytes, opts) => {
                  if (!memoIdentity) return true;
                  try { return !memo.has(detailMemoKey(bytes, { modelName: vlmModelUsed, memoIdentity, ...opts }).key); } catch (err) { return true; }
                };
                const tally = (r) => { if (r.source === "memo") detail.fromMemo++; if (r.requested) detail.calls++; if (r.memoised) detail.memoised++; if (vlmFirstLoadMs === null && Number.isFinite(r.loadMs)) vlmFirstLoadMs = r.loadMs; };
                const tileFromPdf = /pypdfium2/i.test(String(parsed.engine || "")) && ext === "pdf";
                for (const pic of targetPics) {
                  if (pic.captionOutcome !== "captioned" || typeof pic.caption !== "string") continue;
                  const typeLine = (pic.caption.match(/^(?:DIAGRAM )?TYPE:\s*(.+)$/im) || [])[1] || null;
                  const visualType = normaliseVisualType(typeLine);
                  // T35 (design D8): on a page OCR read, the transcribe plan is not taken — OCR read the page at its
                  // own resolution, without tile fragments (t35-design §0a); the keyed-index plan runs as before.
                  // Counted and named (`detailNotTakenOcr`) beside the pages that did not qualify.
                  const pageOcr = pageIsOcr(doclingPages.find((p) => (p.page || 1) === pic.page));
                  const plan = detailPlanFor({ caption: pic.caption, visualType, mode: detailMode, ocr: pageOcr });
                  if (!plan) {
                    detail.notTaken++;
                    if (pageOcr && detailPlanFor({ caption: pic.caption, visualType, mode: detailMode })) { detail.notTakenOcr++; detail.notTakenOcrPages.push(pic.page); }
                    continue;
                  }
                  detail.pages++;
                  detail.pagesList.push(pic.page);
                  detail.reasons.push(`p${pic.page} ${plan.reason}`);
                  const label = `${this.fileName} p${pic.page}`;
                  const title = captionTitleOf(pic.caption);
                  const pageTitle = pageTitleFor(doclingPages, pic.page);
                  const subject = detailSubjectFor({ visualType, title });
                  const hintBase33 = { fileName: this.fileName, docHash: this.docHash, page: pic.page };
                  let kind = plan.kind;
                  const failPage = (why) => { detail.failed++; detail.failedPages.push(pic.page); console.warn(`[VLM Detail failed] ${label}: ${why}; the page keeps its caption`); };
                  // The tiles, rendered from the PDF (or cut from the docling picture).
                  let tilesInfo = null;
                  try {
                    const tileArgs = `--tiles ${pic.page}:${DETAIL_GRID[0]}x${DETAIL_GRID[1]}:${DETAIL_OVERLAP}:${DETAIL_RENDER_SCALE}${tileFromPdf ? "" : ` --tile-image "${pic.abs_path}"`}`;
                    const { stdout } = await execAsync(`"${pythonBin}" "${bridgeScript}" "${this.filePath}" "${imgDir}" ${tileArgs}`, { maxBuffer: 20 * 1024 * 1024, timeout: 120000 });
                    tilesInfo = JSON.parse(stdout);
                    if (tilesInfo.status !== "success" || !tilesInfo.whole || !Array.isArray(tilesInfo.tiles) || tilesInfo.tiles.length === 0) throw new Error(tilesInfo.error || "the bridge rendered no tiles");
                  } catch (err) {
                    failPage(`tiles not rendered (${String(err.message || err).slice(0, 160)})`);
                    continue;
                  }
                  detail.tiles += tilesInfo.tiles.length;
                  const askOpts = { ...vlmOptions, memo, memoIdentity, jobId: this.ingestJobId || null };
                  // KEY (a keyed-index plan): the legend off the whole page; NONE downgrades to transcribe.
                  let key = [];
                  if (kind === "keyed-index") {
                    let wholeBytes = null;
                    try { wholeBytes = require('fs').readFileSync(tilesInfo.whole.abs_path); } catch (err) { wholeBytes = null; }
                    if (wholeBytes && willMiss(wholeBytes, { stage: "key" })) await resetOnce();
                    const k = await askDetail(tilesInfo.whole.abs_path, { ...askOpts, stage: "key", label: `${label} (key)`, hint: { ...hintBase33, figureId: tilesInfo.whole.id, stage: "key" } });
                    tally(k);
                    if (k.outcome !== "answered") { failPage(`the KEY pass ended ${k.outcome}${k.error ? ` (${k.error})` : ""}`); continue; }
                    if (isNoneReply(k.reply)) kind = "transcribe";
                    else key = parseKey(k.reply);
                    if (kind === "keyed-index" && key.length === 0) kind = "transcribe";
                  }
                  const stage = kind === "keyed-index" ? "index" : "transcribe";
                  const stageOpts = { stage, keyText: keyText(key), subject };
                  const replies = [];
                  const tilesNotRead = [];
                  for (const t of tilesInfo.tiles) {
                    let bytes = null;
                    try { bytes = require('fs').readFileSync(t.abs_path); } catch (err) { bytes = null; }
                    if (bytes && willMiss(bytes, stageOpts)) await resetOnce();
                    const r = await askDetail(t.abs_path, { ...askOpts, ...stageOpts, label: `${label} (${t.tile})`, hint: { ...hintBase33, figureId: t.id, stage } });
                    tally(r);
                    if (r.outcome === "answered") replies.push({ tile: t.tile, response: r.reply });
                    else tilesNotRead.push({ tile: t.tile, outcome: r.outcome });
                  }
                  if (replies.length === 0) { failPage(`no tile answered (${tilesNotRead.map((x) => `${x.tile} ${x.outcome}`).join(", ")})`); continue; }
                  // T45 (design §2.2, §2.3; D1 a, D5 a): the tile-edge rule — the bridge's text-layer word boxes and the
                  // tiles' plan let a tile vote only on a label it holds whole (a read beyond the tile's edge is dropped
                  // before the merge); a page without a text layer (a scan, a docling picture) gets no geometry and
                  // merges as before. No model is asked (t45-design §0e: every closer read settled some wrongly).
                  const geometry = detailGeometry(tilesInfo);
                  let merged = kind === "keyed-index" ? mergeTiles(replies, { key, ...geometry }) : null;
                  if (merged && merged.index.length === 0) {
                    // T34 (F-142): a keyed page whose tiles listed nothing but the key's own rows — the merged index is
                    // empty, the key's rows are already in the caption's transcription: NO detail chunk; the page is
                    // counted and named (`detailEmpty`), its replies stay in the memo (a re-ingest recalls and skips again).
                    detail.empty++;
                    detail.emptyPages.push(pic.page);
                    console.log(`[VLM Detail] ${label}: ${kind} (${plan.reason}) — ${tilesInfo.tiles.length} tiles, ${replies.length} read, the merged index is EMPTY (${merged.legendEchoes} legend echo(es) dropped): no detail chunk (F-142)`);
                    continue;
                  }
                  // T57 (design §2.1–§2.4, D1–D9; F-215): the DISCLOSE-ONLY COLOUR CHECK after the tile merge. On a
                  // keyed-index page of a PDF read by pypdfium2, whose KEY names a colour and whose page has a text layer,
                  // the bridge reads the page's colour layer (--colours: the words with their font sizes, every filled path,
                  // each word's pixel counts) and colour_check.js checks each reading against the colour at its label: a
                  // reading the colour contradicts becomes a disclosed conflict (never replaced — the owner's D1), a tile
                  // disagreement the colour settles a plain entry. No model is asked and nothing is written; a failed read
                  // never fails the page — it merges exactly as before T57, counted and named (`detailColourFailedPages`).
                  let colour = null;
                  let association = null;
                  if (merged && tileFromPdf && keyNamesColour(key) && Array.isArray(geometry.textBoxes) && geometry.textBoxes.length > 0) {
                    try {
                      const { stdout } = await execAsync(`"${pythonBin}" "${bridgeScript}" "${this.filePath}" --colours ${pic.page}`, { maxBuffer: 20 * 1024 * 1024, timeout: 120000 });
                      const layer = JSON.parse(stdout);
                      if (layer.status !== "success") throw new Error(layer.error || "the bridge read no colour layer");
                      colour = colourCheck(merged, { key, layer });
                      colour.audit.capped = layer.capped || null;
                      detail.colourPages++;
                      if (colour.audit.ran) {
                        // T61 (design §2, D1 a; F-215's residue): the THREE-CUE SETTLE on the checked merge — where the nearest
                        // footprint, the nearest house and the footprint nearest the plot's own bays all name one design within
                        // 10 pt, with no image under the label, that design is written (the owner's D1: the settle measured safe).
                        // Both steps run before the merge is replaced, so a failure leaves the page merging as before T57.
                        association = associationSettle(colour.merged, { key, layer });
                        merged = association.audit.ran ? association.merged : colour.merged;
                      }
                    } catch (err) {
                      colour = null;
                      association = null;
                      detail.colourFailed++;
                      detail.colourFailedPages.push(pic.page);
                      console.warn(`[VLM Detail] ${label}: the colour layer was not read (${String(err.message || err).slice(0, 160)}); the page merges as before T57`);
                    }
                  }
                  // T59 (design D2 a; F-218): a label another range of its category already names (the Site Plan's "255 - 256")
                  // leaves the index — on the FINAL merge, after the colour check; the audit travels as metadata, never text.
                  if (merged) merged = subsumeRanges(merged);
                  // T61 (design §2): the audit as the chunk stands — a colour disclosure the three cues resolved leaves the
                  // disclosed list, a tile disagreement they resolved joins the colour's settled ones, the readings they wrote
                  // (a plain one replaced, a disclosure resolved) are `associated`; so found = disclosed - flagged + settled holds.
                  const threeCue = association && association.audit.ran ? association.audit.settled : [];
                  const byWas = (w) => threeCue.filter((x) => x.was === w).map((x) => x.label);
                  const colourAudit = colour ? { ran: colour.audit.ran, why: colour.audit.why, swatches: colour.audit.swatches, checked: colour.audit.checked, flagged: colour.audit.flagged.filter((l) => !byWas("colour").includes(l)), settled: colour.audit.settled.concat(byWas("tiles")).sort(labelOrder), associated: byWas("plain").concat(byWas("colour")).sort(labelOrder), left: colour.audit.left.filter((l) => !byWas("tiles").includes(l)), capped: colour.audit.capped, legendText: { ...(colour.audit.legendText || {}) } } : null;
                  if (colourAudit && colourAudit.ran) {
                    detail.colourChecked += colourAudit.checked;
                    detail.colourFlagged += colourAudit.flagged.length;
                    detail.colourSettled += colourAudit.settled.length;
                    detail.colourAssociated += colourAudit.associated.length;
                  }
                  // T60 (design D1 a, D2 a; F-228): the text the legend prints with each matched name groups the COUNTS rows
                  // in the chunk (detail_pass.js legendTextLines) — only from a colour check that ran; else no block.
                  const legendText = colour && colour.audit.ran ? colour.audit.legendText : null;
                  const transcription = kind === "transcribe" ? mergeTranscriptions(replies) : null;
                  if (merged) detail.conflicts += merged.conflicts.length;
                  // T45 (design §2.3, D7, D11): the votes the tile edge dropped, the conflicts it settled, the same-tile multi-values.
                  if (merged) { detail.edgeDropped += merged.edgeDropped.length; detail.edgeSettled += merged.edgeSettled.length; detail.multiValued += merged.multiValued.length; }
                  const text = detailChunkText({ title, pageTitle, page: pic.page, kind, key, merged, transcription, tilesNotRead, legendText });
                  const parts = splitDetailText(text);
                  detail.chunks += parts.length;
                  this.detailResults.push({
                    pic, page: pic.page, kind, reason: plan.reason, reasons: plan.reasons, title, pageTitle, visualType, parts,
                    tiles: tilesInfo.tiles.map((t) => ({ id: t.id, tile: t.tile, width: t.width, height: t.height, cropPt: t.cropPt || null })),
                    whole: { id: tilesInfo.whole.id, width: tilesInfo.whole.width, height: tilesInfo.whole.height },
                    keyEntries: key.length, labels: merged ? merged.labels : null, conflicts: merged ? merged.conflicts.length : 0, unknown: merged ? merged.unknown.length : 0, legendEchoes: merged ? merged.legendEchoes : 0,
                    // T45: the rule's audit trail travels as metadata, never as chunk text (D6 a).
                    geometry: merged ? merged.geometry : false, edgeDropped: merged ? merged.edgeDropped.length : 0, edgeSettled: merged ? merged.edgeSettled.slice() : [], edgeLost: merged ? merged.edgeLost.slice() : [], multiValued: merged ? merged.multiValued.length : 0,
                    // T59 (design D2 a): the labels a wider same-category range subsumed — metadata, never chunk text.
                    rangeSubsumed: merged && Array.isArray(merged.rangeSubsumed) ? merged.rangeSubsumed.map((x) => x.label) : [],
                    counts: merged ? Object.fromEntries(merged.counts.map((c) => [c.category, c.n])) : { lines: transcription ? transcription.lines.length : 0 },
                    tilesNotRead,
                    // T57 (design §2.4): the colour check's audit — metadata, never chunk text (T45 D6's shape).
                    colour: colourAudit,
                  });
                  const colourNote = colourAudit ? (colourAudit.ran ? `, colour check: ${colourAudit.swatches} swatch(es), ${colourAudit.checked} label(s) checked, ${colourAudit.flagged.length} disclosed${colourAudit.flagged.length ? ` (${colourAudit.flagged.join(" ")})` : ""}, ${colourAudit.settled.length} settled${colourAudit.settled.length ? ` (${colourAudit.settled.join(" ")})` : ""}, ${colourAudit.associated.length} settled by three cues${colourAudit.associated.length ? ` (${colourAudit.associated.join(" ")})` : ""}, legend text read for ${Object.values(colourAudit.legendText).filter(Boolean).length} of ${Object.keys(colourAudit.legendText).length} name(s)` : `, colour check: not run (${colourAudit.why})`) + (colourAudit.capped ? ` [${colourAudit.capped}]` : "") : "";
                  console.log(`[VLM Detail] ${label}: ${kind} (${plan.reason}) — ${tilesInfo.tiles.length} tiles, ${replies.length} read${merged ? `, ${merged.labels} labels, ${merged.conflicts.length} conflict(s)${merged.legendEchoes ? `, ${merged.legendEchoes} legend echo(es) dropped` : ""}${merged.geometry ? `, tile edge: ${merged.edgeDropped.length} vote(s) dropped, ${merged.edgeSettled.length} settled${merged.edgeSettled.length ? ` (${merged.edgeSettled.join(" ")})` : ""}${merged.edgeLost.length ? `, ${merged.edgeLost.length} label(s) lost (${merged.edgeLost.join(" ")})` : ""}` : ", no geometry (no text layer)"}${merged.multiValued.length ? `, ${merged.multiValued.length} multi-valued (one tile, two categories)` : ""}${Array.isArray(merged.rangeSubsumed) && merged.rangeSubsumed.length ? `, ${merged.rangeSubsumed.length} range label(s) subsumed (${merged.rangeSubsumed.map((x) => `${x.label} by ${x.by}`).join(", ")})` : ""}${colourNote}` : `, ${transcription.lines.length} lines`}${tilesNotRead.length ? `, not read: ${tilesNotRead.map((x) => x.tile).join(" ")}` : ""}`);
                }
              }
              // T46 (design §2.1, D1 a, D4 a, D8, D9, D14 a, D15, D16; F-174): the CHAIN PASS, after the detail passes —
              // for a captioned page whose caption admits a dimensioned drawing (`chainAdmits`: 7 pages on production),
              // ONE more ask of the same page render with the chain prompt (memo first — its own key; every caption and
              // tile key stands); the drawing's pixel geometry (the bridge's --geometry mode at the pinned setting —
              // render 4.0, inks 200 and 128) read once per render and carried INSIDE the chain reply's memo record
              // (§12d: no memo entry of its own); the reply settled by the geometry (`settleChain`: both inks agree, the
              // ends named, one free claim) and its points computed (`pointsFromChain` — never asked of the model); the
              // block kept on the picture for the chunk assembly below. A failed ask or geometry read never fails the
              // file: the page keeps its caption (or its chain as read), the failure counted and the page named.
              const chainStats = { pages: 0, noDimensions: 0, calls: 0, fromMemo: 0, memoised: 0, failed: 0, lines: 0, unclear: 0, pointsDerived: 0, pointsNotDerivable: 0, closureOk: 0, closureFailed: 0, confirmed: 0, settled: 0, geometryFailed: 0, blocks: 0, pagesList: [], failedPages: [], blockPages: [], settledList: [] };
              {
                const { askChain, chainMemoKey } = require("./vlm_captioner");
                const G = dimensionChain.CHAIN_GEOMETRY;
                const geometryVersion = geometryModuleMd5();
                const chainWillMiss = (bytes) => {
                  if (!memoIdentity) return true;
                  try { return !memo.has(chainMemoKey(bytes, { modelName: vlmModelUsed, memoIdentity }).key); } catch (err) { return true; }
                };
                for (const pic of targetPics) {
                  if (pic.captionOutcome !== "captioned" || typeof pic.caption !== "string") continue;
                  const admit = dimensionChain.chainAdmits(pic.caption);
                  if (!admit.admitted) continue;
                  chainStats.pages++;
                  chainStats.pagesList.push(pic.page);
                  const label = `${this.fileName} p${pic.page}`;
                  let bytes = null;
                  try { bytes = require('fs').readFileSync(pic.abs_path); } catch (err) { bytes = null; }
                  if (bytes && chainWillMiss(bytes)) await resetOnce();
                  const r = await askChain(pic.abs_path, { ...vlmOptions, memo, memoIdentity, jobId: this.ingestJobId || null, label: `${label} (chain)`, hint: { fileName: this.fileName, docHash: this.docHash, page: pic.page, figureId: pic.id, stage: "chain" } });
                  if (r.source === "memo") chainStats.fromMemo++;
                  if (r.requested) chainStats.calls++;
                  if (r.memoised) chainStats.memoised++;
                  if (vlmFirstLoadMs === null && Number.isFinite(r.loadMs)) vlmFirstLoadMs = r.loadMs;
                  if (r.outcome !== "answered") {
                    chainStats.failed++;
                    chainStats.failedPages.push(pic.page);
                    console.warn(`[VLM Chain failed] ${label}: the chain pass ended ${r.outcome}${r.error ? ` (${r.error})` : ""}; the page keeps its caption`);
                    continue;
                  }
                  // The geometry: the chain record's own copy when it holds this module's read of this document's page at
                  // the pinned setting; else the bridge, once, and the read written INTO that record (§12d).
                  const record = r.memoKey ? memo.get(r.memoKey) : null;
                  const held = record && record.geometry;
                  let geometry = held && held.version === geometryVersion && held.docHash === this.docHash && held.page === pic.page && held.scale === G.scale && JSON.stringify(held.inks) === JSON.stringify([G.ink, G.checkInk]) ? held : null;
                  let geometrySource = geometry ? "memo" : null;
                  if (!geometry && ext !== "pdf") geometrySource = "none (not a PDF page)";
                  else if (!geometry) {
                    try {
                      const { stdout } = await execAsync(`"${pythonBin}" "${bridgeScript}" "${this.filePath}" --geometry ${pic.page}:${G.scale}:${G.ink},${G.checkInk}`, { maxBuffer: 20 * 1024 * 1024, timeout: 300000 });
                      const g = JSON.parse(stdout);
                      if (g.status !== "success" || !g.readings) throw new Error(g.error || "the bridge read no geometry");
                      geometry = { version: g.version, docHash: this.docHash, page: pic.page, scale: g.scale, inks: g.inks, readings: g.readings, ocrThreads: g.ocrThreads ?? null, ms: g.ms ?? null, capturedAt: new Date().toISOString() };
                      geometrySource = "bridge";
                      if (record) {
                        const w = memo.put({ ...record, geometry });
                        if (!w.ok) console.warn(`[VLM Chain] ${label}: the geometry was not written into the chain record (${w.error}); it is read again next time`);
                      }
                    } catch (err) {
                      chainStats.geometryFailed++;
                      geometrySource = "failed";
                      console.warn(`[VLM Chain geometry failed] ${label}: ${String(err.message || err).slice(0, 200)}; the chain stays as the captioner read it`);
                    }
                  }
                  if (dimensionChain.isNoDimensions(r.reply)) {
                    chainStats.noDimensions++;
                    pic.chain = { admitted: admit.reason, outcome: "noDimensions", source: r.source, geometry: geometrySource, replaces: false, block: null };
                    console.log(`[VLM Chain] ${label}: NO_DIMENSIONS (${admit.reason}; ${r.source}) — the caption stands; the geometry's shadow read (${geometrySource}): ${dimensionChain.geometrySummary(geometry)}`);
                    continue;
                  }
                  const parsedChain = dimensionChain.parseChain(r.reply);
                  const settlement = dimensionChain.settleChain(r.reply, geometry ? { primary: geometry.readings[String(G.ink)], check: geometry.readings[String(G.checkInk)] } : null);
                  const solved = dimensionChain.pointsFromChain(settlement.reply);
                  const block = dimensionChain.chainBlockText({ reply: settlement.reply, solved });
                  const replaces = dimensionChain.chainReplacesDescription(solved);
                  chainStats.lines += parsedChain.chainLines;
                  chainStats.unclear += parsedChain.unclear;
                  chainStats.pointsDerived += solved.derived;
                  chainStats.pointsNotDerivable += solved.notDerivable.length;
                  chainStats.closureOk += solved.closure.filter((c) => c.ok === true).length;
                  chainStats.closureFailed += solved.closure.filter((c) => c.ok === false).length;
                  chainStats.confirmed += settlement.confirmed;
                  chainStats.settled += settlement.settled;
                  if (replaces) { chainStats.blocks++; chainStats.blockPages.push(pic.page); }
                  const settledLines = settlement.lines.filter((l) => l.outcome === "SETTLED");
                  const bare = (e) => String(e).replace(/^the /, "");
                  for (const l of settledLines) chainStats.settledList.push({ page: pic.page, figureId: pic.id, line: l.line, settledTo: l.settledTo });
                  pic.chain = {
                    admitted: admit.reason, outcome: "chain", source: r.source, geometry: geometrySource, replaces, block,
                    lines: settlement.lines.map((l) => ({ line: l.line, outcome: l.outcome, ...(l.settledTo ? { settledTo: l.settledTo } : {}), ...(l.reason ? { reason: l.reason } : {}) })),
                    confirmed: settlement.confirmed, settled: settlement.settled,
                    points: Object.fromEntries(Object.entries(solved.points).map(([L, p]) => [L, [p.x, p.y]])),
                    notDerivable: solved.notDerivable.map((n) => `${n.point} (${n.missing.join(", ")})`),
                    closure: solved.closure.map((c) => (c.sum ? `${c.sum} vs ${c.printedTotal} ${c.ok ? "ok" : "fails"}` : `${c.axis}: ${c.note}`)),
                  };
                  console.log(`[VLM Chain] ${label}: ${dimensionChain.chainLogSummary(solved, parsedChain)} (${admit.reason}; ${r.source}); geometry (${geometrySource}): ${settlement.confirmed} confirmed, ${settlement.settled} settled; ${replaces ? "the block replaces the DESCRIPTION" : "the caption stands"}`);
                  for (const l of settledLines) console.log(`[VLM Chain] ${label}: ${l.line.split(": ").pop()} settled from the drawing's geometry — ${bare(l.from)} → ${bare(l.to)} read as ${bare(l.settledFrom)} → ${bare(l.settledEnd)}`);
                }
              }
              this.chainSummary = chainStats;
              // The one reset may have been sent by the detail loop (every caption
              // recalled, a tile asked): the trace says so — reset iff a request.
              if (resetSent && captionReset === null) {
                captionReset = resetSent.ok ? resetSent.unloaded : false;
                captionResetWaitMs = Number.isFinite(resetSent.waitedMs) ? resetSent.waitedMs : null;
              }
              this.detailSummary = detail;
              vlmDurationMs = Date.now() - vlmStart;
            }
            this.extractedPictures = (parsed.pictures || []).filter(p => p.caption);

            // T13 (audit E03): the engine is PROPAGATED from the bridge, never
            // asserted. Pre-T13 this line hardcoded "IBM Docling (Layout AI &
            // Table Transformer)" for every bridge success, while the bridge
            // handles every PDF with pypdfium2 and only reaches docling when
            // pypdfium2 throws. `usedDocling` is now derived from the engine
            // that actually ran, and means exactly that.
            const engineId = normalizeEngine(parsed.engine);
            this.doclingTrace = {
              timestamp: new Date().toISOString(),
              fileName: this.fileName,
              pythonBin,
              usedDocling: engineId === ENGINE_IDS.DOCLING,
              engine: parsed.engine || "unknown (bridge reported no engine)",
              engineId,
              // Whether page numbers are real per-page structure or a
              // synthesized single "page 1" (the F-11 .docx case). null when
              // the bridge did not say.
              paginated: typeof parsed.paginated === "boolean" ? parsed.paginated : null,
              reasonIfFallback: null,
              pageCount: doclingPages.length,
              tablesDetected: tableCount,
              picturesCaptured: (parsed.pictures || []).length,
              vlmCaptionsGenerated: vlmCaptionsCount,
              // T24: the other outcomes, so a shortfall has a cause.
              vlmDecorative: vlmCounts.decorative,
              // T32 (design D1, D9): the pages read and found to be text (no chunk);
              // the captions whose TYPE was not in the closed list (counted below,
              // at the header parse); the prompt variants used.
              vlmTextOnly: vlmCounts.textOnly,
              vlmTypeUnlisted: 0,
              captionPrompts,
              vlmEmpty: vlmCounts.empty,
              vlmTruncated: vlmCounts.truncated,
              vlmTiny: vlmCounts.tiny,
              vlmTimedOut: vlmCounts.timedOut,
              vlmFailed: vlmCounts.failed,
              vlmNotAttempted: vlmCounts.notAttempted,
              // T18 (design D2): the running lines removed (null for an unpaginated file — nothing to strip).
              pageArtifacts,
              // T31: the budget applied, the pages considered, the pages beyond it (named).
              figuresConsidered,
              captionBudget,
              notAttemptedPages,
              // T29: the caption memo's share, the requests actually made, and
              // the server's identity the key was formed with.
              vlmFromMemo: vlmCounts.fromMemo,
              vlmCalls: vlmCounts.calls,
              vlmMemoised: vlmCounts.memoised,
              vlmMemoWriteFailed: vlmCounts.memoWriteFailed,
              captionMemo,
              // T47 (design §2.3): the caption labels reconciled with the text layer — the count and the list (page, figureId, from, to, edits).
              captionSubstitutions,
              captionSubstitutionsList: captionSubstitutionsList.slice(),
              // T46 (design D9, D16): the chain pass — the counts (dimension_chain.js CHAIN_COUNT_KEYS) and the named lists.
              ...dimensionChain.chainTraceOf(this.chainSummary),
              vlmModelDigest,
              vlmServer,
              captioning: captionFigures ? "on" : "off",
              captionReset,
              captionResetWaitMs,
              vlmFirstLoadMs,
              vlmModel: vlmModelUsed,
              // T33 (design D7): the detail passes — the mode, the pages planned
              // (named, with the reason each fired for), the tiles, the requests
              // and recalls, the conflicts disclosed, the failed pages (named)
              // and, under auto, the visual pages that did not qualify.
              detailMode,
              detailPages: this.detailSummary ? this.detailSummary.pages : 0,
              detailTiles: this.detailSummary ? this.detailSummary.tiles : 0,
              detailCalls: this.detailSummary ? this.detailSummary.calls : 0,
              detailFromMemo: this.detailSummary ? this.detailSummary.fromMemo : 0,
              detailMemoised: this.detailSummary ? this.detailSummary.memoised : 0,
              detailConflicts: this.detailSummary ? this.detailSummary.conflicts : 0,
              // T45 (design §2.3): the votes the tile edge dropped, the conflicts it settled, the same-tile multi-values.
              detailEdgeDropped: this.detailSummary ? this.detailSummary.edgeDropped : 0,
              detailEdgeSettled: this.detailSummary ? this.detailSummary.edgeSettled : 0,
              detailMultiValued: this.detailSummary ? this.detailSummary.multiValued : 0,
              // T57 (design §2.4): the colour check — the labels checked, the readings disclosed, the tile conflicts it
              // settled, and the pages whose colour layer could not be read (named; they merged as before T57).
              detailColourChecked: this.detailSummary ? this.detailSummary.colourChecked : 0,
              detailColourFlagged: this.detailSummary ? this.detailSummary.colourFlagged : 0,
              detailColourSettled: this.detailSummary ? this.detailSummary.colourSettled : 0,
              // T61 (design §2): the readings the three-cue settle wrote (a plain one replaced, a colour disclosure resolved).
              detailColourAssociated: this.detailSummary ? this.detailSummary.colourAssociated : 0,
              detailColourFailed: this.detailSummary ? this.detailSummary.colourFailed : 0,
              detailColourFailedPages: this.detailSummary ? detailPagesList(this.detailSummary.colourFailedPages) : "",
              detailFailed: this.detailSummary ? this.detailSummary.failed : 0,
              detailNotTaken: this.detailSummary ? this.detailSummary.notTaken : 0,
              detailEmpty: this.detailSummary ? this.detailSummary.empty : 0,
              detailChunks: this.detailSummary ? this.detailSummary.chunks : 0,
              detailPagesList: this.detailSummary ? detailPagesList(this.detailSummary.pagesList) : "",
              detailReasons: this.detailSummary ? this.detailSummary.reasons.slice() : [],
              detailFailedPages: this.detailSummary ? detailPagesList(this.detailSummary.failedPages) : "",
              detailEmptyPages: this.detailSummary ? detailPagesList(this.detailSummary.emptyPages) : "",
              // T35 (design D8): the transcribe plans not taken because OCR read the page (named).
              detailNotTakenOcr: this.detailSummary ? this.detailSummary.notTakenOcr : 0,
              detailNotTakenOcrPages: this.detailSummary ? detailPagesList(this.detailSummary.notTakenOcrPages) : "",
              // T35 (design D10): the OCR pass — the mode, the pages without a text layer, the pages OCR read
              // (named), read empty (named), failed on (named), the characters, the wall time, the engine and
              // its models, the thread pin; null / 0 when the bridge did not report (a pre-T35 reply).
              ocrMode: ocr && typeof ocr.mode === "string" ? ocr.mode : ocrMode,
              ocrNoText: ocr && Number.isFinite(ocr.noText) ? ocr.noText : 0,
              ocrPages: ocr && Number.isFinite(ocr.pages) ? ocr.pages : 0,
              ocrEmpty: ocr && Number.isFinite(ocr.empty) ? ocr.empty : 0,
              ocrFailed: ocr && Number.isFinite(ocr.failed) ? ocr.failed : 0,
              ocrChars: ocr && Number.isFinite(ocr.chars) ? ocr.chars : 0,
              ocrDurationMs: ocr && Number.isFinite(ocr.ms) ? ocr.ms : 0,
              ocrNoTextPages: ocr ? ocrPagesList(ocr.noTextPages) : "",
              ocrPagesList: ocr ? ocrPagesList(ocr.pagesList) : "",
              ocrEmptyPages: ocr ? ocrPagesList(ocr.emptyPages) : "",
              ocrFailedPages: ocr ? ocrPagesList(ocr.failedPages) : "",
              ocrEngine: ocr && typeof ocr.engine === "string" ? ocr.engine : null,
              ocrThreads: ocr && Number.isInteger(ocr.threads) ? ocr.threads : null,
              ocrError: ocr && typeof ocr.error === "string" ? ocr.error : null,
              markdownSample: (doclingPages[0]?.markdown || doclingPages[1]?.markdown || "").slice(0, 350)
            };
            // T35 (design D10): the container log names the pass too (the operator's view during an ingest).
            if (ocr && Number.isFinite(ocr.noText) && ocr.noText > 0) {
              console.log(`[OCR] ${this.fileName}: ${ocr.noText} page(s) without a text layer (p${this.doclingTrace.ocrNoTextPages.replace(/, /g, ", p")}) — mode ${this.doclingTrace.ocrMode}: ${ocr.pages} read (${ocr.chars} chars, ${ocr.ms} ms)${ocr.empty ? `, ${ocr.empty} read empty (p${this.doclingTrace.ocrEmptyPages.replace(/, /g, ", p")})` : ""}${ocr.failed ? `, ${ocr.failed} failed (p${this.doclingTrace.ocrFailedPages.replace(/, /g, ", p")}): ${ocr.error || "?"}` : ""}${this.doclingTrace.ocrEngine ? `; ${this.doclingTrace.ocrEngine}` : ""}`);
            }
          } else if (parsed.error) {
            this.doclingTrace.reasonIfFallback = parsed.error;
          }
        } catch (err) {
          this.doclingTrace.reasonIfFallback = err.message;
          console.warn('[Docling Integration Fallback to Spatial Parsing]:', err.message);
        }
      }

      // Whatever branch ran, record what was measured (the success trace above
      // is then completed with its durations; a fallback trace gets the failed
      // bridge attempt's wall time). A skipped bridge measured nothing — its
      // duration stays null, never a fabricated value.
      if (parseDurationMs === null && bridgeAttempted) parseDurationMs = Date.now() - bridgeStart;
      if (this.doclingTrace.parseDurationMs === undefined) this.doclingTrace.parseDurationMs = parseDurationMs;
      if (this.doclingTrace.vlmDurationMs === undefined) this.doclingTrace.vlmDurationMs = vlmDurationMs;

      if (doclingPages) {
        const allChunks = [];
        let chunkSeq = 0;

        // T34 (design D2–D4, D6): an UNPAGINATED docling file — the bridge said `paginated: false`, the whole document
        // is ONE "page" stamped 1 (F-11) — takes its anchors from docling's markdown headings alone: the heading path
        // in force at the chunk's start is stored where the citation reads it (`section_title` → the class's
        // `sectionTitle`), and `[Section: …]` — never a page word — heads the chunk unless the chunk itself begins with
        // the heading line. The page-top and uppercase-line heuristics and the running-header sanitiser below are
        // PDF-page rules and are not applied to it; a PAGINATED docling file (the pptx, a docling-parsed PDF) keeps
        // every rule below, byte for byte.
        // The bridge's answer lives on the trace here (`parsed` is the bridge branch's local): the same fact the ledger records.
        const unpaginated = this.doclingTrace?.paginated === false;
        const sections = require("./sections");

        for (let pItem of doclingPages) {
          const pNo = pItem.page || 1;
          // T41 (design D7, F-165): a hidden slide (the bridge's `hidden: true`) emits no chunk and is counted and named.
          if (pItem.hidden === true) { hiddenPages.push(pNo); continue; }
          const pMd = (pItem.markdown || "").trim();
          if (!pMd) continue;

          if (unpaginated) {
            const headings = sections.parseHeadings(pMd);
            const pageChunks = recursiveSplit(pMd, this.chunkSize, this.chunkOverlap);
            const offsets = sections.chunkOffsets(pMd, pageChunks);
            // T41 (design D2, §2.1): a piece under the minimum is folded into a neighbour BEFORE the anchors and prefixes
            // are applied — the anchor and the prefix decision read the survivor's ORIGINAL piece (its offset in the
            // markdown is that piece's); the stored text is its folded body.
            const foldedPage = foldSubMinimum(pageChunks.map((p) => String(p || "").trim()), this.minChunkSize, { prefer: "next" });
            this.chunksMergedMinSize += foldedPage.folded;
            for (const c of foldedPage.chunks) {
              const cleanedTxt = c.original;
              const anchor = sections.anchorForChunk(headings, offsets[c.index], cleanedTxt.length);
              const pathText = anchor ? sections.renderPath(anchor.path) : null;
              const chunkWithHeader = pathText && !sections.startsWithHeading(cleanedTxt) ? `${sections.sectionPrefix(pathText)}${c.body}` : c.body;
              const meta = this.extractMetadata(c.body, pNo);
              if (anchor) {
                meta.section_title = pathText;
                meta.sectionHeading = anchor.innermost;
                meta.section_level = anchor.level;
              }
              allChunks.push({
                text: chunkWithHeader,
                source: this.fileName,
                fileType: meta.fileType,
                page: pNo,
                chunkIndex: chunkSeq++,
                docHash: this.docHash,
                ...this.chunkIdentity(),
                metadata: JSON.stringify(meta)
              });
            }
            continue;
          }

          // T18 (design D4): the page's heading is a heading-shaped line within its first five lines, or none — the
          // running lines are already gone (D2), so no list of names is needed and nothing restores a stripped line;
          // a heading never carries across a page boundary.
          let currentSectionHeading = pageTopHeading(pMd) || "";

          const pageChunks = recursiveSplit(pMd, this.chunkSize, this.chunkOverlap);
          // T41 (design D2, §2.1): the pieces under the minimum are folded into a neighbour first; the heading detection
          // and the prefix decision below read the survivor's ORIGINAL piece (a folded piece never sets a heading — the
          // dropped piece never did), the stored text is its folded body.
          const foldedPage = foldSubMinimum(pageChunks.map((t) => t.trim()), this.minChunkSize, { prefer: "next" });
          this.chunksMergedMinSize += foldedPage.folded;
          for (const c of foldedPage.chunks) {
            const cleanedTxt = c.original;

            // Detect nearest preceding heading inside this specific chunk
            // T18 (design D4): a markdown heading, or an uppercase run whose lines are joined by a space (never a
            // newline — F-167); nothing restores a line the running-line rule removed.
            const chunkHead = chunkHeading(cleanedTxt);
            if (chunkHead && chunkHead.length > 3 && !/^page\s/i.test(chunkHead)) currentSectionHeading = stripPageWord(chunkHead);

            const headerTag = currentSectionHeading ? `[Page ${pNo} - ${currentSectionHeading}]\n` : `[Page ${pNo}]\n`;
            const chunkWithHeader = cleanedTxt.toLowerCase().includes((currentSectionHeading || "xyz").toLowerCase().slice(0, 8))
              ? c.body
              : `${headerTag}${c.body}`;

            const meta = this.extractMetadata(c.body, pNo);
            if (currentSectionHeading) meta.sectionHeading = currentSectionHeading;
            // T35 (design D6): a chunk whose page text OCR read says so — the context header reads `Text: OCR`.
            if (pageIsOcr(pItem)) meta.textSource = TEXT_SOURCE_OCR;

            allChunks.push({
              text: chunkWithHeader,
              source: this.fileName,
              fileType: meta.fileType,
              page: pNo,
              chunkIndex: chunkSeq++,
              docHash: this.docHash,
              ...this.chunkIdentity(),
              metadata: JSON.stringify(meta)
            });
          }
        }

        // T41 (design D7): the hidden slides, on the trace (the ledger and the status line read it there).
        if (this.doclingTrace) { this.doclingTrace.slidesHidden = hiddenPages.length; this.doclingTrace.hiddenSlidesList = hiddenPages.join(", "); this.doclingTrace.pageArtifacts = pageArtifacts; }
        const pa = pageArtifacts || { linesRemoved: 0, distinctKeys: 0, keptFirst: 0, pagesWithoutText: 0 };
        console.log(`[Parser] ${this.fileName}: ${allChunks.length} text chunk(s); ${this.chunksMergedMinSize} piece(s) under the minimum (${this.minChunkSize}) folded into a neighbour; ${hiddenPages.length} hidden slide(s) skipped${hiddenPages.length ? ` (${hiddenPages.join(", ")})` : ""}; ${pa.linesRemoved} running line(s) removed (${pa.distinctKeys} key(s), ${pa.keptFirst} kept once, ${pa.pagesWithoutText} page(s) left without text)`);

        // Append VLM-captioned Visual RAG Chunks with Human-Logical Metadata
        if (Array.isArray(this.extractedPictures) && this.extractedPictures.length > 0) {
          for (let pic of this.extractedPictures) {
            // Parse the caption's header — T32 (design D3): the generic labels
            // TITLE / TYPE / SUBJECTS, with the legacy HUMAN TITLE / DIAGRAM TYPE /
            // KEY SUBJECTS still accepted (production's captions keep parsing
            // until the owner re-captions, charter D4). The values land where
            // they always did; TYPE is ALSO normalised into the closed list
            // (`visualType`, T33's key) — null and counted when unlisted.
            const capStr = pic.caption || "";
            const humanTitleMatch = capStr.match(/^(?:HUMAN )?TITLE:\s*(.+)$/im);
            const diagramTypeMatch = capStr.match(/^(?:DIAGRAM )?TYPE:\s*(.+)$/im);
            const keySubjectsMatch = capStr.match(/^(?:KEY )?SUBJECTS:\s*(.+)$/im);

            const rawHumanTitle = humanTitleMatch ? humanTitleMatch[1].trim() : null;
            const diagramType = diagramTypeMatch ? diagramTypeMatch[1].trim() : null;
            const keySubjects = keySubjectsMatch ? keySubjectsMatch[1].trim() : null;
            const visualType = normaliseVisualType(diagramType);
            if (diagramType && visualType === null && this.doclingTrace && Number.isFinite(this.doclingTrace.vlmTypeUnlisted)) this.doclingTrace.vlmTypeUnlisted++;

            // T18 (design D6): the caption's title is the VLM's with only a leading `Page N` stripped; the page's title
            // is the page's heading (D4) or `Page N` — the same answer the detail chunk and the text chunks read.
            const humanTitle = rawHumanTitle ? stripPageWord(rawHumanTitle) : null;
            const pageTitle = pageTitleFor(doclingPages, pic.page);

            // T46 (design D6 a, D7): a chain page's DESCRIPTION is the block — the TITLE / TYPE / SUBJECTS /
            // TRANSCRIPTION and the header (the humanTitle, T49's lightbox caption) unchanged; the memo stays raw.
            const captionText = pic.chain && pic.chain.replaces && pic.chain.block ? dimensionChain.replaceDescription(pic.caption, pic.chain.block) : pic.caption;
            const meta = this.extractMetadata(captionText, pic.page);
            meta.isVisualElement = true;
            meta.figureId = pic.id;
            meta.imagePath = pic.web_path;
            meta.sectionHeading = pageTitle;
            if (humanTitle) meta.humanTitle = humanTitle;
            if (diagramType) meta.diagramType = diagramType;
            if (keySubjects) meta.keySubjects = keySubjects;
            meta.visualType = visualType;
            // T47 (design §2.3): the labels the text layer reconciled on this caption — metadata, the text already carries the page's spelling.
            if (Array.isArray(pic.captionSubstitutions) && pic.captionSubstitutions.length > 0) meta.captionSubstitutions = pic.captionSubstitutions.map((s) => ({ from: s.from, to: s.to, edits: s.edits }));
            // T46 (design D16): the chain's record — the admission, the per-line outcome (CONFIRMED / SETTLED / UNSETTLED
            // with the reason), the points, the closure, whether the block replaced the DESCRIPTION — metadata, never text.
            if (pic.chain) { const { block, ...chainMeta } = pic.chain; meta.chain = chainMeta; }

            const displayLabel = humanTitle ? humanTitle : `${pageTitle} (${pic.id})`;

            allChunks.push({
              text: `[HUMAN-LOGICAL VISUAL ELEMENT: ${displayLabel} | Section: ${pageTitle} (Page ${pic.page})]:\n${captionText}`,
              source: this.fileName,
              fileType: meta.fileType,
              page: pic.page,
              chunkIndex: chunkSeq++,
              docHash: this.docHash,
              ...this.chunkIdentity(),
              imagePath: pic.web_path,
              metadata: JSON.stringify(meta)
            });
          }
        }

        // T33 (design D5): the detail chunks, AFTER the caption chunks — one per
        // page that fired (a long transcribe merge in numbered parts), an
        // isVisualElement chunk on the page's render like a caption, so it rides
        // as a companion (T28), joins the whole-document read (T28 / T15) and is
        // cited like a caption; `metadata.detail` marks it for any reader.
        if (Array.isArray(this.detailResults) && this.detailResults.length > 0) {
          for (const dr of this.detailResults) {
            const n = dr.parts.length;
            for (let i = 0; i < n; i++) {
              const meta = this.extractMetadata(dr.parts[i], dr.page);
              meta.isVisualElement = true;
              meta.detail = true;
              meta.detailKind = dr.kind;
              meta.detailReason = dr.reason;
              meta.figureId = n > 1 ? `detail_${dr.page}_${i + 1}` : `detail_${dr.page}`;
              meta.imagePath = dr.pic.web_path;
              meta.sectionHeading = dr.pageTitle;
              if (dr.title) meta.humanTitle = dr.title;
              meta.visualType = dr.visualType;
              meta.detailCounts = dr.counts;
              meta.detailConflicts = dr.conflicts;
              if (dr.legendEchoes) meta.detailLegendEchoes = dr.legendEchoes;
              // T45 (design §2.2, D6 a): the labels the tile edge settled and the same-tile multi-value count — metadata, never text.
              if (Array.isArray(dr.edgeSettled) && dr.edgeSettled.length) meta.detailEdgeSettled = dr.edgeSettled.slice();
              if (dr.multiValued) meta.detailMultiValued = dr.multiValued;
              // T59 (design D2 a): the labels a wider range of their category subsumed ("255 - 256") — metadata, never text.
              if (Array.isArray(dr.rangeSubsumed) && dr.rangeSubsumed.length) meta.detailRangeSubsumed = dr.rangeSubsumed.slice();
              // T57 (design §2.4, D7 a): the readings the colour check disclosed and the tile conflicts it settled — metadata, never text.
              if (dr.colour && dr.colour.flagged.length) meta.detailColourFlagged = dr.colour.flagged.slice();
              if (dr.colour && dr.colour.settled.length) meta.detailColourSettled = dr.colour.settled.slice();
              // T61 (design §2): the readings the three-cue settle wrote — metadata, never text (T45 D6's shape).
              if (dr.colour && Array.isArray(dr.colour.associated) && dr.colour.associated.length) meta.detailColourAssociated = dr.colour.associated.slice();
              meta.detailTiles = dr.tiles.map((t) => t.id);
              if (n > 1) meta.detailPart = [i + 1, n];
              allChunks.push({
                text: dr.parts[i],
                source: this.fileName,
                fileType: meta.fileType,
                page: dr.page,
                chunkIndex: chunkSeq++,
                docHash: this.docHash,
                ...this.chunkIdentity(),
                imagePath: dr.pic.web_path,
                metadata: JSON.stringify(meta)
              });
            }
          }
        }

        return allChunks;
      }

      // Per-Page Spatial Parsing Fallback ONLY if file is PDF
      if (ext === 'pdf') {
        const spatialStart = Date.now();
        const pages = await extractPages(this.buffer);
        // The fallback engine really ran: its trace reports the pages it
        // parsed and the time it took, not the provisional zeros (T13).
        this.doclingTrace.pageCount = pages.length;
        this.doclingTrace.parseDurationMs =
          (this.doclingTrace.parseDurationMs || 0) + (Date.now() - spatialStart);
        const allChunks = [];
        let chunkSeq = 0;
        // T18 (design D2, D11): the same running-line rule on the fallback path — detected over the document's pages,
        // removed (the first copy kept) before the domain pattern and the split; the counts ride the trace.
        const strippedFallback = stripRunningLines(pages.map((p) => p.text), { keepFirst: true });
        this.doclingTrace.pageArtifacts = pageArtifactCounts(strippedFallback);

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          let lines = strippedFallback.pages[i].split('\n');
          lines = cleanHeaderFooters(lines, this.headerFooterPattern);
          const cleanText = lines.join('\n').trim();
          
          if (!cleanText) continue;
          
          // Chunk each physical page individually to guarantee 100% page attribution accuracy
          const pageChunks = recursiveSplit(cleanText, this.chunkSize, this.chunkOverlap);
          // T41 (design D2): a piece under the minimum is folded into a neighbour on its page, never dropped.
          const foldedPage = foldSubMinimum(pageChunks.map((t) => t.trim()), this.minChunkSize, { prefer: "next" });
          this.chunksMergedMinSize += foldedPage.folded;
          for (const c of foldedPage.chunks) {
            const cleanedTxt = c.body;
      
            const meta = this.extractMetadata(cleanedTxt, page.pageNumber);
            allChunks.push({
              text: cleanedTxt,
              source: this.fileName,
              fileType: meta.fileType,
              page: page.pageNumber,
              chunkIndex: chunkSeq++,
              docHash: this.docHash,
              ...this.chunkIdentity(),
              metadata: JSON.stringify(meta)
            });
          }
        }
        return allChunks;
      }
    }

    // Non-PDF (Office document or plain text)
    const officeStart = Date.now();
    const text = await extractOfficeText(this.buffer, this.filePath);

    // If a bridge attempt failed above, its reason is preserved; a format the
    // bridge never handles (txt/md/csv) has no fallback story to tell —
    // OfficeParser is simply its engine.
    const bridgeEligible = ['pdf', 'docx', 'pptx', 'xlsx'].includes(ext);
    const priorReason = this.doclingTrace?.reasonIfFallback || null;
    // A failed bridge attempt's wall time is part of what parsing this file
    // really cost — carry it into the final trace.
    const priorParseMs = Number.isFinite(this.doclingTrace?.parseDurationMs)
      ? this.doclingTrace.parseDurationMs
      : 0;
    this.doclingTrace = {
      timestamp: new Date().toISOString(),
      fileName: this.fileName,
      pythonBin: "N/A (Non-PDF)",
      usedDocling: false,
      engine: `OfficeParser (Native ${ext.toUpperCase()})`,
      engineId: ENGINE_IDS.OFFICEPARSER,
      // Every chunk on this path is stamped page 1; that is not pagination.
      paginated: false,
      reasonIfFallback: bridgeEligible
        ? (priorReason || "python bridge unavailable or produced no pages")
        : null,
      pageCount: 1,
      tablesDetected: 0,
      parseDurationMs: priorParseMs + (Date.now() - officeStart),
      vlmDurationMs: null,
      markdownSample: text.slice(0, 300)
    };
    
    const allChunks = [];
    let chunkSeq = 0;
    
    const chunks = recursiveSplit(text, this.chunkSize, this.chunkOverlap);
    // T41 (design D2): ONE minimum (the office path's former 150 is gone) and a piece under it is folded into a
    // neighbour, never dropped — a 200-character CSV keeps all its rows (t41-design.md §0d).
    const foldedText = foldSubMinimum(chunks.map((t) => t.trim()), this.minChunkSize, { prefer: "next" });
    this.chunksMergedMinSize += foldedText.folded;
    console.log(`[Parser] ${this.fileName}: ${foldedText.chunks.length} text chunk(s); ${this.chunksMergedMinSize} piece(s) under the minimum (${this.minChunkSize}) folded into a neighbour`);
    for (const c of foldedText.chunks) {
      const txt = c.body;

      const meta = this.extractMetadata(txt, 1);
      allChunks.push({
        text: txt.trim(),
        source: this.fileName,
        fileType: ext,
        page: 1,
        chunkIndex: chunkSeq++,
        docHash: this.docHash,
        ...this.chunkIdentity(),
        metadata: JSON.stringify(meta)
      });
    }
    return allChunks;
  }
}

// 1. Data Protection Act 2018 (DPA) Parser
class DpaParser extends DocumentParser {
  get headerFooterPattern() { 
    return /Data Protection Act 2018|Document Generated:|c\.\s*12/i; 
  }
  
  extractMetadata(chunkText, pageNum) {
    const meta = super.extractMetadata(chunkText, pageNum);
    if (this.config?.metadataExtraction === false) return meta;
    
    meta.instrument = "DPA 2018";
    
    // Parse Part / Chapter / Sections
    const partMatch = chunkText.match(/PART\s+(\d+|[IVXLCDM]+)/i);
    if (partMatch) meta.part = `Part ${partMatch[1]}`;
    
    const chapMatch = chunkText.match(/CHAPTER\s+(\d+)/i);
    if (chapMatch) meta.chapter = `Chapter ${chapMatch[1]}`;
    
    const secMatch = chunkText.match(/(?:section|sec\.)\s*(\d+)/i);
    if (secMatch) meta.section_number = secMatch[1];
    
    // Attempt to pull first line after section matching as title
    const lines = chunkText.split('\n');
    for (let line of lines) {
      const match = line.match(/^\s*(\d+)\s+([A-Za-z][A-Za-z\s]+)/);
      if (match) {
        meta.section_number = match[1];
        meta.section_title = match[2].trim();
        break;
      }
    }
    
    // Subsection ranges (e.g. (1)-(3))
    const subMatch = chunkText.match(/\((\d+)\)(?:-\((\d+)\))?/g);
    if (subMatch) {
      meta.subsection_range = subMatch.join(', ');
    }
    
    return meta;
  }
}

// 2. FCA SYSC Rules Book Parser
class SyscParser extends DocumentParser {
  get headerFooterPattern() {
    return /Senior Management Arrangements|Systems and Controls|SYSC\s+\d+|Release\s+\d+|FCA\s+\d{4}/i;
  }
  
  extractMetadata(chunkText, pageNum) {
    const meta = super.extractMetadata(chunkText, pageNum);
    if (this.config?.metadataExtraction === false) return meta;
    
    meta.sourcebook = "SYSC";
    
    const chapMatch = chunkText.match(/SYSC\s+(\d+)/i);
    if (chapMatch) meta.chapter_number = chapMatch[1];
    
    // Find rule references like SYSC 4.1.1R or SYSC 15.1.1G
    const ruleMatch = chunkText.match(/SYSC\s+(\d+\.\d+\.\d+([RGE]))/i);
    if (ruleMatch) {
      meta.rule_ref = `SYSC ${ruleMatch[1]}`;
      meta.rule_type = ruleMatch[2]; // R/G/E
    }
    
    // Annex or table references
    const annexMatch = chunkText.match(/Annex\s+(\d+[A-Z]?)/i);
    if (annexMatch) meta.annex_id = annexMatch[0];
    
    const tableMatch = chunkText.match(/Table\s+(\d+[A-Z]?)/i);
    if (tableMatch) meta.table_id = tableMatch[0];
    
    return meta;
  }
}

// 3. PCI DSS v4.0.1 Parser
class PciDssParser extends DocumentParser {
  get headerFooterPattern() {
    return /PCI DSS v4|Security Standards Council|June 2024/i;
  }
  
  extractMetadata(chunkText, pageNum) {
    const meta = super.extractMetadata(chunkText, pageNum);
    if (this.config?.metadataExtraction === false) return meta;
    
    meta.standard = "PCI DSS";
    meta.version = "4.0.1";
    
    const reqMatch = chunkText.match(/Requirement\s+(\d+)/i);
    if (reqMatch) meta.requirement_number = reqMatch[1];
    
    const subMatch = chunkText.match(/(?:Requirement\s+)?(\d+\.\d+\.\d+)/);
    if (subMatch) meta.sub_requirement = subMatch[1];
    
    return meta;
  }
}

// 4. Payment Services Regulations 2017 (PSRs) Parser
class PsrParser extends DocumentParser {
  get headerFooterPattern() {
    return /Payment Services Regulations 2017|2017 No\.\s*752|PART\s+\d+|Schedule\s+\d+/i;
  }
  
  extractMetadata(chunkText, pageNum) {
    const meta = super.extractMetadata(chunkText, pageNum);
    if (this.config?.metadataExtraction === false) return meta;
    
    meta.instrument = "PSRs 2017";
    
    const partMatch = chunkText.match(/PART\s+(\d+)/i);
    if (partMatch) meta.part_number = partMatch[1];
    
    const schedMatch = chunkText.match(/Schedule\s+(\d+)/i);
    if (schedMatch) meta.schedule_number = schedMatch[1];
    
    const regMatch = chunkText.match(/(?:regulation|reg\.)\s*(\d+)/i);
    if (regMatch) meta.regulation_number = regMatch[1];
    
    return meta;
  }
}

// Fallback Generic Parser
class GenericParser extends DocumentParser {
  extractMetadata(chunkText, pageNum) {
    const meta = super.extractMetadata(chunkText, pageNum);
    if (this.config?.metadataExtraction === false) return meta;
    
    // Generic heading match
    const heading = chunkText.match(/^#+\s*(.+)$/m);
    if (heading) meta.section = heading[1].trim();
    return meta;
  }
}

// Markdown and Text Document Parser
class MarkdownParser extends DocumentParser {
  /**
   * T41 (design D3; T19): a heading line opens the paragraph that follows it — the heading and its text are ONE unit,
   * so the heading is in the body of the chunk it introduces (audit E10: a term that lived only in a heading was
   * unsearchable); a unit longer than chunkSize no longer rides whole — it is split by recursiveSplit and each piece is
   * a chunk carrying the unit's line range; and (design D2) the minimum applies here too: a chunk under it is folded
   * into its predecessor (a split's short tail belongs to its own paragraph), the first into its successor.
   */
  async chunk() {
    // T07: the drop count is measured on this path now (T41) — always 0; the folds are counted beside it.
    this.chunksDroppedMinSize = 0;
    this.chunksMergedMinSize = 0;
    const text = await extractOfficeText(this.buffer, this.filePath);
    const lines = text.split('\n');
    const chunkSize = this.chunkSize;
    const chunkOverlap = this.chunkOverlap;

    // 1. The units: a paragraph is its lines, opened by the heading(s) above it when there are any.
    const units = [];
    let currentSection = "General Document Body";
    let unitSection = currentSection;
    let paragraphLines = [];
    let paragraphStart = 1;
    let headingOnly = false;
    const closeUnit = (endLine) => {
      if (!paragraphLines.length) return;
      units.push({ text: paragraphLines.join('\n'), section: unitSection, startLine: paragraphStart, endLine });
      paragraphLines = [];
      headingOnly = false;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hMatch = line.match(/^#+\s*(.+)$/);
      if (hMatch) {
        currentSection = hMatch[1].trim();
        // A heading after content closes that paragraph; a heading after another heading joins it (both introduce
        // the text that follows).
        if (paragraphLines.length && !headingOnly) closeUnit(i);
        if (!paragraphLines.length) { paragraphStart = i + 1; unitSection = currentSection; headingOnly = true; }
        paragraphLines.push(line);
        continue;
      }
      if (line.trim() === "") {
        // A blank line ends a paragraph — unless the paragraph so far is only its heading(s), which wait for their text.
        if (paragraphLines.length && !headingOnly) closeUnit(i);
        continue;
      }
      if (!paragraphLines.length) { paragraphStart = i + 1; unitSection = currentSection; }
      paragraphLines.push(line);
      headingOnly = false;
    }
    closeUnit(lines.length);

    // 2. The accumulation: units join up to chunkSize (as before); an oversize unit is split on its own.
    const emitted = [];
    let acc = [];
    const flush = () => {
      if (!acc.length) return;
      const chunkText = acc.map((u) => u.text).join('\n').trim();
      if (chunkText) emitted.push({ text: chunkText, section: acc[0].section, startLine: acc[0].startLine, endLine: acc[acc.length - 1].endLine });
      acc = [];
    };
    for (const u of units) {
      if (u.text.length > chunkSize) {
        flush();
        for (const piece of recursiveSplit(u.text, chunkSize, chunkOverlap)) {
          const t = piece.trim();
          if (t) emitted.push({ text: t, section: u.section, startLine: u.startLine, endLine: u.endLine });
        }
        continue;
      }
      const accText = acc.map((x) => x.text).join('\n');
      if (acc.length && accText.length + u.text.length + 1 > chunkSize) flush();
      acc.push(u);
    }
    flush();

    // 3. The minimum: a chunk under it is folded into its predecessor (the first into its successor), never dropped.
    const folded = foldSubMinimum(emitted.map((e) => e.text), this.minChunkSize, { prefer: "previous" });
    this.chunksMergedMinSize += folded.folded;
    const allChunks = [];
    let chunkSeq = 0;
    for (const c of folded.chunks) {
      const e = emitted[c.index];
      const meta = this.extractMetadata(c.body, 1);
      if (!/^#+\s*.+$/m.test(c.body)) meta.section_title = e.section;
      meta.startLine = e.startLine;
      meta.endLine = c.absorbed.length ? Math.max(e.endLine, ...c.absorbed.map((i) => emitted[i].endLine)) : e.endLine;
      allChunks.push({
        text: c.body,
        source: this.fileName,
        fileType: "md",
        page: 1,
        chunkIndex: chunkSeq++,
        docHash: this.docHash,
        ...this.chunkIdentity(),
        metadata: JSON.stringify(meta)
      });
    }
    console.log(`[Parser] ${this.fileName}: ${allChunks.length} text chunk(s); ${this.chunksMergedMinSize} piece(s) under the minimum (${this.minChunkSize}) folded into a neighbour`);

    return allChunks.length > 0 ? allChunks : super.chunk();
  }

  extractMetadata(chunkText, pageNum) {
    const meta = super.extractMetadata(chunkText, pageNum);
    if (this.config?.metadataExtraction === false) return meta;
    meta.instrument = "Corporate Standard";
    const heading = chunkText.match(/^#+\s*(.+)$/m);
    if (heading) meta.section_title = heading[1].trim();
    return meta;
  }
}

const { profileDocument } = require('./profiler');

// Router factory
/**
 * T18 (design D9, audit E12): a domain parser is chosen by the file NAME's tokens — the base name without its
 * extension, split on anything not a letter or digit — never by a bare substring. `dpa_2018_c12.pdf`,
 * `FCA_SYSC_June2026.pdf`, `PCI-DSS-v4_0_1_June2024.pdf` and `PSRs_2017_April2026.pdf` keep their parsers;
 * `misleading_name_dpa.pdf`, `gdpa_notes.pdf` and `topical_report.pdf` are generic. Pure; exported for U-ROUTE.
 */
function routeForFileName(filePath) {
  const base = path.basename(String(filePath || "")).toLowerCase();
  if (/\.(md|markdown)$/.test(base)) return "markdown";
  const tokens = base.replace(/\.[a-z0-9]+$/, "").split(/[^a-z0-9]+/).filter(Boolean);
  const first = tokens[0] || "";
  const has = (t) => tokens.includes(t);
  if (first === "dpa" || (has("dpa") && has("2018"))) return "dpa";
  if (has("sysc")) return "sysc";
  if (has("pci") && has("dss")) return "pci";
  if (first === "psrs" || first === "psr" || (has("psrs") && has("2017"))) return "psr";
  return "generic";
}

function getParserForFile(filePath, buffer, config = {}, realFilePath = "") {
  let finalConfig = { ...config };
  
  if (buffer && (!config.chunkSize || config.autoProfile !== false)) {
    const profile = profileDocument(filePath, buffer);
    finalConfig = {
      ...profile.recommendedSettings,
      ...config,
      profileMetrics: profile.metrics,
      profileRecommendedSettings: profile.recommendedSettings
    };
  }

  const route = routeForFileName(filePath);
  let parser = null;
  if (route === "markdown") {
    parser = new MarkdownParser(filePath, buffer, finalConfig, realFilePath);
  } else if (route === "dpa") {
    parser = new DpaParser(filePath, buffer, finalConfig, realFilePath);
  } else if (route === "sysc") {
    parser = new SyscParser(filePath, buffer, finalConfig, realFilePath);
  } else if (route === "pci") {
    parser = new PciDssParser(filePath, buffer, finalConfig, realFilePath);
  } else if (route === "psr") {
    parser = new PsrParser(filePath, buffer, finalConfig, realFilePath);
  } else {
    parser = new GenericParser(filePath, buffer, finalConfig, realFilePath);
  }

  parser.profile = finalConfig.profileRecommendedSettings || null;
  parser.profileMetrics = finalConfig.profileMetrics || null;
  return parser;
}

module.exports = {
  getParserForFile,
  routeForFileName,
  pageHasTextLayer,
  normaliseVisualType,
  recursiveSplit,
  extractPages,
  // T41 (design D4; T02): exported so U-PARSE can prove a failed Office parse is a typed failure, never UTF-8 garbage.
  extractOfficeText,
  chunkSetting
};

// T22 (design D4, finding F-6): the interpreter lookup is exported so U-PYBIN
// can prove that a present-but-broken candidate is skipped and a runnable one chosen.
module.exports.findPythonBin = findPythonBin;
