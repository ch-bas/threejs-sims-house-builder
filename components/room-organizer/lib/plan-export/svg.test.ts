import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { layoutToSvg } from './svg';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** An 8×8 m fixture exercising every plan feature: furniture (one rotated),
 * a door, a window, an interior wall, and a hidden exterior wall. */
function makeFixture() {
  const floor = makeFloor({
    items: [
      makeItem({ id: 'chair-1', name: 'Chair', position: { x: 1, z: 1 }, rotation: Math.PI / 4 }),
      makeItem({ id: 'sofa-1', type: 'sofa', name: 'Sofa', icon: '🛋', width: 2, depth: 0.9, position: { x: -2, z: 0 } }),
      makeItem({ id: 'door-1', type: 'door', name: 'Door', icon: '🚪', width: 0.9, depth: 0.1, position: { x: 0, z: -4 }, rotation: 0 }),
      makeItem({ id: 'win-1', type: 'window', name: 'Window', icon: '🪟', width: 0.9, depth: 0.1, position: { x: 4, z: 0 }, rotation: -Math.PI / 2 }),
    ],
    interiorWalls: [{ id: 'iw-1', x1: -2, z1: -4, x2: -2, z2: 0 }],
    hiddenWalls: ['south'],
  });
  return { layout: makeLayout({ floors: [floor] }), floor };
}

describe('layoutToSvg', () => {
  it('is a well-formed standalone SVG with viewBox and xmlns', () => {
    const { layout, floor } = makeFixture();
    const svg = layoutToSvg(layout, floor);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    // 8 m × 50 px/m + 2 × 60 px margin.
    expect(svg).toContain('viewBox="0 0 520 520"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).not.toContain('NaN');
  });

  it('emits one footprint rect per non-opening item, with rotation transforms', () => {
    const { layout, floor } = makeFixture();
    const svg = layoutToSvg(layout, floor);
    expect(count(svg, 'class="furniture"')).toBe(2);
    // Chair at (1, 1), rotation π/4 → canvas-convention −45° about its centre.
    expect(svg).toContain('translate(310 310) rotate(-45)');
    // Name labels ride inside the rotated group.
    expect(svg).toContain('>Chair</text>');
    expect(svg).toContain('>Sofa</text>');
  });

  it('marks doors and windows on the walls instead of drawing footprints', () => {
    const { layout, floor } = makeFixture();
    const svg = layoutToSvg(layout, floor);
    expect(count(svg, 'class="opening"')).toBe(2);
    expect(svg).toContain('data-type="door"');
    expect(svg).toContain('data-type="window"');
    // Door swing: quarter arc with radius = width (0.9 m × 50 px/m).
    expect(svg).toContain('A 45 45 0 0 1');
  });

  it('draws the grid, the room outline (hidden walls dashed), and interior walls', () => {
    const { layout, floor } = makeFixture();
    const svg = layoutToSvg(layout, floor);
    const grid = /class="grid" d="([^"]+)"/.exec(svg);
    expect(grid).not.toBeNull();
    // Centre-anchored 0.5 m grid on 8 m: 17 vertical + 17 horizontal lines.
    expect(count(grid![1]!, 'M ')).toBe(34);
    expect(count(svg, 'class="wall"')).toBe(4);
    // Only the hidden south wall is dashed.
    expect(count(svg, 'stroke-dasharray="6 4"')).toBe(1);
    expect(count(svg, 'class="interior-wall"')).toBe(1);
  });

  it('includes the floor name and a scale bar', () => {
    const { layout, floor } = makeFixture();
    const svg = layoutToSvg(layout, floor);
    expect(svg).toContain('My Home — Ground Floor');
    expect(svg).toContain('class="scale-bar"');
    expect(svg).toContain('>2 m</text>');
  });

  it('is deterministic for the same layout', () => {
    const { layout, floor } = makeFixture();
    expect(layoutToSvg(layout, floor)).toBe(layoutToSvg(layout, floor));
  });

  it('honours theme and scale options', () => {
    const { layout, floor } = makeFixture();
    const svg = layoutToSvg(layout, floor, { pxPerMetre: 100, margin: 50, theme: { wall: '#123456' } });
    expect(svg).toContain('viewBox="0 0 900 900"');
    expect(svg).toContain('#123456');
  });

  it('escapes markup in user-supplied names', () => {
    const floor = makeFloor({
      items: [makeItem({ name: '<b>&"evil"</b>', position: { x: 0, z: 0 } })],
    });
    const layout = makeLayout({ name: 'A & B', floors: [floor] });
    const svg = layoutToSvg(layout, floor);
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;&amp;&quot;evil&quot;&lt;/b&gt;');
    expect(svg).toContain('A &amp; B');
  });

  it('skips the in-rect label when the footprint is too small to carry it', () => {
    const floor = makeFloor({
      items: [makeItem({ name: 'Tiny Camera', width: 0.3, depth: 0.3, position: { x: 0, z: 0 } })],
    });
    const svg = layoutToSvg(makeLayout({ floors: [floor] }), floor);
    expect(count(svg, 'class="furniture"')).toBe(1);
    expect(svg).not.toContain('Tiny Camera</text>');
  });
});
