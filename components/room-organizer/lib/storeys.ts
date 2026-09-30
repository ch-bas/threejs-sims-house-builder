import { windowSillHeight } from './street';
import { FLOOR_HEIGHT_METERS, type FloorLayout, type FurnitureItem } from './types';

/**
 * Per-storey heights (#202). A floor without `height` is the classic 3 m
 * storey, so legacy layouts and share links stack exactly as before; a
 * floor can instead be a 2.5 m basement or a 1.1 m loft knee wall. Every
 * vertical seam — shell, furniture, overlays, lamps, drag plane, walkthrough
 * eye, camera target, roof base, stair rise — reads its Y from here instead
 * of assuming `floorIndex × 3`.
 */
export const MIN_STOREY_HEIGHT = 1;
export const MAX_STOREY_HEIGHT = 6;

/** Interior partitions stop short of the ceiling by this much (2.6 m in a 3 m storey). */
const INTERIOR_WALL_CEILING_GAP = 0.4;

type StoreyFloor = Pick<FloorLayout, 'height'>;

export function isStoreyHeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_STOREY_HEIGHT &&
    value <= MAX_STOREY_HEIGHT
  );
}

export function clampStoreyHeight(value: number): number {
  if (!Number.isFinite(value)) return FLOOR_HEIGHT_METERS;
  return Math.min(MAX_STOREY_HEIGHT, Math.max(MIN_STOREY_HEIGHT, value));
}

/** Floor-to-floor height of one storey, in metres. */
export function storeyHeight(floor: StoreyFloor | undefined): number {
  return floor?.height ?? FLOOR_HEIGHT_METERS;
}

/**
 * World Y of a storey's floor: the heights of every storey below it summed.
 * `index === floors.length` is the top of the building (the roof base).
 */
export function floorElevation(floors: readonly StoreyFloor[], index: number): number {
  let y = 0;
  const top = Math.min(index, floors.length);
  for (let i = 0; i < top; i++) y += storeyHeight(floors[i]);
  return y;
}

/** Eaves height: where the roof sits. */
export function buildingHeight(floors: readonly StoreyFloor[]): number {
  return floorElevation(floors, floors.length);
}

/** Height of interior partitions on a storey — a ceiling gap below it, never taller than the storey. */
export function interiorWallHeight(floor: StoreyFloor | undefined): number {
  const height = storeyHeight(floor);
  return Math.max(height - INTERIOR_WALL_CEILING_GAP, height * 0.6);
}

/**
 * The rise a staircase is built with. Stairs bridge to the storey above,
 * so on a floor with an explicit height they climb exactly that; on a
 * classic storey they keep their own height, exactly as before.
 */
export function stairRise(item: { height: number }, floor: StoreyFloor | undefined): number {
  return floor?.height ?? item.height;
}

/**
 * A wall opening keeps this much wall above it, so a storey-high cut never
 * splits the shell in two (bad for earcut) and a door has a lintel.
 */
export const OPENING_HEAD_CLEARANCE = 0.05;
/**
 * A wall camera's mount run (its item height) stops this far below the
 * ceiling instead: the head sits 10 cm below the run's top and reaches
 * 15 cm above its mount point, so this keeps it clear of the ceiling.
 */
export const CAMERA_CEILING_CLEARANCE = 0.15;

export interface FittedOpening {
  /** Height of the opening's bottom above its floor. */
  sill: number;
  height: number;
}

/**
 * A door, window or wall camera fitted into a storey (#277). The wall holes
 * were already clamped to the storey; the meshes weren't, so on a 2 m storey
 * a door poked through the ceiling and a window frame sat 10 cm above its
 * hole. Both now read this: a window whose sill leaves no room drops its
 * sill first, then anything still too tall is cut down to the head
 * clearance. A classic 3 m storey is unchanged for every catalog item.
 */
export function fitOpeningToStorey(
  item: Pick<FurnitureItem, 'type' | 'height' | 'sillHeight'>,
  storeyHeight: number
): FittedOpening {
  const sill = item.type === 'window' ? Math.max(0, Math.min(storeyHeight - item.height, windowSillHeight(item))) : 0;
  const clearance = item.type === 'security-camera' ? CAMERA_CEILING_CLEARANCE : OPENING_HEAD_CLEARANCE;
  const height = Math.max(0, Math.min(item.height, storeyHeight - sill - clearance));
  return { sill, height };
}

/**
 * The item its mesh builder draws on a storey: stairs climb to the floor
 * above whatever the storey's height (#202); doors, windows and wall cameras
 * are fitted into it (#277), the camera's height being its wall-mount run.
 * Everything else is built as is.
 */
export function itemForStorey(item: FurnitureItem, floor: StoreyFloor | undefined): FurnitureItem {
  switch (item.type) {
    case 'stairs':
      return { ...item, height: stairRise(item, floor) };
    case 'door':
    case 'security-camera':
      return { ...item, height: fitOpeningToStorey(item, storeyHeight(floor)).height };
    case 'window': {
      const fitted = fitOpeningToStorey(item, storeyHeight(floor));
      return { ...item, height: fitted.height, sillHeight: fitted.sill };
    }
    default:
      return item;
  }
}
