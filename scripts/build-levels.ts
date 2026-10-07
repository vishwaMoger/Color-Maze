// Offline level builder: searches thousands of candidate mazes per level and
// keeps the best by gameplay and looks, then writes src/levels/data.ts.
//
// Level kinds, mixed on a schedule so consecutive levels feel different:
//   - symmetric mazes (mirrored left/right, which reads as hand-designed)
//   - picture levels (a silhouette such as a heart or rocket that the paint
//     reveals), carved inside a pixel-art mask
//   - stopper rooms (open rooms where studded tiles are the puzzle)
//   - bonus levels every 5th: wide, satisfying, impossible to get stuck in
//
// Usage: node --experimental-strip-types scripts/build-levels.ts [count]
import { writeFileSync } from 'node:fs';
import { analyze, DIR_LIST, DIRS, slide, solve, STOPPER, type Grid, type Point } from '../src/levels/core.ts';
import { crop, mulberry32 } from '../src/levels/generator.ts';

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


interface Candidate {
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
  // Mostly one-wide corridors; a few wider spots are fine, slabs are not.
  if (blobs > floor * 0.18) return -1e9;
  let score = -stubs * 2.5 - blobs * 2.5 + Math.min(junctions, 14) * 2.5 + Math.min(turns, 24) * 1.2 - longRuns * 2.5;
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
): Candidate | null {
  const rng = mulberry32(seed);
  let best: Candidate | null = null;
  for (let i = 0; i < tries; i++) {
    const c = make(rng);
    if (!c) continue;
    if (c.grid[c.start.y][c.start.x] !== 0) continue;
    const a = analyze(c.grid, c.start);
    if (a.covered !== a.floor || a.floor > rule.maxTiles || a.floor < rule.minTiles) continue;
    if (rule.neverStuck && !a.neverStuck) continue;
    const b = beauty(c.grid, m);
    if (b < -1e8) continue;
    // Cheap pre-filter before the expensive solve.
    if (best && b + 60 < best.score) continue;
    const sol = solve(c.grid, c.start, undefined, 200000);
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
function room(n: number): Candidate | null {
  const rng = mulberry32(n * 4409 + 77);
  const target = 9 + Math.min(9, Math.floor(n / 14));
  let best: Candidate | null = null;
  for (let attempt = 0; attempt < 2500; attempt++) {
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
    if (a.covered !== a.floor || (n < 40 && !a.neverStuck)) continue;
    const sol = solve(grid, start, undefined, 150000);
    if (!sol) continue;
    const score = -Math.abs(sol.length - target) * 4 + a.stops * 0.5 - pillars;
    if (!best || score > best.score) best = { grid, start, par: sol.length, score, name: 'Room' };
    if (attempt > 400 && best.score > -4) break;
  }
  return best;
}

// ------------------------------------------------------------------ schedule

if (process.env.DEBUG_PICS) {
  for (const p of PICTURES) {
    const ring = outline(p.m);
    const rng = mulberry32(99);
    let ok = 0, cov = 0, stuckOk = 0, solved = 0, readable = 0;
    for (let i = 0; i < 400; i++) {
      const c = carve(rng, p.m, true, 0.35 + rng() * 0.3, ring);
      if (!c || !prune(c.grid, c.start, true) || c.grid[c.start.y][c.start.x] !== 0) continue;
      ok++;
      const a = analyze(c.grid, c.start);
      if (a.covered !== a.floor) continue;
      cov++;
      if (a.neverStuck) stuckOk++;
      if (solve(c.grid, c.start, undefined, 100000)) solved++;
      if (beauty(c.grid, p.m) > -1e8) readable++;
    }
    console.log(p.name, { ok, cov, stuckOk, solved, readable });
  }
  process.exit(0);
}

const count = Number(process.argv[2] ?? 200);
const out: string[] = [];
const enc = (c: Candidate, bonus: boolean) => {
  const rows = c.grid.map((row, y) =>
    row.map((v, x) => (x === c.start.x && y === c.start.y ? 'o' : v === 1 ? '#' : v === STOPPER ? '*' : '.')).join(''),
  );
  return `${c.name}|${bonus ? 1 : 0}|${c.par}|${rows.join('/')}`;
};

const FIRST = 6; // handmade tutorial levels stay in list.ts
let pic = 0;
const t0 = Date.now();
for (let n = FIRST + 1; n <= count; n++) {
  const bonus = n % 5 === 0;
  const t = Math.min(1, (n - FIRST) / 90);
  const parMin = Math.round(6 + t * 9);
  const rule = { neverStuck: bonus || n < 30, parMin, parMax: parMin + 6, maxTiles: Math.round(40 + t * 34), minTiles: Math.round(26 + t * 18) };
  let c: Candidate | null = null;
  const isPicture = !bonus && (n % 7 === 3 || n === 9);
  const isRoom = !bonus && !isPicture && n >= 12 && n % 4 === 0;
  if (isPicture) {
    const p = PICTURES[pic++ % PICTURES.length];
    const ring = outline(p.m);
    c = search(n * 7919 + 13, 2500, (rng) => {
      const g = carve(rng, p.m, true, 0.35 + rng() * 0.3, ring);
      return g && prune(g.grid, g.start, true) ? g : null;
    }, { ...rule, parMin: rule.parMin - 2, parMax: rule.parMax + 4, maxTiles: 76 }, p.m, p.name);
    if (c) {
      const cc = crop(c.grid, c.start);
      c = { ...c, ...cc };
    }
  } else if (isRoom) {
    c = room(n);
  }
  if (!c) {
    // Sizes grow with the level; bonus boards are wide panoramas.
    const w = bonus ? 9 + Math.round(t * 2) : 7 + Math.round(t * 4) - (n % 3 === 0 ? 1 : 0);
    const h = bonus ? 7 + Math.round(t * 2) : 8 + Math.round(t * 4) + (n % 3 === 1 ? 1 : 0);
    const mirror = bonus || n % 6 !== 2;
    // Bonus boards are wide panoramas, so only sturdy outlines suit them.
    const pool = bonus ? FRAMES.filter((f) => ['Box', 'Octagon', 'Ring', 'Towers', 'Arch'].includes(f.name)) : FRAMES;
    const frame = pool[(n * 5) % pool.length];
    const m = n < 14 ? rectMask(w, h) : frame.f(w, h);
    c = search(n * 104729 + (bonus ? 7 : 1), 2200, (rng) => carve(rng, m, mirror, 0.55 + rng() * 0.15), rule, null, (mirror ? 'Sym ' : '') + (n < 14 ? 'Box' : frame.name));
    // A thin outline may not fit enough tiles: fall back to a box.
    if (!c) c = search(n * 104729 + 3, 2200, (rng) => carve(rng, rectMask(w, h), mirror, 0.55 + rng() * 0.15), rule, null, (mirror ? 'Sym ' : '') + 'Box');
    if (!c) c = search(n * 104729 + 5, 3000, (rng) => carve(rng, rectMask(w, h), false, 0.55 + rng() * 0.15), { ...rule, minTiles: 20 }, null, 'Box');
  }
  if (!c) throw new Error(`level ${n}: no candidate`);
  out.push(enc(c, bonus));
  const tiles = c.grid.flat().filter((v) => v !== 1).length;
  console.error(`${n} ${c.name} ${c.grid[0].length}x${c.grid.length} tiles=${tiles} par=${c.par} ${Date.now() - t0}ms`);
}

const body = `// Generated by scripts/build-levels.ts. Do not edit by hand.
// name|bonus|par|rows ('#' wall, '.' floor, '*' stopper, 'o' start)
export const LEVEL_DATA_FIRST = ${FIRST + 1};
export const LEVEL_DATA: string[] = ${JSON.stringify(out, null, 0).replace(/","/g, '",\n  "').replace('["', '[\n  "').replace('"]', '",\n]')};
`;
writeFileSync(new URL('../src/levels/data.ts', import.meta.url), body);
console.error(`wrote ${out.length} levels`);
