import { Container, Graphics } from 'pixi.js';

type Kind = 'drop' | 'ring' | 'confetti' | 'spark';

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
  /** Called when a drop lands (paint speckle). */
  land?: (x: number, y: number, r: number) => void;
}

/** Lightweight particle layer drawn with one Graphics per frame. */
export class Fx {
  private readonly g = new Graphics();
  private parts: Particle[] = [];

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  clear() {
    this.parts = [];
    this.g.clear();
  }

  /** Paint droplets bursting from a point, mostly along (dx, dy). */
  splash(x: number, y: number, dx: number, dy: number, n: number, color: number, speed: number, size: number,
    land?: Particle['land']) {
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 2.4;
      const ang = Math.atan2(dy, dx) + spread;
      const v = speed * (0.35 + Math.random() * 0.75);
      this.parts.push({
        kind: 'drop', x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
        r: size * (0.35 + Math.random() * 0.75), life: 0, max: 2000,
        color, rot: 0, vr: 0, z: 0, vz: speed * (0.25 + Math.random() * 0.35), land,
      });
    }
  }

  ring(x: number, y: number, r: number, color: number) {
    this.parts.push({ kind: 'ring', x, y, vx: 0, vy: 0, r, life: 0, max: 420, color, rot: 0, vr: 0, z: 0, vz: 0 });
  }

  /** A soft glint that floats upward, used for the completion wave. */
  rise(x: number, y: number, color: number, size: number) {
    this.parts.push({
      kind: 'spark', x, y, vx: (Math.random() - 0.5) * 10, vy: -30 - Math.random() * 30, r: size,
      life: 0, max: 700 + Math.random() * 300, color, rot: 0, vr: 0, z: 0, vz: 0,
    });
  }

  sparkle(x: number, y: number, n: number, spread: number, color: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = spread * (0.4 + Math.random());
      this.parts.push({
        kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 + Math.random() * 3,
        life: 0, max: 500 + Math.random() * 400, color, rot: 0, vr: 0, z: 0, vz: 0,
      });
    }
  }

  confetti(width: number, height: number, n: number, colors: number[]) {
    for (let i = 0; i < n; i++) {
      this.parts.push({
        kind: 'confetti', x: width * (0.1 + Math.random() * 0.8), y: -20 - Math.random() * height * 0.3,
        vx: (Math.random() - 0.5) * 160, vy: 120 + Math.random() * 220, r: 5 + Math.random() * 5,
        life: 0, max: 2200 + Math.random() * 900, color: colors[i % colors.length],
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, z: 0, vz: 0,
      });
    }
  }

  update(dtMs: number) {
    const dt = Math.min(dtMs, 40) / 1000;
    const g = this.g;
    g.clear();
    const alive: Particle[] = [];
    for (const p of this.parts) {
      p.life += dtMs;
      const t = p.life / p.max;
      if (t >= 1) continue;
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
          g.circle(p.x + 2, p.y + 3, p.r * (1 + lift * 0.3)).fill({ color: 0x000000, alpha: 0.12 * (1 - lift) });
          g.circle(p.x, p.y - p.z * 0.55, p.r * (1 + lift * 0.45)).fill({ color: p.color, alpha: 1 });
          break;
        }
        case 'ring':
          g.circle(p.x, p.y, p.r * (0.6 + t * 1.4)).stroke({ color: p.color, width: p.r * 0.18 * (1 - t), alpha: 0.6 * (1 - t) });
          break;
        case 'spark': {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= Math.exp(-dt * 3);
          p.vy *= Math.exp(-dt * 3);
          const s = p.r * (1 - t);
          g.poly([p.x, p.y - s * 2, p.x + s * 0.5, p.y, p.x, p.y + s * 2, p.x - s * 0.5, p.y]).fill({ color: p.color, alpha: 1 - t });
          g.poly([p.x - s * 2, p.y, p.x, p.y + s * 0.5, p.x + s * 2, p.y, p.x, p.y - s * 0.5]).fill({ color: p.color, alpha: 1 - t });
          break;
        }
        case 'confetti': {
          p.vy += 260 * dt;
          p.vx *= Math.exp(-dt * 0.8);
          p.vy = Math.min(p.vy, 320);
          p.x += (p.vx + Math.sin(p.life * 0.005 + p.rot) * 40) * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          const w = p.r * Math.abs(Math.cos(p.rot));
          const fade = t > 0.8 ? (1 - t) / 0.2 : 1;
          g.rect(p.x - w, p.y - p.r * 0.5, w * 2 + 0.5, p.r).fill({ color: p.color, alpha: fade });
          break;
        }
      }
    }
    this.parts = alive;
  }
}
