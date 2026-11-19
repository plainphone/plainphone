# SPDX-License-Identifier: Apache-2.0
"""Outline the three wordmark candidates as pure SVG paths and check glyph coverage.

Dev-only. Needs `pip install fonttools`. Fetch the pinned fonts first with
`node docs/brand/render.mjs --fonts`. The output is committed, so rendering the
previews does not need Python.

    python3 docs/brand/tools/wordmarks.py
"""
import json
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

BRAND = Path(__file__).resolve().parent.parent
FONTS = BRAND / ".cache" / "fonts"

# Same settings as site/tools/make-wordmark.py for A, so A keeps today's wordmark.
WORDMARKS = {
    "a": {"font": "AtkinsonHyperlegibleNext[wght].ttf", "axes": {"wght": 640}, "text": "plainphone", "tracking": -12},
    "b": {"font": "BricolageGrotesque[opsz,wdth,wght].ttf", "axes": {"opsz": 48, "wdth": 100, "wght": 700}, "text": "Plainphone", "tracking": -18},
    "c": {"font": "SchibstedGrotesk[wght].ttf", "axes": {"wght": 700}, "text": "plainphone", "tracking": -22},
}

# Every font in every pairing must cover the Nordic and German letters and the digits.
FONTS_TO_CHECK = {
    "a": ["AtkinsonHyperlegibleNext[wght].ttf", "AtkinsonHyperlegibleMono[wght].ttf"],
    "b": ["BricolageGrotesque[opsz,wdth,wght].ttf", "Figtree[wght].ttf"],
    "c": ["SchibstedGrotesk[wght].ttf", "IBMPlexMono-Regular.ttf"],
}
REQUIRED = "æøåÆØÅäöüÄÖÜßéèêÉ0123456789–—’“”„«»·€:"


def outline(spec):
    font = TTFont(FONTS / spec["font"])
    if "fvar" in font:
        font = instantiateVariableFont(font, spec["axes"])
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    ascent = font["hhea"].ascent
    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
    bounds = BoundsPen(glyphs)
    x = 0
    for ch in spec["text"]:
        name = cmap[ord(ch)]
        # Flip y: font units go up, SVG goes down.
        t = (1, 0, 0, -1, x, ascent)
        glyphs[name].draw(TransformPen(pen, t))
        glyphs[name].draw(TransformPen(bounds, t))
        x += glyphs[name].width + spec["tracking"]
    x0, y0, x1, y1 = bounds.bounds
    pad = upm * 0.01
    vb = f"{x0 - pad:.0f} {y0 - pad:.0f} {x1 - x0 + 2 * pad:.0f} {y1 - y0 + 2 * pad:.0f}"
    word = spec["text"].capitalize()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="{word}">'
        f'<path fill="currentColor" d="{pen.getCommands()}"/></svg>\n'
    )


def coverage(name):
    cmap = TTFont(FONTS / name).getBestCmap()
    return [ch for ch in REQUIRED if ord(ch) not in cmap]


report = {}
for key, spec in WORDMARKS.items():
    out = BRAND / "directions" / key / "wordmark.svg"
    out.write_text(outline(spec), encoding="utf-8", newline="\n")
    report[key] = {name: {"missing": coverage(name)} for name in FONTS_TO_CHECK[key]}
    print(f"wrote {out.relative_to(BRAND)}")

(BRAND / "glyph-check.json").write_text(
    json.dumps({"required": REQUIRED, "fonts": report}, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
    newline="\n",
)
missing = [(k, n, v["missing"]) for k, r in report.items() for n, v in r.items() if v["missing"]]
if missing:
    raise SystemExit(f"Missing glyphs: {missing}")
print("glyph check: every font covers", REQUIRED)
