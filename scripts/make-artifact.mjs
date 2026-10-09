// Packs the Vite build into one self-contained HTML page (inline CSS + JS)
// for sharing a playable preview link. Run after `vite build`.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const assets = readdirSync(join(dist, 'assets'));
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dist, 'assets', f), 'utf8')).join('\n');
const jsFiles = assets.filter((f) => f.endsWith('.js'));
if (jsFiles.length !== 1) throw new Error(`expected one JS bundle, found ${jsFiles.length}`);
let js = readFileSync(join(dist, 'assets', jsFiles[0]), 'utf8');
// Keep the inline script from terminating early or opening an HTML comment.
js = js.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');

const source = readFileSync('index.html', 'utf8');
const markup = source.slice(source.indexOf('<!--APP-START-->') + 16, source.indexOf('<!--APP-END-->'));

const page = `<title>Color Maze</title>
<style>
${css}
</style>
${markup}
<script type="module">
${js}
</script>
`;
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/color-maze.html', page);
console.log(`artifact/color-maze.html ${(page.length / 1024).toFixed(0)} KB`);
