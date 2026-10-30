#!/usr/bin/env python3
"""
Golden corpus ground-truth derivation  (audit ticket T00).

The golden corpus is the *real* demo corpus in public/demos/demo_files/ext_reg_docs,
plus the documents retired from the demo on 2026-10-02 (the coding-assistant corpus
keeps only the three regulatory PDFs), which live on as fixtures in
tests/fixtures/legacy_corpus. Those documents are already tracked in the repository, span the formats the RAG
pipeline is expected to ingest, and are far more representative than synthetic
fixtures. This script does not author documents; it derives verifiable
expectations from them and writes tests/manifests/golden.json.

Independence of ground truth
----------------------------
Deriving expectations from a single extractor would make the golden tests
circular: they would assert only that an engine agrees with itself, and could
never detect dropped text or reading-order defects (audit FM-R1). So every PDF
is read by BOTH production extractors:

  engine A  pypdfium2                  - src/lib/ingestion/docling_bridge.py
  engine B  pdf-parse / pdf.js         - src/lib/ingestion/parser.js extractPages()

An expectation is only promoted to the manifest when both engines agree on it.
Disagreements are not discarded - they are recorded under `divergences`, because
engine disagreement is itself the reading-order signal the audit wants surfaced.

Non-PDF formats are cross-checked the same way, against libraries independent of
the production path (python-docx / python-pptx / openpyxl vs officeparser/docling).

This script also writes the small fixtures the real corpus cannot supply:
format gaps (TXT / CSV / XLSX) and the adversarial edge cases. Adversarial PDF
probes are copies of real corpus documents, so no PDF is ever generated.

Usage:
    .venv/bin/python scripts/derive_golden_manifest.py [--check]

    --check   derive and compare against the committed manifest without
              rewriting it; exits non-zero on drift. Intended for CI.

Output is byte-stable: no timestamps or random values are emitted, so an
unchanged corpus always reproduces an identical manifest.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from collections import Counter

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS_REL = os.path.join("public", "demos", "demo_files", "ext_reg_docs")
CORPUS_DIR = os.path.join(REPO_ROOT, CORPUS_REL)
# 2026-10-02: the demo corpus is the three regulatory PDFs; the other documents moved here and stay in the golden corpus.
LEGACY_REL = os.path.join("tests", "fixtures", "legacy_corpus")
CORPUS_RELS = [CORPUS_REL, LEGACY_REL]


def corpus_rel_of(name):
    """The repo-relative path of a corpus document, whichever corpus folder holds it (None if neither)."""
    for rel_dir in CORPUS_RELS:
        if os.path.exists(os.path.join(REPO_ROOT, rel_dir, name)):
            return os.path.join(rel_dir, name)
    return None
FIXTURES_DIR = os.path.join(REPO_ROOT, "tests", "fixtures", "golden")
ADVERSARIAL_DIR = os.path.join(FIXTURES_DIR, "adversarial")
MANIFEST_PATH = os.path.join(REPO_ROOT, "tests", "manifests", "golden.json")
NODE_EXTRACTOR = os.path.join(REPO_ROOT, "scripts", "lib", "extract_pdfparse.js")

MANIFEST_SCHEMA_VERSION = 1

# Conservative lower bound: 1 chunk per 4000 extracted characters. The real
# chunker emits far more (default chunkSize 600-800 chars), so a test asserting
# ">= expectedMinChunks" stays green across chunk-size configuration changes and
# only fails on genuine content loss.
CHARS_PER_EXPECTED_CHUNK = 4000

TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9/_.\-]{4,}")
# Trailing punctuation is an artefact of sentence position, not part of the term.
# Stripping it keeps anchors clean for exact/BM25 matching downstream.
TOKEN_TRIM = ".-/_"


def tokenize(text):
    return [t for t in (m.strip(TOKEN_TRIM) for m in TOKEN_RE.findall(text)) if len(t) >= 5]


# ---------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------

def extract_pypdfium(abs_path):
    """Engine A - the production primary PDF path."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(abs_path)
    pages = []
    for idx, page in enumerate(pdf):
        pages.append({"page": idx + 1, "text": page.get_textpage().get_text_range()})
    return {"engine": "pypdfium2 (production primary)", "pageCount": len(pages), "pages": pages}


def extract_pdfparse(abs_path):
    """Engine B - the production spatial fallback, via a small Node bridge."""
    proc = subprocess.run(
        ["node", NODE_EXTRACTOR, abs_path],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=600,
    )
    if proc.returncode != 0 and not proc.stdout.strip():
        return {"error": f"node extractor failed: {proc.stderr.strip()[:300]}"}
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return {"error": f"unparseable extractor output: {exc}"}
    return data


def page_of(pages, token):
    """First 1-based page whose text contains `token` (case-sensitive)."""
    for p in pages:
        if token in (p.get("text") or ""):
            return p["page"]
    return None


def count_token(pages, token):
    """Case-insensitive whole-word occurrences across all pages.

    Mirrors the counting rule the aggregation feature is specified to use
    (audit T09), so I-COUNT / U-COUNT can assert against these numbers.
    """
    pattern = re.compile(r"(?<![A-Za-z0-9])" + re.escape(token) + r"(?![A-Za-z0-9])", re.IGNORECASE)
    return sum(len(pattern.findall(p.get("text") or "")) for p in pages)


# ---------------------------------------------------------------------------
# anchor selection
# ---------------------------------------------------------------------------

def pick_anchors(pages_a, pages_b, limit=3):
    """Rare terms both engines place on the same page.

    Anchors replace the injected sentinels a synthetic corpus would provide:
    exact, rare, BM25-findable strings whose page attribution is checkable
    without depending on model quality. Tokens containing a digit are preferred
    (part numbers, rule references, article codes) as they are the least likely
    to be introduced by extraction artefacts.
    """
    full_a = "\n".join(p.get("text") or "" for p in pages_a)
    freq = Counter(tokenize(full_a))

    unique = [t for t, n in freq.items() if n == 1 and len(t) >= 6]

    def has_digit(t):
        return any(c.isdigit() for c in t)

    def has_alpha(t):
        return any(c.isalpha() for c in t)

    # Rule references and part numbers (letters AND digits) are the most reliable
    # anchors: rare by construction, and unlikely to be extraction artefacts.
    mixed = sorted(t for t in unique if has_digit(t) and has_alpha(t))
    numeric = sorted(t for t in unique if has_digit(t) and not has_alpha(t))
    alpha = sorted(t for t in unique if not has_digit(t))

    anchors = []
    used_pages = set()
    for token in mixed + numeric + alpha:
        if len(anchors) >= limit:
            break
        pa = page_of(pages_a, token)
        pb = page_of(pages_b, token) if pages_b else None
        if pa is None:
            continue
        # Both engines must agree, when engine B produced usable output.
        if pages_b and pb != pa:
            continue
        if pa in used_pages and len(used_pages) < len(pages_a):
            continue
        anchors.append({"token": token, "page": pa, "confirmedByBothEngines": bool(pages_b)})
        used_pages.add(pa)
    return anchors


def pick_count_probes(pages_a, pages_b, limit=2):
    """Mid-frequency terms whose total count both engines agree on."""
    full_a = "\n".join(p.get("text") or "" for p in pages_a)
    freq = Counter(tokenize(full_a))

    candidates = sorted(
        t for t, n in freq.items() if 5 <= n <= 60 and len(t) >= 5 and t.isalpha()
    )
    probes = []
    for token in candidates:
        if len(probes) >= limit:
            break
        ca = count_token(pages_a, token)
        if pages_b:
            cb = count_token(pages_b, token)
            if ca != cb:
                continue
        probes.append({"token": token, "count": ca, "rule": "case-insensitive whole-word",
                       "confirmedByBothEngines": bool(pages_b)})
    return probes


# ---------------------------------------------------------------------------
# T38 (T34's D8 b): the heading each anchor sits under, from the INDEPENDENT engine, for section-level scoring of
# an unpaginated source. A .docx is walked in body order (paragraphs AND tables — python-docx keeps them apart), the
# Heading-styled paragraph in force is the section; a markdown file's `#` heading preceding the token's line is.
# Every heading the token occurs under is listed (an anchor unique by the tokenizer can still recur as a substring —
# "0.018/GB" sits under three headings of the TCO file); the eval scores a hit on any of them.
# ---------------------------------------------------------------------------

def docx_sections(document):
    """[(heading in force, text)] in body order, paragraphs and tables alike."""
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    current = None
    items = []
    for child in document.element.body.iterchildren():
        tag = child.tag.split("}")[-1]
        if tag == "p":
            p = Paragraph(child, document)
            name = (p.style.name or "") if p.style is not None else ""
            txt = p.text.strip()
            if name.lower().startswith("heading") and txt:
                current = txt
            items.append((current, txt))
        elif tag == "tbl":
            t = Table(child, document)
            cells = " | ".join(c.text.strip() for r in t.rows for c in r.cells if c.text.strip())
            items.append((current, cells))
    return items


def headings_of_token(items, token):
    """Every heading (in order, once) under which `token` occurs in `items` = [(heading, text)]."""
    out = []
    for heading, text in items:
        if token in text and heading and heading not in out:
            out.append(heading)
    return out


def md_sections(text):
    """[(heading in force, line)] for a markdown file: the `#` heading preceding each line."""
    current = None
    items = []
    for line in text.split("\n"):
        m = re.match(r"^#+\s*(.+)$", line)
        if m:
            current = m.group(1).strip()
        items.append((current, line))
    return items


def with_headings(anchors, items):
    for a in anchors:
        a["headings"] = headings_of_token(items, a["token"])
    return anchors


# ---------------------------------------------------------------------------
# per-format entry builders
# ---------------------------------------------------------------------------

def build_pdf_entry(rel_path):
    abs_path = os.path.join(REPO_ROOT, rel_path)
    a = extract_pypdfium(abs_path)
    b = extract_pdfparse(abs_path)

    pages_a = a["pages"]
    pages_b = b.get("pages") if "error" not in b else None

    total_chars_a = sum(len(p["text"]) for p in pages_a)
    total_chars_b = sum(len(p["text"]) for p in (pages_b or []))

    divergences = []
    if pages_b is None:
        divergences.append({"kind": "engine_b_failed", "detail": b.get("error", "unknown")})
    else:
        if b["pageCount"] != a["pageCount"]:
            divergences.append({
                "kind": "page_count_mismatch",
                "engineA": a["pageCount"],
                "engineB": b["pageCount"],
            })
        # Flag large per-document extraction volume differences (>25%): a strong
        # hint of dropped regions or reading-order divergence between engines.
        if total_chars_a and total_chars_b:
            ratio = min(total_chars_a, total_chars_b) / max(total_chars_a, total_chars_b)
            if ratio < 0.75:
                divergences.append({
                    "kind": "text_volume_mismatch",
                    "engineAChars": total_chars_a,
                    "engineBChars": total_chars_b,
                    "ratio": round(ratio, 3),
                })

    has_text_layer = total_chars_a > 20 * max(a["pageCount"], 1)

    entry = {
        "sourceId": rel_path.replace(os.sep, "/"),
        "fileName": os.path.basename(rel_path),
        "fileType": "pdf",
        "role": "corpus",
        # T34 (design D8): a PDF's pages are locations; the eval scores it at page level.
        "paginated": True,
        "pageCount": a["pageCount"],
        "hasTextLayer": has_text_layer,
        "extraction": {
            "engineA": {"name": "pypdfium2", "pageCount": a["pageCount"], "chars": total_chars_a},
            "engineB": {"name": "pdf-parse", "pageCount": b.get("pageCount"), "chars": total_chars_b},
        },
        "perPageChars": [{"page": p["page"], "chars": len(p["text"])} for p in pages_a],
        "expectedMinChunks": max(1, total_chars_a // CHARS_PER_EXPECTED_CHUNK),
        "anchors": pick_anchors(pages_a, pages_b) if has_text_layer else [],
        "termCounts": pick_count_probes(pages_a, pages_b) if has_text_layer else [],
        "divergences": divergences,
    }

    if not has_text_layer:
        entry["notes"] = (
            "No extractable text layer: this document is image-only. Any answer "
            "grounded in it can only come from VLM captioning of rendered pages, "
            "never from text extraction."
        )
    return entry


def build_md_entry(rel_path):
    abs_path = os.path.join(REPO_ROOT, rel_path)
    with open(abs_path, "r", encoding="utf-8") as fh:
        text = fh.read()
    pages = [{"page": 1, "text": text}]
    headings = re.findall(r"^#+\s*(.+)$", text, re.MULTILINE)
    return {
        "sourceId": rel_path.replace(os.sep, "/"),
        "fileName": os.path.basename(rel_path),
        "fileType": "md",
        "role": "corpus",
        # T34 (design D8): a markdown file has no pages (every chunk is stamped page 1) — scored at document level.
        "paginated": False,
        "pageCount": 1,
        "hasTextLayer": True,
        "chars": len(text),
        "lineCount": text.count("\n") + 1,
        "headings": headings[:20],
        "expectedMinChunks": max(1, len(text) // CHARS_PER_EXPECTED_CHUNK),
        "anchors": with_headings(pick_anchors(pages, None), md_sections(text)),
        "termCounts": pick_count_probes(pages, None),
        "divergences": [],
    }


def build_docx_entry(rel_path):
    abs_path = os.path.join(REPO_ROOT, rel_path)
    try:
        import docx
    except ImportError:
        return {"sourceId": rel_path.replace(os.sep, "/"), "fileType": "docx",
                "role": "corpus", "skipped": "python-docx not installed"}

    document = docx.Document(abs_path)
    paragraphs = [p.text for p in document.paragraphs if p.text.strip()]
    headings = [p.text.strip() for p in document.paragraphs
                if p.style is not None and p.style.name and p.style.name.lower().startswith("heading")
                and p.text.strip()]
    table_cells = []
    for t_idx, table in enumerate(document.tables):
        for r_idx, row in enumerate(table.rows):
            for c_idx, cell in enumerate(row.cells):
                if cell.text.strip():
                    table_cells.append({"table": t_idx, "row": r_idx, "col": c_idx,
                                        "value": cell.text.strip()[:120]})
    text = "\n".join(paragraphs + [c["value"] for c in table_cells])
    pages = [{"page": 1, "text": text}]
    return {
        "sourceId": rel_path.replace(os.sep, "/"),
        "fileName": os.path.basename(rel_path),
        "fileType": "docx",
        "role": "corpus",
        # T34 (design D8; F-11): Word has no pages — docling emits one "page 1" — scored at document level.
        "paginated": False,
        "hasTextLayer": True,
        "chars": len(text),
        "paragraphCount": len(paragraphs),
        "headings": headings[:20],
        "tableCount": len(document.tables),
        "tableCellProbes": table_cells[:10],
        "expectedMinChunks": max(1, len(text) // CHARS_PER_EXPECTED_CHUNK),
        "anchors": with_headings(pick_anchors(pages, None), docx_sections(document)),
        "termCounts": pick_count_probes(pages, None),
        "divergences": [],
        "groundTruthEngine": "python-docx (independent of production officeparser/docling)",
    }


def build_pptx_entry(rel_path):
    abs_path = os.path.join(REPO_ROOT, rel_path)
    try:
        from pptx import Presentation
    except ImportError:
        return {"sourceId": rel_path.replace(os.sep, "/"), "fileType": "pptx",
                "role": "corpus", "skipped": "python-pptx not installed"}

    prs = Presentation(abs_path)
    slides = []

    # T40 §12b (b) (2026-09-22, session 43): a text box inside a GROUP shape is text on the slide too — the flat walk
    # read 109 chars of the Tokenomics deck's slide 10 and missed its `$20/month` quote, so the anchor landed on slide
    # 15, the deck's HIDDEN duplicate (docling indexes hidden slides; the manifest reads every slide, as it did).
    # T41 (design D6, F-145): a slide's FOOTER / SLIDE_NUMBER / DATE placeholders are not slide content — the product's
    # bridge removes their lines from the slide's markdown, and the independent engine reads the slide the same way.
    try:
        from pptx.enum.shapes import PP_PLACEHOLDER
        chrome_types = (PP_PLACEHOLDER.FOOTER, PP_PLACEHOLDER.SLIDE_NUMBER, PP_PLACEHOLDER.DATE)
    except ImportError:
        chrome_types = ()

    def is_chrome(shape):
        try:
            return getattr(shape, "is_placeholder", False) and shape.placeholder_format.type in chrome_types
        except Exception:
            return False

    def shape_texts(shapes):
        for shape in shapes:
            if is_chrome(shape):
                continue
            if getattr(shape, "has_text_frame", False) and shape.has_text_frame and shape.text_frame.text.strip():
                yield shape.text_frame.text.strip()
            if getattr(shape, "shape_type", None) is not None and str(shape.shape_type).startswith("GROUP"):
                yield from shape_texts(shape.shapes)

    # T41 (design D7, F-165): a HIDDEN slide (`show="0"`) is not shown to anyone and the product indexes nothing from
    # it since T41 — the manifest reads it as an empty slide that keeps its position (the page number docling gives
    # it) and marks it, so no anchor and no term count can land on it.
    hidden_slides = []
    for idx, slide in enumerate(prs.slides):
        hidden = slide.element.get("show") == "0"
        if hidden:
            hidden_slides.append(idx + 1)
        slides.append({"page": idx + 1, "text": "" if hidden else "\n".join(shape_texts(slide.shapes)), "hidden": hidden})

    total_chars = sum(len(s["text"]) for s in slides)
    return {
        "sourceId": rel_path.replace(os.sep, "/"),
        "fileName": os.path.basename(rel_path),
        "fileType": "pptx",
        "role": "corpus",
        # T34 (design D5, D8): docling paginates a deck by slide — the page IS the slide; scored at page level.
        "paginated": True,
        "hasTextLayer": True,
        "slideCount": len(slides),
        "pageCount": len(slides),
        "chars": total_chars,
        "perSlideChars": [dict({"page": s["page"], "chars": len(s["text"])}, **({"hidden": True} if s["hidden"] else {})) for s in slides],
        "hiddenSlides": hidden_slides,
        "expectedMinChunks": max(1, total_chars // CHARS_PER_EXPECTED_CHUNK),
        "anchors": pick_anchors(slides, None),
        "termCounts": pick_count_probes(slides, None),
        "divergences": [],
        "groundTruthEngine": "python-pptx (independent of production officeparser/docling)",
        "notes": (
            "Slide-level page attribution is the expectation (T34 D5: the page IS the slide, its position in the "
            "file, hidden slides included). T41 (design D7, F-165): a hidden slide is skipped by the product and "
            "read as empty here — marked in perSlideChars and named in hiddenSlides, never anchored. (Audit E02's "
            "'zero chunks for paginated formats' was refuted 2026-08-13 — F-10; T04 closed void.)"
        ),
    }


# ---------------------------------------------------------------------------
# generated fixtures - format gaps the real corpus does not cover
# ---------------------------------------------------------------------------

TEXT_BASIC = """Reconciliation Overview for the QUARTZLINE ledger service.

The QUARTZLINE service performs settlement reconciliation on a nightly cadence.
Reconciliation runs compare the ledger against the clearing file and raise a
break when a difference is detected. Reconciliation is considered complete only
when every break has been assigned an owner.

Exception handling for the service is documented separately. An exception is
raised when the clearing file is absent, malformed, or arrives after the cutoff.
The term BASALTNINE appears exactly once in this document and is used as a
retrieval anchor.
"""

MD_HEADINGS = """# Corporate Standards Handbook

Introductory paragraph describing the handbook scope and intended audience.

## ZEPHYRQUARTZ Control Framework

This section body deliberately does not repeat the heading term. The heading
term appears only in the heading itself, which probes whether heading text is
retained in chunk bodies (audit E10 / ticket T19).

### Nested Operational Detail

Nested content under a third-level heading, used to check that heading ancestry
is preserved in chunk metadata.

## Settlement Windows

Content describing settlement windows and cutoff behaviour for the handbook.
"""

MD_TINY = "# Tiny\n\nOne short line: OBSIDIANFOUR.\n"

UTF8_STRESS = """# UTF-8 Stress — Mixed Script Fixture

Emoji: \U0001F680 \U0001F4C4 ✅ ⚠️
CJK: 文書検索のテストです
RTL Arabic: مرحبا بالعالم
RTL Hebrew: שלום עולם
Smart quotes: “quoted” and ‘single’ and an em—dash
Non-breaking space between these two words.
Combining marks: é à ñ
Anchor token: TOURMALINESIX
"""


def write_generated_fixtures():
    """Create the small fixtures the real corpus cannot supply.

    Deliberately tiny and deterministic. No PDF is generated here: adversarial
    PDF probes are copies of real corpus documents (see copy_adversarial_pdfs).
    """
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    os.makedirs(ADVERSARIAL_DIR, exist_ok=True)
    written = []

    def write_text(path, content):
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(content)
        written.append(os.path.relpath(path, REPO_ROOT))

    write_text(os.path.join(FIXTURES_DIR, "text_basic.txt"), TEXT_BASIC)
    write_text(os.path.join(FIXTURES_DIR, "md_headings.md"), MD_HEADINGS)

    # Single paragraph comfortably larger than 4x the default chunk size (800).
    long_sentence = (
        "The settlement engine records every reconciliation break with an owner, "
        "a due date, and an audit reference so that downstream reporting can "
        "reconstruct the full lifecycle of the break without consulting the "
        "source ledger. "
    )
    repeats = (4 * 800 * 2) // len(long_sentence) + 1
    write_text(
        os.path.join(FIXTURES_DIR, "md_longpara.md"),
        "# Long Paragraph Fixture\n\n" + (long_sentence * repeats).strip() + " GARNETSEVEN\n",
    )

    rows = ["plot_id,design_name,bedrooms,storeys,area_sqft"]
    for i in range(1, 21):
        rows.append(f"P{i:03d},Design{i:02d},{(i % 4) + 2},{(i % 2) + 1},{900 + i * 37}")
    write_text(os.path.join(FIXTURES_DIR, "csv_table.csv"), "\n".join(rows) + "\n")

    # Adversarial edge cases.
    write_text(os.path.join(ADVERSARIAL_DIR, "empty.txt"), "")
    write_text(os.path.join(ADVERSARIAL_DIR, "tiny.md"), MD_TINY)
    write_text(
        os.path.join(ADVERSARIAL_DIR, "huge_line.txt"),
        ("SEPARATORLESS" + "x" * 47) * 1000 + " PERIDOTEIGHT\n",
    )
    write_text(os.path.join(ADVERSARIAL_DIR, "utf8_stress.md"), UTF8_STRESS)
    write_text(
        os.path.join(ADVERSARIAL_DIR, "unsupported.xyz"),
        "This extension is not in allowedFileTypes and must be reported as skipped, "
        "never silently dropped (audit E16). Anchor: SPINELNINE\n",
    )

    # XLSX format gap - generated because the corpus has no spreadsheet.
    try:
        from openpyxl import Workbook

        wb = Workbook()
        s1 = wb.active
        s1.title = "Ledger"
        s1.append(["ref", "description", "amount"])
        s1.append(["L-001", "Opening balance SHEET1_SENTINEL_AMBER", 1000])
        s1.append(["L-002", "Settlement transfer", 250])
        s2 = wb.create_sheet("Exceptions")
        s2.append(["ref", "reason"])
        s2.append(["E-001", "Clearing file late SHEET2_SENTINEL_BASALT"])
        xlsx_path = os.path.join(FIXTURES_DIR, "xlsx_sheets.xlsx")
        wb.save(xlsx_path)
        written.append(os.path.relpath(xlsx_path, REPO_ROOT))
    except ImportError:
        print("  ! openpyxl unavailable - xlsx_sheets.xlsx not regenerated", file=sys.stderr)

    return written


def copy_adversarial_pdfs():
    """Adversarial PDF probes are copies of real corpus documents.

    No PDF is authored. Using real content makes these probes stronger: the
    filename-router probe carries genuine unrelated text, and the version-mix
    probe carries two genuinely different documents under one filename.
    """
    probes = [
        # Filename contains "dpa" but content is unrelated -> exercises the
        # substring-based parser router (audit E12 / ticket T18).
        ("GraemeHick.pdf", os.path.join(ADVERSARIAL_DIR, "misleading_name_dpa.pdf")),
        # Same filename, different content, two directories -> version-mix probe
        # for docHash/supersede behaviour (audit E05 / ticket T06).
        ("GraemeHick.pdf", os.path.join(ADVERSARIAL_DIR, "duplicate_a", "report.pdf")),
        ("FCA_SYSC_June2026.pdf", os.path.join(ADVERSARIAL_DIR, "duplicate_b", "report.pdf")),
    ]
    written = []
    for src_name, dest in probes:
        src_rel = corpus_rel_of(src_name)
        if src_rel is None:
            print(f"  ! corpus file missing, skipping probe: {src_name}", file=sys.stderr)
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(os.path.join(REPO_ROOT, src_rel), dest)
        written.append({
            "path": os.path.relpath(dest, REPO_ROOT).replace(os.sep, "/"),
            "copyOf": src_rel.replace(os.sep, "/"),
        })
    return written


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

BUILDERS = {".pdf": build_pdf_entry, ".md": build_md_entry,
            ".docx": build_docx_entry, ".pptx": build_pptx_entry}


def build_manifest():
    entries = []
    names = sorted({n for rel_dir in CORPUS_RELS if os.path.isdir(os.path.join(REPO_ROOT, rel_dir))
                    for n in os.listdir(os.path.join(REPO_ROOT, rel_dir))})
    for name in names:
        if name.startswith("."):
            continue
        ext = os.path.splitext(name)[1].lower()
        builder = BUILDERS.get(ext)
        rel = corpus_rel_of(name)
        if builder is None:
            entries.append({
                "sourceId": rel.replace(os.sep, "/"),
                "fileName": name,
                "fileType": ext.lstrip("."),
                "role": "corpus",
                "skipped": "no ground-truth builder for this extension",
            })
            continue
        print(f"  deriving {name} ...", file=sys.stderr)
        entries.append(builder(rel))

    generated = write_generated_fixtures()
    adversarial_pdfs = copy_adversarial_pdfs()

    # Ground truth for the generated fixtures is known by construction.
    generated_expectations = [
        {"sourceId": "tests/fixtures/golden/text_basic.txt", "fileType": "txt", "role": "format-gap",
         "anchors": [{"token": "BASALTNINE", "page": 1}],
         "termCounts": [{"token": "reconciliation", "count": 4, "rule": "case-insensitive whole-word"}],
         "expectedMinChunks": 1,
         "notes": "Audit E01: chunk() currently throws on this path (this.buffer unassigned). Ticket T01."},
        {"sourceId": "tests/fixtures/golden/md_headings.md", "fileType": "md", "role": "format-gap",
         "anchors": [{"token": "ZEPHYRQUARTZ", "page": 1}],
         "headingOnlyToken": "ZEPHYRQUARTZ",
         "expectedMinChunks": 1,
         "notes": "Heading-only token probes audit E10 (heading text dropped from chunk bodies). Ticket T19."},
        {"sourceId": "tests/fixtures/golden/md_longpara.md", "fileType": "md", "role": "format-gap",
         "anchors": [{"token": "GARNETSEVEN", "page": 1}],
         "expectedMinChunks": 2,
         "notes": "Single paragraph > 4x default chunkSize; must split rather than emit one oversize chunk."},
        {"sourceId": "tests/fixtures/golden/csv_table.csv", "fileType": "csv", "role": "format-gap",
         "rowCount": 20,
         "anchors": [{"token": "P020", "page": 1}],
         "expectedMinChunks": 1,
         "notes": "Row integrity probe: rows must not be split mid-record. Ticket T02."},
        {"sourceId": "tests/fixtures/golden/xlsx_sheets.xlsx", "fileType": "xlsx", "role": "format-gap",
         "sheetCount": 2,
         "anchors": [{"token": "SHEET1_SENTINEL_AMBER", "sheet": "Ledger"},
                     {"token": "SHEET2_SENTINEL_BASALT", "sheet": "Exceptions"}],
         "expectedMinChunks": 1},
        {"sourceId": "tests/fixtures/golden/adversarial/empty.txt", "fileType": "txt", "role": "adversarial",
         "expectedMinChunks": 0,
         "expectReportedReason": "empty_file",
         "notes": "Must be reported, never silently counted as ingested (audit E16)."},
        {"sourceId": "tests/fixtures/golden/adversarial/tiny.md", "fileType": "md", "role": "adversarial",
         "anchors": [{"token": "OBSIDIANFOUR", "page": 1}],
         "expectedMinChunks": 1,
         "notes": "Below minChunkSize: content must survive via merge, not vanish (audit E09). Ticket T20."},
        {"sourceId": "tests/fixtures/golden/adversarial/huge_line.txt", "fileType": "txt", "role": "adversarial",
         "anchors": [{"token": "PERIDOTEIGHT", "page": 1}],
         "expectedMinChunks": 2,
         "maxSplitSeconds": 2,
         "notes": "Separator-free 60k-char line: exercises the terminal split level of recursiveSplit."},
        {"sourceId": "tests/fixtures/golden/adversarial/utf8_stress.md", "fileType": "md", "role": "adversarial",
         "anchors": [{"token": "TOURMALINESIX", "page": 1}],
         "expectedMinChunks": 1,
         "notes": "Emoji / CJK / RTL / NBSP / combining marks must survive chunking without mojibake."},
        {"sourceId": "tests/fixtures/golden/adversarial/unsupported.xyz", "fileType": "xyz", "role": "adversarial",
         "expectedMinChunks": 0,
         "expectReportedReason": "unsupported_extension",
         "notes": "Audit E16: currently skipped silently while totalFiles still counts it."},
    ]

    for probe in adversarial_pdfs:
        generated_expectations.append({
            "sourceId": probe["path"],
            "fileType": "pdf",
            "role": "adversarial",
            "copyOf": probe["copyOf"],
            "notes": "Real corpus document reused as an adversarial probe; expectations "
                     "are inherited from its copyOf entry.",
        })

    return {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "description": (
            "Golden-corpus ground truth for the NexCODE RAG pipeline. Derived from the "
            "real demo corpus by cross-checking two independent production extractors; "
            "expectations appear here only when both engines agree. Byte-stable: an "
            "unchanged corpus reproduces an identical file."
        ),
        "corpusRoot": CORPUS_REL.replace(os.sep, "/"),
        "generatedBy": "scripts/derive_golden_manifest.py",
        "groundTruthPolicy": {
            "pdf": "pypdfium2 (production primary) cross-checked against pdf-parse (production fallback)",
            "docx": "python-docx, independent of production officeparser/docling",
            "pptx": "python-pptx, independent of production officeparser/docling",
            "generated": "known by construction",
            "expectedMinChunksRule": f"max(1, chars // {CHARS_PER_EXPECTED_CHUNK}) - conservative lower bound",
        },
        "corpus": entries,
        "generatedFixtures": sorted(generated),
        "generatedExpectations": generated_expectations,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true",
                        help="compare against the committed manifest and exit non-zero on drift")
    args = parser.parse_args()

    if not os.path.isdir(CORPUS_DIR):
        print(f"ERROR: corpus directory not found: {CORPUS_DIR}", file=sys.stderr)
        return 2

    print(f"Deriving golden manifest from {CORPUS_REL} ...", file=sys.stderr)
    manifest = build_manifest()
    rendered = json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=False) + "\n"

    if args.check:
        if not os.path.exists(MANIFEST_PATH):
            print("DRIFT: manifest does not exist", file=sys.stderr)
            return 1
        with open(MANIFEST_PATH, "r", encoding="utf-8") as fh:
            current = fh.read()
        if current != rendered:
            print("DRIFT: derived manifest differs from committed manifest", file=sys.stderr)
            return 1
        print("OK: manifest matches corpus", file=sys.stderr)
        return 0

    os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
    with open(MANIFEST_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(rendered)

    corpus_entries = [e for e in manifest["corpus"] if "skipped" not in e]
    divergent = [e for e in corpus_entries if e.get("divergences")]
    no_text = [e for e in corpus_entries if e.get("hasTextLayer") is False]

    print(f"\nWrote {os.path.relpath(MANIFEST_PATH, REPO_ROOT)}", file=sys.stderr)
    print(f"  corpus documents:      {len(corpus_entries)}", file=sys.stderr)
    print(f"  generated fixtures:    {len(manifest['generatedFixtures'])}", file=sys.stderr)
    print(f"  documents w/ engine divergence: {len(divergent)}", file=sys.stderr)
    for e in divergent:
        kinds = ", ".join(d["kind"] for d in e["divergences"])
        print(f"      - {e['fileName']}: {kinds}", file=sys.stderr)
    print(f"  documents w/o text layer:       {len(no_text)}", file=sys.stderr)
    for e in no_text:
        print(f"      - {e['fileName']} ({e.get('pageCount')} pages)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
