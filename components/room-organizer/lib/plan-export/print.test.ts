// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from '../__testfixtures__/fixtures';
import {
  buildPrintDocument,
  distanceOutsideWalls,
  openPlanPrintWindow,
  pickPrintScale,
  printableArea,
  printedFloor,
  printPxPerMetre,
  printScaleLabel,
  resolvePrintScale,
} from './print';
import type { FurnitureItem } from '../types';

describe('pickPrintScale', () => {
  it('picks the finest standard scale that fits A4 portrait', () => {
    // 3 m + 2 × 15 mm margins = 180 mm: exactly the portrait width at 1:20.
    expect(pickPrintScale(3, 3)).toEqual({ denominator: 20, orientation: 'portrait', paper: 'A4', fits: true });
    // Default 8 m room: 190 mm at 1:50 overflows both orientations; 1:75 fits.
    expect(pickPrintScale(8, 8)).toEqual({ denominator: 75, orientation: 'portrait', paper: 'A4', fits: true });
  });

  it('tries landscape before the next coarser scale (#288)', () => {
    // 20 × 6 m: 230 × 90 mm at 1:100 misses portrait width but fits landscape,
    // so 1:100 landscape wins over 1:200 portrait.
    expect(pickPrintScale(20, 6)).toMatchObject({ denominator: 100, orientation: 'landscape', fits: true });
    // The 40 × 30 m lot from the issue: 230 × 180 mm at 1:200 fits neither
    // way; 1:250 landscape does (190 × 150 mm).
    expect(pickPrintScale(40, 30)).toMatchObject({ denominator: 250, orientation: 'landscape', fits: true });
  });

  it('extends past 1:200 for big lots instead of overflowing the page (#288)', () => {
    expect(pickPrintScale(60, 60)).toMatchObject({ denominator: 500, orientation: 'portrait', fits: true });
  });

  it('reports a non-fit rather than claiming a scale, on the page that shrinks it least (#288)', () => {
    // 330 mm square at 1:1000: portrait (180 × 230) shrinks it less than landscape (265 × 150).
    const scale = pickPrintScale(300, 300);
    expect(scale).toEqual({ denominator: 1000, orientation: 'portrait', paper: 'A4', fits: false });
    expect(printScaleLabel(scale)).toBe('Not to scale — exceeds A4 at 1:1000, shrunk to fit');
    expect(printScaleLabel(pickPrintScale(8, 8))).toBe('1:75 (A4 portrait)');
  });

  it('uses the chosen paper size (#435)', () => {
    // A3 portrait leaves 267 × 353 mm: the 8 m room fits at 1:50 (190 mm).
    expect(pickPrintScale(8, 8, { paper: 'A3' })).toEqual({ denominator: 50, orientation: 'portrait', paper: 'A3', fits: true });
    // Letter portrait is 185.9 mm wide: 1:50 misses by 4 mm, 1:75 fits.
    expect(printScaleLabel(pickPrintScale(8, 8, { paper: 'Letter' }))).toBe('1:75 (Letter portrait)');
  });

  it('honours a fixed orientation (#435)', () => {
    expect(pickPrintScale(8, 8, { orientation: 'landscape' })).toMatchObject({ denominator: 75, orientation: 'landscape', fits: true });
    // 20 × 6 m in portrait only: 1:100 (230 mm) and 1:125 (190 mm) are too wide for 180 mm.
    expect(pickPrintScale(20, 6, { orientation: 'portrait' })).toMatchObject({ denominator: 200, orientation: 'portrait' });
  });

  it('honours a fixed scale and says when it does not fit the page (#435)', () => {
    expect(pickPrintScale(8, 8, { denominator: 100 })).toEqual({ denominator: 100, orientation: 'portrait', paper: 'A4', fits: true });
    const tooFine = pickPrintScale(8, 8, { denominator: 20 });
    expect(tooFine).toEqual({ denominator: 20, orientation: 'portrait', paper: 'A4', fits: false });
    expect(printScaleLabel(tooFine)).toBe('Not to scale — exceeds A4 at 1:20, shrunk to fit');
    // The same scale on A3 landscape (388 × 237 mm) still overflows the 430 mm sheet.
    expect(pickPrintScale(8, 8, { denominator: 20, paper: 'A3' })).toMatchObject({ fits: false, orientation: 'portrait' });
  });
});

describe('printableArea', () => {
  it('keeps the A4 plan area the route always used and derives the rest the same way', () => {
    expect(printableArea('A4', 'portrait')).toEqual({ width: 180, height: 230 });
    expect(printableArea('A4', 'landscape')).toEqual({ width: 265, height: 150 });
    expect(printableArea('A3', 'landscape')).toEqual({ width: 388, height: 237 });
    const letter = printableArea('Letter', 'portrait');
    expect(letter.width).toBeCloseTo(185.9, 6);
    expect(letter.height).toBeCloseTo(212.4, 6);
  });
});

describe('printPxPerMetre', () => {
  it('keeps one SVG px at 0.25 mm on paper at every scale (#288)', () => {
    // 1 m at 1:50 is 20 mm = 80 px; at 1:200 it is 5 mm = 20 px.
    expect(printPxPerMetre(50)).toBe(80);
    expect(printPxPerMetre(200)).toBe(20);
    // A 10 px label is therefore 2.5 mm tall whatever the denominator.
    for (const denominator of [20, 100, 1000]) {
      const mmPerPx = 1000 / denominator / printPxPerMetre(denominator);
      expect(10 * mmPerPx).toBeCloseTo(2.5, 10);
    }
  });
});

const tree = (overrides: Partial<FurnitureItem> = {}): FurnitureItem =>
  makeItem({ id: 'tree', type: 'tree', name: 'Oak Tree', width: 1.4, depth: 1.4, position: { x: 0, z: 6.7 }, ...overrides });

describe('printedFloor (#435)', () => {
  it('drops only the items whose centre is outside the walls', () => {
    const door = makeItem({ id: 'door', type: 'door', name: 'Door', width: 0.9, depth: 0.1, position: { x: 0, z: 4.04 } });
    const camera = makeItem({ id: 'cam', type: 'security-camera', name: 'Camera', position: { x: 4.06, z: 0 } });
    const edge = makeItem({ id: 'edge', position: { x: 4.03, z: 0 } });
    const floor = makeFloor({ items: [makeItem(), tree(), door, camera, edge] });
    const layout = makeLayout({ floors: [floor] });
    expect(printedFloor(layout, floor, true)).toBe(floor);
    expect(printedFloor(layout, floor, false).items.map((item) => item.id)).toEqual(['item-1', 'door', 'cam', 'edge']);
    // Nothing outside: the same floor object, not a copy.
    const indoor = makeFloor({ items: [makeItem()] });
    expect(printedFloor(layout, indoor, false)).toBe(indoor);
  });
});

describe('distanceOutsideWalls', () => {
  it('measures how far a centre is past the walls, 0 for kept items', () => {
    const layout = makeLayout();
    expect(distanceOutsideWalls(layout, makeItem())).toBe(0);
    expect(distanceOutsideWalls(layout, tree())).toBeCloseTo(2.7, 9);
    expect(distanceOutsideWalls(layout, tree({ position: { x: 40, z: -5 } }))).toBeCloseTo(36, 9);
    expect(distanceOutsideWalls(layout, makeItem({ position: { x: 4.04, z: 0 } }))).toBe(0);
    expect(distanceOutsideWalls(layout, makeItem({ type: 'window', position: { x: 4.5, z: 0 } }))).toBe(0);
    expect(distanceOutsideWalls(layout, makeUnplacedItem())).toBe(0);
  });
});

describe('buildPrintDocument', () => {
  function build(width: number, height: number, items = [makeItem()], options = {}): string {
    const floor = makeFloor({ items });
    const layout = makeLayout({ width, height, floors: [floor] });
    return buildPrintDocument(layout, floor, options, '1/1/2026');
  }

  it('declares the chosen scale and orientation and sizes the plan to it', () => {
    const html = build(8, 8);
    expect(html).toContain('1:75 (A4 portrait)');
    expect(html).toContain('@page { size: A4 portrait;');
    // 8 m at 1:75 is 106.7 mm plus 2 × 15 mm margins.
    expect(html).toContain('<div class="plan" style="width: 136.7mm;">');
    // The SVG is emitted in paper px: 53.33 px/m × 8 m + 120 px margins.
    expect(html).toContain('viewBox="0 0 546.67 546.67"');
  });

  it('switches to landscape for a wide lot instead of overflowing A4 (#288)', () => {
    const html = build(40, 30);
    expect(html).toContain('1:250 (A4 landscape)');
    expect(html).toContain('@page { size: A4 landscape;');
    expect(html).toContain('style="width: 190.0mm;"');
  });

  it('sizes the sheet from the plan content so garden items are printed (#287)', () => {
    // Oak tree 2 m south of the wall: content is 8 × 11.4 m, not 8 × 8.
    const html = build(8, 8, [makeItem(), tree()]);
    // 11.4 m at 1:75 is 152 mm + 30 mm margins = 182 mm: still inside the
    // 230 mm portrait height, so the scale holds and the sheet grows.
    expect(html).toContain('1:75 (A4 portrait)');
    expect(html).toContain('viewBox="0 0 546.67 728"');
    expect(html).toContain('>Oak Tree</text>');
    // The same tree 8 m from the wall (content 16.7 m → 253 mm) tips it to 1:100.
    expect(build(8, 8, [makeItem(), tree({ position: { x: 0, z: 12 } })])).toContain('1:100 (A4 portrait)');
  });

  it('shrinks an outsized plan to fit the page in both directions and says so', () => {
    const html = build(300, 300);
    expect(html).toContain('Not to scale');
    // The 330 mm sheet scaled to the 180 mm portrait width.
    expect(html).toContain('style="width: 180.0mm;"');
  });

  it('prints on the chosen paper, orientation and scale (#435)', () => {
    const a3 = build(8, 8, [makeItem()], { paper: 'A3', orientation: 'landscape', denominator: 100 });
    expect(a3).toContain('@page { size: A3 landscape;');
    expect(a3).toContain('1:100 (A3 landscape)');
    // 8 m at 1:100 = 80 mm + 30 mm.
    expect(a3).toContain('style="width: 110.0mm;"');
    expect(build(8, 8, [makeItem()], { paper: 'Letter' })).toContain('@page { size: Letter portrait;');
  });

  it('leaves far outdoor items off when asked, so the house keeps its scale (#435)', () => {
    const far = tree({ id: 'pine', name: 'Pine Tree', position: { x: 24, z: 0 } });
    const withTree = build(8, 8, [makeItem(), far]);
    expect(withTree).toContain('1:125 (A4 landscape)');
    expect(withTree).toContain('>Pine Tree</text>');
    const without = build(8, 8, [makeItem(), far], { includeOutdoor: false });
    expect(without).toContain('1:75 (A4 portrait)');
    expect(without).not.toContain('Pine Tree');
    expect(without).toContain('1 item (1 outside the walls left off)');
  });

  it('lists the printed items under the title block only when asked (#424)', () => {
    const items = [
      makeItem({ id: 'a', name: 'Chair', price: 40 }),
      makeItem({ id: 'b', name: 'Chair', price: 40, position: { x: 1, z: 1 } }),
      makeItem({ id: 'c', name: 'Sofa <3', width: 2, depth: 0.9, height: 0.8, price: 1200.5, position: { x: -2, z: 0 } }),
    ];
    expect(build(8, 8, items)).not.toContain('class="schedule"');
    const html = build(8, 8, items, { schedule: true });
    expect(html).toContain('<p class="schedule-title">Item schedule</p>');
    expect(html).toContain('<td class="n">2</td><td class="n">$80</td>');
    // Escaped, and sized in metres.
    expect(html).toContain('<td>Sofa &lt;3</td><td>2 × 0.9 × 0.8</td>');
    expect(html).toContain('<tr class="total"><td>Total</td><td></td><td class="n">3</td><td class="n">$1,281</td></tr>');
    // No footer group: Chrome would repeat it on every page.
    expect(html).not.toContain('<tfoot');
    // Two lines and the total are one unbreakable block.
    expect(html.match(/class="schedule-rows"/g)).toHaveLength(1);
    // The plan's scale is untouched by the table.
    expect(html).toContain('1:75 (A4 portrait)');
  });

  it('keeps the title, headings and first rows together and ends with the total (#424)', () => {
    const items = Array.from({ length: 12 }, (_, i) => makeItem({ id: `t${i}`, name: `Thing ${String(i).padStart(2, '0')}`, position: { x: -3 + (i % 4), z: -3 + Math.floor(i / 4) } }));
    const html = build(8, 8, items, { schedule: true });
    const start = html.slice(html.indexOf('<div class="schedule-start">'), html.indexOf('</div>', html.indexOf('<div class="schedule-start">')));
    expect(start).toContain('<th>Item</th>');
    expect(start.match(/<tr><td>/g)).toHaveLength(3);
    const tables = html.match(/<table class="schedule-rows">/g);
    expect(tables).toHaveLength(2);
    // The total is the last row of the last table.
    expect(html).toMatch(/<tr class="total">[^]*?<\/tr><\/tbody><\/table>\s*<\/div>/);
    expect(html).toContain('<td>Thing 11</td>');
  });

  it('leaves items off the schedule that are left off the plan (#424)', () => {
    const far = tree({ id: 'pine', name: 'Pine Tree', position: { x: 24, z: 0 } });
    const html = build(8, 8, [makeItem(), far], { includeOutdoor: false, schedule: true });
    expect(html).toContain('<p class="schedule-title">Item schedule</p>');
    expect(html).not.toContain('Pine Tree');
    // An empty floor prints no table at all.
    expect(build(8, 8, [], { schedule: true })).not.toContain('class="schedule"');
  });

  it('counts only placed items in the left-off tally', () => {
    const far = tree({ id: 'pine', position: { x: 24, z: 0 } });
    const html = build(8, 8, [makeItem(), makeUnplacedItem({ id: 'stored' }), far], { includeOutdoor: false });
    expect(html).toContain('1 item (1 outside the walls left off)');
  });

  it('keeps the scale with a 200-character name the title block cannot break at spaces', () => {
    const floor = makeFloor({ items: [makeItem()] });
    const html = buildPrintDocument(makeLayout({ name: 'X'.repeat(200), floors: [floor] }), floor, {}, 'd');
    // The cells wrap anywhere inside a fixed-layout table, so the table can't
    // outgrow the page and make the browser shrink the sheet off its scale.
    expect(html).toContain('table-layout: fixed;');
    expect(html).toContain('overflow-wrap: anywhere;');
    expect(html).toContain('<colgroup>');
    expect(html).toContain('1:75 (A4 portrait)');
    expect(html).toContain('<div class="plan" style="width: 136.7mm;">');
  });

  it('prints every floor on its own page at one shared scale (#405)', () => {
    const ground = makeFloor({ id: 'ground', name: 'Ground Floor', items: [makeItem(), tree({ position: { x: 0, z: 12 } })] });
    const upper = makeFloor({ id: 'upper', name: 'First Floor', items: [makeItem({ id: 'bed' })] });
    const layout = makeLayout({ floors: [ground, upper] });
    // The upper floor alone prints at 1:75.
    expect(buildPrintDocument(layout, upper, {}, 'd')).toContain('1:75 (A4 portrait)');
    const html = buildPrintDocument(layout, upper, { allFloors: true }, 'd');
    expect(html.match(/<section class="sheet">/g)).toHaveLength(2);
    expect(html).toContain('<title>My Home — All floors — Floor plan</title>');
    expect(html).toContain('Ground Floor (1 of 2)');
    expect(html).toContain('First Floor (2 of 2)');
    // Both sheets at the ground floor's 1:100, and both frame the union of
    // the floors' content: same sheet size, the room at the same place, so
    // the pages line up even though only the ground floor has the tree.
    expect(html.match(/1:100 \(A4 portrait\)/g)).toHaveLength(2);
    const viewBoxes = [...html.matchAll(/viewBox="([^"]+)"/g)].map((m) => m[1]);
    expect(viewBoxes).toHaveLength(2);
    expect(viewBoxes[0]).toBe(viewBoxes[1]);
    const rooms = [...html.matchAll(/<g class="plan" transform="([^"]+)"/g)].map((m) => m[1]);
    expect(rooms).toEqual([rooms[0], rooms[0]]);
    // 8 m wide at 40 px/m + 2 × 60 px; the tree takes the content to z 12.7.
    expect(viewBoxes[0]).toBe('0 0 440 788');
    expect(html).toContain('.sheet + .sheet { break-before: page; }');
    expect(resolvePrintScale(layout, upper, { allFloors: true })).toMatchObject({ denominator: 100 });
  });

  it('keeps the sheet tight: coverage never coarsens the print scale, it is clipped to the plan (#420)', () => {
    const sofa = makeItem({ id: 's', type: 'sofa', name: 'Sofa', width: 2, depth: 0.9, position: { x: -1, z: 1 } });
    const ap = (signalRange: number) =>
      makeItem({ id: 'ap', type: 'wifi', name: 'Wi-Fi AP', width: 0.2, depth: 0.2, position: { x: -2, z: -2 }, isWiFiAccessPoint: true, signalRange });
    for (const items of [[sofa], [sofa, ap(6)], [sofa, ap(10)]]) {
      const floor = makeFloor({ items });
      const layout = makeLayout({ floors: [floor] });
      for (const includeOutdoor of [true, false]) {
        expect(resolvePrintScale(layout, floor, { includeOutdoor })).toMatchObject({ denominator: 75, paper: 'A4', orientation: 'portrait' });
      }
    }
    // The rings are clipped to the 8 m plan: 8 m at 1:75 + the margins.
    const floor = makeFloor({ items: [sofa, ap(10)] });
    const html = buildPrintDocument(makeLayout({ floors: [floor] }), floor, {}, 'd');
    expect(html).toContain('class="wifi-ring"');
    const clip = /<clipPath id="sheet0-coverage-clip"><rect x="60" y="60" width="([\d.]+)" height="([\d.]+)"\/>/.exec(html)!;
    expect(clip[1]).toBe(clip[2]);
    expect(html).toContain('<g class="plan" transform="translate(0 0)">');
  });

  it('gives each sheet its own clip-path id, so a page of sheets clips each by its own frame', () => {
    const ap = makeItem({ id: 'ap', type: 'wifi', name: 'AP', width: 0.2, depth: 0.2, position: { x: 0, z: 0 }, isWiFiAccessPoint: true, signalRange: 6 });
    const layout = makeLayout({ floors: [makeFloor({ id: 'g', items: [ap] }), makeFloor({ id: 'f', name: 'First Floor', items: [{ ...ap, id: 'ap2' }] })] });
    const html = buildPrintDocument(layout, layout.floors[0]!, { allFloors: true }, 'd');
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['sheet0-coverage-clip', 'sheet1-coverage-clip']);
    expect(html).toContain('clip-path="url(#sheet1-coverage-clip)"');
  });

  it('escapes the project name in the title block', () => {
    const floor = makeFloor();
    const html = buildPrintDocument(makeLayout({ name: '<b>Home</b>', floors: [floor] }), floor, {}, 'd');
    expect(html).toContain('&lt;b&gt;Home&lt;/b&gt;');
    expect(html).not.toContain('<b>Home</b>');
  });
});

describe('openPlanPrintWindow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the print document into the popup', () => {
    const floor = makeFloor({ items: [makeItem()] });
    const layout = makeLayout({ floors: [floor] });
    let html = '';
    const fakeWindow = { document: { write: (markup: string) => (html += markup), close: () => undefined } };
    vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
    openPlanPrintWindow(layout, floor, { paper: 'A3' });
    expect(html).toContain('@page { size: A3 portrait;');
    expect(html).toContain('window.print()');
  });

  it('alerts instead of throwing when pop-ups are blocked', () => {
    const floor = makeFloor();
    vi.spyOn(window, 'open').mockReturnValue(null);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    openPlanPrintWindow(makeLayout({ floors: [floor] }), floor);
    expect(alert).toHaveBeenCalledOnce();
  });
});
