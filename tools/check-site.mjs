#!/usr/bin/env node
// Checks the built site in public/ (run `node build.mjs` first). Zero dependencies.
//
//   node tools/check-site.mjs
//
// For every page: unique <title> (<= 60 chars) and meta description (70-160 chars), canonical is
// the page's own URL, hreflang alternates are complete and reciprocal with x-default, html lang
// and dir, og:url / og:locale / og:image absolute and existing, twitter:image, apple-itunes-app,
// JSON-LD parses. Site-wide: sitemap lists every indexable page with its alternates, robots.txt
// points to the sitemap, every internal href/src resolves to a file, every <img> has width and
// height, mailto addresses are the
// three known ones, no dash look-alikes (U+2012-2015, U+2212, U+FE58), no old hosts.
// Exits 1 on any error; length warnings do not fail.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'public');
const SITE = 'https://kinboard-family.app';
const MAILTO = new Set(['support@kinboard-family.app', 'privacy@kinboard-family.app', 'press@kinboard-family.app']);
const RTL = new Set(['ar']);
const DASH = /[\u2012\u2013\u2014\u2015\u2212\uFE58]/;
const OLD_HOST = /workers\.dev|gmail\.com|kinboard\.app(?!\S*family)|kindboard/i;

const errors = [], warnings = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warnings.push(`${f}: ${m}`);
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const meta = (html, attr, name) => {
  const m = html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`));
  return m ? decode(m[1]) : null;
};
// URL path -> file in public/, or null.
const resolve = p => {
  p = decodeURIComponent(p.split('#')[0].split('?')[0]);
  const f = join(DIST, p);
  if (p.endsWith('/')) return existsSync(join(f, 'index.html')) ? join(f, 'index.html') : null;
  if (existsSync(f) && statSync(f).isFile()) return f;
  if (existsSync(join(f, 'index.html'))) return join(f, 'index.html');
  return null;
};
// Display width: CJK and Hangul count double, as search results lay them out.
const width = s => [...s].reduce((n, c) => n + (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(c) ? 2 : 1), 0);
const urlPath = file => '/' + relative(DIST, file).split('\\').join('/').replace(/index\.html$/, '');

const files = walk(DIST);
const htmlFiles = files.filter(f => f.endsWith('.html'));
const pages = new Map();   // url path -> { file, title, desc, alternates, noindex }

for (const file of files) {
  if (!/\.(html|xml|txt|json|js|css|svg)$|_headers$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  const rel = relative(DIST, file);
  text.split('\n').forEach((line, i) => {
    if (DASH.test(line)) err(`${rel}:${i + 1}`, `dash look-alike U+${line.match(DASH)[0].codePointAt(0).toString(16).toUpperCase()}`);
    if (OLD_HOST.test(line)) err(`${rel}:${i + 1}`, `old host or address: ${line.match(OLD_HOST)[0]}`);
  });
}

for (const file of htmlFiles) {
  const rel = relative(DIST, file);
  const html = readFileSync(file, 'utf8');
  const path = urlPath(file);
  const noindex = /<meta name="robots" content="noindex">/.test(html);
  const title = decode((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  const desc = meta(html, 'name', 'description');
  const lang = (html.match(/<html lang="([^"]+)"/) || [])[1];
  const dir = (html.match(/<html[^>]* dir="([^"]+)"/) || [])[1];

  // Links and assets, for every page including 404.
  for (const [, attr, url] of html.matchAll(/\s(href|src|content)="([^"]+)"/g)) {
    if (attr === 'content' && !url.startsWith(SITE)) continue;
    if (url.startsWith('mailto:')) { const a = url.slice(7).split('?')[0]; if (!MAILTO.has(a)) err(rel, `unexpected mailto ${a}`); continue; }
    if (/^(https?:)?\/\//.test(url) && !url.startsWith(SITE)) continue;
    if (/^(#|data:|tel:)/.test(url)) continue;
    const p = url.startsWith(SITE) ? url.slice(SITE.length) || '/' : url.startsWith('/') ? url : join(dirname(path + 'x'), url);
    if (!resolve(p)) err(rel, `broken ${attr} ${url}`);
  }
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) if (!html.includes(`id="${id}"`)) err(rel, `missing anchor #${id}`);
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) err(rel, `img without width/height: ${tag.slice(0, 80)}`);

  if (!lang) err(rel, 'no html lang');
  if (dir !== (RTL.has(lang) ? 'rtl' : 'ltr')) err(rel, `dir="${dir}" for lang ${lang}`);
  if (!/<meta name="apple-itunes-app" content="app-id=\d+">/.test(html)) err(rel, 'no apple-itunes-app');
  if (noindex) continue;

  if (!title) err(rel, 'no <title>');
  else if (width(title) > 60) warn(rel, `title width ${width(title)}: ${title}`);
  if (!desc) err(rel, 'no meta description');
  else if (width(desc) < 70 || width(desc) > 160) warn(rel, `description width ${width(desc)}: ${desc}`);

  const canonical = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
  if (canonical !== SITE + path) err(rel, `canonical ${canonical}, expected ${SITE + path}`);
  for (const [k, v] of [['og:url', meta(html, 'property', 'og:url')], ['og:image', meta(html, 'property', 'og:image')], ['twitter:image', meta(html, 'name', 'twitter:image')]]) {
    if (!v || !v.startsWith(SITE + '/')) err(rel, `${k} not absolute on ${SITE}: ${v}`);
    else if (!resolve(v.slice(SITE.length))) err(rel, `${k} points to a missing file: ${v}`);
  }
  if (meta(html, 'property', 'og:url') !== canonical) err(rel, 'og:url differs from canonical');
  const ogLocale = meta(html, 'property', 'og:locale');
  if (!ogLocale || !/^[a-z]{2}_[A-Z]{2}$/.test(ogLocale) || ogLocale.slice(0, 2) !== lang.slice(0, 2)) err(rel, `og:locale ${ogLocale} for lang ${lang}`);

  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const d = JSON.parse(json); if (d.url && d.url !== canonical) err(rel, `JSON-LD url ${d.url}`); } catch (e) { err(rel, `JSON-LD does not parse: ${e.message}`); }
  }

  const alternates = Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => [m[1], m[2]]));
  pages.set(path, { rel, title, desc, lang, alternates });
}

// Uniqueness.
for (const key of ['title', 'desc']) {
  const seen = new Map();
  for (const [, p] of pages) { if (seen.has(p[key])) err(p.rel, `${key} same as ${seen.get(p[key])}`); else seen.set(p[key], p.rel); }
}

// hreflang: every page with alternates lists itself, x-default, and the same set as each alternate.
for (const [path, p] of pages) {
  const alts = p.alternates;
  if (!Object.keys(alts).length) continue;
  if (alts[p.lang] !== SITE + path) err(p.rel, `hreflang ${p.lang} is ${alts[p.lang]}, not itself`);
  if (!alts['x-default']) err(p.rel, 'no x-default');
  for (const [hl, href] of Object.entries(alts)) {
    const other = pages.get(href.slice(SITE.length));
    if (!other) { err(p.rel, `hreflang ${hl} -> ${href} is not a page`); continue; }
    if (hl !== 'x-default' && other.lang !== hl) err(p.rel, `hreflang ${hl} -> page with lang ${other.lang}`);
    if (JSON.stringify(other.alternates) !== JSON.stringify(alts)) err(p.rel, `alternates not reciprocal with ${other.rel}`);
  }
}

// Sitemap and robots.
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
for (const [path, p] of pages) {
  if (!locs.has(SITE + path)) { err('sitemap.xml', `missing ${path}`); continue; }
  const block = sitemap.split('<url>').find(b => b.includes(`<loc>${SITE + path}</loc>`));
  for (const [hl, href] of Object.entries(p.alternates)) if (!block.includes(`hreflang="${hl}" href="${href}"`)) err('sitemap.xml', `${path} lacks alternate ${hl}`);
}
for (const loc of locs) if (!pages.has(loc.slice(SITE.length))) err('sitemap.xml', `lists ${loc}, which is not an indexable page`);
const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
if (!robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) err('robots.txt', 'no Sitemap line');

for (const w of warnings) console.log('warn  ' + w);
for (const e of errors) console.log('ERROR ' + e);
console.log(`${pages.size} indexable pages, ${htmlFiles.length} HTML files: ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
