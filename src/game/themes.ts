export type Ambient = 'bokeh' | 'bubbles' | 'stars';

export interface Theme {
  id: string;
  name: string;
  /** Page background; the wall tops use the same material. */
  bgTop: string;
  bgBottom: string;
  wallTop: string;
  /** Soft tone where wall tops round down toward the floor. */
  bevel: string;
  /** Front face of the walls and the shadow they cast on the floor. */
  wallFace: string;
  wallFaceDark: string;
  wallLip: string;
  wallShadow: string;
  floor: string;
  gridLine: string;
  /** Tile seams still faintly visible through wet paint. */
  paintSeam: string;
  paint: number;
  paintDark: number;
  paintLight: number;
  /** Speed cone behind the moving ball. */
  cone: number;
  ball: [string, string, string];
  ambient: Ambient;
  ambientColor: number;
  caustics?: boolean;
  /** Neon boards glow around the channels and around the paint. */
  neon?: { edge: number };
  /** UI colours for the HUD. */
  ui: { ink: string; deep: string; p1: string; p2: string; p3: string; panelEdge: string };
  /** Swatch colours for the board picker. */
  swatch: { slab: string; side: string; floor: string; paint: string };
  /** Root note (Hz) of the theme's musical scale. */
  root: number;
}

export const THEMES: Theme[] = [
  {
    id: 'lavender',
    name: 'Lavender',
    bgTop: '#e4e0fd',
    bgBottom: '#d9d3fb',
    wallTop: '#dedafc',
    bevel: 'rgba(120, 105, 235, 0.42)',
    wallFace: '#77739f',
    wallFaceDark: '#6c6894',
    wallLip: 'rgba(205, 200, 245, 0.7)',
    wallShadow: 'rgba(38, 24, 72, 0.55)',
    floor: '#5c4b81',
    gridLine: 'rgba(30, 16, 62, 0.42)',
    paintSeam: 'rgba(120, 0, 50, 0.16)',
    paint: 0xff2d8b,
    paintDark: 0xb40c5c,
    paintLight: 0xff8cc0,
    cone: 0xffc3a0,
    ball: ['#fff6c2', '#ffc21a', '#f08a00'],
    ambient: 'bokeh',
    ambientColor: 0xffffff,
    ui: { ink: '#5b3fd0', deep: '#3d2490', p1: '#9d7fff', p2: '#7650ef', p3: '#5534c4', panelEdge: '#cbbff7' },
    swatch: { slab: '#dedafc', side: '#77739f', floor: '#5c4b81', paint: '#ff2d8b' },
    root: 261.63,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    bgTop: '#a6eef3',
    bgBottom: '#86dfe9',
    wallTop: '#98e8ef',
    bevel: 'rgba(0, 120, 160, 0.4)',
    wallFace: '#3c98ad',
    wallFaceDark: '#33889c',
    wallLip: 'rgba(190, 250, 255, 0.7)',
    wallShadow: 'rgba(0, 28, 48, 0.55)',
    floor: '#125776',
    gridLine: 'rgba(0, 20, 40, 0.42)',
    paintSeam: 'rgba(120, 40, 0, 0.16)',
    paint: 0xffa23a,
    paintDark: 0xc55a10,
    paintLight: 0xffd08a,
    cone: 0xfff2d8,
    ball: ['#ffffff', '#d8efff', '#4f8fb8'],
    ambient: 'bubbles',
    ambientColor: 0xffffff,
    caustics: true,
    ui: { ink: '#0d6b86', deep: '#08485c', p1: '#4fd0e6', p2: '#1aa3c4', p3: '#0b7392', panelEdge: '#a6e6ef' },
    swatch: { slab: '#98e8ef', side: '#3c98ad', floor: '#125776', paint: '#ffa23a' },
    root: 293.66,
  },
  {
    id: 'neon',
    name: 'Neon Night',
    bgTop: '#1d1546',
    bgBottom: '#120d30',
    wallTop: '#211a4d',
    bevel: 'rgba(255, 79, 216, 0.35)',
    wallFace: '#3a2d84',
    wallFaceDark: '#2f246e',
    wallLip: 'rgba(255, 120, 230, 0.75)',
    wallShadow: 'rgba(0, 0, 0, 0.6)',
    floor: '#0d0b26',
    gridLine: 'rgba(80, 200, 255, 0.10)',
    paintSeam: 'rgba(0, 60, 80, 0.2)',
    paint: 0x2ff3ff,
    paintDark: 0x0f8fc0,
    paintLight: 0xb6fbff,
    cone: 0xffb6f0,
    ball: ['#ffffff', '#ffd6fb', '#ff4fd8'],
    ambient: 'stars',
    ambientColor: 0xc8d8ff,
    neon: { edge: 0xff4fd8 },
    ui: { ink: '#f1e8ff', deep: '#120a33', p1: '#ff7ae3', p2: '#e03cc2', p3: '#9a1f86', panelEdge: '#5a3fb0' },
    swatch: { slab: '#211a4d', side: '#3a2d84', floor: '#0d0b26', paint: '#2ff3ff' },
    root: 220,
  },
];
