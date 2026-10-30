// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useHistory } from './use-history';
import { useImportExport } from './use-import-export';
import { useLayoutState } from './use-layout-state';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

// #555: an edit still inside the debounce window when a whole-house load lands
// was folded into the load's undo entry, so Ctrl+Z skipped past it.
describe('useImportExport — import keeps a pending edit as its own undo step', () => {
  const start: RoomLayout = {
    ...INITIAL_LAYOUT,
    name: 'Mine',
    floors: [{ ...INITIAL_LAYOUT.floors[0]!, items: [makeItem({ id: 'sofa', position: { x: 1, z: 1 } })] }],
  };
  const imported: RoomLayout = { ...INITIAL_LAYOUT, name: 'Imported house' };

  let confirms: AutoAnswer;
  beforeEach(() => {
    vi.useFakeTimers();
    confirms = autoAnswerConfirms(true);
    layoutStore.setState({ layout: start, activeFloorIndex: 0 });
  });
  afterEach(() => {
    confirms.stop();
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('one undo after the import restores the edit made just before it', async () => {
    const { result } = renderHook(() => {
      const { layout, actions } = useLayoutState();
      const history = useHistory(layout, actions.applyLayout);
      const io = useImportExport({
        layout,
        activeFloorName: 'Ground',
        actions,
        commitHistoryNow: history.commitNow,
        view2D: false,
        canvasRef: createRef<HTMLCanvasElement>(),
        canvas2DRef: createRef<HTMLCanvasElement>(),
        rendererRef: { current: null },
        sceneRef: { current: null },
        cameraRef: { current: null },
        onImported: () => undefined,
      });
      return { history, io };
    });

    // Move the sofa; the move is still pending when the import lands.
    act(() => layoutStore.getState().actions.moveItem('sofa', 2, 2));
    const moved = layoutStore.getState().layout;
    act(() => {
      vi.advanceTimersByTime(100);
    });

    const file = new File([JSON.stringify(imported)], 'house.json', { type: 'application/json' });
    let replaced = false;
    await act(async () => {
      replaced = await result.current.io.handleImport(file);
    });
    expect(replaced).toBe(true);
    // Asked in the app, not with the native confirm (#649).
    expect(confirms.asked.map((question) => question.title)).toEqual(['Replace your current house with the imported “Imported house”?']);
    expect(layoutStore.getState().layout.name).toBe('Imported house');
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    act(() => result.current.history.undo());
    expect(layoutStore.getState().layout.name).toBe('Mine');
    expect(layoutStore.getState().layout.floors[0]?.items[0]?.position).toEqual(moved.floors[0]?.items[0]?.position);

    act(() => result.current.history.undo());
    expect(layoutStore.getState().layout.floors[0]?.items[0]?.position).toEqual({ x: 1, z: 1 });
  });

  it('cancelling the in-app question keeps the house (#649)', async () => {
    confirms.stop();
    confirms = autoAnswerConfirms(false);
    const { result } = renderHook(() => {
      const { layout, actions } = useLayoutState();
      const history = useHistory(layout, actions.applyLayout);
      return useImportExport({
        layout,
        activeFloorName: 'Ground',
        actions,
        commitHistoryNow: history.commitNow,
        view2D: false,
        canvasRef: createRef<HTMLCanvasElement>(),
        canvas2DRef: createRef<HTMLCanvasElement>(),
        rendererRef: { current: null },
        sceneRef: { current: null },
        cameraRef: { current: null },
        onImported: () => undefined,
      });
    });
    const file = new File([JSON.stringify(imported)], 'house.json', { type: 'application/json' });
    let replaced = true;
    await act(async () => {
      replaced = await result.current.handleImport(file);
    });
    expect(replaced).toBe(false);
    expect(confirms.asked).toHaveLength(1);
    expect(layoutStore.getState().layout.name).toBe('Mine');
  });
});
