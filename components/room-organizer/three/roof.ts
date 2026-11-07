import { ROOF_STYLE_DEFAULT_COLORS } from '../lib/constants';
import { ROOF_EAVE_OVERHANG } from '../lib/dormers';
import { footprintOutline } from '../lib/footprint';
import { removeAndDispose } from './builder-utils';
import { buildDormers, buildDormerWell, dormerWells } from './dormers';
import { shutOutIndoorLampsUnder } from './outdoor-lamps';
import { DisposableLruCache } from './texture-lru';
import { withMaxAnisotropy } from './texture-settings';
import { DEFAULT_WALL_COLOR, buildWallMaterial } from './wall-patterns';
import type { FloorLayout, FootprintCutout, RoofSpec, RoofStyle, WallId, WallPattern } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('./three-runtime');

export const ROOF_TAG = 'roof';

/**
 * Cache the painted shingle CanvasTexture keyed on colour (the canvas drawing
 * depends only on colour; the 256px size is fixed). Per-surface `repeat` and
 * the `side` flag live on the clone/material, not the master. Each roof gets a
 * `.clone()` sharing the cached canvas image (cheap) that is independently
 * disposable. The cache is LRU-capped because the colour is user-pickable:
 * evicted masters are disposed, which is safe for live clones (see
 * texture-lru.ts), while cached masters keep the shared GPU image alive.
 */
const shingleTextureCache = new DisposableLruCache<ThreeNS.CanvasTexture>();

/** Eaves: how far the roof overhangs past the wall plane (metres). Mirrored by lib/dormers.ts. */
const EAVE_OVERHANG = ROOF_EAVE_OVERHANG;
const FLAT_ROOF_THICKNESS = 0.2;
/** Shingle texture tiles per metre of roof surface, the same on every roof style and size (#211). */
const SHINGLE_TILES_PER_METRE = 0.6;

export const ROOF_LABELS: Record<RoofStyle, string> = {
  none: 'No roof',
  flat: 'Flat',
  gable: 'Gable',
  hipped: 'Hipped',
};

export interface BuildRoofOptions {
  scene: ThreeNS.Scene;
  width: number;
  depth: number;
  /** Y-position of the roof base (top of the highest floor). */
  baseY: number;
  spec: RoofSpec;
  /**
   * The corner taken out of the footprint (#727): the slab follows the L.
   * Only a flat roof covers one; the reducer and the schema keep pitched
   * roofs off an L, and one that reaches here all the same builds flat.
   */
  cutout?: FootprintCutout | undefined;
  /**
   * Multiplier on the peak height (default 1). Only the dormer-less
   * neighbour roofs use it (#310): lib/dormers.ts fits dormers to the
   * unscaled slope, so our own roof always builds at 1.
   */
  pitch?: number;
  /**
   * The top storey's walls (#661): a gable end is the wall carried up to the
   * roof, so it wears that side's colour and pattern. Without it the ends
   * are the default wall colour.
   */
  gableWalls?: GableWalls | undefined;
}

export interface GableWalls {
  pattern?: WallPattern | undefined;
  colors?: Partial<Record<WallId, string>> | undefined;
  /** The height the walls' pattern starts from: the house's is the ground (0), a neighbour's its block's foot. */
  patternOriginY?: number | undefined;
}

/** The walls a gable carries up: the top storey's, or none for any other roof. */
export function gableWallsOf(style: RoofStyle | undefined, floors: readonly FloorLayout[]): GableWalls | undefined {
  const top = floors[floors.length - 1];
  if (style !== 'gable' || !top) return undefined;
  return { pattern: top.wallPattern, colors: top.wallColors };
}

export function buildRoof(THREE: ThreeModule, options: BuildRoofOptions): void {
  removeRoof(options.scene);
  if (options.spec.style === 'none') return;
  const first = options.scene.children.length;
  buildRoofParts(THREE, options);
  // The roof is outdoors: a lamp under the eaves lit its soffit and fascia
  // through the wall (#814). A dormer is seen from the attic too, so it
  // masks its own parts (`buildDormers`): face and cheeks by face, the top
  // whole; its frames and glass face away from a lamp in the room below.
  for (const part of options.scene.children.slice(first)) {
    if (part.userData.dormerId === undefined) shutOutIndoorLampsUnder(THREE, part);
  }
}

function buildRoofParts(THREE: ThreeModule, options: BuildRoofOptions): void {

  const color = options.spec.color ?? defaultRoofColor(options.spec.style);

  if (options.cutout) {
    options.scene.add(buildFlatRoof(THREE, options, color));
    return;
  }

  switch (options.spec.style) {
    case 'flat':
      options.scene.add(buildFlatRoof(THREE, options, color));
      break;
    case 'gable':
      options.scene.add(buildGableRoof(THREE, options, color));
      break;
    case 'hipped':
      options.scene.add(buildHippedRoof(THREE, options, color));
      break;
    case 'none':
      return;
  }

  // Dormers (#203) stand on the gable / hipped slopes; flat roofs have none.
  if (options.spec.dormers?.length) {
    const dormers = buildDormers(THREE, options.spec.dormers, {
      style: options.spec.style,
      width: options.width,
      depth: options.depth,
      baseY: options.baseY,
      roofColor: darkenHex(color, 0.15),
      tag: ROOF_TAG,
    });
    for (const dormer of dormers) options.scene.add(dormer);
  }
}

/**
 * Rise of the roof above its base for a footprint: the gable ridge or the
 * hipped apex (a flat roof is its slab). Exported so chimneys and dormers
 * built outside this module can find the slope.
 */
export function roofPeakHeight(style: RoofStyle, width: number, depth: number, pitch = 1): number {
  const w = width + EAVE_OVERHANG * 2;
  const d = depth + EAVE_OVERHANG * 2;
  switch (style) {
    case 'gable':
      // The ridge runs along the longer axis; the span is the shorter one.
      return Math.min(2.5, Math.min(w, d) * 0.5) * pitch;
    case 'hipped':
      return Math.min(2.2, Math.min(w, d) * 0.45) * pitch;
    case 'flat':
      return FLAT_ROOF_THICKNESS;
    case 'none':
      return 0;
  }
}

/**
 * userData flag on the roof's top-level objects while the active storey is
 * below the top one: the roof stays built and only hides, so a floor switch
 * flips visibility instead of rebuilding the roof and every dormer (#283).
 * applyWallDisplay honours it in every wall-display mode.
 */
export const ROOF_OFF_STOREY_KEY = 'roofOffStorey';

export function setRoofOnStorey(scene: ThreeNS.Scene, onStorey: boolean): void {
  for (const obj of scene.children) {
    if (obj.userData.type === ROOF_TAG) obj.userData[ROOF_OFF_STOREY_KEY] = !onStorey;
  }
}

export function removeRoof(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === ROOF_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

/**
 * The shingled roof bodies: the slab, the gable or the hipped slopes. A
 * WeakSet, not a userData flag: GLTFExporter writes userData into the GLB.
 */
const roofShells = new WeakSet<ThreeNS.Object3D>();

/** Tag of the walkthrough attic ceiling (#487). */
export const ATTIC_TAG = 'attic-ceiling';

/** Below the roof's base, which a gable or a flat roof closes with a face (#276). */
export const ATTIC_CEILING_GAP = 0.01;

const ATTIC_COLOR = 0xf4f1ea;

export interface AtticCeilingOptions {
  scene: ThreeNS.Scene;
  width: number;
  depth: number;
  /** Y of the roof base (top of the highest storey). */
  baseY: number;
  spec: RoofSpec;
  /** The corner taken out of the footprint (#727). */
  cutout?: FootprintCutout | undefined;
}

/**
 * What the walker on the top storey sees overhead (#487): a plain plaster
 * ceiling just under the roof, out to the eaves so it also reads as the
 * soffit from a window, instead of the roof's shingled underside. Under each
 * dormer it opens into a lined well up to the dormer, whose glazed face
 * then shows from inside. Only the walkthrough builds it; the roof itself
 * is untouched, so the house from outside and the GLB export don't change.
 * Returns the number of dormer wells (the caller hides the roof shell with
 * `setRoofShellHidden` when there are any), or null when nothing is built.
 */
export function buildAtticCeiling(THREE: ThreeModule, options: AtticCeilingOptions): number | null {
  const { scene, width, depth, baseY, spec, cutout } = options;
  removeAtticCeiling(scene);
  if (spec.style === 'none') return null;

  const wells = spec.style === 'flat' ? [] : dormerWells(spec.style, width, depth, baseY, spec.dormers ?? []);
  const group = new THREE.Group();
  group.name = 'Attic ceiling';
  group.userData.type = ATTIC_TAG;
  const material = new THREE.MeshStandardMaterial({ color: ATTIC_COLOR, roughness: 0.95, side: THREE.DoubleSide });
  const ceilingY = baseY - ATTIC_CEILING_GAP;

  // Laid out in XY and turned flat: shape y is world −z.
  const outline = eaveOutline(THREE, width, depth, cutout);
  for (const { rect } of wells) {
    const hole = new THREE.Path();
    hole.moveTo(rect.x0, -rect.z1);
    hole.lineTo(rect.x1, -rect.z1);
    hole.lineTo(rect.x1, -rect.z0);
    hole.lineTo(rect.x0, -rect.z0);
    hole.closePath();
    outline.holes.push(hole);
  }
  const plate = new THREE.Mesh(new THREE.ShapeGeometry(outline), material);
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = ceilingY;
  plate.name = 'Attic ceiling plate';
  group.add(plate);
  for (const { frame } of wells) group.add(buildDormerWell(THREE, frame, ceilingY, material));

  // The roof above still casts the house's shadow; the ceiling adds none, so
  // entering and leaving the top storey needn't redraw the shadow map.
  group.traverse((obj) => {
    obj.castShadow = false;
    obj.receiveShadow = false;
  });
  scene.add(group);
  return wells.length;
}

export function removeAtticCeiling(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === ATTIC_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

/**
 * Stop drawing the roof's shingled body, while keeping its shadow, its
 * fascia and its dormers: under the attic ceiling's dormer wells it would
 * otherwise close every well with its underside (#487). Only the colour and
 * depth writes go, not the object's visibility, which the wall-display
 * modes own (applyWallDisplay), and not the shadow pass, which ignores both.
 */
export function setRoofShellHidden(scene: ThreeNS.Scene, hidden: boolean): void {
  for (const obj of scene.children) {
    if (obj.userData.type !== ROOF_TAG) continue;
    obj.traverse((child) => {
      if (!roofShells.has(child) || !('material' in child)) return;
      const materials = child.material as ThreeNS.Material | ThreeNS.Material[];
      for (const material of Array.isArray(materials) ? materials : [materials]) {
        material.colorWrite = !hidden;
        material.depthWrite = !hidden;
      }
    });
  }
}

function defaultRoofColor(style: RoofStyle): string {
  return ROOF_STYLE_DEFAULT_COLORS[style];
}

/** The footprint out to the eaves, laid out in XY: shape y is world −z. */
function eaveOutline(THREE: ThreeModule, width: number, depth: number, cutout: FootprintCutout | undefined): ThreeNS.Shape {
  const outline = new THREE.Shape();
  footprintOutline({ width, height: depth, cutout }, EAVE_OVERHANG).forEach(({ x, z }, index) => {
    if (index === 0) outline.moveTo(x, -z);
    else outline.lineTo(x, -z);
  });
  outline.closePath();
  return outline;
}

function buildFlatRoof(
  THREE: ThreeModule,
  { width, depth, baseY, cutout }: BuildRoofOptions,
  color: string
): ThreeNS.Object3D {
  const thickness = FLAT_ROOF_THICKNESS;
  const w = width + EAVE_OVERHANG * 2;
  const d = depth + EAVE_OVERHANG * 2;
  const material = buildShingleMaterial(THREE, color);
  let geometry: ThreeNS.BufferGeometry;
  if (cutout) {
    geometry = new THREE.ExtrudeGeometry(eaveOutline(THREE, width, depth, cutout), { depth: thickness, bevelEnabled: false });
    // Stand it up, centred on the slab's height as the box is.
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -thickness / 2, 0);
  } else {
    geometry = new THREE.BoxGeometry(w, thickness, d);
  }
  const mesh = new THREE.Mesh(withSurfaceUvs(THREE, geometry), material);
  mesh.position.set(0, baseY + thickness / 2, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Roof';
  mesh.userData.type = ROOF_TAG;
  roofShells.add(mesh);
  return mesh;
}

function buildGableRoof(
  THREE: ThreeModule,
  { width, depth, baseY, pitch = 1, gableWalls }: BuildRoofOptions,
  color: string
): ThreeNS.Object3D {
  // Ridge runs along the longer axis so the slopes shed water from the long sides.
  const ridgeAlongX = width >= depth;
  const wallLength = ridgeAlongX ? width : depth;
  const length = wallLength + EAVE_OVERHANG * 2;
  const span = (ridgeAlongX ? depth : width) + EAVE_OVERHANG * 2;
  const peakHeight = roofPeakHeight('gable', width, depth, pitch);

  // Built with the ridge along local z. The body is a triangular prism that
  // stops at the gable walls, so each end is the wall carried up to the roof
  // (#661); the slopes then run on past it as a thin verge, whose end is the
  // bargeboard and whose underside, like the body's, is a painted soffit
  // rather than shingles.
  const triangle = new THREE.Shape();
  triangle.moveTo(-span / 2, 0);
  triangle.lineTo(span / 2, 0);
  triangle.lineTo(0, peakHeight);
  triangle.closePath();
  const body = new THREE.ExtrudeGeometry(triangle, { depth: wallLength, bevelEnabled: false });
  body.translate(0, 0, -wallLength / 2);

  const inner = (span / 2) * (1 - VERGE_THICKNESS / peakHeight);
  const chevron = new THREE.Shape();
  chevron.moveTo(-span / 2, 0);
  chevron.lineTo(-inner, 0);
  chevron.lineTo(0, peakHeight - VERGE_THICKNESS);
  chevron.lineTo(inner, 0);
  chevron.lineTo(span / 2, 0);
  chevron.lineTo(0, peakHeight);
  chevron.closePath();
  const verges = [-1, 1].map((sign) => {
    const verge = new THREE.ExtrudeGeometry(chevron, { depth: EAVE_OVERHANG, bevelEnabled: false });
    verge.translate(0, 0, sign > 0 ? wallLength / 2 : -wallLength / 2 - EAVE_OVERHANG);
    return verge;
  });

  // The two gable ends: local −z and +z, which a ridge along x turns to west and east.
  const ends: [WallId, WallId] = ridgeAlongX ? ['west', 'east'] : ['north', 'south'];
  const half = wallLength / 2;
  // Two ends in the same finish share one material, and so one draw.
  const sameEnds = gableWalls?.colors?.[ends[0]] === gableWalls?.colors?.[ends[1]];
  const geometry = groupByFace(THREE, [body, ...verges], (normal, centre) => {
    if (normal.y < -0.5) return GABLE_PART.soffit;
    if (Math.abs(normal.z) > 0.9) {
      if (Math.abs(centre.z) > half + EAVE_OVERHANG / 2) return GABLE_PART.barge;
      // A verge's inner end faces into the body and never shows: dropped.
      if (Math.sign(normal.z) !== Math.sign(centre.z)) return -1;
      return centre.z < 0 || sameEnds ? GABLE_PART.endLow : GABLE_PART.endHigh;
    }
    return GABLE_PART.shingle;
  });

  const fasciaColor = darkenHex(color, 0.4);
  const materials: ThreeNS.Material[] = [];
  materials[GABLE_PART.shingle] = buildShingleMaterial(THREE, color, true);
  materials[GABLE_PART.soffit] = soffitMaterial(THREE);
  materials[GABLE_PART.barge] = new THREE.MeshStandardMaterial({ color: fasciaColor, roughness: 0.7 });
  materials[GABLE_PART.endLow] = gableEndMaterial(THREE, gableWalls, ends[0], baseY);
  if (!sameEnds) materials[GABLE_PART.endHigh] = gableEndMaterial(THREE, gableWalls, ends[1], baseY);
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.position.y = baseY;
  if (ridgeAlongX) mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Roof';
  mesh.userData.type = ROOF_TAG;
  roofShells.add(mesh);

  // Fascia: thin trim board running along each eave for a clean edge.
  const group = new THREE.Group();
  group.add(mesh);
  group.name = 'Gable';
  group.userData.type = ROOF_TAG;
  addFascia(THREE, group, length, span, fasciaColor, baseY, ridgeAlongX);
  return group;
}

/** How deep the verge (the slopes past a gable wall) is, measured plumb. */
const VERGE_THICKNESS = 0.12;
const SOFFIT_COLOR = 0xf1ece2;

/** Material slots of a gable roof's mesh, one draw each. */
const GABLE_PART = { shingle: 0, soffit: 1, barge: 2, endLow: 3, endHigh: 4 } as const;

function soffitMaterial(THREE: ThreeModule): ThreeNS.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: SOFFIT_COLOR, roughness: 0.9 });
}

/** A gable end in its wall's finish, its courses running on from the wall below (#661). */
function gableEndMaterial(THREE: ThreeModule, walls: GableWalls | undefined, side: WallId, baseY: number): ThreeNS.Material {
  const color = walls?.colors?.[side] ?? DEFAULT_WALL_COLOR;
  const pattern = walls?.pattern ?? 'solid';
  // The painters need a canvas; without one (tests) a pattern is its colour.
  if (pattern === 'solid' || typeof document === 'undefined') {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  }
  // The roof's UVs are metres with v = 0 at its base: one tile per metre's
  // repeat, lifted by the eaves height like the top storey's wall.
  return buildWallMaterial(THREE, { pattern, color, width: 1, height: 1, yOffset: baseY - (walls?.patternOriginY ?? 0) });
}

/**
 * Merge geometries into one, with metre UVs, and sort its triangles into one
 * group per material slot that `slot` picks from each triangle's outward
 * normal and centre (a negative slot drops the triangle). One mesh, one draw
 * per slot.
 */
function groupByFace(
  THREE: ThreeModule,
  parts: readonly ThreeNS.BufferGeometry[],
  slot: (normal: ThreeNS.Vector3, centre: ThreeNS.Vector3) => number
): ThreeNS.BufferGeometry {
  const flats = parts.map((part) => withSurfaceUvs(THREE, part));
  const buckets: number[][] = [];
  const normal = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const flat of flats) {
    const position = flat.getAttribute('position');
    const uv = flat.getAttribute('uv');
    for (let i = 0; i + 2 < position.count; i += 3) {
      a.fromBufferAttribute(position, i);
      b.fromBufferAttribute(position, i + 1);
      c.fromBufferAttribute(position, i + 2);
      centre.copy(a).add(b).add(c).divideScalar(3);
      normal.subVectors(c, b).cross(a.clone().sub(b)).normalize();
      const index = slot(normal, centre);
      if (index < 0) continue;
      const bucket = (buckets[index] ??= []);
      for (let k = i; k < i + 3; k++) bucket.push(position.getX(k), position.getY(k), position.getZ(k), uv.getX(k), uv.getY(k));
    }
    flat.dispose();
  }
  const vertices = buckets.reduce((sum, bucket) => sum + (bucket ? bucket.length / 5 : 0), 0);
  const positions = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const geometry = new THREE.BufferGeometry();
  let at = 0;
  buckets.forEach((bucket, index) => {
    if (!bucket) return;
    const count = bucket.length / 5;
    for (let v = 0; v < count; v++) {
      positions.set(bucket.slice(v * 5, v * 5 + 3), (at + v) * 3);
      uvs.set(bucket.slice(v * 5 + 3, v * 5 + 5), (at + v) * 2);
    }
    geometry.addGroup(at, count, index);
    at += count;
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function buildHippedRoof(
  THREE: ThreeModule,
  { width, depth, baseY, pitch = 1 }: BuildRoofOptions,
  color: string
): ThreeNS.Object3D {
  const w = width + EAVE_OVERHANG * 2;
  const d = depth + EAVE_OVERHANG * 2;
  const peakHeight = roofPeakHeight('hipped', width, depth, pitch);
  const halfW = w / 2;
  const halfD = d / 2;

  // Four base corners and the apex.
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [-halfW, 0, -halfD], // 0 back-left
    [halfW, 0, -halfD], // 1 back-right
    [halfW, 0, halfD], // 2 front-right
    [-halfW, 0, halfD], // 3 front-left
    [0, peakHeight, 0], // 4 apex
  ];

  // Four triangle faces (one per side). Wound counter-clockwise when viewed
  // from outside so each slope's normal points up-and-outward; the naive
  // (0,1,4)… order winds them inward/down (normals verified by cross-product),
  // which reads inside-out under shadows/AO and vanishes without DoubleSide.
  // Unshared vertices: each slope gets its own flat normal and UVs (#211).
  // Then the base, facing down: the soffit under the eaves, so the roof is a
  // closed body rather than a sheet showing shingles from below (#661).
  const faces = [1, 0, 4, 2, 1, 4, 3, 2, 4, 0, 3, 4, 0, 1, 2, 0, 2, 3];
  const vertices = new Float32Array(faces.flatMap((i) => corners[i] ?? []));

  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  const geometry = groupByFace(THREE, [shell], (normal) => (normal.y < -0.5 ? 1 : 0));

  const mesh = new THREE.Mesh(geometry, [buildShingleMaterial(THREE, color, true), soffitMaterial(THREE)]);
  mesh.position.y = baseY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Roof';
  mesh.userData.type = ROOF_TAG;
  roofShells.add(mesh);

  // A fascia board along all four eaves (#661): the front and back boards
  // run over the corners, the side boards stop at them, so no two overlap.
  const group = new THREE.Group();
  group.add(mesh);
  group.name = 'Hipped';
  group.userData.type = ROOF_TAG;
  const fasciaColor = darkenHex(color, 0.4);
  addFascia(THREE, group, w + FASCIA_THICKNESS * 1.4, d, fasciaColor, baseY, true);
  addFascia(THREE, group, d - FASCIA_THICKNESS * 1.4, w, fasciaColor, baseY, false);
  return group;
}

const FASCIA_THICKNESS = 0.1;
/**
 * The fascia hangs this far below the roof's base, so its underside never
 * shares the soffit's plane (#276, #661).
 */
const FASCIA_DROP = 0.03;

function addFascia(
  THREE: ThreeModule,
  parent: ThreeNS.Group,
  length: number,
  span: number,
  color: string,
  baseY: number,
  ridgeAlongX: boolean
): void {
  const thickness = FASCIA_THICKNESS;
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  // The two fascia boards run along the eaves — one each side of the ridge.
  // `length` is the long axis (parallel to the ridge), `span` is the gable
  // base. Place the boards along the long axis at ±halfSpan perpendicular
  // to the ridge.
  for (const sign of [-1, 1] as const) {
    const fascia = new THREE.Mesh(
      new THREE.BoxGeometry(length, thickness, thickness * 1.4),
      material
    );
    if (ridgeAlongX) {
      // Ridge runs along world X, so the fascia at z = ±halfSpan also runs
      // along world X — leave rotation at 0.
      fascia.position.set(0, baseY + thickness / 2 - FASCIA_DROP, sign * (span / 2));
    } else {
      // Ridge runs along world Z. Rotate the board so its length is along Z.
      fascia.rotation.y = Math.PI / 2;
      fascia.position.set(sign * (span / 2), baseY + thickness / 2 - FASCIA_DROP, 0);
    }
    fascia.castShadow = true;
    fascia.receiveShadow = true;
    fascia.name = 'Fascia';
    fascia.userData.type = ROOF_TAG;
    parent.add(fascia);
  }
}

/**
 * Planar UVs in metres for a non-indexed triangle list: per face, u runs along
 * the eave (horizontal, in the face plane) and v up the slope, so shingle rows
 * lie parallel to the eaves and one constant texture repeat gives the same row
 * height on every roof style and size (#211). Horizontal faces map u to x.
 * Pure, exported for tests.
 */
export function roofSurfaceUvs(positions: ArrayLike<number>): Float32Array {
  const at = (i: number): number => positions[i] ?? 0;
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let t = 0; t + 9 <= positions.length; t += 9) {
    const e1x = at(t + 3) - at(t), e1y = at(t + 4) - at(t + 1), e1z = at(t + 5) - at(t + 2);
    const e2x = at(t + 6) - at(t), e2y = at(t + 7) - at(t + 1), e2z = at(t + 8) - at(t + 2);
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    // Eave axis: up × n, horizontal and in the face plane.
    let ux = nz;
    let uz = -nx;
    const uLen = Math.hypot(ux, uz);
    if (uLen < 1e-6) {
      ux = 1;
      uz = 0;
    } else {
      ux /= uLen;
      uz /= uLen;
    }
    // Up-slope axis: n × eave.
    const vx = ny * uz;
    const vy = nz * ux - nx * uz;
    const vz = -ny * ux;
    for (let i = t; i < t + 9; i += 3) {
      uvs[(i / 3) * 2] = at(i) * ux + at(i + 2) * uz;
      uvs[(i / 3) * 2 + 1] = at(i) * vx + at(i + 1) * vy + at(i + 2) * vz;
    }
  }
  return uvs;
}

function withSurfaceUvs(THREE: ThreeModule, geometry: ThreeNS.BufferGeometry): ThreeNS.BufferGeometry {
  let flat = geometry;
  if (geometry.index) {
    flat = geometry.toNonIndexed();
    geometry.dispose();
  }
  flat.setAttribute('uv', new THREE.BufferAttribute(roofSurfaceUvs(flat.getAttribute('position').array), 2));
  return flat;
}

/**
 * Canvas-painted asphalt-shingle pattern. Rows of staggered rectangles in
 * subtle tonal shifts of the base roof colour. Cheap to build, reads as
 * shingles at orbit-camera distance.
 */
function buildShingleMaterial(
  THREE: ThreeModule,
  color: string,
  doubleSided = false
): ThreeNS.MeshStandardMaterial {
  const master = getShingleTexture(THREE, color);
  if (!master) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      ...(doubleSided ? { side: THREE.DoubleSide } : {}),
    });
  }

  // Clone per roof so each surface owns a disposable copy sharing the cached
  // canvas image. (`Texture.clone()` already flags needsUpdate, so no
  // explicit re-upload.) The geometry's UVs are in metres (roofSurfaceUvs).
  const texture = withMaxAnisotropy(master.clone());
  texture.repeat.set(SHINGLE_TILES_PER_METRE, SHINGLE_TILES_PER_METRE);

  return new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.92,
    ...(doubleSided ? { side: THREE.DoubleSide } : {}),
  });
}

function getShingleTexture(THREE: ThreeModule, color: string): ThreeNS.CanvasTexture | null {
  const cached = shingleTextureCache.get(color);
  if (cached) return cached;

  const size = 256;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) return null;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  const rows = 10;
  const rowHeight = size / rows;
  const shinglesPerRow = 7;
  const shingleWidth = size / shinglesPerRow;
  for (let r = 0; r < rows; r += 1) {
    const y = r * rowHeight;
    const offset = (r % 2) * (shingleWidth / 2);
    for (let c = -1; c <= shinglesPerRow; c += 1) {
      const x = c * shingleWidth + offset;
      // Random-ish tonal shift per shingle so it reads less flat.
      const seed = (r * 73 + c * 17) % 100;
      const shade = 0.86 + (seed / 100) * 0.20;
      ctx.fillStyle = shadeHex(color, shade);
      ctx.fillRect(x + 1, y + 1, shingleWidth - 2, rowHeight * 0.78);
    }
    // Dark gutter line between rows for the lap shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(0, y + rowHeight * 0.78, size, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Albedo CanvasTextures default to NoColorSpace (linear); tag sRGB so it's
  // decoded before lighting instead of rendering washed-out under sRGB output.
  texture.colorSpace = THREE.SRGBColorSpace;
  withMaxAnisotropy(texture);

  shingleTextureCache.set(color, texture);
  return texture;
}

function shadeHex(hex: string, multiplier: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const r = Math.min(255, Math.round(parseInt(normalized.slice(0, 2), 16) * multiplier));
  const g = Math.min(255, Math.round(parseInt(normalized.slice(2, 4), 16) * multiplier));
  const b = Math.min(255, Math.round(parseInt(normalized.slice(4, 6), 16) * multiplier));
  return `rgb(${r}, ${g}, ${b})`;
}

function darkenHex(hex: string, amount: number): string {
  return shadeHex(hex, 1 - Math.max(0, Math.min(1, amount)));
}
