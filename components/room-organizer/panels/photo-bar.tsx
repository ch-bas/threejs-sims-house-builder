'use client';

import { Suspense, lazy, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { usePhotoAlbum } from '../hooks/use-photo-album';
import { claimPhotoEscape } from '../lib/photo-mode';
import { SHOT_PRESETS, presetConditions, sceneLabel, type ShotConditions, type ShotPreset } from '../lib/photo-presets';
import type { AlbumSaveResult } from '../lib/photo-album';
import type { FileOutcome } from '../lib/share-delivery';
import type { CameraPreset } from '../lib/types';

// The album and its store load as photo mode first shows it (#912).
const PhotoAlbum = lazy(() => import('./photo-album').then((module) => ({ default: module.PhotoAlbum })));

export interface PhotoBarProps {
  onTake(): Promise<void>;
  /** Take one into the house's album (#912); absent, the bar has no album. */
  onKeep?: () => Promise<AlbumSaveResult | null>;
  houseId?: string | undefined;
  houseName?: string;
  /** Set a shot preset (#912); absent, the bar has no presets. */
  onShoot?: (conditions: ShotConditions, camera: CameraPreset) => void;
  /** The walk is on: a preset sets the light, not the camera. */
  walking?: boolean;
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

/** What the hint says after a photo left the album through Share (#912). */
export function albumShareMessage(outcome: FileOutcome): string {
  switch (outcome) {
    case 'shared':
      return 'Photo shared';
    case 'downloaded':
      // Share asked for the sheet; it failed, so the file came down instead.
      return 'Couldn’t share · downloaded';
    case 'cancelled':
      return '';
    default:
      return '';
  }
}

/** How long a save's message stays before "Frame the shot" comes back (ms). */
const MESSAGE_MS = 2500;

/** The panel open above the shutter: the album or the presets, one at a time. */
type Panel = 'album' | 'presets' | null;

// A held Enter takes one photo (or sets one preset), not one per repeat.
const noRepeat = (event: ReactKeyboardEvent) => {
  if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
};

interface ShotPresetsProps {
  id: string;
  chosen: string | null;
  walking: boolean;
  onPick(preset: ShotPreset): void;
}

/** W4 shot presets (#912): each a camera preset with its hour and weather. */
function ShotPresets({ id, chosen, walking, onPick }: ShotPresetsProps): JSX.Element {
  return (
    <div id={id} tabIndex={-1} className="pc-glass pc-glass--dark pc-photo-presets" role="region" aria-label="Presets">
      <div className="pc-photo-presets-grid">
        {SHOT_PRESETS.map((preset) => {
          const scene = sceneLabel(preset.hour, preset.weather);
          return (
            <button
              key={preset.id}
              type="button"
              className={`pc-tile pc-photo-preset${chosen === preset.id ? ' pc-tile--active' : ''}`}
              aria-pressed={chosen === preset.id}
              aria-label={`${preset.label}, ${scene}`}
              onClick={() => onPick(preset)}
              onKeyDown={noRepeat}
            >
              <span className="pc-photo-preset-name">{preset.label}</span>
              <span className="pc-photo-preset-scene">{scene}</span>
            </button>
          );
        })}
      </div>
      <p className="pc-photo-album-note">
        {walking
          ? 'Walking, a preset sets the hour and weather; the view stays yours.'
          : 'A preset sets the camera, the hour and the weather.'}{' '}
        Done puts the hour and weather back.
      </p>
    </div>
  );
}

/**
 * The shutter of photo mode (#626): the only HUD left on screen, and never
 * in the photo, which is the 3D canvas alone. Focus lands on "Take photo",
 * so Enter takes one; Escape leaves (use-photo-mode), or first closes the
 * open album or presets (#912).
 */
export function PhotoBar({ onTake, onKeep, houseId, houseName = '', onShoot, walking = false, onDone }: PhotoBarProps): JSX.Element {
  const takeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // Focus goes back to "Save to album" once it is enabled again: a question
  // asked meanwhile hands focus back to a disabled button, which drops it.
  const [refocusKeep, setRefocusKeep] = useState(false);
  const albumButtonRef = useRef<HTMLButtonElement>(null);
  const presetsButtonRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  // The preset last set in this stay: nothing else changes the hour while the HUD hides.
  const [chosen, setChosen] = useState<string | null>(null);
  const albumId = useId();
  const presetsId = useId();
  const album = usePhotoAlbum(onKeep ? houseId : undefined);
  const albumOpen = panel === 'album' && onKeep !== undefined;
  const presetsOpen = panel === 'presets' && onShoot !== undefined;
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
  // Orbiting, panning or zooming the scene moves the camera off the
  // preset's: it is no longer that shot, so none shows pressed.
  useEffect(() => {
    if (chosen === null) return undefined;
    const onScene = (event: Event) => event.target instanceof HTMLCanvasElement;
    let pressed = false;
    const down = (event: PointerEvent) => {
      if (onScene(event)) pressed = true;
    };
    const move = (event: PointerEvent) => {
      if (pressed && event.buttons !== 0) setChosen(null);
    };
    const up = () => {
      pressed = false;
    };
    const wheel = (event: WheelEvent) => {
      if (onScene(event)) setChosen(null);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('wheel', wheel, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('wheel', wheel, true);
    };
  }, [chosen]);
  useEffect(() => {
    if (panel === null) return undefined;
    const opener = panel === 'album' ? albumButtonRef : presetsButtonRef;
    return claimPhotoEscape(() => {
      setPanel(null);
      opener.current?.focus({ preventScroll: true });
    });
  }, [panel]);
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
  const pick = (preset: ShotPreset) => {
    if (!onShoot) return;
    onShoot(presetConditions(preset), preset.camera);
    setChosen(preset.id);
    setMessage(preset.label);
  };
  const toggle = (which: Exclude<Panel, null>) => setPanel((open) => (open === which ? null : which));
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
      {albumOpen && (
        <Suspense fallback={null}>
          <PhotoAlbum
            id={albumId}
            photos={album.photos}
            state={album.state}
            houseName={houseName}
            onShared={(outcome) => setMessage(albumShareMessage(outcome) || null)}
          />
        </Suspense>
      )}
      {presetsOpen && <ShotPresets id={presetsId} chosen={chosen} walking={walking} onPick={pick} />}
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
        {onShoot && (
          <button
            ref={presetsButtonRef}
            type="button"
            className={`pc-tile pc-photo-bar-button pc-photo-bar-presets${presetsOpen ? ' pc-tile--active' : ''}`}
            aria-expanded={presetsOpen}
            {...(presetsOpen ? { 'aria-controls': presetsId } : {})}
            onClick={() => toggle('presets')}
            onKeyDown={noRepeat}
          >
            Presets
          </button>
        )}
        <button
          ref={takeRef}
          type="button"
          className="pc-tile pc-tile--active pc-photo-bar-button pc-photo-bar-take"
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
              className="pc-tile pc-photo-bar-button pc-photo-bar-keep"
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
              onClick={() => toggle('album')}
              onKeyDown={noRepeat}
            >
              Album · {count}
            </button>
          </>
        )}
        <button type="button" className="pc-tile pc-photo-bar-button pc-photo-bar-done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
