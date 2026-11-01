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
    if (texture && typeof texture === 'object' && texture.isTexture) texture.dispose();
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
    material(THREE, baseColor, hasCollision, opacity, { roughness: 0.7, metalness: 0.3 })
  );
  block.position.y = item.height / 2;
  group.add(block);
  return group;
}
