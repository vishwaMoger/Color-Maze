// DOM overlay for buttons, labels, panels and the level-complete card.
// The board itself is drawn by Pixi underneath.
import type { Theme } from '../game/themes.ts';

export interface HudActions {
  restart: () => void;
  undo: () => void;
  hint: () => void;
  bomb: () => void;
  next: () => void;
  selectTheme: (id: string) => void;
  toggle: (what: 'sfx' | 'music' | 'vibe') => void;
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
  onStar: (i: number) => void;
  onCoin: () => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const CHEST_SVG =
  '<svg viewBox="0 0 24 24"><path d="M4 10h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9Z"/><path d="M5.5 5h13A2.5 2.5 0 0 1 21 7.5V10H3V7.5A2.5 2.5 0 0 1 5.5 5Z"/><rect x="10" y="9" width="4" height="5" rx="1"/></svg>';

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
  private readonly settings = $('settings');
  private toastTimer = 0;
  private coinTimer = 0;
  private shownCoins = 0;
  private actions!: HudActions;

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
    on('btn-theme', () => this.openSettings());
    on('btn-settings', () => this.openSettings());
    on('btn-close-settings', () => this.closeSettings());
    on('btn-next', a.next, true);
    on('tg-sfx', () => a.toggle('sfx'));
    on('tg-music', () => a.toggle('music'));
    on('tg-vibe', () => a.toggle('vibe'));
    this.settings.addEventListener('click', (e) => {
      if (e.target === this.settings) this.closeSettings();
    });
    this.result.addEventListener('click', () => {
      a.anyInput();
      a.next();
    });
    // Buttons feel physical: press state also on touch.
    for (const b of document.querySelectorAll<HTMLElement>('.gbtn')) {
      b.addEventListener('pointerdown', () => b.classList.add('pressed'));
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
        b.addEventListener(ev, () => b.classList.remove('pressed'));
    }
  }

  get modalOpen() {
    return !this.settings.hidden;
  }

  hideSplash(progress: number) {
    const bar = document.querySelector<HTMLElement>('#splash .loadbar span');
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
    if (progress >= 1) window.setTimeout(() => $('splash').classList.add('hide'), 350);
  }

  topInset() {
    return this.top.getBoundingClientRect().bottom;
  }

  bottomInset() {
    return window.innerHeight - this.bottom.getBoundingClientRect().top;
  }

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
    this.movesLabel.innerHTML = `<span class="k">Moves</span><b>${n}</b>${par ? `<span class="goal">★ ${par}</span>` : ''}`;
  }

  setCoins(n: number) {
    this.shownCoins = n;
    this.coinsLabel.textContent = String(n);
  }

  setToggles(t: { sfx: boolean; music: boolean; vibe: boolean }) {
    $('tg-sfx').setAttribute('aria-pressed', String(t.sfx));
    $('tg-music').setAttribute('aria-pressed', String(t.music));
    $('tg-vibe').setAttribute('aria-pressed', String(t.vibe));
  }

  setBombLabel(text: string) {
    $('bomb-price').textContent = text;
  }

  renderBoards(themes: Theme[], current: string) {
    const list = $('board-list');
    list.innerHTML = '';
    for (const t of themes) {
      const b = document.createElement('button');
      b.className = 'board-card';
      b.setAttribute('aria-pressed', String(t.id === current));
      b.style.setProperty('--slab', t.swatch.slab);
      b.style.setProperty('--side', t.swatch.side);
      b.style.setProperty('--floor', t.swatch.floor);
      b.style.setProperty('--paint', t.swatch.paint);
      b.innerHTML = `<span class="swatch"><i></i></span><span>${t.name}</span><span class="check"></span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.actions.anyInput();
        this.actions.selectTheme(t.id);
        for (const el of list.children) el.setAttribute('aria-pressed', String(el === b));
      });
      list.appendChild(b);
    }
  }

  openSettings() {
    this.settings.hidden = false;
    requestAnimationFrame(() => this.settings.classList.add('show'));
  }

  closeSettings() {
    this.settings.classList.remove('show');
    window.setTimeout(() => (this.settings.hidden = true), 220);
  }

  showTip(text: string | null) {
    this.tip.hidden = !text;
    if (text) this.tip.textContent = text;
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  /** Where the booster button sits, in page pixels (for the paint-bomb throw). */
  bombOrigin(): { x: number; y: number } {
    const r = $('btn-bomb').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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
    // Roll the coin counter up once the stars have landed.
    const from = this.shownCoins;
    const to = r.totalCoins;
    const startAt = performance.now() + 1100;
    window.clearInterval(this.coinTimer);
    this.coinTimer = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - startAt) / 600);
      if (p < 0) return;
      const v = Math.round(from + (to - from) * p);
      if (v !== this.shownCoins) {
        this.shownCoins = v;
        this.coinsLabel.textContent = String(v);
        const pill = this.coinsLabel.parentElement!;
        pill.classList.remove('bump');
        void pill.offsetWidth;
        pill.classList.add('bump');
        if (v % 3 === 0) r.onCoin();
      }
      if (p >= 1) window.clearInterval(this.coinTimer);
    }, 30);
  }

  /**
   * In-place celebration for normal levels: stars pop over the board and
   * coins fly from the ball to the coin counter. The game moves on by itself.
   */
  celebrate(r: ResultInfo, from: { x: number; y: number }, boardTop: number) {
    const box = $('celebrate');
    // Sit just above the board when there is room, otherwise below the HUD.
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
    const target = this.coinsLabel.parentElement!.querySelector('.coin')!.getBoundingClientRect();
    const n = Math.min(10, 4 + Math.round(r.coins / 6));
    const per = r.coins / n;
    let landed = 0;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('span');
      c.className = 'coin flyer';
      const sx = from.x + (Math.random() - 0.5) * 70;
      const sy = from.y + (Math.random() - 0.5) * 70;
      c.style.left = `${sx}px`;
      c.style.top = `${sy}px`;
      document.body.appendChild(c);
      const dx = target.left + target.width / 2 - sx;
      const dy = target.top + target.height / 2 - sy;
      const delay = 380 + i * 55;
      c.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0 },
          { transform: `translate(calc(-50% + ${(Math.random() - 0.5) * 80}px), calc(-50% - 50px)) scale(1.25)`, opacity: 1, offset: 0.3 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.9)`, opacity: 1 },
        ],
        { duration: 650, delay, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'both' },
      ).onfinish = () => {
        c.remove();
        landed++;
        this.shownCoins = Math.round(r.totalCoins - r.coins + per * landed);
        if (landed === n) this.shownCoins = r.totalCoins;
        this.coinsLabel.textContent = String(this.shownCoins);
        const pill = this.coinsLabel.parentElement!;
        pill.classList.remove('bump');
        void pill.offsetWidth;
        pill.classList.add('bump');
        r.onCoin();
      };
    }
  }

  endCelebrate() {
    const box = $('celebrate');
    box.classList.remove('show');
    box.hidden = true;
  }

  hideResult() {
    this.result.classList.remove('show');
    this.result.hidden = true;
  }
}
