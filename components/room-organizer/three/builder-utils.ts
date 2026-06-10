import type * as ThreeNS from 'three';
import type { FurnitureItem } from '../lib/types';

export type ThreeModule = typeof import('three');

export interface BuilderContext {
  THREE: ThreeModule;
  item: FurnitureItem;
  hasCollision: boolean;
  baseColor: ThreeNS.ColorRepresentation;
  opacity: number;
}

export type FurnitureBuilder = (ctx: BuilderContext) => ThreeNS.Group;

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
    if (mesh.geometry) mesh.geometry.dispose();

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

export function mesh(THREE: ThreeModule, geometry: ThreeNS.BufferGeometry, material: ThreeNS.Material): ThreeNS.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
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
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.95,
      flatShading: true,
      transparent: hasCollision,
      opacity,
    })
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
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, metalness: 0.3, transparent: hasCollision, opacity })
  );
  block.position.y = item.height / 2;
  group.add(block);
  return group;
}
