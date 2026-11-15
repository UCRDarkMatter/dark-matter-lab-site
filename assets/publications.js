/* Publication list that keeps itself current from arXiv.
 *
 * How it stays up to date
 *  1. data/publications.json is a cached copy of the full list. tools/update_site_data.py
 *     rebuilds it from the arXiv API (run it nightly from cron). The page shows this at once.
 *  2. The page then asks arXiv directly for the newest papers and adds any the cache
 *     does not have yet, so a new paper appears even before the next cron run.
 *     If the browser cannot reach arXiv, step 2 is skipped silently.
 *
 * Use:  <div id="pubs"></div>                       full list with search and filters
 *       <div id="pubs" data-limit="5" data-compact></div>   newest five, no controls
 *       <div id="pubs" data-group="DUNE" data-compact></div> only one category (DarkSide-50, DarkSide-20k, GADMC, DEAP-3600, DUNE, SBC); add data-match="regex" to narrow further
 */
(function () {
  'use strict';

  var CONFIG = {
    arxivQuery: 'au:Westerdale',          // what counts as "my papers" on arXiv
    highlight: /westerdale/i,             // author name to set in bold
    cacheUrl: 'data/publications.json',
    api: 'https://export.arxiv.org/api/query',
    liveCheck: 25,                        // how many of the newest papers to ask arXiv for
    maxAuthorsShown: 8                    // longer author lists become "First Author et al."
  };

  /* Collaboration tags, tested in order against title + abstract + comment + author list. */
  // Collaboration categories. A paper can carry several (a DarkSide-20k paper is also a GADMC paper).
  // `re` is tested on the title, collaboration, comment and author list; `abs` (optional) also on the abstract,
  // which mentions other experiments too often to be used for every category.
  var GROUPS = [
    { key: 'DarkSide-50', re: /DarkSide-50|\bDS-50\b/i },
    { key: 'DarkSide-20k', re: /DarkSide-20k|\bDS-20k\b/i },
    { key: 'GADMC', re: /global argon|\bGADMC\b|\bArgo\b|DarkSide-LowMass|\bDS-LM\b|\bAria\b|\bUrania\b|\bDArT\b|dark\s?side|ReD TPC|Mechanical Ventilator Milano/i,
      abs: /global argon dark matter|\bArgo\b|DarkSide-LowMass/i },
    { key: 'DEAP-3600', re: /\bDEAP\b/i },
    { key: 'DUNE', re: /\b(proto)?DUNE\b|deep underground neutrino experiment/i },
    { key: 'SBC', re: /bubble chamber|\bSBC\b/i }
  ];
  var LONG = { 'DEAP-3600': 'DEAP', 'GADMC': 'Global Argon Dark Matter' };   // for "(X Collaboration)"

  var SMALL = 'Small-team';               // papers with 15 authors or fewer

  // ---------- helpers ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω' };
  var SYM = { pm: '±', mp: '∓', times: '×', cdot: '·', sim: '∼', approx: '≈', simeq: '≃', leq: '≤', le: '≤', geq: '≥', ge: '≥', ll: '≪', gg: '≫', to: '→', rightarrow: '→', leftarrow: '←', infty: '∞', odot: '⊙', circ: '°', bar: '', ell: 'ℓ', hbar: 'ħ', lesssim: '≲', gtrsim: '≳', neq: '≠', propto: '∝', '%': '%' };

  /* Turns the simple TeX that shows up in arXiv titles and abstracts ($^{39}$Ar, $\nu_e$,
     $\pm$ ...) into HTML. Input is escaped first, so the output is safe to assign to innerHTML. */
  function tex(s) {
    s = esc(String(s || '').replace(/\s+/g, ' ').trim());
    function inner(m) {
      m = m.replace(/\\(?:mathrm|rm|text|textrm|mathit|textit|mathbf|textbf|mathcal|operatorname)\s*\{([^{}]*)\}/g, '$1');
      m = m.replace(/\\(?:,|;|:|!|quad|qquad| )/g, ' ').replace(/\\(?:left|right)/g, '');
      m = m.replace(/\\([A-Za-z]+|%)/g, function (all, name) {
        if (GREEK[name]) return GREEK[name];
        if (name in SYM) return SYM[name];
        return name;
      });
      m = m.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>').replace(/\^(\S)/g, '<sup>$1</sup>');
      m = m.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>').replace(/_(\S)/g, '<sub>$1</sub>');
      return m.replace(/[{}]/g, '');
    }
    s = s.replace(/\$([^$]{1,200})\$/g, function (all, m) { return inner(m); });
    s = s.replace(/\\(?:textit|emph|textbf|text)\s*\{([^{}]*)\}/g, '$1');
    return s.replace(/\\,/g, ' ').replace(/\\%/g, '%').replace(/~/g, ' ');
  }

  function arxivId(url) {            // "http://arxiv.org/abs/2301.11878v2" -> "2301.11878"
    return String(url).replace(/^.*\/abs\//, '').replace(/v\d+$/, '');
  }
  function groupOf(p) {               // all categories that fit, in GROUPS order
    var hay = [p.collaboration, p.title, p.comment, (p.authors || []).join(' ')].join(' ');
    var tags = GROUPS.filter(function (g) { return g.re.test(hay) || (g.abs && g.abs.test(p.abstract || '')); })
                     .map(function (g) { return g.key; });
    return tags;
  }
  function hasTag(p, k) { return (p.tags || []).indexOf(k) >= 0; }
  function isSmall(p) { return typeof p.n_authors === 'number' && p.n_authors <= 15; }

  // ---------- data ----------
  function loadCache() {
    return fetch(CONFIG.cacheUrl, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return null; });
  }
  function parseAtom(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var out = [];
    function txt(node, name) {
      var c = node.getElementsByTagName(name)[0];
      return c ? c.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    Array.prototype.forEach.call(doc.getElementsByTagName('entry'), function (e) {
      var names = Array.prototype.map.call(e.getElementsByTagName('author'), function (a) { return txt(a, 'name'); });
      var me = names.filter(function (n) { return CONFIG.highlight.test(n); })[0];
      var shown = names.slice(0, 10);
      if (me && shown.indexOf(me) < 0) shown.push(me);
      var cat = e.getElementsByTagName('arxiv:primary_category')[0] || e.getElementsByTagName('primary_category')[0];
      out.push({
        id: arxivId(txt(e, 'id')),
        title: txt(e, 'title'),
        abstract: txt(e, 'summary'),
        published: txt(e, 'published').slice(0, 10),
        updated: txt(e, 'updated').slice(0, 10),
        authors: shown,
        n_authors: names.length,
        journal_ref: txt(e, 'arxiv:journal_ref') || txt(e, 'journal_ref'),
        doi: txt(e, 'arxiv:doi') || txt(e, 'doi'),
        comment: txt(e, 'arxiv:comment') || txt(e, 'comment'),
        category: cat ? cat.getAttribute('term') : ''
      });
    });
    return out;
  }
  function fetchArxiv(start, max) {
    var url = CONFIG.api + '?search_query=' + encodeURIComponent(CONFIG.arxivQuery) +
      '&sortBy=submittedDate&sortOrder=descending&start=' + start + '&max_results=' + max;
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(parseAtom);
  }
  function fetchAllLive() {          // only used when there is no cache file at all
    var all = [], page = 100;
    function next(start) {
      return fetchArxiv(start, page).then(function (batch) {
        all = all.concat(batch);
        if (batch.length === page && start + page < 1000) {
          return new Promise(function (ok) { setTimeout(ok, 3100); }).then(function () { return next(start + page); });
        }
        return all;
      });
    }
    return next(0);
  }
  function merge(base, fresh) {
    var seen = {}, added = 0;
    base.forEach(function (p) { seen[p.id] = p; });
    fresh.forEach(function (p) {
      if (!seen[p.id]) { base.push(p); seen[p.id] = p; added++; }
      else if (p.journal_ref && !seen[p.id].journal_ref) { seen[p.id].journal_ref = p.journal_ref; seen[p.id].doi = p.doi || seen[p.id].doi; }
    });
    base.sort(function (a, b) { return a.published < b.published ? 1 : a.published > b.published ? -1 : 0; });
    return added;
  }

  // ---------- rendering ----------
  function authorsHtml(p) {
    var a = p.authors || [], n = typeof p.n_authors === 'number' ? p.n_authors : a.length;
    function one(name) { return CONFIG.highlight.test(name) ? '<b>' + esc(name) + '</b>' : esc(name); }
    if (!p.truncated && n <= CONFIG.maxAuthorsShown && a.length >= n) return a.map(one).join(', ');
    var t0 = (p.tags || [])[0];
    var g = t0 ? ' (' + esc(LONG[t0] || t0) + ' Collaboration)' : '';
    var first = a[0] && !/collaboration/i.test(a[0]) ? a[0] : (a[1] || a[0] || '');
    var count = typeof p.n_authors === 'number' ? ' · ' + p.n_authors + ' authors incl. <b>S. Westerdale</b>' : '';
    return one(first) + ' <i>et al.</i>' + g + count;
  }
  function pubNode(p, idx) {
    var li = el('li', 'pub');
    var absUrl = 'https://arxiv.org/abs/' + p.id;

    var t = el('div', 'pub-title');
    var ta = el('a'); ta.href = absUrl; ta.innerHTML = tex(p.title); t.appendChild(ta); li.appendChild(t);

    var au = el('div', 'pub-authors'); au.innerHTML = authorsHtml(p); li.appendChild(au);

    var ref = el('div', 'pub-ref');
    var year = (p.published || '').slice(0, 4);
    ref.innerHTML = (p.journal_ref ? '<span class="jref">' + tex(p.journal_ref) + '</span> · ' : '') +
      'arXiv:' + esc(p.id) + (p.category ? ' [' + esc(p.category) + ']' : '') +
      (!p.journal_ref && year ? ' (' + year + ')' : '');
    li.appendChild(ref);

    var act = el('div', 'pub-actions');
    var abs = null;
    if (p.abstract) {
      var id = 'abs-' + idx + '-' + p.id.replace(/\W/g, '');
      var b = el('button', 'mini abs-btn', 'Abstract');
      b.type = 'button'; b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', id);
      abs = el('div', 'abstract'); abs.id = id; abs.hidden = true;
      b.addEventListener('click', function () {
        if (!abs.firstChild) abs.innerHTML = tex(p.abstract);   // filled on first open
        var open = abs.hidden; abs.hidden = !open;
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      act.appendChild(b);
    }
    function link(label, href) { var a = el('a', 'mini', label); a.href = href; act.appendChild(a); }
    link('arXiv', absUrl);
    link('PDF', 'https://arxiv.org/pdf/' + p.id);
    if (p.doi) link('Journal', 'https://doi.org/' + p.doi);
    if (p.citations) act.appendChild(el('span', 'tag', 'cited ' + p.citations + '×'));
    (p.tags || []).forEach(function (t) { act.appendChild(el('span', 'tag', t)); });
    if (p.isNew) act.appendChild(el('span', 'tag live', 'new'));
    li.appendChild(act);
    if (abs) li.appendChild(abs);
    return li;
  }

  function init(host) {
    var limit = parseInt(host.getAttribute('data-limit') || '0', 10);
    var compact = host.hasAttribute('data-compact');
    var only = host.getAttribute('data-group');        // e.g. data-group="DUNE" on an experiment page
    var onlyRe = host.getAttribute('data-match') ? new RegExp(host.getAttribute('data-match'), 'i') : null;  // narrower still
    var state = { pubs: [], q: '', group: 'All', allOpen: false, meta: null, live: 'pending' };

    var tools = el('div', 'pub-tools'), status = el('div', 'pub-status'), list = el('div');
    var notice = el('p', 'notice'); notice.hidden = true;
    status.setAttribute('role', 'status');
    var search, chips;
    if (!compact) {
      search = el('input'); search.type = 'search'; search.id = 'pub-search';
      search.placeholder = 'Search titles, authors, abstracts…';
      search.setAttribute('aria-label', 'Search publications');
      search.addEventListener('input', function () { state.q = search.value.toLowerCase(); draw(); });
      chips = el('div', 'chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Filter by collaboration');
      tools.appendChild(search); tools.appendChild(chips);
      host.appendChild(tools);
    }
    host.appendChild(notice); host.appendChild(status); host.appendChild(list);
    status.textContent = 'Loading publications…';

    function matches(p) {
      if (only && !hasTag(p, only)) return false;
      if (onlyRe && !onlyRe.test(p.title + ' ' + (p.abstract || ''))) return false;
      if (state.group !== 'All') {
        if (state.group === SMALL ? !isSmall(p) : !hasTag(p, state.group)) return false;
      }
      if (!state.q) return true;
      return [p.title, p.abstract, (p.authors || []).join(' '), p.journal_ref, p.id, (p.tags || []).join(' ')].join(' ').toLowerCase().indexOf(state.q) >= 0;
    }
    function drawChips() {
      if (!chips) return;
      chips.textContent = '';
      var counts = { All: state.pubs.length };
      state.pubs.forEach(function (p) {
        (p.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
        if (isSmall(p)) counts[SMALL] = (counts[SMALL] || 0) + 1;
      });
      ['All'].concat(GROUPS.map(function (g) { return g.key; }), [SMALL]).forEach(function (k) {
        if (!counts[k]) return;
        var b = el('button', 'chip', k); b.type = 'button';
        var n = el('span', 'n', String(counts[k])); b.appendChild(n);
        b.setAttribute('aria-pressed', state.group === k ? 'true' : 'false');
        b.addEventListener('click', function () { state.group = k; drawChips(); draw(); });
        chips.appendChild(b);
      });
    }
    function draw() {
      var shown = state.pubs.filter(matches);
      if (limit) shown = shown.slice(0, limit);
      list.textContent = '';
      if (!shown.length) {
        list.appendChild(el('p', 'empty', state.pubs.length ? 'No papers match. Clear the search or pick another filter.' : 'The publication list could not be loaded. The full list is on arXiv.'));
      }
      var ul = null, year = null;
      shown.forEach(function (p, i) {
        var y = (p.published || '').slice(0, 4);
        if (!compact && y !== year) {
          year = y;
          var head = el('div', 'year-head');
          head.appendChild(el('h2', null, y || 'Undated'));
          head.appendChild(el('span', 'muted', shown.filter(function (x) { return (x.published || '').slice(0, 4) === y; }).length + ' papers'));
          list.appendChild(head); ul = null;
        }
        if (!ul) { ul = el('ul', 'pub-list'); list.appendChild(ul); }
        ul.appendChild(pubNode(p, i));
      });
      // status line
      status.textContent = '';
      if (!state.pubs.length) return;
      var bits = [];
      if (!compact) bits.push(shown.length === state.pubs.length ? state.pubs.length + ' papers' : shown.length + ' of ' + state.pubs.length + ' papers');
      if (!compact && !only && state.meta && state.meta.total_citations) bits.push(state.meta.total_citations.toLocaleString('en-US') + ' citations (INSPIRE)');
      if (state.live === 'ok') bits.push('checked against arXiv just now');
      else if (state.meta && state.meta.generated) bits.push('list updated ' + state.meta.generated.slice(0, 10));
      status.appendChild(el('span', null, bits.join(' · ')));
      if (!compact && shown.some(function (p) { return p.abstract; })) {
        var t = el('button', 'linkish', state.allOpen ? 'Hide all abstracts' : 'Show all abstracts'); t.type = 'button';
        t.addEventListener('click', function () {
          state.allOpen = !state.allOpen; draw();
        });
        status.appendChild(t);
      }
      if (state.allOpen) Array.prototype.forEach.call(list.querySelectorAll('.abs-btn[aria-expanded="false"]'), function (b) { b.click(); });
    }
    function setPubs(arr) {
      arr.forEach(function (p) { if (!p.tags) p.tags = groupOf(p); });
      state.pubs = arr; drawChips(); draw();
    }

    loadCache().then(function (cache) {
      var base = cache && cache.papers ? cache.papers : [];
      state.meta = cache;
      if (cache && cache.sample) {
        notice.hidden = false;
        notice.textContent = 'Preview data: a few recent papers with shortened abstracts. Once the site is on your server, this list fills itself from arXiv.';
      }
      if (base.length) setPubs(base);
      var live = base.length ? fetchArxiv(0, CONFIG.liveCheck) : fetchAllLive();
      return live.then(function (fresh) {
        var known = base.length > 0 && !(cache && cache.sample);
        if (cache && cache.sample) base = [];           // real data replaces the preview sample
        var before = {}; base.forEach(function (p) { before[p.id] = 1; });
        merge(base, fresh);
        if (known) base.forEach(function (p) { if (!before[p.id]) p.isNew = true; });
        state.live = 'ok'; notice.hidden = true;
        setPubs(base);
      }).catch(function () {
        state.live = 'failed';
        if (!base.length) setPubs([]); else draw();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var host = document.getElementById('pubs');
    if (host) init(host);
  });
  if (typeof module !== 'undefined') module.exports = { tex: tex, parseAtom: parseAtom, merge: merge, groupOf: groupOf };
})();
