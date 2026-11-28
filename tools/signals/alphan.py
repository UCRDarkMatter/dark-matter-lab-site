"""Level-resolved (alpha,n) cross sections from the NeuCBOT TALYS-1.95 datasets.

    python3 tools/signals/alphan.py /tmp/talys data/signals/alphan [CASCADE/Supplemental/LevelStructureTXTs] [livechart/gammas]

For every target isotope and alpha energy (0.1-10 MeV in 0.1 MeV steps) this reads the TALYS output:
  * Q(a,n) and the projectile/target masses (header),
  * the total production cross section of the (a,n) residual nucleus (section 4),
  * the gamma-ray cross sections of that residual (section 10), from which the cross section feeding each
    excited level directly is  sigma_L = (gammas out of L) - (gammas into L from above);
    the ground state gets the remainder,  sigma_0 = sigma_total - sum_L sigma_L.
It also stores the TALYS neutron spectrum (NSpectra/nspecEEE.EEE.tot, "Total" column, mb/MeV in 0.1 MeV bins) at each
alpha energy: the spectrum NeuCBOT integrates. One JSON file per target (loaded on demand by the page) plus an index.
Levels fed through the continuum (neutron emission to unresolved states followed by gamma cascades) are thereby
attributed to the discrete level they end in; for light targets below 10 MeV this is a small effect.
Data: S. Westerdale & P. D. Meyers, NIM A 875 (2017) 57 (NeuCBOT), TALYS-1.95 (A. Koning et al.).
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cascade as CAS

GRID = [round(0.1 * i, 1) for i in range(1, 101)]
SYM = "n H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As".split()
ROW = re.compile(r"^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+--->\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.Ee+-]+)\s*$")


SPEC = re.compile(r"^\s*([\d.]+)\s+([\d.Ee+-]+)\s")


def parse(path, res):
    """Read one TALYS output file. Returns a dict with Q values, masses, production cross sections (section 3),
    residual production (section 4), composite gamma and proton spectra (section 7) and the gamma-ray
    intensities of every residual (section 10)."""
    o = {"Q": {}, "mt": None, "part": {}, "prod": {}, "trans": {}, "levels": {}, "spec": {}}
    sec = None; nuc = None; sp = None
    with open(path, errors="replace") as f:
        for line in f:
            mq = re.match(r"^ Q\(a,(\w)\):\s*([-\d.Ee+]+)", line)
            if mq:
                o["Q"][mq.group(1)] = float(mq.group(2))
            elif line.startswith(" Target ") and "Mass in a.m.u." in line:
                o["mt"] = float(line.split(":")[-1])
            m = re.match(r"^\s*(\d+)\.\s+(\S.*)$", line)
            if m and len(m.group(1)) <= 2:
                sec = m.group(1); sp = None
            if sec == "3":
                mm = re.match(r"^\s*(gamma|neutron|proton|alpha)\s*=\s*([\d.Ee+-]+)", line)
                if mm:
                    o["part"][mm.group(1)] = float(mm.group(2))
            elif sec == "4":
                mm = re.match(r"^\s+\d+\s+\d+\s+\(\s*(\w+)\s*\)\s+([\d.Ee+-]+)", line)
                if mm:
                    o["prod"][mm.group(1)] = float(mm.group(2))
            elif sec == "7":
                mm = re.match(r"^\s*Spectra for outgoing (\w+)", line)
                if mm:
                    sp = mm.group(1); o["spec"][sp] = []; continue
                mm = SPEC.match(line)
                if mm and sp in ("gamma", "proton"):
                    o["spec"][sp].append((float(mm.group(1)), float(mm.group(2))))
            elif sec == "10":
                mm = re.match(r"^\s*Nuclide:\s+(\w+)", line)
                if mm:
                    nuc = mm.group(1); continue
                mm = ROW.match(line)
                if mm and nuc:
                    li, ji, ei, lf, jf, ef, eg, xs = mm.groups()
                    o["trans"].setdefault(nuc, []).append((int(li), int(lf), float(xs), float(eg)))
                    lv = o["levels"].setdefault(nuc, {})
                    lv[int(li)] = (float(ei), ji); lv.setdefault(int(lf), (float(ef), jf))
    return o


def feeding(trans, tot):
    """Direct feeding of each level: gammas out minus gammas in; ground state gets the remainder."""
    outg, ing = {}, {}
    for li, lf, xs, eg in trans:
        outg[li] = outg.get(li, 0) + xs; ing[lf] = ing.get(lf, 0) + xs
    d = {L: max(0.0, outg[L] - ing.get(L, 0.0)) for L in outg}
    d[0] = max(0.0, tot - sum(v for k, v in d.items() if k))
    return d


def rebin(pts, de=0.1, emax=20.0):
    """Rebin a TALYS spectrum (mb/MeV at given energies) onto 0.1 MeV bins (centres 0.05, 0.15, ...): sparse [first, values...]."""
    nb = int(round(emax / de)); out = [0.0] * nb
    for k in range(len(pts) - 1):
        e0, y0 = pts[k]; e1, y1 = pts[k + 1]
        if e1 <= e0:
            continue
        b = int(0.5 * (e0 + e1) / de)
        if 0 <= b < nb:
            out[b] += 0.5 * (y0 + y1) * (e1 - e0) / de
    nz = [i for i, v in enumerate(out) if v > 1e-4 * (max(out) or 1)]
    if not nz:
        return [0]
    return [nz[0]] + [float("%.2g" % out[i]) for i in range(nz[0], nz[-1] + 1)]


def extract(root, dest, cascade_dir=None, ensdf_dir=None):
    out = {}
    for el in sorted(os.listdir(root)):
        base = os.path.join(root, el, "x", el)
        if not os.path.isdir(base):
            continue
        for iso in sorted(os.listdir(base)):
            A = int(re.sub(r"\D", "", iso)); Z = SYM.index(el)
            res = "%d%s" % (A + 3, SYM[Z + 2])
            tdir = os.path.join(base, iso, "TalysOut")
            Q = MT = None; lev = {}; tab = {}; totals = []; gam = {}
            pres = "%d%s" % (A + 3, SYM[Z + 1]); gres = "%d%s" % (A + 4, SYM[Z + 2])
            tname = "%d%s" % (A, el); atab = {}
            Qx = {}; plev = {}; ptab = {}; ptot = []; prod = {}; part = {"neutron": [], "proton": [], "gamma": []}; gspec = []; pspec = []
            other = {"(a,p)": (pres, [0.0] * len(GRID)), "(a,g)": (gres, [0.0] * len(GRID))}
            for i, E in enumerate(GRID):
                p = os.path.join(tdir, "outputE" + str(round(E, 2)))
                if not os.path.exists(p):
                    totals.append(0.0); ptot.append(0.0); gspec.append([0]); pspec.append([0])
                    for k in part: part[k].append(0.0)
                    continue
                o = parse(p, res)
                tot = o["prod"].get(res, 0.0)
                for ch, (rn, arr) in other.items():
                    arr[i] = o["prod"].get(rn, 0.0)
                for rn, v in o["prod"].items():
                    prod.setdefault(rn, [0.0] * len(GRID))[i] = v
                for k in part:
                    part[k].append(o["part"].get(k, 0.0))
                Qx.update(o["Q"])
                for nucl, tr in o["trans"].items():           # gamma-ray production cross sections of every residual
                    for li, lf, xs, eg in tr:
                        gam.setdefault((nucl, li, lf, eg), [0.0] * len(GRID))[i] += xs
                    for L, v in o["levels"].get(nucl, {}).items():
                        lev.setdefault(nucl, {})[L] = v
                Q = o["Q"].get("n", Q); MT = o["mt"] or MT
                for L, v in feeding(o["trans"].get(res, []), tot).items():
                    tab.setdefault(L, [0.0] * len(GRID))[i] = v
                pt = o["prod"].get(pres, 0.0); ptot.append(pt)
                for L, v in feeding(o["trans"].get(pres, []), pt).items():
                    ptab.setdefault(L, [0.0] * len(GRID))[i] = v
                for L, v in feeding(o["trans"].get(tname, []), 0.0).items():   # inelastic (a,a') feeding of the target's levels
                    if L:
                        atab.setdefault(L, [0.0] * len(GRID))[i] = v
                gspec.append(rebin(o["spec"].get("gamma", [])))
                pspec.append(rebin(o["spec"].get("proton", [])))
                totals.append(tot)
            if Q is None or max(totals) < 1e-3:
                continue
            def levlist(tb, tots, nucl):
                out_ = []; lv = lev.get(nucl, {})
                for L in sorted(tb):
                    arr = tb[L]
                    if max(arr) < 1e-3 * (max(tots) or 1) and L != 0:
                        continue
                    Ex, jp = lv.get(L, (0.0, "0+")) if L else (0.0, lv.get(0, (0, "?"))[1])
                    out_.append({"n": L, "Ex": round(Ex * 1000, 1), "jp": jp, "xs": [float("%.4g" % v) for v in arr]})
                return out_
            levels = levlist(tab, totals, res)
            plevels = levlist(ptab, ptot, pres) if max(ptot) > 1e-4 else []
            alevels = levlist(atab, [max(v) for v in atab.values()] or [0], tname) if atab else []
            # de-excitation through evaluated level schemes (G4RiversideCASCADE, else ENSDF adopted gammas)
            casc = {}
            for nucl, lv, chan in ((res, levels, "(a,n)"), (pres, plevels, "(a,p)"), (tname, alevels, "(a,a')")):
                sch = CAS.load(nucl, cascade_dir, ensdf_dir) if lv else []
                if not sch:
                    continue
                ln, unm, used = CAS.lines_from_feeding(sch, lv, len(GRID))
                exc = [sum(L["xs"][k] for L in lv if L["Ex"] > 0) for k in range(len(GRID))]
                fr = max([unm[k] / exc[k] for k in range(len(GRID)) if exc[k] > 1e-3 * (max(exc) or 1)] or [0])
                casc[nucl] = {"channel": chan, "src": " + ".join(sorted(used)), "lines": ln[:40], "unmatched": round(fr, 4)}
            spec = []
            for E in GRID:                                   # TALYS neutron spectra, sparse: [first bin index, values...]
                p = os.path.join(base, iso, "NSpectra", "nspec%07.3f.tot" % E)
                vals = []
                if os.path.exists(p):
                    for line in open(p):
                        if line.startswith("#") or not line.strip():
                            continue
                        c = line.split()
                        try:
                            vals.append((float(c[0]), float(c[1])))
                        except (ValueError, IndexError):
                            continue
                nz = [k for k, (e, v) in enumerate(vals) if v > 1e-6 * max([x[1] for x in vals] or [1])]
                if not nz:
                    spec.append([0]); continue
                spec.append([nz[0]] + [float("%.3g" % vals[k][1]) for k in range(nz[0], nz[-1] + 1)])
            e0 = None
            p = os.path.join(base, iso, "NSpectra", "nspec%07.3f.tot" % 5.0)
            if os.path.exists(p):
                es = []
                for l in open(p):
                    try:
                        es.append(float(l.split()[0]))
                    except (ValueError, IndexError):
                        pass
                if len(es) > 1:
                    e0, de = es[0], es[1] - es[0]
            gl = []
            nres = 0
            for (nucl, li, lf, eg), arr in sorted(gam.items(), key=lambda kv: -max(kv[1])):
                if nucl == res:
                    if max(arr) < 1e-3 * max(totals) or nres >= 25:
                        continue
                    nres += 1
                elif max(arr) < 1e-3 * max(totals) or len(gl) >= 40:
                    continue
                lv = lev.get(nucl, {})
                gl.append({"nuc": nucl, "Eg": round(eg * 1000, 1), "from": round(lv.get(li, (0, ""))[0] * 1000, 1), "to": round(lv.get(lf, (0, ""))[0] * 1000, 1),
                           "xs": [float("%.4g" % v) for v in arr]})
            pmax = max(max(v) for v in prod.values()) if prod else 1
            prod_ = {rn: [float("%.4g" % v) for v in arr] for rn, arr in prod.items() if max(arr) > 1e-4 * pmax}
            oth = {ch: {"residual": rn, "xs": [float("%.4g" % v) for v in arr]} for ch, (rn, arr) in other.items() if max(arr) > 1e-6}
            out["%d%s" % (A, el)] = {"Z": Z, "A": A, "mass_u": MT, "Q_MeV": Q, "residual": res,
                                     "total": [float("%.4g" % v) for v in totals], "levels": levels, "gammas": gl, "other": oth,
                                     "Q": Qx, "prod": prod_, "cascade": casc, "part": {k: [float("%.4g" % v) for v in arr] for k, arr in part.items()},
                                     "p": {"residual": pres, "Q_MeV": Qx.get("p"), "total": [float("%.4g" % v) for v in ptot], "levels": plevels,
                                           "spec": {"E0": 0.05, "dE": 0.1, "units": "mb/MeV", "spectra": pspec}},
                                     "g": {"residual": gres, "Q_MeV": Qx.get("g"), "spec": {"E0": 0.05, "dE": 0.1, "units": "mb/MeV", "spectra": gspec}},
                                     "nspec": {"E0": e0, "dE": de if e0 is not None else 0.1, "units": "mb/MeV", "spectra": spec}}
            print(iso, "->", res, "Q=%.3f" % Q, len(levels), "levels, max %.3g mb" % max(totals), flush=True)
    meta = {"grid_MeV": GRID, "units": "mb",
            "about": "Level-resolved (alpha,n) cross sections from TALYS-1.95 (NeuCBOT datasets); see tools/signals/alphan.py"}
    os.makedirs(dest, exist_ok=True)
    index = {}
    for k, v in out.items():
        json.dump(v, open(os.path.join(dest, k + ".json"), "w"), separators=(",", ":"))
        index[k] = {"Z": v["Z"], "A": v["A"], "Q_MeV": v["Q_MeV"], "residual": v["residual"], "peak_mb": max(v["total"])}
    json.dump({"_about": meta, "targets": index}, open(os.path.join(dest, "index.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    # optional: G4RiversideCASCADE Supplemental/LevelStructureTXTs and LiveChart gammas/ (ENSDF adopted gammas)
    extract(sys.argv[1], sys.argv[2], *(sys.argv[3:5]))
