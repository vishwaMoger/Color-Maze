import { COIN, KEY, parseLevel, solve, type Level } from './core.ts';
import { LEVEL_DATA, LEVEL_DATA_FIRST } from './data.ts';
import { buildLevel, ENDLESS_EFFORT, encodeLevel } from './builder.ts';
import { crop, mulberry32 } from './generator.ts';

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

const encodeOf = (n: number) => {
  const { c, bonus } = buildLevel(n, ENDLESS_EFFORT);
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
    const text = built.get(n) ?? readStored(n) ?? encodeOf(n);
    level = decode(text);
    store(n, text);
  }
  placePickups(n, level);
  cache.set(n, level);
  return level;
}

/**
 * Coins and keys on the board, kept scarce so they feel like a find: a key
 * on every 4th level from level 6 (three keys, so a vault about every 12
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
  if (n >= 6 && n % 4 === 2) {
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
