// The scene kit: every shape on the floor, built in code (no model files, no textures fetched), and
// the materials they wear, all coloured from the theme (palette.ts). One set of geometries and
// materials is shared by every figure and bench, so a theme change recolours the whole floor by
// updating a few materials in place, and leaving disposes everything in one go.
//
// The figure, station crew about 1 unit tall: a suited body 0.66 tall and 0.47 wide with a small
// life-support pack on its back, a round helmet 0.35 across whose dark visor stands in for a face
// (they stay nameless and faceless; the visor marks the front), and two gloved hands that float at
// its sides. A patch on its left shoulder wears the hue of the stop it works in. Its role is the
// Starbase tool in its right hand: a holo-slate, a welder, a scanner, an inspection lens or a
// holo-tablet showing a blueprint.
import {
  BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, ExtrudeGeometry, Group,
  HemisphereLight, DirectionalLight, Float32BufferAttribute, LatheGeometry, LinearFilter, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  OctahedronGeometry, Object3D, PlaneGeometry, Points, PointsMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace, Shape, ShapeGeometry, ShadowMaterial, SphereGeometry, SplineCurve, TorusGeometry, Vector2, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BAY_ICON, PLATES_ON, type BayAlert, type BayKind, type BuildPhase, type SectionState } from '../bays';
import type { SceneSection } from '../types';
import type { FloorLayout } from '../layout';
import { AIRLOCK, BENCH, WALL_HEIGHT } from '../layout';
import type { FloorPalette, LampGroup, Rgb, StopHue } from '../palette';
import { mix as mixRgb, STOP_HUES } from '../palette';
import type { PropId } from '../types';

const LAMP_GROUPS: readonly LampGroup[] = ['needs-you', 'running', 'paused', 'idle', 'shipping', 'done'];

/** Body proportions (world units). */
export const FIGURE = {
  bodyHeight: 0.66,
  bodyRadius: 0.236,
  headRadius: 0.172,
  /** The gap between body and head. */
  neck: 0.022,
  handRadius: 0.058,
} as const;
export const HEAD_Y = FIGURE.bodyHeight + FIGURE.neck;
/** The floor's thickness. */
const EDGE = 0.13;

function setColor(c: Color, rgb: Rgb) { c.setRGB(rgb.r, rgb.g, rgb.b, SRGBColorSpace); }

/** The attributes of one SVG element's markup. */
function attrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/**
 * A stop's icon (the app's own Icon markup: paths, circles, rects and lines on a 24-unit grid),
 * stroked in white into a small texture, so the material's colour inks it. Null where the browser
 * can't draw paths (tests).
 */
export function iconTexture(markup: string, size = 128): CanvasTexture | null {
  if (typeof Path2D === 'undefined' || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const pad = size * 0.06;
  const k = (size - pad * 2) / 24;
  ctx.setTransform(k, 0, 0, k, pad, pad);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of markup.matchAll(/<(path|circle|rect|line|polyline|ellipse)\b([^>]*)>/g)) {
    const a = attrs(m[2]);
    const n = (key: string, d = 0) => (a[key] !== undefined ? parseFloat(a[key]) : d);
    let path: Path2D;
    if (m[1] === 'path') path = new Path2D(a.d ?? '');
    else {
      path = new Path2D();
      if (m[1] === 'circle') path.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2);
      else if (m[1] === 'ellipse') path.ellipse(n('cx'), n('cy'), n('rx'), n('ry'), 0, 0, Math.PI * 2);
      else if (m[1] === 'rect') {
        const x = n('x'); const y = n('y'); const w = n('width'); const h = n('height'); const r = Math.min(n('rx'), w / 2, h / 2);
        if (r > 0 && typeof path.roundRect === 'function') path.roundRect(x, y, w, h, r); else path.rect(x, y, w, h);
      } else if (m[1] === 'line') { path.moveTo(n('x1'), n('y1')); path.lineTo(n('x2'), n('y2')); }
      else {
        const pts = (a.points ?? '').trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i + 1 < pts.length; i += 2) (i ? path.lineTo(pts[i], pts[i + 1]) : path.moveTo(pts[i], pts[i + 1]));
      }
    }
    ctx.stroke(path);
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A soft rim light, in the material's own shader: surfaces turning away from you catch a little
 * light at their edge, so a figure stands clear of the floor even where both are pale. The colour
 * and strength are shared (one uniform for every material), set from the palette.
 */
function withRim<T extends MeshLambertMaterial>(mat: T, rim: { value: Color }, edge: { value: number }): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rim;
    shader.uniforms.uEdge = edge;
    // f: how far the surface turns away from you (1 at the outline). Up-facing edges catch the rim;
    // the sides take a soft shade (uEdge), which draws a quiet outline on a pale floor.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uEdge;')
      .replace('#include <opaque_fragment>', [
        'vec3 nV = normalize(normal);',
        'float fr = pow(1.0 - clamp(abs(nV.z), 0.0, 1.0), 2.2);',
        'float up = clamp(nV.y * 1.4, 0.0, 1.0);',
        'outgoingLight += uRim * fr * up;',
        'outgoingLight *= 1.0 - uEdge * fr * (1.0 - up);',
        '#include <opaque_fragment>',
      ].join('\n'));
  };
  mat.customProgramCacheKey = () => 'floor-rim';
  return mat;
}

/** A soft round shadow, drawn into a small texture in code. */
function blobTexture(): DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n * 2 - 1;
      const dy = (y + 0.5) / n * 2 - 1;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = (1 - d * d) ** 2.2;
      const i = (y * n + x) * 4;
      // alphaMap reads the green channel.
      const v = Math.round(a * 255);
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, n, n, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** An alpha map drawn in code (the green channel is read): value(x, y) is 0..1 on an n×m grid. */
function alphaTexture(n: number, m: number, value: (x: number, y: number) => number, repeat = false): DataTexture {
  const data = new Uint8Array(n * m * 4);
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < n; x++) {
      const v = Math.round(Math.min(1, Math.max(0, value(x, y))) * 255);
      const i = (y * n + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, n, m, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  if (repeat) { t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

/** The deck's panel seams: a thin line round each 1×1 panel, and a fainter one across its middle. */
const deckTexture = () => alphaTexture(64, 64, (x, y) => {
  const edge = Math.min(x, y, 63 - x, 63 - y);
  if (edge < 1) return 1;
  return Math.abs(x - 31.5) < 0.6 || Math.abs(y - 31.5) < 0.6 ? 0.35 : 0;
}, true);

/** Hazard stripes, on the diagonal, for the repair docks' floor. */
const stripeTexture = () => alphaTexture(32, 32, (x, y) => (((x + y) % 32) < 16 ? 1 : 0), true);

/** The body's outline, turned on a lathe: a soft bean, a little fuller low down, rounded on top. */
function bodyProfile(): Vector2[] {
  const H = FIGURE.bodyHeight;
  const R = FIGURE.bodyRadius;
  const ctrl = [
    [0.0, 0], [0.62, 0.0], [0.86, 0.025], [0.97, 0.11], [1.0, 0.27], [0.975, 0.5], [0.9, 0.7], [0.74, 0.86], [0.46, 0.965], [0.0, 1],
  ].map(([r, y]) => new Vector2(r * R, y * H));
  const pts = new SplineCurve(ctrl).getPoints(30);
  pts[0] = new Vector2(0, 0);
  pts[pts.length - 1] = new Vector2(0, H);
  return pts.map((p) => new Vector2(Math.max(0, p.x), p.y));
}

// ---------- The station's shapes (packet SB) ----------

/** The module's centre height in a construction bay (its flat top at about the work height), and the craft's in a repair dock. */
const MODULE_Y = 0.232;
/** The module's length (model.ts MODULE_LENGTH, where a stack's sections and their crews stand). */
const MODULE_LEN = 1.62;
const CRAFT_Y = 0.27;
/** Where the repair arm's head is, and the damaged panel it points at. */
const ARM_TIP = { x: 0.34, y: 0.5, z: 0.5 };
const PANEL_AT = { x: 0.05, y: CRAFT_Y + 0.02, z: 0.23 };

type Pt = { x: number; y: number; z: number };

/** A box of thickness t from a to b (a strut, a brace, an arm), as geometry. */
function strut(a: Pt, b: Pt, t: number): BufferGeometry {
  const d = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = d.length();
  const geo = new BoxGeometry(t, len, t);
  const m = new Mesh(geo);
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
  m.updateMatrix();
  geo.applyMatrix4(m.matrix);
  return geo;
}

/** A box w×h×d centred at (x, y, z), as geometry. */
const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number) => new BoxGeometry(w, h, d).translate(x, y, z);

/** Stretches a unit-long mesh (along y) from a to b. */
function placeBetween(m: Mesh, a: Pt, b: Pt) {
  const d = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  m.scale.set(1, d.length(), 1);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
}

/** The sparks round the repair point at time t (ms): a small burst that turns over every 90 ms; still at t = 0. */
function placeSparks(sparks: Group, t: number) {
  const tick = Math.floor(t / 90);
  for (const c of sparks.children) {
    const i = c.userData.seed as number;
    const a = i * 0.9 + tick * 1.7 * (i % 2 ? 1 : -1);
    const r = 0.035 + (((i * 37 + tick * 13) % 5) * 0.014);
    c.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.8 + 0.02, 0.03 + (i % 3) * 0.012);
    const k = 0.6 + ((i * 7 + tick) % 4) * 0.2;
    c.scale.setScalar(k);
  }
}

/** A disc of radius R round c, cut to the rectangle [x0, x1] × [y0, y1] (Sutherland–Hodgman), as a Shape; null if they don't meet. */
function planetShape(c: { x: number; y: number }, R: number, x0: number, x1: number, y0: number, y1: number): Shape | null {
  let poly = Array.from({ length: 96 }, (_, i) => ({ x: c.x + R * Math.cos((i / 96) * Math.PI * 2), y: c.y + R * Math.sin((i / 96) * Math.PI * 2) }));
  const clip = (inside: (p: { x: number; y: number }) => boolean, cut: (a: { x: number; y: number }, b: { x: number; y: number }) => { x: number; y: number }) => {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    poly = out;
  };
  const atX = (x: number) => (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
  const atY = (y: number) => (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });
  clip((p) => p.x >= x0, atX(x0));
  clip((p) => p.x <= x1, atX(x1));
  clip((p) => p.y >= y0, atY(y0));
  clip((p) => p.y <= y1, atY(y1));
  if (poly.length < 3) return null;
  const s = new Shape();
  s.moveTo(poly[0].x, poly[0].y);
  for (const p of poly.slice(1)) s.lineTo(p.x, p.y);
  s.closePath();
  return s;
}

/** The craft's hull, turned on a lathe along y (nose at +y), then laid along x. */
function hullProfile(): Vector2[] {
  return [[0, -0.86], [0.13, -0.86], [0.18, -0.8], [0.215, -0.55], [0.222, -0.1], [0.205, 0.25], [0.165, 0.52], [0.1, 0.74], [0.03, 0.86], [0, 0.88]]
    .map(([r, y]) => new Vector2(r, y));
}

/** Every shape the bays and their craft are built from: built once, shared by every bay. */
function stationShapes(g: <T extends BufferGeometry>(geo: T) => T, rb: (w: number, h: number, d: number, r: number, seg?: number) => BufferGeometry) {
  const merged = (parts: BufferGeometry[]) => {
    const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
    const out = mergeGeometries(flat, false);
    for (const p of [...parts, ...flat]) p.dispose();
    return g(out as BufferGeometry);
  };
  const hex = (r: number, len: number) => new CylinderGeometry(r, r, len, 6).rotateZ(Math.PI / 2);
  const ring = (r: number, t: number) => new TorusGeometry(r, t, 4, 6).rotateY(Math.PI / 2);
  // The hex's six corners round the x axis, in (y, z) (front corner first).
  const corners = (r: number) => Array.from({ length: 6 }, (_, i) => ({ y: r * Math.sin((i * Math.PI) / 3), z: r * Math.cos((i * Math.PI) / 3) }));
  const SX = 1.0;
  const SZ = 0.38;
  return {
    pad: rb(2.8, 0.032, 1.5, 0.016, 2),
    padRim: rb(0.9, 0.02, 0.05, 0.01, 1),
    bayBlob: g(new PlaneGeometry(2.6, 1.4).rotateX(-Math.PI / 2)),
    signPost: g(new CylinderGeometry(0.014, 0.016, 0.12, 10)),
    bayBoard: rb(0.56, 0.27, 0.03, 0.04, 2),
    // A construction bay's module.
    core: g(hex(0.2, 1.62)),
    sleeve: g(hex(0.258, 0.385)),
    skeleton: merged([
      ...[-0.81, 0, 0.81].map((x) => ring(0.25, 0.013).translate(x, 0, 0)),
      ...corners(0.25).map((c) => new BoxGeometry(1.62, 0.02, 0.02).translate(0, c.y, c.z)),
    ]),
    windows: merged([-0.6, -0.2, 0.2, 0.6].flatMap((x) => [-0.07, 0.07].map((dx) => {
      const r = 0.258;
      return new BoxGeometry(0.07, 0.05, 0.012).rotateX(-Math.PI / 6).translate(x + dx, 0.433 * r + 0.003, 0.75 * r + 0.005);
    }))),
    caps: merged([
      ...[-0.82, 0.82].map((x) => ring(0.205, 0.035).translate(x, 0, 0)),
      ...[-0.85, 0.85].map((x) => hex(0.17, 0.05).translate(x, 0, 0)),
    ]),
    scaffold: merged([
      ...[-SX, SX].map((x) => boxAt(0.045, 1.0, 0.045, x, 0.5, SZ)),
      ...[-SX, SX].map((x) => boxAt(0.05, 1.38, 0.05, x, 0.69, -SZ)),
      boxAt(2.08, 0.06, 0.06, 0, 1.36, -SZ),
      ...[-SX, SX].map((x) => boxAt(0.035, 0.035, SZ * 2, x, 0.98, 0)),
      ...[-SX, SX].flatMap((x) => [strut({ x, y: 0.06, z: SZ }, { x, y: 0.94, z: -SZ }, 0.024), strut({ x, y: 0.06, z: -SZ }, { x, y: 0.94, z: SZ }, 0.024)]),
      ...[-SX, SX].flatMap((x) => [-SZ, SZ].map((z) => boxAt(0.12, 0.02, 0.12, x, 0.01, z))),
    ]),
    heldPlate: rb(0.36, 0.028, 0.24, 0.01, 1),
    trolley: rb(0.16, 0.08, 0.12, 0.02, 1),
    boom: g(new BoxGeometry(0.04, 0.04, 0.38)),
    cable: g(new BoxGeometry(0.01, 0.42, 0.01)),
    hook: g(new TorusGeometry(0.03, 0.009, 6, 12, Math.PI * 1.3)),
    lampHeads: merged([-SX, SX].map((x) => boxAt(0.11, 0.07, 0.1, x, 1.03, SZ))),
    lampGlow: merged([-SX, SX].map((x) => boxAt(0.08, 0.04, 0.012, x, 1.03, SZ + 0.052))),
    pool: g(new PlaneGeometry(2.3, 1.2).rotateX(-Math.PI / 2)),
    // A repair dock.
    hazardBase: g(new PlaneGeometry(2.7, 0.16).rotateX(-Math.PI / 2)),
    hazardStripes: g(new PlaneGeometry(2.7, 0.16).rotateX(-Math.PI / 2)),
    cradle: merged([
      ...[-0.42, 0.42].map((x) => boxAt(0.16, 0.1, 0.46, x, 0.05, 0)),
      ...[-1.05, 1.05].flatMap((x) => [-0.3, 0.3].map((z) => boxAt(0.05, 0.5, 0.05, x, 0.25, z))),
      ...[-1.05, 1.05].map((x) => boxAt(0.05, 0.05, 0.65, x, 0.5, 0)),
      ...[-1.05, 1.05].map((x) => boxAt(0.12, 0.04, 0.04, x - Math.sign(x) * 0.07, 0.36, 0)),
    ]),
    hull: g(new LatheGeometry(hullProfile(), 28).rotateZ(-Math.PI / 2)),
    canopy: g(new SphereGeometry(0.1, 20, 12).scale(2.1, 0.95, 1.2)),
    fins: merged([
      new BoxGeometry(0.34, 0.022, 0.24).rotateY(0.45).translate(-0.6, -0.04, 0.3),
      new BoxGeometry(0.34, 0.022, 0.24).rotateY(-0.45).translate(-0.6, -0.04, -0.3),
      new BoxGeometry(0.3, 0.18, 0.022).rotateZ(0.35).translate(-0.62, 0.26, 0),
    ]),
    engine: g(new CylinderGeometry(0.1, 0.13, 0.1, 20).rotateZ(Math.PI / 2)),
    navLights: merged([
      new SphereGeometry(0.022, 10, 8).translate(-0.7, -0.03, 0.43),
      new SphereGeometry(0.022, 10, 8).translate(-0.7, -0.03, -0.43),
      new SphereGeometry(0.022, 10, 8).translate(-0.7, 0.35, 0),
      new CylinderGeometry(0.085, 0.085, 0.012, 20).rotateZ(Math.PI / 2).translate(-0.94, 0, 0),
    ]),
    damage: rb(0.3, 0.15, 0.024, 0.02, 1),
    patchPlate: rb(0.32, 0.16, 0.028, 0.02, 1),
    repairArm: merged([
      new CylinderGeometry(0.09, 0.1, 0.05, 18).translate(1.08, 0.025, 0.56),
      boxAt(0.05, 0.48, 0.05, 1.08, 0.27, 0.56),
      new SphereGeometry(0.04, 12, 8).translate(1.08, 0.51, 0.56),
      strut({ x: 1.08, y: 0.51, z: 0.56 }, ARM_TIP, 0.045),
    ]),
    armHead: rb(0.08, 0.07, 0.08, 0.02, 1),
    beam: g(new CylinderGeometry(0.008, 0.008, 1, 8)),
    spark: g(new OctahedronGeometry(0.016)),
    halo: g(new SphereGeometry(0.11, 18, 12)),
    sectionUnit: g(hex(0.258, 1)),
    sectionRing: g(ring(0.262, 0.012)),
  };
}

/** A figure's parts, as the scene moves them. */
export interface FigureParts {
  /** At the figure's spot; never turns. */
  anchor: Group;
  /** Turns and walks. */
  root: Group;
  blob: Mesh;
  body: Group;
  torso: Mesh;
  headPivot: Group;
  handL: Group;
  handR: Group;
  prop: Group;
  sheet: Group;
  card: Group;
  crate: Group;
  sign: Group;
  clock: Group;
  /** Things on the bench in front of it, in its bench-facing frame. */
  items: Group;
  device: Group;
  crank: Group;
  lamps: Mesh[];
  workpiece: Group;
  stack: Group;
  /** The meshes that wear the figure's stop hue (the shoulder patch, the pack's light, the tool's glow). */
  hued: Mesh[];
  /** The free (left) hand's meshes: needs-you amber while it is raised to wait for you. */
  freeHand: Mesh[];
}

/** One bay: a construction bay (a module in a scaffold) or a repair dock (a craft in a dry dock). */
export interface BayParts {
  kind: BayKind;
  group: Group;
  /** The beacon's lamp at the back right corner. */
  bulb: Mesh;
  /** The thin rim round the pad, the stop's tile on the sign and its icon: the job's stop. */
  edge: Mesh;
  tag: Mesh;
  icon: Mesh;
  /** What is built or mended, as a whole: it lifts away (launch) or slides out (undock) when done. */
  work: Group;
  /** A construction bay's module: its hull sections (in order), its frame, its lit windows and docking rings; the crane and the plate it holds. */
  sleeves: Mesh[];
  skeleton: Mesh | null;
  windows: Mesh | null;
  caps: Mesh | null;
  crane: Group | null;
  heldPlate: Mesh | null;
  /** The cool work lights and the pool of light they cast on the pad. */
  lights: Mesh[];
  /** A repair dock's craft: its damaged panel, the patch, the repair beam, the sparks, its running lights. */
  damage: Group | null;
  patch: Mesh | null;
  beam: Mesh | null;
  sparks: Group | null;
  navLights: Mesh | null;
  /** The beacon's glow round its lamp (needs you, stopped), which pulses slowly while it waits for you. */
  halo: Mesh;
  /** A stack's module: one section per part, and a frame ring round each. */
  sections: Mesh[];
  sectionRings: Mesh[];
  /** What the bay signals now, and its stop's hue (the beacon wears the hue while it simply works). */
  alert: BayAlert | null;
  hue: StopHue;
  phase: BuildPhase | null;
}

export interface Kit {
  makeFigure(prop: PropId, hue: StopHue): FigureParts;
  makeBay(kind: BayKind): BayParts;
  /** Dress a figure in a stop's hue. */
  hueFigure(parts: FigureParts, hue: StopHue): void;
  /** Dress a bay in its job's stop: the pad's rim, the stop's tile and its icon, and the beacon. */
  hueBay(parts: BayParts, hue: StopHue): void;
  /** Show the work as far as it has got: the module's frame, plates, lights and polish; or the damage, the repair and the clean panel. */
  phaseBay(parts: BayParts, phase: BuildPhase): void;
  /** The free hand in needs-you amber (waiting for you) or in clay. */
  raiseHand(parts: FigureParts, waiting: boolean): void;
  /** The deck, its edge, the back wall with its windows on space, and the airlock, sized for a layout (rebuilt when it changes). */
  makeRoom(layout: FloorLayout): Group;
  /** Open the airlock's two leaves, 0 (shut) to 1 (open). */
  openAirlock(k: number): void;
  /** A repair's sparks at time t (ms): t < 0 hides them between bursts; null holds them still (reduced motion). */
  sparkBay(parts: BayParts, t: number | null): void;
  /** What the bay signals: the beacon's colour and glow, the work lights dimmed for a pause. */
  alertBay(parts: BayParts, alert: BayAlert | null): void;
  /** The beacon's slow pulse, 0..1 through one breath (0: at rest). */
  pulseBay(parts: BayParts, u: number): void;
  /** A stack's module: a section per part, each in its state (null: a single job's module). */
  sectionBay(parts: BayParts, sections: readonly SceneSection[] | null): void;
  lights(): { hemi: HemisphereLight; sun: DirectionalLight; rim: DirectionalLight };
  lampMaterial(group: LampGroup): Material;
  deviceLamp(on: boolean): Material;
  setPalette(p: FloorPalette): void;
  /** Everything the kit has made: geometries, materials, textures. */
  disposables(): { dispose(): void }[];
  dispose(): void;
}

export function createKit(palette: FloorPalette, icons: Partial<Record<StopHue, string>> = {}): Kit {
  const geos: BufferGeometry[] = [];
  const roomGeos: BufferGeometry[] = [];
  const g = <T extends BufferGeometry>(geo: T): T => { geos.push(geo); return geo; };
  const rb = (w: number, h: number, d: number, r: number, seg = 2) => g(new RoundedBoxGeometry(w, h, d, seg, r));

  // ---------- Materials ----------
  const lambert = () => new MeshLambertMaterial();
  const rimUniform = { value: new Color(0, 0, 0) };
  const edgeUniform = { value: 0 };
  const rimmed = () => withRim(new MeshLambertMaterial(), rimUniform, edgeUniform);
  const mats = {
    clay: rimmed(), helmet: rimmed(), visor: lambert(), glove: rimmed(), badge: lambert(), benchFront: lambert(), benchTop: new MeshLambertMaterial({ vertexColors: true }), paper: lambert(), ink: lambert(), metal: lambert(), handle: lambert(),
    liquid: lambert(), bench: lambert(), benchLeg: lambert(), crate: lambert(), wall: lambert(), doorFrame: lambert(),
    stop: lambert(), ask: lambert(), lampOff: lambert(),
    glass: new MeshLambertMaterial({ transparent: true, opacity: 0.42, depthWrite: false }),
    floor: new MeshBasicMaterial(),
    floorEdge: new MeshBasicMaterial(),
    doorway: new MeshBasicMaterial(),
    catcher: new ShadowMaterial({ transparent: true }),
    visorShine: new MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }),
    holoLine: new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
    blob: new MeshBasicMaterial({ transparent: true, depthWrite: false }),
    // The station.
    deckLine: new MeshBasicMaterial({ transparent: true, depthWrite: false }),
    pad: lambert(), padSide: lambert(), signBoard: lambert(), scaffold: lambert(), frame: lambert(),
    plate: rimmed(), plateBright: rimmed(), plateDark: lambert(), hull: rimmed(), damage: lambert(), patch: rimmed(),
    hazardBase: lambert(),
    hazard: new MeshBasicMaterial({ transparent: true, depthWrite: false }),
    workLight: new MeshBasicMaterial(),
    pool: new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.2 }),
    spark: new MeshBasicMaterial(),
    beam: new MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false }),
    space: new MeshBasicMaterial(),
    planet: new MeshBasicMaterial(),
    planetRim: new MeshBasicMaterial(),
    windowFrame: lambert(),
    shaft: new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.16 }),
    star: new PointsMaterial({ size: 2, sizeAttenuation: false, depthWrite: false }),
    beaconWarn: new MeshBasicMaterial(),
    beaconStop: new MeshBasicMaterial(),
    haloWarn: new MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false }),
    haloStop: new MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }),
    ghost: new MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
  };
  const deckTex = deckTexture();
  mats.deckLine.alphaMap = deckTex;
  const stripeTex = stripeTexture();
  stripeTex.repeat.set(16, 1);
  mats.hazard.alphaMap = stripeTex;
  const poolTex = blobTexture();
  mats.pool.alphaMap = poolTex;
  mats.shaft.alphaMap = poolTex;
  // The bays' kind signs: a plus in a hexagon (a construction bay), a wrench (a repair dock), inked on the sign.
  const kindTex = { build: iconTexture(BAY_ICON.build), repair: iconTexture(BAY_ICON.repair) };
  const kindMats = {
    build: new MeshBasicMaterial({ map: kindTex.build, transparent: true, depthWrite: false, visible: Boolean(kindTex.build) }),
    repair: new MeshBasicMaterial({ map: kindTex.repair, transparent: true, depthWrite: false, visible: Boolean(kindTex.repair) }),
  };
  mats.paper.side = DoubleSide;
  const blobTex = blobTexture();
  mats.blob.alphaMap = blobTex;
  const lampMats = Object.fromEntries(LAMP_GROUPS.map((k) => [k, new MeshBasicMaterial()])) as Record<LampGroup, MeshBasicMaterial>;
  // Each stop's hue: the figures' accents (lit, with the rim), the benches' lamps (glowing), and the
  // stop's icon on each bench's tag.
  const hueMats = Object.fromEntries(STOP_HUES.map((k) => [k, rimmed()])) as Record<StopHue, MeshLambertMaterial>;
  const glowMats = Object.fromEntries(STOP_HUES.map((k) => [k, new MeshBasicMaterial()])) as Record<StopHue, MeshBasicMaterial>;
  const iconTex: Partial<Record<StopHue, CanvasTexture>> = {};
  const iconMats = Object.fromEntries(STOP_HUES.map((k) => {
    const tex = icons[k] ? iconTexture(icons[k] as string) : null;
    if (tex) iconTex[k] = tex;
    return [k, new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, visible: Boolean(tex) })];
  })) as Record<StopHue, MeshBasicMaterial>;
  const hemi = new HemisphereLight(0xffffff, 0xffffff, 1);
  const sun = new DirectionalLight(0xffffff, 1);
  const rim = new DirectionalLight(0xffffff, 1);

  // Parts of the room drawn only at night (stars, the planet) or by day (shafts of daylight).
  let scheme: 'light' | 'dark' = palette.scheme;
  const nightOnly: Object3D[] = [];
  const dayOnly: Object3D[] = [];
  function setPalette(p: FloorPalette) {
    setColor(mats.clay.color, p.clay);
    setColor(mats.helmet.color, p.helmet);
    setColor(mats.visor.color, p.visor);
    setColor(mats.visorShine.color, p.visorShine);
    setColor(mats.glove.color, p.glove);
    setColor(mats.holoLine.color, p.holoLine);
    setColor(mats.badge.color, p.badge);
    setColor(mats.paper.color, p.paper);
    setColor(mats.ink.color, p.ink);
    setColor(mats.metal.color, p.metal);
    setColor(mats.handle.color, p.handle);
    setColor(mats.liquid.color, p.liquid);
    setColor(mats.glass.color, p.glass);
    setColor(mats.bench.color, p.bench);
    setColor(mats.benchTop.color, p.bench);
    setColor(mats.benchLeg.color, p.benchLeg);
    setColor(mats.crate.color, p.crate);
    setColor(mats.wall.color, p.wall);
    setColor(mats.doorFrame.color, p.doorFrame);
    setColor(mats.stop.color, p.stop);
    setColor(mats.ask.color, p.ask);
    setColor(mats.lampOff.color, p.benchLeg);
    setColor(mats.floor.color, p.floor);
    setColor(mats.floorEdge.color, p.floorEdge);
    setColor(mats.doorway.color, p.doorway);
    setColor(mats.catcher.color, p.shadow);
    mats.catcher.opacity = p.shadowStrength;
    setColor(mats.blob.color, p.shadow);
    mats.blob.opacity = Math.min(1, p.shadowStrength * 1.5);
    setColor(mats.benchFront.color, p.benchFront);
    for (const k of LAMP_GROUPS) setColor(lampMats[k].color, p.lamp[k]);
    setColor(mats.deckLine.color, p.deckLine);
    mats.deckLine.opacity = p.scheme === 'dark' ? 0.55 : 0.5;
    setColor(mats.pad.color, p.pad);
    setColor(mats.padSide.color, p.padEdge);
    setColor(mats.signBoard.color, p.paper);
    setColor(mats.scaffold.color, p.scaffold);
    setColor(mats.frame.color, p.frame);
    setColor(mats.plate.color, p.plate);
    setColor(mats.plateBright.color, mixRgb(p.plate, p.paper, 0.45));
    setColor(mats.plateDark.color, p.plateDark);
    setColor(mats.hull.color, p.hull);
    setColor(mats.damage.color, p.damage);
    setColor(mats.patch.color, p.patch);
    setColor(mats.hazardBase.color, p.hazardDark);
    setColor(mats.hazard.color, p.hazard);
    setColor(mats.workLight.color, p.workLight);
    setColor(mats.pool.color, p.workLight);
    mats.pool.opacity = p.scheme === 'dark' ? 0.16 : 0.1;
    setColor(mats.spark.color, p.spark);
    setColor(mats.beam.color, p.workLight);
    setColor(mats.space.color, p.space);
    setColor(mats.planet.color, p.planet);
    setColor(mats.planetRim.color, p.planetRim);
    setColor(mats.windowFrame.color, p.windowFrame);
    setColor(mats.shaft.color, p.paper);
    setColor(mats.star.color, p.star);
    setColor(mats.haloWarn.color, p.needsYou);
    setColor(mats.beaconWarn.color, p.needsYou);
    setColor(mats.beaconStop.color, p.stop);
    setColor(mats.haloStop.color, p.stop);
    setColor(mats.ghost.color, p.frame);
    for (const k of ['build', 'repair'] as const) setColor(kindMats[k].color, p.signInk);
    scheme = p.scheme;
    for (const o of nightOnly) o.visible = scheme === 'dark';
    for (const o of dayOnly) o.visible = scheme === 'light';
    for (const k of STOP_HUES) {
      setColor(hueMats[k].color, p.hue[k]);
      setColor(glowMats[k].color, p.hue[k]);
      setColor(iconMats[k].color, p.onHue[k]);
    }
    // The light: a soft sky from above, one still, warm key from the upper left, and a cool rim
    // from behind; tuned per scheme so a surface facing up shows close to its token's own colour.
    const dark = p.scheme === 'dark';
    hemi.color.setRGB(1, 1, 1);
    setColor(hemi.groundColor, p.floor);
    hemi.intensity = dark ? 1.5 : 1.3;
    setColor(sun.color, p.key);
    sun.intensity = dark ? 2.1 : 2.05;
    setColor(rim.color, p.rim);
    rim.intensity = dark ? 0.9 : 0.6;
    setColor(rimUniform.value, p.rim);
    rimUniform.value.multiplyScalar(p.rimStrength);
    edgeUniform.value = dark ? 0.12 : 0.22;
  }
  setPalette(palette);

  // ---------- Shared shapes ----------
  const shape = {
    torso: g(new LatheGeometry(bodyProfile(), 32)),
    head: g(new SphereGeometry(FIGURE.headRadius, 32, 22)),
    // The visor: the front of a slightly bigger sphere, wide and a little low, so it reads as glass.
    visor: g(new SphereGeometry(FIGURE.headRadius + 0.006, 32, 16, Math.PI * 0.14, Math.PI * 0.72, Math.PI * 0.3, Math.PI * 0.36)),
    visorShine: g(new SphereGeometry(FIGURE.headRadius + 0.009, 16, 6, Math.PI * 0.62, Math.PI * 0.2, Math.PI * 0.33, Math.PI * 0.05)),
    // The helmet's neck ring.
    collar: g(new TorusGeometry(FIGURE.headRadius * 0.62, 0.022, 10, 28).rotateX(Math.PI / 2)),
    // A glove: a soft, slightly flat ball with a thumb.
    hand: g(new SphereGeometry(FIGURE.handRadius, 20, 14).scale(1, 0.92, 0.8)),
    thumb: g(new SphereGeometry(FIGURE.handRadius * 0.46, 12, 10)),
    // The shoulder patch, in the figure's stop hue, and the life-support pack on the back.
    patch: g(new CylinderGeometry(0.05, 0.05, 0.014, 6).rotateZ(Math.PI / 2)),
    pack: rb(0.3, 0.3, 0.13, 0.045, 2),
    packLight: g(new SphereGeometry(0.018, 10, 8)),
    // A seam round the middle, where the suit's top meets its legs.
    belt: g(new CylinderGeometry(FIGURE.bodyRadius + 0.006, FIGURE.bodyRadius + 0.01, 0.05, 36, 1, true)),
    chest: rb(0.11, 0.075, 0.03, 0.012, 1),
    blob: g(new CircleGeometry(0.36, 28).rotateX(-Math.PI / 2)),
    benchBlob: g(new PlaneGeometry(2.5, 1.3).rotateX(-Math.PI / 2)),
    // Props.
    slateFrame: rb(0.17, 0.23, 0.016, 0.018, 2),
    screen: g(new PlaneGeometry(1, 1)),
    line: g(new BoxGeometry(1, 1, 1)),
    welderGrip: g(new CylinderGeometry(0.02, 0.022, 0.13, 12)),
    welderBody: rb(0.07, 0.07, 0.15, 0.022, 2),
    nozzle: g(new CylinderGeometry(0.009, 0.02, 0.07, 12).rotateX(Math.PI / 2)),
    tip: g(new SphereGeometry(0.017, 12, 10)),
    scannerGrip: g(new CylinderGeometry(0.02, 0.022, 0.11, 12)),
    scannerBody: rb(0.12, 0.08, 0.08, 0.025, 2),
    dish: g(new CylinderGeometry(0.05, 0.034, 0.024, 24).rotateX(Math.PI / 2)),
    lensGrip: g(new CylinderGeometry(0.016, 0.019, 0.14, 12)),
    lensCollar: g(new CylinderGeometry(0.023, 0.023, 0.03, 14)),
    // A hex frame: a torus with six sides.
    lensRing: g(new TorusGeometry(0.066, 0.013, 8, 6).rotateZ(Math.PI / 6)),
    lens: g(new CylinderGeometry(0.06, 0.06, 0.005, 6).rotateX(Math.PI / 2).rotateZ(Math.PI / 6)),
    tabletFrame: rb(0.27, 0.19, 0.016, 0.018, 2),
    // Held things.
    sheet: g(new PlaneGeometry(0.17, 0.22)),
    card: rb(0.22, 0.15, 0.012, 0.01),
    cardStripe: rb(0.16, 0.032, 0.004, 0.002, 1),
    // Seats and signs.
    crate: rb(0.52, 0.2, 0.42, 0.022),
    crateBand: rb(0.536, 0.032, 0.436, 0.008, 1),
    post: g(new CylinderGeometry(0.013, 0.013, 0.38, 10)),
    postFoot: g(new CylinderGeometry(0.07, 0.078, 0.022, 20)),
    signBoard: rb(0.2, 0.2, 0.03, 0.03),
    bang: rb(0.036, 0.094, 0.01, 0.006, 1),
    bangDot: rb(0.036, 0.034, 0.01, 0.008, 1),
    clockRim: g(new TorusGeometry(0.09, 0.017, 12, 36)),
    clockFace: g(new CircleGeometry(0.09, 32)),
    bell: g(new SphereGeometry(0.032, 14, 10)),
    clockFoot: g(new SphereGeometry(0.018, 10, 8)),
    // On the bench.
    device: rb(0.22, 0.14, 0.18, 0.026),
    axle: g(new CylinderGeometry(0.012, 0.012, 0.05, 10).rotateZ(Math.PI / 2)),
    arm: rb(0.016, 0.016, 0.07, 0.006, 1),
    knob: g(new SphereGeometry(0.02, 12, 10)),
    lampBead: g(new SphereGeometry(0.0145, 12, 10)),
    work: rb(0.2, 0.06, 0.13, 0.014),
    peg: g(new CylinderGeometry(0.016, 0.016, 0.045, 12)),
    page: rb(0.2, 0.01, 0.15, 0.003, 1),
    // The bays: the stop's tile, its icon, the beacon.
    tag: rb(0.21, 0.21, 0.022, 0.04, 3),
    tagIcon: g(new PlaneGeometry(0.16, 0.16)),
    kindIcon: g(new PlaneGeometry(0.21, 0.21)),
    shade: g(new CylinderGeometry(0.038, 0.07, 0.05, 20, 1, true)),
    lampPost: g(new CylinderGeometry(0.014, 0.016, 0.62, 10)),
    lampSocket: g(new CylinderGeometry(0.03, 0.026, 0.03, 16)),
    bulb: g(new SphereGeometry(0.05, 20, 14)),
    ...stationShapes(g, rb),
  };

  const mesh = (geo: BufferGeometry, mat: Material, at?: [number, number, number], cast = true) => {
    const m = new Mesh(geo, mat);
    if (at) m.position.set(...at);
    m.castShadow = cast;
    m.receiveShadow = false;
    return m;
  };
  const line = (w: number, h: number, d: number, at: [number, number, number], mat: Material = mats.ink) => {
    const m = mesh(shape.line, mat, at, false);
    m.scale.set(w, h, d);
    return m;
  };
  const group = (...kids: Object3D[]) => { const gr = new Group(); if (kids.length) gr.add(...kids); return gr; };

  // The meshes the figure being built wears its stop hue on (collected while makeFigure runs).
  let huedNow: Mesh[] = [];
  const hued = (m: Mesh) => { m.userData.glow = m.material instanceof MeshBasicMaterial; huedNow.push(m); return m; };

  // ---------- Props: built upright from the grip (the hand is at the origin) ----------
  // A holo screen glows in the figure's stop hue (glowMats, hued) with pale lines on it.
  const screenAt = (w: number, h: number, at: [number, number, number]) => {
    const m = hued(mesh(shape.screen, glowMats.none, at, false));
    m.scale.set(w, h, 1);
    return m;
  };
  const holo = (w: number, h: number, d: number, at: [number, number, number]) => line(w, h, d, at, mats.holoLine);
  function makeProp(id: PropId): Group {
    switch (id) {
      case 'slate':
        // The Foreman's holo-slate: a thin frame, its screen lit, the job's lines on it.
        return group(
          mesh(shape.slateFrame, mats.ink, [0, 0.06, 0.008]),
          screenAt(0.142, 0.196, [0, 0.06, 0.0172]),
          holo(0.1, 0.008, 0.001, [-0.01, 0.12, 0.0182]),
          holo(0.08, 0.008, 0.001, [-0.02, 0.092, 0.0182]),
          holo(0.1, 0.008, 0.001, [-0.01, 0.064, 0.0182]),
          holo(0.05, 0.008, 0.001, [-0.035, 0.036, 0.0182]),
        );
      case 'welder':
        // The Builder's welder: a grip, a body, a nozzle forward, a hot tip.
        return group(
          mesh(shape.welderGrip, mats.ink, [0, 0.03, 0]),
          mesh(shape.welderBody, mats.metal, [0, 0.12, 0.03]),
          mesh(shape.nozzle, mats.metal, [0, 0.12, 0.135]),
          hued(mesh(shape.tip, glowMats.none, [0, 0.12, 0.172], false)),
        );
      case 'scanner':
        // The Tester's scanner: a grip, a body with a small screen on top, a dish that reads.
        return group(
          mesh(shape.scannerGrip, mats.ink, [0, 0.03, 0]),
          mesh(shape.scannerBody, mats.metal, [0, 0.12, 0.01]),
          screenAt(0.07, 0.05, [0, 0.161, 0.01]).rotateX(-Math.PI / 2),
          hued(mesh(shape.dish, glowMats.none, [0, 0.12, 0.062], false)),
        );
      case 'lens': {
        // A Reviewer's inspection lens: a hex frame on a short grip, its ring lit.
        const glass = mesh(shape.lens, mats.glass, [0, 0.2, 0], false);
        glass.renderOrder = 2;
        return group(
          mesh(shape.lensGrip, mats.ink, [0, 0.035, 0]),
          mesh(shape.lensCollar, mats.metal, [0, 0.115, 0]),
          hued(mesh(shape.lensRing, glowMats.none, [0, 0.2, 0], false)),
          glass,
        );
      }
      case 'tablet': {
        // The Planner's holo-tablet, showing a blueprint: a grid and a floor plan in pale lines.
        const t = group(
          mesh(shape.tabletFrame, mats.ink, [0, 0.07, 0.008]),
          screenAt(0.24, 0.16, [0, 0.07, 0.0172]),
        );
        for (let i = 0; i < 3; i++) t.add(holo(0.005, 0.15, 0.001, [-0.08 + i * 0.08, 0.07, 0.0178]));
        for (let i = 0; i < 2; i++) t.add(holo(0.23, 0.004, 0.001, [0, 0.035 + i * 0.07, 0.0178]));
        t.add(holo(0.11, 0.01, 0.001, [-0.02, 0.115, 0.0184]), holo(0.01, 0.07, 0.001, [0.035, 0.085, 0.0184]), holo(0.06, 0.01, 0.001, [0.06, 0.05, 0.0184]));
        return t;
      }
    }
  }

  function makeFigure(prop: PropId, hue: StopHue): FigureParts {
    huedNow = [];
    const anchor = new Group();
    const root = new Group();
    anchor.add(root);
    const blob = mesh(shape.blob, mats.blob, [0, 0.004, 0], false);
    blob.renderOrder = 1;
    root.add(blob);

    const torso = mesh(shape.torso, mats.clay);
    // The patch on its left shoulder (+x), facing out and a little forward.
    const patch = hued(mesh(shape.patch, hueMats.none, [FIGURE.bodyRadius * 0.82, 0.5, 0.06], false));
    patch.rotation.set(0, -0.5, -0.38);
    const belt = mesh(shape.belt, mats.glove, [0, 0.22, 0], false);
    const chest = mesh(shape.chest, mats.metal, [0, 0.46, FIGURE.bodyRadius - 0.025], false);
    chest.rotation.x = -0.28;
    const pack = mesh(shape.pack, mats.metal, [0, 0.42, -FIGURE.bodyRadius + 0.01]);
    const packLight = hued(mesh(shape.packLight, glowMats.none, [0.07, 0.52, -FIGURE.bodyRadius - 0.055], false));
    // The helmet: a pale shell, a dark visor at the front with a glint, and a ring at the neck.
    const head = mesh(shape.head, mats.helmet, [0, FIGURE.headRadius, 0]);
    const visor = mesh(shape.visor, mats.visor, [0, FIGURE.headRadius, 0], false);
    const shine = mesh(shape.visorShine, mats.visorShine, [0, FIGURE.headRadius, 0], false);
    shine.renderOrder = 2;
    const collar = mesh(shape.collar, mats.metal, [0, 0.012, 0], false);
    const headPivot = group(head, visor, shine, collar);
    headPivot.position.y = HEAD_Y;
    // Gloves, thumbs forward and in.
    const freeHand = [mesh(shape.hand, mats.glove), mesh(shape.thumb, mats.glove, [-0.03, 0.018, 0.036])];
    const handL = group(...freeHand);
    const handR = group(mesh(shape.hand, mats.glove), mesh(shape.thumb, mats.glove, [0.03, 0.018, 0.036]));
    const propGroup = makeProp(prop);
    propGroup.scale.setScalar(1.3);
    handR.add(propGroup);

    // The sheet it reads and the card it holds up, both in the left hand.
    const sheetMesh = mesh(shape.sheet, mats.paper, [0, 0.08, 0.03], false);
    const sheet = group(sheetMesh,
      line(0.12, 0.007, 0.002, [-0.01, 0.15, 0.032]), line(0.1, 0.007, 0.002, [-0.02, 0.12, 0.032]),
      line(0.12, 0.007, 0.002, [-0.01, 0.09, 0.032]), line(0.07, 0.007, 0.002, [-0.035, 0.06, 0.032]));
    sheet.rotation.x = -0.45;
    const card = group(
      mesh(shape.card, mats.paper, [0, 0.1, 0.02]),
      mesh(shape.cardStripe, mats.ask, [0, 0.135, 0.028], false),
      line(0.13, 0.008, 0.002, [-0.015, 0.095, 0.0275]),
      line(0.09, 0.008, 0.002, [-0.035, 0.068, 0.0275]),
    );
    handL.add(sheet, card);

    const body = group(torso, belt, chest, patch, pack, packLight, headPivot, handL, handR);
    root.add(body);

    // Sitting: a crate under it. Stopped: a "!" sign at its side. Paused: a small clock.
    const crate = group(mesh(shape.crate, mats.crate, [0, 0.1, 0]), mesh(shape.crateBand, mats.benchLeg, [0, 0.1, 0], false));
    root.add(crate);
    const board = group(
      mesh(shape.signBoard, mats.stop, [0, 0, 0]),
      mesh(shape.bang, mats.paper, [0, 0.022, 0.016], false),
      mesh(shape.bangDot, mats.paper, [0, -0.052, 0.016], false),
    );
    board.position.y = 0.42;
    const sign = group(mesh(shape.postFoot, mats.metal, [0, 0.011, 0]), mesh(shape.post, mats.metal, [0, 0.2, 0]), board);
    // In front of it, a little to its right, so a neighbour never hides it.
    sign.position.set(0.3, 0, 0.27);
    sign.rotation.y = -0.2;
    root.add(sign);
    const face = group(
      mesh(shape.clockRim, lampMats.paused, [0, 0, 0]),
      mesh(shape.clockFace, mats.paper, [0, 0, -0.002], false),
      line(0.012, 0.05, 0.004, [0, 0.02, 0.008]),
      line(0.07, 0.01, 0.004, [0.026, 0, 0.009]),
      mesh(shape.bell, lampMats.paused, [-0.07, 0.085, -0.01]),
      mesh(shape.bell, lampMats.paused, [0.07, 0.085, -0.01]),
    );
    face.position.y = 0.13;
    face.rotation.x = -0.18;
    const clock = group(face, mesh(shape.clockFoot, mats.metal, [-0.055, 0.02, 0]), mesh(shape.clockFoot, mats.metal, [0.055, 0.02, 0]));
    clock.position.set(0.33, 0, 0.27);
    clock.rotation.y = -0.25;
    root.add(clock);

    // On the bench, in the figure's bench-facing frame (+z toward the bench).
    const lamps: Mesh[] = [];
    const deviceBody = mesh(shape.device, mats.benchLeg, [0.03, BENCH.height + 0.07, 0.4]);
    const crank = group(mesh(shape.arm, mats.metal, [0, 0, -0.035]), mesh(shape.knob, mats.handle, [0.018, 0, -0.07]));
    crank.position.set(0.19, BENCH.height + 0.06, 0.38);
    const device = group(deviceBody, mesh(shape.axle, mats.metal, [0.165, BENCH.height + 0.06, 0.38]), crank);
    for (let i = 0; i < 5; i++) {
      const bead = mesh(shape.lampBead, mats.lampOff, [-0.05 + i * 0.033, BENCH.height + 0.145, 0.4], false);
      lamps.push(bead);
      device.add(bead);
    }
    const workpiece = group(mesh(shape.work, mats.crate, [-0.12, BENCH.height + 0.03, 0.36]), mesh(shape.peg, mats.metal, [-0.12, BENCH.height + 0.08, 0.36]));
    const stack = group(
      mesh(shape.page, mats.paper, [0, BENCH.height + 0.005, 0.4]),
      mesh(shape.page, mats.paper, [0.004, BENCH.height + 0.016, 0.398]),
      mesh(shape.page, mats.paper, [-0.003, BENCH.height + 0.027, 0.402]),
    );
    stack.children[1].rotation.y = 0.04;
    stack.children[2].rotation.y = -0.03;
    const items = group(device, workpiece, stack);
    anchor.add(items);

    const parts: FigureParts = { anchor, root, blob, body, torso, headPivot, handL, handR, prop: propGroup, sheet, card, crate, sign, clock, items, device, crank, lamps, workpiece, stack, hued: huedNow, freeHand };
    huedNow = [];
    hueFigure(parts, hue);
    return parts;
  }

  function hueFigure(parts: FigureParts, hue: StopHue) {
    for (const m of parts.hued) m.material = m.userData.glow ? glowMats[hue] : hueMats[hue];
  }

  function raiseHand(parts: FigureParts, waiting: boolean) {
    for (const m of parts.freeHand) m.material = waiting ? mats.ask : mats.glove;
    // Raised, the hand opens a little bigger, so it reads as a hand up rather than a dot.
    for (const m of parts.freeHand) m.scale.setScalar(waiting ? 1.3 : 1);
  }

  // ---------- The bays ----------
  // Both kinds stand on a pad with a thin rim in the job's stop hue, a small sign at the front (the
  // kind's icon on a pale tile, the stop's icon on a tile in its hue) and a beacon at the back
  // right. Shape tells them apart first: a construction bay is tall and open (a scaffold, a crane
  // over a hex module); a repair dock is low and long (a craft in a cradle, hazard stripes, an arm).

  function signAndBeacon(kind: BayKind) {
    const board = mesh(shape.bayBoard, mats.signBoard, [0.66, 0.24, 0.74], false);
    const kindIcon = mesh(shape.kindIcon, kindMats[kind], [0.53, 0.24, 0.757], false);
    kindIcon.renderOrder = 2;
    const tag = mesh(shape.tag, glowMats.none, [0.8, 0.24, 0.757], false);
    const icon = mesh(shape.tagIcon, iconMats.none, [0.8, 0.24, 0.77], false);
    icon.renderOrder = 2;
    const sign = group(mesh(shape.signPost, mats.scaffold, [0.66, 0.06, 0.72]), board, kindIcon, tag, icon);
    const bulb = mesh(shape.bulb, glowMats.none, [1.3, 0.68, -0.64], false);
    const halo = mesh(shape.halo, mats.haloWarn, [1.3, 0.68, -0.64], false);
    halo.renderOrder = 3;
    halo.visible = false;
    const beacon = group(halo,
      mesh(shape.lampPost, mats.metal, [1.3, 0.31, -0.64]),
      mesh(shape.lampSocket, mats.metal, [1.3, 0.63, -0.64]),
      mesh(shape.shade, mats.metal, [1.3, 0.74, -0.64], false),
      bulb,
    );
    return { sign, tag, icon, bulb, halo, beacon };
  }

  function makeBay(kind: BayKind): BayParts {
    const pad = mesh(shape.pad, mats.pad, [0, 0.016, 0], false);
    pad.receiveShadow = true;
    const edge = mesh(shape.padRim, glowMats.none, [-0.55, 0.024, 0.75], false);
    const { sign, tag, icon, bulb, halo, beacon } = signAndBeacon(kind);
    const blob = mesh(shape.bayBlob, mats.blob, [0, 0.034, 0.02], false);
    blob.renderOrder = 1;
    const work = new Group();
    const parts: BayParts = {
      kind, group: group(edge, pad, blob, sign, beacon, work), bulb, edge, tag, icon, work,
      sleeves: [], skeleton: null, windows: null, caps: null, crane: null, heldPlate: null, lights: [],
      damage: null, patch: null, beam: null, sparks: null, navLights: null,
      halo, sections: [], sectionRings: [], alert: null, hue: 'none', phase: null,
    };
    if (kind === 'build') {
      // The module: a dark core inside a hex frame; hull sections slide on as the build goes; lit
      // windows and docking rings once it is tested.
      const core = mesh(shape.core, mats.plateDark, [0, MODULE_Y, 0]);
      const skeleton = mesh(shape.skeleton, mats.frame, [0, MODULE_Y, 0], false);
      const sleeves = [-0.6, -0.2, 0.2, 0.6].map((x) => mesh(shape.sleeve, mats.plate, [x, MODULE_Y, 0]));
      const windows = mesh(shape.windows, mats.workLight, [0, MODULE_Y, 0], false);
      const caps = mesh(shape.caps, mats.metal, [0, MODULE_Y, 0]);
      work.add(core, skeleton, ...sleeves, windows, caps);
      // The scaffold and its crane: a trolley on the gantry, a cable and a hook, and the plate it lowers.
      const scaffold = mesh(shape.scaffold, mats.scaffold, [0, 0, 0]);
      const heldPlate = mesh(shape.heldPlate, mats.plate, [0.1, 0.86, -0.08]);
      const crane = group(mesh(shape.trolley, mats.metal, [0.1, 1.33, -0.36]), mesh(shape.boom, mats.scaffold, [0.1, 1.33, -0.17]), mesh(shape.cable, mats.ink, [0.1, 1.1, -0.06], false), mesh(shape.hook, mats.metal, [0.1, 0.9, -0.06], false), heldPlate);
      // The cool work lights on the front posts, and the pool they cast.
      const heads = mesh(shape.lampHeads, mats.metal, [0, 0, 0], false);
      const glow = mesh(shape.lampGlow, mats.workLight, [0, 0, 0], false);
      const pool = mesh(shape.pool, mats.pool, [0, 0.036, 0.05], false);
      pool.renderOrder = 1;
      parts.group.add(scaffold, crane, heads, glow, pool);
      Object.assign(parts, { sleeves, skeleton, windows, caps, crane, heldPlate, lights: [glow, pool] });
    } else {
      // The dry dock: hazard stripes front and back, a cradle, a robotic repair arm at the front right.
      for (const z of [-0.66, 0.66]) {
        parts.group.add(mesh(shape.hazardBase, mats.hazardBase, [0, 0.034, z], false));
        const stripes = mesh(shape.hazardStripes, mats.hazard, [0, 0.036, z], false);
        stripes.renderOrder = 1;
        parts.group.add(stripes);
      }
      parts.group.add(mesh(shape.cradle, mats.scaffold, [0, 0, 0]));
      // The craft: a hull, a canopy, fins and an engine; the damaged panel on its side.
      const hull = mesh(shape.hull, mats.hull, [0, CRAFT_Y, 0]);
      const canopy = mesh(shape.canopy, mats.visor, [0.42, CRAFT_Y + 0.13, 0], false);
      const fins = mesh(shape.fins, mats.hull, [0, CRAFT_Y, 0]);
      const engine = mesh(shape.engine, mats.metal, [-0.88, CRAFT_Y, 0]);
      const navLights = mesh(shape.navLights, mats.workLight, [0, CRAFT_Y, 0], false);
      const damage = group(
        mesh(shape.damage, mats.damage, [0, 0, 0], false),
        line(0.16, 0.008, 0.004, [-0.02, 0.02, 0.014], mats.ink),
        line(0.1, 0.008, 0.004, [0.05, -0.03, 0.014], mats.ink),
      );
      damage.position.set(0.05, CRAFT_Y + 0.02, 0.2);
      damage.rotation.set(0.15, 0.12, 0.18);
      const patch = mesh(shape.patchPlate, mats.patch, [0.05, CRAFT_Y + 0.02, 0.212], false);
      patch.rotation.set(0.12, 0.1, 0);
      work.add(hull, canopy, fins, engine, navLights, damage, patch);
      // The repair arm and its beam to the panel; sparks fly where it touches.
      const arm = mesh(shape.repairArm, mats.scaffold, [0, 0, 0]);
      const armHead = mesh(shape.armHead, mats.metal, [ARM_TIP.x, ARM_TIP.y, ARM_TIP.z], false);
      const beam = mesh(shape.beam, mats.beam, [0, 0, 0], false);
      placeBetween(beam, ARM_TIP, PANEL_AT);
      beam.renderOrder = 2;
      const sparks = new Group();
      for (let i = 0; i < 7; i++) {
        const sp = mesh(shape.spark, mats.spark, [0, 0, 0], false);
        sp.userData.seed = i;
        sparks.add(sp);
      }
      sparks.position.set(PANEL_AT.x, PANEL_AT.y, PANEL_AT.z);
      placeSparks(sparks, 0);
      parts.group.add(arm, armHead, beam, sparks);
      Object.assign(parts, { damage, patch, beam, sparks, navLights });
    }
    return parts;
  }

  function hueBay(parts: BayParts, hue: StopHue) {
    parts.hue = hue;
    alertBay(parts, parts.alert);
    parts.edge.material = glowMats[hue];
    parts.tag.material = glowMats[hue];
    parts.icon.material = iconMats[hue];
    parts.tag.visible = hue !== 'none';
    parts.icon.visible = hue !== 'none';
  }

  /** The beacon: amber for needs you and a permission, red for stopped, grey for a pause, green when done; else the stop's hue. */
  function alertBay(parts: BayParts, alert: BayAlert | null) {
    parts.alert = alert;
    parts.bulb.material = alert === 'needs-you' || alert === 'asking' ? mats.beaconWarn
      : alert === 'stuck' ? mats.beaconStop
        : alert === 'paused' ? lampMats.paused
          : alert === 'done' ? lampMats.done
            : glowMats[parts.hue];
    parts.halo.visible = alert === 'needs-you' || alert === 'asking' || alert === 'stuck';
    parts.halo.material = alert === 'stuck' ? mats.haloStop : mats.haloWarn;
    parts.halo.scale.setScalar(1);
    // Paused for the usage limit: the work lights and the module's own lights go dark.
    const dim = alert === 'paused';
    if (dim) for (const l of parts.lights) l.visible = false;
    applyLights(parts);
  }

  function applyLights(parts: BayParts) {
    const dim = parts.alert === 'paused';
    for (const l of parts.lights) l.visible = !dim && parts.work.visible;
    if (parts.windows && dim) parts.windows.visible = false;
    if (parts.navLights && dim) parts.navLights.visible = false;
  }

  function pulseBay(parts: BayParts, u: number) {
    const b = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
    parts.halo.scale.setScalar(1 + 0.6 * b);
    parts.bulb.scale.setScalar(1 + 0.18 * b);
  }

  // A stack's sections: joined parts in the hull's own plate, built ones polished, parts at work
  // half on with their frame showing, stuck ones in the damaged panel's colour, waiting ones a dim frame.
  const SECTION_MAT: Record<SectionState, Material> = { joined: mats.plate, built: mats.plateBright, working: mats.plate, stuck: mats.damage, waiting: mats.ghost };
  function sectionBay(parts: BayParts, sections: readonly SceneSection[] | null) {
    for (const m of [...parts.sections, ...parts.sectionRings]) parts.work.remove(m);
    parts.sections = [];
    parts.sectionRings = [];
    if (!sections?.length || parts.kind !== 'build') { phaseBay(parts, parts.phase ?? 'frame'); return; }
    const n = sections.length;
    const len = MODULE_LEN / n;
    sections.forEach((sec, i) => {
      const x = -MODULE_LEN / 2 + (i + 0.5) * len;
      const m = mesh(shape.sectionUnit, SECTION_MAT[sec.state], [x, MODULE_Y, 0], sec.state !== 'waiting');
      m.scale.set(len * (sec.state === 'working' ? 0.5 : 0.92), 1, 1);
      if (sec.state === 'working') m.position.x = x - len * 0.2;
      if (sec.state === 'waiting') m.scale.set(len * 0.92, 0.96, 0.96);
      m.userData.section = sec.n;
      const r = mesh(shape.sectionRing, mats.frame, [x + len / 2 - 0.006, MODULE_Y, 0], false);
      parts.sections.push(m);
      parts.sectionRings.push(r);
      parts.work.add(m, r);
    });
    phaseBay(parts, parts.phase ?? 'frame');
  }

  function phaseBay(parts: BayParts, phase: BuildPhase) {
    parts.phase = phase;
    const done = phase === 'launched';
    parts.work.visible = !done;
    if (parts.kind === 'build') {
      const stack = parts.sections.length > 0;
      const on = stack ? 0 : PLATES_ON[phase];
      parts.sleeves.forEach((m, i) => {
        m.visible = i < on;
        m.material = phase === 'sealed' ? mats.plateBright : mats.plate;
      });
      if (parts.skeleton) parts.skeleton.visible = !stack && (phase === 'frame' || phase === 'plates');
      if (parts.windows) parts.windows.visible = !stack && (phase === 'lights' || phase === 'sealed');
      if (parts.caps) parts.caps.visible = phase === 'lights' || phase === 'sealed';
      if (parts.heldPlate) parts.heldPlate.visible = phase === 'plates';
      for (const l of parts.lights) l.visible = !done;
    } else {
      if (parts.damage) parts.damage.visible = phase === 'frame' || phase === 'plates';
      if (parts.patch) {
        parts.patch.visible = phase === 'plates' || phase === 'lights';
        parts.patch.scale.set(phase === 'plates' ? 0.55 : 1, 1, 1);
        parts.patch.position.x = phase === 'plates' ? -0.02 : 0.05;
      }
      if (parts.beam) parts.beam.visible = phase === 'plates';
      if (parts.sparks) parts.sparks.visible = phase === 'plates';
      if (parts.navLights) parts.navLights.visible = phase !== 'frame';
    }
    applyLights(parts);
  }

  // ---------- The room: the deck, the back wall with its windows, and the airlock ----------
  let leaves: Mesh[] = [];
  function openAirlock(k: number) {
    const u = Math.min(1, Math.max(0, k));
    leaves.forEach((m, i) => { m.position.x = (m.userData.shut as number) + (i ? 1 : -1) * u * (AIRLOCK.width / 2 - 0.02); });
  }

  function makeRoom(layout: FloorLayout): Group {
    for (const geo of roomGeos.splice(0)) geo.dispose();
    nightOnly.length = 0;
    dayOnly.length = 0;
    const rg = <T extends BufferGeometry>(geo: T): T => { roomGeos.push(geo); return geo; };
    const { left, right, back, front } = layout;
    const r = 0.22;
    // The deck's outline, rounded at the front corners, in the plane (x, -z).
    const s = new Shape();
    s.moveTo(left, -back);
    s.lineTo(right, -back);
    s.lineTo(right, -front + r);
    s.quadraticCurveTo(right, -front, right - r, -front);
    s.lineTo(left + r, -front);
    s.quadraticCurveTo(left, -front, left, -front + r);
    s.lineTo(left, -back);
    // Shape space (x, y) lies on the floor as (x, -z) once turned face up; its UVs are world units, so the seams are 1 apart.
    const floorTop = rg(new ShapeGeometry(s, 10).rotateX(-Math.PI / 2));
    const slab = rg(new ExtrudeGeometry(s, { depth: EDGE, bevelEnabled: false, curveSegments: 10 }).rotateX(-Math.PI / 2));
    const floor = new Mesh(floorTop, mats.floor);
    const seams = new Mesh(floorTop, mats.deckLine);
    seams.position.y = 0.0015;
    seams.renderOrder = 1;
    const catcher = new Mesh(floorTop, mats.catcher);
    catcher.position.y = 0.002;
    catcher.receiveShadow = true;
    // The deck's thickness, seen as a thin band along its front.
    const edge = new Mesh(slab, mats.floorEdge);
    edge.position.y = -EDGE - 0.002;
    const room = group(edge, floor, seams, catcher);

    // The airlock: a frame round a dark opening and two leaves that part when a helper walks through.
    const doorW = AIRLOCK.width;
    const doorH = AIRLOCK.height;
    const frameT = 0.07;
    const depth = 0.14;
    const dx = layout.door.x;
    const dz = layout.door.z - 0.04;
    const box = (w: number, h: number, d: number) => rg(new BoxGeometry(w, h, d));
    room.add(
      mesh(box(frameT, doorH + frameT, depth), mats.windowFrame, [dx - doorW / 2 - frameT / 2, (doorH + frameT) / 2, dz]),
      mesh(box(frameT, doorH + frameT, depth), mats.windowFrame, [dx + doorW / 2 + frameT / 2, (doorH + frameT) / 2, dz]),
      mesh(box(doorW + frameT * 2, frameT, depth), mats.windowFrame, [dx, doorH + frameT / 2, dz]),
      mesh(box(doorW + 0.2, 0.014, 0.26), mats.windowFrame, [dx, 0.007, dz + 0.06], false),
      mesh(box(0.2, 0.03, 0.03), mats.workLight, [dx, doorH + frameT + 0.03, dz + 0.02], false),
    );
    const doorway = new Mesh(rg(new PlaneGeometry(doorW, doorH)), mats.doorway);
    doorway.position.set(dx, doorH / 2, dz - 0.03);
    room.add(doorway);
    leaves = [-1, 1].map((side) => {
      const leaf = mesh(box(doorW / 2 - 0.006, doorH - 0.01, 0.04), mats.plate, [dx + side * (doorW / 4), doorH / 2, dz], false);
      leaf.userData.shut = dx + side * (doorW / 4);
      return leaf;
    });
    // A stripe across both leaves, so the parting reads.
    room.add(...leaves);
    openAirlock(0);

    if (layout.wall) {
      // The back wall, and big windows on space (still stars, a far planet's edge); by day, bright
      // panes and soft shafts of daylight on the deck.
      const wallZ = back;
      const wallH = WALL_HEIGHT;
      const wall = mesh(box(right - left + 0.1, wallH, 0.08), mats.wall, [(left + right) / 2, wallH / 2, wallZ - 0.04], false);
      room.add(wall);
      const x0 = dx + doorW / 2 + 0.45;
      const x1 = right - 0.2;
      const n = Math.max(1, Math.round((x1 - x0) / 2.4));
      const gap = 0.16;
      const pw = (x1 - x0 - gap * (n - 1)) / n;
      const ph = WALL_HEIGHT - 0.42;
      const py = 0.3 + ph / 2;
      const starPts: number[] = [];
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < n; i++) {
        const cx = x0 + pw / 2 + i * (pw + gap);
        const pane = mesh(rg(new PlaneGeometry(pw, ph)), mats.space, [cx, py, wallZ + 0.002], false);
        room.add(pane);
        // The frame: sills, sides and a mullion.
        room.add(
          mesh(box(pw + 0.08, 0.05, 0.06), mats.windowFrame, [cx, py - ph / 2, wallZ + 0.02], false),
          mesh(box(pw + 0.08, 0.05, 0.06), mats.windowFrame, [cx, py + ph / 2, wallZ + 0.02], false),
          mesh(box(0.05, ph, 0.06), mats.windowFrame, [cx - pw / 2, py, wallZ + 0.02], false),
          mesh(box(0.05, ph, 0.06), mats.windowFrame, [cx + pw / 2, py, wallZ + 0.02], false),
          mesh(box(0.03, ph, 0.04), mats.windowFrame, [cx, py, wallZ + 0.016], false),
        );
        for (let k = 0; k < Math.round(pw * 9); k++) starPts.push(cx - pw / 2 + 0.05 + rnd() * (pw - 0.1), py - ph / 2 + 0.05 + rnd() * (ph - 0.1), wallZ + 0.006);
        // By day, a soft shaft of light falls on the deck in front of each window.
        const shaft = mesh(rg(new PlaneGeometry(pw * 0.9, 1.3).rotateX(-Math.PI / 2)), mats.shaft, [cx + 0.25, 0.003, wallZ + 0.85], false);
        shaft.renderOrder = 1;
        room.add(shaft);
        dayOnly.push(shaft);
        if (i === n - 1) {
          // A far planet's edge in the last window's lower right corner, with a thin lit rim.
          const R = Math.min(pw, ph) * 1.3;
          const centre = { x: cx + pw / 2 + R * 0.38, y: py - ph / 2 - R * 0.62 };
          const rim = planetShape(centre, R + 0.018, cx - pw / 2, cx + pw / 2, py - ph / 2, py + ph / 2);
          const body = planetShape(centre, R, cx - pw / 2, cx + pw / 2, py - ph / 2, py + ph / 2);
          const rimMesh = rim && mesh(rg(new ShapeGeometry(rim, 24)), mats.planetRim, [0, 0, wallZ + 0.004], false);
          const bodyMesh = body && mesh(rg(new ShapeGeometry(body, 24)), mats.planet, [0, 0, wallZ + 0.005], false);
          for (const m of [rimMesh, bodyMesh]) if (m) { room.add(m); nightOnly.push(m); }
        }
      }
      const starGeo = rg(new BufferGeometry());
      starGeo.setAttribute('position', new Float32BufferAttribute(starPts, 3));
      const stars = new Points(starGeo, mats.star);
      room.add(stars);
      nightOnly.push(stars);
    }
    for (const o of nightOnly) o.visible = scheme === 'dark';
    for (const o of dayOnly) o.visible = scheme === 'light';
    return room;
  }

  return {
    makeFigure,
    makeBay,
    hueFigure,
    hueBay,
    phaseBay,
    raiseHand,
    makeRoom,
    openAirlock,
    alertBay,
    pulseBay,
    sectionBay,
    sparkBay(parts, t) {
      if (!parts.sparks) return;
      parts.sparks.visible = t === null || t >= 0;
      if (t !== null && t >= 0) placeSparks(parts.sparks, t);
      else if (t === null) placeSparks(parts.sparks, 0);
    },
    lights: () => ({ hemi, sun, rim }),
    lampMaterial: (k) => lampMats[k],
    deviceLamp: (on) => (on ? lampMats.running : mats.lampOff),
    setPalette,
    disposables: () => [...geos, ...roomGeos, ...Object.values(mats), ...Object.values(lampMats), ...Object.values(hueMats), ...Object.values(glowMats), ...Object.values(iconMats), ...Object.values(kindMats), ...Object.values(iconTex), ...Object.values(kindTex).filter((t): t is CanvasTexture => Boolean(t)), blobTex, deckTex, stripeTex, poolTex],
    dispose() {
      for (const d of [...geos.splice(0), ...roomGeos.splice(0)]) d.dispose();
      for (const m of [...Object.values(mats), ...Object.values(lampMats), ...Object.values(hueMats), ...Object.values(glowMats), ...Object.values(iconMats), ...Object.values(kindMats)]) m.dispose();
      for (const t of [...Object.values(iconTex), ...Object.values(kindTex)]) t?.dispose();
      blobTex.dispose();
      deckTex.dispose();
      stripeTex.dispose();
      poolTex.dispose();
      hemi.dispose();
      sun.dispose();
      rim.dispose();
    },
  };
}

