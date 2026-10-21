import { describe, expect, it, vi } from 'vitest';
import {
  createFlagStore,
  enqueueKeepingHead,
  enqueueNewestFirst,
  fitAboveFloor,
  overlayStackTop,
  queueHead,
  STACK_GAP,
  stackFloor,
} from './overlay-queue';

describe('enqueueNewestFirst', () => {
  it('puts the new entry first and keeps the list within the limit', () => {
    expect(enqueueNewestFirst([], 'a', 3)).toEqual(['a']);
    expect(enqueueNewestFirst(['b', 'a'], 'c', 3)).toEqual(['c', 'b', 'a']);
    expect(enqueueNewestFirst(['c', 'b', 'a'], 'd', 3)).toEqual(['d', 'c', 'b']);
  });

  it('never mutates its input', () => {
    const list = Object.freeze(['a']);
    expect(enqueueNewestFirst(list, 'b', 2)).toEqual(['b', 'a']);
    expect(list).toEqual(['a']);
  });
});

describe('queueHead', () => {
  it('is the oldest entry of a newest-first list, so notices play in order', () => {
    expect(queueHead(['c', 'b', 'a'])).toBe('a');
    expect(queueHead([])).toBeUndefined();
  });
});

describe('enqueueKeepingHead', () => {
  it('queues like enqueueNewestFirst while there is room', () => {
    expect(enqueueKeepingHead([], 'a', 3)).toEqual(['a']);
    expect(enqueueKeepingHead(['b', 'a'], 'c', 3)).toEqual(['c', 'b', 'a']);
  });

  it('never drops the head (on screen); the oldest waiting entry goes', () => {
    // newest-first: 'a' is the head, 'b' the oldest waiting
    expect(enqueueKeepingHead(['c', 'b', 'a'], 'd', 3)).toEqual(['d', 'c', 'a']);
    expect(enqueueKeepingHead(['b', 'a'], 'c', 1)).toEqual(['a']);
  });
});

describe('overlayStackTop', () => {
  const column = { left: 100, right: 300 };
  const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

  it('falls back to the minimum with nothing above the column', () => {
    expect(overlayStackTop([], column, 664, 132)).toBe(132);
  });

  it('clears the lowest overlapping piece of chrome in the top band', () => {
    const pills = rect(108, 8, 382, 120);
    const touchRow = rect(130, 128, 380, 172);
    expect(overlayStackTop([pills, touchRow], column, 664, 8)).toBe(172 + STACK_GAP);
  });

  it('ignores chrome beside the column or below the band', () => {
    const minimapRight = rect(310, 128, 382, 260);
    const hud = rect(0, 400, 390, 664);
    expect(overlayStackTop([minimapRight, hud], column, 664, 8)).toBe(8);
  });

  it('never pushes the stack past the middle of the viewport', () => {
    const tallColumn = rect(0, 60, 390, 600);
    expect(overlayStackTop([tallColumn], column, 664, 8)).toBe(332);
  });

  it('skips empty (hidden) rects', () => {
    expect(overlayStackTop([rect(0, 0, 0, 0), rect(120, 10, 120, 90)], column, 664, 8)).toBe(8);
  });
});

describe('stackFloor', () => {
  const column = { left: 100, right: 300 };
  it('is the sheet top when the sheet is under the column', () => {
    expect(stackFloor({ left: 0, right: 390, top: 382, bottom: 664 }, column, 664)).toBe(382);
  });
  it('is the viewport bottom with no sheet, or a sheet beside the column', () => {
    expect(stackFloor(null, column, 664)).toBe(664);
    expect(stackFloor({ left: 444, right: 844, top: 120, bottom: 390 }, column, 390)).toBe(390);
  });
});

describe('fitAboveFloor', () => {
  it('keeps the preferred top when the stack clears the floor', () => {
    expect(fitAboveFloor(180, 50, 382, 8)).toEqual({ top: 180, fits: true });
  });
  it('rises to sit on the floor when it would overlap it', () => {
    // SE, sheet expanded: sheet top 240, a 68px stack
    expect(fitAboveFloor(180, 68, 240, 8)).toEqual({ top: 240 - STACK_GAP - 68, fits: false });
  });
  it('never rises above the minimum top', () => {
    expect(fitAboveFloor(100, 300, 200, 8)).toEqual({ top: 8, fits: false });
  });
});

describe('createFlagStore', () => {
  it('notifies subscribers on a change only', () => {
    const store = createFlagStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(false);
    expect(listener).not.toHaveBeenCalled();
    store.set(true);
    expect(store.get()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.set(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(false);
  });
});
