// Post-export step (#445): adds a Content-Security-Policy <meta> to every
// page of the static export in out/.
//
//   next build && node scripts/add-csp.mjs [outDir]
//
// A static export cannot use nonces, and GitHub Pages sends no headers, so
// the policy rides in a <meta http-equiv>. Next inlines a few scripts per
// page (the chunk-recovery script from app/layout.tsx and the RSC flight
// `self.__next_f.push(...)` payloads) whose content changes every build, so
// they are allowed by hash, computed here from the exported HTML. Every
// external script, chunk, stylesheet, font and the people GLB is
// same-origin, so 'self' covers them with or without the Pages basePath.
//
// Re-running is safe: a policy the script added before is replaced.
//
// What a meta policy cannot do: `frame-ancestors`, `report-uri` and
// `sandbox` are ignored outside an HTTP header, so clickjacking is not
// mitigated on this host (see SECURITY.md).
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] ?? 'out');

/** The policy for one page, given the hash sources of its inline scripts. */
function policy(scriptHashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trimEnd(),
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

function addPolicy(html, file) {
  const page = html.replace(CSP_META_RE, '');
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

  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy(hashes)}"/>`;
  // Right after the charset (which must stay in the first 1024 bytes) and
  // ahead of every script: a meta policy only governs what follows it.
  const charset = /<meta charset="[^"]*"\s*\/?>/i.exec(page);
  const head = /<head[^>]*>/i.exec(page);
  const anchor = charset ?? head;
  if (!anchor) throw new Error(`${file}: no <head> to put the policy in`);
  const at = anchor.index + anchor[0].length;
  const firstScript = page.search(/<script\b/i);
  if (firstScript !== -1 && firstScript < at) throw new Error(`${file}: a script precedes the policy anchor`);
  return { html: page.slice(0, at) + meta + page.slice(at), hashes: hashes.length };
}

const files = await htmlFiles(outDir);
if (files.length === 0) throw new Error(`No HTML files under ${outDir}; run next build first.`);
for (const file of files) {
  const { html, hashes } = addPolicy(await readFile(file, 'utf8'), path.relative(outDir, file));
  await writeFile(file, html);
  process.stdout.write(`CSP: ${path.relative(process.cwd(), file)} (${hashes} inline script hash${hashes === 1 ? '' : 'es'})\n`);
}
