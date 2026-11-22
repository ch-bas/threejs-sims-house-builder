/**
 * The walkers' garden (#913): what the ground storey's lot is for the nav
 * (`lib/npc-path`), read off the site. The lot is the one garden surfaces
 * lie on (`groundLot`: the house plus `LOT_MARGIN` each way, the front
 * stopping at the wall on a pavement frontage), trimmed to the house and
 * the garden things with room round them, so a large lot costs a phone
 * nothing it doesn't use. The house and a margin round it are no lot; the
 * porch on the ground storey is, so its door is a way out like any door in
 * the shell. Fences, hedges, the pool and the neighbours' houses are solid;
 * garden surfaces are where a walker wanders to. Heights follow the slope
 * and the porch steps (`lib/walk-world`), and a door more than a step above
 * or below the lot is no way out.
 *
 * Out there the walkers sit on the garden bench to rest, and for fun they
 * stand at the barbecue, at the edge of the pool, or sit at the picnic
 * table, on either bench. While it rains or
 * snows, and at night, the lot is closed: nobody heads out, and anyone out
 * there comes in at the next stop. Pure; built with the nav, not per frame.
 */

import { type KeepOutBuilding, cutoutKeepOut } from './floor-keep-out';
import { LOW_PROFILE_MAX_HEIGHT, isInsideBuilding } from './footprint';
import { buildingRects, groundAt as groundPatchAt, groundLot, shownGrounds } from './grounds';
import { EXTERIOR_MARGIN, type NpcDoorway, type NpcNav, type NpcOutdoorInput, buildNpcNav, cellAt, isFreeAt, isOutdoorCell } from './npc-path';
import { type NpcSeat, findNpcSeats } from './npc-seats';
import { doorWalkSpan } from './opening-style';
import { entranceKeepOut, entrancePlanOutline } from './street';
import { type WalkCollider, boxCollider, buildShellColliders, buildStreetColliders, streetSiteOf } from './walk-collision';
import { buildWalkWorld, outsideGroundY } from './walk-world';
import type { NeedSpot } from './npc-needs';
import type { FloorLayout, Frontage, FurnitureItem, GroundPatch, NeighbourSpec, Weather } from './types';

/** The site fields the garden reads besides the building's own. */
export interface GardenSite {
  frontage?: Frontage | undefined;
  neighbours?: NeighbourSpec | undefined;
  grounds?: readonly GroundPatch[] | undefined;
}

/**
 * What the garden nav reads of a house: its storeys and footprint, the
 * porch, the street and the surfaces. Of a storey only what the shell and
 * the walk world read, so a household summary can pass a bare building.
 */
export interface GardenBuilding extends Omit<KeepOutBuilding, 'floors'>, GardenSite {
  floors: readonly Pick<FloorLayout, 'items' | 'height' | 'hiddenWalls' | 'interiorWalls'>[];
}

/** A building the walkers live in: every storey whole, and the garden's site (#913). */
export type NpcBuilding = KeepOutBuilding & GardenSite;

/** Room kept round the house and the garden things when the lot is trimmed (m). */
const LOT_PAD = 2;
/** A door's two sides are told apart this far from its wall line (m). */
const DOOR_SIDE = 0.6;
/**
 * The lot's ground rises (or falls) from the floor's height at the wall to
 * its own over this far (m), so a walker steps through a door, not up a ledge.
 */
const THRESHOLD_BLEND = 0.5;
/** Garden things that line the lot rather than draw anyone to them. */
const BOUNDARY_TYPES: ReadonlySet<string> = new Set(['fence', 'hedge']);
/** Garden seats where a walker rests: a bench is somewhere to sit down (#913). */
const GARDEN_REST_TYPES: ReadonlySet<string> = new Set(['garden-bench']);

/** The ground storey's garden things: placed outdoor items standing off the house. */
function gardenItems(building: GardenBuilding, items: readonly FurnitureItem[]): FurnitureItem[] {
  const footprint = { width: building.width, height: building.height, cutout: building.cutout };
  return items.filter(
    (item) => item.position && item.category === 'outdoor' && !isInsideBuilding(footprint, item.position.x, item.position.z)
  );
}

/**
 * Everything `gardenNavInput` reads besides the storey's items and walls
 * (which `npcNavSignature` covers), as a string: equal ones build the same lot.
 */
export function gardenSignature(building: GardenBuilding): string {
  const floor = building.floors[0];
  return JSON.stringify([
    building.terrain ?? null,
    building.entrance ?? null,
    building.frontage ?? null,
    building.neighbours ?? null,
    building.cutout ?? null,
    shownGrounds({ ...building, frontage: building.frontage }).map((g) => [g.x, g.z, g.w, g.d]),
    floor?.hiddenWalls ?? null,
    building.floors.map((f) => f.height ?? null),
  ]);
}

/**
 * The ground storey's lot for the walkers (#913), or null: on any other
 * storey, and where there is nothing in the garden to go out for (no
 * garden things and no surfaces), so the nav stays indoors and costs no more.
 */
export function gardenNavInput(building: GardenBuilding, floorIndex: number): NpcOutdoorInput | null {
  const floor = building.floors[floorIndex];
  if (floorIndex !== 0 || !floor) return null;
  const garden = gardenItems(building, floor.items);
  const grounds = shownGrounds({ ...building, frontage: building.frontage });
  if (garden.length === 0 && grounds.length === 0) return null;

  const footprint = { width: building.width, height: building.height, cutout: building.cutout };
  const porch = entrancePlanOutline(building, floorIndex);
  const inPorch = (x: number, z: number): boolean =>
    porch !== null && x > porch.x0 && x < porch.x1 && z >= porch.frontZ && z < porch.backZ;
  const indoors = (x: number, z: number): boolean => isInsideBuilding(footprint, x, z) && !inPorch(x, z);
  const rects = buildingRects(footprint);
  const blocked = (x: number, z: number): boolean => {
    // The porch is open ground up to its back wall; its cheeks are colliders.
    if (porch !== null && x > porch.x0 && x < porch.x1 && z < porch.backZ && z > porch.frontZ - EXTERIOR_MARGIN) return false;
    return rects.some(
      (r) => x > r.x0 - EXTERIOR_MARGIN && x < r.x1 + EXTERIOR_MARGIN && z > r.z0 - EXTERIOR_MARGIN && z < r.z1 + EXTERIOR_MARGIN
    );
  };

  // The lot, trimmed to the house and the garden with room round them.
  const lot = groundLot({ ...building, frontage: building.frontage });
  let minX = -building.width / 2;
  let maxX = building.width / 2;
  let minZ = -building.height / 2;
  let maxZ = building.height / 2;
  for (const item of garden) {
    const reach = Math.hypot(item.width, item.depth) / 2;
    minX = Math.min(minX, item.position!.x - reach);
    maxX = Math.max(maxX, item.position!.x + reach);
    minZ = Math.min(minZ, item.position!.z - reach);
    maxZ = Math.max(maxZ, item.position!.z + reach);
  }
  for (const g of grounds) {
    minX = Math.min(minX, g.x);
    maxX = Math.max(maxX, g.x + g.w);
    minZ = Math.min(minZ, g.z);
    maxZ = Math.max(maxZ, g.z + g.d);
  }

  const walkBuilding = {
    width: building.width,
    depth: building.height,
    floors: building.floors,
    terrain: building.terrain,
    entrance: building.entrance,
    frontage: building.frontage,
    cutout: building.cutout,
  };
  const world = buildWalkWorld(walkBuilding);
  const colliders: WalkCollider[] = [
    ...buildShellColliders(walkBuilding, floorIndex),
    ...buildStreetColliders(streetSiteOf({ ...walkBuilding, ...(building.neighbours ? { neighbours: building.neighbours } : {}) })),
  ];

  const doorways: NpcDoorway[] = [];
  for (const item of floor.items) {
    if (item.type !== 'door' || !item.position) continue;
    const rotation = item.rotation ?? 0;
    // A door's local +z is square to its wall: one side indoors, the other out.
    const nx = Math.sin(rotation);
    const nz = Math.cos(rotation);
    // The middle of the part a walker can pass: a sliding door's open side (#922).
    const [from, to] = doorWalkSpan(item);
    const along = (from + to) / 2;
    const x = item.position.x + Math.cos(rotation) * along;
    const z = item.position.z - Math.sin(rotation) * along;
    const ahead = indoors(x + nx * DOOR_SIDE, z + nz * DOOR_SIDE);
    const behind = indoors(x - nx * DOOR_SIDE, z - nz * DOOR_SIDE);
    if (ahead === behind) continue;
    doorways.push(behind ? { x, z, nx, nz } : { x, z, nx: -nx, nz: -nz });
  }
  if (doorways.length === 0) return null;

  const interest: WalkCollider[] = [];
  for (const item of garden) {
    if (BOUNDARY_TYPES.has(item.type) || item.height <= LOW_PROFILE_MAX_HEIGHT) continue;
    interest.push(boxCollider(item.position!.x, item.position!.z, item.width, item.depth, item.rotation ?? 0, true));
  }

  return {
    x0: Math.max(lot.x0, minX - LOT_PAD),
    x1: Math.min(lot.x1, maxX + LOT_PAD),
    z0: Math.max(lot.z0, minZ - LOT_PAD),
    z1: Math.min(lot.z1, maxZ + LOT_PAD),
    indoors,
    blocked,
    groundAt: (x, z) => {
      const y = outsideGroundY(world, x, z) - (world.elevations[floorIndex] ?? 0);
      // Eased in from the floor's height at the walls (#913).
      const gap = Math.min(...rects.map((r) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1))));
      return gap >= THRESHOLD_BLEND ? y : y * (gap / THRESHOLD_BLEND);
    },
    maxStep: world.maxStep,
    colliders,
    doorways,
    interest,
    wander: (x, z) => groundPatchAt(grounds, x, z) !== null,
  };
}

/**
 * The garden's hours (#913), from the scene's sun (three/lighting): it opens
 * at sunrise, 06:00, and closes when the twilight after the 18:00 sunset has
 * faded to full night, 1.5 h later.
 */
export const GARDEN_OPENS = 6;
export const GARDEN_CLOSES = 19.5;

/** Whether the walkers may go out into the garden: not in rain or snow, nor after dark (#913). True with no clock (NaN). */
export function gardenOpen(weather: Weather | undefined, hour: number): boolean {
  if ((weather ?? 'clear') !== 'clear') return false;
  if (!Number.isFinite(hour)) return true;
  const h = ((hour % 24) + 24) % 24;
  return h >= GARDEN_OPENS && h < GARDEN_CLOSES;
}

/** Where a walker stands to use the barbecue or watch the pool: this far off its edge (m). */
const STAND_GAP = 0.35;
/** The picnic table's benches: builders-outdoor.ts, a 0.2 d board centred 0.4 d out, its top at 0.55 h + 3 cm. */
const PICNIC_BENCH_OUT = 0.4;
const PICNIC_SEAT_FRACTION = 0.55;
const PICNIC_SEAT_BOARD = 0.03;
/** Places along each picnic bench: one per this many metres, as on a sofa. */
const PICNIC_SLOT_WIDTH = 0.65;
/** How far in front of a picnic bench's outer edge the walker turns round to sit (m). */
const PICNIC_APPROACH_GAP = 0.35;

/**
 * The picnic tables' seats (#913): each table has a bench either side of
 * its long axis, with a place per 0.65 m, the sitter facing the table and
 * coming in from outside the bench. The table takes as many as it has
 * places. Item ids keep the keys stable while it stays put.
 */
export function findGardenSeats(items: readonly FurnitureItem[]): NpcSeat[] {
  const seats: NpcSeat[] = [];
  for (const item of items) {
    if (item.type !== 'picnic-table' || !item.position) continue;
    const rotation = item.rotation ?? 0;
    // Local +z and +x in world space.
    const fx = Math.sin(rotation);
    const fz = Math.cos(rotation);
    const wx = Math.cos(rotation);
    const wz = -Math.sin(rotation);
    const slots = Math.max(1, Math.floor(item.width / PICNIC_SLOT_WIDTH));
    const seatHeight = Math.min(item.height, item.height * PICNIC_SEAT_FRACTION + PICNIC_SEAT_BOARD);
    for (const [side, sign] of [[0, 1], [1, -1]] as const) {
      const out = sign * PICNIC_BENCH_OUT * item.depth;
      const approach = sign * (item.depth / 2 + PICNIC_APPROACH_GAP);
      for (let slot = 0; slot < slots; slot++) {
        const along = (slot + 0.5) * (item.width / slots) - item.width / 2;
        const cx = item.position.x + wx * along;
        const cz = item.position.z + wz * along;
        seats.push({
          key: `${item.id}:p${side}-${slot}`,
          itemId: item.id,
          itemType: item.type,
          x: cx + fx * out,
          z: cz + fz * out,
          // Facing the table: in from the +z bench faces -z.
          rotation: sign > 0 ? rotation + Math.PI : rotation,
          seatHeight,
          approachX: cx + fx * approach,
          approachZ: cz + fz * approach,
          places: slots * 2,
        });
      }
    }
  }
  return seats;
}

/**
 * The garden's own spots (#913): a garden bench is somewhere to rest; the
 * barbecue (standing at its front), the pool (standing at the middle of
 * either long side, looking in) and the picnic table (sitting on either
 * bench) are fun. The seats come from `findNpcSeats` and `findGardenSeats`;
 * the rest of what meets a need is `findNeedSpots`'.
 */
export function findGardenSpots(items: readonly FurnitureItem[], seats: readonly NpcSeat[]): NeedSpot[] {
  const spots: NeedSpot[] = [];
  for (const seat of seats) {
    const rest = GARDEN_REST_TYPES.has(seat.itemType);
    if (!rest && seat.itemType !== 'picnic-table') continue;
    spots.push({
      key: seat.key,
      itemId: seat.itemId,
      itemType: seat.itemType,
      need: rest ? 'energy' : 'fun',
      x: seat.approachX,
      z: seat.approachZ,
      heading: seat.rotation,
      seatKey: seat.key,
    });
  }
  for (const item of items) {
    if (!item.position || (item.type !== 'bbq' && item.type !== 'pool')) continue;
    const rotation = item.rotation ?? 0;
    // The barbecue's front, or both long sides of the pool.
    const sides = item.type === 'bbq' ? [1] : [1, -1];
    for (const sign of sides) {
      const gap = sign * (item.depth / 2 + STAND_GAP);
      spots.push({
        key: `${item.id}:${sign > 0 ? 'front' : 'back'}`,
        itemId: item.id,
        itemType: item.type,
        need: 'fun',
        x: item.position.x + Math.sin(rotation) * gap,
        z: item.position.z + Math.cos(rotation) * gap,
        // Facing back at the item.
        heading: sign > 0 ? rotation + Math.PI : rotation,
        seatKey: null,
      });
    }
  }
  return spots;
}

/** Whether a point is out on the nav's lot: what a closed garden leaves out (#913). */
export function onTheLot(nav: NpcNav, x: number, z: number): boolean {
  return isOutdoorCell(nav, cellAt(nav, x, z));
}

/** The seats and spots indoors only: what the walkers use while the garden is closed (#913). */
export function indoorOnly<S extends NpcSeat>(
  nav: NpcNav,
  seats: ReadonlyMap<string, S>,
  spots: readonly NeedSpot[]
): { seats: ReadonlyMap<string, S>; spots: readonly NeedSpot[] } {
  if (!nav.outdoor) return { seats, spots };
  const indoorSeats = new Map<string, S>();
  for (const [key, seat] of seats) if (!onTheLot(nav, seat.approachX, seat.approachZ)) indoorSeats.set(key, seat);
  return {
    seats: indoorSeats.size === seats.size ? seats : indoorSeats,
    spots: spots.filter((spot) => !onTheLot(nav, spot.x, spot.z)),
  };
}

/**
 * The ground storey's garden spots a walker can reach from indoors (#913):
 * through a door, not fenced off. What the household summary
 * (`householdLacks`) counts besides what stands on the building. Builds
 * the storey's nav: for a panel or an edit, not per frame.
 */
export function reachableGardenSpots(building: GardenBuilding): NeedSpot[] {
  const floor = building.floors[0];
  const outdoor = gardenNavInput(building, 0);
  if (!floor || !outdoor) return [];
  const keepOut = [...entranceKeepOut(building, 0), ...cutoutKeepOut(building)];
  const nav = buildNpcNav({ items: floor.items, interiorWalls: floor.interiorWalls ?? [], keepOut, roomWidth: building.width, roomDepth: building.height, outdoor });
  if (!nav?.outdoor) return [];
  const seats = [...findNpcSeats(floor.items, { isFree: (x, z) => isFreeAt(nav, x, z), blockers: nav.colliders }), ...findGardenSeats(floor.items)];
  return findGardenSpots(floor.items, seats).filter(
    (spot) => onTheLot(nav, spot.x, spot.z) && isFreeAt(nav, spot.x, spot.z) && nav.regionIndoors[nav.region[cellAt(nav, spot.x, spot.z)]!] === 1
  );
}
