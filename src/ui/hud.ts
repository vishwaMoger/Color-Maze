// DOM overlay: HUD, panels (shop, settings, league, chest) and the
// level-complete moments. The board itself is drawn by Pixi underneath.

export type ShopTab = 'ball' | 'paint' | 'board';

export interface ShopItem {
  id: string;
  name: string;
  unlock: number;
  /** CSS for the preview swatch. */
  preview: string;
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
  openChest: () => void;
  collectChest: () => void;
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

const CHEST_SVG = '<i class="ico ico-gift"></i>';

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
    on('btn-shop', () => {
      a.openShop();
      this.open('shop');
    });
    on('btn-settings', () => this.open('settings'));
    on('btn-league', () => {
      a.openLeague();
      this.open('league');
    });
    on('btn-streak', () => this.toast('Finish levels without restarting to grow your streak!'));
    on('btn-next', a.next, true);
    on('tg-sfx', () => a.toggle('sfx'));
    on('tg-music', () => a.toggle('music'));
    on('tg-vibe', () => a.toggle('vibe'));
    on('chest-box', a.openChest, true);
    on('btn-unlock-equip', () => {
      this.close('unlocked');
      this.onUnlockEquip?.();
    });
    on('btn-unlock-later', () => this.close('unlocked'));
    on('btn-chest-ok', a.collectChest);
    for (const b of document.querySelectorAll<HTMLElement>('[data-close]'))
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        a.click();
        this.close(b.dataset.close!);
      });
    for (const id of ['shop', 'settings', 'league'])
      $(id).addEventListener('click', (e) => {
        if (e.target === $(id)) this.close(id);
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
    return ['shop', 'settings', 'league', 'chest', 'super', 'climb', 'unlocked'].some((id) => !$(id).hidden);
  }

  open(id: string) {
    const m = $(id);
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('show'));
  }

  close(id: string) {
    const m = $(id);
    m.classList.remove('show');
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
    this.levelLabel.textContent = bonus ? `Bonus Level ${n}` : `Level ${n}`;
    this.levelLabel.classList.toggle('bonus', bonus);
    const inGroup = (n - 1) % 5;
    let html = '';
    for (let i = 0; i < 4; i++) {
      if (i > 0) html += `<i class="link${i <= inGroup ? ' done' : ''}"></i>`;
      html += `<span class="dot${i < inGroup ? ' done' : ''}${i === inGroup ? ' current' : ''}"></span>`;
    }
    html += `<i class="link${inGroup >= 4 ? ' done' : ''}"></i><span class="chest${inGroup === 4 ? ' current' : ''}">${CHEST_SVG}</span>`;
    this.chain.innerHTML = html;
    this.movesLabel.dataset.par = par ? String(par) : '';
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
    $('streak-count').textContent = String(n);
    const b = $('btn-streak');
    b.classList.toggle('lit', n >= 1);
    b.classList.toggle('hot', n >= 5);
    if (bump) {
      b.classList.remove('bump');
      void b.offsetWidth;
      b.classList.add('bump');
    }
  }

  setPrices(p: { hint: string; bomb: string }) {
    $('hint-price').innerHTML = p.hint;
    $('bomb-price').innerHTML = p.bomb;
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
    for (const t of document.querySelectorAll<HTMLElement>('.tab'))
      t.setAttribute('aria-selected', String(t.dataset.tab === this.shopTab));
    const grid = $('shop-grid');
    grid.innerHTML = '';
    const { items, equipped } = this.shopData[this.shopTab];
    for (const it of items) {
      const locked = this.unlockedTo < it.unlock;
      const b = document.createElement('button');
      b.className = `item ${it.kind}${locked ? ' locked' : ''}`;
      b.setAttribute('aria-pressed', String(it.id === equipped));
      b.innerHTML = `<span class="swatch" style="${it.preview}"></span><span class="name">${it.name}</span>${
        locked
          ? `<span class="tag lock">Level ${it.unlock}</span>`
          : it.id === equipped
            ? '<span class="tag on">In use</span>'
            : '<span class="tag use">Use</span>'
      }`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.actions.anyInput();
        if (locked) {
          this.toast(`Unlocks at level ${it.unlock}`);
          return;
        }
        this.actions.click();
        this.actions.equip(this.shopTab, it.id);
        this.shopData[this.shopTab].equipped = it.id;
        this.renderShop();
      });
      grid.appendChild(b);
    }
  }

  // ------------------------------------------------------------ league

  renderLeague(rows: LeagueRow[]) {
    const list = $('league-list');
    list.innerHTML = '';
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = `${r.you ? 'you' : ''}${i < 3 ? ` top top${i + 1}` : ''}`;
      li.innerHTML = `<span class="pos">${i < 3 ? `<i class="ico ico-medal${i + 1}"></i>` : i + 1}</span><span class="avatar" style="background:${r.avatar}"></span><span class="who">${r.you ? 'You' : r.name}</span><span class="score">${r.stars}<i>★</i></span>`;
      list.appendChild(li);
    });
    window.setTimeout(() => {
      const me = list.querySelector<HTMLElement>('.you');
      if (me) list.scrollTop = me.offsetTop - list.clientHeight / 2 + me.offsetHeight / 2;
    }, 60);
  }

  // ------------------------------------------------------------ chest

  showChest() {
    $('chest-box').classList.remove('open');
    $('chest-text').textContent = 'You collected 3 keys! Tap the gift.';
    $('chest-reward').hidden = true;
    $('btn-chest-ok').hidden = true;
    this.open('chest');
  }

  openChest(coins: number) {
    $('chest-box').classList.add('open');
    $('chest-text').textContent = 'Treasure!';
    $('chest-coins').textContent = `+${coins}`;
    $('chest-reward').hidden = false;
    $('btn-chest-ok').hidden = false;
  }

  closeChest() {
    this.close('chest');
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
    box.style.top = `${Math.max(this.topInset() + 6, boardTop - 112)}px`;
    const stars = box.querySelectorAll<HTMLElement>('.star');
    stars.forEach((s) => s.classList.remove('lit'));
    box.hidden = false;
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
    const pointer = $('mult-pointer');
    const badge = $('mult-badge');
    const pop = $('mult-pop');
    const btn = $<HTMLButtonElement>('btn-multiply');
    const values = [2, 3, 5, 3, 2];
    $('super-stars').textContent = String(stars);
    $('super-coins').textContent = String(coins);
    pop.hidden = true;
    btn.disabled = false;
    scr.hidden = false;
    requestAnimationFrame(() => scr.classList.add('show'));
    const t0 = performance.now();
    let locked = false;
    let seg = -1;
    let pos = 0;
    const loop = (now: number) => {
      if (locked) return;
      // Eases through the middle so x5 is catchable but not free.
      pos = (Math.sin((now - t0) * 0.0042 - Math.PI / 2) + 1) / 2;
      pointer.style.left = `${pos * 100}%`;
      const i = Math.min(4, Math.floor(pos * 5));
      if (i !== seg) {
        seg = i;
        badge.textContent = `x${values[i]}`;
        badge.className = `mult-badge v${values[i]}`;
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
        else
          window.setTimeout(() => {
            scr.classList.remove('show');
            window.setTimeout(() => (scr.hidden = true), 250);
            onDone();
          }, 700);
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
  leagueClimb(before: LeagueRow[], after: LeagueRow[], left: string, onDone: () => void, onTick: () => void) {
    const scr = $('climb');
    const list = $('climb-list');
    $('climb-left').textContent = left;
    const rowH = 54;
    list.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'climb-inner';
    inner.style.height = `${after.length * rowH}px`;
    list.appendChild(inner);
    const youBefore = before.findIndex((r) => r.you);
    const youAfter = after.findIndex((r) => r.you);
    const els = new Map<string, HTMLElement>();
    before.forEach((r, i) => {
      const li = document.createElement('div');
      li.className = `crow${r.you ? ' you' : ''}`;
      li.style.transform = `translateY(${i * rowH}px)`;
      li.innerHTML = `<span class="pos">${i + 1}</span><span class="avatar" style="background:${r.avatar}"></span><span class="who">${r.you ? 'You' : r.name}</span><span class="score">${r.stars}<i>★</i></span>`;
      inner.appendChild(li);
      els.set(r.you ? '@you' : r.name, li);
    });
    scr.hidden = false;
    requestAnimationFrame(() => scr.classList.add('show'));
    const viewH = () => list.clientHeight;
    list.scrollTop = Math.max(0, youBefore * rowH - viewH() / 2 + rowH / 2);
    const startScroll = list.scrollTop;
    const endScroll = Math.max(0, youAfter * rowH - viewH() / 2 + rowH / 2);
    window.setTimeout(() => {
      const you = els.get('@you')!;
      you.classList.add('lift');
      after.forEach((r, i) => {
        const el = els.get(r.you ? '@you' : r.name)!;
        el.style.transform = `translateY(${i * rowH}px)`;
        el.querySelector('.pos')!.textContent = String(i + 1);
        if (r.you) el.querySelector('.score')!.innerHTML = `${r.stars}<i>★</i>`;
      });
      const t0 = performance.now();
      let lastRank = youBefore;
      const scroll = (now: number) => {
        const p = Math.min(1, (now - t0) / 1100);
        const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        list.scrollTop = startScroll + (endScroll - startScroll) * e;
        const rank = Math.round(youBefore + (youAfter - youBefore) * e);
        if (rank !== lastRank) {
          lastRank = rank;
          onTick();
        }
        if (p < 1) requestAnimationFrame(scroll);
        else you.classList.remove('lift');
      };
      requestAnimationFrame(scroll);
    }, 650);
    const close = () => {
      scr.removeEventListener('click', close);
      scr.classList.remove('show');
      window.setTimeout(() => (scr.hidden = true), 250);
      onDone();
    };
    window.setTimeout(() => scr.addEventListener('click', close), 900);
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
