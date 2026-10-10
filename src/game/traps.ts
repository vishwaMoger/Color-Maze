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

/** Side of a cracked tile's slab and of the hole it leaves, in tiles. */
export const CRACK_PAD = 0.8;
const CRACK_R = 0.19;

function crackPadPath(ctx: CanvasRenderingContext2D, c: number, inset = 0) {
  const s = c * CRACK_PAD - inset * 2;
  ctx.beginPath();
  ctx.roundRect((c - s) / 2, (c - s) / 2, s, s, Math.max(1, c * CRACK_R - inset));
}

/**
 * A cracked tile: a loose stone slab in the arrow pads' style (soft drop
 * shadow, pale translucent face) split by engraved cracks from an impact
 * point, each a dark groove with a lit lower lip, with a couple of chips
 * knocked off its edge. Drawn over the paint, centred on a tile-sized
 * canvas, so a painted cracked tile still shows it is about to go.
 */
export function crackOverlay(c: number, seed: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  const rnd = rand(seed * 7919 + 17);
  const s = c * CRACK_PAD;
  const o = (c - s) / 2;
  // Shadow and face.
  ctx.save();
  ctx.translate(0, c * 0.035);
  crackPadPath(ctx, c);
  ctx.fillStyle = 'rgba(20,10,50,0.24)';
  ctx.fill();
  ctx.restore();
  const face = ctx.createLinearGradient(0, o, 0, o + s);
  face.addColorStop(0, 'rgba(255,255,255,0.24)');
  face.addColorStop(1, 'rgba(255,255,255,0.09)');
  crackPadPath(ctx, c);
  ctx.fillStyle = face;
  ctx.fill();
  // Arms of the crack: out from the impact point to the slab's edge, each
  // in three slightly bent steps; some with a short branch.
  const ox = c * (0.45 + rnd() * 0.1);
  const oy = c * (0.43 + rnd() * 0.1);
  const arms = 4 + Math.floor(rnd() * 2);
  const lines: { pts: [number, number][]; w: number }[] = [];
  const a0 = rnd() * Math.PI * 2;
  for (let i = 0; i < arms; i++) {
    const a = a0 + (i / arms) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
    const len = s * 0.62;
    const pts: [number, number][] = [[ox, oy]];
    for (let k = 1; k <= 3; k++) {
      const d = (len * k) / 3;
      const j = (rnd() - 0.5) * c * 0.07;
      pts.push([ox + Math.cos(a) * d - Math.sin(a) * j, oy + Math.sin(a) * d + Math.cos(a) * j]);
    }
    lines.push({ pts, w: c * 0.046 });
    if (rnd() < 0.5) {
      const [bx, by] = pts[1];
      const b = a + (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.3);
      const bl = c * (0.08 + rnd() * 0.06);
      lines.push({ pts: [[bx, by], [bx + Math.cos(b) * bl, by + Math.sin(b) * bl]], w: c * 0.028 });
    }
  }
  const groove = (dy: number, color: string, k: number) => {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const l of lines)
      for (let i = 1; i < l.pts.length; i++) {
        // Widest at the impact point, thinning out to the edges.
        ctx.lineWidth = Math.max(1, l.w * k * (1 - (i - 1) / (l.pts.length + 0.5)));
        ctx.beginPath();
        ctx.moveTo(l.pts[i - 1][0], l.pts[i - 1][1] + dy);
        ctx.lineTo(l.pts[i][0], l.pts[i][1] + dy);
        ctx.stroke();
      }
  };
  ctx.save();
  crackPadPath(ctx, c);
  ctx.clip();
  groove(c * 0.016, 'rgba(255,255,255,0.5)', 0.75);
  groove(0, 'rgba(28,12,60,0.95)', 1);
  // The impact point: a small crushed dent.
  const dent = ctx.createRadialGradient(ox, oy, 0, ox, oy, c * 0.075);
  dent.addColorStop(0, 'rgba(32,16,66,0.75)');
  dent.addColorStop(1, 'rgba(32,16,66,0)');
  ctx.fillStyle = dent;
  ctx.beginPath();
  ctx.arc(ox, oy, c * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Chips knocked off the slab's edge: small bites out of its rim.
  for (let i = 0; i < 2; i++) {
    const side = Math.floor(rnd() * 4);
    const t = 0.3 + rnd() * 0.4;
    const [x, y] = side === 0 ? [o + s * t, o] : side === 1 ? [o + s, o + s * t] : side === 2 ? [o + s * t, o + s] : [o, o + s * t];
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.ellipse(x, y, c * 0.035, c * 0.025, side % 2 ? Math.PI / 2 : 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Crisp rim: lit along the top, darker along the bottom.
  ctx.lineWidth = Math.max(1, c * 0.014);
  ctx.strokeStyle = 'rgba(30,16,64,0.45)';
  crackPadPath(ctx, c);
  ctx.stroke();
  ctx.save();
  crackPadPath(ctx, c);
  ctx.clip();
  ctx.lineWidth = Math.max(1, c * 0.026);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.roundRect(o + c * 0.01, o + c * 0.012, s - c * 0.02, s, c * CRACK_R);
  ctx.stroke();
  ctx.restore();
  return cv;
}

/**
 * The hole a cracked tile leaves: a rounded pit the slab's size, seen from
 * above and in front. Its far wall catches a little light and falls away
 * into the dark; the broken rim is lit along the near side.
 */
export function holeTexture(c: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  const s = c * CRACK_PAD;
  const o = (c - s) / 2;
  ctx.save();
  crackPadPath(ctx, c);
  ctx.clip();
  const depth = ctx.createLinearGradient(0, o, 0, o + s);
  depth.addColorStop(0, '#4a3880');
  depth.addColorStop(0.3, '#251845');
  depth.addColorStop(0.7, '#0e0820');
  depth.addColorStop(1, '#05020b');
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, c, c);
  // The far wall's lower edge: where it drops out of sight.
  const edge = ctx.createLinearGradient(0, o + s * 0.26, 0, o + s * 0.4);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, o + s * 0.26, c, s * 0.14);
  // Shade cast by the near rim onto the inside.
  const rim = ctx.createLinearGradient(0, o + s * 0.82, 0, o + s);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, o + s * 0.82, c, s * 0.18);
  ctx.restore();
  // Rim: a fine dark edge, lit along the near side.
  ctx.lineWidth = Math.max(1, c * 0.02);
  ctx.strokeStyle = 'rgba(12,5,30,0.7)';
  crackPadPath(ctx, c);
  ctx.stroke();
  ctx.save();
  crackPadPath(ctx, c);
  ctx.clip();
  ctx.lineWidth = Math.max(1, c * 0.024);
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.beginPath();
  ctx.roundRect(o + c * 0.01, o - s * 0.02, s - c * 0.02, s - c * 0.01, c * CRACK_R);
  ctx.stroke();
  ctx.restore();
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

/** A soft amber ring around the switch, so it reads as something to roll over. */
export function switchHalo(c: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(c / 2, c / 2, c * 0.3, c / 2, c / 2, c * 0.5);
  g.addColorStop(0, 'rgba(255,190,60,0)');
  g.addColorStop(0.35, 'rgba(255,190,60,0.55)');
  g.addColorStop(1, 'rgba(255,190,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c, c);
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
