"""Renders the 3D gold key: a spinning sprite strip for keys lying on the
board and the keys collected in the HUD (src/assets/icons/keyspin.webp) and a still for the HUD, the Safe and
flying keys (src/assets/icons/key.webp).

The key (a round bow, a collar, the shaft and a two-tooth bit) is a signed
distance field, ray marched per pixel and shaded as polished gold like the
coin: wrapped diffuse, a studio environment reflection, a tight specular
and a little ambient occlusion where the parts meet. Supersampled for clean
edges, with a thin amber outline so it reads on any board.
Run: python3 scripts/render-key.py
"""
import math
import numpy as np
from PIL import Image, ImageFilter

FRAMES = 36  # one full turn
COLS = 36  # one row: also played as a CSS sprite in the HUD
FS = 108  # frame size (px)
SS = 3


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def rbox(px, py, pz, cx, cy, cz, hx, hy, hz, r):
    qx, qy, qz = np.abs(px - cx) - hx + r, np.abs(py - cy) - hy + r, np.abs(pz - cz) - hz + r
    out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
    return out + np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0) - r


def key_sdf(x, y, z):
    # Bow: a fat ring facing the viewer.
    qx, qy = x, y - 0.47
    bow = (np.sqrt((np.sqrt(qx * qx + qy * qy) - 0.26) ** 2 + (z * 1.25) ** 2) - 0.115) * 0.8
    # Collar ring round the shaft just under the bow.
    cy = y - 0.1
    collar = np.sqrt((np.sqrt(x * x + z * z) - 0.085) ** 2 + cy * cy) - 0.045
    # Shaft, rounded at the tip.
    sy = np.clip(y, -0.66, 0.2)
    shaft = np.sqrt(x * x + z * z + (y - sy) ** 2) - 0.078
    # The bit: two flat teeth on one side.
    t1 = rbox(x, y, z, 0.14, -0.57, 0, 0.09, 0.07, 0.045, 0.028)
    t2 = rbox(x, y, z, 0.125, -0.37, 0, 0.07, 0.052, 0.045, 0.025)
    d = smin(bow, collar, 0.04)
    d = smin(d, shaft, 0.05)
    d = smin(d, t1, 0.03)
    return smin(d, t2, 0.03)


def rot(ax, ay, az, angle, axis):
    c, s = math.cos(angle), math.sin(angle)
    if axis == 'y':
        return c * ax + s * az, ay, -s * ax + c * az
    if axis == 'x':
        return ax, c * ay - s * az, s * ay + c * az
    return c * ax - s * ay, s * ax + c * ay, az


def render(spin, tilt, roll, size, scale=1.0):
    """One image: the key turned `spin` about its own axis, tipped back by
    `tilt` (seen a little from above) and turned `roll` in the picture."""
    N = size * SS
    ys, xs = np.mgrid[0:N, 0:N].astype(np.float64)
    wx = ((xs + 0.5) / N * 2 - 1) * 0.92 / scale
    wy = -((ys + 0.5) / N * 2 - 1) * 0.92 / scale
    wx, wy = wx.ravel(), wy.ravel()

    def to_obj(px, py, pz):
        px, py, pz = rot(px, py, pz, -roll, 'z')
        px, py, pz = rot(px, py, pz, -tilt, 'x')
        return rot(px, py, pz, -spin, 'y')

    def f(px, py, pz):
        return key_sdf(*to_obj(px, py, pz))

    # March from the front (z = 2) toward -z.
    z = np.full(wx.shape, 2.0)
    hit = np.zeros(wx.shape, bool)
    alive = np.ones(wx.shape, bool)
    for _ in range(140):
        idx = np.nonzero(alive)[0]
        if not len(idx):
            break
        d = f(wx[idx], wy[idx], z[idx])
        z[idx] -= d * 0.9
        h = d < 0.0015
        hit[idx[h]] = True
        alive[idx[h]] = False
        alive[idx[z[idx] < -2]] = False
    hi = np.nonzero(hit)[0]
    px, py, pz = wx[hi], wy[hi], z[hi]
    e = 0.002
    nx = f(px + e, py, pz) - f(px - e, py, pz)
    ny = f(px, py + e, pz) - f(px, py - e, pz)
    nz = f(px, py, pz + e) - f(px, py, pz - e)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-9
    nx, ny, nz = nx / ln, ny / ln, nz / ln
    # Ambient occlusion: how open the space is just off the surface.
    ao = np.ones_like(px)
    for k, step in enumerate((0.03, 0.07, 0.12)):
        ao -= (step - f(px + nx * step, py + ny * step, pz + nz * step)) * (2.2 / (k + 1))
    ao = np.clip(ao, 0.45, 1)

    L = np.array([-0.45, 0.62, 0.64]); L /= np.linalg.norm(L)
    V = np.array([0, 0, 1.0])
    H = L + V; H /= np.linalg.norm(H)
    ndl = nx * L[0] + ny * L[1] + nz * L[2]
    diff = np.clip(ndl * 0.75 + 0.25, 0, 1)
    ndh = np.clip(nx * H[0] + ny * H[1] + nz * H[2], 0, 1)
    # Reflection of the view ray; its height picks from a studio gradient.
    ry = 2 * nz * ny
    rx = 2 * nz * nx
    env = smooth(-0.35, 0.75, ry) * 0.8 + smooth(0.2, 0.9, -rx) * 0.2

    deep = np.array([176, 70, 0.0])
    gold = np.array([255, 182, 14.0])
    light = np.array([255, 244, 140.0])
    t = np.clip(diff * 0.5 + env * 0.6, 0, 1)[:, None]
    col = deep + (gold - deep) * smooth(0.0, 0.55, t) + (light - gold) * smooth(0.55, 1.0, t)
    col *= (0.55 + 0.45 * ao)[:, None]
    col += 255 * (ndh ** 70 * 1.1 + ndh ** 12 * 0.12)[:, None]
    # A warm rim where the surface turns away from the viewer.
    rim = smooth(0.45, 0.0, nz)[:, None]
    col = col + (np.array([150, 55, 0.0]) - col) * rim * 0.55
    col = np.clip(col, 0, 255)

    img = np.zeros((N * N, 4))
    img[hi, :3] = col
    img[hi, 3] = 255
    im = Image.fromarray(img.reshape(N, N, 4).astype(np.uint8), 'RGBA')
    im = im.resize((size, size), Image.LANCZOS)
    # Thin amber outline under the key for definition on any board.
    a = im.getchannel('A')
    ring = a.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.5))
    out = Image.new('RGBA', im.size, (120, 48, 0, 0))
    out.putalpha(ring.point(lambda v: int(v * 0.85)))
    out.alpha_composite(im)
    return out


sheet = Image.new('RGBA', (FS * COLS, FS * math.ceil(FRAMES / COLS)))
for i in range(FRAMES):
    fr = render(2 * math.pi * i / FRAMES, math.radians(16), 0, FS)
    sheet.paste(fr, ((i % COLS) * FS, (i // COLS) * FS))
sheet.save('src/assets/icons/keyspin.webp', 'WEBP', quality=90, method=6)
print('wrote src/assets/icons/keyspin.webp', sheet.size)

# The still is the board's key as it is seen most of the time: upright,
# a little turned, in the same light (square, like a sheet frame).
still = render(math.radians(25), math.radians(16), 0, 160)
still.save('src/assets/icons/key.webp', 'WEBP', quality=92, method=6)
print('wrote src/assets/icons/key.webp', still.size)
