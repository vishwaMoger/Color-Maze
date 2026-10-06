// Vector drawing of rounded maze shapes onto 2D canvases. Used once per
// level build to bake the static board textures.

export type CellTest = (x: number, y: number) => boolean;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// The region between corner point P and a quarter circle of radius r whose
// centre lies inside the cell (sx, sy give the direction into the cell).
function cornerCap(ctx: CanvasRenderingContext2D, px: number, py: number, sx: number, sy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(px + sx * r, py);
  ctx.lineTo(px, py);
  ctx.lineTo(px, py + sy * r);
  ctx.arcTo(px, py, px + sx * r, py, r);
  ctx.closePath();
  ctx.fill();
}

/**
 * Fill the union of cells where `test` is true, with convex corners rounded
 * and concave corners filleted, so walls get soft capsule ends and single
 * wall blocks become round pillars.
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
  ctx.save();
  ctx.fillStyle = color;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (test(x, y)) ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);

  // Concave corners: fillet into the single empty cell of a 2x2 block.
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const tl = test(i - 1, j - 1);
      const tr = test(i, j - 1);
      const bl = test(i - 1, j);
      const br = test(i, j);
      const n = +tl + +tr + +bl + +br;
      if (n !== 3) continue;
      const px = ox + i * cell;
      const py = oy + j * cell;
      if (!tl) cornerCap(ctx, px, py, -1, -1, r);
      else if (!tr) cornerCap(ctx, px, py, 1, -1, r);
      else if (!bl) cornerCap(ctx, px, py, -1, 1, r);
      else cornerCap(ctx, px, py, 1, 1, r);
    }

  // Convex corners: cut the cap off the filled cell.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const tl = test(i - 1, j - 1);
      const tr = test(i, j - 1);
      const bl = test(i - 1, j);
      const br = test(i, j);
      const n = +tl + +tr + +bl + +br;
      const diagonal = n === 2 && tl === br;
      if (n !== 1 && !diagonal) continue;
      const px = ox + i * cell;
      const py = oy + j * cell;
      if (tl) cornerCap(ctx, px, py, -1, -1, r);
      if (tr) cornerCap(ctx, px, py, 1, -1, r);
      if (bl) cornerCap(ctx, px, py, -1, 1, r);
      if (br) cornerCap(ctx, px, py, 1, 1, r);
    }
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
