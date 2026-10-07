"""Renders a pile of gold coin stacks (src/assets/icons/coinstack.webp),
seen slightly from above: each coin is an elliptical disc with a shaded
rim, stacked in three columns. Run: python3 scripts/render-coinstack.py
"""
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/assets/icons/coinstack.webp'
S, SS = 256, 3
N = S * SS
ys, xs = np.mgrid[0:N, 0:N].astype(np.float64) / SS
img = np.zeros((N, N, 4))


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def put(col, a):
    img[..., :3] = img[..., :3] * (1 - a[..., None]) + col * a[..., None]
    img[..., 3] = np.maximum(img[..., 3], a)


RX, RY, TH = 34, 12, 9  # coin radii (x, y) and thickness


def coin(cx, cy):
    # Side band: union of ellipses from cy to cy+TH.
    e_top = ((xs - cx) / RX) ** 2 + ((ys - cy) / RY) ** 2
    e_bot = ((xs - cx) / RX) ** 2 + ((ys - cy - TH) / RY) ** 2
    band = ((np.abs(xs - cx) <= RX) & (ys >= cy) & (ys <= cy + TH)) | (e_bot <= 1)
    u = np.clip((xs - cx) / RX, -1, 1)
    side = np.array([255, 170, 20.0]) * (0.62 + 0.38 * (1 - np.abs(u + 0.35)) )[..., None]
    ridge = (np.sin((xs - cx) * 1.4) > 0.6)[..., None] * 0.08
    side = side * (1 - ridge)
    a_side = band.astype(float)
    # Darker seam along each coin's lower edge separates the coins.
    seam = smooth(0.82, 1.0, e_bot) * (ys > cy + TH * 0.4)
    side = side * (1 - 0.35 * seam[..., None])
    put(np.clip(side, 0, 255), a_side * smooth(1.04, 0.98, np.minimum(e_bot, 1.0) + 0 * ys))
    # Top face with a rim, an embossed ring and a shine.
    face_a = smooth(1.03, 0.97, e_top)
    r = np.sqrt(e_top)
    base = np.array([255, 205, 50.0])
    light = np.array([255, 240, 150.0])
    deep = np.array([225, 140, 10.0])
    col = base + (light - base) * smooth(0.2, -0.8, (xs - cx) / RX + (ys - cy) / RY * 0.6)[..., None]
    col = np.where((r > 0.78)[..., None], deep + (base - deep) * 0.5, col)
    col = np.where(((r > 0.5) & (r < 0.58))[..., None], col * 0.88, col)
    put(np.clip(col, 0, 255), face_a)


stacks = [(84, 5), (172, 4), (128, 3)]  # back to front
base_y = {84: 196, 172: 200, 128: 214}
for x, n in stacks:
    for i in range(n):
        coin(x, base_y[x] - i * (TH - 1))

img[..., 3] *= 255
im = Image.fromarray(img.astype(np.uint8), 'RGBA').resize((S, S), Image.LANCZOS)
im = im.crop(im.getbbox())
im.thumbnail((180, 180), Image.LANCZOS)
im.save(OUT, 'WEBP', quality=92, method=6)
print('wrote', OUT, im.size)
