// Runs before first paint (a classic script in <head>, allowed by script-src 'self'):
// applies the saved colour scheme and the motion preference so nothing flashes.
// The two theme-color metas in the layout follow prefers-color-scheme; with a manual choice both
// carry that theme's colour, so the browser bar matches whichever media query applies. Auto puts
// each one back to its own colour. menus.js fires kb:theme when the choice changes.
(function () {
  var d = document.documentElement;
  d.classList.remove('no-js');
  d.classList.add('js');
  try {
    var t = localStorage.getItem('kb-theme');
    if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the system */ }
  if (/[?&]motion=reduced/.test(location.search) || matchMedia('(prefers-reduced-motion: reduce)').matches) d.classList.add('rm');

  var metas = document.querySelectorAll('meta[name="theme-color"][media]');
  var own = function (m) { return /dark/.test(m.getAttribute('media')) ? 'dark' : 'light'; };
  var colors = {};
  for (var i = 0; i < metas.length; i++) colors[own(metas[i])] = metas[i].getAttribute('content');
  function tint() {
    var chosen = colors[d.getAttribute('data-theme')];
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', chosen || colors[own(metas[i])]);
  }
  tint();
  document.addEventListener('kb:theme', tint);
})();
