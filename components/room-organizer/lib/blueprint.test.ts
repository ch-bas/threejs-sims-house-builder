// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { blueprintCanvasSize, blueprintPlan, floorArea, openBlueprintPrintWindow } from './blueprint';

// jsdom has no 2D canvas: the render is a no-op (null context) and toDataURL
// is stubbed. What matters here is the popup / decode / write sequencing.
const decodeCalls: string[] = [];
let releaseDecode: () => void = () => undefined;

vi.mock('../canvas-2d/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../canvas-2d/render')>();
  return {
    ...actual,
    ensureFloorPlanImageDecoded: (url: string) => {
      decodeCalls.push(url);
      return new Promise<void>((resolve) => {
        releaseDecode = resolve;
      });
    },
  };
});

describe('openBlueprintPrintWindow (#288)', () => {
  const events: string[] = [];
  const fakeWindow = {
    document: {
      write: (html: string) => events.push(`write:${html.includes('data:image/png;base64,STUB') ? 'plan' : 'other'}`),
      close: () => events.push('close'),
      readyState: 'loading',
    },
    // Printing is armed from the opener after the write (#445).
    addEventListener: (type: string) => events.push(`listen:${type}`),
  };

  beforeEach(() => {
    events.length = 0;
    decodeCalls.length = 0;
    vi.spyOn(window, 'open').mockImplementation(() => {
      events.push('open');
      return fakeWindow as unknown as Window;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,STUB');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the popup inside the gesture, then waits for the tracing image before writing', async () => {
    const floor = makeFloor({ items: [makeItem()] });
    const layout = makeLayout({ floors: [floor], floorPlanImage: 'data:image/png;base64,PLAN' });
    const done = openBlueprintPrintWindow(layout, floor);
    // Synchronously: popup open, decode requested, nothing written yet.
    expect(events).toEqual(['open']);
    expect(decodeCalls).toEqual(['data:image/png;base64,PLAN']);
    releaseDecode();
    await done;
    expect(events).toEqual(['open', 'write:plan', 'close', 'listen:load']);
  });

  it('does not wait for a decode on upper floors, which never show the image', async () => {
    const ground = makeFloor({ id: 'ground', items: [makeItem()] });
    const upper = makeFloor({ id: 'first', name: 'First Floor', items: [makeItem()] });
    const layout = makeLayout({ floors: [ground, upper], floorPlanImage: 'data:image/png;base64,PLAN' });
    await openBlueprintPrintWindow(layout, upper);
    expect(decodeCalls).toEqual([]);
    expect(events).toEqual(['open', 'write:plan', 'close', 'listen:load']);
  });

  it('skips the decode when the layout has no tracing image', async () => {
    const floor = makeFloor({ items: [makeItem()] });
    await openBlueprintPrintWindow(makeLayout({ floors: [floor] }), floor);
    expect(decodeCalls).toEqual([]);
    expect(events).toEqual(['open', 'write:plan', 'close', 'listen:load']);
  });
});

describe('floorArea (#285)', () => {
  it('is the footprint less the entrance porch on the storey it opens onto', () => {
    const ground = makeFloor({ id: 'ground' });
    const upper = makeFloor({ id: 'upper' });
    const plain = makeLayout({ floors: [ground, upper] });
    expect(floorArea(plain, 0)).toBe(64);
    const porch = makeLayout({ floors: [ground, upper], entrance: { width: 1.4, depth: 1.2 } });
    expect(floorArea(porch, 0)).toBeCloseTo(64 - 1.4 * 1.2);
    expect(floorArea(porch, 1)).toBe(64);
    // A recess that doesn't fit the house is fitted first, like the 3D build.
    const shallow = makeLayout({ height: 2, floors: [ground], entrance: { width: 1.4, depth: 3 } });
    expect(floorArea(shallow, 0)).toBeCloseTo(16 - 1.4 * 1);
  });
});

describe('blueprintCanvasSize (#377)', () => {
  it('fits the room-only plan into the old 1200 × 900 box', () => {
    // 8 m square: 780 px of plan + 2 × 60 px padding, the same plan size as before.
    expect(blueprintCanvasSize({ minX: -4, minZ: -4, maxX: 4, maxZ: 4 })).toEqual({ width: 900, height: 900 });
  });

  it('grows with content past the walls so outdoor items stay on the sheet', () => {
    // An oak at x = 7.5 (footprint to 8.2): 12.2 m wide content fills the width.
    expect(blueprintCanvasSize({ minX: -4, minZ: -4, maxX: 8.2, maxZ: 4 })).toEqual({ width: 1200, height: 828 });
  });
});

describe('openBlueprintPrintWindow content fit (#377)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sizes the canvas from the plan content, outdoor items included', async () => {
    const sizes: Array<[number, number]> = [];
    vi.spyOn(window, 'open').mockReturnValue({ document: { write: () => undefined, close: () => undefined }, addEventListener: () => undefined } as unknown as Window);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
      sizes.push([this.width, this.height]);
      return 'data:image/png;base64,STUB';
    });
    const tree = makeItem({ id: 'tree', type: 'tree', name: 'Oak Tree', width: 1.4, depth: 1.4, position: { x: 7.5, z: 3 } });
    const floor = makeFloor({ items: [makeItem(), tree] });
    await openBlueprintPrintWindow(makeLayout({ floors: [floor] }), floor);
    expect(sizes).toEqual([[1200, 828]]);
  });
});

describe('blueprintPlan (#377)', () => {
  const oak = makeItem({ id: 'oak', type: 'tree', name: 'Oak Tree', width: 1.4, depth: 1.4, position: { x: 7.5, z: 3 } });
  const pine = (x: number) => makeItem({ id: 'pine', type: 'pine-tree', name: 'Pine Tree', width: 1.1, depth: 1.1, position: { x, z: 0 } });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws outdoor items that leave the house readable', () => {
    const floor = makeFloor({ items: [makeItem(), oak, pine(14)] });
    const plan = blueprintPlan(makeLayout({ floors: [floor] }), floor);
    expect(plan.floor).toBe(floor);
    expect(plan.omitted).toEqual([]);
  });

  it('leaves off only the far items that would shrink the house past half its size', () => {
    for (const x of [24, 40]) {
      const floor = makeFloor({ items: [makeItem(), oak, pine(x)] });
      const plan = blueprintPlan(makeLayout({ floors: [floor] }), floor);
      expect(plan.floor.items.map((item) => item.id)).toEqual(['item-1', 'oak']);
      expect(plan.omitted.map(({ item, distance }) => [item.id, distance])).toEqual([['pine', x - 4]]);
    }
  });

  it('lists the left-off items on the sheet', async () => {
    let html = '';
    vi.spyOn(window, 'open').mockReturnValue({ document: { write: (m: string) => (html += m), close: () => undefined }, addEventListener: () => undefined } as unknown as Window);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,STUB');
    const floor = makeFloor({ items: [makeItem(), pine(40)] });
    await openBlueprintPrintWindow(makeLayout({ floors: [floor] }), floor);
    expect(html).toContain('Off the plan (too far out to draw)');
    expect(html).toContain('Pine Tree: 36.0 m outside the walls');
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});

// The popup is written with document.write, so any user text that reached it
// unescaped would run in a window the app opened (#455).
describe('openBlueprintPrintWindow escaping (#455)', () => {
  const SCRIPT = '<script>alert(1)</script>';
  const ATTR = '" onmouseover="alert(1)';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escapes the house, floor, zone and left-off item names and icons', async () => {
    let html = '';
    vi.spyOn(window, 'open').mockReturnValue({ document: { write: (m: string) => (html += m), close: () => undefined } } as unknown as Window);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,STUB');
    const far = makeItem({ id: 'far', type: 'tree', name: SCRIPT, icon: ATTR, position: { x: 40, z: 0 } });
    const floor = makeFloor({
      name: ATTR,
      items: [makeItem(), far],
      zones: [{ id: 'z', name: SCRIPT, color: '#f00', x: -2, z: -2, w: 4, d: 4 }],
    });
    await openBlueprintPrintWindow(makeLayout({ name: SCRIPT, floors: [floor] }), floor);
    expect(html).toContain('Off the plan');
    expect(html).not.toContain(SCRIPT);
    expect(html).not.toContain(ATTR);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot; onmouseover=&quot;alert(1)');
  });
});
