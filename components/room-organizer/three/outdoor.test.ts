import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { setOutdoorVisible } from './outdoor';

const WIDTH = 8;
const DEPTH = 8;
const outdoor = (scene: THREE.Scene) => scene.children.filter((obj) => obj.userData.type === 'outdoor');

/** The road: the flat mesh furthest out on the street (north, −z) side. */
function road(scene: THREE.Scene): THREE.Object3D {
  return outdoor(scene)
    .filter((obj) => obj instanceof THREE.Mesh && obj.geometry instanceof THREE.PlaneGeometry)
    .reduce((a, b) => (b.position.z < a.position.z ? b : a));
}

const trees = (scene: THREE.Scene) => outdoor(scene).filter((obj) => obj instanceof THREE.Group);

describe('outdoor scene on a sloped site (#202)', () => {
  it('keeps the road at y≈0 without a terrain', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH);
    expect(road(scene).position.y).toBeCloseTo(-0.025);
  });

  it('lifts the road to street level and plants trees on the ground line', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH, { terrain: { frontY: 2.5, backY: 0 } });
    expect(road(scene).position.y).toBeCloseTo(2.5 - 0.025);
    for (const tree of trees(scene)) {
      const { y, z } = tree.position;
      const expected = z <= -DEPTH / 2 ? 2.5 : z >= DEPTH / 2 ? 0 : 2.5 * (1 - (z + DEPTH / 2) / DEPTH);
      expect(y).toBeCloseTo(expected);
    }
  });

  it('adds the excavation faces only when the house cuts into the ground', () => {
    const flat = new THREE.Scene();
    setOutdoorVisible(THREE, flat, true, WIDTH, DEPTH);
    const hill = new THREE.Scene();
    setOutdoorVisible(THREE, hill, true, WIDTH, DEPTH, { terrain: { frontY: 2.5, backY: 0 } });
    expect(outdoor(hill).length).toBe(outdoor(flat).length + 1);
  });

  it('runs the pavement up to the front wall with no front garden (#204)', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH, { frontage: 'pavement' });
    const planes = outdoor(scene).filter((obj) => obj instanceof THREE.Mesh && obj.geometry instanceof THREE.PlaneGeometry);
    const nearest = planes.filter((p) => p.position.z < 0).reduce((a, b) => (b.position.z > a.position.z ? b : a));
    expect(nearest.position.z).toBeCloseTo(-(DEPTH / 2 + 0.8)); // pavement, 1.6 m deep, from the wall
    expect(road(scene).position.z).toBeCloseTo(-(DEPTH / 2 + 1.6 + 2.25));
    // No stepping stones or front planting.
    const stones = outdoor(scene).filter(
      (obj) => obj instanceof THREE.InstancedMesh && obj.geometry instanceof THREE.CylinderGeometry && obj.count > 0 &&
        (obj.geometry as THREE.CylinderGeometry).parameters.radiusTop === 0.32
    );
    expect(stones).toHaveLength(0);
    expect(trees(scene).some((tree) => tree.position.z < -DEPTH / 2)).toBe(false);
  });

  it('plants no trees on a side with a neighbour', () => {
    const scene = new THREE.Scene();
    setOutdoorVisible(THREE, scene, true, WIDTH, DEPTH, { neighbours: { east: true } });
    const all = trees(scene);
    expect(all.length).toBeGreaterThan(0);
    // East-side trees stand beside the lot (not the back row, which runs past it).
    const beside = (tree: THREE.Object3D) => tree.position.z < DEPTH / 2 + 6;
    expect(all.some((tree) => beside(tree) && tree.position.x > WIDTH / 2 + 6)).toBe(false);
    expect(all.some((tree) => beside(tree) && tree.position.x < -(WIDTH / 2 + 6))).toBe(true);
  });
});
