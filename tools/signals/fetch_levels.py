"""Download ENSDF level schemes (energies, J^pi) of the daughters of every beta emitter (T1/2 >= 1 s), so the
signal explorer can work out the selection rules of each beta branch. Runs in .github/workflows/signals-data.yml.
Output: <out>/levels/<nuclide>.csv from the IAEA LiveChart API (fields=levels)."""
import csv, io, os, re, sys, time, urllib.request

API = "https://nds.iaea.org/relnsd/v1/data?"
UA = "UCR Dark Matter group site data build (github.com/UCRDarkMatter/dark-matter-lab-site)"
SYM = None


def get(q, tries=5):
    for k in range(tries):
        try:
            req = urllib.request.Request(API + q, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            print("retry", q, e, file=sys.stderr); time.sleep(3 * (k + 1))
    raise RuntimeError(q)


def main(out):
    d = os.path.join(out, "levels"); os.makedirs(d, exist_ok=True)
    rows = list(csv.DictReader(io.StringIO(get("fields=ground_states&nuclides=all"))))
    sym = {int(r["z"]): r["symbol"] for r in rows}
    want = set()
    for r in rows:
        try:
            hl = float(r.get("half_life_sec") or "nan")
        except ValueError:
            continue
        if not (hl == hl and hl >= 1.0):
            continue
        z, a = int(r["z"]), int(r["z"]) + int(r["n"])
        modes = " ".join((r.get("decay_%d" % k) or "") for k in (1, 2, 3))
        if "B-" in modes and z + 1 in sym:
            want.add("%d%s" % (a, sym[z + 1].lower()))
        if re.search(r"EC|B\+", modes) and z - 1 in sym:
            want.add("%d%s" % (a, sym[z - 1].lower()))
    print(len(want), "daughters", flush=True)
    for i, nm in enumerate(sorted(want)):
        p = os.path.join(d, nm + ".csv")
        if not os.path.exists(p):
            txt = get("fields=levels&nuclides=" + nm)
            if len(txt.strip()) > 5:
                open(p, "w").write(txt)
            time.sleep(0.12)
        if i % 200 == 0:
            print(i, nm, flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "signals")
