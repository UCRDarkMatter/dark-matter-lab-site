/* Dark matter limit plotter.
 * Reads data/limits.json (written by tools/limits.py). When the page is opened through
 * `python3 tools/limits.py serve`, it also shows the review tools and reads the full database.
 * Curves are stored in GeV and cm^2 and converted to the units chosen for the axes. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Curve colours: the lab's ROOT "dscolors" list, in its order. The light set darkens the
  // yellow, cyan and bright greens so they hold up on white; the dark set swaps black for
  // white and lifts the deep blue, purple and red so they hold up on a dark page.
  var SERIES = {
    light: ['#000000', '#0088EE', '#4C9900', '#6600CC', '#CC6600', '#009999', '#CC0000', '#CC00CC', '#B38F00',
            '#00A040', '#0000CC', '#009E63', '#CC0066', '#5E9E0F', '#850AFF', '#4FA800', '#A347FF'],
    dark: ['#FFFFFF', '#33A0FF', '#66CC00', '#A866FF', '#E88A2E', '#00CCCC', '#FF5252', '#E65CE6', '#FFEE00',
           '#00CC00', '#6F8CFF', '#00CC66', '#FF4D94', '#A3FF47', '#B36BFF', '#85FF0A', '#C08AFF']
  };
  var NCOL = SERIES.light.length;
  // Line style says what kind of curve it is: limits solid, everything forward-looking dashed.
  var KIND_NAME = { limit: 'Exclusion limits', projection: 'Projected sensitivities', discovery: 'Discovery contours', model: 'Model predictions' };
  var KIND_ONE = { limit: 'Limit', projection: 'Projection', discovery: 'Discovery contour', model: 'Model prediction' };
  function dashOf(c) {
    if (c.dash != null) return c.dash;
    if (c.kind === 'projection') return '9 5';
    if (c.kind === 'discovery') return c.sigma === 3 ? '2 3.5' : '5 3';
    if (c.kind === 'model') return '12 3 2 3';
    return '';
  }
  var THEME = {
    light: { bg: '#ffffff', ink: '#1c1c1c', muted: '#5f6368', grid: '#e4e7eb', axis: '#8b8b8b' },
    dark: { bg: '#0d1117', ink: '#e9edf2', muted: '#a3acb8', grid: '#252d39', axis: '#6d7785' }
  };
  var XU = { eV: 1e9, keV: 1e6, MeV: 1e3, GeV: 1, TeV: 1e-3, PeV: 1e-6, g: 1.78266e-24 };   // from GeV
  var YU = { cm2: 1, pb: 1e36, fb: 1e39, zb: 1e45 };                   // from cm^2
  var YU_LABEL = { cm2: 'cm²', pb: 'pb', fb: 'fb', zb: 'zb' };
  var DEFAULTS = { channel: 'SI', title: '', xUnit: 'GeV', yUnit: 'cm2', xMin: '', xMax: '', yMin: '', yMax: '',
    width: 900, height: 600, font: 15, lineWidth: 2, legend: 'tr', bg: 'theme', xLog: true, yLog: true, grid: true, shade: true, unreviewed: false,
    kinds: { limit: true, projection: true, discovery: true, model: true } };
  var KEY = 'dmlimits-settings';
  var REPORT_EMAIL = 'shawn.westerdale@ucr.edu';     // where "Report a problem" sends to
  var REPORT_REPO = 'UCRDarkMatter/dark-matter-lab-site';   // GitHub repository that receives problem reports as issues
  var NOTICE = 'Curves were extracted and labeled automatically from arXiv papers (dark-matter.ucr.edu). ' +
    'Values read from figures are approximate; status "pending" means not checked by a person. Cite the original papers.';

  if (window.innerWidth < 600) { DEFAULTS.width = 560; DEFAULTS.height = 520; DEFAULTS.font = 18; DEFAULTS.legend = 'below'; }   // readable on a phone
  var S = Object.assign({}, DEFAULTS);
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  var DB = { channels: {}, curves: [], awaiting_curves: [] };
  var selected = {};                 // curve id -> { slot, color (optional override) }
  var userCurves = [], userSeq = 0, admin = null, lastSvg = '', drawn = [];

  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function chan() { return DB.channels[S.channel] || { name: S.channel, x: 'Mass', y: 'Limit', y_unit: '' }; }
  function all() { return DB.curves.concat(userCurves); }
  function visible() {
    var q = ($('f-search').value || '').toLowerCase();
    return all().filter(function (c) {
      if (c.channel !== S.channel || S.kinds[c.kind || 'limit'] === false) return false;
      if (!S.unreviewed && c.status === 'pending') return false;
      return !q || [c.label, c.experiment, c.year, c.arxiv_id, c.limit_type, KIND_ONE[c.kind || 'limit']].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function freeSlot() {             // colour follows the curve: lowest unused slot, kept while selected
    var used = {}; Object.keys(selected).forEach(function (k) { used[selected[k].slot] = 1; });
    var i = 0; while (used[i]) i++; return i;
  }
  function styleOf(c) {
    var s = selected[c.id], pal = SERIES[isDark() && S.bg !== 'white' ? 'dark' : 'light'];
    return { color: s.color || pal[s.slot % NCOL], dash: dashOf(c) };
  }
  function toggle(c, on) { if (on) { if (!selected[c.id]) selected[c.id] = { slot: freeSlot() }; } else delete selected[c.id]; }
  function fx() { return XU[S.xUnit] || 1; }
  function fy() { return chan().y_unit === 'cm2' ? (YU[S.yUnit] || 1) : 1; }
  function num(v) { var n = parseFloat(String(v).replace(/×10\^?/, 'e')); return isFinite(n) ? n : null; }
  function sup(n) { return String(n).replace(/[-0-9]/g, function (d) { return '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(d)]; }); }
  function fmt(v) {
    if (v === 0) return '0';
    var e = Math.floor(Math.log10(Math.abs(v)));
    if (e >= -2 && e < 5) return String(+v.toPrecision(3));
    var m = +(v / Math.pow(10, e)).toPrecision(3);
    return (m === 1 ? '' : m + '×') + '10' + sup(e);
  }

  // ---------------------------------------------------------------- curve list
  function drawList() {
    var host = $('curve-list'); host.textContent = '';
    var list = visible(), exp = null, kind = null, ORDER = ['limit', 'projection', 'discovery', 'model'];
    if (!list.length) {
      var hiddenHere = all().filter(function (c) { return c.channel === S.channel && c.status === 'pending'; }).length;
      host.innerHTML = '<p class="empty">' + (hiddenHere && !S.unreviewed
        ? hiddenHere + ' curves of this type are waiting for review. Tick “Include unreviewed curves” to see them.'
        : 'No curves of this type yet.') + '</p>';
      return;
    }
    list.sort(function (a, b) {
      return ORDER.indexOf(a.kind || 'limit') - ORDER.indexOf(b.kind || 'limit') || (a.experiment || '').localeCompare(b.experiment || '') || (b.year || 0) - (a.year || 0);
    });
    list.forEach(function (c) {
      if ((c.kind || 'limit') !== kind) {
        kind = c.kind || 'limit'; exp = null;
        var kh = document.createElement('div'); kh.className = 'kind-head'; kh.textContent = KIND_NAME[kind]; host.appendChild(kh);
      }
      if (c.experiment !== exp) { exp = c.experiment; var h = document.createElement('div'); h.className = 'exp-head'; h.textContent = exp || 'Other'; host.appendChild(h); }
      var row = document.createElement('label'); row.className = 'curve-row';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!selected[c.id];
      cb.addEventListener('change', function () { toggle(c, cb.checked); refresh(); });
      var name = document.createElement('span');
      name.innerHTML = esc(c.label) + (c.year ? ' <small>' + esc(c.year) + '</small>' : '') +
        (c.status === 'pending' ? ' <span class="badge warn">unreviewed</span>' : '') +
        (c.source === 'ai' && c.status !== 'pending' ? ' <span class="badge">digitized</span>' : '') +
        (c.source === 'user' ? ' <span class="badge">yours</span>' : '');
      row.appendChild(cb); row.appendChild(name);
      if (selected[c.id]) {
        var col = document.createElement('input'); col.type = 'color'; col.value = styleOf(c).color; col.setAttribute('aria-label', 'Colour for ' + c.label);
        col.addEventListener('input', function () { selected[c.id].color = col.value; draw(); drawTable(); });
        row.appendChild(col);
      } else row.appendChild(document.createElement('span'));
      host.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- plot
  function niceLinear(lo, hi) {
    var span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / 5)));
    [1, 2, 5, 10].some(function (m) { if (span / (step * m) <= 7) { step *= m; return true; } });
    var t = [], v = Math.ceil(lo / step) * step;
    for (; v <= hi + step * 1e-9; v += step) t.push(+v.toPrecision(12));
    return t;
  }
  function axis(log, lo, hi) {      // returns scale helpers for one axis
    if (log) {
      var a = Math.log10(lo), b = Math.log10(hi), ticks = [], minor = [];
      var every = Math.max(1, Math.ceil((b - a) / 9));
      for (var e = Math.ceil(a - 1e-9); e <= b + 1e-9; e++) {
        if ((e - Math.ceil(a - 1e-9)) % every === 0) ticks.push(Math.pow(10, e));
      }
      if (b - a <= 12) for (var d = Math.floor(a); d <= b; d++) for (var k = 2; k < 10; k++) { var v = k * Math.pow(10, d); if (v >= lo && v <= hi) minor.push(v); }
      return { t: function (v) { return (Math.log10(v) - a) / (b - a); }, ticks: ticks, minor: minor, label: function (v) { return '10' + sup(Math.round(Math.log10(v))); } };
    }
    return { t: function (v) { return (v - lo) / (hi - lo); }, ticks: niceLinear(lo, hi), minor: [], label: fmt };
  }
  function ranges(curves) {
    var xs = [], ys = [];
    curves.forEach(function (c) { c.pts.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    function one(vals, log, lo, hi, fallback) {
      var a = vals.length ? Math.min.apply(null, vals) : fallback[0], b = vals.length ? Math.max.apply(null, vals) : fallback[1];
      if (log) { a = Math.pow(10, Math.floor(Math.log10(a) + 1e-9)); b = Math.pow(10, Math.ceil(Math.log10(b) - 1e-9)); if (a === b) b = a * 10; }
      else { var pad = (b - a) * 0.05 || 1; a -= pad; b += pad; }
      if (lo !== null && (!log || lo > 0)) a = lo;
      if (hi !== null && (!log || hi > 0)) b = hi;
      if (!(b > a)) b = log ? a * 10 : a + 1;
      return [a, b];
    }
    return { x: one(xs, S.xLog, num(S.xMin), num(S.xMax), [1 * fx(), 1e4 * fx()]),
             y: one(ys, S.yLog, num(S.yMin), num(S.yMax), [1e-48 * fy(), 1e-40 * fy()]) };
  }
  function draw() {
    var th = THEME[isDark() && S.bg !== 'white' ? 'dark' : 'light'];
    var W = Math.max(300, +S.width || 900), H = Math.max(200, +S.height || 600), F = Math.max(8, +S.font || 15), LW = +S.lineWidth || 2;
    var curves = all().filter(function (c) { return selected[c.id] && c.channel === S.channel; }).map(function (c) {
      var kx = c.source === 'user' ? 1 : fx(), ky = c.source === 'user' ? 1 : fy();
      var pts = c.points.map(function (p) { return [p[0] * kx, p[1] * ky]; }).filter(function (p) { return (!S.xLog || p[0] > 0) && (!S.yLog || p[1] > 0); });
      return { c: c, pts: pts, st: styleOf(c), region: c.shape === 'region', kind: c.kind || 'limit' };
    });
    var legendRows = S.legend === 'none' ? 0 : curves.length, rowH = F * 1.45;
    var below = S.legend === 'below' ? legendRows * rowH + F : 0;
    var m = { l: F * 5.2, r: F * 1.4, t: (S.title ? F * 2.6 : F * 1.3), b: F * 3.9 + below };
    var pw = W - m.l - m.r, ph = H - m.t - m.b, R = ranges(curves);
    var ax = axis(S.xLog, R.x[0], R.x[1]), ay = axis(S.yLog, R.y[0], R.y[1]);
    function X(v) { return m.l + ax.t(v) * pw; }
    function Y(v) { return m.t + (1 - ay.t(v)) * ph; }
    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" font-family="Roboto, Arial, sans-serif" font-size="' + F + '" role="img" aria-label="' + esc(chan().name) + ' exclusion limits">');
    if (S.bg !== 'none') o.push('<rect width="' + W + '" height="' + H + '" fill="' + (S.bg === 'white' ? '#ffffff' : th.bg) + '"/>');
    o.push('<defs><clipPath id="clip"><rect x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '"/></clipPath></defs>');
    if (S.grid) {
      ax.ticks.forEach(function (v) { o.push('<line x1="' + X(v) + '" x2="' + X(v) + '" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="' + th.grid + '"/>'); });
      ay.ticks.forEach(function (v) { o.push('<line y1="' + Y(v) + '" y2="' + Y(v) + '" x1="' + m.l + '" x2="' + (m.l + pw) + '" stroke="' + th.grid + '"/>'); });
    }
    // curves (shading first so lines stay on top)
    o.push('<g clip-path="url(#clip)">');
    var paths = curves.map(function (k) {
      return k.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join('');
    });
    curves.forEach(function (k, i) {            // model regions: filled outlines, under everything else
      if (k.region && k.pts.length > 2) o.push('<path d="' + paths[i] + 'Z" fill="' + k.st.color + '" fill-opacity="0.2" stroke="' + k.st.color + '" stroke-width="' + Math.max(1, LW * 0.6) + '" stroke-linejoin="round"/>');
    });
    if (S.shade) curves.forEach(function (k, i) {
      if (k.pts.length < 2 || k.kind !== 'limit' || k.region || k.c.shape === 'path' || /^UHDM/.test(k.c.channel)) return;   // islands have an upper edge too
      o.push('<path d="' + paths[i] + 'L' + X(k.pts[k.pts.length - 1][0]).toFixed(1) + ' ' + (m.t - 5) + 'L' + X(k.pts[0][0]).toFixed(1) + ' ' + (m.t - 5) + 'Z" fill="' + k.st.color + '" fill-opacity="0.07"/>');
    });
    curves.forEach(function (k, i) {
      if (k.region) return;
      var dash = k.st.dash.split(' ').map(function (d) { return d * LW / 2; }).join(' ');
      o.push('<path d="' + paths[i] + '" fill="none" stroke="' + k.st.color + '" stroke-width="' + LW + '" stroke-linejoin="round"' + (k.c.status === 'pending' ? ' stroke-opacity="0.55"' : '') + (k.st.dash ? ' stroke-dasharray="' + dash + '"' : ' stroke-linecap="round"') + '/>');
    });
    o.push('</g>');
    // frame, ticks, labels
    o.push('<rect x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '" fill="none" stroke="' + th.axis + '"/>');
    ax.minor.forEach(function (v) { o.push('<line x1="' + X(v) + '" x2="' + X(v) + '" y1="' + (m.t + ph) + '" y2="' + (m.t + ph - 4) + '" stroke="' + th.axis + '"/>'); });
    ay.minor.forEach(function (v) { o.push('<line y1="' + Y(v) + '" y2="' + Y(v) + '" x1="' + m.l + '" x2="' + (m.l + 4) + '" stroke="' + th.axis + '"/>'); });
    ax.ticks.forEach(function (v) {
      o.push('<line x1="' + X(v) + '" x2="' + X(v) + '" y1="' + (m.t + ph) + '" y2="' + (m.t + ph - 8) + '" stroke="' + th.axis + '"/>');
      o.push('<text x="' + X(v) + '" y="' + (m.t + ph + F * 1.3) + '" text-anchor="middle" fill="' + th.muted + '">' + ax.label(v) + '</text>');
    });
    ay.ticks.forEach(function (v) {
      o.push('<line y1="' + Y(v) + '" y2="' + Y(v) + '" x1="' + m.l + '" x2="' + (m.l + 8) + '" stroke="' + th.axis + '"/>');
      o.push('<text x="' + (m.l - F * 0.5) + '" y="' + (Y(v) + F * 0.35) + '" text-anchor="end" fill="' + th.muted + '">' + ay.label(v) + '</text>');
    });
    var ch = chan(), yUnit = ch.y_unit === 'cm2' ? ' [' + YU_LABEL[S.yUnit] + ']' : '';
    o.push('<text x="' + (m.l + pw / 2) + '" y="' + (m.t + ph + F * 3) + '" text-anchor="middle" fill="' + th.ink + '">' + esc(ch.x) + ' [' + esc(S.xUnit) + (S.xUnit === 'g' ? '' : '/c²') + ']</text>');
    o.push('<text transform="translate(' + (F * 1.2) + ' ' + (m.t + ph / 2) + ') rotate(-90)" text-anchor="middle" fill="' + th.ink + '">' + esc(ch.y) + yUnit + '</text>');
    if (S.title) o.push('<text x="' + (m.l + pw / 2) + '" y="' + (F * 1.7) + '" text-anchor="middle" font-weight="700" font-size="' + (F * 1.15) + '" fill="' + th.ink + '">' + esc(S.title) + '</text>');
    if (!curves.length) o.push('<text x="' + (m.l + pw / 2) + '" y="' + (m.t + ph / 2) + '" text-anchor="middle" fill="' + th.muted + '">Tick one or more curves to plot them</text>');
    // legend
    if (legendRows) {
      var labels = curves.map(function (k) { return k.c.label + (k.c.status === 'pending' ? ' (unreviewed)' : ''); });
      var lw = Math.min(pw - 16, Math.max.apply(null, labels.map(function (l) { return l.length; })) * F * 0.56 + F * 3.4), lh = legendRows * rowH + F * 0.7;
      var lx = S.legend === 'below' ? m.l : (S.legend[1] === 'r' ? m.l + pw - lw - 8 : m.l + 8);
      var ly = S.legend === 'below' ? m.t + ph + F * 3.6 : (S.legend[0] === 't' ? m.t + 8 : m.t + ph - lh - 8);
      if (S.legend !== 'below') o.push('<rect x="' + lx + '" y="' + ly + '" width="' + lw + '" height="' + lh + '" rx="4" fill="' + (S.bg === 'white' ? '#ffffff' : th.bg) + '" fill-opacity="0.88" stroke="' + th.grid + '"/>');
      curves.forEach(function (k, i) {
        var yy = ly + F * 0.35 + rowH * (i + 0.5), dash = k.st.dash;
        if (k.region) o.push('<rect x="' + (lx + F * 0.6) + '" y="' + (yy - F * 0.4) + '" width="' + (F * 2) + '" height="' + (F * 0.8) + '" fill="' + k.st.color + '" fill-opacity="0.25" stroke="' + k.st.color + '"/>');
        else o.push('<line x1="' + (lx + F * 0.6) + '" x2="' + (lx + F * 2.6) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + k.st.color + '" stroke-width="' + Math.max(LW, 2) + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>');
        o.push('<text x="' + (lx + F * 3.1) + '" y="' + (yy + F * 0.35) + '" fill="' + th.ink + '">' + esc(labels[i]) + '</text>');
      });
    }
    o.push('<circle id="hover-dot" r="5" fill="none" stroke-width="2" visibility="hidden"/></svg>');
    lastSvg = o.join('');
    $('plot').innerHTML = lastSvg;
    drawn = { curves: curves, X: X, Y: Y, W: W, H: H };
  }
  function hover(ev) {
    var svg = $('plot').firstChild, tip = $('tip');
    if (!svg || !drawn.curves) return;
    var box = svg.getBoundingClientRect(), k = drawn.W / box.width;
    var px = (ev.clientX - box.left) * k, py = (ev.clientY - box.top) * k, best = null, bd = 28 * k;
    drawn.curves.forEach(function (c) {
      c.pts.forEach(function (p) {
        var d = Math.hypot(drawn.X(p[0]) - px, drawn.Y(p[1]) - py);
        if (d < bd) { bd = d; best = { c: c, p: p }; }
      });
    });
    var dot = svg.querySelector('#hover-dot');
    if (!best) { tip.hidden = true; dot.setAttribute('visibility', 'hidden'); return; }
    dot.setAttribute('cx', drawn.X(best.p[0])); dot.setAttribute('cy', drawn.Y(best.p[1]));
    dot.setAttribute('stroke', best.c.st.color); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.textContent = best.c.c.label + ':  ' + fmt(best.p[0]) + ' ' + S.xUnit + ',  ' + fmt(best.p[1]) + (chan().y_unit === 'cm2' ? ' ' + YU_LABEL[S.yUnit] : '');
    var wrap = $('plot-wrap').getBoundingClientRect();
    tip.style.left = Math.min(Math.max(drawn.X(best.p[0]) / k, 90), wrap.width - 90) + 'px';
    tip.style.top = Math.max(drawn.Y(best.p[1]) / k, 34) + 'px';
  }

  // ---------------------------------------------------------------- table + downloads
  function chosen() { return all().filter(function (c) { return selected[c.id] && c.channel === S.channel; }); }
  function drawTable() {
    var rows = chosen(), t = $('sel-table');
    if (!rows.length) { t.innerHTML = '<tr><td class="muted">Nothing selected.</td></tr>'; return; }
    t.innerHTML = '<tr><th>Curve</th><th>Kind</th><th>Details</th><th>Source</th><th>Points</th><th>Paper</th><th></th></tr>' + rows.map(function (c) {
      var st = styleOf(c), src = { hepdata: 'HEPData', ancillary: 'arXiv data file', figure: 'Read from the vector figure', ai: 'Digitized by AI', manual: 'Digitized by hand', demo: 'Demo', user: 'Your data' }[c.source] || c.source;
      return '<tr><td><span class="swatch" style="border-color:' + st.color + '"></span>' + esc(c.label) + '</td><td>' + esc(KIND_ONE[c.kind || 'limit']) + (c.sigma ? ' (' + c.sigma + 'σ)' : '') + '</td><td>' + esc(c.limit_type) + '</td><td>' +
        (c.source_url ? '<a href="' + esc(c.source_url) + '">' + esc(src) + '</a>' : esc(src)) + (c.status === 'pending' ? ' <span class="badge warn">unreviewed</span>' : '') +
        (c.notes ? '<br><small class="muted">' + esc(c.notes) + '</small>' : '') + '</td><td>' + c.points.length + '</td><td>' +
        (c.arxiv_id ? '<a href="https://arxiv.org/abs/' + esc(c.arxiv_id) + '">arXiv:' + esc(c.arxiv_id) + '</a>' : '') + '</td><td>' +
        (c.source === 'user' ? '' : '<button class="mini" type="button" data-report="' + esc(c.id) + '">Report a problem</button>') + '</td></tr>';
    }).join('');
  }

  // ---------------------------------------------------------------- problem reports (sent by the visitor's own email)
  var reporting = null;                      // the curve being reported, or null for a general report
  function reportText() {
    var c = reporting, lines = ['What is wrong: ' + $('rp-what').value, '', 'Details:', $('rp-text').value.trim() || '(none given)', ''];
    if (c) {
      lines.push('Curve: ' + c.label, 'Curve number: ' + c.id, 'Plot type: ' + (DB.channels[c.channel] ? DB.channels[c.channel].name : c.channel),
        'Kind: ' + KIND_ONE[c.kind || 'limit'] + (c.sigma ? ' (' + c.sigma + 'σ)' : ''), 'Experiment: ' + (c.experiment || ''),
        'Paper: ' + (c.arxiv_id ? 'https://arxiv.org/abs/' + c.arxiv_id : '(none)'), 'Source: ' + c.source + ', status ' + c.status);
    }
    lines.push('Page: ' + location.href.split('#')[0]);
    return lines.join('\n');
  }
  function reportUpdate() {
    var subject = 'Limit plotter: ' + (reporting ? 'problem with "' + reporting.label + '" (curve ' + reporting.id + ')' : $('rp-what').value);
    $('rp-mail').href = 'mailto:' + REPORT_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(reportText());
    var md = reportText().split('\n').map(function (l) { return /^(Curve|Curve number|Plot type|Kind|Experiment|Paper|Source|Page):/.test(l) ? '- ' + l : l; }).join('\n');
    $('rp-issue').href = 'https://github.com/' + REPORT_REPO + '/issues/new?template=curve-problem.md&labels=curve-correction&title=' +
      encodeURIComponent(subject) + '&body=' + encodeURIComponent(md);
  }
  function openReport(c) {
    reporting = c || null;
    $('report-h').textContent = c ? 'Report a problem with this curve' : 'Report a problem';
    $('rp-about').textContent = c ? c.label + (c.arxiv_id ? ' · arXiv:' + c.arxiv_id : '') + ' · curve #' + c.id
      : 'For a missing paper or curve, or anything else about the plotter.';
    if (!c) $('rp-what').value = 'A paper or curve is missing';
    $('rp-addr').textContent = REPORT_EMAIL;
    $('report').hidden = false; reportUpdate();
    $('report').scrollIntoView({ block: 'center' }); $('rp-text').focus();
  }
  function csv() {
    var yu = chan().y_unit === 'cm2' ? S.yUnit : 'unitless';
    var out = ['curve,kind,sigma,shape,experiment,year,channel,arxiv_id,source,status,mass_' + S.xUnit + ',limit_' + yu];
    chosen().forEach(function (c) {
      var kx = c.source === 'user' ? 1 : fx(), ky = c.source === 'user' ? 1 : fy();
      c.points.forEach(function (p) {
        out.push(['"' + String(c.label).replace(/"/g, '""') + '"', c.kind || 'limit', c.sigma || '', c.shape || 'line', '"' + (c.experiment || '') + '"', c.year || '', c.channel, c.arxiv_id || '', c.source, c.status || '',
          (p[0] * kx).toPrecision(6), (p[1] * ky).toPrecision(6)].join(','));
      });
    });
    return out.join('\n') + '\n';
  }
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function png() {
    var img = new Image(), scale = 2;
    img.onload = function () {
      var cv = document.createElement('canvas'); cv.width = drawn.W * scale; cv.height = drawn.H * scale;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(function (b) { if (b) download('dm-limits-' + S.channel + '.png', b); });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(lastSvg);
  }

  // ---------------------------------------------------------------- settings wiring
  var FIELDS = ['title', 'xUnit', 'yUnit', 'xMin', 'xMax', 'yMin', 'yMax', 'width', 'height', 'font', 'lineWidth', 'legend', 'bg', 'xLog', 'yLog', 'grid', 'shade'];
  function fill() {
    FIELDS.forEach(function (f) { var n = $('s-' + f); if (n.type === 'checkbox') n.checked = !!S[f]; else n.value = S[f]; });
    $('f-unreviewed').checked = !!S.unreviewed;
    $('s-yUnit').disabled = chan().y_unit !== 'cm2';
  }
  function refresh() { drawList(); draw(); drawTable(); }
  function wire() {
    FIELDS.forEach(function (f) {
      var n = $('s-' + f);
      n.addEventListener(n.tagName === 'SELECT' || n.type === 'checkbox' ? 'change' : 'input', function () {
        S[f] = n.type === 'checkbox' ? n.checked : n.value;
        if (f === 'xUnit' || f === 'yUnit') { S.xMin = S.xMax = S.yMin = S.yMax = ''; fill(); }   // typed ranges were in the old unit
        save(); draw(); drawTable();
      });
    });
    $('f-channel').addEventListener('change', function () {
      S.channel = this.value; S.xMin = S.xMax = S.yMin = S.yMax = ''; selected = {};
      save(); fill(); preselect(); refresh();
    });
    $('f-search').addEventListener('input', drawList);
    $('pub-search').addEventListener('input', drawPublished);
    $('rev-issues').addEventListener('click', function (ev) {
      var id = ev.target.getAttribute && ev.target.getAttribute('data-find');
      if (!id) return;
      $('pub-box').open = true; $('pub-search').value = id; drawPublished(); $('pub-box').scrollIntoView();
    });
    Object.keys(DEFAULTS.kinds).forEach(function (k) {
      var n = $('k-' + k); n.checked = S.kinds[k] !== false;
      n.addEventListener('change', function () {
        S.kinds[k] = n.checked; save();
        if (!n.checked) all().forEach(function (c) { if ((c.kind || 'limit') === k) delete selected[c.id]; });
        refresh();
      });
    });
    $('f-unreviewed').addEventListener('change', function () {
      S.unreviewed = this.checked; save();
      if (!S.unreviewed) all().forEach(function (c) { if (c.status === 'pending') delete selected[c.id]; });
      setData(DB); fill(); refresh();
    });
    $('b-all').addEventListener('click', function () { visible().forEach(function (c) { toggle(c, true); }); refresh(); });
    $('b-none').addEventListener('click', function () { selected = {}; refresh(); });
    $('s-reset').addEventListener('click', function () { var ch = S.channel, kinds = S.kinds; S = Object.assign({}, DEFAULTS, { channel: ch, kinds: kinds }); save(); fill(); refresh(); });
    $('u-add').addEventListener('click', function () {
      var pts = $('u-data').value.split(/\n/).map(function (l) { return l.trim().split(/[,\s;]+/).map(parseFloat); })
        .filter(function (p) { return p.length >= 2 && p[0] > 0 && p[1] > 0; }).map(function (p) { return [p[0], p[1]]; });
      var as = $('u-as').value;                 // limit | projection | region
      if (pts.length < (as === 'region' ? 3 : 2)) { $('u-data').focus(); return; }
      if (as !== 'region') pts.sort(function (a, b) { return a[0] - b[0]; });
      var c = { id: 'u' + (++userSeq), label: $('u-label').value || 'My curve ' + userSeq, experiment: 'Your curves', channel: S.channel, source: 'user', status: 'approved', points: pts,
        kind: as === 'region' ? 'model' : as, shape: as === 'region' ? 'region' : 'line', limit_type: '', notes: 'Entered in ' + S.xUnit + (chan().y_unit === 'cm2' ? ' and ' + YU_LABEL[S.yUnit] : '') };
      userCurves.push(c); toggle(c, true); $('u-data').value = ''; refresh();
    });
    $('d-svg').addEventListener('click', function () { download('dm-limits-' + S.channel + '.svg', lastSvg, 'image/svg+xml'); });
    $('d-png').addEventListener('click', png);
    $('d-csv').addEventListener('click', function () { download('dm-limits-' + S.channel + '.csv', csv(), 'text/csv'); });
    $('d-json').addEventListener('click', function () { download('dm-limits-' + S.channel + '.json', JSON.stringify({ notice: NOTICE, units: { mass: 'GeV', limit: chan().y_unit || 'unitless' }, curves: chosen() }, null, 1), 'application/json'); });
    $('sel-table').addEventListener('click', function (ev) {
      var id = ev.target.getAttribute && ev.target.getAttribute('data-report');
      if (id) openReport(all().filter(function (c) { return String(c.id) === id; })[0]);
    });
    $('report-general').addEventListener('click', function () { openReport(null); });
    $('rp-what').addEventListener('change', reportUpdate);
    $('rp-text').addEventListener('input', reportUpdate);
    $('rp-close').addEventListener('click', function () { $('report').hidden = true; });
    $('rp-copy').addEventListener('click', function () {
      var b = this, text = 'To: ' + REPORT_EMAIL + '\n\n' + reportText();
      try { navigator.clipboard.writeText(text).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy report'; }, 1500); }, function () {}); } catch (e) {}
    });
    $('d-copy').addEventListener('click', function () {
      var b = this;
      try { navigator.clipboard.writeText(csv()).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy CSV'; }, 1500); }, function () {}); } catch (e) {}
    });
    $('plot-wrap').addEventListener('mousemove', hover);
    $('plot-wrap').addEventListener('mouseleave', function () { $('tip').hidden = true; });
    new MutationObserver(function () { draw(); drawList(); drawTable(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  function preselect() {            // open with the newest result of each experiment ticked
    var seen = {};
    visible().sort(function (a, b) { return (b.year || 0) - (a.year || 0); }).forEach(function (c) {
      if ((c.kind || 'limit') === 'limit' && !seen[c.experiment] && Object.keys(selected).length < 6) { seen[c.experiment] = 1; toggle(c, true); }
    });
  }
  function setData(d) {
    DB = d;
    var sel = $('f-channel'), counts = {};
    var shown = function (c) { return S.unreviewed || c.status !== 'pending'; };
    d.curves.forEach(function (c) { if (shown(c)) counts[c.channel] = (counts[c.channel] || 0) + 1; });
    sel.textContent = '';
    Object.keys(d.channels).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = d.channels[k].name + ' (' + (counts[k] || 0) + ')'; sel.appendChild(o);
    });
    if (!d.channels[S.channel]) S.channel = Object.keys(d.channels)[0];
    if (!counts[S.channel]) {                           // open on a plot type that has something to show
      var any = Object.keys(d.channels).filter(function (k) { return counts[k]; })[0];
      if (any) S.channel = any;
    }
    sel.value = S.channel;
    var n = $('lim-notice');
    var pending = d.curves.filter(function (c) { return c.status === 'pending'; }).length;
    var reviewed = d.curves.length - pending;
    n.hidden = !d.demo && !(pending && !reviewed);
    if (!d.demo && pending && !reviewed) n.textContent = pending + ' curves have been collected and are waiting for review; none is approved yet. Tick “Include unreviewed curves” to look at them.';
    if (d.demo) n.textContent = 'Demo data: these curves are synthetic examples, not real results. They disappear after the first run of the updater on your server.';
    var aw = d.awaiting_curves || [];
    $('awaiting').hidden = !aw.length;
    $('awaiting-list').innerHTML = aw.slice(0, 60).map(function (p) { return '<li><a href="https://arxiv.org/abs/' + esc(p.arxiv_id) + '">' + esc(p.title) + '</a> <small class="muted">' + esc(p.experiment) + ', ' + esc(p.published) + '</small></li>'; }).join('');
  }

  // ---------------------------------------------------------------- review tools (only on `limits.py serve`)
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Limits-Admin': '1' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j.error) throw new Error(j.error);
        if (j.warning) { var s = document.querySelector('#admin .steps'); if (s) { s.textContent = j.warning; s.classList.add('warn-box'); } }
        return j;
      });
  }
  function reload() {
    return fetch('/api/state', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (txt) {
      var st;
      try { st = JSON.parse(txt); } catch (e) { throw new Error('/api/state is not valid JSON (' + e.message + ')'); }
      admin = st;
      var live = st.curves.filter(function (c) { return c.status !== 'rejected'; });
      setData({ channels: st.channels, curves: live, awaiting_curves: [], demo: live.some(function (c) { return c.source === 'demo'; }) });
      fill(); if (!Object.keys(selected).length) preselect(); refresh();
      try { drawAdmin(); } catch (e) {            // a fault in the review tools must not take the plot down with it
        $('admin').hidden = false;
        $('rev-curves').innerHTML = '<p class="notice">The review tools hit an error: ' + esc(e.message) + '. If you updated only some files, replace Limits.html and assets/limits.js together.</p>';
      }
    });
  }
  function chanOptions(sel) { return Object.keys(DB.channels).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(DB.channels[k].name) + '</option>'; }).join(''); }
  function kindOptions(sel) { return Object.keys(KIND_ONE).map(function (k) { return '<option value="' + k + '"' + (k === (sel || 'limit') ? ' selected' : '') + '>' + KIND_ONE[k] + '</option>'; }).join(''); }
  // Editor for one curve: the same fields for every place a curve can be corrected.
  function editor(c, buttons) {
    var d = document.createElement('div'); d.className = 'rev';
    d.innerHTML = '<div class="settings">' +
      '<label>Name<input type="text" data-f="label" value="' + esc(c.label) + '"></label>' +
      '<label>Experiment<input type="text" data-f="experiment" value="' + esc(c.experiment) + '"></label>' +
      '<label>Year<input type="text" inputmode="numeric" data-f="year" value="' + esc(c.year || '') + '"></label>' +
      '<label>Plot type<select data-f="channel">' + chanOptions(c.channel) + '</select></label>' +
      '<label>Kind<select data-f="kind">' + kindOptions(c.kind) + '</select></label>' +
      '<label>Sigma (discovery)<select data-f="sigma"><option value="">n/a</option><option' + (c.sigma === 3 ? ' selected' : '') + '>3</option><option' + (c.sigma === 5 ? ' selected' : '') + '>5</option></select></label>' +
      '<label>Details<input type="text" data-f="limit_type" value="' + esc(c.limit_type) + '"></label></div>' +
      '<small class="muted">#' + c.id + ' · ' + esc(c.status) + ' · ' + esc(c.source) + (c.arxiv_id ? ' · arXiv:' + esc(c.arxiv_id) : '') + ' · ' + esc(c.notes) + '</small>' +
      '<div class="row tight">' + buttons + '<span class="muted" data-msg style="font-size:.85rem"></span></div>';
    d.values = function () {
      var body = { id: c.id, shape: c.shape || 'line' };
      Array.prototype.forEach.call(d.querySelectorAll('[data-f]'), function (n) { body[n.getAttribute('data-f')] = n.value; });
      body.sigma = parseInt(body.sigma, 10) || null;
      return body;
    };
    d.say = function (msg) { d.querySelector('[data-msg]').textContent = msg; };
    return d;
  }
  function drawPublished() {
    var host = $('rev-published'); if (!host || !admin) return;
    var pub = admin.curves.filter(function (c) { return c.status === 'approved' || c.status === 'auto'; });
    $('n-published').textContent = '(' + pub.length + ')';
    var q = ($('pub-search').value || '').toLowerCase();
    var hits = pub.filter(function (c) { return !q || [c.label, c.experiment, c.year, c.arxiv_id, c.id].join(' ').toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (b.year || 0) - (a.year || 0) || a.id - b.id; });
    host.textContent = '';
    if (!hits.length) { host.innerHTML = '<p class="empty">' + (pub.length ? 'No published curve matches.' : 'Nothing published yet.') + '</p>'; return; }
    hits.slice(0, 40).forEach(function (c) {
      var open = issuesFor(c.id);
      var d = editor(c, (open.length ? open.map(function (i) { return '<a class="badge warn" href="' + esc(i.html_url) + '" target="_blank" rel="noopener">report #' + i.number + '</a>'; }).join(' ') + ' ' : '') +
        '<button class="mini" data-a="save" type="button">Save changes</button>' +
        '<button class="mini" data-a="show" type="button">Show on plot</button>' +
        '<button class="mini" data-a="pending" type="button">Move back to review</button>' +
        '<button class="mini" data-a="rejected" type="button">Reject</button>');
      d.addEventListener('click', function (ev) {
        var a = ev.target.getAttribute && ev.target.getAttribute('data-a'); if (!a) return;
        if (a === 'show') { S.channel = c.channel; $('f-channel').value = S.channel; toggle(c, true); fill(); refresh(); $('plot-wrap').scrollIntoView({ block: 'center' }); return; }
        var body = a === 'save' ? Object.assign(d.values(), { status: 'approved' }) : { id: c.id, status: a };
        ev.target.disabled = true;
        post('/api/curve', body).then(function () { return reload(); })
          .catch(function (e) { ev.target.disabled = false; d.say('Not saved: ' + e.message); });
      });
      host.appendChild(d);
    });
    if (hits.length > 40) host.insertAdjacentHTML('beforeend', '<p class="muted">Showing 40 of ' + hits.length + '. Type more to narrow the list.</p>');
  }
  // Open problem reports from GitHub, shown on the review page (public API, no sign-in needed).
  var issues = null;
  function loadIssues() {
    if (issues !== null) return;
    issues = [];
    fetch('https://api.github.com/repos/' + REPORT_REPO + '/issues?state=open&per_page=100', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { if (!r.ok) throw new Error('GitHub answered ' + r.status); return r.json(); })
      .then(function (list) {
        issues = list.filter(function (i) { return !i.pull_request; });
        drawIssues();
        if (admin) drawPublished();
      })
      .catch(function (e) { $('rev-issues').innerHTML = '<p class="empty">Could not read the problem reports: ' + esc(e.message) + '</p>'; });
  }
  function issuesFor(id) {
    var rx = new RegExp('curve (number:? )?' + id + '\\b', 'i');
    return (issues || []).filter(function (i) { return rx.test(i.title) || rx.test(i.body || ''); });
  }
  function drawIssues() {
    $('n-issues').textContent = '(' + issues.length + ')';
    $('rev-issues').innerHTML = issues.length ? issues.map(function (i) {
      var m = (i.title + ' ' + (i.body || '')).match(/curve (?:number:? )?(\d+)/i);
      return '<div class="rev"><div><a href="' + esc(i.html_url) + '" target="_blank" rel="noopener">#' + i.number + ' ' + esc(i.title) + '</a> <small class="muted">opened ' +
        esc((i.created_at || '').slice(0, 10)) + ' by ' + esc(i.user ? i.user.login : '') + '</small></div>' +
        (m ? '<div class="row tight"><button class="mini" type="button" data-find="' + m[1] + '">Find curve ' + m[1] + '</button></div>' : '') + '</div>';
    }).join('') : '<p class="empty">No open reports.</p>';
  }
  function drawAdmin() {
    $('admin').hidden = false;
    var pend = admin.curves.filter(function (c) { return c.status === 'pending'; });
    $('n-pending').textContent = '(' + pend.length + ')';
    var host = $('rev-curves'); host.textContent = '';
    if (!pend.length) host.innerHTML = '<p class="empty">Nothing waiting.</p>';
    pend.sort(function (a, b) { return (b.arxiv_id || '').localeCompare(a.arxiv_id || '') || a.id - b.id; });
    var lastPaper = null;
    pend.forEach(function (c) {
      if (c.arxiv_id && c.arxiv_id !== lastPaper) {            // one header per paper, with bulk actions
        lastPaper = c.arxiv_id;
        var mine = pend.filter(function (x) { return x.arxiv_id === c.arxiv_id; });
        var paper = (admin.papers.filter(function (p) { return p.arxiv_id === c.arxiv_id; })[0] || {});
        var h = document.createElement('div'); h.className = 'rev paper-head';
        var own = mine.filter(function (x) { return x.own; });
        h.innerHTML = '<div><b>arXiv:' + esc(c.arxiv_id) + '</b> ' + esc(paper.title || '') + ' <small class="muted">' + mine.length + ' candidate curves' +
          (own.length ? ', ' + own.length + ' judged to be this paper’s own' : '') + '</small></div>' +
          '<div class="row tight">' +
          (own.length ? '<button class="btn" data-a="keepown" type="button">Approve this paper’s own (' + own.length + ') and reject the rest</button>'
            : '<small class="muted" style="flex-basis:100%">No curve here was judged to be this paper’s own result, so there is no one-click button. Approve by hand below, or re-sort with: python3 tools/limits.py extract ' + esc(c.arxiv_id) + '</small>') +
          '<button class="mini" data-a="showall" type="button">Show all on plot</button>' +
          '<a class="mini" href="https://arxiv.org/pdf/' + esc(c.arxiv_id) + '" target="_blank" rel="noopener">Open paper</a>' +
          '<button class="mini" data-a="rejectall" type="button">Reject all remaining from this paper</button></div>';
        h.addEventListener('click', function (ev) {
          var a = ev.target.getAttribute && ev.target.getAttribute('data-a');
          if (a === 'showall') {
            S.channel = mine[0].channel; S.unreviewed = true; selected = {};
            mine.forEach(function (x) { if (x.channel === S.channel) toggle(x, true); });
            $('f-channel').value = S.channel; fill(); refresh(); $('plot-wrap').scrollIntoView({ block: 'center' });
          }
          if (a === 'keepown') {                              // one click: keep the own results, drop the others
            ev.target.disabled = true;
            mine.reduce(function (chain, x) {
              return chain.then(function () { return post('/api/curve', { id: x.id, status: x.own ? 'approved' : 'rejected' }); });
            }, Promise.resolve()).then(reload);
          }
          if (a === 'rejectall') {
            ev.target.disabled = true;
            mine.reduce(function (chain, x) { return chain.then(function () { return post('/api/curve', { id: x.id, status: 'rejected' }); }); }, Promise.resolve()).then(reload);
          }
        });
        host.appendChild(h);
      }
      var d = document.createElement('div'); d.className = 'rev';
      d.innerHTML = '<div class="settings"><label>Name<input type="text" data-f="label" value="' + esc(c.label) + '"></label>' +
        '<label>Experiment<input type="text" data-f="experiment" value="' + esc(c.experiment) + '"></label>' +
        '<label>Plot type<select data-f="channel">' + chanOptions(c.channel) + '</select></label>' +
        '<label>Kind<select data-f="kind">' + kindOptions(c.kind) + '</select></label>' +
        '<label>Sigma (discovery)<select data-f="sigma"><option value="">n/a</option><option' + (c.sigma === 3 ? ' selected' : '') + '>3</option><option' + (c.sigma === 5 ? ' selected' : '') + '>5</option></select></label>' +
        '<label>Details<input type="text" data-f="limit_type" value="' + esc(c.limit_type) + '"></label></div>' +
        (c.own ? '<span class="badge own">this paper’s own result</span> ' : '') +
        '<small class="muted">' + ((c.notes || '').match(/#[0-9a-f]{6}/i) ? '<span class="swatch" style="border-color:' + (c.notes.match(/#[0-9a-f]{6}/i)[0]) + '" title="Line colour in the original figure"></span>' : '') + esc(c.source) + ' · ' + esc(c.shape || 'line') + ' · ' + c.points.length + ' points · ' + esc(c.notes) + '</small>' +
        '<div class="row tight"><button class="mini" data-a="show" type="button">Show on plot</button>' +
        (c.arxiv_id ? '<a class="mini" href="https://arxiv.org/pdf/' + esc(c.arxiv_id) + '" target="_blank" rel="noopener">Open paper</a>' : '') +
        '<button class="mini" data-a="approved" type="button">Approve</button><button class="mini" data-a="rejected" type="button">Reject</button></div>';
      d.addEventListener('click', function (ev) {
        var a = ev.target.getAttribute && ev.target.getAttribute('data-a'); if (!a) return;
        if (a === 'show') { S.channel = c.channel; S.unreviewed = true; $('f-channel').value = S.channel; toggle(c, true); fill(); refresh(); $('plot-wrap').scrollIntoView({ block: 'center' }); return; }
        var body = { id: c.id, status: a };
        Array.prototype.forEach.call(d.querySelectorAll('[data-f]'), function (n) { body[n.getAttribute('data-f')] = n.value; });
        body.sigma = parseInt(body.sigma, 10) || null; body.shape = c.shape || 'line';
        post('/api/curve', body).then(reload).catch(function (e) { ev.target.textContent = 'Failed: ' + e.message; });
      });
      host.appendChild(d);
    });
    drawPublished();
    loadIssues();
    // rejected curves, automatic or by hand, can be brought back
    var rej = admin.curves.filter(function (c) { return c.status === 'rejected'; });
    if (!$('rev-rejected')) throw new Error('Limits.html is an older copy than limits.js');
    $('n-rejected').textContent = '(' + rej.length + ')';
    var rh = $('rev-rejected'); rh.textContent = '';
    if (!rej.length) rh.innerHTML = '<p class="empty">None.</p>';
    rej.slice(0, 300).forEach(function (c) {
      var d = document.createElement('div'); d.className = 'rev';
      d.innerHTML = '<div><b>' + esc(c.label) + '</b> <small class="muted">' + esc(DB.channels[c.channel] ? DB.channels[c.channel].name : c.channel) + ' · ' +
        (c.arxiv_id ? 'arXiv:' + esc(c.arxiv_id) + ' · ' : '') + esc(c.notes) + '</small></div>' +
        '<div class="row tight"><button class="mini" data-a="restore" type="button">Restore to the review list</button></div>';
      d.addEventListener('click', function (ev) {
        if (ev.target.getAttribute && ev.target.getAttribute('data-a') === 'restore') post('/api/curve', { id: c.id, status: 'pending' }).then(reload);
      });
      rh.appendChild(d);
    });
    var have = {}; admin.curves.forEach(function (c) { if (c.status !== 'rejected') have[c.arxiv_id] = 1; });
    var papers = admin.papers.filter(function (p) { return !have[p.arxiv_id]; });
    $('n-papers').textContent = '(' + papers.length + ')';
    var ph = $('rev-papers'); ph.textContent = '';
    papers.slice(0, 100).forEach(function (p) {
      var d = document.createElement('div'); d.className = 'rev';
      d.innerHTML = '<div><a href="https://arxiv.org/abs/' + esc(p.arxiv_id) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a> <small class="muted">' + esc(p.experiment) + ', ' + esc(p.published) + ' · ' + esc(p.kind || 'result') + ' paper' + (p.log ? ' · ' + esc(p.log) : '') + '</small></div>' +
        '<div class="row tight"><button class="mini" data-a="dz" type="button">Digitize from figure</button><button class="mini" data-a="ignore" type="button">No new limit in this paper</button></div>';
      d.addEventListener('click', function (ev) {
        var a = ev.target.getAttribute && ev.target.getAttribute('data-a');
        if (a === 'dz') { $('dz-arxiv').value = p.arxiv_id; $('dz-exp').value = p.experiment; $('dz-label').value = p.experiment + ' ' + p.published.slice(0, 4); $('dz-kind').value = p.kind === 'model' ? 'model' : (p.kind === 'projection' ? 'projection' : 'limit'); $('dz-box').open = true; $('dz-box').scrollIntoView(); }
        if (a === 'ignore') post('/api/paper', { arxiv_id: p.arxiv_id, status: 'ignored' }).then(reload);
      });
      ph.appendChild(d);
    });
    $('dz-channel').innerHTML = chanOptions(S.channel);
    if (!$('dz-kind').options.length) $('dz-kind').innerHTML = kindOptions('limit');
  }
  function digitizer() {
    var cv = $('dz-canvas'), ctx = cv.getContext('2d'), img = null, clicks = [];
    var NAMES = ['X1', 'X2', 'Y1', 'Y2'];
    function step() {
      var n = clicks.length, msg;
      if (!img) msg = 'Load a screenshot of the figure (choose a file, or paste an image with Ctrl/Cmd+V).';
      else if (n < 2) msg = 'Click a point on the mass axis whose value you know (' + NAMES[n] + '), and type that value in "Mass at ' + NAMES[n] + '".';
      else if (n < 4) msg = 'Click a point on the limit axis whose value you know (' + NAMES[n] + '), and type that value in "Limit at ' + NAMES[n] + '".';
      else msg = 'Now click along the curve, from one end to the other (for a region, click around its outline). ' + (n - 4) + ' points so far. Then press Save curve.';
      $('dz-step').textContent = msg;
    }
    function paint() {
      if (!img) return;
      ctx.drawImage(img, 0, 0);
      clicks.forEach(function (p, i) {
        ctx.beginPath(); ctx.arc(p[0], p[1], i < 4 ? 7 : 4, 0, 6.3);
        ctx.fillStyle = i < 4 ? '#e34948' : '#0a84e6'; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
        if (i < 4) { ctx.fillStyle = '#e34948'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(NAMES[i], p[0] + 9, p[1] - 9); }
      });
      step();
    }
    function load(file) {
      var im = new Image();
      im.onload = function () { img = im; cv.width = im.width; cv.height = im.height; clicks = []; paint(); };
      im.src = URL.createObjectURL(file);
    }
    $('dz-file').addEventListener('change', function () { if (this.files[0]) load(this.files[0]); });
    document.addEventListener('paste', function (ev) {
      if (!$('dz-box').open) return;
      Array.prototype.forEach.call((ev.clipboardData || {}).items || [], function (it) { if (it.type.indexOf('image') === 0) load(it.getAsFile()); });
    });
    cv.addEventListener('click', function (ev) {
      if (!img) return;
      var r = cv.getBoundingClientRect();
      clicks.push([(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]); paint();
    });
    $('dz-undo').addEventListener('click', function () { clicks.pop(); paint(); });
    $('dz-restart').addEventListener('click', function () { clicks = []; paint(); });
    $('dz-save').addEventListener('click', function () {
      var v = ['dz-x1', 'dz-x2', 'dz-y1', 'dz-y2'].map(function (id) { return num($(id).value); });
      if (clicks.length < 7 || v.some(function (x) { return x === null; })) { $('dz-step').textContent = 'Not ready: set the four axis points with their values, then click at least three points on the curve.'; return; }
      var xlog = $('dz-xlog').checked, ylog = $('dz-ylog').checked;
      function map(px, p1, p2, v1, v2, log) {
        var a = log ? Math.log10(v1) : v1, b = log ? Math.log10(v2) : v2, t = a + (px - p1) / (p2 - p1) * (b - a);
        return log ? Math.pow(10, t) : t;
      }
      var kx = 1 / XU[$('dz-xu').value], ch = $('dz-channel').value;
      var ky = DB.channels[ch].y_unit === 'cm2' ? 1 / YU[$('dz-yu').value] : 1;
      var pts = clicks.slice(4).map(function (p) {
        return [map(p[0], clicks[0][0], clicks[1][0], v[0], v[1], xlog) * kx, map(p[1], clicks[2][1], clicks[3][1], v[2], v[3], ylog) * ky];
      });
      post('/api/curve', { arxiv_id: $('dz-arxiv').value.trim(), label: $('dz-label').value || 'Untitled', experiment: $('dz-exp').value, channel: ch,
        limit_type: $('dz-type').value, status: 'approved', points: pts, kind: $('dz-kind').value, shape: $('dz-shape').value, sigma: parseInt($('dz-sigma').value, 10) || null, notes: 'Digitized by hand from the figure; approximate.' })
        .then(function () { clicks = clicks.slice(0, 4); paint(); $('dz-step').textContent = 'Saved. Axis points are kept, so you can click the next curve in the same figure.'; return reload(); })
        .catch(function (e) { $('dz-step').textContent = 'Could not save: ' + e.message; });
    });
    step();
  }

  document.addEventListener('DOMContentLoaded', function () {
    wire(); digitizer();
    var why = [];
    reload().catch(function (e) {           // not on the review server: read the published file
      if (e && e.message) why.push('review server: ' + e.message);
      return fetch('data/limits.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('data/limits.json answered ' + r.status);
        return r.text();
      }).then(function (txt) {
        var d;
        try { d = JSON.parse(txt); } catch (e2) { throw new Error('data/limits.json is not valid JSON (' + e2.message + ')'); }
        setData(d); fill(); preselect(); refresh();
      });
    }).catch(function (e) {
      why.push(e && e.message ? e.message : String(e));
      $('plot').innerHTML = '<p class="empty" style="padding:1rem">The limit database could not be loaded.<br><small>' + esc(why.join(' · ')) + '</small></p>';
    });
  });
})();
