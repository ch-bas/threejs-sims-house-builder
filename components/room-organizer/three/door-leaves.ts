import { DOOR_LEAF_NAME, DOOR_SHUT, doorLeafAngle, stepDoorSwing, type DoorSwingState } from '../lib/door-swing';
import { FURNITURE_REVISION_KEY } from './drag-handlers';
import { ROOM_OBJECT_TAGS } from './room-builder';
import type { NpcHandOff } from '../lib/npc-bodies';
import type * as ThreeNS from 'three';

interface DoorLeaf {
  group: ThreeNS.Object3D;
  pivot: ThreeNS.Object3D;
  state: DoorSwingState;
}

/** Someone who opens doors (the player or a walker): plan position and the storey its feet are on. */
export interface DoorWalker {
  x: number;
  z: number;
  floorIndex: number;
}

/**
 * Everyone who opens doors now, into `out` (#908): the player while
 * walking, and the walkers shown, from the hand-off their step keeps
 * current. Under reduced motion the walkers stand still where they spawned
 * (`use-npcs`), so they are left out with `walkers` false: only someone
 * moving opens a door. `out` and its entries are reused: no allocation
 * once it has grown to the head count.
 */
export function doorWalkersOf(handOff: NpcHandOff, out: DoorWalker[], walkers = true): readonly DoorWalker[] {
  const { player, bodies } = handOff;
  let count = 0;
  if (player.present) count = putDoorWalker(out, count, player.x, player.z, player.floorIndex);
  if (walkers) for (const body of bodies) count = putDoorWalker(out, count, body.collider.cx, body.collider.cz, body.floorIndex);
  out.length = count;
  return out;
}

function putDoorWalker(out: DoorWalker[], index: number, x: number, z: number, floorIndex: number): number {
  const entry = out[index];
  if (entry) {
    entry.x = x;
    entry.z = z;
    entry.floorIndex = floorIndex;
  } else out.push({ x, z, floorIndex });
  return index + 1;
}

export interface DoorSwinger {
  /**
   * One frame: swing every door toward what the nearest person on its
   * storey asks (#908), away from that person's side. Touches only the
   * leaves' `rotation.y` (the furniture groups are kept, #404). True when
   * a leaf moved. A leaf in motion gets a new small swing state each frame;
   * the leaves are re-collected only when the furniture is rebuilt.
   */
  step(walkers: readonly DoorWalker[], seconds: number, reducedMotion: boolean): boolean;
  /** Shut every door at once (leaving EXPLORE). True when one was open. */
  shutAll(): boolean;
}

/**
 * Drives the door leaves in the scene for the people in it: the
 * first-person walker (#605) and the walkers (#908).
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
    step(walkers, seconds, reducedMotion) {
      let moved = false;
      for (const leaf of collect()) {
        const { group } = leaf;
        // The nearest person on the door's storey decides how open it is
        // and, as it starts to open, which way it swings.
        let distance = Infinity;
        let dx = 0;
        let dz = 0;
        if (group.visible) {
          for (const walker of walkers) {
            if (group.userData.floorIndex !== walker.floorIndex) continue;
            const wx = walker.x - group.position.x;
            const wz = walker.z - group.position.z;
            const gap = Math.hypot(wx, wz);
            if (gap >= distance) continue;
            distance = gap;
            dx = wx;
            dz = wz;
          }
        }
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
