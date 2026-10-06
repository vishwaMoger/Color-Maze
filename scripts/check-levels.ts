// Validates levels: fully paintable, solvable, bonus levels never-stuck.
// Usage: npm run check-levels [-- <count>]
import { analyze, solve } from '../src/levels/core.ts';
import { getLevel } from '../src/levels/list.ts';

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
  if (lv.bonus && !a.neverStuck) problems.push('bonus level can get stuck');
  const w = lv.grid[0].length;
  const h = lv.grid.length;
  console.log(
    `${String(n).padStart(3)} ${lv.bonus ? 'B' : ' '} ${(lv.name ?? 'gen').padEnd(9)} ${w}x${h}` +
      ` tiles=${a.floor} par=${sol?.length ?? '-'} stuck=${a.neverStuck ? 'no ' : 'yes'}` +
      (problems.length ? `  FAIL: ${problems.join(', ')}` : ''),
  );
  if (problems.length) failures++;
}
console.log(`${count} levels in ${Date.now() - t0} ms, ${failures} failures`);
process.exit(failures ? 1 : 0);
