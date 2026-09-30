// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistory } from './use-history';

interface Doc {
  readonly name: string;
}

describe('useHistory — replacing the whole value', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const setup = (initial: Doc) => {
    const apply = vi.fn<(snapshot: Doc) => void>();
    const hook = renderHook(({ value }) => useHistory(value, apply, { debounceMs: 10 }), {
      initialProps: { value: initial },
    });
    return { apply, ...hook };
  };

  // Library and template loads swap in an entirely new layout. That must land
  // as an ordinary history entry so Ctrl+Z restores the design it replaced
  // (#222).
  it('makes a load undoable back to the replaced value', () => {
    const current: Doc = { name: 'An hour of unsaved work' };
    const { apply, result, rerender } = setup(current);

    rerender({ value: { name: 'Old saved layout' } });
    act(() => {
      vi.advanceTimersByTime(10);
    });

    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(current);
  });

  it('is undoable even before the debounce commits the load', () => {
    const current: Doc = { name: 'An hour of unsaved work' };
    const { apply, result, rerender } = setup(current);

    rerender({ value: { name: 'Old saved layout' } });

    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(current);
  });

  // clear() is for adopting a baseline (startup hydration), never for a
  // user-initiated load — it makes the replaced value unreachable.
  it('clear() alongside a load leaves nothing to undo', () => {
    const { result, rerender } = setup({ name: 'An hour of unsaved work' });

    act(() => result.current.clear());
    rerender({ value: { name: 'Old saved layout' } });
    act(() => {
      vi.advanceTimersByTime(10);
    });

    expect(result.current.canUndo).toBe(false);
  });
});
