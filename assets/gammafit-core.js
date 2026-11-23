/* Gamma Line Explorer: spectrum fit engine (runs in a Web Worker; also loadable in Node for tests).

   Model for the counts n_i in channel i:
       mu_i = sum_j beta_j B_j(E_i)  +  sum_k A_k T_k(E_i; theta)
   B_j: cubic B-splines in energy (smooth, non-negative background, absorbs scatter from surroundings)
   T_k: template of candidate source k = sum over its lines of I * eff(E) * R(E_i; E_line, theta)
   R:   detector response to one gamma line. Two modes:
        "local"   (HPGe): Gaussian photopeak + low-energy step + optional escape peaks; the Compton continuum is
                  left to the smooth background, as in standard HPGe peak fitting.
        "compton" (scintillators, liquid nobles): photopeak + Klein-Nishina single-scatter continuum + flat
                  multiple-scatter shelf between the Compton edge and the photopeak + backscatter peak, with the
                  peak-to-total ratio and shelf / backscatter fractions as parameters; all smeared by the resolution.
   theta: calibration (c0, c1, c2), resolution FWHM^2 = a^2 + b E + c E^2, efficiency shape, step / escape / Compton
          shape parameters. Each has a prior (value, sigma) or is fixed.

   Fitting: for fixed theta the model is linear in (beta, A) >= 0 and the Poisson likelihood is maximised by
   multiplicative EM (MLEM) updates. theta is fitted by Levenberg-Marquardt on Poisson deviance residuals plus
   prior pulls, re-solving the linear part at each step (variable projection). Sources are chosen by backward
   elimination: a source stays only if removing it worsens the deviance by more than a penalty that grows as its
   prior (from the explorer's rate ranking) falls. */
(function (root) {
  'use strict';
  var ME = 510.99895;                 // electron mass, keV

  /* ------------------------------------------------------------ parameters */
  var PNAMES = ['c0', 'c1', 'c2', 'a', 'b', 'c', 'e1', 'e2', 'step', 'tail', 'tailw', 'se', 'de', 'pt', 'ptk', 'shelf', 'bs'];

  function energyOf(p, ch) { return p.c0 + p.c1 * ch + p.c2 * ch * ch; }
  function fwhm(p, E) { return Math.sqrt(Math.max(p.a * p.a + p.b * E + p.c * E * E, 1e-6)); }
  function eff(p, E) { var x = Math.log(Math.max(E, 10) / 1000); return Math.exp(p.e1 * x + p.e2 * x * x); }
  function peakToTotal(p, E) { return Math.min(0.999, Math.max(0.001, p.pt * Math.pow(E / 662, -p.ptk))); }
  function erfc(x) {                  // Numerical Recipes erfc, |error| < 1.2e-7
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851638 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  // Klein-Nishina distribution of the electron recoil energy T for a photon of energy E (unnormalised)
  function kn(E, T) {
    var e = E / ME, s = T / E;
    if (s <= 0 || s >= 2 * e / (1 + 2 * e)) return 0;
    return 2 + s * s / (e * e * (1 - s) * (1 - s)) + s / (1 - s) * (s - 2 / e);
  }

  var KNN = {};
  function knNorm(E) {                // integral of kn(E, T) dT over 0..T_max (Simpson, 400 steps), cached
    var key = E.toFixed(3); if (KNN[key]) return KNN[key];
    var tmax = E * 2 * (E / ME) / (1 + 2 * E / ME), n = 400, h = tmax / n, s = 0;
    for (var i = 0; i <= n; i++) { var T = Math.min(i * h, tmax * (1 - 1e-9)); s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * kn(E, Math.max(T, 1e-9)); }
    return (KNN[key] = s * h / 3);
  }

  /* ------------------------------------------------------------ geometry of the spectrum */
  function Grid(nch, lo, hi, p) {      // channels [lo, hi) are fitted
    this.lo = lo; this.hi = hi; this.n = hi - lo;
    this.E = new Float64Array(this.n); this.dE = new Float64Array(this.n);
    for (var i = 0; i < this.n; i++) {
      var ch = lo + i;
      this.E[i] = energyOf(p, ch);
      this.dE[i] = energyOf(p, ch + 0.5) - energyOf(p, ch - 0.5);
    }
  }
  Grid.prototype.index = function (E) {   // fractional channel index (relative to lo) of energy E
    var a = 0, b = this.n - 1;
    if (E <= this.E[0]) return (E - this.E[0]) / this.dE[0];
    if (E >= this.E[b]) return b + (E - this.E[b]) / this.dE[b];
    while (b - a > 1) { var m = (a + b) >> 1; if (this.E[m] <= E) a = m; else b = m; }
    return a + (E - this.E[a]) / (this.E[b] - this.E[a]);
  };

  // sparse column: {lo, v: Float64Array}
  function addGauss(col, g, E0, sig, area) {
    if (area <= 0) return;
    var c = g.index(E0), w = 5 * sig / g.dE[Math.max(0, Math.min(g.n - 1, Math.round(c)))];
    var i0 = Math.max(0, Math.floor(c - w)), i1 = Math.min(g.n - 1, Math.ceil(c + w));
    for (var i = i0; i <= i1; i++) {
      var a = (g.E[i] - 0.5 * g.dE[i] - E0) / (Math.SQRT2 * sig), b = (g.E[i] + 0.5 * g.dE[i] - E0) / (Math.SQRT2 * sig);
      col[i] += area * 0.5 * (erfc(a) - erfc(b));
    }
  }
  function addStepTail(col, g, E0, sig, area, p) {   // HPGe: low-energy step (incomplete charge collection, small-angle scatter) and exponential tail
    var c = g.index(E0), i1 = Math.min(g.n - 1, Math.ceil(c + 4 * sig / g.dE[0]));
    var h = area * p.step / (sig * Math.sqrt(2 * Math.PI));   // step height per keV = step x peak height
    for (var i = 0; i <= i1; i++) {
      var x = g.E[i] - E0, d = g.dE[i];
      if (h > 0 && x > -40 * sig - 60) col[i] += h * 0.5 * erfc(x / (Math.SQRT2 * sig)) * d;
      if (p.tail > 0 && x < 4 * sig) {
        var tw = Math.max(p.tailw, 0.2) * sig;
        // exponential tail convolved with the Gaussian
        var arg = x / tw + sig * sig / (2 * tw * tw);
        var v = arg > 50 ? 0 : Math.exp(arg) * 0.5 * erfc((x / sig + sig / tw) / Math.SQRT2) / tw;
        col[i] += area * p.tail * v * d;
      }
    }
  }
  function smear(raw, g, p) {          // Gaussian smearing with energy-dependent resolution (for continua)
    var out = new Float64Array(g.n);
    for (var i = 0; i < g.n; i++) {
      var r = raw[i]; if (!r) continue;
      var sig = fwhm(p, g.E[i]) / 2.355, w = Math.ceil(4 * sig / g.dE[i]) + 1;
      var i0 = Math.max(0, i - w), i1 = Math.min(g.n - 1, i + w), tot = 0, k;
      for (k = i0; k <= i1; k++) { var z = (g.E[k] - g.E[i]) / sig; tot += Math.exp(-0.5 * z * z); }
      if (tot <= 0) { out[i] += r; continue; }
      for (k = i0; k <= i1; k++) { var y = (g.E[k] - g.E[i]) / sig; out[k] += r * Math.exp(-0.5 * y * y) / tot; }
    }
    return out;
  }

  /* ------------------------------------------------------------ simulated response matrix
     M = { dlo, dw, nd: uniform grid of deposited energy (keV), E: [simulated gamma energies, ascending],
           dens: [continuum density per keV per emitted gamma, photopeak removed], pf: [full-energy probability],
           smeared: true if the simulation already includes the detector resolution }
     Before smearing the matrix is lower triangular (deposits <= gamma energy). A line between two simulated energies
     is interpolated with each neighbour stretched so that its photopeak and continuum scale with energy. */
  function matDensity(M, j, x) {        // density of column j at deposited energy x (linear interpolation)
    var u = (x - M.dlo) / M.dw - 0.5, i = Math.floor(u), f = u - i, d = M.dens[j];
    if (i < -1 || i >= M.nd) return 0;
    var a = i >= 0 ? d[i] : 0, b = i + 1 < M.nd ? d[i + 1] : 0;
    return a + (b - a) * f;
  }
  function matLine(M, E) {              // bracketing columns and weight
    var n = M.E.length;
    if (E <= M.E[0]) return [0, 0, 0];
    if (E >= M.E[n - 1]) return [n - 1, n - 1, 0];
    var j = 0; while (M.E[j + 1] < E) j++;
    return [j, j + 1, (E - M.E[j]) / (M.E[j + 1] - M.E[j])];
  }
  // unsmeared response of one source on the deposited-energy grid (cached on the source: it does not depend on theta)
  function matSource(src, M) {
    if (src._mat) return src._mat;
    var cont = new Float64Array(M.nd), peaks = [];
    src.lines.forEach(function (l) {
      var E = l[0], w = l[1] / 100; if (w <= 0 || E <= M.dlo) return;
      var b = matLine(M, E), j0 = b[0], j1 = b[1], f = b[2], s0 = M.E[j0] / E, s1 = M.E[j1] / E;
      var pf = (1 - f) * M.pf[j0] + f * M.pf[j1];
      peaks.push([E, w * pf, l[2] || '']);
      var top = Math.min(M.nd, Math.ceil((E - M.dlo) / M.dw) + 1);       // triangular: nothing above the line energy
      for (var i = 0; i < top; i++) {
        var x = M.dlo + (i + 0.5) * M.dw;
        cont[i] += w * ((1 - f) * matDensity(M, j0, x * s0) * s0 + f * matDensity(M, j1, x * s1) * s1);
      }
    });
    return (src._mat = { cont: cont, peaks: peaks });
  }

  /* ------------------------------------------------------------ templates */
  // one candidate source: lines [[E keV, I per 100 decays, flags], ...]
  function template(src, g, p, mode, M) {
    if (mode === 'matrix' && M) return matTemplate(src, g, p, M);
    var col = new Float64Array(g.n), cont = mode === 'compton' ? new Float64Array(g.n) : null;
    var Emin = g.E[0] - 5 * fwhm(p, g.E[0]), Emax = g.E[g.n - 1];
    src.lines.forEach(function (l) {
      var E = l[0], f = l[2] || '';
      if (E > Emax + 3 * fwhm(p, E) || l[1] <= 0) return;
      var w = l[1] / 100 * eff(p, E), sig = fwhm(p, E) / 2.355;
      if (f.indexOf('b') >= 0) sig = Math.sqrt(sig * sig + Math.pow(0.004 * E, 2));
      else if (f.indexOf('a') >= 0) sig = Math.sqrt(sig * sig + Math.pow(0.001 * E, 2));
      if (mode === 'compton') {
        var pt = peakToTotal(p, E), tmax = E * 2 * (E / ME) / (1 + 2 * E / ME);
        if (E >= Emin) addGauss(col, g, E, sig, w * pt);
        var rest = w * (1 - pt), fs = Math.max(0, p.shelf), fb = Math.max(0, p.bs), fk = Math.max(0, 1 - fs - fb);
        // Klein-Nishina continuum (unsmeared), normalised over its whole range 0..T_max, not just the fitted channels
        var norm = knNorm(E), i;
        for (i = 0; i < g.n; i++) {
          var T = g.E[i];
          if (T > 0 && T < tmax) cont[i] += rest * fk * kn(E, T) * g.dE[i] / norm;
        }
        // multiple-scatter shelf between the edge and the photopeak
        var a = g.index(tmax), b = g.index(E), ia = Math.max(0, Math.ceil(a)), ib = Math.min(g.n - 1, Math.floor(b));
        if (ib >= ia) for (i = ia; i <= ib; i++) cont[i] += rest * fs / (ib - ia + 1);
        // backscatter peak from the surroundings (photon scattered by ~180 degrees)
        var Ebs = E / (1 + 2 * E / ME);
        if (fb > 0 && Ebs > Emin) addGauss(cont, g, Ebs, Math.sqrt(Math.pow(fwhm(p, Ebs) / 2.355, 2) + Math.pow(0.08 * Ebs, 2)), rest * fb);
      } else {
        if (E >= Emin) { addGauss(col, g, E, sig, w); if (p.step > 0 || p.tail > 0) addStepTail(col, g, E, sig, w, p); }
      }
      if (E > 1150 && (p.se > 0 || p.de > 0)) {         // pair production: single and double escape peaks
        var x = Math.min(1, (E - 1022) / 1592);          // grows with energy; equals the parameter at 2614 keV
        if (p.se > 0) addGauss(col, g, E - ME, fwhm(p, E - ME) / 2.355, w * p.se * x);
        if (p.de > 0) addGauss(col, g, E - 2 * ME, fwhm(p, E - 2 * ME) / 2.355, w * p.de * x);
      }
    });
    if (cont) { var sm = smear(cont, g, p); for (var i = 0; i < g.n; i++) col[i] += sm[i]; }
    return sparse(col);
  }
  function matTemplate(src, g, p, M) {
    var ms = matSource(src, M), col = new Float64Array(g.n), raw = new Float64Array(g.n), i;
    var Emin = g.E[0] - 5 * fwhm(p, g.E[0]);
    for (i = 0; i < g.n; i++) {                      // continuum: resample onto the channels, with the efficiency correction
      var E = g.E[i], u = (E - M.dlo) / M.dw - 0.5, k = Math.floor(u), f = u - k;
      if (k < -1 || k >= M.nd) continue;
      var a = k >= 0 ? ms.cont[k] : 0, b = k + 1 < M.nd ? ms.cont[k + 1] : 0;
      raw[i] = (a + (b - a) * f) * g.dE[i];
    }
    ms.peaks.forEach(function (pk) {
      var E = pk[0], e = eff(p, E);
      if (E < Emin) return;
      if (M.smeared) { addGauss(raw, g, E, Math.max(g.dE[0], M.dw) / 2.355, pk[1] * e); return; }   // already smeared: keep it narrow
      var sig = fwhm(p, E) / 2.355, fl = pk[2];
      if (fl.indexOf('b') >= 0) sig = Math.sqrt(sig * sig + Math.pow(0.004 * E, 2));
      else if (fl.indexOf('a') >= 0) sig = Math.sqrt(sig * sig + Math.pow(0.001 * E, 2));
      addGauss(col, g, E, sig, pk[1] * e);
      if (p.step > 0) addStepTail(col, g, E, sig, pk[1] * e, { step: p.step, tail: 0, tailw: 1 });
    });
    if (p.e1 || p.e2) for (i = 0; i < g.n; i++) if (raw[i]) raw[i] *= eff(p, g.E[i] > 50 ? g.E[i] : 50);   // relative-efficiency correction (approximate for the continuum)
    var sm = M.smeared ? raw : smear(raw, g, p);
    for (i = 0; i < g.n; i++) col[i] += sm[i];
    return sparse(col);
  }

  function sparse(col) {                // {idx: channel indices, v: values, sum}; drops entries below 1e-7 of the maximum
    var max = 0, i, n = 0; for (i = 0; i < col.length; i++) if (col[i] > max) max = col[i];
    if (max <= 0) return null;
    var cut = max * 1e-7, sum = 0;
    for (i = 0; i < col.length; i++) if (col[i] >= cut) n++;
    var idx = new Int32Array(n), v = new Float64Array(n), k = 0;
    for (i = 0; i < col.length; i++) if (col[i] >= cut) { idx[k] = i; v[k] = col[i]; sum += col[i]; k++; }
    return { idx: idx, v: v, sum: sum };
  }
  function splines(g, nk) {             // cubic B-splines on a uniform knot grid in energy
    var cols = [], E0 = g.E[0], E1 = g.E[g.n - 1], h = (E1 - E0) / (nk - 1);
    function b3(u) { u = Math.abs(u); return u < 1 ? (4 - 6 * u * u + 3 * u * u * u) / 6 : u < 2 ? Math.pow(2 - u, 3) / 6 : 0; }
    for (var j = -1; j <= nk; j++) {
      var c = new Float64Array(g.n), x0 = E0 + j * h;
      for (var i = 0; i < g.n; i++) c[i] = b3((g.E[i] - x0) / h) * g.dE[i];
      var s = sparse(c); if (s) cols.push(s);
    }
    return cols;
  }

  /* ------------------------------------------------------------ linear part: Poisson MLEM with non-negativity */
  function model(cols, x, n) {
    var mu = new Float64Array(n);
    for (var k = 0; k < cols.length; k++) {
      var c = cols[k], xk = x[k]; if (!c || !xk) continue;
      for (var i = 0; i < c.v.length; i++) mu[c.idx[i]] += xk * c.v[i];
    }
    return mu;
  }
  function mlem(cols, data, x, iters, active) {
    var n = data.length, mu, k, i;
    for (var it = 0; it < iters; it++) {
      mu = model(cols, x, n);
      for (k = 0; k < cols.length; k++) {
        var c = cols[k]; if (!c || (active && !active[k]) || !x[k]) continue;
        var num = 0, den = 0;
        for (i = 0; i < c.v.length; i++) { var m = mu[c.idx[i]]; num += c.v[i] * (m > 0 ? data[c.idx[i]] / m : 0); den += c.v[i]; }
        if (den > 0) x[k] *= Math.pow(num / den, it < iters - 5 ? 1.6 : 1);   // over-relaxed EM step; plain EM at the end
      }
    }
    return model(cols, x, n);
  }
  function deviance(data, mu) {
    var d = 0;
    for (var i = 0; i < data.length; i++) {
      var m = Math.max(mu[i], 1e-12), y = data[i];
      d += 2 * (m - y + (y > 0 ? y * Math.log(y / m) : 0));
    }
    return d;
  }
  function devResiduals(data, mu, out, off) {
    for (var i = 0; i < data.length; i++) {
      var m = Math.max(mu[i], 1e-12), y = data[i], d = 2 * (m - y + (y > 0 ? y * Math.log(y / m) : 0));
      out[off + i] = (y >= m ? 1 : -1) * Math.sqrt(Math.max(d, 0));
    }
  }

  /* ------------------------------------------------------------ linear algebra */
  function solve(A, b) {                // Gaussian elimination with partial pivoting (small systems)
    var n = b.length, M = A.map(function (r, i) { return r.slice().concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i; for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      var t = M[i]; M[i] = M[piv]; M[piv] = t;
      if (Math.abs(M[i][i]) < 1e-300) return null;
      for (k = i + 1; k < n; k++) { var f = M[k][i] / M[i][i]; for (j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) { var s = M[i][n]; for (j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }
  function invert(A) {
    var n = A.length, inv = [];
    for (var j = 0; j < n; j++) { var e = new Array(n).fill(0); e[j] = 1; var c = solve(A, e); if (!c) return null; inv.push(c); }
    return A.map(function (r, i) { return r.map(function (_, j) { return inv[j][i]; }); });
  }

  /* ------------------------------------------------------------ the fit */
  function Fit(opts) {
    this.o = opts;
    this.data = Float64Array.from(opts.counts.slice(opts.lo, opts.hi));
    this.free = PNAMES.filter(function (k) { return opts.params[k] && !opts.params[k].fixed && opts.params[k].sigma > 0; });
    this.p = {}; var self = this;
    PNAMES.forEach(function (k) { self.p[k] = opts.params[k] ? opts.params[k].value : 0; });
  }
  Fit.prototype.build = function (p, srcs) {
    var o = this.o, g = new Grid(o.counts.length, o.lo, o.hi, p);
    var bk = splines(g, o.knots || 12), tm = srcs.map(function (s) { return template(s, g, p, o.mode, o.matrix); });
    return { g: g, cols: bk.concat(tm), nb: bk.length };
  };
  Fit.prototype.linear = function (p, srcs, x0, iters) {
    var b = this.build(p, srcs), x;
    if (x0 && x0.length === b.cols.length) x = Float64Array.from(x0);
    else x = this.strip(b, srcs);
    var mu = mlem(b.cols, this.data, x, iters || 150);
    return { x: x, mu: mu, b: b, dev: deviance(this.data, mu) };
  };
  // Starting values by top-down stripping, using the (near-)triangular response: the highest-energy source is
  // estimated from its own peak region, its whole template (continuum included) is subtracted, and so on downwards.
  Fit.prototype.strip = function (b, srcs) {
    var data = this.data, n = data.length, g = b.g, x = new Float64Array(b.cols.length), r = Float64Array.from(data), k, i, t;
    var tot = data.reduce(function (s, v) { return s + v; }, 0) || 1;
    var order = srcs.map(function (s, k) {
      var c = b.cols[b.nb + k], top = 0, best = 0;
      if (c) for (t = 0; t < c.v.length; t++) if (c.v[t] > best) { best = c.v[t]; top = c.idx[t]; }
      return { k: k, top: top };
    }).sort(function (a, b2) { return b2.top - a.top; });
    // a smooth floor first: 20% of each region's counts, so stripping does not hand the background to sources
    order.forEach(function (o) {
      var c = b.cols[b.nb + o.k]; if (!c) return;
      var peak = 0; for (t = 0; t < c.v.length; t++) peak = Math.max(peak, c.v[t]);
      var num = 0, den = 0;
      for (t = 0; t < c.v.length; t++) if (c.v[t] > 0.3 * peak) { num += Math.max(r[c.idx[t]], 0); den += c.v[t]; }
      var A = den > 0 ? 0.7 * num / den : 0;
      x[b.nb + o.k] = Math.max(A, 1e-9 / Math.max(c.sum, 1e-12));
      for (t = 0; t < c.v.length; t++) r[c.idx[t]] -= A * c.v[t];
    });
    var rest = 0; for (i = 0; i < n; i++) rest += Math.max(r[i], 0);
    for (k = 0; k < b.nb; k++) { var cb = b.cols[k]; if (cb) x[k] = Math.max(rest, 0.05 * tot) / b.nb / Math.max(cb.sum, 1e-12); }
    return x;
  };
  Fit.prototype.prior = function (p) {
    var o = this.o, c = 0;
    this.free.forEach(function (k) { var z = (p[k] - o.params[k].value) / o.params[k].sigma; c += z * z; });
    return c;
  };
  Fit.prototype.objective = function (p, srcs, x0, iters) {
    var r = this.linear(p, srcs, x0, iters);
    r.obj = r.dev + this.prior(p);
    return r;
  };
  // Levenberg-Marquardt on theta (residuals = signed deviance residuals and prior pulls)
  Fit.prototype.fitTheta = function (srcs, x0, progress) {
    var self = this, o = this.o, P = this.free.length;
    if (!P) return this.objective(this.p, srcs, x0, 300);
    var p = Object.assign({}, this.p), cur = this.objective(p, srcs, x0, 300), lambda = 1e-2;
    var nres = this.data.length + P;
    function resid(r, pp) {
      var v = new Float64Array(nres); devResiduals(self.data, r.mu, v, 0);
      self.free.forEach(function (k, j) { v[self.data.length + j] = (pp[k] - o.params[k].value) / o.params[k].sigma; });
      return v;
    }
    var r0 = resid(cur, p), J = null;
    for (var it = 0; it < (o.maxIter || 25); it++) {
      J = [];
      for (var j = 0; j < P; j++) {                  // forward differences with the amplitudes held fixed (Kaufman's
        var k = this.free[j], h = 0.05 * o.params[k].sigma, q = Object.assign({}, p); q[k] += h;   // variable-projection approximation)
        var bq = this.build(q, srcs), rr = { mu: model(bq.cols, cur.x, this.data.length) };
        var rv = resid(rr, q), col = new Float64Array(nres);
        for (var i = 0; i < nres; i++) col[i] = (rv[i] - r0[i]) / h;
        J.push(col);
      }
      var JTJ = [], JTr = [];
      for (var a = 0; a < P; a++) {
        JTJ.push([]); var s = 0;
        for (var i2 = 0; i2 < nres; i2++) s += J[a][i2] * r0[i2];
        JTr.push(-s);
        for (var b = 0; b < P; b++) { var t = 0; for (var i3 = 0; i3 < nres; i3++) t += J[a][i3] * J[b][i3]; JTJ[a].push(t); }
      }
      var improved = false;
      for (var tries = 0; tries < 6; tries++) {
        var A = JTJ.map(function (row, ii) { return row.map(function (v, jj) { return ii === jj ? v * (1 + lambda) + 1e-12 : v; }); });
        var d = solve(A, JTr); if (!d) { lambda *= 10; continue; }
        var q2 = Object.assign({}, p); this.free.forEach(function (kk, jj) { q2[kk] += d[jj]; });
        if (q2.c1 !== undefined && q2.c1 <= 0) { lambda *= 10; continue; }
        var nx = this.objective(q2, srcs, cur.x, 250);
        if (nx.obj < cur.obj - 1e-6) { p = q2; cur = nx; r0 = resid(cur, p); lambda = Math.max(lambda / 5, 1e-6); improved = true; break; }
        lambda *= 8;
      }
      if (progress) progress('Fitting response parameters: step ' + (it + 1) + ', deviance ' + cur.dev.toFixed(1));
      if (!improved || Math.abs(cur.objPrev - cur.obj) < 0.05) break;
      cur.objPrev = cur.obj;
    }
    cur = this.objective(p, srcs, cur.x, 400);
    cur.p = p;
    this.p = p;
    return cur;
  };
  // Deviance increase when source k is dropped. Only the channels where source k contributes, and the columns that
  // overlap them, are refitted (a local EM refit); everything else stays as in the full solution.
  Fit.prototype.removalCost = function (srcs, sol, k) {
    var cols = sol.b.cols, kk = sol.b.nb + k, ck = cols[kk], x = sol.x, data = this.data, n = data.length;
    if (!ck || x[kk] <= 0) return 0;
    var mark = new Uint8Array(n), j, i, t;
    for (t = 0; t < ck.idx.length; t++) mark[ck.idx[t]] = 1;
    var act = [];
    for (j = 0; j < cols.length; j++) {
      if (j === kk || !cols[j] || x[j] <= 0) continue;
      var c = cols[j]; for (t = 0; t < c.idx.length; t++) if (mark[c.idx[t]]) { act.push(j); break; }
    }
    // work only on the marked channels: other columns may rescale their contribution there
    var M = ck.idx, mu = new Float64Array(M.length), y = new Float64Array(M.length), pos = new Int32Array(n).fill(-1);
    for (t = 0; t < M.length; t++) { pos[M[t]] = t; mu[t] = sol.mu[M[t]] - x[kk] * ck.v[t]; y[t] = data[M[t]]; }
    var part = act.map(function (jj) {            // each column's values on the marked channels
      var c = cols[jj], ii = [], vv = [];
      for (var q = 0; q < c.idx.length; q++) { var pp = pos[c.idx[q]]; if (pp >= 0) { ii.push(pp); vv.push(c.v[q]); } }
      return { i: ii, v: vv, f: 1, a: x[jj] };
    });
    for (var it = 0; it < 30; it++) {
      part.forEach(function (c) {
        var num = 0, den = 0, q;
        for (q = 0; q < c.i.length; q++) { var m = mu[c.i[q]]; num += c.v[q] * (m > 0 ? y[c.i[q]] / m : 0); den += c.v[q]; }
        if (den <= 0) return;
        var f = num / den, d = c.a * c.f * (f - 1); c.f *= f;
        for (q = 0; q < c.i.length; q++) mu[c.i[q]] += d * c.v[q];
      });
    }
    var before = 0, after = 0;
    for (t = 0; t < M.length; t++) {
      var m0 = Math.max(sol.mu[M[t]], 1e-12), m1 = Math.max(mu[t], 1e-12), yy = y[t], ly = yy > 0 ? yy * Math.log(yy) : 0;
      before += 2 * (m0 - yy + (yy > 0 ? ly - yy * Math.log(m0) : 0));
      after += 2 * (m1 - yy + (yy > 0 ? ly - yy * Math.log(m1) : 0));
    }
    return after - before;
  };
  // Joint covariance of the active amplitudes and the free response parameters: Fisher information
  // F = sum_i (d mu_i/d q_a)(d mu_i/d q_b) / mu_i plus the prior on theta, inverted.
  Fit.prototype.covariance = function (sol, srcs) {
    var self = this, o = this.o, cols = sol.b.cols, mu = sol.mu, n = this.data.length, act = [], k, i;
    for (k = 0; k < cols.length; k++) if (cols[k] && sol.x[k] > 0) act.push(k);
    var D = act.map(function (kk) { var v = new Float64Array(n), c = cols[kk]; for (var t = 0; t < c.v.length; t++) v[c.idx[t]] = c.v[t]; return v; });
    this.free.forEach(function (key) {
      var h = 0.02 * o.params[key].sigma, q = Object.assign({}, sol.p); q[key] += h;
      var m2 = model(self.build(q, srcs).cols, sol.x, n), v = new Float64Array(n);
      for (var t = 0; t < n; t++) v[t] = (m2[t] - mu[t]) / h;
      D.push(v);
    });
    var m = D.length, F = [];
    for (var a = 0; a < m; a++) { F.push(new Array(m).fill(0)); }
    for (a = 0; a < m; a++) for (var b = a; b < m; b++) {
      var sum = 0, da = D[a], db = D[b];
      for (i = 0; i < n; i++) if (da[i] && db[i]) sum += da[i] * db[i] / Math.max(mu[i], 1);
      F[a][b] = F[b][a] = sum;
    }
    this.free.forEach(function (key, j) { var r = act.length + j; F[r][r] += 1 / (o.params[key].sigma * o.params[key].sigma); });
    var C = invert(F), sigA = new Float64Array(cols.length), thetaSig = {};
    if (C) {
      act.forEach(function (kk, j) { sigA[kk] = Math.sqrt(Math.max(C[j][j], 0)); });
      this.free.forEach(function (key, j) { var r = act.length + j; thetaSig[key] = Math.sqrt(Math.max(C[r][r], 0)); });
    }
    return { sigA: sigA, thetaSig: thetaSig };
  };

  function run(opts, progress) {
    var fit = new Fit(opts), srcs = opts.sources.slice(), t0 = Date.now();
    progress = progress || function () {};
    progress('Building ' + srcs.length + ' candidate templates…');
    var sol = fit.objective(fit.p, srcs, null, 300);
    var pen = function (s) { return (opts.threshold || 9) + 2 * Math.max(0, -Math.log(Math.max(s.prior || 1, 1e-6))); };
    function eliminate(iters) {
      for (var round = 0; round < 400 && srcs.length; round++) {
        var nb = sol.b.nb, costs = srcs.map(function (s, k) { return fit.removalCost(srcs, sol, k); });
        // drop at once every source the fit gives (almost) nothing to; then the weakest remaining one at a time
        var empty = [], worst = -1, worstGap = 0;
        srcs.forEach(function (s, k) {
          var gap = costs[k] - pen(s);
          if (costs[k] < 1) empty.push(k);
          else if (gap < worstGap) { worstGap = gap; worst = k; }
        });
        var drop = empty.length ? empty : worst >= 0 ? [worst] : [];
        if (!drop.length) break;
        var xs = Array.from(sol.x);
        drop.sort(function (a, b) { return b - a; }).forEach(function (k) { xs.splice(nb + k, 1); srcs.splice(k, 1); });
        sol = fit.objective(fit.p, srcs, xs, iters);
        progress('Selecting sources: ' + srcs.length + ' left');
      }
    }
    eliminate(60);
    // fit the response parameters with the chosen sources, then re-check each source
    sol = fit.fitTheta(srcs, sol.x, progress);
    eliminate(120);                                  // re-check with the fitted response
    sol = fit.objective(fit.p, srcs, sol.x, 300); sol.p = fit.p;
    var cv = fit.covariance(sol, srcs), sig = cv.sigA, nb2 = sol.b.nb;
    var out = srcs.map(function (s, k) {
      var c = sol.b.cols[nb2 + k], A = sol.x[nb2 + k];
      return { id: s.id, name: s.name, counts: c ? A * c.sum : 0, sigma: c ? sig[nb2 + k] * c.sum : 0, decays: A, decaysSigma: sig[nb2 + k],
               dchi2: c && A > 0 ? fit.removalCost(srcs, sol, k) : 0, prior: s.prior };
    }).sort(function (a, b) { return b.counts - a.counts; });
    var g = sol.b.g, comps = {};
    srcs.forEach(function (s, k) {
      var c = sol.b.cols[nb2 + k], A = sol.x[nb2 + k]; if (!c || A <= 0) return;
      var v = new Float64Array(g.n); for (var i = 0; i < c.v.length; i++) v[c.idx[i]] = A * c.v[i];
      comps[s.id] = Array.from(v);
    });
    var bkg = new Float64Array(g.n);
    for (var j = 0; j < nb2; j++) { var cb = sol.b.cols[j]; if (cb) for (var i = 0; i < cb.v.length; i++) bkg[cb.idx[i]] += sol.x[j] * cb.v[i]; }
    var theta = {}; fit.free.forEach(function (k) { theta[k] = { value: sol.p[k], sigma: cv.thetaSig[k] != null ? cv.thetaSig[k] : null, prior: opts.params[k] }; });
    return { sources: out, theta: theta, params: sol.p, E: Array.from(g.E), data: Array.from(fit.data), model: Array.from(sol.mu),
             background: Array.from(bkg), components: comps, deviance: sol.dev, ndf: g.n - (nb2 + srcs.length + fit.free.length),
             ms: Date.now() - t0 };
  }

  var api = { run: run, template: template, Grid: Grid, kn: kn, knNorm: knNorm, fwhm: fwhm, peakToTotal: peakToTotal, eff: eff, PNAMES: PNAMES, splines: splines, model: model };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GammaFit = api;
  // Web Worker entry point
  if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof importScripts === 'function') {
    self.onmessage = function (e) {
      try {
        var res = run(e.data, function (msg) { self.postMessage({ progress: msg }); });
        self.postMessage({ result: res });
      } catch (err) { self.postMessage({ error: String(err && err.stack || err) }); }
    };
  }
})(this);
