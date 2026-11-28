"""Gamma cascades through evaluated level schemes, for the de-excitation of nuclei left excited by alpha reactions.

Builds on the G4RiversideCASCADE framework used by the Gamma Line Explorer (tools/gamma/capture.py): a level
scheme is a downward directed graph, and instead of sampling cascades the populations are propagated exactly.
Here the starting populations are the levels that TALYS says a reaction feeds directly (not a capture state).

Level schemes (a populated level is cascaded through the first scheme that contains it):
  1. ENSDF adopted gammas from the IAEA LiveChart (gammas/<nuclide>.csv), which list every known level,
  2. G4RiversideCASCADE  Supplemental/LevelStructureTXTs/<Z>-<A>.txt (ENSDF/CapGam evaluations used by CASCADE;
     these files only contain the levels reached in thermal capture, so they fill gaps rather than lead)
         "<level keV>" then " - <final keV>, <branching>" (gamma), " E ..." (conversion electron),
         " P ..." (unresolved, photon evaporation in CASCADE: treated as one gamma, as in capture.py)
In the ENSDF files (relative photon intensities and total conversion coefficients) a level's branch to each final level is I_gamma (1 + alpha), of which a fraction
     1/(1 + alpha) is a photon. A level with a single transition and no intensity gets branching 1; an E0
     transition (0+ -> 0+) gives no photon.
"""
import csv
import os
import re

AMU_KEV = 931494.10242
SYM = ("n H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr").split()


def _za(nuc):
    m = re.match(r"(\d+)([A-Za-z]+)$", nuc)
    return SYM.index(m.group(2).capitalize()), int(m.group(1))


class Scheme:
    """levels: sorted energies (keV); out[i] = [(j, branching fraction, photon fraction)]."""

    def __init__(self, nuc, energies, trans, src):
        self.nuc, self.src = nuc, src
        self.E = sorted(set([0.0] + energies))
        self.idx = {e: k for k, e in enumerate(self.E)}
        self.out = [[] for _ in self.E]
        for ei, lst in trans.items():
            i = self.find(ei, exact=True)
            if i is None:
                continue
            use = []
            for ef, b, fg in lst:
                j = self.find(ef, exact=True)
                if j is None or j >= i or b <= 0:
                    continue
                use.append((j, b, fg))
            tot = sum(b for _, b, _ in use)
            self.out[i] = [(j, b / tot, fg) for j, b, fg in use] if tot > 0 else []
        _, self.A = _za(nuc)

    def find(self, e, exact=False):
        k = min(range(len(self.E)), key=lambda q: abs(self.E[q] - e))
        tol = 0.05 if exact else max(3.0, 0.002 * e)
        return k if abs(self.E[k] - e) <= tol else None

    def cascade(self, i0):
        """Gamma lines emitted after level i0 is populated: {(i, j): photons per population}."""
        pop = [0.0] * len(self.E); pop[i0] = 1.0; lines = {}
        for i in range(i0, 0, -1):
            if pop[i] <= 0:
                continue
            for j, f, fg in self.out[i]:
                flow = pop[i] * f
                pop[j] += flow
                if fg > 0:
                    lines[(i, j)] = lines.get((i, j), 0.0) + flow * fg
        return lines

    def reach(self):
        """R[i][k] = probability that a cascade passing level i later passes level k (R[i][i] = 1)."""
        if hasattr(self, "_R"):
            return self._R
        n = len(self.E); R = [None] * n
        for i in range(n):
            row = {i: 1.0}
            for j, f, _ in self.out[i]:
                for k, v in R[j].items():
                    row[k] = row.get(k, 0.0) + f * v
            R[i] = row
        self._R = R
        return R

    def egamma(self, i, j):
        de = self.E[i] - self.E[j]
        return de - de * de / (2 * self.A * AMU_KEV)          # recoil correction


def from_cascade(path, nuc):
    energies, trans, cur = [], {}, None
    for line in open(path):
        if not line.strip():
            continue
        if line[0] not in " \t":
            cur = float(line.split()[0]); energies.append(cur); trans.setdefault(cur, []); continue
        m = re.match(r"\s*([-EPUVX])\s+([-\d.eE+]+)\s*,\s*([-\d.eE+]+)", line)
        if m and cur is not None and m.group(1) in "-EP":
            fg = 0.0 if m.group(1) == "E" else 1.0
            trans[cur].append((float(m.group(2)), float(m.group(3)), fg))
    # CASCADE lists gamma and electron branches separately to the same final level: keep them as separate edges
    return Scheme(nuc, energies, trans, "G4RiversideCASCADE")


def from_ensdf(path, nuc):
    rows = list(csv.DictReader(open(path)))
    energies, trans = [], {}

    def f(x):
        try:
            return float(x)
        except (TypeError, ValueError):
            return None
    for r in rows:
        ei, ef = f(r.get("start_level_energy")), f(r.get("end_level_energy"))
        if ei is None or ef is None:
            continue
        energies += [ei, ef]
        ri, a = f(r.get("relative_intensity")), f(r.get("tot_conv_coeff")) or 0.0
        mult = (r.get("multipolarity") or "").replace("[", "").replace("]", "")
        trans.setdefault(ei, []).append([ef, ri, a, mult])
    out = {}
    for ei, lst in trans.items():
        if len(lst) == 1 and lst[0][1] is None:
            lst[0][1] = 100.0
        o = []
        for ef, ri, a, mult in lst:
            if ri is None or ri <= 0:
                continue
            fg = 0.0 if mult.strip() == "E0" else 1.0 / (1.0 + a)
            o.append((ef, ri * (1.0 + a), fg))
        out[ei] = o
    return Scheme(nuc, energies, out, "ENSDF adopted gammas (IAEA LiveChart)")


def load(nuc, cascade_dir=None, ensdf_dir=None):
    """List of schemes for nuc, in order of preference (may be empty)."""
    Z, A = _za(nuc); out = []
    if ensdf_dir:
        p = os.path.join(ensdf_dir, nuc.lower() + ".csv")
        if os.path.exists(p) and os.path.getsize(p) > 200:
            out.append(from_ensdf(p, nuc))
    if cascade_dir:
        p = os.path.join(cascade_dir, "%d-%d.txt" % (Z, A))
        if os.path.exists(p):
            out.append(from_cascade(p, nuc))
    return out


def lines_from_feeding(schemes, levels, ngrid, min_frac=1e-3):
    """levels: [{"Ex": keV, "xs": [mb on grid]}] (direct feeding from TALYS). Returns (lines, unmatched) with
    lines = [{"Eg", "from", "to", "xs"}] (gamma production cross sections, mb) and unmatched[i] = cross section of
    excited levels with no counterpart in the scheme."""
    acc, unmatched, used = {}, [0.0] * ngrid, set()
    feed = {}                                              # (scheme index, level) -> weight summed over the energy grid
    for L in levels:
        if L["Ex"] <= 0:
            continue
        sch = i = None
        for s_ in schemes:
            i = s_.find(L["Ex"])
            if i is not None and s_.out[i]:
                sch = s_; break
        if sch is None:
            for k in range(ngrid):
                unmatched[k] += L["xs"][k]
            continue
        used.add(sch.src)
        si = schemes.index(sch); feed[(si, i)] = feed.get((si, i), 0.0) + sum(L["xs"])
        for (a, b), w in sch.cascade(i).items():
            key = (round(sch.egamma(a, b), 2), round(sch.E[a], 2), round(sch.E[b], 2))
            arr = acc.setdefault(key, [0.0] * ngrid)
            for k in range(ngrid):
                arr[k] += w * L["xs"][k]
    if not acc:
        return [], unmatched, used
    peak = max(max(v) for v in acc.values())
    out = []
    for (eg, ea, eb), arr in sorted(acc.items(), key=lambda kv: -max(kv[1])):
        if max(arr) < min_frac * peak:
            continue
        out.append({"Eg": eg, "from": ea, "to": eb, "xs": [float("%.4g" % v) for v in arr]})
    coincidences(schemes, feed, out)
    return out, unmatched, used


def coincidences(schemes, feed, lines, n_strong=25, pmin=0.02):
    """For the strongest lines, P(other line in the same cascade | this line), with the level feeding summed over
    the alpha-energy grid (equal weights). Adds "c": [[E_gamma, P], ...] to the line entries (as in capture.py)."""
    for si, sch in enumerate(schemes):
        w = {i: v for (s_, i), v in feed.items() if s_ == si and v > 0}
        if not w:
            continue
        R = sch.reach()
        edges = []                                         # (i, j, photon prob per passage of i)
        for i in range(len(sch.E)):
            for j, f, fg in sch.out[i]:
                if fg > 0:
                    edges.append((i, j, f * fg))
        P = {}                                             # probability per reaction of passing each level
        for L, v in w.items():
            for k, x in R[L].items():
                P[k] = P.get(k, 0.0) + v * x
        inten = {(i, j): P.get(i, 0.0) * p for i, j, p in edges}
        strong = sorted([e for e in edges if inten[(e[0], e[1])] > 0], key=lambda e: -inten[(e[0], e[1])])[:n_strong]
        for a in strong:
            ia = inten[(a[0], a[1])]; partners = {}
            for b in strong:
                if b is a:
                    continue
                if sch.E[b[0]] <= sch.E[a[1]] + 1e-6:       # b below a
                    pb = R[a[1]].get(b[0], 0.0) * b[2]
                elif sch.E[a[0]] <= sch.E[b[1]] + 1e-6:     # b above a
                    pb = inten[(b[0], b[1])] * R[b[1]].get(a[0], 0.0) * a[2] / ia
                else:
                    continue
                if pb >= pmin:
                    eg = round(sch.egamma(b[0], b[1]), 2); partners[eg] = max(partners.get(eg, 0), round(pb, 3))
            if not partners:
                continue
            ega = round(sch.egamma(a[0], a[1]), 2)
            for item in lines:
                if abs(item["Eg"] - ega) < 0.01 and abs(item["from"] - round(sch.E[a[0]], 2)) < 0.01:
                    item["c"] = sorted([[e, p] for e, p in partners.items()], key=lambda t: -t[1])[:6]
                    break
