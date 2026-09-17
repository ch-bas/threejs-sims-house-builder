'use client';

import { useEffect } from 'react';
import {
  clearChunkReloadGuard,
  isChunkLoadError,
  reloadOnceForChunkError,
} from '../components/room-organizer/lib/chunk-reload';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';

// Route-level error boundary. A saved layout that crashes the renderer would
// otherwise white-screen the app on every reload, with no way out but
// devtools. This gives a friendly recovery path: clear the persisted layout
// and retry.

export default function Error({ error }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  useEffect(() => {
    // Stale-chunk failures hard-reload ONCE via the shared pc-chunk-reload
    // guard (`reset()` would just re-request the same dead chunk). An
    // unguarded reload here looped forever on a persistently missing chunk —
    // a broken deploy — and made this screen unreachable (#143). When the
    // guard is already spent, fall through to the UI below instead.
    reloadOnceForChunkError(error);
  }, [error]);

  // A persistent chunk failure is a deploy problem, not a corrupt save —
  // offering "Reset saved layout" for it would delete the user's house for
  // nothing. Show a retry path that leaves storage alone (#143).
  const chunkFailure = isChunkLoadError(error);
  const retryChunkLoad = () => {
    clearChunkReloadGuard();
    window.location.reload();
  };

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
          {chunkFailure ? 'Couldn’t load the app' : 'Something went sideways'}
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
          {chunkFailure
            ? 'Some of the app’s files couldn’t be fetched — a fresh deploy may be rolling out. Reloading usually fixes it, and your saved house is untouched.'
            : 'The saved layout couldn’t be rendered. Resetting it clears the stored layout and starts fresh.'}
        </p>
        <button
          type="button"
          onClick={chunkFailure ? retryChunkLoad : resetSavedLayout}
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
          {chunkFailure ? 'Reload' : 'Reset saved layout'}
        </button>
      </div>
    </div>
  );
}
