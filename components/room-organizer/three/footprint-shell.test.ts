import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { buildExportBuilding } from './building-export';
import { buildCeiling } from './ceiling';
import { buildAtticCeiling, buildRoof } from './roof';
import { applyWallDisplay, buildFloorGeometryWithOpenings, buildRoom, floorHoleOutlines } from './room-builder';
import { buildExcavationGeometry, buildTerrainGeometry } from './terrain';
import { computeWallOpenings } from './wall-openings';
import type { FootprintCutout, RoomLayout } from '../lib/types';

const cutout: FootprintCutout = { corner: 'ne', width: 4, depth: 3 };
const base = {
  width: 10,
  depth: 8,
  floorColor: '#ccc',
  floorPlanImage: null,
  floorPlanOpacity: 1,
  floorPlanFitMode: 'stretch' as const,
  floorPlan3DEffect: false,
};

/** Whatever a ray straight down over (x, z) hits. */
function hitsAt(root: THREE.Object3D, x: number, z: number): THREE.Intersection[] {
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
  return ray.intersectObject(root, true);
}

function namedWalls(scene: THREE.Scene): THREE.Mesh[] {
  return scene.children.filter((child): child is THREE.Mesh => child.name.startsWith('Wall '));
}

describe('the shell of an L (#727)', () => {
  it('has no floor in the cut corner and floor everywhere else', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, cutout });
    const floor = scene.getObjectByName('Floor')!;
    expect(hitsAt(floor, 3, -3)).toHaveLength(0);
    expect(hitsAt(floor, 0, -3).length).toBeGreaterThan(0);
    expect(hitsAt(floor, 3, 0).length).toBeGreaterThan(0);
  });

  it('builds six walls that close the outline, each on its own line', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, cutout });
    const walls = namedWalls(scene);
    expect(walls.map((wall) => wall.name)).toEqual([
      'Wall north',
      'Wall south',
      'Wall west',
      'Wall east',
      'Wall notch-x',
      'Wall notch-z',
    ]);
    const size = (mesh: THREE.Mesh) => {
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x;
    };
    expect(walls.map(size)).toEqual([6, 10, 8, 5, 4, 3]);
    const at = (name: string) => scene.getObjectByName(name)!.position;
    expect(at('Wall north').x).toBe(-2);
    expect(at('Wall east').z).toBeCloseTo(1.5);
    expect(at('Wall notch-x')).toMatchObject({ x: 3, z: -1 });
    expect(at('Wall notch-z')).toMatchObject({ x: 1, z: -2.5 });
  });

  it('shares colour and hiding with the side each new wall faces', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, cutout, hiddenWalls: ['east'], wallColors: { north: '#ff0000' } });
    expect(scene.getObjectByName('Wall notch-z')).toBeUndefined();
    const notch = scene.getObjectByName('Wall notch-x') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(notch.material.color.getHexString()).toBe('ff0000');
    expect(notch.userData.wallId).toBe('north');
  });

  it('runs the plinth round the L, overhanging the notch walls', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, cutout });
    const plinth = scene.getObjectByName('Foundation')!;
    expect(hitsAt(plinth, 3, -2)).toHaveLength(0);
    expect(hitsAt(plinth, 3, -0.8)).toHaveLength(0);
    expect(hitsAt(plinth, 3, -1.2).length).toBeGreaterThan(0);
    expect(hitsAt(plinth, 1.2, -3).length).toBeGreaterThan(0);
    expect(hitsAt(plinth, 0, 0)).toHaveLength(0);
  });

  it('cuts an opening on each new wall, at the right place on it', () => {
    const items = [
      makeItem({ id: 'd', type: 'door', width: 1, height: 2, position: { x: 3, z: -1 } }),
      makeItem({ id: 'w', type: 'window', width: 1, height: 1, position: { x: 1, z: -2 } }),
      makeItem({ id: 'n', type: 'window', width: 1, height: 1, position: { x: -3, z: -4 } }),
    ];
    const openings = computeWallOpenings(items, 10, 8, 3, [], cutout);
    expect(openings.get('notch-x')?.[0]?.centerAlongWall).toBe(3);
    expect(openings.get('notch-z')?.[0]?.centerAlongWall).toBe(-2);
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, cutout, wallOpenings: openings });
    // The hole sits at the door, in the wall's own frame: x = 3 is mid-wall.
    const wall = scene.getObjectByName('Wall notch-x')!;
    wall.updateMatrixWorld(true);
    const through = (x: number) =>
      new THREE.Raycaster(new THREE.Vector3(x, 1, -5), new THREE.Vector3(0, 0, 1)).intersectObject(wall).length;
    expect(through(3)).toBe(0);
    expect(through(1.3)).toBe(1);
    const north = scene.getObjectByName('Wall north')!;
    north.updateMatrixWorld(true);
    expect(new THREE.Raycaster(new THREE.Vector3(-3, 1.5, -6), new THREE.Vector3(0, 0, 1)).intersectObject(north)).toHaveLength(0);
    expect(new THREE.Raycaster(new THREE.Vector3(-1, 1.5, -6), new THREE.Vector3(0, 0, 1)).intersectObject(north)).toHaveLength(1);
  });

  it('clamps an opening onto the shortened wall', () => {
    const door = makeItem({ id: 'd', type: 'door', width: 1, height: 2, position: { x: 0.9, z: -4 } });
    const opening = computeWallOpenings([door], 10, 8, 3, [], cutout).get('north')?.[0];
    expect(opening?.centerAlongWall).toBe(0.5);
  });

  it('cutaway hides a notch wall by its own plane', () => {
    const scene = new THREE.Scene();
    buildRoom(THREE, { ...base, scene, cutout });
    // The camera in the yard of the L: outside the notch's two walls, inside the south and west ones.
    applyWallDisplay(scene, 3, -3, 'cutaway', 10, 8);
    const shown = (name: string) => scene.getObjectByName(name)!.visible;
    expect(shown('Wall notch-x')).toBe(false);
    expect(shown('Wall notch-z')).toBe(false);
    expect(shown('Wall south')).toBe(true);
    // South of the notch's x wall the same side is back.
    applyWallDisplay(scene, 3, 0, 'cutaway', 10, 8);
    expect(shown('Wall notch-x')).toBe(true);
  });

  it('keeps a stairwell flush with a notch wall off the outline, so the floor triangulates', () => {
    const opening = { centerX: 0, centerZ: -2.5, width: 2, depth: 3, rotation: 0 } as never;
    const holes = floorHoleOutlines(10, 8, [opening], cutout);
    expect(holes).toHaveLength(1);
    expect(Math.max(...holes[0]!.map(([x]) => x))).toBeLessThan(1);
    const geometry = buildFloorGeometryWithOpenings(THREE, 10, 8, [opening], cutout);
    const area = surfaceArea(geometry);
    expect(area).toBeCloseTo(68 - 2 * 3, 1);
  });

  it('caps the storey below with an L in walkthrough', () => {
    const scene = new THREE.Scene();
    const group = buildCeiling(THREE, { scene, width: 10, depth: 8, cutout, above: { y: 3, capY: 3.2, openings: [] }, below: null, shafts: false })!;
    expect(hitsAt(group, 3, -3)).toHaveLength(0);
    expect(hitsAt(group, 0, 0).length).toBeGreaterThan(0);
  });
});

function surfaceArea(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let area = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    a.fromBufferAttribute(position, index ? index.getX(i) : i);
    b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1);
    c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2);
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  return area;
}

describe('the roof of an L (#727)', () => {
  it('follows the L out to the eaves', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 3, spec: { style: 'flat' }, cutout });
    const hitsRoof = (x: number, z: number) => hitsAt(scene, x, z).length > 0;
    expect(hitsRoof(3, -3)).toBe(false);
    expect(hitsRoof(0, 0)).toBe(true);
    // The eaves overhang the notch's two walls.
    expect(hitsRoof(1.2, -2)).toBe(true);
    expect(hitsRoof(3, -1.2)).toBe(true);
    const box = new THREE.Box3().setFromObject(scene);
    expect(box.min.y).toBeCloseTo(3);
    expect(box.max.y).toBeCloseTo(3.2);
  });

  it('never puts a pitched roof over a notch', () => {
    const scene = new THREE.Scene();
    buildRoof(THREE, { scene, width: 10, depth: 8, baseY: 3, spec: { style: 'gable' }, cutout });
    expect(hitsAt(scene, 3, -3)).toHaveLength(0);
  });

  it('shapes the attic ceiling too', () => {
    const scene = new THREE.Scene();
    buildAtticCeiling(THREE, { scene, width: 10, depth: 8, baseY: 3, spec: { style: 'flat' }, cutout });
    expect(hitsAt(scene, 3, -3)).toHaveLength(0);
    expect(hitsAt(scene, 0, 0).length).toBeGreaterThan(0);
  });
});

describe('the ground of an L (#727)', () => {
  const terrain = { frontY: 1, backY: 0 };

  it('fills the cut with sloped ground, leaving the house open', () => {
    const mesh = new THREE.Mesh(buildTerrainGeometry(THREE, terrain, 60, 5, 4, 0, cutout), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    expect(hitsAt(mesh, 3, -3).length).toBeGreaterThan(0);
    expect(hitsAt(mesh, 3, -3)[0]!.point.y).toBeCloseTo(0.875);
    expect(hitsAt(mesh, 0, 0)).toHaveLength(0);
  });

  it('runs the excavation round the notch at the ground line', () => {
    const geometry = buildExcavationGeometry(THREE, terrain, 5, 4, cutout)!;
    const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(box.max.y).toBe(1);
    const position = geometry.getAttribute('position');
    const onNotchWall = Array.from({ length: position.count }, (_, i) => i).filter((i) => Math.abs(position.getZ(i) + 1.01) < 1e-6);
    // The cut's x wall stands at z = -1, where the slope has come down to 0.625.
    expect(Math.max(...onNotchWall.map((i) => position.getY(i)))).toBeCloseTo(0.6225, 2);
  });
});

describe('the GLB of an L (#727)', () => {
  const layout = (extra: Partial<RoomLayout> = {}): RoomLayout =>
    makeLayout({
      width: 10,
      height: 8,
      cutout,
      roof: { style: 'flat' },
      floors: [makeFloor({ id: 'a', name: 'Ground' }), makeFloor({ id: 'b', name: 'Upper' })],
      ...extra,
    });

  it('carries the L on every storey and under the roof', () => {
    const root = buildExportBuilding(THREE, layout());
    expect(hitsAt(root, 3, -3)).toHaveLength(0);
    const names: string[] = [];
    root.traverse((node) => names.push(node.name));
    expect(names.filter((name) => name === 'Wall notch-x')).toHaveLength(2);
    expect(hitsAt(root, 0, 0).map((hit) => hit.object.name)).toContain('Roof');
  });
});
