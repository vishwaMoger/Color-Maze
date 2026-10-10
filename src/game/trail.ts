// Ball trails: unlockable effects that stream behind the ball as it rolls.
// Each style mixes a few particle kinds (glows, twinkles, hearts, flakes,
// confetti) and, for some, a smooth tapering ribbon drawn every frame.
// They are made in board space, above the paint and below the ball.
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { makeCanvas } from './shape.ts';

export type TrailStyle =
  | 'none'
  | 'sparkle'
  | 'bubbles'
  | 'hearts'
  | 'rainbow'
  | 'fire'
  | 'snow'
  | 'stars'
  | 'comet'
  | 'galaxy'
  | 'confetti'
  | 'neon';

export interface TrailSkin {
  id: string;
  name: string;
  unlock: number;
  style: TrailStyle;
}

/** Spread along the long unlock road, between the balls, paints and mazes. */
export const TRAILS: TrailSkin[] = [
  { id: 'classic', name: 'Classic', unlock: 1, style: 'none' },
  { id: 'twinkle', name: 'Twinkle', unlock: 12, style: 'sparkle' },
  { id: 'bubbles', name: 'Bubbles', unlock: 32, style: 'bubbles' },
  { id: 'hearts', name: 'Hearts', unlock: 60, style: 'hearts' },
  { id: 'rainbow', name: 'Rainbow', unlock: 98, style: 'rainbow' },
  { id: 'blaze', name: 'Blaze', unlock: 140, style: 'fire' },
  { id: 'snowfall', name: 'Snowfall', unlock: 200, style: 'snow' },
  { id: 'starlight', name: 'Starlight', unlock: 245, style: 'stars' },
  { id: 'comet', name: 'Comet', unlock: 300, style: 'comet' },
  { id: 'nebula', name: 'Nebula', unlock: 390, style: 'galaxy' },
  { id: 'party', name: 'Party', unlock: 460, style: 'confetti' },
  { id: 'neonglow', name: 'Neon', unlock: 560, style: 'neon' },
];

// ---------------------------------------------------------------- textures

type TexKind = 'glow' | 'twinkle' | 'star' | 'heart' | 'bubble' | 'flake' | 'rect';
let TEX: Record<TexKind, Texture> | null = null;

function shapes(): Record<TexKind, Texture> {
  if (TEX) return TEX;
  const S = 64;
  const draw = (paint: (ctx: CanvasRenderingContext2D) => void) => {
    const cv = makeCanvas(S, S);
    paint(cv.getContext('2d')!);
    return Texture.from(cv);
  };
  const glow = draw((ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
  const twinkle = draw((ctx) => {
    for (const rot of [0, Math.PI / 2]) {
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate(rot);
      ctx.scale(1, 0.14);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 12);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
  const star = draw((ctx) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 11 : 27;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fill();
  });
  const heart = draw((ctx) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(32, 54);
    ctx.bezierCurveTo(6, 36, 6, 12, 22, 12);
    ctx.bezierCurveTo(28, 12, 32, 17, 32, 21);
    ctx.bezierCurveTo(32, 17, 36, 12, 42, 12);
    ctx.bezierCurveTo(58, 12, 58, 36, 32, 54);
    ctx.fill();
  });
  const bubble = draw((ctx) => {
    const g = ctx.createRadialGradient(32, 32, 18, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 32, 29, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(23, 21, 7, 4.5, -0.7, 0, Math.PI * 2);
    ctx.fill();
  });
  const flake = draw((ctx) => {
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.translate(32, 32);
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -26);
      ctx.moveTo(0, -16);
      ctx.lineTo(-7, -22);
      ctx.moveTo(0, -16);
      ctx.lineTo(7, -22);
      ctx.stroke();
    }
  });
  const rect = draw((ctx) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(18, 26, 28, 12, 3);
    ctx.fill();
  });
  TEX = { glow, twinkle, star, heart, bubble, flake, rect };
  return TEX;
}

// ---------------------------------------------------------------- colours

const hsv = (h: number, s: number, v: number) => {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return (Math.round(f(5) * 255) << 16) | (Math.round(f(3) * 255) << 8) | Math.round(f(1) * 255);
};
const mixColor = (a: number, b: number, t: number) => {
  const c = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return (c(16) << 16) | (c(8) << 8) | c(0);
};
/** A colour ramp sampled by t in [0, 1]. */
const ramp = (stops: number[], t: number) => {
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return mixColor(stops[i], stops[i + 1], x - i);
};
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

// ---------------------------------------------------------------- trail

interface Part {
  s: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Acceleration down the screen (negative rises). */
  g: number;
  drag: number;
  life: number;
  max: number;
  size: number;
  /** Scale over life: grow in, then shrink to end (1 keeps size). */
  end: number;
  rot: number;
  vr: number;
  color: number;
  /** Colour over life instead of a fixed tint. */
  colors?: number[];
  alpha: number;
  wobble: number;
  /** Confetti flips (scale.y swings), bubbles pop at the end. */
  flip?: number;
  pop?: boolean;
  phase: number;
}

const RIBBON_MS: Partial<Record<TrailStyle, number>> = { rainbow: 420, comet: 360, neon: 380 };

export class Trail {
  readonly view = new Container();
  private readonly ribbon = new Graphics();
  private readonly glowRibbon = new Graphics();
  private readonly layer = new Container();
  private readonly addLayer = new Container();
  private parts: Part[] = [];
  private readonly pool: Sprite[] = [];
  private pts: { x: number; y: number; t: number }[] = [];
  private lastX = NaN;
  private lastY = NaN;
  private carry = 0;
  private time = 0;

  constructor(
    readonly style: TrailStyle,
    private readonly cell: number,
  ) {
    this.glowRibbon.blendMode = 'add';
    this.addLayer.blendMode = 'add';
    this.view.addChild(this.glowRibbon, this.ribbon, this.layer, this.addLayer);
  }

  private spawn(tex: TexKind, additive: boolean, p: Omit<Part, 's' | 'life' | 'phase'>) {
    const s = this.pool.pop() ?? new Sprite();
    s.texture = shapes()[tex];
    s.anchor.set(0.5);
    s.visible = true;
    (additive ? this.addLayer : this.layer).addChild(s);
    this.parts.push({ ...p, s, life: 0, phase: Math.random() * 6.28 });
  }

  /** Emit for a stretch of the path from (x0, y0) to (x1, y1). */
  private emit(x: number, y: number, dx: number, dy: number) {
    const c = this.cell;
    const r = () => (Math.random() - 0.5) * c * 0.5;
    const back = Math.hypot(dx, dy) > 0 ? { x: -dx / Math.hypot(dx, dy), y: -dy / Math.hypot(dx, dy) } : { x: 0, y: 0 };
    const base = { drag: 2, g: 0, end: 0, rot: 0, vr: 0, alpha: 1, wobble: 0 };
    switch (this.style) {
      case 'sparkle':
        for (let i = 0; i < 3; i++)
          this.spawn('twinkle', true, {
            ...base, x: x + r(), y: y + r(), vx: back.x * c * 0.4 + r(), vy: back.y * c * 0.4 + r(),
            max: 480 + Math.random() * 380, size: c * (0.35 + Math.random() * 0.4), color: pick([0xffffff, 0xfff1a8, 0xffd96a, 0xd8f4ff]),
            rot: Math.random(), vr: (Math.random() - 0.5) * 5,
          });
        if (Math.random() < 0.6)
          this.spawn('glow', true, { ...base, x: x + r() * 0.5, y: y + r() * 0.5, vx: 0, vy: 0, max: 380, size: c * 0.5, color: 0xffe9a0, alpha: 0.5 });
        break;
      case 'bubbles':
        for (let i = 0; i < 2; i++)
          this.spawn('bubble', false, {
            ...base, x: x + r(), y: y + r(), vx: r() * 0.6, vy: -c * (0.5 + Math.random() * 0.5), drag: 0.6,
            max: 700 + Math.random() * 500, size: c * (0.26 + Math.random() * 0.34), end: 1, color: pick([0x7fd4ff, 0x9fe6ff, 0xa9b8ff, 0xc6a6ff, 0x8ff0e0]),
            alpha: 1, wobble: c * 0.08, pop: true,
          });
        if (Math.random() < 0.6)
          this.spawn('glow', true, { ...base, x: x + r() * 0.5, y: y + r() * 0.5, vx: 0, vy: -c * 0.3, max: 500, size: c * 0.55, color: 0x7fd4ff, alpha: 0.4 });
        break;
      case 'hearts':
        this.spawn('heart', false, {
          ...base, x: x + r(), y: y + r(), vx: r() * 0.8, vy: -c * (0.35 + Math.random() * 0.4), drag: 0.8,
          max: 800 + Math.random() * 400, size: c * (0.22 + Math.random() * 0.22), end: 0.6, color: pick([0xff4f8b, 0xff7aa8, 0xff3b6b, 0xffa3c4, 0xe84393]),
          rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 1.5, wobble: c * 0.05,
        });
        if (Math.random() < 0.4)
          this.spawn('glow', true, { ...base, x, y, vx: 0, vy: 0, max: 420, size: c * 0.55, color: 0xff6fa5, alpha: 0.35 });
        break;
      case 'rainbow':
        if (Math.random() < 0.5)
          this.spawn('twinkle', true, {
            ...base, x: x + r(), y: y + r(), vx: r(), vy: r(), max: 500, size: c * 0.35,
            color: hsv((this.time * 0.0006 + Math.random() * 0.2) % 1, 0.35, 1), vr: 3,
          });
        break;
      case 'fire':
        for (let i = 0; i < 2; i++)
          this.spawn('glow', true, {
            ...base, x: x + r() * 0.7, y: y + r() * 0.7, vx: back.x * c * 0.6 + r() * 0.5, vy: back.y * c * 0.6 - c * 0.7, drag: 1.5,
            max: 380 + Math.random() * 260, size: c * (0.6 + Math.random() * 0.45), end: 0.15, color: 0xffffff,
            colors: [0xfff7c0, 0xffc14a, 0xff6a1a, 0xd8260b, 0x3a0a05], alpha: 0.9,
          });
        if (Math.random() < 0.5)
          this.spawn('glow', true, {
            ...base, x: x + r(), y: y + r(), vx: r() * 2, vy: -c * (0.9 + Math.random()), drag: 0.8,
            max: 600 + Math.random() * 400, size: c * 0.12, end: 0.3, color: 0xffb347, wobble: c * 0.05,
          });
        break;
      case 'snow':
        for (let i = 0; i < 2; i++)
          this.spawn('flake', false, {
            ...base, x: x + r(), y: y + r(), vx: r() * 0.8, vy: c * (0.12 + Math.random() * 0.2), drag: 0.4,
            max: 900 + Math.random() * 500, size: c * (0.24 + Math.random() * 0.24), end: 0.5, color: pick([0xffffff, 0xd8efff, 0xb8e0ff]),
            rot: Math.random() * 3, vr: (Math.random() - 0.5) * 2, wobble: c * 0.06,
          });
        this.spawn('glow', true, { ...base, x: x + r() * 0.6, y: y + r() * 0.6, vx: 0, vy: 0, max: 600, size: c * 0.6, color: 0x7cc8ff, alpha: 0.55 });
        break;
      case 'stars':
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          this.spawn('star', false, {
            ...base, x: x + r() * 0.5, y: y + r() * 0.5, vx: Math.cos(a) * c * 0.9, vy: Math.sin(a) * c * 0.9 - c * 0.3, drag: 3, g: c * 1.2,
            max: 600 + Math.random() * 300, size: c * (0.18 + Math.random() * 0.16), end: 0.2,
            color: pick([0xffd84a, 0xff7eb6, 0x7ed6ff, 0xa58bff, 0x7cf0a1, 0xffa45a]), rot: Math.random() * 3, vr: (Math.random() - 0.5) * 8,
          });
        }
        break;
      case 'comet':
        if (Math.random() < 0.8)
          this.spawn('glow', true, {
            ...base, x: x + r() * 0.6, y: y + r() * 0.6, vx: r(), vy: r(), max: 520, size: c * 0.18, end: 0.2,
            color: pick([0xbff6ff, 0xffffff, 0x7fdcff]),
          });
        break;
      case 'galaxy':
        this.spawn('glow', true, {
          ...base, x: x + r(), y: y + r(), vx: r() * 0.5, vy: r() * 0.5, drag: 1,
          max: 800 + Math.random() * 500, size: c * (0.8 + Math.random() * 0.6), end: 1.3,
          color: pick([0x8a4dff, 0x4d6bff, 0xd14dff, 0x3fb6ff]), alpha: 0.42,
        });
        if (Math.random() < 0.8)
          this.spawn('twinkle', true, {
            ...base, x: x + r() * 1.4, y: y + r() * 1.4, vx: 0, vy: 0, max: 700 + Math.random() * 400, size: c * (0.18 + Math.random() * 0.2),
            color: 0xffffff, vr: 2,
          });
        break;
      case 'confetti':
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          this.spawn('rect', false, {
            ...base, x: x + r() * 0.5, y: y + r() * 0.5, vx: Math.cos(a) * c * 0.7, vy: Math.sin(a) * c * 0.7 - c * 0.6, drag: 2.2, g: c * 1.6,
            max: 800 + Math.random() * 400, size: c * (0.3 + Math.random() * 0.14), end: 1,
            color: pick([0xff4f6d, 0xffc93c, 0x3fc5ff, 0x7be36b, 0xb27bff, 0xff8a3c]), rot: Math.random() * 3, vr: (Math.random() - 0.5) * 10, flip: 8 + Math.random() * 8,
          });
        }
        break;
      case 'neon':
        if (Math.random() < 0.5)
          this.spawn('twinkle', true, {
            ...base, x: x + r(), y: y + r(), vx: r() * 1.5, vy: r() * 1.5, max: 420, size: c * 0.3, color: pick([0x3ff7ff, 0xff4fd8]), vr: 4,
          });
        break;
    }
  }

  /** Each frame: follow the ball's centre (board px) while it rolls. */
  update(dtMs: number, x: number, y: number, moving: boolean, cut = false) {
    this.time += dtMs;
    const dt = Math.min(dtMs, 40) / 1000;
    // A jump (through a portal, onto a new board) is not travel: nothing is
    // laid along it, and the ribbon starts afresh rather than bridging it.
    // Faster than any slide (even on a slow frame) counts as a jump too.
    const far = Math.max(this.cell * 2.5, this.cell * 0.25 * dtMs);
    const jump = cut || (!Number.isNaN(this.lastX) && Math.hypot(x - this.lastX, y - this.lastY) > far);
    if (jump) {
      this.pts = [];
      this.carry = 0;
    }
    if (this.style !== 'none' && moving && !jump && !Number.isNaN(this.lastX)) {
      const dx = x - this.lastX;
      const dy = y - this.lastY;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        // Emit evenly along the path, however fast the ball goes.
        const step = this.cell * 0.2;
        this.carry += d;
        while (this.carry >= step && this.parts.length < 260) {
          this.carry -= step;
          const k = 1 - this.carry / d;
          this.emit(this.lastX + dx * k, this.lastY + dy * k, dx, dy);
        }
      }
    }
    this.lastX = x;
    this.lastY = y;
    const ribbonMs = RIBBON_MS[this.style];
    if (ribbonMs) {
      if (moving) this.pts.push({ x, y, t: this.time });
      while (this.pts.length && this.time - this.pts[0].t > ribbonMs) this.pts.shift();
      this.drawRibbon(ribbonMs);
    }
    const alive: Part[] = [];
    for (const p of this.parts) {
      p.life += dtMs;
      const t = p.life / p.max;
      if (t >= 1) {
        p.s.visible = false;
        p.s.removeFromParent();
        this.pool.push(p.s);
        continue;
      }
      alive.push(p);
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const s = p.s;
      const sway = p.wobble ? Math.sin(p.life * 0.008 + p.phase) * p.wobble : 0;
      s.position.set(p.x + sway, p.y);
      s.rotation = p.rot;
      // Pop in quickly, then ease toward the end size.
      const grow = Math.min(1, t / 0.12);
      let k = grow * (1 + (p.end - 1) * t);
      let a = p.alpha * (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
      if (p.pop && t > 0.85) {
        k *= 1 + (t - 0.85) * 3;
        a *= 1 - (t - 0.85) / 0.15;
      }
      const scale = (p.size / 64) * k;
      s.scale.set(scale, p.flip ? scale * Math.cos(p.life * 0.001 * p.flip) : scale);
      s.alpha = Math.max(0, a);
      s.tint = p.colors ? ramp(p.colors, t) : p.color;
    }
    this.parts = alive;
  }

  /** A tapering ribbon along the last stretch of the path. */
  private drawRibbon(ms: number) {
    const g = this.ribbon;
    const glow = this.glowRibbon;
    g.clear();
    glow.clear();
    const pts = this.pts;
    if (pts.length < 2) return;
    const w = this.cell * 0.62;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const age = (this.time - b.t) / ms;
      const k = Math.max(0, 1 - age);
      const width = w * Math.pow(k, 0.7);
      if (width < 0.5) continue;
      if (this.style === 'rainbow') {
        const hue = (i / 18 + this.time * 0.0005) % 1;
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color: hsv(hue, 0.62, 1), alpha: 0.85 * k, cap: 'round' });
        glow.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width * 1.8, color: hsv(hue, 0.5, 1), alpha: 0.25 * k, cap: 'round' });
      } else if (this.style === 'comet') {
        glow.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width * 1.9, color: 0x3fc8ff, alpha: 0.4 * k, cap: 'round' });
        glow.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width * 0.55, color: 0xffffff, alpha: 0.9 * k, cap: 'round' });
      } else if (this.style === 'neon') {
        const col = mixColor(0xff3fd2, 0x3ff2ff, (Math.sin(this.time * 0.004 + i * 0.25) + 1) / 2);
        glow.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width * 1.7, color: col, alpha: 0.45 * k, cap: 'round' });
        glow.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width * 0.4, color: 0xffffff, alpha: 0.95 * k, cap: 'round' });
      }
    }
  }

  destroy() {
    this.view.destroy({ children: true });
    for (const s of this.pool) s.destroy();
  }
}

// ---------------------------------------------------------------- preview

const previews = new Map<string, string>();

/**
 * The shop picture: a ball flying up a curving path, its trail streaming
 * behind it, drawn with plain 2D canvas (no GPU read-back, so it is cheap).
 */
export function trailPreview(t: TrailSkin, ballColor = '#ffe05a'): string {
  const hit = previews.get(t.id + ballColor);
  if (hit) return hit;
  const S = 160;
  const cv = makeCanvas(S, S);
  const ctx = cv.getContext('2d')!;
  // The path: a gentle S from lower left to upper right.
  const P = (u: number) => {
    const x = 14 + u * 108;
    const y = 138 - u * 100 + Math.sin(u * Math.PI * 1.6) * 16;
    return { x, y };
  };
  const head = P(1);
  let seed = t.id.length * 97 + t.id.charCodeAt(0);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const glowDot = (x: number, y: number, r: number, col: string, a = 1) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  };
  const twinkle = (x: number, y: number, r: number, col: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = r * 1.2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * 0.22 : r;
      const a = (i * Math.PI) / 4;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  const ribbon = (color: (u: number) => string, width: number, alpha = 1, blur = 0) => {
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      const u0 = 0.15 + (i / 40) * 0.85;
      const u1 = 0.15 + ((i + 1) / 40) * 0.85;
      const a = P(u0);
      const b = P(u1);
      ctx.strokeStyle = color(u0);
      ctx.globalAlpha = alpha * Math.min(1, (u0 - 0.15) * 2.2);
      ctx.lineWidth = width * (0.25 + 0.75 * u0);
      if (blur) {
        ctx.shadowColor = color(u0);
        ctx.shadowBlur = blur;
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  };
  const along = (n: number, f: (x: number, y: number, u: number) => void) => {
    for (let i = 0; i < n; i++) {
      const u = 0.12 + rnd() * 0.8;
      const p = P(u);
      f(p.x + (rnd() - 0.5) * 34 * u, p.y + (rnd() - 0.5) * 34 * u, u);
    }
  };
  switch (t.style) {
    case 'none':
      ribbon(() => 'rgba(255,255,255,0.9)', 14, 0.35);
      break;
    case 'sparkle':
      along(12, (x, y, u) => glowDot(x, y, 16 * u + 6, 'rgba(255,233,160,0.9)', 0.65));
      along(16, (x, y, u) => twinkle(x, y, 7 + u * 10, rnd() < 0.5 ? '#ffffff' : '#ffe27a'));
      break;
    case 'bubbles':
      along(12, (x, y, u) => {
        const r = 6 + u * 12;
        const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
        g.addColorStop(0, 'rgba(140,215,255,0.2)');
        g.addColorStop(1, 'rgba(200,240,255,1)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y - u * 8, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.ellipse(x - r * 0.35, y - u * 8 - r * 0.4, r * 0.25, r * 0.15, -0.7, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    case 'hearts':
      along(11, (x, y, u) => {
        const r = 7 + u * 10;
        ctx.save();
        ctx.translate(x, y - u * 6);
        ctx.rotate((rnd() - 0.5) * 0.6);
        ctx.fillStyle = ['#ff4f8b', '#ff7aa8', '#ff3b6b', '#ffa3c4'][Math.floor(rnd() * 4)];
        ctx.shadowColor = 'rgba(255,80,140,0.6)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(0, r * 0.9);
        ctx.bezierCurveTo(-r * 1.3, 0, -r * 0.6, -r * 1.1, 0, -r * 0.35);
        ctx.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.3, 0, 0, r * 0.9);
        ctx.fill();
        ctx.restore();
      });
      break;
    case 'rainbow':
      ribbon((u) => `hsl(${(u * 300 + 280) % 360} 95% 62%)`, 38, 0.4, 10);
      ribbon((u) => `hsl(${(u * 300 + 280) % 360} 92% 60%)`, 24, 0.95);
      along(5, (x, y) => twinkle(x, y, 6, '#ffffff'));
      break;
    case 'fire':
      along(22, (x, y, u) => glowDot(x, y - (1 - u) * 10, 9 + u * 20, ['rgba(255,90,20,0.9)', 'rgba(255,170,40,0.9)', 'rgba(255,240,170,0.95)'][Math.floor(u * 2.99)], 0.85));
      along(8, (x, y) => glowDot(x, y - 10, 3, 'rgba(255,200,90,1)'));
      break;
    case 'snow':
      along(13, (x, y, u) => {
        const r = 6 + u * 9;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rnd() * 3);
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = 'rgba(180,225,255,0.9)';
        ctx.shadowBlur = 5;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          ctx.rotate(Math.PI / 3);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -r);
          ctx.stroke();
        }
        ctx.restore();
      });
      break;
    case 'stars':
      along(13, (x, y, u) => {
        const r = 6 + u * 10;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rnd() * 3);
        ctx.fillStyle = ['#ffd84a', '#ff7eb6', '#7ed6ff', '#a58bff', '#7cf0a1'][Math.floor(rnd() * 5)];
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? r * 0.45 : r;
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
      break;
    case 'comet':
      ribbon(() => 'rgba(63,200,255,1)', 42, 0.4, 14);
      ribbon(() => 'rgba(255,255,255,1)', 15, 0.95, 8);
      along(8, (x, y) => glowDot(x, y, 5, 'rgba(190,245,255,1)'));
      break;
    case 'galaxy':
      along(10, (x, y, u) => glowDot(x, y, 18 + u * 20, ['rgba(138,77,255,0.8)', 'rgba(77,107,255,0.8)', 'rgba(209,77,255,0.7)'][Math.floor(rnd() * 3)], 0.7));
      along(12, (x, y) => twinkle(x, y, 3 + rnd() * 4, '#ffffff'));
      break;
    case 'confetti':
      along(20, (x, y) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rnd() * 3);
        ctx.fillStyle = ['#ff4f6d', '#ffc93c', '#3fc5ff', '#7be36b', '#b27bff'][Math.floor(rnd() * 5)];
        ctx.fillRect(-7, -3.5, 14, 7);
        ctx.restore();
      });
      break;
    case 'neon':
      ribbon((u) => `hsl(${300 - u * 120} 100% 60%)`, 34, 0.5, 14);
      ribbon(() => '#ffffff', 9, 1, 8);
      break;
  }
  // The ball at the head of the trail.
  const R = 22;
  ctx.fillStyle = 'rgba(20,0,60,0.25)';
  ctx.beginPath();
  ctx.ellipse(head.x + 2, head.y + R * 0.95, R * 0.8, R * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(head.x - R * 0.35, head.y - R * 0.4, R * 0.1, head.x, head.y, R);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, ballColor);
  g.addColorStop(1, mixHex(ballColor, '#7a4300', 0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(head.x, head.y, R, 0, Math.PI * 2);
  ctx.fill();
  const url = cv.toDataURL('image/png');
  previews.set(t.id + ballColor, url);
  return url;
}

function mixHex(a: string, b: string, t: number): string {
  const n = (h: string) => parseInt(h.slice(1), 16);
  const c = mixColor(n(a), n(b), t);
  return `#${c.toString(16).padStart(6, '0')}`;
}
