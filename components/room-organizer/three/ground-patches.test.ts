import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { GRASS_DROP, groundHeightAt } from '../lib/site';
import { buildExportBuilding } from './building-export';
import { GROUND_PATCH_ROLE, buildGroundPatchGeometry, buildGroundPatches, groundPatchColor, tintGroundPatches } from './ground-patches';
import { applyOutdoorWeather, setOutdoorVisible } from './outdoor';
import type { GroundPatch } from '../lib/types';

const paving: GroundPatch = { id: 'g1', kind: 'paving', x: 4, z: -2, w: 2, d: 3 };
const deck: GroundPatch = { id: 'g2', kind: 'deck', x: -7, z: 0, w: 3, d: 2 };

function tops(geometry: THREE.BufferGeometry): Array<{ x: number; y: number; z: number }> {
  const group = geometry.groups[0]!;
  const position = geometry.getAttribute('position');
  return Array.from({ length: group.count }, (_, i) => ({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) }));
}

describe('garden surfaces in 3D (#924)', () => {
  it('lies just under the ground line, above the grass, facing up', () => {
    const geometry = buildGroundPatchGeometry(THREE, [paving], 'paving', undefined, 3);
    const top = tops(geometry);
    expect(top).toHaveLength(6);
    for (const vertex of top) {
      expect(vertex.y).toBeLessThan(0);
      expect(vertex.y).toBeGreaterThan(-GRASS_DROP + 0.01);
    }
    const normal = geometry.getAttribute('normal');
    expect(normal.getY(0)).toBeCloseTo(1);
    // Sides reach under the grass.
    const position = geometry.getAttribute('position');
    let lowest = Infinity;
    for (let i = 0; i < position.count; i++) lowest = Math.min(lowest, position.getY(i));
    expect(lowest).toBeLessThan(-GRASS_DROP);
  });

  it('follows a sloped site with a row on each kink it crosses', () => {
    const hill = { frontY: 1, backY: 0 };
    // Beside the house from in front of it to behind it: both kinks (z = ±3).
    const long = { ...paving, z: -5, d: 10 };
    const top = tops(buildGroundPatchGeometry(THREE, [long], 'paving', hill, 3));
    expect(top).toHaveLength(18);
    for (const vertex of top) expect(vertex.y).toBeCloseTo(groundHeightAt(hill, vertex.z, 3) - 0.006, 6);
    expect(new Set(top.map((vertex) => vertex.z))).toEqual(new Set([-5, -3, 3, 5]));
  });

  it('builds one mesh per kind, out of the pointer’s way, and tints for the weather', () => {
    const group = buildGroundPatches(THREE, [paving, deck, { ...paving, id: 'g3', x: 7 }], { halfDepth: 3, textured: false });
    expect(group.children.map((child) => child.name).sort()).toEqual(['deck', 'paving']);
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.userData.role).toBe(GROUND_PATCH_ROLE);
    const hits: THREE.Intersection[] = [];
    mesh.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
    tintGroundPatches(group, 'snow');
    const [top] = mesh.material as THREE.MeshStandardMaterial[];
    expect(top!.color.getHex()).toBe(groundPatchColor(mesh.userData.kind as GroundPatch['kind'], 'snow'));
  });

  it('is laid on the lot, keeps the stepping stones and shrubs off it, and follows the weather', () => {
    const scene = new THREE.Scene();
    const stones = (s: THREE.Scene) =>
      s.children.find((obj) => obj instanceof THREE.InstancedMesh && obj.geometry instanceof THREE.CylinderGeometry && obj.geometry.parameters.radiusTop === 0.32) as THREE.InstancedMesh | undefined;
    setOutdoorVisible(THREE, scene, true, 8, 6);
    const before = stones(scene)!.count;
    // A front path across the stepping stones' line.
    const front: GroundPatch = { id: 'f', kind: 'gravel', x: -1, z: -6, w: 2, d: 1.5 };
    setOutdoorVisible(THREE, scene, true, 8, 6, { grounds: [front] });
    expect(stones(scene)!.count).toBeLessThan(before);
    const patches = scene.children.find((obj) => obj.userData.role === 'grounds');
    expect(patches?.children).toHaveLength(1);
    applyOutdoorWeather(scene, 'rain');
    const [top] = (patches!.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[];
    expect(top!.color.getHex()).toBe(groundPatchColor('gravel', 'rain'));
    // Without surfaces the lot builds as it always did.
    setOutdoorVisible(THREE, scene, true, 8, 6, {});
    expect(scene.children.some((obj) => obj.userData.role === 'grounds')).toBe(false);
    expect(stones(scene)!.count).toBe(before);
  });

  it('goes into the GLB, only the surfaces the house leaves room for', () => {
    const layout = makeLayout({ width: 8, height: 6, grounds: [paving, { ...deck, x: -1, z: -1 }] });
    const root = buildExportBuilding(THREE, layout);
    const garden = root.children.find((child) => child.name === 'Garden surfaces');
    expect(garden?.children.map((child) => child.name)).toEqual(['paving']);
    expect(buildExportBuilding(THREE, makeLayout()).children.some((child) => child.name === 'Garden surfaces')).toBe(false);
  });
});
