// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeFloor } from '../lib/__testfixtures__/fixtures';
import { entranceGeometry } from '../lib/street';
import { buildEntrance } from './entrance';
import { OUTSIDE_FACE_ATTRIBUTE } from './outdoor-lamps';
import { gableWallsOf } from './roof';
import { buildRoom } from './room-builder';
import type { WallOpening } from './wall-openings';

const base = {
  width: 8,
  depth: 6,
  floorColor: '#ccc',
  floorPlanImage: null,
  floorPlanOpacity: 1,
  floorPlanFitMode: 'stretch' as const,
  floorPlan3DEffect: false,
};

const opening: WallOpening = { id: 'w1', centerAlongWall: 1, bottomFromFloor: 0.9, width: 1.2, height: 1.2 };

function wall(scene: THREE.Scene, id: string): THREE.Mesh {
  return scene.getObjectByName(`Wall ${id}`) as THREE.Mesh;
}

function colorOf(material: THREE.Material): string {
  return `#${(material as THREE.MeshStandardMaterial).color.getHexString()}`;
}

describe('outer walls with a facade (#918)', () => {
  it('keeps one material per wall when there is no facade, or it matches the inside', () => {
    for (const facade of [undefined, { colors: { north: '#123456' } }]) {
      const scene = new THREE.Scene();
      buildRoom(THREE, { ...base, scene, wallColors: { north: '#123456' }, ...(facade ? { facade } : {}) });
      const north = wall(scene, 'north');
      expect(Array.isArray(north.material)).toBe(false);
      expect(north.geometry.groups).toHaveLength(0);
    }
  });

  it('puts the outside copy of a wall with cutouts on its own material', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, {
      ...base,
      scene,
      wallColors: { north: '#123456' },
      facade: { colors: { north: '#ffffff' } },
      wallOpenings: new Map([['north', [opening]]]),
    });
    const north = wall(scene, 'north');
    const materials = north.material as THREE.Material[];
    expect(materials.map(colorOf)).toEqual(['#123456', '#ffffff']);
    for (const material of materials) expect(material.side).toBe(THREE.FrontSide);
    const { groups } = north.geometry;
    const count = north.geometry.getAttribute('position').count;
    expect(groups).toEqual([
      { start: 0, count: count / 2, materialIndex: 0 },
      { start: count / 2, count: count / 2, materialIndex: 1 },
    ]);
    // Group 1 is exactly the outside copy.
    const outside = north.geometry.getAttribute(OUTSIDE_FACE_ATTRIBUTE);
    for (let i = 0; i < count; i++) expect(outside.getX(i)).toBe(i < count / 2 ? 0 : 1);
    // A side the facade doesn't paint stays one material.
    expect(Array.isArray(wall(scene, 'south').material)).toBe(false);
  });

  it('lines the reveals into the hole in the facade colour, and the room side in the inside one', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, {
      ...base,
      scene,
      wallColors: { north: '#123456' },
      facade: { colors: { north: '#ffffff' } },
      wallOpenings: new Map([['north', [opening]]]),
    });
    const reveal = scene.getObjectByName('Reveal north') as THREE.Mesh | undefined;
    expect(reveal).toBeDefined();
    const lining = reveal!.material as THREE.Material[];
    expect(lining.map(colorOf)).toEqual(['#123456', '#ffffff']);
    // The facade group: the faces into the hole and the street ends, never one facing the room (+z).
    const [room, street] = reveal!.geometry.groups;
    expect(room!.count + street!.count).toBe(reveal!.geometry.getAttribute('position').count);
    expect(street!.count).toBeGreaterThan(0);
    const normal = reveal!.geometry.getAttribute('normal');
    const facing = new Set<string>();
    for (let i = street!.start; i < street!.start + street!.count; i += 3) {
      facing.add(`${Math.round(normal.getX(i))},${Math.round(normal.getY(i))},${Math.round(normal.getZ(i))}`);
    }
    // Jambs face ±x into the window, head and sill ±y, the ends -z to the street.
    expect([...facing].sort()).toEqual(['-1,0,0', '0,-1,0', '0,0,-1', '0,1,0', '1,0,0']);
    for (let i = room!.start; i < room!.start + room!.count; i++) expect(normal.getZ(i)).toBeGreaterThan(-0.5);
  });

  it('lines the reveals in one colour when the facade differs only by pattern', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, facade: { pattern: 'plaster' }, wallOpenings: new Map([['north', [opening]]]) });
    expect(Array.isArray((scene.getObjectByName('Reveal north') as THREE.Mesh).material)).toBe(false);
  });

  it('carries the facade up the gable ends', () => {
    const floor = makeFloor({ wallPattern: 'plaster', wallColors: { east: '#111111' }, facade: { pattern: 'brick', colors: { east: '#bb4422' } } });
    expect(gableWallsOf('gable', [floor])).toEqual({ pattern: 'brick', colors: { east: '#bb4422' } });
    expect(gableWallsOf('gable', [makeFloor({ wallPattern: 'plaster' })])).toEqual({ pattern: 'plaster' });
  });

  it('puts the facade only on the porch faces of the recess, the inside colour on the rest', () => {
    const geometry = entranceGeometry({ width: 1.4, depth: 1.2 }, { width: 6, depth: 9, floors: [{}] })!;
    const plain = buildEntrance(THREE, { geometry, wallColor: '#123456', wallTag: 'wall', floorTag: 'floor' })[0]!;
    for (const child of plain.children) expect(Array.isArray((child as THREE.Mesh).material)).toBe(false);
    const [shell] = buildEntrance(THREE, { geometry, wallColor: '#123456', facadeColor: '#ffffff', wallTag: 'wall', floorTag: 'floor' });
    const faces = shell!.children.map((child) => ((child as THREE.Mesh).material as THREE.Material[]).map(colorOf));
    const inside = '#123456';
    const out = '#ffffff';
    // Left reveal: +x into the porch; right reveal: -x; soffit: its underside; all: the street end (-z).
    expect(faces).toEqual([
      [out, inside, inside, inside, inside, out],
      [inside, out, inside, inside, inside, out],
      [inside, inside, inside, out, inside, out],
    ]);
  });
});
