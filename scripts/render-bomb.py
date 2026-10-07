"""Renders the paint bomb icon (src/assets/icons/bomb.webp).

A glossy paint-filled sphere with a paint-drop emblem, a metal cap, a curly
fuse and a bright spark. Shaded per pixel like the coin and star.
Run: python3 scripts/render-bomb.py [out]
"""
import math
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/assets/icons/bomb.webp'
S = 256
SS = 3
N = S * SS
ys, xs = np.mgrid[0:N, 0:N].astype(np.float64)


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


# Body: a sphere plus drips (capsules) blended in with a smooth union.
cx, cy, R = N * 0.45, N * 0.52, N * 0.32
d = np.hypot(xs - cx, ys - cy) - R
inside = -d

# Height for shading: sphere normal on the body, rounded tubes on drips.
nz_s = np.sqrt(np.clip(1 - ((xs - cx) ** 2 + (ys - cy) ** 2) / R ** 2, 0, 1))
h = np.where(nz_s > 0, nz_s * R, 0) + np.clip(inside, 0, N * 0.06) * 0.8
gy, gx = np.gradient(h)
nx, ny, nz = -gx, -gy, np.ones_like(h)
ln_ = np.sqrt(nx * nx + ny * ny + nz * nz)
nx, ny, nz = nx / ln_, ny / ln_, nz / ln_
L = np.array([-0.5, -0.65, 0.58]); L /= np.linalg.norm(L)
H = L + np.array([0, 0, 1.0]); H /= np.linalg.norm(H)
diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
spec = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1)

deep = np.array([150, 8, 70.0])
base = np.array([255, 45, 140.0])
light = np.array([255, 150, 205.0])
t = (diff * 0.85 + 0.12)[..., None]
col = deep + (base - deep) * smooth(0.05, 0.55, t) + (light - base) * smooth(0.65, 1.0, t)
col = col + 255 * (spec ** 70 * 1.0 + spec ** 8 * 0.08)[..., None]
# Rim light along the lower right edge.
rim = smooth(N * 0.035, 0, inside) * smooth(-0.1, 0.6, (xs - cx + ys - cy) / R)
col = col + (np.array([255, 190, 230.0]) - col) * (rim * 0.5)[..., None]
# Big soft window highlight.
hl = smooth(0.42, 0.18, np.hypot((xs - (cx - R * 0.38)) / R, (ys - (cy - R * 0.42)) / (R * 0.7)))
col = col + (255 - col) * (hl * 0.75)[..., None]
# Paint-drop emblem on the front (teardrop: circle + point on top).
ex, ey, er = cx + R * 0.08, cy + R * 0.16, R * 0.3
dd = np.hypot(xs - ex, ys - ey) - er
tip = np.abs(xs - ex) * 1.25 + (ey - er * 0.9 - ys) * 0.55 - er * 0.62
tip = np.where(ys < ey, np.maximum(tip, -(ys - (ey - er * 2.05))), 1e9)
drop = np.minimum(dd, np.maximum(tip, -1e9))
dm = smooth(N * 0.006, -N * 0.006, drop)
dshade = (0.85 + 0.15 * smooth(ey + er, ey - er * 1.5, ys))[..., None]
col = col + (np.array([255, 255, 255.0]) * dshade - col) * (dm * 0.92)[..., None]
ring = smooth(N * 0.012, 0, np.abs(drop)) * (1 - dm)
col = col * (1 - (ring * 0.25)[..., None])
edge = smooth(0, N * 0.008, inside)
col = np.array([110, 0, 50.0]) + (col - np.array([110, 0, 50.0])) * edge[..., None]
alpha = np.clip(inside / SS + 0.5, 0, 1) * 255
img = np.dstack([np.clip(col, 0, 255), alpha]).astype(np.uint8)
im = Image.fromarray(img, 'RGBA')

# Cap, fuse and spark drawn on top.
dr = ImageDraw.Draw(im)
capx, capy = cx + R * 0.3, cy - R * 0.96
w_, h_ = N * 0.15, N * 0.09
for i in range(int(h_)):
    k = i / h_
    c = tuple(int(v) for v in (np.array([235, 235, 250]) * (1 - k) + np.array([120, 110, 150]) * k))
dr.rounded_rectangle([capx - w_ / 2, capy - h_ / 2, capx + w_ / 2, capy + h_ / 2], radius=N * 0.015, fill=(150, 140, 180, 255))
dr.rounded_rectangle([capx - w_ / 2, capy - h_ / 2, capx + w_ / 2, capy - h_ / 8], radius=N * 0.012, fill=(225, 222, 245, 255))
pts = []
for i in range(40):
    u = i / 39
    pts.append((capx + N * 0.02 + u * N * 0.15, capy - h_ / 2 - math.sin(u * math.pi * 1.3) * N * 0.08 - u * N * 0.05))
dr.line(pts, fill=(120, 72, 40, 255), width=int(N * 0.022), joint='curve')
dr.line(pts, fill=(200, 140, 90, 255), width=int(N * 0.008), joint='curve')
sx, sy = pts[-1]
glow = Image.new('RGBA', im.size, (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
for r, a in [(N * 0.09, 70), (N * 0.06, 120), (N * 0.035, 220)]:
    gd.ellipse([sx - r, sy - r, sx + r, sy + r], fill=(255, 220, 90, a))
glow = glow.filter(ImageFilter.GaussianBlur(N * 0.012))
im = Image.alpha_composite(im, glow)
dr = ImageDraw.Draw(im)
for ang in range(0, 360, 45):
    a = math.radians(ang)
    L1 = N * (0.085 if ang % 90 == 0 else 0.05)
    dr.line([(sx, sy), (sx + math.cos(a) * L1, sy + math.sin(a) * L1)], fill=(255, 250, 210, 255), width=int(N * 0.012))
dr.ellipse([sx - N * 0.02, sy - N * 0.02, sx + N * 0.02, sy + N * 0.02], fill=(255, 255, 255, 255))

im = im.resize((S, S), Image.LANCZOS)
im = im.crop(im.getbbox())
im.thumbnail((160, 160), Image.LANCZOS)
im.save(OUT, 'WEBP', quality=92, method=6)
print('wrote', OUT, im.size)
