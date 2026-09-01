'use client';

import { useEffect } from 'react';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';

// Route-level error boundary. A saved layout that crashes the renderer would
// otherwise white-screen the app on every reload, with no way out but
// devtools. This gives a friendly recovery path: clear the persisted layout
// and retry.

/**
 * A returning user's cached HTML references old hashed chunks that a redeploy
 * has since removed, so the `dynamic(() => import(...))` in app/page.tsx throws
 * a ChunkLoadError. `reset()` only re-requests the same dead chunk → an
 * infinite re-catch loop, so for chunk/loading failures we hard-reload instead:
 * a fresh document fetch pulls the new HTML with the new chunk hashes.
 */
function isChunkLoadError(error: Error): boolean {
  return error.name === 'ChunkLoadError' || /loading chunk|loading css chunk|dynamically imported module/i.test(error.message);
}

export default function Error({ error }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  useEffect(() => {
    if (isChunkLoadError(error)) {
      window.location.reload();
    }
  }, [error]);

  const resetSavedLayout = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — worst case the reload happens without clearing.
    }
    // Hard reload rather than the soft `reset()`: the layout lives in a
    // module-level Zustand singleton, so a soft remount would keep the
    // crash-causing layout in memory (loadLayout() is now null, so hydration
    // wouldn't overwrite it) and immediately re-crash. A full document reload
    // re-evaluates the module with a fresh store seeded from INITIAL_LAYOUT.
    window.location.reload();
  };

  return (
    <div
      className="pc-world"
      style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: 24 }}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{ padding: '28px 32px', textAlign: 'center', maxWidth: 420 }}
      >
        <p
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
          Something went sideways
        </p>
        <p
          style={{
            margin: '0 0 20px',
            fontFamily: 'var(--pc-font-body)',
            color: 'var(--pc-paper-soft)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          The saved layout couldn’t be rendered. Resetting it clears the stored
          layout and starts fresh.
        </p>
        <button
          type="button"
          onClick={resetSavedLayout}
          style={{
            appearance: 'none',
            cursor: 'pointer',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            borderRadius: 8,
            padding: '10px 18px',
            background: 'var(--pc-cyan-glow, #22d3ee)',
            color: '#0f172a',
            fontFamily: 'var(--pc-font-display)',
            fontWeight: 700,
            letterSpacing: 'var(--pc-tr-caps)',
            textTransform: 'uppercase',
            fontSize: 12,
          }}
        >
          Reset saved layout
        </button>
      </div>
    </div>
  );
}
