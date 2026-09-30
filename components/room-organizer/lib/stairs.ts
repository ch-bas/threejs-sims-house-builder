import type { FurnitureItem, StairsShape } from './types';

/**
 * Stair layout (#205), shared by the stair builder and the stairwell cut so
 * the hole above always matches the steps below.
 *
 * Local frame (before the item's rotation): the flight starts at z = −depth/2
 * and climbs toward +z, like the straight builder. A winder is a half-turn
 * dog-leg: the up flight climbs the −x half, a fan of winders turns through
 * 180° at the +z end, and the return flight comes back down the +x half.
 */
export const STAIR_STEP_COUNT = 14;
export const WINDER_TREADS = 6;
export const STAIRS_SHAPES: readonly StairsShape[] = ['straight', 'winder'];
/** Longest lead-in: the return flight keeps at least one step. */
export const MAX_STAIRS_LEAD_IN = STAIR_STEP_COUNT - WINDER_TREADS - 2;
/**
 * Clear headroom over the pitch line (UK Approved Document K). The floor
 * above only needs cutting where a step comes within this of it.
 */
export const STAIR_HEADROOM = 2.0;
/** Clearance around the cut, like the old whole-footprint hole. */
const HOLE_MARGIN = 0.05;
/**
 * Shortest tread a winder keeps (#278): the going of each flight step and
 * the radius of the fan. The schema accepts any dims down to 0.1 m, so a
 * winder that is too shallow for its width has its fan clamped to what the
 * depth leaves, and one too shallow even for that lays out straight.
 */
export const MIN_WINDER_TREAD = 0.15;

export interface StairStep {
  /** Tread outline in the local frame, as [x, z] points (counter-clockwise from above). */
  outline: Array<[number, number]>;
  /** Height of the tread's top above the stair's floor. */
  top: number;
}

type StairItem = Pick<FurnitureItem, 'width' | 'depth' | 'stairsShape' | 'stairsLeadIn'>;

export function isStairsShape(value: unknown): value is StairsShape {
  return STAIRS_SHAPES.includes(value as StairsShape);
}

export function isStairsLeadIn(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_STAIRS_LEAD_IN;
}

/** Steps on the up and return flights of a winder, lead-in applied. */
export function winderFlights(leadIn = 0): { up: number; back: number } {
  const straight = STAIR_STEP_COUNT - WINDER_TREADS;
  const extra = Math.max(0, Math.min(MAX_STAIRS_LEAD_IN, Math.round(leadIn)));
  const up = Math.min(straight - 1, Math.floor(straight / 2) + extra);
  return { up, back: straight - up };
}

const rect = (x0: number, x1: number, z0: number, z1: number): Array<[number, number]> => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

export interface WinderLayout {
  up: number;
  back: number;
  /** Radius of the fan: its depth along z, at most the half-width. */
  fan: number;
  /** z of the newel, where the flights end and the fan starts. */
  fanZ: number;
  /** Going of each flight tread. */
  going: number;
}

/**
 * How a winder fits its footprint, or null when it lays out straight: not a
 * winder, or too shallow for even the shortest fan and flight (#278). The fan
 * turns about the newel at the middle of the width, where the flights end; it
 * fills the last half-width of the depth, or less when the depth would leave
 * the up flight shorter than MIN_WINDER_TREAD a tread. Every consumer of the
 * layout — treads and stairwell alike — reads the same answer here.
 */
export function winderLayout(item: StairItem): WinderLayout | null {
  if (item.stairsShape !== 'winder') return null;
  const { up, back } = winderFlights(item.stairsLeadIn);
  const hw = item.width / 2;
  const hd = item.depth / 2;
  // What the depth leaves for the fan once every up-flight tread has its
  // shortest going. (Negated comparison so a NaN dim also lays out straight.)
  const room = item.depth - up * MIN_WINDER_TREAD;
  if (!(room >= MIN_WINDER_TREAD)) return null;
  const fan = Math.min(hw, room);
  const fanZ = hd - fan;
  return { up, back, fan, fanZ, going: (fanZ + hd) / up };
}

/** Every tread of a stair of the given rise, in climbing order. */
export function stairSteps(item: StairItem, rise: number): StairStep[] {
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const stepRise = rise / STAIR_STEP_COUNT;
  const top = (i: number) => stepRise * (i + 1);

  const layout = winderLayout(item);
  if (!layout) {
    const going = item.depth / STAIR_STEP_COUNT;
    return Array.from({ length: STAIR_STEP_COUNT }, (_, i) => ({
      outline: rect(-hw, hw, -hd + i * going, -hd + (i + 1) * going),
      top: top(i),
    }));
  }

  const { up, back, fanZ, going } = layout;
  const steps: StairStep[] = [];
  for (let i = 0; i < up; i++) {
    steps.push({ outline: rect(-hw, 0, -hd + i * going, -hd + (i + 1) * going), top: top(steps.length) });
  }
  const sector = Math.PI / WINDER_TREADS;
  for (let k = 0; k < WINDER_TREADS; k++) {
    // From pointing −x (π) round through +z (π/2) to +x (0).
    const a0 = Math.PI - k * sector;
    const a1 = a0 - sector;
    steps.push({ outline: fanWedge(a0, a1, hw, fanZ, hd), top: top(steps.length) });
  }
  for (let j = 0; j < back; j++) {
    steps.push({ outline: rect(0, hw, fanZ - (j + 1) * going, fanZ - j * going), top: top(steps.length) });
  }
  return steps;
}

/**
 * One winder: the wedge between two rays from the newel (0, fanZ), clipped to
 * the fan's rectangle x ∈ [−hw, hw], z ∈ [fanZ, hd]. Picks up the far corner
 * when the wedge spans it.
 */
function fanWedge(a0: number, a1: number, hw: number, fanZ: number, hd: number): Array<[number, number]> {
  const hit = (a: number): [number, number] => {
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // Distance to the side (x = ±hw) and to the end (z = hd).
    const toSide = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity;
    const toEnd = dz > 1e-9 ? (hd - fanZ) / dz : Infinity;
    const t = Math.min(toSide, toEnd);
    return [dx * t, fanZ + dz * t];
  };
  const points: Array<[number, number]> = [[0, fanZ], hit(a0)];
  // Corner angles, measured from the newel.
  for (const corner of [[-hw, hd], [hw, hd]] as const) {
    const angle = Math.atan2(corner[1] - fanZ, corner[0]);
    if (angle < a0 - 1e-9 && angle > a1 + 1e-9) points.push([corner[0], corner[1]]);
  }
  points.push(hit(a1));
  return points;
}

export interface StairwellRect {
  /** Centre offset in the stair's local frame. */
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
}

/**
 * The part of the floor above that has to go: over every tread that comes
 * within the headroom of the ceiling, as one local rectangle (with a small
 * margin), instead of the stair's whole footprint. Null when no tread does
 * (a very short flight under a tall storey).
 */
export function stairwellRect(item: StairItem, rise: number): StairwellRect | null {
  const low = rise - STAIR_HEADROOM;
  const needed = stairSteps(item, rise).filter((step) => step.top > low);
  if (needed.length === 0) return null;
  const xs = needed.flatMap((step) => step.outline.map(([x]) => x));
  const zs = needed.flatMap((step) => step.outline.map(([, z]) => z));
  const x0 = Math.min(...xs) - HOLE_MARGIN;
  const x1 = Math.max(...xs) + HOLE_MARGIN;
  const z0 = Math.min(...zs) - HOLE_MARGIN;
  const z1 = Math.max(...zs) + HOLE_MARGIN;
  return { centerX: (x0 + x1) / 2, centerZ: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0 };
}

/**
 * The winder's stairwell as an outline in the stair's local frame (#205).
 * The treads that need headroom are always a tail of the climb, so the hole
 * is the return flight from its foot, plus the fan, plus the top of the up
 * flight when it reaches that far — an L (or a notched rectangle), never the
 * box around it, so the floor stays over the foot of the up flight.
 * Null for a straight flight (its hole is a plain rectangle) — including a
 * winder too shallow to turn, which stairSteps lays out straight (#278) —
 * or when no tread needs it.
 */
export function winderStairwellOutline(item: StairItem, rise: number): Array<[number, number]> | null {
  const layout = winderLayout(item);
  if (!layout) return null;
  const steps = stairSteps(item, rise);
  const first = steps.findIndex((step) => step.top > rise - STAIR_HEADROOM);
  if (first < 0) return null;
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const { up, fanZ } = layout;
  const m = HOLE_MARGIN;
  const zsOf = (i: number) => steps[i]!.outline.map(([, z]) => z);
  const returnFoot = Math.min(...zsOf(steps.length - 1));

  if (first >= up + WINDER_TREADS) {
    // Only part of the return flight: a strip on the +x half.
    const top = Math.max(...zsOf(first));
    return [
      [-m, returnFoot - m],
      [hw + m, returnFoot - m],
      [hw + m, top + m],
      [-m, top + m],
    ];
  }
  // From part-way up the up flight (or the fan) round to the return foot.
  const upFrom = first < up ? Math.min(...zsOf(first)) : fanZ;
  return [
    [-hw - m, upFrom - m],
    [0, upFrom - m],
    [0, returnFoot - m],
    [hw + m, returnFoot - m],
    [hw + m, hd + m],
    [-hw - m, hd + m],
  ];
}
