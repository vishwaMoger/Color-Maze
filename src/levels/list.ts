import { parseLevel, type Level } from './core.ts';
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
  parseLevel(
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
  ),
  parseLevel(
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
  ),
];

const cache = new Map<number, Level>();

/** Level n (1-based): handmade first, then generated forever. */
export function getLevel(n: number): Level {
  const cached = cache.get(n);
  if (cached) return cached;
  let level: Level;
  if (n <= HANDMADE.length) {
    const h = HANDMADE[n - 1];
    level = { ...h, ...crop(h.grid, h.start), bonus: h.bonus ?? n % 5 === 0 };
  } else {
    level = generateLevel(n, n % 5 === 0);
  }
  cache.set(n, level);
  return level;
}

export const HANDMADE_COUNT = HANDMADE.length;
