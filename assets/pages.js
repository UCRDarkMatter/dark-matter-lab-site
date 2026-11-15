/* Pages that are drawn from small data files, so content is edited (or refreshed by the
   updater) in one place: People (data/people.json), Outreach (data/events.json) and
   Tools (data/tools.json + live GitHub details). */
(function () {
  'use strict';
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function getJSON(url) { return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function fail(host, what) { host.appendChild(el('p', 'empty', what + ' could not be loaded. Please try again later.')); }
  function initials(name) { return name.split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase(); }

  function people(host) {
    function card(m, former) {
      var c = el('div', 'person'), av;
      if (m.photo) { av = el('img', 'avatar'); av.src = m.photo; av.alt = ''; av.loading = 'lazy'; }
      else { av = el('div', 'avatar', initials(m.name)); av.setAttribute('aria-hidden', 'true'); }
      var body = el('div', 'stack'); body.style.gap = '.25rem';
      body.appendChild(el('h3', null, m.name));
      if (m.role) body.appendChild(el('div', 'sub', former ? 'Former ' + m.role.charAt(0).toLowerCase() + m.role.slice(1) : m.role));
      if (m.now) body.appendChild(el('p', null, 'Now: ' + m.now));
      if (m.bio) body.appendChild(el('p', null, m.bio));
      var links = el('p');
      if (m.email) { var a = el('a', null, m.email); a.href = 'mailto:' + m.email; links.appendChild(a); }
      Object.keys(m.links || {}).forEach(function (k) {
        if (links.firstChild) links.appendChild(document.createTextNode(' · '));
        var a = el('a', null, k); a.href = m.links[k]; links.appendChild(a);
      });
      if (links.firstChild) body.appendChild(links);
      c.appendChild(av); c.appendChild(body); return c;
    }
    function grid(parent) { var g = el('div', 'people'); g.style.marginTop = '1rem'; parent.appendChild(g); return g; }
    getJSON('data/people.json').then(function (d) {
      d.groups.forEach(function (g) {
        if (!g.members.length && !g.hiring) return;
        var sec = el('section'); sec.appendChild(el('h2', null, g.title));
        if (g.alumni) {
          // Alumni, grouped by category: those with a photo get a card, the rest a compact list.
          var cats = [];
          g.members.forEach(function (m) { var c = m.category || ''; if (cats.indexOf(c) < 0) cats.push(c); });
          cats.forEach(function (c) {
            var ms = g.members.filter(function (m) { return (m.category || '') === c; });
            if (c) sec.appendChild(el('h3', 'alumni-cat', c));
            // Former postdocs (with a role) get full cards; everyone else a compact list with a small photo or initials.
            var cards = ms.filter(function (m) { return m.role; }), rest = ms.filter(function (m) { return !m.role; });
            if (cards.length) { var gr = grid(sec); cards.forEach(function (m) { gr.appendChild(card(m, true)); }); }
            if (rest.length) {
              var ul = el('ul', 'alumni-list');
              rest.forEach(function (m) {
                var li = el('li'), av;
                if (m.photo) { av = el('img', 'mini-av'); av.src = m.photo; av.alt = ''; av.loading = 'lazy'; }
                else { av = el('span', 'mini-av', initials(m.name)); av.setAttribute('aria-hidden', 'true'); }
                var t = el('span', 'txt'); t.appendChild(el('span', 'nm', m.name));
                if (m.now) t.appendChild(el('span', 'now', m.now));
                var lk = Object.keys(m.links || {});
                if (lk.length) {
                  var lp = el('span', 'now');
                  lk.forEach(function (k, n) { if (n) lp.appendChild(document.createTextNode(' · ')); var a = el('a', null, k); a.href = m.links[k]; lp.appendChild(a); });
                  t.appendChild(lp);
                }
                li.appendChild(av); li.appendChild(t); ul.appendChild(li);
              });
              sec.appendChild(ul);
            }
          });
          host.appendChild(sec); return;
        }
        var gr = grid(sec);
        g.members.forEach(function (m) { gr.appendChild(card(m, false)); });
        if (g.hiring) {
          var open = el('div', 'person open'), q = el('div', 'avatar', '?'); q.setAttribute('aria-hidden', 'true');
          var b = el('div', 'stack'); b.style.gap = '.25rem';
          b.appendChild(el('h3', null, 'You?')); b.appendChild(el('p', null, g.hiring));
          var c = el('a', null, 'Get in touch'); c.href = 'Contact.html'; b.appendChild(c);
          open.appendChild(q); open.appendChild(b); gr.appendChild(open);
        }
        host.appendChild(sec);
      });
    }).catch(function () { fail(host, 'The people list'); });
  }

  function events(host) {
    getJSON('data/events.json').then(function (d) {
      var today = new Date().toISOString().slice(0, 10);
      var up = d.events.filter(function (e) { return e.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var past = d.events.filter(function (e) { return e.date < today; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      function block(title, arr, emptyText) {
        var sec = el('section'); sec.appendChild(el('h2', null, title));
        if (!arr.length) sec.appendChild(el('p', 'empty', emptyText));
        arr.forEach(function (e) {
          var row = el('div', 'event'), t = el('time', null, new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
          t.dateTime = e.date;
          var body = el('div');
          var h = el('h3'); if (e.url) { var a = el('a', null, e.title); a.href = e.url; h.appendChild(a); } else h.textContent = e.title;
          body.appendChild(h);
          if (e.where) body.appendChild(el('div', 'sub', e.where));
          if (e.text) body.appendChild(el('p', null, e.text));
          row.appendChild(t); row.appendChild(body); sec.appendChild(row);
        });
        host.appendChild(sec);
      }
      block('Upcoming events', up, 'Nothing scheduled right now. Get in touch if you would like us at your event.');
      if (past.length) block('Past events', past, '');
    }).catch(function () { fail(host, 'The events list'); });
  }

  function tools(host) {
    Promise.all([getJSON('data/tools.json'), getJSON('data/github.json').catch(function () { return {}; })]).then(function (res) {
      var d = res[0], gh = res[1].repos || {};
      function meta(card, info) {
        if (!info) return;
        var bits = [];
        if (info.language) bits.push(info.language);
        if (typeof info.stars === 'number') bits.push('★ ' + info.stars);
        if (info.release) bits.push(info.release);
        if (info.pushed) bits.push('updated ' + new Date(info.pushed).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }));
        var m = card.querySelector('.meta') || card.appendChild(el('div', 'meta'));
        m.textContent = bits.join(' · ');
      }
      function grid(title, arr) {
        var sec = el('section'); sec.appendChild(el('h2', null, title));
        var g = el('div', 'cards'); g.style.marginTop = '1rem';
        arr.forEach(function (t) {
          var c;
          if (t.site) {                 // a tool with its own website: the card links there, with a separate GitHub link
            c = el('div', 'card');
            if (t.beta) c.appendChild(el('span', 'tag live', 'Beta'));
            var h = el('h3'), ha = el('a', null, t.name); ha.href = t.site; h.appendChild(ha); c.appendChild(h);
            c.appendChild(el('p', null, t.text));
            var lk = el('p', 'tool-links'), w = el('a', null, t.siteLabel || 'Website'); w.href = t.site; lk.appendChild(w);
            if (t.url && t.url !== t.site) { lk.appendChild(document.createTextNode(' · ')); var gl = el('a', null, t.repo ? 'GitHub' : 'Code'); gl.href = t.url; lk.appendChild(gl); }
            c.appendChild(lk);
          } else {
            c = el('a', 'card'); c.href = t.url;
            if (t.repo) c.appendChild(el('span', 'tag', 'GitHub'));
            c.appendChild(el('h3', null, t.name)); c.appendChild(el('p', null, t.text));
          }
          g.appendChild(c);
          if (t.repo) {
            meta(c, gh[t.repo]);
            // Ask GitHub directly as well, so the numbers are current even between updater runs.
            fetch('https://api.github.com/repos/' + t.repo).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
              if (j && j.full_name) meta(c, { language: j.language, stars: j.stargazers_count, pushed: j.pushed_at, release: (gh[t.repo] || {}).release });
            }).catch(function () {});
          }
        });
        sec.appendChild(g); host.appendChild(sec);
      }
      grid('Tools from our lab and collaborators', d.lab);
      grid('Other useful tools', d.other);
    }).catch(function () { fail(host, 'The tools list'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var map = { people: people, events: events, tools: tools };
    Object.keys(map).forEach(function (id) { var h = document.getElementById(id); if (h) map[id](h); });
  });
})();
