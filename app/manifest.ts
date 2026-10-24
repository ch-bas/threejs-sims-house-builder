import type { MetadataRoute } from 'next';

// Written once at build time under `output: 'export'`. The URLs are relative,
// so they resolve against the manifest's own URL: under the GitHub Pages
// basePath as well as on the dev server.
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Three.js Sims-like House Builder',
    short_name: 'House Builder',
    description: 'Build, furnish and walk through a house in your browser.',
    start_url: '.',
    scope: '.',
    // A browser tab, as today: the address bar carries the share links.
    display: 'browser',
    background_color: '#4A8826',
    theme_color: '#1A2A33',
    icons: [
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: 'apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
