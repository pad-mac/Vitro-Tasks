"""Draws the full-bleed iOS app icon (iOS rounds the corners itself).

usage: python3 scripts/ios-icon.py src-tauri/icons/ios-icon.png
Same mark as icons/icon.png, scaled so the desktop icon's rounded square fills the canvas.
"""
import sys
from PIL import Image, ImageDraw

S = 4  # supersampling
N = 1024 * S
BG, FG, ACCENT = (35, 39, 45), (236, 238, 240), (207, 74, 34)

def m(x, y):
    """Maps a point on the 512 px desktop icon (rounded square 32..480) to the canvas."""
    k = N / 448
    return ((x - 256) * k + N / 2, (y - 256) * k + N / 2)

im = Image.new("RGB", (N, N), BG)
d = ImageDraw.Draw(im)
w = 46 * N / 448
pts = [m(155, 165), m(255.5, 359), m(356, 165)]
d.line(pts, fill=FG, width=round(w), joint="curve")
for (x, y) in pts:
    r = w / 2
    d.ellipse((x - r, y - r, x + r, y + r), fill=FG)
cx, cy = m(371, 371)
h = 30 * N / 448
d.polygon([(cx, cy - h), (cx + h, cy), (cx, cy + h), (cx - h, cy)], fill=ACCENT)
im.resize((1024, 1024), Image.LANCZOS).save(sys.argv[1])
