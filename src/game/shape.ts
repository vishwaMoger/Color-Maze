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

/**
 * Cheap, portable blur (no ctx.filter, which Safari lacks): repeated
 * downscale + bilinear upscale. `radius` is roughly the blur radius in px.
 */
export function softBlur(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const factor = Math.max(2, Math.round(radius / 1.5));
  const small = makeCanvas(src.width / factor, src.height / factor);
  const sctx = small.getContext('2d')!;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, small.width, small.height);
  // A second, smaller pass smooths the bilinear artefacts.
  const tiny = makeCanvas(small.width / 2, small.height / 2);
  const tctx = tiny.getContext('2d')!;
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(small, 0, 0, tiny.width, tiny.height);
  sctx.clearRect(0, 0, small.width, small.height);
  sctx.drawImage(tiny, 0, 0, small.width, small.height);
  const out = makeCanvas(src.width, src.height);
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(small, 0, 0, out.width, out.height);
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
