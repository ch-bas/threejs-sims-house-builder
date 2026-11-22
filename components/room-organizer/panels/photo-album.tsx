'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { askConfirm } from '../lib/confirm-dialog';
import { formatAge } from '../lib/format';
import {
  ALBUM_MAX_EDGE,
  albumPhotoFile,
  browserImageChannels,
  deleteFromAlbum,
  sharePhoto,
  type AlbumPhoto,
  type AlbumState,
} from '../lib/photo-album';
import { sceneLabel } from '../lib/photo-presets';
import { downloadBlob } from '../lib/plan-export/download';
import type { FileChannels, FileOutcome } from '../lib/share-delivery';

const STATE_NOTES: Record<Exclude<AlbumState, 'persistent'>, string> = {
  session: 'This browser won’t store the album: these photos go when the tab closes.',
  blocked: 'A newer version of this page holds the album in another tab: close the other tabs and reload to see it. Photos kept now go when this tab closes.',
};

interface AlbumRowProps {
  photo: AlbumPhoto;
  houseName: string;
  now: number;
  /** Called as a delete is confirmed, with whether it went through. */
  onDeleting(done: boolean | null): void;
  /** Share the photo (#912): present where the share sheet takes an image. */
  onShare?: (() => void) | undefined;
}

function AlbumRow({ photo, houseName, now, onDeleting, onShare }: AlbumRowProps): JSX.Element {
  const age = formatAge(Math.max(0, now - photo.takenAt));
  const remove = async () => {
    const yes = await askConfirm({
      title: 'Delete this photo?',
      body: `Taken ${age}. A deleted photo can’t be brought back.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    // Focus moves on once the row is gone; a failed delete leaves it be.
    onDeleting(null);
    onDeleting(await deleteFromAlbum([photo.id]));
  };
  const download = () => {
    const file = albumPhotoFile(photo, houseName);
    downloadBlob(file.name, file);
  };
  return (
    <li className="pc-photo-album-row">
      {photo.thumb ? (
        // A data URL from the album, which next/image has nothing to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.thumb} alt="" className="pc-photo-album-thumb" />
      ) : (
        <span className="pc-photo-album-thumb" />
      )}
      <span className="pc-photo-album-meta">
        <span className="pc-photo-album-age">{age}</span>
        <span className="pc-photo-album-scene">
          {sceneLabel(photo.hour, photo.weather)}
        </span>
      </span>
      {onShare && (
        <button type="button" className="pc-tile pc-photo-bar-button pc-photo-album-share" aria-label={`Share photo taken ${age}`} onClick={onShare}>
          Share
        </button>
      )}
      <button type="button" className="pc-tile pc-photo-bar-button pc-photo-album-download" aria-label={`Download the album copy of the photo taken ${age}`} onClick={download}>
        Download
      </button>
      <button
        type="button"
        className="pc-tile pc-photo-bar-button pc-photo-album-delete"
        aria-label={`Delete photo taken ${age}`}
        onClick={() => void remove()}
      >
        Delete
      </button>
    </li>
  );
}

export interface PhotoAlbumProps {
  id: string;
  photos: AlbumPhoto[] | null;
  state: AlbumState;
  houseName: string;
  /** How a shared photo went: the shutter's hint says so (photo mode hides the notices). */
  onShared?: (outcome: FileOutcome) => void;
  /** Where a shared photo goes (tests); the browser's sheet or a download by default. */
  channels?: FileChannels;
}

/**
 * The house's album (#912), newest first, above the shutter: each photo
 * with its age, the scene's hour and weather, Share (where the share sheet
 * takes an image; a download if it fails), Download (the album's JPEG
 * copy) and Delete. After a delete, focus goes to the row that took its
 * place, or to the album itself.
 */
export function PhotoAlbum({ id, photos, state, houseName, onShared, channels: given }: PhotoAlbumProps): JSX.Element {
  const now = Date.now();
  // Asked once: whether the sheet takes an image doesn't change in a session.
  const [channels] = useState<FileChannels>(() => given ?? browserImageChannels());
  // One sheet at a time: a second tap while it is open would fail and download.
  const sharingRef = useRef(false);
  const share = (photo: AlbumPhoto) => {
    if (sharingRef.current) return;
    sharingRef.current = true;
    // The file is built from bytes in hand: the sheet opens inside the tap.
    void sharePhoto(albumPhotoFile(photo, houseName), channels)
      .then((outcome) => onShared?.(outcome))
      .finally(() => {
        sharingRef.current = false;
      });
  };
  const regionRef = useRef<HTMLDivElement>(null);
  const focusRowRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const index = focusRowRef.current;
    const region = regionRef.current;
    if (index === null || !region) return;
    focusRowRef.current = null;
    const rows = region.querySelectorAll<HTMLElement>('.pc-photo-album-row');
    const row = rows[Math.min(index, rows.length - 1)];
    (row?.querySelector<HTMLElement>('button') ?? region).focus({ preventScroll: true });
  }, [photos]);
  return (
    <div ref={regionRef} id={id} tabIndex={-1} className="pc-glass pc-glass--dark pc-photo-album" role="region" aria-label="Album">
      {photos === null ? (
        <p className="pc-photo-album-note">Opening the album…</p>
      ) : photos.length === 0 ? (
        <p className="pc-photo-album-note">No photos of this house yet. “Save to album” keeps the next one here.</p>
      ) : (
        <ul className="pc-photo-album-list">
          {photos.map((photo, index) => (
            <AlbumRow
              key={photo.id}
              photo={photo}
              houseName={houseName}
              now={now}
              onShare={channels.shareFile ? () => share(photo) : undefined}
              onDeleting={(done) => {
                if (done === null) focusRowRef.current = index;
                else if (!done) focusRowRef.current = null;
              }}
            />
          ))}
        </ul>
      )}
      {photos !== null && photos.length > 0 && (
        <p className="pc-photo-album-note">The album keeps a JPEG copy, up to {ALBUM_MAX_EDGE} px. “Take photo” saves the full-size PNG.</p>
      )}
      {state !== 'persistent' && <p className="pc-photo-album-note">{STATE_NOTES[state]}</p>}
    </div>
  );
}
