import { Application, Container, Graphics } from 'pixi.js';
import { Sound } from '../audio/sound.ts';
import { DIRS, isFloor, slide, solve, WALL, type Dir, type Level, type Point } from '../levels/core.ts';
import { getLevel } from '../levels/list.ts';
import type { Hud, ShopItem, ShopTab } from '../ui/hud.ts';
import { BALLS, hexCss, PAINTS } from './cosmetics.ts';
import { league, loadSave, PRICES, storeSave, timeLeft, type Save } from './meta.ts';
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

const easeOutBack = (p: number) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;

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
  private shimmer: { k: number; t: number }[] = [];
  private cone: { from: Point; to: { x: number; y: number }; endedAt: number | null } | null = null;
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
    this.look = this.makeLook();
    this.levelNo = Math.max(1, this.save.level);
    this.sound.setEnabled(this.save.sound);
    this.sound.setMusic(this.save.music);
    app.stage.addChild(this.world);
    this.ambient = new Ambient(this.world);
    this.world.addChild(this.boardHolder);
    this.screenFx = new Fx(this.world);

    hud.bind({
      restart: () => this.restart(),
      undo: () => this.undo(),
      hint: () => this.showHint(),
      bomb: () => this.paintBomb(),
      next: () => this.nextLevel(),
      equip: (tab, id) => this.equip(tab, id),
      toggle: (what) => this.toggle(what),
      openShop: () => this.refreshShop(),
      openLeague: () => this.refreshLeague(true),
      openChest: () => this.openChest(),
      collectChest: () => this.collectChest(),
      anyInput: () => this.sound.unlock(),
      click: () => this.sound.click(),
    });
    hud.setToggles({ sfx: this.save.sound, music: this.save.music, vibe: this.save.vibe });
    hud.setCoins(this.save.coins);
    hud.setKeys(this.save.keys);
    hud.setStreak(this.save.streak);
    this.refreshPrices();
    this.refreshLeague(false);
    this.checkUnlocks();
    window.setInterval(() => this.refreshLeague(false), 30000);
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
    this.save.best = Math.max(this.save.best, this.levelNo);
    this.save.theme = this.theme.id;
    storeSave(this.save);
  }

  /** The active board theme with the player's paint and ball choices applied. */
  private look!: Theme;

  private makeLook(): Theme {
    const p = PAINTS.find((x) => x.id === this.save.paint) ?? PAINTS[0];
    const b = BALLS.find((x) => x.id === this.save.ball) ?? BALLS[0];
    return { ...this.theme, paint: p.paint, paintDark: p.dark, paintLight: p.light, cone: p.cone, ball: b.colors, ballShine: b.shine };
  }

  // ---------------------------------------------------------------- meta

  private refreshPrices() {
    const coin = (n: number) => `<i class="coin sm"></i>${n}`;
    this.hud.setPrices({
      hint: this.save.hints > 0 ? `×${this.save.hints}` : coin(PRICES.hint),
      bomb: this.save.bombs > 0 ? `×${this.save.bombs}` : coin(PRICES.bomb),
    });
  }

  /** Spend one free use or its coin price. Returns false if unaffordable. */
  private spend(kind: 'hints' | 'bombs'): boolean {
    if (this.save[kind] > 0) {
      this.save[kind]--;
    } else {
      const price = kind === 'hints' ? PRICES.hint : PRICES.bomb;
      if (this.save.coins < price) {
        this.hud.toast(`Need ${price} coins: finish levels to earn more`);
        return false;
      }
      this.save.coins -= price;
      this.hud.setCoins(this.save.coins);
    }
    this.refreshPrices();
    this.persist();
    return true;
  }

  private refreshLeague(render: boolean) {
    const { rows, rank } = league(this.save.week, this.save.weekStars);
    this.hud.setLeague(rank, timeLeft());
    if (render) this.hud.renderLeague(rows);
  }

  private shopItems(): Record<ShopTab, ShopItem[]> {
    return {
      ball: BALLS.map((b) => ({
        id: b.id,
        name: b.name,
        unlock: b.unlock,
        kind: 'ball' as const,
        preview: `background: radial-gradient(circle at 36% 32%, ${b.colors[0]} 0 12%, ${b.colors[1]} 45%, ${b.colors[2]} 100%)`,
      })),
      paint: PAINTS.map((p) => ({
        id: p.id,
        name: p.name,
        unlock: p.unlock,
        kind: 'paint' as const,
        preview: `--paint: ${hexCss(p.paint)}; --paint-dark: ${hexCss(p.dark)}`,
      })),
      board: THEMES.map((t) => ({
        id: t.id,
        name: t.name,
        unlock: t.unlock,
        kind: 'board' as const,
        preview: `--slab: ${t.swatch.slab}; --side: ${t.swatch.side}; --floor: ${t.swatch.floor}; --paint: ${t.swatch.paint}`,
      })),
    };
  }

  private refreshShop() {
    const items = this.shopItems();
    this.hud.setShop('ball', items.ball, this.save.ball, this.save.best);
    this.hud.setShop('paint', items.paint, this.save.paint, this.save.best);
    this.hud.setShop('board', items.board, this.theme.id, this.save.best);
    this.hud.setShopDot(false);
    this.save.seenUnlock = this.save.best;
    this.persist();
  }

  private equip(tab: ShopTab, id: string) {
    if (tab === 'board') {
      this.selectTheme(id);
      return;
    }
    if (tab === 'ball') this.save.ball = id;
    else this.save.paint = id;
    this.look = this.makeLook();
    const old = this.board;
    this.buildBoard();
    old.destroy();
    this.persist();
  }

  /** Red dot on the shop when something new unlocked since the last visit. */
  private checkUnlocks() {
    const all = [...BALLS, ...PAINTS, ...THEMES];
    const fresh = all.some((x) => x.unlock > (this.save.seenUnlock ?? 1) && x.unlock <= this.save.best);
    this.hud.setShopDot(fresh);
  }

  private chestPending = false;

  private openChest() {
    if (!this.chestPending) return;
    const coins = 80 + Math.floor(Math.random() * 5) * 20;
    this.chestCoins = coins;
    this.hud.openChest(coins);
    this.sound.complete();
    this.vibrate(20);
  }

  private chestCoins = 0;

  private collectChest() {
    if (!this.chestPending || !this.chestCoins) return;
    this.chestPending = false;
    this.save.coins += this.chestCoins;
    this.save.keys = 0;
    this.chestCoins = 0;
    this.hud.setCoins(this.save.coins);
    this.hud.setKeys(0);
    this.hud.closeChest();
    this.persist();
    this.autoNextAt = this.time + 300;
  }

  // ---------------------------------------------------------------- input

  private bindInput() {
    const el = this.app.canvas;
    let origin: { x: number; y: number; id: number } | null = null;
    const threshold = (e: PointerEvent) =>
      e.pointerType === 'mouse' ? 12 : Math.max(14, Math.min(28, Math.min(innerWidth, innerHeight) * 0.03));
    el.addEventListener('pointerdown', (e) => {
      this.sound.unlock();
      if (this.hud.modalOpen) return;
      if (this.resultShown) {
        this.nextLevel();
        return;
      }
      e.preventDefault();
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
      // Keep receiving the drag even if the mouse passes over buttons.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported */
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!origin || e.pointerId !== origin.id) return;
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold(e)) return;
      const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U';
      // Re-anchor so one continuous drag can chain several swipes.
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
      this.input(dir);
    });
    const end = (e: PointerEvent) => {
      if (origin && e.pointerId === origin.id) origin = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
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
    if (this.completeAt !== null || this.hud.modalOpen) return;
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
    this.restartedThisLevel = false;
    this.level = getLevel(n);
    this.floorTotal = 0;
    for (const row of this.level.grid) for (const c of row) if (c !== WALL) this.floorTotal++;
    this.resetState();
    const old = this.board;
    this.buildBoard();
    if (animate && old) {
      // Like a carousel: the finished board slides out left, the next one
      // slides in from the right and settles with a little overshoot.
      this.boardHolder.addChild(old);
      const ox = old.x;
      const w = this.app.screen.width;
      this.tweens.push({
        t: 0,
        dur: 300,
        step: (p) => old.position.set(ox - (w * 0.5 + old.boardWidth) * p * p, old.y),
        done: () => old.destroy(),
      });
      this.enterX = w * 0.5 + this.board.boardWidth;
      this.tweens.push({
        t: -260,
        dur: 420,
        step: (p) => (this.enterX = (w * 0.5 + this.board.boardWidth) * (1 - easeOutBack(p))),
        done: () => (this.enterX = 0),
      });
      this.introAt = this.time + 560;
      this.painted.set(this.key(this.pos), this.introAt + 330);
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
    this.cone = null;
    this.bombAnim = null;
    this.moves = 0;
    this.history = [];
    this.slideState = null;
    this.queued = null;
    this.completeAt = null;
    this.resultShown = false;
    this.autoNextAt = null;
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
    const board = new Board(this.level, this.look, cell, res);
    board.pivot.set(board.boardWidth / 2, board.boardHeight / 2);
    board.position.set(cx, cy);
    this.boardHolder.addChild(board);
    this.board = board;
    this.boardFx = new Fx(board.fxLayer);
    // Fresh bomb layer per board: the old one is destroyed with its board.
    this.bombG = new Graphics();
    board.fxLayer.addChild(this.bombG);
    this.bombAnim = null;
    this.ball = new Ball(cell, res, this.look, board.ballLayer);
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
        if (c !== WALL && !this.painted.has(this.key({ x, y }))) out.push({ x, y });
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
    this.slideState = { dir, from: { ...this.pos }, path: r.path, t: 0, dur: 45 + 24 * len ** 0.9, done: 0 };
    this.lastDir = d;
    this.cone = { from: { ...this.pos }, to: { ...this.pos }, endedAt: null };
    this.sound.launch(this.slideState.dur);
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
        this.speckle(cellP);
        if (Math.random() < 0.6) {
          const c = this.board.cellCenter(cellP.x, cellP.y);
          const side = Math.random() < 0.5 ? 1 : -1;
          this.boardFx.splash(c.x, c.y, -d.y * side + d.x * 0.3, d.x * side + d.y * 0.3, 2, this.look.paintDark,
            this.cell * 2.2, this.cell * 0.06, (x, y, r) => this.addDot(x, y, r));
        }
      }
      s.done++;
    }
    this.placeBall({ x: bx, y: by });
    if (this.cone) this.cone.to = { x: bx, y: by };
    if (p >= 1) this.arrive(s);
  }

  private arrive(s: Slide) {
    const d = DIRS[s.dir];
    this.pos = s.path[s.path.length - 1];
    this.slideState = null;
    // A glint runs back along the stroke from the start to where it landed.
    const now = this.time;
    this.shimmer = [this.key(s.from), ...s.path.map((p) => this.key(p))].map((k, i) => ({ k, t: now + i * 16 }));
    if (this.cone) this.cone.endedAt = this.time;
    this.updateRemaining();
    const speed = Math.min(1.3, s.path.length / 6);
    this.ball.impact(0.6 + speed * 0.5);
    this.sound.thock(0.6 + speed * 0.4);
    this.vibrate(8);

    const c = this.board.cellCenter(this.pos.x, this.pos.y);
    const hitX = c.x + d.x * this.cell * 0.45;
    const hitY = c.y + d.y * this.cell * 0.45;
    this.boardFx.ring(hitX, hitY, this.cell * 0.5, 0xffffff);
    this.boardFx.splash(hitX, hitY, -d.x, -d.y, 5 + Math.round(speed * 6), this.look.paint, this.cell * 3.2,
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

  private addDot(x: number, y: number, r: number) {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (isFloor(this.level.grid, cx, cy)) this.dots.push({ x, y, r, t: this.time });
  }

  /** Dense wet splatter on a freshly painted tile. */
  private speckle(p: Point) {
    const c = this.cell;
    const n = 5 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      const big = Math.random() < 0.25;
      this.dots.push({
        x: (p.x + 0.05 + Math.random() * 0.9) * c,
        y: (p.y + 0.05 + Math.random() * 0.9) * c,
        r: c * (big ? 0.07 + Math.random() * 0.05 : 0.025 + Math.random() * 0.035),
        t: this.time + Math.random() * 60,
      });
    }
  }

  undo() {
    this.sound.unlock();
    if (this.slideState || this.completeAt !== null) return;
    const snap = this.history.pop();
    if (!snap) return;
    this.pos = snap.pos;
    this.painted = snap.painted;
    this.dots = [];
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
    this.restartedThisLevel = true;
    if (this.save.streak > 0) {
      this.hud.toast('Streak lost');
      this.save.streak = 0;
      this.hud.setStreak(0);
      this.persist();
    }
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
    if (!this.spend('hints')) return;
    const r = slide(this.level.grid, this.pos, sol[0]);
    this.hint = { path: r.path, dir: DIRS[sol[0]], until: this.time + 6000 };
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
        this.look.paint, this.look.paintLight, 0xffd23f, 0x7b5cf0, 0x40e0d0, 0xffffff,
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
      this.save.weekStars += stars + (this.level.bonus ? 2 : 0);
      this.save.streak = this.restartedThisLevel ? 0 : this.save.streak + 1;
      const key = this.save.keys < 3 && (this.level.bonus || Math.random() < 0.34);
      if (key) this.save.keys++;
      this.persist();
      this.hud.setStreak(this.save.streak, true);
      this.refreshLeague(false);
      const info = {
        level: this.levelNo,
        stars,
        moves: this.moves,
        par,
        coins,
        bonus: !!this.level.bonus,
        key,
        onStar: (i: number) => this.sound.star(i),
        onCoin: () => this.sound.coin(),
        totalCoins: this.save.coins,
      };
      const onKey = () => {
        this.hud.setKeys(this.save.keys, true);
        this.sound.star(2);
      };
      if (this.level.bonus) {
        this.hud.showResult(info);
        if (key) window.setTimeout(onKey, 900);
      } else {
        const c = this.board.toGlobal(this.board.cellCenter(this.pos.x, this.pos.y));
        const top = this.board.toGlobal({ x: 0, y: 0 }).y;
        this.hud.celebrate(info, { x: c.x, y: c.y }, top, onKey);
        this.autoNextAt = this.time + (key ? 2200 : 1750);
      }
      this.checkUnlocks();
    }
  }

  private lastFrameDt = 16;

  private resultAt = 0;
  private enterX = 0;
  private autoNextAt: number | null = null;
  private landed = false;

  private restartedThisLevel = false;

  nextLevel() {
    // Ignore taps in the first moment so the stars can land.
    if (!this.resultShown || this.time - this.resultAt < 450) return;
    // Three keys: open the treasure chest before moving on.
    if (this.save.keys >= 3 && !this.chestPending) {
      this.chestPending = true;
      this.autoNextAt = null;
      this.hud.endCelebrate();
      this.hud.hideResult();
      this.hud.showChest();
      return;
    }
    if (this.chestPending) return;
    this.autoNextAt = null;
    this.hud.hideResult();
    this.hud.endCelebrate();
    this.loadLevel(this.levelNo + 1, true);
  }

  // ---------------------------------------------------------------- themes

  private applyTheme() {
    const t = this.theme;
    const root = document.documentElement.style;
    root.setProperty('--bg-top', t.bgTop);
    root.setProperty('--bg-bottom', t.bgBottom);
    root.setProperty('--ink', t.ui.ink);
    root.setProperty('--deep', t.ui.deep);
    root.setProperty('--p1', t.ui.p1);
    root.setProperty('--p2', t.ui.p2);
    root.setProperty('--p3', t.ui.p3);
    root.setProperty('--panel-edge', t.ui.panelEdge);
    this.sound.setRoot(t.root);
  }

  private selectTheme(id: string) {
    const next = THEMES.find((t) => t.id === id);
    if (!next || next === this.theme) return;
    this.theme = next;
    this.look = this.makeLook();
    this.applyTheme();
    const old = this.board;
    this.buildBoard();
    old.destroy();
    this.board.scale.set(0.94);
    this.tweens.push({ t: 0, dur: 420, step: (p) => this.board.scale.set(0.94 + 0.06 * easeOutBack(p)) });
    this.persist();
  }

  private toggle(what: 'sfx' | 'music' | 'vibe') {
    if (what === 'sfx') {
      this.save.sound = !this.save.sound;
      this.sound.setEnabled(this.save.sound);
    } else if (what === 'music') {
      this.save.music = !this.save.music;
      this.sound.setMusic(this.save.music);
    } else this.save.vibe = !this.save.vibe;
    this.hud.setToggles({ sfx: this.save.sound, music: this.save.music, vibe: this.save.vibe });
    this.persist();
  }

  private vibrate(ms: number) {
    if (!this.save.vibe || !('vibrate' in navigator)) return;
    try {
      navigator.vibrate(ms);
    } catch {
      /* not allowed */
    }
  }

  // ---------------------------------------------------------------- booster

  /**
   * Paint Bomb: three paint blobs land together on the most critical spot,
   * the pocket whose tiles cost the most extra swipes to reach. Candidate
   * pockets come from the least productive moves of the best solution, and
   * each candidate cluster is scored by how many moves it actually saves.
   */
  private bombTargets(): Point[] {
    const grid = this.level.grid;
    const painted = new Set(this.painted.keys());
    const sol = solve(grid, this.pos, painted, 200000);
    if (!sol) return this.remaining.slice(0, 3);
    // Tiles each move of the solution newly paints.
    const moves: Point[][] = [];
    const seen = new Set(painted);
    let p = this.pos;
    for (const dir of sol) {
      const r = slide(grid, p, dir);
      const fresh = r.path.filter((c) => !seen.has(this.key(c)));
      fresh.forEach((c) => seen.add(this.key(c)));
      moves.push(fresh);
      p = r.end;
    }
    const unpainted = (c: Point) => isFloor(grid, c.x, c.y) && !painted.has(this.key(c));
    // Grow a cluster of up to 3 unpainted, connected tiles from a pocket tip.
    const cluster = (seed: Point): Point[] => {
      const out = [seed];
      const queue = [seed];
      const inCluster = new Set([this.key(seed)]);
      while (queue.length && out.length < 3) {
        const c = queue.shift()!;
        for (const d of Object.values(DIRS)) {
          const n = { x: c.x + d.x, y: c.y + d.y };
          if (out.length >= 3 || !unpainted(n) || inCluster.has(this.key(n))) continue;
          inCluster.add(this.key(n));
          out.push(n);
          queue.push(n);
        }
      }
      return out;
    };
    const candidates = moves
      .map((tiles, i) => ({ tiles, i }))
      .filter((m) => m.tiles.length > 0)
      .sort((a, b) => a.tiles.length - b.tiles.length)
      .slice(0, 5)
      .map((m) => cluster(m.tiles[m.tiles.length - 1]));
    let best: { tiles: Point[]; saved: number } | null = null;
    for (const tiles of candidates) {
      const after = new Set(painted);
      tiles.forEach((c) => after.add(this.key(c)));
      const rest = solve(grid, this.pos, after, 120000);
      const saved = rest ? sol.length - rest.length : -1;
      if (!best || saved > best.saved) best = { tiles, saved };
    }
    return best?.tiles ?? this.remaining.slice(0, 3);
  }

  private paintBomb() {
    if (this.slideState || this.completeAt !== null || this.bombAnim) return;
    const targets = this.bombTargets();
    if (!targets.length || !this.spend('bombs')) return;
    const o = this.hud.bombOrigin();
    const local = this.board.toLocal({ x: o.x, y: o.y });
    this.bombAnim = { t: 0, from: { x: local.x, y: local.y }, targets };
    this.sound.launch();
  }

  private bombAnim: { t: number; from: Point; targets: Point[] } | null = null;
  private bombG = new Graphics();

  private stepBomb(dt: number) {
    const b = this.bombAnim;
    const g = this.bombG;
    g.clear();
    if (!b) return;
    b.t += dt;
    const flight = 520;
    const r = this.cell * 0.42;
    b.targets.forEach((tp, i) => {
      const start = i * 70;
      const p = Math.min(1, Math.max(0, (b.t - start) / flight));
      if (p <= 0) return;
      const to = this.board.cellCenter(tp.x, tp.y);
      const x = b.from.x + (to.x - b.from.x) * p;
      const arc = Math.sin(p * Math.PI) * this.cell * 2.2;
      const y = b.from.y + (to.y - b.from.y) * p - arc;
      if (p < 1) {
        g.circle(x, y + arc * 0.25 + r * 0.3, r * (1 - p * 0.3)).fill({ color: 0x000000, alpha: 0.12 });
        g.circle(x, y, r * (1.25 - p * 0.45)).fill({ color: this.look.paint });
        g.circle(x - r * 0.3, y - r * 0.35, r * 0.28).fill({ color: 0xffffff, alpha: 0.55 });
      } else if (!this.painted.has(this.key(tp))) {
        this.painted.set(this.key(tp), this.time);
        this.speckle(tp);
        this.boardFx.splash(to.x, to.y, 0, -1, 8, this.look.paint, this.cell * 3, this.cell * 0.08, (x, y, rr) => this.addDot(x, y, rr));
        this.boardFx.ring(to.x, to.y, this.cell * 0.6, 0xffffff);
        this.sound.thock(0.7);
        this.sound.paintTile();
        this.vibrate(10);
        this.updateRemaining();
      }
    });
    if (b.t > flight + b.targets.length * 70 + 40) {
      this.bombAnim = null;
      g.clear();
      if (this.painted.size >= this.floorTotal) this.beginComplete();
    }
  }

  // ---------------------------------------------------------------- frame

  private tick(rawDt: number) {
    const dt = Math.min(rawDt, 50) * this.timeScale;
    this.lastFrameDt = rawDt;
    this.time += rawDt;
    const time = this.time;

    this.stepSlide(dt);
    this.stepBomb(dt);
    this.stepComplete();
    if (this.autoNextAt !== null && this.time >= this.autoNextAt) this.nextLevel();

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
      n.vx += (-230 * n.x - 17 * n.vx) * s;
      n.vy += (-230 * n.y - 17 * n.vy) * s;
      n.x += n.vx * s;
      n.y += n.vy * s;
    }
    const { cx, cy } = this.layoutCache ?? (this.layoutCache = this.layout());
    if (!this.tweens.length) this.board.scale.set(1 + this.scaleKick * 0.05);
    this.board.position.set(cx + n.x + this.enterX, cy + n.y);

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
        this.boardFx.splash(this.ball.x, this.ball.y, 0, 1, 7, this.look.paint, this.cell * 2.2, this.cell * 0.07,
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

    if (this.dots.length > 40 && time - this.dots[0].t > 1100) this.dots = this.dots.filter((d) => time - d.t < 1100);
    const stroke: PaintStroke = {
      painted: this.painted,
      dots: this.dots,
      splats: this.splats,
      startRound: this.moves === 0 && !this.slideState ? this.key(this.level.start) : undefined,
      shimmer: this.shimmer,
    };
    if (this.cone) {
      const fade = this.cone.endedAt === null ? 1 : Math.max(0, 1 - (time - this.cone.endedAt) / 380);
      this.board.drawCone(this.cone.from, this.cone.to, fade);
      if (fade <= 0) this.cone = null;
    } else this.board.drawCone(null, { x: 0, y: 0 }, 0);
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
