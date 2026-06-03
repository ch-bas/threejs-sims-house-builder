import { useEffect } from 'react';
import type * as ThreeNS from 'three';
import { stepVisionCones } from '../three/camera-vision';

type ThreeModule = typeof import('three');

export interface UseCameraVisionOptions {
  enabled: boolean;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
}

/**
 * Animates the security cameras' vision cones — sweeping the scan line across
 * each field of view and pulsing the wedge — every animation frame. The cone
 * meshes themselves are created/torn down in `useSceneEffects`; this hook only
 * drives them, so it stays correct across scene rebuilds. The shared render
 * loop in `useThreeScene` paints the updated transforms.
 */
export function useCameraVision({ enabled, threeModuleRef, sceneRef }: UseCameraVisionOptions): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const scene = sceneRef.current;
    if (!threeModuleRef.current || !scene) return undefined;

    let rafId = 0;
    const start = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      stepVisionCones(scene, (performance.now() - start) / 1000);
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [enabled, threeModuleRef, sceneRef]);
}
