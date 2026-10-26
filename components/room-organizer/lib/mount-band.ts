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

/** Whether an item hangs from the ceiling rather than on a wall. */
export function isCeilingHung(type: string): boolean {
  return type === 'pendant-light';
}

/** Vertical extent of an item's mesh above its floor, in metres. */
export interface MountBand {
  bottom: number;
  top: number;
}

// Hanging heights above the floor on a storey tall enough for them; on a
// low one `fitHungDecor` lowers them (#610). The builders in
// three/builders/builders-decor.ts read them through it.
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

/** The pendant's shade fills this share of its drop, from the bottom up. */
export const PENDANT_SHADE_FRACTION = 0.18;
/** The bulb's centre sits this far up the shade. */
const PENDANT_BULB_RISE = 0.55;

/**
 * Height of a pendant's bulb above its storey's floor (#470): the drawn bulb
 * and the light it casts share this point.
 */
export function pendantBulbY(item: { height: number }, storeyHeight: number): number {
  const drop = pendantDrop(item, storeyHeight);
  return storeyHeight - drop + drop * PENDANT_SHADE_FRACTION * PENDANT_BULB_RISE;
}

/** Wall decor stops this far below the ceiling of its storey (#610). */
export const HUNG_CEILING_CLEARANCE = 0.05;

/** Where a piece of wall decor hangs on its storey and how tall it is drawn (`fitHungDecor`). */
export interface FittedDecor {
  /** Height of the mount point above the floor (the curtain rod hangs from the item's top: 0). */
  mount: number;
  height: number;
}

/** A decor type's authored mount point, and what its mesh reaches below and above the mount + height. */
const DECOR_MOUNTS: Readonly<Record<string, { mount: number; below: number; above: number }>> = {
  painting: { mount: PAINTING_MOUNT_Y, below: 0, above: 0 },
  mirror: { mount: MIRROR_MOUNT_Y, below: 0, above: 0 },
  'wall-clock': { mount: WALL_CLOCK_MOUNT_Y, below: 0, above: 0 },
  'wall-shelf': { mount: WALL_SHELF_MOUNT_Y, below: WALL_SHELF_BRACKET_DROP, above: WALL_SHELF_ORNAMENT_RISE },
  curtains: { mount: 0, below: 0, above: 0 },
};

/**
 * Wall decor fitted under its storey's ceiling (#610), as
 * `fitOpeningToStorey` fits doors and windows (#277): on a low storey the
 * mount point drops first (never below the floor), then anything still too
 * tall is cut down. A classic 3 m storey is unchanged for every catalog
 * item. The mesh builders and `mountBand` both read this.
 */
export function fitHungDecor(
  item: Pick<FurnitureItem, 'type' | 'height'>,
  storeyHeight: number = FLOOR_HEIGHT_METERS
): FittedDecor {
  const spec = DECOR_MOUNTS[item.type];
  if (!spec) return { mount: 0, height: item.height };
  const ceiling = storeyHeight - HUNG_CEILING_CLEARANCE;
  const mount = Math.max(spec.below, Math.min(spec.mount, ceiling - item.height - spec.above));
  const height = Math.max(0, Math.min(item.height, ceiling - mount - spec.above));
  return { mount, height };
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
    case 'mirror':
    case 'wall-clock': {
      const fitted = fitHungDecor(item, storeyHeight);
      return { bottom: fitted.mount, top: fitted.mount + fitted.height };
    }
    case 'wall-shelf': {
      const fitted = fitHungDecor(item, storeyHeight);
      return {
        bottom: fitted.mount - WALL_SHELF_BRACKET_DROP,
        top: fitted.mount + fitted.height + WALL_SHELF_ORNAMENT_RISE,
      };
    }
    case 'curtains': {
      const fitted = fitHungDecor(item, storeyHeight);
      return {
        bottom: Math.max(0, fitted.height * (1 - CURTAIN_PANEL_FRACTION) - CURTAIN_PANEL_TOP_OFFSET),
        top: fitted.height,
      };
    }
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
