import type * as ThreeNS from 'three';

/** Opacity of a colliding item; matches `createFurnitureModel`'s collision context. */
export const COLLISION_OPACITY = 0.7;

/**
 * Make every material under `group` see-through, at most `opacity`. Builders
 * create fresh materials per item, so this touches no other mesh. The first
 * transparent use of each material type compiles one more shader variant,
 * then it is cached.
 */
export function fadeGroup(group: ThreeNS.Object3D, opacity: number): void {
  group.traverse((node) => {
    const material = (node as ThreeNS.Mesh).material as ThreeNS.Material | ThreeNS.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      m.transparent = true;
      m.opacity = Math.min(m.opacity, opacity);
    }
  });
}

/**
 * Every part of a colliding item, not only the parts whose builder used the
 * shared `material()` helper (#167).
 */
export function applyCollisionTint(group: ThreeNS.Object3D, opacity = COLLISION_OPACITY): void {
  fadeGroup(group, opacity);
}
