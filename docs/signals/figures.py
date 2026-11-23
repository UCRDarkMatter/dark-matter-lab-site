"""Draw the explainers' figures from figdata.json (made by figdata.js with the site's physics engine)."""
import json, os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
D = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "figdata.json"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fig"); os.makedirs(OUT, exist_ok=True)
C = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"]
INK, MUTED = "#0b0b0b", "#52514e"
plt.rcParams.update({"font.family": "serif", "font.size": 9, "axes.edgecolor": MUTED, "xtick.color": MUTED, "ytick.color": MUTED,
                     "axes.grid": True, "grid.color": "#e4e3df", "grid.linewidth": 0.6, "axes.spines.top": False, "axes.spines.right": False,
                     "legend.frameon": False, "lines.linewidth": 1.4, "savefig.bbox": "tight"})
W1, W2 = 3.3, 6.8
def save(f, n): f.savefig(os.path.join(OUT, n + ".pdf")); plt.close(f)
def nz(y, lo=1e-30): y = np.array(y, float); y[y <= lo] = np.nan; return y

# ---- gamma
f, axs = plt.subplots(1, 2, figsize=(W2, 2.6), sharey=True)
for ax, m in zip(axs, ["NaI", "Ge"]):
    x = D["xcom"][m]; E = np.array(x["E"])
    for k, lab, c in [("photo", "photoelectric", C[0]), ("incoh", "Compton (incoherent)", C[1]), ("pair", "pair production", C[2]), ("coh", "coherent", C[6])]:
        ax.loglog(E, nz(x[k]), color=c, label=lab, ls="--" if k == "coh" else "-")
    ax.set_title(m, fontsize=9); ax.set_xlabel("photon energy (keV)"); ax.set_ylim(1e-4, 1e3); ax.set_xlim(30, 20000)
axs[0].set_ylabel("μ/ρ (cm²/g)"); axs[1].legend(fontsize=7, loc="upper right")
save(f, "g_xcom")
f, ax = plt.subplots(figsize=(W1, 2.4))
for i, k in enumerate(D["kn"]):
    ax.plot(np.array(k["T"]) / k["E"], np.array(k["y"]) * k["E"], color=C[i], label="%d keV" % k["E"])
ax.set_xlabel("$T/E_\\gamma$"); ax.set_ylabel("$E_\\gamma\\,\\frac{1}{\\sigma}\\frac{d\\sigma}{dT}$"); ax.legend(fontsize=7)
save(f, "g_kn")
f, ax = plt.subplots(figsize=(W2, 2.5))
for i, s in enumerate(D["cs"]):
    ax.semilogy(s["x"], nz(s["y"], 1e-7), color=C[i], label="secondary escape %d%%" % round(100 * s["pesc"]))
ax.set_xlim(0, 760); ax.set_ylim(1e-5, 2e-2); ax.set_xlabel("energy deposited (keV)"); ax.set_ylabel("per keV per interaction"); ax.legend(fontsize=7, loc="upper left")
save(f, "g_cs")
f, ax = plt.subplots(figsize=(W1, 2.3))
ax.plot(D["pair"]["x"], np.array(D["pair"]["y"]) / max(D["pair"]["y"]), color=C[6])
ax.set_xlim(0, 1700); ax.set_xlabel("positron kinetic energy (keV)"); ax.set_ylabel("relative probability")
save(f, "g_pair")

# ---- alpha
f, ax = plt.subplots(figsize=(W1, 2.4))
a = D["akin"]; Q = np.array(a["Q"])
ax.plot(Q, np.array(a["Ta"]) / Q, color=C[0], label="$T_\\alpha/Q$")
ax2 = ax.twinx(); ax2.plot(Q, a["Tr"], color=C[1], label="$T_R$ (keV)"); ax2.spines["right"].set_visible(True); ax2.grid(False)
ax.ticklabel_format(useOffset=False, axis="y"); ax.set_xlabel("Q (keV), daughter $^{237}$Np"); ax.set_ylabel("$T_\\alpha / Q$", color=C[0]); ax2.set_ylabel("$T_R$ (keV)", color=C[1])
save(f, "a_kin")
f, ax = plt.subplots(figsize=(W1, 2.4))
for i, b in enumerate(D["aband"][1:]):
    lo, hi = b["a"]["lo"], b["a"]["hi"]; ax.plot([lo, lo, hi, hi], [0, 1 / (hi - lo), 1 / (hi - lo), 0], color=C[i], label="$T_p$ = %g keV" % b["Tp"])
ax.set_xlabel("lab alpha energy (keV), $^{210}$Po"); ax.set_ylabel("per keV"); ax.set_yscale("log"); ax.legend(fontsize=7)
save(f, "a_band")

# ---- (alpha,n)
f, ax = plt.subplots(figsize=(W1, 2.5))
x = D["anxs"]; ax.plot(x["E"], x["total"], color=INK, label="total")
for i, L in enumerate(x["levels"][:4]):
    ax.plot(x["E"], L["xs"], color=C[i], label=("g.s." if L["Ex"] == 0 else "%.2f MeV" % (L["Ex"] / 1000)) + " " + L["jp"].replace(".0", "").replace("0.5", "1/2"))
ax.set_xlabel("$E_\\alpha$ (MeV)"); ax.set_ylabel("σ (mb), $^{13}$C(α,n)$^{16}$O"); ax.set_xlim(0, 10); ax.legend(fontsize=6.5)
save(f, "n_xs")
f, ax = plt.subplots(figsize=(W1, 2.5))
for i, k in enumerate(D["ankin"]):
    ax.plot(k["th"], k["En"], color=C[i], label="g.s." if k["Ex"] == 0 else "%.3f MeV" % (k["Ex"] / 1000))
ax.set_xlabel("lab angle θ (deg)"); ax.set_ylabel("$E_n$ (MeV)"); ax.set_xlim(0, 180); ax.legend(fontsize=7)
save(f, "n_kin")
f, ax = plt.subplots(figsize=(W2, 2.7))
s = D["anspec"]; E = s["E"]
ax.plot(E, s["sum"], color=INK, lw=1.8, label="sum of final states (lab kinematics)")
ax.plot(E, s["talys"], color=MUTED, ls="--", label="TALYS spectra as integrated by NeuCBOT")
for i, p in enumerate(s["parts"][:4]):
    ax.plot(E, p["y"], color=C[i], lw=1.1, label=p["label"].replace("(a,n)", "(α,n)") + " (%.1f%%)" % (100 * p["share"]))
ax.set_xlim(0, 8); ax.set_xlabel("neutron energy (MeV)"); ax.set_ylabel("neutrons per MeV per α"); ax.legend(fontsize=6.5)
save(f, "n_spec")

# ---- beta
f, ax = plt.subplots(figsize=(W1, 2.5))
for i, fr in enumerate(D["fermi"]):
    ax.semilogy(fr["T"], fr["F"], color=C[i], label="Z = %d, %s" % (fr["Z"], "β⁻" if fr["b"] < 0 else "β⁺"), ls="-" if fr["b"] < 0 else "--")
ax.set_xlabel("kinetic energy (keV)"); ax.set_ylabel("$F_0(Z,W)$"); ax.legend(fontsize=6.5); ax.set_xlim(0, 3000); ax.set_ylim(1e-3, 50)
save(f, "b_fermi")
def facs(key, name, xmax=None):
    f, ax = plt.subplots(figsize=(W1, 2.5)); d = D[key]; T = d["T"]
    lab = {"L0": "$L_0$", "U": "$U$", "C": "$C$", "R": "radiative $R$", "S": "screening $S$", "X": "exchange $X$", "r": "mismatch $r$", "RN": "recoil $R_N$", "Q": "$Q$"}
    i = 0
    for k in ["L0", "C", "R", "S", "X", "r", "RN"]:
        y = np.array(d["f"][k])
        if np.max(np.abs(y - 1)) < 1e-5: continue
        ax.plot(T, y, color=C[i % 7], label=lab[k]); i += 1
    ax.set_xlabel("kinetic energy (keV)"); ax.set_ylabel("factor"); ax.legend(fontsize=6.5, ncol=2)
    ax.set_ylim(0.9, 1.12)
    if xmax: ax.set_xlim(0, xmax)
    save(f, name)
facs("factors63", "b_fac63"); facs("factors32", "b_fac32")
f, axs = plt.subplots(1, 2, figsize=(W2, 2.5))
for ax, k, t in [(axs[0], "y90", "$^{90}$Y, 1st unique (2⁻→0⁺)"), (axs[1], "k40", "$^{40}$K, 3rd unique (4⁻→0⁺)")]:
    d = D[k]; ax.plot(d["T"], d["U"], color=C[0], label="unique shape (mean %.0f keV)" % d["mean"][0]); ax.plot(d["T"], d["Aw"], color=MUTED, ls="--", label="allowed shape (mean %.0f keV)" % d["mean"][1])
    ax.set_title(t, fontsize=9); ax.set_xlabel("kinetic energy (keV)"); ax.legend(fontsize=6.5)
axs[0].set_ylabel("per keV")
save(f, "b_unique")
f, ax = plt.subplots(figsize=(W1, 2.5))
d = D["bsm"]; ax.plot(d["T"], d["fierz"], color=C[0], label="$b_F$ = 0.01"); ax.plot(d["T"], d["sterile"], color=C[1], label="$m_4$ = 20 keV, $|U_{e4}|^2$ = 0.01")
ax.axvline(66.94 - 20, color=MUTED, ls=":"); ax.set_xlabel("kinetic energy (keV), $^{63}$Ni"); ax.set_ylabel("ratio to Standard Model"); ax.legend(fontsize=6.5)
save(f, "b_bsm")
f, ax = plt.subplots(figsize=(W1, 2.5))
d = D["tritium"]; T0 = 18.5906; x = (np.array(d["T"]) - T0) * 1000
for i, k in enumerate(["m0", "m1", "m2"]):
    ax.plot(x, d[k], color=C[i], label="$m_\\beta$ = %s eV" % k[1])
ax.set_xlabel("$T - T_0$ (eV), tritium"); ax.set_ylabel("per keV (normalised spectrum)"); ax.legend(fontsize=7)
save(f, "b_tritium")

# ---- Cherenkov
f, ax = plt.subplots(figsize=(W1, 2.4))
n = D["nlam"]
for i, k in enumerate(["water", "pmma", "silica"]):
    ax.plot(n["lam"], n[k], color=C[i], label={"water": "water", "pmma": "PMMA", "silica": "fused silica"}[k])
ax.set_xlabel("wavelength (nm)"); ax.set_ylabel("n(λ)"); ax.legend(fontsize=7)
save(f, "c_n")
f, ax = plt.subplots(figsize=(W1, 2.4))
for i, m in enumerate(D["cher_mono"]):
    ax.plot(n["lam"], m["y"], color=C[i], label="%d keV electron" % m["E"])
ax.plot(n["lam"], D["cher_y90"], color=INK, ls="--", label="$^{90}$Y β spectrum")
ax.set_xlabel("wavelength (nm)"); ax.set_ylabel("photons per nm, water"); ax.legend(fontsize=6.5)
save(f, "c_spec")
f, ax = plt.subplots(figsize=(W1, 2.4))
ax.plot(D["cher_tot"]["T"], D["cher_tot"]["N"], color=C[6]); ax.set_xlabel("electron kinetic energy (keV)"); ax.set_ylabel("photons, 200–800 nm, water")
save(f, "c_tot")
print("figures in", OUT)
