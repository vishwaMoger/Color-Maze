import { Application, type ApplicationOptions, UPDATE_PRIORITY, WebGLRenderer } from 'pixi.js';
import { preloadAssets } from './game/assets.ts';
import { Game } from './game/Game.ts';
import { Hud } from './ui/hud.ts';
import { initPlatform, loadingStart, loadingStop } from './platform/ads.ts';

const mark = (n: string) => performance.mark(`cm:${n}`);

/**
 * Straight to WebGL. Pixi's usual start first opens a throwaway WebGL
 * context to test for support, which costs a context creation on a phone;
 * here the real one is the test, and Pixi's own path is kept as the
 * fallback when it fails.
 */
class FastApplication extends Application {
  override async init(options: Partial<ApplicationOptions>) {
    try {
      const renderer = new WebGLRenderer();
      await renderer.init(options);
      this.renderer = renderer;
      (Application as unknown as { _plugins: { init: (this: Application, o: unknown) => void }[] })._plugins.forEach((p) =>
        p.init.call(this, options),
      );
    } catch {
      await super.init(options);
    }
  }
}

/** Fill the loading bar (0-1); its paint ball rides the front. */
function loadBar(p: number) {
  const bar = document.querySelector<HTMLElement>('#splash .loadbar');
  bar?.style.setProperty('--p', String(p));
  const fill = bar?.querySelector<HTMLElement>('span');
  if (fill) fill.style.width = `${Math.round(p * 100)}%`;
}

/**
 * The main stylesheet. Built pages load it without holding up the first
 * paint (see vite.config.ts), so the loading screen shows at once; the game
 * itself waits for it, as the HUD's layout depends on it.
 */
function styles(): Promise<void> {
  const link = document.getElementById('main-css') as HTMLLinkElement | null;
  if (!link) return Promise.resolve();
  const apply = () => {
    link.media = 'all';
  };
  if (link.sheet) {
    apply();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      apply();
      resolve();
    };
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
  });
}

async function start() {
  mark('start');
  // The loading screen first: a returning player's cached script runs at
  // once, and would otherwise keep the browser from painting until the
  // game is set up.
  // (Frames never come in a hidden tab: then a moment's wait.)
  await new Promise<void>((r) => {
    requestAnimationFrame(() => setTimeout(r, 0));
    setTimeout(r, 50);
  });
  loadBar(0.15);
  // Everything that can overlap does: the portal's SDK (and with it the
  // save), the stylesheet, the WebGL context and the effect art.
  const platform = initPlatform().then(() => {
    mark('sdk');
    loadingStart();
  });
  const css = styles().then(() => mark('css'));
  const stage = document.getElementById('stage')!;
  const app = new FastApplication();
  const gpu = app
    .init({
      resizeTo: stage,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
    })
    .then(() => {
      stage.appendChild(app.canvas);
      mark('pixi');
      loadBar(0.45);
    });
  const art = preloadAssets().then(() => mark('assets'));
  await Promise.all([platform, css, gpu, art]);
  loadBar(0.75);
  // The stage may have been sized before its styles applied.
  app.resize();
  const hud = new Hud();
  const game = new Game(app, hud);
  mark('game');
  // Exposed for automated play-testing in the browser.
  (window as unknown as { colorMaze: Game }).colorMaze = game;
  // The web font is part of the stylesheet, so this is normally at once.
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1000))]);
  // Off the loading screen as soon as the first frame of the level is drawn
  // (or after a moment, in a hidden tab where no frames are drawn).
  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    loadBar(1);
    hud.hideSplash(1);
    loadingStop();
    mark('done');
    game.shown();
  };
  app.ticker.addOnce(show, null, UPDATE_PRIORITY.UTILITY);
  setTimeout(show, 1500);
}

void start();
