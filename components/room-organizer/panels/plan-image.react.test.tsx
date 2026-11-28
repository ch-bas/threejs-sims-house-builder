// @vitest-environment jsdom
// The panels' floor-plan image paths (#936): History restore, Back up all.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorViewProvider } from '../contexts/editor-view-context';
import { createEditorViewStore } from '../hooks/editor-view-store';
import { layoutStore } from '../hooks/use-layout-store';
import { autoAnswerConfirms, type AutoAnswer } from '../lib/__testfixtures__/confirm';
import { makeFloor, makeItem, makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { readStorageCare } from '../lib/backup-reminder';
import { cancelPendingConfirms } from '../lib/confirm-dialog';
import { STORAGE_KEY } from '../lib/constants';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import {
  createMemoryPlanImageBackend,
  hashPlanImage,
  resetPlanImageStoreForTests,
  setPersistenceManagerForTests,
  setPlanImageBackendForTests,
} from '../lib/plan-image-store';
import { recordSnapshot } from '../lib/version-history';
import { LibraryPanel } from './library-panel';
import { StoragePanel } from './storage-panel';
import type { RoomLayout } from '../lib/types';

vi.mock('./plan-thumb', () => ({ PlanThumb: () => null }));
vi.mock('../lib/plan-export/download', async (original) => ({
  ...(await original<typeof import('../lib/plan-export/download')>()),
  downloadTextFile: vi.fn(),
}));

const IMAGE = `data:image/jpeg;base64,${'R'.repeat(5000)}`;
const OTHER = `data:image/jpeg;base64,${'T'.repeat(5000)}`;

const named = (name: string, ref: string, items = 1): RoomLayout => {
  const layout: RoomLayout = makeLayout({
    id: `id-${name}`,
    name,
    floorPlanImageRef: ref,
    floors: [makeFloor({ items: Array.from({ length: items }, (_, i) => makeItem({ id: `${name}${i}` })) })],
  });
  return layout;
};

describe('floor-plan images in the panels (#936)', () => {
  let records: Map<string, string>;
  let confirms: AutoAnswer | null = null;
  beforeEach(() => {
    window.localStorage.clear();
    records = new Map();
    setPlanImageBackendForTests(createMemoryPlanImageBackend(records));
    setPersistenceManagerForTests({ persisted: () => Promise.resolve(true) });
  });
  afterEach(() => {
    confirms?.stop();
    confirms = null;
    cancelPendingConfirms();
    cleanup();
    resetPlanImageStoreForTests();
  });

  const restore = async (point: RoomLayout, shown: RoomLayout): Promise<RoomLayout> => {
    recordSnapshot(point, { force: true });
    layoutStore.getState().actions.applyLayout(shown);
    confirms = autoAnswerConfirms(true);
    const onLoad = vi.fn();
    render(<LibraryPanel currentLayout={shown} onLoad={onLoad} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Restore ${point.name}`) }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    return onLoad.mock.calls[0]![0] as RoomLayout;
  };

  it('History restore fetches the point’s image from the store by its ref', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    records.set(ref, IMAGE);
    const restored = await restore(named('Cottage', ref), makeLayout({ id: 'other', name: 'Other', floorPlanImage: OTHER }));
    expect(restored.floorPlanImage).toBe(IMAGE);
    expect(restored.floorPlanImageRef).toBeUndefined();
  });

  it('History restore keeps the ref of a house on screen that only names its image', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    // Not in the store: the shown house couldn't read it either.
    const restored = await restore(named('Cottage', ref, 2), named('Cottage', ref, 1));
    expect(restored.floorPlanImageRef).toBe(ref);
  });

  it('History restore drops a ref whose image is gone, when the house on screen doesn’t name it', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    const restored = await restore(named('Cottage', ref), makeLayout({ id: 'other', name: 'Other' }));
    expect(restored.floorPlanImageRef).toBeUndefined();
    expect(restored.floorPlanImage).toBeUndefined();
  });

  it('Back up all says when an image couldn’t be put in the file, and doesn’t count the backup', async () => {
    const notices: Notice[] = [];
    const stop = subscribeNotices((notice) => notices.push(notice));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(named('Saved', `sha256-${'7'.repeat(64)}`)));
      const store = createEditorViewStore(makeViewSettings());
      render(
        <EditorViewProvider store={store}>
          <StoragePanel currentLayout={named('Open', `sha256-${'7'.repeat(64)}`)} onStorageChanged={vi.fn()} />
        </EditorViewProvider>
      );
      act(() => screen.getByRole('button', { name: /Back up all/ }).click());
      await waitFor(() => expect(notices.map((notice) => notice.message).join(' ')).toMatch(/couldn’t be read .*isn’t counted/));
      expect(readStorageCare().lastBackupAt).toBeNull();
    } finally {
      stop();
    }
  });
});
