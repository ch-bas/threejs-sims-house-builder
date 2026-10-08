import type * as ThreeNS from 'three';

/** Opacity of a colliding item; matches `createFurnitureModel`'s collision context. */
export const COLLISION_OPACITY = 0.7;

/**
 * Make every part of a colliding item see-through, not only the parts whose
 * builder used the shared `material()` helper (#167). Builders create fresh
 * materials per item, so mutating them here touches no other mesh.
 */
export function applyCollisionTint(group: ThreeNS.Object3D, opacity = COLLISION_OPACITY): void {
  group.traverse((node) => {
    const material = (node as ThreeNS.Mesh).material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      m.transparent = true;
      m.opacity = Math.min(m.opacity, opacity);
    }
  });
}
