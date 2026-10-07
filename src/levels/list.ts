import { parseLevel, solve, type Level } from './core.ts';
import { LEVEL_DATA, LEVEL_DATA_FIRST } from './data.ts';
import { crop, generateLevel } from './generator.ts';

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
    const [name, bonus, par, rows] = LEVEL_DATA[n - LEVEL_DATA_FIRST].split('|');
    level = parseLevel(rows.split('/'), { name, bonus: bonus === '1', par: Number(par) });
  } else {
    level = generateLevel(n, n % 5 === 0);
  }
  cache.set(n, level);
  return level;
}

export const HANDMADE_COUNT = HANDMADE.length;
