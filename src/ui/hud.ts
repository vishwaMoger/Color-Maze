// DOM overlay: HUD, panels (shop, settings, league, key vault) and the
// level-complete moments. The board itself is drawn by Pixi underneath.

import { BALL_URLS } from '../game/assets.ts';

// Players are shown by their ball, like the original.
const SPHERES = ['#ffd23a', '#ff4f7a', '#4fdca0', '#5aa8ff', '#b67bff', '#ff9a3d', '#3d3d55', '#f2f0ff'];
const avatarStyle = (r: { name: string; you?: boolean; avatar: string }) => {
  let h = 7;
  for (const ch of r.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const balls = Object.values(BALL_URLS);
  if (!r.you && h % 3 === 0 && balls.length) return `background:url('${balls[h % balls.length]}') center / cover no-repeat`;
  const c = r.you ? '#ffc21a' : SPHERES[h % SPHERES.length];
  return `background:radial-gradient(circle at 35% 30%, #fff 0 8%, ${c} 38%, color-mix(in srgb, ${c} 60%, #000) 100%)`;
};

export type VaultKind = 'hint' | 'item' | 'coins';

export interface VaultSession {
  dots: Record<VaultKind, number>;
  keys: number;
  /** What the next opened lock holds. */
  pick: () => VaultKind;
  /** A card reached three: grant it and return the label to show. */
  win: (k: VaultKind) => string;
  onDot: (k: VaultKind, dots: number) => void;
  onDone: () => void;
  sound: { click: () => void; thock: (s: number) => void; coin: () => void; star: (i: number) => void; complete: () => void };
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const KEYHOLE_SVG =
  '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="15.5" r="6.2"/><path d="M16.2 18.5h7.6l2 12.2a1.6 1.6 0 0 1-1.6 1.8h-8.4a1.6 1.6 0 0 1-1.6-1.8Z"/></svg>';

const KEYHOLE_OUTLINE_SVG =
  '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 8.6a6.9 6.9 0 0 0-4.4 12.2l-1.7 10.3a1.9 1.9 0 0 0 1.9 2.2h8.4a1.9 1.9 0 0 0 1.9-2.2l-1.7-10.3A6.9 6.9 0 0 0 20 8.6Z"/></svg>';

export type ShopTab = 'ball' | 'paint' | 'board';

export interface ShopItem {
  id: string;
  name: string;
  unlock: number;
  /** CSS for the preview swatch. */
  preview: string;
  /** CSS for the tile's own background (ball tiles). */
  bg?: string;
  kind: 'ball' | 'paint' | 'board';
}

export interface HudActions {
  restart: () => void;
  undo: () => void;
  hint: () => void;
  bomb: () => void;
  next: () => void;
  equip: (tab: ShopTab, id: string) => void;
  toggle: (what: 'sfx' | 'music' | 'vibe') => void;
  openShop: () => void;
  openLeague: () => void;
  freeCoins: () => void;
  /** A bottom sheet opened (its top edge in px) or closed (null). */
  sheet: (top: number | null) => void;
  anyInput: () => void;
  click: () => void;
}

export interface ResultInfo {
  level: number;
  stars: number;
  moves: number;
  par: number;
  coins: number;
  totalCoins: number;
  bonus: boolean;
  key: boolean;
  onStar: (i: number) => void;
  onCoin: () => void;
}

export interface LeagueRow {
  name: string;
  stars: number;
  you: boolean;
  avatar: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;


export class Hud {
  private readonly top = $('hud-top');
  private readonly bottom = $('hud-bottom');
  private readonly levelLabel = $('level-label');
  private readonly chain = $('level-progress');
  private readonly movesLabel = $('moves');
  private readonly coinsLabel = $('coins-count');
  private readonly tip = $('tip');
  private readonly toastEl = $('toast');
  private readonly result = $('result');
  private toastTimer = 0;
  private coinTimer = 0;
  private shownCoins = 0;
  private actions!: HudActions;
  private shopTab: ShopTab = 'ball';
  private shopData: Record<ShopTab, { items: ShopItem[]; equipped: string }> = {
    ball: { items: [], equipped: '' },
    paint: { items: [], equipped: '' },
    board: { items: [], equipped: '' },
  };
  private unlockedTo = 1;

  bind(a: HudActions) {
    this.actions = a;
    const on = (id: string, fn: () => void, silent = false) =>
      $(id).addEventListener('click', (e) => {
        e.stopPropagation();
        a.anyInput();
        if (!silent) a.click();
        fn();
      });
    on('btn-restart', a.restart, true);
    on('btn-undo', a.undo, true);
    on('btn-hint', a.hint, true);
    on('btn-bomb', a.bomb, true);
    // Every chunky button springs back with a little pop when released.
    let pressed: HTMLElement | null = null;
    document.addEventListener('pointerdown', (e) => {
      pressed = (e.target as HTMLElement).closest?.('.gbtn') ?? null;
    }, true);
    document.addEventListener('pointerup', () => {
      const b = pressed;
      pressed = null;
      if (!b) return;
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
      window.setTimeout(() => b.classList.remove('pop'), 360);
    }, true);
    on('btn-shop', () => {
      a.openShop();
      this.open('shop');
    });
    on('btn-settings', () => this.open('settings'));
    this.startIdleZap();
    on('btn-league-info', () => ($('league-help').hidden = !$('league-help').hidden));
    on('btn-free-coins', a.freeCoins);
    on('btn-league', () => {
      a.openLeague();
      this.open('league');
    });
    on('btn-streak', () => this.toast('Finish levels without restarting to grow your streak!'));
    on('btn-next', a.next, true);
    on('tg-sfx', () => a.toggle('sfx'));
    on('tg-music', () => a.toggle('music'));
    on('tg-vibe', () => a.toggle('vibe'));
    on('btn-unlock-equip', () => {
      this.close('unlocked');
      this.onUnlockEquip?.();
    });
    on('btn-unlock-later', () => this.close('unlocked'));
    for (const b of document.querySelectorAll<HTMLElement>('[data-close]'))
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        a.click();
        this.close(b.dataset.close!);
      });
    $('shop').addEventListener('click', (e) => {
      if (e.target === $('shop')) this.close('shop');
    });
    for (const t of document.querySelectorAll<HTMLElement>('.tab'))
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        a.click();
        this.shopTab = t.dataset.tab as ShopTab;
        this.renderShop();
      });
    this.result.addEventListener('click', () => {
      a.anyInput();
      a.next();
    });
    // Physical press state for touch as well as mouse.
    for (const b of document.querySelectorAll<HTMLElement>('.gbtn, .league, .streak')) {
      b.addEventListener('pointerdown', () => b.classList.add('pressed'));
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
        b.addEventListener(ev, () => b.classList.remove('pressed'));
    }
  }

  get modalOpen() {
    return ['shop', 'settings', 'league', 'vault', 'super', 'climb', 'unlocked', 'revive'].some((id) => !$(id).hidden);
  }

  open(id: string) {
    const m = $(id);
    m.hidden = false;
    document.body.classList.toggle('sheet-open', id === 'shop' || document.body.classList.contains('sheet-open'));
    document.body.classList.toggle('page-open', id === 'settings' || id === 'league' || document.body.classList.contains('page-open'));
    requestAnimationFrame(() => {
      m.classList.add('show');
      if (id === 'shop') this.actions.sheet(m.querySelector<HTMLElement>('.sheet-panel')!.offsetTop);
    });
  }

  close(id: string) {
    const m = $(id);
    m.classList.remove('show');
    if (id === 'shop') {
      document.body.classList.remove('sheet-open');
      this.actions.sheet(null);
    }
    if (id === 'settings' || id === 'league') document.body.classList.remove('page-open');
    window.setTimeout(() => (m.hidden = true), 220);
  }

  hideSplash(progress: number) {
    const bar = document.querySelector<HTMLElement>('#splash .loadbar span');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    if (progress >= 1) window.setTimeout(() => $('splash').classList.add('hide'), 350);
  }

  /** Landscape (PC, tablets on their side): controls move to side columns. */
  updateMode() {
    document.body.classList.toggle('landscape', window.innerWidth > window.innerHeight * 1.1);
  }

  get landscape() {
    return document.body.classList.contains('landscape');
  }

  topInset() {
    return this.insets().top;
  }

  /** Free area for the board: space not covered by HUD elements. */
  insets(): { top: number; bottom: number; left: number; right: number } {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!this.landscape) {
      return {
        top: this.top.getBoundingClientRect().bottom,
        bottom: H - this.bottom.getBoundingClientRect().top,
        left: 0,
        right: 0,
      };
    }
    const rects = (sel: string) =>
      [...document.querySelectorAll<HTMLElement>(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const left = rects('.col-left');
    const right = rects('.col-right');
    return {
      top: $('level-info').getBoundingClientRect().bottom,
      bottom: 12,
      left: Math.max(0, ...left.map((r) => r.right)),
      right: W - Math.min(W, ...right.map((r) => r.left)),
    };
  }

  // ------------------------------------------------------------ HUD values

  setLevel(n: number, bonus: boolean, par?: number) {
    this.levelLabel.textContent = bonus ? `Bonus level ${n}` : `Level ${n}`;
    this.levelLabel.classList.toggle('bonus', bonus);
    // Five stops per group, the fifth is the bonus level. Finished stops
    // are fat bubbles joined by pinched necks (like the original); the
    // current stop is a dot, the bonus a ring.
    const at = (n - 1) % 5;
    const xs = [12, 31, 50, 69, 88];
    const cy = 11;
    const R = 7.2;
    let svg = '<rect class="track" x="1" y="1" width="98" height="20" rx="10" />';
    const k = Math.cos(Math.PI / 4.2);
    const sn = Math.sin(Math.PI / 4.2);
    for (let i = 0; i + 1 < at; i++) {
      const a0 = xs[i] + R * k;
      const b0 = xs[i + 1] - R * k;
      const mid = (xs[i] + xs[i + 1]) / 2;
      svg += `<path class="done" d="M${a0} ${cy - R * sn}Q${mid} ${cy - 2.4} ${b0} ${cy - R * sn}L${b0} ${cy + R * sn}Q${mid} ${cy + 2.4} ${a0} ${cy + R * sn}Z" />`;
    }
    xs.forEach((x, i) => {
      if (i < at) svg += `<circle class="done" cx="${x}" cy="${cy}" r="${R}" />`;
      else if (i === at) svg += i === 4 ? `<circle class="bonus now" cx="${x}" cy="${cy}" r="5.6" />` : `<circle class="now" cx="${x}" cy="${cy}" r="4.4" />`;
      else if (i === 4) svg += `<circle class="bonus" cx="${x}" cy="${cy}" r="5" />`;
      else svg += `<circle class="next" cx="${x}" cy="${cy}" r="3.4" />`;
    });
    this.chain.innerHTML = svg;
    // The bonus reward above the bar fills in as the group progresses.
    $('lvl-reward').dataset.stage = String(bonus ? 3 : at >= 3 ? 2 : at >= 1 ? 1 : 0);
    this.movesLabel.dataset.par = par ? String(par) : '';
  }

  /** Coins picked up on the board fly to the coin counter. */
  flyCoins(from: { x: number; y: number }, n: number, total: number) {
    let landed = 0;
    const start = this.shownCoins;
    this.flyTo(this.coinsLabel.parentElement!.querySelector('.coin')!, from, n, 'ico ico-coin coin flyer', () => {
      landed++;
      this.bumpCoins(landed === n ? total : Math.round(start + ((total - start) / n) * landed));
    }, 0);
  }

  /** A key picked up on the board flies into its slot. */
  flyKey(from: { x: number; y: number }, have: number) {
    const slot = document.querySelectorAll('#keys .key')[Math.min(2, have - 1)];
    this.flyTo(slot, from, 1, 'key-flyer', () => this.setKeys(have, true), 0);
  }

  /** Red flash at the screen edges when the ball is destroyed. */
  hurt() {
    const el = $('hurt');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  /**
   * "Don't give up": revive within the countdown, or give up (restart and
   * lose the streak). Revive will become a rewarded ad on CrazyGames.
   */
  revive(o: { level: number; streak: number; seconds: number; onRevive: () => void; onGiveUp: () => void; tick: () => void }) {
    $('revive-level').textContent = `Level ${o.level}`;
    $('revive-streak').textContent = String(o.streak);
    $('revive-sub').textContent = o.streak > 0 ? "You'll lose your win streak" : "You'll lose this level's progress";
    const bar = $('revive-bar');
    const count = $('revive-count');
    const circ = 2 * Math.PI * 15;
    bar.style.strokeDasharray = String(circ);
    let left = o.seconds;
    let done = false;
    const t0 = performance.now();
    const frame = (now: number) => {
      if (done) return;
      const el = (now - t0) / 1000;
      bar.style.strokeDashoffset = String(circ * Math.min(1, el / o.seconds));
      const n = Math.max(0, Math.ceil(o.seconds - el));
      if (n !== left) {
        left = n;
        count.textContent = String(n);
        count.classList.remove('tick');
        void count.offsetWidth;
        count.classList.add('tick');
        o.tick();
      }
      if (el >= o.seconds) finish(false);
      else requestAnimationFrame(frame);
    };
    count.textContent = String(o.seconds);
    const finish = (revived: boolean) => {
      if (done) return;
      done = true;
      for (const [id, fn] of handlers) $(id).removeEventListener('click', fn);
      this.close('revive');
      if (revived) o.onRevive();
      else o.onGiveUp();
    };
    const handlers: [string, (e: Event) => void][] = [
      ['btn-revive', (e) => (e.stopPropagation(), finish(true))],
      ['btn-giveup', (e) => (e.stopPropagation(), finish(false))],
      ['btn-revive-close', (e) => (e.stopPropagation(), finish(false))],
    ];
    for (const [id, fn] of handlers) $(id).addEventListener('click', fn);
    this.open('revive');
    requestAnimationFrame(frame);
  }

  /** Level title pops in as the next board arrives. */
  popLevel() {
    const el = $('level-info');
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  setMoves(n: number) {
    const par = this.movesLabel.dataset.par;
    this.movesLabel.innerHTML = par
      ? `<b class="${n > Number(par) ? 'over' : ''}">${n}</b><span class="of">/ ${par}</span><span class="gold">★★★</span>`
      : `<b>${n}</b> moves`;
  }

  setCoins(n: number) {
    this.shownCoins = n;
    this.coinsLabel.textContent = String(n);
  }

  setKeys(n: number, popLast = false) {
    const keys = document.querySelectorAll<SVGElement>('#keys .key');
    keys.forEach((k, i) => {
      k.classList.toggle('have', i < n);
      k.classList.toggle('pop', popLast && i === n - 1);
    });
  }

  setStreak(n: number, bump = false) {
    const b = $('btn-streak');
    b.classList.toggle('lit', n >= 1);
    b.classList.toggle('hot', n >= 3);
    b.classList.toggle('blaze', n >= 5);
    if (!bump) {
      $('streak-count').textContent = String(n);
      return;
    }
    // Charging: the flame drops, electricity crackles around the can, the
    // flame surges back up and the new number pops in.
    b.classList.remove('bump', 'snuff', 'charge');
    void b.offsetWidth;
    b.classList.add('charge');
    this.zap(900, true);
    window.setTimeout(() => {
      $('streak-count').textContent = String(n);
      b.classList.remove('charge');
      b.classList.add('bump');
      const fx: HTMLElement[] = [];
      const add = (cls: string, style = '', text = '') => {
        const el = document.createElement('span');
        el.className = `streak-fx ${cls}`;
        el.setAttribute('style', style);
        el.textContent = text;
        b.appendChild(el);
        fx.push(el);
      };
      add('ring');
      for (let i = 0; i < 12; i++) add('spark', `--a:${i * 30 + Math.random() * 14}deg;--d:${30 + Math.random() * 22}px;animation-delay:${Math.random() * 60}ms`);
      add('plus', '', '+1');
      window.setTimeout(() => fx.forEach((el) => el.remove()), 1100);
    }, 650);
  }

  private zapTimer = 0;
  private idleZap = 0;

  /**
   * Lightning around the streak can: jagged bolts redrawn every few frames
   * between points on the can's edge and the air around it.
   */
  zap(ms: number, strong: boolean) {
    const g = $('zap-bolts');
    const b = $('btn-streak');
    const blue = b.classList.contains('blaze');
    window.clearInterval(this.zapTimer);
    const end = performance.now() + ms;
    const bolt = () => {
      // From a point on the can outline to a point outside it.
      const side = Math.floor(Math.random() * 4);
      const pt = (out: number): [number, number] => {
        const t = Math.random();
        if (side === 0) return [-out, 10 + t * 30];
        if (side === 1) return [34 + out, 10 + t * 30];
        if (side === 2) return [4 + t * 26, -out];
        return [4 + t * 26, 46 + out];
      };
      const [x0, y0] = pt(-2);
      const [x1, y1] = pt(5 + Math.random() * 9);
      let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`;
      const n = 5;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const jx = i === n ? 0 : (Math.random() - 0.5) * 6;
        const jy = i === n ? 0 : (Math.random() - 0.5) * 6;
        d += `L${(x0 + (x1 - x0) * t + jx).toFixed(1)} ${(y0 + (y1 - y0) * t + jy).toFixed(1)}`;
      }
      return d;
    };
    const flick = () => {
      if (performance.now() > end) {
        window.clearInterval(this.zapTimer);
        g.innerHTML = '';
        return;
      }
      const count = strong ? 4 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
      let html = '';
      for (let i = 0; i < count; i++) {
        const d = bolt();
        html += `<path class="glow${blue ? ' blue' : ''}" d="${d}"/><path class="core" d="${d}"/>`;
      }
      g.innerHTML = Math.random() < 0.15 ? '' : html;
    };
    flick();
    this.zapTimer = window.setInterval(flick, 55);
  }

  /** Occasional crackle while the streak is hot. */
  private startIdleZap() {
    window.clearInterval(this.idleZap);
    this.idleZap = window.setInterval(() => {
      const b = $('btn-streak');
      if (b.classList.contains('hot') && !document.hidden && Math.random() < 0.6) this.zap(260 + Math.random() * 200, false);
    }, 2600);
  }

  /** The streak is gone: the flame snuffs out in a puff of smoke. */
  streakLost() {
    const b = $('btn-streak');
    this.setStreak(0);
    b.classList.remove('bump', 'snuff');
    void b.offsetWidth;
    b.classList.add('snuff');
    const fx: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('span');
      el.className = 'streak-fx smoke';
      el.setAttribute('style', `--dx:${(i - 1.5) * 10}px;animation-delay:${i * 90}ms`);
      b.appendChild(el);
      fx.push(el);
    }
    window.setTimeout(() => fx.forEach((el) => el.remove()), 1400);
  }

  setPrices(p: { hint: { price: number; free: number }; bomb: { price: number; free: number } }) {
    for (const [k, v] of [['hint', p.hint], ['bomb', p.bomb]] as const) {
      $(`${k}-price`).innerHTML = `<i class="ico ico-coin"></i>${v.price}`;
      const f = $(`${k}-free`);
      f.hidden = v.free <= 0;
      f.textContent = String(v.free);
    }
  }


  setLeague(rank: number, timeLeft: string) {
    $('league-rank').textContent = String(rank);
    $('league-time').textContent = timeLeft;
    $('league-left').textContent = timeLeft;
  }

  setShopDot(on: boolean) {
    $('shop-dot').hidden = !on;
  }

  setToggles(t: { sfx: boolean; music: boolean; vibe: boolean }) {
    $('tg-sfx').setAttribute('aria-pressed', String(t.sfx));
    $('tg-music').setAttribute('aria-pressed', String(t.music));
    $('tg-vibe').setAttribute('aria-pressed', String(t.vibe));
  }

  // ------------------------------------------------------------ shop

  setShop(tab: ShopTab, items: ShopItem[], equipped: string, unlockedTo: number) {
    this.shopData[tab] = { items, equipped };
    this.unlockedTo = unlockedTo;
    this.renderShop();
  }

  private renderShop() {
    for (const t of document.querySelectorAll<HTMLElement>('#shop .tab'))
      t.setAttribute('aria-selected', String(t.dataset.tab === this.shopTab));
    const grid = $('shop-grid');
    grid.innerHTML = '';
    for (const el of document.querySelectorAll('.shop-coins')) el.textContent = String(this.shownCoins);
    const { items, equipped } = this.shopData[this.shopTab];
    // Pages of six (two rows of three), swiped sideways like the original.
    let page: HTMLElement | null = null;
    items.forEach((it, i) => {
      if (i % 6 === 0) {
        page = document.createElement('div');
        page.className = 'spage';
        grid.appendChild(page);
      }
      const locked = this.unlockedTo < it.unlock;
      const b = document.createElement('button');
      b.className = `tile ${it.kind}${locked ? ' locked' : ''}${it.id === equipped ? ' on' : ''}`;
      b.setAttribute('aria-label', `${it.name}${locked ? `, unlocks at level ${it.unlock}` : ''}`);
      if (it.bg) b.setAttribute('style', it.bg);
      b.innerHTML = `<span class="swatch" style="${it.preview}"></span>${
        locked
          ? `<span class="chip">${Math.min(this.unlockedTo, it.unlock)}/${it.unlock} lvls</span><span class="lockb"></span>`
          : it.id === equipped
            ? '<span class="tick"></span>'
            : '<span class="chip apply">Apply</span>'
      }`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.actions.anyInput();
        if (locked) {
          this.toast(`${it.name} unlocks at level ${it.unlock}`);
          return;
        }
        this.actions.click();
        this.actions.equip(this.shopTab, it.id);
        this.shopData[this.shopTab].equipped = it.id;
        this.renderShop();
      });
      page!.appendChild(b);
    });
    const dots = $('shop-dots');
    const pages = grid.children.length;
    dots.innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('') : '';
    grid.scrollLeft = 0;
    grid.onscroll = () => {
      const i = Math.round(grid.scrollLeft / Math.max(1, grid.clientWidth));
      dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
    };
  }

  // ------------------------------------------------------------ league

  renderLeague(rows: LeagueRow[]) {
    const list = $('league-list');
    list.innerHTML = '';
    const row = (r: LeagueRow, i: number) =>
      `<span class="pos">${i < 3 ? `<b>${i + 1}</b>` : `#${i + 1}`}</span><span class="avatar" style="${avatarStyle(r)}"></span><span class="who">${r.you ? 'You' : r.name}</span>${
        i < 3 ? '<i class="ico ico-gift gift"></i>' : ''
      }<span class="score">${r.stars}<i class="ico ico-star"></i></span>`;
    // You are pinned below the list (like the original), not repeated in it.
    rows.forEach((r, i) => {
      if (r.you) return;
      const li = document.createElement('li');
      li.className = i < 3 ? `top${i + 1}` : '';
      li.innerHTML = row(r, i);
      list.appendChild(li);
    });
    const me = rows.findIndex((r) => r.you);
    $('league-you').innerHTML = me >= 0 ? `<li class="you">${row(rows[me], me)}</li>` : '';
    const tiers = ['bronze', 'silver', 'gold', 'ruby', 'emerald', 'diamond'];
    $('league-tiers').innerHTML = tiers.map((t, i) => `<span class="tier ${t}${i === 0 ? ' now' : ''}"><i class="ico ico-trophy"></i></span>`).join('');
    list.scrollTop = 0;
  }

  // ------------------------------------------------------------ key vault

  /**
   * Key vault: three keys open three of twelve locks. Each lock hides a
   * prize token that flies to its card; three of a kind wins the prize.
   */
  vault(v: VaultSession) {
    const scr = $('vault');
    const grid = $('vault-grid');
    const keysEl = $('vault-keys');
    const done = $<HTMLButtonElement>('btn-vault-done');
    const hint = $('vault-hint');
    const dots = { ...v.dots };
    let keys = v.keys;
    let pending = 0;
    const cards = {} as Record<VaultKind, HTMLElement>;
    for (const c of scr.querySelectorAll<HTMLElement>('.prize')) {
      const k = c.dataset.kind as VaultKind;
      cards[k] = c;
      c.classList.remove('won', 'bump');
      c.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < dots[k]));
    }
    const renderKeys = () => {
      keysEl.innerHTML = '';
      for (let i = 0; i < 3; i++) {
        const k = document.createElement('i');
        k.className = `ico ico-key vkey${i < keys ? '' : ' used'}`;
        keysEl.appendChild(k);
      }
    };
    renderKeys();
    grid.innerHTML = '';
    for (let i = 0; i < 12; i++) {
      const b = document.createElement('button');
      b.className = 'lock';
      b.style.setProperty('--i', String((i % 3) + Math.floor(i / 3)));
      b.setAttribute('aria-label', 'Locked');
      b.innerHTML = `<span class="ghost">${KEYHOLE_OUTLINE_SVG}</span><span class="medal">${KEYHOLE_SVG}</span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        open(b);
      });
      grid.appendChild(b);
    }
    done.hidden = true;
    hint.textContent = 'Open 3 Locks';
    scr.hidden = false;
    requestAnimationFrame(() => scr.classList.add('show'));

    const center = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    };
    /** Fly a copy of `cls` from one point to another along an arc. */
    const fly = (cls: string, from: { x: number; y: number }, to: { x: number; y: number }, size: number, ms: number, lift: number) => {
      const el = document.createElement('i');
      el.className = `${cls} vfly`;
      el.style.cssText = `left:${from.x - size / 2}px;top:${from.y - size / 2}px;width:${size}px;height:${size}px`;
      document.body.appendChild(el);
      const frames: Keyframe[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const x = (to.x - from.x) * t;
        const y = (to.y - from.y) * t - Math.sin(t * Math.PI) * lift;
        frames.push({ transform: `translate(${x}px, ${y}px) scale(${1 + Math.sin(t * Math.PI) * 0.35 - t * 0.25}) rotate(${t * 20}deg)` });
      }
      const anim = el.animate(frames, { duration: ms, easing: 'cubic-bezier(0.4, 0, 0.3, 1)' });
      return anim.finished.then(() => el.remove());
    };

    const open = async (lock: HTMLButtonElement) => {
      if (keys <= 0 || lock.classList.contains('opening')) return;
      lock.classList.add('opening');
      pending++;
      keys--;
      const from = center(keysEl.children[keys]);
      renderKeys();
      hint.textContent = keys ? `Open ${keys} more lock${keys > 1 ? 's' : ''}` : 'Unlocking...';
      v.sound.click();
      const at = center(lock);
      await fly('ico ico-key', from, at, 40, 320, 50);
      // Key turns, tile flashes gold and shakes, then bursts open.
      lock.classList.add('turn');
      v.sound.thock(0.5);
      await wait(200);
      lock.classList.add('gold');
      await wait(300);
      const kind = v.pick();
      lock.classList.add('opened');
      lock.setAttribute('aria-label', 'Opened');
      for (let i = 0; i < 4; i++) {
        const sh = document.createElement('span');
        sh.className = `shard s${i}`;
        lock.appendChild(sh);
      }
      const flash = document.createElement('span');
      flash.className = 'vflash';
      lock.appendChild(flash);
      const icon = { hint: 'ico-bulb', item: 'ico-star', coins: 'ico-coin' }[kind];
      const item = document.createElement('i');
      item.className = `ico ${icon} vitem`;
      lock.appendChild(item);
      v.sound.coin();
      await wait(520);
      // The token flies up to its prize card and fills a dot.
      item.style.visibility = 'hidden';
      const card = cards[kind];
      await fly(`ico ${icon}`, center(item), center(card.querySelector('.ico')!), at.w * 0.62, 520, 90);
      dots[kind]++;
      card.classList.remove('bump');
      void card.offsetWidth;
      card.classList.add('bump');
      card.querySelectorAll('.dots i')[dots[kind] - 1]?.classList.add('on');
      v.sound.star(dots[kind] - 1);
      v.onDot(kind, dots[kind]);
      if (dots[kind] >= 3) {
        await wait(250);
        card.classList.add('won');
        const label = v.win(kind);
        const pop = document.createElement('span');
        pop.className = 'won-pop';
        pop.textContent = label;
        card.appendChild(pop);
        v.sound.complete();
        window.setTimeout(() => pop.remove(), 1600);
        dots[kind] = 0;
        window.setTimeout(() => card.querySelectorAll('.dots i').forEach((d) => d.classList.remove('on')), 1400);
      }
      pending--;
      if (keys === 0 && pending === 0) {
        await wait(400);
        hint.textContent = 'All keys used!';
        done.hidden = false;
      }
    };

    const finish = (e: Event) => {
      e.stopPropagation();
      done.removeEventListener('click', finish);
      v.sound.click();
      scr.classList.remove('show');
      window.setTimeout(() => (scr.hidden = true), 250);
      v.onDone();
    };
    done.addEventListener('click', finish);
  }

  // ------------------------------------------------------------ messages

  showTip(text: string | null) {
    this.tip.hidden = !text;
    if (text) this.tip.textContent = text;
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1900);
  }

  /** Where the booster button sits, in page pixels (for the paint-bomb throw). */
  bombOrigin(): { x: number; y: number } {
    const r = $('btn-bomb').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // ------------------------------------------------------------ level complete

  private flyTo(
    target: Element,
    from: { x: number; y: number },
    n: number,
    cls: string,
    onLand: (i: number) => void,
    startDelay = 380,
  ) {
    const t = target.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const c = document.createElement('span');
      c.className = cls;
      const sx = from.x + (Math.random() - 0.5) * 70;
      const sy = from.y + (Math.random() - 0.5) * 70;
      c.style.left = `${sx}px`;
      c.style.top = `${sy}px`;
      document.body.appendChild(c);
      const dx = t.left + t.width / 2 - sx;
      const dy = t.top + t.height / 2 - sy;
      c.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0 },
          {
            transform: `translate(calc(-50% + ${(Math.random() - 0.5) * 90}px), calc(-50% - 60px)) scale(1.3)`,
            opacity: 1,
            offset: 0.3,
          },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.9)`, opacity: 1 },
        ],
        { duration: 680, delay: startDelay + i * 55, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'both' },
      ).onfinish = () => {
        c.remove();
        onLand(i);
      };
    }
  }

  private bumpCoins(value: number) {
    this.shownCoins = value;
    this.coinsLabel.textContent = String(value);
    const pill = this.coinsLabel.parentElement!;
    pill.classList.remove('bump');
    void pill.offsetWidth;
    pill.classList.add('bump');
  }

  /**
   * In-place celebration for normal levels: stars pop over the board, coins
   * (and sometimes a key) fly to the HUD. The game moves on by itself.
   */
  celebrate(r: ResultInfo, from: { x: number; y: number }, boardTop: number, onKey: () => void) {
    const box = $('celebrate');

    const stars = box.querySelectorAll<HTMLElement>('.star');
    stars.forEach((s) => s.classList.remove('lit'));
    const title = $('cel-title');
    title.textContent = r.stars >= 3 ? 'Perfect!' : r.stars === 2 ? 'Great!' : 'Nice!';
    title.classList.toggle('gold', r.stars >= 3);
    box.hidden = false;
    // Sit just above the board; the ribbon hangs ~20px below the card.
    box.style.top = `${Math.max(this.topInset() + 6, boardTop - box.offsetHeight - 26)}px`;
    requestAnimationFrame(() => box.classList.add('show'));
    for (let i = 0; i < r.stars; i++)
      window.setTimeout(() => {
        stars[i].classList.add('lit');
        r.onStar(i);
      }, 120 + i * 200);
    const n = Math.min(10, 4 + Math.round(r.coins / 6));
    const base = r.totalCoins - r.coins;
    let landed = 0;
    this.flyTo(this.coinsLabel.parentElement!.querySelector('.coin')!, from, n, 'ico ico-coin coin flyer', () => {
      landed++;
      this.bumpCoins(landed === n ? r.totalCoins : Math.round(base + (r.coins / n) * landed));
      r.onCoin();
    });
    if (r.key) {
      const have = document.querySelectorAll('#keys .key.have').length;
      const slot = document.querySelectorAll('#keys .key')[Math.min(2, have)];
      this.flyTo(slot, from, 1, 'key-flyer', onKey, 700);
    }
  }

  endCelebrate() {
    const box = $('celebrate');
    box.classList.remove('show');
    box.hidden = true;
  }

  showResult(r: ResultInfo) {
    $('result-title').textContent = r.bonus ? 'Bonus Complete!' : 'Level Complete!';
    $('result-moves').textContent = r.moves <= r.par ? `Perfect! ${r.moves} moves` : `${r.moves} moves · best is ${r.par}`;
    $('result-coins').textContent = `+${r.coins}`;
    const stars = this.result.querySelectorAll<HTMLElement>('.star');
    stars.forEach((s) => s.classList.remove('lit'));
    this.result.hidden = false;
    requestAnimationFrame(() => this.result.classList.add('show'));
    for (let i = 0; i < r.stars; i++) {
      window.setTimeout(() => {
        stars[i].classList.add('lit');
        r.onStar(i);
      }, 380 + i * 240);
    }
    const from = this.shownCoins;
    const to = r.totalCoins;
    const startAt = performance.now() + 1100;
    window.clearInterval(this.coinTimer);
    this.coinTimer = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - startAt) / 600);
      if (p < 0) return;
      const v = Math.round(from + (to - from) * p);
      if (v !== this.shownCoins) {
        this.bumpCoins(v);
        if (v % 3 === 0) r.onCoin();
      }
      if (p >= 1) window.clearInterval(this.coinTimer);
    }, 30);
  }

  hideResult() {
    this.result.classList.remove('show');
    this.result.hidden = true;
  }

  // ------------------------------------------------------------ super reward

  /**
   * Super Reward after a bonus level: a pointer sweeps a multiplier bar; the
   * Multiply button locks it. `onLocked` gets the multiplier, `onDone` fires
   * when the payout has landed.
   */
  superReward(stars: number, coins: number, onLocked: (m: number) => void, onDone: () => void, sound: { tick: () => void; win: () => void }) {
    const scr = $('super');
    const needle = $('mult-needle');
    const arc = $('mult-arc');
    const segs = arc.querySelectorAll<SVGPathElement>('.arcseg');
    const span = Number(arc.dataset.span ?? 64);
    const gx = Number(arc.dataset.cx ?? 170);
    const gy = Number(arc.dataset.cy ?? 300);
    const badge = $('mult-badge');
    const pop = $('mult-pop');
    const btn = $<HTMLButtonElement>('btn-multiply');
    const values = [3, 4, 7, 4, 3];
    $('sr-coin-total').textContent = String(this.shownCoins);
    $('super-stars').textContent = String(stars);
    $('super-coins').textContent = String(coins);
    pop.hidden = true;
    btn.disabled = false;
    arc.classList.remove('locked');
    segs.forEach((el) => el.classList.remove('on', 'win'));
    $('super-coins').classList.remove('bump');
    $('super-stars').classList.remove('bump');
    scr.hidden = false;
    requestAnimationFrame(() => scr.classList.add('show'));
    const t0 = performance.now();
    let locked = false;
    let seg = -1;
    let pos = 0;
    const loop = (now: number) => {
      if (locked) return;
      // Eases through the middle so x7 is catchable but not free.
      pos = (Math.sin((now - t0) * 0.0042 - Math.PI / 2) + 1) / 2;
      needle.setAttribute('transform', `rotate(${(pos - 0.5) * span} ${gx} ${gy})`);
      const i = Math.min(4, Math.floor(pos * 5));
      if (i !== seg) {
        segs[seg]?.classList.remove('on');
        segs[i].classList.add('on');
        seg = i;
        badge.textContent = `x${values[i]}`;
        badge.className = `mult-badge v${values[i]}`;
        void badge.offsetWidth;
        badge.classList.add('flick');
        sound.tick();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const lock = (e: Event) => {
      e.stopPropagation();
      if (locked) return;
      locked = true;
      btn.disabled = true;
      const m = values[seg];
      arc.classList.add('locked');
      segs[seg].classList.add('win');
      pop.textContent = `x${m}`;
      pop.className = `mult-pop v${m}`;
      pop.hidden = false;
      sound.win();
      onLocked(m);
      // Count the rewards up, then hand over.
      const from = coins;
      const to = coins * m;
      const sFrom = stars;
      const sTo = stars * m;
      const start = performance.now() + 450;
      const count = (now: number) => {
        const p = Math.min(1, Math.max(0, (now - start) / 700));
        $('super-coins').textContent = String(Math.round(from + (to - from) * p));
        $('super-stars').textContent = String(Math.round(sFrom + (sTo - sFrom) * p));
        if (p < 1) requestAnimationFrame(count);
        else {
          $('super-coins').classList.add('bump');
          $('super-stars').classList.add('bump');
        }
        if (p >= 1)
          window.setTimeout(() => {
            // Big stars and coins burst out of the screen and fly home.
            const from = (sel: string) => {
              const r = scr.querySelector(sel)!.getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            };
            const coinFrom = from('.sr-pile');
            const starFrom = from('.sr-stars');
            scr.classList.remove('show');
            window.setTimeout(() => (scr.hidden = true), 250);
            this.flyTo(this.coinsLabel.parentElement!.querySelector('.coin')!, coinFrom, 8, 'ico ico-coin coin flyer big', () => {}, 120);
            this.flyTo($('btn-league'), starFrom, 4, 'ico ico-star flyer star-flyer big', () => {}, 160);
            onDone();
          }, 900);
      };
      requestAnimationFrame(count);
      btn.removeEventListener('click', lock);
    };
    btn.addEventListener('click', lock);
  }

  // ------------------------------------------------------------ league climb

  /**
   * Weekly league table that opens on your old rank, then slides your row up
   * past the players you overtook while they shift down.
   */
  /**
   * League climb, after the original: your row lifts out of the list (big,
   * glowing border, light sweep), rises past the players you overtook while
   * the rank counts down, trailing sparkles, then lands with a bounce and a
   * burst. Rows you pass drop down one place.
   */
  leagueClimb(before: LeagueRow[], after: LeagueRow[], left: string, onDone: () => void, onTick: () => void) {
    const scr = $('climb');
    const view = $('climb-view');
    const inner = $('climb-list');
    const you = $('climb-you');
    const gain = $('climb-gain');
    $('climb-left').textContent = left;
    const tiers = ['bronze', 'silver', 'gold', 'ruby', 'emerald', 'diamond'];
    $('climb-tiers').innerHTML = tiers.map((t, i) => `<span class="tier ${t}${i === 0 ? ' now' : ''}"><i class="ico ico-trophy"></i>${i === 1 ? '<i class="ico ico-gift tgift"></i>' : ''}</span>`).join('');
    const from = before.findIndex((r) => r.you);
    const to = after.findIndex((r) => r.you);
    const meBefore = before[from];
    const meAfter = after[to];
    const others = after.filter((r) => !r.you);
    const rowH = 48;
    const rowHtml = (r: LeagueRow, rank: number) =>
      `<span class="pos">#${rank + 1}</span><span class="avatar" style="${avatarStyle(r)}"></span><span class="who">${r.you ? 'You' : r.name}</span><span class="score">${r.stars}<i class="ico ico-star"></i></span>`;
    inner.innerHTML = '';
    const rows = others.map((r) => {
      const el = document.createElement('div');
      el.className = 'crow';
      inner.appendChild(el);
      return { r, el };
    });
    you.innerHTML = rowHtml(meBefore, from);
    you.className = 'climb-you';
    gain.hidden = true;
    scr.hidden = false;
    requestAnimationFrame(() => scr.classList.add('show'));

    // Particles drawn on a canvas over the screen, additively.
    const fx = new ClimbFx($<HTMLCanvasElement>('climb-fx'));
    let gap = -1;
    const place = (rank: number) => {
      // Others sit in order with a gap at your current rank.
      const g = Math.round(rank);
      if (g === gap) return;
      gap = g;
      rows.forEach(({ r, el }, i) => {
        const at = i >= g ? i + 1 : i;
        el.style.transform = `translateY(${at * rowH}px)`;
        el.innerHTML = rowHtml(r, at);
      });
    };
    const layout = (rank: number) => {
      const vh = view.clientHeight;
      const total = (others.length + 1) * rowH;
      const scroll = Math.max(0, Math.min(total - vh, rank * rowH - vh / 2 + rowH / 2));
      inner.style.transform = `translateY(${-scroll}px)`;
      const y = rank * rowH - scroll;
      you.style.transform = `translateY(${y}px)`;
      return y;
    };
    place(from);
    for (const { el } of rows) el.style.transition = 'none';
    layout(from);
    requestAnimationFrame(() => {
      for (const { el } of rows) el.style.transition = '';
    });

    let alive = true;
    const climbMs = from === to ? 0 : Math.min(2600, 700 + 160 * (from - to));
    const tLift = 550;
    const t0 = performance.now();
    let lastRank = from;
    let landed = false;
    const frame = (now: number) => {
      if (!alive) return;
      const t = now - t0;
      const vr = view.getBoundingClientRect();
      let rank = from;
      if (t > tLift) {
        you.classList.add('lift');
        const p = climbMs ? Math.min(1, (t - tLift) / climbMs) : 1;
        const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
        rank = from + (to - from) * e;
        const r = Math.round(rank);
        if (r !== lastRank) {
          lastRank = r;
          you.querySelector('.pos')!.textContent = `#${r + 1}`;
          onTick();
        }
        place(rank);
        if (p >= 1 && !landed && t > tLift + Math.max(climbMs, 450)) {
          landed = true;
          you.innerHTML = rowHtml(meAfter, to);
          you.classList.remove('lift');
          you.classList.add('land');
          const y = vr.top + layout(to) + rowH / 2;
          fx.burst(vr.left + vr.width / 2, y, vr.width);
          if (from > to) {
            gain.innerHTML = `<i class="up"></i>${from - to} place${from - to > 1 ? 's' : ''} up!`;
            gain.hidden = false;
          } else {
            gain.innerHTML = 'Keep painting to climb!';
            gain.hidden = false;
          }
        }
      }
      const y = vr.top + layout(rank) + rowH / 2;
      // Sparkles stream off the lifted row while it rises.
      if (you.classList.contains('lift')) fx.trail(vr.left + 6, vr.right - 6, y, rowH, to < from ? 1 : 0.4);
      fx.step();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    const close = () => {
      scr.removeEventListener('click', close);
      alive = false;
      fx.clear();
      scr.classList.remove('show');
      window.setTimeout(() => (scr.hidden = true), 250);
      onDone();
    };
    window.setTimeout(() => scr.addEventListener('click', close), tLift + climbMs + 500);
  }

  // ------------------------------------------------------------ new item

  /** Bottom card showing progress toward the next unlock. */
  newItemProgress(title: string, preview: string, from: number, to: number, need: number) {
    const card = $('newitem');
    $('ni-title').textContent = title;
    $('ni-swatch').setAttribute('style', preview);
    $('ni-count').textContent = `${from}/${need}`;
    const fill = $('ni-fill');
    fill.style.transition = 'none';
    fill.style.width = `${(from / need) * 100}%`;
    card.hidden = false;
    requestAnimationFrame(() => {
      card.classList.add('show');
      window.setTimeout(() => {
        fill.style.transition = 'width 0.7s cubic-bezier(0.3, 1.3, 0.5, 1)';
        fill.style.width = `${Math.min(1, to / need) * 100}%`;
        $('ni-count').textContent = `${Math.min(to, need)}/${need}`;
      }, 350);
      window.setTimeout(() => {
        card.classList.remove('show');
        window.setTimeout(() => (card.hidden = true), 300);
      }, 2400);
    });
  }

  private onUnlockEquip: (() => void) | null = null;

  unlocked(name: string, preview: string, onEquip: () => void) {
    $('unlocked-name').textContent = name;
    $('unlocked-swatch').setAttribute('style', preview);
    this.onUnlockEquip = onEquip;
    this.open('unlocked');
  }
}

/**
 * Canvas particles for the league climb: glowing four-point sparkles and
 * soft orbs, drawn additively so they read as light.
 */
class ClimbFx {
  private readonly ctx: CanvasRenderingContext2D;
  private parts: { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; c: string; star: boolean; rot: number }[] = [];
  private last = performance.now();
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(private readonly cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d')!;
    cv.width = Math.round(innerWidth * this.dpr);
    cv.height = Math.round(innerHeight * this.dpr);
  }

  private static COLORS = ['#ffffff', '#ffe27a', '#ff9ad5', '#c4a6ff', '#8ff0ff'];

  trail(x0: number, x1: number, y: number, h: number, rate: number) {
    for (let i = 0; i < 3 * rate; i++) {
      const side = Math.random();
      const onEdge = Math.random() < 0.6;
      this.parts.push({
        x: onEdge ? (side < 0.5 ? x0 : x1) + (Math.random() - 0.5) * 8 : x0 + Math.random() * (x1 - x0),
        y: y + (onEdge ? (Math.random() - 0.5) * h : (Math.random() < 0.5 ? -1 : 1) * h * 0.5),
        vx: (Math.random() - 0.5) * 60,
        vy: 40 + Math.random() * 90,
        r: 2 + Math.random() * 4,
        life: 0,
        max: 500 + Math.random() * 500,
        c: ClimbFx.COLORS[Math.floor(Math.random() * ClimbFx.COLORS.length)],
        star: Math.random() < 0.55,
        rot: Math.random() * 3,
      });
    }
  }

  burst(x: number, y: number, w: number) {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 120 + Math.random() * 380;
      this.parts.push({
        x: x + (Math.random() - 0.5) * w * 0.8,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.7 - 80,
        r: 2.5 + Math.random() * 5.5,
        life: 0,
        max: 700 + Math.random() * 700,
        c: ClimbFx.COLORS[i % ClimbFx.COLORS.length],
        star: i % 2 === 0,
        rot: Math.random() * 3,
      });
    }
  }

  step() {
    const now = performance.now();
    const dt = Math.min(50, now - this.last) / 1000;
    this.last = now;
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    this.parts = this.parts.filter((p) => {
      p.life += dt * 1000;
      const t = p.life / p.max;
      if (t >= 1) return false;
      p.vx *= Math.exp(-dt * 2);
      p.vy = p.vy * Math.exp(-dt * 2) + 60 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += dt * 3;
      const a = (1 - t) * (t < 0.1 ? t / 0.1 : 1);
      const r = p.r * (1 - t * 0.4);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
      g.addColorStop(0, p.c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c;
      if (p.star) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const rr = k % 2 === 0 ? r * 1.8 : r * 0.4;
          const ang = (k / 8) * Math.PI * 2;
          ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  clear() {
    this.parts = [];
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height);
  }
}
