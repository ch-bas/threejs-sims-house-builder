import { stairArrow, stairTreadSegments, stairwellOutlines, type PlacedItem, type PlanPoint } from '../lib/plan-export/plan-geometry';
import type { View2DTransform } from './render';
import type { FurnitureItem, RoomLayout } from '../lib/types';

/**
 * The stair symbol of the 2D plan (#290): tread lines and an up-arrow from
 * the same layout the 3D flight is built from, so a straight, winder,
 * rotated or mirrored stair reads on the plan, the minimap and the blueprint
 * — and, on the floor above, the stairwell it cuts. Pure geometry comes from
 * lib/plan-export/plan-geometry.ts, which the SVG and DXF exporters share.
 */

/** Tread lines closer than this (px) are a smear, not treads — the minimap keeps just the arrow. */
const MIN_TREAD_SPACING_PX = 2.5;
/** A hole painted smaller than this (px, either edge) is too small for its label. */
const MIN_HOLE_LABEL_EDGE_PX = 36;

type PlanSize = Pick<RoomLayout, 'width' | 'height'>;

/** World metres (room-centred) → canvas CSS px, as render2DTopDown maps. */
function toCanvas(p: PlanPoint, layout: PlanSize, view: View2DTransform): [number, number] {
  return [view.offsetX + (p.x + layout.width / 2) * view.scale, view.offsetY + (p.z + layout.height / 2) * view.scale];
}

/**
 * Draw a stair's treads and climb arrow over its footprint, in world→canvas
 * space (not the item's rotated frame: the geometry is already rotated and
 * mirrored). Caller paints the footprint fill and selection stroke first.
 */
export function drawStairsSymbol(
  ctx: CanvasRenderingContext2D,
  item: FurnitureItem,
  layout: PlanSize,
  view: View2DTransform
): void {
  if (!item.position) return;
  const placed = item as PlacedItem;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const { shaft, head } = stairArrow(placed);

  // Nosings: skipped when they would pack tighter than the stroke can show.
  if ((item.depth * view.scale) / Math.max(1, shaft.length) >= MIN_TREAD_SPACING_PX) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const { from, to } of stairTreadSegments(placed)) {
      ctx.moveTo(...toCanvas(from, layout, view));
      ctx.lineTo(...toCanvas(to, layout, view));
    }
    ctx.stroke();
  }

  // The arrow: foot to head along the walk line, barbs on the last tread.
  if (shaft.length < 2) {
    ctx.restore();
    return;
  }
  ctx.strokeStyle = '#111';
  ctx.lineWidth = Math.max(1.5, Math.min(3, view.scale * 0.04));
  ctx.beginPath();
  shaft.forEach((p, i) => {
    const [x, y] = toCanvas(p, layout, view);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  for (const { from, to } of head) {
    ctx.moveTo(...toCanvas(from, layout, view));
    ctx.lineTo(...toCanvas(to, layout, view));
  }
  ctx.stroke();
  // A dot marks the foot of the flight, as plans do.
  const [fx, fy] = toCanvas(shaft[0]!, layout, view);
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(fx, fy, ctx.lineWidth, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw the stairwell holes the stairs on the floor below cut through this
 * floor's slab: a dashed void outline over the floor, under the furniture,
 * so what is placed over the drop is seen to hang over it. Nothing on the
 * ground floor.
 */
export function drawStairwellHoles(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  floorIndex: number,
  view: View2DTransform
): void {
  const outlines = stairwellOutlines(layout, floorIndex);
  if (outlines.length === 0) return;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const outline of outlines) {
    const points = outline.map((p) => toCanvas(p, layout, view));
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    // A see-through void: darker than the slab, with the grid showing through.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (Math.min(w, h) < MIN_HOLE_LABEL_EDGE_PX) continue;
    // At the area centroid, which sits inside a winder's L; the box centre is on its edge.
    const [lx, ly] = polygonCentroid(points);
    ctx.font = '10px Arial';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('open below', lx, ly);
  }
  ctx.restore();
}

/** Area centroid of a simple polygon (its vertex mean for a degenerate one). */
function polygonCentroid(points: ReadonlyArray<readonly [number, number]>): [number, number] {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    const n = points.length;
    return [points.reduce((sum, [x]) => sum + x, 0) / n, points.reduce((sum, [, y]) => sum + y, 0) / n];
  }
  return [cx / (3 * area), cy / (3 * area)];
}
