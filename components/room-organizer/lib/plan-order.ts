import { isLowProfile, isTabletopType } from './geometry';
import { isWallMounted } from './opening-snap';
import type { FurnitureItem } from './types';

/**
 * Vertical layer of an item on the 2D plan (#286), bottom to top. Mirrors the
 * collision layer model in lib/geometry: items carry no elevation, so the
 * layer is read from the type family and the catalogue height.
 *
 * - `low-profile`: at or under LOW_PROFILE_MAX_HEIGHT (rugs, stepping stones)
 *   — goes UNDER everything else by design.
 * - `floor`: ordinary floor-standing furniture.
 * - `tabletop`: small items that sit ON a surface (computer on a desk, lamp on
 *   a nightstand), so they paint over the surface beneath them.
 * - `wall`: wall-plane items (doors, windows, cameras) — on top, so a cabinet
 *   flush under a window never hides the opening mark.
 */
export type PlanLayer = 'low-profile' | 'floor' | 'tabletop' | 'wall';

const LAYER_RANK: Record<PlanLayer, number> = {
  'low-profile': 0,
  floor: 1,
  tabletop: 2,
  wall: 3,
};

export function planLayer(item: Pick<FurnitureItem, 'type' | 'height'>): PlanLayer {
  if (isWallMounted(item.type)) return 'wall';
  // Tabletop before low-profile: a flat tabletop item (books, a tray) still
  // belongs ABOVE its desk, not under the rug layer.
  if (isTabletopType(item.type)) return 'tabletop';
  if (isLowProfile(item)) return 'low-profile';
  return 'floor';
}

/**
 * The order the 2D plan paints items in, bottom layer first, so a rug added
 * after the sofa it sits under is still drawn beneath it. Ties keep the array
 * index (a stable sort), so items within one layer overdraw in placement
 * order exactly as before. Hit-testing walks the same list in reverse, and
 * the SVG / DXF exporters emit it, so what is on top on screen is what a
 * click picks and what the export stacks last.
 *
 * Generic over the element type so callers holding a narrowed item type
 * (e.g. plan-export's PlacedItem) keep it.
 */
export function planDrawOrder<T extends Pick<FurnitureItem, 'type' | 'height'>>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index, rank: LAYER_RANK[planLayer(item)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}
