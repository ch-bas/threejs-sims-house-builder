import type { FloorLayout, FurnitureItem, RoomLayout } from '../lib/types';

export interface Render2DOptions {
  canvas: HTMLCanvasElement;
  /** The building (used for width/height and the optional floor-plan image). */
  layout: RoomLayout;
  /** The floor to render — its items, floor colour, etc. */
  floor: FloorLayout;
  selectedItemId: string | null;
  showMeasurements: boolean;
  showWiFiSignals: boolean;
  showHeatmap?: boolean;
  hasCollision: (item: FurnitureItem) => boolean;
}

const PADDING = 60;
const WIFI_RING_FILLS = ['rgba(0, 255, 0, 0.15)', 'rgba(255, 255, 0, 0.10)', 'rgba(255, 102, 0, 0.08)'];
const WIFI_RING_STROKES = ['rgba(0, 255, 0, 0.4)', 'rgba(255, 255, 0, 0.3)', 'rgba(255, 102, 0, 0.2)'];
const CCTV_RING_FILLS = ['rgba(0, 136, 255, 0.12)', 'rgba(0, 221, 255, 0.08)', 'rgba(136, 0, 255, 0.06)'];
const CCTV_RING_STROKES = ['rgba(0, 136, 255, 0.4)', 'rgba(0, 221, 255, 0.3)', 'rgba(136, 0, 255, 0.2)'];

export function render2DTopDown(options: Render2DOptions): void {
  const { canvas, layout, floor } = options;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scale = Math.min(
    (canvas.width - PADDING * 2) / layout.width,
    (canvas.height - PADDING * 2) / layout.height
  );
  const offsetX = (canvas.width - layout.width * scale) / 2;
  const offsetY = (canvas.height - layout.height * scale) / 2;

  drawFloor(ctx, layout, floor, offsetX, offsetY, scale);
  drawGrid(ctx, layout, offsetX, offsetY, scale);
  drawRoomOutline(ctx, layout, offsetX, offsetY, scale);

  if (options.showHeatmap) {
    drawHeatmap(ctx, layout, floor.items, offsetX, offsetY, scale);
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
  if (layout.floorPlanImage) {
    const img = new Image();
    img.src = layout.floorPlanImage;
    const draw = () => {
      ctx.globalAlpha = layout.floorPlanOpacity ?? 1;
      ctx.drawImage(img, offsetX, offsetY, layout.width * scale, layout.height * scale);
      ctx.globalAlpha = 1;
    };
    if (img.complete) draw();
    else img.onload = draw;
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
  for (let x = 0; x <= layout.width; x += 0.5) {
    ctx.beginPath();
    ctx.moveTo(offsetX + x * scale, offsetY);
    ctx.lineTo(offsetX + x * scale, offsetY + layout.height * scale);
    ctx.stroke();
  }
  for (let y = 0; y <= layout.height; y += 0.5) {
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY + y * scale);
    ctx.lineTo(offsetX + layout.width * scale, offsetY + y * scale);
    ctx.stroke();
  }
}

function drawRoomOutline(
  ctx: CanvasRenderingContext2D,
  layout: RoomLayout,
  offsetX: number,
  offsetY: number,
  scale: number
): void {
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 3;
  ctx.strokeRect(offsetX, offsetY, layout.width * scale, layout.height * scale);
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
    ctx.rotate(item.rotation ?? 0);

    ctx.fillStyle = collision ? 'rgba(255, 0, 0, 0.7)' : item.color;
    ctx.fillRect(-w / 2, -d / 2, w, d);

    if (options.selectedItemId === item.id) {
      ctx.strokeStyle = collision ? '#ff6666' : '#00ff00';
      ctx.lineWidth = 3;
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
      ctx.save();
      ctx.fillStyle = '#333';
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`${item.width}m × ${item.depth}m`, cx, cy + d / 2 + 15);
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
  scale: number
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

    const minX = item.position.x - item.width / 2 + layout.width / 2;
    const maxX = item.position.x + item.width / 2 + layout.width / 2;
    const minZ = item.position.z - item.depth / 2 + layout.height / 2;
    const maxZ = item.position.z + item.depth / 2 + layout.height / 2;

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

  drawHeatmapLegend(ctx, max / cellArea);
}

function drawHeatmapLegend(ctx: CanvasRenderingContext2D, maxPricePerSqM: number): void {
  const padding = 12;
  const barWidth = 140;
  const barHeight = 12;
  const x = ctx.canvas.width - barWidth - padding;
  const y = ctx.canvas.height - barHeight - padding - 18;

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
