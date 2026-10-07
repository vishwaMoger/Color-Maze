// Builds upcoming levels in the background so the next one is ready the
// moment the player finishes the current one.
import { buildLevel, encodeLevel } from './builder.ts';

self.onmessage = (e: MessageEvent<number>) => {
  const n = e.data;
  try {
    const { c, bonus } = buildLevel(n, 0.5);
    self.postMessage({ n, text: encodeLevel(c, bonus) });
  } catch {
    self.postMessage({ n, text: null });
  }
};
