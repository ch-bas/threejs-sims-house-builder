import { ROOF_STYLE_DEFAULT_COLORS } from '../lib/constants';
import { ROOF_EAVE_OVERHANG } from '../lib/dormers';
import { removeAndDispose } from './builder-utils';
import { buildDormers } from './dormers';
import { DisposableLruCache } from './texture-lru';
import { getMaxAnisotropy } from './texture-settings';
import type { RoofSpec, RoofStyle } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

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
   * Multiplier on the peak height (default 1). Only the dormer-less
   * neighbour roofs use it (#310): lib/dormers.ts fits dormers to the
   * unscaled slope, so our own roof always builds at 1.
   */
  pitch?: number;
}

export function buildRoof(THREE: ThreeModule, options: BuildRoofOptions): void {
  removeRoof(options.scene);
  if (options.spec.style === 'none') return;

  const color = options.spec.color ?? defaultRoofColor(options.spec.style);

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

export function removeRoof(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === ROOF_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

function defaultRoofColor(style: RoofStyle): string {
  return ROOF_STYLE_DEFAULT_COLORS[style];
}

function buildFlatRoof(
  THREE: ThreeModule,
  { width, depth, baseY }: BuildRoofOptions,
  color: string
): ThreeNS.Object3D {
  const thickness = FLAT_ROOF_THICKNESS;
  const w = width + EAVE_OVERHANG * 2;
  const d = depth + EAVE_OVERHANG * 2;
  const material = buildShingleMaterial(THREE, color);
  const mesh = new THREE.Mesh(withSurfaceUvs(THREE, new THREE.BoxGeometry(w, thickness, d)), material);
  mesh.position.set(0, baseY + thickness / 2, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.type = ROOF_TAG;
  return mesh;
}

function buildGableRoof(
  THREE: ThreeModule,
  { width, depth, baseY, pitch = 1 }: BuildRoofOptions,
  color: string
): ThreeNS.Object3D {
  // Ridge runs along the longer axis so the slopes shed water from the long sides.
  const ridgeAlongX = width >= depth;
  const length = (ridgeAlongX ? width : depth) + EAVE_OVERHANG * 2;
  const span = (ridgeAlongX ? depth : width) + EAVE_OVERHANG * 2;
  const peakHeight = roofPeakHeight('gable', width, depth, pitch);

  // Triangle cross-section, extruded to `length`.
  const triangle = new THREE.Shape();
  triangle.moveTo(-span / 2, 0);
  triangle.lineTo(span / 2, 0);
  triangle.lineTo(0, peakHeight);
  triangle.closePath();

  const geometry = new THREE.ExtrudeGeometry(triangle, {
    depth: length,
    bevelEnabled: false,
  });
  // Centre the extrude along its axis.
  geometry.translate(0, 0, -length / 2);

  const material = buildShingleMaterial(THREE, color, true);
  const mesh = new THREE.Mesh(withSurfaceUvs(THREE, geometry), material);
  mesh.position.y = baseY;
  if (ridgeAlongX) mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.type = ROOF_TAG;

  // Fascia: thin trim board running along each eave for a clean edge.
  const group = new THREE.Group();
  group.add(mesh);
  group.userData.type = ROOF_TAG;
  const fasciaColor = darkenHex(color, 0.4);
  addFascia(THREE, group, length, span, fasciaColor, baseY, ridgeAlongX);
  return group;
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
  const faces = [1, 0, 4, 2, 1, 4, 3, 2, 4, 0, 3, 4];
  const vertices = new Float32Array(faces.flatMap((i) => corners[i] ?? []));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();

  const material = buildShingleMaterial(THREE, color, true);
  const mesh = new THREE.Mesh(withSurfaceUvs(THREE, geometry), material);
  mesh.position.y = baseY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.type = ROOF_TAG;
  return mesh;
}

function addFascia(
  THREE: ThreeModule,
  parent: ThreeNS.Group,
  length: number,
  span: number,
  color: string,
  baseY: number,
  ridgeAlongX: boolean
): void {
  const thickness = 0.10;
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
      fascia.position.set(0, baseY + thickness / 2, sign * (span / 2));
    } else {
      // Ridge runs along world Z. Rotate the board so its length is along Z.
      fascia.rotation.y = Math.PI / 2;
      fascia.position.set(sign * (span / 2), baseY + thickness / 2, 0);
    }
    fascia.castShadow = true;
    fascia.receiveShadow = true;
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
  const texture = master.clone();
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
  texture.anisotropy = getMaxAnisotropy();

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
