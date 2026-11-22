import { floorKeepOut } from './floor-keep-out';
import { footprintOutline, isInsideBuilding } from './footprint';
import { hasCollisions, openingUnderDecor, snapToWall, type KeepOutRect } from './geometry';
import { remapGroupIds } from './groups';
import { isCeilingHung, isWallHung } from './mount-band';
import { isOpening, isWallMounted, settleWallMountedItem, INTERIOR_WALL_THICKNESS } from './opening-snap';
import { floorRooms, onRing, pointInRing, type DetectedRoom } from './room-detect';
import { MAX_INTERIOR_WALLS_PER_FLOOR, MAX_ITEMS_PER_FLOOR } from './schema';
import { storeyHeight } from './storeys';
import { ENTRANCE_DOOR_ID, ENTRANCE_WALL_ID, entrancePlanOutline } from './street';
import { patternWallSide, paintWallSide, wallSideAt, wallSideColor, wallSidePattern } from './wall-sides';
import { MIN_WALL_LENGTH } from './wall-snap';
import { MAX_ZONES, clampZoneRect, isRoomZone, regionShape, zoneContains, zoneInPorch, zoneRings, zoneShapeFits } from './zones';
import type { FloorLayout, FurnitureItem, InteriorWall, RoomLayout, RoomZone, Vec2 } from './types';

/**
 * Moving, copying and mirroring a room with its walls (#925). Pure: the
 * reducer's `transferRoom` action and the room chip's preview both plan here,
 * so the refusal the chip shows is the one the reducer would apply.
 *
 * A room is a detected room (lib/room-detect), picked by a point inside it.
 * What goes with it:
 * - its furniture: every placed item whose centre is inside it, and the doors
 *   and windows in its partitions (those in the outer walls belong to the house);
 * - its zones: every zone lying wholly within it;
 * - its walls: every partition on its boundary or inside it, except one a
 *   NAMED room (a zone) also stands on: that one stays with the neighbour.
 *   Where the room is bounded by a wall that stays, or by the outer wall, the
 *   room takes a copy of that side along, so it arrives closed.
 *
 * At the destination nothing is laid twice: a wall piece that would lie on
 * the outer wall or along a wall that is already there is left out. The plan
 * refuses, rather than build, a room off the footprint or over the L's cut,
 * on the porch or a stairwell, through another wall, onto furniture (any new
 * overlap), decor newly over a door, or a zone the schema would not keep.
 */

/** Which way a mirror flips: 'x' swaps west and east, 'z' north and south. */
export type MirrorAxis = 'x' | 'z';

/** A room lifted off its storey, at its source coordinates: what Copy keeps. */
export interface RoomArrangement {
  /** The storey it was copied from: a paste there must not land on it. */
  readonly floorId: string;
  /** The room's outline (an outer ring: rooms with holes don't transfer). */
  readonly outline: readonly Vec2[];
  /** A point inside the room. */
  readonly anchor: Vec2;
  /** The partitions that go with the room, whole. */
  readonly walls: readonly InteriorWall[];
  /** The sides of the room no such wall covers, as walls to lay at the destination (ids are placeholders). */
  readonly sides: readonly InteriorWall[];
  readonly items: readonly FurnitureItem[];
  readonly zones: readonly RoomZone[];
}

export type RoomTransfer =
  | { kind: 'move'; at: Vec2; dx: number; dz: number }
  | { kind: 'mirror'; at: Vec2; axis: MirrorAxis }
  /** A copy on the same storey, `dx`/`dz` from the source. */
  | { kind: 'copy'; at: Vec2; dx: number; dz: number; idTag: string }
  /** A copied room (`roomArrangement`) laid on this storey, `dx`/`dz` from where it was copied. */
  | { kind: 'paste'; room: RoomArrangement; dx: number; dz: number; idTag: string };

export interface RoomTransferResult {
  floor: FloorLayout;
  /** A point inside the room where it now stands: the selection follows it. */
  at: Vec2;
  /** The ids of the zones that arrived (copies get fresh ones). */
  zoneIds: string[];
}

/** What a transfer does to the storey, why not, or null when it changes nothing. */
export type RoomTransferPlan = RoomTransferResult | { refusal: string } | null;

/** How close a point must be to a ring to stand on it (1 mm, as room detection's vertices). */
const ON_RING = 1e-3;
/** Along a wall, these fractions are tried for whether it lies on a room's side. */
const WALL_SAMPLES = [0.1, 0.3, 0.5, 0.7, 0.9];
/** A wall poking this far into a room is a join, not a wall through it (room detection's join reach). */
const JOIN_REACH = INTERIOR_WALL_THICKNESS / 2;
/** Coordinates are kept to a micrometre, so a moved room's numbers stay clean. */
const PRECISION = 1e6;

/** How far past a wall's face a mount's centre may sit and still hang on it, in metres. */
const FACE_SLOP = 0.05;
/** How far from a wall face hung decor is re-hung onto it at the destination. */
const REHANG_REACH = 0.35;

/** Decor on a wall, or a camera: what hangs on a wall face rather than in it. */
function hangsOnWall(item: FurnitureItem): boolean {
  return (isWallHung(item.type) && !isCeilingHung(item.type)) || (isWallMounted(item.type) && !isOpening(item.type));
}

const round = (value: number): number => Math.round(value * PRECISION) / PRECISION;

export const NO_ROOM_HERE = 'There is no closed room there.';

// ---------------------------------------------------------------------------
// Picking the room
// ---------------------------------------------------------------------------

/** The detected room at `at` on the storey, if any. */
export function roomAtPoint(layout: RoomLayout, floorIndex: number, at: Vec2): DetectedRoom | null {
  return floorRooms(layout, floorIndex).find((room) => insideRoom(room, at) || onRing(room.outline, at.x, at.z, ON_RING)) ?? null;
}

function insideRoom(room: Pick<DetectedRoom, 'outline' | 'holes'>, point: Vec2): boolean {
  if (onRing(room.outline, point.x, point.z, ON_RING)) return false;
  return pointInRing(room.outline, point.x, point.z) && !room.holes?.some((hole) => pointInRing(hole, point.x, point.z));
}

/** Whether a point lies in the room or on its side. */
function withinRoom(room: DetectedRoom, point: Vec2): boolean {
  return onRing(room.outline, point.x, point.z, ON_RING) || insideRoom(room, point);
}

/** Whether a zone lies wholly within the room: then it goes where the room goes. */
function zoneInRoom(zone: RoomZone, room: DetectedRoom): boolean {
  return zoneRings(zone).every((ring) => ring.every((point) => withinRoom(room, point)));
}

function wallPoint(wall: InteriorWall, t: number): Vec2 {
  return { x: wall.x1 + (wall.x2 - wall.x1) * t, z: wall.z1 + (wall.z2 - wall.z1) * t };
}

/**
 * The room at `at` lifted off its storey, or why it can't move. Shared by
 * the chip (what is selected), Copy (what the clipboard keeps) and the plan.
 */
export function roomArrangement(layout: RoomLayout, floorIndex: number, at: Vec2): RoomArrangement | { refusal: string } {
  const floor = layout.floors[floorIndex];
  const rooms = floorRooms(layout, floorIndex);
  const room = rooms.find((entry) => insideRoom(entry, at));
  if (!floor || !room) return { refusal: NO_ROOM_HERE };
  if (room.holes?.length) return { refusal: "A room with a stairwell or another room inside it can't move yet." };
  const keepOut = floorKeepOut(layout, floorIndex).filter((rect) => !rect.cutout);
  if (keepOut.some((rect) => ringsMeet(room.outline, keepOutRing(rect)))) {
    return { refusal: 'A room against the porch or a stairwell stays where it is.' };
  }

  const zones = floor.zones ?? [];
  const ownZones = zones.filter((zone) => zoneInRoom(zone, room));
  // Named neighbours keep the walls they stand on.
  const named = rooms.filter((other) => other !== room && zones.some((zone) => zoneContains(zone, other.anchor.x, other.anchor.z)));
  const walls = floor.interiorWalls ?? [];
  const own: InteriorWall[] = [];
  const others: InteriorWall[] = [];
  for (const wall of walls) {
    const samples = WALL_SAMPLES.map((t) => wallPoint(wall, t));
    const ofRoom = wall.id !== ENTRANCE_WALL_ID && samples.every((point) => withinRoom(room, point));
    const shared = samples.some((point) => named.some((other) => onRing(other.outline, point.x, point.z, ON_RING)));
    if (ofRoom && !shared) own.push(wall);
    else others.push(wall);
  }

  const shell = ringEdges(footprintOutline(layout));
  const sides = roomSides(room, own, others, shell);

  const onOwnWall = (point: Vec2, reach: number): boolean =>
    own.some((wall) => onRing([{ x: wall.x1, z: wall.z1 }, { x: wall.x2, z: wall.z2 }], point.x, point.z, reach));
  const items = floor.items.filter((item) => {
    if (!item.position || item.id === ENTRANCE_DOOR_ID) return false;
    // A door or window goes with its wall: one in a wall that stays (a named
    // neighbour's, the outer wall) stays in it.
    if (isOpening(item.type)) return onOwnWall(item.position, ON_RING);
    if (insideRoom(room, item.position)) return true;
    // What hangs on the far face of a wall that goes, goes with it.
    return hangsOnWall(item) && onOwnWall(item.position, INTERIOR_WALL_THICKNESS / 2 + item.depth / 2 + FACE_SLOP);
  });
  const stairs = items.find((item) => item.type === 'stairs');
  if (stairs) return { refusal: `${stairs.name} can't move with a room: move the stairs on their own.` };

  return { floorId: floor.id, outline: room.outline, anchor: room.anchor, walls: own, sides, items, zones: ownZones };
}

/**
 * The room's sides that its own walls don't cover, as walls to build at the
 * destination: along a wall that stays, painted as that wall's face into
 * the room; along the outer wall, plain. Gaps no wall covers (a partition
 * stopping short of its join) are left open, as they are now.
 */
function roomSides(room: DetectedRoom, own: readonly InteriorWall[], others: readonly InteriorWall[], shell: readonly InteriorWall[]): InteriorWall[] {
  const sides: InteriorWall[] = [];
  for (const edge of ringEdges(room.outline)) {
    let open = subtract([[0, 1]], own.flatMap((wall) => coverage(edge, wall)));
    for (const wall of others) {
      const covered = intersect(open, coverage(edge, wall));
      if (covered.length === 0) continue;
      open = subtract(open, covered);
      for (const piece of pieces(edge, covered)) sides.push(withRoomFace(piece, wall, room.anchor));
    }
    const outer = intersect(open, shell.flatMap((wall) => coverage(edge, wall)));
    sides.push(...pieces(edge, outer));
  }
  return sides;
}

/** A side copied from `source`: its face into the room on the room's side, plain on the other. */
function withRoomFace(side: InteriorWall, source: InteriorWall, anchor: Vec2): InteriorWall {
  const from = wallSideAt(source, anchor);
  const to = wallSideAt(side, anchor);
  let wall = side;
  if (source.color !== undefined || source.colorB !== undefined) wall = paintWallSide(wall, wallSideColor(source, from), to);
  const pattern = wallSidePattern(source, from);
  if (pattern !== 'solid') wall = patternWallSide(wall, pattern, to);
  return wall;
}

// ---------------------------------------------------------------------------
// Laying it down
// ---------------------------------------------------------------------------

interface Placement {
  dx: number;
  dz: number;
  mirror?: { axis: MirrorAxis; about: Vec2 } | undefined;
}

function place(point: Vec2, placement: Placement): Vec2 {
  let { x, z } = point;
  if (placement.mirror?.axis === 'x') x = 2 * placement.mirror.about.x - x;
  if (placement.mirror?.axis === 'z') z = 2 * placement.mirror.about.z - z;
  return { x: round(x + placement.dx), z: round(z + placement.dz) };
}

/** A wall laid down; a mirror swaps its ends, so each face still looks into the room it did. */
function placeWall(wall: InteriorWall, placement: Placement): InteriorWall {
  const a = place({ x: wall.x1, z: wall.z1 }, placement);
  const b = place({ x: wall.x2, z: wall.z2 }, placement);
  const [start, end] = placement.mirror ? [b, a] : [a, b];
  return { ...wall, x1: start.x, z1: start.z, x2: end.x, z2: end.z };
}

const TAU = Math.PI * 2;
const turn = (rotation: number): number => round(((rotation % TAU) + TAU) % TAU);

/** An item laid down: a mirror reflects its heading and flips its hand. */
function placeItem(item: FurnitureItem, placement: Placement): FurnitureItem {
  const position = place(item.position!, placement);
  if (!placement.mirror) return { ...item, position };
  const rotation = item.rotation ?? 0;
  const mirroredRotation = turn(placement.mirror.axis === 'x' ? -rotation : Math.PI - rotation);
  const { mirrored: _mirrored, ...rest } = item;
  return { ...rest, position, rotation: mirroredRotation, ...(item.mirrored ? {} : { mirrored: true }) };
}

function placeZone(zone: RoomZone, placement: Placement): RoomZone {
  if (zone.outline) {
    const outline = zone.outline.map((point) => place(point, placement));
    const holes = zone.holes?.map((hole) => hole.map((point) => place(point, placement)));
    return { ...zone, ...regionShape({ outline, ...(holes ? { holes } : {}) }) };
  }
  const a = place({ x: zone.x, z: zone.z }, placement);
  const b = place({ x: zone.x + zone.w, z: zone.z + zone.d }, placement);
  const x = Math.min(a.x, b.x);
  const z = Math.min(a.z, b.z);
  return { ...zone, x, z, w: round(Math.abs(b.x - a.x)), d: round(Math.abs(b.z - a.z)) };
}

/** Hung decor flush against the wall face nearest it, moved only across the wall it faces. */
function rehang(item: FurnitureItem, layout: RoomLayout, walls: readonly InteriorWall[]): Vec2 {
  const at = item.position!;
  const snapped = snapToWall({ position: at, item, roomWidth: layout.width, roomDepth: layout.height, cutout: layout.cutout, interiorWalls: walls, threshold: REHANG_REACH });
  const rotation = item.rotation ?? 0;
  // Its back is on a wall running across its heading: x for a quarter turn, z otherwise.
  return Math.abs(Math.sin(rotation)) > Math.abs(Math.cos(rotation)) ? { x: snapped.x, z: at.z } : { x: at.x, z: snapped.z };
}

/** The middle of the room's bounding box: a mirror flips the room in place about it. */
function roomCentre(outline: readonly Vec2[]): Vec2 {
  const xs = outline.map((point) => point.x);
  const zs = outline.map((point) => point.z);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
}

/** What a transfer does to the storey `floorIndex` of `layout`. */
export function planRoomTransfer(layout: RoomLayout, floorIndex: number, transfer: RoomTransfer): RoomTransferPlan {
  const floor = layout.floors[floorIndex];
  if (!floor) return null;
  const offset = transfer.kind === 'mirror' ? { dx: 0, dz: 0 } : { dx: transfer.dx, dz: transfer.dz };
  if (!Number.isFinite(offset.dx) || !Number.isFinite(offset.dz)) return null;
  if (transfer.kind === 'move' && offset.dx === 0 && offset.dz === 0) return null;
  const room = transfer.kind === 'paste' ? transfer.room : roomArrangement(layout, floorIndex, transfer.at);
  if ('refusal' in room) return room;
  const placement: Placement = {
    ...offset,
    ...(transfer.kind === 'mirror' ? { mirror: { axis: transfer.axis, about: roomCentre(room.outline) } } : {}),
  };
  const moves = transfer.kind === 'move' || transfer.kind === 'mirror';
  if (moves) {
    const locked = room.items.find((item) => item.locked);
    if (locked) return { refusal: `${locked.name} is locked: unlock it to move the room.` };
  }
  // A copy must not land on the room it copies.
  const source = !moves && room.floorId === floor.id ? room.outline : null;
  return layDown(layout, floorIndex, floor, room, placement, moves ? null : transfer.idTag, source);
}

/**
 * The storey with the room laid down by `placement`: moved when `idTag` is
 * null (its walls, items and zones keep their ids and leave the source),
 * copied under fresh ids otherwise.
 */
function layDown(
  layout: RoomLayout,
  floorIndex: number,
  floor: FloorLayout,
  room: RoomArrangement,
  placement: Placement,
  idTag: string | null,
  source: readonly Vec2[] | null
): RoomTransferPlan {
  const footprint = footprintOutline(layout);
  const outline = room.outline.map((point) => place(point, placement));
  if (!zoneShapeFits(regionShape({ outline }), footprint)) return { refusal: "The room wouldn't fit inside the house there." };
  const keepOut = floorKeepOut(layout, floorIndex);
  if (keepOut.some((rect) => !rect.cutout && ringsOverlap(outline, keepOutRing(rect)))) {
    return { refusal: "A room can't stand on the porch or over a stairwell." };
  }
  const moving = new Set(idTag === null ? room.zones.map((zone) => zone.id) : []);
  const named = (floor.zones ?? []).find((zone) => !moving.has(zone.id) && ringsOverlap(outline, zoneRings(zone)[0]!));
  if (named) return { refusal: `The room would land on ${named.name}.` };
  if (source && ringsOverlap(outline, source)) return { refusal: 'The copy would land on the room itself.' };

  // The walls: what stays, then the room's own walls and sides, less what
  // the outer wall or a staying wall already covers there.
  const leaving = new Set(idTag === null ? room.walls.map((wall) => wall.id) : []);
  const staying = (floor.interiorWalls ?? []).filter((wall) => !leaving.has(wall.id));
  const through = staying.find((wall) => entersRing(wall, outline));
  if (through) return { refusal: 'Another wall would run through the room there.' };
  const covering = [...ringEdges(footprint), ...staying];
  const taken = new Set([...staying, ...room.walls].map((wall) => wall.id));
  const freshWallId = freshIds(taken, `wall-room-${idTag ?? 'move'}`);
  const laid: InteriorWall[] = [];
  // Own walls a move trims away whole (onto the outer wall or a staying
  // wall): a side laid where one stood takes its id and paint back.
  const dropped: InteriorWall[] = [];
  for (const wall of room.walls) {
    const placed = placeWall(wall, placement);
    const kept = pieces(placed, subtract([[0, 1]], covering.flatMap((other) => coverage(placed, other))));
    if (kept.length === 0 && idTag === null) dropped.push(wall);
    kept.forEach((piece, index) => {
      // A wall that ends up where it stood is the wall it was.
      if (sameSegment(piece, wall)) {
        laid.push(wall);
        return;
      }
      const id = idTag === null && index === 0 ? wall.id : freshWallId();
      taken.add(id);
      laid.push({ ...piece, id });
    });
  }
  for (const side of room.sides) {
    const placed = placeWall(side, placement);
    const kept = pieces(placed, subtract([[0, 1]], [...covering, ...laid].flatMap((other) => coverage(placed, other))));
    for (const piece of kept) {
      const home = dropped.find((wall) => full(coverage(wall, piece)) || full(coverage(piece, wall)));
      if (!home) {
        laid.push({ ...piece, id: freshWallId() });
        continue;
      }
      if (sameSegment(piece, home) && !laid.some((wall) => wall.id === home.id)) {
        laid.push(home);
        continue;
      }
      laid.push(inheritWall(piece, home, laid.some((wall) => wall.id === home.id) ? freshWallId() : home.id));
    }
  }
  const walls = [...staying, ...laid];
  if (walls.filter((wall) => wall.id !== ENTRANCE_WALL_ID).length > MAX_INTERIOR_WALLS_PER_FLOOR - 1) {
    return { refusal: 'This storey has as many walls as it can hold.' };
  }

  // The furniture: wall-mounted pieces settle onto the walls as they now stand.
  const frontGap = entrancePlanOutline(layout, floorIndex);
  const groupsFresh = idTag === null ? room.items : remapGroupIds(room.items, `room-${idTag}`);
  const takenItems = new Set(floor.items.map((item) => item.id));
  const shellEdges = ringEdges(footprint);
  let strayed: string | null = null;
  const placedItems = groupsFresh.map((item, index) => {
    let placed = placeItem(item, placement);
    const settled = settleWallMountedItem(placed, placed.position!, layout.width, layout.height, walls, frontGap, layout.cutout);
    if (settled) {
      // A door rides its wall: one the settle would carry off it (the wall
      // trimmed away under it) or into the outer wall leaves its room.
      const slid = Math.hypot(settled.position.x - placed.position!.x, settled.position.z - placed.position!.z);
      if (slid > ON_RING || settled.rotation !== undefined) strayed ??= `${item.name} would leave its wall there.`;
      else if (isOpening(item.type) && onEdges(shellEdges, settled.position)) strayed ??= `${item.name} would end up in an outer wall there.`;
      placed = { ...placed, ...settled };
    } else if (isWallHung(item.type) && !isCeilingHung(item.type)) {
      // Decor re-hangs on the face it lands by: a partition's is half its
      // thickness off the line, the outer wall's on it.
      placed = { ...placed, position: rehang(placed, layout, walls) };
    }
    if (!isInsideBuilding(layout, placed.position!.x, placed.position!.z)) strayed ??= `${item.name} would end up outside the house there.`;
    if (idTag === null) return placed;
    const { locked: _locked, ...copy } = placed;
    let id = `${item.type}-room-${idTag}-${index}`;
    for (let n = 2; takenItems.has(id); n++) id = `${item.type}-room-${idTag}-${index}-${n}`;
    takenItems.add(id);
    return { ...copy, id };
  });
  if (strayed) return { refusal: strayed };
  const movedIds = new Set(idTag === null ? room.items.map((item) => item.id) : []);
  const byId = new Map(placedItems.map((item) => [item.id, item]));
  const items =
    idTag === null ? floor.items.map((item) => (movedIds.has(item.id) ? byId.get(item.id)! : item)) : [...floor.items, ...placedItems];
  if (items.filter((item) => item.id !== ENTRANCE_DOOR_ID).length > MAX_ITEMS_PER_FLOOR - 1) {
    return { refusal: 'This storey has as many items as it can hold.' };
  }

  const next: FloorLayout = { ...floor, interiorWalls: walls, items };
  const overlap = newOverlap(layout, floor, next, new Set(placedItems.map((item) => item.id)), outline, keepOut);
  if (overlap) return { refusal: overlap };

  // The zones.
  const recess = entrancePlanOutline(layout, floorIndex);
  const zones = floor.zones ?? [];
  const takenZones = new Set(zones.map((zone) => zone.id));
  const placedZones: RoomZone[] = [];
  for (const zone of room.zones) {
    const placed = placeZone(zone, placement);
    let id = zone.id;
    if (idTag !== null) {
      id = `zone-room-${idTag}-${placedZones.length}`;
      for (let n = 2; takenZones.has(id); n++) id = `zone-room-${idTag}-${placedZones.length}-${n}`;
      takenZones.add(id);
    }
    const kept = { ...placed, id };
    if (!zoneKeeps(kept, layout, footprint, recess)) return { refusal: `${zone.name} wouldn't fit there as a zone.` };
    placedZones.push(kept);
  }
  let nextZones = zones;
  if (placedZones.length > 0) {
    if (idTag === null) {
      const byZone = new Map(placedZones.map((zone) => [zone.id, zone]));
      nextZones = zones.map((zone) => byZone.get(zone.id) ?? zone);
    } else {
      nextZones = [...zones, ...placedZones];
      if (nextZones.length > MAX_ZONES) return { refusal: 'This storey has as many zones as it can hold.' };
    }
  }

  return {
    floor: { ...next, ...(placedZones.length > 0 ? { zones: nextZones } : {}) },
    at: place(room.anchor, placement),
    zoneIds: placedZones.map((zone) => zone.id),
  };
}

/** Whether a zone laid down would be stored as it is: the reducer's addZone rules. */
function zoneKeeps(zone: RoomZone, layout: RoomLayout, footprint: readonly Vec2[], recess: ReturnType<typeof entrancePlanOutline>): boolean {
  if (!isRoomZone(zone) || !zoneShapeFits(zone, footprint)) return false;
  if (zone.outline) return true;
  const rect = clampZoneRect(zone, layout.width, layout.height, layout.cutout);
  const off = (a: number, b: number): boolean => Math.abs(a - b) > 1e-6;
  if (!rect || off(rect.x, zone.x) || off(rect.z, zone.z) || off(rect.w, zone.w) || off(rect.d, zone.d)) return false;
  return !zoneInPorch(zone, recess);
}

/**
 * Why the storey after the transfer has an overlap it didn't have, or null.
 * Only what could have changed is measured: the items laid down and what
 * stands in or near the room's new place.
 */
function newOverlap(
  layout: RoomLayout,
  before: FloorLayout,
  after: FloorLayout,
  laid: ReadonlySet<string>,
  outline: readonly Vec2[],
  keepOut: readonly KeepOutRect[]
): string | null {
  const reach = 3;
  const xs = outline.map((point) => point.x);
  const zs = outline.map((point) => point.z);
  const near = (item: FurnitureItem): boolean =>
    item.position !== undefined &&
    item.position.x >= Math.min(...xs) - reach &&
    item.position.x <= Math.max(...xs) + reach &&
    item.position.z >= Math.min(...zs) - reach &&
    item.position.z <= Math.max(...zs) + reach;
  const height = storeyHeight(after);
  const beforeIds = new Map(before.items.map((item) => [item.id, item]));
  const context = { keepOut, interiorWalls: after.interiorWalls, storeyHeight: height };
  const contextBefore = { keepOut, interiorWalls: before.interiorWalls, storeyHeight: storeyHeight(before) };
  for (const item of after.items) {
    if (!laid.has(item.id) && !near(item)) continue;
    if (!hasCollisions(item, after.items, layout.width, layout.height, context)) continue;
    // What overlapped already may go on doing so; a copy starts clean.
    const old = beforeIds.get(item.id);
    if (old && hasCollisions(old, before.items, layout.width, layout.height, contextBefore)) continue;
    return `${item.name} would overlap something there.`;
  }
  // Wall decor newly over a door or window (#778).
  for (const decor of after.items) {
    const opening = openingUnderDecor(decor, after.items.filter((item) => isOpening(item.type)), height);
    if (!opening) continue;
    if (!laid.has(decor.id) && !laid.has(opening.id)) continue;
    const oldDecor = beforeIds.get(decor.id);
    const oldOpening = beforeIds.get(opening.id);
    if (oldDecor && oldOpening && openingUnderDecor(oldDecor, [oldOpening], storeyHeight(before))) continue;
    return `${decor.name} would end up over ${opening.name}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Segment and ring geometry
// ---------------------------------------------------------------------------

type Interval = [number, number];

const full = (stretches: readonly Interval[]): boolean => stretches.some(([from, to]) => from <= 1e-9 && to >= 1 - 1e-9);

/** Whether two walls run between the same two points, either way round. */
function sameSegment(a: InteriorWall, b: InteriorWall): boolean {
  const near = (x1: number, z1: number, x2: number, z2: number): boolean => Math.hypot(x1 - x2, z1 - z2) <= ON_RING;
  return (
    (near(a.x1, a.z1, b.x1, b.z1) && near(a.x2, a.z2, b.x2, b.z2)) || (near(a.x1, a.z1, b.x2, b.z2) && near(a.x2, a.z2, b.x1, b.z1))
  );
}

/** A piece laid along where `wall` stood, with its id and paint, running its way so each face looks where it did. */
function inheritWall(piece: InteriorWall, wall: InteriorWall, id: string): InteriorWall {
  const along = (piece.x2 - piece.x1) * (wall.x2 - wall.x1) + (piece.z2 - piece.z1) * (wall.z2 - wall.z1);
  const ends = along >= 0 ? { x1: piece.x1, z1: piece.z1, x2: piece.x2, z2: piece.z2 } : { x1: piece.x2, z1: piece.z2, x2: piece.x1, z2: piece.z1 };
  return { ...wall, ...ends, id };
}

function ringEdges(ring: readonly Vec2[]): InteriorWall[] {
  return ring.map((a, index) => {
    const b = ring[(index + 1) % ring.length]!;
    return { id: '', x1: a.x, z1: a.z, x2: b.x, z2: b.z };
  });
}

function onEdges(edges: readonly InteriorWall[], point: Vec2): boolean {
  return edges.some((edge) => onRing([{ x: edge.x1, z: edge.z1 }, { x: edge.x2, z: edge.z2 }], point.x, point.z, ON_RING));
}

/** The stretch of `edge` (from 0 to 1) that `wall` lies along, or none. */
function coverage(edge: InteriorWall, wall: InteriorWall): Interval[] {
  const dx = edge.x2 - edge.x1;
  const dz = edge.z2 - edge.z1;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return [];
  const off = (x: number, z: number): number => Math.abs((x - edge.x1) * dz - (z - edge.z1) * dx) / length;
  if (off(wall.x1, wall.z1) > ON_RING || off(wall.x2, wall.z2) > ON_RING) return [];
  const along = (x: number, z: number): number => ((x - edge.x1) * dx + (z - edge.z1) * dz) / (length * length);
  const a = along(wall.x1, wall.z1);
  const b = along(wall.x2, wall.z2);
  const from = Math.max(0, Math.min(a, b));
  const to = Math.min(1, Math.max(a, b));
  return to > from ? [[from, to]] : [];
}

function subtract(from: readonly Interval[], cuts: readonly Interval[]): Interval[] {
  let rest: Interval[] = [...from];
  for (const [c0, c1] of cuts) {
    rest = rest.flatMap(([a, b]): Interval[] => {
      if (c1 <= a || c0 >= b) return [[a, b]];
      const out: Interval[] = [];
      if (c0 > a) out.push([a, c0]);
      if (c1 < b) out.push([c1, b]);
      return out;
    });
  }
  return rest;
}

function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const from = Math.max(a0, b0);
      const to = Math.min(a1, b1);
      if (to > from) out.push([from, to]);
    }
  }
  return out.sort((p, q) => p[0] - q[0]);
}

/** The stretches of a wall as walls of their own, those long enough to stand. */
function pieces(wall: InteriorWall, stretches: readonly Interval[]): InteriorWall[] {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  return stretches
    .filter(([from, to]) => (to - from) * length >= MIN_WALL_LENGTH - 1e-9)
    .map(([from, to]) => {
      if (from <= 0 && to >= 1) return wall;
      const a = wallPoint(wall, from);
      const b = wallPoint(wall, to);
      return { ...wall, x1: round(a.x), z1: round(a.z), x2: round(b.x), z2: round(b.z) };
    });
}

/** Where along a → b it crosses the sides of a ring, from 0 to 1, ends included. */
function crossings(a: Vec2, b: Vec2, ring: readonly Vec2[]): number[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const hits = [0, 1];
  ring.forEach((from, index) => {
    const to = ring[(index + 1) % ring.length]!;
    const ex = to.x - from.x;
    const ez = to.z - from.z;
    const cross = dx * ez - dz * ex;
    if (Math.abs(cross) < 1e-12) return;
    const t = ((from.x - a.x) * ez - (from.z - a.z) * ex) / cross;
    const u = ((from.x - a.x) * dz - (from.z - a.z) * dx) / cross;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) hits.push(t);
  });
  return hits.sort((p, q) => p - q);
}

/** How far of a → b runs strictly inside the ring, in metres. */
function lengthInside(a: Vec2, b: Vec2, ring: readonly Vec2[]): number {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const hits = crossings(a, b, ring);
  let inside = 0;
  for (let i = 1; i < hits.length; i++) {
    const t0 = hits[i - 1]!;
    const t1 = hits[i]!;
    if (t1 - t0 < 1e-12) continue;
    const mid = { x: a.x + (b.x - a.x) * ((t0 + t1) / 2), z: a.z + (b.z - a.z) * ((t0 + t1) / 2) };
    if (!onRing(ring, mid.x, mid.z, ON_RING) && pointInRing(ring, mid.x, mid.z)) inside += (t1 - t0) * length;
  }
  return inside;
}

/** Whether a wall runs into the ring further than a join reaches. */
function entersRing(wall: InteriorWall, ring: readonly Vec2[]): boolean {
  return lengthInside({ x: wall.x1, z: wall.z1 }, { x: wall.x2, z: wall.z2 }, ring) > JOIN_REACH;
}

/** Whether two rings share any floor (touching sides don't count). */
function ringsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  const edgesInside = (ring: readonly Vec2[], other: readonly Vec2[]): boolean =>
    ring.some((p, index) => lengthInside(p, ring[(index + 1) % ring.length]!, other) > 1e-6);
  if (edgesInside(a, b) || edgesInside(b, a)) return true;
  // One wholly inside the other, or the two the same shape.
  const centre = (ring: readonly Vec2[]): Vec2 => ({
    x: ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
    z: ring.reduce((sum, point) => sum + point.z, 0) / ring.length,
  });
  const inside = (ring: readonly Vec2[], point: Vec2): boolean => !onRing(ring, point.x, point.z, ON_RING) && pointInRing(ring, point.x, point.z);
  return inside(b, centre(a)) || inside(a, centre(b));
}

/** Whether two rings overlap or touch along a side. */
function ringsMeet(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (ringsOverlap(a, b)) return true;
  return ringEdges(a).some((edge) => ringEdges(b).some((other) => coverage(edge, other).some(([from, to]) => to - from > 1e-6)));
}

function keepOutRing(rect: KeepOutRect): Vec2[] {
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const hw = (rect.x1 - rect.x0) / 2;
  const hd = (rect.z1 - rect.z0) / 2;
  const cos = Math.cos(rect.rotation ?? 0);
  const sin = Math.sin(rect.rotation ?? 0);
  return ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const).map(([lx, lz]) => ({
    x: cx + lx * cos + lz * sin,
    z: cz - lx * sin + lz * cos,
  }));
}

/** A source of ids not in `taken` (and added to it), `prefix-0`, `prefix-1`, … */
function freshIds(taken: Set<string>, prefix: string): () => string {
  let next = 0;
  return () => {
    let id = `${prefix}-${next++}`;
    while (taken.has(id)) id = `${prefix}-${next++}`;
    taken.add(id);
    return id;
  };
}

// ---------------------------------------------------------------------------
// Where a pasted copy goes
// ---------------------------------------------------------------------------

/**
 * Where a paste of `room` lands on this storey: where it was copied from when
 * that is free (a stacked bathroom), else beside it, one room's width or
 * depth over, nearest first. Returns the offset, or why nowhere works.
 */
export function pasteSpot(layout: RoomLayout, floorIndex: number, room: RoomArrangement, idTag: string): { dx: number; dz: number } | { refusal: string } {
  const xs = room.outline.map((point) => point.x);
  const zs = room.outline.map((point) => point.z);
  const w = round(Math.max(...xs) - Math.min(...xs));
  const d = round(Math.max(...zs) - Math.min(...zs));
  const offsets: Array<{ dx: number; dz: number }> = [{ dx: 0, dz: 0 }];
  for (const k of [1, 2]) {
    offsets.push({ dx: k * w, dz: 0 }, { dx: -k * w, dz: 0 }, { dx: 0, dz: k * d }, { dx: 0, dz: -k * d });
  }
  let first: string | null = null;
  for (const offset of offsets) {
    const plan = planRoomTransfer(layout, floorIndex, { kind: 'paste', room, idTag, ...offset });
    if (plan && !('refusal' in plan)) return offset;
    first ??= plan && 'refusal' in plan ? plan.refusal : null;
  }
  return { refusal: `There's no free spot for the copy here or beside it. ${first ?? ''}`.trim() };
}
