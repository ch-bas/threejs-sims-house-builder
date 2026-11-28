import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import { pinPlanImage, resolvePlanImage as resolveThroughRef } from './plan-image-ref';
import {
  checkPersistence,
  compactPlanImage,
  createMemoryPlanImageBackend,
  hashPlanImage,
  hasPlanImage,
  inlinePlanImageRefs,
  inlineRawPlanImages,
  isPlanImageRef,
  loadPlanImage,
  planImagePending,
  resetPlanImageStoreForTests,
  resolvePlanImage,
  planImageProblem,
  setPersistenceManagerForTests,
  setPlanImageBackendForTests,
  storePlanImage,
  storedPlanImageRef,
  subscribePlanImageStored,
  type PlanImageBackend,
} from './plan-image-store';
import { decodeShareUrl, encodeShareUrl } from './share';
import type { RoomLayout } from './types';

const PERSISTENT = { persisted: () => Promise.resolve(true) };
const IMAGE = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
const OTHER = `data:image/png;base64,${'B'.repeat(4000)}`;

describe('plan image store (#936)', () => {
  let records: Map<string, string>;
  beforeEach(() => {
    records = new Map();
    setPlanImageBackendForTests(createMemoryPlanImageBackend(records));
    setPersistenceManagerForTests(PERSISTENT);
  });
  afterEach(() => {
    resetPlanImageStoreForTests();
    vi.useRealTimers();
  });

  it('names an image by the SHA-256 of its text', async () => {
    const ref = await hashPlanImage(IMAGE);
    expect(isPlanImageRef(ref)).toBe(true);
    expect(ref).toBe(await hashPlanImage(IMAGE));
    expect(ref).not.toBe(await hashPlanImage(OTHER));
    expect(isPlanImageRef('sha256-xyz')).toBe(false);
    expect(isPlanImageRef(`sha256-${'0'.repeat(64)}`)).toBe(true);
    expect(isPlanImageRef(null)).toBe(false);
  });

  it('saves a stored image as its ref, and loads it back as the same image', async () => {
    const house = { name: 'A', floorPlanImage: IMAGE, floorPlanOpacity: 0.5 };
    // Not yet stored: the save keeps it inline.
    expect(compactPlanImage(house)).toBe(house);
    const ref = await storePlanImage(IMAGE);
    expect(ref).toBe(await hashPlanImage(IMAGE));
    expect(records.get(ref!)).toBe(IMAGE);
    expect(storedPlanImageRef(IMAGE)).toBe(ref);
    const compact = compactPlanImage(house);
    expect(compact).toEqual({ name: 'A', floorPlanImageRef: ref, floorPlanOpacity: 0.5 });
    expect(planImagePending(compact)).toBe(true);
    expect(hasPlanImage(compact)).toBe(true);
    // A new session reads it from the store, not from memory.
    resetPlanImageStoreForTests();
    setPlanImageBackendForTests(createMemoryPlanImageBackend(records));
    setPersistenceManagerForTests(PERSISTENT);
    expect(storedPlanImageRef(IMAGE)).toBeNull();
    const resolved = await resolvePlanImage(compact);
    expect(resolved).toEqual(house);
    // Read back whole, so it counts as stored for the next save.
    expect(storedPlanImageRef(IMAGE)).toBe(ref);
  });

  it('keeps every save inline where the store can’t be used (private windows, storage blocked)', async () => {
    setPlanImageBackendForTests(null);
    expect(await storePlanImage(IMAGE)).toBeNull();
    const house = { floorPlanImage: IMAGE };
    expect(compactPlanImage(house)).toBe(house);
    const named = { floorPlanImageRef: (await hashPlanImage(IMAGE))! };
    // A save that names an image keeps naming it, and the load keeps the name.
    expect(compactPlanImage(named)).toBe(named);
    expect(await resolvePlanImage(named)).toBe(named);
  });

  it('confirms an image only once it is read back whole', async () => {
    const lossy: PlanImageBackend = { put: () => Promise.resolve(), get: () => Promise.resolve(IMAGE.slice(0, 100)) };
    setPlanImageBackendForTests(lossy);
    expect(await storePlanImage(IMAGE)).toBeNull();
    expect(storedPlanImageRef(IMAGE)).toBeNull();
    const failing: PlanImageBackend = { put: () => Promise.reject(new DOMException('full', 'QuotaExceededError')), get: () => Promise.resolve(null) };
    setPlanImageBackendForTests(failing);
    expect(await storePlanImage(IMAGE)).toBeNull();
    expect(compactPlanImage({ floorPlanImage: IMAGE })).toEqual({ floorPlanImage: IMAGE });
  });

  it('never turns a ref into an image that doesn’t hash to it', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    records.set(ref, OTHER);
    expect(await loadPlanImage(ref)).toBeNull();
    const named = { floorPlanImageRef: ref };
    expect(await resolvePlanImage(named)).toBe(named);
    records.set(ref, 'not an image');
    expect(await loadPlanImage(ref)).toBeNull();
    expect(await loadPlanImage('sha256-nope')).toBeNull();
  });

  it('opens the house without its image, still naming it, when the store doesn’t answer in time', async () => {
    vi.useFakeTimers();
    setPlanImageBackendForTests({ put: () => Promise.resolve(), get: () => new Promise<string | null>(() => {}) });
    const named = { name: 'A', floorPlanImageRef: (await hashPlanImage(IMAGE))! };
    const resolving = resolvePlanImage(named, 1000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await resolving).toBe(named);
  });

  it('drops a stale ref beside an image that isn’t stored yet', () => {
    const stale = { floorPlanImage: OTHER, floorPlanImageRef: `sha256-${'1'.repeat(64)}` };
    expect(compactPlanImage(stale)).toEqual({ floorPlanImage: OTHER });
    // The house on screen holds the image: nothing to fetch.
    expect(planImagePending(stale)).toBe(false);
  });

  it('stores one image once however often it is asked, and says so once', async () => {
    const put = vi.fn((ref: string, image: string) => {
      records.set(ref, image);
      return Promise.resolve();
    });
    setPlanImageBackendForTests({ put, get: (ref) => Promise.resolve(records.get(ref) ?? null) });
    const heard = vi.fn();
    subscribePlanImageStored(heard);
    const [a, b] = await Promise.all([storePlanImage(IMAGE), storePlanImage(IMAGE)]);
    expect(a).toBe(b);
    expect(await storePlanImage(IMAGE)).toBe(a);
    expect(put).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(a);
    expect(await storePlanImage('https://example.com/plan.png')).toBeNull();
  });

  it('puts the images back in a file that must stand alone, copy on write', async () => {
    const ref = (await storePlanImage(IMAGE))!;
    const plain = { library: [{ layout: { name: 'x' } }] };
    expect(await inlinePlanImageRefs(plain)).toBe(plain);
    const bundle = { main: { floorPlanImageRef: ref, name: 'm' }, library: [{ name: 'l', layout: { floorPlanImageRef: ref } }, plain] };
    const inlined = (await inlinePlanImageRefs(bundle)) as typeof bundle;
    expect(inlined).toEqual({
      main: { floorPlanImage: IMAGE, name: 'm' },
      library: [{ name: 'l', layout: { floorPlanImage: IMAGE } }, plain],
    });
    expect(inlined.library[1]).toBe(plain);
    expect(bundle.main).toEqual({ floorPlanImageRef: ref, name: 'm' });
    const raw = JSON.stringify({ name: 'r', floorPlanImageRef: ref });
    expect(JSON.parse(await inlineRawPlanImages(raw))).toEqual({ name: 'r', floorPlanImage: IMAGE });
    expect(await inlineRawPlanImages('{"floorPlanImageRef": not json')).toBe('{"floorPlanImageRef": not json');
    const unknown = JSON.stringify({ floorPlanImageRef: `sha256-${'2'.repeat(64)}` });
    expect(await inlineRawPlanImages(unknown)).toBe(unknown);
  });
  it('a share link carries neither, and says it left the plan out', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    const pending: RoomLayout = makeLayout({ floorPlanImageRef: ref, floorPlanTransform: { scale: 0.02, offsetX: 0, offsetZ: 0 } });
    const { url, strippedFloorPlan } = await encodeShareUrl(pending, 'https://example.test/');
    expect(strippedFloorPlan).toBe(true);
    const decoded = await decodeShareUrl(url.slice(url.indexOf('#')));
    expect(decoded?.floorPlanImageRef).toBeUndefined();
    expect(decoded?.floorPlanTransform).toBeUndefined();
  });


  it('drops the inline copy only from persistent storage, never asking for it; inline elsewhere unless forced', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    let granted = false;
    setPersistenceManagerForTests({ persisted: () => Promise.resolve(granted), persist });
    const ref = await storePlanImage(IMAGE);
    expect(ref).not.toBeNull();
    // Asking is the storage-care rule's, after a real edit: never at a store or load.
    expect(persist).not.toHaveBeenCalled();
    const house = { floorPlanImage: IMAGE };
    // Stored, but the browser may evict it: the save keeps the image.
    expect(compactPlanImage(house)).toBe(house);
    // Unless only the ref fits.
    expect(compactPlanImage(house, true)).toEqual({ floorPlanImageRef: ref });
    // Granted later (the storage-care ask): the next read lets saves compact,
    // and the save's listeners hear of it.
    const heard = vi.fn();
    subscribePlanImageStored(heard);
    granted = true;
    await checkPersistence();
    expect(compactPlanImage(house)).toEqual({ floorPlanImageRef: ref });
    expect(heard).toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('doesn’t rewrite an image already stored under its hash (every load of a house by ref)', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    records.set(ref, IMAGE);
    const put = vi.fn(() => Promise.resolve());
    setPlanImageBackendForTests({ put, get: (key) => Promise.resolve(records.get(key) ?? null) });
    setPersistenceManagerForTests(PERSISTENT);
    expect(await storePlanImage(IMAGE)).toBe(ref);
    expect(put).not.toHaveBeenCalled();
    // A damaged record is written again.
    records.set(ref, OTHER);
    resetPlanImageStoreForTests();
    const fixing = vi.fn((key: string, image: string) => Promise.resolve(void records.set(key, image)));
    setPlanImageBackendForTests({ put: fixing, get: (key) => Promise.resolve(records.get(key) ?? null) });
    expect(await storePlanImage(IMAGE)).toBe(ref);
    expect(fixing).toHaveBeenCalledTimes(1);
    expect(records.get(ref)).toBe(IMAGE);
  });

  it('never forgets the image on screen, however many others are stored', async () => {
    const shown = `data:image/png;base64,${'S'.repeat(500)}`;
    const shownRef = await storePlanImage(shown);
    pinPlanImage(shown);
    const first = `data:image/png;base64,${'0'.repeat(500)}`;
    await storePlanImage(first);
    for (let index = 1; index <= 12; index++) await storePlanImage(`data:image/png;base64,${String(index % 10).repeat(500 + index)}`);
    expect(storedPlanImageRef(shown)).toBe(shownRef);
    expect(compactPlanImage({ floorPlanImage: shown })).toEqual({ floorPlanImageRef: shownRef });
    // An image no house shows may be forgotten: its next save is inline until stored again.
    expect(storedPlanImageRef(first)).toBeNull();
  });

  it('tells an image gone from the store apart from a store that can’t be read', async () => {
    const ref = (await hashPlanImage(IMAGE))!;
    const named = { floorPlanImageRef: ref };
    await resolvePlanImage(named);
    expect(planImageProblem(ref)).toBe('gone');
    setPlanImageBackendForTests(null);
    await resolvePlanImage(named);
    expect(planImageProblem(ref)).toBe('unavailable');
    setPlanImageBackendForTests({ put: () => Promise.resolve(), get: () => Promise.reject(new DOMException('x', 'UnknownError')) });
    await resolvePlanImage(named);
    expect(planImageProblem(ref)).toBe('unavailable');
    records.set(ref, IMAGE);
    setPlanImageBackendForTests(createMemoryPlanImageBackend(records));
    await resolvePlanImage(named);
    expect(planImageProblem(ref)).toBeNull();
  });

  it('bounds the whole wait, the store’s own loading included', async () => {
    vi.useFakeTimers();
    setPlanImageBackendForTests({ put: () => Promise.resolve(), get: () => new Promise<string | null>(() => {}) });
    const ref = (await hashPlanImage(IMAGE))!;
    const named = { floorPlanImageRef: ref };
    const resolving = resolveThroughRef(named, 1000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await resolving).toBe(named);
    expect(planImageProblem(ref)).toBe('unavailable');
  });
});
