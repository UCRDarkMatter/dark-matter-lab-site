"""Download NIST XCOM photon cross sections (cm^2/g) for elements Z = 1..100 on XCOM's standard energy grid.

Runs in GitHub Actions (.github/workflows/signals-data.yml); the result goes to the "signals-data" branch.
XCOM: M.J. Berger et al., NIST Standard Reference Database 8, doi:10.18434/T48G6X. The query parameters follow
becquerel's tools/xcom.py (LBL, BSD licence).
Output: <out>/<Z>.html (raw response) and <out>/xcom.json
  {Z: {"E": [keV], "coh": [...], "incoh": [...], "photo": [...], "pair_n": [...], "pair_e": [...]}}
"""
import json, os, re, sys, time, urllib.parse, urllib.request

URL = "https://physics.nist.gov/cgi-bin/Xcom/xcom3_1"
UA = "UCR Dark Matter group site data build (github.com/UCRDarkMatter/dark-matter-lab-site)"
EXTRA_MEV = [0.01 * k for k in range(1, 10)] + [0.1 * k for k in range(1, 30)] + [3 + 0.5 * k for k in range(15)]


def query(z):
    data = {"ZNum": str(z), "NumAdd": "1", "Energies": ";".join("%.4f" % e for e in EXTRA_MEV),
            "WindowXmin": "0.001", "WindowXmax": "20", "OutOpt": "PIC", "ResizeFlag": "on", "Output": "on"}
    body = urllib.parse.urlencode(data).encode()
    for k in range(5):
        try:
            req = urllib.request.Request(URL, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            print("retry", z, e, file=sys.stderr); time.sleep(5 * (k + 1))
    raise RuntimeError("XCOM failed for Z=%d" % z)


def parse(html):
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        cells = [re.sub(r"<[^>]+>|&nbsp;", " ", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
        nums = []
        for c in cells:
            try:
                nums.append(float(c))
            except ValueError:
                nums.append(None)
        vals = [v for v in nums if v is not None]
        if len(vals) >= 8:                     # (edge label) energy coh incoh photo pair_n pair_e tot tot
            rows.append(vals[-8:])
    rows.sort(key=lambda r: r[0])
    out = {"E": [], "coh": [], "incoh": [], "photo": [], "pair_n": [], "pair_e": []}
    for r in rows:
        if out["E"] and abs(r[0] * 1000 - out["E"][-1]) < 1e-9:   # absorption edge: keep both sides, nudge
            r = [r[0] * (1 + 1e-6)] + r[1:]
        out["E"].append(r[0] * 1000)
        for k, v in zip(("coh", "incoh", "photo", "pair_n", "pair_e"), r[1:6]):
            out[k].append(float("%.4g" % v))
    return out


def main(dest):
    os.makedirs(dest, exist_ok=True)
    allz = {}
    for z in range(1, 101):
        html = query(z)
        open(os.path.join(dest, "%d.html" % z), "w").write(html)
        t = parse(html)
        print(z, len(t["E"]), "energies", flush=True)
        if t["E"]:
            allz[z] = t
        time.sleep(1.0)
    json.dump({"source": "NIST XCOM (SRD 8), cm^2/g; energies in keV", "elements": allz}, open(os.path.join(dest, "xcom.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "xcom")
