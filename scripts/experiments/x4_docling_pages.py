#!/usr/bin/env python3
"""X4 v3 — production-faithful with an RSS self-watchdog.

Earlier attempts were invalidated by the guard, not the subject:
  v1: bare DocumentConverter() (OCR on) -> cgroup OOM, container restart
  v2: ulimit -v 1.6G -> MemoryError importing numpy at 379MB RSS (virtual != RSS)

This version caps RSS the same way the cgroup does, and self-exits *before*
the container limit is threatened, so the app is never at risk.
"""
import json
import os
import sys
import threading
import time
import traceback

RSS_BUDGET_MB = float(os.environ.get("X4_RSS_BUDGET_MB", "1100"))
_peak = {"mb": 0.0}


def rss_mb():
    try:
        with open("/proc/self/status") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024.0
    except Exception:
        pass
    return 0.0


def watchdog():
    while True:
        cur = rss_mb()
        if cur > _peak["mb"]:
            _peak["mb"] = cur
        if cur > RSS_BUDGET_MB:
            sys.stderr.write(f"[x4] WATCHDOG tripped at {cur:.0f}MB > {RSS_BUDGET_MB}MB\n")
            sys.stderr.flush()
            print(json.dumps({
                "file": os.path.basename(sys.argv[1]),
                "watchdogTripped": True,
                "rssAtTripMB": round(cur, 1),
                "budgetMB": RSS_BUDGET_MB,
            }))
            sys.stdout.flush()
            os._exit(9)
        time.sleep(0.15)


def main(path):
    out = {"file": os.path.basename(path), "ext": path.rsplit(".", 1)[-1].lower()}
    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions

        # Mirror docling_bridge.py:66-76 exactly.
        po = PdfPipelineOptions()
        po.do_ocr = False
        po.do_table_structure = True
        po.generate_picture_images = True
        po.images_scale = 1.0
        conv = DocumentConverter(format_options={"pdf": PdfFormatOption(pipeline_options=po)})

        result = conv.convert(path, raises_on_error=False)
        out["status"] = str(getattr(result, "status", None))
        out["errors"] = [str(e)[:400] for e in (getattr(result, "errors", None) or [])]

        doc = getattr(result, "document", None)
        if doc is None:
            out["document"] = None
        else:
            pages = getattr(doc, "pages", None)
            out["pagesAttrPresent"] = pages is not None
            out["pagesPopulated"] = bool(pages)
            out["pagesCount"] = len(pages) if pages else 0

            per_page = []
            if pages:
                for page in pages.values():
                    e = {"page": page.page_no}
                    try:
                        md = doc.export_to_markdown(page_no=page.page_no)
                        e["len"] = len(md)
                        e["sample"] = md[:60].replace("\n", " ")
                    except Exception as ex:
                        e["len"] = None
                        e["error"] = f"{type(ex).__name__}: {ex}"[:160]
                    per_page.append(e)
            out["perPageExport"] = per_page[:60]
            out["emptyPages"] = sum(1 for p in per_page if p.get("len") == 0)
            out["erroredPages"] = sum(1 for p in per_page if p.get("len") is None)

            try:
                full = doc.export_to_markdown()
                out["fullExportLen"] = len(full)
                out["fullExportSample"] = full[:150].replace("\n", " ")
            except Exception as ex:
                out["fullExportLen"] = None
                out["fullExportError"] = f"{type(ex).__name__}: {ex}"[:160]

            out["textsCount"] = len(getattr(doc, "texts", []) or [])
            out["tablesCount"] = len(getattr(doc, "tables", []) or [])
            out["picturesCount"] = len(getattr(doc, "pictures", []) or [])
    except Exception as ex:
        out["fatal"] = f"{type(ex).__name__}: {ex}"[:300]
        out["trace"] = traceback.format_exc()[-700:]

    out["peakRssMB"] = round(max(_peak["mb"], rss_mb()), 1)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    threading.Thread(target=watchdog, daemon=True).start()
    main(sys.argv[1])
