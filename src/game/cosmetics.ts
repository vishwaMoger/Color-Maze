// Unlockable ball skins and paint colours. Boards live in themes.ts.

import type { SphereMode } from './sphere.ts';

export interface BallSkin {
  id: string;
  name: string;
  unlock: number;
  /** Surface pattern drawn on the 3D sphere (see sphere.ts). */
  mode: SphereMode;
  /** Pattern colours: accent, body, detail. */
  colors: [string, string, string];
  /**
   * A special item unlocked by watching this many rewarded ads (where ads
   * run); `unlock` is the level it opens at instead when ads are off.
   */
  ads?: number;
}

export type PaintPattern = 'marble' | 'slime' | 'lava' | 'water';

export interface PaintColor {
  id: string;
  name: string;
  paint: number;
  dark: number;
  light: number;
  cone: number;
  unlock: number;
  /** Animated shader pattern and its second colour. */
  pattern?: PaintPattern;
  alt?: number;
  /** Special: unlocked by rewarded ads (see BallSkin.ads). */
  ads?: number;
}

export const PATTERN_MODE: Record<PaintPattern, number> = { marble: 1, slime: 2, lava: 3, water: 4 };

export const BALLS: BallSkin[] = [
  { id: 'sunny', name: 'Sunny', unlock: 1, mode: 'toy', colors: ['#fdff5a', '#fadc52', '#f58c3e'] },
  { id: 'pearl', name: 'Pearl', unlock: 6, mode: 'pearl', colors: ['#ffffff', '#f4eefc', '#a79cd8'] },
  { id: 'earth', name: 'Earth', unlock: 21, mode: 'earth', colors: ['#ffffff', '#2a7de1', '#1f9d4b'] },
  { id: 'ruby', name: 'Ruby', unlock: 45, mode: 'gem', colors: ['#ffffff', '#ff1f5a', '#8a0425'] },
  { id: 'softball', name: 'Softball', unlock: 78, mode: 'softball', colors: ['#fbfff0', '#d9f23a', '#e0263c'] },
  { id: 'volley', name: 'Volley', unlock: 120, mode: 'volley', colors: ['#ffcf1f', '#ffffff', '#1d5fe0'] },
  { id: 'mint', name: 'Mint', unlock: 170, mode: 'swirl', colors: ['#ffffff', '#16c784', '#0b7a52'] },
  { id: 'basket', name: 'Hoops', unlock: 210, mode: 'basket', colors: ['#ffffff', '#f2701b', '#2a1408'] },
  { id: 'soccer', name: 'Soccer', unlock: 285, mode: 'soccer', colors: ['#ffffff', '#fbfbff', '#16161c'] },
  { id: 'moon', name: 'Moon', unlock: 370, mode: 'moon', colors: ['#e9e6ef', '#cfcbd8', '#7d7889'] },
  { id: 'eight', name: '8-Ball', unlock: 440, mode: 'eight', colors: ['#ffffff', '#15151c', '#000000'] },
  { id: 'gold', name: 'Gold', unlock: 600, mode: 'metal', colors: ['#fff3b0', '#f7c22e', '#8a5200'] },
  // A deep violet swirl.
  { id: 'galaxy', name: 'Galaxy', unlock: 250, mode: 'swirl', colors: ['#7ef0ff', '#5b2bd8', '#ff5fd2'] },
];

export const PAINTS: PaintColor[] = [
  { id: 'pink', name: 'Bubblegum', paint: 0xee288f, dark: 0xb40c5c, light: 0xff8cc0, cone: 0xffc3a0, unlock: 1 },
  { id: 'sun', name: 'Sunshine', paint: 0xffc414, dark: 0xc28e00, light: 0xfff09a, cone: 0xfff7cf, unlock: 3 },
  { id: 'blue', name: 'Cobalt', paint: 0x1f5ff0, dark: 0x0b3aa8, light: 0x8fb4ff, cone: 0xd8e6ff, unlock: 15 },
  { id: 'lime', name: 'Lime', paint: 0x22c55e, dark: 0x15803d, light: 0x8ff0b0, cone: 0xe0ffe9, unlock: 36 },
  { id: 'violet', name: 'Violet', paint: 0x9b30ff, dark: 0x6b1fbf, light: 0xdcafff, cone: 0xf0deff, unlock: 66 },
  { id: 'aqua', name: 'Lagoon', paint: 0x18c2f2, dark: 0x0a7fb0, light: 0xa8f2ff, cone: 0xe0fbff, unlock: 150, pattern: 'water', alt: 0xe8fdff },
  { id: 'orange', name: 'Tangerine', paint: 0xff8a1f, dark: 0xc2560a, light: 0xffc38a, cone: 0xffe2b8, unlock: 105 },
  // A shimmering violet-and-cyan marble.
  { id: 'aurora', name: 'Aurora', paint: 0x8a5cff, dark: 0x5a2fd0, light: 0xc9b3ff, cone: 0xe4dcff, unlock: 320, pattern: 'marble', alt: 0x7ef0ff },
  { id: 'marble', name: 'Marble', paint: 0xf06ad8, dark: 0xb03aa0, light: 0xffc2f2, cone: 0xffe2fa, unlock: 235, pattern: 'marble', alt: 0xffd0f6 },
  { id: 'slime', name: 'Slime', paint: 0x2ea81c, dark: 0x1a6e10, light: 0xb8ff66, cone: 0xeaffd0, unlock: 340, pattern: 'slime', alt: 0xc8ff3a },
  { id: 'lava', name: 'Lava', paint: 0x8f1606, dark: 0x5a0a02, light: 0xff8a3a, cone: 0xffd0a0, unlock: 530, pattern: 'lava', alt: 0xff6a12 },
];

export const hexCss = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
