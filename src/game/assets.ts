// Image assets (MIT Fluent 3D art, see src/assets/LICENSE-fluent-emoji.txt).
// Vite inlines them, so the build stays a self-contained bundle.

const ballUrls = import.meta.glob('../assets/balls/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byName = (urls: Record<string, string>) =>
  Object.fromEntries(Object.entries(urls).map(([path, url]) => [path.split('/').pop()!.replace('.webp', ''), url]));

export const BALL_URLS: Record<string, string> = byName(ballUrls);

const images = new Map<string, HTMLImageElement>();

/** Decode all ball textures up front so skins switch instantly. */
export async function preloadAssets() {
  await Promise.all(
    Object.entries(BALL_URLS).map(
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
