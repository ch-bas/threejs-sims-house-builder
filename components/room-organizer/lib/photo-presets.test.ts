import { describe, expect, it } from 'vitest';
import { SHOT_PRESETS, presetConditions, sceneHourLabel, sceneLabel } from './photo-presets';

describe('shot presets (#912)', () => {
  it('each sets a camera preset, an hour in the day and a known weather, under its own id', () => {
    const cameras = new Set(['iso', 'top', 'front', 'corner']);
    const weathers = new Set(['clear', 'rain', 'snow']);
    expect(new Set(SHOT_PRESETS.map((preset) => preset.id)).size).toBe(SHOT_PRESETS.length);
    for (const preset of SHOT_PRESETS) {
      expect(cameras.has(preset.camera)).toBe(true);
      expect(weathers.has(preset.weather)).toBe(true);
      expect(preset.hour).toBeGreaterThanOrEqual(0);
      expect(preset.hour).toBeLessThan(24);
    }
    // Daylight and dark both: the golden hour before sunset (18:00), the night after it.
    const golden = SHOT_PRESETS.find((preset) => preset.id === 'golden');
    const night = SHOT_PRESETS.find((preset) => preset.id === 'night');
    expect(golden?.hour).toBeGreaterThan(16);
    expect(golden?.hour).toBeLessThan(18);
    expect(night?.hour).toBeGreaterThan(19);
  });

  it('stops the clock, so the preset’s hour holds for the shot', () => {
    expect(presetConditions({ hour: 17, weather: 'clear' })).toEqual({ hour: 17, weather: 'clear', autoCycle: false });
  });

  it('labels a scene as a clock and a weather', () => {
    expect(sceneHourLabel(9.5)).toBe('09:30');
    expect(sceneHourLabel(21.5)).toBe('21:30');
    expect(sceneHourLabel(24)).toBe('00:00');
    expect(sceneHourLabel(-1)).toBe('23:00');
    expect(sceneLabel(17, 'clear')).toBe('17:00 · Clear');
    expect(sceneLabel(14, 'rain')).toBe('14:00 · Rain');
    // A record from elsewhere with a weather this build doesn't know.
    expect(sceneLabel(12, 'constructor')).toBe('12:00 · Clear');
  });
});
