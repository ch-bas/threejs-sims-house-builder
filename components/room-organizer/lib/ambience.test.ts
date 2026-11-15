import { describe, expect, it } from 'vitest';
import { advanceStride, rainSound, STRIDE_METRES } from './ambience';

describe('rainSound: weather and indoors to gain (#911)', () => {
  it('is silent under a clear sky and in snow', () => {
    for (const indoors of [false, true]) {
      expect(rainSound('clear', indoors).gain).toBe(0);
      expect(rainSound('snow', indoors).gain).toBe(0);
    }
  });

  it('is loud and bright outside, quieter and muffled under the roof', () => {
    const out = rainSound('rain', false);
    const inside = rainSound('rain', true);
    expect(out.gain).toBeGreaterThan(0);
    expect(inside.gain).toBeGreaterThan(0);
    expect(inside.gain).toBeLessThan(out.gain);
    expect(inside.cutoffHz).toBeLessThan(out.cutoffHz);
  });

  it('keeps the cutoff when the rain stops, so the fade never sweeps the filter', () => {
    expect(rainSound('clear', true).cutoffHz).toBe(rainSound('rain', true).cutoffHz);
    expect(rainSound('clear', false).cutoffHz).toBe(rainSound('rain', false).cutoffHz);
  });
});

describe('advanceStride: footsteps by distance (#911)', () => {
  it('steps once a stride is walked, and carries the rest', () => {
    let carry = 0;
    let steps = 0;
    // 3.2 m in 0.1 m frames: four strides.
    for (let i = 0; i < 32; i++) {
      const next = advanceStride(carry, 0.1);
      carry = next.carry;
      steps += next.steps;
    }
    expect(steps).toBe(Math.floor(3.2 / STRIDE_METRES));
  });

  it('is silent standing still, and never steps backwards', () => {
    expect(advanceStride(0, 0)).toEqual({ carry: 0, steps: 0 });
    expect(advanceStride(0.5, -1)).toEqual({ carry: 0.5, steps: 0 });
  });

  it('plays at most one step for a long frame', () => {
    expect(advanceStride(0, 5).steps).toBe(1);
  });
});
