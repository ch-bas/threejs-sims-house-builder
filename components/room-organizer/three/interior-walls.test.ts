import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { renderInteriorWalls } from './interior-walls';

/** The partition itself — the tallest mesh tagged with the wall id (baseboards share the tag). */
function wallMesh(scene: THREE.Scene): THREE.Mesh {
  const meshes = scene.children.filter(
    (obj): obj is THREE.Mesh => obj instanceof THREE.Mesh && obj.userData.wallId === 'iw'
  );
  const span = (mesh: THREE.Mesh) => heightOf(mesh).max - heightOf(mesh).min;
  return meshes.reduce((a, b) => (span(b) > span(a) ? b : a));
}

function heightOf(mesh: THREE.Mesh): { min: number; max: number } {
  mesh.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(mesh);
  return { min: box.min.y, max: box.max.y };
}

const WALL = { id: 'iw', x1: -2, z1: 0, x2: 2, z2: 0 };

describe('renderInteriorWalls storey heights (#202)', () => {
  it('keeps the classic 2.6 m partition when no height is given', () => {
    const scene = new THREE.Scene();
    renderInteriorWalls(THREE, scene, [WALL], 3);
    const wall = wallMesh(scene);
    expect(heightOf(wall).min).toBeCloseTo(3);
    expect(heightOf(wall).max).toBeCloseTo(5.6);
  });

  it('builds partitions to the storey height at its elevation', () => {
    const scene = new THREE.Scene();
    renderInteriorWalls(THREE, scene, [WALL], 2.5, undefined, { wallHeight: 2.1 });
    const wall = wallMesh(scene);
    expect(heightOf(wall).min).toBeCloseTo(2.5);
    expect(heightOf(wall).max).toBeCloseTo(4.6);
  });

  it('cuts a doorway no taller than a short partition, and skips a window above it', () => {
    const door = makeItem({ id: 'd', type: 'door', width: 0.9, depth: 0.1, height: 2.1, position: { x: 0, z: 0 } });
    const window = makeItem({ id: 'w', type: 'window', width: 1, depth: 0.1, height: 1.2, position: { x: 1.2, z: 0 } });
    const scene = new THREE.Scene();
    renderInteriorWalls(THREE, scene, [WALL], 0, undefined, { openingCandidates: [door, window], wallHeight: 0.7 });
    const wall = wallMesh(scene);
    // Extruded with one hole (the door), still exactly the partition height.
    expect(wall.geometry.type).toBe('ExtrudeGeometry');
    expect(heightOf(wall).max).toBeCloseTo(0.7);

    // The window's sill (0.9 m) is above the 0.7 m partition: nothing to cut.
    const windowOnly = new THREE.Scene();
    renderInteriorWalls(THREE, windowOnly, [WALL], 0, undefined, { openingCandidates: [window], wallHeight: 0.7 });
    expect(wallMesh(windowOnly).geometry.type).toBe('BoxGeometry');
  });
});
