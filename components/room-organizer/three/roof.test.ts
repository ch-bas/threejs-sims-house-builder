import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ATTIC_CEILING_GAP,
  ATTIC_TAG,
  ROOF_OFF_STOREY_KEY,
  buildAtticCeiling,
  buildRoof,
  removeAtticCeiling,
  roofSurfaceUvs,
  setRoofOnStorey,
  setRoofShellHidden,
} from './roof';
import type { RoofStyle } from '../lib/types';

function roofMeshes(style: RoofStyle, width: number, depth: number): THREE.Mesh[] {
  const scene = new THREE.Scene();
  buildRoof(THREE, { scene, width, depth, baseY: 3, spec: { style } });
  const meshes: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    // The fascia boards are untextured trim; only the shingled surface counts.
    if (obj instanceof THREE.Mesh && !(obj.geometry instanceof THREE.BoxGeometry && style !== 'flat')) meshes.push(obj);
  });
  return meshes;
}

/** Every triangle's UV edge lengths equal its 3D edge lengths: UVs are metres, undistorted. */
function expectMetreUvs(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  expect(geometry.index).toBeNull();
  expect(uv.count).toBe(pos.count);
  for (let t = 0; t < pos.count; t += 3) {
    for (const [a, b] of [[t, t + 1], [t + 1, t + 2], [t, t + 2]] as const) {
      const d3 = Math.hypot(pos.getX(a) - pos.getX(b), pos.getY(a) - pos.getY(b), pos.getZ(a) - pos.getZ(b));
      const d2 = Math.hypot(uv.getX(a) - uv.getX(b), uv.getY(a) - uv.getY(b));
      expect(d2).toBeCloseTo(d3, 5);
    }
  }
}

describe('roofSurfaceUvs (#211)', () => {
  it('runs u along the eave and v up the slope, in metres', () => {
    // A south-facing slope: eave along x at z = 2, ridge at y = 1, z = 0.
    const uvs = roofSurfaceUvs([-3, 0, 2, 3, 0, 2, 0, 1, 0]);
    expect(uvs[2]! - uvs[0]!).toBeCloseTo(6); // eave length along u
    expect(uvs[3]!).toBeCloseTo(uvs[1]!); // eave is one shingle row
    expect(uvs[5]! - uvs[1]!).toBeCloseTo(Math.hypot(1, 2)); // slope length along v, upward
  });

  it('keeps v pointing up the slope whatever the winding', () => {
    const uvs = roofSurfaceUvs([3, 0, 2, -3, 0, 2, 0, 1, 0]);
    expect(uvs[5]! - uvs[1]!).toBeCloseTo(Math.hypot(1, 2));
  });
});

describe('buildRoof surface UVs (#211)', () => {
  it.each(['flat', 'gable', 'hipped'] as const)('%s roof carries undistorted metre-space UVs', (style) => {
    const meshes = roofMeshes(style, 8, 6);
    expect(meshes).toHaveLength(1);
    expectMetreUvs(meshes[0]!.geometry);
  });

  it('gives every hipped slope its own planar UVs, not one constant texel', () => {
    const uv = roofMeshes('hipped', 8, 6)[0]!.geometry.getAttribute('uv');
    const vs = new Set<number>();
    for (let i = 0; i < uv.count; i++) vs.add(Math.round(uv.getY(i) * 1000));
    expect(vs.size).toBeGreaterThan(1);
  });

  it('keeps the shingle density independent of the roof size', () => {
    // Texture repeat is a per-metre constant; with metre UVs the span of v on
    // a bigger roof grows with its slope length, not quadratically.
    const vSpan = (w: number, d: number): number => {
      const uv = roofMeshes('gable', w, d)[0]!.geometry.getAttribute('uv');
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        min = Math.min(min, uv.getY(i));
        max = Math.max(max, uv.getY(i));
      }
      return max - min;
    };
    expect(vSpan(16, 12) / vSpan(8, 6)).toBeLessThanOrEqual(2 + 1e-6);
  });
});

describe('setRoofOnStorey (#283)', () => {
  it('flags every top-level roof object and nothing else', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 8, depth: 6, baseY: 3, spec: { style: 'gable', dormers: [{ id: 'd', side: 'north', width: 1.6, window: true }] } });
    const other = new THREE.Object3D();
    other.userData.type = 'wall';
    scene.add(other);
    const roofs = scene.children.filter((obj) => obj.userData.type === 'roof');
    expect(roofs.length).toBeGreaterThan(1);

    setRoofOnStorey(scene, false);
    expect(roofs.every((obj) => obj.userData[ROOF_OFF_STOREY_KEY] === true)).toBe(true);
    expect(other.userData[ROOF_OFF_STOREY_KEY]).toBeUndefined();
    setRoofOnStorey(scene, true);
    expect(roofs.every((obj) => obj.userData[ROOF_OFF_STOREY_KEY] === false)).toBe(true);
  });
});

describe('walkthrough attic ceiling (#487)', () => {
  const DORMER = { id: 'd', side: 'north' as const, width: 2, window: true };
  const atticOf = (scene: THREE.Scene) => scene.children.filter((obj) => obj.userData.type === ATTIC_TAG);
  const shell = (scene: THREE.Scene): THREE.Material => {
    let found: THREE.Material | undefined;
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.name === 'Roof') found = obj.material as THREE.Material;
    });
    return found!;
  };

  it.each(['flat', 'gable', 'hipped'] as const)('lays a plain plate just under a %s roof, out to the eaves', (style) => {
    const scene = new THREE.Scene();
    expect(buildAtticCeiling(THREE, { scene, width: 8, depth: 6, baseY: 3, spec: { style } })).toBe(0);
    const [attic] = atticOf(scene);
    const box = new THREE.Box3().setFromObject(attic!);
    expect(box.max.y).toBeCloseTo(3 - ATTIC_CEILING_GAP, 5);
    expect(box.max.x - box.min.x).toBeCloseTo(8 + 0.7, 5);
    expect(box.max.z - box.min.z).toBeCloseTo(6 + 0.7, 5);
    attic!.traverse((obj) => {
      expect(obj.castShadow).toBe(false);
      if (obj instanceof THREE.Mesh) expect((obj.material as THREE.MeshStandardMaterial).map).toBeNull();
    });
  });

  it('builds nothing without a roof, and replaces itself on a rebuild', () => {
    const scene = new THREE.Scene();
    expect(buildAtticCeiling(THREE, { scene, width: 8, depth: 6, baseY: 3, spec: { style: 'none' } })).toBeNull();
    expect(scene.children).toHaveLength(0);
    buildAtticCeiling(THREE, { scene, width: 8, depth: 6, baseY: 3, spec: { style: 'gable' } });
    buildAtticCeiling(THREE, { scene, width: 8, depth: 6, baseY: 3, spec: { style: 'gable', dormers: [DORMER] } });
    expect(atticOf(scene)).toHaveLength(1);
    removeAtticCeiling(scene);
    expect(scene.children).toHaveLength(0);
  });

  it('opens a well per dormer, rising past the roof base to the dormer', () => {
    const scene = new THREE.Scene();
    expect(buildAtticCeiling(THREE, { scene, width: 8, depth: 6, baseY: 3, spec: { style: 'gable', dormers: [DORMER] } })).toBe(1);
    const box = new THREE.Box3().setFromObject(atticOf(scene)[0]!);
    expect(box.max.y).toBeGreaterThan(3.5);
  });

  it('hides the shingled body from the colour pass only, and brings it back', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 8, depth: 6, baseY: 3, spec: { style: 'gable', dormers: [DORMER] } });
    const others: THREE.Material[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.name !== 'Roof') others.push(obj.material as THREE.Material);
    });
    setRoofShellHidden(scene, true);
    expect(shell(scene).colorWrite).toBe(false);
    expect(shell(scene).depthWrite).toBe(false);
    // The fascia and the dormers stay; so do visibility (the wall-display modes') and the shadow.
    expect(others.every((m) => m.colorWrite && m.depthWrite)).toBe(true);
    scene.traverse((obj) => expect(obj.visible).toBe(true));
    setRoofShellHidden(scene, false);
    expect(shell(scene).colorWrite).toBe(true);
    expect(shell(scene).depthWrite).toBe(true);
  });

  it('keeps the shell mark out of userData, which the GLB export writes out', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 8, depth: 6, baseY: 3, spec: { style: 'hipped' } });
    scene.traverse((obj) => expect(Object.keys(obj.userData).every((key) => key === 'type')).toBe(true));
  });
});
