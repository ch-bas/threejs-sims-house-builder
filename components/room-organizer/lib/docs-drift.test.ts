import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, FURNITURE_CATALOG } from './constants';

// The README and docs/architecture.md drifted from the code (#457): a stale
// item count, modules missing from the layout. These checks keep them honest.

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MODULE_ROOT = join(REPO, 'components', 'room-organizer');
const readme = readFileSync(join(REPO, 'README.md'), 'utf8');
const architecture = readFileSync(join(REPO, 'docs', 'architecture.md'), 'utf8');

/** Source files under `dir`, tests and `__fixtures__`-style folders left out. */
function sourceFiles(dir: string, pattern = /\.(tsx?|css|glb)$/): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith('__') ? [] : sourceFiles(path, pattern);
    if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return pattern.test(entry.name) ? [path] : [];
  });
}

/** The files `architecture.md` doesn't name as a tree entry. */
function unlisted(paths: readonly string[]): string[] {
  return paths
    .map((path) => relative(REPO, path))
    .filter((path) => {
      const name = (path.split(/[\\/]/).pop() ?? path).replace(/[.]/g, '[.]');
      // Named as a tree entry: after a space, a slash or a comma, then a
      // space, a comma or the line's end.
      return !new RegExp(`[ /,]${name}(?:[ ,]|$)`, 'm').test(architecture);
    });
}

describe('docs drift', () => {
  it('states the catalogue size the code has', () => {
    expect(readme).toContain(`**${FURNITURE_CATALOG.length} furniture items** in ${CATEGORIES.length} categories`);
    expect(architecture).toContain(`Catalog (${FURNITURE_CATALOG.length} items in ${CATEGORIES.length} categories)`);
  });

  it('lists every module in docs/architecture.md', () => {
    expect(unlisted(sourceFiles(MODULE_ROOT))).toEqual([]);
  });

  // #604: the app shell, the build scripts (add-csp.mjs once went unlisted)
  // and the root config files.
  it('lists the app shell, the scripts and the root config files', () => {
    const root = readdirSync(REPO)
      .filter((name) => /\.config\.[cm]?[jt]s$/.test(name))
      .map((name) => join(REPO, name));
    expect(root.length).toBeGreaterThan(0);
    expect(unlisted(sourceFiles(join(REPO, 'app'), /\.(tsx?|css|[cm]?js)$/))).toEqual([]);
    expect(unlisted(sourceFiles(join(REPO, 'scripts'), /\.[cm]?[jt]s$/))).toEqual([]);
    expect(unlisted(root)).toEqual([]);
  });
});
