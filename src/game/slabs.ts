import { Texture } from 'pixi.js';
import { makeCanvas } from './shape.ts';

/**
 * Materials for the page and wall tops of the textured boards, as in the
 * original's maze themes: wood, terrazzo, grass, a starry night and knit.
 * Each is a seamless square tile (`TILE` CSS px) drawn once per screen
 * density and repeated over the whole page.
 */
export type SlabStyle = 'birch' | 'walnut' | 'terrazzo' | 'grass' | 'stars' | 'knit' | 'spooky';

export const TILE = 256;

const cache = new Map<string, HTMLCanvasElement>();

/** A steady random sequence, so a material always looks the same. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function slabCanvas(style: SlabStyle, res: number): HTMLCanvasElement {
  const key = `${style}@${res}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = Math.round(TILE * res);
  const cv = makeCanvas(S, S);
  const ctx = cv.getContext('2d')!;
  ctx.scale(S / TILE, S / TILE);
  const r = rng(style.length * 7919 + style.charCodeAt(0) * 131);
  // Draw a shape at (x, y) and again across each edge it overlaps, so the
  // tile repeats with no seams.
  const wrap = (x: number, y: number, reach: number, draw: (x: number, y: number) => void) => {
    for (const dx of [-TILE, 0, TILE])
      for (const dy of [-TILE, 0, TILE]) {
        const px = x + dx;
        const py = y + dy;
        if (px + reach < 0 || px - reach > TILE || py + reach < 0 || py - reach > TILE) continue;
        draw(px, py);
      }
  };
  const fill = (c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, TILE, TILE);
  };
  const wood = (base: string, dark: string, light: string, lines = 26, wave = 7) => {
    fill(base);
    // Long, gently wavering grain lines; each runs the full width with whole
    // waves so it meets itself at the seam.
    for (let i = 0; i < lines; i++) {
      const y0 = r() * TILE;
      const amp = 2 + r() * wave;
      const waves = 1 + Math.floor(r() * 3);
      const ph = r() * Math.PI * 2;
      ctx.strokeStyle = r() < 0.65 ? dark : light;
      ctx.lineWidth = 0.8 + r() * 1.8;
      ctx.globalAlpha = 0.25 + r() * 0.35;
      for (const dy of [-TILE, 0, TILE]) {
        ctx.beginPath();
        for (let x = 0; x <= TILE; x += 4) {
          const y = y0 + dy + Math.sin(ph + (x / TILE) * Math.PI * 2 * waves) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    // A few soft knots.
    for (let i = 0; i < 3; i++) {
      const x = r() * TILE;
      const y = r() * TILE;
      wrap(x, y, 20, (px, py) => {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = dark;
        ctx.lineWidth = 1.4;
        for (let k = 1; k <= 3; k++) {
          ctx.beginPath();
          ctx.ellipse(px, py, 5 * k, 2.4 * k, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    ctx.globalAlpha = 1;
  };
  switch (style) {
    case 'birch':
      wood('#f1d1a6', '#c99a63', '#fbe6c6');
      break;
    case 'walnut':
      // Rich red walnut with dense, flame-like grain.
      wood('#a8481c', '#6a240a', '#c4612a', 70, 11);
      break;
    case 'terrazzo': {
      fill('#f6f3ee');
      const chips = ['#f08a5d', '#6f9fd8', '#e9b44c', '#9aa0aa', '#f2a0a0', '#7cc0a4', '#c9c4bd'];
      for (let i = 0; i < 260; i++) {
        const x = r() * TILE;
        const y = r() * TILE;
        const s = 1.2 + r() * (r() < 0.15 ? 5 : 2.6);
        const col = chips[Math.floor(r() * chips.length)];
        const n = 4 + Math.floor(r() * 3);
        const rot = r() * Math.PI;
        wrap(x, y, s * 1.5, (px, py) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          for (let k = 0; k < n; k++) {
            const a = rot + (k / n) * Math.PI * 2;
            const rr = s * (0.6 + 0.4 * Math.sin(k * 2.3 + x));
            if (k === 0) ctx.moveTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
            else ctx.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
        });
      }
      break;
    }
    case 'grass': {
      fill('#86c83a');
      const greens = ['#9fdc4a', '#6cae2b', '#b4e85e', '#5f9e25'];
      for (let i = 0; i < 900; i++) {
        const x = r() * TILE;
        const y = r() * TILE;
        const len = 4 + r() * 7;
        const lean = (r() - 0.5) * 5;
        const col = greens[Math.floor(r() * greens.length)];
        wrap(x, y, 12, (px, py) => {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + lean * 0.4, py - len * 0.6, px + lean, py - len);
          ctx.stroke();
        });
      }
      break;
    }
    case 'stars': {
      // Flat night blue with soft wrapped nebula glows: seamless (a linear
      // gradient across the tile would show its edges as seams).
      fill('#1f43bd');
      for (let i = 0; i < 5; i++) {
        const x = r() * TILE;
        const y = r() * TILE;
        const rad = 40 + r() * 50;
        const light = r() < 0.5;
        wrap(x, y, rad, (px, py) => {
          const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
          g.addColorStop(0, light ? 'rgba(90, 130, 255, 0.22)' : 'rgba(10, 20, 110, 0.22)');
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
        });
      }
      for (let i = 0; i < 140; i++) {
        const x = r() * TILE;
        const y = r() * TILE;
        const s = r() < 0.08 ? 1.6 : 0.5 + r() * 0.8;
        const a = 0.35 + r() * 0.6;
        wrap(x, y, 4, (px, py) => {
          ctx.fillStyle = `rgba(220, 235, 255, ${a})`;
          ctx.beginPath();
          ctx.arc(px, py, s, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      break;
    }
    case 'spooky': {
      // A haunted night: violet sky, drifting glows, pale stars and a
      // scatter of bats, all wrapped so the tile repeats seamlessly.
      fill('#43217f');
      for (let i = 0; i < 6; i++) {
        const x = r() * TILE;
        const y = r() * TILE;
        const rad = 40 + r() * 55;
        const warm = r() < 0.35;
        wrap(x, y, rad, (px, py) => {
          const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
          g.addColorStop(0, warm ? 'rgba(255, 130, 40, 0.16)' : 'rgba(140, 90, 255, 0.2)');
          g.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
        });
      }
      for (let i = 0; i < 70; i++) {
        const x = r() * TILE;
        const y = r() * TILE;
        const s = r() < 0.1 ? 1.4 : 0.5 + r() * 0.6;
        const a = 0.3 + r() * 0.5;
        wrap(x, y, 3, (px, py) => {
          ctx.fillStyle = `rgba(235, 220, 255, ${a})`;
          ctx.beginPath();
          ctx.arc(px, py, s, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      // Faint little ghosts drifting in the dark.
      for (let i = 0; i < 2; i++) {
        const x = r() * TILE;
        const y = r() * TILE;
        const k = 0.8 + r() * 0.4;
        wrap(x, y, 20, (px, py) => {
          ctx.save();
          ctx.translate(px, py);
          ctx.scale(k, k);
          ctx.fillStyle = 'rgba(240, 230, 255, 0.2)';
          ctx.beginPath();
          ctx.moveTo(-9, 10);
          ctx.lineTo(-9, -2);
          ctx.arc(0, -2, 9, Math.PI, 0);
          ctx.lineTo(9, 10);
          for (let j = 0; j < 3; j++) ctx.quadraticCurveTo(6 - j * 6, 6, 3 - j * 6, 10);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(30, 10, 60, 0.45)';
          ctx.beginPath();
          ctx.ellipse(-3.2, -2.5, 1.6, 2.3, 0, 0, Math.PI * 2);
          ctx.ellipse(3.2, -2.5, 1.6, 2.3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      }
      // Small jack-o'-lanterns, their faces lit from inside.
      for (let i = 0; i < 3; i++) {
        const x = r() * TILE;
        const y = r() * TILE;
        const k = 0.7 + r() * 0.5;
        const tilt = (r() - 0.5) * 0.5;
        wrap(x, y, 24, (px, py) => {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(tilt);
          ctx.scale(k, k);
          const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
          halo.addColorStop(0, 'rgba(255, 140, 30, 0.35)');
          halo.addColorStop(1, 'rgba(255, 140, 30, 0)');
          ctx.fillStyle = halo;
          ctx.fillRect(-22, -22, 44, 44);
          ctx.fillStyle = '#5a7a1e';
          ctx.fillRect(-1.5, -14, 3, 6);
          for (const [dx, w, col] of [[-5, 6.5, '#d65e08'], [5, 6.5, '#d65e08'], [0, 7, '#ff8a1c']] as const) {
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.ellipse(dx, 0, w, 9, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#ffe066';
          ctx.beginPath();
          ctx.moveTo(-6, -1); ctx.lineTo(-3.5, -5); ctx.lineTo(-1.5, -1);
          ctx.moveTo(1.5, -1); ctx.lineTo(3.5, -5); ctx.lineTo(6, -1);
          ctx.moveTo(-6, 2.5); ctx.quadraticCurveTo(0, 8.5, 6, 2.5); ctx.quadraticCurveTo(0, 5, -6, 2.5);
          ctx.fill();
          ctx.restore();
        });
      }
      for (let i = 0; i < 7; i++) {
        const x = r() * TILE;
        const y = r() * TILE;
        const k = 0.6 + r() * 0.7;
        const tilt = (r() - 0.5) * 0.6;
        wrap(x, y, 24, (px, py) => {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(tilt);
          ctx.scale(k, k);
          ctx.fillStyle = 'rgba(20, 6, 40, 0.75)';
          ctx.beginPath();
          // Wings: a top edge rising to the tips, a scalloped trailing edge.
          ctx.moveTo(0, -2);
          ctx.quadraticCurveTo(-8, -9, -20, -6);
          ctx.quadraticCurveTo(-16, -2, -15, 3);
          ctx.quadraticCurveTo(-11, 0, -9, 4);
          ctx.quadraticCurveTo(-6, 1, -3, 5);
          ctx.lineTo(3, 5);
          ctx.quadraticCurveTo(6, 1, 9, 4);
          ctx.quadraticCurveTo(11, 0, 15, 3);
          ctx.quadraticCurveTo(16, -2, 20, -6);
          ctx.quadraticCurveTo(8, -9, 0, -2);
          ctx.fill();
          // Body and ears.
          ctx.beginPath();
          ctx.ellipse(0, 1, 3, 4.5, 0, 0, Math.PI * 2);
          ctx.moveTo(-2.5, -2);
          ctx.lineTo(-2, -6);
          ctx.lineTo(-0.5, -3);
          ctx.moveTo(2.5, -2);
          ctx.lineTo(2, -6);
          ctx.lineTo(0.5, -3);
          ctx.fill();
          ctx.restore();
        });
      }
      break;
    }
    case 'knit': {
      fill('#ffb51f');
      // Rows of little V stitches, lit on one side, as in a knitted rug.
      const w = 8;
      const h = 8;
      for (let y = 0; y < TILE; y += h)
        for (let x = 0; x < TILE; x += w) {
          ctx.fillStyle = 'rgba(214, 120, 0, 0.45)';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + w / 2, y + h * 0.8);
          ctx.lineTo(x + w / 2, y + h);
          ctx.lineTo(x, y + h * 0.2);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 228, 140, 0.55)';
          ctx.beginPath();
          ctx.moveTo(x + w, y);
          ctx.lineTo(x + w / 2, y + h * 0.8);
          ctx.lineTo(x + w / 2, y + h);
          ctx.lineTo(x + w, y + h * 0.2);
          ctx.closePath();
          ctx.fill();
        }
      break;
    }
  }
  cache.set(key, cv);
  return cv;
}

const textures = new Map<string, Texture>();
/** The material as a texture, shared and kept for the whole session. */
export function slabTexture(style: SlabStyle, res: number): Texture {
  const key = `${style}@${res}`;
  let t = textures.get(key);
  if (!t) {
    t = Texture.from(slabCanvas(style, res));
    t.source.addressMode = 'repeat';
    textures.set(key, t);
  }
  return t;
}
