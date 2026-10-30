"""The pixel geometry of a dimensioned drawing — ticket T46's geometry step (design `inputs/rag-audit/t46-design.md`
§0i, §9b D14 (a), D15; §12d). Read by the bridge's `--geometry <page>` mode (`docling_bridge.py`), never by anything
else; no model call, no file written, nothing under the crops folder touched.

The rules are the D13 (b) probe's v2 BYTE FOR BYTE (`tests/eval/baselines/t46-artifacts/probes/raster_geometry.py`,
md5 5d0f195c…): every function from the constants to `analyse_region` is copied unchanged, but for `analyse_region`
taking the region's OCR places ready-read (the OCR reads the grey render, so both ink settings share one read — the
probe read it once per setting). What changed around them: this header; no `sys.path` edit (the bridge runs from this
directory, where `ocr_text` lives); `read_page` in place of the probe's command line; a compact output (the claims
and the crosshairs, not every line's detail). The in-pod geometry suite (`t46-artifacts/geometry_suite.js`) holds the
shipped module to the probe's records claim for claim on the eight truth pages.

What it reads (the probe's header, §0i): the page rendered in memory with pypdfium2 at `scale` (T46 pins 4.0 — the
product's 2.0 render loses the crosshairs); per drawing region (an image object of at least 5000 pt^2 widened by 25 pt,
or — a vector page — the largest block of ink): INK below the threshold (T46 reads 200, and 128 as the cross-check —
`dimension_chain.js` settles a line only when both agree); LINES along each axis (dash-dot read by local contrast);
POINTS — crosshairs (two solid lines crossing through a ring of ink), lettered A, B, C … left to right, then top to
bottom (the chain prompt's own rule); LABELS by RapidOCR (threads pinned to the container's quota — F-148) at 0 deg and
turned both ways; one CLAIM per dimension label — its carrier line, its terminals, its span in page points, or a reason
it is not derivable. What it may not do is decide anything: `dimension_chain.js` `settleChain` applies a claim only
under D14 (a)'s four guards.
"""
import copy
import hashlib
import math
import os
import re
import time

import numpy as np
import cv2
import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw

with open(os.path.abspath(__file__), "rb") as _f:
    MODULE_MD5 = hashlib.md5(_f.read()).hexdigest()

# ---- the rule's constants (page points) ----
MIN_IMAGE_AREA = 5000.0      # an image object at least this large is a drawing region
REGION_MARGIN = 25.0         # v2: the region is the image object widened by this (the annotations drawn around it)
CLOSE_GAP = 2.5              # gaps up to this are closed along a line (a dash-dot line is one line)
MIN_LINE = 4.0               # a line is a run at least this long
MAX_THICK = 3.0              # thicker than this is a filled shape, not a line
STUB = 3.0                   # a run this short at a line's end, cut off by a gap, is not the line's own
GAP_MIN = 0.4                # a break in a line at least this long, inside it (never at its ends), is a gap
GAP_CONTRAST = 50            # ... a break = the line's grey rises this far above its LOCAL tone (the 30th percentile
GAP_LOCAL = 4.0              #     within this distance): a faint dash gap counts, a line fading along its length does not
DASH_GAPS = 3                # a line with at least this many gaps is dash-dot; one with 1-2 is split into collinear lines
DASH_WINDOW = 6.0            # dash-dot is read locally: a gap within this distance of the point
ARM = 2.0                    # a crosshair's lines run at least this far past the crossing
RING = (2.0, 8.0, 0.25)      # the crosshair ring's radius range
RING_FILL = 0.70             # the share of the ring that must be ink
TOUCH = 0.6                  # a perpendicular line reaching within this of the carrier touches it
NEAR = 1.8                   # ... and one that misses by up to this is a near miss (not derivable)
END_ZONE = 1.5               # "at the carrier's end" (a dash-dot terminal is only counted here)
FRAME_TOL = 2.5              # a line this close to the region's border, spanning most of it, is the frame
LABEL_GAP = 1.5              # a carrier within this many label-heights of the label (at least 3 pt)
MIDDLE = (0.2, 0.8)          # the label's centre in this part of its sub-segment
CLEAR = (0.5, 1.0)           # a carrier is clearly nearest when the next is farther by max(0.5 x gap, 1 pt)
ARROW_LEN = 4.0              # an arrowhead is looked for within this of a line's end
ARROW_WIDE = 2.2             # ... ink this many times the line's thickness across it
LABEL_SCORE_MIN = 0.9        # an OCR reading below this is not a dimension label (a read of an arrowhead as "4")


def render(pdf_path, page_no, scale):
    pdf = pdfium.PdfDocument(pdf_path)
    page = pdf[page_no - 1]
    w, h = page.get_size()
    img = page.render(scale=scale).to_pil().convert("L")
    return pdf, page, (w, h), np.array(img)


def image_regions(page, size):
    w, h = size
    out = []
    for obj in page.get_objects():
        if obj.type != pdfium_raw.FPDF_PAGEOBJ_IMAGE:
            continue
        l, b, r, t = obj.get_bounds()
        box = [max(0.0, l), max(0.0, h - t), min(w, r), min(h, h - b)]
        if (box[2] - box[0]) * (box[3] - box[1]) >= MIN_IMAGE_AREA:
            try:
                px = list(obj.get_px_size())
            except Exception:
                px = None
            wide = [max(0.0, box[0] - REGION_MARGIN), max(0.0, box[1] - REGION_MARGIN), min(w, box[2] + REGION_MARGIN), min(h, box[3] + REGION_MARGIN)]
            out.append({"kind": "image object (widened by %.0f pt)" % REGION_MARGIN, "bounds": [round(v, 2) for v in wide], "frame": [round(v, 2) for v in box], "nativePx": px})
    # overlapping widened regions merge (a label is read once)
    merged = True
    while merged:
        merged = False
        for i in range(len(out)):
            for j in range(i + 1, len(out)):
                a, b = out[i]["bounds"], out[j]["bounds"]
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    out[i] = {"kind": "image objects (widened, merged)", "bounds": [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])], "frame": None, "nativePx": None, "frames": [f for f in (out[i].get("frame"), out[j].get("frame")) if f] + out[i].get("frames", []) + out[j].get("frames", [])}
                    del out[j]
                    merged = True
                    break
            if merged:
                break
    return out


def vector_region(gray, ink, scale, size):
    """No image object: the largest connected block of ink (strokes joined by a 2 pt dilation) of at least 3% of the page."""
    mask = (gray < ink).astype(np.uint8)
    k = max(1, int(round(2.0 * scale)))
    dil = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(dil, connectivity=8)
    best = None
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if bw * bh < 0.03 * gray.shape[0] * gray.shape[1]:
            continue
        if best is None or bw * bh > best[2] * best[3]:
            best = (x, y, bw, bh)
    if best is None:
        return []
    x, y, bw, bh = best
    bb = [round(x / scale, 2), round(y / scale, 2), round((x + bw) / scale, 2), round((y + bh) / scale, 2)]
    return [{"kind": "largest ink block (a vector drawing)", "bounds": bb, "frame": bb, "nativePx": None}]


def page_words(page):
    """The page's text layer word by word (docling_bridge.text_word_boxes' rule), points from the top-left."""
    tp = page.get_textpage()
    n = tp.count_chars()
    if n <= 0:
        return [], ""
    text = tp.get_text_range(0, n)
    chars = list(text) if len(text) == n else [tp.get_text_range(k, 1) for k in range(n)]
    _, h = page.get_size()
    words = []
    i = 0
    while i < n:
        if chars[i].isspace() or chars[i] == "":
            i += 1
            continue
        j = i
        while j < n and not chars[j].isspace() and chars[j] != "":
            j += 1
        bx = [tp.get_charbox(k) for k in range(i, j)]
        words.append({"text": "".join(chars[i:j]), "x0": min(b[0] for b in bx), "y0": h - max(b[3] for b in bx), "x1": max(b[2] for b in bx), "y1": h - min(b[1] for b in bx)})
        i = j
    return words, text


def legend_of(text):
    """"a = at least 2 cm" lines of the page's text: a letter -> its printed value (the rest of the entry)."""
    out = {}
    lines = [l.strip() for l in re.split(r"[\r\n]+", text or "")]
    for k, line in enumerate(lines):
        m = re.match(r"^([a-z])\s*=\s*(.+)$", line)
        if m:
            val = m.group(2).strip()
            # an entry continues on the next line when that line is not itself an entry
            if k + 1 < len(lines) and lines[k + 1] and not re.match(r"^[a-z]\s*=", lines[k + 1]) and re.search(r"\d", lines[k + 1]) and len(lines[k + 1]) < 60:
                val = val + " / " + lines[k + 1]
            out[m.group(1)] = val
    return out


# ---- lines ----
def extract_lines(mask, horizontal, S, gray=None):
    """Lines along one axis. FOUND on the ink closed along the axis (a dash-dot line is one line) and opened to
    MIN_LINE; each connected component is one line, or several when its rows fall into runs of different EXTENTS (a
    row joins the rows above it when its extent overlaps theirs by IoU >= 0.5) — two parallel lines a point apart that
    touch (an arrowhead against an object's edge) stay two lines, while a thick dash-dot edge (the same extent in every
    row) stays one. MEASURED on the raw ink along the line's band: its extent is where its own ink starts and ends (a
    perpendicular line's crossing at an end the line does not reach is trimmed; so is one short stub cut off by a gap),
    its gaps are interior breaks of at least GAP_MIN where its grey rises GAP_CONTRAST above the local tone (one or two
    such breaks: collinear lines, split; DASH_GAPS or more: dash-dot), and its thickness at the middle is the median
    ink across it along its length (an arrowhead is measured against this)."""
    kc = max(1, int(round(CLOSE_GAP * S)))
    kl = max(3, int(round(MIN_LINE * S)))
    k_beyond = max(2, int(round(1.0 * S)))
    if horizontal:
        m, g = mask, gray
    else:
        m, g = mask.T, (gray.T if gray is not None else None)
    m = np.ascontiguousarray(m)
    closed = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (kc, 1)))
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (kl, 1)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    groups = []
    for i in range(1, n):
        x, y, w, h, area = [int(v) for v in stats[i]]
        if h > 2 * MAX_THICK * S:
            continue
        sub = lab[y:y + h, x:x + w] == i
        cur = None
        for rr in range(h):
            cols = np.nonzero(sub[rr])[0]
            if len(cols) == 0:
                if cur:
                    groups.append(cur)
                    cur = None
                continue
            c0, c1 = x + int(cols[0]), x + int(cols[-1])
            if cur is not None:
                a0, a1 = cur["ext"]
                iou_ = (min(c1, a1) - max(c0, a0) + 1) / (max(c1, a1) - min(c0, a0) + 1)
                if iou_ >= 0.5:
                    cur["rows"].append(y + rr)
                    cur["count"].append(len(cols))
                    cur["ext"] = (min(a0, c0), max(a1, c1))
                    continue
                groups.append(cur)
            cur = {"rows": [y + rr], "count": [len(cols)], "ext": (c0, c1)}
        if cur:
            groups.append(cur)
    lines = []
    gmin = max(1, int(round(GAP_MIN * S)))
    stub = max(1, int(round(STUB * S)))
    for G in groups:
        rows, counts = np.array(G["rows"]), np.array(G["count"])
        if len(rows) > MAX_THICK * S or counts.max() < kl:
            continue
        core = rows[counts >= 0.3 * counts.max()]
        r0, r1 = int(core.min()), int(core.max())
        sel = (rows >= r0) & (rows <= r1)
        pos = float(np.average(rows[sel], weights=counts[sel]))
        # the morphology shifts a component's ends by a pixel or two: the line runs on along its contiguous raw ink
        x, x2 = G["ext"]
        W_ = m.shape[1]
        while x > 0 and m[r0:r1 + 1, x - 1].any():
            x -= 1
        while x2 < W_ - 1 and m[r0:r1 + 1, x2 + 1].any():
            x2 += 1
        w = x2 - x + 1
        band = m[r0:r1 + 1, x:x + w].max(axis=0).astype(bool)
        above = m[max(0, r0 - k_beyond):r0, x:x + w].max(axis=0).astype(bool) if r0 > 0 else np.zeros(w, bool)
        below = m[r1 + 1:r1 + 1 + k_beyond, x:x + w].max(axis=0).astype(bool) if r1 + 1 < m.shape[0] else np.zeros(w, bool)
        crossing = band & above & below
        def trim(idx, step):
            j = idx
            while 0 <= j < w and band[j] and crossing[j]:
                j += step
            k = j
            while 0 <= k < w and not band[k]:
                k += step
            return k if (j != idx and k != j) else idx
        a, b = 0, w - 1
        while a <= b and not band[a]:
            a += 1
        while b >= a and not band[b]:
            b -= 1
        na = trim(a, 1)
        while na != a and a <= b:
            a = na
            na = trim(a, 1)
        nb = trim(b, -1)
        while nb != b and a <= b:
            b = nb
            nb = trim(b, -1)
        j = a
        while j <= b and band[j]:
            j += 1
        k = j
        while k <= b and not band[k]:
            k += 1
        if j - a <= stub and k > j and b - k + 1 >= kl:
            a = k
        j = b
        while j >= a and band[j]:
            j -= 1
        k = j
        while k >= a and not band[k]:
            k -= 1
        if b - j <= stub and k < j and k - a + 1 >= kl:
            b = k
        if b - a + 1 < kl:
            continue
        if g is not None:
            gp = g[r0:r1 + 1, x + a:x + b + 1].min(axis=0).astype(int)
            half = max(2, int(round(GAP_LOCAL * S)))
            ref = np.array([np.percentile(gp[max(0, q - half):q + half + 1], 30) for q in range(len(gp))])
            is_gap = gp > np.minimum(252, ref + GAP_CONTRAST)
        else:
            is_gap = ~band[a:b + 1]
        nz = np.nonzero(~is_gap)[0]
        if len(nz) == 0:
            continue
        a, b = a + int(nz[0]), a + int(nz[-1])
        is_gap = is_gap[int(nz[0]):int(nz[-1]) + 1]
        if b - a + 1 < kl:
            continue
        # the thickness at the middle: the median, along the line, of the ink run across it through its axis row
        axis_row = int(round(pos))
        cap = int(round(1.5 * S))
        thicks = []
        for c in range(x + a, x + b + 1, max(1, int(S))):
            col = m[max(0, axis_row - cap):axis_row + cap + 1, c]
            ctr = axis_row - max(0, axis_row - cap)
            if ctr < len(col) and col[ctr]:
                u = ctr
                while u > 0 and col[u - 1]:
                    u -= 1
                d_ = ctr
                while d_ < len(col) - 1 and col[d_ + 1]:
                    d_ += 1
                thicks.append(d_ - u + 1)
        # the 20th percentile: the line's own thickness, not its arrowheads' or the crossings' (both are wider)
        mid = (float(np.percentile(thicks, 20)) / S) if thicks else (r1 - r0 + 1) / S
        gaps = []
        q = 0
        while q < len(is_gap):
            if is_gap[q]:
                e = q
                while e < len(is_gap) and is_gap[e]:
                    e += 1
                if e - q >= gmin:
                    gaps.append((a + q, a + e - 1))
                q = e
            else:
                q += 1
        base = {"axis": "horizontal" if horizontal else "vertical", "pos": pos / S, "thick": (r1 - r0 + 1) / S, "midThick": round(mid, 3)}
        if 1 <= len(gaps) < DASH_GAPS:
            cuts = [a] + [v for gg in gaps for v in (gg[0] - 1, gg[1] + 1)] + [b]
            for p0, p1 in zip(cuts[0::2], cuts[1::2]):
                if p1 - p0 + 1 >= kl:
                    lines.append({"id": f"{'h' if horizontal else 'v'}{len(lines)}", **base, "start": (x + p0) / S, "end": (x + p1) / S, "fill": round(float(band[p0:p1 + 1].mean()), 3), "gaps": []})
            continue
        lines.append({"id": f"{'h' if horizontal else 'v'}{len(lines)}", **base, "start": (x + a) / S, "end": (x + b) / S, "fill": round(float(band[a:b + 1].mean()), 3), "gaps": [(round((x + g0) / S, 2), round((x + g1) / S, 2)) for g0, g1 in gaps]})
    return lines


def dashed_at(line, at):
    """Is the line dash-dot AT `at` — a line with a dash pattern (DASH_GAPS gaps or more) whose pattern runs through the
    point: inside a gap, or gaps within DASH_WINDOW on both sides (a mixed line — dash-dot, then solid — is solid past
    its pattern's last gap)."""
    if len(line["gaps"]) < DASH_GAPS:
        return False
    if any(g0 <= at <= g1 for g0, g1 in line["gaps"]):
        return True
    before = any(at - DASH_WINDOW <= g1 < at for g0, g1 in line["gaps"])
    after = any(at < g0 <= at + DASH_WINDOW for g0, g1 in line["gaps"])
    return before and after


def solid(line):
    return line["fill"] >= 0.9 and not line["gaps"]


# ---- crosshairs ----
def ring_fill(mask, cx, cy, r, S):
    hits = 0
    total = 0
    for k in range(120):
        a = 2 * math.pi * k / 120
        # skip the four arms (the cross lines are ink anyway)
        if min(abs(math.sin(a)), abs(math.cos(a))) < 0.12:
            continue
        x = (cx + r * math.cos(a)) * S
        y = (cy + r * math.sin(a)) * S
        xi, yi = int(round(x)), int(round(y))
        total += 1
        y0, y1, x0, x1 = max(0, yi - 1), min(mask.shape[0], yi + 2), max(0, xi - 1), min(mask.shape[1], xi + 2)
        if y1 > y0 and x1 > x0 and mask[y0:y1, x0:x1].any():
            hits += 1
    return hits / total if total else 0.0


def unbroken_near(line, at, radius):
    return line["fill"] >= 0.85 and not any(g1 >= at - radius and g0 <= at + radius for g0, g1 in line["gaps"])


def crosshairs(hlines, vlines, mask, S):
    found = []
    for h in hlines:
        for v in vlines:
            cx, cy = v["pos"], h["pos"]
            if not (unbroken_near(h, cx, RING[1] + ARM) and unbroken_near(v, cy, RING[1] + ARM)):
                continue
            if not (h["start"] + ARM <= cx <= h["end"] - ARM and v["start"] + ARM <= cy <= v["end"] - ARM):
                continue
            r = RING[0]
            best = None
            while r <= RING[1] + 1e-9:
                f = ring_fill(mask, cx, cy, r, S)
                if f >= RING_FILL:
                    best = (r, f)
                    break
                r += RING[2]
            if best:
                if any(abs(p["x"] - cx) < 1.0 and abs(p["y"] - cy) < 1.0 for p in found):
                    continue
                found.append({"x": round(cx, 2), "y": round(cy, 2), "r": round(best[0], 2), "ringFill": round(best[1], 2), "h": h["id"], "v": v["id"]})
    # letters: columns (x within 1.5 pt) left to right, then top to bottom within a column
    cols = []
    for p in sorted(found, key=lambda p: p["x"]):
        if cols and abs(cols[-1][0]["x"] - p["x"]) <= 1.5:
            cols[-1].append(p)
        else:
            cols.append([p])
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    k = 0
    for col in cols:
        for p in sorted(col, key=lambda p: p["y"]):
            p["letter"] = letters[k] if k < len(letters) else f"P{k}"
            k += 1
    return found


# ---- labels ----
_OCR = {"engine": None, "threads": None}


def ocr_engine():
    if _OCR["engine"] is None:
        import ocr_text
        from rapidocr import RapidOCR
        threads = ocr_text.cpu_quota_threads()
        _OCR["engine"] = RapidOCR(params=ocr_text.engine_params(threads))
        _OCR["threads"] = threads
    return _OCR["engine"]


def ocr_region(gray, bounds, S):
    """RapidOCR on the region at 0 deg and turned 90 deg both ways; every reading with its box back in page points,
    clustered by place (overlapping boxes). Which reading a place takes is decided once its glyphs are known
    (choose_readings): a vertical label by a turned pass, a horizontal one by the 0 pass."""
    x0, y0, x1, y1 = [int(round(v * S)) for v in bounds]
    crop = gray[y0:y1, x0:x1]
    H, W = crop.shape
    eng = ocr_engine()
    toks = []
    for turn, img in (("0", crop), ("cw", np.rot90(crop, k=-1)), ("ccw", np.rot90(crop, k=1))):
        rgb = cv2.cvtColor(np.ascontiguousarray(img), cv2.COLOR_GRAY2BGR)
        out = eng(rgb)
        if out is None or out.boxes is None:
            continue
        for b, t, sc in zip(out.boxes, out.txts, out.scores):
            pts = []
            for (xr, yr) in b:
                if turn == "0":
                    xo, yo = xr, yr
                elif turn == "cw":   # rot90 k=-1: original x = y', y = H-1-x'
                    xo, yo = yr, H - 1 - xr
                else:                # rot90 k=1: original x = W-1-y', y = x'
                    xo, yo = W - 1 - yr, xr
                pts.append(((xo + x0) / S, (yo + y0) / S))
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            toks.append({"text": str(t).strip(), "score": round(float(sc), 3), "turn": turn, "x0": float(min(xs)), "y0": float(min(ys)), "x1": float(max(xs)), "y1": float(max(ys))})
    places = []
    for t in sorted(toks, key=lambda t: -t["score"]):
        for p in places:
            if any(iou(t, u) > 0.3 or contains(u, t) or contains(t, u) for u in p):
                p.append(t)
                break
        else:
            places.append([t])
    out = []
    for p in places:
        box = {"x0": min(t["x0"] for t in p), "y0": min(t["y0"] for t in p), "x1": max(t["x1"] for t in p), "y1": max(t["y1"] for t in p)}
        out.append({**box, "readings": [{"text": t["text"], "score": t["score"], "turn": t["turn"]} for t in p]})
    return out


def choose_reading(place, glyphs):
    """The place's orientation from its glyphs — two or more glyphs stacked (their centres spread more in y than in x),
    or a single glyph wider than tall, is a VERTICAL label (written along a vertical line) — and its reading from the
    passes of that sense (best score); when the two turned passes read different texts with scores within 0.1 of each
    other, the place is ambiguous (no reading)."""
    if len(glyphs) >= 2:
        cxs = [(g[0] + g[2]) / 2 for g in glyphs]
        cys = [(g[1] + g[3]) / 2 for g in glyphs]
        vertical = (max(cys) - min(cys)) > (max(cxs) - min(cxs))
    elif len(glyphs) == 1:
        g = glyphs[0]
        vertical = (g[2] - g[0]) > 1.15 * (g[3] - g[1])
    else:
        vertical = (place["y1"] - place["y0"]) > 1.3 * (place["x1"] - place["x0"])
    want = ("cw", "ccw") if vertical else ("0",)
    rs = [r for r in place["readings"] if r["turn"] in want] or place["readings"]
    rs = sorted(rs, key=lambda r: -r["score"])
    if vertical and len(rs) >= 2 and rs[0]["text"] != rs[1]["text"] and rs[0]["score"] - rs[1]["score"] < 0.1 and {rs[0]["turn"], rs[1]["turn"]} == {"cw", "ccw"}:
        return vertical, None
    return vertical, rs[0]


def iou(a, b):
    ix = max(0.0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    iy = max(0.0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    inter = ix * iy
    ua = (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]) + (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]) - inter
    return inter / ua if ua > 0 else 0.0


def contains(a, b):
    cx, cy = (b["x0"] + b["x1"]) / 2, (b["y0"] + b["y1"]) / 2
    return a["x0"] <= cx <= a["x1"] and a["y0"] <= cy <= a["y1"]


NUM = re.compile(r"^(\d+(?:[.,]\d+)?)(?:mm|cm|m|in|\"|')?$")


def label_value(tok, legend):
    t = tok["text"].replace(" ", "")
    m = NUM.match(t)
    if m and float(m.group(1).replace(",", ".")) > 0:
        return m.group(1), None
    if len(t) == 1 and t.lower() in legend:
        return t.lower(), legend[t.lower()]
    return None, None


# ---- dimensions ----
def is_frame(line, bounds):
    if isinstance(bounds, dict):
        return any(is_frame(line, fb) for fb in bounds["frames"])
    x0, y0, x1, y1 = bounds
    if line["axis"] == "horizontal":
        near = abs(line["pos"] - y0) <= FRAME_TOL or abs(line["pos"] - y1) <= FRAME_TOL
        return near and (line["end"] - line["start"]) >= 0.7 * (x1 - x0)
    near = abs(line["pos"] - x0) <= FRAME_TOL or abs(line["pos"] - x1) <= FRAME_TOL
    return near and (line["end"] - line["start"]) >= 0.7 * (y1 - y0)


def arrowheads(line, mask, S):
    """For each end of a line: a filled triangle. Across the line at 0.25 pt steps inward from the end (up to
    ARROW_LEN), the ink's extent each side of the axis; a sample whose ink reaches the 3 pt cap on either side lies on a
    perpendicular line (an extension line, an object's edge the arrow touches or crosses) and is skipped. The rest make
    an arrowhead when they widen to at least ARROW_WIDE x the line's thickness (the peak at least 0.75 pt in), are
    narrow at the first sample (at most 0.75 x the peak) and symmetric at the peak (the smaller side >= 0.4 x the larger)."""
    res = {}
    thick = max(line.get("midThick", line["thick"]), 0.25)
    cap = 3.0
    capx = int(cap * S)
    for end in ("start", "end"):
        samples = []
        for q in range(1, int(ARROW_LEN * 4) + 1):
            d = q / 4.0
            at = line[end] + d if end == "start" else line[end] - d
            if line["axis"] == "horizontal":
                xi, yc = int(round(at * S)), int(round(line["pos"] * S))
                if not (0 <= xi < mask.shape[1]):
                    continue
                lo = max(0, yc - capx)
                col = mask[lo:yc + capx + 1, xi]
                centre = yc - lo
            else:
                yi, xc = int(round(at * S)), int(round(line["pos"] * S))
                if not (0 <= yi < mask.shape[0]):
                    continue
                lo = max(0, xc - capx)
                col = mask[yi, lo:xc + capx + 1]
                centre = xc - lo
            if centre >= len(col) or not col[centre]:
                samples.append((d, 0.0, 0.0))
                continue
            a = centre
            while a > 0 and col[a - 1]:
                a -= 1
            b = centre
            while b < len(col) - 1 and col[b + 1]:
                b += 1
            up, down = (centre - a) / S, (b - centre) / S
            if max(up, down) >= cap - 0.3:
                continue  # a perpendicular line, not the arrowhead
            samples.append((d, up, down))
        body = [(d, u + dn + 1.0 / S, u, dn) for d, u, dn in samples if d >= 0.75]
        if not samples or not body:
            res[end] = False
            continue
        pd, peak, pu, pdn = max(body, key=lambda t: t[1])
        first = samples[0][1] + samples[0][2] + 1.0 / S
        sym = min(pu, pdn) >= 0.4 * max(pu, pdn) if max(pu, pdn) > 0 else False
        res[end] = bool(peak >= ARROW_WIDE * thick and first <= 0.75 * peak and sym)
    return res


def terminals_of(carrier, perps, bounds, S, mask):
    """The carrier's terminals (positions along its axis) and its near misses."""
    arrows = arrowheads(carrier, mask, S) if solid(carrier) else {"start": False, "end": False}
    terms, near = [], []
    if arrows["start"]:
        terms.append({"at": carrier["start"], "by": "arrow tip"})
    if arrows["end"]:
        terms.append({"at": carrier["end"], "by": "arrow tip"})
    for p in perps:
        if is_frame(p, bounds):
            continue
        at = p["pos"]
        # lateral: where p sits along the carrier
        if at < carrier["start"] - NEAR or at > carrier["end"] + NEAR:
            continue
        outside = max(carrier["start"] - at, at - carrier["end"], 0.0)
        # reach: how close p comes to the carrier's row
        miss = max(p["start"] - carrier["pos"], carrier["pos"] - p["end"], 0.0)
        if arrows["start"] and at < carrier["start"] + ARROW_LEN:
            continue
        if arrows["end"] and at > carrier["end"] - ARROW_LEN:
            continue
        if arrows["start"] and arrows["end"]:
            continue  # a line drawn with arrows ends at its tips; the lines it crosses are the object's
        at_end = at <= carrier["start"] + END_ZONE or at >= carrier["end"] - END_ZONE
        if miss <= TOUCH and outside <= 0.5:
            if dashed_at(p, carrier["pos"]) and not at_end:
                continue
            terms.append({"at": at, "by": p["id"], "dashed": dashed_at(p, carrier["pos"])})
        elif (miss <= NEAR and outside <= 0.5) or (miss <= TOUCH and outside <= 1.5):
            if dashed_at(p, carrier["pos"]) and not at_end:
                continue
            near.append({"at": at, "by": p["id"], "miss": round(miss, 2), "outside": round(outside, 2)})
    terms.sort(key=lambda t: t["at"])
    merged = []
    for t in terms:
        if merged and abs(merged[-1]["at"] - t["at"]) <= 0.8:
            continue
        merged.append(t)
    return merged, near, arrows


def label_box(tok):
    return tok["x0"], tok["y0"], tok["x1"], tok["y1"]


def candidates_for(tok, lines_h, lines_v, bounds, S, mask, cache):
    x0, y0, x1, y1 = label_box(tok)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = x1 - x0, y1 - y0
    height = w if tok["vertical"] else h          # the text's height
    reach = max(LABEL_GAP * height, 3.0)
    out = []
    alongside = []
    pools = [("vertical", lines_v)] if tok["vertical"] else [("horizontal", lines_h), ("vertical", lines_v)]
    for axis, pool in pools:
        for c in pool:
            if not solid(c) or is_frame(c, bounds):
                continue
            if axis == "horizontal":
                gap = max(c["pos"] - y1, y0 - c["pos"])
                along, lo, hi, size = cx, x0, x1, w
            else:
                gap = max(c["pos"] - x1, x0 - c["pos"])
                along, lo, hi, size = cy, y0, y1, h
            if gap < -0.5 or gap > reach:
                continue
            if along < c["start"] - size or along > c["end"] + size:
                continue
            ext = c["end"] - c["start"]
            if ext > 0 and MIDDLE[0] <= (along - c["start"]) / ext <= MIDDLE[1]:
                alongside.append({"carrier": c["id"], "gap": round(max(gap, 0.0), 2)})
            if c["id"] not in cache:
                perps = lines_v if axis == "horizontal" else lines_h
                cache[c["id"]] = terminals_of(c, perps, bounds, S, mask)
            terms, near, arrows = cache[c["id"]]
            ats = [t["at"] for t in terms]
            sub = None
            placement = None
            for k in range(len(ats) - 1):
                if ats[k] <= along <= ats[k + 1]:
                    L = ats[k + 1] - ats[k]
                    rel = (along - ats[k]) / L if L > 0 else 0.5
                    if MIDDLE[0] <= rel <= MIDDLE[1]:
                        sub, placement = (k, ats[k], ats[k + 1]), "inside"
                    break
            if sub is None and len(ats) >= 2:
                # outside placement: beyond an end, the end sub-segment too short to hold the label
                if hi <= ats[0] and ats[0] - hi <= 1.5 * size and (ats[1] - ats[0]) < 1.2 * size:
                    sub, placement = (0, ats[0], ats[1]), "outside (before)"
                elif lo >= ats[-1] and lo - ats[-1] <= 1.5 * size and (ats[-1] - ats[-2]) < 1.2 * size:
                    sub, placement = (len(ats) - 2, ats[-2], ats[-1]), "outside (after)"
            if sub is None:
                continue
            # a near miss inside or at the ends of the chosen sub-segment makes it not derivable
            blocked = [n for n in near if sub[1] - NEAR <= n["at"] <= sub[2] + NEAR]
            out.append({"carrier": c, "axis": axis, "gap": round(max(gap, 0.0), 2), "sub": sub, "placement": placement, "terms": terms, "near": blocked, "arrows": arrows})
    tok["alongside"] = alongside
    return out


def assign(labels, lines_h, lines_v, bounds, S, mask):
    cache = {}
    cands = {id(t): candidates_for(t, lines_h, lines_v, bounds, S, mask, cache) for t in labels}
    taken = set()
    done = {}
    progress = True
    while progress:
        progress = False
        for t in sorted(labels, key=lambda t: min([c["gap"] for c in cands[id(t)]] or [1e9])):
            if id(t) in done:
                continue
            cs = [c for c in cands[id(t)] if (c["carrier"]["id"], c["sub"][0]) not in taken]
            # a label sits inside its own dimension's span; outside placement is the fallback for a span too short to
            # hold it — so when any carrier places the label inside, the outside placements are not considered; and a
            # label centred ALONG a line belongs to that line: when no carrier places it inside, it is not derivable
            # (never moved to another line's end)
            if any(c["placement"] == "inside" for c in cs):
                cs = [c for c in cs if c["placement"] == "inside"]
            elif t.get("alongside"):
                t["blockedBy"] = t["alongside"]
                continue
            cs.sort(key=lambda c: c["gap"])
            if not cs:
                continue
            if len(cs) == 1 or (cs[1]["gap"] - cs[0]["gap"]) >= max(CLEAR[0] * cs[0]["gap"], CLEAR[1]):
                done[id(t)] = cs[0]
                taken.add((cs[0]["carrier"]["id"], cs[0]["sub"][0]))
                progress = True
    claims = []
    for t in labels:
        c = done.get(id(t))
        base = {"label": t["text"], "value": t["value"], "legend": t.get("legend"), "labelBox": [round(v, 2) for v in label_box(t)], "vertical": t["vertical"], "score": t["score"]}
        if c is None:
            live = [x for x in cands[id(t)] if (x["carrier"]["id"], x["sub"][0]) not in taken]
            if t.get("blockedBy"):
                reason = "it lies along a line whose ends cannot be resolved (" + ", ".join(f"{a['carrier']} at gap {a['gap']}" for a in t["blockedBy"]) + ") — never moved to another line's end"
            else:
                reason = "no carrier beside the label with a sub-segment around it" if not cands[id(t)] else ("two carriers equally near" if live else "its carriers' sub-segments are taken by other labels")
            claims.append({**base, "axis": None, "span": None, "reason": reason, "candidates": [{"carrier": x["carrier"]["id"], "gap": x["gap"], "sub": [round(v, 2) for v in x["sub"][1:]]} for x in cands[id(t)]]})
            continue
        car = c["carrier"]
        span = [round(c["sub"][1], 2), round(c["sub"][2], 2)]
        entry = {**base, "axis": c["axis"], "carrier": {"id": car["id"], "pos": round(car["pos"], 2), "start": round(car["start"], 2), "end": round(car["end"], 2), "thick": round(car["thick"], 2), "arrows": c["arrows"]}, "gap": c["gap"], "placement": c["placement"], "terminals": [{"at": round(x["at"], 2), "by": x["by"]} for x in c["terms"]], "span": span, "reason": None}
        if c["near"]:
            entry["span"] = None
            entry["reason"] = "a near miss borders the sub-segment: " + ", ".join(f"{n['by']} at {n['at']:.1f} (miss {n['miss']}, outside {n['outside']})" for n in c["near"])
            entry["wouldBe"] = span
        claims.append(entry)
    return claims


def analyse_region(gray, region, S, ink, legend, words, places=None):
    b = region["bounds"]
    x0, y0, x1, y1 = [int(round(v * S)) for v in b]
    full = (gray < ink).astype(np.uint8)
    mask = np.zeros_like(full)
    mask[y0:y1, x0:x1] = full[y0:y1, x0:x1]
    # 1-3: lines and crosshairs on the whole ink
    h_all = extract_lines(mask, True, S, gray)
    v_all = extract_lines(mask, False, S, gray)
    points = crosshairs(h_all, v_all, mask, S)
    # 4: the text's places, then its glyphs (an ink component wholly inside a place, 0.5 pt of slack) — the glyphs leave
    # the ink before the dimension lines are read (a line passing by or through a place is its own, larger component)
    # T46 (D15): the OCR is ink-independent (it reads the grey render), so read_page reads each region ONCE and hands
    # both ink settings a copy (the rules below mark places as they go).
    t0 = time.time()
    places = ocr_region(gray, b, S) if places is None else copy.deepcopy(places)
    ocr_ms = int((time.time() - t0) * 1000)
    kept = []
    for p in places:
        cx, cy = (p["x0"] + p["x1"]) / 2, (p["y0"] + p["y1"]) / 2
        if any(math.hypot(q["x"] - cx, q["y"] - cy) <= q["r"] + 0.5 for q in points):
            p["dropped"] = "centred on a crosshair"
        kept.append(p)
    clean = mask.copy()
    ncc, lab, st, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    slack = 0.5
    removed = 0
    glyphs = {id(p): [] for p in kept}
    for i in range(1, ncc):
        cx0, cy0, cw, ch = [int(v) for v in st[i][:4]]
        bx0, by0, bx1, by1 = cx0 / S, cy0 / S, (cx0 + cw) / S, (cy0 + ch) / S
        for p in kept:
            if p.get("dropped"):
                continue
            if bx0 >= p["x0"] - slack and by0 >= p["y0"] - slack and bx1 <= p["x1"] + slack and by1 <= p["y1"] + slack:
                clean[lab == i] = 0
                removed += 1
                glyphs[id(p)].append((bx0, by0, bx1, by1))
                break
    labels, other = [], []
    for p in kept:
        g = glyphs[id(p)]
        vertical, r = choose_reading(p, g)
        t = {"text": r["text"] if r else "", "score": r["score"] if r else 0.0, "turn": r["turn"] if r else None, "vertical": vertical, "readings": p["readings"], "ocrBox": [round(p["x0"], 2), round(p["y0"], 2), round(p["x1"], 2), round(p["y1"], 2)]}
        if g:
            t.update({"x0": min(v[0] for v in g), "y0": min(v[1] for v in g), "x1": max(v[2] for v in g), "y1": max(v[3] for v in g), "box": "glyphs"})
        else:
            t.update({"x0": p["x0"], "y0": p["y0"], "x1": p["x1"], "y1": p["y1"], "box": "ocr"})
        if p.get("dropped"):
            t["dropped"] = p["dropped"]
            other.append(t)
            continue
        if r is None:
            t["dropped"] = "the turned passes read different texts"
            other.append(t)
            continue
        v, leg = label_value(t, legend)
        if v is not None and t["score"] < LABEL_SCORE_MIN:
            t["dropped"] = f"an OCR score below {LABEL_SCORE_MIN}"
            other.append(t)
            continue
        if v is not None:
            t["value"], t["legend"] = v, leg
            labels.append(t)
        else:
            other.append(t)
    lines_h = extract_lines(clean, True, S, gray)
    lines_v = extract_lines(clean, False, S, gray)
    frames = [f for f in ([region.get("frame")] + region.get("frames", [])) if f] or [b]
    claims = assign(labels, lines_h, lines_v, {"frames": frames}, S, clean)
    rnd = lambda d: {k: (round(v, 2) if isinstance(v, float) else v) for k, v in d.items()}
    return {
        "region": region,
        "lines": {"horizontal": len(lines_h), "vertical": len(lines_v), "solidH": sum(1 for l in lines_h if solid(l)), "solidV": sum(1 for l in lines_v if solid(l)), "glyphComponentsRemoved": removed},
        "points": points,
        "labels": [rnd(t) for t in labels],
        "otherText": [rnd(t) for t in other],
        "ocrMs": ocr_ms,
        "claims": claims,
        "linesDetail": {"horizontal": lines_h, "vertical": lines_v},
    }


def _num(v):
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return float(v)
    return v


def _claim(c):
    """A claim as the settlement and the record read it: the label, its value and axis, its span (or the reason it is
    not derivable), the placement, the label's box and the carrier's id."""
    out = {k: c.get(k) for k in ("label", "value", "axis", "span", "reason", "placement", "labelBox")}
    out["carrier"] = (c.get("carrier") or {}).get("id") if isinstance(c.get("carrier"), dict) else None
    if c.get("wouldBe") is not None:
        out["wouldBe"] = c.get("wouldBe")
    return out


def read_page(pdf_path, page_no, scale=4.0, inks=(200, 128)):
    """T46 (D15): one page's geometry at each ink threshold — the page rendered once at `scale` in memory, each drawing
    region's OCR read once, the lines, crosshairs and claims read per ink. The regions are found at the FIRST ink (the
    pinned one) and read at every ink. Returns { pagePt, scale, inks, legend, readings: { "<ink>": { regions: [{ kind,
    bounds, points, claims, labels, lines, ocrMs }] } }, ocrThreads, ocrMs, ms, version }."""
    t0 = time.time()
    pdf, page, size, gray = render(pdf_path, page_no, scale)
    try:
        regions = image_regions(page, size) or vector_region(gray, inks[0], scale, size)
        words, text = page_words(page)
        legend = legend_of(text)
        read = []
        ocr_ms = 0
        for r in regions:
            t1 = time.time()
            places = ocr_region(gray, r["bounds"], scale)
            ocr_ms += int((time.time() - t1) * 1000)
            read.append((r, places))
        readings = {}
        for ink in inks:
            out = []
            for r, places in read:
                a = analyse_region(gray, r, scale, ink, legend, words, places=places)
                out.append({
                    "kind": r.get("kind"),
                    "bounds": r.get("bounds"),
                    "points": [{"letter": p.get("letter"), "x": _num(p["x"]), "y": _num(p["y"]), "r": _num(p.get("r"))} for p in a["points"]],
                    "claims": [_claim(c) for c in a["claims"]],
                    "labels": len(a["labels"]),
                    "lines": {k: _num(v) for k, v in a["lines"].items()},
                })
            readings[str(ink)] = {"regions": out}
        return {"pagePt": [round(size[0], 2), round(size[1], 2)], "scale": scale, "inks": list(inks), "legend": legend, "readings": readings, "ocrThreads": _OCR["threads"], "ocrMs": ocr_ms, "ms": int((time.time() - t0) * 1000), "version": MODULE_MD5}
    finally:
        try:
            pdf.close()
        except Exception:
            pass
