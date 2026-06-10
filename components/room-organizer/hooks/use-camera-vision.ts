import { useEffect } from 'react';
import type * as ThreeNS from 'three';
import { stepVisionCones } from '../three/camera-vision';

type ThreeModule = typeof import('three');

export interface UseCameraVisionOptions {
  enabled: boolean;
  /** Requests a repaint from the on-demand render loop after each step. */
  invalidate?: () => void;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
}

/**
 * Animates the security cameras' vision cones — sweeping the scan line across
 * each field of view and pulsing the wedge — every animation frame. The cone
 * meshes themselves are created/torn down in `useSceneEffects`; this hook only
 * drives them. The renderer is on-demand, so each step must invalidate to get
 * painted — without it the sweep only advances when something else (camera
 * orbit, drag) happens to request frames.
 */
export function useCameraVision({ enabled, invalidate, threeModuleRef, sceneRef }: UseCameraVisionOptions): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const scene = sceneRef.current;
    if (!threeModuleRef.current || !scene) return undefined;

    let rafId = 0;
    const start = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      stepVisionCones(scene, (performance.now() - start) / 1000);
      invalidate?.();
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [enabled, invalidate, threeModuleRef, sceneRef]);
}
