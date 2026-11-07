import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// What a module pulls in through static imports decides which chunk it
// lands in. These checks walk the static import graph (type-only imports
// and `import()` don't count) so code meant to load on demand doesn't
// creep back into the chunks every visit fetches.

const REPO = fileURLToPath(new URL('../', import.meta.url));
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(REPO, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null; // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every repo file reachable from `entry` through static, value imports. */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [join(REPO, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const target = spec ? resolveImport(file, spec) : null;
      if (target) queue.push(target);
    }
  }
  return new Set([...seen].map((file) => relative(REPO, file)));
}

describe('first-load JS (#584)', () => {
  it.each(['app/error.tsx', 'app/global-error.tsx', 'app/layout.tsx', 'app/page.tsx'])(
    '%s keeps the schema and the catalogue out of the pre-hydration chunks',
    (entry) => {
      const graph = staticGraph(entry);
      for (const heavy of [
        'components/room-organizer/lib/schema.ts',
        'components/room-organizer/lib/constants.ts',
        'components/room-organizer/lib/persistence.ts',
        'components/room-organizer/lib/restore-point.ts',
      ]) {
        expect(graph.has(heavy), `${entry} reaches ${heavy}`).toBe(false);
      }
    }
  );
});

describe('the editor chunk (#589)', () => {
  it('loads the print, blueprint, SVG and DXF exporters only when used', () => {
    const graph = staticGraph('components/room-organizer/index.ts');
    expect(graph.has('components/room-organizer/room-organizer.tsx')).toBe(true);
    for (const exporter of [
      'components/room-organizer/lib/plan-export/svg.ts',
      'components/room-organizer/lib/plan-export/dxf.ts',
      'components/room-organizer/lib/plan-export/print.ts',
      'components/room-organizer/lib/blueprint.ts',
    ]) {
      expect(graph.has(exporter), `the editor reaches ${exporter}`).toBe(false);
    }
  });
});
