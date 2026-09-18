import { describe, expect, it } from 'vitest';
import { computeSkyProfile } from './lighting';

function channels(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function brightness(hex: number): number {
  const [r, g, b] = channels(hex);
  return r + g + b;
}

describe('computeSkyProfile — night ramp (#145)', () => {
  it('midnight is the darkest region of the night, not the brightest', () => {
    const midnight = brightness(computeSkyProfile(0).background);
    expect(midnight).toBeLessThan(brightness(computeSkyProfile(19).background));
    expect(midnight).toBeLessThan(brightness(computeSkyProfile(5.5).background));
  });

  it('darkens monotonically after dusk (18 → 22)', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const hour of [18.25, 19, 20, 21, 22]) {
      const value = brightness(computeSkyProfile(hour).background);
      expect(value, `hour ${hour}`).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('lifts toward dawn (2 → 6) symmetrically', () => {
    let previous = 0;
    for (const hour of [2, 3, 4, 5, 5.75]) {
      const value = brightness(computeSkyProfile(hour).background);
      expect(value, `hour ${hour}`).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('meets the day branch continuously at the 06:00 and 18:00 boundaries', () => {
    for (const [night, day] of [
      [5.99, 6.01],
      [17.99, 18.01],
    ] as const) {
      const a = channels(computeSkyProfile(night).background);
      const b = channels(computeSkyProfile(day).background);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(a[i]! - b[i]!), `hours ${night}/${day} channel ${i}`).toBeLessThanOrEqual(4);
      }
    }
  });
});
