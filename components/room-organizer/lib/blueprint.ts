import { ensureFloorPlanImageDecoded, render2DTopDown } from '../canvas-2d/render';
import { CATEGORIES, CURRENCY_SYMBOL } from './constants';
import { floorKeepOut } from './floor-keep-out';
import { footprintArea, hasCollisions, itemCountByCategory, totalCost } from './geometry';
import { entrancePlanOutline, planFloorIndex, type EntranceBuilding } from './street';
import { zoneStats } from './zones';
import type { FloorLayout, RoomLayout } from './types';

const PAGE_WIDTH = 1200;
const PAGE_HEIGHT = 900;

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
 * the building stats, and a category legend, and calls window.print() on
 * load. The data URL embeds the floor plan so the popup can be saved /
 * shared without extra round-trips.
 */
export async function openBlueprintPrintWindow(layout: RoomLayout, floor: FloorLayout): Promise<void> {
  // Open the popup first, synchronously inside the click: browsers only
  // allow window.open() during the user gesture, and the decode below yields.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.alert('Pop-ups are blocked — allow pop-ups to print the blueprint.');
    return;
  }

  // The tracing image is painted from a lazily-warmed decoded-image cache;
  // in 3D view with the minimap off nothing has rendered the plan yet, so
  // the first printout captured only the floor colour (#288). Same
  // ground-floor rule as render.ts drawFloor: the image belongs to floor 0.
  const isGroundFloor = layout.floors[0] === floor || layout.floors[0]?.id === floor.id;
  if (layout.floorPlanImage && isGroundFloor) await ensureFloorPlanImageDecoded(layout.floorPlanImage);

  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const floorIndex = planFloorIndex(layout.floors, floor);
  const keepOut = floorKeepOut(layout, floorIndex);

  render2DTopDown({
    canvas,
    layout,
    floor,
    selectedItemId: null,
    showMeasurements: true,
    // Coverage on by default: the blueprint is the natural artifact for
    // planning Wi-Fi and camera placement, and hardcoding this off hid the
    // signal rings AND the camera FOV wedges from the printout (#134).
    showWiFiSignals: true,
    hasCollision: (item) =>
      hasCollisions(item, floor.items, layout.width, layout.height, { keepOut, interiorWalls: floor.interiorWalls }),
  });

  const dataUrl = canvas.toDataURL('image/png');
  const stats = {
    items: floor.items.length,
    area: floorArea(layout, floorIndex).toFixed(1),
    footprint: footprintArea(floor.items).toFixed(1),
    cost: totalCost(floor.items).toLocaleString(),
  };
  const counts = itemCountByCategory(floor.items);
  const legend = CATEGORIES.filter((category) => counts.has(category.key))
    .map((category) => `<li><span>${category.icon}</span> ${category.label}: ${counts.get(category.key) ?? 0}</li>`)
    .join('');
  // Per-room cost and area from the floor's zones (#155) — the printout is
  // where "what does the bedroom cost" gets asked.
  const zonesHtml = (floor.zones ?? [])
    .map((zone) => {
      const zs = zoneStats(zone, floor.items);
      return `<li>${escapeHtml(zone.name)}: ${zs.itemCount} items · ${CURRENCY_SYMBOL}${zs.cost.toLocaleString()} · ${zs.area.toFixed(1)} m²</li>`;
    })
    .join('');

  const html = renderBlueprintHtml({
    title: `${layout.name} — ${floor.name}`,
    subtitle: `${layout.width} m × ${layout.height} m · ${stats.items} items · ${CURRENCY_SYMBOL}${stats.cost}`,
    imageUrl: dataUrl,
    legendHtml: legend,
    zonesHtml,
    stats,
  });

  printWindow.document.write(html);
  printWindow.document.close();
}

interface BlueprintHtmlInput {
  title: string;
  subtitle: string;
  imageUrl: string;
  legendHtml: string;
  /** One `<li>` per zone, or '' when the floor has none. */
  zonesHtml: string;
  stats: { items: number; area: string; footprint: string; cost: string };
}

function renderBlueprintHtml({ title, subtitle, imageUrl, legendHtml, zonesHtml, stats }: BlueprintHtmlInput): string {
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
  <body onload="setTimeout(function(){ window.print(); }, 200)">
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
          <li>Total cost: ${escapeHtml(stats.cost)}</li>
        </ul>
      </section>
      <section>
        <strong>By category</strong>
        <ul>${legendHtml || '<li>—</li>'}</ul>
      </section>
      ${zonesHtml ? `<section><strong>By zone</strong><ul>${zonesHtml}</ul></section>` : ''}
    </div>
    <footer>Generated by Standalone Room Organizer</footer>
  </body>
</html>`;
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
