'use client';

// Route-level error boundary. A saved layout that crashes the renderer would
// otherwise white-screen the app on every reload, with no way out but
// devtools. This gives a friendly recovery path: clear the persisted layout
// and retry. The storage key literal mirrors STORAGE_KEY in
// components/room-organizer/lib/constants.ts.
const STORAGE_KEY = 'standalone-room-organizer-layout';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element {
  const resetSavedLayout = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — worst case the reset button just reloads without clearing.
    }
    reset();
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
