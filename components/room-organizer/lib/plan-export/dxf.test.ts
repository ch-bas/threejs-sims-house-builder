import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { buildingToDxf, DXF_LAYERS, layoutToDxf } from './dxf';
import { buildingFrameBounds, interiorWallDimensions } from './plan-geometry';
import { layoutToSvg } from './svg';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** One DXF record: its type (the 0 group) and its other group pairs. */
interface DxfRecord {
  type: string;
  tags: Array<[number, string]>;
}

/** Split a DXF into its group-code / value pairs; throws on a malformed pair. */
function parsePairs(dxf: string): Array<[number, string]> {
  const lines = dxf.split('\n');
  expect(lines.length % 2).toBe(0);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]);
    expect(Number.isInteger(code), `group code at line ${i + 1}: ${lines[i]}`).toBe(true);
    pairs.push([code, lines[i + 1]!]);
  }
  return pairs;
}

/** The records of each section, by section name. */
function parseSections(dxf: string): Map<string, DxfRecord[]> {
  const sections = new Map<string, DxfRecord[]>();
  let current: DxfRecord[] | null = null;
  let record: DxfRecord | null = null;
  const pairs = parsePairs(dxf);
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0 && value === 'SECTION') {
      const [nameCode, name] = pairs[++i]!;
      expect(nameCode).toBe(2);
      current = [];
      sections.set(name, current);
      record = null;
    } else if (code === 0 && (value === 'ENDSEC' || value === 'EOF')) {
      current = null;
      record = null;
    } else if (code === 0) {
      record = { type: value, tags: [] };
      current?.push(record);
    } else {
      record?.tags.push([code, value]);
    }
  }
  return sections;
}

function tag(record: DxfRecord, code: number): string | undefined {
  return record.tags.find(([c]) => c === code)?.[1];
}

function entities(dxf: string, type?: string, layer?: string): DxfRecord[] {
  return (parseSections(dxf).get('ENTITIES') ?? []).filter(
    (e) => (type === undefined || e.type === type) && (layer === undefined || tag(e, 8) === layer)
  );
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

/** A floor exercising every entity type: coverage, a mirrored door, stairs, a stairwell above. */
function makeRichBuilding() {
  const ground = makeFloor({
    id: 'g',
    items: [
      ...makeFixture().floor.items,
      makeItem({ id: 'ap', type: 'wifi', name: 'Wi-Fi AP', width: 0.2, depth: 0.2, position: { x: -1, z: -1 }, isWiFiAccessPoint: true, signalRange: 10 }),
      makeItem({ id: 'cam', type: 'security-camera', name: 'Caméra', width: 0.25, depth: 0.2, position: { x: 3.85, z: -3.85 }, rotation: -Math.PI / 4, hasVisionCone: true }),
      makeItem({ id: 'd2', type: 'door', name: 'Door', width: 0.9, depth: 0.1, position: { x: -4, z: 2.5 }, rotation: Math.PI / 2, mirrored: true }),
      makeItem({ id: 'st', type: 'stairs', name: 'Stairs', width: 1.2, depth: 2.4, height: 3, position: { x: 2, z: 1 } }),
      makeItem({ id: 'tree', type: 'tree', name: 'Oak 100%', width: 1.4, depth: 1.4, position: { x: 6, z: 2 } }),
    ],
    interiorWalls: [{ id: 'iw', x1: -2, z1: -4, x2: -2, z2: 0 }],
  });
  const first = makeFloor({ id: 'f', name: 'First Floor', items: [makeItem({ id: 'bed', name: 'Bed', position: { x: 1, z: 1 } })] });
  return makeLayout({ floors: [ground, first], entrance: { width: 1.4, depth: 1.2 } });
}

/**
 * The structural contract of an AutoCAD 2000 DXF (#397), checked the way a
 * strict reader would: the six sections in order; $ACADVER, $HANDSEED,
 * $INSUNITS and $EXTMIN/$EXTMAX; every table, record, block and entity
 * carrying a unique handle below $HANDSEED and an owner that exists; the
 * table records R2000 requires; record counts matching each table head;
 * and an OBJECTS root dictionary pointing at ACAD_GROUP.
 */
function expectValidR2000(dxf: string): void {
  expect(dxf.endsWith('0\nEOF')).toBe(true);
  expect(dxf).toMatch(/^[\x00-\x7e]*$/);
  expect(dxf).not.toContain('NaN');
  const sections = parseSections(dxf);
  expect([...sections.keys()]).toEqual(['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);

  // HEADER: variables are 9-group names followed by their value groups.
  const headerPairs = parsePairs(dxf);
  const headerVar = (name: string): Array<[number, string]> => {
    const at = headerPairs.findIndex(([code, value]) => code === 9 && value === name);
    expect(at, name).toBeGreaterThan(-1);
    const values: Array<[number, string]> = [];
    for (let i = at + 1; i < headerPairs.length && headerPairs[i]![0] !== 9 && headerPairs[i]![0] !== 0; i++) values.push(headerPairs[i]!);
    return values;
  };
  expect(headerVar('$ACADVER')).toEqual([[1, 'AC1015']]);
  expect(headerVar('$INSUNITS')).toEqual([[70, '6']]);
  const seed = parseInt(headerVar('$HANDSEED')[0]![1], 16);
  const extMin = headerVar('$EXTMIN').map(([, v]) => Number(v));
  const extMax = headerVar('$EXTMAX').map(([, v]) => Number(v));
  expect(extMin).toHaveLength(3);
  expect(extMax[0]).toBeGreaterThanOrEqual(extMin[0]!);
  expect(extMax[1]).toBeGreaterThanOrEqual(extMin[1]!);

  // Handles: unique, hex, below the seed; owners resolve.
  const handles = new Set<string>();
  const owned: Array<{ type: string; owner: string }> = [];
  for (const name of ['TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']) {
    for (const record of sections.get(name)!) {
      if (record.type === 'ENDTAB') continue;
      const handle = tag(record, record.type === 'DIMSTYLE' ? 105 : 5);
      expect(handle, `${record.type} handle`).toMatch(/^[0-9A-F]+$/);
      expect(handles.has(handle!), `duplicate handle ${handle}`).toBe(false);
      handles.add(handle!);
      expect(parseInt(handle!, 16)).toBeLessThan(seed);
      const owner = tag(record, 330);
      expect(owner, `${record.type} owner`).toBeDefined();
      owned.push({ type: record.type, owner: owner! });
    }
  }
  for (const { type, owner } of owned) {
    if (owner !== '0') expect(handles.has(owner), `${type} owner ${owner}`).toBe(true);
  }

  // Tables: the nine, in order, each head's count matching its records, and the required records.
  const tables = new Map<string, string[]>();
  let head: DxfRecord | null = null;
  for (const record of sections.get('TABLES')!) {
    if (record.type === 'TABLE') {
      head = record;
      tables.set(tag(record, 2)!, []);
      expect(record.tags.some(([code, value]) => code === 100 && value === 'AcDbSymbolTable')).toBe(true);
    } else if (record.type === 'ENDTAB') {
      expect(Number(tag(head!, 70))).toBe(tables.get(tag(head!, 2)!)!.length);
      head = null;
    } else {
      expect(record.type).toBe(tag(head!, 2));
      expect(record.tags.some(([code, value]) => code === 100 && value === 'AcDbSymbolTableRecord')).toBe(true);
      tables.get(tag(head!, 2)!)!.push(tag(record, 2)!.toUpperCase());
    }
  }
  expect([...tables.keys()]).toEqual(['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD']);
  expect(tables.get('LTYPE')).toEqual(expect.arrayContaining(['BYBLOCK', 'BYLAYER', 'CONTINUOUS']));
  expect(tables.get('LAYER')).toEqual(['0', ...DXF_LAYERS]);
  expect(tables.get('STYLE')).toContain('STANDARD');
  expect(tables.get('APPID')).toContain('ACAD');
  expect(tables.get('DIMSTYLE')).toContain('STANDARD');
  expect(tables.get('BLOCK_RECORD')).toEqual(['*MODEL_SPACE', '*PAPER_SPACE']);

  // BLOCKS: a BLOCK/ENDBLK pair per layout.
  expect(sections.get('BLOCKS')!.map((b) => `${b.type} ${tag(b, 2) ?? ''}`.trim())).toEqual([
    'BLOCK *MODEL_SPACE',
    'ENDBLK',
    'BLOCK *PAPER_SPACE',
    'ENDBLK',
  ]);

  // Entities: in model space, on a declared layer, with their subclass markers.
  const modelSpace = sections.get('TABLES')!.find((r) => r.type === 'BLOCK_RECORD' && tag(r, 2) === '*MODEL_SPACE')!;
  const subclass: Record<string, string> = { LINE: 'AcDbLine', LWPOLYLINE: 'AcDbPolyline', ARC: 'AcDbArc', CIRCLE: 'AcDbCircle', TEXT: 'AcDbText' };
  for (const entity of sections.get('ENTITIES')!) {
    expect(tag(entity, 330)).toBe(tag(modelSpace, 5));
    expect(DXF_LAYERS as readonly string[]).toContain(tag(entity, 8));
    const markers = entity.tags.filter(([code]) => code === 100).map(([, value]) => value);
    expect(markers[0]).toBe('AcDbEntity');
    expect(markers).toContain(subclass[entity.type]);
  }

  // OBJECTS: root dictionary → ACAD_GROUP dictionary.
  const [root, group] = sections.get('OBJECTS')!;
  expect(root!.type).toBe('DICTIONARY');
  expect(tag(root!, 3)).toBe('ACAD_GROUP');
  expect(tag(root!, 350)).toBe(tag(group!, 5));
  expect(tag(group!, 330)).toBe(tag(root!, 5));
}

describe('layoutToDxf', () => {
  it('is a structurally complete AutoCAD 2000 document (#397)', () => {
    const { layout, floor } = makeFixture();
    expectValidR2000(layoutToDxf(layout, floor));
    const building = makeRichBuilding();
    for (const f of building.floors) expectValidR2000(layoutToDxf(building, f));
    expectValidR2000(buildingToDxf(building));
    // An empty floor still produces a valid (if sparse) document.
    const empty = makeFloor();
    expectValidR2000(layoutToDxf(makeLayout({ floors: [empty] }), empty, { coverage: false, dimensions: false }));
  });

  it('declares $EXTMIN/$EXTMAX around everything drawn (#397)', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor, { dimensions: false });
    // The room spans (0,0)–(8,8); the title sits above it at y = 8.5 and the
    // north arrow 0.8 m east of the NE corner.
    expect(dxf).toContain('$EXTMIN\n10\n0.000\n20\n0.000\n30\n0.000');
    expect(dxf).toContain('$EXTMAX\n10\n8.980\n20\n8.500\n30\n0.000');
  });

  it('keeps the plan layers and adds COVERAGE and DIMENSIONS', () => {
    expect(DXF_LAYERS).toEqual(['WALLS', 'INTERIOR', 'OPENINGS', 'FURNITURE', 'LABELS', 'STAIRWELL', 'COVERAGE', 'DIMENSIONS', 'ZONES']);
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    for (const layer of ['0', ...DXF_LAYERS]) {
      expect(dxf).toContain(`0\nLAYER\n`);
      expect(dxf).toMatch(new RegExp(`AcDbLayerTableRecord\\n2\\n${layer}\\n`));
    }
  });

  it('draws each zone as a closed outline with its name and area at the top edge (#571)', () => {
    const zone = { id: 'z', name: 'Séjour', color: '#60a5fa', x: -3, z: -2, w: 5, d: 4.5 };
    const floor = makeFloor({ zones: [zone, { ...zone, id: 'y', name: 'Hall', x: 1, z: 2, w: 2, d: 1 }] });
    const dxf = layoutToDxf(makeLayout({ floors: [floor] }), floor);
    expectValidR2000(dxf);
    const outlines = entities(dxf, 'LWPOLYLINE', 'ZONES');
    expect(outlines).toHaveLength(2);
    expect(tag(outlines[0]!, 70)).toBe('1');
    // World (−3, −2) → (2, 2.5) in an 8 × 8 room: CAD x 1…6, y 1.5…6.
    const vertices = (code: number): string[] => outlines[0]!.tags.filter(([c]) => c === code).map(([, v]) => v);
    expect(vertices(10)).toEqual(['1.000', '6.000', '6.000', '1.000']);
    expect(vertices(20)).toEqual(['6.000', '6.000', '1.500', '1.500']);
    const texts = entities(dxf, 'TEXT', 'ZONES');
    expect(texts.map((t) => tag(t, 1))).toEqual(['S\\U+00E9jour', '22.5 m\\U+00B2', 'Hall', '2.0 m\\U+00B2']);
    // Centred on the zone, under the top edge, area below the name, as the SVG.
    const [name, area] = texts;
    expect(Number(tag(name!, 11))).toBeCloseTo(3.5, 3);
    expect(Number(tag(name!, 21))).toBeLessThan(6);
    expect(Number(tag(area!, 21))).toBeLessThan(Number(tag(name!, 21)));
  });

  it('draws no zone entities on a floor without zones, and each floor’s own on a building (#571)', () => {
    const { layout, floor } = makeFixture();
    expect(entities(layoutToDxf(layout, floor), undefined, 'ZONES')).toHaveLength(0);
    const zone = { id: 'z', name: 'Hall', color: '#60a5fa', x: 0, z: 0, w: 2, d: 2 };
    const zoned = { ...floor, zones: [zone] };
    const building = makeLayout({ floors: [zoned, makeFloor({ id: 'f', zones: [{ ...zone, id: 'y' }] })] });
    const outlines = entities(buildingToDxf(building), 'LWPOLYLINE', 'ZONES');
    expect(outlines).toHaveLength(2);
    expect(Number(tag(outlines[1]!, 10))).toBeGreaterThan(Number(tag(outlines[0]!, 10)) + 8);
  });

  it('emits closed LWPOLYLINEs for the room outline and each furniture footprint', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    const outline = entities(dxf, 'LWPOLYLINE', 'WALLS');
    const furniture = entities(dxf, 'LWPOLYLINE', 'FURNITURE');
    expect(outline).toHaveLength(1);
    // Openings are wall marks, not rects.
    expect(furniture).toHaveLength(2);
    for (const polyline of [...outline, ...furniture]) {
      expect(tag(polyline, 90)).toBe('4');
      expect(tag(polyline, 70)).toBe('1');
    }
    // Outline spans (0,0)–(8,8): origin at the room corner, metres 1:1.
    expect(dxf).toContain('10\n0.000\n20\n0.000');
    expect(dxf).toContain('10\n8.000\n20\n8.000');
  });

  it('notches the WALLS outline for the recessed entrance — an 8-vertex closed polyline (#285)', () => {
    const { floor } = makeFixture();
    const layout = makeLayout({ floors: [floor], entrance: { width: 1.4, depth: 1.2, offset: 1 } });
    const dxf = layoutToDxf(layout, floor);
    const [outline] = entities(dxf, 'LWPOLYLINE', 'WALLS');
    expect(tag(outline!, 90)).toBe('8');
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
    expect(tag(entities(layoutToDxf(two, upper), 'LWPOLYLINE', 'WALLS')[0]!, 90)).toBe('4');
  });

  it('emits LINE work for interior walls and opening marks, plus the door swing ARC', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    expect(entities(dxf, 'LINE', 'INTERIOR')).toHaveLength(1);
    // Door (2 jamb ticks + leaf) + window (2 ticks + centre).
    expect(entities(dxf, 'LINE', 'OPENINGS')).toHaveLength(6);
    const arcs = entities(dxf, 'ARC', 'OPENINGS');
    expect(arcs).toHaveLength(1);
    // Door on the north wall (rotation 0): hinge at CAD (3.55, 8), quarter
    // swing sweeping CCW from 270° back to the closed position at 0°.
    expect([tag(arcs[0]!, 10), tag(arcs[0]!, 20), tag(arcs[0]!, 40), tag(arcs[0]!, 50), tag(arcs[0]!, 51)]).toEqual([
      '3.550',
      '8.000',
      '0.900',
      '270.000',
      '0.000',
    ]);
  });

  it('hinges a mirrored door on the other jamb, as the 3D model does (#386)', () => {
    // West wall, rotation π/2: `along` is world (0, −1) — north — and `into`
    // world (1, 0). Unmirrored, the hinge is at the south jamb (local −X);
    // mirrored, it is at the north jamb, z = 2.05 → CAD y 1.95.
    const door = makeItem({ id: 'd', type: 'door', name: 'Door', width: 0.9, depth: 0.1, position: { x: -4, z: 2.5 }, rotation: Math.PI / 2 });
    const plainFloor = makeFloor({ items: [door] });
    const mirroredFloor = makeFloor({ items: [{ ...door, mirrored: true }] });
    const arcOf = (f: typeof plainFloor) => entities(layoutToDxf(makeLayout({ floors: [f] }), f), 'ARC', 'OPENINGS')[0]!;
    const leafOf = (f: typeof plainFloor) => entities(layoutToDxf(makeLayout({ floors: [f] }), f), 'LINE', 'OPENINGS')[2]!;

    const plain = arcOf(plainFloor);
    expect([tag(plain, 10), tag(plain, 20), tag(plain, 50), tag(plain, 51)]).toEqual(['0.000', '1.050', '0.000', '90.000']);
    const mirrored = arcOf(mirroredFloor);
    expect([tag(mirrored, 10), tag(mirrored, 20), tag(mirrored, 50), tag(mirrored, 51)]).toEqual(['0.000', '1.950', '270.000', '0.000']);
    // The leaf runs from the hinge into the room (east).
    const leaf = leafOf(mirroredFloor);
    expect([tag(leaf, 10), tag(leaf, 20), tag(leaf, 11), tag(leaf, 21)]).toEqual(['0.000', '1.950', '0.900', '1.950']);
  });

  it('labels each furniture item and the floor itself with TEXT', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    const labels = entities(dxf, 'TEXT', 'LABELS').map((t) => tag(t, 1));
    // 2 furniture labels, the north arrow's N, and the floor title.
    expect(labels).toEqual(['Chair', 'Sofa', 'N', 'My Home - Ground Floor']);
  });

  it('formats every coordinate to fixed 3-dp precision with no NaN', () => {
    const dxf = buildingToDxf(makeRichBuilding());
    expect(dxf).not.toContain('NaN');
    const coordCodes = new Set([10, 20, 30, 11, 21, 40, 41, 42, 50, 51]);
    let coords = 0;
    for (const [code, value] of parsePairs(dxf)) {
      if (!coordCodes.has(code)) continue;
      expect(value).toMatch(/^-?\d+\.\d{3}$/);
      coords++;
    }
    expect(coords).toBeGreaterThan(300);
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

  it('drops lone surrogates and non-characters rather than escaping them (#549)', () => {
    const floor = makeFloor({ items: [makeItem({ name: 'Sofa\ud83d￿', position: { x: 0, z: 0 } })] });
    const dxf = layoutToDxf(makeLayout({ floors: [floor] }), floor);
    expect(dxf).toContain('1\nSofa\n');
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
    expect(entities(dxf, 'LWPOLYLINE', 'FURNITURE')).toHaveLength(count(svg, 'class="furniture"'));
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
    expect(entities(groundDxf, 'LINE', 'FURNITURE')).toHaveLength(14 * 4 - 13 + 2);
    const polylines = entities(groundDxf, 'LWPOLYLINE', 'FURNITURE');
    expect(polylines).toHaveLength(2);
    expect(polylines.filter((p) => tag(p, 90) === '14' && tag(p, 70) === '0')).toHaveLength(1);
    expect(entities(groundDxf, undefined, 'STAIRWELL')).toHaveLength(0);

    const firstDxf = layoutToDxf(layout, first);
    const holes = entities(firstDxf, 'LWPOLYLINE', 'STAIRWELL');
    expect(holes).toHaveLength(1);
    // A closed 4-corner hole, 1.3 m wide about the room's centre line x = 4.
    expect([tag(holes[0]!, 90), tag(holes[0]!, 70), tag(holes[0]!, 10)]).toEqual(['4', '1', '3.350']);
    expect(entities(firstDxf, 'LINE', 'FURNITURE')).toHaveLength(0);
  });

  it('draws Wi-Fi rings and the camera wedge on COVERAGE (#420)', () => {
    const floor = makeFloor({
      items: [
        makeItem({ id: 'ap', type: 'wifi', name: 'AP', width: 0.2, depth: 0.2, position: { x: 0, z: 0 }, isWiFiAccessPoint: true, signalRange: 6 }),
        // Facing south (+z): rotation 0, 90° FOV, no range → the 7 m default (#401).
        makeItem({ id: 'cam', type: 'security-camera', name: 'Cam', width: 0.25, depth: 0.2, position: { x: 0, z: -3.9 }, hasVisionCone: true, visionFov: 90 }),
      ],
    });
    const layout = makeLayout({ floors: [floor] });
    const dxf = layoutToDxf(layout, floor);
    const circles = entities(dxf, 'CIRCLE', 'COVERAGE');
    expect(circles.map((c) => [tag(c, 10), tag(c, 20), tag(c, 40)])).toEqual([
      ['4.000', '4.000', '2.000'],
      ['4.000', '4.000', '4.000'],
      ['4.000', '4.000', '6.000'],
    ]);
    // Facing CAD −Y (270°) ± 45°: the CCW arc 225° → 315° about the lens at CAD (4, 7.9).
    const [arc] = entities(dxf, 'ARC', 'COVERAGE');
    expect([tag(arc!, 10), tag(arc!, 20), tag(arc!, 40), tag(arc!, 50), tag(arc!, 51)]).toEqual([
      '4.000',
      '7.900',
      '7.000',
      '225.000',
      '315.000',
    ]);
    expect(entities(dxf, 'LINE', 'COVERAGE')).toHaveLength(2);
    // Off on request.
    expect(entities(layoutToDxf(layout, floor, { coverage: false }), undefined, 'COVERAGE')).toHaveLength(0);
  });

  it('dimensions the room and interior walls, and draws a north arrow (#424)', () => {
    const { layout, floor } = makeFixture();
    const dxf = layoutToDxf(layout, floor);
    const texts = entities(dxf, 'TEXT', 'DIMENSIONS').map((t) => [tag(t, 1), tag(t, 50) ?? '0']);
    // Width (horizontal), depth (vertical, reads upward), the 4 m interior wall (vertical).
    expect(texts).toEqual([
      ['8.00 m', '0'],
      ['8.00 m', '90.000'],
      ['4.00 m', '90.000'],
    ]);
    // Width dimension line 0.4 m below the room, from corner to corner.
    expect(dxf).toContain('8\nDIMENSIONS\n100\nAcDbLine\n10\n0.000\n20\n-0.400\n11\n8.000\n21\n-0.400');
    // North arrow: a closed head on LABELS, tip at the content's NE corner + 0.8 m east.
    const arrow = entities(dxf, 'LWPOLYLINE', 'LABELS');
    expect(arrow).toHaveLength(1);
    expect([tag(arrow[0]!, 70), tag(arrow[0]!, 10), tag(arrow[0]!, 20)]).toEqual(['1', '8.800', '8.000']);
    expect(entities(layoutToDxf(layout, floor, { dimensions: false }), undefined, 'DIMENSIONS')).toHaveLength(0);
  });
});

describe('coverage frame (#420)', () => {
  // A 30 m camera on the outside of the south wall, facing the garden, and a
  // 10 m Wi-Fi AP inside: an 8 m house.
  const floor = makeFloor({
    items: [
      makeItem({ id: 'co', type: 'security-camera', name: 'Cam', width: 0.25, depth: 0.2, position: { x: 0, z: 4.12 }, rotation: 0, hasVisionCone: true, visionRange: 30, visionFov: 103 }),
      makeItem({ id: 'ap', type: 'wifi', name: 'AP', width: 0.2, depth: 0.2, position: { x: -2, z: -2 }, isWiFiAccessPoint: true, signalRange: 10 }),
    ],
  });
  const layout = makeLayout({ floors: [floor] });
  const header = (dxf: string, name: string): [number, number] => {
    const at = dxf.indexOf(`${name}\n`);
    const lines = dxf.slice(at).split('\n');
    return [Number(lines[2]), Number(lines[4])];
  };

  it('trims rings and wedges to the same frame the SVG clips to', () => {
    const dxf = layoutToDxf(layout, floor);
    // The frame: content (room + camera body to z 4.22) grown ≤ 5 m: CAD x −5…13, y −5.22…8 (+ the AP's reach north, capped).
    for (const entity of entities(dxf, undefined, 'COVERAGE')) {
      for (const [code, value] of entity.tags) {
        if (code === 10 || code === 11) expect(Number(value)).toBeGreaterThanOrEqual(-5.001);
        if (code === 10 || code === 11) expect(Number(value)).toBeLessThanOrEqual(13.001);
      }
    }
    // The outer 10 m ring runs off the frame to the north-west: one ARC
    // (merged across 0°); the inner two fit whole. The wedge's 30 m arc lies
    // wholly beyond the frame, so it is dropped, and its two sides are
    // trimmed at the frame's edge.
    expect(entities(dxf, 'ARC', 'COVERAGE')).toHaveLength(1);
    expect(entities(dxf, 'CIRCLE', 'COVERAGE')).toHaveLength(2);
    const sides = entities(dxf, 'LINE', 'COVERAGE');
    expect(sides).toHaveLength(2);
    // Each side ends on the frame: the south edge (CAD y −5.22) or a side edge.
    for (const side of sides) {
      const [x, y] = [Number(tag(side, 11)), Number(tag(side, 21))];
      expect(Math.abs(y + 5.22) < 0.01 || Math.abs(x + 5) < 0.01 || Math.abs(x - 13) < 0.01).toBe(true);
    }
  });

  it('opens on the plan, not on a 30 m lens: extents and viewport follow the frame (#397)', () => {
    const dxf = layoutToDxf(layout, floor);
    const [minX, minY] = header(dxf, '$EXTMIN');
    const [maxX, maxY] = header(dxf, '$EXTMAX');
    // The frame is at most 5 m past the 8 m house on each side, plus the
    // dimensions, arrow and title just outside it.
    expect(maxX - minX).toBeLessThan(8 + 2 * 5 + 2);
    expect(maxY - minY).toBeLessThan(8 + 2 * 5 + 2);
    expect(minY).toBeGreaterThan(-6);
    // The full option keeps everything (and the extents follow it).
    const full = layoutToDxf(layout, floor, { coverage: 'full' });
    expect(header(full, '$EXTMIN')[1]).toBeLessThan(-29);
  });
});

describe('interior wall dimensions', () => {
  it('sit on the same side of the wall as in the SVG, clear of an item label', () => {
    // Wall running south at x = −1.5 with a desk against its west face.
    const desk = makeItem({ id: 'd', type: 'desk', name: 'Desk 45', width: 1.2, depth: 0.5, position: { x: -2.3, z: -2 }, rotation: Math.PI / 4 });
    const floor = makeFloor({ items: [desk], interiorWalls: [{ id: 'iw', x1: -1.5, z1: -4, x2: -1.5, z2: 0 }] });
    const layout = makeLayout({ floors: [floor] });
    const [dim] = interiorWallDimensions(floor);
    expect(dim!.normal).toEqual({ x: 1, z: 0 }); // east, away from the desk
    // DXF: the dimension line runs 0.2 m east of the wall's CAD x 2.5.
    const dxf = layoutToDxf(layout, floor);
    const label = entities(dxf, 'TEXT', 'DIMENSIONS').find((t) => tag(t, 1) === '4.00 m')!;
    expect(Number(tag(label, 10))).toBeGreaterThan(2.5);
    // SVG: the wall's dimension label also sits east of the wall (x px 160).
    const svg = layoutToSvg(layout, floor);
    const svgLabel = /class="wall-dimension">.*?transform="translate\(([\d.]+) /.exec(svg)!;
    expect(Number(svgLabel[1])).toBeGreaterThan(160);
  });
});

describe('buildingToDxf', () => {
  it('lays every floor out side by side on the same layers, ground first (#405)', () => {
    const building = makeRichBuilding();
    const dxf = buildingToDxf(building);
    const titles = entities(dxf, 'TEXT', 'LABELS')
      .map((t) => tag(t, 1))
      .filter((t) => t?.startsWith('My Home'));
    expect(titles).toEqual(['My Home - Ground Floor', 'My Home - First Floor']);
    const outlines = entities(dxf, 'LWPOLYLINE', 'WALLS');
    expect(outlines).toHaveLength(2);
    // Every floor shares the building frame (as the SVG does), placed at its
    // width + 3 m: the rooms line up across the sheet.
    const frame = buildingFrameBounds(building);
    expect(tag(outlines[0]!, 10)).toBe('0.000');
    expect(Number(tag(outlines[1]!, 10))).toBeCloseTo(frame.maxX - frame.minX + 3, 3);
    // Same entity set per floor as the single-floor export.
    for (const floor of building.floors) {
      const single = layoutToDxf(building, floor);
      for (const name of DXF_LAYERS) {
        expect(entities(single, undefined, name).length).toBeLessThanOrEqual(entities(dxf, undefined, name).length);
      }
    }
    const total = (d: string) => entities(d).length;
    expect(total(dxf)).toBe(building.floors.reduce((sum, f) => sum + total(layoutToDxf(building, f)), 0));
  });
});
