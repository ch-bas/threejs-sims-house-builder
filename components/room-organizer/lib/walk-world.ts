/**
 * What the first-person walker stands on (#446): the storeys' floor plates,
 * the stair treads as a ramp between them, the porch and its steps, and the
 * sloped ground of the lot outside. Pure, so the RAF loop asks it once per
 * substep and the rules are unit-tested.
 *
 * The walker carries a foot height. A move is allowed onto the highest
 * surface under its centre within one step of that height, so it climbs a
 * flight tread by tread, can't step onto a flight from the side half-way up
 * (the treads are solid down to the floor) and can't walk off a landing into
 * the stairwell. Which storey a surface belongs to decides the active floor:
 * a tread belongs to the stair's storey and a plate to its own, so the floor
 * switches at the landings.
 */

import { groundHeightAt, outdoorGroundSize } from './site';
import { STAIR_HEADROOM, STAIR_STEP_COUNT, stairSteps, stairToWorld } from './stairs';
import { stairRise, storeyHeight, floorElevation } from './storeys';
import { entranceGeometry, entranceSteps, entranceWallCut } from './street';
import type { EntranceSpec, FloorLayout, Frontage, FurnitureItem, TerrainSpec } from './types';

export type WalkSurfaceKind = 'floor' | 'tread' | 'ground';

export interface WalkSurface {
  /** World Y of the surface. */
  y: number;
  kind: WalkSurfaceKind;
  /** The storey a floor plate or a tread belongs to; -1 for ground outside. */
  floorIndex: number;
}

/** The building fields the walk world is built from. */
export interface WalkBuilding {
  width: number;
  /** Room depth (`RoomLayout.height`). */
  depth: number;
  floors: readonly Pick<FloorLayout, 'height' | 'items'>[];
  terrain?: TerrainSpec | undefined;
  entrance?: EntranceSpec | undefined;
  frontage?: Frontage | undefined;
}

/** One tread as a convex polygon in world XZ, with its world Y. */
interface Tread {
  xs: number[];
  zs: number[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  /** The storey above is cut away over this tread (its stairwell, #205). */
  cut: boolean;
  /** The flight's last tread, the one the landing above is stepped onto from. */
  top: boolean;
}

/** Where a flight starts or ends, and which way a walker leaving it faces. */
export interface StairLanding {
  x: number;
  z: number;
  /** Unit direction pointing away from the flight. */
  dirX: number;
  dirZ: number;
}

export interface WalkStair {
  id: string;
  floorIndex: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  treads: Tread[];
  /** Just past the top tread, on the storey above. */
  top: StairLanding;
  /** Just before the bottom tread, on the stair's own storey. */
  foot: StairLanding;
  /** Bounds of the hole it cuts in the storey above (its cut treads), or null. */
  hole: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
}

interface Porch {
  x0: number;
  x1: number;
  frontZ: number;
  backZ: number;
  /** Porch floor and soffit. */
  bottomY: number;
  topY: number;
  floorIndex: number;
  /** Where the steps down to the street start (the plinth ledge on the ground floor). */
  landingZ: number;
  stepCount: number;
  stepRise: number;
  stepGoing: number;
}

export interface WalkWorld {
  halfWidth: number;
  halfDepth: number;
  elevations: number[];
  storeyHeights: number[];
  stairsByFloor: WalkStair[][];
  /** The tallest step the walker takes: a stair riser, with room to spare. */
  maxStep: number;
  /**
   * Per storey, the step between its floor plate and the top tread of a
   * flight from the storey below: a stair shorter than the storey (its own
   * 2.6 m in a 3 m storey, #366) leaves a taller last step onto the landing.
   */
  landingStep: number[];
  porch: Porch | null;
  terrain: TerrainSpec | undefined;
  /** The lot the walker may roam outside the house. */
  lotHalfSize: number;
}

/** Steps up to this are always allowed (a kerb, a threshold strip). */
const BASE_STEP = 0.35;
/**
 * Crossing a threshold between the house and the lot may drop or climb this
 * much: a door onto a garden a little below the plinth, or the porch's
 * ledge. Anything more is a door in mid-air.
 */
const THRESHOLD_STEP = 1.2;
/** three/room-builder's FOUNDATION_OVERHANG: the plinth ledge in front of a ground-floor porch. */
const FOUNDATION_LEDGE = 0.35;
/** How far past the flight a landing spot sits: clear of the last tread for a 0.3 m walker. */
const LANDING_CLEARANCE = 0.55;
/** The lot edge stays this far inside the ground plane. */
const LOT_EDGE_MARGIN = 0.5;

/** Eye height above the walker's feet: 1.6 m, ducking under a low ceiling (a 1.1 m loft, #277). */
export function eyeOffsetForStorey(height: number): number {
  return Math.min(1.6, height - 0.2);
}

export function buildWalkWorld(building: WalkBuilding): WalkWorld {
  const { floors } = building;
  const halfWidth = building.width / 2;
  const halfDepth = building.depth / 2;
  const elevations = floors.map((_floor, index) => floorElevation(floors, index));
  const storeyHeights = floors.map((floor) => storeyHeight(floor));
  let maxRiser = 0;
  const landingStep = floors.map(() => 0);
  const stairsByFloor = floors.map((floor, floorIndex) => {
    const stairs: WalkStair[] = [];
    for (const item of floor.items) {
      if (item.type !== 'stairs' || !item.position) continue;
      const rise = stairRise(item, floor);
      if (floorIndex + 1 < floors.length) {
        landingStep[floorIndex + 1] = Math.max(landingStep[floorIndex + 1]!, storeyHeight(floor) - rise);
      }
      maxRiser = Math.max(maxRiser, rise / STAIR_STEP_COUNT);
      stairs.push(buildStair(item, item.position, rise, storeyHeight(floor), elevations[floorIndex]!, floorIndex));
    }
    return stairs;
  });

  let porch: Porch | null = null;
  if (building.entrance) {
    const geometry = entranceGeometry(building.entrance, {
      width: building.width,
      depth: building.depth,
      floors,
      ...(building.terrain ? { terrain: building.terrain } : {}),
    });
    if (geometry && entranceWallCut(geometry, floors, geometry.floorIndex)) {
      const steps = entranceSteps(geometry);
      porch = {
        x0: geometry.x0,
        x1: geometry.x1,
        frontZ: geometry.frontZ,
        backZ: geometry.backZ,
        bottomY: geometry.bottomY,
        topY: geometry.topY,
        floorIndex: geometry.floorIndex,
        landingZ: geometry.floorIndex === 0 ? geometry.frontZ - FOUNDATION_LEDGE : geometry.frontZ,
        stepCount: steps.count,
        stepRise: steps.rise,
        stepGoing: steps.going,
      };
    }
  }

  return {
    halfWidth,
    halfDepth,
    elevations,
    storeyHeights,
    stairsByFloor,
    maxStep: Math.max(BASE_STEP, maxRiser + 0.05),
    landingStep: landingStep.map((gap) => gap + 0.05),
    porch,
    terrain: building.terrain,
    lotHalfSize: outdoorGroundSize(building.width, building.depth) / 2 - LOT_EDGE_MARGIN,
  };
}

function buildStair(
  item: FurnitureItem,
  position: { x: number; z: number },
  rise: number,
  ceiling: number,
  floorY: number,
  floorIndex: number
): WalkStair {
  const toWorld = stairToWorld(item, position);
  const steps = stairSteps(item, rise);
  const low = ceiling - STAIR_HEADROOM;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const centroids: Array<[number, number]> = [];
  const treads = steps.map((step) => {
    const xs: number[] = [];
    const zs: number[] = [];
    let cx = 0;
    let cz = 0;
    for (const [lx, lz] of step.outline) {
      const [x, z] = toWorld(lx, lz);
      xs.push(x);
      zs.push(z);
      cx += x / step.outline.length;
      cz += z / step.outline.length;
    }
    centroids.push([cx, cz]);
    const tread: Tread = {
      xs,
      zs,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
      y: floorY + step.top,
      cut: step.top > low,
      top: false,
    };
    minX = Math.min(minX, tread.minX);
    maxX = Math.max(maxX, tread.maxX);
    minZ = Math.min(minZ, tread.minZ);
    maxZ = Math.max(maxZ, tread.maxZ);
    return tread;
  });
  const last = treads[treads.length - 1];
  if (last) last.top = true;
  const cut = treads.filter((tread) => tread.cut);
  const hole =
    cut.length > 0
      ? {
          minX: Math.min(...cut.map((tread) => tread.minX)),
          maxX: Math.max(...cut.map((tread) => tread.maxX)),
          minZ: Math.min(...cut.map((tread) => tread.minZ)),
          maxZ: Math.max(...cut.map((tread) => tread.maxZ)),
        }
      : null;
  return {
    id: item.id,
    floorIndex,
    minX,
    maxX,
    minZ,
    maxZ,
    treads,
    top: landingPast(centroids, treads.length - 1, treads.length - 2),
    foot: landingPast(centroids, 0, 1),
    hole,
  };
}

/**
 * A spot just past tread `end`, continuing the walk line away from tread
 * `previous`: off the top of the flight, or in front of its foot.
 */
function landingPast(centroids: ReadonlyArray<[number, number]>, end: number, previous: number): StairLanding {
  const [ex, ez] = centroids[end] ?? [0, 0];
  const [px, pz] = centroids[previous] ?? [ex, ez - 1];
  const length = Math.hypot(ex - px, ez - pz) || 1;
  const dirX = (ex - px) / length;
  const dirZ = (ez - pz) / length;
  return { x: ex + dirX * LANDING_CLEARANCE, z: ez + dirZ * LANDING_CLEARANCE, dirX, dirZ };
}

function insideConvex(tread: Tread, x: number, z: number): boolean {
  if (x < tread.minX || x > tread.maxX || z < tread.minZ || z > tread.maxZ) return false;
  // Even-odd crossing test: the treads are convex, but this needs no winding.
  const { xs, zs } = tread;
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const zi = zs[i]!;
    const zj = zs[j]!;
    if (zi > z !== zj > z && x < ((xs[j]! - xs[i]!) * (z - zi)) / (zj - zi) + xs[i]!) inside = !inside;
  }
  return inside;
}

/** The tread of `stairs` under (x, z), or null. */
function treadAt(stairs: readonly WalkStair[], x: number, z: number): Tread | null {
  for (const stair of stairs) {
    if (x < stair.minX || x > stair.maxX || z < stair.minZ || z > stair.maxZ) continue;
    for (const tread of stair.treads) {
      if (insideConvex(tread, x, z)) return tread;
    }
  }
  return null;
}

/** Whether a walker may move between two surfaces in one step. */
function reachable(
  world: WalkWorld,
  fromY: number,
  fromKind: WalkSurfaceKind,
  y: number,
  kind: WalkSurfaceKind,
  landing: number
): boolean {
  const limit = (fromKind === 'ground') !== (kind === 'ground') ? THRESHOLD_STEP : Math.max(world.maxStep, landing);
  return Math.abs(y - fromY) <= limit + 1e-6;
}

/** Height of the porch or its steps at (x, z), or NaN when (x, z) is neither. */
function porchHeightAt(porch: Porch, x: number, z: number): number {
  if (x < porch.x0 || x > porch.x1) return Number.NaN;
  if (z >= porch.frontZ && z <= porch.backZ) return porch.bottomY;
  if (z >= porch.landingZ && z < porch.frontZ) return porch.bottomY;
  const step = Math.floor((porch.landingZ - z) / porch.stepGoing);
  if (z < porch.landingZ && step < porch.stepCount) return porch.bottomY - step * porch.stepRise;
  return Number.NaN;
}

/** Scratch for walkSurfaceAt's running best: module state, so a query allocates nothing. */
const pick = { found: false, bestY: -Infinity };

function offer(
  world: WalkWorld,
  footY: number,
  fromKind: WalkSurfaceKind,
  y: number,
  kind: WalkSurfaceKind,
  floorIndex: number,
  out: WalkSurface,
  landing = 0
): void {
  if (y <= pick.bestY || !reachable(world, footY, fromKind, y, kind, landing)) return;
  pick.bestY = y;
  pick.found = true;
  out.y = y;
  out.kind = kind;
  out.floorIndex = floorIndex;
}

/**
 * The surface a walker whose feet are at `footY` on a `fromKind` surface
 * would stand on at (x, z): the highest one within a step. Writes it into
 * `out` and returns true; false when nothing there is reachable (a wall of
 * treads, the stairwell, a drop, the lot's edge). Allocation-free.
 */
export function walkSurfaceAt(
  world: WalkWorld,
  x: number,
  z: number,
  footY: number,
  fromKind: WalkSurfaceKind,
  out: WalkSurface
): boolean {
  pick.found = false;
  pick.bestY = -Infinity;
  const porch = world.porch;
  const inPorch = porch !== null && x >= porch.x0 && x <= porch.x1 && z >= porch.frontZ && z <= porch.backZ;
  const inside = Math.abs(x) < world.halfWidth && Math.abs(z) < world.halfDepth;

  if (inside) {
    const { elevations, stairsByFloor } = world;
    for (let i = 0; i < elevations.length; i++) {
      // A storey the porch cuts through has no floor in the recess.
      if (inPorch && elevations[i]! < porch.topY) continue;
      const tread = treadAt(stairsByFloor[i]!, x, z);
      if (tread) {
        // The flight is solid down to its floor: its tread replaces the plate.
        // A short flight's last step onto the landing may be the tallest.
        const landing = tread.top && fromKind === 'floor' ? (world.landingStep[i + 1] ?? 0) : 0;
        offer(world, footY, fromKind, tread.y, 'tread', i, out, landing);
        continue;
      }
      const below = i > 0 ? treadAt(stairsByFloor[i - 1]!, x, z) : null;
      if (below?.cut) continue; // the stairwell
      offer(world, footY, fromKind, elevations[i]!, 'floor', i, out, fromKind === 'tread' ? world.landingStep[i]! : 0);
    }
    if (inPorch) offer(world, footY, fromKind, porch.bottomY, 'ground', -1, out);
    return pick.found;
  }

  if (Math.abs(x) > world.lotHalfSize || Math.abs(z) > world.lotHalfSize) return false;
  const porchY = porch ? porchHeightAt(porch, x, z) : Number.NaN;
  const y = Number.isNaN(porchY) ? groundHeightAt(world.terrain, z, world.halfDepth) : porchY;
  offer(world, footY, fromKind, y, 'ground', -1, out);
  return pick.found;
}

function rectDistance(minX: number, maxX: number, minZ: number, maxZ: number, x: number, z: number): number {
  const dx = Math.max(minX - x, 0, x - maxX);
  const dz = Math.max(minZ - z, 0, z - maxZ);
  return Math.hypot(dx, dz);
}

/**
 * How far (x, z) is from a way between storeys on `floorIndex` (#446): the
 * footprint of a flight on it, or a stairwell cut in it by a flight from
 * below. Only from there can the walker see another storey; elsewhere the
 * ceiling and the floor hide them. Allocation-free.
 */
export function distanceToStairwell(world: WalkWorld, floorIndex: number, x: number, z: number): number {
  let best = Infinity;
  for (const stair of world.stairsByFloor[floorIndex] ?? []) {
    best = Math.min(best, rectDistance(stair.minX, stair.maxX, stair.minZ, stair.maxZ, x, z));
  }
  for (const stair of world.stairsByFloor[floorIndex - 1] ?? []) {
    const hole = stair.hole;
    if (hole) best = Math.min(best, rectDistance(hole.minX, hole.maxX, hole.minZ, hole.maxZ, x, z));
  }
  return best;
}

/** A walker this close to a stairwell sees the storey through it… */
export const STAIRWELL_VIEW_ENTER = 2.5;
/** …and keeps seeing it until this far, so the boundary doesn't flicker. */
export const STAIRWELL_VIEW_LEAVE = 3;

/**
 * Whether the storeys either side of the walker's should be drawn (#446):
 * on a flight always; on a floor near a stairwell, with hysteresis
 * (`wasNear` is the last answer).
 */
export function seesNeighbourStoreys(wasNear: boolean, kind: WalkSurfaceKind, stairwellDistance: number): boolean {
  if (kind === 'tread') return true;
  return stairwellDistance < (wasNear ? STAIRWELL_VIEW_LEAVE : STAIRWELL_VIEW_ENTER);
}

/**
 * The storey whose lamps light a walker (#446): its own, except on a
 * flight within a step of the landing above, where it is already that
 * storey's (the top tread), a step before the active floor switches.
 */
export function walkLampStorey(world: WalkWorld, walker: { y: number; kind: WalkSurfaceKind; floorIndex: number }): number {
  if (walker.kind !== 'tread') return walker.floorIndex;
  const above = world.elevations[walker.floorIndex + 1];
  if (above === undefined) return walker.floorIndex;
  // Only the top tread is within the landing's own step of the floor above.
  const step = world.landingStep[walker.floorIndex + 1] ?? 0.05;
  return walker.y >= above - step ? walker.floorIndex + 1 : walker.floorIndex;
}
