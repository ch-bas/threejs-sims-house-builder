import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/reduced-motion';
import { groundHeightAt } from '../lib/site';
import {
  advanceWalker,
  buildWalkerColliders,
  type ShellBuilding,
  type WalkCollider,
  type WalkerState,
} from '../lib/walk-collision';
import { interacts, isTypingTarget, releasesHeldKeys, startsWalking, walkFrameSeconds } from '../lib/walk-input';
import { findSeat, seatPose } from '../lib/walk-interact';
import { walkArrival, walkSpawn, type WalkPose } from '../lib/walk-spawn';
import {
  buildWalkWorld,
  distanceToStairwell,
  eyeOffsetForStorey,
  seesNeighbourStoreys,
  walkLampStorey,
  type WalkWorld,
} from '../lib/walk-world';
import type { StreetSite } from '../lib/street-row';
import type { FurnitureItem } from '../lib/types';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PointerLockControls as PointerLockControlsType } from 'three/examples/jsm/controls/PointerLockControls.js';

type ThreeModule = typeof import('../three/three-runtime');

const NO_ITEMS: readonly FurnitureItem[] = [];
const NO_COLLIDERS: readonly WalkCollider[] = [];
const NO_STOREYS: readonly (readonly WalkCollider[])[] = [];

/** The building the walker moves through: storeys, shell and the street around it. */
export interface WalkthroughBuilding extends ShellBuilding, Pick<StreetSite, 'neighbours' | 'roof'> {}

export interface UseWalkthroughOptions {
  enabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  orbitRef: React.MutableRefObject<OrbitControlsType | null>;
  walkSpeed?: number;
  building: WalkthroughBuilding;
  /** The storey shown; the walker's colliders and seats are this floor's. */
  activeFloorIndex: number;
  /**
   * The walker climbed or came down the stairs onto another storey (#446):
   * make it the active floor. A change the walker didn't ask for (PgUp/PgDn,
   * the floor pills) moves the walker to the stairs on that storey instead.
   */
  onFloorChange?(index: number): void;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate?: () => void;
  /**
   * Called when the user presses Escape a second time (while pointer lock is
   * already released) to leave walkthrough entirely (see #67). The first Esc is
   * browser-reserved and only exits pointer lock.
   */
  onExit?: () => void;
}

export interface UseWalkthroughResult {
  /**
   * The browser refused the last pointer-lock request (Chrome does for about
   * a second after Esc released it). Cleared by the next successful lock (#351).
   */
  lockRefused: boolean;
  /** Pointer lock is engaged: the mouse looks and the keys walk (#454). */
  locked: boolean;
  /** The seat in reach, by name, while standing; null when none (#463b). */
  seatName: string | null;
  seated: boolean;
  /** The walker is out on the lot (or in the porch): the whole house is drawn (#446). */
  outside: boolean;
  /**
   * Indoors, the walker is on a flight or near a stairwell, where the storeys
   * either side of its own can be seen; elsewhere the ceiling hides them (#446).
   */
  nearStairs: boolean;
  /** The storey whose lamps light the walker: the one above from its top tread (#446). */
  lampStorey: number;
  /** The touch stick (#446): x right, y forward, each in [−1, 1]. */
  setStick(x: number, y: number): void;
  /** Sit on the seat in reach, or stand up (`E`, or the HUD's button on touch). */
  toggleSit(): void;
}

/** Shoulder-width walker: wide enough that the camera's near plane never pokes
 * into a sofa, narrow enough to fit a 0.8 m doorway with room to spare (#156). */
const WALKER_RADIUS = 0.3;
/** How fast the eye follows the feet up and down a flight (1/s): a smooth climb, not a judder. */
const EYE_EASE = 14;
/** Sitting down or standing up takes this long (s). */
const SIT_SECONDS = 0.35;
/** The seat prompt is looked up this often (ms), not every frame. */
const SEAT_LOOKUP_MS = 120;
/** Radians of turn per pixel of a touch drag. */
const TOUCH_LOOK = 0.005;
const MAX_PITCH = Math.PI / 2 - 0.05;
/**
 * Near plane while walking: its farthest corner stays inside the 0.35 m wall
 * standoff up to a 3:1 screen at the 75° field of view.
 */
const WALK_NEAR = 0.1;

interface WalkSession {
  walker: WalkerState;
  /** Eye height the camera is easing toward the feet with. */
  eyeY: number;
  stickX: number;
  stickY: number;
  /** Walking by touch: no pointer lock, the stick and drags drive the walker. */
  touch: boolean;
  /** Where the walker stood before sitting, or null while standing. */
  seated: { x: number; z: number } | null;
  seatTargetId: string | null;
  outside: boolean;
  nearStairs: boolean;
  /** The floor the walker last reported, and the reports React hasn't echoed yet. */
  reportedFloor: number;
  pendingFloors: number[];
}

/**
 * First-person walkthrough mode (#67, #156, #446, #454, #463).
 *
 * When `enabled` flips on, this hook:
 *  - Disables the orbit controls and places the walker inside the entrance
 *    door, looking in (`lib/walk-spawn`).
 *  - Lazy-loads PointerLockControls; a click locks the pointer, then WASD /
 *    arrows walk (Shift sprints). On a touch screen a drag looks around and
 *    the HUD's stick walks.
 *  - Moves the walker over `lib/walk-world`: furniture, partitions and the
 *    shell are solid, exterior doors lead out onto the lot, and stairs are a
 *    ramp — reaching the other storey makes it the active floor.
 *  - `E` sits on the seat in reach, facing the TV, and stands up again.
 *  - On disable / unmount, restores orbit controls and the camera pose.
 *
 * Live inputs are read from refs, so a floor switch or an edit mid-walk never
 * re-inits the mode and drops pointer lock (see #67).
 */
export function useWalkthrough(options: UseWalkthroughOptions): UseWalkthroughResult {
  const {
    enabled,
    canvasRef,
    threeModuleRef,
    cameraRef,
    orbitRef,
    walkSpeed = 3.0,
    building,
    activeFloorIndex,
    onFloorChange,
    invalidate,
    onExit,
  } = options;

  const [lockRefused, setLockRefused] = useState(false);
  const [locked, setLocked] = useState(false);
  const [seatName, setSeatName] = useState<string | null>(null);
  const [seated, setSeated] = useState(false);
  const [outside, setOutside] = useState(false);
  const [nearStairs, setNearStairs] = useState(false);
  const [lampStorey, setLampStorey] = useState(activeFloorIndex);

  // Built only when what they read changes, never per frame (#156); outside
  // walkthrough they're skipped entirely.
  const world = useMemo<WalkWorld | null>(() => (enabled ? buildWalkWorld(building) : null), [enabled, building]);
  const floor = building.floors[activeFloorIndex];
  // Per storey: its own colliders with the storeys either side, each box
  // spanning its own heights, so the walker on a flight is tested against
  // both storeys it is between (#446).
  const colliders = useMemo<readonly (readonly WalkCollider[])[]>(
    () => (enabled ? buildWalkerColliders(building) : NO_STOREYS),
    [enabled, building]
  );

  // Live values the RAF loop and handlers read without re-running the init
  // effect (which would drop pointer lock). Updated every render.
  const worldRef = useRef(world);
  const collidersRef = useRef(colliders);
  const buildingRef = useRef(building);
  const itemsRef = useRef(floor?.items ?? NO_ITEMS);
  const walkSpeedRef = useRef(walkSpeed);
  const invalidateRef = useRef(invalidate);
  const onExitRef = useRef(onExit);
  const onFloorChangeRef = useRef(onFloorChange);
  const activeFloorRef = useRef(activeFloorIndex);
  worldRef.current = world;
  collidersRef.current = colliders;
  buildingRef.current = building;
  itemsRef.current = floor?.items ?? NO_ITEMS;
  walkSpeedRef.current = walkSpeed;
  invalidateRef.current = invalidate;
  onExitRef.current = onExit;
  onFloorChangeRef.current = onFloorChange;
  activeFloorRef.current = activeFloorIndex;

  const sessionRef = useRef<WalkSession>({
    walker: { x: 0, z: 0, y: 0, kind: 'floor', floorIndex: 0 },
    eyeY: 0,
    stickX: 0,
    stickY: 0,
    touch: false,
    seated: null,
    seatTargetId: null,
    outside: false,
    nearStairs: false,
    reportedFloor: 0,
    pendingFloors: [],
  });
  // Set by the init effect while the mode runs; the HUD's buttons call them.
  const toggleSitRef = useRef<(() => void) | null>(null);
  const arriveRef = useRef<((floorIndex: number) => void) | null>(null);

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
    const session = sessionRef.current;
    let cancelled = false;
    let controls: PointerLockControlsType | null = null;
    // The orbit pose to come back to, saved before anything moves the camera.
    const savedCameraPosition = camera.position.clone();
    const savedCameraQuaternion = camera.quaternion.clone();
    // The orbit target follows the active storey even mid-walk; on exit the
    // camera moves with it, so a floor change doesn't make the first orbit jump.
    const savedTarget = orbit?.target.clone() ?? null;
    // The orbit near plane (0.3 m) is wider than the 0.35 m wall standoff on a
    // wide screen (a landscape phone), so it cut through a wall the walker
    // stood against. Walking pulls it in; exit puts it back.
    const savedNear = camera.near;
    camera.near = WALK_NEAR;
    camera.updateProjectionMatrix();
    let rafId = 0;

    // Scratch, reused every frame so the loop allocates nothing (#156).
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    // Cloned from the camera rather than constructed, so the scene's three
    // runtime list (three/three-runtime.ts) needn't grow for two scratch types.
    const lookEuler = camera.rotation.clone();
    lookEuler.order = 'YXZ';
    const lookMatrix = new THREE.Matrix4();
    const lookTarget = new THREE.Vector3();
    const fromPosition = new THREE.Vector3();
    const toPosition = new THREE.Vector3();
    const fromQuaternion = camera.quaternion.clone();
    const toQuaternion = camera.quaternion.clone();
    // Sitting down / standing up eases the camera between two poses.
    const transition = { active: false, t: 0 };

    const eyeFor = (walker: WalkerState): number => {
      const height = worldRef.current?.storeyHeights[walker.floorIndex] ?? 3;
      return walker.y + eyeOffsetForStorey(height);
    };

    const startTransition = (x: number, y: number, z: number, lookX: number, lookY: number, lookZ: number): void => {
      fromPosition.copy(camera.position);
      fromQuaternion.copy(camera.quaternion);
      toPosition.set(x, y, z);
      lookTarget.set(lookX, lookY, lookZ);
      lookMatrix.lookAt(toPosition, lookTarget, camera.up);
      toQuaternion.setFromRotationMatrix(lookMatrix);
      transition.active = true;
      // Reduced motion (#436): the next frame lands on the pose, no ease.
      transition.t = prefersReducedMotion() ? 1 : 0;
    };

    // What the walker can see of the house: all of it from outside; indoors
    // its own storey, and the ones either side near a stairwell. React state
    // changes only when an answer flips.
    const updateView = (wasNear: boolean): void => {
      const walker = session.walker;
      const isOutside = walker.kind === 'ground';
      if (isOutside !== session.outside) {
        session.outside = isOutside;
        setOutside(isOutside);
      }
      const world = worldRef.current;
      const near = world
        ? seesNeighbourStoreys(wasNear, walker.kind, distanceToStairwell(world, walker.floorIndex, walker.x, walker.z))
        : false;
      if (near !== session.nearStairs) {
        session.nearStairs = near;
        setNearStairs(near);
      }
      // A plain number: React skips the render when it is unchanged.
      setLampStorey(world ? walkLampStorey(world, walker) : walker.floorIndex);
    };

    const placeAt = (pose: WalkPose): void => {
      const walker = session.walker;
      walker.x = pose.x;
      walker.z = pose.z;
      walker.y = pose.y;
      walker.kind = pose.kind;
      walker.floorIndex = pose.floorIndex;
      session.seated = null;
      updateView(false);
      transition.active = false;
      session.eyeY = eyeFor(walker);
      camera.position.set(walker.x, session.eyeY, walker.z);
      if (pose.dirX !== 0 || pose.dirZ !== 0) {
        camera.lookAt(walker.x + pose.dirX, session.eyeY, walker.z + pose.dirZ);
      }
      invalidateRef.current?.();
    };

    const spawnContext = (floorIndex: number) => {
      const spawnWorld = worldRef.current;
      return spawnWorld
        ? { world: spawnWorld, building: buildingRef.current, colliders: collidersRef.current[floorIndex] ?? NO_COLLIDERS, radius: WALKER_RADIUS, floorIndex }
        : null;
    };

    // Room-aware spawn (#463a): inside the entrance, looking in.
    const initial = spawnContext(activeFloorRef.current);
    session.reportedFloor = activeFloorRef.current;
    session.pendingFloors.length = 0;
    session.stickX = 0;
    session.stickY = 0;
    session.seatTargetId = null;
    if (initial) placeAt(walkSpawn(initial, initial.floorIndex));

    // A floor change the walker didn't walk: land at the stairs on it (#446).
    arriveRef.current = (floorIndex) => {
      const ctx = spawnContext(floorIndex);
      if (!ctx) return;
      if (session.seated) setSeated(false);
      placeAt(walkArrival(ctx, floorIndex, session.walker.floorIndex, session.walker));
    };

    const standUp = (): void => {
      const stand = session.seated;
      if (!stand) return;
      session.seated = null;
      setSeated(false);
      // Back where the walker stood, still looking where it looked.
      fromPosition.copy(camera.position);
      fromQuaternion.copy(camera.quaternion);
      toPosition.set(session.walker.x, eyeFor(session.walker), session.walker.z);
      toQuaternion.copy(camera.quaternion);
      transition.active = true;
      // Reduced motion (#436): the next frame lands on the pose, no ease.
      transition.t = prefersReducedMotion() ? 1 : 0;
    };

    const sitDown = (): void => {
      const items = itemsRef.current;
      const seat = items.find((item) => item.id === session.seatTargetId);
      const walker = session.walker;
      const world = worldRef.current;
      // A garden bench sits on the lot, not on the storey's floor.
      const floorY =
        seat?.category === 'outdoor' && seat.position && world
          ? groundHeightAt(world.terrain, seat.position.z, world.halfDepth)
          : (world?.elevations[walker.floorIndex] ?? 0);
      // A TV behind a wall isn't what the sitter faces (#566).
      const pose = seat
        ? seatPose(seat, items, floorY, { colliders: collidersRef.current[walker.floorIndex] ?? NO_COLLIDERS })
        : null;
      if (!pose) return;
      session.seated = { x: walker.x, z: walker.z };
      setSeated(true);
      startTransition(pose.x, pose.eyeY, pose.z, pose.lookX, pose.lookY, pose.lookZ);
    };

    const toggleSit = (): void => {
      if (transition.active) return;
      if (session.seated) standUp();
      else sitDown();
      invalidateRef.current?.();
    };
    toggleSitRef.current = toggleSit;

    const walking = () => Boolean(controls?.isLocked) || session.touch;

    const onKeyDown = (event: KeyboardEvent) => {
      // Typing in a field is not walking (#558). Key-ups still release.
      if (isTypingTarget(event.target)) return;
      if (releasesHeldKeys(event)) pressed.clear();
      else if (startsWalking(event)) {
        pressed.add(event.code);
        // Keys walk under the pointer lock, not in touch mode.
        if (!controls?.isLocked) session.touch = false;
      }
      else if (interacts(event) && walking()) toggleSit();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (releasesHeldKeys(event)) pressed.clear();
      else pressed.delete(event.code);
    };
    // Escape exit: the browser reserves the first Escape to release pointer
    // lock, so we only act on an Escape received while already unlocked — that
    // second press leaves walkthrough mode entirely (see #67).
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isTypingTarget(event.target)) return;
      if (controls?.isLocked) return;
      onExitRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onEscape);
    cleanup.push(() => window.removeEventListener('keydown', onKeyDown));
    cleanup.push(() => window.removeEventListener('keyup', onKeyUp));
    cleanup.push(() => window.removeEventListener('keydown', onEscape));

    // Touch look (#446): phones have no pointer lock, so a one-finger drag
    // on the canvas turns the head; the HUD's stick walks.
    let lastPointerType = 'mouse';
    let lookPointer: number | null = null;
    let lookX = 0;
    let lookY = 0;
    const onPointerDown = (event: PointerEvent) => {
      lastPointerType = event.pointerType;
      if (event.pointerType === 'mouse') {
        // A mouse is back: walking needs the pointer lock again.
        session.touch = false;
        return;
      }
      if (lookPointer !== null) return;
      session.touch = true;
      lookPointer = event.pointerId;
      lookX = event.clientX;
      lookY = event.clientY;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== lookPointer) return;
      lookEuler.setFromQuaternion(camera.quaternion);
      lookEuler.y -= (event.clientX - lookX) * TOUCH_LOOK;
      lookEuler.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, lookEuler.x - (event.clientY - lookY) * TOUCH_LOOK));
      camera.quaternion.setFromEuler(lookEuler);
      lookX = event.clientX;
      lookY = event.clientY;
      invalidateRef.current?.();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId === lookPointer) lookPointer = null;
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    cleanup.push(() => canvas.removeEventListener('pointerdown', onPointerDown));
    cleanup.push(() => window.removeEventListener('pointermove', onPointerMove));
    cleanup.push(() => window.removeEventListener('pointerup', onPointerEnd));
    cleanup.push(() => window.removeEventListener('pointercancel', onPointerEnd));

    void (async () => {
      const controlsModule = await import('three/examples/jsm/controls/PointerLockControls.js');
      if (cancelled) return;

      controls = new controlsModule.PointerLockControls(camera, canvas);

      // Not controls.lock(): it drops the promise requestPointerLock returns,
      // so a refused lock was an unhandled rejection the player never saw
      // (#351). PointerLockControls still tracks the lock through
      // pointerlockchange, whoever requested it.
      const markRefused = () => {
        if (!cancelled) setLockRefused(true);
      };
      const requestLock = () => {
        // A tap is touch walking: there is no pointer to lock (iOS has no
        // pointer lock at all).
        if (controls?.isLocked || lastPointerType !== 'mouse') return;
        if (typeof canvas.requestPointerLock !== 'function') return;
        try {
          // Older Safari returns undefined instead of a promise.
          void Promise.resolve(canvas.requestPointerLock()).catch(markRefused);
        } catch {
          markRefused();
        }
      };
      const onLock = () => {
        setLockRefused(false);
        setLocked(true);
      };
      const onUnlock = () => setLocked(false);
      canvas.addEventListener('click', requestLock);
      cleanup.push(() => canvas.removeEventListener('click', requestLock));
      canvas.ownerDocument.addEventListener('pointerlockerror', markRefused);
      cleanup.push(() => canvas.ownerDocument.removeEventListener('pointerlockerror', markRefused));
      controls.addEventListener('lock', onLock);
      cleanup.push(() => controls?.removeEventListener('lock', onLock));
      controls.addEventListener('unlock', onUnlock);
      cleanup.push(() => controls?.removeEventListener('unlock', onUnlock));
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
      // Paint the starting pose. The main RAF tick no longer calls
      // OrbitControls.update() in this mode (#114), so nothing else marks the
      // first walkthrough frame dirty.
      invalidateRef.current?.();

      let lastTime = performance.now();
      let lastSeatLookup = 0;
      const step = () => {
        rafId = requestAnimationFrame(step);
        const now = performance.now();
        const delta = walkFrameSeconds(now - lastTime);
        lastTime = now;

        const isLocked = Boolean(controls?.isLocked);
        if (!isLocked && !session.touch) return;
        // Mouse-look mutates the camera outside this loop, so render every
        // frame while pointer lock is engaged; touch renders when it changes.
        let dirty = isLocked;
        const walker = session.walker;

        if (transition.active) {
          transition.t = Math.min(1, transition.t + delta / SIT_SECONDS);
          const eased = transition.t * transition.t * (3 - 2 * transition.t);
          camera.position.lerpVectors(fromPosition, toPosition, eased);
          camera.quaternion.slerpQuaternions(fromQuaternion, toQuaternion, eased);
          if (transition.t >= 1) {
            transition.active = false;
            if (!session.seated) session.eyeY = camera.position.y;
          }
          dirty = true;
        }

        let dz = -session.stickY;
        let dx = session.stickX;
        if (pressed.has('KeyW') || pressed.has('ArrowUp')) dz -= 1;
        if (pressed.has('KeyS') || pressed.has('ArrowDown')) dz += 1;
        if (pressed.has('KeyA') || pressed.has('ArrowLeft')) dx -= 1;
        if (pressed.has('KeyD') || pressed.has('ArrowRight')) dx += 1;
        const len = Math.hypot(dx, dz);

        if (len > 0 && session.seated && !transition.active) {
          // Any step stands the walker up first.
          standUp();
        } else if (len > 0 && !session.seated && !transition.active) {
          // The stick is analogue: a light push walks slowly.
          const scale = len > 1 ? 1 / len : 1;
          const sprint = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
          const distance = walkSpeedRef.current * (sprint ? 2 : 1) * delta;
          camera.getWorldDirection(forward);
          forward.y = 0;
          forward.normalize();
          right.crossVectors(forward, camera.up).normalize();
          const moveX = (forward.x * -dz + right.x * dx) * scale * distance;
          const moveZ = (forward.z * -dz + right.z * dx) * scale * distance;
          const world = worldRef.current;
          if (world) advanceWalker(world, collidersRef.current[walker.floorIndex] ?? NO_COLLIDERS, walker, moveX, moveZ, WALKER_RADIUS);
          dirty = true;
          updateView(session.nearStairs);
          // Climbing onto the other storey makes it the active floor (#446).
          if (walker.floorIndex !== session.reportedFloor) {
            session.reportedFloor = walker.floorIndex;
            session.pendingFloors.push(walker.floorIndex);
            onFloorChangeRef.current?.(walker.floorIndex);
          }
        }

        if (!session.seated && !transition.active) {
          // The eye follows the feet up a flight, eased so treads don't judder.
          const target = eyeFor(walker);
          const gap = target - session.eyeY;
          session.eyeY = Math.abs(gap) < 1e-3 ? target : session.eyeY + gap * Math.min(1, delta * EYE_EASE);
          if (
            camera.position.x !== walker.x ||
            camera.position.z !== walker.z ||
            camera.position.y !== session.eyeY
          ) {
            camera.position.set(walker.x, session.eyeY, walker.z);
            dirty = true;
          }
        }

        // What's in reach to sit on, for the HUD's prompt (#463b).
        if (!session.seated && now - lastSeatLookup > SEAT_LOOKUP_MS) {
          lastSeatLookup = now;
          camera.getWorldDirection(forward);
          // Never through a wall, nor across the shell (#566).
          const seat = findSeat(itemsRef.current, walker.x, walker.z, forward.x, forward.z, {
            colliders: collidersRef.current[walker.floorIndex] ?? NO_COLLIDERS,
            feetY: walker.y,
            outside: walker.kind === 'ground',
          });
          const id = seat?.id ?? null;
          if (id !== session.seatTargetId) {
            session.seatTargetId = id;
            setSeatName(seat?.name ?? null);
          }
        }

        if (dirty) invalidateRef.current?.();
      };
      rafId = requestAnimationFrame(step);
      cleanup.push(() => cancelAnimationFrame(rafId));
    })();

    return () => {
      cancelled = true;
      toggleSitRef.current = null;
      arriveRef.current = null;
      session.touch = false;
      session.seated = null;
      setLockRefused(false);
      setLocked(false);
      setSeated(false);
      setSeatName(null);
      setOutside(false);
      setNearStairs(false);
      session.outside = false;
      session.nearStairs = false;
      for (const fn of cleanup) {
        try {
          fn();
        } catch {
          /* swallow */
        }
      }
      // Restored even when the exit beats the controls import.
      camera.position.copy(savedCameraPosition);
      // And its aim: the orbit tick doesn't run update() until the next
      // gesture, so the walker's heading otherwise lingered on exit.
      camera.quaternion.copy(savedCameraQuaternion);
      if (orbit && savedTarget) camera.position.add(savedTarget.subVectors(orbit.target, savedTarget));
      camera.near = savedNear;
      camera.updateProjectionMatrix();
      invalidateRef.current?.();
      if (orbit) orbit.enabled = true;
    };
  }, [enabled, canvasRef, threeModuleRef, cameraRef, orbitRef]);

  // The active floor changed. An echo of the walker's own climb is ignored;
  // anything else (PgUp/PgDn, the floor pills) moves the walker onto that
  // storey's stairs (#446). Declared after the init effect, so on entry the
  // walker has already spawned on the active floor and this is a no-op.
  useEffect(() => {
    if (!enabled) return;
    const session = sessionRef.current;
    const pending = session.pendingFloors;
    const echo = pending.indexOf(activeFloorIndex);
    if (echo >= 0) {
      pending.splice(0, echo + 1);
      return;
    }
    pending.length = 0;
    session.reportedFloor = activeFloorIndex;
    if (session.walker.floorIndex === activeFloorIndex) return;
    arriveRef.current?.(activeFloorIndex);
  }, [enabled, activeFloorIndex]);

  const setStick = useCallback((x: number, y: number) => {
    const session = sessionRef.current;
    session.stickX = x;
    session.stickY = y;
    if (x !== 0 || y !== 0) session.touch = true;
    invalidateRef.current?.();
  }, []);
  const toggleSit = useCallback(() => toggleSitRef.current?.(), []);

  return { lockRefused, locked, seatName: seated ? null : seatName, seated, outside, nearStairs, lampStorey, setStick, toggleSit };
}
