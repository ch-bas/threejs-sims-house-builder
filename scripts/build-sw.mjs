// Post-export step (#933): writes out/sw.js, the service worker that lets the
// app open offline.
//
//   next build && node scripts/build-sw.mjs [outDir]
//   NEXT_PUBLIC_SERVICE_WORKER=off node scripts/build-sw.mjs   (kill switch; also false or 0)
//
// The worker precaches the app shell and every file under _next/static/
// (the hashed chunks, the CSS, the fonts and the people GLB) when it
// installs, then answers:
//   - hashed files (_next/static/chunks, css, media): cache first. The names
//     are content hashes, so a cached copy is never stale, and a return visit
//     skips Pages' 10-minute revalidation of every chunk.
//   - pages (navigations) and the other precached files (manifest, icons,
//     404 page, the build manifests whose names don't change between
//     builds): network first, the cached copy only when the network fails.
//     Online, the page is always the deployed one.
//   - anything else: not touched.
// The cache holds exactly one build, written at install; at run time an
// entry is only ever put back (after a failed check, say) from a network
// response with that build's bytes. So a failed or 404 response, or another
// deploy's file, is never stored, and the stale-chunk recovery (#499) never
// meets a cached mismatch.
//
// Integrity: GitHub Pages serves every project site of an account from one
// origin, and the Cache API is per origin, so a sibling site can write into
// these caches. The worker therefore carries the SHA-256 of every precached
// file and checks it at install (network and copied-forward entries alike)
// and again before serving anything from the cache; a mismatch deletes the
// entry and goes to the network. Since the page itself is hashed, install
// also refuses a page from another deploy, so the cached page and chunks
// always match.
//
// Cache names carry the site's path (`pc-shell:<scope path>:<build>`), so
// `activate` deletes only this site's older caches. The build part is a hash
// of the worker itself, so each worker owns its cache and a failed install
// can delete its partial one. Hashed files an older cache holds are copied
// over (after the check) instead of downloaded again.
//
// Updates: a new worker waits while the old one controls a page. Two ways
// it takes over early:
//   - a page of the new build (fetched online while the old worker still
//     controls it) asks the waiting worker to take over as soon as it has
//     installed; the waiting worker does so only when that page is the only
//     window, and only if the page loads its own build's runtime;
//   - a reload of the only tab: the page tells the old worker it is leaving,
//     and the old worker tells the new one to take over, which it does as
//     soon as that navigation is answered. Online the answer is the
//     network's page; offline it is a page that reloads at once, so the new
//     build serves the load. A new window while another tab still runs the
//     old build is not a reload, and takes nothing over.
// So a single tab moves to the new build once its worker has installed.
// Otherwise (several tabs, or a page of the older build) the page offers
// "A new version is ready · Reload" (hooks/use-update-prompt.ts) unless this
// worker says the page is already of its build ('is-mine'); the click saves,
// then sends 'skip-waiting', which this worker obeys whatever tabs are open,
// since the player asked, and the page reloads once on controllerchange.
// That update also reaches the other open tabs: `activate` deletes the
// older build's cache, as always (only bytes matching this worker's own
// hashes are ever served from a cache, so nothing stored can vouch for
// another build's files). A tab still running the older build then offers
// "This tab is on an older version · Reload", and a chunk it loads late
// comes from the network, where a deploy may have removed it: the
// stale-chunk recovery (#499) reloads it.
// With several tabs open and no click, or when the install was cut short, an older build
// can still run offline after a newer one saved; the save stamp
// (lib/saved-by.ts) then asks before that older build saves over it.
//
// Kill switch: with NEXT_PUBLIC_SERVICE_WORKER=off the file is a worker that
// removes itself: it takes over at once, deletes this site's caches,
// unregisters and reloads its pages. The browser fetches sw.js on its own,
// so this reaches a page too broken to run any script.
//
// The worker's URLs are relative to its own location, so the same file works
// with and without the Pages basePath. The page registers it after the first
// frame (lib/service-worker.ts); the CSP allows it by `worker-src`
// (scripts/add-csp.mjs).
//
// Re-running is safe: the worker is rewritten from the files in out/.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKER_FILE = 'sw.js';
/** The page itself, cached under the scope URL. */
export const PAGE_ENTRY = './';
/** Unhashed files the shell needs besides the page and _next/static/. */
export const SHELL_FILES = ['404.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-icon.png', 'favicon.ico'];
const STATIC_PREFIX = '_next/static/';

/**
 * The URLs the worker precaches, relative to its scope, from the files of
 * the export (paths relative to out/, '/' separators): the page, the shell
 * files that exist, and everything under _next/static/, sorted.
 */
export function precacheEntries(files) {
  const present = new Set(files);
  if (!present.has('index.html')) throw new Error('No index.html in the export');
  const hashed = files.filter((file) => file.startsWith(STATIC_PREFIX)).sort();
  return [PAGE_ENTRY, ...SHELL_FILES.filter((file) => present.has(file)), ...hashed];
}

/**
 * The marker that ties a page to its build: the path of the webpack runtime
 * chunk it loads, relative to the scope (the smoke test checks the page it
 * gets offline with it).
 */
export function pageMarker(html) {
  const match = /\/(_next\/static\/chunks\/webpack-[^"/]+\.js)"/.exec(html);
  if (!match?.[1]) throw new Error('index.html loads no webpack runtime chunk');
  return match[1];
}

/** SHA-256 of a file's bytes, base64, as the worker computes it. */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('base64');
}

/**
 * The prefix of this site's cache names, from the worker's scope URL.
 * Stringified into the worker and mirrored by lib/service-worker.ts.
 */
export function cachePrefix(scope) {
  return `pc-shell:${new URL(scope).pathname}:`;
}

/**
 * How the worker answers a request: 'static' (cache first), 'page' or
 * 'fresh' (network first), or null to leave it to the browser. `url` and
 * `scope` are absolute; `precached` lists the entries relative to the scope.
 * Only content-hashed files are cache first; a file under _next/static/
 * that isn't this build's is left to the network. Stringified into the
 * worker, so it must stay self-contained.
 */
export function routeFor(url, scope, mode, method, precached) {
  if (method !== 'GET') return null;
  const target = new URL(url);
  const base = new URL(scope);
  if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) return null;
  if (mode === 'navigate') return 'page';
  const relative = target.pathname.slice(base.pathname.length);
  if (!precached.includes(relative)) return null;
  return /^_next\/static\/(chunks|css|media)\//.test(relative) ? 'static' : 'fresh';
}

/** The cache key a navigation falls back to when the network fails. */
export function pageFallback(url, scope) {
  const relative = new URL(url).pathname.slice(new URL(scope).pathname.length);
  return relative === '' || relative === 'index.html' ? './' : '404.html';
}

/** The content type served for a cached entry, from its name (never from the cache). */
export function contentType(entry) {
  const ext = /\.([a-z0-9]+)$/i.exec(entry)?.[1]?.toLowerCase() ?? 'html';
  const types = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    webmanifest: 'application/manifest+json',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    ico: 'image/x-icon',
    woff2: 'font/woff2',
    glb: 'model/gltf-binary',
  };
  return types[ext] ?? 'application/octet-stream';
}

const BUILD_PLACEHOLDER = '__PC_BUILD__';

const OWN_PAGE_STYLE =
  'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1a2a33;color:#f4f1e8;font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}main{max-width:28em;text-align:center}a{color:#7ee0f0}';
const RELOAD_PAGE = '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0"><title>Updating</title>';
const OFFLINE_PAGE =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  `<title>Couldn’t open offline</title><style>${OWN_PAGE_STYLE}</style>` +
  '<main><h1>Couldn’t open offline</h1><p>The copy of the builder saved for offline use couldn’t be used. Your houses are safe in this browser. Connect to the internet and <a href="./">reload</a>.</p></main></html>';
/** The worker's own pages run nothing; their one style is allowed by its hash. */
const OWN_PAGE_POLICY = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(OWN_PAGE_STYLE).digest('base64')}'`;

/** The worker's own pages and their policy, for tests. */
export const OWN_PAGES = { RELOAD_PAGE, OFFLINE_PAGE, OWN_PAGE_STYLE, OWN_PAGE_POLICY };

/** The worker's source for one build, given each precached entry's SHA-256. */
export function workerSource({ hashes }) {
  const body = `// Generated by scripts/build-sw.mjs (#933). Do not edit.
'use strict';
const BUILD = ${JSON.stringify(BUILD_PLACEHOLDER)};
const HASHES = ${JSON.stringify(hashes)};
const PRECACHE = Object.keys(HASHES);
const routeFor = ${routeFor.toString()};
const pageFallback = ${pageFallback.toString()};
const cachePrefix = ${cachePrefix.toString()};
const contentType = ${contentType.toString()};
const PREFIX = cachePrefix(self.registration.scope);
const CACHE = PREFIX + BUILD;
/** How long a reload waits for the new worker to agree to take over. */
const HANDOVER_MS = 3000;
let handedOverAt = -Infinity;

async function digest(buffer) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** The response rebuilt from its checked bytes, or null when they aren't this build's. */
async function checked(response, entry) {
  if (!response || !response.ok) return null;
  const buffer = await response.arrayBuffer();
  if ((await digest(buffer)) !== HASHES[entry]) return null;
  return new Response(buffer, { status: 200, headers: { 'content-type': contentType(entry) } });
}

async function install() {
  const cache = await caches.open(CACHE);
  try {
    const older = (await caches.keys()).filter((name) => name.startsWith(PREFIX) && name !== CACHE);
    for (const entry of PRECACHE) {
      let response = null;
      if (/^_next\\/static\\/(chunks|css|media)\\//.test(entry)) {
        // Content-hashed: an older build's copy is this one, once checked.
        for (const name of older) {
          response = await checked(await (await caches.open(name)).match(entry), entry);
          if (response) break;
        }
      }
      if (!response) {
        // The page and the unhashed files straight from the network. A page
        // from a newer deploy fails the check, and this install gives up
        // (the next visit installs that deploy's worker).
        const hashed = /^_next\\/static\\/(chunks|css|media)\\//.test(entry);
        response = await checked(await fetch(new Request(entry, { cache: hashed ? 'default' : 'reload' })), entry);
        if (!response) throw new Error(entry + ' is not this build');
      }
      await cache.put(entry, response);
    }
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
}

async function activate() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
}

/** The entry from this build's cache after the check; a bad one is deleted. */
async function cached(entry) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(entry);
  if (!hit) return null;
  const response = await checked(hit, entry);
  if (!response) await cache.delete(entry);
  return response;
}

function entryOf(url) {
  const relative = new URL(url).pathname.slice(new URL(self.registration.scope).pathname.length);
  return relative === '' || relative === 'index.html' ? './' : relative;
}

/** Window clients that said they are leaving (a reload or a close), by id, with when. */
const leaving = new Map();
const LEAVING_MS = 10000;

/**
 * This site's windows. The origin is shared with sibling sites (and their
 * frames), which clients.matchAll lists too when uncontrolled ones are asked
 * for: only those under this worker's scope count.
 */
async function ourWindows(includeUncontrolled) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled });
  return windows.filter((client) => typeof client.url === 'string' && client.url.startsWith(self.registration.scope));
}

/**
 * A navigation from the only open tab reloading itself while a new worker
 * waits: tell the new worker to take over, and resolve true once it has
 * agreed. The browser activates it as soon as this fetch is answered. A
 * window that hasn't said it is leaving (another tab, left open) keeps the
 * old build in charge.
 */
async function handOver() {
  const waiting = self.registration.waiting;
  if (!waiting) return false;
  // Once per handover: a takeover that never comes can't loop the page.
  if (Date.now() - handedOverAt < HANDOVER_MS) return false;
  const alone = async () => {
    const windows = await ourWindows(false);
    return windows.every((client) => Date.now() - (leaving.get(client.id) || -Infinity) < LEAVING_MS);
  };
  // The page's "leaving" message can arrive just after its navigation.
  let ok = await alone();
  for (let tries = 0; !ok && tries < 4; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    ok = await alone();
  }
  if (!ok) return false;
  const agreed = await new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve(true);
    setTimeout(() => resolve(false), HANDOVER_MS);
    waiting.postMessage('skip-waiting', [channel.port2]);
  });
  if (agreed) handedOverAt = Date.now();
  return agreed;
}

/**
 * Pages served by the worker itself, never from a cache: script-free, under
 * a policy that allows nothing but their own style (by hash).
 *   - Offline, during a handover: not this build's page (the new worker
 *     would take it over halfway, its chunks gone from the cache), but one
 *     that loads the address again once the new worker is in charge.
 *   - Offline, with no valid page in the cache (a sibling site tampered
 *     with it, say): why the editor can't open, instead of a browser error.
 */
const RELOAD_PAGE = ${JSON.stringify(RELOAD_PAGE)};
const OFFLINE_PAGE = ${JSON.stringify(OFFLINE_PAGE)};
const OWN_PAGE_POLICY = ${JSON.stringify(OWN_PAGE_POLICY)};

function ownPage(html, status) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': OWN_PAGE_POLICY },
  });
}

/**
 * Puts back an entry the cache lost (a failed check deleted it, or a sibling
 * site did), from a network response with this build's bytes. Anything
 * else, another deploy's page included, is left out.
 */
async function heal(entry, response) {
  if (!(entry in HASHES) || !response.ok) return;
  const cache = await caches.open(CACHE);
  if (await cache.match(entry)) return;
  const good = await checked(response, entry);
  if (good) await cache.put(entry, good);
}

async function respond(request, route, waitUntil) {
  // Online, the network's page matches the new worker's build; offline, the
  // reload page hands the load to the new worker.
  const handing = route === 'page' && (await handOver());
  const entry = route === 'page' ? pageFallback(request.url, self.registration.scope) : entryOf(request.url);
  if (route === 'static') {
    const hit = await cached(entry);
    if (hit) return hit;
    const response = await fetch(request);
    waitUntil(heal(entry, response.clone()));
    return response;
  }
  try {
    const response = await fetch(request);
    if (route === 'fresh' || entryOf(request.url) === entry) waitUntil(heal(entry, response.clone()));
    return response;
  } catch (error) {
    if (handing) return ownPage(RELOAD_PAGE, 200);
    const response = await cached(entry);
    if (response) return response;
    if (route === 'page') return ownPage(OFFLINE_PAGE, 503);
    throw error;
  }
}

self.addEventListener('install', (event) => event.waitUntil(install()));
self.addEventListener('activate', (event) => event.waitUntil(activate()));
self.addEventListener('message', (event) => {
  const data = event.data;
  // A page of this site going away (a reload or a close), told to the worker in charge.
  if (data && data.type === 'leaving' && event.source) {
    leaving.set(event.source.id, Date.now());
    return;
  }
  // A page of this build, while the old worker still controls it: take over
  // now if it is the only window (and so runs nothing older).
  if (data && data.type === 'take-over' && PRECACHE.includes(data.marker)) {
    event.waitUntil(
      ourWindows(true).then((windows) => {
        if (windows.length === 1) return self.skipWaiting();
        return undefined;
      })
    );
    return;
  }
  // Whether a page is of this build (lib/service-worker.ts asks before offering an update).
  if (data && data.type === 'is-mine') {
    const answer = event.ports && event.ports[0];
    if (answer) answer.postMessage(PRECACHE.includes(data.marker));
    return;
  }
  if (data !== 'skip-waiting') return;
  // Not awaited: the browser settles skipWaiting() only once this worker is
  // active, which waits for the old worker's fetch, which waits for this reply.
  event.waitUntil(self.skipWaiting());
  const reply = event.ports && event.ports[0];
  if (reply) reply.postMessage('taking over');
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const route = routeFor(request.url, self.registration.scope, request.mode, request.method, PRECACHE);
  if (route) event.respondWith(respond(request, route, (promise) => event.waitUntil(promise.catch(() => undefined))));
});
`;
  const build = createHash('sha256').update(body).digest('hex').slice(0, 16);
  return body.replace(JSON.stringify(BUILD_PLACEHOLDER), JSON.stringify(build));
}

/**
 * The kill switch: a worker that removes itself and this site's caches,
 * then reloads its pages from the network.
 */
export function removalWorkerSource() {
  return `// Generated by scripts/build-sw.mjs (#933) with NEXT_PUBLIC_SERVICE_WORKER=off. Do not edit.
'use strict';
const cachePrefix = ${cachePrefix.toString()};
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const prefix = cachePrefix(self.registration.scope);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(prefix)).map((name) => caches.delete(name)));
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: 'window' });
      await self.registration.unregister();
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => undefined)));
    })()
  );
});
`;
}

/** Whether the build turned the worker off (the kill switch): off, false or 0, any case. */
export function workerOff(env) {
  return /^(off|false|0)$/i.test((env.NEXT_PUBLIC_SERVICE_WORKER ?? '').trim());
}

async function exportedFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter((file) => file !== WORKER_FILE)
    .sort();
}

async function main() {
  const outDir = path.resolve(process.argv[2] ?? 'out');
  const target = path.join(outDir, WORKER_FILE);
  if (workerOff(process.env)) {
    await writeFile(target, removalWorkerSource());
    process.stdout.write(`Service worker: ${path.relative(process.cwd(), target)} removes itself (NEXT_PUBLIC_SERVICE_WORKER=off)\n`);
    return;
  }
  const entries = precacheEntries(await exportedFiles(outDir));
  const hashes = {};
  let bytes = 0;
  for (const entry of entries) {
    const content = await readFile(path.join(outDir, entry === PAGE_ENTRY ? 'index.html' : entry));
    hashes[entry] = sha256(content);
    bytes += content.length;
  }
  pageMarker((await readFile(path.join(outDir, 'index.html'))).toString('utf8'));
  await writeFile(target, workerSource({ hashes }));
  process.stdout.write(
    `Service worker: ${path.relative(process.cwd(), target)} (${entries.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, each checked by SHA-256)\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
