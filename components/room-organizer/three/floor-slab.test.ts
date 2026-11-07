import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { buildExportBuilding } from './building-export';
import { FLOOR_SLAB_DEPTH, FLOOR_SLAB_WALL_GAP, buildRoom } from './room-builder';
import type { FloorOpening } from './wall-openings';
import type { FootprintCutout } from '../lib/types';

// An upper storey stands on a slab (#653): seen from below it is closed, and
// the sun can't light the storey below through it.

const base = {
  width: 10,
  depth: 8,
  floorColor: '#ccc',
  floorPlanImage: null,
  floorPlanOpacity: 1,
  floorPlanFitMode: 'stretch' as const,
  floorPlan3DEffect: false,
};

function slabOf(scene: THREE.Object3D): THREE.Mesh | undefined {
  return scene.getObjectByName('Floor slab') as THREE.Mesh | undefined;
}

/** Whatever a vertical ray from (x, fromY, z) in direction `dy` hits. */
function hits(root: THREE.Object3D, x: number, z: number, fromY: number, dy: 1 | -1): THREE.Intersection[] {
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, dy, 0));
  return ray.intersectObject(root, true);
}

describe('the slab under an upper storey (#653)', () => {
  it('builds none on the ground floor', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene });
    expect(slabOf(scene)).toBeUndefined();
  });

  it('closes the storey seen from below, just under its floor, and casts the sun', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, yOffset: 3 });
    const slab = slabOf(scene)!;
    expect(slab).toBeDefined();
    expect(slab.castShadow).toBe(true);
    // From below a ray meets the underside, facing down.
    const [under] = hits(slab, 1, 1, 0, 1);
    expect(under?.point.y).toBeCloseTo(3 - FLOOR_SLAB_DEPTH);
    expect(under?.face?.normal.y).toBeLessThan(-0.99);
    slab.geometry.computeBoundingBox();
    const box = slab.geometry.boundingBox!;
    expect(box.max.x).toBeCloseTo(5 - FLOOR_SLAB_WALL_GAP);
    expect(box.max.z).toBeCloseTo(4 - FLOOR_SLAB_WALL_GAP);
    expect(box.max.y - box.min.y).toBeCloseTo(FLOOR_SLAB_DEPTH);
  });

  it('has no lid to z-fight the floor: nothing in it faces up', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, yOffset: 3 });
    const normals = slabOf(scene)!.geometry.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeLessThan(0.5);
  });

  it('is cut by the stairwell the floor is cut by', () => {
    const opening: FloorOpening = { id: 'stairs', centerX: -2, centerZ: 1, width: 1, depth: 3, rotation: 0 };
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, yOffset: 3, floorOpenings: [opening] });
    const slab = slabOf(scene)!;
    // Up through the hole: only the hole's lining runs beside it, nothing over it.
    expect(hits(slab, -2, 1, 0, 1)).toHaveLength(0);
    expect(hits(slab, 2, 1, 0, 1).length).toBeGreaterThan(0);
  });

  it('follows the L and leaves the cut corner open', () => {
    const cutout: FootprintCutout = { corner: 'ne', width: 4, depth: 3 };
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, yOffset: 3, cutout });
    const slab = slabOf(scene)!;
    expect(hits(slab, 3, -3, 0, 1)).toHaveLength(0);
    expect(hits(slab, 0, -3, 0, 1).length).toBeGreaterThan(0);
  });

  it('is ghosted with its storey and throws no shadow then', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, yOffset: 3, ghostOpacity: 0.25 });
    const slab = slabOf(scene)!;
    const material = slab.material as THREE.MeshStandardMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(0.25);
    expect(slab.castShadow).toBe(false);
  });

  it('is in the GLB export under every upper storey', () => {
    const layout = makeLayout({
      floors: [makeFloor({ items: [makeItem({ type: 'stairs', position: { x: 0, z: 0 } })] }), makeFloor(), makeFloor()],
    });
    const root = buildExportBuilding(THREE, layout);
    const storeys = root.children.filter((child) => child.userData.type === 'storey');
    expect(storeys.map((storey) => slabOf(storey) !== undefined)).toEqual([false, true, true]);
  });
});
