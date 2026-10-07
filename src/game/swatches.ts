// Shop art, drawn once and cached as data URLs: coloured camo tiles behind
// the balls, glossy paint swatches (with their pattern) and miniature 3D
// maze boards, after the original's shop.
import type { PaintColor } from './cosmetics.ts';
import { makeCanvas, texture } from './shape.ts';
import type { Theme } from './themes.ts';

const cache = new Map<string, string>();
const S = 160;

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rounded tile with soft camouflage blobs in two tones. */
export function camoTile(key: string, base: string, blob: string): string {
  const id = `camo:${key}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, base);
  g.addColorStop(1, blob);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const r = seeded(key.length * 977 + key.charCodeAt(0) * 31);
  ctx.fillStyle = blob;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 9; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = S * (0.12 + r() * 0.14);
    ctx.beginPath();
    for (let k = 0; k <= 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const q = rad * (0.7 + 0.45 * Math.sin(a * 3 + i) * r());
      ctx.lineTo(x + Math.cos(a) * q * 1.3, y + Math.sin(a) * q);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, 0, 0, S);
  shade.addColorStop(0, 'rgba(255,255,255,0.18)');
  shade.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, S, S);
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}

/** Paint swatch: the paint over a 3x3 tile grid with a glossy wave. */
export function paintSwatch(p: PaintColor): string {
  const id = `paint:${p.id}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const base = [(p.paint >> 16) & 255, (p.paint >> 8) & 255, p.paint & 255];
  const alt = p.alt ?? p.light;
  const al = [(alt >> 16) & 255, (alt >> 8) & 255, alt & 255];
  const r = seeded(p.id.length * 131);
  const pts = Array.from({ length: 18 }, () => [r() * S, r() * S]);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let t = 0;
      if (p.pattern === 'marble') {
        const v = Math.sin((x * 0.03 + y * 0.018) * 2.2 + Math.sin(x * 0.05) * 2 + Math.sin(y * 0.04 + x * 0.02) * 2.5);
        t = Math.max(0, v) * 0.75;
      } else if (p.pattern === 'slime' || p.pattern === 'lava') {
        let f1 = 1e9;
        let f2 = 1e9;
        for (const [px, py] of pts) {
          const d = Math.hypot(px - x, py - y);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) f2 = d;
        }
        t = 1 - Math.min(1, (f2 - f1) / (p.pattern === 'lava' ? 5 : 6));
      } else if (p.pattern === 'water') {
        const v = Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) * Math.sin(y * 0.09 + Math.sin(x * 0.05) * 2);
        t = Math.max(0, v) ** 3 * 1.2;
      }
      t = Math.min(1, t);
      // Lower part darker with a soft wave edge, like the original swatches.
      const wave = S * 0.62 + Math.sin(x * 0.045) * S * 0.04;
      const k = y > wave ? 0.86 : 1.04;
      const i = (y * S + x) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[i + ch] = Math.min(255, (base[ch] * (1 - t) + al[ch] * t) * k);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 2;
  for (const f of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.moveTo(S * f, 0);
    ctx.lineTo(S * f, S);
    ctx.moveTo(0, S * f);
    ctx.lineTo(S, S * f);
    ctx.stroke();
  }
  const gloss = ctx.createLinearGradient(0, 0, 0, S * 0.5);
  gloss.addColorStop(0, 'rgba(255,255,255,0.28)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, S, S * 0.5);
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}

/** A tiny 3D maze: raised frame, sunken floor ring, a block in the middle. */
export function mazeSwatch(t: Theme): string {
  const id = `maze:${t.id}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = t.wallTop;
  ctx.fillRect(0, 0, S, S);
  if (t.texture) texture(ctx, t.texture, S, S, S / 3, false);
  const fx = S * 0.14;
  const fw = S * 0.72;
  // Sunken floor.
  rr(ctx, fx, fx, fw, fw, S * 0.08);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = t.floor;
  ctx.fillRect(fx, fx, fw, fw);
  if (t.texture) texture(ctx, t.texture, S, S, S / 3, true);
  ctx.strokeStyle = t.gridLine;
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 5; i++) {
    const p = fx + (fw * i) / 5;
    ctx.beginPath();
    ctx.moveTo(p, fx);
    ctx.lineTo(p, fx + fw);
    ctx.moveTo(fx, p);
    ctx.lineTo(fx + fw, p);
    ctx.stroke();
  }
  // Wall face and shadow along the top inner edge.
  ctx.fillStyle = t.wallFace;
  ctx.fillRect(fx, fx, fw, S * 0.06);
  ctx.fillStyle = t.wallShadow;
  ctx.fillRect(fx, fx + S * 0.06, fw, S * 0.05);
  ctx.restore();
  // Centre block: top, face below it and its shadow.
  const bx = S * 0.34;
  const bw = S * 0.32;
  ctx.fillStyle = t.wallShadow;
  rr(ctx, bx, bx + S * 0.06, bw, bw, S * 0.06);
  ctx.fill();
  ctx.fillStyle = t.wallFace;
  rr(ctx, bx, bx + S * 0.03, bw, bw, S * 0.06);
  ctx.fill();
  ctx.fillStyle = t.wallTop;
  rr(ctx, bx, bx - S * 0.02, bw, bw, S * 0.06);
  ctx.fill();
  if (t.texture) {
    ctx.save();
    rr(ctx, bx, bx - S * 0.02, bw, bw, S * 0.06);
    ctx.clip();
    texture(ctx, t.texture, S, S, S / 3, false);
    ctx.restore();
  }
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}

export { css as hexToCss };
