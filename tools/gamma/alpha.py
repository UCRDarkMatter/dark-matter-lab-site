"""Alpha-induced prompt gamma lines: (α,n), (α,p), (α,α′) ... on light target isotopes.

Two steps:

1. extract  (run once, needs the NeuCBOT TALYS datasets)
       python3 tools/gamma/alpha.py extract /tmp/talys tools/gamma/alpha_xs.json
   For each target isotope, reads TALYS-1.95 "10. Gamma-ray intensities" from
   neucbot-datasets/<El>_v2 (TalysOut/outputE<Eα>) and stores the partial gamma-production
   cross section σγ(Eα) of every significant line on a 0.05 MeV grid (0-9 MeV).

2. yields   (called from build_gamma_data.py)
   Thick-target yield per alpha of energy E0 stopping in a material, the NeuCBOT method
   (S. Westerdale & P.D. Meyers, NIM A 875 (2017) 57):
       Y(E0) = Σ_iso n_iso ∫_0^E0 σγ(E) / S(E) dE
   n_iso = target atoms per gram, S = mass stopping power of the material (SRIM, Bragg
   additivity over elements, MeV cm²/g, as tabulated in NeuCBOT Data/StoppingPowers).
   Alpha energies and intensities: NeuCBOT AlphaLists (from ENSDF), with chain branchings
   from NeuCBOT Chains.
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
NDATA = os.path.join(HERE, "neucbot_data")
GRID = [round(0.05 * i, 2) for i in range(181)]        # 0 ... 9.00 MeV
NA = 6.02214076e23

ROW = re.compile(r"^\s*\d+\s+\S+\s+([\d.]+)\s+--->\s+\d+\s+\S+\s+([\d.]+)\s+([\d.]+)\s+([\d.Ee+-]+)\s*$")
NUC = re.compile(r"^\s*Nuclide:\s+(\d+)([A-Za-z]+)")


def parse_output(path):
    """{(residual, Eγ keV, Ex_initial keV): σ mb} from one TALYS output file."""
    out, on, res = {}, False, None
    with open(path, errors="replace") as f:
        for line in f:
            if "Gamma-ray intensities" in line:
                on = True; continue
            if not on:
                continue
            if re.match(r"^\s*\d+\.\s+[A-Z]", line) and "Gamma-ray" not in line:
                break                                       # next numbered section
            m = NUC.match(line)
            if m:
                res = m.group(1) + m.group(2); continue
            m = ROW.match(line)
            if m and res:
                exi, exf, eg, xs = map(float, m.groups())
                k = (res, round(eg * 1000, 2), round(exi * 1000, 1), round(exf * 1000, 1))
                out[k] = out.get(k, 0) + xs
    return out


def extract(root, dest, min_mb=2e-3):
    data = {}
    for el in sorted(os.listdir(root)):
        base = os.path.join(root, el, "x", el)
        if not os.path.isdir(base):
            continue
        for iso in sorted(os.listdir(base)):
            tdir = os.path.join(base, iso, "TalysOut")
            if not os.path.isdir(tdir):
                continue
            table = {}
            for i, E in enumerate(GRID):
                p = os.path.join(tdir, "outputE%g" % E)
                if not os.path.exists(p):
                    continue
                for k, xs in parse_output(p).items():
                    table.setdefault(k, [0.0] * len(GRID))[i] = xs
            A = int(re.sub(r"\D", "", iso))
            lines = []
            for (res, eg, exi, exf), arr in table.items():
                if max(arr) < min_mb or eg < 30:
                    continue
                lines.append({"res": res, "E": eg, "Exi": exi, "Exf": exf, "xs": [float("%.3g" % v) for v in arr]})
            lines.sort(key=lambda l: -max(l["xs"]))
            if lines:
                data["%d%s" % (A, el)] = {"el": el, "A": A, "lines": lines[:40]}
                print(iso, len(table), "->", len(lines[:40]))
    meta = {"grid_MeV": GRID, "units": "mb",
            "source": "TALYS-1.95 output, 'Gamma-ray intensities', from the NeuCBOT datasets "
                      "(github.com/neucbot-datasets); lines with peak sigma < %g mb dropped, top 40 per target kept." % min_mb}
    json.dump({"_about": meta, "targets": data}, open(dest, "w"), separators=(",", ":"))


# ---------------------------------------------------------------- yields
def _stopping(el):
    tab = []
    for line in open(os.path.join(NDATA, "StoppingPowers", el.lower() + ".dat")):
        if line.startswith("#") or not line.strip():
            continue
        p = line.split()
        e = float(p[0]) / (1000.0 if p[1] == "keV" else 1.0)
        tab.append((e, float(p[2]) + float(p[3])))
    return tab


def _interp(tab, e):
    if e <= tab[0][0]:
        return tab[0][1]
    for (e0, s0), (e1, s1) in zip(tab, tab[1:]):
        if e <= e1:
            return s0 + (s1 - s0) * (e - e0) / (e1 - e0)
    return tab[-1][1]


def alphas(nuc):
    p = os.path.join(NDATA, "AlphaLists", nuc + "Alphas.dat")
    out = []
    for line in open(p):
        s = line.split()
        if len(s) >= 2:
            out.append((float(s[0]), float(s[1]) / 100.0))
    return out


# alpha emitters per chain segment of materials.py, with branching (NeuCBOT Chains)
SEG_ALPHAS = {
    "U238": [("U238", 1), ("U234", 1), ("Th230", 1)],
    "Ra226": [("Ra226", 1), ("Rn222", 1), ("Po218", 0.9998), ("Po214", 0.99976)],
    "Pb210": [("Po210", 1)],
    "Th232": [("Th232", 1)],
    "Th228": [("Th228", 1), ("Ra224", 1), ("Rn220", 1), ("Po216", 1), ("Bi212", 0.3594), ("Po212", 0.6406)],
    "U235": [("U235", 1), ("Pa231", 1), ("Th227", 0.9862), ("Ac227", 0.0138), ("Ra223", 1),
             ("Rn219", 1), ("Po215", 1), ("Bi211", 0.99724), ("Po211", 0.00276)],
}


def seg_spectrum(seg):
    """[(Eα MeV, alphas per decay of the segment's top nuclide)]"""
    out = []
    for nuc, br in SEG_ALPHAS[seg]:
        p = os.path.join(NDATA, "AlphaLists", nuc + "Alphas.dat")
        if not os.path.exists(p):
            continue
        out += [(e, br * i) for e, i in alphas(nuc)]
    return out


def yields(comp, xsdata, abundance, molar):
    """comp: {element: mass fraction}. Returns {target: {line_index: {seg: γ per segment decay}}}."""
    stop = {el: _stopping(el) for el in comp if comp[el] > 0}
    S = [sum(w * _interp(stop[el], max(e, 0.01)) for el, w in comp.items() if w > 0) for e in GRID]
    specs = {seg: seg_spectrum(seg) for seg in SEG_ALPHAS}
    dE = GRID[1] - GRID[0]
    out = {}
    for key, t in xsdata["targets"].items():
        w = comp.get(t["el"], 0)
        if w <= 0:
            continue
        ab = abundance(t["el"], t["A"])
        if not ab:
            continue
        n = w * (ab / 100.0) * NA / molar(t["el"], t["A"])    # target atoms per gram (abundance in %)
        for li, l in enumerate(t["lines"]):
            cum, c = [0.0], 0.0                              # cumulative ∫σ/S dE in mb·g/cm²
            for i in range(1, len(GRID)):
                c += 0.5 * dE * (l["xs"][i - 1] / S[i - 1] + l["xs"][i] / S[i])
                cum.append(c)
            for seg, spec in specs.items():
                y = 0.0
                for e0, inten in spec:
                    x = min(e0, GRID[-1]) / dE
                    i = int(x); f = x - i
                    ci = cum[i] if i + 1 >= len(cum) else cum[i] + f * (cum[i + 1] - cum[i])
                    y += inten * ci
                y *= n * 1e-27
                if y > 0:
                    out.setdefault(key, {}).setdefault(li, {})[seg] = y
    return out


if __name__ == "__main__":
    if sys.argv[1] == "extract":
        extract(sys.argv[2], sys.argv[3])
