"""Thermal-neutron-capture gamma lines from the G4RiversideCASCADE level schemes.

Each file in CASCADE's Supplemental/LevelStructureTXTs is the level scheme of a post-capture nucleus ("Z-A.txt"),
built from ENSDF/CapGam: a level energy on its own line, then its transitions,
    " - <final level keV>, <branching>"   gamma            " E ..."  conversion electron
    " P <final level keV>, <branching>"   unresolved decay handled by photon evaporation
    " U ..." / " V ..."                   unplaced gamma / electron (ignored, as in CASCADE's recommended settings)
The capture state is the highest level. Instead of sampling cascades, the level populations are propagated exactly
(the scheme is a directed graph that only goes downward), which gives:
  - every gamma line's intensity per capture,
  - for strong lines, the probability that another line appears in the same cascade (coincidences / true summing),
  - the mean gamma multiplicity.
"""
import os
import re

import numpy as np

AMU_KEV = 931494.10242


def parse(path):
    levels = []                                  # [energy, [(kind, final_energy, branching), ...]]
    for line in open(path):
        if not line.strip():
            continue
        if line[0] not in " \t":
            levels.append([float(line.split()[0]), []])
            continue
        m = re.match(r"\s*([-EPUVX])\s+([-\d.eE+]+)\s*,\s*([-\d.eE+]+)", line)
        if m and levels:
            levels[-1][1].append((m.group(1), float(m.group(2)), float(m.group(3))))
    return levels


def analyse(path, a_compound, min_line=1e-4, n_strong=40):
    levels = parse(path)
    levels.sort(key=lambda l: l[0])
    E = np.array([l[0] for l in levels])
    if E[0] > 1e-6:                              # make sure the ground state exists as a node
        levels.insert(0, [0.0, []])
        E = np.insert(E, 0, 0.0)
    n = len(levels)

    def idx(e):
        k = int(np.argmin(np.abs(E - e)))
        return k

    # outgoing transitions with normalised probabilities
    out = []
    for i, (e, trs) in enumerate(levels):
        use = [(k, f, b) for k, f, b in trs if k in "-EP" and b > 0]
        tot = sum(b for _, _, b in use)
        lst = []
        for k, f, b in use:
            j = idx(f)
            if j >= i:                           # malformed (upward) transition: skip
                continue
            lst.append((j, b / tot, k))
        out.append(lst)
    top = n - 1
    pop = np.zeros(n)
    pop[top] = 1.0
    lines = []                                   # (Eγ, intensity per capture, i, j, kind, frac)
    for i in range(n - 1, 0, -1):
        if pop[i] <= 0:
            continue
        for j, frac, kind in out[i]:
            flow = pop[i] * frac
            pop[j] += flow
            if kind in "-P":
                de = E[i] - E[j]
                eg = de - de * de / (2 * a_compound * AMU_KEV)      # nuclear recoil
                lines.append([eg, flow, i, j, kind, frac])
    # reach[i, k] = probability that a cascade passing level i later passes level k
    reach = np.zeros((n, n))
    for i in range(n):
        reach[i, i] = 1.0
        for j, frac, _ in out[i]:
            reach[i] += frac * reach[j]
    lines.sort(key=lambda l: -l[1])
    strong = [l for l in lines if l[1] >= 2e-3][:n_strong]
    mult = sum(l[1] for l in lines)
    res = []
    for l in lines:
        if l[1] < min_line:
            continue
        item = {"e": round(float(l[0]), 2), "i": round(float(l[1]) * 100, 4), "from": round(float(E[l[2]]), 2), "to": round(float(E[l[3]]), 2)}
        if l[4] == "P":
            item["pe"] = 1                       # level decays through photon evaporation in CASCADE: approximate
        res.append(item)
    # coincidences between strong lines: P(b in the same cascade | a)
    for a in strong:
        partners = []
        for b in strong:
            if b is a:
                continue
            if E[b[2]] <= E[a[3]] + 1e-6:        # b below a
                p = reach[a[3], b[2]] * b[5]
            elif E[a[2]] <= E[b[3]] + 1e-6:      # b above a
                p = b[1] * reach[b[3], a[2]] * a[5] / a[1]
            else:
                continue
            if p >= 0.02:
                partners.append((round(float(b[0]), 2), round(float(p), 3)))
        partners.sort(key=lambda t: -t[1])
        for item in res:
            if abs(item["e"] - round(a[0], 2)) < 1e-6 and abs(item["i"] - round(a[1] * 100, 4)) < 1e-9:
                item["c"] = partners[:8]
                break
    return {"lines": res, "mult": round(float(mult), 3), "sn": round(float(E[top]), 2), "n_levels": n}


def all_targets(txt_dir):
    out = {}
    for f in os.listdir(txt_dir):
        m = re.match(r"(\d+)-(\d+)\.txt$", f)
        if m:
            z, a = int(m.group(1)), int(m.group(2))
            out[(z, a - 1)] = analyse(os.path.join(txt_dir, f), a)
    return out
