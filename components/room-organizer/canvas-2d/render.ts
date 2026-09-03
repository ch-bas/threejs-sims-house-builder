import { GRID_SIZE_METERS } from '../lib/constants';
import { rotatedHalfExtents } from '../lib/geometry';
import type { FloorLayout, FurnitureItem, RoomLayout } from '../lib/types';

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

  const padding = options.padding ?? PADDING;
  const scale = Math.min(
    (viewWidth - padding * 2) / layout.width,
    (viewHeight - padding * 2) / layout.height
  );
  const offsetX = (viewWidth - layout.width * scale) / 2;
  const offsetY = (viewHeight - layout.height * scale) / 2;

  drawFloor(ctx, layout, floor, offsetX, offsetY, scale);
  drawGrid(ctx, layout, offsetX, offsetY, scale);
  drawRoomOutline(ctx, layout, floor, offsetX, offsetY, scale);
  drawInteriorWalls(ctx, layout, floor, offsetX, offsetY, scale);

  if (options.showHeatmap) {
    drawHeatmap(ctx, layout, floor.items, offsetX, offsetY, scale, viewWidth, viewHeight);
  }

  if (options.showWiFiSignals) {
    drawSignalRings(ctx, floor.items, offsetX, offsetY, scale, layout, 'wifi');
    drawSignalRings(ctx, floor.items, offsetX, offsetY, scale, layout, 'cctv');
  }

  drawFurniture(ctx, options, offsetX, offsetY, scale);

  if (options.showMeasurements) {
    drawRoomDimensions(ctx, layout, offsetX, offsetY, scale);
  }
}

function drawFloor(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  floor: FloorLayout,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  const url = layout.floorPlanImage;
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
        ctx.globalAlpha = layout.floorPlanOpacity ?? 1;
        ctx.drawImage(img, offsetX, offsetY, layout.width * scale, layout.height * scale);
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
  const edges = [
    { id: 'north', from: [x0, y0], to: [x1, y0] },
    { id: 'south', from: [x0, y1], to: [x1, y1] },
    { id: 'west', from: [x0, y0], to: [x0, y1] },
    { id: 'east', from: [x1, y0], to: [x1, y1] },
  ] as const;
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

function drawFurniture(
  ctx: CanvasRenderingContext2D,
  options: Render2DOptions,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  for (const item of options.floor.items) {
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
    ctx.fillText(item.icon, 0, 0);
    ctx.restore();

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

/**
 * Paint a price-per-area heatmap onto the 2D canvas. The floor is bucketed
 * into a 20×20 grid; each cell aggregates the price of any item whose
 * footprint overlaps the cell, then colour-maps the density. Also draws a
 * compact legend showing the per-square-metre value range.
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
  const COLS = 20;
  const ROWS = 20;
  const cellWidth = layout.width / COLS;
  const cellDepth = layout.height / ROWS;
  const cellArea = cellWidth * cellDepth;
  if (cellArea <= 0) return;

  const grid: number[] = new Array(COLS * ROWS).fill(0);

  for (const item of items) {
    if (!item.position || (item.price ?? 0) <= 0) continue;
    const itemArea = item.width * item.depth;
    if (itemArea <= 0) continue;
    const pricePerArea = (item.price ?? 0) / itemArea;

    // Use the rotation-aware AABB so a rotated item shades the cells its
    // oriented footprint actually covers.
    const { halfW, halfD } = rotatedHalfExtents(item);
    const minX = item.position.x - halfW + layout.width / 2;
    const maxX = item.position.x + halfW + layout.width / 2;
    const minZ = item.position.z - halfD + layout.height / 2;
    const maxZ = item.position.z + halfD + layout.height / 2;

    const col0 = Math.max(0, Math.floor(minX / cellWidth));
    const col1 = Math.min(COLS - 1, Math.floor(maxX / cellWidth));
    const row0 = Math.max(0, Math.floor(minZ / cellDepth));
    const row1 = Math.min(ROWS - 1, Math.floor(maxZ / cellDepth));

    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const idx = row * COLS + col;
        grid[idx] = (grid[idx] ?? 0) + pricePerArea * cellArea;
      }
    }
  }

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
  ctx.fillText('§/m² density', x, y - 4);
  ctx.fillText('0', x, y + barHeight + 12);
  ctx.textAlign = 'right';
  ctx.fillText(`§${Math.round(maxPricePerSqM).toLocaleString()}`, x + barWidth, y + barHeight + 12);
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
