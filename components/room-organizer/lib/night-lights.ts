import { mountBand } from './mount-band';
import { floorElevation } from './storeys';
import type { FloorLayout } from './types';

/**
 * Catalog items that light their surroundings at night (#215), and how. The
 * bulb height mirrors the mesh builders in three/builders/builders-lighting.ts
 * as a fraction of the item height above its mount band's bottom.
 *
 * Intensities are candela (three's physical units since r155, decay 2),
 * scaled to this scene's photometry rather than to the real world: the sun
 * peaks under 1, so a 60 cd room lamp would blow everything out (#375).
 */
export const NIGHT_LIGHTS = {
  lamp: { bulb: 0.9, candela: 8, range: 7 },
  'floor-lamp': { bulb: 0.9, candela: 10, range: 8 },
  'pendant-light': { bulb: 0.35, candela: 10, range: 8 },
  lamppost: { bulb: 0.93, candela: 25, range: 12 },
} as const satisfies Record<string, { bulb: number; candela: number; range: number }>;

export type NightLitType = keyof typeof NIGHT_LIGHTS;

export function isNightLit(type: string): type is NightLitType {
  return Object.prototype.hasOwnProperty.call(NIGHT_LIGHTS, type);
}

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

/** Every night light in the building, with the bulb in world space. */
export function collectLampLights(floors: readonly FloorLayout[]): LampLight[] {
  return floors.flatMap((floor, index) => {
    const floorY = floorElevation(floors, index);
    return floor.items.flatMap((item) => {
      if (!item.position || !isNightLit(item.type)) return [];
      const spec = NIGHT_LIGHTS[item.type];
      return [
        {
          x: item.position.x,
          // The bulb factor belongs to the item's own height only — applied
          // after the floor offset it sank upper-floor glows 0.3 m per storey,
          // lighting the floor below (#146).
          y: floorY + mountBand(item).bottom + item.height * spec.bulb,
          z: item.position.z,
          candela: spec.candela,
          range: spec.range,
        },
      ];
    });
  });
}
