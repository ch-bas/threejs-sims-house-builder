import { describe, expect, it } from 'vitest';
import { makeItem, makeUnplacedItem } from '../lib/__testfixtures__/fixtures';
import { computeFloorPlanPlacement, computeHeatmapCells, HEATMAP_COLS, HEATMAP_ROWS } from './render';

// A 10×10 m room with the default 20×20 grid gives 0.5 m cells, so grid
// coordinates are easy to reason about: cell (col, row) spans
// [col·0.5, (col+1)·0.5) × [row·0.5, (row+1)·0.5) in room space, and room
// space is world space shifted by +5 on each axis.
const ROOM = 10;

const sum = (grid: readonly number[]): number => grid.reduce((a, b) => a + b, 0);

describe('computeHeatmapCells — overlap-weighted attribution (#150)', () => {
  it('splits a corner-centred item evenly across the four touched cells and conserves its total', () => {
    // 0.5×0.5 §2000 item centred exactly on the corner shared by cells
    // (9,9)/(10,9)/(9,10)/(10,10): each quadrant overlap is 0.25×0.25 m².
    const item = makeItem({ width: 0.5, depth: 0.5, price: 2000, position: { x: 0, z: 0 } });
    const grid = computeHeatmapCells([item], ROOM, ROOM);

    const touched = [9 * HEATMAP_COLS + 9, 9 * HEATMAP_COLS + 10, 10 * HEATMAP_COLS + 9, 10 * HEATMAP_COLS + 10];
    for (const idx of touched) {
      expect(grid[idx]).toBeCloseTo(500, 8);
    }
    // Sum conservation: exactly the item's own price — the old code counted
    // pricePerArea·cellArea per touched cell (§8000 total here, 4× too hot).
    expect(sum(grid)).toBeCloseTo(2000, 8);
    // Nothing leaked into any other cell.
    const other = grid.filter((_, idx) => !touched.includes(idx));
    expect(Math.max(...other)).toBe(0);
  });

  it('attributes a fully-contained item entirely to its single cell', () => {
    // 0.4×0.4 item centred in cell (0,0) — room-space centre (0.25, 0.25).
    const item = makeItem({ width: 0.4, depth: 0.4, price: 1200, position: { x: -4.75, z: -4.75 } });
    const grid = computeHeatmapCells([item], ROOM, ROOM);

    expect(grid[0]).toBeCloseTo(1200, 8);
    expect(sum(grid)).toBeCloseTo(1200, 8);
    expect(Math.max(...grid.slice(1))).toBe(0);
  });

  it('weights unevenly-straddling items by the actual per-cell fraction', () => {
    // 1×0.5 item spanning grid x ∈ [4.85, 5.85): 0.15 m in col 9, 0.5 m in
    // col 10, 0.35 m in col 11 — all within row 9 (z ∈ [4.5, 5.0)).
    const item = makeItem({ width: 1, depth: 0.5, price: 1000, position: { x: 0.35, z: -0.25 } });
    const grid = computeHeatmapCells([item], ROOM, ROOM);

    const row = 9 * HEATMAP_COLS;
    expect(grid[row + 9]).toBeCloseTo(150, 8);
    expect(grid[row + 10]).toBeCloseTo(500, 8);
    expect(grid[row + 11]).toBeCloseTo(350, 8);
    expect(sum(grid)).toBeCloseTo(1000, 8);
  });

  it('conserves the total for a 90°-rotated item via its swapped AABB', () => {
    const item = makeItem({
      width: 2,
      depth: 0.5,
      price: 3000,
      rotation: Math.PI / 2,
      position: { x: 1.13, z: -0.87 },
    });
    const grid = computeHeatmapCells([item], ROOM, ROOM);
    // At 90° the AABB has the same area as the footprint, so the weighted sum
    // is exactly the price even at an off-grid position.
    expect(sum(grid)).toBeCloseTo(3000, 8);
  });

  it('ignores unplaced, free, and zero-area items', () => {
    const unplaced = makeUnplacedItem({ id: 'a', price: 500 });
    const free = makeItem({ id: 'b', price: 0 });
    const zeroArea = makeItem({ id: 'c', price: 500, width: 0 });
    const grid = computeHeatmapCells([unplaced, free, zeroArea], ROOM, ROOM);
    expect(sum(grid)).toBe(0);
    expect(grid).toHaveLength(HEATMAP_COLS * HEATMAP_ROWS);
  });
});

describe('computeFloorPlanPlacement (#218)', () => {
  it('stretch fills the room with the whole image', () => {
    const { source, dest } = computeFloorPlanPlacement(2000, 1000, 1, 'stretch');
    expect(source).toEqual({ x: 0, y: 0, w: 2000, h: 1000 });
    expect(dest).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('cover crops a wide image to the room aspect, centered', () => {
    const { source, dest } = computeFloorPlanPlacement(2000, 1000, 1, 'cover');
    // Square room: keep a 1000-wide centered band of the 2000-wide image.
    expect(source).toEqual({ x: 500, y: 0, w: 1000, h: 1000 });
    expect(dest).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('cover crops a tall image vertically', () => {
    const { source } = computeFloorPlanPlacement(1000, 2000, 1, 'cover');
    expect(source).toEqual({ x: 0, y: 500, w: 1000, h: 1000 });
  });

  it('contain letterboxes a wide image with centered bands', () => {
    const { source, dest } = computeFloorPlanPlacement(2000, 1000, 1, 'contain');
    expect(source).toEqual({ x: 0, y: 0, w: 2000, h: 1000 });
    expect(dest.w).toBe(1);
    expect(dest.h).toBeCloseTo(0.5, 10);
    expect(dest.y).toBeCloseTo(0.25, 10);
  });

  it('contain pillarboxes a tall image', () => {
    const { dest } = computeFloorPlanPlacement(1000, 2000, 1, 'contain');
    expect(dest.h).toBe(1);
    expect(dest.w).toBeCloseTo(0.5, 10);
    expect(dest.x).toBeCloseTo(0.25, 10);
  });

  it('contain preserves the image aspect in room space for any room', () => {
    for (const roomAspect of [0.5, 1, 1.6, 3]) {
      const { dest } = computeFloorPlanPlacement(1600, 900, roomAspect, 'contain');
      const paintedAspect = (dest.w * roomAspect) / dest.h;
      expect(paintedAspect).toBeCloseTo(1600 / 900, 10);
    }
  });
});
