// Builds upcoming levels in the background so the next one is ready the
// moment the player finishes the current one.
import { buildLevel, ENDLESS_EFFORT, encodeLevel } from './builder.ts';
import { REROLLS } from './rerolls.ts';

self.onmessage = (e: MessageEvent<number>) => {
  const n = e.data;
  try {
    const { c, bonus } = buildLevel(n, ENDLESS_EFFORT, REROLLS[n] ?? 0);
    self.postMessage({ n, text: encodeLevel(c, bonus) });
  } catch {
    self.postMessage({ n, text: null });
  }
};
