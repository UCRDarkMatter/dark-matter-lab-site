#!/usr/bin/env python3
"""Read curves out of vector figures (PDF, and EPS when Ghostscript is installed).

Most figures in arXiv source packages are vector graphics, so every line in them is stored
as exact page coordinates.  This module
  1. finds the plot frame and reads the tick labels to learn how page position maps to
     axis values (log or linear),
  2. collects the lines and closed outlines drawn inside the frame,
  3. converts them to axis values, and
  4. matches each line's colour and dash style to the legend to give it a name.

It cannot know which line is the paper's own result: that is for a person to confirm.
Needs the PyMuPDF library.  Either   pip install pymupdf
or, with no pip and no admin rights:  python3 tools/figures.py --install
which downloads it from PyPI and unpacks it into tools/vendor/ (used only by these scripts).

Try it on one figure:   python3 tools/figures.py some_figure.pdf
"""
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
if os.path.isdir(VENDOR) and VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)                         # a copy unpacked by --install

try:
    import pymupdf
except ImportError:                                    # older installs use the name "fitz"
    try:
        import fitz as pymupdf
    except ImportError:
        pymupdf = None

MAX_POINTS = 240            # points kept per curve
MINUS = str.maketrans({"−": "-", "–": "-", "‒": "-", "×": "x", "⋅": "x", "·": "x"})


def available():
    return pymupdf is not None


# ------------------------------------------------------------------ tick labels
SUPERSCRIPT = str.maketrans("\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079\u207b\u207a", "0123456789-+")


def _exponent(text):
    """An exponent written next to a 10: '-47', '\u221247', or a minus sign that the PDF's font
    encoding turned into some other symbol ('\u00b747', '\u00a147')."""
    t = text.translate(MINUS).replace(" ", "").strip("{}")
    m = re.fullmatch(r"([^\d]*)(\d+)", t)
    if not m:
        return None
    sign = m.group(1)
    return -int(m.group(2)) if sign and sign != "+" else int(m.group(2))


def parse_number(text, exponent=None):
    """The value of a tick label: plain numbers, 1e-46, 10^-46, 2x10^-3, or '10' / '2x10' with
    a separately drawn exponent."""
    t = text.translate(MINUS).replace(" ", "").replace(",", "")
    sup = re.search(r"[\u2070\u00b9\u00b2\u00b3\u2074-\u2079\u207b\u207a]+$", t)
    if sup and exponent is None:                         # 10 followed by unicode superscripts
        t, exponent = t[:sup.start()], sup.group(0).translate(SUPERSCRIPT)
    m = re.fullmatch(r"(?:(\d+(?:\.\d+)?)x)?10", t)
    if m and exponent is not None:
        e = _exponent(str(exponent))
        return None if e is None else float(m.group(1) or 1) * 10.0 ** e
    m = re.fullmatch(r"(?:(\d+(?:\.\d+)?)x)?10\^\{?(-?\d+)\}?", t)
    if m:
        return float(m.group(1) or 1) * 10.0 ** int(m.group(2))
    m = re.fullmatch(r"10(-\d+)", t)                      # "10-46" drawn as one piece of text
    if m:
        return 10.0 ** int(m.group(1))
    try:
        return float(t)
    except ValueError:
        return None


def parse_tick(spans):
    """Value of a label given as [(text, font size)] left to right (smaller pieces are exponents)."""
    spans = [(t, z) for t, z in spans if t.strip()]
    if not spans:
        return None
    base = max(z for _, z in spans)
    main = "".join(t for t, z in spans if z >= 0.86 * base)
    small = "".join(t for t, z in spans if z < 0.86 * base)
    return parse_number(main, small or None)


def tick_labels(spans, axis):
    """Assemble tick labels from loose pieces of text by position, because programs differ in how
    they store '10' and its raised exponent (one line, separate lines, or the sign on its own).
    spans = [(text, size, bbox)] near one axis.  Returns [(page position, value)]."""
    spans = [sp for sp in spans if sp[0].strip()]
    digits = [sp for sp in spans if re.match(r"\s*[\d.]", sp[0].translate(MINUS).lstrip("-"))]
    if not digits:
        return []
    main = max(sp[1] for sp in digits)
    big = [sp for sp in spans if sp[1] >= 0.86 * main]
    small = sorted((sp for sp in spans if sp[1] < 0.86 * main), key=lambda sp: sp[2][0])
    used, out = set(), []
    for text, size, bb in sorted((sp[:3] for sp in big), key=lambda sp: sp[2][0]):
        cy = (bb[1] + bb[3]) / 2
        exp, right, hidden_minus = "", bb[2], False
        for i, (t2, z2, b2) in enumerate(sp[:3] for sp in small):   # raised pieces that start where this one ends
            reach = 1.1 * main if not exp else 0.45 * main
            if i in used or b2[0] < right - 1.5 or b2[0] > right + reach:
                continue
            if (b2[1] + b2[3]) / 2 > cy + 0.15 * main or b2[3] < bb[1] - 0.9 * main:
                continue                                 # not raised beside this number
            if not exp and b2[0] - right > 0.3 * main and re.fullmatch(r"\s*\d+\s*", t2):
                hidden_minus = True                      # room for a minus sign the PDF does not give as text
            exp += t2
            right = b2[2]
            used.add(i)
        if hidden_minus:
            exp = "-" + exp
        val = parse_number(text, exp or None)
        if val is None:
            continue
        pos = (bb[0] + right) / 2 if axis == "x" else cy   # x labels are centred as a whole
        out.append((pos, val))
    return out


def fit_axis(ticks):
    """ticks = [(page position, value)].  Returns (to_value function, is_log, worst misfit in points)
    or None.  Chooses between a log and a linear axis by which fits the labels better."""
    ticks = sorted(set(ticks))
    if len(ticks) < 2 or ticks[0][0] == ticks[-1][0]:
        return None

    def line(vals):
        n = len(ticks)
        ps = [p for p, _ in ticks]
        mp, mv = sum(ps) / n, sum(vals) / n
        den = sum((p - mp) ** 2 for p in ps)
        slope = sum((p - mp) * (v - mv) for p, v in zip(ps, vals)) / den
        if slope == 0:
            return None
        icpt = mv - slope * mp
        worst = max(abs(v - (icpt + slope * p)) / abs(slope) for p, v in zip(ps, vals))
        return slope, icpt, worst

    lin = line([v for _, v in ticks])
    log = line([math.log10(v) for _, v in ticks]) if all(v > 0 for _, v in ticks) else None
    powers = log and all(abs(math.log10(v) - round(math.log10(v))) < 1e-9 for _, v in ticks)
    use_log = bool(log) and (not lin or log[2] < lin[2] or (len(ticks) == 2 and powers and ticks[-1][1] / ticks[0][1] >= 10))
    fit = log if use_log else lin
    if not fit:
        return None
    slope, icpt, worst = fit
    if use_log:
        return (lambda p: 10.0 ** (icpt + slope * p)), True, worst
    return (lambda p: icpt + slope * p), False, worst


# ------------------------------------------------------------------ geometry helpers
def _hex(c):
    return "#%02x%02x%02x" % tuple(int(round(max(0.0, min(1.0, v)) * 255)) for v in c[:3]) if c else ""


def _dashed(d):
    return bool(d) and bool(re.search(r"\d", str(d).split("]")[0]))


def _dash(d):
    """A dash pattern in a comparable form, e.g. '[ 3.7 1.6 ] 0' -> '3.7 1.6'; '' for a solid line."""
    nums = re.findall(r"\d+(?:\.\d+)?", str(d or "").split("]")[0])
    return " ".join("%.1f" % float(n) for n in nums)


def _bezier(p0, p1, p2, p3, n=6):
    out = []
    for i in range(1, n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def _length(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def polylines(page):
    """Every stroked path on the page as {'pts', 'color', 'fill', 'dashed', 'closed', 'width'}."""
    out = []
    for d in page.get_drawings():
        stroke = d.get("color")
        cur = []

        def flush():
            if len(cur) >= 2:
                closed = bool(d.get("closePath")) or (len(cur) > 3 and math.hypot(cur[0][0] - cur[-1][0], cur[0][1] - cur[-1][1]) < 0.3)
                out.append({"pts": list(cur), "color": _hex(stroke), "fill": _hex(d.get("fill")), "stroked": stroke is not None,
                            "dashed": _dashed(d.get("dashes")), "dash": _dash(d.get("dashes")), "closed": closed,
                            "width": d.get("width") or 0})
        for it in d["items"]:
            kind = it[0]
            if kind == "l":
                a, b = (it[1].x, it[1].y), (it[2].x, it[2].y)
                seg = [b]
            elif kind == "c":
                a = (it[1].x, it[1].y)
                seg = _bezier(a, (it[2].x, it[2].y), (it[3].x, it[3].y), (it[4].x, it[4].y))
            elif kind == "re":
                r = it[1]
                flush()
                cur = []
                out.append({"pts": [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)], "rect": True,
                            "color": _hex(stroke), "fill": _hex(d.get("fill")), "stroked": stroke is not None,
                            "dashed": False, "dash": "", "closed": True, "width": d.get("width") or 0})
                continue
            else:
                continue
            if cur and math.hypot(cur[-1][0] - a[0], cur[-1][1] - a[1]) < 0.05:
                cur.extend(seg)
            else:
                flush()
                cur = [a] + seg
        flush()
    # Some programs (ROOT, gnuplot) draw one curve as many short paths: join pieces that touch.
    merged = []
    for pl in out:
        last = merged[-1] if merged else None
        if (last and not pl.get("rect") and not last.get("rect") and not last["closed"] and last["stroked"] and pl["stroked"]
                and last["color"] == pl["color"] and last["dashed"] == pl["dashed"] and abs(last["width"] - pl["width"]) < 0.01
                and math.hypot(last["pts"][-1][0] - pl["pts"][0][0], last["pts"][-1][1] - pl["pts"][0][1]) < 0.6):
            last["pts"].extend(pl["pts"][1:])
        else:
            merged.append(pl)
    return merged


def text_lines(page):
    """[(spans, bbox, horizontal?)] with spans = [(text, size, bbox, colour)]."""
    out = []
    for block in page.get_text("dict").get("blocks", []):
        for ln in block.get("lines", []):
            spans = [(s["text"], s["size"], s["bbox"], "#%06x" % (s.get("color", 0) & 0xffffff))
                     for s in ln.get("spans", []) if s["text"].strip()]
            if spans:
                dx, dy = ln.get("dir", (1, 0))
                out.append((spans, ln["bbox"], abs(dx) > 0.9 and abs(dy) < 0.1))
    return out


def _restore_minus(ticks, increasing_with_position):
    """Some PDFs draw the minus sign of an exponent in a way that cannot be read back as text, so
    10^-47 arrives as 10^47.  An axis whose labels are all powers of ten and run the wrong way
    (values falling to the right, or falling upward) gives this away: flip the exponents."""
    vals = sorted(set(ticks))
    if len(vals) < 3 or not all(v > 1 and abs(math.log10(v) - round(math.log10(v))) < 1e-9 for _, v in vals):
        return ticks, False
    rising = sum(1 for (p1, v1), (p2, v2) in zip(vals, vals[1:]) if v2 > v1)
    falling = len(vals) - 1 - rising
    backwards = falling > rising if increasing_with_position else rising > falling
    if not backwards or min(rising, falling) > 0:
        return ticks, False
    return [(p, 1.0 / v) for p, v in ticks], True


def dump(data, name):
    """Print what the reader sees in one figure: frames, tick marks and every piece of text.
    For diagnosing a figure whose axes are read wrongly."""
    doc = pymupdf.open(stream=data, filetype="pdf")
    for page in doc:
        pls = polylines(page)
        lines = text_lines(page)
        frames = find_frames(page, pls)
        print("%s: page %.0f x %.0f, %d paths, %d text lines" % (name, page.rect.width, page.rect.height, len(pls), len(lines)))
        for fr in frames:
            axes = read_axes(fr, pls, lines)
            print("  frame %s" % (tuple(round(v, 1) for v in fr),))
            if axes:
                print("    x %s labels %s" % ("log" if axes["x_log"] else "linear", axes["xvals"]))
                print("    y %s labels %s" % ("log" if axes["y_log"] else "linear", axes["yvals"]))
                print("    misfit %.2f pt, minus sign restored: %s" % (axes["misfit"], axes["sign_restored"]))
            else:
                print("    axes: not readable")
        print("  text (repr, font size, box, horizontal):")
        for spans, bb, horiz in lines:
            print("    " + " | ".join("%r %.1f (%.0f,%.0f,%.0f,%.0f) %s" % (t, z, b[0], b[1], b[2], b[3], c) for t, z, b, c in spans) + ("" if horiz else "  [rotated]"))
        segs = sorted({(round(pl["pts"][0][0], 1), round(pl["pts"][0][1], 1), round(pl["pts"][1][0], 1), round(pl["pts"][1][1], 1))
                       for pl in pls if len(pl["pts"]) == 2 and _length(pl["pts"]) <= 14})
        print("  %d short strokes (tick marks, minus signs drawn as lines); first 12: %s" % (len(segs), segs[:12]))
        print("  long paths (colour, dash pattern, width, points, box):")
        for pl in pls:
            if len(pl["pts"]) >= 6 and pl["stroked"] and not pl.get("rect"):
                xs, ys = [q[0] for q in pl["pts"]], [q[1] for q in pl["pts"]]
                print("    %s dash[%s] w%.1f n%d (%.0f,%.0f,%.0f,%.0f)%s" % (pl["color"], pl["dash"], pl["width"], len(pl["pts"]),
                                                                       min(xs), min(ys), max(xs), max(ys), " closed" if pl["closed"] else ""))
        print("  legend samples: %s" % {k: v for fr in frames for k, v in legend_names(fr, pls, lines)[0].items() if len(k) == 3})
        rules = [tuple(round(v, 1) for v in (min(q[0] for q in pl["pts"]), min(q[1] for q in pl["pts"]), max(q[0] for q in pl["pts"]), max(q[1] for q in pl["pts"])))
                 for pl in pls if pl.get("rect") and max(q[0] for q in pl["pts"]) - min(q[0] for q in pl["pts"]) < 12
                 and max(q[1] for q in pl["pts"]) - min(q[1] for q in pl["pts"]) < 3]
        print("  %d tiny filled bars (minus signs drawn as rules?); first 20: %s" % (len(rules), rules[:20]))


def find_frames(page, pls):
    """Plot frames: big rectangles, or the box spanned by long axis lines."""
    pw, ph = page.rect.width, page.rect.height
    cands = []
    for pl in pls:
        xs, ys = [p[0] for p in pl["pts"]], [p[1] for p in pl["pts"]]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        boxy = pl.get("rect") or (pl["closed"] and len(pl["pts"]) <= 6 and all(
            min(abs(p[0] - x0), abs(p[0] - x1)) < 0.5 and min(abs(p[1] - y0), abs(p[1] - y1)) < 0.5 for p in pl["pts"]))
        if boxy and (x1 - x0) > 0.25 * pw and (y1 - y0) > 0.25 * ph and (x1 - x0) * (y1 - y0) < 0.97 * pw * ph:
            cands.append((x0, y0, x1, y1))
    if not cands:                                      # no rectangle: use long horizontal + vertical lines
        hs = [pl for pl in pls if len(pl["pts"]) == 2 and abs(pl["pts"][0][1] - pl["pts"][1][1]) < 0.3
              and abs(pl["pts"][0][0] - pl["pts"][1][0]) > 0.35 * pw]
        vs = [pl for pl in pls if len(pl["pts"]) == 2 and abs(pl["pts"][0][0] - pl["pts"][1][0]) < 0.3
              and abs(pl["pts"][0][1] - pl["pts"][1][1]) > 0.35 * ph]
        if hs and vs:
            xs = [p[0] for pl in hs for p in pl["pts"]]
            ys = [p[1] for pl in vs for p in pl["pts"]]
            cands.append((min(xs), min(ys), max(xs), max(ys)))
    uniq = []
    for c in sorted(set(tuple(round(v, 1) for v in c) for c in cands), key=lambda c: (c[2] - c[0]) * (c[3] - c[1])):
        if not any(abs(c[i] - u[i]) < 2 for u in uniq for i in range(4) if all(abs(c[j] - u[j]) < 2 for j in range(4))):
            uniq.append(c)
    # a rectangle that merely surrounds another candidate is a background, not a frame
    frames = [c for c in uniq if not any(o != c and c[0] <= o[0] + 1 and c[1] <= o[1] + 1 and c[2] >= o[2] - 1 and c[3] >= o[3] - 1
                                         and (c[2] - c[0]) * (c[3] - c[1]) > 1.15 * (o[2] - o[0]) * (o[3] - o[1]) for o in uniq)]
    return frames[:6]


def read_axes(frame, pls, lines):
    """Fit both axes of one frame from its tick labels.  Returns a dict or None."""
    x0, y0, x1, y1 = frame
    # tick marks: short strokes that start on the frame edge
    xt, yt = [], []
    for pl in pls:
        if len(pl["pts"]) != 2:
            continue
        (ax, ay), (bx, by) = pl["pts"]
        ln = math.hypot(bx - ax, by - ay)
        if not 1.0 <= ln <= 14:
            continue
        if abs(ax - bx) < 0.2 and min(abs(ay - y1), abs(by - y1)) < 1.0 and x0 - 1 <= ax <= x1 + 1:
            xt.append((ax, ln))
        if abs(ay - by) < 0.2 and min(abs(ax - x0), abs(bx - x0)) < 1.0 and y0 - 1 <= ay <= y1 + 1:
            yt.append((ay, ln))
    # labels sit at the long (major) ticks; the short minor ticks would mislead the snapping
    xt = [pos for pos, ln in xt if ln >= 0.75 * max(l for _, l in xt)]
    yt = [pos for pos, ln in yt if ln >= 0.75 * max(l for _, l in yt)]

    def snap(v, marks):
        near = min(marks, key=lambda m: abs(m - v)) if marks else None
        return near if near is not None and abs(near - v) <= 4.0 else v

    xspans, yspans, xtitle, ytitle, everything = [], [], [], [], []
    for spans, bb, horiz in lines:
        text = "".join(sp[0] for sp in spans)
        everything.append(text)
        wordy = len(re.findall(r"[A-Za-z\u0370-\u03ff]", text)) >= 2
        cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
        below = bb[1] >= y1 - 2 and x0 - 25 <= cx <= x1 + 25
        if not horiz:
            if bb[2] <= x0 + 2:
                ytitle.append((-bb[1], text))
            continue
        if wordy:
            if below:
                xtitle.append((bb[1], text))
            elif bb[3] <= y0 + 2 and bb[0] < x0 + 0.5 * (x1 - x0) and len(text) < 12:
                ytitle.append((0, text))                    # a unit written above the y axis
            continue
        for sp in spans:                                    # numbers and exponents: sort out by position
            b = sp[2]
            scx, scy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            if b[1] >= y1 - 3 and b[1] <= y1 + 2.6 * sp[1] and x0 - 25 <= scx <= x1 + 25:
                xspans.append(sp)
            elif b[2] <= x0 + 2 and b[2] >= x0 - 9 * sp[1] and y0 - 12 <= scy <= y1 + 12:
                yspans.append(sp)
    xticks = [(snap(pos, xt), v) for pos, v in tick_labels(xspans, "x")]
    yticks = [(snap(pos, yt), v) for pos, v in tick_labels(yspans, "y")]
    xticks, xfix = _restore_minus(xticks, increasing_with_position=True)
    yticks, yfix = _restore_minus(yticks, increasing_with_position=False)   # page y runs downward
    fx, fy = fit_axis(xticks), fit_axis(yticks)
    if not fx or not fy:
        return None
    return {"x": fx[0], "y": fy[0], "x_log": fx[1], "y_log": fy[1], "misfit": max(fx[2], fy[2]),
            "n_ticks": (len(set(xticks)), len(set(yticks))), "sign_restored": xfix or yfix,
            "xvals": sorted({v for _, v in xticks}), "yvals": sorted({v for _, v in yticks}),
            "xtitle": " ".join(t for _, t in sorted(xtitle)), "ytitle": " ".join(t for _, t in sorted(ytitle)),
            "text": " ".join(everything)}


def legend_names(frame, pls, lines):
    """Names from legend samples (a short flat line or small box with text to its right), keyed
    from most to least specific: (colour, dash pattern, width), (colour, dash pattern),
    (colour, dashed?), (colour,).  Also returns where the samples are."""
    x0, y0, x1, y1 = frame
    names, samples = {}, []
    for pl in pls:
        xs, ys = [p[0] for p in pl["pts"]], [p[1] for p in pl["pts"]]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        sample = (not pl.get("rect") and len(pl["pts"]) <= 4 and h < 0.6 and 6 <= w <= 60 and pl["stroked"]) or \
                 (pl["closed"] and len(pl["pts"]) <= 6 and 6 <= w <= 60 and 2 <= h <= 20)
        if not sample or not (x0 - 2 <= min(xs) and max(xs) <= x1 + 200 and y0 - 60 <= min(ys) and max(ys) <= y1 + 60):
            continue
        cy, right = (min(ys) + max(ys)) / 2, max(xs)
        best = None
        for spans, bb, horiz in lines:
            if horiz and 0 <= bb[0] - right <= 22 and abs((bb[1] + bb[3]) / 2 - cy) <= 5:
                if best is None or bb[0] < best[0]:
                    best = (bb[0], "".join(s[0] for s in spans).strip())
        if best and best[1] and parse_tick([(best[1], 1)]) is None:
            colour = pl["color"] if pl["stroked"] and pl["color"] else pl["fill"]
            for key in ((colour, pl["dash"], round(pl["width"], 1)), (colour, pl["dash"]), (colour, pl["dashed"]), (colour,)):
                names.setdefault(key, best[1])
            samples.append(((min(xs) + max(xs)) / 2, cy))
    return names, samples


def _name_from_annotations(curves, frame, lines, legend_texts):
    """Many limit plots name their curves with text written next to each line ('LZ (2023)'),
    often rotated to follow it and often in the line's colour.  Give each such text to the curve
    it sits on: nearest curve wins, and a matching colour counts strongly in its favour."""
    x0, y0, x1, y1 = frame
    notes = []
    for spans, bb, horiz in lines:
        text = "".join(sp[0] for sp in spans).strip()
        cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
        if not (x0 < cx < x1 and y0 < cy < y1) or text in legend_texts or len(re.findall(r"[A-Za-z]", text)) < 2 or len(text) > 60:
            continue
        notes.append((text, cx, cy, spans[0][3]))
    pairs = []
    for ni, (text, cx, cy, colour) in enumerate(notes):
        for ci, c in enumerate(curves):
            d = min(math.hypot(px - cx, py - cy) for px, py in c["_page"])
            if colour == c["colour"] and colour not in ("#000000", "#ffffff"):
                d *= 0.2
            # a line the legend already names takes a text label only if the text sits right on it
            if d < (15 if c["label"] else 45):
                pairs.append((d, ni, ci))
    used_n, used_c = set(), set()
    for d, ni, ci in sorted(pairs):
        if ni in used_n or ci in used_c:
            continue
        used_n.add(ni)
        used_c.add(ci)
        c = curves[ci]
        c["label"] = "%s: %s" % (notes[ni][0], c["label"]) if c["label"] else notes[ni][0]
        c["named_by"] = "text beside the line"


def page_curves(page, name=""):
    """All candidate curves on one page.  Returns (curves, remark)."""
    pls = polylines(page)
    lines = text_lines(page)
    frames = find_frames(page, pls)
    if not frames:
        return [], "no plot frame found"
    out, remarks = [], []
    for fi, frame in enumerate(frames):
        axes = read_axes(frame, pls, lines)
        if not axes:
            remarks.append("axis labels unreadable")
            continue
        if axes["misfit"] > 2.5:                         # the labels do not line up as a log or linear scale
            remarks.append("axis scale could not be read reliably")
            continue
        x0, y0, x1, y1 = frame
        diag = math.hypot(x1 - x0, y1 - y0)
        names, samples = legend_names(frame, pls, lines)
        for pl in pls:
            if pl.get("rect") or not pl["stroked"] or len(pl["pts"]) < 6:
                continue
            inside = [p for p in pl["pts"] if x0 - 1.5 <= p[0] <= x1 + 1.5 and y0 - 1.5 <= p[1] <= y1 + 1.5]
            if len(inside) < 0.85 * len(pl["pts"]) or len(inside) < 6:
                continue
            xs, ys = [p[0] for p in inside], [p[1] for p in inside]
            if max(xs) - min(xs) < 0.04 * (x1 - x0) or max(ys) - min(ys) < 1.0 or _length(inside) < 0.12 * diag:
                continue                                # too small, or a flat rule
            step = max(1, len(inside) // MAX_POINTS)
            keep = inside[::step] + ([inside[-1]] if (len(inside) - 1) % step else [])
            try:
                pts = [(axes["x"](p[0]), axes["y"](p[1])) for p in keep]
            except OverflowError:
                continue
            region = pl["closed"] and bool(pl["fill"])
            if pl["closed"] and any(min(xs) <= sx <= max(xs) and min(ys) <= sy <= max(ys) for sx, sy in samples):
                continue                                # the legend's own box
            label = None
            for key in ((pl["color"], pl["dash"], round(pl["width"], 1)), (pl["color"], pl["dash"]),
                        (pl["color"], pl["dashed"]), (pl["color"],)):
                if key in names:
                    label, exact = names[key], len(key) == 3
                    break
            if label is None and region:
                label = names.get((pl["fill"],))
            out.append({"points": pts, "shape": "region" if region else "line", "colour": pl["color"], "dashed": pl["dashed"],
                        "label": label or "", "xtitle": axes["xtitle"], "ytitle": axes["ytitle"], "text": axes["text"],
                        "x_log": axes["x_log"], "y_log": axes["y_log"], "misfit": axes["misfit"], "n_ticks": axes["n_ticks"],
                        "xvals": axes["xvals"], "yvals": axes["yvals"], "sign_restored": axes["sign_restored"],
                        "file": name, "panel": fi + 1 if len(frames) > 1 else 0, "_page": inside, "_frame": fi})
        _name_from_annotations([c for c in out if c["_frame"] == fi], frame, lines, set(names.values()))
    for c in out:
        c.pop("_page", None)
        c.pop("_frame", None)
    if not out and not remarks:
        remarks.append("no curves inside the frame")
    return out, "; ".join(sorted(set(remarks)))


def _eps_to_pdf(data):
    """EPS/PS -> PDF bytes with Ghostscript, or None if it is not installed."""
    tool = shutil.which("gs") or shutil.which("gswin64c")
    if not tool:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "in.eps"), os.path.join(tmp, "out.pdf")
        with open(src, "wb") as f:
            f.write(data)
        try:
            subprocess.run([tool, "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-dEPSCrop", "-sDEVICE=pdfwrite",
                            "-sOutputFile=" + dst, src], check=True, timeout=60, capture_output=True)
            with open(dst, "rb") as f:
                return f.read()
        except Exception:
            return None


def figure_curves(data, name):
    """Candidate curves in one figure file given as bytes.  Returns (curves, remark)."""
    if pymupdf is None:
        raise RuntimeError("PyMuPDF is not installed (pip install pymupdf)")
    ext = os.path.splitext(name)[1].lower()
    if ext in (".eps", ".ps"):
        data = _eps_to_pdf(data)
        if data is None:
            return [], "EPS figure: needs Ghostscript (gs) to convert"
    elif ext != ".pdf":
        return [], "image figure: no vector data"
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as err:
        return [], "unreadable (%s)" % str(err)[:60]
    if doc.page_count == 0 or doc.page_count > 3:       # a multi-page PDF is the paper, not a figure
        return [], "not a single figure"
    curves, remarks = [], []
    for page in doc:
        if len(page.get_drawings()) > 60000:
            remarks.append("too many paths (scatter plot?)")
            continue
        got, remark = page_curves(page, name)
        curves += got
        if remark:
            remarks.append(remark)
    return curves, "; ".join(remarks)


def install(target=VENDOR):
    """Download PyMuPDF from PyPI and unpack it into tools/vendor/.  Uses only the standard
    library, so it works where pip is missing and without admin rights."""
    import json
    import platform
    import urllib.request
    import zipfile
    py = sys.version_info[:2]
    machine = platform.machine().lower()
    arch = {"amd64": "x86_64", "arm64": "aarch64"}.get(machine, machine)
    system = platform.system()
    glibc = tuple(int(v) for v in (platform.libc_ver()[1] or "2.17").split(".")[:2])

    def platform_ok(tag):
        if system == "Linux":
            m = re.fullmatch(r"manylinux_(\d+)_(\d+)_(\w+)", tag)
            if m:
                return m.group(3) == arch and (int(m.group(1)), int(m.group(2))) <= glibc
            return tag in ("manylinux2014_" + arch, "manylinux2010_" + arch, "manylinux1_" + arch) and glibc >= (2, 17)
        if system == "Darwin":
            return tag.startswith("macosx_") and tag.endswith("arm64" if arch == "aarch64" else arch)
        if system == "Windows":
            return tag == "win_amd64" and arch == "x86_64"
        return False

    def wheel_ok(name):
        parts = name[:-4].split("-")
        if len(parts) < 5:
            return False
        pytag, abi, plats = parts[-3], parts[-2], parts[-1].split(".")
        m = re.fullmatch(r"cp(\d)(\d+)", pytag)
        if not m:
            return False
        built = (int(m.group(1)), int(m.group(2)))
        python_ok = (abi == "abi3" and built <= py) or (abi != "abi3" and built == py)
        return python_ok and any(platform_ok(t) for t in plats)

    def fetch(url):
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ucr-darkmatter-limits/1.0"}), timeout=120) as r:
            return r.read()

    print("Looking for a PyMuPDF build for Python %d.%d on %s %s (glibc %d.%d)" % (py + (system, arch) + glibc))
    info = json.loads(fetch("https://pypi.org/pypi/PyMuPDF/json"))

    def version_key(v):
        return tuple(int(x) for x in re.findall(r"\d+", v)[:4])
    chosen = None
    for version in sorted(info["releases"], key=version_key, reverse=True):
        if re.search(r"[a-z]", version):                 # skip pre-releases
            continue
        files = [f for f in info["releases"][version] if f["filename"].endswith(".whl") and not f.get("yanked") and wheel_ok(f["filename"])]
        if files:
            chosen = (version, files[0])
            break
    if not chosen:
        sys.exit("No ready-made PyMuPDF build fits this machine. Run the figure step on another computer instead "
                 "(see the README), or ask the server's admin for: pip install pymupdf")
    version, f = chosen
    wheels = [(f["filename"], f["url"])]
    # newer releases keep the compiled part in a companion package, PyMuPDFb
    try:
        req = json.loads(fetch("https://pypi.org/pypi/PyMuPDF/%s/json" % version))["info"].get("requires_dist") or []
        for r in req:
            m = re.match(r"\s*(PyMuPDFb)\s*==\s*([\w.]+)", r)
            if m:
                extra = json.loads(fetch("https://pypi.org/pypi/%s/%s/json" % (m.group(1), m.group(2))))["urls"]
                fit = [e for e in extra if e["filename"].endswith(".whl") and any(platform_ok(t) for t in e["filename"][:-4].split("-")[-1].split("."))]
                if fit:
                    wheels.append((fit[0]["filename"], fit[0]["url"]))
    except Exception as err:
        print("  (could not check for companion packages: %s)" % err)
    os.makedirs(target, exist_ok=True)
    for name, url in wheels:
        print("  downloading %s" % name)
        data = fetch(url)
        with zipfile.ZipFile(__import__("io").BytesIO(data)) as z:
            z.extractall(target)
    print("Unpacked PyMuPDF %s into %s" % (version, target))
    import subprocess as sp
    test = sp.run([sys.executable, "-c", "import sys; sys.path.insert(0, %r); import pymupdf; print(pymupdf.__file__)" % target],
                  capture_output=True, text=True)
    if test.returncode == 0:
        print("Works: %s" % test.stdout.strip().splitlines()[-1])
    else:
        print("Unpacked, but it does not load on this machine:\n" + test.stderr.strip()[-600:])
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    if sys.argv[1] == "--install":
        install()
        sys.exit(0)
    for path in sys.argv[1:]:
        with open(path, "rb") as fh:
            found, why = figure_curves(fh.read(), path)
        print("%s: %d curves%s" % (path, len(found), "  (%s)" % why if why else ""))
        for c in found:
            xs, ys = [p[0] for p in c["points"]], [p[1] for p in c["points"]]
            print("  %-6s %s%s  %-28s x %.3g..%.3g  y %.3g..%.3g  %d pts  [%s | %s] ticks %s misfit %.2f pt" % (
                c["shape"], c["colour"], " dashed" if c["dashed"] else "", (c["label"] or "(no legend match)")[:28],
                min(xs), max(xs), min(ys), max(ys), len(xs), c["xtitle"][:24], c["ytitle"][:30], c["n_ticks"], c["misfit"]))
