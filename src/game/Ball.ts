import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { makeCanvas } from './shape.ts';
import type { Theme } from './themes.ts';

function sphereTexture(radius: number, res: number, colors: [string, string, string]): Texture {
  const size = Math.ceil(radius * 2 * res);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  const g = ctx.createRadialGradient(r * 0.72, r * 0.62, r * 0.05, r, r, r);
  g.addColorStop(0, colors[0]);
  g.addColorStop(0.42, colors[1]);
  g.addColorStop(1, colors[2]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r - 0.5, 0, Math.PI * 2);
  ctx.fill();
  // Soft rim light at the bottom edge for a glossy, rounded read.
  const rim = ctx.createRadialGradient(r, r * 1.05, r * 0.7, r, r, r);
  rim.addColorStop(0, 'rgba(255,255,255,0)');
  rim.addColorStop(0.85, 'rgba(255,255,255,0)');
  rim.addColorStop(1, 'rgba(255,255,255,0.35)');
  ctx.fillStyle = rim;
  ctx.fill();
  return Texture.from(c);
}

function softDot(radius: number, res: number, color: string, alpha: number): Texture {
  const size = Math.ceil(radius * 2 * res);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, color.replace('A', String(alpha)));
  g.addColorStop(1, color.replace('A', '0'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}

/** The glossy ball: squash and stretch, comet trail, breathing idle. */
export class Ball extends Container {
  private readonly body: Sprite;
  private readonly shine: Sprite;
  private readonly shadow: Sprite;
  private readonly trail = new Graphics();
  private readonly textures: Texture[] = [];
  private tail = 0;
  private readonly shadowBase: number;
  private squash = 0;
  private squashV = 0;
  private stretch = 0;
  private heading = 0;
  readonly radius: number;

  constructor(
    cell: number,
    res: number,
    private readonly theme: Theme,
    trailLayer: Container,
  ) {
    super();
    this.radius = cell * 0.4;
    const bodyTex = sphereTexture(this.radius, res, theme.ball);
    const shineTex = softDot(this.radius * 0.38, res, 'rgba(255,255,255,A)', 0.95);
    const shadowTex = softDot(this.radius * 1.25, res, 'rgba(20,0,40,A)', 0.42);
    this.textures.push(bodyTex, shineTex, shadowTex);
    this.shadow = new Sprite(shadowTex);
    this.body = new Sprite(bodyTex);
    this.shine = new Sprite(shineTex);
    for (const s of [this.shadow, this.body, this.shine]) {
      s.anchor.set(0.5);
      s.scale.set(1 / res);
    }
    this.shadow.position.set(cell * 0.06, cell * 0.16);
    this.shadowBase = 1 / res;
    this.shadow.scale.set(this.shadowBase, this.shadowBase * 0.8);
    this.shine.position.set(-this.radius * 0.33, -this.radius * 0.38);
    this.addChild(this.shadow, this.body, this.shine);
    trailLayer.addChild(this.trail);
  }

  /** Called on wall impact; `dir` is the travel direction. */
  impact(speed: number) {
    this.squashV -= 9 * Math.min(1.4, speed);
  }

  update(dtMs: number, time: number, moving: boolean, dir: { x: number; y: number } | null, speed: number) {
    const dt = Math.min(dtMs, 40) / 1000;
    // Damped spring for the squash after impacts, in small stable steps.
    for (let left = dt; left > 0; left -= 0.008) {
      const h = Math.min(left, 0.008);
      this.squashV += (-420 * this.squash - 16 * this.squashV) * h;
      this.squash += this.squashV * h;
    }
    const targetStretch = moving ? Math.min(0.42, 0.12 + speed * 0.22) : 0;
    this.stretch += (targetStretch - this.stretch) * Math.min(1, dt * 22);
    if (dir) this.heading = Math.atan2(dir.y, dir.x);

    const breathe = moving ? 0 : Math.sin(time * 0.003) * 0.025;
    const along = 1 + this.stretch + this.squash * 0.9 + breathe;
    const across = 1 - this.stretch * 0.38 - this.squash * 0.55 + breathe;
    this.body.rotation = this.heading;
    const base = this.body.texture.width ? (this.radius * 2) / this.body.texture.width : 1;
    this.body.scale.set(base * along, base * across);
    // The highlight stays on the upper left, drifting slightly when idle.
    const drift = moving ? 0 : Math.sin(time * 0.0011) * this.radius * 0.06;
    this.shine.position.set(-this.radius * 0.33 + drift, -this.radius * 0.38 - drift * 0.5);
    this.shine.alpha = 0.85 - this.stretch * 0.6;

    // Comet tail: stacked tapered shapes behind the ball, longer when fast.
    const g = this.trail;
    g.clear();
    if (moving) this.tail = Math.min(this.tail + dt * 9, 1);
    else this.tail = Math.max(this.tail - dt * 7, 0);
    if (this.tail > 0.01 && dir) {
      const len = this.radius * (2.2 + speed * 4.5) * this.tail;
      const px = -dir.y;
      const py = dir.x;
      for (let i = 0; i < 4; i++) {
        const l = len * (1 - i * 0.2);
        const wdt = this.radius * (0.95 - i * 0.16);
        const tx = this.x - dir.x * l;
        const ty = this.y - dir.y * l;
        g.poly([
          this.x + px * wdt, this.y + py * wdt,
          this.x + dir.x * wdt * 0.2 + px * wdt * 0.6, this.y + dir.y * wdt * 0.2 + py * wdt * 0.6,
          this.x - px * wdt, this.y - py * wdt,
          tx - px * wdt * 0.12, ty - py * wdt * 0.12,
          tx + px * wdt * 0.12, ty + py * wdt * 0.12,
        ]).fill({ color: this.theme.paintLight, alpha: 0.16 * this.tail });
      }
    }
  }

  /** Drop-in at level start: falls from above with a squashy landing. */
  dropIn(progress: number) {
    const p = Math.min(1, progress);
    const fall = p < 0.7 ? 1 - (p / 0.7) ** 2 : 0;
    this.body.y = -fall * this.radius * 6;
    this.shine.alpha = 0.85;
    this.alpha = Math.min(1, p * 3);
    this.shadow.scale.set(this.shadowBase * (1 - fall * 0.5), this.shadowBase * 0.8 * (1 - fall * 0.5));
    this.shine.y = -this.radius * 0.38 - fall * this.radius * 6;
  }

  override destroy() {
    if (!this.trail.destroyed) this.trail.destroy();
    super.destroy({ children: true });
    for (const t of this.textures) t.destroy(true);
  }
}
