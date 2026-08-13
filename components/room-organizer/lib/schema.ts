import { MAX_FLOORS, MAX_ROOM_DIMENSION } from './constants';
import type { FloorLayout, FloorPlanFitMode, FurnitureItem, RoofStyle, RoomLayout } from './types';

const FIT_MODES: readonly FloorPlanFitMode[] = ['stretch', 'cover', 'contain'];
const ROOF_STYLES: readonly RoofStyle[] = ['none', 'flat', 'gable', 'hipped'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/**
 * A room dimension must be finite AND strictly positive (0/negative break
 * PlaneGeometry, fitTextureToRoom, and collision math) and sanely bounded so a
 * corrupt value can't blow up the geometry.
 */
function isRoomDimension(value: unknown): value is number {
  return isPositiveNumber(value) && value <= MAX_ROOM_DIMENSION;
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

/**
 * A floor-plan image flows straight into `new THREE.TextureLoader().load(url)`
 * in three/room-builder.ts. A poisoned localStorage entry or imported JSON
 * could point it at `http://attacker/beacon.png`, firing an outbound request on
 * load. Only accept inline `data:image/...` URLs so nothing can trigger a
 * network fetch.
 */
function isDataImageUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\//.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVec2(value: unknown): boolean {
  return isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.z);
}

export function isFurnitureItem(value: unknown): value is FurnitureItem {
  if (!isPlainObject(value)) return false;
  const v = value;
  if (
    typeof v.id !== 'string' ||
    typeof v.type !== 'string' ||
    typeof v.name !== 'string' ||
    !isPositiveNumber(v.width) ||
    !isPositiveNumber(v.depth) ||
    !isPositiveNumber(v.height) ||
    typeof v.color !== 'string' ||
    typeof v.icon !== 'string'
  ) {
    return false;
  }
  if (v.price !== undefined && !isFiniteNumber(v.price)) return false;
  if (v.category !== undefined && typeof v.category !== 'string') return false;
  if (v.position !== undefined && !isVec2(v.position)) return false;
  if (v.rotation !== undefined && !isFiniteNumber(v.rotation)) return false;
  if (v.signalRange !== undefined && !isFiniteNumber(v.signalRange)) return false;
  if (v.visionRange !== undefined && !isFiniteNumber(v.visionRange)) return false;
  if (v.visionFov !== undefined && !isFiniteNumber(v.visionFov)) return false;
  if (v.wallRotation !== undefined && !isFiniteNumber(v.wallRotation)) return false;
  // Booleans must be real booleans: a corrupt `locked:"no"` reads truthy for
  // keyboard-delete guards yet fails `=== true` drag checks, desyncing the two.
  if (!isOptionalBoolean(v.locked)) return false;
  if (!isOptionalBoolean(v.mirrored)) return false;
  if (!isOptionalBoolean(v.cameraBracket)) return false;
  if (!isOptionalBoolean(v.isCCTV)) return false;
  if (!isOptionalBoolean(v.isWiFiAccessPoint)) return false;
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
  if (v.wallColors !== undefined) {
    if (!isPlainObject(v.wallColors)) return false;
    if (!Object.values(v.wallColors).every((color) => typeof color === 'string')) return false;
  }
  if (v.hiddenWalls !== undefined) {
    if (!Array.isArray(v.hiddenWalls)) return false;
    if (!v.hiddenWalls.every((wall) => typeof wall === 'string')) return false;
  }
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
  if (!isRoomDimension(v.width)) return false;
  if (!isRoomDimension(v.height)) return false;
  if (
    !Array.isArray(v.floors) ||
    v.floors.length === 0 ||
    v.floors.length > MAX_FLOORS ||
    !v.floors.every(isFloorLayout)
  ) {
    return false;
  }

  if (v.floorPlanImage !== undefined && !isDataImageUrl(v.floorPlanImage)) return false;
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
    if (!ROOF_STYLES.includes(roof.style as RoofStyle)) return false;
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
    isRoomDimension(v.width) &&
    isRoomDimension(v.height) &&
    typeof v.floorColor === 'string' &&
    Array.isArray(v.items) &&
    v.items.every(isFurnitureItem) &&
    (v.wallColors === undefined ||
      (isPlainObject(v.wallColors) &&
        Object.values(v.wallColors).every((color) => typeof color === 'string'))) &&
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
  // Non-destructive: keep migrating the rest of the layout even if the stored
  // floor plan isn't a safe inline data URL — just drop the image so we never
  // hand a network URL to the texture loader.
  if (isDataImageUrl(legacy.floorPlanImage)) layout.floorPlanImage = legacy.floorPlanImage;
  if (legacy.floorPlanOpacity !== undefined) layout.floorPlanOpacity = legacy.floorPlanOpacity;
  if (legacy.floorPlanFitMode !== undefined) layout.floorPlanFitMode = legacy.floorPlanFitMode;
  return layout;
}
