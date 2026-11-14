// Post-export step (#569, #622): writes out/third-party-licenses.txt, the
// licence notices of everything the deployed site ships.
//
//   next build && node scripts/third-party-notices.mjs [outDir]
//
// The minifier strips every licence comment from the chunks, so the notices
// travel beside them instead. Three parts:
// - Packages: the production dependency tree from package-lock.json (not
//   dev, not optional: the optional ones are native build-time binaries such
//   as sharp and @next/swc, which never reach the browser), plus the dev
//   tools whose generated code does (Tailwind's base CSS). Each carries its
//   own LICENSE file from node_modules.
// - What Next bundles into the browser from its own copies: the React,
//   react-dom, scheduler and React Server Components client builds under
//   next/dist/compiled (the app router runs these, not the react package),
//   and the libraries inside its nomodule polyfills chunk (core-js,
//   whatwg-fetch, object-assign), whose licences aren't in node_modules
//   and are kept in scripts/licenses/. The step fails when Next's core-js
//   version moves away from the one those texts were taken for.
// - Assets: the vendored fonts and the people model.
// Built from the lockfile and node_modules rather than `npm ls`, so the file
// is the same on every platform and needs no network.
//
// Re-running is safe: the file is rewritten.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** React builds Next vendors and bundles into the browser chunks. */
export const NEXT_COMPILED_PACKAGES = ['react', 'react-dom', 'scheduler', 'react-server-dom-webpack'];

/**
 * The libraries in Next's nomodule polyfills chunk
 * (next/dist/build/polyfills/polyfill-nomodule.js, from
 * @next/polyfill-nomodule), with the versions their texts in
 * scripts/licenses/ were taken for.
 */
export const NEXT_POLYFILLS = [
  { name: 'core-js', version: '3.38.1', license: 'MIT', file: 'core-js.txt' },
  { name: 'whatwg-fetch', version: '3.0.0', license: 'MIT', file: 'whatwg-fetch.txt' },
  { name: 'object-assign', version: '4.1.1', license: 'MIT', file: 'object-assign.txt' },
];

/** Dev dependencies whose output ships in the bundle. */
export const SHIPPED_DEV_PACKAGES = ['tailwindcss', 'tailwindcss-animate'];

const LICENSE_FILE_RE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

/** The lockfile paths of the packages the site ships, sorted by name. */
export function shippedPackages(lock) {
  const packages = lock.packages ?? {};
  const picked = new Map();
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.startsWith('node_modules/')) continue;
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    // devOptional: needed only by dev tools or by an optional package.
    const production = !entry.dev && !entry.devOptional && !entry.optional;
    const shippedDev = key === `node_modules/${name}` && SHIPPED_DEV_PACKAGES.includes(name);
    if (!production && !shippedDev) continue;
    const id = `${name}@${entry.version}`;
    if (!picked.has(id)) picked.set(id, { name, version: entry.version, license: entry.license ?? 'UNKNOWN', dir: key });
  }
  return [...picked.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
}

/** The package's licence file(s), or null with the authorship it declares. */
async function licenseText(root, dir, id) {
  const full = path.join(root, dir);
  const entries = await readdir(full).catch((error) => {
    if (error?.code === 'ENOENT') throw new Error(`${id} is in package-lock.json but missing from ${dir}; run npm ci`);
    throw error;
  });
  const files = entries.filter((file) => LICENSE_FILE_RE.test(file)).sort();
  if (files.length > 0) {
    const texts = await Promise.all(files.map((file) => readFile(path.join(full, file), 'utf8')));
    return { text: texts.map((text) => text.trim()).join('\n\n'), source: null };
  }
  const manifest = JSON.parse(await readFile(path.join(full, 'package.json'), 'utf8'));
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  return { text: null, source: [author && `author: ${author}`, repository && `repository: ${repository}`].filter(Boolean).join(', ') };
}

const RULE = '-'.repeat(78);

/**
 * The notices file, from the packages, what Next bundles (both with their
 * texts) and the assets.
 */
export function noticesText(packages, bundled, assets) {
  const lines = [
    'Third-party software and assets in this site',
    '',
    'This site is built from the production dependency tree below, plus the',
    'packages Next.js bundles into the browser from its own copies, and it',
    'ships the assets listed last. Each entry gives its licence, followed by',
    'the licence text as the project ships it.',
    '',
    'Packages:',
    ...packages.map((pkg) => `  ${pkg.name} ${pkg.version} (${pkg.license})`),
    '',
    'Bundled into the browser by Next.js:',
    ...bundled.map((pkg) => `  ${pkg.name} ${pkg.version} (${pkg.license})`),
    '',
    'Assets:',
    ...assets.map((asset) => `  ${asset.name} (${asset.license})`),
    '',
  ];
  for (const pkg of [...packages, ...bundled]) {
    lines.push(RULE, `${pkg.name} ${pkg.version}`, `License: ${pkg.license}`, '');
    const declared = `(No licence file in the package; its package.json declares ${pkg.license}${pkg.source ? `, ${pkg.source}` : ''}.)`;
    lines.push(pkg.text ?? declared, '');
  }
  for (const asset of assets) {
    lines.push(RULE, asset.name, `License: ${asset.license}`, '', asset.text, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** The fonts in app/fonts and the people model, with their notices. */
async function assetNotices(root) {
  const fonts = path.join(root, 'app/fonts');
  return [
    { name: 'Sora typeface (app/fonts)', license: 'OFL-1.1', text: (await readFile(path.join(fonts, 'Sora-OFL.txt'), 'utf8')).trim() },
    { name: 'Nunito typeface (app/fonts)', license: 'OFL-1.1', text: (await readFile(path.join(fonts, 'Nunito-OFL.txt'), 'utf8')).trim() },
    {
      name: 'people.glb: mannequin and animations from the Universal Animation Library by Quaternius',
      license: 'CC0-1.0',
      text: 'Released into the public domain under CC0 1.0 Universal; no attribution is required.\nhttps://quaternius.itch.io/universal-animation-library\nhttps://creativecommons.org/publicdomain/zero/1.0/',
    },
  ];
}

/** Next's own React builds and its polyfills' libraries, with their texts. */
async function nextBundled(root) {
  const next = path.join(root, 'node_modules/next');
  const { version: nextVersion } = JSON.parse(await readFile(path.join(next, 'package.json'), 'utf8'));
  const reactBuild = await readFile(path.join(next, 'dist/compiled/react/cjs/react.production.js'), 'utf8');
  const reactVersion = /exports\.version = "([^"]+)"/.exec(reactBuild)?.[1];
  if (!reactVersion) throw new Error(`No React version in next ${nextVersion}'s compiled react`);
  const compiled = await Promise.all(
    NEXT_COMPILED_PACKAGES.map(async (name) => ({
      name: `${name} (next ${nextVersion}'s build)`,
      // scheduler and the RSC client are versioned with the React release.
      version: name === 'react' || name === 'react-dom' ? reactVersion : `from React ${reactVersion}`,
      license: 'MIT',
      ...(await licenseText(root, `node_modules/next/dist/compiled/${name}`, `next/dist/compiled/${name}`)),
    })),
  );

  const polyfills = await readFile(path.join(next, 'dist/build/polyfills/polyfill-nomodule.js'), 'utf8');
  const coreJs = /version:"(\d+\.\d+\.\d+)"/.exec(polyfills)?.[1];
  const expected = NEXT_POLYFILLS.find((lib) => lib.name === 'core-js')?.version;
  if (coreJs !== expected) {
    throw new Error(
      `next ${nextVersion}'s polyfills carry core-js ${coreJs ?? '(unknown)'}, not ${expected}: ` +
        'check @next/polyfill-nomodule and update NEXT_POLYFILLS and scripts/licenses/',
    );
  }
  const libraries = await Promise.all(
    NEXT_POLYFILLS.map(async (lib) => ({
      name: `${lib.name} (in next ${nextVersion}'s polyfills)`,
      version: lib.version,
      license: lib.license,
      text: (await readFile(path.join(SCRIPTS_DIR, 'licenses', lib.file), 'utf8')).trim(),
      source: null,
    })),
  );
  return [...compiled, ...libraries];
}

/**
 * Writes <outDir>/third-party-licenses.txt for the project at `root`.
 * Throws when a package in the lockfile is missing from node_modules.
 */
export async function writeNotices(root, outDir) {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const packages = await Promise.all(
    shippedPackages(lock).map(async (pkg) => ({ ...pkg, ...(await licenseText(root, pkg.dir, `${pkg.name}@${pkg.version}`)) })),
  );
  const bundled = await nextBundled(root);
  const file = path.join(outDir, 'third-party-licenses.txt');
  await writeFile(file, noticesText(packages, bundled, await assetNotices(root)));
  const missing = [...packages, ...bundled].filter((pkg) => pkg.text === null).map((pkg) => pkg.name);
  return { file, packages: packages.length, bundled: bundled.length, missing };
}

async function main() {
  const root = path.resolve(SCRIPTS_DIR, '..');
  const { file, packages, bundled, missing } = await writeNotices(root, path.resolve(process.argv[2] ?? 'out'));
  process.stdout.write(
    `Notices: ${path.relative(process.cwd(), file)} (${packages} packages, ${bundled} bundled by Next, 3 assets` +
      `${missing.length ? `; no licence file in ${missing.join(', ')}` : ''})\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
