"""minifit.py: a minimal forward-folding spectrum fitter, for teaching.

The same ideas as the Gamma Line Explorer fitter (assets/gammafit-core.js), in about 120 lines of numpy:
  * a response function (Gaussian photopeak with energy-dependent resolution, integrated over each bin),
  * a model linear in non-negative amplitudes (two lines + a smooth background), solved by Poisson MLEM,
  * nonlinear response parameters (calibration, resolution) fitted by Levenberg-Marquardt with Gaussian priors,
    re-solving the amplitudes at every step (variable projection),
  * uncertainties from the Fisher information, checked by a toy Monte Carlo.
Run:  python3 minifit.py
"""
import numpy as np
from math import erf, sqrt

rng = np.random.default_rng(2)
NTOY = 200
NCH = 1024
LINES = {"Cs137": [(661.66, 0.851)], "Co60": [(1173.23, 0.9985), (1332.49, 0.9998)]}
THETA_NAMES = ["c0", "c1", "a", "b"]                  # E = c0 + c1*ch ; FWHM^2 = a^2 + b*E
PRIOR = {"c0": (2.0, 2.0), "c1": (1.50, 0.01), "a": (1.0, 1.0), "b": (2.0e-3, 1.0e-3)}   # (value, sigma)
TRUTH_THETA = {"c0": 1.2, "c1": 1.503, "a": 1.2, "b": 1.8e-3}
TRUTH_AMP = {"Cs137": 4e4, "Co60": 2.5e4}
verf = np.vectorize(erf)


def edges(th):                                        # bin edges in energy
    ch = np.arange(NCH + 1) - 0.5
    return th["c0"] + th["c1"] * ch


def template(lines, th):
    """Expected counts per bin per decay: sum over lines of I * (Gaussian integrated over the bin)."""
    e = edges(th)
    col = np.zeros(NCH)
    for E, I in lines:
        sig = sqrt(th["a"] ** 2 + th["b"] * E) / 2.3548
        col += I * 0.5 * np.diff(verf((e - E) / (sqrt(2) * sig)))
    return col


def background_basis(th):
    """Two non-negative linear 'hat' functions in energy: together they make any positive straight line."""
    e = edges(th); E = 0.5 * (e[1:] + e[:-1]); w = np.diff(e)
    t = (E - E[0]) / (E[-1] - E[0])
    return [(1 - t) * w, t * w]


def design(th):
    return np.array(background_basis(th) + [template(LINES[k], th) for k in LINES]).T   # NCH x K


def mlem(T, n, x, iters=300):
    """Poisson EM for mu = T @ x, x >= 0. Each step multiplies x_k by (sum_i T_ik n_i/mu_i) / (sum_i T_ik)."""
    s = T.sum(axis=0)
    for _ in range(iters):
        mu = T @ x
        x = x * (T.T @ (n / np.maximum(mu, 1e-300))) / np.maximum(s, 1e-300)
    return x, T @ x


def deviance(n, mu):
    mu = np.maximum(mu, 1e-300)
    return 2 * np.sum(mu - n + np.where(n > 0, n * np.log(np.maximum(n, 1) / mu), 0))


def residuals(n, mu, th):
    """Signed deviance residuals plus prior pulls: their sum of squares is the objective."""
    mu = np.maximum(mu, 1e-300)
    d = 2 * (mu - n + np.where(n > 0, n * np.log(np.maximum(n, 1) / mu), 0))
    r = np.sign(n - mu) * np.sqrt(np.maximum(d, 0))
    pulls = [(th[k] - PRIOR[k][0]) / PRIOR[k][1] for k in THETA_NAMES]
    return np.concatenate([r, pulls])


def fit(n):
    th = {k: PRIOR[k][0] for k in THETA_NAMES}
    x = np.full(design(th).shape[1], n.sum() / 4.0) / 1.0
    x, mu = mlem(design(th), n, x)
    r = residuals(n, mu, th); obj = r @ r; lam = 1e-2
    for it in range(30):
        # Jacobian of the residuals with the amplitudes held fixed (Kaufman's variable-projection approximation)
        J = np.empty((len(r), len(THETA_NAMES)))
        for j, k in enumerate(THETA_NAMES):
            q = dict(th); h = 0.05 * PRIOR[k][1]; q[k] += h
            J[:, j] = (residuals(n, design(q) @ x, q) - r) / h
        A, g = J.T @ J, J.T @ r
        for _ in range(8):                             # Levenberg-Marquardt: damp until the objective decreases
            step = np.linalg.solve(A + lam * np.diag(np.diag(A)), -g)
            q = {k: th[k] + step[j] for j, k in enumerate(THETA_NAMES)}
            xq, muq = mlem(design(q), n, x.copy(), 100)
            rq = residuals(n, muq, q)
            if rq @ rq < obj - 1e-6:
                th, x, r, done = q, xq, rq, obj - rq @ rq < 0.01
                obj = r @ r; lam = max(lam / 5, 1e-7); break
            lam *= 8
        else:
            break
        if done:
            break
    th["a"] = abs(th["a"])     # only a^2 enters: -a fits equally well, and |a| is closer to the (positive) prior
    x, mu = mlem(design(th), n, x, 1000)
    return th, x, mu


def fisher_errors(th, x, mu):
    """Covariance of (amplitudes, theta) from F_ab = sum_i dmu_i/dq_a dmu_i/dq_b / mu_i, plus the priors."""
    T = design(th); D = [T[:, k] for k in range(T.shape[1])]
    for k in THETA_NAMES:
        q = dict(th); h = 0.01 * PRIOR[k][1]; q[k] += h
        D.append((design(q) @ x - mu) / h)
    D = np.array(D); F = (D / np.maximum(mu, 1)) @ D.T
    for j, k in enumerate(THETA_NAMES):
        F[T.shape[1] + j, T.shape[1] + j] += 1 / PRIOR[k][1] ** 2
    C = np.linalg.inv(F)
    return np.sqrt(np.diag(C))


def simulate():
    mu = design(TRUTH_THETA) @ np.array([3e3, 1e3] + [TRUTH_AMP[k] for k in LINES])
    return rng.poisson(mu).astype(float)


if __name__ == "__main__":
    n = simulate()
    th, x, mu = fit(n)
    err = fisher_errors(th, x, mu)
    nb = 2
    print("deviance %.1f for %d degrees of freedom" % (deviance(n, mu), NCH - len(x) - len(th)))
    for j, k in enumerate(LINES):
        print("%-6s decays %8.0f +- %5.0f   (truth %6.0f)" % (k, x[nb + j], err[nb + j], TRUTH_AMP[k]))
    for j, k in enumerate(THETA_NAMES):
        print("%-3s %10.5g +- %.2g   (truth %.5g, prior %.3g +- %.2g)" % (k, th[k], err[len(x) + j], TRUTH_THETA[k], *PRIOR[k]))
    # toy Monte Carlo: is the quoted uncertainty right? (pulls should have mean 0 and width 1)
    pulls = []
    for t in range(NTOY):
        n = simulate(); th, x, mu = fit(n); err = fisher_errors(th, x, mu)
        pulls.append((x[nb] - TRUTH_AMP["Cs137"]) / err[nb])
    pulls = np.array(pulls)
    print("Cs137 pulls over %d toys: mean %.2f, standard deviation %.2f" % (NTOY, pulls.mean(), pulls.std()))
