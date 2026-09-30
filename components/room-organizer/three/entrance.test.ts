import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { entranceGeometry } from '../lib/street';
import { ENTRANCE_WALL_GAP, buildEntrance } from './entrance';
import { FOUNDATION_OVERHANG, applyWallDisplay } from './room-builder';

const build = (terrain?: { frontY: number; backY: number }, floors: Array<{ height?: number }> = terrain ? [{ height: 2.5 }, {}] : [{}, {}]) => {
  const geometry = entranceGeometry({ width: 1.4, depth: 1.2 }, { width: 6, depth: 9, floors, ...(terrain ? { terrain } : {}) })!;
  return buildEntrance(THREE, { geometry, wallColor: '#ffffff', wallTag: 'wall', floorTag: 'floor' });
};

describe('entrance porch (#204)', () => {
  it('builds reveals and a soffit as part of the front wall', () => {
    const [shell, steps] = build();
    expect(steps).toBeUndefined();
    expect(shell!.userData).toMatchObject({ type: 'wall', wallId: 'north' });
    const box = new THREE.Box3().setFromObject(shell!);
    expect(box.min.z).toBeCloseTo(-4.5 + ENTRANCE_WALL_GAP, 5);
    expect(box.max.z).toBeCloseTo(-3.3);
    expect(box.max.y).toBeCloseTo(2.4 + 0.12);
  });

  it('starts reveals and soffit behind the wall plane, never in it (#276)', () => {
    const [shell] = build();
    expect(ENTRANCE_WALL_GAP).toBeGreaterThan(0);
    for (const child of shell!.children) {
      const box = new THREE.Box3().setFromObject(child);
      // No street-facing end may lie in the double-sided wall's plane (z = -4.5).
      expect(box.min.z).toBeGreaterThan(-4.5 + ENTRANCE_WALL_GAP / 2);
      expect(box.max.z).toBeCloseTo(-3.3);
    }
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
    // The porch storey sits above the plinth: the flight meets the wall plane.
    expect(box.max.z).toBeCloseTo(-4.5);
    expect(steps!.children.length).toBe(Math.ceil(1.3 / 0.18));
  });

  it('starts the ground-floor flight beyond the foundation ring (#276)', () => {
    const [, steps] = build({ frontY: -0.5, backY: 0 }, [{}, {}]);
    const box = new THREE.Box3().setFromObject(steps!);
    // The top step used to share the plinth's top face (y = 0) and the ring's
    // outer edge poked through the step below; the ring is the landing now.
    expect(box.max.y).toBeCloseTo(0);
    expect(box.min.y).toBeCloseTo(-0.5);
    expect(box.max.z).toBeCloseTo(-4.5 - FOUNDATION_OVERHANG, 5);
    expect(steps!.children.length).toBe(Math.ceil(0.5 / 0.18));
  });
});
