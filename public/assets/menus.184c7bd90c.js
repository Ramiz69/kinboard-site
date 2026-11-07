const root = document.documentElement;
let current = null;   // the open menu's controller
for (const wrap of document.querySelectorAll('.menu-wrap')) setup(wrap);
function setup(wrap) {
const btn = wrap.querySelector('.menu-btn');
const list = wrap.querySelector('.menu');
const items = [...list.querySelectorAll('.menu-item')];
const theme = wrap.hasAttribute('data-theme-menu');
let timer = 0, hover = false;
const ctl = { close };
const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
const later = (fn, ms) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
const chosen = () => items.findIndex(i => i.getAttribute('aria-checked') === 'true' || i.hasAttribute('aria-current'));
const focusAt = i => items[(i + items.length) % items.length].focus();
function open(byHover, focusIndex) {
clearTimeout(timer);
if (current && current !== ctl) current.close();
current = ctl;
hover = byHover;
btn.setAttribute('aria-expanded', 'true');
wrap.classList.add('open');
if (focusIndex != null) focusAt(focusIndex);
}
function close(refocus) {
clearTimeout(timer);
if (current === ctl) current = null;
if (!isOpen()) return;
btn.setAttribute('aria-expanded', 'false');
wrap.classList.remove('open');
if (refocus) btn.focus();
}
wrap.addEventListener('pointerenter', e => {
if (e.pointerType !== 'mouse') return;
if (isOpen()) clearTimeout(timer);
else later(() => open(true), current ? 0 : 80);
});
wrap.addEventListener('pointerleave', e => {
if (e.pointerType !== 'mouse') return;
if (!isOpen()) clearTimeout(timer);
else if (hover) later(() => close(false), 200);
});
btn.addEventListener('click', () => {
if (isOpen() && hover) { hover = false; clearTimeout(timer); }
else if (isOpen()) close(false);
else open(false);
});
btn.addEventListener('keydown', e => {
if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
e.preventDefault();
open(false, e.key === 'ArrowUp' ? -1 : Math.max(0, chosen()));
} else if (e.key === 'Escape' && isOpen()) close(true);
});
list.addEventListener('keydown', e => {
const i = items.indexOf(document.activeElement);
if (e.key === 'ArrowDown') focusAt(i + 1);
else if (e.key === 'ArrowUp') focusAt(i - 1);
else if (e.key === 'Home') focusAt(0);
else if (e.key === 'End') focusAt(-1);
else if (e.key === 'Escape') close(true);
else if (e.key === ' ' && i >= 0) items[i].click();   // links don't answer Space by themselves
else return;
e.preventDefault();
});
wrap.addEventListener('focusout', e => { if (!wrap.contains(e.relatedTarget) && !hover) close(false); });
for (const item of items) item.addEventListener('click', () => {
if (theme) {
setTheme(item.dataset.value);
for (const i of items) i.setAttribute('aria-checked', String(i === item));
close(true);
} else if (location.hash) {
item.href = item.getAttribute('href').split('#')[0] + location.hash;   // stay on the same section
}
});
if (theme) {
const cur = root.dataset.theme || 'auto';
for (const i of items) i.setAttribute('aria-checked', String(i.dataset.value === cur));
}
}
function setTheme(v) {
if (v === 'auto') delete root.dataset.theme; else root.dataset.theme = v;
try { v === 'auto' ? localStorage.removeItem('kb-theme') : localStorage.setItem('kb-theme', v); } catch (e) { /* ignore */ }
document.dispatchEvent(new Event('kb:theme'));
}
document.addEventListener('pointerdown', e => { if (current && !e.target.closest('.menu-wrap.open')) current.close(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) current.close(false); });
