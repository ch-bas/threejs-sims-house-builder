import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { blueprintPlan } from '../blueprint';
import { planViewBounds } from '../plan-view-fit';
import { layoutToDxf } from './dxf';
import { planContentBounds } from './plan-geometry';
import { buildingToSvg, layoutToSvg } from './svg';
import type { GroundPatch } from '../types';

const patio: GroundPatch = { id: 'g1', kind: 'paving', x: 4, z: -2, w: 3, d: 3 };
const upstairs = makeFloor({ id: 'upper', name: 'Upper' });
const house = makeLayout({ width: 8, height: 6, floors: [makeFloor(), upstairs], grounds: [patio] });

describe('garden surfaces on the sheets (#924)', () => {
  it('widen the ground floor’s content, not the floor above’s', () => {
    expect(planContentBounds(house, house.floors[0]!).maxX).toBe(7);
    expect(planContentBounds(house, upstairs).maxX).toBe(4);
  });

  it('widen the on-screen fit only up to its cap', () => {
    const far = makeLayout({ width: 4, height: 4, grounds: [{ ...patio, x: 2, z: -2, w: 6, d: 2 }] });
    expect(planContentBounds(far, far.floors[0]!).maxX).toBe(8);
    expect(planViewBounds(far, far.floors[0]!).maxX).toBe(4);
  });

  it('are drawn in the SVG under the furniture, on the ground floor only', () => {
    const svg = layoutToSvg(house, house.floors[0]!);
    expect(svg).toContain('class="ground"');
    expect(svg).toContain('>Paving<');
    expect(svg.indexOf('class="grounds"')).toBeLessThan(svg.lastIndexOf('</g>'));
    expect(layoutToSvg(house, upstairs)).not.toContain('class="ground"');
    // Each sheet of the whole building has its own clip.
    const building = buildingToSvg(house);
    expect(building.match(/<clipPath id="f0-grounds"/g)).toHaveLength(1);
    expect(building).not.toContain('f1-grounds');
  });

  it('are drawn in the DXF on their own layer', () => {
    const dxf = layoutToDxf(house, house.floors[0]!);
    expect(dxf).toMatch(/LWPOLYLINE\n5\n[0-9A-F]+\n330\n[0-9A-F]+\n100\nAcDbEntity\n8\nGROUNDS\n/);
    expect(dxf).toContain('Paving');
    expect(layoutToDxf(house, upstairs)).not.toMatch(/AcDbEntity\n8\nGROUNDS\n/);
  });

  it('never cost the blueprint its garden furniture', () => {
    const chair = makeItem({ id: 'chair', category: 'outdoor', width: 0.6, depth: 0.6, position: { x: 0, z: 3.5 } });
    const small = makeLayout({ width: 5, height: 5, floors: [makeFloor({ items: [chair] })], grounds: [{ id: 'p', kind: 'paving', x: -2.5, z: 2.5, w: 5, d: 6 }] });
    expect(blueprintPlan(small, small.floors[0]!).omitted).toEqual([]);
  });

  it('leave a house without them exactly as it was', () => {
    const plain = makeLayout({ width: 8, height: 6 });
    expect(layoutToSvg(plain, plain.floors[0]!)).not.toContain('grounds');
  });
});
