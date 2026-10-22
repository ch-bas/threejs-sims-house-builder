import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from '../lib/__testfixtures__/fixtures';
import { canvasToWorld, computeFloorPlanPlacement, computeHeatmapCells, get2DViewTransform, HEATMAP_COLS, HEATMAP_ROWS, render2DTopDown } from './render';

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

describe('get2DViewTransform insets', () => {
  const room = { width: 8, height: 8 };

  it('is the classic whole-canvas fit without insets', () => {
    expect(get2DViewTransform(1440, 900, room)).toEqual({ scale: (900 - 120) / 8, offsetX: (1440 - 780) / 2, offsetY: 60 });
    expect(get2DViewTransform(1440, 900, room, 60, undefined)).toEqual(get2DViewTransform(1440, 900, room));
  });

  it('fits and centres the plan in the area the HUD leaves free', () => {
    // iPhone 13: top pills to 62, dock from 466.
    const insets = { top: 62, right: 0, bottom: 664 - 466, left: 0 };
    const t = get2DViewTransform(390, 664, room, 60, insets);
    const top = t.offsetY;
    const bottom = t.offsetY + 8 * t.scale;
    expect(top).toBeGreaterThanOrEqual(62);
    expect(bottom).toBeLessThanOrEqual(466);
    expect((top + bottom) / 2).toBeCloseTo((62 + 466) / 2, 9);
    expect(t.offsetX + 4 * t.scale).toBeCloseTo(195, 9);
    // canvasToWorld inverts it: the free area's centre is the room centre.
    const centre = canvasToWorld(195, (62 + 466) / 2, t, room);
    expect(centre.x).toBeCloseTo(0, 9);
    expect(centre.z).toBeCloseTo(0, 9);
  });

  it('shrinks the margin in a short band so the plan stays usable', () => {
    // iPhone 13 landscape: a 200 px band. A 60 px margin would leave 80 px.
    const t = get2DViewTransform(750, 342, room, 60, { top: 62, right: 0, bottom: 80, left: 0 });
    expect(8 * t.scale).toBeGreaterThan(140);
    expect(t.offsetY).toBeGreaterThanOrEqual(62);
    expect(t.offsetY + 8 * t.scale).toBeLessThanOrEqual(262);
  });

  it('falls back to the whole canvas when the insets leave no room', () => {
    expect(get2DViewTransform(390, 664, room, 60, { top: 400, right: 0, bottom: 400, left: 0 })).toEqual(get2DViewTransform(390, 664, room));
  });
});

describe('get2DViewTransform bounds (#381)', () => {
  const room = { width: 8, height: 8 };
  const roomBounds = { minX: -4, minZ: -4, maxX: 4, maxZ: 4 };

  it('is unchanged, exactly, when the bounds are the room', () => {
    expect(get2DViewTransform(1440, 900, room, 60, undefined, roomBounds)).toEqual(get2DViewTransform(1440, 900, room));
    const insets = { top: 62, right: 0, bottom: 198, left: 0 };
    expect(get2DViewTransform(390, 664, room, 60, insets, roomBounds)).toEqual(get2DViewTransform(390, 664, room, 60, insets));
  });

  it('fits an outdoor item past the walls inside the canvas, and inverts', () => {
    // A tree 3.5 m east of an 8 m house.
    const bounds = { minX: -4, minZ: -4, maxX: 8.2, maxZ: 4 };
    const t = get2DViewTransform(1400, 900, room, 60, undefined, bounds);
    const west = t.offsetX;
    const east = t.offsetX + (8.2 + 4) * t.scale;
    expect(west).toBeGreaterThanOrEqual(60 - 1e-9);
    expect(east).toBeLessThanOrEqual(1400 - 60 + 1e-9);
    // Centred on the content, not the room.
    expect((west + east) / 2).toBeCloseTo(700, 9);
    const tree = canvasToWorld(t.offsetX + (7.5 + 4) * t.scale, t.offsetY + (3 + 4) * t.scale, t, room);
    expect(tree.x).toBeCloseTo(7.5, 9);
    expect(tree.z).toBeCloseTo(3, 9);
  });

  it('fits the bounds in the free area of the insets', () => {
    const bounds = { minX: -4, minZ: -7, maxX: 4, maxZ: 4 };
    const t = get2DViewTransform(1440, 900, room, 24, { top: 61, right: 291, bottom: 227, left: 272 }, bounds);
    expect(t.offsetY + (-7 + 4) * t.scale).toBeGreaterThanOrEqual(61);
    expect(t.offsetY + 8 * t.scale).toBeLessThanOrEqual(900 - 227);
  });
});

describe('zone labels (#433)', () => {
  /** A 2D context that records the text drawn and measures 7 px per character. */
  function recordingCanvas(width: number, height: number): { canvas: HTMLCanvasElement; texts: string[] } {
    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, key) {
        if (key === 'fillText') return (text: string) => texts.push(text);
        if (key === 'measureText') return (text: string) => ({ width: text.length * 7 });
        if (key in target) return target[key];
        return () => undefined;
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
    const canvas = { width, height, clientWidth: width, getContext: () => ctx } as unknown as HTMLCanvasElement;
    return { canvas, texts };
  }

  const zone = (name: string, x: number, z: number, w: number, d: number) => ({ id: name, name, color: '#3b82f6', x, z, w, d });
  const render = (width: number, height: number, padding: number, zones: ReturnType<typeof zone>[]): string[] => {
    const { canvas, texts } = recordingCanvas(width, height);
    const floor = makeFloor({ zones });
    render2DTopDown({
      canvas,
      layout: makeLayout({ floors: [floor] }),
      floor,
      selectedItemId: null,
      showMeasurements: false,
      showWiFiSignals: false,
      hasCollision: () => false,
      padding,
    });
    return texts;
  };
  const twoRooms = [zone('Living Room', -4, -1, 5, 5), zone('Kitchen', 1, -4, 3, 3)];

  it('names the zones on the full-size plan', () => {
    expect(render(1440, 900, 60, twoRooms)).toEqual(expect.arrayContaining(['Living Room', 'Kitchen']));
  });

  it('leaves the names off the minimap, where a 12 px label covered the map', () => {
    const texts = render(180, 130, 6, twoRooms);
    expect(texts).not.toContain('Living Room');
    expect(texts).not.toContain('Kitchen');
  });

  it('leaves off a name wider than its zone', () => {
    expect(render(1440, 900, 60, [zone('A very long zone name indeed', -4, -4, 1, 3)])).not.toContain('A very long zone name indeed');
  });
});
