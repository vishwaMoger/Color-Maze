import { BlurFilter, Container, Filter, GlProgram, Graphics, Sprite, Texture, UniformGroup } from 'pixi.js';
import {
  ARROW_D,
  ARROW_L,
  ARROW_R,
  ARROW_U,
  COIN,
  CURVE_BL,
  CURVE_BR,
  CURVE_TL,
  CURVE_TR,
  isFloor,
  KEY,
  PORTAL_A,
  PORTAL_B,
  SAW,
  STOPPER,
  type Level,
  type Point,
} from '../levels/core.ts';
import { iconImage } from './assets.ts';
import { dilate, fillRoundedCells, makeCanvas, softBlur, texture, tint } from './shape.ts';
import { paintGloss, type PaintGloss } from './shaders.ts';
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

/**
 * One tile of a blob of painted tiles: a rect whose convex corners (no
 * filled tile on either side of that corner) are rounded. Edges overlap
 * neighbours by half a pixel so anti-aliasing leaves no seams.
 */
function roundedCell(g: Graphics, x: number, y: number, cell: number, r: number, filled: (x: number, y: number) => boolean) {
  const e = 0.5;
  const x0 = x * cell - e;
  const y0 = y * cell - e;
  const x1 = (x + 1) * cell + e;
  const y1 = (y + 1) * cell + e;
  const tl = !filled(x - 1, y) && !filled(x, y - 1);
  const tr = !filled(x + 1, y) && !filled(x, y - 1);
  const br = !filled(x + 1, y) && !filled(x, y + 1);
  const bl = !filled(x - 1, y) && !filled(x, y + 1);
  if (!tl && !tr && !br && !bl) {
    g.rect(x0, y0, x1 - x0, y1 - y0);
    return;
  }
  g.moveTo(x0 + (tl ? r : 0), y0).lineTo(x1 - (tr ? r : 0), y0);
  if (tr) g.arcTo(x1, y0, x1, y0 + r, r);
  g.lineTo(x1, y1 - (br ? r : 0));
  if (br) g.arcTo(x1, y1, x1 - r, y1, r);
  g.lineTo(x0 + (bl ? r : 0), y1);
  if (bl) g.arcTo(x0, y1, x0, y1 - r, r);
  g.lineTo(x0, y0 + (tl ? r : 0));
  if (tl) g.arcTo(x0, y0, x0 + r, y0, r);
  g.closePath();
}

/** Stud positions on a stopper tile, in cell units. */
const STUD_POS = [
  [0.22, 0.22],
  [0.78, 0.22],
  [0.22, 0.78],
  [0.78, 0.78],
];

interface Grip {
  at: number;
  studs: { s: Sprite; x0: number; y0: number; cx: number; cy: number }[];
}

/** How long fresh paint takes to flow out and fill its tile (ms). */
export const SPREAD_MS = 280;

const TRAIL_W = 256;
const TRAIL_H = 64;
let TRAIL_TEX: Texture | null = null;

/** Feathered streak: alpha ramps up along x, gaussian across y, widening. */
function trailTexture(): Texture {
  if (TRAIL_TEX) return TRAIL_TEX;
  const c = makeCanvas(TRAIL_W, TRAIL_H);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(TRAIL_W, TRAIL_H);
  for (let x = 0; x < TRAIL_W; x++) {
    const t = x / (TRAIL_W - 1);
    const along = Math.pow(t, 1.6) * (1 - Math.pow(Math.max(0, t - 0.94) / 0.06, 2));
    const sigma = 0.06 + 0.32 * Math.pow(t, 0.8);
    for (let y = 0; y < TRAIL_H; y++) {
      const v = (y + 0.5) / TRAIL_H - 0.5;
      const across = Math.exp(-(v * v) / (2 * sigma * sigma));
      const core = Math.exp(-(v * v) / (2 * (sigma * 0.35) ** 2));
      const a = along * (0.55 * across + 0.45 * core);
      const i = (y * TRAIL_W + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 250;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  ctx.putImageData(img, 0, 0);
  TRAIL_TEX = Texture.from(c);
  return TRAIL_TEX;
}

/** A swirling portal: a glowing ring with spiral arms. */
function portalTexture(r: number, res: number, cols: [string, string, string]): Texture {
  const R = r * res;
  const size = Math.ceil(R * 2 + 6);
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  g.addColorStop(0, cols[0]);
  g.addColorStop(0.45, cols[1]);
  g.addColorStop(0.8, cols[2]);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  // Spiral arms.
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineCap = 'round';
  for (let a = 0; a < 3; a++) {
    ctx.lineWidth = R * 0.1;
    ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.05) {
      const ang = a * ((Math.PI * 2) / 3) + t * Math.PI * 1.4;
      const rr = R * (0.18 + t * 0.66);
      const px = cx + Math.cos(ang) * rr;
      const py = cy + Math.sin(ang) * rr;
      if (t === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Bright rim.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = R * 0.08;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  return Texture.from(cv);
}

/** A shiny circular saw blade with a dark hub. */
function sawBlade(r: number, res: number): Texture {
  const R = r * res;
  const size = Math.ceil(R * 2 + 8);
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const teeth = 14;
  // Soft shadow under the blade.
  ctx.fillStyle = 'rgba(20, 10, 50, 0.35)';
  ctx.beginPath();
  ctx.arc(cx + R * 0.06, cy + R * 0.1, R * 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / teeth;
    // Hooked tooth: rise along the arc, then drop straight to the gullet.
    ctx.lineTo(cx + Math.cos(a0) * R * 0.78, cy + Math.sin(a0) * R * 0.78);
    ctx.lineTo(cx + Math.cos(a0 + (a1 - a0) * 0.75) * R, cy + Math.sin(a0 + (a1 - a0) * 0.75) * R);
    ctx.lineTo(cx + Math.cos(a1) * R * 0.78, cy + Math.sin(a1) * R * 0.78);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#c9cedd');
  g.addColorStop(0.55, '#e9edf5');
  g.addColorStop(1, '#7c8398');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, R * 0.05);
  ctx.strokeStyle = '#4b5068';
  ctx.stroke();
  // Inner disc and hub.
  const d = ctx.createRadialGradient(cx - R * 0.15, cy - R * 0.2, R * 0.05, cx, cy, R * 0.6);
  d.addColorStop(0, '#f4f6fb');
  d.addColorStop(1, '#8b92a8');
  ctx.fillStyle = d;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.56, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3b3f55';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * 0.34, cy + Math.sin(a) * R * 0.34, R * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#2b2e40';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.arc(cx - R * 0.05, cy - R * 0.06, R * 0.05, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(cv);
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export interface PaintStroke {
  /** Cells painted, keyed y*w+x, with the time they were painted (ms). */
  painted: Map<number, number>;
  /** Travel axis each tile was painted along: 0 across, 1 down, 2 both. */
  axis?: Map<number, number>;
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
  private readonly trail = new Sprite(trailTexture());
  private gloss: PaintGloss | null = null;
  private readonly sawLayer = new Container();
  private readonly saws: Sprite[] = [];
  private sawAngle = 0;
  private sawHitAt = -1e9;
  private readonly studLayer = new Container();
  private readonly studFront = new Container();
  private readonly grips = new Map<number, Grip>();

  private readonly portals: { s: Sprite; dir: number }[] = [];
  private readonly pickups = new Map<number, { s: Sprite; glow: Graphics; base: number; y0: number; at: number }>();
  private lastTime = 0;

  /** Where the board sits on screen, so paint patterns stay attached. */
  setPaintSpace(x: number, y: number, cellPx: number) {
    if (!this.gloss) return;
    this.gloss.uniforms.uBoard[0] = x;
    this.gloss.uniforms.uBoard[1] = y;
    this.gloss.uniforms.uCell = cellPx;
  }

  /** A coin or key was collected from this tile. */
  pickup(p: Point) {
    const it = this.pickups.get(p.y * this.cols + p.x);
    if (it && it.at < 0) it.at = this.lastTime;
  }

  /** The ball hit a saw: it whirrs faster for a moment. */
  sawHit(time: number) {
    this.sawHitAt = time;
  }
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

    level.grid.forEach((row, y) => row.forEach((_, x) => isFloor(level.grid, x, y) && this.floorCells.push({ x, y })));
    this.build();
  }

  get boardWidth() {
    return this.cols * this.cell;
  }
  get boardHeight() {
    return this.rows * this.cell;
  }

  /** Floor for the board's shape: saw notches are part of the outline. */
  private isFloor = (x: number, y: number) => isFloor(this.level.grid, x, y) || this.level.grid[y]?.[x] === SAW;

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

  /**
   * Grout lines only where two floor tiles meet, never along walls, so the
   * floor reads as evenly laid tiles.
   */
  private drawGrout(ctx: CanvasRenderingContext2D, color: string, c: number, off: number, gap: number) {
    // Lines sit on whole device pixels so they stay crisp and never fade
    // out between two pixel columns.
    ctx.fillStyle = color;
    const half = Math.floor(gap / 2);
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++) {
        if (!this.isFloor(x, y)) continue;
        const x0 = Math.round(off + x * c);
        const y0 = Math.round(off + y * c);
        const x1 = Math.round(off + (x + 1) * c);
        const y1 = Math.round(off + (y + 1) * c);
        if (this.isFloor(x + 1, y)) ctx.fillRect(x1 - half, y0, gap, y1 - y0);
        if (this.isFloor(x, y + 1)) ctx.fillRect(x0, y1 - half, x1 - x0, gap);
      }
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
    // A wooden board is a frame of its own, set on the page with a soft
    // shadow; other wall tops are the page itself and blend softly into it.
    const framed = theme.texture === 'wood';
    // Wide enough that frames around neighbouring arms close up.
    const plateMask = dilate(slab, c * (framed ? 0.56 : 0.45));
    if (framed) {
      const sh = this.sprite(softBlur(tint(plateMask, '#5a2e10'), c * 0.35));
      sh.alpha = 0.32;
      sh.y += c * 0.12 / res;
      this.addChild(sh);
    } else this.addChild(this.sprite(softBlur(tint(surfaceMask, theme.wallTop), c * 0.5)));
    const surface = makeCanvas(W, H);
    const sctx = surface.getContext('2d')!;
    sctx.drawImage(tint(plateMask, theme.wallTop), 0, 0);
    if (framed) texture(sctx, 'wood', W, H, c, false);
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
    if (theme.texture) texture(fctx, theme.texture, W, H, c, true);
    fctx.globalCompositeOperation = 'source-atop';
    // Hairline seams, about one CSS pixel, softened so tiles read as a
    // clean grid rather than a drawn table.
    const gap = Math.max(1, Math.round(res * 1.1));
    fctx.globalAlpha = 0.6;
    this.drawGrout(fctx, theme.gridLine, c, off, gap);
    fctx.globalAlpha = 1;
    this.addChild(this.sprite(floorCanvas));

    // Live paint, clipped to the floor.
    const paintMask = this.sprite(floorMask);
    // Paint and its wet speckles get the glossy paint shader.
    const paintBody = new Container();
    paintBody.addChild(this.paintG, this.dotsG);
    this.gloss = paintGloss(this.cell * 0.07 * res);
    this.gloss.uniforms.uMode = theme.paintMode ?? 0;
    const alt = theme.paintAlt ?? theme.paintLight;
    this.gloss.uniforms.uAlt[0] = ((alt >> 16) & 255) / 255;
    this.gloss.uniforms.uAlt[1] = ((alt >> 8) & 255) / 255;
    this.gloss.uniforms.uAlt[2] = (alt & 255) / 255;
    paintBody.filters = [this.gloss];
    this.paintLayer.addChild(paintBody, this.wetG, this.waveG, paintMask);
    this.paintLayer.mask = paintMask;
    const seams = makeCanvas(W, H);
    const gctx = seams.getContext('2d')!;
    this.drawGrout(gctx, theme.paintSeam, c, off, gap);
    gctx.globalCompositeOperation = 'destination-in';
    gctx.drawImage(floorMask, 0, 0);
    this.gridOver = this.sprite(seams);
    this.addChild(this.paintLayer, this.gridOver);
    // Stopper grips: four chunky glossy studs in sockets that stay visible
    // over the paint and clamp onto the ball when it stops here.
    const studs = makeCanvas(W, H);
    const tctx = studs.getContext('2d')!;
    const sr = c * 0.125;
    const studTex = this.studTexture(sr / res, res);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (this.level.grid[y][x] !== STOPPER) continue;
        const grip: Grip = { at: -1e9, studs: [] };
        for (const [ux, uy] of STUD_POS) {
          const sx = off + (x + ux) * c;
          const sy = off + (y + uy) * c;
          // Socket: a soft recess the stud sits in.
          const rg = tctx.createRadialGradient(sx, sy + sr * 0.15, sr * 0.6, sx, sy + sr * 0.15, sr * 1.45);
          rg.addColorStop(0, 'rgba(30,14,70,0.34)');
          rg.addColorStop(1, 'rgba(30,14,70,0)');
          tctx.fillStyle = rg;
          tctx.beginPath();
          tctx.arc(sx, sy + sr * 0.15, sr * 1.45, 0, Math.PI * 2);
          tctx.fill();
          const s = new Sprite(studTex);
          s.anchor.set(0.5);
          s.scale.set(1 / res);
          s.position.set((x + ux) * this.cell, (y + uy) * this.cell);
          // The front pair stands in front of a ball held between them.
          (uy > 0.5 ? this.studFront : this.studLayer).addChild(s);
          grip.studs.push({ s, x0: s.x, y0: s.y, cx: (x + 0.5) * this.cell, cy: (y + 0.5) * this.cell });
        }
        this.grips.set(y * cols + x, grip);
      }
    // Curved corners: a white rounded bracket hugging the closed corner,
    // showing the ball will be swung round it. Drawn above the walls so the
    // wall shadow does not grey them out.
    const marks = makeCanvas(W, H);
    const mctx = marks.getContext('2d')!;
    let hasMarks = false;
    const corners: Record<number, [number, number, number, number]> = {
      [CURVE_TL]: [0, 0, 1, 1],
      [CURVE_TR]: [1, 0, -1, 1],
      [CURVE_BL]: [0, 1, 1, -1],
      [CURVE_BR]: [1, 1, -1, -1],
    };
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const k = corners[this.level.grid[y][x]];
        if (!k) continue;
        hasMarks = true;
        const [cx, cy, sx, sy] = k;
        const x0 = off + (x + cx) * c;
        const y0 = off + (y + cy) * c;
        const ins = c * 0.15;
        // A wall above shows its front face over the top of the cell.
        const insY = sy > 0 ? ins + c * 0.24 : ins;
        const len = c * 0.62;
        const lenY = insY + (len - ins) * 0.85;
        const r = c * 0.28;
        const bracket = (dy: number, color: string, width: number) => {
          mctx.strokeStyle = color;
          mctx.lineWidth = width;
          mctx.lineCap = 'round';
          mctx.beginPath();
          mctx.moveTo(x0 + sx * ins, y0 + sy * lenY + dy);
          mctx.arcTo(x0 + sx * ins, y0 + sy * insY + dy, x0 + sx * len, y0 + sy * insY + dy, r);
          mctx.lineTo(x0 + sx * len, y0 + sy * insY + dy);
          mctx.stroke();
        };
        bracket(c * 0.035, 'rgba(20,10,50,0.28)', c * 0.12);
        bracket(0, '#ffffff', c * 0.1);
      }
    this.addChild(this.sprite(studs), this.studLayer);
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
    // Raised walls: the front face sits inside the wall, above the floor's
    // top edges, so no floor tile is covered (the top row stays whole). The
    // wall casts one soft shadow onto the floor below it.
    const faceH = c * 0.26;
    const shadowH = c * 0.26;
    const rise = (h: number) => {
      const o = makeCanvas(W, H);
      const octx = o.getContext('2d')!;
      octx.drawImage(floorMask, 0, -h);
      octx.globalCompositeOperation = 'destination-out';
      octx.drawImage(floorMask, 0, 0);
      return o;
    };
    const walls = makeCanvas(W, H);
    const wctx = walls.getContext('2d')!;
    const shade = makeCanvas(W, H);
    const shctx = shade.getContext('2d')!;
    shctx.drawImage(softBlur(tint(this.edgeBand(floorMask, shadowH), theme.wallShadow), c * 0.14), 0, 0);
    shctx.globalCompositeOperation = 'destination-in';
    shctx.drawImage(floorMask, 0, 0);
    wctx.drawImage(shade, 0, 0);
    wctx.drawImage(tint(rise(faceH), theme.wallFace), 0, 0);
    // Darker foot where the face meets the floor, lit lip along its top.
    wctx.drawImage(tint(rise(faceH * 0.3), theme.wallFaceDark), 0, 0);
    const lip = rise(faceH);
    const lctx = lip.getContext('2d')!;
    lctx.globalCompositeOperation = 'destination-out';
    lctx.drawImage(rise(faceH - res * 1.5), 0, 0);
    wctx.drawImage(tint(lip, theme.wallLip), 0, 0);
    // Arrow tiles: a bold white double chevron pointing the way.
    const arrowAngle: Record<number, number> = { [ARROW_R]: 0, [ARROW_D]: Math.PI / 2, [ARROW_L]: Math.PI, [ARROW_U]: -Math.PI / 2 };
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const ang = arrowAngle[this.level.grid[y][x]];
        if (ang === undefined) continue;
        hasMarks = true;
        mctx.save();
        mctx.translate(off + (x + 0.5) * c, off + (y + 0.5) * c);
        mctx.rotate(ang);
        mctx.lineCap = 'round';
        mctx.lineJoin = 'round';
        for (const [dx, a] of [
          [-0.12, 0.55],
          [0.12, 1],
        ]) {
          for (const [col, w, oy] of [
            ['rgba(20,10,50,0.3)', 0.13, 0.035],
            [`rgba(255,255,255,${a})`, 0.1, 0],
          ] as const) {
            mctx.strokeStyle = col;
            mctx.lineWidth = c * w;
            mctx.beginPath();
            mctx.moveTo((dx - 0.1) * c, -0.2 * c + oy * c);
            mctx.lineTo((dx + 0.1) * c, 0 + oy * c);
            mctx.lineTo((dx - 0.1) * c, 0.2 * c + oy * c);
            mctx.stroke();
          }
        }
        mctx.restore();
      }
    this.addChild(this.sprite(walls));
    if (hasMarks) this.addChild(this.sprite(marks));

    // Saw blades spin in their notches, nudged toward the wall behind them.
    const cs = this.cell;
    const sawTex = sawBlade(cs * 0.46, res);
    this.textures.push(sawTex);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (this.level.grid[y][x] !== SAW) continue;
        let ox = 0;
        let oy = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          if (isFloor(this.level.grid, x + dx, y + dy)) {
            ox = -dx * cs * 0.12;
            oy = -dy * cs * 0.12;
          }
        const blade = new Sprite(sawTex);
        blade.anchor.set(0.5);
        blade.scale.set(1 / res);
        blade.position.set((x + 0.5) * cs + ox, (y + 0.5) * cs + oy);
        this.saws.push(blade);
        this.sawLayer.addChild(blade);
      }
    // Portals: swirling rings, cyan for one end and orange for the other.
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const v = this.level.grid[y][x];
        if (v !== PORTAL_A && v !== PORTAL_B) continue;
        const tex = portalTexture(cs * 0.46, res, v === PORTAL_A ? ['#bff6ff', '#38d8ff', '#1167d8'] : ['#ffe6b8', '#ffa13d', '#d8540f']);
        this.textures.push(tex);
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        sp.scale.set(1 / res);
        sp.position.set((x + 0.5) * cs, (y + 0.5) * cs);
        this.portals.push({ s: sp, dir: v === PORTAL_A ? 1 : -1 });
        this.sawLayer.addChild(sp);
      }
    // Coins and keys lying on tiles, bobbing gently.
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const v = this.level.grid[y][x];
        if (v !== COIN && v !== KEY) continue;
        const img = iconImage(v === COIN ? 'coin' : 'key');
        if (!img) continue;
        const sp = new Sprite(Texture.from(img));
        sp.anchor.set(0.5);
        const size = cs * (v === COIN ? 0.5 : 0.6);
        sp.scale.set(size / Math.max(img.width, img.height));
        sp.position.set((x + 0.5) * cs, (y + 0.5) * cs);
        const glow = new Graphics().circle(0, 0, size * 0.62).fill({ color: v === COIN ? 0xffe27a : 0xfff3c2, alpha: 0.35 });
        glow.position.copyFrom(sp.position);
        this.sawLayer.addChild(glow, sp);
        this.pickups.set(y * cols + x, { s: sp, glow, base: sp.scale.x, y0: sp.y, at: -1 });
      }
    this.trail.anchor.set(1, 0.5);
    this.trail.visible = false;
    this.addChild(this.sawLayer, this.glowG, this.hintG, this.coneG, this.trail, this.fxLayer, this.ballLayer, this.studFront);
  }

  /** The ball stopped on the stopper at (x, y): its studs clamp onto it. */
  grip(x: number, y: number) {
    const g = this.grips.get(y * this.cols + x);
    if (g) g.at = this.lastTime;
    return !!g;
  }

  private studTexture(r: number, res: number): Texture {
    const R = r * res;
    const S = Math.ceil(R * 3);
    const cv = makeCanvas(S, S);
    const ctx = cv.getContext('2d')!;
    const cx = S / 2;
    const cy = S / 2 - R * 0.12;
    // Contact shadow.
    ctx.fillStyle = 'rgba(25,10,60,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + R * 0.42, R * 1.02, R * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    // Side of the stud, then its domed top.
    ctx.fillStyle = '#a597d6';
    ctx.beginPath();
    ctx.arc(cx, cy + R * 0.16, R, 0, Math.PI * 2);
    ctx.fill();
    const top = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.08, cx, cy, R);
    top.addColorStop(0, '#ffffff');
    top.addColorStop(0.55, '#f4f0ff');
    top.addColorStop(1, '#cfc5ef');
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.94, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.32, cy - R * 0.36, R * 0.3, R * 0.2, -0.6, 0, Math.PI * 2);
    ctx.fill();
    const tex = Texture.from(cv);
    this.textures.push(tex);
    return tex;
  }

  cellCenter(x: number, y: number): Point {
    return { x: (x + 0.5) * this.cell, y: (y + 0.5) * this.cell };
  }

  update(time: number, stroke: PaintStroke, remaining: Point[]) {
    this.lastTime = time;
    if (this.caustics) this.caustics.uniforms.uTime = time * 0.00035;
    if (this.gloss) this.gloss.uniforms.uTime = time * 0.001;
    // Saws spin; after a hit they whirr faster for a moment.
    const boost = Math.max(0, 1 - (time - this.sawHitAt) / 900);
    this.sawAngle += 0.16 * (1 + boost * 2.5);
    for (const b of this.saws) b.rotation = this.sawAngle;
    for (const p of this.portals) {
      p.s.rotation = time * 0.003 * p.dir;
      p.s.scale.set((1 / this.res) * (1 + Math.sin(time * 0.004) * 0.05));
    }
    let i = 0;
    for (const p of this.pickups.values()) {
      i++;
      if (p.at < 0) {
        p.s.y = p.y0 + Math.sin(time * 0.004 + i) * this.cell * 0.05;
        p.glow.alpha = 0.75 + Math.sin(time * 0.006 + i) * 0.25;
      } else {
        // Picked up: pop up and fade out.
        const t = Math.min(1, (time - p.at) / 320);
        p.s.scale.set(p.base * (1 + t * 0.8));
        p.s.alpha = 1 - t;
        p.glow.alpha = 1 - t;
        p.s.y = p.y0 - t * this.cell * 0.4;
      }
    }
    for (const g of this.grips.values()) {
      const t = (time - g.at) / 380;
      if (t < 0 || t > 1.2) continue;
      // Snap in toward the ball, hold, then ease back with a little give.
      const k = t >= 1 ? 0 : t < 0.18 ? 1 - (1 - t / 0.18) ** 2 : Math.cos(((t - 0.18) / 0.82) * Math.PI * 1.5) * (1 - (t - 0.18) / 0.82);
      for (const st of g.studs) {
        st.s.position.set(st.x0 + (st.cx - st.x0) * 0.2 * k, st.y0 + (st.cy - st.y0) * 0.2 * k);
        st.s.scale.set((1 + 0.2 * Math.max(0, k)) / this.res);
      }
    }
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
    const has = (x: number, y: number) => {
      if (x < 0 || x >= w) return false;
      const t = stroke.painted.get(y * w + x);
      return t !== undefined && time >= t;
    };
    // Settled paint: tiles whose paint has finished flowing out to the edges.
    const isPainted = (x: number, y: number) => {
      const k = y * w + x;
      if (x < 0 || x >= w || k === stroke.startRound) return false;
      const t = stroke.painted.get(k);
      return t !== undefined && time >= t + SPREAD_MS;
    };
    // Painted tiles form one soft blob, like the floor itself: convex corners
    // are rounded and concave corners filleted wherever paint meets unpainted
    // floor (the floor mask already shapes the edges against walls).
    const r = cell * 0.4;
    for (const [k, t] of stroke.painted) {
      if (time < t) continue;
      const x = k % w;
      const y = Math.floor(k / w);
      const age = time - t;
      if (k === stroke.startRound) {
        const grow = Math.min(1, age / 200);
        g.circle((x + 0.53) * cell, (y + 0.55) * cell, half * (0.4 + 0.66 * (1 - (1 - grow) ** 3)));
        continue;
      }
      if (age >= SPREAD_MS) {
        roundedCell(g, x, y, cell, r, isPainted);
        continue;
      }
      // Fresh paint flows out from under the ball: a narrow wet stream that
      // swells sideways until it fills the tile, reaching into painted
      // neighbours along the stroke so the stream stays continuous.
      const f = age / SPREAD_MS;
      const e = 1 - (1 - f) ** 3;
      const wob = 1 + Math.sin(age * 0.045 + k * 1.7) * 0.05 * (1 - f);
      const hw = half * Math.min(1.02, (0.38 + 0.64 * e) * wob);
      const axis = stroke.axis?.get(k) ?? 2;
      const cx = (x + 0.5) * cell;
      const cy = (y + 0.5) * cell;
      const reach = r + 0.5;
      const L = axis !== 1 && has(x - 1, y) ? x * cell - reach : axis === 0 ? x * cell - 0.5 : cx - hw;
      const R = axis !== 1 && has(x + 1, y) ? (x + 1) * cell + reach : axis === 0 ? (x + 1) * cell + 0.5 : cx + hw;
      const T = axis !== 0 && has(x, y - 1) ? y * cell - reach : axis === 1 ? y * cell - 0.5 : cy - hw;
      const B = axis !== 0 && has(x, y + 1) ? (y + 1) * cell + reach : axis === 1 ? (y + 1) * cell + 0.5 : cy + hw;
      const x0 = axis === 1 ? cx - hw : L;
      const x1 = axis === 1 ? cx + hw : R;
      const y0 = axis === 0 ? cy - hw : T;
      const y1 = axis === 0 ? cy + hw : B;
      const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
      g.roundRect(x0, y0, x1 - x0, y1 - y0, rr);
    }
    for (let j = 0; j <= this.rows; j++)
      for (let i = 0; i <= w; i++) {
        const tl = isPainted(i - 1, j - 1);
        const tr = isPainted(i, j - 1);
        const bl = isPainted(i - 1, j);
        const br = isPainted(i, j);
        if (+tl + +tr + +bl + +br !== 3) continue;
        const ex = !tl || !bl ? i - 1 : i;
        const ey = !tl || !tr ? j - 1 : j;
        const px = i * cell;
        const py = j * cell;
        if (!this.isFloor(ex, ey)) {
          // The floor curves into this wall corner; paint the whole corner
          // and let the floor mask trim it to the exact curve.
          g.rect(ex < i ? px - half : px - 0.5, ey < j ? py - half : py - 0.5, half + 0.5, half + 0.5);
          continue;
        }
        const sx = ex < i ? -1 : 1;
        const sy = ey < j ? -1 : 1;
        g.moveTo(px - sx * 0.5, py - sy * 0.5)
          .lineTo(px + sx * r, py - sy * 0.5)
          .arcTo(px, py, px, py + sy * r, r)
          .lineTo(px - sx * 0.5, py + sy * r)
          .closePath();
      }
    for (const sh of stroke.shimmer ?? []) {
      const age = time - sh.t;
      if (age < 0 || age > 220) continue;
      const a = Math.sin((age / 220) * Math.PI);
      // Rounded only where the stroke ends, so the glint runs as one band.
      roundedCell(wet, sh.k % w, Math.floor(sh.k / w), cell, r, has);
      wet.fill({ color: 0xffffff, alpha: 0.26 * a });
    }
    if (stroke.active) {
      // The stream pouring out under the ball: a narrow rounded ribbon from
      // the start of this run to just ahead of the ball, which the tiles
      // behind it then swell out from.
      const { from, pos } = stroke.active;
      const ax = (from.x + 0.5) * cell;
      const ay = (from.y + 0.5) * cell;
      const bx = (pos.x + 0.5) * cell;
      const by = (pos.y + 0.5) * cell;
      const sx = Math.sign(bx - ax);
      const sy = Math.sign(by - ay);
      const hw = half * 0.4;
      const lead = cell * 0.18;
      const hx = bx + sx * lead;
      const hy = by + sy * lead;
      const x0 = Math.min(ax, hx) - hw;
      const y0 = Math.min(ay, hy) - hw;
      const x1 = Math.max(ax, hx) + hw;
      const y1 = Math.max(ay, hy) + hw;
      g.roundRect(x0, y0, x1 - x0, y1 - y0, hw);
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
      const fade = age < 200 ? 1 : Math.max(0, 1 - (age - 200) / 550);
      if (fade <= 0) continue;
      d.circle(dot.x, dot.y, dot.r * (0.6 + 0.4 * fade)).fill({ color: theme.paintLight, alpha: 0.85 * fade });
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
    const sp = this.trail;
    if (!from || alpha <= 0.01) {
      sp.visible = false;
      return;
    }
    const { cell } = this;
    const ax = (from.x + 0.5) * cell;
    const ay = (from.y + 0.5) * cell;
    const bx = (to.x + 0.5) * cell;
    const by = (to.y + 0.5) * cell;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 2) {
      sp.visible = false;
      return;
    }
    // A soft, feathered streak: transparent at the tail, a milky glow that
    // widens toward the ball. Drawn from one blurred texture.
    sp.visible = true;
    sp.position.set(bx, by);
    sp.rotation = Math.atan2(by - ay, bx - ax);
    sp.scale.set((len + cell * 0.3) / TRAIL_W, (cell * 1.05) / TRAIL_H);
    sp.alpha = alpha;
  }

  /** Diagonal light sweep across the painted floor (level complete). */
  drawSweep(progress: number, strength = 1) {
    const g = this.waveG;
    g.clear();
    if (progress <= 0 || progress >= 1) return;
    const W = this.boardWidth;
    const H = this.boardHeight;
    const band = this.cell * 2.2;
    const span = W + H + band * 2;
    const x = -H - band + span * progress;
    // A soft diagonal band of light: thin slices with a bell-shaped falloff
    // and a bright core, so it reads as a sheen rather than a stripe.
    const n = 14;
    const sw = band / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const a = Math.exp(-(((u - 0.5) / 0.22) ** 2)) * 0.42 + Math.exp(-(((u - 0.5) / 0.06) ** 2)) * 0.2;
      const x0 = x + i * sw;
      g.poly([x0, 0, x0 + sw + 0.5, 0, x0 + sw + 0.5 - H, H, x0 - H, H]).fill({ color: 0xffffff, alpha: a * strength });
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
      // Each chevron points the way the ball travels there (curves turn it).
      const ax = i === 0 ? dir.x : p.x - path[i - 1].x;
      const ay = i === 0 ? dir.y : p.y - path[i - 1].y;
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
