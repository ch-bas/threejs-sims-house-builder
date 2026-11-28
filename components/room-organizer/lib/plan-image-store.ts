/**
 * The floor-plan image store (#936): the traced plan, a data URL of up to a
 * few megabytes, kept in IndexedDB under the SHA-256 of its text instead of
 * inside every localStorage save. Saves hold `floorPlanImageRef` in its
 * place; the house on screen always holds the image itself, so nothing that
 * draws, exports or compares it changes.
 *
 * The rules, all of them about never losing the image:
 * - A save names a ref only for an image this tab has confirmed stored: put,
 *   read back and matched (`storedPlanImageRef`). Until then it keeps the
 *   inline data URL, as before.
 * - Where IndexedDB can't be used (some private windows, storage blocked,
 *   a newer page holding the database, no `crypto.subtle`) nothing is
 *   stored and every save stays inline: today's behaviour.
 * - A ref is only ever turned back into the image whose hash it is; a record
 *   that doesn't hash to its key is treated as missing.
 * - Nothing is ever deleted here: houses in the library, recovered copies,
 *   other tabs and older builds may still name an image.
 *
 * No React and no Three.js. Loaded with `import()` through
 * `lib/plan-image-ref.ts`, which holds what a save needs at once.
 */

import {
  PLAN_IMAGE_WAIT_MS,
  compactPlanImage,
  forgetPlanImagesForTests,
  isPlanImageRef,
  knownPlanImage,
  notePlanImageProblem,
  planImagePending,
  rememberPlanImage,
  setPlanStoragePersisted,
  storedPlanImageRef,
  within,
  type PlanImageFields,
  type PlanImageProblem,
} from './plan-image-ref';

// The light half, for the tests and anything that has this module loaded anyway.
export { PLAN_IMAGE_WAIT_MS, compactPlanImage, isPlanImageRef, planImagePending, storedPlanImageRef };
export { hasPlanImage, planImageProblem, subscribePlanImageStored, type PlanImageFields } from './plan-image-ref';

/** Where images are kept; IndexedDB in the page, a map in the tests. */
export interface PlanImageBackend {
  put(ref: string, image: string): Promise<void>;
  get(ref: string): Promise<string | null>;
}

/** Stores in flight, by image. */
const storing = new Map<string, Promise<string | null>>();

/** `sha256-<hex>` of the image's text, or null where the browser can't hash. */
export async function hashPlanImage(image: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(image)));
    let hex = '';
    for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
    return `sha256-${hex}`;
  } catch {
    return null;
  }
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

// ── the backend ────────────────────────────────────────────────────────

export const PLAN_IMAGE_DB_NAME = 'standalone-room-organizer-plan-images';
const DB_VERSION = 1;
const IMAGES = 'images';

interface ImageRecord {
  ref: string;
  image: string;
  storedAt: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Aborted', 'AbortError'));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(PLAN_IMAGE_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGES)) request.result.createObjectStore(IMAGES, { keyPath: 'ref' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new DOMException('Blocked', 'VersionError'));
  });
}

/** The store in IndexedDB through `factory`; rejects when it won't open. */
export async function createIndexedDbPlanImageBackend(factory: IDBFactory): Promise<PlanImageBackend> {
  let connection: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    connection ??= openDatabase(factory).then(
      (db) => {
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        db.onclose = () => {
          connection = null;
        };
        return db;
      },
      (error: unknown) => {
        connection = null;
        throw error;
      }
    );
    return connection;
  };
  // A connection closed under us (another tab's upgrade) throws at
  // `transaction()`: open again, once.
  // Writes are 'strict': flushed to disk before they complete, so a ref is
  // never saved for an image a crash could still take back.
  const begin = async (mode: IDBTransactionMode): Promise<IDBTransaction> => {
    const options: IDBTransactionOptions = mode === 'readwrite' ? { durability: 'strict' } : {};
    try {
      return (await database()).transaction(IMAGES, mode, options);
    } catch {
      connection = null;
      return (await database()).transaction(IMAGES, mode, options);
    }
  };
  await database();
  return {
    async put(ref, image) {
      const transaction = await begin('readwrite');
      const record: ImageRecord = { ref, image, storedAt: Date.now() };
      transaction.objectStore(IMAGES).put(record);
      await transactionDone(transaction);
    },
    async get(ref) {
      const transaction = await begin('readonly');
      const record = (await requestResult(transaction.objectStore(IMAGES).get(ref))) as Partial<ImageRecord> | undefined;
      return record && record.ref === ref && typeof record.image === 'string' ? record.image : null;
    },
  };
}

function defaultFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

/** Opened once per session; null for the session when IndexedDB won't open. */
let backend: Promise<PlanImageBackend | null> | null = null;

function openBackend(): Promise<PlanImageBackend | null> {
  backend ??= (async () => {
    const factory = defaultFactory();
    if (!factory) return null;
    try {
      return await createIndexedDbPlanImageBackend(factory);
    } catch {
      return null;
    }
  })();
  return backend;
}

// ── persistent storage ────────────────────────────────────────────────

/** Where the page's storage manager can be asked; injectable for tests. */
export interface PersistenceManager {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

let manager: PersistenceManager | null | undefined;

function storageManager(): PersistenceManager | null {
  if (manager !== undefined) return manager;
  try {
    return typeof navigator === 'undefined' ? null : (navigator.storage as PersistenceManager | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Read whether storage is persistent: only then may a save drop an image's
 * inline copy. Never asks: asking is the storage-care rule's, after a real
 * edit (`shouldAskToPersist`, hooks/use-storage-persist.ts).
 */
export async function checkPersistence(): Promise<void> {
  const storage = storageManager();
  try {
    setPlanStoragePersisted((await storage?.persisted?.()) === true);
  } catch {
    /* unknown: saves stay inline */
  }
}

// ── storing and loading ────────────────────────────────────────────────

/**
 * Keep `image` in the store; its ref once it is stored and read back
 * whole, or null when it can't be (the save then stays inline).
 */
export function storePlanImage(image: string): Promise<string | null> {
  if (!isImageDataUrl(image)) return Promise.resolve(null);
  const known = storedPlanImageRef(image);
  if (known) return Promise.resolve(known);
  const running = storing.get(image);
  if (running) return running;
  const run = (async (): Promise<string | null> => {
    const ref = await hashPlanImage(image);
    const store = ref && (await openBackend());
    if (!ref || !store) return null;
    try {
      // Stored already (every load of a house by ref, an image used twice):
      // no multi-megabyte rewrite, just the check that it is whole.
      if ((await store.get(ref)) !== image) {
        await store.put(ref, image);
        if ((await store.get(ref)) !== image) return null;
      }
    } catch {
      return null;
    }
    await checkPersistence();
    rememberPlanImage(image, ref, true);
    return ref;
  })().finally(() => storing.delete(image));
  storing.set(image, run);
  return run;
}

/** The image `ref` names, or why it can't be had (noted by ref for the notice). */
export async function readPlanImage(ref: string): Promise<{ image: string } | { problem: PlanImageProblem }> {
  const outcome = await readOnce(ref);
  notePlanImageProblem(ref, 'problem' in outcome ? outcome.problem : null);
  return outcome;
}

async function readOnce(ref: string): Promise<{ image: string } | { problem: PlanImageProblem }> {
  if (!isPlanImageRef(ref)) return { problem: 'gone' };
  const known = knownPlanImage(ref);
  if (known) return { image: known };
  const store = await openBackend();
  if (!store) return { problem: 'unavailable' };
  let image: string | null;
  try {
    image = await store.get(ref);
  } catch {
    return { problem: 'unavailable' };
  }
  if (!isImageDataUrl(image) || (await hashPlanImage(image)) !== ref) return { problem: 'gone' };
  await checkPersistence();
  // Read back whole: a save may name it by ref from now on.
  rememberPlanImage(image, ref);
  return { image };
}

/** The image `ref` names, or null when it isn't stored here (or no longer hashes to it). */
export async function loadPlanImage(ref: string): Promise<string | null> {
  const outcome = await readPlanImage(ref);
  return 'image' in outcome ? outcome.image : null;
}

/**
 * The house with its image in hand: a ref is swapped for the image it
 * names. Unchanged (the same object) when there's nothing to fetch, or when
 * the image can't be had within `waitMs`: it then keeps the ref, so a save
 * still names the image.
 */
export async function resolvePlanImage<T extends PlanImageFields>(layout: T, waitMs: number = PLAN_IMAGE_WAIT_MS): Promise<T> {
  const ref = layout.floorPlanImageRef;
  if (!planImagePending(layout) || !ref) return layout;
  const image = await within(loadPlanImage(ref), waitMs, () => {
    if (!knownPlanImage(ref)) notePlanImageProblem(ref, 'unavailable');
    return null;
  });
  if (!image) return layout;
  const resolved: T = { ...layout, floorPlanImage: image };
  delete resolved.floorPlanImageRef;
  return resolved;
}

/**
 * `value` (any JSON) with every ref it holds swapped for its image, for a
 * file that must stand alone: a backup, an export, a download of a stored
 * house. Copy on write; refs that can't be resolved stay.
 */
export async function inlinePlanImageRefs(value: unknown, waitMs: number = PLAN_IMAGE_WAIT_MS): Promise<unknown> {
  if (Array.isArray(value)) {
    const items = await Promise.all(value.map((item) => inlinePlanImageRefs(item, waitMs)));
    return items.every((item, index) => item === value[index]) ? value : items;
  }
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const [key, inner] of Object.entries(record)) {
    const resolved = await inlinePlanImageRefs(inner, waitMs);
    if (resolved !== inner) (next ??= { ...record })[key] = resolved;
  }
  const current = next ?? record;
  if (typeof current.floorPlanImage !== 'string' && isPlanImageRef(current.floorPlanImageRef)) {
    const resolved = await resolvePlanImage(current as PlanImageFields, waitMs);
    if (resolved !== current) return resolved;
  }
  return current;
}

/** A stored house's raw JSON with its refs inlined; the raw text itself when it holds none or isn't JSON. */
export async function inlineRawPlanImages(raw: string, waitMs: number = PLAN_IMAGE_WAIT_MS): Promise<string> {
  if (!raw.includes('"floorPlanImageRef"')) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    const inlined = await inlinePlanImageRefs(parsed, waitMs);
    return inlined === parsed ? raw : JSON.stringify(inlined);
  } catch {
    return raw;
  }
}

/** Tests: use `next` as the store (null: none), with a fresh session. */
export function setPlanImageBackendForTests(next: PlanImageBackend | null): void {
  resetPlanImageStoreForTests();
  backend = Promise.resolve(next);
}

/** Tests: forget the session. */
export function resetPlanImageStoreForTests(): void {
  forgetPlanImagesForTests();
  storing.clear();
  backend = null;
  manager = undefined;
}

/** Tests: answer `persisted()`/`persist()` from `next` (null: no storage manager). */
export function setPersistenceManagerForTests(next: PersistenceManager | null): void {
  manager = next;
}

/** A store in a map, for tests. */
export function createMemoryPlanImageBackend(records: Map<string, string> = new Map()): PlanImageBackend {
  return {
    put(ref, image) {
      records.set(ref, image);
      return Promise.resolve();
    },
    get(ref) {
      return Promise.resolve(records.get(ref) ?? null);
    },
  };
}
