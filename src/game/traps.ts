// Art for the moving tiles: spike plates, cracked tiles and their holes, the
// switch and its gates. Each is painted once per board onto a canvas at the
// board's pixel density (crisp at any size) and animated as sprites by the
// board (see Board.ts). Sizes are in device pixels; `c` is one tile.
import { makeCanvas } from './shape.ts';

/** Amber shared by the switch and its gates, so they read as a pair. */
export const GATE_COLOR = 0xffb22e;

/**
 * Spike holes on a plate, in tile units: five, like the dots on a die.
 * `vis` is how much of the tile shows (the board's near lip hides the
 * bottom of a tile on the near edge): the plate fits in what shows.
 */
export function spikeHoles(vis: number): [number, number][] {
  const y = (v: number) => 0.06 + (v - 0.06) * vis;
  return [
    [0.3, y(0.3)],
    [0.7, y(0.3)],
    [0.5, y(0.5)],
    [0.3, y(0.7)],
    [0.7, y(0.7)],
  ];
}

/** The steel plate spikes rise through: bevelled and bolted, with five dark holes. */
export function spikePlate(c: number, vis: number): HTMLCanvasElement {
  const cv = makeCanvas(Math.ceil(c), Math.ceil(c));
  const ctx = cv.getContext('2d')!;
  const m = c * 0.08;
  const w = c - m * 2;
  const h = c * vis - m * 2 + (vis < 1 ? c * 0.03 : 0);
  const r = c * 0.13;
  // Drop shadow, then the plate with a lit top edge and a dark lower edge.
  ctx.fillStyle = 'rgba(15,6,40,0.4)';
  ctx.beginPath();
  ctx.roundRect(m, m + c * 0.04, w, h, r);
  ctx.fill();
  const body = ctx.createLinearGradient(0, m, 0, m + h);
  body.addColorStop(0, '#7d7599');
  body.addColorStop(0.5, '#5c5479');
  body.addColorStop(1, '#3e3759');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(m, m, w, h, r);
  ctx.fill();
  // Hazard edge: a thin red-amber rim says "danger" at a glance.
  ctx.lineWidth = Math.max(1.5, c * 0.035);
  ctx.strokeStyle = 'rgba(255,92,92,0.75)';
  ctx.beginPath();
  ctx.roundRect(m + c * 0.03, m + c * 0.03, w - c * 0.06, h - c * 0.06, r * 0.75);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, c * 0.02);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.moveTo(m + r, m + c * 0.012);
  ctx.lineTo(m + w - r, m + c * 0.012);
  ctx.stroke();
  // Holes: dark, with a lit lower rim (seen from above and in front).
  for (const [hx, hy] of spikeHoles(vis)) {
    const x = hx * c;
    const y = hy * c;
    const hr = c * 0.085;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + hr * 0.22, hr * 1.1, hr * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(x, y - hr * 0.3, hr * 0.1, x, y, hr);
    g.addColorStop(0, '#05020c');
    g.addColorStop(1, '#221a36');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, hr, hr * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return cv;
}

/**
 * One spike: a polished steel cone, lit from the upper left, with a bright
 * tip. Drawn standing on its base (the sprite's anchor is the base centre).
 */
export function spikeCone(c: number): HTMLCanvasElement {
  const w = Math.ceil(c * 0.22);
  const h = Math.ceil(c * 0.36);
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d')!;
  const pad = Math.max(1, c * 0.012);
  const x0 = pad;
  const x1 = w - pad;
  const tip = { x: w / 2, y: pad };
  const base = h * 0.88;
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(x0, base);
    ctx.quadraticCurveTo(w / 2, h - pad, x1, base);
    ctx.closePath();
  };
  // Dark outline first, so the spike reads on any floor.
  ctx.lineJoin = 'round';
  ctx.lineWidth = pad * 2.2;
  ctx.strokeStyle = 'rgba(25,12,50,0.85)';
  outline();
  ctx.stroke();
  // Lit and shaded halves.
  const lit = ctx.createLinearGradient(x0, 0, w / 2, 0);
  lit.addColorStop(0, '#cfc8e6');
  lit.addColorStop(1, '#ffffff');
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(x0, base);
  ctx.quadraticCurveTo(w * 0.3, h - pad, w / 2, h - pad);
  ctx.closePath();
  ctx.fill();
  const dark = ctx.createLinearGradient(w / 2, 0, x1, 0);
  dark.addColorStop(0, '#9b93bd');
  dark.addColorStop(1, '#514873');
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(x1, base);
  ctx.quadraticCurveTo(w * 0.7, h - pad, w / 2, h - pad);
  ctx.closePath();
  ctx.fill();
  // Red at the tip: this hurts.
  const red = ctx.createLinearGradient(0, tip.y, 0, h * 0.42);
  red.addColorStop(0, 'rgba(255,60,80,0.95)');
  red.addColorStop(1, 'rgba(255,60,80,0)');
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(x0 + (x1 - x0) * 0.2, h * 0.45);
  ctx.lineTo(x0 + (x1 - x0) * 0.8, h * 0.45);
  ctx.closePath();
  ctx.fill();
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

/** A gate post: a short steel pillar with an amber emitter on top. */
export function gatePost(c: number): HTMLCanvasElement {
  const w = Math.ceil(c * 0.26);
  const h = Math.ceil(c * 0.4);
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d')!;
  const r = w * 0.4;
  const x = w / 2;
  const top = r + w * 0.05;
  const base = h - r * 0.9;
  // Pillar body.
  const body = ctx.createLinearGradient(x - r, 0, x + r, 0);
  body.addColorStop(0, '#6d6590');
  body.addColorStop(0.35, '#d3cdea');
  body.addColorStop(1, '#4b4468');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - r, top);
  ctx.lineTo(x - r, base);
  ctx.ellipse(x, base, r, r * 0.8, 0, Math.PI, 0, true);
  ctx.lineTo(x + r, top);
  ctx.closePath();
  ctx.fill();
  // Emitter cap.
  const cap = ctx.createRadialGradient(x - r * 0.3, top - r * 0.3, r * 0.1, x, top, r);
  cap.addColorStop(0, '#fff6d6');
  cap.addColorStop(0.5, '#ffbf3a');
  cap.addColorStop(1, '#e07800');
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.ellipse(x, top, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

/**
 * A gate's beam (white, tinted amber): a bright core inside a soft glow,
 * one tile long, drawn horizontally (the sprite turns it for a vertical
 * gate).
 */
export function gateBeam(c: number): HTMLCanvasElement {
  const w = Math.ceil(c);
  const h = Math.ceil(c * 0.3);
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d')!;
  const glow = ctx.createLinearGradient(0, 0, 0, h);
  glow.addColorStop(0, 'rgba(255,255,255,0)');
  glow.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.roundRect(0, h / 2 - h * 0.11, w, h * 0.22, h * 0.11);
  ctx.fill();
  return cv;
}
