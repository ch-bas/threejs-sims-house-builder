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
    // Installable as its own window (#616). Share links don't need the
    // address bar: Share copies the link to the clipboard. No service
    // worker yet, so the installed app still needs the network to open.
    display: 'standalone',
    background_color: '#4A8826',
    theme_color: '#1A2A33',
    icons: [
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: 'apple-icon.png', sizes: '180x180', type: 'image/png' },
      // Rasters from scripts/build-icons.mjs, in public/.
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
