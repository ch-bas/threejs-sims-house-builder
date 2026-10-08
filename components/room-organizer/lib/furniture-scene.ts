import { floorKeepOut, type KeepOutBuilding } from './floor-keep-out';
import { hasCollisions } from './geometry';
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
      hasCollisions(item, floor.items, building.width, building.height, { keepOut, interiorWalls: floor.interiorWalls })
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
