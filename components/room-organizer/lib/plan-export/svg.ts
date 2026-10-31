/**
 * Scalable-vector floor plan export (#230). Pure string emitter — no DOM, no
 * React, no Three.js — so it runs in tests and could run in a worker. The
 * geometry mirrors the 2D top-down view (canvas-2d/render.ts): same grid
 * anchoring, same wall styling, same footprint rotation convention.
 *
 * Sheet furniture (#424): a north arrow in the right margin band, the room's
 * overall dimensions in the bottom and left bands, a dimension string per
 * interior wall and — opt-in, since it lengthens the sheet — an item
 * schedule under the plan. The coverage layer (#420) carries the Wi-Fi/CCTV
 * rings and camera wedges the blueprint draws. `buildingToSvg` stacks every
 * floor on one sheet at a common scale (#405).
 */

import { CURRENCY_SYMBOL } from '../constants';
import { escapeHtml } from '../html-escape';
import { INTERIOR_WALL_THICKNESS } from '../opening-snap';
import { planDrawOrder } from '../plan-order';
import { entrancePlanOutline, planFloorIndex, type EntrancePlanOutline } from '../street';
import { zoneArea } from '../zones';
import {
  buildingFrameBounds,
  coverageRings,
  gridLinePositions,
  doorSwing,
  growBounds,
  interiorWallDimensions,
  isWallHidden,
  itemSchedule,
  openingAxes,
  openingGap,
  planContentBounds,
  planFrameBounds,
  polarPoint,
  roomDimensions,
  scheduleSizeText,
  splitPlanItems,
  stairArrow,
  stairCutHatch,
  stairTreadSegments,
  stairwellOutlines,
  visionWedges,
  wallOpeningDimensions,
  type CoverageMode,
  type OpeningChain,
  type PlacedItem,
  type PlanBounds,
  type PlanDimension,
  type PlanPoint,
  type ScheduleRow,
} from './plan-geometry';
import type { FloorLayout, RoomLayout, WallId } from '../types';

/** Line colours; defaults match the blueprint / 2D-view look. */
export interface SvgPlanTheme {
  /** Page + opening-gap colour. */
  background: string;
  grid: string;
  wall: string;
  hiddenWall: string;
  interiorWall: string;
  furnitureStroke: string;
  label: string;
  opening: string;
  /** Dimension lines, ticks and their labels (#424). */
  dimension: string;
  /** Wi-Fi rings, inner to outer (#420). */
  wifiRings: readonly [string, string, string];
  /** CCTV rings, inner to outer (#420). */
  cctvRings: readonly [string, string, string];
  /** Camera vision wedges (#420). */
  vision: string;
}

export interface SvgExportOptions {
  /** Pixels per metre; the default 50 keeps a 10 m room at a crisp 500 px. */
  pxPerMetre?: number;
  /** Margin (px) around the plan content for the title, dimensions, and scale bar. */
  margin?: number;
  theme?: Partial<SvgPlanTheme>;
  /**
   * Wi-Fi/CCTV rings and camera wedges under the furniture (#420). On by
   * default: the sheet grows to show coverage up to `COVERAGE_MARGIN_M`
   * past the plan content and clips it there; `'full'` grows it to all of
   * the coverage; `false` leaves the layer out.
   */
  coverage?: boolean | 'full';
  /** Room and interior-wall dimension strings (default on, #424). */
  dimensions?: boolean;
  /**
   * A chain of dimensions along each exterior wall with an opening (default
   * off, #630): needs `dimensions`, and adds a band around the plan on every
   * sheet, so the print route's fixed margin leaves it out.
   */
  openingDimensions?: boolean;
  /**
   * An item schedule table under the plan; lengthens the sheet (default off,
   * #424). A floor with no placed items gets no table.
   */
  schedule?: boolean;
  /**
   * The rectangle to frame, in world metres, in place of the floor's own
   * `planFrameBounds` — e.g. the union of every floor's frame
   * (`buildingFrameBounds`) so every floor's sheet has the same size and the
   * rooms line up (#405). Coverage is clipped to it; it should contain the
   * floor's content, or what pokes out is drawn in the margin.
   */
  bounds?: PlanBounds;
  /**
   * Prefix for the element ids the sheet defines (the coverage clip path),
   * so several sheets inlined in one HTML page don't share ids — a page
   * resolves `url(#id)` to the first element with that id.
   */
  idPrefix?: string;
}

/** The plan-geometry coverage mode for these options. */
function svgCoverageMode(options: Pick<SvgExportOptions, 'coverage'>): CoverageMode {
  if (options.coverage === false) return 'off';
  return options.coverage === 'full' ? 'full' : 'capped';
}

/** The sheet `layoutToSvg` draws on, in SVG px and in world metres. */
export interface SvgSheetSize {
  widthPx: number;
  heightPx: number;
  widthM: number;
  heightM: number;
}

const DEFAULT_SVG_PX_PER_METRE = 50;
export const DEFAULT_SVG_MARGIN = 60;

// Colours match canvas-2d/render.ts: #ddd grid, #666 walls (3px), #bbb dashed
// hidden walls, #555 interior walls, #333 furniture stroke.
const DEFAULT_THEME: SvgPlanTheme = {
  background: '#ffffff',
  grid: '#dddddd',
  wall: '#666666',
  hiddenWall: '#bbbbbb',
  interiorWall: '#555555',
  furnitureStroke: '#333333',
  label: '#333333',
  opening: '#444444',
  dimension: '#555555',
  // The hues of render.ts WIFI_RING_* / CCTV_RING_*; the opacities below
  // match its rgba() alphas ring by ring.
  wifiRings: ['#00ff00', '#ffff00', '#ff6600'],
  cctvRings: ['#0088ff', '#00ddff', '#8800ff'],
  // A deeper cyan than the canvas's #7ff3ff, which vanishes on white paper.
  vision: '#14b8d4',
};

/** [fill, stroke] opacity per ring, inner to outer (render.ts *_RING_FILLS / *_RING_STROKES). */
const WIFI_RING_OPACITY = [
  [0.15, 0.4],
  [0.1, 0.3],
  [0.08, 0.2],
] as const;
const CCTV_RING_OPACITY = [
  [0.12, 0.4],
  [0.08, 0.3],
  [0.06, 0.2],
] as const;

/** Minimum footprint edge (px) before an in-rect name label is legible. */
const MIN_LABEL_EDGE_PX = 22;

/** Gap between the plan content and a room dimension line, px. */
const DIMENSION_OFFSET_PX = 14;
/** Offset of an interior wall's dimension line off the wall's centreline, px. */
const WALL_DIMENSION_OFFSET_PX = 10;
/** Half-length of a dimension line's end tick, px. */
const DIMENSION_TICK_PX = 4;
/** Distance from a dimension line to the centre of its label, px. */
const DIMENSION_LABEL_GAP_PX = 8;
/** Band the opening chains add between the plan content and the room dimensions, px, for two label rows (#630). */
const OPENING_CHAIN_BAND_PX = 30;
/** Further out per label row of an opening chain, px. */
const OPENING_CHAIN_ROW_PX = 10;
/** Centre to centre of two chain labels on one row, px: "0.90 m" at 10 px and a little air. */
const OPENING_CHAIN_LABEL_SPACING_PX = 36;

/** Item schedule table width and row pitch, px (#424). */
const SCHEDULE_WIDTH_PX = 400;
const SCHEDULE_ROW_PX = 16;
/** Space above the first row: the gap, the heading and the column header. */
const SCHEDULE_HEAD_PX = 52;
/** Longest item name the schedule prints before eliding. */
const SCHEDULE_NAME_CHARS = 32;

/**
 * Size of the sheet `layoutToSvg` emits for the same layout, floor and
 * options: the plan content (room + every placed item, outdoor ones
 * included) plus the annotation margin on each side, and the item schedule
 * when it is on. The print route sizes its page from this rather than
 * re-deriving room + margin, which clipped garden items (#287).
 */
export function planSheetSize(layout: RoomLayout, floor: FloorLayout, options: SvgExportOptions = {}): SvgSheetSize {
  const { scale, widthPx, heightPx } = sheetLayout(layout, floor, options);
  return { widthPx, heightPx, widthM: widthPx / scale, heightM: heightPx / scale };
}

/**
 * Render one floor of a building as a standalone SVG floor plan: room
 * outline, grid, coverage, interior walls, door/window marks, furniture as
 * rotated rects with name labels, dimensions, a north arrow, a scale bar,
 * the floor name and, opt-in, the item schedule.
 */
export function layoutToSvg(layout: RoomLayout, floor: FloorLayout, options: SvgExportOptions = {}): string {
  const sheet = renderSheet(layout, floor, options, options.idPrefix ?? '');
  return [
    svgOpen(sheet.widthPx, sheet.heightPx),
    `<title>${escapeHtml(`${layout.name} — ${floor.name}`)}</title>`,
    ...sheet.body,
    `</svg>`,
  ].join('\n');
}

/**
 * The whole building on one SVG (#405): every floor's sheet, ground floor
 * first, stacked top to bottom at the same scale, each in a `floor-sheet`
 * group with its own title, dimensions and scale bar. Every sheet frames the
 * building's content bounds (unless `options.bounds` says otherwise), so the
 * storeys sit exactly above one another down the page.
 */
export function buildingToSvg(layout: RoomLayout, options: SvgExportOptions = {}): string {
  const theme: SvgPlanTheme = { ...DEFAULT_THEME, ...options.theme };
  const sheetOptions: SvgExportOptions = { ...options, bounds: options.bounds ?? buildingFrameBounds(layout, svgCoverageMode(options)) };
  const prefix = options.idPrefix ?? '';
  const sheets = layout.floors.map((floor, index) => ({ floor, sheet: renderSheet(layout, floor, sheetOptions, `${prefix}f${index}-`) }));
  const widthPx = Math.max(0, ...sheets.map(({ sheet }) => sheet.widthPx));
  const heightPx = sheets.reduce((sum, { sheet }) => sum + sheet.heightPx, 0);
  const parts: string[] = [
    svgOpen(widthPx, heightPx),
    `<title>${escapeHtml(layout.name)}</title>`,
    `<rect width="${fmt(widthPx)}" height="${fmt(heightPx)}" fill="${theme.background}"/>`,
  ];
  let top = 0;
  sheets.forEach(({ floor, sheet }, index) => {
    if (index > 0) {
      parts.push(
        `<line class="sheet-break" x1="0" y1="${fmt(top)}" x2="${fmt(widthPx)}" y2="${fmt(top)}" stroke="${theme.grid}" stroke-width="1"/>`
      );
    }
    parts.push(`<g class="floor-sheet" data-floor="${escapeHtml(floor.id)}" transform="translate(0 ${fmt(top)})">`, ...sheet.body, `</g>`);
    top += sheet.heightPx;
  });
  parts.push(`</svg>`);
  return parts.join('\n');
}

function svgOpen(widthPx: number, heightPx: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(widthPx)} ${fmt(heightPx)}" width="${fmt(widthPx)}" height="${fmt(heightPx)}" font-family="Helvetica, Arial, sans-serif">`;
}

function openingChains(layout: RoomLayout, floor: FloorLayout, options: SvgExportOptions, scale: number): OpeningChain[] {
  if (options.openingDimensions !== true || options.dimensions === false) return [];
  return wallOpeningDimensions(layout, floor, OPENING_CHAIN_LABEL_SPACING_PX / scale);
}

/**
 * The band around the plan for the opening chains, px; 0 without them. It
 * fits the busiest storey and every sheet takes it, so storeys stacked on one
 * sheet line up, as they do with no chains.
 */
function openingChainBand(layout: RoomLayout, floor: FloorLayout, options: SvgExportOptions, scale: number): number {
  if (options.openingDimensions !== true || options.dimensions === false) return 0;
  const rows = [floor, ...layout.floors].flatMap((candidate) => openingChains(layout, candidate, options, scale).flatMap((chain) => chain.segments.map((segment) => segment.labelRow)));
  return OPENING_CHAIN_BAND_PX + OPENING_CHAIN_ROW_PX * Math.max(0, Math.max(0, ...rows) - 1);
}

interface SheetLayout {
  scale: number;
  margin: number;
  /** The extra band around the plan for the opening chains, px; 0 without them. */
  chainBand: number;
  /** Plan content grown by the margin band, in world metres. */
  bounds: PlanBounds;
  /** The plan part of the sheet (content + margin band), px. */
  planWidthPx: number;
  planHeightPx: number;
  schedule: ScheduleRow[] | null;
  widthPx: number;
  heightPx: number;
}

/** The sheet's geometry, shared by `planSheetSize` and the renderer so the two cannot drift. */
function sheetLayout(layout: RoomLayout, floor: FloorLayout, options: SvgExportOptions): SheetLayout {
  const scale = options.pxPerMetre ?? DEFAULT_SVG_PX_PER_METRE;
  const margin = options.margin ?? DEFAULT_SVG_MARGIN;
  const frame = options.bounds ?? planFrameBounds(layout, floor, svgCoverageMode(options));
  const chainBand = openingChainBand(layout, floor, options, scale);
  const bounds = growBounds(frame, (margin + chainBand) / scale);
  const planWidthPx = (bounds.maxX - bounds.minX) * scale;
  const planHeightPx = (bounds.maxZ - bounds.minZ) * scale;
  // A floor with nothing placed has nothing to list: no empty table.
  const rows = options.schedule ? itemSchedule(floor.items) : [];
  const schedule = rows.length > 0 ? rows : null;
  // Heading + one row per line + the total row, then half a margin of paper.
  const scheduleHeightPx = schedule ? SCHEDULE_HEAD_PX + SCHEDULE_ROW_PX * (schedule.length + 1) + margin / 2 : 0;
  return {
    scale,
    margin,
    chainBand,
    bounds,
    planWidthPx,
    planHeightPx,
    schedule,
    widthPx: schedule ? Math.max(planWidthPx, SCHEDULE_WIDTH_PX + 2 * margin) : planWidthPx,
    heightPx: planHeightPx + scheduleHeightPx,
  };
}

interface SvgSheet {
  widthPx: number;
  heightPx: number;
  /** Everything inside the root `<svg>`, in sheet px. */
  body: string[];
}

/** One floor's sheet; `idPrefix` keeps element ids unique when sheets share a document. */
function renderSheet(layout: RoomLayout, floor: FloorLayout, options: SvgExportOptions, idPrefix: string): SvgSheet {
  const sheet = sheetLayout(layout, floor, options);
  const { scale, margin, bounds, chainBand } = sheet;
  const theme: SvgPlanTheme = { ...DEFAULT_THEME, ...options.theme };

  const roomW = layout.width * scale;
  const roomD = layout.height * scale;
  // The sheet follows the content, not the room: outdoor items past the walls
  // used to be cut off by a fixed room + margin viewBox and to overprint the
  // scale bar (#287). The renderers below keep drawing in room coordinates
  // (room top-left at (margin, margin)); the root group translates that
  // origin to where the room sits on the content-fitted sheet, which is a
  // no-op when nothing pokes out past the walls.
  const totalW = sheet.planWidthPx;
  const totalH = sheet.planHeightPx;
  const rootX = (-layout.width / 2 - bounds.minX) * scale - margin;
  const rootY = (-layout.height / 2 - bounds.minZ) * scale - margin;
  // World (metres, origin at room centre) → room-coordinate px.
  const px = (x: number): string => fmt(margin + (x + layout.width / 2) * scale);
  const py = (z: number): string => fmt(margin + (z + layout.height / 2) * scale);
  // The framed rectangle (content, grown for coverage): the sheet less its
  // margin band. Coverage is clipped to it; the room dimensions hug the
  // plan content itself.
  const marginM = (margin + chainBand) / scale;
  const frame: PlanBounds = {
    minX: bounds.minX + marginM,
    minZ: bounds.minZ + marginM,
    maxX: bounds.maxX - marginM,
    maxZ: bounds.maxZ - marginM,
  };
  const content = planContentBounds(layout, floor);

  // Same bottom-to-top layer order as the on-screen plan (#286).
  const { openings, furniture } = splitPlanItems(planDrawOrder(floor.items));
  const title = `${layout.name} — ${floor.name}`;

  const body: string[] = [
    `<rect width="${fmt(sheet.widthPx)}" height="${fmt(sheet.heightPx)}" fill="${theme.background}"/>`,
    `<g class="plan" transform="translate(${fmt(rootX)} ${fmt(rootY)})">`,
    `<rect x="${fmt(margin)}" y="${fmt(margin)}" width="${fmt(roomW)}" height="${fmt(roomD)}" fill="${escapeHtml(floor.floorColor)}"/>`,
    renderGrid(layout, margin, scale, theme),
    renderZones(floor, entrancePlanOutline(layout, planFloorIndex(layout.floors, floor)), px, py, scale, theme),
    renderRoomOutline(layout, floor, margin, scale, theme),
    renderInteriorWalls(floor, px, py, scale, theme),
    renderStairwellHoles(layout, floor, px, py, theme),
    options.coverage === false ? '' : renderCoverage(floor, px, py, scale, frame, theme, idPrefix),
    ...openings.map((item) => renderOpening(item, px, py, scale, theme)),
    ...furniture.map((item) => renderFurniture(item, px, py, scale, theme)),
    renderStairCutHatch(layout, floor, px, py, theme),
    options.dimensions === false ? '' : renderDimensions(layout, floor, px, py, content, theme, openingChains(layout, floor, options, scale), chainBand),
    `</g>`,
    // Annotations sit in the margin band around the content — the content
    // spans (margin, margin) → (totalW − margin, totalH − margin) on the
    // sheet — so no item can overprint them.
    renderTitleBlock(title, `${fmt(layout.width)} m × ${fmt(layout.height)} m`, margin, totalW, theme),
    renderNorthArrow(totalW - margin / 2, margin, theme),
    renderScaleBar(layout, margin, scale, totalH, theme),
    sheet.schedule ? renderSchedule(sheet.schedule, margin, totalH, theme) : '',
  ];
  return { widthPx: sheet.widthPx, heightPx: sheet.heightPx, body: body.filter((part) => part !== '') };
}

function renderGrid(layout: RoomLayout, margin: number, scale: number, theme: SvgPlanTheme): string {
  const segments: string[] = [];
  const top = margin;
  const bottom = margin + layout.height * scale;
  const left = margin;
  const right = margin + layout.width * scale;
  for (const wx of gridLinePositions(layout.width)) {
    const sx = fmt(margin + (wx + layout.width / 2) * scale);
    segments.push(`M ${sx} ${fmt(top)} V ${fmt(bottom)}`);
  }
  for (const wz of gridLinePositions(layout.height)) {
    const sy = fmt(margin + (wz + layout.height / 2) * scale);
    segments.push(`M ${fmt(left)} ${sy} H ${fmt(right)}`);
  }
  return `<path class="grid" d="${segments.join(' ')}" stroke="${theme.grid}" stroke-width="1" fill="none"/>`;
}

function renderRoomOutline(
  layout: RoomLayout,
  floor: FloorLayout,
  margin: number,
  scale: number,
  theme: SvgPlanTheme
): string {
  // Per-edge like canvas-2d/render.ts drawRoomOutline: a hidden wall reads as
  // a light dashed boundary instead of a solid wall.
  const x0 = margin;
  const y0 = margin;
  const x1 = margin + layout.width * scale;
  const y1 = margin + layout.height * scale;
  // The recessed entrance (#285), as the 2D view draws it: the north edge
  // breaks across the opening, the two cheeks run back to the recess's rear
  // wall (an interior wall, emitted with the others), and the recess is
  // painted in the page colour over the floor, grid and zones — outside.
  const recess = entrancePlanOutline(layout, planFloorIndex(layout.floors, floor));
  const rx0 = recess ? margin + (recess.x0 + layout.width / 2) * scale : x0;
  const rx1 = recess ? margin + (recess.x1 + layout.width / 2) * scale : x1;
  const ry1 = recess ? margin + (recess.backZ + layout.height / 2) * scale : y0;
  type Edge = { id: WallId; x1: number; y1: number; x2: number; y2: number };
  const north: Edge[] = recess
    ? [
        { id: 'north', x1: x0, y1: y0, x2: rx0, y2: y0 },
        { id: 'north', x1: rx0, y1: y0, x2: rx0, y2: ry1 },
        { id: 'north', x1: rx1, y1: y0, x2: rx1, y2: ry1 },
        { id: 'north', x1: rx1, y1: y0, x2: x1, y2: y0 },
      ]
    : [{ id: 'north', x1: x0, y1: y0, x2: x1, y2: y0 }];
  const edges: Edge[] = [
    ...north,
    { id: 'south', x1: x0, y1: y1, x2: x1, y2: y1 },
    { id: 'west', x1: x0, y1: y0, x2: x0, y2: y1 },
    { id: 'east', x1: x1, y1: y0, x2: x1, y2: y1 },
  ];
  const lines = edges.map((edge) => {
    const hidden = isWallHidden(floor, edge.id);
    const style = hidden
      ? `stroke="${theme.hiddenWall}" stroke-width="1.5" stroke-dasharray="6 4"`
      : `stroke="${theme.wall}" stroke-width="3"`;
    return `<line class="wall" x1="${fmt(edge.x1)}" y1="${fmt(edge.y1)}" x2="${fmt(edge.x2)}" y2="${fmt(edge.y2)}" ${style}/>`;
  });
  if (recess) {
    lines.unshift(
      `<rect class="entrance" x="${fmt(rx0)}" y="${fmt(y0)}" width="${fmt(rx1 - rx0)}" height="${fmt(ry1 - y0)}" fill="${theme.background}"/>`
    );
  }
  return lines.join('\n');
}

/**
 * Room zones (#155) as tinted rects with the name and area along the top
 * edge (the centre is where the furniture sits) — between the grid and the
 * walls, like canvas-2d/render.ts paints them.
 */
function renderZones(
  floor: FloorLayout,
  recess: EntrancePlanOutline | null,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  theme: SvgPlanTheme
): string {
  const zones = floor.zones ?? [];
  if (zones.length === 0) return '';
  return zones
    .map((zone) => {
      const color = escapeHtml(zone.color);
      const cx = fmt(Number(px(zone.x)) + (zone.w * scale) / 2);
      const top = fmt(Number(py(zone.z)) + 15);
      return [
        `<g class="zone">`,
        `<rect x="${px(zone.x)}" y="${py(zone.z)}" width="${fmt(zone.w * scale)}" height="${fmt(zone.d * scale)}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-opacity="0.7" stroke-width="1.5"/>`,
        `<text x="${cx}" y="${top}" font-size="12" font-weight="bold" text-anchor="middle" fill="${theme.label}">${escapeHtml(zone.name)}</text>`,
        `<text x="${cx}" y="${top}" dy="1.2em" font-size="10" text-anchor="middle" fill="${theme.label}">${zoneArea(zone, recess).toFixed(1)} m²</text>`,
        `</g>`,
      ].join('');
    })
    .join('\n');
}

function renderInteriorWalls(
  floor: FloorLayout,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  theme: SvgPlanTheme
): string {
  const walls = floor.interiorWalls ?? [];
  if (walls.length === 0) return '';
  const width = fmt(Math.max(2, INTERIOR_WALL_THICKNESS * scale));
  const lines = walls.map(
    (wall) =>
      `<line class="interior-wall" x1="${px(wall.x1)}" y1="${py(wall.z1)}" x2="${px(wall.x2)}" y2="${py(wall.z2)}" stroke="${theme.interiorWall}" stroke-width="${width}" stroke-linecap="butt"/>`
  );
  return lines.join('\n');
}

/**
 * The coverage layer (#420): Wi-Fi and CCTV rings and each camera's vision
 * wedge, from the same maths as the 2D view and the blueprint, clipped to the
 * plan content so a long-range camera does not run over the margin band.
 * Drawn under openings and furniture, like the canvas.
 */
function renderCoverage(
  floor: FloorLayout,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  content: PlanBounds,
  theme: SvgPlanTheme,
  idPrefix: string
): string {
  const parts: string[] = [];
  for (const { kind, center, radii } of coverageRings(floor.items)) {
    const colours = kind === 'wifi' ? theme.wifiRings : theme.cctvRings;
    const opacities = kind === 'wifi' ? WIFI_RING_OPACITY : CCTV_RING_OPACITY;
    // Outer ring first, like the canvas, so the inner rings stack their tint.
    for (let ring = 2; ring >= 0; ring--) {
      const colour = escapeHtml(colours[ring] ?? theme.grid);
      const [fillOpacity, strokeOpacity] = opacities[ring] ?? [0, 0];
      parts.push(
        `<circle class="${kind}-ring" cx="${px(center.x)}" cy="${py(center.z)}" r="${fmt((radii[ring] ?? 0) * scale)}" fill="${colour}" fill-opacity="${fillOpacity}" stroke="${colour}" stroke-opacity="${strokeOpacity}" stroke-width="1"/>`
      );
    }
  }
  const vision = escapeHtml(theme.vision);
  const style = `fill="${vision}" fill-opacity="0.14" stroke="${vision}" stroke-opacity="0.7" stroke-width="1"`;
  for (const wedge of visionWedges(floor.items)) {
    const r = fmt(wedge.radius * scale);
    if (wedge.full) {
      parts.push(`<circle class="vision" cx="${px(wedge.apex.x)}" cy="${py(wedge.apex.z)}" r="${r}" ${style}/>`);
      continue;
    }
    const start = polarPoint(wedge.apex, wedge.radius, wedge.startAngle);
    const end = polarPoint(wedge.apex, wedge.radius, wedge.endAngle);
    const large = wedge.endAngle - wedge.startAngle > Math.PI ? 1 : 0;
    // Plan angles grow clockwise on the sheet, which is SVG's positive sweep.
    parts.push(
      `<path class="vision" d="M ${px(wedge.apex.x)} ${py(wedge.apex.z)} L ${px(start.x)} ${py(start.z)} A ${r} ${r} 0 ${large} 1 ${px(end.x)} ${py(end.z)} Z" ${style}/>`
    );
  }
  if (parts.length === 0) return '';
  const clipId = `${idPrefix}coverage-clip`;
  return [
    `<clipPath id="${clipId}"><rect x="${px(content.minX)}" y="${py(content.minZ)}" width="${fmt((content.maxX - content.minX) * scale)}" height="${fmt((content.maxZ - content.minZ) * scale)}"/></clipPath>`,
    `<g class="coverage" clip-path="url(#${clipId})">`,
    ...parts,
    `</g>`,
  ].join('\n');
}

/** Width of an opening's gap across the wall, in metres. */
const OPENING_GAP_M = 0.2;

/**
 * Door: a gap punched through the wall line plus the conventional quarter-arc
 * swing (leaf hinged at one jamb, opening into the room — for wall-snapped
 * rotations the local +Y of the rotated group points into the room).
 * Window: a gap with a frame rect and a centre line (double-line symbol).
 */
function renderOpening(
  item: PlacedItem,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  theme: SvgPlanTheme
): string {
  const w = item.width * scale;
  const gapPoints = openingGap(item, OPENING_GAP_M)
    .map((p) => `${px(p.x)},${py(p.z)}`)
    .join(' ');
  const parts: string[] = [`<g class="opening" data-type="${escapeHtml(item.type)}">`];
  parts.push(`<polygon points="${gapPoints}" fill="${theme.background}"/>`);
  if (item.type === 'door') {
    // World points, shared with the plan and the DXF: mirroring moves the hinge (#386).
    const { hinge, strike, leafTip } = doorSwing(item);
    const sweep = (strike.x - hinge.x) * (leafTip.z - hinge.z) - (strike.z - hinge.z) * (leafTip.x - hinge.x) > 0 ? 1 : 0;
    parts.push(
      `<line x1="${px(hinge.x)}" y1="${py(hinge.z)}" x2="${px(leafTip.x)}" y2="${py(leafTip.z)}" stroke="${theme.opening}" stroke-width="1.5"/>`,
      `<path d="M ${px(strike.x)} ${py(strike.z)} A ${fmt(w)} ${fmt(w)} 0 0 ${sweep} ${px(leafTip.x)} ${py(leafTip.z)}" stroke="${theme.opening}" stroke-width="1" fill="none"/>`
    );
  } else {
    const { along } = openingAxes(item);
    const half = item.width / 2;
    const { x, z } = item.position;
    parts.push(
      `<polygon points="${gapPoints}" fill="none" stroke="${theme.opening}" stroke-width="1"/>`,
      `<line x1="${px(x - along.x * half)}" y1="${py(z - along.z * half)}" x2="${px(x + along.x * half)}" y2="${py(z + along.z * half)}" stroke="${theme.opening}" stroke-width="1"/>`
    );
  }
  parts.push(`</g>`);
  return parts.join('');
}

function renderFurniture(
  item: PlacedItem,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  theme: SvgPlanTheme
): string {
  const w = item.width * scale;
  const d = item.depth * scale;
  // Negated like canvas rotate(): canvas/SVG angles are clockwise while
  // Three's rotateY is CCW, so the plan matches the 3D orientation.
  const degrees = -((item.rotation ?? 0) * 180) / Math.PI;
  const transform = `translate(${px(item.position.x)} ${py(item.position.z)}) rotate(${fmt(degrees)})`;
  const rect = `<rect class="furniture" x="${fmt(-w / 2)}" y="${fmt(-d / 2)}" width="${fmt(w)}" height="${fmt(d)}" fill="${escapeHtml(item.color)}" stroke="${theme.furnitureStroke}" stroke-width="1"/>`;
  // Tiny footprints (cameras, vases) can't carry a legible in-rect label.
  const label =
    Math.min(w, d) >= MIN_LABEL_EDGE_PX
      ? `<text class="label" x="0" y="0" dy="0.35em" font-size="10" text-anchor="middle" fill="${theme.label}"${uprightText(degrees)}>${escapeHtml(item.name)}</text>`
      : '';
  // Stairs carry treads and a climb arrow instead of a name (#290).
  if (item.type === 'stairs') return `<g transform="${transform}">${rect}</g>${renderStairsSymbol(item, px, py, theme)}`;
  return `<g transform="${transform}">${rect}${label}</g>`;
}

/**
 * Keeps an item label readable (#401). It runs along the item's width inside
 * the rotated group, so an item turned past a quarter turn printed it upside
 * down: flip it half a turn so it reads left to right or, on a sideways item,
 * bottom to top — the drafting rule of text readable from the bottom or the
 * right of the sheet.
 */
function uprightText(groupDegrees: number): string {
  return isUpsideDown(groupDegrees) ? ' transform="rotate(180)"' : '';
}

/** True when text at `degrees` (SVG, clockwise) would read top-to-bottom or upside down. */
function isUpsideDown(degrees: number): boolean {
  const EPS = 1e-6;
  const sheet = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return sheet >= 90 - EPS || sheet < -90 - EPS;
}

/** The hatch over the treads a stair has cut over them (#631). */
function renderStairCutHatch(
  layout: RoomLayout,
  floor: FloorLayout,
  px: (x: number) => string,
  py: (z: number) => string,
  theme: SvgPlanTheme
): string {
  const lines = stairCutHatch(layout, floor);
  if (lines.length === 0) return '';
  const d = lines.map(({ from, to }) => `M ${px(from.x)} ${py(from.z)} L ${px(to.x)} ${py(to.z)}`).join(' ');
  return `<path class="stair-cut" d="${d}" stroke="${theme.furnitureStroke}" stroke-opacity="0.85" stroke-width="1" fill="none"/>`;
}

/**
 * Tread lines and the up-arrow of a stair (#290), in plan space (already
 * rotated and mirrored, so outside the footprint's transform group): the
 * foot is dotted and the arrow follows the walk line up to the last tread.
 */
function renderStairsSymbol(
  item: PlacedItem,
  px: (x: number) => string,
  py: (z: number) => string,
  theme: SvgPlanTheme
): string {
  const at = (p: PlanPoint): string => `${px(p.x)} ${py(p.z)}`;
  const treads = stairTreadSegments(item)
    .map(({ from, to }) => `M ${at(from)} L ${at(to)}`)
    .join(' ');
  const { shaft, head } = stairArrow(item);
  if (shaft.length < 2) return `<path class="stairs" d="${treads}" stroke="${theme.furnitureStroke}" stroke-width="1" fill="none"/>`;
  const arrow = [
    `M ${shaft.map(at).join(' L ')}`,
    ...head.map(({ from, to }) => `M ${at(from)} L ${at(to)}`),
  ].join(' ');
  return [
    `<g class="stairs" stroke="${theme.furnitureStroke}" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    `<path class="treads" d="${treads}" stroke-width="1"/>`,
    `<path class="arrow" d="${arrow}" stroke-width="2"/>`,
    `<circle cx="${px(shaft[0]!.x)}" cy="${py(shaft[0]!.z)}" r="2.5" fill="${theme.furnitureStroke}" stroke="none"/>`,
    `</g>`,
  ].join('');
}

/**
 * The stairwell the floor below cuts through this floor's slab (#290): a
 * dashed void outline over the floor, under the furniture — so the export
 * of an upper floor shows the drop, not a solid slab.
 */
function renderStairwellHoles(
  layout: RoomLayout,
  floor: FloorLayout,
  px: (x: number) => string,
  py: (z: number) => string,
  theme: SvgPlanTheme
): string {
  const floorIndex = layout.floors.findIndex((candidate) => candidate === floor || candidate.id === floor.id);
  return stairwellOutlines(layout, floorIndex)
    .map(
      (outline) =>
        `<polygon class="stairwell" points="${outline.map((p) => `${px(p.x)},${py(p.z)}`).join(' ')}" fill="${theme.furnitureStroke}" fill-opacity="0.12" stroke="${theme.furnitureStroke}" stroke-width="1.5" stroke-dasharray="6 4"/>`
    )
    .join('\n');
}

/**
 * Dimension strings (#424): the room's width in the bottom margin band and
 * its depth in the left one — offset past the plan content, with light
 * extension lines back to the walls — and one string per interior wall,
 * offset to one side of its centreline. With opening chains the room
 * dimensions step out by `chainBand` and the chains sit next to the plan.
 */
function renderDimensions(
  layout: RoomLayout,
  floor: FloorLayout,
  px: (x: number) => string,
  py: (z: number) => string,
  content: PlanBounds,
  theme: SvgPlanTheme,
  chains: readonly OpeningChain[],
  chainBand: number
): string {
  const parts: string[] = [`<g class="dimensions" stroke="${theme.dimension}" fill="${theme.dimension}" font-size="10">`];
  const { width, depth } = roomDimensions(layout);
  const roomOffset = DIMENSION_OFFSET_PX + chainBand;

  const wy = Number(py(content.maxZ)) + roomOffset;
  const wx0 = Number(px(width.from.x));
  const wx1 = Number(px(width.to.x));
  const southY = Number(py(width.from.z));
  parts.push(
    extensionLine(wx0, southY, wx0, wy + DIMENSION_TICK_PX, theme),
    extensionLine(wx1, southY, wx1, wy + DIMENSION_TICK_PX, theme),
    dimensionLine(wx0, wy, wx1, wy, width, { x: 0, z: 1 }, 'room-dimension')
  );

  const dx = Number(px(content.minX)) - roomOffset;
  const dy0 = Number(py(depth.from.z));
  const dy1 = Number(py(depth.to.z));
  const westX = Number(px(depth.from.x));
  parts.push(
    extensionLine(westX, dy0, dx - DIMENSION_TICK_PX, dy0, theme),
    extensionLine(westX, dy1, dx - DIMENSION_TICK_PX, dy1, theme),
    dimensionLine(dx, dy1, dx, dy0, depth, { x: -1, z: 0 }, 'room-dimension')
  );

  for (const dim of interiorWallDimensions(floor)) {
    const x0 = Number(px(dim.from.x));
    const y0 = Number(py(dim.from.z));
    const x1 = Number(px(dim.to.x));
    const y1 = Number(py(dim.to.z));
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len === 0) continue;
    // Offset to the side plan-geometry chose (shared with the DXF), clear of
    // the 0.16 m wall. Sheet axes run like world axes (x right, z down).
    const nx = dim.normal.x * WALL_DIMENSION_OFFSET_PX;
    const ny = dim.normal.z * WALL_DIMENSION_OFFSET_PX;
    const labelShiftPx = (dim.labelShiftM / dim.lengthM) * len;
    parts.push(dimensionLine(x0 + nx, y0 + ny, x1 + nx, y1 + ny, dim, dim.normal, 'wall-dimension', labelShiftPx));
  }
  for (const chain of chains) parts.push(renderOpeningChain(chain, px, py, content, theme));
  parts.push(`</g>`);
  return parts.join('');
}

/**
 * One wall's opening chain (#630): just past the plan content on that side,
 * with an extension line back to the wall from every stop.
 */
function renderOpeningChain(
  chain: OpeningChain,
  px: (x: number) => string,
  py: (z: number) => string,
  content: PlanBounds,
  theme: SvgPlanTheme
): string {
  const { outward, segments } = chain;
  const horizontal = outward.x === 0;
  const contentEdge = horizontal ? Number(py(outward.z < 0 ? content.minZ : content.maxZ)) : Number(px(outward.x < 0 ? content.minX : content.maxX));
  const line = contentEdge + (horizontal ? outward.z : outward.x) * DIMENSION_OFFSET_PX;
  const onLine = (p: PlanPoint, by = 0): [number, number] => (horizontal ? [Number(px(p.x)), line + outward.z * by] : [line + outward.x * by, Number(py(p.z))]);
  const parts: string[] = [`<g class="opening-chain" data-wall="${chain.wall}">`];
  for (const stop of [segments[0]!.from, ...segments.map((segment) => segment.to)]) {
    const [ex, ey] = onLine(stop, DIMENSION_TICK_PX);
    parts.push(extensionLine(Number(px(stop.x)), Number(py(stop.z)), ex, ey, theme));
  }
  for (const segment of segments) {
    const [x0, y0] = onLine(segment.from);
    const [x1, y1] = onLine(segment.to);
    const gap = DIMENSION_LABEL_GAP_PX + segment.labelRow * OPENING_CHAIN_ROW_PX;
    parts.push(dimensionLine(x0, y0, x1, y1, segment, outward, 'opening-dimension', 0, gap));
  }
  parts.push(`</g>`);
  return parts.join('');
}

function extensionLine(x1: number, y1: number, x2: number, y2: number, theme: SvgPlanTheme): string {
  return `<line class="extension" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${theme.grid}" stroke-width="0.75"/>`;
}

/**
 * A dimension line with perpendicular end ticks and its length centred
 * beside it on the `outward` side (a unit vector on the sheet), away from
 * what it measures, `labelShiftPx` off centre towards the end; the label is
 * kept upright like item labels.
 */
function dimensionLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dim: PlanDimension,
  outward: PlanPoint,
  className: string,
  labelShiftPx = 0,
  labelGapPx = DIMENSION_LABEL_GAP_PX
): string {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = len === 0 ? 1 : (x1 - x0) / len;
  const uy = len === 0 ? 0 : (y1 - y0) / len;
  const tx = -uy * DIMENSION_TICK_PX;
  const ty = ux * DIMENSION_TICK_PX;
  const raw = (Math.atan2(uy, ux) * 180) / Math.PI;
  const degrees = isUpsideDown(raw) ? raw - 180 : raw;
  const lx = (x0 + x1) / 2 + outward.x * labelGapPx + ux * labelShiftPx;
  const ly = (y0 + y1) / 2 + outward.z * labelGapPx + uy * labelShiftPx;
  return [
    `<g class="${className}">`,
    `<line x1="${fmt(x0)}" y1="${fmt(y0)}" x2="${fmt(x1)}" y2="${fmt(y1)}" stroke-width="0.75"/>`,
    `<line x1="${fmt(x0 - tx)}" y1="${fmt(y0 - ty)}" x2="${fmt(x0 + tx)}" y2="${fmt(y0 + ty)}" stroke-width="1"/>`,
    `<line x1="${fmt(x1 - tx)}" y1="${fmt(y1 - ty)}" x2="${fmt(x1 + tx)}" y2="${fmt(y1 + ty)}" stroke-width="1"/>`,
    `<text x="0" y="0" dy="0.35em" text-anchor="middle" stroke="none" transform="translate(${fmt(lx)} ${fmt(ly)}) rotate(${fmt(degrees)})">${escapeHtml(dim.label)}</text>`,
    `</g>`,
  ].join('');
}

/** Title and room-size font sizes, px. */
const TITLE_FONT_PX = 14;
const DIMS_FONT_PX = 11;
/** Average Helvetica advance per character, in ems — generous so the estimate errs wide. */
const BOLD_EM_PER_CHAR = 0.62;
const REGULAR_EM_PER_CHAR = 0.56;
/** Minimum clear space between the title and the room size on one line, px. */
const TITLE_GAP_PX = 16;

/** Estimated rendered width of `text`: there is no DOM to measure with here. */
function estimateTextWidth(text: string, fontPx: number, bold: boolean): number {
  return [...text].length * fontPx * (bold ? BOLD_EM_PER_CHAR : REGULAR_EM_PER_CHAR);
}

/**
 * The floor title (left) and the room size (right) in the top margin band.
 * On a sheet too narrow for both on one line, the size drops to a second
 * line under the title; a title too long even for a line of its own is cut
 * with an ellipsis (the full name stays in the document's <title>). They
 * used to overprint each other on narrow sheets.
 */
function renderTitleBlock(title: string, dims: string, margin: number, totalW: number, theme: SvgPlanTheme): string {
  const right = totalW - margin;
  const oneLine = estimateTextWidth(title, TITLE_FONT_PX, true) + TITLE_GAP_PX + estimateTextWidth(dims, DIMS_FONT_PX, false) <= right - margin;
  const titleY = oneLine ? margin - 22 : margin - 30;
  const dimsY = oneLine ? margin - 22 : margin - 12;
  // The title may run on into the right margin band: the north arrow there starts below the band's top.
  const shown = ellipsize(title, totalW - 8 - margin, TITLE_FONT_PX, true);
  return [
    `<text class="plan-title" x="${fmt(margin)}" y="${fmt(titleY)}" font-size="${TITLE_FONT_PX}" font-weight="bold" fill="${theme.label}">${escapeHtml(shown)}</text>`,
    `<text class="plan-dims" x="${fmt(right)}" y="${fmt(dimsY)}" font-size="${DIMS_FONT_PX}" text-anchor="end" fill="${theme.label}">${escapeHtml(dims)}</text>`,
  ].join('\n');
}

/** `text`, cut to fit `maxPx` with a trailing ellipsis when it would not. */
function ellipsize(text: string, maxPx: number, fontPx: number, bold: boolean): string {
  if (estimateTextWidth(text, fontPx, bold) <= maxPx) return text;
  const chars = [...text];
  while (chars.length > 1 && estimateTextWidth(`${chars.join('')}…`, fontPx, bold) > maxPx) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

/**
 * North arrow (#424). North is fixed — the street side, −z, the top of every
 * plan — so it is a plain upward arrow with an N, centred in the right
 * margin band at the top of the content.
 */
function renderNorthArrow(cx: number, top: number, theme: SvgPlanTheme): string {
  const tipY = top + 14;
  const baseY = top + 40;
  const notchY = baseY - 7;
  return [
    `<g class="north-arrow" stroke="${theme.label}" stroke-width="1" stroke-linejoin="round">`,
    `<text x="${fmt(cx)}" y="${fmt(top + 8)}" font-size="11" font-weight="bold" text-anchor="middle" fill="${theme.label}" stroke="none">N</text>`,
    `<path d="M ${fmt(cx)} ${fmt(tipY)} L ${fmt(cx + 7)} ${fmt(baseY)} L ${fmt(cx)} ${fmt(notchY)} Z" fill="${theme.label}"/>`,
    `<path d="M ${fmt(cx)} ${fmt(tipY)} L ${fmt(cx - 7)} ${fmt(baseY)} L ${fmt(cx)} ${fmt(notchY)} Z" fill="${theme.background}"/>`,
    `</g>`,
  ].join('');
}

function renderScaleBar(
  layout: RoomLayout,
  margin: number,
  scale: number,
  totalH: number,
  theme: SvgPlanTheme
): string {
  const metres = layout.width >= 4 ? 2 : 1;
  const x0 = margin;
  const x1 = margin + metres * scale;
  const y = totalH - 26;
  return [
    `<g class="scale-bar" stroke="${theme.label}" stroke-width="1.5">`,
    `<line x1="${fmt(x0)}" y1="${fmt(y)}" x2="${fmt(x1)}" y2="${fmt(y)}"/>`,
    `<line x1="${fmt(x0)}" y1="${fmt(y - 4)}" x2="${fmt(x0)}" y2="${fmt(y + 4)}"/>`,
    `<line x1="${fmt(x1)}" y1="${fmt(y - 4)}" x2="${fmt(x1)}" y2="${fmt(y + 4)}"/>`,
    `</g>`,
    `<text x="${fmt((x0 + x1) / 2)}" y="${fmt(y + 16)}" font-size="10" text-anchor="middle" fill="${theme.label}">${metres} m</text>`,
  ].join('');
}

/**
 * The item schedule (#424): name, W × D × H, count and price per line and a
 * total, as a table under the plan's scale bar.
 */
function renderSchedule(rows: readonly ScheduleRow[], margin: number, planHeight: number, theme: SvgPlanTheme): string {
  const left = margin;
  const right = margin + SCHEDULE_WIDTH_PX;
  const sizeX = left + 196;
  const qtyX = left + 316;
  const headY = planHeight + SCHEDULE_HEAD_PX - 4;
  const rowY = (index: number): number => headY + SCHEDULE_ROW_PX * (index + 1);
  const price = (value: number): string => `${CURRENCY_SYMBOL}${Math.round(value).toLocaleString('en-US')}`;
  const cell = (x: number, y: number, value: string, anchor: 'start' | 'end', bold = false): string =>
    `<text x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}"${bold ? ' font-weight="bold"' : ''}>${escapeHtml(value)}</text>`;
  const rule = (y: number): string =>
    `<line x1="${fmt(left)}" y1="${fmt(y)}" x2="${fmt(right)}" y2="${fmt(y)}" stroke="${theme.label}" stroke-width="0.75"/>`;
  const parts: string[] = [
    `<g class="schedule" font-size="10" fill="${theme.label}">`,
    `<text x="${fmt(left)}" y="${fmt(planHeight + 24)}" font-size="12" font-weight="bold">Item schedule</text>`,
    cell(left, headY, 'Item', 'start', true),
    cell(sizeX, headY, 'W × D × H (m)', 'start', true),
    cell(qtyX, headY, 'Qty', 'end', true),
    cell(right, headY, 'Price', 'end', true),
    rule(headY + 5),
  ];
  rows.forEach((row, index) => {
    const y = rowY(index);
    const name = row.name.length > SCHEDULE_NAME_CHARS ? `${row.name.slice(0, SCHEDULE_NAME_CHARS - 1)}…` : row.name;
    parts.push(
      `<g class="schedule-row">`,
      cell(left, y, name, 'start'),
      cell(sizeX, y, scheduleSizeText(row), 'start'),
      cell(qtyX, y, String(row.count), 'end'),
      cell(right, y, row.totalPrice > 0 ? price(row.totalPrice) : '—', 'end'),
      `</g>`
    );
  });
  const totalY = rowY(rows.length);
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const total = rows.reduce((sum, row) => sum + row.totalPrice, 0);
  parts.push(
    rule(totalY - 11),
    cell(left, totalY, 'Total', 'start', true),
    cell(qtyX, totalY, String(count), 'end', true),
    cell(right, totalY, price(total), 'end', true),
    `</g>`
  );
  return parts.join('');
}

/** Fixed 2-dp px precision, trailing zeros trimmed, never "-0" or NaN-ish. */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return (Object.is(rounded, -0) ? 0 : rounded).toString();
}
