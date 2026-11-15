"""Typical materials for the Gamma Line Explorer's rate model: elemental composition and radioactivity.

Each material gives, per kilogram:
  comp  elemental mass fractions (for neutron capture and inelastic-scattering rates)
  act   activities (Bq/kg) of decay-chain segments and single radionuclides
together with where every number comes from. The explorer assumes equal masses of all selected materials.
"""
import json
import os

import periodictable as pt

HERE = os.path.dirname(os.path.abspath(__file__))
U_PPM_BQKG = 1e3 / 81.0           # 238U: 1 ppm = 12.35 Bq/kg (radiopurity.org conversion factors)
TH_PPM_BQKG = 1e3 / 246.0         # 232Th: 1 ppm = 4.07 Bq/kg
K_PPM_BQKG = 1e3 / 32.3e3         # 40K per ppm natural K: 31.0 mBq/kg
U235_PER_U238 = 0.0460            # natural 235U/238U activity ratio (from the IUPAC isotopic composition and half-lives)

RP_REF = ("radiopurity.org Material Assay Database: J.C. Loach et al., \"A database for storing the results of material radiopurity "
          "measurements\", Nucl. Instrum. Meth. A 839 (2016) 6–11; median of the assay records for this material (retrieved 2026-11-15).")
RG_REF = ("R.L. Rudnick and S. Gao, \"Composition of the Continental Crust\", in Treatise on Geochemistry vol. 3 (Elsevier, 2003) 1–64, "
          "doi:10.1016/B0-08-043751-6/03016-4: upper continental crust, 2.7 ppm U, 10.5 ppm Th, 2.80 wt% K₂O, and major-element oxides.")


def oxides(wt):
    """Convert oxide weight percents into elemental mass fractions (normalized; oxygen included)."""
    comp = {}
    for formula, w in wt.items():
        f = pt.formula(formula)
        mass = f.mass
        for el, n in f.atoms.items():
            comp[el.symbol] = comp.get(el.symbol, 0) + w / 100 * n * el.mass / mass
    tot = sum(comp.values())
    return {k: v / tot for k, v in comp.items()}


def stoich(formula):
    f = pt.formula(formula)
    return {el.symbol: n * el.mass / f.mass for el, n in f.atoms.items()}


MATERIALS = {
    "cu": ("Copper", {"Cu": 1.0}, "Pure copper (OFHC/OFE ≥ 99.99% Cu)."),
    "pb": ("Lead", {"Pb": 1.0}, "Pure lead."),
    "steel": ("Stainless steel (304)", None, "AISI 304 nominal composition (ASTM A240): 18–20% Cr, 8–10.5% Ni, ≤ 2% Mn, ≤ 0.75% Si, ≤ 0.08% C, balance Fe; mid-range values used."),
    "ge": ("Germanium", {"Ge": 1.0}, "Pure germanium."),
    "ar": ("Argon", {"Ar": 1.0}, "Pure argon."),
    "xe": ("Xenon", {"Xe": 1.0}, "Pure xenon."),
    "nai": ("NaI", None, "Stoichiometric NaI."),
    "csi": ("CsI", None, "Stoichiometric CsI."),
    "ti": ("Titanium", {"Ti": 1.0}, "Pure titanium."),
    "al": ("Aluminium", {"Al": 1.0}, "Pure aluminium."),
    "ptfe": ("PTFE", None, "Stoichiometric (C₂F₄)ₙ."),
    "poly": ("Polyethylene", None, "Stoichiometric (C₂H₄)ₙ."),
    "bpoly": ("Borated polyethylene", None, "Polyethylene with 5% natural boron by mass (a typical commercial loading; assumption)."),
    "water": ("Water", None, "Stoichiometric H₂O."),
    "rock": ("Rock / concrete", None, RG_REF + " Moisture is not included: add Water for wet rock or concrete."),
    "glass": ("Borosilicate glass", None, "Borosilicate glass, nominal Corning 7740 (Pyrex) composition: 80.6% SiO₂, 13.0% B₂O₃, 4.0% Na₂O, 2.3% Al₂O₃."),
    "te": ("Tellurium", {"Te": 1.0}, "Pure tellurium."),
    "solder": ("Solder (Sn63Pb37)", {"Sn": 0.63, "Pb": 0.37}, "Eutectic tin–lead solder, 63% Sn, 37% Pb by mass."),
}


def composition(key):
    name, comp, ref = MATERIALS[key]
    if comp:
        return comp
    if key == "steel":
        c = {"Fe": 0.0, "Cr": 0.19, "Ni": 0.0925, "Mn": 0.02, "Si": 0.0075, "C": 0.0008}
        c["Fe"] = 1 - sum(c.values())
        return c
    if key == "nai":
        return stoich("NaI")
    if key == "csi":
        return stoich("CsI")
    if key == "ptfe":
        return stoich("C2F4")
    if key == "poly":
        return stoich("C2H4")
    if key == "bpoly":
        c = {k: 0.95 * v for k, v in stoich("C2H4").items()}
        c["B"] = 0.05
        return c
    if key == "water":
        return stoich("H2O")
    if key == "rock":     # Rudnick & Gao (2003) upper continental crust, major oxides (wt%)
        return oxides({"SiO2": 66.6, "TiO2": 0.64, "Al2O3": 15.4, "FeO": 5.04, "MnO": 0.10, "MgO": 2.48, "CaO": 3.59,
                       "Na2O": 3.27, "K2O": 2.80, "P2O5": 0.15})
    if key == "glass":
        return oxides({"SiO2": 80.6, "B2O3": 13.0, "Na2O": 4.0, "Al2O3": 2.3})
    raise KeyError(key)


def activities(key, rp):
    """Activities (Bq/kg) per segment and what each is based on."""
    act, basis = {}, {}
    if key == "rock":
        u, th, k = 2.7 * U_PPM_BQKG, 10.5 * TH_PPM_BQKG, 2.80 * 0.830 * 1e4 * K_PPM_BQKG    # K₂O → K: 0.830
        for seg, v in (("U238", u), ("Ra226", u), ("Pb210", u), ("Th232", th), ("Th228", th), ("K40", k), ("U235", u * U235_PER_U238)):
            act[seg], basis[seg] = v, "upper-crust average (Rudnick & Gao 2003), chains in equilibrium"
        return act, basis
    rec = rp.get(key)
    if not rec:
        return act, basis

    def pick(iso):
        v = rec["iso"].get(iso)
        if not v:
            return None, None
        med, nm, lim, nl = v
        if nm >= 3 and med:
            return med, "median of %d measured values" % nm
        vals = [x for x in (med, lim) if x]
        if not vals:
            return None, None
        # few measurements: use the larger of the measured median and the median upper limit, as an upper estimate
        return max(vals), "upper estimate (%d measured, %d upper limits)" % (nm, nl)

    def setseg(seg, *isos):
        for want_measured in (True, False):        # prefer any well-measured isotope over sparse data
            for iso in isos:
                v, b = pick(iso)
                if v is not None and (b.startswith("median") or not want_measured):
                    act[seg], basis[seg] = v, b + " of " + iso
                    return
    setseg("U238", "U-238")
    setseg("Ra226", "Ra-226", "U-238")
    v, b = pick("Pb-210")                         # ²¹⁰Pb is often far from equilibrium: direct data, even sparse, wins
    if v is not None:
        act["Pb210"], basis["Pb210"] = v, b + " of Pb-210"
    else:
        setseg("Pb210", "Ra-226", "U-238")
    setseg("Th232", "Ra-228", "Ac-228", "Th-232")
    setseg("Th228", "Th-228", "Th-232")
    setseg("K40", "K-40")
    setseg("Co60", "Co-60")
    setseg("Cs137", "Cs-137")
    if "U238" in act:
        act["U235"], basis["U235"] = act["U238"] * U235_PER_U238, "from ²³⁸U × 0.046 (natural ratio)"
    return act, basis


def build():
    rp = json.load(open(os.path.join(HERE, "radiopurity_summary.json")))
    out = {}
    for key, (name, _, cref) in MATERIALS.items():
        act, basis = activities(key, rp)
        refs = ["Composition: " + cref]
        if key in rp and key != "rock":
            refs.append(RP_REF)
            pubs = sorted({r.split(" | ", 1)[1].strip() or ("%s entries contributed to radiopurity.org" % r.split(" | ")[0].strip())
                           for r in rp[key]["refs"]})
            refs.append("Assay data sets: " + "; ".join(p.replace("ILIAS Database http://radiopurity.in2p3.fr/", "ILIAS radiopurity database (radiopurity.in2p3.fr)") for p in pubs))
        if not act:
            refs.append("No assay data used: decay lines from this material are not modelled.")
        out[key] = {"name": name, "comp": {k: round(v, 5) for k, v in composition(key).items()},
                    "act": {k: float("%.3g" % v) for k, v in act.items()}, "basis": basis,
                    "n": rp.get(key, {}).get("n", 0) if key != "rock" else 0, "refs": refs}
    return out


if __name__ == "__main__":
    for k, v in build().items():
        print(k, v["comp"], v["act"])
