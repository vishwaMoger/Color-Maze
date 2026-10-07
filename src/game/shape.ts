// Vector drawing of rounded maze shapes onto 2D canvases. Used once per
// level build to bake the static board textures.

export type CellTest = (x: number, y: number) => boolean;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/**
 * Fill the union of cells where `test` is true, with convex corners rounded
 * and concave corners filleted, so walls get soft capsule ends and single
 * wall blocks become round pillars.
 *
 * Everything goes into one path and one fill, so there are no seams between
 * neighbouring cells and no anti-aliasing slivers left at rounded corners
 * (cutting corners out afterwards leaves hairlines at fractional DPRs).
 */
export function fillRoundedCells(
  ctx: CanvasRenderingContext2D,
  test: CellTest,
  cols: number,
  rows: number,
  cell: number,
  ox: number,
  oy: number,
  radius: number,
  color: string | CanvasGradient,
) {
  const r = Math.min(radius, cell / 2);
  // A corner of a filled cell is convex when, of the 2x2 block around that
  // corner, only this cell (or this cell and its diagonal) is filled.
  const convex = (x: number, y: number, dx: number, dy: number) => {
    const side1 = test(x + dx, y);
    const side2 = test(x, y + dy);
    return !side1 && !side2;
  };
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (!test(x, y)) continue;
      const x0 = ox + x * cell;
      const y0 = oy + y * cell;
      const x1 = x0 + cell;
      const y1 = y0 + cell;
      const tl = convex(x, y, -1, -1);
      const tr = convex(x, y, 1, -1);
      const br = convex(x, y, 1, 1);
      const bl = convex(x, y, -1, 1);
      ctx.moveTo(x0 + (tl ? r : 0), y0);
      ctx.lineTo(x1 - (tr ? r : 0), y0);
      if (tr) ctx.arcTo(x1, y0, x1, y0 + r, r);
      ctx.lineTo(x1, y1 - (br ? r : 0));
      if (br) ctx.arcTo(x1, y1, x1 - r, y1, r);
      ctx.lineTo(x0 + (bl ? r : 0), y1);
      if (bl) ctx.arcTo(x0, y1, x0, y1 - r, r);
      ctx.lineTo(x0, y0 + (tl ? r : 0));
      if (tl) ctx.arcTo(x0, y0, x0 + r, y0, r);
      ctx.closePath();
    }
  // Concave corners: fillet into the single empty cell of a 2x2 block.
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const tl = test(i - 1, j - 1);
      const tr = test(i, j - 1);
      const bl = test(i - 1, j);
      const br = test(i, j);
      if (+tl + +tr + +bl + +br !== 3) continue;
      const px = ox + i * cell;
      const py = oy + j * cell;
      const sx = !tl || !bl ? -1 : 1;
      const sy = !tl || !tr ? -1 : 1;
      // Same winding as the cells: P -> along x -> arc -> along y -> P.
      ctx.moveTo(px, py);
      ctx.lineTo(px + sx * r, py);
      ctx.arcTo(px, py, px, py + sy * r, r);
      ctx.lineTo(px, py + sy * r);
      ctx.closePath();
    }
  ctx.fill('nonzero');
  ctx.restore();
}

/** Grow a shape outward by `amount` px by stamping shifted copies. */
export function dilate(src: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext('2d')!;
  const steps = 24;
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    ctx.drawImage(src, Math.cos(a) * amount, Math.sin(a) * amount);
  }
  ctx.drawImage(src, 0, 0);
  return out;
}

let filterOk: boolean | null = null;
/** Whether 2D canvas filters (a GPU Gaussian blur) are available. */
function canFilter(): boolean {
  if (filterOk === null) {
    const ctx = makeCanvas(2, 2).getContext('2d') as CanvasRenderingContext2D & { filter?: string };
    filterOk = !!ctx && 'filter' in ctx && ((ctx.filter = 'blur(2px)'), ctx.filter === 'blur(2px)');
  }
  return filterOk;
}

/**
 * Smooth Gaussian blur. Uses the canvas's own blur filter where available
 * (GPU, true Gaussian, no fringes); otherwise halves the image step by step
 * and scales it back up step by step, which avoids the blockiness of a
 * single big downscale. `radius` is roughly the blur radius in px.
 */
export function softBlur(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = makeCanvas(src.width, src.height);
  const octx = out.getContext('2d')!;
  if (canFilter()) {
    // Blur a half-size copy (twice as fast, identical look at these radii).
    const half = makeCanvas(src.width / 2, src.height / 2);
    const hctx = half.getContext('2d')!;
    hctx.filter = `blur(${(radius / 2 / 1.6).toFixed(2)}px)`;
    hctx.drawImage(src, 0, 0, half.width, half.height);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(half, 0, 0, out.width, out.height);
    return out;
  }
  const steps = Math.max(1, Math.min(6, Math.round(Math.log2(Math.max(2, radius / 1.5)))));
  const chain: HTMLCanvasElement[] = [src];
  for (let i = 0; i < steps; i++) {
    const prev = chain[chain.length - 1];
    const c = makeCanvas(prev.width / 2, prev.height / 2);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(prev, 0, 0, c.width, c.height);
    chain.push(c);
  }
  let cur = chain[chain.length - 1];
  for (let i = chain.length - 2; i >= 1; i--) {
    const c = makeCanvas(chain[i].width, chain[i].height);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

/** Paint `color` everywhere `mask` is opaque. */
export function tint(mask: HTMLCanvasElement, color: string | CanvasGradient | CanvasPattern): HTMLCanvasElement {
  const out = makeCanvas(mask.width, mask.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

/** Small seeded random generator for repeatable textures. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Overlay a surface texture on `ctx` (drawn with source-atop so it only
 * lands on existing paint). `scale` is about one tile in px.
 */
export function texture(ctx: CanvasRenderingContext2D, kind: 'wood' | 'terrazzo', w: number, h: number, scale: number, dark: boolean) {
  const r = rng(kind === 'wood' ? 17 : 29);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  if (kind === 'wood') {
    // Long wavy grain lines with a few knots.
    const step = scale * 0.09;
    for (let y = -step; y < h + step; y += step * (0.6 + r() * 0.8)) {
      ctx.strokeStyle = dark ? `rgba(30, 10, 0, ${0.12 + r() * 0.18})` : `rgba(110, 50, 10, ${0.1 + r() * 0.16})`;
      ctx.lineWidth = Math.max(1, step * (0.2 + r() * 0.5));
      ctx.beginPath();
      const amp = step * (0.3 + r() * 0.8);
      const freq = (0.6 + r()) / scale;
      const ph = r() * 6;
      for (let x = 0; x <= w; x += Math.max(4, scale * 0.08)) {
        const yy = y + Math.sin(x * freq * 6.28 + ph) * amp + Math.sin(x * freq * 2.1 + ph * 2) * amp * 0.6;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (let i = 0; i < (w * h) / (scale * scale * 6); i++) {
      const x = r() * w;
      const y = r() * h;
      ctx.strokeStyle = dark ? 'rgba(25, 8, 0, 0.25)' : 'rgba(100, 45, 10, 0.25)';
      ctx.lineWidth = Math.max(1, scale * 0.02);
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath();
        ctx.ellipse(x, y, scale * 0.06 * k, scale * 0.025 * k, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  } else {
    // Terrazzo: scattered chips of grey, charcoal, sand and a touch of rose.
    const cols = dark ? ['#6c6764', '#2e2b2a', '#8a837d', '#5a5553'] : ['#9a948e', '#3d3a39', '#c9b9a5', '#d8b0b4', '#b8b2ac'];
    const n = (w * h) / (scale * scale) * 26;
    for (let i = 0; i < n; i++) {
      const x = r() * w;
      const y = r() * h;
      const s0 = scale * (0.015 + r() * r() * 0.07);
      ctx.fillStyle = cols[Math.floor(r() * cols.length)];
      ctx.globalAlpha = 0.55 + r() * 0.4;
      ctx.beginPath();
      const k = 5 + Math.floor(r() * 3);
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2;
        const rr = s0 * (0.6 + r() * 0.6);
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}
