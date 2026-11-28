import { describe, expect, it, vi } from 'vitest';
import {
  OWN_PAGES,
  cachePrefix,
  contentType,
  pageFallback,
  pageMarker,
  precacheEntries,
  removalWorkerSource,
  routeFor,
  sha256,
  workerOff,
  workerSource,
} from '../scripts/build-sw.mjs';

// The post-build step that writes the offline service worker (#933).

const SCOPE = 'https://example.org/site/';
const PREFIX = 'pc-shell:/site/:';
const RUNTIME = '_next/static/chunks/webpack-abc.js';
const PAGE = `<html><head><script src="/site/${RUNTIME}" async=""></script></head></html>`;

describe('precacheEntries', () => {
  it('takes the page, the shell files present and everything under _next/static/', () => {
    const entries = precacheEntries([
      '404.html',
      '_next/static/media/people.1.glb',
      '_next/static/chunks/b.js',
      'icon-192.png',
      'index.html',
      'index.txt',
      'manifest.webmanifest',
      'opengraph-image.png',
      'third-party-licenses.txt',
    ]);
    expect(entries).toEqual([
      './',
      '404.html',
      'manifest.webmanifest',
      'icon-192.png',
      '_next/static/chunks/b.js',
      '_next/static/media/people.1.glb',
    ]);
  });

  it('refuses an export without a page', () => {
    expect(() => precacheEntries(['404.html'])).toThrow(/index\.html/);
  });
});

describe('pageMarker', () => {
  it('reads the webpack runtime chunk with or without a basePath', () => {
    expect(pageMarker(PAGE)).toBe(RUNTIME);
    expect(pageMarker(`<script src="/${RUNTIME}"></script>`)).toBe(RUNTIME);
  });

  it('fails a page with no runtime chunk', () => {
    expect(() => pageMarker('<html></html>')).toThrow(/webpack/);
  });
});

describe('cachePrefix', () => {
  it('carries the site path, so sibling sites on one origin never share a name', () => {
    expect(cachePrefix(SCOPE)).toBe(PREFIX);
    expect(cachePrefix('https://example.org/')).toBe('pc-shell:/:');
    expect(cachePrefix('https://example.org/other/')).not.toBe(PREFIX);
  });
});

describe('routeFor', () => {
  const precached = ['./', 'manifest.webmanifest', RUNTIME, '_next/static/dev/_buildManifest.js'];
  it('serves hashed files cache first and the rest of the shell network first', () => {
    expect(routeFor(`${SCOPE}${RUNTIME}`, SCOPE, 'no-cors', 'GET', precached)).toBe('static');
    expect(routeFor(`${SCOPE}manifest.webmanifest`, SCOPE, 'cors', 'GET', precached)).toBe('fresh');
    expect(routeFor(`${SCOPE}?share=abc`, SCOPE, 'navigate', 'GET', precached)).toBe('page');
  });

  it('keeps the build manifests, whose names outlive a build, network first', () => {
    expect(routeFor(`${SCOPE}_next/static/dev/_buildManifest.js`, SCOPE, 'no-cors', 'GET', precached)).toBe('fresh');
  });

  it('leaves other origins, other sites, other methods, other builds and unknown files alone', () => {
    expect(routeFor(`https://other.org/site/${RUNTIME}`, SCOPE, 'cors', 'GET', precached)).toBeNull();
    expect(routeFor(`https://example.org/sibling/${RUNTIME}`, SCOPE, 'cors', 'GET', precached)).toBeNull();
    expect(routeFor(`https://example.org/sibling/`, SCOPE, 'navigate', 'GET', precached)).toBeNull();
    expect(routeFor(`${SCOPE}${RUNTIME}`, SCOPE, 'cors', 'POST', precached)).toBeNull();
    expect(routeFor(`${SCOPE}_next/static/chunks/newer.js`, SCOPE, 'cors', 'GET', precached)).toBeNull();
    expect(routeFor(`${SCOPE}third-party-licenses.txt`, SCOPE, 'cors', 'GET', precached)).toBeNull();
  });
});

describe('pageFallback', () => {
  it('opens the editor for the root and index.html, the 404 page elsewhere', () => {
    expect(pageFallback(`${SCOPE}`, SCOPE)).toBe('./');
    expect(pageFallback(`${SCOPE}?share=x#y`, SCOPE)).toBe('./');
    expect(pageFallback(`${SCOPE}index.html`, SCOPE)).toBe('./');
    expect(pageFallback(`${SCOPE}nowhere`, SCOPE)).toBe('404.html');
  });
});

describe('contentType', () => {
  it('comes from the name, never from what the cache says', () => {
    expect(contentType('./')).toMatch(/^text\/html/);
    expect(contentType('_next/static/chunks/a.js')).toMatch(/^text\/javascript/);
    expect(contentType('_next/static/media/people.1.glb')).toBe('model/gltf-binary');
  });
});

describe('workerOff', () => {
  it('is the kill switch flag: off, false or 0, any case', () => {
    for (const value of ['off', 'OFF', ' Off ', 'false', 'False', '0']) expect(workerOff({ NEXT_PUBLIC_SERVICE_WORKER: value })).toBe(true);
    for (const value of ['', 'on', 'true', '1', 'offline']) expect(workerOff({ NEXT_PUBLIC_SERVICE_WORKER: value })).toBe(false);
    expect(workerOff({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The generated workers, run against an in-memory Cache API, network and
// clients.

type Listener = (event: {
  waitUntil(p: Promise<unknown>): void;
  respondWith(p: Promise<Response>): void;
  request: Request;
  data?: unknown;
  ports?: MessagePort[];
  source?: { id: string } | undefined;
}) => void;

interface FakeClient {
  id?: string;
  url: string;
  visibilityState: string;
  navigate: ReturnType<typeof vi.fn>;
}

interface FakeWaiting {
  state: string;
  postMessage: ReturnType<typeof vi.fn>;
  addEventListener(type: string, listener: () => void): void;
}

interface Harness {
  stores: Map<string, Map<string, Response>>;
  network: Map<string, string>;
  online: { value: boolean };
  fetched: string[];
  windows: FakeClient[];
  registration: { scope: string; waiting: FakeWaiting | null; unregister: ReturnType<typeof vi.fn> };
  skipWaiting: ReturnType<typeof vi.fn>;
  install(): Promise<void>;
  activate(): Promise<void>;
  message(data: unknown, ports?: MessagePort[], source?: { id: string }): Promise<void>;
  /** The work fetches left running (putting back lost entries). */
  settle(): Promise<void>;
  /** The worker's answer, or undefined when it left the request alone. */
  fetch(url: string, mode?: RequestMode): Promise<Response | undefined>;
}

const abs = (key: Request | string) => new URL(typeof key === 'string' ? key : key.url, SCOPE).href;
const strip = (href: string) => href.replace(/[?#].*$/, '');

function harness(source: string, network: Record<string, string>, stores = new Map<string, Map<string, Response>>()): Harness {
  const listeners = new Map<string, Listener>();
  const net = new Map(Object.entries(network).map(([path, body]) => [new URL(path, SCOPE).href, body]));
  const online = { value: true };
  const fetched: string[] = [];
  const cacheOf = (store: Map<string, Response>) => ({
    async put(key: Request | string, response: Response) {
      store.set(abs(key), response);
    },
    async match(key: Request | string) {
      return store.get(abs(key))?.clone();
    },
    async delete(key: Request | string) {
      return store.delete(abs(key));
    },
  });
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      return cacheOf(stores.get(name) ?? new Map());
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const fetchFn = async (input: Request | string) => {
    const href = abs(input);
    fetched.push(href);
    if (!online.value) throw new TypeError('Failed to fetch');
    const body = net.get(strip(href));
    return body === undefined ? new Response('gone', { status: 404 }) : new Response(body, { status: 200 });
  };
  const RequestAt = class extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, SCOPE).href, init);
    }
  };
  const windows: FakeClient[] = [];
  const pending: Promise<unknown>[] = [];
  const registration = { scope: SCOPE, waiting: null as FakeWaiting | null, unregister: vi.fn(() => Promise.resolve(true)) };
  const skipWaiting = vi.fn(() => Promise.resolve());
  const self = {
    registration,
    skipWaiting,
    clients: { matchAll: () => Promise.resolve(windows), claim: () => Promise.resolve() },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  new Function('self', 'caches', 'fetch', 'Request', source)(self, caches, fetchFn, RequestAt);
  const run = (type: string, request?: Request, data?: unknown, ports: MessagePort[] = [], source?: { id: string }) =>
    new Promise<Response | undefined>((resolve, reject) => {
      let answered = false;
      const listener = listeners.get(type);
      if (!listener) throw new Error(`no ${type} listener`);
      listener({
        request: request ?? new Request(SCOPE),
        data,
        ports,
        source,
        waitUntil: (p) => {
          // A fetch's extra work runs beside its answer.
          if (type === 'fetch') return void pending.push(p);
          answered = true;
          p.then(() => resolve(undefined), reject);
        },
        respondWith: (p) => {
          answered = true;
          p.then(resolve, reject);
        },
      });
      if (!answered) resolve(undefined);
    });
  return {
    stores,
    network: net,
    online,
    fetched,
    windows,
    registration,
    skipWaiting,
    install: () => run('install').then(() => undefined),
    activate: () => run('activate').then(() => undefined),
    message: (data, ports = [], source) => run('message', undefined, data, ports, source).then(() => undefined),
    settle: () => Promise.all(pending.splice(0)).then(() => undefined),
    fetch: (url, mode = 'cors') => {
      const request = new Request(new URL(url, SCOPE).href);
      // Request.mode can't be set to 'navigate' from a constructor.
      Object.defineProperty(request, 'mode', { value: mode });
      return run('fetch', request);
    },
  };
}

const SITE: Record<string, string> = { './': PAGE, '404.html': 'not found', [RUNTIME]: 'runtime', '_next/static/chunks/a.js': 'a' };
const hashesOf = (site: Record<string, string>) => Object.fromEntries(Object.entries(site).map(([entry, body]) => [entry, sha256(body)]));
const BUILD = workerSource({ hashes: hashesOf(SITE) });
const ownCaches = (sw: Harness) => [...sw.stores.keys()].filter((name) => name.startsWith(PREFIX));
const ownStore = (sw: Harness) => sw.stores.get(ownCaches(sw)[0] ?? '') ?? new Map<string, Response>();

describe('the generated worker', () => {
  it('names its cache after the site and the worker itself', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    expect(ownCaches(sw)).toEqual([expect.stringMatching(/^pc-shell:\/site\/:[0-9a-f]{16}$/)]);
    const other = harness(workerSource({ hashes: { ...hashesOf(SITE), '404.html': sha256('changed') } }), { ...SITE, '404.html': 'changed' });
    await other.install();
    expect(ownCaches(other)[0]).not.toBe(ownCaches(sw)[0]);
  });

  it('precaches the build and serves it offline', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    expect(ownStore(sw).size).toBe(4);
    sw.online.value = false;
    expect(await (await sw.fetch(`${SCOPE}?share=abc`, 'navigate'))?.text()).toBe(PAGE);
    expect(await (await sw.fetch(`${SCOPE}elsewhere`, 'navigate'))?.text()).toBe('not found');
    const chunk = await sw.fetch(`${SCOPE}_next/static/chunks/a.js`);
    expect(await chunk?.text()).toBe('a');
    expect(chunk?.headers.get('content-type')).toMatch(/javascript/);
  });

  it('serves the page from the network while online, hashed files from the cache', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    sw.network.set(SCOPE, 'newer page');
    sw.fetched.length = 0;
    expect(await (await sw.fetch(SCOPE, 'navigate'))?.text()).toBe('newer page');
    expect(await (await sw.fetch(`${SCOPE}_next/static/chunks/a.js`))?.text()).toBe('a');
    expect(sw.fetched).toEqual([SCOPE]);
  });

  it('leaves another build\'s chunks and files outside the shell to the browser', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    expect(await sw.fetch(`${SCOPE}_next/static/chunks/newer.js`)).toBeUndefined();
    expect(await sw.fetch(`${SCOPE}third-party-licenses.txt`)).toBeUndefined();
    expect(await sw.fetch('https://example.org/sibling/', 'navigate')).toBeUndefined();
  });

  it('gives up, and drops its partial cache, when the page belongs to another build', async () => {
    const sw = harness(BUILD, { ...SITE, './': '<script src="/site/_next/static/chunks/webpack-new.js">' });
    await expect(sw.install()).rejects.toThrow(/not this build/);
    expect(ownCaches(sw)).toEqual([]);
  });

  it('gives up when a file is missing, rather than cache a gap', async () => {
    const { '_next/static/chunks/a.js': _gone, ...rest } = SITE;
    const sw = harness(BUILD, rest);
    await expect(sw.install()).rejects.toThrow(/not this build/);
    expect(ownCaches(sw)).toEqual([]);
  });

  it('reuses checked files an older build of this site holds, and drops only this site\'s old caches', async () => {
    const first = harness(BUILD, SITE);
    await first.install();
    const site = { ...SITE, '_next/static/chunks/b.js': 'b' };
    const second = harness(workerSource({ hashes: hashesOf(site) }), site, first.stores);
    await second.install();
    expect(second.fetched).not.toContain(`${SCOPE}_next/static/chunks/a.js`);
    expect(second.fetched).toContain(`${SCOPE}_next/static/chunks/b.js`);
    second.stores.set('pc-shell:/sibling/:x', new Map());
    second.stores.set('someone-else', new Map());
    await second.activate();
    expect([...second.stores.keys()].filter((name) => !name.startsWith(PREFIX)).sort()).toEqual(['pc-shell:/sibling/:x', 'someone-else']);
    expect(ownCaches(second)).toHaveLength(1);
  });

  // A sibling site on the same origin can write into these caches.
  it('never serves a cached file that fails its check: it deletes it and goes to the network', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    const store = ownStore(sw);
    store.set(`${SCOPE}${RUNTIME}`, new Response('window.pwned=1;runtime'));
    store.set(SCOPE, new Response('<script>pwned</script>'));
    expect(await (await sw.fetch(`${SCOPE}${RUNTIME}`))?.text()).toBe('runtime');
    await sw.settle();
    expect(await store.get(`${SCOPE}${RUNTIME}`)?.clone().text()).toBe('runtime');
    sw.online.value = false;
    expect((await sw.fetch(SCOPE, 'navigate'))?.status).toBe(503);
    expect(store.has(SCOPE)).toBe(false);
  });

  it('puts a lost entry back from the network, only with this build\'s bytes', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    const store = ownStore(sw);
    store.set(`${SCOPE}${RUNTIME}`, new Response('tampered'));
    store.delete(SCOPE);
    expect(await (await sw.fetch(`${SCOPE}${RUNTIME}`))?.text()).toBe('runtime');
    expect(await (await sw.fetch(SCOPE, 'navigate'))?.text()).toBe(PAGE);
    await sw.settle();
    expect(await store.get(`${SCOPE}${RUNTIME}`)?.clone().text()).toBe('runtime');
    expect(await store.get(SCOPE)?.clone().text()).toBe(PAGE);
    // Another deploy's page is never stored in this build's place.
    store.delete(SCOPE);
    sw.network.set(SCOPE, 'newer page');
    expect(await (await sw.fetch(SCOPE, 'navigate'))?.text()).toBe('newer page');
    await sw.settle();
    expect(store.has(SCOPE)).toBe(false);
  });

  it('never copies a tampered file forward from an older cache', async () => {
    const first = harness(BUILD, SITE);
    await first.install();
    ownStore(first).set(`${SCOPE}_next/static/chunks/a.js`, new Response('pwned'));
    const site = { ...SITE, '_next/static/chunks/b.js': 'b' };
    const second = harness(workerSource({ hashes: hashesOf(site) }), site, first.stores);
    await second.install();
    expect(second.fetched).toContain(`${SCOPE}_next/static/chunks/a.js`);
    await second.activate();
    second.online.value = false;
    expect(await (await second.fetch(`${SCOPE}_next/static/chunks/a.js`))?.text()).toBe('a');
  });

  it('hands a reload of the only tab to a waiting worker: online with the network\'s page, offline with a reload', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    const waiting: FakeWaiting = {
      state: 'installed',
      // The new worker agrees on the port it was handed.
      postMessage: vi.fn((_data: unknown, ports: MessagePort[]) => {
        ports[0]?.postMessage('taking over');
        ports[0]?.close();
      }),
      addEventListener: () => undefined,
    };
    sw.registration.waiting = waiting;
    sw.windows.push({ id: 'tab', url: SCOPE, visibilityState: 'visible', navigate: vi.fn() });
    // The tab reloading itself says so first.
    await sw.message({ type: 'leaving' }, [], { id: 'tab' });
    sw.network.set(SCOPE, 'deployed page');
    expect(await (await sw.fetch(`${SCOPE}?share=x`, 'navigate'))?.text()).toBe('deployed page');
    expect(waiting.postMessage).toHaveBeenCalledWith('skip-waiting', [expect.anything()]);

    const offline = harness(BUILD, SITE);
    await offline.install();
    offline.registration.waiting = waiting;
    offline.windows.push({ id: 'tab', url: SCOPE, visibilityState: 'visible', navigate: vi.fn() });
    await offline.message({ type: 'leaving' }, [], { id: 'tab' });
    offline.online.value = false;
    const reload = await (await offline.fetch(`${SCOPE}?share=x`, 'navigate'))?.text();
    expect(reload).toContain('http-equiv="refresh"');
    expect(reload).not.toContain('<script');
    // Once: should the reload come back to the old worker, it serves its page.
    expect(await (await offline.fetch(`${SCOPE}?share=x`, 'navigate'))?.text()).toBe(PAGE);
    expect(waiting.postMessage).toHaveBeenCalledTimes(2);
  });

  it('never hands a new window over while another tab, not leaving, still runs the old build', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    const waiting: FakeWaiting = { state: 'installed', postMessage: vi.fn(), addEventListener: () => undefined };
    sw.registration.waiting = waiting;
    // One visible tab, left open: the navigation is a new window, not its reload.
    sw.windows.push({ id: 'old', url: SCOPE, visibilityState: 'visible', navigate: vi.fn() });
    expect(await (await sw.fetch(SCOPE, 'navigate'))?.text()).toBe(PAGE);
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  it('takes over at once for a page of its own build that is the only window', async () => {
    const sw = harness(BUILD, SITE);
    sw.windows.push({ id: 'tab', url: SCOPE, visibilityState: 'visible', navigate: vi.fn() });
    await sw.message({ type: 'take-over', marker: '_next/static/chunks/webpack-other.js' });
    expect(sw.skipWaiting).not.toHaveBeenCalled();
    await sw.message({ type: 'take-over', marker: RUNTIME });
    expect(sw.skipWaiting).toHaveBeenCalledOnce();
    sw.windows.push({ id: 'other', url: SCOPE, visibilityState: 'hidden', navigate: vi.fn() });
    await sw.message({ type: 'take-over', marker: RUNTIME });
    expect(sw.skipWaiting).toHaveBeenCalledOnce();
  });

  it('answers offline with a script-free page when no valid page is cached', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    ownStore(sw).set(SCOPE, new Response('<script>pwned</script>'));
    sw.online.value = false;
    const response = await sw.fetch(SCOPE, 'navigate');
    expect(response?.status).toBe(503);
    const html = (await response?.text()) ?? '';
    expect(html).toContain('Couldn’t open offline');
    expect(html).not.toMatch(/<script|pwned/);
    expect(response?.headers.get('content-security-policy')).toBe(OWN_PAGES.OWN_PAGE_POLICY);
    expect(OWN_PAGES.OWN_PAGE_POLICY).toContain(`'sha256-${sha256(OWN_PAGES.OWN_PAGE_STYLE)}'`);
    expect(html).toContain(`<style>${OWN_PAGES.OWN_PAGE_STYLE}</style>`);
  });

  it('keeps the old build while another tab still runs it', async () => {
    const sw = harness(BUILD, SITE);
    await sw.install();
    const waiting: FakeWaiting = { state: 'installed', postMessage: vi.fn(), addEventListener: () => undefined };
    sw.registration.waiting = waiting;
    sw.windows.push({ url: SCOPE, visibilityState: 'visible', navigate: vi.fn() });
    sw.windows.push({ url: SCOPE, visibilityState: 'hidden', navigate: vi.fn() });
    expect(await (await sw.fetch(SCOPE, 'navigate'))?.text()).toBe(PAGE);
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  it('counts only this site\'s windows: a sibling site on the origin doesn\'t block a takeover', async () => {
    const sw = harness(BUILD, SITE);
    sw.windows.push({ id: 'tab', url: SCOPE, visibilityState: 'visible', navigate: vi.fn() });
    sw.windows.push({ id: 'sibling', url: 'https://example.org/sibling/', visibilityState: 'visible', navigate: vi.fn() });
    await sw.message({ type: 'take-over', marker: RUNTIME });
    expect(sw.skipWaiting).toHaveBeenCalledOnce();
  });

  it('tells a page whether it is of this build', async () => {
    const sw = harness(BUILD, SITE);
    const ask = async (marker: string) => {
      const channel = new MessageChannel();
      const reply = new Promise((resolve) => (channel.port1.onmessage = (event) => resolve(event.data)));
      await sw.message({ type: 'is-mine', marker }, [channel.port2]);
      const answer = await reply;
      channel.port1.close();
      return answer;
    };
    expect(await ask(RUNTIME)).toBe(true);
    expect(await ask('_next/static/chunks/webpack-other.js')).toBe(false);
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });

  // Another site on the origin can create caches named like an older build's.
  it('never serves anything from a forged older cache, and deletes it on activate, even with other tabs open', async () => {
    const forged = new Map<string, Response>([
      [`${SCOPE}_next/static/chunks/late.js`, new Response('window.pwned=1')],
      [`${SCOPE}_next/static/chunks/a.js`, new Response('window.pwned=1')],
      [`${SCOPE}pc-precache-hashes.json`, new Response(JSON.stringify({ '_next/static/chunks/late.js': sha256('window.pwned=1') }))],
    ]);
    const forgedName = `${PREFIX}x#${sha256('list')}`;
    const sw = harness(BUILD, SITE, new Map([[forgedName, forged]]));
    await sw.install();
    sw.windows.push({ id: 'one', url: SCOPE, visibilityState: 'visible', navigate: vi.fn() });
    sw.windows.push({ id: 'two', url: SCOPE, visibilityState: 'visible', navigate: vi.fn() });
    expect(sw.fetched).toContain(`${SCOPE}_next/static/chunks/a.js`);
    expect(await (await sw.fetch(`${SCOPE}_next/static/chunks/a.js`))?.text()).toBe('a');
    // Another build's chunk is left to the network.
    expect(await sw.fetch(`${SCOPE}_next/static/chunks/late.js`)).toBeUndefined();
    await sw.activate();
    expect(sw.stores.has(forgedName)).toBe(false);
  });

  it('takes over when the waiting worker is told to, and says so', async () => {
    const sw = harness(BUILD, SITE);
    const channel = new MessageChannel();
    const reply = new Promise((resolve) => (channel.port1.onmessage = (event) => resolve(event.data)));
    void sw.message('skip-waiting', [channel.port2]);
    expect(await reply).toBe('taking over');
    channel.port1.close();
    expect(sw.skipWaiting).toHaveBeenCalledOnce();
    void sw.message('something else');
    expect(sw.skipWaiting).toHaveBeenCalledOnce();
  });
});

describe('the kill switch worker', () => {
  it('takes over at once, deletes this site\'s caches only, unregisters and reloads its pages', async () => {
    const stores = new Map<string, Map<string, Response>>([
      [`${PREFIX}abc`, new Map()],
      ['pc-shell:/sibling/:x', new Map()],
      ['someone-else', new Map()],
    ]);
    const sw = harness(removalWorkerSource(), {}, stores);
    const page = { url: `${SCOPE}?share=x`, visibilityState: 'visible', navigate: vi.fn(() => Promise.resolve()) };
    sw.windows.push(page);
    await sw.install();
    expect(sw.skipWaiting).toHaveBeenCalledOnce();
    await sw.activate();
    expect([...sw.stores.keys()].sort()).toEqual(['pc-shell:/sibling/:x', 'someone-else']);
    expect(sw.registration.unregister).toHaveBeenCalledOnce();
    expect(page.navigate).toHaveBeenCalledWith(page.url);
    // No fetch handler: every request goes to the network.
    expect(await sw.fetch(SCOPE, 'navigate').catch(() => 'no handler')).toBe('no handler');
  });
});
