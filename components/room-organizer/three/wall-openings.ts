import { alongSide, shellWalls, shellWallSpan, type ShellWall, type ShellWallId } from '../lib/footprint';
import { fitOpeningToStorey } from '../lib/storeys';
import type { FootprintCutout, FurnitureItem, InteriorWall, WallId } from '../lib/types';

/**
 * Stairwell openings are pure maths and live in lib/stairs.ts, where the 2D
 * plan and the exporters share them with the floor builder (#290);
 * re-exported so scene code keeps importing them from here.
 */
export { computeFloorOpenings, type FloorOpening } from '../lib/stairs';

export interface WallOpening {
  /** Item id that this opening originates from (for cleanup / debugging). */
  id: string;
  /**
   * Centre position along the wall, in metres, in the frame of the side it is
   * on: from the middle of that side of the house, which is the wall's own
   * mid-point unless a cut-out shortened it (#727).
   */
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
  | { kind: 'exterior'; wall: ShellWallId }
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

function exteriorCandidates(roomWidth: number, roomDepth: number, cutout: FootprintCutout | undefined): WallCandidate[] {
  return shellWalls({ width: roomWidth, height: roomDepth, cutout }).map(({ id, x1, z1, x2, z2 }) => ({
    owner: { kind: 'exterior', wall: id },
    x1,
    z1,
    x2,
    z2,
    threshold: NEARNESS_THRESHOLD,
  }));
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
  interiorWalls: readonly InteriorWall[] = [],
  cutout?: FootprintCutout
): Map<string, OpeningOwner> {
  const candidates: WallCandidate[] = [
    ...exteriorCandidates(roomWidth, roomDepth, cutout),
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
 * Returns a `Map<ShellWallId, WallOpening[]>` where missing keys mean "no
 * cutouts on this wall". Callers should use {@link openingsForWall} to
 * read safely.
 */
export function computeWallOpenings(
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  wallHeight = 3,
  interiorWalls: readonly InteriorWall[] = [],
  cutout?: FootprintCutout
): Map<ShellWallId, WallOpening[]> {
  const result = new Map<ShellWallId, WallOpening[]>();
  const owners = classifyOpeningOwners(items, roomWidth, roomDepth, interiorWalls, cutout);
  const walls = shellWalls({ width: roomWidth, height: roomDepth, cutout });

  for (const item of items) {
    const classification = classifyOpening(item);
    if (!classification) continue;
    if (!item.position) continue;

    const owner = owners.get(item.id);
    // Only cut this opening if the classifier assigned it to an EXTERIOR wall;
    // interior-owned openings are cut by interior-walls.ts instead.
    if (!owner || owner.kind !== 'exterior') continue;
    const wall = walls.find((candidate) => candidate.id === owner.wall);
    if (!wall) continue;

    const opening = buildOpening(item, classification, wall, wallHeight);
    if (!opening) continue;

    const list = result.get(wall.id) ?? [];
    list.push(opening);
    result.set(wall.id, list);
  }

  return result;
}

export function openingsForWall(map: ReadonlyMap<ShellWallId, WallOpening[]>, wall: ShellWallId): readonly WallOpening[] {
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
  wall: ShellWall,
  wallHeight: number
): WallOpening | null {
  // centerAlongWall is measured in the side's frame, along the wall mesh's
  // local +X. The south and west walls are rotated relative to world space,
  // so world coords must be flipped to land the cutout under the slab.
  const centerAlongWall = alongSide(wall.side, item.position!.x, item.position!.z);
  const { from, to, length: wallLength } = shellWallSpan(wall);

  // Clamp the width to the wall segment first (an oversized/resized opening must
  // not extend past the wall outline), then clamp the centre using the CLAMPED
  // half-width so the hole always stays fully inside the wall.
  const width = Math.min(item.width, Math.max(0, wallLength - 0.05));
  const half = width / 2;
  const clampedCenter = Math.max(from + half, Math.min(to - half, centerAlongWall));

  // Windows open at their sill — the window's own `sillHeight` or the shared
  // datum — and anything too tall for the storey is fitted to it, through the
  // same helper the door and window meshes are built around, so hole and
  // frame stay flush on every storey height (#212, #204, #277).
  const fitted = fitOpeningToStorey(item, wallHeight);

  return {
    id: item.id,
    centerAlongWall: clampedCenter,
    bottomFromFloor: classification.groundLevel ? 0 : fitted.sill,
    width,
    height: fitted.height,
  };
}
