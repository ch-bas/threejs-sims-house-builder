import type * as ThreeNS from 'three';
import type { RoofSpec, RoofStyle } from '../lib/types';

type ThreeModule = typeof import('three');

export const ROOF_TAG = 'roof';

/** Eaves: how far the roof overhangs past the wall plane (metres). */
const EAVE_OVERHANG = 0.35;

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
}

export function removeRoof(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === ROOF_TAG)
    .forEach((obj) => scene.remove(obj));
}

function defaultRoofColor(style: RoofStyle): string {
  switch (style) {
    case 'flat':
      return '#546e7a';
    case 'gable':
      return '#8d6e63';
    case 'hipped':
      return '#a1887f';
    default:
      return '#90a4ae';
  }
}

function buildFlatRoof(
  THREE: ThreeModule,
  { width, depth, baseY }: BuildRoofOptions,
  color: string
): ThreeNS.Object3D {
  const thickness = 0.2;
  const w = width + EAVE_OVERHANG * 2;
  const d = depth + EAVE_OVERHANG * 2;
  const material = buildShingleMaterial(THREE, color, w, d);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, thickness, d), material);
  mesh.position.set(0, baseY + thickness / 2, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.type = ROOF_TAG;
  return mesh;
}

function buildGableRoof(
  THREE: ThreeModule,
  { width, depth, baseY }: BuildRoofOptions,
  color: string
): ThreeNS.Object3D {
  // Ridge runs along the longer axis so the slopes shed water from the long sides.
  const ridgeAlongX = width >= depth;
  const length = (ridgeAlongX ? width : depth) + EAVE_OVERHANG * 2;
  const span = (ridgeAlongX ? depth : width) + EAVE_OVERHANG * 2;
  const peakHeight = Math.min(2.5, span * 0.5);

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

  const slopeLength = Math.hypot(span / 2, peakHeight);
  const material = buildShingleMaterial(THREE, color, slopeLength, length, true);
  const mesh = new THREE.Mesh(geometry, material);
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
  { width, depth, baseY }: BuildRoofOptions,
  color: string
): ThreeNS.Object3D {
  const w = width + EAVE_OVERHANG * 2;
  const d = depth + EAVE_OVERHANG * 2;
  const peakHeight = Math.min(2.2, Math.min(w, d) * 0.45);
  const halfW = w / 2;
  const halfD = d / 2;

  // Five vertices: four base corners and one apex.
  const vertices = new Float32Array([
    -halfW, 0, -halfD, // 0 back-left
     halfW, 0, -halfD, // 1 back-right
     halfW, 0,  halfD, // 2 front-right
    -halfW, 0,  halfD, // 3 front-left
     0,     peakHeight, 0, // 4 apex
  ]);

  // Four triangle faces (one per side).
  const indices = new Uint16Array([
    0, 1, 4,
    1, 2, 4,
    2, 3, 4,
    3, 0, 4,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const slopeLength = Math.hypot(Math.min(halfW, halfD), peakHeight);
  const material = buildShingleMaterial(THREE, color, slopeLength * 2, slopeLength * 2, true);
  const mesh = new THREE.Mesh(geometry, material);
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
 * Canvas-painted asphalt-shingle pattern. Rows of staggered rectangles in
 * subtle tonal shifts of the base roof colour. Cheap to build, reads as
 * shingles at orbit-camera distance.
 */
function buildShingleMaterial(
  THREE: ThreeModule,
  color: string,
  surfaceWidth: number,
  surfaceLength: number,
  doubleSided = false
): ThreeNS.MeshStandardMaterial {
  const size = 256;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      ...(doubleSided ? { side: THREE.DoubleSide } : {}),
    });
  }
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      ...(doubleSided ? { side: THREE.DoubleSide } : {}),
    });
  }

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
  // Aim for ~3 shingle rows per metre of slope.
  texture.repeat.set(Math.max(1, surfaceWidth * 0.6), Math.max(1, surfaceLength * 0.6));

  return new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.92,
    ...(doubleSided ? { side: THREE.DoubleSide } : {}),
  });
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
