import type { FloorLayout, FloorPlanFitMode, FurnitureItem, RoomLayout } from './types';

const FIT_MODES: readonly FloorPlanFitMode[] = ['stretch', 'cover', 'contain'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFurnitureItem(value: unknown): value is FurnitureItem {
  if (!isPlainObject(value)) return false;
  const v = value;
  if (
    typeof v.id !== 'string' ||
    typeof v.type !== 'string' ||
    typeof v.name !== 'string' ||
    !isFiniteNumber(v.width) ||
    !isFiniteNumber(v.depth) ||
    !isFiniteNumber(v.height) ||
    typeof v.color !== 'string' ||
    typeof v.icon !== 'string'
  ) {
    return false;
  }
  if (v.price !== undefined && !isFiniteNumber(v.price)) return false;
  if (v.category !== undefined && typeof v.category !== 'string') return false;
  return true;
}

export function isFloorLayout(value: unknown): value is FloorLayout {
  if (!isPlainObject(value)) return false;
  const v = value;
  if (typeof v.id !== 'string') return false;
  if (typeof v.name !== 'string') return false;
  if (typeof v.floorColor !== 'string') return false;
  if (!Array.isArray(v.items) || !v.items.every(isFurnitureItem)) return false;
  if (v.floorPattern !== undefined && typeof v.floorPattern !== 'string') return false;
  if (v.wallPattern !== undefined && typeof v.wallPattern !== 'string') return false;
  if (v.wallColors !== undefined && !isPlainObject(v.wallColors)) return false;
  if (v.interiorWalls !== undefined) {
    if (!Array.isArray(v.interiorWalls)) return false;
    for (const wall of v.interiorWalls) {
      if (!isPlainObject(wall)) return false;
      if (
        typeof wall.id !== 'string' ||
        !isFiniteNumber(wall.x1) ||
        !isFiniteNumber(wall.z1) ||
        !isFiniteNumber(wall.x2) ||
        !isFiniteNumber(wall.z2)
      ) {
        return false;
      }
    }
  }
  return true;
}

export function isRoomLayout(value: unknown): value is RoomLayout {
  if (!isPlainObject(value)) return false;
  const v = value;

  if (typeof v.name !== 'string') return false;
  if (!isFiniteNumber(v.width)) return false;
  if (!isFiniteNumber(v.height)) return false;
  if (!Array.isArray(v.floors) || v.floors.length === 0 || !v.floors.every(isFloorLayout)) {
    return false;
  }

  if (v.floorPlanImage !== undefined && typeof v.floorPlanImage !== 'string') return false;
  if (v.floorPlanOpacity !== undefined && !isFiniteNumber(v.floorPlanOpacity)) return false;
  if (
    v.floorPlanFitMode !== undefined &&
    !FIT_MODES.includes(v.floorPlanFitMode as FloorPlanFitMode)
  ) {
    return false;
  }

  if (v.roof !== undefined) {
    if (!isPlainObject(v.roof)) return false;
    const roof = v.roof;
    if (typeof roof.style !== 'string') return false;
    if (roof.color !== undefined && typeof roof.color !== 'string') return false;
  }

  return true;
}

/**
 * Accepts either the current multi-floor shape or the legacy single-floor
 * shape (with top-level `items` / `floorColor` / `wallColors` / etc.) and
 * normalises both to the current `RoomLayout` shape. Returns `null` if the
 * input matches neither.
 */
export function parseStoredLayout(value: unknown): RoomLayout | null {
  if (isRoomLayout(value)) return value;
  if (isLegacySingleFloorLayout(value)) return migrateLegacyLayout(value);
  return null;
}

interface LegacySingleFloorLayout {
  id?: string;
  name: string;
  width: number;
  height: number;
  items: FurnitureItem[];
  floorColor: string;
  floorPattern?: string;
  wallPattern?: string;
  wallColors?: Record<string, string>;
  floorPlanImage?: string;
  floorPlanOpacity?: number;
  floorPlanFitMode?: FloorPlanFitMode;
}

function isLegacySingleFloorLayout(value: unknown): value is LegacySingleFloorLayout {
  if (!isPlainObject(value)) return false;
  const v = value;
  return (
    typeof v.name === 'string' &&
    isFiniteNumber(v.width) &&
    isFiniteNumber(v.height) &&
    typeof v.floorColor === 'string' &&
    Array.isArray(v.items) &&
    v.items.every(isFurnitureItem) &&
    !('floors' in v)
  );
}

function migrateLegacyLayout(legacy: LegacySingleFloorLayout): RoomLayout {
  const groundFloor: FloorLayout = {
    id: 'ground',
    name: 'Ground Floor',
    items: legacy.items,
    floorColor: legacy.floorColor,
    ...(legacy.floorPattern ? { floorPattern: legacy.floorPattern as FloorLayout['floorPattern'] } : {}),
    ...(legacy.wallPattern ? { wallPattern: legacy.wallPattern as FloorLayout['wallPattern'] } : {}),
    ...(legacy.wallColors ? { wallColors: legacy.wallColors } : {}),
  };

  const layout: RoomLayout = {
    name: legacy.name,
    width: legacy.width,
    height: legacy.height,
    floors: [groundFloor],
  };
  if (legacy.id !== undefined) layout.id = legacy.id;
  if (legacy.floorPlanImage !== undefined) layout.floorPlanImage = legacy.floorPlanImage;
  if (legacy.floorPlanOpacity !== undefined) layout.floorPlanOpacity = legacy.floorPlanOpacity;
  if (legacy.floorPlanFitMode !== undefined) layout.floorPlanFitMode = legacy.floorPlanFitMode;
  return layout;
}
