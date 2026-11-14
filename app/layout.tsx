import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS } from '@/components/room-organizer/lib/chunk-reload';
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

// Stale-chunk recovery for the GitHub Pages static export. index.html is cached
// for ~10 min, so a returning visitor within that window loads cached HTML whose
// hashed `_next/static/chunks/*.js` URLs were replaced by the new deploy and now
// 404 — breaking the app before any React code runs. Two guarded recovery paths,
// inline in <head> so they run before the app chunks:
//   1. A capture-phase resource-error / unhandledrejection listener (fast path).
//   2. A watchdog: if the editor hasn't signalled ready within 20 s (the stuck
//      "Loading the lot…" state), reload once. This catches failures the error
//      events miss. `window.__pcReady` is set once the 3D engine has loaded
//      (markAppReady, from use-three-scene). While webpack still has a chunk
//      <script> in flight (it tags them `data-webpack` and removes them on
//      load or error) the download is progressing, so the watchdog waits
//      instead of restarting a nearly finished download on a slow link
//      (#413), up to 60 s after
//      which it reloads anyway, so a hung chunk doesn't sit out webpack's own
//      120 s timeout. The sessionStorage guard, shared with lib/chunk-reload,
//      allows one automatic reload per window (#499).
const CHUNK_RECOVERY_SCRIPT = `(function(){
  var K=${JSON.stringify(CHUNK_RELOAD_KEY)}, W=${CHUNK_RELOAD_WINDOW_MS};
  function reloadOnce(){
    try{
      var now=Date.now(), since=now-Number(sessionStorage.getItem(K));
      if(sessionStorage.getItem(K)!==null&&since>=0&&since<W) return;
      sessionStorage.setItem(K,String(now));
    }catch(e){}
    location.reload();
  }
  window.addEventListener('error',function(e){
    var t=e&&e.target;
    if(t&&(t.tagName==='SCRIPT'||t.tagName==='LINK')){
      var u=t.src||t.href||'';
      if(u.indexOf('/_next/static/')!==-1) reloadOnce();
    }
  },true);
  window.addEventListener('unhandledrejection',function(e){
    var r=e&&e.reason, m=r?(r.name+' '+r.message):String(r||'');
    if(/ChunkLoadError|Loading chunk|dynamically imported module/i.test(m)) reloadOnce();
  });
  var t0=Date.now();
  function watchdog(){
    if(window.__pcReady) return;
    if(Date.now()-t0<60000&&document.querySelector('script[data-webpack]')) { setTimeout(watchdog, 5000); return; }
    reloadOnce();
  }
  setTimeout(watchdog, 20000);
})();`;

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
