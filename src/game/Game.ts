import { Application, BlurFilter, Container, Graphics, Rectangle, RenderTexture, type Renderer, Sprite, Texture, TilingSprite } from 'pixi.js';
import { Sound } from '../audio/sound.ts';
import { analyze, ARROW_R, ARROW_U, DIRS, floorCount, isFloor, nextPaintingMove, PORTAL_A, SAW, slide, solve, solveMulti, splitDirs, STOPPER, type Dir, type Level, type Point, type SlideResult, isCurve, COIN, KEY, MULT } from '../levels/core.ts';
import { getLevel } from '../levels/list.ts';
import { prefetchLevels } from '../levels/prefetch.ts';
import type { EventView, Hud, ShopItem, ShopTab, VaultKind } from '../ui/hud.ts';
import { BALLS, PAINTS, PATTERN_MODE } from './cosmetics.ts';
import { dayIndex, eraseSave, league, loadSave, PRICES, storeSave, timeLeft, type Save } from './meta.ts';
import { Ball, ballCanvas, ballPreview } from './Ball.ts';
import { Board, SPREAD_MS, type PaintStroke } from './Board.ts';
import { haptic } from '../platform/haptics.ts';
import { adsAvailable, gameplayStart, getPlayer, onPlayerChange, gameplayStop, happytime, hideBanner, midgameAd, onPortalMute, refreshBanner, rewardedAd, showBanner } from '../platform/ads.ts';
import { Fx } from './fx.ts';
import { boardKey, boardPreview, paintKey, paintPreview, peekPreview } from './previews.ts';
import { boardLight, paintGloss, type BoardLight } from './shaders.ts';
import { Confetti } from './confetti.ts';
import { slabTexture } from './slabs.ts';
import { THEMES, type Theme } from './themes.ts';
import { liveEvent, type EventPrize } from './events.ts';
import { Trail, TRAILS, trailPreview } from './trail.ts';

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
  /** Indices into `path` reached through a portal. */
  jumps: number[];
  t: number;
  dur: number;
  done: number;
}

type XY = { x: number; y: number };

/** Screens that may carry the banner ad (see showBanner). */
/** A video offer lasts three hours and takes three videos (five for a trail). */
const OFFER_MS = 3 * 60 * 60 * 1000;
const offerAds = (kind: ShopTab) => (kind === 'trail' ? 5 : 3);
/** Event video boost: levels it counts for, and how many a day. */
const EVENT_BOOST = 2;
const EVENT_BOOSTS_A_DAY = 4;
/** Unlock level that hides an item: an event item its event ended without. */
const EVENT_GONE = 99999;
const BANNER_SCREENS = ['shop', 'settings', 'league', 'vault', 'super', 'climb'];
/**
 * Banner during play too? Off: CrazyGames' ad requirements forbid banners
 * during gameplay, so it shows on the menu and reward screens only.
 */
const GAMEPLAY_BANNER = false;

interface Snapshot {
  pos: Point;
  /** Other balls (after an x3 split) and whether the split has happened. */
  extras: Point[];
  split: boolean;
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

/** Players who asked their system for less motion: no shake, no slow-mo. */
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    if (theme.ambient === 'none') return;
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

/** Rich tile colours behind the balls in the shop (light, deep). */
/** Ball card colours: a bright tone and a deep one per card, rich and candy-like. */
const TILE_COLORS: [string, string][] = [
  ['#ff4fa3', '#c2005e'],
  ['#2ad4ff', '#0b4fe0'],
  ['#b57bff', '#5212d6'],
  ['#21eb8f', '#008a52'],
  ['#ffae2e', '#e83d00'],
  ['#ffe03a', '#f07a00'],
];

export class Game {
  readonly sound = new Sound();
  private readonly save: Save;
  private theme: Theme;
  private readonly world = new Container();
  private readonly ambient: Ambient;
  private readonly boardHolder = new Container();
  private board!: Board;
  private ball!: Ball;
  private boardFx!: Fx;
  private levelNo: number;
  private level!: Level;
  private floorTotal = 0;
  private pos: Point = { x: 0, y: 0 };
  private painted = new Map<number, number>();
  /** Which way the paint flowed into each tile (0 across, 1 down, 2 both). */
  private paintAxis = new Map<number, number>();
  private dots: PaintStroke['dots'] = [];
  private splats: PaintStroke['splats'] = [];
  private introAt = 0;
  private sparkQueue: { x: number; y: number; at: number; kick?: { x: number; y: number } }[] = [];
  /** When the ball last rolled over each tile, and which way (see Board). */
  private wet = new Map<number, { t: number; axis: number }>();
  /** The speed cone behind the sliding ball: where its run began, and when it stopped. */
  private cone: { from: XY; endedAt: number | null } | null = null;
  /** The cone's colour: the ball's own, a touch paler. */
  private coneColor = 0xffffff;
  private moves = 0;
  private history: Snapshot[] = [];
  private slideState: Slide | null = null;
  private queued: Dir | null = null;
  private lastDir: Point | null = null;
  private turnDamp = 1;
  private warping = false;
  /** Collectibles already picked up on this level (kept through a revive's step back). */
  private collected = new Set<number>();
  /** The page's material for textured themes, behind everything. */
  private readonly pageBg = new TilingSprite({ texture: Texture.WHITE, width: 1, height: 1 });
  /** Confetti over the whole screen when a level is done. */
  private readonly confetti = new Confetti();
  private confettiAt = -1;
  /** Balls split off by the x3 tile, each with its own slide while rolling. */
  private extras: { pos: Point; ball: Ball; slide: Slide | null; lastDir: XY; born: number }[] = [];
  /** The x3 tile has split the ball on this attempt. */
  private splitUsed = false;
  private ballRes = 1;
  private light: BoardLight | null = null;
  private completeAt: number | null = null;
  private resultShown = false;
  /** The next move to show: where the ball is and the slide to make. */
  private hint: { from: Point; path: Point[]; dir: Point; since: number } | null = null;
  /** A hint was used on this level: keep guiding, move by move, to the end. */
  private hintGuide = false;
  /** State the guide last solved for, so it solves once per position. */
  private guideKey = '';
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
    keepOldUnlocks(this.save);
    this.theme = THEMES.find((t) => t.id === this.save.theme) ?? THEMES[0];
    this.look = this.makeLook();
    this.hud.setPaintColors(this.look.paint, this.look.paintLight, this.look.paintDark);
    this.levelNo = Math.max(1, this.save.level);
    this.sound.setEnabled(this.save.sound);
    this.sound.setMusic(this.save.music);
    // A textured page (wood, terrazzo...) fills the screen behind it all.
    app.stage.addChild(this.pageBg);
    app.stage.addChild(this.world);
    app.stage.addChild(this.confetti.g);
    this.ambient = new Ambient(this.world);
    this.world.addChild(this.boardHolder);

    hud.bind({
      restart: () => this.restart(),
      hint: () => this.showHint(),
      bomb: () => this.paintBomb(),
      next: () => this.nextLevel(),
      equip: (tab, id) => this.equip(tab, id),
      toggle: (what) => this.toggle(what),
      openShop: () => this.refreshShop(),
      sheet: (top) => this.focusAbove(top),
      openLeague: () => this.refreshLeague(true),
      anyInput: () => this.sound.unlock(),
      adUnlock: (tab, id) => {
        this.sound.click();
        const item = (tab === 'ball' ? BALLS : tab === 'paint' ? PAINTS : tab === 'trail' ? TRAILS : THEMES).find((x) => x.id === id);
        if (!item || !this.offerIds().includes(`${tab}:${id}`)) return;
        const key = `${tab}:${id}`;
        void rewardedAd(() => this.sound.setMuted(true), () => this.sound.setMuted(this.portalMuted)).then((ok) => {
          if (!ok) {
            this.hud.toast('No video available right now. Try again soon!');
            this.refreshShop();
            return;
          }
          const have = this.adsWatched(tab, id) + 1;
          this.save.adProgress[key] = have;
          if (have >= offerAds(tab)) {
            this.save.owned.push(id);
            this.persist();
            this.equip(tab, id);
            this.hud.toast(`${item.name} unlocked!`);
            this.sound.star(2);
          } else {
            this.persist();
            this.hud.toast(`${have}/${offerAds(tab)} — ${offerAds(tab) - have} more to unlock ${item.name}`);
          }
          this.refreshShop();
        });
      },
      openEvent: () => {
        this.sound.click();
        this.openEvent();
      },
      eventBoost: () => {
        this.sound.click();
        this.eventBoost();
      },
      startOver: () => {
        eraseSave();
        location.reload();
      },
      freeCoins: () => {
        this.sound.click();
        void rewardedAd(() => this.sound.setMuted(true), () => this.sound.setMuted(this.portalMuted)).then((ok) => {
          if (!ok) {
            this.hud.toast('No video available right now. Try again soon!');
            return;
          }
          this.save.coins += 80;
          this.hud.setCoins(this.save.coins);
          this.hud.toast('+80 coins');
          this.sound.coin();
          this.persist();
          // Then the offer rests for a few minutes.
          this.coinsReadyAt = Date.now() + 4 * 60 * 1000;
          this.hud.coinsCooldown(this.coinsReadyAt);
        });
      },
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
    // Never let one bad frame stop the game: an unexpected error is logged
    // and every ball is settled where it is, so play simply carries on.
    app.ticker.add((t) => {
      try {
        this.tick(t.deltaMS);
      } catch (err) {
        console.error(err);
        this.recover();
      }
    });
    window.addEventListener('resize', () => {
      this.hud.updateMode();
      this.invalidateLayout();
    });
    document.addEventListener('visibilitychange', () => this.sound.setMuted(document.hidden || this.portalMuted));
    onPortalMute((muted) => {
      this.portalMuted = muted;
      this.sound.setMuted(muted || document.hidden);
    });
    hud.setAdsAvailable(adsAvailable());
    // The league shows the player's CrazyGames name and picture when they
    // are logged in (and updates if they log in or out mid-game).
    const usePlayer = (p: Awaited<ReturnType<typeof getPlayer>>) => {
      this.hud.setPlayer(p);
      this.refreshLeague(false);
    };
    void getPlayer().then(usePlayer);
    onPlayerChange(usePlayer);
    // Ready ahead of the first swipe: the sound engine (slow to create) and
    // the paint's shaders (compiled on first use otherwise), so the first
    // move starts at once and runs smooth.
    window.setTimeout(() => {
      this.sound.prepare();
      this.warmShaders();
    }, 250);
    // Shop previews and the league's ball avatars are drawn in idle moments
    // after the start, so neither the first frame nor the shop waits.
    window.setTimeout(() => {
      this.shopItems();
      // One ball per idle slot: each pattern has its own small shader, so
      // drawing them all in one go would compile them all at once.
      for (const b of BALLS) this.queuePreview(`ball-art:${b.id}`, () => this.spherePreview(b.id));
      this.queuePreview('ball-art', () => this.hud.setBallArt(BALLS.map((b) => this.spherePreview(b.id))));
    }, 800);
    // HUD height changes once the web font arrives.
    void document.fonts?.ready.then(() => this.invalidateLayout());
  }

  private portalMuted = false;

  /** Compile the paint and blur shaders now, on a tiny offscreen render. */
  private warmShaders() {
    try {
      const s = new Sprite(Texture.WHITE);
      s.width = 8;
      s.height = 8;
      const gloss = paintGloss(1, this.look?.paintMode ?? 0);
      const blur = new BlurFilter({ strength: 2, quality: 3 });
      s.filters = [gloss, blur];
      const rt = RenderTexture.create({ width: 8, height: 8 });
      (this.app.renderer as Renderer).render({ container: s, target: rt });
      s.destroy();
      gloss.destroy();
      blur.destroy();
      rt.destroy(true);
    } catch {
      /* only a head start: the shaders still compile when first needed */
    }
  }

  /**
   * When the player last touched or pressed a key (performance.now). Load
   * counts as one, so background previews wait while a first move is likely.
   */
  private lastInputAt = performance.now();

  private persist() {
    this.save.level = this.levelNo;
    this.save.best = Math.max(this.save.best, this.levelNo);
    this.save.theme = this.theme.id;
    storeSave(this.save);
    // Coins or free uses may have changed: keep the tool prices current.
    this.refreshPrices();
  }

  /** The active board theme with the player's paint and ball choices applied. */
  private look!: Theme;

  private ballSkin() {
    return BALLS.find((b) => b.id === this.save.ball) ?? BALLS[0];
  }

  private makeLook(theme = this.theme): Theme {
    const p = PAINTS.find((x) => x.id === this.save.paint) ?? PAINTS[0];
    return {
      ...theme,
      paint: p.paint,
      paintDark: p.dark,
      paintLight: p.light,
      cone: p.cone,
      paintMode: p.pattern ? PATTERN_MODE[p.pattern] : 0,
      paintAlt: p.alt ?? p.light,
    };
  }

  // ---------------------------------------------------------------- meta

  private refreshPrices() {
    this.hud.setPrices({
      hint: { price: PRICES.hint, free: this.save.hints, ad: this.toolAd('hints'), short: this.save.coins < PRICES.hint },
      bomb: { price: PRICES.bomb, free: this.save.bombs, ad: this.toolAd('bombs'), short: this.save.coins < PRICES.bomb },
    });
  }

  /**
   * Out of free uses and short of the coin price: a video gives one go.
   * Coins are scarce, so this is the usual way to a hint once the free
   * ones are spent.
   */
  private toolAd(kind: 'hints' | 'bombs'): boolean {
    const price = kind === 'hints' ? PRICES.hint : PRICES.bomb;
    return adsAvailable() && this.save[kind] <= 0 && this.save.coins < price;
  }

  /** Spend one free use or its coin price. Returns false if unaffordable. */
  private spend(kind: 'hints' | 'bombs'): boolean {
    if (this.toolAd(kind)) {
      // The video gives one free use, which is spent right away.
      void rewardedAd(() => this.sound.setMuted(true), () => this.sound.setMuted(this.portalMuted)).then((ok) => {
        if (!ok) {
          this.hud.toast('No video available right now. Try again soon!');
          return;
        }
        this.save[kind] += 1;
        if (kind === 'hints') this.showHint();
        else this.paintBomb();
      });
      return false;
    }
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

  /**
   * Video offers: every shop tab always has one locked item on offer for
   * videos (three each; five for a trail), for three hours; then each tab
   * gets another. An item won stays won; one not finished keeps its videos
   * watched for whenever it is offered again.
   */
  private offerIds(): string[] {
    const now = Date.now();
    const o = this.save.offers;
    if (o && o.v === 2 && now < o.until && o.until - now <= OFFER_MS) return o.ids;
    const owned = new Set(this.save.owned);
    const kinds: [ShopTab, { id: string; unlock: number; event?: unknown; vault?: boolean }[]][] = [
      ['ball', BALLS],
      ['paint', PAINTS],
      ['trail', TRAILS],
      ['board', THEMES],
    ];
    const last = new Set(o?.ids ?? []);
    const ids: string[] = [];
    for (const [kind, list] of kinds) {
      const pool = list.filter((x) => !x.event && !x.vault && x.unlock > this.save.best && !owned.has(x.id));
      // Not the one this tab just had, while there are others to choose from.
      const fresh = pool.filter((x) => !last.has(`${kind}:${x.id}`));
      const from = fresh.length ? fresh : pool;
      if (from.length) ids.push(`${kind}:${from[Math.floor(Math.random() * from.length)].id}`);
    }
    this.save.offers = { until: now + OFFER_MS, ids, v: 2 };
    this.persist();
    return ids;
  }

  /** Videos watched toward an item (kept between its offers). */
  private adsWatched(kind: ShopTab, id: string): number {
    // Older saves counted by id alone.
    return this.save.adProgress[`${kind}:${id}`] ?? this.save.adProgress[id] ?? 0;
  }

  /**
   * An event item not yet won: its progress while the event runs, or
   * (once it is over) an unlock past reach, which keeps it out of the shop.
   */
  private eventFor(it: { id: string; event?: EventPrize }): Partial<ShopItem> {
    if (!it.event || this.save.owned.includes(it.id)) return {};
    const ev = liveEvent();
    if (!ev || ev.id !== it.event.id) return { unlock: EVENT_GONE };
    const have = this.save.eventLevels?.[ev.id] ?? 0;
    return { unlock: 1, event: { have, need: it.event.levels, until: ev.ends, icon: ev.icon, name: ev.name } };
  }

  /** Event items still to win, nearest first. */
  private eventPending(): { kind: ShopTab; id: string; name: string; need: number }[] {
    const ev = liveEvent();
    if (!ev) return [];
    const all = [
      ...BALLS.map((x) => ({ kind: 'ball' as ShopTab, x })),
      ...PAINTS.map((x) => ({ kind: 'paint' as ShopTab, x })),
      ...THEMES.map((x) => ({ kind: 'board' as ShopTab, x })),
    ];
    return all
      .filter(({ x }) => x.event?.id === ev.id && !this.save.owned.includes(x.id))
      .map(({ kind, x }) => ({ kind, id: x.id, name: x.name, need: x.event!.levels }))
      .sort((a, b) => a.need - b.need);
  }

  /** A level won during an event counts toward its items. */
  private advanceEvent(): { kind: ShopTab; id: string; name: string; need: number; prev: number; have: number; won: boolean } | null {
    const ev = liveEvent();
    const next = this.eventPending()[0];
    if (!ev || !next) return null;
    const counts = (this.save.eventLevels ??= {});
    const have = (counts[ev.id] ?? 0) + 1;
    counts[ev.id] = have;
    // Where this item's stretch began: the item before it, or the start.
    const prev = Math.max(0, ...[...BALLS, ...PAINTS, ...THEMES].filter((x) => x.event?.id === ev.id && x.event.levels < next.need).map((x) => x.event!.levels));
    const won = have >= next.need;
    if (won) this.save.owned.push(next.id);
    this.persist();
    return { ...next, prev, have, won };
  }

  /** Video boosts left today for the running event. */
  private boostsLeft(): number {
    const b = this.save.eventBoost;
    return EVENT_BOOSTS_A_DAY - (b && b.day === dayIndex() ? b.n : 0);
  }

  /** Count `k` levels toward the event; returns the prizes this wins. */
  private addEventLevels(k: number): { kind: ShopTab; id: string; name: string }[] {
    const ev = liveEvent();
    if (!ev) return [];
    const counts = (this.save.eventLevels ??= {});
    counts[ev.id] = (counts[ev.id] ?? 0) + k;
    const won = this.eventPending().filter((p) => p.need <= counts[ev.id]);
    for (const p of won) this.save.owned.push(p.id);
    this.persist();
    return won;
  }

  /** The event button: shown while an event has prizes left to win. */
  private refreshEventHud() {
    const ev = liveEvent();
    const pending = this.eventPending();
    this.hud.setEvent(ev && pending.length ? ev : null, adsAvailable() && this.boostsLeft() > 0);
  }

  private eventView(): EventView | null {
    const ev = liveEvent();
    if (!ev) return null;
    const have = this.save.eventLevels?.[ev.id] ?? 0;
    const renderer = this.app.renderer as Renderer;
    const prizes = [
      ...BALLS.filter((x) => x.event?.id === ev.id).map((x) => ({ kind: 'ball' as ShopTab, x, preview: () => `background-image: url(${this.spherePreview(x.id)})` })),
      ...PAINTS.filter((x) => x.event?.id === ev.id).map((x) => ({ kind: 'paint' as ShopTab, x, preview: () => `background-image: url(${paintPreview(renderer, x)})` })),
      ...THEMES.filter((x) => x.event?.id === ev.id).map((x) => ({
        kind: 'board' as ShopTab,
        x,
        preview: () => `background-image: url(${boardPreview(renderer, this.makeLook(x), this.ballSkin())})`,
      })),
    ]
      .map(({ kind, x, preview }) => ({
        name: `${x.name} ${kind === 'board' ? 'maze' : kind}`,
        kind,
        preview: preview(),
        have,
        need: x.event!.levels,
        won: this.save.owned.includes(x.id),
      }))
      .sort((a, b) => a.need - b.need);
    return { icon: ev.icon, name: ev.name, ends: ev.ends, prizes, boostsLeft: this.boostsLeft(), perBoost: EVENT_BOOST, adsOn: adsAvailable() };
  }

  private openEvent() {
    const v = this.eventView();
    if (!v) {
      this.hud.toast('The event has ended. See you at the next one!');
      return;
    }
    this.hud.showEvent(v);
  }

  /** A video for extra event progress (a few a day). */
  private eventBoost() {
    if (this.boostsLeft() <= 0 || !liveEvent()) return;
    void rewardedAd(() => this.sound.setMuted(true), () => this.sound.setMuted(this.portalMuted)).then((ok) => {
      if (!ok) {
        this.hud.toast('No video available right now. Try again soon!');
        return;
      }
      const day = dayIndex();
      const b = this.save.eventBoost;
      this.save.eventBoost = { day, n: (b && b.day === day ? b.n : 0) + 1 };
      const won = this.addEventLevels(EVENT_BOOST);
      this.sound.star(2);
      this.vibrate([20, 40, 20]);
      this.refreshEventHud();
      if (won.length) {
        // Straight to the prize: the event panel closes for its moment.
        this.hud.close('event');
        if (!document.getElementById('shop')!.hidden) this.refreshShop();
        const first = won[0];
        const it = this.shopItems()[first.kind].find((x) => x.id === first.id);
        window.setTimeout(() => {
          this.sound.complete();
          this.hud.unlocked(first.name, it?.preview ?? '', () => this.equip(first.kind, first.id));
          this.hud.setShopDot(true);
        }, 350);
        return;
      }
      this.hud.toast(`${liveEvent()!.icon} +${EVENT_BOOST} levels!`);
      const v = this.eventView();
      if (v) this.hud.showEvent(v);
      if (!document.getElementById('shop')!.hidden) this.refreshShop();
    });
  }

  /** Progress on an item's video offer, if it has one now. */
  private adsFor(kind: ShopTab, it: { id: string }): ShopItem['ads'] {
    if (this.save.owned.includes(it.id) || !adsAvailable()) return undefined;
    if (!this.offerIds().includes(`${kind}:${it.id}`)) return undefined;
    return { have: this.adsWatched(kind, it.id), need: offerAds(kind), until: this.save.offers!.until };
  }

  /**
   * A shop preview as CSS: ready at once if already rendered; otherwise
   * empty for now, with the render queued for an idle moment (the tile
   * fills in when it is done), so opening the shop never waits on it.
   */
  private previewCss(tab: ShopTab, id: string, key: string, ready: string | undefined, render: () => string): string {
    if (ready) return `background-image: url(${ready})`;
    this.queuePreview(key, () => {
      const url = render();
      this.hud.setTilePreview(tab, id, `background-image: url(${url})`);
    });
    return '';
  }

  private previewJobs = new Map<string, () => void>();
  private previewBusy = false;

  private queuePreview(key: string, job: () => void) {
    if (!this.previewJobs.has(key)) this.previewJobs.set(key, job);
    if (this.previewBusy) return;
    this.previewBusy = true;
    const ric = (window as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number }).requestIdleCallback;
    const idle = (cb: () => void) => (ric ? ric(cb, { timeout: 150 }) : setTimeout(cb, 16));
    // One render per idle slot keeps every frame smooth.
    const step = () => {
      // Never while the player is at play: each render reads pixels back
      // from the GPU, which stalls a frame. Only with the shop or another
      // panel open, or after a long quiet spell (and never mid-slide).
      if (this.slideState || (!this.hud.modalOpen && performance.now() - this.lastInputAt < 8000)) {
        window.setTimeout(() => idle(step), 400);
        return;
      }
      const next = this.previewJobs.entries().next();
      if (next.done) {
        this.previewBusy = false;
        return;
      }
      this.previewJobs.delete(next.value[0]);
      try {
        next.value[1]();
      } catch {
        /* a failed preview just stays blank */
      }
      idle(step);
    };
    idle(step);
  }

  private shopItems(): Record<ShopTab, ShopItem[]> {
    const ball = this.ballSkin();
    // Shop order: what is owned, then video offers, then soonest unlock.
    // Event items lead while their event runs; afterwards only won ones stay.
    const rank = (it: ShopItem) => (it.event ? 1.5 : it.ads ? 2 : it.vault ? 9e4 : it.unlock);
    const byUnlock = (list: ShopItem[]) => list.filter((it) => it.unlock < EVENT_GONE).sort((a, b) => rank(a) - rank(b));
    return {
      ball: byUnlock(BALLS.map((b, i) => {
        const [c1, c2] = TILE_COLORS[i % TILE_COLORS.length];
        return {
          id: b.id,
          name: b.name,
          unlock: this.save.owned.includes(b.id) ? 1 : b.unlock,
          ads: this.adsFor('ball', b),
          ...this.eventFor(b),
          // Safe-only pieces show in the shop, won only from the Safe.
          ...(b.vault && !this.save.owned.includes(b.id) ? { unlock: 1, vault: true } : {}),
          kind: 'ball' as const,
          bg: `--c1:${c1};--c2:${c2}`,
          preview: this.previewCss('ball', b.id, `ball:${b.id}`, this.previews.get(b.id), () => this.spherePreview(b.id)),
        };
      })),
      paint: byUnlock(PAINTS.map((p) => ({
        id: p.id,
        name: p.name,
        unlock: this.save.owned.includes(p.id) ? 1 : p.unlock,
        ads: this.adsFor('paint', p),
        ...this.eventFor(p),
        kind: 'paint' as const,
        preview: this.previewCss('paint', p.id, paintKey(p), peekPreview(paintKey(p)), () => paintPreview(this.app.renderer as Renderer, p)),
      }))),
      board: byUnlock(THEMES.map((t) => ({
        id: t.id,
        name: t.name,
        unlock: this.save.owned.includes(t.id) ? 1 : t.unlock,
        ads: this.adsFor('board', t),
        ...this.eventFor(t),
        kind: 'board' as const,
        preview: (() => {
          const look = this.makeLook(t);
          const key = boardKey(look, ball);
          return this.previewCss('board', t.id, key, peekPreview(key), () => boardPreview(this.app.renderer as Renderer, look, ball));
        })(),
      }))),
      // Trail pictures are plain 2D canvas (no GPU read-back): drawn at once.
      trail: byUnlock(TRAILS.map((t) => ({
        id: t.id,
        name: t.name,
        unlock: this.save.owned.includes(t.id) ? 1 : t.unlock,
        ads: this.adsFor('trail', t),
        kind: 'trail' as const,
        preview: `background-image: url(${trailPreview(t, ball.colors[1])})`,
      }))),
    };
  }

  private previews = new Map<string, string>();

  private trail: Trail | null = null;

  /** The equipped trail's id (one not owned or unknown falls back to none). */
  private trailId(): string {
    const id = this.save.trail ?? 'classic';
    return TRAILS.some((t) => t.id === id) ? id : 'classic';
  }

  private trailMask: Sprite | null = null;

  /**
   * (Re)build the trail on the current board, under the ball, clipped to
   * the floor: however fast the ball goes, nothing spills over the walls.
   */
  private makeTrail() {
    this.trail?.destroy();
    this.trail = null;
    if (this.trailMask && !this.trailMask.destroyed) this.trailMask.destroy();
    this.trailMask = null;
    const skin = TRAILS.find((t) => t.id === this.trailId()) ?? TRAILS[0];
    if (skin.style === 'none' || !this.board) return;
    this.trail = new Trail(skin.style, this.cell);
    this.trailMask = this.board.floorMask();
    this.board.fxLayer.addChild(this.trailMask, this.trail.view);
    this.trail.view.mask = this.trailMask;
  }

  /** Same 3D render as in game, cached as an image for the shop. */
  private spherePreview(id: string): string {
    let url = this.previews.get(id);
    if (!url) {
      const skin = BALLS.find((b) => b.id === id) ?? BALLS[0];
      url = ballPreview(this.app.renderer as Renderer, skin);
      this.previews.set(id, url);
    }
    return url;
  }

  private offerTimer = 0;

  private refreshShop() {
    const items = this.shopItems();
    // New offers the moment the current ones run out, shop open or not.
    window.clearTimeout(this.offerTimer);
    if (this.save.offers) this.offerTimer = window.setTimeout(() => document.getElementById('shop')?.hidden === false && this.refreshShop(), Math.max(1000, this.save.offers.until - Date.now() + 500));
    this.hud.setShop('ball', items.ball, this.save.ball, this.save.best);
    this.hud.setShop('paint', items.paint, this.save.paint, this.save.best);
    this.hud.setShop('board', items.board, this.theme.id, this.save.best);
    this.hud.setShop('trail', items.trail, this.trailId(), this.save.best);
    this.hud.setShopDot(false);
    this.save.seenUnlock = this.save.best;
    this.persist();
  }

  private equip(tab: ShopTab, id: string) {
    if (tab === 'board') {
      this.selectTheme(id);
      return;
    }
    if (tab === 'trail') {
      this.save.trail = id;
      this.makeTrail();
      this.persist();
      this.refreshShop();
      return;
    }
    if (tab === 'ball') this.save.ball = id;
    else this.save.paint = id;
    this.look = this.makeLook();
    this.hud.setPaintColors(this.look.paint, this.look.paintLight, this.look.paintDark);
    const old = this.board;
    this.buildBoard();
    old.destroy();
    this.persist();
    // Board previews show the player's paint and ball: redraw them.
    this.refreshShop();
  }

  /** Red dot on the shop when something new unlocked since the last visit. */
  private checkUnlocks() {
    const all = [...BALLS, ...PAINTS, ...THEMES, ...TRAILS];
    const fresh = all.some((x) => x.unlock > (this.save.seenUnlock ?? 1) && x.unlock <= this.save.best);
    this.hud.setShopDot(fresh);
  }

  private chestPending = false;

  /**
   * Three keys open the key vault. Each lock holds a random prize token,
   * weighted (coins common, hints less, new items rare) and leaning toward
   * cards that already have dots, which carry over between visits. Fair
   * play: a visit that wins nothing makes the next one a sure thing, its
   * locks all revealing the card closest to complete until it is won.
   */
  private openVault() {
    this.chestPending = true;
    const v = this.save.vault;
    const kinds: VaultKind[] = ['hint', 'item', 'coins'];
    // The prize piece is the rare one: a Safe-only ball while any are left.
    const prize = this.vaultPrize();
    const base: Record<VaultKind, number> = { coins: 0.5, hint: 0.38, item: prize?.vault ? 0.1 : 0.16 };
    const local: Record<VaultKind, number> = { hint: v.hint, item: v.item, coins: v.coins };
    const sure = (v.dry ?? 0) >= 1;
    const top = Math.max(...kinds.map((k) => v[k]));
    const best = kinds.filter((k) => v[k] === top);
    const target = best[Math.floor(Math.random() * best.length)];
    let won = false;
    const ballItem = prize && BALLS.find((b) => b.id === prize.id);
    const paintItem = prize && PAINTS.find((p) => p.id === prize.id);
    this.hud.vault({
      dots: { ...local },
      keys: 3,
      item: prize
        ? {
            name: prize.name,
            art: ballItem ? this.spherePreview(ballItem.id) : paintPreview(this.app.renderer as Renderer, paintItem!),
          }
        : null,
      pick: () => {
        let k: VaultKind;
        if (sure && !won) k = target;
        else {
          const w = kinds.map((x) => base[x] * (1 + local[x] * 1.3));
          let r = Math.random() * w.reduce((a, b) => a + b, 0);
          k = kinds[kinds.length - 1];
          for (let i = 0; i < kinds.length; i++) if ((r -= w[i]) <= 0) {
            k = kinds[i];
            break;
          }
        }
        local[k] = (local[k] + 1) % 3;
        return k;
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
          this.save.coins += 40;
          label = '+40';
        } else {
          if (prize && !this.save.owned.includes(prize.id)) {
            this.save.owned.push(prize.id);
            label = `${prize.name}!`;
            this.hud.setShopDot(true);
          } else {
            this.save.coins += 60;
            label = '+60';
          }
        }
        this.hud.setCoins(this.save.coins);
        this.refreshPrices();
        this.persist();
        return label;
      },
      extra: adsAvailable()
        ? () => rewardedAd(() => this.sound.setMuted(true), () => this.sound.setMuted(this.portalMuted))
        : undefined,
      onDone: () => {
        this.save.vault.dry = won ? 0 : (this.save.vault.dry ?? 0) + 1;
        this.chestPending = false;
        this.save.keys = 0;
        this.hud.setKeys(0);
        this.persist();
        this.autoNextAt = this.time + 250;
      },
      sound: {
        click: () => this.sound.click(),
        appear: () => this.sound.vaultAppear(),
        key: () => this.sound.vaultKey(),
        turn: () => this.sound.vaultTurn(),
        open: () => this.sound.vaultOpen(),
        dot: (i) => this.sound.vaultDot(i),
        win: () => this.sound.vaultWin(),
      },
    });
  }

  /**
   * The Safe's piece prize this visit: a Safe-only ball not yet won, at
   * random; once all are won, the next ball or paint to unlock.
   */
  private vaultPrize(): { id: string; name: string; vault?: boolean } | null {
    const left = BALLS.filter((b) => b.vault && !this.save.owned.includes(b.id));
    if (left.length) return left[Math.floor(Math.random() * left.length)];
    return this.nextLockedItem();
  }

  /** The next ball or paint the player has not unlocked yet. */
  private nextLockedItem(): { id: string; name: string } | null {
    const owned = new Set(this.save.owned);
    const pool = [...BALLS, ...PAINTS]
      .filter((x) => !x.event && !('vault' in x && x.vault) && x.unlock > this.save.best && !owned.has(x.id))
      .sort((a, b) => a.unlock - b.unlock);
    return pool[0] ?? null;
  }


  // ---------------------------------------------------------------- input

  private bindInput() {
    const el = this.app.canvas;
    // `dir` is the last swipe this drag made: a drag that keeps going the
    // same way is one swipe, not several. (Otherwise a finger still moving
    // after a curve has turned the ball queues an unwanted extra move.)
    let origin: { x: number; y: number; id: number; dir?: Dir } | null = null;
    const threshold = (e: PointerEvent) =>
      e.pointerType === 'mouse' ? 10 : Math.max(10, Math.min(22, Math.min(innerWidth, innerHeight) * 0.028));
    el.addEventListener('pointerdown', (e) => {
      this.lastInputAt = performance.now();
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
      // Re-anchor so one continuous drag can chain several swipes, but only
      // when it changes direction.
      const same = origin.dir === dir;
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId, dir };
      if (!same) this.input(dir);
    });
    const end = (e: PointerEvent) => {
      if (origin && e.pointerId === origin.id) origin = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', (e) => {
      this.lastInputAt = performance.now();
      this.sound.unlock();
      const keyDirs: Record<string, Dir> = {
        ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
        w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R',
      };
      if (keyDirs[e.key]) {
        e.preventDefault();
        // A held key repeats: that is still one move.
        if (!e.repeat) this.input(keyDirs[e.key]);
      } else if (e.key === 'r' || e.key === 'R') this.restart();
      else if (e.key === 'h' || e.key === 'H') this.showHint();
      else if ((e.key === 'Enter' || e.key === ' ') && this.resultShown) {
        e.preventDefault();
        this.nextLevel();
      }
    });
  }

  private input(dir: Dir) {
    if (this.completeAt !== null || this.hud.modalOpen || this.dead) return;
    if (this.busy) {
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
    this.watchedThisLevel = false;
    this.level = getLevel(n);
    // The first level guides the whole way; elsewhere a hint turns it on.
    this.hintGuide = n === 1;
    this.guideKey = '';
    this.hud.stuckNudge(false);
    prefetchLevels(n + 1);
    this.collected = new Set();
    // A level's key counts once: replaying it (or going back to it) finds
    // the key already taken.
    if (n <= (this.save.keyLevel ?? 0))
      this.level.grid.forEach((row, y) => row.forEach((v, x) => v === KEY && this.collected.add(this.key({ x, y }))));
    this.floorTotal = 0;
    this.floorTotal = floorCount(this.level.grid);
    this.refreshPrices();
    this.refreshEventHud();
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
      { id: 'portals', on: has((c) => c === PORTAL_A), text: 'Portals warp the ball to their twin!' },
      { id: 'arrows', on: has((c) => c >= ARROW_U && c <= ARROW_R), text: 'Arrows send the ball the way they point!' },
      { id: 'stoppers', on: has((c) => c === STOPPER), text: 'Studded tiles stop the ball dead!' },
      { id: 'split', on: has((c) => c === MULT), text: 'Roll over x3 to split into three balls!' },
    ].find((t) => t.on && !this.save.tips.includes(t.id));
    if (fresh) {
      this.save.tips.push(fresh.id);
      this.persist();
    }
    // A short lesson for new players: swiping on level 1, the goal on 2,
    // the hint bulb on 4 (each once); otherwise new tile types.
    const lesson = (id: string, text: string) => {
      if (this.save.tips.includes(id)) return null;
      this.save.tips.push(id);
      return text;
    };
    let tip = n === 1 ? 'Swipe to roll the ball' : (fresh?.text ?? null);
    if (!tip && n === 2) tip = lesson('tut-plan', 'Plan your route: paint every tile!');
    if (!tip && n === 4) {
      tip = lesson('tut-hint', 'Stuck? Tap the bulb for a hint!');
      if (tip) window.setTimeout(() => this.hud.pulse('btn-hint', 5000), 700);
    }
    this.hud.showTip(tip);
    this.lastMoveAt = this.time;
    this.handKey = '';
    this.hud.showHand(null);
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
    this.wet.clear();
    this.setExtras([]);
    this.splitUsed = false;
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
    this.endSlowMo();
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
    this.ballRes = res;
    const board = new Board(this.level, this.look, cell, res);
    board.pivot.set(board.boardWidth / 2, board.boardHeight / 2);
    board.position.set(cx, cy);
    this.boardHolder.addChild(board);
    this.board = board;
    this.boardFx = new Fx(board.fxLayer);
    this.makeTrail();
    // A soft pool of light follows the ball across the board.
    this.light = boardLight(cell * 3.2);
    board.filters = [this.light];
    // Fresh bomb layer per board: the old one is destroyed with its board.
    this.bombG = new Graphics();
    board.fxLayer.addChild(this.bombG);
    this.bombAnim = null;
    const skin = BALLS.find((x) => x.id === this.save.ball) ?? BALLS[0];
    this.ball = new Ball(cell, res, skin);
    const bc = parseInt(skin.colors[0].slice(1), 16);
    this.coneColor = [16, 8, 0].reduce((acc, sh) => acc | (Math.round(((bc >> sh) & 255) * 0.85 + 255 * 0.15) << sh), 0);
    board.ballLayer.addChild(this.ball);
    // The original is seen from slightly in front, so its rows are about
    // 3.6% shorter than its columns. Squash the board by that much, rounded
    // so each row is a whole number of device pixels (grid lines stay
    // crisp), and keep the ball round.
    this.foreshorten = Math.round(cell * res * 0.964) / (cell * res);
    this.ball.scale.set(1, 1 / this.foreshorten);
    // As in the original, nothing of the ball's shadow shows past the floor.
    this.ball.clipShadow(board.floorClip);
    this.placeBall(this.pos);
    // Coins, keys and an x3 already taken stay gone on a rebuilt board
    // (after a resize, or a new ball, paint or maze picked in the shop).
    const cols = this.level.grid[0].length;
    for (const k of this.collected) board.pickup({ x: k % cols, y: Math.floor(k / cols) }, true);
    if (this.splitUsed) {
      this.level.grid.forEach((row, y) => row.forEach((v, x) => v === MULT && board.pickup({ x, y }, true)));
    }
    // Balls split off by x3 move over to the new board.
    for (const e of this.extras) {
      e.ball = this.makeBall();
      const c = board.cellCenter(e.pos.x, e.pos.y);
      e.ball.position.set(c.x, c.y);
    }
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
    // Every ball rolls (after an x3 split there are several).
    const others = this.extras.map((e) => slide(this.level.grid, e.pos, dir));
    const rolls = (x: SlideResult) => x.path.length > 0 || !!x.saw;
    if (!rolls(r) && !others.some(rolls)) {
      // Blocked: a small wobble toward the wall.
      this.ball.impact(0.25);
      this.sound.bump();
      this.vibrate(12);
      return;
    }
    this.history.push({
      pos: { ...this.pos },
      extras: this.extras.map((e) => ({ ...e.pos })),
      split: this.splitUsed,
      painted: new Map(this.painted),
      dots: this.dots.length,
      splats: this.splats.length,
      moves: this.moves,
    });
    this.moves++;
    this.hud.setMoves(this.moves);
    this.hud.showTip(null);
    this.lastMoveAt = this.time;
    this.hud.showHand(null);
    this.hint = null;
    this.dots = this.dots.filter((dt) => !dt.top);
    let longest = 0;
    this.extras.forEach((e, i) => {
      if (!rolls(others[i])) return;
      e.slide = this.makeSlide(dir, e.pos, others[i]);
      longest = Math.max(longest, e.slide.dur);
    });
    if (rolls(r)) {
      this.slideState = this.makeSlide(dir, this.pos, r);
      longest = Math.max(longest, this.slideState.dur);
      this.lastDir = d;
      this.cone = { from: { ...this.pos }, endedAt: null };
      this.wet.set(this.key(this.pos), { t: this.time, axis: d.x !== 0 ? 0 : 1 });
    }
    this.sound.launch(longest);
    // Felt in the hand: a kick as the ball leaves, then a rolling buzz while
    // fresh paint fills tiles (the landing thud in arrive cuts it off).
    const fresh = r.path.filter((p) => !this.painted.has(this.key(p))).length;
    if (fresh === 0) this.vibrate(12);
    else {
      const pattern = [16];
      for (let t = 16; t < longest - 20; t += 22) pattern.push(12, 10);
      this.vibrate(pattern);
    }
  }

  private makeSlide(dir: Dir, from: Point, r: SlideResult): Slide {
    const len = r.path.length;
    return { dir, endDir: r.dir, from: { ...from }, path: r.path, turns: r.turns, saw: r.saw, jumps: r.jumps, t: 0, dur: 40 + 19 * Math.max(1, len) ** 0.9, done: 0 };
  }

  /** After an unexpected error: stop every ball where it is and go on. */
  private recover() {
    try {
      const s = this.slideState;
      if (s) {
        this.slideState = null;
        this.pos = s.path[s.path.length - 1] ?? s.from;
      }
      for (const e of this.extras) {
        if (!e.slide) continue;
        e.pos = e.slide.path[e.slide.path.length - 1] ?? e.slide.from;
        e.slide = null;
      }
      this.queued = null;
      this.timeScale = 1;
      this.placeBall(this.pos);
      for (const e of this.extras) {
        const c = this.board.cellCenter(e.pos.x, e.pos.y);
        e.ball.position.set(c.x, c.y);
      }
      this.updateRemaining();
      if (this.completeAt === null && !this.dead && this.painted.size >= this.floorTotal) this.beginComplete();
    } catch (err) {
      console.error(err);
    }
  }

  /** A ball is rolling (the main one or any split off by x3). */
  private get busy(): boolean {
    return !!this.slideState || this.extras.some((e) => e.slide);
  }

  private makeBall(): Ball {
    const b = new Ball(this.cell, this.ballRes, this.ballSkin());
    b.scale.set(1, 1 / this.foreshorten);
    b.clipShadow(this.board.floorClip);
    this.board.ballLayer.addChild(b);
    return b;
  }

  /** Replace the split-off balls with ones resting at `at`. */
  private setExtras(at: Point[]) {
    for (const e of this.extras) e.ball.destroy();
    this.extras = at.map((p) => {
      const ball = this.makeBall();
      const c = this.board.cellCenter(p.x, p.y);
      ball.position.set(c.x, c.y);
      return { pos: { ...p }, ball, slide: null, lastDir: { x: 1, y: 0 }, born: -1e9 };
    });
  }

  /**
   * The x3 tile: the ball rolling over it splits in three. It rolls on and
   * two new balls pop out of the tile and shoot off sideways.
   */
  private splitAt(p: Point, dirs: Dir[]) {
    this.splitUsed = true;
    this.board.pickup(p);
    const c = this.board.cellCenter(p.x, p.y);
    this.boardFx.sparkle(c.x, c.y, 16, this.cell * 1.8, 0xffffff);
    this.boardFx.ring(c.x, c.y, this.cell * 0.75, 0xffffff);
    this.boardFx.flash(c.x, c.y, this.cell * 1.4, this.look.paintLight, 0.45);
    this.sound.star(2);
    this.vibrate([16, 30, 16]);
    for (const sd of dirs) {
      const r = slide(this.level.grid, p, sd);
      const ball = this.makeBall();
      ball.position.set(c.x, c.y);
      const e = { pos: { ...p }, ball, slide: null as Slide | null, lastDir: DIRS[sd], born: this.time };
      if (r.path.length || r.saw) e.slide = this.makeSlide(sd, p, r);
      this.extras.push(e);
    }
  }

  /** Roll the split-off balls on, painting as they go. */
  private stepExtras(dt: number) {
    for (const e of [...this.extras]) {
      if (!this.extras.includes(e)) continue;
      const pop = Math.min(1, 0.35 + Math.max(0, this.time - e.born) / 160);
      const s = e.slide;
      if (!s) {
        e.ball.scale.set(pop, pop / this.foreshorten);
        continue;
      }
      s.t += dt;
      const p = Math.min(1, s.t / s.dur);
      const dist = p * (0.6 + 0.4 * p) * s.path.length;
      if (!s.path.length) {
        if (p >= 1) this.arriveExtra(e);
        continue;
      }
      const sp = this.slidePoint(s, dist);
      e.lastDir = sp.dir;
      const k = pop * (0.15 + 0.85 * (sp.warp ?? 1));
      e.ball.scale.set(k, k / this.foreshorten);
      this.layTiles(s, dist, sp);
      const c = this.board.cellCenter(sp.p.x, sp.p.y);
      e.ball.position.set(c.x, c.y);
      if (p >= 1) this.arriveExtra(e);
    }
  }

  private arriveExtra(e: (typeof this.extras)[number]) {
    const s = e.slide!;
    e.slide = null;
    e.pos = s.path[s.path.length - 1] ?? s.from;
    if (s.saw) {
      this.die(s.saw, DIRS[s.endDir], e.ball);
      return;
    }
    const c = this.board.cellCenter(e.pos.x, e.pos.y);
    e.ball.position.set(c.x, c.y);
    if (s.path.length) {
      this.sound.thock(0.4);
      this.wallLumps(e.pos, DIRS[s.endDir], Math.min(1.3, s.path.length / 6));
    }
    this.settle();
  }

  /**
   * Once every ball has stopped: balls resting on the same tile merge into
   * one, then the level may be done, or a queued swipe goes.
   */
  private settle() {
    if (this.busy || this.dead || this.completeAt !== null) return;
    const taken = new Set([this.key(this.pos)]);
    this.extras = this.extras.filter((e) => {
      const k = this.key(e.pos);
      if (!taken.has(k)) {
        taken.add(k);
        return true;
      }
      const c = this.board.cellCenter(e.pos.x, e.pos.y);
      this.boardFx.sparkle(c.x, c.y, 8, this.cell, 0xffffff);
      e.ball.destroy();
      return false;
    });
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
    const warp = sp.warp ?? 1;
    this.ball.scale.set(0.15 + 0.85 * warp, (0.15 + 0.85 * warp) / this.foreshorten);
    if (sp.warp !== undefined && !this.warping) {
      this.warping = true;
      const c = this.board.cellCenter(sp.p.x, sp.p.y);
      this.boardFx.sparkle(c.x, c.y, 10, this.cell * 1.4, 0x7ae8ff);
      this.sound.launch(120);
    } else if (sp.warp === undefined && this.warping) {
      this.warping = false;
      const c = this.board.cellCenter(sp.p.x, sp.p.y);
      this.boardFx.sparkle(c.x, c.y, 10, this.cell * 1.4, 0xffb46b);
      this.boardFx.ring(c.x, c.y, this.cell * 0.6, 0xffd9a8);
    }
    // Ease off the squash and stretch while swinging round a curve.
    this.turnDamp += ((sp.turning ? 0.3 : 1) - this.turnDamp) * Math.min(1, dt / 40);
    this.layTiles(s, dist, sp);
    this.placeBall(sp.p);
    if (this.cone) this.cone.from = sp.band.from;
    if (p >= 1) this.arrive(s);
  }

  /**
   * Paint the tiles a ball's centre has reached in its slide. The stream
   * under the ball (see Board) runs up to its centre; a tile is laid as
   * whole paint once the centre reaches its middle, so its rounded front
   * matches the stream's and nothing pops in ahead. Pickups are taken, and
   * the x3 tile splits the ball.
   */
  private layTiles(s: Slide, dist: number, sp: { dir: XY; turning?: boolean }) {
    const d = sp.dir;
    while (s.done < s.path.length && dist >= s.done + 1) {
      const cellP = s.path[s.done];
      const k = this.key(cellP);
      if (!this.painted.has(k)) {
        this.painted.set(k, this.time - SPREAD_MS);
        this.paintAxis.set(k, sp.turning || this.isCurveAt(cellP) ? 2 : d.x !== 0 ? 0 : 1);
        this.sound.paintTile();
        this.speckle(cellP);
      } else {
        // Rolling back over paint still throws up a splash (as in the
        // original), a little lighter than on fresh paint.
        this.speckle(cellP, 0.55);
      }
      // Wet again wherever the ball rolls, painted before or not.
      if (!sp.turning && !this.isCurveAt(cellP)) this.wet.set(k, { t: this.time, axis: d.x !== 0 ? 0 : 1 });
      this.collect(cellP);
      if (!this.splitUsed && this.level.grid[cellP.y][cellP.x] === MULT) this.splitAt(cellP, splitDirs(s.from, s.path, s.done));
      s.done++;
    }
  }

  /**
   * Where the ball is `dist` cells into a slide. Straight runs are linear;
   * through a curve tile the ball follows a quarter arc. Also returns the
   * travel direction and the straight stretch of fresh paint behind it.
   */
  private slidePoint(s: Slide, dist: number): { p: XY; dir: XY; band: { from: XY; pos: XY }; turning?: boolean; warp?: number } {
    // Straight into a saw right beside the ball: no tiles to roll over.
    if (!s.path.length) return { p: s.from, dir: DIRS[s.dir], band: { from: s.from, pos: s.from } };
    const pts: XY[] = [s.from, ...s.path];
    const end = pts.length - 1;
    const dd = Math.max(0, Math.min(end, dist));
    let segStart = s.from;
    // Through a portal: shrink into the entry, pop out of the exit.
    for (const j of s.jumps) {
      const k = j + 1;
      const a = pts[k - 1];
      const b = pts[k];
      const dir = k >= 2 ? { x: a.x - pts[k - 2].x, y: a.y - pts[k - 2].y } : DIRS[s.dir];
      if (dd >= k - 1 && dd < k) {
        const f = dd - (k - 1);
        return f < 0.5
          ? { p: a, dir, band: { from: a, pos: a }, warp: 1 - f * 2 }
          : { p: b, dir, band: { from: b, pos: b }, warp: (f - 0.5) * 2 };
      }
      if (dd >= k) segStart = b;
    }
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
      if (dd > k + 0.5 && !s.jumps.some((j) => j + 1 > k && j + 1 <= dd)) segStart = c;
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
      // The speed cone draws back into the ball as on any stop.
      if (this.cone) this.cone.endedAt = this.time;
      this.die(s.saw, d);
      return;
    }
    if (this.cone) this.cone.endedAt = this.time;
    this.updateRemaining();
    const speed = Math.min(1.3, s.path.length / 6);
    // Stopped by a stopper's studs: they clamp on, the ball squashes hard
    // into the grip and lands with a firmer, clickier thud.
    const gripped = this.board.grip(this.pos.x, this.pos.y);
    // No bounce: as in the original the stretched ball just draws in
    // against the wall (see Ball). A stopper's grip still squeezes it.
    if (gripped) this.ball.impact(0.6);
    this.splatBall(d);
    this.sound.thock(0.6 + speed * 0.4 + (gripped ? 0.3 : 0));
    if (gripped) this.sound.grip();
    // Landing thud, heavier the longer the run; a stopper's grip snaps twice.
    this.vibrate(gripped ? [26, 40, 34] : Math.round(24 + speed * 16));

    const c = this.board.cellCenter(this.pos.x, this.pos.y);
    const hitX = c.x + d.x * this.cell * 0.45;
    const hitY = c.y + d.y * this.cell * 0.45;
    // The wall hit's shimmer runs through the paint only (no board ripple).
    if (!REDUCED_MOTION) this.board.paintHit(hitX, hitY, Math.min(1, 0.45 + speed * 0.45 + (gripped ? 0.15 : 0)));
    this.wallLumps(this.pos, d, speed);
    this.settle();
    // First-level lesson, one step per move.
    if (this.levelNo === 1 && !this.save.tips.includes('tut-basics') && this.completeAt === null)
      this.hud.showTip(this.moves === 1 ? 'It rolls until it hits a wall!' : 'Paint every tile to win!');
  }

  /**
   * A few lumps thrown up where a ball hits a wall, some onto the wall face
   * above the lane (as in the original).
   */
  private wallLumps(p: Point, d: XY, speed: number) {
    const c = this.board.cellCenter(p.x, p.y);
    for (let i = 0; i < 4 + Math.round(speed * 3); i++) {
      const along = Math.random() * 0.9;
      this.dots.push({
        x: c.x + (d.x ? -d.x * along : Math.random() - 0.5) * this.cell * 0.9,
        y: c.y - this.cell * (0.25 + Math.random() * 0.45) + (d.y ? -d.y * along * this.cell * 0.9 : 0),
        r: this.cell * (0.07 + Math.random() * 0.06),
        t: this.time + Math.random() * 50,
        life: 650 + Math.random() * 200,
      });
    }
  }

  private isCurveAt(p: Point) {
    const v = this.level.grid[p.y][p.x];
    return isCurve(v);
  }

  private addDot(x: number, y: number, r: number) {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (isFloor(this.level.grid, cx, cy)) this.dots.push({ x, y, r, t: this.time });
  }

  /** Coins and keys lying on a tile pop off and fly to the HUD. */
  private collect(p: Point) {
    const v = this.level.grid[p.y][p.x];
    if (v !== COIN && v !== KEY) return;
    const k = this.key(p);
    if (this.collected.has(k)) return;
    this.collected.add(k);
    this.board.pickup(p);
    const g = this.board.toGlobal(this.board.cellCenter(p.x, p.y));
    if (v === COIN) {
      this.save.coins += 2;
      this.hud.flyCoins(g, 2, this.save.coins);
      this.refreshPrices();
      this.sound.coin();
    } else {
      this.save.keyLevel = Math.max(this.save.keyLevel ?? 0, this.levelNo);
      if (this.save.keys < 3) {
        this.save.keys++;
        this.hud.flyKey(g, this.save.keys);
        this.sound.keyGet();
      }
    }
    this.persist();
  }

  /**
   * Splatter thrown up from a freshly painted tile, as measured on the
   * original: about a dozen lumps per tile, the larger ones the paint's own
   * deep shade and the smaller ones red, scattered over the tile and up
   * onto the wall face above it. The lumps shrink away within about 0.9 s,
   * the red drops a little later.
   */
  private speckle(p: Point, amount = 1) {
    const c = this.cell;
    // On patterned paints (marble, slime, lava, water) a lighter, finer
    // scatter, so the smooth pattern shows through instead of being
    // broken up into a busy, blocky look.
    const patterned = (this.look.paintMode ?? 0) > 0;
    const k = patterned ? 0.75 : 1;
    const n = Math.round((12 + Math.floor(Math.random() * 5)) * amount * (patterned ? 0.45 : 1));
    for (let i = 0; i < n; i++) {
      const red = Math.random() < 0.42;
      this.dots.push({
        x: (p.x + 0.04 + Math.random() * 0.92) * c,
        y: (p.y - 0.12 + Math.random() * 1.04) * c,
        r: c * k * (red ? 0.03 + Math.random() * 0.035 : 0.055 + Math.random() * 0.075),
        t: this.time + Math.random() * 70,
        life: red ? 850 + Math.random() * 300 : 700 + Math.random() * 200,
        red,
      });
    }
  }

  /** A couple of lumps that land on the ball as it hits the wall. */
  private splatBall(d: XY) {
    const c = this.cell;
    // Where the ball comes to rest (its body is still drawn out just now).
    const x = this.ball.x;
    const y = this.ball.y + this.ball.restY * this.ball.scale.y;
    const side = Math.random() < 0.5 ? -1 : 1;
    this.dots.push(
      { x: x + side * c * (0.05 + Math.random() * 0.12), y: y - c * 0.26, r: c * 0.075, t: this.time + 60, life: 520, top: true },
      { x: x + d.x * c * 0.42 + d.y * c * 0.1, y: y + d.y * c * 0.38 - c * 0.04, r: c * 0.06, t: this.time + 90, life: 480, top: true },
    );
  }

  /** Vertical squash of the board (rows vs columns), see buildBoard. */
  private foreshorten = 1;
  /** Area the board's light filter renders, in board space (see tick). */
  private readonly filterArea = new Rectangle();
  /** Impact shockwave rippling from a wall hit (board px), if running. */
  private wave: { x: number; y: number; t: number; power: number } | null = null;

  private dead = false;
  /** Bullet time after the saw bites: when, and the cut point (board px). */
  private slowMo: { at: number; x: number; y: number; dx: number; dy: number } | null = null;
  private vignette: HTMLElement | null = null;

  /**
   * The ball rolled into a saw: it is pushed into the blade and sliced in
   * two, sparks fly, the board shakes, then the revive offer appears.
   */
  private die(saw: Point, dir: Point, ball = this.ball) {
    this.dead = true;
    this.queued = null;
    this.hint = null;
    const from = { x: ball.x, y: ball.y };
    const c = this.board.cellCenter(saw.x, saw.y);
    this.tweens.push({
      t: 0,
      dur: 110,
      step: (p) => ball.position.set(from.x + (c.x - from.x) * 0.5 * p, from.y + (c.y - from.y) * 0.5 * p),
      done: () => {
        const hx = (ball.x + c.x) / 2;
        const hy = (ball.y + c.y) / 2;
        const px = Math.ceil(this.cell * Math.min(window.devicePixelRatio || 1, 2));
        const still = Texture.from(ballCanvas(this.app.renderer as Renderer, this.ballSkin(), px));
        ball.split(dir, (x, y) => isFloor(this.level.grid, Math.floor(x / this.cell), Math.floor(y / this.cell)), still);
        this.board.sawHit(this.time);
        if (!REDUCED_MOTION) {
          this.slowMo = { at: this.time, x: hx, y: hy, dx: dir.x, dy: dir.y };
          this.slash(hx, hy, dir);
        }
        this.boardFx.sparkle(hx, hy, 24, this.cell * 2, 0xffd27a);
        this.boardFx.flash(hx, hy, this.cell * 1.6, 0xff5a5a, 0.8);
        this.boardFx.splash(hx, hy, -dir.x, -dir.y, 10, this.look.paint, this.cell * 3.4, this.cell * 0.08, (x, y, r) => this.addDot(x, y, r));
        if (!REDUCED_MOTION) {
          this.nudge.vx -= dir.x * 260 + 120;
          this.nudge.vy -= dir.y * 260;
        }
        this.hud.hurt();
        this.sound.slice();
        this.sound.thock(0.8);
        this.vibrate([70, 40, 110, 60, 50]);
      },
    });
    window.setTimeout(() => {
      if (!this.dead) return;
      const revive = () => {
        // Undo the fatal move and drop the ball back in.
        this.dead = false;
        this.endSlowMo();
        if (!ball.destroyed) ball.unsplit();
        this.undo();
        this.introAt = this.time;
        this.landed = false;
      };
      const giveUp = () => {
        this.dead = false;
        this.endSlowMo();
        if (!ball.destroyed) ball.unsplit();
        this.restart();
      };
      // Turning the revive down costs a level: play the one before again
      // (the streak goes too). On level 1 there is nowhere to go back to.
      const stepBack = () => {
        if (this.levelNo <= 1) {
          giveUp();
          return;
        }
        this.dead = false;
        this.endSlowMo();
        if (!ball.destroyed) ball.unsplit();
        if (this.save.streak > 0) {
          this.save.streak = 0;
          this.hud.streakLost();
        }
        this.hud.toast(`Back to level ${this.levelNo - 1}`);
        this.loadLevel(this.levelNo - 1, true);
      };
      // Revive is always a rewarded ad (Give up beside it). With no ads to
      // be had, just retry.
      if (!adsAvailable()) {
        this.hud.toast('Ouch! Try again');
        giveUp();
        return;
      }
      this.hud.revive({
        level: this.levelNo,
        streak: this.save.streak,
        seconds: 9,
        art: this.spherePreview(this.save.ball),
        tick: () => this.sound.click(),
        onRevive: () => {
          return rewardedAd(() => this.sound.setMuted(true), () => this.sound.setMuted(this.portalMuted)).then((ok) => {
            if (!ok) {
              this.hud.toast('No video available right now. Try again soon!');
              return false;
            }
            this.watchedThisLevel = true;
            revive();
            return true;
          });
        },
        onGiveUp: stepBack,
      });
    }, REDUCED_MOTION ? 950 : 1500);
  }

  /** A blade of light flashing along the cut, drawn slowly in bullet time. */
  private slash(x: number, y: number, dir: Point) {
    const g = new Graphics();
    g.blendMode = 'add';
    this.board.fxLayer.addChild(g);
    const len = this.cell * 1.5;
    this.tweens.push({
      t: 0,
      dur: 900,
      step: (p) => {
        const grow = Math.min(1, p / 0.18);
        const fade = p < 0.35 ? 1 : 1 - (p - 0.35) / 0.65;
        const l = len * (1 - (1 - grow) ** 3);
        const ax = x - dir.x * l * 0.5;
        const ay = y - dir.y * l * 0.5;
        const bx = x + dir.x * l * 0.5;
        const by = y + dir.y * l * 0.5;
        g.clear();
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: this.cell * 0.32 * fade, color: 0xff9ad8, alpha: 0.35 * fade, cap: 'round' });
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: this.cell * 0.09 * fade, color: 0xffffff, alpha: fade, cap: 'round' });
      },
      done: () => g.destroy(),
    });
  }

  private endSlowMo() {
    this.slowMo = null;
    this.timeScale = 1;
    if (this.vignette) this.vignette.style.opacity = '0';
  }

  /**
   * Bullet time: the clock drops to a tenth, holds, then eases back; the
   * camera punches in on the cut and pulls back out. Returns the zoom (0-1).
   */
  private stepSlowMo(): number {
    const s = this.slowMo;
    if (!s) return 0;
    const t = this.time - s.at;
    const back = Math.min(1, Math.max(0, (t - 420) / 900));
    this.timeScale = 0.1 + 0.9 * back * back * (3 - 2 * back);
    const zin = 1 - (1 - Math.min(1, t / 260)) ** 3;
    const zo = Math.min(1, Math.max(0, (t - 900) / 650));
    const zoom = zin * (1 - zo * zo * (3 - 2 * zo));
    if (!this.vignette) {
      this.vignette = document.createElement('div');
      this.vignette.id = 'slowmo-vignette';
      document.getElementById('stage')?.after(this.vignette);
    }
    this.vignette.style.opacity = String(zoom.toFixed(3));
    if (t > 1600) this.endSlowMo();
    return zoom;
  }

  undo() {
    this.sound.unlock();
    if (this.busy || this.completeAt !== null || this.dead) return;
    const snap = this.history.pop();
    if (!snap) return;
    this.hint = null;
    this.hud.stuckNudge(false);
    this.pos = snap.pos;
    if (this.splitUsed && !snap.split) {
      const m = this.multTile();
      if (m) this.board.unpick(m);
    }
    this.splitUsed = snap.split;
    this.setExtras(snap.extras);
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
    const m = this.multTile();
    if (m) this.board.unpick(m);
    this.hud.stuckNudge(false);
    this.hud.setMoves(0);
    this.placeBall(this.pos);
    this.ball.impact(0.4);
    this.sound.click();
    this.boardFx.clear();
  }

  private multTile(): Point | null {
    for (let y = 0; y < this.level.grid.length; y++) {
      const x = this.level.grid[y].indexOf(MULT);
      if (x >= 0) return { x, y };
    }
    return null;
  }

  private showHint() {
    this.sound.unlock();
    if (this.completeAt !== null || this.dead || this.busy) return;
    const stuck = !this.canFinish();
    if (this.hintGuide) {
      // Already guiding: a press in a dead end rewinds for free.
      if (stuck) this.rewind();
      else this.hud.toast('Hint is on: follow the arrows');
      return;
    }
    if (!this.spend('hints')) return;
    this.hintGuide = true;
    this.guideKey = '';
    // A hint always gets the player home: out of a dead end first, if need be.
    if (stuck) this.rewind();
    else this.hud.toast('Hint on: follow the arrows to the finish');
    this.sound.click();
  }

  /**
   * Can the level still be finished from here? Always, on a level that can
   * never get stuck (every built level); otherwise ask the solver.
   */
  private canFinish(): boolean {
    return this.neverStuck || solve(this.level.grid, this.pos, this.painted.keys(), 300000) !== null;
  }

  private readonly stuckFree = new WeakMap<Level, boolean>();
  /** Whether this level is impossible to get stuck in (see analyze). */
  private get neverStuck(): boolean {
    let v = this.stuckFree.get(this.level);
    if (v === undefined) {
      v = analyze(this.level.grid, this.level.start).neverStuck;
      this.stuckFree.set(this.level, v);
    }
    return v;
  }

  /** Undo back to the latest position the level can still be finished from. */
  private rewind() {
    let k = 0;
    while (!this.canFinish() && this.history.length) {
      this.undo();
      k++;
    }
    if (!this.canFinish()) {
      this.restart();
      this.hud.toast('Fresh start: follow the arrows');
      return;
    }
    this.hud.stuckNudge(false);
    this.hud.toast(`Back ${k} move${k === 1 ? '' : 's'}: follow the arrows`);
  }

  /**
   * Whenever the ball comes to rest: with the guide on, show the next
   * optimal move (re-solved from wherever the player is, so straying from
   * the route just plots a new one).
   */
  /** When the player last moved (or the level started): drives the hand. */
  private lastMoveAt = 0;
  private handKey = '';
  private handMove: Point | null = null;

  /**
   * The tutorial hand. On level 1 it shows every swipe (right away for the
   * first two, then if the player pauses); on levels 2 and 3 it shows the
   * next good move after five idle seconds.
   */
  private stepHand() {
    let dir: Point | null = null;
    const free = !this.slideState && this.completeAt === null && !this.dead && !this.busy && !this.bombAnim && !this.hud.modalOpen;
    if (free && this.levelNo <= 3) {
      const wait = this.levelNo === 1 ? (this.moves < 2 ? 450 : 3500) : 5000;
      if (this.time - this.lastMoveAt > wait) dir = this.handDir();
    }
    if (!dir) {
      this.hud.showHand(null);
      return;
    }
    const p = this.ball.getGlobalPosition();
    this.hud.showHand({ x: p.x, y: p.y, dx: dir.x, dy: dir.y });
  }

  private handDir(): Point | null {
    if (this.hintGuide && this.hint) return this.hint.dir;
    const key = `${this.pos.x},${this.pos.y}|${this.moves}|${this.painted.size}`;
    if (key !== this.handKey) {
      this.handKey = key;
      const sol = solveMulti(this.level.grid, this.pos, this.painted.keys(), 20000, this.extras.map((e) => e.pos), this.splitUsed);
      this.handMove = sol?.[0] ? DIRS[sol[0]] : null;
    }
    return this.handMove;
  }

  private updateGuide() {
    if (this.busy || this.completeAt !== null || this.dead || this.bombAnim) return;
    // Anything that changes the board (a move, restart, a bomb) clears
    // the hint, so a hint on screen is always current.
    if (this.hint) return;
    // Solve once per position for the guide's next move. Levels can never
    // get stuck, so there is always a way on: when the board is too big to
    // solve outright, the guide heads for the nearest unpainted floor (which
    // still always reaches the finish). Only a level that could trap the
    // ball would ever point at Restart.
    const key = `${this.pos.x},${this.pos.y}|${this.moves}|${this.painted.size}`;
    if (key === this.guideKey) return;
    this.guideKey = key;
    if (!this.hintGuide && this.neverStuck) return;
    const sol = solveMulti(this.level.grid, this.pos, this.painted.keys(), this.neverStuck ? 120000 : 300000, this.extras.map((e) => e.pos), this.splitUsed);
    const move = sol?.[0] ?? (this.neverStuck ? nextPaintingMove(this.level.grid, this.pos, new Set(this.painted.keys())) : null);
    if (!move) {
      if (sol === null && !this.neverStuck) {
        if (this.hintGuide) this.hud.toast('Dead end! Tap Restart or Hint');
        this.hud.stuckNudge(true);
        if (!this.save.tips.includes('tut-stuck')) {
          this.save.tips.push('tut-stuck');
          this.hud.showTip('Dead end! Tap Restart to try again');
          this.hud.pulse('btn-restart', 5000);
          this.persist();
        }
      }
      return;
    }
    if (!this.hintGuide) return;
    const r = slide(this.level.grid, this.pos, move);
    this.hint = { from: { ...this.pos }, path: r.path, dir: DIRS[move], since: this.time };
  }

  // ---------------------------------------------------------------- complete

  private beginComplete() {
    this.completeAt = this.time;
    this.hud.showHand(null);
    if (this.levelNo === 1 && !this.save.tips.includes('tut-basics')) {
      this.save.tips.push('tut-basics');
      this.hud.showTip(null);
    }
    // Celebration in the hand: da-da-DAA.
    this.vibrate([40, 70, 40, 70, 90]);
    this.timeScale = REDUCED_MOTION ? 1 : 0.3;
    this.hint = null;
  }

  private stepComplete() {
    if (this.completeAt === null) return;
    const t = this.time - this.completeAt;
    if (t > 260) this.timeScale = 1;
    const start = 200;
    if (t >= start && t - this.lastFrameDt < start) {
      this.sound.complete();
      if (!REDUCED_MOTION) this.scaleKickV += 1.1;
      // A small burst of paint out of the ball, then a wave of soft light
      // ripples out across every tile while the sheen sweeps the board
      // (drawSweep below); as the wave reaches the rim, some edge tiles kick
      // a little spray of paint outward. Nothing covers the screen.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        this.boardFx.splash(this.ball.x, this.ball.y, dx, dy, 4, this.look.paint, this.cell * 2.6, this.cell * 0.07,
          (x, y, r) => this.addDot(x, y, r));
      this.boardFx.flash(this.ball.x, this.ball.y, this.cell * 2, this.look.paintLight, 0.6);
      // The whole painted floor lights up, in a wave spreading out from the
      // ball (the fresh-paint glow, see Board.drawSheen).
      for (const k of this.painted.keys()) {
        const w = this.level.grid[0].length;
        const dist = Math.hypot((k % w) - this.pos.x, Math.floor(k / w) - this.pos.y);
        this.wet.set(k, { t: this.time + 40 + dist * 55, axis: 0 });
      }
      // The ball hops for joy and lands with a squash.
      const by = this.ball.y;
      this.tweens.push({
        t: 0,
        dur: 380,
        step: (p) => (this.ball.y = by - Math.sin(p * Math.PI) * this.cell * 0.55),
        done: () => {
          this.ball.y = by;
          this.ball.impact(0.8);
        },
      });
      // Confetti cannons from both lower corners, and a second smaller pop.
      if (!REDUCED_MOTION) {
        this.fireConfetti(1);
        this.confettiAt = this.time + 320;
      }
      const grid = this.level.grid;
      const midX = (grid[0].length - 1) / 2;
      const midY = (grid.length - 1) / 2;
      let rimCount = 0;
      this.sparkQueue = this.board
        .floorPoints()
        .map((p) => {
          const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !isFloor(grid, p.x + dx, p.y + dy));
          const kick = rim && rimCount++ % 2 === 0 ? { x: p.x - midX, y: p.y - midY } : undefined;
          return { ...this.board.cellCenter(p.x, p.y), at: this.time + Math.hypot(p.x - this.pos.x, p.y - this.pos.y) * 45, kick };
        })
        .sort((a, b) => a.at - b.at);
    }
    if (this.confettiAt > 0 && this.time >= this.confettiAt) {
      this.confettiAt = -1;
      this.fireConfetti(0.55);
    }
    while (this.sparkQueue.length && this.sparkQueue[0].at <= this.time) {
      const sp = this.sparkQueue.shift()!;
      this.boardFx.flash(sp.x, sp.y, this.cell * 0.8, this.look.paintLight, 0.32);
      if (sp.kick && !REDUCED_MOTION) {
        const l = Math.hypot(sp.kick.x, sp.kick.y) || 1;
        this.boardFx.splash(sp.x, sp.y, sp.kick.x / l, sp.kick.y / l, 6, this.look.paint, this.cell * 3.4, this.cell * 0.085);
      }
    }
    this.board.drawSweep((t - start - 100) / 900);
    if (t > 950 && !this.resultShown) {
      this.resultShown = true;
      this.resultAt = this.time;
      happytime();
      const par = this.level.par ?? this.moves;
      const stars = this.moves <= par ? 3 : this.moves <= Math.ceil(par * 1.4) ? 2 : 1;
      // Coins come slowly: they buy tools, so they should feel earned.
      // (A bonus level's coins are then multiplied by the Super Reward.)
      const coins = this.level.bonus ? 4 + stars * 2 : 2 + stars;
      const leagueBefore = league(this.save.week, this.save.weekStars).rows;
      if (!this.level.bonus) {
        this.save.coins += coins;
        this.save.weekStars += stars;
      }
      this.save.streak = this.restartedThisLevel ? 0 : this.save.streak + 1;
      // Keys are only found lying on the board (see placePickups).
      const key = false;
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
        // The top of what is visible: the first floor row (inside the
        // one-cell wall border) less the wall face standing above it.
        const top = this.board.toGlobal({ x: 0, y: this.cell * 0.55 }).y;
        this.hud.celebrate(info, { x: c.x, y: c.y }, top, onKey);
        this.autoNextAt = this.time + (key ? 2600 : 2300);
      }
      this.checkUnlocks();
    }
  }

  private fireConfetti(power: number) {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const colors = [this.look.paint, this.look.paintLight, 0xffd34a, 0xffffff, 0x6fe3ff, 0x9b7bff, 0xff7aa8];
    const n = Math.round(65 * power);
    const v = Math.max(1100, h * 2.5) * (0.8 + power * 0.2);
    this.confetti.burst(-8, h * 0.82, -Math.PI * 0.34, 0.5, n, v, colors);
    this.confetti.burst(w + 8, h * 0.82, -Math.PI * 0.66, 0.5, n, v, colors);
  }

  private lastFrameDt = 16;

  private resultAt = 0;
  /** Offset, tilt and scale of the incoming board during a transition. */
  private enter = { x: 0, rot: 0, s: 1 };
  private introSweepAt = -1e9;
  private autoNextAt: number | null = null;
  private landed = false;

  private restartedThisLevel = false;
  /** Levels finished since the last between-level ad. */
  private levelsSinceAd = 0;
  private bannerShown = false;
  /** When the free-coins video may be offered again. */
  private coinsReadyAt = 0;
  /** A rewarded ad was watched to keep playing this level: no midgame ad after it. */
  private watchedThisLevel = false;

  /** Bonus level: Super Reward multiplier, then the league climb, then on. */
  private bonusFlow(stars: number, coins: number, before: ReturnType<typeof league>['rows']) {
    this.hud.superReward(
      stars,
      coins,
      (m) => {
        this.save.coins += coins * m;
        this.save.weekStars += stars * m;
        this.persist();
        this.vibrate([30, 50, 30]);
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
      {
        // The first Super Reward multiplies for free; after that it is a
        // rewarded ad, always with Continue beside it. With no ads to be had
        // (e.g. Basic Launch) it stays free, so Multiply never goes missing.
        free: this.save.superRewards++ === 0 || !adsAvailable(),
        watchAd: adsAvailable() ? () => rewardedAd(() => this.sound.setMuted(true), () => this.sound.setMuted(this.portalMuted)) : null,
      },
    );
    this.persist();
  }

  /** Progress toward the next unlock after a level, or the unlock itself. */
  private showUnlockProgress(prevBest: number, best: number, ev: ReturnType<Game['advanceEvent']> = null) {
    if (best <= prevBest && !ev) return;
    // Never stack on top of a reward screen or panel; wait for it to close.
    if (this.hud.modalOpen) {
      window.setTimeout(() => this.showUnlockProgress(prevBest, best, ev), 400);
      return;
    }
    const items = this.shopItems();
    if (ev) {
      const it = items[ev.kind].find((x) => x.id === ev.id);
      if (ev.won) {
        this.sound.complete();
        this.hud.unlocked(ev.name, it?.preview ?? '', () => this.equip(ev.kind, ev.id));
        this.hud.setShopDot(true);
        return;
      }
      // While an event runs, its next prize is the goal shown after levels
      // (a level unlock reached at the same time still gets its moment).
      if (!items.ball.concat(items.paint, items.board, items.trail).some((x) => x.unlock > prevBest && x.unlock <= best && !x.event)) {
        const icon = it?.event?.icon ?? '';
        this.hud.newItemProgress(`${icon} ${it?.event?.name ?? 'Event'}: ${ev.name}`.trim(), it?.preview ?? '', ev.have - 1 - ev.prev, ev.have - ev.prev, ev.need - ev.prev);
        return;
      }
    }
    if (best <= prevBest) return;
    const all = [...items.ball, ...items.paint, ...items.board, ...items.trail].filter((x) => !x.event && !x.vault).sort((a, b) => a.unlock - b.unlock);
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
    // A fresh banner between levels (the SDK allows one a minute here).
    refreshBanner();
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
    const ev = this.advanceEvent();
    this.loadLevel(this.levelNo + 1, true);
    // Between levels is the only place a midgame ad may appear.
    // Between levels only, and gently: never before level 5 is done, at
    // least 4 levels apart (and 3 minutes, which the SDK enforces), not
    // after a bonus level (its reward screens are break enough), and never
    // after the player watched an ad to keep playing that same level.
    this.levelsSinceAd++;
    if (this.levelNo > 5 && this.levelsSinceAd >= 4 && !this.level.bonus && !this.watchedThisLevel) {
      this.levelsSinceAd = 0;
      void midgameAd(() => this.sound.setMuted(true), () => this.sound.setMuted(this.portalMuted));
    }
    window.setTimeout(() => this.showUnlockProgress(prevBest, this.save.best, ev), 650);
  }

  // ---------------------------------------------------------------- themes

  private applyTheme() {
    const t = this.theme;
    const root = document.documentElement.style;
    root.setProperty('--bg-top', t.bgTop);
    root.setProperty('--bg-bottom', t.bgBottom);
    root.setProperty('--ink', t.ui.ink);
    root.setProperty('--page-ink', t.ui.pageInk ?? t.ui.ink);
    // Light text on a dark page gets a dark drop, never a white glow.
    root.setProperty('--page-shadow', t.ui.pageInk ? 'rgba(10, 0, 40, 0.45)' : 'rgba(255, 255, 255, 0.7)');
    root.setProperty('--deep', t.ui.deep);
    root.setProperty('--p1', t.ui.p1);
    root.setProperty('--p2', t.ui.p2);
    root.setProperty('--p3', t.ui.p3);
    root.setProperty('--panel-edge', t.ui.panelEdge);
    const res = Math.min(window.devicePixelRatio || 1, 2);
    this.pageBg.visible = !!t.slab;
    if (t.slab) {
      this.pageBg.texture = slabTexture(t.slab, res);
      this.pageBg.tileScale.set(1 / res);
    }
    this.sound.setRoot(t.root);
  }

  private selectTheme(id: string) {
    const next = THEMES.find((t) => t.id === id);
    if (!next || next === this.theme) return;
    this.theme = next;
    this.look = this.makeLook();
    this.hud.setPaintColors(this.look.paint, this.look.paintLight, this.look.paintDark);
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
    if (!this.save.vibe) return;
    // Phones vibrate at one strength; longer pulses feel stronger. Each
    // pulse is stretched (the gaps keep the rhythm).
    const p = Array.isArray(ms) ? ms : [ms];
    haptic(p.map((v, i) => (i % 2 === 0 ? Math.min(120, Math.max(22, Math.round(v * 1.8))) : v)));
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
    if (this.busy || this.completeAt !== null || this.bombAnim || this.dead) return;
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
        this.paintAxis.set(this.key(tp), 2);
        this.speckle(tp);
        // A coin or key on a shot tile is picked up too.
        this.collect(tp);
        this.boardFx.splash(to.x, to.y, 0, -1, 8, this.look.paint, this.cell * 3, this.cell * 0.08, (x, y, rr) => this.addDot(x, y, rr));
        this.boardFx.ring(to.x, to.y, this.cell * 0.6, 0xffffff);
        this.sound.thock(0.7);
        this.sound.paintTile();
        this.vibrate(18);
        this.updateRemaining();
      }
    });
    if (shotT > flight + b.targets.length * 70 + 40) {
      this.bombAnim = null;
      g.clear();
      this.hint = null;
      if (this.painted.size >= this.floorTotal) this.beginComplete();
    }
  }

  // ---------------------------------------------------------------- frame

  private tick(rawDt: number) {
    // Cap long frames so slow devices skip ahead rather than crawl.
    const slowZoom = this.stepSlowMo();
    const dt = Math.min(rawDt, 90) * this.timeScale;
    this.board.timeScale = this.timeScale;
    this.lastFrameDt = rawDt;
    this.time += rawDt;
    const time = this.time;

    if (this.completeAt === null && !this.dead && !this.hud.modalOpen) gameplayStart();
    else gameplayStop();
    // The banner ad only on screens that stay open a while, never in play.
    const wantBanner = GAMEPLAY_BANNER || BANNER_SCREENS.some((id) => document.getElementById(id)?.classList.contains('show'));
    if (wantBanner) showBanner();
    else hideBanner();
    // The strip changes the room left for the board: lay it out again.
    const hasBanner = document.body.classList.contains('has-banner');
    if (hasBanner !== this.bannerShown) {
      this.bannerShown = hasBanner;
      this.layoutCache = null;
      this.relayout();
    }

    this.stepSlide(dt);
    this.stepExtras(dt);
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
    // View: eases toward its target (the shop slides the board up).
    const v = this.view;
    const k = Math.min(1, rawDt / 90);
    v.dx += (v.tdx - v.dx) * k;
    v.dy += (v.tdy - v.dy) * k;
    v.s += (v.ts - v.s) * k;
    const sc = e.s * v.s * (1 + this.scaleKick * 0.05);
    this.board.scale.set(sc, sc * this.foreshorten);
    this.board.rotation = e.rot;
    this.board.position.set(cx + n.x + e.x + v.dx, cy + n.y + v.dy);
    // Bullet-time punch-in: zoom about the cut point, drifting it a little
    // toward the middle of the screen.
    if (slowZoom > 0 && this.slowMo) {
      const z = 1 + 0.22 * slowZoom;
      const sx = sc * this.foreshorten;
      const px = (this.slowMo.x - this.board.pivot.x) * sc;
      const py = (this.slowMo.y - this.board.pivot.y) * sx;
      this.board.scale.set(sc * z, sx * z);
      this.board.position.x -= px * (z - 1) + px * 0.4 * slowZoom;
      this.board.position.y -= py * (z - 1) + py * 0.4 * slowZoom;
    }
    // At rest, put the board's corner on a whole device pixel so the tile
    // lines and edges are razor sharp.
    if (e.rot === 0 && Math.abs(this.board.scale.x - 1) < 1e-3) {
      const dpr = this.app.renderer.resolution;
      const bx = this.board.position.x - this.board.pivot.x;
      const by = this.board.position.y - this.board.pivot.y;
      this.board.position.set(Math.round(bx * dpr) / dpr + this.board.pivot.x, Math.round(by * dpr) / dpr + this.board.pivot.y);
    }
    this.board.alignSlab();
    if (this.pageBg.visible) {
      this.pageBg.width = this.app.screen.width;
      this.pageBg.height = this.app.screen.height;
    }
    if (this.completeAt === null) {
      const sweep = (time - this.introSweepAt) / 750;
      if (sweep >= 0 && sweep < 1.5) this.board.drawSweep(sweep, 0.6);
    }

    const moving = !!this.slideState;
    const speed = this.slideState ? (this.slideState.path.length / (this.slideState.dur / 1000) / 30) * this.turnDamp : 0;
    this.ball.update(dt, time, moving, this.lastDir, speed);
    this.trail?.update(dt, this.ball.x, this.ball.y + this.ball.restY * this.ball.scale.y, moving, this.warping);
    for (const e of this.extras) {
      const es = e.slide;
      e.ball.update(dt, time, !!es, e.lastDir, es ? es.path.length / (es.dur / 1000) / 30 : 0);
    }
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

    this.updateGuide();
    this.stepHand();
    this.board.drawHint(time, this.hint);

    if (this.dots.length > 40 && time - this.dots[0].t > 1200) this.dots = this.dots.filter((d) => time - d.t < (d.life ?? 900));
    const stroke: PaintStroke = {
      painted: this.painted,
      axis: this.paintAxis,
      dots: this.dots,
      splats: this.splats,
      startRound: this.moves === 0 && !this.slideState ? this.key(this.level.start) : undefined,
      wet: this.wet,
    };
    if (this.cone) {
      // From a fifth of a tile ahead of where the run began to the centre of
      // the ball's drawn body. Once the ball stops the cone holds a moment,
      // then its tip runs in to the ball (measured on the original).
      const o = this.ball.bodyOffset;
      const base = { x: this.ball.x + o.x, y: this.ball.y + o.y * this.ball.scale.y };
      const f = this.board.cellCenter(this.cone.from.x, this.cone.from.y);
      f.y += this.ball.restY * this.ball.scale.y;
      const dl = Math.hypot(base.x - f.x, base.y - f.y);
      const q = this.cone.endedAt === null ? 0 : Math.min(1, Math.max(0, (time - this.cone.endedAt - 70) / 110));
      if (q >= 1 || dl < this.cell * 0.3) {
        this.board.drawCone(null, base, 0);
        if (q >= 1) this.cone = null;
      } else {
        const lead = (this.cell * 0.2) / dl;
        const t = lead + (1 - lead) * q ** 1.2;
        this.board.drawCone({ x: f.x + (base.x - f.x) * t, y: f.y + (base.y - f.y) * t }, base, this.coneColor);
      }
    } else this.board.drawCone(null, { x: 0, y: 0 }, 0);
    if (this.slideState) {
      const st = this.slideState;
      const p = Math.min(1, st.t / st.dur);
      const dist = p * (0.6 + 0.4 * p) * st.path.length;
      stroke.active = this.slidePoint(st, dist).band;
    }
    stroke.more = [];
    for (const e of this.extras) {
      const es = e.slide;
      if (!es?.path.length) continue;
      const p = Math.min(1, es.t / es.dur);
      stroke.more.push(this.slidePoint(es, p * (0.6 + 0.4 * p) * es.path.length).band);
    }
    if (this.light) {
      // The board's light filter renders a fixed area around the board,
      // snapped to whole device pixels and clipped to the screen. Left to
      // itself the filter frame would follow the board's bounds, which
      // flying paint drops make fractional: the whole board would then be
      // resampled between pixels and thin tile lines would fade in places.
      const scr = this.app.screen;
      const res = this.app.renderer.resolution;
      const m = this.board.pad + this.cell * 3;
      const corners = [
        this.board.toGlobal({ x: -m, y: -m }),
        this.board.toGlobal({ x: this.board.boardWidth + m, y: -m }),
        this.board.toGlobal({ x: -m, y: this.board.boardHeight + m }),
        this.board.toGlobal({ x: this.board.boardWidth + m, y: this.board.boardHeight + m }),
      ];
      const snapDown = (v: number) => Math.floor(v * res) / res;
      const snapUp = (v: number) => Math.ceil(v * res) / res;
      const x0 = Math.max(0, snapDown(Math.min(...corners.map((c) => c.x))));
      const y0 = Math.max(0, snapDown(Math.min(...corners.map((c) => c.y))));
      const x1 = Math.min(snapUp(scr.width), snapUp(Math.max(...corners.map((c) => c.x))));
      const y1 = Math.min(snapUp(scr.height), snapUp(Math.max(...corners.map((c) => c.y))));
      // filterArea is in the board's own space: map the snapped screen
      // rectangle back into it.
      const a = this.board.toLocal({ x: x0, y: y0 });
      const b = this.board.toLocal({ x: x1, y: y1 });
      this.filterArea.x = Math.min(a.x, b.x);
      this.filterArea.y = Math.min(a.y, b.y);
      this.filterArea.width = Math.max(1, Math.abs(b.x - a.x));
      this.filterArea.height = Math.max(1, Math.abs(b.y - a.y));
      this.board.filterArea = this.filterArea;
      const u = this.light.uniforms;
      u.uFrame[0] = Math.max(1, x1 - x0);
      u.uFrame[1] = Math.max(1, y1 - y0);
      const p = this.ball.getGlobalPosition();
      u.uLight[0] = p.x - x0;
      u.uLight[1] = p.y - y0;
      // Shockwave: a small ring that expands fast, then eases out as it fades.
      const w = this.wave;
      if (w) {
        w.t += rawDt;
        const t = Math.min(1, w.t / 380);
        const g = this.board.toGlobal({ x: w.x, y: w.y });
        const scale = this.board.scale.x;
        u.uWave[0] = g.x - x0;
        u.uWave[1] = g.y - y0;
        u.uWave[2] = this.cell * (0.15 + 0.95 * (1 - (1 - t) ** 3)) * scale;
        u.uWave[3] = w.power * (1 - t) ** 1.6;
        u.uWaveWidth = this.cell * (0.26 + 0.14 * t) * scale;
        if (t >= 1) this.wave = null;
      } else u.uWave[3] = 0;
    }
    {
      const res = this.app.renderer.resolution;
      const o = this.board.toGlobal({ x: 0, y: 0 });
      this.board.setPaintSpace(o.x * res, o.y * res, this.board.cell * this.board.scale.x * res);
    }
    this.board.update(time, stroke, this.remaining);
    this.boardFx.update(dt);
    this.confetti.update(rawDt, this.app.screen.height);
    this.ambient.update(rawDt / 1000, time, this.app.screen.width, this.app.screen.height, this.theme);
  }

  private layoutCache: { cx: number; cy: number } | null = null;

  private view = { dx: 0, dy: 0, s: 1, tdx: 0, tdy: 0, ts: 1 };

  /** League standings for a given star count (used by tests and the HUD). */
  leagueRows(stars: number) {
    return league(this.save.week, stars).rows;
  }

  /** Fit the board in the area the shop leaves free (screen px), or restore it. */
  focusAbove(free: { top: number; bottom: number; left: number; right: number } | null) {
    const v = this.view;
    if (free === null) {
      v.tdx = 0;
      v.tdy = 0;
      v.ts = 1;
      return;
    }
    const { cx, cy } = this.layoutCache ?? (this.layoutCache = this.layout());
    const h = this.board.boardHeight;
    const w = this.board.boardWidth;
    const areaH = Math.max(80, free.bottom - free.top);
    const areaW = Math.max(80, free.right - free.left);
    v.ts = Math.min(1, areaH / h, areaW / w);
    v.tdx = free.left + areaW / 2 - cx;
    v.tdy = free.top + areaH / 2 - cy;
  }

  invalidateLayout() {
    this.layoutCache = null;
    this.relayout();
  }
}

/**
 * Level each item unlocked at before unlocks were spread out to level 600.
 * A player who already passed one keeps it: nothing they had is taken away.
 * (Ad-unlock specials are left out; those stay earned by ads.)
 */
const OLD_UNLOCKS: Record<string, number> = {
  pearl: 3, earth: 6, ruby: 9, softball: 12, volley: 16, mint: 20, basket: 24, soccer: 30, moon: 36, eight: 44, gold: 55,
  sun: 5, blue: 10, lime: 16, violet: 24, aqua: 32, orange: 40, marble: 50, slime: 65, lava: 80,
  wood: 15, terrazzo: 20, candy: 25, ocean: 30, birch: 40, neon: 50, knit: 60, terrawood: 70, grass: 80,
};

function keepOldUnlocks(save: Save) {
  if ((save.pace ?? 1) >= 2) return;
  const keep = new Set(save.owned);
  for (const [id, at] of Object.entries(OLD_UNLOCKS)) if (at <= save.best) keep.add(id);
  // Whatever is equipped stays usable.
  keep.add(save.ball).add(save.paint).add(save.theme);
  save.owned = [...keep];
  save.pace = 2;
  storeSave(save);
}
