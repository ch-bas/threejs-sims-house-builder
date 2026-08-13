import type { FloorLayout, FurnitureItem, InteriorWall, WallId } from '../lib/types';

/** A rectangular hole in a floor plane (e.g. where stairs connect floors). */
export interface FloorOpening {
  id: string;
  /** Centre X in room-local coords. */
  centerX: number;
  /** Centre Z in room-local coords. */
  centerZ: number;
  /**
   * Width of the opening along the opening's own local X axis (before
   * `rotation`). This is the stairs' true footprint width, not an
   * axis-aligned bounding box.
   */
  width: number;
  /** Depth of the opening along the opening's own local Z axis (before `rotation`). */
  depth: number;
  /**
   * Rotation of the opening about its centre (radians, Y axis), matching the
   * stairs' rotation. The floor builder cuts a rotated rectangle so a 45°
   * staircase doesn't leave triangular floor gaps at the corners of an
   * inflated axis-aligned hole.
   */
  rotation: number;
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
    // Cut a hole matching the stairs' true (rotated) footprint plus a small
    // clearance margin, and carry the rotation so the floor builder can cut a
    // rotated rectangle. Previously the hole was the axis-aligned bounding box
    // of the rotated footprint, which over-cuts at non-90° angles (e.g. a 45°
    // 1.2×2.4 staircase produced a 2.65×2.65 hole) yet still left floor gaps at
    // the footprint corners.
    openings.push({
      id: item.id,
      centerX: item.position.x,
      centerZ: item.position.z,
      width: item.width + 0.1,
      depth: item.depth + 0.1,
      rotation: item.rotation ?? 0,
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
/** Interior walls are thinner; a door only counts as "on" one if it's very near. */
const INTERIOR_NEARNESS_THRESHOLD = 0.4;

/**
 * Which wall an opening (door/window) belongs to. An opening is assigned to
 * EXACTLY ONE wall — the nearest by true distance across all exterior and
 * interior candidates — so a door near a junction is cut only once.
 */
export type OpeningOwner =
  | { kind: 'exterior'; wall: WallId }
  | { kind: 'interior'; wallId: string };

interface WallCandidate {
  owner: OpeningOwner;
  /** Segment endpoints in room-local coords. */
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Max perpendicular distance for this opening to count as "on" the wall. */
  threshold: number;
}

function exteriorCandidates(roomWidth: number, roomDepth: number): WallCandidate[] {
  const hw = roomWidth / 2;
  const hd = roomDepth / 2;
  return [
    { owner: { kind: 'exterior', wall: 'north' }, x1: -hw, z1: -hd, x2: hw, z2: -hd, threshold: NEARNESS_THRESHOLD },
    { owner: { kind: 'exterior', wall: 'south' }, x1: -hw, z1: hd, x2: hw, z2: hd, threshold: NEARNESS_THRESHOLD },
    { owner: { kind: 'exterior', wall: 'west' }, x1: -hw, z1: -hd, x2: -hw, z2: hd, threshold: NEARNESS_THRESHOLD },
    { owner: { kind: 'exterior', wall: 'east' }, x1: hw, z1: -hd, x2: hw, z2: hd, threshold: NEARNESS_THRESHOLD },
  ];
}

/** Perpendicular distance from a point to a finite segment. */
function distanceToSegment(px: number, pz: number, c: WallCandidate): number {
  const vx = c.x2 - c.x1;
  const vz = c.z2 - c.z1;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 1e-9) return Math.hypot(px - c.x1, pz - c.z1);
  let t = ((px - c.x1) * vx + (pz - c.z1) * vz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = c.x1 + t * vx;
  const projZ = c.z1 + t * vz;
  return Math.hypot(px - projX, pz - projZ);
}

/**
 * Classify every door/window to exactly one wall (the nearest candidate within
 * that candidate's threshold). Returns a map from item id to its owning wall;
 * items with no wall in range are omitted.
 */
export function classifyOpeningOwners(
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  interiorWalls: readonly InteriorWall[] = []
): Map<string, OpeningOwner> {
  const candidates: WallCandidate[] = [
    ...exteriorCandidates(roomWidth, roomDepth),
    ...interiorWalls.map<WallCandidate>((w) => ({
      owner: { kind: 'interior', wallId: w.id },
      x1: w.x1,
      z1: w.z1,
      x2: w.x2,
      z2: w.z2,
      threshold: INTERIOR_NEARNESS_THRESHOLD,
    })),
  ];

  const owners = new Map<string, OpeningOwner>();
  for (const item of items) {
    if (item.type !== 'door' && item.type !== 'window') continue;
    if (!item.position) continue;

    let best: { owner: OpeningOwner; distance: number } | null = null;
    for (const c of candidates) {
      const distance = distanceToSegment(item.position.x, item.position.z, c);
      if (distance > c.threshold) continue;
      if (!best || distance < best.distance) best = { owner: c.owner, distance };
    }
    if (best) owners.set(item.id, best.owner);
  }
  return owners;
}

/**
 * Merge overlapping/touching axis-aligned hole rectangles so no two holes on a
 * wall overlap — overlapping holes are illegal for earcut and produce phantom
 * fill or self-intersecting triangles. Rectangles are `[x0, y0, x1, y1]`.
 * Returns a disjoint set covering the same area (rectangle union via a sweep
 * that unions any pair whose AABBs intersect, iterated to a fixed point).
 */
export function mergeHoleRects(
  rects: ReadonlyArray<readonly [number, number, number, number]>
): Array<[number, number, number, number]> {
  const merged: Array<[number, number, number, number]> = rects.map(
    (r) => [r[0], r[1], r[2], r[3]] as [number, number, number, number]
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i]!;
        const b = merged[j]!;
        // AABB overlap test (touching edges count as overlapping so adjacent
        // holes fuse into one clean rectangle instead of leaving a zero-width
        // sliver of wall that earcut can choke on).
        const overlap = a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
        if (!overlap) continue;
        // Union into the bounding rectangle. For like-height openings on a wall
        // (equal y0/y1) this is an exact interval union; otherwise the bounding
        // box slightly over-cuts, which is safe (no phantom fill) and rare.
        a[0] = Math.min(a[0], b[0]);
        a[1] = Math.min(a[1], b[1]);
        a[2] = Math.max(a[2], b[2]);
        a[3] = Math.max(a[3], b[3]);
        merged.splice(j, 1);
        changed = true;
        j--;
      }
    }
  }
  return merged;
}

/**
 * For each wall (N/S/E/W), collect the cutouts contributed by `door` and
 * `window` items that sit close enough to that wall's plane. The cutout
 * coordinates are in wall-local space (origin at the wall's centre).
 *
 * Each opening is assigned to exactly one wall (see {@link classifyOpeningOwners});
 * an interior wall may claim an opening, in which case no exterior wall cuts it.
 * Pass the floor's `interiorWalls` so the classifier can consider them.
 *
 * Returns a `Map<WallId, WallOpening[]>` where missing keys mean "no
 * cutouts on this wall". Callers should use {@link openingsForWall} to
 * read safely.
 */
export function computeWallOpenings(
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  wallHeight = 3,
  interiorWalls: readonly InteriorWall[] = []
): Map<WallId, WallOpening[]> {
  const result = new Map<WallId, WallOpening[]>();
  const owners = classifyOpeningOwners(items, roomWidth, roomDepth, interiorWalls);

  for (const item of items) {
    const classification = classifyOpening(item);
    if (!classification) continue;
    if (!item.position) continue;

    const owner = owners.get(item.id);
    // Only cut this opening if the classifier assigned it to an EXTERIOR wall;
    // interior-owned openings are cut by interior-walls.ts instead.
    if (!owner || owner.kind !== 'exterior') continue;
    const wall = owner.wall;

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

function buildOpening(
  item: FurnitureItem,
  classification: OpeningClassification,
  wall: WallId,
  roomWidth: number,
  roomDepth: number,
  wallHeight: number
): WallOpening | null {
  const centerAlongWall = projectAlongWall(item.position!, wall);
  const wallLength = wall === 'north' || wall === 'south' ? roomWidth : roomDepth;
  const halfWallLength = wallLength / 2;

  // Clamp the width to the wall segment first (an oversized/resized opening must
  // not extend past the wall outline), then clamp the centre using the CLAMPED
  // half-width so the hole always stays fully inside the wall.
  const width = Math.min(item.width, Math.max(0, wallLength - 0.05));
  const half = width / 2;
  const clampedCenter = Math.max(-halfWallLength + half, Math.min(halfWallLength - half, centerAlongWall));

  const bottomFromFloor = classification.groundLevel
    ? 0
    : Math.max(0, Math.min(wallHeight - item.height, 1.0));

  return {
    id: item.id,
    centerAlongWall: clampedCenter,
    bottomFromFloor,
    width,
    height: Math.min(item.height, wallHeight - bottomFromFloor - 0.05),
  };
}

function projectAlongWall(position: { x: number; z: number }, wall: WallId): number {
  // centerAlongWall is measured in each wall's LOCAL frame (origin at the
  // wall's midpoint, along its local +X). The south and west walls are
  // rotated relative to world space, so world coords must be flipped to land
  // the cutout under the slab.
  switch (wall) {
    case 'north':
      // North wall: local +X aligns with world +X.
      return position.x;
    case 'south':
      // South wall is rotateY π (local +X → world −X), so flip.
      return -position.x;
    case 'east':
      // East wall: local +X aligns with world +Z.
      return position.z;
    case 'west':
      // West wall is rotateY π/2 (local +X → world −Z), so flip.
      return -position.z;
  }
}
