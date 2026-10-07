// Rewarded ads. On CrazyGames this goes through the SDK; elsewhere (local
// play, previews) the reward is granted directly so the flow can be tried.

interface CrazySdk {
  ad: { requestAd: (type: 'rewarded' | 'midgame', cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void }) => void };
}

const sdk = (): CrazySdk | undefined => (window as unknown as { CrazyGames?: { SDK?: CrazySdk } }).CrazyGames?.SDK;

/** Show a rewarded ad; resolves true when the player earned the reward. */
export function rewardedAd(onStart?: () => void, onEnd?: () => void): Promise<boolean> {
  const s = sdk();
  if (!s) return Promise.resolve(true);
  return new Promise((resolve) => {
    s.ad.requestAd('rewarded', {
      adStarted: () => onStart?.(),
      adFinished: () => {
        onEnd?.();
        resolve(true);
      },
      adError: () => {
        onEnd?.();
        resolve(false);
      },
    });
  });
}
