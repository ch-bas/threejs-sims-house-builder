import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { DOOR_LEAF_NAME, DOOR_OPEN_ANGLE } from '../lib/door-swing';
import { createDoorSwinger } from './door-leaves';
import { FURNITURE_REVISION_KEY } from './drag-handlers';
import { createFurnitureModel } from './furniture-builders';
import { ROOM_OBJECT_TAGS } from './room-builder';
import type { FurnitureItem } from '../lib/types';

const door = (patch: Partial<FurnitureItem> = {}): FurnitureItem =>
  makeItem({ id: 'door', type: 'door', name: 'Door', category: 'structure', width: 0.9, depth: 0.15, height: 2.05, position: { x: 0, z: 0 }, ...patch });

/** A scene as the furniture effect leaves it: tagged groups placed, a revision bumped. */
function sceneWith(items: Array<{ item: FurnitureItem; floorIndex: number }>): THREE.Scene {
  const scene = new THREE.Scene();
  for (const { item, floorIndex } of items) {
    const group = createFurnitureModel(THREE, item, false);
    group.userData.type = ROOM_OBJECT_TAGS.Furniture;
    group.userData.floorIndex = floorIndex;
    group.position.set(item.position!.x, 0, item.position!.z);
    group.rotation.y = item.rotation ?? 0;
    group.scale.x = item.mirrored ? -1 : 1;
    scene.add(group);
  }
  scene.userData[FURNITURE_REVISION_KEY] = 1;
  return scene;
}

const leafOf = (scene: THREE.Scene, index = 0): THREE.Object3D => scene.children[index]!.getObjectByName(DOOR_LEAF_NAME)!;

/** World bounds of the leaf (slab and handle). */
function leafBox(scene: THREE.Scene, index = 0): THREE.Box3 {
  scene.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(leafOf(scene, index));
}

/** World bounds of the slab alone: the handle stands out in the room, clear of the frame. */
function slabBox(scene: THREE.Scene, index = 0): THREE.Box3 {
  scene.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(leafOf(scene, index).children[0]!);
}

function settle(swinger: ReturnType<typeof createDoorSwinger>, walker: { x: number; z: number; floorIndex: number }): void {
  for (let i = 0; i < 120; i++) swinger.step(walker, 1 / 60, false);
}

describe('door leaves (#605)', () => {
  it('builds the door shut, its leaf in a pivot on the hinge jamb', () => {
    const scene = sceneWith([{ item: door(), floorIndex: 0 }]);
    const leaf = leafOf(scene);
    expect(leaf.rotation.y).toBe(0);
    expect(leaf.position.x).toBeLessThan(0);
    const box = leafBox(scene);
    expect(box.min.x).toBeCloseTo(-0.9 * 0.95 / 2);
    expect(box.max.z).toBeLessThan(0.15 / 2 + 0.01);
  });

  it('swings the leaf open away from a walker who comes up to it, and shuts it on exit', () => {
    const scene = sceneWith([{ item: door(), floorIndex: 0 }]);
    const settled = vi.fn();
    const swinger = createDoorSwinger(scene, settled);
    // The walker stands in the room (local +Z): the leaf swings to −Z.
    settle(swinger, { x: 0, z: 1, floorIndex: 0 });
    expect(Math.abs(leafOf(scene).rotation.y)).toBeCloseTo(DOOR_OPEN_ANGLE);
    const open = leafBox(scene);
    expect(open.min.z).toBeLessThan(-0.7);
    expect(open.max.z).toBeLessThan(0.1);
    // Hinged on its jamb: the slab stays at that end of the opening.
    expect(slabBox(scene).max.x).toBeLessThan(-0.3);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(swinger.shutAll()).toBe(true);
    expect(leafOf(scene).rotation.y).toBe(0);
    expect(swinger.shutAll()).toBe(false);
  });

  it('clears the jamb when swung square, on either side (no clip, no shared face)', () => {
    for (const z of [1, -1]) {
      const scene = sceneWith([{ item: door(), floorIndex: 0 }]);
      settle(createDoorSwinger(scene), { x: 0, z, floorIndex: 0 });
      const jambInnerFace = -0.9 / 2 + 0.06;
      const slab = slabBox(scene);
      expect(slab.min.x).toBeGreaterThan(jambInnerFace + 0.001);
      // The handle is out in the room, past the jamb's depth.
      const handle = new THREE.Box3().setFromObject(leafOf(scene).children[1]!);
      expect(Math.min(Math.abs(handle.min.z), Math.abs(handle.max.z))).toBeGreaterThan(0.15 / 2);
    }
  });

  it('keeps the shut slab where it always stood', () => {
    const scene = sceneWith([{ item: door(), floorIndex: 0 }]);
    scene.updateMatrixWorld(true);
    const slab = leafOf(scene).children[0]!;
    const box = new THREE.Box3().setFromObject(slab);
    expect(box.min.x).toBeCloseTo(-0.9 * 0.95 / 2);
    expect(box.max.x).toBeCloseTo(0.9 * 0.95 / 2);
  });

  it('hinges a mirrored door on the other jamb', () => {
    const scene = sceneWith([{ item: door({ mirrored: true }), floorIndex: 0 }]);
    const swinger = createDoorSwinger(scene);
    settle(swinger, { x: 0, z: -1, floorIndex: 0 });
    const open = leafBox(scene);
    expect(open.min.x).toBeGreaterThan(0.3);
    expect(open.max.z).toBeGreaterThan(0.7);
  });

  it('follows the door’s turn: a door in a side wall opens across that wall', () => {
    const scene = sceneWith([{ item: door({ rotation: Math.PI / 2, position: { x: 2, z: 0 } }), floorIndex: 0 }]);
    const swinger = createDoorSwinger(scene);
    // Local +Z of a quarter-turned door is world +X: the walker at x = 3 is on that side.
    settle(swinger, { x: 3, z: 0, floorIndex: 0 });
    const open = leafBox(scene);
    expect(open.min.x).toBeLessThan(2 - 0.7);
  });

  it('leaves doors on other storeys and out of reach alone', () => {
    const scene = sceneWith([
      { item: door(), floorIndex: 1 },
      { item: door({ id: 'far', position: { x: 6, z: 0 } }), floorIndex: 0 },
    ]);
    const swinger = createDoorSwinger(scene);
    expect(swinger.step({ x: 0, z: 0.5, floorIndex: 0 }, 1 / 60, false)).toBe(false);
    expect(leafOf(scene, 0).rotation.y).toBe(0);
    expect(leafOf(scene, 1).rotation.y).toBe(0);
  });

  it('picks up a door rebuilt mid-walk, shut', () => {
    const scene = sceneWith([{ item: door(), floorIndex: 0 }]);
    const swinger = createDoorSwinger(scene);
    settle(swinger, { x: 0, z: 1, floorIndex: 0 });
    const rebuilt = sceneWith([{ item: door(), floorIndex: 0 }]).children[0]!;
    scene.remove(scene.children[0]!);
    scene.add(rebuilt);
    scene.userData[FURNITURE_REVISION_KEY] = 2;
    swinger.step({ x: 0, z: 1, floorIndex: 0 }, 1 / 60, false);
    const leaf = rebuilt.getObjectByName(DOOR_LEAF_NAME)!;
    expect(Math.abs(leaf.rotation.y)).toBeGreaterThan(0);
    expect(Math.abs(leaf.rotation.y)).toBeLessThan(DOOR_OPEN_ANGLE);
  });
});
