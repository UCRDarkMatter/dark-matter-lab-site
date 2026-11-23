// Numbers behind the Radioactive Signal Explorer explainers, computed with the page's own engine.
// node figdata.js > figdata.json && python3 figures.py
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..', '..');
const P = require(R + '/assets/signals-physics.js'); P.setExchange(require(R + '/assets/signals-exchange.js'));
const J = f => JSON.parse(fs.readFileSync(path.join(R, f)));
const XC = J('data/signals/xcom.json'), NUC = J('data/signals/nuclides.json'), ST = J('data/signals/alpha_stopping.json'), CH = J('data/gamma/chains.json').chains;
const out = {}, A = a => Array.from(a);
const edges = {}, Zof = {}; Object.keys(XC).forEach(k => { edges[k] = XC[k].K; Zof[k] = XC[k].Z; });

/* gamma */
{
  const Es = []; for (let e = 1.5; e <= 4.3; e += 0.02) Es.push(Math.pow(10, e));
  const mats = { 'NaI': { Na: 0.1534, I: 0.8466 }, 'Ge': { Ge: 1 }, 'Water': { H: 0.1119, O: 0.8881 } };
  out.xcom = {}; for (const m in mats) out.xcom[m] = { E: Es, photo: Es.map(E => P.xcomMaterial(XC, mats[m], E).photo), incoh: Es.map(E => P.xcomMaterial(XC, mats[m], E).incoh), pair: Es.map(E => P.xcomMaterial(XC, mats[m], E).pair), coh: Es.map(E => P.xcomMaterial(XC, mats[m], E).coh) };
  out.kn = [100, 662, 1461, 2615].map(E => { const T = [], y = []; const tm = P.comptonEdge(E); let s = 0; for (let i = 1; i < 400; i++) { const t = tm * i / 400; T.push(t); y.push(P.knShape(E, t)); s += P.knShape(E, t) * tm / 400; } return { E, T, y: y.map(v => v / s), tm }; });
  const g = pesc => P.gammaSpectrum({ E: 661.657, comp: mats.NaI, xcom: XC, edges, Zof, pesc, fwhm662: 45, bin: 1 });
  out.cs = [1, 0.5, 0].map(pe => { const r = g(pe); return { pesc: pe, x: A(r.grid), y: A(r.comps.total) }; });
  const t = P.gammaSpectrum({ E: 2614.51, comp: mats.Ge, xcom: XC, edges, Zof, pesc: 1, fwhm662: 0, bin: 2 });
  out.pair = { x: A(t.grid), y: A(t.comps.positron), f: t.fractions };
}
/* alpha */
{
  const am = NUC['237Np'], Md = P.nucMass(237, 93, am[8]);
  const Qs = [], Ta = [], Tr = [];
  for (let Q = 4000; Q <= 9000; Q += 100) { const k = P.alphaKinematics(Q, 0, Md); Qs.push(Q); Ta.push(k.Ta); Tr.push(k.Tr); }
  out.akin = { Q: Qs, Ta, Tr };
  const md = NUC['206Pb'], Md2 = P.nucMass(206, 82, md[8]), k0 = P.alphaKinematics(5407.53, 0, Md2), Mp = Md2 + P.MALPHA_KEV + 5407.53;
  out.aband = [0, 10, 100, 1000].map(Tp => ({ Tp, a: P.boostRange(k0.Ta, P.MALPHA_KEV, Mp, Tp), r: P.boostRange(k0.Tr, Md2, Mp, Tp) }));
}
/* (alpha,n) */
{
  const d = J('data/signals/alphan/13C.json'), grid = Array.from({ length: 100 }, (_, i) => +(0.1 * (i + 1)).toFixed(1));
  out.anxs = { E: grid, total: d.total, levels: d.levels.slice(0, 5).map(L => ({ Ex: L.Ex, jp: L.jp, xs: L.xs })) };
  const ma = 4.002603, mn = 1.00866492, mT = d.mass_u, Q = d.Q_MeV, mR = mT + ma - mn - Q / 931.494;
  out.ankin = [0, 6049.4, 6129.9].map(Ex => { const th = [], En = []; for (let a = 0; a <= 180; a += 2) { const c = Math.cos(a * Math.PI / 180), Ea = 5.304; const s1 = Math.sqrt(ma * mn * Ea) * c, s2 = Math.sqrt(ma * mn * Ea * c * c + (mR + mn) * (mR * (Q - Ex / 1000) + (mR - ma) * Ea)); th.push(a); En.push(Math.pow((s1 + s2) / (mR + mn), 2)); } return { Ex, th, En }; });
  const comp = { C: 0.5998, H: 0.0805, O: 0.3196 }, targets = [];
  for (const sym in comp) { const isos = Object.keys(NUC).filter(k => NUC[k][10] > 0 && k.replace(/^\d+/, '') === sym), M = isos.reduce((s, k) => s + NUC[k][10] / 100 * NUC[k][1], 0);
    isos.forEach(k => { const f = path.join(R, 'data/signals/alphan', k + '.json'); if (fs.existsSync(f)) targets.push({ key: k, label: k + '(a,n)', data: J('data/signals/alphan/' + k + '.json'), nAtomsPerGram: comp[sym] * NUC[k][10] / 100 * 6.022e23 / M }); }); }
  const els = Object.keys(comp).filter(s => ST[s]), w = els.reduce((s, k) => s + comp[k], 0), S = E => els.reduce((s, k) => s + comp[k] * P.stoppingAt(ST[k], E), 0) / w;
  const r = P.alphaNSpectrum({ alphas: [[5.304, 1]], targets, stopping: S, dE: 0.05, Emax: 9 }), raw = P.alphaNSpectrum({ alphas: [[5.304, 1]], targets, stopping: S, dE: 0.05, Emax: 9, rawTalys: true });
  const sum = new Float64Array(r.E.length); r.partial.forEach(p => p.values.forEach((v, i) => sum[i] += v));
  out.anspec = { E: A(r.E), sum: A(sum), talys: A(raw.total), parts: r.partial.slice(0, 5).map(p => ({ label: p.label, y: A(p.values), share: p.sum / r.yield })), yield: r.yield };
  out.stop = { E: Array.from({ length: 90 }, (_, i) => 0.1 + i * 0.1), S: Array.from({ length: 90 }, (_, i) => S(0.1 + i * 0.1)) };
}
/* beta */
{
  const W = [], T = []; for (let t = 1; t <= 3000; t += 10) { T.push(t); W.push(t / 511 + 1); }
  out.fermi = [];
  for (const [Z, b] of [[2, -1], [20, -1], [82, -1], [20, 1], [82, 1]]) { const c = P.betaContext({ Z, A: 2.5 * Z || 4, beta: b, W0: 7 }); out.fermi.push({ Z, b, T, F: W.map(w => P.F0(c, w)) }); }
  const all = { L0: 1, U: 1, C: 1, WM: 1, rad: 1, o2: 1, o3: 1, RN: 1, Q: 1, S: 1, X: 1, r: 1, lambda: true };
  const sp = (p, corr) => P.betaSpectrum(Object.assign({ n: 500, corr }, p));
  const ni = sp({ Z: 29, A: 63, beta: -1, T0: 66.94, rrms: 3.88, kind: 'A', rho: Infinity, bAc: 5 }, all);
  out.factors63 = { T: A(ni.T), f: Object.fromEntries(Object.keys(ni.factors).map(k => [k, A(ni.factors[k])])) };
  const p32 = sp({ Z: 16, A: 32, beta: -1, T0: 1710.66, rrms: 3.26, kind: 'A', rho: Infinity, bAc: 5 }, all);
  out.factors32 = { T: A(p32.T), f: Object.fromEntries(Object.keys(p32.factors).map(k => [k, A(p32.factors[k])])) };
  const y90 = sp({ Z: 40, A: 90, beta: -1, T0: 2278.5, rrms: 4.27, kind: 'U', k: 1, rho: Infinity, bAc: 5 }, all), y90a = sp({ Z: 40, A: 90, beta: -1, T0: 2278.5, rrms: 4.27, kind: 'A', rho: Infinity, bAc: 5 }, all);
  out.y90 = { T: A(y90.T), U: A(y90.dNdT), Aw: A(y90a.dNdT), mean: [y90.mean, y90a.mean] };
  const base = { Z: 20, A: 40, beta: -1, T0: 1310.89, rrms: 3.48, kind: 'U', k: 3, rho: Infinity };
  const k40 = sp(base, all), k40a = sp(Object.assign({}, base, { kind: 'A' }), all); out.k40 = { T: A(k40.T), U: A(k40.dNdT), Aw: A(k40a.dNdT), mean: [k40.mean, k40a.mean] };
  // BSM
  const ref = sp({ Z: 29, A: 63, beta: -1, T0: 66.94, rrms: 3.88, kind: 'A', rho: Infinity, bAc: 5 }, all);
  const fz = sp({ Z: 29, A: 63, beta: -1, T0: 66.94, rrms: 3.88, kind: 'A', rho: Infinity, bAc: 5, fierz: 0.01 }, all);
  const st = sp({ Z: 29, A: 63, beta: -1, T0: 66.94, rrms: 3.88, kind: 'A', rho: Infinity, bAc: 5, msterile: 20, Usterile2: 0.01 }, all);
  out.bsm = { T: A(ref.T), fierz: A(fz.dNdT).map((v, i) => v / ref.dNdT[i]), sterile: A(st.dNdT).map((v, i) => v / ref.dNdT[i]) };
  // tritium endpoint, neutrino mass
  const H = m => P.betaSpectrum({ Z: 2, A: 3, beta: -1, T0: 18.5906, rrms: 1.68, kind: 'A', rho: -2.1, bAc: 4.7, mnu: m, corr: Object.assign({}, all, { r: 0 }), n: 200000 });
  const h0 = H(0), h1 = H(1), h2 = H(2);
  const sel = i => h0.T[i] > 18.5906 - 0.008;
  out.tritium = { T: A(h0.T).filter((_, i) => sel(i)), m0: A(h0.dNdT).filter((_, i) => sel(i)), m1: A(h1.dNdT).filter((_, i) => sel(i)), m2: A(h2.dNdT).filter((_, i) => sel(i)) };
}
/* Cherenkov */
{
  const lam = Array.from({ length: 151 }, (_, i) => 200 + i * 4);
  const W = [[5.684027565e-1, 1.726177391e-1, 2.086189578e-2, 1.130748688e-1], [5.101829712e-3, 1.821153936e-2, 2.620722293e-2, 1.069792721e1]];
  const FS = [[0.6961663, 0.4079426, 0.8974794], [0.00467914826, 0.0135120631, 97.9340025]], PM = [[1.1819], [0.011313]];
  out.nlam = { lam, water: lam.map(l => P.sellmeier(W[0], W[1], l)), silica: lam.map(l => P.sellmeier(FS[0], FS[1], l)), pmma: lam.map(l => P.sellmeier(PM[0], PM[1], l)) };
  const m = { n: l => P.sellmeier(W[0], W[1], l), rho: 0.998, ZA: 0.5551, I: 75, Zeff: 7.4 };
  const tab = P.cherenkovTable(m, lam, 3000);
  out.cher_mono = [300, 500, 1000, 2000].map(E => ({ E, y: A(P.cherenkovFromSpectrum(tab, [E], [1 / 5], 5)) }));
  const y90 = P.betaSpectrum({ Z: 40, A: 90, beta: -1, T0: 2278.5, rrms: 4.27, kind: 'U', k: 1, rho: Infinity, corr: { L0: 1, rad: 1, lambda: true }, n: 400 });
  out.cher_y90 = A(P.cherenkovFromSpectrum(tab, y90.T, y90.dNdT, y90.T[1] - y90.T[0]));
  const Ts = [], Nt = []; for (let E = 200; E <= 3000; E += 50) { Ts.push(E); const y = P.cherenkovFromSpectrum(tab, [E], [1 / 5], 5); let s = 0; for (let i = 1; i < lam.length; i++) s += 0.5 * (y[i] + y[i - 1]) * (lam[i] - lam[i - 1]); Nt.push(s); }
  out.cher_tot = { T: Ts, N: Nt };
  out.stopE = { T: Ts, S: Ts.map(T => P.electronStopping(T, 0.5551, 75, 7.4)) };
}
{ // recoil spectra
  const he = P.betaSpectrum({ Z: 3, A: 6, beta: -1, T0: 3505.2, rrms: 2.44, kind: 'A', rho: Infinity, corr: {}, n: 600 });
  const r = a => P.betaRecoil(he, { a: a, kind: 'A' });
  const y = P.betaSpectrum({ Z: 40, A: 90, beta: -1, T0: 2278.5, rrms: 4.27, kind: 'U', k: 1, rho: Infinity, corr: { lambda: true }, n: 600 });
  const ru = a => P.betaRecoil(y, { a: a, kind: 'U', k: 1 });
  out.recoil = { he: [-1/3, 1, 0].map(a => { const q = r(a); return { a: a, T: A(q.T), y: A(q.dNdT), mean: q.mean }; }),
    y90: [-0.2, 0, 0.2].map(a => { const q = ru(a); return { a: a, T: A(q.T), y: A(q.dNdT), mean: q.mean }; }) };
}
process.stdout.write(JSON.stringify(out));
