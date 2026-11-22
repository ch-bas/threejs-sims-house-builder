/**
 * The photo album (#912): photos kept per house in this browser's
 * IndexedDB, the app's first use of it. Nothing here goes near
 * localStorage, restore points or backups: the album is a separate tenant
 * with its own quota. No React and no Three.js; loaded with `import()` as
 * photo mode opens, so it stays out of the first-load bundle.
 *
 * Records hold plain bytes (`ArrayBuffer`) and a data-URL thumbnail, never
 * Blobs: Safari's private windows open IndexedDB but refuse to store a
 * Blob. Where the database can't be used at all, an in-memory album keeps
 * the session's photos and says so through `state`.
 */

import { downloadBlob, exportFileName } from './plan-export/download';
import type { FileChannels, FileOutcome } from './share-delivery';
import type { Weather } from './types';

/** Photos kept per house; the oldest go first, after asking. */
export const ALBUM_CAP = 30;
/** The longest edge of the album's copy (px): the full-size PNG is the download's. */
export const ALBUM_MAX_EDGE = 2048;
/** JPEG quality of the album's copy. */
export const ALBUM_QUALITY = 0.9;
/** The longest edge of a thumbnail (px). */
export const THUMB_MAX_EDGE = 320;

export interface AlbumPhoto {
  id: string;
  /** `layout.id` of the house in the shot (copies of a house share it). */
  houseId: string;
  /** Epoch ms. */
  takenAt: number;
  /** The scene's hour, [0, 24). */
  hour: number;
  weather: Weather;
  /** The album's copy of the shot: a JPEG, at most `ALBUM_MAX_EDGE` px. */
  image: ArrayBuffer;
  imageType: string;
  /** A small JPEG as a data URL (the page allows `data:` images, not `blob:`), or null. */
  thumb: string | null;
}

/**
 * Where the album lives: `persistent` in IndexedDB; `session` in memory
 * because this browser won't store it; `blocked` in memory because a newer
 * version of the page holds the database in another tab.
 */
export type AlbumState = 'persistent' | 'session' | 'blocked';

export interface AlbumStore {
  readonly state: AlbumState;
  put(photo: AlbumPhoto): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  /** One house's photos, oldest first. */
  listHouse(houseId: string): Promise<AlbumPhoto[]>;
}

export type AlbumSaveResult =
  | { kind: 'saved'; evicted: number; state: AlbumState }
  | { kind: 'declined' }
  | { kind: 'cancelled' }
  | { kind: 'full' }
  | { kind: 'failed'; error: unknown };

/** Sort a house's photos oldest first; ties by id, so the order is stable. */
export function oldestFirst(photos: readonly AlbumPhoto[]): AlbumPhoto[] {
  return [...photos].sort((a, b) => a.takenAt - b.takenAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The photos that must go so one more fits under `cap`: the oldest. */
export function evictionFor(photos: readonly AlbumPhoto[], cap: number = ALBUM_CAP): AlbumPhoto[] {
  const over = photos.length + 1 - Math.max(1, cap);
  return over > 0 ? oldestFirst(photos).slice(0, over) : [];
}

/** A size with its longest edge `maxEdge` at most, never upscaled, at least 1 px. */
export function fitEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether a store failure is the quota running out. */
export function isQuotaError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

function errorName(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
}

/** What the album falls back to after `error`: a newer page's database, or none. */
export function fallbackStateFor(error: unknown): AlbumState {
  return errorName(error) === 'VersionError' ? 'blocked' : 'session';
}

/** A stored record this version can read (anything else is skipped). */
export function isAlbumPhoto(value: unknown): value is AlbumPhoto {
  if (typeof value !== 'object' || value === null) return false;
  const photo = value as Partial<AlbumPhoto>;
  return (
    typeof photo.id === 'string' &&
    typeof photo.houseId === 'string' &&
    typeof photo.takenAt === 'number' &&
    typeof photo.hour === 'number' &&
    typeof photo.imageType === 'string' &&
    photo.image instanceof ArrayBuffer &&
    (photo.thumb === null || typeof photo.thumb === 'string')
  );
}

export interface SaveOptions {
  cap?: number;
  /** True once the save should stop (photo mode ended): checked around the question. */
  stopped?: () => boolean;
}

/**
 * Keep `photo` in `store`. At `cap` photos, `confirmEvict` is asked first
 * with how many old ones would go; a no keeps the album as it was. The new
 * photo is written before the old ones go, so a full disk loses nothing.
 */
export async function saveToAlbum(
  store: AlbumStore,
  photo: AlbumPhoto,
  confirmEvict: (count: number) => Promise<boolean>,
  { cap = ALBUM_CAP, stopped = () => false }: SaveOptions = {},
): Promise<AlbumSaveResult> {
  let evict: AlbumPhoto[];
  try {
    evict = evictionFor(await store.listHouse(photo.houseId), cap);
  } catch (error) {
    return { kind: 'failed', error };
  }
  if (stopped()) return { kind: 'cancelled' };
  if (evict.length > 0) {
    const yes = await confirmEvict(evict.length);
    if (stopped()) return { kind: 'cancelled' };
    if (!yes) return { kind: 'declined' };
  }
  try {
    await store.put(photo);
  } catch (error) {
    return isQuotaError(error) ? { kind: 'full' } : { kind: 'failed', error };
  }
  let evicted = 0;
  try {
    if (evict.length > 0) {
      // Re-read: another tab may have saved meanwhile. The player agreed to
      // the oldest going, so the album comes back down to the cap.
      const now = oldestFirst(await store.listHouse(photo.houseId)).filter((old) => old.id !== photo.id);
      const gone = now.slice(0, Math.max(evict.length, now.length + 1 - Math.max(1, cap)));
      await store.remove(gone.map((old) => old.id));
      evicted = gone.length;
    }
  } catch {
    // The new photo is kept; the old ones stay one save longer.
  }
  notifyAlbumChanged();
  return { kind: 'saved', evicted, state: store.state };
}

/**
 * Keep `photo` in the page's album. When the database fails for any reason
 * but the quota, the album moves to memory for the rest of the session
 * (its viewers are told) and the photo is kept there.
 */
export async function keepInAlbum(
  photo: AlbumPhoto,
  confirmEvict: (count: number) => Promise<boolean>,
  options: SaveOptions = {},
): Promise<AlbumSaveResult> {
  const store = await openAlbum();
  const result = await saveToAlbum(store, photo, confirmEvict, options);
  if (result.kind !== 'failed' || store.state !== 'persistent') return result;
  return saveToAlbum(moveAlbumToMemory(fallbackStateFor(result.error)), photo, confirmEvict, options);
}

/** Delete photos and tell the album's viewers. */
export async function deleteFromAlbum(ids: readonly string[]): Promise<boolean> {
  try {
    await (await openAlbum()).remove(ids);
  } catch {
    return false;
  }
  notifyAlbumChanged();
  return true;
}

// ── change notices, in this tab and the others ─────────────────────────

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
const CHANNEL_NAME = 'standalone-room-organizer-album';

/** Follow saves and deletes, here and in other tabs; returns the unsubscribe. */
export function subscribeAlbum(listener: () => void): () => void {
  listeners.add(listener);
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => emit();
    } catch {
      channel = null;
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && channel) {
      channel.close();
      channel = null;
    }
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

function notifyAlbumChanged(): void {
  emit();
  // Another tab's album may show this house too; a memory album is this tab's alone.
  if (current?.state !== 'persistent' || typeof BroadcastChannel === 'undefined') return;
  try {
    const sender = new BroadcastChannel(CHANNEL_NAME);
    sender.postMessage('changed');
    sender.close();
  } catch {
    // No channel: the other tab re-reads when it next opens the album.
  }
}

// ── stores ─────────────────────────────────────────────────────────────

/** An in-memory album, for a session the database can't hold, and the tests. */
export function createMemoryAlbumStore(state: AlbumState = 'session'): AlbumStore {
  const photos = new Map<string, AlbumPhoto>();
  return {
    state,
    put(photo) {
      photos.set(photo.id, photo);
      return Promise.resolve();
    },
    remove(ids) {
      for (const id of ids) photos.delete(id);
      return Promise.resolve();
    },
    listHouse(houseId) {
      return Promise.resolve(oldestFirst([...photos.values()].filter((photo) => photo.houseId === houseId)));
    },
  };
}

export const ALBUM_DB_NAME = 'standalone-room-organizer-album';
const ALBUM_DB_VERSION = 1;
const PHOTOS = 'photos';
const BY_HOUSE = 'houseId';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * A write transaction's end. Rejects from `onabort`, with the transaction's
 * error or else the failed request's: WebKit and Firefox report a full
 * disk on the request and leave `transaction.error` empty at `onerror`.
 */
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let requestError: unknown = null;
    transaction.onerror = (event) => {
      const target = event.target as { error?: unknown } | null;
      requestError ??= target?.error ?? null;
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? requestError ?? new DOMException('Aborted', 'AbortError'));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(ALBUM_DB_NAME, ALBUM_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS, { keyPath: 'id' }).createIndex(BY_HOUSE, BY_HOUSE, { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new DOMException('Blocked', 'VersionError'));
  });
}

/**
 * The album in IndexedDB through `factory`; rejects when it won't open.
 * The connection closes when another tab upgrades the database (or the
 * browser closes it) and is opened again on the next use.
 */
export async function createIndexedDbAlbumStore(factory: IDBFactory): Promise<AlbumStore> {
  let connection: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    connection ??= openDatabase(factory).then(
      (db) => {
        const forget = () => {
          connection = null;
        };
        db.onversionchange = () => {
          db.close();
          forget();
        };
        db.onclose = forget;
        return db;
      },
      (error: unknown) => {
        connection = null;
        throw error;
      },
    );
    return connection;
  };
  // A connection closing under us (another tab's upgrade) throws
  // InvalidStateError at `transaction()`: open again, once.
  const begin = async (mode: IDBTransactionMode): Promise<IDBTransaction> => {
    try {
      return (await database()).transaction(PHOTOS, mode);
    } catch (error) {
      if (errorName(error) !== 'InvalidStateError') throw error;
      connection = null;
      return (await database()).transaction(PHOTOS, mode);
    }
  };
  await database();
  return {
    state: 'persistent',
    async put(photo) {
      const transaction = await begin('readwrite');
      transaction.objectStore(PHOTOS).put(photo);
      await transactionDone(transaction);
    },
    async remove(ids) {
      if (ids.length === 0) return;
      const transaction = await begin('readwrite');
      const photos = transaction.objectStore(PHOTOS);
      for (const id of ids) photos.delete(id);
      await transactionDone(transaction);
    },
    async listHouse(houseId) {
      const transaction = await begin('readonly');
      const found = await requestResult(transaction.objectStore(PHOTOS).index(BY_HOUSE).getAll(houseId) as IDBRequest<unknown[]>);
      return oldestFirst(found.filter(isAlbumPhoto));
    },
  };
}

let current: AlbumStore | null = null;
let opening: Promise<AlbumStore> | null = null;

/**
 * The page's album, opened once: IndexedDB where it opens, memory
 * otherwise. `factory` is for tests.
 */
export function openAlbum(factory: IDBFactory | null = defaultFactory()): Promise<AlbumStore> {
  opening ??= (async () => {
    let store: AlbumStore;
    if (!factory) {
      store = createMemoryAlbumStore('session');
    } else {
      try {
        store = await createIndexedDbAlbumStore(factory);
      } catch (error) {
        store = createMemoryAlbumStore(fallbackStateFor(error));
      }
    }
    current = store;
    return store;
  })();
  return opening;
}

/** Move the album to memory for the rest of the session, and tell its viewers. */
export function moveAlbumToMemory(state: AlbumState): AlbumStore {
  const store = createMemoryAlbumStore(state === 'persistent' ? 'session' : state);
  current = store;
  opening = Promise.resolve(store);
  emit();
  return store;
}

/** Forget the opened album (tests). */
export function resetAlbumForTests(): void {
  current = null;
  opening = null;
  listeners.clear();
  channel?.close();
  channel = null;
}

function defaultFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    // Some browsers throw on the bare read when storage is blocked.
    return null;
  }
}

/** A fresh id for a photo. */
export function newPhotoId(now: number = Date.now()): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${now.toString(36)}-${random}`;
}

// ── the album's copy of a capture (browser canvas, no React) ───────────

/**
 * The album's copy of a captured PNG: a JPEG at most `ALBUM_MAX_EDGE` px,
 * and its thumbnail as a data URL, from one decode. Where the browser
 * can't decode or draw, the PNG itself is kept, with no thumbnail.
 */
export async function encodeForAlbum(png: Blob): Promise<Pick<AlbumPhoto, 'image' | 'imageType' | 'thumb'>> {
  try {
    const bitmap = await createImageBitmap(png);
    try {
      const copy = await drawJpeg(bitmap, ALBUM_MAX_EDGE, ALBUM_QUALITY);
      const thumbCanvas = drawScaled(bitmap, THUMB_MAX_EDGE);
      const thumb = thumbCanvas ? thumbCanvas.toDataURL('image/jpeg', 0.82) : null;
      if (copy) return { image: await copy.arrayBuffer(), imageType: copy.type, thumb: thumb?.startsWith('data:image/') ? thumb : null };
    } finally {
      bitmap.close();
    }
  } catch {
    // Fall through to the PNG.
  }
  return { image: await png.arrayBuffer(), imageType: png.type || 'image/png', thumb: null };
}

function drawScaled(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement | null {
  const size = fitEdge(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return canvas;
}

function drawJpeg(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob | null> {
  const canvas = drawScaled(bitmap, maxEdge);
  if (!canvas) return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** The file extension for an album copy's type. */
export function albumFileExtension(imageType: string): string {
  if (imageType === 'image/jpeg') return 'jpg';
  if (imageType === 'image/webp') return 'webp';
  return 'png';
}

/**
 * The album's copy as a file to download or share: `<house>-photo.jpg`,
 * through the one naming rule for downloads. Built from the bytes already
 * in hand, so a share sheet opens inside the tap that asked for it.
 */
export function albumPhotoFile(photo: Pick<AlbumPhoto, 'image' | 'imageType'>, houseName: string): File {
  return new File([photo.image], exportFileName(houseName, albumFileExtension(photo.imageType), 'photo'), { type: photo.imageType });
}

// ── sharing a photo ────────────────────────────────────────────────────
// The rule is lib/share-delivery's `deliverHouseFile`, kept here on its
// own: importing that module from the album's lazy chunk splits it, and
// lib/share, out of the editor's hoisted module (about 1 KB of first load).

/**
 * Hand a photo over: the sheet first, a download when the sheet fails,
 * nothing when the player dismisses it. Call it in the tap: the sheet is
 * asked before anything is awaited.
 */
export async function sharePhoto(file: File, channels: FileChannels): Promise<FileOutcome> {
  if (channels.shareFile) {
    try {
      await channels.shareFile(file);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  channels.download(file);
  return 'downloaded';
}

/** The parts of `navigator` a file share reads. */
export interface FileShareNavigator {
  share?: ((data: ShareData) => Promise<void>) | undefined;
  canShare?: ((data: ShareData) => boolean) | undefined;
}

/**
 * Whether `nav`'s share sheet takes `probe`: both members are there and
 * `canShare` says yes. A browser that throws on the question says no.
 */
export function sheetTakesFile(nav: FileShareNavigator | undefined, probe: File): boolean {
  try {
    return typeof nav?.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Where an album photo goes (`sharePhoto`): the
 * share sheet wherever it takes a JPEG, on a phone or a desktop (a photo
 * has no link to copy instead, and Safari and Chrome on a desktop have a
 * sheet too), else a download. The sheet gets the file alone (`photoShareData`).
 */
export function browserImageChannels(): FileChannels {
  let canShareFile = false;
  try {
    const probe = new File([new Uint8Array(0)], 'photo.jpg', { type: 'image/jpeg' });
    canShareFile = typeof navigator !== 'undefined' && sheetTakesFile(navigator, probe);
  } catch {
    canShareFile = false;
  }
  return {
    ...(canShareFile ? { shareFile: (shared: File) => navigator.share(photoShareData(shared)) } : {}),
    download: (downloaded: File) => downloadBlob(downloaded.name, downloaded),
  };
}

/**
 * What the sheet is handed for a photo: the file and nothing else. A title
 * would show the file name as the share's text, and on iOS a share with
 * text can lose Save Image.
 */
export function photoShareData(file: File): ShareData {
  return { files: [file] };
}
