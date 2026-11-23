/* Gamma Line Explorer (beta) — UCR Dark Matter and Neutrino Lab.
   Everything runs in the browser from precomputed data in data/gamma/ (built by tools/gamma/build_gamma_data.py).
   core.json: sources most relevant to low-background work (tiers 1–2, captures, reactions, X-rays, inelastic lines);
   all.json:  every other ENSDF decay with gamma lines (tier 3), loaded on demand.

   Source fields: id, name, kind (decay|capture|inel|rx|xray), tier, hl (s), chain, seg, par, dau, how, where, tests,
   when {env,n,mat,det}, unit, L: [[E keV, I, flags, note]], C: {lineIndex: [[E, P(same cascade)], ...]},
   cosmo (materials), elem (capture/inelastic element), iso (capture isotope breakdown). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmt(x, d) { return x == null ? '' : Number(x).toFixed(d == null ? 1 : d); }
  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', 'm': 'ᵐ' };
  function pretty(n) {                // "214Bi" → "²¹⁴Bi", "110mAg" → "¹¹⁰ᵐAg"
    return String(n).replace(/\b(\d+)(m?)([A-Z][a-z]?)\b/g, function (_, a, m, s) {
      return a.split('').map(function (c) { return SUP[c]; }).join('') + (m ? SUP.m : '') + s;
    });
  }
  function hlText(s) {
    if (s == null) return '';
    if (!isFinite(s)) return 'stable';
    var u = [['y', 31557600], ['d', 86400], ['h', 3600], ['min', 60], ['s', 1], ['ms', 1e-3], ['µs', 1e-6], ['ns', 1e-9]];
    for (var i = 0; i < u.length; i++) if (s >= u[i][1]) {
      var v = s / u[i][1];
      if (u[i][0] === 'y' && v >= 1e5) return v.toExponential(2).replace('e+', '×10^') + ' y';
      return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toPrecision(3)) + ' ' + u[i][0];
    }
    return s.toExponential(1) + ' s';
  }

  /* ------------------------------------------------------------ setup / context */
  var OPTS = {
    det: [['hpge', 'HPGe'], ['nai', 'NaI / CsI'], ['lar', 'Liquid argon'], ['lxe', 'Liquid xenon'], ['plastic', 'Plastic / liquid scintillator']],
    env: [['underground', 'Underground'], ['surface', 'Surface']],
    n: [['ambient', 'Ambient neutrons (rock, cosmic rays)'], ['source', 'Neutron source nearby'], ['reactor', 'Reactor nearby']],
    mat: [['cu', 'Copper'], ['pb', 'Lead'], ['steel', 'Steel'], ['ge', 'Germanium'], ['ar', 'Argon'], ['xe', 'Xenon'], ['nai', 'NaI'],
          ['csi', 'CsI'], ['ti', 'Titanium'], ['al', 'Aluminium'], ['ptfe', 'PTFE'], ['poly', 'Polyethylene'], ['bpoly', 'Borated poly'],
          ['water', 'Water'], ['rock', 'Rock / concrete'], ['glass', 'Borosilicate glass / large PMTs'], ['pmt3', 'Low-background 3″ PMTs'],
          ['acrylic', 'Acrylic'], ['te', 'Tellurium'], ['solder', 'Solder / electronics']]
  };
  var FWHM1MEV = { hpge: 1.6, nai: 55, lar: 80, lxe: 40, plastic: 150 };
  var ctx = { det: ['hpge'], env: ['underground'], n: ['ambient'], mat: ['cu', 'pb', 'rock'], fwhm: 1.6 };
  try { var saved = JSON.parse(localStorage.getItem('gx-setup') || 'null'); if (saved && saved.det) ctx = saved; } catch (e) {}
  ctx.mass = ctx.mass || {}; ctx.preset = ctx.preset || 'equal';
  ctx.wcat = ctx.wcat || {}; ctx.wsrc = ctx.wsrc || {};   // user adjustments to the ranking: log10 factors by category / by source
  function save() { try { localStorage.setItem('gx-setup', JSON.stringify(ctx)); } catch (e) {} }
  function mass(m) { var v = ctx.mass[m]; return v != null && isFinite(v) && v >= 0 ? +v : 1; }   // kg (effective); 1 kg if not set

  function sigma(E) {                // detector resolution σ at energy E (keV); FWHM scales as √E above ~100 keV
    var det = ctx.det[0];
    var f1 = +ctx.fwhm || FWHM1MEV[det] || 2;
    var fw = det === 'hpge' ? Math.sqrt(Math.pow(0.55 * f1, 2) + Math.pow(f1, 2) * 0.7 * E / 1000) : f1 * Math.sqrt(Math.max(E, 20) / 1000);
    return fw / 2.355;
  }

  function buildSetup() {
    document.querySelectorAll('.gx-setup .chips').forEach(function (box) {
      var key = box.getAttribute('data-key'), single = box.hasAttribute('data-single');
      OPTS[key].forEach(function (o) {
        var b = el('button', 'chip', o[1]); b.type = 'button';
        b.setAttribute('aria-pressed', ctx[key].indexOf(o[0]) >= 0 ? 'true' : 'false');
        b.addEventListener('click', function () {
          if (single) ctx[key] = [o[0]];
          else { var i = ctx[key].indexOf(o[0]); if (i >= 0) ctx[key].splice(i, 1); else ctx[key].push(o[0]); }
          if (key === 'det') { ctx.fwhm = FWHM1MEV[o[0]]; $('#fwhm').value = ctx.fwhm; }
          box.querySelectorAll('.chip').forEach(function (c, k) { c.setAttribute('aria-pressed', ctx[key].indexOf(OPTS[key][k][0]) >= 0 ? 'true' : 'false'); });
          if ((key === 'mat' || key === 'det') && ctx.preset !== 'equal') ctx.preset = 'custom';
          save(); renderMasses(); setupSummary(); rerun();
        });
        box.appendChild(b);
      });
    });
    $('#preset').addEventListener('change', function () { applyPreset(this.value); });
    $('#w-reset').addEventListener('click', resetWeights);
    $('#fwhm').value = ctx.fwhm;
    $('#fwhm').addEventListener('change', function () { ctx.fwhm = +this.value || FWHM1MEV[ctx.det[0]]; save(); setupSummary(); rerun(); });
    ctx.flux = ctx.flux || { th: null, fast: null };
    ['th', 'fast'].forEach(function (k) {
      var inp = $('#flux-' + k);
      inp.value = ctx.flux[k] != null ? ctx.flux[k] : '';
      inp.addEventListener('change', function () { var v = parseFloat(this.value); ctx.flux[k] = isFinite(v) && v >= 0 ? v : null; save(); setupSummary(); rerun(); });
    });
    setupSummary();
  }
  function refreshChips() {
    document.querySelectorAll('.gx-setup .chips').forEach(function (box) {
      var key = box.getAttribute('data-key');
      box.querySelectorAll('.chip').forEach(function (c, k) { c.setAttribute('aria-pressed', ctx[key].indexOf(OPTS[key][k][0]) >= 0 ? 'true' : 'false'); });
    });
    $('#fwhm').value = ctx.fwhm;
  }
  function presetById(id) { return (META.presets || []).filter(function (p) { return p.id === id; })[0]; }
  function buildPresets() {
    var sel = $('#preset'); sel.innerHTML = '';
    [['equal', 'Equal masses (1 kg each)']].concat((META.presets || []).map(function (p) { return [p.id, p.name]; })).concat([['custom', 'Custom (your masses)']])
      .forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; sel.appendChild(op); });
    sel.value = ctx.preset;
    renderMasses();
  }
  function applyPreset(id) {
    ctx.preset = id;
    var p = presetById(id);
    if (id === 'equal') ctx.mass = {};
    else if (p) {
      ctx.det = [p.det]; ctx.fwhm = FWHM1MEV[p.det]; ctx.env = [p.env];
      ctx.mass = JSON.parse(JSON.stringify(p.mass));
      ctx.mat = Object.keys(p.mass).filter(function (m) { return m !== DETMAT[p.det]; });
      refreshChips();
    }
    save(); renderMasses(); setupSummary(); rerun();
  }
  function renderMasses() {
    var box = $('#mass-list'); if (!box || !META.materials) return;
    box.innerHTML = '';
    $('#preset').value = ctx.preset;
    matsInUse().forEach(function (m) {
      var lab = el('label', 'gx-mass'), inp = el('input');
      inp.type = 'number'; inp.min = '0'; inp.step = 'any'; inp.value = mass(m);
      inp.setAttribute('aria-label', META.materials[m].name + ' mass in kg');
      inp.addEventListener('change', function () {
        var v = parseFloat(this.value); ctx.mass[m] = isFinite(v) && v >= 0 ? v : 1;
        ctx.preset = 'custom'; $('#preset').value = 'custom'; save(); renderPresetInfo(); setupSummary(); rerun();
      });
      lab.appendChild(document.createTextNode(META.materials[m].name + (m === DETMAT[ctx.det[0]] ? ' (detector)' : '') + ' '));
      lab.appendChild(inp); lab.appendChild(document.createTextNode(' kg'));
      box.appendChild(lab);
    });
    renderPresetInfo();
  }
  function renderPresetInfo() {
    var info = $('#preset-info'); info.innerHTML = '';
    var p = presetById(ctx.preset);
    if (!p) {
      info.appendChild(el('p', 'gx-note', ctx.preset === 'equal' ? 'Every material counts as 1 kg. Pick a typical setup for ballpark masses, or type your own.'
        : 'Your own masses. For thick shields, count only the layer nearest the detector (about 2 cm of copper or steel, 1.7 cm of lead, 15–20 cm of plastic or water), and reduce anything behind other material.'));
      return;
    }
    var d = el('details', 'gx-refs'); d.appendChild(el('summary', null, 'Where these masses come from'));
    var ul = el('ul'); p.notes.forEach(function (n) { ul.appendChild(el('li', null, n)); }); d.appendChild(ul);
    var rl = el('ul'); p.refs.forEach(function (n) { rl.appendChild(el('li', 'muted', n)); }); d.appendChild(rl);
    info.appendChild(el('p', 'gx-note', 'Ballpark effective masses: each component\'s mass times the share of its gammas that reach the active volume. Edit any number to use your own.'));
    info.appendChild(d);
  }
  function label(key, v) { var o = OPTS[key].filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : v; }
  function fluxPlaceholders() {
    if (!META.flux) return;
    var d = META.flux[ctx.env[0]] || {};
    $('#flux-th').placeholder = d.th != null ? d.th.toExponential(2) : '';
    $('#flux-fast').placeholder = d.fast != null ? d.fast.toExponential(2) : '';
  }
  function setupSummary() {
    fluxPlaceholders();
    $('#setup-sum').textContent = '· ' + [label('det', ctx.det[0]) + ' (' + ctx.fwhm + ' keV FWHM at 1 MeV)', label('env', ctx.env[0]),
      ctx.n.length ? ctx.n.map(function (v) { return label('n', v).split(' (')[0]; }).join(', ') : 'no neutrons',
      ctx.mat.length + ' materials',
      ctx.preset === 'equal' ? '1 kg each' : ctx.preset === 'custom' ? 'your masses' : (presetById(ctx.preset) || {}).name + ' masses'].join(' · ');
  }

  /* ------------------------------------------------------------ data */
  var DATA = null, ALL = null, BYID = {}, META = {};
  function load(url) { return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }
  function index(list) { list.forEach(function (s) { BYID[s.id] = s; }); }
  var GROUPS = [];
  function buildGroups() {             // members of one decay-chain segment share one activity: test them together
    var segs = {};
    DATA.S.forEach(function (s) { if (s.kind === 'decay' && s.seg && s.af != null && s.L.length) (segs[s.chain + '|' + s.seg] = segs[s.chain + '|' + s.seg] || []).push(s); });
    Object.keys(segs).forEach(function (k) {
      var ms = segs[k];
      if (ms.length < 2) return;
      var top = Math.max.apply(null, ms.map(function (m) { return m.af; }));
      var L = [], C = {};
      ms.forEach(function (m) {
        m.L.forEach(function (l, i) {
          if (l[2] === 'x') return;
          var I = l[1] * m.af / top;
          if (I < 0.05) return;
          if (m.C && m.C[i]) C[L.length] = m.C[i];
          L.push([l[0], I, l[2], m.name.replace(/<[^>]+>/g, '')]);
        });
      });
      var g = { id: 'g:' + k, kind: 'decay', group: ms, tier: Math.min.apply(null, ms.map(function (m) { return m.tier; })),
        name: ms[0].seg.charAt(0).toUpperCase() + ms[0].seg.slice(1) + ' <span class="muted">(' + ms.map(function (m) { return m.name; }).join(', ') + ')</span>',
        chain: ms[0].chain, chainName: ms[0].chainName, seg: ms[0].seg, radon: ms.some(function (m) { return m.radon; }) ? 1 : 0,
        sup: ms[0].sup, how: 'Decay-chain segment in secular equilibrium: ' + ms.map(function (m) { return m.name.replace(/<[^>]+>/g, ''); }).join(', ') + ' share one activity, so their lines appear together with fixed ratios.',
        where: ms[0].where, tests: ms[0].tests, unit: 'Intensity: gammas per 100 decays of the segment, including branching ratios (ENSDF).', L: L, C: C, key: '' };
      GROUPS.push(g); BYID[g.id] = g;
    });
  }
  function sources() { return ALL ? DATA.S.concat(ALL.S) : DATA.S; }
  function needAll() {
    if (ALL) return Promise.resolve();
    return load('data/gamma/all.json').then(function (d) { ALL = d; index(d.S); });
  }

  /* prior: relative plausibility of a source in this setup. Only used for ranking; see "How candidates are ranked" on the page.
     Neutron-induced lines are strongly suppressed: neutron fluxes (and so capture and inelastic rates) are tiny compared with
     the decay rates of the primordial and cosmogenic activity in and around a detector, unless a neutron source or reactor is nearby. */
  function neutronFactor(type) {
    if (!ctx.n.length) return 1e-3;
    var f = 0, surf = ctx.env[0] === 'surface';
    if (ctx.n.indexOf('ambient') >= 0) f = Math.max(f, type === 'fast' ? (surf ? 0.03 : 0.005) : (surf ? 0.05 : 0.01));
    if (ctx.n.indexOf('source') >= 0) f = Math.max(f, 0.5);
    if (ctx.n.indexOf('reactor') >= 0) f = Math.max(f, type === 'fast' ? 0.2 : 0.5);
    return f;
  }
  function prior(s) {
    var p = s.tier === 1 ? 1 : s.tier === 2 ? 0.3 : 0.03, w = s.when || {};
    ['env', 'n', 'mat', 'det'].forEach(function (k) {
      if (!w[k]) return;
      var hit = w[k].some(function (v) { return ctx[k].indexOf(v) >= 0; });
      if (hit) p *= 3;
      else if (k === 'det') p *= 0.05;                       // detector-specific effects (Ge triangles …)
      else if (k === 'n') p *= 0.05;                         // needs a neutron source or reactor that isn't selected
      else if (k === 'mat') p *= 0.5;
    });
    if (s.cosmo) {                                           // cosmogenic in the listed materials
      var m = s.cosmo.some(function (v) { return ctx.mat.indexOf(v) >= 0 || (v === 'ge' && ctx.det[0] === 'hpge') || (v === 'ar' && ctx.det[0] === 'lar') || (v === 'xe' && ctx.det[0] === 'lxe') || (v === 'nai' && ctx.det[0] === 'nai'); });
      p *= (m ? 3 : 0.4) * (ctx.env[0] === 'surface' ? 3 : 1);
    }
    if (s.ntype) p *= neutronFactor(s.ntype);                // neutron-induced (capture, inelastic, neutron reactions)
    if (s.kind === 'capture' || s.kind === 'inel') {
      var present = (s.mats || []).some(function (v) { return ctx.mat.indexOf(v) >= 0; }) || (s.det || []).indexOf(ctx.det[0]) >= 0;
      p *= present ? 4 : s.always ? 1 : 0.15;                 // is the target element actually nearby?
      if (s.kind === 'capture' && s.wt != null) p *= Math.min(3, 0.1 + Math.sqrt(s.wt));   // abundance × σ of the target isotope
      if (s.kind === 'inel' && s.ab != null) p *= Math.min(1, 0.1 + s.ab / 100);
    }
    if (s.radon && ctx.env[0] === 'underground') p *= 1.5;
    return p;
  }
  /* ---------------- physical rate model ----------------
     Every line gets an expected emission rate in gammas per second per kilogram, summed over the selected materials
     (times the mass of each, from a preset or the user) plus the detector's own material:
       decays      activity of the chain segment in each material (radiopurity.org medians, crust averages for rock) x branching x intensity
       (n,g)       thermal flux x atoms of the target isotope per kg x sigma x gammas per capture
       (n,n'g)     fast flux x atoms per kg x 1 b (assumed) x the line's share of the isotope's relative weights
       activation  saturation activity = capture rate on the parent isotope
     Sources with no model (cosmogenic activation, calibration and medical sources, airborne radon, X-ray fluorescence, ...)
     fall back to a coarse prior on a fixed reference scale (1e-4 gammas/s/kg, times the average mass in use). */
  var NA = 6.02214076e23, REF = 1e-4;
  var SEG = {};
  [['U238', '238U 234Th 234mPa 234Pa 234U 230Th'], ['Ra226', '226Ra 222Rn 218Po 214Pb 214Bi 214Po'], ['Pb210', '210Pb 210Bi 210Po'],
   ['Th232', '232Th 228Ra 228Ac'], ['Th228', '228Th 224Ra 220Rn 216Po 212Pb 212Bi 212Po 208Tl'],
   ['U235', '235U 231Th 231Pa 227Ac 227Th 223Ra 219Rn 215Po 211Pb 211Bi 207Tl'], ['K40', '40K'], ['Co60', '60Co'], ['Cs137', '137Cs']]
    .forEach(function (p) { p[1].split(' ').forEach(function (n) { SEG[n] = p[0]; }); });
  var DETMAT = { hpge: 'ge', lar: 'ar', lxe: 'xe', nai: 'nai', plastic: 'poly' };
  function matsInUse() {
    var m = ctx.mat.slice(), d = DETMAT[ctx.det[0]];
    if (d && m.indexOf(d) < 0) m.push(d);
    return m.filter(function (k) { return META.materials && META.materials[k]; });
  }
  function fluxes() {
    var env = ctx.env[0], def = (META.flux || {})[env] || { th: 0, fast: 0 };
    var any = ctx.n.length > 0;
    return { th: any ? (ctx.flux && ctx.flux.th != null ? ctx.flux.th : def.th) : 0, fast: any ? (ctx.flux && ctx.flux.fast != null ? ctx.flux.fast : def.fast) : 0 };
  }
  var RCACHE = {}, RKEY = '';
  function ctxKey() { return JSON.stringify([matsInUse(), fluxes(), ctx.mass]); }
  function massScale() {              // unmodelled sources use a per-kg reference scale times the typical mass in use
    var ms = matsInUse(); if (!ms.length) return 1;
    return ms.reduce(function (a, m) { return a + mass(m); }, 0) / ms.length;
  }
  function srcRate(s) {               // {tot, by: {material: rate}} in decays or reactions per s (per-kg rate × mass); null = not modelled
    var k = ctxKey(); if (k !== RKEY) { RCACHE = {}; RKEY = k; }
    if (s.id in RCACHE) return RCACHE[s.id];
    var r = null, mats = matsInUse(), F = fluxes(), M = META.materials || {};
    function add(m, v) { if (!r) r = { tot: 0, by: {} }; v *= mass(m); if (v > 0) { r.by[m] = (r.by[m] || 0) + v; r.tot += v; } }
    function atoms(m, el, molar, ab) { var w = (M[m].comp || {})[el] || 0; return w * 1000 / molar * NA * ab / 100; }
    if (s.kind === 'decay') {
      var nuc = s.group ? s.group[0].nuc : s.nuc, seg = SEG[nuc];
      var af = s.group ? Math.max.apply(null, s.group.map(function (g) { return g.af || 1; })) : (s.af != null ? s.af : 1);
      if (seg) { if (!r) r = { tot: 0, by: {} }; mats.forEach(function (m) { add(m, ((M[m].act || {})[seg] || 0) * af); }); }
      if (s.act && BYID[s.act]) {                       // activation product: saturation activity = capture rate on the parent
        var c = srcRate(BYID[s.act]); if (!r) r = { tot: 0, by: {} }; if (c) Object.keys(c.by).forEach(function (m) { add(m, c.by[m]); });
      }
    } else if (s.kind === 'capture') {
      r = { tot: 0, by: {} };
      mats.forEach(function (m) { add(m, F.th * atoms(m, s.elem, s.M, s.ab) * s.sig * 1e-24); });
    } else if (s.kind === 'inel') {
      r = { tot: 0, by: {} };
      var sw = s.L.reduce(function (a, l) { return a + l[1]; }, 0) || 1;
      mats.forEach(function (m) { add(m, F.fast * atoms(m, s.elem, s.M, s.ab) * 1e-24 * 100 / sw); });
    } else if (s.kind === 'alpha') {                   // (α,x)γ: thick-target yield per chain-segment decay × segment activity
      r = { tot: 0, by: {} };
      mats.forEach(function (m) {
        var y = (s.ay || {})[m]; if (!y) return;
        var a = (M[m] || {}).act || {}, v = 0;
        Object.keys(y).forEach(function (g) { v += (a[g] || 0) * y[g]; });
        add(m, v);
      });
    } else if (s.nphys) {
      var p = s.nphys; r = { tot: 0, by: {} };
      mats.forEach(function (m) { add(m, (p.fast ? F.fast : F.th) * atoms(m, p.el, p.M, p.ab) * p.sig * 1e-24); });
    }
    RCACHE[s.id] = r;
    return r;
  }
  function lineRate(s, l) {           // expected gammas per s for one line (physical model or fallback prior)
    return baseRate(s, l) * weight(s);
  }
  function baseRate(s, l) {
    var r = srcRate(s);
    if (r && r.tot > 0) return r.tot * l[1] / 100;
    if (r) return 1e-12 * massScale() * l[1] / 100;                 // modelled, but nothing in your setup produces it
    if (unmotivated(s)) return 1e-17 * massScale() * strength(s, l[1]);   // no reason to expect it nearby: below every neutron- or alpha-induced line
    return prior(s) * REF * massScale() * strength(s, l[1]);
  }
  function unmotivated(s) {           // a decay that is not a chain member, cosmogenic, activation product or common man-made/calibration source
    return s.kind === 'decay' && !s.group && s.tier >= 3 && !SEG[s.nuc] && !s.cosmo && !s.act && !s.chain && !s.radon && !(s.when && (s.when.n || s.when.src || s.when.mat));
  }
  /* ------------------------------------------------------------ user adjustments to the ranking */
  var CATS = [
    ['chain', 'Uranium and thorium chains, ⁴⁰K'], ['radon', 'Radon and its progeny'], ['cosmo', 'Cosmogenic activation'],
    ['act', 'Neutron activation products'], ['anthro', 'Man-made and calibration sources'], ['capture', 'Neutron capture (n,γ)'],
    ['inel', 'Inelastic neutron scattering'], ['alpha', 'Alpha-induced reactions'], ['rx', 'Other reactions'],
    ['xray', 'X-rays'], ['art', 'Escape and sum peaks'], ['unmot', 'Isotopes with no expected source']];
  function category(s) {
    if (s.group) { var m = BYID[s.group[0].id]; return m ? category(m) : 'chain'; }
    if (s.kind !== 'decay') return s.kind === 'art' ? 'art' : s.kind;
    if (s.radon) return 'radon';
    if (SEG[s.nuc] && SEG[s.nuc] !== 'Co60' && SEG[s.nuc] !== 'Cs137') return 'chain';
    if (s.cosmo) return 'cosmo';
    if (s.act) return 'act';
    if (unmotivated(s)) return 'unmot';
    return 'anthro';
  }
  function weight(s) {                // product of the category and per-source factors the user set (1 = no change)
    var w = (ctx.wcat[category(s)] || 0) + (ctx.wsrc[s.id] || 0);
    return w ? Math.pow(10, w) : 1;
  }
  function artW() { return ctx.wcat.art ? Math.pow(10, ctx.wcat.art) : 1; }
  function adjusted() { return Object.keys(ctx.wcat).some(function (k) { return ctx.wcat[k]; }) || Object.keys(ctx.wsrc).length > 0; }
  function factorText(w) { return w === 0 ? '×1' : (w > 0 ? '×' : '÷') + Math.pow(10, Math.abs(w)).toLocaleString('en-US'); }
  function buildWeights() {
    var box = $('#w-list'); if (!box) return;
    box.innerHTML = '';
    CATS.forEach(function (c) {
      var row = el('label', 'gx-wrow'), r = el('input'), out = el('output');
      r.type = 'range'; r.min = '-4'; r.max = '4'; r.step = '1'; r.value = ctx.wcat[c[0]] || 0;
      r.setAttribute('aria-label', c[1] + ': ranking factor');
      out.textContent = factorText(+r.value);
      r.addEventListener('input', function () { out.textContent = factorText(+this.value); });
      r.addEventListener('change', function () {
        var v = +this.value; if (v) ctx.wcat[c[0]] = v; else delete ctx.wcat[c[0]];
        save(); renderWeightNote(); rerun();
      });
      row.appendChild(el('span', null, c[1])); row.appendChild(r); row.appendChild(out);
      box.appendChild(row);
    });
    renderWeightNote();
  }
  function renderWeightNote() {
    var box = $('#w-src'); if (!box) return;
    box.innerHTML = '';
    var ids = Object.keys(ctx.wsrc);
    if (ids.length) {
      box.appendChild(document.createTextNode('Single sources: '));
      ids.forEach(function (id, k) {
        var s = BYID[id]; if (!s) return;
        if (k) box.appendChild(document.createTextNode(', '));
        var a = srcLink(id); a.innerHTML = s.name; box.appendChild(a);
        box.appendChild(document.createTextNode(' ' + factorText(ctx.wsrc[id]) + ' '));
        var x = el('button', 'mini', 'undo'); x.type = 'button';
        x.addEventListener('click', function () { delete ctx.wsrc[id]; save(); renderWeightNote(); rerun(); });
        box.appendChild(x);
      });
    }
    var sum = $('#w-summary'); if (sum) sum.textContent = adjusted() ? ' (adjusted)' : '';
  }
  function resetWeights() { ctx.wcat = {}; ctx.wsrc = {}; save(); buildWeights(); rerun(); }

  function rel(v, top) { return Math.max(0, Math.min(1, 1 + Math.log10(Math.max(v, 1e-300) / top) / 8)); }   // 8 decades of rate

  function strength(s, I) {           // how much a line's intensity matters for ranking
    if (s.kind === 'inel' || s.kind === 'xray') return 0.15 + 0.5 * Math.min(1, I / 100);
    return Math.sqrt(Math.min(1, Math.max(I, 0.01) / 100));
  }
  function width(E, flags) {          // expected peak σ: detector ⊕ Doppler/recoil broadening
    var s = sigma(E);
    if (flags && flags.indexOf('b') >= 0) s = Math.sqrt(s * s + Math.pow(0.004 * E, 2));
    else if (flags && flags.indexOf('a') >= 0) s = Math.sqrt(s * s + Math.pow(0.001 * E, 2));   // (α,x)γ: some recoil Doppler broadening; the centroid stays at the line energy
    return s;
  }
  function match(E, line) {           // agreement of a measured energy with a line (0..1)
    var f = line[2] || '', d = E - line[0], s = width(line[0], f);
    if (f.indexOf('t') >= 0 && d > 0) d = Math.max(0, d - 8);   // recoil tail above Ge(n,n′) lines
    return Math.exp(-0.5 * d * d / (s * s));
  }

  var KIND = { decay: 'Decay', capture: 'Neutron capture (n,γ)', inel: 'Inelastic (n,n′γ)', alpha: 'Alpha-induced (α,x)γ', rx: 'Other reaction', xray: 'X-ray', art: 'Detector effect' };

  /* ------------------------------------------------------------ correlations panel */
  function strongest(s, n) {
    var all = s.L.map(function (l, i) { return [l, i]; });
    var big = all.filter(function (p) { return p[0][0] >= 10; });
    return (big.length ? big : all).sort(function (a, b) { return b[0][1] - a[0][1]; }).slice(0, n);
  }
  function timeText(s) {
    if (s.kind === 'capture' || s.kind === 'inel') return 'Prompt: appears only while neutrons are present and follows the neutron flux in real time.';
    if (s.kind === 'alpha') return 'Prompt: follows the alpha activity of the material (²¹⁰Po, radon progeny, U/Th chains); constant in time if that activity is.';
    if (s.kind === 'rx') return s.time || 'Prompt: follows the rate of the reaction that produces it.';
    if (s.kind === 'xray') return 'Follows whatever excites the material (gammas, betas or the decays listed above).';
    var t = s.hl != null ? 'Decays with T½ = ' + hlText(s.hl) + '.' : '';
    if (s.sup) t += ' In secular equilibrium it is supported by ' + pretty(s.sup[0]) + ' (T½ = ' + hlText(s.sup[1]) + '), so its activity follows the parent.';
    if (s.cosmo) t += ' Produced by cosmic rays at the surface, so the activity falls after the material goes underground.';
    if (s.radon) t += ' If it comes from airborne radon, it varies with ventilation, air pressure and nitrogen purging.';
    return t;
  }
  function details(s, hiLine) {
    var box = el('div', 'gx-detail');
    var head = el('div', 'gx-dhead');
    head.appendChild(el('span', 'tag', KIND[s.kind] || s.kind));
    if (s.hl != null) head.appendChild(el('span', 'tag', 'T½ ' + hlText(s.hl)));
    if (s.chain) head.appendChild(el('span', 'tag', s.chainName));
    if (s.cosmo) head.appendChild(el('span', 'tag', 'cosmogenic'));
    box.appendChild(head);
    var adj = el('p', 'gx-small gx-adj'), cur = ctx.wsrc[s.id] || 0;
    adj.appendChild(document.createTextNode('Ranking: ' + (cur ? factorText(cur) + ' set by you ' : '')));
    [['Rank higher', 1], ['Rank lower', -1]].forEach(function (b) {
      var bt = el('button', 'mini', b[0]); bt.type = 'button';
      bt.addEventListener('click', function () {
        var v = Math.max(-6, Math.min(6, (ctx.wsrc[s.id] || 0) + b[1]));
        if (v) ctx.wsrc[s.id] = v; else delete ctx.wsrc[s.id];
        save(); renderWeightNote(); rerun();
      });
      adj.appendChild(bt); adj.appendChild(document.createTextNode(' '));
    });
    if (cur) { var ub = el('button', 'mini', 'Undo'); ub.type = 'button'; ub.addEventListener('click', function () { delete ctx.wsrc[s.id]; save(); renderWeightNote(); rerun(); }); adj.appendChild(ub); }
    if (s.how) box.appendChild(el('p', null, s.how));
    box.appendChild(adj);
    if (s.group) {
      var gm = el('p'); gm.appendChild(el('b', null, 'Members: '));
      s.group.forEach(function (m, k) { if (k) gm.appendChild(document.createTextNode(', ')); var a = srcLink(m.id); a.innerHTML = m.name; gm.appendChild(a); gm.appendChild(document.createTextNode(' (T½ ' + hlText(m.hl) + ')')); });
      box.appendChild(gm);
    }
    if (s.where) { var w = el('p'); w.appendChild(el('b', null, 'Where it shows up: ')); w.appendChild(document.createTextNode(s.where)); box.appendChild(w); }

    var grid = el('div', 'gx-dgrid');
    // other lines of the same source
    var col = el('div');
    col.appendChild(el('h4', null, s.kind === 'capture' ? 'Strongest lines per capture' : s.kind === 'inel' ? 'Lines from low-lying levels' : 'Strongest lines'));
    var t = el('table', 'gx-mini'), tb = el('tbody');
    strongest(s, s.kind === 'inel' ? 12 : 10).forEach(function (p) {
      var l = p[0], tr = el('tr');
      if (hiLine != null && p[1] === hiLine) tr.className = 'hi';
      tr.appendChild(el('td', 'num', fmt(l[0], 2)));
      tr.appendChild(el('td', 'num', s.kind === 'inel' ? '' : (l[1] >= 0.1 ? fmt(l[1], l[1] >= 10 ? 1 : 2) : l[1].toPrecision(2)) + '%'));
      tr.appendChild(el('td', 'muted', l[3] ? pretty(l[3]) : (l[2] || '').indexOf('b') >= 0 ? 'broadened' : ''));
      tb.appendChild(tr);
    });
    t.appendChild(tb); col.appendChild(t);
    if (s.unit) col.appendChild(el('p', 'gx-small muted', s.unit));
    grid.appendChild(col);

    // coincidences of the highlighted (or strongest) line
    var li = hiLine != null ? hiLine : strongest(s, 1)[0][1];
    var C = s.C && s.C[li];
    var col2 = el('div');
    col2.appendChild(el('h4', null, 'In coincidence with ' + fmt(s.L[li][0], 1) + ' keV'));
    if (C && C.length) {
      var t2 = el('table', 'gx-mini'), tb2 = el('tbody');
      C.slice(0, 8).forEach(function (c) {
        var tr = el('tr'); tr.appendChild(el('td', 'num', fmt(c[0], 2)));
        tr.appendChild(el('td', 'num', Math.round(c[1] * 100) + '%'));
        tr.appendChild(el('td', 'muted', 'sum ' + fmt(s.L[li][0] + c[0], 1)));
        tb2.appendChild(tr);
      });
      t2.appendChild(tb2); col2.appendChild(t2);
      col2.appendChild(el('p', 'gx-small muted', 'Probability that the other gamma is emitted in the same decay or cascade. In a compact or high-efficiency detector, these pairs also add up to sum peaks.'));
    } else {
      col2.appendChild(el('p', 'gx-small muted', s.kind === 'decay' || s.kind === 'capture' ? 'No other strong gamma is emitted in the same ' + (s.kind === 'decay' ? 'decay' : 'cascade') + ' (for capture lines, this usually means a direct transition to the ground state).' : 'No coincidence information for this line.'));
    }
    var esc = s.L[li][0];
    if (esc > 1022) {
      col2.appendChild(el('h4', null, 'Detector artifacts'));
      col2.appendChild(el('p', 'gx-small', 'Single escape ' + fmt(esc - 511, 1) + ' keV · double escape ' + fmt(esc - 1022, 1) + ' keV (pair production, more prominent in small detectors).'));
    }
    grid.appendChild(col2);
    box.appendChild(grid);

    // expected rate in this setup
    var rr = srcRate(s), rp = el('p', 'gx-small');
    rp.appendChild(el('b', null, 'In your setup: '));
    if (rr && rr.tot > 0) {
      var parts = Object.keys(rr.by).sort(function (a, b) { return rr.by[b] - rr.by[a]; }).map(function (m) { return META.materials[m].name + ' ' + sci(rr.by[m]); });
      var sl = s.L[li];
      rp.appendChild(document.createTextNode('≈ ' + sci(rr.tot * sl[1] / 100) + ' γ/s in the ' + fmt(sl[0], 1) + ' keV line (' +
        (s.kind === 'decay' ? 'decays' : 'reactions') + ' per s: ' + parts.join(', ') + '; using the masses in your setup).'));
    } else if (rr) {
      rp.appendChild(document.createTextNode(s.kind === 'decay' ? 'none of your selected materials has assay data for this activity.' : 'nothing in your selected materials and neutron flux produces this reaction.'));
    } else {
      rp.appendChild(document.createTextNode('no rate model (ranked with a coarse prior instead).'));
    }
    box.appendChild(rp);

    // time, chain, tests
    var tt = el('p'); tt.appendChild(el('b', null, 'Time behaviour: ')); tt.appendChild(document.createTextNode(timeText(s))); box.appendChild(tt);
    if (s.par || (s.dau && s.dau.length)) {
      var ch = el('p'); ch.appendChild(el('b', null, 'Decay chain: '));
      if (s.par) { ch.appendChild(document.createTextNode('from ')); ch.appendChild(srcLink(s.par)); ch.appendChild(document.createTextNode('. ')); }
      if (s.dau && s.dau.length) {
        ch.appendChild(document.createTextNode('decays to '));
        s.dau.forEach(function (d, k) {
          if (k) ch.appendChild(document.createTextNode(', '));
          ch.appendChild(BYID['d:' + d[0]] ? srcLink('d:' + d[0]) : document.createTextNode(pretty(d[0])));
          if (d[1] < 99.9) ch.appendChild(document.createTextNode(' (' + (d[1] >= 1 ? d[1].toFixed(1) : d[1].toPrecision(2)) + '%)'));
        });
        ch.appendChild(document.createTextNode('.'));
      }
      box.appendChild(ch);
    }
    if (s.seg) { var sg = el('p', 'gx-small muted', 'Equilibrium group: ' + s.seg + '. Lines from the same group should share one activity; differences between groups point to broken secular equilibrium.'); box.appendChild(sg); }
    if (s.tests && s.tests.length) {
      box.appendChild(el('h4', null, 'How to test this'));
      var ul = el('ul', 'gx-tests'); s.tests.forEach(function (x) { ul.appendChild(el('li', null, x)); }); box.appendChild(ul);
    }
    if (false) {
      var ip = el('p', 'gx-small muted', 'Capture rate by isotope (abundance × σ): ' + s.iso.map(function (x) { return pretty(x[0]) + ' ' + (x[1] * 100).toFixed(x[1] < 0.1 ? 1 : 0) + '%'; }).join(', ') + (s.miss ? '. Not covered: ' + s.miss.map(pretty).join(', ') + '.' : '.'));
      box.appendChild(ip);
    }
    var refs = (s.refs || []).map(function (r) { return r.charAt(0) === '@' ? (META.refs || {})[r] : r; }).filter(Boolean);
    if (s.group) s.group.forEach(function (m) { (m.refs || []).forEach(function (r) { refs.push(m.name.replace(/<[^>]+>/g, '') + ' ' + r.charAt(0).toLowerCase() + r.slice(1)); }); });
    if (rr && rr.tot > 0) Object.keys(rr.by).forEach(function (m) { (META.materials[m].refs || []).forEach(function (x) { refs.push(META.materials[m].name + ' — ' + x); }); });
    if (s.ntype || s.nphys) ((META.flux || {}).refs || []).forEach(function (x) { refs.push('Neutron flux — ' + x); });
    refs.push('Where it shows up and how to test it: curated by the UCR Dark Matter and Neutrino Lab (guidance, not evaluated data).');
    var rb = el('details', 'gx-refs'); rb.appendChild(el('summary', null, 'Sources'));
    var rl = el('ul'); refs.forEach(function (r) { rl.appendChild(el('li', null, r)); }); rb.appendChild(rl); box.appendChild(rb);
    if (s.nuc) {
      var lk = el('p', 'gx-small'), a = el('a', null, 'ENSDF data for ' + pretty(s.nuc) + ' at NNDC NuDat');
      a.href = 'https://www.nndc.bnl.gov/nudat3/decaysearchdirect.jsp?nuc=' + encodeURIComponent(s.nuc) + '&unc=NDS'; a.rel = 'noopener';
      lk.appendChild(a); box.appendChild(lk);
    }
    return box;
  }
  function sci(v) { return v >= 0.01 && v < 1e4 ? v.toPrecision(2) : v.toExponential(1).replace('e', '×10^').replace('+', ''); }
  function srcLink(id) {
    var s = BYID[id], a = el('a', null, s ? s.name : pretty(id.replace(/^d:/, '')));
    a.href = '#src=' + encodeURIComponent(id);
    a.addEventListener('click', function (e) { e.preventDefault(); openSource(id); });
    return a;
  }
  function openSource(id) {
    var go = function () {
      var s = BYID[id]; if (!s) return;
      selectTab('browse');
      $('#browse-q').value = s.name.replace(/<[^>]+>/g, '');
      renderBrowse([s], true);
      history.replaceState(null, '', '#src=' + encodeURIComponent(id));
    };
    if (BYID[id]) go(); else needAll().then(go);
  }

  /* ------------------------------------------------------------ energy-range search */
  var rangeKinds = { decay: true, capture: true, inel: true, alpha: true, rx: true, xray: true, art: true };
  function artifacts(lo, hi) {        // escape and sum peaks from the most relevant sources
    var out = [];
    DATA.S.forEach(function (s) {
      if (s.tier > 2 && s.kind !== 'capture') return;
      var p = prior(s);
      s.L.forEach(function (l, i) {
        if (l[1] < 1 && s.kind !== 'inel') return;
        [[511, 'single escape'], [1022, 'double escape']].forEach(function (e) {
          var E = l[0] - e[0];
          if (l[0] > 1022 && E >= lo && E <= hi) out.push({ E: E, s: s, li: i, what: e[1] + ' of ' + fmt(l[0], 1) + ' keV', score: lineRate(s, l) * 0.1 * artW() });
        });
        (s.C && s.C[i] || []).forEach(function (c) {
          var E = l[0] + c[0];
          var direct = s.L.some(function (m) { return Math.abs(m[0] - E) < 1.5; });   // same energy as a real line: not a separate peak
          if (c[0] > l[0] && E >= lo && E <= hi && !direct) out.push({ E: E, s: s, li: i, what: 'sum peak ' + fmt(l[0], 1) + ' + ' + fmt(c[0], 1) + ' keV', score: lineRate(s, l) * c[1] * 0.01 * artW() });
        });
      });
    });
    return out;
  }
  function searchRange(lo, hi) {
    var res = [];
    sources().forEach(function (s) {
      var p = prior(s);
      s.L.forEach(function (l, i) {
        var pad = $('#widen').checked ? 2 * width(l[0], l[2]) : 0;
        if (l[0] >= lo - pad && l[0] <= hi + pad) res.push({ E: l[0], s: s, li: i, I: l[1], score: lineRate(s, l) });
      });
    });
    artifacts(lo, hi).forEach(function (a) { res.push({ E: a.E, s: a.s, li: a.li, art: a.what, score: a.score }); });
    return res;
  }
  function renderRange() {
    var lo = +$('#emin').value, hi = +$('#emax').value, out = $('#range-out');
    if (!(hi > lo) && !(hi === lo && hi > 0)) { out.textContent = 'Enter an energy range.'; return; }
    history.replaceState(null, '', '#range=' + lo + '-' + hi);
    out.innerHTML = '<p class="muted">Searching…</p>';
    needAll().then(function () {
      var res = searchRange(lo, hi), counts = {};
      res.forEach(function (r) { var k = r.art ? 'art' : r.s.kind; counts[k] = (counts[k] || 0) + 1; });
      var kb = $('#range-kinds'); kb.innerHTML = '';
      Object.keys(KIND).forEach(function (k) {
        if (!counts[k]) return;
        var b = el('button', 'chip'); b.type = 'button'; b.setAttribute('aria-pressed', rangeKinds[k] ? 'true' : 'false');
        b.appendChild(document.createTextNode(KIND[k])); b.appendChild(el('span', 'n', counts[k]));
        b.addEventListener('click', function () { rangeKinds[k] = !rangeKinds[k]; renderRange(); });
        kb.appendChild(b);
      });
      res = res.filter(function (r) { return rangeKinds[r.art ? 'art' : r.s.kind]; });
      res.sort(function (a, b) { return b.score - a.score; });
      out.innerHTML = '';
      var hdr = el('p', 'gx-count');
      hdr.textContent = res.length + ' gamma line' + (res.length === 1 ? '' : 's') + ' between ' + fmt(lo, 1) + ' and ' + fmt(hi, 1) + ' keV, most plausible for your setup first.';
      out.appendChild(hdr);
      if (!res.length) { out.appendChild(el('p', 'muted', 'Nothing found. Try widening the range.')); return; }
      var top = res[0].score;
      var list = el('ol', 'gx-results'), shown = 0;
      function more(n) {
        res.slice(shown, shown + n).forEach(function (r) { list.appendChild(resultRow(r, top)); });
        shown += n;
        moreBtn.hidden = shown >= res.length;
        moreBtn.textContent = 'Show more (' + (res.length - shown) + ' left)';
      }
      var moreBtn = el('button', 'btn ghost'); moreBtn.type = 'button';
      moreBtn.addEventListener('click', function () { more(50); });
      out.appendChild(list); out.appendChild(moreBtn);
      more(40);
    }).catch(function (e) { out.textContent = 'Could not load the data: ' + e.message; });
  }
  function bar(v) { var b = el('span', 'gx-bar'); var f = el('span'); f.style.width = Math.max(4, Math.round(100 * v)) + '%'; b.appendChild(f); b.title = 'Expected rate in your setup (log scale, 8 decades)'; return b; }
  function resultRow(r, top) {
    var li = el('li', 'gx-row');
    var d = el('details'), sm = el('summary');
    sm.appendChild(el('span', 'gx-e', fmt(r.E, 2)));
    var nm = el('span', 'gx-name'); nm.innerHTML = r.s.name;
    sm.appendChild(nm);
    var info = el('span', 'gx-info');
    if (r.art) info.textContent = r.art;
    else info.textContent = (KIND[r.s.kind] || '') + (r.s.kind === 'inel' ? '' : ' · ' + (r.I >= 0.1 ? fmt(r.I, r.I >= 10 ? 1 : 2) : r.I.toPrecision(2)) + '%') + (r.s.hl != null && r.s.kind === 'decay' ? ' · T½ ' + hlText(r.s.hl) : '');
    sm.appendChild(info);
    sm.appendChild(bar(rel(r.score, top)));
    d.appendChild(sm);
    d.addEventListener('toggle', function () { if (d.open && !d.querySelector('.gx-detail')) d.appendChild(details(r.s, r.li)); });
    li.appendChild(d);
    return li;
  }

  /* ------------------------------------------------------------ identify a peak list */
  function parsePeaks(txt) {
    var peaks = [];
    txt.split(/\n|;/).forEach(function (line) {
      var n = line.replace(/,/g, ' ').trim().split(/\s+/).map(Number).filter(function (x) { return isFinite(x); });
      if (n.length && n[0] > 0) peaks.push({ E: n[0], w: n[1] > 0 ? n[1] : null, A: n[2] > 0 ? n[2] : null });
    });
    peaks.sort(function (a, b) { return a.E - b.E; });
    return peaks;
  }
  function eff(E) { return E < 120 ? Math.pow(E / 120, 1.5) : Math.pow(120 / E, 0.85); }   // rough detection efficiency shape
  function explain(peaks) {
    var lo = Math.max(20, peaks[0].E - 100), hi = peaks[peaks.length - 1].E + 150;
    var cands = [], top = 0;
    sources().concat(GROUPS).forEach(function (s) {
      var m = [];
      peaks.forEach(function (pk, k) {
        var best = null;
        s.L.forEach(function (l, i) {
          var g = match(pk.E, l);
          if (pk.w) g = Math.max(g, Math.exp(-0.5 * Math.pow((pk.E - l[0]) / Math.max(pk.w / 2.355, 0.01), 2)));
          if (g > 0.05) { var rt = lineRate(s, l); if (!best || g * rt > best.g * best.rt) best = { k: k, i: i, g: g, rt: rt }; }
        });
        if (best) { m.push(best); top = Math.max(top, best.rt); }
      });
      if (m.length) cands.push({ s: s, p: 1, m: m });
    });
    // a line more than 6 decades weaker than the strongest candidate would not be seen beside it: keep it as an alternative only
    cands.forEach(function (c) { c.m.forEach(function (x) { x.v = x.g * rel(x.rt, top || 1) * (x.rt < 1e-6 * (top || 1) ? 0.01 : 1); }); });
    function missing(c) {                     // strong expected lines in the observed range with no peak
      var ref = c.m.reduce(function (a, x) { var l = c.s.L[x.i]; return Math.max(a, l[1] * eff(l[0])); }, 0);
      if (c.s.kind === 'xray') return [];
      var relw = c.s.kind === 'inel';                       // inelastic weights are relative (strongest = 100)
      var used = {}; c.m.forEach(function (x) { used[x.i] = 1; });
      return c.s.L.map(function (l, i) { return [l, i]; }).filter(function (p) {
        var l = p[0];
        var matched = peaks.some(function (pk) { return match(pk.E, l) > 0.3; });
        return !used[p[1]] && !matched && l[0] >= lo && l[0] <= hi && l[1] * eff(l[0]) >= (relw ? 0.6 : 0.35) * ref && l[1] >= (relw ? 40 : 0.5);
      }).sort(function (a, b) { return b[0][1] - a[0][1]; }).slice(0, 4);
    }
    cands.forEach(function (c) { c.miss = missing(c); c.pen = Math.pow(0.45, c.miss.length); });
    function score(c, taken) {             // only peaks not yet explained count fully
      var v = 0, fresh = 0;
      c.m.forEach(function (x) { if (taken[x.k]) v += 0.1 * x.v; else { v += x.v; fresh++; } });
      return fresh ? c.p * v * c.pen : 0;
    }
    var taken = {}, chosen = [], guard = 0;
    while (guard++ < 15) {
      var best = null, bs = 0;
      cands.forEach(function (c) {
        if (chosen.indexOf(c) >= 0) return;
        if (c.s.group && chosen.some(function (h) { return h.s.group === c.s.group; })) return;
        if (!c.s.group && chosen.some(function (h) { return h.s.group && h.s.group.indexOf(c.s) >= 0; })) return;   // member of a chosen segment
        var v = score(c, taken); if (v > bs) { bs = v; best = c; }
      });
      if (!best || bs < 0.002) break;
      var newly = best.m.filter(function (x) { return !taken[x.k]; });
      best.score = bs;
      chosen.push(best);
      newly.forEach(function (x) { taken[x.k] = best; });
      if (Object.keys(taken).length >= peaks.length) break;
    }
    // alternatives per peak
    var alts = peaks.map(function (pk, k) {
      return cands.filter(function (c) { return !c.s.group; }).map(function (c) { var x = c.m.filter(function (y) { return y.k === k; })[0]; return x ? { c: c, x: x, v: x.v } : null; })
        .filter(Boolean).sort(function (a, b) { return b.v - a.v; }).slice(0, 6);
    });
    // detector effects for peaks nothing explains well
    var arts = peaks.map(function (pk, k) {
      var notes = [];
      peaks.forEach(function (q) {
        if (Math.abs(q.E - 511 - pk.E) < 3 * sigma(q.E)) notes.push('single escape of the ' + fmt(q.E, 1) + ' keV peak');
        if (Math.abs(q.E - 1022 - pk.E) < 3 * sigma(q.E)) notes.push('double escape of the ' + fmt(q.E, 1) + ' keV peak');
      });
      for (var a = 0; a < peaks.length; a++) for (var b = a; b < peaks.length; b++) {
        var S = peaks[a].E + peaks[b].E;
        if (peaks[a].E !== pk.E && peaks[b].E !== pk.E && Math.abs(S - pk.E) < 2.5 * sigma(pk.E)) notes.push('sum of ' + fmt(peaks[a].E, 1) + ' + ' + fmt(peaks[b].E, 1) + ' keV');
      }
      if (pk.E > 170 && pk.E < 260) notes.push('a backscatter peak sits at about 180–250 keV');
      return notes;
    });
    return { chosen: chosen, alts: alts, arts: arts, taken: taken, lo: lo, hi: hi };
  }
  function renderPeaks() {
    var peaks = parsePeaks($('#peaks').value), out = $('#peaks-out');
    if (!peaks.length) { out.textContent = 'Enter at least one peak energy.'; return; }
    try { localStorage.setItem('gx-peaks', $('#peaks').value); } catch (e) {}
    out.innerHTML = '<p class="muted">Working…</p>';
    needAll().then(function () {
      var r = explain(peaks);
      out.innerHTML = '';
      out.appendChild(lineMap(peaks, r));
      var h = el('h3', null, r.chosen.length ? 'Most likely explanation' : 'No convincing explanation found');
      out.appendChild(h);
      if (r.chosen.length) out.appendChild(el('p', 'gx-small muted', 'Sources chosen one at a time, each explaining as many remaining peaks as possible; a source loses ground for every strong line it predicts that has no peak.'));
      var ol = el('ol', 'gx-hyps');
      r.chosen.forEach(function (c, n) {
        var li = el('li', 'gx-hyp'), d = el('details'), sm = el('summary');
        var sw = el('span', 'gx-sw'); sw.style.background = PAL[n % PAL.length]; sm.appendChild(sw);
        var nm = el('span', 'gx-name'); nm.innerHTML = c.s.name; sm.appendChild(nm);
        var ex = el('span', 'gx-info');
        ex.textContent = 'explains ' + c.m.filter(function (x) { return r.taken[x.k] === c; }).map(function (x) { return fmt(peaks[x.k].E, 1); }).join(', ') + ' keV';
        sm.appendChild(ex);
        d.appendChild(sm);
        var body = el('div', 'gx-hbody');
        var t = el('table', 'gx-mini'), tb = el('tbody');
        var thr = el('tr'); ['Peak', 'Line', 'Δ', 'Intensity'].forEach(function (x) { thr.appendChild(el('th', null, x)); }); tb.appendChild(thr);
        c.m.forEach(function (x) {
          var l = c.s.L[x.i], tr = el('tr');
          tr.appendChild(el('td', 'num', fmt(peaks[x.k].E, 2)));
          tr.appendChild(el('td', 'num', fmt(l[0], 2)));
          tr.appendChild(el('td', 'num', (peaks[x.k].E - l[0] >= 0 ? '+' : '') + fmt(peaks[x.k].E - l[0], 2)));
          tr.appendChild(el('td', 'num', c.s.kind === 'inel' ? '' : (l[1] >= 0.1 ? fmt(l[1], 1) : l[1].toPrecision(2)) + '%'));
          tb.appendChild(tr);
        });
        t.appendChild(tb); body.appendChild(t);
        if (c.miss.length) {
          var mp = el('p', 'gx-warn');
          mp.textContent = 'Expected but not in your list: ' + c.miss.map(function (p) { return fmt(p[0][0], 1) + ' keV (' + fmt(p[0][1], 1) + '%)'; }).join(', ') + '. If these lines are really absent, this source is less likely.';
          body.appendChild(mp);
        }
        body.appendChild(details(c.s, c.m[0].i));
        d.appendChild(body);
        li.appendChild(d); ol.appendChild(li);
      });
      out.appendChild(ol);
      // per-peak table
      out.appendChild(el('h3', null, 'Candidates for each peak'));
      var tbl = el('table', 'gx-ptable'), tbody = el('tbody');
      var hr = el('tr'); ['Peak (keV)', 'Assigned to', 'Other candidates', 'Detector effects?'].forEach(function (x) { hr.appendChild(el('th', null, x)); }); tbody.appendChild(hr);
      peaks.forEach(function (pk, k) {
        var tr = el('tr');
        tr.appendChild(el('td', 'num', fmt(pk.E, 2)));
        var as = el('td'); var c = r.taken[k];
        if (c) { var a = srcLink(c.s.id); a.innerHTML = c.s.name; as.appendChild(a); } else as.appendChild(el('span', 'gx-warn', 'unexplained'));
        tr.appendChild(as);
        var oth = el('td', 'gx-small');
        r.alts[k].filter(function (x) { return x.c !== c; }).slice(0, 4).forEach(function (x, n) {
          if (n) oth.appendChild(document.createTextNode(' · '));
          var a = srcLink(x.c.s.id); a.innerHTML = x.c.s.name; oth.appendChild(a);
          oth.appendChild(document.createTextNode(' (' + fmt(x.c.s.L[x.x.i][0], 1) + ')'));
        });
        tr.appendChild(oth);
        tr.appendChild(el('td', 'gx-small', r.arts[k].join('; ')));
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody); out.appendChild(tbl);
    }).catch(function (e) { out.textContent = 'Could not load the data: ' + e.message; });
  }

  var PAL = ['#0088EE', '#66CC00', '#6600CC', '#CC6600', '#00CCCC', '#CC0000', '#CC00CC', '#00CC66', '#CC0066', '#0000CC'];
  function lineMap(peaks, r) {          // your peaks (grey) against the lines each chosen source predicts
    var wrap = el('figure', 'gx-map');
    var W = 1000, H = 150 + 18 * Math.min(r.chosen.length, 10), pad = 40;
    var lo = r.lo, hi = r.hi, logx = hi / lo > 8;
    function X(E) { return pad + (W - 2 * pad) * (logx ? Math.log(E / lo) / Math.log(hi / lo) : (E - lo) / (hi - lo)); }
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Your peaks compared with the lines predicted by the chosen sources');
    function ln(x1, y1, x2, y2, c, w, dash) { var l = document.createElementNS(ns, 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); l.setAttribute('stroke', c); l.setAttribute('stroke-width', w); if (dash) l.setAttribute('stroke-dasharray', dash); svg.appendChild(l); }
    function tx(x, y, s, cls) { var t = document.createElementNS(ns, 'text'); t.setAttribute('x', x); t.setAttribute('y', y); t.setAttribute('class', cls || ''); t.textContent = s; svg.appendChild(t); }
    var base = 100;
    ln(pad, base, W - pad, base, 'currentColor', 1);
    var ticks = logx ? [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000] : niceTicks(lo, hi);
    ticks.forEach(function (t) { if (t < lo || t > hi) return; ln(X(t), base, X(t), base + 5, 'currentColor', 1); tx(X(t), base + 18, t, 'gx-tick'); });
    tx(W / 2, base + 36, 'Energy (keV)', 'gx-axis');
    peaks.forEach(function (pk) { ln(X(pk.E), base, X(pk.E), 20, 'var(--grey)', 3); });
    r.chosen.slice(0, 10).forEach(function (c, n) {
      var mx = Math.max.apply(null, c.s.L.map(function (l) { return l[0] >= lo && l[0] <= hi ? l[1] * eff(l[0]) : 0; })) || 1;
      c.s.L.forEach(function (l) {
        if (l[0] < lo || l[0] > hi) return;
        var h = c.s.kind === 'inel' ? 25 : 70 * l[1] * eff(l[0]) / mx;
        if (h < 2) return;
        ln(X(l[0]), base, X(l[0]), base - h, PAL[n % PAL.length], 1.6);
      });
      var y = base + 52 + 18 * n;
      ln(pad, y - 4, pad + 18, y - 4, PAL[n % PAL.length], 4);
      tx(pad + 26, y, c.s.name.replace(/<[^>]+>/g, ''), 'gx-leg');
    });
    wrap.appendChild(svg);
    wrap.appendChild(el('figcaption', 'gx-small muted', 'Grey: your peaks. Coloured: lines predicted by each chosen source, scaled by intensity and a rough detection-efficiency shape.'));
    return wrap;
  }
  function niceTicks(lo, hi) {
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / 5))), out = [];
    [1, 2, 5, 10].some(function (m) { if (span / (step * m) <= 8) { step *= m; return true; } return false; });
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(Math.round(t));
    return out;
  }

  /* ------------------------------------------------------------ browse */
  function renderBrowse(list, open) {
    var out = $('#browse-out'); out.innerHTML = '';
    if (!list) {
      var q = $('#browse-q').value.trim().toLowerCase().replace(/[-\s]/g, '');
      if (!q) { out.appendChild(browseIntro()); return; }
      var srt = function (s) { var r = srcRate(s); return (r && r.tot > 0 ? r.tot : prior(s) * REF * massScale()) * weight(s); };
      list = sources().filter(function (s) { return s.key.indexOf(q) >= 0; }).sort(function (a, b) { return srt(b) - srt(a); }).slice(0, 60);
      if (!list.length) { out.appendChild(el('p', 'muted', 'No source matches. Try a nuclide (e.g. 60Co), an element or a word like "cosmogenic".')); return; }
    }
    var ol = el('ol', 'gx-results');
    list.forEach(function (s) {
      var li = el('li', 'gx-row'), d = el('details'), sm = el('summary');
      var nm = el('span', 'gx-name'); nm.innerHTML = s.name; sm.appendChild(nm);
      sm.appendChild(el('span', 'gx-info', (KIND[s.kind] || '') + (s.hl != null && s.kind === 'decay' ? ' · T½ ' + hlText(s.hl) : '') + ' · ' + s.L.length + ' lines'));
      d.appendChild(sm);
      d.addEventListener('toggle', function () { if (d.open && !d.querySelector('.gx-detail')) d.appendChild(details(s)); });
      if (open && list.length === 1) d.open = true;
      li.appendChild(d); ol.appendChild(li);
    });
    out.appendChild(ol);
  }
  function browseIntro() {
    var box = el('div');
    box.appendChild(el('p', 'muted', 'Common starting points:'));
    var groups = [['Uranium chain', ['d:214Bi', 'd:214Pb', 'd:226Ra', 'd:234Th', 'd:234Pa', 'd:210Pb']], ['Thorium chain', ['d:208Tl', 'd:212Pb', 'd:212Bi', 'd:228Ac']],
      ['Other primordial and man-made', ['d:40K', 'd:137Cs', 'd:60Co', 'd:235U']], ['Cosmogenic', ['d:68Ge', 'd:58Co', 'd:57Co', 'd:54Mn', 'd:65Zn', 'd:46Sc']],
      ['Neutron capture', ['c:1H', 'c:56Fe', 'c:63Cu', 'c:73Ge', 'c:35Cl', 'c:157Gd', 'c:113Cd', 'c:40Ar', 'c:208Pb']], ['Inelastic', ['i:72Ge', 'i:74Ge', 'i:56Fe', 'i:63Cu', 'i:208Pb', 'i:40Ar']], ['Reactions', ['rx:b10na', 'rx:ge72e0', 'rx:annihilation', 'rx:f19aa']]];
    groups.forEach(function (g) {
      var p = el('p'); p.appendChild(el('b', null, g[0] + ': '));
      var first = true;
      g[1].forEach(function (id) { if (!BYID[id]) return; if (!first) p.appendChild(document.createTextNode(' · ')); first = false; var a = srcLink(id); a.innerHTML = BYID[id].name; p.appendChild(a); });
      box.appendChild(p);
    });
    return box;
  }

  /* ------------------------------------------------------------ spectrum fit (engine: assets/gammafit-core.js) */
  var FIT = { counts: null, xIsEnergy: false, cal: null, name: '', result: null, worker: null };
  var PDEF = {          // label, unit, help
    c0: ['Calibration offset c₀', 'keV', 'E = c₀ + c₁·ch + c₂·ch²'], c1: ['Calibration gain c₁', 'keV/ch', ''], c2: ['Calibration nonlinearity c₂', 'keV/ch²', ''],
    a: ['Resolution: noise term a', 'keV', 'FWHM² = a² + b·E + c·E²'], b: ['Resolution: statistical term b', 'keV', ''], c: ['Resolution: quadratic term c', '', ''],
    e1: ['Efficiency slope e₁', '', 'ln ε = e₁·x + e₂·x², x = ln(E/1 MeV)'], e2: ['Efficiency curvature e₂', '', ''],
    step: ['Step height (× peak height)', '', 'HPGe low-energy step'], tail: ['Tail fraction', '', 'Exponential low-energy tail'], tailw: ['Tail slope', 'σ', ''],
    se: ['Single-escape fraction at 2614 keV', '', 'Pair production'], de: ['Double-escape fraction at 2614 keV', '', ''],
    pt: ['Peak-to-total at 662 keV', '', 'Compton model'], ptk: ['Peak-to-total energy exponent', '', 'P/T ∝ E^−k'],
    shelf: ['Multiple-scatter shelf fraction', '', 'Share of the non-peak counts'], bs: ['Backscatter-peak fraction', '', '']
  };
  function fitMode() { var v = $('#fit-mode').value; return v === 'auto' ? (ctx.det[0] === 'hpge' ? 'local' : 'compton') : v === 'matrix' && !FIT.matrix ? (ctx.det[0] === 'hpge' ? 'local' : 'compton') : v; }
  function defaultParams() {
    var det = ctx.det[0], f1 = +ctx.fwhm || FWHM1MEV[det] || 2, mode = fitMode(), P = {};
    function set(k, v, s, fixed) { P[k] = { value: v, sigma: s, fixed: !!fixed }; }
    var cal = FIT.cal || { c0: 0, c1: 1, c2: 0 };
    if (FIT.xIsEnergy) { set('c0', 0, Math.max(0.3, 0.5 * f1)); set('c1', 1, 0.002); set('c2', 0, 0, true); }
    else { set('c0', cal.c0, Math.max(0.5, f1)); set('c1', cal.c1, Math.abs(cal.c1) * 0.003 || 0.001); set('c2', cal.c2 || 0, 0, true); }
    if (det === 'hpge') { set('a', 0.55 * f1, 0.3 * f1); set('b', 0.7 * f1 * f1 / 1000, 0.35 * f1 * f1 / 1000); set('c', 0, 0, true); }
    else { set('a', 0.05 * f1, 0.1 * f1); set('b', f1 * f1 / 1000, 0.4 * f1 * f1 / 1000); set('c', 0, 0.2 * f1 * f1 / 1e6); }
    set('e1', det === 'hpge' ? -0.8 : -0.6, 0.4); set('e2', -0.1, 0.2);
    if (mode === 'matrix') {                         // the simulation supplies efficiency, escape peaks and the continuum
      set('e1', 0, 0.1); set('e2', 0, 0, true); set('tail', 0, 0, true); set('tailw', 1, 0, true); set('se', 0, 0, true); set('de', 0, 0, true);
      if (det === 'hpge') set('step', 0.003, 0.003); else set('step', 0, 0, true);
      ['pt', 'ptk', 'shelf', 'bs'].forEach(function (k) { set(k, 0, 0, true); });
      if (FIT.matrix && FIT.matrix.smeared) ['a', 'b', 'c'].forEach(function (k) { P[k].fixed = true; });
    } else if (mode === 'local') { set('step', 0.003, 0.003); set('tail', 0, 0, true); set('tailw', 1, 0, true); set('se', 0.05, 0.05); set('de', 0.02, 0.02);
      ['pt', 'ptk', 'shelf', 'bs'].forEach(function (k) { set(k, 0, 0, true); }); }
    else { ['step', 'tail', 'se', 'de'].forEach(function (k) { set(k, 0, 0, true); }); set('tailw', 1, 0, true);
      set('pt', det === 'lar' || det === 'lxe' ? 0.7 : 0.5, 0.25); set('ptk', 0.6, 0.3); set('shelf', 0.15, 0.1); set('bs', 0.05, 0.05); }
    return P;
  }
  function renderParams(P) {
    var tb = $('#fit-params'); tb.innerHTML = '';
    var mode = fitMode();
    GammaFit.PNAMES.forEach(function (k) {
      var d = PDEF[k], p = P[k];
      if (mode === 'local' && /^(pt|ptk|shelf|bs)$/.test(k)) return;
      if (mode === 'compton' && /^(step|tail|tailw|se|de)$/.test(k)) return;
      if (mode === 'matrix' && (/^(pt|ptk|shelf|bs|tail|tailw|se|de|e2)$/.test(k) || (k === 'step' && ctx.det[0] !== 'hpge'))) return;
      var tr = el('tr'); tr.dataset.k = k;
      var th = el('th', null, d[0]); if (d[2]) th.title = d[2];
      tr.appendChild(th);
      [['value', p.value], ['sigma', p.sigma]].forEach(function (f) {
        var td = el('td'), inp = el('input'); inp.type = 'number'; inp.step = 'any'; inp.value = +(+f[1]).toPrecision(6); inp.dataset.f = f[0];
        inp.setAttribute('aria-label', d[0] + (f[0] === 'value' ? ' value' : ' uncertainty'));
        td.appendChild(inp); tr.appendChild(td);
      });
      var tdf = el('td'), cb = el('input'); cb.type = 'checkbox'; cb.checked = p.fixed; cb.dataset.f = 'fixed'; cb.setAttribute('aria-label', d[0] + ' fixed');
      tdf.appendChild(cb); tr.appendChild(tdf); tr.appendChild(el('td', 'muted', d[1]));
      tb.appendChild(tr);
    });
  }
  function readParams() {
    var P = defaultParams();
    document.querySelectorAll('#fit-params tr').forEach(function (tr) {
      var k = tr.dataset.k, q = P[k];
      tr.querySelectorAll('input').forEach(function (inp) {
        if (inp.dataset.f === 'fixed') q.fixed = inp.checked; else q[inp.dataset.f] = parseFloat(inp.value) || 0;
      });
      if (q.sigma <= 0) q.fixed = true;
    });
    return P;
  }
  function parseSpectrum(text, name) {
    var lines = text.split(/\r?\n/), counts = [], xs = [], cal = null, i;
    lines.forEach(function (l) {
      var v = l.trim().split(/[\s,;]+/).map(Number);
      if (!l.trim() || v.some(isNaN)) return;          // header or comment
      if (v.length === 1) counts.push(v[0]); else { xs.push(v[0]); counts.push(v[1]); }
    });
    if (!counts.length) throw new Error('No numbers found. Use one column of counts, two columns (channel or energy, counts), or a ROOT file with a TH1.');
    var xIsEnergy = false;
    if (xs.length === counts.length) {
      var integer = xs.every(function (x, k) { return Math.abs(x - Math.round(x)) < 1e-9 && (k === 0 || x - xs[k - 1] === 1); });
      xIsEnergy = !integer;
      if (xIsEnergy) {                                   // energies given: keep them as the calibration (fitted as offset and gain corrections)
        var n2 = xs.length; cal = { c0: xs[0], c1: (xs[n2 - 1] - xs[0]) / (n2 - 1), c2: 0 };
        FIT.xEnergies = xs;
      }
    }
    return { counts: counts.map(function (c) { return Math.max(0, Math.round(c)); }), xIsEnergy: xIsEnergy, cal: cal };
  }
  /* ROOT files: read a TH1 (F, D, I, S or C) with JSROOT's I/O (assets/vendor/jsroot, MIT licence), loaded only when needed */
  var JSROOT_IO = null;
  function jsroot() {
    if (!JSROOT_IO) JSROOT_IO = import(new URL('assets/vendor/jsroot/io.mjs', document.baseURI).href);
    return JSROOT_IO;
  }
  function listHists(dir, prefix, out) {          // TH1s at the top level and in sub-directories
    var tasks = [];
    (dir.fKeys || []).forEach(function (k) {
      var nm = prefix + k.fName + ';' + k.fCycle;
      if (/^TH1[FDISCL]?$/.test(k.fClassName)) out.push({ name: nm, cls: k.fClassName, title: k.fTitle });
      else if (/^TDirectory/.test(k.fClassName)) tasks.push(dir.readDirectory(k.fName, k.fCycle).then(function (d) { return listHists(d, prefix + k.fName + '/', out); }));
    });
    return Promise.all(tasks).then(function () { return out; });
  }
  function axisUnit(title, xmax) {
    var t = (title || '').toLowerCase();
    if (/mev/.test(t)) return 'MeV';
    if (/kev/.test(t)) return 'keV';
    if (/chan|adc|bin|ch\b/.test(t)) return 'ch';
    return xmax > 30 ? 'keV' : 'MeV';
  }
  function readRootHist(file, name) {
    $('#fit-file-info').textContent = 'Reading ' + name + '…';
    return file.readObject(name).then(function (h) {
      var ax = h.fXaxis, n = ax.fNbins, arr = Array.from(h.fArray).slice(1, n + 1);
      var edges = ax.fXbins && ax.fXbins.length === n + 1 ? Array.from(ax.fXbins) : null;
      var lo = ax.fXmin, w = (ax.fXmax - ax.fXmin) / n;
      var unit = $('#fit-root-unit').value === 'auto' ? axisUnit(ax.fTitle, ax.fXmax) : $('#fit-root-unit').value;
      var scale = unit === 'MeV' ? 1000 : 1;
      var weighted = h.fSumw2 && h.fSumw2.length && h.fSumw2.some(function (v, i) { return i > 0 && i <= n && Math.abs(v - h.fArray[i]) > 1e-6 * Math.max(1, v); });
      var cal = unit === 'ch' ? null : { c0: (lo + w / 2) * scale, c1: w * scale, c2: 0 };
      if (edges && unit !== 'ch') {                 // variable bins: a quadratic through the bin centres approximates the axis
        var cen = edges.slice(0, n).map(function (e, i) { return (e + edges[i + 1]) / 2 * scale; }), m = Math.floor(n / 2);
        var a0 = cen[0], a1 = cen[m], a2 = cen[n - 1], x1 = m, x2 = n - 1;
        var c2 = ((a2 - a0) / x2 - (a1 - a0) / x1) / (x2 - x1);
        cal = { c0: a0, c1: (a1 - a0) / x1 - c2 * x1, c2: c2 };
      }
      var sp = { counts: arr.map(function (c) { return Math.max(0, Math.round(c)); }), xIsEnergy: false, cal: cal };
      loadSpectrum(sp, (FIT.rootName || 'ROOT file') + ': ' + name.replace(/;\d+$/, '') + ' (' + h._typename + ', x axis in ' + (unit === 'ch' ? 'channels' : unit) + ')');
      var notes = [];
      if (weighted) notes.push('This histogram has weighted entries; the fit assumes plain counts (Poisson), so its uncertainties will be off.');
      if (arr.some(function (c) { return Math.abs(c - Math.round(c)) > 1e-6; })) notes.push('Bin contents are not whole numbers; they were rounded.');
      if (notes.length) $('#fit-file-info').textContent += ' ' + notes.join(' ');
    });
  }
  function openRoot(f) {
    FIT.rootName = f.name; $('#fit-file-info').textContent = 'Opening ' + f.name + '…';
    jsroot().then(function (io) { return io.openFile(f); }).then(function (file) {
      FIT.rootFile = file;
      return listHists(file, '', []).then(function (hs) {
        var sel = $('#fit-root-hist'); sel.innerHTML = '';
        if (!hs.length) throw new Error('No TH1 histograms in this file.');
        hs.forEach(function (h) { var o = el('option', null, h.name.replace(/;\d+$/, '') + ' (' + h.cls + (h.title ? ', ' + h.title : '') + ')'); o.value = h.name; sel.appendChild(o); });
        $('#fit-root').hidden = false;
        // default to the histogram with the most bins (the spectrum, rather than a small auxiliary histogram)
        return Promise.all(hs.map(function (h) { return file.readObject(h.name).then(function (o) { return o.fXaxis.fNbins; }, function () { return 0; }); }))
          .then(function (nb) { var best = nb.indexOf(Math.max.apply(null, nb)); sel.value = hs[best].name; return readRootHist(file, hs[best].name); });
      });
    }).catch(function (err) { $('#fit-file-info').textContent = 'Could not read ' + f.name + ': ' + (err && err.message || err); });
  }

  /* simulated detector response: ROOT TH2 (gamma energy x deposited energy) or a text list of (gamma energy, deposited energy) */
  function buildMatrix(cols, dlo, dw, nd, N, smeared) {
    // cols: [{E: nominal gamma energy (keV), c: Float64Array(nd) deposited counts}], N: gammas simulated per energy (null: already per gamma)
    var E = [], dens = [], pf = [];
    cols.sort(function (a, b) { return a.E - b.E; }).forEach(function (col) {
      var c = col.c, norm = N ? 1 / N : 1, d = new Float32Array(nd), lo = Math.max(0, Math.floor((col.E - dlo) / dw) - 3), hi = Math.min(nd - 1, Math.floor((col.E - dlo) / dw) + 3);
      var pk = lo; for (var i = lo; i <= hi; i++) if (c[i] > c[pk]) pk = i;   // full-energy bin: the largest one near the gamma energy
      var cpk = dlo + (pk + 0.5) * dw, Ej = smeared || Math.abs(cpk - col.E) <= dw ? col.E : cpk, under = 0, nu = 0;
      for (i = Math.max(0, pk - 4); i <= pk - 2; i++) { under += c[i]; nu++; }
      under = nu ? under / nu : 0;
      for (i = 0; i < nd; i++) d[i] = c[i] * norm / dw;
      var p = 0;
      if (!smeared) { p = Math.max(0, c[pk] - under) * norm; d[pk] = under * norm / dw; }
      E.push(Ej); dens.push(d); pf.push(p);
    });
    return { dlo: dlo, dw: dw, nd: nd, E: E, dens: dens, pf: pf, smeared: !!smeared };
  }
  function matrixSummary(M) {
    var at = function (E) { var j = 0; while (j < M.E.length - 2 && M.E[j + 1] < E) j++; var f = Math.max(0, Math.min(1, (E - M.E[j]) / (M.E[j + 1] - M.E[j] || 1))); return (1 - f) * M.pf[j] + f * M.pf[j + 1]; };
    var tot = function (j) { var s = M.pf[j]; for (var i = 0; i < M.nd; i++) s += M.dens[j][i] * M.dw; return s; };
    var jj = Math.floor(M.E.length / 2);
    return M.E.length + ' simulated energies, ' + fmt(M.E[0], 0) + '–' + fmt(M.E[M.E.length - 1], 0) + ' keV, deposits binned in ' + (+M.dw.toPrecision(3)) + ' keV. ' +
      (M.smeared ? 'Resolution already included.' : 'Full-energy probability per emitted gamma: ' + [662, 1461, 2615].filter(function (e) { return e <= M.E[M.E.length - 1]; }).map(function (e) { return (+at(e).toPrecision(2)) + ' at ' + e + ' keV'; }).join(', ') + '.') +
      ' Total detection probability at ' + fmt(M.E[jj], 0) + ' keV: ' + (+tot(jj).toPrecision(2)) + '.';
  }
  function respFromTH2(h, orient, unit, N, smeared) {
    var nx = h.fXaxis.fNbins, ny = h.fYaxis.fNbins, sx = h.fXaxis, sy = h.fYaxis;
    var at = function (ix, iy) { return h.fArray[ix + (nx + 2) * iy]; };
    var cen = function (ax, i) { return ax.fXbins && ax.fXbins.length ? (ax.fXbins[i - 1] + ax.fXbins[i]) / 2 : ax.fXmin + (i - 0.5) * (ax.fXmax - ax.fXmin) / ax.fNbins; };
    if (orient === 'auto') {                        // the gamma-energy axis is the one the deposits never exceed (lower triangle)
      var above = [0, 0];
      for (var ix = 1; ix <= nx; ix++) for (var iy = 1; iy <= ny; iy++) {
        var v = at(ix, iy); if (!v) continue;
        if (cen(sy, iy) > cen(sx, ix) * 1.02 + 2 * (sy.fXmax - sy.fXmin) / ny) above[0] += v;
        if (cen(sx, ix) > cen(sy, iy) * 1.02 + 2 * (sx.fXmax - sx.fXmin) / nx) above[1] += v;
      }
      orient = above[0] <= above[1] ? 'x' : 'y';
    }
    var tAx = orient === 'x' ? sx : sy, dAx = orient === 'x' ? sy : sx, nt = tAx.fNbins, nd = dAx.fNbins;
    var u = unit === 'auto' ? (/mev/i.test(tAx.fTitle + dAx.fTitle) ? 'MeV' : (dAx.fXmax < 30 ? 'MeV' : 'keV')) : unit, sc = u === 'MeV' ? 1000 : 1;
    var dlo = dAx.fXmin * sc, dw = (dAx.fXmax - dAx.fXmin) * sc / nd, cols = [];
    for (var it = 1; it <= nt; it++) {
      var c = new Float64Array(nd), sum = 0;
      for (var id = 1; id <= nd; id++) { var w = orient === 'x' ? at(it, id) : at(id, it); c[id - 1] = w; sum += w; }
      if (sum > 0) cols.push({ E: cen(tAx, it) * sc, c: c });
    }
    if (cols.length < 2) throw new Error('Need at least two simulated gamma energies (filled bins along the gamma-energy axis).');
    return buildMatrix(cols, dlo, dw, nd, N, smeared);
  }
  function respFromText(text, N, smeared, unit) {
    var by = {}, maxd = 0;
    text.split(/\r?\n/).forEach(function (l) {
      var v = l.trim().split(/[\s,;]+/).map(Number);
      if (v.length < 2 || v.some(isNaN)) return;
      var sc = unit === 'MeV' ? 1000 : 1, E = v[0] * sc, d = v[1] * sc;
      (by[E] = by[E] || []).push(d); if (d > maxd) maxd = d;
    });
    var Es = Object.keys(by).map(Number);
    if (Es.length < 2) throw new Error('Need events at two or more gamma energies: two columns, gamma energy and deposited energy.');
    var dw = Math.max(0.5, Math.pow(10, Math.round(Math.log10(maxd / 3000) * 2) / 2)), nd = Math.ceil(maxd * 1.02 / dw) + 1;
    var cols = Es.map(function (E) { var c = new Float64Array(nd); by[E].forEach(function (d) { if (d > 0) c[Math.min(nd - 1, Math.floor(d / dw))] += 1; }); return { E: E, c: c }; });
    return buildMatrix(cols, 0, dw, nd, N, smeared);
  }
  function respOptions() {
    var N = parseFloat($('#resp-n').value);
    return { N: $('#resp-norm').checked ? null : (N > 0 ? N : NaN), smeared: $('#resp-smeared').checked, orient: $('#resp-orient').value, unit: $('#resp-unit').value };
  }
  function loadResponse() {
    var f = FIT.respFileObj; if (!f) return;
    var o = respOptions(), info = $('#resp-info');
    if (o.N !== null && !(o.N > 0)) { info.textContent = 'Enter how many gammas were simulated at each energy, or tick “already per emitted gamma”.'; return; }
    var done = function (M) {
      FIT.matrix = M; info.textContent = f.name + ': ' + matrixSummary(M);
      var opt = $('#fit-mode option[value=matrix]'); opt.disabled = false; $('#fit-mode').value = 'matrix';
      if (FIT.counts) renderParams(defaultParams());
    };
    var fail = function (err) { info.textContent = 'Could not use ' + f.name + ': ' + (err && err.message || err); };
    if (/\.root$/i.test(f.name)) {
      jsroot().then(function (io) { return io.openFile(f); }).then(function (file) {
        var hs = [];
        (file.fKeys || []).forEach(function (k) { if (/^TH2[FDIS]?$/.test(k.fClassName)) hs.push(k.fName + ';' + k.fCycle); });
        if (!hs.length) throw new Error('No TH2 histogram in this file.');
        var sel = $('#resp-hist');
        if (!sel.options.length || FIT.respFileName !== f.name) { sel.innerHTML = ''; hs.forEach(function (n) { var op = el('option', null, n.replace(/;\d+$/, '')); op.value = n; sel.appendChild(op); }); FIT.respFileName = f.name; }
        $('#resp-hist-wrap').hidden = hs.length < 2;
        return file.readObject(sel.value || hs[0]).then(function (h) { done(respFromTH2(h, o.orient, o.unit, o.N, o.smeared)); });
      }).catch(fail);
    } else f.text().then(function (t) { try { done(respFromText(t, o.N, o.smeared, o.unit === 'MeV' ? 'MeV' : 'keV')); } catch (e) { fail(e); } });
  }

  function loadSpectrum(sp, name) {
    $('#fit-out').innerHTML = ''; $('#fit-status').textContent = ''; FIT.result = null;
    FIT.counts = sp.counts; FIT.xIsEnergy = false; FIT.cal = sp.cal; FIT.name = name;
    if (sp.xIsEnergy) { FIT.xIsEnergy = false; FIT.cal = sp.cal; }   // energies become a linear calibration with small corrections
    var n = sp.counts.length, cal = FIT.cal || { c0: 0, c1: 1, c2: 0 };
    $('#fit-file-info').textContent = name + ': ' + n + ' channels, ' + sp.counts.reduce(function (a, b) { return a + b; }, 0).toLocaleString('en-US') + ' counts' +
      (FIT.cal ? '' : '. No energy calibration found: enter c₀ and c₁ below.');
    var Emax = cal.c0 + cal.c1 * (n - 1);
    $('#fit-emin').value = Math.round(Math.max(cal.c0, ctx.det[0] === 'hpge' ? 150 : 200));
    $('#fit-emax').value = Math.round(Math.min(Emax, 3000));
    renderParams(defaultParams());
    $('#fit-run').disabled = false;
  }
  function exampleSpectrum(kind) {     // simulated with the fit model itself (clearly labelled), for trying the tool
    var R = (function () { var s = 12345; return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })();
    function pois(l) { if (l > 40) { var u = R(), v = R(); return Math.max(0, Math.round(l + Math.sqrt(l) * Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v))); }
      var L = Math.exp(-l), k = 0, p = 1; do { k++; p *= R(); } while (p > L); return k - 1; }
    var hp = kind === 'hpge', n = hp ? 8192 : 1024;
    var p = hp ? { c0: 0.6, c1: 0.3752, c2: 0, a: 0.9, b: 0.0018, c: 0, e1: -0.8, e2: -0.1, step: 0.004, tail: 0, tailw: 1, se: 0.06, de: 0.03, pt: 0, ptk: 0, shelf: 0, bs: 0 }
               : { c0: 4, c1: 3.02, c2: 0, a: 4, b: 3.0, c: 0.0001, e1: -0.6, e2: -0.1, step: 0, tail: 0, tailw: 1, se: 0, de: 0, pt: 0.45, ptk: 0.65, shelf: 0.2, bs: 0.06 };
    var g = new GammaFit.Grid(n, 0, n, p), mu = new Float64Array(n);
    var pick = function (re) { return GROUPS.filter(function (s) { return re.test(s.id); })[0]; };
    var comps = [[BYID['d:40K'], hp ? 3e4 : 2e5], [pick(/U238\|²²²Rn/), hp ? 2e4 : 1.5e5], [pick(/Th232\|²²⁸Th/), hp ? 1e4 : 1e5], [pick(/Th232\|²²⁸Ra/), hp ? 8e3 : 6e4]];
    comps.forEach(function (c) {
      if (!c[0]) return;
      var t = GammaFit.template({ lines: c[0].L }, g, p, hp ? 'local' : 'compton'); if (!t) return;
      for (var i = 0; i < t.v.length; i++) mu[t.idx[i]] += c[1] * t.v[i];
    });
    for (var i = 0; i < n; i++) mu[i] += (hp ? 30 * Math.exp(-g.E[i] / 600) + 2 : 20 * Math.exp(-g.E[i] / 900) + 1) * g.dE[i];
    return { counts: Array.from(mu, pois), xIsEnergy: false, cal: { c0: hp ? 0.3 : 0, c1: hp ? 0.375 : 3.0, c2: 0 } };
  }
  function candidates(Elo, Ehi) {
    var members = {}, list = [];
    GROUPS.forEach(function (g) { g.group.forEach(function (m) { members[m.id] = 1; }); });
    sources().concat(GROUPS).forEach(function (s) {
      if (members[s.id] || !s.L || !s.L.length || s.kind === 'xray') return;
      var best = 0;
      s.L.forEach(function (l) { if (l[0] >= Elo && l[0] <= Ehi) best = Math.max(best, lineRate(s, l)); });
      if (best > 0) list.push({ s: s, score: best });
    });
    list.sort(function (a, b) { return b.score - a.score; });
    var N = Math.max(5, Math.min(300, +$('#fit-ncand').value || 60)), top = list.length ? list[0].score : 1;
    return list.slice(0, N).map(function (c) {
      var r = rel(c.score, top);
      return { id: c.s.id, name: c.s.name.replace(/<[^>]+>/g, ''), prior: Math.pow(10, -4 * (1 - r)),
               lines: c.s.L.filter(function (l) { return l[1] > 0; }).map(function (l) { return [l[0], l[1], l[2] || '']; }) };
    });
  }
  function runFit() {
    if (!FIT.counts) return;
    var P = readParams(), cal = { c0: P.c0.value, c1: P.c1.value, c2: P.c2.value };
    var Elo = +$('#fit-emin').value, Ehi = +$('#fit-emax').value, n = FIT.counts.length;
    var ch = function (E) { return cal.c2 ? (-cal.c1 + Math.sqrt(cal.c1 * cal.c1 + 4 * cal.c2 * (E - cal.c0))) / (2 * cal.c2) : (E - cal.c0) / cal.c1; };
    var lo = Math.max(0, Math.floor(ch(Elo))), hi = Math.min(n, Math.ceil(ch(Ehi)) + 1);
    if (!(hi - lo > 20)) { $('#fit-status').textContent = 'The fit range covers too few channels: check the calibration and range.'; return; }
    var cands = candidates(Elo, Ehi), out = $('#fit-out');
    out.innerHTML = '';
    $('#fit-status').textContent = 'Starting…'; $('#fit-run').disabled = true;
    if (FIT.worker) FIT.worker.terminate();
    FIT.worker = new Worker('assets/gammafit-core.js?v=20261123a');
    FIT.worker.onmessage = function (e) {
      var d = e.data;
      if (d.progress) { $('#fit-status').textContent = d.progress; return; }
      $('#fit-run').disabled = false;
      if (d.error) { $('#fit-status').textContent = 'The fit failed: ' + d.error.split('\n')[0]; return; }
      FIT.result = d.result; FIT.cands = cands; d.result.mode = fitMode();
      $('#fit-status').textContent = 'Done in ' + (d.result.ms / 1000).toFixed(1) + ' s.';
      renderFit(d.result, P);
    };
    if ($('#fit-mode').value === 'matrix' && !FIT.matrix) { $('#fit-status').textContent = 'Upload a simulated response first (below), or choose another response model.'; $('#fit-run').disabled = false; return; }
    FIT.worker.postMessage({ counts: FIT.counts, lo: lo, hi: hi, mode: fitMode(), params: P, sources: cands, matrix: fitMode() === 'matrix' ? FIT.matrix : null,
                             knots: +$('#fit-knots').value || (fitMode() === 'compton' ? 6 : 14), threshold: +$('#fit-thr').value || 9 });
  }
  var FITCOL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  function renderFit(r, P) {
    var out = $('#fit-out'); out.innerHTML = '';
    var red = r.ndf > 0 ? r.deviance / r.ndf : null;
    out.appendChild(el('p', 'gx-small', 'Goodness of fit: deviance ' + r.deviance.toFixed(0) + ' for ' + r.ndf + ' degrees of freedom' +
      (red ? ' (ratio ' + red.toFixed(2) + (red > 1.5 ? ': the model misses something; check the residuals below' : '') + ')' : '') + '.'));
    // plot
    var wrap = el('div', 'gx-fitplot'), cv = document.createElement('canvas'), shown = r.sources.filter(function (s) { return r.components[s.id]; }).slice(0, 8);
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Spectrum, fitted model, background and the largest source components (log scale), with residuals below');
    wrap.appendChild(cv); out.appendChild(wrap);
    var leg = el('div', 'gx-legend');
    [['Data', 'dot', '#8a8a8a'], ['Total model', 'line', null], ['Smooth background', 'dash', null]].concat(shown.map(function (s, i) { return [s.name, 'line', FITCOL[i]]; }))
      .forEach(function (l) { var it = el('span', 'gx-leg ' + l[1]); var sw = el('i'); if (l[2]) sw.style.background = l[2]; it.appendChild(sw); it.appendChild(document.createTextNode(l[0])); leg.appendChild(it); });
    out.appendChild(leg);
    drawFit(cv, r, shown);
    // sources table
    out.appendChild(el('h3', null, 'Sources in the fit'));
    var t = el('table', 'gx-table'), th = el('tr');
    var mat = r.mode === 'matrix';
    ['Source', 'Counts in range', '±'].concat(mat ? ['Decays in the measurement', '±'] : []).concat(['Significance', 'Prior from ranking']).forEach(function (h) { th.appendChild(el('th', null, h)); });
    t.appendChild(th);
    r.sources.forEach(function (s, i) {
      var tr = el('tr'), td = el('td');
      var a = srcLink(s.id); a.textContent = s.name; td.appendChild(a);
      if (i < 8 && r.components[s.id]) { var sw = el('i', 'gx-sw'); sw.style.background = FITCOL[i]; td.insertBefore(sw, a); }
      tr.appendChild(td);
      tr.appendChild(el('td', 'num', Math.round(s.counts).toLocaleString('en-US')));
      tr.appendChild(el('td', 'num', Math.round(s.sigma).toLocaleString('en-US')));
      if (mat) { tr.appendChild(el('td', 'num', (+s.decays.toPrecision(4)).toLocaleString('en-US'))); tr.appendChild(el('td', 'num', (+s.decaysSigma.toPrecision(2)).toLocaleString('en-US'))); }
      tr.appendChild(el('td', 'num', s.dchi2 > 0 ? Math.sqrt(s.dchi2).toFixed(1) + 'σ' : '—'));
      tr.appendChild(el('td', 'num', s.prior >= 0.1 ? 'high' : s.prior >= 1e-2 ? 'medium' : 'low'));
      t.appendChild(tr);
    });
    out.appendChild(t);
    if (mat) out.appendChild(el('p', 'gx-note', 'Decays: number of decays of that source during the measurement, using the absolute efficiency of your simulated response (for a chain segment, decays of its parent). Divide by the live time for the activity; this assumes the simulation\'s source geometry matches the measurement.'));
    out.appendChild(el('p', 'gx-note', 'Counts: from that source inside the fit range (photopeaks, plus the continuum in the Compton and simulated-response modes). ± includes correlations with the response parameters. Significance: √Δχ², where Δχ² is how much worse the fit gets without the source. A source with a low prior had to clear a higher bar to be kept.'));
    // parameters table
    out.appendChild(el('h3', null, 'Response parameters'));
    var t2 = el('table', 'gx-table'), h2 = el('tr');
    ['Parameter', 'Fitted', '±', 'Your prior', 'Pull'].forEach(function (h) { h2.appendChild(el('th', null, h)); });
    t2.appendChild(h2);
    Object.keys(r.theta).forEach(function (k) {
      var v = r.theta[k], pr = P[k], tr = el('tr');
      var pull = pr.sigma ? (v.value - pr.value) / pr.sigma : 0;
      tr.appendChild(el('td', null, PDEF[k][0]));
      tr.appendChild(el('td', 'num', (+v.value).toPrecision(4)));
      tr.appendChild(el('td', 'num', v.sigma != null ? (+v.sigma).toPrecision(2) : '—'));
      tr.appendChild(el('td', 'num', (+pr.value).toPrecision(4) + ' ± ' + (+pr.sigma).toPrecision(2)));
      var pc = el('td', 'num', pull.toFixed(1)); if (Math.abs(pull) > 3) pc.className += ' gx-warn';
      tr.appendChild(pc); t2.appendChild(tr);
    });
    out.appendChild(t2);
    out.appendChild(el('p', 'gx-note', 'A pull beyond ±3 means the data disagree with your prior: worth checking the calibration or detector settings.'));
    var dl = el('button', 'mini', 'Download results (CSV)'); dl.type = 'button';
    dl.addEventListener('click', function () {
      var rows = [['source', 'id', 'counts', 'sigma', 'significance_sigma'].concat(mat ? ['decays', 'decays_sigma'] : [])].concat(r.sources.map(function (s) { return [s.name, s.id, s.counts.toFixed(1), s.sigma.toFixed(1), s.dchi2 > 0 ? Math.sqrt(s.dchi2).toFixed(2) : ''].concat(mat ? [s.decays.toPrecision(5), s.decaysSigma.toPrecision(3)] : []); }));
      rows.push([]); rows.push(['parameter', 'fitted', 'sigma', 'prior', 'prior_sigma']);
      Object.keys(r.theta).forEach(function (k) { rows.push([k, r.theta[k].value, r.theta[k].sigma, P[k].value, P[k].sigma]); });
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(function (x) { return x.join(','); }).join('\n')], { type: 'text/csv' }));
      a.download = 'gamma-fit-results.csv'; document.body.appendChild(a); a.click(); a.remove();
    });
    out.appendChild(dl);
  }
  function drawFit(cv, r, shown) {
    var W = cv.parentNode.clientWidth || 800, H = 420, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var c = cv.getContext('2d'); c.scale(dpr, dpr);
    var css = getComputedStyle(document.documentElement), ink = css.getPropertyValue('--ink').trim() || '#111', muted = css.getPropertyValue('--muted').trim() || '#666', line = css.getPropertyValue('--line').trim() || '#ddd';
    var L = 70, Rm = 12, T = 10, mainH = 300, gap = 22, resH = H - T - mainH - gap - 44;
    var E = r.E, x0 = E[0], x1 = E[E.length - 1];
    var ymax = Math.max.apply(null, r.data.concat(r.model)) * 2, ymin = 0.5;
    var X = function (e) { return L + (e - x0) / (x1 - x0) * (W - L - Rm); };
    var Y = function (v) { return T + mainH - (Math.log10(Math.max(v, ymin)) - Math.log10(ymin)) / (Math.log10(ymax) - Math.log10(ymin)) * mainH; };
    c.font = '12px Roboto, sans-serif'; c.fillStyle = muted; c.strokeStyle = line; c.lineWidth = 1;
    for (var d = 0; d <= Math.ceil(Math.log10(ymax)); d++) { var yy = Y(Math.pow(10, d)); if (yy < T) continue; c.beginPath(); c.moveTo(L, yy); c.lineTo(W - Rm, yy); c.stroke(); c.fillText('10' + '⁰¹²³⁴⁵⁶⁷⁸⁹'[d], 34, yy + 4); }
    var step = Math.pow(10, Math.floor(Math.log10((x1 - x0) / 5))); if ((x1 - x0) / step > 10) step *= 2; if ((x1 - x0) / step > 10) step *= 2.5;
    for (var e = Math.ceil(x0 / step) * step; e <= x1; e += step) { c.fillText(Math.round(e), X(e) - 12, H - 22); }
    c.fillText('Energy (keV)', L + (W - L - Rm) / 2 - 36, H - 4);
    c.save(); c.translate(14, T + mainH / 2 + 20); c.rotate(-Math.PI / 2); c.fillText('counts per channel', 0, 0); c.restore();
    // data
    c.fillStyle = '#8a8a8a';
    var every = Math.max(1, Math.floor(E.length / (W - L - Rm) / 1.5));
    for (var i = 0; i < E.length; i += every) { if (r.data[i] > 0) c.fillRect(X(E[i]) - 1, Y(r.data[i]) - 1, 2, 2); }
    function curve(arr, color, dash, width) {        // breaks where the curve drops below the plotted range
      c.beginPath(); c.strokeStyle = color; c.lineWidth = width || 1.5; c.setLineDash(dash || []);
      var pen = false;
      for (var i = 0; i < E.length; i++) {
        if (!(arr[i] > ymin)) { pen = false; continue; }
        var px = X(E[i]), py = Y(arr[i]); if (pen) c.lineTo(px, py); else c.moveTo(px, py); pen = true;
      }
      c.stroke(); c.setLineDash([]);
    }
    shown.forEach(function (s, k) { curve(r.components[s.id], FITCOL[k], null, 1.2); });
    curve(r.background, muted, [5, 4], 1.5);
    curve(r.model, ink, null, 1.5);
    // residuals (deviance residuals)
    var yr0 = T + mainH + gap, mid = yr0 + resH / 2, rs = resH / 2 / 5;
    c.strokeStyle = line; c.beginPath(); c.moveTo(L, mid); c.lineTo(W - Rm, mid); c.stroke();
    [-3, 3].forEach(function (z) { c.setLineDash([2, 3]); c.beginPath(); c.moveTo(L, mid - z * rs); c.lineTo(W - Rm, mid - z * rs); c.stroke(); c.setLineDash([]); });
    c.fillStyle = muted; c.fillText('±3', 22, mid - 3 * rs + 4); c.fillText('resid.', 8, mid + 4);
    c.fillStyle = ink;
    for (i = 0; i < E.length; i += every) {
      var m = Math.max(r.model[i], 1e-9), y = r.data[i], dv = 2 * (m - y + (y > 0 ? y * Math.log(y / m) : 0)), z = (y >= m ? 1 : -1) * Math.sqrt(Math.max(dv, 0));
      z = Math.max(-5, Math.min(5, z)); c.fillRect(X(E[i]) - 0.5, mid - z * rs - 0.5, 1.5, 1.5);
    }
  }
  function buildFit() {
    $('#fit-file').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      $('#fit-root').hidden = true; FIT.rootFile = null;
      if (/\.root$/i.test(f.name)) { openRoot(f); return; }
      f.text().then(function (t) { try { loadSpectrum(parseSpectrum(t, f.name), f.name); } catch (err) { $('#fit-file-info').textContent = err.message; } });
    });
    $('#fit-ex-hpge').addEventListener('click', function () { ctx.det = ['hpge']; ctx.fwhm = FWHM1MEV.hpge; refreshChips(); save(); setupSummary(); $('#fit-mode').value = 'auto'; loadSpectrum(exampleSpectrum('hpge'), 'Simulated HPGe spectrum (⁴⁰K, ²²²Rn progeny, ²²⁸Th and ²²⁸Ra segments)'); });
    $('#fit-ex-nai').addEventListener('click', function () { ctx.det = ['nai']; ctx.fwhm = FWHM1MEV.nai; refreshChips(); save(); setupSummary(); $('#fit-mode').value = 'auto'; loadSpectrum(exampleSpectrum('nai'), 'Simulated NaI(Tl) spectrum (⁴⁰K, ²²²Rn progeny, ²²⁸Th and ²²⁸Ra segments)'); });
    $('#fit-mode').addEventListener('change', function () { if (FIT.counts) renderParams(defaultParams()); });
    $('#resp-file').addEventListener('change', function () { FIT.respFileObj = this.files[0] || null; $('#resp-hist').innerHTML = ''; loadResponse(); });
    ['resp-n', 'resp-norm', 'resp-smeared', 'resp-orient', 'resp-unit', 'resp-hist'].forEach(function (id) { $('#' + id).addEventListener('change', loadResponse); });
    $('#fit-root-hist').addEventListener('change', function () { if (FIT.rootFile) readRootHist(FIT.rootFile, this.value); });
    $('#fit-root-unit').addEventListener('change', function () { if (FIT.rootFile) readRootHist(FIT.rootFile, $('#fit-root-hist').value); });
    $('#fit-reset').addEventListener('click', function () { renderParams(defaultParams()); });
    $('#fit-run').addEventListener('click', runFit);
    window.addEventListener('resize', function () { var cv = document.querySelector('.gx-fitplot canvas'); if (cv && FIT.result) drawFit(cv, FIT.result, FIT.result.sources.filter(function (s) { return FIT.result.components[s.id]; }).slice(0, 8)); });
  }

  /* ------------------------------------------------------------ decay chains (data/gamma/chains.json) */
  var CHAINS = null;
  var MODE = { 'A': 'α', 'B-': 'β⁻', 'B+': 'β⁺', 'EC': 'EC', 'EC+B+': 'EC + β⁺', 'IT': 'IT (isomeric transition)', 'SF': 'spontaneous fission', 'B-N': 'β⁻n (delayed neutron)', 'B-A': 'β⁻α', '2B-': 'ββ' };
  function modeName(m) {
    if (MODE[m]) return MODE[m];
    var c = m.replace(/[{}+]/g, '').match(/^(\d+)([A-Za-z]+)$/);
    return c ? 'cluster (' + pretty(c[1] + c[2].charAt(0).toUpperCase() + c[2].slice(1).toLowerCase()) + ')' : m;
  }
  function pct(p) { return p == null ? '' : p >= 1 ? (+p.toPrecision(4)) + '%' : p >= 1e-3 ? (+p.toPrecision(3)) + '%' : p.toExponential(1).replace('e', '×10^') + '%'; }
  function afText(a) { return a >= 0.999 ? '1' : a >= 1e-3 ? (+a.toPrecision(3)).toString() : a > 0 ? a.toExponential(1).replace('e', '×10^') : '< 10⁻⁶'; }
  function loadChains() {
    if (CHAINS) return Promise.resolve(CHAINS);
    return load('data/gamma/chains.json').then(function (d) {
      CHAINS = d;
      var sel = $('#chain-select');
      d.chains.forEach(function (c) { var o = el('option', null, c.title); o.value = c.id; sel.appendChild(o); });
      sel.addEventListener('change', function () { renderChain(this.value); history.replaceState(null, '', '#chain=' + this.value); });
      return d;
    });
  }
  function table(headers, rows, cls) {
    var t = el('table', 'gx-table ' + (cls || '')), tr = el('tr');
    headers.forEach(function (h) { var th = el('th'); th.innerHTML = h; tr.appendChild(th); });
    t.appendChild(tr);
    rows.forEach(function (r) {
      var row = el('tr');
      r.forEach(function (v, i) { var td = el('td', typeof v === 'number' || /^[\d.,×^⁻ <>-]+%?$/.test(String(v)) ? 'num' : null); if (v && v.nodeType) td.appendChild(v); else td.innerHTML = v == null ? '' : v; row.appendChild(td); });
      t.appendChild(row);
    });
    return t;
  }
  /* decay-chain diagram: rows are mass numbers A (down) and columns are (Z - N)/2, so every alpha decay points straight down,
     beta-minus one column right, EC/beta-plus one column left; edges carry the mode and any branching below 100% */
  var EDGE = { 'A': ['α', 'alpha'], 'B-': ['β⁻', 'beta'], 'B+': ['β⁺', 'ec'], 'EC': ['EC', 'ec'], 'EC+B+': ['EC/β⁺', 'ec'], 'IT': ['IT', 'it'], 'B-N': ['β⁻n', 'beta'], 'B-A': ['β⁻α', 'beta'] };
  function hlShort(s) {
    if (s == null) return 'stable';
    var u = [[3.156e7, 'y'], [86400, 'd'], [3600, 'h'], [60, 'min'], [1, 's'], [1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns']];
    for (var i = 0; i < u.length; i++) if (s >= u[i][0] || i === u.length - 1) {
      var v = s / u[i][0];
      return (v >= 1e5 ? v.toExponential(2).replace(/e\+?(\d+)/, function (_, e) { return '×10' + e.split('').map(function (c) { return SUP[c]; }).join(''); }) : +v.toPrecision(3)) + ' ' + u[i][1];
    }
  }
  var ELEMENTS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba ' +
    'La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm').split(' ');
  // members whose gammas are strong enough to show up in a detector or an assay: some line above 40 keV with at
  // least 0.5 gammas per 100 decays of the chain parent (intensity x relative activity); annihilation radiation does not count
  function keyGamma(m) {
    if (m.stable || !m.gammas) return null;
    var best = null;
    m.gammas.forEach(function (g) { var y = g[1] * (m.af || 0); if (g[0] >= 40 && Math.abs(g[0] - 511) > 0.2 && y >= 0.5 && (!best || y > best[1])) best = [g[0], y];   // not the annihilation line });
    return best;
  }
  function chainDiagram(c, onPick) {
    var NS = 'http://www.w3.org/2000/svg', mk = function (t, a, txt) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; };
    var za = function (n) { var m = /^(\d+)(m?)([A-Z][a-z]?)$/.exec(n); return { A: +m[1], iso: !!m[2], sym: m[3] }; };
    var Zof = {}, nodes = {};
    c.members.forEach(function (m) { var p = za(m.nuc); nodes[m.nuc] = { m: m, A: p.A, iso: p.iso, sym: p.sym }; });
    Object.keys(nodes).forEach(function (n) { Zof[n] = ELEMENTS.indexOf(nodes[n].sym) + 1; });
    var Zp = Zof[c.top];
    var As = [], Zs = [];
    Object.keys(nodes).forEach(function (n) { var d = nodes[n]; d.Z = Zof[n] != null ? Zof[n] : Zp; if (As.indexOf(d.A) < 0) As.push(d.A); if (Zs.indexOf(d.Z) < 0) Zs.push(d.Z); });
    As.sort(function (a, b) { return b - a; });
    Zs = []; Object.keys(nodes).forEach(function (n) { var d = nodes[n]; d.col = d.Z - d.A / 2; if (Zs.indexOf(d.col) < 0) Zs.push(d.col); });
    var zmin = Math.min.apply(null, Zs), zmax = Math.max.apply(null, Zs);
    var W = 100, H = 44, CW = 172, PADL = 50, PADT = 12, GAP = 40;
    // a cell holding an isomer and its ground state stacks them; such rows get extra height
    var cells = {};
    Object.keys(nodes).forEach(function (n) { var d = nodes[n], k = d.A + ':' + d.col; (cells[k] = cells[k] || []).push(n); });
    var rowY = {}, y = PADT;
    As.forEach(function (A) {
      var tall = Object.keys(cells).some(function (k) { return +k.split(':')[0] === A && cells[k].length > 1; });
      rowY[A] = y + (tall ? H + 13 : H / 2); y += (tall ? 2 * H + 26 : H) + GAP;
    });
    Object.keys(cells).forEach(function (k) {
      var list = cells[k].sort(function (a, b) { return nodes[b].iso - nodes[a].iso; });
      list.forEach(function (n, i) { var d = nodes[n]; d.x = PADL + (d.col - zmin) * CW + CW / 2; d.y = rowY[d.A] + (list.length > 1 ? (i - (list.length - 1) / 2) * (H + 26) : 0); });
    });
    var width = PADL + (zmax - zmin + 1) * CW + 8, height = y - GAP + 10;
    var svg = mk('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, role: 'img', 'class': 'gx-cdiag',
      'aria-label': 'Decay diagram of the ' + c.title + ': alpha decays point down, beta-minus decays to the right, arrows labelled with the decay mode and branching' });
    var defs = mk('defs');
    ['alpha', 'beta', 'ec', 'it'].forEach(function (k) {
      var mkr = mk('marker', { id: 'gx-ar-' + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
      mkr.appendChild(mk('path', { d: 'M0,0 L10,5 L0,10 z', 'class': 'gx-e-' + k + ' gx-ahead' })); defs.appendChild(mkr);
    });
    svg.appendChild(defs);
    As.forEach(function (A) { svg.appendChild(mk('text', { x: 4, y: rowY[A] + 4, 'class': 'gx-daxis' }, 'A=' + A)); });
    var clip = function (from, to) {                   // where the segment leaves the source box and meets the target box
      var dx = to.x - from.x, dy = to.y - from.y, f = function (d) { var tx = Math.abs(dx) > 1e-9 ? (W / 2 + 3) / Math.abs(dx) : 1e9, ty = Math.abs(dy) > 1e-9 ? (H / 2 + 3) / Math.abs(dy) : 1e9; return Math.min(tx, ty); };
      var t0 = f(), t1 = 1 - f();
      return [from.x + dx * t0, from.y + dy * t0, from.x + dx * t1, from.y + dy * t1];
    };
    var gE = mk('g'), gL = mk('g'), gN = mk('g');
    c.edges.forEach(function (e) {
      var a = nodes[e[0]], b = nodes[e[1]]; if (!a || !b) return;
      var info = EDGE[e[2]] || [e[2], 'it'], p = clip(a, b), minor = e[3] < 1;
      gE.appendChild(mk('line', { x1: p[0], y1: p[1], x2: p[2], y2: p[3], 'class': 'gx-edge gx-e-' + info[1] + (minor ? ' minor' : ''), 'marker-end': 'url(#gx-ar-' + info[1] + ')' }));
      var lab = info[0] + (e[3] < 99.995 ? ' ' + pct(e[3]).replace(/×10\^(-?\d+)/, function (_, x) { return '×10' + x.replace('-', '⁻').split('').map(function (ch) { return SUP[ch] || ch; }).join(''); }) : '');
      var mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2, vert = Math.abs(p[2] - p[0]) < Math.abs(p[3] - p[1]) * 0.6;
      var t = mk('text', vert ? { x: mx + 7, y: my + 4, 'text-anchor': 'start', 'class': 'gx-elabel' } : { x: mx, y: my - 7, 'text-anchor': 'middle', 'class': 'gx-elabel' }, lab);
      var ttl = mk('title', {}, pretty(e[0]) + ' → ' + pretty(e[1]) + ': ' + modeName(e[2]) + ', ' + pct(e[3]) + ' of ' + pretty(e[0]) + ' decays'); t.appendChild(ttl);
      gL.appendChild(t);
    });
    Object.keys(nodes).forEach(function (n) {
      var d = nodes[n], m = d.m, kg = keyGamma(m), g = mk('g', { 'class': 'gx-dnode' + (m.stable ? ' stable' : '') + (kg ? ' key' : ''), tabindex: 0, role: 'button',
        'aria-label': m.name + (m.stable ? ', stable' : ', half-life ' + hlText(m.hl) + ', relative activity ' + afText(m.af)) + (kg ? ', strong gamma at ' + fmt(kg[0], 1) + ' keV' : '') });
      g.appendChild(mk('rect', { x: d.x - W / 2, y: d.y - H / 2, width: W, height: H, rx: 6 }));
      g.appendChild(mk('text', { x: d.x, y: d.y - 3, 'text-anchor': 'middle', 'class': 'gx-dname' }, m.name));
      g.appendChild(mk('text', { x: d.x, y: d.y + 13, 'text-anchor': 'middle', 'class': 'gx-dhl' }, m.stable ? (m.hl ? hlShort(m.hl) + ' (stable)' : 'stable') : hlShort(m.hl)));
      g.appendChild(mk('title', {}, m.name + (m.stable ? ' (stable)' : ' · T½ ' + hlText(m.hl).replace(/<[^>]+>/g, '') + ' · relative activity ' + afText(m.af)) + (kg ? ' · strongest gamma ' + fmt(kg[0], 1) + ' keV, ' + (+kg[1].toPrecision(3)) + ' per 100 parent decays' : '')));
      var pick = function () { onPick(n); };
      g.addEventListener('click', pick); g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      gN.appendChild(g);
    });
    svg.appendChild(gE); svg.appendChild(gN); svg.appendChild(gL);
    var wrap = el('div', 'gx-cdiag-wrap'); wrap.appendChild(svg);
    return wrap;
  }
  function renderChain(id) {
    var c = CHAINS.chains.filter(function (x) { return x.id === id; })[0], out = $('#chain-out');
    out.innerHTML = ''; if (!c) return;
    $('#chain-select').value = id;
    out.appendChild(el('p', 'gx-note', 'Activities are relative to the chain parent in secular equilibrium (all members decaying at the parent\'s rate, scaled by branching). ' +
      'Gamma intensities are per 100 decays of that nuclide; “per parent decay” multiplies by its relative activity. Click a member for every radiation it emits and the gammas emitted together with each line.'));
    if (c.edges && c.edges.length) {
      out.appendChild(chainDiagram(c, function (n) {
        var li = document.getElementById('cm-' + n); if (!li) return;
        var d = li.querySelector('details'); if (d) d.open = true;
        li.scrollIntoView({ behavior: 'smooth', block: 'start' }); li.classList.add('flash'); setTimeout(function () { li.classList.remove('flash'); }, 1600);
      }));
      out.appendChild(el('p', 'gx-small', 'Each row is one mass number A. α decays point straight down (A − 4), β⁻ decays one step to the right and EC/β⁺ one step to the left (same A), so a nuclide with two arrows leaving it is a branch point. Arrows give the decay mode and, where a nuclide branches, the percentage of its decays that take that path; dashed arrows are branches below 1%. Nuclides in bold emit a gamma line above 40 keV with at least 0.5 gammas per 100 decays of the chain parent: these are the ones likely to show up in a detector spectrum or in HPGe assay data. Select a nuclide for its details below.'));
    }
    var list = el('ol', 'gx-chain');
    c.members.forEach(function (m, idx) {
      var li = el('li', 'gx-cmember' + (m.stable ? ' stable' : '') + (keyGamma(m) ? ' key' : '')); li.id = 'cm-' + m.nuc;
      var head = el('div', 'gx-chead');
      var nm = el('span', 'gx-cnuc'); nm.innerHTML = m.name;
      if (!m.stable && (BYID[m.id])) { var a = srcLink(m.id); a.innerHTML = m.name; nm.innerHTML = ''; nm.appendChild(a); }
      head.appendChild(nm);
      var facts = [];
      if (m.stable) facts.push(m.hl ? 'T½ ' + hlText(m.hl) + ' (effectively stable)' : 'stable');
      else {
        if (m.hl) facts.push('T½ ' + hlText(m.hl));
        if (m.jp) facts.push('J<sup>π</sup> ' + m.jp);
        facts.push('relative activity ' + afText(m.af));
      }
      var f = el('span', 'gx-cfacts'); f.innerHTML = facts.join(' · '); head.appendChild(f);
      li.appendChild(head);
      if (!m.stable) {
        var modes = el('div', 'gx-cmodes');
        modes.innerHTML = (m.modes || []).filter(function (x) { return x[1] == null || x[1] >= 1e-4; }).map(function (x) {
          return '<span class="gx-mode">' + modeName(x[0]) + ' ' + pct(x[1]) + (x[2] != null ? ', Q = ' + (+x[2]).toFixed(1) + ' keV' : '') + (x[3] ? ' → ' + pretty(x[3]) : '') + '</span>';
        }).join('');
        li.appendChild(modes);
        var g = (m.gammas || []).slice().sort(function (a, b) { return b[1] - a[1]; });
        if (g.length) li.appendChild(el('div', 'gx-csum', 'Strongest gammas: ' + g.slice(0, 4).map(function (l) { return fmt(l[0], 1) + ' keV (' + (+l[1].toPrecision(3)) + '%)'; }).join(', ')));
        var d = el('details', 'gx-cdetails'); d.appendChild(el('summary', null, 'All radiation and coincidences'));
        d.addEventListener('toggle', function () { if (d.open && !d.dataset.done) { d.dataset.done = 1; fillMember(d, m); } });
        li.appendChild(d);
      }
      list.appendChild(li);
    });
    out.appendChild(list);
    var refs = el('details', 'gx-refs'); refs.appendChild(el('summary', null, 'Sources'));
    var ul = el('ul');
    c.refs.concat([CHAINS.meta.about, 'Alpha and beta spectra: ' + CHAINS.meta.alpha_beta_source + '.']).forEach(function (r) { ul.appendChild(el('li', null, r)); });
    refs.appendChild(ul); out.appendChild(refs);
  }
  function fillMember(box, m) {
    var modes = (m.modes || []).map(function (x) { return [modeName(x[0]), pct(x[1]), x[2] != null ? (+x[2]).toFixed(1) : '', x[3] ? pretty(x[3]) : '']; });
    if (modes.length) { box.appendChild(el('h4', null, 'Decay modes')); box.appendChild(table(['Mode', 'Branching', 'Q (keV)', 'Daughter'], modes)); }
    if (m.alphas && m.alphas.length) {
      box.appendChild(el('h4', null, 'Alphas'));
      box.appendChild(table(['Energy (keV)', 'Intensity (%)'], m.alphas.slice(0, 15).map(function (a) { return [fmt(a[0], 1), +a[1].toPrecision(4)]; })));
    }
    [['betas', 'Beta⁻ spectrum'], ['positrons', 'Beta⁺ spectrum']].forEach(function (k) {
      if (m[k[0]] && m[k[0]].length) {
        box.appendChild(el('h4', null, k[1]));
        box.appendChild(table(['End-point (keV)', 'Mean energy (keV)', 'Intensity (%)'], m[k[0]].slice(0, 15).map(function (b) { return [b[0] != null ? fmt(b[0], 1) : '', b[1] != null ? fmt(b[1], 1) : '', +b[2].toPrecision(4)]; })));
      }
    });
    if (m.gammas && m.gammas.length) {
      box.appendChild(el('h4', null, 'Gammas'));
      var order = m.gammas.map(function (l, i) { return i; }).sort(function (a, b) { return m.gammas[b][1] - m.gammas[a][1]; });
      var rows = function (n) {
        return order.slice(0, n).map(function (i) {
          var l = m.gammas[i], co = (m.coinc || {})[i];
          return [fmt(l[0], 2), +l[1].toPrecision(4), +(l[1] * m.af).toPrecision(3), (l[2] != null ? fmt(l[2], 1) : '?') + ' → ' + (l[3] != null ? fmt(l[3], 1) : '?'),
                  l[4] || '', l[5] != null ? (+l[5].toPrecision(3)) : '',
                  co ? co.map(function (p) { return fmt(p[0], 1) + ' (' + Math.round(p[1] * 100) + '%)'; }).join(', ') : ''];
        });
      };
      var hdr = ['Energy (keV)', 'Per 100 decays', 'Per 100 parent decays', 'Levels (keV)', 'Multipolarity', 'Conv. coeff. α', 'Emitted together with (probability)'];
      var holder = el('div'); holder.appendChild(table(hdr, rows(25), 'gx-gtable'));
      box.appendChild(holder);
      if (order.length > 25) {
        var more = el('button', 'mini', 'Show all ' + order.length + ' gammas'); more.type = 'button';
        more.addEventListener('click', function () { holder.innerHTML = ''; holder.appendChild(table(hdr, rows(order.length), 'gx-gtable')); more.remove(); });
        box.appendChild(more);
      }
      box.appendChild(el('p', 'gx-note', '“Emitted together with”: probability that the listed gamma accompanies this one in the same decay, from the level scheme (cascades through the daughter\'s levels). These show up as coincidences in segmented or multi-detector setups, and as sum peaks in close geometries.'));
    }
    if (m.xrays && m.xrays.length) {
      box.appendChild(el('h4', null, 'X-rays (K, and L where ENSDF lists them)'));
      box.appendChild(table(['Energy (keV)', 'Per 100 decays', 'Line'], m.xrays.map(function (x) { return [fmt(x[0], 2), +x[1].toPrecision(3), x[2]]; })));
    }
  }

  /* ------------------------------------------------------------ tabs, wiring */
  function selectTab(name) {
    ['range', 'peaks', 'fit', 'chains', 'browse'].forEach(function (n) {
      $('#tab-' + n).setAttribute('aria-selected', n === name ? 'true' : 'false');
      $('#panel-' + n).hidden = n !== name;
    });
  }
  var current = null;
  function rerun() { if (current) current(); }

  function init() {
    buildSetup();
    try { if (localStorage.getItem('gx-setup') || window.innerWidth < 700) $('#setup').open = false; } catch (e) {}   // returning visitors: keep it folded
    ['range', 'peaks', 'fit', 'chains', 'browse'].forEach(function (n) { $('#tab-' + n).addEventListener('click', function () { selectTab(n); }); });
    $('#tab-chains').addEventListener('click', function () { loadChains().then(function () { if (!$('#chain-out').children.length) renderChain($('#chain-select').value || 'U238'); }); });
    buildFit();
    $('#range-form').addEventListener('submit', function (e) { e.preventDefault(); current = renderRange; renderRange(); });
    $('#peaks-form').addEventListener('submit', function (e) { e.preventDefault(); current = renderPeaks; renderPeaks(); });
    $('#peaks-example').addEventListener('click', function () {
      $('#peaks').value = '238.6\n295.2\n351.9\n583.2\n609.3\n911.2\n1120.3\n1460.8\n1764.5\n2223.2\n2614.5';
      current = renderPeaks; renderPeaks();
    });
    $('#browse-q').addEventListener('input', function () { current = null; needAll().then(function () { renderBrowse(); }); });
    try { var sp = localStorage.getItem('gx-peaks'); if (sp) $('#peaks').value = sp; } catch (e) {}
    load('data/gamma/core.json').then(function (d) {
      DATA = d; META = d.meta || {}; index(d.S); buildGroups(); fluxPlaceholders(); buildPresets(); buildWeights(); setupSummary();
      $('#about-meta').textContent = META.text || '';
      renderBrowse();
      var h = decodeURIComponent(location.hash || '');
      var m = h.match(/^#range=([\d.]+)-([\d.]+)/), s = h.match(/^#src=(.+)$/), ch = h.match(/^#chain=(\w+)/);
      if (ch) { selectTab('chains'); loadChains().then(function () { renderChain(ch[1]); }); }
      if (m) { $('#emin').value = m[1]; $('#emax').value = m[2]; current = renderRange; renderRange(); }
      else if (s) openSource(s[1]);
      else { $('#emin').value = 1455; $('#emax').value = 1466; }
    }).catch(function (e) { $('#range-out').textContent = 'Could not load the data: ' + e.message; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
