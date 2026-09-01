import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '3D Room Organizer',
  description: 'Design and visualize rooms in 3D with furniture, Wi-Fi, and CCTV planning',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// Stale-chunk recovery for the GitHub Pages static export. index.html is cached
// for ~10 min, so a returning visitor within that window loads cached HTML whose
// hashed `_next/static/chunks/*.js` URLs were replaced by the new deploy and now
// 404 — breaking the app before any React code runs. Two guarded recovery paths,
// inline in <head> so they run before the app chunks:
//   1. A capture-phase resource-error / unhandledrejection listener (fast path).
//   2. A watchdog: if the editor hasn't signalled ready within 20 s (the stuck
//      "Loading the lot…" state), reload once. This catches failures the error
//      events miss. `window.__pcReady` is set once the editor module loads
//      (see app/page.tsx). The generous timeout avoids spurious reloads on
//      slow connections, and the sessionStorage guard makes the reload
//      one-shot either way.
const CHUNK_RECOVERY_SCRIPT = `(function(){
  var K='pc-chunk-reload';
  function reloadOnce(){
    try{ if(sessionStorage.getItem(K)==='1') return; sessionStorage.setItem(K,'1'); }catch(e){}
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
  setTimeout(function(){ if(!window.__pcReady) reloadOnce(); }, 20000);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
