'use client';

import { Suspense, lazy, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { usePhotoAlbum } from '../hooks/use-photo-album';
import { claimPhotoEscape } from '../lib/photo-mode';
import type { AlbumSaveResult } from '../lib/photo-album';

// The album and its store load as photo mode first shows it (#912).
const PhotoAlbum = lazy(() => import('./photo-album').then((module) => ({ default: module.PhotoAlbum })));

export interface PhotoBarProps {
  onTake(): Promise<void>;
  /** Take one into the house's album (#912); absent, the bar has no album. */
  onKeep?: () => Promise<AlbumSaveResult | null>;
  houseId?: string | undefined;
  houseName?: string;
  onDone(): void;
}

/** What the hint says after a save to the album. */
export function albumSaveMessage(result: AlbumSaveResult | null): string {
  if (!result) return 'Couldn’t take the photo';
  switch (result.kind) {
    case 'saved':
      if (result.state !== 'persistent') return 'Kept until the tab closes';
      return result.evicted > 0 ? 'Kept · oldest removed' : 'Kept in the album';
    case 'declined':
      return 'Not kept';
    case 'cancelled':
      return '';
    case 'full':
      return 'No room left to keep it';
    case 'failed':
      return 'Couldn’t keep it';
    default:
      return '';
  }
}

/** How long a save's message stays before "Frame the shot" comes back (ms). */
const MESSAGE_MS = 2500;

/**
 * The shutter of photo mode (#626): the only HUD left on screen, and never
 * in the photo, which is the 3D canvas alone. Focus lands on "Take photo",
 * so Enter takes one; Escape leaves (use-photo-mode), or first closes the
 * album (#912).
 */
export function PhotoBar({ onTake, onKeep, houseId, houseName = '', onDone }: PhotoBarProps): JSX.Element {
  const takeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // Focus goes back to "Save to album" once it is enabled again: a question
  // asked meanwhile hands focus back to a disabled button, which drops it.
  const [refocusKeep, setRefocusKeep] = useState(false);
  const albumButtonRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [albumOpen, setAlbumOpen] = useState(false);
  const albumId = useId();
  const album = usePhotoAlbum(onKeep ? houseId : undefined);
  useEffect(() => {
    takeRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (message === null) return undefined;
    const timer = window.setTimeout(() => setMessage(null), MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!refocusKeep || saving) return;
    setRefocusKeep(false);
    const focused = document.activeElement;
    if (!focused || focused === document.body || !focused.isConnected) keepRef.current?.focus({ preventScroll: true });
  }, [refocusKeep, saving]);
  useEffect(() => {
    if (!albumOpen) return undefined;
    return claimPhotoEscape(() => {
      setAlbumOpen(false);
      albumButtonRef.current?.focus({ preventScroll: true });
    });
  }, [albumOpen]);
  const take = () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    void onTake().finally(() => setSaving(false));
  };
  const keep = () => {
    if (saving || !onKeep) return;
    setSaving(true);
    setMessage(null);
    void onKeep()
      .then((result) => setMessage(albumSaveMessage(result) || null))
      .finally(() => {
        setSaving(false);
        setRefocusKeep(true);
      });
  };
  // A held Enter takes one photo, not one per repeat.
  const noRepeat = (event: ReactKeyboardEvent) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  };
  const count = album.photos?.length ?? 0;
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
      {albumOpen && onKeep && (
        <Suspense fallback={null}>
          <PhotoAlbum id={albumId} photos={album.photos} state={album.state} houseName={houseName} />
        </Suspense>
      )}
      <div
        className="pc-glass pc-glass--dark pc-photo-bar-row"
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
          {saving ? 'Saving…' : message ?? 'Frame the shot'}
        </span>
        <button
          ref={takeRef}
          type="button"
          className="pc-tile pc-tile--active pc-photo-bar-button"
          disabled={saving}
          onClick={take}
          onKeyDown={noRepeat}
        >
          Take photo
        </button>
        {onKeep && (
          <>
            <button
              ref={keepRef}
              type="button"
              className="pc-tile pc-photo-bar-button"
              disabled={saving}
              onClick={keep}
              onKeyDown={noRepeat}
            >
              Save to album
            </button>
            <button
              ref={albumButtonRef}
              type="button"
              className={`pc-tile pc-photo-bar-button pc-photo-bar-album${albumOpen ? ' pc-tile--active' : ''}`}
              aria-expanded={albumOpen}
              {...(albumOpen ? { 'aria-controls': albumId } : {})}
              aria-label={`Album, ${count} ${count === 1 ? 'photo' : 'photos'}`}
              onClick={() => setAlbumOpen((open) => !open)}
              onKeyDown={noRepeat}
            >
              Album · {count}
            </button>
          </>
        )}
        <button type="button" className="pc-tile pc-photo-bar-button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
