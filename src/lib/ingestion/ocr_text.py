#!/usr/bin/env python3
"""
OCR for pages without a text layer — ticket T35 (the multi-modal workshop charter's D14; design
inputs/rag-audit/t35-design.md D2, D4, D5, D6, D9, D10). The PURE part of the Python half: the trigger, the thread
count from the container's CPU quota (F-148), the engine's parameters, the reading order (the design probe's rule,
t35-artifacts/probes/ocr_probe.py), the page-entry fields and the engine label. No docling, no rapidocr, no numpy
import here — the bridge (docling_bridge.py) does the I/O: it renders the page, constructs RapidOCR with
engine_params(), calls it, and hands the boxes / texts / scores to reading_order(). ocr.js holds the JS half (the
mode vocabulary, the timeout rule, the chunk marker); U-OCR pins the two halves' shared constants equal.

Runnable without the image:
  python3 ocr_text.py --self-test                       a JSON verdict on stdout, exit 0 / 1 (U-OCR spawns it)
  python3 ocr_text.py --reading-order <boxes.json>      the lines for a recorded set of boxes (the probe's fixture)
  python3 ocr_text.py --threads [<cgroup root>]         the thread count this container would pin
"""
import json
import math
import os
import sys

OCR_MODES = ("auto", "off")
OCR_DEFAULT = "auto"
# D5: the render OCR reads — 2.0 keeps an A4 page under rapidocr's 2000-px max_side_len (F-149). ocr.js's OCR_SCALE
# is the same number (U-OCR pins them equal).
OCR_SCALE = 2.0
# rapidocr's own default detection / recognition threshold, stated so the ledger's engine label can name it.
OCR_TEXT_SCORE = 0.5
# F-148: the engine's default intra-op thread count is every core the NODE shows (128 here, 382 threads in the
# process) against a container quota of 2 — 30–45× slower on the probe. The pin is the quota; 2 when it cannot be read.
DEFAULT_THREADS = 2
MAX_THREADS = 8


def normalise_mode(value):
    """The mode as the loader, the parser and the fingerprint read it: a listed value, else the default."""
    if not isinstance(value, str):
        return OCR_DEFAULT
    v = value.strip().lower()
    return v if v in OCR_MODES else OCR_DEFAULT


def has_text_layer(text):
    """T32 D2's rule, the same one parser.js's pageHasTextLayer applies: at least one non-blank character."""
    return isinstance(text, str) and text.strip() != ""


def page_needs_ocr(text, mode=OCR_DEFAULT):
    """D2: ONE page, an EMPTY text layer, under mode auto. Never a threshold, never a corpus-wide decision."""
    return normalise_mode(mode) == "auto" and not has_text_layer(text)


def _read(path):
    with open(path) as f:
        return f.read()


def cpu_quota_threads(root="/sys/fs/cgroup", default=DEFAULT_THREADS, read=_read):
    """The intra-op thread count for the OCR engine: the container's CPU quota, rounded up, at least 1, at most
    MAX_THREADS; the default when no quota can be read (cgroup v2 `cpu.max` = "<quota> <period>" or "max <period>";
    cgroup v1 `cpu/cpu.cfs_quota_us` (-1 = unlimited) with `cpu/cpu.cfs_period_us`)."""
    candidates = [
        (os.path.join(root, "cpu.max"), None),
        (os.path.join(root, "cpu", "cpu.cfs_quota_us"), os.path.join(root, "cpu", "cpu.cfs_period_us")),
        (os.path.join(root, "cpu,cpuacct", "cpu.cfs_quota_us"), os.path.join(root, "cpu,cpuacct", "cpu.cfs_period_us")),
    ]
    for quota_path, period_path in candidates:
        try:
            raw = read(quota_path).strip()
        except Exception:
            continue
        try:
            if period_path is None:
                quota_s, period_s = raw.split()[:2]
            else:
                quota_s, period_s = raw, read(period_path).strip()
            if quota_s == "max" or int(quota_s) <= 0:
                return default
            quota, period = int(quota_s), int(period_s)
            if period <= 0:
                return default
            return max(1, min(MAX_THREADS, math.ceil(quota / period)))
        except Exception:
            continue
    return default


def engine_params(threads):
    """RapidOCR's constructor params for the bridge (D4): CPU, the threads pinned, the bundled models, quiet logs."""
    t = int(threads) if isinstance(threads, int) and threads > 0 else DEFAULT_THREADS
    return {
        "Global.log_level": "warning",
        "Global.text_score": OCR_TEXT_SCORE,
        "EngineConfig.onnxruntime.intra_op_num_threads": t,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    }


def reading_order(boxes, txts, scores):
    """The probe's rule (t35-design §0a): boxes grouped into rows by the vertical band of a row's members (a box
    whose centre falls inside the row's running mean extent joins it), rows top to bottom, boxes left to right; a
    row's texts joined by one space. Each line: text, boxes (count), minScore, y (the row's centre)."""
    items = []
    for b, t, s in zip(boxes or [], txts or [], scores or []):
        xs = [float(p[0]) for p in b]
        ys = [float(p[1]) for p in b]
        items.append({"x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys), "text": str(t), "score": float(s)})
    items.sort(key=lambda it: ((it["y0"] + it["y1"]) / 2, it["x0"]))
    rows = []
    for it in items:
        yc = (it["y0"] + it["y1"]) / 2
        placed = False
        for row in rows:
            ry0 = sum(m["y0"] for m in row) / len(row)
            ry1 = sum(m["y1"] for m in row) / len(row)
            if ry0 <= yc <= ry1:
                row.append(it)
                placed = True
                break
        if not placed:
            rows.append([it])
    rows.sort(key=lambda row: sum((m["y0"] + m["y1"]) / 2 for m in row) / len(row))
    lines = []
    for row in rows:
        row.sort(key=lambda m: m["x0"])
        text = " ".join(m["text"].strip() for m in row if m["text"].strip())
        if not text:
            continue
        lines.append({"text": text, "boxes": len(row), "minScore": round(min(m["score"] for m in row), 3), "y": round(sum((m["y0"] + m["y1"]) / 2 for m in row) / len(row), 1)})
    return lines


def lines_text(lines):
    """The page's text: one OCR line per line, in reading order."""
    return "\n".join(l["text"] for l in lines)


def page_ocr_entry(lines, boxes_n, ms, score_min):
    """The fields a bridge page entry carries when OCR read it (D10): the parser marks the chunks, the trace counts."""
    text = lines_text(lines)
    return {"ocr": True, "ocrChars": len(text), "ocrLines": len(lines), "ocrBoxes": int(boxes_n), "ocrMs": int(round(ms)), "ocrScoreMin": (round(float(score_min), 3) if score_min is not None else None)}


def engine_label(rapidocr_version, onnxruntime_version, model_md5s, threads):
    """What the ledger records as `ocrEngine` (D9): a model or engine change is a rule change and a version bump."""
    models = ", ".join(f"{name} {md5[:8]}" for name, md5 in sorted((model_md5s or {}).items()))
    return f"rapidocr {rapidocr_version} / onnxruntime {onnxruntime_version} / models {models or 'none'} / threads {threads} / scale {OCR_SCALE} / text_score {OCR_TEXT_SCORE}"


def self_test():
    """Pure, offline; the verdict U-OCR reads. Every case is a rule the design states."""
    checks = {}
    # The trigger (D2).
    checks["needsOcrEmpty"] = page_needs_ocr("", "auto") is True and page_needs_ocr("  \n\t", "auto") is True
    checks["needsOcrText"] = page_needs_ocr("a", "auto") is False and page_needs_ocr("Page 1", "AUTO") is False
    checks["needsOcrOff"] = page_needs_ocr("", "off") is False and page_needs_ocr("", "OFF ") is False
    checks["modeNormalised"] = normalise_mode(" Off ") == "off" and normalise_mode("sometimes") == "auto" and normalise_mode(None) == "auto"
    # The thread pin (F-148) on the two cgroup layouts, unlimited, unreadable.
    v2 = {"/cg/cpu.max": "200000 100000\n"}
    v2max = {"/cg/cpu.max": "max 100000\n"}
    v1 = {"/cg/cpu/cpu.cfs_quota_us": "150000\n", "/cg/cpu/cpu.cfs_period_us": "100000\n"}
    v1u = {"/cg/cpu/cpu.cfs_quota_us": "-1\n", "/cg/cpu/cpu.cfs_period_us": "100000\n"}
    big = {"/cg/cpu.max": "6400000 100000\n"}
    def reader(table):
        def r(p):
            if p in table:
                return table[p]
            raise FileNotFoundError(p)
        return r
    checks["threadsV2"] = cpu_quota_threads("/cg", read=reader(v2)) == 2
    checks["threadsV2Max"] = cpu_quota_threads("/cg", read=reader(v2max)) == DEFAULT_THREADS
    checks["threadsV1"] = cpu_quota_threads("/cg", read=reader(v1)) == 2
    checks["threadsV1Unlimited"] = cpu_quota_threads("/cg", read=reader(v1u)) == DEFAULT_THREADS
    checks["threadsUnreadable"] = cpu_quota_threads("/cg", read=reader({})) == DEFAULT_THREADS
    checks["threadsCapped"] = cpu_quota_threads("/cg", read=reader(big)) == MAX_THREADS
    checks["params"] = engine_params(2)["EngineConfig.onnxruntime.intra_op_num_threads"] == 2 and engine_params(0)["EngineConfig.onnxruntime.intra_op_num_threads"] == DEFAULT_THREADS and engine_params(2)["EngineConfig.onnxruntime.inter_op_num_threads"] == 1
    # The reading order: detection order scrambled, a two-box row, a tall box, a box out of order; blanks dropped.
    boxes = [
        [[10, 50], [90, 50], [90, 70], [10, 70]],      # row 2, left
        [[120, 12], [200, 12], [200, 32], [120, 32]],  # row 1, right
        [[10, 10], [100, 10], [100, 30], [10, 30]],    # row 1, left
        [[10, 100], [300, 96], [300, 140], [10, 140]], # row 3, tall
        [[320, 110], [400, 110], [400, 130], [320, 130]],  # row 3, right (its centre inside the tall box's band)
        [[10, 200], [50, 200], [50, 220], [10, 220]],  # row 4, blank text
    ]
    txts = ["Dining Room", "4628 x 4605mm", "Kitchen/Family", "KEY", "Light fitting", "   "]
    scores = [0.9, 0.95, 0.99, 0.8, 0.7, 0.5]
    lines = reading_order(boxes, txts, scores)
    checks["readingOrder"] = [l["text"] for l in lines] == ["Kitchen/Family 4628 x 4605mm", "Dining Room", "KEY Light fitting"]
    checks["readingOrderCounts"] = [l["boxes"] for l in lines] == [2, 1, 2] and lines[0]["minScore"] == 0.95 and lines[2]["minScore"] == 0.7
    checks["readingOrderEmpty"] = reading_order([], [], []) == [] and reading_order(None, None, None) == []
    entry = page_ocr_entry(lines, 6, 2249.6, 0.58)
    checks["pageEntry"] = entry == {"ocr": True, "ocrChars": len("Kitchen/Family 4628 x 4605mm\nDining Room\nKEY Light fitting"), "ocrLines": 3, "ocrBoxes": 6, "ocrMs": 2250, "ocrScoreMin": 0.58}
    checks["label"] = engine_label("3.9.2", "1.30.0", {"det": "0123456789abcdef", "rec": "fedcba9876543210"}, 2) == "rapidocr 3.9.2 / onnxruntime 1.30.0 / models det 01234567, rec fedcba98 / threads 2 / scale 2.0 / text_score 0.5"
    return {"ok": all(checks.values()), "checks": checks, "OCR_SCALE": OCR_SCALE, "OCR_MODES": list(OCR_MODES), "OCR_DEFAULT": OCR_DEFAULT, "DEFAULT_THREADS": DEFAULT_THREADS}


if __name__ == "__main__":
    argv = sys.argv[1:]
    if "--self-test" in argv:
        verdict = self_test()
        print(json.dumps(verdict))
        sys.exit(0 if verdict["ok"] else 1)
    if "--reading-order" in argv:
        spec = json.load(open(argv[argv.index("--reading-order") + 1]))
        print(json.dumps(reading_order(spec["boxes"], spec["txts"], spec["scores"])))
        sys.exit(0)
    if "--threads" in argv:
        i = argv.index("--threads")
        root = argv[i + 1] if len(argv) > i + 1 else "/sys/fs/cgroup"
        print(json.dumps({"threads": cpu_quota_threads(root), "root": root}))
        sys.exit(0)
    print(__doc__)
    sys.exit(2)
