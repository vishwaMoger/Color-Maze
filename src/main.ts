import { Application } from 'pixi.js';
import { preloadAssets } from './game/assets.ts';
import { Game } from './game/Game.ts';
import { Hud } from './ui/hud.ts';

async function start() {
  const shownAt = performance.now();
  const hud = new Hud();
  hud.hideSplash(0.35);
  const stage = document.getElementById('stage')!;
  const app = new Application();
  await app.init({
    resizeTo: stage,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    preference: 'webgl',
  });
  stage.appendChild(app.canvas);
  hud.hideSplash(0.6);
  await preloadAssets();
  hud.hideSplash(0.8);
  const game = new Game(app, hud);
  // Exposed for automated play-testing in the browser.
  (window as unknown as { colorMaze: Game }).colorMaze = game;
  // Short branded moment, never longer than the fonts need.
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
  const wait = Math.max(0, 700 - (performance.now() - shownAt));
  window.setTimeout(() => hud.hideSplash(1), wait);
}

void start();
