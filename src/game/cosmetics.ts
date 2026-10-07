// Unlockable ball skins and paint colours. Boards live in themes.ts.

export interface BallSkin {
  id: string;
  name: string;
  unlock: number;
  /** Lit sphere colours: highlight, body, shade. Used when there is no image. */
  colors?: [string, string, string];
  /** Extra-sharp specular for metal. */
  metal?: boolean;
  /** Textured 3D ball art (see assets.ts). */
  image?: string;
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
}

export const PATTERN_MODE: Record<PaintPattern, number> = { marble: 1, slime: 2, lava: 3, water: 4 };

export const BALLS: BallSkin[] = [
  { id: 'sunny', name: 'Sunny', unlock: 1, colors: ['#fff7b0', '#ffd23a', '#e98a10'] },
  { id: 'pearl', name: 'Pearl', unlock: 3, colors: ['#ffffff', '#ece8ff', '#a79cd8'] },
  { id: 'earth', name: 'Earth', unlock: 6, image: 'earth' },
  { id: 'ruby', name: 'Ruby', unlock: 9, colors: ['#ffb3c4', '#f2295a', '#8e0f30'] },
  { id: 'softball', name: 'Softball', unlock: 12, image: 'softball' },
  { id: 'volley', name: 'Volley', unlock: 16, image: 'volley' },
  { id: 'mint', name: 'Mint', unlock: 20, colors: ['#e6fff3', '#4fdca0', '#0f8a62'] },
  { id: 'basket', name: 'Hoops', unlock: 24, image: 'basket' },
  { id: 'soccer', name: 'Soccer', unlock: 30, image: 'soccer' },
  { id: 'moon', name: 'Moon', unlock: 36, image: 'moon' },
  { id: 'eight', name: '8-Ball', unlock: 44, image: 'eight' },
  { id: 'gold', name: 'Gold', unlock: 55, colors: ['#fffbe0', '#f2c230', '#9a5e00'], metal: true },
];

export const PAINTS: PaintColor[] = [
  { id: 'pink', name: 'Bubblegum', paint: 0xff2d8b, dark: 0xb40c5c, light: 0xff8cc0, cone: 0xffc3a0, unlock: 1 },
  { id: 'sun', name: 'Sunshine', paint: 0xffc414, dark: 0xc28e00, light: 0xfff09a, cone: 0xfff7cf, unlock: 5 },
  { id: 'blue', name: 'Cobalt', paint: 0x1f5ff0, dark: 0x0b3aa8, light: 0x8fb4ff, cone: 0xd8e6ff, unlock: 10 },
  { id: 'lime', name: 'Lime', paint: 0x22c55e, dark: 0x15803d, light: 0x8ff0b0, cone: 0xe0ffe9, unlock: 16 },
  { id: 'violet', name: 'Violet', paint: 0x9b30ff, dark: 0x6b1fbf, light: 0xdcafff, cone: 0xf0deff, unlock: 24 },
  { id: 'aqua', name: 'Lagoon', paint: 0x18c2f2, dark: 0x0a7fb0, light: 0xa8f2ff, cone: 0xe0fbff, unlock: 32, pattern: 'water', alt: 0xe8fdff },
  { id: 'orange', name: 'Tangerine', paint: 0xff8a1f, dark: 0xc2560a, light: 0xffc38a, cone: 0xffe2b8, unlock: 40 },
  { id: 'marble', name: 'Marble', paint: 0xf06ad8, dark: 0xb03aa0, light: 0xffc2f2, cone: 0xffe2fa, unlock: 50, pattern: 'marble', alt: 0xffd0f6 },
  { id: 'slime', name: 'Slime', paint: 0x2ea81c, dark: 0x1a6e10, light: 0xb8ff66, cone: 0xeaffd0, unlock: 65, pattern: 'slime', alt: 0xc8ff3a },
  { id: 'lava', name: 'Lava', paint: 0x8f1606, dark: 0x5a0a02, light: 0xff8a3a, cone: 0xffd0a0, unlock: 80, pattern: 'lava', alt: 0xff6a12 },
];

export const hexCss = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
