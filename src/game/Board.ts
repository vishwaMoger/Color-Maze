import { BlurFilter, Container, Filter, GlProgram, Graphics, Sprite, Texture, TilingSprite, UniformGroup } from 'pixi.js';
import {
  ARROW_D,
  ARROW_L,
  ARROW_R,
  ARROW_U,
  COIN,
  CURVE_BL,
  CURVE_BR,
  CURVE_TL,
  CURVE_TR,
  isFloor,
  KEY,
  MULT,
  PORTAL_A,
  PORTAL_B,
  SAW,
  STOPPER,
  type Level,
  type Point,
} from '../levels/core.ts';
import { iconImage } from './assets.ts';
import { dilate, fillRoundedCells, makeCanvas, softBlur, texture, tint } from './shape.ts';
import { paintGloss, type PaintGloss } from './shaders.ts';
import type { Theme, TileStyle } from './themes.ts';
import { slabCanvas, slabTexture } from './slabs.ts';

const FILTER_VERT = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}`;

// Animated water light, adapted from the classic tileable caustic pattern.
const CAUSTIC_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uTime;
uniform float uScale;
uniform float uStrength;
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
void main(void) {
  vec4 color = texture(uTexture, vTextureCoord);
  vec2 px = vTextureCoord * uInputSize.xy;
  float v = clamp(caustic(px / uScale, uTime), 0.0, 1.0);
  color.rgb += vec3(0.8, 1.0, 1.0) * v * uStrength * color.a * color.a;
  finalColor = color;
}`;

function causticFilter(): Filter & { uniforms: { uTime: number; uScale: number; uStrength: number } } {
  const uniforms = new UniformGroup({
    uTime: { value: 0, type: 'f32' },
    uScale: { value: 300, type: 'f32' },
    uStrength: { value: 0.55, type: 'f32' },
  });
  const f = new Filter({
    glProgram: GlProgram.from({ vertex: FILTER_VERT, fragment: CAUSTIC_FRAG, name: 'caustics', preferredFragmentPrecision: 'highp' }),
    resources: { causticUniforms: uniforms },
  });
  return Object.assign(f, { uniforms: uniforms.uniforms as { uTime: number; uScale: number; uStrength: number } });
}

/**
 * One tile of a blob of painted tiles: a rect whose convex corners (no
 * filled tile on either side of that corner) are rounded. Edges overlap
 * neighbours by half a pixel so anti-aliasing leaves no seams.
 */
function roundedCell(g: Graphics, x: number, y: number, cell: number, r: number, filled: (x: number, y: number) => boolean) {
  const e = 0.5;
  const x0 = x * cell - e;
  const y0 = y * cell - e;
  const x1 = (x + 1) * cell + e;
  const y1 = (y + 1) * cell + e;
  const tl = !filled(x - 1, y) && !filled(x, y - 1);
  const tr = !filled(x + 1, y) && !filled(x, y - 1);
  const br = !filled(x + 1, y) && !filled(x, y + 1);
  const bl = !filled(x - 1, y) && !filled(x, y + 1);
  if (!tl && !tr && !br && !bl) {
    g.rect(x0, y0, x1 - x0, y1 - y0);
    return;
  }
  g.moveTo(x0 + (tl ? r : 0), y0).lineTo(x1 - (tr ? r : 0), y0);
  if (tr) g.arcTo(x1, y0, x1, y0 + r, r);
  g.lineTo(x1, y1 - (br ? r : 0));
  if (br) g.arcTo(x1, y1, x1 - r, y1, r);
  g.lineTo(x0 + (bl ? r : 0), y1);
  if (bl) g.arcTo(x0, y1, x0, y1 - r, r);
  g.lineTo(x0, y0 + (tl ? r : 0));
  if (tl) g.arcTo(x0, y0, x0 + r, y0, r);
  g.closePath();
}

/**
 * Stud positions on a stopper tile, in cell units. On a tile at the board's
 * near edge the lip hides its lower quarter (see LIP), so there the studs
 * sit in the part that shows.
 */
function studPos(nearEdge: boolean): [number, number][] {
  const [top, bottom] = nearEdge ? [0.21, 0.55] : [0.25, 0.75];
  return [
    [0.25, top],
    [0.75, top],
    [0.25, bottom],
    [0.75, bottom],
  ];
}

interface Grip {
  at: number;
  studs: { s: Sprite; x0: number; y0: number; cx: number; cy: number }[];
}

/** How long fresh paint takes to flow out and fill its tile (ms). */
export const SPREAD_MS = 280;

/** HSV (h in degrees, s and v 0..1) of a 0xRRGGBB colour. */
function toHsv(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

function fromHsv(h: number, s: number, v: number): number {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}

/**
 * Splatter colours for a paint, derived the way the original's relate to
 * its pink (238,40,143): lumps of the same hue at full saturation (232,0,124)
 * shaded from (200,0,98) to (236,56,168), and smaller drops shifted toward
 * red (228,0,70).
 */
function splatPalette(paint: number) {
  const [h, , v] = toHsv(paint);
  const lump = [fromHsv(h, 1, v * 0.84), fromHsv(h, 1, v * 0.98), fromHsv((h + 355) % 360, 0.76, v)];
  const rh = (h + 13) % 360;
  const red = [fromHsv(rh, 1, v * 0.78), fromHsv(rh, 1, v * 0.96), fromHsv((rh + 357) % 360, 0.78, v)];
  return { lump, red };
}

/**
 * One splatter lump, as in the original: a knobbly blob (a core and four
 * lobes) lit from above, dark at its foot, light on its upper left.
 */
function lump(g: Graphics, x: number, y: number, r: number, seed: number, [dark, mid, light]: number[]) {
  // A rounded drop with only gentle lobes, so a scatter of them reads as
  // glossy wet paint rather than jagged chunks.
  const lobes: number[] = [];
  for (let j = 0; j < 4; j++) {
    const a = seed * 6.283 + j * 1.71;
    const k = (Math.sin(seed * 91.7 + j * 12.9) + 1) / 2;
    lobes.push(Math.cos(a) * r * 0.26, Math.sin(a) * r * 0.26, r * (0.6 + 0.1 * k));
  }
  const shape = (ox: number, oy: number, s: number) => {
    g.circle(x + ox, y + oy, r * 0.8 * s);
    for (let j = 0; j < 12; j += 3) g.circle(x + ox + lobes[j] * s, y + oy + lobes[j + 1] * s, lobes[j + 2] * s);
  };
  // A soft see-through shadow at its foot instead of a hard dark rim.
  shape(0, r * 0.14, 1);
  g.fill({ color: dark, alpha: 0.45 });
  shape(0, 0, 0.94);
  g.fill(mid);
  g.circle(x - r * 0.22, y - r * 0.28, r * 0.34);
  g.fill({ color: light, alpha: 0.65 });
  g.circle(x - r * 0.3, y - r * 0.36, r * 0.13);
  g.fill({ color: 0xffffff, alpha: 0.7 });
}

/** A glowing portal orb: a bright core in the portal's colour inside a softly wobbling white rim. */
function portalTexture(r: number, res: number, cols: [string, string, string]): Texture {
  const R = r * res;
  const size = Math.ceil(R * 2 + 8);
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const blob = (k: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const rr = R * k * (1 + 0.035 * Math.sin(a * 5 + 0.7) + 0.02 * Math.sin(a * 3));
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  const g = ctx.createRadialGradient(cx - R * 0.15, cy - R * 0.2, R * 0.05, cx, cy, R * 0.95);
  g.addColorStop(0, cols[0]);
  g.addColorStop(0.55, cols[1]);
  g.addColorStop(1, cols[2]);
  ctx.fillStyle = g;
  blob(0.92);
  ctx.fill();
  // A soft shine on the upper left, as on the ball.
  const s = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, 0, cx - R * 0.3, cy - R * 0.35, R * 0.45);
  s.addColorStop(0, 'rgba(255,255,255,0.75)');
  s.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = s;
  blob(0.92);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = R * 0.1;
  blob(0.92);
  ctx.stroke();
  return Texture.from(cv);
}

/** A soft round glow, white, for tinting (additive halos and sparkles). */
function glowTexture(r: number, res: number): Texture {
  const R = Math.ceil(r * res);
  const cv = makeCanvas(R * 2, R * 2);
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(R, R, 0, R, R, R);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, R * 2, R * 2);
  return Texture.from(cv);
}

/**
 * The column of light rising from a portal: brightest at its foot and along
 * its middle, fading out upward and to the sides. White, for tinting.
 */
function beamTexture(w: number, h: number, res: number): Texture {
  const W = Math.ceil(w * res);
  const H = Math.ceil(h * res);
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const up = 1 - y / (H - 1); // 0 at the foot, 1 at the top
    const fade = (1 - up) ** 1.3;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W - 0.5;
      const across = Math.exp(-(u * u) / (2 * 0.22 * 0.22));
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.min(1, across * fade * 1.5));
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(cv);
}

/** The dark rounded socket a saw spins in, set into the floor (as in the original). */
function sawSocket(s: number, res: number): Texture {
  const S = s * res;
  const pad = Math.ceil(S * 0.12);
  const size = Math.ceil(S + pad * 2);
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d')!;
  const r = S * 0.2;
  const box = (x: number, y: number, w: number, h: number, rr: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
  };
  // Shadow it casts on the floor, then the socket and its lit top edge.
  ctx.fillStyle = 'rgba(15, 5, 35, 0.35)';
  box(pad, pad + S * 0.06, S, S, r);
  ctx.fill();
  const g = ctx.createLinearGradient(0, pad, 0, pad + S);
  g.addColorStop(0, '#4a4458');
  g.addColorStop(1, '#2c2836');
  ctx.fillStyle = g;
  box(pad, pad, S, S, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = Math.max(1, S * 0.03);
  box(pad + S * 0.03, pad + S * 0.03, S * 0.94, S * 0.94, r * 0.85);
  ctx.stroke();
  return Texture.from(cv);
}

/**
 * A circular saw blade, as in the original: hooked silver teeth shaded on
 * their cutting faces, a pale inner disc and a dark hub.
 */
function sawBlade(r: number, res: number): Texture {
  const R = r * res;
  const size = Math.ceil(R * 2 + 8);
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const teeth = 15;
  const step = (Math.PI * 2) / teeth;
  const pt = (a: number, k: number) => [cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k] as const;
  // Toothed outline: each tooth rises along the rim to a hooked tip, then
  // drops back to the gullet.
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    ctx.lineTo(...pt(a0, 0.74));
    ctx.quadraticCurveTo(...pt(a0 + step * 0.35, 0.86), ...pt(a0 + step * 0.82, 1));
    ctx.lineTo(...pt(a0 + step * 0.9, 0.8));
    ctx.quadraticCurveTo(...pt(a0 + step, 0.7), ...pt(a0 + step, 0.74));
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.5, '#d7dae4');
  g.addColorStop(1, '#8d92a6');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, R * 0.035);
  ctx.strokeStyle = '#5a5e72';
  ctx.stroke();
  // Cutting faces in shade.
  ctx.fillStyle = 'rgba(60, 60, 80, 0.45)';
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    ctx.beginPath();
    ctx.moveTo(...pt(a0 + step * 0.82, 1));
    ctx.lineTo(...pt(a0 + step * 0.9, 0.8));
    ctx.lineTo(...pt(a0 + step * 0.62, 0.8));
    ctx.closePath();
    ctx.fill();
  }
  // Pale inner disc with a soft shine, then the hub.
  const d = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.05, cx, cy, R * 0.66);
  d.addColorStop(0, '#fafbff');
  d.addColorStop(1, '#b7bccb');
  ctx.fillStyle = d;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#34323e';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, R * 0.03);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.25, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  return Texture.from(cv);
}

/** The x3 badge, as in the original: a white disc with a bold dark "x3". */
function multBadge(r: number, res: number): HTMLCanvasElement {
  const R = r * res;
  const size = Math.ceil(R * 2 + R * 0.5);
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2 - R * 0.06;
  ctx.fillStyle = 'rgba(20, 10, 50, 0.3)';
  ctx.beginPath();
  ctx.arc(cx, cy + R * 0.12, R, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#e6e2f6');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2e2348';
  ctx.font = `700 ${Math.round(R * 0.95)}px Fredoka, 'Baloo 2', 'Arial Rounded MT Bold', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('x3', cx, cy + R * 0.05);
  return cv;
}

/**
 * The finish on each floor tile: soft, low-contrast light and shade only
 * (no outlines), so the floor reads as real tiles under the paint while
 * keeping the board's clean look. `ctx` is clipped to the floor by the
 * caller; (x0, y0) is a tile's corner and c its size, in canvas px.
 */
function tileFinish(ctx: CanvasRenderingContext2D, style: TileStyle, x0: number, y0: number, c: number, tx: number, ty: number) {
  // A steady per-tile random, so every tile differs but never flickers.
  let seed = (tx * 73856093) ^ (ty * 19349663) ^ 0x5bd1e995;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const light = (a: number) => `rgba(255, 255, 255, ${a})`;
  const dark = (a: number) => `rgba(0, 0, 0, ${a})`;
  // Glazed: a sheen on the upper left and a soft bevel, lit from above.
  const glaze = (k = 1) => {
    const g = ctx.createRadialGradient(x0 + c * 0.3, y0 + c * 0.26, 0, x0 + c * 0.3, y0 + c * 0.26, c * 0.8);
    g.addColorStop(0, light(0.085 * k));
    g.addColorStop(1, light(0));
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, c, c);
    const t = ctx.createLinearGradient(0, y0, 0, y0 + c * 0.1);
    t.addColorStop(0, light(0.07 * k));
    t.addColorStop(1, light(0));
    ctx.fillStyle = t;
    ctx.fillRect(x0, y0, c, c * 0.1);
    const b = ctx.createLinearGradient(0, y0 + c, 0, y0 + c * 0.88);
    b.addColorStop(0, dark(0.09 * k));
    b.addColorStop(1, dark(0));
    ctx.fillStyle = b;
    ctx.fillRect(x0, y0 + c * 0.88, c, c * 0.12);
  };
  switch (style) {
    case 'glaze':
      glaze();
      break;
    case 'stone': {
      // Old crypt flagstones: each slab its own shade, with a mottled
      // surface, a worn lighter top edge and now and then a crack.
      ctx.fillStyle = rnd() < 0.5 ? light(0.02 + rnd() * 0.05) : dark(0.04 + rnd() * 0.1);
      ctx.fillRect(x0, y0, c, c);
      for (let i = 0; i < 7; i++) {
        const r = c * (0.06 + rnd() * 0.12);
        ctx.fillStyle = rnd() < 0.5 ? light(0.025) : dark(0.06);
        ctx.beginPath();
        ctx.ellipse(x0 + c * (0.1 + rnd() * 0.8), y0 + c * (0.1 + rnd() * 0.8), r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (rnd() < 0.35) {
        ctx.strokeStyle = dark(0.4);
        ctx.lineWidth = Math.max(1, c * 0.018);
        ctx.lineCap = 'round';
        ctx.beginPath();
        let x = x0 + c * (0.15 + rnd() * 0.3);
        let y = y0 + c * (0.15 + rnd() * 0.3);
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          x += c * (0.06 + rnd() * 0.12);
          y += c * (rnd() * 0.2 - 0.04);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = light(0.06);
      ctx.fillRect(x0 + c * 0.04, y0 + c * 0.03, c * 0.92, Math.max(1, c * 0.025));
      glaze(0.5);
      break;
    }
    case 'checker':
      if ((tx + ty) % 2 === 0) {
        ctx.fillStyle = light(0.05);
        ctx.fillRect(x0, y0, c, c);
      }
      glaze(0.8);
      break;
    case 'scales': {
      // Fish-scale ripples: two rows of soft arcs.
      ctx.lineWidth = c * 0.028;
      ctx.strokeStyle = light(0.09);
      for (let r = 0; r < 2; r++)
        for (let k = -1; k < 3; k++) {
          const cx = x0 + c * (k * 0.5 + (r ? 0.25 : 0));
          const cy = y0 + c * (r * 0.5 + 0.5);
          ctx.beginPath();
          ctx.arc(cx, cy, c * 0.25, Math.PI, Math.PI * 2);
          ctx.stroke();
        }
      glaze(0.6);
      break;
    }
    case 'circuit': {
      // Neon: a faint glowing square set into each tile.
      const i = c * 0.2;
      ctx.lineWidth = c * 0.03;
      ctx.strokeStyle = 'rgba(140, 120, 255, 0.16)';
      ctx.beginPath();
      ctx.roundRect(x0 + i, y0 + i, c - i * 2, c - i * 2, c * 0.12);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 90, 220, 0.14)';
      ctx.beginPath();
      ctx.arc(x0 + c / 2, y0 + c / 2, c * 0.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'diamond': {
      ctx.fillStyle = light(0.055);
      ctx.beginPath();
      ctx.moveTo(x0 + c / 2, y0 + c * 0.16);
      ctx.lineTo(x0 + c * 0.84, y0 + c / 2);
      ctx.lineTo(x0 + c / 2, y0 + c * 0.84);
      ctx.lineTo(x0 + c * 0.16, y0 + c / 2);
      ctx.closePath();
      ctx.fill();
      glaze(0.7);
      break;
    }
    case 'planks': {
      // Wood grain running along each plank, a knot now and then.
      ctx.lineWidth = c * 0.014;
      for (let k = 0; k < 4; k++) {
        const yy = y0 + c * (0.14 + k * 0.24 + rnd() * 0.06);
        const amp = c * (0.015 + rnd() * 0.025);
        const ph = rnd() * 6;
        ctx.strokeStyle = k % 2 ? light(0.06) : dark(0.13);
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) {
          const xx = x0 + (i / 12) * c;
          const y = yy + Math.sin(ph + i * 0.7) * amp;
          if (i === 0) ctx.moveTo(xx, y);
          else ctx.lineTo(xx, y);
        }
        ctx.stroke();
      }
      if (rnd() < 0.18) {
        ctx.strokeStyle = dark(0.14);
        ctx.beginPath();
        ctx.ellipse(x0 + c * (0.3 + rnd() * 0.4), y0 + c * (0.3 + rnd() * 0.4), c * 0.09, c * 0.05, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Flat grain only: floors have no depth.
      break;
    }
    case 'mosaic': {
      // Four small squares per tile in two soft shades.
      const h = c / 2;
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? light(0.07) : dark(0.04);
          ctx.fillRect(x0 + i * h, y0 + j * h, h, h);
        }
      ctx.fillStyle = dark(0.09);
      ctx.fillRect(x0 + h - c * 0.01, y0, c * 0.02, c);
      ctx.fillRect(x0, y0 + h - c * 0.01, c, c * 0.02);
      glaze(0.6);
      break;
    }
    case 'marble': {
      // A pale vein wandering across each slab, and a little mottling.
      ctx.lineWidth = c * 0.016;
      ctx.strokeStyle = light(0.12);
      ctx.beginPath();
      const sy = y0 + c * (0.15 + rnd() * 0.7);
      ctx.moveTo(x0, sy);
      ctx.bezierCurveTo(x0 + c * 0.35, sy + (rnd() - 0.5) * c * 0.8, x0 + c * 0.65, sy + (rnd() - 0.5) * c * 0.8, x0 + c, y0 + c * (0.15 + rnd() * 0.7));
      ctx.stroke();
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = rnd() < 0.5 ? light(0.05) : dark(0.06);
        ctx.beginPath();
        ctx.arc(x0 + rnd() * c, y0 + rnd() * c, c * (0.03 + rnd() * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
      glaze(0.6);
      break;
    }
  }
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export interface PaintStroke {
  /** Cells painted, keyed y*w+x, with the time they were painted (ms). */
  painted: Map<number, number>;
  /** Travel axis each tile was painted along: 0 across, 1 down, 2 both. */
  axis?: Map<number, number>;
  /** Ball centre in cell units while a slide is in progress. */
  active?: { from: Point; pos: { x: number; y: number } };
  /** The same for each other ball rolling just now (after an x3 split). */
  more?: { from: Point; pos: { x: number; y: number } }[];
  /**
   * Splatter: lumpy blobs that pop up and shrink away over `life` ms
   * (default 900); `red` ones are the smaller red drops, `top` ones sit on
   * the ball.
   */
  dots: { x: number; y: number; r: number; t: number; life?: number; red?: boolean; top?: boolean }[];
  /**
   * When the ball last rolled over each tile, and along which axis (0 across,
   * 1 down): fresh paint there has a wet sheen that dries away.
   */
  wet?: Map<number, { t: number; axis: number }>;
  /** Start tile drawn as a round puddle under the ball until the first move. */
  startRound?: number;
  /** Splash stains where the ball hit walls: groups of blobs in board px. */
  splats: { blobs: { x: number; y: number; r: number }[]; t: number }[];
}

/** One level's board: static baked layers plus live paint and glow layers. */
/** How much of a tile the near lip of an opening hides (see build). */
const LIP = 0.25;
/** How far down the floor the shade under a wall face reaches, in tiles. */
const SHADE = 0.33;
/** The darker rim paint keeps along a wall face, in tiles. */
const PAINT_RIM = 0.14;

export class Board extends Container {
  readonly cols: number;
  readonly rows: number;
  readonly pad: number;
  readonly paintLayer = new Container();
  readonly fxLayer = new Container();
  private gloss: PaintGloss | null = null;
  private readonly sawLayer = new Container();
  private readonly saws: Sprite[] = [];
  private sawAngle = 0;
  /** Sparks, portal sparkles and arrow chevrons, redrawn every frame. */
  private readonly mechG = new Graphics();
  private readonly sawFx: { x: number; y: number; r: number; acc: number; sparks: { a: number; t: number; life: number; len: number; col: number }[] }[] = [];
  private readonly arrowFx: { x: number; y: number; ang: number }[] = [];
  private sawHitAt = -1e9;
  /** Game clock speed (slow motion slows the saws too). */
  timeScale = 1;
  private lastMech = 0;
  private socketLayer?: Container;
  private readonly studLayer = new Container();
  private readonly studFront = new Container();
  private readonly grips = new Map<number, Grip>();

  private readonly portals: { s: Sprite; beam: Sprite; halo: Sprite }[] = [];
  private readonly pickups = new Map<number, { s: Sprite; glow: Sprite; base: number; y0: number; at: number }>();
  private lastTime = 0;

  private hitAt = -1;
  private hitPos = { x: 0, y: 0 };

  /** A wall hit at (x, y) board px: light and glitter ripple through the paint. */
  paintHit(x: number, y: number, power: number) {
    if (!this.gloss) return;
    this.hitAt = this.lastTime;
    this.hitPos = { x, y };
    this.gloss.uniforms.uHitP = power;
  }

  /** Where the board sits on screen, so paint patterns stay attached. */
  setPaintSpace(x: number, y: number, cellPx: number) {
    if (!this.gloss) return;
    this.gloss.uniforms.uBoard[0] = x;
    this.gloss.uniforms.uBoard[1] = y;
    this.gloss.uniforms.uCell = cellPx;
  }

  /** A coin, key or x3 badge was taken from this tile (`gone`: already, no pop). */
  pickup(p: Point, gone = false) {
    const it = this.pickups.get(p.y * this.cols + p.x);
    if (!it || it.at >= 0) return;
    it.at = gone ? -1e9 : this.lastTime;
    if (gone) {
      it.s.alpha = 0;
      it.glow.alpha = 0;
    }
  }

  /** Put a taken pickup back (an undo to before it was taken). */
  unpick(p: Point) {
    const it = this.pickups.get(p.y * this.cols + p.x);
    if (!it || it.at < 0) return;
    it.at = -1;
    it.s.scale.set(it.base);
    it.s.alpha = 1;
    it.glow.alpha = 1;
    it.s.y = it.y0;
  }

  /** The ball hit a saw: it whirrs faster for a moment. */
  sawHit(time: number) {
    this.sawHitAt = time;
  }
  readonly ballLayer = new Container();
  /**
   * The floor's shape, for clipping things that lie on the floor (the
   * ball's shadow) so nothing spills past its edges onto the page.
   */
  floorClip!: Sprite;
  private readonly paintG = new Graphics();
  private readonly wetG = new Graphics();
  private readonly dotsG = new Graphics();
  /** Splatter that landed on the ball itself, drawn over it. */
  private readonly topDotsG = new Graphics();
  private palette: { paint: number; lump: number[]; red: number[] } | null = null;
  private paintShade?: Container;
  private wetHolder?: Container;
  /** The lip's textured material, kept lined up with the page (see alignSlab). */
  private slabTiles?: TilingSprite;
  private readonly glowG = new Graphics();
  private readonly hintG = new Graphics();
  /**
   * The hint's landing marker and its pulse, as pre-rendered images: shapes
   * drawn with Graphics come out jagged here (the board renders through a
   * filter, without anti-aliasing), while a texture stays smooth.
   */
  private readonly hintMark = new Sprite();
  private readonly hintPulse = new Sprite();
  /** The arrows flowing along the hint lane (pooled; same reason). */
  private readonly hintArrows = new Container();
  private arrowTex: Texture | null = null;
  private readonly coneG = new Graphics();
  private readonly waveG = new Graphics();
  private paintGlow?: Graphics;
  private gridOver!: Sprite;
  private caustics?: ReturnType<typeof causticFilter>;
  private textures: Texture[] = [];
  private floorCells: Point[] = [];
  private readonly res: number;

  constructor(
    readonly level: Level,
    readonly theme: Theme,
    readonly cell: number,
    res: number,
  ) {
    super();
    // Snap so one cell is a whole number of texture pixels at any DPR.
    this.res = Math.max(1, Math.round(cell * res)) / cell;
    this.rows = level.grid.length;
    this.cols = level.grid[0].length;
    this.pad = cell;

    level.grid.forEach((row, y) => row.forEach((_, x) => isFloor(level.grid, x, y) && this.floorCells.push({ x, y })));
    this.build();
  }

  get boardWidth() {
    return this.cols * this.cell;
  }
  get boardHeight() {
    return this.rows * this.cell;
  }

  /** Floor for the board's shape: saw notches are part of the outline. */
  private isFloor = (x: number, y: number) => isFloor(this.level.grid, x, y) || this.level.grid[y]?.[x] === SAW;

  /** Wall cells enclosed by floor (not connected to the outside) belong to the plate. */
  private interiorWalls(): (x: number, y: number) => boolean {
    const { cols, rows } = this;
    const outside = new Set<number>();
    const key = (x: number, y: number) => (y + 1) * (cols + 2) + (x + 1);
    const stack: Point[] = [{ x: -1, y: -1 }];
    outside.add(key(-1, -1));
    while (stack.length) {
      const p = stack.pop()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < -1 || y < -1 || x > cols || y > rows) continue;
        if (this.isFloor(x, y) || outside.has(key(x, y))) continue;
        outside.add(key(x, y));
        stack.push({ x, y });
      }
    }
    return (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !this.isFloor(x, y) && !outside.has(key(x, y));
  }

  private sprite(canvas: HTMLCanvasElement): Sprite {
    const tex = Texture.from(canvas);
    this.textures.push(tex);
    const s = new Sprite(tex);
    s.scale.set(1 / this.res);
    s.position.set(-this.pad, -this.pad);
    return s;
  }

  /** A fresh copy of the floor's shape, to keep an effect inside the maze. */
  floorMask(): Sprite {
    const s = new Sprite(this.floorClip.texture);
    s.scale.copyFrom(this.floorClip.scale);
    s.position.copyFrom(this.floorClip.position);
    return s;
  }

  /** Thin band along the top (dy > 0) or bottom (dy < 0) edges of a mask. */
  private edgeBand(mask: HTMLCanvasElement, dy: number): HTMLCanvasElement {
    const out = makeCanvas(mask.width, mask.height);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(mask, 0, dy);
    return out;
  }

  /**
   * Grout lines only where two floor tiles meet, never along walls, so the
   * floor reads as evenly laid tiles.
   */
  private drawGrout(ctx: CanvasRenderingContext2D, color: string, c: number, off: number, gap: number) {
    // Lines sit on whole device pixels so they stay crisp and never fade
    // out between two pixel columns.
    ctx.fillStyle = color;
    const half = Math.floor(gap / 2);
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++) {
        if (!this.isFloor(x, y)) continue;
        const x0 = Math.round(off + x * c);
        const y0 = Math.round(off + y * c);
        const x1 = Math.round(off + (x + 1) * c);
        const y1 = Math.round(off + (y + 1) * c);
        if (this.isFloor(x + 1, y)) ctx.fillRect(x1 - half, y0, gap, y1 - y0);
        if (this.isFloor(x, y + 1)) ctx.fillRect(x0, y1 - half, x1 - x0, gap);
      }
  }


  private build() {
    const { cols, rows, theme } = this;
    const res = this.res;
    const c = this.cell * res;
    const off = this.pad * res;
    const W = cols * c + off * 2;
    const H = rows * c + off * 2;

    // Floor shape (where the ball rolls). Everything else is raised wall.
    const floorMask = makeCanvas(W, H);
    fillRoundedCells(floorMask.getContext('2d')!, this.isFloor, cols, rows, c, off, off, c * 0.5, '#fff');

    // Wall top surface around the maze: same material as the background,
    // so the walls read as blocks standing on the page. A soft bevel tone
    // where the wall tops round down toward the floor.
    const interior = this.interiorWalls();
    const slab = makeCanvas(W, H);
    fillRoundedCells(
      slab.getContext('2d')!,
      (x, y) => this.isFloor(x, y) || interior(x, y),
      cols,
      rows,
      c,
      off,
      off,
      c * 0.5,
      '#fff',
    );
    // A wooden board is a frame of its own, set on the page with a soft
    // shadow. Other wall tops are simply the page itself, so nothing is
    // drawn for them (a page-coloured plate would show its outline where
    // the page's drifting bubbles pass behind it), unless they carry an
    // effect such as the ocean's moving caustics.
    const framed = theme.texture === 'wood';
    // Wide enough that frames around neighbouring arms close up.
    const plateMask = dilate(slab, c * (framed ? 0.56 : 0.45));
    if (framed) {
      const sh = this.sprite(softBlur(tint(plateMask, '#5a2e10'), c * 0.35));
      sh.alpha = 0.32;
      sh.y += c * 0.12 / res;
      this.addChild(sh);
    }
    if (framed || theme.caustics) {
      const surface = makeCanvas(W, H);
      const sctx = surface.getContext('2d')!;
      sctx.drawImage(tint(plateMask, theme.wallTop), 0, 0);
      if (framed) texture(sctx, 'wood', W, H, c, false);
      const plate = this.sprite(surface);
      if (theme.caustics) {
        this.caustics = causticFilter();
        this.caustics.uniforms.uScale = c * 3.2;
        plate.filters = [this.caustics];
      }
      this.addChild(plate);
    }

    if (theme.neon) {
      const halo = this.sprite(softBlur(tint(floorMask, hex(theme.neon.edge)), c * 0.3));
      halo.blendMode = 'add';
      halo.alpha = 0.75;
      this.addChild(halo);
    }

    // A soft violet glow bleeding out round every opening, as in the
    // original, so the floor reads as sunk into the page.
    let glowCanvas: HTMLCanvasElement | null = null;
    let visibleFloor: HTMLCanvasElement | null = null;
    const glowAlpha = theme.edgeGlow ? 0.8 : 0.45;
    if (!theme.neon) {
      // It follows the floor as seen, i.e. without the strip the near lip
      // hides (see below), so it wraps round the visible corners and leaves
      // nothing beside or under the hidden edge.
      const visible = makeCanvas(W, H);
      const vctx = visible.getContext('2d')!;
      // The floor lifted at its near edges: where the floor also lies LIP
      // tiles below. (An intersection, so no faint residue of the hidden
      // edge's soft rim is left to bloom into a ghost outline.)
      vctx.drawImage(floorMask, 0, -LIP * c);
      vctx.globalCompositeOperation = 'destination-in';
      vctx.drawImage(floorMask, 0, 0);
      visibleFloor = visible;
      glowCanvas = softBlur(tint(dilate(visible, c * 0.04), theme.edgeGlow ?? theme.wallFace), c * 0.05);
      // As in the original the glow lies along the sides and tops of each
      // opening and thins away smoothly as an edge turns to face down,
      // leaving the near (bottom) edges crisp. Weight it by which way the
      // floor lies: compare how much floor is a little above each pixel
      // with how much is a little below. Beside a side the two match (full
      // glow); under a bottom edge there is only floor above (none).
      const cw = glowCanvas.width;
      const ch = glowCanvas.height;
      const near = softBlur(visible, c * 0.14).getContext('2d')!.getImageData(0, 0, cw, ch).data;
      const k = Math.max(1, Math.round(c * 0.16));
      const gtc = glowCanvas.getContext('2d')!;
      const img = gtc.getImageData(0, 0, cw, ch);
      const gd = img.data;
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const i = (y * cw + x) * 4 + 3;
          if (!gd[i]) continue;
          const above = y >= k ? near[i - k * cw * 4] : 0;
          const below = y + k < ch ? near[i + k * cw * 4] : 0;
          const w = 1 - Math.min(1, Math.max(0, ((above - below) / 255) * 2.5));
          gd[i] = Math.round(gd[i] * w);
        }
      gtc.putImageData(img, 0, 0);
      const glow = this.sprite(glowCanvas);
      glow.alpha = glowAlpha;
      this.addChild(glow);
    }

    // Flat floor with thin tile seams.
    const floorCanvas = makeCanvas(W, H);
    const fctx = floorCanvas.getContext('2d')!;
    fctx.drawImage(tint(floorMask, theme.floor), 0, 0);
    if (theme.texture) texture(fctx, theme.texture, W, H, c, true);
    fctx.globalCompositeOperation = 'source-atop';
    // Each tile's finish (glaze, marble, planks...) under the seams.
    if (theme.tiles)
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++)
          if (this.isFloor(x, y)) tileFinish(fctx, theme.tiles, off + x * c, off + y * c, c, x, y);
    // Hairline seams, about one CSS pixel, softened so tiles read as a
    // clean grid rather than a drawn table.
    const gap = Math.max(1, Math.round(res * 1.1));
    fctx.globalAlpha = 0.6;
    this.drawGrout(fctx, theme.gridLine, c, off, gap);
    fctx.globalAlpha = 1;
    // Stopper tiles: a grip plate set into the floor, so the tile reads as
    // one that stops the ball even before its studs are noticed. Shades of
    // the floor's own colour, so it suits every maze; paint covers it.
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (this.level.grid[y][x] !== STOPPER) continue;
        const vis = this.isFloor(x, y + 1) ? 1 : 1 - LIP;
        const m = c * 0.09;
        const px = off + x * c + m;
        const py = off + y * c + m;
        const pw = c - m * 2;
        const ph = c * vis - m * 2;
        const pr = c * 0.16;
        fctx.save();
        fctx.beginPath();
        fctx.roundRect(px, py, pw, ph, pr);
        fctx.fillStyle = 'rgba(20,8,55,0.14)';
        fctx.fill();
        fctx.clip();
        // Recessed: the plate's own rim shades its top edge.
        fctx.lineWidth = c * 0.07;
        fctx.strokeStyle = 'rgba(20,8,55,0.26)';
        fctx.beginPath();
        fctx.roundRect(px, py + c * 0.03, pw, ph + c * 0.06, pr);
        fctx.stroke();
        fctx.restore();
      }
    // The shade the wall face casts on the floor just below it: a band of
    // translucent darkening, so the grid still shows through.
    const shadeBand = this.edgeBand(floorMask, c * SHADE);
    const sbctx = shadeBand.getContext('2d')!;
    sbctx.globalCompositeOperation = 'destination-in';
    sbctx.drawImage(floorMask, 0, 0);
    fctx.drawImage(tint(shadeBand, theme.wallShadow), 0, 0);
    // The walls also cast a soft shadow onto the floor along its top and
    // left sides (light from the upper left), so every board reads as a
    // floor sunk well below its walls.
    const wallsC = makeCanvas(W, H);
    const wcx = wallsC.getContext('2d')!;
    wcx.fillStyle = '#fff';
    wcx.fillRect(0, 0, W, H);
    wcx.globalCompositeOperation = 'destination-out';
    wcx.drawImage(floorMask, 0, 0);
    const drop = makeCanvas(W, H);
    const dcx = drop.getContext('2d')!;
    dcx.drawImage(softBlur(wallsC, c * 0.16), c * 0.07, c * 0.11);
    dcx.globalCompositeOperation = 'destination-in';
    dcx.drawImage(floorMask, 0, 0);
    fctx.drawImage(tint(drop, theme.wallShadow), 0, 0);
    this.addChild(this.sprite(floorCanvas));

    // Live paint, clipped to the floor.
    const paintMask = this.sprite(floorMask);
    this.floorClip = this.sprite(floorMask);
    // Paint and its wet speckles get the glossy paint shader.
    const paintBody = new Container();
    paintBody.addChild(this.paintG);
    this.gloss = paintGloss(this.cell * 0.07 * res, theme.paintMode ?? 0);
    const alt = theme.paintAlt ?? theme.paintLight;
    this.gloss.uniforms.uAlt[0] = ((alt >> 16) & 255) / 255;
    this.gloss.uniforms.uAlt[1] = ((alt >> 8) & 255) / 255;
    this.gloss.uniforms.uAlt[2] = (alt & 255) / 255;
    paintBody.filters = [this.gloss];
    // Fresh paint's glow (see drawSheen) is soft inside, but clipped to the
    // paint itself (after the blur), so it never spills onto bare floor.
    this.wetG.filters = [new BlurFilter({ strength: c * 0.22 / res, quality: 3, resolution: res })];
    const wetClip = new Graphics(this.paintG.context);
    const wet = new Container();
    wet.addChild(this.wetG);
    wet.mask = wetClip;
    this.wetHolder = wet;
    this.paintLayer.addChild(paintBody, wet, wetClip, this.waveG, paintMask);
    this.paintLayer.mask = paintMask;
    const seams = makeCanvas(W, H);
    const gctx = seams.getContext('2d')!;
    this.drawGrout(gctx, theme.paintSeam, c, off, gap);
    gctx.globalCompositeOperation = 'destination-in';
    gctx.drawImage(floorMask, 0, 0);
    this.gridOver = this.sprite(seams);
    // Paint covers the floor's shade, keeping only a thin darker rim along
    // the wall (as in the original: pink 238,40,143 becomes 212,27,101 for
    // the top seventh of the tile): the same paint shapes drawn again,
    // darkened, and shown only in that rim.
    const rim = this.edgeBand(floorMask, c * PAINT_RIM);
    const rimctx = rim.getContext('2d')!;
    rimctx.globalCompositeOperation = 'destination-in';
    rimctx.drawImage(floorMask, 0, 0);
    const paintShade = new Container();
    const shadeG = new Graphics(this.paintG.context);
    shadeG.tint = 0xe3acb4;
    const shadeMask = this.sprite(rim);
    paintShade.addChild(shadeG, shadeMask);
    paintShade.mask = shadeMask;
    this.paintShade = paintShade;
    this.addChild(this.paintLayer, paintShade, this.gridOver);
    // Stopper grips: four chunky glossy studs in sockets that stay visible
    // over the paint and clamp onto the ball when it stops here.
    const studs = makeCanvas(W, H);
    const tctx = studs.getContext('2d')!;
    const sr = c * 0.13;
    const studTex = this.studTexture(sr / res, res);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (this.level.grid[y][x] !== STOPPER) continue;
        const grip: Grip = { at: -1e9, studs: [] };
        for (const [ux, uy] of studPos(!this.isFloor(x, y + 1))) {
          const sx = off + (x + ux) * c;
          const sy = off + (y + uy) * c;
          // Socket: a dark ring the stud is set into, and a soft shadow
          // falling below it (light from above).
          const rg = tctx.createRadialGradient(sx, sy + sr * 0.3, sr * 0.75, sx, sy + sr * 0.3, sr * 1.5);
          rg.addColorStop(0, 'rgba(24,10,60,0.42)');
          rg.addColorStop(1, 'rgba(24,10,60,0)');
          tctx.fillStyle = rg;
          tctx.beginPath();
          tctx.arc(sx, sy + sr * 0.3, sr * 1.5, 0, Math.PI * 2);
          tctx.fill();
          tctx.fillStyle = 'rgba(24,10,60,0.5)';
          tctx.beginPath();
          tctx.ellipse(sx, sy + sr * 0.18, sr * 1.08, sr * 1.0, 0, 0, Math.PI * 2);
          tctx.fill();
          const s = new Sprite(studTex);
          s.anchor.set(0.5);
          s.scale.set(1 / res);
          s.position.set((x + ux) * this.cell, (y + uy) * this.cell);
          // The front pair stands in front of a ball held between them.
          (uy > 0.5 ? this.studFront : this.studLayer).addChild(s);
          grip.studs.push({ s, x0: s.x, y0: s.y, cx: (x + 0.5) * this.cell, cy: (y + 0.5) * this.cell });
        }
        this.grips.set(y * cols + x, grip);
      }
    // Curved corners: a white rounded bracket hugging the closed corner,
    // showing the ball will be swung round it. Drawn above the walls so the
    // wall shadow does not grey them out.
    const marks = makeCanvas(W, H);
    const mctx = marks.getContext('2d')!;
    let hasMarks = false;
    const corners: Record<number, [number, number, number, number]> = {
      [CURVE_TL]: [0, 0, 1, 1],
      [CURVE_TR]: [1, 0, -1, 1],
      [CURVE_BL]: [0, 1, 1, -1],
      [CURVE_BR]: [1, 1, -1, -1],
    };
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const k = corners[this.level.grid[y][x]];
        if (!k) continue;
        hasMarks = true;
        const [cx, cy, sx, sy] = k;
        const x0 = off + (x + cx) * c;
        const y0 = off + (y + cy) * c;
        const ins = c * 0.15;
        // Snug against the wall above (in its shade), or lifted clear of
        // the near lip that hides the bottom of the tile below.
        const insY = sy > 0 ? ins : ins + c * LIP;
        const len = c * 0.62;
        const lenY = insY + (len - ins) * 0.85;
        const r = c * 0.28;
        const bracket = (dy: number, color: string, width: number) => {
          mctx.strokeStyle = color;
          mctx.lineWidth = width;
          mctx.lineCap = 'round';
          mctx.beginPath();
          mctx.moveTo(x0 + sx * ins, y0 + sy * lenY + dy);
          mctx.arcTo(x0 + sx * ins, y0 + sy * insY + dy, x0 + sx * len, y0 + sy * insY + dy, r);
          mctx.lineTo(x0 + sx * len, y0 + sy * insY + dy);
          mctx.stroke();
        };
        bracket(c * 0.035, 'rgba(20,10,50,0.28)', c * 0.12);
        bracket(0, '#ffffff', c * 0.1);
      }
    this.addChild(this.sprite(studs), this.studLayer);
    if (theme.neon) {
      const glow = new Graphics();
      glow.filters = [new BlurFilter({ strength: this.cell * 0.35, quality: 2 })];
      glow.blendMode = 'add';
      glow.alpha = 0.7;
      this.paintGlow = glow;
      this.addChild(glow);
    }

    // The walls' front faces, seen along the top edge of the floor, after
    // the original: one flat band of face colour standing above each
    // opening's top edge (the shade it casts is drawn on the floor, above).
    const faceH = c * 0.24;
    const rise = (h: number) => {
      const o = makeCanvas(W, H);
      const octx = o.getContext('2d')!;
      octx.drawImage(floorMask, 0, -h);
      octx.globalCompositeOperation = 'destination-out';
      octx.drawImage(floorMask, 0, 0);
      return o;
    };
    const walls = makeCanvas(W, H);
    const wctx = walls.getContext('2d')!;
    // The face's top edge softens into the page over a thin stretch: fine
    // nested bands one device pixel apart, so it is smooth with no steps.
    // Its foot, at the floor, stays crisp.
    const fade = Math.round(c * 0.06);
    const tinted = tint(floorMask, theme.wallFace);
    const fadeC = makeCanvas(W, H);
    const fctx2 = fadeC.getContext('2d')!;
    for (let i = fade; i >= 1; i--) {
      fctx2.globalAlpha = Math.min(1, 2.2 / fade);
      fctx2.drawImage(tinted, 0, -(faceH + i));
    }
    fctx2.globalAlpha = 1;
    // Keep the fade to the wall: off the floor itself.
    fctx2.globalCompositeOperation = 'destination-out';
    fctx2.drawImage(floorMask, 0, 0);
    wctx.drawImage(fadeC, 0, 0);
    wctx.drawImage(tint(rise(faceH), theme.wallFace), 0, 0);
    // The face is the wall's own material in shade (wood grain, stars,
    // knit...), and deepens toward its foot where it meets the floor.
    wctx.save();
    wctx.globalCompositeOperation = 'source-atop';
    if (theme.slab) {
      wctx.globalAlpha = 0.3;
      wctx.fillStyle = wctx.createPattern(slabCanvas(theme.slab, res), 'repeat')!;
      wctx.fillRect(0, 0, W, H);
      wctx.globalAlpha = 1;
    }
    // One pixel-thin step at a time, so the darkening is a smooth gradient
    // down the face rather than a second band stacked on it.
    const steps = Math.max(4, Math.round(faceH));
    const foot = tint(floorMask, '#000');
    const shade = makeCanvas(W, H);
    const shctx = shade.getContext('2d')!;
    shctx.globalAlpha = 0.16 / steps;
    for (let i = 1; i <= steps; i++) shctx.drawImage(foot, 0, -(faceH * i) / steps);
    shctx.globalAlpha = 1;
    shctx.globalCompositeOperation = 'destination-out';
    shctx.drawImage(floorMask, 0, 0);
    wctx.drawImage(shade, 0, 0);
    wctx.restore();
    // Arrow tiles: a soft raised pad (here) with white chevrons that pulse
    // the way it sends the ball (drawn live in update).
    const arrowAngle: Record<number, number> = { [ARROW_R]: 0, [ARROW_D]: Math.PI / 2, [ARROW_L]: Math.PI, [ARROW_U]: -Math.PI / 2 };
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const ang = arrowAngle[this.level.grid[y][x]];
        if (ang === undefined) continue;
        hasMarks = true;
        const px = off + (x + 0.14) * c;
        const py = off + (y + 0.14) * c;
        mctx.fillStyle = 'rgba(20, 10, 50, 0.25)';
        mctx.beginPath();
        mctx.roundRect(px, py + c * 0.04, c * 0.72, c * 0.72, c * 0.2);
        mctx.fill();
        const pg = mctx.createLinearGradient(0, py, 0, py + c * 0.72);
        pg.addColorStop(0, 'rgba(255,255,255,0.2)');
        pg.addColorStop(1, 'rgba(255,255,255,0.07)');
        mctx.fillStyle = pg;
        mctx.beginPath();
        mctx.roundRect(px, py, c * 0.72, c * 0.72, c * 0.2);
        mctx.fill();
        this.arrowFx.push({ x: (x + 0.5) * this.cell, y: (y + 0.5) * this.cell, ang });
      }
    this.addChild(this.sprite(walls));
    if (hasMarks) this.addChild(this.sprite(marks));

    // Saws, as in the original: a blade spinning in a dark socket set into
    // the floor, throwing sparks off its rim (see update).
    const cs = this.cell;
    const sawTex = sawBlade(cs * 0.4, res);
    const socketTex = sawSocket(cs * 0.84, res);
    const glowTex = glowTexture(cs * 0.5, res);
    this.textures.push(sawTex, socketTex, glowTex);
    // Sockets are clipped to the floor, so one in a rounded notch at the
    // board's edge never pokes its corners out past it.
    const sockets = new Container();
    const sockMask = this.sprite(floorMask);
    sockets.addChild(sockMask);
    sockets.mask = sockMask;
    this.socketLayer = sockets;
    this.sawLayer.addChild(sockets);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (this.level.grid[y][x] !== SAW) continue;
        const socket = new Sprite(socketTex);
        socket.anchor.set(0.5);
        socket.scale.set(1 / res);
        socket.position.set((x + 0.5) * cs, (y + 0.5) * cs);
        const blade = new Sprite(sawTex);
        blade.anchor.set(0.5);
        blade.scale.set(1 / res);
        blade.position.copyFrom(socket.position);
        this.saws.push(blade);
        this.sawFx.push({ x: blade.x, y: blade.y, r: cs * 0.4, acc: 0, sparks: [] });
        sockets.addChild(socket);
        this.sawLayer.addChild(blade);
      }
    // Portals, as in the original: a glowing orb with a white rim and a
    // column of light rising from it, sparkles drifting up (see update).
    // One end pink, the other cyan.
    const beamTex = beamTexture(cs * 0.95, cs * 1.9, res);
    this.textures.push(beamTex);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const v = this.level.grid[y][x];
        if (v !== PORTAL_A && v !== PORTAL_B) continue;
        const pink = v === PORTAL_A;
        const col = pink ? 0xff5fe0 : 0x3fd8ff;
        const tex = portalTexture(cs * 0.4, res, pink ? ['#fff0ff', '#ff86e8', '#c247f5'] : ['#effeff', '#6ee9ff', '#2a86f0']);
        this.textures.push(tex);
        const cx = (x + 0.5) * cs;
        const cy = (y + 0.5) * cs;
        const halo = new Sprite(glowTex);
        halo.anchor.set(0.5);
        halo.scale.set((cs * 1.5) / glowTex.width);
        halo.tint = col;
        halo.blendMode = 'add';
        halo.alpha = 0.55;
        halo.position.set(cx, cy);
        const beam = new Sprite(beamTex);
        beam.anchor.set(0.5, 1);
        beam.scale.set(1 / res);
        beam.tint = col;
        beam.blendMode = 'add';
        beam.position.set(cx, cy + cs * 0.1);
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        sp.scale.set(1 / res);
        sp.position.set(cx, cy);
        this.portals.push({ s: sp, beam, halo });
        this.sawLayer.addChild(halo, beam, sp);
      }
    // Coins, keys and x3 badges lying on tiles, bobbing gently in a soft glow.
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const v = this.level.grid[y][x];
        if (v !== COIN && v !== KEY && v !== MULT) continue;
        const img = v === MULT ? multBadge(cs * 0.27, res) : iconImage(v === COIN ? 'coin' : 'key');
        if (!img) continue;
        const tex = Texture.from(img);
        if (v === MULT) this.textures.push(tex);
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        const size = cs * (v === COIN ? 0.5 : v === MULT ? 0.67 : 0.6);
        sp.scale.set(size / Math.max(img.width, img.height));
        sp.position.set((x + 0.5) * cs, (y + 0.5) * cs);
        const glow = new Sprite(glowTex);
        glow.anchor.set(0.5);
        glow.scale.set((size * 1.9) / glowTex.width);
        glow.tint = v === COIN ? 0xffd84a : v === MULT ? 0xffffff : 0xfff0b0;
        glow.blendMode = 'add';
        glow.position.copyFrom(sp.position);
        this.sawLayer.addChild(glow, sp);
        this.pickups.set(y * cols + x, { s: sp, glow, base: sp.scale.x, y0: sp.y, at: -1 });
      }
    // Live effects over all of these: sparks, sparkles, arrow chevrons.
    this.sawLayer.addChild(this.mechG);
    // Splatter sits over the walls (in the original, lumps flung up the
    // lane overlap the wall face above it), under the speed cone and ball.
    this.buildHintMarks();
    this.addChild(this.sawLayer, this.glowG, this.dotsG, this.hintG, this.hintArrows, this.hintPulse, this.hintMark, this.coneG, this.fxLayer, this.floorClip, this.ballLayer, this.topDotsG, this.studFront);

    // The near lip: seen from slightly above and in front, the page's edge
    // below each opening hides the bottom of the tiles beside it, and of the
    // ball and paint on them, so the floor reads as sunk into the page (as
    // in the original). It is the page itself, reaching a hair past the
    // floor's own edge so no seam shows, with the same soft violet glow
    // along its edge as the other sides of the opening.
    if (!theme.neon) {
      const lipH = c * LIP;
      // Grown a little all round (curved sides too) so the floor's soft
      // edge under it never peeks out as a ghost outline, but never over
      // the visible floor.
      const lipMask = dilate(this.edgeBand(floorMask, -lipH), res * 1.5);
      if (visibleFloor) {
        const lmctx = lipMask.getContext('2d')!;
        lmctx.globalCompositeOperation = 'destination-out';
        lmctx.drawImage(visibleFloor, 0, 0);
      }
      const lip = makeCanvas(W, H);
      const lpctx = lip.getContext('2d')!;
      lpctx.drawImage(tint(lipMask, theme.wallTop), 0, 0);
      // A textured page (wood, terrazzo...): the lip shows the very same
      // material, lined up with the page behind it (see alignSlab).
      if (theme.slab) {
        const mask = this.sprite(lipMask);
        const tiles = new TilingSprite({ texture: slabTexture(theme.slab, res), width: W / res, height: H / res });
        tiles.position.set(-this.pad, -this.pad);
        tiles.mask = mask;
        this.slabTiles = tiles;
        this.addChild(tiles, mask);
        // Only the glow and the edge line go on top of it.
        lpctx.clearRect(0, 0, W, H);
        lpctx.drawImage(lipMask, 0, 0);
      }
      if (theme.texture) {
        lpctx.globalCompositeOperation = 'source-atop';
        texture(lpctx, theme.texture, W, H, c, false);
      }
      lpctx.globalCompositeOperation = 'source-atop';
      // The lip is the page, so it shows the same glow the page does
      // beside it (no seam where it ends at the sides).
      if (glowCanvas) {
        lpctx.globalAlpha = glowAlpha;
        lpctx.drawImage(glowCanvas, 0, 0);
      }
      // Along the near edge the original shows only a crisp, thin violet
      // line that clears within about 0.04 tiles (the sides' glow is wider).
      lpctx.globalAlpha = theme.edgeGlow ? 0.8 : 0.45;
      lpctx.drawImage(softBlur(tint(this.edgeBand(lipMask, c * 0.012), theme.edgeGlow ?? theme.wallFace), c * 0.018), 0, 0);
      lpctx.globalAlpha = 1;
      if (theme.slab) {
        // Start the overlay afresh: erasing the plain fill with the soft
        // edged mask would leave a faint rim of it (a light line).
        lpctx.globalCompositeOperation = 'source-over';
        lpctx.globalAlpha = 1;
        lpctx.clearRect(0, 0, W, H);
        if (glowCanvas) {
          const g = makeCanvas(W, H);
          const gc = g.getContext('2d')!;
          gc.globalAlpha = glowAlpha;
          gc.drawImage(glowCanvas, 0, 0);
          // No crisp edge line on a textured page: there it reads as an
          // outline drawn round the board.
          gc.globalCompositeOperation = 'destination-in';
          gc.drawImage(lipMask, 0, 0);
          lpctx.drawImage(g, 0, 0);
        }
      }
      this.addChild(this.sprite(lip));
    }
  }

  /** The ball stopped on the stopper at (x, y): its studs clamp onto it. */
  grip(x: number, y: number) {
    const g = this.grips.get(y * this.cols + x);
    if (g) g.at = this.lastTime;
    return !!g;
  }

  /**
   * A stopper stud: a polished silver bolt with real height. Seen slightly
   * from the front, so its side shows below the domed top.
   */
  private studTexture(r: number, res: number): Texture {
    const R = r * res;
    const S = Math.ceil(R * 3.2);
    const cv = makeCanvas(S, S);
    const ctx = cv.getContext('2d')!;
    const cx = S / 2;
    const cy = S / 2 - R * 0.2;
    const h = R * 0.34;
    // Contact shadow on the floor.
    const sh = ctx.createRadialGradient(cx, cy + h + R * 0.25, R * 0.4, cx, cy + h + R * 0.25, R * 1.25);
    sh.addColorStop(0, 'rgba(20,8,50,0.5)');
    sh.addColorStop(1, 'rgba(20,8,50,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(cx, cy + h + R * 0.25, R * 1.25, R * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    // The side: a short metal cylinder, lit from the upper left.
    const side = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    side.addColorStop(0, '#6d5cae');
    side.addColorStop(0.32, '#a596dc');
    side.addColorStop(0.6, '#8574c6');
    side.addColorStop(1, '#4f3f8f');
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx - R, cy + h);
    ctx.ellipse(cx, cy + h, R, R * 0.92, 0, Math.PI, 0, true);
    ctx.lineTo(cx + R, cy);
    ctx.closePath();
    ctx.fill();
    // The domed top.
    const top = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.05, cx, cy, R * 1.02);
    top.addColorStop(0, '#ffffff');
    top.addColorStop(0.45, '#f3efff');
    top.addColorStop(0.82, '#d6cdf4');
    top.addColorStop(1, '#b9acea');
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    // Bevel: a bright rim on the lit side.
    ctx.lineWidth = Math.max(1, R * 0.07);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.94, R * 0.86, 0, Math.PI * 0.95, Math.PI * 1.75);
    ctx.stroke();
    // Specular highlight.
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.33, cy - R * 0.36, R * 0.3, R * 0.18, -0.6, 0, Math.PI * 2);
    ctx.fill();
    const tex = Texture.from(cv);
    this.textures.push(tex);
    return tex;
  }

  /**
   * Live touches on the mechanics: sparks streaking off each saw's rim the
   * way it spins (thicker after a hit), sparkles drifting up each portal's
   * beam, and arrow chevrons lighting up in turn the way they send the ball.
   */
  private drawMechanics(time: number, boost: number) {
    const g = this.mechG;
    g.clear();
    const cell = this.cell;
    const dt = Math.min(50, Math.max(0, time - this.lastMech));
    this.lastMech = time;
    const SPARK = [0xfff27a, 0xffd23f, 0xffa230, 0xff7a2a];
    for (const s of this.sawFx) {
      s.acc += dt * 0.028 * (1 + boost * 3);
      while (s.acc >= 1) {
        s.acc -= 1;
        s.sparks.push({
          a: Math.random() * Math.PI * 2,
          t: time,
          life: 150 + Math.random() * 200,
          len: 0.3 + Math.random() * 0.55,
          col: SPARK[Math.floor(Math.random() * SPARK.length)],
        });
      }
      s.sparks = s.sparks.filter((k) => time - k.t < k.life);
      for (const k of s.sparks) {
        const u = (time - k.t) / k.life;
        const head = k.a + u * 1.3;
        const tail = head - k.len * (1 - u * 0.6);
        const rr = s.r * (1.0 + u * 0.14);
        g.moveTo(s.x + Math.cos(tail) * rr, s.y + Math.sin(tail) * rr)
          .arc(s.x, s.y, rr, tail, head)
          .stroke({ width: cell * 0.045 * (1 - u * 0.7), color: k.col, alpha: (1 - u) ** 0.7, cap: 'round' });
      }
    }
    for (let i = 0; i < this.portals.length; i++) {
      const { s } = this.portals[i];
      for (let j = 0; j < 7; j++) {
        const ph = (time / 1600 + j / 7 + i * 0.37) % 1;
        const x = s.x + Math.sin(j * 2.1 + time * 0.0021) * cell * 0.17 * (0.4 + ph * 0.6);
        const y = s.y - ph * cell * 1.35;
        g.circle(x, y, cell * (0.022 + (j % 3) * 0.008)).fill({ color: 0xffffff, alpha: Math.sin(Math.PI * ph) * 0.9 });
      }
    }
    const phase = (time * 0.0016) % 1;
    for (const a of this.arrowFx) {
      const cos = Math.cos(a.ang);
      const sin = Math.sin(a.ang);
      const at = (u: number, v: number) => [a.x + (u * cos - v * sin) * cell, a.y + (u * sin + v * cos) * cell] as const;
      for (let j = 0; j < 2; j++) {
        const dx = -0.1 + j * 0.2;
        // A light runs through the chevrons, back to front.
        const lit = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (phase - j * 0.3));
        for (const [col, w, oy, al] of [
          [0x140a32, 0.12, 0.03, 0.3],
          [0xffffff, 0.1, 0, 0.45 + 0.55 * lit],
        ] as const) {
          const p0 = at(dx - 0.09, -0.17);
          const p1 = at(dx + 0.09, 0);
          const p2 = at(dx - 0.09, 0.17);
          g.moveTo(p0[0], p0[1] + oy * cell).lineTo(p1[0], p1[1] + oy * cell).lineTo(p2[0], p2[1] + oy * cell)
            .stroke({ width: cell * w, color: col, alpha: al, cap: 'round', join: 'round' });
        }
      }
    }
  }

  /**
   * Line the lip's material up with the page behind the board: map each
   * point of it back to its place on screen, at the page texture's scale.
   */
  alignSlab() {
    const t = this.slabTiles;
    if (!t) return;
    // Where the board's origin and unit steps land on screen right now.
    const o = this.toGlobal({ x: 0, y: 0 });
    const a = this.toGlobal({ x: 1, y: 0 }).x - o.x || 1;
    const d = this.toGlobal({ x: 0, y: 1 }).y - o.y || 1;
    t.tileScale.set(1 / (a * this.res), 1 / (d * this.res));
    t.tilePosition.set(-(t.x + o.x / a), -(t.y + o.y / d));
  }

  cellCenter(x: number, y: number): Point {
    return { x: (x + 0.5) * this.cell, y: (y + 0.5) * this.cell };
  }

  update(time: number, stroke: PaintStroke, remaining: Point[]) {
    this.lastTime = time;
    if (this.caustics) this.caustics.uniforms.uTime = time * 0.00035;
    if (this.gloss) {
      this.gloss.uniforms.uTime = time * 0.001;
      const u = this.gloss.uniforms;
      u.uHit[2] = this.hitAt < 0 ? -1 : (time - this.hitAt) * 0.001;
      if (this.hitAt >= 0) {
        // The shader's px are CSS pixels measured from the board's corner
        // (as the paint layer is rendered), so the hit and a tile's size go
        // in those units too.
        const g0 = this.toGlobal({ x: 0, y: 0 });
        const g = this.toGlobal(this.hitPos);
        const g1 = this.toGlobal({ x: this.hitPos.x + this.cell, y: this.hitPos.y });
        u.uHit[0] = g.x - g0.x;
        u.uHit[1] = g.y - g0.y;
        u.uHitK = Math.hypot(g1.x - g.x, g1.y - g.y);
      }
    }
    // Saws spin; after a hit they whirr faster for a moment.
    const boost = Math.max(0, 1 - (time - this.sawHitAt) / 900);
    this.sawAngle += 0.16 * (1 + boost * 2.5) * this.timeScale;
    for (const b of this.saws) b.rotation = this.sawAngle;
    this.drawMechanics(time, boost);
    for (let i = 0; i < this.portals.length; i++) {
      const p = this.portals[i];
      const pulse = Math.sin(time * 0.004 + i * 1.7);
      p.s.scale.set((1 / this.res) * (1 + pulse * 0.04));
      p.halo.alpha = 0.5 + pulse * 0.12;
      p.beam.alpha = 0.95 + Math.sin(time * 0.0067 + i) * 0.05;
    }
    let i = 0;
    for (const p of this.pickups.values()) {
      i++;
      if (p.at < 0) {
        p.s.y = p.y0 + Math.sin(time * 0.004 + i) * this.cell * 0.05;
        p.glow.alpha = 0.55 + Math.sin(time * 0.006 + i) * 0.2;
      } else {
        // Picked up: pop up and fade out.
        const t = Math.min(1, (time - p.at) / 320);
        p.s.scale.set(p.base * (1 + t * 0.8));
        p.s.alpha = 1 - t;
        p.glow.alpha = 1 - t;
        p.s.y = p.y0 - t * this.cell * 0.4;
      }
    }
    for (const g of this.grips.values()) {
      const t = (time - g.at) / 380;
      if (t < 0 || t > 1.2) continue;
      // Snap in toward the ball, hold, then ease back with a little give.
      const k = t >= 1 ? 0 : t < 0.18 ? 1 - (1 - t / 0.18) ** 2 : Math.cos(((t - 0.18) / 0.82) * Math.PI * 1.5) * (1 - (t - 0.18) / 0.82);
      for (const st of g.studs) {
        st.s.position.set(st.x0 + (st.cx - st.x0) * 0.2 * k, st.y0 + (st.cy - st.y0) * 0.2 * k);
        st.s.scale.set((1 + 0.2 * Math.max(0, k)) / this.res);
      }
    }
    this.drawPaint(time, stroke);
    this.drawGlow(time, remaining);
  }

  private drawPaint(time: number, stroke: PaintStroke) {
    const { cell, theme } = this;
    const w = this.cols;
    const half = cell / 2;
    const g = this.paintG;
    const wet = this.wetG;
    g.clear();
    wet.clear();
    const has = (x: number, y: number) => {
      if (x < 0 || x >= w) return false;
      const t = stroke.painted.get(y * w + x);
      return t !== undefined && time >= t;
    };
    // Settled paint: tiles whose paint has finished flowing out to the edges.
    const isPainted = (x: number, y: number) => {
      const k = y * w + x;
      if (x < 0 || x >= w || k === stroke.startRound) return false;
      const t = stroke.painted.get(k);
      return t !== undefined && time >= t + SPREAD_MS;
    };
    // Painted tiles form one soft blob, like the floor itself: convex corners
    // are rounded and concave corners filleted wherever paint meets unpainted
    // floor (the floor mask already shapes the edges against walls).
    const r = cell * 0.5;
    for (const [k, t] of stroke.painted) {
      if (time < t) continue;
      const x = k % w;
      const y = Math.floor(k / w);
      const age = time - t;
      if (k === stroke.startRound) {
        const grow = Math.min(1, age / 200);
        // A puddle centred exactly under the ball (which sits a little
        // up-tile, see Ball), wider than it so an even ring shows all round.
        g.circle((x + 0.5) * cell, (y + 0.42) * cell, cell * 0.6 * (0.4 + 0.6 * (1 - (1 - grow) ** 3)));
        continue;
      }
      if (age >= SPREAD_MS) {
        roundedCell(g, x, y, cell, r, isPainted);
        continue;
      }
      // Fresh paint flows out from under the ball: a narrow wet stream that
      // swells sideways until it fills the tile, reaching into painted
      // neighbours along the stroke so the stream stays continuous.
      const f = age / SPREAD_MS;
      const e = 1 - (1 - f) ** 3;
      const wob = 1 + Math.sin(age * 0.045 + k * 1.7) * 0.05 * (1 - f);
      const hw = half * Math.min(1.02, (0.38 + 0.64 * e) * wob);
      const axis = stroke.axis?.get(k) ?? 2;
      const cx = (x + 0.5) * cell;
      const cy = (y + 0.5) * cell;
      const reach = r + 0.5;
      const L = axis !== 1 && has(x - 1, y) ? x * cell - reach : axis === 0 ? x * cell - 0.5 : cx - hw;
      const R = axis !== 1 && has(x + 1, y) ? (x + 1) * cell + reach : axis === 0 ? (x + 1) * cell + 0.5 : cx + hw;
      const T = axis !== 0 && has(x, y - 1) ? y * cell - reach : axis === 1 ? y * cell - 0.5 : cy - hw;
      const B = axis !== 0 && has(x, y + 1) ? (y + 1) * cell + reach : axis === 1 ? (y + 1) * cell + 0.5 : cy + hw;
      const x0 = axis === 1 ? cx - hw : L;
      const x1 = axis === 1 ? cx + hw : R;
      const y0 = axis === 0 ? cy - hw : T;
      const y1 = axis === 0 ? cy + hw : B;
      const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
      g.roundRect(x0, y0, x1 - x0, y1 - y0, rr);
    }
    for (let j = 0; j <= this.rows; j++)
      for (let i = 0; i <= w; i++) {
        const tl = isPainted(i - 1, j - 1);
        const tr = isPainted(i, j - 1);
        const bl = isPainted(i - 1, j);
        const br = isPainted(i, j);
        if (+tl + +tr + +bl + +br !== 3) continue;
        const ex = !tl || !bl ? i - 1 : i;
        const ey = !tl || !tr ? j - 1 : j;
        const px = i * cell;
        const py = j * cell;
        if (!this.isFloor(ex, ey)) {
          // The floor curves into this wall corner; paint the whole corner
          // and let the floor mask trim it to the exact curve.
          g.rect(ex < i ? px - half : px - 0.5, ey < j ? py - half : py - 0.5, half + 0.5, half + 0.5);
          continue;
        }
        const sx = ex < i ? -1 : 1;
        const sy = ey < j ? -1 : 1;
        g.moveTo(px - sx * 0.5, py - sy * 0.5)
          .lineTo(px + sx * r, py - sy * 0.5)
          .arcTo(px, py, px, py + sy * r, r)
          .lineTo(px - sx * 0.5, py + sy * r)
          .closePath();
      }
    this.drawSheen(time, stroke, has);
    for (const band of [stroke.active, ...(stroke.more ?? [])]) {
      if (!band) continue;
      // The full width of the lane from the start of this run up to the
      // ball's nose (its centre plus a radius), under the ball. Ahead of
      // that the paint only shows as whole tiles (as in the original).
      const { from, pos } = band;
      const ax = (from.x + 0.5) * cell;
      const ay = (from.y + 0.5) * cell;
      const bx = (pos.x + 0.5) * cell;
      const by = (pos.y + 0.5) * cell;
      const hw = half;
      const x0 = Math.min(ax, bx) - hw;
      const y0 = Math.min(ay, by) - hw;
      const x1 = Math.max(ax, bx) + hw;
      const y1 = Math.max(ay, by) + hw;
      g.roundRect(x0, y0, x1 - x0, y1 - y0, hw);
    }
    for (const sp of stroke.splats) {
      const age = time - sp.t;
      const grow = age >= 220 ? 1 : 1 - (1 - Math.max(0, age) / 220) ** 3;
      for (const b of sp.blobs) g.circle(b.x, b.y, b.r * grow);
    }
    g.fill({ color: theme.paint });

    if (this.palette?.paint !== theme.paint) this.palette = { paint: theme.paint, ...splatPalette(theme.paint) };
    const pal = this.palette;
    this.dotsG.clear();
    this.topDotsG.clear();
    for (const dot of stroke.dots) {
      const age = time - dot.t;
      const life = dot.life ?? 900;
      if (age < 0 || age >= life) continue;
      // As in the original: each lump pops up, holds, then shrinks away.
      const hold = life * 0.5;
      const size = Math.min(1, 0.45 + age / 90) * (age < hold ? 1 : (1 - (age - hold) / (life - hold)) ** 0.8);
      if (size < 0.05) continue;
      lump(dot.top ? this.topDotsG : this.dotsG, dot.x, dot.y, dot.r * size, dot.x * 0.37 + dot.y * 0.61, dot.red ? pal.red : pal.lump);
    }

    if (this.paintGlow) {
      const pg = this.paintGlow;
      pg.clear();
      for (const k of stroke.painted.keys()) pg.rect((k % w) * cell, Math.floor(k / w) * cell, cell, cell);
      if (stroke.painted.size) pg.fill({ color: theme.paint, alpha: 0.6 });
    }
  }

  /**
   * Fresh paint glows, as in the original: the lane the ball has just
   * painted (or rolled back over) lights up with a soft wash of the paint's
   * light shade, brightest where the ball passed last, melting away over
   * about a second. Drawn as plain tiles and blurred into one soft glow.
   */
  private drawSheen(time: number, stroke: PaintStroke, has: (x: number, y: number) => boolean) {
    const wetMap = stroke.wet;
    const g = this.wetG;
    if (!wetMap?.size) return;
    const { cell, theme } = this;
    const w = this.cols;
    const DRY = 900;
    for (const [k, e] of wetMap) {
      const x = k % w;
      const y = Math.floor(k / w);
      const age = time - e.t;
      if (age < 0 || age >= DRY || !has(x, y)) continue;
      const a = (1 - age / DRY) ** 1.6;
      g.rect(x * cell, y * cell, cell, cell).fill({ color: theme.paintLight, alpha: 0.75 * a });
    }
    // The stretch from the middle of the last tile crossed up to the ball.
    if (stroke.active) {
      const { pos, from } = stroke.active;
      const ax = (from.x + 0.5) * cell;
      const ay = (from.y + 0.5) * cell;
      const bx = (pos.x + 0.5) * cell;
      const by = (pos.y + 0.5) * cell;
      const x0 = Math.min(ax, bx) - cell / 2;
      const y0 = Math.min(ay, by) - cell / 2;
      g.rect(x0, y0, Math.max(ax, bx) + cell / 2 - x0, Math.max(ay, by) + cell / 2 - y0).fill({ color: theme.paintLight, alpha: 0.35 });
    }
  }

  /**
   * The speed cone, as in the original: a crisp, see-through wedge of the
   * ball's colour from a point near where the run started (`apex`) out to
   * the ball's centre (`base`, board px), where it is 0.72 tiles across.
   */
  drawCone(apex: { x: number; y: number } | null, base: { x: number; y: number }, color: number) {
    const g = this.coneG;
    g.clear();
    if (!apex) return;
    const dx = base.x - apex.x;
    const dy = base.y - apex.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const w = this.cell * 0.36;
    const nx = (-dy / len) * w;
    const ny = (dx / len) * w;
    g.poly([apex.x, apex.y, base.x + nx, base.y + ny, base.x - nx, base.y - ny]).fill({ color, alpha: 0.5 });
  }

  /** Diagonal light sweep across the painted floor (level complete). */
  drawSweep(progress: number, strength = 1) {
    const g = this.waveG;
    g.clear();
    if (progress <= 0 || progress >= 1) return;
    const W = this.boardWidth;
    const H = this.boardHeight;
    const band = this.cell * 2.2;
    const span = W + H + band * 2;
    const x = -H - band + span * progress;
    // A soft diagonal band of light: thin slices with a bell-shaped falloff
    // and a bright core, so it reads as a sheen rather than a stripe.
    const n = 14;
    const sw = band / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const a = Math.exp(-(((u - 0.5) / 0.22) ** 2)) * 0.42 + Math.exp(-(((u - 0.5) / 0.06) ** 2)) * 0.2;
      const x0 = x + i * sw;
      g.poly([x0, 0, x0 + sw + 0.5, 0, x0 + sw + 0.5 - H, H, x0 - H, H]).fill({ color: 0xffffff, alpha: a * strength });
    }
  }

  private drawGlow(time: number, remaining: Point[]) {
    const g = this.glowG;
    g.clear();
    const { cell } = this;
    const few = remaining.length <= 4;
    for (const p of remaining) {
      const phase = (p.x * 0.7 + p.y * 1.3) % (Math.PI * 2);
      const b = 0.5 + 0.5 * Math.sin(time * 0.0025 + phase);
      if (few) {
        // Twinkle so the last few tiles are easy to spot.
        const cx = (p.x + 0.5) * cell;
        const cy = (p.y + 0.5) * cell;
        const s = cell * (0.12 + 0.1 * b);
        g.poly([cx, cy - s * 2, cx + s * 0.45, cy - s * 0.45, cx + s * 2, cy, cx + s * 0.45, cy + s * 0.45, cx, cy + s * 2, cx - s * 0.45, cy + s * 0.45, cx - s * 2, cy, cx - s * 0.45, cy - s * 0.45]).fill({
          color: 0xffffff,
          alpha: 0.35 + 0.5 * b,
        });
      }
    }
  }

  /**
   * The hint guide: a soft glowing lane from the ball along the next slide,
   * arrows flowing along it, and a pulsing landing ring with a ghost ball
   * where the move ends. Fades in so each new step reads as "next".
   */
  /** Smooth images for the hint's landing marker (see hintMark). */
  private buildHintMarks() {
    const { cell } = this;
    // Twice the board's own pixel density: crisp when the view zooms in.
    const k = this.res * 2;
    const ring = (r: number, w: number, draw: (x: CanvasRenderingContext2D, c: number) => void) => {
      const size = Math.ceil((r + w) * 2 * k) + 4;
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const x = cv.getContext('2d')!;
      x.scale(k, k);
      draw(x, size / k / 2);
      const tex = Texture.from(cv);
      this.textures.push(tex);
      return tex;
    };
    // Ghost ball: a soft disc in a bright ring, with a glint.
    const R = cell * 0.33;
    const W = cell * 0.065;
    this.hintMark.texture = ring(R, W, (x, c) => {
      x.fillStyle = 'rgba(255,255,255,0.22)';
      x.beginPath();
      x.arc(c, c, R, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.9)';
      x.lineWidth = W;
      x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.7)';
      x.beginPath();
      x.arc(c - cell * 0.1, c - cell * 0.1, cell * 0.07, 0, Math.PI * 2);
      x.fill();
    });
    // The ring that pulses outward (scaled about its mid size).
    const P = cell * 0.44;
    this.hintPulse.texture = ring(P, cell * 0.05, (x, c) => {
      x.strokeStyle = '#fff';
      x.lineWidth = cell * 0.05;
      x.beginPath();
      x.arc(c, c, P, 0, Math.PI * 2);
      x.stroke();
    });
    for (const sp of [this.hintMark, this.hintPulse]) {
      sp.anchor.set(0.5);
      sp.scale.set(1 / k);
      sp.visible = false;
    }
    // Arrow: a round-capped chevron pointing right (+x), turned per segment.
    const a = cell * 0.15;
    const w = cell * 0.1;
    const cw = Math.ceil((a * 2 + w) * k) + 4;
    const ch = Math.ceil((a * 2.5 + w) * k) + 4;
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const x = cv.getContext('2d')!;
    x.scale(k, k);
    const cx = cw / k / 2;
    const cy = ch / k / 2;
    x.strokeStyle = '#fff';
    x.lineWidth = w;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(cx - a, cy + a * 1.25);
    x.lineTo(cx + a, cy);
    x.lineTo(cx - a, cy - a * 1.25);
    x.stroke();
    this.arrowTex = Texture.from(cv);
    this.textures.push(this.arrowTex);
  }

  drawHint(time: number, hint: { from: Point; path: Point[]; dir: Point; since: number } | null) {
    const g = this.hintG;
    g.clear();
    this.hintMark.visible = this.hintPulse.visible = false;
    for (const a of this.hintArrows.children) a.visible = false;
    if (!hint || !hint.path.length) return;
    const { cell } = this;
    const pts = [hint.from, ...hint.path];
    const c = (p: Point) => ({ x: (p.x + 0.5) * cell, y: (p.y + 0.5) * cell });
    const linked = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
    const fade = Math.min(1, (time - hint.since) / 260);
    const appear = 1 - (1 - fade) ** 3;
    // Lane: a wide soft glow and a brighter core, broken at portal jumps.
    const lane = (width: number, alpha: number, color: number) => {
      for (let i = 1; i < pts.length; i++) {
        if (!linked(pts[i - 1], pts[i])) continue;
        const a = c(pts[i - 1]);
        const b = c(pts[i]);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ color, width, alpha: alpha * appear, cap: 'round', join: 'round' });
    };
    lane(cell * 0.62, 0.16, 0xffffff);
    lane(cell * 0.36, 0.28, 0xffffff);
    lane(cell * 0.1, 0.5, this.theme.paintLight);

    // Arrows flowing from the ball toward the landing tile.
    const segs: { a: { x: number; y: number }; b: { x: number; y: number }; d: Point }[] = [];
    for (let i = 1; i < pts.length; i++)
      if (linked(pts[i - 1], pts[i]))
        segs.push({ a: c(pts[i - 1]), b: c(pts[i]), d: { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y } });
    const total = segs.length;
    const gap = 0.62;
    const k = this.res * 2;
    let used = 0;
    for (let d = ((time * 0.0022) % gap) + 0.35; d < total - 0.15; d += gap) {
      const seg = segs[Math.min(total - 1, Math.floor(d))];
      const f = d - Math.floor(d);
      const x = seg.a.x + (seg.b.x - seg.a.x) * f;
      const y = seg.a.y + (seg.b.y - seg.a.y) * f;
      // Fade in near the ball and out near the target.
      const edge = Math.min(1, (d - 0.35) / 0.5, (total - 0.15 - d) / 0.6);
      let arrow = this.hintArrows.children[used] as Sprite | undefined;
      if (!arrow) {
        arrow = new Sprite(this.arrowTex ?? Texture.EMPTY);
        arrow.anchor.set(0.5);
        arrow.scale.set(1 / k);
        this.hintArrows.addChild(arrow);
      }
      used++;
      arrow.visible = true;
      arrow.position.set(x, y);
      arrow.rotation = Math.atan2(seg.d.y, seg.d.x);
      arrow.alpha = 0.95 * Math.max(0, edge) * appear;
    }

    // Landing marker: ghost ball inside a ring that pulses outward.
    const end = c(pts[pts.length - 1]);
    const beat = (time * 0.0014) % 1;
    const mark = this.hintMark;
    mark.visible = true;
    mark.position.set(end.x, end.y);
    mark.alpha = appear;
    const pulse = this.hintPulse;
    pulse.visible = true;
    pulse.position.set(end.x, end.y);
    pulse.scale.set(((0.34 + beat * 0.2) / 0.44) / k);
    pulse.alpha = 0.6 * (1 - beat) * appear;
  }

  floorPoints(): Point[] {
    return this.floorCells;
  }

  override destroy() {
    // Detach the sprite mask first: Pixi pools mask effects, and destroying a
    // still-attached mask leaves a stale effect that later renders at a
    // garbage (huge) size.
    this.paintLayer.mask = null;
    if (this.paintShade) this.paintShade.mask = null;
    if (this.wetHolder) this.wetHolder.mask = null;
    if (this.slabTiles) this.slabTiles.mask = null;
    if (this.socketLayer) this.socketLayer.mask = null;
    // Anything on the ball layer clipped to the floor (the ball's shadow).
    for (const c of this.ballLayer.children) (c as Container & { clipShadow?: (m: Sprite | null) => void }).clipShadow?.(null);
    super.destroy({ children: true });
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
  }
}
