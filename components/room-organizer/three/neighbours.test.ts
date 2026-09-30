import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateStreet, type StreetHouseSpec } from '../lib/street-row';
import { NEIGHBOUR_TAG, buildNeighbours, removeNeighbours } from './neighbours';
import { applyWallDisplay } from './room-builder';

const SITE = {
  width: 6,
  depth: 9,
  floorYs: [0, 2.5, 5.5],
  eavesY: 6.6,
  roof: { style: 'gable' as const },
};

const pair = () => generateStreet({ ...SITE, neighbours: { west: true, east: true } });

/** A hand-made house so a test controls exactly what the builder sees. */
function house(overrides: Partial<StreetHouseSpec> = {}): StreetHouseSpec {
  return {
    id: 'h',
    row: 'ours',
    x: 0,
    frontZ: -3,
    facing: -1,
    width: 4,
    depth: 6,
    floorYs: [0, 3],
    eavesY: 6,
    groundFrontY: 0,
    groundBackY: 0,
    roof: { style: 'gable', color: '#8d6e63', pitch: 1 },
    facade: { color: '#b5654a', finish: 'plain' },
    bay: false,
    dormer: false,
    door: { color: '#1f3a5f', offset: 0 },
    chimney: false,
    attached: true,
    openSides: { west: false, east: false },
    ...overrides,
  };
}

const tagged = (scene: THREE.Scene) => scene.children.filter((obj) => obj.userData.type === NEIGHBOUR_TAG);
const houses = (scene: THREE.Scene) => tagged(scene).filter((obj) => obj.userData.houseId !== undefined);
const instances = (scene: THREE.Scene, part: string) =>
  tagged(scene).find((obj) => obj.userData.part === part) as THREE.InstancedMesh | undefined;

/** World-space centre and scale of every instance of a part. */
function instanceBoxes(scene: THREE.Scene, part: string): Array<{ position: THREE.Vector3; scale: THREE.Vector3 }> {
  const mesh = instances(scene, part);
  if (!mesh) return [];
  const matrix = new THREE.Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, matrix);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    matrix.decompose(position, new THREE.Quaternion(), scale);
    return { position, scale };
  });
}

describe('party-wall neighbours (#202)', () => {
  it('builds a house on each requested side, flush against the party walls', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, pair());
    const built = houses(scene);
    expect(built.map((obj) => obj.userData.side)).toEqual(['west', 'east']);
    for (const obj of built) {
      // The block: inner face just off our wall plane (x = ±3), from the
      // plinth depth to our eaves.
      const block = new THREE.Box3().setFromObject(obj.children[0]!);
      expect(Math.min(Math.abs(block.min.x), Math.abs(block.max.x))).toBeCloseTo(3.02);
      expect(block.min.y).toBeCloseTo(-0.25);
      expect(block.max.y).toBeCloseTo(6.6);
      // Roofed above our eaves.
      expect(new THREE.Box3().setFromObject(obj).max.y).toBeGreaterThan(7);
    }
  });

  it('keeps its roof inside the neighbour, off the scene’s own roof tag', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, pair());
    expect(scene.children.some((obj) => obj.userData.type === 'roof')).toBe(false);
    expect(houses(scene)[0]!.children.some((obj) => obj.userData.type === 'roof')).toBe(true);
  });

  it('stays visible in every wall-display mode (#201)', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, pair());
    for (const mode of ['up', 'cutaway', 'down'] as const) {
      applyWallDisplay(scene, 20, 0, mode, 6, 9);
      expect(tagged(scene).every((obj) => obj.visible)).toBe(true);
    }
  });

  it('never carries our dormers onto the neighbours (#203)', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, pair());
    let dormers = 0;
    scene.traverse((obj) => {
      if (obj.userData.dormerId !== undefined) dormers += 1;
    });
    expect(dormers).toBe(0);
  });

  it('rebuilds instead of stacking, and removes cleanly', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, pair());
    buildNeighbours(THREE, scene, pair());
    expect(houses(scene)).toHaveLength(2);
    removeNeighbours(scene);
    expect(tagged(scene)).toHaveLength(0);
    buildNeighbours(THREE, scene, []);
    expect(tagged(scene)).toHaveLength(0);
  });
});

describe('the street (#310)', () => {
  it('draws one merged masonry mesh per house plus shared instanced parts', () => {
    const scene = new THREE.Scene();
    const street = generateStreet({ ...SITE, neighbours: { west: true, east: true, street: true, across: true, seed: 7 } });
    buildNeighbours(THREE, scene, street);
    expect(houses(scene)).toHaveLength(street.length);
    // Six instanced part sets at most, whatever the number of houses.
    expect(tagged(scene).length - street.length).toBeLessThanOrEqual(6);
    for (const obj of houses(scene)) {
      const masonry = obj.children[0] as THREE.Mesh;
      expect(masonry.isMesh).toBe(true);
      expect(masonry.castShadow).toBe(true);
      expect(masonry.receiveShadow).toBe(true);
      // Masonry plus the roof builder's one to three meshes.
      expect(obj.children.length).toBeLessThanOrEqual(4);
    }
    for (const part of ['frames', 'panes', 'doors', 'steps']) {
      const mesh = instances(scene, part);
      expect(mesh?.isInstancedMesh).toBe(true);
      expect(mesh?.castShadow).toBe(true);
    }
  });

  it('shares a material between houses of the same finish and colour', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, [house({ id: 'a', x: -5 }), house({ id: 'b', x: 5 }), house({ id: 'c', x: 15, facade: { color: '#e9e2d3', finish: 'plain' } })]);
    const materials = houses(scene).map((obj) => (obj.children[0] as THREE.Mesh).material);
    expect(materials[0]).toBe(materials[1]);
    expect(materials[0]).not.toBe(materials[2]);
  });

  it('fits the windows to the facade: one on a narrow terrace, none where a frame would not fit (#280)', () => {
    const narrow = new THREE.Scene();
    buildNeighbours(THREE, narrow, [house({ width: 2 })]);
    const frames = instanceBoxes(narrow, 'frames').filter((box) => box.scale.y < 2);
    // Two storeys × front and back, one window each — less the ground-floor
    // front one, which the door takes — and every frame inside the wall.
    expect(frames).toHaveLength(3);
    for (const frame of frames) expect(Math.abs(frame.position.x) + frame.scale.x / 2).toBeLessThanOrEqual(1);

    const sliver = new THREE.Scene();
    buildNeighbours(THREE, sliver, [house({ width: 1.2 })]);
    expect(instanceBoxes(sliver, 'panes')).toHaveLength(0);
  });

  it('skips window rows the ground outside would bury, and puts the door on the street-level storey (#280)', () => {
    const scene = new THREE.Scene();
    // Street a storey up: the ground floor is a basement at the front.
    buildNeighbours(THREE, scene, [house({ groundFrontY: 3, groundBackY: 0, floorYs: [0, 3], eavesY: 6 })]);
    const panes = instanceBoxes(scene, 'panes');
    expect(panes.length).toBeGreaterThan(0);
    for (const pane of panes) {
      const onFront = pane.position.z < -2.9;
      const sill = pane.position.y - pane.scale.y / 2;
      if (onFront) expect(sill).toBeGreaterThanOrEqual(3);
      else expect(sill).toBeGreaterThanOrEqual(0);
    }
    const [door] = instanceBoxes(scene, 'doors');
    expect(door!.position.y - door!.scale.y / 2).toBeCloseTo(3);
  });

  it('raises a stoop where the floor stands above the ground', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, [house({ groundFrontY: -0.6, groundBackY: -0.6 })]);
    const [step] = instanceBoxes(scene, 'steps');
    expect(step!.scale.y).toBeCloseTo(0.6);
    expect(step!.position.y).toBeCloseTo(-0.3);
  });

  it('opens windows in a free-standing side wall only', () => {
    const closed = new THREE.Scene();
    buildNeighbours(THREE, closed, [house()]);
    const open = new THREE.Scene();
    buildNeighbours(THREE, open, [house({ openSides: { west: true, east: false } })]);
    const sidePanes = (scene: THREE.Scene) => instanceBoxes(scene, 'panes').filter((pane) => Math.abs(pane.position.x) > 1.9);
    expect(sidePanes(closed)).toHaveLength(0);
    expect(sidePanes(open).length).toBeGreaterThan(0);
    expect(sidePanes(open).every((pane) => pane.position.x < 0)).toBe(true);
  });

  it('turns a house across the road to face us', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, [house({ row: 'across', frontZ: -20, facing: 1, door: { color: '#111111', offset: 0.9 } })]);
    const [door] = instanceBoxes(scene, 'doors');
    // Proud of the front wall on the road side, toward us.
    expect(door!.position.z).toBeCloseTo(-20 + 0.04, 1);
    // Mirrored: the door's local offset ends up on the other side.
    expect(door!.position.x).toBeCloseTo(-0.9);
    const block = new THREE.Box3().setFromObject(houses(scene)[0]!.children[0]!);
    expect(block.max.z).toBeCloseTo(-20);
    expect(block.min.z).toBeCloseTo(-26);
  });

  it('builds the extras a spec asks for', () => {
    const scene = new THREE.Scene();
    buildNeighbours(THREE, scene, [house({ width: 7, bay: true, dormer: true, chimney: true, roof: { style: 'hipped', color: '#5d4037', pitch: 1.2 } })]);
    expect(instanceBoxes(scene, 'chimneys')).toHaveLength(1);
    // Bay cap, dormer cap, four hipped gutters.
    expect(instanceBoxes(scene, 'darkTrim')).toHaveLength(6);
    const [chimney] = instanceBoxes(scene, 'chimneys');
    expect(chimney!.position.y + chimney!.scale.y / 2).toBeGreaterThan(6.8);
  });
});
