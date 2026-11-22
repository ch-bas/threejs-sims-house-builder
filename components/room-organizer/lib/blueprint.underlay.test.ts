// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { openBlueprintPrintWindow } from './blueprint';
import type { RoomLayout } from './types';

// jsdom has no 2D canvas: what matters is which layout reaches the render.
const decodeCalls: string[] = [];
const rendered: RoomLayout[] = [];

vi.mock('../canvas-2d/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../canvas-2d/render')>();
  return {
    ...actual,
    ensureFloorPlanImageDecoded: (url: string) => {
      decodeCalls.push(url);
      return Promise.resolve();
    },
    render2DTopDown: (options: { layout: RoomLayout }) => {
      rendered.push(options.layout);
    },
  };
});

describe('the blueprint of a traced plan (#920)', () => {
  const popup = { document: { write: () => undefined, close: () => undefined, readyState: 'loading' }, addEventListener: () => undefined, opener: null, close: () => undefined };

  beforeEach(() => {
    decodeCalls.length = 0;
    rendered.length = 0;
    vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,STUB');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves an underlay off the sheet, and prints the walls drawn over it', async () => {
    const floor = makeFloor({ items: [makeItem()] });
    await openBlueprintPrintWindow(makeLayout({ floors: [floor], floorPlanImage: 'data:image/png;base64,PLAN', floorPlanMode: 'underlay' }), floor);
    expect(decodeCalls).toEqual([]);
    expect(rendered.length).toBeGreaterThan(0);
    for (const layout of rendered) expect(layout.floorPlanImage).toBeUndefined();
  });

  it('still prints a plan that is the drawing', async () => {
    const floor = makeFloor({ items: [makeItem()] });
    await openBlueprintPrintWindow(makeLayout({ floors: [floor], floorPlanImage: 'data:image/png;base64,PLAN' }), floor);
    expect(decodeCalls).toEqual(['data:image/png;base64,PLAN']);
    for (const layout of rendered) expect(layout.floorPlanImage).toBe('data:image/png;base64,PLAN');
  });
});
