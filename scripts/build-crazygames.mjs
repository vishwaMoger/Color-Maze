// Builds the CrazyGames upload: a Vite build with the CrazyGames SDK
// switched on (VITE_CRAZYGAMES=1), checked to really contain it, zipped
// with index.html at the root as the developer portal expects.
//
// Usage: npm run build:crazygames  ->  crazygames/color-maze.zip
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const OUT = 'dist-crazygames';
const ZIP = join('crazygames', 'color-maze.zip');

const vite = join('node_modules', 'vite', 'bin', 'vite.js');
const run = spawnSync(process.execPath, [vite, 'build', '--outDir', OUT, '--emptyOutDir'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_CRAZYGAMES: '1' },
});
if (run.status !== 0) process.exit(run.status ?? 1);

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(OUT);

// Guard: without the SDK the upload would show no ads and send no events.
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('');
if (!js.includes('sdk.crazygames.com/crazygames-sdk-v3.js')) {
  console.error('CrazyGames SDK missing from the build: is VITE_CRAZYGAMES read in src/platform/ads.ts?');
  process.exit(1);
}
if (!files.some((f) => relative(OUT, f) === 'index.html')) {
  console.error('index.html missing from the build');
  process.exit(1);
}

// Minimal zip writer (deflate), so no zip tool needs to be installed.
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
// File times as MS-DOS date/time (local clock), as zip tools expect.
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
const local = [];
const central = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(relative(OUT, f).split(sep).join('/'));
  const data = readFileSync(f);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0x0800, 6); // UTF-8 names
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt16LE(dosTime, 10);
  head.writeUInt16LE(dosDate, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(name.length, 26);
  local.push(head, name, packed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(dosTime, 12);
  entry.writeUInt16LE(dosDate, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += head.length + name.length + packed.length;
}
const dir = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(dir.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, dir, end]);
mkdirSync('crazygames', { recursive: true });
writeFileSync(ZIP, zip);
console.log(`${ZIP} ${(zip.length / 1024).toFixed(0)} KB, ${files.length} files, CrazyGames SDK included`);
