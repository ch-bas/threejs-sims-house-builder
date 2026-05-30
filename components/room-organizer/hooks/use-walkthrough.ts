import { useEffect } from 'react';
import type * as ThreeNS from 'three';
import type { PointerLockControls as PointerLockControlsType } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

type ThreeModule = typeof import('three');

export interface UseWalkthroughOptions {
  enabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  orbitRef: React.MutableRefObject<OrbitControlsType | null>;
  eyeHeight?: number;
  walkSpeed?: number;
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

/**
 * First-person walkthrough mode using PointerLockControls.
 *
 * When `enabled` flips on, this hook:
 *  - Disables the orbit controls.
 *  - Lazy-loads PointerLockControls and attaches them to the canvas.
 *  - Moves the camera to eye level and listens for WASD / arrow movement,
 *    with Shift for sprint.
 *  - On disable / unmount, restores orbit controls and the camera pose.
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
  } = options;

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
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    cleanup.push(() => window.removeEventListener('keydown', onKeyDown));
    cleanup.push(() => window.removeEventListener('keyup', onKeyUp));

    void (async () => {
      const module = await import('three/examples/jsm/controls/PointerLockControls.js');
      if (cancelled) return;

      controls = new module.PointerLockControls(camera, canvas);
      savedCameraPosition = camera.position.clone();
      camera.position.set(0, eyeHeight, 3);
      camera.lookAt(0, eyeHeight, 0);

      const requestLock = () => controls?.lock();
      canvas.addEventListener('click', requestLock);
      cleanup.push(() => canvas.removeEventListener('click', requestLock));
      cleanup.push(() => controls?.disconnect());
      cleanup.push(() => {
        if (savedCameraPosition) camera.position.copy(savedCameraPosition);
      });

      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();
      let lastTime = performance.now();
      const step = () => {
        rafId = requestAnimationFrame(step);
        const now = performance.now();
        const delta = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        if (!controls?.isLocked) return;

        const sprint = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
        const speed = walkSpeed * (sprint ? 2 : 1);

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
        camera.position.addScaledVector(forward, -dz * distance);
        camera.position.addScaledVector(right, dx * distance);
        camera.position.y = eyeHeight;
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
  }, [enabled, canvasRef, threeModuleRef, cameraRef, orbitRef, eyeHeight, walkSpeed]);
}
