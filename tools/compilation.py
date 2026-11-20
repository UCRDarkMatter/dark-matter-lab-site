"""Curves from C.A.J. O'Hare's public compilation of direct-detection limits
(https://github.com/cajohare/DirectDetectionPlots), used where our own extractors found nothing.

    python3 tools/limits.py add-compilation /path/to/DirectDetectionPlots

Each data file names the paper it comes from; the table below maps it to our channel, experiment and
label. Curves are added as approved, with source "compilation" and the exact file and commit in the notes,
and are skipped when the same paper already has an approved curve in that channel (so nothing is doubled).
Only collaboration results from direct-detection experiments are taken: no recasts by others, no
astrophysical or collider bounds.
"""
import os
import re
import subprocess

REPO = "https://github.com/cajohare/DirectDetectionPlots"
CREDIT = "C.A.J. O'Hare, DirectDetectionPlots"

N = "data/limits/Nucleon/"
E = "data/limits/Electron/"
U = "data/limits/Ultraheavy/"

# (file, channel, experiment, label, arXiv id or "", year or None, mass unit, kind, shape, extra note)
T = [
    # ---------------------------------------------------------------- spin-independent
    (N + "SI/LUX.txt", "SI", "LUX", "LUX 2016", "1608.07648", None, "GeV", "limit", "line", ""),
    (N + "SI/XENON1T-2018.txt", "SI", "XENON", "XENON1T 2018 (1 t·yr)", "1805.12562", None, "GeV", "limit", "line", ""),
    (N + "SI/XENON1T-Migdal.txt", "SI", "XENON", "XENON1T 2019 (Migdal)", "1907.12771", None, "GeV", "limit", "line", ""),
    (N + "SI/XENONnT_power-constrained.txt", "SI", "XENON", "XENONnT 2023", "2303.14729", None, "GeV", "limit", "line", "power-constrained"),
    (N + "SI/XENONnT_2025.txt", "SI", "XENON", "XENONnT 2025 (3.1 t·yr)", "2502.18005", None, "GeV", "limit", "line", ""),
    (N + "SI/LZ_2022_power-constrained.txt", "SI", "LZ", "LZ 2022", "2207.03764", None, "GeV", "limit", "line", "power-constrained"),
    (N + "SI/LZ_2024.txt", "SI", "LZ", "LZ 2024 (4.2 t·yr)", "2410.17036", None, "GeV", "limit", "line", ""),
    (N + "SI/PandaX.txt", "SI", "PandaX", "PandaX-II 2017", "1708.06917", None, "GeV", "limit", "line", ""),
    (N + "SI/PandaX_LowMass.txt", "SI", "PandaX", "PandaX-4T 2023 (low mass)", "2212.10067", None, "GeV", "limit", "line", "S2-only and S1-S2 combined"),
    (N + "SI/PandaX_2024.txt", "SI", "PandaX", "PandaX-4T 2024 (1.54 t·yr)", "2408.00664", None, "GeV", "limit", "line", ""),
    (N + "SI/DEAP-3600.txt", "SI", "DEAP-3600", "DEAP-3600 2019 (231 d)", "1902.04048", None, "GeV", "limit", "line", ""),
    (N + "SI/DarkSide.txt", "SI", "DarkSide", "DarkSide-50 2018 (low mass)", "1802.06994", None, "GeV", "limit", "line", ""),
    (N + "SI/DarkSide-50_2022.txt", "SI", "DarkSide", "DarkSide-50 2023 (low mass)", "2207.11966", None, "GeV", "limit", "line", ""),
    (N + "SI/CRESST.txt", "SI", "CRESST", "CRESST-III 2019", "1904.00498", None, "GeV", "limit", "line", ""),
    (N + "SI/CDMSLite.txt", "SI", "SuperCDMS", "CDMSlite 2019", "1808.09098", None, "GeV", "limit", "line", "joined at high mass to CDMS II (arXiv:0912.3592)"),
    (N + "SI/EDELWEISS.txt", "SI", "EDELWEISS", "EDELWEISS-III 2016", "1607.03367", None, "GeV", "limit", "line", ""),
    (N + "SI/NEWS-G.txt", "SI", "NEWS-G", "NEWS-G 2018", "1706.04934", None, "GeV", "limit", "line", ""),
    (N + "SI/CDEX.txt", "SI", "CDEX", "CDEX-10 2018", "1802.09016", None, "GeV", "limit", "line", "Phys. Rev. Lett. 120 (2018) 241301"),
    (N + "SI/COSINE-100.txt", "SI", "COSINE", "COSINE-100 2018", "1906.01791", None, "GeV", "limit", "line", "Nature 564 (2018) 83"),
    (N + "SI/PICO2L.txt", "SI", "PICO", "PICO-2L 2016", "1601.03729", None, "GeV", "limit", "line", ""),
    (N + "SI/PICO60.txt", "SI", "PICO", "PICO-60 2019", "1902.04031", None, "GeV", "limit", "line", "combined with the 2017 PICO-60 run (arXiv:1702.07666)"),
    (N + "SI/ZEPLIN-III.txt", "SI", "ZEPLIN", "ZEPLIN-III 2009", "", 2009, "GeV", "limit", "line", "Phys. Rev. D 80 (2009) 052010"),
    (N + "SI/DAMA1.txt", "SI", "DAMA", "DAMA/LIBRA region (Na, fit by Savage et al.)", "", 2009, "GeV", "discovery", "region",
     "Annual-modulation signal region from C. Savage et al., JCAP 04 (2009) 010, arXiv:0808.3607 (not a collaboration fit)"),
    (N + "SI/DAMA2.txt", "SI", "DAMA", "DAMA/LIBRA region (I, fit by Savage et al.)", "", 2009, "GeV", "discovery", "region",
     "Annual-modulation signal region from C. Savage et al., JCAP 04 (2009) 010, arXiv:0808.3607 (not a collaboration fit)"),
    # ---------------------------------------------------------------- spin-dependent proton
    (N + "SDp/XENON1T.txt", "SD-p", "XENON", "XENON1T 2019", "1902.03234", None, "GeV", "limit", "line", ""),
    (N + "SDp/XENONnT_2025.txt", "SD-p", "XENON", "XENONnT 2025 (3.1 t·yr)", "2502.18005", None, "GeV", "limit", "line", ""),
    (N + "SDp/LZ_2024.txt", "SD-p", "LZ", "LZ 2024 (4.2 t·yr)", "2410.17036", None, "GeV", "limit", "line", ""),
    (N + "SDp/PandaX.txt", "SD-p", "PandaX", "PandaX-4T 2024 (1.54 t·yr)", "2408.00664", None, "GeV", "limit", "line", ""),
    (N + "SDp/PICO60.txt", "SD-p", "PICO", "PICO-60 2019", "1902.04031", None, "GeV", "limit", "line", ""),
    (N + "SDp/PICO2L.txt", "SD-p", "PICO", "PICO-2L 2016", "1601.03729", None, "GeV", "limit", "line", ""),
    (N + "SDp/PICASSO.txt", "SD-p", "PICASSO", "PICASSO 2012", "1202.1240", None, "GeV", "limit", "line", ""),
    (N + "SDp/COUPP.txt", "SD-p", "COUPP", "COUPP 2012", "1204.3094", None, "GeV", "limit", "line", ""),
    (N + "SDp/KIMS.txt", "SD-p", "KIMS", "KIMS 2018", "1806.06499", None, "GeV", "limit", "line", ""),
    (N + "SDp/CRESST.txt", "SD-p", "CRESST", "CRESST-III 2022 (LiAlO₂)", "2207.07640", None, "GeV", "limit", "line", ""),
    (N + "SDp/NEWS-G.txt", "SD-p", "NEWS-G", "NEWS-G 2024", "2407.12769", None, "GeV", "limit", "line", ""),
    # ---------------------------------------------------------------- spin-dependent neutron
    (N + "SDn/XENON100.txt", "SD-n", "XENON", "XENON100 2016", "1609.06154", None, "GeV", "limit", "line", ""),
    (N + "SDn/XENON1T.txt", "SD-n", "XENON", "XENON1T 2019", "1902.03234", None, "GeV", "limit", "line", ""),
    (N + "SDn/XENON1T-Migdal.txt", "SD-n", "XENON", "XENON1T 2019 (Migdal)", "1907.12771", None, "GeV", "limit", "line", ""),
    (N + "SDn/XENONnT.txt", "SD-n", "XENON", "XENONnT 2023", "2303.14729", None, "GeV", "limit", "line", ""),
    (N + "SDn/XENONnT_2025.txt", "SD-n", "XENON", "XENONnT 2025 (3.1 t·yr)", "2502.18005", None, "GeV", "limit", "line", ""),
    (N + "SDn/LUX.txt", "SD-n", "LUX", "LUX 2017", "1705.03380", None, "GeV", "limit", "line", ""),
    (N + "SDn/LZ_2024.txt", "SD-n", "LZ", "LZ 2024 (4.2 t·yr)", "2410.17036", None, "GeV", "limit", "line", ""),
    (N + "SDn/PandaX.txt", "SD-n", "PandaX", "PandaX-4T 2024 (1.54 t·yr)", "2408.00664", None, "GeV", "limit", "line", ""),
    (N + "SDn/CDMSlite.txt", "SD-n", "SuperCDMS", "CDMSlite 2019", "1808.09098", None, "GeV", "limit", "line", ""),
    (N + "SDn/CDMS.txt", "SD-n", "CDMS", "CDMS II 2009", "0912.3592", None, "GeV", "limit", "line", ""),
    (N + "SDn/CRESST.txt", "SD-n", "CRESST", "CRESST-III 2022 (LiAlO₂)", "2207.07640", None, "GeV", "limit", "line", ""),
    (N + "SDn/PICASSO.txt", "SD-n", "PICASSO", "PICASSO 2012", "1202.1240", None, "GeV", "limit", "line", ""),
]
# DM-electron scattering: the same experiments for both mediators (masses in MeV)
for med, ch in (("HeavyMediator", "DMe-heavy"), ("LightMediator", "DMe-light")):
    T += [
        (E + med + "/SENSEI.txt", ch, "SENSEI", "SENSEI 2020", "2004.11378", None, "MeV", "limit", "line",
         "as recast by DAMIC-M (arXiv:2302.02372) with a common halo and charge-yield model"),
        (E + med + "/SENSEI_1e.txt", ch, "SENSEI", "SENSEI at SNOLAB 2024 (1e⁻)", "2410.18716", None, "MeV", "limit", "line", ""),
        (E + med + "/DAMIC-M.txt", ch, "DAMIC", "DAMIC-M 2023", "2302.02372", None, "MeV", "limit", "line", ""),
        (E + med + "/DAMIC-M-DailyModulation.txt", ch, "DAMIC", "DAMIC-M 2023 (daily modulation)", "2307.07251", None, "MeV", "limit", "line", ""),
        (E + med + "/DAMIC-M_2025.txt", ch, "DAMIC", "DAMIC-M 2025", "2503.14617", None, "MeV", "limit", "line", ""),
        (E + med + "/CDMS-HVeV.txt", ch, "SuperCDMS", "SuperCDMS HVeV 2020", "", 2020, "MeV", "limit", "line",
         "Phys. Rev. D 102 (2020) 091101, as recast by DAMIC-M (arXiv:2302.02372)"),
        (E + med + "/EDELWEISS.txt", ch, "EDELWEISS", "EDELWEISS 2020", "2003.01046", None, "MeV", "limit", "line", ""),
        (E + med + "/DarkSide-50.txt", ch, "DarkSide", "DarkSide-50 2023", "2207.11968", None, "MeV", "limit", "line", ""),
        (E + med + "/PandaX.txt", ch, "PandaX", "PandaX-II 2021", "", 2021, "MeV", "limit", "line", "Phys. Rev. Lett. 126 (2021) 211803"),
        (E + med + "/CDEX.txt", ch, "CDEX", "CDEX-10 2022", "2206.04128", None, "MeV", "limit", "line", ""),
    ]
T += [(E + "HeavyMediator/XENON1T.txt", "DMe-heavy", "XENON", "XENON1T 2019 (S2-only)", "1907.11485", None, "MeV", "limit", "line", "")]
# Dark photon and ALP absorption (masses in eV; the files close their regions at coupling = 1, which is dropped)
D, A = E + "DarkPhoton/", E + "Axion/"
T += [
    (D + "XENONnT.txt", "dark-photon", "XENON", "XENONnT 2022", "2207.11330", None, "eV", "limit", "line", ""),
    (D + "Xenon1T_S1S2.txt", "dark-photon", "XENON", "XENON1T 2020", "2006.09721", None, "eV", "limit", "line", ""),
    (D + "Xenon1T.txt", "dark-photon", "XENON", "XENON1T 2019 (S2-only)", "1907.11485", None, "keV", "limit", "line",
     "masses in this file are in keV"),
    (D + "XENON1T_SE.txt", "dark-photon", "XENON", "XENON1T 2021 (single electrons)", "2112.12116", None, "eV", "limit", "line", ""),
    (D + "PandaX.txt", "dark-photon", "PandaX", "PandaX-4T 2024", "2409.00773", None, "eV", "limit", "line", "also arXiv:2408.07641"),
    (D + "DarkSide.txt", "dark-photon", "DarkSide", "DarkSide-50 2023", "2207.11968", None, "eV", "limit", "line", ""),
    (D + "SuperCDMS.txt", "dark-photon", "SuperCDMS", "SuperCDMS Soudan 2019", "1911.11905", None, "eV", "limit", "line", ""),
    (D + "EDELWEISS.txt", "dark-photon", "EDELWEISS", "EDELWEISS 2018", "1808.02340", None, "eV", "limit", "line", ""),
    (D + "DAMIC.txt", "dark-photon", "DAMIC", "DAMIC 2019", "1907.12628", None, "eV", "limit", "line", ""),
    (D + "SENSEI.txt", "dark-photon", "SENSEI", "SENSEI 2020", "2004.11378", None, "eV", "limit", "line", ""),
    (D + "SENSEI_1e.txt", "dark-photon", "SENSEI", "SENSEI at SNOLAB 2024 (1e⁻)", "2410.18716", None, "eV", "limit", "line", ""),
    (A + "XENONnT.txt", "ALP", "XENON", "XENONnT 2022", "2207.11330", None, "eV", "limit", "line", ""),
    (A + "XENON1T_DM_S1S2.txt", "ALP", "XENON", "XENON1T 2020", "2006.09721", None, "eV", "limit", "line", ""),
    (A + "XENON1T_DM_S2.txt", "ALP", "XENON", "XENON1T 2019 (S2-only)", "1907.11485", None, "eV", "limit", "line", ""),
    (A + "XENON1T_DM_SE.txt", "ALP", "XENON", "XENON1T 2021 (single electrons)", "2112.12116", None, "eV", "limit", "line", ""),
    (A + "PandaX.txt", "ALP", "PandaX", "PandaX-4T 2024", "2409.00773", None, "eV", "limit", "line", "also arXiv:2408.07641"),
    (A + "DarkSide.txt", "ALP", "DarkSide", "DarkSide-50 2023", "2207.11968", None, "eV", "limit", "line", ""),
    (A + "SuperCDMS.txt", "ALP", "SuperCDMS", "SuperCDMS Soudan 2019", "1911.11905", None, "eV", "limit", "line", ""),
    (A + "EDELWEISS.txt", "ALP", "EDELWEISS", "EDELWEISS 2018", "1808.02340", None, "eV", "limit", "line", ""),
    (A + "LUX.txt", "ALP", "LUX", "LUX 2017", "1704.02297", None, "eV", "limit", "line", "dark matter and solar axions"),
    # ---------------------------------------------------------------- ultra-heavy (closed islands: outlines kept in drawing order)
    (U + "A4/DEAP-3600.txt", "UHDM-A4", "DEAP-3600", "DEAP-3600 2021", "2108.09405", None, "GeV", "limit", "region", ""),
    (U + "A4/LZ.txt", "UHDM-A4", "LZ", "LZ 2024", "2402.08865", None, "GeV", "limit", "region", ""),
    (U + "Contact/DEAP-3600.txt", "UHDM-A", "DEAP-3600", "DEAP-3600 2021", "2108.09405", None, "GeV", "limit", "region", ""),
    (U + "Contact/LZ.txt", "UHDM-A", "LZ", "LZ 2024", "2402.08865", None, "GeV", "limit", "region", ""),
]

UNIT = {"GeV": 1.0, "MeV": 1e-3, "keV": 1e-6, "eV": 1e-9}


def read_points(path):
    pts = []
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.split("#")[0].strip()
        if not line:
            continue
        try:
            x, y = [float(v) for v in re.split(r"[\s,]+", line)[:2]]
        except ValueError:
            continue
        pts.append((x, y))
    return pts


def import_all(db, root, add_curve, log=print):
    try:
        commit = subprocess.run(["git", "-C", root, "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    except OSError:
        commit = ""
    added = skipped = 0
    for rel, ch, exp, label, arx, year, unit, kind, shape, extra in T:
        path = os.path.join(root, rel)
        if not os.path.exists(path):
            log("  missing in the compilation: %s" % rel)
            continue
        if db.execute("SELECT 1 FROM curves WHERE source='compilation' AND notes LIKE ? AND channel=?",
                      ("%" + rel + "%", ch)).fetchone():
            skipped += 1
            continue
        if arx and db.execute("SELECT 1 FROM curves WHERE arxiv_id=? AND channel=? AND status='approved' AND kind=?",
                              (arx, ch, kind)).fetchone():
            log("  %s: already has an approved %s curve, skipped" % (label, ch))
            skipped += 1
            continue
        pts = [(x * UNIT[unit], y) for x, y in read_points(path)]
        if ch in ("dark-photon", "ALP"):
            pts = [p for p in pts if p[1] < 0.5]          # drop the region's closing edge at coupling = 1
        url = "%s/blob/%s/%s" % (REPO, commit or "main", rel)
        note = "From %s (%s, commit %s)%s." % (CREDIT, rel, commit or "?", "; " + extra if extra else "")
        cid = add_curve(db, arx, label, exp, ch, pts, "compilation", "approved", source_url=url, notes=note,
                        year=year or (2000 + int(arx[:2]) if arx else None), kind=kind, shape=shape, own=1)
        if cid:
            added += 1
            log("  + %-40s %-11s %d points" % (label, ch, len(pts)))
    return added, skipped
