// Where everything on the 3D floor goes, worked out without three.js so the page can lay out the
// benches' words before the 3D has loaded (nothing moves when it arrives). The camera is a fixed
// three-quarter view from above with no perspective (orthographic), looking straight up the floor,
// so the benches' grid stays a grid on screen and each bench's words sit right under it.
//
// World units: a figure is about 1 tall, a bench 1.9 wide. Screen: px from the floor's top left.

/** How far above the floor the camera looks down, in radians (42°). */
export const ELEVATION = (42 * Math.PI) / 180;
/** A bench: its top's size and height. */
export const BENCH = { width: 1.9, depth: 0.62, height: 0.44 } as const;
/** One bench's cell across, in world units: the bench, the Foreman at its head, and room to walk. */
export const CELL_X = 3.3;
/** The walkway down the left, from the door to every row. */
export const AISLE = 0.55;
/** A bench's scene, top to bottom on screen (in world units seen on screen): the lamp's top to the crew's feet. */
export const SCENE_ABOVE = 1.2;
export const SCENE_BELOW = 0.68;
/** The words under each bench: its title and up to four figures' lines. */
export const PLATE_PX = 108;
export const ROW_GAP_PX = 18;
/** The door at the back: its top sits this far below the floor's top edge, and how tall it stands. */
export const WALL_TOP_PX = 10;
export const WALL_HEIGHT = 0.78;
/** Figures are never drawn bigger than this many px per world unit, however wide the floor. */
export const MAX_PPU = 132;
export const MIN_PPU = 64;

export type FloorMode = 'grid' | 'column';

export interface Rect { left: number; top: number; width: number; height: number }

export interface BenchSpot {
  index: number;
  col: number;
  row: number;
  /** The bench's centre on the floor (world). */
  x: number;
  z: number;
  /** Where its words go (px). */
  plate: Rect;
  /** The bench's whole cell on screen (px), for the pointer. */
  cell: Rect;
}

export interface FloorLayout {
  mode: FloorMode;
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** Pixels per world unit. */
  ppu: number;
  elevation: number;
  /** World x of the floor's left and right edges, and z of its back (the wall's foot) and front. */
  left: number; right: number; back: number; front: number;
  /** The door at the back, and the walkway x it opens onto. */
  door: { x: number; z: number; aisleX: number };
  rowPx: number;
  benches: BenchSpot[];
}

/** Columns for a floor this wide: 4 on a wide screen, 3, 2, and one column on a phone. */
export function columnsFor(width: number): number {
  if (width >= 1320) return 4;
  if (width >= 900) return 3;
  if (width >= 560) return 2;
  return 1;
}

/** The layout of `count` benches on a floor `width` px wide (at least one bench's room). */
export function floorLayout(width: number, count: number, cols = columnsFor(width)): FloorLayout {
  const w = Math.max(240, Math.round(width));
  const n = Math.max(1, count);
  const c = Math.max(1, Math.min(cols, n === 1 ? 1 : cols));
  const usable = w / (c * CELL_X + AISLE);
  const ppu = Math.max(MIN_PPU, Math.min(MAX_PPU, usable));
  const s = Math.sin(ELEVATION);
  const k = Math.cos(ELEVATION);
  // The door's top sits WALL_TOP_PX below the floor's top edge; its foot a little lower.
  const wallFootSy = WALL_TOP_PX / ppu + WALL_HEIGHT * k;
  const wallPx = Math.round((wallFootSy + 0.18) * ppu);
  const rowPx = Math.round((SCENE_ABOVE + SCENE_BELOW) * ppu + PLATE_PX + ROW_GAP_PX);
  const rows = Math.ceil(n / c);
  const height = wallPx + rows * rowPx;
  // Centre the grid when the floor is wider than its benches need (the size cap).
  const gridW = (c * CELL_X + AISLE) * ppu;
  const x0 = (w - gridW) / 2 + AISLE * ppu;
  const cellW = CELL_X * ppu;
  const benches: BenchSpot[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % c;
    const row = Math.floor(i / c);
    const rowTop = wallPx + row * rowPx;
    const cx = x0 + (col + 0.5) * cellW;
    const cy = rowTop + SCENE_ABOVE * ppu;
    const pad = Math.min(14, cellW * 0.05);
    benches.push({
      index: i, col, row,
      x: (cx - w / 2) / ppu,
      z: cy / ppu / s,
      plate: { left: Math.round(x0 + col * cellW + pad), top: Math.round(rowTop + (SCENE_ABOVE + SCENE_BELOW) * ppu), width: Math.round(cellW - pad * 2), height: PLATE_PX },
      cell: { left: Math.round(x0 + col * cellW), top: rowTop, width: Math.round(cellW), height: rowPx - ROW_GAP_PX },
    });
  }
  const left = (x0 - AISLE * ppu - w / 2) / ppu + 0.08;
  const right = (x0 + c * cellW - w / 2) / ppu - 0.08;
  // The floor reaches a little behind the door, so the door stands on it.
  const back = wallFootSy / s - 0.34;
  const front = (height - 6) / ppu / s + 0.2;
  return {
    mode: c === 1 ? 'column' : 'grid',
    width: w, height, cols: c, rows, ppu, elevation: ELEVATION,
    left, right, back, front,
    door: { x: left + AISLE / 2 + 0.32, z: back + 0.3, aisleX: left + AISLE / 2 },
    rowPx, benches,
  };
}

/** The Stage strip's fixed height (px). */
export const STRIP_PX = 220;

/**
 * The Stage strip (StageStrip.tsx): one bench in a band `height` px tall, the bench and its crew on
 * the left on their own patch of floor, and its words to the right. The same camera as the floor,
 * scaled to fit the band; the door stands at the patch's back left, so helpers still walk in.
 */
export function stripLayout(width: number, height = STRIP_PX): FloorLayout {
  const w = Math.max(240, Math.round(width));
  const s = Math.sin(ELEVATION);
  const k = Math.cos(ELEVATION);
  const scene = SCENE_ABOVE + SCENE_BELOW;
  // Wide: the bench fills the band's height on the left, the words to its right. Narrow (a phone):
  // a smaller bench across the top, and the words full width under it, so no line is cut short.
  const narrow = w < 720;
  const ppu = narrow
    ? Math.max(40, Math.min((height * 0.48) / scene, (w - 24) / (CELL_X + AISLE)))
    : Math.max(48, Math.min(MAX_PPU, (height - 14) / (scene + 0.12)));
  const cellW = CELL_X * ppu;
  const x0 = narrow ? (w - cellW - AISLE * ppu) / 2 + AISLE * ppu : 8 + AISLE * ppu;
  const cx = x0 + cellW / 2;
  const cy = (narrow ? 4 : 6) + SCENE_ABOVE * ppu;
  const sceneBottom = cy + SCENE_BELOW * ppu;
  const wordsLeft = Math.round(x0 + cellW + 12);
  const plate: Rect = narrow
    ? { left: 12, top: Math.round(sceneBottom + 6), width: w - 24, height: Math.round(height - sceneBottom - 10) }
    // Room on the right for the strip's Fold button.
    : { left: wordsLeft, top: 18, width: Math.max(120, w - wordsLeft - 112), height: height - 36 };
  const bench: BenchSpot = {
    index: 0, col: 0, row: 0,
    x: (cx - w / 2) / ppu,
    z: cy / ppu / s,
    plate,
    cell: { left: Math.round(x0 - AISLE * ppu), top: 0, width: Math.round(cellW + AISLE * ppu), height: Math.round(narrow ? sceneBottom : height) },
  };
  const left = (x0 - AISLE * ppu - (narrow ? 0 : 8) - w / 2) / ppu;
  const right = (x0 + cellW - w / 2) / ppu;
  // The patch of floor fills the band from its top (on a phone, down to the words); the door
  // stands on it, its top just inside.
  const back = -0.05;
  const doorZ = (WALL_HEIGHT * k + 6 / ppu) / s;
  const front = (narrow ? sceneBottom : height) / ppu / s + (narrow ? 0 : 0.2);
  return {
    mode: 'column', width: w, height, cols: 1, rows: 1, ppu, elevation: ELEVATION,
    left, right, back, front,
    door: { x: left + AISLE / 2 + 0.32, z: doorZ, aisleX: left + AISLE / 2 },
    rowPx: height, benches: [bench],
  };
}

/** A world point on screen (px), as the scene's camera sees it at rest. */
export function project(layout: FloorLayout, x: number, y: number, z: number): { x: number; y: number } {
  const s = Math.sin(layout.elevation);
  const k = Math.cos(layout.elevation);
  return { x: x * layout.ppu + layout.width / 2, y: (z * s - y * k) * layout.ppu };
}

/** The camera's frustum at rest, in world units (the scene's OrthographicCamera takes these). */
export function frustum(layout: FloorLayout) {
  const halfW = layout.width / 2 / layout.ppu;
  return { left: -halfW, right: halfW, top: 0, bottom: -layout.height / layout.ppu };
}

// ---------- Where each figure stands at its bench ----------

export type Seat = 'head' | 0 | 1 | 2;
export interface SeatSpot {
  /** Relative to the bench's centre. */
  x: number;
  z: number;
  /** Facing the bench, and facing you (radians; 0 faces the camera). */
  yawBench: number;
  yawYou: number;
}

/** At most this many helpers stand at a bench; the words count the rest. */
export const MAX_HELPERS = 3;

const HELPER_X: Record<number, number[]> = { 1: [0.1], 2: [-0.32, 0.5], 3: [-0.52, 0.1, 0.72] };

/** How far forward a helper comes to sit: from behind the bench round to a crate in front of it. */
export const SIT_DZ = 1.1;

/**
 * Where a figure stands: the Foreman at the bench's head (left end, side on, looking along it),
 * helpers behind the bench facing you across it, like makers at a counter, so their hands, props
 * and work show. To sit (stopped, paused) a helper walks round to the front.
 */
export function seatSpot(seat: Seat, helpers: number): SeatSpot {
  if (seat === 'head') return { x: -1.32, z: 0.02, yawBench: Math.PI / 2, yawYou: 0.42 };
  const xs = HELPER_X[Math.max(1, Math.min(MAX_HELPERS, helpers))] ?? HELPER_X[1];
  const x = xs[Math.min(seat, xs.length - 1)];
  return { x, z: -0.56, yawBench: -x * 0.14, yawYou: -x * 0.06 };
}

/** The way round the bench's right end between a helper's spot behind it and its crate in front. */
export function aroundPath(spot: { x: number; z: number }, toFront: boolean): { x: number; z: number }[] {
  const endX = 1.3;
  const behind = { x: spot.x, z: spot.z };
  const front = { x: spot.x, z: spot.z + SIT_DZ };
  const pts = [behind, { x: endX, z: spot.z }, { x: endX, z: front.z }, front];
  return toFront ? pts : pts.reverse();
}
