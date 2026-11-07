import { useEffect, useMemo, useRef } from 'react';
import { buildSightWalls, type ShellBuilding } from '../lib/walk-collision';
import { stepVisionCones } from '../three/camera-vision';
import { ROOM_OBJECT_TAGS } from '../three/room-builder';
import { useReducedMotion } from './use-reduced-motion';
import type { FrameBudget } from '../three/frame-budget';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('../three/three-runtime');

export interface UseCameraVisionOptions {
  enabled: boolean;
  /** The scene's frame budget for decorative loops (#671). */
  addDecorativeStep: FrameBudget['add'];
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  /** The walls a cone can't see through (#590); absent, it sees through all. */
  building?: ShellBuilding;
}

/**
 * Animates the security cameras' vision cones — sweeping the scan line across
 * each field of view and pulsing the wedge — on every step of the scene's
 * frame budget. The cone
 * meshes themselves are created/torn down in `useSceneEffects`; this hook only
 * drives them, as a step on the scene's frame budget (#671). The renderer is
 * on-demand, so a step that moved something asks for a repaint — without it
 * the sweep only advances when something else (camera orbit, drag) happens
 * to request frames.
 */
export function useCameraVision({ enabled, addDecorativeStep, threeModuleRef, sceneRef, building }: UseCameraVisionOptions): void {
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

    // The sweep's clock: it holds while the budget pauses (a hidden page).
    let seconds = 0;
    return addDecorativeStep((delta) => {
      seconds += delta;
      // With no cones in the scene there is nothing to animate — skip the
      // step and, crucially, the invalidate, so an idle editor with the
      // toggle on doesn't render every frame for nothing.
      const hasCones = scene.children.some(
        (child) => child.userData.type === ROOM_OBJECT_TAGS.CameraVision
      );
      if (!hasCones) return false;
      // Reduced motion (#436): the clock stands still, so the scan line and
      // the wedge's pulse hold; detection and the alert colour still follow.
      // A step that moved nothing (the colours settled, nothing came or
      // went) asks for no frame, so a still cone costs no rendering (#556).
      return stepVisionCones(scene, reducedMotion ? 0 : seconds, sightWallsRef.current);
    });
  }, [enabled, addDecorativeStep, threeModuleRef, sceneRef, reducedMotion]);
}
