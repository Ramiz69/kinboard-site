#!/usr/bin/env python3
"""Regenerates the site's images from the app repository's brand assets.

    python3 tools/images.py [path/to/Kindboard]     (default ../Kindboard next to this repo)

Needs Pillow with WebP (`python3 -m pip install pillow`). Writes:

  src/assets/shots/<lang>/iphone-1..4.webp    the App Store iPhone screenshots, 600 px wide
  src/assets/shots/<lang>/ipad-1, ipad-2, tv-1.webp   the iPad and Apple TV ones (en and ru only)
  src/static/icon.png       512 px app icon (apple-touch-icon, JSON-LD image)
  src/static/favicon.png    64 px, rounded
  src/static/og/og-<lang>.png   1200x630 social images: og-default (logo only), og-en, og-ru (logo + claim)
  src/static/press/         the press kit: 1024 px icon, logo on light and dark, the header banner,
                            full-resolution en screenshots as JPEG, and thumbs/ for the page
                            (build.mjs zips these into public/press/kinboard-press-kit.zip)

The build never runs this: it only reads what it wrote. Run it again when the store screenshots
or the icon change, then `node build.mjs`.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'Kindboard'))
STORE = os.path.join(APP, 'design', 'store')
ASSETS = os.path.join(ROOT, 'src', 'assets', 'shots')
STATIC = os.path.join(ROOT, 'src', 'static')

# The site's languages (build.mjs LANGUAGES). design/store/uk exists too, but the site has no Ukrainian.
LANGS = ['en', 'ru', 'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt-BR', 'tr', 'vi', 'zh-Hans', 'zh-Hant']


def webp(src, dst, width, quality=80):
    im = Image.open(src).convert('RGB')
    h = round(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, 'WEBP', quality=quality, method=6)
    return os.path.getsize(dst)


def shots():
    total = 0
    for lang in LANGS:
        d = os.path.join(STORE, lang)
        if not os.path.isdir(d):
            continue
        for i in range(1, 5):
            p = os.path.join(d, f'iphone-{i}.png')
            if os.path.exists(p):
                total += webp(p, os.path.join(ASSETS, lang, f'iphone-{i}.webp'), 600)
        for name, width in (('ipad-1', 1400), ('ipad-2', 900), ('tv-1', 1600)):
            p = os.path.join(d, f'{name}.png')
            if os.path.exists(p):
                total += webp(p, os.path.join(ASSETS, lang, f'{name}.webp'), width, 78)
    print(f'screenshots: {total / 1024:.0f} KB')


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def icon(size):
    """The app icon from AppIcon.icon: light-appearance gradient, the board, four squares."""
    s = 4 * size  # supersample
    top, bottom = hexrgb('#2B3A4A'), hexrgb('#241C22')
    grad = Image.new('RGB', (s, s))
    px = grad.load()
    # icon.json: from (0.15, 0) to (0.85, 1)
    sx, sy, ex, ey = .15 * s, 0, .85 * s, s
    dx, dy = ex - sx, ey - sy
    ll = dx * dx + dy * dy
    for y in range(0, s, 4):
        for x in range(0, s, 4):
            t = max(0, min(1, ((x - sx) * dx + (y - sy) * dy) / ll))
            c = lerp(top, bottom, t)
            for yy in range(4):
                for xx in range(4):
                    px[x + xx, y + yy] = c
    im = grad.convert('RGBA')
    k = s / 1024
    over = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    d.rounded_rectangle([133.1 * k, 133.1 * k, 890.9 * k, 890.9 * k], radius=181.9 * k, fill=(255, 255, 255, 41))
    im = Image.alpha_composite(im, over)
    d = ImageDraw.Draw(im)
    for x, y, c in ((246.8, 246.8, '#E07A5F'), (538.5, 246.8, '#3D8BBF'), (246.8, 538.5, '#81B29A'), (538.5, 538.5, '#E9B949')):
        d.rounded_rectangle([x * k, y * k, (x + 238.7) * k, (y + 238.7) * k], radius=62.1 * k, fill=c)
    return im.resize((size, size), Image.LANCZOS)


def rounded(im, r=0.225):
    s = im.width * 4
    m = Image.new('L', (s, s), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=s * r, fill=255)
    out = im.copy()
    out.putalpha(m.resize(im.size, Image.LANCZOS))
    return out


def icons():
    icon(512).convert('RGB').save(os.path.join(STATIC, 'icon.png'), optimize=True)
    rounded(icon(64)).save(os.path.join(STATIC, 'favicon.png'), optimize=True)
    print('icons: icon.png 512, favicon.png 64')


CLAIMS = {
    'en': 'The family screen for Apple TV and iPad',
    'ru': 'Экран семьи на Apple TV и iPad',
}


def og():
    src = Image.open(os.path.join(STORE, 'creative', 'header-5244x2950.png')).convert('RGB')
    # Crop to 1200:630 around the centre, then scale.
    w = src.width
    h = round(w * 630 / 1200)
    top = (src.height - h) // 2
    base = src.crop((0, top, w, top + h)).resize((1200, 630), Image.LANCZOS)
    out = os.path.join(STATIC, 'og')
    os.makedirs(out, exist_ok=True)
    base.save(os.path.join(out, 'og-default.png'), optimize=True)
    font = ImageFont.truetype('/System/Library/Fonts/SFNSRounded.ttf', 46)
    try:
        font.set_variation_by_name('Semibold')
    except Exception:
        pass
    for lang, text in CLAIMS.items():
        im = base.copy()
        d = ImageDraw.Draw(im)
        tw = d.textlength(text, font=font)
        d.text(((1200 - tw) / 2, 410), text, font=font, fill=(233, 185, 73))
        im.save(os.path.join(out, f'og-{lang}.png'), optimize=True)
    print('og: og-default, ' + ', '.join(f'og-{l}' for l in CLAIMS))


def wordmark(bg, ink, path):
    """The app icon with the name beside it, on a solid background, 2400x1000."""
    w, h = 2400, 1000
    im = Image.new('RGBA', (w, h), bg)
    mark = rounded(icon(520))
    font = ImageFont.truetype('/System/Library/Fonts/SFNSRounded.ttf', 300)
    try:
        font.set_variation_by_name('Bold')
    except Exception:
        pass
    d = ImageDraw.Draw(im)
    text = 'Kinboard'
    tw = d.textlength(text, font=font)
    gap = 90
    x = round((w - (520 + gap + tw)) / 2)
    im.alpha_composite(mark, (x, (h - 520) // 2))
    asc, desc = font.getmetrics()
    d.text((x + 520 + gap, h / 2), text, font=font, fill=ink, anchor='lm')
    im.convert('RGB').save(path, optimize=True)


PRESS_SHOTS = ['iphone-1', 'iphone-2', 'iphone-3', 'iphone-4', 'ipad-1', 'ipad-2', 'ipad-3', 'tv-1']


def press():
    out = os.path.join(STATIC, 'press')
    thumbs = os.path.join(out, 'thumbs')
    os.makedirs(thumbs, exist_ok=True)
    rounded(icon(1024)).save(os.path.join(out, 'kinboard-icon-1024.png'), optimize=True)
    wordmark((248, 243, 234, 255), (34, 32, 42), os.path.join(out, 'kinboard-logo-on-light.png'))
    wordmark((26, 31, 43, 255), (242, 239, 233), os.path.join(out, 'kinboard-logo-on-dark.png'))
    Image.open(os.path.join(STORE, 'creative', 'header-5244x2950.png')).save(os.path.join(out, 'kinboard-header-5244x2950.png'), optimize=True)
    for name in PRESS_SHOTS:
        src = os.path.join(STORE, 'en', f'{name}.png')
        im = Image.open(src).convert('RGB')
        im.save(os.path.join(out, f'kinboard-{name}.jpg'), 'JPEG', quality=90, optimize=True, progressive=True)
        webp(src, os.path.join(thumbs, f'kinboard-{name}.webp'), 480 if name.startswith('iphone') else 960, 78)
    for name in ('kinboard-logo-on-light', 'kinboard-logo-on-dark'):
        webp(os.path.join(out, f'{name}.png'), os.path.join(thumbs, f'{name}.webp'), 600)
    webp(os.path.join(out, 'kinboard-header-5244x2950.png'), os.path.join(thumbs, 'kinboard-header.webp'), 960)
    total = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out) if os.path.isfile(os.path.join(out, f)))
    print(f'press: {total / 1024 / 1024:.1f} MB')


if __name__ == '__main__':
    if not os.path.isdir(STORE):
        sys.exit(f'no design/store in {APP}')
    shots()
    icons()
    og()
    press()
