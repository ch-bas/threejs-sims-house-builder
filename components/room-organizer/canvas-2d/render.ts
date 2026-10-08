import { CURRENCY_SYMBOL, DEFAULT_FLOOR_PLAN_OPACITY, GRID_SIZE_METERS } from '../lib/constants';
import { computeFloorPlanPlacement } from '../lib/floor-plan-fit';
import { rotatedHalfExtents } from '../lib/geometry';
import { planDrawOrder } from '../lib/plan-order';
import { entrancePlanOutline, planFloorIndex } from '../lib/street';
import { zoneArea, type ZoneRect } from '../lib/zones';
import { drawStairsSymbol, drawStairwellHoles } from './stairs-symbol';
import type { FloorLayout, FurnitureItem, RoomLayout, WallId } from '../lib/types';

export { computeFloorPlanPlacement } from '../lib/floor-plan-fit';

export interface Render2DOptions {
  canvas: HTMLCanvasElement;
  /** The building (used for width/height and the optional floor-plan image). */
  layout: RoomLayout;
  /** The floor to render — its items, floor colour, etc. */
  floor: FloorLayout;
  selectedItemId: string | null;
  /** Multi-select extras — outlined like the primary so group state is visible (#118). */
  extraSelectedIds?: ReadonlySet<string>;
  showMeasurements: boolean;
  showWiFiSignals: boolean;
  showHeatmap?: boolean;
  /** The zone rectangle being dragged out, drawn over everything as a dashed outline (#155). */
  zoneDraft?: ZoneRect | null;
  hasCollision: (item: FurnitureItem) => boolean;
  /**
   * Margin (CSS px) around the room. The default suits the full-screen 2D
   * view; small consumers (the 180×130 minimap) must pass a small value or
   * the margin consumes the whole canvas (#118).
   */
  padding?: number;
}

const PADDING = 60;
// Matches the 0.16 m thickness modelled in three/interior-walls.ts.
const INTERIOR_WALL_THICKNESS_M = 0.16;

/** The world→canvas mapping the 2D renderer draws with (CSS-pixel space). */
export interface View2DTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * The exact fit-and-centre transform `render2DTopDown` paints with, exposed so
 * pointer handling and drop placement can invert it (#166, #219). The renderer
 * itself calls this, so the two can never diverge.
 */
export function get2DViewTransform(
  canvasClientWidth: number,
  canvasClientHeight: number,
  layout: Pick<RoomLayout, 'width' | 'height'>,
  padding: number = PADDING
): View2DTransform {
  const scale = Math.min(
    (canvasClientWidth - padding * 2) / layout.width,
    (canvasClientHeight - padding * 2) / layout.height
  );
  const offsetX = (canvasClientWidth - layout.width * scale) / 2;
  const offsetY = (canvasClientHeight - layout.height * scale) / 2;
  return { scale, offsetX, offsetY };
}

/** Inverse of the renderer's mapping: canvas CSS px → world x/z (room-centred). */
export function canvasToWorld(
  px: number,
  py: number,
  transform: View2DTransform,
  layout: Pick<RoomLayout, 'width' | 'height'>
): { x: number; z: number } {
  return {
    x: (px - transform.offsetX) / transform.scale - layout.width / 2,
    z: (py - transform.offsetY) / transform.scale - layout.height / 2,
  };
}

// Decoded floor-plan image cache, keyed on the data-URL. Decoding a multi-MB
// data-URL is async: the first render kicks off the load and re-renders once
// the pixels are ready (so the image never paints over grid/furniture drawn
// after it). Subsequent renders reuse the cached, already-decoded Image and
// draw it synchronously in the correct layer order.
let floorPlanImageCache: { url: string; image: HTMLImageElement } | null = null;

/**
 * Callbacks the consumers install so the async floor-plan decode can trigger
 * a full repaint (redrawing the whole scene in the right layer order) once
 * the image is ready. A set, not a single slot: the 2D view AND the minimap
 * render concurrently, and a single-slot handler dropped whichever consumer
 * didn't own it — the minimap never repainted after a decode (#118).
 */
const repaintHandlers = new Set<() => void>();

/** Register a repaint handler; returns the disposer that unregisters it. */
export function addFloorPlanRepaintHandler(handler: () => void): () => void {
  repaintHandlers.add(handler);
  return () => repaintHandlers.delete(handler);
}

function requestRepaint(): void {
  for (const handler of repaintHandlers) handler();
}
const WIFI_RING_FILLS = ['rgba(0, 255, 0, 0.15)', 'rgba(255, 255, 0, 0.10)', 'rgba(255, 102, 0, 0.08)'];
const WIFI_RING_STROKES = ['rgba(0, 255, 0, 0.4)', 'rgba(255, 255, 0, 0.3)', 'rgba(255, 102, 0, 0.2)'];
const CCTV_RING_FILLS = ['rgba(0, 136, 255, 0.12)', 'rgba(0, 221, 255, 0.08)', 'rgba(136, 0, 255, 0.06)'];
const CCTV_RING_STROKES = ['rgba(0, 136, 255, 0.4)', 'rgba(0, 221, 255, 0.3)', 'rgba(136, 0, 255, 0.2)'];

export function render2DTopDown(options: Render2DOptions): void {
  const { canvas, layout, floor } = options;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // The backing store is sized clientWidth/clientHeight × devicePixelRatio (by
  // the ResizeObserver in use-scene-effects), but all drawing below works in
  // CSS-pixel (logical) coordinates. Reset the transform to a DPR scale so 1
  // logical unit maps to `dpr` device pixels — that keeps strokes and text
  // crisp on retina while the layout maths stays resolution-independent.
  const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
  const viewWidth = canvas.width / dpr;
  const viewHeight = canvas.height / dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewWidth, viewHeight);

  const { scale, offsetX, offsetY } = get2DViewTransform(viewWidth, viewHeight, layout, options.padding ?? PADDING);

  drawFloor(ctx, layout, floor, offsetX, offsetY, scale);
  drawGrid(ctx, layout, offsetX, offsetY, scale);
  // The stairwell the floor below cuts through this slab (#290), under everything placed over it.
  drawStairwellHoles(ctx, layout, planFloorIndex(layout.floors, floor), { scale, offsetX, offsetY });
  // Zone tints sit on the floor under the walls; their labels go over the
  // walls but under the furniture, like a plan's room names (#155).
  drawZoneFills(ctx, layout, floor, offsetX, offsetY, scale);
  drawRoomOutline(ctx, layout, floor, offsetX, offsetY, scale);
  drawInteriorWalls(ctx, layout, floor, offsetX, offsetY, scale);
  drawZoneLabels(ctx, layout, floor, offsetX, offsetY, scale, options.showMeasurements);

  if (options.showHeatmap) {
    drawHeatmap(ctx, layout, floor.items, offsetX, offsetY, scale, viewWidth, viewHeight);
  }

  if (options.showWiFiSignals) {
    drawSignalRings(ctx, floor.items, offsetX, offsetY, scale, layout, 'wifi');
    drawSignalRings(ctx, floor.items, offsetX, offsetY, scale, layout, 'cctv');
    drawVisionCones(ctx, floor.items, offsetX, offsetY, scale, layout);
  }

  drawFurniture(ctx, options, offsetX, offsetY, scale);

  if (options.showMeasurements) {
    drawRoomDimensions(ctx, layout, offsetX, offsetY, scale);
  }

  if (options.zoneDraft) {
    drawZoneDraft(ctx, layout, options.zoneDraft, offsetX, offsetY, scale);
  }
}

/** Fill / outline alpha of a zone's tint, on top of the floor colour or tracing image. */
export const ZONE_FILL_ALPHA = 0.18;
export const ZONE_STROKE_ALPHA = 0.7;
/** A zone painted smaller than this (px, either edge) is too small for a label — the minimap. */
const ZONE_MIN_LABEL_EDGE_PX = 36;

/**
 * `#rgb` / `#rrggbb` → `rgba(...)` at the given alpha. Anything else (a
 * named colour from an imported file) is returned as-is: it still paints,
 * just without the tint.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function zoneCanvasRect(
  zone: ZoneRect,
  layout: RoomLayout,
  offsetX: number,
  offsetY: number,
  scale: number
): { x: number; y: number; w: number; h: number } {
  return {
    x: offsetX + (zone.x + layout.width / 2) * scale,
    y: offsetY + (zone.z + layout.height / 2) * scale,
    w: zone.w * scale,
    h: zone.d * scale,
  };
}

function drawZoneFills(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  floor: FloorLayout,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  const zones = floor.zones ?? [];
  if (zones.length === 0) return;
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const zone of zones) {
    const { x, y, w, h } = zoneCanvasRect(zone, layout, offsetX, offsetY, scale);
    ctx.fillStyle = withAlpha(zone.color, ZONE_FILL_ALPHA);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = withAlpha(zone.color, ZONE_STROKE_ALPHA);
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function drawZoneLabels(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  floor: FloorLayout,
  offsetX: number,
  offsetY: number,
  scale: number,
  showArea: boolean
): void {
  const zones = floor.zones ?? [];
  if (zones.length === 0) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A white halo keeps the name legible over any floor colour or tracing image.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 3;
  ctx.fillStyle = '#333';
  for (const zone of zones) {
    const { x, y, w, h } = zoneCanvasRect(zone, layout, offsetX, offsetY, scale);
    if (Math.min(w, h) < ZONE_MIN_LABEL_EDGE_PX) continue;
    // Along the top edge rather than the centre: the centre of a room is
    // where its bed or table sits, and the furniture paints over labels.
    const cx = x + w / 2;
    const area = showArea ? `${zoneArea(zone).toFixed(1)} m²` : null;
    ctx.font = 'bold 12px Arial';
    ctx.strokeText(zone.name, cx, y + 11);
    ctx.fillText(zone.name, cx, y + 11);
    if (area) {
      ctx.font = '10px Arial';
      ctx.strokeText(area, cx, y + 25);
      ctx.fillText(area, cx, y + 25);
    }
  }
  ctx.restore();
}

function drawZoneDraft(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  draft: ZoneRect,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  const { x, y, w, h } = zoneCanvasRect(draft, layout, offsetX, offsetY, scale);
  ctx.save();
  ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.font = '10px Arial';
  ctx.fillStyle = '#1d4ed8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${draft.w.toFixed(1)}m × ${draft.d.toFixed(1)}m`, x + w / 2, y - 4);
  ctx.restore();
}

function drawFloor(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  floor: FloorLayout,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  // The tracing image belongs to the ground floor only, like in 3D
  // (use-scene-effects keys it on floor index 0) — painting it under every
  // storey put the ground-floor scan in upstairs blueprints (#218). Derived
  // here from data both callers already pass, so no caller can forget it.
  const isGroundFloor = layout.floors[0] === floor || layout.floors[0]?.id === floor.id;
  const url = isGroundFloor ? layout.floorPlanImage : undefined;
  if (url) {
    // Fill the floor colour first so there's a base while (or if) the image is
    // still decoding — avoids a flash of the raw canvas background.
    ctx.fillStyle = floor.floorColor;
    ctx.fillRect(offsetX, offsetY, layout.width * scale, layout.height * scale);

    // naturalWidth guard: a broken image also reports `complete`, and
    // drawImage on it throws InvalidStateError — which would abort the whole
    // paint (grid and furniture never drawn) on every repaint (#118).
    if (floorPlanImageCache?.url === url && floorPlanImageCache.image.complete) {
      const img = floorPlanImageCache.image;
      if (img.naturalWidth > 0) {
        const { source, dest } = computeFloorPlanPlacement(
          img.naturalWidth,
          img.naturalHeight,
          layout.width / layout.height,
          layout.floorPlanFitMode ?? 'stretch'
        );
        const roomW = layout.width * scale;
        const roomH = layout.height * scale;
        ctx.globalAlpha = layout.floorPlanOpacity ?? DEFAULT_FLOOR_PLAN_OPACITY;
        ctx.drawImage(
          img,
          source.x,
          source.y,
          source.w,
          source.h,
          offsetX + dest.x * roomW,
          offsetY + dest.y * roomH,
          dest.w * roomW,
          dest.h * roomH
        );
        ctx.globalAlpha = 1;
      }
      return;
    }

    // Not cached (or a different plan): decode once, then trigger a full
    // repaint so grid/furniture end up on top of the image instead of the
    // async onload painting over them.
    if (floorPlanImageCache?.url !== url) {
      const img = new Image();
      floorPlanImageCache = { url, image: img };
      img.onload = () => {
        // Ignore stale loads if the plan changed again before this resolved.
        if (floorPlanImageCache?.image === img) requestRepaint?.();
      };
      img.src = url;
    }
  } else {
    ctx.fillStyle = floor.floorColor;
    ctx.fillRect(offsetX, offsetY, layout.width * scale, layout.height * scale);
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  // Anchor the grid to the world centre (0,0) so the drawn cells line up with
  // `snapToGrid`, which rounds world coordinates to multiples of
  // GRID_SIZE_METERS about the origin. Corner-anchoring (0, 0.5, 1.0 …) drifts
  // by `(width/2 mod GRID_SIZE_METERS)` and makes items look off-grid.
  const halfW = layout.width / 2;
  const halfD = layout.height / 2;
  for (let wx = Math.ceil(-halfW / GRID_SIZE_METERS) * GRID_SIZE_METERS; wx <= halfW; wx += GRID_SIZE_METERS) {
    const sx = offsetX + (wx + halfW) * scale;
    ctx.beginPath();
    ctx.moveTo(sx, offsetY);
    ctx.lineTo(sx, offsetY + layout.height * scale);
    ctx.stroke();
  }
  for (let wz = Math.ceil(-halfD / GRID_SIZE_METERS) * GRID_SIZE_METERS; wz <= halfD; wz += GRID_SIZE_METERS) {
    const sy = offsetY + (wz + halfD) * scale;
    ctx.beginPath();
    ctx.moveTo(offsetX, sy);
    ctx.lineTo(offsetX + layout.width * scale, sy);
    ctx.stroke();
  }
}

function drawRoomOutline(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  floor: FloorLayout,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  // Per-edge, not strokeRect: a wall hidden via Wall Visibility (or Delete)
  // reads as a light dashed boundary instead of a solid wall (#118).
  const hidden = new Set(floor.hiddenWalls ?? []);
  const x0 = offsetX;
  const y0 = offsetY;
  const x1 = offsetX + layout.width * scale;
  const y1 = offsetY + layout.height * scale;
  // The recessed entrance (#285): the north edge breaks across the opening
  // and the recess's two cheeks run back to its rear wall (an ordinary
  // interior wall carrying the porch door, drawn with the others). The
  // recess itself is cleared to the canvas background — the outside — over
  // the floor, grid, tracing image and zone tints painted before this.
  const recess = entrancePlanOutline(layout, planFloorIndex(layout.floors, floor));
  const rx0 = recess ? offsetX + (recess.x0 + layout.width / 2) * scale : x0;
  const rx1 = recess ? offsetX + (recess.x1 + layout.width / 2) * scale : x1;
  const ry1 = recess ? offsetY + (recess.backZ + layout.height / 2) * scale : y0;
  if (recess) ctx.clearRect(rx0, y0, rx1 - rx0, ry1 - y0);
  type Edge = { id: WallId; from: readonly [number, number]; to: readonly [number, number] };
  const north: Edge[] = recess
    ? [
        { id: 'north', from: [x0, y0], to: [rx0, y0] },
        { id: 'north', from: [rx0, y0], to: [rx0, ry1] },
        { id: 'north', from: [rx1, y0], to: [rx1, ry1] },
        { id: 'north', from: [rx1, y0], to: [x1, y0] },
      ]
    : [{ id: 'north', from: [x0, y0], to: [x1, y0] }];
  const edges: Edge[] = [
    ...north,
    { id: 'south', from: [x0, y1], to: [x1, y1] },
    { id: 'west', from: [x0, y0], to: [x0, y1] },
    { id: 'east', from: [x1, y0], to: [x1, y1] },
  ];
  for (const edge of edges) {
    const isHidden = hidden.has(edge.id);
    ctx.save();
    ctx.strokeStyle = isHidden ? '#bbb' : '#666';
    ctx.lineWidth = isHidden ? 1.5 : 3;
    if (isHidden) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(edge.from[0], edge.from[1]);
    ctx.lineTo(edge.to[0], edge.to[1]);
    ctx.stroke();
    ctx.restore();
  }
}

function drawInteriorWalls(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  floor: FloorLayout,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  const walls = floor.interiorWalls ?? [];
  if (walls.length === 0) return;
  const halfW = layout.width / 2;
  const halfD = layout.height / 2;
  ctx.save();
  ctx.strokeStyle = '#555';
  ctx.lineCap = 'butt';
  ctx.lineWidth = Math.max(2, INTERIOR_WALL_THICKNESS_M * scale);
  for (const wall of walls) {
    ctx.beginPath();
    ctx.moveTo(offsetX + (wall.x1 + halfW) * scale, offsetY + (wall.z1 + halfD) * scale);
    ctx.lineTo(offsetX + (wall.x2 + halfW) * scale, offsetY + (wall.z2 + halfD) * scale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSignalRings(
  ctx: CanvasRenderingContext2D,
  items: readonly FurnitureItem[],
  offsetX: number,
  offsetY: number,
  scale: number,
  layout: RoomLayout,
  kind: 'wifi' | 'cctv'
): void {
  const fills = kind === 'wifi' ? WIFI_RING_FILLS : CCTV_RING_FILLS;
  const strokes = kind === 'wifi' ? WIFI_RING_STROKES : CCTV_RING_STROKES;
  const predicate = (item: FurnitureItem) =>
    Boolean(item.position && item.signalRange && (kind === 'wifi' ? item.isWiFiAccessPoint : item.isCCTV));

  for (const item of items.filter(predicate)) {
    if (!item.position || !item.signalRange) continue;
    const cx = offsetX + (item.position.x + layout.width / 2) * scale;
    const cy = offsetY + (item.position.z + layout.height / 2) * scale;

    for (let ring = 3; ring >= 1; ring--) {
      const radius = (item.signalRange * ring * scale) / 3;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = fills[ring - 1] ?? 'transparent';
      ctx.fill();
      ctx.strokeStyle = strokes[ring - 1] ?? 'transparent';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/**
 * Security-camera FOV wedges — the flagship coverage feature was invisible in
 * exactly the artifacts you'd plan coverage with: the 2D plan and the printed
 * blueprint (#134). Drawn under the furniture layer like the signal rings.
 */
function drawVisionCones(
  ctx: CanvasRenderingContext2D,
  items: readonly FurnitureItem[],
  offsetX: number,
  offsetY: number,
  scale: number,
  layout: RoomLayout
): void {
  for (const item of items) {
    if (!item.position || !item.hasVisionCone || !item.visionRange || !item.visionFov) continue;
    const cx = offsetX + (item.position.x + layout.width / 2) * scale;
    const cy = offsetY + (item.position.z + layout.height / 2) * scale;
    // The camera faces its local +Z: world direction (sin r, cos r), which
    // maps straight onto canvas axes (x right, z down) — no negation, unlike
    // the footprint rotation, which goes through ctx.rotate().
    const rotation = item.rotation ?? 0;
    const centerAngle = Math.atan2(Math.cos(rotation), Math.sin(rotation));
    const halfAngle = (item.visionFov * Math.PI) / 360;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, item.visionRange * scale, centerAngle - halfAngle, centerAngle + halfAngle);
    ctx.closePath();
    ctx.fillStyle = 'rgba(127, 243, 255, 0.14)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(127, 243, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawFurniture(
  ctx: CanvasRenderingContext2D,
  options: Render2DOptions,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  // Layer order (#286): rugs first, then floor furniture, tabletop items,
  // wall-mounted — so a rug listed after its sofa still paints beneath it.
  for (const item of planDrawOrder(options.floor.items)) {
    if (!item.position) continue;
    const collision = options.hasCollision(item);
    const cx = offsetX + (item.position.x + options.layout.width / 2) * scale;
    const cy = offsetY + (item.position.z + options.layout.height / 2) * scale;
    const w = item.width * scale;
    const d = item.depth * scale;

    ctx.save();
    ctx.translate(cx, cy);
    // Canvas rotate() is clockwise while Three's rotateY is CCW; negate so the
    // 2D footprint matches the 3D scene's orientation.
    ctx.rotate(-(item.rotation ?? 0));

    ctx.fillStyle = collision ? 'rgba(255, 0, 0, 0.7)' : item.color;
    ctx.fillRect(-w / 2, -d / 2, w, d);

    if (options.selectedItemId === item.id) {
      ctx.strokeStyle = collision ? '#ff6666' : '#00ff00';
      ctx.lineWidth = 3;
    } else if (options.extraSelectedIds?.has(item.id)) {
      // Multi-select extras share the primary's green, slightly thinner.
      ctx.strokeStyle = collision ? '#ff6666' : '#00cc00';
      ctx.lineWidth = 2;
    } else if (collision) {
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
    }
    ctx.strokeRect(-w / 2, -d / 2, w, d);

    ctx.font = `${Math.min(w, d) * 0.6}px Arial`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Stairs draw their treads and climb arrow in place of the icon (#290),
    // in world space once the item's rotated frame is restored.
    if (item.type !== 'stairs') ctx.fillText(item.icon, 0, 0);
    ctx.restore();
    if (item.type === 'stairs') drawStairsSymbol(ctx, item, options.layout, { scale, offsetX, offsetY });

    if (options.showMeasurements) {
      // The label is drawn in screen space (outside the rotated transform), so
      // offset it by the rotation-aware AABB half-depth to clear the footprint.
      const { halfD } = rotatedHalfExtents(item);
      ctx.save();
      ctx.fillStyle = '#333';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`${item.width}m × ${item.depth}m`, cx, cy + halfD * scale + 15);
      ctx.restore();
    }
  }
  drawSelectionOutlines(ctx, options, offsetX, offsetY, scale);
}

/**
 * Re-strokes the selection outlines after every item is painted (#286): the
 * layer order can put a selected item (a rug) beneath later-drawn furniture,
 * and its in-loop outline would then be partly hidden. Same colours as the
 * in-loop stroke, so an unobstructed item looks unchanged.
 */
function drawSelectionOutlines(
  ctx: CanvasRenderingContext2D,
  options: Render2DOptions,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  for (const item of options.floor.items) {
    if (!item.position) continue;
    const primary = options.selectedItemId === item.id;
    if (!primary && !options.extraSelectedIds?.has(item.id)) continue;
    const collision = options.hasCollision(item);
    const w = item.width * scale;
    const d = item.depth * scale;
    ctx.save();
    ctx.translate(
      offsetX + (item.position.x + options.layout.width / 2) * scale,
      offsetY + (item.position.z + options.layout.height / 2) * scale
    );
    ctx.rotate(-(item.rotation ?? 0));
    ctx.strokeStyle = collision ? '#ff6666' : primary ? '#00ff00' : '#00cc00';
    ctx.lineWidth = primary ? 3 : 2;
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.restore();
  }
}

function drawRoomDimensions(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  ctx.fillStyle = '#333';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${layout.width}m`, offsetX + (layout.width * scale) / 2, offsetY - 10);
  ctx.save();
  ctx.translate(offsetX - 10, offsetY + (layout.height * scale) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${layout.height}m`, 0, 0);
  ctx.restore();
}

/** Grid resolution of the price heatmap (cells per axis). */
export const HEATMAP_COLS = 20;
export const HEATMAP_ROWS = 20;

/**
 * Pure heatmap accumulation: bucket the floor into a COLS×ROWS grid and
 * attribute each priced item's value to the cells its rotation-aware AABB
 * overlaps, weighted by the actual intersection area — a cell only grazed by
 * an item's corner receives the matching fraction of its price, not the full
 * per-cell amount (#150). Returns the row-major grid of price (§) per cell.
 */
export function computeHeatmapCells(
  items: readonly FurnitureItem[],
  roomWidth: number,
  roomDepth: number,
  cols: number = HEATMAP_COLS,
  rows: number = HEATMAP_ROWS
): number[] {
  const grid: number[] = new Array(cols * rows).fill(0);
  const cellWidth = roomWidth / cols;
  const cellDepth = roomDepth / rows;
  if (cellWidth <= 0 || cellDepth <= 0) return grid;

  for (const item of items) {
    if (!item.position || (item.price ?? 0) <= 0) continue;
    const itemArea = item.width * item.depth;
    if (itemArea <= 0) continue;
    const pricePerArea = (item.price ?? 0) / itemArea;

    // Use the rotation-aware AABB so a rotated item shades the cells its
    // oriented footprint actually covers.
    const { halfW, halfD } = rotatedHalfExtents(item);
    const minX = item.position.x - halfW + roomWidth / 2;
    const maxX = item.position.x + halfW + roomWidth / 2;
    const minZ = item.position.z - halfD + roomDepth / 2;
    const maxZ = item.position.z + halfD + roomDepth / 2;

    const col0 = Math.max(0, Math.floor(minX / cellWidth));
    const col1 = Math.min(cols - 1, Math.floor(maxX / cellWidth));
    const row0 = Math.max(0, Math.floor(minZ / cellDepth));
    const row1 = Math.min(rows - 1, Math.floor(maxZ / cellDepth));

    for (let row = row0; row <= row1; row++) {
      const cellTop = row * cellDepth;
      const overlapZ = Math.min(maxZ, cellTop + cellDepth) - Math.max(minZ, cellTop);
      if (overlapZ <= 0) continue;
      for (let col = col0; col <= col1; col++) {
        const cellLeft = col * cellWidth;
        const overlapX = Math.min(maxX, cellLeft + cellWidth) - Math.max(minX, cellLeft);
        if (overlapX <= 0) continue;
        const idx = row * cols + col;
        grid[idx] = (grid[idx] ?? 0) + pricePerArea * overlapX * overlapZ;
      }
    }
  }

  return grid;
}

/**
 * Paint a price-per-area heatmap onto the 2D canvas. The floor is bucketed
 * into a 20×20 grid; each cell aggregates the price of any item whose
 * footprint overlaps the cell (weighted by intersection area), then
 * colour-maps the density. Also draws a compact legend showing the
 * per-square-metre value range.
 */
function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  items: readonly FurnitureItem[],
  offsetX: number,
  offsetY: number,
  scale: number,
  viewWidth: number,
  viewHeight: number
): void {
  const COLS = HEATMAP_COLS;
  const ROWS = HEATMAP_ROWS;
  const cellWidth = layout.width / COLS;
  const cellDepth = layout.height / ROWS;
  const cellArea = cellWidth * cellDepth;
  if (cellArea <= 0) return;

  const grid = computeHeatmapCells(items, layout.width, layout.height, COLS, ROWS);

  const max = Math.max(...grid);
  if (max <= 0) return;

  // Cells.
  ctx.save();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const value = grid[row * COLS + col] ?? 0;
      if (value <= 0) continue;
      const ratio = value / max;
      ctx.fillStyle = heatColor(ratio);
      ctx.fillRect(
        offsetX + col * cellWidth * scale,
        offsetY + row * cellDepth * scale,
        cellWidth * scale + 1,
        cellDepth * scale + 1
      );
    }
  }
  ctx.restore();

  drawHeatmapLegend(ctx, max / cellArea, viewWidth, viewHeight);
}

function drawHeatmapLegend(
  ctx: CanvasRenderingContext2D,
  maxPricePerSqM: number,
  viewWidth: number,
  viewHeight: number
): void {
  const padding = 12;
  const barWidth = 140;
  const barHeight = 12;
  // Position in logical (CSS-pixel) space — ctx is DPR-scaled, so using the raw
  // backing-store size (ctx.canvas.width) would push the legend off-screen on
  // retina.
  const x = viewWidth - barWidth - padding;
  const y = viewHeight - barHeight - padding - 18;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  const boxX = x - 8;
  const boxY = y - 14;
  const boxW = barWidth + 16;
  const boxH = barHeight + 36;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  // Gradient bar.
  const gradient = ctx.createLinearGradient(x, 0, x + barWidth, 0);
  gradient.addColorStop(0, 'rgba(0, 200, 0, 0.9)');
  gradient.addColorStop(0.5, 'rgba(255, 200, 0, 0.9)');
  gradient.addColorStop(1, 'rgba(255, 0, 0, 0.9)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, barWidth, barHeight);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(x, y, barWidth, barHeight);

  ctx.fillStyle = '#333';
  ctx.font = '10px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`${CURRENCY_SYMBOL}/m² density`, x, y - 4);
  ctx.fillText('0', x, y + barHeight + 12);
  ctx.textAlign = 'right';
  ctx.fillText(
    `${CURRENCY_SYMBOL}${Math.round(maxPricePerSqM).toLocaleString()}`,
    x + barWidth,
    y + barHeight + 12
  );
  ctx.restore();
}

function heatColor(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  // Green (low) → yellow (mid) → red (high), with constant alpha.
  if (t < 0.5) {
    const k = t / 0.5;
    const r = Math.round(k * 255);
    return `rgba(${r}, 200, 0, 0.35)`;
  }
  const k = (t - 0.5) / 0.5;
  const g = Math.round((1 - k) * 200);
  return `rgba(255, ${g}, 0, 0.45)`;
}

/**
 * Resolve once the floor-plan image for `url` is in the decoded-image cache
 * above, so a synchronous `render2DTopDown` that follows paints it. The
 * cache is warmed lazily by the first render and repainted via
 * `addFloorPlanRepaintHandler` — a one-shot consumer with nothing to repaint
 * (the blueprint printout) captured only the floor colour when nothing had
 * rendered the plan yet, e.g. in 3D view with the minimap off (#288). Never
 * rejects: a broken image resolves too, and the render's naturalWidth guard
 * then skips it exactly as it does for a live repaint.
 */
export function ensureFloorPlanImageDecoded(url: string): Promise<void> {
  let entry = floorPlanImageCache;
  if (entry?.url !== url) {
    const img = new Image();
    entry = { url, image: img };
    floorPlanImageCache = entry;
    img.onload = () => {
      // Same stale-load guard as drawFloor: the plan may change mid-decode.
      if (floorPlanImageCache?.image === img) requestRepaint();
    };
    img.src = url;
  }
  const { image } = entry;
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => resolve();
    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
  });
}
