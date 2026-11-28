/**
 * The light half of the floor-plan image store (#936): what a save, a load
 * and the schema need at once, with the store itself (IndexedDB, hashing,
 * `lib/plan-image-store.ts`) loaded with `import()` the first time a house
 * has an image to store or a ref to resolve.
 *
 * A save names an image by ref only once this tab has confirmed it stored
 * (put, read back and matched) AND the browser has made the site's storage
 * persistent: Chromium can evict IndexedDB under storage pressure while
 * localStorage survives, and a ref without its image is a lost image. Where
 * storage isn't persistent the save stays inline, as before, unless inline
 * would not fit at all: then a ref is better than no save
 * (`compactPlanImage(layout, true)`).
 */

/** The fields a house (or a stored blob of one) carries the plan in. */
export interface PlanImageFields {
  floorPlanImage?: string;
  floorPlanImageRef?: string;
}

const REF_PATTERN = /^sha256-[0-9a-f]{64}$/;

/** Whether `value` is a plan image ref (`sha256-<64 hex>`). */
export function isPlanImageRef(value: unknown): value is string {
  return typeof value === 'string' && REF_PATTERN.test(value);
}

/** Whether `layout` names a stored image it doesn't hold yet. */
export function planImagePending(layout: PlanImageFields): boolean {
  return !layout.floorPlanImage && isPlanImageRef(layout.floorPlanImageRef);
}

/** Whether `layout` has a floor-plan image, held or only named. */
export function hasPlanImage(layout: PlanImageFields): boolean {
  return !!layout.floorPlanImage || isPlanImageRef(layout.floorPlanImageRef);
}

/** Images this tab has confirmed stored, by image text: what a save may name by ref. */
const confirmed = new Map<string, string>();
/** The other way: confirmed images by ref. */
const byRef = new Map<string, string>();
/** Few images per session; each is a reference to a string the house holds anyway. */
const REMEMBERED = 8;
const listeners = new Set<(ref: string) => void>();
/** The image of the house on screen: never forgotten, or its save would go inline again. */
let pinned: string | null = null;
/** Whether the browser has made this site's storage persistent. */
let persisted = false;

function announce(ref: string): void {
  for (const listener of [...listeners]) listener(ref);
}

/** Note `image` as stored under `ref` (the store calls it once it is sure). */
export function rememberPlanImage(image: string, ref: string, tell = false): void {
  confirmed.delete(image);
  confirmed.set(image, ref);
  byRef.set(ref, image);
  for (const [oldImage, oldRef] of [...confirmed]) {
    if (confirmed.size <= REMEMBERED) break;
    if (oldImage === pinned) continue;
    confirmed.delete(oldImage);
    byRef.delete(oldRef);
  }
  if (tell) announce(ref);
}

/** The house on screen holds `image` (or none). */
export function pinPlanImage(image: string | null): void {
  pinned = image;
}

/** Whether a save may drop a stored image's inline copy without being forced. */
export function planStoragePersisted(): boolean {
  return persisted;
}

/** The store's reading of `navigator.storage.persisted()`; turning true lets saves compact. */
export function setPlanStoragePersisted(value: boolean): void {
  const became = value && !persisted;
  persisted = value;
  if (became) announce('');
}

/**
 * Why a ref couldn't be read: `gone`, the store opened and the image isn't
 * in it (or doesn't hash to its ref); `unavailable`, the store didn't open
 * or answer in time. By ref, for the notice and the settings panel.
 */
export type PlanImageProblem = 'gone' | 'unavailable';
const problems = new Map<string, PlanImageProblem>();

export function notePlanImageProblem(ref: string, problem: PlanImageProblem | null): void {
  if (problem) problems.set(ref, problem);
  else problems.delete(ref);
}

/** Why the image `ref` names couldn't be read here, or null when it wasn't tried or was read. */
export function planImageProblem(ref: string | undefined): PlanImageProblem | null {
  return ref === undefined ? null : problems.get(ref) ?? null;
}

/** What to say about an image a house names but this browser couldn't read. */
export function planImageProblemText(problem: PlanImageProblem | null): string {
  return problem === 'gone'
    ? 'The floor-plan image is no longer in this browser’s storage (the browser may have cleared it). Restore a backup that has it, or upload it again.'
    : 'The floor-plan image couldn’t be read from this browser’s storage just now. It stays saved with the house: reload to try again.';
}

/** The confirmed image `ref` names, if this tab holds it. */
export function knownPlanImage(ref: string): string | null {
  return byRef.get(ref) ?? null;
}

/** The ref a save may write for `image`, or null until it is confirmed stored. */
export function storedPlanImageRef(image: string): string | null {
  return confirmed.get(image) ?? null;
}

/** Called after each image is newly confirmed stored, with its ref; returns the unsubscribe. */
export function subscribePlanImageStored(listener: (ref: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The house as a save writes it: a confirmed image as its ref, while storage
 * is persistent or when `force`d (inline would not fit). Otherwise the image
 * stays inline (any stale ref beside it goes); a house that only names its
 * image keeps the name.
 */
export function compactPlanImage<T extends PlanImageFields>(layout: T, force = false): T {
  const image = layout.floorPlanImage;
  if (!image) return layout;
  const ref = persisted || force ? confirmed.get(image) : undefined;
  if (!ref) {
    if (layout.floorPlanImageRef === undefined) return layout;
    const inline: T = { ...layout };
    delete inline.floorPlanImageRef;
    return inline;
  }
  const compact: T = { ...layout, floorPlanImageRef: ref };
  delete compact.floorPlanImage;
  return compact;
}

/**
 * One form for comparing two houses: an image inline on one side and named
 * by ref on the other is the same house.
 */
export function comparablePlanImage<T extends PlanImageFields>(layout: T): T {
  return compactPlanImage(layout, true);
}

/** Tests: forget what this tab has confirmed. */
export function forgetPlanImagesForTests(): void {
  confirmed.clear();
  byRef.clear();
  listeners.clear();
  problems.clear();
  pinned = null;
  persisted = false;
}

/** How long a load waits for an image, the store's own loading included. */
export const PLAN_IMAGE_WAIT_MS = 5000;

/** `promise`, or `fallback` after `ms` or on a rejection. */
export function within<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback());
      }
    );
  });
}

// ── the store, loaded on first use ─────────────────────────────────────

const store = (): Promise<typeof import('./plan-image-store')> => import('./plan-image-store');

/**
 * The house with its image in hand (`plan-image-store`'s `resolvePlanImage`):
 * the same object, at once, when it names no image to fetch.
 */
export function resolvePlanImage<T extends PlanImageFields>(layout: T, waitMs: number = PLAN_IMAGE_WAIT_MS): Promise<T> {
  if (!planImagePending(layout)) return Promise.resolve(layout);
  const ref = layout.floorPlanImageRef ?? '';
  // One bound for the whole wait, the store's chunk included.
  return within(
    store().then((loaded) => loaded.resolvePlanImage(layout, waitMs)),
    waitMs,
    () => {
      if (!knownPlanImage(ref)) notePlanImageProblem(ref, 'unavailable');
      return layout;
    }
  );
}

/** Read `navigator.storage.persisted()` again (after a save): a grant lets saves compact. */
export function refreshPlanStoragePersisted(): void {
  if (persisted || confirmed.size === 0) return;
  void store().then(
    (loaded) => loaded.checkPersistence(),
    () => undefined
  );
}

/** Keep `image` in the store (`plan-image-store`'s `storePlanImage`); its ref, or null. */
export function storePlanImage(image: string, waitMs?: number): Promise<string | null> {
  const known = confirmed.get(image);
  if (known) return Promise.resolve(known);
  const stored = store().then((loaded) => loaded.storePlanImage(image));
  return waitMs === undefined ? stored.catch(() => null) : within(stored, waitMs, () => null);
}
