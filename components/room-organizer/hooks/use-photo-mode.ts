import { useCallback, useEffect, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import { answerConfirm, askConfirm, confirmOpen, newestConfirmId } from '../lib/confirm-dialog';
import { notify } from '../lib/editor-notices';
import {
  PHOTO_MAX_EDGE,
  PHOTO_MAX_EDGE_PHONE,
  isPhotoMode,
  leavePhotoMode,
  photoFileName,
  photoKeyPasses,
  photoPixelRatio,
  runPhotoEscape,
  subscribePhotoMode,
  takePhotoFocusReturn,
} from '../lib/photo-mode';
import { downloadBlob } from '../lib/plan-export/download';
import { drawsForPhone } from '../three/texture-settings';
import type { AlbumSaveResult } from '../lib/photo-album';
import type { ShotConditions } from '../lib/photo-presets';
import type { CameraPreset, Weather } from '../lib/types';
import type * as ThreeNS from 'three';

/** The HUD hides under this attribute on `<html>` (app/globals.css). */
const PHOTO_ATTRIBUTE = 'data-photo';

/**
 * One stay in photo mode, for a save to the album that outlives it (#912):
 * once it ends, the save stops and its question is withdrawn.
 */
interface PhotoSession {
  ended: boolean;
  /** Withdraw the question this session is asking, if any. */
  withdraw: (() => void) | null;
}

/**
 * Hide the snap grid, an editing aid, not part of the house; returns the
 * undo. Through its layers, not `visible`: the cutaway pass
 * (`applyWallDisplay`) shows the grid again on every camera move, so an
 * orbit or a preset in photo mode brought it back on screen.
 */
function hideGrids(scene: ThreeNS.Object3D | null): () => void {
  const grids = gridHider(scene);
  return grids.show;
}

/**
 * The snap grids hidden so far: `hide` hides any not yet hidden (a room
 * rebuild makes a new one), `show` gives every one back its layers.
 */
function gridHider(scene: ThreeNS.Object3D | null): { hide(): void; show(): void } {
  const hidden = new Map<ThreeNS.Object3D, number>();
  const hide = () => {
    for (const child of scene?.children ?? []) {
      if (child.type === 'GridHelper' && child.layers.mask !== 0) {
        hidden.set(child, child.layers.mask);
        child.layers.mask = 0;
      }
    }
  };
  hide();
  return {
    hide,
    show() {
      for (const [child, mask] of hidden) child.layers.mask = mask;
      hidden.clear();
    },
  };
}

type BeforeRender = ThreeNS.Object3D['onBeforeRender'];

/**
 * Keep the snap grid hidden for as long as photo mode lasts, a grid a room
 * rebuild adds meanwhile too: checked as each frame starts, before three
 * sorts what to draw. Returns the undo, which shows every grid it hid.
 */
function keepGridsHidden(scene: ThreeNS.Object3D | null): () => void {
  const grids = gridHider(scene);
  if (!scene) return grids.show;
  const own = Object.hasOwn(scene, 'onBeforeRender');
  const previous: BeforeRender | undefined = scene.onBeforeRender;
  const onBeforeRender: BeforeRender = function (this: ThreeNS.Object3D, ...args) {
    grids.hide();
    previous?.apply(this, args);
  };
  scene.onBeforeRender = onBeforeRender;
  return () => {
    if (scene.onBeforeRender === onBeforeRender) {
      // Back to the prototype's no-op, or to whatever was set before.
      if (own && previous) scene.onBeforeRender = previous;
      else Reflect.deleteProperty(scene, 'onBeforeRender');
    }
    grids.show();
  };
}

export interface UsePhotoModeOptions {
  /** Photo mode is 3D only: it ends when the plan shows or the scene isn't up. */
  available: boolean;
  houseName: string;
  /** `layout.id`: the album keeps photos per house (#912). */
  houseId: string | undefined;
  /** The scene's hour and weather as the photo is taken, kept with it. */
  readConditions(): { hour: number; weather: Weather };
  rendererRef: MutableRefObject<ThreeNS.WebGLRenderer | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  cameraRef: MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  invalidate(): void;
  /** Keys still reach the walk while walking (it edits nothing); otherwise only the shutter's own. */
  walking: boolean;
  /** Runs as photo mode starts: a selection outline has no place in a photo. */
  onEnter(): void;
  /**
   * W4 shot presets (#912): the scene's hour, weather and clock, read and
   * set (view settings, never the house), and the camera presets. Absent,
   * the shutter offers no presets.
   */
  shot?: ShotControls;
}

/** What a shot preset reaches in the editor. */
export interface ShotControls {
  read(): ShotConditions;
  write(conditions: ShotConditions): void;
  /** Glide to a camera preset (the orbit camera; skipped while walking). */
  frame(camera: CameraPreset): void;
}

/** Whether photo mode is on, for the scene's `orbitOnly` (read before the scene exists). */
export function usePhotoModeActive(): boolean {
  return useSyncExternalStore(subscribePhotoMode, isPhotoMode, () => false);
}

export interface PhotoMode {
  active: boolean;
  /** Save the scene as it shows now, at twice its resolution. */
  take(): Promise<void>;
  /** Take one and keep it in the house's album (#912); null when nothing was captured. */
  keep(): Promise<AlbumSaveResult | null>;
  /**
   * Set a shot (#912): its hour and weather, and its camera unless walking.
   * Photo mode puts the scene's own hour, weather and clock back as it
   * ends. Null when the editor gave no `shot` controls.
   */
  shoot: ((conditions: ShotConditions, camera: CameraPreset) => void) | null;
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
  houseId,
  readConditions,
  rendererRef,
  sceneRef,
  cameraRef,
  invalidate,
  walking,
  onEnter,
  shot,
}: UsePhotoModeOptions): PhotoMode {
  const active = usePhotoModeActive();
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const walkingRef = useRef(walking);
  walkingRef.current = walking;
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const readConditionsRef = useRef(readConditions);
  readConditionsRef.current = readConditions;
  const sessionRef = useRef<PhotoSession>({ ended: true, withdraw: null });
  // W4 shot presets (#912): the controls, and the scene before this stay's first preset.
  const shotRef = useRef(shot);
  shotRef.current = shot;
  const beforeShotRef = useRef<ShotConditions | null>(null);
  const hasShot = shot !== undefined;

  useEffect(() => {
    if (active && !available) leavePhotoMode();
  }, [active, available]);

  useEffect(() => {
    if (!active) return undefined;
    onEnterRef.current();
    const session: PhotoSession = { ended: false, withdraw: null };
    sessionRef.current = session;
    const root = document.documentElement;
    root.setAttribute(PHOTO_ATTRIBUTE, '');
    // The shot is the scene, centred: drop the projection shift that keeps
    // the house clear of the (now hidden) HUD, and put it back after.
    const camera = cameraRef.current;
    const view = camera?.view?.enabled ? { ...camera.view } : null;
    if (camera && view) camera.clearViewOffset();
    const showGrids = keepGridsHidden(sceneRef.current);
    invalidateRef.current();
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (confirmOpen()) {
        // A question (the album's, #912) answers its own keys. Escape and
        // Tab are its document listener's wherever focus is (a backdrop
        // click can leave it on <body>); any other key outside the dialog
        // would reach the house's shortcuts unseen, so it stops here.
        if (event.key === 'Escape' || event.key === 'Tab' || target?.closest('[data-confirm-dialog]')) return;
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        // The open album closes first; a second Escape leaves.
        if (!event.repeat && !runPhotoEscape()) leavePhotoMode();
        return;
      }
      const bar = target?.closest('.pc-photo-bar') ?? null;
      if (photoKeyPasses(event, { inBar: bar !== null, onBarButton: bar !== null && target?.tagName === 'BUTTON', walking: walkingRef.current })) return;
      event.stopPropagation();
      if (event.key !== 'Tab') event.preventDefault();
    };
    // Capture on the window: ahead of every editor shortcut, the scene's
    // own keys and the walk's Escape.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      // A save still running stops, and its question goes with the mode.
      session.ended = true;
      session.withdraw?.();
      // The scene's own hour, weather and clock come back after a preset.
      const before = beforeShotRef.current;
      beforeShotRef.current = null;
      if (before) shotRef.current?.write(before);
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

  const capture = useCallback(async (): Promise<Blob | null> => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return null;
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return null;
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
    if (!blob) notify('Could not save the photo — the image failed to encode.', 'error');
    return blob;
  }, [rendererRef, sceneRef, cameraRef, invalidate]);

  const take = useCallback(async () => {
    const blob = await capture();
    if (blob) downloadBlob(photoFileName(houseName), blob);
  }, [capture, houseName]);

  const keep = useCallback(async (): Promise<AlbumSaveResult | null> => {
    if (!houseId) return null;
    const session = sessionRef.current;
    if (session.ended) return null;
    // The scene as the shutter fires, not as the encode finishes.
    const { hour, weather } = readConditionsRef.current();
    const takenAt = Date.now();
    const [album, png] = await Promise.all([import('../lib/photo-album'), capture()]);
    if (!png || session.ended) return session.ended ? { kind: 'cancelled' } : null;
    const copy = await album.encodeForAlbum(png);
    if (session.ended) return { kind: 'cancelled' };
    const ask = (count: number): Promise<boolean> => {
      const answer = askConfirm({
        title: `The album keeps ${album.ALBUM_CAP} photos of each house`,
        body: count === 1 ? 'Keeping this one removes the oldest photo.' : `Keeping this one removes the ${count} oldest photos.`,
        confirmLabel: 'Keep and remove',
        danger: true,
      });
      const id = newestConfirmId();
      session.withdraw = id === null ? null : () => answerConfirm(id, false);
      return answer.finally(() => {
        session.withdraw = null;
      });
    };
    return album.keepInAlbum({ id: album.newPhotoId(takenAt), houseId, takenAt, hour, weather, ...copy }, ask, {
      stopped: () => session.ended,
    });
  }, [capture, houseId]);

  const shoot = useCallback((conditions: ShotConditions, camera: CameraPreset) => {
    const controls = shotRef.current;
    if (!controls || sessionRef.current.ended) return;
    // Only the first preset notes the scene: leaving goes back past all of them.
    beforeShotRef.current ??= controls.read();
    controls.write(conditions);
    // Walking, the camera is the walker's eyes: a preset sets the light only.
    if (!walkingRef.current) controls.frame(camera);
    invalidateRef.current();
  }, []);

  return { active, take, keep, shoot: hasShot ? shoot : null, leave: leavePhotoMode };
}
