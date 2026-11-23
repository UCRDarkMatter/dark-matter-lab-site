/* Radioactive Signal Explorer: user interface. Physics in signals-physics.js. */
(function () {
  'use strict';
  var P = window.SignalPhysics;
  if (window.SignalExchange) P.setExchange(window.SignalExchange);
  var $ = function (s) { return document.querySelector(s); };
  var ME = P.ME, NA = 6.02214076e23;
  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', 'm': 'ᵐ', '-': '⁻', '+': '⁺' };
  function pretty(n) { return String(n).replace(/\b(\d+)(m?)([A-Z][a-z]?)\b/g, function (_, a, m, s) { return a.split('').map(function (c) { return SUP[c]; }).join('') + (m ? SUP.m : '') + s; }); }
  function sup(s) { return String(s).split('').map(function (c) { return SUP[c] || c; }).join(''); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmt(x, d) { if (x == null || !isFinite(x)) return '–'; if (x === 0) return '0'; var a = Math.abs(x); if (a >= 1e5 || a < 1e-3) return x.toExponential(d == null ? 3 : d).replace('e', '×10^').replace(/\^\+?(-?\d+)/, function (_, e) { return sup(e); }); return (+x.toPrecision(d == null ? 4 : d + 1)).toLocaleString('en-US', { maximumFractionDigits: 6 }); }
  function erf(x) {                     // Abramowitz & Stegun 7.1.26 is too coarse for narrow bands; use the erfc series of Numerical Recipes
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851638 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? 1 - r : r - 1;
  }
  function num(id, def) { var v = parseFloat($(id).value); return isFinite(v) ? v : def; }
  var CACHE = {};
  function load(path) {
    if (!CACHE[path]) CACHE[path] = fetch(path, { cache: 'default' }).then(function (r) { if (!r.ok) throw new Error(path + ': ' + r.status); return r.json(); });
    return CACHE[path];
  }
  function hlText(s) {
    if (s == null) return '?'; if (s < 0) return 'stable';
    var u = [[3.15576e7, 'y'], [86400, 'd'], [3600, 'h'], [60, 'min'], [1, 's'], [1e-3, 'ms'], [1e-6, 'µs']];
    for (var i = 0; i < u.length; i++) if (s >= u[i][0] || i === u.length - 1) return fmt(s / u[i][0], 3) + ' ' + u[i][1];
  }
  function download(name, header, cols, meta) {
    var lines = (meta || []).map(function (m) { return '# ' + m; });
    lines.push(header.join(','));
    var n = cols[0].length;
    for (var i = 0; i < n; i++) lines.push(cols.map(function (c) { var v = c[i]; return typeof v === 'number' ? (+v.toPrecision(7)).toString() : '"' + String(v).replace(/"/g, '""') + '"'; }).join(','));
    var a = el('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function normName(s) {                 // "co-60", "Co60", "60co" -> "60Co"
    s = String(s || '').trim().replace(/[\s-]/g, '');
    var m = /^(\d+)(m?)([A-Za-z]{1,2})$/.exec(s) || /^([A-Za-z]{1,2})(\d+)(m?)$/.exec(s);
    if (!m) return s;
    var A, iso, sym;
    if (/^\d/.test(s)) { A = m[1]; iso = m[2]; sym = m[3]; } else { sym = m[1]; A = m[2]; iso = m[3]; }
    return A + (iso ? 'm' : '') + sym.charAt(0).toUpperCase() + sym.slice(1).toLowerCase();
  }

  /* ---------------------------------------------------------------- plotting */
  var PAL = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'] };
  function dark() { return document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function color(i) { var p = dark() ? PAL.dark : PAL.light; return i < p.length ? p[i] : (dark() ? '#97a0ac' : '#8b8b8b'); }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'; }
  /* cfg: {series: [{name, x, y, color, dash, width, step}], xlab, ylab, log, xmin, xmax, ymin, ymax, legend: element, height,
          marks: [{x, label}]} */
  function plot(cv, cfg) {
    var wrap = cv.parentNode, W = wrap.clientWidth || 700, H = cfg.height || Math.max(260, Math.min(420, W * 0.55)), dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    var L = 64, R = 14, T = 12, B = 42, pw = W - L - R, ph = H - T - B, ink = css('--ink'), muted = css('--muted'), line = css('--line');
    var xs = cfg.series.filter(function (s) { return s.x && s.x.length; });
    if (!xs.length) { c.fillStyle = muted; c.font = '14px Roboto, sans-serif'; c.fillText(cfg.empty || 'Nothing to show', L + 10, T + 30); return; }
    var x0 = cfg.xmin != null ? cfg.xmin : Infinity, x1 = cfg.xmax != null ? cfg.xmax : -Infinity, y0 = Infinity, y1 = -Infinity;
    xs.forEach(function (s) {
      for (var i = 0; i < s.x.length; i++) {
        if (cfg.xmin == null) x0 = Math.min(x0, s.x[i]); if (cfg.xmax == null) x1 = Math.max(x1, s.x[i]);
        var v = s.y[i]; if (isFinite(v) && (!cfg.log || v > 0)) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
      }
    });
    if (!(x1 > x0)) x1 = x0 + 1;
    if (cfg.log) { y1 = y1 * 3; y0 = cfg.ymin != null ? cfg.ymin : Math.max(y0, y1 * 1e-6); if (!(y1 > y0)) y1 = y0 * 10; }
    else { y0 = cfg.ymin != null ? cfg.ymin : Math.min(0, y0); y1 = cfg.ymax != null ? cfg.ymax : y1 * 1.08; if (!(y1 > y0)) y1 = y0 + 1; }
    var X = function (x) { return L + (x - x0) / (x1 - x0) * pw; };
    var Y = cfg.log ? function (y) { return T + ph - (Math.log10(Math.max(y, y0 * 1e-3)) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) * ph; } : function (y) { return T + ph - (y - y0) / (y1 - y0) * ph; };
    // grid and axes
    c.font = '12px Roboto, sans-serif'; c.fillStyle = muted; c.strokeStyle = line; c.lineWidth = 1;
    var xt = ticks(x0, x1, Math.max(3, Math.floor(pw / 90)));
    xt.forEach(function (t) { var x = X(t); c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke(); c.textAlign = 'center'; c.fillText(tickLabel(t), x, T + ph + 16); });
    var yt = cfg.log ? logTicks(y0, y1) : ticks(y0, y1, Math.max(3, Math.floor(ph / 55)));
    yt.forEach(function (t) { var y = Y(t); c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); c.textAlign = 'right'; c.fillText(tickLabel(t, cfg.log), L - 6, y + 4); });
    c.fillStyle = ink; c.textAlign = 'center'; c.fillText(cfg.xlab || '', L + pw / 2, H - 6);
    c.save(); c.translate(13, T + ph / 2); c.rotate(-Math.PI / 2); c.fillText(cfg.ylab || '', 0, 0); c.restore();
    c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip();
    (cfg.marks || []).forEach(function (m) {
      var x = X(m.x); c.strokeStyle = muted; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke(); c.setLineDash([]);
      c.fillStyle = muted; c.textAlign = 'left'; c.fillText(m.label, x + 4, T + 14 + (m.row || 0) * 14);
    });
    xs.forEach(function (s, k) {
      c.strokeStyle = s.color || color(k); c.lineWidth = s.width || 2; c.setLineDash(s.dash || []); c.lineJoin = 'round';
      c.beginPath(); var pen = false;
      for (var i = 0; i < s.x.length; i++) {
        var v = s.y[i];
        var px = X(s.x[i]), bot = T + ph;
        if (!isFinite(v) || (cfg.log && !(v > 0))) {   // a gap: drop to the axis so isolated peaks still show as spikes
          if (pen && cfg.log) c.lineTo(X(s.x[i - 1]), bot);
          pen = false; continue;
        }
        var py = Y(v);
        if (s.stem) { c.moveTo(px, Y(cfg.log ? y0 : 0)); c.lineTo(px, py); continue; }
        if (!pen) { if (cfg.log && i > 0) { c.moveTo(px, bot); c.lineTo(px, py); } else c.moveTo(px, py); pen = true; } else c.lineTo(px, py);
      }
      c.stroke(); c.setLineDash([]);
    });
    c.restore();
    c.strokeStyle = muted; c.strokeRect(L + 0.5, T + 0.5, pw, ph);
    // legend (HTML, for >= 2 series)
    if (cfg.legend) {
      cfg.legend.innerHTML = '';
      if (xs.length > 1) xs.forEach(function (s, k) {
        var it = el('span', 'sx-key'), sw = el('i'); sw.style.borderColor = s.color || color(k); if (s.dash) sw.style.borderTopStyle = 'dashed';
        it.appendChild(sw); it.appendChild(document.createTextNode(s.name)); cfg.legend.appendChild(it);
      });
    }
    // hover readout
    cv._plot = { cfg: cfg, X: X, Y: Y, x0: x0, x1: x1, L: L, pw: pw, T: T, ph: ph, series: xs };
    if (!cv._hover) {
      cv._hover = true;
      var tip = el('div', 'sx-tip'); tip.hidden = true; wrap.appendChild(tip);
      cv.addEventListener('mousemove', function (ev) {
        var p = cv._plot; if (!p) return;
        var r = cv.getBoundingClientRect(), mx = ev.clientX - r.left;
        if (mx < p.L || mx > p.L + p.pw) { tip.hidden = true; return; }
        var xv = p.x0 + (mx - p.L) / p.pw * (p.x1 - p.x0), rowsH = [];
        p.series.forEach(function (s, k) {
          if (s.stem) return;
          var lo = 0, hi = s.x.length - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (s.x[m] <= xv) lo = m; else hi = m; }
          var i = Math.abs(s.x[lo] - xv) < Math.abs(s.x[hi] - xv) ? lo : hi;
          if (Math.abs(s.x[i] - xv) > (p.x1 - p.x0) / 30) return;
          rowsH.push('<span class="sx-sw" style="background:' + (s.color || color(k)) + '"></span>' + s.name + ': <b>' + fmt(s.y[i], 3) + '</b>');
        });
        if (!rowsH.length) { tip.hidden = true; return; }
        tip.innerHTML = '<div>' + (p.cfg.xname || p.cfg.xlab || 'x') + ' = ' + fmt(xv, 4) + '</div>' + rowsH.slice(0, 8).join('<br>');
        tip.hidden = false; tip.style.left = Math.min(mx + 14, r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = (ev.clientY - r.top + 10) + 'px';
      });
      cv.addEventListener('mouseleave', function () { tip.hidden = true; });
    }
  }
  function ticks(a, b, n) {
    var span = b - a, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = n / span * step;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var out = []; for (var t = Math.ceil(a / step) * step; t <= b + step * 1e-9; t += step) out.push(+t.toPrecision(12));
    return out;
  }
  function logTicks(a, b) { var out = []; for (var e = Math.ceil(Math.log10(a)); e <= Math.floor(Math.log10(b)); e++) out.push(Math.pow(10, e)); if (out.length > 8) out = out.filter(function (_, i) { return i % 2 === 0; }); return out; }
  function tickLabel(t, log) { if (log) return '10' + sup(String(Math.round(Math.log10(t)))); var a = Math.abs(t); return a >= 1e5 || (a < 1e-2 && a > 0) ? t.toExponential(0) : String(+t.toPrecision(6)); }

  /* ---------------------------------------------------------------- tabs */
  var TABS = ['gamma', 'alpha', 'an', 'beta', 'cher'], DONE = {};
  function showTab(t, push) {
    TABS.forEach(function (k) { $('#tab-' + k).setAttribute('aria-selected', k === t ? 'true' : 'false'); $('#panel-' + k).hidden = k !== t; });
    if (push) history.replaceState(null, '', '#' + t);
    if (!DONE[t]) { DONE[t] = true; INIT[t](); } else RUN[t]();
  }
  var INIT = {}, RUN = {};

  /* ---------------------------------------------------------------- shared data */
  var NUC = null, DEC = null;
  function base() { return Promise.all([load('data/signals/nuclides.json'), load('data/signals/decays.json')]).then(function (r) { NUC = r[0]; DEC = r[1]; }); }
  function fillList(id, names) { var dl = $(id); dl.innerHTML = ''; names.forEach(function (n) { var o = el('option'); o.value = n; dl.appendChild(o); }); }
  function nucInfo(n) { var g = NUC[n.replace(/^(\d+)m/, '$1')]; return g ? { Z: g[0], A: g[1], jp: g[2], hl: g[3], modes: g[4], qa: g[5], qbm: g[6], qec: g[7], dm: g[8], r: g[9], ab: g[10] } : null; }
  var SYMS = 'n H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm'.split(' ');
  function daughterName(n, dz, dA) { var i = nucInfo(n); if (!i) return null; var Z = i.Z + dz; return (i.A + (dA || 0)) + SYMS[Z]; }

  /* ================================================================ GAMMA */
  var GMAT = [
    ['NaI(Tl)', { Na: 0.1534, I: 0.8466 }], ['CsI', { Cs: 0.5115, I: 0.4885 }], ['Germanium (HPGe)', { Ge: 1 }], ['Silicon', { Si: 1 }],
    ['Liquid argon', { Ar: 1 }], ['Liquid xenon', { Xe: 1 }], ['Water', { H: 0.1119, O: 0.8881 }], ['Plastic scintillator (PVT)', { C: 0.915, H: 0.085 }],
    ['Liquid scintillator (LAB)', { C: 0.878, H: 0.122 }], ['BGO', { Bi: 0.6710, Ge: 0.1749, O: 0.1541 }], ['LaBr₃', { La: 0.3667, Br: 0.6333 }],
    ['CdTe', { Cd: 0.4683, Te: 0.5317 }], ['Lead', { Pb: 1 }], ['Acrylic (PMMA)', { C: 0.5998, H: 0.0805, O: 0.3196 }]];
  var G = { last: null };
  INIT.gamma = function () {
    GMAT.forEach(function (m, i) { var o = el('option', null, m[0]); o.value = i; $('#g-mat').appendChild(o); });
    Promise.all([base(), load('data/signals/xcom.json')]).then(function (r) {
      G.xcom = r[1]; G.edges = {}; G.Zof = {};
      Object.keys(G.xcom).forEach(function (k) { G.edges[k] = G.xcom[k].K; G.Zof[k] = G.xcom[k].Z; });
      fillList('#g-nuc-list', Object.keys(DEC).filter(function (n) { return DEC[n].g; }).sort(byA));
      ['#g-nuc', '#g-line', '#g-e', '#g-mat', '#g-fwhm', '#g-esc', '#g-log'].forEach(function (id) { $(id).addEventListener(id === '#g-esc' ? 'input' : 'change', id === '#g-nuc' ? gNuc : RUN.gamma); });
      $('#g-nuc').addEventListener('input', function () { if (DEC[normName(this.value)]) gNuc(); });
      document.querySelectorAll('input[name=g-src]').forEach(function (r) { r.addEventListener('change', function () { var nuc = srcVal('g-src') === 'nuc'; $('#g-nuc-wrap').hidden = $('#g-line-wrap').hidden = !nuc; $('#g-e-wrap').hidden = nuc; RUN.gamma(); }); });
      $('#g-csv').addEventListener('click', gCSV);
      gNuc();
    }).catch(fail('#g-out'));
  };
  function byA(a, b) { var x = parseInt(a, 10), y = parseInt(b, 10); return x - y || a.localeCompare(b); }
  function srcVal(name) { var r = document.querySelector('input[name=' + name + ']:checked'); return r ? r.value : null; }
  function fail(sel) { return function (e) { $(sel).innerHTML = ''; $(sel).appendChild(el('p', 'sx-warn', 'Could not load data: ' + (e && e.message || e))); }; }
  function gNuc() {
    var n = normName($('#g-nuc').value), d = DEC[n], sel = $('#g-line'); sel.innerHTML = '';
    if (!d || !d.g) { RUN.gamma(); return; }
    var all = el('option', null, 'All lines, weighted by intensity'); all.value = 'all'; sel.appendChild(all);
    d.g.slice(0, 40).forEach(function (l, i) { var o = el('option', null, fmt(l[0], 5) + ' keV (' + fmt(l[1], 3) + '%)'); o.value = i; sel.appendChild(o); });
    sel.value = d.g.length > 1 && d.g[0][1] < 5 * d.g[1][1] ? 'all' : '0';
    RUN.gamma();
  }
  function gLines() {
    if (srcVal('g-src') === 'e') { var E = num('#g-e', 1460.8); return [[E, 100]]; }
    var d = DEC[normName($('#g-nuc').value)]; if (!d || !d.g) return [];
    var v = $('#g-line').value; return v === 'all' ? d.g.filter(function (l) { return l[0] > 10; }) : [d.g[+v || 0]];
  }
  RUN.gamma = function () {
    if (!G.xcom) return;
    var lines = gLines(), out = $('#g-out'); out.innerHTML = '';
    $('#g-esc-o').textContent = Math.round(num('#g-esc', 1) * 100) + '%';
    if (!lines.length) { plot($('#g-plot'), { series: [], empty: 'Pick a nuclide with gamma lines, or enter an energy.' }); return; }
    var comp = GMAT[+$('#g-mat').value][1], Emax = Math.max.apply(null, lines.map(function (l) { return l[0]; }));
    var bin = Math.max(0.1, Emax / 2500), res = [], sum = null, keys = ['total', 'compton', 'full', 'xray', 'pair', 'positron'], electrons = null;
    lines.forEach(function (l) {
      var r = P.gammaSpectrum({ E: l[0], comp: comp, xcom: G.xcom, edges: G.edges, Zof: G.Zof, pesc: num('#g-esc', 1), fwhm662: num('#g-fwhm', 0), bin: bin });
      // put every line on the common grid (grids differ only in length)
      var n = Math.ceil(Emax * 1.05 / bin) + 1;
      if (!sum) { sum = {}; keys.forEach(function (k) { sum[k] = new Float64Array(n); }); electrons = new Float64Array(n); }
      var w = l[1] / 100;
      keys.forEach(function (k) { for (var i = 0; i < r.grid.length && i < n; i++) sum[k][i] += w * r.comps[k][i]; });
      for (var i = 0; i < r.grid.length && i < n; i++) electrons[i] += w * r.electrons[i];
      res.push({ l: l, r: r });
    });
    var n = sum.total.length, x = new Float64Array(n); for (var i = 0; i < n; i++) x[i] = (i + 0.5) * bin;
    var lg = $('#g-log').checked, per = lines.length > 1 || srcVal('g-src') === 'nuc' ? 'per decay' : 'per interacting photon';
    var series = [{ name: 'Total deposited', x: x, y: sum.total, color: css('--ink'), width: 1.6 },
      { name: 'Compton continuum', x: x, y: sum.compton, color: color(0) }, { name: 'Full-energy peak', x: x, y: sum.full, color: color(1) }];
    if (max(sum.xray) > 0) series.push({ name: 'X-ray escape peak', x: x, y: sum.xray, color: color(3) });
    if (max(sum.pair) > 0) series.push({ name: 'Pair escape peaks', x: x, y: sum.pair, color: color(2) });
    if (max(sum.positron) > 0) series.push({ name: 'Positron kinetic energy (pair events)', x: x, y: sum.positron, color: color(6), dash: [5, 4] });
    var marks = [];
    if (res.length <= 3) res.forEach(function (o, k) { marks.push({ x: o.r.edge, label: 'Compton edge' + (res.length > 1 ? ' ' + fmt(o.l[0], 4) : ''), row: k }); });
    plot($('#g-plot'), { series: series, xlab: 'Energy deposited (keV)', xname: 'E', ylab: 'Probability per keV, ' + per, log: lg, legend: $('#g-legend'), marks: marks, ymin: lg ? Math.max(1e-8, max(sum.total) * 1e-6) : undefined });
    G.last = { x: x, sum: sum, per: per, lines: lines, comp: comp, electrons: electrons, bin: bin };
    // text
    var r0 = res[0].r, E0 = res[0].l[0];
    var tab = el('table', 'sx-table'), hd = el('tr');
    ['Line (keV)', 'Per decay', 'Photoelectric', 'Compton', 'Pair', 'Compton edge', 'Backscatter', 'Photoelectron'].forEach(function (h) { hd.appendChild(el('th', null, h)); });
    tab.appendChild(hd);
    res.slice(0, 12).forEach(function (o) {
      var tr = el('tr'), f = o.r.fractions;
      [fmt(o.l[0], 5), fmt(o.l[1] / 100, 3), pc(f.photo), pc(f.compton), pc(f.pair), fmt(o.r.edge, 4), fmt(o.r.backscatter, 4), o.r.BK ? fmt(o.l[0] - o.r.BK, 4) : '–'].forEach(function (v, i) { tr.appendChild(el('td', i ? 'num' : null, v)); });
      tab.appendChild(tr);
    });
    out.appendChild(el('h3', null, 'Interaction probabilities and key energies'));
    out.appendChild(el('p', 'sx-note', 'Shares of the first interaction (coherent scattering deposits no energy and is left out; it is ' + pc(r0.fractions.coherent) + ' of all interactions at ' + fmt(E0, 4) + ' keV). Cross sections: NIST XCOM for ' + GMAT[+$('#g-mat').value][0] + '.'));
    out.appendChild(tab);
    if (res.length > 12) out.appendChild(el('p', 'sx-note', (res.length - 12) + ' weaker lines are included in the plot but not listed.'));
    out.appendChild(formulaBox([
      ['Compton scattering (Klein–Nishina)', 'dσ/dT = (π r<sub>e</sub>² / m<sub>e</sub>c² ε²) [ 2 + s² / (ε²(1−s)²) + s/(1−s) · (s − 2/ε) ],&nbsp; s = T/E<sub>γ</sub>,&nbsp; ε = E<sub>γ</sub>/m<sub>e</sub>c²'],
      ['Compton edge', 'T<sub>max</sub> = E<sub>γ</sub> · 2ε / (1 + 2ε) = ' + fmt(r0.edge, 5) + ' keV'],
      ['Backscatter peak', 'E<sub>bs</sub> = E<sub>γ</sub> / (1 + 2ε) = ' + fmt(r0.backscatter, 5) + ' keV'],
      ['Photoelectric', 'photoelectron at E<sub>γ</sub> − B<sub>K</sub>' + (r0.BK ? ' = ' + fmt(E0 - r0.BK, 5) + ' keV (B<sub>K</sub> = ' + fmt(r0.BK, 4) + ' keV, ' + r0.dominant + '); the K X-ray (≈ ' + fmt(r0.EKa, 3) + ' keV, fluorescence yield ' + fmt(r0.omegaK, 2) + ') escapes or is absorbed, giving the escape or full-energy peak' : '')],
      ['Pair production', 'E<sub>γ</sub> > 2m<sub>e</sub>c²: e⁺ and e⁻ share E<sub>γ</sub> − 1022 keV; escape peaks at E<sub>γ</sub> − 511 and E<sub>γ</sub> − 1022 keV. Positron spectrum (Bethe–Heitler, unscreened, Born): dσ/dE₊ ∝ (E₊² + E₋² + ⅔E₊E₋)(ln(2E₊E₋/E<sub>γ</sub>m<sub>e</sub>c²) − ½)']]));
    out.appendChild(el('p', 'sx-note', 'Model: one interaction, with the energy of the electron(s) set in motion deposited locally; secondary photons escape with the probability set on the left (otherwise they are absorbed, adding to the full-energy peak). Multiple Compton scattering in a real detector fills the region between the Compton edge and the peak; electron escape, bremsstrahlung and Doppler broadening are not modelled. The pair-production shape is approximate near threshold.'));
  };
  function pc(f) { return f >= 0.0995 ? (f * 100).toFixed(1) + '%' : f > 0 ? fmt(f * 100, 2) + '%' : '0'; }
  function max(a) { var m = 0; for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
  function formulaBox(rows) {
    var d = el('details', 'sx-formula'); d.open = true; d.appendChild(el('summary', null, 'Formulas'));
    var dl = el('dl'); rows.forEach(function (r) { dl.appendChild(el('dt', null, r[0])); var dd = el('dd'); dd.innerHTML = r[1]; dl.appendChild(dd); });
    d.appendChild(dl); return d;
  }
  function gCSV() {
    var g = G.last; if (!g) return;
    var src = srcVal('g-src') === 'e' ? fmt(g.lines[0][0], 6) + ' keV' : normName($('#g-nuc').value);
    download('gamma_' + src.replace(/\W+/g, '_') + '.csv', ['energy_keV', 'total', 'compton', 'full_energy', 'xray_escape', 'pair_escape', 'positron_kinetic'],
      [g.x, g.sum.total, g.sum.compton, g.sum.full, g.sum.xray, g.sum.pair, g.sum.positron],
      ['Radioactive Signal Explorer (dark-matter.ucr.edu): energy deposited by one gamma interaction', 'Source: ' + src + '; material: ' + GMAT[+$('#g-mat').value][0] + '; secondary escape probability ' + num('#g-esc', 1) + '; FWHM(662) ' + num('#g-fwhm', 0) + ' keV',
        'Columns: probability per keV ' + g.per + '; peaks are spread over one ' + fmt(g.bin, 3) + ' keV bin when no resolution is given']);
  }

  /* ================================================================ ALPHA */
  var A = {};
  INIT.alpha = function () {
    base().then(function () {
      fillList('#a-nuc-list', Object.keys(DEC).filter(function (n) { return DEC[n].a; }).sort(byA));
      ['#a-nuc', '#a-levels', '#a-tp', '#a-fwhm', '#a-rfwhm', '#a-log'].forEach(function (id) { $(id).addEventListener('change', id === '#a-nuc' ? aNuc : RUN.alpha); });
      $('#a-q').addEventListener('change', RUN.alpha);
      $('#a-nuc').addEventListener('input', function () { if (nucInfo(normName(this.value))) aNuc(); });
      $('#a-csv').addEventListener('click', aCSV);
      aNuc();
    }).catch(fail('#a-out'));
  };
  function aNuc() {
    var n = normName($('#a-nuc').value), i = nucInfo(n);
    if (i && i.qa != null) { $('#a-q').value = +i.qa.toFixed(3); $('#a-q-note').textContent = 'From the ENSDF/AME ground-state data (' + pretty(n) + ', T½ = ' + hlText(i.hl) + '). Edit to explore.'; }
    else $('#a-q-note').textContent = i ? 'No alpha Q value on record for ' + pretty(n) + ': enter one.' : '';
    RUN.alpha();
  }
  RUN.alpha = function () {
    var n = normName($('#a-nuc').value), i = nucInfo(n), out = $('#a-out'); out.innerHTML = '';
    var Q = num('#a-q', NaN);
    if (!i || !(Q > 0)) { plot($('#a-plot'), { series: [], empty: 'Choose a parent nuclide and a positive Q value.' }); plot($('#a-plot2'), { series: [] }); return; }
    var dn = daughterName(n, -2, -4), di = nucInfo(dn);
    var Md = di && di.dm != null ? P.nucMass(di.A, di.Z, di.dm) : (i.A - 4) * P.AMU;
    var br = (DEC[n] && DEC[n].a && $('#a-levels').checked) ? DEC[n].a.slice() : [[null, 100, 0]];
    var tot = br.reduce(function (s, b) { return s + b[1]; }, 0);
    var Tp = Math.max(0, num('#a-tp', 0)), Mp = Md + P.MALPHA_KEV + Q;
    var lines = br.map(function (b) {
      var k = P.alphaKinematics(Q, b[2] || 0, Md); if (!k) return null;
      var ra = P.boostRange(k.Ta, P.MALPHA_KEV, Mp, Tp), rr = P.boostRange(k.Tr, Md + (b[2] || 0), Mp, Tp);
      return { I: b[1] / tot, Ex: b[2] || 0, Ta: k.Ta, Tr: k.Tr, Tnr: k.Tnr, ensdf: b[0], TaLo: ra.lo, TaHi: ra.hi, TrLo: rr.lo, TrHi: rr.hi };
    }).filter(Boolean);
    if (!lines.length) { plot($('#a-plot'), { series: [], empty: 'Q is below every final state.' }); return; }
    var Ta0 = Math.min.apply(null, lines.map(function (l) { return l.Ta; })), Ta1 = Math.max.apply(null, lines.map(function (l) { return l.Ta; }));
    var fw = num('#a-fwhm', 15), rf = num('#a-rfwhm', 2), lg = $('#a-log').checked;
    function spec(key, fwhm, pad) {     // each line: flat band [lo, hi] from the CM emission angle (a delta if the parent is at rest), times the detector Gaussian
      var lo = Math.min.apply(null, lines.map(function (l) { return l[key + 'Lo']; })) - pad, hi = Math.max.apply(null, lines.map(function (l) { return l[key + 'Hi']; })) + pad;
      var nb = 1500, dx = (hi - lo) / nb, x = new Float64Array(nb), y = new Float64Array(nb), s = Math.max(fwhm / 2.3548, dx / 2);
      for (var k = 0; k < nb; k++) x[k] = lo + (k + 0.5) * dx;
      lines.forEach(function (l) {
        var a = l[key + 'Lo'], b = l[key + 'Hi'], w = b - a;
        for (var k = 0; k < nb; k++) {
          if (w < 0.05 * s) { var z = (x[k] - (a + b) / 2) / s; if (Math.abs(z) < 8) y[k] += l.I * Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI)); }
          else y[k] += l.I * (phi((x[k] - a) / s) - phi((x[k] - b) / s)) / w;
        }
      });
      return { x: x, y: y };
    }
    function phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
    var sa = spec('Ta', fw, Math.max(60, 5 * fw)), sr = spec('Tr', rf, Math.max(5, 5 * rf));
    plot($('#a-plot'), { series: [{ name: 'Alpha particles', x: sa.x, y: sa.y, color: color(0) }], xlab: 'Alpha kinetic energy (keV)', xname: 'T', ylab: 'Probability per keV per decay', log: lg, legend: $('#a-legend') });
    plot($('#a-plot2'), { series: [{ name: 'Recoiling ' + pretty(dn || 'daughter'), x: sr.x, y: sr.y, color: color(1) }], xlab: 'Nuclear recoil kinetic energy (keV), ' + pretty(dn || 'daughter'), xname: 'T', ylab: 'Probability per keV per decay', log: lg, height: 240 });
    A.last = { n: n, dn: dn, lines: lines, sa: sa, sr: sr, Q: Q };
    var tab = el('table', 'sx-table'), hd = el('tr');
    ['Final state E<sub>x</sub> (keV)', 'Branch', 'T*<sub>α</sub> (keV)', 'ENSDF T<sub>α</sub>', 'T*<sub>recoil</sub> (keV)'].concat(Tp > 0 ? ['Lab T<sub>α</sub> range', 'Lab T<sub>recoil</sub> range'] : []).forEach(function (h) { var th = el('th'); th.innerHTML = h; hd.appendChild(th); });
    tab.appendChild(hd);
    lines.slice(0, 15).forEach(function (l) { var tr = el('tr'); [fmt(l.Ex, 5), pc(l.I), fmt(l.Ta, 6), l.ensdf ? fmt(l.ensdf, 6) : '–', fmt(l.Tr, 4)].concat(Tp > 0 ? [fmt(l.TaLo, 5) + ' – ' + fmt(l.TaHi, 5), fmt(l.TrLo, 4) + ' – ' + fmt(l.TrHi, 4)] : []).forEach(function (v, k) { tr.appendChild(el('td', k ? 'num' : null, v)); }); tab.appendChild(tr); });
    out.appendChild(el('h3', null, pretty(n) + ' → ' + pretty(dn || '?') + ' + α'));
    out.appendChild(tab);
    var mean = lines.reduce(function (s, l) { return s + l.I * (l.TaLo + l.TaHi) / 2; }, 0), meanR = lines.reduce(function (s, l) { return s + l.I * (l.TrLo + l.TrHi) / 2; }, 0);
    out.appendChild(el('p', null, 'Mean alpha energy ' + fmt(mean, 6) + ' keV; mean recoil energy ' + fmt(meanR, 5) + ' keV' + (Tp > 0 ? ' (lab frame; each band is centred on T* + m T<sub>p</sub>/M<sub>p</sub>)' : '') + '.'));
    out.lastChild.innerHTML = out.lastChild.textContent;
    var gs = lines.filter(function (l) { return !l.Ex; })[0] || lines[0];
    var bandA = gs ? P.boostRange(gs.Ta, P.MALPHA_KEV, Mp, Tp) : null;
    out.appendChild(formulaBox([
      ['Parent at rest (centre-of-mass frame = parent rest frame)', 'Two-body decay fixes the energies for every emission angle: E*<sub>α</sub> = (M<sub>p</sub>² + m<sub>α</sub>² − (M<sub>d</sub> + E<sub>x</sub>)²) / 2M<sub>p</sub>,&nbsp; T*<sub>α</sub> = E*<sub>α</sub> − m<sub>α</sub>,&nbsp; T*<sub>R</sub> = Q − E<sub>x</sub> − T*<sub>α</sub>&nbsp; (nuclear masses, c = 1). Non-relativistically T*<sub>α</sub> ≈ (Q − E<sub>x</sub>) M<sub>d</sub>/(M<sub>d</sub> + m<sub>α</sub>), T*<sub>R</sub> ≈ (Q − E<sub>x</sub>) m<sub>α</sub>/(M<sub>d</sub> + m<sub>α</sub>).'],
      ['Line width', 'Each branch is a delta function in the parent rest frame: its natural width Γ = ħ/τ is far below 1 eV. Kinematic broadening appears only if the parent moves in the lab (below). The Gaussian widths set on the left are detector resolution, not physics of the decay.'],
      ['Parent moving in the lab', 'With parent kinetic energy T<sub>p</sub> (γ = 1 + T<sub>p</sub>/M<sub>p</sub>, β = √(1 − 1/γ²)) and emission angle θ* in the centre-of-mass frame: E<sub>lab</sub> = γ (E* + β p* cos θ*),&nbsp; p* = √(E*² − m²). Isotropic emission (dN/dcos θ* = ½) makes dN/dT<sub>lab</sub> flat between T<sub>min,max</sub> = γ(E* ∓ β p*) − m. Non-relativistically: (√T* ∓ √(m T<sub>p</sub>/M<sub>p</sub>))². The same holds for the recoil with m = M<sub>d</sub> + E<sub>x</sub>.'],
      ['This decay', 'Q = ' + fmt(Q, 6) + ' keV; ' + (gs && !gs.Ex ? 'ground-state transition' : 'strongest listed transition') + ': T*<sub>α</sub> = ' + fmt(gs ? gs.Ta : NaN, 6) + ' keV, T*<sub>R</sub> = ' + fmt(gs ? gs.Tr : NaN, 5) + ' keV' + (Tp > 0 && bandA ? '; with T<sub>p</sub> = ' + fmt(Tp, 4) + ' keV the lab alpha energy spans ' + fmt(bandA.lo, 6) + ' – ' + fmt(bandA.hi, 6) + ' keV' : '')]]));
    out.appendChild(el('p', 'sx-note', 'Intensities from ENSDF alpha lines; energies are recomputed from Q and the final-state energy, so editing Q moves all lines together. A recoil that is followed by gamma emission gets an extra kick of order E<sub>γ</sub>²/(2Mc²) (eV), not shown. In detectors, nuclear recoils are quenched (Lindhard) and alphas show straggling and dead-layer losses; the detector Gaussians stand in for these.'));
    out.lastChild.innerHTML = out.lastChild.textContent.replace('E<sub>γ</sub>²', 'E<sub>γ</sub>²');
  };
  function aCSV() {
    var a = A.last; if (!a) return;
    var n = Math.max(a.sa.x.length, a.sr.x.length), cols = [[], [], [], []];
    for (var i = 0; i < n; i++) { cols[0].push(a.sa.x[i] == null ? '' : a.sa.x[i]); cols[1].push(a.sa.y[i] == null ? '' : a.sa.y[i]); cols[2].push(a.sr.x[i] == null ? '' : a.sr.x[i]); cols[3].push(a.sr.y[i] == null ? '' : a.sr.y[i]); }
    var meta = ['Radioactive Signal Explorer: alpha decay ' + a.n + ' -> ' + a.dn + ' + alpha, Q = ' + a.Q + ' keV; parent kinetic energy ' + num('#a-tp', 0) + ' keV (flat band from the CM emission angle); detector FWHM ' + num('#a-fwhm', 0) + ' keV (alpha), ' + num('#a-rfwhm', 0) + ' keV (recoil)', 'Lines (Ex keV, branch, T_alpha keV, T_recoil keV): ' + a.lines.map(function (l) { return [l.Ex, l.I.toPrecision(4), l.Ta.toFixed(2), l.Tr.toFixed(3)].join(' '); }).join('; ')];
    download('alpha_' + a.n + '.csv', ['alpha_energy_keV', 'alpha_per_keV', 'recoil_energy_keV', 'recoil_per_keV'], cols, meta);
  }

  /* ================================================================ (alpha,n) */
  var NMAT = [
    ['Acrylic (PMMA)', { C: 0.5998, H: 0.0805, O: 0.3196 }], ['PTFE (Teflon)', { C: 0.2402, F: 0.7598 }], ['Water', { H: 0.1119, O: 0.8881 }],
    ['Fused silica (SiO₂)', { Si: 0.4674, O: 0.5326 }], ['Borosilicate glass', { O: 0.5396, B: 0.0400, Na: 0.0282, Al: 0.0116, Si: 0.3772, K: 0.0033 }],
    ['Stainless steel 304', { Fe: 0.695, Cr: 0.19, Ni: 0.095, Mn: 0.02 }], ['Copper', { Cu: 1 }], ['Titanium', { Ti: 1 }], ['Aluminium', { Al: 1 }],
    ['Liquid argon (natural)', { Ar: 1 }], ['Beryllium', { Be: 1 }], ['Beryllium oxide', { Be: 0.3603, O: 0.6397 }], ['Boron (natural)', { B: 1 }],
    ['Silicon', { Si: 1 }], ['Magnesium', { Mg: 1 }], ['Calcium fluoride', { Ca: 0.5133, F: 0.4867 }], ['Kapton', { C: 0.6911, H: 0.0264, N: 0.0733, O: 0.2092 }],
    ['Standard rock / concrete', { O: 0.4983, Si: 0.3158, Al: 0.0457, Ca: 0.0826, Na: 0.0171, K: 0.0192, Fe: 0.0122, Mg: 0.0024, H: 0.0056, C: 0.0001 }],
    ['Custom…', null]];
  var N = {};
  INIT.an = function () {
    NMAT.forEach(function (m, i) { var o = el('option', null, m[0]); o.value = i; $('#n-mat').appendChild(o); });
    Promise.all([base(), load('data/signals/alphan/index.json'), load('data/signals/alpha_stopping.json'), load('data/gamma/chains.json')]).then(function (r) {
      N.index = r[1].targets; N.stop = r[2]; N.chains = r[3].chains.filter(function (c) { return c.members.some(function (m) { return m.alphas && m.alphas.length; }); });
      N.chains.forEach(function (c) { var o = el('option', null, c.title.replace(/<[^>]+>/g, '')); o.value = c.id; $('#n-chain').appendChild(o); });
      fillList('#a-nuc-list', Object.keys(DEC).filter(function (n) { return DEC[n].a; }).sort(byA));
      ['#n-mat', '#n-custom', '#n-e', '#n-nuc', '#n-chain', '#n-areal', '#n-nparts', '#n-log'].forEach(function (id) { $(id).addEventListener('change', RUN.an); });
      document.querySelectorAll('input[name=n-src],input[name=n-thick]').forEach(function (rr) { rr.addEventListener('change', RUN.an); });
      $('#n-csv').addEventListener('click', nCSV);
      RUN.an();
    }).catch(fail('#n-out'));
  };
  function parseComp(s) { var c = {}; String(s).split(/[,;]+/).forEach(function (p) { var m = /([A-Z][a-z]?)\s*[:=]?\s*([\d.eE+-]+)/.exec(p.trim()); if (m) c[m[1]] = (c[m[1]] || 0) + parseFloat(m[2]); }); var t = 0; Object.keys(c).forEach(function (k) { t += c[k]; }); Object.keys(c).forEach(function (k) { c[k] /= t || 1; }); return c; }
  function isotopesOf(sym) {
    var out = [];
    Object.keys(NUC).forEach(function (k) { var v = NUC[k]; if (v[10] > 0 && k.replace(/^\d+/, '') === sym) out.push({ name: k, A: v[1], ab: v[10] / 100, mass: v[1] + (v[8] || 0) / P.AMU }); });
    return out;
  }
  RUN.an = function () {
    if (!N.index) return;
    var mi = +$('#n-mat').value, custom = !NMAT[mi][1]; $('#n-custom-wrap').hidden = !custom;
    var comp = custom ? parseComp($('#n-custom').value) : NMAT[mi][1], src = srcVal('n-src'), thin = srcVal('n-thick') === 'thin';
    $('#n-e-wrap').hidden = src !== 'e'; $('#n-nuc-wrap').hidden = src !== 'nuc'; $('#n-chain-wrap').hidden = src !== 'chain'; $('#n-areal-wrap').hidden = !thin;
    var out = $('#n-out'); out.innerHTML = '';
    // alphas
    var alphas = [], srcLabel = '';
    if (src === 'e') { alphas = [[num('#n-e', 5.3), 1]]; srcLabel = fmt(alphas[0][0], 4) + ' MeV alphas'; }
    else if (src === 'nuc') {
      var n = normName($('#n-nuc').value), d = DEC[n];
      if (d && d.a) { var t = 0; d.a.forEach(function (a) { t += a[1]; }); alphas = d.a.map(function (a) { return [a[0] / 1000, a[1] / 100]; }); srcLabel = pretty(n) + ' alphas (per decay)'; }
    } else {
      var ch = N.chains.filter(function (c) { return c.id === $('#n-chain').value; })[0];
      if (ch) ch.members.forEach(function (m) { (m.alphas || []).forEach(function (a) { if (m.af > 0) alphas.push([a[0] / 1000, a[1] / 100 * m.af]); }); });
      srcLabel = ch ? ch.title.replace(/<[^>]+>/g, '') + ' in equilibrium (per decay of the chain parent)' : '';
    }
    alphas = alphas.filter(function (a) { return a[0] > 0 && a[1] > 0; });
    if (thin && src !== 'e') { out.appendChild(el('p', 'sx-note', 'A thin target uses one alpha energy: switch the source to Energy.')); }
    if (!alphas.length) { plot($('#n-plot'), { series: [], empty: 'No alphas for this source.' }); return; }
    // targets
    var need = [], missing = [], nAt = {};
    Object.keys(comp).forEach(function (sym) {
      var isos = isotopesOf(sym), M = isos.reduce(function (s, i) { return s + i.ab * i.mass; }, 0) || 1, any = false;
      isos.forEach(function (i) { if (N.index[i.name]) { need.push(i.name); nAt[i.name] = comp[sym] * i.ab * NA / M; any = true; } });
      if (!any && comp[sym] > 0) missing.push(sym);
    });
    var stopEls = Object.keys(comp).filter(function (s) { return N.stop[s]; }), wS = stopEls.reduce(function (s, k) { return s + comp[k]; }, 0);
    var stopping = function (E) { var s = 0; stopEls.forEach(function (k) { s += comp[k] * P.stoppingAt(N.stop[k], E); }); return s / (wS || 1); };
    $('#n-status').textContent = 'Loading cross sections…';
    Promise.all(need.map(function (k) { return load('data/signals/alphan/' + k + '.json').then(function (d) { return { key: k, data: d, nAtomsPerGram: nAt[k], label: pretty(k) + '(α,n)' }; }); })).then(function (targets) {
      $('#n-status').textContent = '';
      var Emax = Math.max.apply(null, alphas.map(function (a) { return a[0]; })) + Math.max.apply([0], targets.map(function (t) { return t.data.Q_MeV; })) + 2;
      var r = P.alphaNSpectrum({ alphas: thin ? null : alphas, thin: thin ? { E: alphas[0][0], arealDensity: num('#n-areal', 1e-3) } : null, targets: targets, stopping: stopping, dE: 0.05, Emax: Math.min(15, Math.max(4, Emax)) });
      var np = Math.max(1, Math.min(30, num('#n-nparts', 8) | 0)), lg = $('#n-log').checked, sumParts = new Float64Array(r.E.length);
      r.partial.forEach(function (p) { for (var i = 0; i < r.E.length; i++) sumParts[i] += p.values[i]; });
      var series = [{ name: 'Total: sum of final states (lab two-body kinematics)', x: r.E, y: sumParts, color: css('--ink'), width: 1.8 }, { name: 'TALYS neutron spectra as integrated by NeuCBOT', x: r.E, y: r.total, color: css('--muted'), dash: [5, 4], width: 1.4 }];
      r.partial.forEach(function (p) { p.label = pretty(p.label); });
      r.partial.slice(0, np).forEach(function (p, k) { series.push({ name: p.label, x: r.E, y: p.values, color: color(k), width: 1.4 }); });
      var unit = thin ? 'neutrons per MeV per alpha' : 'neutrons per MeV per ' + (src === 'e' ? 'alpha' : 'decay');
      plot($('#n-plot'), { series: series, xlab: 'Neutron energy (MeV)', xname: 'Eₙ', ylab: unit, log: lg, legend: $('#n-legend'), ymin: lg ? max(sumParts) * 1e-5 : undefined });
      N.last = { r: r, sumParts: sumParts, unit: unit, comp: comp, src: srcLabel, thin: thin };
      out.appendChild(el('h3', null, 'Neutron yield: ' + fmt(r.yield, 3) + ' ' + unit.replace(' per MeV', '')));
      var notes = [srcLabel + ' in ' + (custom ? 'custom material' : NMAT[mi][0]) + (thin ? ', thin target of ' + fmt(num('#n-areal', 1e-3), 3) + ' g/cm²' : ', thick target (alphas stop in the material)') + '.'];
      if (missing.length) notes.push('No (α,n) data for ' + missing.join(', ') + ' (not in the NeuCBOT/TALYS set, or no isotope with an open channel); they still slow the alphas down if a stopping table exists.');
      var noStop = Object.keys(comp).filter(function (s) { return !N.stop[s]; }); if (noStop.length) notes.push('No stopping-power table for ' + noStop.join(', ') + ': the others are renormalised.');
      out.appendChild(el('p', 'sx-note', notes.join(' ')));
      var tab = el('table', 'sx-table'), hd = el('tr');
      ['Target → residual (final state)', 'Yield', 'Share', 'Eₙ range at the top alpha energy (MeV)'].forEach(function (h) { hd.appendChild(el('th', null, h)); }); tab.appendChild(hd);
      var Etop = Math.max.apply(null, alphas.map(function (a) { return a[0]; }));
      r.partial.slice(0, 25).forEach(function (p) {
        var t = targets.filter(function (x) { return x.key === p.target; })[0], d = t.data, ma = 4.002603, mn = 1.00866492, mR = d.mass_u + ma - mn - d.Q_MeV / 931.494;
        var k = P.anKinematics(Etop, d.Q_MeV, p.Ex / 1000, ma, d.mass_u, mn, mR);
        var tr = el('tr'); [p.label, fmt(p.sum, 3), pc(p.sum / (r.yield || 1)), k ? fmt(k.Emin, 3) + ' – ' + fmt(k.Emax, 3) : 'closed'].forEach(function (v, i) { tr.appendChild(el('td', i ? 'num' : null, v)); }); tab.appendChild(tr);
      });
      out.appendChild(tab);
      var per = el('p'); per.textContent = 'By target: ' + Object.keys(r.perTarget).filter(function (k) { return r.perTarget[k] > 0; }).sort(function (a, b) { return r.perTarget[b] - r.perTarget[a]; }).map(function (k) { return pretty(k) + ' ' + pc(r.perTarget[k] / (r.yield || 1)); }).join(', ') + '.'; out.appendChild(per);
      out.appendChild(formulaBox([
        ['Neutron energy (two-body, non-relativistic)', 'E<sub>n</sub>(θ) = [ √(m<sub>α</sub>m<sub>n</sub>E<sub>α</sub>) cos θ ± √( m<sub>α</sub>m<sub>n</sub>E<sub>α</sub>cos²θ + (m<sub>R</sub>+m<sub>n</sub>)(m<sub>R</sub>Q′ + (m<sub>R</sub>−m<sub>α</sub>)E<sub>α</sub>) ) ]² / (m<sub>R</sub>+m<sub>n</sub>)²,&nbsp; Q′ = Q − E<sub>x</sub>'],
        ['Isotropic emission in the CM frame', 'E<sub>n</sub> is uniformly distributed between (√E* ∓ √E<sub>V</sub>)², with E* = m<sub>R</sub>(E<sub>cm</sub> + Q′)/(m<sub>n</sub>+m<sub>R</sub>), E<sub>cm</sub> = E<sub>α</sub>m<sub>T</sub>/(m<sub>α</sub>+m<sub>T</sub>), E<sub>V</sub> = m<sub>n</sub>m<sub>α</sub>E<sub>α</sub>/(m<sub>α</sub>+m<sub>T</sub>)²'],
        ['Thick-target spectrum (NeuCBOT)', 'dY/dE<sub>n</sub> = Σ<sub>i</sub> n<sub>i</sub> Σ<sub>L</sub> ∫<sub>0</sub><sup>E<sub>0</sub></sup> σ<sub>i,L</sub>(E) f<sub>i,L</sub>(E<sub>n</sub>; E) / S(E) dE,&nbsp; n<sub>i</sub>: atoms of isotope i per gram, S: mass stopping power (Bragg additivity of SRIM tables)']]));
      out.appendChild(el('p', 'sx-note', 'Total and final states: TALYS-1.95 cross sections to each level of the residual nucleus (from the gamma cascade of each level; feeding through the continuum is attributed to the level it ends in, and the ground state gets the remainder), integrated over the slowing-down alpha as in NeuCBOT, with the neutron energy from two-body kinematics and isotropic emission in the centre-of-mass frame. The dashed curve integrates the TALYS neutron spectra instead (the spectra NeuCBOT uses, renormalised to the same cross section). At a single alpha energy those spectra peak near E<sub>cm</sub> + Q − E<sub>x</sub> (centre-of-mass channel energy, broadened by 0.2 MeV) rather than spanning the lab kinematic range, which is why the two curves differ.'));
      out.lastChild.innerHTML = out.lastChild.textContent.replace('E<sub>cm</sub> + Q − E<sub>x</sub>', 'E<sub>cm</sub> + Q − E<sub>x</sub>');
    }).catch(function (e) { $('#n-status').textContent = ''; fail('#n-out')(e); });
  };
  function nCSV() {
    var n = N.last; if (!n) return;
    var hdr = ['neutron_energy_MeV', 'TALYS_spectra_NeuCBOT', 'total_sum_of_final_states'].concat(n.r.partial.map(function (p) { return p.label.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, function (s) { return s.split('').map(function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c); }).join(''); }); }));
    var cols = [n.r.E, n.r.total, n.sumParts].concat(n.r.partial.map(function (p) { return p.values; }));
    download('alpha_n_spectrum.csv', hdr, cols, ['Radioactive Signal Explorer: (alpha,n) neutron spectrum (NeuCBOT method, TALYS-1.95 data)', 'Source: ' + n.src + '; composition: ' + JSON.stringify(n.comp), 'Units: ' + n.unit + '; total yield ' + n.r.yield.toPrecision(4), 'Final-state columns: lab neutron energy from two-body kinematics, isotropic CM emission']);
  }

  /* ================================================================ BETA */
  var CORR = [
    ['L0', 'Finite nuclear size, L₀', 'Wilkinson 1990, uniformly charged sphere', true], ['U', 'Diffuse nuclear surface, U', 'Wilkinson 1993, Fermi distribution', true],
    ['C', 'Finite-size convolution, C', 'Hayen et al. eqs. 100–106; with b/Ac, d/Ac, Λ', true], ['WM', 'Weak magnetism and induced tensor', 'b/Ac, d/Ac in the GT shape factor', true],
    ['rad', 'Radiative O(α)', 'Sirlin 1967; Repko–Wu at the endpoint', true], ['o2', 'Radiative O(Zα²) + RG resummation', 'Sirlin 1987; Czarnecki, Marciano & Sirlin 2004', true],
    ['o3', 'Radiative O(Z²α³) and higher', 'Sirlin 1987 heuristic; Wilkinson 1997', true], ['RN', 'Kinematic recoil, R_N', 'Wilkinson 1990', true], ['Q', 'Coulomb recoil, Q', 'Wilkinson 1982', true],
    ['S', 'Atomic screening, S', 'Bühring 1984 (Rose-type potential shift)', true], ['X', 'Atomic exchange, X (β⁻)', 'Hayen et al. eq. 157, Table X', true],
    ['r', 'Atomic mismatch, r', 'Bahcall; Hayen et al. eq. 166', true], ['lambda', 'Coulomb functions λₖ (unique forbidden)', 'Behrens–Bühring; λₖ = 1 if off', true]];
  var B = {};
  INIT.beta = function () {
    var box = $('#b-corr');
    CORR.forEach(function (c) { var l = el('label', 'sx-check'), i = el('input'); i.type = 'checkbox'; i.id = 'bc-' + c[0]; i.checked = c[3]; l.appendChild(i); l.appendChild(document.createTextNode(' ' + c[1])); l.title = c[2]; var s = el('span', 'sx-cite', c[2]); l.appendChild(s); box.appendChild(l); i.addEventListener('change', RUN.beta); });
    base().then(function () {
      fillList('#b-nuc-list', Object.keys(DEC).filter(function (n) { return DEC[n].bm || DEC[n].bp; }).sort(byA));
      $('#b-nuc').addEventListener('change', bNuc); $('#b-nuc').addEventListener('input', function () { if (DEC[normName(this.value)]) bNuc(); });
      $('#b-branch').addEventListener('change', bBranch);
      ['#b-t0', '#b-sign', '#b-z', '#b-a', '#b-r', '#b-kind', '#b-k', '#b-rho', '#b-bac', '#b-dac', '#b-lam', '#b-sa', '#b-sb', '#b-sc', '#b-fierz', '#b-mnu', '#b-ms', '#b-u2', '#b-log', '#b-ref', '#b-kurie'].forEach(function (id) { $(id).addEventListener('change', RUN.beta); });
      $('#b-fierz-calc').addEventListener('click', function () { var rho = parseRho(); $('#b-fierz').value = +P.fierzFromCouplings(rho, num('#b-cs', 0), num('#b-ct', 0), +$('#b-sign').value).toPrecision(5); RUN.beta(); });
      $('#b-csv').addEventListener('click', bCSV);
      $('#b-py').addEventListener('click', function () { bCode('py'); }); $('#b-cpp').addEventListener('click', function () { bCode('cpp'); });
      $('#b-copy').addEventListener('click', function () { navigator.clipboard && navigator.clipboard.writeText($('#b-code').textContent); this.textContent = 'Copied'; var b = this; setTimeout(function () { b.textContent = 'Copy'; }, 1500); });
      bNuc();
    }).catch(fail('#b-out'));
  };
  function parseRho() { var s = String($('#b-rho').value).trim().toLowerCase(); if (s === 'inf' || s === '∞' || s === 'infinity') return Infinity; var v = parseFloat(s); return isFinite(v) ? v : Infinity; }
  function bBranches(n) { var d = DEC[n] || {}, out = []; (d.bm || []).forEach(function (b) { out.push({ sign: -1, b: b }); }); (d.bp || []).forEach(function (b) { out.push({ sign: 1, b: b }); }); return out; }
  function bNuc() {
    var n = normName($('#b-nuc').value), br = bBranches(n), sel = $('#b-branch'); sel.innerHTML = '';
    if (!br.length) { RUN.beta(); return; }
    if (br.length > 1) { var o = el('option', null, 'All branches, weighted by intensity (' + br.length + ')'); o.value = 'all'; sel.appendChild(o); }
    br.forEach(function (x, i) { var b = x.b, o = el('option', null, (x.sign < 0 ? 'β⁻ ' : 'β⁺ ') + fmt(b[0], 5) + ' keV, ' + fmt(b[1], 3) + '% → ' + (b[2] ? fmt(b[2], 5) + ' keV' : 'ground state') + (b[4] ? ' [' + b[4] + ']' : '')); o.value = i; sel.appendChild(o); });
    sel.value = '0'; bBranch();
  }
  function bBranch() {
    var n = normName($('#b-nuc').value), br = bBranches(n), v = $('#b-branch').value, x = br[v === 'all' ? 0 : +v || 0];
    if (!x) { RUN.beta(); return; }
    var i = nucInfo(n), b = x.b, dn = daughterName(n, x.sign < 0 ? 1 : -1), di = nucInfo(dn) || {};
    $('#b-t0').value = b[0]; $('#b-sign').value = x.sign; $('#b-z').value = (i.Z + (x.sign < 0 ? 1 : -1)); $('#b-a').value = i.A;
    $('#b-r').value = di.r ? +di.r.toFixed(4) : +(0.836 * Math.pow(i.A, 1 / 3) + 0.57).toFixed(3);
    var rule = classify(n, x);
    $('#b-kind').value = rule.kind; $('#b-k').value = Math.max(1, rule.k || 1);
    var pure = rule.pure; $('#b-rho').value = pure === 'F' ? '0' : pure === 'GT' ? 'inf' : (rule.kind === 'A' ? 'inf' : 'inf');
    $('#b-bac').value = pure === 'F' ? 0 : 5;
    $('#b-rule').innerHTML = rule.text;
    RUN.beta();
  }
  function classify(n, x) {
    var i = nucInfo(n), b = x.b, Ji = P.parseJP(/^\d+m/.test(n) ? '' : i.jp), Jf = P.parseJP(b[5]);
    var f = P.forbiddenness(b[4], Ji && Ji.J, Ji && Ji.P, Jf && Jf.J, Jf && Jf.P) || { kind: 'A', k: 0, from: 'default' };
    var parts = [], pure = null;
    if (Ji && Jf) {
      var dJ = Math.abs(Ji.J - Jf.J), dP = Ji.P !== Jf.P;
      parts.push((/^\d+m/.test(n) ? 'Isomer' : pretty(n)) + ' ' + i.jp + ' → ' + b[5] + ': ΔJ = ' + dJ + ', parity ' + (dP ? 'changes' : 'unchanged') + '.');
      if (!dP && dJ <= 1) { pure = Ji.J === 0 && Jf.J === 0 ? 'F' : (dJ === 1 || Ji.J === 0 || Jf.J === 0) ? 'GT' : 'mixed'; parts.push(pure === 'F' ? 'Allowed, pure Fermi (0⁺ → 0⁺).' : pure === 'GT' ? 'Allowed, pure Gamow–Teller (ΔJ = 1, or J = 0 on one side).' : 'Allowed, mixed Fermi/Gamow–Teller (ΔJ = 0, J ≠ 0): set ρ if known (mirror decays have ρ from the ft value).'); }
      else if (dJ >= 2 && ((dJ - 1) % 2 === 1) === dP) parts.push('Unique ' + ord(dJ - 1) + ' forbidden (ΔJ = k + 1 = ' + dJ + ', Δπ = (−1)ᵏ): the shape factor follows from the lepton phase space alone.');
      else parts.push('Non-unique ' + ord(Math.max(1, f.k)) + ' forbidden: the shape depends on nuclear matrix elements; the ξ approximation (allowed shape) is used unless you enter a shape factor.');
      if (Ji.tentative || Jf.tentative) parts.push('Spin assignments are tentative.');
    } else parts.push('Spins or parities unknown for this branch' + (b[5] === '' ? ' (final level not in the level scheme)' : '') + '.');
    if (b[4]) parts.push('ENSDF classifies it as ' + ({ A: 'allowed', '1U': 'first unique forbidden', '1NU': 'first non-unique forbidden', '2U': 'second unique forbidden', '2NU': 'second non-unique forbidden', '3U': 'third unique forbidden', '3NU': 'third non-unique forbidden', S: 'superallowed', SA: 'superallowed' }[b[4]] || b[4]) + (b[3] ? ' (log ft = ' + b[3] + ')' : '') + '.');
    else if (b[3]) parts.push('log ft = ' + b[3] + '.');
    return { kind: f.kind, k: f.k, pure: pure, text: parts.join(' ') };
  }
  function ord(k) { return ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'][k] || k + 'th'; }
  function bParams(T0, over) {
    var corr = {}; CORR.forEach(function (c) { corr[c[0]] = $('#bc-' + c[0]).checked; });
    var kind = $('#b-kind').value, p = { Z: num('#b-z', 1) | 0, A: num('#b-a', 1) | 0, beta: +$('#b-sign').value, T0: T0, rrms: num('#b-r', 0) || null,
      kind: kind, k: num('#b-k', 1) | 0, rho: parseRho(), bAc: num('#b-bac', 0), dAc: num('#b-dac', 0), Lambda: num('#b-lam', 0),
      shape: { a: num('#b-sa', 0), b: num('#b-sb', 0), c: num('#b-sc', 0) }, fierz: num('#b-fierz', 0), mnu: num('#b-mnu', 0), msterile: num('#b-ms', 0), Usterile2: num('#b-u2', 0), corr: corr, n: 600 };
    return Object.assign(p, over || {});
  }
  RUN.beta = function () {
    var n = normName($('#b-nuc').value), out = $('#b-out'); out.innerHTML = '';
    var kind = $('#b-kind').value; $('#b-k-wrap').hidden = kind === 'A';
    var T0 = num('#b-t0', NaN);
    if (!(T0 > 0)) { plot($('#b-plot'), { series: [], empty: 'Choose a beta emitter or enter an endpoint energy.' }); plot($('#b-plot2'), { series: [] }); return; }
    var br = bBranches(n), all = $('#b-branch').value === 'all' && br.length > 1;
    var spec, ref, lg = $('#b-log').checked, kur = $('#b-kurie').checked;
    if (all) {                             // intensity-weighted sum of every branch, each with its own classification
      var Tmax = Math.max.apply(null, br.map(function (x) { return x.b[0]; })), nb = 800, T = new Float64Array(nb), Y = new Float64Array(nb), Yr = new Float64Array(nb), tot = 0;
      for (var i = 0; i < nb; i++) T[i] = Tmax * (i + 0.5) / nb;
      br.forEach(function (x) {
        var c = classify(n, x), info = nucInfo(n);
        var pr = bParams(x.b[0], { beta: x.sign, Z: info.Z + (x.sign < 0 ? 1 : -1), kind: c.kind, k: Math.max(1, c.k || 1), rho: c.pure === 'F' ? 0 : Infinity, bAc: c.pure === 'F' ? 0 : 5, shape: null });
        var s = P.betaSpectrum(pr), s0 = $('#b-ref').checked ? P.betaSpectrum(Object.assign({}, pr, { corr: {} })) : null, w = x.b[1] / 100; tot += w;
        for (var j = 0; j < nb; j++) { Y[j] += w * interp(s.T, s.dNdT, T[j]); if (s0) Yr[j] += w * interp(s0.T, s0.dNdT, T[j]); }
      });
      spec = { T: T, dNdT: Y, mean: meanOf(T, Y) / (tot || 1), factors: null }; ref = $('#b-ref').checked ? { T: T, dNdT: Yr } : null;
    } else {
      spec = P.betaSpectrum(bParams(T0)); ref = $('#b-ref').checked ? P.betaSpectrum(bParams(T0, { corr: {} })) : null;
    }
    var yl = all ? 'Electrons per keV per decay' : 'Probability per keV (normalised)';
    var series = [{ name: 'With selected corrections', x: spec.T, y: kur ? kurie(spec, all) : spec.dNdT, color: color(0) }];
    if (ref) series.push({ name: 'Same shape, no corrections (F₀ only)', x: ref.T, y: kur ? kurie(ref, all) : ref.dNdT, color: css('--muted'), dash: [5, 4], width: 1.4 });
    plot($('#b-plot'), { series: series, xlab: 'Kinetic energy (keV)', xname: 'T', ylab: kur ? 'Kurie: √(N / pW F₀) (arb.)' : yl, log: lg && !kur, legend: $('#b-legend'), ymin: lg && !kur ? max(spec.dNdT) * 1e-5 : undefined });
    // correction factors panel
    if (spec.factors) {
      var fs = [], k = 0;
      [['L0', 'Finite size L₀ · U'], ['C', 'Convolution C (incl. weak magnetism)'], ['R', 'Radiative'], ['S', 'Screening'], ['X', 'Exchange'], ['r', 'Mismatch'], ['RN', 'Recoil R_N · Q'], ['fierz', 'Fierz']].forEach(function (f) {
        var y = spec.factors[f[0]]; if (!y) return;
        if (f[0] === 'RN') y = y.map(function (v, i) { return v * spec.factors.Q[i]; });
        if (f[0] === 'L0') y = y.map(function (v, i) { return v * spec.factors.U[i]; });
        var dev = 0; for (var i = 0; i < y.length; i++) dev = Math.max(dev, Math.abs(y[i] - 1));
        if (dev > 1e-6) fs.push({ name: f[1], x: spec.T, y: y, color: color(k++) });
      });
      plot($('#b-plot2'), { series: fs, xlab: 'Kinetic energy (keV)', xname: 'T', ylab: 'Correction factor', legend: $('#b-legend2'), height: 250, empty: 'Turn on corrections to see their energy dependence.' });
      $('#b-plot2').parentNode.hidden = false;
    } else $('#b-plot2').parentNode.hidden = true;
    B.last = { spec: spec, ref: ref, all: all, n: n, T0: T0 };
    // text
    var d = br[$('#b-branch').value === 'all' ? 0 : +$('#b-branch').value || 0];
    var lines = [];
    lines.push('Mean kinetic energy ' + fmt(spec.mean, 5) + ' keV' + (ref ? ' (F₀ only: ' + fmt(meanOf(ref.T, ref.dNdT) / (all ? sum(ref.dNdT, ref.T) : 1), 5) + ' keV)' : '') + (d && d.b[6] && !all ? '; ENSDF mean ' + fmt(d.b[6], 5) + ' keV' : '') + '.');
    out.appendChild(el('p', null, lines.join(' ')));
    if (!all) out.appendChild(betaFormula(bParams(T0), spec));
    out.appendChild(el('p', 'sx-note', 'Not included: nuclear deformation (D_FS, D_C), the induced pseudoscalar term, shake-up/shake-off, molecular effects, bound-state decay, inner bremsstrahlung as a separate photon spectrum, and nuclear-structure calculations of non-unique forbidden shapes. Screening uses the potential shift V₀ = 1.45 α² Z<sub>parent</sub>^(4/3) rather than Salvat’s fitted potentials. The radiative short-distance constant (1.0267…) is divided out: it does not change the shape.'));
    out.lastChild.innerHTML = out.lastChild.textContent.replace('Z<sub>parent</sub>^(4/3)', 'Z<sub>parent</sub><sup>4/3</sup>');
  };
  function sum(y, T) { var s = 0, d = T.length > 1 ? T[1] - T[0] : 1; for (var i = 0; i < y.length; i++) s += y[i] * d; return s; }
  function meanOf(T, y) { var s = 0, d = T.length > 1 ? T[1] - T[0] : 1; for (var i = 0; i < T.length; i++) s += T[i] * y[i] * d; return s; }
  function interp(x, y, v) { if (v <= x[0]) return y[0] * v / x[0]; if (v >= x[x.length - 1]) return 0; var lo = 0, hi = x.length - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (x[m] <= v) lo = m; else hi = m; } return y[lo] + (y[hi] - y[lo]) * (v - x[lo]) / (x[hi] - x[lo]); }
  function kurie(s, all) {
    var c = P.betaContext(bParams(num('#b-t0', 1))), out = new Float64Array(s.T.length);
    for (var i = 0; i < s.T.length; i++) { var W = s.T[i] / ME + 1, p = Math.sqrt(W * W - 1); out[i] = Math.sqrt(Math.max(s.dNdT[i], 0) / (p * W * P.F0(c, W))); }
    return out;
  }
  function betaFormula(p, s) {
    var c = s.ctx, rows = [];
    rows.push(['Spectrum', 'N(W) dW ∝ p W (W₀ − W)² · F₀(Z,W) · L₀ · U · C(Z,W) · R(W,W₀) · R<sub>N</sub> · Q · S · X · r · [1 + b<sub>F</sub> γ/W]&nbsp; with W = 1 + T/m<sub>e</sub>c², p = √(W² − 1), W₀ = ' + fmt(c.W0, 6) + ' (T₀ = ' + fmt(p.T0, 6) + ' keV)']);
    rows.push(['Fermi function', 'F₀ = 4 (2pR)<sup>2(γ−1)</sup> e<sup>πy</sup> |Γ(γ + iy)|² / Γ(1 + 2γ)²,&nbsp; γ = √(1 − (αZ)²) = ' + fmt(c.g1, 6) + ',&nbsp; y = ' + (p.beta < 0 ? '' : '−') + 'αZW/p,&nbsp; R = √(5/3) r<sub>rms</sub> = ' + fmt(c.R * P.HBARC_FM, 4) + ' fm = ' + fmt(c.R, 4) + ' ħ/m<sub>e</sub>c']);
    if (p.kind === 'U') rows.push(['Unique forbidden shape (k = ' + p.k + ')', 'C(W) ∝ Σ<sub>n=1</sub><sup>k+1</sup> λ<sub>n</sub> p<sup>2(n−1)</sup> q<sup>2(k+1−n)</sup> / [(2n−1)! (2(k+1−n)+1)!],&nbsp; q = W₀ − W,&nbsp; λ<sub>n</sub> = F<sub>n−1</sub>/F₀ · (n + γ<sub>n</sub>)/(n(1 + γ₁)),&nbsp; F<sub>n−1</sub> = [n(2n−1)!!]² 4<sup>n</sup> (2pR)<sup>2(γₙ−n)</sup> e<sup>πy</sup> |Γ(γₙ+iy)|²/Γ(1+2γₙ)²']);
    if (p.corr.rad) rows.push(['Radiative (O(α))', '1 + δ₁ = 1 + (α/2π)[g(W₀,W) − 3 ln(m<sub>p</sub>/2W₀)], with Sirlin’s g; the t(β) ln(W₀−W) term is resummed as (W₀−W)<sup>t(β)</sup> − 1']);
    if (p.fierz || p.mnu || p.Usterile2) rows.push(['BSM', (p.fierz ? 'Fierz: × (1 + b<sub>F</sub> γ/W), b<sub>F</sub> = ' + p.fierz + '. ' : '') + (p.mnu || p.Usterile2 ? 'Neutrino mass: (W₀−W)² → (W₀−W)√((W₀−W)² − m<sub>ν</sub>²); sterile admixture: (1 − |U|²) N(m<sub>ν</sub>) + |U|² N(m<sub>s</sub>).' : '')]);
    rows.push(['Reference', 'L. Hayen et al., Rev. Mod. Phys. 90, 015008 (2018), eqs. 4–170; the Python and C++ buttons export this calculation as code.']);
    return formulaBox(rows);
  }
  function bCSV() {
    var b = B.last; if (!b) return;
    var cols = [b.spec.T, b.spec.dNdT], hdr = ['kinetic_energy_keV', 'dN_dT_per_keV'];
    if (b.ref) { cols.push(b.ref.dNdT); hdr.push('F0_only_per_keV'); }
    if (b.spec.factors) Object.keys(b.spec.factors).forEach(function (k) { cols.push(b.spec.factors[k]); hdr.push('factor_' + k); });
    var p = bParams(num('#b-t0', 0));
    download('beta_' + b.n + '.csv', hdr, cols, ['Radioactive Signal Explorer: beta spectrum of ' + b.n + (b.all ? ' (all branches, per decay)' : ' (one branch, normalised to 1)'),
      'Parameters: ' + JSON.stringify({ Z: p.Z, A: p.A, beta: p.beta, T0_keV: p.T0, rrms_fm: p.rrms, kind: p.kind, k: p.k, rho: String(p.rho), bAc: p.bAc, dAc: p.dAc, Lambda: p.Lambda, fierz: p.fierz, mnu_eV: p.mnu, msterile_keV: p.msterile, U2: p.Usterile2 }),
      'Corrections: ' + Object.keys(p.corr).filter(function (k) { return p.corr[k]; }).join(' ')]);
  }
  function bCode(lang) {
    var p = bParams(num('#b-t0', 0)), code = window.SignalCode ? window.SignalCode[lang](p) : '// code generator not loaded';
    $('#b-code').textContent = code; $('#b-code-wrap').hidden = false;
  }

  /* ================================================================ CHERENKOV */
  var CMAT = [
    ['Water (20 °C)', { sell: [[5.684027565e-1, 1.726177391e-1, 2.086189578e-2, 1.130748688e-1], [5.101829712e-3, 1.821153936e-2, 2.620722293e-2, 1.069792721e1]], rho: 0.998, ZA: 0.5551, I: 75, Zeff: 7.4, src: 'Daimon & Masumura 2007' }],
    ['Fused silica', { sell: [[0.6961663, 0.4079426, 0.8974794], [0.00467914826, 0.0135120631, 97.9340025]], rho: 2.20, ZA: 0.4993, I: 139.2, Zeff: 11, src: 'Malitson 1965' }],
    ['Acrylic (PMMA)', { sell: [[1.1819], [0.011313]], rho: 1.19, ZA: 0.5394, I: 74, Zeff: 6.5, src: 'Sultanova et al. 2009' }],
    ['Borosilicate crown (N-BK7)', { sell: [[1.03961212, 0.231792344, 1.01046945], [0.00600069867, 0.0200179144, 103.560653]], rho: 2.51, ZA: 0.4973, I: 134, Zeff: 11, src: 'Schott' }],
    ['Sapphire (ordinary ray)', { sell: [[1.4313493, 0.65054713, 5.3414021], [0.00527992610, 0.0142382647, 325.017834]], rho: 3.98, ZA: 0.4904, I: 145.2, Zeff: 11, src: 'Malitson & Dodge 1972' }],
    ['Diamond', { sell: [[0.3306, 4.3356], [0.030625, 0.011236]], rho: 3.51, ZA: 0.4995, I: 78, Zeff: 6, src: 'Peter 1923' }],
    ['Liquid argon (n ≈ 1.23)', { n: 1.23, rho: 1.396, ZA: 0.4506, I: 188, Zeff: 18, src: 'approximate visible-range value' }],
    ['Liquid xenon (n ≈ 1.39)', { n: 1.39, rho: 2.953, ZA: 0.4113, I: 482, Zeff: 54, src: 'approximate visible-range value' }],
    ['Linear alkylbenzene (n ≈ 1.48)', { n: 1.48, rho: 0.86, ZA: 0.552, I: 63, Zeff: 5.6, src: 'approximate visible-range value' }]];
  var C = {};
  INIT.cher = function () {
    CMAT.forEach(function (m, i) { var o = el('option', null, m[0]); o.value = i; $('#c-mat').appendChild(o); });
    $('#c-mat').addEventListener('change', function () { var m = CMAT[+this.value][1]; $('#c-rho').value = m.rho; $('#c-za').value = m.ZA; $('#c-i').value = m.I; RUN.cher(); });
    ['#c-e', '#c-const', '#c-b1', '#c-b2', '#c-b3', '#c-c1', '#c-c2', '#c-c3', '#c-rho', '#c-za', '#c-i', '#c-l0', '#c-l1'].forEach(function (id) { $(id).addEventListener('change', RUN.cher); });
    document.querySelectorAll('input[name=c-src],input[name=c-n]').forEach(function (r) { r.addEventListener('change', RUN.cher); });
    $('#c-csv').addEventListener('click', cCSV);
    var m0 = CMAT[0][1]; $('#c-rho').value = m0.rho; $('#c-za').value = m0.ZA; $('#c-i').value = m0.I;
    RUN.cher();
  };
  RUN.cher = function () {
    var src = srcVal('c-src'), nm = srcVal('c-n'), out = $('#c-out'); out.innerHTML = '';
    $('#c-e-wrap').hidden = src !== 'mono'; $('#c-mat-wrap').hidden = nm !== 'mat'; $('#c-const-wrap').hidden = nm !== 'const'; $('#c-sell-wrap').hidden = nm !== 'sell';
    var nf, label, mat = CMAT[+$('#c-mat').value][1];
    if (nm === 'mat') { nf = mat.sell ? function (l) { return P.sellmeier(mat.sell[0], mat.sell[1], l); } : function () { return mat.n; }; label = CMAT[+$('#c-mat').value][0] + ' (' + mat.src + ')'; }
    else if (nm === 'const') { var nc = num('#c-const', 1.33); nf = function () { return nc; }; label = 'n = ' + nc; }
    else { var Bs = [num('#c-b1', 0), num('#c-b2', 0), num('#c-b3', 0)], Cs = [num('#c-c1', 0), num('#c-c2', 0), num('#c-c3', 0)]; nf = function (l) { return P.sellmeier(Bs, Cs, l); }; label = 'Sellmeier B = ' + Bs.join(', ') + '; C = ' + Cs.join(', ') + ' µm²'; }
    // electrons
    var T, w, dT, srcLabel, note = '';
    if (src === 'mono') { var E = num('#c-e', 1000); dT = Math.max(0.5, E / 400); T = [E]; w = [1 / dT]; srcLabel = 'one ' + fmt(E, 4) + ' keV electron'; }
    else if (src === 'beta') {
      var b = B.last; if (!b) { note = 'Open the Beta tab first to compute a spectrum (using 90Y by default).'; }
      if (b) { T = b.spec.T; w = b.spec.dNdT; dT = T.length > 1 ? T[1] - T[0] : 1; srcLabel = 'beta spectrum of ' + pretty(b.n) + (b.all ? ' (per decay)' : ' (per beta)'); }
    } else {
      var g = G.last; if (!g) note = 'Open the Gamma tab first to compute the electrons set in motion by a gamma source.';
      if (g) { T = g.x; w = g.electrons; dT = g.bin; srcLabel = 'electrons from one gamma interaction (' + (srcVal('g-src') === 'e' ? fmt(g.lines[0][0], 5) + ' keV' : pretty(normName($('#g-nuc').value)) + ', per decay') + ')'; }
    }
    $('#c-src-note').textContent = note;
    if (!T) {
      if (src !== 'mono') { var need = src === 'beta' ? 'beta' : 'gamma'; if (!DONE[need]) { DONE[need] = true; INIT[need](); setTimeout(RUN.cher, 1200); } }
      plot($('#c-plot'), { series: [], empty: 'No electron spectrum yet.' }); return;
    }
    var l0 = num('#c-l0', 200), l1 = Math.max(num('#c-l1', 700), l0 + 10), nl = 300, lam = [];
    for (var i = 0; i < nl; i++) lam.push(l0 + (l1 - l0) * i / (nl - 1));
    var m = { n: nf, rho: num('#c-rho', 1), ZA: num('#c-za', 0.555), I: num('#c-i', 75), Zeff: nm === 'mat' ? mat.Zeff : 7.4 };
    var Tmax = Math.max.apply(null, T) * 1.01 + 1, tab = P.cherenkovTable(m, lam, Tmax), y = P.cherenkovFromSpectrum(tab, T, w, dT);
    var total = 0; for (i = 1; i < nl; i++) total += 0.5 * (y[i] + y[i - 1]) * (lam[i] - lam[i - 1]);
    plot($('#c-plot'), { series: [{ name: 'Cherenkov photons', x: lam, y: y, color: color(6) }], xlab: 'Wavelength (nm)', xname: 'λ', ylab: 'Photons per nm per ' + (src === 'mono' ? 'electron' : src === 'beta' ? (B.last && B.last.all ? 'decay' : 'beta') : 'decay'), legend: $('#c-legend') });
    plot($('#c-plot2'), { series: [{ name: 'n(λ)', x: lam, y: tab.nl, color: color(0) }], xlab: 'Wavelength (nm)', xname: 'λ', ylab: 'Refractive index n', height: 220, ymin: Math.min.apply(null, tab.nl) * 0.995, ymax: Math.max.apply(null, tab.nl) * 1.005 });
    C.last = { lam: lam, y: y, n: tab.nl, label: label, srcLabel: srcLabel, total: total };
    var th = tab.threshold[Math.floor(nl / 2)];
    out.appendChild(el('h3', null, fmt(total, 4) + ' photons between ' + fmt(l0, 4) + ' and ' + fmt(l1, 4) + ' nm'));
    out.appendChild(el('p', null, 'Source: ' + srcLabel + '. Medium: ' + label + '. Electron threshold at ' + fmt(lam[Math.floor(nl / 2)], 4) + ' nm: ' + fmt(th, 4) + ' keV kinetic energy (n = ' + fmt(tab.nl[Math.floor(nl / 2)], 5) + ').'));
    out.appendChild(formulaBox([
      ['Frank–Tamm', 'd²N / dx dλ = (2π α z² / λ²) (1 − 1 / (β² n(λ)²)),&nbsp; emitted while β n(λ) > 1'],
      ['Along the track', 'dN/dλ (T₀) = ∫<sub>T<sub>th</sub></sub><sup>T₀</sup> (d²N/dx dλ) / (dT/dx) dT,&nbsp; dT/dx: Bethe collision stopping power for electrons (ICRU 37, no density effect) plus an approximate radiative term'],
      ['Threshold', 'T<sub>th</sub> = m<sub>e</sub>c² [1/√(1 − 1/n²) − 1]'],
      ['Spectrum of primaries', 'dN/dλ = ∫ (dN<sub>e</sub>/dT₀) · dN/dλ(T₀) dT₀']]));
    out.appendChild(el('p', 'sx-note', 'Assumes the electron slows down continuously in a uniform medium and ignores secondary electrons (delta rays), multiple scattering and the density effect, which matter above a few MeV. Normalised per primary electron, per beta, or per decay as labelled.'));
  };
  function cCSV() { var c = C.last; if (!c) return; download('cherenkov.csv', ['wavelength_nm', 'photons_per_nm', 'refractive_index'], [c.lam, c.y, c.n], ['Radioactive Signal Explorer: Cherenkov photon spectrum (Frank-Tamm)', 'Source: ' + c.srcLabel + '; medium: ' + c.label, 'Total photons in range: ' + c.total.toPrecision(5)]); }

  /* ---------------------------------------------------------------- start */
  TABS.forEach(function (t) { $('#tab-' + t).addEventListener('click', function () { showTab(t, true); }); });
  var start = (location.hash || '').replace('#', '');
  showTab(TABS.indexOf(start) >= 0 ? start : 'gamma', false);
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { TABS.forEach(function (t) { if (DONE[t] && !$('#panel-' + t).hidden) RUN[t](); }); }, 200); });
})();
