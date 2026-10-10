import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { makeCanvas } from './shape.ts';

type Kind = 'drop' | 'ring' | 'spark' | 'glow' | 'blob' | 'shock';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
  color: number;
  rot: number;
  vr: number;
  /** Height above the floor for drops thrown in an arc. */
  z: number;
  vz: number;
  /** Confetti: flip angle (tumbling in 3D) and its speed; sway phase. */
  flip: number;
  vflip: number;
  sway: number;
  /** Delay before the particle appears (ms). */
  delay: number;
  /** Previous position, for firework trails. */
  px?: number;
  py?: number;
  sprite?: Sprite;
  /** Called when a drop lands (paint speckle). */
  land?: (x: number, y: number, r: number) => void;
}

// --------------------------------------------------------------- textures
// Small white textures, tinted per particle. Built once and shared.

let TEX: { glow: Texture; star: Texture } | null = null;

function textures() {
  if (TEX) return TEX;
  const S = 64;
  const glow = makeCanvas(S, S);
  {
    const ctx = glow.getContext('2d')!;
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  // Four-point twinkle: two thin glowing beams and a hot core.
  const star = makeCanvas(S, S);
  {
    const ctx = star.getContext('2d')!;
    for (const rot of [0, Math.PI / 2]) {
      ctx.save();
      ctx.translate(S / 2, S / 2);
      ctx.rotate(rot);
      ctx.scale(1, 0.13);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, S / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.22);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  TEX = { glow: Texture.from(glow), star: Texture.from(star) };
  return TEX;
}

/** Points of a rotated ellipse, for stretched paint droplets. */
function ellipsePts(cx: number, cy: number, rx: number, ry: number, ang: number): number[] {
  const out: number[] = [];
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push(cx + x * c - y * s, cy + x * s + y * c);
  }
  return out;
}

/**
 * Particle layer: paint drops and rings drawn with one Graphics per frame,
 * plus pooled sprites for additive glows and twinkles.
 */
export class Fx {
  private readonly g = new Graphics();
  private readonly sprites = new Container();
  private readonly glowLayer = new Container();
  private readonly pool: Sprite[] = [];
  private parts: Particle[] = [];

  constructor(parent: Container) {
    parent.addChild(this.g, this.sprites, this.glowLayer);
  }

  clear() {
    for (const p of this.parts) this.release(p);
    this.parts = [];
    this.g.clear();
  }

  private take(tex: Texture, additive: boolean): Sprite {
    const s = this.pool.pop() ?? new Sprite();
    s.texture = tex;
    s.anchor.set(0.5);
    s.blendMode = additive ? 'add' : 'normal';
    s.visible = true;
    s.alpha = 1;
    s.rotation = 0;
    (additive ? this.glowLayer : this.sprites).addChild(s);
    return s;
  }

  private release(p: Particle) {
    if (!p.sprite) return;
    // Pooled sprites stay in the tree (hidden), so they are destroyed with
    // the board that owns this layer.
    p.sprite.visible = false;
    this.pool.push(p.sprite);
    p.sprite = undefined;
  }

  private add(p: Partial<Particle> & Pick<Particle, 'kind' | 'x' | 'y' | 'r' | 'max' | 'color'>): Particle {
    const full: Particle = {
      vx: 0, vy: 0, life: 0, rot: 0, vr: 0, z: 0, vz: 0, flip: 0, vflip: 0, sway: 0, delay: 0, ...p,
    };
    this.parts.push(full);
    return full;
  }

  /** Paint droplets bursting from a point, mostly along (dx, dy). */
  splash(x: number, y: number, dx: number, dy: number, n: number, color: number, speed: number, size: number,
    land?: Particle['land']) {
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 2.4;
      const ang = Math.atan2(dy, dx) + spread;
      const v = speed * (0.35 + Math.random() * 0.75);
      this.add({
        kind: 'drop', x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
        r: size * (0.35 + Math.random() * 0.75), max: 2000,
        color, vz: speed * (0.25 + Math.random() * 0.35), land,
      });
    }
  }

  /**
   * Glossy paint droplets sprayed beside the ball's path: they pop in,
   * drift a little, hold, then shrink away.
   */
  blob(x: number, y: number, vx: number, vy: number, r: number, color: number, life = 600) {
    this.add({ kind: 'blob', x, y, vx, vy, r, max: life, color });
  }

  /** A tiny additive glint, for glitter in the ball's trail. */
  glint(x: number, y: number, size: number, color = 0xffffff) {
    const p = this.add({
      kind: 'spark', x, y, vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12, r: size,
      max: 260 + Math.random() * 260, color, rot: Math.random(), vr: (Math.random() - 0.5) * 3,
    });
    p.sprite = this.take(textures().star, true);
  }

  /** Impact: an expanding ring with a soft flash of light. */
  ring(x: number, y: number, r: number, color: number) {
    this.add({ kind: 'ring', x, y, r, max: 460, color });
    this.flash(x, y, r * 1.6, color, 0.5);
  }

  /**
   * A wall hit's shockwave: a bright ring racing out from the impact with
   * glitter riding its front, each speck twinkling as it goes.
   */
  glitterWave(x: number, y: number, r: number, color: number, power = 1) {
    const max = 520 + power * 160;
    this.add({ kind: 'shock', x, y, r: r * (0.75 + power * 0.35), max, color });
    // A second, smaller ring just behind the first.
    this.add({ kind: 'shock', x, y, r: r * (0.5 + power * 0.25), max: max * 0.8, color: 0xffffff, delay: 70 });
    const n = Math.round(16 + power * 12);
    const reach = r * (0.75 + power * 0.35) * 1.5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.35;
      // Speed for the speck to keep pace with the ring as drag slows it.
      const v = reach * 3 * (0.85 + Math.random() * 0.3);
      const p = this.add({
        kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: 4 + Math.random() * 6 * (0.6 + power * 0.4),
        max: max * (0.8 + Math.random() * 0.35), color: Math.random() < 0.55 ? 0xffffff : color,
        rot: Math.random() * 3, vr: (Math.random() - 0.5) * 6,
      });
      p.sprite = this.take(textures().star, true);
    }
    this.flash(x, y, r * 1.1, color, 0.45 * power + 0.15);
  }

  /** A soft additive bloom that swells and fades. */
  flash(x: number, y: number, r: number, color: number, strength = 0.7, delay = 0) {
    const p = this.add({ kind: 'glow', x, y, r, max: 380, color, delay, z: strength });
    p.sprite = this.take(textures().glow, true);
    p.sprite.visible = delay <= 0;
  }

  /** Twinkles bursting outward from a point. */
  sparkle(x: number, y: number, n: number, spread: number, color: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = spread * (0.4 + Math.random());
      const p = this.add({
        kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 7 + Math.random() * 9,
        max: 520 + Math.random() * 420, color, rot: Math.random(), vr: (Math.random() - 0.5) * 4,
      });
      p.sprite = this.take(textures().star, true);
    }
    this.flash(x, y, spread * 0.5, color, 0.6);
  }

  update(dtMs: number) {
    const dt = Math.min(dtMs, 40) / 1000;
    const g = this.g;
    g.clear();
    const alive: Particle[] = [];
    for (const p of this.parts) {
      if (p.delay > 0) {
        p.delay -= dtMs;
        alive.push(p);
        continue;
      }
      p.life += dtMs;
      const t = p.life / p.max;
      if (t >= 1) {
        this.release(p);
        continue;
      }
      alive.push(p);
      switch (p.kind) {
        case 'drop': {
          // Thrown in an arc: the drop rises, falls and lands as a speck.
          const drag = Math.exp(-dt * 2.5);
          p.vx *= drag;
          p.vy *= drag;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vz -= 900 * dt * (p.vz > 0 ? 1 : 1.4);
          p.z += p.vz * dt;
          if (p.z <= 0) {
            p.land?.(p.x, p.y, p.r * 0.75);
            p.life = p.max;
            break;
          }
          const lift = Math.min(1, p.z / 40);
          const rr = p.r * (1 + lift * 0.45);
          const yy = p.y - p.z * 0.55;
          g.circle(p.x + 2, p.y + 3, p.r * (1 + lift * 0.3)).fill({ color: 0x000000, alpha: 0.12 * (1 - lift) });
          g.circle(p.x, yy, rr).fill({ color: p.color, alpha: 1 });
          break;
        }
        case 'blob': {
          // Paint splatter: a fling that stretches along its motion, settles
          // round, then shrinks away.
          const drag = Math.exp(-dt * 7);
          p.vx *= drag;
          p.vy *= drag;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const grow = Math.min(1, t / 0.06);
          const shrink = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
          const rr = p.r * (0.5 + 0.5 * grow) * shrink;
          if (rr < 0.3) break;
          const sp = Math.hypot(p.vx, p.vy);
          const stretch = Math.min(1.8, 1 + sp / (p.r * 40));
          if (stretch > 1.05)
            g.poly(ellipsePts(p.x, p.y, rr * stretch, rr / Math.sqrt(stretch), Math.atan2(p.vy, p.vx))).fill({ color: p.color, alpha: 1 });
          else g.circle(p.x, p.y, rr).fill({ color: p.color, alpha: 1 });
          // Bigger drops catch a tiny wet highlight.
          if (rr > 2.2) g.circle(p.x - rr * 0.3, p.y - rr * 0.32, rr * 0.28).fill({ color: 0xffffff, alpha: 0.55 * shrink });
          break;
        }
        case 'shock': {
          // Fast at first, easing out; thin and bright, fading as it grows.
          const e = 1 - (1 - t) ** 3;
          const rr = p.r * (0.25 + e * 1.25);
          const fade = (1 - t) ** 1.4;
          g.circle(p.x, p.y, rr).stroke({ color: p.color, width: p.r * 0.22 * (1 - t * 0.6), alpha: 0.75 * fade });
          g.circle(p.x, p.y, rr).stroke({ color: 0xffffff, width: Math.max(1.5, p.r * 0.07), alpha: fade });
          break;
        }
        case 'ring': {
          const e = 1 - (1 - t) ** 3;
          g.circle(p.x, p.y, p.r * (0.5 + e * 1.3)).stroke({ color: p.color, width: p.r * 0.22 * (1 - t), alpha: 0.7 * (1 - t) });
          break;
        }
        case 'glow': {
          const s = p.sprite!;
          s.visible = true;
          s.tint = p.color;
          const e = 1 - (1 - t) ** 2;
          s.position.set(p.x, p.y);
          s.scale.set(((p.r * 2) / 64) * (0.6 + e * 0.6));
          s.alpha = p.z * (1 - t) ** 1.5;
          break;
        }
        case 'spark': {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= Math.exp(-dt * 3);
          p.vy *= Math.exp(-dt * 3);
          p.rot += p.vr * dt;
          const s = p.sprite!;
          // Pops in, twinkles, then fades.
          const grow = Math.min(1, t / 0.12);
          const twinkle = 0.8 + 0.2 * Math.sin(p.life * 0.04 + p.x);
          s.position.set(p.x, p.y);
          s.rotation = p.rot;
          s.tint = p.color;
          s.scale.set(((p.r * 2) / 64) * grow * twinkle * (1 - t * 0.5));
          s.alpha = 1 - t * t;
          break;
        }
      }
    }
    this.parts = alive;
  }
}
