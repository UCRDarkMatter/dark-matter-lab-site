/* Shared page furniture. The header, menu and footer are written here, so the
   navigation is edited in ONE place (the NAV list below) for every page. */
(function () {
  var NAV = [
    ['index.html', 'Home'], ['Experiments.html', 'Research'], ['People.html', 'People'],
    ['Publications.html', 'Publications'], ['Tools.html', 'Tools'], ['Limits.html', 'DM limits'],
    ['Outreach.html', 'Outreach'], ['Contact.html', 'Contact']
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
  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (/^(darkside-20k|deap-3600|darkside-50|darkside-lowmass|dune)\.html$/.test(here)) here = 'experiments.html';  // experiment pages sit under Research
  var items = NAV.map(function (n) {
    return '<li><a href="' + n[0] + '"' + (n[0].toLowerCase() === here ? ' aria-current="page"' : '') + '>' + n[1] + '</a></li>';
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
