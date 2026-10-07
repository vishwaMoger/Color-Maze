// Grid rules shared by the game, the hint system and the level tools.
// A grid is rows of cells: 1 = wall, 0 = floor, 2 = stopper (floor that the
// ball halts on). The ball slides until the next cell is a wall or it rolls
// onto a stopper, painting every floor cell it passes.

export type Grid = number[][];
export interface Point {
  x: number;
  y: number;
}
export type Dir = 'U' | 'D' | 'L' | 'R';

export const DIRS: Record<Dir, Point> = {
  U: { x: 0, y: -1 },
  D: { x: 0, y: 1 },
  L: { x: -1, y: 0 },
  R: { x: 1, y: 0 },
};
export const DIR_LIST: Dir[] = ['U', 'D', 'L', 'R'];

export const WALL = 1;
export const STOPPER = 2;

export interface Level {
  grid: Grid;
  start: Point;
  /** Optimal number of swipes, when known. */
  par?: number;
  name?: string;
  bonus?: boolean;
}

export function isFloor(grid: Grid, x: number, y: number): boolean {
  const c = grid[y]?.[x];
  return c === 0 || c === STOPPER;
}

export function slide(grid: Grid, from: Point, dir: Dir): { end: Point; path: Point[] } {
  const d = DIRS[dir];
  let x = from.x;
  let y = from.y;
  const path: Point[] = [];
  while (isFloor(grid, x + d.x, y + d.y)) {
    x += d.x;
    y += d.y;
    path.push({ x, y });
    if (grid[y][x] === STOPPER) break;
  }
  return { end: { x, y }, path };
}

export function floorCount(grid: Grid): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c !== WALL) n++;
  return n;
}

export interface Analysis {
  floor: number;
  covered: number;
  stops: number;
  /** Every reachable stop can get back to the start: impossible to get stuck. */
  neverStuck: boolean;
}

export function analyze(grid: Grid, start: Point): Analysis {
  const w = grid[0].length;
  const key = (p: Point) => p.y * w + p.x;
  const reached = new Set([key(start)]);
  const covered = new Set([key(start)]);
  const reverse = new Map<number, number[]>();
  const queue: Point[] = [start];
  while (queue.length) {
    const p = queue.shift()!;
    for (const dir of DIR_LIST) {
      const r = slide(grid, p, dir);
      if (!r.path.length) continue;
      for (const c of r.path) covered.add(key(c));
      const to = key(r.end);
      if (!reverse.has(to)) reverse.set(to, []);
      reverse.get(to)!.push(key(p));
      if (!reached.has(to)) {
        reached.add(to);
        queue.push(r.end);
      }
    }
  }
  const back = new Set([key(start)]);
  const stack = [key(start)];
  while (stack.length) {
    for (const prev of reverse.get(stack.pop()!) ?? []) {
      if (!back.has(prev)) {
        back.add(prev);
        stack.push(prev);
      }
    }
  }
  return {
    floor: floorCount(grid),
    covered: covered.size,
    stops: reached.size,
    neverStuck: back.size === reached.size,
  };
}

/**
 * Shortest sequence of swipes that paints every floor cell from `start`
 * with `painted` already done. Breadth-first over (position, painted set).
 * Returns null if unsolvable or the search exceeds `cap` states.
 */
export function solve(
  grid: Grid,
  start: Point,
  painted?: Iterable<number>,
  cap = 250000,
): Dir[] | null {
  const w = grid[0].length;
  const index = new Map<number, number>();
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c !== WALL) index.set(y * w + x, index.size);
    }),
  );
  const full = (1n << BigInt(index.size)) - 1n;
  const bit = (cell: number) => 1n << BigInt(index.get(cell)!);
  let mask = bit(start.y * w + start.x);
  for (const c of painted ?? []) if (index.has(c)) mask |= bit(c);
  if (mask === full) return [];

  // Precompute every slide once: from a stop, each direction leads to an
  // end cell and paints a fixed set of tiles.
  const moves = new Map<number, { dir: Dir; end: number; bits: bigint }[]>();
  const movesFrom = (cell: number) => {
    let list = moves.get(cell);
    if (list) return list;
    list = [];
    const p = { x: cell % w, y: Math.floor(cell / w) };
    for (const dir of DIR_LIST) {
      const r = slide(grid, p, dir);
      if (!r.path.length) continue;
      let bits = 0n;
      for (const c of r.path) bits |= bit(c.y * w + c.x);
      list.push({ dir, end: r.end.y * w + r.end.x, bits });
    }
    moves.set(cell, list);
    return list;
  };

  // Breadth-first over (stop, painted set); parents kept in flat arrays.
  const parent: number[] = [-1];
  const via: Dir[] = ['U'];
  const posOf: number[] = [start.y * w + start.x];
  const maskOf: bigint[] = [mask];
  const seen = new Map<bigint, Set<number>>([[mask, new Set([posOf[0]])]]);
  let frontier = [0];
  const path = (i: number) => {
    const out: Dir[] = [];
    for (; parent[i] !== -1; i = parent[i]) out.push(via[i]);
    return out.reverse();
  };
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const mv of movesFrom(posOf[i])) {
        const m = maskOf[i] | mv.bits;
        let at = seen.get(m);
        if (at?.has(mv.end)) continue;
        if (!at) seen.set(m, (at = new Set()));
        at.add(mv.end);
        const j = posOf.length;
        parent.push(i);
        via.push(mv.dir);
        posOf.push(mv.end);
        maskOf.push(m);
        if (m === full) return path(j);
        next.push(j);
        if (j > cap) return null;
      }
    }
    frontier = next;
  }
  return null;
}

/** Parse rows where '#' is wall, '.' floor, '*' a stopper and 'o' the start. */
export function parseLevel(rows: string[], extra: Partial<Level> = {}): Level {
  let start: Point | null = null;
  const grid = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'o') start = { x, y };
      return ch === '#' ? WALL : ch === '*' ? STOPPER : 0;
    }),
  );
  if (!start) throw new Error('level has no start');
  return { grid, start, ...extra };
}
