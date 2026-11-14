import { useEffect, useState } from 'react';
import type { AlbumPhoto, AlbumState } from '../lib/photo-album';

export interface PhotoAlbumState {
  /** The house's photos, newest first; null while the album opens. */
  photos: AlbumPhoto[] | null;
  /** Where the album lives (lib/photo-album `AlbumState`). */
  state: AlbumState;
}

/**
 * One house's album (#912), read as the photo bar mounts and again on
 * every save or delete, in this tab or another (a BroadcastChannel). The
 * album module loads with `import()`, so it stays out of the first-load
 * bundle until photo mode opens.
 */
export function usePhotoAlbum(houseId: string | undefined): PhotoAlbumState {
  const [album, setAlbum] = useState<PhotoAlbumState>({ photos: null, state: 'persistent' });
  useEffect(() => {
    if (!houseId) {
      setAlbum({ photos: [], state: 'persistent' });
      return undefined;
    }
    let live = true;
    let unsubscribe: (() => void) | null = null;
    void import('../lib/photo-album').then((lib) => {
      if (!live) return;
      const load = (): void => {
        void lib
          .openAlbum()
          .then(async (store) => {
            const photos = await store.listHouse(houseId);
            if (live) setAlbum({ photos: photos.reverse(), state: store.state });
          })
          .catch(() => {
            if (live) setAlbum({ photos: [], state: 'session' });
          });
      };
      load();
      unsubscribe = lib.subscribeAlbum(load);
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [houseId]);
  return album;
}
