// @vitest-environment jsdom
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildRoof } from './roof';
import { buildWallMaterial } from './wall-patterns';
import type * as ThreeNS from 'three';

/** A 2D context that draws nothing: jsdom has no canvas, and only the texture's placement is under test. */
beforeAll(() => {
  const noop = (): unknown => gradient;
  const gradient = { addColorStop: () => undefined };
  const context = new Proxy({}, { get: (_target, key) => (key === 'canvas' ? undefined : noop), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);
});

const mapOf = (material: ThreeNS.Material): ThreeNS.Texture => (material as ThreeNS.MeshStandardMaterial).map!;

describe('wall pattern proportions (#661)', () => {
  it('tiles square: as many tiles per metre up the wall as along it', () => {
    const map = mapOf(buildWallMaterial(THREE, { pattern: 'brick', color: '#a5533c', width: 5, height: 3 }));
    expect(map.repeat.y / 3).toBeCloseTo(map.repeat.x / 5);
  });

  it('runs the courses on across storeys: the pattern under a storey line meets the one over it', () => {
    const ground = mapOf(buildWallMaterial(THREE, { pattern: 'brick', color: '#a5533c', width: 5, height: 3, yOffset: 0 }));
    const upper = mapOf(buildWallMaterial(THREE, { pattern: 'brick', color: '#a5533c', width: 5, height: 2.7, yOffset: 3 }));
    // Texture v at the top of the ground wall (uv.y = 1) and at the foot of the upper one (uv.y = 0), in tiles.
    const top = ground.repeat.y + ground.offset.y;
    const foot = upper.offset.y;
    expect((((top - foot) % 1) + 1) % 1).toBeCloseTo(0);
  });
});

describe('gable ends and hipped eaves (#661)', () => {
  const roofMesh = (scene: ThreeNS.Scene): ThreeNS.Mesh => scene.getObjectByName('Roof') as ThreeNS.Mesh;

  it('paints each gable end with its own wall, and the underside as a soffit', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, {
      scene, width: 10, depth: 8, baseY: 3, spec: { style: 'gable', color: '#555555' },
      gableWalls: { pattern: 'solid', colors: { west: '#112233', east: '#445566' } },
    });
    const roof = roofMesh(scene);
    const materials = roof.material as ThreeNS.MeshStandardMaterial[];
    const colours = materials.map((m) => `#${m.color.getHexString()}`);
    expect(colours).toEqual(expect.arrayContaining(['#112233', '#445566']));
    // One group per material, no stray slots.
    expect(new Set(roof.geometry.groups.map((g) => g.materialIndex)).size).toBe(materials.length);
    // The ends are vertical at the walls, x = ±5 once the ridge is turned along x.
    roof.updateMatrixWorld(true);
    const position = roof.geometry.getAttribute('position');
    for (const group of roof.geometry.groups) {
      const colour = colours[group.materialIndex!];
      if (colour !== '#112233' && colour !== '#445566') continue;
      for (let i = group.start; i < group.start + group.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(roof.matrixWorld);
        expect(Math.abs(p.x)).toBeCloseTo(5);
        expect(Math.sign(p.x)).toBe(colour === '#445566' ? 1 : -1);
      }
    }
  });

  it('shares one end material when both ends match, and closes the hipped roof with a soffit and four fascias', () => {
    const gable = new THREE.Scene();
    buildRoof(THREE, { scene: gable, width: 10, depth: 8, baseY: 3, spec: { style: 'gable' } });
    expect((roofMesh(gable).material as ThreeNS.Material[]).length).toBe(4);

    const hipped = new THREE.Scene();
    buildRoof(THREE, { scene: hipped, width: 10, depth: 8, baseY: 3, spec: { style: 'hipped' } });
    const roof = roofMesh(hipped);
    expect((roof.material as ThreeNS.Material[]).length).toBe(2);
    const soffit = roof.geometry.groups.find((g) => g.materialIndex === 1)!;
    expect(soffit.count).toBe(6);
    const fascias: ThreeNS.Object3D[] = [];
    hipped.traverse((o) => o.name === 'Fascia' && fascias.push(o));
    expect(fascias).toHaveLength(4);
    // Below the soffit's plane, never in it (#276).
    for (const fascia of fascias) {
      const box = new THREE.Box3().setFromObject(fascia);
      expect(box.min.y).toBeLessThan(3);
    }
  });

  it("runs a gable end's courses on from its walls, wherever their pattern starts", () => {
    const endMap = (patternOriginY?: number): ThreeNS.Texture => {
      const scene = new THREE.Scene();
      buildRoof(THREE, {
        scene, width: 10, depth: 8, baseY: 3, spec: { style: 'gable' },
        gableWalls: { pattern: 'brick', colors: { west: '#a5533c', east: '#a5533c' }, ...(patternOriginY === undefined ? {} : { patternOriginY }) },
      });
      // Slot 3: the gable ends (both in one finish, so one material).
      return (roofMesh(scene).material as ThreeNS.MeshStandardMaterial[])[3]!.map!;
    };
    // A wall 1.3 m tall from y = -0.25 (a neighbour's block, metre UVs, no offset) ends 1.3 m up its pattern.
    const wall = mapOf(buildWallMaterial(THREE, { pattern: 'brick', color: '#a5533c', width: 1, height: 1 }));
    const atEaves = (3 - -0.25) * wall.repeat.y;
    // The roof's v is metres from its base, so the end's pattern at its foot is its offset.
    const foot = endMap(-0.25).offset.y;
    expect((((atEaves - foot) % 1) + 1) % 1).toBeCloseTo(0);
    // The house's own walls start at the ground.
    expect(endMap().offset.y).toBeCloseTo((3 * wall.repeat.y) % 1);
  });
});
