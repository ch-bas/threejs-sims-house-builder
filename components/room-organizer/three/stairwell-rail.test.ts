import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { STAIRWELL_RAIL_HEIGHT, stairwellRailSegments } from '../lib/stairwell-rail';
import { disposeObject } from './builder-utils';
import { buildExportBuilding } from './building-export';
import { applyWallDisplay, OFF_STOREY_KEY } from './room-builder';
import { BALUSTER_MAX_GAP, STAIRWELL_RAIL_TAG, balusterGaps, buildStairwellRail, clearStairwellRails } from './stairwell-rail';

const layout = makeLayout({
  width: 8,
  height: 8,
  floors: [
    makeFloor({ items: [makeItem({ id: 's', type: 'stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 0, z: 0 }, rotation: 0 })] }),
    makeFloor({ id: 'f1', name: 'Upstairs' }),
  ],
});

describe('buildStairwellRail (#923)', () => {
  it('builds nothing for a storey with no rail', () => {
    expect(buildStairwellRail(THREE, [], 0)).toBeNull();
  });

  it('builds one mesh, from the slab edge to the handrail, round the hole', () => {
    const segments = stairwellRailSegments(layout, 1);
    const mesh = buildStairwellRail(THREE, segments, 3)!;
    expect(mesh.userData.type).toBe(STAIRWELL_RAIL_TAG);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.max.y).toBeCloseTo(3 + STAIRWELL_RAIL_HEIGHT, 6);
    expect(box.min.y).toBeCloseTo(3 - 0.04, 6);
    // Inside the hole, clear of the slab edge.
    expect(box.min.x).toBeGreaterThan(-0.65);
    expect(box.max.x).toBeLessThan(0.65);
    disposeObject(mesh);
  });

  it('leaves no clear gap of 10 cm between balusters and posts, in any bay', () => {
    for (let bay = 0.05; bay <= 1.5; bay += 0.013) {
      const gaps = balusterGaps(bay);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(BALUSTER_MAX_GAP + 1e-9);
      expect(gaps.reduce((sum, gap) => sum + gap, 0) + (gaps.length - 1) * 0.02).toBeCloseTo(bay - 0.045, 9);
    }
  });

  it('hides with the partitions: gone with walls down, or with its storey', () => {
    const scene = new THREE.Scene();
    const mesh = buildStairwellRail(THREE, stairwellRailSegments(layout, 1), 3)!;
    scene.add(mesh);
    applyWallDisplay(scene, 10, 10, 'cutaway', 8, 8);
    expect(mesh.visible).toBe(true);
    applyWallDisplay(scene, 10, 10, 'down', 8, 8);
    expect(mesh.visible).toBe(false);
    applyWallDisplay(scene, 10, 10, 'up', 8, 8);
    expect(mesh.visible).toBe(true);
    mesh.userData[OFF_STOREY_KEY] = true;
    applyWallDisplay(scene, 10, 10, 'up', 8, 8);
    expect(mesh.visible).toBe(false);
    clearStairwellRails(scene);
    expect(scene.children).toHaveLength(0);
  });

  it('is in the GLB, on the storey above the stairs only', () => {
    const root = buildExportBuilding(THREE, layout);
    const rails: THREE.Object3D[] = [];
    root.traverse((node) => {
      if (node.userData.type === STAIRWELL_RAIL_TAG) rails.push(node);
    });
    expect(rails).toHaveLength(1);
    expect(rails[0]!.parent?.userData.floorIndex).toBe(1);
    disposeObject(root);
  });
});
