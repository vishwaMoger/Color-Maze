// Art for the moving tiles: spike plates, cracked tiles and their holes, the
// switch and its gates. Each is painted once per board onto a canvas at the
// board's pixel density (crisp at any size) and animated as sprites by the
// board (see Board.ts). Sizes are in device pixels; `c` is one tile.
import { makeCanvas } from './shape.ts';

/** Amber shared by the switch and its gates, so they read as a pair. */
export const GATE_COLOR = 0xffb22e;

/** The spike plate's side, in tiles: the same on every tile. */
export const PLATE = 0.66;

/**
 * Where a plate's five spikes stand, in tiles from the plate's centre: like
 * the five on a die, evenly spaced.
 */
export const SPIKE_SPOTS: [number, number][] = [
  [-0.17, -0.17],
  [0.17, -0.17],
  [0, 0],
  [-0.17, 0.17],
  [0.17, 0.17],
];

/** Draw the plate's rounded outline (for fills, strokes and clips). */
function platePath(ctx: CanvasRenderingContext2D, c: number) {
  const s = c * PLATE;
  ctx.beginPath();
  ctx.roundRect((c - s) / 2, (c - s) / 2, s, s, c * 0.17);
}

/**
 * The steel plate spikes rise through, centred on a tile-sized canvas: a
 * soft drop shadow like the arrow pads', a brushed steel face with a lit
 * top edge, and five round holes with lit lower rims.
 */
export function spikePlate(c: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  const s = c * PLATE;
  const x0 = (c - s) / 2;
  // Shadow, as under the arrow pads.
  ctx.save();
  ctx.translate(0, c * 0.04);
  platePath(ctx, c);
  ctx.fillStyle = 'rgba(20,10,50,0.28)';
  ctx.fill();
  ctx.restore();
  // Face: cool steel, lighter at the top.
  const face = ctx.createLinearGradient(0, x0, 0, x0 + s);
  face.addColorStop(0, '#a49dc2');
  face.addColorStop(0.55, '#7f779f');
  face.addColorStop(1, '#655d86');
  platePath(ctx, c);
  ctx.fillStyle = face;
  ctx.fill();
  // A fine dark edge, and a lit bevel along the top.
  ctx.lineWidth = Math.max(1, c * 0.016);
  ctx.strokeStyle = 'rgba(35,20,70,0.55)';
  platePath(ctx, c);
  ctx.stroke();
  ctx.save();
  platePath(ctx, c);
  ctx.clip();
  ctx.lineWidth = Math.max(1, c * 0.03);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.roundRect(x0 + c * 0.012, x0 + c * 0.014, s - c * 0.024, s, c * 0.16);
  ctx.stroke();
  ctx.restore();
  // Holes.
  for (const [dx, dy] of SPIKE_SPOTS) {
    const x = c / 2 + dx * c;
    const y = c / 2 + dy * c;
    const hr = c * 0.068;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + hr * 0.24, hr * 1.12, hr * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(x, y - hr * 0.35, hr * 0.1, x, y, hr);
    g.addColorStop(0, '#0b0618');
    g.addColorStop(1, '#2a2142');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, hr, hr * 0.88, 0, 0, Math.PI * 2);
    ctx.fill();
    // A dim steel tip waiting in the dark: spikes are down there.
    const tip = ctx.createLinearGradient(x - hr * 0.5, 0, x + hr * 0.5, 0);
    tip.addColorStop(0, 'rgba(220,212,245,0.75)');
    tip.addColorStop(1, 'rgba(120,108,160,0.6)');
    ctx.fillStyle = tip;
    ctx.beginPath();
    ctx.moveTo(x, y - hr * 0.55);
    ctx.lineTo(x - hr * 0.42, y + hr * 0.42);
    ctx.lineTo(x + hr * 0.42, y + hr * 0.42);
    ctx.closePath();
    ctx.fill();
  }
  return cv;
}

/**
 * The plate's danger rim: a crisp red edge in a soft red glow, shown while
 * the spikes are up (the board fades it with them).
 */
export function spikeRim(c: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  ctx.save();
  ctx.shadowColor = 'rgba(255,50,80,0.9)';
  ctx.shadowBlur = c * 0.09;
  ctx.lineWidth = Math.max(1.5, c * 0.034);
  ctx.strokeStyle = '#ff4d6a';
  platePath(ctx, c);
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = Math.max(1, c * 0.012);
  ctx.strokeStyle = 'rgba(255,220,225,0.9)';
  platePath(ctx, c);
  ctx.stroke();
  return cv;
}

/**
 * One spike: a polished steel cone seen a little from the front, lit from
 * the upper left, its tip touched with red. Drawn standing on its base
 * (the sprite's anchor is the base centre, at 0.86 of its height).
 */
export function spikeCone(c: number): HTMLCanvasElement {
  const w = Math.ceil(c * 0.17);
  const h = Math.ceil(c * 0.3);
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d')!;
  const pad = Math.max(1, c * 0.01);
  const x0 = pad;
  const x1 = w - pad;
  const tipY = pad;
  const baseY = h * 0.86;
  const shape = () => {
    ctx.beginPath();
    ctx.moveTo(w / 2, tipY);
    ctx.quadraticCurveTo(w / 2 - (w / 2 - x0) * 0.55, baseY * 0.55, x0, baseY);
    ctx.ellipse(w / 2, baseY, (x1 - x0) / 2, (h - pad - baseY), 0, Math.PI, 0, true);
    ctx.quadraticCurveTo(w / 2 + (x1 - w / 2) * 0.55, baseY * 0.55, w / 2, tipY);
    ctx.closePath();
  };
  // Body: dark on the right, light on the left, a bright streak between.
  const body = ctx.createLinearGradient(x0, 0, x1, 0);
  body.addColorStop(0, '#c9c2e2');
  body.addColorStop(0.3, '#ffffff');
  body.addColorStop(0.45, '#e4dff4');
  body.addColorStop(1, '#5e5583');
  shape();
  ctx.fillStyle = body;
  ctx.fill();
  // Red towards the tip.
  ctx.save();
  shape();
  ctx.clip();
  const red = ctx.createLinearGradient(0, tipY, 0, h * 0.5);
  red.addColorStop(0, 'rgba(255,55,85,0.95)');
  red.addColorStop(1, 'rgba(255,55,85,0)');
  ctx.fillStyle = red;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  // A crisp, thin outline so it reads on the plate.
  ctx.lineWidth = Math.max(1, c * 0.01);
  ctx.strokeStyle = 'rgba(40,24,80,0.7)';
  shape();
  ctx.stroke();
  return cv;
}

/** A small soft dot, for glows (tinted by the sprite). */
export function softDot(r: number): HTMLCanvasElement {
  const s = Math.ceil(r * 2);
  const cv = makeCanvas(s, s);
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return cv;
}

/** A tiny deterministic random source (so a tile's cracks never change). */
function rand(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A cracked tile: a loose slab (its own bevel, set apart from the floor)
 * split by jagged cracks from an impact point, with a few chips. Drawn over
 * the paint, so a painted cracked tile still shows it is about to go.
 */
export function crackOverlay(c: number, seed: number, vis = 1): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  const rnd = rand(seed * 7919 + 17);
  const m = c * 0.06;
  const sh = c * vis - m * 2;
  // The slab: a touch lighter than the floor, set apart by a dark gap all
  // round and a lit top edge, so it reads as a loose piece.
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.roundRect(m, m, c - m * 2, sh, c * 0.1);
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, c * 0.04);
  ctx.strokeStyle = 'rgba(15,6,40,0.55)';
  ctx.beginPath();
  ctx.roundRect(m, m, c - m * 2, sh, c * 0.1);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, c * 0.018);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.moveTo(m + c * 0.1, m + c * 0.03);
  ctx.lineTo(c - m - c * 0.1, m + c * 0.03);
  ctx.stroke();
  // Cracks: from an off-centre impact point out to the edges, each one a
  // jagged line that thins as it goes, with a lit edge beside it.
  const ox = c * (0.42 + rnd() * 0.16);
  const oy = c * (0.4 + rnd() * 0.12) * vis;
  const arms = 5 + Math.floor(rnd() * 2);
  const lines: { pts: [number, number][]; w: number }[] = [];
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rnd() * 0.7;
    const len = c * (0.32 + rnd() * 0.2);
    const pts: [number, number][] = [[ox, oy]];
    const steps = 4;
    for (let k = 1; k <= steps; k++) {
      const d = (len * k) / steps;
      const j = (rnd() - 0.5) * c * 0.09;
      pts.push([ox + Math.cos(a) * d - Math.sin(a) * j, oy + Math.sin(a) * d + Math.cos(a) * j]);
    }
    lines.push({ pts, w: c * (0.06 + rnd() * 0.02) });
    // A branch off some arms.
    if (rnd() < 0.55) {
      const [bx, by] = pts[2];
      const b = a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.4);
      const bl = c * (0.1 + rnd() * 0.1);
      lines.push({ pts: [[bx, by], [bx + Math.cos(b) * bl * 0.5 + (rnd() - 0.5) * c * 0.03, by + Math.sin(b) * bl * 0.5], [bx + Math.cos(b) * bl, by + Math.sin(b) * bl]], w: c * 0.035 });
    }
  }
  const stroke = (dy: number, color: string, scale: number) => {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const l of lines) {
      for (let k = 1; k < l.pts.length; k++) {
        ctx.lineWidth = Math.max(1, l.w * scale * (1 - (k - 1) / l.pts.length) + c * 0.006);
        ctx.beginPath();
        ctx.moveTo(l.pts[k - 1][0], l.pts[k - 1][1] + dy);
        ctx.lineTo(l.pts[k][0], l.pts[k][1] + dy);
        ctx.stroke();
      }
    }
  };
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(m, m, c - m * 2, sh, c * 0.1);
  ctx.clip();
  stroke(c * 0.018, 'rgba(255,255,255,0.35)', 0.9);
  stroke(0, 'rgba(14,6,34,0.92)', 1);
  // The impact point: a small crushed spot.
  const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, c * 0.09);
  g.addColorStop(0, 'rgba(18,8,40,0.7)');
  g.addColorStop(1, 'rgba(18,8,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ox, oy, c * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Chips knocked off the slab's corners.
  for (let i = 0; i < 2; i++) {
    const cx = rnd() < 0.5 ? m + c * 0.05 : c - m - c * 0.05;
    const cy = rnd() < 0.5 ? m + c * 0.05 : m + sh - c * 0.05;
    ctx.fillStyle = 'rgba(18,8,40,0.55)';
    ctx.beginPath();
    ctx.moveTo(cx - c * 0.04, cy);
    ctx.lineTo(cx, cy - c * 0.035);
    ctx.lineTo(cx + c * 0.04, cy + c * 0.01);
    ctx.lineTo(cx + c * 0.005, cy + c * 0.04);
    ctx.closePath();
    ctx.fill();
  }
  return cv;
}

/**
 * The hole a cracked tile leaves: a dark pit seen from above and in front,
 * its far inner wall catching a little light and its near rim lit.
 */
export function holeTexture(c: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  const m = c * 0.04;
  const s = c - m * 2;
  const r = c * 0.12;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(m, m, s, s, r);
  ctx.clip();
  const depth = ctx.createLinearGradient(0, m, 0, m + s);
  depth.addColorStop(0, '#3b2c63');
  depth.addColorStop(0.32, '#1c1236');
  depth.addColorStop(1, '#07030f');
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, c, c);
  // The far wall: a band at the top, its broken edge jagged.
  ctx.fillStyle = 'rgba(120,96,180,0.35)';
  ctx.beginPath();
  ctx.moveTo(m, m);
  ctx.lineTo(m + s, m);
  ctx.lineTo(m + s, m + c * 0.2);
  for (let i = 6; i >= 0; i--) ctx.lineTo(m + (s * i) / 6, m + c * (0.16 + ((i * 37) % 7) * 0.012));
  ctx.closePath();
  ctx.fill();
  // Darkness pooling at the bottom of the pit.
  const pool = ctx.createRadialGradient(c / 2, c * 0.72, 0, c / 2, c * 0.72, c * 0.5);
  pool.addColorStop(0, 'rgba(0,0,0,0.55)');
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, c, c);
  ctx.restore();
  // Rim: the floor's broken edge, lit along the near side.
  ctx.lineWidth = Math.max(1, c * 0.035);
  ctx.strokeStyle = 'rgba(10,4,25,0.6)';
  ctx.beginPath();
  ctx.roundRect(m, m, s, s, r);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, c * 0.02);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(m + r, m + s + c * 0.012);
  ctx.lineTo(m + s - r, m + s + c * 0.012);
  ctx.stroke();
  return cv;
}

/** A loose chunk of a slab (white, tinted with the paint or floor colour). */
export function chunkTexture(c: number): HTMLCanvasElement {
  const s = Math.ceil(c * 0.3);
  const cv = makeCanvas(s, s);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(s * 0.1, s * 0.3);
  ctx.lineTo(s * 0.55, s * 0.05);
  ctx.lineTo(s * 0.95, s * 0.4);
  ctx.lineTo(s * 0.7, s * 0.95);
  ctx.lineTo(s * 0.15, s * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(s * 0.95, s * 0.4);
  ctx.lineTo(s * 0.7, s * 0.95);
  ctx.lineTo(s * 0.15, s * 0.8);
  ctx.lineTo(s * 0.5, s * 0.6);
  ctx.closePath();
  ctx.fill();
  return cv;
}

/** The switch's housing: a dark round socket with a steel ring. */
export function switchBase(c: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  const x = c / 2;
  const y = c / 2;
  const r = c * 0.41;
  ctx.fillStyle = 'rgba(15,6,40,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + c * 0.04, r * 1.04, r * 0.98, 0, 0, Math.PI * 2);
  ctx.fill();
  const ring = ctx.createLinearGradient(0, y - r, 0, y + r);
  ring.addColorStop(0, '#e6e1f5');
  ring.addColorStop(1, '#6f6790');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.94, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1230';
  ctx.beginPath();
  ctx.ellipse(x, y + c * 0.008, r * 0.8, r * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

/**
 * The switch's button: a glossy amber dome with a white "flip" mark (two
 * arrows chasing round), drawn centred (anchor 0.5).
 */
export function switchCap(c: number): HTMLCanvasElement {
  const s = Math.ceil(c * 0.72);
  const cv = makeCanvas(s, s);
  const ctx = cv.getContext('2d')!;
  const x = s / 2;
  const y = s / 2 - s * 0.03;
  const r = s * 0.42;
  // Side, showing the button's height.
  ctx.fillStyle = '#c96a00';
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.06, r, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  const top = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.05, x, y, r);
  top.addColorStop(0, '#fff4c2');
  top.addColorStop(0.35, '#ffc23d');
  top.addColorStop(1, '#ff8a00');
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  // The mark: two curved arrows round the centre.
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.lineCap = 'round';
  const ar = r * 0.48;
  for (const k of [0, Math.PI]) {
    ctx.beginPath();
    ctx.arc(x, y, ar, k + 0.35, k + Math.PI - 0.55);
    ctx.stroke();
    const a = k + Math.PI - 0.55;
    const tx = x + Math.cos(a) * ar;
    const ty = y + Math.sin(a) * ar;
    const hs = s * 0.09;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(a + Math.PI / 2) * hs * 1.2, ty + Math.sin(a + Math.PI / 2) * hs * 1.2);
    ctx.lineTo(tx + Math.cos(a) * hs, ty + Math.sin(a) * hs);
    ctx.lineTo(tx - Math.cos(a) * hs, ty - Math.sin(a) * hs);
    ctx.closePath();
    ctx.fill();
  }
  // Gloss.
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y - r * 0.5, r * 0.32, r * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

/** The gate pad's side, in tiles (the arrow pads' size). */
export const GATE_PAD = 0.72;
/** Offsets of the gate's three bars from the pad's centre, in tiles. */
export const GATE_BARS = [-0.17, 0, 0.17];
/** How far in from the pad's edge each half-bar is anchored, in tiles. */
export const GATE_INSET = 0.05;

/**
 * A gate's pad, in the arrow pads' style: a soft translucent tile with a
 * drop shadow and a faint amber rim, and at both ends of each bar a dark
 * slot the bar slides back into when the gate opens. `across`: the bars
 * run up and down (the corridor runs left and right).
 */
export function gatePad(c: number, across: boolean): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  const s = c * GATE_PAD;
  const o = (c - s) / 2;
  const r = c * 0.2;
  ctx.fillStyle = 'rgba(20,10,50,0.25)';
  ctx.beginPath();
  ctx.roundRect(o, o + c * 0.04, s, s, r);
  ctx.fill();
  const pg = ctx.createLinearGradient(0, o, 0, o + s);
  pg.addColorStop(0, 'rgba(255,255,255,0.22)');
  pg.addColorStop(1, 'rgba(255,255,255,0.08)');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.roundRect(o, o, s, s, r);
  ctx.fill();
  ctx.lineWidth = Math.max(1, c * 0.018);
  ctx.strokeStyle = 'rgba(255,190,70,0.55)';
  ctx.beginPath();
  ctx.roundRect(o + c * 0.012, o + c * 0.012, s - c * 0.024, s - c * 0.024, r * 0.92);
  ctx.stroke();
  // Slots at each end of each bar.
  for (const b of GATE_BARS) {
    for (const end of [-1, 1]) {
      const along = c / 2 + end * (s / 2 - c * GATE_INSET - c * 0.02);
      const across0 = c / 2 + b * c;
      const [x, y] = across ? [across0, along] : [along, across0];
      const [w, h] = across ? [c * 0.1, c * 0.06] : [c * 0.06, c * 0.1];
      ctx.fillStyle = 'rgba(20,8,45,0.55)';
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
      ctx.fill();
    }
  }
  return cv;
}

/**
 * One half of a gate bar: a glowing amber rod with a rounded end, drawn
 * pointing right from its anchor (left end, middle). Two halves meet in
 * the middle of the pad when the gate is shut.
 */
export function gateHalfBar(c: number): HTMLCanvasElement {
  const len = c * (GATE_PAD / 2 - GATE_INSET);
  const t = c * 0.085;
  const glow = c * 0.06;
  const cv = makeCanvas(Math.ceil(len + glow * 2), Math.ceil(t + glow * 2));
  const ctx = cv.getContext('2d')!;
  const x0 = glow;
  const y0 = glow;
  ctx.save();
  ctx.shadowColor = 'rgba(255,170,40,0.95)';
  ctx.shadowBlur = glow;
  const g = ctx.createLinearGradient(0, y0, 0, y0 + t);
  g.addColorStop(0, '#fff3c4');
  g.addColorStop(0.45, '#ffc23d');
  g.addColorStop(1, '#f08a00');
  ctx.fillStyle = g;
  // Rounded where it leaves its slot, square where it meets its twin, so
  // the two halves join into one bar.
  ctx.beginPath();
  ctx.roundRect(x0, y0, len, t, [t / 2, 0, 0, t / 2]);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.roundRect(x0 + t * 0.3, y0 + t * 0.18, len - t * 0.3, t * 0.22, [t * 0.11, 0, 0, t * 0.11]);
  ctx.fill();
  return cv;
}
