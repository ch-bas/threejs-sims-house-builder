import { formatMetres } from '../lib/format';
import { INTERIOR_WALL_THICKNESS } from '../lib/opening-snap';
import type { InteriorWall, RoomLayout, Vec2 } from '../lib/types';

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

/** Same stroke as `drawInteriorWalls`, in the selection's colour. */
export function drawSelectedWall(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  wall: InteriorWall,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  const toX = (x: number) => offsetX + (x + layout.width / 2) * scale;
  const toY = (z: number) => offsetY + (z + layout.height / 2) * scale;
  ctx.save();
  ctx.strokeStyle = '#00ff00';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, INTERIOR_WALL_THICKNESS * scale + 2);
  ctx.beginPath();
  ctx.moveTo(toX(wall.x1), toY(wall.z1));
  ctx.lineTo(toX(wall.x2), toY(wall.z2));
  ctx.stroke();
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
      ctx.strokeText(formatMetres(length), labelX, labelY);
      ctx.fillText(formatMetres(length), labelX, labelY);
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
