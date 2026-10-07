// Image assets (MIT Fluent 3D art, see src/assets/LICENSE-fluent-emoji.txt).
// Vite inlines them, so the build stays a self-contained bundle.

const ballUrls = import.meta.glob('../assets/balls/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byName = (urls: Record<string, string>) =>
  Object.fromEntries(Object.entries(urls).map(([path, url]) => [path.split('/').pop()!.replace('.webp', ''), url]));

export const BALL_URLS: Record<string, string> = byName(ballUrls);

const avatarUrls = import.meta.glob('../assets/avatars/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const AVATAR_URLS: Record<string, string> = byName(avatarUrls);
const FACES = Object.keys(AVATAR_URLS).filter((k) => k !== 'you').sort();

/** A stable 3D animal face per league name ('you' for the player). */
export function avatarUrl(name: string, you: boolean): string {
  if (you) return AVATAR_URLS.you;
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_URLS[FACES[h % FACES.length]];
}

const iconUrls = import.meta.glob('../assets/icons/{star,coin,key}.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const ICON_URLS: Record<string, string> = byName(iconUrls);

const images = new Map<string, HTMLImageElement>();

/** Decode all ball textures up front so skins switch instantly. */
export async function preloadAssets() {
  await Promise.all(
    [...Object.entries(BALL_URLS), ...Object.entries(ICON_URLS).map(([k, v]) => [`icon:${k}`, v] as [string, string])].map(
      ([name, url]) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            images.set(name, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        }),
    ),
  );
}

export function ballImage(name: string): HTMLImageElement | undefined {
  return images.get(name);
}

/** Decoded icon art (star, coin) for particle effects. */
export function iconImage(name: string): HTMLImageElement | undefined {
  return images.get(`icon:${name}`);
}
