import { Application, Container, Graphics } from 'pixi.js';
import { Sound } from '../audio/sound.ts';
import { DIRS, floorCount, isFloor, SAW, slide, solve, type Dir, type Level, type Point, isCurve } from '../levels/core.ts';
import { getLevel } from '../levels/list.ts';
import type { Hud, ShopItem, ShopTab, VaultKind } from '../ui/hud.ts';
import { BALL_URLS } from './assets.ts';
import { BALLS, hexCss, PAINTS } from './cosmetics.ts';
import { league, loadSave, PRICES, storeSave, timeLeft, type Save } from './meta.ts';
import { Ball, renderSphere } from './Ball.ts';
import { Board, type PaintStroke } from './Board.ts';
import { Fx } from './fx.ts';
import { boardLight, type BoardLight } from './shaders.ts';
import { THEMES, type Theme } from './themes.ts';

interface Slide {
  dir: Dir;
  /** Direction when the slide ends (curves can turn the ball). */
  endDir: Dir;
  from: Point;
  path: Point[];
  /** Indices into `path` of curve tiles that turned the ball. */
  turns: number[];
  /** The slide runs into a saw blade. */
  saw?: Point;
  t: number;
  dur: number;
  done: number;
}

type XY = { x: number; y: number };

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

/** Ease out with a gentle overshoot (about 4%). */
const easeOutSoft = (p: number) => 1 + 1.6 * (p - 1) ** 3 + 0.6 * (p - 1) ** 2;
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
  /** Sideways drift (px/s), used for parallax while boards change. */
  vx = 0;
  update(dt: number, time: number, w: number, h: number, theme: Theme) {
    const g = this.g;
    g.clear();
    for (const p of this.parts) {
      // Bigger (closer) particles drift faster: cheap depth.
      p.x += this.vx * dt * (0.4 + Math.min(1, p.r / 30) * 0.6);
      if (p.x < -p.r * 2) p.x += w + p.r * 4;
      else if (p.x > w + p.r * 2) p.x -= w + p.r * 4;
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
  private turnDamp = 1;
  private light: BoardLight | null = null;
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
      anyInput: () => this.sound.unlock(),
      click: () => this.sound.click(),
    });
    hud.updateMode();
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
    window.addEventListener('resize', () => {
      this.hud.updateMode();
      this.invalidateLayout();
    });
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
    return { ...this.theme, paint: p.paint, paintDark: p.dark, paintLight: p.light, cone: p.cone };
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
        unlock: this.save.owned.includes(b.id) ? 1 : b.unlock,
        kind: 'ball' as const,
        preview: `background-image: url(${b.image ? BALL_URLS[b.image] : this.spherePreview(b.id, b.colors!, b.metal)})`,
      })),
      paint: PAINTS.map((p) => ({
        id: p.id,
        name: p.name,
        unlock: this.save.owned.includes(p.id) ? 1 : p.unlock,
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

  private previews = new Map<string, string>();

  /** Same lit-sphere render as in game, cached as an image for the shop. */
  private spherePreview(id: string, colors: [string, string, string], metal?: boolean): string {
    let url = this.previews.get(id);
    if (!url) {
      url = renderSphere(128, colors, metal).toDataURL();
      this.previews.set(id, url);
    }
    return url;
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

  /**
   * Three keys open the key vault. Every visit is guaranteed one prize: the
   * card closest to complete is the target, and locks reveal it until it is
   * won; later locks give near misses that carry over to the next visit.
   */
  private openVault() {
    this.chestPending = true;
    const v = this.save.vault;
    const kinds: VaultKind[] = ['hint', 'item', 'coins'];
    const top = Math.max(...kinds.map((k) => v[k]));
    const best = kinds.filter((k) => v[k] === top);
    const target = best[Math.floor(Math.random() * best.length)];
    let won = false;
    this.hud.vault({
      dots: { ...v },
      keys: 3,
      pick: () => {
        if (!won) return target;
        const near = kinds.filter((k) => this.save.vault[k] < 2);
        const pool = near.length ? near : kinds;
        return pool[Math.floor(Math.random() * pool.length)];
      },
      onDot: (k, n) => {
        this.save.vault[k] = n;
        this.persist();
      },
      win: (k) => {
        won = true;
        this.save.vault[k] = 0;
        let label = '';
        if (k === 'hint') {
          this.save.hints += 1;
          label = '+1 Hint';
        } else if (k === 'coins') {
          this.save.coins += 100;
          label = '+100';
        } else {
          const next = this.nextLockedItem();
          if (next) {
            this.save.owned.push(next.id);
            label = `${next.name}!`;
            this.hud.setShopDot(true);
          } else {
            this.save.coins += 150;
            label = '+150';
          }
        }
        this.hud.setCoins(this.save.coins);
        this.refreshPrices();
        this.persist();
        return label;
      },
      onDone: () => {
        this.chestPending = false;
        this.save.keys = 0;
        this.hud.setKeys(0);
        this.persist();
        this.autoNextAt = this.time + 250;
      },
      sound: {
        click: () => this.sound.click(),
        thock: (x) => this.sound.thock(x),
        coin: () => this.sound.coin(),
        star: (i) => this.sound.star(i),
        complete: () => this.sound.complete(),
      },
    });
  }

  /** The next ball or paint the player has not unlocked yet. */
  private nextLockedItem(): { id: string; name: string } | null {
    const owned = new Set(this.save.owned);
    const pool = [...BALLS, ...PAINTS]
      .filter((x) => x.unlock > this.save.best && !owned.has(x.id))
      .sort((a, b) => a.unlock - b.unlock);
    return pool[0] ?? null;
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
    if (this.completeAt !== null || this.hud.modalOpen || this.dead) return;
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
    this.floorTotal = floorCount(this.level.grid);
    this.resetState();
    const old = this.board;
    this.buildBoard();
    if (animate && old) {
      // Like a carousel: the finished board lifts, then swings out left with
      // a slight tilt; the next one swings in from the right, settles with a
      // soft overshoot and a sweep of light. The background drifts along.
      this.boardHolder.addChild(old);
      const ox = old.x;
      const os = old.scale.x;
      const w = this.app.screen.width;
      const outDist = w * 0.5 + old.boardWidth * 0.6;
      this.tweens.push({
        t: 0,
        dur: 480,
        step: (p) => {
          const lift = Math.sin(Math.min(1, p / 0.28) * Math.PI * 0.5);
          const go = Math.max(0, (p - 0.18) / 0.82) ** 2.3;
          old.position.set(ox - outDist * go, old.y - lift * 6 * (1 - go));
          old.rotation = -0.07 * go;
          old.scale.set(os * (1 + 0.035 * lift - 0.1 * go));
          old.alpha = 1 - Math.max(0, (go - 0.55) / 0.45);
        },
        done: () => old.destroy(),
      });
      const inDist = w * 0.5 + this.board.boardWidth * 0.6;
      this.enter = { x: inDist, rot: 0.08, s: 0.9 };
      this.board.alpha = 0;
      this.tweens.push({
        t: -250,
        dur: 640,
        step: (p) => {
          const e = easeOutSoft(p);
          this.enter = { x: inDist * (1 - e), rot: 0.08 * (1 - e), s: 0.9 + 0.1 * e };
          this.board.alpha = Math.min(1, p * 3);
        },
        done: () => {
          this.enter = { x: 0, rot: 0, s: 1 };
          this.introSweepAt = this.time;
        },
      });
      this.tweens.push({
        t: 0,
        dur: 900,
        step: (p) => (this.ambient.vx = -Math.sin(p * Math.PI) * w * 0.55),
        done: () => (this.ambient.vx = 0),
      });
      this.introAt = this.time + 600;
      this.painted.set(this.key(this.pos), this.introAt + 330);
      this.hud.popLevel();
    } else if (old) {
      old.destroy();
    }
    this.hud.setLevel(n, !!this.level.bonus, this.level.par);
    this.hud.setMoves(0);
    this.hud.hideResult();
    // First time a new tile type appears, say what it does.
    const has = (f: (c: number) => boolean) => this.level.grid.some((row) => row.some(f));
    const fresh = [
      { id: 'curves', on: has(isCurve), text: 'Curved corners swing the ball around!' },
      { id: 'saws', on: has((c) => c === SAW), text: 'Watch out for the saws!' },
    ].find((t) => t.on && !this.save.tips.includes(t.id));
    if (fresh) {
      this.save.tips.push(fresh.id);
      this.persist();
    }
    this.hud.showTip(n === 1 ? 'Swipe to roll the ball' : (fresh?.text ?? null));
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
    const ins = this.hud.insets();
    const cols = this.level.grid[0].length;
    const rows = this.level.grid.length;
    const gutter = this.hud.landscape ? 20 : 12;
    const availW = Math.max(120, w - ins.left - ins.right - gutter * 2);
    const availH = Math.max(120, h - ins.top - ins.bottom - 16);
    // The outer wall ring is mostly hidden, so it needs less room.
    const cell = Math.floor(Math.max(16, Math.min(availW / (cols - 0.7), availH / (rows - 0.7), 96)));
    return { cell, cx: ins.left + gutter + availW / 2, cy: ins.top + 8 + availH / 2 };
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
    // A soft pool of light follows the ball across the board.
    this.light = boardLight(cell * 3.2 * res);
    board.filters = [this.light];
    // Fresh bomb layer per board: the old one is destroyed with its board.
    this.bombG = new Graphics();
    board.fxLayer.addChild(this.bombG);
    this.bombAnim = null;
    const skin = BALLS.find((x) => x.id === this.save.ball) ?? BALLS[0];
    this.ball = new Ball(cell, res, skin, board.ballLayer);
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
        if (isFloor(this.level.grid, x, y) && c !== undefined && !this.painted.has(this.key({ x, y }))) out.push({ x, y });
      }),
    );
    this.remaining = out;
  }

  // ---------------------------------------------------------------- moves

  private startSlide(dir: Dir) {
    const r = slide(this.level.grid, this.pos, dir);
    const d = DIRS[dir];
    if (!r.path.length && !r.saw) {
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
    this.slideState = { dir, endDir: r.dir, from: { ...this.pos }, path: r.path, turns: r.turns, saw: r.saw, t: 0, dur: 40 + 19 * Math.max(1, len) ** 0.9, done: 0 };
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
    const sp = this.slidePoint(s, dist);
    const d = sp.dir;
    this.lastDir = d;
    // Ease off the squash and stretch while swinging round a curve.
    this.turnDamp += ((sp.turning ? 0.3 : 1) - this.turnDamp) * Math.min(1, dt / 40);
    while (s.done < s.path.length && dist >= s.done + 0.55) {
      const cellP = s.path[s.done];
      const k = this.key(cellP);
      if (!this.painted.has(k)) {
        this.painted.set(k, this.time);
        this.sound.paintTile();
        this.speckle(cellP);
      }
      this.sprayTile(cellP, d);
      s.done++;
    }
    this.placeBall(sp.p);
    if (this.cone) {
      this.cone.from = sp.band.from;
      this.cone.to = sp.p;
    }
    if (p >= 1) this.arrive(s);
  }

  /**
   * Where the ball is `dist` cells into a slide. Straight runs are linear;
   * through a curve tile the ball follows a quarter arc. Also returns the
   * travel direction and the straight stretch of fresh paint behind it.
   */
  private slidePoint(s: Slide, dist: number): { p: XY; dir: XY; band: { from: XY; pos: XY }; turning?: boolean } {
    const pts: XY[] = [s.from, ...s.path];
    const end = pts.length - 1;
    const dd = Math.max(0, Math.min(end, dist));
    let segStart = s.from;
    for (const ti of s.turns) {
      const k = ti + 1;
      if (k >= end) continue; // stopped on the curve itself
      const c = pts[k];
      const a = pts[k - 1];
      const b = pts[k + 1];
      const dIn = { x: c.x - a.x, y: c.y - a.y };
      const dOut = { x: b.x - c.x, y: b.y - c.y };
      if (dd >= k - 0.5 && dd <= k + 0.5) {
        const t = dd - (k - 0.5);
        const A = { x: c.x - dIn.x * 0.5, y: c.y - dIn.y * 0.5 };
        const B = { x: c.x + dOut.x * 0.5, y: c.y + dOut.y * 0.5 };
        const u = 1 - t;
        const p = { x: u * u * A.x + 2 * u * t * c.x + t * t * B.x, y: u * u * A.y + 2 * u * t * c.y + t * t * B.y };
        return { p, dir: t < 0.5 ? dIn : dOut, band: { from: c, pos: c }, turning: true };
      }
      if (dd > k + 0.5) segStart = c;
    }
    const i = Math.min(end - 1, Math.floor(dd));
    const f = dd - i;
    const a = pts[i];
    const b = pts[Math.min(end, i + 1)];
    const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    const dir = end > 0 ? { x: b.x - a.x, y: b.y - a.y } : DIRS[s.dir];
    return { p, dir, band: { from: segStart, pos: p } };
  }

  private arrive(s: Slide) {
    const d = DIRS[s.endDir];
    this.pos = s.path[s.path.length - 1] ?? s.from;
    this.slideState = null;
    if (s.saw) {
      this.updateRemaining();
      this.die(s.saw, d);
      return;
    }
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

  /**
   * Wet spray as the ball rolls through a tile (painted or not): glossy
   * droplets in three shades burst out to both sides of the path, plus a
   * little glitter in the trail.
   */
  private sprayTile(p: Point, d: XY) {
    const c = this.board.cellCenter(p.x, p.y);
    const cell = this.cell;
    const shades = [this.look.paint, this.look.paintDark, this.look.paintLight, this.look.paint];
    const nx = -d.y;
    const ny = d.x;
    const n = 6 + Math.floor(Math.random() * 4);
    // Droplets stay on the floor: next to a wall they hug the corridor.
    const open = (side: number) => isFloor(this.level.grid, p.x + nx * side, p.y + ny * side);
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const free = open(side);
      const off = (0.16 + Math.random() * (free ? 0.55 : 0.16)) * side;
      const along = (Math.random() - 0.5) * 0.9;
      const big = Math.random() < 0.2;
      const r = cell * (big ? 0.07 + Math.random() * 0.05 : 0.025 + Math.random() * 0.045);
      const sp = cell * (free ? 1.2 + Math.random() * 2.2 : 0.2 + Math.random() * 0.4);
      this.boardFx.blob(
        c.x + nx * off * cell + d.x * along * cell,
        c.y + ny * off * cell + d.y * along * cell,
        nx * side * sp - d.x * sp * 0.3,
        ny * side * sp - d.y * sp * 0.3,
        r,
        shades[Math.floor(Math.random() * shades.length)],
        420 + Math.random() * 380,
      );
    }
    for (let i = 0; i < 2; i++)
      this.boardFx.glint(c.x + (Math.random() - 0.5) * cell * 0.5, c.y + (Math.random() - 0.5) * cell * 0.5, cell * 0.07, 0xffffff);
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

  private dead = false;

  /**
   * The ball rolled into a saw: it is pushed into the blade and sliced in
   * two, sparks fly, the board shakes, then the revive offer appears.
   */
  private die(saw: Point, dir: Point) {
    this.dead = true;
    this.queued = null;
    this.hint = null;
    const from = { x: this.ball.x, y: this.ball.y };
    const c = this.board.cellCenter(saw.x, saw.y);
    this.tweens.push({
      t: 0,
      dur: 110,
      step: (p) => this.ball.position.set(from.x + (c.x - from.x) * 0.5 * p, from.y + (c.y - from.y) * 0.5 * p),
      done: () => {
        const hx = (this.ball.x + c.x) / 2;
        const hy = (this.ball.y + c.y) / 2;
        this.ball.split(dir);
        this.board.sawHit(this.time);
        this.boardFx.sparkle(hx, hy, 16, this.cell * 1.8, 0xffd27a);
        this.boardFx.flash(hx, hy, this.cell * 1.6, 0xff5a5a, 0.8);
        this.boardFx.splash(hx, hy, -dir.x, -dir.y, 10, this.look.paint, this.cell * 3.4, this.cell * 0.08, (x, y, r) => this.addDot(x, y, r));
        this.nudge.vx -= dir.x * 260 + 120;
        this.nudge.vy -= dir.y * 260;
        this.hud.hurt();
        this.sound.thock(1.3);
        this.sound.bump();
        this.vibrate([40, 30, 60]);
      },
    });
    window.setTimeout(() => {
      if (!this.dead) return;
      this.hud.revive({
        level: this.levelNo,
        streak: this.save.streak,
        seconds: 9,
        tick: () => this.sound.click(),
        onRevive: () => {
          // Undo the fatal move and drop the ball back in.
          this.dead = false;
          this.ball.unsplit();
          this.undo();
          this.introAt = this.time;
          this.landed = false;
        },
        onGiveUp: () => {
          this.dead = false;
          this.ball.unsplit();
          this.restart();
        },
      });
    }, 950);
  }

  undo() {
    this.sound.unlock();
    if (this.slideState || this.completeAt !== null || this.dead) return;
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
    if (this.completeAt !== null || this.dead) return;
    if (this.moves === 0) return;
    this.restartedThisLevel = true;
    if (this.save.streak > 0) {
      this.hud.toast('Streak lost');
      this.save.streak = 0;
      this.hud.streakLost();
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
    if (this.slideState || this.completeAt !== null || this.dead) return;
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
      this.screenFx.confetti(this.app.screen.width, this.app.screen.height, 120, [
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
      const leagueBefore = league(this.save.week, this.save.weekStars).rows;
      if (!this.level.bonus) {
        this.save.coins += coins;
        this.save.weekStars += stars;
      }
      this.save.streak = this.restartedThisLevel ? 0 : this.save.streak + 1;
      const key = this.save.keys < 3 && (this.level.bonus || Math.random() < 0.34);
      if (key) this.save.keys++;
      this.persist();
      this.hud.setStreak(this.save.streak, this.save.streak > 0);
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
        if (key) window.setTimeout(onKey, 600);
        this.bonusFlow(stars + 2, coins, leagueBefore);
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
  /** Offset, tilt and scale of the incoming board during a transition. */
  private enter = { x: 0, rot: 0, s: 1 };
  private introSweepAt = -1e9;
  private autoNextAt: number | null = null;
  private landed = false;

  private restartedThisLevel = false;

  /** Bonus level: Super Reward multiplier, then the league climb, then on. */
  private bonusFlow(stars: number, coins: number, before: ReturnType<typeof league>['rows']) {
    this.hud.superReward(
      stars,
      coins,
      (m) => {
        this.save.coins += coins * m;
        this.save.weekStars += stars * m;
        this.persist();
        this.vibrate(25);
        window.setTimeout(() => {
          this.hud.setCoins(this.save.coins);
          this.sound.coin();
        }, 1200);
      },
      () => {
        const after = league(this.save.week, this.save.weekStars).rows;
        this.refreshLeague(false);
        this.hud.leagueClimb(before, after, timeLeft(), () => this.nextLevel(), () => this.sound.click());
      },
      { tick: () => this.sound.click(), win: () => this.sound.complete() },
    );
  }

  /** Progress toward the next unlock after a level, or the unlock itself. */
  private showUnlockProgress(prevBest: number, best: number) {
    if (best <= prevBest) return;
    // Never stack on top of a reward screen or panel; wait for it to close.
    if (this.hud.modalOpen) {
      window.setTimeout(() => this.showUnlockProgress(prevBest, best), 400);
      return;
    }
    const items = this.shopItems();
    const all = [...items.ball, ...items.paint, ...items.board].sort((a, b) => a.unlock - b.unlock);
    const just = all.find((x) => x.unlock > prevBest && x.unlock <= best);
    if (just) {
      this.sound.complete();
      this.hud.unlocked(just.name, just.preview, () => this.equip(just.kind, just.id));
      this.checkUnlocks();
      return;
    }
    const next = all.find((x) => x.unlock > best);
    if (!next) return;
    const prevMilestone = Math.max(1, ...all.filter((x) => x.unlock <= best).map((x) => x.unlock));
    const need = next.unlock - prevMilestone;
    this.hud.newItemProgress(`New ${next.kind}: ${next.name}`, next.preview, prevBest - prevMilestone, best - prevMilestone, need);
  }

  nextLevel() {
    // Ignore taps in the first moment so the stars can land.
    if (!this.resultShown || this.time - this.resultAt < 450) return;
    // Three keys: open the treasure chest before moving on.
    if (this.save.keys >= 3 && !this.chestPending) {
      this.autoNextAt = null;
      this.hud.endCelebrate();
      this.hud.hideResult();
      this.openVault();
      return;
    }
    if (this.chestPending) return;
    this.autoNextAt = null;
    this.hud.hideResult();
    this.hud.endCelebrate();
    const prevBest = this.save.best;
    this.loadLevel(this.levelNo + 1, true);
    window.setTimeout(() => this.showUnlockProgress(prevBest, this.save.best), 650);
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
    this.enter = { x: 0, rot: 0, s: 0.94 };
    this.tweens.push({ t: 0, dur: 420, step: (p) => (this.enter = { x: 0, rot: 0, s: 0.94 + 0.06 * easeOutBack(p) }) });
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

  private vibrate(ms: number | number[]) {
    if (!this.save.vibe || !('vibrate' in navigator)) return;
    try {
      navigator.vibrate(ms);
    } catch {
      /* not allowed */
    }
  }

  // ---------------------------------------------------------------- booster

  /**
   * Paint shooter targeting: three tiles that together save the most moves.
   * Candidates are dead-end tips (corridor ends), the tips of the least
   * productive moves in the best solution, and every remaining tile when only
   * a few are left. Each candidate grows into a tight cluster inside its
   * pocket and is scored with the solver; ties go to the deepest pocket.
   */
  private bombTargets(): Point[] {
    const grid = this.level.grid;
    const painted = new Set(this.painted.keys());
    const unpainted = (c: Point) => isFloor(grid, c.x, c.y) && !painted.has(this.key(c));
    if (this.remaining.length <= 3) return [...this.remaining];
    const sol = solve(grid, this.pos, painted, 200000);
    const neighbours = (c: Point) => Object.values(DIRS).map((d) => ({ x: c.x + d.x, y: c.y + d.y }));
    const floorDegree = (c: Point) => neighbours(c).filter((n) => isFloor(grid, n.x, n.y)).length;
    // Grow a cluster of up to 3 unpainted tiles, preferring narrow tiles so it
    // stays inside the pocket.
    const cluster = (seed: Point): Point[] => {
      const out = [seed];
      const inCluster = new Set([this.key(seed)]);
      while (out.length < 3) {
        const options = out
          .flatMap(neighbours)
          .filter((n) => unpainted(n) && !inCluster.has(this.key(n)))
          .sort((a, b) => floorDegree(a) - floorDegree(b));
        if (!options.length) break;
        inCluster.add(this.key(options[0]));
        out.push(options[0]);
      }
      return out;
    };
    const seeds: Point[] = this.remaining.filter((c) => floorDegree(c) <= 1);
    if (sol) {
      const seen = new Set(painted);
      let p = this.pos;
      const moves: Point[][] = [];
      for (const dir of sol) {
        const r = slide(grid, p, dir);
        const fresh = r.path.filter((c) => !seen.has(this.key(c)));
        fresh.forEach((c) => seen.add(this.key(c)));
        moves.push(fresh);
        p = r.end;
      }
      moves
        .filter((m) => m.length > 0)
        .sort((a, b) => a.length - b.length)
        .slice(0, 4)
        .forEach((m) => seeds.push(m[m.length - 1]));
    }
    // Tiles your next swipe could paint anyway are a wasted shot.
    const oneSwipe = new Set<number>();
    for (const dir of Object.keys(DIRS) as Dir[]) for (const c of slide(grid, this.pos, dir).path) oneSwipe.add(this.key(c));
    const dist = (c: Point) => Math.abs(c.x - this.pos.x) + Math.abs(c.y - this.pos.y);
    // Corners and narrow spots across the board, farthest from the ball first.
    this.remaining
      .filter((c) => floorDegree(c) <= 2 && !oneSwipe.has(this.key(c)))
      .sort((a, b) => dist(b) - dist(a))
      .slice(0, 6)
      .forEach((c) => seeds.push(c));
    const unique = new Map(seeds.map((c) => [this.key(c), c]));
    let best: { tiles: Point[]; score: number } | null = null;
    for (const seed of [...unique.values()].slice(0, 12)) {
      const tiles = cluster(seed);
      const after = new Set(painted);
      tiles.forEach((c) => after.add(this.key(c)));
      const rest = sol ? solve(grid, this.pos, after, 100000) : null;
      const saved = sol && rest ? sol.length - rest.length : 0;
      // Moves saved dominate; then pocket depth (narrow tiles) and distance.
      const narrow = tiles.filter((t) => floorDegree(t) <= 2).length;
      const easy = tiles.every((t) => oneSwipe.has(this.key(t)));
      const score = saved * 100 + narrow * 4 + dist(seed) * 0.5 - (easy ? 250 : 0);
      if (!best || score > best.score) best = { tiles, score };
    }
    return best?.tiles ?? this.remaining.slice(0, 3);
  }

  private paintBomb() {
    if (this.slideState || this.completeAt !== null || this.bombAnim || this.dead) return;
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
    const aim = 420;
    const flight = 460;
    const r = this.cell * 0.42;
    // Lock-on: target rings close in on each tile before the shots fly.
    if (b.t < aim + 3 * 70 + flight) {
      for (const tp of b.targets) {
        const c = this.board.cellCenter(tp.x, tp.y);
        const k = Math.min(1, b.t / aim);
        const ring = this.cell * (0.9 - 0.45 * k);
        const pulse = 0.65 + 0.35 * Math.sin(this.time * 0.02);
        g.circle(c.x, c.y, ring).stroke({ color: 0xffffff, width: this.cell * 0.07, alpha: 0.9 * pulse });
        for (const [ux, uy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          g.moveTo(c.x + ux * ring * 0.7, c.y + uy * ring * 0.7)
            .lineTo(c.x + ux * ring * 1.25, c.y + uy * ring * 1.25)
            .stroke({ color: 0xffffff, width: this.cell * 0.06, alpha: 0.85 * pulse, cap: 'round' });
      }
    }
    const shotT = b.t - aim;
    b.targets.forEach((tp, i) => {
      const start = i * 70;
      const p = Math.min(1, Math.max(0, (shotT - start) / flight));
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
    if (shotT > flight + b.targets.length * 70 + 40) {
      this.bombAnim = null;
      g.clear();
      if (this.painted.size >= this.floorTotal) this.beginComplete();
    }
  }

  // ---------------------------------------------------------------- frame

  private tick(rawDt: number) {
    // Cap long frames so slow devices skip ahead rather than crawl.
    const dt = Math.min(rawDt, 90) * this.timeScale;
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
    const e = this.enter;
    this.board.scale.set(e.s * (1 + this.scaleKick * 0.05));
    this.board.rotation = e.rot;
    this.board.position.set(cx + n.x + e.x, cy + n.y);
    if (this.completeAt === null) {
      const sweep = (time - this.introSweepAt) / 750;
      if (sweep >= 0 && sweep < 1.5) this.board.drawSweep(sweep, 0.6);
    }

    const moving = !!this.slideState;
    const speed = this.slideState ? (this.slideState.path.length / (this.slideState.dur / 1000) / 30) * this.turnDamp : 0;
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
      const p = Math.min(1, st.t / st.dur);
      const dist = p * (0.6 + 0.4 * p) * st.path.length;
      stroke.active = this.slidePoint(st, dist).band;
    }
    if (this.light) {
      const b = this.board.getBounds();
      const p = this.ball.getGlobalPosition();
      const res = this.app.renderer.resolution;
      this.light.uniforms.uLight[0] = (p.x - b.x) * res;
      this.light.uniforms.uLight[1] = (p.y - b.y) * res;
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
