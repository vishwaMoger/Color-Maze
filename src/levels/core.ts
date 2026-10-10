// Grid rules shared by the game, the hint system and the level tools.
// A grid is rows of cells: 1 = wall, 0 = floor, 2 = stopper (floor that the
// ball halts on), 3-6 = curved corners that turn the ball 90 degrees, 7 = a
// saw blade (sliding into it is fatal), and the tiles listed below. The ball
// slides until the next cell is a wall or it rolls onto a stopper, painting
// every floor cell it passes.

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
/**
 * Spikes: a plate whose spikes rise and sink with every swipe. Rolling onto
 * raised spikes is fatal; the ball may rest on a plate (sunk spikes cannot
 * rise through it). SPIKE_A plates are down for the first swipe, SPIKE_B
 * plates up, and both flip after each swipe, so they always alternate.
 */
export const SPIKE_A = 17;
export const SPIKE_B = 18;
/**
 * A cracked tile: it holds the ball once. As soon as it is painted and the
 * ball has left it, it falls away into a hole, and rolling into the hole is
 * fatal. (Painted = crossed: the paint gun never shoots a cracked tile while
 * others remain.)
 */
export const CRACK = 19;
/**
 * A switch plate: every time a ball rolls onto it, every gate flips. GATE
 * tiles start closed (a barrier, like a wall) and GATE_OPEN tiles open.
 */
export const SWITCH = 20;
export const GATE = 21;
export const GATE_OPEN = 22;

export const isSpike = (c: number | undefined) => c === SPIKE_A || c === SPIKE_B;
export const isGate = (c: number | undefined) => c === GATE || c === GATE_OPEN;

/**
 * Is a spike plate raised for the next swipe? `swipes` is how many swipes
 * have been made on the level so far.
 */
export const spikeUp = (c: number | undefined, swipes: number) => (c === SPIKE_A ? swipes % 2 === 1 : c === SPIKE_B && swipes % 2 === 0);

/** Is a gate closed? `flip` is true after an odd number of switch presses. */
export const gateClosed = (c: number | undefined, flip: boolean) => (c === GATE ? !flip : c === GATE_OPEN && flip);

/** The state the moving tiles are in (what a slide depends on beyond the grid). */
export interface Dyn {
  /** Swipes made so far (spikes); null to leave spikes out (all down). */
  swipes: number | null;
  /** Gates flipped from their start (an odd number of switch presses). */
  flip: boolean;
  /** Is this cell (y * width + x) a hole now (a cracked tile already crossed)? */
  hole?: (cell: number) => boolean;
}

export const NO_DYN: Dyn = { swipes: 0, flip: false };

/** Which of the moving tiles a grid has (they make the solver track more). */
export function features(grid: Grid) {
  let spikes = false;
  let cracks = false;
  let gates = false;
  for (const row of grid)
    for (const c of row) {
      if (isSpike(c)) spikes = true;
      else if (c === CRACK) cracks = true;
      else if (c === SWITCH || isGate(c)) gates = true;
    }
  return { spikes, cracks, gates };
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
  return c === 0 || c === STOPPER || isCurve(c) || (c !== undefined && c >= PORTAL_A && c <= GATE_OPEN);
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
  /**
   * The slide ends on raised spikes or in a hole (that cell is not in
   * `path`): the ball rolls onto it and is lost.
   */
  trap?: { at: Point; kind: 'spike' | 'hole' };
  /** Indices into `path` that the ball reached by teleporting. */
  jumps: number[];
  /** Indices into `path` where the ball pressed a switch (the gates flip). */
  switches: number[];
  /** The gates' state once the slide is over. */
  flip: boolean;
}

/** The slide ends in the ball being lost (saw, spikes or a hole). */
export const isFatal = (r: SlideResult) => !!r.saw || !!r.trap;

export function slide(grid: Grid, from: Point, dir: Dir, dyn: Dyn = NO_DYN): SlideResult {
  const w = grid[0].length;
  let d = DIRS[dir];
  let x = from.x;
  let y = from.y;
  let flip = dyn.flip;
  const path: Point[] = [];
  const turns: number[] = [];
  const jumps: number[] = [];
  const switches: number[] = [];
  // Cracked tiles left behind in this very slide are holes from then on.
  const left = new Set<number>();
  if (grid[y][x] === CRACK) left.add(y * w + x);
  // Curves, arrows and portals can form loops: stop if a state repeats.
  const seen = new Set<string>();
  const result = (saw?: Point, trap?: SlideResult['trap']): SlideResult => ({ end: { x, y }, path, dir, turns, jumps, saw, trap, switches, flip });
  for (;;) {
    const nx = x + d.x;
    const ny = y + d.y;
    if (grid[ny]?.[nx] === SAW) return result({ x: nx, y: ny });
    if (!isFloor(grid, nx, ny)) break;
    const c = grid[ny][nx];
    if (gateClosed(c, flip)) break;
    const out = isCurve(c) ? CURVES[c][dir] : undefined;
    // A curve's closed sides act like walls.
    if (isCurve(c) && !out) break;
    const cell = ny * w + nx;
    if (dyn.swipes !== null && spikeUp(c, dyn.swipes)) return result(undefined, { at: { x: nx, y: ny }, kind: 'spike' });
    if (c === CRACK && (left.has(cell) || dyn.hole?.(cell))) return result(undefined, { at: { x: nx, y: ny }, kind: 'hole' });
    x = nx;
    y = ny;
    path.push({ x, y });
    if (c === CRACK) left.add(cell);
    if (c === SWITCH) {
      flip = !flip;
      switches.push(path.length - 1);
    }
    if (c === STOPPER) break;
    const k = `${x},${y},${dir},${flip}`;
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
        seen.add(`${x},${y},${dir},${flip}`);
      }
    }
  }
  return result();
}

/**
 * A slide as the solver sees it, worked out once per (cell, direction,
 * gate state): where it ends, which tiles it paints, and what could make it
 * fatal depending on the rest of the state (spike timing, holes).
 */
interface Move {
  dir: Dir;
  end: number;
  bits: bigint;
  /** Ends in a saw: never taken. */
  saw: boolean;
  /** Crosses spikes of each phase. */
  spikeA: boolean;
  spikeB: boolean;
  /** Cracked tiles it crosses (fatal if any is already a hole). */
  cracks: bigint;
  /** Crosses the same cracked tile twice (or comes back to its start one): fatal. */
  recross: boolean;
  /** Gates after the slide. */
  flip: boolean;
  moved: boolean;
  /** The cells passed over (y * width + x). */
  cells: number[];
}

/** Fatal for a ball setting off with this many swipes made and this paint? */
function fatal(m: Move, parity: number, mask: bigint): boolean {
  return m.saw || m.recross || (parity === 1 ? m.spikeA : m.spikeB) || (m.cracks & mask) !== 0n;
}

/** Floor cells indexed for bit masks, and the moves between them. */
function moveTable(grid: Grid) {
  const w = grid[0].length;
  const index = new Map<number, number>();
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c !== WALL && c !== SAW) index.set(y * w + x, index.size);
    }),
  );
  const bit = (cell: number) => 1n << BigInt(index.get(cell)!);
  const cache = new Map<number, Move>();
  const move = (cell: number, di: number, flip: boolean): Move => {
    const ck = (cell * 4 + di) * 2 + (flip ? 1 : 0);
    const hit = cache.get(ck);
    if (hit) return hit;
    const from = { x: cell % w, y: Math.floor(cell / w) };
    const dir = DIR_LIST[di];
    // Worked out with every spike down and no holes: those only decide
    // whether the slide is fatal, never where it goes.
    const r = slide(grid, from, dir, { swipes: null, flip });
    let bits = 0n;
    let cracks = 0n;
    let spikeA = false;
    let spikeB = false;
    let recross = false;
    const crossed = new Set<number>();
    if (grid[from.y][from.x] === CRACK) crossed.add(cell);
    for (const c of r.path) {
      const k = c.y * w + c.x;
      const v = grid[c.y][c.x];
      bits |= bit(k);
      if (v === SPIKE_A) spikeA = true;
      else if (v === SPIKE_B) spikeB = true;
      else if (v === CRACK) {
        if (crossed.has(k)) recross = true;
        crossed.add(k);
        cracks |= bit(k);
      }
    }
    // Back onto a cracked tile left earlier in this slide: the static pass
    // stops there (it is a hole by then).
    if (r.trap) recross = true;
    const mv: Move = { dir, end: r.end.y * w + r.end.x, bits, saw: !!r.saw, spikeA, spikeB, cracks, recross, flip: r.flip, moved: r.path.length > 0, cells: r.path.map((c) => c.y * w + c.x) };
    cache.set(ck, mv);
    return mv;
  };
  return { index, bit, move, w };
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

/**
 * Reachability over the board's states: where the ball can rest, with the
 * spikes' phase and the gates' state where the level has them. Cracked
 * tiles are left out here (they depend on the paint); a level with them can
 * always get stuck, so it is never `neverStuck`.
 */
export function analyze(grid: Grid, start: Point): Analysis {
  const f = features(grid);
  const { move, w } = moveTable(grid);
  const P = f.spikes ? 2 : 1;
  const id = (cell: number, parity: number, flip: boolean) => (cell * P + parity) * 2 + (flip ? 1 : 0);
  const startId = id(start.y * w + start.x, 0, false);
  const reached = new Map<number, [number, number, boolean]>([[startId, [start.y * w + start.x, 0, false]]]);
  const cells = new Set([start.y * w + start.x]);
  const covered = new Set([start.y * w + start.x]);
  const reverse = new Map<number, number[]>();
  const queue = [startId];
  while (queue.length) {
    const from = queue.shift()!;
    const [cell, parity, flip] = reached.get(from)!;
    for (let di = 0; di < 4; di++) {
      const mv = move(cell, di, flip);
      if (!mv.moved || mv.saw || (P === 2 && (parity === 1 ? mv.spikeA : mv.spikeB))) continue;
      for (const c of mv.cells) covered.add(c);
      const np = P === 2 ? 1 - parity : 0;
      const to = id(mv.end, np, mv.flip);
      if (!reverse.has(to)) reverse.set(to, []);
      reverse.get(to)!.push(from);
      if (!reached.has(to)) {
        reached.set(to, [mv.end, np, mv.flip]);
        cells.add(mv.end);
        queue.push(to);
      }
    }
  }
  const back = new Set([startId]);
  const stack = [startId];
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
    stops: cells.size,
    neverStuck: !f.cracks && back.size === reached.size,
  };
}

/**
 * Shortest sequence of swipes that paints every floor cell from `start`
 * with `painted` already done and the moving tiles as in `dyn`.
 * Breadth-first over (position, spikes' phase, gates, painted set).
 * Returns null if unsolvable or the search exceeds `cap` states.
 */
export function solve(
  grid: Grid,
  start: Point,
  painted?: Iterable<number>,
  cap = 250000,
  dyn: Dyn = NO_DYN,
): Dir[] | null {
  const { index, bit, move, w } = moveTable(grid);
  const full = (1n << BigInt(index.size)) - 1n;
  let mask = bit(start.y * w + start.x);
  for (const c of painted ?? []) if (index.has(c)) mask |= bit(c);
  if (mask === full) return [];
  const spikes = features(grid).spikes;
  const parity0 = spikes ? (dyn.swipes ?? 0) % 2 : 0;

  // Breadth-first over (stop, phase, gates, painted set); parents kept in
  // flat arrays. A state's stop, phase and gates pack into one number.
  const pack = (cell: number, parity: number, flip: boolean) => (cell * 2 + parity) * 2 + (flip ? 1 : 0);
  const parent: number[] = [-1];
  const via: Dir[] = ['U'];
  const stateOf: number[] = [pack(start.y * w + start.x, parity0, dyn.flip)];
  const maskOf: bigint[] = [mask];
  const seen = new Map<bigint, Set<number>>([[mask, new Set([stateOf[0]])]]);
  let frontier = [0];
  const path = (i: number) => {
    const out: Dir[] = [];
    for (; parent[i] !== -1; i = parent[i]) out.push(via[i]);
    return out.reverse();
  };
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const st = stateOf[i];
      const flip = (st & 1) === 1;
      const parity = (st >> 1) & 1;
      const cell = st >> 2;
      for (let di = 0; di < 4; di++) {
        const mv = move(cell, di, flip);
        if (!mv.moved || fatal(mv, parity, maskOf[i])) continue;
        const m = maskOf[i] | mv.bits;
        const ns = pack(mv.end, spikes ? 1 - parity : 0, mv.flip);
        let at = seen.get(m);
        if (at?.has(ns)) continue;
        if (!at) seen.set(m, (at = new Set()));
        at.add(ns);
        const j = stateOf.length;
        parent.push(i);
        via.push(mv.dir);
        stateOf.push(ns);
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
 * a fatal one). Following it again and again finishes any level that cannot
 * get stuck, and it is cheap on any board, so it backs up `solve` when that
 * search is too big. Null if no slide can paint anything new.
 */
export function nextPaintingMove(grid: Grid, start: Point, painted: Set<number>, dyn: Dyn = NO_DYN): Dir | null {
  const { index, bit, move, w } = moveTable(grid);
  let mask = 0n;
  for (const c of painted) if (index.has(c)) mask |= bit(c);
  mask |= bit(start.y * w + start.x);
  const spikes = features(grid).spikes;
  const pack = (cell: number, parity: number, flip: boolean) => (cell * 2 + parity) * 2 + (flip ? 1 : 0);
  const s0 = pack(start.y * w + start.x, spikes ? (dyn.swipes ?? 0) % 2 : 0, dyn.flip);
  const first = new Map<number, Dir | null>([[s0, null]]);
  const queue = [s0];
  while (queue.length) {
    const st = queue.shift()!;
    const flip = (st & 1) === 1;
    const parity = (st >> 1) & 1;
    const cell = st >> 2;
    for (let di = 0; di < 4; di++) {
      const mv = move(cell, di, flip);
      // Holes are judged by the paint now (a cheap, safe approximation).
      if (!mv.moved || fatal(mv, parity, mask)) continue;
      const via = first.get(st) ?? mv.dir;
      if ((mv.bits & ~mask) !== 0n) return via;
      const ns = pack(mv.end, spikes ? 1 - parity : 0, mv.flip);
      if (!first.has(ns)) {
        first.set(ns, via);
        queue.push(ns);
      }
    }
  }
  return null;
}

/**
 * Like `solve`, for levels with an x3 tile and for several balls at once:
 * `start` is the main ball, `extras` any others already split off, `used`
 * whether the x3 tile has split a ball yet. A swipe moves every ball; one
 * rolling into a saw ends the attempt (that swipe is never chosen). (Levels
 * with x3 never have spikes, cracked tiles or gates.)
 */
export function solveMulti(
  grid: Grid,
  start: Point,
  painted?: Iterable<number>,
  cap = 250000,
  extras: Point[] = [],
  used = false,
  dyn: Dyn = NO_DYN,
): Dir[] | null {
  const mult = findTile(grid, MULT);
  if ((!mult || used) && !extras.length) return solve(grid, start, painted, cap, dyn);
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
  i: SPIKE_A,
  I: SPIKE_B,
  r: CRACK,
  w: SWITCH,
  g: GATE,
  G: GATE_OPEN,
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
 * 'k' a key, 'm' an x3 badge, i/I spikes (down/up first), 'r' a cracked
 * tile, 'w' a switch and g/G gates (closed/open at first).
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
