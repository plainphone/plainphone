# SPDX-License-Identifier: Apache-2.0
"""Build the Plainphone wordmark and mark as pure SVG paths.

Dev-only. Needs `pip install fonttools brotli`. The output is committed, so
the site build itself has no dependencies.

    python3 tools/make-wordmark.py src/fonts/atkinson-hyperlegible-next.woff2 src
"""
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

WORD = "plainphone"
WEIGHT = 640
TRACKING = -12  # font units between letters

font_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
font = instantiateVariableFont(TTFont(font_path), {"wght": WEIGHT})
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
ascent = font["hhea"].ascent

# Mark: a circle with one level bar through it. "Minus the noise."
# Drawn in a 1000-unit box; the circle sits on the x-height band of the text.
xh = font["OS/2"].sxHeight
mark_d = xh * 1.42          # circle diameter
mark_r = mark_d / 2
bar_h = mark_d * 0.16
bar_w = mark_d * 0.56
gap = mark_d * 0.36

pen = SVGPathPen(glyphs)
bounds = BoundsPen(glyphs)
x = mark_d + gap
for ch in WORD:
    name = cmap[ord(ch)]
    # flip y: font units grow upwards, SVG downwards
    glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, ascent)))
    glyphs[name].draw(TransformPen(bounds, (1, 0, 0, -1, x, ascent)))
    x += glyphs[name].width + TRACKING
width = x - TRACKING
text_d = pen.getCommands()

baseline = ascent
cy = baseline - xh / 2
cx = mark_r
desc = font["hhea"].descent  # negative
top = baseline - ascent * 0.98
height = ascent - desc


def circle_bar(cx, cy):
    # Circle with the bar cut out (evenodd), so it works on any background.
    return (
        f"M{cx - mark_r:.1f} {cy:.1f}a{mark_r:.1f} {mark_r:.1f} 0 1 0 {mark_d:.1f} 0"
        f"a{mark_r:.1f} {mark_r:.1f} 0 1 0 {-mark_d:.1f} 0Z"
        f"M{cx - bar_w / 2:.1f} {cy - bar_h / 2:.1f}h{bar_w:.1f}v{bar_h:.1f}h{-bar_w:.1f}Z"
    )


_, ymin, _, ymax = bounds.bounds
vb_top = min(ymin, cy - mark_r) - 4
height = max(ymax, cy + mark_r) + 4 - vb_top
wordmark = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {vb_top:.0f} {width:.0f} {height:.0f}" '
    f'role="img" aria-labelledby="t"><title id="t">Plainphone</title>'
    f'<path fill="currentColor" fill-rule="evenodd" d="{circle_bar(cx, cy)}"/>'
    f'<path fill="currentColor" d="{text_d}"/></svg>\n'
)
(out_dir / "wordmark.svg").write_text(wordmark)

# Standalone mark / favicon: ink circle, paper bar. Fixed colours (no <style>),
# so the site's strict CSP cannot strip them; it reads on light and dark tabs.
m = 64
r = 30
bw, bh = r * 2 * 0.56, r * 2 * 0.16
favicon = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {m} {m}">'
    f'<circle cx="32" cy="32" r="{r}" fill="#1d2a30" stroke="#f3f5f2" stroke-width="2"/>'
    f'<rect fill="#f3f5f2" x="{32 - bw / 2:.1f}" y="{32 - bh / 2:.1f}" width="{bw:.1f}" height="{bh:.1f}" rx="1.5"/></svg>\n'
)
(out_dir / "favicon.svg").write_text(favicon)
print(f"wordmark {width:.0f}x{height:.0f} units, upm {upm}")
