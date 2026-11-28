/* Radioactive Signal Explorer: user interface. Physics in signals-physics.js. */
(function () {
  'use strict';
  var P = window.SignalPhysics, X = window.SignalExtra;
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
      c.fillStyle = muted; var right = x > L + pw - c.measureText(m.label).width - 10; c.textAlign = right ? 'right' : 'left'; c.fillText(m.label, right ? x - 4 : x + 4, T + 14 + (m.row || 0) * 14);
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
  function tickLabel(t, log) { if (log) return '10' + sup(String(Math.round(Math.log10(t)))); var a = Math.abs(t); if (a >= 1e5 || (a < 1e-2 && a > 0)) { var e = Math.floor(Math.log10(a) + 1e-9), m = +(t / Math.pow(10, e)).toPrecision(3); if (Math.abs(m) >= 10) { m /= 10; e += 1; } return m + 'e' + e; } return String(+t.toPrecision(6)); }

  /* ---------------------------------------------------------------- tabs */
  var TABS = ['gamma', 'alpha', 'an', 'beta', 'cher'], DONE = {};
  function showTab(t, push) {
    TABS.forEach(function (k) { $('#tab-' + k).setAttribute('aria-selected', k === t ? 'true' : 'false'); $('#panel-' + k).hidden = k !== t; });
    if (push) history.replaceState(null, '', '#' + t);
    if (!DONE[t]) { DONE[t] = true; INIT[t](); } else RUN[t]();
  }
  var INIT = {}, RUN = {};

  /* ---------------------------------------------------------------- shared data */
  var NUC = null, IDX = null, DEC = {};   // DEC fills per element as files load (data/signals/decays/<El>.json)
  function base() { return Promise.all([load('data/signals/nuclides.json'), load('data/signals/decays/index.json')]).then(function (r) { NUC = r[0]; IDX = r[1]; }); }
  function has(n, kind) { var f = IDX && IDX[n]; return !!f && (!kind || f.split(',').some(function (k) { return kind.split('|').indexOf(k) >= 0; })); }
  function names(kind) { return Object.keys(IDX).filter(function (n) { return has(n, kind); }).sort(byA); }
  function withDec(n, fn) {             // load the element file holding nuclide n, then call fn
    if (!IDX || !IDX[n] || DEC[n]) { fn(); return; }
    load('data/signals/decays/' + n.replace(/^\d+m?/, '') + '.json').then(function (d) { Object.assign(DEC, d); fn(); }).catch(function () { fn(); });
  }
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
      fillList('#g-nuc-list', names('g'));
      ['#g-nuc', '#g-line', '#g-e', '#g-mat', '#g-fwhm', '#g-esc', '#g-log', '#g-x', '#g-ce', '#g-ipc', '#g-mc', '#g-geo', '#g-R', '#g-H', '#g-rho', '#g-n', '#g-pos', '#g-dist', '#g-corr',
        '#g-dop', '#g-dE', '#g-dT', '#g-dM', '#g-dtau', '#g-dstop'].forEach(function (id) { $(id).addEventListener(id === '#g-esc' ? 'input' : 'change', id === '#g-nuc' ? gNuc : RUN.gamma); });
      $('#g-nuc').addEventListener('input', function () { if (has(normName(this.value), 'g')) gNuc(); });
      document.querySelectorAll('input[name=g-src]').forEach(function (r) { r.addEventListener('change', function () { var nuc = srcVal('g-src') === 'nuc'; $('#g-nuc-wrap').hidden = $('#g-line-wrap').hidden = !nuc; $('#g-e-wrap').hidden = nuc; RUN.gamma(); }); });
      $('#g-csv').addEventListener('click', gCSV);
      $('#g-mat').addEventListener('change', function () { var d = GRHO[GMAT[+this.value][0]]; if (d) $('#g-rho').value = d; });
      $('#g-dop-pre').addEventListener('change', function () {
        var pr = { b10: [477.6, 840, 7.016, 105, 300], c12: [4438.9, 1500, 12, 61, 300] }[this.value]; if (!pr) return;
        ['#g-dE', '#g-dT', '#g-dM', '#g-dtau', '#g-dstop'].forEach(function (id, i) { $(id).value = pr[i]; }); RUN.gamma();
      });
      gNuc();
    }).catch(fail('#g-out'));
  };
  function byA(a, b) { var x = parseInt(a, 10), y = parseInt(b, 10); return x - y || a.localeCompare(b); }
  function srcVal(name) { var r = document.querySelector('input[name=' + name + ']:checked'); return r ? r.value : null; }
  function fail(sel) { return function (e) { $(sel).innerHTML = ''; $(sel).appendChild(el('p', 'sx-warn', 'Could not load data: ' + (e && e.message || e))); }; }
  function gNuc() { var n = normName($('#g-nuc').value); withDec(n, gNuc2); }
  function gNuc2() {
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
    var v = $('#g-line').value; if (v !== 'all') return [d.g[+v || 0]];
    var L = d.g.filter(function (l) { return l[0] > 10; });
    if ($('#g-x').checked && d.x) d.x.forEach(function (x) { if (x[0] > 10) L.push([x[0], x[1], null, null, 'X-ray', null, null, '', '', x[2]]); });
    return L;
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
    $('#g-mc-wrap').hidden = !$('#g-mc').checked; $('#g-dist-wrap').hidden = $('#g-pos').value !== 'external'; $('#g-H-l').hidden = $('#g-geo').value === 'sphere'; $('#g-dop-wrap').hidden = !$('#g-dop').checked;
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
    gExtras(out, lines, comp, bin, x);
    gMC(out, lines, comp);
    gDoppler(out, comp);
  };
  var GRHO = { 'NaI(Tl)': 3.67, 'CsI': 4.51, 'Germanium (HPGe)': 5.32, 'Silicon': 2.33, 'Liquid argon': 1.396, 'Liquid xenon': 2.953, 'Water': 1.0, 'Plastic scintillator (PVT)': 1.023,
    'Liquid scintillator (LAB)': 0.86, 'BGO': 7.13, 'LaBr₃': 5.08, 'CdTe': 5.85, 'Lead': 11.35, 'Acrylic (PMMA)': 1.19 };
  function smear(E0, w, x, bin, out) {   // add a resolution-smeared line (per keV) at E0 with weight w to out on grid x
    var f = num('#g-fwhm', 0), sg = f ? f / 2.3548 * Math.sqrt(Math.max(E0, 1) / 662) : 0;
    if (!(sg > bin)) { var k = Math.floor(E0 / bin); if (k >= 0 && k < out.length) out[k] += w / bin; return; }
    for (var i = Math.max(0, Math.floor((E0 - 5 * sg) / bin)); i < Math.min(out.length, Math.ceil((E0 + 5 * sg) / bin)); i++) out[i] += w * Math.exp(-0.5 * Math.pow((x[i] - E0) / sg, 2)) / (sg * Math.sqrt(2 * Math.PI));
  }
  function daughterZ(n) {
    var i = nucInfo(n), d = DEC[n]; if (!i) return null;
    if (/m$|m\d*$/.test(n.replace(/^\d+/, '')) || /^\d+m/.test(n)) return i.Z;   // isomer: IT
    return d && d.bm ? i.Z + 1 : d && d.bp ? i.Z - 1 : d && d.a ? i.Z - 2 : i.Z;
  }
  function multL(m) { var t = (m || '').replace(/[\[\]\(\)]/g, ''), q = /([EM])(\d)/.exec(t); return q ? { type: q[1], L: +q[2], mixed: /\+/.test(t) } : null; }
  function jpNum(j) { var q = /(\d+)(\/2)?/.exec((j || '').replace(/[()]/g, '')); return q ? (q[2] ? +q[1] / 2 : +q[1]) : null; }
  // conversion / Auger electrons and internal pair creation for the current lines
  function gExtras(out, lines, comp, bin, x) {
    if (srcVal('g-src') !== 'nuc') return;
    var n = normName($('#g-nuc').value), d = DEC[n]; if (!d) return;
    var all = $('#g-line').value === 'all';
    if ($('#g-ce').checked) {
      var el_ = [], src = '';
      if (d.e && d.e.length) { el_ = d.e.filter(function (e) { return all || /^CE/.test(e[2]); }).map(function (e) { return [e[0], e[1], (e[2] || '').replace(/^AU\b/, 'Auger').replace(/^CE\b/, 'Conversion')]; }); src = 'ENSDF conversion and Auger electron lines (IAEA LiveChart)'; }
      else {
        var Z = daughterZ(n), sym = Z ? SYMS[Z] : null, BK = sym && G.edges[sym] ? G.edges[sym] : 0;
        lines.forEach(function (l) { if (l[6] > 0 && l[2] != null) el_.push([l[0] - BK, l[1] * l[6], 'CE (all shells at E − B_K)']); });
        src = 'estimated from the total conversion coefficients α (ENSDF/BrIcc), all placed at E<sub>γ</sub> − B<sub>K</sub>' + (BK ? ' (B<sub>K</sub> = ' + fmt(BK, 4) + ' keV for ' + sym + ')' : '');
      }
      el_ = el_.filter(function (e) { return e[0] > 0 && e[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
      if (el_.length) {
        var tot = 0; el_.forEach(function (e) { tot += e[1] / 100; });
        var tab = el('table', 'sx-table'), hd = el('tr'); ['Electron', 'Energy (keV)', 'Per decay'].forEach(function (h) { hd.appendChild(el('th', null, h)); }); tab.appendChild(hd);
        el_.slice(0, 10).forEach(function (e) { var tr = el('tr'); [e[2] || 'CE', fmt(e[0], 5), fmt(e[1] / 100, 3)].forEach(function (v, i) { tr.appendChild(el('td', i ? 'num' : null, v)); }); tab.appendChild(tr); });
        out.appendChild(el('h3', null, 'Conversion and Auger electrons: ' + fmt(tot, 3) + ' per decay'));
        var p_ = el('p', 'sx-note'); p_.innerHTML = 'Source: ' + src + '. These electrons (and the X-rays and Auger electrons that follow the vacancy) deposit their energy where they are emitted, so in a source inside a calorimeter they appear as mono-energetic lines, and they add to any gamma emitted in the same cascade.'; out.appendChild(p_);
        out.appendChild(tab);
        // electron lines in the main plot data (for the CSV): store
        var y = new Float64Array(x.length); el_.forEach(function (e) { smear(e[0], e[1] / 100, x, bin, y); }); G.last.ce = y;
        var c = $('#g-plot'); if (c && G.lastPlot) {}
      }
    }
    if ($('#g-ipc').checked) {
      var rows = [];
      lines.forEach(function (l) { if (l[0] > 1022 && l[2] != null) { var m = multL(l[4]), r = m && m.L === 1 ? X.ipc(l[0], m.type + '1') : null; rows.push({ l: l, m: l[4] || '?', a: r ? r.alpha : null }); } });
      if (rows.length) {
        var t2 = el('table', 'sx-table'), h2 = el('tr'); ['Line (keV)', 'Multipolarity', 'IPC coefficient α<sub>π</sub>', 'Pairs per decay', 'e⁺ + e⁻ kinetic energy (keV)'].forEach(function (h) { var th = el('th'); th.innerHTML = h; h2.appendChild(th); }); t2.appendChild(h2);
        rows.slice(0, 10).forEach(function (q) { var tr = el('tr'); [fmt(q.l[0], 5), q.m, q.a == null ? 'not E1/M1' : fmt(q.a, 3), q.a == null ? '–' : fmt(q.a * q.l[1] / 100, 3), fmt(q.l[0] - 1022, 5)].forEach(function (v, i) { tr.appendChild(el('td', i ? 'num' : null, v)); }); t2.appendChild(tr); });
        out.appendChild(el('h3', null, 'Internal pair creation'));
        var p2 = el('p', 'sx-note'); p2.innerHTML = 'Instead of a gamma, the nucleus can emit an e⁺e⁻ pair directly (Born approximation, Goldring/Rose; E1 and M1 only, reliable for Z ≲ 40 and E ≳ 2.5 MeV; mixed transitions use their leading multipole). The pair deposits E − 1022 keV locally and the two 511 keV annihilation photons follow, so a calorimeter sees the full transition energy. The opening-angle distribution is what ATOMKI-type X17 searches look at.'; out.appendChild(p2);
        out.appendChild(t2);
      }
    }
  }
  // level-scheme cascades for the Monte Carlo: feeding of each level, branching, conversion
  function gCascades(n, lines) {
    var d = DEC[n], g = d && d.g ? d.g.filter(function (l) { return l[2] != null && l[3] != null; }) : [];
    var useCorr = $('#g-corr').checked, cas = [];
    if (srcVal('g-src') === 'nuc' && $('#g-line').value === 'all' && g.length) {
      var key = function (e) { return (Math.round(e * 10) / 10).toFixed(1); }, outOf = {}, into = {}, lv = {};
      g.forEach(function (l) { var a = l[6] || 0, w = l[1] * (1 + a), kf = key(l[2]), kt = key(l[3]); (outOf[kf] = outOf[kf] || []).push({ E: l[0], w: w, a: a, to: kt, m: l[4], dl: l[5], jf: l[7], jt: l[8] }); into[kt] = (into[kt] || 0) + w; lv[kf] = l[7]; lv[kt] = l[8]; });
      var starts = Object.keys(outOf).map(function (k) { var tot = outOf[k].reduce(function (s, b) { return s + b.w; }, 0); return { k: k, f: tot - (into[k] || 0) }; }).filter(function (s) { return s.f > 1e-6; });
      var count = 0;
      function walk(k, p, gam, local, steps) {
        if (count > 3000) return;
        var br = outOf[k]; if (!br || p < 1e-6) { if (gam.length || local) { cas.push({ w: p, gammas: gam.map(function (q) { return q.E; }), local: local, steps: steps }); count++; } return; }
        var tot = br.reduce(function (s, b) { return s + b.w; }, 0);
        br.forEach(function (b) {
          var pb = p * b.w / tot;
          walk(b.to, pb / (1 + b.a), gam.concat([b]), local, steps.concat([b]));
          if (b.a > 0) walk(b.to, pb * b.a / (1 + b.a), gam, local + b.E, steps.concat([b]));
        });
      }
      starts.forEach(function (s0) { walk(s0.k, s0.f / 100, [], 0, []); });
      cas.forEach(function (c) {   // angular correlation between the first two consecutive gammas of the cascade
        var st = c.steps; delete c.steps;
        if (!useCorr || st.length < 2 || c.gammas.length < 2 || c.gammas[0] !== st[0].E || c.gammas[1] !== st[1].E) return;
        var J1 = jpNum(st[0].jf), J = jpNum(st[0].jt), J2 = jpNum(st[1].jt), m1 = multL(st[0].m), m2 = multL(st[1].m);
        if (J1 == null || J == null || J2 == null || !m1 || !m2) return;
        var A = X.cascadeCorrelation(J1, J, J2, m1.L, m1.mixed ? (st[0].dl || 0) : 0, m2.L, m2.mixed ? (st[1].dl || 0) : 0);
        if (isFinite(A.A22) && isFinite(A.A44)) { c.A22 = A.A22; c.A44 = A.A44; }
      });
      var sw = cas.reduce(function (a, c) { return a + c.w; }, 0); if (sw < 1) cas.push({ w: 1 - sw, gammas: [] });
      var extras = d.x && $('#g-x').checked ? d.x.filter(function (x) { return x[0] > 10; }).map(function (x) { return { p: Math.min(1, x[1] / 100), E: x[0] }; }) : [];
      return { cas: cas, levels: true, extras: extras };
    }
    lines.forEach(function (l) { cas.push({ w: l[1] / 100, gammas: [l[0]] }); });
    return { cas: cas, levels: false };
  }
  function gMC(out, lines, comp) {
    var wrap = $('#g-plot2-wrap'); wrap.hidden = !$('#g-mc').checked; if (!$('#g-mc').checked) return;
    var n = normName($('#g-nuc').value), C_ = gCascades(n, lines), Emax = 0;
    C_.cas.forEach(function (c) { var s = c.gammas.reduce(function (a, b) { return a + b; }, 0) + (c.local || 0); if (s > Emax) Emax = s; });
    if (!Emax) return;
    var o = { xcom: G.xcom, comp: comp, rho: num('#g-rho', 3.67), R: num('#g-R', 3.81), H: $('#g-geo').value === 'sphere' ? null : num('#g-H', 7.62) / 2, geometry: $('#g-geo').value, Emax: Emax, bins: 1200,
      events: Math.max(1000, Math.min(400000, num('#g-n', 20000) | 0)), edges: G.edges, Zof: G.Zof, source: $('#g-pos').value === 'center' ? 'point' : $('#g-pos').value, dist: num('#g-dist', 1), cascades: C_.cas, extras: C_.extras || [] };
    var r = X.photonMC(o), y = new Float64Array(r.y.length), x = r.x;
    for (var i = 0; i < r.y.length; i++) if (r.y[i]) smear(x[i], r.y[i] * r.bin, x, r.bin, y);
    var ser = [{ name: 'Monte Carlo: energy deposited per decay', x: x, y: y, color: css('--ink'), width: 1.6 }];
    var lg = $('#g-log').checked, marks = [];
    // full-energy and sum peaks
    function area(E) { var s = 0, f = num('#g-fwhm', 0), hw = Math.max(2 * r.bin, f ? f * Math.sqrt(E / 662) : 2 * r.bin); for (var k = 0; k < r.y.length; k++) if (Math.abs(x[k] - E) <= hw) s += r.y[k] * r.bin; return s; }
    var totDep = 0; for (i = 0; i < r.y.length; i++) totDep += r.y[i] * r.bin;
    var rows = lines.filter(function (l) { return l[2] != null || srcVal('g-src') === 'e'; }).slice(0, 6).map(function (l) { var a = area(l[0]); return [fmt(l[0], 5), fmt(a, 3), fmt(a / (l[1] / 100), 3)]; });
    var sums = {};
    C_.cas.forEach(function (c) { if (c.gammas.length > 1) { var s = Math.round(c.gammas.reduce(function (a, b) { return a + b; }, 0) * 10) / 10; sums[s] = (sums[s] || 0) + c.w; } });
    var sk = Object.keys(sums).sort(function (a, b) { return sums[b] - sums[a]; }).slice(0, 3);
    sk.forEach(function (s, k) { marks.push({ x: +s, label: 'sum ' + fmt(+s, 5), row: k }); });
    plot($('#g-plot2'), { series: ser, xlab: 'Energy deposited (keV)', xname: 'E', ylab: 'Probability per keV per decay', log: lg, legend: $('#g-legend2'), marks: marks, ymin: lg ? Math.max(1e-9, max(y) * 1e-5) : undefined });
    G.last.mc = { x: x, y: y };
    out.appendChild(el('h3', null, 'Detector Monte Carlo'));
    var geo = $('#g-geo').value === 'sphere' ? 'sphere of radius ' + o.R + ' cm' : 'cylinder ' + o.R * 2 + ' cm across × ' + o.H * 2 + ' cm tall';
    out.appendChild(el('p', null, fmt(r.events, 6) + ' decays in a ' + geo + ' of ' + GMAT[+$('#g-mat').value][0] + ' (ρ = ' + o.rho + ' g/cm³), source ' + ({ point: 'at the centre', volume: 'spread through the volume', external: 'on the axis ' + o.dist + ' cm from the face' })[o.source] + '. Something is deposited in ' + pc(totDep) + ' of decays. ' +
      (C_.levels ? C_.cas.length + ' cascade paths from the level scheme' + ($('#g-corr').checked ? ', with γ–γ angular correlations from the level spins and multipolarities' : '') + '; conversion electrons are absorbed at the source (internal sources only); X-rays of the daughter are emitted independently with their per-decay probabilities.' : 'Each line on its own (no level information for this choice, so no summing).') +
      (sk.length ? ' Strongest sum peaks: ' + sk.map(function (s) { return fmt(+s, 5) + ' keV (' + fmt(sums[s], 3) + ' cascades per decay, ' + fmt(area(+s), 3) + ' counts per decay in the peak)'; }).join('; ') + '.' : '')));
    if (rows.length) {
      var t = el('table', 'sx-table'), h = el('tr'); ['Line (keV)', 'Full-energy peak per decay', 'Peak efficiency (per emitted gamma)'].forEach(function (q) { h.appendChild(el('th', null, q)); }); t.appendChild(h);
      rows.forEach(function (rr) { var tr = el('tr'); rr.forEach(function (v, i) { tr.appendChild(el('td', i ? 'num' : null, v)); }); t.appendChild(tr); }); out.appendChild(t);
      out.appendChild(el('p', 'sx-note', 'Peak areas within ±1 FWHM (or ±2 bins); neighbouring lines inside that window are counted too. Summing removes counts from the single-line peaks (summing-out) and builds sum peaks (summing-in); both grow as the source gets closer. Photon transport: photoelectric (with K X-ray escape), Klein–Nishina Compton and pair production (annihilation photons tracked); electrons deposit locally (no bremsstrahlung or edge leakage); coherent scattering ignored. Beta particles and X-rays from the atomic shell of the parent are not coincident here.'));
    }
  }
  function gDoppler(out, comp) {
    var wrap = $('#g-plot3-wrap'); wrap.hidden = !$('#g-dop').checked; if (!$('#g-dop').checked) return;
    var Eg = num('#g-dE', 477.6), Tr = num('#g-dT', 840), M = num('#g-dM', 7), tau = num('#g-dtau', 105), ts = num('#g-dstop', 300);
    var r = X.dopplerLine(Eg, Tr, M, tau, ts, { bins: 400 }), bin = r.E[1] - r.E[0];
    var f = num('#g-fwhm', 0), sg = f / 2.3548 * Math.sqrt(Eg / 662), span = Math.max(r.E[r.E.length - 1] - Eg, 0) + 4 * sg, nb = Math.ceil(2 * span / bin) + 1, gx = new Float64Array(nb), y = new Float64Array(nb);
    for (var i = 0; i < nb; i++) gx[i] = Eg - span + i * bin;
    for (i = 0; i < r.E.length; i++) { var k = Math.round((r.E[i] - gx[0]) / bin); if (k >= 0 && k < nb) { if (f > 0) smear(r.E[i], r.y[i] * bin, gx, bin, y); else y[k] += r.y[i]; } }
    var ser = [{ name: 'Emitted line shape (the spike is the fraction emitted at rest)', x: r.E, y: r.y, color: color(0) }];
    if (f > 0) ser.push({ name: 'With detector resolution (' + fmt(f * Math.sqrt(Eg / 662), 3) + ' keV FWHM here)', x: gx, y: y, color: css('--ink'), width: 1.6 });
    plot($('#g-plot3'), { series: ser, xlab: 'Gamma energy (keV)', xname: 'E', ylab: 'Probability per keV', height: 240, legend: $('#g-legend3') });
    var half = Eg * r.beta0;
    out.appendChild(el('h3', null, 'Doppler-broadened line'));
    out.appendChild(el('p', null, fmt(Eg, 5) + ' keV from an emitter of ' + M + ' u recoiling with ' + fmt(Tr, 4) + ' keV (β = ' + fmt(r.beta0, 3) + ', full width up to ±' + fmt(half, 3) + ' keV). With τ = ' + tau + ' fs and a stopping time of ' + ts + ' fs, ' + pc(r.inflight) + ' of the photons are emitted in flight and the rest at rest. Constant deceleration and isotropic emission give a flat box of half-width E<sub>γ</sub>β(t) at each instant.'));
    out.lastChild.innerHTML = out.lastChild.textContent.replace('E<sub>γ</sub>β(t)', 'E<sub>γ</sub>β(t)');
  }
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
      fillList('#a-nuc-list', names('a'));
      ['#a-nuc', '#a-levels', '#a-tp', '#a-fwhm', '#a-rfwhm', '#a-log', '#a-geo', '#a-rho', '#a-d', '#a-qm', '#a-noble', '#a-qfa', '#a-kb', '#a-cal', '#a-gesc'].forEach(function (id) { $(id).addEventListener('change', id === '#a-nuc' ? aNuc : RUN.alpha); });
      NMAT.forEach(function (m, i) { if (!m[1]) return; var o = el('option', null, m[0]); o.value = i; $('#a-mat').appendChild(o); });
      $('#a-mat').addEventListener('change', function () { var d = MATRHO[NMAT[+this.value][0]]; if (d) $('#a-rho').value = d; RUN.alpha(); });
      $('#a-noble').addEventListener('change', function () { $('#a-qfa').value = this.value === 'Ar' ? 0.71 : 1.0; RUN.alpha(); });
      $('#a-q').addEventListener('change', RUN.alpha);
      $('#a-nuc').addEventListener('input', function () { if (nucInfo(normName(this.value))) aNuc(); });
      $('#a-csv').addEventListener('click', aCSV);
      aNuc();
    }).catch(fail('#a-out'));
  };
  function aNuc() { withDec(normName($('#a-nuc').value), aNuc2); }
  function aNuc2() {
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
    alphaDetector(n, lines, fw, lg);
  };
  var MATRHO = { 'Acrylic (PMMA)': 1.19, 'PTFE (Teflon)': 2.2, 'Water': 1.0, 'Fused silica (SiO₂)': 2.2, 'Borosilicate glass': 2.23, 'Stainless steel 304': 8.0, 'Copper': 8.96, 'Titanium': 4.51,
    'Aluminium': 2.70, 'Liquid argon (natural)': 1.396, 'Beryllium': 1.85, 'Beryllium oxide': 3.01, 'Boron (natural)': 2.34, 'Silicon': 2.33, 'Magnesium': 1.74, 'Calcium fluoride': 3.18, 'Kapton': 1.42,
    'Standard rock / concrete': 2.3 };
  // depth-degraded spectrum, quenching and calorimetric summing (signals-extra.js)
  function alphaDetector(n, lines, fw, lg) {
    var geo = $('#a-geo').value, qm = $('#a-qm').value, cal = $('#a-cal').checked;
    $('#a-geo-wrap').hidden = geo === 'free'; $('#a-d-wrap').hidden = geo === 'bulk'; $('#a-noble-wrap').hidden = qm !== 'noble'; $('#a-kb-wrap').hidden = qm !== 'birks'; $('#a-gesc-wrap').hidden = !cal;
    var wrap = $('#a-plot3-wrap');
    if (geo === 'free' && qm === 'none' && !cal) { wrap.hidden = true; return; }
    load('data/signals/alpha_stopping.json').then(function (ST) {
      wrap.hidden = false;
      var mi = +$('#a-mat').value || 0, comp = NMAT[mi][1], els = Object.keys(comp).filter(function (s) { return ST[s]; }), wS = els.reduce(function (s, k) { return s + comp[k]; }, 0);
      var stop = function (Ek) { var s = 0; els.forEach(function (k) { s += comp[k] * P.stoppingAt(ST[k], Ek / 1000); }); return s / (wS || 1) * 1000; };   // keV per g/cm2
      var rho = num('#a-rho', 1), z = num('#a-d', 0) * 1e-4 * rho, Emax = Math.max.apply(null, lines.map(function (l) { return l.TaHi; })) * 1.03, nb = 1200, bin = Emax / nb;
      var raw = new Float64Array(nb), esc = 0, notes = [];
      // 1) energy of the alphas that leave the material (or all of them for a thin source)
      lines.forEach(function (l) {
        if (geo === 'free') { raw[Math.min(nb - 1, Math.floor((l.TaLo + l.TaHi) / 2 / bin))] += l.I / bin; esc += l.I; return; }
        var R0 = X.rangeTable(stop, l.Ta * 1.02).range(l.Ta), z0 = geo === 'depth' ? z : 0, z1 = geo === 'surf' ? z : geo === 'bulk' ? R0 : z;
        var d = X.depthSpectrum(l.Ta, stop, z0, z1, { bins: 300 });
        esc += l.I * d.escaped;
        for (var k = 0; k < d.E.length; k++) if (d.y[k]) raw[Math.min(nb - 1, Math.floor(d.E[k] / bin))] += l.I * d.y[k] * (d.E[1] - d.E[0]) / bin;
      });
      // 2) visible energy: quenched alpha (+ quenched recoil + daughter de-excitation if the decay is inside the detector)
      var med = $('#a-noble').value, Zm = med === 'Ar' ? 18 : 54, Am = med === 'Ar' ? 40 : 131, qfa = num('#a-qfa', 1), kB = num('#a-kb', 0.01) / 1000 * rho;   // cm/MeV -> (g/cm2)/keV
      function visA(E) { return qm === 'noble' ? qfa * E : qm === 'birks' ? X.birksVisible(E, stop, kB) : E; }
      function visR(E) { return qm === 'none' ? E : E * X.lindhard(E, Zm, Am); }
      var vis = new Float64Array(nb), gesc = Math.min(1, Math.max(0, num('#a-gesc', 0.5))), Vmax = 0;
      var tab = [];
      for (var k = 0; k < nb; k++) { var E = (k + 0.5) * bin; tab.push(visA(E)); }
      function addVis(V, w) { if (w <= 0) return; var kk = Math.min(nb - 1, Math.max(0, Math.floor(V / bin))); vis[kk] += w / bin; }
      if (cal) {
        var dg = (DEC[n] && DEC[n].g || []).filter(function (g) { return g[2] != null; }), haveA = dg.some(function (g) { return g[6] != null; });
        function fGamma(Ex) {   // photon share of the de-excitation of level Ex: sum I / sum I (1 + alpha) of the gammas leaving it
          var a = 0, b = 0; dg.forEach(function (g) { if (Math.abs(g[2] - Ex) < Math.max(1, 1e-3 * Ex)) { a += g[1]; b += g[1] * (1 + (g[6] || 0)); } }); return b > 0 ? a / b : 1;
        }
        lines.forEach(function (l) { var V = visA(l.Ta) + visR(l.Tr), Ex = l.Ex || 0; addVis(V + Ex * (1 - gesc * (Ex > 0 ? fGamma(Ex) : 0)), l.I); });
        notes.push('Each decay deposits the alpha, the recoiling ' + pretty(daughterName(n, -2, -4) || 'daughter') + ' and the daughter level energy E<sub>x</sub>, of which a fraction ' + fmt(gesc, 3) + ' escapes as gamma radiation (conversion electrons and X-rays are assumed absorbed; ' + (haveA ? 'the photon share of each level\'s de-excitation, Σ I<sub>γ</sub> / Σ I<sub>γ</sub>(1+α), comes from the ENSDF conversion coefficients of the gammas leaving it, so highly converted levels (low-energy E2/M1 transitions in heavy nuclei) deposit nearly all of E<sub>x</sub>' : 'no conversion coefficients for this nuclide, so every level is treated as decaying by gamma emission') + ').');
      } else for (k = 0; k < nb; k++) if (raw[k]) addVis(tab[k], raw[k] * bin);
      function smear(y, fwhm) {
        var s = fwhm / 2.3548; if (!(s > bin / 2)) return y; var o = new Float64Array(nb), r = Math.ceil(5 * s / bin), g = [];
        for (var j = -r; j <= r; j++) g.push(Math.exp(-0.5 * Math.pow(j * bin / s, 2)));
        var gs = g.reduce(function (a, b) { return a + b; }, 0);
        for (var i = 0; i < nb; i++) if (y[i]) for (j = -r; j <= r; j++) { var q = i + j; if (q >= 0 && q < nb) o[q] += y[i] * g[j + r] / gs; }
        return o;
      }
      var x = []; for (k = 0; k < nb; k++) x.push((k + 0.5) * bin);
      var ser = [];
      if (geo !== 'free') ser.push({ name: 'Alphas leaving the surface (deposited energy)', x: x, y: smear(raw, fw), color: color(0) });
      if (qm !== 'none' || cal) ser.push({ name: cal ? 'Visible energy, decay inside the detector (keVee)' : 'Visible energy of the escaping alphas (keVee)', x: x, y: smear(vis, fw), color: color(2) });
      plot($('#a-plot3'), { series: ser, xlab: 'Energy (keV or keVee)', xname: 'E', ylab: 'Per keV per decay', log: lg || ser.length > 1, legend: $('#a-legend3'), ymin: lg || ser.length > 1 ? 1e-7 : undefined });
      if (geo !== 'free') notes.unshift(fmt(esc * 100, 3) + '% of decays send an alpha out of the surface' + (geo === 'bulk' ? ' (per decay within one alpha range of the surface; range of the most intense line ' + fmt(X.rangeTable(stop, lines[0].Ta * 1.02).range(lines[0].Ta) / rho * 1e4, 3) + ' µm)' : '') + '. Material: ' + NMAT[mi][0] + ', ρ = ' + fmt(rho, 3) + ' g/cm³' + (geo !== 'bulk' ? ', d = ' + fmt(num('#a-d', 0), 4) + ' µm (' + fmt(z * 1000, 4) + ' mg/cm²)' : '') + '.');
      if (qm === 'noble') notes.push('Alphas quenched by ' + fmt(qfa, 3) + '; recoils by Lindhard in ' + (med === 'Ar' ? 'argon' : 'xenon') + ' (e.g. ' + fmt(X.lindhard(100, Zm, Am), 3) + ' at 100 keV).');
      if (qm === 'birks') notes.push('Birks: L = ∫ dE / (1 + kB dE/dx) with the stopping power of ' + NMAT[mi][0] + ' (e.g. a ' + fmt(lines[0].Ta, 5) + ' keV alpha gives ' + fmt(visA(lines[0].Ta), 4) + ' keVee).');
      $('#a-det-note').innerHTML = notes.join(' ');
    });
  }
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
      fillList('#a-nuc-list', names('a'));
      ['#n-mat', '#n-custom', '#n-e', '#n-nuc', '#n-chain', '#n-areal', '#n-nparts', '#n-log', '#n-ld', '#n-lrho', '#n-back', '#n-sf', '#n-cmp-t'].forEach(function (id) { $(id).addEventListener('change', RUN.an); });
      NMAT.forEach(function (m, i) { if (!m[1]) return; var o = el('option', null, m[0]); o.value = i; $('#n-back').appendChild(o); });
      $('#n-back').value = String(NMAT.map(function (m) { return m[0]; }).indexOf('Copper'));
      Object.keys(N.index).sort(byA).forEach(function (k) { var o = el('option', null, pretty(k)); o.value = k; $('#n-cmp-t').appendChild(o); });
      $('#n-cmp-file').addEventListener('change', function () { var f = this.files && this.files[0]; if (!f) return; f.text().then(function (t) { N.cmp = X.parseXY(t); N.cmpName = f.name; RUN.an(); }); });
      $('#n-mat').addEventListener('change', function () { var d = MATRHO[NMAT[+this.value][0]]; if (d) $('#n-lrho').value = d; });
      document.querySelectorAll('input[name=n-src],input[name=n-thick]').forEach(function (rr) { rr.addEventListener('change', RUN.an); });
      $('#n-csv').addEventListener('click', nCSV); $('#n-pcsv').addEventListener('click', nPCSV); $('#n-gcsv').addEventListener('click', nGCSV);
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
    var comp = custom ? parseComp($('#n-custom').value) : NMAT[mi][1], src = srcVal('n-src'), mode = srcVal('n-thick'), thin = mode === 'thin', layer = mode === 'layer';
    $('#n-e-wrap').hidden = src !== 'e'; $('#n-nuc-wrap').hidden = src !== 'nuc'; $('#n-chain-wrap').hidden = src !== 'chain'; $('#n-areal-wrap').hidden = !thin; $('#n-layer-wrap').hidden = !layer;
    var out = $('#n-out'); out.innerHTML = '';
    // alphas
    var alphas = [], srcLabel = '';
    if (src === 'e') { alphas = [[num('#n-e', 5.3), 1]]; srcLabel = fmt(alphas[0][0], 4) + ' MeV alphas'; }
    else if (src === 'nuc') {
      var n = normName($('#n-nuc').value), d = DEC[n];
      if (has(n, 'a') && !d) { withDec(n, RUN.an); return; }
      if (d && d.a) { var t = 0; d.a.forEach(function (a) { t += a[1]; }); alphas = d.a.map(function (a) { return [a[0] / 1000, a[1] / 100]; }); srcLabel = pretty(n) + ' alphas (per decay)'; }
    } else {
      var ch = N.chains.filter(function (c) { return c.id === $('#n-chain').value; })[0];
      if (ch) ch.members.forEach(function (m) { (m.alphas || []).forEach(function (a) { if (m.af > 0) alphas.push([a[0] / 1000, a[1] / 100 * m.af]); }); });
      srcLabel = ch ? ch.title.replace(/<[^>]+>/g, '') + ' in equilibrium (per decay of the chain parent)' : '';
    }
    alphas = alphas.filter(function (a) { return a[0] > 0 && a[1] > 0; });
    if (thin && src !== 'e') { out.appendChild(el('p', 'sx-note', 'A thin target uses one alpha energy: switch the source to Energy.')); }
    if (!alphas.length) { plot($('#n-plot'), { series: [], empty: 'No alphas for this source.' }); return; }
    // targets of the main material (and of the backing for a layer)
    var A_ = anMaterial(comp), missing = A_.missing, stopping = A_.stopping;
    var bcomp = NMAT[+$('#n-back').value][1], B_ = layer ? anMaterial(bcomp) : null;
    $('#n-status').textContent = 'Loading cross sections…';
    Promise.all([A_.load(), B_ ? B_.load() : Promise.resolve([])]).then(function (TT) {
      var targets = TT[0], btargets = TT[1];
      $('#n-status').textContent = '';
      var Emax = Math.max.apply(null, alphas.map(function (a) { return a[0]; })) + Math.max.apply([0], targets.concat(btargets).map(function (t) { return t.data.Q_MeV; })) + 2;
      var EmaxS = Math.min(15, Math.max(4, Emax)), lists = null, r;
      if (layer) {
        lists = layerLists(alphas, stopping, B_.stopping, num('#n-ld', 10) * 1e-4 * num('#n-lrho', 1));
        var rA = P.alphaNSpectrum({ alphas: lists.A, targets: targets, stopping: stopping, dE: 0.05, Emax: EmaxS });
        var rB = P.alphaNSpectrum({ alphas: lists.B, targets: btargets.map(function (t) { return Object.assign({}, t, { label: t.label + ' [backing]' }); }), stopping: B_.stopping, dE: 0.05, Emax: EmaxS });
        r = mergeAN(rA, rB);
      } else r = P.alphaNSpectrum({ alphas: thin ? null : alphas, thin: thin ? { E: alphas[0][0], arealDensity: num('#n-areal', 1e-3) } : null, targets: targets, stopping: stopping, dE: 0.05, Emax: EmaxS });
      var np = Math.max(1, Math.min(30, num('#n-nparts', 8) | 0)), lg = $('#n-log').checked, sumParts = new Float64Array(r.E.length);
      r.partial.forEach(function (p) { for (var i = 0; i < r.E.length; i++) sumParts[i] += p.values[i]; });
      var series = [{ name: 'Total: sum of final states (lab two-body kinematics)', x: r.E, y: sumParts, color: css('--ink'), width: 1.8 }, { name: 'TALYS neutron spectra as integrated by NeuCBOT', x: r.E, y: r.total, color: css('--muted'), dash: [5, 4], width: 1.4 }];
      r.partial.forEach(function (p) { p.label = pretty(p.label); });
      r.partial.slice(0, np).forEach(function (p, k) { series.push({ name: p.label, x: r.E, y: p.values, color: color(k), width: 1.4 }); });
      var unit = thin ? 'neutrons per MeV per alpha' : 'neutrons per MeV per ' + (src === 'e' ? 'alpha' : 'decay');
      // spontaneous fission of the emitter / chain members (per decay of the parent)
      var sf = $('#n-sf').checked && src !== 'e' ? sfSources(src) : [], sfY = 0, sfSpec = new Float64Array(r.E.length);
      sf.forEach(function (q) {
        var tot = 0, tmp = []; for (var i = 0; i < r.E.length; i++) { var v = X.watt(r.E[i], q.a, q.b); tmp.push(v); tot += v * (r.E[1] - r.E[0]); }
        for (i = 0; i < r.E.length; i++) sfSpec[i] += q.y * tmp[i] / (tot || 1);
        sfY += q.y;
      });
      if (sfY > 0) {
        series.splice(1, 0, { name: 'Spontaneous fission (Watt spectrum)', x: r.E, y: sfSpec, color: color(7), width: 1.6, dash: [2, 3] });
        series.unshift({ name: '(α,n) + spontaneous fission', x: r.E, y: Array.prototype.map.call(sumParts, function (v, i) { return v + sfSpec[i]; }), color: color(3), width: 2 });
      }
      plot($('#n-plot'), { series: series, xlab: 'Neutron energy (MeV)', xname: 'Eₙ', ylab: unit, log: lg, legend: $('#n-legend'), ymin: lg ? max(sumParts) * 1e-5 : undefined });
      N.last = { r: r, sumParts: sumParts, unit: unit, comp: comp, X0: 40.55, src: srcLabel, thin: thin, sf: sfSpec, sfY: sfY };
      out.appendChild(el('h3', null, 'Neutron yield: ' + fmt(r.yield, 3) + ' ' + unit.replace(' per MeV', '') + ' from (α,n)' + (sfY > 0 ? ' + ' + fmt(sfY, 3) + ' from spontaneous fission = ' + fmt(r.yield + sfY, 3) : '')));
      if (sfY > 0) out.appendChild(el('p', 'sx-note', 'Spontaneous fission: ' + sf.map(function (q) { return pretty(q.n) + ' (branch ' + fmt(q.br, 3) + ', ν̄ = ' + q.nu + ' neutrons per fission' + (q.af !== 1 ? ', ' + fmt(q.af, 3) + ' decays per parent decay' : '') + '; Watt a = ' + q.a + ' MeV, b = ' + q.b + ' /MeV, mean ' + fmt(X.wattMean(q.a, q.b), 3) + ' MeV)'; }).join('; ') + '. Neutrons come in bursts: P(ν) from Terrell\'s Gaussian (σ ≈ ' + (sf.some(function (q) { return q.n === '252Cf'; }) ? '1.21' : '1.08') + '): ' + terrell(sf[0].nu, sf[0].n === '252Cf' ? 1.21 : 1.08).map(function (p, k) { return 'P(' + k + ') = ' + fmt(p, 2); }).join(', ') + '. Sources: Watt parameters from SOURCES-4A/MCNP (Geant4 G4WattFissionSpectrumValues), branching ratios and multiplicities from JEFF-3.2 via Carvalho et al. (arXiv:1504.05475) and the ENSDF decay modes.'));
      if (layer) out.appendChild(el('p', 'sx-note', 'Layer: ' + fmt(lists.fracB * 100, 3) + '% of alphas reach the backing (' + NMAT[+$('#n-back').value][0] + ') and ' + fmt(lists.fracOut * 100, 3) + '% leave through the free surface. Yield in the layer ' + fmt(r.yieldA, 3) + ', in the backing ' + fmt(r.yieldB, 3) + ' ' + unit.replace(' per MeV', '') + '.'));
      anOther(out, series, r, targets, btargets, lists, alphas, thin, stopping, B_, unit, EmaxS, lg);
      anChannels(out, targets, btargets, lists, alphas, thin, stopping, B_, unit, r.yield + 0);
      anCompare(targets, alphas, thin, stopping, r);
      var notes = [srcLabel + ' in ' + (custom ? 'custom material' : NMAT[mi][0]) + (thin ? ', thin target of ' + fmt(num('#n-areal', 1e-3), 3) + ' g/cm²' : ', thick target (alphas stop in the material)') + '.'];
      if (missing.length) notes.push('No (α,n) data for ' + missing.join(', ') + ' (not in the NeuCBOT/TALYS set, or no isotope with an open channel); they still slow the alphas down if a stopping table exists.');
      var noStop = Object.keys(comp).filter(function (s) { return !N.stop[s]; }); if (noStop.length) notes.push('No stopping-power table for ' + noStop.join(', ') + ': the others are renormalised.');
      out.appendChild(el('p', 'sx-note', notes.join(' ')));
      var tab = el('table', 'sx-table'), hd = el('tr');
      ['Target → residual (final state)', 'Yield', 'Share', 'Eₙ range at the top alpha energy (MeV)'].forEach(function (h) { hd.appendChild(el('th', null, h)); }); tab.appendChild(hd);
      var Etop = Math.max.apply(null, alphas.map(function (a) { return a[0]; }));
      r.partial.slice(0, 25).forEach(function (p) {
        var t = targets.concat(btargets).filter(function (x) { return x.key === p.target; })[0], d = t.data, ma = 4.002603, mn = 1.00866492, mR = d.mass_u + ma - mn - d.Q_MeV / 931.494;
        var k = P.anKinematics(Etop, d.Q_MeV, p.Ex / 1000, ma, d.mass_u, mn, mR);
        var tr = el('tr'); [p.label, fmt(p.sum, 3), pc(p.sum / (r.yield || 1)), k ? fmt(k.Emin, 3) + ' – ' + fmt(k.Emax, 3) : 'closed'].forEach(function (v, i) { tr.appendChild(el('td', i ? 'num' : null, v)); }); tab.appendChild(tr);
      });
      out.appendChild(tab);
      var per = el('p'); per.textContent = 'By target: ' + Object.keys(r.perTarget).filter(function (k) { return r.perTarget[k] > 0; }).sort(function (a, b) { return r.perTarget[b] - r.perTarget[a]; }).map(function (k) { return pretty(k) + ' ' + pc(r.perTarget[k] / (r.yield || 1)); }).join(', ') + '.'; out.appendChild(per);
      out.appendChild(formulaBox([
        ['Neutron energy (two-body, non-relativistic)', 'E<sub>n</sub>(θ) = [ √(m<sub>α</sub>m<sub>n</sub>E<sub>α</sub>) cos θ ± √( m<sub>α</sub>m<sub>n</sub>E<sub>α</sub>cos²θ + (m<sub>R</sub>+m<sub>n</sub>)(m<sub>R</sub>Q′ + (m<sub>R</sub>−m<sub>α</sub>)E<sub>α</sub>) ) ]² / (m<sub>R</sub>+m<sub>n</sub>)²,&nbsp; Q′ = Q − E<sub>x</sub>'],
        ['Isotropic emission in the CM frame', 'E<sub>n</sub> is uniformly distributed between (√E* ∓ √E<sub>V</sub>)², with E* = m<sub>R</sub>(E<sub>cm</sub> + Q′)/(m<sub>n</sub>+m<sub>R</sub>), E<sub>cm</sub> = E<sub>α</sub>m<sub>T</sub>/(m<sub>α</sub>+m<sub>T</sub>), E<sub>V</sub> = m<sub>n</sub>m<sub>α</sub>E<sub>α</sub>/(m<sub>α</sub>+m<sub>T</sub>)²'],
        ['Thick-target spectrum (NeuCBOT)', 'dY/dE<sub>n</sub> = Σ<sub>i</sub> n<sub>i</sub> Σ<sub>L</sub> ∫<sub>0</sub><sup>E<sub>0</sub></sup> σ<sub>i,L</sub>(E) f<sub>i,L</sub>(E<sub>n</sub>; E) / S(E) dE,&nbsp; n<sub>i</sub>: atoms of isotope i per gram, S: mass stopping power (Bragg additivity of SRIM tables)']]));
      out.appendChild(el('p', 'sx-note', 'Total and final states: TALYS-1.95 cross sections to each level of the residual nucleus (from the gamma cascade of each level; feeding through the continuum is attributed to the level it ends in, and the ground state gets the remainder), integrated over the slowing-down alpha as in NeuCBOT, with the neutron energy from two-body kinematics and isotropic emission in the centre-of-mass frame. The dashed curve integrates the TALYS neutron spectra instead (the spectra NeuCBOT uses, renormalised to the same cross section). At a single alpha energy those spectra peak near E<sub>cm</sub> + Q − E<sub>x</sub> (the centre-of-mass channel energy, as in TALYS’s energies.f90, with a Gaussian of σ = 0.2 MeV × (ε/E<sub>cm</sub>)<sup>1.5</sup>, 0.2 MeV being NeuCBOT’s elwidth setting; TALYS’s own lab-frame options, recoil and labddx, were off) rather than spanning the lab kinematic range, which is why the two curves differ.'));
      out.lastChild.innerHTML = out.lastChild.textContent.replace('E<sub>cm</sub> + Q − E<sub>x</sub>', 'E<sub>cm</sub> + Q − E<sub>x</sub>');
    }).catch(function (e) { $('#n-status').textContent = ''; fail('#n-out')(e); });
  };
  function anMaterial(comp) {
    var need = [], missing = [], nAt = {};
    Object.keys(comp).forEach(function (sym) {
      var isos = isotopesOf(sym), M = isos.reduce(function (s, i) { return s + i.ab * i.mass; }, 0) || 1, any = false;
      isos.forEach(function (i) { if (N.index[i.name]) { need.push(i.name); nAt[i.name] = comp[sym] * i.ab * NA / M; any = true; } });
      if (!any && comp[sym] > 0) missing.push(sym);
    });
    var stopEls = Object.keys(comp).filter(function (s) { return N.stop[s]; }), wS = stopEls.reduce(function (s, k) { return s + comp[k]; }, 0);
    return { missing: missing, stopping: function (E) { var s = 0; stopEls.forEach(function (k) { s += comp[k] * P.stoppingAt(N.stop[k], E); }); return s / (wS || 1); },
      load: function () { return Promise.all(need.map(function (k) { return load('data/signals/alphan/' + k + '.json').then(function (d) { return { key: k, data: d, nAtomsPerGram: nAt[k], label: pretty(k) + '(α,n)' }; }); })); } };
  }
  // alphas emitted uniformly in a layer of mass thickness t (g/cm2) on a thick backing: weighted energy lists for
  // the layer (E0 minus the energy each alpha still has when it leaves) and for the backing (entry energies)
  function layerLists(alphas, sA, sB, t) {
    var A = [], Bm = {}, out = 0, toB = 0, nz = 30, nc = 40;
    alphas.forEach(function (a) {
      var E0 = a[0] * 1000, w = a[1], rt = X.rangeTable(function (Ek) { return sA(Ek / 1000) * 1000; }, E0 * 1.02), R0 = rt.range(E0);
      A.push([a[0], w]);
      for (var iz = 0; iz < nz; iz++) {
        var z = t * (iz + 0.5) / nz;                         // depth below the free surface
        for (var ic = 0; ic < nc; ic++) {
          var mu = (ic + 0.5) / nc, ww = w / nz / nc / 2;
          [[z / mu, false], [(t - z) / mu, true]].forEach(function (pr) {
            if (pr[0] >= R0) return;                         // stops in the layer
            var Ex = rt.energy(R0 - pr[0]) / 1000, key = (Math.round(Ex / 0.02) * 0.02).toFixed(2);
            A.push([Ex, -ww]);
            if (pr[1]) { Bm[key] = (Bm[key] || 0) + ww; toB += ww; } else out += ww;
          });
        }
      }
    });
    var tw = alphas.reduce(function (s, a) { return s + a[1]; }, 0) || 1;
    var Al = {}; A.forEach(function (x) { var k = x[1] > 0 ? 'p' + x[0] : (Math.round(x[0] / 0.02) * 0.02).toFixed(2); Al[k] = Al[k] || [x[1] > 0 ? x[0] : +k, 0]; Al[k][1] += x[1]; });
    return { A: Object.keys(Al).map(function (k) { return Al[k]; }).filter(function (x) { return x[0] > 0 && x[1] !== 0; }),
      B: Object.keys(Bm).map(function (k) { return [+k, Bm[k]]; }).filter(function (x) { return x[0] > 0; }), fracB: toB / tw, fracOut: out / tw };
  }
  function mergeAN(a, b) {
    var E = a.E, part = a.partial.concat(b.partial), total = new Float64Array(E.length), pt = {};
    for (var i = 0; i < E.length; i++) total[i] = a.total[i] + (b.total[i] || 0);
    Object.keys(a.perTarget).forEach(function (k) { pt[k] = a.perTarget[k]; }); Object.keys(b.perTarget).forEach(function (k) { pt[k + ' [backing]'] = b.perTarget[k]; });
    part.sort(function (x, y) { return y.sum - x.sum; });
    return { E: E, total: total, partial: part, perTarget: pt, yield: a.yield + b.yield, yieldA: a.yield, yieldB: b.yield };
  }
  // spontaneous fission: Watt parameters (MeV, 1/MeV), multiplicity, SF branch (used if ENSDF has none)
  var SFT = { '238U': { a: 0.6483, b: 6.811, nu: 2.01, br: 5.46e-7 }, '232Th': { a: 0.5934, b: 8.030, nu: 2.14, br: 1.40e-11 }, '240Pu': { a: 0.799, b: 4.903, nu: 2.16, br: 5.7e-8 },
    '244Cm': { a: 0.906, b: 3.848, nu: 2.72, br: 1.37e-6 }, '252Cf': { a: 1.025, b: 2.926, nu: 3.757, br: 0.03092 } };
  function sfSources(src) {
    var list = [];
    function add(n, af) { var q = SFT[n]; if (q) list.push({ n: n, a: q.a, b: q.b, nu: q.nu, br: q.br, af: af, y: af * q.br * q.nu }); }
    if (src === 'nuc') add(normName($('#n-nuc').value), 1);
    else { var ch = N.chains.filter(function (c) { return c.id === $('#n-chain').value; })[0]; if (ch) ch.members.forEach(function (m) { if (m.af > 0) add(m.nuc, m.af); }); }
    return list;
  }
  function terrell(nu, sig) {                // P(n) for n = 0..7 from Terrell's cumulative Gaussian
    var b = 0.0, out = [];
    function Phi(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
    for (var k = 0; k <= 7; k++) out.push(Math.max(0, Phi((k - nu + 0.5 + b) / sig) - (k ? Phi((k - 1 - nu + 0.5 + b) / sig) : 0)));
    return out;
  }
  // thick- or thin-target yield of any channel with cross sections arr (mb) on the 0.1 MeV grid
  function chanYield(arr, nAt, list, thin, stop) {
    function xs(E) { var x = E / 0.1 - 1, k = Math.floor(x); if (k < 0) return x > -1 ? arr[0] * (x + 1) : 0; if (k >= arr.length - 1) return arr[arr.length - 1]; return arr[k] + (arr[k + 1] - arr[k]) * (x - k); }
    var y = 0;
    if (thin) return nAt * xs(list[0][0]) * 1e-27 * num('#n-areal', 1e-3);
    var h = 0.01, Emx = Math.max.apply(null, list.map(function (a) { return a[0]; })), n = Math.ceil(Emx / h) + 1, cum = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) cum[i + 1] = cum[i] + xs((i + 0.5) * h) / stop((i + 0.5) * h) * h;
    list.forEach(function (a) { var x = a[0] / h, k = Math.min(n - 1, Math.floor(x)); y += a[1] * nAt * (cum[k] + (cum[k + 1] - cum[k]) * (x - k)) * 1e-27; });
    return y;
  }
  // prompt gammas from the (alpha,n) residual, and the (alpha,p) / (alpha,gamma) channels
  function anChannels(out, targets, btargets, lists, alphas, thin, stopA, B_, unit, ny) {
    var rows = [], other = {};
    function run(tgs, list, stop, tag) {
      tgs.forEach(function (t) {
        gammaList(t.data).forEach(function (g) {
          var y = chanYield(g.xs, t.nAtomsPerGram, list, thin, stop); if (!(y > 0)) return;
          rows.push({ t: t.key + tag, src: g.src, c: g.c, nuc: g.nuc || t.data.residual, ch: chanLabel(t.data, g.nuc || t.data.residual), Eg: g.Eg, from: g.from, to: g.to, y: y, pair: t.key === '13C' && (g.nuc || '16O') === '16O' && Math.abs(g.from - 6049) < 2 && g.to === 0 });
        });
        Object.keys(t.data.other || {}).forEach(function (ch) {
          var o = t.data.other[ch], y = chanYield(o.xs, t.nAtomsPerGram, list, thin, stop); if (!(y > 0)) return;
          var k = pretty(t.key) + ch.replace('a,g', 'α,γ').replace('a,p', 'α,p') + pretty(o.residual) + tag; other[k] = (other[k] || 0) + y;
        });
      });
    }
    var listA = lists ? lists.A : alphas;
    run(targets, listA, stopA, '');
    if (lists && B_) run(btargets, lists.B, B_.stopping, ' [backing]');
    rows.sort(function (a, b) { return b.y - a.y; });
    var u = unit.replace('neutrons per MeV ', '');
    if (rows.length) {
      out.appendChild(el('h3', null, 'Strongest prompt gamma lines'));
      var tab = el('table', 'sx-table'), hd = el('tr');
      ['Target → nucleus', 'E<sub>γ</sub> (keV)', 'Level (keV) → (keV)', 'Gammas ' + u, 'Per (α,n) neutron', 'Emitted with (same cascade)'].forEach(function (h) { var th = el('th'); th.innerHTML = h; hd.appendChild(th); }); tab.appendChild(hd);
      rows.slice(0, 16).forEach(function (q) { var tr = el('tr'); [pretty(q.t) + ' → ' + pretty(q.nuc) + ' ' + q.ch + (q.src ? ' ' + q.src : ''), fmt(q.Eg, 5) + (q.pair ? ' (e⁺e⁻ pair: 0⁺ → 0⁺ E0)' : ''), fmt(q.from, 5) + ' → ' + fmt(q.to, 5), fmt(q.y, 3), fmt(q.y / (ny || 1), 3), q.c && q.c.length ? q.c.slice(0, 4).map(function (p) { return fmt(p[0], 4) + ' keV (' + (p[1] >= 0.995 ? '100' : fmt(p[1] * 100, 2)) + '%)'; }).join(', ') : (q.src ? 'nothing above 2%' : '–')].forEach(function (v, i) { tr.appendChild(el('td', i ? 'num' : null, v)); }); tab.appendChild(tr); });
      out.appendChild(tab);
      out.appendChild(el('p', 'sx-note', 'Lines marked [E] come from following each level that TALYS-1.95 populates through the ENSDF adopted level scheme ([C]: the G4RiversideCASCADE level scheme; [E+C]: both), with evaluated branching ratios and conversion coefficients, exactly as the Gamma Line Explorer propagates capture cascades. Unmarked lines are TALYS\u2019s own cascade (RIPL branching), used when more than 5% of a nucleus\u2019s populated levels are missing from the evaluated schemes. All are integrated like the neutron yield. “Emitted with” is the probability that another line comes out in the same cascade (from the level scheme, with the level feeding averaged over alpha energies up to 10 MeV): such pairs give coincidences in segmented detectors and sum peaks in close geometries. Every line also comes with the reaction’s neutron or proton. These prompt gammas (or the e⁺e⁻ pair from the ¹⁶O 6.049 MeV 0⁺ state) accompany the neutron and let a veto tag (α,n) events.'));
    }
    // other channels are listed in the yields table (anOther)
  }
  // gamma lines of a target: for each residual whose populated levels are covered by an evaluated level scheme
  // (ENSDF adopted gammas, else G4RiversideCASCADE), the exact cascade from the TALYS level feeding; otherwise TALYS's own lines
  function gammaList(d) {
    var c = d.cascade || {}, useC = {}, out = [];
    Object.keys(c).forEach(function (n) { if (c[n].lines.length && c[n].unmatched <= 0.05) useC[n] = c[n]; });
    (d.gammas || []).forEach(function (g) { var n = g.nuc || d.residual; if (!useC[n]) out.push(Object.assign({ src: '' }, g, { nuc: n })); });
    Object.keys(useC).forEach(function (n) { var tag = /CASCADE/.test(useC[n].src) && !/ENSDF/.test(useC[n].src) ? '[C]' : /CASCADE/.test(useC[n].src) ? '[E+C]' : '[E]';
      useC[n].lines.forEach(function (g) { out.push({ nuc: n, Eg: g.Eg, from: g.from, to: g.to, xs: g.xs, src: tag, c: g.c, chan: useC[n].channel }); }); });
    return out;
  }
  // name a channel from the residual: emitted nucleons = compound (Z+2, A+4) minus residual
  function chanLabel(d, res) {
    var m = /^(\d+)([A-Za-z]+)$/.exec(res || ''); if (!m) return '';
    var Ar = +m[1], Zr = SYMS.indexOf(m[2]), np = d.Z + 2 - Zr, nn = d.A + 4 - Ar - np, parts = [];
    if (np === 0 && nn === 0) return '(α,γ)';
    if (np === 2 && nn === 2) return '(α,α′)';
    if (np >= 2 && nn >= 2) { parts.push('α'); np -= 2; nn -= 2; }
    if (nn > 0) parts.push((nn > 1 ? nn : '') + 'n'); if (np > 0) parts.push((np > 1 ? np : '') + 'p');
    return '(α,' + parts.join('') + ')';
  }
  // (alpha,p) protons, all prompt gammas, multi-neutron emission and the yields of every channel
  function anOther(out, series, r, targets, btargets, lists, alphas, thin, stopA, B_, unit, EmaxS, lg) {
    var listA = lists ? lists.A : alphas, u = unit.replace('neutrons per MeV ', '');
    function runSpec(make, Emax, dE) {       // run alphaNSpectrum over layer + backing (or one material) with targets built by make(t)
      var tA = targets.map(make).filter(Boolean), tB = (btargets || []).map(make).filter(Boolean);
      var base = { dE: dE, Emax: Emax, rawTalys: !!runSpec.raw };
      if (lists) { var a = P.alphaNSpectrum(Object.assign({ alphas: lists.A, targets: tA, stopping: stopA }, base)); if (!tB.length) return a; var b = P.alphaNSpectrum(Object.assign({ alphas: lists.B, targets: tB.map(function (t) { return Object.assign({}, t, { label: t.label + ' [backing]', partLabel: (t.partLabel || t.label) + ' [backing]' }); }), stopping: B_.stopping }, base)); return mergeAN(a, b); }
      return P.alphaNSpectrum(Object.assign({ alphas: thin ? null : alphas, thin: thin ? { E: alphas[0][0], arealDensity: num('#n-areal', 1e-3) } : null, targets: tA, stopping: stopA }, base));
    }
    // 1. all neutrons, including (a,np), (a,2n), (a,an): TALYS spectra normalised to the total neutron production
    var rn = runSpec(function (t) { return t.data.part ? { key: t.key, nAtomsPerGram: t.nAtomsPerGram, label: t.label, data: { Q_MeV: t.data.Q_MeV, mass_u: t.data.mass_u, residual: t.data.residual, total: t.data.part.neutron, nspec: t.data.nspec, levels: [] } } : null; }, EmaxS, 0.05);
    var multi = rn.yield - r.yield;
    if (rn.yield > 0 && multi > 0.01 * r.yield) {
      series.splice(2, 0, { name: 'All neutrons incl. multi-neutron channels (TALYS spectra × total neutron production)', x: rn.E, y: rn.total, color: color(5), dash: [3, 3], width: 1.4 });
      plot($('#n-plot'), { series: series, xlab: 'Neutron energy (MeV)', xname: 'Eₙ', ylab: unit, log: lg, legend: $('#n-legend'), ymin: lg ? max(N.last.sumParts) * 1e-5 : undefined });
    }
    // 2. protons from (a,p): level-resolved kinematics, plus the TALYS proton spectra
    var pEmax = Math.min(20, Math.max.apply(null, alphas.map(function (a) { return a[0]; })) + Math.max.apply([0], targets.map(function (t) { return t.data.p && t.data.p.Q_MeV || 0; })) + 2);
    var rp = runSpec(function (t) { var p = t.data.p; return p && p.total && max(p.total) > 0 ? { key: t.key, nAtomsPerGram: t.nAtomsPerGram, label: pretty(t.key) + '(α,p)', partLabel: pretty(t.key), ejMass: 1.00782503, data: { Q_MeV: p.Q_MeV, mass_u: t.data.mass_u, residual: pretty(p.residual), total: p.total, levels: p.levels, nspec: p.spec } } : null; }, Math.max(2, pEmax), 0.05);
    var wrap3 = $('#n-plot3-wrap'); wrap3.hidden = !(rp.yield > 0);
    var pSum = new Float64Array(rp.E.length); rp.partial.forEach(function (q) { for (var i = 0; i < pSum.length; i++) pSum[i] += q.values[i]; });
    if (rp.yield > 0) {
      var ps = [{ name: 'Protons: sum of final states (lab two-body kinematics)', x: rp.E, y: pSum, color: css('--ink'), width: 1.8 }, { name: 'TALYS proton spectra (all proton-emitting channels)', x: rp.E, y: rp.total, color: css('--muted'), dash: [5, 4], width: 1.4 }];
      rp.partial.slice(0, 6).forEach(function (q, k) { ps.push({ name: pretty(q.label), x: rp.E, y: q.values, color: color(k), width: 1.2 }); });
      plot($('#n-plot3'), { series: ps, xlab: 'Proton energy (MeV)', xname: 'Eₚ', ylab: unit.replace('neutrons', 'protons'), log: lg, height: 260, legend: $('#n-legend3'), ymin: lg ? Math.max(max(pSum), max(rp.total)) * 1e-5 : undefined });
    }
    // 3. prompt gammas: discrete lines of every residual (TALYS gamma-ray production cross sections, section 10)
    //    plus the continuum/capture part of the TALYS composite gamma spectrum (raw, which holds the (a,g) primaries)
    runSpec.raw = true;
    var rg = runSpec(function (t) { var g = t.data.g; return g ? { key: t.key, nAtomsPerGram: t.nAtomsPerGram, label: pretty(t.key), data: { Q_MeV: 0, mass_u: t.data.mass_u, residual: '', total: [0], nspec: g.spec, levels: [] } } : null; }, 16, 0.02);
    runSpec.raw = false;
    var gb = 0.02, gn = Math.round(16 / gb), gx = new Float64Array(gn), gl = new Float64Array(gn), gLines = 0, gCont = 0;
    for (var i = 0; i < gn; i++) gx[i] = (i + 0.5) * gb;
    function lines(tgs, list, stop) { tgs.forEach(function (t) { gammaList(t.data).forEach(function (g) { var y = chanYield(g.xs, t.nAtomsPerGram, list, thin, stop), k = Math.floor(g.Eg / 1000 / gb); if (y > 0 && k < gn) { gl[k] += y / gb; gLines += y; } }); }); }
    lines(targets, listA, stopA); if (lists && B_) lines(btargets, lists.B, B_.stopping);
    for (i = 0; i < rg.total.length; i++) gCont += rg.total[i] * gb;
    var wrap4 = $('#n-plot4-wrap'); wrap4.hidden = !(gLines > 0 || gCont > 0);
    if (gLines > 0 || gCont > 0) {
      var gs = [{ name: 'Discrete lines of the residual nuclei (' + fmt(gLines, 3) + ' ' + u + ')', x: gx, y: gl, color: color(4), width: 1.4 }];
      if (gCont > 0) gs.push({ name: 'Continuum and capture gammas (TALYS composite spectrum, ' + fmt(gCont, 3) + ' ' + u + ')', x: rg.E, y: rg.total, color: color(1), dash: [4, 3], width: 1.4 });
      plot($('#n-plot4'), { series: gs, xlab: 'Gamma energy (MeV)', xname: 'E', ylab: unit.replace('neutrons', 'gammas'), log: true, height: 240, legend: $('#n-legend4'), ymin: Math.max(max(gl), max(rg.total)) * 1e-6 });
    }
    // 4. yields of every channel from the residual production cross sections
    var yc = {};
    function addY(tgs, list, stop, tag) {
      tgs.forEach(function (t) { var pr = t.data.prod || {}; Object.keys(pr).forEach(function (res) {
        if (res === t.key) return;                    // inelastic handled below
        var y = chanYield(pr[res], t.nAtomsPerGram, list, thin, stop); if (!(y > 0)) return;
        var k = pretty(t.key) + chanLabel(t.data, res) + pretty(res) + tag; yc[k] = (yc[k] || 0) + y;
      }); if (pr[t.key]) { var yi = chanYield(pr[t.key], t.nAtomsPerGram, list, thin, stop); if (yi > 0) yc[pretty(t.key) + '(α,α′)' + pretty(t.key) + tag] = (yc[pretty(t.key) + '(α,α′)' + pretty(t.key) + tag] || 0) + yi; } });
    }
    addY(targets, listA, stopA, ''); if (lists && B_) addY(btargets, lists.B, B_.stopping, ' [backing]');
    var keys = Object.keys(yc).sort(function (a, b) { return yc[b] - yc[a]; });
    if (keys.length) {
      out.appendChild(el('h3', null, 'Yields by channel'));
      var tab = el('table', 'sx-table'), hd = el('tr'); ['Reaction', 'Yield ' + u].forEach(function (h) { hd.appendChild(el('th', null, h)); }); tab.appendChild(hd);
      keys.slice(0, 14).forEach(function (k) { var tr = el('tr'); tr.appendChild(el('td', null, k)); tr.appendChild(el('td', 'num', fmt(yc[k], 3))); tab.appendChild(tr); });
      out.appendChild(tab);
      var tot = function (pick) { var y = 0; function f(tgs, list, stop) { tgs.forEach(function (t) { if (t.data.part) y += chanYield(t.data.part[pick], t.nAtomsPerGram, list, thin, stop); }); } f(targets, listA, stopA); if (lists && B_) f(btargets, lists.B, B_.stopping); return y; };
      var nP = tot('neutron'), pP = tot('proton'), gP = gLines + gCont;
      out.appendChild(el('p', null, 'Particle production ' + u + ': neutrons ' + fmt(nP, 3) + (multi > 0.01 * r.yield ? ' (of which ' + fmt(multi, 3) + ' from multi-particle channels such as (α,np), (α,2n))' : '') + ', protons ' + fmt(pP, 3) + ', gammas ' + fmt(gP, 3) + ' (' + fmt(gLines, 3) + ' in the strongest discrete lines' + (gCont > 0 ? ', ' + fmt(gCont, 3) + ' continuum and capture' : '') + ').' + (rp.yield > 0 ? ' The (α,p) protons stop within tens of µm, so in a scintillator they appear as a quenched local deposit with the residual\'s gamma cascade.' : '')));
      out.appendChild(el('p', 'sx-note', 'Residual production cross sections from the same TALYS-1.95 runs, integrated over the slowing-down alpha. Multi-particle channel names are inferred from the residual (e.g. (α,np) and (α,pn) are the same residual); "(α,α′)" is inelastic scattering, which leaves the target excited. The proton plot treats (α,p) like (α,n): TALYS cross sections to each level of the residual (from its gamma cascade) with two-body kinematics; the dashed TALYS curve puts each level at the centre-of-mass channel energy instead and also includes protons from other channels. The gamma plot shows the discrete lines of every residual (TALYS gamma-ray production cross sections, up to about 65 lines per target) in 20 keV bins, plus the TALYS composite gamma spectrum, which in these runs holds only the continuum and capture gammas. Capture (α,γ) is usually tiny below 10 MeV.'));
    }
    N.last.protons = { E: rp.E, y: pSum, talys: rp.total }; N.last.gammas = { E: gx, y: gl, cont: rg.total }; N.last.allN = { E: rn.E, y: rn.total };
  }
  // compare the TALYS total cross section of one target with an uploaded sigma(E)
  function anCompare(targets, alphas, thin, stop, r) {
    var key = $('#n-cmp-t').value, wrap = $('#n-plot2-wrap');
    if (!key) { wrap.hidden = true; return; }
    load('data/signals/alphan/' + key + '.json').then(function (d) {
      wrap.hidden = false;
      var grid = []; for (var i = 1; i <= d.total.length; i++) grid.push(0.1 * i);
      var ser = [{ name: 'TALYS-1.95 total (α,n) cross section, ' + pretty(key), x: grid, y: d.total, color: color(0) }], note = '';
      var t = targets.filter(function (x) { return x.key === key; })[0];
      if (N.cmp && N.cmp.x.length) {
        ser.push({ name: 'Uploaded: ' + N.cmpName, x: N.cmp.x, y: N.cmp.y, color: color(1) });
        if (t) {
          var arr = grid.map(function (E) { return X.lin(N.cmp.x, N.cmp.y, E); });
          var yU = chanYield(arr, t.nAtomsPerGram, alphas, thin, stop), yT = chanYield(d.total, t.nAtomsPerGram, alphas, thin, stop);
          note = pretty(key) + '(α,n) yield with TALYS: ' + fmt(yT, 4) + '; with your cross section: ' + fmt(yU, 4) + ' (ratio ' + fmt(yU / (yT || 1), 3) + '). Total yield with your cross section in place of TALYS for this isotope: ' + fmt(r.yield - yT + yU, 4) + '.';
        } else note = pretty(key) + ' is not in the chosen material.';
      } else note = 'Upload a σ(E) file to compare.';
      plot($('#n-plot2'), { series: ser, xlab: 'Alpha energy (MeV)', xname: 'E', ylab: 'Cross section (mb)', legend: $('#n-legend2'), height: 240, log: true, ymin: 1e-4 });
      $('#n-legend2').appendChild(el('p', 'sx-note', note));
    });
  }
  function nPCSV() { var n = N.last; if (!n || !n.protons) return; download('alpha_p_protons.csv', ['proton_energy_MeV', 'sum_of_final_states', 'TALYS_proton_spectra'], [n.protons.E, n.protons.y, n.protons.talys], ['Radioactive Signal Explorer: (alpha,p) proton spectrum (TALYS-1.95 level cross sections, two-body kinematics)', 'Source: ' + n.src + '; composition: ' + JSON.stringify(n.comp), 'Units: ' + n.unit.replace('neutrons', 'protons')]); }
  function nGCSV() { var n = N.last; if (!n || !n.gammas) return; download('alpha_induced_gammas.csv', ['gamma_energy_MeV', 'discrete_lines_per_MeV'], [n.gammas.E, n.gammas.y], ['Radioactive Signal Explorer: prompt gamma lines from alpha-induced reactions (TALYS-1.95), 20 keV bins', 'Source: ' + n.src + '; composition: ' + JSON.stringify(n.comp), 'Units: ' + n.unit.replace('neutrons', 'gammas')]); }
  function nCSV() {
    var n = N.last; if (!n) return;
    var hdr = ['neutron_energy_MeV', 'TALYS_spectra_NeuCBOT', 'total_sum_of_final_states'].concat(n.r.partial.map(function (p) { return p.label.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, function (s) { return s.split('').map(function (c) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c); }).join(''); }); }));
    var cols = [n.r.E, n.r.total, n.sumParts].concat(n.r.partial.map(function (p) { return p.values; }));
    download('alpha_n_spectrum.csv', hdr, cols, ['Radioactive Signal Explorer: (alpha,n) neutron spectrum (NeuCBOT method, TALYS-1.95 data)', 'Source: ' + n.src + '; composition: ' + JSON.stringify(n.comp), 'Units: ' + n.unit + '; total yield ' + n.r.yield.toPrecision(4), 'Final-state columns: lab neutron energy from two-body kinematics, isotropic CM emission']);
  }

  /* ================================================================ BETA */
  var CORR = [
    ['L0', 'Finite nuclear size, L₀', 'Wilkinson 1990, uniformly charged sphere', true], ['U', 'Diffuse nuclear surface, U', 'Wilkinson 1993, Fermi distribution', true],
    ['C', 'Finite-size convolution, C', 'Hayen et al. eqs. 100–106; with b/Ac, d/Ac, Λ', true], ['WM', 'Weak magnetism and induced tensor', 'b/Ac, d/Ac in the GT shape factor (allowed branches only)', true],
    ['rad', 'Radiative O(α)', 'Sirlin 1967; Repko–Wu at the endpoint', true], ['o2', 'Radiative O(Zα²) + RG resummation', 'Sirlin 1987; Czarnecki, Marciano & Sirlin 2004', true],
    ['o3', 'Radiative O(Z²α³) and higher', 'Sirlin 1987 heuristic; Wilkinson 1997', true], ['RN', 'Kinematic recoil, R_N', 'Wilkinson 1990', true], ['Q', 'Coulomb recoil, Q', 'Wilkinson 1982', true],
    ['S', 'Atomic screening, S', 'Bühring 1984 (Rose-type potential shift)', true], ['X', 'Atomic exchange, X (β⁻)', 'Hayen et al. eq. 157, Table X', true],
    ['r', 'Atomic mismatch, r', 'Bahcall; Hayen et al. eq. 166, as an endpoint shift', true], ['lambda', 'Coulomb functions λₖ (unique forbidden)', 'Behrens–Bühring; λₖ = 1 if off', true]];
  var B = {};
  INIT.beta = function () {
    var box = $('#b-corr');
    CORR.forEach(function (c) { var l = el('label', 'sx-check'), i = el('input'); i.type = 'checkbox'; i.id = 'bc-' + c[0]; i.checked = c[3]; l.appendChild(i); l.appendChild(document.createTextNode(' ' + c[1])); l.title = c[2]; var s = el('span', 'sx-cite', c[2]); l.appendChild(s); box.appendChild(l); i.addEventListener('change', RUN.beta); });
    base().then(function () {
      fillList('#b-nuc-list', names('bm|bp'));
      $('#b-nuc').addEventListener('change', bNuc); $('#b-nuc').addEventListener('input', function () { if (has(normName(this.value), 'bm|bp')) bNuc(); });
      $('#b-branch').addEventListener('change', bBranch);
      ['#b-t0', '#b-sign', '#b-z', '#b-a', '#b-r', '#b-kind', '#b-k', '#b-rho', '#b-bac', '#b-dac', '#b-lam', '#b-um', '#b-uc', '#b-b0', '#b-vv', '#b-va', '#b-x', '#b-xbr', '#b-xmodel', '#b-xm', '#b-xn', '#b-sa', '#b-sb', '#b-sc', '#b-fmode', '#b-fierz', '#b-acorr', '#b-cs', '#b-csp', '#b-ct', '#b-ctp', '#b-mnu', '#b-st', '#b-ms', '#b-u2', '#b-log', '#b-ref', '#b-kurie'].forEach(function (id) { $(id).addEventListener('change', RUN.beta); });
      $('#b-csv').addEventListener('click', bCSV); $('#b-rcsv').addEventListener('click', bRCSV);
      document.querySelectorAll('.sx-gloss-link').forEach(function (l) { l.addEventListener('click', function (ev) { ev.preventDefault(); var d = $('#b-gloss'); d.open = true; d.scrollIntoView({ behavior: 'smooth' }); }); });
      $('#b-py').addEventListener('click', function () { bCode('py'); }); $('#b-cpp').addEventListener('click', function () { bCode('cpp'); });
      $('#b-copy').addEventListener('click', function () { navigator.clipboard && navigator.clipboard.writeText($('#b-code').textContent); this.textContent = 'Copied'; var b = this; setTimeout(function () { b.textContent = 'Copy'; }, 1500); });
      bNuc();
    }).catch(fail('#b-out'));
  };
  function parseRho() { var s = String($('#b-rho').value).trim().toLowerCase(); if (s === 'inf' || s === '∞' || s === 'infinity') return Infinity; var v = parseFloat(s); return isFinite(v) ? v : Infinity; }
  function bBranches(n) { var d = DEC[n] || {}, out = []; (d.bm || []).forEach(function (b) { out.push({ sign: -1, b: b }); }); (d.bp || []).forEach(function (b) { out.push({ sign: 1, b: b }); }); return out; }
  function bNuc() { withDec(normName($('#b-nuc').value), bNuc2); }
  function bNuc2() {
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
    $('#b-kind').value = rule.kind; $('#b-k').value = Math.max(1, rule.k || 1); B.dJ = rule.dJ;
    var pure = rule.pure; $('#b-rho').value = pure === 'F' ? '0' : pure === 'GT' ? 'inf' : (rule.kind === 'A' ? 'inf' : 'inf');
    $('#b-bac').value = pure === 'F' ? 0 : 5;
    $('#b-rule').innerHTML = rule.text;
    var ps_ = presetShape(n, x), pn = $('#b-preset-note');
    $('#b-sa').value = ps_ ? ps_.a : 0; $('#b-sb').value = ps_ ? ps_.b : 0; $('#b-sc').value = ps_ ? ps_.c : 0; $('#b-b0').value = 0;
    pn.hidden = !ps_; if (ps_) pn.innerHTML = 'Measured shape factor applied: C(W) = 1 ' + (ps_.a < 0 ? '− ' : '+ ') + fmt(Math.abs(ps_.a), 4) + ' W ' + (ps_.c < 0 ? '− ' : '+ ') + fmt(Math.abs(ps_.c), 4) + ' W² (' + SHAPE_PRESETS[n].ref + '). Edit it under “Empirical shape factor”.';
    else if (rule.kind === 'NU' && /^21[24]Pb$/.test(n)) { pn.hidden = false; pn.innerHTML = 'Full shell-model shape factors for the ²¹⁴Pb and ²¹²Pb ground-state decays exist (Haselschwardt et al. 2020, ancillary files of arXiv:2007.13686; Hayen et al., arXiv:2009.08303) and predict 15–23% fewer events at 1–15 keV than the allowed shape used here.'; }
    RUN.beta();
  }
  // measured shape factors C(W) = 1 + aW + b/W + cW^2 for specific branches (W in m_e c^2)
  var SHAPE_PRESETS = {
    '210Bi': { T0: 1161.2, shape: { a: -0.4470, b: 0, c: 0.0552 }, ref: 'Alekseev et al., arXiv:2005.08481: Si(Li) spectrometer, fitted with a Fermi function including finite-size, screening and other corrections' }
  };
  function presetShape(n, x) { var q = SHAPE_PRESETS[n]; return q && x && Math.abs(x.b[0] - q.T0) < 5 ? q.shape : null; }
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
    return { kind: f.kind, k: f.k, pure: pure, dJ: Ji && Jf ? Math.abs(Ji.J - Jf.J) : null, text: parts.join(' ') };
  }
  function ord(k) { return ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'][k] || k + 'th'; }
  function bParams(T0, over) {
    var corr = {}; CORR.forEach(function (c) { corr[c[0]] = $('#bc-' + c[0]).checked; });
    var kind = $('#b-kind').value, p = { Z: num('#b-z', 1) | 0, A: num('#b-a', 1) | 0, beta: +$('#b-sign').value, T0: T0, rrms: num('#b-r', 0) || null,
      kind: kind, k: num('#b-k', 1) | 0, rho: parseRho(), bAc: num('#b-bac', 0), dAc: num('#b-dac', 0), Lambda: num('#b-lam', 0), uM: num('#b-um', 0), uC: num('#b-uc', 0), b0: num('#b-b0', 0),
      xBR: $('#b-x').checked ? Math.min(1, Math.max(0, num('#b-xbr', 0))) : 0, xM: num('#b-xm', 0), xModel: $('#b-xmodel').value, xN: num('#b-xn', 5),
      shape: { a: num('#b-sa', 0), b: num('#b-sb', 0), c: num('#b-sc', 0) }, fierz: fierzValue(over && over.kind, over && over.rho, over && over.beta, over && over.k), mnu: num('#b-mnu', 0),
      msterile: $('#b-st').checked ? num('#b-ms', 0) : 0, Usterile2: $('#b-st').checked ? Math.min(1, Math.max(0, num('#b-u2', 0))) : 0, corr: corr, n: 600 };
    return Object.assign(p, over || {});
  }
  // b_F and a for the current inputs; kOver/rOver/sOver give per-branch kind/rho/sign when summing all branches
  function corrs(kOver, rOver, sOver, kkOver) {
    var m = $('#b-fmode').value, kd = kOver || $('#b-kind').value, sg = sOver != null ? sOver : +$('#b-sign').value;
    var rr = rOver != null ? rOver : parseRho(), kk = kkOver || (num('#b-k', 1) | 0);
    var sm = P.correlations({ kind: kd, k: kk, rho: rr, beta: sg });
    if (m === 'b') { var av = $('#b-acorr').value.trim(); return { b: num('#b-fierz', 0), a: av === '' ? sm.a : +av, aSM: sm.a, G: sm.G, GSM: sm.G, xiRel: 1, mode: 'b' }; }
    if (m === 'c') {
      var c = P.correlations({ kind: kd, k: kk, rho: rr, beta: sg, CS: num('#b-cs', 0), CSp: num('#b-csp', 0), CT: num('#b-ct', 0), CTp: num('#b-ctp', 0), vV: num('#b-vv', 1), vA: num('#b-va', 1) });
      return { b: c.b, a: c.a, aSM: sm.a, G: c.G, GSM: sm.G, xiRel: c.xiRel, mode: 'c', nu: !!c.undefinedForNU };
    }
    return { b: 0, a: sm.a, aSM: sm.a, G: sm.G, GSM: sm.G, xiRel: 1, mode: 'none' };
  }
  // recoil spectrum for one branch with its mass states: light (m_beta) and, if switched on, the heavy neutrino;
  // each state's electron spectrum is computed separately and weighted by (1-U^2) or U^2 times its phase-space integral
  function recoilFor(pr, a) {
    var ml = (pr.mnu || 0) / 1000, U2 = pr.Usterile2 || 0, states = [{ m: ml, w: 1 - U2 }];
    if (U2 > 0 && pr.msterile > 0) states.push({ m: pr.msterile, w: U2 });
    var parts = states.map(function (st) {
      var sp = P.betaSpectrum(Object.assign({}, pr, { mnu: st.m * 1000, Usterile2: 0, msterile: 0 }));
      return { r: P.betaRecoil(sp, { a: a, kind: pr.kind, k: pr.k, mnu: st.m, uM: pr.uM, uC: pr.uC }), w: st.w * (sp.norm || 0) };
    });
    if (parts.length === 1) return parts[0].r;
    var tw = parts[0].w + parts[1].w, R = parts[0].r, out = { T: R.T, dNdT: new Float64Array(R.T.length), max: R.max, a: a, mean: 0 };
    parts.forEach(function (o) { var f = tw > 0 ? o.w / tw : 0; out.mean += f * o.r.mean; for (var j = 0; j < R.T.length; j++) out.dNdT[j] += f * interp(o.r.T, o.r.dNdT, R.T[j]); });
    return out;
  }
  function fierzValue(kOver, rOver, sOver, kkOver) { return corrs(kOver, rOver, sOver, kkOver).b; }
  RUN.beta = function () {
    var n = normName($('#b-nuc').value), out = $('#b-out'); out.innerHTML = '';
    var kind = $('#b-kind').value, forb = kind !== 'A';
    // forbidden branches: rho and the allowed weak-magnetism slope do not apply; couplings -> b_F only for unique ones
    $('#b-rho-wrap').hidden = forb; $('#b-bac-wrap').hidden = forb; $('#b-dac-wrap').hidden = forb; $('#b-lam-wrap').hidden = forb; $('#b-nlo-wrap').hidden = !(kind === 'U' && (num('#b-k', 1) | 0) === 1); $('#b-cs-wrap').hidden = forb;
    $('#b-fmode-c').disabled = kind === 'NU';
    if (kind === 'NU' && $('#b-fmode').value === 'c') $('#b-fmode').value = 'b';
    var fn = $('#b-forb-note'); fn.hidden = !forb;
    if (kind === 'U') fn.innerHTML = 'Unique forbidden: the Fermi/Gamow–Teller mixing ρ, the allowed weak-magnetism and induced-tensor terms (b/Ac, d/Ac) and Λ do not apply. Finite-size and recoil terms use their axial (Gamow–Teller) form; the Coulomb-recoil term uses the leading-order β–ν correlation a = −1/(2k+3) = ' + fmt(-1 / (2 * (num('#b-k', 1) + 1) + 1), 3) + '. These allowed-decay corrections are approximations at the 10⁻³ level here.';
    else if (kind === 'NU') fn.innerHTML = 'Non-unique forbidden: the shape depends on several nuclear matrix elements. The ξ approximation (allowed shape) is used unless you enter an empirical shape factor; ρ, the weak-magnetism and induced-tensor terms (b/Ac, d/Ac) and Λ do not apply, and the Coulomb-recoil term takes a = 0.';
    $('#b-fierz-note').innerHTML = kind === 'NU' ? 'For a non-unique forbidden branch, b<sub>F</sub> is a <em>phenomenological</em> 1 + b<sub>F</sub> γ m<sub>e</sub>c²/E tilt: exotic couplings interfere with several matrix elements here, so b<sub>F</sub> cannot be computed from them without nuclear-structure input.'
      : kind === 'U' ? 'For a unique forbidden branch only tensor couplings interfere (the operators are axial), and the leading-order term has the same form as in allowed Gamow–Teller decays: 1 + b<sub>F</sub> γ m<sub>e</sub>c²/E with b<sub>F</sub> = ±Re[(C<sub>T</sub>+C′<sub>T</sub>)/C<sub>A</sub>].'
      : 'Multiplies the spectrum by 1 + b<sub>F</sub> γ m<sub>e</sub>c²/E, which tilts it towards low energies for b<sub>F</sub> &gt; 0.';
    var fm = $('#b-fmode').value; $('#b-fb-wrap').hidden = fm !== 'b'; $('#b-fc-wrap').hidden = fm !== 'c'; $('#b-st-wrap').hidden = !$('#b-st').checked; $('#b-x-wrap').hidden = !$('#b-x').checked;
    $('#b-xm-wrap').hidden = $('#b-xmodel').value !== 'ps'; $('#b-xn-wrap').hidden = $('#b-xmodel').value !== 'n';
    $('#b-b0-wrap').hidden = !(kind === 'NU' && (num('#b-k', 1) | 0) === 1 && (B.dJ === 0 || B.dJ == null)); $('#b-vv-wrap').hidden = kind !== 'A';
    if (fm === 'c') { var cc = corrs(); $('#b-fc-out').innerHTML = 'b<sub>F</sub> = ' + fmt(cc.b, 4) + ', a = ' + fmt(cc.a, 5) + ' (Standard Model ' + fmt(cc.aSM, 4) + '), electron helicity G/β = ' + fmt(cc.G, 5) + ' (Standard Model ' + fmt(cc.GSM, 3) + '), decay rate × ' + fmt(cc.xiRel, 5) + ' relative to V − A' + (kind === 'U' ? '; unique forbidden: tensor couplings only' : (parseRho() === Infinity ? '; pure Gamow–Teller: tensor couplings only' : parseRho() === 0 ? '; pure Fermi: scalar couplings only' : '')) + ', ' + (+$('#b-sign').value < 0 ? 'β⁻' : 'β⁺') + '.'; }
    $('#b-k-wrap').hidden = kind === 'A';
    var T0 = num('#b-t0', NaN);
    if (!(T0 > 0)) { plot($('#b-plot'), { series: [], empty: 'Choose a beta emitter or enter an endpoint energy.' }); plot($('#b-plot2'), { series: [] }); return; }
    var br = bBranches(n), all = $('#b-branch').value === 'all' && br.length > 1;
    var spec, ref, lg = $('#b-log').checked, kur = $('#b-kurie').checked;
    if (all) {                             // intensity-weighted sum of every branch, each with its own classification
      var RC = [];
      var Tmax = Math.max.apply(null, br.map(function (x) { return x.b[0]; })), nb = 800, T = new Float64Array(nb), Y = new Float64Array(nb), Yr = new Float64Array(nb), tot = 0;
      for (var i = 0; i < nb; i++) T[i] = Tmax * (i + 0.5) / nb;
      br.forEach(function (x) {
        var c = classify(n, x), info = nucInfo(n);
        var pr = bParams(x.b[0], { beta: x.sign, Z: info.Z + (x.sign < 0 ? 1 : -1), kind: c.kind, k: Math.max(1, c.k || 1), rho: c.pure === 'F' ? 0 : Infinity, bAc: c.pure === 'F' ? 0 : 5, shape: presetShape(n, x) });
        var s = P.betaSpectrum(pr);
        var cb = corrs(pr.kind, pr.rho, pr.beta, pr.k);
        RC.push({ r: recoilFor(pr, cb.a), w: x.b[1] / 100, kind: pr.kind, s: s, G: cb.G });
        var s0 = $('#b-ref').checked ? P.betaSpectrum(Object.assign({}, pr, { corr: {} })) : null, w = x.b[1] / 100; tot += w;
        for (var j = 0; j < nb; j++) { Y[j] += w * interp(s.T, s.dNdT, T[j]); if (s0) Yr[j] += w * interp(s0.T, s0.dNdT, T[j]); }
      });
      spec = { T: T, dNdT: Y, mean: meanOf(T, Y) / (tot || 1), factors: null }; ref = $('#b-ref').checked ? { T: T, dNdT: Yr } : null;
    } else {
      spec = P.betaSpectrum(bParams(T0)); ref = $('#b-ref').checked ? P.betaSpectrum(bParams(T0, { corr: {} })) : null;
      var RC = [{ r: recoilFor(bParams(T0), corrs().a), w: 1, kind: kind, s: spec, G: corrs().G }];
    }
    // recoil-nucleus spectrum (sum over branches on a common grid)
    var rmax = Math.max.apply(null, RC.map(function (o) { return o.r.max; })), nr = 240, RT = new Float64Array(nr), RY = new Float64Array(nr), rw = 0, rmean = 0;
    for (var ir = 0; ir < nr; ir++) RT[ir] = (ir + 0.5) / nr * rmax;
    RC.forEach(function (o) { rw += o.w; rmean += o.w * o.r.mean; for (var j = 0; j < nr; j++) RY[j] += o.w * (RT[j] < o.r.max ? interp(o.r.T, o.r.dNdT, RT[j]) : 0); });
    var eV = rmax < 1, ru = eV ? 1000 : 1, RTu = Array.prototype.map.call(RT, function (v) { return v * ru; }), RYu = Array.prototype.map.call(RY, function (v) { return v / ru; });
    plot($('#b-plot3'), { series: [{ name: 'Recoiling daughter nucleus', x: RTu, y: RYu, color: color(2) }], xlab: 'Recoil kinetic energy (' + (eV ? 'eV' : 'keV') + ')', xname: 'T_R', ylab: (all ? 'Recoils per ' : 'Probability per ') + (eV ? 'eV' : 'keV'), legend: $('#b-legend3'), height: 250 });
    var cs = corrs(), anyNU = RC.some(function (o) { return o.kind === 'NU'; });
    $('#b-recoil-note').innerHTML = 'Recoil energy: mean ' + fmt(rmean / (rw || 1) * ru, 4) + ' ' + (eV ? 'eV' : 'keV') + ', maximum ' + fmt(rmax * ru, 4) + ' ' + (eV ? 'eV' : 'keV') + '. ' +
      (all ? 'Each branch uses its own Standard Model or coupling-derived a. ' : 'β–ν correlation a = ' + fmt(RC[0].r.a, 5) + (cs.a !== cs.aSM ? ' (Standard Model ' + fmt(cs.aSM, 4) + ')' : ' (Standard Model)') + '. ') +
      'The recoil spectrum depends on a, which the electron spectrum does not; this is how a is measured (ion traps). ' +
      (kind === 'U' && !all ? 'For this unique transition the angular distribution includes the q<sup>2(J−1)</sup> weight and the extra [β² − (β·ν̂)²]/q² term. ' : '') +
      (anyNU ? 'For non-unique forbidden branches a is not known without nuclear matrix elements; a = 0 (isotropic) is used unless you enter it. ' : '') +
      (bParams(T0).mnu || bParams(T0).Usterile2 ? 'Neutrino masses included: each mass state recoils with its own momentum √(E<sub>ν</sub>² − m²) and the correlation carries the neutrino velocity, a β<sub>e</sub>β<sub>ν</sub> cos θ; the heavy state is weighted by |U<sub>e4</sub>|² and its phase space. ' : '') +
      'No Coulomb or recoil-order corrections to the correlation; recoil energies of a few eV can be modified by atomic and molecular binding.';
    B.recoil = { T: RTu, y: RYu, unit: eV ? 'eV' : 'keV' };
    // electron longitudinal polarisation G(T) = (G/beta) v/c, intensity-weighted over branches
    var PT = spec.T, PG = new Float64Array(PT.length), PGsm = new Float64Array(PT.length);
    for (var ip = 0; ip < PT.length; ip++) {
      var Wp = PT[ip] / 511 + 1, bet = Math.sqrt(Wp * Wp - 1) / Wp, num_ = 0, nsm = 0, den = 0;
      RC.forEach(function (o) { var y = o.s ? interp(o.s.T, o.s.dNdT, PT[ip]) * o.w : 0; num_ += y * (o.G || 0) * bet; den += y;
        var smG = P.correlations({ kind: o.kind, k: 1, rho: Infinity, beta: o.s && o.s.ctx ? o.s.ctx.beta : +$('#b-sign').value }).G; nsm += y * smG * bet; });
      PG[ip] = den > 0 ? num_ / den : (RC[0].G || 0) * bet; PGsm[ip] = den > 0 ? nsm / den : -(+$('#b-sign').value < 0 ? 1 : -1) * bet;
    }
    var pser = [{ name: 'Electron longitudinal polarisation G', x: PT, y: PG, color: color(4) }];
    var gdiff = 0; for (ip = 0; ip < PT.length; ip++) gdiff = Math.max(gdiff, Math.abs(PG[ip] - PGsm[ip]));
    if (gdiff > 1e-6) pser.push({ name: 'Standard Model (V − A)', x: PT, y: PGsm, color: css('--muted'), dash: [5, 4], width: 1.4 });
    plot($('#b-plot4'), { series: pser, xlab: 'Kinetic energy (keV)', xname: 'T', ylab: 'Polarisation G', legend: $('#b-legend4'), height: 220 });
    $('#b-pol-note').innerHTML = 'Electron (positron) longitudinal polarisation: G = (G/β)·v/c, −v/c for β⁻ and +v/c for β⁺ in the V − A Standard Model. Right-handed currents (C′ ≠ C) and products of left- and right-handed exotic couplings change it; with massless neutrinos they leave the energy spectrum shape unchanged, so helicity (Mott or Bhabha polarimetry) and correlations are where right-handed currents are measured. Coulomb terms of order αZ m/p (which need complex couplings) are omitted.';
    var yl = all ? 'Electrons per keV per decay' : 'Probability per keV (normalised)';
    var series = [{ name: 'With selected corrections', x: spec.T, y: kur ? kurie(spec, all) : spec.dNdT, color: color(0) }];
    if (!all && !kur && spec.dNdT_X) { var xb = bParams(T0).xBR;
      series.push({ name: 'Standard decays (×' + fmt(1 - xb, 3) + ')', x: spec.T, y: Array.prototype.map.call(spec.dNdT_SM, function (v) { return v * (1 - xb); }), color: color(1), width: 1.2 });
      series.push({ name: 'Boson-emitting decays (×' + fmt(xb, 3) + ')', x: spec.T, y: Array.prototype.map.call(spec.dNdT_X, function (v) { return v * xb; }), color: color(3), width: 1.2 }); }
    if (ref) series.push({ name: 'Same shape, no corrections (F₀ only)', x: ref.T, y: kur ? kurie(ref, all) : ref.dNdT, color: css('--muted'), dash: [5, 4], width: 1.4 });
    var bp = bParams(T0), marks = [];
    if (bp.Usterile2 > 0 && bp.msterile > 0 && bp.msterile < T0) marks.push({ x: T0 - bp.msterile, label: 'kink: T₀ − m₄c²' });
    plot($('#b-plot'), { series: series, xlab: 'Kinetic energy (keV)', xname: 'T', ylab: kur ? 'Kurie: √(N / pW F₀) (arb.)' : yl, log: lg && !kur, legend: $('#b-legend'), marks: marks, ymin: lg && !kur ? max(spec.dNdT) * 1e-5 : undefined });
    // correction factors panel
    if (spec.factors) {
      var fs = [], k = 0;
      [['L0', 'Finite size L₀ · U'], ['C', 'Convolution C (incl. weak magnetism)'], ['R', 'Radiative'], ['S', 'Screening'], ['X', 'Exchange'], ['r', 'Mismatch'], ['RN', 'Recoil R_N · Q'], ['nlo', 'Next order in qR (unique)'], ['fierz', 'Fierz']].forEach(function (f) {
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
    if (p.kind === 'U') rows.push(['Unique forbidden shape (k = ' + p.k + ')', 'C(W) ∝ Σ<sub>n=1</sub><sup>k+1</sup> λ<sub>n</sub> p<sup>2(n−1)</sup> q<sup>2(k+1−n)</sup> / [(2n−1)! (2(k+1−n)+1)!],&nbsp; q = √((W₀ − W)² − m<sub>ν</sub>²) the neutrino momentum,&nbsp; λ<sub>n</sub> = F<sub>n−1</sub>/F₀ · (n + γ<sub>n</sub>)/(n(1 + γ₁)),&nbsp; F<sub>n−1</sub> = [n(2n−1)!!]² 4<sup>n</sup> (2pR)<sup>2(γₙ−n)</sup> e<sup>πy</sup> |Γ(γₙ+iy)|²/Γ(1+2γₙ)²']);
    if (p.corr.rad) rows.push(['Radiative (O(α))', '1 + δ₁ = 1 + (α/2π)[g(W₀,W) − 3 ln(m<sub>p</sub>/2W₀)], with Sirlin’s g; the t(β) ln(W₀−W) term is resummed as (W₀−W)<sup>t(β)</sup> − 1']);
    if (p.fierz) rows.push(['Fierz term', 'N → N · (1 + b<sub>F</sub> γ / W),&nbsp; b<sub>F</sub> = ' + fmt(p.fierz, 4) + ($('#b-fmode').value === 'c' ? (p.kind === 'U' ? ' = ±2(x<sub>T</sub> + x′<sub>T</sub>)/(2 + x<sub>T</sub>² + x′<sub>T</sub>²), x = C/C<sub>A</sub> (unique forbidden: tensor only)' : ' = ±2[(x<sub>S</sub> + x′<sub>S</sub>) + ρ²(x<sub>T</sub> + x′<sub>T</sub>)]/ξ,&nbsp; ξ = (2 + x<sub>S</sub>² + x′<sub>S</sub>²) + ρ²(2 + x<sub>T</sub>² + x′<sub>T</sub>²),&nbsp; x<sub>S</sub> = C<sub>S</sub>/C<sub>V</sub>, x<sub>T</sub> = C<sub>T</sub>/C<sub>A</sub> (Jackson–Treiman–Wyld)') : (p.kind === 'NU' ? ' (phenomenological for this non-unique branch)' : ''))]);
    if (p.kind === 'U' && p.k === 1 && (p.uM || p.uC)) rows.push(['Next order in qR (unique 1st forbidden)', 'C → C × [1 + δ₁ − (4/15) δ<sub>c</sub> β kν/(k² + ν²)],&nbsp; δ₁ = (4/5)[±√(3/2)(ν − k²/W) R u<sub>M</sub> − (ν + k²/W) R u<sub>C</sub>],&nbsp; δ<sub>c</sub> = 2[±√(3/2)(W − ν) R u<sub>M</sub> − (ν + W) R u<sub>C</sub>],&nbsp; u<sub>M</sub> = ' + fmt(p.uM, 4) + ', u<sub>C</sub> = ' + fmt(p.uC, 4) + ' (Glick-Magid et al. 2017, eqs. 12–14, integrated with the q² weight)']);
    var ca = corrs(); rows.push(['Recoil spectrum', 'T<sub>R</sub> = q²/2M with q² = k² + ν² + 2kν cos θ (ν the neutrino momentum); cos θ distributed as q<sup>2(J−1)</sup>[1 + a β<sub>e</sub>β<sub>ν</sub> cos θ − (J−1) a kν β<sub>e</sub>β<sub>ν</sub> sin²θ / q²], β<sub>ν</sub> = ν/E<sub>ν</sub> (J = 1 allowed, J = k + 1 unique), weighted by the electron spectrum;&nbsp; a = ' + fmt(ca.a, 5) + (p.kind === 'U' ? ' = −(2 − x<sub>T</sub>² − x′<sub>T</sub>²)/[(2J+1)(2 + x<sub>T</sub>² + x′<sub>T</sub>²)]' : p.kind === 'A' ? ' = [(2 − x<sub>S</sub>² − x′<sub>S</sub>²) − ρ²(2 − x<sub>T</sub>² − x′<sub>T</sub>²)/3]/ξ' : '')]);
    if (p.mnu) rows.push(['Neutrino mass', '(W₀ − W)² → (W₀ − W) √((W₀ − W)² − m<sub>β</sub>²),&nbsp; m<sub>β</sub> = ' + fmt(p.mnu, 4) + ' eV/c²']);
    if (p.Usterile2) rows.push(['Heavy neutrino', 'N = (1 − |U<sub>e4</sub>|²) N(m<sub>β</sub>) + |U<sub>e4</sub>|² N(m₄),&nbsp; m₄ = ' + fmt(p.msterile, 4) + ' keV/c², |U<sub>e4</sub>|² = ' + fmt(p.Usterile2, 3) + '; the heavy branch ends at T₀ − m₄c² = ' + fmt(p.T0 - p.msterile, 5) + ' keV']);
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
  function bRCSV() {
    var r = B.recoil; if (!r) return;
    download('beta_recoil_' + (B.last && B.last.n || 'custom') + '.csv', ['recoil_energy_' + r.unit, 'dN_dTR_per_' + r.unit], [r.T, r.y],
      ['Radioactive Signal Explorer: recoil-nucleus kinetic-energy spectrum, a = ' + (corrs().a) + ' (single branch) or per-branch values (all branches)']);
  }
  function bCode(lang) {
    var p = bParams(num('#b-t0', 0)), code = window.SignalCode ? window.SignalCode[lang](p) : '// code generator not loaded';
    $('#b-code').textContent = code; $('#b-code-wrap').hidden = false;
  }

  /* ================================================================ CHERENKOV */
  var CMAT = [
    ['Water (20 °C)', { sell: [[5.684027565e-1, 1.726177391e-1, 2.086189578e-2, 1.130748688e-1], [5.101829712e-3, 1.821153936e-2, 2.620722293e-2, 1.069792721e1]], rho: 0.998, ZA: 0.5551, I: 75, Zeff: 7.4, X0: 36.08, src: 'Daimon & Masumura 2007' }],
    ['Fused silica', { sell: [[0.6961663, 0.4079426, 0.8974794], [0.00467914826, 0.0135120631, 97.9340025]], rho: 2.20, ZA: 0.4993, I: 139.2, Zeff: 11, X0: 27.05, src: 'Malitson 1965' }],
    ['Acrylic (PMMA)', { sell: [[1.1819], [0.011313]], rho: 1.19, ZA: 0.5394, I: 74, Zeff: 6.5, src: 'Sultanova et al. 2009' }],
    ['Borosilicate crown (N-BK7)', { sell: [[1.03961212, 0.231792344, 1.01046945], [0.00600069867, 0.0200179144, 103.560653]], rho: 2.51, ZA: 0.4973, I: 134, Zeff: 11, X0: 28.2, src: 'Schott' }],
    ['Sapphire (ordinary ray)', { sell: [[1.4313493, 0.65054713, 5.3414021], [0.00527992610, 0.0142382647, 325.017834]], rho: 3.98, ZA: 0.4904, I: 145.2, Zeff: 11, X0: 24.94, src: 'Malitson & Dodge 1972' }],
    ['Diamond', { sell: [[0.3306, 4.3356], [0.030625, 0.011236]], rho: 3.51, ZA: 0.4995, I: 78, Zeff: 6, X0: 42.7, src: 'Peter 1923' }],
    ['Liquid argon (n ≈ 1.23)', { n: 1.23, rho: 1.396, ZA: 0.4506, I: 188, Zeff: 18, X0: 19.55, src: 'approximate visible-range value' }],
    ['Liquid xenon (n ≈ 1.39)', { n: 1.39, rho: 2.953, ZA: 0.4113, I: 482, Zeff: 54, X0: 8.48, src: 'approximate visible-range value' }],
    ['Linear alkylbenzene (n ≈ 1.48)', { n: 1.48, rho: 0.86, ZA: 0.552, I: 63, Zeff: 5.6, X0: 44.0, src: 'approximate visible-range value' }],
    ['Borosilicate PMT glass (n ≈ 1.47)', { sell: [[1.0168, 0.0948, 0.9024], [0.00568, 0.0217, 101.0]], rho: 2.23, ZA: 0.4970, I: 134, Zeff: 11, X0: 28.0, src: 'Borofloat-33-like Sellmeier fit, approximate', comp: { O: 0.539, Si: 0.377, B: 0.040, Na: 0.030, Al: 0.012 } }]];
  var BIALKALI = [[260, 0.05], [280, 0.15], [300, 0.24], [330, 0.29], [360, 0.31], [400, 0.30], [440, 0.26], [480, 0.20], [520, 0.13], [560, 0.07], [600, 0.03], [650, 0.008], [700, 0.001]];
  var C = {};
  INIT.cher = function () {
    CMAT.forEach(function (m, i) { var o = el('option', null, m[0]); o.value = i; $('#c-mat').appendChild(o); });
    $('#c-mat').addEventListener('change', function () { var m = CMAT[+this.value][1]; $('#c-rho').value = m.rho; $('#c-za').value = m.ZA; $('#c-i').value = m.I; RUN.cher(); });
    ['#c-e', '#c-const', '#c-b1', '#c-b2', '#c-b3', '#c-c1', '#c-c2', '#c-c3', '#c-rho', '#c-za', '#c-i', '#c-l0', '#c-l1', '#c-gt', '#c-k2o', '#c-delta', '#c-ang', '#c-qe', '#c-qe-text', '#c-tr', '#c-path', '#c-att',
      '#c-wls', '#c-wcut', '#c-weff', '#c-wcoll', '#c-wpk', '#c-wsig'].forEach(function (id) { $(id).addEventListener('change', RUN.cher); });
    function readCurve(inp, key) { inp.addEventListener('change', function () { var f = this.files && this.files[0]; if (!f) return; f.text().then(function (t) { C[key] = t; C[key + 'Name'] = f.name; if (key === 'qeText') $('#c-qe-text').value = t; RUN.cher(); }); }); }
    readCurve($('#c-qe-file'), 'qeText'); readCurve($('#c-tr-file'), 'trText');
    document.querySelectorAll('input[name=c-src],input[name=c-n]').forEach(function (r) { r.addEventListener('change', RUN.cher); });
    $('#c-csv').addEventListener('click', cCSV);
    var m0 = CMAT[0][1]; $('#c-rho').value = m0.rho; $('#c-za').value = m0.ZA; $('#c-i').value = m0.I;
    RUN.cher();
  };
  RUN.cher = function () {
    var src = srcVal('c-src'), nm = srcVal('c-n'), out = $('#c-out'); out.innerHTML = '';
    if (src === 'k40' && nm !== 'mat') { document.querySelector('input[name=c-n][value=mat]').checked = true; nm = 'mat'; }
    if (src === 'k40' && C.lastSrc !== 'k40') { var gi = CMAT.length - 1; $('#c-mat').value = gi; $('#c-rho').value = CMAT[gi][1].rho; $('#c-za').value = CMAT[gi][1].ZA; $('#c-i').value = CMAT[gi][1].I; }
    C.lastSrc = src;
    $('#c-k40-wrap').hidden = src !== 'k40';
    $('#c-qe-wrap').hidden = $('#c-qe').value !== 'up'; $('#c-att-wrap').hidden = $('#c-att-note').hidden = $('#c-tr').value !== 'att'; $('#c-tr-wrap').hidden = $('#c-tr').value !== 'up'; $('#c-wls-wrap').hidden = !$('#c-wls').checked;
    $('#c-e-wrap').hidden = src !== 'mono'; $('#c-mat-wrap').hidden = nm !== 'mat'; $('#c-const-wrap').hidden = nm !== 'const'; $('#c-sell-wrap').hidden = nm !== 'sell';
    var nf, label, mat = CMAT[+$('#c-mat').value][1];
    if (nm === 'mat') { nf = mat.sell ? function (l) { return P.sellmeier(mat.sell[0], mat.sell[1], l); } : function () { return mat.n; }; label = CMAT[+$('#c-mat').value][0] + ' (' + mat.src + ')'; }
    else if (nm === 'const') { var nc = num('#c-const', 1.33); nf = function () { return nc; }; label = 'n = ' + nc; }
    else { var Bs = [num('#c-b1', 0), num('#c-b2', 0), num('#c-b3', 0)], Cs = [num('#c-c1', 0), num('#c-c2', 0), num('#c-c3', 0)]; nf = function (l) { return P.sellmeier(Bs, Cs, l); }; label = 'Sellmeier B = ' + Bs.join(', ') + '; C = ' + Cs.join(', ') + ' µm²'; }
    // electrons
    var T, w, dT, srcLabel, note = '';
    if (src === 'mono') { var E = num('#c-e', 1000); dT = Math.max(0.5, E / 400); T = [E]; w = [1 / dT]; srcLabel = 'one ' + fmt(E, 4) + ' keV electron'; }
    else if (src === 'k40') {
      if (!C.xcom) { load('data/signals/xcom.json').then(function (x) { C.xcom = x; RUN.cher(); }); plot($('#c-plot'), { series: [], empty: 'Loading photon cross sections…' }); return; }
      var k = k40Electrons(); T = k.T; w = k.w; dT = k.dT; srcLabel = '⁴⁰K decays in ' + fmt(num('#c-gt', 3), 3) + ' mm of PMT glass (per decay)'; C.k40 = k;
    }
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
    m.X0 = nm === 'mat' && mat.X0 ? mat.X0 : 36.08;
    var Tmax = Math.max.apply(null, T) * 1.01 + 1, tab = P.cherenkovTable(m, lam, Tmax), y0 = P.cherenkovFromSpectrum(tab, T, w, dT), y = Float64Array.from(y0), yd = null;
    function integ(a) { var t = 0; for (var q = 1; q < nl; q++) t += 0.5 * (a[q] + a[q - 1]) * (lam[q] - lam[q - 1]); return t; }
    if ($('#c-delta').checked) { var dtab = X.cherenkovDeltaTable(m, tab); yd = P.cherenkovFromSpectrum(dtab, T, w, dT); for (i = 0; i < nl; i++) y[i] += yd[i]; }
    var total = integ(y), per = src === 'mono' ? 'electron' : src === 'beta' ? (B.last && B.last.all ? 'decay' : 'beta') : 'decay';
    // detection: QE, transmission, wavelength shifter
    var qe = cCurve($('#c-qe').value, 'qe'), tr = cTrans(), wl = $('#c-wls').checked ? { cut: num('#c-wcut', 380), eff: num('#c-weff', 0.9), coll: num('#c-wcoll', 0.5), peak: num('#c-wpk', 420), sigma: Math.max(1, num('#c-wsig', 21)) } : null;
    var detecting = !!(qe.f || tr.f || wl), det = detecting ? X.detectLight(lam, y, { qe: qe.f, trans: tr.f, wls: wl }) : null, dsum = null, pe = 0;
    if (det) { dsum = new Float64Array(nl); for (i = 0; i < nl; i++) dsum[i] = det.direct[i] + det.reemitted[i]; pe = integ(dsum); }
    var ser = [{ name: 'Cherenkov photons emitted' + (yd ? ' (primary + delta rays)' : ''), x: lam, y: y, color: color(6), width: 1.8 }];
    if (yd) ser.push({ name: 'From delta rays', x: lam, y: yd, color: color(2), dash: [4, 3] });
    if (det) {
      var unitDet = qe.f ? 'photoelectrons' : 'photons reaching the sensor';
      ser.push({ name: 'Detected: ' + unitDet + (wl ? ' (direct + re-emitted)' : ''), x: lam, y: dsum, color: color(0), width: 1.8 });
      if (wl) ser.push({ name: 'Re-emitted by the wavelength shifter', x: lam, y: det.reemitted, color: color(1), dash: [5, 4] });
    }
    plot($('#c-plot'), { series: ser, xlab: 'Wavelength (nm)', xname: 'λ', ylab: 'Photons per nm per ' + per, legend: $('#c-legend') });
    var s2 = [{ name: 'Refractive index n(λ)', x: lam, y: tab.nl, color: color(0) }];
    plot($('#c-plot2'), { series: s2, xlab: 'Wavelength (nm)', xname: 'λ', ylab: 'Refractive index n', height: 200, legend: $('#c-legend2'), ymin: Math.min.apply(null, tab.nl) * 0.995, ymax: Math.max.apply(null, tab.nl) * 1.005 });
    if (qe.f || tr.f) {
      var eff = [], qq = [], tt = []; lam.forEach(function (l) { var a = qe.f ? qe.f(l) : 1, b = tr.f ? tr.f(l) : 1; qq.push(a); tt.push(b); eff.push(a * b); });
      var s3 = []; if (qe.f) s3.push({ name: 'Quantum efficiency' + (qe.name ? ' (' + qe.name + ')' : ''), x: lam, y: qq, color: color(4) });
      if (tr.f) s3.push({ name: 'Transmission', x: lam, y: tt, color: color(5) });
      if (qe.f && tr.f) s3.push({ name: 'QE × transmission', x: lam, y: eff, color: css('--ink'), dash: [4, 3] });
      var c4 = $('#c-plot4') || (function () { var d = el('div', 'sx-plot'); d.id = 'c-plot4-wrap'; var cv = el('canvas'); cv.id = 'c-plot4'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Detection efficiency versus wavelength'); var lgd = el('div', 'sx-legend'); lgd.id = 'c-legend4'; d.appendChild(cv); d.appendChild(lgd); $('#c-plot2').parentNode.after(d); return cv; })();
      $('#c-plot4-wrap').hidden = false;
      plot(c4, { series: s3, xlab: 'Wavelength (nm)', xname: 'λ', ylab: 'Efficiency (fraction)', height: 200, ymin: 0, ymax: 1, legend: $('#c-legend4') });
    } else if ($('#c-plot4-wrap')) $('#c-plot4-wrap').hidden = true;
    // angular distribution
    var ang = null;
    $('#c-plot3-wrap').hidden = !$('#c-ang').checked;
    if ($('#c-ang').checked) {
      var samples = []; for (i = 0; i < T.length; i++) if (w[i] > 0) samples.push({ T0: T[i], w: w[i] * dT });
      if (samples.length > 120) { var st = Math.ceil(samples.length / 120), sm = []; for (i = 0; i < samples.length; i += st) { var acc = { T0: samples[i].T0, w: 0 }; for (var q = i; q < Math.min(samples.length, i + st); q++) acc.w += samples[q].w; sm.push(acc); } samples = sm; }
      var lm = 0.5 * (l0 + l1); ang = X.cherenkovAngles(m, samples, lm, { histories: 400, bins: 80 });
      if (ang.cos.length) {
        var ideal = ang.cos.map(function (c) { return 0; }), bw = 2 / ang.cos.length, kc = Math.min(ang.cos.length - 1, Math.floor((ang.cosC + 1) / bw)); ideal[kc] = 1 / bw;
        var thd = ang.cos.map(function (c) { return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI; });
        plot($('#c-plot3'), { series: [{ name: 'With multiple scattering (relative to the initial electron direction)', x: thd.slice().reverse(), y: ang.y.slice().reverse(), color: color(6) }], xlab: 'Angle to the initial electron direction (degrees)', xname: 'θ', ylab: 'Photons per unit cos θ (normalised)', height: 240, legend: $('#c-legend3'),
          marks: [{ x: Math.acos(ang.cosC) * 180 / Math.PI, label: 'Cherenkov angle for β → 1: ' + fmt(Math.acos(ang.cosC) * 180 / Math.PI, 3) + '°', row: 0 }] });
      }
    }
    C.last = { lam: lam, y: y, yd: yd, det: dsum, n: tab.nl, label: label, srcLabel: srcLabel, total: total, pe: pe, ang: ang };
    var th = tab.threshold[Math.floor(nl / 2)];
    out.appendChild(el('h3', null, fmt(total, 4) + ' photons between ' + fmt(l0, 4) + ' and ' + fmt(l1, 4) + ' nm' + (det ? '; ' + fmt(pe, 4) + (qe.f ? ' photoelectrons' : ' photons at the sensor') : '')));
    var dn = [];
    if (yd) dn.push('Delta rays add ' + pc(integ(yd) / (integ(y0) || 1)) + ' to the light of the primaries (Møller cross section, knock-ons above the Cherenkov threshold, each followed with its own slowing down; the primary keeps its unrestricted stopping power, so this is a slight overestimate).');
    if (det) dn.push((qe.f ? 'QE: ' + qe.desc + '. ' : '') + (tr.f ? 'Transmission: ' + tr.desc + '. ' : '') + (wl ? 'Wavelength shifter: ' + fmt(det.absorbed, 4) + ' photons absorbed below ' + wl.cut + ' nm, re-emitted with yield ' + wl.eff + ' and collection ' + wl.coll + ' as a Gaussian at ' + wl.peak + ' ± ' + wl.sigma + ' nm. ' : '') + (qe.f ? 'Mean photoelectrons: ' + fmt(pe, 4) + ' per ' + per + (src === 'mono' ? '; P(≥1 pe) ≈ ' + fmt(1 - Math.exp(-pe), 3) + ' if Poisson.' : '.') : ''));
    if (ang && ang.cos.length) { var mean = 0; ang.cos.forEach(function (c, k) { mean += c * ang.y[k] * 2 / ang.cos.length; }); dn.push('Angular distribution: Monte Carlo of ' + 400 + ' electron histories with Highland multiple scattering (X₀ = ' + m.X0 + ' g/cm²); mean cos θ = ' + fmt(mean, 3) + ' (the ideal cone has cos θ = 1/n = ' + fmt(ang.cosC, 3) + ').'); }
    if (src === 'k40' && C.k40) dn.push(C.k40.note);
    dn.forEach(function (t) { out.appendChild(el('p', null, t)); });
    out.appendChild(el('p', null, 'Source: ' + srcLabel + '. Medium: ' + label + '. Electron threshold at ' + fmt(lam[Math.floor(nl / 2)], 4) + ' nm: ' + fmt(th, 4) + ' keV kinetic energy (n = ' + fmt(tab.nl[Math.floor(nl / 2)], 5) + ').'));
    out.appendChild(formulaBox([
      ['Frank–Tamm', 'd²N / dx dλ = (2π α z² / λ²) (1 − 1 / (β² n(λ)²)),&nbsp; emitted while β n(λ) > 1'],
      ['Along the track', 'dN/dλ (T₀) = ∫<sub>T<sub>th</sub></sub><sup>T₀</sup> (d²N/dx dλ) / (dT/dx) dT,&nbsp; dT/dx: Bethe collision stopping power for electrons (ICRU 37, no density effect) plus an approximate radiative term'],
      ['Threshold', 'T<sub>th</sub> = m<sub>e</sub>c² [1/√(1 − 1/n²) − 1]'],
      ['Spectrum of primaries', 'dN/dλ = ∫ (dN<sub>e</sub>/dT₀) · dN/dλ(T₀) dT₀']]));
    out.appendChild(el('p', 'sx-note', 'Assumes the electron slows down continuously in a uniform medium (delta rays and multiple scattering optional, as above) and ignores the density effect, which matters above a few MeV. Light is counted where it is emitted: absorption on the way out, reflections and the geometry of the sensor are up to the transmission and collection numbers. Normalised per primary electron, per beta, or per decay as labelled.'));
    out.appendChild(formulaBox([['Delta rays', 'dN/dλ += ∫ ds n<sub>e</sub> ∫<sub>T<sub>th</sub></sub><sup>T/2</sup> (dσ<sub>Møller</sub>/dT<sub>δ</sub>) dN/dλ(T<sub>δ</sub>) dT<sub>δ</sub>'],
      ['Multiple scattering (Highland)', 'θ<sub>0</sub> = (13.6 MeV / βpc) √(s/X<sub>0</sub>) per step; photons at cos θ<sub>C</sub> = 1/(βn) around the current direction'],
      ['Detection', 'dN<sub>pe</sub>/dλ = dN/dλ · T(λ) · QE(λ) (λ above the shifter cut) + ε<sub>WLS</sub> f<sub>coll</sub> N<sub>abs</sub> g(λ) QE(λ)']]));
  };
  // QE / transmission curves: x in nm (µm if all < 5), y fraction (% if any > 1.5)
  function curveFrom(text) {
    var c = X.parseXY(text || ''); if (c.x.length < 2) return null;
    var um = Math.max.apply(null, c.x) < 5, pct = Math.max.apply(null, c.y) > 1.5;
    var x = c.x.map(function (v) { return um ? v * 1000 : v; }), y = c.y.map(function (v) { return Math.max(0, pct ? v / 100 : v); });
    return { x: x, y: y, um: um, pct: pct, f: function (l) { return l < x[0] || l > x[x.length - 1] ? 0 : X.lin(x, y, l); } };
  }
  function cCurve(mode) {
    if (mode === 'bialkali') { var bx = BIALKALI.map(function (p) { return p[0]; }), by = BIALKALI.map(function (p) { return p[1]; }); return { f: function (l) { return l < bx[0] || l > bx[bx.length - 1] ? 0 : X.lin(bx, by, l); }, name: 'typical bialkali', desc: 'illustrative bialkali photocathode behind a UV-transmitting window (peak ≈ 31% near 360 nm); upload your sensor\'s curve for real numbers' }; }
    if (mode === 'up') {
      var c = curveFrom($('#c-qe-text').value);
      if (!c) { $('#c-qe-note').textContent = 'No curve yet: upload a file or paste at least two rows.'; return { f: null }; }
      $('#c-qe-note').textContent = 'Read ' + c.x.length + ' points, ' + fmt(c.x[0], 4) + '–' + fmt(c.x[c.x.length - 1], 4) + ' nm' + (c.um ? ' (converted from µm)' : '') + ', QE ' + (c.pct ? 'in %' : 'as a fraction') + ', peak ' + fmt(Math.max.apply(null, c.y) * 100, 3) + '%. Zero outside the curve.';
      return { f: c.f, name: C.qeTextName || 'your curve', desc: 'your curve (' + (C.qeTextName || 'pasted') + ', ' + c.x.length + ' points)' };
    }
    return { f: null };
  }
  function cTrans() {
    var mode = $('#c-tr').value;
    if (mode === 'att') { var L = num('#c-path', 10), A = Math.max(1e-6, num('#c-att', 100)); return { f: function (l) { return Math.exp(-L / (A * Math.pow(l / 400, 4))); }, desc: 'exp(−' + L + ' cm / Λ(λ)), Λ = ' + A + ' cm × (λ/400 nm)⁴' }; }
    if (mode === 'up') { var c = curveFrom(C.trText); if (!c) return { f: null }; return { f: c.f, desc: 'uploaded curve ' + (C.trTextName || '') }; }
    return { f: null };
  }
  // 40K in borosilicate glass: beta (89.28%) + electrons from the 1460.8 keV gamma (10.66%) that interact in the glass
  function k40Electrons() {
    var corr = {}; CORR.forEach(function (c) { corr[c[0]] = c[3]; }); corr.WM = false;
    var sp = P.betaSpectrum({ Z: 20, A: 40, beta: -1, T0: 1311.07, kind: 'U', k: 3, rho: Infinity, corr: corr, n: 600 });
    var comp = CMAT[CMAT.length - 1][1].comp, k2o = Math.max(0, num('#c-k2o', 1)) / 100, fK = k2o * 2 * 39.0983 / 94.196;
    var c2 = {}; Object.keys(comp).forEach(function (e) { c2[e] = comp[e] * (1 - k2o); }); c2.K = fK; c2.O = (c2.O || 0) + k2o - fK;
    var mu = P.xcomMaterial(C.xcom, c2, 1460.8), muT = (mu.incoh + mu.photo + mu.pair) * 2.23, L = 2 * num('#c-gt', 3) / 10, pint = 1 - Math.exp(-muT * L);
    var g = P.gammaSpectrum({ E: 1460.8, comp: c2, xcom: C.xcom, edges: {}, Zof: {}, pesc: 1, fwhm662: 0, bin: 2 });
    var dT = sp.T[1] - sp.T[0], Tmax = 1470, n = Math.ceil(Tmax / dT), T = new Float64Array(n), w = new Float64Array(n);
    for (var i = 0; i < n; i++) T[i] = (i + 0.5) * dT;
    for (i = 0; i < sp.T.length; i++) { var k = Math.floor(sp.T[i] / dT); if (k < n) w[k] += 0.8928 * sp.dNdT[i]; }
    var gb = g.grid[1] - g.grid[0]; for (i = 0; i < g.grid.length; i++) { k = Math.floor(g.grid[i] / dT); if (k < n && k >= 0) w[k] += 0.1066 * pint * g.electrons[i] * gb / dT; }
    var thick = num('#c-gt', 3) / 10, A = 2.23 * thick * fK * 31.6;   // decays per second per cm2 of glass (31.6 Bq per g of natural K)
    return { T: T, w: w, dT: dT, note: '⁴⁰K: β⁻ branch 89.28% (unique third-forbidden shape, endpoint 1311.07 keV); EC branch 10.66% to the 1460.8 keV level, whose gamma interacts in ' + fmt(L * 10, 3) + ' mm of glass with probability ' + fmt(pint, 3) + ' (μ = ' + fmt(muT, 3) + ' /cm). With ' + fmt(k2o * 100, 3) + '% K₂O the glass holds ' + fmt(fK * 100, 3) + '% potassium by mass and has ' + fmt(A, 3) + ' ⁴⁰K decays per second per cm² of window (31.6 Bq per g of natural K). The beta electrons start inside the glass; those near the surface may leave before stopping, which this calculation (a thick medium) ignores.', rate: A };
  }
  function cCSV() { var c = C.last; if (!c) return; var h = ['wavelength_nm', 'photons_per_nm', 'refractive_index'], cols = [c.lam, c.y, c.n]; if (c.yd) { h.push('delta_ray_photons_per_nm'); cols.push(c.yd); } if (c.det) { h.push('detected_per_nm'); cols.push(c.det); }
    download('cherenkov.csv', h, cols, ['Radioactive Signal Explorer: Cherenkov photon spectrum (Frank-Tamm)', 'Source: ' + c.srcLabel + '; medium: ' + c.label, 'Total photons in range: ' + c.total.toPrecision(5)]); }

  /* ---------------------------------------------------------------- start */
  TABS.forEach(function (t) { $('#tab-' + t).addEventListener('click', function () { showTab(t, true); }); });
  var start = (location.hash || '').replace('#', '');
  showTab(TABS.indexOf(start) >= 0 ? start : 'gamma', false);
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { TABS.forEach(function (t) { if (DONE[t] && !$('#panel-' + t).hidden) RUN[t](); }); }, 200); });
})();
