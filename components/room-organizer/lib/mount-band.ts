import { windowSillHeight } from './street';
import { FLOOR_HEIGHT_METERS, type FurnitureItem } from './types';

/**
 * Hung items (#376, #470): decor that hangs on a wall, and the pendant light
 * that hangs from the ceiling, above the floor rather than standing on it.
 * Their mesh builders read the hanging heights below, so the mesh and every
 * other layer — collision, the walker, the 2D draw order, the 3D selection
 * outline — agree through `mountBand` (#471).
 */
const HUNG_TYPES: ReadonlySet<string> = new Set([
  'painting',
  'mirror',
  'wall-shelf',
  'wall-clock',
  'curtains',
  'pendant-light',
]);

/** Whether an item hangs above the floor (on a wall or from the ceiling). */
export function isWallHung(type: string): boolean {
  return HUNG_TYPES.has(type);
}

/** Vertical extent of an item's mesh above its floor, in metres. */
export interface MountBand {
  bottom: number;
  top: number;
}

// Hanging heights above the floor, read by three/builders/builders-decor.ts.
export const PAINTING_MOUNT_Y = 0.8;
export const MIRROR_MOUNT_Y = 0.4;
export const WALL_CLOCK_MOUNT_Y = 1.25;
export const WALL_SHELF_MOUNT_Y = 1.1;
/** The shelf's brackets hang below the board; its ornaments stand on it. */
export const WALL_SHELF_BRACKET_DROP = 0.11;
export const WALL_SHELF_ORNAMENT_RISE = 0.22;
/** Curtain panels hang from just under the rod for 95 % of the item height. */
export const CURTAIN_PANEL_TOP_OFFSET = 0.06;
export const CURTAIN_PANEL_FRACTION = 0.95;

/**
 * How far a pendant light drops from the ceiling (#470): its item height,
 * never more than the storey, so on a low storey it stops at the floor.
 */
function pendantDrop(item: Pick<FurnitureItem, 'height'>, storeyHeight: number = FLOOR_HEIGHT_METERS): number {
  return Math.max(0, Math.min(item.height, storeyHeight));
}

/**
 * Where an item's mesh sits vertically: wall-hung decor at its hanging
 * height, a pendant light down from the ceiling of a storey `storeyHeight`
 * tall, a window from its sill, anything else from the floor up.
 */
export function mountBand(
  item: Pick<FurnitureItem, 'type' | 'height' | 'sillHeight'>,
  storeyHeight: number = FLOOR_HEIGHT_METERS
): MountBand {
  const { height } = item;
  switch (item.type) {
    case 'painting':
      return { bottom: PAINTING_MOUNT_Y, top: PAINTING_MOUNT_Y + height };
    case 'mirror':
      return { bottom: MIRROR_MOUNT_Y, top: MIRROR_MOUNT_Y + height };
    case 'wall-clock':
      return { bottom: WALL_CLOCK_MOUNT_Y, top: WALL_CLOCK_MOUNT_Y + height };
    case 'wall-shelf':
      return {
        bottom: WALL_SHELF_MOUNT_Y - WALL_SHELF_BRACKET_DROP,
        top: WALL_SHELF_MOUNT_Y + height + WALL_SHELF_ORNAMENT_RISE,
      };
    case 'curtains':
      return {
        bottom: Math.max(0, height * (1 - CURTAIN_PANEL_FRACTION) - CURTAIN_PANEL_TOP_OFFSET),
        top: height,
      };
    case 'pendant-light':
      return { bottom: storeyHeight - pendantDrop(item, storeyHeight), top: storeyHeight };
    case 'window': {
      const sill = windowSillHeight(item);
      return { bottom: sill, top: sill + height };
    }
    default:
      return { bottom: 0, top: height };
  }
}
