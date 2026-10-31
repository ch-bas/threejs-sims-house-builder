import { useCallback, type MutableRefObject, type RefObject } from 'react';
import { notify, type NoticeAction } from '../lib/editor-notices';
import {
  downloadCanvasAsPng,
  downloadLayoutAsGlb,
  readLayoutFromFile,
} from '../lib/file-io';
import { exportFileName } from '../lib/plan-export/download';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { encodeShareUrl } from '../lib/share';
import { browserShareChannels, deliverShareLink, isShareCancelled } from '../lib/share-delivery';
import { markLayoutLoaded } from './use-achievements';
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

  const handleShareLink = useCallback(async () => {
    const origin = window.location.origin + window.location.pathname;
    // Nothing is awaited before this: the delivery starts inside the tap.
    const outcome = await deliverShareLink(encodeShareUrl(layout, origin), browserShareChannels());
    const leftOut = 'The floor-plan image was left out to keep it short.';
    switch (outcome.kind) {
      case 'cancelled':
        return;
      case 'too-large':
        notify(
          'This layout is too large to fit in a share link. Try exporting it as JSON and sharing the file instead.',
          'error'
        );
        return;
      case 'shared':
        notify(`Share link sent.${outcome.strippedFloorPlan ? ` ${leftOut}` : ''}`, 'success');
        return;
      case 'copied':
        notify(`Share link copied to clipboard.${outcome.strippedFloorPlan ? ` ${leftOut}` : ''}`, 'success');
        return;
      case 'manual': {
        // Nothing took it: hand the link over to copy by hand.
        const { url, share } = outcome;
        const handOver = (action?: NoticeAction) =>
          notify('Copy this share link:', 'info', { copyText: url, ...(action ? { action } : {}) });
        handOver(
          share && {
            label: 'Share',
            run() {
              share().catch((error: unknown) => {
                if (!isShareCancelled(error)) handOver();
              });
            },
          }
        );
      }
    }
  }, [layout]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const next = await readLayoutFromFile(file);
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
