import { cutoutRect, isInsideBuilding, type FootprintBuilding, type FootprintRect } from './footprint';
import { mountBand, pendantBulbY } from './mount-band';
import { gardenGroundY } from './site';
import { floorElevation, storeyHeight } from './storeys';
import type { FloorLayout, InteriorWall, TerrainSpec, Vec2 } from './types';

/**
 * Catalog items that light their surroundings at night (#215), and how.
 * `bulb` mirrors the mesh builders in three/builders/builders-lighting.ts:
 * where the bulb sits up the item's mount band, as a fraction of it.
 *
 * Intensities are candela (three's physical units since r155, decay 2),
 * scaled to this scene's photometry rather than to the real world: the sun
 * peaks at 1.7, so a 60 cd room lamp would blow everything out (#375).
 */
const NIGHT_LIGHTS = {
  lamp: { bulb: 0.9, candela: 10, range: 7 },
  'floor-lamp': { bulb: 0.9, candela: 12, range: 8 },
  // Placed by `pendantBulbY` instead.
  'pendant-light': { bulb: 0, candela: 12, range: 8 },
  lamppost: { bulb: 0.93, candela: 32, range: 12 },
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
  /** Stands outside the walls, so the garden gets its light (#664). */
  outdoors?: boolean;
}

/** Which storeys the 3D view draws: the active one, or all of them. */
export interface RenderedFloors {
  activeFloorIndex: number;
  showAllFloors: boolean;
}

/**
 * Every night light on a rendered storey, with the bulb in world space. A
 * storey that isn't drawn lights nothing, or an upper-floor lamp would wash
 * the empty floor below in amber. With `building`, a lamp on the ground
 * outside the walls is marked `outdoors`, whatever its type: it goes by where
 * the lamp stands, so a lamppost in an L's cut corner counts and one inside
 * doesn't (#664). With its `terrain`, a garden lamp's bulb rides the slope
 * with the post (#665).
 */
export function collectLampLights(
  floors: readonly FloorLayout[],
  rendered: RenderedFloors,
  building?: FootprintBuilding & { terrain?: TerrainSpec | undefined }
): LampLight[] {
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
      const standY = (building ? gardenGroundY(item, index, item.position, building) : null) ?? floorY;
      return [
        {
          x: item.position.x,
          y: standY + bulbY,
          z: item.position.z,
          candela: spec.candela,
          range: spec.range,
          ...(building && !isInsideBuilding(building, item.position.x, item.position.z) ? { outdoors: true } : {}),
        },
      ];
    });
  });
}


export interface NightGlowPlan {
  /** Window item id to how lit its room is at it, 0..1. Every placed window has an entry. */
  windows: Record<string, number>;
  /** Item ids of the lamps, on every storey. */
  lamps: string[];
  /** 0..1: the top storey has a lamp on, so the dormers show it. */
  dormers: number;
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/**
 * Which windows look lit from outside (#759). Every storey counts, drawn or
 * not, and it isn't limited to the eight pooled lamps: a window is only a
 * colour, so an upstairs room stays lit seen from the garden while the walker
 * is downstairs. A lamp reaches a window within its range unless a partition
 * stands between them. Doorways in partitions are ignored.
 */
export function nightGlowPlan(floors: readonly FloorLayout[], building: FootprintBuilding): NightGlowPlan {
  const plan: NightGlowPlan = { windows: {}, lamps: [], dormers: 0 };
  const notch = cutoutRect(building);
  floors.forEach((floor, index) => {
    const indoor = collectLampLights([floor], { activeFloorIndex: 0, showAllFloors: false }, building).filter((lamp) => !lamp.outdoors);
    const walls = floor.interiorWalls ?? [];
    for (const item of floor.items) {
      if (!item.position) continue;
      if (isNightLit(item.type)) plan.lamps.push(item.id);
      if (item.type !== 'window') continue;
      plan.windows[item.id] = roomLampReach(indoor, item.position, walls, notch);
    }
    if (index === floors.length - 1 && indoor.length > 0) plan.dormers = 1;
  });
  return plan;
}

/**
 * How lit the room is at `at`, 0..1: the best reach of an indoor lamp with no
 * partition between them, nor the open corner of an L (`notch`, from
 * `cutoutRect`): from one wing the other's notch walls face the lamp, but
 * the outside lies between. Outdoor lamps never count: their light stops at
 * the walls (#664). The lamps are those of `at`'s storey. Doorways in
 * partitions are ignored, as for the windows.
 */
export function roomLampReach(
  lamps: readonly LampLight[],
  at: Vec2,
  walls: readonly InteriorWall[],
  notch: FootprintRect | null = null
): number {
  return lamps.reduce((best, lamp) => {
    if (lamp.outdoors) return best;
    const blocked =
      (notch !== null && crossesRect(lamp, at, notch)) ||
      walls.some((wall) => segmentsCross(lamp, at, { x: wall.x1, z: wall.z1 }, { x: wall.x2, z: wall.z2 }));
    return blocked ? best : Math.max(best, lampReach(Math.hypot(lamp.x - at.x, lamp.z - at.z), lamp.range));
  }, 0);
}

/** A window sits on the notch's edge: only a pass this far inside the notch counts. */
const NOTCH_INSET = 0.2;

/** Whether the segment a→b passes through `rect` shrunk by NOTCH_INSET (Liang–Barsky). */
function crossesRect(a: Vec2, b: Vec2, rect: FootprintRect): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;
  const clips: Array<[number, number]> = [
    [-dx, a.x - (rect.x0 + NOTCH_INSET)],
    [dx, rect.x1 - NOTCH_INSET - a.x],
    [-dz, a.z - (rect.z0 + NOTCH_INSET)],
    [dz, rect.z1 - NOTCH_INSET - a.z],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** Full glow in the near part of a lamp's range, a quarter at its edge, nothing beyond. */
function lampReach(distance: number, range: number): number {
  return distance > range ? 0 : Math.min(1, 1.25 - distance / range);
}

export interface LampPoolSlot {
  x: number;
  y: number;
  z: number;
  intensity: number;
  distance: number;
  /** Lights outdoor surfaces too; an indoor lamp is kept off them (#664). */
  outdoors: boolean;
  /** 0..1 share of the lamp's night intensity, 0 for a dark spare. */
  level: number;
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
      ? { x: lamp.x, y: lamp.y, z: lamp.z, intensity: lamp.candela * level, distance: lamp.range, outdoors: lamp.outdoors === true, level }
      : { x: 0, y: 0, z: 0, intensity: 0, distance: 1, outdoors: false, level: 0 };
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
