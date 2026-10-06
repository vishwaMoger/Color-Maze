import { BlurFilter, Container, Filter, GlProgram, Graphics, Sprite, Texture, UniformGroup } from 'pixi.js';
import { STOPPER, type Level, type Point } from '../levels/core.ts';
import { dilate, fillRoundedCells, makeCanvas, softBlur, tint } from './shape.ts';
import type { Theme } from './themes.ts';

const FILTER_VERT = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}`;

// Animated water light, adapted from the classic tileable caustic pattern.
const CAUSTIC_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uTime;
uniform float uScale;
uniform float uStrength;
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
void main(void) {
  vec4 color = texture(uTexture, vTextureCoord);
  vec2 px = vTextureCoord * uInputSize.xy;
  float v = clamp(caustic(px / uScale, uTime), 0.0, 1.0);
  color.rgb += vec3(0.8, 1.0, 1.0) * v * uStrength * color.a * color.a;
  finalColor = color;
}`;

function causticFilter(): Filter & { uniforms: { uTime: number; uScale: number; uStrength: number } } {
  const uniforms = new UniformGroup({
    uTime: { value: 0, type: 'f32' },
    uScale: { value: 300, type: 'f32' },
    uStrength: { value: 0.55, type: 'f32' },
  });
  const f = new Filter({
    glProgram: GlProgram.from({ vertex: FILTER_VERT, fragment: CAUSTIC_FRAG, name: 'caustics' }),
    resources: { causticUniforms: uniforms },
  });
  return Object.assign(f, { uniforms: uniforms.uniforms as { uTime: number; uScale: number; uStrength: number } });
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export interface PaintStroke {
  /** Cells painted, keyed y*w+x, with the time they were painted (ms). */
  painted: Map<number, number>;
  /** Ball centre in cell units while a slide is in progress. */
  active?: { from: Point; pos: { x: number; y: number } };
  /** Wet splatter on fresh paint; each speck dries away over about a second. */
  dots: { x: number; y: number; r: number; t: number }[];
  /** Light racing along a just-finished stroke: cell key and start time. */
  shimmer?: { k: number; t: number }[];
  /** Start tile drawn as a round puddle under the ball until the first move. */
  startRound?: number;
  /** Splash stains where the ball hit walls: groups of blobs in board px. */
  splats: { blobs: { x: number; y: number; r: number }[]; t: number }[];
}

/** One level's board: static baked layers plus live paint and glow layers. */
export class Board extends Container {
  readonly cols: number;
  readonly rows: number;
  readonly pad: number;
  readonly paintLayer = new Container();
  readonly fxLayer = new Container();
  readonly ballLayer = new Container();
  private readonly paintG = new Graphics();
  private readonly wetG = new Graphics();
  private readonly dotsG = new Graphics();
  private readonly glowG = new Graphics();
  private readonly hintG = new Graphics();
  private readonly coneG = new Graphics();
  private readonly waveG = new Graphics();
  private paintGlow?: Graphics;
  private plate!: Sprite;
  private gridOver!: Sprite;
  private caustics?: ReturnType<typeof causticFilter>;
  private textures: Texture[] = [];
  private floorCells: Point[] = [];
  private readonly res: number;

  constructor(
    readonly level: Level,
    readonly theme: Theme,
    readonly cell: number,
    res: number,
  ) {
    super();
    // Snap so one cell is a whole number of texture pixels at any DPR.
    this.res = Math.max(1, Math.round(cell * res)) / cell;
    this.rows = level.grid.length;
    this.cols = level.grid[0].length;
    this.pad = cell;

    level.grid.forEach((row, y) => row.forEach((c, x) => c === 0 && this.floorCells.push({ x, y })));
    this.build();
  }

  get boardWidth() {
    return this.cols * this.cell;
  }
  get boardHeight() {
    return this.rows * this.cell;
  }

  private isFloor = (x: number, y: number) => {
    const c = this.level.grid[y]?.[x];
    return c === 0 || c === STOPPER;
  };

  /** Wall cells enclosed by floor (not connected to the outside) belong to the plate. */
  private interiorWalls(): (x: number, y: number) => boolean {
    const { cols, rows } = this;
    const outside = new Set<number>();
    const key = (x: number, y: number) => (y + 1) * (cols + 2) + (x + 1);
    const stack: Point[] = [{ x: -1, y: -1 }];
    outside.add(key(-1, -1));
    while (stack.length) {
      const p = stack.pop()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < -1 || y < -1 || x > cols || y > rows) continue;
        if (this.isFloor(x, y) || outside.has(key(x, y))) continue;
        outside.add(key(x, y));
        stack.push({ x, y });
      }
    }
    return (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !this.isFloor(x, y) && !outside.has(key(x, y));
  }

  private sprite(canvas: HTMLCanvasElement): Sprite {
    const tex = Texture.from(canvas);
    this.textures.push(tex);
    const s = new Sprite(tex);
    s.scale.set(1 / this.res);
    s.position.set(-this.pad, -this.pad);
    return s;
  }

  /** Thin band along the top (dy > 0) or bottom (dy < 0) edges of a mask. */
  private edgeBand(mask: HTMLCanvasElement, dy: number): HTMLCanvasElement {
    const out = makeCanvas(mask.width, mask.height);
    const ctx = out.getContext('2d')!;
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(mask, 0, dy);
    return out;
  }

  private build() {
    const { cols, rows, theme } = this;
    const res = this.res;
    const c = this.cell * res;
    const off = this.pad * res;
    const W = cols * c + off * 2;
    const H = rows * c + off * 2;

    // Floor shape (where the ball rolls). Everything else is raised wall.
    const floorMask = makeCanvas(W, H);
    fillRoundedCells(floorMask.getContext('2d')!, this.isFloor, cols, rows, c, off, off, c * 0.4, '#fff');

    // Wall top surface around the maze: same material as the background,
    // so the walls read as blocks standing on the page. A soft bevel tone
    // where the wall tops round down toward the floor.
    const interior = this.interiorWalls();
    const slab = makeCanvas(W, H);
    fillRoundedCells(
      slab.getContext('2d')!,
      (x, y) => this.isFloor(x, y) || interior(x, y),
      cols,
      rows,
      c,
      off,
      off,
      c * 0.5,
      '#fff',
    );
    const surfaceMask = dilate(slab, c * 0.85);
    // Soft blend into the page, kept out of any surface effect (caustics).
    this.addChild(this.sprite(softBlur(tint(surfaceMask, theme.wallTop), c * 0.5)));
    const surface = makeCanvas(W, H);
    const sctx = surface.getContext('2d')!;
    sctx.drawImage(tint(dilate(slab, c * 0.45), theme.wallTop), 0, 0);
    sctx.drawImage(softBlur(tint(floorMask, theme.bevel), c * 0.13), 0, 0);
    this.plate = this.sprite(surface);
    if (theme.caustics) {
      this.caustics = causticFilter();
      this.caustics.uniforms.uScale = c * 3.2;
      this.plate.filters = [this.caustics];
    }
    this.addChild(this.plate);

    if (theme.neon) {
      const halo = this.sprite(softBlur(tint(floorMask, hex(theme.neon.edge)), c * 0.3));
      halo.blendMode = 'add';
      halo.alpha = 0.75;
      this.addChild(halo);
    }

    // Flat floor with thin tile seams.
    const floorCanvas = makeCanvas(W, H);
    const fctx = floorCanvas.getContext('2d')!;
    fctx.drawImage(tint(floorMask, theme.floor), 0, 0);
    fctx.globalCompositeOperation = 'source-atop';
    const gap = Math.max(1, Math.round(res * 1.5));
    fctx.fillStyle = theme.gridLine;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (!this.isFloor(x, y)) continue;
        fctx.fillRect(off + x * c - gap / 2, off + y * c - gap / 2, c, gap);
        fctx.fillRect(off + x * c - gap / 2, off + y * c - gap / 2, gap, c);
      }
    this.addChild(this.sprite(floorCanvas));

    // Live paint, clipped to the floor.
    const paintMask = this.sprite(floorMask);
    this.paintLayer.addChild(this.paintG, this.dotsG, this.wetG, this.waveG, paintMask);
    this.paintLayer.mask = paintMask;
    const seams = makeCanvas(W, H);
    const gctx = seams.getContext('2d')!;
    gctx.fillStyle = theme.paintSeam;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (!this.isFloor(x, y)) continue;
        gctx.fillRect(off + x * c - gap / 2, off + y * c - gap / 2, c, gap);
        gctx.fillRect(off + x * c - gap / 2, off + y * c - gap / 2, gap, c);
      }
    gctx.globalCompositeOperation = 'destination-in';
    gctx.drawImage(floorMask, 0, 0);
    this.gridOver = this.sprite(seams);
    this.addChild(this.paintLayer, this.gridOver);
    // Stopper studs: four glossy white buttons that stay visible over paint.
    const studs = makeCanvas(W, H);
    const tctx = studs.getContext('2d')!;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (this.level.grid[y][x] !== STOPPER) continue;
        for (const [ux, uy] of [
          [0.33, 0.33],
          [0.67, 0.33],
          [0.33, 0.67],
          [0.67, 0.67],
        ]) {
          const sx = off + (x + ux) * c;
          const sy = off + (y + uy) * c;
          const r = c * 0.11;
          tctx.fillStyle = 'rgba(20,10,50,0.35)';
          tctx.beginPath();
          tctx.ellipse(sx, sy + r * 0.45, r, r * 0.9, 0, 0, Math.PI * 2);
          tctx.fill();
          const sg = tctx.createRadialGradient(sx - r * 0.35, sy - r * 0.4, r * 0.1, sx, sy, r);
          sg.addColorStop(0, '#ffffff');
          sg.addColorStop(0.6, '#f2eefc');
          sg.addColorStop(1, '#c9c1e6');
          tctx.fillStyle = sg;
          tctx.beginPath();
          tctx.arc(sx, sy, r, 0, Math.PI * 2);
          tctx.fill();
        }
      }
    this.addChild(this.sprite(studs));
    if (theme.neon) {
      const glow = new Graphics();
      glow.filters = [new BlurFilter({ strength: this.cell * 0.35, quality: 2 })];
      glow.blendMode = 'add';
      glow.alpha = 0.7;
      this.paintGlow = glow;
      this.addChild(glow);
    }

    // The walls' front faces, seen along the top edge of the floor, and the
    // shadow they cast just below. Drawn over the paint so it runs under them.
    const faceH = c * 0.27;
    const shadowH = c * 0.24;
    const walls = makeCanvas(W, H);
    const wctx = walls.getContext('2d')!;
    wctx.drawImage(softBlur(tint(this.edgeBand(floorMask, faceH + shadowH), theme.wallShadow), c * 0.06), 0, 0);
    const face = tint(this.edgeBand(floorMask, faceH), theme.wallFace);
    wctx.drawImage(face, 0, 0);
    // Darker base where the face meets the floor, lit lip at the top.
    const base = makeCanvas(W, H);
    const bctx = base.getContext('2d')!;
    bctx.drawImage(this.edgeBand(floorMask, faceH), 0, 0);
    bctx.globalCompositeOperation = 'destination-out';
    bctx.drawImage(this.edgeBand(floorMask, faceH * 0.72), 0, 0);
    wctx.drawImage(tint(base, theme.wallFaceDark), 0, 0);
    wctx.drawImage(tint(this.edgeBand(floorMask, res * 1.4), theme.wallLip), 0, 0);
    wctx.globalCompositeOperation = 'destination-in';
    wctx.drawImage(floorMask, 0, 0);
    this.addChild(this.sprite(walls));

    this.addChild(this.glowG, this.hintG, this.coneG, this.fxLayer, this.ballLayer);
  }

  cellCenter(x: number, y: number): Point {
    return { x: (x + 0.5) * this.cell, y: (y + 0.5) * this.cell };
  }

  update(time: number, stroke: PaintStroke, remaining: Point[]) {
    if (this.caustics) this.caustics.uniforms.uTime = time * 0.00035;
    this.drawPaint(time, stroke);
    this.drawGlow(time, remaining);
  }

  private drawPaint(time: number, stroke: PaintStroke) {
    const { cell, theme } = this;
    const w = this.cols;
    const half = cell / 2;
    const g = this.paintG;
    const wet = this.wetG;
    g.clear();
    wet.clear();
    // Every painted tile is filled edge to edge and fully saturated the
    // moment the ball reaches it (the floor mask rounds the outer corners).
    for (const [k, t] of stroke.painted) {
      if (time < t) continue;
      const x = k % w;
      const y = Math.floor(k / w);
      if (k === stroke.startRound) {
        const grow = Math.min(1, (time - t) / 200);
        g.circle((x + 0.53) * cell, (y + 0.55) * cell, half * (0.4 + 0.66 * (1 - (1 - grow) ** 3)));
      } else g.rect(x * cell - 0.5, y * cell - 0.5, cell + 1, cell + 1);
    }
    for (const sh of stroke.shimmer ?? []) {
      const age = time - sh.t;
      if (age < 0 || age > 220) continue;
      const a = Math.sin((age / 220) * Math.PI);
      wet.rect((sh.k % w) * cell, Math.floor(sh.k / w) * cell, cell, cell).fill({ color: 0xffffff, alpha: 0.32 * a });
    }
    if (stroke.active) {
      // The stroke behind the ball: a band from the slide start to the ball.
      const { from, pos } = stroke.active;
      const ax = (from.x + 0.5) * cell;
      const ay = (from.y + 0.5) * cell;
      const bx = (pos.x + 0.5) * cell;
      const by = (pos.y + 0.5) * cell;
      const x0 = Math.min(ax, bx) - half;
      const y0 = Math.min(ay, by) - half;
      const x1 = Math.max(ax, bx) + half;
      const y1 = Math.max(ay, by) + half;
      g.rect(x0, y0, x1 - x0, y1 - y0);
    }
    for (const sp of stroke.splats) {
      const age = time - sp.t;
      const grow = age >= 220 ? 1 : 1 - (1 - Math.max(0, age) / 220) ** 3;
      for (const b of sp.blobs) g.circle(b.x, b.y, b.r * grow);
    }
    g.fill({ color: theme.paint });

    const d = this.dotsG;
    d.clear();
    for (const dot of stroke.dots) {
      const age = time - dot.t;
      if (age < 0) continue;
      const fade = age < 260 ? 1 : Math.max(0, 1 - (age - 260) / 700);
      if (fade <= 0) continue;
      d.circle(dot.x, dot.y, dot.r * (0.55 + 0.45 * fade)).fill({ color: theme.paintDark, alpha: 0.95 * fade });
    }

    if (this.paintGlow) {
      const pg = this.paintGlow;
      pg.clear();
      for (const k of stroke.painted.keys()) pg.rect((k % w) * cell, Math.floor(k / w) * cell, cell, cell);
      if (stroke.painted.size) pg.fill({ color: theme.paint, alpha: 0.6 });
    }
  }

  /** Pale speed cone fanning from where the swipe started to the ball. */
  drawCone(from: Point | null, to: { x: number; y: number }, alpha: number) {
    const g = this.coneG;
    g.clear();
    if (!from || alpha <= 0.01) return;
    const { cell } = this;
    const ax = (from.x + 0.5) * cell;
    const ay = (from.y + 0.5) * cell;
    const bx = (to.x + 0.5) * cell;
    const by = (to.y + 0.5) * cell;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 2) return;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const wEnd = cell * 0.36;
    const wStart = cell * 0.04;
    g.poly([ax + nx * wStart, ay + ny * wStart, bx + nx * wEnd, by + ny * wEnd, bx - nx * wEnd, by - ny * wEnd, ax - nx * wStart, ay - ny * wStart])
      .fill({ color: this.theme.cone, alpha: 0.55 * alpha });
    g.poly([ax, ay, bx + nx * wEnd * 0.45, by + ny * wEnd * 0.45, bx - nx * wEnd * 0.45, by - ny * wEnd * 0.45])
      .fill({ color: 0xffffff, alpha: 0.35 * alpha });
  }

  /** Diagonal light sweep across the painted floor (level complete). */
  drawSweep(progress: number) {
    const g = this.waveG;
    g.clear();
    if (progress <= 0 || progress >= 1) return;
    const W = this.boardWidth;
    const H = this.boardHeight;
    const span = W + H;
    const x = -H + span * progress;
    const band = this.cell * 1.4;
    for (const [off, a] of [
      [0, 0.45],
      [band * 0.9, 0.18],
    ] as const) {
      g.poly([x + off, 0, x + off + band, 0, x + off + band - H, H, x + off - H, H]).fill({ color: 0xffffff, alpha: a });
    }
  }

  private drawGlow(time: number, remaining: Point[]) {
    const g = this.glowG;
    g.clear();
    const { cell } = this;
    const few = remaining.length <= 4;
    for (const p of remaining) {
      const phase = (p.x * 0.7 + p.y * 1.3) % (Math.PI * 2);
      const b = 0.5 + 0.5 * Math.sin(time * 0.0025 + phase);
      if (few) {
        // Twinkle so the last few tiles are easy to spot.
        const cx = (p.x + 0.5) * cell;
        const cy = (p.y + 0.5) * cell;
        const s = cell * (0.12 + 0.1 * b);
        g.poly([cx, cy - s * 2, cx + s * 0.45, cy - s * 0.45, cx + s * 2, cy, cx + s * 0.45, cy + s * 0.45, cx, cy + s * 2, cx - s * 0.45, cy + s * 0.45, cx - s * 2, cy, cx - s * 0.45, cy - s * 0.45]).fill({
          color: 0xffffff,
          alpha: 0.35 + 0.5 * b,
        });
      }
    }
  }

  /** Animated chevrons along a slide path, used by hints and the tutorial. */
  drawHint(time: number, path: Point[] | null, dir?: Point) {
    const g = this.hintG;
    g.clear();
    if (!path || !dir) return;
    const { cell } = this;
    path.forEach((p, i) => {
      const cx = (p.x + 0.5) * cell;
      const cy = (p.y + 0.5) * cell;
      const wave = Math.max(0, Math.sin(time * 0.006 - i * 0.9));
      const s = cell * 0.17;
      const ax = dir.x;
      const ay = dir.y;
      // Chevron pointing along (ax, ay).
      const tipX = cx + ax * s;
      const tipY = cy + ay * s;
      const backX = cx - ax * s;
      const backY = cy - ay * s;
      g.moveTo(backX - ay * s * 1.3, backY + ax * s * 1.3)
        .lineTo(tipX, tipY)
        .lineTo(backX + ay * s * 1.3, backY - ax * s * 1.3)
        .stroke({ color: 0xffffff, width: cell * 0.09, alpha: 0.25 + 0.6 * wave, cap: 'round', join: 'round' });
    });
  }

  floorPoints(): Point[] {
    return this.floorCells;
  }

  override destroy() {
    // Detach the sprite mask first: Pixi pools mask effects, and destroying a
    // still-attached mask leaves a stale effect that later renders at a
    // garbage (huge) size.
    this.paintLayer.mask = null;
    super.destroy({ children: true });
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
  }
}
