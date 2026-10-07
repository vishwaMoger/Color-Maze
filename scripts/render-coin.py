"""Renders the gold coin icon (src/assets/icons/coin.webp).

A height field (raised rim, recessed field, embossed pillow star) is shaded
per pixel as polished gold: wrapped diffuse, a studio-style environment
reflection and a tight specular, with the coin's thickness drawn below the
face. Supersampled for clean edges. Run: python3 scripts/render-coin.py
"""
import math
import sys
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/assets/icons/coin.webp'
S = 256
SS = 3
N = S * SS
TH = 0.10  # visible thickness, as a fraction of the radius

ys, xs = np.mgrid[0:N, 0:N].astype(np.float64)
R = N * 0.46
cx, cy = N / 2, N / 2 - R * TH / 2
x = (xs + 0.5 - cx) / R
y = (ys + 0.5 - cy) / R
r = np.hypot(x, y)


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
    # Edge from the tip (0, ro) to the inner vertex at angle seg/2.
    ax, ay = 0.0, ro
    bx, by = ri * math.sin(seg / 2), ri * math.cos(seg / 2)
    ex, ey = bx - ax, by - ay
    t = np.clip(((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey), 0, 1)
    dx, dy = qx - (ax + ex * t), qy - (ay + ey * t)
    d = np.hypot(dx, dy)
    side = np.sign(ex * (qy - ay) - ey * (qx - ax))
    return d * side


# Height field.
rim = 0.16 * np.sqrt(np.clip(1 - ((r - 0.9) / 0.1) ** 2, 0, 1))
field = 0.035 * smooth(0.83, 0.79, r)
s = star_sdf(x, y + 0.03, 0.52, 0.25)
star = 0.11 * np.sqrt(np.clip(1 - (np.clip(s + 0.11, 0, None) / 0.11) ** 2, 0, 1)) * (s < 0)
h = np.maximum(np.where(r > 0.8, rim, field), field + star)
h = np.where(r > 1, 0, h)
gy, gx = np.gradient(h * R, edge_order=1)
nx, ny, nz = -gx, -gy, np.ones_like(h)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
nx, ny, nz = nx / ln, ny / ln, nz / ln

L = np.array([-0.45, -0.6, 0.66]); L /= np.linalg.norm(L)
V = np.array([0, 0, 1.0])
H = L + V; H /= np.linalg.norm(H)
diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
spec = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1) ** 60
# Reflection vector's vertical component picks from a studio gradient.
ry = 2 * nz * ny  # reflect V about N (y part)
rx = 2 * nz * nx
env = smooth(0.5, -0.6, ry) * 0.85 + smooth(-0.2, -0.9, rx) * 0.15

deep = np.array([196, 84, 0.0])
gold = np.array([255, 186, 12.0])
light = np.array([255, 246, 130.0])
t = np.clip(diff * 0.55 + env * 0.55, 0, 1)[..., None]
col = deep + (gold - deep) * smooth(0.0, 0.55, t) + (light - gold) * smooth(0.55, 1.0, t)
# Recessed field slightly warmer and darker, so the star and rim pop.
# Recessed field: a rich gradient (light upper left, deep amber lower
# right) so the face never reads as a flat disc.
fld = (r < 0.8) & (star == 0)
g = (x + y) / math.sqrt(2)
toDeep = (smooth(-0.3, 0.8, g) * 0.42)[..., None]
toLight = (smooth(0.1, -0.75, g) * 0.3)[..., None]
fcol = col + (np.array([205, 92, 0.0]) - col) * toDeep + (np.array([255, 236, 120.0]) - col) * toLight
col = np.where(fld[..., None], fcol, col)
col = col + 255 * (spec * 1.0 + np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1) ** 10 * 0.1)[..., None]
# Glossy diagonal sheen across the face.
d = (x + y) / math.sqrt(2)
sheen = smooth(-0.66, -0.5, d) * smooth(-0.14, -0.3, d) * 0.4 + smooth(0.02, 0.1, d) * smooth(0.22, 0.12, d) * 0.16
col = col + (255 - col) * sheen[..., None]
col = np.clip(col, 0, 255)
face = (r <= 1)

# Coin edge (thickness) below the face, with ridges.
ex_, ey_ = (xs + 0.5 - cx) / R, (ys + 0.5 - cy - R * TH) / R
er = np.hypot(ex_, ey_)
edge = (er <= 1) & ~face
ang = np.arctan2(ey_, ex_)
ridge = 0.85 + 0.15 * (np.sin(ang * 90) > 0)
shade = (0.55 + 0.45 * smooth(-1, 0.6, ex_ * -0.8 + 0.2))
edge_col = np.array([214, 104, 0.0])[None, None, :] * (shade * ridge)[..., None]

img = np.zeros((N, N, 4))
img[edge, :3] = edge_col[edge]
img[edge, 3] = 255
img[face, :3] = col[face]
img[face, 3] = 255
# Thin dark outline on the face edge for definition.
outline = face & (r > 0.985)
img[outline, :3] = img[outline, :3] * 0.55 + np.array([120, 40, 0]) * 0.45

im = Image.fromarray(img.astype(np.uint8), 'RGBA').resize((S, S), Image.LANCZOS)
im = im.crop(im.getbbox())
im.thumbnail((160, 160), Image.LANCZOS)
im.save(OUT, 'WEBP', quality=92, method=6)
print('wrote', OUT)
