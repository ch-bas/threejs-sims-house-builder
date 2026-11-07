import { useEffect } from 'react';
import { outdoorGroundSize } from '../lib/site';
import { buildWeatherMesh, createWeatherField, removeWeather, stepWeatherField, syncWeatherMesh } from '../three/weather';
import { useReducedMotion } from './use-reduced-motion';
import type { DryBox } from '../lib/street-row';
import type { TerrainSpec, Weather } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('../three/three-runtime');

export interface UseWeatherOptions {
  weather: Weather;
  /** False parks the field entirely (2D view, scene not ready). */
  enabled: boolean;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  /** House footprint: sizes the field to the lot and keeps the indoors dry. */
  roomWidth: number;
  roomDepth: number;
  /** How far the roof overhangs the footprint; kept dry too (#660). 0 with no roof. */
  clearance: number;
  /** The neighbours' houses, kept dry the same way (#660). */
  dryBoxes: readonly DryBox[];
  /** The lot's slope: the particles fall to the ground under them (#595). */
  terrain?: TerrainSpec | undefined;
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
  const { weather, enabled, threeModuleRef, sceneRef, roomWidth, roomDepth, clearance, dryBoxes, invalidate } = options;
  // Keyed on the two heights, not the terrain object, which a save or an
  // undo hands over afresh.
  const frontY = options.terrain?.frontY;
  const backY = options.terrain?.backY;
  const reducedMotion = useReducedMotion();

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
      clearance,
      dryBoxes,
      ...(frontY !== undefined && backY !== undefined ? { terrain: { frontY, backY } } : {}),
    });
    const mesh = buildWeatherMesh(THREE, field);
    scene.add(mesh);

    // Reduced motion (#436): the particles hang where they were scattered —
    // one paint, no loop.
    if (reducedMotion) {
      syncWeatherMesh(mesh, field);
      invalidate();
      return () => {
        removeWeather(scene);
        invalidate();
      };
    }

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
  }, [enabled, weather, threeModuleRef, sceneRef, roomWidth, roomDepth, clearance, dryBoxes, frontY, backY, invalidate, reducedMotion]);
}
