import { floorKeepOut, type KeepOutBuilding } from './floor-keep-out';
import { shellWalls } from './footprint';
import { floorElevation } from './storeys';
import type { FurnitureItem } from './types';

/**
 * What the baked floor contact map of one storey shows (#754): where furniture
 * meets the floor and walls meet it, as data. Occlusion is static between
 * edits, so it is painted once instead of running screen-space AO, which cost
 * 40 to 70 ms a frame. three/contact-shadow.ts paints this plan.
 */

/** A soft dark footprint, in world metres; `rotation` is the item's own. */
export interface ContactBlob {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  raised: boolean;
}

export interface ContactLine {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** A rectangle wiped clean of shadow, such as a doorway or a stairwell. */
export interface ContactClearing {
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
}

export interface ContactPlan {
  storey: number;
  floorY: number;
  width: number;
  depth: number;
  walls: ContactLine[];
  doors: ContactClearing[];
  blobs: ContactBlob[];
  holes: ContactClearing[];
}

/**
 * Standing on the floor across their whole footprint. A lamp, plant or pot is
 * narrower than its box, but its box is small, so the patch reads as its foot.
 * Stairs, straight or winder, fill their whole rectangle down to the floor.
 */
const SOLID_TYPES: ReadonlySet<string> = new Set([
  'armchair', 'sofa', 'bed', 'nightstand', 'wardrobe', 'dresser', 'bookshelf', 'cabinet', 'fridge', 'stove',
  'dishwasher', 'kitchen-sink', 'counter', 'toilet', 'bathtub', 'shower', 'bathroom-sink', 'tv', 'plant',
  'flowerpot', 'lamp', 'floor-lamp', 'stairs',
]);

/** Carried on legs: a weaker, wider patch than something sitting on the floor. */
const RAISED_TYPES: ReadonlySet<string> = new Set([
  'table', 'dining-table', 'coffee-table', 'side-table', 'desk', 'chair', 'dining-chair', 'bench',
]);

/** How far a doorway's clearing reaches either side of its wall. */
const DOOR_REACH = 0.3;

export function contactBlob(item: FurnitureItem): ContactBlob | null {
  if (!item.position) return null;
  const raised = RAISED_TYPES.has(item.type);
  if (!raised && !SOLID_TYPES.has(item.type)) return null;
  return {
    id: item.id,
    x: item.position.x,
    z: item.position.z,
    width: item.width,
    depth: item.depth,
    rotation: item.rotation ?? 0,
    raised,
  };
}

/** The storey's contact plan. Everything it reads is in it, so its JSON is the rebuild key. */
export function planContactShadow(building: KeepOutBuilding, storey: number): ContactPlan | null {
  const floor = building.floors[storey];
  if (!floor) return null;
  // A shell wall the user took down casts nothing.
  const shell: ContactLine[] = shellWalls(building)
    .filter((wall) => !floor.hiddenWalls?.includes(wall.side))
    .map(({ x1, z1, x2, z2 }) => ({ x1, z1, x2, z2 }));
  const partitions: ContactLine[] = (floor.interiorWalls ?? []).map(({ x1, z1, x2, z2 }) => ({ x1, z1, x2, z2 }));
  const holes = floorKeepOut(building, storey).map((rect): ContactClearing => ({
    x: (rect.x0 + rect.x1) / 2,
    z: (rect.z0 + rect.z1) / 2,
    width: rect.x1 - rect.x0,
    depth: rect.z1 - rect.z0,
    rotation: rect.rotation ?? 0,
  }));
  const doors = floor.items.flatMap((item): ContactClearing[] =>
    item.type === 'door' && item.position
      ? [{ x: item.position.x, z: item.position.z, width: item.width, depth: item.depth + DOOR_REACH * 2, rotation: item.rotation ?? 0 }]
      : []
  );
  return {
    storey,
    floorY: floorElevation(building.floors, storey),
    width: building.width,
    depth: building.height,
    walls: [...shell, ...partitions],
    doors,
    blobs: floor.items.flatMap((item) => contactBlob(item) ?? []),
    holes,
  };
}

/** The four corners of a rectangle turned like a mesh about +Y, as [x, z] pairs. */
export function rectCorners({ x, z, width, depth, rotation }: ContactClearing): Array<[number, number]> {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const dx = (sx! * width) / 2;
    const dz = (sz! * depth) / 2;
    return [x + dx * cos + dz * sin, z - dx * sin + dz * cos];
  });
}
