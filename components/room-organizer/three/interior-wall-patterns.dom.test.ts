// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { renderInteriorWalls } from './interior-walls';
import type { InteriorWall } from '../lib/types';

const base: InteriorWall = { id: 'w', x1: -2, z1: 0, x2: 2, z2: 0 };
const door = makeItem({ id: 'd', type: 'door', width: 0.9, depth: 0.12, height: 2.05, position: { x: 0, z: 0 }, rotation: 0 });

function build(wall: InteriorWall, withDoor = false): THREE.Mesh {
  const scene = new THREE.Scene();
  renderInteriorWalls(THREE, scene, [wall], 0, undefined, {
    openingCandidates: withDoor ? [door] : [],
    roomWidth: 8,
    roomDepth: 8,
  });
  return scene.getObjectByName('Interior wall w') as THREE.Mesh;
}

function materials(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

describe('patterned partitions (#919)', () => {
  it('keeps a plain wall as it was: one material, the box UVs', () => {
    const mesh = build({ ...base, color: '#123456' });
    expect(Array.isArray(mesh.material)).toBe(false);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456');
  });

  it.each([
    ['a box', false],
    ['an extrusion with a door cut', true],
  ])('never uses more than two materials on %s', (_label, withDoor) => {
    for (const wall of [
      { ...base, pattern: 'tile' as const },
      { ...base, pattern: 'tile' as const, patternB: 'wallpaper' as const },
      { ...base, patternB: 'tile' as const, colorB: '#ffffff' },
      { ...base, pattern: 'brick' as const, color: '#aa3322', colorB: '#ffffff' },
    ]) {
      const mesh = build(wall, withDoor);
      expect(new Set(materials(mesh)).size).toBeLessThanOrEqual(2);
      for (const material of materials(mesh)) expect(material.side).toBe(THREE.FrontSide);
    }
    expect(Array.isArray(build({ ...base, pattern: 'tile' }, withDoor).material)).toBe(false);
    expect(new Set(materials(build({ ...base, pattern: 'tile', patternB: 'brick' }, withDoor))).size).toBe(2);
  });

  it('puts side b on the -z face, as the paint does', () => {
    const mesh = build({ ...base, color: '#111111', pattern: 'tile', colorB: '#eeeeee' });
    const list = mesh.material as THREE.MeshStandardMaterial[];
    expect(list).toHaveLength(6);
    expect(list[5]!.color.getHexString()).toBe('eeeeee');
    expect(list[4]!.color.getHexString()).toBe('111111');
  });

  it('maps the faces in metres from the floor, so a tile is the same size on any wall', () => {
    const mesh = build({ ...base, pattern: 'tile' });
    const geometry = mesh.geometry;
    const uv = geometry.getAttribute('uv');
    const normal = geometry.getAttribute('normal');
    let maxU = -Infinity;
    let minU = Infinity;
    let maxV = -Infinity;
    let minV = Infinity;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(normal.getZ(i)) < 0.5) continue;
      maxU = Math.max(maxU, uv.getX(i));
      minU = Math.min(minU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
      minV = Math.min(minV, uv.getY(i));
    }
    expect(maxU - minU).toBeCloseTo(4, 1);
    expect(minV).toBeCloseTo(0);
    expect(maxV).toBeCloseTo(2.6);
  });
});
