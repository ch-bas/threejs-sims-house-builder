import { describe, expect, it } from 'vitest';
import { makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  bestPlanRegion,
  boundsSize,
  classicPlanRect,
  desktopPlanInsets,
  hitOffPlanMarker,
  OFF_PLAN_MARKER_INSET_PX,
  offPlanMarkers,
  PLAN_FIT_TOLERANCE_M,
  PLAN_INSET_PADDING_PX,
  PLAN_PADDING_PX,
  PLAN_PANEL_GAP_PX,
  planViewBounds,
  planViewFit,
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
    // The free area reaches under the strip by the margin less the gap, no more.
    const bottom = 900 - insets.bottom;
    expect(bottom).toBeCloseTo(strip.top + PLAN_INSET_PADDING_PX - PLAN_PANEL_GAP_PX, 6);
  });
});

describe('planViewFit: far items (#381 review)', () => {
  it('leaves a far tree out of the fit, keeps a near one, and lists the far one', () => {
    const near = makeItem({ id: 'near', width: 1.4, depth: 1.4, position: { x: 7.5, z: 2 } });
    const far = makeItem({ id: 'far', width: 1.4, depth: 1.4, position: { x: 40, z: 2 } });
    const { layout, floor } = room([near, far]);
    const fit = planViewFit(layout, floor);
    expect(fit.bounds.maxX).toBeCloseTo(8.2);
    expect(fit.offPlan.map(({ item }) => item.id)).toEqual(['far']);
    expect(fit.offPlan[0]!.distance).toBeCloseTo(36);
  });

  it('keeps the house at least half its room-only size on any canvas', () => {
    const items = [
      makeItem({ id: 'a', position: { x: 9, z: 0 } }),
      makeItem({ id: 'b', position: { x: -9, z: 0 } }),
      makeItem({ id: 'c', position: { x: 0, z: 30 } }),
    ];
    const { layout, floor } = room(items);
    const { bounds, offPlan } = planViewFit(layout, floor);
    expect(bounds.maxX - bounds.minX).toBeLessThanOrEqual(8 / 0.5);
    expect(bounds.maxZ - bounds.minZ).toBeLessThanOrEqual(6 / 0.5);
    // The furthest goes first; the two at 5 m out still overflow 16 m together.
    expect(offPlan.map(({ item }) => item.id)[0]).toBe('c');
  });

  it('places a marker just inside the content edge, towards the item, and hits it', () => {
    const far = makeItem({ id: 'far', position: { x: 40, z: 0 } }) as ReturnType<typeof makeItem> & { position: { x: number; z: number } };
    const bounds = { minX: -4, minZ: -4, maxX: 4, maxZ: 4 };
    const t = { scale: 50, offsetX: 100, offsetY: 100 };
    const [marker] = offPlanMarkers(t, { width: 8, height: 8 }, bounds, [{ item: far, distance: 36 }]);
    // The right edge is at 100 + 8 * 50 = 500; the centre row at 300.
    expect(marker!.x).toBeCloseTo(500 - OFF_PLAN_MARKER_INSET_PX);
    expect(marker!.y).toBeCloseTo(300);
    expect(marker!.angle).toBeCloseTo(0);
    expect(hitOffPlanMarker([marker!], marker!.x + 5, marker!.y)).toBe(marker);
    expect(hitOffPlanMarker([marker!], marker!.x + 30, marker!.y)).toBeNull();
  });
});

describe('bestPlanRegion: the middle wins a near tie (#381 review)', () => {
  it('picks the central band over a side column a hair bigger', () => {
    // 1280 x 720: a left column 0..364 wide and tall, beside a central band
    // 272..989 above a strip at 493.
    const canvas: Rect = { left: 0, top: 0, right: 1280, bottom: 720 };
    const hud: Rect[] = [
      { left: 16, top: 16, right: 272, bottom: 70 },
      { left: 989, top: 16, right: 1264, bottom: 132 },
      { left: 364, top: 493, right: 904, bottom: 704 },
      { left: 1016, top: 454, right: 1264, bottom: 704 },
      { left: 16, top: 580, right: 248, bottom: 704 },
    ];
    const region = bestPlanRegion(canvas, hud, { width: 4, height: 8 }, PLAN_INSET_PADDING_PX)!;
    const centre = (region.left + region.right) / 2;
    expect(Math.abs(centre - 640)).toBeLessThan(200);
  });
});
