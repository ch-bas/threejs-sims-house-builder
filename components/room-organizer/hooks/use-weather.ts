import { useEffect } from 'react';
import { outdoorGroundSize } from '../lib/site';
import { buildWeatherMesh, createWeatherField, removeWeather, stepWeatherField, syncWeatherMesh } from '../three/weather';
import type { Weather } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

export interface UseWeatherOptions {
  weather: Weather;
  /** False parks the field entirely (2D view, scene not ready). */
  enabled: boolean;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  /** House footprint: sizes the field to the lot and keeps the indoors dry. */
  roomWidth: number;
  roomDepth: number;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate: () => void;
}

/**
 * Rain or snow over the lot (#189). Runs a self-invalidating RAF loop exactly
 * like the NPC walkers: only while weather ≠ clear, stepping the particle
 * field and requesting one repaint per frame, so the render loop stays parked
 * the moment the weather clears. The overcast lighting and the ground tint
 * are applied by `applyTimeOfDay`, not here. Cleanup disposes the field and
 * repaints once so the last frame's particles don't linger.
 */
export function useWeather(options: UseWeatherOptions): void {
  const { weather, enabled, threeModuleRef, sceneRef, roomWidth, roomDepth, invalidate } = options;

  useEffect(() => {
    if (!enabled || weather === 'clear') return undefined;
    const THREE = threeModuleRef.current;
    const scene = sceneRef.current;
    if (!THREE || !scene) return undefined;

    const field = createWeatherField({
      kind: weather,
      groundSize: outdoorGroundSize(roomWidth, roomDepth),
      roomWidth,
      roomDepth,
    });
    const mesh = buildWeatherMesh(THREE, field);
    scene.add(mesh);

    let rafId = 0;
    let lastTime = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const now = performance.now();
      // Cap the step so a backgrounded tab doesn't teleport the column on return.
      const delta = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      stepWeatherField(field, delta);
      syncWeatherMesh(mesh, field);
      invalidate();
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      removeWeather(scene);
      invalidate();
    };
  }, [enabled, weather, threeModuleRef, sceneRef, roomWidth, roomDepth, invalidate]);
}
