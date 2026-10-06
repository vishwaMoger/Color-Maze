// DOM overlay for buttons, labels and the level-complete card. The board
// itself is drawn by Pixi underneath.

export interface HudActions {
  restart: () => void;
  undo: () => void;
  hint: () => void;
  theme: () => void;
  sound: () => void;
  next: () => void;
  anyInput: () => void;
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

export class Hud {
  private readonly top = $('hud-top');
  private readonly bottom = $('hud-bottom');
  private readonly levelLabel = $('level-label');
  private readonly levelDots = $('level-dots');
  private readonly movesLabel = $('moves');
  private readonly coinsLabel = $('coins-count');
  private readonly tip = $('tip');
  private readonly toastEl = $('toast');
  private readonly result = $('result');
  private readonly soundBtn = $('btn-sound');
  private toastTimer = 0;
  private coinTimer = 0;
  private shownCoins = 0;

  bind(a: HudActions) {
    const on = (id: string, fn: () => void) =>
      $(id).addEventListener('click', (e) => {
        e.stopPropagation();
        a.anyInput();
        fn();
      });
    on('btn-restart', a.restart);
    on('btn-undo', a.undo);
    on('btn-hint', a.hint);
    on('btn-theme', a.theme);
    on('btn-sound', a.sound);
    on('btn-next', a.next);
    this.result.addEventListener('click', () => {
      a.anyInput();
      a.next();
    });
  }

  topInset() {
    return this.top.getBoundingClientRect().bottom;
  }

  bottomInset() {
    return window.innerHeight - this.bottom.getBoundingClientRect().top;
  }

  setLevel(n: number, bonus: boolean, par?: number) {
    this.levelLabel.textContent = bonus ? `Bonus level ${n}` : `Level ${n}`;
    this.levelLabel.classList.toggle('bonus', bonus);
    const inGroup = (n - 1) % 5;
    this.levelDots.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('span');
      dot.className = `dot${i < inGroup ? ' done' : ''}${i === inGroup ? ' current' : ''}${i === 4 ? ' star' : ''}`;
      this.levelDots.appendChild(dot);
    }
    this.movesLabel.dataset.par = par ? String(par) : '';
  }

  setMoves(n: number) {
    const par = this.movesLabel.dataset.par;
    this.movesLabel.innerHTML = par
      ? `Moves <b>${n}</b><span class="sep">·</span><span class="par">★★★ in ${par}</span>`
      : `Moves <b>${n}</b>`;
  }

  setCoins(n: number) {
    this.shownCoins = n;
    this.coinsLabel.textContent = String(n);
  }

  setSound(on: boolean) {
    this.soundBtn.classList.toggle('off', !on);
    this.soundBtn.setAttribute('aria-pressed', String(on));
  }

  setThemeName(name: string) {
    $('btn-theme').title = `Board: ${name}`;
    if (this.started) this.toast(`Board: ${name}`);
    this.started = true;
  }
  private started = false;

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

  showResult(r: ResultInfo) {
    $('result-title').textContent = r.bonus ? 'Bonus complete!' : 'Level complete!';
    $('result-moves').textContent = r.moves <= r.par ? `Perfect! ${r.moves} moves` : `${r.moves} moves · best is ${r.par}`;
    $('result-coins').textContent = `+${r.coins}`;
    const stars = this.result.querySelectorAll<HTMLElement>('.star');
    stars.forEach((s) => s.classList.remove('lit', 'pop'));
    this.result.hidden = false;
    requestAnimationFrame(() => this.result.classList.add('show'));
    for (let i = 0; i < 3; i++) {
      window.setTimeout(() => {
        stars[i].classList.add('pop');
        if (i < r.stars) {
          stars[i].classList.add('lit');
          r.onStar(i);
        }
      }, 260 + i * 220);
    }
    // Roll the coin counter up once the stars have landed.
    const from = this.shownCoins;
    const to = r.totalCoins;
    const startAt = performance.now() + 1000;
    window.clearInterval(this.coinTimer);
    this.coinTimer = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - startAt) / 600);
      if (p < 0) return;
      const v = Math.round(from + (to - from) * p);
      if (v !== this.shownCoins) {
        this.shownCoins = v;
        this.coinsLabel.textContent = String(v);
        this.coinsLabel.parentElement!.classList.remove('bump');
        void this.coinsLabel.offsetWidth;
        this.coinsLabel.parentElement!.classList.add('bump');
        if (v % 3 === 0) r.onCoin();
      }
      if (p >= 1) window.clearInterval(this.coinTimer);
    }, 30);
  }

  hideResult() {
    this.result.classList.remove('show');
    this.result.hidden = true;
  }
}
