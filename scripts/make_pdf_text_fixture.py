#!/usr/bin/env python3
"""Generate tests/fixtures/golden/pdf_text.pdf (evaluation-plan §1).

The evaluation plan's fixture layout specifies:

    pdf_text.pdf              # generated: 3 pages, page-unique sentinel per page

but the fixture was never generated — T00's corpus used the real demo
documents instead. Ticket T13's acceptance criterion ("ingesting pdf_text.pdf
shows PYPDFIUM2 TEXT badge data in trace JSON") is the first to need it, so
this script produces it: a dependency-free, deterministic, minimal 3-page PDF
with a real text layer (Helvetica, one sentinel plus filler per page).

Deterministic on purpose: no timestamps, no randomness — the same bytes on
every run, so the committed fixture and a regenerated one always agree.

Usage:  python3 scripts/make_pdf_text_fixture.py
"""

import os

OUT = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "golden", "pdf_text.pdf")

SENTINELS = ["PDFTEXT_SENTINEL_P1_KZXQ", "PDFTEXT_SENTINEL_P2_VWYM", "PDFTEXT_SENTINEL_P3_HJRN"]

PAGE_LINES = [
    [
        "pdf_text.pdf - generated golden fixture, page 1 of 3.",
        "This page carries the page-unique sentinel {s}.",
        "The text layer is real: pypdfium2 must extract every line here",
        "without OCR, captioning, or a layout model.",
    ],
    [
        "pdf_text.pdf - generated golden fixture, page 2 of 3.",
        "This page carries the page-unique sentinel {s}.",
        "Page attribution must survive chunking: a retrieval hit for the",
        "sentinel above must cite page 2 and only page 2.",
    ],
    [
        "pdf_text.pdf - generated golden fixture, page 3 of 3.",
        "This page carries the page-unique sentinel {s}.",
        "End of fixture. Three pages, three sentinels, no images.",
    ],
]


def esc(text):
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def content_stream(lines, sentinel):
    ops = ["BT", "/F1 12 Tf", "14 TL", "72 720 Td"]
    for line in lines:
        ops.append("(%s) Tj T*" % esc(line.format(s=sentinel)))
    ops.append("ET")
    return "\n".join(ops).encode("latin-1")


def build():
    # Objects: 1 catalog, 2 pages, 3-5 page, 6-8 contents, 9 font.
    objects = {}
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>"
    for i in range(3):
        objects[3 + i] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            "/Resources << /Font << /F1 9 0 R >> >> /Contents %d 0 R >>" % (6 + i)
        ).encode("latin-1")
    for i in range(3):
        stream = content_stream(PAGE_LINES[i], SENTINELS[i])
        objects[6 + i] = (
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
        )
    objects[9] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    out = bytearray()
    out += b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += b"%d 0 obj\n" % num + objects[num] + b"\nendobj\n"

    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for num in sorted(objects):
        out += ("%010d 00000 n \n" % offsets[num]).encode("latin-1")
    out += (
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, xref_at)
    )
    return bytes(out)


if __name__ == "__main__":
    data = build()
    path = os.path.normpath(OUT)
    with open(path, "wb") as f:
        f.write(data)
    print("wrote %s (%d bytes, %d pages, sentinels: %s)" % (path, len(data), 3, ", ".join(SENTINELS)))
