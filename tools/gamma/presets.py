"""Ballpark material masses for typical setups (Gamma Line Explorer presets).

Masses are *effective* masses in kg: the component mass times the fraction of its gammas that reach the detector's
active volume without interacting. For components next to the active volume that fraction is taken as 1. For thick
shields only the inner layer matters: a slab thicker than one attenuation length λ acts like a layer λ thick.
Components behind other material get the transmission exp(-x/λ). λ is evaluated at 1.5 MeV (Compton scattering from
the Klein–Nishina formula, which reproduces the NIST XCOM water value to 0.2%; for lead the XCOM total, 0.0522 cm²/g,
is used). Lower-energy lines are attenuated more, so the numbers overweight outer components for low-energy lines.
"""
import math

LAMBDA_CM = {"cu": 2.37, "pb": 1.69, "steel": 2.63, "acrylic": 15.2, "hdpe": 17.9, "lab": 20.1}
LAMBDA_REF = ("Attenuation lengths at 1.5 MeV: Klein–Nishina Compton cross section (Cu 2.37 cm, steel 2.63 cm, acrylic 15.2 cm, "
              "polyethylene 17.9 cm, LAB scintillator 20.1 cm) and the NIST XCOM total for lead (0.0522 cm²/g, 1.69 cm): "
              "M.J. Berger et al., XCOM: Photon Cross Sections Database, NIST Standard Reference Database 8.")


def slab_self(t, lam):
    """mean escape probability, perpendicular to a slab of thickness t (cm), averaged over depth"""
    return lam / t * (1 - math.exp(-t / lam))


def tr(x, lam):
    return math.exp(-x / lam)


def r(v):
    return float("%.3g" % v)


THESIS = ("S.S. Westerdale, \"A Study of Nuclear Recoil Backgrounds in Dark Matter Detectors\", PhD thesis, Princeton University (2016), "
          "FERMILAB-THESIS-2016-39, Tables 2.1–2.2 (DarkSide-50 TPC components).")
DEAP_EM = ("R. Ajaj et al. (DEAP Collaboration), \"Electromagnetic backgrounds and potassium-42 activity in the DEAP-3600 dark matter detector\", "
           "Phys. Rev. D 100 (2019) 072009, doi:10.1103/PhysRevD.100.072009, Tables V–VI (component masses).")
DEAP_DES = ("P.-A. Amaudruz et al. (DEAP Collaboration), \"Design and construction of the DEAP-3600 dark matter detector\", "
            "Astropart. Phys. 108 (2019) 1, doi:10.1016/j.astropartphys.2018.09.006 (geometry: 5 cm acrylic vessel, 45 cm light guides, 3.4 m steel shell, LAr mass).")
X1T = ("E. Aprile et al. (XENON Collaboration), \"Physics reach of the XENON1T dark matter experiment\", JCAP 04 (2016) 027, "
       "doi:10.1088/1475-7516/2016/04/027, Table 1 (component masses).")
COSINE = ("G. Adhikari et al. (COSINE-100 Collaboration), \"Initial performance of the COSINE-100 experiment\", Eur. Phys. J. C 78 (2018) 107, "
          "doi:10.1140/epjc/s10052-018-5590-x (106 kg NaI(Tl); 152×142×142 cm copper box, 3 cm walls, 6.4 t; 20 cm lead; ≥ 40 cm of LAB scintillator "
          "between the crystal PMTs and the box).")
GATOR = ("L. Baudis et al., \"Gator: a low-background counting facility at the Gran Sasso Underground Laboratory\", JINST 6 (2011) P08010, "
         "doi:10.1088/1748-0221/6/08/P08010 (2.2 kg HPGe; 25×25×33 cm cavity; 5 cm copper; 5 cm lead at 3 Bq/kg ²¹⁰Pb inside 15 cm at 75 Bq/kg).")
PMT_KG = 0.171


def presets():
    P = []
    # ---------------------------------------------------------------- DarkSide-50
    steel = 142 + 30.0 + 1.92 + 2.92 + 0.826 + 0.468 + 0.461 + 0.0019
    P.append({"id": "ds50", "name": "DarkSide-50 (LAr TPC)", "det": "lar", "env": "underground",
              "mass": {"ar": 153, "steel": r(steel), "ptfe": r(35.88 + 22.34), "cu": r(16.5 + 0.887), "pmt3": r(38 * PMT_KG),
                       "poly": 1.04, "solder": 0.05},
              "notes": ["All components sit within ~10 cm of the active argon; their full masses are used.",
                        "Steel: cryostat body 142 kg, flanges 30.0 kg, organ-pipe tubes, bolts, nuts, washers, grid and grid ring (%.1f kg)." % steel,
                        "PTFE: support structures 35.88 kg + reflector 22.34 kg. Copper: field-cage rings 16.5 kg + PMT screws 0.887 kg.",
                        "PMTs: 38 Hamamatsu R11065 (Kovar shells 5.31 kg in all), entered as 38 × 0.171 kg low-background 3-inch PMTs.",
                        "Polyethylene: multilayer-insulation netting 1.04 kg. Solder: 0.050 kg.",
                        "Left out: fused-silica windows and diving bell (3.2 kg; much cleaner than the borosilicate glass in this tool), "
                        "the 30 t liquid-scintillator veto and 1 kt water tank (very radiopure liquids that also shield the rock: rock set to 0)."],
              "refs": [THESIS]})
    # ---------------------------------------------------------------- DEAP-3600
    av = 643 * slab_self(5, LAMBDA_CM["acrylic"])
    behind_av = tr(5, LAMBDA_CM["acrylic"])
    lg = 3774 * behind_av * slab_self(45, LAMBDA_CM["acrylic"])
    fb = 2725 * behind_av * slab_self(45, LAMBDA_CM["hdpe"])
    outer = tr(50, LAMBDA_CM["acrylic"])                       # 5 cm vessel + 45 cm light guides
    shell_t = 5012e3 / (4 * math.pi * 170 ** 2 * 7.9)            # ≈ 1.75 cm for a 3.4 m sphere
    pm = 516 * outer
    ss = 5012 * outer * slab_self(shell_t, LAMBDA_CM["steel"])
    P.append({"id": "deap", "name": "DEAP-3600 (single-phase LAr)", "det": "lar", "env": "underground",
              "mass": {"ar": 3279, "acrylic": r(av + lg), "poly": r(fb), "glass": r(pm), "steel": r(ss)},
              "notes": ["Acrylic: vessel 643 kg × %.2f (self-absorption in 5 cm) + light guides 3774 kg × %.2f (45 cm long, behind the vessel)." % (av / 643, lg / 3774),
                        "Polyethylene: HDPE filler blocks 2725 kg × %.2f (same geometry as the light guides)." % (fb / 2725),
                        "PMTs: 255 R5912 PMTs, 516 kg (mostly borosilicate glass), × %.3f for 50 cm of acrylic in front of them." % outer,
                        "Steel: 3.4 m shell, 5012 kg (≈ %.1f cm thick), × %.3f." % (shell_t, ss / 5012),
                        "Liquid argon: 3279 kg. Rock: 0 (inside a 7.8 m water tank). Polyurethane foam (~80 kg, behind the PMTs) left out."],
              "refs": [DEAP_EM, DEAP_DES, LAMBDA_REF]})
    # ---------------------------------------------------------------- XENON1T
    P.append({"id": "x1t", "name": "XENON1T (LXe TPC)", "det": "lxe", "env": "underground",
              "mass": {"xe": 3200, "steel": 870 + 260 + 80, "ptfe": 92, "cu": 184, "pmt3": r(248 * PMT_KG)},
              "notes": ["Full component masses: cryostat shells 870 kg, flanges 260 kg, bell and electrode rings 80 kg (steel); PTFE 92 kg; copper 184 kg.",
                        "PMTs: 248 Hamamatsu R11410-21, entered as 248 × 0.171 kg low-background 3-inch PMTs.",
                        "Xenon: ≈ 3.2 t in total. The outer cryostat shell is farther away and partly shielded by xenon, so steel is overweighted.",
                        "Rock: 0 (inside a 10 m water tank)."],
              "refs": [X1T]})
    # ---------------------------------------------------------------- COSINE-100
    ls = tr(40, LAMBDA_CM["lab"]) * tr(1, LAMBDA_CM["acrylic"])
    cubox = 6400 * slab_self(3, LAMBDA_CM["cu"]) * ls
    area = 2 * (152 * 142 * 2 + 142 * 142)                      # outer surface of the copper box, cm²
    pb = area * LAMBDA_CM["pb"] * 11.35e-3 * tr(3, LAMBDA_CM["cu"]) * ls
    P.append({"id": "cosine", "name": "COSINE-100 (NaI array)", "det": "nai", "env": "underground",
              "mass": {"nai": 106, "cu": r(cubox), "pb": r(pb), "pmt3": r(16 * PMT_KG)},
              "notes": ["Copper box: 6.4 t × %.2f (self-absorption in 3 cm) × %.2f (≥ 40 cm of LAB scintillator and 1 cm acrylic)." % (slab_self(3, LAMBDA_CM["cu"]), ls),
                        "Lead: 20 cm castle; only its innermost layer (one attenuation length, %.0f kg over the box's %.1f m² outer surface) counts, × %.2f behind 3 cm copper × %.2f." % (
                            area * LAMBDA_CM["pb"] * 11.35e-3, area / 1e4, tr(3, LAMBDA_CM["cu"]), ls),
                        "PMTs: 16 Hamamatsu R12669SEL attached to the crystals, entered as 16 × 0.171 kg low-background 3-inch PMTs (a rough stand-in).",
                        "Left out: 2200 L of LAB scintillator (radiopure), crystal copper encapsulations and PTFE wrapping (masses not given). Rock: 0."],
              "refs": [COSINE, LAMBDA_REF]})
    # ---------------------------------------------------------------- HPGe screening counter (Gator)
    cav = 2 * (25 * 25 + 25 * 33 + 25 * 33)
    cu = cav * LAMBDA_CM["cu"] * (1 - math.exp(-5 / LAMBDA_CM["cu"])) * 8.96e-3
    cav2 = 2 * (35 * 35 + 35 * 43 + 35 * 43)
    pbm = cav2 * LAMBDA_CM["pb"] * (1 - math.exp(-5 / LAMBDA_CM["pb"])) * 11.35e-3 * tr(5, LAMBDA_CM["cu"])
    P.append({"id": "gator", "name": "HPGe screening counter (Gator-like)", "det": "hpge", "env": "underground",
              "mass": {"ge": 2.2, "cu": r(cu), "pb": r(pbm)},
              "notes": ["Copper: 5 cm shield around a 25×25×33 cm cavity; the layer within one attenuation length of the cavity counts (%.0f kg of ≈ 290 kg)." % cu,
                        "Lead: inner 5 cm layer, same rule, × %.2f behind 5 cm copper. Gator's inner lead has 3 Bq/kg ²¹⁰Pb, below this tool's typical lead (24 Bq/kg), so ²¹⁰Pb-chain lines are overweighted." % tr(5, LAMBDA_CM["cu"]),
                        "Copper cryostat and the sample itself are not included: add your sample's material and mass.",
                        "Rock: 0 (shielded)."],
              "refs": [GATOR, LAMBDA_REF]})
    return P


if __name__ == "__main__":
    for p in presets():
        print(p["id"], p["mass"])
