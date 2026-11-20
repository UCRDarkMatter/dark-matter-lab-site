/* Shared page furniture. The header, menu and footer are written here, so the
   navigation is edited in ONE place (the NAV list below) for every page. */
(function () {
  var NAV = [
    ['index.html', 'Home'], ['Experiments.html', 'Research'], ['People.html', 'People'],
    ['Publications.html', 'Publications'], ['Tools.html', 'Tools'], ['Limits.html', 'DM limits'],
    ['Contact.html', 'Contact'], ['Internal.html', 'Internal']
  ];
  /* The Research menu's dropdown. Add an experiment page here and it appears on every page. */
  var EXPERIMENTS = [
    ['Experiments.html', 'Overview'],
    ['DarkSide-20k.html', 'DarkSide-20k'], ['DEAP-3600.html', 'DEAP-3600'], ['DarkSide-50.html', 'DarkSide-50'],
    ['DarkSide-LowMass.html', 'DarkSide-LowMass'], ['DUNE.html', 'DUNE']
  ];
  /* To show the UCR Physics & Astronomy logo in the header, put the image in images/
     and set LOGO to its path, e.g. 'images/ucr-physics-astronomy.png'. */
  var LOGO = '';

  var root = document.documentElement, KEY = 'dmlab-theme';
  try { var saved = localStorage.getItem(KEY); if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved); } catch (e) {}
  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var inResearch = EXPERIMENTS.some(function (e) { return e[0].toLowerCase() === page; });
  var items = NAV.map(function (n) {
    var mine = n[0].toLowerCase() === page || (n[0] === 'Experiments.html' && inResearch);
    var link = '<a href="' + n[0] + '"' + (mine ? ' aria-current="' + (n[0].toLowerCase() === page ? 'page' : 'true') + '"' : '') + '>' + n[1] + '</a>';
    if (n[0] !== 'Experiments.html') return '<li>' + link + '</li>';
    var sub = EXPERIMENTS.map(function (e) {
      return '<li><a href="' + e[0] + '"' + (e[0].toLowerCase() === page ? ' aria-current="page"' : '') + '>' + e[1] + '</a></li>';
    }).join('');
    return '<li class="has-sub">' + link +
      '<button class="sub-btn" type="button" aria-expanded="false" aria-controls="sub-research" aria-label="Show experiments">▾</button>' +
      '<ul class="sub" id="sub-research">' + sub + '</ul></li>';
  }).join('');
  document.body.insertAdjacentHTML('afterbegin',
    '<a class="skip" href="#main">Skip to main content</a>' +
    '<header class="site-header"><div class="wrap">' +
    '<a class="wordmark" href="index.html" aria-label="Dark Matter and Neutrino Lab, home">' +
    (LOGO ? '<img src="' + LOGO + '" alt="UCR Physics &amp; Astronomy">' : '') + '<span>⟨χ|UCR|ν⟩</span></a>' +
    '<nav class="nav" aria-label="Main">' +
    '<button class="icon-btn" id="menu-btn" type="button" aria-expanded="false" aria-controls="nav-list">Menu</button>' +
    '<ul id="nav-list">' + items + '</ul>' +
    '<button class="icon-btn" id="theme-btn" type="button"></button>' +
    '</nav></div></header>');

  var tb = document.getElementById('theme-btn');
  function label() {
    tb.textContent = isDark() ? '☀' : '☾';
    tb.setAttribute('aria-label', isDark() ? 'Switch to day mode' : 'Switch to night mode');
    tb.title = tb.getAttribute('aria-label');
  }
  label();
  tb.addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
    label();
  });
  var mb = document.getElementById('menu-btn'), list = document.getElementById('nav-list');
  var hs = list.querySelector('.has-sub'), sb = hs.querySelector('.sub-btn');
  function setSub(open) { hs.classList.toggle('open', open); sb.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  sb.addEventListener('click', function (e) { e.stopPropagation(); setSub(!hs.classList.contains('open')); });
  document.addEventListener('click', function (e) { if (!hs.contains(e.target)) setSub(false); });
  hs.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setSub(false); sb.focus(); } });
  hs.addEventListener('focusout', function (e) { if (!hs.contains(e.relatedTarget)) setSub(false); });
  mb.addEventListener('click', function () {
    mb.setAttribute('aria-expanded', list.classList.toggle('open') ? 'true' : 'false');
  });

  document.addEventListener('DOMContentLoaded', function () {
    document.body.insertAdjacentHTML('beforeend',
      '<footer class="site-footer"><div class="wrap">' +
      '<div>Shawn Westerdale : Dark Matter and Neutrino Lab @ UC Riverside<br>Department of Physics &amp; Astronomy, 900 University Ave., Riverside, CA 92521</div>' +
      '<div><a href="mailto:shawn.westerdale@ucr.edu">shawn.westerdale@ucr.edu</a> · 951-827-3272<br>© ' + new Date().getFullYear() + '</div>' +
      '</div></footer>');
  });
})();
