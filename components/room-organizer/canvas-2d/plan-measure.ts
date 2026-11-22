import { formatMetres, getDisplayUnit, type LengthUnit } from '../lib/format';
import type { RoomLayout, Vec2 } from '../lib/types';

/**
 * The measure tool on the plan (#921): the points being measured, drawn in
 * the edit layer like the wall tool's draft.
 */

/** The measure tool's state on the plan. */
export interface MeasurePreview {
  /** The points placed: none, the first, or both. */
  points: readonly Vec2[];
  /** Where the next point would land, snapped; null with no pointer over the plan. */
  tip: Vec2 | null;
  /** The tip caught on a corner, an item or a wall. */
  snapped: boolean;
}

const MEASURE_INK = '#047857';
const MEASURE_STROKE = '#10b981';
const HALO = 'rgba(255, 255, 255, 0.92)';

type ToCanvas = (point: Vec2) => { x: number; y: number };

function canvasMapping(layout: Pick<RoomLayout, 'width' | 'height'>, offsetX: number, offsetY: number, scale: number): ToCanvas {
  return (point) => ({ x: offsetX + (point.x + layout.width / 2) * scale, y: offsetY + (point.z + layout.height / 2) * scale });
}

/** Text with a white halo, so it reads over furniture and the grid. */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = HALO;
  ctx.fillStyle = ink;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

/** The line between the placed points (or to the tip) with its length, a dot on each point. */
export function drawMeasurePreview(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  preview: MeasurePreview,
  offsetX: number,
  offsetY: number,
  scale: number,
  unit: LengthUnit = getDisplayUnit()
): void {
  const at = canvasMapping(layout, offsetX, offsetY, scale);
  const [first, second] = preview.points;
  const end = second ?? (first ? preview.tip : null);
  ctx.save();
  if (first && end) {
    const length = Math.hypot(end.x - first.x, end.z - first.z);
    const p0 = at(first);
    const p1 = at(end);
    ctx.strokeStyle = MEASURE_STROKE;
    ctx.lineWidth = 2;
    if (!second) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (length > 0) {
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      haloText(ctx, formatMetres(length, 2, unit), (p0.x + p1.x) / 2, (p0.y + p1.y) / 2 - 8, MEASURE_INK);
    }
  }
  const dot = (point: Vec2, filled: boolean) => {
    const p = at(point);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = filled ? MEASURE_INK : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = MEASURE_INK;
    ctx.stroke();
  };
  for (const point of preview.points) dot(point, true);
  if (preview.tip && preview.points.length < 2) dot(preview.tip, preview.snapped);
  ctx.restore();
}
