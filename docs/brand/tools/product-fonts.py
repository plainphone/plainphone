# SPDX-License-Identifier: Apache-2.0
"""Dev-only: builds the product font files for brand direction C.

    python3 docs/brand/tools/product-fonts.py   # needs fonttools and brotli

Fetches the fonts and their licences from google/fonts at the same pinned commit as render.mjs
into docs/brand/.cache/fonts (git-ignored), then writes (Schibsted Grotesk subset to Latin: Danish, Swedish,
Norwegian, German, English and punctuation; IBM Plex Mono unmodified, because "Plex" is a Reserved Font Name):
  web/src/fonts/schibsted-grotesk.woff2       variable, 400-900
  web/src/fonts/ibm-plex-mono-500.woff2
  parent-app/assets/fonts/*.ttf               static 400 and 700, IBM Plex Mono 500
  android/app/src/main/res/font/*.ttf         the same static files, Android resource names
and copies each family's OFL.txt next to the files (Android: assets/licenses/, because res/font
only takes fonts). The output is committed.
"""
import shutil
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT / "docs/brand/.cache/fonts"
GROTESK = CACHE / "SchibstedGrotesk[wght].ttf"
MONO = CACHE / "IBMPlexMono-Medium.ttf"
FONT_REV = "cc5661d43cd4f9aad5567033a8e15ca28dc35c86"  # same as render.mjs
SOURCES = {
    GROTESK.name: "schibstedgrotesk/SchibstedGrotesk%5Bwght%5D.ttf",
    MONO.name: "ibmplexmono/IBMPlexMono-Medium.ttf",
    "OFL-SchibstedGrotesk.txt": "schibstedgrotesk/OFL.txt",
    "OFL-IBMPlexMono.txt": "ibmplexmono/OFL.txt",
}
LICENSES = {"SchibstedGrotesk": CACHE / "OFL-SchibstedGrotesk.txt", "IBMPlexMono": CACHE / "OFL-IBMPlexMono.txt"}

# Basic Latin, Latin-1, Latin Extended-A, general punctuation, euro, arrows used in copy, minus.
UNICODES = "U+0020-007E,U+00A0-00FF,U+0100-017F,U+2010-2027,U+2030-203A,U+20AC,U+2122,U+2190-2193,U+2212,U+2264-2265"


def fetch() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, path in SOURCES.items():
        target = CACHE / name
        if not target.exists():
            url = f"https://raw.githubusercontent.com/google/fonts/{FONT_REV}/ofl/{path}"
            with urllib.request.urlopen(url) as res:
                target.write_bytes(res.read())
            print(f"fetched {name}")


def subsetted(font: TTFont, flavor: str | None) -> TTFont:
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.flavor = flavor
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    font.flavor = flavor
    font.recalcTimestamp = False  # same bytes on every run
    return font


def rename(font: TTFont, family: str, style: str) -> None:
    """Static instance names that iOS (PostScript name) and Android (file name) both find."""
    ps = f"{family.replace(' ', '')}-{style}"
    name = font["name"]
    for nid in (16, 17, 25):
        name.removeNames(nameID=nid)
    for nid, value in {1: family, 2: style, 3: f"{ps};{FONT_REV[:7]}", 4: f"{family} {style}", 6: ps}.items():
        name.setName(value, nid, 3, 1, 0x409)
    os2 = font["OS/2"]
    os2.usWeightClass = 700 if style == "Bold" else 400
    # fsSelection: bit 5 bold, bit 6 regular; clear italic (0) and the rest of the style bits.
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (1 << 5 if style == "Bold" else 1 << 6)
    font["head"].macStyle = 1 if style == "Bold" else 0
    if "STAT" in font:
        del font["STAT"]


def main() -> int:
    fetch()
    web = ROOT / "web/src/fonts"
    expo = ROOT / "parent-app/assets/fonts"
    droid = ROOT / "android/app/src/main/res/font"
    licenses = ROOT / "android/app/src/main/assets/licenses"
    for d in (web, expo, droid, licenses):
        d.mkdir(parents=True, exist_ok=True)

    # Web: one variable file keeps every weight the dashboard uses.
    subsetted(TTFont(GROTESK), "woff2").save(web / "schibsted-grotesk.woff2")
    # IBM Plex has a Reserved Font Name, so it ships unmodified (all glyphs); woff2 only compresses it.
    mono = TTFont(MONO)
    mono.flavor = "woff2"
    mono.recalcTimestamp = False
    mono.save(web / "ibm-plex-mono-500.woff2")

    # React Native and Android need one static file per weight.
    statics = {}
    for style, wght in (("Regular", 400), ("Bold", 700)):
        font = instancer.instantiateVariableFont(TTFont(GROTESK), {"wght": wght})
        rename(font, "Schibsted Grotesk", style)
        statics[f"SchibstedGrotesk-{style}"] = subsetted(font, None)
    android_names = {
        "SchibstedGrotesk-Regular": "schibsted_grotesk_regular",
        "SchibstedGrotesk-Bold": "schibsted_grotesk_bold",
        "IBMPlexMono-Medium": "ibm_plex_mono_medium",
    }
    for ps, font in statics.items():
        font.save(expo / f"{ps}.ttf")
    # The original file, byte for byte.
    shutil.copyfile(MONO, expo / "IBMPlexMono-Medium.ttf")
    for ps, name in android_names.items():
        shutil.copyfile(expo / f"{ps}.ttf", droid / f"{name}.ttf")

    for family, lic in LICENSES.items():
        for d in (web, expo, licenses):
            shutil.copyfile(lic, d / f"OFL-{family}.txt")
    for d in (web, expo, droid, licenses):
        for f in sorted(d.iterdir()):
            print(f"{f.relative_to(ROOT)} {f.stat().st_size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
