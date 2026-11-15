// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useHistory } from './use-history';
import { useImportExport } from './use-import-export';
import { useLayoutState } from './use-layout-state';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

// jsdom's Blob has no stream(), which the link codec compresses through; the
// codec has its own tests, so here the link is a short stand-in.
vi.mock('../lib/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/share')>()),
  encodeShareUrl: (layout: RoomLayout, origin: string) =>
    Promise.resolve({ url: `${origin}#layout=short`, strippedFloorPlan: layout.floorPlanImage !== undefined }),
}));

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

// #934: when the link leaves the floor plan out, the notice offers the file that keeps it.
describe('useImportExport — a share link that leaves something out offers the file', () => {
  const traced: RoomLayout = { ...INITIAL_LAYOUT, name: 'Traced', floorPlanImage: 'data:image/png;base64,AAAA' };
  let notices: Notice[];
  let unsubscribe: () => void;
  beforeEach(() => {
    notices = [];
    unsubscribe = subscribeNotices((notice) => notices.push(notice));
    layoutStore.setState({ layout: traced, activeFloorIndex: 0 });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.resolve()) } });
  });
  afterEach(() => {
    unsubscribe();
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies the link and offers a download of the whole house where there is no sheet', async () => {
    const { result } = renderHook(() => {
      const { layout, actions } = useLayoutState();
      return useImportExport({
        layout,
        activeFloorName: 'Ground',
        actions,
        commitHistoryNow: () => undefined,
        view2D: false,
        canvasRef: createRef<HTMLCanvasElement>(),
        canvas2DRef: createRef<HTMLCanvasElement>(),
        rendererRef: { current: null },
        sceneRef: { current: null },
        cameraRef: { current: null },
        onImported: () => undefined,
      });
    });
    await act(async () => {
      await result.current.handleShareLink();
    });
    const notice = notices.at(-1);
    expect(notice?.message).toBe(
      'Share link copied to clipboard. The floor-plan image was left out to keep it short; the file keeps it.'
    );
    expect(notice?.action?.label).toBe('Download file');

    const blobs: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return 'blob:house';
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await act(async () => {
      void notice?.action?.run();
      await Promise.resolve();
    });
    expect(click).toHaveBeenCalledOnce();
    const saved = JSON.parse(await (blobs[0] as Blob).text()) as RoomLayout;
    expect(saved.name).toBe('Traced');
    expect(saved.floorPlanImage).toBe(traced.floorPlanImage);
  });
});
