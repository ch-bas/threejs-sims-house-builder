/**
 * Print-to-scale plan export (#230): embeds the vector SVG plan (not a
 * raster) in a print-styled document with a title block and a declared
 * architectural scale, then calls print() — the browser's Save-as-PDF does
 * the rest. Follows the popup pattern of lib/blueprint.ts (which owns the
 * raster blueprint route).
 *
 * The sheet is configurable (#435): paper size and orientation, a fixed or
 * automatic scale, whether items outside the walls are drawn, and whether
 * every storey is printed, one floor per page at one shared scale (#405).
 * Opt-in, each page lists its floor's items under the title block (#424).
 */

import { CURRENCY_SYMBOL } from '../constants';
import { escapeHtml } from '../html-escape';
import { itemSchedule, scheduleSizeText, type ScheduleRow } from './plan-geometry';
import { openPrintPopup, printWhenLoaded } from './print-popup';
import {
  DEFAULT_PRINT_OPTIONS,
  PAGE_MARGIN_MM,
  PRINT_MM_PER_PX,
  printableArea,
  printPxPerMetre,
  printScaleLabel,
  resolvePrint,
  sheetMm,
  shrinkFactor,
  type PaperSize,
  type PrintOptions,
  type PrintOrientation,
} from './print-scale';
import { layoutToSvg, planSheetSize } from './svg';
import type { FloorLayout, RoomLayout } from '../types';

// The scale maths moved to print-scale.ts and popups to print-popup.ts
// (#589); re-exported so print.ts keeps its API.
export {
  DEFAULT_PRINT_OPTIONS,
  distanceOutsideWalls,
  PAPER_SIZES,
  pickPrintScale,
  printableArea,
  printedFloor,
  printPxPerMetre,
  printScaleLabel,
  resolvePrintScale,
  SCALE_DENOMINATORS,
  type PaperSize,
  type PrintOptions,
  type PrintOrientation,
  type PrintScale,
  type PrintScaleOptions,
} from './print-scale';
export { printWhenLoaded } from './print-popup';

/**
 * The print document for the given floor — or, with `allFloors`, for every
 * storey, one per page. Every page shares one scale, chosen for the union of
 * the printed floors' content, so the sheets of a building read together.
 */
export function buildPrintDocument(
  layout: RoomLayout,
  floor: FloorLayout,
  options: Partial<PrintOptions> = {},
  date: string = new Date().toLocaleDateString()
): string {
  const { floors, frame, contentWidthM, contentHeightM, scale } = resolvePrint(layout, floor, options);
  const withSchedule = options.schedule ?? DEFAULT_PRINT_OPTIONS.schedule;
  const pxPerMetre = printPxPerMetre(scale.denominator);
  // Outsized: shrink every page by the same factor (the label already says
  // it is not to scale) rather than run off the page.
  const shrink = shrinkFactor(sheetMm(contentWidthM, contentHeightM, scale.denominator), printableArea(scale.paper, scale.orientation));

  const sheets = floors.map(({ source, printed }, index) => {
    // One frame for every page (#405), and per-sheet ids: the sheets share
    // one HTML page, where `url(#id)` resolves to the first match.
    const svgOptions = { pxPerMetre, bounds: frame, idPrefix: `sheet${index}-` };
    const sheet = planSheetSize(layout, printed, svgOptions);
    // Placed items only: an unplaced one is on neither the plan nor the tally.
    const drawn = printed.items.filter((item) => item.position).length;
    const omitted = source.items.filter((item) => item.position).length - drawn;
    return {
      floorName: floors.length > 1 ? `${source.name} (${index + 1} of ${floors.length})` : source.name,
      itemsLabel: `${drawn} item${drawn === 1 ? '' : 's'}${omitted > 0 ? ` (${omitted} outside the walls left off)` : ''}`,
      sheetWidthCss: `${(sheet.widthPx * PRINT_MM_PER_PX * shrink).toFixed(1)}mm`,
      svg: layoutToSvg(layout, printed, svgOptions),
      // What is drawn is what is listed: items left off the plan are not.
      schedule: withSchedule ? itemSchedule(printed.items) : [],
    };
  });

  return renderPrintHtml({
    title: floors.length > 1 ? `${layout.name} — All floors` : `${layout.name} — ${floor.name}`,
    layoutName: layout.name,
    dims: `${layout.width} m × ${layout.height} m`,
    scaleLabel: printScaleLabel(scale),
    date,
    paper: scale.paper,
    orientation: scale.orientation,
    sheets,
  });
}

/** Open a print-ready, true-to-scale vector plan of the given floor (or of every floor). */
export function openPlanPrintWindow(layout: RoomLayout, floor: FloorLayout, options: Partial<PrintOptions> = {}): void {
  const printWindow = openPrintPopup('the plan');
  if (printWindow) writePlanPrint(printWindow, layout, floor, options);
}

/**
 * Write the print document into a popup the caller opened inside the click,
 * which can then load this module first (#589), and print it once loaded.
 */
export function writePlanPrint(printWindow: Window, layout: RoomLayout, floor: FloorLayout, options: Partial<PrintOptions> = {}): void {
  printWindow.document.write(buildPrintDocument(layout, floor, options));
  printWindow.document.close();
  printWhenLoaded(printWindow);
}

interface PrintSheet {
  floorName: string;
  itemsLabel: string;
  /** CSS width of the plan block: the sheet in mm, shrunk when not to scale. */
  sheetWidthCss: string;
  svg: string;
  /** Item schedule rows; empty prints no table. */
  schedule: readonly ScheduleRow[];
}

interface PrintHtmlInput {
  title: string;
  layoutName: string;
  dims: string;
  scaleLabel: string;
  date: string;
  paper: PaperSize;
  orientation: PrintOrientation;
  sheets: readonly PrintSheet[];
}

function renderPrintHtml(input: PrintHtmlInput): string {
  // The svg string is emitted by layoutToSvg, which XML-escapes all
  // user-supplied text (names, colours), so it is safe to inline.
  const pages = input.sheets
    .map(
      (sheet) => `<section class="sheet">
      <div class="plan" style="width: ${sheet.sheetWidthCss};">${sheet.svg}</div>
      <table class="titleblock">
        <colgroup><col class="k" /><col /><col class="k" /><col /></colgroup>
        <tr>
          <td class="k">Project</td><td>${escapeHtml(input.layoutName)}</td>
          <td class="k">Floor</td><td>${escapeHtml(sheet.floorName)}</td>
        </tr>
        <tr>
          <td class="k">Footprint</td><td>${escapeHtml(input.dims)} · ${escapeHtml(sheet.itemsLabel)}</td>
          <td class="k">Scale</td><td>${escapeHtml(input.scaleLabel)}</td>
        </tr>
        <tr>
          <td class="k">Date</td><td>${escapeHtml(input.date)}</td>
          <td class="k">Drawn by</td><td>House Builder</td>
        </tr>
      </table>${renderScheduleTable(sheet.schedule)}
    </section>`
    )
    .join('\n    ');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(input.title)} — Floor plan</title>
    <style>
      :root { color-scheme: light; }
      @page { size: ${input.paper} ${input.orientation}; margin: ${PAGE_MARGIN_MM}mm; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; }
      .sheet { break-inside: avoid; }
      .sheet + .sheet { break-before: page; }
      .plan svg { display: block; width: 100%; height: auto; }
      /* Fixed layout and anywhere-wrapping: a long unbroken name must wrap
         inside its cell, or the table outgrows the page and the browser
         shrinks the whole sheet off its declared scale. */
      table.titleblock { margin-top: 6mm; border-collapse: collapse; font-size: 9pt; width: 100%; table-layout: fixed; }
      table.titleblock col.k { width: 16%; }
      table.titleblock td { border: 0.3mm solid #444; padding: 1.5mm 3mm; overflow-wrap: anywhere; word-break: break-word; }
      table.titleblock td.k { color: #666; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.05em; }
      .schedule { margin-top: 4mm; }
      .schedule-start { break-inside: avoid; }
      .schedule-title { margin: 0 0 1.5mm; font-weight: 600; font-size: 9pt; break-after: avoid; }
      table.schedule-rows { border-collapse: collapse; font-size: 8pt; width: 100%; table-layout: fixed; }
      table.schedule-rows th, table.schedule-rows td { border-bottom: 0.2mm solid #bbb; padding: 1mm 2mm; text-align: left; overflow-wrap: anywhere; }
      table.schedule-rows th { border-bottom: 0.3mm solid #444; color: #666; font-weight: 600; }
      /* Printed once, at the top: Chrome repeats a table-header-group on every page. */
      table.schedule-rows thead { display: table-row-group; }
      table.schedule-rows .n { text-align: right; font-variant-numeric: tabular-nums; }
      table.schedule-rows col.size { width: 26%; }
      table.schedule-rows col.qty { width: 10%; }
      table.schedule-rows col.price { width: 18%; }
      table.schedule-rows tr.total td { border-bottom: 0; border-top: 0.3mm solid #444; font-weight: 600; }
      table.schedule-rows tr { break-inside: avoid; }
      @media screen { .sheet + .sheet { margin-top: 16mm; } }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  </head>
  <body>
    ${pages}
  </body>
</html>`;
}

/** Rows kept on the page of the schedule's title and column headings. */
const SCHEDULE_LEAD_ROWS = 3;

/**
 * The floor's item schedule as HTML tables (#424): name, W × D × H, count
 * and price per line, and a total as the last row. A long schedule runs on
 * to the next page; the title, the headings and the first rows stay
 * together in one unbreakable block, so the headings never strand at the
 * foot of a page, and nothing repeats on the next one.
 */
function renderScheduleTable(rows: readonly ScheduleRow[]): string {
  if (rows.length === 0) return '';
  const price = (value: number): string => `${CURRENCY_SYMBOL}${Math.round(value).toLocaleString('en-US')}`;
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const total = rows.reduce((sum, row) => sum + row.totalPrice, 0);
  const lines = [
    ...rows.map(
      (row) =>
        `<tr><td>${escapeHtml(row.name)}</td><td>${scheduleSizeText(row)}</td>` +
        `<td class="n">${row.count}</td><td class="n">${row.totalPrice > 0 ? price(row.totalPrice) : '—'}</td></tr>`
    ),
    `<tr class="total"><td>Total</td><td></td><td class="n">${count}</td><td class="n">${price(total)}</td></tr>`,
  ];
  // The total belongs to the rows above it: a schedule of a few lines is one block.
  const lead = lines.length <= SCHEDULE_LEAD_ROWS + 1 ? lines.length : SCHEDULE_LEAD_ROWS;
  const cols = '<colgroup><col /><col class="size" /><col class="qty" /><col class="price" /></colgroup>';
  const rest = lines.slice(lead);
  return `
      <div class="schedule">
        <div class="schedule-start">
          <p class="schedule-title">Item schedule</p>
          <table class="schedule-rows">${cols}
            <thead><tr><th>Item</th><th>W × D × H (m)</th><th class="n">Qty</th><th class="n">Price</th></tr></thead>
            <tbody>${lines.slice(0, lead).join('')}</tbody>
          </table>
        </div>${
          rest.length > 0 ? `
        <table class="schedule-rows">${cols}<tbody>${rest.join('')}</tbody></table>` : ''
        }
      </div>`;
}
