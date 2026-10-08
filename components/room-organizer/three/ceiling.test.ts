import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CEILING_GAP, CEILING_TAG, buildCeiling, removeCeiling } from './ceiling';
import type { FloorOpening } from './wall-openings';

const plateYs = (group: THREE.Group): number[] => group.children.map((child) => child.position.y);

describe('buildCeiling (#359)', () => {
  it('lays one plate just under the storey above when there is no stairwell', () => {
    const scene = new THREE.Scene();
    const group = buildCeiling(THREE, { scene, width: 8, depth: 6, y: 3, capY: 6, openings: [] });
    expect(scene.children).toContain(group);
    expect(group.userData.type).toBe(CEILING_TAG);
    expect(plateYs(group)).toEqual([3 - CEILING_GAP]);
  });

  it('cuts the stairwell and closes it with a shaft to the top of the storey above', () => {
    const scene = new THREE.Scene();
    const openings: FloorOpening[] = [{ id: 'stairs', centerX: -3, centerZ: -1.5, width: 1.2, depth: 2.4, rotation: 0 }];
    const group = buildCeiling(THREE, { scene, width: 8, depth: 6, y: 3, capY: 6, openings });
    expect(group.children).toHaveLength(2);
    const [plate, shaft] = group.children as THREE.Mesh[];
    expect(plate!.geometry.type).toBe('ShapeGeometry');
    shaft!.geometry.computeBoundingBox();
    const box = shaft!.geometry.boundingBox!.clone().applyMatrix4(shaft!.matrix);
    expect(box.min.x).toBeCloseTo(-3.6);
    expect(box.max.x).toBeCloseTo(-2.4);
    expect(box.min.z).toBeCloseTo(-2.7);
    expect(box.max.z).toBeCloseTo(-0.3);
    expect(box.min.y).toBeCloseTo(3 - CEILING_GAP);
    expect(box.max.y).toBeCloseTo(6);
    expect((shaft!.material as THREE.Material).side).toBe(THREE.BackSide);
  });

  it('removes and disposes every ceiling', () => {
    const scene = new THREE.Scene();
    const group = buildCeiling(THREE, { scene, width: 8, depth: 6, y: 3, capY: 6, openings: [] });
    const plate = group.children[0] as THREE.Mesh;
    const disposeGeometry = vi.spyOn(plate.geometry, 'dispose');
    const disposeMaterial = vi.spyOn(plate.material as THREE.Material, 'dispose');
    removeCeiling(scene);
    expect(scene.children).toHaveLength(0);
    expect(disposeGeometry).toHaveBeenCalled();
    expect(disposeMaterial).toHaveBeenCalled();
  });
});
