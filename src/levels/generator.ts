import type { Grid, Point } from './core.ts';

// Seeded PRNG so level N is the same maze for every player.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trim solid wall rows/columns, keeping a one-cell wall border. */
export function crop(grid: Grid, start: Point): { grid: Grid; start: Point } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c === 1) return;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }),
  );
  // Rebuild with a one-cell wall border, padding where content touches the
  // edge (saw notches can sit in the outer wall).
  const out: Grid = [];
  for (let y = minY - 1; y <= maxY + 1; y++) {
    const row: number[] = [];
    for (let x = minX - 1; x <= maxX + 1; x++) row.push(grid[y]?.[x] ?? 1);
    out.push(row);
  }
  return { grid: out, start: { x: start.x - minX + 1, y: start.y - minY + 1 } };
}

