// Headless-browser smoke test of the static export (#561).
//
//   npm run build && node scripts/smoke-test.mjs [outDir]
//
// The unit suite never runs the built site, so a CSP violation, a 404 under
// the Pages basePath, a broken engine start or the stale-chunk recovery in
// app/layout.tsx would ship unnoticed. This serves out/ at the basePath the
// build was made with (read from out/index.html), a Pages build at its real
// https://<owner>.github.io address (see siteOrigin), and loads it in
// headless Chromium with SwiftShader, so no GPU is needed:
//
// 1. / at a desktop viewport (and a phone one with SMOKE_PHONE=1): any
//    console error, page error, failed request, response >= 400, CSP
//    violation or reload fails, and the 3D engine must signal ready
//    (window.__pcReady) within 60 s; at the desktop viewport, the selected
//    radio must also look different under forced colours (#927);
// 2. /404.html and an unknown path (served as Pages does, status 404) must
//    show the branded page with its link back to the builder;
// 3. with the editor chunk answering 404, the page must reload exactly once
//    and then show the error screen (the one-reload contract of #499);
// 4. with a second window of the site open, a newer worker must wait, the
//    editor must offer "A new version is ready" (not over the start
//    chooser), and Reload must hand over and reload that page exactly once,
//    the other window left alone (#933, from the local origin: see checkUpdate);
// 5. after the desktop load, once the service worker is active, a reload
//    with the network gone must open the editor from its precache (#933).
//
// Browser: `playwright` if installed (its own Chromium), else `playwright-core`
// with an installed Chrome. SMOKE_BROWSER_CHANNEL picks a channel ("chrome"),
// CSP_SITE_ORIGIN overrides the site origin,
// SMOKE_SCREENSHOTS=<dir> saves a screenshot per check, SMOKE_VERBOSE=1 logs
// progress and every console message.
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { siteOrigin as cspSiteOrigin } from './add-csp.mjs';
import { pageChunks } from './add-preloads.mjs';
import { pageMarker } from './build-sw.mjs';

const outDir = path.resolve(process.argv[2] ?? 'out');
const READY_TIMEOUT_MS = 60_000;
// Late console errors and a second automatic reload land within this.
const SETTLE_MS = 3_000;
// Waits measured here, not in the page: after the ready signal the shader
// warm-up compiles every program, and software WebGL has no parallel
// compile, so the page itself can be unresponsive for half a minute or more.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (promise, ms, fallback) => Promise.race([promise, sleep(ms).then(() => fallback)]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
};

/** The basePath the export was built with ('' without one), from its own HTML. */
function basePathOf(html) {
  const match = /"(\/[^"]*?)?\/_next\/static\//.exec(html);
  if (!match) throw new Error('out/index.html loads nothing from /_next/static/');
  return match[1] ?? '';
}

/** The file under out/ a URL path names, null when none, undefined when the path is malformed. */
async function fileFor(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  const clean = path.normalize(decoded).replace(/^([/\\])+/, '');
  const candidates = clean === '' || clean.endsWith('/') ? [path.join(clean, 'index.html')] : [clean, `${clean}.html`, path.join(clean, 'index.html')];
  for (const candidate of candidates) {
    const file = path.join(outDir, candidate);
    if (!file.startsWith(outDir + path.sep)) return null;
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return file;
  }
  return null;
}

/**
 * A static server for out/ at the basePath; unknown paths get 404.html with
 * status 404, as on Pages, and a malformed one a plain 400. A request it
 * can't answer ends that response, never the run.
 */
let served = 0;
/** Set by the update check: sw.js is then served as a newer build's. */
let workerUpdated = false;
const IS_MINE_ANSWER = 'answer.postMessage(PRECACHE.includes(data.marker));';

/**
 * sw.js as a newer build's worker: a cache of its own (another build name),
 * and no page of this build is its own.
 */
function newerWorker(source) {
  const build = /const BUILD = "([0-9a-f]+)";/;
  if (!source.includes(IS_MINE_ANSWER) || !build.test(source)) throw new Error('sw.js no longer reads as the smoke test expects');
  return source.replace(IS_MINE_ANSWER, 'answer.postMessage(false); // smoke test: a newer build').replace(build, 'const BUILD = "$1-newer";');
}

function serve(basePath) {
  const server = createServer(async (req, res) => {
    served += 1;
    const plain = (status) => {
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(status));
    };
    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      const inBase = basePath === '' || pathname === basePath || pathname.startsWith(`${basePath}/`);
      const file = inBase ? await fileFor(pathname.slice(basePath.length)) : null;
      if (file === undefined) return plain(400);
      const status = file ? 200 : 404;
      const body = file ?? path.join(outDir, '404.html');
      res.writeHead(status, { 'content-type': TYPES[path.extname(body)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      // A newer build's worker for the update check (#933): the same precache,
      // but it says the page isn't of its build, as a real newer build would.
      if (workerUpdated && path.basename(body) === 'sw.js') return res.end(newerWorker(await readFile(body, 'utf8')));
      createReadStream(body)
        .on('error', () => (res.headersSent ? res.destroy() : plain(404)))
        .pipe(res);
    } catch {
      plain(400);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * Where the pages are loaded from. A build without a basePath is loaded from
 * the local server as it is. A Pages build is loaded at its real address,
 * https://<owner>.github.io/<basePath>/, with every request to that origin
 * answered from the local server by Playwright routing, so a policy naming
 * the site's own URL (not just 'self') is tested exactly as deployed. The
 * origin comes from scripts/add-csp.mjs's own siteOrigin, so the check can't
 * drift from the policy it tests.
 */
async function siteOrigin(basePath, local) {
  if (basePath === '') return local;
  const { homepage } = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  const origin = cspSiteOrigin(process.env, homepage);
  if (!origin) throw new Error('No site origin: set CSP_SITE_ORIGIN or package.json homepage');
  return origin;
}

let site = { origin: '', local: '' };

/** A browser context whose requests to the site origin reach the local server. */
async function newContext(browser, options) {
  const context = await browser.newContext(options);
  if (site.origin !== site.local) {
    await context.route(
      (url) => url.origin === site.origin,
      async (route) => {
        const url = new URL(route.request().url());
        try {
          const response = await route.fetch({ url: `${site.local}${url.pathname}${url.search}`, maxRedirects: 0 });
          await route.fulfill({ response });
        } catch {
          await route.abort('connectionfailed').catch(() => undefined);
        }
      },
    );
  }
  return context;
}

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    return (await import('playwright-core')).chromium;
  }
}

const T0 = Date.now();
/** Progress lines with SMOKE_VERBOSE=1. */
const trace = (...parts) => {
  if (process.env.SMOKE_VERBOSE) process.stdout.write(`${((Date.now() - T0) / 1000).toFixed(1)}s ${parts.join(' ')}\n`);
};

const problems = [];
const fail = (check, message) => problems.push(`${check}: ${message}`);

/** Records every console error, page error, failed request, HTTP error and CSP violation. */
function watch(page, check, { ignoreUrl = () => false } = {}) {
  page.on('console', (msg) => {
    trace(check, `console.${msg.type()}`, msg.text().slice(0, 200));
    if (msg.type() === 'error' && !ignoreUrl(msg.location().url)) fail(check, `console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => fail(check, `page error: ${err.message}`));
  page.on('requestfailed', (req) => {
    if (!ignoreUrl(req.url())) fail(check, `request failed: ${req.url()} (${req.failure()?.errorText ?? '?'})`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !ignoreUrl(res.url())) fail(check, `HTTP ${res.status()}: ${res.url()}`);
  });
}

// Runs in the page before its own scripts; an init script is not subject to the CSP.
const RECORD_CSP_VIOLATIONS = () => {
  window.__smokeCsp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__smokeCsp.push(`${e.violatedDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`);
  });
};

async function screenshot(page, name) {
  const dir = process.env.SMOKE_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  // Evidence only: a screenshot that can't be taken fails nothing.
  await page.screenshot({ path: path.join(dir, `${name}.png`), timeout: 10_000 }).catch((err) => {
    process.stdout.write(`(no screenshot of ${name}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)})\n`);
  });
}

/**
 * The editor gets a browser of its own: software WebGL compiles shaders in
 * the shared GPU process, which stalls every other page of that browser,
 * and a page busy compiling can't be closed politely, only killed.
 */
async function checkEditor(launch, origin, basePath, name, contextOptions, { offline = false } = {}) {
  const started = Date.now();
  const browser = await launch();
  const context = await newContext(browser, contextOptions);
  const page = await context.newPage();
  await page.addInitScript(RECORD_CSP_VIOLATIONS);
  watch(page, name);
  // One document only: a reload here means the head watchdog or the chunk
  // recovery fired on a healthy build (the 20 s watchdog on a slow runner).
  let loads = 0;
  page.on('request', (req) => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) loads += 1;
  });
  try {
    await page.goto(`${origin}${basePath}/`, { waitUntil: 'load' });
    trace(name, 'loaded');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').count();
    if (csp !== 1) fail(name, `expected one CSP meta, found ${csp}`);
    await page.waitForFunction(() => window.__pcReady === true, null, { timeout: READY_TIMEOUT_MS });
    trace(name, 'ready');
    await sleep(SETTLE_MS);
    // A violation also logs a console error; this listener is the backstop.
    const violations = await within(page.evaluate(() => window.__smokeCsp), 10_000, []);
    for (const violation of violations) fail(name, `CSP violation: ${violation}`);
    if (loads !== 1) fail(name, `expected no reload (1 document), saw ${loads}`);
    if (name === 'desktop') await checkForcedColours(page, name);
    if (offline) await checkOffline(context, page, name);
  } catch (err) {
    fail(name, `${err instanceof Error ? err.message.split('\n')[0] : String(err)} (after ${loads} document(s))`);
  } finally {
    await screenshot(page, name);
    // The process exit at the end kills a browser that doesn't close in time.
    await within(browser.close(), 5_000, undefined);
    trace(name, 'closed');
  }
  return Date.now() - started;
}

/**
 * Forced colours (#927): a Windows Contrast theme replaces the tint that marks
 * the selected option, so the selected radio of a group must still draw
 * differently from the others there.
 */
async function checkForcedColours(page, name) {
  await page.emulateMedia({ forcedColors: 'active' });
  const looks = await within(
    page.evaluate(() => {
      const look = (el) => {
        // The tiles ease their colours, and a page busy compiling shaders
        // holds the transition at its start: read where it ends.
        for (const animation of el.getAnimations()) animation.finish();
        const style = getComputedStyle(el);
        // The hue only: the forced palette keeps each tint's own alpha, so
        // two tints of the same system colour differ in alpha alone.
        const hue = (colour) => colour.replace(/^rgba?\(([^,]+),([^,]+),([^,)]+).*$/, 'rgb($1,$2,$3)');
        return [style.backgroundColor, style.color, style.borderTopColor].map(hue).join(' ');
      };
      for (const group of document.querySelectorAll('[role="radiogroup"]')) {
        const on = group.querySelector('[role="radio"][aria-checked="true"]');
        const off = group.querySelector('[role="radio"][aria-checked="false"]');
        if (on && off) return { group: group.getAttribute('aria-label') ?? '?', on: look(on), off: look(off) };
      }
      return null;
    }),
    10_000,
    undefined,
  );
  await page.emulateMedia({ forcedColors: 'none' });
  if (looks === undefined) return fail(name, 'forced colours: the page did not answer');
  if (looks === null) return fail(name, 'forced colours: no radio group with a selected and an unselected option');
  trace(name, 'forced colours', JSON.stringify(looks));
  if (looks.on === looks.off) fail(name, `forced colours: the selected option of "${looks.group}" looks like the others (${looks.on})`);
}

/** Polls `test` in the page until it holds or `ms` pass; false then. */
async function until(page, test, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await within(page.evaluate(test).catch(() => false), 5_000, false)) return true;
    await sleep(250);
  }
  return false;
}

/**
 * 4. The update prompt (#933): with a second window of the site open, a newer
 * worker can't take over by itself, so it waits and the editor offers it,
 * but not over the start chooser (a modal). Reload must save, hand over and
 * reload that page exactly once; the other window keeps its document.
 *
 * The browser fetches a worker's update itself, past Playwright's routing,
 * so this check loads the site from the local server's own origin, with the
 * CSP (which names the Pages origin) bypassed: the desktop check covers it.
 */
async function checkUpdate(launch, basePath) {
  const name = 'update';
  const offerName = 'Reload to open the new version';
  const started = Date.now();
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
  const page = await context.newPage();
  watch(page, name);
  const home = `${site.local}${basePath}`;
  let other = null;
  try {
    await page.goto(`${home}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__pcReady === true, null, { timeout: READY_TIMEOUT_MS });
    const ready = await within(page.evaluate(() => navigator.serviceWorker.ready.then(() => true)), READY_TIMEOUT_MS, false);
    if (!ready) return fail(name, 'no service worker became active');
    // A first visit isn't controlled: a reload puts the worker in charge.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__pcReady === true, null, { timeout: READY_TIMEOUT_MS });
    if (!(await until(page, () => navigator.serviceWorker.controller !== null, 10_000))) return fail(name, 'the reloaded page is not controlled');
    other = await context.newPage();
    let otherLoads = 0;
    other.on('request', (req) => {
      if (req.isNavigationRequest() && req.frame() === other.mainFrame()) otherLoads += 1;
    });
    // The 404 page, open for longer than the head watchdog's 20 s: it must
    // not reload itself either (it never starts the editor).
    await other.goto(`${home}/404.html`, { waitUntil: 'load' });
    const otherOpenedAt = Date.now();
    await page.bringToFront();
    workerUpdated = true;
    await within(page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration?.update())), 30_000, undefined);
    const waits = await until(page, () => navigator.serviceWorker.getRegistration().then((registration) => Boolean(registration?.waiting)), 30_000);
    if (!waits) return fail(name, 'the newer worker did not install and wait');
    trace(name, 'newer worker waiting');
    const offer = page.getByRole('button', { name: offerName });
    const chooser = page.getByRole('button', { name: 'Start empty' });
    if (await chooser.isVisible()) {
      // Well past the settle time: the offer never comes over a dialog.
      await sleep(4_000);
      if ((await offer.count()) !== 0) fail(name, 'offered over the start chooser');
      await chooser.click();
    }
    await offer.waitFor({ timeout: 20_000 });
    await screenshot(page, 'update-offer');
    let loads = 0;
    page.on('request', (req) => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) loads += 1;
    });
    await offer.click();
    await page.waitForFunction(() => window.__pcReady === true, null, { timeout: READY_TIMEOUT_MS });
    // A second reload would land within this wait.
    await sleep(SETTLE_MS);
    trace(name, `${loads} document(s) after Reload`);
    if (loads !== 1) fail(name, `expected one reload after Reload (1 document), saw ${loads}`);
    // The page may be busy compiling shaders for a while: poll.
    const inCharge = await until(
      page,
      () =>
        navigator.serviceWorker
          .getRegistration()
          .then((registration) => !registration?.waiting && registration?.active?.state === 'activated' && navigator.serviceWorker.controller !== null),
      READY_TIMEOUT_MS,
    );
    if (!inCharge) fail(name, 'the newer worker is not in charge after Reload');
    // Only the newer build's cache is left: nothing stored vouches for an older build.
    const shells = await within(page.evaluate(() => caches.keys().then((names) => names.filter((n) => n.startsWith('pc-shell:')).length)), 10_000, 0);
    if (shells !== 1) fail(name, `expected the newer build's cache only, found ${shells}`);
    // Past the head watchdog's 20 s, and the reload it would start.
    await sleep(Math.max(0, 25_000 - (Date.now() - otherOpenedAt)));
    if (otherLoads !== 1) fail(name, `the other window was reloaded (${otherLoads} documents)`);
  } catch (err) {
    fail(name, err instanceof Error ? err.message.split('\n')[0] : String(err));
  } finally {
    workerUpdated = false;
    await screenshot(page, name);
    await within(browser.close(), 5_000, undefined);
    trace(name, 'closed');
  }
  return Date.now() - started;
}

/**
 * 5. Offline (#933): once the service worker has installed, a reload with the
 * network gone must still open the editor. Every request to the site then
 * fails, routed or not, so only the worker's precache can answer.
 */
async function checkOffline(context, page, check) {
  const name = `${check} offline`;
  // Registered after the first frame, then the whole precache downloads.
  const scope = await within(
    page.evaluate(() => navigator.serviceWorker.ready.then((registration) => registration.scope)),
    READY_TIMEOUT_MS,
    null,
  );
  if (!scope) return fail(name, 'no service worker became active');
  trace(name, 'worker active at', scope);
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await context.route(() => true, (route) => route.abort('internetdisconnected'));
  await context.setOffline(true);
  const before = served;
  await page.reload({ waitUntil: 'load' });
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  if (!controlled) fail(name, 'the reloaded page is not controlled by the worker');
  await page.waitForFunction(() => window.__pcReady === true, null, { timeout: READY_TIMEOUT_MS });
  trace(name, 'ready');
  // This build's page, not one from anywhere else, and nothing from the server.
  const marker = pageMarker(await readFile(path.join(outDir, 'index.html'), 'utf8'));
  const scripts = await page.evaluate(() => [...document.scripts].map((script) => script.src));
  if (!scripts.some((src) => src.endsWith(`/${marker}`))) fail(name, `the page offline is not this build's (no ${marker})`);
  if (served !== before) fail(name, `${served - before} request(s) reached the server while offline`);
  await screenshot(page, name.replace(' ', '-'));
}

async function checkNotFound(browser, origin, basePath) {
  const name = '404';
  const context = await newContext(browser, { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(RECORD_CSP_VIOLATIONS);
  const unknown = `${origin}${basePath}/no-such-page`;
  watch(page, name, { ignoreUrl: (url) => url === unknown });
  try {
    for (const [url, status] of [
      [`${origin}${basePath}/404.html`, 200],
      [unknown, 404],
    ]) {
      const res = await page.goto(url, { waitUntil: 'load' });
      if (res?.status() !== status) fail(name, `${url} answered ${res?.status()}, expected ${status}`);
      const heading = await page.getByRole('heading', { name: 'Nothing built here' }).count();
      if (heading !== 1) fail(name, `${url} lacks the branded heading`);
      const home = await page.getByRole('link', { name: 'Back to the builder' }).getAttribute('href');
      if (home !== `${basePath}/`) fail(name, `${url} links home to ${home}, expected ${basePath}/`);
      for (const violation of await page.evaluate(() => window.__smokeCsp)) fail(name, `CSP violation: ${violation}`);
    }
  } catch (err) {
    fail(name, err instanceof Error ? err.message.split('\n')[0] : String(err));
  } finally {
    await screenshot(page, name);
    await context.close();
  }
}

/** The editor's own chunks: app/page.tsx's editor import minus what the error screen needs. */
async function editorChunks() {
  const manifest = JSON.parse(await readFile(path.resolve('.next', 'react-loadable-manifest.json'), 'utf8'));
  const errorScreen = new Set(
    Object.entries(manifest)
      .filter(([key]) => /^app\/(global-)?error\.tsx -> /.test(key))
      .flatMap(([, entry]) => entry.files ?? []),
  );
  const editor = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key === 'app/page.tsx -> @/components/room-organizer'),
  );
  const files = pageChunks(editor).filter((file) => !errorScreen.has(file));
  if (files.length === 0) throw new Error('No editor chunk in the loadable manifest to block');
  return files;
}

async function checkChunkReload(browser, origin, basePath) {
  const name = 'chunk-404';
  const context = await newContext(browser, { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  // Documents, not load events: the head script can reload on the failed
  // preload before the first document has finished loading.
  let loads = 0;
  page.on('request', (req) => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) loads += 1;
  });
  try {
    const blocked = (await editorChunks()).map((file) => `${basePath}/_next/${file}`);
    await context.route(
      (url) => blocked.includes(url.pathname),
      (route) => route.fulfill({ status: 404, body: 'gone' }),
    );
    await page.goto(`${origin}${basePath}/`, { waitUntil: 'load' });
    // The first document can render the error screen just before the reload
    // it asked for replaces it, so wait for the reload first.
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (loads < 2 && Date.now() < deadline) await sleep(100);
    trace(name, `${loads} document(s)`);
    await page.getByText('Couldn’t load the app').waitFor({ timeout: READY_TIMEOUT_MS });
    // A second reload would land within this wait.
    await sleep(SETTLE_MS);
    if (loads !== 2) fail(name, `expected one automatic reload (2 documents), saw ${loads}`);
  } catch (err) {
    fail(name, `${err instanceof Error ? err.message.split('\n')[0] : String(err)} (after ${loads} document(s))`);
  } finally {
    await screenshot(page, name);
    await context.close();
  }
}

async function main() {
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
  const basePath = basePathOf(html);
  const server = await serve(basePath);
  const { port } = server.address();
  const local = `http://127.0.0.1:${port}`;
  const origin = await siteOrigin(basePath, local);
  site = { origin, local };
  trace('server', local, 'as', origin);
  const chromium = await loadChromium();
  const launch = () =>
    chromium.launch({
      ...(process.env.SMOKE_BROWSER_CHANNEL ? { channel: process.env.SMOKE_BROWSER_CHANNEL } : {}),
      // Software WebGL: CI runners have no GPU.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
  const browser = await launch();
  const version = browser.version();
  const started = Date.now();
  try {
    // One at a time: pages that share software WebGL stall each other. The
    // phone viewport (SMOKE_PHONE=1) costs as much as the desktop one, so CI
    // leaves it out.
    await checkNotFound(browser, origin, basePath);
    await checkChunkReload(browser, origin, basePath);
    await browser.close();
    const desktop = await checkEditor(launch, origin, basePath, 'desktop', { viewport: { width: 1280, height: 800 } }, { offline: true });
    const update = await checkUpdate(launch, basePath);
    const phone = process.env.SMOKE_PHONE
      ? await checkEditor(launch, origin, basePath, 'phone', {
          viewport: { width: 390, height: 664 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        })
      : null;
    process.stdout.write(
      `Smoke test of ${process.argv[2] ?? 'out'} at "${basePath || '/'}" with ${version}: ` +
        `desktop ${desktop} ms, update ${update} ms${phone === null ? '' : `, phone ${phone} ms`}, ${Date.now() - started} ms in all\n`,
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    server.close();
  }
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`::error title=Smoke test::${problem}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Smoke test passed\n');
  }
}

// A page stuck compiling shaders can stall Playwright's own timeouts; this
// one fails the run regardless.
const DEADLINE_MS = 240_000;
setTimeout(() => {
  process.stderr.write(`::error title=Smoke test::did not finish within ${DEADLINE_MS / 1000} s\n${problems.join('\n')}\n`);
  process.exit(1);
}, DEADLINE_MS).unref();

await main();
// Playwright kills any browser still running when the process exits.
process.exit();
