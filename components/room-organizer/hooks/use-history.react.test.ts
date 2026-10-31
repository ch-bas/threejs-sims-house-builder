// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode, createElement, useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useHistory } from './use-history';
import { useLayoutState } from './use-layout-state';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';
import type { ReactNode } from 'react';

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

    const loaded: Doc = { name: 'Old saved layout' };
    act(() => result.current.clear(loaded));
    rerender({ value: loaded });
    act(() => {
      vi.advanceTimersByTime(10);
    });

    expect(result.current.canUndo).toBe(false);
  });
});

// #354: the orchestrator hydrates from a mount effect — dispatch the saved
// layout, then clear() with the layout the store now holds. StrictMode replays
// mount effects, which used to consume the one-shot "adopt next value" flag
// against the pre-hydration default, putting the default on the undo stack.
describe('useHistory — hydration baseline (#354)', () => {
  const saved: RoomLayout = {
    ...INITIAL_LAYOUT,
    name: 'Saved house',
    width: 10,
    floors: [{ ...INITIAL_LAYOUT.floors[0]!, items: [makeItem({ id: 'sofa' })] }],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const mountHydrating = (strict: boolean) =>
    renderHook(
      () => {
        const { layout, actions } = useLayoutState();
        const history = useHistory(layout, actions.applyLayout);
        const hydratedRef = useRef(false);
        useEffect(() => {
          if (hydratedRef.current) return;
          hydratedRef.current = true;
          actions.applyLayout(saved);
          history.clear(layoutStore.getState().layout);
        }, [actions, history]);
        return { layout, history };
      },
      strict ? { wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children) } : {}
    );

  for (const strict of [false, true]) {
    it(`undo after hydrate is a no-op${strict ? ' (StrictMode)' : ''}`, () => {
      const { result } = mountHydrating(strict);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      const hydrated = layoutStore.getState().layout;
      expect(hydrated.name).toBe('Saved house');
      expect(result.current.history.canUndo).toBe(false);

      act(() => result.current.history.undo());
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(layoutStore.getState().layout).toBe(hydrated);
      expect(result.current.history.canUndo).toBe(false);
      expect(result.current.history.canRedo).toBe(false);
    });
  }

  it('the first edit after hydrate undoes back to the hydrated house', () => {
    const { result } = mountHydrating(true);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const hydrated = layoutStore.getState().layout;
    act(() => layoutStore.getState().actions.setName('Renamed'));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => result.current.history.undo());
    expect(layoutStore.getState().layout).toStrictEqual(hydrated);
    expect(result.current.history.canUndo).toBe(false);
  });
});

// #425: discrete actions within the debounce window used to merge.
describe('useHistory — commitNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const setup = (initial: Doc) => {
    const apply = vi.fn<(snapshot: Doc) => void>();
    const hook = renderHook(({ value }) => useHistory(value, apply, { debounceMs: 600 }), {
      initialProps: { value: initial },
    });
    return { apply, ...hook };
  };

  it('keeps quick discrete actions as separate undo steps', () => {
    const v0: Doc = { name: '3 items' };
    const v1: Doc = { name: '2 items' };
    const v2: Doc = { name: '1 item' };
    const v3: Doc = { name: '0 items' };
    const { apply, result, rerender } = setup(v0);
    for (const next of [v1, v2, v3]) {
      act(() => result.current.commitNow());
      rerender({ value: next });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(v2);
    rerender({ value: v2 });
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(v1);
    rerender({ value: v1 });
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(v0);
  });

  it('separates a discrete action from a pending edit before it and a stream after it', () => {
    const v0: Doc = { name: 'start' };
    const colour: Doc = { name: 'recoloured' };
    const deleted: Doc = { name: 'deleted' };
    const dragged1: Doc = { name: 'dragged a bit' };
    const dragged2: Doc = { name: 'dragged more' };
    const { apply, result, rerender } = setup(v0);
    rerender({ value: colour });
    act(() => result.current.commitNow());
    rerender({ value: deleted });
    rerender({ value: dragged1 });
    rerender({ value: dragged2 });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(deleted);
    rerender({ value: deleted });
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(colour);
    rerender({ value: colour });
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(v0);
  });

  it('a refused action does not leave the next edit committing on its own', () => {
    const v0: Doc = { name: 'start' };
    const a: Doc = { name: 'a' };
    const b: Doc = { name: 'b' };
    const { apply, result, rerender } = setup(v0);
    act(() => result.current.commitNow());
    act(() => {
      vi.advanceTimersByTime(700);
    });
    rerender({ value: a });
    rerender({ value: b });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(v0);
  });
});

// #546: an undo inside the debounce window used to append the pending edit to
// a non-empty `future`, so a later redo replayed the abandoned branch.
describe('useHistory — undo of a pending edit invalidates older redo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('leaves the pending edit as the only redo', () => {
    const a: Doc = { name: 'A' };
    const b: Doc = { name: 'B' };
    const c: Doc = { name: 'C' };
    const apply = vi.fn<(snapshot: Doc) => void>();
    const { result, rerender } = renderHook(({ value }) => useHistory(value, apply, { debounceMs: 600 }), {
      initialProps: { value: a },
    });

    rerender({ value: b });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(a);
    rerender({ value: a });

    // A new edit abandons B; undo it before the debounce commits it.
    rerender({ value: c });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => result.current.undo());
    expect(apply).toHaveBeenLastCalledWith(a);
    rerender({ value: a });

    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(apply).toHaveBeenLastCalledWith(c);
    rerender({ value: c });

    // B belonged to the abandoned branch: nothing is left to redo.
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.redo());
    expect(apply).toHaveBeenCalledTimes(3);
  });
});

// #578: undo used to keep the numeric active floor index, so undoing a floor
// removal or reorder landed on another storey, and undoing an edit made on
// another floor happened off-screen.
describe('useHistory — undo lands on the right floor', () => {
  const floor = (id: string, name: string) => ({ ...INITIAL_LAYOUT.floors[0]!, id, name, items: [] });
  const threeFloors: RoomLayout = {
    ...INITIAL_LAYOUT,
    floors: [floor('fa', 'A'), floor('fb', 'B'), floor('fc', 'C')],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    layoutStore.setState({ layout: threeFloors, activeFloorIndex: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const mount = () =>
    renderHook(() => {
      const { layout, actions } = useLayoutState();
      return useHistory(layout, actions.restoreLayout);
    });
  const settle = () =>
    act(() => {
      vi.advanceTimersByTime(700);
    });
  const store = () => layoutStore.getState();
  const activeId = () => store().layout.floors[store().activeFloorIndex]?.id;

  it('undoing a floor removal stays on the floor you were on', () => {
    const { result } = mount();
    act(() => store().actions.setActiveFloorIndex(2));
    act(() => store().actions.removeFloor(0));
    settle();
    expect(activeId()).toBe('fc');
    act(() => result.current.undo());
    expect(store().layout.floors.map((f) => f.id)).toEqual(['fa', 'fb', 'fc']);
    expect(activeId()).toBe('fc');
    settle();
    act(() => result.current.redo());
    expect(activeId()).toBe('fc');
  });

  it('undoing a reorder stays on the moved floor', () => {
    const { result } = mount();
    act(() => store().actions.reorderFloor(0, 2));
    settle();
    expect(activeId()).toBe('fa');
    act(() => result.current.undo());
    expect(store().layout.floors.map((f) => f.id)).toEqual(['fa', 'fb', 'fc']);
    expect(activeId()).toBe('fa');
  });

  it('undoing an edit on another floor switches to that floor', () => {
    const { result } = mount();
    act(() => store().actions.setActiveFloorIndex(1));
    act(() => store().actions.addItems([makeItem({ id: 'bed' })]));
    settle();
    act(() => store().actions.setActiveFloorIndex(0));
    act(() => result.current.undo());
    expect(store().layout.floors[1]?.items).toEqual([]);
    expect(activeId()).toBe('fb');
    settle();
    // Redo shows it too, and a second round still finds the floor after the
    // restore cloned every storey.
    act(() => store().actions.setActiveFloorIndex(2));
    act(() => result.current.redo());
    expect(store().layout.floors[1]?.items.map((i) => i.id)).toEqual(['bed']);
    expect(activeId()).toBe('fb');
    settle();
    act(() => store().actions.setActiveFloorIndex(0));
    act(() => result.current.undo());
    expect(activeId()).toBe('fb');
  });

  it('undoing a change to the floor on screen stays there', () => {
    const { result } = mount();
    act(() => store().actions.setActiveFloorIndex(2));
    act(() => store().actions.addItems([makeItem({ id: 'bed' })]));
    settle();
    act(() => result.current.undo());
    expect(store().layout.floors[2]?.items).toEqual([]);
    expect(activeId()).toBe('fc');
  });
});

describe('useHistory — labels (#625)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const describeStep = (before: Doc, after: Doc): string => `${before.name} to ${after.name}`;
  const setup = () =>
    renderHook(({ value }) => useHistory<Doc>(value, vi.fn(), { debounceMs: 10, describe: describeStep }), {
      initialProps: { value: { name: 'a' } as Doc },
    });
  const settle = () => act(() => void vi.advanceTimersByTime(20));

  it('has none with nothing to undo', () => {
    const { result } = setup();
    expect(result.current.undoLabel).toBeNull();
    expect(result.current.redoLabel).toBeNull();
  });

  it('names a pending edit, then the same edit once committed', () => {
    const { result, rerender } = setup();
    rerender({ value: { name: 'b' } });
    expect(result.current.undoLabel).toBe('a to b');
    settle();
    expect(result.current.undoLabel).toBe('a to b');
  });

  it('names the step redo brings back, and the one undo now takes', () => {
    const { result, rerender } = setup();
    rerender({ value: { name: 'b' } });
    settle();
    rerender({ value: { name: 'c' } });
    settle();
    expect(result.current.undoLabel).toBe('b to c');
    act(() => result.current.undo());
    rerender({ value: { name: 'b' } });
    expect(result.current.redoLabel).toBe('b to c');
    expect(result.current.undoLabel).toBe('a to b');
  });
});
