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
  /** Shader pattern for the paint (0 = plain) and its second colour. */
  paintMode?: number;
  paintAlt?: number;
  /** Speed cone behind the moving ball. */
  cone: number;
  ambient: Ambient;
  ambientColor: number;
  caustics?: boolean;
  /** Surface texture for the wall tops and floor. */
  texture?: 'wood' | 'terrazzo';
  /** Neon boards glow around the channels and around the paint. */
  neon?: { edge: number };
  /** UI colours for the HUD. */
  ui: { ink: string; deep: string; p1: string; p2: string; p3: string; panelEdge: string };
  /** Swatch colours for the board picker. */
  swatch: { slab: string; side: string; floor: string; paint: string };
  /** Root note (Hz) of the theme's musical scale. */
  root: number;
  /** Level at which this board unlocks in the shop. */
  unlock: number;
}

export const THEMES: Theme[] = [
  {
    id: 'lavender',
    name: 'Lavender',
    bgTop: '#e4e0fd',
    bgBottom: '#d9d3fb',
    wallTop: '#dedafc',
    bevel: 'rgba(118, 108, 228, 0.5)',
    wallFace: '#77739f',
    wallFaceDark: '#6c6894',
    wallLip: 'rgba(205, 200, 245, 0.7)',
    wallShadow: 'rgba(34, 22, 66, 0.42)',
    floor: '#5c4b81',
    gridLine: 'rgba(40, 30, 78, 0.5)',
    paintSeam: 'rgba(0, 0, 0, 0.16)',
    paint: 0xff2d8b,
    paintDark: 0xb40c5c,
    paintLight: 0xff8cc0,
    cone: 0xffc3a0,
    ambient: 'bokeh',
    ambientColor: 0xffffff,
    ui: { ink: '#5b3fd0', deep: '#3d2490', p1: '#9d7fff', p2: '#7650ef', p3: '#5534c4', panelEdge: '#cbbff7' },
    swatch: { slab: '#dedafc', side: '#77739f', floor: '#5c4b81', paint: '#ff2d8b' },
    root: 261.63,
    unlock: 1,
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
    wallShadow: 'rgba(0, 26, 46, 0.42)',
    floor: '#125776',
    gridLine: 'rgba(0, 28, 52, 0.3)',
    paintSeam: 'rgba(0, 0, 0, 0.16)',
    paint: 0xffa23a,
    paintDark: 0xc55a10,
    paintLight: 0xffd08a,
    cone: 0xfff2d8,
    ambient: 'bubbles',
    ambientColor: 0xffffff,
    caustics: true,
    ui: { ink: '#0d6b86', deep: '#08485c', p1: '#4fd0e6', p2: '#1aa3c4', p3: '#0b7392', panelEdge: '#a6e6ef' },
    swatch: { slab: '#98e8ef', side: '#3c98ad', floor: '#125776', paint: '#ffa23a' },
    root: 293.66,
    unlock: 10,
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
    wallShadow: 'rgba(0, 0, 0, 0.45)',
    floor: '#0d0b26',
    gridLine: 'rgba(80, 200, 255, 0.10)',
    paintSeam: 'rgba(0, 0, 0, 0.18)',
    paint: 0x2ff3ff,
    paintDark: 0x0f8fc0,
    paintLight: 0xb6fbff,
    cone: 0xffb6f0,
    ambient: 'stars',
    ambientColor: 0xc8d8ff,
    neon: { edge: 0xff4fd8 },
    ui: { ink: '#f1e8ff', deep: '#120a33', p1: '#ff7ae3', p2: '#e03cc2', p3: '#9a1f86', panelEdge: '#5a3fb0' },
    swatch: { slab: '#211a4d', side: '#3a2d84', floor: '#0d0b26', paint: '#2ff3ff' },
    root: 220,
    unlock: 22,
  },
  {
    id: 'mint',
    name: 'Mint',
    bgTop: '#c8f6ea',
    bgBottom: '#b0eedd',
    wallTop: '#c0f3e5',
    bevel: 'rgba(0, 0, 0, 0.2)',
    wallFace: '#2f9e88',
    wallFaceDark: '#288a76',
    wallLip: 'rgba(225, 255, 248, 0.7)',
    wallShadow: 'rgba(0, 50, 40, 0.38)',
    floor: '#167a68',
    gridLine: 'rgba(0, 40, 32, 0.4)',
    paintSeam: 'rgba(0, 0, 0, 0.16)',
    paint: 0xff2d8b,
    paintDark: 0xb40c5c,
    paintLight: 0xff8cc0,
    cone: 0xffc3a0,
    ambient: 'bokeh',
    ambientColor: 0xffffff,
    ui: { ink: '#0f7a64', deep: '#0a5244', p1: '#4fd6b4', p2: '#1fae8c', p3: '#127a62', panelEdge: '#a6ead8' },
    swatch: { slab: '#c0f3e5', side: '#2f9e88', floor: '#167a68', paint: '#ff2d8b' },
    root: 329.63,
    unlock: 15,
  },
  {
    id: 'royal',
    name: 'Royal',
    bgTop: '#c2b0ff',
    bgBottom: '#ae98ff',
    wallTop: '#b9a6ff',
    bevel: 'rgba(0, 0, 0, 0.2)',
    wallFace: '#5f3bd0',
    wallFaceDark: '#5232ba',
    wallLip: 'rgba(220, 205, 255, 0.7)',
    wallShadow: 'rgba(30, 0, 90, 0.45)',
    floor: '#3f1fa8',
    gridLine: 'rgba(20, 0, 70, 0.45)',
    paintSeam: 'rgba(0, 0, 0, 0.16)',
    paint: 0xff2d8b,
    paintDark: 0xb40c5c,
    paintLight: 0xff8cc0,
    cone: 0xffc3a0,
    ambient: 'bokeh',
    ambientColor: 0xffffff,
    ui: { ink: '#4a1fb8', deep: '#2e0f80', p1: '#9d7fff', p2: '#7650ef', p3: '#5534c4', panelEdge: '#cbbff7' },
    swatch: { slab: '#b9a6ff', side: '#5f3bd0', floor: '#3f1fa8', paint: '#ff2d8b' },
    root: 246.94,
    unlock: 30,
  },
  {
    id: 'wood',
    name: 'Wood',
    bgTop: '#f4e1c6',
    bgBottom: '#ecd2ae',
    wallTop: '#d29a62',
    bevel: 'rgba(0, 0, 0, 0.2)',
    wallFace: '#8a5226',
    wallFaceDark: '#7a4620',
    wallLip: 'rgba(255, 220, 170, 0.6)',
    wallShadow: 'rgba(60, 25, 0, 0.45)',
    floor: '#6e3c1c',
    gridLine: 'rgba(40, 15, 0, 0.45)',
    paintSeam: 'rgba(0, 0, 0, 0.16)',
    paint: 0xff2d8b,
    paintDark: 0xb40c5c,
    paintLight: 0xff8cc0,
    cone: 0xffc3a0,
    ambient: 'bokeh',
    ambientColor: 0xfff2d8,
    texture: 'wood',
    ui: { ink: '#7a3e12', deep: '#4e2508', p1: '#d59a5c', p2: '#b06f34', p3: '#82491c', panelEdge: '#e8c79f' },
    swatch: { slab: '#d29a62', side: '#8a5226', floor: '#6e3c1c', paint: '#ff2d8b' },
    root: 196,
    unlock: 40,
  },
  {
    id: 'candy',
    name: 'Candy',
    bgTop: '#ffd9ee',
    bgBottom: '#ffc6e4',
    wallTop: '#ffcde8',
    bevel: 'rgba(0, 0, 0, 0.2)',
    wallFace: '#df78b6',
    wallFaceDark: '#cc68a4',
    wallLip: 'rgba(255, 235, 248, 0.75)',
    wallShadow: 'rgba(110, 20, 70, 0.38)',
    floor: '#a8427f',
    gridLine: 'rgba(70, 0, 40, 0.4)',
    paintSeam: 'rgba(0, 0, 0, 0.16)',
    paint: 0xff2d8b,
    paintDark: 0xb40c5c,
    paintLight: 0xff8cc0,
    cone: 0xffc3a0,
    ambient: 'bubbles',
    ambientColor: 0xffffff,
    ui: { ink: '#b0307a', deep: '#7a1450', p1: '#ff8ac6', p2: '#ee5aa8', p3: '#c03a84', panelEdge: '#ffc0e0' },
    swatch: { slab: '#ffcde8', side: '#df78b6', floor: '#a8427f', paint: '#7a4ff0' },
    root: 349.23,
    unlock: 55,
  },
  {
    id: 'terrazzo',
    name: 'Terrazzo',
    bgTop: '#f3f1ed',
    bgBottom: '#e7e4df',
    wallTop: '#f2efea',
    bevel: 'rgba(0, 0, 0, 0.2)',
    wallFace: '#8c8782',
    wallFaceDark: '#7d7873',
    wallLip: 'rgba(255, 255, 255, 0.8)',
    wallShadow: 'rgba(20, 15, 10, 0.4)',
    floor: '#4a4644',
    gridLine: 'rgba(0, 0, 0, 0.45)',
    paintSeam: 'rgba(0, 0, 0, 0.16)',
    paint: 0xff2d8b,
    paintDark: 0xb40c5c,
    paintLight: 0xff8cc0,
    cone: 0xffc3a0,
    ambient: 'bokeh',
    ambientColor: 0xffffff,
    texture: 'terrazzo',
    ui: { ink: '#4a4644', deep: '#2b2826', p1: '#9b8fe8', p2: '#7650ef', p3: '#5534c4', panelEdge: '#ddd8d2' },
    swatch: { slab: '#f2efea', side: '#8c8782', floor: '#4a4644', paint: '#ff2d8b' },
    root: 277.18,
    unlock: 70,
  },
];
