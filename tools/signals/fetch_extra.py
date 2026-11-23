"""Decay data for short-lived emitters (T1/2 < 1 s) that the main IAEA download skips but that matter for beta-spectrum
work (6He, 8Li, 8B, 9Li, 12B, 12N, 13B, 13O, 9C), plus the level schemes of their daughters.
Runs in .github/workflows/signals-data.yml. Output: <out>/extra/decay_{a,bm,bp}/<nuc>.csv, <out>/extra/decay/<nuc>.csv,
<out>/levels/<daughter>.csv"""
import os, sys, time, urllib.request

API = "https://nds.iaea.org/relnsd/v1/data?"
UA = "UCR Dark Matter group site data build (github.com/UCRDarkMatter/dark-matter-lab-site)"
EXTRA = ["6he", "8li", "8b", "9li", "12b", "12n", "13b", "13o", "9c"]
DAUGHTERS = ["6li", "8be", "9be", "12c", "13c", "13n", "9b"]


def get(q, tries=5):
    for k in range(tries):
        try:
            req = urllib.request.Request(API + q, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            print("retry", q, e, file=sys.stderr); time.sleep(3 * (k + 1))
    raise RuntimeError(q)


def save(path, txt):
    if len(txt.strip()) > 5:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w").write(txt)


def main(out):
    for nm in EXTRA:
        for rt, sub in (("a", "decay_a"), ("bm", "decay_bm"), ("bp", "decay_bp"), ("g", "decay")):
            save(os.path.join(out, "extra", sub, nm + ".csv"), get("fields=decay_rads&nuclides=%s&rad_types=%s" % (nm, rt)))
            time.sleep(0.12)
    for nm in DAUGHTERS:
        save(os.path.join(out, "levels", nm + ".csv"), get("fields=levels&nuclides=" + nm))
        time.sleep(0.12)
    print("extra done")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "signals")
