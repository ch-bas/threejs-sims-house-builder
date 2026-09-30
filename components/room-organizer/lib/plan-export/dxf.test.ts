import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { DXF_LAYERS, layoutToDxf } from './dxf';
import { layoutToSvg } from './svg';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Same shape as the SVG fixture: 8×8 m, two furniture items (one rotated),
 * a door, a window, and one interior wall. */
function makeFixture() {
  const floor = makeFloor({
    items: [
      makeItem({ id: 'chair-1', name: 'Chair', position: { x: 1, z: 1 }, rotation: Math.PI / 4 }),
      makeItem({ id: 'sofa-1', type: 'sofa', name: 'Sofa', icon: '🛋', width: 2, depth: 0.9, position: { x: -2, z: 0 } }),
      makeItem({ id: 'door-1', type: 'door', name: 'Door', icon: '🚪', width: 0.9, depth: 0.1, position: { x: 0, z: -4 }, rotation: 0 }),
      makeItem({ id: 'win-1', type: 'window', name: 'Window', icon: '🪟', width: 0.9, depth: 0.1, position: { x: 4, z: 0 }, rotation: -Math.PI / 2 }),
    ],
    interiorWalls: [{ id: 'iw-1', x1: -2, z1: -4, x2: -2, z2: 0 }],
  });
  return { layout: makeLayout({ floors: [floor] }), floor };
}

describe('layoutToDxf', () => {
  it('orders SECTIONs HEADER → TABLES → ENTITIES and ends with EOF', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    const header = dxf.indexOf('2\nHEADER');
    const tables = dxf.indexOf('2\nTABLES');
    const entities = dxf.indexOf('2\nENTITIES');
    expect(header).toBeGreaterThan(-1);
    expect(tables).toBeGreaterThan(header);
    expect(entities).toBeGreaterThan(tables);
    expect(count(dxf, '0\nSECTION')).toBe(3);
    expect(count(dxf, '0\nENDSEC')).toBe(3);
    expect(dxf.endsWith('0\nEOF')).toBe(true);
    // Minimal header: DXF 2000 (LWPOLYLINE's version) with metric units.
    expect(dxf).toContain('$ACADVER\n1\nAC1015');
    expect(dxf).toContain('$INSUNITS\n70\n6');
  });

  it('declares the six plan layers in the LAYER table', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    expect(DXF_LAYERS).toEqual(['WALLS', 'INTERIOR', 'OPENINGS', 'FURNITURE', 'LABELS', 'STAIRWELL']);
    for (const layer of DXF_LAYERS) {
      expect(dxf).toContain(`0\nLAYER\n2\n${layer}\n`);
    }
  });

  it('emits closed LWPOLYLINEs for the room outline and each furniture footprint', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    // 1 room outline + 2 furniture rects (openings are wall marks, not rects).
    expect(count(dxf, '0\nLWPOLYLINE')).toBe(3);
    // Every polyline is a 4-vertex closed loop (90 = count, 70 = closed flag)
    // and carries the subclass markers strict parsers require.
    expect(count(dxf, '90\n4\n70\n1')).toBe(3);
    expect(count(dxf, '100\nAcDbEntity')).toBe(3);
    expect(count(dxf, '100\nAcDbPolyline')).toBe(3);
    // Outline spans (0,0)–(8,8): origin at the room corner, metres 1:1.
    expect(dxf).toContain('10\n0.000\n20\n0.000');
    expect(dxf).toContain('10\n8.000\n20\n8.000');
  });

  it('notches the WALLS outline for the recessed entrance — an 8-vertex closed polyline (#285)', () => {
    const { floor } = makeFixture();
    const layout = makeLayout({ floors: [floor], entrance: { width: 1.4, depth: 1.2, offset: 1 } });
    const dxf = layoutToDxf(layout, floor);
    expect(count(dxf, '90\n8\n70\n1')).toBe(1);
    expect(count(dxf, '90\n4\n70\n1')).toBe(2);
    // Recess x ∈ [0.3, 1.7], z ∈ [−4, −2.8] → CAD x 4.3..5.7, y 6.8..8: the
    // outline runs along the north wall from the NE corner, in along the east
    // cheek, across the back, out along the west cheek, on to the NW corner.
    expect(dxf).toContain(
      [
        '10\n8.000\n20\n8.000',
        '10\n5.700\n20\n8.000',
        '10\n5.700\n20\n6.800',
        '10\n4.300\n20\n6.800',
        '10\n4.300\n20\n8.000',
        '10\n0.000\n20\n8.000',
      ].join('\n')
    );
    // A storey the porch doesn't reach keeps the plain 4-vertex outline.
    const upper = { ...floor, id: 'upper' };
    const two = makeLayout({ floors: [floor, upper], entrance: { width: 1.4, depth: 1.2 } });
    expect(count(layoutToDxf(two, upper), '90\n8\n70\n1')).toBe(0);
  });

  it('emits LINE work for interior walls and opening marks, plus the door swing ARC', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    // 1 interior wall + door (2 jamb ticks + leaf) + window (2 ticks + centre).
    expect(count(dxf, '0\nLINE')).toBe(7);
    expect(count(dxf, '0\nARC')).toBe(1);
    expect(count(dxf, '8\nINTERIOR')).toBe(1);
    expect(count(dxf, '8\nOPENINGS')).toBe(7);
    // Door on the north wall (rotation 0): hinge at CAD (3.55, 8), quarter
    // swing sweeping CCW from 270° back to the closed position at 0°.
    expect(dxf).toContain('0\nARC\n8\nOPENINGS\n10\n3.550\n20\n8.000\n40\n0.900\n50\n270.000\n51\n0.000');
  });

  it('labels each furniture item and the floor itself with TEXT', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    expect(count(dxf, '0\nTEXT')).toBe(3); // 2 furniture labels + floor title
    expect(count(dxf, '8\nLABELS')).toBe(3);
    expect(dxf).toContain('1\nChair');
    expect(dxf).toContain('1\nSofa');
    expect(dxf).toContain('1\nMy Home - Ground Floor');
  });

  it('formats every coordinate to fixed 3-dp precision with no NaN', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    expect(dxf).not.toContain('NaN');
    const lines = dxf.split('\n');
    const coordCodes = new Set(['10', '20', '11', '21', '40', '50', '51']);
    let coords = 0;
    for (let i = 0; i < lines.length - 1; i += 2) {
      if (!coordCodes.has(lines[i]!)) continue;
      // $INSUNITS (70) aside, every coordinate/radius/angle value is d.ddd.
      expect(lines[i + 1]).toMatch(/^-?\d+\.\d{3}$/);
      coords++;
    }
    expect(coords).toBeGreaterThan(30);
  });

  it('strips newlines from names so group pairs stay intact', () => {
    const floor = makeFloor({
      items: [makeItem({ name: 'Two\nLines', position: { x: 0, z: 0 } })],
    });
    const dxf = layoutToDxf(makeLayout({ floors: [floor] }), floor);
    expect(dxf).toContain('1\nTwo Lines');
  });

  it('escapes non-ASCII text as \\U+XXXX for the ANSI-decoded AC1015 reader (#288)', () => {
    const floor = makeFloor({
      items: [makeItem({ name: 'Canapé 🛋', position: { x: 0, z: 0 } })],
    });
    const dxf = layoutToDxf(makeLayout({ name: "Maison d'été", floors: [floor] }), floor);
    expect(dxf).toContain("1\nMaison d'\\U+00E9t\\U+00E9 - Ground Floor");
    // Astral code points have no BMP escape.
    expect(dxf).toContain('1\nCanap\\U+00E9 ?');
    // Nothing above 0x7E survives anywhere in the file.
    expect(dxf).toMatch(/^[\x00-\x7e]*$/);
  });

  it('escapes % so names cannot be read as TEXT control codes (#288)', () => {
    const floor = makeFloor({
      items: [makeItem({ name: '%%u', position: { x: 0, z: 0 } })],
    });
    const dxf = layoutToDxf(makeLayout({ floors: [floor] }), floor);
    // %%% is the literal percent sign, so "%%u" reads back as "%%u".
    expect(dxf).toContain('1\n%%%%%%u\n');
  });

  it('agrees with the SVG export on which items appear when some sit outside the walls (#287)', () => {
    const tree = makeItem({ id: 'tree', type: 'tree', name: 'Oak Tree', width: 1.4, depth: 1.4, position: { x: 0, z: 6.7 } });
    const floor = makeFloor({ items: [makeItem(), tree] });
    const layout = makeLayout({ floors: [floor] });
    const dxf = layoutToDxf(layout, floor);
    const svg = layoutToSvg(layout, floor);
    expect(count(dxf, '1\nOak Tree')).toBe(1);
    expect(count(svg, '>Oak Tree</text>')).toBe(1);
    expect(count(dxf, '0\nLWPOLYLINE') - 1).toBe(count(svg, 'class="furniture"'));
  });

  it('is deterministic for the same layout', () => {
    const { layout, floor } = makeFixture();
    expect(layoutToDxf(layout, floor)).toBe(layoutToDxf(layout, floor));
  });

  it('emits stair treads and arrow on FURNITURE, and the stairwell above on its own layer (#290)', () => {
    const stairs = makeItem({ id: 'st', type: 'stairs', name: 'Stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 0, z: 0 } });
    const ground = makeFloor({ id: 'g', items: [stairs] });
    const first = makeFloor({ id: 'f', name: 'First Floor' });
    const layout = makeLayout({ floors: [ground, first] });

    const groundDxf = layoutToDxf(layout, ground);
    // 43 tread segments + 2 arrow barbs; the footprint plus the open arrow shaft.
    expect(count(groundDxf, '0\nLINE')).toBe(14 * 4 - 13 + 2);
    expect(count(groundDxf, '0\nLWPOLYLINE')).toBe(3);
    expect(count(groundDxf, '90\n14\n70\n0')).toBe(1);
    expect(groundDxf).not.toContain('8\nSTAIRWELL');

    const firstDxf = layoutToDxf(layout, first);
    expect(count(firstDxf, '8\nSTAIRWELL')).toBe(1);
    // A closed 4-corner hole, 1.3 m wide about the room's centre line x = 4.
    expect(firstDxf).toContain('8\nSTAIRWELL\n100\nAcDbPolyline\n90\n4\n70\n1\n10\n3.350');
    expect(count(firstDxf, '0\nLINE')).toBe(0);
  });
});
