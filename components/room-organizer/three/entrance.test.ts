import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { entranceGeometry } from '../lib/street';
import { buildEntrance } from './entrance';
import { applyWallDisplay } from './room-builder';

const build = (terrain?: { frontY: number; backY: number }) => {
  const floors = terrain ? [{ height: 2.5 }, {}] : [{}, {}];
  const geometry = entranceGeometry({ width: 1.4, depth: 1.2 }, { width: 6, depth: 9, floors, terrain })!;
  return buildEntrance(THREE, { geometry, wallColor: '#ffffff', wallTag: 'wall', floorTag: 'floor' });
};

describe('entrance porch (#204)', () => {
  it('builds reveals and a soffit as part of the front wall', () => {
    const [shell, steps] = build();
    expect(steps).toBeUndefined();
    expect(shell!.userData).toMatchObject({ type: 'wall', wallId: 'north' });
    const box = new THREE.Box3().setFromObject(shell!);
    expect(box.min.z).toBeCloseTo(-4.5);
    expect(box.max.z).toBeCloseTo(-3.3);
    expect(box.max.y).toBeCloseTo(2.4 + 0.12);
  });

  it('hides with the front wall in cutaway/down, like the wall it belongs to', () => {
    const scene = new THREE.Scene();
    const [shell] = build();
    scene.add(shell!);
    applyWallDisplay(scene, 0, -20, 'cutaway', 6, 9);
    expect(shell!.visible).toBe(false);
    applyWallDisplay(scene, 0, 20, 'cutaway', 6, 9);
    expect(shell!.visible).toBe(true);
  });

  it('steps down from the porch to the street on a hill', () => {
    const [, steps] = build({ frontY: 1.2, backY: 0 });
    expect(steps!.userData.type).toBe('floor');
    const box = new THREE.Box3().setFromObject(steps!);
    expect(box.min.y).toBeCloseTo(1.2);
    expect(box.max.y).toBeCloseTo(2.5);
    expect(box.max.z).toBeCloseTo(-4.5);
    expect(steps!.children.length).toBe(Math.ceil(1.3 / 0.18));
  });
});
