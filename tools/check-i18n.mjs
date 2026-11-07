#!/usr/bin/env node
// Checks every i18n/<lang>.json against i18n/en.json, the source of truth.
//
//   node tools/check-i18n.mjs          all languages (en.json itself is checked for dashes)
//   node tools/check-i18n.mjs de ja    only these
//
// A translation must have exactly en.json's keys, list lengths and value types; keep each
// string's HTML tags, href targets and {placeholders}; set lang and path for its own code; and use
// plain hyphens, never em or en dashes. Keys starting with _ (translator notes) are not compared.
// Exits non-zero on any problem, so a translator can run it until it is quiet.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N = join(ROOT, 'i18n');
const load = code => JSON.parse(readFileSync(join(I18N, `${code}.json`), 'utf8'));
const en = load('en');

// Per-language values, checked separately. badgeLang names the App Store badge in
// src/assets/badges; the build falls back to English without one.
const OWN = new Set(['lang', 'path', 'badgeLang']);
// Values that are the same in every language on purpose (product names).
const SAME = new Set(['home.pricing.plus.title']);
// May read the same as in English (names, the copyright line); not reported as "still English".
const MAY_MATCH = new Set(['ui.copyright', 'support.meta.title', 'privacy.meta.title']);

const tags = s => (s.match(/<\/?[a-z][^>]*>/gi) || []).map(t => t.replace(/\s+(?!href=)[a-z-]+="[^"]*"/gi, '')).sort().join(' ');
const holes = s => (s.match(/\{[a-z]+\}|\{\{[^}]+\}\}/g) || []).sort().join(' ');
const DASH = /[‒–—―−﹘]/;

function dashes(v, path, problems) {
  if (typeof v === 'string') { if (DASH.test(v)) problems.push(`${path}: em/en dash, use " - "`); }
  else if (Array.isArray(v)) v.forEach((x, i) => dashes(x, `${path}[${i}]`, problems));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!k.startsWith('_')) dashes(x, path ? `${path}.${k}` : k, problems);
}

function compare(a, b, path, problems) {
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return problems.push(`${path}: should be a list`);
    if (a.length !== b.length) problems.push(`${path}: ${b.length} items, en has ${a.length}`);
    a.forEach((v, i) => i < b.length && compare(v, b[i], `${path}[${i}]`, problems));
  } else if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return problems.push(`${path}: should be an object`);
    for (const k of Object.keys(a)) {
      if (k.startsWith('_')) continue;
      if (!(k in b)) problems.push(`${path ? path + '.' : ''}${k}: missing`);
      else compare(a[k], b[k], path ? `${path}.${k}` : k, problems);
    }
    for (const k of Object.keys(b)) if (!k.startsWith('_') && !(k in a)) problems.push(`${path ? path + '.' : ''}${k}: not in en.json`);
  } else if (typeof a !== typeof b) {
    problems.push(`${path}: is ${typeof b}, en has ${typeof a}`);
  } else if (typeof a === 'string') {
    if (OWN.has(path)) return;
    if (SAME.has(path)) { if (a !== b) problems.push(`${path}: must stay "${a}"`); return; }
    if (tags(a) !== tags(b)) problems.push(`${path}: HTML differs from en (${tags(a) || 'none'} vs ${tags(b) || 'none'})`);
    if (holes(a) !== holes(b)) problems.push(`${path}: placeholders differ from en (${holes(a) || 'none'} vs ${holes(b) || 'none'})`);
    if (a.trim() && !b.trim()) problems.push(`${path}: empty`);
  } else if (a !== b) {
    problems.push(`${path}: must stay ${JSON.stringify(a)}`);
  }
}

const wanted = process.argv.slice(2);
const codes = wanted.length ? wanted : readdirSync(I18N).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
let bad = 0;
for (const code of codes) {
  let t;
  try { t = load(code); } catch (e) { console.log(`${code}: ${e.message}`); bad++; continue; }
  const problems = [];
  dashes(t, '', problems);
  // In right-to-left text a trailing "+" takes the paragraph direction and shows as "+Kinboard":
  // every "Kinboard+" inside a sentence needs U+200E (LRM) right after it.
  if (t.dir === 'rtl' || code === 'ar') (function lrm(v, p) {
    if (typeof v === 'string') { if (v !== 'Kinboard+' && /Kinboard\+(?!\u200e)/.test(v)) problems.push(`${p}: "Kinboard+" without U+200E after it`); }
    else if (Array.isArray(v)) v.forEach((x, i) => lrm(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!k.startsWith('_')) lrm(x, p ? `${p}.${k}` : k);
  })(t, '');
  if (code !== 'en') {
    compare(en, t, '', problems);
    if (t.lang !== code) problems.push(`lang: should be "${code}"`);
    const path = `/${code.toLowerCase()}/`;
    if (t.path !== path) problems.push(`path: should be "${path}"`);
    const untranslated = [];
    (function walk(a, b, p) {
      if (typeof a === 'string' && a === b && /[a-z]{4,}\s+[a-z]{3,}/i.test(a.replace(/<[^>]+>/g, '')) && !SAME.has(p) && !OWN.has(p) && !MAY_MATCH.has(p)) untranslated.push(p);
      else if (a && typeof a === 'object') for (const k of Object.keys(a)) if (!k.startsWith('_') && b && k in b) walk(a[k], b[k], p ? `${p}.${k}` : k);
    })(en, t, '');
    if (untranslated.length) problems.push(`still English: ${untranslated.slice(0, 8).join(', ')}${untranslated.length > 8 ? ` and ${untranslated.length - 8} more` : ''}`);
  }
  console.log(problems.length ? `${code}: ${problems.length} problem(s)\n  ${problems.join('\n  ')}` : `${code}: ok`);
  if (problems.length) bad++;
}
process.exit(bad ? 1 : 0);
