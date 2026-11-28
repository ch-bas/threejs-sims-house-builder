import { useCallback, useEffect, useRef } from 'react';
import { cameraTweenDuration, createCameraTween, samePose, storeySlidePose } from '../lib/camera-tween';
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR } from '../lib/camera-zoom';
import { ORBIT_LENS_SCALE, ORBIT_MAX_POLAR, ORBIT_START, focusOffset, frameInRegion, houseFrameBox, isCompactViewport, regionViewOffset } from '../lib/scene-insets';
import { OCCLUDER_SELECTOR, SHEET_SELECTOR, measureRegion } from './scene-occluders';
import { useEvent } from './use-event';
import { useReducedMotion } from './use-reduced-motion';
import type { FrameJob } from './use-three-scene';
import type { CameraPose } from '../lib/camera-tween';
import type { FocusCover, HouseShape, Vec3 } from '../lib/scene-insets';
import type { CameraPreset } from '../lib/types';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

interface PresetView {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

/** Stand back from the target by the lens scale: the same view at the same size. */
function throughLens({ position, target }: PresetView): PresetView {
  const back = (axis: 0 | 1 | 2) => target[axis] + (position[axis] - target[axis]) * ORBIT_LENS_SCALE;
  return { position: [back(0), back(1), back(2)], target };
}

const PRESETS: Record<CameraPreset, (size: number) => PresetView> = {
  iso: (size) => throughLens({ position: [size * 0.8, size * 0.9, size * 0.8], target: [0, 0, 0] }),
  top: (size) => throughLens({ position: [0, size * 1.6, 0.001], target: [0, 0, 0] }),
  front: (size) => throughLens({ position: [0, size * 0.4, size * 1.4], target: [0, size * 0.3, 0] }),
  corner: (size) => throughLens({ position: [size * 1.1, size * 0.6, -size * 0.6], target: [0, 0, 0] }),
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
  /**
   * The render loop's one-off frame jobs (#930). With it, presets, Fit and
   * Focus ease into place; without it (or with reduced motion) they cut.
   */
  addFrameJob?: (job: FrameJob) => () => void;
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

/** How to frame a focused item. */
export interface FocusView {
  /** World Y of the item's floor. */
  floorY?: number;
  /** The item's largest side, metres. */
  size?: number;
  /** The storey around it, when something is drawn above it. */
  cover?: FocusCover | null;
}

interface Glide {
  end: CameraPose;
  /** A frame-to-fit's mode; null for a preset or a focus. */
  frameMode: FrameMode | null;
  arrive: (() => void) | undefined;
  /** Stop where it is. */
  stop(): void;
  /** Land on the end pose now. */
  finish(): void;
}

/** Each camera's move in flight, for the other code that moves it. */
const glides = new WeakMap<object, Glide>();
/** Each mounted camera hook's way to move its camera, for the floor switch. */
const movers = new WeakMap<object, (end: CameraPose, eased: boolean) => void>();

/**
 * Land an eased camera move (#930) at its end pose now. Anything else that
 * moves the orbit camera (the pad, the touch zoom, the walkthrough taking
 * it) calls this first, so the glide's next frame doesn't write over it.
 */
export function settleCameraMove(controls: object | null): void {
  if (controls) glides.get(controls)?.finish();
}

/**
 * Where the camera is headed: the end of the move in flight, or null when
 * it sits still. The lamp pool picks its lamps around the end target, so a
 * floor switch lights the new storey as it arrives, not the old one.
 */
export function cameraMoveEnd(controls: object | null): CameraPose | null {
  return controls ? (glides.get(controls)?.end ?? null) : null;
}

/**
 * Take the orbit camera to `end` through its camera hook: eased when asked
 * and motion is welcome (3D on screen, no walkthrough, no reduced motion),
 * else at once. Input on the scene lands it rather than stopping it half
 * way. False when no hook drives these controls: the caller cuts.
 */
export function glideCameraTo(controls: object | null, end: CameraPose, eased: boolean): boolean {
  const move = controls ? movers.get(controls) : undefined;
  if (!move) return false;
  move(end, eased);
  return true;
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
  addFrameJob,
}: UseCameraPresetsOptions): {
  applyPreset(preset: CameraPreset): void;
  focusOn(target: { x: number; z: number }, view?: FocusView): void;
  fitToRoom(): void;
} {
  // The pose the last frame-to-fit left the camera in. While the camera is
  // still there the user hasn't moved it, so a resize or a HUD change may
  // re-frame; once they orbit, pan or zoom, their view is left alone.
  const framedRef = useRef<FramedPose | null>(null);

  // The eased move in flight, if any (#930).
  const reducedMotion = useReducedMotion();
  const glideRef = useRef<Glide | null>(null);
  /** Stop the move where it is: the player took the camera. */
  const stopTween = useCallback(() => {
    glideRef.current?.stop();
  }, []);
  /** Put the move's end pose on now: something else is about to use the camera. */
  const settleTween = useCallback(() => {
    glideRef.current?.finish();
  }, []);

  /**
   * Take the camera to `end`: at once, or eased along an arc when `eased`
   * and motion is welcome. The end pose goes on exactly as a cut puts it
   * (controls update, ground clearance and all), then `arrive` runs.
   * `frameMode` marks a frame-to-fit, which a resize mid-move frames again.
   *
   * A pointer down, a wheel or a key on the scene stops the move where it
   * is: the player has the camera. Any other press or key lands it at once,
   * before the button or key acts (the pad, a floor switch, 2D, EXPLORE),
   * and so do `settleCameraMove` callers. A new move starts where the old
   * one stopped. `mustLand`: a floor switch, which the player's input lands
   * instead of stopping, or the orbit target would stay between storeys.
   * A held key's repeats leave the move alone.
   */
  const moveCamera = useCallback(
    (end: CameraPose, eased: boolean, arrive?: () => void, frameMode: FrameMode | null = null, mustLand = false) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera) return;
      const current = glideRef.current;
      // The same move asked again (a re-frame that lands where this one
      // goes): let it run on.
      if (eased && current && samePose(current.end, end)) {
        current.arrive = arrive;
        return;
      }
      current?.stop();
      const place = (then?: () => void) => {
        placeCamera(camera, controls, end);
        then?.();
        invalidate?.();
      };
      const from: CameraPose | null = controls
        ? { position: [camera.position.x, camera.position.y, camera.position.z], target: [controls.target.x, controls.target.y, controls.target.z] }
        : null;
      const duration = eased && from && addFrameJob && !walkthroughActive ? cameraTweenDuration(from, end, reducedMotion) : 0;
      if (!from || !controls || !addFrameJob || duration === 0) {
        place(arrive);
        return;
      }
      const tween = createCameraTween(from, end, performance.now(), duration);
      const canvas = canvasRef?.current ?? null;
      const onScene = (event: Event) => canvas !== null && event.target instanceof Node && canvas.contains(event.target);
      const interrupt = () => {
        if (mustLand) glide.finish();
        else glide.stop();
      };
      const onInput = (event: Event) => {
        // A held key (PageUp) would otherwise cut the move short.
        if (event instanceof KeyboardEvent && event.repeat) return;
        if (onScene(event)) interrupt();
        else glide.finish();
      };
      const onWheel = () => interrupt();
      let removeJob: (() => void) | null = null;
      const end_ = () => {
        removeJob?.();
        window.removeEventListener('pointerdown', onInput, true);
        window.removeEventListener('keydown', onInput, true);
        canvas?.removeEventListener('wheel', onWheel, true);
        if (glides.get(controls) === glide) glides.delete(controls);
        if (glideRef.current === glide) glideRef.current = null;
      };
      const glide: Glide = {
        end,
        frameMode,
        arrive,
        stop: end_,
        finish: () => {
          end_();
          place(glide.arrive);
        },
      };
      removeJob = addFrameJob((now) => {
        const { pose, done } = tween.sample(now);
        if (done) {
          glide.finish();
          return false;
        }
        // The loop's controls.update() aims the camera right after this.
        camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
        controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
        return true;
      });
      // Capture: ahead of the button or shortcut the press or key is for.
      window.addEventListener('pointerdown', onInput, true);
      window.addEventListener('keydown', onInput, true);
      canvas?.addEventListener('wheel', onWheel, { capture: true, passive: true });
      glides.set(controls, glide);
      glideRef.current = glide;
    },
    [cameraRef, controlsRef, canvasRef, addFrameJob, walkthroughActive, reducedMotion, invalidate]
  );

  // The floor switch moves the camera through this hook (glideCameraTo):
  // eased only while the orbit camera is on screen.
  const moveRef = useRef(moveCamera);
  moveRef.current = moveCamera;
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return undefined;
    const move = (end: CameraPose, eased: boolean) => moveRef.current(end, eased && activeRef.current, undefined, null, true);
    movers.set(controls, move);
    return () => {
      if (movers.get(controls) === move) movers.delete(controls);
    };
  }, [active, controlsRef]);

  // The 2D plan hides the camera and the walkthrough takes it: a move in
  // flight lands at once rather than freezing half-way. Unmounting stops it.
  useEffect(() => {
    if (!active || walkthroughActive) settleTween();
  }, [active, walkthroughActive, settleTween]);
  useEffect(() => stopTween, [stopTween]);

  const applyPreset = useCallback(
    (preset: CameraPreset) => {
      moveCamera(PRESETS[preset](Math.max(2, roomSize)), true);
    },
    [moveCamera, roomSize]
  );

  const focusOn = useCallback(
    // `floorY` lifts both the camera and the orbit target onto the item's
    // floor plane — without it, focusing an upper-floor item dives the camera
    // into the storey below and frames empty floor (#126).
    (target: { x: number; z: number }, { floorY = 0, size = 1, cover = null }: FocusView = {}) => {
      const [x, y, z] = focusOffset(target, size, cover);
      moveCamera({ position: [target.x + x, floorY + y, target.z + z], target: [target.x, floorY, target.z] }, true);
    },
    [moveCamera]
  );

  /**
   * Frame the house. A desktop-sized window gets the classic poses: FIT's
   * three-quarter view, and on load the camera's untouched (0, 8, 8) start.
   * A compact one fits the house inside the canvas area the HUD leaves
   * visible, and shifts the projection so the house sits in its middle.
   * Returns false when nothing was framed. `eased`: the player asked for
   * it (Fit), so the camera glides there; re-framing after a resize cuts.
   */
  const frame = useCallback(
    (mode: FrameMode, eased = false): boolean => {
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
          position = ORBIT_START;
          target = [0, 0, 0];
        } else {
          // Frame the building diagonal plus roof headroom.
          const safeSize = Math.max(2, roomSize);
          const distance = Math.max(safeSize * 1.4, buildingHeight * 2.2) * ORBIT_LENS_SCALE;
          const targetY = buildingHeight / 2;
          position = [distance * 0.6, distance * 0.7 + targetY, distance * 0.6];
          target = [0, targetY, 0];
        }
        if (camera.view?.enabled) camera.clearViewOffset();
      }

      moveCamera(
        { position, target },
        eased,
        () => {
          // Read back after controls.update(), which may clamp the pose.
          framedRef.current = {
            mode,
            position: [camera.position.x, camera.position.y, camera.position.z],
            target: controls ? [controls.target.x, controls.target.y, controls.target.z] : target,
          };
        },
        mode
      );
      return true;
    },
    [cameraRef, controlsRef, canvasRef, roomSize, roomWidth, roomDepth, buildingHeight, roof, walkthroughActive, moveCamera]
  );

  const fitToRoom = useCallback(() => {
    frame('fit', true);
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
      // A Fit still gliding frames again for the new size, from where it is.
      const gliding = glideRef.current?.frameMode ?? null;
      if (gliding) {
        frameRef.current(gliding, true);
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

export interface UseCameraTargetOnStoreyOptions {
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  /** Mid-height of the active storey, world Y. */
  targetY: number;
  /** Which storey is active: a change is a floor switch, which glides. */
  floorIndex: number;
  walkthroughActive: boolean;
  invalidate: () => void;
}

/**
 * Slide the camera target to mid-height of the active storey: on a floor
 * switch, and when a storey height below or on it changes (#202). The
 * scene effects run this ahead of their own, so the lamp pool is assigned
 * around the new storey's target, not the old one (#393): mid-glide it
 * reads the glide's end (cameraMoveEnd).
 *
 * A floor switch glides there (#930); a height edit, reduced motion and the
 * 2D plan cut, as before. The ghosting of the other storeys changes at
 * once with the switch: the glide only moves the camera, and its frames
 * draw after the scene effects rebuilt the new floor (#216).
 */
export function useCameraTargetOnStorey({ cameraRef, controlsRef, targetY, floorIndex, walkthroughActive, invalidate }: UseCameraTargetOnStoreyOptions): void {
  const floorRef = useRef(floorIndex);
  useEffect(() => {
    const switched = floorRef.current !== floorIndex;
    floorRef.current = floorIndex;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    // An eased move lands first: the slide starts from its end pose.
    settleCameraMove(controls);
    const dy = targetY - controls.target.y;
    if (Math.abs(dy) < 0.01) return;
    // Keep the orbit target on the new storey even mid-walkthrough, so the
    // orbit camera aims right after an exit — but never touch the camera or
    // run controls.update() while walkthrough owns it: update() has no
    // `enabled` guard, so it re-aims the first-person camera at the orbit
    // target and clamps it back into the polar cone (#114/#216). Walkthrough
    // owns its own eye height.
    if (walkthroughActive) {
      controls.target.y = targetY;
    } else {
      const from: CameraPose = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
      if (!glideCameraTo(controls, storeySlidePose(from, targetY), switched)) {
        controls.target.y = targetY;
        camera.position.y += dy;
        controls.update();
      }
    }
    // Defer painting to the next frame via invalidate(): a synchronous
    // renderer.render here ran BEFORE the scene effects rebuilt the new
    // floor, flashing the old floor's contents from the new camera (#216).
    invalidate();
  }, [targetY, floorIndex, walkthroughActive, cameraRef, controlsRef, invalidate]);
}

/** Put a pose on the camera at once: every move's end, and the whole move before #930. */
function placeCamera(camera: ThreeNS.PerspectiveCamera, controls: OrbitControlsType | null, { position, target }: CameraPose): void {
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(target[0], target[1], target[2]);
  if (controls) {
    controls.target.set(target[0], target[1], target[2]);
    controls.update();
  }
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

export type OrbitDirection = 'left' | 'right' | 'up' | 'down';

/** One step of the camera pad's orbit about the target. */
export function orbitCamera(
  THREE: typeof import('../three/three-runtime'),
  camera: ThreeNS.PerspectiveCamera,
  controls: OrbitControlsType,
  direction: OrbitDirection
): void {
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  const step = 0.22;
  switch (direction) {
    case 'left':
      spherical.theta += step;
      break;
    case 'right':
      spherical.theta -= step;
      break;
    case 'up':
      spherical.phi = Math.max(0.15, spherical.phi - step / 2);
      break;
    case 'down':
      spherical.phi = Math.min(ORBIT_MAX_POLAR, spherical.phi + step / 2);
      break;
  }
  offset.setFromSpherical(spherical);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

/** One step of the camera pad's zoom towards or away from the target. */
export function zoomCamera(
  camera: ThreeNS.PerspectiveCamera,
  controls: OrbitControlsType,
  direction: '+' | '-'
): void {
  const offset = camera.position.clone().sub(controls.target);
  const factor = direction === '+' ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
  offset.multiplyScalar(factor);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

export interface UseCameraPadOptions {
  threeModuleRef: React.MutableRefObject<typeof import('../three/three-runtime') | null>;
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  invalidate: () => void;
}

/** The on-screen camera pad's orbit and zoom, with stable identities for the memoised HUD. */
export function useCameraPad({ threeModuleRef, cameraRef, controlsRef, invalidate }: UseCameraPadOptions): {
  orbitByPad: (direction: OrbitDirection) => void;
  zoomByPad: (direction: '+' | '-') => void;
} {
  const orbitByPad = useEvent((direction: OrbitDirection) => {
    const THREE = threeModuleRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!THREE || !camera || !controls) return;
    settleCameraMove(controls);
    orbitCamera(THREE, camera, controls, direction);
    // controls.update() above consumes the move, so the RAF loop won't
    // see it; mark the frame dirty explicitly (#337).
    invalidate();
  });
  const zoomByPad = useEvent((direction: '+' | '-') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    settleCameraMove(controls);
    zoomCamera(camera, controls, direction);
    invalidate();
  });
  return { orbitByPad, zoomByPad };
}
