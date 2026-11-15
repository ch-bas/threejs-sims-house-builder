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
    // address bar: Share copies the link to the clipboard. The service
    // worker (scripts/build-sw.mjs, #933) lets the installed app open
    // offline once it has been opened online.
    display: 'standalone',
    // The installed app opens the house files it writes (#934, Chromium
    // desktop): the launch queue hands them to the editor, which opens them
    // as a dropped file. An open window takes the file instead of a new one.
    file_handlers: [{ action: '.', accept: { 'application/json': ['.json'] } }],
    launch_handler: { client_mode: ['focus-existing', 'auto'] },
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
