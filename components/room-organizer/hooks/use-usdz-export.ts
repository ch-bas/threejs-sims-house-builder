import { useEffect, useRef, useState } from 'react';
import { isChunkLoadError } from '../lib/chunk-reload';
import { notify } from '../lib/editor-notices';
import { downloadBlob } from '../lib/plan-export/download';
import { useEvent } from './use-event';
import type { RoomLayout } from '../lib/types';

export type UsdzExport =
  | { kind: 'idle' }
  | { kind: 'building' }
  /** AR only: the model is built and the "Open in AR" link points at it. */
  | { kind: 'ready'; url: string; fileName: string; image: string };

export interface UseUsdzExportResult {
  /** Quick Look opens `rel="ar"` links here (iOS Safari). */
  arView: boolean;
  state: UsdzExport;
  /** Build the model: on an AR device, for the link to tap; elsewhere, saved as a file. */
  build(): void;
}

// Loaded after mount, not with the editor: a few hundred bytes the first
// load doesn't need, and it carries the exporter's loader.
const loadArView = () => import('../lib/ar-view');

/** What a failed build tells the player: the connection only when a chunk didn't load. */
export function usdzFailureMessage(error: unknown): string {
  return isChunkLoadError(error)
    ? 'Couldn’t load the AR model maker. Check your connection and try again.'
    : 'Couldn’t make the AR model of this house.';
}

/**
 * The USDZ export (#937). On an AR device it takes two taps: the first
 * builds the model, the second is the player's own tap on a real
 * `<a rel="ar">` to it, which Safari hands to Quick Look — a link clicked
 * from script after an await may not count as the player's gesture.
 * Elsewhere one tap saves the file.
 *
 * The blob URL lives while the link shows: it is revoked by the next build,
 * by any change to the house (the link would show an old one) and on
 * unmount.
 */
export function useUsdzExport(layout: RoomLayout): UseUsdzExportResult {
  const [arView, setArView] = useState(false);
  // Read after mount: the static export prerenders without a document.
  // Offline before the chunk was cached, the file button stays.
  useEffect(() => {
    void loadArView().then(
      (ar) => setArView(ar.quickLookSupported()),
      () => {}
    );
  }, []);
  const [state, setState] = useState<UsdzExport>({ kind: 'idle' });
  const building = useRef(false);
  const shown = useRef<{ url: string; layout: RoomLayout } | null>(null);
  const mounted = useRef(true);
  const latest = useRef(layout);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revoke(shown);
    };
  }, []);

  // The house changed: the built model is out of date.
  useEffect(() => {
    latest.current = layout;
    if (shown.current && shown.current.layout !== layout) {
      revoke(shown);
      setState({ kind: 'idle' });
    }
  }, [layout]);

  const build = useEvent(() => {
    if (building.current) return;
    building.current = true;
    revoke(shown);
    setState({ kind: 'building' });
    const house = layout;
    const toQuickLook = arView;
    loadArView()
      .then(async (ar) => ({ ar, blob: await ar.buildUsdzBlob(house) }))
      .then(({ ar, blob }) => {
        if (!mounted.current) return;
        const fileName = ar.usdzFileName(house);
        if (!toQuickLook) {
          // A file is a copy of the house as it was asked for.
          downloadBlob(fileName, blob);
          setState({ kind: 'idle' });
          return;
        }
        // Edited while it was built: the link would show an older house.
        if (latest.current !== house) {
          setState({ kind: 'idle' });
          return;
        }
        const url = URL.createObjectURL(blob);
        shown.current = { url, layout: house };
        setState({ kind: 'ready', url, fileName, image: ar.AR_LINK_IMAGE });
      })
      .catch((error: unknown) => {
        console.error('USDZ export failed', error);
        notify(usdzFailureMessage(error), 'error');
        if (mounted.current) setState({ kind: 'idle' });
      })
      .finally(() => {
        building.current = false;
      });
  });

  return { arView, state, build };
}

function revoke(shown: { current: { url: string } | null }): void {
  if (shown.current) URL.revokeObjectURL(shown.current.url);
  shown.current = null;
}
