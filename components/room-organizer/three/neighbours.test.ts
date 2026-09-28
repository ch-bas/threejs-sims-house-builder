import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NEIGHBOUR_TAG, buildNeighbours, removeNeighbours } from './neighbours';
import { applyWallDisplay } from './room-builder';

const OPTIONS = {
  width: 6,
  depth: 9,
  eavesY: 6.6,
  baseY: -0.25,
  storeys: [
    { y: 0, height: 2.5 },
    { y: 2.5, height: 3 },
    { y: 5.5, height: 1.1 },
  ],
  roof: { style: 'gable' as const },
};

const neighbours = (scene: THREE.Scene) => scene.children.filter((obj) => obj.userData.type === NEIGHBOUR_TAG);

describe('party-wall neighbours (#202)', () => {
  it('builds a house on each requested side, flush against the party walls', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, { ...OPTIONS, sides: ['west', 'east'] });
    const houses = neighbours(scene);
    expect(houses.map((house) => house.userData.side)).toEqual(['west', 'east']);
    for (const house of houses) {
      // The block: inner face just off our wall plane (x = ±3), a house-width wide,
      // from the plinth depth to our eaves.
      const block = new THREE.Box3().setFromObject(house.children[0]!);
      expect(Math.min(Math.abs(block.min.x), Math.abs(block.max.x))).toBeCloseTo(3.02);
      expect(block.max.x - block.min.x).toBeCloseTo(6);
      expect(block.min.y).toBeCloseTo(-0.25);
      expect(block.max.y).toBeCloseTo(6.6);
      // Roofed above our eaves.
      expect(new THREE.Box3().setFromObject(house).max.y).toBeGreaterThan(7);
    }
  });

  it('keeps its roof inside the neighbour, off the scene’s own roof tag', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, { ...OPTIONS, sides: ['east'] });
    expect(scene.children.some((obj) => obj.userData.type === 'roof')).toBe(false);
    expect(neighbours(scene)[0]!.children.some((obj) => obj.userData.type === 'roof')).toBe(true);
  });

  it('stays visible in every wall-display mode (#201)', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, { ...OPTIONS, sides: ['west', 'east'] });
    for (const mode of ['up', 'cutaway', 'down'] as const) {
      applyWallDisplay(scene, 20, 0, mode, 6, 9);
      expect(neighbours(scene).every((house) => house.visible)).toBe(true);
    }
  });

  it('rebuilds instead of stacking, and removes cleanly', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, { ...OPTIONS, sides: ['east'] });
    buildNeighbours(THREE, scene, { ...OPTIONS, sides: ['east'] });
    expect(neighbours(scene)).toHaveLength(1);
    removeNeighbours(scene);
    expect(neighbours(scene)).toHaveLength(0);
  });
});
