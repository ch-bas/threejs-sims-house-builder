/**
 * Print-to-scale plan export (#230): embeds the vector SVG plan (not a
 * raster) in a print-styled document with a title block and a declared
 * architectural scale, then calls print() — the browser's Save-as-PDF does
 * the rest. Follows the popup pattern of lib/blueprint.ts (which owns the
 * raster blueprint route).
 */

import { planContentBounds } from './plan-geometry';
import { DEFAULT_SVG_MARGIN, layoutToSvg, planSheetSize } from './svg';
import type { FloorLayout, RoomLayout } from '../types';

/** Candidate scale denominators, finest first (#288: coarse end extended
 * so a whole lot still fits a page rather than being cut off at 1:200). */
const SCALE_DENOMINATORS = [20, 25, 50, 75, 100, 125, 200, 250, 500, 1000] as const;

export type PrintOrientation = 'portrait' | 'landscape';

/**
 * Printable plan area on A4 with 12 mm page margins and the title block
 * below the plan, in mm. Landscape gives the plan more width but loses
 * height to the title block.
 */
const PRINTABLE_MM: Record<PrintOrientation, { width: number; height: number }> = {
  portrait: { width: 180, height: 230 },
  landscape: { width: 265, height: 150 },
};

/**
 * Paper size of one SVG px when printing. The emitter draws in px; the print
 * route picks the px-per-metre so that a px is a fixed paper length at every
 * scale, which makes text heights and line weights paper-constant — a 10 px
 * label prints 2.5 mm tall at 1:50 and at 1:500 alike instead of shrinking
 * with the denominator (#288). The default 50 px/m at 1:80 is the same
 * 0.25 mm/px, so the printed plan looks like the on-screen SVG export.
 */
const PRINT_MM_PER_PX = 0.25;

/** Annotation margin on paper: the emitter's default 60 px band. */
const PRINT_MARGIN_MM = DEFAULT_SVG_MARGIN * PRINT_MM_PER_PX;

export interface PrintScale {
  /** Scale denominator: the plan is drawn at 1:denominator. */
  denominator: number;
  orientation: PrintOrientation;
  /**
   * False when even the coarsest scale overflows A4: the page then prints
   * the plan shrunk to the printable width and the label says so instead of
   * claiming a scale that isn't honoured (#288).
   */
  fits: boolean;
}

/** px per metre that maps the given scale onto `PRINT_MM_PER_PX` paper px. */
export function printPxPerMetre(denominator: number): number {
  return 1000 / (denominator * PRINT_MM_PER_PX);
}

/**
 * Pick the finest standard scale (1:n) and the page orientation at which the
 * whole sheet — plan content plus the annotation margin — fits the A4
 * printable area. Portrait is preferred at each scale; landscape is tried
 * before moving to the next coarser denominator. `fits` is false when
 * nothing fits, with the coarsest denominator and landscape reported.
 */
export function pickPrintScale(contentWidthM: number, contentHeightM: number): PrintScale {
  for (const denominator of SCALE_DENOMINATORS) {
    const widthMm = (contentWidthM * 1000) / denominator + 2 * PRINT_MARGIN_MM;
    const heightMm = (contentHeightM * 1000) / denominator + 2 * PRINT_MARGIN_MM;
    for (const orientation of ['portrait', 'landscape'] as const) {
      const page = PRINTABLE_MM[orientation];
      if (widthMm <= page.width && heightMm <= page.height) return { denominator, orientation, fits: true };
    }
  }
  return { denominator: SCALE_DENOMINATORS[SCALE_DENOMINATORS.length - 1]!, orientation: 'landscape', fits: false };
}

/** Human-readable scale for the title block. */
export function printScaleLabel(scale: PrintScale): string {
  if (!scale.fits) return `Not to scale — exceeds A4 even at 1:${scale.denominator}, shrunk to fit`;
  return `1:${scale.denominator} (A4 ${scale.orientation})`;
}

/** Open a print-ready, true-to-scale vector plan of the given floor. */
export function openPlanPrintWindow(layout: RoomLayout, floor: FloorLayout): void {
  // The sheet follows the plan content (room + outdoor items, #287), so the
  // scale is chosen for that extent, not the room alone.
  const content = planContentBounds(layout, floor);
  const scale = pickPrintScale(content.maxX - content.minX, content.maxZ - content.minZ);
  const pxPerMetre = printPxPerMetre(scale.denominator);
  const svg = layoutToSvg(layout, floor, { pxPerMetre });
  const sheet = planSheetSize(layout, floor, { pxPerMetre });

  const html = renderPrintHtml({
    title: `${layout.name} — ${floor.name}`,
    layoutName: layout.name,
    floorName: floor.name,
    dims: `${layout.width} m × ${layout.height} m`,
    itemCount: floor.items.length,
    scaleLabel: printScaleLabel(scale),
    date: new Date().toLocaleDateString(),
    orientation: scale.orientation,
    // Outsized: let the plan fill the printable width (the label already
    // says it is not to scale) rather than run off the page.
    sheetWidthCss: scale.fits ? `${(sheet.widthPx * PRINT_MM_PER_PX).toFixed(1)}mm` : '100%',
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
  orientation: PrintOrientation;
  /** CSS width of the plan block: the sheet in mm, or 100% when not to scale. */
  sheetWidthCss: string;
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
      @page { size: A4 ${input.orientation}; margin: 12mm; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; }
      .plan { width: ${input.sheetWidthCss}; }
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
