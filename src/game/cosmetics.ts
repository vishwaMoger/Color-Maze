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

export interface PaintColor {
  id: string;
  name: string;
  paint: number;
  dark: number;
  light: number;
  cone: number;
  unlock: number;
}

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
  { id: 'orange', name: 'Tangerine', paint: 0xff8a1f, dark: 0xc2560a, light: 0xffc38a, cone: 0xffe2b8, unlock: 6 },
  { id: 'cyan', name: 'Lagoon', paint: 0x1fd2f0, dark: 0x0b88a8, light: 0x9ff1ff, cone: 0xd8fbff, unlock: 12 },
  { id: 'lime', name: 'Lime', paint: 0x7ddb1f, dark: 0x3f8e0c, light: 0xc7f57e, cone: 0xf0ffd0, unlock: 20 },
  { id: 'violet', name: 'Violet', paint: 0xb455ff, dark: 0x6b1fbf, light: 0xdcafff, cone: 0xf0deff, unlock: 28 },
  { id: 'sun', name: 'Sunshine', paint: 0xffd21f, dark: 0xc28e00, light: 0xfff09a, cone: 0xfff7cf, unlock: 40 },
];

export const hexCss = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
