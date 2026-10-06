export type Ambient = 'bokeh' | 'bubbles' | 'stars';

export interface Theme {
  id: string;
  name: string;
  /** CSS background behind the board. */
  bgTop: string;
  bgBottom: string;
  /** Raised plate the maze is cut into. */
  plate: string;
  plateLight: string;
  plateShadow: string;
  /** Visible front face of the walls, seen over the floor's top edge. */
  wallSide: string;
  floorTop: string;
  floorBottom: string;
  gridLine: string;
  paint: number;
  paintDark: number;
  paintLight: number;
  ball: [string, string, string];
  ambient: Ambient;
  ambientColor: number;
  caustics?: boolean;
  /** Neon boards glow around the channels and around the paint. */
  neon?: { edge: number };
  /** UI colours for the HUD. */
  ui: { ink: string; button: string; buttonShade: string; panel: string };
  /** Root note (Hz) of the theme's musical scale. */
  root: number;
}

export const THEMES: Theme[] = [
  {
    id: 'lavender',
    name: 'Lavender',
    bgTop: '#ece8ff',
    bgBottom: '#d6cdfa',
    plate: '#f6f4ff',
    plateLight: '#ffffff',
    plateShadow: 'rgba(96, 72, 190, 0.32)',
    wallSide: '#cfc6f4',
    floorTop: '#5e4c97',
    floorBottom: '#4a3a80',
    gridLine: 'rgba(255,255,255,0.06)',
    paint: 0xff2d8b,
    paintDark: 0xc8146a,
    paintLight: 0xff8cc0,
    ball: ['#fff6c2', '#ffc21a', '#f08a00'],
    ambient: 'bokeh',
    ambientColor: 0xffffff,
    ui: { ink: '#4b3592', button: '#7b5cf0', buttonShade: '#5a3fcc', panel: 'rgba(255,255,255,0.72)' },
    root: 261.63,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    bgTop: '#9fe7ec',
    bgBottom: '#3fb3c6',
    plate: '#5fd0dc',
    plateLight: '#a6f1f5',
    plateShadow: 'rgba(0, 70, 100, 0.38)',
    wallSide: '#38aebf',
    floorTop: '#0f5a78',
    floorBottom: '#0a3f5a',
    gridLine: 'rgba(160,240,255,0.07)',
    paint: 0xffa23a,
    paintDark: 0xe0701a,
    paintLight: 0xffd08a,
    ball: ['#ffffff', '#d8efff', '#4f8fb8'],
    ambient: 'bubbles',
    ambientColor: 0xe8ffff,
    caustics: true,
    ui: { ink: '#0b4a66', button: '#1597b8', buttonShade: '#0b7090', panel: 'rgba(235,255,255,0.72)' },
    root: 293.66,
  },
  {
    id: 'neon',
    name: 'Neon Night',
    bgTop: '#1a1240',
    bgBottom: '#07051a',
    plate: '#1d1846',
    plateLight: '#2d2668',
    plateShadow: 'rgba(0, 0, 0, 0.6)',
    wallSide: '#151036',
    floorTop: '#0a0820',
    floorBottom: '#05040f',
    gridLine: 'rgba(120,220,255,0.06)',
    paint: 0x2ff3ff,
    paintDark: 0x12a8d8,
    paintLight: 0xb6fbff,
    ball: ['#ffffff', '#ffd6fb', '#ff4fd8'],
    ambient: 'stars',
    ambientColor: 0xc8d8ff,
    neon: { edge: 0xff4fd8 },
    ui: { ink: '#e8e2ff', button: '#ff4fd8', buttonShade: '#b02a98', panel: 'rgba(30,22,70,0.78)' },
    root: 220,
  },
];
