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
  postMessage(message: unknown): void;
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
}

/**
 * When a newer worker has installed while an older one controls this page:
 * ask it to take over now if this page is of its build (the worker checks
 * that, and that this is the only window), and from then on tell the worker
 * in charge when this page leaves, so a reload of the only tab hands over.
 * The leave listener is added only then: beforeunload costs nothing else.
 */
function watchForUpdate(registration: unknown, container: WorkerContainer): void {
  if (typeof registration !== 'object' || registration === null || typeof document === 'undefined') return;
  const reg = registration as UpdatingRegistration;
  let leaveWatched = false;
  const offer = (worker: MessageTarget): void => {
    const message = takeOverMessage(runtimeMarker([...document.scripts].map((script) => script.src)));
    if (message) worker.postMessage(message);
    if (leaveWatched) return;
    leaveWatched = true;
    window.addEventListener('beforeunload', () => container.controller?.postMessage({ type: 'leaving' }));
  };
  if (reg.waiting) offer(reg.waiting);
  reg.addEventListener?.('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener?.('statechange', () => {
      if (worker.state === 'installed' && reg.waiting === worker) offer(worker);
    });
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
