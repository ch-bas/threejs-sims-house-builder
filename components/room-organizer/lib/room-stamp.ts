import { clipWallToCutout } from './cutout';
import { clampToFootprint, cutoutRect, footprintOutline } from './footprint';
import { generateRoomShape, type RoomShapeId } from './room-shapes';
import { MAX_INTERIOR_WALLS_PER_FLOOR } from './schema';
import { clipWallToPorch, ENTRANCE_WALL_ID, type EntrancePlanOutline } from './street';
import { footprintEdges, wallsOverlap, type WallPatch } from './wall-edit';
import { MIN_WALL_LENGTH, snapWallEndpoint, WALL_GRID } from './wall-snap';
import type { FootprintCutout, InteriorWall, Vec2 } from './types';

/**
 * The room stamp as a held placement (#724): where a stamp lands under the
 * pointer, the size a drag gives it, and the walls it adds. Pure, so the ghost
 * in both views shows exactly what a drop builds.
 */

export interface RoomStampSpec {
  shape: RoomShapeId;
  width: number;
  depth: number;
}

export interface StampPlacement {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
}

export interface StampContext {
  existingWalls: readonly InteriorWall[];
  roomWidth: number;
  roomDepth: number;
  porch: EntrancePlanOutline | null;
  /** The corner cut out of the building (#727): its walls catch a stamp, and no room crosses it. */
  cutout?: FootprintCutout | undefined;
  /** Outside walls the player hid on this storey: they close no room. */
  hiddenWalls?: readonly string[] | undefined;
}

/** The smallest room, as on the panel's sliders. */
export const MIN_STAMP_SIZE = 1.5;
/** A stamp's edge lands on a wall corner's line or the shell from this near. */
const STAMP_CATCH = 0.3;
/** A press that travels this far sizes the room; less is a click. */
export const STAMP_DRAG_MIN = 0.3;
const COLLINEAR_GAP = 0.02;

/** Six places: 2.5 - 2.2 is 0.30000000000000004, and this goes into the save. */
const tidy = (value: number): number => Math.round(value * 1e6) / 1e6;

/** One axis of `snapStampCentre`: the centre with an edge on a line near it, or on the grid. */
function settleAxis(centre: number, size: number, half: number, lines: readonly number[]): number {
  let best = Math.round((centre - size / 2) / WALL_GRID) / 10 + size / 2;
  let bestDistance = STAMP_CATCH;
  for (const line of lines) {
    for (const edge of [-size / 2, size / 2]) {
      const distance = Math.abs(line - (centre + edge));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = line - edge;
      }
    }
  }
  return tidy(Math.max(-half + size / 2, Math.min(half - size / 2, best)));
}

/** Where a stamp of this size sits under the pointer: edges caught by walls and the shell. */
export function snapStampCentre(point: Vec2, width: number, depth: number, context: StampContext): Vec2 {
  const { cutout, roomWidth, roomDepth } = context;
  const walls = context.existingWalls.flatMap((wall) => [{ x: wall.x1, z: wall.z1 }, { x: wall.x2, z: wall.z2 }]);
  const corners = [...walls, ...footprintOutline({ width: roomWidth, height: roomDepth, cutout })];
  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;
  const settled = {
    x: settleAxis(point.x, width, halfW, [-halfW, halfW, ...corners.map((corner) => corner.x)]),
    z: settleAxis(point.z, depth, halfD, [-halfD, halfD, ...corners.map((corner) => corner.z)]),
  };
  if (!cutout) return settled;
  // Out of the corner the shorter way. Too big for either wing, it stays and the plan refuses it.
  const { x, z } = clampToFootprint({ width, depth }, settled, roomWidth, roomDepth, cutout);
  return { x: tidy(x), z: tidy(z) };
}

/** A room dragged from corner to corner, each corner snapped as a wall end would be. */
function stampFromCorners(press: Vec2, tip: Vec2, context: StampContext): StampPlacement {
  const snap = (point: Vec2): Vec2 =>
    snapWallEndpoint({ point, existingWalls: context.existingWalls, roomWidth: context.roomWidth, roomDepth: context.roomDepth, cutout: context.cutout }).point;
  const a = snap(press);
  const b = snap(tip);
  const span = (from: number, to: number, half: number): { size: number; centre: number } => {
    const size = Math.max(MIN_STAMP_SIZE, Math.abs(to - from));
    const centre = from + (Math.sign(to - from) || 1) * (size / 2);
    return { size: tidy(size), centre: tidy(Math.max(-half + size / 2, Math.min(half - size / 2, centre))) };
  };
  const x = span(a.x, b.x, context.roomWidth / 2);
  const z = span(a.z, b.z, context.roomDepth / 2);
  return { centerX: x.centre, centerZ: z.centre, width: x.size, depth: z.size };
}

/** Where the stamp is now: under `tip`, or sized by a drag from `press`. */
export function stampPlacement(spec: RoomStampSpec, press: Vec2 | null, tip: Vec2, context: StampContext): StampPlacement {
  if (press && Math.hypot(tip.x - press.x, tip.z - press.z) >= STAMP_DRAG_MIN) return stampFromCorners(press, tip, context);
  const centre = snapStampCentre(press ?? tip, spec.width, spec.depth, context);
  return { centerX: centre.x, centerZ: centre.z, width: spec.width, depth: spec.depth };
}

/** What is left of `wall` off the walls it runs along. Coplanar, they z-fight (#276). */
function uncoveredRuns(wall: InteriorWall, covers: readonly WallPatch[]): InteriorWall[] {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  if (length < 1e-9) return [];
  const dx = (wall.x2 - wall.x1) / length;
  const dz = (wall.z2 - wall.z1) / length;
  const along = (x: number, z: number): number => (x - wall.x1) * dx + (z - wall.z1) * dz;
  const spans = covers
    .filter((cover) => {
      const across = (x: number, z: number): number => Math.abs(-(x - wall.x1) * dz + (z - wall.z1) * dx);
      return across(cover.x1, cover.z1) <= COLLINEAR_GAP && across(cover.x2, cover.z2) <= COLLINEAR_GAP && wallsOverlap(wall, cover);
    })
    .map((cover) => {
      const from = along(cover.x1, cover.z1);
      const to = along(cover.x2, cover.z2);
      return [Math.min(from, to), Math.max(from, to)] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  const runs: Array<[number, number]> = [];
  let at = 0;
  for (const [from, to] of spans) {
    if (from > at) runs.push([at, Math.min(from, length)]);
    at = Math.max(at, to);
  }
  if (at < length) runs.push([at, length]);
  // A run too short to stand reaches back over the cover beside it, or a
  // sliver of the outline would stay open. Stretched runs that meet are one.
  const kept: Array<[number, number]> = [];
  for (const [from, to] of runs) {
    if (to - from < 1e-3) continue;
    const short = to - from < MIN_WALL_LENGTH;
    const start = short && to >= length - 1e-9 ? Math.max(0, to - MIN_WALL_LENGTH) : from;
    const end = short && start === from ? Math.min(length, from + MIN_WALL_LENGTH) : to;
    const last = kept[kept.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else kept.push([start, end]);
  }
  if (kept.length === 1 && kept[0]![0] === 0 && kept[0]![1] === length) return [wall];
  return kept.map(([from, to], index) => ({
    ...wall,
    id: index === 0 ? wall.id : `${wall.id}-${index + 1}`,
    x1: wall.x1 + dx * from,
    z1: wall.z1 + dz * from,
    x2: wall.x1 + dx * to,
    z2: wall.z1 + dz * to,
  }));
}

export interface StampPlan {
  placement: StampPlacement;
  walls: InteriorWall[];
  /** Why a drop here adds nothing. */
  refusal: string | null;
}

/** The walls a drop adds: the outline, less the stretches a wall or the shell already stands on. */
export function planRoomStamp(spec: RoomStampSpec, placement: StampPlacement, context: StampContext, seed: string): StampPlan {
  const { centerX, centerZ, width, depth } = placement;
  const { existingWalls, roomWidth, roomDepth, porch, cutout } = context;
  const lot = { width: roomWidth, depth: roomDepth };
  const shell = footprintEdges(roomWidth, roomDepth, cutout).filter((edge) => !context.hiddenWalls?.includes(edge.side));
  const notch = cutoutRect({ width: roomWidth, height: roomDepth, cutout });
  const covers = [...existingWalls, ...shell];
  const walls = generateRoomShape(spec.shape, centerX, centerZ, width, depth, seed, undefined, lot).flatMap((wall) => uncoveredRuns(wall, covers));
  const own = existingWalls.filter((wall) => wall.id !== ENTRANCE_WALL_ID).length;
  let refusal: string | null = null;
  if (walls.length === 0) refusal = 'Those walls are already there.';
  else if (porch && walls.some((wall) => clipWallToPorch(wall, porch)[0] !== wall)) refusal = "A room can't cross the porch: it's outside the house.";
  else if (walls.some((wall) => clipWallToCutout(wall, notch)[0] !== wall)) refusal = "A room can't cross the corner: it's outside the house.";
  else if (own + walls.length > MAX_INTERIOR_WALLS_PER_FLOOR - 1) refusal = 'This floor has as many walls as it can hold.';
  return { placement, walls, refusal };
}
