// Post-export step (#731): preload the editor and engine chunks from the HTML.
//
//   next build && node scripts/add-preloads.mjs [outDir] [distDir]
//
// app/page.tsx starts the editor and the 3D engine with import(), so the
// browser only learns their chunk URLs once React has hydrated, which on a
// slow link is seconds after the HTML arrived. Next's loadable manifest names
// the exact hashed files of every import() in app/page.tsx; this step writes
// one low-priority <link rel="preload" as="script"> per file into
// out/index.html, so the download starts with the HTML. The URL prefix (the
// Pages basePath or none) is read from the HTML Next wrote, so nothing is
// hard-coded. Runs before scripts/add-csp.mjs; a preload link is not a
// script, and 'self' covers what it fetches.
//
// Re-running is safe: links this step added before are replaced.
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Manifest keys of the imports app/page.tsx makes as it starts. */
export const PAGE_ENTRY_PREFIX = 'app/page.tsx -> ';

const MARK = 'data-chunk-preload';
const OUR_LINK_RE = new RegExp(`<link [^>]*${MARK}[^>]*>`, 'g');
// Next's own preload of its webpack runtime: its href carries the asset prefix.
const RUNTIME_PRELOAD_RE = /<link rel="preload" as="script"[^>]*? href="([^"]*?)\/_next\/static\/chunks\/webpack-[^"]+"\s*\/?>/;

/**
 * The JavaScript files the page's start-up imports need, from Next's
 * react-loadable-manifest, deduplicated in manifest order.
 */
export function pageChunks(manifest) {
  const files = [];
  for (const [key, entry] of Object.entries(manifest)) {
    if (!key.startsWith(PAGE_ENTRY_PREFIX)) continue;
    for (const file of entry.files ?? []) {
      if (file.endsWith('.js') && !files.includes(file)) files.push(file);
    }
  }
  return files;
}

/**
 * The page with a preload link per chunk it doesn't already load, right
 * after Next's runtime preload. Returns the new HTML and the hrefs added.
 */
export function addPreloads(html, files) {
  const page = html.replace(OUR_LINK_RE, '');
  const anchor = RUNTIME_PRELOAD_RE.exec(page);
  if (!anchor) throw new Error('No webpack runtime preload in the page to place the chunk preloads after');
  const prefix = anchor[1];
  const hrefs = files
    .map((file) => `${prefix}/_next/${file}`)
    .filter((href) => !page.includes(`"${href}"`));
  const links = hrefs.map((href) => `<link rel="preload" as="script" fetchPriority="low" href="${href}" ${MARK}=""/>`).join('');
  const at = anchor.index + anchor[0].length;
  return { html: page.slice(0, at) + links + page.slice(at), hrefs };
}

async function main() {
  const outDir = path.resolve(process.argv[2] ?? 'out');
  const distDir = path.resolve(process.argv[3] ?? '.next');
  const manifest = JSON.parse(await readFile(path.join(distDir, 'react-loadable-manifest.json'), 'utf8'));
  const files = pageChunks(manifest);
  if (files.length === 0) throw new Error(`No ${PAGE_ENTRY_PREFIX}… entries in the loadable manifest`);
  // A link to a file that isn't there would 404 on every visit.
  await Promise.all(files.map((file) => access(path.join(outDir, '_next', file))));
  const file = path.join(outDir, 'index.html');
  const { html, hrefs } = addPreloads(await readFile(file, 'utf8'), files);
  await writeFile(file, html);
  process.stdout.write(`Preloads: ${path.relative(process.cwd(), file)} (${hrefs.length} chunk${hrefs.length === 1 ? '' : 's'})\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
