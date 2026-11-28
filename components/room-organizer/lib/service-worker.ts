/**
 * The offline service worker's registration (#933). The worker itself is
 * written at build time by scripts/build-sw.mjs into out/sw.js, beside the
 * manifest at the site's root (under the Pages basePath when there is one).
 *
 * It is registered only in a production build, after the first frame, so it
 * never competes with the engine download (#731). The build flag
 * `NEXT_PUBLIC_SERVICE_WORKER=off` turns it off; a build made that way also
 * removes a worker an earlier build installed, so the flag works as a kill
 * switch for a bad worker. GitHub Pages serves every project site of an
 * account from one origin, so only this site's own worker is ever touched.
 */

export const SERVICE_WORKER_FILE = 'sw.js';

export type ServiceWorkerPlan = 'register' | 'unregister' | 'none';

/**
 * What the page does with the worker: register it in a production build,
 * remove ours when the flag is off or in development (a dev server on the
 * same origin as an earlier `npm start` would otherwise keep a precache of
 * another build), nothing when the browser has no service workers.
 */
export function serviceWorkerPlan(nodeEnv: string | undefined, flag: string | undefined, supported: boolean): ServiceWorkerPlan {
  if (!supported) return 'none';
  return nodeEnv === 'production' && !flagOff(flag) ? 'register' : 'unregister';
}

/** The kill switch's values, as scripts/build-sw.mjs reads them: off, false or 0, any case. */
export function flagOff(flag: string | undefined): boolean {
  return /^(off|false|0)$/i.test((flag ?? '').trim());
}

/**
 * This page's build, as the worker knows it: the path of the webpack runtime
 * chunk it loads, relative to the site root (`_next/static/chunks/webpack-….js`).
 */
export function runtimeMarker(scriptSources: readonly string[]): string | null {
  for (const src of scriptSources) {
    const match = /(_next\/static\/chunks\/webpack-[^/?#]+\.js)/.exec(src);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** A worker the page can message. */
export interface MessageTarget {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

/** What the page asks of a new worker that has installed while an older one controls it. */
export function takeOverMessage(marker: string | null): { type: 'take-over'; marker: string } | null {
  return marker ? { type: 'take-over', marker } : null;
}

/**
 * The worker's URL: beside the manifest, which Next links at the site root
 * whatever the basePath. Without a manifest link, beside the page.
 */
export function serviceWorkerUrl(manifestHref: string | null, pageHref: string): string {
  return new URL(SERVICE_WORKER_FILE, manifestHref ?? pageHref).href;
}

/** This site's cache names start with this (scripts/build-sw.mjs `cachePrefix`). */
export function shellCachePrefix(workerUrl: string): string {
  return `pc-shell:${new URL('./', workerUrl).pathname}:`;
}

/** The parts of the Cache API this module uses. */
export interface CacheNames {
  keys(): Promise<readonly string[]>;
  delete(name: string): Promise<boolean>;
}

/** The parts of `navigator.serviceWorker` this module uses. */
export interface WorkerContainer {
  register(url: string): Promise<unknown>;
  /** The worker in charge of this page, told when the page leaves (a reload hands over, #933). */
  controller?: MessageTarget | null;
  getRegistrations(): Promise<readonly WorkerRegistration[]>;
}

export interface WorkerRegistration {
  active?: { scriptURL: string } | null;
  installing?: { scriptURL: string } | null;
  waiting?: { scriptURL: string } | null;
  unregister(): Promise<boolean>;
}

function isOurs(registration: WorkerRegistration, url: string): boolean {
  return [registration.active, registration.installing, registration.waiting].some((worker) => worker?.scriptURL === url);
}

/**
 * Carries out the plan. Never throws: a worker that can't register (a
 * private window, storage blocked, the file missing) leaves the app as it
 * was, online only.
 */
export async function syncServiceWorker(
  plan: ServiceWorkerPlan,
  container: WorkerContainer | undefined,
  url: string,
  cacheNames?: CacheNames
): Promise<void> {
  if (plan === 'none' || !container) return;
  try {
    if (plan === 'register') {
      const registration = await container.register(url);
      watchForUpdate(registration, container);
      return;
    }
    const registrations = await container.getRegistrations();
    await Promise.all(registrations.filter((registration) => isOurs(registration, url)).map((registration) => registration.unregister()));
    if (cacheNames) {
      const prefix = shellCachePrefix(url);
      const names = await cacheNames.keys();
      await Promise.all(names.filter((name) => name.startsWith(prefix)).map((name) => cacheNames.delete(name)));
    }
  } catch (error) {
    console.warn('Offline support is unavailable:', error);
  }
}

interface UpdatingRegistration {
  waiting?: (MessageTarget & { state?: string }) | null;
  installing?: (MessageTarget & { state?: string; addEventListener?(type: 'statechange', listener: () => void): void }) | null;
  addEventListener?(type: 'updatefound', listener: () => void): void;
  update?(): Promise<unknown>;
}

/** The part of `navigator.serviceWorker` the update prompt listens to. */
export interface ControllerEvents {
  addEventListener?(type: 'controllerchange', listener: () => void): void;
}

/**
 * How long a newer worker must stay waiting before the player is offered it
 * (#933): in the only window, a page of the new build has it take over at
 * once, which needs no prompt.
 */
export const UPDATE_SETTLE_MS = 2_000;
/** A tab back in view looks for a newer build at most this often. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * The update on offer (#933): `newer` while a newer worker waits for this
 * page of the older build; `stale` once another tab's update put that
 * worker in charge here (this page still runs the older build, and a
 * reload alone opens the newer one).
 */
export type UpdateKind = 'newer' | 'stale';
interface UpdateOffer {
  kind: UpdateKind;
  waiting: MessageTarget | null;
}
let updateOffer: UpdateOffer | null = null;
let reloadAsked = false;
const updateListeners = new Set<() => void>();

function setUpdateOffer(next: UpdateOffer | null): void {
  updateOffer = next;
  for (const listener of [...updateListeners]) listener();
}

/** The update on offer, or null: `applyUpdate` opens it. */
export function updateKind(): UpdateKind | null {
  return updateOffer?.kind ?? null;
}

/** Told when `updateKind` changes. Returns the unsubscribe function. */
export function subscribeUpdateReady(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

/** For tests: forget the offer and the once-only reload. */
export function resetUpdateOffer(): void {
  reloadAsked = false;
  setUpdateOffer(null);
}

/** How long a worker has to say whether a page is of its build. */
export const IS_MINE_MS = 3_000;

/**
 * Asks a worker whether this page is of its build (scripts/build-sw.mjs
 * 'is-mine'): true, false, or null when it can't tell (no runtime marker,
 * no channel, or no answer, as from a worker older than the question).
 */
export function askIsMine(worker: MessageTarget, marker: string | null, timeoutMs: number = IS_MINE_MS): Promise<boolean | null> {
  if (!marker || typeof MessageChannel === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const done = (answer: boolean | null): void => {
      channel.port1.close();
      resolve(answer);
    };
    const timer = window.setTimeout(() => done(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => {
      window.clearTimeout(timer);
      done(event.data === true);
    };
    try {
      worker.postMessage({ type: 'is-mine', marker }, [channel.port2]);
    } catch {
      window.clearTimeout(timer);
      done(null);
    }
  });
}

const pageMarker = (): string | null => runtimeMarker([...document.scripts].map((script) => script.src));

/**
 * Whether this page is older than the worker in charge (#933). A "not mine"
 * answer alone can't tell older from newer: a page of a new deploy, fetched
 * online, runs under the old worker until its own installs. So the page asks
 * for an update check first; when no newer worker turns up, the one in
 * charge is the latest, and this page is behind it.
 */
async function checkStale(reg: UpdatingRegistration, container: WorkerContainer): Promise<void> {
  const controller = container.controller;
  if (!controller || reloadAsked) return;
  if ((await askIsMine(controller, pageMarker())) !== false) return;
  await reg.update?.().catch(() => undefined);
  if (reloadAsked || reg.installing || reg.waiting || container.controller !== controller) return;
  if (updateOffer?.kind !== 'stale') setUpdateOffer({ kind: 'stale', waiting: null });
}

/**
 * When a newer worker has installed while an older one controls this page:
 * ask it to take over now if this page is of its build (the worker checks
 * that, and that this is the only window), and from then on tell the worker
 * in charge when this page leaves, so a reload of the only tab hands over.
 * The leave listener is added only then: beforeunload costs nothing else.
 * A worker still waiting `UPDATE_SETTLE_MS` later is offered to the player
 * (`updateKind`), unless this page is already of its build. When another
 * tab's update puts a newer worker in charge, a page of the older build
 * offers a reload (`stale`). A long-lived tab looks for a newer build when
 * it comes back into view, at most hourly; the browser checks on navigations.
 */
export function watchForUpdate(registration: unknown, container: WorkerContainer & ControllerEvents, now: () => number = Date.now): void {
  if (typeof registration !== 'object' || registration === null || typeof document === 'undefined') return;
  const reg = registration as UpdatingRegistration;
  let leaveWatched = false;
  const found = (worker: MessageTarget): void => {
    const message = takeOverMessage(pageMarker());
    if (message) worker.postMessage(message);
    window.setTimeout(() => {
      if (reg.waiting !== worker) return;
      void askIsMine(worker, pageMarker()).then((mine) => {
        if (mine !== true && reg.waiting === worker && updateOffer?.kind !== 'stale') setUpdateOffer({ kind: 'newer', waiting: worker });
      });
    }, UPDATE_SETTLE_MS);
    if (leaveWatched) return;
    leaveWatched = true;
    window.addEventListener('beforeunload', () => container.controller?.postMessage({ type: 'leaving' }));
  };
  if (reg.waiting) found(reg.waiting);
  reg.addEventListener?.('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener?.('statechange', () => {
      if (worker.state === 'installed' && reg.waiting === worker) found(worker);
    });
  });
  // Another tab's update (or this page's own takeover) put a newer worker in charge.
  container.addEventListener?.('controllerchange', () => {
    const controller = container.controller;
    if (reloadAsked || !controller) return;
    void askIsMine(controller, pageMarker()).then((mine) => {
      if (reloadAsked) return;
      if (mine === true) setUpdateOffer(null);
      else if (mine === false || updateOffer) setUpdateOffer({ kind: 'stale', waiting: null });
    });
  });
  // A page that opened (or came back from the back-forward cache) under a
  // newer worker than its own build: cached HTML, say.
  void checkStale(reg, container);
  window.addEventListener('pageshow', (event: PageTransitionEvent) => {
    if (event.persisted) void checkStale(reg, container);
  });
  let checkedAt = now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || now() - checkedAt < UPDATE_CHECK_MS) return;
    checkedAt = now();
    reg.update?.().catch(() => undefined);
  });
}

/**
 * What saving the change the autosave still owes came to: saved (or nothing
 * owed), refused because another tab saved a newer version over it, or not
 * saved (storage full, blocked, or the save held back).
 */
export type SaveFlush = 'saved' | 'newer' | 'failed';

/** How `applyUpdate` ended. */
export type UpdateOutcome = 'reloading' | 'not-saved' | 'newer-saved' | 'gone' | 'stuck';

export interface UpdateHandover {
  /** Saves a change still waiting for the autosave. */
  flushSave(): SaveFlush;
  reload(): void;
  container: ControllerEvents;
  /** How long the newer worker has to take over. */
  timeoutMs?: number;
}

/**
 * The player asked for the newer build (#933): save first, then have the
 * waiting worker take over (it obeys `skip-waiting` whatever other tabs are
 * open: the player asked) and reload once it is in charge, once only. A
 * change that couldn't be saved stops it, since the reload would lose it.
 */
export async function applyUpdate({ flushSave, reload, container, timeoutMs = 5_000 }: UpdateHandover): Promise<UpdateOutcome> {
  if (reloadAsked) return 'reloading';
  const current = updateOffer;
  if (!current) return 'gone';
  const saved = flushSave();
  if (saved === 'newer') return 'newer-saved';
  if (saved === 'failed') return 'not-saved';
  const reloadOnce = (): void => {
    if (reloadAsked) return;
    reloadAsked = true;
    reload();
  };
  const { waiting } = current;
  if (!waiting) {
    reloadOnce();
    return 'reloading';
  }
  return new Promise<UpdateOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: UpdateOutcome): void => {
      if (settled) return;
      settled = true;
      if (outcome === 'reloading') reloadOnce();
      resolve(outcome);
    };
    container.addEventListener?.('controllerchange', () => settle('reloading'));
    window.setTimeout(() => settle('stuck'), timeoutMs);
    waiting.postMessage('skip-waiting');
  });
}

/** The browser's side: the plan from the build, the URL from the page. */
export function syncBrowserServiceWorker(): Promise<void> {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const plan = serviceWorkerPlan(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SERVICE_WORKER, supported);
  if (plan === 'none') return Promise.resolve();
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const cacheNames = typeof caches === 'undefined' ? undefined : caches;
  return syncServiceWorker(plan, navigator.serviceWorker, serviceWorkerUrl(manifest?.href ?? null, window.location.href), cacheNames);
}

/** Whether a newer worker is installed and waiting: a reload would open the newer version. */
export async function updateWaiting(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  return Boolean(registration?.waiting);
}
