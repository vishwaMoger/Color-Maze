import { defineConfig, type Plugin } from 'vite';

/**
 * Fast first paint for the built page:
 * - the main stylesheet (large: it carries the art and the font) no longer
 *   holds up the first paint. It is fetched at once, at high priority
 *   (preload), but applied without blocking, so the loading screen (styled
 *   inline in index.html) shows while it and the game script download. The
 *   game waits for it before laying anything out (see main.ts).
 * - on CrazyGames, their SDK starts downloading with the page instead of
 *   after the game script has loaded and run.
 */
function fastStart(): Plugin {
  return {
    name: 'fast-start',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        let out = html.replace(
          /<link rel="stylesheet"( crossorigin)? href="([^"]+\.css)">/,
          (_, cors = '', href) =>
            `<link rel="preload" as="style"${cors} href="${href}">\n    ` +
            `<link rel="stylesheet"${cors} href="${href}" id="main-css" media="print" onload="this.media='all'">`,
        );
        if (out === html) throw new Error('fast-start: stylesheet link not found in index.html');
        if (process.env.VITE_CRAZYGAMES === '1')
          out = out.replace('<head>', '<head>\n    <link rel="preload" as="script" href="https://sdk.crazygames.com/crazygames-sdk-v3.js">');
        return out;
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [fastStart()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 200000,
    chunkSizeWarningLimit: 1500,
    // One script file: simpler to host on game portals and to embed.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
