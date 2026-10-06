import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ballImage } from './assets.ts';
import type { BallSkin } from './cosmetics.ts';
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
    const targetStretch = moving ? Math.min(1.1, 0.4 + speed * 0.65) : 0;
    this.stretch += (targetStretch - this.stretch) * Math.min(1, dt * (moving ? 30 : 40));
    if (dir) this.heading = Math.atan2(dir.y, dir.x);

    const breathe = moving ? 0 : Math.sin(time * 0.003) * 0.02;
    const along = 1 + this.stretch + this.squash * 0.9 + breathe;
    const across = Math.max(0.62, 1 - this.stretch * 0.3) - this.squash * 0.55 + breathe;
    const base = (this.radius * 2) / Math.max(this.body.texture.width, this.body.texture.height);
    // Moves are axis-aligned, so stretch on x or y without rotating the art
    // (keeps the light on the upper left and textures upright).
    const horizontal = Math.abs(Math.cos(this.heading)) > 0.5;
    this.body.scale.set(base * (horizontal ? along : across), base * (horizontal ? across : along));
    this.trail.clear();
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
