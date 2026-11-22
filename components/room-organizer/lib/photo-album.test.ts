import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALBUM_CAP,
  albumFileExtension,
  albumPhotoFile,
  browserImageChannels,
  createMemoryAlbumStore,
  deleteFromAlbum,
  evictionFor,
  fallbackStateFor,
  fitEdge,
  isAlbumPhoto,
  isQuotaError,
  keepInAlbum,
  newPhotoId,
  oldestFirst,
  openAlbum,
  photoShareData,
  resetAlbumForTests,
  saveToAlbum,
  sharePhoto,
  sheetTakesFile,
  subscribeAlbum,
  transactionDone,
  type AlbumPhoto,
  type AlbumStore,
} from './photo-album';
import { deliverHouseFile, type FileChannels } from './share-delivery';

afterEach(() => resetAlbumForTests());

function photo(id: string, takenAt: number, houseId = 'house-a'): AlbumPhoto {
  return { id, houseId, takenAt, hour: 12, weather: 'clear', image: new ArrayBuffer(8), imageType: 'image/jpeg', thumb: null };
}

async function fill(store: AlbumStore, count: number, houseId = 'house-a'): Promise<void> {
  for (let i = 0; i < count; i++) await store.put(photo(`${houseId}-${i}`, 1000 + i, houseId));
}

describe('photo album (#912)', () => {
  it('lists one house’s photos oldest first', async () => {
    const store = createMemoryAlbumStore();
    await store.put(photo('b', 2000));
    await store.put(photo('a', 1000));
    await store.put(photo('other', 1500, 'house-b'));
    expect((await store.listHouse('house-a')).map((p) => p.id)).toEqual(['a', 'b']);
    expect((await store.listHouse('house-b')).map((p) => p.id)).toEqual(['other']);
    expect(store.state).toBe('session');
  });

  it('orders ties by id, so the oldest-out choice is stable', () => {
    expect(oldestFirst([photo('b', 5), photo('a', 5), photo('c', 1)]).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('evicts nothing under the cap, and the oldest at it', () => {
    const photos = Array.from({ length: ALBUM_CAP }, (_, i) => photo(`p${i}`, 100 - i));
    expect(evictionFor(photos.slice(1))).toEqual([]);
    expect(evictionFor(photos).map((p) => p.id)).toEqual([`p${ALBUM_CAP - 1}`]);
    expect(evictionFor(photos, 28).map((p) => p.id)).toHaveLength(3);
  });

  it('saves without asking under the cap, and tells its viewers', async () => {
    const store = createMemoryAlbumStore();
    const ask = vi.fn(() => Promise.resolve(true));
    const seen = vi.fn();
    subscribeAlbum(seen);
    expect(await saveToAlbum(store, photo('new', 5000), ask)).toEqual({ kind: 'saved', evicted: 0, state: 'session' });
    expect(ask).not.toHaveBeenCalled();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('asks before the oldest go at the cap, and keeps everything on a no', async () => {
    const store = createMemoryAlbumStore();
    await fill(store, ALBUM_CAP);
    await fill(store, 3, 'house-b');
    const no = vi.fn(() => Promise.resolve(false));
    expect(await saveToAlbum(store, photo('new', 9000), no)).toEqual({ kind: 'declined' });
    expect(no).toHaveBeenCalledWith(1);
    expect(await store.listHouse('house-a')).toHaveLength(ALBUM_CAP);

    expect(await saveToAlbum(store, photo('new', 9000), () => Promise.resolve(true))).toEqual({ kind: 'saved', evicted: 1, state: 'session' });
    const kept = await store.listHouse('house-a');
    expect(kept).toHaveLength(ALBUM_CAP);
    expect(kept[0]?.id).toBe('house-a-1');
    expect(kept.at(-1)?.id).toBe('new');
    // Another house's photos never count against this one.
    expect(await store.listHouse('house-b')).toHaveLength(3);
  });

  it('comes back down to the cap when another tab saved during the question', async () => {
    const store = createMemoryAlbumStore();
    await fill(store, ALBUM_CAP);
    const otherTab = () => store.put(photo('other-tab', 8000)).then(() => true);
    expect(await saveToAlbum(store, photo('new', 9000), otherTab)).toEqual({ kind: 'saved', evicted: 2, state: 'session' });
    const kept = await store.listHouse('house-a');
    expect(kept).toHaveLength(ALBUM_CAP);
    expect(kept.slice(-2).map((p) => p.id)).toEqual(['other-tab', 'new']);
  });

  it('reports a full disk and loses nothing', async () => {
    const memory = createMemoryAlbumStore();
    await fill(memory, ALBUM_CAP);
    const remove = vi.fn(memory.remove);
    const full: AlbumStore = {
      ...memory,
      state: 'persistent',
      remove,
      put: () => Promise.reject(new DOMException('full', 'QuotaExceededError')),
      listHouse: memory.listHouse,
    };
    expect(await saveToAlbum(full, photo('new', 9000), () => Promise.resolve(true))).toEqual({ kind: 'full' });
    expect(remove).not.toHaveBeenCalled();
    expect(await memory.listHouse('house-a')).toHaveLength(ALBUM_CAP);
    const io = new Error('io');
    const broken: AlbumStore = { ...memory, put: () => Promise.reject(io) };
    expect(await saveToAlbum(broken, photo('new', 9000), () => Promise.resolve(true))).toEqual({ kind: 'failed', error: io });
  });

  it('deletes from the page’s album and tells its viewers', async () => {
    const store = await openAlbum(null);
    await fill(store, 3);
    const seen = vi.fn();
    subscribeAlbum(seen);
    expect(await deleteFromAlbum(['house-a-1'])).toBe(true);
    expect((await store.listHouse('house-a')).map((p) => p.id)).toEqual(['house-a-0', 'house-a-2']);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('stops around the question once photo mode has ended', async () => {
    const store = createMemoryAlbumStore();
    await fill(store, ALBUM_CAP);
    let ended = false;
    const ask = vi.fn(() => {
      ended = true;
      return Promise.resolve(true);
    });
    expect(await saveToAlbum(store, photo('new', 9000), ask, { stopped: () => ended })).toEqual({ kind: 'cancelled' });
    expect((await store.listHouse('house-a')).some((p) => p.id === 'new')).toBe(false);
    const never = vi.fn(() => Promise.resolve(true));
    expect(await saveToAlbum(store, photo('new', 9000), never, { stopped: () => true })).toEqual({ kind: 'cancelled' });
    expect(never).not.toHaveBeenCalled();
  });

  it('moves to memory, and says so, when the database refuses a write (Safari private windows)', async () => {
    const store = await openAlbum(null);
    // Pretend the page's album is the database, which refuses every put.
    Object.assign(store, { state: 'persistent', put: () => Promise.reject(new DOMException('x', 'UnknownError')) });
    const seen = vi.fn();
    subscribeAlbum(seen);
    const result = await keepInAlbum(photo('new', 9000), () => Promise.resolve(true));
    expect(result).toEqual({ kind: 'saved', evicted: 0, state: 'session' });
    const now = await openAlbum(null);
    expect(now.state).toBe('session');
    expect((await now.listHouse('house-a')).map((p) => p.id)).toEqual(['new']);
    expect(seen).toHaveBeenCalled();
  });

  it('tells a newer page’s database from no database', () => {
    expect(fallbackStateFor(new DOMException('x', 'VersionError'))).toBe('blocked');
    expect(fallbackStateFor(new DOMException('x', 'UnknownError'))).toBe('session');
  });

  it('classes a write aborted for the quota as full, from the request when the transaction has no error', async () => {
    const transaction = { error: null } as unknown as IDBTransaction & Record<string, unknown>;
    const done = transactionDone(transaction);
    const quota = new DOMException('full', 'QuotaExceededError');
    (transaction.onerror as (event: unknown) => void)({ target: { error: quota } });
    (transaction.onabort as () => void)();
    await expect(done).rejects.toBe(quota);
    expect(isQuotaError(quota)).toBe(true);
  });

  it('reads only records it understands', () => {
    expect(isAlbumPhoto(photo('a', 1))).toBe(true);
    expect(isAlbumPhoto({ ...photo('a', 1), image: new Blob(['x']) })).toBe(false);
    expect(isAlbumPhoto(null)).toBe(false);
    expect(albumFileExtension('image/jpeg')).toBe('jpg');
    expect(albumFileExtension('image/png')).toBe('png');
  });

  it('makes a photo into a file named by the download rule, of its own type', async () => {
    const jpeg = albumPhotoFile(photo('a', 1), 'Garden Flat');
    expect(jpeg.name).toBe('garden-flat-photo.jpg');
    expect(jpeg.type).toBe('image/jpeg');
    expect(jpeg.size).toBe(8);
    expect(albumPhotoFile({ image: new ArrayBuffer(1), imageType: 'image/png' }, 'Garden Flat').name).toBe('garden-flat-photo.png');
  });

  it('asks the share sheet whether it takes the image, and hears no for a missing member or a throw', () => {
    const file = albumPhotoFile(photo('a', 1), 'Garden Flat');
    const share = () => Promise.resolve();
    expect(sheetTakesFile({ share, canShare: () => true }, file)).toBe(true);
    expect(sheetTakesFile({ share, canShare: () => false }, file)).toBe(false);
    expect(sheetTakesFile({ share }, file)).toBe(false);
    expect(sheetTakesFile({ canShare: () => true }, file)).toBe(false);
    expect(sheetTakesFile(undefined, file)).toBe(false);
    const throwing = () => {
      throw new TypeError('no files');
    };
    expect(sheetTakesFile({ share, canShare: throwing }, file)).toBe(false);
  });

  it('hands a file over by the same rule as the house file (a copy kept out of the editor’s bundle)', async () => {
    const file = albumPhotoFile(photo('a', 1), 'Garden Flat');
    const sheets: Array<FileChannels['shareFile']> = [
      undefined,
      () => Promise.resolve(),
      () => Promise.reject(new DOMException('Dismissed', 'AbortError')),
      () => Promise.reject(new DOMException('No gesture', 'NotAllowedError')),
      () => Promise.reject(new DOMException('Busy', 'InvalidStateError')),
      () => Promise.reject(new TypeError('Not a file the sheet takes')),
    ];
    for (const shareFile of sheets) {
      const run = async (deliver: (file: File, channels: FileChannels) => Promise<string>) => {
        const calls: string[] = [];
        const channels: FileChannels = {
          ...(shareFile ? { shareFile: (sent: File) => (calls.push(`share ${sent.name}`), shareFile(sent)) } : {}),
          download: (sent: File) => {
            calls.push(`download ${sent.name}`);
          },
        };
        const outcome = await deliver(file, channels);
        return { outcome, calls };
      };
      expect(await run(sharePhoto)).toEqual(await run(deliverHouseFile));
    }
  });

  it('hands the sheet the photo alone, with no title to show its file name or hide Save Image', async () => {
    const file = albumPhotoFile(photo('a', 1), 'Garden Flat');
    expect(photoShareData(file)).toEqual({ files: [file] });
    const share = vi.fn((_data: ShareData) => Promise.resolve());
    vi.stubGlobal('navigator', { share, canShare: () => true });
    try {
      expect(await sharePhoto(file, browserImageChannels())).toBe('shared');
      expect(share).toHaveBeenCalledWith({ files: [file] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shares through the sheet in the same task, downloads when it fails, and does nothing when dismissed', async () => {
    const file = albumPhotoFile(photo('a', 1), 'Garden Flat');
    const shareFile = vi.fn(() => Promise.resolve());
    const download = vi.fn();
    const sent = sharePhoto(file, { shareFile, download });
    // Before anything is awaited: inside the tap.
    expect(shareFile).toHaveBeenCalledWith(file);
    expect(await sent).toBe('shared');
    const dismissed = () => Promise.reject(new DOMException('Dismissed', 'AbortError'));
    expect(await sharePhoto(file, { shareFile: dismissed, download })).toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
    const refused = () => Promise.reject(new DOMException('No gesture', 'NotAllowedError'));
    expect(await sharePhoto(file, { shareFile: refused, download })).toBe('downloaded');
    expect(await sharePhoto(file, { download })).toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledWith(file);
  });

  it('falls back to memory where IndexedDB won’t open', async () => {
    const refusing = {
      open: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const store = await openAlbum(refusing);
    expect(store.state).toBe('session');
    expect(await openAlbum(refusing)).toBe(store);
    resetAlbumForTests();
    expect((await openAlbum(null)).state).toBe('session');
    resetAlbumForTests();
    const newer = { open: () => { throw new DOMException('newer', 'VersionError'); } } as unknown as IDBFactory;
    expect((await openAlbum(newer)).state).toBe('blocked');
  });

  it('sizes a thumbnail down, never up', () => {
    expect(fitEdge(4000, 2000, 320)).toEqual({ width: 320, height: 160 });
    expect(fitEdge(900, 1800, 320)).toEqual({ width: 160, height: 320 });
    expect(fitEdge(200, 100, 320)).toEqual({ width: 200, height: 100 });
    expect(fitEdge(2880, 1800, 2048)).toEqual({ width: 2048, height: 1280 });
    expect(fitEdge(0, 100, 320)).toEqual({ width: 1, height: 1 });
  });

  it('knows a quota error by name', () => {
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('x'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('mints distinct ids', () => {
    expect(newPhotoId(1)).not.toBe(newPhotoId(1));
  });
});
