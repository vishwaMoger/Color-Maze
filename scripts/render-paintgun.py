"""Renders the paint gun icon (src/assets/icons/paintgun.webp).

A toy paint blaster seen from the side: glossy violet body and grip, a
glass tank of pink paint on top, a yellow nozzle and trigger, and a few
paint droplets flying out. Each part is a signed distance field whose
bevelled height is shaded per pixel. Run: python3 scripts/render-paintgun.py
"""
import math
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/assets/icons/paintgun.webp'
S = 256
SS = 3
N = S * SS
ys, xs = np.mgrid[0:N, 0:N].astype(np.float64) / SS  # work in 256-space


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def round_box(cx, cy, hw, hh, r, ang=0.0):
    x, y = xs - cx, ys - cy
    if ang:
        c, s = math.cos(ang), math.sin(ang)
        x, y = x * c + y * s, -x * s + y * c
    qx, qy = np.abs(x) - hw + r, np.abs(y) - hh + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def circle(cx, cy, r):
    return np.hypot(xs - cx, ys - cy) - r


parts = [
    # name, sdf, base colour (shade, mid, light), bevel, layer
    ('grip', round_box(98, 166, 19, 44, 15, 0.32), ((70, 30, 170), (120, 76, 240), (190, 160, 255)), 12, 0),
    ('trigger', round_box(130, 150, 6, 16, 5, 0.25), ((200, 120, 0), (255, 196, 30), (255, 240, 150)), 5, 1),
    ('body', round_box(124, 118, 82, 27, 24), ((80, 38, 190), (134, 90, 255), (205, 180, 255)), 14, 2),
    ('nozzle', round_box(214, 118, 16, 15, 7), ((205, 120, 0), (255, 200, 32), (255, 244, 160)), 8, 3),
    ('band', round_box(70, 118, 7, 27, 4), ((200, 120, 0), (255, 196, 30), (255, 240, 150)), 6, 3),
    ('tank', circle(124, 72, 33), ((190, 180, 230), (236, 232, 255), (255, 255, 255)), 22, 4),
]
drops = [(236, 96, 7), (240, 140, 5.5), (226, 82, 4.5)]

img = np.zeros((N, N, 4))
L = np.array([-0.5, -0.65, 0.58]); L /= np.linalg.norm(L)
H = L + np.array([0, 0, 1.0]); H /= np.linalg.norm(H)


def shade(d, bevel, cols, gloss=0.55):
    inside = -d
    h = np.sqrt(np.clip(1 - (1 - np.clip(inside / bevel, 0, 1)) ** 2, 0, 1)) * bevel
    gy, gx = np.gradient(h * SS)
    nx, ny, nz = -gx / SS, -gy / SS, np.ones_like(h) * 0.35
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / ln, ny / ln, nz / ln
    diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    spec = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1)
    lo, mid, hi = (np.array(c, dtype=float) for c in cols)
    t = diff[..., None]
    col = lo + (mid - lo) * smooth(0.1, 0.6, t) + (hi - mid) * smooth(0.65, 1.0, t)
    col = col + 255 * (spec ** 60 * gloss)[..., None]
    edge = smooth(0, 1.4, inside)
    col = col * (0.55 + 0.45 * edge[..., None])
    alpha = np.clip(inside * SS / SS + 0.5, 0, 1)
    return np.clip(col, 0, 255), alpha


for name, d, cols, bevel, _ in parts:
    col, a = shade(d, bevel, cols)
    if name == 'tank':
        # Pink paint filling the lower part of the glass, with a meniscus.
        fill = smooth(-0.5, 0.5, (ys - (72 - 2 + np.sin((xs - 124) / 9) * 1.2)))
        paint, _ = shade(d, bevel, ((170, 10, 80), (255, 45, 140), (255, 160, 205)), 0.4)
        col = col * (1 - fill[..., None]) + paint * fill[..., None]
        # Glass highlight.
        hl = smooth(0.5, 0.0, np.hypot((xs - 110) / 12, (ys - 58) / 7) - 0.5)
        col = col + (255 - col) * (hl * 0.85)[..., None]
        # Cap on top of the tank.
        cap = round_box(124, 38, 11, 6, 3)
        ccol, ca = shade(cap, 4, ((60, 30, 150), (110, 70, 230), (180, 150, 255)))
        col = col * (1 - ca[..., None]) + ccol * ca[..., None]
        a = np.maximum(a, ca)
    img[..., :3] = img[..., :3] * (1 - a[..., None]) + col * a[..., None]
    img[..., 3] = np.maximum(img[..., 3], a)

for (dx, dy, r) in drops:
    d = circle(dx, dy, r)
    col, a = shade(d, r, ((170, 10, 80), (255, 45, 140), (255, 170, 210)), 0.8)
    img[..., :3] = img[..., :3] * (1 - a[..., None]) + col * a[..., None]
    img[..., 3] = np.maximum(img[..., 3], a)

img[..., 3] *= 255
im = Image.fromarray(img.astype(np.uint8), 'RGBA').resize((S, S), Image.LANCZOS)
im = im.crop(im.getbbox())
im.thumbnail((160, 160), Image.LANCZOS)
im.save(OUT, 'WEBP', quality=92, method=6)
print('wrote', OUT, im.size)
