import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { buildPlacementGhost, PLACEMENT_GHOST_TAG } from './placement-ghost';

const materialsOf = (root: THREE.Object3D): THREE.Material[] => {
  const out: THREE.Material[] = [];
  root.traverse((node) => {
    const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (material) out.push(...(Array.isArray(material) ? material : [material]));
  });
  return out;
};

describe('buildPlacementGhost (#463 d)', () => {
  it('is the item faded, casting no shadow, tagged apart from furniture and hidden until placed', () => {
    const { group } = buildPlacementGhost(THREE, makeItem({ type: 'sofa', width: 2, depth: 0.9 }), 3);
    expect(group.userData.type).toBe(PLACEMENT_GHOST_TAG);
    expect(group.visible).toBe(false);
    group.traverse((node) => expect(node.castShadow).toBe(false));
    for (const material of materialsOf(group)) {
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.opacity).toBeLessThan(1);
    }
  });

  it('frees itself on dispose but keeps the shared pad material, so a pick never recompiles it', () => {
    const first = buildPlacementGhost(THREE, makeItem({ type: 'chair' }), 3);
    const pad = materialsOf(first.group).find((m) => m instanceof THREE.MeshBasicMaterial)!;
    const disposed = vi.fn();
    pad.addEventListener('dispose', disposed);
    const scene = new THREE.Scene();
    scene.add(first.group);
    first.dispose();
    expect(first.group.parent).toBeNull();
    expect(disposed).not.toHaveBeenCalled();
    const second = buildPlacementGhost(THREE, makeItem({ type: 'sofa' }), 3);
    expect(materialsOf(second.group)).toContain(pad);
    second.dispose();
  });

  it('turns red where it collides and back where it fits', () => {
    const ghost = buildPlacementGhost(THREE, makeItem({ type: 'chair' }), 3);
    const glow = () =>
      materialsOf(ghost.group)
        .filter((m): m is THREE.MeshStandardMaterial => 'emissive' in m)
        .map((m) => m.emissive.getHex());
    const free = glow();
    ghost.setColliding(true);
    const blocked = glow();
    expect(blocked).not.toEqual(free);
    ghost.setColliding(false);
    expect(glow()).toEqual(free);
  });
});
