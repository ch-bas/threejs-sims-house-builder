// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeItem } from '../lib/__testfixtures__/fixtures';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useImportExport } from './use-import-export';
import { layoutStore } from './use-layout-store';
import type { LayoutActions } from './use-layout-state';
import type { RoomLayout } from '../lib/types';

// #608: a JSON import is a whole-house load, so it must ask first, then keep
// a restore point of the house on screen, close the pending undo step, apply
// the file and tell the achievements it was a load, in that order. Nothing
// else pinned the order.

const calls: string[] = [];
const snapshots: (RoomLayout | null | undefined)[] = [];

vi.mock('../lib/restore-point', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/restore-point')>();
  return {
    ...actual,
    snapshotBeforeReplace: (outgoing: RoomLayout | null | undefined) => {
      calls.push('snapshotBeforeReplace');
      snapshots.push(outgoing);
    },
  };
});

vi.mock('./use-achievements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./use-achievements')>();
  return { ...actual, markLayoutLoaded: () => calls.push('markLayoutLoaded') };
});

// A house with work in it, so the import asks before replacing it.
const onScreen: RoomLayout = {
  ...INITIAL_LAYOUT,
  name: 'On screen',
  floors: [{ ...INITIAL_LAYOUT.floors[0]!, items: [makeItem({ id: 'sofa' })] }],
};
const imported: RoomLayout = { ...INITIAL_LAYOUT, name: 'Imported house' };

function setup() {
  const applyLayout = vi.fn((next: RoomLayout) => {
    calls.push('applyLayout');
    return next;
  });
  // Only applyLayout is used by an import; the rest of the actions stay out.
  const actions = { applyLayout } as unknown as LayoutActions;
  const { result } = renderHook(() =>
    useImportExport({
      layout: onScreen,
      activeFloorName: 'Ground',
      actions,
      commitHistoryNow: () => calls.push('commitHistoryNow'),
      view2D: false,
      canvasRef: createRef<HTMLCanvasElement>(),
      canvas2DRef: createRef<HTMLCanvasElement>(),
      rendererRef: { current: null },
      sceneRef: { current: null },
      cameraRef: { current: null },
      onImported: () => calls.push('onImported'),
    })
  );
  return { result, applyLayout };
}

async function importText(handleImport: (file: File) => Promise<boolean>, text: string): Promise<boolean> {
  let replaced: boolean | undefined;
  await act(async () => {
    replaced = await handleImport(new File([text], 'house.json', { type: 'application/json' }));
  });
  return replaced!;
}

describe('useImportExport — the order of a JSON import (#608)', () => {
  let confirms: AutoAnswer | undefined;
  let notices: Notice[];
  let unsubscribe: () => void;

  beforeEach(() => {
    calls.length = 0;
    snapshots.length = 0;
    notices = [];
    unsubscribe = subscribeNotices((notice) => notices.push(notice));
    layoutStore.setState({ layout: onScreen, activeFloorIndex: 0 });
  });
  afterEach(() => {
    confirms?.stop();
    confirms = undefined;
    unsubscribe();
    cleanup();
  });

  it('asks, keeps a restore point, closes the undo step, applies, then marks a load', async () => {
    confirms = autoAnswerConfirms(() => {
      calls.push('confirm');
      return true;
    });
    const { result, applyLayout } = setup();
    expect(await importText(result.current.handleImport, JSON.stringify(imported))).toBe(true);
    expect(calls).toEqual(['confirm', 'snapshotBeforeReplace', 'commitHistoryNow', 'applyLayout', 'markLayoutLoaded', 'onImported']);
    expect(applyLayout.mock.calls[0]?.[0].name).toBe('Imported house');
    expect(notices).toEqual([]);
  });

  it('keeps a restore point of the house on screen when the answer came, not when it asked', async () => {
    const editedMeanwhile: RoomLayout = { ...onScreen, name: 'Edited while asking' };
    confirms = autoAnswerConfirms(() => {
      layoutStore.setState({ layout: editedMeanwhile });
      return true;
    });
    const { result } = setup();
    await importText(result.current.handleImport, JSON.stringify(imported));
    expect(snapshots).toEqual([editedMeanwhile]);
  });

  it('touches nothing when the question is declined', async () => {
    confirms = autoAnswerConfirms(() => {
      calls.push('confirm');
      return false;
    });
    const { result } = setup();
    expect(await importText(result.current.handleImport, JSON.stringify(imported))).toBe(false);
    expect(calls).toEqual(['confirm']);
  });

  it('neither asks nor touches anything for a file that is not a layout, and says why', async () => {
    confirms = autoAnswerConfirms(() => {
      calls.push('confirm');
      return true;
    });
    const { result } = setup();
    expect(await importText(result.current.handleImport, '{"not":"a house"}')).toBe(false);
    expect(await importText(result.current.handleImport, 'not json at all')).toBe(false);
    expect(calls).toEqual([]);
    expect(notices.map((notice) => notice.tone)).toEqual(['error', 'error']);
    expect(notices[0]?.message).toMatch(/^Import failed: /);
  });
});
