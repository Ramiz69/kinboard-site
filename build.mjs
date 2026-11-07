#!/usr/bin/env node
// Builds public/ from src/ and i18n/. Zero dependencies: Node 18+ standard library only.
//
//   node build.mjs
//
// What it does: copies src/static as is; content-hashes src/assets, the CSS bundles and the JS
// into public/assets/ (served immutable); renders the home, support and privacy pages per
// language from src/pages/*.html inside src/layout.html with i18n/<lang>.json; renders 404.html;
// renders the English press kit at /press/ and zips its files; writes sitemap.xml and robots.txt;
// prints page weights.

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, extname, basename, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// ---------- the only places the origin and the addresses are written ----------
// Change the domain here and rebuild: canonical, hreflang, Open Graph, JSON-LD, sitemap and
// robots.txt all follow.
const SITE = 'https://kinboard-family.app';
const SUPPORT_EMAIL = 'support@kinboard-family.app';
const PRIVACY_EMAIL = 'privacy@kinboard-family.app';
const PRESS_EMAIL = 'press@kinboard-family.app';

const APP_ID = '6831690840';
const APP_STORE = `https://apps.apple.com/app/id${APP_ID}`;
const PRICE_USD = '19.99';            // Kinboard+, US storefront; shown as {price} and in JSON-LD
const PRIVACY_DATE = '2026-11-07';    // machine date of privacy.updated, for <time datetime>

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'public');

// Every language the app ships in, in the order the language menu lists them. A language joins
// the site (its three pages, the menu, hreflang, og:locale, sitemap) once i18n/<code>.json exists.
// No flags: a flag names a country, not a language. Each language is shown by its own name.
const LANGUAGES = [
  { code: 'en', short: 'EN', name: 'English' },
  { code: 'ru', short: 'RU', name: 'Русский' },
  { code: 'ar', short: 'AR', name: 'العربية' },
  { code: 'de', short: 'DE', name: 'Deutsch' },
  { code: 'es', short: 'ES', name: 'Español' },
  { code: 'fr', short: 'FR', name: 'Français' },
  { code: 'hi', short: 'HI', name: 'हिन्दी' },
  { code: 'id', short: 'ID', name: 'Bahasa Indonesia' },
  { code: 'it', short: 'IT', name: 'Italiano' },
  { code: 'ja', short: 'JA', name: '日本語' },
  { code: 'ko', short: 'KO', name: '한국어' },
  { code: 'pt-BR', short: 'PT', name: 'Português (Brasil)' },
  { code: 'tr', short: 'TR', name: 'Türkçe' },
  { code: 'uk', short: 'UK', name: 'Українська' },
  { code: 'vi', short: 'VI', name: 'Tiếng Việt' },
  { code: 'zh-Hans', short: '简', name: '简体中文' },
  { code: 'zh-Hant', short: '繁', name: '繁體中文' },
].map(l => ({ ...l, path: l.code === 'en' ? '/' : `/${l.code.toLowerCase()}/` }));
const OG_LOCALE = {
  en: 'en_US', ru: 'ru_RU', ar: 'ar_AR', de: 'de_DE', es: 'es_ES', fr: 'fr_FR', hi: 'hi_IN', id: 'id_ID',
  it: 'it_IT', ja: 'ja_JP', ko: 'ko_KR', 'pt-BR': 'pt_BR', tr: 'tr_TR', uk: 'uk_UA', vi: 'vi_VN', 'zh-Hans': 'zh_CN', 'zh-Hant': 'zh_TW',
};
const RTL = new Set(['ar']);
const BUILT = LANGUAGES.filter(l => existsSync(join(ROOT, 'i18n', `${l.code}.json`)));

// The three pages every language has. `key` is the i18n section with its meta.
const PAGES = [
  { id: 'home', dir: '', tpl: 'home.html', css: 'home' },
  { id: 'support', dir: 'support/', tpl: 'support.html', css: 'page' },
  { id: 'privacy', dir: 'privacy/', tpl: 'privacy.html', css: 'page' },
];
const pagePath = (l, id) => l.path + PAGES.find(p => p.id === id).dir;
// The press kit is English only (strings in src/data/press.json, not in i18n/); every language links to it.
const PRESS_PATH = '/press/';
const PRESS_ZIP = 'kinboard-press-kit.zip';

const read = p => readFileSync(p, 'utf8');
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const hash = buf => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const walk = dir => existsSync(dir) ? readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : [];
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const attr = s => String(s).replace(/&(?!amp;|lt;|gt;|quot;|#)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fail = msg => { throw new Error(msg); };

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// ---------- static files, copied as they are ----------
for (const f of walk(join(SRC, 'static'))) {
  if (basename(f) === '.DS_Store') continue;
  const out = join(DIST, relative(join(SRC, 'static'), f));
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(f, out);
}
write(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

// ---------- hashed assets ----------
const assets = new Map();   // 'assets/x.svg' | 'css/home.css' | 'js/menus.js' -> '/assets/x.<hash>.svg'
function emit(key, content, ext) {
  // Screenshots keep their language in the name: shots/ru/iphone-1.webp -> iphone-1-ru.<hash>.webp
  const parts = key.split('/');
  const stem = basename(key, extname(key)) + (parts[1] === 'shots' ? `-${parts[2]}` : '');
  const name = `${stem}.${hash(content)}${ext || extname(key)}`;
  write(join(DIST, 'assets', name), content);
  assets.set(key, `/assets/${name}`);
  return `/assets/${name}`;
}
// Screenshots of languages that are not built yet stay out of public/.
const builtCodes = new Set(BUILT.map(l => l.code));
for (const f of walk(join(SRC, 'assets'))) {
  const key = relative(SRC, f).split('\\').join('/');
  const m = key.match(/^assets\/shots\/([^/]+)\//);
  if (basename(f) === '.DS_Store' || (m && !builtCodes.has(m[1]))) continue;
  emit(key, readFileSync(f));
}

// Whitespace before ':' is kept: in a selector it is a descendant combinator (`html:lang(ja) :is(h1)`
// is not `html:lang(ja):is(h1)`); in a declaration a space before ':' is never written anyway.
const minCss = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/:\s+/g, ':').replace(/;}/g, '}').trim();
const tokens = read(join(SRC, 'css/tokens.css'));
for (const sheet of ['home', 'page']) emit(`css/${sheet}.css`, minCss(tokens + '\n' + read(join(SRC, `css/${sheet}.css`))));
const minJs = s => s.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//')).join('\n') + '\n';
for (const f of ['theme-init.js', 'menus.js']) emit(`js/${f}`, minJs(read(join(SRC, 'js', f))));

// ---------- templating ----------
// {{key.path}} inserts a value, {{#list}}…{{/list}} repeats for each item ({{.field}} or {{.}}),
// {{@src/path}} is a hashed asset URL. A missing key is an error, not an empty string.
function render(tpl, data, where) {
  tpl = tpl.replace(/{{#([\w.]+)}}([\s\S]*?){{\/\1}}/g, (_, key, body) => {
    const list = get(data, key);
    if (!Array.isArray(list)) fail(`${where}: {{#${key}}} is not a list`);
    return list.map(item => body.replace(/{{\.(\w*)}}/g, (_, f) => {
      const v = f ? item[f] : item;
      if (v === undefined) fail(`${where}: missing .${f} in ${key}`);
      return v;
    })).join('');
  });
  tpl = tpl.replace(/{{([\w.]+)}}/g, (_, key) => {
    const v = get(data, key);
    if (v === undefined || v === null || typeof v === 'object') fail(`${where}: missing {{${key}}}`);
    return String(v);
  });
  return tpl.replace(/{{@([^}]+)}}/g, (_, p) => assets.get(p) || fail(`${where}: unknown asset ${p}`));
}

// i18n strings may carry {price}, {supportemail}, {privacyemail}; the build fills them in.
const HOLES = { price: `$${PRICE_USD}`, supportemail: SUPPORT_EMAIL, privacyemail: PRIVACY_EMAIL };
const fill = v => typeof v === 'string' ? v.replace(/\{(price|supportemail|privacyemail)\}/g, (_, k) => HOLES[k])
  : Array.isArray(v) ? v.map(fill)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
const loadLang = code => fill(JSON.parse(read(join(ROOT, 'i18n', `${code}.json`))));

// ---------- marks and icons ----------
// The logo: the app icon's four rounded squares, 2x2 (coral, blue, sage, sunflower).
const logo = (size, cls = 'logo') => `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="#1a1f2b"/><rect x="2" y="2" width="28" height="28" rx="6.5" fill="#fff" fill-opacity=".1"/><rect x="6.5" y="6.5" width="8.5" height="8.5" rx="2.3" fill="#E07A5F"/><rect x="17" y="6.5" width="8.5" height="8.5" rx="2.3" fill="#3D8BBF"/><rect x="6.5" y="17" width="8.5" height="8.5" rx="2.3" fill="#81B29A"/><rect x="17" y="17" width="8.5" height="8.5" rx="2.3" fill="#E9B949"/></svg>`;
const icon = body => `<svg class="ico24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
// home.alwaysOn.facts, by position
const FACT_ICONS = [
  '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9.5 2.5h5"/>',
  '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8 20h8"/><path d="M6 7.5h5"/>',
  '<rect x="3" y="3" width="13" height="13" rx="2.5"/><rect x="8" y="8" width="13" height="13" rx="2.5"/>',
  '<path d="M3 19 8 5l5 14"/><path d="M4.8 14h6.4"/><path d="M15 12.5a3 3 0 1 1 0 4.5"/><path d="M21 10v9"/>',
  '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
];
const LOCK = icon('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>').replace('ico24', 'ico24 lock');
const TICK = '<svg class="tick" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg>';
const ticks = items => items.map(i => `<li>${TICK}<span>${i}</span></li>`).join('');

// ---------- header menus: language and colour scheme (same markup as SnowWall) ----------
const svg16 = (body, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const GLOBE = svg16('<circle cx="8" cy="8" r="6.25"/><path d="M1.75 8h12.5M8 1.75c1.8 1.7 2.7 3.8 2.7 6.25S9.8 12.55 8 14.25M8 1.75C6.2 3.45 5.3 5.55 5.3 8s.9 4.55 2.7 6.25"/>', 'globe');
const THEME_ICONS = {
  auto: '<circle cx="8" cy="8" r="5.75"/><path d="M8 2.25a5.75 5.75 0 0 0 0 11.5Z" fill="currentColor"/>',
  light: '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/>',
  dark: '<path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85Z"/>',
};
const CHEVRON = svg16('<path d="m5 6.5 3 3 3-3"/>', 'chev');
const MTICK = svg16('<path d="m3.5 8.5 3 3 6-7"/>', 'tick');

// `here` is the current language code; `hrefs` maps each built language to this page in it.
function headerMenus(ui, here, hrefs) {
  const cur = BUILT.find(l => l.code === here);
  const langItems = BUILT.map(l => `<li><a class="menu-item" tabindex="-1" href="${hrefs[l.code]}" hreflang="${l.code}" lang="${l.code}"${l.code === here ? ' aria-current="page"' : ''}><span class="label">${l.name}</span>${MTICK}</a></li>`).join('');
  const modes = ['auto', 'light', 'dark'];
  const themeIcon = m => svg16(THEME_ICONS[m], 'ico');
  return `<div class="menu-wrap lang-menu">
      <button class="chip menu-btn" type="button" aria-expanded="false" aria-controls="lang-list"><span class="vh">${ui.language}: ${cur.name}</span> ${GLOBE}<span aria-hidden="true">${cur.short}</span>${CHEVRON}</button>
      <ul class="menu" id="lang-list" aria-label="${ui.language}">${langItems}</ul>
    </div>
    <div class="menu-wrap theme-menu" data-theme-menu>
      <button class="chip menu-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-list"><span class="vh">${ui.theme.label}:</span> ${modes.map(m => `<span class="tv tv-${m}">${themeIcon(m)}<span class="tvl">${ui.theme[m]}</span></span>`).join('')}${CHEVRON}</button>
      <div class="menu" id="theme-list" role="menu" aria-label="${ui.theme.label}">${modes.map(m => `<button class="menu-item" type="button" role="menuitemradio" aria-checked="${m === 'auto'}" tabindex="-1" data-value="${m}">${themeIcon(m)}<span class="label">${ui.theme[m]}</span>${MTICK}</button>`).join('')}</div>
    </div>`;
}

// ---------- per-language pieces ----------
// Apple's own "Download on the App Store" badge in the page's language, black for the light
// scheme and white for the dark one (CSS shows one); English when Apple has none for a language.
function badge(t) {
  const lang = assets.has(`assets/badges/badge-black-${t.badgeLang}.svg`) ? t.badgeLang : 'en';
  const [, , w, h] = read(join(SRC, 'assets/badges', `badge-black-${lang}.svg`)).match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const width = Math.round(48 * w / h);
  const img = v => `<img class="b-${v}" src="${assets.get(`assets/badges/badge-${v}-${lang}.svg`)}" alt="${attr(t.ui.badgeAlt)}" width="${width}" height="48">`;
  return `<a class="badge" href="${APP_STORE}">${img('black')}${img('white')}</a>`;
}
// A screenshot in this language, or the English one.
const shot = (lang, name) => assets.get(`assets/shots/${lang}/${name}.webp`) || assets.get(`assets/shots/en/${name}.webp`) || fail(`no screenshot ${name}`);

function head(t, page, path) {
  const m = page === 'home' ? t.home.meta : t[page].meta;
  const url = SITE + path;
  const alternates = [...BUILT.map(l => `<link rel="alternate" hreflang="${l.code}" href="${SITE}${pagePath(l, page)}">`),
    `<link rel="alternate" hreflang="x-default" href="${SITE}${pagePath(BUILT[0], page)}">`];
  const ogImage = `${SITE}/og/${existsSync(join(SRC, 'static/og', `og-${t.lang}.png`)) ? `og-${t.lang}` : 'og-default'}.png`;
  const ogTitle = m.ogTitle || m.title, ogDesc = m.ogDescription || m.description, ogAlt = t.home.meta.ogAlt;
  return [
    `<meta name="description" content="${attr(m.description)}">`,
    `<link rel="canonical" href="${url}">`,
    ...alternates,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Kinboard">',
    `<meta property="og:title" content="${attr(ogTitle)}">`,
    `<meta property="og:description" content="${attr(ogDesc)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${ogImage}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${attr(ogAlt)}">`,
    `<meta property="og:locale" content="${OG_LOCALE[t.lang]}">`,
    ...BUILT.filter(l => l.code !== t.lang).map(l => `<meta property="og:locale:alternate" content="${OG_LOCALE[l.code]}">`),
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${attr(ogTitle)}">`,
    `<meta name="twitter:description" content="${attr(ogDesc)}">`,
    `<meta name="twitter:image" content="${ogImage}">`,
    `<meta name="twitter:image:alt" content="${attr(ogAlt)}">`,
  ].join('\n');
}

function jsonld(t, url) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: 'Kinboard',
    alternateName: 'Kinboard: Family Calendar',
    url,
    inLanguage: t.lang,
    description: t.jsonld.description,
    image: `${SITE}/icon.png`,
    screenshot: SITE + shot(t.lang, 'tv-1'),
    operatingSystem: 'iOS 26, iPadOS 26, tvOS 26',
    applicationCategory: 'LifestyleApplication',
    installUrl: APP_STORE,
    downloadUrl: APP_STORE,
    author: { '@type': 'Person', name: 'Ramiz Kichibekov' },
    offers: [
      { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: APP_STORE },
      { '@type': 'Offer', name: 'Kinboard+', description: t.jsonld.plusDescription, price: PRICE_USD, priceCurrency: 'USD', url: APP_STORE },
    ],
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function pageData(t, page) {
  const l = BUILT.find(x => x.code === t.lang);
  const path = pagePath(l, page);
  const hrefs = { home: pagePath(l, 'home'), support: pagePath(l, 'support'), privacy: pagePath(l, 'privacy'), press: PRESS_PATH };
  const langHrefs = Object.fromEntries(BUILT.map(x => [x.code, pagePath(x, page)]));
  const title = page === 'home' ? t.home.meta.title : t[page].meta.title;
  return {
    ...t,
    dir: RTL.has(t.lang) ? 'rtl' : 'ltr',
    title, path, hrefs,
    appId: APP_ID, supportEmail: SUPPORT_EMAIL, privacyDate: PRIVACY_DATE,
    head: head(t, page, path),
    jsonld: page === 'home' ? jsonld(t, SITE + path) : '',
    css: assets.get(`css/${PAGES.find(p => p.id === page).css}.css`),
    bodyClass: `p-${page}`,
    menus: headerMenus(t.ui, t.lang, langHrefs),
    current: Object.fromEntries(['home', 'support', 'privacy', 'press'].map(k => [k, k === page ? ' aria-current="page"' : ''])),
    logo: logo(30), logoSmall: logo(24, 'logo inline'), logoBig: logo(64, 'logo big'), lock: LOCK,
    badge: badge(t),
    shots: { tv: shot(t.lang, 'tv-1'), ipad: shot(t.lang, 'ipad-1'), ipadTall: shot(t.lang, 'ipad-2') },
    steps: t.home.how.steps.map((s, i) => ({ ...s, n: i + 1 })),
    features: t.home.features.items.map((f, i) => ({ ...f, n: i + 1, shot: shot(t.lang, `iphone-${i + 1}`), shotAlt: attr(f.shotAlt), points: ticks(f.points) })),
    facts: t.home.alwaysOn.facts.map((f, i) => ({ ...f, icon: icon(FACT_ICONS[i] || fail(`no icon for fact ${i}`)) })),
    privacyPoints: ticks(t.home.privacy.points),
    freeItems: ticks(t.home.pricing.free.items),
    plusItems: ticks(t.home.pricing.plus.items),
    faq: t.home.faq.items,
    startSteps: t.support.start.steps,
    supportFaq: t.support.faq.items,
    privacySections: t.privacy.sections.map(s => `<h2>${s.title}</h2>\n${s.paragraphs.map(p => `<p>${p}</p>`).join('\n')}${s.points.length ? `\n<ul>${s.points.map(p => `<li>${p}</li>`).join('')}</ul>` : ''}`).join('\n'),
  };
}

const layout = read(join(SRC, 'layout.html'));
const pages = [];   // [path, file, alternatesGroup | null]
for (const l of BUILT) {
  const t = loadLang(l.code);
  if (t.lang !== l.code || t.path !== l.path) fail(`i18n/${l.code}.json: lang/path should be "${l.code}" and "${l.path}"`);
  for (const p of PAGES) {
    const data = pageData(t, p.id);
    data.content = render(read(join(SRC, 'pages', p.tpl)), data, `${p.id}/${l.code}`);
    const html = render(layout, data, `layout ${p.id}/${l.code}`);
    // The folder is the URL path, lowercase (`/pt-br/`, `/zh-hans/`), not the language code.
    const out = `${data.path.slice(1)}index.html`;
    write(join(DIST, out), html);
    pages.push([data.path, out, p.id]);
  }
}

// 404: English, not indexed, served by Cloudflare for any unknown path.
{
  const t = loadLang('en');
  const data = { ...pageData(t, 'home'), title: `${t.notFound.title} - Kinboard`, jsonld: '', bodyClass: 'p-404',
    css: assets.get('css/page.css'), current: { home: '', support: '', privacy: '', press: '' },
    head: '<meta name="robots" content="noindex">' };
  data.content = render(read(join(SRC, 'pages', '404.html')), data, '404');
  write(join(DIST, '404.html'), render(layout, data, 'layout 404'));
}

// ---------- press kit: /press/, English only ----------
// A ZIP of everything in src/static/press except the page's thumbnails, written at build time.
// Deflate (or store when that is smaller), fixed timestamps, sorted names: the same inputs give
// the same bytes, so public/ only changes in git when the kit does.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(entries) {   // [[name, Buffer]]
  const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 7;
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const packed = deflateRawSync(data, { level: 9 });
    const deflate = packed.length < data.length;
    const body = deflate ? packed : data;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(deflate ? 8 : 0, 8); head.writeUInt16LE(DOS_TIME, 10); head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
    local.push(head, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(deflate ? 8 : 0, 10); cen.writeUInt16LE(DOS_TIME, 12); cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
// Pixel size of a PNG, JPEG or WebP from its header, for <img width height> (no layout jump).
function imageSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  return fail(`${relative(ROOT, file)}: cannot read the image size`);
}
{
  const dir = join(SRC, 'static', 'press');
  const files = readdirSync(dir).filter(f => statSync(join(dir, f)).isFile() && !f.startsWith('.')).sort();
  const zipBuf = zip(files.map(f => [`kinboard-press-kit/${f}`, readFileSync(join(dir, f))]));
  write(join(DIST, 'press', PRESS_ZIP), zipBuf);
  const mb = b => `${(b / 1024 / 1024).toFixed(1)} MB`;
  const sizeOf = f => { const n = statSync(join(dir, f)).size; return n > 1024 * 1024 ? mb(n) : `${Math.round(n / 1024)} KB`; };

  const t = loadLang('en');
  const holes = { price: `$${PRICE_USD}`, pressemail: PRESS_EMAIL, appstore: APP_STORE, site: SITE, sitename: SITE.replace(/^https?:\/\//, ''), zipsize: mb(zipBuf.length) };
  const fillP = v => typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (m, k) => holes[k] ?? fail(`press.json: unknown {${k}}`))
    : Array.isArray(v) ? v.map(fillP) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillP(x)])) : v;
  const press = fillP(JSON.parse(read(join(SRC, 'data', 'press.json'))));
  const data = {
    ...pageData(t, 'home'),
    title: press.meta.title, path: PRESS_PATH, jsonld: '', bodyClass: 'p-press', css: assets.get('css/page.css'),
    // Only English exists: the language menu offers the other languages' home pages.
    menus: headerMenus(t.ui, 'en', Object.fromEntries(BUILT.map(l => [l.code, l.code === 'en' ? PRESS_PATH : l.path]))),
    current: { home: '', support: '', privacy: '', press: ' aria-current="page"' },
    // The home page's head, with this page's text and no language alternates (there are none).
    head: head(t, 'home', PRESS_PATH)
      .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${attr(press.meta.description)}">`)
      .replace(/<link rel="alternate"[^>]*>\n?/g, '')
      .replace(/<meta property="og:locale:alternate"[^>]*>\n?/g, '')
      .replace(/(og|twitter):title" content="[^"]*"/g, `$1:title" content="${attr(press.meta.title)}"`)
      .replace(/(og|twitter):description" content="[^"]*"/g, `$1:description" content="${attr(press.meta.description)}"`),
    press,
    shotItems: press.shots.map(s => {
      const { w: thumbW, h: thumbH } = imageSize(join(dir, 'thumbs', `${s.file}.webp`));
      return { ...s, size: sizeOf(`${s.file}.jpg`), thumbW, thumbH, cls: s.file.includes('iphone') ? 'tall' : 'wide' };
    }),
    brandItems: press.brand.map(b => {
      const { w: thumbW, h: thumbH } = imageSize(join(dir, b.thumb));
      return { ...b, size: sizeOf(b.file), thumbW, thumbH };
    }),
    longHtml: press.long.intro.map(p => `<p>${p}</p>`).join('\n') + '\n' + press.long.sections.map(s => `<h3>${s.title}</h3>\n`
      + s.paragraphs.map(p => `<p>${p}</p>`).join('\n') + (s.points.length ? `<ul>${s.points.map(p => `<li>${p}</li>`).join('')}</ul>` : '')).join('\n'),
    zipHref: `${PRESS_PATH}${PRESS_ZIP}`,
  };
  data.content = render(read(join(SRC, 'pages', 'press.html')), data, 'press');
  write(join(DIST, 'press', 'index.html'), render(layout, data, 'layout press'));
  pages.push([PRESS_PATH, 'press/index.html', 'press']);
}

// ---------- sitemap ----------
const today = new Date().toISOString().slice(0, 10);
const urls = pages.map(([path, , id]) => {
  if (id === 'press') return `  <url><loc>${SITE}${path}</loc><lastmod>${today}</lastmod></url>`;
  const alts = BUILT.map(l => `<xhtml:link rel="alternate" hreflang="${l.code}" href="${SITE}${pagePath(l, id)}"/>`).join('')
    + `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${pagePath(BUILT[0], id)}"/>`;
  return `  <url><loc>${SITE}${path}</loc><lastmod>${today}</lastmod>${alts}</url>`;
});
write(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);

// ---------- report ----------
const size = p => { const b = readFileSync(join(DIST, p.replace(/^\//, ''))); return [b.length, gzipSync(b, { level: 9 }).length]; };
const kb = n => `${(n / 1024).toFixed(1)} KB`;
console.log(`${BUILT.length} languages (${BUILT.map(l => l.code).join(', ')}) · ${pages.length + 1} pages · ${assets.size} hashed assets · ${SITE}`);
for (const [path, file] of [...pages, ['/404.html', '404.html']]) {
  const html = read(join(DIST, file));
  const refs = [...new Set([...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map(m => m[1]))];
  const lazy = new Set([...html.matchAll(/<img[^>]+src="(\/assets\/[^"]+)"[^>]*loading="lazy"/g)].map(m => m[1]));
  const first = refs.filter(u => !lazy.has(u));
  const all = refs.reduce((a, u) => a + size(u)[0], size(file)[0]);
  const [, hg] = size(file);
  const tot = first.reduce((a, u) => a + size(u)[1], hg);
  console.log(`${path.padEnd(16)} html ${kb(hg).padStart(8)} gz · first load ${kb(tot).padStart(8)} gz · everything ${kb(all).padStart(9)}`);
}
