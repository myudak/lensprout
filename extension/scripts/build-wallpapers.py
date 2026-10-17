#!/usr/bin/env python3
"""
Converts the user's wallpaper folder (../MacOSWallapapers by default) into the local wallpaper
pack at local-assets/wallpapers: <id>.webp (long side 2880 px), <id>-thumb.webp (224x140 cover
crop) and index.json. wxt.config.ts copies the pack into local builds only; `npm run zip` leaves
it out because these images belong to Apple and Microsoft and may not be redistributed.

Needs Pillow, plus ffmpeg on PATH for .heic files (ffmpeg 7.1+ assembles HEIF tile grids).
Usage: python scripts/build-wallpapers.py [source folder]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', 'MacOSWallapapers'))
OUT = os.path.join(ROOT, 'local-assets', 'wallpapers')
LONG_SIDE, THUMB = 2880, (224, 140)

# File name -> (id, display name). Unknown files get an id from their name.
KNOWN = {
    'Appearance_Light.png': ('big-sur-light', 'Big Sur light'),
    'Appearance_Dark.png': ('big-sur-dark', 'Big Sur dark'),
    'Monterey Graphic (1).heic': ('monterey-light', 'Monterey light'),
    '12-Dark.jpg': ('monterey-dark', 'Monterey dark'),
    'Ventura light.jpg': ('ventura-light', 'Ventura light'),
    'Ventura dark.jpg': ('ventura-dark', 'Ventura dark'),
    'Chroma Red.heic': ('chroma-red', 'Chroma red'),
    'Windows 11 Compressed (PNG).png': ('bloom', 'Bloom'),
}
EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif')


def slug(name: str) -> str:
    base = os.path.splitext(name)[0].lower()
    return '-'.join(''.join(c if c.isalnum() else ' ' for c in base).split())[:36] or 'wallpaper'


def load(path: str, scratch: str) -> Image.Image:
    if path.lower().endswith(('.heic', '.heif')):
        png = os.path.join(scratch, 'decoded.png')
        subprocess.run(
            ['ffmpeg', '-hide_banner', '-v', 'error', '-i', path, '-frames:v', '1', '-y', png],
            check=True,
        )
        path = png
    return Image.open(path).convert('RGB')


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    w, h = size
    scale = max(w / image.width, h / image.height)
    scaled = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left, top = (scaled.width - w) // 2, (scaled.height - h) // 2
    return scaled.crop((left, top, left + w, top + h))


def main() -> None:
    if not os.path.isdir(SOURCE):
        sys.exit(f'No wallpaper folder at {SOURCE}')
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    order = list(KNOWN)
    names = sorted(
        (f for f in os.listdir(SOURCE) if f.lower().endswith(EXTENSIONS)),
        key=lambda f: (order.index(f) if f in KNOWN else len(order), f.lower()),
    )
    entries, seen = [], set()
    with tempfile.TemporaryDirectory() as scratch:
        for name in names:
            wid, label = KNOWN.get(name, (slug(name), os.path.splitext(name)[0]))
            while wid in seen:
                wid += '-2'
            seen.add(wid)
            image = load(os.path.join(SOURCE, name), scratch)
            full = image.copy()
            full.thumbnail((LONG_SIDE, LONG_SIDE), Image.LANCZOS)
            full.save(os.path.join(OUT, f'{wid}.webp'), 'WEBP', quality=84, method=6)
            cover(image, THUMB).save(os.path.join(OUT, f'{wid}-thumb.webp'), 'WEBP', quality=80, method=6)
            entries.append({'id': wid, 'name': label, 'width': full.width, 'height': full.height})
            kb = os.path.getsize(os.path.join(OUT, f'{wid}.webp')) // 1024
            print(f'{name} -> {wid}.webp {full.width}x{full.height} {kb} kB')
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(entries, f, indent=2)
    print(f'{len(entries)} wallpapers in {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
