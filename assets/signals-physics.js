/* Radioactive Signal Explorer: physics engine (browser and Node).

   Gamma:     energy-deposit spectra for one interaction (Klein–Nishina Compton continuum, photoelectric and
              full-energy peaks, X-ray and annihilation escape peaks, Bethe–Heitler pair spectrum), weighted with
              NIST XCOM partial cross sections of the chosen material.
   Alpha:     two-body decay kinematics (relativistic), alpha and nuclear-recoil lines.
   (alpha,n): the NeuCBOT method (Westerdale & Meyers, NIM A 875 (2017) 57): TALYS cross sections and neutron
              spectra, SRIM stopping powers, thick-target integration; plus level-resolved partial spectra from
              two-body kinematics with isotropic centre-of-mass emission.
   Beta:      allowed and forbidden spectrum shapes with the corrections reviewed by Hayen et al., Rev. Mod. Phys.
              90 (2018) 015008 (arXiv:1709.07530): F0, L0, U, C (incl. weak magnetism, induced tensor), radiative
              O(alpha), O(Z alpha^2), O(Z^2 alpha^3) and higher, recoil R_N and Q, screening S, exchange X,
              atomic mismatch r; unique-forbidden shape factors with Coulomb functions lambda_k; Fierz term,
              neutrino mass and sterile-neutrino admixture.
   Cherenkov: Frank–Tamm photon yield integrated along the slowing-down electron (Bethe collision stopping power
              with an approximate radiative term), for constant, tabulated or Sellmeier refractive indices.
   Units: energies in keV unless stated; "natural" units (me = c = hbar = 1) inside the beta code. */
(function (root) {
  'use strict';
  var ME = 510.99895, ALPHA = 1 / 137.035999084, AMU = 931494.10242, MN_KEV = 939565.42052, MALPHA_KEV = 3727379.4118;
  var HBARC_FM = 386.15926796;           // hbar/(me c) in fm: the natural length unit
  var MNUC = 1837.4;                     // nucleon mass in electron masses (Hayen et al.)
  var MP = 1836.15267343;
  var GAMMA_E = 0.5772156649;

  /* ---------------------------------------------------------------- complex log-gamma (Lanczos, g = 7) */
  var LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function clog(a, b) { return [0.5 * Math.log(a * a + b * b), Math.atan2(b, a)]; }
  function lgammaC(x, y) {               // log Gamma(x + i y) -> [re, im]
    if (x < 0.5) {                       // reflection: Gamma(z) Gamma(1-z) = pi / sin(pi z)
      var r = lgammaC(1 - x, -y), sr = Math.sin(Math.PI * x) * Math.cosh(Math.PI * y), si = Math.cos(Math.PI * x) * Math.sinh(Math.PI * y);
      var ls = clog(sr, si);
      return [Math.log(Math.PI) - ls[0] - r[0], -ls[1] - r[1]];
    }
    x -= 1;
    var ar = LG[0], ai = 0;
    for (var k = 1; k < 9; k++) { var dr = x + k, d2 = dr * dr + y * y; ar += LG[k] * dr / d2; ai -= LG[k] * y / d2; }
    var tr = x + 7.5, ti = y, lt = clog(tr, ti), la = clog(ar, ai);
    // 0.5 ln(2 pi) + (z + 0.5) ln t - t + ln a
    var zr = x + 0.5, zi = y;
    return [0.9189385332046727 + zr * lt[0] - zi * lt[1] - tr + la[0], zr * lt[1] + zi * lt[0] - ti + la[1]];
  }
  function lgammaR(x) { return lgammaC(x, 0)[0]; }
  function lgAbs2(x, y) { return 2 * lgammaC(x, y)[0]; }   // ln |Gamma(x+iy)|^2

  function li2(x) {                      // dilogarithm, real x <= 1
    if (x === 0) return 0;
    if (x === 1) return Math.PI * Math.PI / 6;
    if (x > 0.5) return Math.PI * Math.PI / 6 - Math.log(x) * Math.log(1 - x) - li2(1 - x);
    if (x < -1) return -Math.PI * Math.PI / 6 - 0.5 * Math.pow(Math.log(-x), 2) - li2(1 / x);
    var s = 0, t = x;
    for (var k = 1; k < 200; k++) { s += t / (k * k); t *= x; if (Math.abs(t) < 1e-17) break; }
    return s;
  }
  function fact(n) { var f = 1; for (var i = 2; i <= n; i++) f *= i; return f; }
  function dfact(n) { var f = 1; for (var i = n; i > 1; i -= 2) f *= i; return f; }

  /* ================================================================ GAMMA */
  function interpLogLog(E, xs, ys, Eq) {
    if (Eq <= E[0]) return ys[0] * Math.pow(Eq / E[0], ys[1] > 0 && ys[0] > 0 ? Math.log(ys[1] / ys[0]) / Math.log(E[1] / E[0]) : 0);
    var n = E.length; if (Eq >= E[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (E[m] <= Eq) lo = m; else hi = m; }
    var y0 = ys[lo], y1 = ys[hi];
    if (y0 <= 0 || y1 <= 0) return y0 + (y1 - y0) * (Eq - E[lo]) / (E[hi] - E[lo]);
    return Math.exp(Math.log(y0) + Math.log(y1 / y0) * Math.log(Eq / E[lo]) / Math.log(E[hi] / E[lo]));
  }
  // partial mass attenuation coefficients (cm^2/g) of a material {El: mass fraction} from XCOM element tables
  function xcomMaterial(xcom, comp, Eq) {
    var out = { coh: 0, incoh: 0, photo: 0, pair: 0, photoBy: {} };
    Object.keys(comp).forEach(function (el) {
      var t = xcom[el]; if (!t) return;
      var w = comp[el];
      out.coh += w * interpLogLog(t.E, null, t.coh, Eq);
      out.incoh += w * interpLogLog(t.E, null, t.incoh, Eq);
      var ph = w * interpLogLog(t.E, null, t.photo, Eq); out.photo += ph; out.photoBy[el] = ph;
      out.pair += w * ((Eq > 1022 ? interpLogLog(t.E, null, t.pair_n, Eq) : 0) + (Eq > 2044 ? interpLogLog(t.E, null, t.pair_e, Eq) : 0));
    });
    out.total = out.coh + out.incoh + out.photo + out.pair;
    return out;
  }
  // Klein–Nishina distribution of the electron recoil energy T (keV) for photon energy E (keV), per keV, normalised
  function knShape(E, T) {
    var e = E / ME, s = T / E, tmax = 2 * e / (1 + 2 * e);
    if (s <= 0 || s >= tmax) return 0;
    return 2 + s * s / (e * e * (1 - s) * (1 - s)) + s / (1 - s) * (s - 2 / e);
  }
  function knTotal(E) {                   // Klein–Nishina total cross section per electron (units of 2 pi r_e^2)
    var k = E / ME, l = Math.log(1 + 2 * k);
    return (1 + k) / (k * k) * (2 * (1 + k) / (1 + 2 * k) - l / k) + l / (2 * k) - (1 + 3 * k) / ((1 + 2 * k) * (1 + 2 * k));
  }
  function comptonEdge(E) { var e = E / ME; return E * 2 * e / (1 + 2 * e); }
  // Bethe–Heitler (Born, unscreened, relativistic) positron kinetic-energy distribution for photon energy E
  function pairShape(E, Tp) {
    var k = E / ME, Ep = Tp / ME + 1, Em = k - Ep;
    if (Em < 1 || Ep < 1) return 0;
    var v = (Ep * Ep + Em * Em + 2 / 3 * Ep * Em) * (Math.log(2 * Ep * Em / k) - 0.5);
    if (!(v > 0)) {                       // near threshold the Born log fails: fall back to the phase-space shape
      var pp = Math.sqrt(Ep * Ep - 1), pm = Math.sqrt(Em * Em - 1);
      v = 1e-3 * pp * pm * Ep * Em;
    }
    return v;
  }
  function kalpha(Z) { return 10.2e-3 * (Z - 1) * (Z - 1) * (1 + 0.5 * Math.pow(ALPHA * Z, 2)); }   // keV (Moseley, relativistic tweak)
  function fluorYieldK(Z) { var a = 0.015 + 0.0327 * Z - 0.64e-6 * Z * Z * Z, a4 = Math.pow(a, 4); return a4 / (1 + a4); }   // Bambynek et al. fit
  /* Deposited-energy spectrum for one photon interaction.
     opts: {E, comp, xcom, edges: {El: K-edge keV}, Zof: {El: Z}, pesc: probability that a secondary photon escapes
            (1 = thin detector, 0 = infinite), fwhm662: keV, bin: keV}
     Returns {grid, components: {name: Float64Array per keV}, fractions, lines, formula data} */
  function gammaSpectrum(o) {
    var E = o.E, mu = xcomMaterial(o.xcom, o.comp, E), act = mu.incoh + mu.photo + mu.pair;
    var fC = mu.incoh / act, fP = mu.photo / act, fX = mu.pair / act, pe = o.pesc;
    var bin = o.bin || Math.max(0.1, E / 2000), n = Math.ceil(E * 1.05 / bin) + 1, grid = new Float64Array(n);
    for (var i = 0; i < n; i++) grid[i] = (i + 0.5) * bin;
    var comps = {}, lines = [];
    function arr() { return new Float64Array(n); }
    function sig(Ex) { if (!o.fwhm662) return 0; return o.fwhm662 / 2.3548 * Math.sqrt(Math.max(Ex, 1) / 662); }
    function addLine(a, Ex, w) {          // a line of weight w at Ex (keV), smeared if a resolution is given
      if (w <= 0 || Ex < 0) return;
      var s = sig(Ex);
      if (s < bin / 2) { var k = Math.floor(Ex / bin); if (k >= 0 && k < n) a[k] += w / bin; return; }
      for (var j = 0; j < n; j++) { var z = (grid[j] - Ex) / s; if (Math.abs(z) < 6) a[j] += w * Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI)); }
    }
    function smearCont(src) {
      if (!o.fwhm662) return src;
      var out = arr();
      for (var j = 0; j < n; j++) { if (!src[j]) continue; addLine(out, grid[j], src[j] * bin); }
      return out;
    }
    // Compton: electron recoil (KN); the scattered photon escapes with probability pesc, else full energy
    var cont = arr(), tm = comptonEdge(E), nrm = 0, j;
    for (j = 0; j < n; j++) { var v = knShape(E, grid[j]); cont[j] = v; nrm += v * bin; }
    var comp = arr();
    for (j = 0; j < n; j++) comp[j] = nrm > 0 ? fC * pe * cont[j] / nrm : 0;
    comps.compton = smearCont(comp);
    // photoelectric: dominant absorber's K shell; X-ray escapes with probability omega_K * pesc
    var dom = null, best = 0;
    Object.keys(mu.photoBy).forEach(function (el) { if (mu.photoBy[el] > best) { best = mu.photoBy[el]; dom = el; } });
    var BK = dom && o.edges && o.edges[dom] && E > o.edges[dom] ? o.edges[dom] : 0, Zd = dom && o.Zof ? o.Zof[dom] : 0;
    var pK = BK ? 0.8 : 0, omega = BK ? fluorYieldK(Zd) : 0, xesc = pK * omega * pe, EKa = BK ? Math.min(kalpha(Zd), BK) : 0;
    var full = arr(), xe = arr(), pairD = arr();
    addLine(full, E, fP * (1 - xesc) + fC * (1 - pe));
    if (xesc > 0) { addLine(xe, E - EKa, fP * xesc); lines.push({ name: 'K X-ray escape (' + dom + ')', E: E - EKa, w: fP * xesc }); }
    // pair production: e+ e- share E - 1022 keV; each annihilation photon escapes with probability pesc
    if (fX > 0) {
      addLine(pairD, E - 2 * ME, fX * pe * pe); addLine(pairD, E - ME, fX * 2 * pe * (1 - pe)); addLine(full, E, fX * (1 - pe) * (1 - pe));
      lines.push({ name: 'double escape', E: E - 2 * ME, w: fX * pe * pe }, { name: 'single escape', E: E - ME, w: fX * 2 * pe * (1 - pe) });
    }
    lines.unshift({ name: 'full-energy peak', E: E, w: fP * (1 - xesc) + fC * (1 - pe) + fX * (1 - pe) * (1 - pe) });
    comps.full = full; comps.xray = xe; comps.pair = pairD;
    // photoelectron line itself (E - B_K): what a detector sees when the atomic relaxation escapes entirely
    var photoe = { E: E - BK, w: fP };
    // positron kinetic-energy distribution (one particle) for pair events, normalised to fX
    var pos = arr();
    if (fX > 0) {
      var s2 = 0, T2 = E - 2 * ME;
      for (j = 0; j < n; j++) { if (grid[j] < T2) { pos[j] = pairShape(E, grid[j]); s2 += pos[j] * bin; } }
      for (j = 0; j < n; j++) pos[j] = s2 > 0 ? fX * pos[j] / s2 : 0;
    }
    comps.positron = pos;
    var total = arr();
    ['compton', 'full', 'xray', 'pair'].forEach(function (k) { for (var q = 0; q < n; q++) total[q] += comps[k][q]; });
    comps.total = total;
    // electrons set in motion (for Cherenkov): Compton recoils, photoelectrons, both pair leptons
    var elec = arr();
    for (j = 0; j < n; j++) elec[j] = nrm > 0 ? fC * cont[j] / nrm : 0;
    var kp = Math.floor((E - BK) / bin); if (kp >= 0 && kp < n) elec[kp] += fP / bin;
    for (j = 0; j < n; j++) elec[j] += 2 * pos[j];
    return { grid: grid, bin: bin, comps: comps, lines: lines, mu: mu, fractions: { compton: fC, photo: fP, pair: fX, coherent: mu.coh / mu.total },
             edge: tm, backscatter: E / (1 + 2 * E / ME), photoelectron: photoe, dominant: dom, BK: BK, omegaK: omega, EKa: EKa, electrons: elec };
  }

  /* ================================================================ ALPHA */
  // nuclear mass (keV) from mass excess (keV): atomic mass minus Z electrons (binding of electrons neglected)
  function nucMass(A, Z, massExcess) { return A * AMU + massExcess - Z * ME; }
  // two-body decay M -> m_alpha + m_d (+ Ex): exact relativistic kinetic energies
  function alphaKinematics(Q, Ex, Md) {
    var Mdx = Md + Ex, M = Md + MALPHA_KEV + Q;            // parent nuclear mass
    if (Q - Ex <= 0) return null;
    var Ea = (M * M + MALPHA_KEV * MALPHA_KEV - Mdx * Mdx) / (2 * M);
    var Ta = Ea - MALPHA_KEV, Tr = (Q - Ex) - Ta;
    var Tnr = (Q - Ex) * Mdx / (Mdx + MALPHA_KEV);          // non-relativistic, for comparison
    return { Ta: Ta, Tr: Tr, Tnr: Tnr };
  }

  // a particle of mass m emitted with kinetic energy Tstar in the rest frame of a parent of mass Mp that moves with kinetic
  // energy Tp in the lab: E_lab = gamma (E* + beta p* cos theta*), so isotropic emission in the CM frame gives a flat
  // distribution between the two extremes (exact, relativistic)
  function boostRange(Tstar, m, Mp, Tp) {
    if (!(Tp > 0)) return { lo: Tstar, hi: Tstar };
    var g = 1 + Tp / Mp, b = Math.sqrt(1 - 1 / (g * g)), E = Tstar + m, p = Math.sqrt(Math.max(E * E - m * m, 0));
    return { lo: g * (E - b * p) - m, hi: g * (E + b * p) - m };
  }
  /* ================================================================ (alpha,n) */
  function jpText(s) {                   // TALYS "1.5+" -> "3/2+"
    var m = /^(-?[\d.]+)\s*([+-]?)$/.exec(String(s || '').trim()); if (!m) return s || '';
    var J = parseFloat(m[1]), h = Math.round(2 * J);
    return (h % 2 ? h + '/2' : String(h / 2)) + m[2];
  }
  // isotropic CM emission: lab neutron energy uniform between Emin and Emax (non-relativistic two-body kinematics)
  function anKinematics(Ea, Q, Ex, ma, mT, mn, mR) {     // energies MeV, masses in u
    var Qp = Q - Ex, Ecm = Ea * mT / (ma + mT);
    if (Ecm + Qp <= 0) return null;
    var Ecmn = (mR / (mn + mR)) * (Ecm + Qp);               // neutron energy in the CM frame
    var Ev = 0.5 * mn * (2 * ma * Ea / Math.pow(ma + mT, 2)); // kinetic energy of a neutron moving with the CM: 1/2 mn V^2, V^2 = 2 ma Ea / (ma+mT)^2
    var a = Math.sqrt(Ecmn), b = Math.sqrt(Ev);
    return { Emin: Math.pow(a - b, 2), Emax: Math.pow(a + b, 2), E0deg: Math.pow(a + b, 2), Ecmn: Ecmn, Ev: Ev };
  }
  function stoppingAt(tab, E) {          // tab: [[E MeV, S MeV cm2/g], ...]
    if (E <= tab[0][0]) return tab[0][1] * Math.sqrt(E / tab[0][0]);
    var lo = 0, hi = tab.length - 1;
    if (E >= tab[hi][0]) return tab[hi][1];
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (tab[m][0] <= E) lo = m; else hi = m; }
    return tab[lo][1] + (tab[hi][1] - tab[lo][1]) * (E - tab[lo][0]) / (tab[hi][0] - tab[lo][0]);
  }
  /* Thick-target neutron spectrum per alpha.
     o: {alphas: [[E MeV, weight]], targets: [{key, nAtomsPerGram, data (per-target JSON), label}], stopping: S(E) MeV cm2/g,
         thin: optional {E: MeV, arealDensity g/cm2} for a thin target instead, dE: MeV (neutron bin), Emax}
     Returns {E: bin centres, total (NeuCBOT/TALYS spectrum), partial: [{label, values}], yield, perTarget} */
  function alphaNSpectrum(o) {
    var dEn = o.dE || 0.1, nb = Math.ceil((o.Emax || 12) / dEn), En = new Float64Array(nb);
    for (var i = 0; i < nb; i++) En[i] = (i + 0.5) * dEn;
    var total = new Float64Array(nb), partial = {}, perTarget = {}, yieldTot = 0, step = 0.01;
    var mn = MN_KEV / AMU, ma = MALPHA_KEV / AMU + 2 * ME / AMU;   // atomic masses in u (TALYS uses atomic masses)
    ma = 4.002603;
    o.targets.forEach(function (t) {
      var d = t.data, grid = d.levelsGrid || null, Q = d.Q_MeV, mT = d.mass_u, mR = mT + ma - mn - Q / (AMU / 1000);
      var yT = 0;
      function xsAt(arr, E) {               // arrays on the 0.1 MeV grid starting at 0.1 MeV
        var x = E / 0.1 - 1, k = Math.floor(x); if (k < 0) return x > -1 ? arr[0] * (x + 1) : 0;
        if (k >= arr.length - 1) return arr[arr.length - 1];
        return arr[k] + (arr[k + 1] - arr[k]) * (x - k);
      }
      function specAt(E) {                  // TALYS neutron spectrum (mb/MeV) at alpha energy E: nearest grid points, interpolated
        var x = E / 0.1 - 1, k = Math.max(0, Math.min(d.nspec.spectra.length - 2, Math.floor(x))), f = Math.max(0, Math.min(1, x - k));
        return [d.nspec.spectra[k], d.nspec.spectra[k + 1], f];
      }
      function addSpec(weight, E) {         // add weight * TALYS spectrum at E (normalised to the TALYS total sigma)
        var s = specAt(E), e0 = d.nspec.E0, de = d.nspec.dE;
        [[s[0], 1 - s[2]], [s[1], s[2]]].forEach(function (pair) {
          var sp = pair[0], f = pair[1]; if (!sp || sp.length < 2 || f <= 0) return;
          var sum = 0; for (var q = 1; q < sp.length; q++) sum += sp[q] * de;
          if (sum <= 0) return;
          var sig = xsAt(d.total, E), scale = weight * f * sig / sum;   // renormalise the shape to sigma_total(E)
          for (q = 1; q < sp.length; q++) {   // spread each TALYS bin over the output bins it overlaps
            var Ec = e0 + (sp[0] + q - 1) * de, lo = Ec - de / 2, hi = Ec + de / 2;
            for (var b = Math.max(0, Math.floor(lo / dEn)); b <= Math.min(nb - 1, Math.floor(hi / dEn)); b++) {
              var ov = Math.min(hi, (b + 1) * dEn) - Math.max(lo, b * dEn);
              if (ov > 0) total[b] += scale * sp[q] * ov / dEn;
            }
          }
        });
      }
      function addLevels(weight, E) {
        d.levels.forEach(function (L) {
          var sig = xsAt(L.xs, E); if (sig <= 0) return;
          var k = anKinematics(E, Q, L.Ex / 1000, ma, mT, mn, mR); if (!k) return;
          var jp = jpText(L.jp), key = t.label + ' → ' + d.residual + (L.Ex > 0 ? ' (' + (L.Ex / 1000).toFixed(3) + ' MeV' + (jp ? ', ' + jp : '') + ')' : ' (ground state' + (jp ? ', ' + jp : '') + ')');
          var arr = partial[key] || (partial[key] = { label: key, Ex: L.Ex, target: t.key, values: new Float64Array(nb) });
          var w = weight * sig, lo = k.Emin, hi = k.Emax, width = Math.max(hi - lo, 1e-6);
          var b0 = Math.floor(lo / dEn), b1 = Math.min(nb - 1, Math.floor(hi / dEn));
          for (var b = b0; b <= b1; b++) {
            var l = Math.max(lo, b * dEn), h = Math.min(hi, (b + 1) * dEn);
            if (h > l) arr.values[b] += w * (h - l) / width / dEn;
          }
        });
      }
      if (o.thin) {                         // thin target: yield per alpha per (g/cm2)
        var w = t.nAtomsPerGram * o.thin.arealDensity * 1e-27;
        addSpec(w, o.thin.E); addLevels(w, o.thin.E); yT = w * xsAt(d.total, o.thin.E);
      } else {
        o.alphas.forEach(function (al) {
          for (var E = step / 2; E < al[0]; E += step) {
            var S = o.stopping(E); if (!(S > 0)) continue;
            var w = al[1] * t.nAtomsPerGram * 1e-27 * step / S;   // n_atoms/g * cm^2/mb * MeV / (MeV cm^2/g)
            addSpec(w, E); addLevels(w, E); yT += w * xsAt(d.total, E);
          }
        });
      }
      perTarget[t.key] = yT; yieldTot += yT;
    });
    var parts = Object.keys(partial).map(function (k) { return partial[k]; }).filter(function (p) {
      var s = 0; for (var q = 0; q < nb; q++) s += p.values[q]; p.sum = s * dEn; return s > 0;
    }).sort(function (a, b) { return b.sum - a.sum; });
    return { E: En, dE: dEn, total: total, partial: parts, yield: yieldTot, perTarget: perTarget };
  }

  /* ================================================================ BETA */
  // Wilkinson (1990) coefficients b[x][n] for L0, electrons and positrons (Hayen et al. Tables I and II), rows a_-1, a_0 ... a_5
  var L0E = [[0.115, -1.8123, 8.2498, -11.223, -14.854, 32.086], [-0.00062, 0.007165, 0.01841, -0.53736, 1.2691, -1.5467],
    [0.02482, -0.5975, 4.84199, -15.3374, 23.9774, -12.6534], [-0.14038, 3.64953, -38.8143, 172.1368, -346.708, 288.7873],
    [0.008152, -1.15664, 49.9663, -273.711, 657.6292, -603.7033], [1.2145, -23.9931, 149.9718, -471.2985, 662.1909, -305.6804],
    [-1.5632, 33.4192, -255.1333, 938.5297, -1641.2845, 1095.358]];
  var L0P = [[0.0701, -2.572, 27.5971, -128.658, 272.264, -214.925], [-0.002308, 0.066463, -0.6407, 2.63606, -5.6317, 4.0011],
    [0.07936, -2.09284, 18.45462, -80.9375, 160.8384, -124.8927], [-0.93832, 22.02513, -197.00221, 807.1878, -1566.6077, 1156.3287],
    [4.276181, -96.82411, 835.26505, -3355.8441, 6411.3255, -4681.573], [-8.2135, 179.0862, -1492.1295, 5872.5362, -11038.7299, 7963.4701],
    [5.4583, -115.8922, 940.8305, -3633.9181, 6727.6296, -4795.0481]];
  // exchange-correction fit (Hayen et al. Table X): Z -> [a b c d e f g h i]
  var EXCH = null;                       // filled from signals-exchange.js (kept separate: it is a long table)

  function betaContext(p) {
    // p: {Z (daughter, positive), A, beta: -1 | +1, W0 (total endpoint energy, me units), rrms (fm), Zp (parent), ...}
    var c = Object.assign({}, p);
    c.aZ = ALPHA * c.Z; c.g1 = Math.sqrt(1 - c.aZ * c.aZ);
    c.rrms = c.rrms || (0.836 * Math.pow(c.A, 1 / 3) + 0.570);   // Elton-type estimate, fm
    c.R = Math.sqrt(5 / 3) * c.rrms / HBARC_FM;                 // uniform-sphere radius, natural units
    c.Lam = Math.sqrt(6) / (c.rrms / HBARC_FM);                  // Sirlin's Lambda
    c.M = c.Mnuc || c.A * MNUC;                                  // nuclear mass, me units
    c.rho = c.rho == null ? 0 : c.rho;
    return c;
  }
  function F0(c, W) {                    // point-charge Fermi function (Hayen eq. 6)
    var p = Math.sqrt(W * W - 1), g = c.g1, y = -c.beta * c.aZ * W / p;   // beta = -1 for beta-minus -> y > 0
    var l = Math.log(4) + 2 * (g - 1) * Math.log(2 * p * c.R) + Math.PI * y + lgAbs2(g, y) - 2 * lgammaR(1 + 2 * g);
    return Math.exp(l);
  }
  function Fk(c, W, k) {                 // generalised Fermi function F_{k-1} (Behrens–Jänecke)
    var p = Math.sqrt(W * W - 1), gk = Math.sqrt(k * k - c.aZ * c.aZ), y = -c.beta * c.aZ * W / p;
    var l = 2 * Math.log(k * dfact(2 * k - 1)) + k * Math.log(4) + 2 * (gk - k) * Math.log(2 * p * c.R) + Math.PI * y + lgAbs2(gk, y) - 2 * lgammaR(1 + 2 * gk);
    return Math.exp(l);
  }
  function lambdaK(c, W, k) {
    if (k === 1) return 1;
    var gk = Math.sqrt(k * k - c.aZ * c.aZ);
    return Fk(c, W, k) / Fk(c, W, 1) * (k + gk) / (k * (1 + c.g1));
  }
  function L0(c, W) {                    // electrostatic finite-size correction (Wilkinson, Hayen eq. 16)
    var s = c.beta < 0 ? 1 : -1, g = c.g1, aZ = c.aZ, R = c.R, tab = c.beta < 0 ? L0E : L0P, a = [];
    for (var n = 0; n < 7; n++) { var v = 0; for (var x = 0; x < 6; x++) v += tab[n][x] * Math.pow(aZ, x + 1); a.push(v); }
    var r = 1 + 13 / 60 * aZ * aZ - s * aZ * W * R * (41 - 26 * g) / (15 * (2 * g - 1)) - s * aZ * R * g * (17 - 2 * g) / (30 * W * (2 * g - 1));
    r += a[0] * R / W;
    for (n = 0; n <= 5; n++) r += a[n + 1] * Math.pow(W * R, n);
    r += (c.beta < 0 ? 0.41 : 0.22) * (R - 0.0164) * Math.pow(aZ, 4.5);
    return r;
  }
  function Ucorr(c, W) {                 // diffuse nuclear surface (Wilkinson, Fermi distribution; Hayen eqs. 29–30)
    var p = Math.sqrt(W * W - 1), s = c.beta < 0 ? 1 : -1, Z = c.Z;
    var a0 = -5.6e-5 - s * 4.94e-5 * Z + 6.23e-8 * Z * Z, a1 = 5.17e-6 + s * 2.517e-6 * Z + 2.00e-8 * Z * Z, a2 = -9.17e-8 + s * 5.53e-9 * Z + 1.25e-10 * Z * Z;
    return 1 + a0 + a1 * p + a2 * p * p;
  }
  function shapeVector(c, W) {           // Hayen eq. 100–101
    var s = c.beta < 0 ? 1 : -1, aZ = c.aZ, R = c.R, W0 = c.W0;
    var C0 = -233 / 630 * aZ * aZ - 0.2 * Math.pow(W0 * R, 2) - s * 6 / 35 * aZ * W0 * R;
    var C1 = -s * 13 / 35 * aZ * R + 4 / 15 * W0 * R * R, Cm1 = 2 / 15 * W0 * R * R + s / 70 * aZ * R, C2 = -4 / 15 * R * R;
    return 1 + C0 + C1 * W + Cm1 / W + C2 * W * W;
  }
  function shapeAxial(c, W, withWM) {    // Hayen eq. 105–106 (induced pseudoscalar term omitted); b, d as b/Ac, d/Ac
    var s = c.beta < 0 ? 1 : -1, aZ = c.aZ, R = c.R, W0 = c.W0, Lm = c.Lambda || 0;
    var bM = withWM ? (c.bAc || 0) / MNUC : 0, dM = withWM ? (c.dAc || 0) / MNUC : 0;   // b/(M c1) with M = A M_N
    var C0 = -0.2 * Math.pow(W0 * R, 2) + 4 / 9 * R * R * (1 - Lm / 20) + 1 / 3 * W0 * (-s * 2 * bM + dM)
      + s * 2 / 5 * aZ / R * (s * 2 * bM + dM) + s * 2 / 35 * aZ * W0 * R * (1 - Lm) - 233 / 630 * aZ * aZ;
    var C1 = s * 4 / 3 * bM + 4 / 9 * W0 * R * R * (1 - Lm / 10) - s * 4 / 7 * aZ * R * (1 - Lm / 10);
    var Cm1 = -1 / 3 * (s * 2 * bM + dM) - 2 / 45 * W0 * R * R * (1 - Lm) - s * aZ * R / 70;
    var C2 = -4 / 9 * R * R * (1 - Lm / 10);
    return 1 + C0 + C1 * W + Cm1 / W + C2 * W * W;
  }
  function RN(c, W) {                    // kinematic recoil (Hayen eqs. 41–44)
    var M = c.M, W0 = c.W0, M2 = M * M;
    var V = [W0 * W0 / (2 * M2) - 11 / (6 * M2), W0 / (3 * M2), 2 / M - 4 * W0 / (3 * M2), 16 / (3 * M2)];
    var A = [-2 * W0 / (3 * M) - W0 * W0 / (6 * M2) - 77 / (18 * M2), -2 / (3 * M) + 7 * W0 / (9 * M2), 10 / (3 * M) - 28 * W0 / (9 * M2), 88 / (9 * M2)];
    var fF = 1 / (1 + c.rho * c.rho), fG = 1 - fF;
    var r = [0, 1, 2, 3].map(function (k) { return fF * V[k] + fG * A[k]; });
    return 1 + r[0] + r[1] / W + r[2] * W + r[3] / (W * W);
  }
  function Qcorr(c, W) {                 // Coulomb recoil (Hayen eq. 45)
    var p = Math.sqrt(W * W - 1), s = c.beta < 0 ? 1 : -1, a = (1 - c.rho * c.rho / 3) / (1 + c.rho * c.rho);
    return 1 - s * Math.PI * c.aZ / c.M / p * (1 + a * (c.W0 - W) / (3 * W));
  }
  function gSirlin(W0, W, repkoWu) {     // Sirlin's g (Hayen eq. 50), with the Repko–Wu endpoint resummation (eq. 53)
    var p = Math.sqrt(W * W - 1), b = p / W, at = 0.5 * Math.log((1 + b) / (1 - b));
    var g = 3 * Math.log(MP) - 0.75 + 4 / b * (-li2(2 * b / (1 + b))) + 4 * (at / b - 1) * ((W0 - W) / (3 * W) - 1.5 + Math.log(2) + (repkoWu ? 0 : Math.log(W0 - W)))
      + at / b * (2 * (1 + b * b) + Math.pow(W0 - W, 2) / (6 * W * W) - 4 * at);
    return { g: g, t: 2 * ALPHA / Math.PI * (at / b - 1) };
  }
  function radiative(c, W, opt) {        // outer radiative correction 1 + delta_R (Hayen eqs. 48–69)
    var W0 = c.W0; if (W >= W0) W = W0 - 1e-9;
    var gs = gSirlin(W0, W, true);
    var d1 = ALPHA / (2 * Math.PI) * (gs.g - 3 * Math.log(MP / (2 * W0))) + (Math.pow(W0 - W, gs.t) - 1);
    var out = 1 + d1;
    if (opt.o2) {
      var s = c.beta < 0 ? 1 : -1, L = 1.026725 * Math.pow(1 - 2 * ALPHA / (3 * Math.PI) * Math.log(2 * W0), 4.5 / 2);
      var Lam = c.Lam, MN = MNUC, r10 = Math.sqrt(10), k2 = 0.395, gA = 1.27, gM = 4.706;
      var D14 = Math.log(MN) - 5 / 3 * Math.log(2 * W) + 43 / 18;
      var DF1 = Math.log(Lam / MN) - k2 - 3 / (r10 * Math.PI) * Lam / MN * (0.5 + GAMMA_E + Math.log(r10) + Math.log(MN / Lam));
      var D2 = 3 / (2 * r10 * Math.PI) * Lam / MN * (1 - Math.PI / (2 * r10) * Lam / MN);
      var D3 = 3 / (r10 * Math.PI) * gA * gM * Lam / MN * (GAMMA_E - 1 + Math.log(r10) + Math.log(MN / Lam) + Math.PI / (4 * r10) * Lam / MN);
      var d2 = s * c.Z * ALPHA * ALPHA * (D14 + DF1 + D2 + D3);
      var d3 = 0;
      if (opt.o3) {
        var R = c.R, a = Math.PI / 3 - 3 / (2 * Math.PI), bb = 4 / (3 * Math.PI) * (11 / 4 - GAMMA_E - Math.PI * Math.PI / 6);
        var f = Math.log(2 * W) - 5 / 6, gW = 0.5 * (Math.pow(Math.log(R), 2) - Math.pow(Math.log(2 * W), 2)) + 5 / 3 * Math.log(2 * R * W);
        d3 = c.Z * c.Z * Math.pow(ALPHA, 3) * (a * Math.log(Lam / W) + bb * f + 4 * Math.PI / 3 * gW - 0.649 * Math.log(2 * W0));
        var d34 = s * Math.pow(c.Z, 3) * Math.pow(ALPHA, 4) * 0.5 * Math.log(Lam / W);
        d3 += d34 / (1 - c.Z * ALPHA);
      }
      out = (1 + d1 - (Math.pow(W0 - W, gs.t) - 1)) * (L + d2 + d3) + (Math.pow(W0 - W, gs.t) - 1);
      out = out / L;                       // the energy-independent short-distance factor drops out of the shape; keep the spectrum O(1)
    }
    return out;
  }
  function screening(c, W) {             // Bühring (1984) with X = 1 and V0 = 1.45 alpha^2 Zp^(4/3) (Hayen eqs. 144–146)
    var p = Math.sqrt(W * W - 1), Zp = c.Zp || (c.beta < 0 ? c.Z - 1 : c.Z + 1);
    var V0 = (c.N_screen || 1.45) * ALPHA * ALPHA * Math.pow(Zp, 4 / 3), lam = 2 * V0 / c.aZ, s = c.beta < 0 ? 1 : -1;
    var Wt = W - s * 0.5 * c.aZ * lam, disc = p * p - s * 2 * c.aZ * Wt * lam;
    if (Wt <= 1 || disc < 0) {           // below ~V0 the prescription is undefined: continue it flat from where it starts to hold
      if (c._sLow == null) { var Wl = 1 + V0; for (var it = 0; it < 200; it++) { Wl += 2e-4; var pl = Math.sqrt(Wl * Wl - 1), Wtl = Wl - s * V0; if (Wtl > 1 && pl * pl - s * 2 * c.aZ * Wtl * lam >= 0) break; } c._sLow = Wl; }
      return W < c._sLow ? screening(c, c._sLow + 1e-9) : 1;
    }
    var pt = 0.5 * p + 0.5 * Math.sqrt(disc), g = c.g1, y = -c.beta * c.aZ * W / p, yt = -c.beta * c.aZ * Wt / pt;
    var l = lgAbs2(g, yt) - lgAbs2(g, y) + lgAbs2(g, 2 * pt / lam) - lgAbs2(1, 2 * p / lam) - Math.PI * y + 2 * (1 - g) * Math.log(2 * p / lam);
    return (Wt / W) * Math.exp(l);
  }
  function exchange(c, W) {              // atomic exchange, beta-minus only (Hayen eq. 157, Table X)
    if (c.beta > 0 || !EXCH) return 1;
    var t = EXCH[c.Z]; if (!t) return 1;
    var Wp = W - 1, base = W - t[5], pw = base >= 0 ? Math.pow(base, t[6]) : -Math.pow(-base, t[6]);
    return 1 + t[0] / Wp + t[1] / (Wp * Wp) + t[2] * Math.exp(-t[3] * Wp) + t[4] * Math.sin(pw + t[7]) / Math.pow(W, t[8]);
  }
  function mismatch(c, W) {              // atomic mismatch (Hayen eqs. 166–167)
    var Z = c.Z, d2B = (44.200 * Math.pow(Z, 0.41) + 2.3196e-7 * Math.pow(Z, 4.45)) * 1e-3 / ME;   // eV -> me
    var r = 1 - d2B / Math.max(c.W0 - W, 1e-12);
    return Math.max(r, 0);
  }
  /* Spectrum of one branch.
     p: {Z, A, beta, T0 (keV endpoint), rrms, Zp, kind: 'A' (allowed) | 'U' (unique) | 'NU', k (forbiddenness),
         rho (GT/F mixing; Infinity = pure GT), bAc, dAc, Lambda, fierz, mnu (eV), msterile (keV), Usterile2,
         shape: {a, b, c} empirical C = 1 + a W + b/W + c W^2, corr: {L0, U, C, WM, rad, o2, o3, RN, Q, S, X, r, lambda},
         n: number of points}
     Returns {T: keV grid, dNdT: per keV per decay, factors: {name: array}} */
  function betaSpectrum(p) {
    var corr = p.corr || {}, n = p.n || 400, T0 = p.T0, W0 = T0 / ME + 1;
    var rho = p.rho === Infinity || p.rho === 'inf' ? 1e6 : (p.rho || 0);
    var c = betaContext(Object.assign({}, p, { W0: W0, rho: rho }));
    var T = new Float64Array(n), out = new Float64Array(n), fac = {};
    var names = ['F0', 'L0', 'U', 'C', 'R', 'RN', 'Q', 'S', 'X', 'r', 'shape', 'fierz'];
    names.forEach(function (k) { fac[k] = new Float64Array(n); });
    var mnu = (p.mnu || 0) / 1000 / ME, ms = (p.msterile || 0) / ME, U2 = p.Usterile2 || 0;
    var wF = 1 / (1 + rho * rho), wG = 1 - wF;
    for (var i = 0; i < n; i++) {
      var Tk = T0 * (i + 0.5) / n, W = Tk / ME + 1, pp = Math.sqrt(W * W - 1), q0 = W0 - W;
      T[i] = Tk;
      var f = {};
      f.F0 = F0(c, W);
      f.L0 = corr.L0 ? L0(c, W) : 1;
      f.U = corr.U ? Ucorr(c, W) : 1;
      f.C = corr.C ? (wF * shapeVector(c, W) + wG * shapeAxial(c, W, !!corr.WM)) : (corr.WM ? (wF + wG * (1 + (c.beta < 0 ? 1 : -1) * 4 / 3 * (p.bAc || 0) / MNUC * W)) : 1);
      f.R = corr.rad ? radiative(c, W, { o2: !!corr.o2, o3: !!corr.o3 }) : 1;
      f.RN = corr.RN ? RN(c, W) : 1;
      f.Q = corr.Q ? Qcorr(c, W) : 1;
      f.S = corr.S ? screening(c, W) : 1;
      f.X = corr.X ? exchange(c, W) : 1;
      f.r = corr.r ? mismatch(c, W) : 1;
      // forbidden shape factor (lepton momenta); q = neutrino momentum (massless here, mass handled in phase space)
      var sh = 1;
      if (p.kind === 'U' && p.k >= 1) {
        var K = p.k + 1, sum = 0;
        for (var m = 1; m <= K; m++) {
          var lam = corr.lambda === false ? 1 : lambdaK(c, W, m);
          sum += lam * Math.pow(pp, 2 * (m - 1)) * Math.pow(q0, 2 * (K - m)) / (fact(2 * m - 1) * fact(2 * (K - m) + 1));
        }
        sh = sum * fact(2 * K - 1);         // arbitrary normalisation
      }
      if (p.shape) sh *= 1 + (p.shape.a || 0) * W + (p.shape.b || 0) / W + (p.shape.c || 0) * W * W;
      f.shape = sh;
      f.fierz = p.fierz ? 1 + p.fierz * c.g1 / W : 1;
      // phase space with neutrino masses: active (light) and sterile admixture
      function ps(mv) { return q0 > mv ? pp * W * q0 * Math.sqrt(q0 * q0 - mv * mv) : 0; }
      var phase = U2 > 0 ? (1 - U2) * ps(mnu) + U2 * ps(ms) : ps(mnu);
      var v = phase;
      names.forEach(function (k) { fac[k][i] = f[k]; v *= f[k]; });
      out[i] = Math.max(v, 0);
    }
    var s = 0; for (i = 0; i < n; i++) s += out[i] * T0 / n;
    for (i = 0; i < n; i++) out[i] = s > 0 ? out[i] / s : 0;
    return { T: T, dNdT: out, factors: fac, ctx: c, mean: (function () { var m = 0; for (var k = 0; k < n; k++) m += T[k] * out[k] * T0 / n; return m; })() };
  }
  // ENSDF transition type -> {kind, k}; or derive from spins/parities
  function forbiddenness(type, Ji, Pi, Jf, Pf) {
    var t = (type || '').toUpperCase().trim(), m = /^(\d)(U|NU)$/.exec(t);
    if (t === 'A' || t === 'SA') return { kind: 'A', k: 0, from: 'ENSDF' };
    if (m) return { kind: m[2] === 'U' ? 'U' : 'NU', k: +m[1], from: 'ENSDF' };
    if (Ji == null || Jf == null || !Pi || !Pf) return null;
    var dJ = Math.abs(Ji - Jf), dP = Pi === Pf ? 0 : 1;      // parity change
    if (dP === 0 && dJ <= 1 && !(Ji === 0 && Jf === 0 && false)) return { kind: 'A', k: 0, from: 'spins', dJ: dJ, dP: dP };
    // k-th forbidden: parity change (-1)^k; unique if dJ = k + 1
    var k = dJ <= 1 ? (dP ? 1 : 2) : (dJ % 2 === 1 ? (dP ? dJ - 1 : dJ) : (dP ? dJ - 1 : dJ));
    if (dJ >= 2 && ((dJ - 1) % 2 === 1) === (dP === 1)) return { kind: 'U', k: dJ - 1, from: 'spins', dJ: dJ, dP: dP };
    return { kind: 'NU', k: Math.max(1, k), from: 'spins', dJ: dJ, dP: dP };
  }
  function parseJP(s) {                  // "5/2+" -> {J: 2.5, P: '+'}; "(3/2-)" etc.; null if unknown
    if (!s) return null;
    var m = /(\d+)(?:\/(\d))?\s*([+-])/.exec(String(s).replace(/[()\[\]]/g, ''));
    if (!m) return null;
    return { J: m[2] ? +m[1] / +m[2] : +m[1], P: m[3], tentative: /[()]/.test(s) };
  }
  function fierzFromCouplings(rho, CS, CT, beta) {    // Hayen eq. 1 (couplings relative to C_V, C_A)
    return (beta < 0 ? 1 : -1) / (1 + rho * rho) * ((CS || 0) + rho * rho * (CT || 0));
  }

  /* ================================================================ CHERENKOV */
  function sellmeier(B, C, lamNm) {       // n(lambda), C in um^2
    var l2 = Math.pow(lamNm / 1000, 2), s = 1;
    for (var i = 0; i < B.length; i++) s += B[i] * l2 / (l2 - C[i]);
    return Math.sqrt(Math.max(s, 1));
  }
  // electron collision stopping power (ICRU 37 Bethe formula, no density effect) + approximate radiative term, MeV cm2/g
  function electronStopping(Tkev, ZA, IeV, Zeff) {
    var tau = Tkev / ME, g = tau + 1, b2 = 1 - 1 / (g * g), Ir = IeV / (ME * 1e3);
    var F = 1 - b2 + (tau * tau / 8 - (2 * tau + 1) * Math.LN2) / ((tau + 1) * (tau + 1));
    var Sc = 0.153537 * ZA / b2 * (Math.log(tau * tau * (tau + 2) / (2 * Ir * Ir)) + F);
    var Sr = Sc * (Zeff || 7) * (Tkev / 1000 + 0.511) / 800;
    return Math.max(Sc, 1e-6) + Sr;
  }
  /* photons per nm per primary electron of kinetic energy T, integrated along its slowing down, for each lambda
     m: {n(lambda), rho g/cm3, ZA, I eV, Zeff}; lam: wavelengths (nm). Returns function of T via a cumulative table. */
  function cherenkovTable(m, lam, Tmax) {
    var nT = 600, dT = Tmax / nT, tab = [], cum = lam.map(function () { return 0; });
    tab.push(cum.slice());
    var nl = lam.map(function (l) { return m.n(l); });
    for (var i = 0; i < nT; i++) {
      var T = (i + 0.5) * dT, g = T / ME + 1, b2 = 1 - 1 / (g * g), S = electronStopping(T, m.ZA, m.I, m.Zeff) * m.rho * 1000;   // keV/cm
      for (var j = 0; j < lam.length; j++) {
        var x = 1 - 1 / (b2 * nl[j] * nl[j]);
        if (x > 0) {
          var lc = lam[j] * 1e-7;                     // cm
          cum[j] += 2 * Math.PI * ALPHA / (lc * lc) * x * 1e-7 * dT / S;   // photons per nm
        }
      }
      tab.push(cum.slice());
    }
    return { dT: dT, tab: tab, nl: nl, threshold: lam.map(function (l, j) { var n = nl[j]; return n > 1 ? ME * (1 / Math.sqrt(1 - 1 / (n * n)) - 1) : Infinity; }) };
  }
  function cherenkovFromSpectrum(table, T, w, dT) {   // w: dN/dT (per keV) of the primaries on grid T
    var nl = table.tab[0].length, out = new Float64Array(nl), tot = 0;
    for (var i = 0; i < T.length; i++) {
      if (!w[i]) continue;
      var x = T[i] / table.dT, k = Math.min(table.tab.length - 1, Math.floor(x)), f = Math.min(1, x - k);
      var r0 = table.tab[k], r1 = table.tab[Math.min(table.tab.length - 1, k + 1)];
      for (var j = 0; j < nl; j++) out[j] += w[i] * dT * (r0[j] + f * (r1[j] - r0[j]));
    }
    return out;
  }

  var api = {
    ME: ME, ALPHA: ALPHA, AMU: AMU, MALPHA_KEV: MALPHA_KEV, HBARC_FM: HBARC_FM, lgammaC: lgammaC, li2: li2,
    interpLogLog: interpLogLog, xcomMaterial: xcomMaterial, knShape: knShape, knTotal: knTotal, comptonEdge: comptonEdge, pairShape: pairShape,
    gammaSpectrum: gammaSpectrum, fluorYieldK: fluorYieldK, kalpha: kalpha,
    nucMass: nucMass, alphaKinematics: alphaKinematics, boostRange: boostRange, anKinematics: anKinematics, stoppingAt: stoppingAt, alphaNSpectrum: alphaNSpectrum,
    betaContext: betaContext, F0: F0, L0: L0, U: Ucorr, shapeVector: shapeVector, shapeAxial: shapeAxial, RN: RN, Q: Qcorr, gSirlin: gSirlin,
    radiative: radiative, screening: screening, exchange: exchange, mismatch: mismatch, lambdaK: lambdaK, betaSpectrum: betaSpectrum,
    forbiddenness: forbiddenness, parseJP: parseJP, fierzFromCouplings: fierzFromCouplings, setExchange: function (t) { EXCH = t; },
    L0E: L0E, L0P: L0P, sellmeier: sellmeier, electronStopping: electronStopping, cherenkovTable: cherenkovTable, cherenkovFromSpectrum: cherenkovFromSpectrum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SignalPhysics = api;
})(this);
