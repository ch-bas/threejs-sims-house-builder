import { formatMetres, getDisplayUnit, type LengthUnit } from '../lib/format';
import { pinnedDimensionLines, type PinnedDimensionLine } from '../lib/plan-export/plan-geometry';
import type { FloorLayout, RoomLayout, Vec2 } from '../lib/types';

/**
 * The measure tool on the plan (#921): the points being measured, drawn in
 * the edit layer like the wall tool's draft, and the dimensions pinned on
 * the storey, drawn with the plan itself (so the blueprint has them too).
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
const PIN_INK = '#0f766e';
const PIN_SELECTED = '#2563eb';
const HALO = 'rgba(255, 255, 255, 0.92)';
/** How far a pinned line's label sits off it, px. */
const PIN_LABEL_GAP_PX = 6;
/** Half the length of a pinned line's end tick, px. */
const PIN_TICK_PX = 5;
/** A press this close to a pinned line (px) takes it, short of its ends: a press there measures. */
const PIN_HIT_PX = 7;
const PIN_END_CLEAR_PX = 14;

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

/**
 * The storey's pinned dimensions: a line with end ticks, extension lines back
 * to the measured points when it sits off them, and the length beside it.
 * The selected one (to unpin) in the selection's blue.
 */
export function drawPinnedDimensions(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  floor: Pick<FloorLayout, 'dimensions'>,
  offsetX: number,
  offsetY: number,
  scale: number,
  unit: LengthUnit,
  selectedId: string | null = null
): void {
  const lines = pinnedDimensionLines(floor, unit);
  if (lines.length === 0) return;
  const at = canvasMapping(layout, offsetX, offsetY, scale);
  ctx.save();
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  for (const line of lines) {
    const ink = line.id === selectedId ? PIN_SELECTED : PIN_INK;
    const from = at(line.from);
    const to = at(line.to);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    const ux = (to.x - from.x) / length;
    const uy = (to.y - from.y) / length;
    ctx.strokeStyle = ink;
    ctx.lineWidth = line.id === selectedId ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    for (const end of [from, to]) {
      ctx.moveTo(end.x - uy * PIN_TICK_PX, end.y + ux * PIN_TICK_PX);
      ctx.lineTo(end.x + uy * PIN_TICK_PX, end.y - ux * PIN_TICK_PX);
    }
    ctx.stroke();
    if (line.from.x !== line.a.x || line.from.z !== line.a.z) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [point, end] of [[at(line.a), from], [at(line.b), to]] as const) {
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(end.x, end.y);
      }
      ctx.stroke();
    }
    // Upright: turned with the line, but never upside down.
    let angle = Math.atan2(uy, ux);
    if (angle > Math.PI / 2 + 1e-6) angle -= Math.PI;
    else if (angle <= -Math.PI / 2 + 1e-6) angle += Math.PI;
    ctx.save();
    ctx.translate((from.x + to.x) / 2 + line.normal.x * (PIN_LABEL_GAP_PX + 5), (from.y + to.y) / 2 + line.normal.z * (PIN_LABEL_GAP_PX + 5));
    ctx.rotate(angle);
    haloText(ctx, line.label, 0, 0, ink);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The pinned dimension a press at `world` takes: within `PIN_HIT_PX` of its
 * drawn line and clear of its ends, where a press starts a measurement
 * instead (a pin usually ends on a corner worth measuring from). Null if none.
 */
export function hitPinnedDimension(floor: Pick<FloorLayout, 'dimensions'>, world: Vec2, metresPerPx: number): PinnedDimensionLine | null {
  if (!(metresPerPx > 0)) return null;
  const reach = PIN_HIT_PX * metresPerPx;
  const endClear = PIN_END_CLEAR_PX * metresPerPx;
  let best: PinnedDimensionLine | null = null;
  let bestDistance = reach;
  for (const line of pinnedDimensionLines(floor)) {
    const dx = line.to.x - line.from.x;
    const dz = line.to.z - line.from.z;
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;
    // A short pin is taken by its middle alone.
    const t = length <= endClear * 2 ? 0.5 : ((world.x - line.from.x) * dx + (world.z - line.from.z) * dz) / (length * length);
    if (length > endClear * 2 && (t * length < endClear || (1 - t) * length < endClear)) continue;
    const distance = Math.hypot(world.x - (line.from.x + t * dx), world.z - (line.from.z + t * dz));
    if (distance <= bestDistance) {
      best = line;
      bestDistance = distance;
    }
  }
  return best;
}
