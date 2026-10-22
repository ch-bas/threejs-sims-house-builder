import { describe, expect, it } from 'vitest';
import { makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  bestPlanRegion,
  boundsSize,
  classicPlanRect,
  desktopPlanInsets,
  PLAN_FIT_TOLERANCE_M,
  PLAN_INSET_PADDING_PX,
  PLAN_PADDING_PX,
  planViewBounds,
  regionFitScale,
} from './plan-view-fit';
import type { Rect } from './scene-insets';

const room = (items = [makeItem({ position: { x: 0, z: 0 } })]) => {
  const layout = makeLayout({ width: 8, height: 6 });
  const floor = { ...layout.floors[0]!, items };
  return { layout: { ...layout, floors: [floor] }, floor };
};

describe('planViewBounds (#381)', () => {
  it('is the room when every item is inside the walls', () => {
    const { layout, floor } = room();
    expect(planViewBounds(layout, floor)).toEqual({ minX: -4, minZ: -3, maxX: 4, maxZ: 3 });
  });

  it('grows to an outdoor item past the walls', () => {
    const tree = makeItem({ width: 1.4, depth: 1.4, position: { x: 7.5, z: -4 } });
    const { layout, floor } = room([tree]);
    const bounds = planViewBounds(layout, floor);
    expect(bounds.maxX).toBeCloseTo(8.2);
    expect(bounds.minZ).toBeCloseTo(-4.7);
    expect(bounds.minX).toBe(-4);
    expect(bounds.maxZ).toBe(3);
  });

  it('ignores an overhang under the tolerance, so a flush sofa keeps the room fit', () => {
    const flush = makeItem({ width: 2, depth: 1, position: { x: 0, z: 3 - 0.5 + PLAN_FIT_TOLERANCE_M / 2 } });
    const { layout, floor } = room([flush]);
    expect(planViewBounds(layout, floor)).toEqual({ minX: -4, minZ: -3, maxX: 4, maxZ: 3 });
  });

  it('measures the fit extent', () => {
    expect(boundsSize({ minX: -4, minZ: -5, maxX: 6, maxZ: 3 })).toEqual({ width: 10, height: 8 });
  });
});

describe('regionFitScale', () => {
  it('shrinks the padding to a share of a short region', () => {
    // 100 px tall: padding min(60, 12) = 12 → (100 - 24) / 8.
    expect(regionFitScale(1000, 100, { width: 8, height: 8 }, 60)).toBeCloseTo(76 / 8);
  });
});

describe('bestPlanRegion', () => {
  // A 1440 × 900 desktop: badge and pills in the top corners, the bottom HUD.
  const canvas: Rect = { left: 0, top: 0, right: 1440, bottom: 900 };
  const hud: Rect[] = [
    { left: 16, top: 16, right: 272, bottom: 70 },
    { left: 413, top: 16, right: 1122, bottom: 61 },
    { left: 1149, top: 16, right: 1424, bottom: 132 },
    { left: 16, top: 760, right: 248, bottom: 884 },
    { left: 444, top: 673, right: 984, bottom: 884 },
    { left: 1176, top: 634, right: 1424, bottom: 884 },
  ];
  const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  it('picks a free region that draws a square house biggest, not the largest-area band', () => {
    const region = bestPlanRegion(canvas, hud, { width: 8, height: 8 }, PLAN_INSET_PADDING_PX)!;
    expect(hud.some((panel) => overlaps(panel, region))).toBe(false);
    // The full-width band above the bottom HUD is only 132..634 tall.
    expect(region.bottom - region.top).toBeGreaterThan(600);
  });

  it('is null when the panels leave nothing usable', () => {
    expect(bestPlanRegion(canvas, [canvas], { width: 8, height: 8 }, PLAN_INSET_PADDING_PX)).toBeNull();
  });
});

describe('desktopPlanInsets', () => {
  const canvas: Rect = { left: 0, top: 0, right: 1440, bottom: 900 };

  it('keeps the classic fit (undefined) while no panel covers the classic plan', () => {
    const classic = classicPlanRect(1440, 900, { width: 8, height: 8 }, PLAN_PADDING_PX);
    const beside: Rect = { left: 16, top: 16, right: classic.left - 1, bottom: 70 };
    expect(desktopPlanInsets(canvas, [beside], { width: 8, height: 8 })).toBeUndefined();
  });

  it('fits the plan above a bottom panel that would cover it', () => {
    const strip: Rect = { left: 444, top: 673, right: 984, bottom: 884 };
    const insets = desktopPlanInsets(canvas, [strip], { width: 8, height: 8 })!;
    expect(insets).toBeDefined();
    // The region the insets leave free clears the strip.
    const free = { left: insets.left, top: insets.top, right: 1440 - insets.right, bottom: 900 - insets.bottom };
    expect(free.bottom <= strip.top || free.right <= strip.left || free.left >= strip.right).toBe(true);
  });
});
