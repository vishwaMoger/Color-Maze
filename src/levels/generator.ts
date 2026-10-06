import { analyze, DIR_LIST, DIRS, solve, STOPPER, type Grid, type Level, type Point } from './core.ts';

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

interface Spec {
  w: number;
  h: number;
  minPar: number;
  maxPar: number;
  neverStuck: boolean;
}

function specFor(level: number, bonus: boolean): Spec {
  const t = Math.min(level / 120, 1);
  const w = Math.round(6 + t * 4) + (bonus ? 2 : 0);
  const h = Math.round(8 + t * 5);
  const minPar = Math.round(5 + t * 9);
  return { w, h, minPar, maxPar: minPar + 8, neverStuck: bonus || level < 30 };
}

// Carve by sliding a ball around an all-wall grid. Each move locks the cell it
// stops against, so earlier slides stay valid and the carving route itself is
// a solution that paints every floor cell.
function carve(rng: () => number, spec: Spec): { grid: Grid; start: Point } {
  const { w, h } = spec;
  const grid: Grid = Array.from({ length: h + 2 }, () => new Array(w + 2).fill(1));
  const locked = grid.map((r) => r.map(() => false));
  const inside = (x: number, y: number) => x >= 1 && y >= 1 && x <= w && y <= h;
  let x = 1 + Math.floor(rng() * w);
  let y = 1 + Math.floor(rng() * h);
  const start = { x, y };
  grid[y][x] = 0;
  const target = Math.floor(w * h * (0.42 + rng() * 0.12));
  let carved = 1;
  for (let guard = 0; carved < target && guard < 300; guard++) {
    const d = DIRS[DIR_LIST[Math.floor(rng() * 4)]];
    let len = 1 + Math.floor(rng() * Math.max(w, h));
    let cx = x;
    let cy = y;
    for (;;) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!inside(nx, ny) || locked[ny][nx]) break;
      if (grid[ny][nx] === 1) {
        if (len <= 0) break;
        grid[ny][nx] = 0;
        carved++;
      }
      cx = nx;
      cy = ny;
      len--;
    }
    if (cx === x && cy === y) continue;
    if (inside(cx + d.x, cy + d.y)) locked[cy + d.y][cx + d.x] = true;
    x = cx;
    y = cy;
  }
  return { grid, start };
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
  return {
    grid: grid.slice(minY - 1, maxY + 2).map((row) => row.slice(minX - 1, maxX + 2)),
    start: { x: start.x - minX + 1, y: start.y - minY + 1 },
  };
}

/**
 * Open room with stopper tiles: without stoppers the ball could only run
 * along the edges, so their placement is the puzzle.
 */
function room(rng: () => number, n: number): Level | null {
  const w = 6 + Math.floor(rng() * 4);
  const h = 4 + Math.floor(rng() * 3);
  const target = 9 + Math.min(8, Math.floor(n / 15));
  for (let attempt = 0; attempt < 300; attempt++) {
    const grid: Grid = Array.from({ length: h + 2 }, (_, y) =>
      Array.from({ length: w + 2 }, (_, x) => (x === 0 || y === 0 || x === w + 1 || y === h + 1 ? 1 : 0)),
    );
    // A pillar or two sometimes, then stoppers, often mirrored for a tidy look.
    if (rng() < 0.4) grid[2 + Math.floor(rng() * (h - 2))][2 + Math.floor(rng() * (w - 2))] = 1;
    const k = 3 + Math.floor(rng() * 4);
    const mirror = rng() < 0.6;
    for (let i = 0; i < k; i++) {
      const x = 1 + Math.floor(rng() * w);
      const y = 1 + Math.floor(rng() * h);
      if (grid[y][x] === 0) grid[y][x] = STOPPER;
      if (mirror && grid[y][w + 1 - x] === 0) grid[y][w + 1 - x] = STOPPER;
    }
    const corners = [
      { x: 1, y: 1 },
      { x: w, y: 1 },
      { x: 1, y: h },
      { x: w, y: h },
    ];
    const start = corners[Math.floor(rng() * 4)];
    if (grid[start.y][start.x] !== 0) continue;
    const a = analyze(grid, start);
    if (a.covered !== a.floor || (n < 40 && !a.neverStuck)) continue;
    const sol = solve(grid, start, undefined, 80000);
    if (!sol || sol.length < target - 3 || sol.length > target + 6) continue;
    return { grid, start, par: sol.length, name: 'Room' };
  }
  return null;
}

/** Generate level `n` (1-based). Deterministic. */
export function generateLevel(n: number, bonus = false): Level {
  // Every fourth regular level from 12 on is an open room with stoppers.
  if (!bonus && n >= 12 && n % 4 === 0) {
    const r = room(mulberry32(n * 4409 + 77), n);
    if (r) return r;
  }
  const spec = specFor(n, bonus);
  const rng = mulberry32(n * 7919 + (bonus ? 104729 : 1013));
  let best: { level: Level; score: number } | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const { grid, start } = carve(rng, spec);
    const a = analyze(grid, start);
    if (a.covered !== a.floor) continue;
    if (spec.neverStuck && !a.neverStuck) continue;
    const sol = solve(grid, start, undefined, 60000);
    if (!sol) continue;
    const par = sol.length;
    const inRange = par >= spec.minPar && par <= spec.maxPar;
    const score = (inRange ? 100 : 0) - Math.abs(par - (spec.minPar + spec.maxPar) / 2) + a.stops * 0.5;
    if (!best || score > best.score) {
      const c = crop(grid, start);
      best = { level: { ...c, par, bonus }, score };
    }
    if (inRange && attempt > 20) break;
  }
  if (!best) throw new Error(`could not generate level ${n}`);
  return best.level;
}
