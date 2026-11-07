# Kinboard site

The public site for Kinboard, the family screen for Apple TV and iPad with the iPhone as the
remote. `build.mjs` (Node, no dependencies) builds it from `src/` and `i18n/` into `public/`, and
Cloudflare serves it at **https://kinboard-family.app**. The layout copies the SnowWall site's.

App link deep paths are rewritten by `_redirects` (static, no Worker code), not by a Worker as in
SnowWall: SnowWall needs one only for video byte ranges. The rules use `:seg` (one or more
characters), so they never match the landing page's own path; `wrangler dev` serves
`/app/list/x`, `/ru/join/a/b` with 200 and the landing page, `/app` and `/join` with a 307 to the
slash form, and unknown paths with the 404.

| Path | What | Used by |
|---|---|---|
| `/` | home page, English | Marketing URL in App Store Connect |
| `/support/` | answers and the support address | Support URL in App Store Connect, the app |
| `/privacy/` | privacy policy | Privacy Policy URL in App Store Connect, the app |
| `/ru/`, `/ru/support/`, `/ru/privacy/`, … | the same three pages in every other built language | hreflang alternates |
| `/press/` | press kit, English only: facts, descriptions, icon, logo, banner, screenshots, ZIP | press emails |
| `/app/`, `/join/`, `/ru/app/`, `/ru/join/`, … | app link landing per language (`noindex`, not in the sitemap): "This link opens Kinboard on your iPhone or iPad", the App Store badge, and on `/join/` how a family invitation works | Universal Links opened without the app, or on a computer |
| `_redirects` | written by the build: every deeper path (`/app/list/<id>`, `/app/import`, `/join/x`, `/ru/join/x`) gets its folder's landing page with status 200, URL unchanged | Cloudflare static assets |
| `404.html` | anything else (English, `noindex`) | Cloudflare `not_found_handling` |
| `_headers` | security and cache headers | Cloudflare |
| `/.well-known/apple-app-site-association` | Universal Links: `/app/*` and `/join*` open the app, everything else stays web (served as `application/json` by `_headers`) | iOS and iPadOS |

**Keep the URLs.** App Store Connect and every installed copy of the app link to `/support/`
and `/privacy/`. Each page is `name/index.html`, so it answers at `/name` and `/name/`.

## Layout

```
build.mjs              the build: templates + i18n -> public/, hashed assets, sitemap, robots, size report
i18n/<lang>.json       every visible string, per language; en.json is the source, its _notes explain the keys
src/layout.html        the shared page: <head> with all SEO tags, header with menus, footer
src/pages/*.html       home, support, privacy, 404, applink ({{key}}, {{#list}}…{{/list}}, {{@src/path}})
src/css/               tokens.css (themes, header, menus; shared) + home.css / page.css
src/js/theme-init.js   classic script in <head>: applies the saved theme before first paint
src/js/menus.js        the language and appearance menus (the only module)
src/assets/            content-hashed on build: badges/ (Apple's App Store badges), shots/<lang>/ (screenshots)
src/static/            copied as is: _headers, favicon.png, icon.png, og/ (social images), .well-known/ (AASA)
tools/serve.mjs        local preview that applies _headers (so the CSP is enforced) and the 200 rules in _redirects
tools/check-i18n.mjs   checks every translation against en.json (keys, HTML, placeholders, dashes, RTL marks)
tools/check-site.mjs   checks the built site in public/ (SEO tags, hreflang, sitemap, links, image sizes)
tools/images.py        regenerates screenshots, icons and social images from the app repo (Pillow)
```

## Building and checking

```sh
node build.mjs                 # writes public/, prints page weights
node tools/check-i18n.mjs      # all languages; or: node tools/check-i18n.mjs de ja
node tools/check-site.mjs      # the built public/: SEO tags, hreflang, sitemap, links, img sizes
node tools/serve.mjs 8787      # http://localhost:8787/ with _headers applied
```

`?motion=reduced` on any page forces the Reduce Motion path (the site also follows the system
setting). The appearance menu stores its choice in `localStorage` (`kb-theme`); Auto follows
`prefers-color-scheme`.

## Deployment

Cloudflare Workers Builds (worker `kinboard`) runs `npx wrangler deploy` on every push to `main`
and serves `public/` as static assets (`wrangler.jsonc`). There is no build step on Cloudflare, so
**`public/` is committed**: after changing anything in `src/` or `i18n/`, run `node build.mjs` and
commit `public/` with the change. If a deploy fails, the previous version stays live.

## Switching the domain or the addresses

The origin and both addresses are written once, at the top of `build.mjs`:

```js
const SITE = 'https://kinboard-family.app';
const SUPPORT_EMAIL = 'support@kinboard-family.app';
const PRIVACY_EMAIL = 'privacy@kinboard-family.app';
const PRESS_EMAIL = 'press@kinboard-family.app';
```

Change them, run `node build.mjs`, commit `public/`. Canonical and hreflang links, Open Graph and
Twitter tags, JSON-LD, `sitemap.xml` and `robots.txt` all follow. Translations never contain the
addresses: they use `{supportemail}` and `{privacyemail}`, which the build fills in. Update the
Support and Privacy Policy URLs in App Store Connect when the domain changes.

## Adding a language

`LANGUAGES` in `build.mjs` lists the app's 16 languages in menu order. A language is built once
`i18n/<code>.json` exists; its three pages, the language menu, hreflang, `og:locale` and the
sitemap follow on their own.

1. Copy `i18n/en.json` to `i18n/<code>.json` (codes as in `LANGUAGES`: `pt-BR`, `zh-Hans`, …).
2. Set `lang` to the code, `path` to `/<code in lowercase>/`, `badgeLang` to the code.
3. Translate every value. Read `_notes` in en.json first: it explains the placeholders, HTML,
   product names and the app's own wording (take tab and button names from the app's
   `Localizable.xcstrings`). Plain hyphens " - " only, never em or en dashes, in every language.
4. Run `node tools/check-i18n.mjs <code>` until it says ok, then `node build.mjs`.

Per language, the build also picks up:

- Screenshots from `src/assets/shots/<code>/` (`iphone-1..4.webp`, and `ipad-1`, `ipad-2`, `tv-1`
  where they exist); anything missing falls back to English. `tools/images.py` has already exported
  the iPhone screenshots of all 16 languages; iPad and Apple TV ones exist for en and ru only.
  Screenshots of languages that are not built yet are left out of `public/`.
- Apple's "Download on the App Store" badge, `src/assets/badges/badge-{black,white}-<badgeLang>.svg`
  (black on the light theme, white on the dark one). ar and hi have none and use English.
- A social image `src/static/og/og-<code>.png` if there is one, otherwise `og-default.png` (logo
  only, no text). Add a claim for the language to `CLAIMS` in `tools/images.py` to render one.
- Right to left: languages in `RTL` (`build.mjs`) get `dir="rtl"`. The CSS uses logical properties
  (`inset-inline-start`, `margin-inline-end`, `text-align: start`); keep it that way.

## Press kit

`/press/` is English only and is not part of `i18n/`: its strings are in `src/data/press.json`
(the descriptions are the en-US App Store copy from the app repo's `Tools/asc/store-texts.json`;
keep them in step), its template is `src/pages/press.html`, and its files are in `src/static/press/`
(full-resolution downloads) with `thumbs/` for the page. `node build.mjs` zips every file in
`src/static/press/` except `thumbs/` into `public/press/kinboard-press-kit.zip`, with fixed
timestamps so an unchanged kit gives an identical ZIP. The press address is `PRESS_EMAIL` in
`build.mjs`. Every page's footer links to it; the label "Press" is still hardcoded in
`src/layout.html` until a `ui.press` key is added to every `i18n/<lang>.json`.

## Images

`python3 tools/images.py [path/to/Kindboard]` (default `../Kindboard`) re-exports everything from
the app repository: the store screenshots in `design/store/<lang>/` as WebP, the app icon (drawn
from `AppIcon.icon`'s geometry and colours) as `icon.png` and `favicon.png`, and the 1200x630 social
images from `design/store/creative/header-5244x2950.png`, and the press kit files (1024 px icon, logo on light and dark, the banner, en screenshots as full-resolution JPEG). Run it when the screenshots change, then
build.

## Colours

Dark is the app's evening board: gradient `#2B3A4A -> #1A1F2B -> #241C22`, gold `#E9B949`. Light is
warm paper with a deeper amber (`#8A5300`) for links, since the gold itself is too light for text
on cream. Contrast ratios for AA are noted next to each colour in `src/css/tokens.css`.
