// Unlockable ball skins and paint colours. Boards live in themes.ts.

export interface BallSkin {
  id: string;
  name: string;
  /** Highlight, body and shade colours of the sphere. */
  colors: [string, string, string];
  shine: string;
  unlock: number;
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
  { id: 'sunny', name: 'Sunny', colors: ['#fff36a', '#ffcf2e', '#ff8f14'], shine: 'rgba(255,255,170,0.95)', unlock: 1 },
  { id: 'pearl', name: 'Pearl', colors: ['#ffffff', '#eae6ff', '#9a8fd6'], shine: 'rgba(255,255,255,0.95)', unlock: 4 },
  { id: 'ruby', name: 'Ruby', colors: ['#ffc2cf', '#ff3f6c', '#a3123a'], shine: 'rgba(255,220,230,0.9)', unlock: 9 },
  { id: 'mint', name: 'Mint', colors: ['#e6fff2', '#5fe3a8', '#13906a'], shine: 'rgba(235,255,245,0.9)', unlock: 16 },
  { id: 'grape', name: 'Grape', colors: ['#f0d9ff', '#a35cff', '#5a1fb0'], shine: 'rgba(245,230,255,0.9)', unlock: 24 },
  { id: 'gold', name: 'Gold', colors: ['#fff8d6', '#f5c542', '#a86a00'], shine: 'rgba(255,255,235,1)', unlock: 35 },
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
