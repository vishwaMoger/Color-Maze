// Dumps level grids as JSON for offline review (contact sheets).
// Usage: node --experimental-strip-types scripts/dump-levels.ts [count] > levels.json
import { analyze, solve } from '../src/levels/core.ts';
import { getLevel } from '../src/levels/list.ts';

const count = Number(process.argv[2] ?? 60);
const out = [];
for (let n = 1; n <= count; n++) {
  const lv = getLevel(n);
  const a = analyze(lv.grid, lv.start);
  const sol = solve(lv.grid, lv.start, undefined, 2_000_000);
  out.push({ n, name: lv.name ?? '', bonus: !!lv.bonus, grid: lv.grid, start: lv.start, tiles: a.floor, par: sol?.length ?? -1, stuck: !a.neverStuck });
}
console.log(JSON.stringify(out));
