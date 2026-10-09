import type { SlabStyle } from './slabs.ts';

export type Ambient = 'bokeh' | 'bubbles' | 'stars' | 'none';
/** The finish of the floor tiles (see tileFinish in Board). */
export type TileStyle = 'glaze' | 'scales' | 'checker' | 'circuit' | 'diamond' | 'planks' | 'mosaic' | 'marble';

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
  /** Halo hugging the edges of every opening (defaults to the face colour). */
  edgeGlow?: string;
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
  /** Finish of the floor tiles. */
  tiles?: TileStyle;
  /** Material of the page and wall tops (plain colour if none). */
  slab?: SlabStyle;
  /** Surface texture for the wall tops and floor. */
  texture?: 'wood' | 'terrazzo';
  /** Neon boards glow around the channels and around the paint. */
  neon?: { edge: number };
  /** UI colours for the HUD. */
  ui: { ink: string; deep: string; p1: string; p2: string; p3: string; panelEdge: string; /** Text right on the page (defaults to ink). */ pageInk?: string };
  /** Swatch colours for the board picker. */
  swatch: { slab: string; side: string; floor: string; paint: string };
  /** Root note (Hz) of the theme's musical scale. */
  root: number;
  /** Level at which this board unlocks in the shop. */
  unlock: number;
  /** Special: unlocked by watching this many rewarded ads (where ads run). */
  ads?: number;
}

/**
 * Every board follows the original's look, measured on Lavender: a flat page
 * that is also the wall tops, a muted wall face standing above each opening,
 * a deep floor with faint tile lines, a translucent shade under the faces
 * and a soft halo of the theme's colour round the openings. No outlines,
 * plates or textures; each theme is that same board in its own colours.
 */
function board(o: {
  id: string;
  name: string;
  page: string;
  face: string;
  floor: string;
  grid: string;
  glow: string;
  shade?: string;
  ui: Theme['ui'];
  swatchPaint: string;
  root: number;
  unlock: number;
  ads?: number;
  ambient?: Ambient;
  tiles?: TileStyle;
  slab?: SlabStyle;
}): Theme {
  return {
    id: o.id,
    name: o.name,
    bgTop: o.page,
    bgBottom: o.page,
    wallTop: o.page,
    bevel: 'rgba(0, 0, 0, 0.18)',
    wallFace: o.face,
    wallFaceDark: o.face,
    wallLip: 'rgba(255, 255, 255, 0.5)',
    wallShadow: o.shade ?? 'rgba(0, 0, 15, 0.33)',
    floor: o.floor,
    edgeGlow: o.glow,
    gridLine: o.grid,
    paintSeam: 'rgba(0, 0, 0, 0.16)',
    paint: 0xff2d8b,
    paintDark: 0xb40c5c,
    paintLight: 0xff8cc0,
    cone: 0xffc3a0,
    ambient: o.ambient ?? 'none',
    tiles: o.tiles,
    slab: o.slab,
    ambientColor: 0xffffff,
    ui: o.ui,
    swatch: { slab: o.page, side: o.face, floor: o.floor, paint: o.swatchPaint },
    root: o.root,
    unlock: o.unlock,
    ads: o.ads,
  };
}

const BASE_THEMES: Theme[] = [
  // Measured from the original game: flat lavender page, dusty violet floor,
  // a grey-violet wall face and a blue-violet halo round the openings.
  board({
    id: 'lavender', name: 'Lavender',
    page: '#ddd9fd', face: '#7370a0', floor: '#594777', grid: '#483666', glow: '#8a82ee',
    ui: { ink: '#5b3fd0', deep: '#3d2490', p1: '#9d7fff', p2: '#7650ef', p3: '#5534c4', panelEdge: '#cbbff7' },
    swatchPaint: '#ff2d8b', root: 261.63, unlock: 1,
  }),
  board({
    id: 'royal', name: 'Grape',
    page: '#7b45f2', face: '#5126c4', floor: '#3a1a92', grid: '#2f137c', glow: '#8a57f5',
    shade: 'rgba(10, 0, 40, 0.38)',
    ui: { ink: '#4a1fb8', deep: '#2e0f80', p1: '#9d7fff', p2: '#7650ef', p3: '#5534c4', panelEdge: '#cbbff7', pageInk: '#ffffff' },
    swatchPaint: '#ff2d8b', root: 246.94, unlock: 160,
  }),
  board({
    id: 'teal', name: 'Teal',
    page: '#5fdcc9', face: '#24a593', floor: '#16786b', grid: '#11655a', glow: '#8ff0e2',
    ui: { ink: '#0f7a64', deep: '#0a5244', p1: '#4fd6b4', p2: '#1fae8c', p3: '#127a62', panelEdge: '#a6ead8' },
    swatchPaint: '#ff2d8b', root: 329.63, unlock: 10,
  }),
  board({
    id: 'wood', name: 'Walnut',
    page: '#c0743c', face: '#7d4219', floor: '#6a3a1a', grid: '#552d12', glow: '#e9a061',
    shade: 'rgba(30, 10, 0, 0.36)', slab: 'walnut', tiles: 'planks',
    ui: { ink: '#7a3e12', deep: '#4e2508', p1: '#d59a5c', p2: '#b06f34', p3: '#82491c', panelEdge: '#e8c79f', pageInk: '#fff4e6' },
    swatchPaint: '#ff2d8b', root: 196, unlock: 28,
  }),
  board({
    id: 'terrazzo', name: 'Terrazzo',
    page: '#f4f1ec', face: '#a49e96', floor: '#4a4746', grid: '#3d3a39', glow: '#cfc8bf',
    slab: 'terrazzo',
    ui: { ink: '#4a4644', deep: '#2b2826', p1: '#9b8fe8', p2: '#7650ef', p3: '#5534c4', panelEdge: '#ddd8d2' },
    swatchPaint: '#ff2d8b', root: 277.18, unlock: 90,
  }),
  board({
    id: 'candy', name: 'Candy',
    page: '#f78fd0', face: '#d75aa8', floor: '#ec6fbd', grid: '#d95aa9', glow: '#ffc0e6',
    shade: 'rgba(120, 0, 70, 0.22)',
    ui: { ink: '#b0307a', deep: '#7a1450', p1: '#ff8ac6', p2: '#ee5aa8', p3: '#c03a84', panelEdge: '#ffc0e0' },
    swatchPaint: '#7a4ff0', root: 349.23, unlock: 55,
  }),
  board({
    id: 'ocean', name: 'Ocean',
    page: '#c6eff6', face: '#4b93a6', floor: '#1d5a73', grid: '#15485e', glow: '#46cdee',
    ui: { ink: '#0d6b86', deep: '#08485c', p1: '#4fd0e6', p2: '#1aa3c4', p3: '#0b7392', panelEdge: '#a6e6ef' },
    swatchPaint: '#ffa23a', root: 293.66, unlock: 135,
  }),
  board({
    id: 'birch', name: 'Birch',
    page: '#f1d1a6', face: '#c08a55', floor: '#4b2c20', grid: '#3d2219', glow: '#f6c48a',
    shade: 'rgba(30, 10, 0, 0.36)', slab: 'birch',
    ui: { ink: '#7a3e12', deep: '#4e2508', p1: '#d59a5c', p2: '#b06f34', p3: '#82491c', panelEdge: '#e8c79f' },
    swatchPaint: '#ff2d8b', root: 220, unlock: 190,
  }),
  board({
    id: 'neon', name: 'Starry',
    page: '#1f43bd', face: '#14288a', floor: '#0b1a66', grid: '#091555', glow: '#2c4fcf',
    shade: 'rgba(0, 0, 20, 0.45)', slab: 'stars',
    ui: { ink: '#2a3cb4', deep: '#13206e', p1: '#6f8dff', p2: '#3f62f0', p3: '#2a43c4', panelEdge: '#c8d4ff', pageInk: '#ffffff' },
    swatchPaint: '#2ff3ff', root: 233.08, unlock: 400,
  }),
  board({
    id: 'knit', name: 'Knit',
    page: '#ffb51f', face: '#e08700', floor: '#2c1d12', grid: '#22160d', glow: '#ffd36b',
    shade: 'rgba(20, 8, 0, 0.42)', slab: 'knit',
    ui: { ink: '#8a4a00', deep: '#5a2f00', p1: '#ffc24a', p2: '#f29a12', p3: '#c27400', panelEdge: '#ffe0a0' },
    swatchPaint: '#ff2d8b', root: 207.65, unlock: 260,
  }),
  board({
    id: 'terrawood', name: 'Terrazzo Oak',
    page: '#f4f1ec', face: '#a49e96', floor: '#b36325', grid: '#954f1a', glow: '#cfc8bf',
    shade: 'rgba(40, 15, 0, 0.32)', slab: 'terrazzo', tiles: 'planks',
    ui: { ink: '#7a3e12', deep: '#4e2508', p1: '#d59a5c', p2: '#b06f34', p3: '#82491c', panelEdge: '#e8c79f' },
    swatchPaint: '#2ff3ff', root: 311.13, unlock: 480,
  }),
  board({
    id: 'grass', name: 'Meadow',
    page: '#86c83a', face: '#4f8e1e', floor: '#4a4550', grid: '#3d3843', glow: '#c4f07a',
    shade: 'rgba(10, 20, 0, 0.36)', slab: 'grass',
    ui: { ink: '#3f7a12', deep: '#24500a', p1: '#8fd84a', p2: '#5fb22a', p3: '#3f8a18', panelEdge: '#cdeea8' },
    swatchPaint: '#ff2d8b', root: 185, unlock: 310,
  }),
];

export const THEMES: Theme[] = BASE_THEMES;
