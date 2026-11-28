// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAnswerConfirms } from '../lib/__testfixtures__/confirm';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../lib/constants';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { readRecoveryCopies } from '../lib/persistence';
import {
  createMemoryPlanImageBackend,
  hashPlanImage,
  resetPlanImageStoreForTests,
  setPersistenceManagerForTests,
  setPlanImageBackendForTests,
  type PlanImageBackend,
} from '../lib/plan-image-store';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { parseStoredLayout } from '../lib/schema';
import { resetTourPhaseForTests } from '../lib/tour-session';
import { getSnapshot, listSnapshots } from '../lib/version-history';
import { EDITS_WHILE_OPENING, OPENING_HOUSE_KEPT, useLayoutPersistence } from './use-layout-persistence';
import type { RoomLayout } from '../lib/types';

const PERSISTENT = { persisted: () => Promise.resolve(true) };
const IMAGE = `data:image/jpeg;base64,${'Q'.repeat(20000)}`;

const house = (): RoomLayout =>
  makeLayout({
    id: 'house-1',
    name: 'Traced',
    floorPlanImage: IMAGE,
    floorPlanOpacity: 0.4,
    floorPlanTransform: { scale: 0.01, offsetX: 1, offsetZ: 2 },
    floors: [makeFloor({ items: [makeItem({ id: 'sofa' })] })],
  });

const stored = (): Record<string, unknown> => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown>;

/** The hook with the house in state, as the editor holds it. */
function mount(initial: RoomLayout = makeLayout({ name: 'Fallback' })) {
  const hydrated: RoomLayout[] = [];
  const view = renderHook(() => {
    const [layout, setLayout] = useState(initial);
    const persistence = useLayoutPersistence({
      layout,
      onHydrate: (next) => {
        hydrated.push(next);
        setLayout(next);
      },
      debounceMs: 20,
    });
    return { layout, setLayout, ...persistence };
  });
  return { ...view, hydrated };
}

describe('useLayoutPersistence and the plan image store (#936)', () => {
  let records: Map<string, string>;
  let notices: Notice[];
  let unsubscribe: () => void;
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    resetTourPhaseForTests();
    records = new Map();
    setPlanImageBackendForTests(createMemoryPlanImageBackend(records));
    setPersistenceManagerForTests(PERSISTENT);
    notices = [];
    unsubscribe = subscribeNotices((notice) => notices.push(notice));
  });
  afterEach(() => {
    cleanup();
    unsubscribe();
    resetPlanImageStoreForTests();
  });

  it('moves an old save’s inline image into the store, then names it by ref, changing nothing else', async () => {
    const old = house();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(old));
    const { result } = mount();
    expect(result.current.layout.floorPlanImage).toBe(IMAGE);
    const ref = await hashPlanImage(IMAGE);
    await waitFor(() => expect(stored().floorPlanImageRef).toBe(ref));
    expect(records.get(ref!)).toBe(IMAGE);
    const { floorPlanImage: _image, ...rest } = old;
    expect(stored()).toEqual({ ...rest, floorPlanImageRef: ref });
    // The house on screen still holds the image itself.
    expect(result.current.layout.floorPlanImage).toBe(IMAGE);
  });

  it('opens a save that names its image only once the image is read, saving nothing meanwhile', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backend: PlanImageBackend = {
      put: (key, image) => Promise.resolve(void records.set(key, image)),
      get: async (key) => {
        await gate;
        return records.get(key) ?? null;
      },
    };
    records.set(ref, IMAGE);
    setPlanImageBackendForTests(backend);
    setPersistenceManagerForTests(PERSISTENT);
    const { floorPlanImage: _image, ...rest } = house();
    const raw = JSON.stringify({ ...rest, floorPlanImageRef: ref });
    window.localStorage.setItem(STORAGE_KEY, raw);
    const { result, hydrated } = mount();
    expect(hydrated).toEqual([]);
    // An edit of the lot shown while the image loads must not save over the house.
    act(() => result.current.setLayout(makeLayout({ name: 'Edited meanwhile' })));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    release();
    await waitFor(() => expect(hydrated).toHaveLength(1));
    expect(hydrated[0]).toEqual(parseStoredLayout(house()));
    // The edit of the placeholder gave way, and the player is told.
    expect(notices.map((notice) => notice.message)).toContain(EDITS_WHILE_OPENING);
    expect(result.current.layout.floorPlanImage).toBe(IMAGE);
    expect(result.current.layout.floorPlanImageRef).toBeUndefined();
    // The hydration is not an edit: nothing is written.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    // A real edit saves by ref again.
    act(() => result.current.setLayout({ ...result.current.layout, name: 'Renamed' }));
    await waitFor(() => expect(stored().name).toBe('Renamed'));
    expect(stored().floorPlanImageRef).toBe(ref);
    expect(stored().floorPlanImage).toBeUndefined();
  });

  it('opens on the storey it would have, whatever an edit meanwhile switched to', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    records.set(ref, IMAGE);
    setPlanImageBackendForTests({
      put: (key, image) => Promise.resolve(void records.set(key, image)),
      get: async (key) => {
        await gate;
        return records.get(key) ?? null;
      },
    });
    const { floorPlanImage: _image, ...rest } = house();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, floors: [makeFloor(), makeFloor()], floorPlanImageRef: ref }));
    let floor = 0;
    const opened: (number | undefined)[] = [];
    const { result } = renderHook(() => {
      const [layout, setLayout] = useState(makeLayout({ name: 'Fallback' }));
      useLayoutPersistence({
        layout,
        activeFloorIndex: () => floor,
        onHydrate: (next, floorIndex) => {
          opened.push(floorIndex);
          setLayout(next);
        },
        debounceMs: 20,
      });
      return { setLayout };
    });
    // Add floor on the placeholder: the view moves upstairs.
    act(() => result.current.setLayout(makeLayout({ name: 'Edited meanwhile', floors: [makeFloor(), makeFloor()] })));
    floor = 1;
    release();
    await waitFor(() => expect(opened).toEqual([0]));
  });

  it('opens the house without an image it can’t read, says so, and keeps naming the image', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    const { floorPlanImage: _image, ...rest } = house();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, floorPlanImageRef: ref }));
    const { result, hydrated } = mount();
    await waitFor(() => expect(hydrated).toHaveLength(1));
    expect(result.current.layout.floorPlanImageRef).toBe(ref);
    expect(result.current.layout.floorPlanImage).toBeUndefined();
    // The store opened and the image isn't in it: gone, not "reload".
    expect(notices.map((notice) => notice.message).join(' ')).toMatch(/no longer in this browser’s storage.*Restore a backup/);
    act(() => result.current.setLayout({ ...result.current.layout, name: 'Renamed' }));
    await waitFor(() => expect(stored().name).toBe('Renamed'));
    expect(stored().floorPlanImageRef).toBe(ref);
    expect(stored().floorPlanTransform).toEqual(house().floorPlanTransform);
  });

  it('keeps the image inline where the store can’t be used', async () => {
    setPlanImageBackendForTests(null);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(house()));
    const { result } = mount();
    act(() => result.current.setLayout({ ...result.current.layout, name: 'Renamed' }));
    await waitFor(() => expect(stored().name).toBe('Renamed'));
    expect(stored().floorPlanImage).toBe(IMAGE);
    expect(stored().floorPlanImageRef).toBeUndefined();
  });

  it('reads another tab’s save by ref as the same house, and brings the image when it differs', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(house()));
    const { result } = mount();
    const ref = (await hashPlanImage(IMAGE))!;
    await waitFor(() => expect(stored().floorPlanImageRef).toBe(ref));
    // A fresh session, as another tab is: the image comes from the store.
    resetPlanImageStoreForTests();
    setPlanImageBackendForTests(createMemoryPlanImageBackend(records));
    setPersistenceManagerForTests(PERSISTENT);
    const { floorPlanImage: _image, ...rest } = house();
    const send = (value: unknown) =>
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: JSON.stringify(value) }));
      });
    send({ ...rest, floorPlanImageRef: ref });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.remoteLayout).toBeNull();
    send({ ...rest, name: 'Other tab', floorPlanImageRef: ref });
    await waitFor(() => expect(result.current.remoteLayout?.name).toBe('Other tab'));
    expect(result.current.remoteLayout?.floorPlanImage).toBe(IMAGE);
    expect(result.current.remoteLayout?.floorPlanImageRef).toBeUndefined();
  });

  it('saves a new upload inline first, then by ref once it is stored', async () => {
    const { result } = mount(makeLayout({ id: 'h', name: 'Blank' }));
    act(() => result.current.setLayout({ ...result.current.layout, name: 'Plan', floorPlanImage: IMAGE }));
    const ref = await hashPlanImage(IMAGE);
    await waitFor(() => expect(stored().floorPlanImageRef).toBe(ref));
    expect(stored().floorPlanImage).toBeUndefined();
    expect(stored().name).toBe('Plan');
  });

  it('says “reload” when the store couldn’t be read, not that the image is gone', async () => {
    setPlanImageBackendForTests(null);
    const ref = (await hashPlanImage(IMAGE))!;
    const { floorPlanImage: _image, ...rest } = house();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, floorPlanImageRef: ref }));
    const { hydrated } = mount();
    await waitFor(() => expect(hydrated).toHaveLength(1));
    expect(notices.map((notice) => notice.message).join(' ')).toMatch(/couldn’t be read .* just now.*reload to try again/);
  });

  it('a whole-house load while the saved house waits for its image asks about that house, keeps it, then wins and saves', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    records.set(ref, IMAGE);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setPlanImageBackendForTests({
      put: (key, image) => Promise.resolve(void records.set(key, image)),
      get: async (key) => {
        await gate;
        return records.get(key) ?? null;
      },
    });
    setPersistenceManagerForTests(PERSISTENT);
    const { floorPlanImage: _image, ...rest } = house();
    const raw = JSON.stringify({ ...rest, floorPlanImageRef: ref });
    window.localStorage.setItem(STORAGE_KEY, raw);
    const { result, hydrated } = mount();
    // An import, as use-import-export runs it, against the placeholder on screen.
    const confirms = autoAnswerConfirms(true);
    try {
      const placeholder = result.current.layout;
      expect(await confirmReplace(placeholder, 'the imported “Imported”')).toBe(true);
      expect(confirms.asked).toHaveLength(1);
      expect(confirms.asked[0]?.body).toMatch(/still opening/);
      act(() => {
        snapshotBeforeReplace(placeholder);
        result.current.setLayout(makeLayout({ id: 'imported', name: 'Imported' }));
      });
    } finally {
      confirms.stop();
    }
    // The saved house is kept twice over: a restore point naming its image's
    // ref, and the stored save copied aside as it was.
    const point = listSnapshots().find((summary) => summary.name === 'Traced');
    expect(point?.floorPlanRef).toBe(ref);
    expect(getSnapshot(point!.id)?.floors[0]?.items).toHaveLength(1);
    expect(readRecoveryCopies().map((copy) => copy.raw)).toEqual([raw]);
    expect(notices.map((notice) => notice.message)).toContain(OPENING_HOUSE_KEPT);
    release();
    await waitFor(() => expect(stored().name).toBe('Imported'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(hydrated).toEqual([]);
    expect(result.current.layout.name).toBe('Imported');
  });

  /** A ref-only save of `house()` and a store that answers only on `release`. */
  async function gatedRefSave(): Promise<{ raw: string; release: () => void }> {
    const ref = (await hashPlanImage(IMAGE))!;
    records.set(ref, IMAGE);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setPlanImageBackendForTests({
      put: (key, image) => Promise.resolve(void records.set(key, image)),
      get: async (key) => {
        await gate;
        return records.get(key) ?? null;
      },
    });
    setPersistenceManagerForTests(PERSISTENT);
    const { floorPlanImage: _image, ...rest } = house();
    const raw = JSON.stringify({ ...rest, floorPlanImageRef: ref });
    window.localStorage.setItem(STORAGE_KEY, raw);
    return { raw, release };
  }

  it('an editor unmounted during the wait opens nothing late, and leaves no opening house to ask about', async () => {
    const { release } = await gatedRefSave();
    const { unmount, hydrated } = mount();
    unmount();
    const ask = vi.fn(() => Promise.resolve(false));
    // The placeholder alone is what a load would replace now: untouched, so nothing is asked.
    expect(await confirmReplace(INITIAL_LAYOUT, 'x', { ask })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    release();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(hydrated).toEqual([]);
  });

  it('another tab’s house adopted during the wait keeps aside the saved house as it was read, not the other tab’s save', async () => {
    const { raw, release } = await gatedRefSave();
    const { result } = mount();
    const otherTab = JSON.stringify(makeLayout({ id: 'other', name: 'Other tab', floors: [makeFloor({ items: [makeItem({ id: 'lamp' })] })] }));
    window.localStorage.setItem(STORAGE_KEY, otherTab);
    act(() => {
      snapshotBeforeReplace(result.current.layout);
      result.current.setLayout(JSON.parse(otherTab) as RoomLayout);
    });
    expect(readRecoveryCopies().map((copy) => copy.raw)).toEqual([raw]);
    release();
    await waitFor(() => expect(stored().name).toBe('Other tab'));
  });
});
