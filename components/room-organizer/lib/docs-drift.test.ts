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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith('__') ? [] : sourceFiles(path);
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return /\.(tsx?|css|glb)$/.test(entry.name) ? [path] : [];
  });
}

describe('docs drift', () => {
  it('states the catalogue size the code has', () => {
    expect(readme).toContain(`**${FURNITURE_CATALOG.length} furniture items** in ${CATEGORIES.length} categories`);
    expect(architecture).toContain(`Catalog (${FURNITURE_CATALOG.length} items in ${CATEGORIES.length} categories)`);
  });

  it('lists every module in docs/architecture.md', () => {
    const missing = sourceFiles(MODULE_ROOT)
      .map((path) => relative(MODULE_ROOT, path))
      .filter((path) => {
        const name = (path.split(/[\\/]/).pop() ?? path).replace(/[.]/g, '[.]');
        // Named as a tree entry: after a space, a slash or a comma, then a
        // space, a comma or the line's end.
        return !new RegExp(`[ /,]${name}(?:[ ,]|$)`, 'm').test(architecture);
      });
    expect(missing).toEqual([]);
  });
});
