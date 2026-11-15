"""Curated knowledge for the Gamma Line Explorer: where each source shows up in low-background work, what produces it,
and how to test for it. The nuclear numbers themselves (energies, intensities, half-lives) come from ENSDF via
IAEA LiveChart and from the G4RiversideCASCADE level schemes; this file only adds context.

Context keys used by the page's "your setup" panel:
  env:   surface | underground
  n:     neutron environment: ambient (always on), source (AmBe/Cf/DD calibration nearby), reactor (reactor nearby)
  mat:   cu ge pb steel ar xe nai csi ptfe poly bpoly water rock ti al te glass solder
  det:   hpge nai lar lxe plastic
Each source gets a prior "tier" (1 = shows up in most low-background spectra, 2 = common in specific setups,
3 = anything else in ENSDF) and "when" conditions that raise it.
"""

# ---------------------------------------------------------------- decay chains (primordial)
U238 = ["238U", "234Th", "234mPa", "234Pa", "234U", "230Th", "226Ra", "222Rn", "218Po", "214Pb", "214Bi", "214Po", "210Pb", "210Bi", "210Po"]
TH232 = ["232Th", "228Ra", "228Ac", "228Th", "224Ra", "220Rn", "216Po", "212Pb", "212Bi", "212Po", "208Tl"]
U235 = ["235U", "231Th", "231Pa", "227Ac", "227Th", "223Ra", "219Rn", "215Po", "211Pb", "211Bi", "207Tl"]

CHAIN_TEXT = {
    "U238": "²³⁸U chain (natural uranium)",
    "Th232": "²³²Th chain (natural thorium)",
    "U235": "²³⁵U chain (0.72% of natural uranium)",
}

PRIMORDIAL_WHERE = "Rock, concrete, glass, ceramics, PMTs, electronics, solder and most construction materials."

# segment of each chain whose activity can differ from the rest (broken secular equilibrium)
SEGMENTS = {
    "238U": "upper ²³⁸U chain", "234Th": "upper ²³⁸U chain", "234mPa": "upper ²³⁸U chain", "234Pa": "upper ²³⁸U chain", "234U": "upper ²³⁸U chain",
    "230Th": "middle ²³⁸U chain", "226Ra": "²²⁶Ra", "222Rn": "²²²Rn and progeny", "218Po": "²²²Rn and progeny",
    "214Pb": "²²²Rn and progeny", "214Bi": "²²²Rn and progeny", "214Po": "²²²Rn and progeny",
    "210Pb": "²¹⁰Pb and progeny", "210Bi": "²¹⁰Pb and progeny", "210Po": "²¹⁰Pb and progeny",
    "232Th": "²³²Th / ²²⁸Ra", "228Ra": "²²⁸Ra / ²²⁸Ac", "228Ac": "²²⁸Ra / ²²⁸Ac", "228Th": "²²⁸Th and progeny",
    "224Ra": "²²⁸Th and progeny", "220Rn": "²²⁸Th and progeny", "216Po": "²²⁸Th and progeny", "212Pb": "²²⁸Th and progeny",
    "212Bi": "²²⁸Th and progeny", "212Po": "²²⁸Th and progeny", "208Tl": "²²⁸Th and progeny",
}

CHAIN_TESTS = {
    "U238": [
        "Compare ²¹⁴Pb (295, 352 keV) with ²¹⁴Bi (609, 1120, 1764 keV): both should follow the ²²²Rn activity.",
        "If these lines change with ventilation, air pressure or a nitrogen purge, the source is airborne radon, not the materials.",
        "After a purge or sealing, radon-supported lines fall with ²²²Rn's 3.8-day half-life.",
        "Compare the upper chain (²³⁴Th 63, 92 keV; ²³⁴ᵐPa 1001 keV) with ²²⁶Ra/²¹⁴Bi to check secular equilibrium.",
        "²¹⁰Pb (46.5 keV) can be far above the rest of the chain in lead and in surfaces exposed to radon (plate-out).",
    ],
    "Th232": [
        "Compare ²²⁸Ac (911, 969 keV), ²¹²Pb (239 keV), ²¹²Bi (727 keV) and ²⁰⁸Tl (583, 2614 keV): ²²⁸Ra and ²²⁸Th can be out of equilibrium.",
        "²⁰⁸Tl's 583 and 2614 keV lines are in coincidence: they sum to 3197 keV in close geometries.",
        "²²⁰Rn (thoron) progeny ²¹²Pb/²¹²Bi can come from the air; its half-life is only 56 s, so it stays near its source.",
    ],
    "U235": [
        "Natural ²³⁵U/²³⁸U activity ratio is about 0.046: the 185.7 keV ²³⁵U line overlaps ²²⁶Ra's 186.2 keV line.",
        "Check ²²³Ra (269, 324 keV) and ²¹⁹Rn (271, 402 keV) to separate ²³⁵U from ²²⁶Ra at 186 keV.",
    ],
}

RADON = {"222Rn", "218Po", "214Pb", "214Bi", "214Po", "220Rn", "216Po", "212Pb", "212Bi", "212Po", "208Tl"}

# ---------------------------------------------------------------- other primordial
PRIMORDIAL_OTHER = {
    "40K": ("Natural potassium (0.0117% ⁴⁰K): concrete, rock, glass, PMT glass, people, many salts.",
            ["1461 keV has no coincident partner: it should not appear in sum peaks.",
             "In argon detectors, ⁴⁰Ar(n,n′) also gives 1460.9 keV; ⁴²K (1525 keV) from ⁴²Ar is separate.",
             "Should not change with radon or neutron conditions."]),
    "138La": ("Natural lanthanum (0.09% ¹³⁸La): LaBr₃ and LaCl₃ scintillators, some optical glasses.",
              ["Look for 789 keV and 1436 keV; in LaBr₃ crystals the 1436 keV line is summed with Ba X-rays."]),
    "176Lu": ("Natural lutetium (2.6% ¹⁷⁶Lu): LSO/LYSO scintillators.",
              ["Cascade of 88, 202 and 307 keV in coincidence; sums appear in LYSO crystals."]),
}

# ---------------------------------------------------------------- cosmogenic activation by material
COSMOGENIC = {
    "cu": ["60Co", "58Co", "57Co", "56Co", "54Mn", "59Fe", "46Sc", "48V", "51Cr", "65Zn"],
    "ge": ["68Ge", "68Ga", "65Zn", "60Co", "58Co", "57Co", "56Co", "54Mn", "49V", "55Fe", "71Ge"],
    "steel": ["60Co", "58Co", "57Co", "56Co", "54Mn", "46Sc", "48V", "51Cr", "59Fe"],
    "ar": ["37Ar", "42K", "39Ar"],
    "xe": ["127Xe", "125I", "133Xe", "131mXe", "129mXe"],
    "nai": ["125I", "126I", "121Te", "121mTe", "123mTe", "127mTe", "22Na", "113Sn"],
    "csi": ["125I", "126I", "134Cs", "132Cs", "125Sb"],
    "ti": ["46Sc"],
    "al": ["26Al", "22Na"],
    "te": ["124Sb", "60Co", "121mTe", "123mTe", "125Sb", "110mAg"],
    "pb": ["207Bi", "194Hg", "202Pb"],
    "ptfe": ["7Be", "22Na"],
}
COSMO_TESTS = [
    "Activity falls with the isotope's half-life after the material moves underground or out of the cosmic-ray flux.",
    "Higher in materials stored or shipped at the surface (especially by air) and in material recently brought underground.",
    "Compare with the same material's surface-exposure history; ratios of cosmogenic isotopes date the exposure.",
]

# ---------------------------------------------------------------- man-made, calibration and medical isotopes
ANTHRO = {
    "137Cs": "Fallout from nuclear tests and Chernobyl/Fukushima; common in soil, older steel and some calibration sources.",
    "134Cs": "Reactor fallout (short-lived compared with ¹³⁷Cs); also cosmogenic in CsI.",
    "60Co": "Steel made since the 1950s (recycled sources), activated copper and steel, and calibration sources.",
    "241Am": "Smoke detectors, AmBe neutron sources and calibration sources.",
    "152Eu": "Calibration sources; neutron activation of concrete and of europium.",
    "133Ba": "Calibration sources.",
    "22Na": "Calibration sources; cosmogenic in aluminium, NaI and fluorine-bearing materials.",
    "207Bi": "Contamination in some lead; calibration sources.",
    "108mAg": "Silver in lead or solder; activated silver.",
    "110mAg": "Silver activated by neutrons; reactor fallout.",
    "125Sb": "Reactor fallout; cosmogenic in tellurium and tin.",
    "94Nb": "Activated niobium and some steels.",
    "192Ir": "Industrial radiography sources.",
    "99mTc": "Medical imaging: people who recently had a nuclear-medicine scan can carry it near a detector.",
    "131I": "Medical treatment and reactor fallout; people can carry it for days after treatment.",
    "123I": "Medical imaging.",
    "18F": "PET scans (511 keV only).",
    "201Tl": "Medical heart scans.",
    "67Ga": "Medical imaging.",
    "111In": "Medical imaging.",
    "177Lu": "Medical therapy.",
    "68Ga": "PET scans; also from ⁶⁸Ge (cosmogenic in germanium).",
    "226Ra": "Old luminous paint, radium sources; natural in rock.",
    "232U": "Contaminant in some reprocessed uranium.",
    "235U": "Enriched or natural uranium.",
    "239Pu": "Plutonium sources and fallout.",
    "57Co": "Calibration sources; cosmogenic in copper, iron and germanium.",
    "54Mn": "Activated steel; cosmogenic in iron, copper and germanium.",
    "88Y": "Calibration sources (898 and 1836 keV).",
    "109Cd": "Calibration sources (88 keV).",
    "113Sn": "Calibration sources.",
    "85Sr": "Calibration sources.",
    "139Ce": "Calibration sources.",
    "203Hg": "Calibration sources.",
    "65Zn": "Calibration sources; cosmogenic in copper and germanium.",
}
ANTHRO_TESTS = [
    "Does the line appear only when a particular source, person or item is nearby? Check what was moved recently.",
    "Calibration-source lines should vanish when sources are stored in their shielded container.",
]

# ---------------------------------------------------------------- reactions not covered by decay or capture data
# energy keV, label, relative strength, flags
REACTIONS = [
    {"id": "rx:annihilation", "refs": ['Energy: electron rest energy m_e c² = 510.99895 keV (CODATA 2018).'],  "name": "Annihilation (e⁺e⁻ → γγ)", "lines": [[510.999, 100, "b"]], "tier": 1,
     "how": "Positrons from β⁺ decays, pair production by high-energy gammas and cosmic-ray muon showers.",
     "where": "Every detector; strongest at the surface and near β⁺ emitters (²²Na, ⁶⁸Ga, ⁵⁸Co, ⁶⁵Zn, ²⁶Al, ¹⁸F, ⁴⁸V).",
     "tests": ["The 511 keV peak is broader than nearby lines (Doppler broadening of positronium/positrons).",
               "Falls sharply underground and with veto-tagged muons removed.",
               "Two 511 keV gammas are back-to-back: coincidences between opposite detectors confirm it."],
     "when": {}},
    {"id": "rx:b10na", "ntype": "thermal", "nphys": {"el": "B", "M": 10.81, "ab": 19.65, "sig": 3835.0, "frac": 0.94}, "refs": ['⁷Li 477.6 keV level: ENSDF (adopted levels of ⁷Li).', 'Branching (≈94% of thermal ¹⁰B(n,α) reactions populate the 478 keV state): ENDF/B-VIII.0 (D.A. Brown et al., Nucl. Data Sheets 148 (2018) 1).', 'Rate: ¹⁰B abundance 19.65% (IAEA LiveChart) and thermal absorption cross section 3835 b (Rauch & Waschkowski 2003).'], "unit": 'Intensity: gammas per 100 ¹⁰B(n,α) reactions.',  "name": "¹⁰B(n,α)⁷Li*", "lines": [[477.6, 94, "b"]], "tier": 1,
     "how": "Thermal neutron capture on boron: 94% of captures leave ⁷Li in its 478 keV state.",
     "where": "Borated polyethylene shielding, boron-loaded rubber, borosilicate glass, Pyrex.",
     "tests": ["Strongly Doppler-broadened (several keV) because the ⁷Li recoils in flight.",
               "Scales with the thermal neutron flux; grows with more borated material nearby.",
               "No other gamma from the same reaction: the α particle and ⁷Li stay inside the material."],
     "when": {"mat": ["bpoly", "glass"], "n": ["ambient", "source", "reactor"]}},
    {"id": "rx:ge72e0", "ntype": "fast", "nphys": {"el": "Ge", "M": 72.63, "ab": 27.45, "sig": 0.1, "fast": 1}, "refs": ['⁷²Ge 691.4 keV 0⁺ level (E0 decay): ENSDF (adopted levels of ⁷²Ge).', 'For ranking, an excitation cross section of 0.1 b is assumed (order of magnitude; not evaluated).'], "unit": 'Single feature; no gamma is emitted (conversion electrons only).',  "name": "⁷²Ge(n,n′) 0⁺ state (E0)", "lines": [[691.4, 100, "t"]], "tier": 1,
     "how": "Fast neutrons excite ⁷²Ge's first excited 0⁺ state inside a germanium detector; it decays by conversion electrons, not a gamma.",
     "where": "Germanium detectors only.",
     "tests": ["Peak has a sharp left edge and a tail to higher energy: the germanium recoil energy adds to the 691 keV deposit.",
               "Seen only when the excitation happens inside the germanium crystal itself.",
               "Scales with the fast neutron flux, like ⁷⁴Ge(n,n′) at 596 keV."],
     "when": {"det": ["hpge"], "n": ["ambient", "source", "reactor"]}},
    {"id": "rx:ge74nn", "ntype": "fast", "nphys": {"el": "Ge", "M": 72.63, "ab": 36.52, "sig": 0.5, "fast": 1}, "refs": ['⁷⁴Ge 595.85 keV level: ENSDF (adopted levels of ⁷⁴Ge).', 'For ranking, an excitation cross section of 0.5 b is assumed (order of magnitude; not evaluated).'], "unit": 'Single feature.',  "name": "⁷⁴Ge(n,n′γ) in the detector", "lines": [[595.85, 100, "t"]], "tier": 1,
     "how": "Fast neutrons excite ⁷⁴Ge's 596 keV level inside a germanium detector.",
     "where": "Germanium detectors only.",
     "tests": ["Asymmetric 'triangle' peak: the germanium recoil energy is summed with the 596 keV gamma.",
               "Compare with 691 keV (⁷²Ge 0⁺): both scale with the fast neutron flux.",
               "A symmetric 596 keV peak instead points to ⁷³Ge(n,γ) capture or ⁷⁴As decay."],
     "when": {"det": ["hpge"], "n": ["ambient", "source", "reactor"]}},
    {"id": "rx:be9an", "refs": ['¹²C 4438.9 keV level: ENSDF (adopted levels of ¹²C).'], "unit": 'Single line; its share of neutrons depends on the source.',  "name": "⁹Be(α,n)¹²C*", "lines": [[4438.9, 100, "b"]], "tier": 2,
     "how": "Alpha particles on beryllium; the gamma from ¹²C's 4.44 MeV state accompanies most neutrons from AmBe/PuBe sources.",
     "where": "AmBe and PuBe neutron sources; beryllium parts near alpha emitters.",
     "tests": ["Doppler-broadened by tens of keV.", "Present only with an (α,n) neutron source nearby; its escape peaks appear at 3928 and 3417 keV."],
     "when": {"n": ["source"]}},
    {"id": "rx:c13an", "refs": ['¹⁶O 6129.9 keV level: ENSDF (adopted levels of ¹⁶O).'], "unit": 'Single line; its share of reactions depends on the alpha energy.',  "name": "¹³C(α,n)¹⁶O*", "lines": [[6129.9, 100, "b"]], "tier": 2,
     "how": "Alpha particles from radon or uranium/thorium decays on ¹³C in organic materials; some neutrons leave ¹⁶O excited.",
     "where": "Liquid scintillators, plastics and organics contaminated with ²¹⁰Po or radon.",
     "tests": ["Rate follows the alpha activity (²¹⁰Po, radon) in the organic material.",
               "Accompanied by a neutron: look for a delayed 2223 keV capture gamma in hydrogenous media."],
     "when": {"det": ["plastic"]}},
    {"id": "rx:f19aa", "refs": ['¹⁹F 109.9 and 197.1 keV levels: ENSDF (adopted levels of ¹⁹F).'], "unit": 'Relative strengths are indicative only: they depend on the alpha (or neutron) energy.',  "name": "¹⁹F(α,α′γ)¹⁹F", "lines": [[109.9, 60, ""], [197.1, 100, ""]], "tier": 2,
     "how": "Alpha particles exciting fluorine's low-lying levels.",
     "where": "PTFE (Teflon) and other fluoropolymers near alpha emitters (radon, ²¹⁰Po plate-out).",
     "tests": ["Rate follows the alpha activity on PTFE surfaces (²¹⁰Po plate-out, radon exposure).",
               "Also produced by fast neutrons: ¹⁹F(n,n′γ) gives the same two lines."],
     "when": {"mat": ["ptfe"]}},
    {"id": "rx:o16np", "ntype": "fast", "refs": ['¹⁶N decay gammas and intensities: ENSDF (¹⁶N β⁻ decay).'], "unit": 'Intensity: gammas per 100 ¹⁶N decays.',  "name": "¹⁶O(n,p)¹⁶N → ¹⁶O*", "lines": [[6128.6, 67, ""], [7115.2, 4.9, ""]], "tier": 2,
     "how": "Fast neutrons (above about 10 MeV) on oxygen make ¹⁶N, which decays in 7.1 s to excited ¹⁶O.",
     "where": "Water and oxygen-rich materials near reactors, accelerators or high-energy neutrons (cosmic-ray muons).",
     "tests": ["Delayed by seconds after the neutron burst (7.13 s half-life).", "Strong near reactors' cooling water."],
     "when": {"n": ["reactor", "source"], "mat": ["water"]}},
]

# ---------------------------------------------------------------- X-ray fluorescence from shielding and detectors
XRAY_ELEMENTS = {
    "Pb": ("pb", 1, "Lead shielding fluorescing under gammas or betas (from ²¹⁰Pb/²¹⁰Bi in the lead itself)."),
    "Bi": ("pb", 2, "Bismuth X-rays follow ²¹⁰Pb, ²¹⁴Pb and ²¹²Pb decays (in lead and radon progeny)."),
    "Cu": ("cu", 2, "Copper shielding and cryostats fluorescing."),
    "Ge": ("ge", 2, "Germanium detector escape X-rays and cosmogenic ⁶⁸Ge/⁷¹Ge decays (Ga X-rays)."),
    "W": ("", 3, "Tungsten collimators and shielding."),
    "Ta": ("", 3, "Tantalum parts."),
    "Sn": ("solder", 3, "Tin in solder and bronze."),
    "Cd": ("", 3, "Cadmium neutron absorbers (also ¹¹³Cd(n,γ) at 558 keV)."),
    "Ba": ("", 3, "Barium in glass, concrete and ¹³⁷Cs decays (Ba K X-rays near 32 keV)."),
    "I": ("nai", 2, "Iodine in NaI/CsI detectors: escape peaks and fluorescence."),
    "Xe": ("xe", 2, "Xenon detectors: escape X-rays and ¹²⁷Xe/¹²⁵I decays."),
    "Fe": ("steel", 3, "Steel fluorescing (6.4 keV)."),
    "Ga": ("ge", 2, "Gallium X-rays (9.2–10.4 keV) from cosmogenic ⁶⁸Ge, ⁷¹Ge, ⁶⁵Zn decays in germanium."),
}

# ---------------------------------------------------------------- materials, for (n,γ) and (n,n′) source weighting
MATERIAL_ELEMENTS = {
    "cu": ["Cu"], "ge": ["Ge"], "pb": ["Pb"], "steel": ["Fe", "Cr", "Ni", "Mn", "Co", "Mo", "Si", "C"],
    "ar": ["Ar"], "xe": ["Xe"], "nai": ["Na", "I", "Tl"], "csi": ["Cs", "I"], "ptfe": ["C", "F"],
    "poly": ["H", "C"], "bpoly": ["H", "C", "B"], "water": ["H", "O"], "rock": ["O", "Si", "Al", "Fe", "Ca", "Na", "K", "Mg", "H", "Cl", "Ti"],
    "ti": ["Ti"], "al": ["Al"], "te": ["Te"], "glass": ["Si", "O", "B", "Na", "K"], "solder": ["Sn", "Pb", "Ag", "Cu"],
}
# elements that are present (as structural materials, rock or people) in almost every lab
ALWAYS_ELEMENTS = ["H", "O", "Si", "Al", "Fe", "Ca", "Na", "K", "Cl", "C", "N", "Mg", "Ti", "Mn", "Cr", "Ni", "Cu"]
# isotopes whose thermal absorption mainly is not (n,γ)
NOT_CAPTURE = {(5, 10): "(n,α)", (3, 6): "(n,t)", (2, 3): "(n,p)", (7, 14): "(n,p) for 1.83 b of 1.91 b"}
