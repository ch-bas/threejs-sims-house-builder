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
import { isWallMounted } from '../opening-snap';
import { itemSchedule, planFrameBounds, unionBounds, type ScheduleRow } from './plan-geometry';
import { DEFAULT_SVG_MARGIN, layoutToSvg, planSheetSize } from './svg';
import type { FloorLayout, RoomLayout } from '../types';

/** Standard scale denominators, finest first (#288: coarse end extended
 * so a whole lot still fits a page rather than being cut off at 1:200). */
export const SCALE_DENOMINATORS = [20, 25, 50, 75, 100, 125, 200, 250, 500, 1000] as const;

export type PrintOrientation = 'portrait' | 'landscape';

export type PaperSize = 'A4' | 'A3' | 'Letter';

export const PAPER_SIZES: readonly PaperSize[] = ['A4', 'A3', 'Letter'];

/** Sheet dimensions in mm, short edge first. */
const PAPER_MM: Record<PaperSize, { short: number; long: number }> = {
  A4: { short: 210, long: 297 },
  A3: { short: 297, long: 420 },
  Letter: { short: 215.9, long: 279.4 },
};

/** The page margin, as declared in the `@page` rule. */
const PAGE_MARGIN_MM = 12;

/**
 * What the page margins, the title block below the plan and a little slack
 * take from the sheet, in mm. Portrait loses more height than landscape
 * because the title block's rows wrap on the narrower page. On A4 this is
 * the 180 × 230 mm portrait and 265 × 150 mm landscape plan area the route
 * has always used.
 */
const RESERVED_MM: Record<PrintOrientation, { width: number; height: number }> = {
  portrait: { width: 2 * PAGE_MARGIN_MM + 6, height: 2 * PAGE_MARGIN_MM + 43 },
  landscape: { width: 2 * PAGE_MARGIN_MM + 8, height: 2 * PAGE_MARGIN_MM + 36 },
};

/** The plan area of one sheet, in mm. */
export function printableArea(paper: PaperSize, orientation: PrintOrientation): { width: number; height: number } {
  const { short, long } = PAPER_MM[paper];
  const [width, height] = orientation === 'portrait' ? [short, long] : [long, short];
  const reserved = RESERVED_MM[orientation];
  return { width: width - reserved.width, height: height - reserved.height };
}

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

/** How far past a wall an item's centre may sit and still count as indoors (m). */
const INDOOR_TOLERANCE_M = 0.05;

/** What the person chose in the print options (#435, #405). */
export interface PrintOptions {
  paper: PaperSize;
  /** `auto` picks portrait, or landscape when only that fits. */
  orientation: PrintOrientation | 'auto';
  /** A fixed 1:n, or `auto` for the finest standard scale that fits. */
  denominator: number | 'auto';
  /** False fits the sheet to the house: items whose centre is outside the walls are left off. */
  includeOutdoor: boolean;
  /** Every storey, one per page, all at the same scale. */
  allFloors: boolean;
  /** The floor's item schedule under the title block (#424). */
  schedule: boolean;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  paper: 'A4',
  orientation: 'auto',
  denominator: 'auto',
  includeOutdoor: true,
  allFloors: false,
  schedule: false,
};

export type PrintScaleOptions = Partial<Pick<PrintOptions, 'paper' | 'orientation' | 'denominator'>>;

export interface PrintScale {
  /** Scale denominator: the plan is drawn at 1:denominator. */
  denominator: number;
  orientation: PrintOrientation;
  paper: PaperSize;
  /**
   * False when the plan overflows the page at the chosen scale (or, on
   * auto, even at the coarsest one): the page then prints it shrunk to fit
   * and the label says so instead of claiming a scale that isn't honoured
   * (#288).
   */
  fits: boolean;
}

/** px per metre that maps the given scale onto `PRINT_MM_PER_PX` paper px. */
export function printPxPerMetre(denominator: number): number {
  return 1000 / (denominator * PRINT_MM_PER_PX);
}

/** The whole sheet — plan content plus the annotation margin — on paper, in mm. */
function sheetMm(contentWidthM: number, contentHeightM: number, denominator: number): { width: number; height: number } {
  return {
    width: (contentWidthM * 1000) / denominator + 2 * PRINT_MARGIN_MM,
    height: (contentHeightM * 1000) / denominator + 2 * PRINT_MARGIN_MM,
  };
}

/** How much a sheet must shrink to fit the page: 1 when it already fits. */
function shrinkFactor(sheet: { width: number; height: number }, page: { width: number; height: number }): number {
  return Math.min(1, page.width / sheet.width, page.height / sheet.height);
}

/**
 * Pick the scale (1:n) and page orientation for a plan whose content spans
 * `contentWidthM` × `contentHeightM`. On auto, the finest standard scale at
 * which the whole sheet fits the printable area wins; portrait is preferred
 * at each scale and landscape tried before the next coarser denominator. A
 * fixed denominator or orientation is honoured as given. When nothing fits,
 * `fits` is false and the orientation is the one that shrinks the plan least.
 */
export function pickPrintScale(contentWidthM: number, contentHeightM: number, options: PrintScaleOptions = {}): PrintScale {
  const paper = options.paper ?? 'A4';
  const orientations: readonly PrintOrientation[] =
    options.orientation === undefined || options.orientation === 'auto' ? ['portrait', 'landscape'] : [options.orientation];
  const denominators: readonly number[] =
    options.denominator === undefined || options.denominator === 'auto' ? SCALE_DENOMINATORS : [options.denominator];

  for (const denominator of denominators) {
    const sheet = sheetMm(contentWidthM, contentHeightM, denominator);
    for (const orientation of orientations) {
      const page = printableArea(paper, orientation);
      if (sheet.width <= page.width && sheet.height <= page.height) return { denominator, orientation, paper, fits: true };
    }
  }

  const denominator = denominators[denominators.length - 1]!;
  const sheet = sheetMm(contentWidthM, contentHeightM, denominator);
  let best = orientations[0]!;
  for (const orientation of orientations) {
    if (shrinkFactor(sheet, printableArea(paper, orientation)) > shrinkFactor(sheet, printableArea(paper, best))) best = orientation;
  }
  return { denominator, orientation: best, paper, fits: false };
}

/** Human-readable scale for the title block. */
export function printScaleLabel(scale: PrintScale): string {
  if (!scale.fits) return `Not to scale — exceeds ${scale.paper} at 1:${scale.denominator}, shrunk to fit`;
  return `1:${scale.denominator} (${scale.paper} ${scale.orientation})`;
}

/**
 * How far an item's centre sits outside the walls, in metres: 0 for an item
 * the sheet always keeps — centre inside the walls (with a little
 * tolerance), mounted on one (doors, windows and cameras sit on the wall
 * line), or not placed at all.
 */
export function distanceOutsideWalls(layout: Pick<RoomLayout, 'width' | 'height'>, item: FloorLayout['items'][number]): number {
  if (!item.position || isWallMounted(item.type)) return 0;
  const beyond = Math.max(Math.abs(item.position.x) - layout.width / 2, Math.abs(item.position.z) - layout.height / 2);
  return beyond > INDOOR_TOLERANCE_M ? beyond : 0;
}

/**
 * The floor as printed: unchanged with outdoor items included, otherwise a
 * copy without the items outside the walls, so the sheet (sized from the
 * drawn content) fits the house and a far tree can't force 1:500 (#435).
 */
export function printedFloor(layout: RoomLayout, floor: FloorLayout, includeOutdoor: boolean): FloorLayout {
  if (includeOutdoor) return floor;
  const items = floor.items.filter((item) => distanceOutsideWalls(layout, item) === 0);
  return items.length === floor.items.length ? floor : { ...floor, items };
}

function resolvePrint(layout: RoomLayout, floor: FloorLayout, options: Partial<PrintOptions>) {
  const opts: PrintOptions = { ...DEFAULT_PRINT_OPTIONS, ...options };
  const sourceFloors = opts.allFloors && layout.floors.length > 0 ? layout.floors : [floor];
  const floors = sourceFloors.map((source) => ({ source, printed: printedFloor(layout, source, opts.includeOutdoor) }));
  // The sheet follows the plan content (room + outdoor items, #287), so the
  // scale is chosen for that extent, not the room alone. Coverage does not
  // grow a printed sheet — a Wi-Fi AP's 10 m rings would push an 8 m house
  // from 1:75 to 1:125 — so it is clipped to this frame on paper. Every page
  // frames the same union, so the rooms sit at the same place page to page
  // (#405).
  const frame = unionBounds(floors.map(({ printed }) => planFrameBounds(layout, printed, 'off')));
  const contentWidthM = frame.maxX - frame.minX;
  const contentHeightM = frame.maxZ - frame.minZ;
  const scale = pickPrintScale(contentWidthM, contentHeightM, opts);
  return { floors, frame, contentWidthM, contentHeightM, scale };
}

/** The scale and page the print options resolve to — what the options panel previews. */
export function resolvePrintScale(layout: RoomLayout, floor: FloorLayout, options: Partial<PrintOptions> = {}): PrintScale {
  return resolvePrint(layout, floor, options).scale;
}

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
  const html = buildPrintDocument(layout, floor, options);

  // Popup pattern shared with lib/blueprint.ts openBlueprintPrintWindow.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.alert('Pop-ups are blocked — allow pop-ups to print the plan.');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
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
          <td class="k">Drawn by</td><td>Three.js Sims-like House Builder</td>
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
  <body onload="setTimeout(function(){ window.print(); }, 200)">
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
  const metres = (value: number): string => String(Math.round(value * 100) / 100);
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const total = rows.reduce((sum, row) => sum + row.totalPrice, 0);
  const lines = [
    ...rows.map(
      (row) =>
        `<tr><td>${escapeHtml(row.name)}</td><td>${metres(row.width)} × ${metres(row.depth)} × ${metres(row.height)}</td>` +
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

// Duplicated from lib/blueprint.ts (private there).
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
