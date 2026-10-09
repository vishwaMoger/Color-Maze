// Dev-only stand-in for the CrazyGames SDK v3 (loaded with ?sdk=mock).
// Records every call in window.__sdkLog and flags rule breaks the portal
// cares about as 'VIOLATION: ...' entries: gameplay starting during an ad,
// starting or stopping twice in a row, or anything before init(). Ads
// "play" for 800 ms; set window.__sdkAdFail = true to make the next fail.

type Log = { t: number; call: string };

export function installMockSdk() {
  const log: Log[] = [];
  const w = window as unknown as { __sdkLog: Log[]; __sdkAdFail?: boolean; CrazyGames: unknown };
  w.__sdkLog = log;
  const t0 = performance.now();
  const note = (call: string) => log.push({ t: Math.round(performance.now() - t0), call });
  let ready = false;
  let playing = false;
  let adShowing = false;
  const check = (call: string) => {
    if (!ready) note(`VIOLATION: ${call} before init`);
  };
  const store = new Map<string, string>();
  w.CrazyGames = {
    SDK: {
      environment: 'local',
      init: async () => {
        ready = true;
        note('init');
      },
      game: {
        settings: { muteAudio: false },
        addSettingsChangeListener: () => note('addSettingsChangeListener'),
        loadingStart: () => (check('loadingStart'), note('loadingStart')),
        loadingStop: () => (check('loadingStop'), note('loadingStop')),
        gameplayStart: () => {
          check('gameplayStart');
          if (adShowing) note('VIOLATION: gameplayStart during an ad');
          if (playing) note('VIOLATION: gameplayStart twice');
          playing = true;
          note('gameplayStart');
        },
        gameplayStop: () => {
          check('gameplayStop');
          if (!playing) note('VIOLATION: gameplayStop while stopped');
          playing = false;
          note('gameplayStop');
        },
        happytime: () => (check('happytime'), note('happytime')),
      },
      ad: {
        requestAd: (type: string, cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void }) => {
          check('requestAd');
          if (playing) note(`VIOLATION: ${type} ad requested during gameplay`);
          note(`requestAd ${type}`);
          if (w.__sdkAdFail) {
            w.__sdkAdFail = false;
            setTimeout(() => (note('adError'), cb.adError?.('mock failure')), 50);
            return;
          }
          adShowing = true;
          setTimeout(() => (note('adStarted'), cb.adStarted?.()), 30);
          setTimeout(() => {
            adShowing = false;
            note('adFinished');
            cb.adFinished?.();
          }, 800);
        },
      },
      banner: {
        requestResponsiveBanner: (id: string) => {
          check('requestResponsiveBanner');
          note(`banner ${id}`);
          const el = document.getElementById(id);
          if (el) {
            el.classList.add('placeholder');
            el.textContent = 'Banner ad (mock)';
          }
        },
      },
      data: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => (store.set(k, v), note(`data.setItem ${k}`)),
        removeItem: (k: string) => store.delete(k),
      },
    },
  };
}
