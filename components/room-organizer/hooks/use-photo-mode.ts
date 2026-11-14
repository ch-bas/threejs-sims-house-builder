import { useCallback, useEffect, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import { notify } from '../lib/editor-notices';
import {
  PHOTO_MAX_EDGE,
  PHOTO_MAX_EDGE_PHONE,
  isPhotoMode,
  leavePhotoMode,
  photoFileName,
  photoKeyPasses,
  photoPixelRatio,
  subscribePhotoMode,
  takePhotoFocusReturn,
} from '../lib/photo-mode';
import { downloadBlob } from '../lib/plan-export/download';
import { drawsForPhone } from '../three/texture-settings';
import type * as ThreeNS from 'three';

/** The HUD hides under this attribute on `<html>` (app/globals.css). */
const PHOTO_ATTRIBUTE = 'data-photo';

/** Hide the snap grid, an editing aid, not part of the house; returns the undo. */
function hideGrids(scene: ThreeNS.Object3D | null): () => void {
  const hidden: ThreeNS.Object3D[] = [];
  for (const child of scene?.children ?? []) {
    if (child.type === 'GridHelper' && child.visible) {
      child.visible = false;
      hidden.push(child);
    }
  }
  return () => {
    for (const child of hidden) child.visible = true;
  };
}

export interface UsePhotoModeOptions {
  /** Photo mode is 3D only: it ends when the plan shows or the scene isn't up. */
  available: boolean;
  houseName: string;
  rendererRef: MutableRefObject<ThreeNS.WebGLRenderer | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  cameraRef: MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  invalidate(): void;
  /** Keys still reach the walk while walking (it edits nothing); otherwise only the shutter's own. */
  walking: boolean;
  /** Runs as photo mode starts: a selection outline has no place in a photo. */
  onEnter(): void;
}

/** Whether photo mode is on, for the scene's `orbitOnly` (read before the scene exists). */
export function usePhotoModeActive(): boolean {
  return useSyncExternalStore(subscribePhotoMode, isPhotoMode, () => false);
}

export interface PhotoMode {
  active: boolean;
  /** Save the scene as it shows now, at twice its resolution. */
  take(): Promise<void>;
  leave(): void;
}

/**
 * Photo mode (#626). While on, `html[data-photo]` hides the HUD (CSS only,
 * so no box moves), the projection shift for the HUD and the snap grid are
 * dropped, the canvas only orbits (the editor passes `orbitOnly` to the
 * scene), and only the shutter's and the walk's keys reach the page;
 * Escape leaves, and focus goes back to the control that opened it. A photo is one frame drawn
 * at twice the scene's resolution and read back in the same task, so the
 * renderer keeps running without `preserveDrawingBuffer`.
 */
export function usePhotoMode({
  available,
  houseName,
  rendererRef,
  sceneRef,
  cameraRef,
  invalidate,
  walking,
  onEnter,
}: UsePhotoModeOptions): PhotoMode {
  const active = usePhotoModeActive();
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const walkingRef = useRef(walking);
  walkingRef.current = walking;
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useEffect(() => {
    if (active && !available) leavePhotoMode();
  }, [active, available]);

  useEffect(() => {
    if (!active) return undefined;
    onEnterRef.current();
    const root = document.documentElement;
    root.setAttribute(PHOTO_ATTRIBUTE, '');
    // The shot is the scene, centred: drop the projection shift that keeps
    // the house clear of the (now hidden) HUD, and put it back after.
    const camera = cameraRef.current;
    const view = camera?.view?.enabled ? { ...camera.view } : null;
    if (camera && view) camera.clearViewOffset();
    const showGrids = hideGrids(sceneRef.current);
    invalidateRef.current();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) leavePhotoMode();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const bar = target?.closest('.pc-photo-bar') ?? null;
      if (photoKeyPasses(event, { inBar: bar !== null, onBarButton: bar !== null && target?.tagName === 'BUTTON', walking: walkingRef.current })) return;
      event.stopPropagation();
      if (event.key !== 'Tab') event.preventDefault();
    };
    // Capture on the window: ahead of every editor shortcut, the scene's
    // own keys and the walk's Escape.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      root.removeAttribute(PHOTO_ATTRIBUTE);
      showGrids();
      if (camera && view) camera.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
      invalidateRef.current();
      // Back to the control that opened photo mode.
      const opener = takePhotoFocusReturn();
      if (opener?.isConnected) opener.focus();
    };
    // The refs are stable; a mode switch is the only trigger.
  }, [active, cameraRef, sceneRef]);

  // Leaving the editor never strands the attribute or the mode.
  useEffect(() => () => leavePhotoMode(), []);

  const take = useCallback(async () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const screenRatio = renderer.getPixelRatio();
    const maxEdge = Math.min(drawsForPhone() ? PHOTO_MAX_EDGE_PHONE : PHOTO_MAX_EDGE, renderer.capabilities.maxTextureSize);
    let encoded: Promise<Blob | null>;
    // A grid the room rebuilt meanwhile stays out of the photo too.
    const showGrids = hideGrids(scene);
    try {
      renderer.setPixelRatio(photoPixelRatio(width, height, screenRatio, maxEdge));
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
      // toBlob copies the canvas now; the drawing buffer is still this frame.
      encoded = new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } finally {
      showGrids();
      renderer.setPixelRatio(screenRatio);
      renderer.setSize(width, height, false);
      invalidate();
    }
    const blob = await encoded;
    if (!blob) {
      notify('Could not save the photo — the image failed to encode.', 'error');
      return;
    }
    downloadBlob(photoFileName(houseName), blob);
  }, [rendererRef, sceneRef, cameraRef, invalidate, houseName]);

  return { active, take, leave: leavePhotoMode };
}
