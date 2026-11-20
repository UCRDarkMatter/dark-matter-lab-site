/* Internal group wiki.
   The pages live in data/internal.enc.json, encrypted with AES-256-GCM under a key derived from the group
   password (PBKDF2-SHA256). This script decrypts them in the browser, lets members edit Markdown, and saves
   by re-encrypting and committing the file through the GitHub API (or by downloading it). The repository,
   which is public, only ever holds ciphertext. tools/wiki.py does the same from the command line. */
(function () {
  'use strict';
  var STORE = 'data/internal.enc.json';
  var REPO = 'UCRDarkMatter/dark-matter-lab-site', BRANCH = 'main';
  var API = 'https://api.github.com/repos/' + REPO + '/contents/' + STORE;
  var SKEY = 'gx-wiki-key', TKEY = 'gx-wiki-token';

  var $ = function (id) { return document.getElementById(id); };
  var enc = new TextEncoder(), dec = new TextDecoder();
  var store = null, key = null, wiki = null;
  var dirty = {}, deleted = {}, orderChanged = false;   // unsaved changes: page id -> page / true
  var current = null, editing = null;

  function b64(buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ------------------------------------------------------------ crypto
  function derive(password, salt, iter) {
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base,
        { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    });
  }
  function decryptWith(k, st) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(st.iv) }, k, unb64(st.ct))
      .then(function (pt) { return JSON.parse(dec.decode(pt)); });
  }
  function encryptWith(k, obj, st) {   // same key and salt, fresh IV
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc.encode(JSON.stringify(obj))).then(function (ct) {
      return { v: 1, kdf: 'PBKDF2-SHA256', iter: st.iter, cipher: 'AES-256-GCM', salt: st.salt, iv: b64(iv), ct: b64(ct) };
    });
  }

  // ------------------------------------------------------------ unlock
  function fetchStore() {
    return fetch(STORE + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('Could not load the wiki (' + r.status + ').');
      return r.json();
    });
  }
  function opened(k, data) {
    key = k; wiki = data;
    crypto.subtle.exportKey('raw', k).then(function (raw) {
      try { sessionStorage.setItem(SKEY, JSON.stringify({ salt: store.salt, key: b64(raw) })); } catch (e) {}
    });
    $('lock').hidden = true; $('wiki').hidden = false;
    renderList(); route();
  }
  function tryRemembered() {
    var saved;
    try { saved = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || saved.salt !== store.salt) return Promise.resolve(false);
    return crypto.subtle.importKey('raw', unb64(saved.key), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
      .then(function (k) { return decryptWith(k, store).then(function (d) { opened(k, d); return true; }); })
      .catch(function () { return false; });
  }
  $('unlock').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('unlock-msg'); msg.textContent = 'Opening…';
    var pw = $('pw').value;
    derive(pw, unb64(store.salt), store.iter).then(function (k) {
      return decryptWith(k, store).then(function (d) { $('pw').value = ''; opened(k, d); });
    }).catch(function () { msg.textContent = 'That password did not work.'; $('pw').select(); });
  });
  $('b-lock').addEventListener('click', function () {
    if (pendingCount() && !confirm('You have unsaved changes. Lock anyway and lose them?')) return;
    try { sessionStorage.removeItem(SKEY); } catch (e) {}
    location.hash = ''; location.reload();
  });

  // ------------------------------------------------------------ view
  function md(text) {
    var html = DOMPurify.sanitize(marked.parse(text || '', { gfm: true }));
    var box = document.createElement('div'); box.innerHTML = html;
    box.querySelectorAll('a[href]').forEach(function (a) {
      if (/^https?:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener'; }
    });
    return box.innerHTML;
  }
  function page(id) { return wiki.pages.filter(function (p) { return p.id === id; })[0]; }
  function renderList() {
    var ul = $('page-list'); ul.innerHTML = '';
    wiki.pages.forEach(function (p) {
      var li = document.createElement('li');
      li.innerHTML = '<a href="#' + esc(p.id) + '"' + (p.id === current ? ' aria-current="page"' : '') + '>' + esc(p.title) +
        (dirty[p.id] ? '<span class="dot" title="Unsaved">●</span>' : '') + '</a>';
      ul.appendChild(li);
    });
    var n = pendingCount(), box = $('pending');
    box.hidden = !n;
    if (n) {
      box.innerHTML = n + ' unsaved change' + (n > 1 ? 's' : '') + '.<br><button class="mini" type="button" id="b-save">Save…</button>';
      $('b-save').addEventListener('click', openSave);
    }
  }
  function pendingCount() { return Object.keys(dirty).length + Object.keys(deleted).length + (orderChanged ? 1 : 0); }
  function route() {
    if (!wiki) return;
    var id = decodeURIComponent(location.hash.slice(1)) || (wiki.pages[0] || {}).id;
    var p = page(id) || wiki.pages[0];
    if (!p) { $('view').innerHTML = '<p>No pages yet. Use <b>New page</b>.</p>'; return; }
    current = p.id; showView(p); renderList();
  }
  function showView(p) {
    $('editor').hidden = true; $('view').hidden = false; $('view-bar').hidden = false; editing = null;
    $('view').innerHTML = md(p.body);
    $('page-meta').textContent = p.updated ? 'Last edited ' + p.updated + (p.by ? ' by ' + p.by : '') : '';
    document.title = p.title + ' · Internal · Dark Matter and Neutrino Lab';
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () {
    if (editing && !confirm('Leave the editor? Changes to this page that you have not clicked Done on will be lost.')) return;
    route();
  });

  // ------------------------------------------------------------ edit
  function slug(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page'; }
  function titleOf(body, fallback) { var m = body.match(/^#\s+(.+)$/m); return m ? m[1].trim() : fallback; }
  function openEditor(p, isNew) {
    editing = { id: p.id, isNew: isNew };
    $('view').hidden = true; $('view-bar').hidden = true; $('editor').hidden = false;
    $('e-id').value = p.id; $('e-body').value = p.body; $('e-preview').innerHTML = md(p.body);
    $('b-delete').hidden = isNew;
    $('e-body').focus();
  }
  $('e-body').addEventListener('input', function () { $('e-preview').innerHTML = md(this.value); });
  $('b-edit').addEventListener('click', function () { if (current) openEditor(page(current), false); });
  $('b-new').addEventListener('click', function () {
    if (editing) return;
    var n = 1, id = 'new-page'; while (page(id)) id = 'new-page-' + (++n);
    openEditor({ id: id, body: '# New page\n\nWrite here. Link to other pages with [their title](#page-id).\n' }, true);
  });
  $('b-cancel').addEventListener('click', function () { editing = null; route(); });
  $('b-done').addEventListener('click', function () {
    var body = $('e-body').value, id = $('e-id').value.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(id)) { alert('The page id may only use lowercase letters, digits and hyphens.'); return; }
    var title = titleOf(body, id);
    if (id !== editing.id && page(id)) { alert('Another page already uses the id "' + id + '".'); return; }
    var p = editing.isNew ? null : page(editing.id);
    var stamp = new Date().toISOString().slice(0, 10);
    if (!p) { p = { id: id }; wiki.pages.push(p); orderChanged = true; }
    else if (id !== p.id) { deleted[p.id] = true; delete dirty[p.id]; orderChanged = true; }
    p.id = id; p.title = title; p.body = body; p.updated = stamp;
    delete deleted[id]; dirty[id] = p;
    editing = null;
    if (location.hash.slice(1) === id) route(); else location.hash = id;
    renderList();
  });
  $('b-delete').addEventListener('click', function () {
    var p = page(editing.id);
    if (!p || !confirm('Delete the page "' + p.title + '"? This takes effect when you save.')) return;
    wiki.pages = wiki.pages.filter(function (q) { return q !== p; });
    deleted[p.id] = true; delete dirty[p.id]; orderChanged = true; editing = null;
    location.hash = (wiki.pages[0] || {}).id || ''; route();
  });
  function move(step) {
    var i = wiki.pages.indexOf(page(editing.id)), j = i + step;
    if (i < 0 || j < 0 || j >= wiki.pages.length) return;
    var t = wiki.pages[i]; wiki.pages[i] = wiki.pages[j]; wiki.pages[j] = t;
    orderChanged = true; renderList();
  }
  $('b-up').addEventListener('click', function () { move(-1); });
  $('b-down').addEventListener('click', function () { move(1); });

  // ------------------------------------------------------------ save
  function openSave() {
    var t = ''; try { t = localStorage.getItem(TKEY) || ''; } catch (e) {}
    $('token').value = t; $('remember').checked = !!t;
    $('save-msg').textContent = ''; $('save-box').hidden = false;
    $('save-box').scrollIntoView({ behavior: 'smooth' });
  }
  $('b-save-cancel').addEventListener('click', function () { $('save-box').hidden = true; });

  // Apply this tab's changes on top of the latest saved wiki, so two people editing different pages do not clash.
  function merged(remote) {
    var out = { pages: [], updated: new Date().toISOString().slice(0, 10) };
    var mine = {}; wiki.pages.forEach(function (p) { mine[p.id] = p; });
    var seen = {};
    var base = orderChanged ? wiki.pages.map(function (p) { return p.id; }) : remote.pages.map(function (p) { return p.id; });
    remote.pages.forEach(function (p) { if (base.indexOf(p.id) < 0) base.push(p.id); });
    Object.keys(dirty).forEach(function (id) { if (base.indexOf(id) < 0) base.push(id); });
    base.forEach(function (id) {
      if (deleted[id] || seen[id]) return;
      var p = dirty[id] || remote.pages.filter(function (q) { return q.id === id; })[0] || mine[id];
      if (p) { out.pages.push(p); seen[id] = true; }
    });
    return out;
  }
  function done(newWiki, newStore) {
    wiki = newWiki; store = newStore || store; dirty = {}; deleted = {}; orderChanged = false;
    renderList(); route();
  }
  $('b-push').addEventListener('click', function () {
    var token = $('token').value.trim(), msg = $('save-msg');
    if (!token) { msg.textContent = 'Enter a GitHub token, or use "Download encrypted file instead".'; return; }
    try { if ($('remember').checked) localStorage.setItem(TKEY, token); else localStorage.removeItem(TKEY); } catch (e) {}
    var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
    msg.textContent = 'Fetching the latest version…';
    fetch(API + '?ref=' + BRANCH, { headers: headers, cache: 'no-store' }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('GitHub refused the token (' + r.status + ').');
      if (!r.ok) throw new Error('GitHub replied ' + r.status + '.');
      return r.json();
    }).then(function (file) {
      var latest = JSON.parse(dec.decode(unb64(file.content.replace(/\n/g, ''))));
      if (latest.salt !== store.salt) throw new Error('The wiki password was changed since you opened it. Reload the page and unlock it again.');
      return decryptWith(key, latest).then(function (remote) {
        var next = merged(remote);
        return encryptWith(key, next, latest).then(function (st) {
          msg.textContent = 'Saving…';
          var note = $('message').value.trim() || 'Update internal wiki';
          var body = { message: 'Internal wiki: ' + note, branch: BRANCH, sha: file.sha,
                       content: b64(enc.encode(JSON.stringify(st) + '\n')) };
          return fetch(API, { method: 'PUT', headers: headers, body: JSON.stringify(body) }).then(function (r) {
            if (r.status === 409) throw new Error('Someone saved at the same moment. Click Save again.');
            if (!r.ok) throw new Error('GitHub replied ' + r.status + ' while saving.');
            done(next, st);
            $('message').value = '';
            msg.textContent = 'Saved. The website shows the change within about 15 minutes.';
          });
        });
      });
    }).catch(function (err) { msg.textContent = err.message; });
  });
  $('b-download').addEventListener('click', function () {
    encryptWith(key, { pages: wiki.pages, updated: new Date().toISOString().slice(0, 10) }, store).then(function (st) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(st) + '\n'], { type: 'application/json' }));
      a.download = 'internal.enc.json'; document.body.appendChild(a); a.click(); a.remove();
      $('save-msg').textContent = 'Downloaded. Replace data/internal.enc.json in the repository with this file (GitHub: Add file → Upload files, in the data folder).';
    });
  });
  window.addEventListener('beforeunload', function (e) { if (pendingCount() || editing) { e.preventDefault(); e.returnValue = ''; } });

  // ------------------------------------------------------------ start
  fetchStore().then(function (st) { store = st; return tryRemembered(); })
    .catch(function (err) { $('unlock-msg').textContent = err.message; });
})();
