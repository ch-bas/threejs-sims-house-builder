import { clipWallToCutout } from './cutout';
import { cutoutRect, shellWalls } from './footprint';
import { isCeilingHung, isWallHung } from './mount-band';
import { INTERIOR_WALL_THICKNESS, isOpening, isWallMounted, projectOntoSegment, settleWallMountedItem, snapOpeningToWall } from './opening-snap';
import { clipWallToPorch, ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID, type EntrancePlanOutline } from './street';
import { MIN_WALL_LENGTH, reachInLot, snapWallEndpoint, WALL_GRID } from './wall-snap';
import type { FloorLayout, FootprintCutout, FurnitureItem, InteriorWall, Vec2, WallId } from './types';

/**
 * Moving interior walls after they are drawn (#718). Pure: the plan and the 3D
 * view preview through `dragWalls` and `planWallMove`, and the reducer commits
 * through `planWallMove`, so what a gesture shows is what it lands.
 */

/** Which part of a selected wall a press took hold of: its body slides, an end moves. */
export type WallGrip = 'body' | 'start' | 'end';

export interface WallPatch {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface WallGrab {
  wallId: string;
  grip: WallGrip;
  /** The floor point under the press. */
  at: Vec2;
  /** The floor's walls at the press. */
  walls: readonly InteriorWall[];
}

export interface WallDragContext {
  roomWidth: number;
  roomDepth: number;
  /** The corner cut out of the building (#727). */
  cutout?: FootprintCutout | undefined;
  /** Shift: no grid and no angle steps. */
  free?: boolean;
}

/** Two wall ends this close are one corner. */
const SAME_POINT = 0.005;
/** A wall end this close to another wall's body is a T-junction. */
const ON_BODY = 0.02;
/** A slide lands on the line of another wall's corner from this near. */
const SLIDE_CATCH = 0.15;
/** Parallel walls this close, overlapping this much, are one wall drawn twice. */
const COLLINEAR_GAP = 0.02;
const MIN_OVERLAP = 0.05;
/** Past its depth and the wall's half, how far a hung item may sit and still be on the wall. */
const HUNG_SLOP = 0.1;

const startOf = (wall: WallPatch): Vec2 => ({ x: wall.x1, z: wall.z1 });
const endOf = (wall: WallPatch): Vec2 => ({ x: wall.x2, z: wall.z2 });
const samePoint = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.z - b.z) <= SAME_POINT;
const lengthOf = (wall: WallPatch): number => Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);

/** The parameter of `point` along the wall's body, or null off it. Ends excluded. */
function alongBody(point: Vec2, wall: WallPatch): number | null {
  const length = lengthOf(wall);
  if (length < 1e-9) return null;
  const dx = (wall.x2 - wall.x1) / length;
  const dz = (wall.z2 - wall.z1) / length;
  const along = (point.x - wall.x1) * dx + (point.z - wall.z1) * dz;
  const across = -(point.x - wall.x1) * dz + (point.z - wall.z1) * dx;
  if (Math.abs(across) > ON_BODY || along <= SAME_POINT || along >= length - SAME_POINT) return null;
  return along / length;
}

const lerp = (wall: WallPatch, t: number): Vec2 => ({
  x: wall.x1 + (wall.x2 - wall.x1) * t,
  z: wall.z1 + (wall.z2 - wall.z1) * t,
});

/**
 * `id` with new ends, and what follows it so that no corner opens: walls that
 * share a moved end move with it, and a wall ending on the body of a wall that
 * left its line keeps its place along that wall, however far that carries on
 * down a chain of T-junctions. The porch's back wall stays: it belongs to the
 * entrance.
 */
function moveEnds(walls: readonly InteriorWall[], id: string, start: Vec2, end: Vec2): InteriorWall[] {
  const moved = walls.find((wall) => wall.id === id);
  if (!moved) return [...walls];
  const moves: Array<{ from: Vec2; to: Vec2 }> = [
    { from: startOf(moved), to: start },
    { from: endOf(moved), to: end },
  ];
  const follow = (point: Vec2): Vec2 => moves.find(({ from }) => samePoint(from, point))?.to ?? point;
  const apply = (): InteriorWall[] =>
    walls.map((wall) => {
      if (wall.id === id) return { ...wall, x1: start.x, z1: start.z, x2: end.x, z2: end.z };
      if (wall.id === ENTRANCE_WALL_ID) return wall;
      const a = follow(startOf(wall));
      const b = follow(endOf(wall));
      if (a.x === wall.x1 && a.z === wall.z1 && b.x === wall.x2 && b.z === wall.z2) return wall;
      return { ...wall, x1: a.x, z1: a.z, x2: b.x, z2: b.z };
    });
  // One pass per wall at the most: each pass carries the follow one wall on.
  let current = apply();
  for (let pass = 0; pass < walls.length; pass++) {
    let grew = false;
    const changed = walls.flatMap((wall, index) => (current[index] === wall ? [] : [{ before: wall, after: current[index]! }]));
    for (const wall of walls) {
      if (wall.id === id || wall.id === ENTRANCE_WALL_ID) continue;
      for (const point of [startOf(wall), endOf(wall)]) {
        if (moves.some(({ from }) => samePoint(from, point))) continue;
        for (const { before, after } of changed) {
          if (before.id === wall.id) continue;
          const t = alongBody(point, before);
          // A T-junction on a wall that only grew stays where it is.
          if (t === null || alongBody(point, after) !== null) continue;
          moves.push({ from: point, to: lerp(after, t) });
          grew = true;
          break;
        }
      }
    }
    if (!grew) break;
    current = apply();
  }
  return current;
}

/** Where the line through `point` along `direction` crosses `host`'s body; null off it, or parallel. */
function crossBody(point: Vec2, direction: Vec2, host: WallPatch): Vec2 | null {
  const dx = host.x2 - host.x1;
  const dz = host.z2 - host.z1;
  const cross = direction.x * dz - direction.z * dx;
  if (Math.abs(cross) < 1e-9) return null;
  const t = -((point.x - host.x1) * direction.z - (point.z - host.z1) * direction.x) / cross;
  return t < 0 || t > 1 ? null : lerp(host, t);
}

/** The wall or shell side a wall end rests on, when it ends on a body and not at a corner. */
function hostOf(point: Vec2, hosts: readonly WallPatch[]): WallPatch | null {
  return hosts.find((host) => alongBody(point, host) !== null) ?? null;
}

/**
 * A raw slide of an axis-aligned wall lands on the grid, or on the line of a
 * corner near it, but never on top of a parallel wall it overlaps: that lands
 * nowhere, so it stops a grid step short.
 */
function settleSlide(wall: InteriorWall, others: readonly WallPatch[], normal: Vec2, raw: number, halfW: number, halfD: number): number {
  const axis = Math.abs(normal.x) > 1 - 1e-9 ? 'x' : Math.abs(normal.z) > 1 - 1e-9 ? 'z' : null;
  if (!axis) return Math.round(raw / WALL_GRID) / 10;
  const sign = Math.sign(normal[axis]);
  const line = wall[axis === 'x' ? 'x1' : 'z1'];
  const half = axis === 'x' ? halfW : halfD;
  const target = Math.max(-half, Math.min(half, line + raw * sign));
  const across = axis === 'x' ? 'z' : 'x';
  const span = (entry: WallPatch): [number, number] => {
    const a = startOf(entry)[across];
    const b = endOf(entry)[across];
    return [Math.min(a, b), Math.max(a, b)];
  };
  const [from, to] = span(wall);
  const parallelOver = (other: WallPatch): boolean => {
    if (Math.abs(startOf(other)[axis] - endOf(other)[axis]) > COLLINEAR_GAP) return false;
    const [otherFrom, otherTo] = span(other);
    return Math.min(to, otherTo) - Math.max(from, otherFrom) > MIN_OVERLAP;
  };
  const blocking = others.filter(parallelOver);
  let best = Math.round(target / WALL_GRID) / 10;
  let bestDistance = SLIDE_CATCH;
  for (const other of others) {
    if (blocking.includes(other)) continue;
    for (const corner of [startOf(other), endOf(other)]) {
      const distance = Math.abs(corner[axis] - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = corner[axis];
      }
    }
  }
  const landedOn = blocking.find((other) => Math.abs(startOf(other)[axis] - best) <= WALL_GRID / 2);
  if (landedOn) best = startOf(landedOn)[axis] + (line < best ? -WALL_GRID : WALL_GRID);
  return (best - line) * sign;
}

/** A micrometre is plenty, and 0.1 + 0.2 stays out of the save. */
function tidyPoint(point: Vec2): Vec2 {
  return { x: Math.round(point.x * 1e6) / 1e6, z: Math.round(point.z * 1e6) / 1e6 };
}

/** The floor's walls with a drag of `grab` to `pointer` applied; null where it can't land. */
export function dragWalls(grab: WallGrab, pointer: Vec2, context: WallDragContext): InteriorWall[] | null {
  const wall = grab.walls.find((entry) => entry.id === grab.wallId);
  if (!wall) return null;
  const dx = pointer.x - grab.at.x;
  const dz = pointer.z - grab.at.z;
  const { roomWidth, roomDepth, cutout, free = false } = context;
  const others = grab.walls.filter((entry) => entry.id !== wall.id);
  const start = startOf(wall);
  const end = endOf(wall);
  if (grab.grip === 'body') {
    const length = lengthOf(wall);
    if (length < 1e-9) return null;
    // Rounded so an axis-aligned wall's normal is exact.
    const normal = { x: Math.round((-(wall.z2 - wall.z1) / length) * 1e12) / 1e12, z: Math.round(((wall.x2 - wall.x1) / length) * 1e12) / 1e12 };
    const raw = dx * normal.x + dz * normal.z;
    const shell = footprintEdges(roomWidth, roomDepth, cutout);
    const notch = cutoutRect({ width: roomWidth, height: roomDepth, cutout });
    const halfW = roomWidth / 2;
    const halfD = roomDepth / 2;
    const wanted = free ? raw : settleSlide(wall, [...others, ...shell], normal, raw, halfW, halfD);
    // An end resting on a wall or the shell slides along it; a free end stays in the lot.
    const hosts = [...others, ...shell];
    const startHost = hostOf(start, hosts);
    const endHost = hostOf(end, hosts);
    const unhosted = [...(startHost ? [] : [start]), ...(endHost ? [] : [end])];
    const forward = Math.min(Infinity, ...unhosted.map((point) => reachInLot(point, normal.x, normal.z, halfW, halfD, notch)));
    const backward = Math.min(Infinity, ...unhosted.map((point) => reachInLot(point, -normal.x, -normal.z, halfW, halfD, notch)));
    const distance = Math.max(-backward, Math.min(forward, wanted));
    const shift = (point: Vec2): Vec2 => ({ x: point.x + normal.x * distance, z: point.z + normal.z * distance });
    const direction = { x: wall.x2 - wall.x1, z: wall.z2 - wall.z1 };
    const nextStart = startHost ? crossBody(shift(start), direction, startHost) : shift(start);
    const nextEnd = endHost ? crossBody(shift(end), direction, endHost) : shift(end);
    // Past the end of its host, or parallel to it: the wall holds.
    if (!nextStart || !nextEnd) return null;
    // Both ends come out of their own sums: rounded, a square wall stays square.
    return moveEnds(grab.walls, wall.id, tidyPoint(nextStart), tidyPoint(nextEnd));
  }
  const held = grab.grip === 'start' ? start : end;
  const anchor = grab.grip === 'start' ? end : start;
  // Not its own wall, nor those that move with this end.
  const targets = others.filter((other) => !samePoint(startOf(other), held) && !samePoint(endOf(other), held));
  const { point } = snapWallEndpoint({
    point: { x: held.x + dx, z: held.z + dz },
    existingWalls: targets,
    fromPoint: anchor,
    roomWidth,
    roomDepth,
    cutout,
    free,
  });
  if (Math.hypot(point.x - anchor.x, point.z - anchor.z) < MIN_WALL_LENGTH) return null;
  return grab.grip === 'start' ? moveEnds(grab.walls, wall.id, point, end) : moveEnds(grab.walls, wall.id, start, point);
}

/** What changed between two versions of the floor's walls. */
export function wallPatches(before: readonly InteriorWall[], after: readonly InteriorWall[]): WallPatch[] {
  return after.flatMap((wall) => {
    const old = before.find((entry) => entry.id === wall.id);
    if (!old || (old.x1 === wall.x1 && old.z1 === wall.z1 && old.x2 === wall.x2 && old.z2 === wall.z2)) return [];
    return [{ id: wall.id, x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
  });
}

/** Whether two walls run along one line for more than a touch. Coplanar, they z-fight. */
export function wallsOverlap(a: WallPatch, b: WallPatch): boolean {
  const length = lengthOf(a);
  if (length < 1e-9) return false;
  const dx = (a.x2 - a.x1) / length;
  const dz = (a.z2 - a.z1) / length;
  const across = (point: Vec2): number => Math.abs(-(point.x - a.x1) * dz + (point.z - a.z1) * dx);
  const along = (point: Vec2): number => (point.x - a.x1) * dx + (point.z - a.z1) * dz;
  if (across(startOf(b)) > COLLINEAR_GAP || across(endOf(b)) > COLLINEAR_GAP) return false;
  const from = Math.min(along(startOf(b)), along(endOf(b)));
  const to = Math.max(along(startOf(b)), along(endOf(b)));
  return Math.min(to, length) - Math.max(from, 0) > MIN_OVERLAP;
}

/** An edge of the outline, as a wall; `side` is the side of the house it counts as. */
export interface FootprintEdge extends WallPatch {
  side: WallId;
}

const EDGE_ORDER = ['north', 'east', 'south', 'west', 'notch-x', 'notch-z'];

/** The outline's edges, as walls, running clockwise: the four sides, then the two walls of a cut (#727). */
export function footprintEdges(roomWidth: number, roomDepth: number, cutout?: FootprintCutout | undefined): FootprintEdge[] {
  return shellWalls({ width: roomWidth, height: roomDepth, cutout })
    .sort((a, b) => EDGE_ORDER.indexOf(a.id) - EDGE_ORDER.indexOf(b.id))
    .map(({ id, side, x1, z1, x2, z2 }) =>
      id === 'south' || id === 'west' ? { id, side, x1: x2, z1: z2, x2: x1, z2: z1 } : { id, side, x1, z1, x2, z2 }
    );
}

interface WallMoveContext {
  roomWidth: number;
  roomDepth: number;
  /** The corner cut out of the building (#727): no wall stands in it. */
  cutout?: FootprintCutout | undefined;
  /** The storey's recessed entrance: openings settle around it and no wall crosses it. */
  porch: EntrancePlanOutline | null;
}

/** How far along the wall an item stays: to the end that didn't move, or in proportion. */
function keepAlong(along: number, before: WallPatch, after: WallPatch): number {
  const length = lengthOf(before);
  const nextLength = lengthOf(after);
  if (samePoint(startOf(before), startOf(after))) return along;
  if (samePoint(endOf(before), endOf(after))) return nextLength - (length - along);
  return (along / length) * nextLength;
}

/** An item's way along `after`, and its place there; null when the wall no longer fits it. */
function rideWall(item: FurnitureItem, position: Vec2, before: InteriorWall, after: InteriorWall): { position: Vec2; along: number; from: number } | null {
  const length = lengthOf(before);
  const nextLength = lengthOf(after);
  if (length < 1e-9 || nextLength < item.width) return null;
  const dx = (before.x2 - before.x1) / length;
  const dz = (before.z2 - before.z1) / length;
  const from = (position.x - before.x1) * dx + (position.z - before.z1) * dz;
  const across = -(position.x - before.x1) * dz + (position.z - before.z1) * dx;
  const half = item.width / 2;
  const along = Math.max(half, Math.min(nextLength - half, keepAlong(from, before, after)));
  const on = lerp(after, along / nextLength);
  const nextDx = (after.x2 - after.x1) / nextLength;
  const nextDz = (after.z2 - after.z1) / nextLength;
  return { position: { x: on.x - nextDz * across, z: on.z + nextDx * across }, along, from };
}

/** The interior wall a hung picture or shelf is on: the nearest within reach, unless the shell is nearer. */
function hungOn(item: FurnitureItem, position: Vec2, walls: readonly InteriorWall[], context: WallMoveContext): InteriorWall | null {
  const reach = item.depth / 2 + INTERIOR_WALL_THICKNESS / 2 + HUNG_SLOP;
  let best: InteriorWall | null = null;
  let bestDistance = reach;
  for (const wall of walls) {
    const projected = projectOntoSegment(position, wall, 0);
    if (projected && projected.distance <= bestDistance) {
      best = wall;
      bestDistance = projected.distance;
    }
  }
  const notchWalls = footprintEdges(context.roomWidth, context.roomDepth, context.cutout).slice(4);
  const toNotch = notchWalls.map((wall) => projectOntoSegment(position, wall, 0)?.distance ?? Infinity);
  const toShell = Math.min(context.roomWidth / 2 - Math.abs(position.x), context.roomDepth / 2 - Math.abs(position.z), ...toNotch);
  return toShell < bestDistance ? null : best;
}

/** The interior wall a door, window or camera sits on. */
function seatedOn(item: FurnitureItem, position: Vec2, walls: readonly InteriorWall[], context: WallMoveContext): InteriorWall | null {
  const { roomWidth, roomDepth, porch, cutout } = context;
  const seat = snapOpeningToWall({ position, itemWidth: item.width, roomWidth, roomDepth, interiorWalls: walls, cutout, ...(porch ? { frontGap: porch } : {}) }).interiorWall;
  return (seat && walls.find((wall) => wall.x1 === seat.x1 && wall.z1 === seat.z1 && wall.x2 === seat.x2 && wall.z2 === seat.z2)) ?? null;
}

const wallAngle = (wall: WallPatch): number => Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1);

/**
 * The floor's items with whatever hangs on a moved wall carried along: doors,
 * windows and cameras settle back on it, hung decor keeps its seat. A locked
 * door rides too: a lock pins an item against the player's drags, not against
 * its wall leaving (as with a footprint resize). The door that no longer fits,
 * or two that would come to overlap, name the refusal. A ceiling light has no
 * wall to follow.
 */
function followWalls(
  floor: FloorLayout,
  before: readonly InteriorWall[],
  after: readonly InteriorWall[],
  context: WallMoveContext
): { items: FurnitureItem[] } | { refusal: string } {
  const { roomWidth, roomDepth, porch, cutout } = context;
  let changed = false;
  const items: FurnitureItem[] = [];
  const openings = new Map<string, Array<{ name: string; half: number; from: number; along: number }>>();
  for (const item of floor.items) {
    const position = item.position;
    const mounted = isWallMounted(item.type);
    const hung = !mounted && isWallHung(item.type) && !isCeilingHung(item.type);
    const owner = !position || item.id === ENTRANCE_DOOR_ID ? null : mounted ? seatedOn(item, position, before, context) : hung ? hungOn(item, position, before, context) : null;
    const next = owner && after.find((wall) => wall.id === owner.id);
    if (!position || !owner || !next || wallPatches([owner], [next]).length === 0) {
      items.push(item);
      continue;
    }
    const carried = rideWall(item, position, owner, next);
    if (!carried) return { refusal: `${item.name} wouldn't fit on that wall any more: move it first.` };
    changed = true;
    if (hung) {
      const turn = wallAngle(next) - wallAngle(owner);
      items.push({ ...item, position: carried.position, ...(Math.abs(turn) > 1e-9 ? { rotation: (item.rotation ?? 0) - turn } : {}) });
      continue;
    }
    const settled = settleWallMountedItem(item, carried.position, roomWidth, roomDepth, after, porch, cutout);
    items.push(settled ? { ...item, ...settled } : { ...item, position: carried.position });
    if (isOpening(item.type)) {
      const onWall = openings.get(next.id) ?? [];
      const clash = onWall.find((other) => {
        const reach = other.half + item.width / 2 - 1e-6;
        return Math.abs(other.along - carried.along) < reach && Math.abs(other.from - carried.from) >= reach;
      });
      if (clash) return { refusal: `${clash.name} and ${item.name} wouldn't both fit on that wall any more: move one first.` };
      openings.set(next.id, [...onWall, { name: item.name, half: item.width / 2, from: carried.from, along: carried.along }]);
    }
  }
  return { items: changed ? items : [...floor.items] };
}

export type WallMovePlan = { walls: InteriorWall[]; items: FurnitureItem[] } | { refusal: string };

/**
 * What moving walls by `patches` does to the floor: the walls and items to
 * store, or why not. Null when nothing would change. The reducer's one rule
 * and the gesture's preview.
 */
export function planWallMove(floor: FloorLayout, patches: readonly WallPatch[], context: WallMoveContext): WallMovePlan | null {
  const before = floor.interiorWalls ?? [];
  const after = before.map((wall) => {
    const patch = patches.find((entry) => entry.id === wall.id);
    return patch ? { ...wall, x1: patch.x1, z1: patch.z1, x2: patch.x2, z2: patch.z2 } : wall;
  });
  const moved = wallPatches(before, after);
  if (moved.length === 0) return null;
  if (moved.some((wall) => wall.id === ENTRANCE_WALL_ID)) return { refusal: "The porch's back wall moves with the entrance." };
  if (moved.some((wall) => lengthOf(wall) < MIN_WALL_LENGTH)) return { refusal: 'That would leave a wall too short to stand.' };
  const ids = new Set(moved.map((wall) => wall.id));
  const porch = context.porch;
  if (porch && after.some((wall) => ids.has(wall.id) && clipWallToPorch(wall, porch)[0] !== wall)) {
    return { refusal: "A wall can't run through the porch: it's outside the house." };
  }
  const notch = cutoutRect({ width: context.roomWidth, height: context.roomDepth, cutout: context.cutout });
  if (after.some((wall) => ids.has(wall.id) && clipWallToCutout(wall, notch)[0] !== wall)) {
    return { refusal: "A wall can't run through the corner: it's outside the house." };
  }
  const shell = footprintEdges(context.roomWidth, context.roomDepth, context.cutout);
  const onAnother = (wall: WallPatch, walls: readonly WallPatch[]): boolean =>
    [...walls, ...shell].some((other) => other.id !== wall.id && (wallsOverlap(wall, other) || wallsOverlap(other, wall)));
  for (const wall of moved) {
    const old = before.find((entry) => entry.id === wall.id);
    if (onAnother(wall, after) && !(old && onAnother(old, before))) return { refusal: 'That would put one wall on top of another.' };
  }
  const followed = followWalls(floor, before, after, context);
  return 'refusal' in followed ? followed : { walls: after, items: followed.items };
}
