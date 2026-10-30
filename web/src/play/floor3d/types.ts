// The shapes the 3D floor passes between its parts: the React side (no three.js) and the scene
// (scene/, the lazy chunk with three.js in it). Types, and one plain helper (sceneBenches).
import type { FloorLayout, Rect, Seat } from './layout';
import type { FloorPalette, LampGroup, StopHue } from './palette';
import type { Pose } from './rig';

/** The five role props: the Foreman's clipboard, the Builder's hammer, the Tester's flask, a Reviewer's magnifier, the Planner's ruler. */
export type PropId = 'clipboard' | 'hammer' | 'flask' | 'magnifier' | 'ruler';
export const PROPS: readonly PropId[] = ['clipboard', 'hammer', 'flask', 'magnifier', 'ruler'];

/** One figure as the scene draws it. */
export interface SceneFigure {
  /** Stable while the same agent works the same job ("<slug>:<agent type>:<n>"). */
  key: string;
  prop: PropId;
  pose: Pose;
  seat: Seat;
  /** How far a command has got (0..1), for the device's lamps; null when not known. */
  progress: number | null;
  /** The stop it works in: its badge, belt and prop accents wear that stop's hue. */
  hue: StopHue;
}

/** One bench as the scene draws it. */
export interface SceneBench {
  slug: string;
  /** Its place in the grid (bench assignment: never reshuffled). */
  index: number;
  /** The status (the words next to the bench say it). */
  lamp: LampGroup;
  /** The job's current stop: the bench's thin edge, its lamp and the icon on its front. */
  hue: StopHue;
  figures: SceneFigure[];
}

/** Where things are on screen after a frame, for the words and the pointer (px from the floor's top left). */
export interface FloorAnchors {
  benches: { slug: string; plate: Rect; cell: Rect }[];
  figures: { key: string; slug: string; rect: Rect }[];
}

export interface FrameStats {
  /** Frames drawn since the last reset. */
  frames: number;
  /** Time spent per frame on the floor's own work (moving the figures and drawing), ms. */
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Frames a second while it draws. */
  fps: number;
  /** Figures and benches on the floor. */
  figures: number;
  benches: number;
}

/** The part of a WebGLRenderer the scene uses (tests hand in a fake). */
export interface RendererLike {
  setPixelRatio(r: number): void;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  setClearColor(color: number, alpha: number): void;
  render(scene: unknown, camera: unknown): void;
  dispose(): void;
  forceContextLoss?(): void;
  shadowMap: { enabled: boolean; type: unknown; needsUpdate?: boolean; autoUpdate?: boolean };
  outputColorSpace?: unknown;
}

export interface FloorSceneOptions {
  palette: FloorPalette;
  /** Each stop's icon as SVG markup on a 24-unit grid (the app's own Icon), drawn on the benches' fronts. */
  icons?: Partial<Record<StopHue, string>>;
  reducedMotion: boolean;
  /** Tests: a fake renderer instead of WebGL. */
  makeRenderer?: (canvas: HTMLCanvasElement) => RendererLike;
  /** Tests: the clock and the frame scheduler. */
  now?: () => number;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
}

export interface FloorScene {
  setLayout(layout: FloorLayout, pixelRatio: number): void;
  setBenches(benches: readonly SceneBench[]): void;
  setPalette(palette: FloorPalette): void;
  setReducedMotion(reduced: boolean): void;
  /** The figure under the pointer, or null. */
  setHover(key: string | null): void;
  /** The pointer over the floor, -1..1 each way (a slight parallax; nothing with reduced motion). */
  setPointer(nx: number, ny: number): void;
  /** Zoom by `factor` keeping the point at (px, py) where it is, within limits. */
  zoomAt(factor: number, px: number, py: number): void;
  /** Back to the whole floor. */
  fitAll(): void;
  /** Whether it is zoomed in. */
  zoomed(): boolean;
  /** Off while the tab is hidden or the floor is scrolled out of view: nothing is drawn. */
  setActive(active: boolean): void;
  /** Called after each frame drawn, with where the words and the pointer targets go. */
  onFrame(cb: ((anchors: FloorAnchors) => void) | null): void;
  /** Keeps every figure moving (the frame-time check), instead of resting between bursts. */
  setBusy(busy: boolean): void;
  stats(reset?: boolean): FrameStats;
  dispose(): void;
}

/** One figure with its words: what the scene draws plus what the page says about it. */
export interface FloorFigure extends SceneFigure {
  /** The agent type ('conductor' for the Foreman). */
  who: string;
  /** Its role word: "Foreman", "Builder", "Tester". */
  role: string;
  /** Its now line, always shown: "Builder · reading merge.ts". */
  label: string;
}

/** One bench: a job, its status in words, and the figures at it. */
export interface FloorBench {
  slug: string;
  index: number;
  title: string;
  lamp: LampGroup;
  /** The job's status in words, with its glyph ("◆", "Go-ahead"). */
  glyph: string;
  status: string;
  /** The stop it is at ("Build"), '' when none. */
  stop: string;
  /** The same stop as an id, for its hue and icon ('none' when there is no stop). */
  hue: StopHue;
  figures: FloorFigure[];
  /** Helpers at work beyond the ones drawn. */
  more: number;
}

/** The part of a bench the scene needs. */
export function sceneBenches(benches: readonly FloorBench[]): SceneBench[] {
  return benches.map((b) => ({
    slug: b.slug,
    index: b.index,
    lamp: b.lamp,
    hue: b.hue,
    figures: b.figures.map(({ key, prop, pose, seat, progress, hue }) => ({ key, prop, pose, seat, progress, hue })),
  }));
}
