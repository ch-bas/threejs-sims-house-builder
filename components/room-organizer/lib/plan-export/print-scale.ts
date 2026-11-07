/**
 * The print-to-scale maths (#230, #435): paper sizes, the scale picked for a
 * plan, and which items a sheet keeps. The options panel and the 2D plan's
 * fit read these on every render, so they live apart from the print
 * document (print.ts), which loads only when Print is pressed (#589).
 */

import { isWallMounted } from '../opening-snap';
import { DEFAULT_SVG_MARGIN, planFrameBounds, unionBounds } from './plan-geometry';
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
export const PAGE_MARGIN_MM = 12;

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
export const PRINT_MM_PER_PX = 0.25;

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
export function sheetMm(contentWidthM: number, contentHeightM: number, denominator: number): { width: number; height: number } {
  return {
    width: (contentWidthM * 1000) / denominator + 2 * PRINT_MARGIN_MM,
    height: (contentHeightM * 1000) / denominator + 2 * PRINT_MARGIN_MM,
  };
}

/** How much a sheet must shrink to fit the page: 1 when it already fits. */
export function shrinkFactor(sheet: { width: number; height: number }, page: { width: number; height: number }): number {
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

/** The floors a print draws, the frame they share and the scale chosen for it. */
export function resolvePrint(layout: RoomLayout, floor: FloorLayout, options: Partial<PrintOptions>) {
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
