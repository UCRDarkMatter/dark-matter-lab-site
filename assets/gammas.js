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
          ['water', 'Water'], ['rock', 'Rock / concrete'], ['glass', 'Glass / PMTs'], ['te', 'Tellurium'], ['solder', 'Solder / electronics']]
  };
  var FWHM1MEV = { hpge: 1.6, nai: 55, lar: 80, lxe: 40, plastic: 150 };
  var ctx = { det: ['hpge'], env: ['underground'], n: ['ambient'], mat: ['cu', 'pb', 'rock'], fwhm: 1.6 };
  try { var saved = JSON.parse(localStorage.getItem('gx-setup') || 'null'); if (saved && saved.det) ctx = saved; } catch (e) {}
  function save() { try { localStorage.setItem('gx-setup', JSON.stringify(ctx)); } catch (e) {} }

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
          save(); setupSummary(); rerun();
        });
        box.appendChild(b);
      });
    });
    $('#fwhm').value = ctx.fwhm;
    $('#fwhm').addEventListener('change', function () { ctx.fwhm = +this.value || FWHM1MEV[ctx.det[0]]; save(); setupSummary(); rerun(); });
    setupSummary();
  }
  function label(key, v) { var o = OPTS[key].filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : v; }
  function setupSummary() {
    $('#setup-sum').textContent = '· ' + [label('det', ctx.det[0]) + ' (' + ctx.fwhm + ' keV FWHM at 1 MeV)', label('env', ctx.env[0]),
      ctx.n.length ? ctx.n.map(function (v) { return label('n', v).split(' (')[0]; }).join(', ') : 'no neutrons',
      ctx.mat.length + ' materials'].join(' · ');
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

  /* prior: how plausible a source is in this setup (relative; only used for ranking) */
  function prior(s) {
    var p = s.tier === 1 ? 1 : s.tier === 2 ? 0.3 : 0.03, w = s.when || {};
    ['env', 'n', 'mat', 'det'].forEach(function (k) {
      if (!w[k]) return;
      var hit = w[k].some(function (v) { return ctx[k].indexOf(v) >= 0; });
      if (hit) p *= 3;
      else if (k === 'det') p *= 0.05;                       // detector-specific effects (Ge triangles, LaBr₃ …)
      else if (k === 'n' && !ctx.n.length) p *= 0.1;
      else if (k === 'mat') p *= 0.5;
    });
    if (s.cosmo) {                                           // cosmogenic in the listed materials
      var m = s.cosmo.some(function (v) { return ctx.mat.indexOf(v) >= 0 || (v === 'ge' && ctx.det[0] === 'hpge') || (v === 'ar' && ctx.det[0] === 'lar') || (v === 'xe' && ctx.det[0] === 'lxe') || (v === 'nai' && ctx.det[0] === 'nai'); });
      p *= (m ? 3 : 0.4) * (ctx.env[0] === 'surface' ? 3 : 1);
    }
    if (s.kind === 'capture' || s.kind === 'inel') {
      var present = (s.mats || []).some(function (v) { return ctx.mat.indexOf(v) >= 0; }) || (s.det || []).indexOf(ctx.det[0]) >= 0;
      if (s.kind === 'inel') p *= 0.3;                      // fast-neutron lines are usually weaker than capture and decay lines
      p *= present ? 4 : s.always ? 1 : 0.15;
      if (!ctx.n.length) p *= 0.1;
      if (ctx.n.indexOf('source') >= 0 || ctx.n.indexOf('reactor') >= 0) p *= 2;
      if (s.kind === 'capture' && s.wt != null) p *= Math.min(3, 0.3 + Math.sqrt(s.wt));   // capture-rate weight of the element
    }
    if (s.radon && ctx.env[0] === 'underground') p *= 1.5;
    return p;
  }
  function strength(s, I) {           // how much a line's intensity matters for ranking
    if (s.kind === 'inel' || s.kind === 'xray') return 0.15 + 0.5 * Math.min(1, I / 100);
    return Math.sqrt(Math.min(1, Math.max(I, 0.01) / 100));
  }
  function width(E, flags) {          // expected peak σ: detector ⊕ Doppler/recoil broadening
    var s = sigma(E);
    if (flags && flags.indexOf('b') >= 0) s = Math.sqrt(s * s + Math.pow(0.004 * E, 2));
    return s;
  }
  function match(E, line) {           // agreement of a measured energy with a line (0..1)
    var f = line[2] || '', d = E - line[0], s = width(line[0], f);
    if (f.indexOf('t') >= 0 && d > 0) d = Math.max(0, d - 8);   // recoil tail above Ge(n,n′) lines
    return Math.exp(-0.5 * d * d / (s * s));
  }

  var KIND = { decay: 'Decay', capture: 'Neutron capture (n,γ)', inel: 'Inelastic (n,n′γ)', rx: 'Other reaction', xray: 'X-ray', art: 'Detector effect' };

  /* ------------------------------------------------------------ correlations panel */
  function strongest(s, n) {
    var all = s.L.map(function (l, i) { return [l, i]; });
    var big = all.filter(function (p) { return p[0][0] >= 10; });
    return (big.length ? big : all).sort(function (a, b) { return b[0][1] - a[0][1]; }).slice(0, n);
  }
  function timeText(s) {
    if (s.kind === 'capture' || s.kind === 'inel') return 'Prompt: appears only while neutrons are present and follows the neutron flux in real time.';
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
    if (s.how) box.appendChild(el('p', null, s.how));
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
    if (s.iso && s.iso.length) {
      var ip = el('p', 'gx-small muted', 'Capture rate by isotope (abundance × σ): ' + s.iso.map(function (x) { return pretty(x[0]) + ' ' + (x[1] * 100).toFixed(x[1] < 0.1 ? 1 : 0) + '%'; }).join(', ') + (s.miss ? '. Not covered: ' + s.miss.map(pretty).join(', ') + '.' : '.'));
      box.appendChild(ip);
    }
    if (s.nuc) {
      var lk = el('p', 'gx-small'), a = el('a', null, 'ENSDF data for ' + pretty(s.nuc) + ' at NNDC NuDat');
      a.href = 'https://www.nndc.bnl.gov/nudat3/decaysearchdirect.jsp?nuc=' + encodeURIComponent(s.nuc) + '&unc=NDS'; a.rel = 'noopener';
      lk.appendChild(a); box.appendChild(lk);
    }
    return box;
  }
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
  var rangeKinds = { decay: true, capture: true, inel: true, rx: true, xray: true, art: true };
  function artifacts(lo, hi) {        // escape and sum peaks from the most relevant sources
    var out = [];
    DATA.S.forEach(function (s) {
      if (s.tier > 2 && s.kind !== 'capture') return;
      var p = prior(s);
      s.L.forEach(function (l, i) {
        if (l[1] < 1 && s.kind !== 'inel') return;
        [[511, 'single escape'], [1022, 'double escape']].forEach(function (e) {
          var E = l[0] - e[0];
          if (l[0] > 1022 && E >= lo && E <= hi) out.push({ E: E, s: s, li: i, what: e[1] + ' of ' + fmt(l[0], 1) + ' keV', score: p * strength(s, l[1]) * 0.15 });
        });
        (s.C && s.C[i] || []).forEach(function (c) {
          var E = l[0] + c[0];
          var direct = s.L.some(function (m) { return Math.abs(m[0] - E) < 1.5; });   // same energy as a real line: not a separate peak
          if (c[0] > l[0] && E >= lo && E <= hi && !direct) out.push({ E: E, s: s, li: i, what: 'sum peak ' + fmt(l[0], 1) + ' + ' + fmt(c[0], 1) + ' keV', score: p * strength(s, l[1]) * c[1] * 0.1 });
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
        if (l[0] >= lo - pad && l[0] <= hi + pad) res.push({ E: l[0], s: s, li: i, I: l[1], score: p * strength(s, l[1]) });
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
  function bar(v) { var b = el('span', 'gx-bar'); var f = el('span'); f.style.width = Math.max(4, Math.round(100 * v)) + '%'; b.appendChild(f); b.title = 'Relative plausibility in your setup'; return b; }
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
    sm.appendChild(bar(Math.sqrt(r.score / top)));
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
    var cands = [];
    sources().concat(GROUPS).forEach(function (s) {
      var p = prior(s) * (s.group ? 1.5 : 1), m = [];
      peaks.forEach(function (pk, k) {
        var best = null;
        s.L.forEach(function (l, i) {
          var g = match(pk.E, l);
          if (pk.w) g = Math.max(g, Math.exp(-0.5 * Math.pow((pk.E - l[0]) / Math.max(pk.w / 2.355, 0.01), 2)));
          if (g > 0.05 && (!best || g * strength(s, l[1]) > best.v)) best = { k: k, i: i, g: g, v: g * strength(s, l[1]) };
        });
        if (best) m.push(best);
      });
      if (m.length) cands.push({ s: s, p: p, m: m });
    });
    function missing(c) {                     // strong expected lines in the observed range with no peak
      var ref = c.m.reduce(function (a, x) { var l = c.s.L[x.i]; return Math.max(a, l[1] * eff(l[0])); }, 0);
      if (c.s.kind === 'xray') return [];
      var rel = c.s.kind === 'inel';                       // inelastic weights are relative (strongest = 100)
      var used = {}; c.m.forEach(function (x) { used[x.i] = 1; });
      return c.s.L.map(function (l, i) { return [l, i]; }).filter(function (p) {
        var l = p[0];
        var matched = peaks.some(function (pk) { return match(pk.E, l) > 0.3; });
        return !used[p[1]] && !matched && l[0] >= lo && l[0] <= hi && l[1] * eff(l[0]) >= (rel ? 0.6 : 0.35) * ref && l[1] >= (rel ? 40 : 0.5);
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
      return cands.filter(function (c) { return !c.s.group; }).map(function (c) { var x = c.m.filter(function (y) { return y.k === k; })[0]; return x ? { c: c, x: x, v: c.p * x.v } : null; })
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
      list = sources().filter(function (s) { return s.key.indexOf(q) >= 0; }).sort(function (a, b) { return prior(b) - prior(a); }).slice(0, 60);
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
      ['Neutron capture', ['c:H', 'c:Fe', 'c:Cu', 'c:Ge', 'c:Cl', 'c:Gd', 'c:Pb', 'c:Ar']], ['Reactions', ['rx:b10na', 'rx:ge72e0', 'rx:annihilation', 'rx:f19aa']]];
    groups.forEach(function (g) {
      var p = el('p'); p.appendChild(el('b', null, g[0] + ': '));
      var first = true;
      g[1].forEach(function (id) { if (!BYID[id]) return; if (!first) p.appendChild(document.createTextNode(' · ')); first = false; var a = srcLink(id); a.innerHTML = BYID[id].name; p.appendChild(a); });
      box.appendChild(p);
    });
    return box;
  }

  /* ------------------------------------------------------------ tabs, wiring */
  function selectTab(name) {
    ['range', 'peaks', 'browse'].forEach(function (n) {
      $('#tab-' + n).setAttribute('aria-selected', n === name ? 'true' : 'false');
      $('#panel-' + n).hidden = n !== name;
    });
  }
  var current = null;
  function rerun() { if (current) current(); }

  function init() {
    buildSetup();
    try { if (localStorage.getItem('gx-setup') || window.innerWidth < 700) $('#setup').open = false; } catch (e) {}   // returning visitors: keep it folded
    ['range', 'peaks', 'browse'].forEach(function (n) { $('#tab-' + n).addEventListener('click', function () { selectTab(n); }); });
    $('#range-form').addEventListener('submit', function (e) { e.preventDefault(); current = renderRange; renderRange(); });
    $('#peaks-form').addEventListener('submit', function (e) { e.preventDefault(); current = renderPeaks; renderPeaks(); });
    $('#peaks-example').addEventListener('click', function () {
      $('#peaks').value = '238.6\n295.2\n351.9\n583.2\n609.3\n911.2\n1120.3\n1460.8\n1764.5\n2223.2\n2614.5';
      current = renderPeaks; renderPeaks();
    });
    $('#browse-q').addEventListener('input', function () { current = null; needAll().then(function () { renderBrowse(); }); });
    try { var sp = localStorage.getItem('gx-peaks'); if (sp) $('#peaks').value = sp; } catch (e) {}
    load('data/gamma/core.json').then(function (d) {
      DATA = d; META = d.meta || {}; index(d.S); buildGroups();
      $('#about-meta').textContent = META.text || '';
      renderBrowse();
      var h = decodeURIComponent(location.hash || '');
      var m = h.match(/^#range=([\d.]+)-([\d.]+)/), s = h.match(/^#src=(.+)$/);
      if (m) { $('#emin').value = m[1]; $('#emax').value = m[2]; current = renderRange; renderRange(); }
      else if (s) openSource(s[1]);
      else { $('#emin').value = 1455; $('#emax').value = 1466; }
    }).catch(function (e) { $('#range-out').textContent = 'Could not load the data: ' + e.message; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
