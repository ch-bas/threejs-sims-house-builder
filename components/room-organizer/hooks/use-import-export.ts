import { useCallback, type MutableRefObject, type RefObject } from 'react';
import {
  downloadCanvasAsPng,
  downloadSceneAsGlb,
  readLayoutFromFile,
} from '../lib/file-io';
import { encodeShareUrl, isShareUrlReasonablySized } from '../lib/share';
import type { LayoutActions } from './use-layout-state';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

export interface UseImportExportParams {
  layout: RoomLayout;
  actions: LayoutActions;
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
  handleImport(file: File): Promise<void>;
}

export function useImportExport({
  layout,
  actions,
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
    void downloadCanvasAsPng(canvas, layout.name || 'room-layout').then((ok) => {
      if (!ok) window.alert('Could not export the screenshot — the image failed to encode.');
    });
  }, [view2D, layout.name, canvasRef, canvas2DRef, rendererRef, sceneRef, cameraRef]);

  const handleExportGlb = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    try {
      await downloadSceneAsGlb(scene, layout.name || 'room-layout');
    } catch (exportError) {
      window.alert(exportError instanceof Error ? exportError.message : 'GLB export failed.');
    }
  }, [sceneRef, layout.name]);

  const handleShareLink = useCallback(async () => {
    const origin = window.location.origin + window.location.pathname;
    const { url, strippedFloorPlan } = encodeShareUrl(layout, origin);

    if (!isShareUrlReasonablySized(url)) {
      window.alert(
        'This layout is too large to fit in a share link. Try exporting it as JSON and sharing the file instead.'
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      const note = strippedFloorPlan
        ? '\n\n(The floor-plan image was removed from the link to keep it short.)'
        : '';
      window.alert(`Share link copied to clipboard.${note}`);
    } catch {
      window.prompt('Copy this share link:', url);
    }
  }, [layout]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const next = await readLayoutFromFile(file);
        actions.applyLayout(next);
        onImported();
      } catch (importError) {
        const message =
          importError instanceof Error
            ? importError.message
            : 'Failed to import layout. Please check the file format.';
        window.alert(message);
      }
    },
    [actions, onImported]
  );

  return { handleScreenshot, handleExportGlb, handleShareLink, handleImport };
}
