'use client';

import { useEffect } from 'react';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';

// Global error boundary — catches errors thrown in the root layout itself, so
// it must render its own <html>/<body>. Same recovery path as app/error.tsx:
// clear the persisted layout that crashed the renderer, then reload.

/**
 * See app/error.tsx: a redeploy invalidates the cached chunk hashes a returning
 * user's HTML points at, so `dynamic(...)` throws a ChunkLoadError that
 * `reset()` can't clear (it re-requests the same dead chunk). Hard-reload for
 * chunk/loading failures to fetch fresh HTML + new chunk hashes.
 */
function isChunkLoadError(error: Error): boolean {
  return error.name === 'ChunkLoadError' || /loading chunk|loading css chunk|dynamically imported module/i.test(error.message);
}

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  useEffect(() => {
    if (isChunkLoadError(error)) {
      window.location.reload();
    }
  }, [error]);

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
            Something went sideways
          </p>
          <p style={{ margin: '0 0 20px', color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
            The saved layout couldn’t be rendered. Resetting it clears the
            stored layout and starts fresh.
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
              background: '#22d3ee',
              color: '#0f172a',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontSize: 12,
            }}
          >
            Reset saved layout
          </button>
        </div>
      </body>
    </html>
  );
}
