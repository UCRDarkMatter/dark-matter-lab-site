"""Decay chains for the Gamma Line Explorer's "Decay chains" tab -> data/gamma/chains.json.

Each chain is followed from its parent through the ENSDF decay modes (ground-state data from the IAEA LiveChart),
keeping branches of at least 1e-5 %. For every member it records the half-life, spin-parity, decay modes with
branching ratio and Q-value, the activity relative to the chain parent in secular equilibrium, alpha and beta
spectra, gamma lines (energy, intensity, initial and final level, multipolarity, conversion coefficient) with
their coincident partners in the same decay, and K X-rays.

    python3 tools/gamma/chains.py LIVECHART_DIR      (also run by build_gamma_data.py)
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_gamma_data as B          # noqa: E402

CHAINS = [
    ("U238", "²³⁸U series (natural uranium)", "238U"),
    ("Th232", "²³²Th series (natural thorium)", "232Th"),
    ("U235", "²³⁵U series (actinium series)", "235U"),
    ("K40", "⁴⁰K", "40K"),
    ("Ar39", "³⁹Ar (in atmospheric argon)", "39Ar"),
    ("Ar42", "⁴²Ar → ⁴²K (in atmospheric argon)", "42Ar"),
    ("Kr85", "⁸⁵Kr", "85Kr"),
    ("Ge68", "⁶⁸Ge → ⁶⁸Ga (cosmogenic in germanium)", "68Ge"),
    ("Ti44", "⁴⁴Ti → ⁴⁴Sc", "44Ti"),
    ("Co60", "⁶⁰Co", "60Co"),
    ("Cs137", "¹³⁷Cs → ¹³⁷ᵐBa", "137Cs"),
    ("Sr90", "⁹⁰Sr → ⁹⁰Y", "90Sr"),
    ("Ru106", "¹⁰⁶Ru → ¹⁰⁶Rh", "106Ru"),
    ("Ce144", "¹⁴⁴Ce → ¹⁴⁴Pr", "144Ce"),
    ("Si32", "³²Si → ³²P (cosmogenic in silicon)", "32Si"),
    ("Na22", "²²Na", "22Na"),
    ("Al26", "²⁶Al", "26Al"),
    ("Am241", "²⁴¹Am (calibration source)", "241Am"),
]
MIN_BRANCH = 1e-5                     # percent
# isomers that sit inside a chain: (parent, isomer, half-life s, [(daughter, %), ...]); ENSDF via LiveChart decay files
ISOMERS = {"234Th": ("234mPa", 69.54, [("234U", 99.84), ("234Pa", 0.16)])}


def fnum(x):
    return B.fnum(x)


def rows(lc, sub, nuc):
    p = os.path.join(lc, sub, nuc.lower() + ".csv")
    return B.read_csv(p) if os.path.exists(p) else []


def parent_level(r):
    return fnum(r.get("p_energy")) or 0.0


def alphas(lc, nuc, isomer):
    out = []
    for r in rows(lc, "decay_a", re.sub(r"m(?=[A-Z])", "", nuc)):
        if (parent_level(r) > 0) != isomer:
            continue
        e, i = fnum(r.get("energy") or r.get("mean_energy")), fnum(r.get("intensity"))
        if e and i and i > 0:
            out.append([round(e, 1), round(i, 4)])
    if not out:                                   # fall back to NeuCBOT's ENSDF-derived alpha lists
        m = re.match(r"(\d+)(m?)([A-Za-z]+)", nuc)
        p = os.path.join(HERE, "neucbot_data", "AlphaLists", m.group(3) + m.group(1) + "Alphas.dat")
        if os.path.exists(p):
            for line in open(p):
                s = line.split()
                if len(s) >= 2:
                    out.append([round(float(s[0]) * 1000, 1), round(float(s[1]), 4)])
    return sorted(out, key=lambda a: -a[1])


def betas(lc, nuc, isomer, sub):
    out = []
    for r in rows(lc, sub, re.sub(r"m(?=[A-Z])", "", nuc)):
        if (parent_level(r) > 0) != isomer:
            continue
        emax = fnum(r.get("max_energy") or r.get("endpoint_energy") or r.get("end_point_energy"))
        emean = fnum(r.get("mean_energy") or r.get("energy"))
        i = fnum(r.get("intensity_beta") or r.get("intensity"))
        if i and i > 0 and (emax or emean):
            out.append([round(emax, 1) if emax else None, round(emean, 1) if emean else None, round(i, 4)])
    return sorted(out, key=lambda b: -b[2])


def gammas(lc, nuc, isomer):
    g, x = [], []
    for r in rows(lc, "decay", re.sub(r"m(?=[A-Z])", "", nuc)):
        if (parent_level(r) > 0) != isomer:
            continue
        e, i = fnum(r.get("energy")), fnum(r.get("intensity"))
        if e is None or i is None or i <= 0:
            continue
        sl = fnum(r.get("start_level_energy"))
        if sl is None and e < 120:                # no level assignment at low energy: ENSDF's summed L X-rays
            x.append([round(e, 2), float("%.3g" % i), "L"])
            continue
        g.append([round(e, 3), float("%.4g" % i), sl, fnum(r.get("end_level_energy")),
                  (r.get("multipolarity") or "").strip(), fnum(r.get("conversion_coeff"))])
    for r in rows(lc, "xray", re.sub(r"m(?=[A-Z])", "", nuc)):
        if (parent_level(r) > 0) != isomer:
            continue
        e, i = fnum(r.get("energy")), fnum(r.get("intensity"))
        if e and i and i >= 0.01 and (r.get("shell") or "").strip().upper() == "K":
            x.append([round(e, 2), round(i, 3), (r.get("type_x") or r.get("rad_type") or "").strip()])
    g.sort(key=lambda l: l[0])
    return g, sorted(x, key=lambda l: l[0])


def q_values(lc, nuc, gsrow=None):
    """Q-values per decay mode (keV): from the decay files, else the ground-state table (AME via LiveChart)."""
    q = {}
    if gsrow:
        for mode, col in (("B-", "qbm"), ("A", "qa"), ("EC", "qec"), ("EC+B+", "qec"), ("B+", "qec"), ("B-N", "qbm_n")):
            v = fnum(gsrow.get(col))
            if v is not None:
                q[mode] = v
    for sub in ("decay", "decay_a", "decay_bm", "decay_bp"):
        for r in rows(lc, sub, nuc):
            m, v = (r.get("decay") or "").strip(), fnum(r.get("q"))
            if m and v is not None and parent_level(r) == 0:
                q[m] = v
    return q


def coincidences(g):
    lines = [[l[0], l[1], "", l[2], l[3]] for l in g]
    c = B.decay_coincidences(lines)
    return {str(k): v for k, v in c.items()}


def member(lc, gs, nuc, af, refs):
    isomer = bool(re.match(r"^\d+m", nuc))
    base = re.sub(r"^(\d+)m", r"\1", nuc)
    info = gs.get(base, {})
    if isomer:
        iso = [v for v in ISOMERS.values() if v[0] == nuc][0]
        hl, modes, jp = iso[1], [], ""
        dau = [[d, p] for d, p in iso[2]]
        modes = [["B-", 99.84, None, "234U"], ["IT", 0.16, None, "234Pa"]] if nuc == "234mPa" else []
    else:
        hl, jp = info.get("hl"), info.get("jp", "")
        q = q_values(lc, nuc, info.get("row"))
        dau = B.daughters(nuc, gs)
        modes = []
        for (mode, p), d in zip([m for m in info.get("modes", []) if m[0] in B.DAUGHTER], dau):
            modes.append([mode, p if p is not None else 100.0, q.get(mode) or q.get(mode.replace("EC+B+", "EC")), d[0]])
        for mode, p in info.get("modes", []):
            if mode not in B.DAUGHTER:
                modes.append([mode, p, None, None])
    g, x = gammas(lc, nuc, isomer)
    for r in rows(lc, "decay", base)[:1]:
        refs.add(B.ensdf_ref(r, "Decay data"))
    return {"nuc": nuc, "name": B.pretty(nuc), "hl": None if hl == float("inf") else hl, "jp": jp, "af": round(af, 6),
            "modes": modes, "alphas": alphas(lc, nuc, isomer), "betas": betas(lc, nuc, isomer, "decay_bm"),
            "positrons": betas(lc, nuc, isomer, "decay_bp"), "gammas": g, "xrays": x, "coinc": coincidences(g),
            "id": "d:" + nuc}


STOP = {"Am241": {"237Np"}}            # calibration source: stop at its long-lived daughter
LONG = 1e22                          # s: treat as stable inside a chain (e.g. 209Bi, 144Nd), unless it is the parent


def edges(nuc, gs):
    if nuc in ISOMERS:
        iso, _, br = ISOMERS[nuc]
        return [(iso, 99.8), ("234Pa", 0.2)]
    for k, v in ISOMERS.items():
        if v[0] == nuc:
            return [(d, p) for d, p in v[2]]
    return [(d, p) for d, p in B.daughters(nuc, gs) if p is not None and p >= MIN_BRANCH]


def walk(lc, gs, top, stop=()):
    seen, queue = [], [top]
    while queue:
        nuc = queue.pop(0)
        if nuc in seen:
            continue
        seen.append(nuc)
        g = gs.get(re.sub(r"^(\d+)m", r"\1", nuc))
        if nuc in stop or (nuc != top and (not g or g["hl"] == float("inf") or (g["hl"] or 0) > LONG) and nuc not in [v[0] for v in ISOMERS.values()]):
            continue
        for d, p in edges(nuc, gs):
            if d not in seen and (gs.get(d) or d in [v[0] for v in ISOMERS.values()]):
                queue.append(d)
    # propagate activities in topological order of the decay graph (works for alpha, beta-minus, EC and isomers alike)
    def dec(n):
        g = gs.get(re.sub(r"^(\d+)m", r"\1", n))
        return not (n != top and (n in stop or not g or g["hl"] == float("inf") or (g["hl"] or 0) > LONG) and n not in [v[0] for v in ISOMERS.values()])
    kids = {n: [d for d, p in edges(n, gs) if d in seen] if dec(n) else [] for n in seen}
    indeg = {n: 0 for n in seen}
    for n in seen:
        for d in kids[n]:
            indeg[d] += 1
    order, ready = [], [n for n in seen if indeg[n] == 0]
    while ready:
        n = ready.pop(0); order.append(n)
        for d in kids[n]:
            indeg[d] -= 1
            if indeg[d] == 0:
                ready.append(d)
    order += [n for n in seen if n not in order]
    af = {n: 0.0 for n in order}; af[top] = 1.0
    for n in order:
        g = gs.get(re.sub(r"^(\d+)m", r"\1", n))
        if n != top and (n in stop or not g or g["hl"] == float("inf") or (g["hl"] or 0) > LONG) and n not in [v[0] for v in ISOMERS.values()]:
            continue
        for d, p in edges(n, gs):
            if d in af:
                af[d] += af[n] * p / 100
    order = [n for n in seen if af.get(n, 0) >= 1e-7 or n == top]     # display in decay order from the parent
    return order, af


def za(n):
    m = re.match(r"(\d+)(m?)([A-Z][a-z]?)", n)
    return int(m.group(1)), B.pt.elements.symbol(m.group(3)).number


def edge_mode(parent, daughter, member_modes):
    """Decay mode of one edge: from the parent's ENSDF modes when its daughter matches, else from the change in A and Z."""
    base = re.sub(r"^(\d+)m", r"\1", daughter)
    for m in member_modes:
        if m[3] and m[3] == base and m[0] != "IT":
            return m[0]
    (a0, z0), (a1, z1) = za(parent), za(daughter)
    if a0 == a1 and z0 == z1:
        return "IT"
    if a1 == a0 - 4 and z1 == z0 - 2:
        return "A"
    if a1 == a0 and z1 == z0 + 1:
        return "B-"
    if a1 == a0 and z1 == z0 - 1:
        return "EC"
    return "?"


def chain_edges(gs, members, stop):
    """Every decay between members of the chain: [parent, daughter, mode, branching %]."""
    names = {m["nuc"] for m in members}
    out = []
    for m in members:
        if m.get("stable") or m["nuc"] in stop:
            continue
        for d, p in edges(m["nuc"], gs):
            if d in names:
                out.append([m["nuc"], d, edge_mode(m["nuc"], d, m.get("modes", [])), round(p, 6)])
    return out


def build(lc):
    gs = B.ground_states(lc)
    for r in B.read_csv(os.path.join(lc, "ground_states.csv")):     # add spin-parity
        name = B.nuc_name(r["z"], r["n"], r["symbol"])
        if name in gs:
            gs[name]["jp"] = (r.get("jp") or "").strip()
            gs[name]["row"] = r
    out = []
    for cid, title, top in CHAINS:
        if top not in gs:
            continue
        refs = set()
        order, af = walk(lc, gs, top, STOP.get(cid, ()))
        members = []
        for nuc in order:
            stable = nuc in gs and (gs[nuc]["hl"] == float("inf") or (nuc != top and (gs[nuc]["hl"] or 0) > LONG)) or nuc in STOP.get(cid, ())
            if stable:
                hl = gs.get(nuc, {}).get("hl")
                members.append({"nuc": nuc, "name": B.pretty(nuc), "stable": True, "af": round(af.get(nuc, 0), 6),
                                "hl": None if hl in (None, float("inf")) else hl})
                continue
            members.append(member(lc, gs, nuc, af.get(nuc, 0), refs))
        # a chain needs at least two radioactive members; single decays (40K, 60Co ...) are in the source browser instead
        if sum(1 for m in members if not m.get("stable")) < 2:
            continue
        out.append({"id": cid, "title": title, "top": top, "members": members, "edges": chain_edges(gs, members, STOP.get(cid, ())),
                    "refs": sorted(r for r in refs if r)})
    has_ab = os.path.isdir(os.path.join(lc, "decay_a"))
    meta = {"about": "Decay chains followed through ENSDF decay modes (IAEA LiveChart of Nuclides); branches below %g%% omitted. "
                     "af = activity relative to the chain parent in secular equilibrium. Coincidences: probability that another gamma of the "
                     "same decay is emitted, from the level scheme." % MIN_BRANCH,
            "alpha_beta_source": "IAEA LiveChart decay radiation data" if has_ab else
                                 "alpha energies from NeuCBOT's ENSDF-derived lists; beta spectra not available in this build"}
    path = os.path.join(HERE, "..", "..", "data", "gamma", "chains.json")
    json.dump({"meta": meta, "chains": out}, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    return path, out


if __name__ == "__main__":
    p, out = build(sys.argv[1])
    for c in out:
        print("  edges:", c["edges"][:6])
        print(c["id"], len(c["members"]), [m["nuc"] for m in c["members"]][:40])
    print(os.path.getsize(p), "bytes")
