import type { DormerOpening, DormerOpeningKind, DormerSpec, RoofStyle, WallId } from './types';

/**
 * Roof dormers (#203): loft boxes standing on a roof slope, with a vertical
 * face carrying real openings. Everything here is pure — the slope maths,
 * the clamping that keeps a dormer on its slope, and the opening layout —
 * so three/dormers.ts only turns the numbers into meshes.
 *
 * Local frame: every dormer is laid out as if its slope faced north (−z),
 * with x along the ridge; the builder rotates it onto its real side.
 */

/** Must match three/roof.ts — how far the roof overhangs the walls. */
export const ROOF_EAVE_OVERHANG = 0.35;

export const MAX_DORMERS = 6;
export const MAX_DORMER_OPENINGS = 8;
export const MIN_DORMER_WIDTH = 0.6;
export const MAX_DORMER_WIDTH = 8;
export const MIN_DORMER_HEIGHT = 0.8;
export const MAX_DORMER_HEIGHT = 2.5;
export const MAX_DORMER_SETBACK = 2;
export const DEFAULT_DORMER_HEIGHT = 1.4;
export const DEFAULT_DORMER_SETBACK = 0.3;
export const DORMER_OPENING_KINDS: readonly DormerOpeningKind[] = ['casement', 'french', 'sidelight'];
export const DORMER_SIDES: readonly WallId[] = ['north', 'south', 'east', 'west'];

/** Headroom kept between a dormer's flat top and the ridge. */
const RIDGE_CLEARANCE = 0.15;
/** Keeps a dormer's cheeks inside the walls (and off the hips). */
const SIDE_MARGIN = 0.2;
/** A face shorter than this isn't worth building. */
const MIN_FACE_HEIGHT = 0.5;

// ---------------------------------------------------------------------------
// Presets (what the Roof panel offers)
// ---------------------------------------------------------------------------

export type DormerPreset = 'window' | 'casements' | 'french' | 'juliet';

export const DORMER_PRESET_LABELS: Record<DormerPreset, string> = {
  window: 'Ribbon window',
  casements: 'Casement pair',
  french: 'French doors + side lights',
  juliet: 'French doors + Juliet balcony',
};

const FRENCH_WITH_SIDELIGHTS: DormerOpening[] = [
  { kind: 'sidelight', from: 0.05, to: 0.22 },
  { kind: 'french', from: 0.28, to: 0.72 },
  { kind: 'sidelight', from: 0.78, to: 0.95 },
];

/** The fields a preset sets; applying one clears the others. */
export function dormerPresetFields(preset: DormerPreset): Pick<DormerSpec, 'window' | 'openings' | 'balcony'> {
  switch (preset) {
    case 'window':
      return { window: true, openings: undefined, balcony: undefined };
    case 'casements':
      return {
        window: undefined,
        openings: [
          { kind: 'casement', from: 0.08, to: 0.46 },
          { kind: 'casement', from: 0.54, to: 0.92 },
        ],
        balcony: undefined,
      };
    case 'french':
      return { window: undefined, openings: FRENCH_WITH_SIDELIGHTS, balcony: undefined };
    case 'juliet':
      return { window: undefined, openings: FRENCH_WITH_SIDELIGHTS, balcony: true };
  }
}

/** Which preset a dormer matches, or null for a hand-written (imported) one. */
export function dormerPresetOf(dormer: DormerSpec): DormerPreset | null {
  const presets: DormerPreset[] = ['window', 'casements', 'french', 'juliet'];
  return (
    presets.find((preset) => {
      const fields = dormerPresetFields(preset);
      return (
        (dormer.window === true) === (fields.window === true) &&
        (dormer.balcony === true) === (fields.balcony === true) &&
        JSON.stringify(dormer.openings ?? null) === JSON.stringify(fields.openings ?? null)
      );
    }) ?? null
  );
}

// ---------------------------------------------------------------------------
// Validation + clamping
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function isDormerOpening(value: unknown): value is DormerOpening {
  if (!isPlainObject(value)) return false;
  return (
    DORMER_OPENING_KINDS.includes(value.kind as DormerOpeningKind) &&
    inRange(value.from, 0, 1) &&
    inRange(value.to, 0, 1) &&
    (value.from as number) < (value.to as number)
  );
}

export function isDormerSpec(value: unknown): value is DormerSpec {
  if (!isPlainObject(value)) return false;
  const v = value;
  if (typeof v.id !== 'string') return false;
  if (!DORMER_SIDES.includes(v.side as WallId)) return false;
  if (!inRange(v.width, MIN_DORMER_WIDTH, MAX_DORMER_WIDTH)) return false;
  if (v.offset !== undefined && !inRange(v.offset, -100, 100)) return false;
  if (v.height !== undefined && !inRange(v.height, MIN_DORMER_HEIGHT, MAX_DORMER_HEIGHT)) return false;
  if (v.setback !== undefined && !inRange(v.setback, 0, MAX_DORMER_SETBACK)) return false;
  if (v.color !== undefined && typeof v.color !== 'string') return false;
  if (v.window !== undefined && typeof v.window !== 'boolean') return false;
  if (v.balcony !== undefined && typeof v.balcony !== 'boolean') return false;
  if (v.openings !== undefined) {
    if (!Array.isArray(v.openings) || v.openings.length > MAX_DORMER_OPENINGS) return false;
    if (!v.openings.every(isDormerOpening)) return false;
  }
  return true;
}

const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Clamp a dormer's numbers into range (reducer-side, like room dimensions). */
export function clampDormer(dormer: DormerSpec): DormerSpec {
  const next: DormerSpec = { ...dormer, width: clamp(dormer.width, MIN_DORMER_WIDTH, MAX_DORMER_WIDTH, 2) };
  if (dormer.offset !== undefined) next.offset = clamp(dormer.offset, -100, 100, 0);
  if (dormer.height !== undefined) {
    next.height = clamp(dormer.height, MIN_DORMER_HEIGHT, MAX_DORMER_HEIGHT, DEFAULT_DORMER_HEIGHT);
  }
  if (dormer.setback !== undefined) {
    next.setback = clamp(dormer.setback, 0, MAX_DORMER_SETBACK, DEFAULT_DORMER_SETBACK);
  }
  for (const key of ['openings', 'window', 'balcony', 'color', 'offset', 'height', 'setback'] as const) {
    if (next[key] === undefined) delete next[key];
  }
  return next;
}

// ---------------------------------------------------------------------------
// Slope geometry
// ---------------------------------------------------------------------------

interface RoofSlope {
  /** Rise from the eaves to the ridge / apex. */
  peak: number;
  /** Horizontal run from the ridge line to the eave edge (overhang included). */
  halfRun: number;
  /** Half the wall length under this slope. */
  wallHalfRun: number;
  /** Half the slope's length along the ridge at the eaves (overhang included). */
  halfAlong: number;
  /** Half the wall length along the ridge. */
  wallHalfAlong: number;
  /** A hipped face narrows to the apex; a gable slope doesn't. */
  tapers: boolean;
}

/**
 * The slope on one side of the roof, or null when that side has none: flat
 * and absent roofs have no slopes, and a gable only slopes on its two long
 * sides (its ends are vertical gables). Mirrors three/roof.ts.
 */
export function roofSlope(style: RoofStyle, width: number, depth: number, side: WallId): RoofSlope | null {
  const northSouth = side === 'north' || side === 'south';
  const wallHalfRun = (northSouth ? depth : width) / 2;
  const wallHalfAlong = (northSouth ? width : depth) / 2;
  const halfRun = wallHalfRun + ROOF_EAVE_OVERHANG;
  const halfAlong = wallHalfAlong + ROOF_EAVE_OVERHANG;
  if (style === 'gable') {
    const ridgeAlongX = width >= depth;
    if (ridgeAlongX !== northSouth) return null;
    return { peak: Math.min(2.5, halfRun), halfRun, wallHalfRun, halfAlong, wallHalfAlong, tapers: false };
  }
  if (style === 'hipped') {
    const w = width + ROOF_EAVE_OVERHANG * 2;
    const d = depth + ROOF_EAVE_OVERHANG * 2;
    const peak = Math.min(2.2, Math.min(w, d) * 0.45);
    return { peak, halfRun, wallHalfRun, halfAlong, wallHalfAlong, tapers: true };
  }
  return null;
}

export function roofSlopeSides(style: RoofStyle, width: number, depth: number): WallId[] {
  return DORMER_SIDES.filter((side) => roofSlope(style, width, depth, side) !== null);
}

/** Where a dormer actually sits, in its local (north-facing) frame. */
export interface DormerFrame {
  /** Rotation about Y that turns the local frame onto the dormer's side. */
  rotationY: number;
  /** Centre of the face along the ridge (local x). */
  centerX: number;
  width: number;
  /** Local z of the vertical face (negative: toward the eaves). */
  faceZ: number;
  /** Local z where the dormer's flat top meets the slope. */
  backZ: number;
  /** World Y of the face's foot (on the slope) and of its top. */
  bottomY: number;
  topY: number;
}

const SIDE_ROTATION: Record<WallId, number> = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 };

/**
 * Local x for a dormer's `offset`, which is measured along the world axis the
 * ridge runs on (x for north/south slopes, z for east/west), so the same
 * offset lines dormers up across a roof whichever side they're on.
 */
function localX(side: WallId, offset: number): number {
  return side === 'north' || side === 'east' ? offset : -offset;
}

/**
 * Fit a dormer onto its slope: the face stands `setback` behind the wall
 * line, its foot on the slope; the height is trimmed to clear the ridge, the
 * width and offset to stay inside the walls (and, on a hipped roof, inside
 * the narrowing face). Null when the side has no slope or nothing fits.
 */
export function dormerFrame(
  style: RoofStyle,
  roomWidth: number,
  roomDepth: number,
  baseY: number,
  dormer: DormerSpec
): DormerFrame | null {
  const slope = roofSlope(style, roomWidth, roomDepth, dormer.side);
  if (!slope) return null;
  const surfaceY = (z: number) => baseY + slope.peak * (1 - Math.abs(z) / slope.halfRun);

  const setback = Math.min(dormer.setback ?? DEFAULT_DORMER_SETBACK, slope.wallHalfRun * 0.8);
  const faceZ = -(slope.wallHalfRun - setback);
  const bottomY = surfaceY(faceZ);
  const height = Math.min(dormer.height ?? DEFAULT_DORMER_HEIGHT, baseY + slope.peak - RIDGE_CLEARANCE - bottomY);
  if (height < MIN_FACE_HEIGHT) return null;
  const topY = bottomY + height;
  const backZ = -slope.halfRun * (1 - (topY - baseY) / slope.peak);

  // A hipped face narrows linearly to the apex; the top corners are the
  // tightest point.
  const along = slope.tapers
    ? Math.min(slope.wallHalfAlong, slope.halfAlong * (1 - (topY - baseY) / slope.peak))
    : slope.wallHalfAlong;
  const halfAvailable = along - SIDE_MARGIN;
  if (halfAvailable * 2 < MIN_DORMER_WIDTH) return null;
  const width = Math.min(dormer.width, halfAvailable * 2);
  const maxCenter = halfAvailable - width / 2;
  const centerX = Math.max(-maxCenter, Math.min(maxCenter, localX(dormer.side, dormer.offset ?? 0)));

  return { rotationY: SIDE_ROTATION[dormer.side], centerX, width, faceZ, backZ, bottomY, topY };
}

// ---------------------------------------------------------------------------
// Openings on the face
// ---------------------------------------------------------------------------

export interface DormerOpeningRect {
  kind: DormerOpeningKind;
  /** Face-local: x from the face centre, y from the face foot. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const HEAD_GAP = 0.12;
const FOOT_GAP = 0.05;
const MIN_OPENING = 0.2;

/** The ribbon `window` shorthand — one long casement band. */
const RIBBON: DormerOpening[] = [{ kind: 'casement', from: 0.1, to: 0.9 }];

/**
 * Lay a dormer's openings out on a face of the given size. `openings` wins;
 * otherwise the `window` shorthand is a ribbon casement through the same
 * path. Doors and side lights run floor-to-head; casements sit on a sill.
 */
export function dormerOpeningRects(dormer: DormerSpec, faceWidth: number, faceHeight: number): DormerOpeningRect[] {
  const openings = dormer.openings ?? (dormer.window ? RIBBON : []);
  const rects: DormerOpeningRect[] = [];
  const top = faceHeight - HEAD_GAP;
  for (const opening of openings) {
    const x0 = (opening.from - 0.5) * faceWidth;
    const x1 = (opening.to - 0.5) * faceWidth;
    const y0 = opening.kind === 'casement' ? Math.max(FOOT_GAP, faceHeight * 0.3) : FOOT_GAP;
    if (x1 - x0 < MIN_OPENING || top - y0 < MIN_OPENING) continue;
    // Overlapping openings would cut overlapping holes; keep the first.
    if (rects.some((rect) => x0 < rect.x1 && x1 > rect.x0)) continue;
    rects.push({ kind: opening.kind, x0, x1, y0, y1: top });
  }
  return rects;
}

/** The span a Juliet rail guards: the French doors, else the whole face. */
export function julietRailSpan(rects: readonly DormerOpeningRect[], faceWidth: number): [number, number] {
  const doors = rects.filter((rect) => rect.kind === 'french');
  if (doors.length === 0) return [-faceWidth / 2 + 0.05, faceWidth / 2 - 0.05];
  return [Math.min(...doors.map((d) => d.x0)) - 0.05, Math.max(...doors.map((d) => d.x1)) + 0.05];
}
