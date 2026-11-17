# SPDX-License-Identifier: Apache-2.0
"""Dev-only: turns dashboard screenshots into the images on the setup guide.

    python3 tools/make-setup-images.py <dir with the screenshots> [out-dir]

Input names: <n>-<who|pin|qr|done>-<en|da>-mobile-<light|dark>.png, 780 px wide (390 css px at 2x).
The dark variant is only used when the light one exists, and becomes setup-<n>-<name>-<lang>-dark.webp.
For each: the app header and footer are cut off, the long QR screen is trimmed to the heading,
the code and the status line, and the QR code itself is covered with a plain "QR code" box,
so no scannable (and no real) token ever lands on the public page.
Output: src/img/setup-<n>-<name>-<lang>.webp. Needs Pillow with WebP support.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
LABEL = {"en": "QR code", "da": "QR-kode"}
# (top, bottom) rows to keep, per screen and language. Found with a band scan of the screenshots:
# everything above ~310 is the app header and the "back" link, the footer starts after the last block.
CROPS = {
    ("who", "en"): [(310, 1690)],
    ("who", "da"): [(310, 1780)],
    ("pin", "en"): [(310, 1390)],
    ("pin", "da"): [(310, 1390)],
    # heading + code, then the status line and the note; the four steps in between repeat this page
    ("qr", "en"): [(310, 1366), (1990, 2265)],
    ("qr", "da"): [(310, 1366), (2035, 2310)],
}
QR_ROWS = (606, 1326)  # the white card that holds the code, same in both languages


def cover_qr(im: Image.Image, lang: str) -> None:
    px = im.load()
    w = im.width
    top, bottom = QR_ROWS
    xs, ys = [], []
    # inside the card, clear of its rounded corners (the dark theme's page background is dark too)
    for y in range(top + 20, bottom - 20):
        for x in range(45, w - 45):
            r, g, b = px[x, y][:3]
            if r < 90 and g < 90 and b < 90:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit("no QR code found where expected: check QR_ROWS")
    box = (min(xs) - 6, min(ys) - 6, max(xs) + 6, max(ys) + 6)
    d = ImageDraw.Draw(im)
    d.rectangle(box, fill=(255, 255, 255))
    inner = (box[0], box[1], box[2], box[3])
    d.rounded_rectangle(inner, radius=28, fill=(233, 239, 235), outline=(176, 190, 183), width=3)
    font = ImageFont.truetype(BOLD, 52)
    text = LABEL[lang]
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    cx, cy = (inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2
    d.text((cx - (l + r) / 2, cy - (t + b) / 2), text, font=font, fill=(74, 87, 83))


def make(src: Path, out: Path, name: str, lang: str, num: int, variant: str) -> None:
    im = Image.open(src).convert("RGB")
    if im.width != 780:
        raise SystemExit(f"{src.name}: expected 780 px wide, got {im.width}")
    if name == "qr":
        cover_qr(im, lang)
    bg = im.getpixel((5, im.height - 5))
    if name == "done":
        # a short screen: keep from the progress bar to the button, plus air
        rows = [(310, 800)]
    else:
        rows = CROPS[(name, lang)]
    gap = 28
    parts = [im.crop((0, a, im.width, b)) for a, b in rows]
    height = sum(p.height for p in parts) + gap * (len(parts) - 1)
    sheet = Image.new("RGB", (im.width, height), bg)
    y = 0
    for p in parts:
        sheet.paste(p, (0, y))
        y += p.height + gap
    target = out / f"setup-{num}-{name}-{lang}{'-dark' if variant == 'dark' else ''}.webp"
    sheet.save(target, "WEBP", quality=94, method=6)
    print(f"{target.name}: {sheet.width}x{sheet.height}, {target.stat().st_size // 1024} KB")


def main() -> None:
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "src" / "img"
    out.mkdir(parents=True, exist_ok=True)
    for lang in ("en", "da"):
        for num, name in ((1, "who"), (2, "pin"), (3, "qr"), (8, "done")):
            shot = 4 if num == 8 else num
            light = src / f"{shot}-{name}-{lang}-mobile-light.png"
            if not light.exists():
                print(f"skipped {name}-{lang}: {light.name} not found")
                continue
            for variant in ("light", "dark"):
                f = src / f"{shot}-{name}-{lang}-mobile-{variant}.png"
                if f.exists():
                    make(f, out, name, lang, num, variant)


main()
