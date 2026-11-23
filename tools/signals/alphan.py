"""Level-resolved (alpha,n) cross sections from the NeuCBOT TALYS-1.95 datasets.

    python3 tools/signals/alphan.py /tmp/talys data/signals/alphan

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

GRID = [round(0.1 * i, 1) for i in range(1, 101)]
SYM = "n H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As".split()
ROW = re.compile(r"^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+--->\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.Ee+-]+)\s*$")


def parse(path, res):
    q = mt = None; tot = 0.0; trans = []; levels = {}
    sec = None; nuc = None
    with open(path, errors="replace") as f:
        for line in f:
            if line.startswith(" Q(a,n):"):
                q = float(line.split(":", 1)[1])
            elif line.startswith(" Target ") and "Mass in a.m.u." in line:
                mt = float(line.split(":")[-1])
            m = re.match(r"^\s*(\d+)\.\s+(\S.*)$", line)
            if m and len(m.group(1)) <= 2:
                sec = m.group(1)
            if sec == "4":
                mm = re.match(r"^\s+\d+\s+\d+\s+\(\s*(\w+)\s*\)\s+([\d.Ee+-]+)", line)
                if mm and mm.group(1) == res:
                    tot = float(mm.group(2))
            elif sec == "10":
                mm = re.match(r"^\s*Nuclide:\s+(\w+)", line)
                if mm:
                    nuc = mm.group(1); continue
                mm = ROW.match(line)
                if mm and nuc == res:
                    li, ji, ei, lf, jf, ef, eg, xs = mm.groups()
                    trans.append((int(li), int(lf), float(xs)))
                    levels[int(li)] = (float(ei), ji); levels.setdefault(int(lf), (float(ef), jf))
    return q, mt, tot, trans, levels


def extract(root, dest):
    out = {}
    for el in sorted(os.listdir(root)):
        base = os.path.join(root, el, "x", el)
        if not os.path.isdir(base):
            continue
        for iso in sorted(os.listdir(base)):
            A = int(re.sub(r"\D", "", iso)); Z = SYM.index(el)
            res = "%d%s" % (A + 3, SYM[Z + 2])
            tdir = os.path.join(base, iso, "TalysOut")
            Q = MT = None; lev = {}; tab = {}; totals = []
            for i, E in enumerate(GRID):
                p = os.path.join(tdir, "outputE" + str(round(E, 2)))
                if not os.path.exists(p):
                    totals.append(0.0); continue
                q, mt, tot, trans, levels = parse(p, res)
                Q = q if q is not None else Q; MT = mt or MT
                lev.update(levels)
                outg, ing = {}, {}
                for li, lf, xs in trans:
                    outg[li] = outg.get(li, 0) + xs; ing[lf] = ing.get(lf, 0) + xs
                direct = {L: max(0.0, outg[L] - ing.get(L, 0.0)) for L in outg}
                exc = sum(direct.values())
                direct[0] = max(0.0, tot - exc)
                for L, v in direct.items():
                    tab.setdefault(L, [0.0] * len(GRID))[i] = v
                totals.append(tot)
            if Q is None or max(totals) < 1e-3:
                continue
            levels = []
            for L in sorted(tab):
                arr = tab[L]
                if max(arr) < 1e-3 * max(totals) and L != 0:
                    continue
                Ex, jp = lev.get(L, (0.0, "0+")) if L else (0.0, lev.get(0, (0, "?"))[1])
                levels.append({"n": L, "Ex": round(Ex * 1000, 1), "jp": jp, "xs": [float("%.4g" % v) for v in arr]})
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
            out["%d%s" % (A, el)] = {"Z": Z, "A": A, "mass_u": MT, "Q_MeV": Q, "residual": res,
                                     "total": [float("%.4g" % v) for v in totals], "levels": levels,
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
    extract(sys.argv[1], sys.argv[2])
