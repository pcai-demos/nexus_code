"""
T57 (design `inputs/rag-audit/t57-design.md` §2.1, D3, D5; F-215): the COLOUR LAYER of one PDF page — what the detail
pass's colour check (colour_check.js) reads beside the tiles' merge. Imported by docling_bridge.py's `--colours` mode
only, so no other mode loads numpy for it.

For one pypdfium2 page:
  - words:  the bridge's own text_word_boxes (T45 — passed in, never re-implemented), each with its font SIZE: the
            largest pdfium font size among its characters (the Site Plan's plot label 3.33 pt, its parking-bay repeats
            2.22 pt — the colour check places a label at its largest occurrence).
  - paths:  EVERY filled path on the page — the exact fill (r, g, b), the box and the outline (a move-to starts a new
            ring), in points from the page's TOP-left; a path inside a form XObject is placed by the form's matrix
            composed with its own (Miele and SSX125 draw most paths inside forms).
  - pixels: for a building drawn in an image (no path): the page rendered at the tiles' scale (3.5) in memory, and for
            every word, the pixels of a window around it (its box widened by MARGIN_PT) counted per distinct path fill
            they match within TOL on every channel — the counts only, never the image.
Nothing is written (no render file, no crop, no memo entry). Deterministic for the PDF's bytes, pypdfium2's version
(5.12.1 in the image) and the render. The design probe's layer57.py is this module's prototype; the ticket's first live
pass compares the two on the Site Plan's page 1. A cap is named, never silent: more than MAX_PATHS filled paths → no
paths (no check on the page); more than MAX_FILLS distinct fills → no pixel counts (the vector evidence only).
"""
import ctypes
import time

SCALE = 3.5          # the detail tiles' render scale (detail_pass.js DETAIL_RENDER_SCALE) — the whole-page render
MARGIN_PT = 3.0      # D3: the pixel window — a word's box widened by this on every side
TOL = 12             # D3: a pixel matches a fill when every channel is within this
MAX_FILLS = 64       # more distinct fills than this: no pixel counts (a photo-like page)
MAX_PATHS = 20000    # more filled paths than this: no paths (the reply would be too large to be a plan's)


def _mat_mul(a, b):
    """(a then b) for PDF matrices (a, b, c, d, e, f): x' = a x + c y + e, y' = b x + d y + f."""
    return (a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5])


def _obj_matrix(raw, handle):
    m = raw.FS_MATRIX()
    if not raw.FPDFPageObj_GetMatrix(handle, m):
        return (1, 0, 0, 1, 0, 0)
    return (m.a, m.b, m.c, m.d, m.e, m.f)


def _fill_of(raw, handle):
    r, g, b, a = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
    return (r.value, g.value, b.value) if raw.FPDFPageObj_GetFillColor(handle, r, g, b, a) else None


def _walk(raw, handles, parent, out, height):
    """Every object, recursing into forms with the composed matrix; each filled path into `out`."""
    for h in handles:
        t = raw.FPDFPageObj_GetType(h)
        m = _mat_mul(_obj_matrix(raw, h), parent)
        if t == raw.FPDF_PAGEOBJ_FORM:
            n = raw.FPDFFormObj_CountObjects(h)
            _walk(raw, (raw.FPDFFormObj_GetObject(h, i) for i in range(n)), m, out, height)
            continue
        if t != raw.FPDF_PAGEOBJ_PATH:
            continue
        fm, st = ctypes.c_int(), ctypes.c_int()
        raw.FPDFPath_GetDrawMode(h, fm, st)
        if fm.value == 0:
            continue
        rgb = _fill_of(raw, h)
        if rgb is None:
            continue
        rings, cur = [], []
        for i in range(raw.FPDFPath_CountSegments(h)):
            seg = raw.FPDFPath_GetPathSegment(h, i)
            x, y = ctypes.c_float(), ctypes.c_float()
            raw.FPDFPathSegment_GetPoint(seg, x, y)
            px = m[0] * x.value + m[2] * y.value + m[4]
            py = m[1] * x.value + m[3] * y.value + m[5]
            if raw.FPDFPathSegment_GetType(seg) == raw.FPDF_SEGMENT_MOVETO and cur:
                rings.append(cur)
                cur = []
            cur.append([round(px, 3), round(height - py, 3)])
        if cur:
            rings.append(cur)
        pts = [p for r in rings for p in r]
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        out.append({"rgb": list(rgb), "bbox": [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)], "rings": rings})


def filled_paths(page):
    """Every filled path of the page, forms included (see the module's docstring)."""
    import pypdfium2.raw as raw
    _, height = page.get_size()
    out = []
    n = raw.FPDFPage_CountObjects(page.raw)
    _walk(raw, (raw.FPDFPage_GetObject(page.raw, i) for i in range(n)), (1, 0, 0, 1, 0, 0), out, height)
    return out


def word_sizes(page, words):
    """The largest pdfium font size among each word's characters — text_word_boxes' own segmentation walked again, so
    the i-th size is the i-th word's. Raises when the two walks disagree (never guess an alignment)."""
    import pypdfium2.raw as raw
    tp = page.get_textpage()
    n = tp.count_chars()
    if n <= 0:
        return []
    text = tp.get_text_range(0, n)
    chars = list(text) if len(text) == n else [tp.get_text_range(k, 1) for k in range(n)]
    sizes = []
    i = 0
    while i < n:
        if chars[i].isspace() or chars[i] == "":
            i += 1
            continue
        j = i
        while j < n and not chars[j].isspace() and chars[j] != "":
            j += 1
        sizes.append(round(max(raw.FPDFText_GetFontSize(tp.raw, k) for k in range(i, j)), 3))
        i = j
    if len(sizes) != len(words):
        raise ValueError(f"word sizes: {len(sizes)} sizes for {len(words)} words")
    return sizes


def pixel_counts(page, words, fills, scale=SCALE, margin_pt=MARGIN_PT, tol=TOL):
    """For every word: the pixels of its window (the box widened by margin_pt) at `scale`, counted per fill they match
    within `tol` on every channel — [{ w: word index, n: pixels in the window, counts: { fill index: count } }]."""
    import numpy as np
    img = np.asarray(page.render(scale=scale).to_pil().convert("RGB"), dtype=np.int16)
    ref = np.array(fills, dtype=np.int16)
    per = []
    for k, w in enumerate(words):
        x0 = max(0, int((w["x0"] - margin_pt) * scale))
        x1 = min(img.shape[1], int(round((w["x1"] + margin_pt) * scale)))
        y0 = max(0, int((w["y0"] - margin_pt) * scale))
        y1 = min(img.shape[0], int(round((w["y1"] + margin_pt) * scale)))
        win = img[y0:y1, x0:x1].reshape(-1, 3)
        if win.size == 0:
            continue
        hit = np.abs(win[:, None, :] - ref[None, :, :]).max(axis=2) <= tol
        counts = hit.sum(axis=0)
        per.append({"w": k, "n": int(win.shape[0]), "counts": {str(i): int(c) for i, c in enumerate(counts) if c > 0}})
    return per


def read_layer(page, text_word_boxes):
    """The page's colour layer (the module's docstring): { words, paths, pixels, capped, ms }. `text_word_boxes` is the
    bridge's own function (T45), passed in so the words are exactly the tiles mode's `textBoxes`."""
    t0 = time.time()
    words = text_word_boxes(page)
    for w, s in zip(words, word_sizes(page, words)):
        w["size"] = s
    paths = filled_paths(page)
    capped = None
    if len(paths) > MAX_PATHS:
        capped = f"paths: {len(paths)} filled paths > {MAX_PATHS} — none returned, the page is not checked"
        paths = []
    t1 = time.time()
    fills = sorted({tuple(p["rgb"]) for p in paths})
    pixels = None
    if words and 0 < len(fills) <= MAX_FILLS:
        pixels = {"scale": SCALE, "marginPt": MARGIN_PT, "tol": TOL, "fills": [list(f) for f in fills], "words": pixel_counts(page, words, fills)}
    elif len(fills) > MAX_FILLS:
        capped = (capped + "; " if capped else "") + f"pixels: {len(fills)} distinct fills > {MAX_FILLS} — the vector evidence only"
    t2 = time.time()
    return {"words": words, "paths": paths, "pixels": pixels, "capped": capped, "ms": {"vector": round((t1 - t0) * 1000), "pixels": round((t2 - t1) * 1000)}}
