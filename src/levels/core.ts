// Grid rules shared by the game, the hint system and the level tools.
// A grid is rows of cells: 1 = wall, 0 = floor, 2 = stopper (floor that the
// ball halts on), 3-6 = curved corners that turn the ball 90 degrees, 7 = a
// saw blade (sliding into it is fatal). The ball slides until the next cell
// is a wall or it rolls onto a stopper, painting every floor cell it passes.

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

/**
 * Curved corner tiles, named by the corner the curve sits in (its two
 * closed sides). A ball entering through an open side follows the curve
 * out of the other open side: e.g. the top-left curve turns a ball moving
 * left to move down, and one moving up to move right.
 */
export const CURVE_TL = 3;
export const CURVE_TR = 4;
export const CURVE_BL = 5;
export const CURVE_BR = 6;
export const CURVES: Record<number, Partial<Record<Dir, Dir>>> = {
  [CURVE_TL]: { L: 'D', U: 'R' },
  [CURVE_TR]: { R: 'D', U: 'L' },
  [CURVE_BL]: { L: 'U', D: 'R' },
  [CURVE_BR]: { R: 'U', D: 'L' },
};
export const isCurve = (c: number | undefined) => c !== undefined && c >= CURVE_TL && c <= CURVE_BR;

/** A spinning saw in a notch of the wall: rolling into it ends the attempt. */
export const SAW = 7;

/** A linked pair of portals: roll into one, come out of the other. */
export const PORTAL_A = 8;
export const PORTAL_B = 9;
/** Arrow tiles send the ball on in the direction they point. */
export const ARROW_U = 10;
export const ARROW_D = 11;
export const ARROW_L = 12;
export const ARROW_R = 13;
export const ARROWS: Record<number, Dir> = { [ARROW_U]: 'U', [ARROW_D]: 'D', [ARROW_L]: 'L', [ARROW_R]: 'R' };
/** Collectibles lying on a tile: painting the tile picks them up. */
export const COIN = 14;
export const KEY = 15;
/**
 * An x3 tile: the first ball to roll over it splits in three. It rolls on,
 * and two more shoot out sideways from the tile (see splitDirs); from then
 * on every swipe moves every ball. Balls that stop on the same tile merge.
 */
export const MULT = 16;

/**
 * Where the ball that crosses an x3 tile at `path[i]` splits to: the two
 * directions square to the way it was rolling there.
 */
export function splitDirs(from: Point, path: Point[], i: number): Dir[] {
  const prev = i > 0 ? path[i - 1] : from;
  return path[i].x !== prev.x ? ['U', 'D'] : ['L', 'R'];
}
export const isPortal = (c: number | undefined) => c === PORTAL_A || c === PORTAL_B;
export const isArrow = (c: number | undefined) => c !== undefined && c >= ARROW_U && c <= ARROW_R;

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
  return c === 0 || c === STOPPER || isCurve(c) || (c !== undefined && c >= PORTAL_A && c <= MULT);
}

function findTile(grid: Grid, v: number): Point | null {
  for (let y = 0; y < grid.length; y++) {
    const x = grid[y].indexOf(v);
    if (x >= 0) return { x, y };
  }
  return null;
}

export interface SlideResult {
  end: Point;
  /** Cells passed through, in order (the last one is `end`). */
  path: Point[];
  /** Direction of travel when the ball stopped. */
  dir: Dir;
  /** Indices into `path` where a curve turned the ball. */
  turns: number[];
  /** The slide ends in a saw blade (the saw cell is not in `path`). */
  saw?: Point;
  /** Indices into `path` that the ball reached by teleporting. */
  jumps: number[];
}

export function slide(grid: Grid, from: Point, dir: Dir): SlideResult {
  let d = DIRS[dir];
  let x = from.x;
  let y = from.y;
  const path: Point[] = [];
  const turns: number[] = [];
  const jumps: number[] = [];
  // Curves, arrows and portals can form loops: stop if a state repeats.
  const seen = new Set<string>();
  const result = (saw?: Point): SlideResult => ({ end: { x, y }, path, dir, turns, jumps, saw });
  for (;;) {
    const nx = x + d.x;
    const ny = y + d.y;
    if (grid[ny]?.[nx] === SAW) return result({ x: nx, y: ny });
    if (!isFloor(grid, nx, ny)) break;
    const c = grid[ny][nx];
    const out = isCurve(c) ? CURVES[c][dir] : undefined;
    // A curve's closed sides act like walls.
    if (isCurve(c) && !out) break;
    x = nx;
    y = ny;
    path.push({ x, y });
    if (c === STOPPER) break;
    const k = `${x},${y},${dir}`;
    if (seen.has(k)) break;
    seen.add(k);
    if (out) {
      turns.push(path.length - 1);
      dir = out;
      d = DIRS[dir];
    } else if (isArrow(c) && ARROWS[c] !== dir) {
      turns.push(path.length - 1);
      dir = ARROWS[c];
      d = DIRS[dir];
    } else if (isPortal(c)) {
      const twin = findTile(grid, c === PORTAL_A ? PORTAL_B : PORTAL_A);
      if (twin) {
        x = twin.x;
        y = twin.y;
        path.push({ x, y });
        jumps.push(path.length - 1);
        seen.add(`${x},${y},${dir}`);
      }
    }
  }
  return result();
}

export function floorCount(grid: Grid): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c !== WALL && c !== SAW) n++;
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
      if (!r.path.length || r.saw) continue;
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
      if (c !== WALL && c !== SAW) index.set(y * w + x, index.size);
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
      if (!r.path.length || r.saw) continue;
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

/**
 * A move that heads for unpainted floor: the first swipe of the fewest
 * swipes from `start` to a slide that paints at least one new tile (never
 * into a saw). Following it again and again finishes any level that cannot
 * get stuck, and it is cheap on any board, so it backs up `solve` when that
 * search is too big. Null if no slide can paint anything new.
 */
export function nextPaintingMove(grid: Grid, start: Point, painted: Set<number>): Dir | null {
  const w = grid[0].length;
  const key = (p: Point) => p.y * w + p.x;
  const first = new Map<number, Dir | null>([[key(start), null]]);
  const queue: Point[] = [start];
  while (queue.length) {
    const p = queue.shift()!;
    for (const dir of DIR_LIST) {
      const r = slide(grid, p, dir);
      if (!r.path.length || r.saw) continue;
      const via = first.get(key(p)) ?? dir;
      if (r.path.some((c) => !painted.has(key(c)))) return via;
      if (!first.has(key(r.end))) {
        first.set(key(r.end), via);
        queue.push(r.end);
      }
    }
  }
  return null;
}

/**
 * Like `solve`, for levels with an x3 tile and for several balls at once:
 * `start` is the main ball, `extras` any others already split off, `used`
 * whether the x3 tile has split a ball yet. A swipe moves every ball; one
 * rolling into a saw ends the attempt (that swipe is never chosen).
 */
export function solveMulti(
  grid: Grid,
  start: Point,
  painted?: Iterable<number>,
  cap = 250000,
  extras: Point[] = [],
  used = false,
): Dir[] | null {
  const mult = findTile(grid, MULT);
  if ((!mult || used) && !extras.length) return solve(grid, start, painted, cap);
  const w = grid[0].length;
  const index = new Map<number, number>();
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c !== WALL && c !== SAW) index.set(y * w + x, index.size);
    }),
  );
  const full = (1n << BigInt(index.size)) - 1n;
  const bit = (cell: number) => 1n << BigInt(index.get(cell)!);
  const pt = (cell: number) => ({ x: cell % w, y: Math.floor(cell / w) });
  const multCell = mult ? mult.y * w + mult.x : -1;
  let mask = bit(start.y * w + start.x);
  for (const b of extras) mask |= bit(b.y * w + b.x);
  for (const c of painted ?? []) if (index.has(c)) mask |= bit(c);
  if (mask === full) return [];
  type Mv = { end: number; bits: bigint; saw: boolean; moved: boolean; split: Dir[] | null };
  const cache = new Map<number, Mv>();
  const move = (cell: number, di: number): Mv => {
    const ck = cell * 4 + di;
    const hit = cache.get(ck);
    if (hit) return hit;
    const from = pt(cell);
    const r = slide(grid, from, DIR_LIST[di]);
    let bits = 0n;
    for (const c of r.path) bits |= bit(c.y * w + c.x);
    const at = r.path.findIndex((c) => c.y * w + c.x === multCell);
    const mv = { end: r.end.y * w + r.end.x, bits, saw: !!r.saw, moved: r.path.length > 0, split: at >= 0 ? splitDirs(from, r.path, at) : null };
    cache.set(ck, mv);
    return mv;
  };
  const posOf: number[][] = [[start.y * w + start.x, ...extras.map((b) => b.y * w + b.x)]];
  const usedOf: boolean[] = [used];
  const maskOf: bigint[] = [mask];
  const parent: number[] = [-1];
  const via: Dir[] = ['U'];
  const keyOf = (pos: number[], u: boolean) => `${pos[0]}|${pos.slice(1).sort((a, b) => a - b).join(',')}|${u ? 1 : 0}`;
  const seen = new Map<bigint, Set<string>>([[mask, new Set([keyOf(posOf[0], used)])]]);
  let frontier = [0];
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      for (let di = 0; di < 4; di++) {
        let u = usedOf[i];
        let m = maskOf[i];
        const out: number[] = [];
        let dead = false;
        let any = false;
        for (const cell of posOf[i]) {
          const mv = move(cell, di);
          if (mv.saw) {
            dead = true;
            break;
          }
          any ||= mv.moved;
          m |= mv.bits;
          out.push(mv.end);
          if (!u && mv.split) {
            u = true;
            for (const sd of mv.split) {
              const sm = move(multCell, DIR_LIST.indexOf(sd));
              if (sm.saw) dead = true;
              m |= sm.bits;
              out.push(sm.end);
            }
          }
        }
        if (dead || !any) continue;
        // Balls stopping on the same tile merge (the main ball stays first).
        const pos = out.filter((c, j) => out.indexOf(c) === j);
        const key = keyOf(pos, u);
        let at = seen.get(m);
        if (at?.has(key)) continue;
        if (!at) seen.set(m, (at = new Set()));
        at.add(key);
        const j = posOf.length;
        posOf.push(pos);
        usedOf.push(u);
        maskOf.push(m);
        parent.push(i);
        via.push(DIR_LIST[di]);
        if (m === full) {
          const path: Dir[] = [];
          for (let k = j; parent[k] !== -1; k = parent[k]) path.push(via[k]);
          return path.reverse();
        }
        next.push(j);
        if (j > cap) return null;
      }
    }
    frontier = next;
  }
  return null;
}

/** Characters for curved corners in level text: a=TL, b=TR, c=BL, d=BR. */
export const CURVE_CHARS: Record<string, number> = {
  a: CURVE_TL,
  b: CURVE_TR,
  c: CURVE_BL,
  d: CURVE_BR,
  x: SAW,
  p: PORTAL_A,
  q: PORTAL_B,
  '^': ARROW_U,
  v: ARROW_D,
  '<': ARROW_L,
  '>': ARROW_R,
  $: COIN,
  k: KEY,
  m: MULT,
};

/**
 * Parse rows where '#' is wall, '.' floor, '*' a stopper, 'o' the start,
 * a-d curved corners, 'x' a saw, p/q portals, ^v<> arrows, '$' a coin,
 * 'k' a key and 'm' an x3 badge.
 */
export function parseLevel(rows: string[], extra: Partial<Level> = {}): Level {
  let start: Point | null = null;
  const grid = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'o') start = { x, y };
      return ch === '#' ? WALL : ch === '*' ? STOPPER : CURVE_CHARS[ch] ?? 0;
    }),
  );
  if (!start) throw new Error('level has no start');
  return { grid, start, ...extra };
}
