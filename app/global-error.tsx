'use client';

import { useEffect } from 'react';
import {
  clearChunkReloadGuard,
  isChunkLoadError,
  reloadOnceForChunkError,
} from '../components/room-organizer/lib/chunk-reload';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';

// Global error boundary — catches errors thrown in the root layout itself, so
// it must render its own <html>/<body>. Same recovery path as app/error.tsx:
// clear the persisted layout that crashed the renderer, then reload.

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  useEffect(() => {
    // One automatic reload per session via the shared pc-chunk-reload guard —
    // see app/error.tsx: an unguarded reload looped forever on a persistently
    // missing chunk and made the recovery UI unreachable (#143).
    reloadOnceForChunkError(error);
  }, [error]);

  // A persistent chunk failure is a deploy problem, not a corrupt save; keep
  // the user's layout and offer a plain retry instead (#143).
  const chunkFailure = isChunkLoadError(error);
  const retryChunkLoad = () => {
    clearChunkReloadGuard();
    window.location.reload();
  };

  const resetSavedLayout = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — fall through to reload even if storage is unavailable.
    }
    // Hard reload rather than the soft `reset()`: the layout is a module-level
    // Zustand singleton, so a soft remount would keep the crash-causing layout
    // in memory and re-crash. A full reload re-evaluates the module fresh.
    window.location.reload();
  };

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#0f172a',
          color: '#e2e8f0',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            textAlign: 'center',
            padding: '28px 32px',
            borderRadius: 14,
            border: '1px solid rgba(148, 163, 184, 0.24)',
            background: 'rgba(30, 41, 59, 0.72)',
          }}
        >
          <p style={{ margin: '0 0 8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 16 }}>
            {chunkFailure ? 'Couldn’t load the app' : 'Something went sideways'}
          </p>
          <p style={{ margin: '0 0 20px', color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
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
              background: '#22d3ee',
              color: '#0f172a',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontSize: 12,
            }}
          >
            {chunkFailure ? 'Reload' : 'Reset saved layout'}
          </button>
        </div>
      </body>
    </html>
  );
}
