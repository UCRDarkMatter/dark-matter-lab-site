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
    getJSON('data/people.json').then(function (d) {
      d.groups.forEach(function (g) {
        if (!g.members.length && !g.hiring) return;
        var sec = el('section'); sec.appendChild(el('h2', null, g.title));
        if (g.alumni) {
          var ul = el('ul', 'plain-list'); ul.style.marginTop = '1rem';
          g.members.forEach(function (m) { ul.appendChild(el('li', null, m.name + (m.role ? ', ' + m.role : '') + (m.now ? '. Now: ' + m.now : ''))); });
          sec.appendChild(ul); host.appendChild(sec); return;
        }
        var grid = el('div', 'people'); grid.style.marginTop = '1rem';
        g.members.forEach(function (m) {
          var card = el('div', 'person'), av;
          if (m.photo) { av = el('img', 'avatar'); av.src = m.photo; av.alt = ''; av.loading = 'lazy'; }
          else { av = el('div', 'avatar', initials(m.name)); av.setAttribute('aria-hidden', 'true'); }
          var body = el('div', 'stack'); body.style.gap = '.25rem';
          body.appendChild(el('h3', null, m.name));
          if (m.role) body.appendChild(el('div', 'sub', m.role));
          if (m.bio) body.appendChild(el('p', null, m.bio));
          var links = el('p');
          if (m.email) { var a = el('a', null, m.email); a.href = 'mailto:' + m.email; links.appendChild(a); }
          Object.keys(m.links || {}).forEach(function (k) {
            if (links.firstChild) links.appendChild(document.createTextNode(' · '));
            var a = el('a', null, k); a.href = m.links[k]; links.appendChild(a);
          });
          if (links.firstChild) body.appendChild(links);
          card.appendChild(av); card.appendChild(body); grid.appendChild(card);
        });
        if (g.hiring) {
          var open = el('div', 'person open'), q = el('div', 'avatar', '?'); q.setAttribute('aria-hidden', 'true');
          var b = el('div', 'stack'); b.style.gap = '.25rem';
          b.appendChild(el('h3', null, 'You?')); b.appendChild(el('p', null, g.hiring));
          var c = el('a', null, 'Get in touch'); c.href = 'Contact.html'; b.appendChild(c);
          open.appendChild(q); open.appendChild(b); grid.appendChild(open);
        }
        sec.appendChild(grid); host.appendChild(sec);
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
          var c = el('a', 'card'); c.href = t.url;
          if (t.repo) c.appendChild(el('span', 'tag', 'GitHub'));
          c.appendChild(el('h3', null, t.name)); c.appendChild(el('p', null, t.text));
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
