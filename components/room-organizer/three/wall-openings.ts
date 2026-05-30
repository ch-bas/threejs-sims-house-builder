import type { FloorLayout, FurnitureItem, WallId } from '../lib/types';

/** A rectangular hole in a floor plane (e.g. where stairs connect floors). */
export interface FloorOpening {
  id: string;
  /** Centre X in room-local coords. */
  centerX: number;
  /** Centre Z in room-local coords. */
  centerZ: number;
  /** Width of the opening (along X). */
  width: number;
  /** Depth of the opening (along Z). */
  depth: number;
}

/**
 * Compute stairwell openings for a given floor by looking at stairs placed
 * on the floor below. If floor N has stairs at position (x, z), floor N+1
 * should have a rectangular hole at that position.
 */
export function computeFloorOpenings(
  floorBelow: FloorLayout | undefined
): readonly FloorOpening[] {
  if (!floorBelow) return [];
  const openings: FloorOpening[] = [];
  for (const item of floorBelow.items) {
    if (item.type !== 'stairs' || !item.position) continue;
    // When rotated 90° or 270° the width and depth swap in world space.
    const rotation = item.rotation ?? 0;
    const sin = Math.abs(Math.sin(rotation));
    const cos = Math.abs(Math.cos(rotation));
    const worldWidth = item.width * cos + item.depth * sin;
    const worldDepth = item.width * sin + item.depth * cos;
    openings.push({
      id: item.id,
      centerX: item.position.x,
      centerZ: item.position.z,
      width: worldWidth + 0.1,
      depth: worldDepth + 0.1,
    });
  }
  return openings;
}

export interface WallOpening {
  /** Item id that this opening originates from (for cleanup / debugging). */
  id: string;
  /** Centre position along the wall, in metres from the wall's mid-point. */
  centerAlongWall: number;
  /** Distance from the floor to the bottom of the opening, in metres. */
  bottomFromFloor: number;
  /** Width of the opening along the wall, in metres. */
  width: number;
  /** Height of the opening, in metres. */
  height: number;
}

export interface OpeningClassification {
  wall: WallId;
  /** True when the item should sit on the floor (doors). */
  groundLevel: boolean;
}

const NEARNESS_THRESHOLD = 0.6;

/**
 * For each wall (N/S/E/W), collect the cutouts contributed by `door` and
 * `window` items that sit close enough to that wall's plane. The cutout
 * coordinates are in wall-local space (origin at the wall's centre).
 *
 * Returns a `Map<WallId, WallOpening[]>` where missing keys mean "no
 * cutouts on this wall". Callers should use {@link openingsForWall} to
 * read safely.
 */
export function computeWallOpenings(
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  wallHeight = 3
): Map<WallId, WallOpening[]> {
  const result = new Map<WallId, WallOpening[]>();

  for (const item of items) {
    const classification = classifyOpening(item);
    if (!classification) continue;
    if (!item.position) continue;

    const wall = closestWall(item.position, roomWidth, roomDepth);
    if (wall === null) continue;

    const distance = distanceToWall(item.position, wall, roomWidth, roomDepth);
    if (distance > NEARNESS_THRESHOLD) continue;

    const opening = buildOpening(item, classification, wall, roomWidth, roomDepth, wallHeight);
    if (!opening) continue;

    const list = result.get(wall) ?? [];
    list.push(opening);
    result.set(wall, list);
  }

  return result;
}

export function openingsForWall(map: ReadonlyMap<WallId, WallOpening[]>, wall: WallId): readonly WallOpening[] {
  return map.get(wall) ?? [];
}

function classifyOpening(item: FurnitureItem): OpeningClassification | null {
  if (item.type === 'door') return { wall: 'north', groundLevel: true };
  if (item.type === 'window') return { wall: 'north', groundLevel: false };
  return null;
}

function closestWall(position: { x: number; z: number }, roomWidth: number, roomDepth: number): WallId | null {
  const distances: Array<{ wall: WallId; distance: number }> = [
    { wall: 'north', distance: Math.abs(position.z - -roomDepth / 2) },
    { wall: 'south', distance: Math.abs(position.z - roomDepth / 2) },
    { wall: 'west', distance: Math.abs(position.x - -roomWidth / 2) },
    { wall: 'east', distance: Math.abs(position.x - roomWidth / 2) },
  ];
  distances.sort((a, b) => a.distance - b.distance);
  const closest = distances[0];
  if (!closest || closest.distance > NEARNESS_THRESHOLD) return null;
  return closest.wall;
}

function distanceToWall(
  position: { x: number; z: number },
  wall: WallId,
  roomWidth: number,
  roomDepth: number
): number {
  switch (wall) {
    case 'north':
      return Math.abs(position.z - -roomDepth / 2);
    case 'south':
      return Math.abs(position.z - roomDepth / 2);
    case 'west':
      return Math.abs(position.x - -roomWidth / 2);
    case 'east':
      return Math.abs(position.x - roomWidth / 2);
  }
}

function buildOpening(
  item: FurnitureItem,
  classification: OpeningClassification,
  wall: WallId,
  roomWidth: number,
  roomDepth: number,
  wallHeight: number
): WallOpening | null {
  const centerAlongWall = projectAlongWall(item.position!, wall);
  const halfWallLength = (wall === 'north' || wall === 'south' ? roomWidth : roomDepth) / 2;

  // Clamp to keep the opening fully inside the wall so we never punch through
  // a corner.
  const half = item.width / 2;
  const clampedCenter = Math.max(-halfWallLength + half, Math.min(halfWallLength - half, centerAlongWall));

  const bottomFromFloor = classification.groundLevel
    ? 0
    : Math.max(0, Math.min(wallHeight - item.height, 1.0));

  return {
    id: item.id,
    centerAlongWall: clampedCenter,
    bottomFromFloor,
    width: Math.min(item.width, halfWallLength * 2 - 0.05),
    height: Math.min(item.height, wallHeight - bottomFromFloor - 0.05),
  };
}

function projectAlongWall(position: { x: number; z: number }, wall: WallId): number {
  switch (wall) {
    case 'north':
    case 'south':
      return position.x;
    case 'east':
    case 'west':
      // East/west walls run along Z; the inside view's "right" is +z for
      // the west wall and -z for the east wall, but for centre alignment
      // we don't care about flip — the cutout is symmetric.
      return position.z;
  }
}
