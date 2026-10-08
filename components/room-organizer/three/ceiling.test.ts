import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CEILING_GAP, CEILING_TAG, buildCeiling, removeCeiling } from './ceiling';
import { floorHoleOutlines } from './room-builder';
import type { CeilingOptions } from './ceiling';
import type { FloorOpening } from './wall-openings';

const stairwell = (patch: Partial<FloorOpening> = {}): FloorOpening => ({
  id: 'stairs', centerX: -3, centerZ: -1.5, width: 1.2, depth: 2.4, rotation: 0, ...patch,
});

function build(patch: Partial<CeilingOptions>): { scene: THREE.Scene; group: THREE.Group | null } {
  const scene = new THREE.Scene();
  const group = buildCeiling(THREE, { scene, width: 8, depth: 6, above: null, below: null, shafts: true, ...patch });
  return { scene, group };
}

function worldBox(mesh: THREE.Object3D): THREE.Box3 {
  const geometry = (mesh as THREE.Mesh).geometry;
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone().applyMatrix4(mesh.matrix);
}

describe('buildCeiling (#359)', () => {
  it('builds nothing with no storey above and no stairwell below', () => {
    const { scene, group } = build({});
    expect(group).toBeNull();
    expect(scene.children).toHaveLength(0);
  });

  it('lays one plate just under the storey above when there is no stairwell', () => {
    const { scene, group } = build({ above: { y: 3, capY: 6, openings: [] } });
    expect(scene.children).toContain(group);
    expect(group!.userData.type).toBe(CEILING_TAG);
    expect(group!.children.map((child) => child.position.y)).toEqual([3 - CEILING_GAP]);
  });

  it('cuts the stairwell and closes it with a shadow-casting shaft to the top of the storey above', () => {
    const { group } = build({ above: { y: 3, capY: 6, openings: [stairwell()] } });
    expect(group!.children).toHaveLength(2);
    const [plate, shaft] = group!.children as THREE.Mesh[];
    expect(plate!.geometry.type).toBe('ShapeGeometry');
    const box = worldBox(shaft!);
    expect(box.min.x).toBeCloseTo(-3.6);
    expect(box.max.x).toBeCloseTo(-2.4);
    expect(box.min.z).toBeCloseTo(-2.7);
    expect(box.max.z).toBeCloseTo(-0.3);
    expect(box.min.y).toBeCloseTo(3 - CEILING_GAP);
    expect(box.max.y).toBeCloseTo(6);
    expect(shaft!.castShadow).toBe(true);
    for (const material of shaft!.material as THREE.Material[]) expect(material.side).toBe(THREE.BackSide);
  });

  it('fits the shafts to the plate holes: clamped to the footprint and merged', () => {
    // One stairwell past the west wall, two overlapping in the middle.
    const openings = [
      stairwell({ centerX: -3.8 }),
      stairwell({ id: 'a', centerX: 1, centerZ: 0 }),
      stairwell({ id: 'b', centerX: 1.5, centerZ: 0.5 }),
    ];
    const { group } = build({ above: { y: 3, capY: 6, openings } });
    const shafts = group!.children.slice(1);
    expect(shafts).toHaveLength(floorHoleOutlines(8, 6, openings).length);
    expect(shafts).toHaveLength(2);
    const [edge, merged] = shafts.map(worldBox);
    expect(edge!.min.x).toBeCloseTo(-4 + 0.001);
    expect(merged!.min.x).toBeCloseTo(0.4);
    expect(merged!.max.x).toBeCloseTo(2.1);
    expect(merged!.min.z).toBeCloseTo(-1.2);
    expect(merged!.max.z).toBeCloseTo(1.7);
  });

  it('lines a stairwell in the active floor down to the storey below, with its floor', () => {
    const { group } = build({ below: { y: 0, topY: 3, openings: [stairwell()], floorColor: '#a0522d' } });
    expect(group!.children).toHaveLength(1);
    const pit = group!.children[0] as THREE.Mesh;
    const box = worldBox(pit);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(3);
    expect(pit.castShadow).toBe(true);
    const [cap, sides] = pit.material as THREE.MeshStandardMaterial[];
    expect(cap!.color.getHexString()).toBe('a0522d');
    expect(sides!.color.getHexString()).not.toBe('a0522d');
  });

  it('leaves the stairwells open when the real storeys are built ("show all floors")', () => {
    const above = { y: 3, capY: 6, openings: [stairwell()] };
    const below = { y: 0, topY: 3, openings: [stairwell()], floorColor: '#a0522d' };
    expect(build({ above, below, shafts: false }).group!.children).toHaveLength(1);
    expect(build({ below, shafts: false }).group).toBeNull();
  });

  it('removes and disposes every ceiling', () => {
    const { scene, group } = build({ above: { y: 3, capY: 6, openings: [] } });
    const plate = group!.children[0] as THREE.Mesh;
    const disposeGeometry = vi.spyOn(plate.geometry, 'dispose');
    const disposeMaterial = vi.spyOn(plate.material as THREE.Material, 'dispose');
    removeCeiling(scene);
    expect(scene.children).toHaveLength(0);
    expect(disposeGeometry).toHaveBeenCalled();
    expect(disposeMaterial).toHaveBeenCalled();
  });
});
