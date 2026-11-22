/**
 * Shot presets for photo mode (#912, after #626): a camera preset with a
 * chosen hour and weather, set in one tap. The hour and weather are view
 * settings, never the house: a preset edits nothing, and photo mode puts
 * the scene's own hour, weather and clock back as it ends. No React and no
 * Three.js; loaded with the shutter.
 */

import type { CameraPreset, Weather } from './types';

export interface ShotPreset {
  id: string;
  label: string;
  /** One of the editor's camera presets (`use-camera-presets`). */
  camera: CameraPreset;
  /** The scene's hour, [0, 24). Sunrise is 06:00 and sunset 18:00 (three/lighting). */
  hour: number;
  weather: Weather;
}

/** The shots on offer, in the order the shutter lists them. */
export const SHOT_PRESETS: readonly ShotPreset[] = [
  { id: 'morning', label: 'Morning', camera: 'corner', hour: 8, weather: 'clear' },
  { id: 'midday', label: 'Midday', camera: 'iso', hour: 12.5, weather: 'clear' },
  // An hour before sunset: low, warm light across the front.
  { id: 'golden', label: 'Golden hour', camera: 'front', hour: 17, weather: 'clear' },
  // After dark, the lamps lit.
  { id: 'night', label: 'Night', camera: 'front', hour: 21.5, weather: 'clear' },
  { id: 'rain', label: 'Rainy day', camera: 'corner', hour: 14, weather: 'rain' },
  { id: 'snow', label: 'Snowy day', camera: 'iso', hour: 11, weather: 'snow' },
];

/** What a shot sets in the scene, and what photo mode puts back as it ends. */
export interface ShotConditions {
  hour: number;
  weather: Weather;
  /** The day–night clock (auto-cycle): stopped by a preset, so its hour holds. */
  autoCycle: boolean;
}

const WEATHER_LABELS: Record<Weather, string> = { clear: 'Clear', rain: 'Rain', snow: 'Snow' };

/** "07:30": a scene hour as a clock reads it. */
export function sceneHourLabel(hour: number): string {
  const minutes = Math.floor((((hour % 24) + 24) % 24) * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "17:00 · Clear": a photo's or a preset's hour and weather (anything unknown reads Clear). */
export function sceneLabel(hour: number, weather: string): string {
  return `${sceneHourLabel(hour)} · ${Object.hasOwn(WEATHER_LABELS, weather) ? WEATHER_LABELS[weather as Weather] : 'Clear'}`;
}

/** The conditions `preset` sets: its hour and weather, the clock stopped. */
export function presetConditions(preset: Pick<ShotPreset, 'hour' | 'weather'>): ShotConditions {
  return { hour: preset.hour, weather: preset.weather, autoCycle: false };
}