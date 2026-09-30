import { useEffect, useMemo, useRef } from 'react';
import { buildWalkColliders, resolveWalkerStep } from '../lib/walk-collision';
import type { FurnitureItem, InteriorWall } from '../lib/types';
import type { WalkCollider, WalkCollisionOptions, WalkerPosition } from '../lib/walk-collision';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PointerLockControls as PointerLockControlsType } from 'three/examples/jsm/controls/PointerLockControls.js';

type ThreeModule = typeof import('three');

const NO_ITEMS: readonly FurnitureItem[] = [];
const NO_WALLS: readonly InteriorWall[] = [];

export interface UseWalkthroughOptions {
  enabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  orbitRef: React.MutableRefObject<OrbitControlsType | null>;
  eyeHeight?: number;
  walkSpeed?: number;
  /** Room footprint (metres) used to clamp the walker inside the walls. */
  roomWidth?: number;
  roomDepth?: number;
  /** The active floor's furniture and partitions the walker collides with (#156). */
  items?: readonly FurnitureItem[];
  interiorWalls?: readonly InteriorWall[];
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate?: () => void;
  /**
   * Called when the user presses Escape a second time (while pointer lock is
   * already released) to leave walkthrough entirely (see #67). The first Esc is
   * browser-reserved and only exits pointer lock.
   */
  onExit?: () => void;
}

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

// Keep the walker a little inside the exterior walls so the camera never clips
// through them or steps off the floor plate. Furniture and interior walls are
// solid via lib/walk-collision (#156); this footprint clamp stays the outer
// guard for the exterior walls (see #67).
const WALL_MARGIN = 0.35;
// Shoulder-width walker: wide enough that the camera's near plane never pokes
// into a sofa, narrow enough to fit a 0.8 m doorway with room to spare (#156).
const WALKER_RADIUS = 0.3;

/**
 * First-person walkthrough mode using PointerLockControls.
 *
 * When `enabled` flips on, this hook:
 *  - Disables the orbit controls.
 *  - Lazy-loads PointerLockControls and attaches them to the canvas.
 *  - Moves the camera to eye level and listens for WASD / arrow movement,
 *    with Shift for sprint.
 *  - Slides the walker around furniture and interior walls (#156) and clamps
 *    it to the room footprint so it can't leave the plate.
 *  - On disable / unmount, restores orbit controls and the camera pose.
 *
 * `eyeHeight` (which tracks the active floor) is read live from a ref so a floor
 * switch mid-walk only re-seats the camera's height — it never tears the mode
 * down and drops pointer lock (see #67).
 */
export function useWalkthrough(options: UseWalkthroughOptions): void {
  const {
    enabled,
    canvasRef,
    threeModuleRef,
    cameraRef,
    orbitRef,
    eyeHeight = 1.6,
    walkSpeed = 3.0,
    roomWidth = Infinity,
    roomDepth = Infinity,
    items = NO_ITEMS,
    interiorWalls = NO_WALLS,
    invalidate,
    onExit,
  } = options;

  // Colliders are rebuilt only when the floor's contents change, never per
  // frame (#156). Outside walkthrough the memo is skipped entirely.
  const colliders = useMemo<readonly WalkCollider[]>(
    () => (enabled ? buildWalkColliders(items, interiorWalls, { roomWidth, roomDepth }) : []),
    [enabled, items, interiorWalls, roomWidth, roomDepth]
  );

  // Live values the RAF loop / Esc handler read without re-running the init
  // effect (which would drop pointer lock). Updated every render.
  const eyeHeightRef = useRef(eyeHeight);
  const walkSpeedRef = useRef(walkSpeed);
  const roomWidthRef = useRef(roomWidth);
  const roomDepthRef = useRef(roomDepth);
  const collidersRef = useRef(colliders);
  const invalidateRef = useRef(invalidate);
  const onExitRef = useRef(onExit);
  eyeHeightRef.current = eyeHeight;
  walkSpeedRef.current = walkSpeed;
  roomWidthRef.current = roomWidth;
  roomDepthRef.current = roomDepth;
  collidersRef.current = colliders;
  invalidateRef.current = invalidate;
  onExitRef.current = onExit;

  // Re-seat the camera's height when the active floor (eyeHeight) changes while
  // walking, preserving x/z. Deliberately separate from the init effect so a
  // floor switch never re-inits and drops pointer lock (see #67).
  useEffect(() => {
    if (!enabled) return;
    const camera = cameraRef.current;
    if (!camera) return;
    camera.position.y = eyeHeight;
    invalidateRef.current?.();
  }, [enabled, eyeHeight, cameraRef]);

  useEffect(() => {
    if (!enabled) return undefined;

    const canvas = canvasRef.current;
    const THREE = threeModuleRef.current;
    const camera = cameraRef.current;
    if (!canvas || !THREE || !camera) return undefined;

    const orbit = orbitRef.current;
    if (orbit) orbit.enabled = false;

    const cleanup: Array<() => void> = [];
    const pressed = new Set<string>();
    let cancelled = false;
    let controls: PointerLockControlsType | null = null;
    let savedCameraPosition: ThreeNS.Vector3 | null = null;
    let rafId = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      if (MOVEMENT_KEYS.has(event.code)) pressed.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code);
    // Escape exit: the browser reserves the first Escape to release pointer
    // lock, so we only act on an Escape received while already unlocked — that
    // second press leaves walkthrough mode entirely (see #67).
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (controls?.isLocked) return;
      onExitRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onEscape);
    cleanup.push(() => window.removeEventListener('keydown', onKeyDown));
    cleanup.push(() => window.removeEventListener('keyup', onKeyUp));
    cleanup.push(() => window.removeEventListener('keydown', onEscape));

    const clampToFootprint = (): void => {
      const halfW = roomWidthRef.current / 2 - WALL_MARGIN;
      const halfD = roomDepthRef.current / 2 - WALL_MARGIN;
      if (Number.isFinite(halfW) && halfW > 0) {
        camera.position.x = Math.max(-halfW, Math.min(halfW, camera.position.x));
      }
      if (Number.isFinite(halfD) && halfD > 0) {
        camera.position.z = Math.max(-halfD, Math.min(halfD, camera.position.z));
      }
    };

    void (async () => {
      const controlsModule = await import('three/examples/jsm/controls/PointerLockControls.js');
      if (cancelled) return;

      controls = new controlsModule.PointerLockControls(camera, canvas);
      savedCameraPosition = camera.position.clone();
      camera.position.set(0, eyeHeightRef.current, 3);
      camera.lookAt(0, eyeHeightRef.current, 0);
      clampToFootprint();

      const requestLock = () => controls?.lock();
      canvas.addEventListener('click', requestLock);
      cleanup.push(() => canvas.removeEventListener('click', requestLock));
      // A keyup fired in another window never reaches us: Alt/Cmd-Tab (blur)
      // and any pointer-lock release strand held codes in `pressed`, and the
      // walker auto-marches on return until the key is tapped again (#216).
      // Drop every held key whenever focus or the lock is lost.
      const releaseHeldKeys = () => pressed.clear();
      window.addEventListener('blur', releaseHeldKeys);
      cleanup.push(() => window.removeEventListener('blur', releaseHeldKeys));
      controls.addEventListener('unlock', releaseHeldKeys);
      cleanup.push(() => controls?.removeEventListener('unlock', releaseHeldKeys));
      // Release pointer lock BEFORE disconnecting: an exit path that tears the
      // mode down while still locked would otherwise leave the cursor captured
      // with no mousemove handler attached (#114). No-op when already unlocked.
      cleanup.push(() => controls?.unlock());
      cleanup.push(() => controls?.disconnect());
      cleanup.push(() => {
        if (savedCameraPosition) camera.position.copy(savedCameraPosition);
        invalidateRef.current?.();
      });
      // Paint the eye-level starting pose. The main RAF tick no longer calls
      // OrbitControls.update() in this mode (#114), so nothing else marks the
      // first walkthrough frame dirty.
      invalidateRef.current?.();

      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();
      // Scratch for the collision step — reused every frame so the loop
      // allocates nothing (#156).
      const walkFrom: WalkerPosition = { x: 0, z: 0 };
      const walkTo: WalkerPosition = { x: 0, z: 0 };
      const walkOut: WalkerPosition = { x: 0, z: 0 };
      const walkOptions: WalkCollisionOptions = {};
      let lastTime = performance.now();
      const step = () => {
        rafId = requestAnimationFrame(step);
        const now = performance.now();
        const delta = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        if (!controls?.isLocked) return;
        // Walkthrough is an active mode: mouse-look mutates the camera outside
        // this loop, so render every frame while pointer lock is engaged.
        invalidateRef.current?.();

        const sprint = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
        const speed = walkSpeedRef.current * (sprint ? 2 : 1);

        let dz = 0;
        let dx = 0;
        if (pressed.has('KeyW') || pressed.has('ArrowUp')) dz -= 1;
        if (pressed.has('KeyS') || pressed.has('ArrowDown')) dz += 1;
        if (pressed.has('KeyA') || pressed.has('ArrowLeft')) dx -= 1;
        if (pressed.has('KeyD') || pressed.has('ArrowRight')) dx += 1;

        if (dx === 0 && dz === 0) return;
        const len = Math.hypot(dx, dz);
        dx /= len;
        dz /= len;

        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, camera.up).normalize();

        const distance = speed * delta;
        walkFrom.x = camera.position.x;
        walkFrom.z = camera.position.z;
        camera.position.addScaledVector(forward, -dz * distance);
        camera.position.addScaledVector(right, dx * distance);
        walkTo.x = camera.position.x;
        walkTo.z = camera.position.z;
        // Slide around furniture and interior walls (#156). Room dims decide
        // whether outdoor items count; Infinity (no room) reads as "inside".
        walkOptions.roomWidth = roomWidthRef.current;
        walkOptions.roomDepth = roomDepthRef.current;
        resolveWalkerStep(collidersRef.current, walkFrom, walkTo, WALKER_RADIUS, walkOut, walkOptions);
        camera.position.x = walkOut.x;
        camera.position.z = walkOut.z;
        camera.position.y = eyeHeightRef.current;
        clampToFootprint();
      };
      rafId = requestAnimationFrame(step);
      cleanup.push(() => cancelAnimationFrame(rafId));
    })();

    return () => {
      cancelled = true;
      for (const fn of cleanup) {
        try {
          fn();
        } catch {
          /* swallow */
        }
      }
      if (orbit) orbit.enabled = true;
    };
  }, [enabled, canvasRef, threeModuleRef, cameraRef, orbitRef]);
}
