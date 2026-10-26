import { stairRise, storeyHeight } from './storeys';
import type { FloorLayout, FurnitureItem, StairsShape } from './types';

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

const localRect = (x0: number, x1: number, z0: number, z1: number): StairwellRect => ({
  centerX: (x0 + x1) / 2,
  centerZ: (z0 + z1) / 2,
  width: x1 - x0,
  depth: z1 - z0,
});

/**
 * The part of the floor above that has to go, as one or two rectangles in
 * the stair's local frame (#205, #572): over every tread that comes within
 * the headroom of the ceiling, with a small margin — except at the top of
 * the flight, where the floor above meets the top tread flush, or the
 * walker would have a gap to cross onto the landing. Empty when no tread
 * needs it (a very short flight under a tall storey). `ceiling` is the
 * height of the floor above, the storey's — not the stair's own rise, or a
 * shortened stair would cut a bigger hole (#366).
 *
 * A straight flight's hole is one rectangle. A winder's is the return
 * flight from its top, plus the fan, plus the top of the up flight when it
 * reaches that far: one leg per half of the width, an L, so the floor stays
 * over the foot of the up flight. The legs are axis-aligned in the stair's
 * frame, so when the cut starts part-way round the fan the hole takes the
 * whole quarter of the fan that winder lies in — the hole, the furniture
 * keep-out and the walker's floor are all these same rectangles (#572).
 */
export function stairwellParts(item: StairItem, rise: number, ceiling = rise): StairwellRect[] {
  const steps = stairSteps(item, rise);
  const first = steps.findIndex((step) => step.top > ceiling - STAIR_HEADROOM);
  if (first < 0) return [];
  const m = HOLE_MARGIN;
  const zsOf = (i: number) => steps[i]!.outline.map(([, z]) => z);
  const layout = winderLayout(item);
  if (!layout) {
    // A straight flight climbs +z: its top is the far end.
    const hw = item.width / 2;
    return [localRect(-hw - m, hw + m, Math.min(...zsOf(first)) - m, item.depth / 2)];
  }
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const { up, fanZ } = layout;
  // The return flight climbs toward −z: its top is its foot on the plan.
  const returnTop = Math.min(...zsOf(steps.length - 1));
  if (first >= up + WINDER_TREADS) {
    // Only part of the return flight: a strip on the +x half.
    return [localRect(-m, hw + m, returnTop, Math.max(...zsOf(first)) + m)];
  }
  if (first >= up + WINDER_TREADS / 2) {
    // From a winder in the fan's +x quarter: that quarter and the return flight.
    return [localRect(-m, hw + m, returnTop, hd + m)];
  }
  // From part-way up the up flight (or the fan's −x quarter) round to the top.
  const upFrom = first < up ? Math.min(...zsOf(first)) : fanZ;
  return [localRect(-hw - m, 0, upFrom - m, hd + m), localRect(0, hw + m, returnTop, hd + m)];
}

const rectBounds = (part: StairwellRect) => ({
  x0: part.centerX - part.width / 2,
  x1: part.centerX + part.width / 2,
  z0: part.centerZ - part.depth / 2,
  z1: part.centerZ + part.depth / 2,
});

/**
 * The stairwell as one local rectangle around `stairwellParts`, or null when
 * no tread needs headroom.
 */
export function stairwellRect(item: StairItem, rise: number, ceiling = rise): StairwellRect | null {
  const parts = stairwellParts(item, rise, ceiling).map(rectBounds);
  if (parts.length === 0) return null;
  const x0 = Math.min(...parts.map((p) => p.x0));
  const x1 = Math.max(...parts.map((p) => p.x1));
  const z0 = Math.min(...parts.map((p) => p.z0));
  const z1 = Math.max(...parts.map((p) => p.z1));
  return localRect(x0, x1, z0, z1);
}

/**
 * The winder's stairwell as an outline in the stair's local frame (#205):
 * the outline of `stairwellParts` — an L (or a notched rectangle), never
 * the box around it, or a strip on the return side.
 * Null for a straight flight (its hole is a plain rectangle) — including a
 * winder too shallow to turn, which stairSteps lays out straight (#278) —
 * or when no tread needs it.
 */
export function winderStairwellOutline(
  item: StairItem,
  rise: number,
  ceiling = rise
): Array<[number, number]> | null {
  if (!winderLayout(item)) return null;
  const parts = stairwellParts(item, rise, ceiling).map(rectBounds);
  const [a, b] = parts;
  if (!a) return null;
  if (!b) return rect(a.x0, a.x1, a.z0, a.z1);
  // The up leg (−x) and the return leg (+x) meet at x = 0, both up to the far end.
  return [
    [a.x0, a.z0],
    [a.x1, a.z0],
    [b.x0, b.z0],
    [b.x1, b.z0],
    [b.x1, b.z1],
    [a.x0, a.z1],
  ];
}

type PlacedStair = StairItem & Pick<FurnitureItem, 'rotation' | 'mirrored'> & { position: { x: number; z: number } };

/**
 * Stair-local → world [x, z]. A mirrored stair flips its local x (the
 * winder's return-flight side) before the rotation, as its mesh does
 * (`group.scale.x = −1` under `rotation.y`); the rotation is Three's rotateY,
 * which canvas-2d/render.ts reproduces with `ctx.rotate(−rotation)`.
 */
export function stairToWorld(
  item: Pick<FurnitureItem, 'rotation' | 'mirrored'>,
  position: { x: number; z: number }
): (x: number, z: number) => [number, number] {
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const { x: px, z: pz } = position;
  return (x, z) => {
    const lx = item.mirrored ? -x : x;
    return [px + lx * cos + z * sin, pz - lx * sin + z * cos];
  };
}

/** A hole in a floor plane where stairs connect floors. */
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
  /**
   * A non-rectangular hole (a winder's L, #205), as world [x, z] points. When
   * present the floor builder cuts this outline; the fields above are its
   * bounding box in the stair's frame.
   */
  outline?: Array<[number, number]>;
  /**
   * A hole of more than one rectangle (a winder's L, #572): each leg's
   * centre in world coords and its size in the stair's frame, turned by
   * `rotation` like the opening. The furniture keep-out is these legs.
   */
  parts?: Array<{ centerX: number; centerZ: number; width: number; depth: number }>;
}

/**
 * Compute stairwell openings for a given floor by looking at stairs placed
 * on the floor below. If floor N has stairs at position (x, z), floor N+1
 * should have a rectangular hole at that position. Pure: the 3D floor
 * builder cuts these, and the 2D plan and exporters draw them (#290).
 */
export function computeFloorOpenings(floorBelow: FloorLayout | undefined): readonly FloorOpening[] {
  if (!floorBelow) return [];
  const openings: FloorOpening[] = [];
  for (const item of floorBelow.items) {
    if (item.type !== 'stairs' || !item.position) continue;
    // Cut only where the treads come within 2 m headroom of this floor
    // (#205) — not the stair's whole footprint — using the same step layout
    // the builder draws, so straight and winder stairs both get the right
    // hole. The rectangle keeps the stairs' rotation so the floor builder
    // cuts it rotated (no over-inflated AABB); it clamps holes into the floor
    // outline with its epsilon inset (#146).
    const rise = stairRise(item, floorBelow);
    const ceiling = storeyHeight(floorBelow);
    const rect = stairwellRect(item, rise, ceiling);
    if (!rect) continue;
    const toWorld = stairToWorld(item, item.position);
    const [centerX, centerZ] = toWorld(rect.centerX, rect.centerZ);
    const outline = winderStairwellOutline(item, rise, ceiling);
    const parts = stairwellParts(item, rise, ceiling);
    openings.push({
      id: item.id,
      centerX,
      centerZ,
      width: rect.width,
      depth: rect.depth,
      rotation: item.rotation ?? 0,
      ...(outline ? { outline: outline.map(([x, z]) => toWorld(x, z)) } : {}),
      ...(parts.length > 1
        ? {
            parts: parts.map((part) => {
              const [x, z] = toWorld(part.centerX, part.centerZ);
              return { centerX: x, centerZ: z, width: part.width, depth: part.depth };
            }),
          }
        : {}),
    });
  }
  return openings;
}

/**
 * The opening as a closed outline in world [x, z] — the winder's L as given,
 * or the rotated rectangle's four corners — for the 2D plan and exporters
 * to draw as a void on the floor above (#290). The rectangle is rotated
 * about its own centre, which `stairToWorld` already placed, so no mirror
 * applies here.
 */
export function floorOpeningOutline(opening: FloorOpening): Array<[number, number]> {
  if (opening.outline) return opening.outline;
  const cos = Math.cos(opening.rotation);
  const sin = Math.sin(opening.rotation);
  const hw = opening.width / 2;
  const hd = opening.depth / 2;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return corners.map(([x, z]) => [opening.centerX + x * cos + z * sin, opening.centerZ - x * sin + z * cos]);
}

/** The plan symbol of a stair: its treads and the arrow that climbs them (#290). */
export interface StairPlanSymbol {
  /** Every tread's outline in world [x, z], in climbing order. */
  treads: Array<Array<[number, number]>>;
  /**
   * The walk line through the tread centres, foot first: a straight flight's
   * centreline, or the path up, round the fan and back down a winder.
   */
  walkLine: Array<[number, number]>;
}

/**
 * What a plan draws for a stair, in world metres: the tread outlines from
 * the same layout the mesh is built from, and the walk line the up-arrow
 * follows — so rotation and mirroring read the same in 2D as in 3D (#290).
 * The rise only sets the treads' heights, which a plan never shows.
 */
export function stairPlanSymbol(item: PlacedStair): StairPlanSymbol {
  const toWorld = stairToWorld(item, item.position);
  const steps = stairSteps(item, 1);
  const treads = steps.map((step) => step.outline.map(([x, z]) => toWorld(x, z)));
  const walkLine = steps.map((step) => {
    const n = step.outline.length;
    const [cx, cz] = step.outline.reduce(([sx, sz], [x, z]) => [sx + x / n, sz + z / n], [0, 0]);
    return toWorld(cx, cz);
  });
  return { treads, walkLine };
}

/**
 * The tread lines of a stair symbol as unique world segments: every tread
 * outline's edges with the ones two treads share drawn once. Duplicates are
 * matched on rounded endpoints in either direction.
 */
export function stairTreadLines(
  treads: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
): Array<[[number, number], [number, number]]> {
  const seen = new Set<string>();
  const lines: Array<[[number, number], [number, number]]> = [];
  const key = ([x, z]: readonly [number, number]) => `${x.toFixed(5)},${z.toFixed(5)}`;
  for (const outline of treads) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!;
      const b = outline[(i + 1) % outline.length]!;
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(id)) continue;
      seen.add(id);
      lines.push([[a[0], a[1]], [b[0], b[1]]]);
    }
  }
  return lines;
}
