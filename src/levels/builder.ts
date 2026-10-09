// Level builder: searches many candidate mazes per level and keeps the best
// by gameplay and looks. Runs offline (scripts/build-levels.ts writes the
// curated set) and in the game, in a worker, for every level after that,
// so the levels never run out.
//
// Level kinds, mixed on a schedule so consecutive levels feel different:
//   - symmetric mazes (mirrored left/right, which reads as hand-designed)
//   - picture levels (a silhouette such as a heart or rocket that the paint
//     reveals), carved inside a pixel-art mask
//   - stopper rooms (open rooms where studded tiles are the puzzle)
//   - every level is impossible to get stuck in: from any stop the ball can
//     always get back, so whatever the player does it can still be finished
//   - bonus levels every 5th: wide and satisfying
import {
  analyze,
  ARROW_D,
  ARROW_L,
  ARROW_R,
  ARROW_U,
  COIN,
  CURVE_BL,
  CURVE_BR,
  CURVE_TL,
  CURVE_TR,
  DIR_LIST,
  DIRS,
  isCurve,
  isFloor,
  KEY,
  MULT,
  PORTAL_A,
  PORTAL_B,
  SAW,
  slide,
  solve,
  solveMulti,
  STOPPER,
  type Dir,
  type Grid,
  type Point,
} from './core.ts';
import { crop, mulberry32 } from './generator.ts';

type Mask = boolean[][];

const mask = (rows: string[]): Mask => rows.map((r) => [...r].map((c) => c === '#'));

// Pixel-art silhouettes ('#' inside). All left/right symmetric.
const PICTURES: { name: string; m: Mask }[] = [
  { name: 'Star', m: mask(['.....#.....', '....###....', '....###....', '###########', '.#########.', '..#######..', '..#######..', '.####.####.', '.###...###.', '.##.....##.']) },
  { name: 'House', m: mask(['....###....', '...#####...', '..#######..', '.#########.', '###########', '.#########.', '.#########.', '.####.####.', '.###...###.', '.###...###.']) },
  { name: 'Tree', m: mask(['....###....', '...#####...', '..#######..', '...#####...', '..#######..', '.#########.', '..#######..', '###########', '....###....', '....###....']) },
  { name: 'Mushroom', m: mask(['...#####...', '.#########.', '###########', '###########', '###########', '...#####...', '...#####...', '...#####...', '..#######..']) },
  { name: 'Rocket', m: mask(['....#....', '...###...', '..#####..', '..#####..', '..#####..', '..#####..', '..#####..', '.#######.', '#########', '###.#.###', '##..#..##']) },
  { name: 'Trophy', m: mask(['###########', '###########', '.#########.', '.#########.', '..#######..', '...#####...', '....###....', '....###....', '..#######..', '..#######..']) },
  { name: 'Diamond', m: mask(['..#######..', '.#########.', '###########', '###########', '.#########.', '..#######..', '...#####...', '....###....', '.....#.....']) },
  { name: 'Bell', m: mask(['....###....', '...#####...', '..#######..', '.#########.', '.#########.', '.#########.', '.#########.', '###########', '###########', '....###....']) },
  { name: 'Cat', m: mask(['##.......##', '###.....###', '####...####', '###########', '###########', '###########', '###########', '.#########.', '..#######..', '...#####...']) },
  { name: 'Ghost', m: mask(['...#####...', '.#########.', '###########', '###########', '###########', '###########', '###########', '###########', '##.##.##.##', '#...#.#...#']) },
  { name: 'Castle', m: mask(['##.##.##.##', '###########', '###########', '.#########.', '.#########.', '.#########.', '.####.####.', '.###...###.', '.###...###.']) },
  { name: 'Robot', m: mask(['...#...#...', '...#####...', '.#########.', '.#########.', '###########', '.#########.', '.#########.', '..#######..', '..##...##..', '..##...##..']) },
];

// Board outlines for regular mazes, so silhouettes vary from level to level.
type Frame = (w: number, h: number) => Mask;
const FRAMES: { name: string; f: Frame }[] = [
  { name: 'Box', f: (w, h) => rectMask(w, h) },
  { name: 'Octagon', f: (w, h) => grid2(w, h, (x, y) => Math.min(x, w - 1 - x) + Math.min(y, h - 1 - y) >= 1) },
  { name: 'Cross', f: (w, h) => grid2(w, h, (x, y) => {
    const cx = Math.abs(x - (w - 1) / 2) <= w / 5;
    const cy = Math.abs(y - (h - 1) / 2) <= h / 5;
    return cx || cy || (Math.abs(x - (w - 1) / 2) <= w / 3 && Math.abs(y - (h - 1) / 2) <= h / 3);
  }) },
  { name: 'Diamond', f: (w, h) => grid2(w, h, (x, y) => Math.abs(x - (w - 1) / 2) / (w / 2) + Math.abs(y - (h - 1) / 2) / (h / 2) <= 1.12) },
  { name: 'Ring', f: (w, h) => grid2(w, h, (x, y) => !(Math.abs(x - (w - 1) / 2) < w / 6 && Math.abs(y - (h - 1) / 2) < h / 6)) },
  { name: 'Arch', f: (w, h) => grid2(w, h, (x, y) => !(y > h / 2 && Math.abs(x - (w - 1) / 2) < w / 5)) },
  { name: 'Hourglass', f: (w, h) => grid2(w, h, (x, y) => Math.abs(x - (w - 1) / 2) <= 1 + Math.abs(y - (h - 1) / 2) * (w / h)) },
  { name: 'Towers', f: (w, h) => grid2(w, h, (x, y) => y >= h / 3 || x < w / 3 || x >= w - w / 3) },
];


export interface Candidate {
  grid: Grid;
  start: Point;
  par: number;
  score: number;
  name: string;
}

/** Cells the ball can paint from `start` (over all reachable stops). */
function paintable(grid: Grid, start: Point): Set<number> {
  const w = grid[0].length;
  const seen = new Set<number>([start.y * w + start.x]);
  const painted = new Set<number>([start.y * w + start.x]);
  const queue: Point[] = [start];
  while (queue.length) {
    const p = queue.pop()!;
    for (const d of DIR_LIST) {
      const r = slide(grid, p, d);
      if (r.saw) continue;
      for (const c of r.path) painted.add(c.y * w + c.x);
      const k = r.end.y * w + r.end.x;
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(r.end);
      }
    }
  }
  return painted;
}

/**
 * Turn floor cells the ball can never paint into walls (with their mirror
 * twins) until everything left is paintable. Keeps picture outlines intact
 * wherever the ball can actually follow them.
 */
function prune(grid: Grid, start: Point, mirror: boolean): boolean {
  const w = grid[0].length;
  for (let round = 0; round < 60; round++) {
    const ok = paintable(grid, start);
    const bad: Point[] = [];
    grid.forEach((row, y) => row.forEach((v, x) => v !== 1 && !ok.has(y * w + x) && bad.push({ x, y })));
    if (!bad.length) return true;
    // Remove one cell at a time: removals change what is reachable.
    const b = bad[Math.floor((round * 7919) % bad.length)];
    grid[b.y][b.x] = 1;
    if (mirror) grid[b.y][w - 1 - b.x] = 1;
    if (grid[start.y][start.x] === 1) return false;
  }
  return false;
}

/**
 * Turn some corridor corners (floor with walls on two adjacent sides) into
 * curved corners that swing the ball round. Mirrored levels stay mirrored.
 */
function addCurves(rng: () => number, grid: Grid, start: Point, mirror: boolean, share: number): number {
  const h = grid.length;
  const w = grid[0].length;
  const wall = (x: number, y: number) => (grid[y]?.[x] ?? 1) === 1;
  const kindAt = (x: number, y: number): number => {
    if (grid[y][x] !== 0 || (x === start.x && y === start.y)) return 0;
    const u = wall(x, y - 1), d = wall(x, y + 1), l = wall(x - 1, y), r = wall(x + 1, y);
    if (+u + +d + +l + +r !== 2) return 0;
    if (u && l) return CURVE_TL;
    if (u && r) return CURVE_TR;
    if (d && l) return CURVE_BL;
    if (d && r) return CURVE_BR;
    return 0;
  };
  const twin: Record<number, number> = { [CURVE_TL]: CURVE_TR, [CURVE_TR]: CURVE_TL, [CURVE_BL]: CURVE_BR, [CURVE_BR]: CURVE_BL };
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < (mirror ? Math.ceil(w / 2) : w); x++) {
      const k = kindAt(x, y);
      if (!k || rng() > share) continue;
      grid[y][x] = k;
      n++;
      const mx = w - 1 - x;
      if (mirror && mx !== x && kindAt(mx, y) === twin[k]) {
        grid[y][mx] = twin[k];
        n++;
      }
    }
  return n;
}

/**
 * Put saw blades in wall notches at the end of straight corridors, where a
 * careless swipe runs into them. Returns how many saws were placed.
 */
function addSaws(rng: () => number, grid: Grid, mirror: boolean, count: number): number {
  const h = grid.length;
  const w = grid[0].length;
  const cands: Point[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < (mirror ? Math.ceil(w / 2) : w); x++) {
      if (grid[y][x] !== 1) continue;
      const nb = DIR_LIST.map((d) => DIRS[d]).filter((d) => isFloor(grid, x + d.x, y + d.y));
      if (nb.length !== 1) continue;
      const d = nb[0];
      // The floor cell next to the notch must sit on a straight run into it.
      if (!isFloor(grid, x + d.x * 2, y + d.y * 2)) continue;
      cands.push({ x, y });
    }
  let n = 0;
  for (let i = 0; i < count && cands.length; i++) {
    const c = cands.splice(Math.floor(rng() * cands.length), 1)[0];
    grid[c.y][c.x] = SAW;
    n++;
    const mx = w - 1 - c.x;
    if (mirror && mx !== c.x && grid[c.y][mx] === 1) {
      grid[c.y][mx] = SAW;
      n++;
    }
  }
  return n;
}

/** True when some reachable stop has a swipe that runs into a saw. */
function sawIsLive(grid: Grid, start: Point): boolean {
  const w = grid[0].length;
  const seen = new Set([start.y * w + start.x]);
  const queue = [start];
  while (queue.length) {
    const p = queue.pop()!;
    for (const d of DIR_LIST) {
      const r = slide(grid, p, d);
      if (r.saw) return true;
      if (!r.path.length) continue;
      const k = r.end.y * w + r.end.x;
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(r.end);
      }
    }
  }
  return false;
}

/** Carve inside a mask by sliding a ball; optionally mirror left/right. */
function carve(rng: () => number, m: Mask, mirror: boolean, coverage: number, prefill?: Mask): { grid: Grid; start: Point } | null {
  const h = m.length;
  const w = m[0].length;
  const half = Math.ceil(w / 2);
  const grid: Grid = Array.from({ length: h + 2 }, () => new Array(w + 2).fill(1));
  const locked = grid.map((r) => r.map(() => false));
  const inside = (x: number, y: number) =>
    x >= 1 && y >= 1 && x <= w && y <= h && m[y - 1][x - 1] && (!mirror || x <= half);
  const cells: Point[] = [];
  for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) if (inside(x, y)) cells.push({ x, y });
  if (!cells.length) return null;
  let carved = 0;
  if (prefill)
    for (let y = 1; y <= h; y++)
      for (let x = 1; x <= w; x++)
        if (prefill[y - 1][x - 1]) {
          grid[y][x] = 0;
          if (inside(x, y)) carved++;
        }
  const seeds = prefill ? cells.filter((c) => grid[c.y][c.x] === 0) : cells;
  let { x, y } = seeds[Math.floor(rng() * seeds.length)];
  const start = { x, y };
  if (grid[y][x] !== 0) carved++;
  grid[y][x] = 0;
  const target = Math.floor(cells.length * coverage);
  for (let guard = 0; carved < target && guard < 400; guard++) {
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
    const lx = cx + d.x;
    const ly = cy + d.y;
    if (lx >= 1 && ly >= 1 && lx <= w && ly <= h) locked[ly][lx] = true;
    x = cx;
    y = cy;
  }
  if (mirror) for (let yy = 1; yy <= h; yy++) for (let xx = 1; xx <= half; xx++) if (grid[yy][xx] === 0) grid[yy][w + 1 - xx] = 0;
  return { grid, start };
}

function rectMask(w: number, h: number): Mask {
  return Array.from({ length: h }, () => new Array(w).fill(true));
}
function grid2(w: number, h: number, f: (x: number, y: number) => boolean): Mask {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => f(x, y)));
}
/**
 * Cells of the mask with an outside cell among their 8 neighbours: the
 * silhouette's outline, connected through edges (so the ball can follow it
 * around diagonal staircases).
 */
function outline(m: Mask): Mask {
  const h = m.length;
  const w = m[0].length;
  const inM = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y][x];
  return grid2(w, h, (x, y) => {
    if (!m[y][x]) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!inM(x + dx, y + dy)) return true;
    return false;
  });
}

/** Looks: tidy density, few one-cell stubs, readable outline for pictures. */
function beauty(grid: Grid, m: Mask | null): number {
  const h = grid.length;
  const w = grid[0].length;
  let floor = 0;
  let stubs = 0;
  let blobs = 0;
  const f = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && grid[y][x] !== 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!f(x, y)) continue;
      floor++;
      const n = +f(x + 1, y) + +f(x - 1, y) + +f(x, y + 1) + +f(x, y - 1);
      if (n === 1) stubs++;
      if (f(x + 1, y) && f(x, y + 1) && f(x + 1, y + 1)) blobs++;
    }
  let junctions = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (f(x, y) && +f(x + 1, y) + +f(x - 1, y) + +f(x, y + 1) + +f(x, y - 1) >= 3) junctions++;
  // Turns make a maze feel twisty; long straight runs make combs.
  let turns = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!f(x, y)) continue;
      const hz = f(x + 1, y) || f(x - 1, y);
      const vt = f(x, y + 1) || f(x, y - 1);
      if (hz && vt) turns++;
    }
  let longRuns = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0, run = 0; x <= w; x++) {
      if (x < w && f(x, y)) run++;
      else {
        if (run > 6) longRuns += run - 6;
        run = 0;
      }
    }
  for (let x = 0; x < w; x++)
    for (let y = 0, run = 0; y <= h; y++) {
      if (y < h && f(x, y)) run++;
      else {
        if (run > 5) longRuns += run - 5;
        run = 0;
      }
    }
  let curveCount = 0;
  for (const row of grid) for (const v of row) if (isCurve(v)) curveCount++;
  // Mostly one-wide corridors; a few wider spots are fine, slabs are not.
  if (blobs > floor * 0.18) return -1e9;
  let score = Math.min(curveCount, 8) * 4 - stubs * 2.5 - blobs * 2.5 + Math.min(junctions, 14) * 2.5 + Math.min(turns, 24) * 1.2 - longRuns * 2.5;
  if (!m) score -= Math.abs(floor / ((w - 2) * (h - 2)) - 0.56) * 90;
  if (m) {
    // Picture: how much of the silhouette's edge is floor (the outline is
    // what makes the shape readable).
    let edge = 0;
    let hit = 0;
    const mh = m.length;
    const mw = m[0].length;
    const inM = (x: number, y: number) => x >= 0 && y >= 0 && x < mw && y < mh && m[y][x];
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < mw; x++) {
        if (!m[y][x]) continue;
        let border = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!inM(x + dx, y + dy)) border = true;
        if (!border) continue;
        edge++;
        if (grid[y + 1][x + 1] !== 1) hit++;
      }
    if (hit / edge < 0.85) return -1e9;
    score += (hit / edge) * 160;
  }
  return score;
}

/** Candidate search: returns the best scoring valid level. */
function search(
  seed: number,
  tries: number,
  make: (rng: () => number) => { grid: Grid; start: Point } | null,
  rule: { neverStuck: boolean; parMin: number; parMax: number; maxTiles: number; minTiles: number },
  m: Mask | null,
  name: string,
  /**
   * A level-seeded random preference among good candidates, so a shape that
   * comes back (a picture) gets a different maze each time rather than the
   * same best-scoring one.
   */
  variety = 0,
): Candidate | null {
  const rng = mulberry32(seed + salt * 0x9e3779b1);
  let best: Candidate | null = null;
  for (let i = 0; i < tries; i++) {
    const c = make(rng);
    if (!c) continue;
    if (c.grid[c.start.y][c.start.x] !== 0) continue;
    const a = analyze(c.grid, c.start);
    if (a.covered !== a.floor || a.floor > rule.maxTiles || a.floor < rule.minTiles) continue;
    if (rule.neverStuck && !a.neverStuck) continue;
    const b = beauty(c.grid, m) + (variety ? rng() * variety : 0);
    if (b < -1e8) continue;
    // Cheap pre-filter before the expensive solve.
    if (best && b + 60 < best.score) continue;
    const sol = solveMulti(c.grid, c.start, undefined, 200000);
    if (!sol) continue;
    const par = sol.length;
    const mid = (rule.parMin + rule.parMax) / 2;
    const inRange = par >= rule.parMin && par <= rule.parMax;
    const score = b + (inRange ? 60 : 0) - Math.abs(par - mid) * 3 + a.stops * 1.5;
    if (!best || score > best.score) {
      const cc = m ? { grid: c.grid, start: c.start } : crop(c.grid, c.start);
      best = { ...cc, par, score, name };
    }
  }
  return best;
}

/** Open room with stopper tiles; mirrored stoppers for a tidy look. */
function room(n: number, effort = 1): Candidate | null {
  const rng = mulberry32(n * 4409 + 77 + salt * 0x9e3779b1);
  const target = 9 + Math.min(9, Math.floor(n / 14));
  let best: Candidate | null = null;
  for (let attempt = 0; attempt < Math.max(200, Math.round(2500 * effort)); attempt++) {
    const w = 6 + Math.floor(rng() * 4);
    const h = 5 + Math.floor(rng() * 3);
    const grid: Grid = Array.from({ length: h + 2 }, (_, y) =>
      Array.from({ length: w + 2 }, (_, x) => (x === 0 || y === 0 || x === w + 1 || y === h + 1 ? 1 : 0)),
    );
    const pillars = Math.floor(rng() * 3);
    for (let i = 0; i < pillars; i++) {
      const px = 2 + Math.floor(rng() * (w - 2));
      const py = 2 + Math.floor(rng() * (h - 2));
      grid[py][px] = 1;
      grid[py][w + 1 - px] = 1;
    }
    const k = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < k; i++) {
      const x = 1 + Math.floor(rng() * w);
      const y = 1 + Math.floor(rng() * h);
      if (grid[y][x] === 0) grid[y][x] = STOPPER;
      if (grid[y][w + 1 - x] === 0) grid[y][w + 1 - x] = STOPPER;
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
    if (a.covered !== a.floor || !a.neverStuck) continue;
    const sol = solve(grid, start, undefined, 150000);
    if (!sol) continue;
    const score = -Math.abs(sol.length - target) * 4 + a.stops * 0.5 - pillars;
    if (!best || score > best.score) best = { grid, start, par: sol.length, score, name: 'Room' };
    if (attempt > 400 && best.score > -4) break;
  }
  return best;
}

// ------------------------------------------------------------------ new tiles

/** Two separate islands joined only by a pair of portals. */
function portalIslands(rng: () => number, w: number, h: number): { grid: Grid; start: Point } | null {
  const vertical = w >= h;
  const left: Mask = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (vertical ? x < Math.floor(w / 2) - 0 : y < Math.floor(h / 2))));
  const right: Mask = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (vertical ? x > Math.floor(w / 2) : y > Math.floor(h / 2))));
  const a = carve(rng, left, false, 0.6 + rng() * 0.15);
  const b = carve(rng, right, false, 0.6 + rng() * 0.15);
  if (!a || !b) return null;
  const grid: Grid = a.grid.map((row, y) => row.map((v, x) => (v === 0 || b.grid[y][x] === 0 ? 0 : 1)));
  const pick = (island: (x: number, y: number) => boolean, avoid?: Point) => {
    const cells: Point[] = [];
    grid.forEach((row, y) =>
      row.forEach((v, x) => {
        if (v !== 0 || !island(x - 1, y - 1) || (avoid && avoid.x === x && avoid.y === y)) return;
        const n = DIR_LIST.filter((d) => isFloor(grid, x + DIRS[d].x, y + DIRS[d].y)).length;
        if (n <= 2) cells.push({ x, y });
      }),
    );
    return cells.length ? cells[Math.floor(rng() * cells.length)] : null;
  };
  const inA = (x: number, y: number) => left[y]?.[x] ?? false;
  const inB = (x: number, y: number) => right[y]?.[x] ?? false;
  const pa = pick(inA, a.start);
  const pb = pick(inB);
  if (!pa || !pb) return null;
  grid[pa.y][pa.x] = PORTAL_A;
  grid[pb.y][pb.x] = PORTAL_B;
  return { grid, start: a.start };
}

/** Turn a few corridor tiles into arrows that push the ball onward. */
function addArrows(rng: () => number, grid: Grid, start: Point, count: number): number {
  const cells: { p: Point; dirs: Dir[] }[] = [];
  grid.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v !== 0 || (x === start.x && y === start.y)) return;
      const dirs = DIR_LIST.filter((d) => isFloor(grid, x + DIRS[d].x, y + DIRS[d].y));
      if (dirs.length >= 2) cells.push({ p: { x, y }, dirs });
    }),
  );
  const code: Record<Dir, number> = { U: ARROW_U, D: ARROW_D, L: ARROW_L, R: ARROW_R };
  let n = 0;
  for (let i = 0; i < count && cells.length; i++) {
    const c = cells.splice(Math.floor(rng() * cells.length), 1)[0];
    grid[c.p.y][c.p.x] = code[c.dirs[Math.floor(rng() * c.dirs.length)]];
    n++;
  }
  return n;
}

/**
 * Put an x3 tile where splitting pays off: on a plain tile with open floor
 * straight through it one way and at least one side open the other way, so
 * the ball rolls over it and the new balls shoot off down side lanes.
 */
function addSplit(rng: () => number, grid: Grid, start: Point): boolean {
  const open = (x: number, y: number) => isFloor(grid, x, y) && grid[y][x] !== STOPPER;
  const cells: Point[] = [];
  grid.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v !== 0 || (x === start.x && y === start.y)) return;
      const lr = open(x - 1, y) && open(x + 1, y);
      const ud = open(x, y - 1) && open(x, y + 1);
      const side = (lr && (open(x, y - 1) || open(x, y + 1))) || (ud && (open(x - 1, y) || open(x + 1, y)));
      if (side) cells.push({ x, y });
    }),
  );
  if (!cells.length) return false;
  const p = cells[Math.floor(rng() * cells.length)];
  grid[p.y][p.x] = MULT;
  return true;
}

/** Scatter a few coins (and sometimes a key) on plain floor tiles. */
function addPickups(rng: () => number, grid: Grid, start: Point, coins: number, key: boolean) {
  const cells: Point[] = [];
  grid.forEach((row, y) => row.forEach((v, x) => v === 0 && !(x === start.x && y === start.y) && cells.push({ x, y })));
  const take = () => (cells.length ? cells.splice(Math.floor(rng() * cells.length), 1)[0] : null);
  for (let i = 0; i < coins; i++) {
    const p = take();
    if (p) grid[p.y][p.x] = COIN;
  }
  if (key) {
    const p = take();
    if (p) grid[p.y][p.x] = KEY;
  }
}

// ------------------------------------------------------------------ schedule

export const FIRST_BUILT = 7; // levels 1-6 are handmade tutorials

/**
 * Search effort for endless levels built in the game. The search result
 * depends on the effort, so the worker and the on-the-spot fallback must use
 * this same value or players would get different mazes for the same level.
 */
export const ENDLESS_EFFORT = 0.5;

type Kind = 'bonus' | 'picture' | 'curves' | 'saws' | 'portals' | 'arrows' | 'split' | 'room' | 'maze';

/** Where each mechanic first appears: its own level, so it can be learnt. */
export const DEBUT: Record<'curves' | 'saws' | 'portals' | 'arrows' | 'split', number> = { curves: 16, saws: 23, portals: 32, arrows: 41, split: 47 };

/**
 * The kind of level n is. Every 5th is a bonus and every 7th a picture;
 * otherwise the level rotates through everything unlocked so far, so a
 * new mechanic keeps coming back and no two levels in a row are the same
 * kind.
 */
export function levelKind(n: number): Kind {
  if (n % 5 === 0) return 'bonus';
  for (const [k, at] of Object.entries(DEBUT)) if (n === at) return k as Kind;
  if (n % 7 === 3 || n === 9) return 'picture';
  const pool: Kind[] = ['maze'];
  if (n >= 8) pool.push('room');
  if (n >= DEBUT.curves) pool.push('curves');
  if (n >= DEBUT.saws) pool.push('saws');
  if (n >= DEBUT.portals) pool.push('portals');
  if (n >= DEBUT.arrows) pool.push('arrows');
  if (n >= DEBUT.split) pool.push('split');
  // Step through the pool by a stride coprime with its size: consecutive
  // levels never land on the same kind.
  const L = pool.length;
  const stride = L % 3 === 0 ? 5 : 3;
  let k = pool[(n * stride) % L];
  // Right after a debut, don't repeat the mechanic just introduced.
  const prevDebut = Object.entries(DEBUT).find(([, at]) => at === n - 1)?.[0];
  if (k === prevDebut) k = pool[(n * stride + 1) % L];
  return k;
}

const CHARS: Record<number, string> = {
  1: '#', 0: '.', [STOPPER]: '*', [SAW]: 'x', [PORTAL_A]: 'p', [PORTAL_B]: 'q',
  [ARROW_U]: '^', [ARROW_D]: 'v', [ARROW_L]: '<', [ARROW_R]: '>', [COIN]: '$', [KEY]: 'k', [MULT]: 'm',
};

/** Level text: name|bonus|par|rows. */
export function encodeLevel(c: Candidate, bonus: boolean): string {
  const rows = c.grid.map((row, y) =>
    row.map((v, x) => (x === c.start.x && y === c.start.y ? 'o' : isCurve(v) ? 'abcd'[v - CURVE_TL] : CHARS[v] ?? '.')).join(''),
  );
  return `${c.name}|${bonus ? 1 : 0}|${c.par}|${rows.join('/')}`;
}

/**
 * Build level n (deterministic: every player gets the same level).
 * `effort` scales the search; 1 is the offline quality, lower is faster.
 */
export function buildLevel(n: number, effort = 1, reroll = 0): { c: Candidate; bonus: boolean } {
  salt = reroll;
  try {
    return buildWith(n, effort);
  } finally {
    salt = 0;
  }
}

/**
 * Reroll number of the level being built: 0 normally; 1, 2, ... give the
 * same kind of level from fresh random choices (used when a build would
 * repeat a maze the player has already had; see list.ts).
 */
let salt = 0;

function buildWith(n: number, effort: number): { c: Candidate; bonus: boolean } {
  const tries = (k: number) => Math.max(60, Math.round(k * effort));
  // A picture or room only fits so many mazes: if rerolls keep landing on
  // ones already met, build a free-form maze instead.
  const planned = levelKind(n);
  const kind = salt >= 3 && (planned === 'picture' || planned === 'room') ? 'maze' : planned;
  const bonus = kind === 'bonus';
  const t = Math.min(1, (n - 6) / 90);
  const parMin = Math.round(6 + t * 9);
  // Never stuck, on every level (see analyze in core.ts).
  const rule = { neverStuck: true, parMin, parMax: parMin + 6, maxTiles: Math.round(40 + t * 34), minTiles: Math.round(26 + t * 18) };
  const w = 8 + Math.round(t * 3);
  const h = 9 + Math.round(t * 3);
  // Later on, special levels sometimes combine two mechanics.
  // From level 60 on, a growing share of special levels mix two mechanics.
  const combo = n >= 60 && mulberry32(n * 991)() < Math.min(0.6, 0.25 + (n - 60) / 300);
  let c: Candidate | null = null;
  if (kind === 'saws') {
    const frame = FRAMES[(n * 7) % FRAMES.length];
    for (let attempt = 0; attempt < 3 && !c; attempt++)
      c = search(n * 7177 + 5 + attempt, tries(3000), (rng) => {
        const mirror = rng() < 0.7;
        const g = carve(rng, frame.f(w, h), mirror, 0.55 + rng() * 0.15);
        if (!g) return null;
        if (!addSaws(rng, g.grid, mirror, 1 + (rng() < 0.4 ? 1 : 0))) return null;
        if (combo) addCurves(rng, g.grid, g.start, mirror, 0.3);
        return sawIsLive(g.grid, g.start) ? g : null;
      }, { ...rule, parMin: rule.parMin - 2 }, null, 'Saws');
  } else if (kind === 'curves') {
    const frame = n < 30 ? FRAMES[0] : FRAMES[(n * 3) % FRAMES.length];
    for (let attempt = 0; attempt < 3 && !c; attempt++)
      c = search(n * 31337 + 9 + attempt, tries(3500), (rng) => {
        const mirror = rng() < 0.75;
        const g = carve(rng, frame.f(w, h), mirror, 0.55 + rng() * 0.15);
        if (!g) return null;
        if (addCurves(rng, g.grid, g.start, true, 0.3 + rng() * 0.5) < 2) return null;
        if (combo && addSaws(rng, g.grid, mirror, 1) && !sawIsLive(g.grid, g.start)) return null;
        return g;
      }, { ...rule, parMin: n < 30 ? 4 : rule.parMin - 3, parMax: rule.parMax + 2 }, null, 'Curves');
  } else if (kind === 'portals') {
    for (let attempt = 0; attempt < 3 && !c; attempt++)
      c = search(n * 4241 + 3 + attempt, tries(3000), (rng) => {
        const g = portalIslands(rng, w + 1, h);
        if (g && combo) addCurves(rng, g.grid, g.start, false, 0.3);
        return g;
      }, { ...rule, parMin: rule.parMin - 3, parMax: rule.parMax + 3 }, null, 'Portals');
  } else if (kind === 'arrows') {
    const frame = FRAMES[(n * 11) % FRAMES.length];
    for (let attempt = 0; attempt < 6 && !c; attempt++)
      c = search(n * 6029 + 1 + attempt, tries(3000), (rng) => {
        const g = carve(rng, frame.f(w, h), rng() < 0.5, 0.55 + rng() * 0.15);
        if (!g) return null;
        if (addArrows(rng, g.grid, g.start, 2 + Math.floor(rng() * 3)) < 2) return null;
        if (combo && addSaws(rng, g.grid, false, 1) && !sawIsLive(g.grid, g.start)) return null;
        return g;
      }, { ...rule, parMin: rule.parMin - 3 }, null, 'Arrows');
  } else if (kind === 'split') {
    // x3: the ball splits in three. Never with saws, so the main ball alone
    // can always finish (balls never block one another).
    const frame = FRAMES[(n * 13) % FRAMES.length];
    for (let attempt = 0; attempt < 4 && !c; attempt++)
      c = search(n * 8363 + 7 + attempt, tries(2500), (rng) => {
        const g = carve(rng, frame.f(w, h), rng() < 0.6, 0.55 + rng() * 0.15);
        if (!g || !addSplit(rng, g.grid, g.start)) return null;
        if (combo) addCurves(rng, g.grid, g.start, false, 0.3);
        return g;
      }, { ...rule, parMin: rule.parMin - 4, parMax: rule.parMax + 1 }, null, 'Split');
  } else if (kind === 'picture') {
    const round = Math.floor(n / 7);
    const p = PICTURES[round % PICTURES.length];
    const ring = outline(p.m);
    // Each time a picture comes round again it gets a twist (some pictures
    // only fit a few mazes, so a plain repeat could be the same level):
    // curved corners, then an x3 split, then both.
    const again = Math.floor(round / PICTURES.length);
    const twist = again === 0 ? 0 : 1 + ((again - 1) % 3);
    const curves = twist === 1 || twist === 3;
    const split = (twist === 2 || twist === 3) && n >= DEBUT.split;
    c = search(n * 7919 + 13, tries(2500), (rng) => {
      const g = carve(rng, p.m, true, 0.35 + rng() * 0.3, ring);
      if (!g || !prune(g.grid, g.start, true)) return null;
      if (curves && addCurves(rng, g.grid, g.start, true, 0.4 + rng() * 0.4) < 2) return null;
      if (split && !addSplit(rng, g.grid, g.start)) return null;
      return g;
    }, { ...rule, parMin: rule.parMin - 2, parMax: rule.parMax + 4, maxTiles: 76 }, p.m, p.name, 150);
    if (c) c = { ...c, ...crop(c.grid, c.start) };
  } else if (kind === 'room') {
    c = room(n, effort);
  }
  if (!c) {
    // Sizes grow with the level; bonus boards are wide panoramas.
    const mw = bonus ? 9 + Math.round(t * 2) : 7 + Math.round(t * 4) - (n % 3 === 0 ? 1 : 0);
    const mh = bonus ? 7 + Math.round(t * 2) : 8 + Math.round(t * 4) + (n % 3 === 1 ? 1 : 0);
    const mirror = bonus || n % 6 !== 2;
    const pool = bonus ? FRAMES.filter((f) => ['Box', 'Octagon', 'Ring', 'Towers', 'Arch'].includes(f.name)) : FRAMES;
    // Bonus levels step through their frames (n * 5 would always pick the first).
    const frame = pool[(bonus ? Math.floor(n / 5) : n * 5) % pool.length];
    const m = n < 14 ? rectMask(mw, mh) : frame.f(mw, mh);
    c = search(n * 104729 + (bonus ? 7 : 1), tries(2200), (rng) => carve(rng, m, mirror, 0.55 + rng() * 0.15), rule, null, (mirror ? 'Sym ' : '') + (n < 14 ? 'Box' : frame.name));
    if (!c) c = search(n * 104729 + 3, tries(2200), (rng) => carve(rng, rectMask(mw, mh), mirror, 0.55 + rng() * 0.15), rule, null, (mirror ? 'Sym ' : '') + 'Box');
    if (!c) c = search(n * 104729 + 5, tries(3000), (rng) => carve(rng, rectMask(mw, mh), false, 0.55 + rng() * 0.15), { ...rule, minTiles: 20 }, null, 'Box');
  }
  if (!c) throw new Error(`level ${n}: no candidate`);
  // Coins on many levels, and now and then a key to pick up.
  const prng = mulberry32(n * 2654435761);
  if (n >= 8 && n % 3 !== 1) addPickups(prng, c.grid, c.start, 2 + Math.floor(prng() * 3), n >= 15 && n % 9 === 0);
  return { c, bonus };
}

