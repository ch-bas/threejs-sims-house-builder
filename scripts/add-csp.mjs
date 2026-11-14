// Post-export step (#445): adds a Content-Security-Policy <meta> to every
// page of the static export in out/.
//
//   next build && node scripts/add-csp.mjs [outDir]
//   CSP_SITE_ORIGIN=https://example.org node scripts/add-csp.mjs
//
// A static export cannot use nonces, and GitHub Pages sends no headers, so
// the policy rides in a <meta http-equiv>. Next inlines a few scripts per
// page (the chunk-recovery script from app/layout.tsx and the RSC flight
// `self.__next_f.push(...)` payloads) whose content changes every build, so
// they are allowed by hash, computed here from the exported HTML. Every
// external script, chunk, stylesheet, font and the people GLB is
// same-origin, so 'self' covers them with or without the Pages basePath.
//
// Scripts are narrowed further on a basePath build (#579): GitHub Pages
// serves every project site of an account from one origin, so 'self' would
// also allow a script from a sibling site. CSP path matching can't be
// combined with 'self', so the source names the site's origin and the
// basePath's _next/ folder, where every chunk lives. The origin is
// CSP_SITE_ORIGIN when set, else the Actions repository owner's github.io,
// else the origin of package.json's homepage. A build without a basePath
// (local `npm run build`) keeps 'self'. A page that served this build from
// another origin would load no scripts: test a Pages build at its real URL.
//
// Re-running is safe: a policy the script added before is replaced.
//
// What a meta policy cannot do: `frame-ancestors`, `report-uri` and
// `sandbox` are ignored outside an HTTP header, so clickjacking is not
// mitigated on this host (see SECURITY.md).
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The policy for one page, given the hash sources of its inline scripts and
 * the source that allows its script files ('self' unless narrowed).
 */
export function policy(scriptHashes, scriptSource = "'self'") {
  return [
    "default-src 'self'",
    `script-src ${scriptSource} ${scriptHashes.join(' ')}`.trimEnd(),
    // React and the prerendered markup set style attributes, and Next
    // inlines font-face CSS; hashing those is not practical.
    "style-src 'self' 'unsafe-inline'",
    // data: for the blueprint popup's plan image and imported floor plans.
    // Downloads use blob: URLs, but as navigations, which no directive
    // governs.
    "img-src 'self' data:",
    "font-src 'self'",
    // The people GLB, fetched by GLTFLoader.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const CSP_META_RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\s*\/?>/gi;
const TAG_RE = /<[a-z][^>]*>/gi;
const HANDLER_RE = /\son[a-z]+\s*=/i;
const SRC_RE = /\ssrc\s*=\s*"([^"]*)"/i;

/**
 * The source expression for a page's script files: its basePath's _next/
 * folder on `siteOrigin`, or 'self' when there is no basePath or no origin.
 * Throws when a script file lies outside the one _next/ folder, since the
 * narrowed policy would block it.
 */
export function scriptSource(page, siteOrigin, file = 'page') {
  const prefixes = new Set();
  for (const [, attrs] of page.matchAll(SCRIPT_RE)) {
    const src = SRC_RE.exec(attrs ?? '')?.[1];
    if (src === undefined) continue;
    const match = /^(\/[^:?#]*?)?\/_next\//.exec(src);
    if (!match) throw new Error(`${file}: script outside _next/ would be blocked by the CSP: ${src}`);
    prefixes.add(match[1] ?? '');
  }
  if (prefixes.size > 1) throw new Error(`${file}: scripts under more than one basePath: ${[...prefixes].join(', ')}`);
  const [prefix = ''] = prefixes;
  if (!prefix || !siteOrigin) return "'self'";
  return `${new URL(siteOrigin).origin}${prefix}/_next/`;
}

/** Where a basePath build is served from (see the header). */
export function siteOrigin(env, homepage) {
  if (env.CSP_SITE_ORIGIN) return new URL(env.CSP_SITE_ORIGIN).origin;
  if (env.GITHUB_REPOSITORY_OWNER) return `https://${env.GITHUB_REPOSITORY_OWNER.toLowerCase()}.github.io`;
  return homepage ? new URL(homepage).origin : null;
}

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function sha256Source(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/**
 * Adds the policy meta to one exported page, replacing one added before.
 * Throws when the page has an inline event handler, no <head>, a script
 * ahead of the charset, or a script file the policy would block. Returns
 * the new HTML, the number of hashes and the script-file source.
 */
export function addPolicy(html, file, origin = null) {
  const page = html.replace(CSP_META_RE, '');
  const source = scriptSource(page, origin, file);
  const hashes = [];
  for (const [, attrs, body] of page.matchAll(SCRIPT_RE)) {
    if (/\ssrc\s*=/i.test(attrs ?? '')) continue;
    if (/\stype\s*=\s*"application\/(ld\+)?json"/i.test(attrs ?? '')) continue;
    const hash = sha256Source(body ?? '');
    if (!hashes.includes(hash)) hashes.push(hash);
  }

  // A hash cannot allow an inline event handler; fail the build rather than
  // ship a page whose handler silently stops working.
  const markup = page.replace(SCRIPT_RE, '<script></script>');
  const handler = (markup.match(TAG_RE) ?? []).find((tag) => HANDLER_RE.test(tag));
  if (handler) throw new Error(`${file}: inline event handler blocked by the CSP: ${handler.slice(0, 120)}`);

  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy(hashes, source)}"/>`;
  // Right after the charset (which must stay in the first 1024 bytes) and
  // ahead of every script: a meta policy only governs what follows it.
  const charset = /<meta charset="[^"]*"\s*\/?>/i.exec(page);
  const head = /<head[^>]*>/i.exec(page);
  const anchor = charset ?? head;
  if (!anchor) throw new Error(`${file}: no <head> to put the policy in`);
  const at = anchor.index + anchor[0].length;
  const firstScript = page.search(/<script\b/i);
  if (firstScript !== -1 && firstScript < at) throw new Error(`${file}: a script precedes the policy anchor`);
  return { html: page.slice(0, at) + meta + page.slice(at), hashes: hashes.length, source };
}

async function main() {
  const outDir = path.resolve(process.argv[2] ?? 'out');
  const files = await htmlFiles(outDir);
  if (files.length === 0) throw new Error(`No HTML files under ${outDir}; run next build first.`);
  const { homepage } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const origin = siteOrigin(process.env, homepage);
  for (const file of files) {
    const { html, hashes, source } = addPolicy(await readFile(file, 'utf8'), path.relative(outDir, file), origin);
    await writeFile(file, html);
    process.stdout.write(
      `CSP: ${path.relative(process.cwd(), file)} (scripts from ${source}, ${hashes} inline script hash${hashes === 1 ? '' : 'es'})\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
