import { Application, Container, Graphics } from 'pixi.js';
import { Sound } from '../audio/sound.ts';
import { DIRS, slide, solve, type Dir, type Level, type Point } from '../levels/core.ts';
import { getLevel } from '../levels/list.ts';
import type { Hud } from '../ui/hud.ts';
import { Ball } from './Ball.ts';
import { Board, type PaintStroke } from './Board.ts';
import { Fx } from './fx.ts';
import { THEMES, type Theme } from './themes.ts';

interface Slide {
  dir: Dir;
  from: Point;
  path: Point[];
  t: number;
  dur: number;
  done: number;
}

interface Snapshot {
  pos: Point;
  painted: Map<number, number>;
  dots: number;
  splats: number;
  moves: number;
}

interface Tween {
  t: number;
  dur: number;
  step: (p: number) => void;
  done?: () => void;
}

interface Save {
  level: number;
  theme: string;
  sound: boolean;
  coins: number;
}

const SAVE_KEY = 'colormaze.v1';
const easeOutBack = (p: number) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

function loadSave(): Save {
  const fallback: Save = { level: 1, theme: 'lavender', sound: true, coins: 0 };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/** Floating background particles that set each theme's mood. */
class Ambient {
  private readonly g = new Graphics();
  private parts: { x: number; y: number; r: number; v: number; a: number; ph: number }[] = [];
  constructor(parent: Container) {
    parent.addChild(this.g);
  }
  reset(w: number, h: number, theme: Theme) {
    const n = theme.ambient === 'stars' ? 70 : 26;
    this.parts = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: theme.ambient === 'bokeh' ? 14 + Math.random() * 46 : theme.ambient === 'bubbles' ? 2 + Math.random() * 7 : 0.6 + Math.random() * 1.6,
      v: 6 + Math.random() * 16,
      a: 0.08 + Math.random() * 0.22,
      ph: Math.random() * 6.28,
    }));
  }
  update(dt: number, time: number, w: number, h: number, theme: Theme) {
    const g = this.g;
    g.clear();
    for (const p of this.parts) {
      if (theme.ambient !== 'stars') {
        p.y -= p.v * dt * (theme.ambient === 'bubbles' ? 2.2 : 0.6);
        p.x += Math.sin(time * 0.0008 + p.ph) * dt * 6;
        if (p.y < -p.r * 2) {
          p.y = h + p.r * 2;
          p.x = Math.random() * w;
        }
      }
      if (theme.ambient === 'bokeh') g.circle(p.x, p.y, p.r).fill({ color: theme.ambientColor, alpha: p.a * 0.55 });
      else if (theme.ambient === 'bubbles')
        g.circle(p.x, p.y, p.r).stroke({ color: theme.ambientColor, width: 1.2, alpha: p.a * 2 });
      else g.circle(p.x, p.y, p.r).fill({ color: theme.ambientColor, alpha: p.a * (2 + 1.6 * Math.sin(time * 0.002 + p.ph)) });
    }
  }
}

export class Game {
  readonly sound = new Sound();
  private readonly save: Save;
  private theme: Theme;
  private readonly world = new Container();
  private readonly ambient: Ambient;
  private readonly boardHolder = new Container();
  private readonly screenFx: Fx;
  private board!: Board;
  private ball!: Ball;
  private boardFx!: Fx;
  private levelNo: number;
  private level!: Level;
  private floorTotal = 0;
  private pos: Point = { x: 0, y: 0 };
  private painted = new Map<number, number>();
  private dots: PaintStroke['dots'] = [];
  private splats: PaintStroke['splats'] = [];
  private introAt = 0;
  private sparkQueue: { x: number; y: number; at: number }[] = [];
  private moves = 0;
  private history: Snapshot[] = [];
  private slideState: Slide | null = null;
  private queued: Dir | null = null;
  private lastDir: Point | null = null;
  private completeAt: number | null = null;
  private resultShown = false;
  private hint: { path: Point[]; dir: Point; until: number } | null = null;
  private tweens: Tween[] = [];
  private scaleKick = 0;
  private scaleKickV = 0;
  private nudge = { x: 0, y: 0, vx: 0, vy: 0 };
  private timeScale = 1;
  private cell = 0;
  private time = 0;
  private remaining: Point[] = [];

  constructor(
    private readonly app: Application,
    private readonly hud: Hud,
  ) {
    this.save = loadSave();
    this.theme = THEMES.find((t) => t.id === this.save.theme) ?? THEMES[0];
    this.levelNo = Math.max(1, this.save.level);
    this.sound.setEnabled(this.save.sound);
    app.stage.addChild(this.world);
    this.ambient = new Ambient(this.world);
    this.world.addChild(this.boardHolder);
    this.screenFx = new Fx(this.world);

    hud.bind({
      restart: () => this.restart(),
      undo: () => this.undo(),
      hint: () => this.showHint(),
      theme: () => this.cycleTheme(),
      sound: () => this.toggleSound(),
      next: () => this.nextLevel(),
      anyInput: () => this.sound.unlock(),
    });
    hud.setSound(this.save.sound);
    hud.setCoins(this.save.coins);
    this.applyTheme();
    this.loadLevel(this.levelNo, false);
    this.bindInput();
    app.ticker.add((t) => this.tick(t.deltaMS));
    window.addEventListener('resize', () => this.invalidateLayout());
    document.addEventListener('visibilitychange', () => this.sound.setMuted(document.hidden));
    // HUD height changes once the web font arrives.
    void document.fonts?.ready.then(() => this.invalidateLayout());
  }

  private persist() {
    this.save.level = this.levelNo;
    this.save.theme = this.theme.id;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
    } catch {
      /* storage unavailable: progress lasts for this session only */
    }
  }

  // ---------------------------------------------------------------- input

  private bindInput() {
    const el = this.app.canvas;
    let origin: { x: number; y: number; id: number } | null = null;
    const threshold = () => Math.max(14, Math.min(30, Math.min(innerWidth, innerHeight) * 0.035));
    el.addEventListener('pointerdown', (e) => {
      this.sound.unlock();
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
      if (this.resultShown) this.nextLevel();
    });
    el.addEventListener('pointermove', (e) => {
      if (!origin || e.pointerId !== origin.id) return;
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold()) return;
      const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U';
      // Re-anchor so one continuous drag can chain several swipes.
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
      this.input(dir);
    });
    const end = () => (origin = null);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    window.addEventListener('keydown', (e) => {
      this.sound.unlock();
      const keyDirs: Record<string, Dir> = {
        ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
        w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R',
      };
      if (keyDirs[e.key]) {
        e.preventDefault();
        this.input(keyDirs[e.key]);
      } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') this.undo();
      else if (e.key === 'r' || e.key === 'R') this.restart();
      else if (e.key === 'h' || e.key === 'H') this.showHint();
      else if ((e.key === 'Enter' || e.key === ' ') && this.resultShown) {
        e.preventDefault();
        this.nextLevel();
      }
    });
  }

  private input(dir: Dir) {
    if (this.completeAt !== null) return;
    if (this.slideState) {
      this.queued = dir;
      return;
    }
    this.startSlide(dir);
  }

  // ---------------------------------------------------------------- level

  private key(p: Point) {
    return p.y * this.level.grid[0].length + p.x;
  }

  private loadLevel(n: number, animate: boolean) {
    this.levelNo = n;
    this.level = getLevel(n);
    this.floorTotal = 0;
    for (const row of this.level.grid) for (const c of row) if (c === 0) this.floorTotal++;
    this.resetState();
    const old = this.board;
    this.buildBoard();
    if (animate && old) {
      this.boardHolder.addChild(old);
      const ox = old.x;
      const oy = old.y;
      this.tweens.push({
        t: 0,
        dur: 320,
        step: (p) => {
          // Never fully transparent: Pixi mis-sizes masks on alpha-0 containers.
          old.alpha = Math.max(0.01, 1 - p);
          old.scale.set(1 - 0.12 * easeInOut(p));
          old.position.set(ox, oy - 60 * easeInOut(p));
        },
        done: () => old.destroy(),
      });
      this.board.alpha = 0.01;
      this.tweens.push({
        t: -120,
        dur: 520,
        step: (p) => {
          this.board.alpha = Math.max(0.01, Math.min(1, p * 2.5));
          this.board.scale.set(0.82 + 0.18 * easeOutBack(p));
        },
      });
    } else if (old) {
      old.destroy();
    }
    this.hud.setLevel(n, !!this.level.bonus, this.level.par);
    this.hud.setMoves(0);
    this.hud.hideResult();
    this.hud.showTip(n === 1 ? 'Swipe to roll the ball' : null);
    this.sound.setRoot(this.theme.root);
    this.persist();
  }

  private resetState() {
    this.pos = { ...this.level.start };
    this.introAt = this.time;
    this.landed = false;
    this.painted = new Map([[this.key(this.pos), this.time + 330]]);
    this.dots = [];
    this.splats = [];
    this.sparkQueue = [];
    this.moves = 0;
    this.history = [];
    this.slideState = null;
    this.queued = null;
    this.completeAt = null;
    this.resultShown = false;
    this.hint = null;
    this.timeScale = 1;
    this.sound.resetMelody();
    this.updateRemaining();
  }

  private layout() {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const top = this.hud.topInset();
    const bottom = this.hud.bottomInset();
    const cols = this.level.grid[0].length;
    const rows = this.level.grid.length;
    const availW = w - 24;
    const availH = h - top - bottom - 16;
    // The outer wall ring is mostly hidden under the plate's soft border.
    const cell = Math.floor(Math.max(18, Math.min(availW / (cols - 0.7), availH / (rows - 0.7), 86)));
    return { cell, cx: w / 2, cy: top + 8 + availH / 2 };
  }

  private buildBoard() {
    const { cell, cx, cy } = this.layout();
    this.layoutCache = { cx, cy };
    this.cell = cell;
    const res = Math.min(window.devicePixelRatio || 1, 2);
    const board = new Board(this.level, this.theme, cell, res);
    board.pivot.set(board.boardWidth / 2, board.boardHeight / 2);
    board.position.set(cx, cy);
    this.boardHolder.addChild(board);
    this.board = board;
    this.boardFx = new Fx(board.fxLayer);
    this.ball = new Ball(cell, res, this.theme, board.ballLayer);
    board.ballLayer.addChild(this.ball);
    this.placeBall(this.pos);
    this.ambient.reset(this.app.screen.width, this.app.screen.height, this.theme);
  }

  private relayout() {
    if (!this.board) return;
    const { cell } = this.layout();
    if (cell === this.cell) {
      const { cx, cy } = this.layout();
      this.board.position.set(cx, cy);
      return;
    }
    const old = this.board;
    this.buildBoard();
    old.destroy();
  }

  private placeBall(p: { x: number; y: number }) {
    const c = this.board.cellCenter(p.x, p.y);
    this.ball.position.set(c.x, c.y);
  }

  private updateRemaining() {
    const out: Point[] = [];
    this.level.grid.forEach((row, y) =>
      row.forEach((c, x) => {
        if (c === 0 && !this.painted.has(this.key({ x, y }))) out.push({ x, y });
      }),
    );
    this.remaining = out;
  }

  // ---------------------------------------------------------------- moves

  private startSlide(dir: Dir) {
    const r = slide(this.level.grid, this.pos, dir);
    const d = DIRS[dir];
    if (!r.path.length) {
      // Blocked: a small wobble toward the wall.
      this.nudge.vx += d.x * 60;
      this.nudge.vy += d.y * 60;
      this.ball.impact(0.25);
      this.sound.bump();
      return;
    }
    this.history.push({
      pos: { ...this.pos },
      painted: new Map(this.painted),
      dots: this.dots.length,
      splats: this.splats.length,
      moves: this.moves,
    });
    this.moves++;
    this.hud.setMoves(this.moves);
    this.hud.showTip(null);
    this.hint = null;
    const len = r.path.length;
    this.slideState = { dir, from: { ...this.pos }, path: r.path, t: 0, dur: 70 + 34 * len ** 0.82, done: 0 };
    this.lastDir = d;
    this.sound.launch();
  }

  private stepSlide(dt: number) {
    const s = this.slideState;
    if (!s) return;
    s.t += dt;
    const p = Math.min(1, s.t / s.dur);
    // Starts quick and keeps accelerating into the wall.
    const eased = p * (0.6 + 0.4 * p);
    const dist = eased * s.path.length;
    const d = DIRS[s.dir];
    const bx = s.from.x + d.x * dist;
    const by = s.from.y + d.y * dist;
    while (s.done < s.path.length && dist >= s.done + 0.55) {
      const cellP = s.path[s.done];
      const k = this.key(cellP);
      if (!this.painted.has(k)) {
        this.painted.set(k, this.time);
        this.sound.paintTile();
        if (Math.random() < 0.45) {
          const c = this.board.cellCenter(cellP.x, cellP.y);
          const side = Math.random() < 0.5 ? 1 : -1;
          this.boardFx.splash(c.x, c.y, -d.y * side + d.x * 0.3, d.x * side + d.y * 0.3, 2, this.theme.paintDark,
            this.cell * 2.2, this.cell * 0.06, (x, y, r) => this.addDot(x, y, r));
        }
      }
      s.done++;
    }
    this.placeBall({ x: bx, y: by });
    if (p >= 1) this.arrive(s);
  }

  private arrive(s: Slide) {
    const d = DIRS[s.dir];
    this.pos = s.path[s.path.length - 1];
    this.slideState = null;
    this.updateRemaining();
    const speed = Math.min(1.3, s.path.length / 6);
    this.ball.impact(0.6 + speed * 0.5);
    this.sound.thock(0.6 + speed * 0.4);
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        /* not allowed */
      }
    }
    this.nudge.vx += d.x * (40 + 70 * speed);
    this.nudge.vy += d.y * (40 + 70 * speed);
    const c = this.board.cellCenter(this.pos.x, this.pos.y);
    const hitX = c.x + d.x * this.cell * 0.45;
    const hitY = c.y + d.y * this.cell * 0.45;
    this.boardFx.ring(hitX, hitY, this.cell * 0.5, 0xffffff);
    this.addSplat(hitX, hitY, d, 0.75 + speed * 0.35);
    this.boardFx.splash(hitX, hitY, -d.x, -d.y, 5 + Math.round(speed * 6), this.theme.paint, this.cell * 3.2,
      this.cell * 0.075, (x, y, r) => this.addDot(x, y, r));

    if (this.painted.size >= this.floorTotal) {
      this.queued = null;
      this.beginComplete();
      return;
    }
    if (this.queued) {
      const q = this.queued;
      this.queued = null;
      this.startSlide(q);
    }
  }

  /** A paint stain spreading from the wall the ball just hit. */
  private addSplat(x: number, y: number, d: Point, power: number) {
    const c = this.cell;
    const blobs = [{ x: x - d.x * c * 0.12, y: y - d.y * c * 0.12, r: c * 0.42 * power }];
    const back = Math.atan2(-d.y, -d.x);
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const a = back + (Math.random() - 0.5) * 3.4;
      const dist = c * (0.32 + Math.random() * 0.4) * power;
      blobs.push({ x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, r: c * (0.07 + Math.random() * 0.12) * power });
    }
    this.splats.push({ blobs, t: this.time });
    if (this.splats.length > 40) this.splats.shift();
  }

  private addDot(x: number, y: number, r: number) {
    if (this.dots.length > 260) return;
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (this.level.grid[cy]?.[cx] === 0) this.dots.push({ x, y, r });
  }

  undo() {
    this.sound.unlock();
    if (this.slideState || this.completeAt !== null) return;
    const snap = this.history.pop();
    if (!snap) return;
    this.pos = snap.pos;
    this.painted = snap.painted;
    this.dots.length = snap.dots;
    this.splats.length = snap.splats;
    this.moves = snap.moves;
    this.hud.setMoves(this.moves);
    this.updateRemaining();
    this.placeBall(this.pos);
    this.ball.impact(0.3);
    this.sound.click();
    this.boardFx.sparkle(this.ball.x, this.ball.y, 6, this.cell * 1.2, 0xffffff);
  }

  restart() {
    this.sound.unlock();
    if (this.completeAt !== null) return;
    if (this.moves === 0) return;
    this.resetState();
    this.hud.setMoves(0);
    this.placeBall(this.pos);
    this.ball.impact(0.4);
    this.sound.click();
    this.boardFx.clear();
  }

  private showHint() {
    this.sound.unlock();
    if (this.slideState || this.completeAt !== null) return;
    const sol = solve(this.level.grid, this.pos, this.painted.keys(), 300000);
    if (!sol || !sol.length) {
      this.hud.toast('No way to finish from here. Tap Undo.');
      return;
    }
    const r = slide(this.level.grid, this.pos, sol[0]);
    this.hint = { path: r.path, dir: DIRS[sol[0]], until: this.time + 5000 };
    this.sound.click();
  }

  // ---------------------------------------------------------------- complete

  private beginComplete() {
    this.completeAt = this.time;
    this.timeScale = 0.3;
    this.hint = null;
  }

  private stepComplete() {
    if (this.completeAt === null) return;
    const t = this.time - this.completeAt;
    if (t > 260) this.timeScale = 1;
    const start = 200;
    if (t >= start && t - this.lastFrameDt < start) {
      this.sound.complete();
      this.scaleKickV += 1.1;
      this.boardFx.sparkle(this.ball.x, this.ball.y, 18, this.cell * 2.5, 0xffffff);
      this.screenFx.confetti(this.app.screen.width, this.app.screen.height, 70, [
        this.theme.paint, this.theme.paintLight, 0xffd23f, 0x7b5cf0, 0x40e0d0, 0xffffff,
      ]);
      // Glints rise from every tile, rippling outward from the ball.
      this.sparkQueue = this.board
        .floorPoints()
        .map((p) => ({ ...this.board.cellCenter(p.x, p.y), at: this.time + Math.hypot(p.x - this.pos.x, p.y - this.pos.y) * 45 }))
        .sort((a, b) => a.at - b.at);
    }
    while (this.sparkQueue.length && this.sparkQueue[0].at <= this.time) {
      const sp = this.sparkQueue.shift()!;
      this.boardFx.rise(sp.x, sp.y, 0xffffff, this.cell * 0.09);
    }
    this.board.drawSweep((t - start - 100) / 900);
    if (t > 950 && !this.resultShown) {
      this.resultShown = true;
      this.resultAt = this.time;
      const par = this.level.par ?? this.moves;
      const stars = this.moves <= par ? 3 : this.moves <= Math.ceil(par * 1.4) ? 2 : 1;
      const coins = 10 + stars * 5 + (this.level.bonus ? 25 : 0);
      this.save.coins += coins;
      this.persist();
      this.hud.showResult({
        level: this.levelNo,
        stars,
        moves: this.moves,
        par,
        coins,
        bonus: !!this.level.bonus,
        onStar: (i) => this.sound.star(i),
        onCoin: () => this.sound.coin(),
        totalCoins: this.save.coins,
      });
    }
  }

  private lastFrameDt = 16;

  private resultAt = 0;
  private landed = false;

  nextLevel() {
    // Ignore taps in the first moment so the stars can land.
    if (!this.resultShown || this.time - this.resultAt < 450) return;
    this.sound.click();
    this.hud.hideResult();
    this.loadLevel(this.levelNo + 1, true);
  }

  // ---------------------------------------------------------------- themes

  private applyTheme() {
    const t = this.theme;
    const root = document.documentElement.style;
    root.setProperty('--bg-top', t.bgTop);
    root.setProperty('--bg-bottom', t.bgBottom);
    root.setProperty('--ink', t.ui.ink);
    root.setProperty('--btn', t.ui.button);
    root.setProperty('--btn-shade', t.ui.buttonShade);
    root.setProperty('--panel', t.ui.panel);
    this.hud.setThemeName(t.name);
    this.sound.setRoot(t.root);
  }

  private cycleTheme() {
    const i = THEMES.indexOf(this.theme);
    this.theme = THEMES[(i + 1) % THEMES.length];
    this.applyTheme();
    const old = this.board;
    this.buildBoard();
    old.destroy();
    this.board.scale.set(0.94);
    this.tweens.push({ t: 0, dur: 420, step: (p) => this.board.scale.set(0.94 + 0.06 * easeOutBack(p)) });
    this.persist();
    this.sound.click();
  }

  private toggleSound() {
    this.sound.unlock();
    this.save.sound = !this.save.sound;
    this.sound.setEnabled(this.save.sound);
    this.hud.setSound(this.save.sound);
    this.persist();
  }

  // ---------------------------------------------------------------- frame

  private tick(rawDt: number) {
    const dt = Math.min(rawDt, 50) * this.timeScale;
    this.lastFrameDt = rawDt;
    this.time += rawDt;
    const time = this.time;

    this.stepSlide(dt);
    this.stepComplete();

    for (const tw of [...this.tweens]) {
      tw.t += rawDt;
      const p = Math.max(0, Math.min(1, tw.t / tw.dur));
      if (tw.t >= 0) tw.step(p);
      if (p >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.done?.();
      }
    }

    // Springs: board pulse and camera nudge. Fixed small steps keep them
    // stable even when a frame takes long (e.g. while a level is built).
    const n = this.nudge;
    let remainingMs = Math.min(rawDt, 100);
    while (remainingMs > 0) {
      const s = Math.min(remainingMs, 8) / 1000;
      remainingMs -= 8;
      this.scaleKickV += (-260 * this.scaleKick - 14 * this.scaleKickV) * s;
      this.scaleKick += this.scaleKickV * s;
      n.vx += (-320 * n.x - 22 * n.vx) * s;
      n.vy += (-320 * n.y - 22 * n.vy) * s;
      n.x += n.vx * s;
      n.y += n.vy * s;
    }
    const { cx, cy } = this.layoutCache ?? (this.layoutCache = this.layout());
    if (!this.tweens.length) this.board.scale.set(1 + this.scaleKick * 0.05);
    this.board.position.set(cx + n.x * 0.04, cy + n.y * 0.04);

    const moving = !!this.slideState;
    const speed = this.slideState ? this.slideState.path.length / (this.slideState.dur / 1000) / 30 : 0;
    this.ball.update(dt, time, moving, this.lastDir, speed);
    const intro = (time - this.introAt) / 470;
    if (intro < 1.2) {
      this.ball.dropIn(moving ? 1 : intro);
      if (!this.landed && intro >= 0.7) {
        this.landed = true;
        this.ball.impact(0.9);
        this.sound.thock(0.45);
        this.boardFx.ring(this.ball.x, this.ball.y, this.cell * 0.55, 0xffffff);
        this.boardFx.splash(this.ball.x, this.ball.y, 0, 1, 7, this.theme.paint, this.cell * 2.2, this.cell * 0.07,
          (x, y, r) => this.addDot(x, y, r));
      }
    }

    const showTutorial = this.levelNo === 1 && this.moves === 0 && !this.slideState;
    if (showTutorial && !this.hint) {
      const sol = solve(this.level.grid, this.pos, this.painted.keys(), 20000);
      if (sol?.length) {
        const r = slide(this.level.grid, this.pos, sol[0]);
        this.hint = { path: r.path, dir: DIRS[sol[0]], until: Infinity };
      }
    }
    if (this.hint && time > this.hint.until) this.hint = null;
    this.board.drawHint(time, this.hint?.path ?? null, this.hint?.dir);

    const stroke: PaintStroke = { painted: this.painted, dots: this.dots, splats: this.splats };
    if (this.slideState) {
      const st = this.slideState;
      const d = DIRS[st.dir];
      const p = Math.min(1, st.t / st.dur);
      const dist = p * (0.6 + 0.4 * p) * st.path.length;
      stroke.active = { from: st.from, pos: { x: st.from.x + d.x * dist, y: st.from.y + d.y * dist } };
    }
    this.board.update(time, stroke, this.remaining);
    this.boardFx.update(dt);
    this.screenFx.update(rawDt);
    this.ambient.update(rawDt / 1000, time, this.app.screen.width, this.app.screen.height, this.theme);
  }

  private layoutCache: { cx: number; cy: number } | null = null;

  invalidateLayout() {
    this.layoutCache = null;
    this.relayout();
  }
}
