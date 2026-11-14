import { DOOR_LEAF_NAME, DOOR_SHUT, doorLeafAngle, stepDoorSwing, type DoorSwingState } from '../lib/door-swing';
import { FURNITURE_REVISION_KEY } from './drag-handlers';
import { ROOM_OBJECT_TAGS } from './room-builder';
import type * as ThreeNS from 'three';

interface DoorLeaf {
  group: ThreeNS.Object3D;
  pivot: ThreeNS.Object3D;
  state: DoorSwingState;
}

/** Where the walker is: plan position and the storey its feet are on. */
export interface DoorWalker {
  x: number;
  z: number;
  floorIndex: number;
}

export interface DoorSwinger {
  /**
   * One frame: swing every door on the walker's storey toward what the
   * walker's distance asks. Touches only the leaves' `rotation.y` (the
   * furniture groups are kept, #404). True when a leaf moved.
   */
  step(walker: DoorWalker, seconds: number, reducedMotion: boolean): boolean;
  /** Shut every door at once (leaving EXPLORE). True when one was open. */
  shutAll(): boolean;
}

/**
 * Drives the door leaves in the scene for the first-person walk (#605).
 * The furniture groups are found again whenever the furniture effect bumps
 * its revision, so a door rebuilt mid-walk is picked up, shut.
 * `onSettled` runs once the leaves stop, not per frame: the static shadow
 * map is redrawn then (a moving leaf keeps its old shadow meanwhile).
 */
export function createDoorSwinger(scene: ThreeNS.Object3D, onSettled?: () => void): DoorSwinger {
  let revision: unknown = Symbol('unread');
  let leaves: DoorLeaf[] = [];
  let swinging = false;

  const collect = (): DoorLeaf[] => {
    const current = scene.userData[FURNITURE_REVISION_KEY];
    if (current === revision) return leaves;
    revision = current;
    const previous = new Map(leaves.map((leaf) => [leaf.pivot, leaf.state]));
    leaves = [];
    for (const group of scene.children) {
      if (group.userData.type !== ROOM_OBJECT_TAGS.Furniture) continue;
      const pivot = group.getObjectByName(DOOR_LEAF_NAME);
      if (!pivot) continue;
      leaves.push({ group, pivot, state: previous.get(pivot) ?? DOOR_SHUT });
    }
    return leaves;
  };

  return {
    step(walker, seconds, reducedMotion) {
      let moved = false;
      for (const leaf of collect()) {
        const { group } = leaf;
        const sameStorey = group.userData.floorIndex === walker.floorIndex && group.visible;
        const dx = walker.x - group.position.x;
        const dz = walker.z - group.position.z;
        const distance = sameStorey ? Math.hypot(dx, dz) : Infinity;
        // Across the wall: the door's local +Z is (sin r, cos r) in plan.
        const localZ = dx * Math.sin(group.rotation.y) + dz * Math.cos(group.rotation.y);
        const next = stepDoorSwing(leaf.state, distance, localZ, seconds, reducedMotion);
        if (next === leaf.state) continue;
        leaf.state = next;
        leaf.pivot.rotation.y = doorLeafAngle(next);
        moved = true;
      }
      if (moved) swinging = true;
      else if (swinging) {
        swinging = false;
        onSettled?.();
      }
      return moved;
    },
    shutAll() {
      let moved = false;
      for (const leaf of leaves) {
        if (leaf.state.open === 0) continue;
        leaf.state = DOOR_SHUT;
        leaf.pivot.rotation.y = 0;
        moved = true;
      }
      if (moved || swinging) onSettled?.();
      swinging = false;
      return moved;
    },
  };
}
