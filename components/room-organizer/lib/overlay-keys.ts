import type { FurnitureFloorPlan } from './furniture-scene';
import type { FurnitureItem } from './types';

/**
 * Signatures of exactly what the 3D overlays are built from, so their
 * effects rebuild only when an overlay would look different (#409). The
 * furniture items key changes on any item edit — a sofa's colour, a chair
 * nudge — which tore down every label sprite, Wi-Fi ring and vision cone
 * and restarted the cone sweep.
 */

/** What `renderItemLabels` reads: the text and where the sprite floats. */
export function itemLabelsKey(items: readonly FurnitureItem[]): string {
  return JSON.stringify(
    items.filter((item) => item.position).map((item) => [item.id, item.name, item.position?.x, item.position?.z, item.height])
  );
}

function projectsOverlay(item: FurnitureItem): boolean {
  return item.hasVisionCone === true || (!!item.signalRange && (item.isWiFiAccessPoint === true || item.isCCTV === true));
}

/**
 * What the Wi-Fi rings and vision cones read. A cone also bakes the ids of
 * the items it may alert on (live positions are read per frame), so a floor
 * with a cone keys on its item ids and types as well.
 */
export function signalOverlaysKey(plan: readonly Pick<FurnitureFloorPlan, 'index' | 'items'>[]): string {
  return JSON.stringify(
    plan.map(({ index, items }) => {
      const sources = items.filter(projectsOverlay).map((item) => [
        item.id,
        item.type,
        item.position?.x,
        item.position?.z,
        item.rotation,
        item.height,
        item.signalRange,
        item.isWiFiAccessPoint,
        item.isCCTV,
        item.hasVisionCone,
        item.visionRange,
        item.visionFov,
      ]);
      const targets = items.some((item) => item.hasVisionCone) ? items.map((item) => [item.id, item.type]) : [];
      return [index, sources, targets];
    })
  );
}
