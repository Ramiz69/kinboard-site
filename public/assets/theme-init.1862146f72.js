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
