// @vitest-environment jsdom
// Every path a house takes in and out of storage, with its floor-plan image
// in the image store (#936).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutReducer } from '../hooks/layout-reducer';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { backupNamesPlanImages, createBackup, inlineBackupPlanImages, parseBackup, restoreBackup, storeBackupPlanImages } from './backup';
import { STORAGE_KEY } from './constants';
import { listSavedLayouts, loadNamedLayout, saveNamedLayout } from './library';
import { addReceivedLayout, listReceivedLayouts } from './pasteboard';
import { compactStoredHouse, keepStoredLayout, loadLayout, readRecoveryCopies, saveLayout } from './persistence';
import {
  createMemoryPlanImageBackend,
  hashPlanImage,
  resetPlanImageStoreForTests,
  resolvePlanImage,
  setPersistenceManagerForTests,
  setPlanImageBackendForTests,
  storePlanImage,
} from './plan-image-store';
import { SAVED_BY_STORAGE_KEY } from './saved-by';
import { parseStoredLayout } from './schema';
import { getSnapshot, listSnapshots, recordSnapshot, type VersionHistoryStore } from './version-history';
import type { RoomLayout } from './types';

const PERSISTENT = { persisted: () => Promise.resolve(true) };
const NOT_PERSISTENT = { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) };
const IMAGE = `data:image/jpeg;base64,${'Z'.repeat(30000)}`;
const TRANSFORM = { scale: 0.02, offsetX: 0.5, offsetZ: -1 };

const traced = (name = 'Traced'): RoomLayout =>
  makeLayout({ id: `house-${name}`, name, floorPlanImage: IMAGE, floorPlanTransform: TRANSFORM, floors: [makeFloor()] });

const storedMain = (): Record<string, unknown> => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Record<string, unknown>;

describe('plan images through every storage path (#936)', () => {
  let records: Map<string, string>;
  let ref: string;
  beforeEach(async () => {
    window.localStorage.clear();
    records = new Map();
    setPlanImageBackendForTests(createMemoryPlanImageBackend(records));
    setPersistenceManagerForTests(PERSISTENT);
    ref = (await hashPlanImage(IMAGE))!;
  });
  afterEach(() => resetPlanImageStoreForTests());

  it('the autosave: inline until stored, then the ref; and it loads back with the ref for the hook to resolve', async () => {
    const layout = traced();
    expect(saveLayout(layout, window.localStorage).ok).toBe(true);
    expect(storedMain().floorPlanImage).toBe(IMAGE);
    await storePlanImage(IMAGE);
    const saved = saveLayout(layout, window.localStorage);
    expect(saved.ok && saved.json.length).toBeLessThan(2000);
    expect(storedMain().floorPlanImageRef).toBe(ref);
    expect(storedMain().floorPlanImage).toBeUndefined();
    const loaded = loadLayout();
    expect(loaded?.floorPlanImageRef).toBe(ref);
    expect(loaded?.floorPlanTransform).toEqual(TRANSFORM);
    expect((await resolvePlanImage(loaded!)).floorPlanImage).toBe(IMAGE);
  });

  it('the migration rewrites only the image field, never over a newer build’s save, and stamps the save', async () => {
    const raw = JSON.stringify({ ...traced(), extra: 'kept as stored' });
    window.localStorage.setItem(STORAGE_KEY, raw);
    // Not stored yet: nothing to do.
    expect(compactStoredHouse(window.localStorage, '1.39.0')).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    await storePlanImage(IMAGE);
    window.localStorage.setItem(SAVED_BY_STORAGE_KEY, '9.0.0');
    expect(compactStoredHouse(window.localStorage, '1.39.0')).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    window.localStorage.setItem(SAVED_BY_STORAGE_KEY, '1.38.0');
    const json = compactStoredHouse(window.localStorage, '1.39.0');
    expect(json).toBe(window.localStorage.getItem(STORAGE_KEY));
    const { floorPlanImage: _image, ...rest } = JSON.parse(raw) as Record<string, unknown>;
    expect(storedMain()).toEqual({ ...rest, floorPlanImageRef: ref });
    // An older build reading it now asks before it saves over the ref.
    expect(window.localStorage.getItem(SAVED_BY_STORAGE_KEY)).toBe('1.39.0');
    // Done once: a second pass finds nothing inline.
    expect(compactStoredHouse(window.localStorage, '1.39.0')).toBeNull();
  });

  it('a recovered copy inline and the save by ref are one house: no second copy is kept', async () => {
    // A house the schema opens with no repair, as a save's own house is.
    const plain = parseStoredLayout(JSON.parse(JSON.stringify(makeLayout({ id: 'h', name: 'Plain', floorPlanImage: IMAGE, floors: [makeFloor()] }))))!;
    expect(parseStoredLayout(JSON.parse(JSON.stringify(plain)))).toEqual(plain);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plain));
    expect(keepStoredLayout(window.localStorage)).toBe('kept');
    await storePlanImage(IMAGE);
    compactStoredHouse(window.localStorage, null);
    expect(storedMain().floorPlanImageRef).toBe(ref);
    expect(keepStoredLayout(window.localStorage)).toBe('nothing');
    expect(readRecoveryCopies()).toHaveLength(1);
  });

  it('the library saves a stored image by ref, and a load resolves it', async () => {
    await storePlanImage(IMAGE);
    const saved = saveNamedLayout(traced('Library copy'), 'Library copy');
    expect(saved.ok).toBe(true);
    const raw = window.localStorage.getItem('standalone-room-organizer-library:library-copy') ?? '';
    expect(raw).toContain(ref);
    expect(raw).not.toContain(IMAGE);
    const loaded = loadNamedLayout('library-copy');
    expect(loaded?.floorPlanImageRef).toBe(ref);
    expect((await resolvePlanImage(loaded!)).floorPlanImage).toBe(IMAGE);
  });

  it('a backup inlines every stored image, and restoring it into a fresh browser stores them again', async () => {
    await storePlanImage(IMAGE);
    saveLayout({ ...traced('Main'), floors: [makeFloor({ floorColor: '#123456' })] }, window.localStorage);
    saveNamedLayout(traced('Library copy'), 'Library copy');
    // A recovered copy of the save, by ref, as kept.
    expect(keepStoredLayout(window.localStorage)).toBe('kept');
    const asStored = createBackup(null);
    expect(backupNamesPlanImages(asStored)).toBe(true);
    const bundle = await inlineBackupPlanImages(asStored);
    expect(backupNamesPlanImages(bundle)).toBe(false);
    const text = JSON.stringify(bundle);
    expect(text).not.toContain(ref);
    expect(bundle.recoveryCopies[0]?.raw).toContain(IMAGE);
    expect((bundle.main as RoomLayout).floorPlanImage).toBe(IMAGE);
    expect((bundle.library[0]?.layout as RoomLayout).floorPlanImage).toBe(IMAGE);

    // A fresh browser: nothing stored, an empty image store.
    window.localStorage.clear();
    resetPlanImageStoreForTests();
    const fresh = new Map<string, string>();
    setPlanImageBackendForTests(createMemoryPlanImageBackend(fresh));
    setPersistenceManagerForTests(PERSISTENT);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await storeBackupPlanImages(parsed.bundle);
    expect(fresh.get(ref)).toBe(IMAGE);
    restoreBackup(parsed.bundle, makeLayout({ name: 'Open' }));
    const names = listSavedLayouts().map((entry) => entry.name).sort();
    expect(names).toEqual(['Library copy', 'Main (backup)']);
    for (const entry of listSavedLayouts()) {
      const loaded = loadNamedLayout(entry.id)!;
      expect((await resolvePlanImage(loaded)).floorPlanImage).toBe(IMAGE);
    }
    // Restoring the same file again adds nothing: the copies by ref are the houses in the file.
    restoreBackup(parsed.bundle, makeLayout({ name: 'Open' }));
    expect(listSavedLayouts()).toHaveLength(2);
  });

  it('restore points and received houses carry neither the image nor its ref', async () => {
    const pending: RoomLayout = { ...traced(), floorPlanImageRef: ref };
    delete pending.floorPlanImage;
    expect(recordSnapshot(pending, { storage: window.localStorage, force: true })).toBe(true);
    const [summary] = listSnapshots({ storage: window.localStorage });
    expect(summary?.hadFloorPlan).toBe(true);
    const snapshot = getSnapshot(summary!.id, { storage: window.localStorage });
    expect(snapshot?.floorPlanImageRef).toBeUndefined();
    expect(snapshot?.floorPlanImage).toBeUndefined();
    addReceivedLayout(pending, { storage: window.localStorage });
    expect(listReceivedLayouts({ storage: window.localStorage })[0]?.layout.floorPlanImageRef).toBeUndefined();
  });

  it('the schema reads a ref and refuses a malformed one; the reducer keeps ref and image apart', () => {
    const named = { ...makeLayout({ floorPlanTransform: TRANSFORM }), floorPlanImageRef: ref };
    expect(parseStoredLayout(named)?.floorPlanImageRef).toBe(ref);
    expect(parseStoredLayout({ ...named, floorPlanImageRef: 'https://example.com/x.png' })).toBeNull();
    // A whole-house load keeps the calibration of an image it only names.
    const loaded = layoutReducer({ layout: makeLayout(), activeFloorIndex: 0 }, { type: 'applyLayout', layout: named });
    expect(loaded.layout.floorPlanTransform).toEqual(TRANSFORM);
    // A new image replaces the named one; removing the plan drops the ref.
    const uploaded = layoutReducer(loaded, { type: 'setFloorPlan', image: IMAGE });
    expect(uploaded.layout.floorPlanImage).toBe(IMAGE);
    expect(uploaded.layout.floorPlanImageRef).toBeUndefined();
    const removed = layoutReducer(loaded, { type: 'setFloorPlan', image: null });
    expect(removed.layout.floorPlanImageRef).toBeUndefined();
    expect(removed.layout.floorPlanTransform).toBeUndefined();
    const bare = { layout: makeLayout(), activeFloorIndex: 0 };
    expect(layoutReducer(bare, { type: 'setFloorPlan', image: null })).toBe(bare);
  });

  it('where storage may be evicted, saves keep the image inline unless only the ref fits', async () => {
    setPersistenceManagerForTests(NOT_PERSISTENT);
    await storePlanImage(IMAGE);
    const layout = traced();
    expect(saveLayout(layout, window.localStorage).ok).toBe(true);
    expect(storedMain().floorPlanImage).toBe(IMAGE);
    window.localStorage.setItem(SAVED_BY_STORAGE_KEY, '1.38.0');
    // Nor does the migration drop the inline copy.
    expect(compactStoredHouse(window.localStorage, '1.39.0')).toBeNull();
    expect(storedMain().floorPlanImage).toBe(IMAGE);
    // A store too small for the image: the ref is saved rather than nothing.
    const data = new Map<string, string>();
    const small: VersionHistoryStore = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (value.length > 5000) throw new DOMException('full', 'QuotaExceededError');
        data.set(key, value);
      },
      removeItem: (key) => void data.delete(key),
    };
    const saved = saveLayout(layout, small);
    expect(saved.ok).toBe(true);
    expect(JSON.parse(data.get(STORAGE_KEY)!)).toMatchObject({ floorPlanImageRef: ref });
    // An image not in the store has no ref to fall back on: the save fails as before.
    resetPlanImageStoreForTests();
    setPlanImageBackendForTests(null);
    expect(saveLayout(layout, small)).toEqual({ ok: false, reason: 'quota' });
  });

  it('a library copy where storage may be evicted stays inline unless only the ref leaves room', async () => {
    setPersistenceManagerForTests(NOT_PERSISTENT);
    await storePlanImage(IMAGE);
    expect(saveNamedLayout(traced('Inline copy'), 'Inline copy').ok).toBe(true);
    expect(window.localStorage.getItem('standalone-room-organizer-library:inline-copy')).toContain(IMAGE);
  });

  it('a restore point names its image’s ref, held inline or only named, never the image', async () => {
    await storePlanImage(IMAGE);
    expect(recordSnapshot(traced('Inline'), { storage: window.localStorage, force: true })).toBe(true);
    const pending: RoomLayout = { ...traced('Named'), floorPlanImageRef: ref };
    delete pending.floorPlanImage;
    expect(recordSnapshot(pending, { storage: window.localStorage, force: true })).toBe(true);
    const refs = listSnapshots({ storage: window.localStorage }).map((summary) => summary.floorPlanRef);
    expect(refs).toEqual([ref, ref]);
    expect(window.localStorage.getItem('standalone-room-organizer-layout-versions')).not.toContain(IMAGE.slice(0, 200));
  });

  it('a backup says when an image couldn’t be put back, and a restore can’t hang on the store', async () => {
    const gone: RoomLayout = { ...traced(), floorPlanImageRef: `sha256-${'5'.repeat(64)}` };
    delete gone.floorPlanImage;
    saveLayout(gone, window.localStorage);
    const bundle = await inlineBackupPlanImages(createBackup(null));
    expect(backupNamesPlanImages(bundle)).toBe(true);

    vi.useFakeTimers();
    try {
      setPlanImageBackendForTests({ put: () => new Promise<void>(() => {}), get: () => new Promise<string | null>(() => {}) });
      const parsed = parseBackup(JSON.stringify(await inlineBackupPlanImages(createBackup(traced()))));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      let done = false;
      void storeBackupPlanImages(parsed.bundle).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(5001);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
