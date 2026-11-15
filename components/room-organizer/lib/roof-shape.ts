import type { RoofRidge, RoofStyle, WallId } from './types';

/**
 * The shape of the house roof (#916): how high it rises and which way a
 * gable's ridge runs. One pure module that the roof builder, the dormer
 * fitting (lib/dormers.ts), the GLB export and the camera framing all read,
 * so the slope a dormer stands on is the slope that is built.
 */

/** How far the roof overhangs past the wall plane (metres). */
export const ROOF_EAVE_OVERHANG = 0.35;
/** A flat roof's slab, which is its whole rise. */
export const FLAT_ROOF_THICKNESS = 0.2;

/** The pitch multiplier's range; 1 is the roof as it always was. */
export const MIN_ROOF_PITCH = 0.5;
export const MAX_ROOF_PITCH = 1.6;
export const DEFAULT_ROOF_PITCH = 1;

/** The roof fields that set its shape; a `RoofSpec` is one. */
export interface RoofShape {
  style: RoofStyle;
  /** Multiplier on the peak height; absent is 1. */
  pitch?: number | undefined;
  /** The gable ridge's world axis; absent runs it along the longer side. */
  ridge?: RoofRidge | undefined;
}

/** A shape, or a bare style for the roof at its default pitch and ridge. */
export type RoofShapeInput = RoofStyle | RoofShape;

export function roofShapeOf(input: RoofShapeInput): RoofShape {
  return typeof input === 'string' ? { style: input } : input;
}

/** A pitch brought into range; anything not a finite number is the default. */
export function clampRoofPitch(pitch: unknown): number {
  if (typeof pitch !== 'number' || !Number.isFinite(pitch)) return DEFAULT_ROOF_PITCH;
  return Math.min(MAX_ROOF_PITCH, Math.max(MIN_ROOF_PITCH, pitch));
}

/**
 * Whether the gable ridge runs along world x. Without a choice it runs along
 * the longer side, so the slopes shed water from the long sides. Only a gable
 * has a ridge; for the other styles the answer is that same default.
 */
export function ridgeAlongX(roof: RoofShapeInput, width: number, depth: number): boolean {
  const shape = roofShapeOf(roof);
  if (shape.style === 'gable' && shape.ridge) return shape.ridge === 'x';
  return width >= depth;
}

/**
 * Rise of the roof above its base for a footprint: the gable ridge or the
 * hipped apex (a flat roof is its slab). A gable rises half the span across
 * its ridge, at most 2.5 m; the hipped pyramid 0.45 of its shorter side, at
 * most 2.2 m; then the pitch scales either.
 */
export function roofPeakHeight(roof: RoofShapeInput, width: number, depth: number): number {
  const shape = roofShapeOf(roof);
  const w = width + ROOF_EAVE_OVERHANG * 2;
  const d = depth + ROOF_EAVE_OVERHANG * 2;
  const pitch = shape.pitch === undefined ? DEFAULT_ROOF_PITCH : clampRoofPitch(shape.pitch);
  switch (shape.style) {
    case 'gable': {
      const span = ridgeAlongX(shape, width, depth) ? d : w;
      return Math.min(2.5, span * 0.5) * pitch;
    }
    case 'hipped':
      return Math.min(2.2, Math.min(w, d) * 0.45) * pitch;
    case 'flat':
      return FLAT_ROOF_THICKNESS;
    case 'none':
      return 0;
  }
}

/**
 * The steepest slope's angle in degrees, for the panel to name the pitch: a
 * gable's across its ridge, a hipped roof's over its shorter side. 0 for a
 * flat roof or none.
 */
export function roofPitchDegrees(roof: RoofShapeInput, width: number, depth: number): number {
  const shape = roofShapeOf(roof);
  if (shape.style !== 'gable' && shape.style !== 'hipped') return 0;
  const w = width + ROOF_EAVE_OVERHANG * 2;
  const d = depth + ROOF_EAVE_OVERHANG * 2;
  const run = shape.style === 'gable' ? (ridgeAlongX(shape, width, depth) ? d : w) / 2 : Math.min(w, d) / 2;
  return (Math.atan2(roofPeakHeight(shape, width, depth), run) * 180) / Math.PI;
}

/** Whether the roof slopes down to `side`: a gable to its two eaves, a hipped roof to all four, a flat one to none. */
export function roofSlopes(roof: RoofShapeInput, width: number, depth: number, side: WallId): boolean {
  const shape = roofShapeOf(roof);
  if (shape.style === 'hipped') return true;
  if (shape.style !== 'gable') return false;
  const northSouth = side === 'north' || side === 'south';
  return ridgeAlongX(shape, width, depth) === northSouth;
}

/**
 * Where a dormer goes when a gable's ridge turns: to the slope across the
 * other axis. North and east swap, as do south and west, so turning the
 * ridge back returns every dormer to its side.
 */
export const TURNED_SIDE: Record<WallId, WallId> = { north: 'east', east: 'north', south: 'west', west: 'south' };

/**
 * Whether party-wall neighbours stand against our east or west wall (#916).
 * A north–south ridge would then run our eaves, and any dormer on those
 * slopes, into the attached houses, so the reducer refuses it.
 */
export function partyWallsHoldRidge(neighbours: { west?: boolean | undefined; east?: boolean | undefined } | undefined): boolean {
  return neighbours?.west === true || neighbours?.east === true;
}
