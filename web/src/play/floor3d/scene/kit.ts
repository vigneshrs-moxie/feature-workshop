// The scene kit: every shape on the floor, built in code (no model files, no textures fetched), and
// the materials they wear, all coloured from the theme (palette.ts). One set of geometries and
// materials is shared by every figure and bench, so a theme change recolours the whole floor by
// updating a few materials in place, and leaving disposes everything in one go.
//
// The figure, about 1 unit tall: a rounded body 0.66 tall and 0.47 wide, a round head 0.32 across
// floating just above it (a head-to-height of about 1:3, friendly, never a face), and two mitten
// hands that float at its sides. A small accent badge on the chest marks its front. Its role is the
// prop in its right hand.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, ExtrudeGeometry, Group,
  HemisphereLight, DirectionalLight, LatheGeometry, LinearFilter, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  Object3D, PlaneGeometry, RGBAFormat, SRGBColorSpace, Shape, ShapeGeometry, ShadowMaterial, SphereGeometry, SplineCurve, TorusGeometry, Vector2,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { FloorLayout } from '../layout';
import { BENCH } from '../layout';
import type { FloorPalette, LampGroup, Rgb, StopHue } from '../palette';
import { STOP_HUES } from '../palette';
import type { PropId } from '../types';

const LAMP_GROUPS: readonly LampGroup[] = ['needs-you', 'running', 'paused', 'idle', 'shipping', 'done'];

/** Body proportions (world units). */
export const FIGURE = {
  bodyHeight: 0.66,
  bodyRadius: 0.236,
  headRadius: 0.16,
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

/**
 * The bench top's own light falloff, as vertex colours: a touch darker toward its back and on its
 * sides and underside, so the top reads as a surface under a lamp rather than a flat white card.
 */
function shadeTop<T extends BufferGeometry>(geo: T): T {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const back = Math.min(1, Math.max(0, 0.5 - pos.getZ(i) / BENCH.depth));
    const side = nor ? 1 - Math.max(0, nor.getY(i)) : 0;
    const k = 1 - 0.09 * back - 0.08 * side;
    colors[i * 3] = k; colors[i * 3 + 1] = k; colors[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
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

function flaskProfile(): Vector2[] {
  return [[0, -0.11], [0.066, -0.11], [0.074, -0.1], [0.072, -0.075], [0.04, -0.012], [0.023, 0.012], [0.022, 0.07], [0.029, 0.074], [0.029, 0.084], [0.019, 0.084]]
    .map(([r, y]) => new Vector2(r, y));
}
function liquidProfile(): Vector2[] {
  return [[0, -0.103], [0.062, -0.103], [0.067, -0.094], [0.064, -0.074], [0.052, -0.052], [0, -0.052]].map(([r, y]) => new Vector2(r, y));
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
  /** The meshes that wear the figure's stop hue (badge, belt, prop accents). */
  hued: Mesh[];
  /** The free (left) hand's meshes: needs-you amber while it is raised to wait for you. */
  freeHand: Mesh[];
}

export interface BenchParts {
  group: Group;
  bulb: Mesh;
  /** The thin edge round the top, the tag on its front and the icon on the tag: the job's stop. */
  edge: Mesh;
  tag: Mesh;
  icon: Mesh;
}

export interface Kit {
  makeFigure(prop: PropId, hue: StopHue): FigureParts;
  makeBench(): BenchParts;
  /** Dress a figure in a stop's hue. */
  hueFigure(parts: FigureParts, hue: StopHue): void;
  /** Dress a bench in its job's stop: the edge, the tag, the icon and the lamp. */
  hueBench(parts: BenchParts, hue: StopHue): void;
  /** The free hand in needs-you amber (waiting for you) or in clay. */
  raiseHand(parts: FigureParts, waiting: boolean): void;
  /** The floor, its edge and the door, sized for a layout (rebuilt when it changes). */
  makeRoom(layout: FloorLayout): Group;
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
    clay: rimmed(), badge: lambert(), benchFront: lambert(), benchTop: new MeshLambertMaterial({ vertexColors: true }), paper: lambert(), ink: lambert(), metal: lambert(), handle: lambert(),
    liquid: lambert(), bench: lambert(), benchLeg: lambert(), crate: lambert(), wall: lambert(), doorFrame: lambert(),
    stop: lambert(), ask: lambert(), lampOff: lambert(),
    glass: new MeshLambertMaterial({ transparent: true, opacity: 0.42, depthWrite: false }),
    floor: new MeshBasicMaterial(),
    floorEdge: new MeshBasicMaterial(),
    doorway: new MeshBasicMaterial(),
    catcher: new ShadowMaterial({ transparent: true }),
    blob: new MeshBasicMaterial({ transparent: true, depthWrite: false }),
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

  function setPalette(p: FloorPalette) {
    setColor(mats.clay.color, p.clay);
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
    // A mitten: a soft, slightly flat ball with a thumb.
    hand: g(new SphereGeometry(FIGURE.handRadius, 20, 14).scale(1, 0.92, 0.8)),
    thumb: g(new SphereGeometry(FIGURE.handRadius * 0.46, 12, 10)),
    badge: g(new CylinderGeometry(0.04, 0.04, 0.014, 24).rotateX(Math.PI / 2)),
    // A belt round the middle, in the figure's stop hue.
    belt: g(new CylinderGeometry(FIGURE.bodyRadius + 0.006, FIGURE.bodyRadius + 0.01, 0.062, 36, 1, true)),
    buckle: rb(0.07, 0.056, 0.02, 0.01, 1),
    hammerGrip: g(new CylinderGeometry(0.021, 0.022, 0.1, 12)),
    hammerClaw: rb(0.05, 0.03, 0.05, 0.01, 1),
    blob: g(new CircleGeometry(0.36, 28).rotateX(-Math.PI / 2)),
    benchBlob: g(new PlaneGeometry(2.5, 1.3).rotateX(-Math.PI / 2)),
    // Props.
    hammerHandle: g(new CylinderGeometry(0.015, 0.018, 0.27, 12)),
    hammerHead: rb(0.15, 0.058, 0.058, 0.014),
    hammerBand: g(new CylinderGeometry(0.02, 0.02, 0.02, 12)),
    board: rb(0.17, 0.23, 0.014, 0.008),
    boardPaper: g(new PlaneGeometry(0.142, 0.178)),
    clip: rb(0.066, 0.03, 0.022, 0.007),
    line: g(new BoxGeometry(1, 1, 1)),
    flask: g(new LatheGeometry(flaskProfile(), 28)),
    liquid: g(new LatheGeometry(liquidProfile(), 28)),
    magHandle: g(new CylinderGeometry(0.016, 0.019, 0.14, 12)),
    magCollar: g(new CylinderGeometry(0.023, 0.023, 0.03, 14)),
    magRing: g(new TorusGeometry(0.062, 0.012, 12, 36)),
    lens: g(new CylinderGeometry(0.058, 0.058, 0.005, 32).rotateX(Math.PI / 2)),
    ruler: rb(0.044, 0.32, 0.01, 0.004, 1),
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
    // The bench.
    top: shadeTop(rb(BENCH.width, 0.075, BENCH.depth, 0.026)),
    edge: rb(BENCH.width + 0.012, 0.022, BENCH.depth + 0.012, 0.01, 2),
    apron: rb(BENCH.width - 0.34, 0.1, 0.03, 0.012),
    tag: rb(0.2, 0.2, 0.024, 0.04, 3),
    tagIcon: g(new PlaneGeometry(0.15, 0.15)),
    shade: g(new CylinderGeometry(0.038, 0.07, 0.05, 20, 1, true)),
    leg: rb(0.07, BENCH.height - 0.04, BENCH.depth - 0.14, 0.018),
    shelf: rb(BENCH.width - 0.36, 0.034, BENCH.depth - 0.3, 0.012),
    lampPost: g(new CylinderGeometry(0.012, 0.014, 0.36, 10)),
    lampSocket: g(new CylinderGeometry(0.03, 0.026, 0.03, 16)),
    bulb: g(new SphereGeometry(0.046, 20, 14)),
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
  const hued = (m: Mesh) => { huedNow.push(m); return m; };

  // ---------- Props: built upright from the grip (the hand is at the origin) ----------
  function makeProp(id: PropId): Group {
    switch (id) {
      case 'hammer':
        return group(
          mesh(shape.hammerHandle, mats.handle, [0, 0.07, 0]),
          hued(mesh(shape.hammerGrip, hueMats.none, [0, 0.0, 0])),
          mesh(shape.hammerBand, mats.metal, [0, 0.175, 0]),
          mesh(shape.hammerHead, mats.metal, [0.03, 0.205, 0]),
          mesh(shape.hammerClaw, mats.metal, [-0.06, 0.212, 0]),
        );
      case 'clipboard':
        return group(
          hued(mesh(shape.board, hueMats.none, [0, 0.05, 0.012])),
          mesh(shape.boardPaper, mats.paper, [0, 0.04, 0.0201], false),
          mesh(shape.clip, mats.metal, [0, 0.162, 0.026]),
          line(0.1, 0.006, 0.001, [-0.01, 0.1, 0.0207]),
          line(0.08, 0.006, 0.001, [-0.02, 0.072, 0.0207]),
          line(0.1, 0.006, 0.001, [-0.01, 0.044, 0.0207]),
          line(0.06, 0.006, 0.001, [-0.03, 0.016, 0.0207]),
        );
      case 'flask': {
        const glass = mesh(shape.flask, mats.glass, [0, -0.02, 0], false);
        glass.renderOrder = 2;
        return group(hued(mesh(shape.liquid, hueMats.none, [0, -0.02, 0])), glass);
      }
      case 'magnifier': {
        const lens = mesh(shape.lens, mats.glass, [0, 0.2, 0], false);
        lens.renderOrder = 2;
        return group(
          hued(mesh(shape.magHandle, hueMats.none, [0, 0.035, 0])),
          mesh(shape.magCollar, mats.metal, [0, 0.115, 0]),
          mesh(shape.magRing, mats.metal, [0, 0.2, 0]),
          lens,
        );
      }
      case 'ruler': {
        const r = group(hued(mesh(shape.ruler, hueMats.none, [0, 0.11, 0])));
        for (let i = 0; i < 9; i++) r.add(line(i % 2 ? 0.012 : 0.022, 0.004, 0.002, [-0.022 + (i % 2 ? 0.006 : 0.011), -0.02 + i * 0.033, 0.0058], mats.paper));
        return r;
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

    const torso = (mesh(shape.torso, mats.clay));
    const badge = hued(mesh(shape.badge, hueMats.none, [0, 0.5, FIGURE.bodyRadius - 0.012], false));
    badge.rotation.x = -0.32;
    const belt = hued(mesh(shape.belt, hueMats.none, [0, 0.2, 0], false));
    const buckle = mesh(shape.buckle, mats.metal, [0, 0.2, FIGURE.bodyRadius + 0.01], false);
    const head = (mesh(shape.head, mats.clay, [0, FIGURE.headRadius, 0]));
    const headPivot = group(head);
    headPivot.position.y = HEAD_Y;
    // Mittens, thumbs forward and in.
    const freeHand = [(mesh(shape.hand, mats.clay)), (mesh(shape.thumb, mats.clay, [-0.03, 0.018, 0.036]))];
    const handL = group(...freeHand);
    const handR = group((mesh(shape.hand, mats.clay)), (mesh(shape.thumb, mats.clay, [0.03, 0.018, 0.036])));
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

    const body = group(torso, belt, buckle, badge, headPivot, handL, handR);
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
    for (const m of parts.hued) m.material = hueMats[hue];
  }

  function raiseHand(parts: FigureParts, waiting: boolean) {
    for (const m of parts.freeHand) m.material = waiting ? mats.ask : mats.clay;
    // Raised, the hand opens a little bigger, so it reads as a hand up rather than a dot.
    for (const m of parts.freeHand) m.scale.setScalar(waiting ? 1.3 : 1);
  }

  function makeBench(): BenchParts {
    const top = mesh(shape.top, mats.benchTop, [0, BENCH.height - 0.0375, 0]);
    // Only the floor takes shadows: a bench top would show stripes where the map is stretched thin.
    top.receiveShadow = false;
    const legs = [-1, 1].map((s) => mesh(shape.leg, mats.benchLeg, [s * (BENCH.width / 2 - 0.13), (BENCH.height - 0.04) / 2, 0]));
    const shelf = mesh(shape.shelf, mats.benchLeg, [0, 0.13, 0]);
    // A thin edge round the top in the job's stop hue, and an apron under the front with the
    // stop's tag hung on it.
    const edge = mesh(shape.edge, glowMats.none, [0, BENCH.height - 0.05, 0], false);
    const apron = mesh(shape.apron, mats.benchFront, [0, BENCH.height - 0.12, BENCH.depth / 2 - 0.05]);
    const tag = mesh(shape.tag, glowMats.none, [0.56, BENCH.height - 0.19, BENCH.depth / 2 - 0.018], false);
    const icon = mesh(shape.tagIcon, iconMats.none, [0.56, BENCH.height - 0.19, BENCH.depth / 2 - 0.004], false);
    icon.renderOrder = 2;
    const bulb = mesh(shape.bulb, glowMats.none, [0.84, BENCH.height + 0.4, -0.3], false);
    const blob = mesh(shape.benchBlob, mats.blob, [0, 0.003, 0.02], false);
    blob.renderOrder = 1;
    const group0 = group(blob, top, ...legs, shelf,
      mesh(shape.lampPost, mats.metal, [0.84, BENCH.height + 0.18, -0.3]),
      mesh(shape.lampSocket, mats.metal, [0.84, BENCH.height + 0.36, -0.3]),
      mesh(shape.shade, mats.metal, [0.84, BENCH.height + 0.45, -0.3], false),
      bulb, edge, apron, tag, icon);
    return { group: group0, bulb, edge, tag, icon };
  }

  function hueBench(parts: BenchParts, hue: StopHue) {
    parts.bulb.material = glowMats[hue];
    parts.edge.material = glowMats[hue];
    parts.tag.material = glowMats[hue];
    parts.icon.material = iconMats[hue];
    parts.tag.visible = hue !== 'none';
    parts.icon.visible = hue !== 'none';
  }

  function makeRoom(layout: FloorLayout): Group {
    for (const geo of roomGeos.splice(0)) geo.dispose();
    const rg = <T extends BufferGeometry>(geo: T): T => { roomGeos.push(geo); return geo; };
    const { left, right, back, front } = layout;
    const r = 0.22;
    // The floor's outline, rounded at the front corners, in the plane (x, -z).
    const s = new Shape();
    s.moveTo(left, -back);
    s.lineTo(right, -back);
    s.lineTo(right, -front + r);
    s.quadraticCurveTo(right, -front, right - r, -front);
    s.lineTo(left + r, -front);
    s.quadraticCurveTo(left, -front, left, -front + r);
    s.lineTo(left, -back);
    // Shape space (x, y) lies on the floor as (x, -z) once turned face up.
    const floorTop = rg(new ShapeGeometry(s, 10).rotateX(-Math.PI / 2));
    const slab = rg(new ExtrudeGeometry(s, { depth: EDGE, bevelEnabled: false, curveSegments: 10 }).rotateX(-Math.PI / 2));
    const floor = new Mesh(floorTop, mats.floor);
    const catcher = new Mesh(floorTop, mats.catcher);
    catcher.position.y = 0.001;
    catcher.receiveShadow = true;
    // The floor's thickness, seen as a thin band along its front.
    const edge = new Mesh(slab, mats.floorEdge);
    edge.position.y = -EDGE - 0.002;

    // The door, freestanding at the back left: a frame, a dark opening and a step. Helpers come
    // in through it and leave through it.
    const doorW = 0.6;
    const doorH = 0.74;
    const frameT = 0.05;
    const depth = 0.1;
    const dx = layout.door.x;
    const dz = layout.door.z - 0.04;
    const door = group(
      mesh(rg(new BoxGeometry(frameT, doorH + frameT, depth)), mats.doorFrame, [dx - doorW / 2 - frameT / 2, (doorH + frameT) / 2, dz]),
      mesh(rg(new BoxGeometry(frameT, doorH + frameT, depth)), mats.doorFrame, [dx + doorW / 2 + frameT / 2, (doorH + frameT) / 2, dz]),
      mesh(rg(new BoxGeometry(doorW + frameT * 2, frameT, depth)), mats.doorFrame, [dx, doorH + frameT / 2, dz]),
      mesh(rg(new BoxGeometry(doorW + 0.16, 0.014, 0.22)), mats.doorFrame, [dx, 0.007, dz + 0.05], false),
    );
    const doorway = new Mesh(rg(new PlaneGeometry(doorW, doorH)), mats.doorway);
    doorway.position.set(dx, doorH / 2, dz - 0.01);
    return group(edge, floor, catcher, door, doorway);
  }

  return {
    makeFigure,
    makeBench,
    hueFigure,
    hueBench,
    raiseHand,
    makeRoom,
    lights: () => ({ hemi, sun, rim }),
    lampMaterial: (k) => lampMats[k],
    deviceLamp: (on) => (on ? lampMats.running : mats.lampOff),
    setPalette,
    disposables: () => [...geos, ...roomGeos, ...Object.values(mats), ...Object.values(lampMats), ...Object.values(hueMats), ...Object.values(glowMats), ...Object.values(iconMats), ...Object.values(iconTex), blobTex],
    dispose() {
      for (const d of [...geos.splice(0), ...roomGeos.splice(0)]) d.dispose();
      for (const m of [...Object.values(mats), ...Object.values(lampMats), ...Object.values(hueMats), ...Object.values(glowMats), ...Object.values(iconMats)]) m.dispose();
      for (const t of Object.values(iconTex)) t?.dispose();
      blobTex.dispose();
      hemi.dispose();
      sun.dispose();
      rim.dispose();
    },
  };
}

