import { parseLevel, solve, type Level } from './core.ts';
import { LEVEL_DATA, LEVEL_DATA_FIRST } from './data.ts';
import { buildLevel, encodeLevel } from './builder.ts';
import { crop } from './generator.ts';

// Hand-picked opening levels. '#' wall, '.' floor, 'o' start.
// Every 5th level is a bonus level (never possible to get stuck).
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

// Picture levels that can trap you: kept for later, where Undo-based thinking
// is expected.
const SPECIAL = new Map<number, Level>([
  [33, parseLevel(
    [
      '###############',
      '#..###...###..#',
      '#...#..#..#...#',
      '#.#...###...#.#',
      '#.###########.#',
      '#......o......#',
      '#.###########.#',
      '#.............#',
      '###############',
    ],
    { name: 'Crown' },
  )],
  [47, parseLevel(
    [
      '###############',
      '###...###...###',
      '##..#..#..#..##',
      '#..###...###..#',
      '#.#####.#####.#',
      '#..####.####..#',
      '##..###.###..##',
      '###..##.##..###',
      '####..#.#..####',
      '#####.....#####',
      '######.o.######',
      '###############',
    ],
    { name: 'Heart' },
  )],
]);

const cache = new Map<number, Level>();

function decode(text: string): Level {
  const [name, bonus, par, rows] = text.split('|');
  return parseLevel(rows.split('/'), { name, bonus: bonus === '1', par: Number(par) });
}

const encodeOf = (n: number, effort: number) => {
  const { c, bonus } = buildLevel(n, effort);
  return encodeLevel(c, bonus);
};

// Built levels are remembered on this device so they never rebuild.
const STORE = 'colormaze.lv.';
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
    // a worker; if the player gets here first, build it now (lighter search).
    const text = built.get(n) ?? readStored(n) ?? encodeOf(n, 0.15);
    level = decode(text);
    store(n, text);
  }
  cache.set(n, level);
  return level;
}

export const HANDMADE_COUNT = HANDMADE.length;
