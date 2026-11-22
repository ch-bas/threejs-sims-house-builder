import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { blueprintPlan } from '../blueprint';
import { buildingToDxf, layoutToDxf } from './dxf';
import { planContentBounds, pinnedDimensionLines } from './plan-geometry';
import { printedFloor, resolvePrint } from './print-scale';
import { buildingToSvg, layoutToSvg, planSheetSize } from './svg';
import type { PinnedDimension } from '../types';

const level: PinnedDimension = { id: 'level', a: { x: -2, z: 1 }, b: { x: 1, z: 1 } };
const upright: PinnedDimension = { id: 'upright', a: { x: 3, z: 2 }, b: { x: 3, z: -1 } };
const offset: PinnedDimension = { id: 'off', a: { x: 0, z: 0 }, b: { x: 2, z: 0 }, offset: 0.5 };

describe('pinnedDimensionLines (#921)', () => {
  it('labels each pin in the unit asked for', () => {
    const lines = pinnedDimensionLines(makeFloor({ dimensions: [level] }), 'metric');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: 'level', lengthM: 3, label: '3.00 m', from: level.a, to: level.b });
    expect(pinnedDimensionLines(makeFloor({ dimensions: [level] }), 'imperial')[0]!.label).toContain('\'');
  });

  it('puts the label above a level line and left of an upright one, whichever way it was measured', () => {
    const reversed = { ...level, a: level.b, b: level.a };
    for (const dim of [level, reversed]) expect(pinnedDimensionLines(makeFloor({ dimensions: [dim] }))[0]!.normal).toEqual({ x: 0, z: -1 });
    expect(pinnedDimensionLines(makeFloor({ dimensions: [upright] }))[0]!.normal).toEqual({ x: -1, z: 0 });
  });

  it('moves the line off its points by the offset, along a→b’s left-hand normal, the label with it', () => {
    const [line] = pinnedDimensionLines(makeFloor({ dimensions: [offset] }));
    expect(line).toMatchObject({ a: { x: 0, z: 0 }, from: { x: 0, z: 0.5 }, to: { x: 2, z: 0.5 }, normal: { x: 0, z: 1 } });
  });

  it('is empty for a floor with none', () => {
    expect(pinnedDimensionLines(makeFloor())).toEqual([]);
  });
});

describe('pinned dimensions in the exports (#921)', () => {
  const layout = makeLayout({ width: 8, height: 6 });
  const floor = makeFloor({ dimensions: [level, offset] });

  it('the SVG draws each as a dimension string, with extension lines for an offset one', () => {
    const svg = layoutToSvg(layout, floor, { unit: 'metric' });
    expect(svg.split('class="pinned-dimension"').length - 1).toBe(2);
    expect(svg).toContain('>3.00 m<');
    expect(svg).toContain('>2.00 m<');
    expect(layoutToSvg(layout, floor, { dimensions: false })).not.toContain('pinned-dimension');
  });

  it('the DXF writes them on DIMENSIONS, in metres', () => {
    const dxf = layoutToDxf(layout, floor);
    expect(dxf).toContain('\n3.00 m\n');
    expect(dxf).toContain('\n2.00 m\n');
  });

  it('a house without pins exports as before', () => {
    const plain = makeFloor();
    expect(layoutToSvg(layout, { ...plain, dimensions: [] })).toBe(layoutToSvg(layout, plain));
    expect(layoutToDxf(layout, { ...plain, dimensions: [] })).toBe(layoutToDxf(layout, plain));
  });

  it('the sheet keeps a pin out in the garden, its label included', () => {
    const garden: PinnedDimension = { id: 'g', a: { x: 4, z: 0 }, b: { x: 9, z: 0 } };
    expect(planContentBounds(layout, makeFloor({ dimensions: [garden] })).maxX).toBeGreaterThanOrEqual(9);
    expect(planContentBounds(layout, makeFloor()).maxX).toBe(4);
    // A pin along the north wall: its label, above the line, reaches past the wall.
    const north: PinnedDimension = { id: 'n', a: { x: -4, z: -3 }, b: { x: 4, z: -3 } };
    expect(planContentBounds(layout, makeFloor({ dimensions: [north] })).minZ).toBeLessThan(-3.2);
  });
});

describe('far pins on the blueprint and the print (#921)', () => {
  const layout = makeLayout({ width: 8, height: 6 });
  const far: PinnedDimension = { id: 'far', a: { x: 3, z: 0 }, b: { x: 60, z: 0 } };
  const tree = makeItem({ id: 'tree', category: 'outdoor', type: 'tree', position: { x: 6, z: 0 } });

  it('the blueprint leaves a far pin off, as it leaves a far item off, and keeps the near garden', () => {
    const plan = blueprintPlan(layout, makeFloor({ items: [tree], dimensions: [far, level] }));
    expect(plan.floor.dimensions).toEqual([level]);
    expect(plan.floor.items).toEqual([tree]);
    expect(plan.omitted).toEqual([]);
  });

  it('the print without the garden leaves pins out to it off, and frames the house', () => {
    const floor = makeFloor({ dimensions: [far, level] });
    expect(printedFloor(layout, floor, false).dimensions).toEqual([level]);
    expect(printedFloor(layout, floor, true)).toBe(floor);
    expect(resolvePrint(layout, floor, { includeOutdoor: false }).frame.maxX).toBeLessThan(10);
    expect('dimensions' in printedFloor(layout, makeFloor({ dimensions: [far] }), false)).toBe(false);
  });

  it('an export with its dimensions off neither draws pins nor frames the sheet for them', () => {
    const floor = makeFloor({ dimensions: [far] });
    const building = makeLayout({ width: 8, height: 6, floors: [floor] });
    expect(planSheetSize(layout, floor, { dimensions: false })).toEqual(planSheetSize(layout, makeFloor(), { dimensions: false }));
    expect(layoutToSvg(layout, floor, { dimensions: false })).toBe(layoutToSvg(layout, makeFloor(), { dimensions: false }));
    expect(buildingToSvg(building, { dimensions: false })).toBe(buildingToSvg({ ...building, floors: [makeFloor()] }, { dimensions: false }));
    expect(layoutToDxf(layout, floor, { dimensions: false })).toBe(layoutToDxf(layout, makeFloor(), { dimensions: false }));
    expect(buildingToDxf(building, { dimensions: false })).toBe(buildingToDxf({ ...building, floors: [makeFloor()] }, { dimensions: false }));
  });
});
