import { BlurFilter, Container, Filter, GlProgram, Graphics, Sprite, Texture, UniformGroup } from 'pixi.js';
import type { Level, Point } from '../levels/core.ts';
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
  color.rgb += vec3(0.8, 1.0, 1.0) * v * uStrength * color.a;
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
  dots: { x: number; y: number; r: number }[];
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
  private readonly waveG = new Graphics();
  private paintGlow?: Graphics;
  private plate!: Sprite;
  private caustics?: ReturnType<typeof causticFilter>;
  private textures: Texture[] = [];
  private floorCells: Point[] = [];

  constructor(
    readonly level: Level,
    readonly theme: Theme,
    readonly cell: number,
    private readonly res: number,
  ) {
    super();
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

  private isFloor = (x: number, y: number) => this.level.grid[y]?.[x] === 0;

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

  private build() {
    const { cols, rows, theme } = this;
    const res = this.res;
    const c = this.cell * res;
    const off = this.pad * res;
    const W = cols * c + off * 2;
    const H = rows * c + off * 2;

    // Floor shape.
    const floorMask = makeCanvas(W, H);
    fillRoundedCells(floorMask.getContext('2d')!, this.isFloor, cols, rows, c, off, off, c * 0.42, '#fff');

    // Plate: floor plus enclosed walls, grown outward into a soft border.
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
    const plateMask = dilate(slab, c * 0.42);

    const shadow = softBlur(tint(plateMask, theme.plateShadow), c * 0.45);
    const shadowSprite = this.sprite(shadow);
    shadowSprite.y += this.cell * 0.22;
    this.addChild(shadowSprite);

    // Plate with a visible thickness (side face) and a soft top gradient.
    const plateCanvas = makeCanvas(W, H);
    const pctx = plateCanvas.getContext('2d')!;
    pctx.drawImage(tint(plateMask, theme.wallSide), 0, c * 0.1);
    const grad = pctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, theme.plateLight);
    grad.addColorStop(1, theme.plate);
    pctx.drawImage(tint(plateMask, grad), 0, 0);
    this.plate = this.sprite(plateCanvas);
    if (theme.caustics) {
      this.caustics = causticFilter();
      this.caustics.uniforms.uScale = c * 3.2;
      this.plate.filters = [this.caustics];
    }
    this.addChild(this.plate);

    if (theme.neon) {
      const halo = this.sprite(softBlur(tint(floorMask, hex(theme.neon.edge)), c * 0.35));
      halo.blendMode = 'add';
      halo.alpha = 0.85;
      this.addChild(halo);
    }

    // Sunken floor with faint tile grid.
    const floorCanvas = makeCanvas(W, H);
    const fctx = floorCanvas.getContext('2d')!;
    const fgrad = fctx.createLinearGradient(0, off, 0, H - off);
    fgrad.addColorStop(0, theme.floorTop);
    fgrad.addColorStop(1, theme.floorBottom);
    fctx.drawImage(tint(floorMask, fgrad), 0, 0);
    fctx.globalCompositeOperation = 'source-atop';
    fctx.strokeStyle = theme.gridLine;
    fctx.lineWidth = Math.max(1, res);
    fctx.beginPath();
    for (let x = 0; x <= cols; x++) {
      fctx.moveTo(off + x * c, 0);
      fctx.lineTo(off + x * c, H);
    }
    for (let y = 0; y <= rows; y++) {
      fctx.moveTo(0, off + y * c);
      fctx.lineTo(W, off + y * c);
    }
    fctx.stroke();
    this.addChild(this.sprite(floorCanvas));

    // Live paint, clipped to the floor shape.
    const paintMask = this.sprite(floorMask);
    this.paintLayer.addChild(this.paintG, this.dotsG, this.wetG, this.waveG, paintMask);
    this.paintLayer.mask = paintMask;
    this.addChild(this.paintLayer);
    if (theme.neon) {
      const glow = new Graphics();
      glow.filters = [new BlurFilter({ strength: this.cell * 0.35, quality: 2 })];
      glow.blendMode = 'add';
      glow.alpha = 0.7;
      this.paintGlow = glow;
      this.addChild(glow);
    }

    // Wall lip: inner shadow all round plus the walls' front faces along the
    // top edge of every channel, drawn over the paint for depth.
    const lip = makeCanvas(W, H);
    const lctx = lip.getContext('2d')!;
    const inverse = makeCanvas(W, H);
    const ictx = inverse.getContext('2d')!;
    ictx.fillStyle = theme.neon ? 'rgba(0,0,0,0.6)' : 'rgba(20,0,60,0.42)';
    ictx.fillRect(0, 0, W, H);
    ictx.globalCompositeOperation = 'destination-out';
    ictx.drawImage(floorMask, 0, c * 0.06);
    lctx.drawImage(softBlur(inverse, c * 0.16), 0, 0);
    const face = makeCanvas(W, H);
    const facectx = face.getContext('2d')!;
    facectx.drawImage(floorMask, 0, 0);
    facectx.globalCompositeOperation = 'destination-out';
    facectx.drawImage(floorMask, 0, c * 0.13);
    lctx.drawImage(tint(face, theme.neon ? hex(theme.neon.edge) : theme.wallSide), 0, 0);
    lctx.globalCompositeOperation = 'destination-in';
    lctx.drawImage(floorMask, 0, 0);
    this.addChild(this.sprite(lip));

    this.addChild(this.glowG, this.hintG, this.fxLayer, this.ballLayer);
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
    // Liquid look: every painted cell is a round blob that swells in, and
    // neighbouring blobs are bridged, so ends and the start are circles.
    for (const [k, t] of stroke.painted) {
      const x = k % w;
      const y = Math.floor(k / w);
      const cx = (x + 0.5) * cell;
      const cy = (y + 0.5) * cell;
      const age = time - t;
      if (age < 0) continue;
      const grow = age >= 160 ? 1 : 1 - (1 - age / 160) ** 3;
      g.circle(cx, cy, half * (0.35 + 0.65 * grow) + 0.5);
      if (stroke.painted.has(k + 1) && time - stroke.painted.get(k + 1)! >= 0) g.rect(cx, cy - half - 0.5, cell, cell + 1);
      if (stroke.painted.has(k + w) && time - stroke.painted.get(k + w)! >= 0) g.rect(cx - half - 0.5, cy, cell + 1, cell);
      if (age < 650) {
        const a = (1 - age / 650) ** 2;
        wet.circle(cx, cy, half * 0.95).fill({ color: theme.paintLight, alpha: 0.5 * a });
      }
    }
    if (stroke.active) {
      // The stroke behind the ball: a band from the slide start to the ball.
      const { from, pos } = stroke.active;
      const ax = (from.x + 0.5) * cell;
      const ay = (from.y + 0.5) * cell;
      const bx = (pos.x + 0.5) * cell;
      const by = (pos.y + 0.5) * cell;
      const x0 = Math.min(ax, bx) - (ay === by ? 0 : half);
      const y0 = Math.min(ay, by) - (ax === bx ? 0 : half);
      const x1 = Math.max(ax, bx) + (ay === by ? 0 : half);
      const y1 = Math.max(ay, by) + (ax === bx ? 0 : half);
      g.rect(x0, y0, x1 - x0, y1 - y0);
      g.circle(bx, by, half * 1.02);
      // Glossy wet streak along the centre of the fresh stroke.
      const horizontal = ay === by;
      const sw = cell * 0.16;
      wet.roundRect(
        horizontal ? x0 : (ax + bx) / 2 - sw / 2 - cell * 0.12,
        horizontal ? (ay + by) / 2 - sw / 2 - cell * 0.12 : y0,
        horizontal ? x1 - x0 : sw,
        horizontal ? sw : y1 - y0,
        sw / 2,
      ).fill({ color: 0xffffff, alpha: 0.35 });
    }
    for (const sp of stroke.splats) {
      const age = time - sp.t;
      const grow = age >= 220 ? 1 : 1 - (1 - Math.max(0, age) / 220) ** 3;
      for (const b of sp.blobs) g.circle(b.x, b.y, b.r * grow);
    }
    g.fill({ color: theme.paint });

    const d = this.dotsG;
    d.clear();
    for (const dot of stroke.dots) d.circle(dot.x, dot.y, dot.r);
    if (stroke.dots.length) d.fill({ color: theme.paintDark, alpha: 0.85 });

    if (this.paintGlow) {
      const pg = this.paintGlow;
      pg.clear();
      for (const k of stroke.painted.keys()) pg.circle(((k % w) + 0.5) * cell, (Math.floor(k / w) + 0.5) * cell, half);
      if (stroke.painted.size) pg.fill({ color: theme.paint, alpha: 0.6 });
    }
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
      const inset = cell * 0.18;
      g.roundRect(p.x * cell + inset, p.y * cell + inset, cell - inset * 2, cell - inset * 2, cell * 0.2).fill({
        color: 0xffffff,
        alpha: 0.01 + 0.022 * b,
      });
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
