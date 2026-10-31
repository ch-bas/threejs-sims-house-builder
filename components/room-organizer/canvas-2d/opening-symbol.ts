import { doorSwing, openingAxes, openingGap, type PlacedItem, type PlanPoint } from '../lib/plan-export/plan-geometry';
import type { View2DTransform } from './render';
import type { FurnitureItem, RoomLayout } from '../lib/types';

/**
 * The door and window symbols of the 2D plan (#576), which the minimap and
 * the blueprint draw through the same renderer: the gap in the wall, then a
 * door's leaf and swing arc or a window's double line, as in the SVG and DXF
 * exports. The item's footprint stays the hit target and takes the selection
 * outline; only the paint changes.
 */

/** Width of the cut across the wall, as the SVG draws it. */
const GAP_M = 0.2;
/**
 * The cut's narrowest paint (px). A snapped opening's centre sits inside the
 * wall line by half its depth, so a smaller strip would leave the line
 * showing through it on a small plan.
 */
const MIN_GAP_PX = 7;
/** A window frame's narrowest paint (px): two lines that stay apart. */
const MIN_FRAME_PX = 5;

const DARK_INK = '#222222';
const LIGHT_INK = '#f5f5f5';

/** WCAG relative luminance of `#rgb` / `#rrggbb`, or null for any other colour. */
export function relativeLuminance(color: string): number | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const [r, g, b] = [0, 2, 4].map((at) => {
    const v = parseInt(full.slice(at, at + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two relative luminances. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The stroke that reads on a floor colour: dark or light, whichever contrasts
 * more, which is over 3:1 on any colour. A colour it can't read (a named one
 * from an imported file) gets the dark ink.
 */
export function symbolInk(floorColor: string): string {
  const floor = relativeLuminance(floorColor);
  if (floor === null) return DARK_INK;
  const dark = relativeLuminance(DARK_INK)!;
  const light = relativeLuminance(LIGHT_INK)!;
  return contrastRatio(floor, light) > contrastRatio(floor, dark) ? LIGHT_INK : DARK_INK;
}

type PlanSize = Pick<RoomLayout, 'width' | 'height'>;

/** World metres (room-centred) → canvas CSS px, as render2DTopDown maps. */
function toCanvas(p: PlanPoint, layout: PlanSize, view: View2DTransform): [number, number] {
  return [view.offsetX + (p.x + layout.width / 2) * view.scale, view.offsetY + (p.z + layout.height / 2) * view.scale];
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: readonly PlanPoint[], layout: PlanSize, view: View2DTransform): void {
  points.forEach((p, i) => {
    const [x, y] = toCanvas(p, layout, view);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/**
 * Add the strip each opening cuts out of its wall to the current path, for
 * the renderer to clip to while it puts back what lies under the wall.
 */
export function traceOpeningGaps(
  ctx: CanvasRenderingContext2D,
  items: readonly FurnitureItem[],
  layout: PlanSize,
  view: View2DTransform
): void {
  const thickness = Math.max(GAP_M, MIN_GAP_PX / view.scale);
  for (const item of items) {
    if (item.position) tracePolygon(ctx, openingGap(item as PlacedItem, thickness), layout, view);
  }
}

/**
 * Draw an opening's symbol in world→canvas space, in the ink that reads on
 * the floor. The wall gap is the renderer's (`traceOpeningGaps`); the caller
 * paints the footprint's state marks (selection, collision) over this.
 */
export function drawOpeningSymbol(
  ctx: CanvasRenderingContext2D,
  item: FurnitureItem,
  floorColor: string,
  layout: PlanSize,
  view: View2DTransform
): void {
  if (!item.position) return;
  const placed = item as PlacedItem;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = symbolInk(floorColor);
  ctx.lineWidth = 1;

  if (item.type === 'door') {
    const { hinge, strike, leafTip } = doorSwing(placed);
    const [hx, hy] = toCanvas(hinge, layout, view);
    const [sx, sy] = toCanvas(strike, layout, view);
    const [lx, ly] = toCanvas(leafTip, layout, view);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(lx, ly);
    ctx.stroke();
    // The quarter turn from shut to open: the short way round, whichever
    // way the axes wind on this wall.
    const from = Math.atan2(sy - hy, sx - hx);
    const to = Math.atan2(ly - hy, lx - hx);
    const counterClockwise = (sx - hx) * (ly - hy) - (sy - hy) * (lx - hx) < 0;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hx, hy, Math.hypot(sx - hx, sy - hy), from, to, counterClockwise);
    ctx.stroke();
  } else {
    // The window: its frame in the wall and the glass down the middle.
    ctx.beginPath();
    tracePolygon(ctx, openingGap(placed, Math.max(item.depth, MIN_FRAME_PX / view.scale)), layout, view);
    ctx.stroke();
    const { along } = openingAxes(placed);
    const half = item.width / 2;
    const { x, z } = placed.position;
    ctx.beginPath();
    ctx.moveTo(...toCanvas({ x: x - along.x * half, z: z - along.z * half }, layout, view));
    ctx.lineTo(...toCanvas({ x: x + along.x * half, z: z + along.z * half }, layout, view));
    ctx.stroke();
  }
  ctx.restore();
}
