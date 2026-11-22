import { formatSize, type LengthUnit } from '../lib/format';
import { GROUND_LABELS, GROUND_PLAN_COLORS, shownGrounds, type GroundRect } from '../lib/grounds';
import type { FloorLayout, GroundKind, RoomLayout } from '../lib/types';

/**
 * Garden surfaces on the 2D plan (#924): the on-screen plan, the minimap and
 * the blueprint, all through `render2DTopDown`. Painted on the ground
 * floor's plan only, under everything: after the house is drawn, behind it
 * (`destination-over`), so they show only where the canvas is still empty —
 * outside, the L's notch included — and never over a wall's stroke. The
 * furniture is drawn after them, on top.
 */

interface PlanTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Board lines and paving joints only where they'd be this far apart on screen, or more (px). */
const MIN_DETAIL_PX = 4;
const PAVING_SLAB_M = 0.6;
const DECK_BOARD_M = 0.15;

function canvasRect(layout: Pick<RoomLayout, 'width' | 'height'>, rect: GroundRect, t: PlanTransform): { x: number; y: number; w: number; h: number } {
  return {
    x: t.offsetX + (rect.x + layout.width / 2) * t.scale,
    y: t.offsetY + (rect.z + layout.height / 2) * t.scale,
    w: rect.w * t.scale,
    h: rect.d * t.scale,
  };
}

/** The joints, boards or stones of a kind, inside its rectangle (canvas px). */
function traceDetail(ctx: CanvasRenderingContext2D, kind: GroundKind, rect: GroundRect, box: { x: number; y: number; w: number; h: number }, scale: number): void {
  ctx.beginPath();
  if (kind === 'paving' && PAVING_SLAB_M * scale >= MIN_DETAIL_PX) {
    // Joints on a world grid, so neighbouring patios line up.
    for (let wx = Math.ceil(rect.x / PAVING_SLAB_M) * PAVING_SLAB_M; wx < rect.x + rect.w; wx += PAVING_SLAB_M) {
      const sx = box.x + (wx - rect.x) * scale;
      ctx.moveTo(sx, box.y);
      ctx.lineTo(sx, box.y + box.h);
    }
    for (let wz = Math.ceil(rect.z / PAVING_SLAB_M) * PAVING_SLAB_M; wz < rect.z + rect.d; wz += PAVING_SLAB_M) {
      const sy = box.y + (wz - rect.z) * scale;
      ctx.moveTo(box.x, sy);
      ctx.lineTo(box.x + box.w, sy);
    }
  } else if (kind === 'deck' && DECK_BOARD_M * scale >= MIN_DETAIL_PX) {
    // Boards run along x, as in 3D.
    for (let wz = Math.ceil(rect.z / DECK_BOARD_M) * DECK_BOARD_M; wz < rect.z + rect.d; wz += DECK_BOARD_M) {
      const sy = box.y + (wz - rect.z) * scale;
      ctx.moveTo(box.x, sy);
      ctx.lineTo(box.x + box.w, sy);
    }
  } else if (kind === 'gravel' && scale >= 12) {
    // A stipple on a fixed world grid, offset row by row.
    const step = 0.25;
    for (let wz = Math.ceil(rect.z / step) * step; wz < rect.z + rect.d; wz += step) {
      const shift = Math.round(wz / step) % 2 === 0 ? 0 : step / 2;
      for (let wx = Math.ceil((rect.x - shift) / step) * step + shift; wx < rect.x + rect.w; wx += step) {
        const sx = box.x + (wx - rect.x) * scale;
        const sy = box.y + (wz - rect.z) * scale;
        ctx.moveTo(sx + 1, sy);
        ctx.arc(sx, sy, 1, 0, Math.PI * 2);
      }
    }
  }
}

/** The ground floor's garden surfaces, behind what is already painted. */
export function drawGrounds(ctx: CanvasRenderingContext2D, layout: RoomLayout, floor: FloorLayout, t: PlanTransform): void {
  const isGroundFloor = layout.floors[0] === floor || layout.floors[0]?.id === floor.id;
  if (!isGroundFloor) return;
  const grounds = shownGrounds(layout);
  if (grounds.length === 0) return;
  ctx.save();
  // Behind the house: first painted ends up on top, so the detail goes
  // first, then the edge, then the fill.
  ctx.globalCompositeOperation = 'destination-over';
  for (const ground of grounds) {
    const box = canvasRect(layout, ground, t);
    const colors = GROUND_PLAN_COLORS[ground.kind];
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.strokeStyle = colors.edge;
    ctx.fillStyle = colors.edge;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    traceDetail(ctx, ground.kind, ground, box, t.scale);
    if (ground.kind === 'gravel') ctx.fill();
    else ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x + 0.75, box.y + 0.75, box.w - 1.5, box.h - 1.5);
    ctx.fillStyle = colors.fill;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }
  ctx.restore();
}

/** The surface being dragged out (#924), dashed over everything, with its size. */
export function drawGroundDraft(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  draft: { rect: GroundRect; kind: GroundKind },
  t: PlanTransform,
  unit: LengthUnit
): void {
  const box = canvasRect(layout, draft.rect, t);
  const colors = GROUND_PLAN_COLORS[draft.kind];
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = colors.fill;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.setLineDash([]);
  ctx.font = '10px Arial';
  ctx.fillStyle = '#1f2937';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${GROUND_LABELS[draft.kind]} · ${formatSize(draft.rect.w, draft.rect.d, 1, unit)}`, box.x + box.w / 2, box.y - 4);
  ctx.restore();
}
