'use client';

import dynamic from 'next/dynamic';
import { reloadOnceForChunkError } from '@/components/room-organizer/lib/chunk-reload';

// Start the 3D engine download together with the editor chunk instead of
// after it (#413). use-three-scene imports the same modules; webpack shares
// the in-flight chunk requests, so this only removes the editor → engine hop.
// Failures are left to that hook, which reports them and owns chunk recovery.
function prefetchEngine(): void {
  Promise.all([
    import('@/components/room-organizer/three/three-runtime'),
    import('three/examples/jsm/controls/OrbitControls.js'),
    import('three/examples/jsm/environments/RoomEnvironment.js'),
  ]).catch(() => undefined);
}

const RoomOrganizer = dynamic(
  () => {
    prefetchEngine();
    return import('@/components/room-organizer')
      // No guard clearing or ready signal here: the engine chunk is still to
      // come, and clearing on the editor chunk alone looped forever when the
      // engine one kept failing (#499). use-three-scene signals ready.
      .then((module) => module.RoomOrganizer)
      .catch((err) => {
        // A returning visitor after a redeploy can load cached HTML whose
        // hashed editor chunk now 404s; next/dynamic would otherwise show the
        // loading fallback forever. Reload once to fetch fresh assets.
        if (reloadOnceForChunkError(err)) {
          // A reload is navigating away — render nothing in the meantime.
          return function ChunkReloading(): null {
            return null;
          };
        }
        throw err; // persistent failure → error boundary (offers a reset)
      });
  },
  {
    ssr: false,
    loading: () => (
      <div
        className="pc-world"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <div
          className="pc-glass pc-glass--dark"
          style={{ padding: '18px 28px', textAlign: 'center' }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--pc-font-display)',
              fontWeight: 700,
              color: 'var(--pc-paper)',
              letterSpacing: 'var(--pc-tr-caps)',
              textTransform: 'uppercase',
              fontSize: 14,
            }}
          >
            Loading the lot…
          </p>
        </div>
      </div>
    ),
  }
);

export default function Page(): JSX.Element {
  return <RoomOrganizer />;
}
