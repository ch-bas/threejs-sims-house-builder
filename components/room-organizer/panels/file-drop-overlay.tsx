'use client';

/**
 * Shown while a file is dragged over the page (#934): where it goes and what
 * it does. It takes no pointer events, so the drag still reaches the page
 * underneath, and it is static (no motion to reduce).
 */
export function FileDropOverlay({ lockedReason }: { lockedReason: string | null }): JSX.Element {
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        pointerEvents: 'none',
        background: 'rgba(15, 23, 42, 0.45)',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 12,
          border: '3px dashed var(--pc-paper)',
          borderRadius: 16,
        }}
      />
      <div className="pc-glass pc-glass--dark" style={{ padding: '18px 28px', textAlign: 'center', maxWidth: 420 }}>
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
          {lockedReason ? 'Can’t open a file now' : 'Drop to open the house file'}
        </p>
        <p style={{ margin: '6px 0 0', fontFamily: 'var(--pc-font-body)', color: 'var(--pc-paper)', fontSize: 13, lineHeight: 1.45 }}>
          {lockedReason ?? 'A house replaces the open one once you confirm; a backup only adds what this browser lacks.'}
        </p>
      </div>
    </div>
  );
}
