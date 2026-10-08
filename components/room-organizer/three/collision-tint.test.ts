import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { CCTV_MODELS } from '../lib/cctv-models';
import { COLLISION_OPACITY, applyCollisionTint } from './collision-tint';
import { createFurnitureModel } from './furniture-builders';

const materialsOf = (root: THREE.Object3D): THREE.Material[] => {
  const out: THREE.Material[] = [];
  root.traverse((node) => {
    const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (material) out.push(...(Array.isArray(material) ? material : [material]));
  });
  return out;
};

describe('applyCollisionTint (#167)', () => {
  it('reaches the raw sub-materials that bypass the shared helper', () => {
    const items = [
      makeItem({ type: 'bathtub', width: 1.7, depth: 0.8, height: 0.6 }),
      ...CCTV_MODELS.map((model) =>
        makeItem({ type: 'security-camera', width: 0.2, depth: 0.2, height: 2.4, cctvModelId: model.id })
      ),
    ];
    for (const item of items) {
      const group = createFurnitureModel(THREE, item, true);
      applyCollisionTint(group);
      for (const material of materialsOf(group)) {
        expect(material.transparent).toBe(true);
        expect(material.opacity).toBeLessThanOrEqual(COLLISION_OPACITY);
      }
    }
  });

  it('never raises an opacity that is already lower', () => {
    const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 });
    const group = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), glass));
    applyCollisionTint(group);
    expect(glass.opacity).toBe(0.3);
  });
});
