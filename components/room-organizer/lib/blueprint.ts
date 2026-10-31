import { ensureFloorPlanImageDecoded, render2DTopDown } from '../canvas-2d/render';
import { furnitureSpend } from './budget';
import { CATEGORIES, CURRENCY_SYMBOL } from './constants';
import { notify } from './editor-notices';
import { floorKeepOut } from './floor-keep-out';
import { footprintArea, hasCollisions, itemCountByCategory } from './geometry';
import { escapeHtml } from './html-escape';
import { planContentBounds, type PlanBounds } from './plan-export/plan-geometry';
import { distanceOutsideWalls, printWhenLoaded } from './plan-export/print';
import { storeyHeight } from './storeys';
import { entrancePlanOutline, planFloorIndex, type EntranceBuilding } from './street';
import { zoneStats } from './zones';
import type { FloorLayout, FurnitureItem, RoomLayout } from './types';

/** The box the blueprint image is fitted into, in canvas px. */
const PAGE_WIDTH = 1200;
const PAGE_HEIGHT = 900;
/** Canvas margin around the plan content: room dimensions and item labels. */
const BLUEPRINT_PADDING = 60;

/**
 * The blueprint canvas for a plan whose content spans `bounds` (#377): the
 * content's aspect fitted into the PAGE_WIDTH × PAGE_HEIGHT box with
 * `BLUEPRINT_PADDING` on every side. Sizing from the content rather than the
 * room is what keeps a tree past the walls on the sheet — the old fixed
 * 1200 × 900 canvas fitted the room and cut everything beyond about 0.6 m.
 */
export function blueprintCanvasSize(bounds: PlanBounds): { width: number; height: number } {
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxZ - bounds.minZ;
  const scale = Math.min(
    (PAGE_WIDTH - BLUEPRINT_PADDING * 2) / contentWidth,
    (PAGE_HEIGHT - BLUEPRINT_PADDING * 2) / contentHeight
  );
  return {
    width: Math.round(contentWidth * scale + BLUEPRINT_PADDING * 2),
    height: Math.round(contentHeight * scale + BLUEPRINT_PADDING * 2),
  };
}

/**
 * How small the house may get to make room for outdoor items: drawn at
 * least this share of its room-only size. Past that the furthest items are
 * left off and listed instead, so one tree 40 m out can't shrink the house
 * to a thumbnail with overlapping labels.
 */
const MIN_ROOM_SHARE = 0.5;

function fitScale(bounds: PlanBounds): number {
  return Math.min(
    (PAGE_WIDTH - BLUEPRINT_PADDING * 2) / (bounds.maxX - bounds.minX),
    (PAGE_HEIGHT - BLUEPRINT_PADDING * 2) / (bounds.maxZ - bounds.minZ)
  );
}

export interface BlueprintPlan {
  /** The floor as drawn: without `omitted`. */
  floor: FloorLayout;
  /** Items outside the walls too far out to draw, furthest first, with their distance (m). */
  omitted: Array<{ item: FurnitureItem; distance: number }>;
}

/**
 * The floor the blueprint draws (#377): every item, unless the outdoor ones
 * would shrink the house below `MIN_ROOM_SHARE` of its room-only size; then
 * the furthest items outside the walls are left off, one at a time, until
 * the house is readable again. Leaving all of them off is the print route's
 * `printedFloor(…, false)`, which always fits.
 */
export function blueprintPlan(layout: RoomLayout, floor: FloorLayout): BlueprintPlan {
  const room: PlanBounds = { minX: -layout.width / 2, minZ: -layout.height / 2, maxX: layout.width / 2, maxZ: layout.height / 2 };
  const minScale = fitScale(room) * MIN_ROOM_SHARE;
  const outside = floor.items
    .map((item) => ({ item, distance: distanceOutsideWalls(layout, item) }))
    .filter(({ distance }) => distance > 0)
    .sort((a, b) => b.distance - a.distance);
  let drawn = floor;
  let dropped = 0;
  while (dropped < outside.length && fitScale(planContentBounds(layout, drawn)) < minScale) {
    const gone = new Set(outside.slice(0, ++dropped).map(({ item }) => item));
    drawn = { ...floor, items: floor.items.filter((item) => !gone.has(item)) };
  }
  return { floor: drawn, omitted: outside.slice(0, dropped) };
}

/**
 * The storey's floor area in m²: the footprint less the recessed entrance's
 * porch, which is outside (#285).
 */
export function floorArea(layout: EntranceBuilding, floorIndex: number): number {
  const recess = entrancePlanOutline(layout, floorIndex);
  const porch = recess ? (recess.x1 - recess.x0) * (recess.backZ - recess.frontZ) : 0;
  return layout.width * layout.height - porch;
}

/**
 * Open a print-ready blueprint of the active floor in a new tab. The new
 * window writes a small HTML document with the rendered top-down image,
 * the building stats, and a category legend, and prints it once it has
 * loaded. The data URL embeds the floor plan so the popup can be saved /
 * shared without extra round-trips.
 */
export async function openBlueprintPrintWindow(layout: RoomLayout, floor: FloorLayout): Promise<void> {
  // Open the popup first, synchronously inside the click: browsers only
  // allow window.open() during the user gesture, and the decode below yields.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    notify('Pop-ups are blocked — allow pop-ups for this site to print the blueprint.', 'error');
    return;
  }
  // The popup only needs the opener's handle on it, not the reverse (#455).
  printWindow.opener = null;

  // The tracing image is painted from a lazily-warmed decoded-image cache;
  // in 3D view with the minimap off nothing has rendered the plan yet, so
  // the first printout captured only the floor colour (#288). Same
  // ground-floor rule as render.ts drawFloor: the image belongs to floor 0.
  const isGroundFloor = layout.floors[0] === floor || layout.floors[0]?.id === floor.id;
  if (layout.floorPlanImage && isGroundFloor) await ensureFloorPlanImageDecoded(layout.floorPlanImage);

  // Fit the plan content, outdoor items included (#377), as the SVG and
  // print-to-scale routes already do (#287).
  const plan = blueprintPlan(layout, floor);
  const bounds = planContentBounds(layout, plan.floor);
  const size = blueprintCanvasSize(bounds);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const floorIndex = planFloorIndex(layout.floors, floor);
  const keepOut = floorKeepOut(layout, floorIndex);

  render2DTopDown({
    canvas,
    layout,
    floor: plan.floor,
    selectedItemId: null,
    showMeasurements: true,
    // Coverage on by default: the blueprint is the natural artifact for
    // planning Wi-Fi and camera placement, and hardcoding this off hid the
    // signal rings AND the camera FOV wedges from the printout (#134).
    showWiFiSignals: true,
    fitBounds: bounds,
    padding: BLUEPRINT_PADDING,
    hasCollision: (item) =>
      hasCollisions(item, floor.items, layout.width, layout.height, { keepOut, interiorWalls: floor.interiorWalls, storeyHeight: storeyHeight(floor) }),
  });

  const dataUrl = canvas.toDataURL('image/png');
  const stats = {
    items: floor.items.length,
    area: floorArea(layout, floorIndex).toFixed(1),
    footprint: footprintArea(floor.items).toFixed(1),
    // The porch door is structure, as in the header (#693).
    cost: `${CURRENCY_SYMBOL}${furnitureSpend({ floors: [floor] }).toLocaleString()}`,
  };
  const counts = itemCountByCategory(floor.items);
  const legend = CATEGORIES.filter((category) => counts.has(category.key))
    .map((category) => `<li><span>${category.icon}</span> ${category.label}: ${counts.get(category.key) ?? 0}</li>`)
    .join('');
  // Per-room cost and area from the floor's zones (#155) — the printout is
  // where "what does the bedroom cost" gets asked.
  const recess = entrancePlanOutline(layout, floorIndex);
  const zonesHtml = (floor.zones ?? [])
    .map((zone) => {
      const zs = zoneStats(zone, floor.items, recess);
      return `<li>${escapeHtml(zone.name)}: ${zs.itemCount} items · ${CURRENCY_SYMBOL}${zs.cost.toLocaleString()} · ${zs.area.toFixed(1)} m²</li>`;
    })
    .join('');

  // Far items the plan leaves off are still listed, so the sheet never
  // counts an item it doesn't account for.
  const omittedHtml = plan.omitted
    .map(({ item, distance }) => `<li>${escapeHtml(item.icon)} ${escapeHtml(item.name)}: ${distance.toFixed(1)} m outside the walls</li>`)
    .join('');

  const html = renderBlueprintHtml({
    title: `${layout.name} — ${floor.name}`,
    subtitle: `${layout.width} m × ${layout.height} m · ${stats.items} items · ${stats.cost}`,
    imageUrl: dataUrl,
    legendHtml: legend,
    zonesHtml,
    omittedHtml,
    stats,
  });

  printWindow.document.write(html);
  printWindow.document.close();
  printWhenLoaded(printWindow);
}

interface BlueprintHtmlInput {
  title: string;
  subtitle: string;
  imageUrl: string;
  legendHtml: string;
  /** One `<li>` per zone, or '' when the floor has none. */
  zonesHtml: string;
  /** One `<li>` per item too far outside the walls to draw, or ''. */
  omittedHtml: string;
  stats: { items: number; area: string; footprint: string; cost: string };
}

function renderBlueprintHtml({ title, subtitle, imageUrl, legendHtml, zonesHtml, omittedHtml, stats }: BlueprintHtmlInput): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)} — Blueprint</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; }
      header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
      h1 { margin: 0; font-size: 1.6rem; }
      p.subtitle { margin: 4px 0 0; color: #555; font-size: 0.95rem; }
      .plan { display: block; max-width: 100%; height: auto; border: 1px solid #ccc; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; font-size: 0.85rem; }
      .meta ul { margin: 8px 0 0; padding-left: 1.1rem; }
      .meta li { margin: 2px 0; }
      footer { margin-top: 24px; font-size: 0.7rem; color: #888; text-align: right; }
      @media print { body { padding: 8px; } }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="subtitle">${escapeHtml(subtitle)}</p>
      </div>
    </header>
    <img class="plan" src="${imageUrl}" alt="Floor plan" />
    <div class="meta">
      <section>
        <strong>Statistics</strong>
        <ul>
          <li>Items: ${stats.items}</li>
          <li>Floor area: ${stats.area} m²</li>
          <li>Furniture footprint: ${stats.footprint} m²</li>
          <li>Cost: ${escapeHtml(stats.cost)}</li>
        </ul>
      </section>
      <section>
        <strong>By category</strong>
        <ul>${legendHtml || '<li>—</li>'}</ul>
      </section>
      ${zonesHtml ? `<section><strong>By zone</strong><ul>${zonesHtml}</ul></section>` : ''}
      ${omittedHtml ? `<section><strong>Off the plan (too far out to draw)</strong><ul>${omittedHtml}</ul></section>` : ''}
    </div>
    <footer>Generated by Three.js Sims-like House Builder</footer>
  </body>
</html>`;
}
