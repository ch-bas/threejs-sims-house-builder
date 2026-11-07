import { useEffect } from 'react';
import { outdoorGroundSize } from '../lib/site';
import { buildWeatherMesh, createWeatherField, removeWeather, setWeatherTime } from '../three/weather';
import { useReducedMotion } from './use-reduced-motion';
import type { DryBox } from '../lib/street-row';
import type { TerrainSpec, Weather } from '../lib/types';
import type { FrameBudget } from '../three/frame-budget';
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
  /** The scene's frame budget for decorative loops (#671). */
  addDecorativeStep: FrameBudget['add'];
}

/**
 * Rain or snow over the lot (#189). A step on the scene's frame budget
 * (#671), like the walkers: only while weather ≠ clear, advancing the field's
 * clock (a uniform; the vertex shader moves the particles, #669) and asking
 * for a repaint each step, so the render loop stays parked the moment the
 * weather clears. The overcast lighting and the ground tint
 * are applied by `applyTimeOfDay`, not here. Cleanup disposes the field and
 * repaints once so the last frame's particles don't linger.
 */
export function useWeather(options: UseWeatherOptions): void {
  const { weather, enabled, threeModuleRef, sceneRef, roomWidth, roomDepth, clearance, dryBoxes, invalidate, addDecorativeStep } = options;
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
      invalidate();
      return () => {
        removeWeather(scene);
        invalidate();
      };
    }

    let seconds = 0;
    const removeStep = addDecorativeStep((delta) => {
      seconds += delta;
      setWeatherTime(mesh, seconds);
      return true;
    });

    return () => {
      removeStep();
      removeWeather(scene);
      invalidate();
    };
  }, [enabled, weather, threeModuleRef, sceneRef, roomWidth, roomDepth, clearance, dryBoxes, frontY, backY, invalidate, addDecorativeStep, reducedMotion]);
}
