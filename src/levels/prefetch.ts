// Builds upcoming endless levels in a background worker so the next level
// is ready the moment the player gets there.
import { hasBuilt, isCurated, putBuilt } from './list.ts';
import BuildWorker from './worker.ts?worker&inline';

let worker: Worker | null = null;
const pending = new Set<number>();

/** Start building levels n..n+ahead in the background. */
export function prefetchLevels(n: number, ahead = 2) {
  if (typeof Worker === 'undefined') return;
  for (let k = n; k <= n + ahead; k++) {
    if (isCurated(k) || hasBuilt(k) || pending.has(k)) continue;
    try {
      if (!worker) {
        worker = new BuildWorker();
        worker.onmessage = (e: MessageEvent<{ n: number; text: string | null }>) => {
          pending.delete(e.data.n);
          if (e.data.text) putBuilt(e.data.n, e.data.text);
        };
      }
      pending.add(k);
      worker.postMessage(k);
    } catch {
      return;
    }
  }
}
