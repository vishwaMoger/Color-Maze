import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import type { BallSkin } from './cosmetics.ts';
import { Orientation, SHAPE_MODES, sphereFilter, type SphereFilter } from './sphere.ts';

/** A soft dark oval (drawn round, squashed by the sprite's size). */
function contactShadow(size: number): Texture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(30, 0, 40, 0.55)');
  g.addColorStop(0.5, 'rgba(30, 0, 40, 0.3)');
  g.addColorStop(1, 'rgba(40, 0, 50, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}

/**
 * A still of a skin rendered by the same 3D shader, for the shop, unlock
 * cards and league avatars. Turned so its pattern shows off well.
 */
/** A still of the ball as a canvas (see ballPreview). */
export function ballCanvas(renderer: Renderer, skin: BallSkin, size = 160): HTMLCanvasElement {
  const s = new Sprite(Texture.WHITE);
  s.width = size;
  s.height = size;
  const f = sphereFilter(skin.mode, skin.colors);
  const o = new Orientation();
  o.rotate(1, 0, 0, skin.mode === 'eight' ? -0.25 : -0.6);
  o.rotate(0, 1, 0, skin.mode === 'eight' ? 0.3 : 0.55);
  o.write(f.uniforms.uRot);
  f.uniforms.uAA = 1.2 / (size / 2);
  s.filters = [f];
  const holder = new Container();
  holder.addChild(s);
  const canvas = renderer.extract.canvas({ target: holder, resolution: 1, antialias: true }) as HTMLCanvasElement;
  holder.destroy({ children: true });
  f.destroy();
  return canvas;
}

export function ballPreview(renderer: Renderer, skin: BallSkin, size = 160): string {
  return ballCanvas(renderer, skin, size).toDataURL('image/png');
}

/** The ball: squash and stretch, drop-in, breathing idle. */
/** The cut halves are drawn a little smaller than the ball, so two fit in a corridor. */
const HALF = 0.88;

export class Ball extends Container {
  private readonly body: Sprite;
  private readonly textures: Texture[] = [];
  /** Soft contact shadow on the floor just below the ball. */
  private readonly shadow: Sprite;
  /** Ray-traced sphere shading; its orientation turns as the ball rolls. */
  private readonly sphere: SphereFilter;
  private readonly orient = new Orientation();
  private lastX = 0;
  private lastY = 0;
  /** Where the ball body rests, a little up-tile (see the constructor). */
  readonly restY: number;
  private squash = 0;
  /** Height above the floor while dropping in at level start. */
  private dropY = 0;
  private squashV = 0;
  private stretch = 0;
  /** Distance rolled since the ball last set off or changed direction. */
  private run = 0;
  /** Offset of the stretched body, so its front stays at the ball's front. */
  private offX = 0;
  private offY = 0;
  private heading = 0;
  readonly radius: number;
  /** A shaped piece (star, puck...) rather than a ball: it spins flat. */
  private readonly shaped: boolean;
  /**
   * The two halves after the ball is sliced by a saw: real little bodies
   * that pop apart, hop, fall back onto the floor, bounce off walls and
   * slide to rest. x, y on the floor; z the height above it.
   */
  private halves: { c: Container; shadow: Graphics; side: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; vr: number }[] = [];
  /** Whether a point (board px) is floor, so the halves stay on it. */
  private floorAt: ((x: number, y: number) => boolean) | null = null;
  /** The still picture the halves were cut from (freed with them). */
  private still: Texture | null = null;

  constructor(cell: number, private readonly res: number, skin: BallSkin) {
    super();
    // Most of its tile, leaving an even ring of the paint it sits in.
    this.radius = cell * 0.45;
    // A plain quad: the filter draws the whole sphere into it.
    this.body = new Sprite(Texture.WHITE);
    this.body.anchor.set(0.5);
    // Seen from slightly in front, a ball resting on the floor appears a
    // little up-tile (as in the original), so the near lip clips its foot.
    this.body.y = -cell * 0.08;
    this.restY = this.body.y;
    this.sphere = sphereFilter(skin.mode, skin.colors);
    this.shaped = SHAPE_MODES.has(skin.mode);
    // Start turned a little so the pattern reads as a ball, not a decal.
    this.orient.rotate(1, 0, 0, -0.45);
    this.orient.rotate(0, 1, 0, 0.35);
    this.orient.write(this.sphere.uniforms.uRot);
    this.body.filters = [this.sphere];
    // As measured on the original: a dark, soft shadow from the ball's foot
    // a quarter of a tile down the floor.
    const shTex = contactShadow(Math.ceil(this.radius * 2 * res));
    this.textures.push(shTex);
    this.shadow = new Sprite(shTex);
    this.shadow.anchor.set(0.5);
    this.shadow.width = this.radius * 1.8;
    this.shadow.height = this.radius * 0.95;
    this.shadow.position.set(0, this.restY + this.radius * 1.02);
    this.addChild(this.shadow, this.body);
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
    // As in the original: at speed the ball draws out into a long thin
    // ellipse (up to about 2.7 tiles) whose front stays at the ball's front;
    // when it stops against a wall the back draws in after it, settling
    // round in about a fifth of a second with no bounce.
    // A new direction starts a fresh run: drop any leftover stretch at once,
    // or its tail would swing round and poke into the wall just left.
    if (dir) {
      const h = Math.atan2(dir.y, dir.x);
      if (Math.abs(Math.atan2(Math.sin(h - this.heading), Math.cos(h - this.heading))) > 0.3) {
        this.stretch = 0;
        this.offX = 0;
        this.offY = 0;
        this.run = 0;
      }
      this.heading = h;
    }
    if (moving) {
      const step = Math.hypot(this.x - this.lastX, this.y - this.lastY);
      if (step < this.radius * 4) this.run += step;
      const target = Math.min(1.5, speed * 1.4);
      this.stretch += (target - this.stretch) * (1 - Math.exp(-dt * 14));
    } else {
      this.stretch *= Math.exp(-dt * 16.5);
      this.run = 0;
    }
    // The tail never reaches back past where this run began, so it always
    // lies on the floor just rolled over, never through a wall.
    if (moving) this.stretch = Math.min(this.stretch, this.run / (2 * this.radius));
    // Roll for real: turn the sphere by the distance travelled over the
    // radius, about the axis lying flat on the board across the motion.
    const mx = this.x - this.lastX;
    const my = this.y - this.lastY;
    this.lastX = this.x;
    this.lastY = this.y;
    const travelled = Math.hypot(mx, my);
    if (travelled > 0.01 && travelled < this.radius * 6) {
      if (this.shaped) {
        // A shaped piece slides and spins flat, turning the way it goes.
        this.orient.rotate(0, 0, 1, ((mx - my) / travelled) * (travelled / this.radius) * 0.7);
      } else {
        // Screen y points down; the sphere's y points up.
        this.orient.rotate(my / travelled, mx / travelled, 0, travelled / this.radius);
      }
      this.orient.write(this.sphere.uniforms.uRot);
    } else if (!moving && !this.halves.length) {
      // At rest it idles with a slow lazy spin so it always feels alive.
      this.orient.rotate(0, 0, 1, dt * 0.25);
      this.orient.write(this.sphere.uniforms.uRot);
    }

    // Keep the sphere's edge about a pixel soft at any zoom.
    const radiusPx = this.radius * Math.abs(this.worldTransform.a) * this.res;
    this.sphere.uniforms.uAA = 1.2 / Math.max(4, radiusPx);

    const r = this.radius;
    for (const h of this.halves) {
      // Gravity, then a damped bounce when a half lands.
      h.vz -= r * 46 * dt;
      h.z += h.vz * dt;
      if (h.z <= 0) {
        h.z = 0;
        h.vz = h.vz < -r * 3 ? -h.vz * 0.32 : 0;
        // Sliding on the floor: friction slows it and stops it turning.
        const f = Math.exp(-dt * 6);
        h.vx *= f;
        h.vy *= f;
        h.vr *= Math.exp(-dt * 8);
      }
      let nx = h.x + h.vx * dt;
      let ny = h.y + h.vy * dt;
      let rot = h.c.rotation + h.vr * dt;
      // Walls: a piece never moves further off the floor (under a wall's
      // rim); it bounces back off instead. Cut over the blade, it can only
      // come away from it.
      const off = this.halfOff(h.side, h.x, h.y, h.c.rotation);
      if (this.halfOff(h.side, nx, h.y, h.c.rotation) > off) {
        h.vx = -h.vx * 0.35;
        nx = h.x;
      }
      if (this.halfOff(h.side, nx, ny, h.c.rotation) > off) {
        h.vy = -h.vy * 0.35;
        ny = h.y;
      }
      if (this.halfOff(h.side, nx, ny, rot) > off) {
        h.vr = -h.vr * 0.3;
        rot = h.c.rotation;
      }
      h.x = nx;
      h.y = ny;
      h.c.rotation = rot;
      h.c.position.set(h.x, h.y - h.z);
      // The shadow lies under the piece's middle, not under the cut.
      const mid = r * HALF * 0.42 * h.side;
      h.shadow.position.set(h.x - Math.sin(rot) * mid, h.y + Math.cos(rot) * mid + r * 0.3);
      h.shadow.scale.set(Math.max(0.45, 1 - h.z / (r * 3)));
    }
    const breathe = moving || this.stretch > 0.02 ? 0 : Math.sin(time * 0.003) * 0.02;
    const drawn = 1 + this.stretch;
    // Thins as it lengthens (measured: 2.65 long is about half as thick).
    const along = drawn + this.squash * 0.9 + breathe;
    const across = Math.max(0.46, drawn ** -0.7) - this.squash * 0.6 + breathe;
    // Shaped pieces are drawn inside the ball's circle; a bigger quad shows
    // them as large as a ball.
    const base = ((this.shaped ? 2.44 : 2) * this.radius) / Math.max(this.body.texture.width, this.body.texture.height);
    // Moves are axis-aligned, so stretch on x or y without rotating the art
    // (keeps the light on the upper left and textures upright).
    const horizontal = Math.abs(Math.cos(this.heading)) > 0.5;
    this.body.scale.set(base * (horizontal ? along : across), base * (horizontal ? across : along));
    const hx = Math.round(Math.cos(this.heading));
    const hy = Math.round(Math.sin(this.heading));
    const k = Math.min(1, dt * 60);
    this.offX += (-hx * this.stretch * this.radius - this.offX) * k;
    this.offY += (-hy * this.stretch * this.radius - this.offY) * k;
    this.body.x = this.offX;
    this.body.y = this.restY + this.offY - this.dropY;
    this.shadow.x = this.offX;
    // The shadow follows the drawn body: as long, and as thin, as it is.
    this.shadow.y = this.restY + this.offY + this.radius * 1.02 * (horizontal ? across : along);
    this.shadow.width = this.radius * 1.8 * (horizontal ? along : across);
    this.shadow.height = this.radius * 0.95 * (horizontal ? across : 1);
  }

  /** How many points of a half at (x, y), turned by `rot`, lie off the floor. */
  private halfOff(side: number, x: number, y: number, rot: number): number {
    if (!this.floorAt) return 0;
    let n = 0;
    const rr = this.radius * HALF * 0.96;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let k = 0; k <= 8; k++) {
      const t = (k / 8) * Math.PI;
      const u = Math.cos(t) * rr;
      const v = Math.sin(t) * rr * side;
      if (!this.floorAt(this.x + x + u * c - v * s, this.y + (y + u * s + v * c) * this.scale.y)) n++;
    }
    return n;
  }

  /** Keep the shadow on the floor: clip it to the floor's shape. */
  clipShadow(mask: Sprite | null) {
    this.shadow.mask = mask;
  }

  /** Centre of the drawn (stretched) body, relative to the ball. */
  get bodyOffset(): { x: number; y: number } {
    return { x: this.offX, y: this.restY + this.offY };
  }

  /**
   * Sliced in two along the travel direction: the halves pop apart, hop up
   * and drop onto the floor nearby, settling where they land. `dir` is the
   * direction the ball was rolling; `floorAt` keeps them on the floor.
   */
  split(dir: { x: number; y: number }, floorAt?: (x: number, y: number) => boolean, still?: Texture) {
    this.unsplit();
    this.still = still ?? null;
    this.floorAt = floorAt ?? null;
    this.stretch = 0;
    const ang = Math.atan2(dir.y, dir.x);
    const r = this.radius;
    for (const side of [-1, 1]) {
      const c = new Container();
      c.y = this.restY;
      c.rotation = ang;
      // Cut from a still picture of the round ball: the live sphere shader
      // does not draw right inside a masked, turned piece.
      const tex = still ?? this.body.texture;
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.scale.set((r * 2 * HALF) / Math.max(tex.width, tex.height));
      sp.rotation = -ang;
      if (!still) sp.filters = [this.sphere];
      // Mask a holder rather than the filtered sprite itself.
      const holder = new Container();
      holder.addChild(sp);
      const m = new Graphics().rect(-r * 1.6, side < 0 ? -r * 1.6 : 0, r * 3.2, r * 1.6).fill(0xffffff);
      holder.mask = m;
      c.addChild(m, holder);
      // Fresh cut face: a pale sliver along the cut.
      c.addChild(new Graphics().rect(-r * 0.95 * HALF, side < 0 ? -r * 0.06 : 0, r * 1.9 * HALF, r * 0.06).fill({ color: 0xffffff, alpha: 0.7 }));
      const px = -Math.sin(ang) * side;
      const py = Math.cos(ang) * side;
      const shadow = new Graphics().ellipse(0, 0, r * 0.5, r * 0.2).fill({ color: 0x1e0a32, alpha: 0.24 });
      this.halves.push({
        c,
        shadow,
        side,
        x: px * r * 0.04,
        y: this.restY + py * r * 0.04,
        z: 0,
        // Apart, and knocked back a little off the blade.
        vx: px * r * 2.6 - dir.x * r * 2.4,
        vy: py * r * 2.6 - dir.y * r * 2.4,
        vz: r * 6.5,
        vr: side * 2.2,
      });
      this.addChild(shadow, c);
    }
    this.body.visible = false;
    this.shadow.visible = false;
  }

  unsplit() {
    for (const h of this.halves) {
      h.c.destroy({ children: true });
      h.shadow.destroy();
    }
    this.still?.destroy(true);
    this.still = null;
    this.halves = [];
    this.body.visible = true;
    this.shadow.visible = true;
  }

  /** Drop-in at level start: falls from above with a squashy landing. */
  dropIn(progress: number) {
    const p = Math.min(1, progress);
    const fall = p < 0.7 ? 1 - (p / 0.7) ** 2 : 0;
    this.dropY = fall * this.radius * 6;
    this.body.y = this.restY + this.offY - this.dropY;
    // The shadow grows in as the ball comes down onto the floor.
    this.shadow.alpha = 1 - fall;
    this.alpha = Math.min(1, p * 3);
  }

  override destroy() {
    this.shadow.mask = null;
    super.destroy({ children: true });
    for (const t of this.textures) t.destroy(true);
  }
}
