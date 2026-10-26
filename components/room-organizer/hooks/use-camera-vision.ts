import { useEffect, useMemo, useRef } from 'react';
import { buildSightWalls, type ShellBuilding } from '../lib/walk-collision';
import { stepVisionCones } from '../three/camera-vision';
import { ROOM_OBJECT_TAGS } from '../three/room-builder';
import { useReducedMotion } from './use-reduced-motion';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('../three/three-runtime');

export interface UseCameraVisionOptions {
  enabled: boolean;
  /** Requests a repaint from the on-demand render loop after each step. */
  invalidate?: () => void;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  /** The walls a cone can't see through (#590); absent, it sees through all. */
  building?: ShellBuilding;
}

/**
 * Animates the security cameras' vision cones — sweeping the scan line across
 * each field of view and pulsing the wedge — every animation frame. The cone
 * meshes themselves are created/torn down in `useSceneEffects`; this hook only
 * drives them. The renderer is on-demand, so each step must invalidate to get
 * painted — without it the sweep only advances when something else (camera
 * orbit, drag) happens to request frames.
 */
export function useCameraVision({ enabled, invalidate, threeModuleRef, sceneRef, building }: UseCameraVisionOptions): void {
  const reducedMotion = useReducedMotion();
  // Built when the building changes, never per frame; read through a ref so
  // an edit doesn't restart the loop.
  const sightWalls = useMemo(() => (enabled && building ? buildSightWalls(building) : undefined), [enabled, building]);
  const sightWallsRef = useRef(sightWalls);
  sightWallsRef.current = sightWalls;
  useEffect(() => {
    if (!enabled) return undefined;
    const scene = sceneRef.current;
    if (!threeModuleRef.current || !scene) return undefined;

    let rafId = 0;
    const start = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      // With no cones in the scene there is nothing to animate — skip the
      // step and, crucially, the invalidate, so an idle editor with the
      // toggle on doesn't render every frame for nothing.
      const hasCones = scene.children.some(
        (child) => child.userData.type === ROOM_OBJECT_TAGS.CameraVision
      );
      if (!hasCones) return;
      // Reduced motion (#436): the clock stands still, so the scan line and
      // the wedge's pulse hold; detection and the alert colour still follow.
      stepVisionCones(scene, reducedMotion ? 0 : (performance.now() - start) / 1000, sightWallsRef.current);
      invalidate?.();
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [enabled, invalidate, threeModuleRef, sceneRef, reducedMotion]);
}
