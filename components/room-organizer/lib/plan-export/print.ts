/**
 * Print-to-scale plan export (#230): embeds the vector SVG plan (not a
 * raster) in a print-styled document with a title block and a declared
 * architectural scale, then calls print() — the browser's Save-as-PDF does
 * the rest. Follows the popup pattern of lib/blueprint.ts (which must stay
 * untouched — it owns the raster blueprint route).
 */

import { DEFAULT_SVG_MARGIN, DEFAULT_SVG_PX_PER_METRE, layoutToSvg } from './svg';
import type { FloorLayout, RoomLayout } from '../types';

/** Candidate scale denominators, finest first. */
const SCALE_DENOMINATORS = [20, 25, 50, 75, 100, 125, 200] as const;

/** Printable plan area on A4 portrait with margins + title block, in mm. */
const PRINTABLE_WIDTH_MM = 180;
const PRINTABLE_HEIGHT_MM = 230;

/**
 * Pick the finest standard scale (1:n) at which the whole sheet — room plus
 * annotation margins — fits the A4 printable area. Falls back to the
 * coarsest denominator for outsized lots.
 */
export function pickPrintScale(sheetWidthM: number, sheetHeightM: number): number {
  for (const denominator of SCALE_DENOMINATORS) {
    const widthMm = (sheetWidthM * 1000) / denominator;
    const heightMm = (sheetHeightM * 1000) / denominator;
    if (widthMm <= PRINTABLE_WIDTH_MM && heightMm <= PRINTABLE_HEIGHT_MM) return denominator;
  }
  return SCALE_DENOMINATORS[SCALE_DENOMINATORS.length - 1]!;
}

/** Open a print-ready, true-to-scale vector plan of the given floor. */
export function openPlanPrintWindow(layout: RoomLayout, floor: FloorLayout): void {
  const svg = layoutToSvg(layout, floor);

  // The SVG sheet spans the room plus its margins; convert the whole sheet to
  // metres so the printed page carries the declared scale exactly.
  const sheetWidthM = layout.width + (2 * DEFAULT_SVG_MARGIN) / DEFAULT_SVG_PX_PER_METRE;
  const sheetHeightM = layout.height + (2 * DEFAULT_SVG_MARGIN) / DEFAULT_SVG_PX_PER_METRE;
  const denominator = pickPrintScale(sheetWidthM, sheetHeightM);
  const sheetWidthMm = (sheetWidthM * 1000) / denominator;

  const html = renderPrintHtml({
    title: `${layout.name} — ${floor.name}`,
    layoutName: layout.name,
    floorName: floor.name,
    dims: `${layout.width} m × ${layout.height} m`,
    itemCount: floor.items.length,
    scaleLabel: `1:${denominator} (A4)`,
    date: new Date().toLocaleDateString(),
    sheetWidthMm,
    svg,
  });

  // Popup pattern shared with lib/blueprint.ts openBlueprintPrintWindow.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.alert('Pop-ups are blocked — allow pop-ups to print the plan.');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
}

interface PrintHtmlInput {
  title: string;
  layoutName: string;
  floorName: string;
  dims: string;
  itemCount: number;
  scaleLabel: string;
  date: string;
  sheetWidthMm: number;
  svg: string;
}

function renderPrintHtml(input: PrintHtmlInput): string {
  // The svg string is emitted by layoutToSvg, which XML-escapes all
  // user-supplied text (names, colours), so it is safe to inline.
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(input.title)} — Floor plan</title>
    <style>
      :root { color-scheme: light; }
      @page { size: A4 portrait; margin: 12mm; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; }
      .plan { width: ${input.sheetWidthMm.toFixed(1)}mm; }
      .plan svg { display: block; width: 100%; height: auto; }
      table.titleblock { margin-top: 6mm; border-collapse: collapse; font-size: 9pt; width: 100%; }
      table.titleblock td { border: 0.3mm solid #444; padding: 1.5mm 3mm; }
      table.titleblock td.k { color: #666; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.05em; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  </head>
  <body onload="setTimeout(function(){ window.print(); }, 200)">
    <div class="plan">${input.svg}</div>
    <table class="titleblock">
      <tr>
        <td class="k">Project</td><td>${escapeHtml(input.layoutName)}</td>
        <td class="k">Floor</td><td>${escapeHtml(input.floorName)}</td>
      </tr>
      <tr>
        <td class="k">Footprint</td><td>${escapeHtml(input.dims)} · ${input.itemCount} items</td>
        <td class="k">Scale</td><td>${escapeHtml(input.scaleLabel)}</td>
      </tr>
      <tr>
        <td class="k">Date</td><td>${escapeHtml(input.date)}</td>
        <td class="k">Drawn by</td><td>Standalone Room Organizer</td>
      </tr>
    </table>
  </body>
</html>`;
}

// Duplicated from lib/blueprint.ts (private there; that file must not change).
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
