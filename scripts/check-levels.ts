// Validates levels: fully paintable, solvable, and never stuck (from any
// stop the ball can reach, the level can still be finished).
// Usage: npm run check-levels [-- <count>]
import { analyze, CRACK, features, replay, solve, SPIKE_A, SPIKE_B } from '../src/levels/core.ts';
import { getLevel } from '../src/levels/list.ts';
import { buildLevel, ENDLESS_EFFORT, encodeLevel, switchMatters, trapMatters } from '../src/levels/builder.ts';
import { LEVEL_DATA, LEVEL_DATA_FIRST } from '../src/levels/data.ts';

const count = Number(process.argv[2] ?? 60);
let failures = 0;
const t0 = Date.now();
for (let n = 1; n <= count; n++) {
  const lv = getLevel(n);
  const a = analyze(lv.grid, lv.start);
  const sol = solve(lv.grid, lv.start, undefined, 2_000_000);
  const problems: string[] = [];
  if (a.covered !== a.floor) problems.push(`unreachable tiles ${a.floor - a.covered}`);
  if (!sol) problems.push('no solution found');
  else if (!replay(lv.grid, lv.start, sol)) problems.push('solution loses the ball');
  // Cracked tiles are the one thing allowed to trap the ball for good (the
  // game spots the dead end and offers a restart).
  const f = features(lv.grid);
  if (!a.neverStuck && !f.cracks) problems.push('can get stuck');
  // A trap must be part of the puzzle, not decoration.
  if (f.spikes && !trapMatters(lv.grid, lv.start, [SPIKE_A, SPIKE_B], 400000)) problems.push('spikes change nothing');
  if (f.cracks && !trapMatters(lv.grid, lv.start, [CRACK], 400000)) problems.push('cracks change nothing');
  if (f.gates && !switchMatters(lv.grid, lv.start)) problems.push('switch changes nothing');
  const w = lv.grid[0].length;
  const h = lv.grid.length;
  console.log(
    `${String(n).padStart(3)} ${lv.bonus ? 'B' : ' '} ${(lv.name ?? 'gen').padEnd(9)} ${w}x${h}` +
      ` tiles=${a.floor} par=${sol?.length ?? '-'} stuck=${a.neverStuck ? 'no ' : 'yes'}` +
      (problems.length ? `  FAIL: ${problems.join(', ')}` : ''),
  );
  if (problems.length) failures++;
}
// Endless levels must be pure functions of the level number: every player
// (worker or main thread, any device) has to get the same maze.
const endless = LEVEL_DATA_FIRST + LEVEL_DATA.length;
for (let n = endless; n < endless + 6; n++) {
  const a = encodeLevel(buildLevel(n, ENDLESS_EFFORT).c, false);
  const b = encodeLevel(buildLevel(n, ENDLESS_EFFORT).c, false);
  if (a !== b) {
    console.log(`${n} FAIL: endless level is not deterministic`);
    failures++;
  }
}
console.log(`${count} levels in ${Date.now() - t0} ms, ${failures} failures`);
process.exit(failures ? 1 : 0);
