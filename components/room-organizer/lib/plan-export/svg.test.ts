import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from '../__testfixtures__/fixtures';
import { wallOpeningDimensions } from './plan-geometry';
import { buildingToSvg, layoutToSvg, planSheetSize } from './svg';

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

describe('opening chains (#630)', () => {
  const chainOptions = { openingDimensions: true };

  it('are off by default, so the print route’s sheet keeps its size', () => {
    const { layout, floor } = makeFixture();
    expect(layoutToSvg(layout, floor)).not.toContain('opening-chain');
    expect(planSheetSize(layout, floor).widthPx).toBe(520);
  });

  it('draw one chain per wall with an opening, in a band that grows the sheet', () => {
    const { layout, floor } = makeFixture();
    const svg = layoutToSvg(layout, floor, chainOptions);
    expect(count(svg, 'class="opening-chain"')).toBe(2);
    expect(svg).toContain('data-wall="north"');
    expect(svg).toContain('data-wall="east"');
    // Three runs a wall, each with its label: 3.55 m, 0.90 m, 3.55 m.
    expect(count(svg, 'class="opening-dimension"')).toBe(6);
    expect(count(svg, '>3.55 m</text>')).toBe(4);
    expect(planSheetSize(layout, floor, chainOptions).widthPx).toBe(580);
    expect(svg).toContain('viewBox="0 0 580 580"');
  });

  it('grow the band for a third row of labels, on every storey alike', () => {
    const window = (id: string, x: number, width: number) =>
      makeItem({ id, type: 'window', width, depth: 0.1, position: { x, z: -4 }, rotation: 0 });
    const dense = makeFloor({ items: [window('a', 0, 0.1), window('b', 0.2, 0.1), window('c', 0.4, 0.1), window('d', 0.6, 0.1)] });
    const layout = makeLayout({ floors: [dense, makeFloor({ id: 'upper', name: 'Upper' })] });
    const roomLine = (svg: string): number => Number(/class="room-dimension"><line x1="[\d.]+" y1="([\d.]+)"/.exec(svg)![1]);
    const rows = 1 + Math.max(...wallOpeningDimensions(layout, dense)[0]!.segments.map((s) => s.labelRow));
    expect(rows).toBeGreaterThan(2);
    const band = 30 + 10 * (rows - 2);
    expect(roomLine(layoutToSvg(layout, dense, chainOptions)) - roomLine(layoutToSvg(layout, dense))).toBe(band);
    const upper = planSheetSize(layout, layout.floors[1]!, chainOptions);
    expect(upper.widthPx).toBe(520 + 2 * band);
  });

  it('need the dimensions layer', () => {
    const { layout, floor } = makeFixture();
    expect(layoutToSvg(layout, floor, { ...chainOptions, dimensions: false })).not.toContain('opening-chain');
    expect(planSheetSize(layout, floor, { ...chainOptions, dimensions: false }).widthPx).toBe(520);
  });

  it('step the room dimensions out, past the chain', () => {
    const { layout, floor } = makeFixture();
    const roomLine = (svg: string): number => Number(/class="room-dimension"><line x1="[\d.]+" y1="([\d.]+)"/.exec(svg)![1]);
    expect(roomLine(layoutToSvg(layout, floor, chainOptions)) - roomLine(layoutToSvg(layout, floor))).toBe(30);
  });

  it('do not widen the coverage clip with the band', () => {
    const wifi = makeItem({ id: 'ap', type: 'wifi', width: 0.2, depth: 0.2, position: { x: 0, z: 0 }, isWiFiAccessPoint: true, signalRange: 2 });
    const floor = makeFloor({ items: [wifi] });
    const layout = makeLayout({ floors: [floor] });
    const clip = (svg: string): string => /<clipPath[^>]*>(<rect[^>]*>)/.exec(svg)![1]!;
    expect(clip(layoutToSvg(layout, floor, chainOptions))).toBe(clip(layoutToSvg(layout, floor)));
  });

  it('keep every storey of a whole-building sheet the same size', () => {
    const { floor } = makeFixture();
    const layout = makeLayout({ floors: [floor, makeFloor({ id: 'upper', name: 'Upper' })] });
    const svg = buildingToSvg(layout, chainOptions);
    expect(count(svg, 'class="floor-sheet"')).toBe(2);
    expect(svg).toContain('translate(0 580)');
  });
});

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

  it('hinges a mirrored door on the other jamb, as the 3D model does (#386)', () => {
    const door = makeItem({ id: 'd', type: 'door', name: 'Door', width: 0.9, depth: 0.1, position: { x: -4, z: 2.5 }, rotation: Math.PI / 2 });
    const plainFloor = makeFloor({ items: [door] });
    const mirroredFloor = makeFloor({ items: [{ ...door, mirrored: true }] });
    const plain = layoutToSvg(makeLayout({ floors: [plainFloor] }), plainFloor);
    const mirrored = layoutToSvg(makeLayout({ floors: [mirroredFloor] }), mirroredFloor);
    expect(plain).toContain('transform="translate(60 385) rotate(-90)"');
    // The symbol is flipped about the opening's centre, moving the leaf to the +X jamb.
    expect(mirrored).toContain('transform="translate(60 385) rotate(-90) scale(-1 1)"');
    // A window is symmetric, but mirroring it changes nothing else.
    expect(count(mirrored, 'class="opening"')).toBe(1);
  });

  it('keeps item labels readable: never upside down, sideways ones read bottom-to-top (#401)', () => {
    const at = (rotation: number) => {
      const floor = makeFloor({ items: [makeItem({ name: 'TV Stand', width: 1.6, depth: 0.6, position: { x: 0, z: 0 }, rotation })] });
      const svg = layoutToSvg(makeLayout({ floors: [floor] }), floor);
      return /<text class="label"[^>]*>/.exec(svg)![0];
    };
    // Item rotation θ → SVG group rotate(−θ°).
    expect(at(0)).not.toContain('transform');
    expect(at(Math.PI)).toContain('transform="rotate(180)"'); // group 180° → net 0°
    expect(at(-Math.PI)).toContain('transform="rotate(180)"');
    expect(at(Math.PI / 2)).not.toContain('transform'); // group −90° reads bottom-to-top
    expect(at(-Math.PI / 2)).toContain('transform="rotate(180)"'); // group +90° → net −90°
    expect(at(Math.PI / 4)).not.toContain('transform');
    expect(at((3 * Math.PI) / 4)).toContain('transform="rotate(180)"');
  });

  it('leaves wall-mounted cameras out of the sheet bounds (#401)', () => {
    // A camera in the NE corner at 135° pokes its footprint past both walls.
    const camera = makeItem({ id: 'cam', type: 'security-camera', name: 'Security Camera', width: 0.25, depth: 0.2, position: { x: 3.9, z: -3.9 }, rotation: (3 * Math.PI) / 4 });
    const floor = makeFloor({ items: [camera] });
    const layout = makeLayout({ floors: [floor] });
    expect(layoutToSvg(layout, floor)).toContain('viewBox="0 0 520 520"');
    expect(layoutToSvg(layout, floor)).toContain('<g class="plan" transform="translate(0 0)">');
  });

  it('draws the coverage layer under the furniture, on a sheet grown to show it (#420)', () => {
    const floor = makeFloor({
      items: [
        makeItem({ id: 'ap', type: 'wifi', name: 'AP', width: 0.2, depth: 0.2, position: { x: 0, z: 0 }, isWiFiAccessPoint: true, signalRange: 6 }),
        makeItem({ id: 'cctv', type: 'cctv', name: 'CCTV', width: 0.2, depth: 0.2, position: { x: 1, z: 1 }, isCCTV: true, signalRange: 3 }),
        // Facing south, 90° FOV, no range: the 3D cone's 7 m default (#401).
        makeItem({ id: 'cam', type: 'security-camera', name: 'Cam', width: 0.25, depth: 0.2, position: { x: 0, z: -3.9 }, hasVisionCone: true, visionFov: 90 }),
        makeItem({ id: 'sofa', type: 'sofa', name: 'Sofa', width: 2, depth: 1, position: { x: -2, z: 2 } }),
      ],
    });
    const layout = makeLayout({ floors: [floor] });
    const svg = layoutToSvg(layout, floor);
    expect(count(svg, 'class="wifi-ring"')).toBe(3);
    expect(count(svg, 'class="cctv-ring"')).toBe(3);
    // Rings at ⅓, ⅔ and the full range, outer first.
    expect(svg).toContain('<circle class="wifi-ring" cx="260" cy="260" r="300"');
    expect(svg).toContain('<circle class="wifi-ring" cx="260" cy="260" r="100"');
    // Lens at (260, 65); ±45° about straight down at 7 m (350 px).
    expect(svg).toContain('<path class="vision" d="M 260 65 L 507.49 312.49 A 350 350 0 0 1 12.51 312.49 Z"');
    // The 6 m Wi-Fi rings reach 2 m past every wall: the sheet frames ±6 m
    // (12 m + 2 × 1.2 m margin), the room moves in by 2 m, and the clip is
    // that whole frame.
    expect(svg).toContain('viewBox="0 0 720 720"');
    expect(svg).toContain('<g class="plan" transform="translate(100 100)">');
    expect(svg).toContain('<clipPath id="coverage-clip"><rect x="-40" y="-40" width="600" height="600"/></clipPath>');
    expect(svg).toContain('<g class="coverage" clip-path="url(#coverage-clip)">');
    // Room dimensions still hug the room, not the grown frame.
    expect(svg).toContain('<line x1="60" y1="474" x2="460" y2="474" stroke-width="0.75"/>');
    // Without coverage the sheet is the plain room sheet.
    expect(layoutToSvg(layout, floor, { coverage: false })).toContain('viewBox="0 0 520 520"');
    expect(svg.indexOf('class="coverage"')).toBeLessThan(svg.indexOf('class="furniture"'));
    expect(svg.indexOf('class="coverage"')).toBeGreaterThan(svg.indexOf('class="wall"'));
    // Off on request, and absent when nothing radiates.
    expect(layoutToSvg(layout, floor, { coverage: false })).not.toContain('class="coverage"');
    const { layout: plain, floor: plainFloor } = makeFixture();
    expect(layoutToSvg(plain, plainFloor)).not.toContain('coverage');
  });

  it('dimensions the room in the margin band and each interior wall, and draws a north arrow (#424)', () => {
    const { layout, floor } = makeFixture();
    const svg = layoutToSvg(layout, floor);
    expect(count(svg, 'class="room-dimension"')).toBe(2);
    expect(count(svg, 'class="wall-dimension"')).toBe(1);
    // Width 14 px below the room (y 460 → 474), label below it; depth 14 px left (x 60 → 46), reading upward.
    expect(svg).toContain('<line x1="60" y1="474" x2="460" y2="474" stroke-width="0.75"/>');
    expect(svg).toContain('transform="translate(260 482) rotate(0)">8.00 m</text>');
    expect(svg).toContain('transform="translate(38 260) rotate(-90)">8.00 m</text>');
    // The 4 m interior wall at x = −2 (160 px), dimensioned beside it.
    expect(svg).toContain('>4.00 m</text>');
    // North arrow centred in the right margin band, the scale bar untouched.
    expect(svg).toContain('class="north-arrow"');
    expect(svg).toContain('<text x="490" y="68" font-size="11" font-weight="bold" text-anchor="middle"');
    expect(svg).toContain('class="scale-bar"');
    const off = layoutToSvg(layout, floor, { dimensions: false });
    expect(off).not.toContain('class="dimensions"');
    expect(off).toContain('class="north-arrow"');
    // The annotations live in the margin: the sheet size is unchanged.
    expect(svg).toContain('viewBox="0 0 520 520"');
  });

  it('adds an opt-in item schedule under the plan and sizes the sheet for it (#424)', () => {
    const { layout, floor } = makeFixture();
    const priced = {
      ...floor,
      items: [...floor.items, makeItem({ id: 'chair-2', name: 'Chair', position: { x: 2, z: 2 }, price: 40 }), makeItem({ id: 'chair-3', name: 'Chair', position: { x: 3, z: 2 }, price: 40 })],
    };
    const off = layoutToSvg(layout, priced);
    expect(off).not.toContain('class="schedule"');
    const svg = layoutToSvg(layout, priced, { schedule: true });
    expect(svg).toContain('>Item schedule</text>');
    // Chair (unpriced) and Chair ×2 at $40 are different lines; Door, Sofa, Window.
    expect(count(svg, 'class="schedule-row"')).toBe(5);
    expect(svg).toContain('>$80</text>');
    expect(svg).toContain('>1 × 1 × 1</text>');
    // Plan 520 px + heading 52 + 6 rows × 16 + half margin 30.
    const size = planSheetSize(layout, priced, { schedule: true });
    expect(size).toEqual({ widthPx: 520, heightPx: 698, widthM: 10.4, heightM: 13.96 });
    expect(svg).toContain('viewBox="0 0 520 698"');
    // A narrow room widens the sheet to fit the table; the plan stays put.
    const narrow = makeLayout({ width: 3, height: 3, floors: [priced] });
    expect(planSheetSize(narrow, priced, { schedule: true }).widthPx).toBe(520);
  });

  it('leaves the schedule off a floor with nothing placed (#424)', () => {
    const { layout } = makeFixture();
    const empty = makeFloor({ items: [makeUnplacedItem({ id: 'tray' })] });
    expect(layoutToSvg(layout, empty, { schedule: true })).not.toContain('class="schedule"');
    expect(planSheetSize(layout, empty, { schedule: true })).toEqual(planSheetSize(layout, empty));
  });

  it('gives each floor of a whole-building SVG its own schedule (#424, #405)', () => {
    const { layout, floor } = makeFixture();
    const building = { ...layout, floors: [floor, makeFloor({ id: 'up', name: 'Upper', items: [] })] };
    const svg = buildingToSvg(building, { schedule: true });
    expect(count(svg, 'class="floor-sheet"')).toBe(2);
    // Only the furnished ground floor carries a table.
    expect(count(svg, 'class="schedule"')).toBe(1);
  });

  it('never lets the title overprint the room size on a narrow sheet', () => {
    // 8 m wide: both fit on one line, as before.
    const { layout, floor } = makeFixture();
    const wide = layoutToSvg(layout, floor);
    expect(wide).toContain('class="plan-title" x="60" y="38"');
    expect(wide).toContain('class="plan-dims" x="460" y="38"');
    // 3 m wide (150 px between the margins): the size drops under the title.
    const narrow = makeLayout({ width: 3, height: 6, floors: [floor] });
    const stacked = layoutToSvg(narrow, makeFloor());
    expect(stacked).toContain('class="plan-title" x="60" y="30" font-size="14" font-weight="bold" fill="#333333">My Home — Ground Floor</text>');
    expect(stacked).toContain('class="plan-dims" x="210" y="48"');
    // A name too long even for its own line is cut with an ellipsis; the <title> keeps it whole.
    const name = 'A very long project name for the family house in the countryside, second revision';
    const long = layoutToSvg(makeLayout({ name, width: 3, height: 6, floors: [floor] }), makeFloor());
    const shown = /class="plan-title"[^>]*>([^<]*)<\/text>/.exec(long)![1]!;
    expect(shown.endsWith('…')).toBe(true);
    // Fits the 202 px from the left margin to 8 px short of the sheet edge, at ≤ 0.62 em per bold char.
    expect([...shown].length * 14 * 0.62).toBeLessThanOrEqual(202);
    expect(long).toContain(`<title>${name} — Ground Floor</title>`);
  });

  it('frames an explicit content bounds in place of the floor’s own (#405)', () => {
    const { layout, floor } = makeFixture();
    const bounds = { minX: -6, minZ: -4, maxX: 4, maxZ: 5 };
    const svg = layoutToSvg(layout, floor, { bounds });
    // 10 × 9 m + 1.2 m margins at 50 px/m; the room shifts right by the 2 m west of it.
    expect(svg).toContain('viewBox="0 0 620 570"');
    expect(svg).toContain('<g class="plan" transform="translate(100 0)">');
    expect(planSheetSize(layout, floor, { bounds })).toEqual({ widthPx: 620, heightPx: 570, widthM: 12.4, heightM: 11.4 });
    // No override: unchanged.
    expect(planSheetSize(layout, floor)).toEqual({ widthPx: 520, heightPx: 520, widthM: 10.4, heightM: 10.4 });
  });
});

describe('outward coverage (#420)', () => {
  // A 30 m camera on the outside of the south wall, facing the garden.
  const outward = makeItem({ id: 'co', type: 'security-camera', name: 'Cam', width: 0.25, depth: 0.2, position: { x: 0, z: 4.12 }, rotation: 0, hasVisionCone: true, visionRange: 30, visionFov: 103 });
  const floor = makeFloor({ items: [outward] });
  const layout = makeLayout({ floors: [floor] });

  it('shows an outward camera’s wedge, capped 5 m past the content, symmetric about the house', () => {
    const svg = layoutToSvg(layout, floor);
    expect(count(svg, 'class="vision"')).toBe(1);
    // Content: the room plus the camera body (to z 4.22); the frame adds 5 m
    // south and 5 m east and west (the wedge is wider than that), none north.
    const clip = /<clipPath id="coverage-clip"><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"\/>/.exec(svg)!;
    const [x, y, w, h] = clip.slice(1).map(Number);
    expect(x).toBe(60 - 250);
    expect(y).toBe(60);
    expect(w).toBe(400 + 500);
    expect(h).toBeCloseTo(400 + 0.22 * 50 + 250, 0);
    // The room sits centred across the sheet's width.
    expect(svg).toContain('<g class="plan" transform="translate(250 0)">');
  });

  it('frames all of it with coverage: full', () => {
    const svg = layoutToSvg(layout, floor, { coverage: 'full' });
    const h = Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)![1]);
    // 30 m below a camera at z 4.12 → the sheet reaches z ≈ 34.1.
    expect(h).toBeCloseTo((34.12 + 4) * 50 + 120, -1);
  });

  it('lets the caller prefix element ids so sheets can share a page', () => {
    const svg = layoutToSvg(layout, floor, { idPrefix: 'sheet1-' });
    expect(svg).toContain('<clipPath id="sheet1-coverage-clip">');
    expect(svg).toContain('url(#sheet1-coverage-clip)');
    expect(svg).not.toContain('id="coverage-clip"');
  });
});

describe('buildingToSvg', () => {
  it('stacks every floor at one scale, aligned on the building’s bounds (#405)', () => {
    const tree = makeItem({ id: 'tree', type: 'tree', name: 'Oak Tree', width: 1.4, depth: 1.4, position: { x: 6.7, z: 0 } });
    const ground = makeFloor({ id: 'g', items: [tree] });
    const first = makeFloor({ id: 'f', name: 'First Floor' });
    const layout = makeLayout({ floors: [ground, first] });
    const svg = buildingToSvg(layout);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(count(svg, 'class="floor-sheet"')).toBe(2);
    expect(count(svg, 'class="sheet-break"')).toBe(1);
    // Both sheets frame x −4 … 7.4 (the ground floor's tree): 11.4 + 2.4 m wide, 10.4 m tall.
    expect(svg).toContain('viewBox="0 0 690 1040"');
    expect(svg).toContain('<g class="floor-sheet" data-floor="g" transform="translate(0 0)">');
    expect(svg).toContain('<g class="floor-sheet" data-floor="f" transform="translate(0 520)">');
    // The room sits at the same place on both sheets.
    expect(count(svg, '<g class="plan" transform="translate(0 0)">')).toBe(2);
    expect(svg).toContain('My Home — Ground Floor');
    expect(svg).toContain('My Home — First Floor');
    expect(svg).not.toContain('NaN');
  });

  it('keeps element ids unique across sheets', () => {
    const ap = makeItem({ id: 'ap', type: 'wifi', name: 'AP', position: { x: 0, z: 0 }, isWiFiAccessPoint: true, signalRange: 4 });
    const layout = makeLayout({ floors: [makeFloor({ id: 'g', items: [ap] }), makeFloor({ id: 'f', items: [{ ...ap, id: 'ap2' }] })] });
    const svg = buildingToSvg(layout);
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['f0-coverage-clip', 'f1-coverage-clip']);
    expect(svg).toContain('url(#f1-coverage-clip)');
  });
});

// The print popup inlines this SVG into a document.write, so it must never
// carry user text raw — in an element or in an attribute (#455).
describe('SVG escaping of user text (#455)', () => {
  const SCRIPT = '<script>alert(1)</script>';
  const ATTR = '" onmouseover="alert(1)';
  const floor = (id: string) =>
    makeFloor({
      id: `${id}${ATTR}`,
      name: ATTR,
      floorColor: ATTR,
      items: [makeItem({ id: `${id}-a`, type: SCRIPT, name: SCRIPT, color: ATTR }), makeItem({ id: `${id}-b`, name: ATTR, position: { x: 1, z: 1 } })],
      zones: [{ id: `${id}-z`, name: SCRIPT, color: ATTR, x: -3, z: -3, w: 4, d: 4 }],
    });
  const layout = makeLayout({ name: SCRIPT, floors: [floor('g'), floor('f')] });

  it.each([
    ['one floor', () => layoutToSvg(layout, layout.floors[0]!, { schedule: true })],
    ['the whole building', () => buildingToSvg(layout, { schedule: true })],
  ])('escapes names, ids and colours in %s', (_label, render) => {
    const svg = render();
    expect(svg).not.toContain(SCRIPT);
    expect(svg).not.toContain(ATTR);
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(svg).toContain('&quot; onmouseover=&quot;alert(1)');
  });
});
