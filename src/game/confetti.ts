import { Graphics } from 'pixi.js';

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  /** Phase of the paper's flip: its height scales by cos(flip). */
  flip: number;
  vf: number;
  w: number;
  h: number;
  col: number;
  age: number;
  life: number;
}

/**
 * Confetti for a finished level: bursts of paper pieces and ribbons that
 * fly up, tumble and flutter as they flip, and drift down through the air.
 * Screen space, drawn in one Graphics redrawn every frame.
 */
export class Confetti {
  readonly g = new Graphics();
  private bits: Bit[] = [];

  /** A burst from (x, y) toward `angle` (radians) within `spread`. */
  burst(x: number, y: number, angle: number, spread: number, n: number, speed: number, colors: number[]) {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.55 + Math.random() * 0.6);
      const ribbon = Math.random() < 0.18;
      this.bits.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        flip: Math.random() * Math.PI * 2,
        vf: 6 + Math.random() * 10,
        w: ribbon ? 3 + Math.random() * 1.5 : 6.5 + Math.random() * 5,
        h: ribbon ? 13 + Math.random() * 7 : 4.5 + Math.random() * 3,
        col: colors[Math.floor(Math.random() * colors.length)],
        age: 0,
        life: 2.2 + Math.random() * 1.2,
      });
    }
  }

  get active() {
    return this.bits.length > 0;
  }

  clear() {
    this.bits = [];
    this.g.clear();
  }

  update(dtMs: number, height: number) {
    const g = this.g;
    g.clear();
    if (!this.bits.length) return;
    const dt = Math.min(dtMs, 50) / 1000;
    for (const b of this.bits) {
      b.age += dt;
      // Heavy drag: the burst slows fast, then the pieces float down,
      // swaying as they flip.
      const drag = Math.exp(-dt * 1.9);
      b.vx *= drag;
      b.vy = b.vy * drag + 980 * dt;
      b.vy = Math.min(b.vy, 190 + Math.sin(b.flip) * 40);
      b.x += (b.vx + Math.sin(b.flip * 0.5) * 38) * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      b.flip += b.vf * dt;
      const fade = Math.min(1, (b.life - b.age) / 0.4);
      if (fade <= 0) continue;
      const c = Math.cos(b.rot);
      const s = Math.sin(b.rot);
      const hw = b.w / 2;
      const hh = (b.h / 2) * Math.max(0.08, Math.abs(Math.cos(b.flip)));
      const pts = [-hw, -hh, hw, -hh, hw, hh, -hw, hh];
      const out: number[] = [];
      for (let i = 0; i < 8; i += 2) out.push(b.x + pts[i] * c - pts[i + 1] * s, b.y + pts[i] * s + pts[i + 1] * c);
      // The back of each piece is a little darker as it flips over.
      const k = Math.cos(b.flip) < 0 ? 0.78 : 1;
      const col = k === 1 ? b.col : (Math.round(((b.col >> 16) & 255) * k) << 16) | (Math.round(((b.col >> 8) & 255) * k) << 8) | Math.round((b.col & 255) * k);
      g.poly(out).fill({ color: col, alpha: fade });
    }
    this.bits = this.bits.filter((b) => b.age < b.life && b.y < height + 40);
  }
}
