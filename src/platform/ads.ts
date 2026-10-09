// CrazyGames SDK v3, wrapped so the rest of the game never touches it.
// The SDK is only loaded when the build sets VITE_CRAZYGAMES=1; everywhere
// else these calls are no-ops. Rewarded ads are granted for free only in the
// dev server, so the flow can be tried locally without handing out coins in
// a real build. In the dev server, ?sdk=mock installs a fake SDK that logs
// every call (window.__sdkLog), to test the wiring without the portal.

type AdCallbacks = { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void };

/** Key-value storage: the SDK's cloud-synced store, or localStorage. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CrazySdk {
  init: () => Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  ad: { requestAd: (type: 'rewarded' | 'midgame', cb: AdCallbacks) => void };
  game: {
    loadingStart: () => void;
    loadingStop: () => void;
    gameplayStart: () => void;
    gameplayStop: () => void;
    happytime: () => void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?: (cb: (s: { muteAudio?: boolean }) => void) => void;
  };
  /** Like localStorage, synced to the player's account when logged in. */
  data?: KeyStore;
  banner?: {
    requestResponsiveBanner: (containerId: string) => Promise<void> | void;
    clearBanner?: (containerId: string) => void;
    clearAllBanners?: () => void;
  };
}

const ENABLED = import.meta.env.VITE_CRAZYGAMES === '1';
const MOCK = import.meta.env.DEV && new URLSearchParams(location.search).get('sdk') === 'mock';
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
/** Midgame ads at most this often (CrazyGames enforces 3 minutes too). */
const MIDGAME_GAP_MS = 3 * 60 * 1000;

let sdk: CrazySdk | null = null;
/** Whether the game wants gameplay on; the SDK only hears changes. */
let inGameplay = false;
/** An ad is on screen: gameplay stays stopped until it ends. */
let adActive = false;
/** Still loading: gameplay may only start once loading is over. */
let loading = false;
let lastMidgame = performance.now();
let muteListener: ((muted: boolean) => void) | null = null;

/** Load and start the SDK (CrazyGames builds, or the dev mock). Never throws. */
export async function initPlatform(): Promise<void> {
  if (!ENABLED && !MOCK) return;
  try {
    if (MOCK) {
      const { installMockSdk } = await import('./mock-sdk.ts');
      installMockSdk();
    } else {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SDK_URL;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('sdk load failed'));
        document.head.appendChild(s);
      });
    }
    const found = (window as unknown as { CrazyGames?: { SDK?: CrazySdk } }).CrazyGames?.SDK;
    if (!found) return;
    await found.init();
    if (found.environment === 'disabled') return;
    sdk = found;
    sdk.game.addSettingsChangeListener?.((s) => muteListener?.(!!s.muteAudio));
    // Mock only: let tests drive the real ad paths (and skip the 3-minute
    // midgame wait).
    if (MOCK)
      (window as unknown as { __ads: unknown }).__ads = {
        rewardedAd,
        midgameAd: () => {
          lastMidgame = -Infinity;
          return midgameAd();
        },
      };
  } catch {
    sdk = null;
  }
}

/**
 * The banner ad. CrazyGames allows banners only on screens that stay open
 * a while (shop, ranking, settings, rewards), so the HUD asks for one as
 * such a screen opens and drops it as it closes. The strip stays invisible
 * and takes no room until an ad has actually rendered into it; with no ad
 * (no SDK, Basic Launch, no fill, ad removed) nothing shows at all. Each
 * refresh at least 30 s apart, as required.
 */
export const BANNER_ID = 'ad-banner';
let lastBanner = -Infinity;
let bannersOff = false;
let bannerOn = false;
let watcher: MutationObserver | null = null;

/** Whether an ad creative is in the strip and has size. */
function bannerFilled(el: HTMLElement) {
  for (const c of el.querySelectorAll<HTMLElement>('*')) {
    const r = c.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) return true;
  }
  return false;
}

/** Reveal the strip (and keep room for it) only while an ad fills it. */
function syncBanner() {
  const el = document.getElementById(BANNER_ID);
  if (!el) return;
  const filled = bannerOn && bannerFilled(el);
  el.classList.toggle('filled', filled);
  document.body.classList.toggle('has-banner', filled);
}

export function showBanner() {
  const el = document.getElementById(BANNER_ID);
  if (!el || bannersOff || bannerOn || !sdk?.banner) return;
  bannerOn = true;
  // Laid out (the SDK needs a sized container) but invisible until filled.
  el.hidden = false;
  el.textContent = '';
  watcher ??= new MutationObserver(() => requestAnimationFrame(syncBanner));
  watcher.observe(el, { childList: true, subtree: true, attributes: true });
  const now = performance.now();
  if (now - lastBanner < 30_000) return;
  lastBanner = now;
  requestAnimationFrame(() => {
    if (!bannerOn) return;
    Promise.resolve()
      .then(() => sdk!.banner!.requestResponsiveBanner(BANNER_ID))
      .then(() => setTimeout(syncBanner, 50))
      .catch((e: { code?: string } | undefined) => {
        // Disabled (Basic Launch, mobile app): stop asking for good.
        if (e?.code && /disabled/i.test(e.code)) bannersOff = true;
        hideBanner();
      });
  });
}
/** Ask for a fresh banner in the same strip (at most once a minute). */
export function refreshBanner() {
  if (!bannerOn || !sdk?.banner || performance.now() - lastBanner < 60_000) return;
  lastBanner = performance.now();
  Promise.resolve()
    .then(() => sdk!.banner!.requestResponsiveBanner(BANNER_ID))
    .catch(() => undefined);
}

export function hideBanner() {
  const el = document.getElementById(BANNER_ID);
  if (!el || !bannerOn) return;
  bannerOn = false;
  watcher?.disconnect();
  try {
    sdk?.banner?.clearBanner?.(BANNER_ID);
  } catch {
    /* nothing to clear */
  }
  el.textContent = '';
  el.hidden = true;
  syncBanner();
}

/** When a rewarded ad last played: no midgame ad soon after one. */
let lastRewarded = -Infinity;
/** Rewarded ads failed twice in a row: treat ads as off for the session. */
let rewardFails = 0;

/** True when rewarded ads can actually be shown (or faked in dev). */
export function adsAvailable(): boolean {
  return (!!sdk && rewardFails < 2) || (import.meta.env.DEV && !sdk);
}

/**
 * Where to keep the save: the SDK's store (cloud-synced for logged-in
 * players) when it is there, otherwise localStorage. Null if neither works.
 */
export function saveStore(): KeyStore | null {
  if (sdk?.data) return sdk.data;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Portal setting that asks the game to stay silent. */
export function onPortalMute(cb: (muted: boolean) => void) {
  muteListener = cb;
  if (sdk?.game.settings?.muteAudio) cb(true);
}

export function loadingStart() {
  loading = true;
  sdk?.game.loadingStart();
}

export function loadingStop() {
  if (!loading) return;
  loading = false;
  sdk?.game.loadingStop();
  // Gameplay asked for while loading starts now.
  if (inGameplay && !adActive) sdk?.game.gameplayStart();
}

/** The SDK hears gameplay start/stop only outside loading and ads. */
const quiet = () => loading || adActive;

/** Call when the player can actually play (board on screen, no menus). */
export function gameplayStart() {
  if (inGameplay) return;
  inGameplay = true;
  // During an ad the SDK must not hear gameplayStart; it is sent when the
  // ad ends instead.
  if (!quiet()) sdk?.game.gameplayStart();
}

/** Call when play pauses: menus, reward screens, ads. */
export function gameplayStop() {
  if (!inGameplay) return;
  inGameplay = false;
  if (!quiet()) sdk?.game.gameplayStop();
}

/** A moment of joy: level complete, big reward. */
export function happytime() {
  sdk?.game.happytime();
}

function requestAd(type: 'rewarded' | 'midgame', onStart?: () => void, onEnd?: () => void): Promise<boolean> {
  const s = sdk;
  if (!s || adActive) return Promise.resolve(false);
  // Stop gameplay for the ad; while it shows, the game's own start/stop
  // calls only update what it wants, and that is restored afterwards.
  if (inGameplay && !loading) s.game.gameplayStop();
  adActive = true;
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      adActive = false;
      onEnd?.();
      if (inGameplay && !loading) s.game.gameplayStart();
      resolve(ok);
    };
    s.ad.requestAd(type, {
      adStarted: () => onStart?.(),
      adFinished: () => finish(true),
      adError: () => finish(false),
    });
  });
}

/** Show a rewarded ad; resolves true when the player earned the reward. */
export function rewardedAd(onStart?: () => void, onEnd?: () => void): Promise<boolean> {
  if (!sdk) {
    if (import.meta.env.DEV) lastRewarded = performance.now();
    return Promise.resolve(import.meta.env.DEV);
  }
  return requestAd('rewarded', onStart, onEnd).then((ok) => {
    // Ads off (Basic Launch) or none to be had: after two misses in a row
    // every rewarded offer hides itself, so no button ever does nothing.
    rewardFails = ok ? 0 : rewardFails + 1;
    if (ok) lastRewarded = performance.now();
    return ok;
  });
}

/** Between levels only; skipped unless enough time has passed. */
export function midgameAd(onStart?: () => void, onEnd?: () => void): Promise<void> {
  // Never right after the player chose to watch a rewarded ad.
  if (performance.now() - lastRewarded < 2 * 60 * 1000) return Promise.resolve();
  if (!sdk || adActive || performance.now() - lastMidgame < MIDGAME_GAP_MS) return Promise.resolve();
  lastMidgame = performance.now();
  return requestAd('midgame', onStart, onEnd).then(() => undefined);
}
