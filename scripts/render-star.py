"""Renders the gold star icon (src/assets/icons/star.webp).

A classic game star: bevelled facets from a distance field (sharp ridges
to every tip and notch), a domed top face, saturated polished gold with
strong specular, a darker outline and a glossy highlight. Supersampled.
Run: python3 scripts/render-star.py [out]
"""
import math
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/assets/icons/star.webp'
S = 256
SS = 3
N = S * SS

ys, xs = np.mgrid[0:N, 0:N].astype(np.float64)
R = N * 0.47
x = (xs + 0.5 - N / 2) / R
y = (ys + 0.5 - N / 2 - N * 0.03) / R


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def star_sdf(px, py, ro, ri):
    """Signed distance to a 5-point star, point up (negative inside)."""
    a = np.arctan2(px, -py)
    seg = 2 * math.pi / 5
    a = np.mod(a + seg / 2, seg) - seg / 2
    rr = np.hypot(px, py)
    qx, qy = rr * np.sin(np.abs(a)), rr * np.cos(a)
    ax, ay = 0.0, ro
    bx, by = ri * math.sin(seg / 2), ri * math.cos(seg / 2)
    ex, ey = bx - ax, by - ay
    t = np.clip(((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey), 0, 1)
    dx, dy = qx - (ax + ex * t), qy - (ay + ey * t)
    d = np.hypot(dx, dy)
    side = np.sign(ex * (qy - ay) - ey * (qx - ax))
    return d * side


ROUND = 0.07
sdf = star_sdf(x, y, 1.0 - ROUND, 0.5) - ROUND
inside = -sdf
r = np.hypot(x, y)

# Height: bevel ramps up from the edge (ridges come from the distance
# field), then a gently domed top face.
BEVEL = 0.2
bevel = np.clip(inside / BEVEL, 0, 1)
h = 0.16 * np.sqrt(1 - (1 - bevel) ** 2) + 0.05 * np.clip(1 - r * r, 0, 1) * bevel
gy, gx = np.gradient(h * R)
nx, ny, nz = -gx, -gy, np.ones_like(h)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
nx, ny, nz = nx / ln, ny / ln, nz / ln

L = np.array([-0.5, -0.65, 0.58]); L /= np.linalg.norm(L)
H = L + np.array([0, 0, 1.0]); H /= np.linalg.norm(H)
diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
spec = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1)
ry = 2 * nz * ny
env = smooth(0.45, -0.7, ry)

deep = np.array([214, 92, 0.0])
gold = np.array([255, 182, 10.0])
light = np.array([255, 243, 120.0])
t = np.clip(diff * 0.6 + env * 0.5 - 0.05, 0, 1)[..., None]
col = deep + (gold - deep) * smooth(0.05, 0.5, t) + (light - gold) * smooth(0.5, 0.95, t)
col = col + 255 * (spec ** 80 * 1.0 + spec ** 12 * 0.12)[..., None]

# Glossy highlight: a soft crescent on the upper part of the top face.
top = bevel >= 0.999
gl = smooth(0.62, 0.3, np.hypot(x + 0.12, (y + 0.32) * 1.5)) * smooth(-0.2, 0.05, -(y + 0.02))
col = col + (255 - col) * (gl * 0.55 * top)[..., None]

# Darker outline for definition on any background.
edge = smooth(0.0, 0.035, inside)
outline = np.array([170, 60, 0.0])
col = outline + (col - outline) * edge[..., None]
col = np.clip(col, 0, 255)

alpha = np.clip(inside * R / 1.0 + 0.5, 0, 1) * 255
img = np.dstack([col, alpha])
im = Image.fromarray(img.astype(np.uint8), 'RGBA').resize((S, S), Image.LANCZOS)
im = im.crop(im.getbbox())
im.thumbnail((160, 160), Image.LANCZOS)
im.save(OUT, 'WEBP', quality=92, method=6)
print('wrote', OUT, im.size)
