// Shop art rendered by the game's own renderer, cached as data URLs:
// paints as a glossy pour of liquid (with their pattern frozen in a nice
// moment) and boards as a real miniature of the in-game board.
import { Container, Graphics, Sprite, Texture, TilingSprite, type Renderer } from 'pixi.js';
import { parseLevel, type Point } from '../levels/core.ts';
import { Ball } from './Ball.ts';
import { Board } from './Board.ts';
import type { BallSkin, PaintColor } from './cosmetics.ts';
import { PATTERN_MODE } from './cosmetics.ts';
import { make } from './shaders.ts';
import { makeCanvas } from './shape.ts';
import type { Theme } from './themes.ts';
import { slabTexture } from './slabs.ts';

const cache = new Map<string, string>();

/** Cache keys, so callers can check for a ready image without rendering. */
export const paintKey = (p: PaintColor) => `paint:${p.id}`;
export const boardKey = (look: Theme, ball: BallSkin) => `board:${look.id}:${look.paint}:${look.paintMode ?? 0}:${ball.id}`;
/** A preview already rendered, or undefined (never renders). */
export const peekPreview = (key: string) => cache.get(key);

// A freshly poured puddle of paint seen from above: a soft dome in the
// middle with gentle folds where the pour coiled over itself, lit by a key
// light and a bright studio reflection. Pattern modes match the in-game
// paint shader: 1 marble, 2 slime, 3 lava, 4 water.
const PAINT_FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform vec3 uBase;
uniform vec3 uDark;
uniform vec3 uLight;
uniform vec3 uAlt;
uniform float uMode;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float cells(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float md = 9.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(i + g), hash(i + g + 17.0));
      vec2 r = g + o - f;
      md = min(md, dot(r, r));
    }
  return sqrt(md);
}
float height(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  vec2 c = p - vec2(0.08, -0.05);
  float rc = length(c);
  float dome = 0.3 * exp(-rc * rc * 1.6);
  // Soft folds where the pour coiled over itself, fading toward the edge.
  float spiral = (0.5 + 0.5 * sin(a + r * 9.0)) * 0.035 * smoothstep(1.2, 0.2, r) * smoothstep(0.05, 0.35, r);
  float ripple = (noise(p * 2.0 + 4.0) - 0.5) * 0.012;
  return dome + spiral + ripple;
}

void main(void) {
  vec2 q = vTextureCoord / (uOutputFrame.zw * uInputSize.zw);
  vec2 p = (q * 2.0 - 1.0) * 1.08;
  p.y = -p.y;
  float e = 0.02;
  float h = height(p);
  vec3 n = normalize(vec3(-(height(p + vec2(e, 0.0)) - h) / e, -(height(p + vec2(0.0, e)) - h) / e, 1.4));
  int mode = int(uMode + 0.5);

  vec3 col = mix(uDark, uBase, smoothstep(0.0, 0.22, h + 0.06));
  col = mix(col, uLight, smoothstep(0.24, 0.36, h) * 0.35);
  float glow = 0.0;
  if (mode == 1) {
    float v = abs(sin(p.x * 3.2 + p.y * 1.5 + fbm(p * 2.4) * 6.0));
    col = mix(col, uAlt, (1.0 - smoothstep(0.0, 0.16, v)) * 0.85);
  } else if (mode == 2) {
    float b = cells(p * 4.2 + 2.0);
    float bubble = 1.0 - smoothstep(0.18, 0.24, b);
    col = mix(col, uAlt, bubble * 0.7);
    col += vec3(1.0) * (smoothstep(0.12, 0.2, b) - smoothstep(0.2, 0.26, b)) * 0.25;
  } else if (mode == 3) {
    float c = cells(p * 3.4 + 1.0);
    float crack = 1.0 - smoothstep(0.02, 0.14, abs(c - 0.5) * 0.6 + fbm(p * 5.0) * 0.08);
    glow = crack;
    col = mix(uDark * 0.6, col, 0.55);
    col = mix(col, uAlt, crack);
  } else if (mode == 4) {
    float w = abs(sin(p.x * 7.0 + sin(p.y * 6.0) * 1.2)) * abs(sin(p.y * 7.0 + sin(p.x * 5.0) * 1.2));
    col = mix(col, uAlt, smoothstep(0.75, 0.98, 1.0 - w) * 0.7);  } else if (mode == 5) {
    // Potion: a dark swirling brew with glowing green bubbles, as in game.
    float sw = fbm(p * 1.6 + vec2(fbm(p * 1.2), fbm(p * 1.2 + 5.2)) * 2.2);
    col = mix(uDark * 0.75, mix(uBase, vec3(0.95, 0.5, 1.0), 0.3), smoothstep(0.3, 0.75, sw)) * (0.8 + 0.4 * smoothstep(0.0, 0.3, h));
    // Bubbles of mixed sizes, scattered (about half the cells have one).
    vec2 bp = p * 2.6 + 3.0;
    vec2 bid = floor(bp);
    vec2 bf = fract(bp) - 0.5;
    vec2 o = vec2(hash(bid), hash(bid + 17.0));
    float rad = hash(bid + 41.0) < 0.5 ? 0.0 : 0.07 + 0.2 * o.y * o.y;
    float d = length(bf - (o - 0.5) * 0.45);
    float body = 1.0 - smoothstep(rad - 0.04, rad, d);
    float rim = body * smoothstep(rad - 0.1, rad - 0.02, d);
    col = mix(col, col * 0.35 + uAlt * 0.55, body * 0.8);
    col += uAlt * rim * 0.7;
    glow = body * 0.5;
  }

  vec3 L = normalize(vec3(-0.5, 0.6, 0.75));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float diff = clamp((dot(n, L) + 0.4) / 1.4, 0.0, 1.0);
  float spec = pow(max(dot(n, H), 0.0), 90.0);
  float sheen = pow(max(dot(n, H), 0.0), 12.0);
  vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
  float box = smoothstep(0.93, 0.985, dot(R, normalize(vec3(-0.4, 0.5, 0.77))));
  vec3 lit = col * (0.6 + 0.55 * diff) + vec3(1.0) * (spec * 0.9 + sheen * 0.12 + box * 0.5);
  lit += uAlt * glow * 0.5;
  // Soft vignette toward the tile edge so the pour sits in its tile.
  float edge = max(abs(q.x - 0.5), abs(q.y - 0.5)) * 2.0;
  lit *= 1.0 - 0.18 * smoothstep(0.7, 1.0, edge);
  finalColor = vec4(clamp(lit, 0.0, 1.0), 1.0);
}`;

type PaintFilter = ReturnType<typeof paintFilter>;
const rgb = (n: number) => new Float32Array([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]);

function paintFilter(p: PaintColor) {
  return make<{ uBase: Float32Array; uDark: Float32Array; uLight: Float32Array; uAlt: Float32Array; uMode: number }>('paintPour', PAINT_FRAG, {
    uBase: { value: rgb(p.paint), type: 'vec3<f32>' },
    uDark: { value: rgb(p.dark), type: 'vec3<f32>' },
    uLight: { value: rgb(p.light), type: 'vec3<f32>' },
    uAlt: { value: rgb(p.alt ?? p.light), type: 'vec3<f32>' },
    uMode: { value: p.pattern ? PATTERN_MODE[p.pattern] : 0, type: 'f32' },
  });
}

function extract(renderer: Renderer, target: Container, resolution = 1): HTMLCanvasElement {
  return renderer.extract.canvas({ target, resolution, antialias: true }) as HTMLCanvasElement;
}

/** A paint as a glossy pour of liquid, for the shop. */
export function paintPreview(renderer: Renderer, p: PaintColor, size = 160): string {
  const id = paintKey(p);
  const hit = cache.get(id);
  if (hit) return hit;
  const s = new Sprite(Texture.WHITE);
  s.width = size;
  s.height = size;
  const f: PaintFilter = paintFilter(p);
  s.filters = [f];
  const holder = new Container();
  holder.addChild(s);
  const url = extract(renderer, holder).toDataURL('image/png');
  holder.destroy({ children: true });
  f.destroy();
  cache.set(id, url);
  return url;
}

// A small loop with a branch: enough walls to show the board's material,
// floor and paint, with the paint part of the way round.
const MINI = ['#######', '#o....#', '#.##..#', '#.#...#', '#.....#', '#######'];
const MINI_PAINTED: Point[] = [
  { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 },
  { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 },
];

/**
 * A board theme as a real miniature of the in-game board (same renderer,
 * same materials), half painted in the player's paint with their ball.
 */
export function boardPreview(renderer: Renderer, look: Theme, ball: BallSkin, size = 200): string {
  const id = boardKey(look, ball);
  const hit = cache.get(id);
  if (hit) return hit;
  const level = parseLevel(MINI);
  const cell = 24;
  const res = 2;
  const board = new Board(level, look, cell, res);
  const w = level.grid[0].length;
  const painted = new Map(MINI_PAINTED.map((p) => [p.y * w + p.x, 0]));
  board.update(10000, { painted, dots: [], splats: [] }, []);
  const b = new Ball(cell, res, ball);
  board.ballLayer.addChild(b);
  // The floor clip only works as the shadow's mask (drawn alone it would
  // cover the floor), as in game.
  b.clipShadow(board.floorClip);
  const at = board.cellCenter(3, 4);
  b.position.set(at.x, at.y);
  b.update(16, 10000, false, null, 0);
  // Shot over the theme's own page colour, so the board's soft shadows
  // blend as they do in game (a transparent extract darkens their edges),
  // framed square around the board with a little air.
  const side = Math.max(board.boardWidth, board.boardHeight) + cell * 0.9;
  const cx = board.boardWidth / 2;
  const cy = board.boardHeight / 2;
  const bg = new Graphics().rect(cx - side / 2, cy - side / 2, side, side).fill(look.bgTop);
  const frame = new Graphics().rect(cx - side / 2, cy - side / 2, side, side).fill(0xffffff);
  const holder = new Container();
  holder.addChild(bg);
  // Textured themes show their material (wood, terrazzo...) around it, at
  // the miniature's scale.
  if (look.slab) {
    const tiles = new TilingSprite({ texture: slabTexture(look.slab, res), width: side, height: side });
    tiles.position.set(cx - side / 2, cy - side / 2);
    // Same mapping as the board's lip (see Board.alignSlab), so they meet.
    tiles.tileScale.set(1 / res);
    tiles.tilePosition.set(-tiles.x, -tiles.y);
    holder.addChild(tiles);
  }
  holder.addChild(board, frame);
  board.mask = frame;
  board.alignSlab();
  const shot = extract(renderer, holder, res);
  board.mask = null;
  board.destroy();
  holder.destroy({ children: true });
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(shot, 0, 0, size, size);
  const url = c.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
