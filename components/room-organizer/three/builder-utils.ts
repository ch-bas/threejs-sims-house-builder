import { OUTSIDE_FACE_ATTRIBUTE } from './outdoor-lamps';
import type { FurnitureItem } from '../lib/types';
import type * as ThreeNS from 'three';

export type ThreeModule = typeof import('./three-runtime');

export interface BuilderContext {
  THREE: ThreeModule;
  item: FurnitureItem;
  hasCollision: boolean;
  baseColor: ThreeNS.ColorRepresentation;
  opacity: number;
  /** Floor-to-ceiling height of the item's storey; a pendant hangs from it (#470). */
  storeyHeight?: number;
}

export type FurnitureBuilder = (ctx: BuilderContext) => ThreeNS.Group;

/**
 * Geometries several objects draw, such as the cached people model's (#284).
 * `disposeObject` leaves them alone: freeing one would make every other user
 * re-upload it. A WeakSet, not a userData flag: GLTFExporter writes userData
 * into the file's extras.
 */
const sharedGeometries = new WeakSet<ThreeNS.BufferGeometry>();

export function markSharedGeometry(geometry: ThreeNS.BufferGeometry): void {
  sharedGeometries.add(geometry);
}

function isSharedGeometry(geometry: ThreeNS.BufferGeometry): boolean {
  return sharedGeometries.has(geometry);
}

/**
 * Textures shared by many materials: the furniture's wood and fabric detail
 * (#756), the ground maps and the lit-window texture. `disposeObject` leaves
 * them alone, or every rebuild would upload them again; their module frees
 * them at unmount.
 */
const sharedTextures = new WeakSet<ThreeNS.Texture>();

export function markSharedTexture<T extends ThreeNS.Texture>(texture: T): T {
  sharedTextures.add(texture);
  return texture;
}

/**
 * Free the GPU resources owned by an object and all its descendants.
 *
 * `scene.remove()` only detaches an object from the graph — geometries,
 * materials, and textures (including our procedural CanvasTextures) stay
 * resident on the GPU until explicitly disposed. Every removal path must
 * call this, otherwise repeated scene rebuilds leak GPU memory.
 */
export function disposeObject(obj: ThreeNS.Object3D): void {
  obj.traverse((node) => {
    const mesh = node as ThreeNS.Mesh;
    if (mesh.geometry && !isSharedGeometry(mesh.geometry)) mesh.geometry.dispose();
    // Rigged people own a skeleton whose bone texture lives on the GPU.
    const skinned = node as ThreeNS.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.dispose();

    const material = mesh.material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    if (material) {
      if (Array.isArray(material)) material.forEach(disposeMaterial);
      else disposeMaterial(material);
    }

    // Lights own shadow-map render targets.
    const light = node as ThreeNS.Light;
    if (light.isLight && typeof light.dispose === 'function') light.dispose();
  });
}

function disposeMaterial(material: ThreeNS.Material): void {
  // Dispose every texture slot (map, normalMap, sprite map, …) generically.
  for (const value of Object.values(material)) {
    const texture = value as ThreeNS.Texture | null;
    if (texture && typeof texture === 'object' && texture.isTexture && !sharedTextures.has(texture)) texture.dispose();
  }
  material.dispose();
}

/** Remove an object from the scene and free its GPU resources. */
export function removeAndDispose(scene: ThreeNS.Scene, obj: ThreeNS.Object3D): void {
  scene.remove(obj);
  disposeObject(obj);
}

/**
 * Free everything a scene still holds when the editor unmounts (#213): every
 * child subtree (instanced meshes' per-instance buffers included) and a
 * texture background such as the sky gradient. Must run before
 * `renderer.dispose()`, which forgets the GL handles these release.
 */
export function disposeScene(scene: ThreeNS.Scene): void {
  for (const child of [...scene.children]) {
    scene.remove(child);
    child.traverse((node) => {
      const inst = node as ThreeNS.InstancedMesh;
      if (inst.isInstancedMesh) inst.dispose();
    });
    disposeObject(child);
  }
  const background = scene.background as ThreeNS.Texture | ThreeNS.Color | null;
  if (background && 'isTexture' in background) background.dispose();
  scene.background = null;
}

/**
 * Add the outside of a wall to its inward-facing sheet. A DoubleSide sheet
 * shades its back with a flipped normal, but the shadow lookup's normal offset
 * doesn't flip with it: a wall facing the sun looked up its shadow from behind
 * itself and shadowed itself. Two faces back to back, each drawn from its own
 * side only, can't z-fight: only one ever faces the camera. Shell walls and
 * dormer faces use it (#752, #782).
 */
export function withOutsideFace(THREE: ThreeModule, sheet: ThreeNS.BufferGeometry): ThreeNS.BufferGeometry {
  const inside = sheet.index ? sheet.toNonIndexed() : sheet;
  const positions = inside.getAttribute('position');
  const normals = inside.getAttribute('normal');
  const uvs = inside.getAttribute('uv') as ThreeNS.BufferAttribute | undefined;
  const count = positions.count;
  const position = new Float32Array(count * 6);
  const normal = new Float32Array(count * 6);
  const uv = uvs ? new Float32Array(count * 4) : null;
  // 0 on the inside face, 1 on the outside (#814).
  const outside = new Float32Array(count * 2).fill(1, count);
  for (let i = 0; i < count; i++) {
    // The outside copy winds each triangle the other way: 0, 2, 1.
    const corner = i + (i % 3 === 1 ? 1 : i % 3 === 2 ? -1 : 0);
    position.set([positions.getX(i), positions.getY(i), positions.getZ(i)], i * 3);
    normal.set([normals.getX(i), normals.getY(i), normals.getZ(i)], i * 3);
    if (uvs && uv) uv.set([uvs.getX(i), uvs.getY(i)], i * 2);
    const out = count + i;
    position.set([positions.getX(corner), positions.getY(corner), positions.getZ(corner)], out * 3);
    normal.set([-normals.getX(corner), -normals.getY(corner), -normals.getZ(corner)], out * 3);
    if (uvs && uv) uv.set([uvs.getX(corner), uvs.getY(corner)], out * 2);
  }
  const both = new THREE.BufferGeometry();
  both.setAttribute('position', new THREE.BufferAttribute(position, 3));
  both.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  if (uv) both.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  both.setAttribute(OUTSIDE_FACE_ATTRIBUTE, new THREE.BufferAttribute(outside, 1));
  if (inside !== sheet) inside.dispose();
  sheet.dispose();
  return both;
}

export function mesh(THREE: ThreeModule, geometry: ThreeNS.BufferGeometry, material: ThreeNS.Material): ThreeNS.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * The standard builder material: `color` plus the collision-tint plumbing
 * (`transparent: hasCollision, opacity`) that nearly every part shares.
 * Remaining MeshStandardMaterial params (roughness, metalness, emissive, …)
 * go in `extra`.
 */
export function material(
  THREE: ThreeModule,
  color: ThreeNS.ColorRepresentation,
  hasCollision: boolean,
  opacity: number,
  extra: Omit<ThreeNS.MeshStandardMaterialParameters, 'color' | 'transparent' | 'opacity'> = {}
): ThreeNS.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, transparent: hasCollision, opacity, ...extra });
}

/** Edge radius by class of part (#755), in metres. Even 5 mm catches a highlight at orbit distance. */
export const EDGE = {
  wood: 0.005,
  upholstery: 0.04,
  cushion: 0.045,
} as const;

export interface SoftBoxOptions {
  /**
   * Tilts each face's corner normals outwards, 0 to 1, so a flat face shades
   * like a shallow dome: a filled cushion without another vertex.
   */
  puff?: number;
}

/** No chamfer may eat more of a side than this, or thin parts turn inside out. */
const MAX_CHAMFER_SHARE = 0.45;

/**
 * A box with one chamfer per edge (#755): 44 triangles, against 12 for a box
 * and 300 for RoundedBoxGeometry at 2 segments. Every vertex keeps its face's
 * normal, so faces stay flat and the normals turn across the chamfer, which
 * is what draws the thin highlight along an edge. Centred, and exactly
 * w × h × d, like the BoxGeometry it replaces.
 *
 * UVs are in metres, along each face's longer side, so a shared detail
 * texture keeps its scale on every part and its grain runs down a part.
 */
export function softBox(
  THREE: ThreeModule,
  w: number,
  h: number,
  d: number,
  radius: number,
  { puff = 0 }: SoftBoxOptions = {}
): ThreeNS.BufferGeometry {
  const half = [w / 2, h / 2, d / 2];
  const r = Math.min(radius, Math.min(w, h, d) * MAX_CHAMFER_SHARE);
  // Grain doesn't start at the same place on every part.
  const uvShift = (w * 7.3 + h * 5.1 + d * 3.7) % 1;

  /** The vertex on `axis`'s face nearest box corner `signs`. */
  const corner = (axis: number, signs: readonly number[]) => {
    const position = signs.map((sign, i) => sign * (i === axis ? half[i]! : half[i]! - r));
    const tilted = signs.map((sign, i) => (i === axis ? sign : sign * puff));
    const length = Math.hypot(...tilted);
    return { position, normal: tilted.map((n) => n / length) };
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  /** One flat polygon, UV-mapped in the plane of `uvAxis` and wound outwards. */
  const addPolygon = (vertices: ReadonlyArray<ReturnType<typeof corner>>, uvAxis: number) => {
    const [uAxis, vAxis] = [0, 1, 2].filter((i) => i !== uvAxis).sort((a, b) => half[b]! - half[a]!) as [number, number];
    const first = positions.length / 3;
    for (const { position, normal } of vertices) {
      positions.push(...position);
      normals.push(...normal);
      uvs.push(position[uAxis]! + half[uAxis]! + uvShift, position[vAxis]! + half[vAxis]! + uvShift);
    }
    const [a, b, c] = vertices as unknown as [ReturnType<typeof corner>, ReturnType<typeof corner>, ReturnType<typeof corner>];
    const ab = a.position.map((v, i) => b.position[i]! - v);
    const ac = a.position.map((v, i) => c.position[i]! - v);
    const cross = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ];
    const facing = cross.reduce((sum, v, i) => sum + v * (a.normal[i]! + c.normal[i]!), 0);
    for (let i = 1; i + 1 < vertices.length; i += 1) {
      if (facing >= 0) indices.push(first, first + i, first + i + 1);
      else indices.push(first, first + i + 1, first + i);
    }
  };

  const SIGNS = [-1, 1];
  for (const axis of [0, 1, 2]) {
    const [p, q] = [(axis + 1) % 3, (axis + 2) % 3] as [number, number];
    const signed = (onAxis: number, onP: number, onQ: number) => {
      const signs = [0, 0, 0];
      signs[axis] = onAxis;
      signs[p] = onP;
      signs[q] = onQ;
      return signs;
    };
    for (const s of SIGNS) {
      // The face on this side of `axis`.
      addPolygon([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => corner(axis, signed(s, u!, v!))), axis);
      // The edge that runs along `axis`, between the faces of p and q.
      for (const t of SIGNS) {
        addPolygon(
          [
            corner(p, signed(-1, s, t)),
            corner(q, signed(-1, s, t)),
            corner(q, signed(1, s, t)),
            corner(p, signed(1, s, t)),
          ],
          p
        );
      }
    }
  }
  for (const x of SIGNS) {
    for (const y of SIGNS) {
      for (const z of SIGNS) addPolygon([0, 1, 2].map((axis) => corner(axis, [x, y, z])), 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * One geometry from the static parts of an item that share a material, each
 * already placed in the item's frame (`geometry.translate`/`rotateX`), so a
 * unit's doors draw with its carcass in one call (#755). The parts are
 * indexed with position, normal and uv, as softBox and three's primitives
 * are, and are freed here.
 */
export function mergeParts(THREE: ThreeModule, parts: readonly ThreeNS.BufferGeometry[]): ThreeNS.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const offset = positions.length / 3;
    const { position, normal, uv } = part.attributes as Record<string, ThreeNS.BufferAttribute | undefined>;
    if (!position || !normal || !uv || !part.index) throw new Error('mergeParts: an indexed part with position, normal and uv');
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    for (let i = 0; i < part.index.count; i += 1) indices.push(part.index.getX(i) + offset);
    part.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  return merged;
}

export function cornerPositions(x: number, y: number, z: number): ReadonlyArray<readonly [number, number, number]> {
  return [
    [x, y, z],
    [x, y, -z],
    [-x, y, z],
    [-x, y, -z],
  ];
}

export function lightenHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const t = Math.max(-1, Math.min(1, amount));
  const shift = (channel: number) =>
    Math.round(t >= 0 ? channel + (255 - channel) * t : channel * (1 + t));
  const hex2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${hex2(shift(r))}${hex2(shift(g))}${hex2(shift(b))}`;
}

/**
 * An icosahedron with each vertex pushed radially by a small pseudo-random
 * amount, flat-shaded so the result reads as a lumpy leaf cluster rather
 * than a smooth sphere. Shared by buildTree / buildPineTree / buildBush.
 */
export function buildOrganicBlob(
  THREE: ThreeModule,
  radius: number,
  color: ThreeNS.ColorRepresentation,
  hasCollision: boolean,
  opacity: number,
  seed: number
): ThreeNS.Mesh {
  const geom = new THREE.IcosahedronGeometry(radius, 1);
  const positions = geom.attributes.position;
  if (positions) {
    for (let i = 0; i < positions.count; i += 1) {
      const phase = seed + i * 1.7;
      const jitter = (Math.sin(phase) * 0.5 + Math.cos(phase * 1.3) * 0.5) * radius * 0.18;
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      positions.setXYZ(
        i,
        x + (x / len) * jitter,
        y + (y / len) * jitter,
        z + (z / len) * jitter
      );
    }
    positions.needsUpdate = true;
  }
  geom.computeVertexNormals();
  const m = new THREE.Mesh(
    geom,
    material(THREE, color, hasCollision, opacity, { roughness: 0.95, flatShading: true })
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildFallback({ THREE, item, hasCollision, baseColor, opacity }: BuilderContext): ThreeNS.Group {
  const group = new THREE.Group();
  const block = mesh(
    THREE,
    new THREE.BoxGeometry(item.width, item.height, item.depth),
    material(THREE, baseColor, hasCollision, opacity, { roughness: 0.7, metalness: 0 })
  );
  block.position.y = item.height / 2;
  group.add(block);
  return group;
}
