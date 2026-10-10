import { COIN, KEY, parseLevel, solve, type Level } from './core.ts';
import { LEVEL_DATA, LEVEL_DATA_FIRST } from './data.ts';
import { buildLevel, ENDLESS_EFFORT, encodeLevel } from './builder.ts';
import { crop, mulberry32 } from './generator.ts';
import { REROLLS } from './rerolls.ts';

// Hand-picked opening levels. '#' wall, '.' floor, 'o' start.
// Every 5th level is a bonus level. No level can ever get stuck: from any
// position the ball can still finish it.
const HANDMADE: Level[] = [
  parseLevel(['#######', '#.###.#', '#.###.#', '#.###.#', '#o....#', '#######'], { name: 'U-turn' }),
  parseLevel(['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#o....#', '#######'], { name: 'Ring' }),
  parseLevel(
    ['#########', '#.......#', '#.#####.#', '#.#...#.#', '#.#.#.#.#', '#...#o..#', '#########'],
    { name: 'Spiral' },
  ),
  parseLevel(
    [
      '##########',
      '#........#',
      '#.#####..#',
      '#.###...o#',
      '#.###.#..#',
      '#.###....#',
      '#.#.....##',
      '#.##.....#',
      '#.##.##..#',
      '#........#',
      '##########',
    ],
    { name: 'Puzzle' },
  ),
  parseLevel(
    [
      '#################',
      '#...............#',
      '#.#############.#',
      '#.#############.#',
      '#o...##########.#',
      '##..............#',
      '#...###########.#',
      '#...............#',
      '#################',
    ],
    { name: 'Panorama', bonus: true },
  ),
];

// Introduces stoppers: the ball halts on the studded tiles.
HANDMADE.push(
  parseLevel(['##########', '#.*.*.*..#', '#........#', '#........#', '#o.*.*.*.#', '##########'], {
    name: 'Stoppers',
  }),
);

// Levels placed by hand at a given number (none at present: every level
// must be impossible to get stuck in, which the earlier picture levels here
// were not).
const SPECIAL = new Map<number, Level>();

const cache = new Map<number, Level>();

function decode(text: string): Level {
  const [name, bonus, par, rows] = text.split('|');
  return parseLevel(rows.split('/'), { name, bonus: bonus === '1', par: Number(par) });
}

const encodeOf = (n: number, reroll = REROLLS[n] ?? 0) => {
  const { c, bonus } = buildLevel(n, ENDLESS_EFFORT, reroll);
  return encodeLevel(c, bonus);
};

// Built levels are remembered on this device so they never rebuild.
// v3: levels are now built so they can never get stuck; older stored
// ones could.
const STORE = 'colormaze.lv3.';
const built = new Map<number, string>();
function readStored(n: number): string | null {
  try {
    return localStorage.getItem(STORE + n);
  } catch {
    return null;
  }
}
function store(n: number, text: string) {
  built.set(n, text);
  try {
    localStorage.setItem(STORE + n, text);
    localStorage.removeItem(STORE + (n - 6));
  } catch {
    /* storage full or blocked: the level is simply rebuilt next time */
  }
}

/** True when level n comes from the curated set or the handmade ones. */
export function isCurated(n: number): boolean {
  return n - LEVEL_DATA_FIRST < LEVEL_DATA.length || n <= HANDMADE.length || SPECIAL.has(n);
}

/** Has level n already been built (in this session or on this device)? */
export function hasBuilt(n: number): boolean {
  return built.has(n) || readStored(n) !== null;
}

/** Hand a level built in the background to the level list. */
export function putBuilt(n: number, text: string) {
  store(n, text);
}

/** Level n (1-based): handmade first, then generated forever. */
export function getLevel(n: number): Level {
  const cached = cache.get(n);
  if (cached) return cached;
  let level: Level;
  const special = SPECIAL.get(n);
  if (n <= HANDMADE.length || special) {
    const h = special ?? HANDMADE[n - 1];
    level = { ...h, ...crop(h.grid, h.start), bonus: h.bonus ?? n % 5 === 0 };
    level.par = solve(level.grid, level.start, undefined, 2_000_000)?.length;
  } else if (n - LEVEL_DATA_FIRST < LEVEL_DATA.length) {
    // Curated by scripts/build-levels.ts: searched offline for looks and fun.
    level = decode(LEVEL_DATA[n - LEVEL_DATA_FIRST]);
  } else {
    // Endless: built by the same builder as the curated set. Prefetched in
    // a worker; if the player gets here first, build it now with the same
    // effort so every player still gets the same maze.
    let text = built.get(n) ?? readStored(n) ?? encodeOf(n);
    level = decode(text);
    // Never the same maze twice: should a build match one already played
    // (turned or mirrored counts as the same), build it afresh.
    // (Up to level REROLLS_CHECKED this is settled ahead of time, the same
    // for every player; past it, this player's own levels are the guide.)
    const first = REROLLS[n] ?? 0;
    for (let reroll = first + 1; reroll <= first + 8 && isRepeat(n, level); reroll++) {
      text = encodeOf(n, reroll);
      level = decode(text);
      rerolled.set(n, reroll);
    }
    store(n, text);
  }
  remember(n, level);
  placePickups(n, level);
  cache.set(n, level);
  return level;
}

// ---------------------------------------------------------------- no repeats

/**
 * A maze's shape as a short hash: walls, floor and special tiles (not
 * coins or keys), the same whichever way it is turned or mirrored.
 */
function shapeHash(level: Level): string {
  let g = level.grid.map((r) => r.map((v) => (v === COIN || v === KEY ? 0 : v)));
  const forms: string[] = [];
  for (let r = 0; r < 4; r++) {
    g = g[0].map((_, x) => g.map((row) => row[x]).reverse());
    forms.push(g.map((row) => row.join(',')).join('/'));
    forms.push(g.map((row) => [...row].reverse().join(',')).join('/'));
  }
  const text = forms.sort()[0];
  // FNV-1a, two lanes for 64 bits: collisions are out of reach.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/** Levels rebuilt here to avoid a repeat (read by scripts/bake-rerolls.ts). */
export const rerolled = new Map<number, number>();

/** Every maze shape met so far, and the level it belongs to. */
const SEEN_KEY = 'colormaze.seen';
let seen: Map<string, number> | null = null;

function seenShapes(): Map<string, number> {
  if (seen) return seen;
  seen = new Map();
  // All the handmade and curated levels, played or not.
  for (let n = 1; n <= HANDMADE.length; n++) seen.set(shapeHash(HANDMADE[n - 1]), n);
  LEVEL_DATA.forEach((text, i) => {
    const n = i + LEVEL_DATA_FIRST;
    if (n > HANDMADE.length) seen!.set(shapeHash(decode(text)), n);
  });
  // And every endless level this player has had.
  try {
    for (const pair of (localStorage.getItem(SEEN_KEY) ?? '').split(' ')) {
      const [h, n] = pair.split(':');
      if (h && n) seen.set(h, Number(n));
    }
  } catch {
    /* no storage: this session's levels still count */
  }
  return seen;
}

function isRepeat(n: number, level: Level): boolean {
  const at = seenShapes().get(shapeHash(level));
  return at !== undefined && at !== n;
}

function remember(n: number, level: Level) {
  if (isCurated(n)) return;
  const map = seenShapes();
  const h = shapeHash(level);
  if (map.has(h)) return;
  map.set(h, n);
  try {
    const old = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, (old ? old + ' ' : '') + h + ':' + n);
  } catch {
    /* storage full or blocked */
  }
}

/**
 * Coins and keys on the board, kept scarce so they feel like a find: a key
 * on every 6th level from level 10 (three keys, so a vault about every 18
 * levels), and one or two coins on two levels in three. Whatever the
 * curated or built level carried is replaced, the same for every player.
 */
function placePickups(n: number, level: Level) {
  const cells: { x: number; y: number }[] = [];
  level.grid.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v === COIN || v === KEY) row[x] = 0;
      if (row[x] === 0 && !(x === level.start.x && y === level.start.y)) cells.push({ x, y });
    }),
  );
  const rng = mulberry32(n * 7919 + 13);
  const take = () => (cells.length ? cells.splice(Math.floor(rng() * cells.length), 1)[0] : null);
  if (n >= 10 && n % 6 === 4) {
    const p = take();
    if (p) level.grid[p.y][p.x] = KEY;
  }
  if (n >= 4 && n % 3 !== 1) {
    for (let i = 1 + Math.floor(rng() * 2); i > 0; i--) {
      const p = take();
      if (p) level.grid[p.y][p.x] = COIN;
    }
  }
}

export const HANDMADE_COUNT = HANDMADE.length;
