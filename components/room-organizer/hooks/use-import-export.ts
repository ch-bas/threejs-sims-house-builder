import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react';
import { notify } from '../lib/editor-notices';
import {
  downloadCanvasAsPng,
  downloadLayoutAsGlb,
  readLayoutFromFile,
} from '../lib/file-io';
import { exportFileName } from '../lib/plan-export/download';
import { resolvePlanImage } from '../lib/plan-image-ref';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { encodeShareUrl } from '../lib/share';
import {
  browserFileChannels,
  browserShareChannels,
  deliverHouseFile,
  deliverShareLink,
  fileActionLabel,
  houseFile,
} from '../lib/share-delivery';
import { markLayoutLoaded } from './use-achievements';
import { markFirstStep } from './use-first-steps';
import { layoutStore } from './use-layout-store';
import type { LayoutActions } from './use-layout-state';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

export interface UseImportExportParams {
  layout: RoomLayout;
  /** Names a 2D screenshot after the floor it shows (#427). */
  activeFloorName: string;
  actions: LayoutActions;
  /**
   * `history.commitNow`: a load is a discrete step, so an edit still inside
   * the debounce window keeps an undo entry of its own (#555).
   */
  commitHistoryNow(): void;
  view2D: boolean;
  canvasRef: RefObject<HTMLCanvasElement>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<ThreeNS.WebGLRenderer | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  cameraRef: MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  /** Runs after a successful JSON import (e.g. clear the selection). */
  onImported(): void;
}

export interface UseImportExportResult {
  handleScreenshot(): void;
  handleExportGlb(): Promise<void>;
  handleShareLink(): Promise<void>;
  /** Resolves true when the file replaced the current house. */
  handleImport(file: File): Promise<boolean>;
}

export function useImportExport({
  layout,
  activeFloorName,
  actions,
  commitHistoryNow,
  view2D,
  canvasRef,
  canvas2DRef,
  rendererRef,
  sceneRef,
  cameraRef,
  onImported,
}: UseImportExportParams): UseImportExportResult {
  const handleScreenshot = useCallback(() => {
    const canvas = view2D ? canvas2DRef.current : canvasRef.current;
    if (!canvas) return;
    // The renderer runs without preserveDrawingBuffer, so render a fresh
    // frame synchronously — the buffer is valid within the same task.
    if (!view2D && rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
    // The plan shows one floor, so its file says which (#427). It is
    // transparent outside the house — the lawn is the canvas's CSS
    // background — so paint that behind it (#391).
    const fileName = view2D ? exportFileName(layout.name, 'png', activeFloorName) : exportFileName(layout.name, 'png');
    const background = view2D ? getComputedStyle(canvas).backgroundColor : undefined;
    void downloadCanvasAsPng(canvas, fileName, background).then((ok) => {
      if (!ok) notify('Could not export the screenshot — the image failed to encode.', 'error');
    });
  }, [view2D, layout.name, activeFloorName, canvasRef, canvas2DRef, rendererRef, sceneRef, cameraRef]);

  // The whole building from the layout, whatever the view shows (#373).
  const handleExportGlb = useCallback(async () => {
    try {
      await downloadLayoutAsGlb(layout);
    } catch (exportError) {
      notify(exportError instanceof Error ? exportError.message : 'GLB export failed.', 'error');
    }
  }, [layout]);

  // A second tap while the sheet opens would fail, and read as a refusal.
  const sharing = useRef(false);
  const handleShareLink = useCallback(async () => {
    if (sharing.current) return;
    sharing.current = true;
    const origin = window.location.origin + window.location.pathname;
    // Nothing is awaited before this: the delivery starts inside the tap.
    const outcome = await deliverShareLink(encodeShareUrl(layout, origin), browserShareChannels()).finally(() => {
      sharing.current = false;
    });
    // The link left the page, or is there to copy: shared, as First steps count it (#721).
    if (outcome.kind !== 'cancelled' && outcome.kind !== 'too-large') markFirstStep('share');
    // When the link can't carry the whole house, the notice offers the file
    // that does (#934): the share sheet where it takes files, else a download.
    const channels = browserFileChannels();
    const label = fileActionLabel(channels);
    const fileAction = {
      action: {
        label,
        name: label === 'Share file' ? 'Share the house as a file' : 'Download the house as a file',
        run: () => {
          // Called in the click: the sheet opens inside the tap.
          void deliverHouseFile(houseFile(layout), channels).then((sent) => {
            if (sent === 'shared') notify('House file sent.', 'success');
          });
        },
      },
    };
    const leftOut = 'The floor-plan image was left out to keep it short; the file keeps it.';
    switch (outcome.kind) {
      case 'cancelled':
        return;
      case 'too-large':
        notify(
          `This layout is too large to fit in a share link. ${label === 'Share file' ? 'Share it as a file instead.' : 'Download it as a file and send that instead.'}`,
          'error',
          fileAction
        );
        return;
      case 'shared':
        if (outcome.strippedFloorPlan) notify(`Share link sent. ${leftOut}`, 'success', fileAction);
        else notify('Share link sent.', 'success');
        return;
      case 'copied':
        if (outcome.strippedFloorPlan) notify(`Share link copied to clipboard. ${leftOut}`, 'success', fileAction);
        else notify('Share link copied to clipboard.', 'success');
        return;
      case 'manual': {
        // Nothing took it: hand the link over to copy by hand.
        // The notice and its link stay until the sheet has really taken it.
        const { url, share } = outcome;
        notify('Copy this share link:', 'info', {
          copyText: url,
          ...(share
            ? {
                action: {
                  label: 'Share',
                  name: 'Share this link',
                  keepOpen: true as const,
                  run: () =>
                    share().then(
                      () => {
                        notify('Share link sent.', 'success');
                        return true;
                      },
                      () => false
                    ),
                },
              }
            : {}),
        });
      }
    }
  }, [layout]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        // A file naming its floor-plan image by ref (a stored house's raw
        // download) gets it from this browser's image store, if it is there (#936).
        const next = await resolvePlanImage(await readLayoutFromFile(file));
        if (!(await confirmReplace(layout, `the imported “${next.name}”`))) return false;
        // The house on screen after the answer, not when it asked.
        snapshotBeforeReplace(layoutStore.getState().layout);
        commitHistoryNow();
        actions.applyLayout(next);
        markLayoutLoaded();
        onImported();
        return true;
      } catch (importError) {
        const message =
          importError instanceof Error
            ? `Import failed: ${importError.message}`
            : 'Failed to import layout. Please check the file format.';
        notify(message, 'error');
        return false;
      }
    },
    [layout, actions, commitHistoryNow, onImported]
  );

  return { handleScreenshot, handleExportGlb, handleShareLink, handleImport };
}
