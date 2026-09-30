/**
 * Scalable-vector floor plan export (#230). Pure string emitter — no DOM, no
 * React, no Three.js — so it runs in tests and could run in a worker. The
 * geometry mirrors the 2D top-down view (canvas-2d/render.ts): same grid
 * anchoring, same wall styling, same footprint rotation convention.
 */

import { zoneArea } from '../zones';
import {
  gridLinePositions,
  INTERIOR_WALL_THICKNESS_M,
  isWallHidden,
  splitPlanItems,
  type PlacedItem,
} from './plan-geometry';
import type { FloorLayout, RoomLayout } from '../types';

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
}

export interface SvgExportOptions {
  /** Pixels per metre; the default 50 keeps a 10 m room at a crisp 500 px. */
  pxPerMetre?: number;
  /** Margin (px) around the room for the title, dimensions, and scale bar. */
  margin?: number;
  theme?: Partial<SvgPlanTheme>;
}

export const DEFAULT_SVG_PX_PER_METRE = 50;
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
};

/** Minimum footprint edge (px) before an in-rect name label is legible. */
const MIN_LABEL_EDGE_PX = 22;

/**
 * Render one floor of a building as a standalone SVG floor plan: room
 * outline, grid, interior walls, door/window marks, furniture as rotated
 * rects with name labels, a scale bar, and the floor name.
 */
export function layoutToSvg(layout: RoomLayout, floor: FloorLayout, options: SvgExportOptions = {}): string {
  const scale = options.pxPerMetre ?? DEFAULT_SVG_PX_PER_METRE;
  const margin = options.margin ?? DEFAULT_SVG_MARGIN;
  const theme: SvgPlanTheme = { ...DEFAULT_THEME, ...options.theme };

  const roomW = layout.width * scale;
  const roomD = layout.height * scale;
  const totalW = roomW + margin * 2;
  const totalH = roomD + margin * 2;
  // World (metres, origin at room centre) → SVG px.
  const px = (x: number): string => fmt(margin + (x + layout.width / 2) * scale);
  const py = (z: number): string => fmt(margin + (z + layout.height / 2) * scale);

  const { openings, furniture } = splitPlanItems(floor.items);
  const title = `${layout.name} — ${floor.name}`;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(totalW)} ${fmt(totalH)}" width="${fmt(totalW)}" height="${fmt(totalH)}" font-family="Helvetica, Arial, sans-serif">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect width="${fmt(totalW)}" height="${fmt(totalH)}" fill="${theme.background}"/>`,
    `<rect x="${fmt(margin)}" y="${fmt(margin)}" width="${fmt(roomW)}" height="${fmt(roomD)}" fill="${escapeXml(floor.floorColor)}"/>`,
    renderGrid(layout, margin, scale, theme),
    renderZones(floor, px, py, scale, theme),
    renderRoomOutline(layout, floor, margin, scale, theme),
    renderInteriorWalls(floor, px, py, scale, theme),
    ...openings.map((item) => renderOpening(item, px, py, scale, theme)),
    ...furniture.map((item) => renderFurniture(item, px, py, scale, theme)),
    `<text class="plan-title" x="${fmt(margin)}" y="${fmt(margin - 22)}" font-size="14" font-weight="bold" fill="${theme.label}">${escapeXml(title)}</text>`,
    `<text class="plan-dims" x="${fmt(margin + roomW)}" y="${fmt(margin - 22)}" font-size="11" text-anchor="end" fill="${theme.label}">${fmt(layout.width)} m × ${fmt(layout.height)} m</text>`,
    renderScaleBar(layout, margin, scale, totalH, theme),
    `</svg>`,
  ];
  return parts.filter((part) => part !== '').join('\n');
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
  const edges = [
    { id: 'north', x1: x0, y1: y0, x2: x1, y2: y0 },
    { id: 'south', x1: x0, y1: y1, x2: x1, y2: y1 },
    { id: 'west', x1: x0, y1: y0, x2: x0, y2: y1 },
    { id: 'east', x1: x1, y1: y0, x2: x1, y2: y1 },
  ] as const;
  const lines = edges.map((edge) => {
    const hidden = isWallHidden(floor, edge.id);
    const style = hidden
      ? `stroke="${theme.hiddenWall}" stroke-width="1.5" stroke-dasharray="6 4"`
      : `stroke="${theme.wall}" stroke-width="3"`;
    return `<line class="wall" x1="${fmt(edge.x1)}" y1="${fmt(edge.y1)}" x2="${fmt(edge.x2)}" y2="${fmt(edge.y2)}" ${style}/>`;
  });
  return lines.join('\n');
}

/**
 * Room zones (#155) as tinted rects with the name and area along the top
 * edge (the centre is where the furniture sits) — between the grid and the
 * walls, like canvas-2d/render.ts paints them.
 */
function renderZones(
  floor: FloorLayout,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  theme: SvgPlanTheme
): string {
  const zones = floor.zones ?? [];
  if (zones.length === 0) return '';
  return zones
    .map((zone) => {
      const color = escapeXml(zone.color);
      const cx = fmt(Number(px(zone.x)) + (zone.w * scale) / 2);
      const top = fmt(Number(py(zone.z)) + 15);
      return [
        `<g class="zone">`,
        `<rect x="${px(zone.x)}" y="${py(zone.z)}" width="${fmt(zone.w * scale)}" height="${fmt(zone.d * scale)}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-opacity="0.7" stroke-width="1.5"/>`,
        `<text x="${cx}" y="${top}" font-size="12" font-weight="bold" text-anchor="middle" fill="${theme.label}">${escapeXml(zone.name)}</text>`,
        `<text x="${cx}" y="${top}" dy="1.2em" font-size="10" text-anchor="middle" fill="${theme.label}">${zoneArea(zone).toFixed(1)} m²</text>`,
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
  const width = fmt(Math.max(2, INTERIOR_WALL_THICKNESS_M * scale));
  const lines = walls.map(
    (wall) =>
      `<line class="interior-wall" x1="${px(wall.x1)}" y1="${py(wall.z1)}" x2="${px(wall.x2)}" y2="${py(wall.z2)}" stroke="${theme.interiorWall}" stroke-width="${width}" stroke-linecap="butt"/>`
  );
  return lines.join('\n');
}

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
  const hw = w / 2;
  const gap = 0.2 * scale;
  const transform = `translate(${px(item.position.x)} ${py(item.position.z)}) rotate(${fmt(-((item.rotation ?? 0) * 180) / Math.PI)})`;
  const parts: string[] = [`<g class="opening" data-type="${escapeXml(item.type)}" transform="${transform}">`];
  parts.push(
    `<rect x="${fmt(-hw)}" y="${fmt(-gap / 2)}" width="${fmt(w)}" height="${fmt(gap)}" fill="${theme.background}"/>`
  );
  if (item.type === 'door') {
    parts.push(
      `<line x1="${fmt(-hw)}" y1="0" x2="${fmt(-hw)}" y2="${fmt(w)}" stroke="${theme.opening}" stroke-width="1.5"/>`,
      `<path d="M ${fmt(hw)} 0 A ${fmt(w)} ${fmt(w)} 0 0 1 ${fmt(-hw)} ${fmt(w)}" stroke="${theme.opening}" stroke-width="1" fill="none"/>`
    );
  } else {
    parts.push(
      `<rect x="${fmt(-hw)}" y="${fmt(-gap / 2)}" width="${fmt(w)}" height="${fmt(gap)}" fill="none" stroke="${theme.opening}" stroke-width="1"/>`,
      `<line x1="${fmt(-hw)}" y1="0" x2="${fmt(hw)}" y2="0" stroke="${theme.opening}" stroke-width="1"/>`
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
  const transform = `translate(${px(item.position.x)} ${py(item.position.z)}) rotate(${fmt(-((item.rotation ?? 0) * 180) / Math.PI)})`;
  const rect = `<rect class="furniture" x="${fmt(-w / 2)}" y="${fmt(-d / 2)}" width="${fmt(w)}" height="${fmt(d)}" fill="${escapeXml(item.color)}" stroke="${theme.furnitureStroke}" stroke-width="1"/>`;
  // Tiny footprints (cameras, vases) can't carry a legible in-rect label.
  const label =
    Math.min(w, d) >= MIN_LABEL_EDGE_PX
      ? `<text class="label" x="0" y="0" dy="0.35em" font-size="10" text-anchor="middle" fill="${theme.label}">${escapeXml(item.name)}</text>`
      : '';
  return `<g transform="${transform}">${rect}${label}</g>`;
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

/** Fixed 2-dp px precision, trailing zeros trimmed, never "-0" or NaN-ish. */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return (Object.is(rounded, -0) ? 0 : rounded).toString();
}

function escapeXml(input: string): string {
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
