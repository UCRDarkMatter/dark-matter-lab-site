"""Draw the explainer's figures from figdata.json (made by figdata.js with the site's fit engine).
Usage: node figdata.js > figdata.json && python3 figures.py"""
import json, os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

D = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "figdata.json"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fig")
os.makedirs(OUT, exist_ok=True)
C = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"]   # fixed categorical order
INK, MUTED, GRID = "#0b0b0b", "#52514e", "#e4e3df"
plt.rcParams.update({"font.family": "serif", "font.size": 9, "axes.edgecolor": MUTED, "axes.labelcolor": INK,
                     "xtick.color": MUTED, "ytick.color": MUTED, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
                     "axes.spines.top": False, "axes.spines.right": False, "legend.frameon": False, "lines.linewidth": 1.4,
                     "savefig.bbox": "tight", "figure.dpi": 150})
W1, W2 = 3.4, 6.9      # one-column / full width (inches)

def save(fig, name):
    fig.savefig(os.path.join(OUT, name + ".pdf")); plt.close(fig)

def clip(y, lo):
    y = np.asarray(y, float); y = y.copy(); y[y < lo] = np.nan; return y

# 1. anatomy of the response to one line
a = D["anatomy"]; E = np.array(a["E"])
fig, ax = plt.subplots(figsize=(W2, 2.7))
ax.semilogy(E, clip(a["total"], 1e-6), color=INK, lw=1.8, label="total response $R(E\\,|\\,1461\\,\\mathrm{keV})$")
for k, lab, c in [("peak", "photopeak (P/T = 0.3)", C[0]), ("kn", "single Compton scatter (Klein–Nishina)", C[1]),
                  ("shelf", "multiple-scatter shelf", C[2]), ("bs", "backscatter peak", C[3])]:
    ax.semilogy(E, clip(a[k], 1e-6), color=c, lw=1.2, ls="--" if k != "peak" else "-", label=lab)
for x, t in [(a["edge"], "Compton edge"), (a["Ebs"], "backscatter")]:
    ax.axvline(x, color=MUTED, lw=0.6, ls=":"); ax.text(x + 8, 2e-3 if t[0] == "C" else 2e-2, t, color=MUTED, fontsize=8)
ax.set_xlim(0, 1700); ax.set_ylim(1e-6, 0.1); ax.set_xlabel("deposited energy (keV)"); ax.set_ylabel("probability per keV per gamma")
ax.legend(loc="lower center", fontsize=8, ncol=2, bbox_to_anchor=(0.45, 0.0))
save(fig, "anatomy")

# 2. HPGe response
h = D["hpge"]; E = np.array(h["E"])
fig, ax = plt.subplots(figsize=(W2, 2.3))
ax.semilogy(E, clip(h["y"], 1e-7), color=C[0])
for x, t in [(2614.51, "photopeak"), (2614.51 - 511, "single escape"), (2614.51 - 1022, "double escape")]:
    ax.annotate(t, (x, 0.3 if t == "photopeak" else 0.02), xytext=(x - 330, 0.3 if t == "photopeak" else 0.06), fontsize=8, color=MUTED, arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.6))
ax.text(1900, 2.5e-5, "step: incomplete charge collection\nand small-angle scatter", fontsize=8, color=MUTED)
ax.set_xlim(1400, 2700); ax.set_ylim(1e-6, 2); ax.set_xlabel("energy (keV)"); ax.set_ylabel("per keV per gamma")
save(fig, "hpge")

# 3. Klein–Nishina
fig, ax = plt.subplots(figsize=(W1, 2.4))
for i, k in enumerate(D["kn"]):
    ax.plot(k["T"], np.array(k["y"]) * 1000, color=C[i], label="$E_\\gamma$ = %d keV" % k["E"])
ax.set_xlabel("electron recoil energy $T$ (keV)"); ax.set_ylabel("$\\frac{1}{\\sigma}\\frac{d\\sigma}{dT}$ (per MeV)"); ax.legend(fontsize=8)
save(fig, "kn")

# 4. response matrix and interpolation
m = D["matrix"]; img = np.array(m["img"]); Et = np.array(m["Etrue"])
fig, axs = plt.subplots(1, 2, figsize=(W2, 2.9), gridspec_kw={"width_ratios": [1, 1.25], "wspace": 0.55})
ax = axs[0]
ext = [0, img.shape[1] * m["dstep"], Et[0], Et[-1]]
im = ax.imshow(np.log10(np.maximum(img, 1e-7)), origin="lower", aspect="auto", extent=ext, cmap="Blues", vmin=-6.5, vmax=-1.5)
ax.plot([0, 3000], [0, 3000], color=C[1], lw=0.8, ls="--"); ax.text(1700, 1250, "$E_{dep}=E_\\gamma$", color=C[1], fontsize=8, rotation=38)
ax.set_xlim(0, 3000); ax.set_ylim(50, 2990); ax.grid(False)
ax.set_xlabel("deposited energy (keV)"); ax.set_ylabel("gamma energy (keV)")
cb = fig.colorbar(im, ax=ax, pad=0.02); cb.set_label("log$_{10}$ per keV per gamma", fontsize=8); cb.ax.tick_params(labelsize=7)
ax = axs[1]; q = D["interp"]; x = np.array(q["x"])
ax.plot(x, np.array(q["truth"]) * 1e3, color=INK, lw=2.2, label="true response at %.0f keV" % q["E"])
ax.plot(x, np.array(q["stretch"]) * 1e3, color=C[0], lw=1.2, label="interpolated, stretched by $E/E_j$")
ax.plot(x, np.array(q["naive"]) * 1e3, color=C[1], lw=1.0, ls="--", label="naive average of %d and %d keV" % (q["Ea"], q["Eb"]))
ax.set_xlim(0, 1760); ax.set_xlabel("deposited energy (keV)"); ax.set_ylabel("per MeV per gamma (continuum)"); ax.legend(fontsize=7.5, loc="upper left")
ax.set_ylim(0, max(q["truth"]) * 1e3 * 1.45)
save(fig, "matrix")

# 5. MLEM convergence
fig, ax = plt.subplots(figsize=(W1, 2.4))
best = min(min(v) for k, v in D["mlem"].items() if float(k) < 2)
nz = lambda v: np.array([np.nan if x is None else x for x in v], float)
for i, (k, lab) in enumerate([("1", "plain EM ($\\omega=1$)"), ("1.6", "over-relaxed ($\\omega=1.6$)"), ("2.2", "too aggressive ($\\omega=2.2$)")]):
    v = nz(D["mlem"][k]) - best + 1
    ax.loglog(np.arange(1, len(v) + 1), v, color=C[i], label=lab)
ax.set_ylim(0.5, 1e7); ax.set_xlabel("iteration"); ax.set_ylabel("$D - D_{min} + 1$"); ax.legend(fontsize=8)
save(fig, "mlem")

# 6. profile deviance
p = D["profile"]; s = np.array(p["scan"])
fig, ax = plt.subplots(figsize=(W1, 2.4))
A = np.linspace(s[0, 0], s[-1, 0], 200)
ax.plot(A, ((A - p["best"]) / p["sigmaFisher"]) ** 2, color=C[1], ls="--", label="Fisher (parabola)")
ax.plot(s[:, 0], s[:, 1], "o", ms=3.5, color=C[0], label="profile deviance")
ax.axhline(1, color=MUTED, lw=0.6, ls=":"); ax.text(s[0, 0], 1.6, "$\\Delta D = 1$", color=MUTED, fontsize=8)
ax.set_xlabel("$^{40}$K counts (fixed)"); ax.set_ylabel("$\\Delta D$"); ax.legend(fontsize=8, loc="upper center")
save(fig, "profile")

# 7. full fits
def fitplot(r, names, fname, ylog_min, xlim=None, comps=True):
    E = np.array(r["E"]); d = np.array(r["data"], float); mu = np.array(r["model"])
    fig, (ax, axr) = plt.subplots(2, 1, figsize=(W2, 3.6), sharex=True, gridspec_kw={"height_ratios": [3.2, 1], "hspace": 0.06})
    ax.semilogy(E, clip(d, 0.5), ".", ms=1.4, color="#9a9890", label="data")
    ax.semilogy(E, clip(mu, ylog_min), color=INK, lw=1.0, label="model")
    ax.semilogy(E, clip(r["background"], ylog_min), color=MUTED, lw=0.9, ls="--", label="smooth background")
    for i, (k, v) in enumerate(r["components"].items() if comps else []):
        ax.semilogy(E, clip(v, ylog_min), color=C[i % 7], lw=0.9, label=names.get(k, k))
    ax.set_ylim(ylog_min, d.max() * 2.5); ax.set_ylabel("counts / channel"); ax.legend(fontsize=7, ncol=3, loc="upper right")
    m = np.maximum(mu, 1e-12); dev = 2 * (m - d + np.where(d > 0, d * np.log(np.maximum(d, 1e-300) / m), 0))
    res = np.sign(d - m) * np.sqrt(np.maximum(dev, 0))
    axr.plot(E, res, ".", ms=1.2, color=C[0]); axr.axhline(0, color=MUTED, lw=0.6)
    if xlim:
        ax.set_xlim(*xlim); sel = (E > xlim[0]) & (E < xlim[1]); ax.set_ylim(ylog_min, d[sel].max() * 3)
    axr.set_ylim(-4.5, 4.5); axr.set_ylabel("dev. resid."); axr.set_xlabel("energy (keV)")
    save(fig, fname)
fitplot(D["fitH"], D["fitH"]["names"], "fit_hpge_full", 0.5, comps=False)
fitplot(D["fitH"], D["fitH"]["names"], "fit_hpge", 1, xlim=(560, 1000))
fitplot(D["fitN"]["matrix"], D["fitN"]["names"], "fit_matrix", 5)
fitplot(D["fitN"]["compton"], D["fitN"]["names"], "fit_compton", 5)

# numbers quoted in the text
num = {"hpge": [(x["name"], x["counts"], x["sigma"], x["dchi2"]) for x in D["fitH"]["sources"]], "hpge_dev": (D["fitH"]["deviance"], D["fitH"]["ndf"], D["fitH"]["ms"]),
       "theta_hpge": {k: (v["value"], v["sigma"]) for k, v in D["fitH"]["theta"].items()},
       "matrix": [(x["name"], x["decays"], x["decaysSigma"], x["counts"]) for x in D["fitN"]["matrix"]["sources"]],
       "compton": [(x["name"], x["counts"], x["sigma"]) for x in D["fitN"]["compton"]["sources"]],
       "dev_mc": [(D["fitN"][k]["deviance"], D["fitN"][k]["ndf"], D["fitN"][k]["ms"]) for k in ("matrix", "compton")],
       "truthN": D["fitN"]["truth"], "profile": (p["best"], p["sigmaFisher"])}
json.dump(num, open(os.path.join(OUT, "numbers.json"), "w"), indent=1)
print("figures written to", OUT)
