import { describe, expect, it } from 'vitest';
import { BASEBOARD_HEIGHT, baseboardRuns } from './baseboard';

const door = (centerAlongWall: number, width = 0.9) => ({ centerAlongWall, width, bottomFromFloor: 0 });
const windowAt = (centerAlongWall: number, width = 1.2) => ({ centerAlongWall, width, bottomFromFloor: 0.9 });

describe('baseboardRuns (#201)', () => {
  it('is one run along a wall with no openings', () => {
    expect(baseboardRuns(-4, 4, [])).toEqual([[-4, 4]]);
  });

  it('breaks around a doorway', () => {
    expect(baseboardRuns(-4, 4, [door(1)])).toEqual([
      [-4, 0.55],
      [1.45, 4],
    ]);
  });

  it('keeps running under windows and other raised openings', () => {
    expect(baseboardRuns(-4, 4, [windowAt(0)])).toEqual([[-4, 4]]);
    expect(baseboardRuns(-4, 4, [{ centerAlongWall: 0, width: 1, bottomFromFloor: BASEBOARD_HEIGHT }])).toEqual([
      [-4, 4],
    ]);
  });

  it('handles unsorted, overlapping and edge-touching doors', () => {
    expect(baseboardRuns(-4, 4, [door(2), door(-3.8, 1), door(2.3)])).toEqual([
      [-3.3, 1.55],
      [2.75, 4],
    ]);
  });

  it('drops slivers too short to render', () => {
    expect(baseboardRuns(-1, 1, [door(-0.5, 0.99), door(0.5, 0.99)])).toEqual([]);
  });

  it('ignores openings entirely outside the span', () => {
    expect(baseboardRuns(-2, 2, [door(5), door(-5)])).toEqual([[-2, 2]]);
  });
});
