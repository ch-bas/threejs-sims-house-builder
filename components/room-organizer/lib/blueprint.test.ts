// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { floorArea, openBlueprintPrintWindow } from './blueprint';

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
    },
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
    expect(events).toEqual(['open', 'write:plan', 'close']);
  });

  it('does not wait for a decode on upper floors, which never show the image', async () => {
    const ground = makeFloor({ id: 'ground', items: [makeItem()] });
    const upper = makeFloor({ id: 'first', name: 'First Floor', items: [makeItem()] });
    const layout = makeLayout({ floors: [ground, upper], floorPlanImage: 'data:image/png;base64,PLAN' });
    await openBlueprintPrintWindow(layout, upper);
    expect(decodeCalls).toEqual([]);
    expect(events).toEqual(['open', 'write:plan', 'close']);
  });

  it('skips the decode when the layout has no tracing image', async () => {
    const floor = makeFloor({ items: [makeItem()] });
    await openBlueprintPrintWindow(makeLayout({ floors: [floor] }), floor);
    expect(decodeCalls).toEqual([]);
    expect(events).toEqual(['open', 'write:plan', 'close']);
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
