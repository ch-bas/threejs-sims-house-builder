import { floorKeepOut, type KeepOutBuilding } from './floor-keep-out';
import { hasCollisions } from './geometry';
import { storeyHeight } from './storeys';
import type { FurnitureItem } from './types';

/** The placed items of one rendered storey and whether each one collides. */
export interface FurnitureFloorPlan {
  index: number;
  items: readonly FurnitureItem[];
  /** Parallel to `items`: the red collision tint. */
  collisions: readonly boolean[];
}

/**
 * What the 3D furniture meshes are built from: the placed items of the
 * storeys on screen (all of them under "show all floors", else the active
 * one) and their collision state. Interior walls, the porch and stairwells
 * enter only through `collisions`, so a wall that doesn't change any
 * item's tint doesn't change the plan's keys (#214).
 */
export function planFurniture(
  building: KeepOutBuilding,
  showAllFloors: boolean,
  activeFloorIndex: number
): FurnitureFloorPlan[] {
  const indices = showAllFloors ? building.floors.map((_, index) => index) : [activeFloorIndex];
  const plan: FurnitureFloorPlan[] = [];
  for (const index of indices) {
    const floor = building.floors[index];
    if (!floor) continue;
    const keepOut = floorKeepOut(building, index);
    const items = floor.items.filter((item) => item.position);
    const collisions = items.map((item) =>
      hasCollisions(item, floor.items, building.width, building.height, { keepOut, interiorWalls: floor.interiorWalls, storeyHeight: storeyHeight(floor) })
    );
    plan.push({ index, items, collisions });
  }
  return plan;
}

/**
 * Content signature of the plan's items. Every floor-scoped edit (wall
 * paint, floor pattern, interior walls) gives `layout.floors` a new
 * identity; keyed on this instead, the furniture and overlay effects only
 * rebuild when an item actually changed (#214).
 */
export function furnitureItemsKey(plan: readonly FurnitureFloorPlan[]): string {
  return JSON.stringify(plan.map((floor) => [floor.index, floor.items]));
}

/** Signature of which items wear the collision tint. */
export function furnitureCollisionKey(plan: readonly FurnitureFloorPlan[]): string {
  return plan.map((floor) => floor.collisions.map((collides) => (collides ? '1' : '0')).join('')).join('|');
}

/**
 * Item fields the furniture effect applies to an existing group (its
 * transform and pick flags) or that no builder reads, so changing one moves
 * the mesh instead of rebuilding it (#404). Everything else — size, colour,
 * shape, and any field added later — rebuilds, which is the safe default.
 */
const PLACEMENT_FIELDS: ReadonlySet<string> = new Set([
  'position', 'rotation', 'mirrored', 'locked', 'name', 'icon', 'price', 'groupId',
]);

/**
 * Types whose builder reads `rotation`: a bracket camera counter-rotates its
 * wall plate against the facing, so turning it changes the mesh.
 */
const ROTATION_BUILT_TYPES: ReadonlySet<string> = new Set(['security-camera']);

/** A furniture group's identity in the scene: an item on one storey. */
export function furnitureMeshKey(floorIndex: number, itemId: string): string {
  return `${floorIndex}:${itemId}`;
}

export interface FurnitureBuildInputs {
  /** The item fitted to its storey (`itemForStorey`), as the builder sees it. */
  item: FurnitureItem;
  collision: boolean;
  storeyHeight: number;
  /** Faded as another storey under "show all floors". */
  ghosted: boolean;
  /** The rigged people model is loaded; only a person's mesh depends on it. */
  peopleModelReady: boolean;
}

/**
 * Signature of everything a furniture group's meshes and materials are built
 * from. Equal keys mean the existing group can be kept and re-placed; the
 * collision tint and the ghost fade mutate the materials, so they are part of
 * it (#404).
 */
export function furnitureBuildKey({ item, collision, storeyHeight, ghosted, peopleModelReady }: FurnitureBuildInputs): string {
  const built: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(item)) {
    if (PLACEMENT_FIELDS.has(field) && !(field === 'rotation' && ROTATION_BUILT_TYPES.has(item.type))) continue;
    built[field] = value;
  }
  return JSON.stringify([built, collision, storeyHeight, ghosted, item.type === 'person' && peopleModelReady]);
}

export interface FurnitureDiff {
  /** Keys gone from the plan: dispose their groups. */
  removed: string[];
  /** Keys to build: new to the plan, or with a different build key (dispose the old group first). */
  built: string[];
  /** Keys whose group stays; only its transform and flags are refreshed. */
  kept: string[];
}

/** Which furniture groups to keep, rebuild and drop, compared by build key (#404). */
export function diffFurniture(previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): FurnitureDiff {
  const diff: FurnitureDiff = { removed: [], built: [], kept: [] };
  for (const key of previous.keys()) if (!next.has(key)) diff.removed.push(key);
  for (const [key, buildKey] of next) {
    if (previous.get(key) === buildKey) diff.kept.push(key);
    else diff.built.push(key);
  }
  return diff;
}
