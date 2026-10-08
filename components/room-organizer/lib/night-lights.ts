import { mountBand, pendantBulbY } from './mount-band';
import { floorElevation, storeyHeight } from './storeys';
import type { FloorLayout } from './types';

/**
 * Catalog items that light their surroundings at night (#215), and how.
 * `bulb` mirrors the mesh builders in three/builders/builders-lighting.ts:
 * where the bulb sits up the item's mount band, as a fraction of it.
 *
 * Intensities are candela (three's physical units since r155, decay 2),
 * scaled to this scene's photometry rather than to the real world: the sun
 * peaks under 1, so a 60 cd room lamp would blow everything out (#375).
 */
export const NIGHT_LIGHTS = {
  lamp: { bulb: 0.9, candela: 8, range: 7 },
  'floor-lamp': { bulb: 0.9, candela: 10, range: 8 },
  // Placed by `pendantBulbY` instead.
  'pendant-light': { bulb: 0, candela: 10, range: 8 },
  lamppost: { bulb: 0.93, candela: 25, range: 12 },
} as const satisfies Record<string, { bulb: number; candela: number; range: number }>;

export type NightLitType = keyof typeof NIGHT_LIGHTS;

export function isNightLit(type: string): type is NightLitType {
  return Object.prototype.hasOwnProperty.call(NIGHT_LIGHTS, type);
}

/**
 * Point lights the scene keeps for the lamps, however many are placed
 * (#393): three compiles a shader variant per point-light count and every lit
 * fragment loops over all of them, so the count is fixed. Eight is a room's
 * worth of lamps within their 7–12 m reach of where the camera looks, and
 * eight point-light structs stay far inside the fragment-uniform budget of
 * weak GPUs (WebGL 2 guarantees 224 vectors; each light takes three).
 */
export const LAMP_POOL_SIZE = 8;

export interface LampLight {
  x: number;
  /** World y of the bulb. */
  y: number;
  z: number;
  /** Full night intensity, in candela. */
  candela: number;
  /** Distance at which the light's contribution reaches zero. */
  range: number;
}

/** Which storeys the 3D view draws: the active one, or all of them. */
export interface RenderedFloors {
  activeFloorIndex: number;
  showAllFloors: boolean;
}

/**
 * Every night light on a rendered storey, with the bulb in world space. A
 * storey that isn't drawn lights nothing, or an upper-floor lamp would wash
 * the empty floor below in amber.
 */
export function collectLampLights(floors: readonly FloorLayout[], rendered: RenderedFloors): LampLight[] {
  return floors.flatMap((floor, index) => {
    if (!rendered.showAllFloors && index !== rendered.activeFloorIndex) return [];
    const floorY = floorElevation(floors, index);
    const storey = storeyHeight(floor);
    return floor.items.flatMap((item) => {
      if (!item.position || !isNightLit(item.type)) return [];
      const spec = NIGHT_LIGHTS[item.type];
      // The floor offset is added once, not scaled by the bulb factor, or
      // upper-floor glows sink 0.3 m per storey (#146).
      const bulbY =
        item.type === 'pendant-light'
          ? pendantBulbY(item, storey)
          : mountBand(item).bottom + item.height * spec.bulb;
      return [
        {
          x: item.position.x,
          y: floorY + bulbY,
          z: item.position.z,
          candela: spec.candela,
          range: spec.range,
        },
      ];
    });
  });
}


export interface LampPoolSlot {
  x: number;
  y: number;
  z: number;
  intensity: number;
  distance: number;
}

export interface LampPoolPlan {
  /** Whether the pool is lit at all; when false it should not be rendered. */
  lit: boolean;
  /** Always `size` slots: the nearest lamps first, then dark spares. */
  slots: LampPoolSlot[];
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Assign the pool to the `size` lamps nearest `focus` (the point the camera
 * looks at), each at its night intensity times `level`. Unused slots stay
 * dark, so the light count never follows the lamp count.
 */
export function planLampPool(
  lamps: readonly LampLight[],
  focus: Point3,
  level: number,
  size: number = LAMP_POOL_SIZE
): LampPoolPlan {
  const lit = level > 0 && lamps.length > 0;
  const nearest = lit ? nearestLamps(lamps, focus, size) : [];
  const slots = Array.from({ length: size }, (_, index): LampPoolSlot => {
    const lamp = nearest[index];
    return lamp
      ? { x: lamp.x, y: lamp.y, z: lamp.z, intensity: lamp.candela * level, distance: lamp.range }
      : { x: 0, y: 0, z: 0, intensity: 0, distance: 1 };
  });
  return { lit, slots };
}

/** The `count` lamps nearest `focus`, nearest first; ties keep building order. */
export function nearestLamps(lamps: readonly LampLight[], focus: Point3, count: number): LampLight[] {
  const distance = (lamp: LampLight) => (lamp.x - focus.x) ** 2 + (lamp.y - focus.y) ** 2 + (lamp.z - focus.z) ** 2;
  return lamps
    .map((lamp) => ({ lamp, d: distance(lamp) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map(({ lamp }) => lamp);
}
