import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { NEXT_POLYFILLS, noticesText, shippedPackages, writeNotices } from '../scripts/third-party-notices.mjs';

// The post-build step that writes out/third-party-licenses.txt (#569).

const lock = {
  packages: {
    '': { version: '1.0.0' },
    'node_modules/three': { version: '0.186.1', license: 'MIT' },
    'node_modules/react': { version: '18.3.1', license: 'MIT' },
    'node_modules/vitest': { version: '4.1.12', license: 'MIT', dev: true },
    'node_modules/@types/react': { version: '18.3.30', license: 'MIT', devOptional: true },
    'node_modules/sharp': { version: '0.35.5', license: 'Apache-2.0', optional: true },
    'node_modules/tailwindcss': { version: '3.4.19', license: 'MIT', dev: true },
    'node_modules/vitest/node_modules/tailwindcss': { version: '2.0.0', license: 'MIT', dev: true },
    'node_modules/next/node_modules/postcss': { version: '8.4.31', license: 'MIT' },
    'node_modules/postcss': { version: '8.5.26', license: 'MIT' },
  },
};

describe('shippedPackages', () => {
  it('keeps the production tree and the dev tools whose output ships, sorted', () => {
    expect(shippedPackages(lock).map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual([
      'postcss@8.4.31',
      'postcss@8.5.26',
      'react@18.3.1',
      'tailwindcss@3.4.19',
      'three@0.186.1',
    ]);
  });

  it('reads nested packages from their own folder', () => {
    expect(shippedPackages(lock).find((pkg) => pkg.version === '8.4.31')?.dir).toBe('node_modules/next/node_modules/postcss');
  });
});

describe('noticesText', () => {
  it('lists every package and asset, then each licence text', () => {
    const text = noticesText(
      [
        { name: 'three', version: '0.186.1', license: 'MIT', text: 'Copyright three.js authors' },
        { name: 'client-only', version: '0.0.1', license: 'MIT', text: null, source: '' },
      ],
      [{ name: 'core-js (in next polyfills)', version: '3.38.1', license: 'MIT', text: 'Denis Pushkarev' }],
      [{ name: 'Sora typeface', license: 'OFL-1.1', text: 'SIL Open Font License' }],
    );
    expect(text).toContain('  three 0.186.1 (MIT)');
    expect(text).toContain('  Sora typeface (OFL-1.1)');
    expect(text).toContain('Bundled into the browser by Next.js:\n  core-js (in next polyfills) 3.38.1 (MIT)');
    expect(text).toContain('Denis Pushkarev');
    expect(text).toContain('Copyright three.js authors');
    expect(text).toContain('SIL Open Font License');
    expect(text).toContain('(No licence file in the package; its package.json declares MIT.)');
    expect(text.endsWith('\n')).toBe(true);
  });
});

// The step runs from the project root, wherever it is checked out: paths
// with spaces or non-ASCII characters must work (a file URL keeps them
// percent-encoded).
describe('writeNotices', () => {
  const made: string[] = [];
  const tempDir = async (name: string) => {
    const dir = await mkdtemp(path.join(tmpdir(), name));
    made.push(dir);
    return dir;
  };
  afterEach(async () => {
    await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const put = async (root: string, file: string, text: string) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  };

  /** A minimal project: one package, Next's compiled builds and polyfills, the fonts. */
  async function project(name: string, withPackage = true): Promise<string> {
    const root = await tempDir(name);
    const coreJs = NEXT_POLYFILLS.find((lib) => lib.name === 'core-js')?.version ?? '';
    await put(root, 'package-lock.json', JSON.stringify({ packages: { '': {}, 'node_modules/tiny-lib': { version: '1.2.3', license: 'MIT' } } }));
    if (withPackage) await put(root, 'node_modules/tiny-lib/LICENSE', 'Copyright tiny-lib authors');
    await put(root, 'node_modules/next/package.json', JSON.stringify({ version: '15.0.0' }));
    await put(root, 'node_modules/next/dist/compiled/react/cjs/react.production.js', 'exports.version = "19.0.0-test";');
    for (const lib of ['react', 'react-dom', 'scheduler', 'react-server-dom-webpack']) {
      await put(root, `node_modules/next/dist/compiled/${lib}/LICENSE`, `Copyright Meta (${lib})`);
    }
    await put(root, 'node_modules/next/dist/build/polyfills/polyfill-nomodule.js', `!function(){var s={version:"${coreJs}"}}();`);
    await put(root, 'app/fonts/Sora-OFL.txt', 'Sora OFL');
    await put(root, 'app/fonts/Nunito-OFL.txt', 'Nunito OFL');
    return root;
  }

  it('writes the notices from a project and into an out dir whose paths hold a space and non-ASCII characters', async () => {
    const root = await project('h3 notices é ');
    const out = await tempDir('out dir ');
    const result = await writeNotices(root, out);
    expect(result).toEqual({ file: path.join(out, 'third-party-licenses.txt'), packages: 1, bundled: 7, missing: [] });
    const text = await readFile(result.file, 'utf8');
    expect(text).toContain('  tiny-lib 1.2.3 (MIT)');
    expect(text).toContain('  react (next 15.0.0\'s build) 19.0.0-test (MIT)');
    expect(text).toContain('  scheduler (next 15.0.0\'s build) from React 19.0.0-test (MIT)');
    expect(text).toContain('Copyright Meta (react-server-dom-webpack)');
    expect(text).toContain('Denis Pushkarev');
    expect(text).toContain('Sora OFL');
  });

  it('names a package that is in the lockfile but missing from node_modules', async () => {
    const root = await project('h3 missing ', false);
    await expect(writeNotices(root, await tempDir('out '))).rejects.toThrow(
      'tiny-lib@1.2.3 is in package-lock.json but missing from node_modules/tiny-lib; run npm ci',
    );
  });

  it('fails when Next ships another core-js than the licence texts were taken for', async () => {
    const root = await project('h3 core-js ');
    await put(root, 'node_modules/next/dist/build/polyfills/polyfill-nomodule.js', '{version:"9.9.9"}');
    await expect(writeNotices(root, await tempDir('out '))).rejects.toThrow(/core-js 9\.9\.9, not /);
  });

  it('matches what the installed Next ships', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = await writeNotices(root, await tempDir('real out '));
    expect(result.bundled).toBe(7);
    expect(await readFile(result.file, 'utf8')).toContain('three.js authors');
  });
});
