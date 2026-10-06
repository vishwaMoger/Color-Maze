import { Application } from 'pixi.js';
import { Game } from './game/Game.ts';
import { Hud } from './ui/hud.ts';

async function start() {
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
  const game = new Game(app, new Hud());
  // Exposed for automated play-testing in the browser.
  (window as unknown as { colorMaze: Game }).colorMaze = game;
}

void start();
