// Rules checks for the moving tiles (spikes, cracked tiles, switch and
// gates): small boards whose answers are known by hand.
//
// Usage: node --experimental-strip-types scripts/check-mechanics.ts
import { analyze, CRACK, floorCount, isFatal, parseLevel, slide, solve, type Dir, type Dyn, type Level } from '../src/levels/core.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`);
};
const dyn = (d: Partial<Dyn>): Dyn => ({ swipes: 0, flip: false, ...d });

/** Play a solution through with every rule live: true if nothing is lost and all is painted. */
function replay(lv: Level, sol: Dir[]): boolean {
  const w = lv.grid[0].length;
  let p = lv.start;
  let flip = false;
  const painted = new Set<number>([p.y * w + p.x]);
  for (let i = 0; i < sol.length; i++) {
    const here = p.y * w + p.x;
    const r = slide(lv.grid, p, sol[i], { swipes: i, flip, hole: (c) => lv.grid[Math.floor(c / w)][c % w] === CRACK && painted.has(c) && c !== here });
    if (isFatal(r)) return false;
    r.path.forEach((c) => painted.add(c.y * w + c.x));
    p = r.end;
    flip = r.flip;
  }
  return painted.size === floorCount(lv.grid);
}

// ---- spikes: A is down on even swipes, B on odd ones.
{
  const lv = parseLevel(['#######', '#o.i..#', '#######']);
  const r0 = slide(lv.grid, lv.start, 'R', dyn({ swipes: 0 }));
  check('spike A down on swipe 0: rolls over', !r0.trap && r0.end.x === 5);
  const r1 = slide(lv.grid, lv.start, 'R', dyn({ swipes: 1 }));
  check('spike A up on swipe 1: lost on it', r1.trap?.kind === 'spike' && r1.trap.at.x === 3 && r1.path.length === 1);
  const lb = parseLevel(['#######', '#o.I..#', '#######']);
  check('spike B up on swipe 0', slide(lb.grid, lb.start, 'R', dyn({ swipes: 0 })).trap?.kind === 'spike');
  check('spike B down on swipe 1', !slide(lb.grid, lb.start, 'R', dyn({ swipes: 1 })).trap);
  // Resting on a plate is safe; leaving it is too.
  const lr = parseLevel(['#####', '#o.i#', '#####']);
  const a = slide(lr.grid, lr.start, 'R', dyn({ swipes: 0 }));
  check('may stop on a sunk plate', !a.trap && a.end.x === 3);
  check('may leave a plate whatever its phase', !slide(lr.grid, a.end, 'L', dyn({ swipes: 1 })).trap);
  // Timing: the B plate is up for the first swipe, so the ring has to be
  // gone round the other way, reaching the plate on an odd swipe.
  const lt = parseLevel(['#########', '#o..I...#', '#.#####.#', '#.......#', '#########']);
  const sol = solve(lt.grid, lt.start);
  check('solver times a B plate', sol !== null && sol[0] !== 'R' && replay(lt, sol), sol?.join(''));
  check('timing level never stuck', analyze(lt.grid, lt.start).neverStuck);
}

// ---- cracked tiles: hold once, then a hole.
{
  const lv = parseLevel(['#######', '#o.r..#', '#######']);
  const a = slide(lv.grid, lv.start, 'R');
  check('first crossing is fine', !a.trap && a.end.x === 5);
  const w = lv.grid[0].length;
  const hole = (cell: number) => cell === 1 * w + 3;
  const b = slide(lv.grid, a.end, 'L', dyn({ hole }));
  check('second crossing falls in', b.trap?.kind === 'hole' && b.trap.at.x === 3);
  // Only one way across, so the far side must be painted in one go.
  check('a one-way bridge level is unsolvable when it needs two crossings', solve(lv.grid, lv.start) === null || solve(lv.grid, lv.start)!.length === 1);
  // Order matters: cross the crack last.
  const ord = parseLevel(['#########', '#...r..o#', '#.#####.#', '#.......#', '#########']);
  const s = solve(ord.grid, ord.start);
  check('solver crosses a crack only once', s !== null, s?.join(''));
  check('crack solution replays safely', s !== null && replay(ord, s));
  check('crack levels are never "never stuck"', !analyze(ord.grid, ord.start).neverStuck);
}

// ---- switch and gates.
{
  // The gate closes off the right side until the switch is pressed.
  const lv = parseLevel(['#########', '#o.w.g..#', '#########']);
  const a = slide(lv.grid, lv.start, 'R');
  check('switch flips the gate open mid-roll', !a.trap && a.end.x === 7 && a.flip && a.switches.length === 1);
  const lv2 = parseLevel(['#########', '#o..wg..#', '#.#######', '#.#######', '#########']);
  const b = slide(lv2.grid, { x: 1, y: 3 }, 'U');
  check('rolls by without a press', b.end.y === 1 && !b.flip);
  const closed = parseLevel(['#######', '#o.g..#', '#######']);
  check('closed gate stops the ball', slide(closed.grid, closed.start, 'R').end.x === 2);
  const open = parseLevel(['#######', '#o.G..#', '#######']);
  check('open gate lets it through', slide(open.grid, open.start, 'R').end.x === 5);
  check('open gate closed after a press', slide(open.grid, open.start, 'R', dyn({ flip: true })).end.x === 2);
  // A level that needs the switch: the room behind the gate can only be
  // reached once it has been pressed.
  const need = parseLevel(['#########', '#o.....#', '#.#####g#', '#w#####.#', '#.......#', '#########'].map((r) => r.padEnd(9, '#')));
  const sol = solve(need.grid, need.start);
  check('gate level solvable', sol !== null && replay(need, sol), sol?.join(''));
  check('gate level never stuck', analyze(need.grid, need.start).neverStuck);
}

console.log(failures ? `${failures} failures` : 'all mechanics checks pass');
if (failures) process.exit(1);
