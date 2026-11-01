import { cutoutKeepOut, floorKeepOut } from './floor-keep-out';
import {
  clampToFootprint,
  cutoutFits,
  cutoutRect,
  entersCutout,
  footprintOutline,
  isFootprintCutout,
  MIN_WING_SIZE,
  rotatedHalfExtents,
  sameCutout,
  trimRectToCutout,
  type FootprintRect,
} from './footprint';
import { formatMetres } from './format';
import { collisionReason, type CollisionContext } from './geometry';
import { INTERIOR_WALL_THICKNESS, isOpening, isWallMounted, settleWallMountedItem } from './opening-snap';
import { regionsOutside } from './room-detect';
import { storeyHeight } from './storeys';
import { ENTRANCE_DOOR_ID, clipWallToPorch, entrancePlanOutline, entranceProblem } from './street';
import { clampZoneRect, isRoomZone, MIN_ZONE_SIZE, plainZone, regionShape, sameZone, zoneRings, zoneShapeFits } from './zones';
import type { FloorLayout, FootprintCutout, FurnitureItem, InteriorWall, RoofStyle, RoomLayout, RoomZone, Vec2 } from './types';

/**
 * What cutting a corner out of the building (#727) does to the house: why it
 * may be refused, and how every storey is brought inside the new outline. Pure,
 * so the reducer, the panel and the tests share one set of rules.
 */

/** Pitched roofs only cover a rectangle; `three/roof.ts` builds an L flat. */
export function roofCoversCutout(style: RoofStyle): boolean {
  return style !== 'gable' && style !== 'hipped';
}

export const PITCHED_ROOF_REFUSAL = 'A gable or hipped roof can’t cover an L-shaped house yet. Choose a flat roof or no roof first.';
export const PITCHED_OVER_CUTOUT_REFUSAL = 'A gable or hipped roof can’t cover an L-shaped house yet. Remove the corner cut-out first.';
export const ENTRANCE_CLASH_REFUSAL = 'That corner would cut through the recessed entrance. Move the entrance first.';

const SPOT_STEP = 0.5;
/**
 * How many spots one storey's fit tries. Each costs a collision pass over the
 * storey, and a crafted file can pile every item into the corner: once they
 * run out the rest count as stuck, which a load leaves where they stand and a
 * cut refuses.
 */
const SPOT_TRIES = 6000;

/** One storey's search: per item size, the cells already tried, and the tries spent. */
interface SpotSearch {
  tried: Map<string, Set<number>>;
  tries: number;
}

type Building = Pick<RoomLayout, 'width' | 'height'> & { cutout: FootprintCutout | undefined };

/** Whether the porch is built on `before` and the shape of `after` stops it. */
function clashesWithEntrance(before: RoomLayout, after: RoomLayout): boolean {
  if (!before.entrance || !after.entrance) return false;
  const context = (layout: RoomLayout) => ({
    width: layout.width,
    depth: layout.height,
    cutout: layout.cutout,
    floors: layout.floors,
    ...(layout.terrain ? { terrain: layout.terrain } : {}),
  });
  return entranceProblem(before.entrance, context(before)) === null && entranceProblem(after.entrance, context(after)) === 'cutout-clash';
}

/**
 * A clear spot on the storey near the item, or null. The exit from the corner
 * comes first, then the grid in widening squares around that exit, so a spot
 * near it costs no walk over the floor. A cell is tried once per item size: it
 * is taken or in the way for the next one too, so a pile spreads outwards.
 */
function clearSpot(item: FurnitureItem, items: readonly FurnitureItem[], building: Building, context: CollisionContext, search: SpotSearch): Vec2 | null {
  const { width, height, cutout } = building;
  const clear = (position: Vec2): boolean => {
    search.tries += 1;
    return collisionReason({ ...item, position }, items, width, height, context) === null;
  };
  if (search.tries >= SPOT_TRIES) return null;
  const from = item.position!;
  const exit = clampToFootprint(item, from, width, height, cutout);
  if (clear(exit)) return exit;
  const { halfW, halfD } = rotatedHalfExtents(item);
  const columns = Math.floor((width - 2 * halfW) / SPOT_STEP + 1e-9);
  const rows = Math.floor((height - 2 * halfD) / SPOT_STEP + 1e-9);
  if (columns < 0 || rows < 0) return null;
  const within = (value: number, top: number): number => Math.max(0, Math.min(top, value));
  const column = within(Math.round((exit.x + width / 2 - halfW) / SPOT_STEP), columns);
  const row = within(Math.round((exit.z + height / 2 - halfD) / SPOT_STEP), rows);
  const size = `${halfW}:${halfD}`;
  const tried = search.tried.get(size) ?? new Set<number>();
  search.tried.set(size, tried);
  for (let reach = 0; reach <= Math.max(columns, rows); reach++) {
    const cells: Array<{ key: number; spot: Vec2 }> = [];
    const add = (c: number, r: number): void => {
      const key = c * 4096 + r;
      if (r >= 0 && r <= rows && !tried.has(key)) {
        cells.push({ key, spot: { x: -width / 2 + halfW + c * SPOT_STEP, z: -height / 2 + halfD + r * SPOT_STEP } });
      }
    };
    // The square's rim: what is inside it was tried at a shorter reach.
    for (let c = Math.max(0, column - reach); c <= Math.min(columns, column + reach); c++) {
      if (Math.abs(c - column) === reach) {
        for (let r = row - reach; r <= row + reach; r++) add(c, r);
      } else {
        add(c, row - reach);
        add(c, row + reach);
      }
    }
    cells.sort((a, b) => Math.hypot(a.spot.x - from.x, a.spot.z - from.z) - Math.hypot(b.spot.x - from.x, b.spot.z - from.z));
    for (const { key, spot } of cells) {
      if (search.tries >= SPOT_TRIES) return null;
      tried.add(key);
      if (clear(spot)) return spot;
    }
  }
  return null;
}

/**
 * A partition out of the corner. One along a notch wall goes too, within its
 * own half-thickness, or it would stand half outside the wall. Others keep
 * meeting the notch walls as they do any wall.
 */
export function clipWallToCutout<W extends InteriorWall>(wall: W, notch: FootprintRect | null, takenIds: Set<string> = new Set()): W[] {
  if (!notch) return [wall];
  const half = INTERIOR_WALL_THICKNESS / 2;
  const alongX = wall.z1 === wall.z2;
  const alongZ = wall.x1 === wall.x2;
  return clipWallToPorch(
    wall,
    {
      x0: notch.x0 - (alongZ ? half : 0),
      x1: notch.x1 + (alongZ ? half : 0),
      frontZ: notch.z0 - (alongX ? half : 0),
      backZ: notch.z1 + (alongX ? half : 0),
    },
    takenIds
  );
}

/**
 * A zone on the new outline, or null when none of it is left. A rectangle keeps
 * its larger part. A polygon that fits stays as it is; one that doesn't is
 * clipped to the floor, its largest piece kept, or falls back to what's left
 * of its rectangle: never a polygon the outline can't hold. A rectangle clear
 * of the notch isn't touched, so a loaded zone stays where it was stored. With
 * `polygonsFollow` the walls are about to speak: a resize leaves polygons to
 * `followRooms`, which fits each to its room.
 */
function fitZone(zone: RoomZone, building: Building, footprint: readonly Vec2[], polygonsFollow: boolean): RoomZone | null {
  const { width, height, cutout } = building;
  const rect = (): RoomZone | null => {
    const fitted = clampZoneRect(zone, width, height, cutout);
    return fitted && { ...plainZone(zone), ...fitted };
  };
  if (!zone.outline) return trimRectToCutout(zone, cutoutRect(building)) === zone ? zone : rect();
  if (polygonsFollow || zoneShapeFits(zone, footprint)) return zone;
  const [outline, ...holes] = zoneRings(zone);
  const pieces = regionsOutside(outline!, holes, cutoutKeepOut(building)).sort((a, b) => b.area - a.area);
  const piece = pieces[0];
  const clipped = piece && piece.area >= MIN_ZONE_SIZE * MIN_ZONE_SIZE ? { ...plainZone(zone), ...regionShape(piece) } : null;
  return clipped && isRoomZone(clipped) && zoneShapeFits(clipped, footprint) ? clipped : rect();
}

interface FloorFit {
  floor: FloorLayout;
  /** An item with no clear spot left on the storey. */
  stuck: FurnitureItem | null;
  /** Two openings the fit put on top of each other. */
  clash: [FurnitureItem, FurnitureItem] | null;
}

interface FitOptions {
  /** A saved house: only what stands in the corner moves, and the rest comes back as it was stored. */
  loading?: boolean;
  /** A resize: `followRooms` fits polygon zones, from the rooms the new size leaves. */
  polygonsFollow?: boolean;
}

/** Whether two openings share a wall and overlap along it. */
function openingsOverlap(a: FurnitureItem, b: FurnitureItem): boolean {
  if (!a.position || !b.position) return false;
  const rotation = a.rotation ?? 0;
  if (Math.abs(Math.sin(rotation - (b.rotation ?? 0))) > 1e-6) return false;
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const along = Math.abs(dx * Math.cos(rotation) - dz * Math.sin(rotation));
  const across = Math.abs(dx * Math.sin(rotation) + dz * Math.cos(rotation));
  return across < INTERIOR_WALL_THICKNESS && along < (a.width + b.width) / 2 - 1e-6;
}

function fitFloor(layout: RoomLayout, floor: FloorLayout, index: number, { loading = false, polygonsFollow = false }: FitOptions = {}): FloorFit {
  const { width, height, cutout } = layout;
  const building = { width, height, cutout };
  const notch = cutoutRect(building);

  // Partitions: the corner is outside, so nothing runs through it.
  const taken = new Set((floor.interiorWalls ?? []).map((wall) => wall.id));
  const walls = floor.interiorWalls?.flatMap((wall) => clipWallToCutout(wall, notch, taken));
  const wallsChanged = walls !== undefined && (walls.length !== floor.interiorWalls?.length || walls.some((wall, i) => wall !== floor.interiorWalls?.[i]));

  // Openings resettle on the walls that are left; indoor items step out of the
  // corner, each onto a spot that is clear of those already moved. Stairs stay:
  // the cut refuses them, and only a loaded file gets here with stairs there.
  const frontGap = entrancePlanOutline(layout, index);
  const context: CollisionContext = { keepOut: floorKeepOut(layout, index), interiorWalls: walls ?? [], storeyHeight: storeyHeight(floor) };
  let itemsChanged = false;
  let stuck: FurnitureItem | null = null;
  const search: SpotSearch = { tried: new Map(), tries: 0 };
  const items = [...floor.items];
  const movedOpenings: number[] = [];
  items.forEach((item, at) => {
    if (item.id === ENTRANCE_DOOR_ID || !item.position) return;
    if (isWallMounted(item.type)) {
      if (loading && !entersCutout(item, item.position, building)) return;
      const settled = settleWallMountedItem(item, item.position, width, height, walls ?? [], frontGap, cutout);
      if (!settled) return;
      const moved = { ...item, ...settled };
      if (moved.position.x === item.position.x && moved.position.z === item.position.z && moved.rotation === item.rotation) return;
      itemsChanged = true;
      items[at] = moved;
      if (isOpening(item.type)) movedOpenings.push(at);
      return;
    }
    if (item.type === 'stairs' || item.category === 'outdoor' || !entersCutout(item, item.position, building)) return;
    const position = clearSpot(item, items, building, context, search);
    if (!position) {
      stuck ??= item;
      return;
    }
    itemsChanged = true;
    items[at] = { ...item, position };
  });

  // Zones keep the larger part of themselves; one wholly in the corner goes.
  let zonesChanged = false;
  const footprint = footprintOutline(building);
  const zones = floor.zones?.flatMap((zone) => {
    const next = fitZone(zone, building, footprint, polygonsFollow);
    if (!next) {
      zonesChanged = true;
      return [];
    }
    if (sameZone(zone, next)) return [zone];
    zonesChanged = true;
    return [next];
  });

  let clash: [FurnitureItem, FurnitureItem] | null = null;
  for (const at of movedOpenings) {
    const moved = items[at]!;
    const other = items.find((item, other) => other !== at && isOpening(item.type) && openingsOverlap(moved, item));
    if (other) {
      clash = [moved, other];
      break;
    }
  }

  if (!wallsChanged && !itemsChanged && !zonesChanged) return { floor, stuck, clash };
  const { zones: _zones, interiorWalls: _walls, ...rest } = floor;
  return {
    floor: {
      ...rest,
      items,
      ...(walls && walls.length > 0 ? { interiorWalls: walls } : {}),
      ...(zones && zones.length > 0 ? { zones } : {}),
    },
    stuck,
    clash,
  };
}

function fitFloors(layout: RoomLayout, options: FitOptions = {}): { layout: RoomLayout; stuck: FurnitureItem | null; clash: [FurnitureItem, FurnitureItem] | null } {
  let changed = false;
  let stuck: FurnitureItem | null = null;
  let clash: [FurnitureItem, FurnitureItem] | null = null;
  const floors = layout.floors.map((floor, index) => {
    const fit = fitFloor(layout, floor, index, options);
    stuck ??= fit.stuck;
    clash ??= fit.clash;
    if (fit.floor !== floor) changed = true;
    return fit.floor;
  });
  return { layout: changed ? { ...layout, floors } : layout, stuck, clash };
}

/**
 * Bring a loaded house's storeys inside `layout.cutout`. Only what stands in
 * the corner moves: a save loads as it was stored. Floors that need no change
 * keep their identity, and so does the layout when none does.
 */
export function fitFloorsToCutout(layout: RoomLayout): RoomLayout {
  return fitFloors(layout, { loading: true }).layout;
}

/** The first locked item the fit would move, comparing each storey's items by id. */
function movedLockedItem(before: RoomLayout, after: RoomLayout): FurnitureItem | null {
  for (const [index, floor] of after.floors.entries()) {
    if (floor === before.floors[index]) continue;
    for (const item of before.floors[index]?.items ?? []) {
      if (!item.locked) continue;
      const moved = floor.items.find((candidate) => candidate.id === item.id);
      if (moved && (moved.position?.x !== item.position?.x || moved.position?.z !== item.position?.z || moved.rotation !== item.rotation)) return item;
    }
  }
  return null;
}

/**
 * Take the house from `before` to the shape of `next`, or say why not. `next`
 * carries the new cut and size with its floors as they stand. Returns the
 * layout with every storey fitted, and the reason when it can't be done.
 */
export function fitNewShape(before: RoomLayout, next: RoomLayout, options: FitOptions = {}): { layout: RoomLayout; refusal: string | null } {
  if (clashesWithEntrance(before, next)) return { layout: before, refusal: ENTRANCE_CLASH_REFUSAL };
  const building = { width: next.width, height: next.height, cutout: next.cutout };
  const stairs = next.floors
    .flatMap((floor) => floor.items)
    .find((item) => item.type === 'stairs' && item.position && entersCutout(item, item.position, building));
  // Moving a flight drags the stairwell under what stands upstairs.
  if (stairs) return { layout: before, refusal: `The ${stairs.name} stands in that corner. Move it first.` };
  const fitted = fitFloors(next, options);
  if (fitted.stuck) return { layout: before, refusal: `There is no clear spot left for the ${fitted.stuck.name}. Make room or remove it first.` };
  if (fitted.clash) {
    const [moved, other] = fitted.clash;
    return { layout: before, refusal: `The ${moved.name} would land on the ${other.name}. Move one of them first.` };
  }
  const locked = movedLockedItem(next, fitted.layout);
  if (locked) return { layout: before, refusal: `The ${locked.name} is locked and would have to move. Unlock it first.` };
  return { layout: fitted.layout, refusal: null };
}

function withoutCutout(layout: RoomLayout): RoomLayout {
  const { cutout: _filled, ...rest } = layout;
  return rest;
}

/** Why this cut can't be made, or the corner filled in, or null. The reducer refuses on exactly these. */
export function cutoutRefusal(layout: RoomLayout, cutout: FootprintCutout | null): string | null {
  if (cutout === null) return fitNewShape(layout, withoutCutout(layout)).refusal;
  if (!cutoutFits(cutout, layout.width, layout.height)) {
    return `A cut-out has to leave ${formatMetres(MIN_WING_SIZE)} of house on each wing.`;
  }
  if (layout.roof && !roofCoversCutout(layout.roof.style)) return PITCHED_ROOF_REFUSAL;
  return fitNewShape(layout, { ...layout, cutout }).refusal;
}

/** Whether an item has to give way to the cut: indoors and overlapping it, or on a wall that goes. */
function inCorner(item: FurnitureItem, building: Building): boolean {
  if (!item.position || item.category === 'outdoor') return false;
  if (!isWallMounted(item.type)) return entersCutout(item, item.position, building);
  const notch = cutoutRect(building)!;
  const { x, z } = item.position;
  return x >= notch.x0 && x <= notch.x1 && z >= notch.z0 && z <= notch.z1;
}

/** The indoor items a cut would move, across every storey: the panel tells the user. */
export function itemsInCorner(layout: RoomLayout, cutout: FootprintCutout): FurnitureItem[] {
  const building = { width: layout.width, height: layout.height, cutout };
  return layout.floors.flatMap((floor) => floor.items.filter((item) => item.id !== ENTRANCE_DOOR_ID && inCorner(item, building)));
}

/** The zones a cut leaves nothing of, across every storey: the panel tells the user. */
export function zonesInCorner(layout: RoomLayout, cutout: FootprintCutout): RoomZone[] {
  const fitted = fitFloors({ ...layout, cutout }).layout;
  return layout.floors.flatMap((floor, index) =>
    (floor.zones ?? []).filter((zone) => !fitted.floors[index]?.zones?.some((kept) => kept.id === zone.id))
  );
}

/**
 * The outdoor items that end up indoors when a corner is filled in or made
 * smaller: they stood on open ground, and stay put for the player to move.
 */
export function outdoorItemsTakenIn(layout: RoomLayout, cutout: FootprintCutout | null): FurnitureItem[] {
  const after = { width: layout.width, height: layout.height, cutout };
  const notch = cutoutRect(after);
  return layout.floors
    .flatMap((floor) => floor.items)
    .filter((item) => {
      if (item.category !== 'outdoor' || !item.position || !entersCutout(item, item.position, layout)) return false;
      if (!notch) return true;
      const { halfW, halfD } = rotatedHalfExtents(item);
      const { x, z } = item.position;
      return x - halfW < notch.x0 || x + halfW > notch.x1 || z - halfD < notch.z0 || z + halfD > notch.z1;
    });
}

/** The layout with the corner cut, changed or filled back in, or the same layout when refused or unchanged. */
export function withCutout(layout: RoomLayout, requested: FootprintCutout | null): RoomLayout {
  if (requested === null) {
    if (!layout.cutout) return layout;
    return fitNewShape(layout, withoutCutout(layout)).layout;
  }
  if (!isFootprintCutout(requested) || sameCutout(layout.cutout, requested) || cutoutRefusal(layout, requested)) return layout;
  return fitNewShape(layout, { ...layout, cutout: requested }).layout;
}
