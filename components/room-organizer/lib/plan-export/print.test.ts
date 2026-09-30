// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../__testfixtures__/fixtures';
import { openPlanPrintWindow, pickPrintScale, printPxPerMetre, printScaleLabel } from './print';

describe('pickPrintScale', () => {
  it('picks the finest standard scale that fits A4 portrait', () => {
    // 3 m + 2 × 15 mm margins = 180 mm: exactly the portrait width at 1:20.
    expect(pickPrintScale(3, 3)).toEqual({ denominator: 20, orientation: 'portrait', fits: true });
    // Default 8 m room: 190 mm at 1:50 overflows both orientations; 1:75 fits.
    expect(pickPrintScale(8, 8)).toEqual({ denominator: 75, orientation: 'portrait', fits: true });
  });

  it('tries landscape before the next coarser scale (#288)', () => {
    // 20 × 6 m: 230 × 90 mm at 1:100 misses portrait width but fits landscape,
    // so 1:100 landscape wins over 1:200 portrait.
    expect(pickPrintScale(20, 6)).toEqual({ denominator: 100, orientation: 'landscape', fits: true });
    // The 40 × 30 m lot from the issue: 230 × 180 mm at 1:200 fits neither
    // way; 1:250 landscape does (190 × 150 mm).
    expect(pickPrintScale(40, 30)).toEqual({ denominator: 250, orientation: 'landscape', fits: true });
  });

  it('extends past 1:200 for big lots instead of overflowing the page (#288)', () => {
    expect(pickPrintScale(60, 60)).toEqual({ denominator: 500, orientation: 'portrait', fits: true });
  });

  it('reports a non-fit rather than claiming a scale (#288)', () => {
    const scale = pickPrintScale(300, 300);
    expect(scale).toEqual({ denominator: 1000, orientation: 'landscape', fits: false });
    expect(printScaleLabel(scale)).toMatch(/^Not to scale/);
    expect(printScaleLabel(pickPrintScale(8, 8))).toBe('1:75 (A4 portrait)');
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

describe('openPlanPrintWindow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function openAndCapture(width: number, height: number, items = [makeItem()]): string {
    const floor = makeFloor({ items });
    const layout = makeLayout({ width, height, floors: [floor] });
    let html = '';
    const fakeWindow = { document: { write: (markup: string) => (html += markup), close: () => undefined } };
    vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
    openPlanPrintWindow(layout, floor);
    return html;
  }

  it('declares the chosen scale and orientation and sizes the plan to it', () => {
    const html = openAndCapture(8, 8);
    expect(html).toContain('1:75 (A4 portrait)');
    expect(html).toContain('@page { size: A4 portrait;');
    // 8 m at 1:75 is 106.7 mm plus 2 × 15 mm margins.
    expect(html).toContain('.plan { width: 136.7mm; }');
    // The SVG is emitted in paper px: 53.33 px/m × 8 m + 120 px margins.
    expect(html).toContain('viewBox="0 0 546.67 546.67"');
  });

  it('switches to landscape for a wide lot instead of overflowing A4 (#288)', () => {
    const html = openAndCapture(40, 30);
    expect(html).toContain('1:250 (A4 landscape)');
    expect(html).toContain('@page { size: A4 landscape;');
    expect(html).toContain('.plan { width: 190.0mm; }');
  });

  it('sizes the sheet from the plan content so garden items are printed (#287)', () => {
    // Oak tree 2 m south of the wall: content is 8 × 11.4 m, not 8 × 8.
    const tree = makeItem({ id: 'tree', type: 'tree', name: 'Oak Tree', width: 1.4, depth: 1.4, position: { x: 0, z: 6.7 } });
    const html = openAndCapture(8, 8, [makeItem(), tree]);
    // 11.4 m at 1:75 is 152 mm + 30 mm margins = 182 mm: still inside the
    // 230 mm portrait height, so the scale holds and the sheet grows.
    expect(html).toContain('1:75 (A4 portrait)');
    expect(html).toContain('viewBox="0 0 546.67 728"');
    expect(html).toContain('>Oak Tree</text>');
    // The same tree 8 m from the wall (content 16.7 m → 253 mm) tips it to 1:100.
    const farTree = { ...tree, position: { x: 0, z: 12 } };
    expect(openAndCapture(8, 8, [makeItem(), farTree])).toContain('1:100 (A4 portrait)');
  });

  it('says so when nothing fits and lets the page shrink the plan', () => {
    const html = openAndCapture(300, 300);
    expect(html).toContain('Not to scale');
    expect(html).toContain('.plan { width: 100%; }');
  });
});
