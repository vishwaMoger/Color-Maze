import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ballImage } from './assets.ts';
import type { BallSkin } from './cosmetics.ts';
import { ballShine, type BallShine } from './shaders.ts';
import { makeCanvas } from './shape.ts';

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Lit sphere rendered per pixel: wrapped diffuse light from the upper left,
 * a tight specular highlight, a cool bounce light along the lower rim and
 * soft occlusion at the edge. Used for the ball and for shop previews.
 */
export function renderSphere(size: number, colors: [string, string, string], metal = false): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const hi = hexRgb(colors[0]);
  const base = hexRgb(colors[1]);
  const shade = hexRgb(colors[2]);
  const L = [-0.5, -0.62, 0.6];
  const ll = Math.hypot(L[0], L[1], L[2]);
  const [lx, ly, lz] = L.map((v) => v / ll);
  const hl = Math.hypot(lx, ly, lz + 1);
  const [hx, hy, hz] = [lx / hl, ly / hl, (lz + 1) / hl];
  const r = size / 2;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const nx = (px + 0.5 - r) / r;
      const ny = (py + 0.5 - r) / r;
      const d2 = nx * nx + ny * ny;
      const dist = Math.sqrt(d2);
      const edge = Math.min(1, Math.max(0, (1 - dist) * r));
      if (edge <= 0) continue;
      const nz = Math.sqrt(Math.max(0, 1 - d2));
      const diff = Math.max(0, nx * lx + ny * ly + nz * lz);
      const wrap = diff * 0.7 + 0.3;
      let col = mix(shade, base, smooth(0.1, 0.72, wrap));
      col = mix(col, hi, smooth(0.78, 1.0, wrap) * 0.85);
      const spec = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), metal ? 34 : 70) * (metal ? 1.1 : 0.85);
      const rim = Math.pow(1 - nz, 2.2) * Math.max(0, ny + 0.2) * 0.45;
      const ao = Math.pow(1 - nz, 4) * 0.22;
      const i = (py * size + px) * 4;
      img.data[i] = Math.min(255, col[0] * (1 - ao) + 255 * spec + 200 * rim);
      img.data[i + 1] = Math.min(255, col[1] * (1 - ao) + 255 * spec + 215 * rim);
      img.data[i + 2] = Math.min(255, col[2] * (1 - ao) + 255 * spec + 255 * rim);
      img.data[i + 3] = 255 * edge;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

function contactShadow(radius: number, res: number): Texture {
  const size = Math.ceil(radius * 2 * res);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(40,10,40,0.42)');
  g.addColorStop(0.55, 'rgba(40,10,40,0.22)');
  g.addColorStop(1, 'rgba(40,10,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}

/** The ball: squash and stretch, drop-in, breathing idle. */
export class Ball extends Container {
  private readonly body: Sprite;
  private readonly shadow: Sprite;
  private readonly trail = new Graphics();
  private readonly textures: Texture[] = [];
  private squash = 0;
  private squashV = 0;
  private stretch = 0;
  private heading = 0;
  private readonly shadowBase: number;
  readonly radius: number;
  /** Two halves flying apart after the ball is sliced by a saw. */
  private readonly shine: BallShine;
  private rollPhase = 0;
  private halves: { c: Container; vx: number; vy: number; vr: number }[] = [];
  private splitAge = 0;

  constructor(cell: number, res: number, skin: BallSkin, trailLayer: Container) {
    super();
    this.radius = cell * 0.44;
    const px = Math.ceil(this.radius * 2 * res);
    const image = skin.image ? ballImage(skin.image) : undefined;
    let bodyTex: Texture;
    if (image) bodyTex = Texture.from(image);
    else {
      bodyTex = Texture.from(renderSphere(px, skin.colors ?? ['#fff7b0', '#ffd23a', '#e98a10'], skin.metal));
      this.textures.push(bodyTex);
    }
    const shadowTex = contactShadow(this.radius * 1.15, res);
    this.textures.push(shadowTex);
    this.shadow = new Sprite(shadowTex);
    this.body = new Sprite(bodyTex);
    this.shadow.anchor.set(0.5);
    this.body.anchor.set(0.5);
    this.shadowBase = 1 / res;
    this.shadow.scale.set(this.shadowBase, this.shadowBase * 0.75);
    this.shadow.position.set(cell * 0.05, cell * 0.14);
    this.shine = ballShine(Math.max(1.5, this.radius * 0.16 * res));
    this.body.filters = [this.shine];
    this.addChild(this.shadow, this.body);
    trailLayer.addChild(this.trail);
  }

  /** Called on wall impact. */
  impact(speed: number) {
    this.squashV -= 5.5 * Math.min(1.3, speed);
  }

  update(dtMs: number, time: number, moving: boolean, dir: { x: number; y: number } | null, speed: number) {
    const dt = Math.min(dtMs, 40) / 1000;
    // Damped spring for the squash after impacts, in small stable steps.
    for (let left = dt; left > 0; left -= 0.008) {
      const h = Math.min(left, 0.008);
      this.squashV += (-420 * this.squash - 16 * this.squashV) * h;
      this.squash += this.squashV * h;
    }
    // A long capsule at speed, like a blob of paint flung across the board.
    const targetStretch = moving ? Math.min(1.6, 0.6 + speed * 0.9) : 0;
    this.stretch += (targetStretch - this.stretch) * Math.min(1, dt * (moving ? 30 : 40));
    if (dir) this.heading = Math.atan2(dir.y, dir.x);
    // Shine bands sweep across the ball in the direction it rolls.
    const u = this.shine.uniforms;
    u.uRoll += ((moving ? 1 : 0) - u.uRoll) * Math.min(1, dt * 10);
    this.rollPhase += dt * (moving ? 3 + speed * 6 : 0.4);
    u.uPhase = this.rollPhase % 1;
    u.uDir[0] = -Math.cos(this.heading);
    u.uDir[1] = -Math.sin(this.heading);

    if (this.halves.length) {
      this.splitAge += dt;
      const fade = Math.max(0, 1 - Math.max(0, this.splitAge - 0.35) / 0.5);
      for (const h of this.halves) {
        h.vx *= Math.exp(-dt * 3);
        h.vy *= Math.exp(-dt * 3);
        h.c.x += h.vx * dt;
        h.c.y += h.vy * dt;
        h.c.rotation += h.vr * dt;
        h.c.alpha = fade;
      }
    }
    const breathe = moving ? 0 : Math.sin(time * 0.003) * 0.02;
    const along = 1 + this.stretch + this.squash * 0.9 + breathe;
    const across = Math.max(0.56, 1 - this.stretch * 0.28) - this.squash * 0.6 + breathe;
    const base = (this.radius * 2) / Math.max(this.body.texture.width, this.body.texture.height);
    // Moves are axis-aligned, so stretch on x or y without rotating the art
    // (keeps the light on the upper left and textures upright).
    const horizontal = Math.abs(Math.cos(this.heading)) > 0.5;
    this.body.scale.set(base * (horizontal ? along : across), base * (horizontal ? across : along));
    this.trail.clear();
  }

  /**
   * Sliced in two along the travel direction: the halves spin apart and
   * fade. `dir` is the direction the ball was rolling.
   */
  split(dir: { x: number; y: number }) {
    this.unsplit();
    const ang = Math.atan2(dir.y, dir.x);
    const r = this.radius;
    for (const side of [-1, 1]) {
      const c = new Container();
      c.rotation = ang;
      const sp = new Sprite(this.body.texture);
      sp.anchor.set(0.5);
      sp.scale.copyFrom(this.body.scale);
      sp.rotation = -ang;
      const m = new Graphics().rect(-r * 1.6, side < 0 ? -r * 1.6 : 0, r * 3.2, r * 1.6).fill(0xffffff);
      sp.mask = m;
      c.addChild(m, sp);
      // Fresh cut face: a pale sliver along the cut.
      c.addChild(new Graphics().rect(-r * 0.95, side < 0 ? -r * 0.06 : 0, r * 1.9, r * 0.06).fill({ color: 0xffffff, alpha: 0.7 }));
      const px = -Math.sin(ang) * side;
      const py = Math.cos(ang) * side;
      this.halves.push({ c, vx: px * r * 5 - dir.x * r * 1.5, vy: py * r * 5 - dir.y * r * 1.5, vr: side * 5 });
      this.addChild(c);
    }
    this.body.visible = false;
    this.shadow.visible = false;
    this.splitAge = 0;
  }

  unsplit() {
    for (const h of this.halves) h.c.destroy({ children: true });
    this.halves = [];
    this.body.visible = true;
    this.shadow.visible = true;
  }

  /** Drop-in at level start: falls from above with a squashy landing. */
  dropIn(progress: number) {
    const p = Math.min(1, progress);
    const fall = p < 0.7 ? 1 - (p / 0.7) ** 2 : 0;
    this.body.y = -fall * this.radius * 6;
    this.alpha = Math.min(1, p * 3);
    this.shadow.scale.set(this.shadowBase * (1 - fall * 0.5), this.shadowBase * 0.75 * (1 - fall * 0.5));
  }

  override destroy() {
    if (!this.trail.destroyed) this.trail.destroy();
    super.destroy({ children: true });
    for (const t of this.textures) t.destroy(true);
  }
}
