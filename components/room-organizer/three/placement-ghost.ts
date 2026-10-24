import { fadeGroup } from './collision-tint';
import { createFurnitureModel } from './furniture-builders';
import type { ThreeModule } from './builder-utils';
import type { FurnitureItem } from '../lib/types';
import type * as ThreeNS from 'three';

/** userData.type of the ghost group; furniture raycasts and rebuilds ignore it. */
export const PLACEMENT_GHOST_TAG = 'placement-ghost';

/** How see-through the ghost is. */
const GHOST_OPACITY = 0.7;
/** Emissive glow of a ghost that fits, and of one that collides. */
const GHOST_GLOW = 0x13707f;
const GHOST_BLOCKED = 0x9b1c1c;
/** The footprint pad under it: cyan where it fits, red where it collides. */
const PAD_FREE = 0x7ff3ff;
const PAD_BLOCKED = 0xe45248;
const PAD_OPACITY = 0.45;
/** How far the pad reaches past the footprint, so it shows around the item (m). */
const PAD_MARGIN = 0.08;
/** Pad height over the floor: clear of the floor plane (coplanar faces z-fight, #276). */
const PAD_LIFT = 0.012;

export interface PlacementGhostMesh {
  group: ThreeNS.Group;
  /** Recolour for a colliding spot or a free one. Allocation-free. */
  setColliding(colliding: boolean): void;
}

/**
 * The placement ghost's 3D preview (#463 d): the item's own mesh, faded and
 * glowing, casting no shadow (the shadow map is static between edits). The
 * builders make fresh materials per item, so the fade touches nothing else;
 * remove it with `removeAndDispose`.
 */
export function buildPlacementGhost(THREE: ThreeModule, item: FurnitureItem, storeyHeight: number): PlacementGhostMesh {
  const group = createFurnitureModel(THREE, item, false, storeyHeight);
  fadeGroup(group, GHOST_OPACITY);
  const glowing: ThreeNS.MeshStandardMaterial[] = [];
  group.traverse((node) => {
    node.castShadow = false;
    node.receiveShadow = false;
    const material = (node as ThreeNS.Mesh).material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      // Drawn over the floor and the furniture it passes through.
      m.depthWrite = false;
      const standard = m as ThreeNS.MeshStandardMaterial;
      if (standard.emissive) glowing.push(standard);
    }
  });
  // The footprint, so the spot reads from any camera angle.
  const padMaterial = new THREE.MeshBasicMaterial({ color: PAD_FREE, transparent: true, opacity: PAD_OPACITY, depthWrite: false });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(item.width + 2 * PAD_MARGIN, item.depth + 2 * PAD_MARGIN), padMaterial);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = PAD_LIFT;
  group.add(pad);
  group.userData.type = PLACEMENT_GHOST_TAG;
  group.visible = false;
  let current: boolean | null = null;
  const setColliding = (colliding: boolean): void => {
    if (current === colliding) return;
    current = colliding;
    for (const m of glowing) m.emissive.setHex(colliding ? GHOST_BLOCKED : GHOST_GLOW);
    padMaterial.color.setHex(colliding ? PAD_BLOCKED : PAD_FREE);
  };
  setColliding(false);
  return { group, setColliding };
}
