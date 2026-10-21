import { useCallback, useEffect, useRef } from 'react';
import { frameInRegion, houseFrameBox, isCompactViewport, regionViewOffset } from '../lib/scene-insets';
import { OCCLUDER_SELECTOR, SHEET_SELECTOR, measureRegion } from './scene-occluders';
import type { HouseShape, Vec3 } from '../lib/scene-insets';
import type { CameraPreset } from '../lib/types';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

interface PresetView {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

const PRESETS: Record<CameraPreset, (size: number) => PresetView> = {
  iso: (size) => ({ position: [size * 0.8, size * 0.9, size * 0.8], target: [0, 0, 0] }),
  top: (size) => ({ position: [0, size * 1.6, 0.001], target: [0, 0, 0] }),
  front: (size) => ({ position: [0, size * 0.4, size * 1.4], target: [0, size * 0.3, 0] }),
  corner: (size) => ({ position: [size * 1.1, size * 0.6, -size * 0.6], target: [0, 0, 0] }),
};

export interface UseCameraPresetsOptions {
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  roomSize: number;
  /** Footprint, for framing the house on compact screens (defaults to `roomSize`). */
  roomWidth?: number;
  roomDepth?: number;
  /** Total stacked building height in metres (floors × 3). */
  buildingHeight?: number;
  /**
   * The roof while it is on screen (walls up, on the top storey or with
   * every storey shown): its rise above the eaves and its eave overhang.
   * Compact framing keeps it in view; null or absent when hidden.
   */
  roof?: HouseShape['roof'];
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate?: () => void;
  /** The 3D canvas; framing measures the HUD against it. */
  canvasRef?: React.RefObject<HTMLCanvasElement>;
  /** The orbit camera is live and on screen (scene ready, 3D view). */
  active?: boolean;
  /** First-person mode: the projection shift is dropped while it runs. */
  walkthroughActive?: boolean;
}

/** Settle time before re-framing after a resize or a HUD change. */
const REFRAME_DELAY_MS = 150;
/** Load direction: the classic (0, 8, 8) start pose, 45° down from the front. */
const LOAD_DIRECTION: Vec3 = [0, 1, 1];
/** FIT direction: the three-quarter view the desktop FIT uses. */
const FIT_DIRECTION: Vec3 = [0.6, 0.7, 0.6];
const POSE_EPSILON = 1e-3;

type FrameMode = 'load' | 'fit';

interface FramedPose {
  mode: FrameMode;
  position: Vec3;
  target: Vec3;
}

export function useCameraPresets({
  cameraRef,
  controlsRef,
  roomSize,
  roomWidth = roomSize,
  roomDepth = roomSize,
  buildingHeight = 3,
  roof = null,
  invalidate,
  canvasRef,
  active = false,
  walkthroughActive = false,
}: UseCameraPresetsOptions): {
  applyPreset(preset: CameraPreset): void;
  focusOn(target: { x: number; z: number }, distance?: number, floorY?: number): void;
  fitToRoom(): void;
} {
  // The pose the last frame-to-fit left the camera in. While the camera is
  // still there the user hasn't moved it, so a resize or a HUD change may
  // re-frame; once they orbit, pan or zoom, their view is left alone.
  const framedRef = useRef<FramedPose | null>(null);

  const applyPreset = useCallback(
    (preset: CameraPreset) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera) return;

      const view = PRESETS[preset](Math.max(2, roomSize));
      camera.position.set(view.position[0], view.position[1], view.position[2]);
      camera.lookAt(view.target[0], view.target[1], view.target[2]);

      if (controls) {
        controls.target.set(view.target[0], view.target[1], view.target[2]);
        controls.update();
      }
      invalidate?.();
    },
    [cameraRef, controlsRef, roomSize, invalidate]
  );

  const focusOn = useCallback(
    // `floorY` lifts both the camera and the orbit target onto the item's
    // floor plane — without it, focusing an upper-floor item dives the camera
    // into the storey below and frames empty floor (#126).
    (target: { x: number; z: number }, distance = 3, floorY = 0) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera) return;

      camera.position.set(target.x + distance * 0.6, floorY + distance * 0.8, target.z + distance * 0.6);
      camera.lookAt(target.x, floorY, target.z);

      if (controls) {
        controls.target.set(target.x, floorY, target.z);
        controls.update();
      }
      invalidate?.();
    },
    [cameraRef, controlsRef, invalidate]
  );

  /**
   * Frame the house. A desktop-sized window gets the classic poses: FIT's
   * three-quarter view, and on load the camera's untouched (0, 8, 8) start.
   * A compact one fits the house inside the canvas area the HUD leaves
   * visible, and shifts the projection so the house sits in its middle.
   * Returns false when nothing was framed.
   */
  const frame = useCallback(
    (mode: FrameMode): boolean => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const canvas = canvasRef?.current ?? null;
      if (!camera) return false;

      let position: Vec3;
      let target: Vec3;
      if (isCompactViewport(window.innerWidth, window.innerHeight) && canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        const { width, height, region } = measureRegion(canvas);
        const fitted = frameInRegion({
          canvasWidth: width,
          canvasHeight: height,
          region,
          fovDeg: camera.fov,
          ...houseFrameBox({ width: roomWidth, depth: roomDepth, height: buildingHeight, roof }),
          direction: mode === 'load' ? LOAD_DIRECTION : FIT_DIRECTION,
        });
        position = fitted.position;
        target = fitted.target;
        // The projection shift scales with the canvas, so it stays put
        // across later resizes (three keeps it as a fraction of fullWidth).
        if (!walkthroughActive) camera.setViewOffset(width, height, fitted.offsetX, fitted.offsetY, width, height);
      } else {
        if (mode === 'load') {
          // A desktop load keeps the camera's start pose. Only a window that
          // was framed compact and then grew goes back to it.
          if (!framedRef.current) return false;
          position = [0, 8, 8];
          target = [0, 0, 0];
        } else {
          // Frame the building diagonal plus roof headroom.
          const safeSize = Math.max(2, roomSize);
          const distance = Math.max(safeSize * 1.4, buildingHeight * 2.2);
          const targetY = buildingHeight / 2;
          position = [distance * 0.6, distance * 0.7 + targetY, distance * 0.6];
          target = [0, targetY, 0];
        }
        if (camera.view?.enabled) camera.clearViewOffset();
      }

      camera.position.set(...position);
      camera.lookAt(...target);
      if (controls) {
        controls.target.set(...target);
        controls.update();
      }
      // Read back after controls.update(), which may clamp the pose.
      framedRef.current = {
        mode,
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: controls ? [controls.target.x, controls.target.y, controls.target.z] : target,
      };
      invalidate?.();
      return true;
    },
    [cameraRef, controlsRef, canvasRef, roomSize, roomWidth, roomDepth, buildingHeight, roof, walkthroughActive, invalidate]
  );

  const fitToRoom = useCallback(() => {
    frame('fit');
  }, [frame]);

  // Latest `frame` for the long-lived listeners below.
  const frameRef = useRef(frame);
  frameRef.current = frame;

  // Frame the house once on load, then re-frame after a resize, an
  // orientation change or a HUD change (panels mounting or resizing, the
  // item sheet opening), but only while the camera still sits where the last
  // frame put it. A camera the user moved keeps its pose; a resize only
  // re-centres the projection shift on the new free region. Desktop-sized
  // windows drop the shift and keep the classic poses.
  const loadFramedRef = useRef(false);
  const requestReframeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!active || walkthroughActive) return undefined;
    const canvas = canvasRef?.current;
    if (!canvas) return undefined;

    const compact = () => isCompactViewport(window.innerWidth, window.innerHeight);
    if (!loadFramedRef.current) loadFramedRef.current = frameRef.current('load') || !compact();

    // Never move the camera under a finger: an item drag's ray plane would
    // jump, and a pinch would fight the re-frame. Pointers are tracked by id
    // so lifting one finger of a pinch doesn't count as all fingers up; work
    // that arrives meanwhile waits for the last one to lift.
    const pointers = new Set<number>();
    let timer = 0;
    let pending = false;
    // The canvas may have changed while this effect was off (2D, walkthrough).
    let resized = true;
    const clearShift = (camera: ThreeNS.PerspectiveCamera) => {
      if (!camera.view?.enabled) return;
      camera.clearViewOffset();
      invalidate?.();
    };
    const reframe = () => {
      timer = 0;
      if (pointers.size > 0) {
        pending = true;
        return;
      }
      const wasResized = resized;
      resized = false;
      const camera = cameraRef.current;
      if (!camera) return;
      if (!loadFramedRef.current) {
        loadFramedRef.current = frameRef.current('load');
        return;
      }
      const framed = framedRef.current;
      if (framed && cameraAtPose(camera, controlsRef.current, framed)) {
        frameRef.current(framed.mode);
        return;
      }
      if (!compact()) {
        clearShift(camera);
      } else if (wasResized) {
        // The user's pose stays; only the shift follows the new free region.
        const { width, height, region } = measureRegion(canvas);
        const { offsetX, offsetY } = regionViewOffset(width, height, region);
        camera.setViewOffset(width, height, offsetX, offsetY, width, height);
        invalidate?.();
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reframe, REFRAME_DELAY_MS);
    };
    requestReframeRef.current = schedule;
    schedule();

    const onResize = () => {
      resized = true;
      // A desktop-sized window never shows a shifted projection, not even
      // for the settle delay.
      const camera = cameraRef.current;
      if (camera && !compact()) clearShift(camera);
      schedule();
    };
    const onPointerDown = (event: PointerEvent) => {
      pointers.add(event.pointerId);
    };
    const release = () => {
      if (pointers.size > 0 || !pending) return;
      pending = false;
      schedule();
    };
    const onPointerEnd = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      release();
    };
    // A pointerup lost to another window must not hold re-framing off forever.
    const onBlur = () => {
      pointers.clear();
      release();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('lostpointercapture', onPointerEnd, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);

    // The canvas and every occluder: panels resize on a mode switch or when
    // the sheet expands.
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.some((entry) => entry.target === canvas)) resized = true;
      schedule();
    });
    resizeObserver.observe(canvas);
    let observed: Element[] = [];
    const syncOccluders = () => {
      if (!compact()) return;
      const now = [...document.querySelectorAll(`${OCCLUDER_SELECTOR}, ${SHEET_SELECTOR}`)];
      if (now.length === observed.length && now.every((el, i) => el === observed[i])) return;
      for (const el of observed) resizeObserver.unobserve(el);
      for (const el of now) resizeObserver.observe(el);
      observed = now;
      schedule();
    };
    syncOccluders();
    // Panels mounting, unmounting or being tagged. The callback only
    // compares element lists; measuring waits for the timer.
    const mountObserver = new MutationObserver(syncOccluders);
    mountObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-scene-occluder'] });
    const sheetObserver = new MutationObserver(schedule);
    sheetObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sheet-open'] });

    return () => {
      window.clearTimeout(timer);
      requestReframeRef.current = null;
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerEnd, true);
      window.removeEventListener('pointercancel', onPointerEnd, true);
      window.removeEventListener('lostpointercapture', onPointerEnd, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      mountObserver.disconnect();
      sheetObserver.disconnect();
    };
  }, [active, walkthroughActive, canvasRef, cameraRef, controlsRef, invalidate]);

  // The house's framed size changed (walls up showing the roof, a storey
  // added, the footprint resized): re-frame an untouched camera.
  const roofPeak = roof?.peak ?? 0;
  const roofOverhang = roof?.overhang ?? 0;
  const firstShapeRef = useRef(true);
  useEffect(() => {
    if (firstShapeRef.current) {
      firstShapeRef.current = false;
      return;
    }
    requestReframeRef.current?.();
  }, [roomWidth, roomDepth, buildingHeight, roofPeak, roofOverhang]);

  // First-person view looks straight ahead: drop the projection shift while
  // the walkthrough runs and put it back after.
  useEffect(() => {
    const camera = cameraRef.current;
    if (!walkthroughActive || !camera?.view?.enabled) return undefined;
    const { fullWidth, fullHeight, offsetX, offsetY, width, height } = camera.view;
    camera.clearViewOffset();
    invalidate?.();
    return () => {
      camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, width, height);
      invalidate?.();
    };
  }, [walkthroughActive, cameraRef, invalidate]);

  return { applyPreset, focusOn, fitToRoom };
}

function cameraAtPose(
  camera: ThreeNS.PerspectiveCamera | null,
  controls: OrbitControlsType | null,
  pose: FramedPose
): boolean {
  if (!camera) return false;
  const near = (v: { x: number; y: number; z: number }, p: Vec3) =>
    Math.abs(v.x - p[0]) < POSE_EPSILON && Math.abs(v.y - p[1]) < POSE_EPSILON && Math.abs(v.z - p[2]) < POSE_EPSILON;
  return near(camera.position, pose.position) && (!controls || near(controls.target, pose.target));
}
