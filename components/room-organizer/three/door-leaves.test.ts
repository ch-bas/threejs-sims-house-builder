import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { DOOR_LEAF_NAME, DOOR_OPEN_ANGLE } from '../lib/door-swing';
import { createNpcBody, createNpcHandOff } from '../lib/npc-bodies';
import { createDoorSwinger, doorWalkersOf } from './door-leaves';
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
  for (let i = 0; i < 120; i++) swinger.step([walker], 1 / 60, false);
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
    expect(swinger.step([{ x: 0, z: 0.5, floorIndex: 0 }], 1 / 60, false)).toBe(false);
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
    swinger.step([{ x: 0, z: 1, floorIndex: 0 }], 1 / 60, false);
    const leaf = rebuilt.getObjectByName(DOOR_LEAF_NAME)!;
    expect(Math.abs(leaf.rotation.y)).toBeGreaterThan(0);
    expect(Math.abs(leaf.rotation.y)).toBeLessThan(DOOR_OPEN_ANGLE);
  });

  describe('for several people (#908)', () => {
    const steps = (swinger: ReturnType<typeof createDoorSwinger>, walkers: Array<{ x: number; z: number; floorIndex: number }>, frames = 120) => {
      for (let i = 0; i < frames; i++) swinger.step(walkers, 1 / 60, false);
    };

    it('opens each door for the nearest person on its storey, away from that person', () => {
      const scene = sceneWith([
        { item: door(), floorIndex: 0 },
        { item: door({ id: 'east', position: { x: 4, z: 0 } }), floorIndex: 0 },
        { item: door({ id: 'up' }), floorIndex: 1 },
      ]);
      const swinger = createDoorSwinger(scene);
      // One walker in the room by the first door, one outside by the second,
      // a third far off; nobody upstairs.
      steps(swinger, [
        { x: 8, z: 8, floorIndex: 0 },
        { x: 0.2, z: 1, floorIndex: 0 },
        { x: 4, z: -1, floorIndex: 0 },
      ]);
      expect(Math.abs(leafOf(scene, 0).rotation.y)).toBeCloseTo(DOOR_OPEN_ANGLE);
      expect(leafBox(scene, 0).min.z).toBeLessThan(-0.7);
      expect(Math.abs(leafOf(scene, 1).rotation.y)).toBeCloseTo(DOOR_OPEN_ANGLE);
      expect(leafBox(scene, 1).max.z).toBeGreaterThan(0.7);
      expect(leafOf(scene, 2).rotation.y).toBe(0);
    });

    it('takes the side from whoever is nearest as the door starts to open', () => {
      const scene = sceneWith([{ item: door(), floorIndex: 0 }]);
      const swinger = createDoorSwinger(scene);
      // Both in reach; the one outside (local −Z) is nearer: the leaf swings into the room.
      steps(swinger, [
        { x: 0, z: 1.5, floorIndex: 0 },
        { x: 0, z: -1, floorIndex: 0 },
      ]);
      expect(leafBox(scene, 0).max.z).toBeGreaterThan(0.7);
    });

    it('reopens a door still shutting when someone else comes up to it', () => {
      const scene = sceneWith([{ item: door(), floorIndex: 0 }]);
      const settled = vi.fn();
      const swinger = createDoorSwinger(scene, settled);
      steps(swinger, [{ x: 0, z: 1, floorIndex: 0 }]);
      // Gone: it starts to shut.
      steps(swinger, [], 10);
      const shutting = Math.abs(leafOf(scene).rotation.y);
      expect(shutting).toBeGreaterThan(0);
      expect(shutting).toBeLessThan(DOOR_OPEN_ANGLE);
      // A walker steps into the doorway: never less open than that asks.
      swinger.step([{ x: 0, z: 0.3, floorIndex: 0 }], 1 / 60, false);
      expect(Math.abs(leafOf(scene).rotation.y)).toBeCloseTo(DOOR_OPEN_ANGLE);
      steps(swinger, [{ x: 0, z: 0.3, floorIndex: 0 }]);
      // One shadow pass per settle (open, then open again), not per frame.
      expect(settled).toHaveBeenCalledTimes(2);
    });

    it('stays shut with nobody about, and asks for nothing', () => {
      const scene = sceneWith([{ item: door(), floorIndex: 0 }]);
      const settled = vi.fn();
      const swinger = createDoorSwinger(scene, settled);
      expect(swinger.step([], 1 / 60, false)).toBe(false);
      expect(settled).not.toHaveBeenCalled();
    });
  });

  it('reads the player and the walkers from the hand-off into a reused list (#908)', () => {
    const handOff = createNpcHandOff();
    handOff.bodies = [createNpcBody(1, 2, 0, 0), createNpcBody(-1, 3, 3, 1)];
    const out: Array<{ x: number; z: number; floorIndex: number }> = [];
    expect(doorWalkersOf(handOff, out)).toEqual([
      { x: 1, z: 2, floorIndex: 0 },
      { x: -1, z: 3, floorIndex: 1 },
    ]);
    const first = out[0];
    Object.assign(handOff.player, { present: true, x: 5, z: 6, floorIndex: 0 });
    handOff.bodies = [handOff.bodies[0]!];
    const again = doorWalkersOf(handOff, out);
    expect(again).toBe(out);
    expect(again).toEqual([
      { x: 5, z: 6, floorIndex: 0 },
      { x: 1, z: 2, floorIndex: 0 },
    ]);
    // Same entry objects, rewritten in place.
    expect(out[0]).toBe(first);
    // Reduced motion: the walkers stand still and open nothing; the player still does.
    expect(doorWalkersOf(handOff, out, false)).toEqual([{ x: 5, z: 6, floorIndex: 0 }]);
    handOff.player.present = false;
    expect(doorWalkersOf(handOff, out, false)).toEqual([]);
  });
});

describe('door types in EXPLORE (#922)', () => {
  const leavesOf = (scene: THREE.Scene): THREE.Object3D[] => {
    const found: THREE.Object3D[] = [];
    scene.children[0]!.traverse((part) => {
      if (part.name === DOOR_LEAF_NAME) found.push(part);
    });
    return found;
  };

  it('swings both leaves of a double door open to the same side', () => {
    const scene = sceneWith([{ item: door({ width: 1.6, openingStyle: 'double' }), floorIndex: 0 }]);
    const leaves = leavesOf(scene);
    expect(leaves).toHaveLength(2);
    const swinger = createDoorSwinger(scene);
    settle(swinger, { x: 0, z: -0.5, floorIndex: 0 });
    scene.updateMatrixWorld(true);
    for (const leaf of leaves) {
      const box = new THREE.Box3().setFromObject(leaf.children[0]!);
      // Away from the walker on −z: both into +z.
      expect(box.max.z).toBeGreaterThan(0.5);
      expect(box.min.z).toBeGreaterThan(-0.1);
    }
    expect(leaves[0]!.rotation.y).toBeCloseTo(-DOOR_OPEN_ANGLE);
    expect(leaves[1]!.rotation.y).toBeCloseTo(DOOR_OPEN_ANGLE);
    swinger.shutAll();
    expect(leaves.map((leaf) => leaf.rotation.y)).toEqual([0, 0]);
  });

  it('slides a sliding door\'s pane open behind the other, and back', () => {
    const scene = sceneWith([{ item: door({ width: 2, openingStyle: 'sliding' }), floorIndex: 0 }]);
    const [pane] = leavesOf(scene);
    const shutX = pane!.position.x;
    expect(shutX).toBeGreaterThan(0);
    const swinger = createDoorSwinger(scene);
    settle(swinger, { x: 0, z: 0.5, floorIndex: 0 });
    expect(pane!.rotation.y).toBe(0);
    expect(pane!.position.x).toBeCloseTo(-shutX);
    swinger.shutAll();
    expect(pane!.position.x).toBeCloseTo(shutX);
  });

  it('has nothing to open on an archway', () => {
    const scene = sceneWith([{ item: door({ width: 1.2, height: 2.2, openingStyle: 'arch' }), floorIndex: 0 }]);
    expect(leavesOf(scene)).toEqual([]);
  });
});

describe('a door set to open out (#917)', () => {
  it('opens to its own side whichever side the walker comes from; a default door opens away from them', () => {
    for (const walkerZ of [-0.5, 0.5]) {
      const out = sceneWith([{ item: door({ swingOut: true }), floorIndex: 0 }]);
      settle(createDoorSwinger(out), { x: 0, z: walkerZ, floorIndex: 0 });
      expect(slabBox(out).min.z).toBeLessThan(-0.5);
      const plain = sceneWith([{ item: door(), floorIndex: 0 }]);
      settle(createDoorSwinger(plain), { x: 0, z: walkerZ, floorIndex: 0 });
      expect(walkerZ < 0 ? slabBox(plain).max.z : -slabBox(plain).min.z).toBeGreaterThan(0.5);
    }
  });

  it('keeps what the swinger needs off the leaves, so the GLB extras carry none of it (#922)', () => {
    for (const patch of [{ swingOut: true as const }, { width: 1.6, openingStyle: 'double' as const }, { width: 2, openingStyle: 'sliding' as const }]) {
      const scene = sceneWith([{ item: door(patch), floorIndex: 0 }]);
      scene.children[0]!.traverse((part) => {
        if (part.name === DOOR_LEAF_NAME) expect(Object.keys(part.userData)).toEqual([]);
      });
    }
  });

  it('closes the jamb on a shut double door: each leaf reaches its casing', () => {
    const scene = sceneWith([{ item: door({ width: 1.6, openingStyle: 'double' }), floorIndex: 0 }]);
    scene.updateMatrixWorld(true);
    const parts: THREE.Object3D[] = [];
    scene.children[0]!.traverse((part) => {
      if (part.name === DOOR_LEAF_NAME) parts.push(part);
    });
    const boxes = parts.map((leaf) => new THREE.Box3().setFromObject(leaf.children[0]!));
    expect(boxes[0]!.min.x).toBeCloseTo(-0.8 + 0.06 + 0.004, 3);
    expect(boxes[1]!.max.x).toBeCloseTo(0.8 - 0.06 - 0.004, 3);
  });
});
