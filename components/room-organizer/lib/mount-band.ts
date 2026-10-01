import { windowSillHeight } from './street';
import type { FurnitureItem } from './types';

/**
 * Wall-hung decor (#376): items that hang on a wall above the floor rather
 * than standing on it. Their mesh builders bake the hanging height in, so
 * every other layer — collision, the walker, the 2D draw order, the 3D
 * selection outline — reads it from `mountBand` instead.
 */
const WALL_HUNG_TYPES: ReadonlySet<string> = new Set(['painting', 'mirror', 'wall-shelf', 'wall-clock', 'curtains']);

export function isWallHung(type: string): boolean {
  return WALL_HUNG_TYPES.has(type);
}

/** Vertical extent of an item's mesh above its floor, in metres. */
export interface MountBand {
  bottom: number;
  top: number;
}

// Mirrors the hanging heights in three/builders/builders-decor.ts.
const PAINTING_MOUNT_Y = 0.8;
const MIRROR_MOUNT_Y = 0.4;
const WALL_CLOCK_MOUNT_Y = 1.25;
const WALL_SHELF_MOUNT_Y = 1.1;
/** The shelf's brackets hang below the board; its ornaments stand on it. */
const WALL_SHELF_BRACKET_DROP = 0.11;
const WALL_SHELF_ORNAMENT_RISE = 0.22;
/** Curtain panels hang from just under the rod for 95 % of the item height. */
const CURTAIN_PANEL_TOP_OFFSET = 0.06;
const CURTAIN_PANEL_FRACTION = 0.95;

/**
 * Where an item's mesh sits vertically: wall-hung decor at its hanging
 * height, a window from its sill, anything else from the floor up.
 */
export function mountBand(item: Pick<FurnitureItem, 'type' | 'height' | 'sillHeight'>): MountBand {
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
    case 'window': {
      const sill = windowSillHeight(item);
      return { bottom: sill, top: sill + height };
    }
    default:
      return { bottom: 0, top: height };
  }
}
