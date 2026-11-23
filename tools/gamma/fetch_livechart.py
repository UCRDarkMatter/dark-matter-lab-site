#!/usr/bin/env python3
"""Download the ENSDF-based nuclear data the Gamma Line Explorer needs from the IAEA LiveChart API.

    python3 tools/gamma/fetch_livechart.py OUTDIR

Run by .github/workflows/gamma-data.yml (the IAEA site is not reachable from every machine). Writes the
API's CSV files unchanged into OUTDIR:
  ground_states.csv           half-lives, decay modes and abundances of every ground state
  decay/<nuclide>.csv         gamma lines emitted in the decay of <nuclide> (all its decaying states)
  decay_a|bm|bp/<nuclide>.csv alpha, beta- and beta+ spectra for the decay-chain members (CHAIN_NUCLIDES)
  xray/<nuclide>.csv          X-rays emitted in the decay of <nuclide>
  gammas/<nuclide>.csv        gammas between excited levels of stable <nuclide>, for (n,n'γ) lines
Only standard-library Python is used.
"""
import csv
import io
import os
import sys
import time
import urllib.request

API = "https://nds.iaea.org/relnsd/v1/data?"
UA = "Mozilla/5.0 (UCR Dark Matter Lab gamma-line explorer; https://github.com/UCRDarkMatter/dark-matter-lab-site)"
MIN_HALF_LIFE_S = 1.0          # decays of anything living at least this long are fetched
# stable isotopes of materials common in and around detectors: their excited levels give (n,n'γ) lines
# Members of the decay chains shown in the explorer's "Decay chains" tab: their alpha and beta spectra are
# fetched too (decay_a/, decay_bm/, decay_bp/), for the per-decay details.
CHAIN_NUCLIDES = """238u 234th 234pa 234u 230th 226ra 222rn 218po 218at 218rn 214pb 214bi 214po 210tl 210pb 210bi 210po 206hg 206tl
232th 228ra 228ac 228th 224ra 220rn 216po 212pb 212bi 212po 208tl
235u 231th 231pa 227ac 227th 223fr 223ra 219at 219rn 215po 215at 211pb 211bi 211po 207tl
40k 39ar 42ar 42k 85kr 60co 137cs 68ge 68ga 44ti 44sc 90sr 90y 106ru 106rh 144ce 144pr 22na 26al 32si 32p 3h 14c 7be
54mn 56co 57co 58co 65zn 46sc 48v 51cr 59fe 124sb 125sb 110ag 133ba 152eu 154eu 241am""".split()

INELASTIC = """1h 2h 6li 7li 9be 10b 11b 12c 13c 14n 15n 16o 17o 18o 19f 23na 24mg 25mg 26mg 27al 28si 29si 30si 31p 32s 34s
35cl 37cl 36ar 38ar 40ar 39k 41k 40ca 42ca 44ca 46ti 47ti 48ti 49ti 50ti 50cr 52cr 53cr 54cr 55mn 54fe 56fe 57fe 58fe 59co
58ni 60ni 61ni 62ni 64ni 63cu 65cu 64zn 66zn 67zn 68zn 70zn 69ga 71ga 70ge 72ge 73ge 74ge 76ge 75as 79br 81br 93nb 92mo 94mo
95mo 96mo 97mo 98mo 100mo 107ag 109ag 112sn 114sn 115sn 116sn 117sn 118sn 119sn 120sn 122sn 124sn 121sb 123sb 127i
124xe 126xe 128xe 129xe 130xe 131xe 132xe 134xe 136xe 133cs 155gd 156gd 157gd 158gd 160gd 180hf 181ta 182w 183w 184w
186w 197au 204pb 206pb 207pb 208pb 209bi""".split()


def get(params, tries=5):
    url = API + params
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:                           # network hiccup or rate limit: back off and retry
            print("  retry", k + 1, url, e, file=sys.stderr)
            time.sleep(3 * (k + 1))
    raise RuntimeError("failed: " + url)


def main(out):
    os.makedirs(os.path.join(out, "decay"), exist_ok=True)
    os.makedirs(os.path.join(out, "xray"), exist_ok=True)
    os.makedirs(os.path.join(out, "gammas"), exist_ok=True)
    gs = get("fields=ground_states&nuclides=all")
    open(os.path.join(out, "ground_states.csv"), "w").write(gs)
    rows = list(csv.DictReader(io.StringIO(gs)))
    print(len(rows), "ground states")
    names = []
    for r in rows:
        try:
            hl = float(r.get("half_life_sec") or "nan")
        except ValueError:
            hl = float("nan")
        stable = (r.get("half_life") or "").strip().upper() == "STABLE"
        if not stable and hl == hl and hl >= MIN_HALF_LIFE_S:
            a = int(r["z"]) + int(r["n"])
            names.append("%d%s" % (a, r["symbol"].lower()))
    print(len(names), "radionuclides with T1/2 >= %g s" % MIN_HALF_LIFE_S)
    for i, nm in enumerate(names):
        for rt, sub in (("g", "decay"), ("x", "xray")):        # the API takes one radiation type per request
            p = os.path.join(out, sub, nm + ".csv")
            if not os.path.exists(p):
                txt = get("fields=decay_rads&nuclides=%s&rad_types=%s" % (nm, rt))
                if len(txt.strip()) > 5:                        # a bare number is an API error code (e.g. no data)
                    open(p, "w").write(txt)
                time.sleep(0.12)
        if i % 200 == 0:
            print(" decay", i, nm, flush=True)
    for nm in CHAIN_NUCLIDES:
        for rt in ("a", "bm", "bp"):
            d = os.path.join(out, "decay_" + rt)
            os.makedirs(d, exist_ok=True)
            p = os.path.join(d, nm + ".csv")
            if not os.path.exists(p):
                txt = get("fields=decay_rads&nuclides=%s&rad_types=%s" % (nm, rt))
                if len(txt.strip()) > 5:
                    open(p, "w").write(txt)
                time.sleep(0.12)
    print("chain alpha/beta spectra done", flush=True)
    for nm in INELASTIC:
        p = os.path.join(out, "gammas", nm + ".csv")
        if not os.path.exists(p):
            open(p, "w").write(get("fields=gammas&nuclides=%s" % nm))
            time.sleep(0.15)
    print("done")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "livechart")
