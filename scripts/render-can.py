"""Renders the win-streak can (src/assets/icons/streakcan.webp): metallic
purple caps around a glass tube. The glass is mostly see-through so the
animated fire (drawn in CSS behind it) glows through; edges darken like a
cylinder and a bright highlight stripe runs down the left.
Run: python3 scripts/render-can.py [out]
"""
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/assets/icons/streakcan.webp'
W, H, SS = 128, 176, 3
ys, xs = np.mgrid[0:H * SS, 0:W * SS].astype(np.float64) / SS
img = np.zeros((H * SS, W * SS, 4))


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def rbox(x0, y0, x1, y1, r):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw, hh = (x1 - x0) / 2, (y1 - y0) / 2
    qx, qy = np.abs(xs - cx) - hw + r, np.abs(ys - cy) - hh + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def put(col, a):
    a = np.clip(a, 0, 1)
    img[..., :3] = img[..., :3] * (1 - a[..., None]) + col * a[..., None]
    img[..., 3] = img[..., 3] * (1 - a) + a


light = np.array([196, 168, 255.0])
mid = np.array([124, 78, 240.0])
dark = np.array([62, 26, 168.0])


def metal(x0, x1, y0, y1, r):
    """Purple metal band shaded like a cylinder, with a lit top rim."""
    d = rbox(x0, y0, x1, y1, r)
    u = np.clip((xs - x0) / (x1 - x0), 0, 1)
    # Cylinder light: bright band at 30%, falling off to the right edge.
    lum = np.exp(-((u - 0.3) / 0.22) ** 2) * 0.9 + 0.25 * (1 - u)
    col = dark + (mid - dark) * smooth(0.0, 0.5, lum)[..., None] + (light - mid) * smooth(0.55, 1.0, lum)[..., None]
    v = (ys - y0) / (y1 - y0)
    col = col * (1 - 0.25 * smooth(0.6, 1.0, v))[..., None]
    rim = smooth(3.5, 0, np.abs(ys - (y0 + 2.5))) * (d < 0)
    col = col + (255 - col) * (rim * 0.35)[..., None]
    edge = smooth(0, 1.2, -d)
    col = np.array([45, 15, 120.0]) + (col - np.array([45, 15, 120.0])) * smooth(0, 2.2, -d)[..., None]
    put(col, edge)


# Glass tube (drawn first; caps overlap its ends).
gx0, gx1, gy0, gy1 = 17, 111, 34, 146
d = rbox(gx0, gy0, gx1, gy1, 6)
u = np.clip((xs - gx0) / (gx1 - gx0), 0, 1)
edge_dark = smooth(0.32, 0.0, np.minimum(u, 1 - u))
glass_a = (0.04 + 0.5 * edge_dark) * smooth(0, 1.2, -d)
glass_col = np.array([60, 20, 130.0]) * np.ones_like(xs)[..., None]
put(glass_col, glass_a)
# Highlight stripes.
hl = smooth(4, 0, np.abs(xs - 30)) * smooth(0, 1.2, -d)
put(np.array([255, 255, 255.0]) * np.ones_like(xs)[..., None], hl * 0.32)
hl2 = smooth(2, 0, np.abs(xs - 98)) * smooth(0, 1.2, -d)
put(np.array([255, 230, 255.0]) * np.ones_like(xs)[..., None], hl2 * 0.25)
# Thin glass outline.
outline = smooth(1.6, 0, np.abs(d)) * 0.7
put(np.array([80, 40, 170.0]) * np.ones_like(xs)[..., None], outline)

# Caps and the nub on top.
metal(46, 82, 2, 16, 5)
metal(9, 119, 12, 42, 10)
metal(9, 119, 138, 172, 10)

img[..., 3] *= 255
im = Image.fromarray(img.astype(np.uint8), 'RGBA').resize((W, H), Image.LANCZOS)
im.save(OUT, 'WEBP', quality=92, method=6)
print('wrote', OUT, im.size)
