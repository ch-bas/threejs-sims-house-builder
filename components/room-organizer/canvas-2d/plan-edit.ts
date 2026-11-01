import { cutoutRect } from '../lib/footprint';
import { formatMetres, formatSize } from '../lib/format';
import { INTERIOR_WALL_THICKNESS } from '../lib/opening-snap';
import { ENTRANCE_WALL_ID } from '../lib/street';
import { wallAngleDegrees } from '../lib/wall-snap';
import { clampZoneRect, MIN_ZONE_SIZE, zoneClearOfCutout, zoneContains, zoneFromCorners, zoneInPorch, zoneRings, type ZoneRect, type ZoneShape } from '../lib/zones';
import type { EntrancePlanOutline } from '../lib/street';
import type { FootprintCutout, InteriorWall, RoomLayout, RoomZone, Vec2 } from '../lib/types';
import type { WallSide } from '../lib/wall-sides';

/**
 * What the on-screen plan draws while editing: never part of the house, so
 * the minimap, the blueprint and the exports don't pass any of it.
 */

/** The wall tool's state on the plan (#564). */
export interface WallPreview {
  /** The first point, placed by the last click; null before it. */
  anchor: Vec2 | null;
  /** Where the next point would land; null with no pointer over the plan. */
  tip: Vec2 | null;
  /** The tip caught a wall, a corner or a right angle. */
  snapped: boolean;
}

const DRAFT_INK = '#1d4ed8';
const WALL_HANDLE_RADIUS = 6;
const DRAFT_STROKE = '#3b82f6';
/** Shorter than this there is no wall to draw or to measure. */
const MIN_DRAFT_LENGTH = 0.01;

function distanceToSegment(wall: InteriorWall, x: number, z: number): number {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - wall.x1) * dx + (z - wall.z1) * dz) / lengthSq)) : 0;
  return Math.hypot(x - (wall.x1 + t * dx), z - (wall.z1 + t * dz));
}

/** The interior wall nearest a world point, within its half-thickness plus `slop` metres. */
export function hitInteriorWall(walls: readonly InteriorWall[], x: number, z: number, slop = 0): InteriorWall | null {
  let best: InteriorWall | null = null;
  let bestDistance = INTERIOR_WALL_THICKNESS / 2 + slop;
  for (const wall of walls) {
    const distance = distanceToSegment(wall, x, z);
    if (distance <= bestDistance) {
      best = wall;
      bestDistance = distance;
    }
  }
  return best;
}

/** The selected wall's end near a world point, within `reach` metres. */
export function wallEndAt(wall: InteriorWall, x: number, z: number, reach: number): 'start' | 'end' | null {
  const start = Math.hypot(x - wall.x1, z - wall.z1);
  const end = Math.hypot(x - wall.x2, z - wall.z2);
  if (Math.min(start, end) > reach) return null;
  return start <= end ? 'start' : 'end';
}

/** Same stroke as `drawInteriorWalls`, in the selection's colour, with a handle on each end. */
export function drawSelectedWall(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  wall: InteriorWall,
  offsetX: number,
  offsetY: number,
  scale: number,
  refused = false
): void {
  const toX = (x: number) => offsetX + (x + layout.width / 2) * scale;
  const toY = (z: number) => offsetY + (z + layout.height / 2) * scale;
  ctx.save();
  ctx.strokeStyle = refused ? '#ef4444' : '#00ff00';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, INTERIOR_WALL_THICKNESS * scale + 2);
  ctx.beginPath();
  ctx.moveTo(toX(wall.x1), toY(wall.z1));
  ctx.lineTo(toX(wall.x2), toY(wall.z2));
  ctx.stroke();
  if (wall.id !== ENTRANCE_WALL_ID) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = DRAFT_INK;
    ctx.lineWidth = 2;
    for (const [x, z] of [[wall.x1, wall.z1], [wall.x2, wall.z2]] as const) {
      ctx.beginPath();
      ctx.arc(toX(x), toY(z), WALL_HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The dashed wall in progress, its length, and a dot on each end: filled when snapped. */
export function drawWallPreview(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  preview: WallPreview,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  const toX = (x: number) => offsetX + (x + layout.width / 2) * scale;
  const toY = (z: number) => offsetY + (z + layout.height / 2) * scale;
  const { anchor, tip, snapped } = preview;
  ctx.save();
  if (anchor && tip) {
    const length = Math.hypot(tip.x - anchor.x, tip.z - anchor.z);
    if (length >= MIN_DRAFT_LENGTH) {
      ctx.strokeStyle = DRAFT_STROKE;
      ctx.lineWidth = Math.max(2, INTERIOR_WALL_THICKNESS * scale);
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(toX(anchor.x), toY(anchor.z));
      ctx.lineTo(toX(tip.x), toY(tip.z));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillStyle = DRAFT_INK;
      const labelX = (toX(anchor.x) + toX(tip.x)) / 2;
      const labelY = (toY(anchor.z) + toY(tip.z)) / 2 - 8;
      const label = `${formatMetres(length)} · ${wallAngleDegrees(anchor, tip)}°`;
      ctx.strokeText(label, labelX, labelY);
      ctx.fillText(label, labelX, labelY);
    }
  }
  const dot = (point: Vec2, filled: boolean) => {
    ctx.beginPath();
    ctx.arc(toX(point.x), toY(point.z), 5, 0, Math.PI * 2);
    ctx.fillStyle = filled ? DRAFT_INK : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = DRAFT_INK;
    ctx.stroke();
  };
  if (anchor) dot(anchor, true);
  if (tip) dot(tip, snapped);
  ctx.restore();
}

/** The room stamp in hand (#724): the walls a drop adds and the room's size. */
export interface StampGhost {
  walls: readonly InteriorWall[];
  x: number;
  z: number;
  width: number;
  depth: number;
  refused: boolean;
}

/** The stamp's walls dashed, with W × D over the middle: red where a drop is refused. */
export function drawStampGhost(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  ghost: StampGhost,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  const toX = (x: number) => offsetX + (x + layout.width / 2) * scale;
  const toY = (z: number) => offsetY + (z + layout.height / 2) * scale;
  ctx.save();
  ctx.strokeStyle = ghost.refused ? '#ef4444' : DRAFT_STROKE;
  ctx.lineWidth = Math.max(2, INTERIOR_WALL_THICKNESS * scale);
  ctx.setLineDash([8, 5]);
  for (const wall of ghost.walls) {
    ctx.beginPath();
    ctx.moveTo(toX(wall.x1), toY(wall.z1));
    ctx.lineTo(toX(wall.x2), toY(wall.z2));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillStyle = ghost.refused ? '#b91c1c' : DRAFT_INK;
  const label = formatSize(ghost.width, ghost.depth);
  ctx.strokeText(label, toX(ghost.x), toY(ghost.z));
  ctx.fillText(label, toX(ghost.x), toY(ghost.z));
  ctx.restore();
}

/** Which part of a selected zone a press took hold of (#628). */
export type ZoneGrip = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

export const ZONE_GRIP_CURSORS: Readonly<Record<ZoneGrip, string>> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  move: 'move',
};

/** Where a coordinate lands among a handle row's three marks; null off them. */
function markOnAxis(value: number, low: number, high: number, reach: number): 'low' | 'middle' | 'high' | null {
  const span = high - low;
  const inside = Math.min(reach, span / 3);
  if (value >= low - reach && value <= low + inside) return 'low';
  if (value <= high + reach && value >= high - inside) return 'high';
  return Math.abs(value - (low + high) / 2) <= Math.min(reach, span / 6) ? 'middle' : null;
}

/**
 * The part of `zone` under a world point; null outside it. `markSlop`
 * (metres) is a drawn handle's reach, wide for a finger; `slop` is the whole
 * edge's, narrow, so a new zone can start beside this one. Both reach past
 * the edge freely but only a third of the way in, so even a thin zone under
 * a finger keeps a middle to move it by.
 */
export function zoneGripAt(zone: ZoneShape, x: number, z: number, slop: number, markSlop = slop): ZoneGrip | null {
  // A polygon zone follows its walls (#719): it has no handles to take hold of.
  if (zone.outline) return null;
  const x1 = zone.x + zone.w;
  const z1 = zone.z + zone.d;
  const alongX = markOnAxis(x, zone.x, x1, markSlop);
  const alongZ = markOnAxis(z, zone.z, z1, markSlop);
  if (alongX && alongZ && (alongX !== 'middle' || alongZ !== 'middle')) {
    const names = { low: ['n', 'w'], middle: ['', ''], high: ['s', 'e'] } as const;
    return `${names[alongZ][0]}${names[alongX][1]}` as ZoneGrip;
  }
  if (x < zone.x - slop || x > x1 + slop || z < zone.z - slop || z > z1 + slop) return null;
  const insideX = Math.min(slop, zone.w / 3);
  const insideZ = Math.min(slop, zone.d / 3);
  const west = x <= zone.x + insideX;
  const east = x >= x1 - insideX;
  const north = z <= zone.z + insideZ;
  const south = z >= z1 - insideZ;
  const grip = `${north ? 'n' : south ? 's' : ''}${west ? 'w' : east ? 'e' : ''}`;
  return grip === '' ? 'move' : (grip as ZoneGrip);
}

/**
 * The zone painted on top at a world point: the plan paints them in list
 * order. With `below`, the next one under that zone, so repeated taps walk
 * down a stack; null past the last.
 */
export function zoneAt(zones: readonly RoomZone[], x: number, z: number, below?: string): RoomZone | null {
  const here = zones.filter((zone) => zoneContains(zone, x, z)).reverse();
  if (below === undefined) return here[0] ?? null;
  const index = here.findIndex((zone) => zone.id === below);
  return (index >= 0 ? here[index + 1] : undefined) ?? null;
}

/**
 * `origin` after a drag of (dx, dz) from `grip`, fitted as the reducer will
 * fit it: a move stops at the walls, a resize stops MIN_ZONE_SIZE short of
 * the opposite side. A move keeps the size, except on a floor off the zone
 * grid, where a corner that lands on a wall gains or loses a few cm.
 * Null when nothing valid is left, or when the drag would put a zone that
 * isn't on the porch onto it, which the reducer refuses (#582). A corner cut
 * out of the house stops a move, and a resize at its wall (#727).
 */
export function draggedZoneRect(
  origin: ZoneRect,
  grip: ZoneGrip,
  dx: number,
  dz: number,
  roomWidth: number,
  roomDepth: number,
  recess: EntrancePlanOutline | null = null,
  cutout?: FootprintCutout | undefined
): ZoneRect | null {
  const fitted = fitDraggedZone(origin, grip, dx, dz, roomWidth, roomDepth, cutout);
  return fitted && zoneInPorch(fitted, recess) && !zoneInPorch(origin, recess) ? null : fitted;
}

function fitDraggedZone(
  origin: ZoneRect,
  grip: ZoneGrip,
  dx: number,
  dz: number,
  roomWidth: number,
  roomDepth: number,
  cutout: FootprintCutout | undefined
): ZoneRect | null {
  if (grip === 'move') {
    const x = Math.max(-roomWidth / 2, Math.min(roomWidth / 2 - origin.w, origin.x + dx));
    const z = Math.max(-roomDepth / 2, Math.min(roomDepth / 2 - origin.d, origin.z + dz));
    return clampZoneRect(zoneClearOfCutout({ ...origin, x, z }, roomWidth, roomDepth, cutout), roomWidth, roomDepth, cutout);
  }
  let x0 = origin.x;
  let z0 = origin.z;
  let x1 = origin.x + origin.w;
  let z1 = origin.z + origin.d;
  if (grip.includes('w')) x0 = Math.min(x0 + dx, x1 - MIN_ZONE_SIZE);
  if (grip.includes('e')) x1 = Math.max(x1 + dx, x0 + MIN_ZONE_SIZE);
  if (grip.includes('n')) z0 = Math.min(z0 + dz, z1 - MIN_ZONE_SIZE);
  if (grip.includes('s')) z1 = Math.max(z1 + dz, z0 + MIN_ZONE_SIZE);
  // Only the sides in hand stop at the notch: the others stay.
  const notch = cutoutRect({ width: roomWidth, height: roomDepth, cutout });
  if (notch && x1 > notch.x0 && x0 < notch.x1 && z1 > notch.z0 && z0 < notch.z1) {
    const stops = [
      ...(grip.includes('e') ? [{ x1: notch.x0 }] : []),
      ...(grip.includes('w') ? [{ x0: notch.x1 }] : []),
      ...(grip.includes('s') ? [{ z1: notch.z0 }] : []),
      ...(grip.includes('n') ? [{ z0: notch.z1 }] : []),
    ];
    const clear = stops
      .map((stop) => ({ x0, x1, z0, z1, ...stop }))
      .filter((rect) => rect.x1 - rect.x0 >= MIN_ZONE_SIZE && rect.z1 - rect.z0 >= MIN_ZONE_SIZE)
      .sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
    if (clear) ({ x0, x1, z0, z1 } = clear);
  }
  return zoneFromCorners({ x: x0, z: z0 }, { x: x1, z: z1 }, roomWidth, roomDepth, cutout);
}

/** The face of a selected wall that paint goes to: a line along that side (#720). */
export function drawWallSideMark(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  wall: InteriorWall,
  side: WallSide,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  if (length === 0) return;
  const reach = (Math.max(4, INTERIOR_WALL_THICKNESS * scale + 2) / 2 + 3) * (side === 'a' ? 1 : -1);
  const shiftX = (-(wall.z2 - wall.z1) / length) * reach;
  const shiftY = ((wall.x2 - wall.x1) / length) * reach;
  const toX = (x: number) => offsetX + (x + layout.width / 2) * scale + shiftX;
  const toY = (z: number) => offsetY + (z + layout.height / 2) * scale + shiftY;
  ctx.save();
  ctx.strokeStyle = DRAFT_INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(toX(wall.x1), toY(wall.z1));
  ctx.lineTo(toX(wall.x2), toY(wall.z2));
  ctx.stroke();
  ctx.restore();
}

/** Half the side of a drawn handle, px. The target under a finger is wider than the mark. */
const ZONE_HANDLE_HALF = 5;

/** The selected zone's outline, with a handle on each corner and each edge's middle; a polygon has none. */
export function drawZoneHandles(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  zone: ZoneShape,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  if (zone.outline) {
    ctx.save();
    ctx.strokeStyle = DRAFT_INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const ring of zoneRings(zone)) {
      ring.forEach((point, index) => {
        const px = offsetX + (point.x + layout.width / 2) * scale;
        const py = offsetY + (point.z + layout.height / 2) * scale;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  const left = offsetX + (zone.x + layout.width / 2) * scale;
  const top = offsetY + (zone.z + layout.height / 2) * scale;
  const width = zone.w * scale;
  const height = zone.d * scale;
  ctx.save();
  ctx.strokeStyle = DRAFT_INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(left, top, width, height);
  ctx.fillStyle = '#ffffff';
  for (const u of [0, 0.5, 1]) {
    for (const v of [0, 0.5, 1]) {
      if (u === 0.5 && v === 0.5) continue;
      const x = left + u * width - ZONE_HANDLE_HALF;
      const y = top + v * height - ZONE_HANDLE_HALF;
      ctx.fillRect(x, y, ZONE_HANDLE_HALF * 2, ZONE_HANDLE_HALF * 2);
      ctx.strokeRect(x, y, ZONE_HANDLE_HALF * 2, ZONE_HANDLE_HALF * 2);
    }
  }
  ctx.restore();
}
