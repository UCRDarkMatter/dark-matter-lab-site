"""Build the Radioactive Signal Explorer's data files (data/signals/).

    python3 tools/signals/build_signals.py LIVECHART_DIR SIGNALS_DIR
      LIVECHART_DIR: the "livechart" folder of the gamma-data branch (IAEA LiveChart / ENSDF)
      SIGNALS_DIR:   the "signals" folder of the signals-data branch (NIST XCOM, daughter level schemes)

Writes
  nuclides.json  {name: [Z, A, Jpi, T1/2 s, modes, Qalpha, Qbeta-, QEC, mass excess keV, rms charge radius fm, abundance %]}
  decays/index.json  {name: "a,bm,bp,g" (which data exist)}
  decays/<El>.json   {name: {a: [[E, I%, Ex]], bm: [[Emax, I%, Ex, logft, type, Jpi_f, Emean]], bp: [...same...], g: [[E, I%]]}}
                 one file per element, loaded on demand (name with an "m" for decays of isomers, e.g. 234mPa)
  xcom.json      {Symbol: {Z, E, coh, incoh, photo, pair_n, pair_e, K}}   (cm^2/g, keV)
  alpha_stopping.json  {symbol: [[E MeV, S MeV cm^2/g]]}   (SRIM tables from NeuCBOT)
The (alpha,n) files come from tools/signals/alphan.py.
"""
import csv, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "data", "signals")
NEUCBOT = os.path.join(HERE, "..", "gamma", "neucbot_data", "StoppingPowers")


def fnum(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def rows(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="", errors="replace") as f:
        return list(csv.DictReader(f))


def name_of(z, n, sym, iso=False):
    return "%d%s%s" % (int(z) + int(n), "m" if iso else "", sym)


def nuclides(lc):
    out = {}
    for r in rows(os.path.join(lc, "ground_states.csv")):
        nm = name_of(r["z"], r["n"], r["symbol"])
        hl = fnum(r.get("half_life_sec"))
        if (r.get("half_life") or "").strip().upper() == "STABLE":
            hl = -1
        modes = ";".join("%s %s" % (r.get("decay_%d" % k) or "", r.get("decay_%d_%%" % k) or "") for k in (1, 2, 3) if r.get("decay_%d" % k))
        out[nm] = [int(r["z"]), int(r["z"]) + int(r["n"]), (r.get("jp") or "").strip(), hl, modes.strip(),
                   fnum(r.get("qa")), fnum(r.get("qbm")), fnum(r.get("qec")), fnum(r.get("massexcess")), fnum(r.get("radius")), fnum(r.get("abundance"))]
    return out


def level_jp(sig, daughter):
    """{Ex keV: Jpi} for a daughter nuclide from the levels download."""
    lv = {}
    for r in rows(os.path.join(sig, "levels", daughter.lower() + ".csv")):
        e = fnum(r.get("energy"))
        if e is not None:
            lv[e] = (r.get("jp") or "").strip()
    return lv


def match_jp(lv, ex):
    if not lv or ex is None:
        return ""
    best = min(lv, key=lambda e: abs(e - ex))
    return lv[best] if abs(best - ex) <= max(1.0, 1e-3 * ex) else ""


def decays(lc, sig, nucs):
    out = {}
    symz = {v[0]: re.sub(r"^\d+", "", k) for k, v in nucs.items()}

    def key(r):
        return name_of(r["p_z"], r["p_n"], r["p_symbol"], (fnum(r.get("p_energy")) or 0) > 0)
    def files(sub):
        out = glob.glob(os.path.join(lc, sub, "*.csv"))
        if sig:
            out += glob.glob(os.path.join(sig, "extra", sub, "*.csv"))
        return out
    for p in files("decay_a"):
        for r in rows(p):
            e, i = fnum(r.get("energy")), fnum(r.get("intensity"))
            if e and i:
                out.setdefault(key(r), {}).setdefault("a", []).append([e, float("%.4g" % i), fnum(r.get("daughter_level_energy")) or 0])
    for sub, kind in (("decay_bm", "bm"), ("decay_bp", "bp")):
        cache = {}
        for p in files(sub):
            for r in rows(p):
                i = fnum(r.get("intensity_beta"))
                if not i:
                    continue
                ex = fnum(r.get("daughter_level_energy")) or 0
                q = fnum(r.get("q"))
                emax = fnum(r.get("max_energy"))
                if emax is None and q is not None:
                    emax = q - ex - (0 if kind == "bm" else 1021.998)
                if not emax or emax <= 0:
                    continue
                dz, dn = int(r["d_z"]), int(r["d_n"])
                dname = "%d%s" % (dz + dn, r["d_symbol"])
                if dname not in cache:
                    cache[dname] = level_jp(sig, dname) if sig else {}
                out.setdefault(key(r), {}).setdefault(kind, []).append(
                    [round(emax, 2), float("%.4g" % i), ex, fnum(r.get("log_ft")), (r.get("transition_type") or "").strip(),
                     match_jp(cache[dname], ex) if ex else (nucs.get(dname, [0, 0, ""])[2]), fnum(r.get("mean_energy"))])
    # gammas: [E, I, from level, to level, multipolarity, mixing ratio, total conversion coefficient, Jpi from, Jpi to]
    jcache = {}
    for p in files("decay"):
        for r in rows(p):
            e, i = fnum(r.get("energy")), fnum(r.get("intensity"))
            if e and i and i >= 0.01:
                dname = "%d%s" % (int(r["d_z"]) + int(r["d_n"]), r["d_symbol"]) if r.get("d_z") else ""
                if dname and dname not in jcache:
                    jcache[dname] = level_jp(sig, dname) if sig else {}
                lf, lt = fnum(r.get("start_level_energy")), fnum(r.get("end_level_energy"))
                jl = jcache.get(dname, {})
                out.setdefault(key(r), {}).setdefault("g", []).append(
                    [float("%.6g" % e), float("%.3g" % i), lf, lt, (r.get("multipolarity") or "").strip(), fnum(r.get("mixing_ratio")),
                     fnum(r.get("conversion_coeff")), match_jp(jl, lf), match_jp(jl, lt)])
    # X-rays [E, I, shell] and conversion / Auger electrons [E, I, type]
    for sub, kk in (("xray", "x"), ("decay_e", "e")):
        for p in files(sub):
            for r in rows(p):
                e, i = fnum(r.get("energy")), fnum(r.get("intensity"))
                if e and i and i >= 0.05:
                    t = ((r.get("type") or "") + " " + (r.get("shell") or "")).strip()
                    out.setdefault(key(r), {}).setdefault(kk, []).append([float("%.6g" % e), float("%.3g" % i), t])
    for v in out.values():
        if "g" in v and "x" in v:   # X-rays listed among the decay radiations (no levels) now live in "x"
            xe = [x[0] for x in v["x"]]
            v["g"] = [g for g in v["g"] if g[2] is not None or not any(abs(g[0] - e) < 0.01 for e in xe)]
            if not v["g"]:
                del v["g"]
        for k in v:
            v[k].sort(key=lambda x: -x[1])
        if "g" in v:
            v["g"] = v["g"][:60]
        for k in ("x", "e"):
            if k in v:
                v[k] = v[k][:40]
    return out


def xcom(sig):
    src = os.path.join(sig, "xcom", "xcom.json")
    if not os.path.exists(src):
        return {}
    d = json.load(open(src))["elements"]
    sym = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm".split()
    out = {}
    for z, t in d.items():
        z = int(z)
        k = None
        html = os.path.join(sig, "xcom", "%d.html" % z)
        if os.path.exists(html):
            m = re.search(r"<td[^>]*>\s*\d*(?:&#160;|\s)*K\s*</td>\s*<td[^>]*>\s*([\d.E+-]+)", open(html, errors="replace").read())
            if m:
                k = round(float(m.group(1)) * 1000, 3)
        keep = [i for i, e in enumerate(t["E"]) if e <= 20000]
        out[sym[z - 1]] = {"Z": z, "K": k, **{c: [t[c][i] for i in keep] for c in ("E", "coh", "incoh", "photo", "pair_n", "pair_e")}}
        out[sym[z - 1]]["E"] = [float("%.6g" % e) for e in out[sym[z - 1]]["E"]]
    return out


def stopping():
    out = {}
    for p in sorted(glob.glob(os.path.join(NEUCBOT, "*.dat"))):
        tab = []
        for line in open(p):
            if line.startswith("#") or not line.strip():
                continue
            c = line.split()
            try:
                e = float(c[0]) / (1000.0 if c[1] == "keV" else 1.0)
                tab.append([e, float("%.4g" % (float(c[2]) + float(c[3])))])
            except (ValueError, IndexError):
                pass
        out[os.path.basename(p)[:-4].capitalize()] = tab
    return out


def main(lc, sig):
    os.makedirs(OUT, exist_ok=True)
    nucs = nuclides(lc)
    json.dump(nucs, open(os.path.join(OUT, "nuclides.json"), "w"), separators=(",", ":"))
    dec = decays(lc, sig, nucs)
    ddir = os.path.join(OUT, "decays")
    os.makedirs(ddir, exist_ok=True)
    for f in glob.glob(os.path.join(ddir, "*.json")):
        os.remove(f)
    if os.path.exists(os.path.join(OUT, "decays.json")):
        os.remove(os.path.join(OUT, "decays.json"))
    by_el, index = {}, {}
    for nm, v in dec.items():
        el = re.sub(r"^\d+m?", "", nm)
        by_el.setdefault(el, {})[nm] = v
        index[nm] = ",".join(k for k in ("a", "bm", "bp", "g") if k in v)
    for el, v in by_el.items():
        json.dump(v, open(os.path.join(ddir, el + ".json"), "w"), separators=(",", ":"))
    json.dump(index, open(os.path.join(ddir, "index.json"), "w"), separators=(",", ":"))
    xc = xcom(sig) if sig else {}
    if xc:
        json.dump(xc, open(os.path.join(OUT, "xcom.json"), "w"), separators=(",", ":"))
    json.dump(stopping(), open(os.path.join(OUT, "alpha_stopping.json"), "w"), separators=(",", ":"))
    nb = sum(1 for v in dec.values() if "bm" in v or "bp" in v)
    print(len(nucs), "nuclides;", len(dec), "with decay data (%d beta, %d alpha);" % (nb, sum(1 for v in dec.values() if "a" in v)), len(xc), "XCOM elements")
    for f in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, f)
        if os.path.isfile(p):
            print(" ", f, os.path.getsize(p) // 1024, "kB")
    print("  decays/: %d files, %d kB" % (len(os.listdir(ddir)), sum(os.path.getsize(os.path.join(ddir, f)) for f in os.listdir(ddir)) // 1024))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
