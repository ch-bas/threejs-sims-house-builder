import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { layoutToSvg, planSheetSize } from './svg';

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

  it('notches the north wall for the recessed entrance and paints the porch as outside (#285)', () => {
    const { floor } = makeFixture();
    const layout = makeLayout({ floors: [floor], entrance: { width: 1.4, depth: 1.2, offset: 1 } });
    const svg = layoutToSvg(layout, floor);
    // Recess x ∈ [0.3, 1.7], z ∈ [−4, −2.8] in an 8×8 room → px (275..345, 60..120).
    expect(svg).toContain('<rect class="entrance" x="275" y="60" width="70" height="60" fill="#ffffff"/>');
    // The north edge is two stubs plus two cheeks; the other three walls are whole.
    expect(count(svg, 'class="wall"')).toBe(7);
    expect(svg).toContain('x1="60" y1="60" x2="275" y2="60"');
    expect(svg).toContain('x1="275" y1="60" x2="275" y2="120"');
    expect(svg).toContain('x1="345" y1="60" x2="345" y2="120"');
    expect(svg).toContain('x1="345" y1="60" x2="460" y2="60"');
    expect(svg).not.toContain('x1="60" y1="60" x2="460" y2="60"');
    // Painted over the grid and zones, under the walls.
    expect(svg.indexOf('class="entrance"')).toBeGreaterThan(svg.indexOf('class="grid"'));
    expect(svg.indexOf('class="entrance"')).toBeLessThan(svg.indexOf('class="wall"'));
    // A storey the porch doesn't reach keeps its whole north wall.
    const upper = { ...floor, id: 'upper' };
    const two = makeLayout({ floors: [floor, upper], entrance: { width: 1.4, depth: 1.2 } });
    expect(layoutToSvg(two, upper)).not.toContain('class="entrance"');
    expect(count(layoutToSvg(two, upper), 'class="wall"')).toBe(4);
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

  it('keeps the room at the same sheet position when nothing sits outside the walls (#287)', () => {
    const { layout, floor } = makeFixture();
    const svg = layoutToSvg(layout, floor);
    expect(svg).toContain('<g class="plan" transform="translate(0 0)">');
    expect(planSheetSize(layout, floor)).toEqual({ widthPx: 520, heightPx: 520, widthM: 10.4, heightM: 10.4 });
  });

  it('grows the sheet to enclose outdoor items and keeps the scale bar clear of them (#287)', () => {
    // Oak tree 2 m south of the 8 m room's south wall: footprint z 6.0–7.4.
    const tree = makeItem({ id: 'tree', type: 'tree', name: 'Oak Tree', width: 1.4, depth: 1.4, position: { x: 0, z: 6.7 } });
    const floor = makeFloor({ items: [makeItem(), tree] });
    const layout = makeLayout({ floors: [floor] });
    const svg = layoutToSvg(layout, floor);
    // Content z −4 … 7.4 plus 1.2 m margins = 13.8 m → 690 px tall, width unchanged.
    expect(svg).toContain('viewBox="0 0 520 690"');
    expect(planSheetSize(layout, floor)).toEqual({ widthPx: 520, heightPx: 690, widthM: 10.4, heightM: 13.8 });
    // The room did not move (the sheet only grew southwards) …
    expect(svg).toContain('<g class="plan" transform="translate(0 0)">');
    // … the tree is drawn where it stands, fully inside the sheet …
    expect(svg).toContain('translate(260 595) rotate(0)');
    expect(svg).toContain('>Oak Tree</text>');
    // … and the scale bar sits in the bottom margin band below the tree's
    // lowest edge (7.4 m → 630 px), no longer overprinted.
    expect(svg).toContain('y1="664" x2="160" y2="664"');
  });

  it('translates the room when items extend past the north or west walls (#287)', () => {
    // Pool 2 m off the west wall and a tree past the north wall.
    const pool = makeItem({ id: 'pool', type: 'pool', name: 'Pool', width: 4, depth: 2.5, position: { x: -8, z: 0 } });
    const tree = makeItem({ id: 'tree', type: 'tree', name: 'Oak Tree', width: 1.4, depth: 1.4, position: { x: 0, z: -6.7 } });
    const floor = makeFloor({ items: [pool, tree] });
    const layout = makeLayout({ floors: [floor] });
    const svg = layoutToSvg(layout, floor);
    // Content x −10 … 4 (14 m), z −7.4 … 4 (11.4 m) plus margins.
    expect(svg).toContain('viewBox="0 0 820 690"');
    // Room top-left moves from (60, 60) to ((−4 + 11.2) × 50, (−4 + 8.6) × 50) = (360, 230).
    expect(svg).toContain('<g class="plan" transform="translate(300 170)">');
    // Title and dims hug the content corners in the top margin band.
    expect(svg).toContain('class="plan-title" x="60" y="38"');
    expect(svg).toContain('class="plan-dims" x="760" y="38"');
  });

  it('draws room zones as tinted rects with name and area, under the walls (#155)', () => {
    const floor = makeFloor({
      zones: [{ id: 'z1', name: 'Bed & Bath', color: '#3b82f6', x: -4, z: -4, w: 3, d: 2 }],
    });
    const svg = layoutToSvg(makeLayout({ floors: [floor] }), floor);
    // Corner (−4, −4) in an 8×8 room at 50 px/m + 60 px margin → (60, 60), 150×100 px.
    expect(svg).toContain(
      '<rect x="60" y="60" width="150" height="100" fill="#3b82f6" fill-opacity="0.18" stroke="#3b82f6"'
    );
    expect(svg).toContain('Bed &amp; Bath</text>');
    expect(svg).toContain('>6.0 m²</text>');
    expect(svg.indexOf('class="zone"')).toBeLessThan(svg.indexOf('class="wall"'));
  });

  it('draws stairs as treads with an up-arrow, and the stairwell on the floor above (#290)', () => {
    const stairs = makeItem({ id: 'st', type: 'stairs', name: 'Stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 0, z: 0 } });
    const winder = makeItem({ id: 'w', type: 'stairs', name: 'Winder', width: 2, depth: 2.6, height: 3, stairsShape: 'winder', position: { x: 2, z: 2 } });
    const ground = makeFloor({ id: 'g', items: [stairs, winder] });
    const first = makeFloor({ id: 'f', name: 'First Floor' });
    const layout = makeLayout({ floors: [ground, first] });

    const groundSvg = layoutToSvg(layout, ground);
    expect(count(groundSvg, 'class="furniture"')).toBe(2);
    expect(count(groundSvg, 'class="stairs"')).toBe(2);
    expect(count(groundSvg, 'class="arrow"')).toBe(2);
    // No name label: the symbol says what it is.
    expect(groundSvg).not.toContain('>Stairs</text>');
    // The straight flight's arrow runs down the plan from its first tread to its last.
    const arrow = /class="arrow" d="M 260 ([\d.]+) L [^"]*L 260 ([\d.]+) M/.exec(groundSvg);
    expect(arrow).not.toBeNull();
    expect(Number(arrow![1])).toBeLessThan(260);
    expect(Number(arrow![2])).toBeGreaterThan(260);
    // Nothing is cut through the ground floor.
    expect(groundSvg).not.toContain('class="stairwell"');
    // A mirrored winder is a different drawing.
    const mirrored = layoutToSvg(layout, makeFloor({ id: 'g', items: [{ ...winder, mirrored: true }] }));
    const plain = layoutToSvg(layout, makeFloor({ id: 'g', items: [winder] }));
    expect(mirrored).not.toBe(plain);

    const firstSvg = layoutToSvg(layout, first);
    expect(count(firstSvg, 'class="stairwell"')).toBe(2);
    expect(count(firstSvg, 'stroke-dasharray="6 4"')).toBe(2);
    // Under the furniture and openings, over the walls.
    expect(firstSvg.indexOf('class="stairwell"')).toBeGreaterThan(firstSvg.indexOf('class="wall"'));
    expect(firstSvg).not.toContain('NaN');
  });
});
