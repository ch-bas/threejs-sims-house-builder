import { describe, expect, it } from 'vitest';
import { addPreloads, pageChunks } from '../scripts/add-preloads.mjs';

// The post-build step that preloads the editor and engine chunks (#731).

const manifest = {
  'app/error.tsx -> ../components/room-organizer/lib/persistence': { id: 1, files: ['static/chunks/89.a.js', 'static/chunks/871.b.js'] },
  'app/page.tsx -> @/components/room-organizer': {
    id: 2,
    files: ['static/chunks/319.c.js', 'static/chunks/89.a.js', 'static/chunks/162.d.js'],
  },
  'app/page.tsx -> @/components/room-organizer/three/three-runtime': {
    id: 3,
    files: ['static/chunks/bd904a5c.e.js', 'static/chunks/b536a0f1.f.js', 'static/css/x.css'],
  },
  'app/page.tsx -> three/examples/jsm/controls/OrbitControls.js': { id: 4, files: ['static/chunks/bd904a5c.e.js', 'static/chunks/833.g.js'] },
  'components/room-organizer/panels/actions-panel.tsx -> ../lib/plan-export/svg': { id: 5, files: ['static/chunks/121.h.js'] },
  'components/room-organizer/lib/file-io.ts -> ../three/builder-utils': { id: 6, files: [] },
};

function page(prefix: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charSet="utf-8"/>` +
    `<link rel="preload" as="script" fetchPriority="low" href="${prefix}/_next/static/chunks/webpack-1.js"/>` +
    `<script src="${prefix}/_next/static/chunks/319.c.js" async=""></script>` +
    `</head><body></body></html>`
  );
}

describe('pageChunks', () => {
  it('takes the JS of app/page.tsx imports only, once each, in manifest order', () => {
    expect(pageChunks(manifest)).toEqual([
      'static/chunks/319.c.js',
      'static/chunks/89.a.js',
      'static/chunks/162.d.js',
      'static/chunks/bd904a5c.e.js',
      'static/chunks/b536a0f1.f.js',
      'static/chunks/833.g.js',
    ]);
  });
});

describe('addPreloads', () => {
  it.each(['', '/threejs-sims-house-builder'])('links each chunk under the asset prefix "%s"', (prefix) => {
    const { html, hrefs } = addPreloads(page(prefix), pageChunks(manifest));
    // 319 is already a script of the page: no second request for it.
    expect(hrefs).toEqual(
      ['89.a', '162.d', 'bd904a5c.e', 'b536a0f1.f', '833.g'].map((name) => `${prefix}/_next/static/chunks/${name}.js`)
    );
    for (const href of hrefs) {
      expect(html).toContain(`<link rel="preload" as="script" fetchPriority="low" href="${href}" data-chunk-preload=""/>`);
    }
    // Right after the runtime preload, ahead of the page's scripts.
    expect(html.indexOf('data-chunk-preload')).toBeGreaterThan(html.indexOf('webpack-1.js'));
    expect(html.indexOf('data-chunk-preload')).toBeLessThan(html.indexOf('<script'));
  });

  it('replaces its own links when run again', () => {
    const once = addPreloads(page(''), pageChunks(manifest)).html;
    expect(addPreloads(once, pageChunks(manifest)).html).toBe(once);
  });

  it('refuses a page without the runtime preload to anchor on', () => {
    expect(() => addPreloads('<html><head></head></html>', ['static/chunks/1.js'])).toThrow(/runtime preload/);
  });
});
