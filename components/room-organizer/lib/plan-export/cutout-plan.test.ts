import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { floorArea } from '../blueprint';
import { layoutToDxf } from './dxf';
import { wallOpeningDimensions } from './plan-geometry';
import { layoutToSvg } from './svg';
import type { FootprintCutout, RoomLayout } from '../types';

const cutout: FootprintCutout = { corner: 'ne', width: 4, depth: 3 };
const house = (extra: Partial<RoomLayout> = {}): RoomLayout => makeLayout({ width: 10, height: 8, cutout, ...extra });

/** The vertices of the closed polyline on WALLS, as [x, y] in CAD metres. */
function wallVertices(dxf: string): Array<[number, number]> {
  const lines = dxf.split(/\r?\n/).map((line) => line.trim());
  const points: Array<[number, number]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i] !== '0' || lines[i + 1] !== 'LWPOLYLINE') continue;
    let j = i + 2;
    let layer = '';
    const found: Array<[number, number]> = [];
    while (lines[j] !== '0') {
      if (lines[j] === '8') layer = lines[j + 1]!;
      if (lines[j] === '10') found.push([Number(lines[j + 1]), Number(lines[j + 3])]);
      j += 2;
    }
    if (layer === 'WALLS') points.push(...found);
  }
  return points;
}

describe('the L on the exported plan (#727)', () => {
  it('walks the six corners in the DXF', () => {
    const floor = makeFloor();
    const vertices = wallVertices(layoutToDxf(house({ floors: [floor] }), floor));
    expect(vertices).toHaveLength(6);
    // Inner corner of the L: two thirds across, down the depth of the cut.
    const xs = vertices.map(([x]) => x);
    const ys = vertices.map(([, y]) => y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(8);
    expect(vertices.filter(([x]) => Math.abs(x - (Math.min(...xs) + 6)) < 1e-6)).toHaveLength(2);
  });

  it('keeps the recess in the DXF outline of an L, and the rectangle at four corners', () => {
    const floor = makeFloor();
    const plain = makeLayout({ width: 10, height: 8, floors: [floor] });
    expect(wallVertices(layoutToDxf(plain, floor))).toHaveLength(4);
    const porch = house({ entrance: { width: 1.4, depth: 1.2, offset: -3 }, floors: [floor] });
    expect(wallVertices(layoutToDxf(porch, floor))).toHaveLength(10);
  });

  it('draws six walls and paints the corner out of the SVG', () => {
    const floor = makeFloor();
    const svg = layoutToSvg(house({ floors: [floor] }), floor);
    expect(svg.match(/class="wall"/g)).toHaveLength(6);
    expect(svg).toContain('class="cutout"');
    expect(layoutToSvg(makeLayout({ width: 10, height: 8, floors: [floor] }), floor)).not.toContain('class="cutout"');
  });

  it('paints past the old outline on its two outer sides only (review L9)', () => {
    const floor = makeFloor();
    const svg = layoutToSvg(house({ floors: [floor] }), floor);
    const rect = /class="cutout" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg)!;
    const [x, y, width, height] = rect.slice(1).map(Number) as [number, number, number, number];
    const scale = (width - 3) / 4;
    expect((height - 3) / 3).toBeCloseTo(scale);
    // East side of the sheet's room past the rectangle by 3 px; the west side on the wall.
    const wallX = /class="wall" x1="([\d.]+)" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+"/.exec(svg)!;
    expect(x).toBeCloseTo(Number(wallX[1]) + 6 * scale);
    expect(x + width).toBeCloseTo(Number(wallX[1]) + 10 * scale + 3);
    expect(y + height).toBeGreaterThan(y + 3 * scale);
  });

  it('dashes a hidden side on both of its walls', () => {
    const floor = makeFloor({ hiddenWalls: ['north'] });
    const svg = layoutToSvg(house({ floors: [floor] }), floor);
    expect(svg.match(/stroke-dasharray="6 4"\/>/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('chains openings along the shortened wall and each new wall', () => {
    const floor = makeFloor({
      items: [
        makeItem({ id: 'n', type: 'door', width: 1, position: { x: -2, z: -4 }, rotation: 0 }),
        makeItem({ id: 'x', type: 'window', width: 1, position: { x: 3, z: -1 }, rotation: 0 }),
        makeItem({ id: 'z', type: 'window', width: 1, position: { x: 1, z: -2 }, rotation: -Math.PI / 2 }),
      ],
    });
    const chains = wallOpeningDimensions(house({ floors: [floor] }), floor);
    expect(chains.map((chain) => chain.wall)).toEqual(['north', 'north', 'east']);
    const [main, notchX, notchZ] = chains;
    expect(main!.segments.at(-1)!.to).toEqual({ x: 1, z: -4 });
    expect(notchX!.segments[0]!.from).toEqual({ x: 1, z: -1 });
    expect(notchX!.segments.at(-1)!.to).toEqual({ x: 5, z: -1 });
    expect(notchZ!.segments[0]!.from).toEqual({ x: 1, z: -4 });
    expect(notchZ!.segments.at(-1)!.to).toEqual({ x: 1, z: -1 });
  });

  it('takes the corner off the floor area', () => {
    expect(floorArea(house(), 0)).toBe(68);
    expect(floorArea(makeLayout({ width: 10, height: 8 }), 0)).toBe(80);
  });
});
