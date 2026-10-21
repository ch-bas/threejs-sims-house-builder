import { Nunito, Sora } from 'next/font/google';
import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS } from '@/components/room-organizer/lib/chunk-reload';
import type { Metadata, Viewport } from 'next';
import './globals.css';

// Fetched at build time and served from _next/static/media with preload
// links (#417); no request reaches a font CDN at runtime. tokens.css reads
// the variables into --pc-font-display / --pc-font-body.
const sora = Sora({ subsets: ['latin'], display: 'swap', variable: '--pc-font-sora' });
const nunito = Nunito({ subsets: ['latin'], display: 'swap', variable: '--pc-font-nunito' });

export const metadata: Metadata = {
  title: '3D Room Organizer',
  description: 'Design and visualize rooms in 3D with furniture, Wi-Fi, and CCTV planning',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${nunito.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
