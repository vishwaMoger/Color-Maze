import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { iconImage } from './assets.ts';
import { makeCanvas } from './shape.ts';

type Kind = 'drop' | 'ring' | 'confetti' | 'spark' | 'glow' | 'blob' | 'fw' | 'gstar' | 'orb';

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

let TEX: { glow: Texture; star: Texture; rect: Texture; disc: Texture; ribbon: Texture } | null = null;
let GOLD: Texture | null = null;
function goldStar(): Texture {
  if (!GOLD) {
    const img = iconImage('star');
    GOLD = img ? Texture.from(img) : textures().star;
  }
  return GOLD;
}

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
  // Confetti pieces with a soft sheen so the flip reads as a lit surface.
  const piece = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    draw(ctx);
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return Texture.from(c);
  };
  const rect = piece(32, 20, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(1, 1, 30, 18, 3);
    ctx.fill();
  });
  const disc = piece(24, 24, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(12, 12, 11, 0, Math.PI * 2);
    ctx.fill();
  });
  const ribbon = piece(44, 14, (ctx) => {
    // A short curled streamer.
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(4, 7);
    ctx.bezierCurveTo(14, -2, 18, 16, 28, 7);
    ctx.bezierCurveTo(33, 2, 37, 4, 40, 7);
    ctx.stroke();
  });
  TEX = { glow: Texture.from(glow), star: Texture.from(star), rect, disc, ribbon };
  return TEX;
}

const shade = (c: number, k: number) =>
  (Math.min(255, ((c >> 16) & 255) * k) << 16) | (Math.min(255, ((c >> 8) & 255) * k) << 8) | Math.min(255, (c & 255) * k);

/**
 * Particle layer: paint drops and rings drawn with one Graphics per frame,
 * plus pooled sprites for additive glows, twinkles and tumbling confetti.
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

  /** A soft additive bloom that swells and fades. */
  flash(x: number, y: number, r: number, color: number, strength = 0.7, delay = 0) {
    const p = this.add({ kind: 'glow', x, y, r, max: 380, color, delay, z: strength });
    p.sprite = this.take(textures().glow, true);
    p.sprite.visible = delay <= 0;
  }

  /** A twinkle that floats upward, used for the completion wave. */
  rise(x: number, y: number, color: number, size: number) {
    const p = this.add({
      kind: 'spark', x, y, vx: (Math.random() - 0.5) * 10, vy: -34 - Math.random() * 30, r: size * 2.6,
      max: 750 + Math.random() * 350, color, rot: Math.random() * 0.6, vr: (Math.random() - 0.5) * 2,
    });
    p.sprite = this.take(textures().star, true);
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

  /**
   * Celebration: firework bursts of glowing sparks with fading trails,
   * glossy gold stars fountaining up from both bottom corners, and paint
   * bubbles drifting up and popping. No paper confetti.
   */
  confetti(width: number, height: number, n: number, colors: number[]) {
    const t = textures();
    const scale = Math.max(0.8, Math.min(1.7, Math.min(width, height) / 600));
    // Fireworks.
    const bursts = 4;
    for (let b = 0; b < bursts; b++) {
      const cx = width * (0.22 + Math.random() * 0.56);
      const cy = height * (0.18 + Math.random() * 0.34);
      const delay = b * 230 + Math.random() * 80;
      // Festive colours that read on any paint and any board.
      const color = [0xffd84a, 0x5be7ff, 0xc39bff, 0xff7ab8][b % 4];
      const count = 30;
      const f = this.add({ kind: 'glow', x: cx, y: cy, r: 90 * scale, max: 420, color: 0xffffff, delay, z: 0.9 });
      f.sprite = this.take(t.glow, true);
      f.sprite.visible = false;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
        const v = (260 + Math.random() * 220) * scale;
        const p = this.add({
          kind: 'fw', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: (10 + Math.random() * 8) * scale,
          max: 1000 + Math.random() * 500, color: i % 3 === 0 ? 0xffffff : color, delay, rot: Math.random() * 6, vr: 4,
        });
        p.sprite = this.take(t.star, true);
        p.sprite.visible = false;
      }
    }
    // Gold stars from the bottom corners.
    const stars = Math.round(n * 0.3);
    for (let i = 0; i < stars; i++) {
      const left = i % 2 === 0;
      const ang = -Math.PI / 2 + (left ? 1 : -1) * (0.15 + Math.random() * 0.45);
      const v = height * (1.6 + Math.random() * 1.1);
      const p = this.add({
        kind: 'gstar', x: width * (left ? 0.06 : 0.94), y: height + 20, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
        r: (11 + Math.random() * 12) * scale, max: 2200 + Math.random() * 900, color: 0xffffff,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, delay: Math.random() * 200,
      });
      p.sprite = this.take(goldStar(), false);
      p.sprite.visible = false;
    }
    // Paint bubbles drifting up.
    for (let i = 0; i < Math.round(n * 0.14); i++)
      this.add({
        kind: 'orb', x: width * (0.1 + Math.random() * 0.8), y: height * (0.75 + Math.random() * 0.3),
        vx: 0, vy: -(50 + Math.random() * 70) * scale, r: (8 + Math.random() * 14) * scale,
        max: 1800 + Math.random() * 1200, color: colors[i % colors.length], sway: Math.random() * 6,
        delay: 200 + Math.random() * 900,
      });
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
          g.circle(p.x - rr * 0.32, yy - rr * 0.32, rr * 0.34).fill({ color: 0xffffff, alpha: 0.55 });
          break;
        }
        case 'fw': {
          const s = p.sprite!;
          s.visible = true;
          p.px = p.x;
          p.py = p.y;
          const drag = Math.exp(-dt * 2.6);
          p.vx *= drag;
          p.vy = p.vy * drag + 230 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          const tw = 0.75 + 0.25 * Math.sin(p.life * 0.05 + p.rot);
          s.position.set(p.x, p.y);
          s.rotation += dt * p.vr;
          s.tint = p.color;
          s.scale.set(((p.r * 2) / 64) * tw * (1 - t * 0.4));
          s.alpha = fade;
          // Short glowing trail behind each spark.
          g.moveTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05).lineTo(p.x, p.y).stroke({ color: p.color, width: p.r * 0.32, alpha: 0.55 * fade, cap: 'round' });
          break;
        }
        case 'gstar': {
          const s = p.sprite!;
          s.visible = true;
          const drag = Math.exp(-dt * (p.vy < 0 ? 2.0 : 2.8));
          p.vx *= drag;
          p.vy = p.vy * drag + 700 * dt;
          p.x += (p.vx + Math.sin(p.life * 0.004 + p.rot) * 30) * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          s.position.set(p.x, p.y);
          s.rotation = p.rot;
          const sc = (p.r * 2) / Math.max(1, s.texture.width);
          s.scale.set(sc * (0.6 + 0.4 * Math.abs(Math.cos(p.life * 0.006 + p.rot))), sc);
          s.alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
          break;
        }
        case 'orb': {
          p.y += p.vy * dt;
          p.x += Math.sin(p.life * 0.003 + p.sway) * 18 * dt;
          const grow = Math.min(1, t / 0.15);
          const pop = t > 0.9 ? (t - 0.9) / 0.1 : 0;
          const rr = p.r * grow * (1 + pop * 0.6);
          const a = 1 - pop;
          g.circle(p.x, p.y, rr).fill({ color: p.color, alpha: 0.22 * a }).stroke({ color: 0xffffff, width: Math.max(1, rr * 0.12), alpha: 0.7 * a });
          g.circle(p.x - rr * 0.35, p.y - rr * 0.38, rr * 0.22).fill({ color: 0xffffff, alpha: 0.85 * a });
          g.circle(p.x + rr * 0.3, p.y + rr * 0.32, rr * 0.1).fill({ color: 0xffffff, alpha: 0.5 * a });
          break;
        }
        case 'blob': {
          const drag = Math.exp(-dt * 7);
          p.vx *= drag;
          p.vy *= drag;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const grow = Math.min(1, t / 0.08);
          const shrink = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
          const rr = p.r * (0.4 + 0.6 * grow) * shrink;
          if (rr < 0.3) break;
          g.circle(p.x + rr * 0.12, p.y + rr * 0.22, rr).fill({ color: 0x000000, alpha: 0.12 * shrink });
          g.circle(p.x, p.y, rr).fill({ color: p.color, alpha: 1 });
          g.circle(p.x - rr * 0.32, p.y - rr * 0.34, rr * 0.36).fill({ color: 0xffffff, alpha: 0.5 });
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
        case 'confetti': {
          const s = p.sprite!;
          s.visible = true;
          // Heavy drag: a fast pop, then a slow flutter with sideways sway.
          const drag = Math.exp(-dt * (p.vy < 0 ? 2.2 : 3.2));
          p.vx *= drag;
          p.vy = p.vy * drag + 620 * dt;
          p.x += (p.vx + Math.sin(p.life * 0.004 + p.sway) * 42) * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          p.flip += p.vflip * dt;
          const c = Math.cos(p.flip);
          const fade = t > 0.82 ? (1 - t) / 0.18 : 1;
          s.position.set(p.x, p.y);
          s.rotation = p.rot;
          const tw = s.texture.width;
          s.scale.set((p.r * 2) / tw, ((p.r * 2) / tw) * Math.max(0.08, Math.abs(c)));
          // Lit side vs. back side as it tumbles.
          s.tint = shade(p.color, c > 0 ? 0.75 + 0.35 * c : 0.62 + 0.2 * -c);
          s.alpha = fade;
          break;
        }
      }
    }
    this.parts = alive;
  }
}
