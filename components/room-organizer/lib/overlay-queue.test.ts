import { describe, expect, it, vi } from 'vitest';
import {
  advanceQueue,
  createFlagStore,
  enqueueNewestFirst,
  overlayStackTop,
  queueHead,
  STACK_GAP,
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

describe('advanceQueue', () => {
  it('steps through the queue and reports when it drains', () => {
    expect(advanceQueue(0, 3)).toBe(1);
    expect(advanceQueue(1, 3)).toBe(2);
    expect(advanceQueue(2, 3)).toBeNull();
    expect(advanceQueue(0, 1)).toBeNull();
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
