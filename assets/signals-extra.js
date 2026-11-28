/* Radioactive Signal Explorer: additional physics (detector-response and secondary processes).
   Cherenkov: delta-ray light, multiple-scattering angular spread, detection (QE, transmission, wavelength shifter).
   Alpha: depth-degraded spectra, Birks and Lindhard quenching. (alpha,n): spontaneous fission neutrons, layered
   targets. Gamma: internal pair creation, gamma-gamma angular correlations, Doppler-broadened in-flight lines,
   a small photon-transport Monte Carlo and cascade coincidence summing.
   Depends on SignalPhysics (signals-physics.js). Units: keV, cm, g/cm2 unless stated. */
(function (root) {
  'use strict';
  var P = typeof module !== 'undefined' && module.exports ? require('./signals-physics.js') : root.SignalPhysics;
  var ME = 510.99895, RE = 2.8179403262e-13, NA = 6.02214076e23, ALPHA = 1 / 137.035999;

  /* ---------------------------------------------------------------- shared helpers */
  // parse "x y" pairs from pasted text or a CSV/TSV file; skips header and comment lines; returns sorted arrays
  function parseXY(text) {
    var x = [], y = [];
    String(text).split(/\r?\n/).forEach(function (line) {
      if (/^\s*[#%;]/.test(line)) return;
      var m = line.trim().split(/[\s,;]+/).map(Number);
      if (m.length >= 2 && isFinite(m[0]) && isFinite(m[1])) { x.push(m[0]); y.push(m[1]); }
    });
    var idx = x.map(function (_, i) { return i; }).sort(function (a, b) { return x[a] - x[b]; });
    return { x: idx.map(function (i) { return x[i]; }), y: idx.map(function (i) { return y[i]; }) };
  }
  function lin(xs, ys, v, outside) {           // linear interpolation, value 'outside' (default 0) beyond the range
    var n = xs.length; if (!n) return outside || 0;
    if (v < xs[0] || v > xs[n - 1]) return outside == null ? 0 : outside;
    var lo = 0, hi = n - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (xs[m] <= v) lo = m; else hi = m; }
    return hi === lo ? ys[lo] : ys[lo] + (ys[hi] - ys[lo]) * (v - xs[lo]) / (xs[hi] - xs[lo]);
  }
  // seeded generator so plots do not flicker between redraws
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function gauss(r) { var u = r() || 1e-12, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  /* ================================================================ CHERENKOV */
  // Moller cross section per electron, d sigma / d T_delta (cm^2/keV), for a primary of kinetic energy T (keV)
  function moller(T, Td) {
    if (!(Td > 0 && Td <= T / 2)) return 0;
    var tau = T / ME, g = tau + 1, b2 = 1 - 1 / (g * g), e = Td / T;
    var br = 1 / (e * e) + 1 / ((1 - e) * (1 - e)) + Math.pow(tau / g, 2) - (2 * tau + 1) / (g * g) / (e * (1 - e));
    return 2 * Math.PI * RE * RE * ME / (b2 * T) * br / T;
  }
  /* Extra Cherenkov photons per nm from knock-on electrons (delta rays) above threshold, integrated along the
     primary's continuous slowing down. base: P.cherenkovTable(m, lam, Tmax) (photons per nm for an electron of
     energy T, which also gives each delta's own light). Returns a table with the same layout as base. */
  function cherenkovDeltaTable(m, base) {
    var nl = base.nl.length, nT = base.tab.length - 1, dT = base.dT, ne = m.rho * NA * m.ZA, cum = new Float64Array(nl), tab = [Float64Array.from(cum)];
    var thMin = Math.min.apply(null, base.threshold);
    function light(Td) { var x = Td / dT, k = Math.min(nT, Math.floor(x)), f = Math.min(1, x - k), r0 = base.tab[k], r1 = base.tab[Math.min(nT, k + 1)]; return function (j) { return r0[j] + f * (r1[j] - r0[j]); }; }
    for (var i = 0; i < nT; i++) {
      var T = (i + 0.5) * dT, S = P.electronStopping(T, m.ZA, m.I, m.Zeff) * m.rho * 1000, ds = dT / S;   // cm
      if (T / 2 > thMin) {
        var nd = 40, lo = thMin, hi = T / 2, h = (hi - lo) / nd;
        for (var q = 0; q < nd; q++) {
          var Td = lo + (q + 0.5) * h, w = ne * moller(T, Td) * h * ds, L = light(Td);
          for (var j = 0; j < nl; j++) cum[j] += w * L(j);
        }
      }
      tab.push(Float64Array.from(cum));
    }
    return { dT: dT, tab: tab, nl: base.nl, threshold: base.threshold };
  }
  /* Angular distribution of Cherenkov photons relative to the primary electron's initial direction, including the
     electron's multiple scattering (Highland/Rossi: d<theta_plane^2>/ds = (13.6 MeV / beta p c)^2 / X0).
     samples: [{T0, w}] primary energies with weights; m: medium (+ X0 in g/cm2); lamMid (nm) for the cone angle.
     Returns {cos: bin centres, y: photons per unit cos(theta), normalised to 1}. */
  function cherenkovAngles(m, samples, lamMid, opt) {
    opt = opt || {};
    var r = rng(12345), nb = opt.bins || 100, h = new Float64Array(nb), nHist = opt.histories || 300, X0 = m.X0 / m.rho;   // cm
    var n = m.n(lamMid), totW = samples.reduce(function (a, s) { return a + s.w; }, 0);
    if (!(totW > 0)) return { cos: [], y: [] };
    var cdf = [], acc = 0; samples.forEach(function (s) { acc += s.w / totW; cdf.push(acc); });
    for (var hst = 0; hst < nHist; hst++) {
      var u = r(), k = 0; while (k < cdf.length - 1 && cdf[k] < u) k++;
      var T = samples[k].T0, dir = [0, 0, 1];
      var thT = ME * (1 / Math.sqrt(1 - 1 / (n * n)) - 1); if (!(T > thT)) continue;
      var steps = 60, dT = (T - thT) / steps;
      for (var st = 0; st < steps; st++) {
        var Tm = T - (st + 0.5) * dT, g = Tm / ME + 1, b = Math.sqrt(1 - 1 / (g * g)), pc = Math.sqrt(Tm * (Tm + 2 * ME)) / 1000;
        var S = P.electronStopping(Tm, m.ZA, m.I, m.Zeff) * m.rho * 1000, ds = dT / S;
        var cosC = 1 / (b * n);
        if (cosC < 1) {
          var sinC = Math.sqrt(1 - cosC * cosC), wph = (1 - cosC * cosC) * ds;            // Frank-Tamm weight ∝ sin^2 per length
          for (var ph = 0; ph < 4; ph++) {
            var phi = 2 * Math.PI * r(), v = rotate(dir, sinC * Math.cos(phi), sinC * Math.sin(phi), cosC);
            var bi = Math.min(nb - 1, Math.max(0, Math.floor((v[2] + 1) / 2 * nb))); h[bi] += wph / 4;
          }
        }
        var th0 = 13.6 / (b * pc) * Math.sqrt(ds / X0);                                     // plane-projected rms, rad
        dir = rotate(dir, th0 * gauss(r), th0 * gauss(r), null);
      }
    }
    var tot = 0; for (var i = 0; i < nb; i++) tot += h[i];
    var cs = [], y = []; for (i = 0; i < nb; i++) { cs.push(-1 + (i + 0.5) * 2 / nb); y.push(tot > 0 ? h[i] / tot / (2 / nb) : 0); }
    return { cos: cs, y: y, cosC: 1 / n };
  }
  // rotate: given unit vector d, return the vector with components (a, b, c) in d's local frame; if c is null,
  // treat (a, b) as small deflection angles and renormalise
  function rotate(d, a, b, c) {
    var ux = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    var e1 = norm(cross(ux, d)), e2 = cross(d, e1);
    if (c == null) { var s = Math.sqrt(a * a + b * b), ta = s > 0 ? Math.sin(s) / s : 1; c = Math.cos(s); a *= ta; b *= ta; }
    return norm([a * e1[0] + b * e2[0] + c * d[0], a * e1[1] + b * e2[1] + c * d[1], a * e1[2] + b * e2[2] + c * d[2]]);
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(v) { var s = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / s, v[1] / s, v[2] / s]; }
  /* Detected photons: y(lam) photons per nm -> photoelectrons per nm.
     o.qe(lam) (0..1), o.trans(lam) (0..1), o.wls: {cut: absorb below (nm), eff: quantum yield, coll: fraction of
     re-emitted light reaching the sensor, peak, sigma (nm)} */
  function detectLight(lam, y, o) {
    var n = lam.length, direct = new Float64Array(n), reem = new Float64Array(n), absorbed = 0, w = o.wls;
    for (var i = 0; i < n; i++) {
      var t = o.trans ? o.trans(lam[i]) : 1, d = i > 0 ? lam[i] - lam[i - 1] : lam[1] - lam[0];
      if (w && lam[i] < w.cut) absorbed += y[i] * t * d; else direct[i] = y[i] * t * (o.qe ? o.qe(lam[i]) : 1);
    }
    if (w && absorbed > 0) {
      var g = new Float64Array(n), gs = 0;
      for (i = 0; i < n; i++) { g[i] = Math.exp(-0.5 * Math.pow((lam[i] - w.peak) / w.sigma, 2)); gs += g[i] * (i > 0 ? lam[i] - lam[i - 1] : lam[1] - lam[0]); }
      for (i = 0; i < n; i++) reem[i] = gs > 0 ? absorbed * w.eff * w.coll * g[i] / gs * (o.qe ? o.qe(lam[i]) : 1) : 0;
    }
    return { direct: direct, reemitted: reem, absorbed: absorbed };
  }

  /* ================================================================ ALPHA */
  // range-energy relation from the stopping table: stop(E keV) -> keV/(g/cm2)... we work per mass thickness
  function rangeTable(stop, Emax) {
    var n = 800, dE = Emax / n, E = [0], R = [0], acc = 0;
    for (var i = 0; i < n; i++) { var Em = (i + 0.5) * dE; acc += dE / Math.max(stop(Em), 1e-9); E.push((i + 1) * dE); R.push(acc); }
    return { E: E, R: R, range: function (e) { return lin(E, R, e, e > Emax ? acc : 0); }, energy: function (r) { return r <= 0 ? 0 : lin(R, E, r, r > acc ? Emax : 0); } };
  }
  /* Alphas of energy E0 emitted isotropically from depth z (or uniformly in [z0, z1]) below a surface; only those
     heading outwards and reaching the surface escape, with E = E(R(E0) - z / cos theta). Depths in g/cm2 (mass
     thickness). Returns {E: grid, y: escaping alphas per keV per emitted alpha, escaped: fraction}. */
  function depthSpectrum(E0, stop, z0, z1, opt) {
    opt = opt || {};
    var rt = rangeTable(stop, E0 * 1.02), R0 = rt.range(E0), nb = opt.bins || 400, bin = E0 * 1.02 / nb, y = new Float64Array(nb), esc = 0;
    var nz = 120, nc = 400, Zs = z1 > z0 ? nz : 1;
    for (var iz = 0; iz < Zs; iz++) {
      var z = Zs === 1 ? z0 : z0 + (z1 - z0) * (iz + 0.5) / nz;
      for (var ic = 0; ic < nc; ic++) {
        var mu = (ic + 0.5) / nc;                          // cos(theta) towards the surface; half the alphas go inwards
        var path = z / mu, E = path < R0 ? rt.energy(R0 - path) : -1;
        if (E > 0) { var w = 0.5 / nc / Zs; esc += w; y[Math.min(nb - 1, Math.floor(E / bin))] += w / bin; }
      }
    }
    var Eg = []; for (var i = 0; i < nb; i++) Eg.push((i + 0.5) * bin);
    return { E: Eg, y: y, escaped: esc, range: R0 };
  }
  // Birks: visible energy L(E) = ∫ dE / (1 + kB dE/dx), dE/dx in keV/(g/cm2) times rho -> kB in g/(cm2 keV)
  function birksVisible(E0, stop, kB) {
    var n = 400, dE = E0 / n, L = 0;
    for (var i = 0; i < n; i++) { var Em = (i + 0.5) * dE; L += dE / (1 + kB * stop(Em)); }
    return L;
  }
  // Lindhard quenching factor for a nuclear recoil of energy E (keV) in a medium of Z, A (k = 0.133 Z^(2/3) A^(-1/2))
  function lindhard(E, Z, A, k) {
    k = k == null ? 0.133 * Math.pow(Z, 2 / 3) / Math.sqrt(A) : k;
    var eps = 11.5 * E * Math.pow(Z, -7 / 3), g = 3 * Math.pow(eps, 0.15) + 0.7 * Math.pow(eps, 0.6) + eps;
    return k * g / (1 + k * g);
  }

  /* ================================================================ SPONTANEOUS FISSION */
  // Watt spectrum N(E) ∝ exp(-E/a) sinh(sqrt(b E)), E and a in MeV, b in 1/MeV
  function watt(E, a, b) { return E > 0 ? Math.exp(-E / a) * Math.sinh(Math.sqrt(b * E)) : 0; }
  function wattMean(a, b) { return 1.5 * a + a * a * b / 4; }

  /* ================================================================ GAMMA */
  /* Internal pair creation (IPC) for E1 and M1 transitions in the Born approximation (Rose 1949; Goldring's
     form as used by Krasznahorkay et al., NIM A 2004, nucl-ex/0311002):
       dGamma/(dOmega+ dOmega- dE+) = alpha p+ p- / (16 pi^3 k^3) { 4k^2/(k^2-q^2)^2 + 2(p+^2 + p-^2)/(k^2-q^2) ± 1 },
     + for E1, - for M1; k = E+ + E- (units of m_e c^2), q = |p+ + p-|. Integrated over the pair opening angle and
     the positron energy this is the IPC coefficient per gamma. Valid for Z <~ 40 and E >~ 2.5 MeV (Rose); other
     multipoles are not provided. Returns {alpha, T: positron kinetic energies (keV), y: dalpha/dT+ (1/keV),
     ang: opening-angle cosines, ya: dalpha/dcos}. */
  function ipc(Eg, mult) {
    var k = Eg / ME, sign = /^E1/i.test(mult) ? 1 : /^M1/i.test(mult) ? -1 : 0;
    if (!(k > 2) || !sign) return { alpha: 0, T: [], y: [], ang: [], ya: [], supported: !!sign };
    var n = 120, nt = 240, T = [], y = [], ang = [], ya = new Float64Array(nt), tot = 0, dEp = (k - 2) / n;
    for (var j = 0; j < nt; j++) ang.push(-1 + 2 * (j + 0.5) / nt);
    for (var i = 0; i < n; i++) {
      var Ep = 1 + (i + 0.5) * dEp, Em = k - Ep, pp = Math.sqrt(Ep * Ep - 1), pm = Math.sqrt(Em * Em - 1), sE = 0;
      for (j = 0; j < nt; j++) {
        var c = ang[j], q2 = pp * pp + pm * pm + 2 * pp * pm * c, mu2 = k * k - q2;
        var f = ALPHA / (16 * Math.pow(Math.PI, 3) * k * k * k) * pp * pm * (4 * k * k / (mu2 * mu2) + 2 * (pp * pp + pm * pm) / mu2 + sign) * 8 * Math.PI * Math.PI;
        sE += f * 2 / nt; ya[j] += f * dEp;
      }
      T.push((Ep - 1) * ME); y.push(sE / ME); tot += sE * dEp;
    }
    return { alpha: tot, T: T, y: y, ang: ang, ya: Array.from(ya), supported: true };
  }
  // gamma-gamma angular correlation coefficients A2, A4 for a J1 -(L1,d1)-> J -(L2,d2)-> J2 cascade (pure or mixed)
  function wig3j(j1, j2, j3, m1, m2, m3) {
    if (Math.abs(m1 + m2 + m3) > 1e-9) return 0;
    if (j3 < Math.abs(j1 - j2) - 1e-9 || j3 > j1 + j2 + 1e-9) return 0;
    if (Math.abs(m1) > j1 + 1e-9 || Math.abs(m2) > j2 + 1e-9 || Math.abs(m3) > j3 + 1e-9) return 0;
    function f(x) { return fact(Math.round(x)); }
    var t1 = j2 - j3 - m1, t2 = j1 + m2 - j3, t3 = j1 + j2 - j3, t4 = j1 - m1, t5 = j2 + m2;
    var tmin = Math.max(0, t1, t2), tmax = Math.min(t3, t4, t5), s = 0;
    for (var t = tmin; t <= tmax + 1e-9; t++) s += (t % 2 ? -1 : 1) / (f(t) * f(t - t1) * f(t - t2) * f(t3 - t) * f(t4 - t) * f(t5 - t));
    var tri = f(j1 + j2 - j3) * f(j1 - j2 + j3) * f(-j1 + j2 + j3) / f(j1 + j2 + j3 + 1);
    var pre = Math.sqrt(tri * f(j1 + m1) * f(j1 - m1) * f(j2 + m2) * f(j2 - m2) * f(j3 + m3) * f(j3 - m3));
    return (Math.round(j1 - j2 - m3) % 2 ? -1 : 1) * pre * s;
  }
  var FC = [1]; function fact(n) { for (var i = FC.length; i <= n; i++) FC[i] = FC[i - 1] * i; return n < 0 ? NaN : FC[n]; }
  function wig6j(a, b, c, d, e, f_) {
    function tri(x, y, z) { return fact(Math.round(x + y - z)) * fact(Math.round(x - y + z)) * fact(Math.round(-x + y + z)) / fact(Math.round(x + y + z + 1)); }
    function ok(x, y, z) { return z >= Math.abs(x - y) - 1e-9 && z <= x + y + 1e-9 && Math.abs((x + y + z) - Math.round(x + y + z)) < 1e-9; }
    if (!ok(a, b, c) || !ok(a, e, f_) || !ok(d, b, f_) || !ok(d, e, c)) return 0;
    var pre = Math.sqrt(tri(a, b, c) * tri(a, e, f_) * tri(d, b, f_) * tri(d, e, c)), s = 0;
    var tmin = Math.max(a + b + c, a + e + f_, d + b + f_, d + e + c), tmax = Math.min(a + b + d + e, a + c + d + f_, b + c + e + f_);
    for (var t = tmin; t <= tmax + 1e-9; t++) s += (Math.round(t) % 2 ? -1 : 1) * fact(Math.round(t + 1)) /
      (fact(Math.round(t - a - b - c)) * fact(Math.round(t - a - e - f_)) * fact(Math.round(t - d - b - f_)) * fact(Math.round(t - d - e - c)) *
       fact(Math.round(a + b + d + e - t)) * fact(Math.round(a + c + d + f_ - t)) * fact(Math.round(b + c + e + f_ - t)));
    return pre * s;
  }
  // F_k(L, L', Ji, J) coefficients (Frauenfelder & Steffen convention)
  function Fk(k, L, Lp, Ji, J) {
    var v = Math.pow(-1, Math.round(Ji + J - 1)) * Math.sqrt((2 * k + 1) * (2 * L + 1) * (2 * Lp + 1) * (2 * J + 1)) * wig3j(L, Lp, k, 1, -1, 0) * wig6j(L, Lp, k, J, J, Ji);
    return v;
  }
  // A_k for one transition with mixing ratio d between multipoles L and L+1; 'first' selects the B_k (orientation)
  // or A_k (emission) convention: the first gamma's coefficient uses F_k(.., J2_initial, J) as in Krane's tables
  function Ak(k, Ja, Jb, L, d) {
    var d2 = d * d;
    return (Fk(k, L, L, Ja, Jb) + 2 * d * Fk(k, L, L + 1, Ja, Jb) + d2 * Fk(k, L + 1, L + 1, Ja, Jb)) / (1 + d2);
  }
  // W(theta) = 1 + A22 P2 + A44 P4 for the cascade J1 -> J -> J2
  function cascadeCorrelation(J1, J, J2, L1, d1, L2, d2) {
    var A2 = Ak(2, J1, J, L1, d1) * Ak(2, J2, J, L2, d2), A4 = Ak(4, J1, J, L1, d1) * Ak(4, J2, J, L2, d2);
    return { A22: A2, A44: A4 };
  }
  /* Doppler-broadened line from an emitter moving with kinetic energy Tr (keV), mass M (amu), which slows down
     with a mean stopping time tStop (fs) while decaying with mean life tau (fs). The emitter's speed falls
     linearly to zero over tStop (constant deceleration); photons emitted at speed v and isotropic direction give a
     flat box of half-width E beta. Returns {E, y} normalised to 1 and the fraction emitted in flight. */
  function dopplerLine(Eg, Tr, M, tau, tStop, opt) {
    opt = opt || {};
    var b0 = Math.sqrt(2 * Tr / (M * 931494.1)), nb = opt.bins || 400, half = Eg * b0 * 1.05, lo = Eg - half, bin = 2 * half / nb;
    var y = new Float64Array(nb), nt = 200, inflight = 0;
    for (var i = 0; i < nt; i++) {
      var t = (i + 0.5) / nt * tStop, w = Math.exp(-t / tau) / tau * (tStop / nt), b = b0 * (1 - t / tStop);
      inflight += w;
      var hw = Eg * b; if (hw < bin) { y[Math.floor((Eg - lo) / bin)] += w / bin; continue; }
      for (var j = 0; j < nb; j++) { var e = lo + (j + 0.5) * bin; if (Math.abs(e - Eg) <= hw) y[j] += w / (2 * hw); }
    }
    var stopped = Math.exp(-tStop / tau); y[Math.min(nb - 1, Math.floor((Eg - lo) / bin))] += stopped / bin;
    var E = []; for (i = 0; i < nb; i++) E.push(lo + (i + 0.5) * bin);
    return { E: E, y: y, inflight: inflight, beta0: b0 };
  }
  /* Photon-transport Monte Carlo in a homogeneous sphere or cylinder (radius R, half-length H, cm), density rho.
     Photoabsorption (with K fluorescence escape), Compton (Klein-Nishina sampling, free electrons) and pair
     production (local e+e- deposition, two back-to-back 511 keV photons tracked); coherent scattering ignored.
     Source: point at the centre or uniform in the volume. Each event may contain several gammas emitted
     together (a cascade): their deposits add (true coincidence summing); angular correlation W(theta) between
     the first two is applied if given. Returns deposited-energy histogram per decay. */
  function photonMC(o) {
    var r = rng(o.seed || 98765), xc = o.xcom, comp = o.comp, rho = o.rho, R = o.R, H = o.H == null ? o.R : o.H, geo = o.geometry || 'sphere';
    var Emax = o.Emax, nb = o.bins || 1000, bin = Emax * 1.05 / nb, hist = new Float64Array(nb), N = o.events || 20000;
    var cache = {};
    function mu(E) {
      var key = Math.round(E * 2) / 2; if (cache[key]) return cache[key];
      var m = P.xcomMaterial(xc, comp, Math.max(E, 1)), t = m.photo + m.incoh + m.pair;
      return (cache[key] = { tot: t * rho, fP: m.photo / t, fC: m.incoh / t, photoBy: m.photoBy });
    }
    function inside(p) { return geo === 'sphere' ? p[0] * p[0] + p[1] * p[1] + p[2] * p[2] <= R * R : (p[0] * p[0] + p[1] * p[1] <= R * R && Math.abs(p[2]) <= H); }
    function distOut(p, d) {                       // distance to the boundary along d
      if (geo === 'sphere') { var b = p[0] * d[0] + p[1] * d[1] + p[2] * d[2], c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - R * R; return -b + Math.sqrt(Math.max(b * b - c, 0)); }
      var a = d[0] * d[0] + d[1] * d[1], bb = p[0] * d[0] + p[1] * d[1], cc = p[0] * p[0] + p[1] * p[1] - R * R, s = Infinity;
      if (a > 1e-12) s = (-bb + Math.sqrt(Math.max(bb * bb - a * cc, 0))) / a;
      if (d[2] > 1e-12) s = Math.min(s, (H - p[2]) / d[2]); else if (d[2] < -1e-12) s = Math.min(s, (-H - p[2]) / d[2]);
      return s;
    }
    function isoDir() { var c = 2 * r() - 1, s = Math.sqrt(1 - c * c), f = 2 * Math.PI * r(); return [s * Math.cos(f), s * Math.sin(f), c]; }
    function kn(E) {                               // Kahn's method for Klein-Nishina: returns E' and cos(theta)
      var k = E / ME;
      for (;;) {
        var r1 = r(), r2 = r(), r3 = r(), x;
        if (r1 <= (1 + 2 * k) / (9 + 2 * k)) { x = 1 + 2 * k * r2; if (r3 <= 4 * (1 / x - 1 / (x * x))) break; }
        else { x = (1 + 2 * k) / (1 + 2 * k * r2); var c0 = 1 - (x - 1) / k; if (r3 <= 0.5 * (c0 * c0 + 1 / x)) break; }
      }
      return { E: E / x, c: 1 - (x - 1) / k };
    }
    function track(E, p, d) {                      // returns energy deposited by this photon and its daughters
      var dep = 0, guard = 0;
      while (E > 1 && guard++ < 200) {
        var m = mu(E), s = -Math.log(r() || 1e-12) / m.tot, so = distOut(p, d);
        if (s >= so) break;                        // escapes
        p = [p[0] + s * d[0], p[1] + s * d[1], p[2] + s * d[2]];
        var u = r();
        if (u < m.fP) {                            // photoabsorption; K X-ray of the dominant absorber may escape
          var dep_ = E, dom = null, best = 0;
          Object.keys(m.photoBy).forEach(function (el) { if (m.photoBy[el] > best) { best = m.photoBy[el]; dom = el; } });
          var BK = dom && o.edges && o.edges[dom] && E > o.edges[dom] ? o.edges[dom] : 0;
          if (BK && r() < 0.8 * P.fluorYieldK(o.Zof[dom])) { var ek = Math.min(P.kalpha(o.Zof[dom]), BK); dep_ = E - ek; dep += dep_ + track(ek, p, isoDir()); return dep; }
          return dep + dep_;
        } else if (u < m.fP + m.fC) {              // Compton
          var k = kn(E); dep += E - k.E; E = k.E;
          var sn = Math.sqrt(Math.max(0, 1 - k.c * k.c)), ph = 2 * Math.PI * r(); d = rotate(d, sn * Math.cos(ph), sn * Math.sin(ph), k.c);
        } else {                                   // pair
          dep += E - 2 * ME; var dd = isoDir();
          return dep + track(ME, p, dd) + track(ME, p, [-dd[0], -dd[1], -dd[2]]);
        }
      }
      return dep;
    }
    var cascades = o.cascades;                     // [{w, gammas:[E...], A22, A44}]
    var cw = cascades.reduce(function (a, c) { return a + c.w; }, 0), cdf = [], acc = 0;
    cascades.forEach(function (c) { acc += c.w / cw; cdf.push(acc); });
    for (var ev = 0; ev < N; ev++) {
      var u = r(), ci = 0; while (ci < cdf.length - 1 && cdf[ci] < u) ci++;
      var c = cascades[ci], p0;
      if (o.source === 'volume') { do { p0 = [(2 * r() - 1) * R, (2 * r() - 1) * R, (2 * r() - 1) * H]; } while (!inside(p0)); } else p0 = [0, 0, 0];
      var tot = 0, d1 = isoDir();
      c.gammas.forEach(function (E, gi) {
        var d = gi === 0 ? d1 : isoDir();
        if (gi === 1 && (c.A22 || c.A44)) {        // sample the second direction from W(theta) relative to the first
          var wmax = 1 + Math.abs(c.A22 || 0) + Math.abs(c.A44 || 0);
          for (var tries = 0; tries < 100; tries++) {
            var cz = 2 * r() - 1, P2 = 0.5 * (3 * cz * cz - 1), P4 = (35 * Math.pow(cz, 4) - 30 * cz * cz + 3) / 8;
            if (r() * wmax <= 1 + (c.A22 || 0) * P2 + (c.A44 || 0) * P4) { var sn = Math.sqrt(1 - cz * cz), ph = 2 * Math.PI * r(); d = rotate(d1, sn * Math.cos(ph), sn * Math.sin(ph), cz); break; }
          }
        }
        tot += track(E, p0.slice(), d);
      });
      if (tot > 0) hist[Math.min(nb - 1, Math.floor(tot / bin))] += cw / N / bin;
    }
    var x = []; for (var i = 0; i < nb; i++) x.push((i + 0.5) * bin);
    return { x: x, y: hist, bin: bin, events: N, decaysPerEvent: cw };
  }

  var api = { parseXY: parseXY, lin: lin, moller: moller, cherenkovDeltaTable: cherenkovDeltaTable, cherenkovAngles: cherenkovAngles,
    detectLight: detectLight, rangeTable: rangeTable, depthSpectrum: depthSpectrum, birksVisible: birksVisible, lindhard: lindhard,
    watt: watt, wattMean: wattMean, ipc: ipc, wig3j: wig3j, wig6j: wig6j, Fk: Fk, Ak: Ak, cascadeCorrelation: cascadeCorrelation,
    dopplerLine: dopplerLine, photonMC: photonMC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SignalExtra = api;
})(this);
