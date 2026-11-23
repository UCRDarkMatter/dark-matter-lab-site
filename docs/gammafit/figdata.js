// Generates the numbers behind the explainer's figures, using the site's own fit engine.
// Usage: node figdata.js > figdata.json   (then python3 figures.py)
const F = require('../../assets/gammafit-core.js');
const ME = 510.99895;
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const R = rng(11);
function pois(l) { if (l > 50) { const u = R(), v = R(); return Math.max(0, Math.round(l + Math.sqrt(l) * Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v))); } let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= R(); } while (p > L); return k - 1; }
const SRC = {
  K40: { id: 'K40', name: '40K', lines: [[1460.82, 10.66]] },
  Ra: { id: 'Ra', name: '226Ra (214Pb/214Bi)', lines: [[295.22, 18.4], [351.93, 35.6], [609.32, 45.5], [768.36, 4.9], [1120.29, 14.9], [1238.11, 5.8], [1764.49, 15.3], [2204.1, 4.9]] },
  Th: { id: 'Th', name: '228Th (212Pb/208Tl)', lines: [[238.63, 43.6], [300.09, 3.3], [583.19, 30.4], [727.33, 6.7], [860.56, 4.5], [2614.51, 35.9]] },
  Ac: { id: 'Ac', name: '228Ac', lines: [[338.32, 11.3], [911.2, 25.8], [968.97, 15.8], [964.77, 4.99]] },
  Co60: { id: 'Co60', name: '60Co', lines: [[1173.23, 99.85], [1332.49, 99.98]] },
  Cs137: { id: 'Cs137', name: '137Cs', lines: [[661.66, 85.1]] },
  U235: { id: 'U235', name: '235U', lines: [[185.72, 57.2], [143.76, 10.9]] },
  Mn54: { id: 'Mn54', name: '54Mn', lines: [[834.85, 99.98]] },
};
const clone = o => JSON.parse(JSON.stringify(o));
const dense = (t, n) => { const v = new Array(n).fill(0); if (t) for (let i = 0; i < t.v.length; i++) v[t.idx[i]] = t.v[i]; return v; };
const out = {};

/* 1. anatomy of the Compton-model response to one line (1 keV bins) */
{
  const base = { c0: 0, c1: 1, c2: 0, a: 0, b: 2.6, c: 0, e1: 0, e2: 0, step: 0, tail: 0, tailw: 1, se: 0, de: 0, pt: 0.3, ptk: 0, shelf: 0, bs: 0 };
  const n = 1800, g = new F.Grid(n, 0, n, base), line = { lines: [[1460.82, 100]] };
  const T = q => dense(F.template(clone(line), g, Object.assign({}, base, q), 'compton'), n);
  const peak = T({ pt: 0.999 }).map(v => v * 0.3 / 0.999);
  const sub = (a, b, s) => a.map((v, i) => (v - b[i]) * s);
  const kn = sub(T({ shelf: 0, bs: 0 }), peak, 0.80);
  const shelf = sub(T({ shelf: 1, bs: 0 }), peak, 0.15);
  const bs = sub(T({ shelf: 0, bs: 1 }), peak, 0.05);
  const total = T({ shelf: 0.15, bs: 0.05 });
  out.anatomy = { E: Array.from(g.E), total, peak, kn, shelf, bs, Eline: 1460.82, edge: 1460.82 * 2 * (1460.82 / ME) / (1 + 2 * 1460.82 / ME), Ebs: 1460.82 / (1 + 2 * 1460.82 / ME) };
  // the same line in an HPGe-like detector ("local" mode): Gaussian + step, with escape peaks for 2614 keV
  const h = Object.assign({}, base, { b: 0.0019, a: 0.95, step: 0.004, se: 0.06, de: 0.03 });
  const n2 = 2800, g2 = new F.Grid(n2, 0, n2, h);
  out.hpge = { E: Array.from(g2.E), y: dense(F.template({ lines: [[2614.51, 100]] }, g2, h, 'local'), n2) };
}

/* 2. Klein-Nishina recoil spectra */
{
  out.kn = [];
  for (const E of [662, 1461, 2615]) {
    const tmax = E * 2 * (E / ME) / (1 + 2 * E / ME), T = [], y = [], nrm = F.knNorm(E);
    for (let i = 1; i < 600; i++) { const t = tmax * i / 600; T.push(t); y.push(F.kn(E, t) / nrm); }
    out.kn.push({ E, tmax, T, y });
  }
}

/* 3. a synthetic simulated response matrix (same construction as the test suite) */
function column(E, dlo, dw, nd) {
  const etot = Math.min(0.9, 0.8 * Math.pow(E / 500, -0.4)), p = Math.min(0.9, 0.45 * Math.pow(E / 662, -0.7));
  const eps = E / ME, tmax = E * 2 * eps / (1 + 2 * eps), ebs = E / (1 + 2 * eps);
  const kn = [], ms = [], bs = []; let s1 = 0, s2 = 0, s3 = 0;
  for (let i = 0; i < nd; i++) {
    const x = dlo + (i + 0.5) * dw, a = x < tmax ? F.kn(E, x) : 0, b = (x > 0.3 * tmax && x < E) ? (x - 0.3 * tmax) / (E - 0.3 * tmax) : 0, c = Math.exp(-0.5 * Math.pow((x - ebs) / (0.1 * ebs), 2));
    kn.push(a); ms.push(b); bs.push(c); s1 += a * dw; s2 += b * dw; s3 += c * dw;
  }
  const d = new Float64Array(nd);
  for (let i = 0; i < nd; i++) d[i] = etot * (1 - p) * (0.6 * kn[i] / (s1 || 1) + 0.3 * ms[i] / (s2 || 1) + 0.1 * bs[i] / (s3 || 1));
  return { d, pf: etot * p };
}
const M = { dlo: 0, dw: 2, nd: 1600, E: [], dens: [], pf: [], smeared: false };
for (let E = 50; E <= 3000; E += 20) { const c = column(E, 0, 2, 1600); M.E.push(E); M.dens.push(c.d); M.pf.push(c.pf); }
{
  // matrix image (coarsened), plus the interpolation test at an energy between two simulated columns
  const img = [], step = 10;
  for (let j = 0; j < M.E.length; j += 2) { const row = []; for (let i = 0; i < M.nd; i += step) { let s = 0; for (let k = 0; k < step; k++) s += M.dens[j][i + k]; row.push(s / step); } const pk = Math.floor((M.E[j] - M.dlo) / M.dw / step); if (pk < row.length) row[pk] += M.pf[j] / (M.dw * step); img.push(row); }
  out.matrix = { img, Etrue: M.E.filter((_, j) => j % 2 === 0), dstep: M.dw * 10 };
  // coarse simulated grid (columns every 400 keV) so the difference between the two schemes is visible
  const E = 1460.82, truth = column(E, 0, 2, 1600), Ma = { E: [1300, 1700], dens: [column(1300, 0, 2, 1600).d, column(1700, 0, 2, 1600).d] };
  const j0 = 0, j1 = 1, f = (E - 1300) / 400, s0 = 1300 / E, s1 = 1700 / E;
  const dens = (j, x) => { const u = x / M.dw - 0.5, i = Math.floor(u), ff = u - i, d = Ma.dens[j]; const a = i >= 0 && i < M.nd ? d[i] : 0, b = i + 1 < M.nd && i + 1 >= 0 ? d[i + 1] : 0; return a + (b - a) * ff; };
  const xs = [], tru = [], stretch = [], naive = [];
  for (let i = 0; i < 760; i++) { const x = (i + 0.5) * 2; xs.push(x); tru.push(truth.d[i]); stretch.push((1 - f) * dens(j0, x * s0) * s0 + f * dens(j1, x * s1) * s1); naive.push((1 - f) * Ma.dens[j0][i] + f * Ma.dens[j1][i]); }
  out.interp = { x: xs, truth: tru, stretch, naive, E, Ea: 1300, Eb: 1700 };
}

/* 4. MLEM convergence: plain EM vs over-relaxed EM, theta fixed at the truth */
const hpgeTruth = { c0: 0.7, c1: 0.37518, c2: 0, a: 0.95, b: 0.0019, c: 2e-7, e1: -0.8, e2: -0.1, step: 0.004, tail: 0, tailw: 1, se: 0.06, de: 0.03, pt: 0.5, ptk: 0.6, shelf: 0.15, bs: 0.05 };
function synth(mode, p, amps, nch, bkg, Mx) {
  const g = new F.Grid(nch, 0, nch, p), mu = new Float64Array(nch);
  for (const [k, A] of Object.entries(amps)) { const t = F.template(clone(SRC[k]), g, p, mode, Mx); for (let i = 0; i < t.v.length; i++) mu[t.idx[i]] += A * t.v[i]; }
  for (let i = 0; i < nch; i++) mu[i] += bkg(g.E[i]) * g.dE[i];
  return Array.from(mu, pois);
}
const hpgeCounts = synth('local', hpgeTruth, { K40: 3e4, Ra: 2e4, Th: 1e4, Ac: 1e4 }, 8192, E => 2e3 * Math.exp(-E / 500) + 5);
{
  const lo = 400, data = hpgeCounts.slice(lo), g = new F.Grid(8192, lo, 8192, hpgeTruth);
  const cols = F.splines(g, 14).concat(['K40', 'Ra', 'Th', 'Ac', 'Co60', 'Cs137'].map(k => F.template(clone(SRC[k]), g, hpgeTruth, 'local')));
  const dev = mu => { let d = 0; for (let i = 0; i < data.length; i++) { const m = Math.max(mu[i], 1e-12), y = data[i]; d += 2 * (m - y + (y > 0 ? y * Math.log(y / m) : 0)); } return d; };
  const traces = {};
  for (const w of [1, 1.6, 2.2]) {
    const tot = data.reduce((a, b) => a + b, 0), x = cols.map(c => tot / cols.length / c.sum), tr = [];
    for (let it = 0; it < 400; it++) {
      const mu = F.model(cols, x, data.length); tr.push(dev(mu));
      for (let k = 0; k < cols.length; k++) { const c = cols[k]; let num = 0, den = 0; for (let i = 0; i < c.v.length; i++) { const m = mu[c.idx[i]]; num += c.v[i] * (m > 0 ? data[c.idx[i]] / m : 0); den += c.v[i]; } if (den > 0) x[k] *= Math.pow(num / den, w); }
    }
    traces[w] = tr;
  }
  out.mlem = traces;

  /* 5. profile deviance for the 40K amplitude vs the Fisher (parabolic) approximation */
  const kK = cols.length - 6, best = (() => { const x = cols.map(c => 1); for (let it = 0; it < 3000; it++) { const mu = F.model(cols, x, data.length); for (let k = 0; k < cols.length; k++) { const c = cols[k]; let num = 0, den = 0; for (let i = 0; i < c.v.length; i++) { const m = mu[c.idx[i]]; num += c.v[i] * (m > 0 ? data[c.idx[i]] / m : 0); den += c.v[i]; } if (den > 0) x[k] *= num / den; } } return x; })();
  const muB = F.model(cols, best, data.length), dmin = dev(muB);
  let fisher = 0; const cK = cols[kK]; for (let i = 0; i < cK.v.length; i++) fisher += cK.v[i] * cK.v[i] / Math.max(muB[cK.idx[i]], 1);
  const scan = [];
  for (let s = -4; s <= 4; s += 0.25) {
    const A = best[kK] + s / Math.sqrt(fisher) * 1.15, x = best.slice(); x[kK] = 0;
    const fixedMu = new Float64Array(data.length); for (let i = 0; i < cK.v.length; i++) fixedMu[cK.idx[i]] = A * cK.v[i];
    for (let it = 0; it < 800; it++) {
      const mu = F.model(cols, x, data.length); for (let i = 0; i < mu.length; i++) mu[i] += fixedMu[i];
      for (let k = 0; k < cols.length; k++) { if (k === kK) continue; const c = cols[k]; let num = 0, den = 0; for (let i = 0; i < c.v.length; i++) { const m = mu[c.idx[i]]; num += c.v[i] * (m > 0 ? data[c.idx[i]] / m : 0); den += c.v[i]; } if (den > 0) x[k] *= num / den; }
    }
    const mu = F.model(cols, x, data.length); for (let i = 0; i < mu.length; i++) mu[i] += fixedMu[i];
    scan.push([A * cK.sum, dev(mu) - dmin]);
  }
  out.profile = { scan, best: best[kK] * cK.sum, sigmaFisher: cK.sum / Math.sqrt(fisher) };
}

/* 6. full fits: HPGe (local mode) and a NaI-like detector with the simulated response (matrix mode) */
function P(o) { const p = {}; for (const k of F.PNAMES) p[k] = o[k] !== undefined ? o[k] : { value: 0, fixed: true }; return p; }
{
  const prior = P({ c0: { value: 0.3, sigma: 1 }, c1: { value: 0.375, sigma: 0.0005 }, a: { value: 0.8, sigma: 0.3 }, b: { value: 0.0016, sigma: 0.0008 }, e1: { value: -0.8, sigma: 0.3 }, e2: { value: -0.1, sigma: 0.1 }, step: { value: 0.003, sigma: 0.003 }, se: { value: 0.05, sigma: 0.05 }, de: { value: 0.02, sigma: 0.02 }, tailw: { value: 1, fixed: true } });
  const msgs = [];
  const r = F.run({ counts: hpgeCounts, lo: 400, hi: 8192, mode: 'local', params: prior, knots: 14, sources: ['K40', 'Ra', 'Th', 'Ac', 'Co60', 'Cs137', 'U235', 'Mn54'].map(k => Object.assign({ prior: 1 }, clone(SRC[k]))) }, m => msgs.push(m));
  out.fitH = { E: r.E, data: r.data, model: r.model, background: r.background, components: r.components, names: Object.fromEntries(Object.keys(SRC).map(k => [k, SRC[k].name])), sources: r.sources, theta: r.theta, deviance: r.deviance, ndf: r.ndf, ms: r.ms, truth: hpgeTruth, steps: msgs.filter(m => /left|step/.test(m)) };
}
{
  const truth = { c0: 4, c1: 3.02, c2: 0, a: 4, b: 3.0, c: 0.0001, e1: 0, e2: 0, step: 0, tail: 0, tailw: 1, se: 0, de: 0, pt: 0, ptk: 0, shelf: 0, bs: 0 };
  const counts = synth('matrix', truth, { K40: 2e6, Ra: 1.2e6, Th: 8e5 }, 1024, E => 20 * Math.exp(-E / 900) + 1, M);
  const prior = P({ c0: { value: 0, sigma: 10 }, c1: { value: 3.0, sigma: 0.05 }, a: { value: 0, sigma: 10 }, b: { value: 3.3, sigma: 1 }, c: { value: 0, sigma: 0.0005 }, e1: { value: 0, sigma: 0.1 }, tailw: { value: 1, fixed: true } });
  const runOne = mode => F.run({ counts, lo: 40, hi: 1024, mode, matrix: M, knots: 6, params: mode === 'matrix' ? prior : P(Object.assign({}, prior, { e1: { value: -0.6, sigma: 0.4 }, e2: { value: -0.1, sigma: 0.2 }, pt: { value: 0.5, sigma: 0.25 }, ptk: { value: 0.6, sigma: 0.3 }, shelf: { value: 0.15, sigma: 0.1 }, bs: { value: 0.05, sigma: 0.05 } })), sources: ['K40', 'Ra', 'Th', 'Co60', 'Cs137', 'Mn54'].map(k => Object.assign({ prior: 1 }, clone(SRC[k]))) }, () => {});
  const rm = runOne('matrix'), rc = runOne('compton');
  const g = new F.Grid(1024, 40, 1024, truth), trueCounts = {};
  for (const [k, A] of Object.entries({ K40: 2e6, Ra: 1.2e6, Th: 8e5 })) trueCounts[k] = { decays: A, counts: A * F.template(clone(SRC[k]), g, truth, 'matrix', M).sum };
  const pick = r => ({ E: r.E, data: r.data, model: r.model, background: r.background, components: r.components, sources: r.sources, deviance: r.deviance, ndf: r.ndf, ms: r.ms, theta: r.theta });
  out.fitN = { matrix: pick(rm), compton: pick(rc), truth: trueCounts, names: Object.fromEntries(Object.keys(SRC).map(k => [k, SRC[k].name])) };
}
process.stdout.write(JSON.stringify(out));
