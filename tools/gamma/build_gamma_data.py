#!/usr/bin/env python3
"""Build the Gamma Line Explorer's data files.

    python3 tools/gamma/build_gamma_data.py LIVECHART_DIR CASCADE_LEVELS_DIR

LIVECHART_DIR       output of fetch_livechart.py (branch "gamma-data", folder livechart/)
CASCADE_LEVELS_DIR  G4RiversideCASCADE's Supplemental/LevelStructureTXTs (https://github.com/UCRDarkMatter/CASCADE)
Writes data/gamma/core.json (sources relevant to low-background work) and data/gamma/all.json (every other decay).
Needs: numpy, periodictable, xraylib (pip install --user ...). Runs in a minute or two.
"""
import csv
import datetime
import io
import json
import math
import os
import re
import sys

import periodictable as pt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import capture                                          # noqa: E402
import curation as K                                    # noqa: E402
import materials as MAT                                 # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "gamma")
MIN_I = 0.01          # % per decay: weaker decay lines are dropped
MIN_I_ALL = 0.05      # stricter cut for the tier-3 file
SUP = str.maketrans("0123456789m", "⁰¹²³⁴⁵⁶⁷⁸⁹ᵐ")


def pretty(n):
    m = re.match(r"(\d+)(m?\d*)([A-Z][a-z]?)$", n)
    return (m.group(1) + ("m" if m.group(2) else "")).translate(SUP) + m.group(3) if m else n


def fnum(x):
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def read_csv(path):
    txt = open(path, encoding="utf-8", errors="replace").read()
    if not txt.strip() or txt.lstrip().startswith(("<", "{")):
        return []
    return list(csv.DictReader(io.StringIO(txt)))


def ensdf_ref(row, what):
    """Citation of the ENSDF evaluation a LiveChart row comes from."""
    au = re.sub(r"\s+", " ", (row.get("ensdf_authors") or "").strip()).replace(" and ", ", ").replace(", ,", ",")
    if au.isupper():
        au = au.title()
    cut = (row.get("ensdf_publication_cut-off") or "").strip()
    out = "%s: ENSDF evaluation" % what
    if au:
        out += " by " + au
    if cut:
        out += " (literature cut-off " + cut + ")"
    return out + ", retrieved from the IAEA LiveChart of Nuclides " + (row.get("Extraction_date") or "").strip() + "."


def nuc_name(z, n, sym, iso=""):
    return "%d%s%s" % (int(z) + int(n), iso, sym.capitalize() if len(sym) == 1 else sym[0].upper() + sym[1:].lower())


# ------------------------------------------------------------------ ground states: half-lives and decay modes
def ground_states(lc):
    gs = {}
    for r in read_csv(os.path.join(lc, "ground_states.csv")):
        name = nuc_name(r["z"], r["n"], r["symbol"])
        hl = fnum(r.get("half_life_sec"))
        if (r.get("half_life") or "").strip().upper() == "STABLE":
            hl = float("inf")
        modes = []
        for k in range(1, 4):
            d, p = r.get("decay_%d" % k), fnum(r.get("decay_%d_%%" % k))
            if d:
                modes.append((d.strip(), p))
        gs[name] = {"z": int(r["z"]), "n": int(r["n"]), "hl": hl, "modes": modes, "ab": fnum(r.get("abundance"))}
    return gs


DAUGHTER = {"B-": (1, 0), "EC": (-1, 0), "EC+B+": (-1, 0), "B+": (-1, 0), "A": (-2, -4), "IT": (0, 0), "2B-": (2, 0), "B-N": (1, -1)}


def daughters(name, gs):
    g = gs.get(name)
    if not g:
        return []
    out = []
    for mode, p in g["modes"]:
        dz, da = DAUGHTER.get(mode, (None, None))
        if dz is None:
            continue
        z, a = g["z"] + dz, g["z"] + g["n"] + da
        try:
            sym = pt.elements[z].symbol
        except Exception:
            continue
        out.append(["%d%s" % (a, sym), p if p is not None else 100.0])
    return out


# ------------------------------------------------------------------ decay lines
def decay_sources(lc, gs):
    src = {}
    files = []
    for sub in ("decay", "xray"):
        ddir = os.path.join(lc, sub)
        if os.path.isdir(ddir):
            files += [(sub, os.path.join(ddir, f), f) for f in sorted(os.listdir(ddir))]
    for sub, path, f in files:
        rows = read_csv(path)
        if not rows:
            continue
        by_parent = {}
        for r in rows:
            e, i = fnum(r.get("energy")), fnum(r.get("intensity"))
            if e is None or i is None or i <= 0:
                continue
            if sub == "xray" and ((r.get("shell") or "").strip().upper() != "K" or e < 5):
                continue                                         # keep K X-rays only
            kind = (r.get("type_x") or r.get("rad_type") or "").strip()
            pe = fnum(r.get("p_energy")) or 0.0                       # parent level: 0 = ground state, >0 = isomer
            try:
                z, n, sym = int(r["p_z"]), int(r["p_n"]), r["p_symbol"]
            except (KeyError, ValueError):
                m = re.match(r"(\d+)([a-z]+)", f[:-4]); z = n = None; sym = m.group(2)
                a = int(m.group(1))
            name = nuc_name(z, n, sym) if z is not None else "%d%s" % (a, sym.capitalize())
            if pe > 0:
                name = re.sub(r"^(\d+)", r"\1m", name)
            d = by_parent.setdefault(name, {"lines": [], "hl": fnum(r.get("p_half_life_sec") or r.get("half_life_sec")), "lev": {}})
            if sub == "decay" and "ref" not in d:
                d["ref"] = ensdf_ref(r, "Decay data")
            is_x = sub == "xray"
            d["lines"].append([round(e, 3), i, "x" if is_x else "", fnum(r.get("start_level_energy")), fnum(r.get("end_level_energy")), (r.get("decay") or "").strip()])
        for name, d in by_parent.items():
            if name in src:
                src[name]["lines"] += d["lines"]
                src[name]["hl"] = src[name]["hl"] or d["hl"]
                src[name].setdefault("ref", d.get("ref"))
            else:
                src[name] = d
    return src


def decay_coincidences(lines):
    """Coincidences within one decay from the gamma start/end levels: P(other line | this line).
    Approximation: the daughter's level populations come from the gamma intensities themselves."""
    g = [l for l in lines if l[2] != "x" and l[3] is not None and l[4] is not None]
    if len(g) < 2:
        return {}
    feed_out = {}
    for l in g:
        feed_out.setdefault(round(l[3], 1), 0.0)
        feed_out[round(l[3], 1)] += l[1]
    levels = sorted(set([round(l[3], 1) for l in g] + [round(l[4], 1) for l in g]))
    # P(reach level b | at level a) through the gamma cascade
    out = {lv: [(round(l[4], 1), l[1] / feed_out[lv]) for l in g if round(l[3], 1) == lv] for lv in feed_out}
    reach = {}
    for lv in levels:                                   # ascending: lower levels done first
        r = {lv: 1.0}
        for to, p in out.get(lv, []):
            for k, v in reach.get(to, {to: 1.0}).items():
                r[k] = r.get(k, 0) + p * v
        reach[lv] = r
    res = {}
    strong = sorted(range(len(lines)), key=lambda k: -lines[k][1])[:25]
    for a in strong:
        la = lines[a]
        if la[2] == "x" or la[3] is None or la[4] is None or la[1] < 0.5:
            continue
        part = []
        for b in strong:
            lb = lines[b]
            if b == a or lb[2] == "x" or lb[3] is None or lb[4] is None:
                continue
            sa, ea, sb, eb = round(la[3], 1), round(la[4], 1), round(lb[3], 1), round(lb[4], 1)
            if sb <= ea:                                # b below a
                p = reach.get(ea, {}).get(sb, 0) * lb[1] / feed_out.get(sb, 1e-9)
            elif sa <= eb:                              # b above a: P(b | a) = I_b * P(reach a's start from b's end) * frac_a / I_a
                p = lb[1] * reach.get(eb, {}).get(sa, 0) * (la[1] / feed_out.get(sa, 1e-9)) / la[1]
            else:
                continue
            if p >= 0.03:
                part.append([round(lb[0], 2), round(min(p, 1.0), 3)])
        if part:
            part.sort(key=lambda t: -t[1])
            res[a] = part[:8]
    return res


# ------------------------------------------------------------------ tiers and context for decays
def decay_context(name, gs):
    ctx = {"tier": 3}
    base = re.sub(r"m$", "", name)
    for key, chain in (("U238", K.U238), ("Th232", K.TH232), ("U235", K.U235)):
        if name in chain:
            ctx.update(tier=1 if key != "U235" else 2, chain=key, chainName=K.CHAIN_TEXT[key], where=K.PRIMORDIAL_WHERE,
                       tests=list(K.CHAIN_TESTS[key]), how="Member of the " + K.CHAIN_TEXT[key] + ".")
            if name in K.SEGMENTS:
                ctx["seg"] = K.SEGMENTS[name]
            i = chain.index(name)
            if i:
                ctx["par"] = "d:" + chain[i - 1]
            longest = max(chain[:i + 1], key=lambda c: (gs.get(c, {}).get("hl") or 0) if c in K.SEGMENTS and K.SEGMENTS.get(c) == K.SEGMENTS.get(name) else 0)
            if longest != name and gs.get(longest, {}).get("hl"):
                ctx["sup"] = [longest, gs[longest]["hl"]]
            if name in K.RADON:
                ctx["radon"] = 1
    if name in K.PRIMORDIAL_OTHER:
        w, t = K.PRIMORDIAL_OTHER[name]
        ctx.update(tier=1 if name == "40K" else 2, where=w, tests=t, how="Primordial radionuclide.")
    cos = [m for m, lst in K.COSMOGENIC.items() if name in lst]
    if cos:
        ctx["cosmo"] = cos
        ctx["tier"] = min(ctx["tier"], 2)
        ctx.setdefault("how", "Cosmogenic: made by cosmic-ray neutrons and protons in " + ", ".join(cos_names(cos)) + ".")
        ctx.setdefault("where", "Materials with surface exposure: " + ", ".join(cos_names(cos)) + ".")
        ctx["tests"] = ctx.get("tests", []) + K.COSMO_TESTS
    if name in K.ANTHRO:
        ctx["tier"] = min(ctx["tier"], 2)
        ctx.setdefault("where", K.ANTHRO[name])
        ctx.setdefault("how", K.ANTHRO[name])
        ctx["tests"] = ctx.get("tests", []) + K.ANTHRO_TESTS
    return ctx


MAT_NAMES = {"cu": "copper", "ge": "germanium", "steel": "steel", "ar": "argon", "xe": "xenon", "nai": "NaI", "csi": "CsI",
             "ti": "titanium", "al": "aluminium", "te": "tellurium", "pb": "lead", "ptfe": "PTFE"}


def cos_names(lst):
    return [MAT_NAMES.get(m, m) for m in lst]


# ------------------------------------------------------------------ neutron capture by element
SIGMA_GAMMA = {(5, 10): 0.5, (3, 6): 0.0385, (7, 14): 0.0795, (2, 3): 3.1e-5}     # (n,γ) part where absorption is mostly not capture


def conversion_table(lc):
    """(Z, A) -> list of (Eγ, total conversion coefficient) from the ENSDF level-gamma files."""
    tab = {}
    gdir = os.path.join(lc, "gammas")
    for f in os.listdir(gdir):
        for r in read_csv(os.path.join(gdir, f)):
            cc, e = fnum(r.get("tot_conv_coeff")), fnum(r.get("energy"))
            if cc and e:
                tab.setdefault((int(r["z"]), int(r["z"]) + int(r["n"])), []).append((e, cc))
    return tab


CASCADE_REF = ("Level scheme and branching ratios: G4RiversideCASCADE capture data (L. Weimer, E. Ellingwood, O. Fischer, M. Lai, "
               "S. Westerdale, Nucl. Instrum. Meth. A 1093 (2027) 171940, doi:10.1016/j.nima.2026.171940), built from ENSDF thermal-neutron-capture "
               "evaluations; line intensities computed here by following every branch of the cascade.")
SIGMA_REF = ("Thermal (2200 m/s) absorption cross section: H. Rauch and W. Waschkowski, Neutron Scattering Lengths, ILL Neutron Data Booklet, "
             "2nd ed. (2003), via the periodictable package" )
ABUND_REF = "Isotopic abundance: IAEA LiveChart of Nuclides (ENSDF/NUBASE ground-state data)."


def capture_sources(levels_dir, gs, conv):
    iso = capture.all_targets(levels_dir)
    out = []
    elem_rate = {}
    for (z, a) in iso:
        el = pt.elements[z]
        if z in elem_rate:
            continue
        tot = 0.0
        for i in el:
            ab = (gs.get("%d%s" % (i.isotope, el.symbol), {}).get("ab") or 0) / 100
            if ab > 0:
                sig = SIGMA_GAMMA.get((z, i.isotope))
                if sig is None:
                    try:
                        sig = i.neutron.absorption or 0
                    except Exception:
                        sig = 0
                tot += ab * sig
        elem_rate[z] = tot
    for (z, a), r in sorted(iso.items()):
        el = pt.elements[z]
        sym = el.symbol
        tgt = "%d%s" % (a, sym)
        ab = (gs.get(tgt, {}).get("ab") or 0)
        if ab <= 0:
            continue                                   # radioactive or not naturally present: skip
        sig = SIGMA_GAMMA.get((z, a))
        if sig is None:
            try:
                sig = el[a].neutron.absorption or 0
            except Exception:
                sig = 0
        rate = ab / 100 * sig                          # barns per atom of the natural element
        share = rate / elem_rate[z] if elem_rate.get(z) else 0
        ctab = conv.get((z, a + 1), [])
        lines = []
        for ln in r["lines"]:
            I = ln["i"]
            flags = "p" if ln.get("pe") else ""
            cc = [c for e, c in ctab if abs(e - ln["e"]) < 0.6]
            if cc:
                I /= 1 + cc[0]                         # internal conversion: fewer photons than transitions
            elif ln["e"] < 150:
                flags += "k"                           # low energy, conversion unknown: intensity is an upper limit
            if I < 0.1 and not ln.get("c"):
                continue
            lines.append([ln["e"], round(I, 3), flags, "", ln.get("c")])
        lines = sorted(sorted(lines, key=lambda l: -l[1])[:70], key=lambda l: l[0])
        L, coinc = [], {}
        for k, l in enumerate(lines):
            L.append(l[:4])
            if l[4]:
                coinc[k] = l[4]
        if not L:
            continue
        prod = "%d%s" % (a + 1, sym)
        mats = [m for m, els in K.MATERIAL_ELEMENTS.items() if sym in els]
        det = {"Ge": ["hpge"], "Ar": ["lar"], "Xe": ["lxe"], "Na": ["nai"], "I": ["nai"], "H": ["plastic"], "C": ["plastic"]}.get(sym, [])
        nm = "%s(n,γ)%s" % (pretty(tgt), pretty(prod))
        src = {"id": "c:" + tgt, "name": nm, "kind": "capture", "elem": sym, "ntype": "thermal",
               "ab": ab, "sig": round(sig, 6), "M": round(el.mass, 4),
               "key": ("%s %s %s %s capture ncapture ngamma neutroncapture %s-%d" % (tgt, sym + str(a), el.name, sym, sym, a)).lower().replace(" ", ""),
               "tier": 1 if sym in ("H", "Fe", "Cu", "Ge", "Cl", "Pb", "Ar", "Gd", "Cd", "Na", "I", "Xe", "Si", "Al", "Ca", "Mn", "Ni", "Cr", "N", "Ti", "K", "B") else 2,
               "mats": mats, "det": det, "always": sym in K.ALWAYS_ELEMENTS, "wt": round(min(rate, 50), 4),
               "how": "Thermal-neutron capture on %s (%.4g%% of natural %s, σ ≈ %s b): %s of captures in natural %s. The compound nucleus %s emits ≈ %.1f gammas per capture (separation energy %.0f keV)." % (
                   pretty(tgt), ab, el.name, "%.3g" % sig, ("%.1f%%" % (100 * share)) if share >= 0.001 else "<0.1%", el.name, pretty(prod), r["mult"], r["sn"]),
               "where": "Anywhere %s sits in a thermal neutron flux." % el.name + (" Present in: " + ", ".join(MAT_NAMES.get(m, m) for m in mats) + "." if mats else ""),
               "tests": ["Rate follows the thermal neutron flux: it rises with moderators (water, polyethylene) nearby and drops with boron or cadmium shielding.",
                         "Appears or grows during neutron-source calibrations and falls back afterwards with no delay.",
                         "Strong lines come with coincident partners from the same cascade (see the table); several of them should be present together."],
               "unit": "Intensity: gammas per 100 captures on %s." % pretty(tgt),
               "L": L, "C": {str(k): v for k, v in coinc.items()},
               "refs": ["@cascade", "@sigma", "@abund"]}
        if sym == "H":
            src["tests"] = ["The 2223 keV line follows the thermal neutron flux in hydrogenous material (water, polyethylene, people, scintillator).",
                            "No coincident gamma: a single line per capture.", "Delayed by ~200 µs after a neutron enters water or scintillator (thermalisation and capture time)."]
        if sym == "Gd":
            src["tests"].append("Gadolinium-loaded scintillators and water show this strongly; capture gammas total about 8 MeV per capture.")
        if (z, a) in SIGMA_GAMMA:
            src["refs"][1] = "Thermal (n,γ) cross section: only the radiative-capture part of the absorption (the rest is a charged-particle reaction); approximate value."
        g = gs.get(prod)
        if g and g["hl"] and math.isfinite(g["hl"]) and share > 0.02:
            src["act"] = prod
        out.append(src)
    return out


# ------------------------------------------------------------------ inelastic (n,n'γ)
INEL_ELEMS = {}


def inelastic_sources(lc, gs):
    out = []
    gdir = os.path.join(lc, "gammas")
    for f in sorted(os.listdir(gdir)):
        m = re.match(r"(\d+)([a-z]+)\.csv", f)
        if not m:
            continue
        a, sym = int(m.group(1)), m.group(2).capitalize()
        el = pt.elements.symbol(sym)
        tgt = "%d%s" % (a, sym)
        ab = gs.get(tgt, {}).get("ab") or 0
        if ab < 0.5 and sym != "Ge":
            continue
        rows = read_csv(os.path.join(gdir, f))
        if not rows:
            continue
        per = {}
        for r in rows:
            e = fnum(r.get("energy"))
            st = fnum(r.get("start_level_energy") or r.get("level_energy"))
            ri = fnum(r.get("relative_intensity") or r.get("intensity"))
            cc = fnum(r.get("tot_conv_coeff")) or 0.0
            if e is None or st is None or st > 3200 or e < 30 or (r.get("multipolarity") or "").strip() == "E0":
                continue
            per.setdefault(st, []).append((e, ri if ri is not None else 100.0, cc))
        L = []
        for st, gl in per.items():                     # photon fraction of each gamma among its level's decays
            tot = sum(ri * (1 + cc) for _, ri, cc in gl) or 1.0
            for e, ri, cc in gl:
                w = math.exp(-st / 1500.0) * ri / tot   # higher levels need faster neutrons: rough weight
                L.append([round(e, 2), w, "b" if a < 30 else "", "level %.0f keV" % st])
        if not L:
            continue
        mx = max(l[1] for l in L)
        L = [[l[0], round(100 * l[1] / mx, 1), l[2], l[3]] for l in L if l[1] / mx > 0.02]
        L = sorted(sorted(L, key=lambda l: -l[1])[:30], key=lambda l: l[0])
        mats = [m for m, els in K.MATERIAL_ELEMENTS.items() if sym in els]
        det = {"Ge": ["hpge"], "Ar": ["lar"], "Xe": ["lxe"], "Na": ["nai"], "I": ["nai"]}.get(sym, [])
        out.append({"id": "i:" + tgt, "name": "%s(n,n′γ)%s" % (pretty(tgt), pretty(tgt)), "kind": "inel", "elem": sym, "ntype": "fast", "ab": ab,
                    "M": round(el.mass, 4),
                    "key": ("%s %s %s %s inelastic nn' fastneutron %s-%d" % (tgt, sym + str(a), el.name, sym, sym, a)).lower().replace(" ", ""),
                    "tier": 1 if sym in ("Ge", "Pb", "Fe", "Cu", "Ar", "Xe", "Al", "Na", "I", "O", "C", "Si", "F") else 2,
                    "mats": mats, "det": det, "always": sym in K.ALWAYS_ELEMENTS,
                    "how": "Fast neutrons (from (α,n) reactions and fission in rock, and from cosmic-ray muons) excite low-lying levels of %s (%.4g%% of natural %s), which emit these gammas." % (pretty(tgt), ab, el.name),
                    "where": "Anywhere %s sees fast neutrons." % el.name + (" Present in: " + ", ".join(MAT_NAMES.get(m, m) for m in mats) + "." if mats else ""),
                    "tests": ["Rate follows the fast neutron flux; moderators reduce it, boron does not.",
                              "Lines from the first excited state are the strongest; higher levels need faster neutrons.",
                              "Inside a germanium or argon target the recoiling nucleus adds energy, giving an asymmetric tail to higher energy."],
                    "unit": "Relative weights only (strongest = 100), from each level's gamma branching and a factor favouring low-lying levels. For ranking, a total gamma-production cross section of 1 b per nucleus is assumed and shared by these weights; real strengths depend on the neutron spectrum and on per-level cross sections, which are not yet included.",
                    "L": L, "refs": [ensdf_ref(rows[0], "Level energies and gamma branching (adopted levels of %s)" % pretty(tgt)), "@abund"]})
    return out


# ------------------------------------------------------------------ X-rays
def xray_sources():
    import xraylib as x
    out = []
    names = [("Ka2", x.KL2_LINE, 50), ("Ka1", x.KL3_LINE, 100), ("Kb1", x.KM3_LINE, 20), ("Kb2", x.KN3_LINE, 6)]
    for sym, (mat, tier, text) in K.XRAY_ELEMENTS.items():
        z = pt.elements.symbol(sym).number
        L = []
        for nm, line, rel in names:
            try:
                e = x.LineEnergy(z, line)
                rr = x.RadRate(z, line) if hasattr(x, "RadRate") else rel / 100
            except Exception:
                continue
            if e > 1:
                L.append([round(e, 2), round(100 * rr, 2), "x", "K" + nm[1:].replace("a", "α").replace("b", "β")])
        if not L:
            continue
        mx = max(l[1] for l in L)
        L = [[l[0], round(100 * l[1] / mx, 1), l[2], l[3]] for l in L]
        L.sort(key=lambda l: l[0])
        out.append({"id": "x:" + sym, "name": "%s K X-rays" % sym, "kind": "xray", "key": ("%s %s xray x-ray fluorescence" % (sym, pt.elements.symbol(sym).name)).lower(),
                    "tier": tier, "when": {"mat": [mat]} if mat else {}, "how": text, "where": text,
                    "tests": ["X-ray energies are fixed by the element: all K lines of the element should appear together with these ratios.",
                              "Fluorescence grows with the gamma or beta activity hitting the material; a graded liner (Cd/Cu or Sn/Cu) suppresses lead X-rays."],
                    "unit": "Relative K-line intensities.", "L": L,
                    "refs": ["X-ray energies and radiative rates: xraylib %s (T. Schoonjans et al., Spectrochim. Acta B 66 (2011) 776–784, doi:10.1016/j.sab.2011.09.011)." % getattr(x, "__version__", "")]})
    return out


# ------------------------------------------------------------------ main
def main(lc, levels_dir):
    gs = ground_states(lc)
    dec = decay_sources(lc, gs)
    core, rest = [], []
    for name, d in dec.items():
        lines = [l for l in d["lines"] if l[1] >= MIN_I or (l[1] >= 0.001 and l[2] != "x")]
        if not lines:
            continue
        lines.sort(key=lambda l: l[0])
        ctx = decay_context(name, gs)
        hl = d["hl"] if d["hl"] else (gs.get(name, {}).get("hl"))
        coinc = decay_coincidences(lines)
        L = [[l[0], round(l[1], 4), l[2], ("X-ray" if l[2] == "x" else "")] for l in lines]
        s = {"id": "d:" + name, "name": pretty(name), "nuc": name, "kind": "decay", "tier": ctx["tier"], "hl": hl,
             "key": (name + " " + re.sub(r"(\d+)(m?)([A-Za-z]+)", r"\3\1\2 \3-\1\2", name) + " " + pt.elements.symbol(re.sub(r"^\d+m?", "", name)).name +
                     " " + " ".join(ctx.get("cosmo", []) and ["cosmogenic"] + cos_names(ctx["cosmo"])) + " " + ctx.get("chainName", "")).lower().replace("-", "").replace(" ", ""),
             "unit": "Intensity: gammas per 100 decays.", "L": L,
             "refs": [d.get("ref") or "Decay data: ENSDF, retrieved from the IAEA LiveChart of Nuclides."]}
        if coinc:
            s["C"] = {str(k): v for k, v in coinc.items()}
        dau = daughters(re.sub(r"m$", "", name) if not name[-1].isdigit() else name, gs)
        if dau:
            s["dau"] = dau
        for k in ("chain", "chainName", "seg", "par", "sup", "radon", "cosmo", "how", "where", "tests"):
            if k in ctx:
                s[k] = ctx[k]
        if s["tier"] <= 2:
            core.append(s)
        else:
            s["L"] = [l for l in s["L"] if l[1] >= MIN_I_ALL]
            if s["L"]:
                rest.append(s)
    # activity of each chain member relative to the top of its chain, following the decay branchings
    byname = {s["nuc"]: s for s in core + rest}
    for chain in (K.U238, K.TH232, K.U235):
        chain = [c for c in chain if c != "234Pa"]       # ²³⁴Pa is a 0.16% side branch of ²³⁴ᵐPa
        af = {chain[0]: 1.0}
        for prev, cur in zip(chain, chain[1:]):
            af[cur] = af[prev]
            for par in reversed(chain[:chain.index(cur)]):     # nearest earlier member that decays to cur
                br = [d[1] for d in (byname.get(par, {}).get("dau") or []) if d[0] == cur]
                if br:
                    af[cur] = af[par] * br[0] / 100
                    break
        if "234mPa" in af:
            af["234Pa"] = af["234mPa"] * 0.0016
        for n, v in af.items():
            if n in byname:
                byname[n]["af"] = round(v, 6)
    cap = capture_sources(levels_dir, gs, conversion_table(lc))
    # activation products of captured elements: promote to core with a note
    byid = {s["id"]: s for s in core + rest}
    for c in cap:
        for p in ([c["act"]] if c.get("act") else []):
            s = byid.get("d:" + p)
            if not s:
                continue
            note = "Made by neutron capture, %s: appears after neutron exposure and decays with its half-life." % c["name"]
            s.setdefault("how", note)
            s["tests"] = s.get("tests", []) + ["Grows during neutron calibrations or reactor operation and decays afterwards with its half-life."]
            s.setdefault("when", {})["n"] = ["source", "reactor"]
            s.setdefault("act", c["id"])
            if s in rest:
                rest.remove(s); s["tier"] = 2; core.append(s)
    inel = inelastic_sources(lc, gs)
    rx = []
    for r in K.REACTIONS:
        r = dict(r); r["kind"] = "rx"; r["L"] = r.pop("lines")
        r["key"] = (r["name"] + " " + r["id"]).lower().replace(" ", "")
        r["unit"] = r.get("unit", "Relative intensities.")
        rx.append(r)
    xr = xray_sources()
    for s in core + rest:
        if s.get("chain"):
            s.setdefault("name", s["name"])
    mats = MAT.build()
    flux = {"underground": {"th": 1.08e-6, "fast": 0.9e-7}, "surface": {"th": 5.5e-3, "fast": 5.5e-3},
            "refs": ["Underground thermal flux 1.08×10⁻⁶ n cm⁻² s⁻¹: P. Belli et al., Il Nuovo Cimento A 101 (1989) 959 (Gran Sasso).",
                     "Underground fast flux ≈ 0.9×10⁻⁷ n cm⁻² s⁻¹ (Gran Sasso), as summarized in R. Bernabei et al., arXiv:1409.3516.",
                     "Surface fast flux (> 1 MeV) 5.5×10⁻³ n cm⁻² s⁻¹: integral of the sea-level spectrum parameterization of M.S. Gordon et al., IEEE Trans. Nucl. Sci. 51 (2004) 3427 (it gives 13 n cm⁻² h⁻¹ above 10 MeV). The surface thermal flux is assumed equal to it (no evaluated default; enter a measured value if you have one)."]}
    meta = {"built": datetime.date.today().isoformat(), "refs": {"@cascade": CASCADE_REF, "@sigma": SIGMA_REF + ".", "@abund": ABUND_REF},
            "materials": mats, "flux": flux,
            "text": "Data built %s: %d decaying nuclides, %d capture target isotopes, %d isotopes with (n,n′γ) lines." % (
                datetime.date.today().isoformat(), len(core) + len(rest), len(cap), len(inel))}
    os.makedirs(OUT, exist_ok=True)
    json.dump({"meta": meta, "S": core + cap + inel + rx + xr}, open(os.path.join(OUT, "core.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"S": rest}, open(os.path.join(OUT, "all.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    for f in ("core.json", "all.json"):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, "kB")
    missing = sorted({"%d%s" % (i.isotope, pt.elements[z].symbol) for z in range(1, 93) for i in pt.elements[z]
                      if (gs.get("%d%s" % (i.isotope, pt.elements[z].symbol), {}).get("ab") or 0) > 5 and ("c:%d%s" % (i.isotope, pt.elements[z].symbol)) not in {c["id"] for c in cap}})
    print("abundant (>5%) isotopes without capture data:", " ".join(missing))
    print(meta["text"])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
