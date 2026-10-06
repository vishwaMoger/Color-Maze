// Level generation and rules for Color Maze.
//
// A grid is an array of rows; each cell is 1 (wall) or 0 (floor).
// The ball slides in a direction until the next cell is a wall,
// painting every floor cell it passes. A level is won once every
// floor cell is painted.
(function (root) {
  'use strict';

  const DIRS = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  };

  // Small seeded PRNG so a given level number always produces the same maze.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function slide(grid, x, y, dx, dy) {
    const path = [];
    while (grid[y + dy] && grid[y + dy][x + dx] === 0) {
      x += dx;
      y += dy;
      path.push([x, y]);
    }
    return { x, y, path };
  }

  // A level is solvable without any risk of getting stuck when every stop
  // position reachable from the start can also get back to the start, and
  // every floor cell lies on some slide between reachable stop positions.
  function analyze(grid, start) {
    const w = grid[0].length;
    const key = (x, y) => y * w + x;
    const vectors = Object.values(DIRS);

    const reached = new Set([key(start.x, start.y)]);
    const reverse = new Map(); // stop -> stops that can slide into it
    const covered = new Set([key(start.x, start.y)]);
    const queue = [[start.x, start.y]];

    while (queue.length) {
      const [x, y] = queue.shift();
      const from = key(x, y);
      for (const [dx, dy] of vectors) {
        const r = slide(grid, x, y, dx, dy);
        if (!r.path.length) continue;
        for (const [px, py] of r.path) covered.add(key(px, py));
        const to = key(r.x, r.y);
        if (!reverse.has(to)) reverse.set(to, []);
        reverse.get(to).push(from);
        if (!reached.has(to)) {
          reached.add(to);
          queue.push([r.x, r.y]);
        }
      }
    }

    // Walk the reversed edges from the start to find who can return to it.
    const canReturn = new Set([key(start.x, start.y)]);
    const back = [key(start.x, start.y)];
    while (back.length) {
      const node = back.pop();
      for (const prev of reverse.get(node) || []) {
        if (!canReturn.has(prev)) {
          canReturn.add(prev);
          back.push(prev);
        }
      }
    }

    let floor = 0;
    for (const row of grid) for (const cell of row) if (cell === 0) floor++;

    return {
      floor,
      stops: reached.size,
      solvable: covered.size === floor && canReturn.size === reached.size,
    };
  }

  function levelSize(level) {
    return {
      w: Math.min(5 + Math.floor((level - 1) / 4), 11),
      h: Math.min(7 + Math.floor((level - 1) / 3), 15),
    };
  }

  // Carve the maze by sliding a ball around an all-wall grid. Each move
  // carves a straight run and locks the cell it stops against so later moves
  // can never carve it away. Every earlier slide therefore stays valid, and
  // the carving route itself is a solution that paints every floor cell.
  function tryCarve(rng, w, h, level) {
    const W = w + 2;
    const H = h + 2;
    const grid = Array.from({ length: H }, () => new Array(W).fill(1));
    const locked = Array.from({ length: H }, () => new Array(W).fill(false));
    const inside = (cx, cy) => cx >= 1 && cy >= 1 && cx <= w && cy <= h;
    let x = 1 + Math.floor(rng() * w);
    let y = 1 + Math.floor(rng() * h);
    const start = { x, y };
    grid[y][x] = 0;

    const target = Math.floor(w * h * (0.42 + rng() * 0.13));
    const vectors = Object.values(DIRS);
    let carved = 1;
    let moves = 0;

    for (let guard = 0; carved < target && guard < 300; guard++) {
      const [dx, dy] = vectors[Math.floor(rng() * 4)];
      let len = 1 + Math.floor(rng() * Math.max(w, h));
      let cx = x;
      let cy = y;
      while (true) {
        const nx = cx + dx;
        const ny = cy + dy;
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
      if (inside(cx + dx, cy + dy)) locked[cy + dy][cx + dx] = true;
      x = cx;
      y = cy;
      moves++;
    }

    const info = analyze(grid, start);
    const minMoves = Math.min(4 + Math.floor(level / 2), 20);
    if (!info.solvable || moves < minMoves) return null;
    return crop(grid, start, info.floor);
  }

  // Trim solid wall rows/columns so the maze fills the screen, keeping a
  // one-cell wall border.
  function crop(grid, start, floor) {
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    grid.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (cell === 0) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      })
    );
    return {
      grid: grid.slice(minY - 1, maxY + 2).map((row) => row.slice(minX - 1, maxX + 2)),
      start: { x: start.x - minX + 1, y: start.y - minY + 1 },
      floor,
    };
  }

  function fallbackLevel() {
    const rows = [
      '#######',
      '#.....#',
      '#.###.#',
      '#.....#',
      '#######',
    ];
    return {
      grid: rows.map((r) => [...r].map((c) => (c === '#' ? 1 : 0))),
      start: { x: 1, y: 1 },
      floor: 14,
    };
  }

  function generateLevel(level) {
    const rng = mulberry32(level * 7919 + 1013);
    const { w, h } = levelSize(level);
    for (let attempt = 0; attempt < 2000; attempt++) {
      const result = tryCarve(rng, w, h, level);
      if (result) return result;
    }
    return fallbackLevel();
  }

  const api = { DIRS, slide, analyze, generateLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ColorMaze = api;
})(this);
