'use client';

import { useEffect, useRef, useState } from 'react';

export interface PhotoBarProps {
  onTake(): Promise<void>;
  onDone(): void;
}

/**
 * The shutter of photo mode (#626): the only HUD left on screen, and never
 * in the photo, which is the 3D canvas alone. Focus lands on "Take photo",
 * so Enter takes one; Escape leaves (use-photo-mode).
 */
export function PhotoBar({ onTake, onDone }: PhotoBarProps): JSX.Element {
  const takeRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    takeRef.current?.focus({ preventScroll: true });
  }, []);
  const take = () => {
    if (saving) return;
    setSaving(true);
    void onTake().finally(() => setSaving(false));
  };
  return (
    <div
      className="pc-photo-bar"
      role="group"
      aria-label="Photo mode"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        transform: 'translateX(-50%)',
        zIndex: 40,
      }}
    >
      <div
        className="pc-glass pc-glass--dark"
        style={{
          padding: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          borderRadius: 999,
          whiteSpace: 'nowrap',
        }}
      >
        <span className="pc-photo-bar-hint" role="status">
          {saving ? 'Saving…' : 'Frame the shot'}
        </span>
        <button
          ref={takeRef}
          type="button"
          className="pc-tile pc-tile--active pc-photo-bar-button"
          disabled={saving}
          onClick={take}
          // A held Enter takes one photo, not one per repeat.
          onKeyDown={(event) => {
            if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
          }}
        >
          Take photo
        </button>
        <button type="button" className="pc-tile pc-photo-bar-button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
