import { describe, expect, it } from 'vitest';
import {
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  ZOOM_SLIDER_MAX_DISTANCE,
  ZOOM_SLIDER_MIN_DISTANCE,
  nextZoomStep,
  zoomSliderDistance,
  zoomSliderValue,
} from './camera-zoom';

describe('camera pad zoom slider (#167)', () => {
  it('maps the distance range onto 0–100, closest at 100, and pins outside it', () => {
    expect(zoomSliderValue(ZOOM_SLIDER_MAX_DISTANCE)).toBe(0);
    expect(zoomSliderValue(ZOOM_SLIDER_MIN_DISTANCE)).toBe(100);
    expect(zoomSliderValue(ZOOM_SLIDER_MAX_DISTANCE * 3)).toBe(0);
    expect(zoomSliderValue(0.5)).toBe(100);
    expect(zoomSliderValue(0)).toBe(100);
  });

  it('round-trips value → distance → value', () => {
    for (const value of [0, 13, 50, 87, 100]) {
      expect(zoomSliderValue(zoomSliderDistance(value))).toBe(value);
    }
  });

  it('follows the real distance, so the thumb never saturates while the camera keeps zooming', () => {
    let distance = 12;
    const values: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      distance *= ZOOM_IN_FACTOR;
      values.push(zoomSliderValue(distance));
    }
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
    // Back out the same six steps and the thumb comes back too.
    for (let i = 0; i < 6; i += 1) distance *= ZOOM_OUT_FACTOR;
    expect(Math.abs(zoomSliderValue(distance) - zoomSliderValue(12))).toBeLessThanOrEqual(1);
  });

  it('steps toward a target and stops within half a step', () => {
    let distance = 40;
    const target = 6;
    let steps = 0;
    for (let step = nextZoomStep(distance, target); step; step = nextZoomStep(distance, target)) {
      distance *= step === '+' ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
      steps += 1;
      expect(steps).toBeLessThan(50);
    }
    expect(distance / target).toBeGreaterThan(Math.sqrt(ZOOM_IN_FACTOR));
    expect(distance / target).toBeLessThan(Math.sqrt(ZOOM_OUT_FACTOR));
    expect(nextZoomStep(10, 10)).toBeNull();
    expect(nextZoomStep(10, 30)).toBe('-');
  });
});
