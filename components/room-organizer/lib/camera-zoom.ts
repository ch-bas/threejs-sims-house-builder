/**
 * The camera pad's zoom slider as a view of the real orbit distance (#167).
 * Log scale, so each zoom step moves the thumb by the same amount; 100 is
 * closest. Distances outside the range pin the thumb to an end.
 */
export const ZOOM_SLIDER_MIN_DISTANCE = 2;
export const ZOOM_SLIDER_MAX_DISTANCE = 80;

/** What one '+' / '-' press multiplies the orbit distance by. */
export const ZOOM_IN_FACTOR = 0.85;
export const ZOOM_OUT_FACTOR = 1.18;

const LOG_SPAN = Math.log(ZOOM_SLIDER_MAX_DISTANCE / ZOOM_SLIDER_MIN_DISTANCE);

/** Slider value (0–100, integer) for an orbit distance. */
export function zoomSliderValue(distance: number): number {
  if (!(distance > 0)) return 100;
  const t = Math.log(ZOOM_SLIDER_MAX_DISTANCE / distance) / LOG_SPAN;
  return Math.round(Math.min(1, Math.max(0, t)) * 100);
}

/** Orbit distance a slider value asks for. */
export function zoomSliderDistance(value: number): number {
  const t = Math.min(100, Math.max(0, value)) / 100;
  return ZOOM_SLIDER_MAX_DISTANCE * Math.exp(-t * LOG_SPAN);
}

/**
 * The next discrete zoom step from `distance` towards `target`, or null once
 * the camera is within half a step of it.
 */
export function nextZoomStep(distance: number, target: number): '+' | '-' | null {
  if (target < distance * Math.sqrt(ZOOM_IN_FACTOR)) return '+';
  if (target > distance * Math.sqrt(ZOOM_OUT_FACTOR)) return '-';
  return null;
}
