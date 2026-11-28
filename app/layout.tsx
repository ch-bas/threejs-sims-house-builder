import { CHUNK_RECOVERY_SCRIPT } from './chunk-recovery';
import { fontVariables } from './fonts/fonts';
import type { Metadata, Viewport } from 'next';
import './globals.css';

const SITE_NAME = 'Three.js Sims-like House Builder';
const DESCRIPTION =
  'Build a house in your browser: walls, floors, stairs and a roof, furniture from a catalogue, a first-person walkthrough, and plans to print or export.';

// Absolute URLs in the link preview resolve against the live site. Next adds
// the GitHub Pages basePath to the icon and preview-image paths itself, from
// the app/icon.svg, favicon.ico, apple-icon.png and opengraph-image.png files
// (regenerate the rasters with scripts/build-icons.mjs).
export const metadata: Metadata = {
  metadataBase: new URL('https://ch-bas.github.io'),
  title: SITE_NAME,
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: DESCRIPTION,
    url: '/threejs-sims-house-builder/',
  },
  twitter: { card: 'summary_large_image', title: SITE_NAME, description: DESCRIPTION },
};

// No maximumScale / userScalable: page zoom must stay available for the
// panels (WCAG 1.4.4). Both canvases set `touch-action: none`, so a pinch
// on them still drives the camera, not the page (#167).
// viewportFit 'cover' lets the page reach under a notch, so the phone HUD's
// env(safe-area-inset-*) padding is what keeps it clear.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The HUD's ink (--pc-ink), for the mobile browser bar.
  themeColor: '#1A2A33',
};

// With scripts off (an extension, a policy that blocks them on github.io),
// the exported page is only the editor's "Loading the lot…" fallback, which
// never resolves (#612). This covers it with the reason and a way to read
// about the project; link-preview crawlers that don't run scripts read it
// too. Static markup, so the CSP has nothing to allow.
const README_URL = 'https://github.com/ch-bas/threejs-sims-house-builder#readme';

function NoScriptNotice(): JSX.Element {
  return (
    <noscript>
      <div
        className="pc-world"
        style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 24 }}
      >
        <div
          className="pc-glass pc-glass--dark"
          style={{ padding: '28px 32px', textAlign: 'center', maxWidth: 440 }}
        >
          <h1
            style={{
              margin: '0 0 8px',
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              color: 'var(--pc-paper)',
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
              fontSize: 16,
            }}
          >
            JavaScript is off
          </h1>
          <p
            style={{
              margin: '0 0 16px',
              fontFamily: 'var(--pc-font-body)',
              color: 'var(--pc-paper-soft)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            This house builder runs in your browser and needs JavaScript. Allow scripts for this site and reload the
            page.
          </p>
          <a
            href={README_URL}
            style={{
              display: 'inline-block',
              borderRadius: 8,
              padding: '10px 18px',
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
              fontSize: 12,
              textDecoration: 'none',
              background: 'var(--pc-cyan-glow, #22d3ee)',
              color: '#0f172a',
            }}
          >
            About the project
          </a>
        </div>
      </div>
    </noscript>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY_SCRIPT }} />
      </head>
      <body>
        <NoScriptNotice />
        {children}
      </body>
    </html>
  );
}
